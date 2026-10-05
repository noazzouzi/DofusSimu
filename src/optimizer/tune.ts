/**
 * Réglage des paramètres de stratégie θ (niveau L2, docs/design/ai.md §15.3) et outils d'évaluation partagés par les
 * boucles L2-L5 (stuff, variantes, composition) — WP4b.
 *
 * Évaluation d'une configuration : Monte-Carlo sur des graines COMMUNES (CRN, `campaignSeeds`), workers du pool,
 * objectif « façonné » `shapedScore` = score du combat (§15.2 : `win ? 1 + 0,1·PV% − tours/600 : 0,8·progress`) +
 * départage de survie pour les défaites (0,02 × min(1, tours/40)) : tant que les défaites n'ont aucune progression
 * (Vortex : équipe éliminée avant la première corruption ⇒ score 0), « tenir plus longtemps » reste un signal ; il ne
 * dépasse jamais l'écart entre une défaite et une victoire, ni un point de progression.
 *
 * Procédure L2 (§15.3) :
 *  1. criblage ±50 % un paramètre à la fois (64 graines CRN), sensibilité = |Δ objectif| / erreur type appariée ⇒ les
 *     8-12 paramètres les plus sensibles ;
 *  2. CEM en espace log (paramètres positifs) : population 12, élite 3, lissage 0,7, 8-15 générations, 16-24 graines
 *     CRN RENOUVELÉES à chaque génération (`masterSeed`, décalage par génération), premières générations éventuellement
 *     sur un micro-scénario (`kindSchedule`, ex. 'prefix12') ; la moyenne courante est toujours ré-évaluée (candidat 0) ;
 *  3. validation sur graines neuves (200 par défaut), test apparié contre θ₀ : accepté seulement si l'amélioration est
 *     significative (z ≥ 2), sinon θ₀ est rendu.
 * Les monstres ne sont jamais réglés (aucun chemin `monster.*` accepté) ; les budgets de recherche (`tactical.*`) non
 * plus (ils changent le coût, pas la stratégie). Les θ produits sont arrondis à 4 chiffres significatifs (clés de cache
 * stables). Déterministe : `Rng` graine, normales d'Irwin-Hall, log/exp déterministes (stuff/detmath.ts).
 */
import { flattenTheta, thetaWithPaths, type ThetaJson } from '../ai/theta'
import { Rng } from '../core/rng'
import type { FightCache } from './cache'
import { runBatch, type FightExecutor } from './montecarlo'
import { campaignSeeds } from './seeds'
import { mean, stderr, summarizeBatch } from './stats'
import { detExp, detLog, normal01, roundSig } from './stuff/detmath'
import type { BatchResult, FightSpec, FightSummary, WorkerTask } from './types'

// ───────────────────────────── objectif et évaluations ─────────────────────────────

/** Objectif façonné d'un combat (voir l'en-tête). */
export function shapedScore(s: FightSummary): number {
  return s.score + (s.win ? 0 : 0.02 * Math.min(1, s.rounds / 40))
}

export type Objective = (s: FightSummary) => number

export interface ConfigEval {
  spec: FightSpec
  summaries: FightSummary[]
  result: BatchResult
  /** Objectif moyen (façonné). */
  objective: number
  /** Objectif par graine (ordre des graines). */
  perSeed: number[]
}

export interface EvalOptions {
  kind?: WorkerTask['kind']
  cache?: FightCache
  objective?: Objective
}

/** Évalue une configuration sur des graines (toutes jouées, ordre des graines). */
export async function evaluateSpec(spec: FightSpec, seeds: readonly number[], pool: FightExecutor, opts: EvalOptions = {}): Promise<ConfigEval> {
  const run = await runBatch(spec, seeds, pool, { kind: opts.kind, cache: opts.cache })
  const f = opts.objective ?? shapedScore
  const perSeed = run.summaries.map(f)
  return { spec, summaries: run.summaries, result: run.result, objective: mean(perSeed), perSeed }
}

