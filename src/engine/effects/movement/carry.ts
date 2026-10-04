/**
 * Porter / jeter (Pandawa, effets 50 / 51 ; mechanics.md §16, port D3 `Teleport.CarryFighter / ThrowFighter /
 * ReleaseFighter`).
 *
 *  - Porter : la cible (ni Indéplaçable, ni « CantBeCarried » (effet d'état 4 : Porteur, Lourd), monstre
 *    `canBeCarried`) rejoint la case du porteur ; états Porté (8) sur elle et Porteur (3) sur le porteur, durée
 *    infinie, non désenvoûtables. Chaque état est « lancé » par l'autre combattant avec `dispellable = 2` : la mort de
 *    l'un retire l'état de l'autre (Engine.kill), qui rompt aussi le lien `carrying` / `carriedBy`.
 *  - Le porté suit le porteur (téléportations : `setCell`) ; il est hors des zones de sort (Engine.fighterAt).
 *  - Jeter : le porté est posé sur la case ciblée (libre et marchable), les deux états sont retirés, puis la case
 *    déclenche ses marques. Un porteur poussé lâche le porté sur sa case de départ (movement/drag.ts).
 *  - Libérer (téléportation du porté) : lien rompu, états retirés, sans déplacement.
 * Non géré ici : la dissipation de l'invisibilité du porteur / du porté (famille des états).
 */
import type { EffectData } from '../../../data/model'
import type { Engine } from '../../engine'
import type { Fighter, FightState } from '../../types'
import {
  cantBeMoved,
  enterCell,
  fireMoveTriggers,
  hasStateEffect,
  isFreeCell,
  monsterFlag,
  relocate,
  SE_CANT_BE_CARRIED,
  setCell,
  STATE_CARRIED,
  STATE_CARRIER,
} from './common'

function stateEffect(stateId: number): EffectData {
  return {
    effectId: 950,
    order: 0,
    diceNum: 0,
    diceSide: 0,
    value: stateId,
    duration: -1,
    delay: 0,
    random: 0,
    group: 0,
    targetMask: 'a,A',
    targetId: 0,
    triggers: 'I',
    // 2 = retiré à la mort de la source (l'autre combattant du couple porteur/porté).
    dispellable: 2,
    element: -1,
    zone: { shape: 'P', size: 0, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false },
  }
}

/** Effets synthétiques des états de portage (identité utilisée pour retrouver les buffs). */
export const CARRIER_STATE_EFFECT: EffectData = stateEffect(STATE_CARRIER)
export const CARRIED_STATE_EFFECT: EffectData = stateEffect(STATE_CARRIED)

function stateLabel(engine: Engine, fight: FightState, stateId: number): string {
  return fight.options.record ? (engine.data.state(stateId)?.name ?? `État ${stateId}`) : ''
}

function addCarryState(engine: Engine, fight: FightState, holder: Fighter, source: Fighter, effect: EffectData, spellId: number): void {
  engine.addBuff(fight, holder, {
    sourceId: source.id,
    spellId,
    effect,
    value: effect.value,
    remaining: -1,
    delay: 0,
    dispellable: false,
    stateId: effect.value,
    kind: 'stat',
    label: stateLabel(engine, fight, effect.value),
  })
}

function removeCarryState(engine: Engine, fight: FightState, holder: Fighter, effect: EffectData): void {
  for (let i = holder.buffs.length - 1; i >= 0; i--) {
    const b = holder.buffs[i]
    if (b !== undefined && b.effect === effect) engine.removeBuff(fight, holder, b.uid)
  }
}

/** La cible peut-elle être portée ? */
export function canBeCarried(engine: Engine, f: Fighter): boolean {
  return f.alive && !cantBeMoved(engine, f) && monsterFlag(engine, f, 'canBeCarried') && !hasStateEffect(engine, f, SE_CANT_BE_CARRIED)
}

/** `carrier` porte `target` (effet 50). Retourne vrai si le portage a eu lieu. */
export function carryFighter(engine: Engine, fight: FightState, carrier: Fighter, target: Fighter, spellId: number): boolean {
  if (!carrier.alive || target === carrier || !canBeCarried(engine, target)) return false
  if (carrier.carrying !== undefined || carrier.carriedBy !== undefined || target.carriedBy !== undefined || target.carrying !== undefined) return false
  carrier.carrying = target.id
  target.carriedBy = carrier.id
  const from = target.cell
  setCell(fight, target, carrier.cell)
  if (fight.options.record) engine.emit(fight, { t: 'teleport', target: target.id, from, to: carrier.cell })
  addCarryState(engine, fight, target, carrier, CARRIED_STATE_EFFECT, spellId)
  addCarryState(engine, fight, carrier, target, CARRIER_STATE_EFFECT, spellId)
  // Port : mouvement « FromPandawa » ⇒ déclencheur TP sur le porté.
  fireMoveTriggers(engine, fight, target, 'TP', carrier)
  return true
}

/** Rompt le lien de portage et retire les deux états (sans déplacer personne). */
function unlink(engine: Engine, fight: FightState, carrier: Fighter, carried: Fighter): void {
  carrier.carrying = undefined
  carried.carriedBy = undefined
  removeCarryState(engine, fight, carrier, CARRIER_STATE_EFFECT)
  removeCarryState(engine, fight, carried, CARRIED_STATE_EFFECT)
}

/**
 * `carrier` jette l'entité qu'il porte sur `cell` (effet 51 ; `cell` = case du porteur pour un lâcher). Retourne
 * l'entité jetée, ou undefined (rien à jeter, case occupée ou non marchable).
 */
export function throwCarried(engine: Engine, fight: FightState, carrier: Fighter, cell: number, author: Fighter | undefined): Fighter | undefined {
  if (carrier.carrying === undefined) return undefined
  const carried = fight.fighters[carrier.carrying]
  if (carried === undefined || !carried.alive) {
    carrier.carrying = undefined
    removeCarryState(engine, fight, carrier, CARRIER_STATE_EFFECT)
    return undefined
  }
  if (cell !== carrier.cell && !isFreeCell(engine, fight, cell)) return undefined
  carried.cell = carrier.cell
  unlink(engine, fight, carrier, carried)
  if (cell !== carried.cell) relocate(engine, fight, carried, cell)
  else setCell(fight, carried, cell)
  enterCell(engine, fight, carried, cell)
  fireMoveTriggers(engine, fight, carried, 'M', author)
  return carried
}

/** Libère `carried` de son porteur (téléportation du porté, port `ReleaseFighter`). */
export function releaseCarried(engine: Engine, fight: FightState, carried: Fighter): void {
  if (carried.carriedBy === undefined) return
  const carrier = fight.fighters[carried.carriedBy]
  if (carrier === undefined) {
    carried.carriedBy = undefined
    return
  }
  carried.cell = carrier.cell
  unlink(engine, fight, carrier, carried)
}
