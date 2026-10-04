/**
 * Registre des scénarios de donjon (docs/design/ai.md §12) — WP3.
 * S0 : seul le Vortex (bouchon) est enregistré. TODO(WP3) : scénarios génériques (generic/dummy.ts, skirmish.ts).
 */
import type { DungeonScenario } from './types'
import { vortexScenario } from './vortex/scenario'

export type * from './types'

const SCENARIOS = new Map<string, DungeonScenario>([[vortexScenario.id, vortexScenario]])

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