/** Évalue plusieurs configurations sur les MÊMES graines (CRN), en parallèle sur le pool. */
export async function evaluateSpecs(specs: readonly FightSpec[], seeds: readonly number[], pool: FightExecutor, opts: EvalOptions = {}): Promise<ConfigEval[]> {
  return Promise.all(specs.map(s => evaluateSpec(s, seeds, pool, opts)))
}

export interface PairedObjective {
  n: number
  /** Moyenne de (objectif B − objectif A) et son erreur type. */
  diff: number
  se: number
  /** |diff| / se (∞ si se = 0 et diff ≠ 0). */
  z: number
  /** Différence de taux de victoire (B − A). */
  winDiff: number
}

/** Comparaison appariée (graines communes) de deux lots selon un objectif ; B − A. */
export function pairedObjective(a: readonly FightSummary[], b: readonly FightSummary[], objective: Objective = shapedScore): PairedObjective {
  const byA = new Map(a.map(x => [x.seed, x]))
  const d: number[] = []
  const w: number[] = []
  for (const y of [...b].sort((p, q) => p.seed - q.seed)) {
    const x = byA.get(y.seed)
    if (!x) continue
    d.push(objective(y) - objective(x))
    w.push((y.win ? 1 : 0) - (x.win ? 1 : 0))
  }
  const diff = mean(d)
  const se = stderr(d)
  return { n: d.length, diff, se, z: se > 0 ? Math.abs(diff) / se : diff !== 0 ? Infinity : 0, winDiff: mean(w) }
}

/** Comparaison appariée de deux vecteurs d'objectifs par graine (même ordre). */
export function pairedVectors(a: readonly number[], b: readonly number[]): PairedObjective {
  const d = a.map((x, i) => b[i] - x)
  const diff = mean(d)
  const se = stderr(d)
  return { n: d.length, diff, se, z: se > 0 ? Math.abs(diff) / se : diff !== 0 ? Infinity : 0, winDiff: 0 }
}

// ───────────────────────────── espace de θ ─────────────────────────────

export interface TuneParam {
  path: string
  /** Valeur de θ₀. */
  base: number
  min: number
  max: number
  /** Recherche en espace log (paramètres strictement positifs). */
  log: boolean
}

/** Préfixes réglables (WP2 / WP3) ; `monster.*` (fixe) et `tactical.*` (budgets) exclus. */
export const TUNABLE_PREFIXES: readonly string[] = ['value.', 'threat.', 'tactics.prior.', 'tactics.epsilon', 'team.', 'planner.', 'vortex.', 'burst.minCommit']

/** Paramètres entiers ou structurels laissés hors du réglage continu. */
const STRUCTURAL = new Set([
  'planner.beamWidth', 'planner.horizonPlayerSlots', 'planner.rootDiversity', 'planner.maxKillsPerSlot',
  'planner.maxAliveFactor', 'team.maxIntentsPerAlly', 'vortex.placementIndex', 'tactics.maxPerNode',
  'vortex.killMin', 'vortex.killMax',
])

/** Le chemin est-il réglable par la boucle externe ? */
export function isTunablePath(path: string): boolean {
  if (path.startsWith('monster.') || path.startsWith('tactical.')) return false
  if (STRUCTURAL.has(path)) return false
  return TUNABLE_PREFIXES.some(p => path === p || path.startsWith(p))
}

/**
 * Paramètres réglables de θ : chemins donnés (ou tous les chemins réglables), bornes [θ₀/4, 4·θ₀] en espace log pour
 * une valeur positive ; une valeur nulle ou négative est réglée linéairement dans [θ₀ − 1, θ₀ + 1] (élargi à |θ₀|).
 */
export function tunableParams(theta: ThetaJson, paths?: readonly string[]): TuneParam[] {
  const flat = flattenTheta(theta)
  const list = paths ?? Object.keys(flat).filter(isTunablePath)
  return list.map(path => {
    if (!isTunablePath(path)) throw new Error(`θ : « ${path} » n'est pas réglable (monstres, budgets ou paramètre structurel)`)
    const base = flat[path]
    if (base === undefined) throw new Error(`θ : chemin inconnu « ${path} »`)
    if (base > 0) return { path, base, min: base / 4, max: base * 4, log: true }
    const span = Math.max(1, Math.abs(base))
    return { path, base, min: base - span, max: base + span, log: false }
  })
}

