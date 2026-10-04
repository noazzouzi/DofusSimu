/**
 * Perception d'une équipe (docs/design/ai.md §5.1 `Perception`, §6) — WP1 : DPT calibré, profils de sorts, potentiel
 * puis menace (la menace lit le potentiel pour la valeur d'un Pacifiste), synchronisés incrémentalement sur un état.
 */
import type { TeamId } from '../../core/types'
import type { ScenarioAIModel } from '../../dungeons/types'
import type { FightState } from '../../engine/types'
import { defaultTheta, type ThetaJson } from '../theta'
import type { AIConfig, AIView, Blackboard, Perception } from '../types'
import { createDptTable, type DptTableImpl } from './dpt'
import { PotentialModelImpl } from './potential'
import { createSpellProfileIndex, type SpellProfileIndexX } from './spellProfile'
import { ThreatModelImpl } from './threat'

/** Perception enrichie (implémentation du socle). */
export interface PerceptionX extends Perception {
  dpt: DptTableImpl
  profiles: SpellProfileIndexX
  threat: ThreatModelImpl
  potential: PotentialModelImpl
  view: AIView
  side: TeamId
  theta: ThetaJson
  scenario?: ScenarioAIModel
  /** Tableau noir courant (poids de scénario `damageWeight`) ; posé par la couche d'équipe. */
  bb?: Blackboard
  /** État sur lequel la perception est synchronisée. */
  state(): FightState
}

let cachedTheta: ThetaJson | undefined

/** Perception du camp de la vue (ou `side`), synchronisée sur `view.fight`. */
export function createPerception(view: AIView, cfg?: Pick<AIConfig, 'theta'>, scenario?: ScenarioAIModel,
                                 opts: { side?: TeamId; bb?: Blackboard } = {}): PerceptionX {
  const theta = cfg?.theta ?? (cachedTheta ??= defaultTheta())
  const side = opts.side ?? view.team
  let current: FightState = view.fight
  const p: PerceptionX = {
    dpt: createDptTable(view.engine),
    profiles: createSpellProfileIndex(view.engine),
    threat: undefined as unknown as ThreatModelImpl,
    potential: undefined as unknown as PotentialModelImpl,
    view,
    side,
    theta,
    scenario,
    bb: opts.bb,
    state: () => current,
    sync(s: FightState) {
      current = s
      p.potential.bb = p.bb
      p.potential.sync(s)
      p.threat.sync(s)
    },
  }
  p.potential = new PotentialModelImpl(view, side, p, scenario, theta, opts.bb)
  p.threat = new ThreatModelImpl(view, side, p, scenario, theta)
  p.sync(view.fight)
  return p
}
