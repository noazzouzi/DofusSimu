/**
 * `GenericModel` (docs/design/ai.md §9.4, phase `fight`) — WP2 : modèle stratégique des combats sans scénario
 * (combats de contrôle, escarmouches, miroirs, mannequin, tests).
 *
 *  - `update` : phase `fight`, aucune urgence de scénario, prix vides (la valeur générique de V s'applique : kill =
 *    κ·PVmax + τ·menace), focus = ennemis triés par « Δincoming par PV effectif à retirer » (formule du §9.3 :
 *    menace × fenêtre de kill d'équipe / tours alliés pour tuer) ;
 *  - `roleNeeds` : besoins génériques (2 tueurs, puis entrave, soin, tank, placement, soutien à 0,5) ;
 *  - `referenceTargets` : ennemis visibles à poids égaux.
 * Sans état propre : une même instance peut servir les deux équipes d'un miroir (tout est lu dans la vue).
 */
import type { ScenarioAIModel } from '../../dungeons/types'
import type { PerceptionX } from '../core'
import type { StrategyParams } from '../types'
import { computeFocus, emptyPriceTable } from './blackboard'
import { defaultReferenceTargets, GENERIC_NEEDS } from './roles'

export function createGenericModel(_theta: StrategyParams): ScenarioAIModel {
  return {
    id: 'generic',
    update(view, bb, perception) {
      bb.phase = 'fight'
      bb.prices = emptyPriceTable()
      bb.plan = undefined
      const p = perception as PerceptionX
      if (p && typeof p.sync === 'function' && p.threat && p.dpt) bb.focus = computeFocus(view, p, bb)
    },
    roleNeeds: () => ({ ...GENERIC_NEEDS }),
    referenceTargets: view => defaultReferenceTargets(view),
    isKeyDecision: () => null,
  }
}