/** Coordonnées internes (log ou linéaires) → valeurs de θ arrondies. */
function toValues(params: readonly TuneParam[], x: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {}
  params.forEach((p, i) => {
    const v = p.log ? detExp(x[i]) : x[i]
    out[p.path] = roundSig(Math.min(p.max, Math.max(p.min, v)), 4)
  })
  return out
}

function toCoords(params: readonly TuneParam[], values?: Readonly<Record<string, number>>): number[] {
  return params.map(p => {
    const v = values?.[p.path] ?? p.base
    return p.log ? detLog(v) : v
  })
}

function clampCoord(p: TuneParam, x: number): number {
  const lo = p.log ? detLog(p.min) : p.min
  const hi = p.log ? detLog(p.max) : p.max
  return Math.min(hi, Math.max(lo, x))
}

// ───────────────────────────── évaluateurs de θ ─────────────────────────────

/**
 * Évaluateur de θ : objectif par graine pour chaque θ (mêmes graines pour tous : CRN). `kind` permet les
 * micro-scénarios des premières générations.
 */
export type ThetaEvaluator = (thetas: readonly ThetaJson[], seeds: readonly number[], kind?: WorkerTask['kind']) => Promise<number[][]>

/** Évaluateur par combats réels : `base` avec chaque θ, Monte-Carlo sur le pool. */
export function fightThetaEvaluator(base: FightSpec, pool: FightExecutor, opts: EvalOptions = {}): ThetaEvaluator {
  return async (thetas, seeds, kind) => {
    const evals = await evaluateSpecs(thetas.map(theta => ({ ...base, theta })), seeds, pool, { ...opts, kind: kind ?? opts.kind })
    return evals.map(e => e.perSeed)
  }
}

// ───────────────────────────── criblage ─────────────────────────────

export interface ScreenEntry {
  path: string
  base: number
  low: number
  high: number
  /** Δ objectif apparié (bas − θ₀, haut − θ₀) et z. */
  lowDiff: number
  highDiff: number
  lowZ: number
  highZ: number
  /** max(z bas, z haut) (0 si aucune différence). */
  sensitivity: number
}

export interface ScreenOptions {
  /** Facteur de variation (défaut 0,5 ⇒ ×0,5 et ×1,5). */
  factor?: number
  seeds?: number
  masterSeed?: number
  kind?: WorkerTask['kind']
}

/** Criblage de sensibilité un paramètre à la fois (§15.3 point 1), trié par sensibilité décroissante. */
export async function screenTheta(theta0: ThetaJson, params: readonly TuneParam[], evaluate: ThetaEvaluator, opts: ScreenOptions = {}): Promise<{ entries: ScreenEntry[]; evaluations: number }> {
  const f = opts.factor ?? 0.5
  const seeds = campaignSeeds(opts.masterSeed ?? 0x5c3e, opts.seeds ?? 64)
  const variants: ThetaJson[] = [theta0]
  const vals: { low: number; high: number }[] = []
  for (const p of params) {
    const low = roundSig(p.base > 0 ? p.base * (1 - f) : p.base - f * Math.max(1, Math.abs(p.base)), 4)
    const high = roundSig(p.base > 0 ? p.base * (1 + f) : p.base + f * Math.max(1, Math.abs(p.base)), 4)
    vals.push({ low, high })
    variants.push(thetaWithPaths(theta0, { [p.path]: low }), thetaWithPaths(theta0, { [p.path]: high }))
  }
  const scores = await evaluate(variants, seeds, opts.kind)
  const ref = scores[0]
  const entries = params.map((p, i) => {
    const lo = pairedVectors(ref, scores[1 + 2 * i])
    const hi = pairedVectors(ref, scores[2 + 2 * i])
    const z = (x: PairedObjective) => (Number.isFinite(x.z) ? x.z : 1e6)
    return {
      path: p.path,
      base: p.base,
      low: vals[i].low,
      high: vals[i].high,
      lowDiff: lo.diff,
      highDiff: hi.diff,
      lowZ: z(lo),
      highZ: z(hi),
      sensitivity: Math.max(z(lo), z(hi)),
    }
  })
  entries.sort((a, b) => b.sensitivity - a.sensitivity || a.path.localeCompare(b.path))
  return { entries, evaluations: variants.length * seeds.length }
}

