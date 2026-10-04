/**
 * Monte-Carlo d'une configuration (niveau L1, docs/design/ai.md §15.2) — WP4.
 *
 *  - `runBatch(spec, seeds, pool, opts)` : graines réparties en paquets (`WorkerTask` ; 8 graines pour un gros lot,
 *    moins pour un petit lot : `autoChunk`), résultats rangés dans l'ordre de `seeds` (indépendant de
 *    l'ordonnancement, de la taille des paquets et du nombre de workers) ; cache facultatif (cache.ts) ;
 *  - arrêt séquentiel (`StopRule`) : décidé UNIQUEMENT à des points de contrôle fixes (minN, minN + pas, …) sur les
 *    N premières graines ⇒ même N d'arrêt et même résultat avec 1 ou 4 workers ; les graines calculées en avance
 *    (préchargement pour occuper les workers) au-delà de N sont ignorées du résultat (et gardées dans le cache) ;
 *  - `compareConfigs(a, b, seeds, pool, rule)` : comparaison APPARIÉE sur les mêmes graines (CRN), arrêt dès que
 *    |Δscore moyen| > 2,5 × erreur type (après `minN`) ou à `maxN` ;
 *  - résultats robustes : `BatchResult.byVariant` (variantes INCERTAINES tirées par graine si `variantPolicy` =
 *    'sampled') et pire variante (`worstVariant`, stats.ts).
 */
import type { FightCache } from './cache'
import { chunkSeeds } from './seeds'
import { batchShouldStop, pairedDiff, pairedShouldStop, summarizeBatch, type PairedStats } from './stats'
import type { BatchResult, FightSpec, FightSummary, StopRule, WorkerPool, WorkerTask } from './types'

/** Ce dont un lot a besoin d'un pool (un `WorkerPool`, ou le pool local). */
export type FightExecutor = Pick<WorkerPool, 'size' | 'run'>

export interface BatchOptions {
  /** Arrêt séquentiel ; absent ⇒ toutes les graines. */
  stop?: StopRule
  /** Pas entre deux points de contrôle de l'arrêt séquentiel (défaut 16 graines). */
  checkEvery?: number
  /** Type de tâche (défaut 'full' ; micro-scénarios 'prefix12' | 'phase2' | 'poutch'). */
  kind?: WorkerTask['kind']
  /**
   * Taille des paquets ; défaut adaptatif `autoChunk` : 8 graines (§15.2) pour un gros lot, moins pour un petit lot afin
   * d'occuper tous les workers. N'influe jamais sur les résultats (rangés par graine).
   */
  chunk?: number
  cache?: FightCache
  /** Progression : graines terminées (cache compris) / graines prévues. */
  onProgress?(done: number, planned: number): void
}

export interface BatchRun {
  /** Résumés des graines retenues, dans l'ordre de `seeds`. */
  summaries: FightSummary[]
  result: BatchResult
  /** Nombre de graines retenues (N d'arrêt). */
  n: number
  /** Combats effectivement joués (hors cache, préchargement compris). */
  computed: number
  /** Résumés lus dans le cache. */
  cached: number
}

let nextTaskId = 1

/** Taille de paquet adaptative : ≈ 4 paquets par worker pour équilibrer la charge, bornée à [1, 8]. */
export function autoChunk(seeds: number, workers: number): number {
  return Math.max(1, Math.min(8, Math.ceil(seeds / (4 * Math.max(1, workers)))))
}

/** Identifiants de tâches uniques dans le processus (annulation, appariement des résultats). */
export function allocTaskId(): number {
  return nextTaskId++
}

/** Joue `seeds` (sans doublon de travail) et range les résumés par graine dans `into`. */
async function playSeeds(
  spec: FightSpec,
  seeds: readonly number[],
  pool: FightExecutor,
  kind: WorkerTask['kind'],
  chunk: number | undefined,
  into: Map<number, FightSummary>,
  cache: FightCache | undefined,
  onDone: () => void,
): Promise<{ played: number; hits: number }> {
  const todo: number[] = []
  const queued = new Set<number>()
  let hits = 0
  for (const s of seeds) {
    if (into.has(s) || queued.has(s)) continue
    const hit = cache?.get(spec, s, kind)
    if (hit) {
      into.set(s, hit)
      hits++
      onDone()
    } else {
      queued.add(s)
      todo.push(s)
    }
  }
  if (!todo.length) return { played: 0, hits }
  const size = chunk ?? autoChunk(todo.length, pool.size)
  const tasks: WorkerTask[] = chunkSeeds(todo, size).map(part => ({ taskId: allocTaskId(), spec, seeds: part, kind, record: false }))
  for await (const r of pool.run(tasks)) {
    for (const s of r.summaries) {
      into.set(s.seed, s)
      cache?.put(spec, s.seed, s, kind)
      onDone()
    }
  }
  return { played: todo.length, hits }
}

/** Points de contrôle d'un arrêt séquentiel : minN, minN + pas, …, maxN (bornés par le nombre de graines). */
export function checkpoints(rule: StopRule, total: number, every = 16): number[] {
  const max = Math.min(total, rule.maxN)
  const out: number[] = []
  for (let n = Math.min(Math.max(1, rule.minN), max); n < max; n += Math.max(1, every)) out.push(n)
  out.push(max)
  return [...new Set(out)]
}

