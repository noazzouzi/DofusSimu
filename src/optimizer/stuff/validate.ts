/**
 * Validation des stuffs par combats (niveau L3, docs/design/ai.md §15.4 point 7) — WP4b.
 *
 * Les builds diversifiés d'un membre (front DPT/EHP/UTIL de `optimizeStuff`, + son build actuel) sont comparés DANS
 * l'équipe finaliste, sur les mêmes graines (CRN, 32 par défaut). Types de combats (`kinds`) : par défaut T1
 * `prefix12` + `phase2` (§15.4 point 7) si le scénario a ces micro-scénarios (Vortex), sinon le combat complet. Le build
 * retenu est celui d'objectif moyen maximal ; le build actuel n'est remplacé que si la différence appariée est positive
 * (z ≥ `minZ`, défaut 0 : meilleur objectif moyen) — le proxy propose, les combats décident.
 *
 * Build actuel INVALIDE (`StuffResult.startValid` faux : objets au-dessus du niveau, conditions…) : le moteur le refuse
 * (`buildTeam`, runner.ts) et il ne doit de toute façon jamais être retenu. Avec `startValid: false`, il n'est ni joué
 * ni proposé : la référence (indice 0) devient le premier candidat (normalement `StuffResult.best`).
 */
import type { FightCache } from '../cache'
import type { FightExecutor } from '../montecarlo'
import { resolveScenario } from '../runner'
import { campaignSeeds } from '../seeds'
import { evaluateSpecs, pairedVectors, type ConfigEval, type Objective, type PairedObjective } from '../tune'
import type { CharacterBuild, FightSpec, WorkerTask } from '../types'
import type { StuffCandidate } from './search'

export interface StuffValidationOptions {
  seeds?: number
  masterSeed?: number
  /** Types de tâches cumulés (défaut `defaultValidationKinds`) ; l'objectif est la moyenne des types. */
  kinds?: readonly WorkerTask['kind'][]
  minZ?: number
  cache?: FightCache
  objective?: Objective
  /**
   * Le build actuel du membre est-il valide (`StuffResult.startValid`) ? Défaut vrai. Faux : il n'est pas joué et la
   * référence des comparaisons appariées (indice 0) est le premier candidat (voir l'en-tête).
   */
  startValid?: boolean
}

export interface StuffValidation {
  /** Index du membre. */
  member: number
  /** Builds comparés (0 = référence : build actuel, ou premier candidat si `startIncluded` est faux). */
  builds: CharacterBuild[]
  /**
   * Le build actuel est-il joué (indice 0) ? Faux quand il est invalide (`startValid: false`) : `builds[i]` est alors
   * le candidat `i` (sinon le candidat `i − 1`).
   */
  startIncluded: boolean
  objectives: number[]
  winRates: number[]
  /** Comparaisons appariées avec la référence (indice 0). */
  paired: PairedObjective[]
  chosen: number
  evals: ConfigEval[][]
}

/** Types de combats de la validation par défaut : `prefix12` + `phase2` si le scénario les a, sinon 'full'. */
export function defaultValidationKinds(scenarioId: string): WorkerTask['kind'][] {
  const micro = resolveScenario(scenarioId).micro
  return micro.prefix12 && micro.phase2 ? ['prefix12', 'phase2'] : ['full']
}

/** Compare des builds d'un membre dans l'équipe (voir l'en-tête). */
export async function validateStuffs(base: FightSpec, member: number, candidates: readonly (StuffCandidate | CharacterBuild)[], pool: FightExecutor, opts: StuffValidationOptions = {}): Promise<StuffValidation> {
  const seeds = campaignSeeds(opts.masterSeed ?? 0x57f, opts.seeds ?? 32)
  const startIncluded = opts.startValid ?? true
  const proposed = candidates.map(c => ('build' in c ? c.build : c))
  if (!startIncluded && !proposed.length) throw new Error(`Validation des stuffs : le build actuel de « ${base.team[member].name} » est invalide et aucun candidat valide n'est proposé`)
  const builds = startIncluded ? [base.team[member].build, ...proposed] : proposed
  const specs = builds.map(build => ({ ...base, team: base.team.map((m, i) => (i === member ? { ...m, build: { ...build, spellVariants: m.build.spellVariants ?? build.spellVariants } } : m)) }))
  const kinds = opts.kinds ?? defaultValidationKinds(base.scenarioId)
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
  return { member, builds, startIncluded, objectives, winRates, paired, chosen, evals }
}
