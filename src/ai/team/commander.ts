/**
 * Commandant et machine à phases (docs/design/ai.md §9.4) — WP2.
 *
 * Au début du tour de chaque allié : (1) nouveau tour de jeu ⇒ cases réservées vidées ; (2) `ScenarioAIModel.update`
 * (phase, plan à horizon glissant, `PriceTable` et intentions du combattant courant ; `GenericModel` hors scénario) ;
 * (3) focus (§9.3) et réservations de kill ; (4) allocation des intentions (§9.5) et phase transverse `emergency`
 * (risque de mort d'un allié > θ.team.emergencyDeathProb : intentions protect/survive prioritaires) ; (5)
 * `Blackboard.version++`.
 *
 * Phases : `fight` (combat sans scénario) ; `opening`, `waveCycle`, `waiting`, `transition`, `burst` (Vortex : posées
 * par le modèle du scénario) ; `emergency` est superposée (`bb.emergency`). L'engagement sur un plan de scénario
 * (remplacé seulement s'il est meilleur de θ.team.commit) relève du planificateur du scénario (WP3).
 */
import type { ScenarioAIModel } from '../../dungeons/types'
import type { PerceptionX } from '../core'
import type { AIMode, AIView, Blackboard, CapabilityProfile, ThetaJson } from '../types'
import { allocateIntents } from './allocator'
import { computeFocus, updateReservations } from './blackboard'

export interface CommanderInput {
  view: AIView
  perception: PerceptionX
  bb: Blackboard
  mode: AIMode
  theta: ThetaJson
  scenario?: ScenarioAIModel
  caps: ReadonlyMap<number, CapabilityProfile>
}

/** Mise à jour stratégique du tableau noir au début du tour d'un allié. */
export function commanderUpdate(i: CommanderInput): void {
  const { view, perception: p, bb } = i
  const s = view.fight
  if (s.round !== bb.round) {
    bb.reservedCells.clear()
    bb.round = s.round
  }
  p.bb = bb
  if (i.scenario) i.scenario.update(view, bb, p, i.mode)
  else bb.phase = 'fight'
  p.bb = bb
  p.sync(s)
  bb.focus = computeFocus(view, p, bb)
  if (view.me.kind === 'player') updateReservations(view, p, bb)
  allocateIntents(view, p, bb, i.theta, i.caps)
  bb.version++
}
