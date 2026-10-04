/**
 * Outils communs des effets de déplacement (docs/research/mechanics.md §15-16, port D3 `HaxeFighter`,
 * `PushUtils`, `Teleport`) : immunités (effets d'état + drapeaux de monstres), changement de case (historique de
 * position, entité portée, événements de replay), déclencheurs de déplacement et entrée sur une case (marques).
 *
 * Historique de position (dans `Fighter.tags`, copié avec le combattant par `cloneFight`) :
 *  - `startCell`     : case de début de combat (effet 784), posée au premier début de tour si absente ;
 *  - `turnStartCell` : case au début du tour du combattant (effet 1099) ;
 *  - `prevCell`      : case occupée avant le dernier déplacement FORCÉ (poussée, téléportation, échange...) ;
 *  - `lastCell`      : case d'arrivée de ce dernier déplacement forcé (interne : détecte une marche ultérieure).
 * La marche (move.ts) ne passe pas par ce module : `previousCell` considère qu'un combattant qui n'est plus sur
 * `lastCell` (ou `startCell`) a marché depuis, et que sa position précédente est cette case (approximation : une
 * seule marche est vue entre deux déplacements forcés).
 */
import type { MonsterData } from '../../../data/model'
import type { Engine } from '../../engine'
import { bumpRev } from '../../rev'
import type { Fighter, FightState } from '../../types'

/** Famille du registre (diagnostic de couverture). */
export const FAMILY = 'movement'

// ───────────────────────────── états et effets d'état ─────────────────────────────

/** État « Porteur » (Pandawa). */
export const STATE_CARRIER = 3
/** État « Porté ». */
export const STATE_CARRIED = 8

/** Effets d'état (`StateEffectId` du port D3, mechanics.md §12). */
export const SE_CANT_BE_PUSHED = 0
export const SE_CANT_BE_MOVED = 3
export const SE_CANT_BE_CARRIED = 4
export const SE_CANT_USE_PORTALS = 17
export const SE_CANT_SWITCH_POSITION = 18
export const SE_INVULNERABLE_TO_PUSH = 26

/** Un état du combattant (non neutralisé par 952) porte-t-il l'effet d'état `effectId` ? */
export function hasStateEffect(engine: Engine, f: Fighter, effectId: number): boolean {
  const states = f.states
  if (states.length === 0) return false
  for (let i = 0; i < states.length; i++) {
    const s = states[i]
    if (f.disabledStates !== undefined && f.disabledStates.includes(s)) continue
    const ids = engine.data.state(s)?.effectsIds
    if (ids !== undefined && ids.includes(effectId)) return true
  }
  return false
}

/** Indéplaçable (effet d'état 3, drapeau `cantBeMoved`) : ni poussé, ni téléporté, ni échangé, ni porté. */
export function cantBeMoved(engine: Engine, f: Fighter): boolean {
  return f.states.length > 0 && (engine.stateFlag(f, 'cantBeMoved') || hasStateEffect(engine, f, SE_CANT_BE_MOVED))
}

/** Ne peut être ni poussé ni attiré (effet d'état 0 : Enraciné, Inébranlable, Feuillu...). */
export function cantBePushed(engine: Engine, f: Fighter): boolean {
  return f.states.length > 0 && (engine.stateFlag(f, 'cantBePushed') || hasStateEffect(engine, f, SE_CANT_BE_PUSHED))
}

/** Pas d'échange de place ni de téléportation « symétrique » (effet d'état 18 : Pesanteur, Enraciné). */
export function cantSwitchPosition(engine: Engine, f: Fighter): boolean {
  return f.states.length > 0 && (engine.stateFlag(f, 'cantSwitchPosition') || hasStateEffect(engine, f, SE_CANT_SWITCH_POSITION))
}

export function hasState(f: Fighter, stateId: number): boolean {
  return f.states.includes(stateId)
}

type MonsterFlag = 'canBePushed' | 'canSwitchPos' | 'canSwitchPosOnTarget' | 'canBeCarried' | 'canUsePortal'

/**
 * Drapeau intrinsèque d'un monstre (DofusDB) : `tags[flag]` s'il est booléen (posé par la fabrique ou un scénario),
 * sinon la donnée du monstre ; vrai pour les personnages et les doubles (pas d'id de monstre).
 */
export function monsterFlag(engine: Engine, f: Fighter, flag: MonsterFlag): boolean {
  const t = f.tags[flag]
  if (typeof t === 'boolean') return t
  if (f.monsterId === undefined) return true
  const m: MonsterData | undefined = engine.data.monster(f.monsterId)
  const v = m?.[flag]
  return v === undefined ? true : v
}

/** Le combattant ne peut infliger aucun dommage (Pacifiste : drapeau `cantDealDamage`). */
export function isPacifist(engine: Engine, f: Fighter): boolean {
  return f.states.length > 0 && engine.stateFlag(f, 'cantDealDamage')
}

// ───────────────────────────── cases ─────────────────────────────

/** Case libre pour un déplacement forcé : sur la carte, marchable, sans combattant vivant. */
export function isFreeCell(engine: Engine, fight: FightState, cell: number): boolean {
  if (cell < 0) return false
  const c = fight.map.cells[cell]
  return c !== undefined && c.walkable && engine.fighterAt(fight, cell) === undefined
}

export function isWalkable(fight: FightState, cell: number): boolean {
  if (cell < 0) return false
  const c = fight.map.cells[cell]
  return c !== undefined && c.walkable
}

