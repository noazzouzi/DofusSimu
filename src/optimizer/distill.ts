/**
 * Distillation `fast` ← `standard` (niveau L2, docs/design/ai.md §15.3) — WP4b.
 *
 * On journalise des décisions de l'IA lente (racine, candidats évalués, plan choisi) et on règle les poids de la
 * fonction de valeur utilisée par `fast` pour maximiser l'ACCORD DE CLASSEMENT : perte logistique par paires
 * (`softplus((s_j − s_choisi)/T)` sur chaque candidat non choisi j), minimisée en espace log (poids positifs) par CEM
 * (exploration globale) puis descente de gradient analytique (raffinement) ; température T par défaut = médiane des
 * |s_j − s_choisi| aux poids initiaux (perte indépendante de l'échelle des termes).
 * Le Monte-Carlo rapide devient ainsi représentatif de l'IA lente. Les monstres ne sont jamais concernés.
 *
 * Données : `DecisionRecord` = termes BRUTS (non pondérés) de `EvalBreakdown` (§7) de chaque candidat d'une décision
 * et l'indice du plan retenu par `standard`. Le journal lui-même est produit par la recherche tactique (WP2 :
 * `TurnSearch` en mode `standard`, interface `DecisionSource`) — tant qu'elle n'est pas livrée, la distillation se
 * teste sur des journaux synthétiques (tests/opt-tune-distill.test.ts) ; `weightsToTheta` reporte les poids appris sur
 * les chemins θ.value correspondants (`TERM_TO_THETA`).
 */
import type { EvalBreakdown } from '../ai/types'
import { flattenTheta, thetaWithPaths, type ThetaJson } from '../ai/theta'
import { Rng } from '../core/rng'
import type { FightSpec } from './types'
import { detExp, detLog, normal01, roundSig } from './stuff/detmath'

/** Termes de V(s) utilisés comme caractéristiques (ordre fixe). */
export const DISTILL_TERMS: readonly (keyof Omit<EvalBreakdown, 'total'>)[] = [
  'enemyLife', 'kills', 'allyLife', 'erosion', 'allyDeath', 'incoming', 'pendingDot', 'control', 'potential',
  'continuation', 'resources', 'position', 'scenario',
]

/** Chemin θ portant le poids d'un terme (termes sans poids θ propre : absents, poids appris rapportés seulement). */
export const TERM_TO_THETA: Readonly<Partial<Record<keyof EvalBreakdown, string>>> = {
  enemyLife: 'value.monsterDamage',
  kills: 'value.killKappa',
  erosion: 'value.erosion',
  incoming: 'value.incoming',
  pendingDot: 'value.dot',
  control: 'value.control',
  potential: 'value.potBefore',
  continuation: 'value.continuation',
  resources: 'value.cdCost',
}

/** Une décision journalisée : caractéristiques brutes des candidats, indice choisi par l'IA lente. */
export interface DecisionRecord {
  candidates: number[][]
  chosen: number
  /** Poids de la décision (décision clé, etc.) ; défaut 1. */
  weight?: number
}

/** Source de décisions (WP2 : journal des racines de `TurnSearch` en mode `standard`). */
export type DecisionSource = (spec: FightSpec, seed: number) => DecisionRecord[]

/** Caractéristiques brutes d'une décomposition `EvalBreakdown` (ordre `DISTILL_TERMS`). */
export function breakdownFeatures(b: EvalBreakdown, currentWeights?: Readonly<Partial<Record<keyof EvalBreakdown, number>>>): number[] {
  return DISTILL_TERMS.map(t => {
    const w = currentWeights?.[t]
    return w && w !== 0 ? b[t] / w : b[t]
  })
}

/** Score linéaire d'un candidat. */
export function linearScore(f: readonly number[], w: readonly number[]): number {
  let s = 0
  for (let i = 0; i < f.length; i++) s += f[i] * w[i]
  return s
}

/** softplus(x) = ln(1 + eˣ), déterministe et stable. */
function softplus(x: number): number {
  if (x > 30) return x
  if (x < -30) return detExp(x)
  return detLog(1 + detExp(x))
}

/** Perte logistique par paires (moyenne pondérée par décision), température `T` (PVe). */
export function rankingLoss(records: readonly DecisionRecord[], w: readonly number[], T = 100): number {
  let loss = 0
  let tw = 0
  for (const r of records) {
    const sc = linearScore(r.candidates[r.chosen], w)
    let l = 0
    // (la température est fournie par l'appelant)
    for (let j = 0; j < r.candidates.length; j++) if (j !== r.chosen) l += softplus((linearScore(r.candidates[j], w) - sc) / T)
    const k = Math.max(1, r.candidates.length - 1)
    loss += (r.weight ?? 1) * (l / k)
    tw += r.weight ?? 1
  }
  return tw > 0 ? loss / tw : 0
}

