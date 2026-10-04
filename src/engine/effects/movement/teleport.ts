/**
 * Téléportations et échanges de place — port D3 `Teleport.TeleportFighter / GetTeleportedPosition` et
 * `HaxeFighter.CanTeleport / CanSwitchPosition` (mechanics.md §15-16, effects.md §7.6) :
 *
 *  | effet | déplacé | destination |
 *  |---|---|---|
 *  | 4    | le lanceur | case ciblée si libre ; sinon (zone non ponctuelle) 1re case libre de la zone parcourue en chaîne depuis la case ciblée (Fulgurance : la plus proche de la cible) |
 *  | 8 / 1023 | le lanceur (la cible s'il est sur la case ciblée) | case ciblée : échange avec son occupant |
 *  | 784  | la cible | case de début de combat |
 *  | 1099 | la cible | case de début de tour |
 *  | 1100 | la cible | position précédente |
 *  | 1101 | la cible | case du lanceur (échange) |
 *  | 1104 | le lanceur | symétrique de sa case par rapport à la case ciblée |
 *  | 1105 | la cible | symétrique de sa case par rapport au lanceur |
 *  | 1106 | la cible | symétrique de sa case par rapport à la case ciblée |
 *
 * Case d'arrivée occupée : échange (« téléfrag ») si les deux combattants peuvent échanger (`CanSwitchPosition` :
 * aucun Porteur (3), pas d'Indéplaçable, pas de Pesanteur/Enraciné (effet d'état 18) pour les téléportations
 * « symétriques » 8 / 784 / 1099 / 1100 / 1104-1106, drapeaux de monstre `canSwitchPos` / `canSwitchPosOnTarget`),
 * sinon rien. 1023 échange toujours (échange forcé). Les deux entités échangées sont marquées `tags.telefragged`
 * (masque T, jusqu'au prochain lancer). Destination hors carte / non marchable / inchangée (sauf échanges) :
 * `tags.teleportedInvalid` (masque W). Téléporter un porté le libère ; un porteur emmène son porté.
 *
 * Écart assumé avec le port (calculateur d'aperçu du client) : un combattant Indéplaçable peut se téléporter
 * LUI-MÊME (lanceur = déplacé, hors échanges 8 / 1023 : 4, 784 sur soi...) — sinon l'Auroraire (Indéplaçable) ne
 * rejoindrait pas la case libre de l'heure suivante (4 de Décalage horaire) et le Vortex (Indéplaçable) ne
 * reviendrait pas à sa case de départ (*Action !*, 784), ce que décrivent les guides (vortex.md §6, §8.2 ; maps.md).
 * Pour l'échange forcé 1023 de Décalage horaire, c'est au contraire l'échec de `CanTeleport` (Indéplaçable) qui
 * envoie l'Auroraire vers l'occupant de la case de l'heure (port, destination de repli = case de la cible).
 *
 * Marques : la case d'arrivée du déplacé (sauf échanges 8 / 1023), PUIS celle du partenaire d'échange déclenchent
 * leurs marques ; un portail d'arrivée transporte le déplacé (port `ExecuteMarks` → `UsePortal`, portals.ts `arriveAt`).
 * Déclencheurs : 'MS' sur les deux échangés, sinon 'TP' (4, 1100) ou 'M' ; 'PO' sur le lanceur. Écart : le port
 * déclenche aussi 'TP' sur les deux échangés d'un 1100 (sortie `FightRollbackPreviousPosition` avec `SwappedWith`) ; ici
 * un seul événement 'MS' (qui satisfait les codes MS et M, pas TP) — un buff « TP » seul ne réagit pas à ce téléfrag.
 */
import type { ZoneSpec } from '../../../data/model'
import { CELL_X, CELL_Y, pointToCell } from '../../../map/geometry'
import { shapeChar, zoneCells } from '../../../map/zones'
import type { Engine } from '../../engine'
import type { Fighter, FightState } from '../../types'
import { releaseCarried } from './carry'
import { firstInChain } from './chain'
import {
  cantBeMoved,
  cantSwitchPosition,
  cellOf,
  fireMoveTriggers,
  hasState,
  isFreeCell,
  isWalkable,
  monsterFlag,
  previousCell,
  relocate,
  startCell,
  STATE_CARRIER,
  turnStartCell,
  type MoveEvent,
} from './common'
import { arriveAt } from './portals'

