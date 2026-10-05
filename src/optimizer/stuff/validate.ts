/**
 * Validation des stuffs par combats (niveau L3, docs/design/ai.md §15.4 point 7) — WP4b.
 *
 * Les builds diversifiés d'un membre (front DPT/EHP/UTIL de `optimizeStuff`, + son build actuel) sont comparés DANS
 * l'équipe finaliste, sur les mêmes graines (CRN, 32 par défaut ; T1 `prefix12` + `phase2` pour le Vortex via
 * `kinds`). Le build retenu est celui d'objectif moyen maximal ; le build actuel n'est remplacé que si la différence
 * appariée est positive (z ≥ `minZ`, défaut 0 : meilleur objectif moyen) — le proxy propose, les combats décident.
 */
import type { FightCache } from '../cache'
import type { FightExecutor } from '../montecarlo'
import { campaignSeeds } from '../seeds'
import { evaluateSpecs, pairedVectors, type ConfigEval, type Objective, type PairedObjective } from '../tune'
import type { CharacterBuild, FightSpec, WorkerTask } from '../types'
import type { StuffCandidate } from './search'

export interface StuffValidationOptions {
  seeds?: number
  masterSeed?: number
  /** Types de tâches cumulés (défaut ['full']) ; l'objectif est la moyenne des types. */
  kinds?: readonly WorkerTask['kind'][]
  minZ?: number
  cache?: FightCache
  objective?: Objective
}

export interface StuffValidation {
  /** Index du membre. */
  member: number
  /** Builds comparés (0 = build actuel). */
  builds: CharacterBuild[]
  objectives: number[]
  winRates: number[]
  paired: PairedObjective[]
  chosen: number
  evals: ConfigEval[][]
}

/** Compare des builds d'un membre dans l'équipe (voir l'en-tête). */
export async function validateStuffs(base: FightSpec, member: number, candidates: readonly (StuffCandidate | CharacterBuild)[], pool: FightExecutor, opts: StuffValidationOptions = {}): Promise<StuffValidation> {
  const seeds = campaignSeeds(opts.masterSeed ?? 0x57f, opts.seeds ?? 32)
  const builds = [base.team[member].build, ...candidates.map(c => ('build' in c ? c.build : c))]
  const specs = builds.map(build => ({ ...base, team: base.team.map((m, i) => (i === member ? { ...m, build: { ...build, spellVariants: m.build.spellVariants ?? build.spellVariants } } : m)) }))
  const kinds = opts.kinds ?? ['full']
  const evals: ConfigEval[][] = []
  for (const kind of kinds) evals.push(await evaluateSpecs(specs, seeds, pool, { kind, cache: opts.cache, objective: opts.objective }))
  const perSeed = specs.map((_, i) => seeds.flatMap((_, s) => kinds.map((__, k) => evals[k][i].perSeed[s])))
  const objectives = perSeed.map(v => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length))
  const winRates = specs.map((_, i) => evals.reduce((a, e) => a + e[i].result.winRate, 0) / kinds.length)
  const paired = perSeed.map(v => pairedVectors(perSeed[0], v))
  let chosen = 0
  for (let i = 1; i < builds.length; i++) {
    const p = paired[i]
    if (p.diff > 0 && p.z >= (opts.minZ ?? 0) && objectives[i] > objectives[chosen]) chosen = i
  }
  return { member, builds, objectives, winRates, paired, chosen, evals }
}
