/**
 * Cases de lancer (docs/design/ai.md §6.2, §8.1 C1/C6/C7) — WP1.
 *
 *  - `inverseRange(g, cible)` : cases d'où la cible est dans la PORTÉE d'un sort de géométrie `g` (même règle que
 *    `isInCastRange`, symétrique) ; précalculé et mis en cache par (géométrie, case), trié par distance.
 *  - `LosOracle` : ligne de vue selon la règle de `canCast` (cases intermédiaires transparentes et inoccupées sauf
 *    par le lanceur, case cible transparente), positions vues par l'équipe, mémoïsée par (départ, cible).
 *  - `castFailureStatic` : filtre C1 (PA, relance, lancers par tour, états du lanceur, preventsSpellCast).
 *  - `castCellsFor` : intersection anneau inverse ∩ `reach` (PA restants à l'arrivée, LdV, case libre/occupée,
 *    lancers par cible) : toutes les cases d'où le lancer est valide APRÈS le déplacement.
 */
import type { TeamId } from '../../core/types'
import type { SpellLevelData, ZoneSpec } from '../../data/model'
import { checkStatesCriterion } from '../../engine/criteria'
import type { CastFailure } from '../../engine/cast'
import { modifiedSpellLevel } from '../../engine/effects/buffs/spellMods'
import type { Engine } from '../../engine/engine'
import type { Fighter, FightState, KnownSpell } from '../../engine/types'
import { CELL_COUNT, distance, isInCastRange } from '../../map/geometry'
import { zoneMembership } from '../../map/zones'
import { losLine } from '../../map/los'
import type { ReachInfo } from '../types'
import { buildOccupancy } from './reach'

// ───────────────────────────── portée inverse ─────────────────────────────

/** Géométrie de lancer résolue pour un lanceur (bonus de PO compris). */
export interface CastGeom { min: number; max: number; line: boolean; diag: boolean }

/** Géométrie d'un niveau de sort (déjà modifié) pour `caster` : même calcul que `spellRange` (cast.ts). */
export function castGeom(caster: Fighter, lvl: SpellLevelData): CastGeom {
  const bonus = lvl.rangeBoostable ? caster.stats.range : 0
  return { min: lvl.minRange, max: Math.max(lvl.minRange, lvl.range + bonus), line: lvl.castInLine, diag: lvl.castInDiagonal }
}

const RING_CACHE = new Map<number, (Int16Array | undefined)[]>()

function geomKey(g: CastGeom): number {
  const max = Math.max(0, Math.min(127, g.max))
  const min = Math.max(0, Math.min(127, g.min))
  return ((min * 128 + max) * 2 + (g.line ? 1 : 0)) * 2 + (g.diag ? 1 : 0)
}

/** Cases d'où `target` est à portée (géométrie seule), triées par distance puis id. Vue en lecture seule. */
export function inverseRange(g: CastGeom, target: number): Int16Array {
  const k = geomKey(g)
  let row = RING_CACHE.get(k)
  if (!row) RING_CACHE.set(k, (row = new Array(CELL_COUNT)))
  let ring = row[target]
  if (!ring) {
    const list: number[] = []
    for (let c = 0; c < CELL_COUNT; c++) if (isInCastRange(c, target, g.min, g.max, g.line, g.diag)) list.push(c)
    list.sort((a, b) => distance(a, target) - distance(b, target) || a - b)
    row[target] = ring = Int16Array.from(list)
  }
  return ring
}

// ───────────────────────────── ligne de vue ─────────────────────────────

/** Cases opaques d'une carte (1 = bloque la ligne de vue), calculées une fois par carte. */
const OPAQUE = new WeakMap<object, Uint8Array>()
function opaqueOf(s: FightState): Uint8Array {
  let op = OPAQUE.get(s.map)
  if (!op) {
    op = new Uint8Array(CELL_COUNT)
    const cells = s.map.cells
    for (let c = 0; c < CELL_COUNT; c++) {
      const mc = cells[c]
      op[c] = !mc || !mc.los ? 1 : 0
    }
    OPAQUE.set(s.map, op)
  }
  return op
}