/** Accord top-1 (part des décisions où le candidat de score maximal est celui de l'IA lente ; départage par indice). */
export function agreement(records: readonly DecisionRecord[], w: readonly number[]): number {
  if (!records.length) return 0
  let ok = 0
  for (const r of records) {
    let best = 0
    let bestS = -Infinity
    r.candidates.forEach((c, i) => {
      const s = linearScore(c, w)
      if (s > bestS) {
        bestS = s
        best = i
      }
    })
    if (best === r.chosen) ok++
  }
  return ok / records.length
}

export interface DistillOptions {
  /** Méthode (défaut 'cem+gradient'). */
  method?: 'cem' | 'gradient' | 'cem+gradient'
  /** Itérations de la descente de gradient (défaut 200). */
  steps?: number
  /** Pas initial en coordonnées log (défaut 0,1). */
  learningRate?: number
  population?: number
  elite?: number
  smoothing?: number
  generations?: number
  initSigma?: number
  rngSeed?: number
  temperature?: number
  /** Indices de poids figés (non appris). */
  frozen?: readonly number[]
}

export interface DistillResult {
  weights: number[]
  loss: number
  agreement: number
  initialLoss: number
  initialAgreement: number
  history: { generation: number; loss: number; agreement: number }[]
}

/** Logistique σ(x) = 1 / (1 + e^−x), déterministe. */
function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + detExp(-x))
  const e = detExp(x)
  return e / (1 + e)
}

/** Température par défaut : médiane des |s_j − s_choisi| aux poids `w` (≥ 1e-9). */
export function defaultTemperature(records: readonly DecisionRecord[], w: readonly number[]): number {
  const d: number[] = []
  for (const r of records) {
    const sc = linearScore(r.candidates[r.chosen], w)
    for (let j = 0; j < r.candidates.length; j++) if (j !== r.chosen) d.push(Math.abs(linearScore(r.candidates[j], w) - sc))
  }
  if (!d.length) return 1
  d.sort((a, b) => a - b)
  return Math.max(1e-9, d[Math.floor(d.length / 2)])
}

/** Gradient de la perte par rapport aux coordonnées log u (w = e^u) ; poids nuls ou figés : 0. */
function lossGradient(records: readonly DecisionRecord[], w: readonly number[], T: number, frozen: ReadonlySet<number>): number[] {
  const n = w.length
  const g = new Array<number>(n).fill(0)
  let tw = 0
  for (const r of records) {
    const c = r.candidates[r.chosen]
    const sc = linearScore(c, w)
    const k = Math.max(1, r.candidates.length - 1)
    const rw = (r.weight ?? 1) / k
    tw += r.weight ?? 1
    for (let j = 0; j < r.candidates.length; j++) {
      if (j === r.chosen) continue
      const f = r.candidates[j]
      const s = sigmoid((linearScore(f, w) - sc) / T) / T
      for (let i = 0; i < n; i++) g[i] += rw * s * (f[i] - c[i])
    }
  }
  for (let i = 0; i < n; i++) g[i] = frozen.has(i) || !(w[i] > 0) || tw <= 0 ? 0 : (g[i] / tw) * w[i]
  return g
}

/** Descente de gradient (Adam, déterministe) en coordonnées log. */
function gradientDescent(records: readonly DecisionRecord[], start: readonly number[], T: number, frozen: ReadonlySet<number>, steps: number, lr0: number): number[] {
  const n = start.length
  const u = start.map(v => (v > 0 ? detLog(v) : -Infinity))
  const m = new Array<number>(n).fill(0)
  const v2 = new Array<number>(n).fill(0)
  let best = { w: start.slice(), loss: rankingLoss(records, start, T) }
  for (let t = 1; t <= steps; t++) {
    const w = u.map(x => (x === -Infinity ? 0 : detExp(x)))
    const g = lossGradient(records, w, T, frozen)
    const lr = lr0 / (1 + t / 100)
    for (let i = 0; i < n; i++) {
      if (u[i] === -Infinity || g[i] === 0) continue
      m[i] = 0.9 * m[i] + 0.1 * g[i]
      v2[i] = 0.999 * v2[i] + 0.001 * g[i] * g[i]
      const mh = m[i] / (1 - 0.9 ** t)
      const vh = v2[i] / (1 - 0.999 ** t)
      u[i] -= (lr * mh) / (Math.sqrt(vh) + 1e-12)
    }
    const nw = u.map(x => (x === -Infinity ? 0 : detExp(x)))
    const l = rankingLoss(records, nw, T)
    if (l < best.loss) best = { w: nw, loss: l }
  }
  return best.w
}