/** Case réelle d'un combattant : un porté est sur la case de son porteur (la marche ne met pas à jour le porté). */
export function cellOf(fight: FightState, f: Fighter): number {
  if (f.carriedBy !== undefined) {
    const carrier = fight.fighters[f.carriedBy]
    if (carrier !== undefined && carrier.alive) return carrier.cell
  }
  return f.cell
}

// ───────────────────────────── historique de position ─────────────────────────────

function tagCell(f: Fighter, key: string): number | undefined {
  const v = f.tags[key]
  return typeof v === 'number' ? v : undefined
}

/** Case de début de combat (784) ; la case actuelle si inconnue. */
export function startCell(f: Fighter): number {
  return tagCell(f, 'startCell') ?? f.cell
}

/** Case de début de tour (1099) ; la case actuelle si inconnue. */
export function turnStartCell(f: Fighter): number {
  return tagCell(f, 'turnStartCell') ?? f.cell
}

/**
 * Position précédente (1100, `GetPendingPreviousPosition`) : case occupée avant le dernier déplacement, quel qu'il
 * soit. Un combattant qui n'est plus sur la case d'arrivée de son dernier déplacement forcé (ou sur sa case de
 * début de combat) a marché depuis : sa position précédente est cette case. La case actuelle si inconnue.
 */
export function previousCell(f: Fighter): number {
  const last = tagCell(f, 'lastCell') ?? tagCell(f, 'startCell')
  if (last !== undefined && last !== f.cell) return last
  return tagCell(f, 'prevCell') ?? f.cell
}

/**
 * Place `f` sur `to` en tenant l'historique (prevCell / lastCell, startCell si absent) ; l'entité portée par `f`
 * le suit (port `SetCurrentPositionCell`). Aucun événement, aucune marque : voir `relocate`.
 */
export function setCell(fight: FightState, f: Fighter, to: number): void {
  const from = f.cell
  if (f.tags.startCell === undefined) f.tags.startCell = from
  f.tags.prevCell = from
  f.tags.lastCell = to
  f.cell = to
  bumpRev(f) // E4
  if (f.carrying !== undefined) {
    const c = fight.fighters[f.carrying]
    if (c !== undefined && c.alive) {
      // Le porté est sur la case du porteur (sa propre `cell` peut être périmée après une marche du porteur).
      if (c.tags.startCell === undefined) c.tags.startCell = from
      c.tags.prevCell = from
      c.tags.lastCell = to
      c.cell = to
      bumpRev(c) // E4
    }
  }
}

/** Déplacement « instantané » (téléportation, échange, portail, jet) : `setCell` + événement `teleport`. */
export function relocate(engine: Engine, fight: FightState, f: Fighter, to: number): void {
  const from = f.cell
  setCell(fight, f, to)
  if (fight.options.record) {
    engine.emit(fight, { t: 'teleport', target: f.id, from, to })
    if (f.carrying !== undefined) engine.emit(fight, { t: 'teleport', target: f.carrying, from, to })
  }
}

/** Initialise les cases de début de combat manquantes et resynchronise les portés sur leur porteur. */
export function initPositions(fight: FightState): void {
  for (const x of fight.fighters) {
    if (!x.alive) continue
    if (x.carriedBy !== undefined) {
      const carrier = fight.fighters[x.carriedBy]
      if (carrier !== undefined && carrier.alive && x.cell !== carrier.cell) {
        x.cell = carrier.cell
        bumpRev(x) // E4
      }
    }
    if (x.tags.startCell === undefined && x.cell >= 0) x.tags.startCell = x.cell
  }
}

// ───────────────────────────── déclencheurs et marques ─────────────────────────────

/**
 * Type d'événement de déplacement subi (codes `triggers`, core.ts) : 'P' poussé, 'MA' attiré, 'MS' échangé,
 * 'TP' téléporté (port : porter, 4, 1100), 'M' autre déplacement (symétries, 1099, 784, jet, portail...).
 * Le code 'M' d'un buff correspond aussi à P / MA / MS / TP (core.ts) : un seul événement par déplacement.
 */
export type MoveEvent = 'P' | 'MA' | 'MS' | 'TP' | 'M'

/** Déclencheurs d'un déplacement : événement subi par `moved`, puis 'PO' (« déplace une entité ») sur l'auteur. */
export function fireMoveTriggers(engine: Engine, fight: FightState, moved: Fighter, type: MoveEvent, author: Fighter | undefined): void {
  if (fight.ended) return
  if (moved.alive) engine.trigger(fight, moved, { type, source: author })
  if (author !== undefined && author.alive && !fight.ended) engine.trigger(fight, author, { type: 'PO', source: author })
}

const FROM_DRAG = { fromDrag: true }

/**
 * Arrivée sur une case par un déplacement forcé (port `ExecuteMarks(fromDrag: true)` : poussée, téléportation,
 * échange, jet) : pièges, glyphes-auras... via `engine.hooks.onEnterCell` (effects/marks.ts). Avec `fromDrag`, les
 * marques n'utilisent pas les portails : ceux des déplacements forcés sont gérés ici (movement/portals.ts).
 */
export function enterCell(engine: Engine, fight: FightState, f: Fighter, cell: number): void {
  const hook = engine.hooks.onEnterCell
  if (hook === undefined || !f.alive || fight.ended || cell < 0 || f.cell !== cell) return
  hook(fight, f, cell, FROM_DRAG)
}
