/**
 * Statistiques des lots (docs/design/ai.md §15.2) — WP4 : intervalle de Wilson, agrégation `BatchResult`, classement,
 * comparaisons appariées sur graines communes (CRN) et arrêt séquentiel.
 *
 * Calculs déterministes (sommes dans l'ordre des graines ; seule `Math.sqrt`, correctement arrondie par IEEE 754) :
 * un lot agrégé donne le même résultat quel que soit l'ordre d'arrivée des résultats et le nombre de workers.
 */
import type { BatchResult, FightSummary, StopRule } from './types'

/** Quantile normal bilatéral à 95 %. */
export const Z95 = 1.959963984540054

/** Intervalle de score de Wilson pour k succès sur n essais ; [0, 1] si n = 0. */
export function wilson(k: number, n: number, z = Z95): [number, number] {
  if (!(n > 0)) return [0, 1]
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

export function mean(xs: readonly number[]): number {
  if (!xs.length) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/** Variance d'échantillon (n − 1) ; 0 si n < 2. */
export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) * (x - m)
  return s / (xs.length - 1)
}

/** Erreur type de la moyenne. */
export function stderr(xs: readonly number[]): number {
  return xs.length ? Math.sqrt(variance(xs) / xs.length) : 0
}

/** Quantile empirique (méthode « nearest rank » inférieure : p10 = 10 % des valeurs ≤ résultat). */
export function quantile(xs: readonly number[], p: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))
  return s[i]
}

/** Résumés triés par graine (ordre canonique d'un lot). */
export function sortBySeed(summaries: readonly FightSummary[]): FightSummary[] {
  return [...summaries].sort((a, b) => a.seed - b.seed)
}

/** Agrège un lot (`BatchResult`, §5.3). */
export function summarizeBatch(summaries: readonly FightSummary[]): BatchResult {
  const s = sortBySeed(summaries)
  const n = s.length
  const wins = s.filter(x => x.win).length
  const byVariant: BatchResult['byVariant'] = {}
  const acc = new Map<string, { n: number; w: number }>()
  for (const x of s) {
    const a = acc.get(x.variant) ?? { n: 0, w: 0 }
    a.n++
    if (x.win) a.w++
    acc.set(x.variant, a)
  }
  for (const k of [...acc.keys()].sort()) {
    const a = acc.get(k)!
    byVariant[k] = { n: a.n, winRate: a.w / a.n }
  }
  return {
    n,
    wins,
    winRate: n ? wins / n : 0,
    wilson95: wilson(wins, n),
    meanScore: mean(s.map(x => x.score)),
    meanRounds: mean(s.map(x => x.rounds)),
    p10HpLeft: quantile(s.map(x => x.hpLeftPct), 0.1),
    byVariant,
  }
}

/**
 * Clé de classement d'une configuration (§15.2) : borne basse de Wilson à 95 % si au moins une victoire, sinon score
 * moyen (dans [0, 0,8], toujours sous une borne de Wilson d'une équipe qui gagne… sauf si la borne est très basse :
 * on ajoute 1 aux configurations gagnantes pour garantir l'ordre « gagne » > « progresse »).
 */
export function rankKey(b: BatchResult): number {
  return b.wins > 0 ? 1 + b.wilson95[0] : b.meanScore
}

/** Pire variante INCERTAINE (taux de victoire minimal, puis effectif maximal, puis clé). */
export function worstVariant(b: BatchResult, minN = 1): { key: string; n: number; winRate: number } | undefined {
  let worst: { key: string; n: number; winRate: number } | undefined
  for (const key of Object.keys(b.byVariant).sort()) {
    const v = b.byVariant[key]
    if (v.n < minN) continue
    if (!worst || v.winRate < worst.winRate || (v.winRate === worst.winRate && v.n > worst.n)) worst = { key, ...v }
  }
  return worst
}

/** Causes d'échec regroupées (§15.2), triées par effectif décroissant puis libellé. */
export function failReasons(summaries: readonly FightSummary[]): { reason: string; n: number }[] {
  const m = new Map<string, number>()
  for (const s of summaries) {
    if (s.win) continue
    const r = s.failReason ?? (s.endReason || 'inconnue')
    m.set(r, (m.get(r) ?? 0) + 1)
  }
  return [...m.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason))
}

// ───────────────────────────── comparaisons appariées (CRN) ─────────────────────────────

export interface PairedStats {
  /** Graines communes aux deux lots. */
  n: number
  /** Moyenne de (victoire B − victoire A) et son erreur type. */
  winDiff: number
  winSe: number
  /** Moyenne de (score B − score A) et son erreur type. */
  scoreDiff: number
  scoreSe: number
  /** |scoreDiff| / scoreSe (∞ si l'erreur type est nulle et la différence non nulle). */
  z: number
}

/** Comparaison appariée de deux lots sur leurs graines communes (B − A). */
export function pairedDiff(a: readonly FightSummary[], b: readonly FightSummary[]): PairedStats {
  const byA = new Map(a.map(x => [x.seed, x]))
  const dw: number[] = []
  const ds: number[] = []
  for (const y of sortBySeed(b)) {
    const x = byA.get(y.seed)
    if (!x) continue
    dw.push((y.win ? 1 : 0) - (x.win ? 1 : 0))
    ds.push(y.score - x.score)
  }
  const scoreDiff = mean(ds)
  const scoreSe = stderr(ds)
  return {
    n: ds.length,
    winDiff: mean(dw),
    winSe: stderr(dw),
    scoreDiff,
    scoreSe,
    z: scoreSe > 0 ? Math.abs(scoreDiff) / scoreSe : scoreDiff !== 0 ? Infinity : 0,
  }
}

/** Seuil d'arrêt d'une comparaison appariée : |moyenne| > 2,5 × erreur type (§15.2). */
export const PAIRED_STOP_Z = 2.5

/** Arrêt séquentiel d'une comparaison appariée (`minN` atteint et |Δscore| > 2,5·SE, ou `maxN`). */
export function pairedShouldStop(p: PairedStats, rule: StopRule): boolean {
  if (p.n >= rule.maxN) return true
  return p.n >= rule.minN && p.z > PAIRED_STOP_Z
}

/**
 * Arrêt séquentiel d'un lot seul : `minN` atteint et demi-largeur de l'IC de Wilson ≤ `halfWidth`, ou `maxN`.
 * (La demi-largeur est maximale à 50 % : ≈ 0,98/√n ; `halfWidth` 0,03 ⇒ ≈ 1 070 combats au pire.)
 */
export function batchShouldStop(b: BatchResult, rule: StopRule): boolean {
  if (b.n >= rule.maxN) return true
  if (b.n < rule.minN) return false
  return (b.wilson95[1] - b.wilson95[0]) / 2 <= rule.halfWidth
}

/** Règle d'arrêt par défaut (§15.2). */
export const DEFAULT_STOP: Readonly<StopRule> = { minN: 32, maxN: 1000, halfWidth: 0.03 }