export const TELEPORT = 4
export const EXCHANGE = 8
export const EXCHANGE_FORCED = 1023
export const TO_FIGHT_START = 784
export const TO_TURN_START = 1099
export const TO_PREVIOUS = 1100
export const TELESWAP = 1101
export const MIRROR_CASTER = 1104
export const MIRROR_TARGET = 1105
export const MIRROR_IMPACT = 1106

/** Téléportations « d'échange » interdites par l'effet d'état 18 (`HaxeFighter.IsSwitchTeleport`). */
function isSwitchTeleport(effectId: number): boolean {
  return (
    effectId === MIRROR_CASTER ||
    effectId === MIRROR_TARGET ||
    effectId === MIRROR_IMPACT ||
    effectId === TO_FIGHT_START ||
    effectId === TO_TURN_START ||
    effectId === TO_PREVIOUS ||
    effectId === EXCHANGE
  )
}

function isExchange(effectId: number): boolean {
  return effectId === EXCHANGE || effectId === EXCHANGE_FORCED
}

/**
 * `HaxeFighter.CanTeleport` : `onTarget` = rôle de partenaire d'échange côté lanceur (`canSwitchPosOnTarget`) ;
 * `self` = le combattant se déplace lui-même (exception Indéplaçable, voir l'en-tête).
 */
export function canTeleport(engine: Engine, f: Fighter, effectId: number, onTarget: boolean, self: boolean): boolean {
  if (!self && cantBeMoved(engine, f)) return false
  if (isSwitchTeleport(effectId) && cantSwitchPosition(engine, f)) return false
  if (onTarget) return monsterFlag(engine, f, 'canSwitchPosOnTarget')
  if (!monsterFlag(engine, f, 'canSwitchPos')) return effectId === TELEPORT || effectId === EXCHANGE_FORCED
  return true
}

/** `HaxeFighter.CanSwitchPosition` : `f` accepte-t-il d'échanger sa place avec `switcher` ? */
export function canSwitchPosition(engine: Engine, f: Fighter, switcher: Fighter, effectId: number, onTarget: boolean): boolean {
  if (hasState(f, STATE_CARRIER) || hasState(switcher, STATE_CARRIER)) return false
  return canTeleport(engine, f, effectId, onTarget, false)
}

/** Case symétrique de `cell` par rapport à `center` (−1 hors carte). */
export function mirrorCell(cell: number, center: number): number {
  if (cell < 0 || center < 0) return -1
  return pointToCell(2 * CELL_X[center] - CELL_X[cell], 2 * CELL_Y[center] - CELL_Y[cell])
}

/** `Teleport.GetTeleportedPosition` : destination de `mover` (sa case actuelle si aucune). */
export function teleportDestination(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  mover: Fighter,
  effectId: number,
  targetCell: number,
  zone: ZoneSpec | undefined,
): number {
  const initial = mover.cell
  let cur = initial
  if (mover.alive && canTeleport(engine, mover, effectId, false, mover === caster && !isExchange(effectId))) {
    switch (effectId) {
      case TELEPORT:
        if (isFreeCell(engine, fight, targetCell)) cur = targetCell
        else if (zone !== undefined && shapeChar(zone.shape as string | number) !== 'P' && targetCell >= 0) {
          const c = firstInChain(targetCell, zoneCells(zone, targetCell, mover.cell), x => isFreeCell(engine, fight, x))
          if (c >= 0) cur = c
        }
        break
      case TO_FIGHT_START:
        cur = startCell(mover)
        break
      case TO_TURN_START:
        cur = turnStartCell(mover)
        break
      case TO_PREVIOUS:
        cur = previousCell(mover)
        break
      case TELESWAP:
        cur = caster.cell
        break
      case MIRROR_CASTER:
      case MIRROR_IMPACT:
        cur = mirrorCell(cur, targetCell)
        break
      case MIRROR_TARGET:
        cur = mirrorCell(cur, caster.cell)
        break
      case EXCHANGE:
      case EXCHANGE_FORCED:
        cur = targetCell
        break
    }
  }
  if (cur !== initial && cur >= 0) {
    const other = engine.fighterAt(fight, cur)
    if (other !== undefined && (hasState(mover, STATE_CARRIER) || hasState(other, STATE_CARRIER))) cur = initial
  }
  return cur
}

