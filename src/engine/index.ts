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
import { castSubSpell, installEffectCore } from './effects/core'
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
  installEquipmentPassives(engine)
  return engine
}

/**
 * Sorts passifs d'équipement (effet 1175 : Dofus, trophées, objets légendaires) : chaque sort est lancé sur son
 * porteur au début du combat, comme un sort de départ ; ses effets sont des buffs/déclencheurs gérés par le moteur.
 * Un sort passif absent des données extraites est ignoré.
 */
function installEquipmentPassives(engine: Engine): void {
  const prev = engine.hooks.onFightStart
  engine.hooks.onFightStart = fight => {
    prev?.(fight)
    for (const f of fight.fighters) {
      if (!f.alive || f.cell < 0 || !f.passiveSpells?.length) continue
      for (const spellId of f.passiveSpells) {
        if (!engine.data.spell(spellId)) continue
        castSubSpell(engine, fight, f, spellId, 0, f.cell, false, 0)
      }
    }
  }
}

export { Engine } from './engine'
export { castSpell, canCast } from './cast'
export { move, reachableCells } from './move'
export { runFight, performAction, type Controller, type ControllerProvider } from './runner'
export { createMonsterFighter, createPlayerFighter } from './factory'
export { registeredEffects, unknownEffects } from './effects/registry'