/**
 * Ligne de vue selon `canCast` pour un lanceur sur un état figé (positions vues par `team`) : cases intermédiaires
 * transparentes et inoccupées (le lanceur ne bloque jamais : il aura quitté sa case), case cible transparente. Cases
 * opaques de la carte (calculées une fois par carte) + occupation, lignes précalculées du client (`losLine`) :
 * construction en O(1), aucune allocation par requête. Une instance ne doit plus servir après une modification des
 * positions (l'occupation `occ` est lue, pas copiée).
 */
export class LosOracle {
  readonly occ: Int16Array
  /** 1 = case opaque. */
  private readonly opaque: Uint8Array

  constructor(readonly s: FightState, team: TeamId, readonly casterId: number, occ?: Int16Array) {
    this.occ = occ ?? buildOccupancy(s, team)
    this.opaque = opaqueOf(s)
  }

  los(from: number, to: number): boolean {
    const op = this.opaque
    if (from === to) return op[to] === 0
    const line = losLine(from, to)
    const end = line.length - 1
    const o = this.occ
    const me = this.casterId
    for (let i = 0; i < end; i++) {
      const c = line[i]
      if (op[c]) return false
      const id = o[c]
      if (id >= 0 && id !== me) return false
    }
    return end >= 0 && op[to] === 0
  }
}

// ───────────────────────────── validité d'un lancer ─────────────────────────────

/**
 * Filtre statique C1 (sans géométrie) : mêmes tests que `canCast` pour les PA (`ap` disponibles), la relance, les
 * lancers par tour, les états du lanceur et `preventsSpellCast`. `lvl` = niveau modifié (`modifiedSpellLevel`).
 */
export function castFailureStatic(engine: Engine, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, ap: number = caster.ap): CastFailure | null {
  if (!caster.alive) return 'dead'
  if (ap < lvl.apCost) return 'ap'
  if ((caster.cooldowns[spell.spellId] ?? 0) > 0) return 'cooldown'
  if (lvl.maxCastPerTurn > 0 && (caster.castsThisTurn[spell.spellId] ?? 0) >= lvl.maxCastPerTurn) return 'maxPerTurn'
  if (!checkStatesCriterion(lvl.statesCriterion, caster)) return 'state'
  if (engine.stateFlag(caster, 'preventsSpellCast')) return 'state'
  return null
}

/**
 * Filtre statique pour le PROCHAIN tour du lanceur (relances décrémentées d'un tour, compteurs remis à zéro) : PA du
 * prochain tour, états, preventsSpellCast (états actuels).
 */
export function nextTurnStaticOk(engine: Engine, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, ap: number): boolean {
  if (ap < lvl.apCost) return false
  if ((caster.cooldowns[spell.spellId] ?? 0) > 1) return false
  if (!checkStatesCriterion(lvl.statesCriterion, caster)) return false
  return !engine.stateFlag(caster, 'preventsSpellCast')
}

/** Niveau du sort tel que vu par le lanceur (modificateurs appliqués). */
export function levelFor(caster: Fighter, spell: KnownSpell): SpellLevelData {
  return modifiedSpellLevel(caster, spell.level)
}

/** Occupant de `cell` une fois le lanceur arrivé sur `from` (−1 si libre). */
export function occupantAfterMove(occ: Int16Array, casterId: number, casterCell: number, from: number, cell: number): number {
  if (cell === from) return casterId
  const id = occ[cell]
  if (id === casterId && cell === casterCell && from !== casterCell) return -1
  return id
}

/**
 * Le lancer de `spell` (niveau `lvl`) depuis `from` sur `target` est-il valide une fois le lanceur sur `from` ?
 * Géométrie, case marchable, case libre/occupée, lancers par cible, ligne de vue. (PA et filtres statiques : à tester
 * avant, cf. `castFailureStatic`.)
 */
export function castGeometryOk(s: FightState, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, g: CastGeom,
                               from: number, target: number, los: LosOracle, nextTurn = false): boolean {
  const mc = s.map.cells[target]
  if (!mc) return false
  if (!isInCastRange(from, target, g.min, g.max, g.line, g.diag)) return false
  const occId = occupantAfterMove(los.occ, caster.id, caster.cell, from, target)
  // Case non marchable : ciblable seulement si une entité y a été posée (Auroraire du Vortex), comme `canCast`.
  if (!mc.walkable && occId < 0) return false
  if (lvl.needFreeCell && occId >= 0 && occId !== caster.id) return false
  if (lvl.needFreeCell && from !== caster.cell && target === from) return false
  if (lvl.needTakenCell && occId < 0) return false
  if (!nextTurn && lvl.maxCastPerTarget > 0 && occId >= 0) {
    if ((caster.castsOnTarget[`${spell.spellId}:${occId}`] ?? 0) >= lvl.maxCastPerTarget) return false
  }
  if (lvl.castTestLos && distance(from, target) > 1 && !los.los(from, target)) return false
  return true
}