// ───────────────────────────── CEM ─────────────────────────────

export interface CemOptions {
  population?: number
  elite?: number
  smoothing?: number
  generations?: number
  /** Graines par génération (renouvelées). */
  seedsPerGeneration?: number
  masterSeed?: number
  /** Graine de l'échantillonneur. */
  rngSeed?: number
  /** Écart type initial en coordonnées internes (log : 0,5 ≈ ×1,65). */
  initSigma?: number
  minSigma?: number
  /** Type de tâche par génération (ex. g < 3 ⇒ 'prefix12'). */
  kindSchedule?: (generation: number) => WorkerTask['kind'] | undefined
  /** Point de départ (valeurs par chemin) ; défaut θ₀. */
  start?: Readonly<Record<string, number>>
}

export interface CemGeneration {
  generation: number
  kind: WorkerTask['kind'] | 'default'
  /** Objectif de la moyenne courante (candidat 0) et meilleur de la génération. */
  meanObjective: number
  bestObjective: number
  sigma: number[]
  values: Record<string, number>
}

export interface CemResult {
  /** θ final (moyenne de la distribution, arrondie). */
  theta: ThetaJson
  values: Record<string, number>
  history: CemGeneration[]
  evaluations: number
}

/** Méthode de l'entropie croisée (§15.3 point 2, voir l'en-tête). */
export async function cemTheta(theta0: ThetaJson, params: readonly TuneParam[], evaluate: ThetaEvaluator, opts: CemOptions = {}): Promise<CemResult> {
  const popSize = Math.max(2, opts.population ?? 12)
  const eliteN = Math.max(1, Math.min(popSize - 1, opts.elite ?? 3))
  const alpha = opts.smoothing ?? 0.7
  const gens = opts.generations ?? 10
  const nSeeds = opts.seedsPerGeneration ?? 16
  const master = opts.masterSeed ?? 0xce3
  const rng = new Rng(opts.rngSeed ?? 0x7e7a)
  const minSigma = opts.minSigma ?? 0.02
  let mu = toCoords(params, opts.start)
  let sigma = params.map(p => (p.log ? (opts.initSigma ?? 0.5) : (opts.initSigma ?? 0.5) * Math.max(1, Math.abs(p.base))))
  const history: CemGeneration[] = []
  let evaluations = 0
  for (let g = 0; g < gens; g++) {
    const kind = opts.kindSchedule?.(g)
    const seeds = campaignSeeds(master, nSeeds, g * nSeeds)
    const pop: number[][] = [mu.slice()]
    for (let k = 1; k < popSize; k++) pop.push(params.map((p, i) => clampCoord(p, mu[i] + sigma[i] * normal01(rng))))
    const thetas = pop.map(x => thetaWithPaths(theta0, toValues(params, x)))
    const scores = await evaluate(thetas, seeds, kind)
    evaluations += thetas.length * seeds.length
    const obj = scores.map(s => mean(s))
    const order = obj.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(x => x[1])
    const elite = order.slice(0, eliteN).map(i => pop[i])
    const eMean = params.map((_, i) => mean(elite.map(x => x[i])))
    const eStd = params.map((_, i) => Math.sqrt(mean(elite.map(x => (x[i] - eMean[i]) ** 2))))
    mu = params.map((p, i) => clampCoord(p, alpha * eMean[i] + (1 - alpha) * mu[i]))
    sigma = sigma.map((s, i) => Math.max(minSigma * (params[i].log ? 1 : Math.max(1, Math.abs(params[i].base))), alpha * eStd[i] + (1 - alpha) * s))
    history.push({ generation: g, kind: kind ?? 'default', meanObjective: obj[0], bestObjective: obj[order[0]], sigma: sigma.slice(), values: toValues(params, mu) })
  }
  const values = toValues(params, mu)
  return { theta: thetaWithPaths(theta0, values), values, history, evaluations }
}

