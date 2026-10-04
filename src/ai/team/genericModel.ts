/**
 * `GenericModel` (docs/design/ai.md §9.4, phase `fight`) — WP2 : modèle stratégique des combats sans scénario
 * (focus = argmax Δincoming par PV effectif à retirer, prix de kill génériques).
 *
 * BOUCHON S0 — TODO(WP2) : `update` ne publie rien (prix vides, aucune intention).
 */
import type { ScenarioAIModel } from '../../dungeons/types'
import type { StrategyParams } from '../types'

export function createGenericModel(_theta: StrategyParams): ScenarioAIModel {
  return {
    id: 'generic',
    update(_view, bb) {
      bb.phase = 'fight'
    },
  }
}
