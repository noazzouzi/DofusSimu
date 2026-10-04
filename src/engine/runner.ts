/**
 * Boucle de combat : enchaîne les tours et délègue chaque tour au contrôleur (IA) du combattant.
 */
import { castSpell, type CastResult } from './cast'
import type { Engine } from './engine'
import { move } from './move'
import type { Action, Fighter, FightState } from './types'

/** Un contrôleur joue le tour d'un combattant en appelant `performAction` (directement ou après réflexion). */
export interface Controller {
  playTurn(engine: Engine, fight: FightState, fighter: Fighter): void
}

export type ControllerProvider = (fighter: Fighter) => Controller

export function performAction(engine: Engine, fight: FightState, fighter: Fighter, action: Action): CastResult | { ok: boolean } {
  if (fight.ended || !fighter.alive) return { ok: false }
  switch (action.type) {
    case 'move':
      return { ok: move(fight, fighter, action.path, engine) > 0 }
    case 'cast':
      return castSpell(engine, fight, fighter, action.spellId, action.cell)
    case 'endTurn':
      return { ok: true }
  }
}

/** Contrôleur qui ne fait rien (passe son tour). */
export const passController: Controller = { playTurn() {} }

export function runFight(engine: Engine, fight: FightState, controllers: ControllerProvider, maxTurns = 5000): FightState {
  for (let i = 0; i < maxTurns && !fight.ended; i++) {
    const f = engine.nextTurn(fight)
    if (!f) break
    const canPlay = f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
    if (canPlay) controllers(f).playTurn(engine, fight, f)
    if (!fight.ended && f.alive) engine.endTurn(fight, f)
    else if (!fight.ended) engine.emit(fight, { t: 'turnEnd', fighter: f.id })
  }
  if (!fight.ended) engine.endFight(fight, null, 'Limite de tours atteinte')
  return fight
}