// ───────────────────────────── pipeline complet ─────────────────────────────

export interface ValidationResult {
  accepted: boolean
  paired: PairedObjective
  base: number
  candidate: number
  seeds: number
}

/** Validation sur graines neuves : test apparié θ₁ contre θ₀, accepté si Δ > 0 et z ≥ `zAccept` (défaut 2). */
export async function validateTheta(theta0: ThetaJson, theta1: ThetaJson, evaluate: ThetaEvaluator, opts: { seeds?: number; masterSeed?: number; zAccept?: number; kind?: WorkerTask['kind'] } = {}): Promise<ValidationResult> {
  const seeds = campaignSeeds(opts.masterSeed ?? 0x7a11d, opts.seeds ?? 200)
  const [a, b] = await evaluate([theta0, theta1], seeds, opts.kind)
  const paired = pairedVectors(a, b)
  return { accepted: paired.diff > 0 && paired.z >= (opts.zAccept ?? 2), paired, base: mean(a), candidate: mean(b), seeds: seeds.length }
}

export interface TuneOptions {
  /** Chemins candidats (défaut : tous les chemins réglables). */
  paths?: readonly string[]
  /** Paramètres gardés après criblage (défaut 10). */
  keep?: number
  screen?: ScreenOptions | false
  cem?: CemOptions
  validation?: { seeds?: number; masterSeed?: number; zAccept?: number }
}

export interface TuneResult {
  /** θ retenu : θ_CEM si validé, sinon θ₀. */
  theta: ThetaJson
  accepted: boolean
  screened?: ScreenEntry[]
  selected: string[]
  cem: CemResult
  validation: ValidationResult
  evaluations: number
  /** Différences de θ retenues (chemin → [θ₀, θ]). */
  changes: Record<string, [number, number]>
}

/** Réglage complet (criblage → CEM → validation), §15.3. */
export async function tuneTheta(theta0: ThetaJson, evaluate: ThetaEvaluator, opts: TuneOptions = {}): Promise<TuneResult> {
  let params = tunableParams(theta0, opts.paths)
  let screened: ScreenEntry[] | undefined
  let evaluations = 0
  if (opts.screen !== false && params.length > (opts.keep ?? 10)) {
    const s = await screenTheta(theta0, params, evaluate, opts.screen || {})
    screened = s.entries
    evaluations += s.evaluations
    const keep = new Set(s.entries.slice(0, opts.keep ?? 10).map(e => e.path))
    params = params.filter(p => keep.has(p.path))
  }
  const cem = await cemTheta(theta0, params, evaluate, opts.cem)
  evaluations += cem.evaluations
  const validation = await validateTheta(theta0, cem.theta, evaluate, opts.validation)
  evaluations += 2 * validation.seeds
  const changes: Record<string, [number, number]> = {}
  const flat0 = flattenTheta(theta0)
  if (validation.accepted) for (const [k, v] of Object.entries(cem.values)) if (v !== flat0[k]) changes[k] = [flat0[k], v]
  return {
    theta: validation.accepted ? cem.theta : theta0,
    accepted: validation.accepted,
    screened,
    selected: params.map(p => p.path),
    cem,
    validation,
    evaluations,
    changes,
  }
}

/** Réglage par combats réels (`base` : scénario, équipe, mode ; θ remplacé). */
export async function tuneThetaByFights(base: FightSpec, pool: FightExecutor, opts: TuneOptions & EvalOptions = {}): Promise<TuneResult> {
  return tuneTheta(base.theta, fightThetaEvaluator(base, pool, opts), opts)
}

/** Résumé d'un lot (rapports). */
export function batchOf(summaries: readonly FightSummary[]): BatchResult {
  return summarizeBatch(summaries)
}
