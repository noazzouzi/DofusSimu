/**
 * Registre des scénarios de donjon (docs/design/ai.md §12, §16.5) — WP3.
 *
 * Scénarios enregistrés : 'vortex' (Œil de Vortex), 'skirmish' (n'importe quels monstres sur n'importe quelle carte),
 * 'dummy' (mannequin d'entraînement passif). Usage :
 * `const s = getScenario(id); const engine = createEngine(data, s.hooks); const fight = s.createFight(engine, team, …)`.
 */
import { dummyScenario } from './generic/dummy'
import { skirmishScenario } from './generic/skirmish'
import type { DungeonScenario, ScenarioParams } from './types'
import { sampleUncertain } from './vortex/params'
import { vortexScenario } from './vortex/scenario'

export type * from './types'

const SCENARIOS = new Map<string, DungeonScenario>([
  [vortexScenario.id, vortexScenario],
  [skirmishScenario.id, skirmishScenario],
  [dummyScenario.id, dummyScenario],
])

/** Enregistre (ou remplace) un scénario. */
export function registerScenario(s: DungeonScenario): void {
  SCENARIOS.set(s.id, s)
}

/** Scénario par identifiant ; erreur explicite s'il est inconnu. */
export function getScenario(id: string): DungeonScenario {
  const s = SCENARIOS.get(id)
  if (!s) throw new Error(`Scénario inconnu : « ${id} » (connus : ${[...SCENARIOS.keys()].join(', ')})`)
  return s
}

export function listScenarios(): string[] {
  return [...SCENARIOS.keys()]
}

/**
 * Variante INCERTAINE d'un scénario pour une graine de combat (§12.1, §13.1 : `Rng(mix32(fightSeed, 0x5C))`) :
 * paramètres différents du défaut à fusionner dans `params`, et clé lisible ('default' si tout est au défaut).
 */
export function sampleVariant(scenario: DungeonScenario, fightSeed: number): { params: Partial<ScenarioParams>; key: string } {
  return sampleUncertain(scenario.uncertain, fightSeed)
}

export { vortexScenario } from './vortex/scenario'
export { skirmishScenario } from './generic/skirmish'
export { dummyScenario } from './generic/dummy'
export { runVortexSmoke, createSmokeTeam, summarizeVortex, setVortexAIModelFactory, basicVortexAIModel, vortexReferenceTargets } from './vortex/scenario'
export { createVortexFight, vortexHooks } from './vortex/setup'
export { resolveVortexParams, sampleVortexVariant, variantKey, vortexState } from './vortex/params'
export { forecastHours, starWindows, lineCells, currentHour, deathHours } from './vortex/clock'
export { trackVortex, VortexTracker } from './vortex/tracker'
export { rankVortexPlacements, defaultVortexPlacement } from './vortex/placement'
