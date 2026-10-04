/**
 * Point d'entrée du moteur : crée un `Engine` avec TOUTES les familles d'effets enregistrées et leurs crochets
 * installés dans l'ordre attendu (docs/research/mechanics.md §9.2) :
 *  noyau (effets différés, buffs TB/TE, déclencheurs) → dégâts (boucliers) → déplacements (positions de départ)
 *  → marques (glyphes de début/fin de tour, pièges à l'entrée d'une case).
 */
import type { DataStore } from '../data/store'
import { Engine } from './engine'
import './effects/buffs'
import './effects/castspell'
import { installEffectCore } from './effects/core'
import { installDamageHooks } from './effects/damage'
import { installMarks } from './effects/marks'
import './effects/misc'
import { installMovement } from './effects/movement'
import './effects/special'
import './effects/summons'
import type { ScenarioHooks } from './types'

export function createEngine(data: DataStore, scenario?: ScenarioHooks): Engine {
  const engine = new Engine(data, scenario)
  installEffectCore(engine)
  installDamageHooks(engine)
  installMovement(engine)
  installMarks(engine)
  return engine
}

export { Engine } from './engine'
export { castSpell, canCast } from './cast'
export { move, reachableCells } from './move'
export { runFight, performAction, type Controller, type ControllerProvider } from './runner'
export { createMonsterFighter, createPlayerFighter } from './factory'
export { registeredEffects, unknownEffects } from './effects/registry'