/** Arrivée d'un déplacement instantané : portail éventuel, puis marques de la case (pièges, auras...). */
function arrive(engine: Engine, fight: FightState, f: Fighter, author: Fighter): void {
  // Portail d'arrivée : voyage jusqu'à la sortie, dont les marques (hors portails) s'appliquent ensuite.
  arriveAt(engine, fight, f, author)
}

function markInvalid(f: Fighter): void {
  f.tags.teleportedInvalid = true
}

/**
 * Applique la téléportation `effectId` de `caster` à la cible `fighter` (`Teleport.TeleportFighter`).
 * Retourne vrai si au moins un combattant a changé de case.
 */
export function teleportFighter(
  engine: Engine,
  fight: FightState,
  caster: Fighter,
  fighter: Fighter,
  effectId: number,
  targetCell: number,
  zone?: ZoneSpec,
): boolean {
  let mover: Fighter
  let exchange: boolean
  if (effectId === TELEPORT || effectId === MIRROR_CASTER) {
    mover = caster
    exchange = true
  } else {
    exchange = isExchange(effectId)
    mover = exchange ? caster : fighter
  }
  if (exchange && mover.cell === targetCell) mover = fighter
  if (!mover.alive) return false
  // Un porté est sur la case de son porteur (case éventuellement périmée après une marche du porteur).
  if (mover.carriedBy !== undefined) mover.cell = cellOf(fight, mover)
  let dest = teleportDestination(engine, fight, caster, mover, effectId, targetCell, zone)
  if (dest === mover.cell && isExchange(effectId)) dest = fighter.cell
  if (dest === mover.cell && !exchange) {
    markInvalid(mover)
    return false
  }
  if (!isWalkable(fight, dest)) {
    markInvalid(mover)
    return false
  }
  const other = engine.fighterAt(fight, dest)
  if (other === mover) return false
  if (other !== undefined) {
    const ok =
      effectId === EXCHANGE_FORCED ||
      (canSwitchPosition(engine, other, mover, effectId, false) && canSwitchPosition(engine, mover, other, effectId, exchange))
    if (!ok) return false
  }
  if (mover.carriedBy !== undefined) releaseCarried(engine, fight, mover)
  const from = mover.cell
  if (other !== undefined) relocate(engine, fight, other, from)
  relocate(engine, fight, mover, dest)

  if (other !== undefined) {
    // Téléfrag (masque T) : les deux entités échangées.
    mover.tags.telefragged = true
    other.tags.telefragged = true
  }
  // Marques : celles du déplacé d'abord (sauf échanges 8 / 1023), puis celles du partenaire (ordre du port).
  if (!isExchange(effectId) && mover.cell === dest) arrive(engine, fight, mover, caster)
  if (other !== undefined) arrive(engine, fight, other, caster)
  if (other !== undefined) {
    fireMoveTriggers(engine, fight, other, 'MS', caster)
    fireMoveTriggers(engine, fight, mover, 'MS', caster)
  } else {
    const ev: MoveEvent = effectId === TELEPORT || effectId === TO_PREVIOUS ? 'TP' : 'M'
    fireMoveTriggers(engine, fight, mover, ev, caster)
  }
  return true
}

/**
 * Effet 4 appliqué à `mover` (le lanceur, ou l'invocation visée par un masque F, ex. Lapino de Mot d'Amitié) :
 * téléportation sur la case ciblée (ou 1re case libre de la zone). Retourne vrai si `mover` a bougé.
 */
export function teleportToCell(engine: Engine, fight: FightState, caster: Fighter, mover: Fighter, targetCell: number, zone: ZoneSpec | undefined): boolean {
  if (!mover.alive) return false
  if (mover.carriedBy !== undefined) mover.cell = cellOf(fight, mover)
  const dest = teleportDestination(engine, fight, caster, mover, TELEPORT, targetCell, zone)
  if (dest === mover.cell || !isFreeCell(engine, fight, dest)) return false
  if (mover.carriedBy !== undefined) releaseCarried(engine, fight, mover)
  relocate(engine, fight, mover, dest)
  arrive(engine, fight, mover, caster)
  fireMoveTriggers(engine, fight, mover, 'TP', caster)
  return true
}