/** Distille des poids (positifs) sur la perte de classement (voir l'en-tête). */
export function distillWeights(records: readonly DecisionRecord[], init: readonly number[], opts: DistillOptions = {}): DistillResult {
  const n = init.length
  const T = opts.temperature ?? defaultTemperature(records, init)
  const method = opts.method ?? 'cem+gradient'
  const pop = Math.max(4, opts.population ?? 24)
  const eliteN = Math.max(2, Math.min(pop - 1, opts.elite ?? 6))
  const alpha = opts.smoothing ?? 0.7
  const rng = new Rng(opts.rngSeed ?? 0xd157)
  const frozen = new Set(opts.frozen ?? [])
  // Coordonnées log (poids > 0) ; un poids nul reste nul.
  let mu = init.map(v => (v > 0 ? detLog(v) : -Infinity))
  let sigma = init.map((v, i) => (v > 0 && !frozen.has(i) ? (opts.initSigma ?? 0.7) : 0))
  const toW = (x: readonly number[]) => x.map(v => (v === -Infinity ? 0 : detExp(v)))
  const initialLoss = rankingLoss(records, init, T)
  const initialAgreement = agreement(records, init)
  let best = { w: init.slice(), loss: initialLoss }
  const history: DistillResult['history'] = []
  const gens = method === 'gradient' ? 0 : (opts.generations ?? 30)
  for (let g = 0; g < gens; g++) {
    const xs: number[][] = [mu.slice()]
    for (let k = 1; k < pop; k++) xs.push(mu.map((m, i) => (sigma[i] > 0 ? m + sigma[i] * normal01(rng) : m)))
    const losses = xs.map(x => rankingLoss(records, toW(x), T))
    const order = losses.map((l, i) => [l, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[1])
    if (losses[order[0]] < best.loss) best = { w: toW(xs[order[0]]), loss: losses[order[0]] }
    const elite = order.slice(0, eliteN).map(i => xs[i])
    mu = mu.map((m, i) => {
      if (sigma[i] === 0) return m
      let s = 0
      for (const e of elite) s += e[i]
      return alpha * (s / elite.length) + (1 - alpha) * m
    })
    sigma = sigma.map((s, i) => {
      if (s === 0) return 0
      let v = 0
      for (const e of elite) v += (e[i] - mu[i]) ** 2
      return Math.max(0.01, alpha * Math.sqrt(v / elite.length) + (1 - alpha) * s)
    })
    history.push({ generation: g, loss: best.loss, agreement: agreement(records, best.w) })
  }
  if (method !== 'cem') {
    const w = gradientDescent(records, best.w, T, frozen, opts.steps ?? 200, opts.learningRate ?? 0.1)
    const l = rankingLoss(records, w, T)
    if (l < best.loss) best = { w, loss: l }
    history.push({ generation: gens, loss: best.loss, agreement: agreement(records, best.w) })
  }
  return { weights: best.w.map(v => roundSig(v, 4)), loss: best.loss, agreement: agreement(records, best.w), initialLoss, initialAgreement, history }
}

/**
 * Reporte des poids distillés sur θ : chaque terme mappé (`TERM_TO_THETA`) est mis à l'échelle par le rapport
 * poids appris / poids initial (les poids sont relatifs : on normalise par le terme `enemyLife` s'il est appris).
 */
export function weightsToTheta(theta: ThetaJson, init: readonly number[], learned: readonly number[]): ThetaJson {
  const flat = flattenTheta(theta)
  const iRef = DISTILL_TERMS.indexOf('enemyLife')
  const norm = init[iRef] > 0 && learned[iRef] > 0 ? init[iRef] / learned[iRef] : 1
  const values: Record<string, number> = {}
  DISTILL_TERMS.forEach((t, i) => {
    const path = TERM_TO_THETA[t]
    if (!path || !(init[i] > 0) || flat[path] === undefined || t === 'enemyLife') return
    values[path] = roundSig(flat[path] * ((learned[i] * norm) / init[i]), 4)
  })
  return thetaWithPaths(theta, values)
}