/**
 * Cases de `reach` d'où le lancer sur `target` est valide (PA restants à l'arrivée ≥ coût), dans l'ordre de l'anneau
 * inverse (distance à la cible croissante) ; au plus `limit` cases. La case actuelle est testée en premier.
 */
export function castCellsFor(s: FightState, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, target: number,
                             reach: ReachInfo, los: LosOracle, limit = CELL_COUNT, out: number[] = [], nextTurn = false): number[] {
  out.length = 0
  const g = castGeom(caster, lvl)
  const cost = lvl.apCost
  const start = reach.count > 0 ? reach.cells[0] : caster.cell
  // Rejet rapide : toute case atteignable est à ≤ PM du départ, toute case de lancer à ≤ PO de la cible.
  if (start >= 0 && reach.count > 0 && distance(start, target) > reach.mpLeft[start] + g.max) return out
  if (start >= 0 && reach.apLeft[start] >= cost && castGeometryOk(s, caster, spell, lvl, g, start, target, los, nextTurn)) {
    out.push(start)
    if (out.length >= limit) return out
  }
  const ring = inverseRange(g, target)
  if (ring.length <= reach.count * 2) {
    for (let i = 0; i < ring.length; i++) {
      const c = ring[i]
      if (c === start || reach.mpLeft[c] < 0 || reach.apLeft[c] < cost) continue
      if (!castGeometryOk(s, caster, spell, lvl, g, c, target, los, nextTurn)) continue
      out.push(c)
      if (out.length >= limit) break
    }
  } else {
    for (let i = 0; i < reach.count; i++) {
      const c = reach.cells[i]
      if (c === start || reach.apLeft[c] < cost) continue
      if (!castGeometryOk(s, caster, spell, lvl, g, c, target, los, nextTurn)) continue
      out.push(c)
      if (out.length >= limit) break
    }
  }
  return out
}

/**
 * Un sort de portée 0 à zone (lancé sur la case du lanceur : Cercle de feu, Cri de Guerre…) touche-t-il `target`
 * quand le lanceur est sur `from` ? Zone centrée sur `from`, orientation neutre.
 */
export function selfZoneHits(zone: ZoneSpec, radius: number, from: number, target: number): boolean {
  if (from === target || distance(from, target) > radius) return false
  return zoneMembership(zone, from, from)(target)
}

/**
 * Case de `reach` d'où le sort ATTEINT l'entité sur `target` (menace, potentiel) : sort ciblé ⇒ `firstCastCell`
 * (portée, LdV, case occupée) ; sort de portée 0 à zone ⇒ case atteignable (PA suffisants) dont la zone autour du
 * lanceur contient `target`. −1 si aucune. `zone`/`radius` : zone principale du profil (null/0 si monocible).
 */
export function hitCastCell(s: FightState, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, zone: ZoneSpec | null,
                            radius: number, target: number, reach: ReachInfo, los: LosOracle, nextTurn = false): number {
  const g = castGeom(caster, lvl)
  if (g.max > 0 || !zone || radius <= 0) return firstCastCell(s, caster, spell, lvl, target, reach, los, nextTurn)
  const cost = lvl.apCost
  for (let i = 0; i < reach.count; i++) {
    const c = reach.cells[i]
    if (reach.apLeft[c] < cost || !selfZoneHits(zone, radius, c, target)) continue
    return c
  }
  return -1
}

/** Première case de `reach` d'où `spell` peut toucher `target` (−1 si aucune). */
export function firstCastCell(s: FightState, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, target: number,
                              reach: ReachInfo, los: LosOracle, nextTurn = false): number {
  const tmp = FIRST
  castCellsFor(s, caster, spell, lvl, target, reach, los, 1, tmp, nextTurn)
  return tmp.length ? tmp[0] : -1
}
const FIRST: number[] = []