/** Lot Monte-Carlo d'une configuration (voir l'en-tête). */
export async function runBatch(spec: FightSpec, seeds: readonly number[], pool: FightExecutor, opts: BatchOptions = {}): Promise<BatchRun> {
  const kind = opts.kind ?? 'full'
  const chunk = opts.chunk
  const results = new Map<number, FightSummary>()
  let done = 0
  let computed = 0
  let cached = 0
  const planned = opts.stop ? Math.min(seeds.length, opts.stop.maxN) : seeds.length
  const onDone = () => opts.onProgress?.(++done, planned)
  const play = async (part: readonly number[]) => {
    const r = await playSeeds(spec, part, pool, kind, chunk, results, opts.cache, onDone)
    computed += r.played
    cached += r.hits
  }

  let n = seeds.length
  if (!opts.stop) {
    await play(seeds)
  } else {
    const cps = checkpoints(opts.stop, seeds.length, opts.checkEvery)
    // Préchargement : de quoi occuper tous les workers au-delà du point de contrôle (n'influe pas sur la décision).
    const prefetch = Math.max(0, pool.size * (chunk ?? 8))
    let submitted = 0
    n = cps[cps.length - 1]
    for (const cp of cps) {
      if (submitted < cp) {
        const upto = Math.min(seeds.length, Math.max(cp, Math.min(cps[cps.length - 1], cp + prefetch)))
        await play(seeds.slice(submitted, upto))
        submitted = upto
      }
      const b = summarizeBatch(seeds.slice(0, cp).map(s => results.get(s)!))
      if (batchShouldStop(b, opts.stop)) {
        n = cp
        break
      }
    }
  }
  const summaries = seeds.slice(0, n).map(s => {
    const r = results.get(s)
    if (!r) throw new Error(`Graine ${s} sans résultat`)
    return r
  })
  return { summaries, result: summarizeBatch(summaries), n, computed, cached }
}

export interface CompareRun {
  a: BatchRun
  b: BatchRun
  paired: PairedStats
  /** Graines communes retenues. */
  n: number
}

/**
 * Comparaison appariée de deux configurations sur les mêmes graines (CRN), arrêt séquentiel (§15.2) : aux points de
 * contrôle, stop si |Δscore| > 2,5·SE (après `minN`) ou à `maxN`. Δ = B − A.
 */
export async function compareConfigs(
  a: FightSpec,
  b: FightSpec,
  seeds: readonly number[],
  pool: FightExecutor,
  rule: StopRule,
  opts: Omit<BatchOptions, 'stop' | 'onProgress'> = {},
): Promise<CompareRun> {
  const kind = opts.kind ?? 'full'
  const chunk = opts.chunk
  const ra = new Map<number, FightSummary>()
  const rb = new Map<number, FightSummary>()
  const count = { a: { played: 0, hits: 0 }, b: { played: 0, hits: 0 } }
  const cps = checkpoints(rule, seeds.length, opts.checkEvery)
  const prefetch = Math.max(0, Math.ceil((pool.size * (chunk ?? 8)) / 2))
  let submitted = 0
  let n = cps[cps.length - 1]
  for (const cp of cps) {
    if (submitted < cp) {
      const upto = Math.min(seeds.length, Math.max(cp, Math.min(cps[cps.length - 1], cp + prefetch)))
      const part = seeds.slice(submitted, upto)
      const [ca, cb] = await Promise.all([
        playSeeds(a, part, pool, kind, chunk, ra, opts.cache, () => {}),
        playSeeds(b, part, pool, kind, chunk, rb, opts.cache, () => {}),
      ])
      count.a.played += ca.played
      count.a.hits += ca.hits
      count.b.played += cb.played
      count.b.hits += cb.hits
      submitted = upto
    }
    const p = pairedDiff(seeds.slice(0, cp).map(s => ra.get(s)!), seeds.slice(0, cp).map(s => rb.get(s)!))
    if (pairedShouldStop(p, rule)) {
      n = cp
      break
    }
  }
  const sa = seeds.slice(0, n).map(s => ra.get(s)!)
  const sb = seeds.slice(0, n).map(s => rb.get(s)!)
  return {
    a: { summaries: sa, result: summarizeBatch(sa), n, computed: count.a.played, cached: count.a.hits },
    b: { summaries: sb, result: summarizeBatch(sb), n, computed: count.b.played, cached: count.b.hits },
    paired: pairedDiff(sa, sb),
    n,
  }
}

/** Graines « remarquables » d'un lot pour les replays (§15.9) : victoire médiane, meilleure victoire, échec typique. */
export function notableSeeds(summaries: readonly FightSummary[]): { medianWin?: number; bestWin?: number; typicalFail?: number } {
  const wins = summaries.filter(s => s.win).sort((x, y) => x.score - y.score || x.seed - y.seed)
  const fails = summaries.filter(s => !s.win)
  // Échec typique : cause d'échec la plus fréquente, puis score médian parmi ces échecs.
  let typicalFail: number | undefined
  if (fails.length) {
    const count = new Map<string, number>()
    for (const f of fails) count.set(f.failReason ?? f.endReason, (count.get(f.failReason ?? f.endReason) ?? 0) + 1)
    const top = [...count.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0]
    const same = fails.filter(f => (f.failReason ?? f.endReason) === top).sort((x, y) => x.score - y.score || x.seed - y.seed)
    typicalFail = same[Math.floor((same.length - 1) / 2)].seed
  }
  return {
    medianWin: wins.length ? wins[Math.floor((wins.length - 1) / 2)].seed : undefined,
    bestWin: wins.length ? wins[wins.length - 1].seed : undefined,
    typicalFail,
  }
}
