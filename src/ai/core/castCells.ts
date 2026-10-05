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
import { castPreventedByStates, type CastFailure } from '../../engine/cast'
import { modifiedSpellLevel } from '../../engine/effects/buffs/spellMods'
import type { Engine } from '../../engine/engine'
import type { Fighter, FightState, KnownSpell } from '../../engine/types'
import { CELL_COUNT, cellsByDistance, distance, isInCastRange } from '../../map/geometry'
import { isCellInZone } from '../../map/zones'
import { hasLineOfSightOcc } from '../../map/los'
import type { ReachInfo } from '../types'
import { buildOccupancy } from './reach'
import type { SpellProfileX } from './spellProfile'

// ───────────────────────────── portée inverse ─────────────────────────────

/** Géométrie de lancer résolue pour un lanceur (bonus de PO compris). */
export interface CastGeom { min: number; max: number; line: boolean; diag: boolean }

/** Géométrie d'un niveau de sort (déjà modifié) pour `caster` : même calcul que `spellRange` (cast.ts). */
export function castGeom(caster: Fighter, lvl: SpellLevelData): CastGeom {
  const bonus = lvl.rangeBoostable ? caster.stats.range : 0
  return { min: lvl.minRange, max: Math.max(lvl.minRange, lvl.range + bonus), line: lvl.castInLine, diag: lvl.castInDiagonal }
}

/** `castGeom` écrit dans `out` (tampon d'une fonction feuille non réentrante : aucune allocation). */
function castGeomInto(caster: Fighter, lvl: SpellLevelData, out: CastGeom): CastGeom {
  const bonus = lvl.rangeBoostable ? caster.stats.range : 0
  out.min = lvl.minRange
  out.max = Math.max(lvl.minRange, lvl.range + bonus)
  out.line = lvl.castInLine
  out.diag = lvl.castInDiagonal
  return out
}
const GEOM_CCF: CastGeom = { min: 0, max: 0, line: false, diag: false }
const GEOM_HITS: CastGeom = { min: 0, max: 0, line: false, diag: false }

const RING_CACHE = new Map<number, (Int16Array | undefined)[]>()
/**
 * Géométries non entières (PO fractionnaire d'un clone en mode 'average') ou négatives : clé texte EXACTE (rare). Une
 * clé numérique les confondait avec une géométrie entière (ex. {max 5.25} et {max 5, diag}) : l'anneau mis en cache
 * par l'une servait à l'autre — cases manquantes, ou cases hors de portée acceptées par `castCellsFor` qui ne revérifie
 * pas la portée sur un anneau de géométrie entière (tests/engine-perf-regressions.test.ts).
 */
const RING_CACHE_INEXACT = new Map<string, (Int16Array | undefined)[]>()

/** Portées entières positives : la clé numérique est exacte (au-delà de 127, aucune case de plus : bornage sans effet). */
function exactGeom(g: CastGeom): boolean {
  return Number.isInteger(g.min) && Number.isInteger(g.max) && g.min >= 0 && g.max >= 0
}

function geomKey(g: CastGeom): number {
  const max = Math.min(127, g.max)
  const min = Math.min(127, g.min)
  return ((min * 128 + max) * 2 + (g.line ? 1 : 0)) * 2 + (g.diag ? 1 : 0)
}

function ringRow(g: CastGeom): (Int16Array | undefined)[] {
  if (exactGeom(g)) {
    const k = geomKey(g)
    let row = RING_CACHE.get(k)
    if (!row) RING_CACHE.set(k, (row = new Array(CELL_COUNT)))
    return row
  }
  const k = `${g.min}|${g.max}|${g.line ? 1 : 0}|${g.diag ? 1 : 0}`
  let row = RING_CACHE_INEXACT.get(k)
  if (!row) RING_CACHE_INEXACT.set(k, (row = new Array(CELL_COUNT)))
  return row
}

/** Cases d'où `target` est à portée (géométrie seule), triées par distance puis id. Vue en lecture seule. */
export function inverseRange(g: CastGeom, target: number): Int16Array {
  const row = ringRow(g)
  let ring = row[target]
  if (!ring) {
    if (target >= 0 && target < CELL_COUNT) {
      // Parcours des cases par (distance, id) croissants depuis la cible (ordre précalculé) : déjà trié. Une case à
      // portée est à une distance de Manhattan ≤ 2 × max (diagonale : r pas = 2r) : arrêt au-delà.
      const order = cellsByDistance(target)
      const bound = 2 * g.max
      let n = 0
      for (let i = 0; i < CELL_COUNT; i++) {
        const c = order[i]
        if (distance(c, target) > bound) break
        if (isInCastRange(c, target, g.min, g.max, g.line, g.diag)) RING_TMP[n++] = c
      }
      ring = RING_TMP.slice(0, n)
    } else {
      ring = new Int16Array(0)
    }
    row[target] = ring
  }
  return ring
}
const RING_TMP = new Int16Array(CELL_COUNT)

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
    if (from === to) return this.opaque[to] === 0
    // Lignes précalculées du client lues depuis la cible (table en cache pour une cible fixe), occupation sans fermeture :
    // intermédiaires transparentes et non occupées par une autre entité que le lanceur, cible transparente.
    return hasLineOfSightOcc(this.opaque, from, to, this.occ, this.casterId)
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
  if (castPreventedByStates(engine, caster, lvl.statesCriterion)) return 'state'
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
  return !castPreventedByStates(engine, caster, lvl.statesCriterion)
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
                               from: number, target: number, los: LosOracle, nextTurn = false, perTargetChecked = false): boolean {
  const mc = s.map.cells[target]
  if (!mc) return false
  if (!isInCastRange(from, target, g.min, g.max, g.line, g.diag)) return false
  const occId = occupantAfterMove(los.occ, caster.id, caster.cell, from, target)
  // Case non marchable : ciblable seulement si une entité y a été posée (Auroraire du Vortex), comme `canCast`.
  if (!mc.walkable && occId < 0) return false
  if (lvl.needFreeCell && occId >= 0 && occId !== caster.id) return false
  if (lvl.needFreeCell && from !== caster.cell && target === from) return false
  if (lvl.needTakenCell && occId < 0) return false
  // Lancers par cible ≤ lancers du tour (castSpell incrémente les deux) : clé chaînée seulement si le sort a déjà servi.
  if (!nextTurn && !perTargetChecked && lvl.maxCastPerTarget > 0 && occId >= 0 && (caster.castsThisTurn[spell.spellId] ?? 0) > 0) {
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
  const g = castGeomInto(caster, lvl, GEOM_CCF)
  const cost = lvl.apCost
  const start = reach.count > 0 ? reach.cells[0] : caster.cell
  // Rejet rapide : toute case atteignable est à ≤ PM du départ, toute case de lancer à ≤ PO de la cible.
  if (start >= 0 && reach.count > 0 && distance(start, target) > reach.mpLeft[start] + g.max) return out
  // Lancers par cible (C1) : une autre entité sur la cible est la même pour toutes les cases de lancer — testé une fois.
  let perTarget = false
  const occT = target >= 0 && target < CELL_COUNT ? los.occ[target] : -1
  if (!nextTurn && lvl.maxCastPerTarget > 0 && occT >= 0 && occT !== caster.id) {
    if ((caster.castsThisTurn[spell.spellId] ?? 0) > 0 && (caster.castsOnTarget[`${spell.spellId}:${occT}`] ?? 0) >= lvl.maxCastPerTarget) return out
    perTarget = true
  }
  // Case cible absente de la carte : `castGeometryOk` est faux pour toute case de lancer.
  const mc = s.map.cells[target]
  if (!mc) return out
  const x = targetCtx(caster, spell, lvl, g, target, mc.walkable, los, nextTurn, perTarget)
  if (start >= 0 && reach.apLeft[start] >= cost && fromOk(x, start, false)) {
    out.push(start)
    if (out.length >= limit) return out
  }
  const ring = inverseRange(g, target)
  if (ring.length <= reach.count * 2) {
    const mpLeft = reach.mpLeft
    const apLeft = reach.apLeft
    // Anneau ⇔ `isInCastRange` (clé de cache exacte pour toute géométrie, `ringRow`) ; par prudence, la portée n'est
    // pas revérifiée seulement pour les portées entières dans [0, 127] (PO fractionnaire d'un clone 'average' : revérifiée).
    const exactRing = Number.isInteger(g.min) && Number.isInteger(g.max) && g.min >= 0 && g.max >= 0 && g.min <= 127 && g.max <= 127
    for (let i = 0; i < ring.length; i++) {
      const c = ring[i]
      if (c === start || mpLeft[c] < 0 || apLeft[c] < cost) continue
      if (!fromOk(x, c, exactRing)) continue
      out.push(c)
      if (out.length >= limit) break
    }
  } else {
    for (let i = 0; i < reach.count; i++) {
      const c = reach.cells[i]
      if (c === start || reach.apLeft[c] < cost) continue
      if (!fromOk(x, c, false)) continue
      out.push(c)
      if (out.length >= limit) break
    }
  }
  return out
}

/**
 * Invariants de `castGeometryOk` pour une cible fixe (une instance de module : `castCellsFor` n'est pas réentrante) :
 * occupant de la cible, contraintes de case, compteur par cible, LdV. `fromOk(x, c)` ⇔ `castGeometryOk(…, c, target, …)`.
 */
interface TargetCtx {
  g: CastGeom
  target: number
  walkable: boolean
  casterId: number
  casterCell: number
  occT: number
  needFree: boolean
  needTaken: boolean
  checkPerTarget: boolean
  spellId: number
  maxPerTarget: number
  castsOnTarget: Record<string, number>
  testLos: boolean
  los: LosOracle | null
}
const TCTX: TargetCtx = {
  g: GEOM_CCF, target: 0, walkable: false, casterId: 0, casterCell: 0, occT: -1, needFree: false, needTaken: false,
  checkPerTarget: false, spellId: 0, maxPerTarget: 0, castsOnTarget: {}, testLos: false, los: null,
}

function targetCtx(caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, g: CastGeom, target: number, walkable: boolean,
                   los: LosOracle, nextTurn: boolean, perTargetChecked: boolean): TargetCtx {
  const x = TCTX
  x.g = g
  x.target = target
  x.walkable = walkable
  x.casterId = caster.id
  x.casterCell = caster.cell
  x.occT = los.occ[target]
  x.needFree = !!lvl.needFreeCell
  x.needTaken = !!lvl.needTakenCell
  // Compteur par cible (castSpell incrémente lancers du tour et par cible) : seulement si le sort a déjà servi ce tour.
  x.checkPerTarget = !nextTurn && !perTargetChecked && lvl.maxCastPerTarget > 0 && (caster.castsThisTurn[spell.spellId] ?? 0) > 0
  x.spellId = spell.spellId
  x.maxPerTarget = lvl.maxCastPerTarget
  x.castsOnTarget = caster.castsOnTarget
  x.testLos = !!lvl.castTestLos
  x.los = los
  return x
}

/** `castGeometryOk` depuis `from` vers la cible de `x` (même ordre de tests, invariants précalculés). */
function fromOk(x: TargetCtx, from: number, rangeChecked: boolean): boolean {
  const target = x.target
  const g = x.g
  if (!rangeChecked && !isInCastRange(from, target, g.min, g.max, g.line, g.diag)) return false
  // `occupantAfterMove(occ, casterId, casterCell, from, target)`.
  let occId = x.occT
  if (target === from) occId = x.casterId
  else if (occId === x.casterId && target === x.casterCell && from !== x.casterCell) occId = -1
  if (!x.walkable && occId < 0) return false
  if (x.needFree && occId >= 0 && occId !== x.casterId) return false
  if (x.needFree && from !== x.casterCell && target === from) return false
  if (x.needTaken && occId < 0) return false
  if (x.checkPerTarget && occId >= 0 && (x.castsOnTarget[`${x.spellId}:${occId}`] ?? 0) >= x.maxPerTarget) return false
  if (x.testLos && distance(from, target) > 1 && !x.los!.los(from, target)) return false
  return true
}

/**
 * Un sort de portée 0 à zone (lancé sur la case du lanceur : Cercle de feu, Cri de Guerre…) touche-t-il `target`
 * quand le lanceur est sur `from` ? Zone centrée sur `from`, orientation neutre.
 */
export function selfZoneHits(zone: ZoneSpec, radius: number, from: number, target: number): boolean {
  if (from === target || distance(from, target) > radius) return false
  return isCellInZone(zone, target, from, from)
}

/**
 * Case de `reach` d'où le sort ATTEINT l'entité sur `target` (menace, potentiel) : sort ciblé ⇒ `firstCastCell`
 * (portée, LdV, case occupée) ; sort de portée 0 à zone ⇒ case atteignable (PA suffisants) dont la zone autour du
 * lanceur contient `target`. −1 si aucune. `zone`/`radius` : zone principale du profil (null/0 si monocible).
 */
export function hitCastCell(s: FightState, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, zone: ZoneSpec | null,
                            radius: number, target: number, reach: ReachInfo, los: LosOracle, nextTurn = false,
                            prof?: SpellProfileX | null): number {
  const g = castGeom(caster, lvl)
  if (g.max > 0 || !zone || radius <= 0) {
    if (prof && prof.aim !== 'direct') {
      hitCellsFor(s, caster, spell, lvl, prof, target, reach, los, 1, FIRST, nextTurn)
      return FIRST.length ? FIRST[0] : -1
    }
    return firstCastCell(s, caster, spell, lvl, target, reach, los, nextTurn)
  }
  const cost = lvl.apCost
  for (let i = 0; i < reach.count; i++) {
    const c = reach.cells[i]
    if (reach.apLeft[c] < cost || !selfZoneHits(zone, radius, c, target)) continue
    return c
  }
  return -1
}

/** Cases visées autour d'une entité pour un sort « couronne » (distance 1-2, triées) : mémo par case. */
const RING_AIMS = new Map<number, Int16Array>()
function ringAims(target: number): Int16Array {
  let a = RING_AIMS.get(target)
  if (!a) {
    const list: number[] = []
    for (let c = 0; c < CELL_COUNT; c++) {
      const d = distance(c, target)
      if (d >= 1 && d <= 2) list.push(c)
    }
    list.sort((x, y) => distance(x, target) - distance(y, target) || x - y)
    RING_AIMS.set(target, (a = Int16Array.from(list)))
  }
  return a
}
const AIM_CELLS: number[] = []

/**
 * Cases de `reach` d'où le sort INFLIGE ses dégâts à l'entité sur `target`, selon la visée du profil (`prof.aim`,
 * spellProfile.ts) — dans l'ordre de découverte, au plus `limit` :
 *  - 'direct' : cases de lancer sur `target` (`castCellsFor`) ;
 *  - 'ring' : cases de lancer sur une case voisine t (distance 1-2 de `target`) dont la zone « couronne » (`ringZone`,
 *    orientée depuis la case de lancer) couvre `target` (Fourvoiement, Brimade, Souffle, Vajra, Propulsion…) ;
 *  - 'around' : cases d'où un lancer sur sa PROPRE case est valide et dont la zone « autour du lanceur »
 *    (`aroundZone`) couvre `target` (Jormun).
 * Les sorts de portée 0 à zone passent par `hitCastCell` (zone autour du lanceur).
 */
export function hitCellsFor(s: FightState, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, prof: SpellProfileX | null | undefined,
                            target: number, reach: ReachInfo, los: LosOracle, limit = CELL_COUNT, out: number[] = [], nextTurn = false): number[] {
  const g = castGeom(caster, lvl)
  if (prof && g.max === 0 && prof.zone && prof.zoneRadius > 0) {
    // Portée 0 à zone (Cri de Guerre, Glacier, Tibia…) : lancé sur sa propre case, la zone autour du lanceur touche.
    out.length = 0
    const cost = lvl.apCost
    for (let i = 0; i < reach.count && out.length < limit; i++) {
      const c = reach.cells[i]
      if (reach.apLeft[c] < cost || !selfZoneHits(prof.zone, prof.zoneRadius, c, target)) continue
      if (!castGeometryOk(s, caster, spell, lvl, g, c, c, los, nextTurn)) continue
      out.push(c)
    }
    return out
  }
  if (!prof || prof.aim === 'direct') return castCellsFor(s, caster, spell, lvl, target, reach, los, limit, out, nextTurn)
  out.length = 0
  if (prof.aim === 'ring' && prof.ringZone) {
    const zone = prof.ringZone
    const start = reach.count > 0 ? reach.cells[0] : caster.cell
    if (start >= 0 && reach.count > 0 && distance(start, target) > reach.mpLeft[start] + g.max + 2) return out
    const aims = ringAims(target)
    for (let k = 0; k < aims.length && out.length < limit; k++) {
      const t = aims[k]
      const mc = s.map.cells[t]
      if (!mc || (!mc.walkable && los.occ[t] < 0)) continue
      castCellsFor(s, caster, spell, lvl, t, reach, los, CELL_COUNT, AIM_CELLS, nextTurn)
      for (let i = 0; i < AIM_CELLS.length && out.length < limit; i++) {
        const c = AIM_CELLS[i]
        if (out.includes(c) || !isCellInZone(zone, target, t, c)) continue
        out.push(c)
      }
    }
    return out
  }
  if (prof.aim === 'around' && prof.aroundZone) {
    const zone = prof.aroundZone
    const cost = lvl.apCost
    for (let i = 0; i < reach.count && out.length < limit; i++) {
      const c = reach.cells[i]
      if (reach.apLeft[c] < cost || !isCellInZone(zone, target, c, c)) continue
      if (!castGeometryOk(s, caster, spell, lvl, g, c, c, los, nextTurn)) continue
      out.push(c)
    }
    return out
  }
  return castCellsFor(s, caster, spell, lvl, target, reach, los, limit, out, nextTurn)
}

/**
 * Un lancer de `spell` depuis `from` (lanceur supposé déjà sur `from`, PA non testés) inflige-t-il ses dégâts à
 * l'entité sur `target` ? Même visée que `hitCellsFor` (directe, couronne, autour du lanceur, portée 0 à zone).
 */
export function hitsFrom(s: FightState, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, prof: SpellProfileX | null | undefined,
                         from: number, target: number, los: LosOracle, nextTurn = false): boolean {
  const g = castGeomInto(caster, lvl, GEOM_HITS)
  if (prof && g.max === 0 && prof.zone && prof.zoneRadius > 0) {
    return selfZoneHits(prof.zone, prof.zoneRadius, from, target) && castGeometryOk(s, caster, spell, lvl, g, from, from, los, nextTurn)
  }
  if (!prof || prof.aim === 'direct') return castGeometryOk(s, caster, spell, lvl, g, from, target, los, nextTurn)
  if (prof.aim === 'ring' && prof.ringZone) {
    const aims = ringAims(target)
    for (let k = 0; k < aims.length; k++) {
      const t = aims[k]
      if (!isInCastRange(from, t, g.min, g.max, g.line, g.diag)) continue
      if (!isCellInZone(prof.ringZone, target, t, from)) continue
      if (castGeometryOk(s, caster, spell, lvl, g, from, t, los, nextTurn)) return true
    }
    return false
  }
  if (prof.aim === 'around' && prof.aroundZone) {
    return isCellInZone(prof.aroundZone, target, from, from) && castGeometryOk(s, caster, spell, lvl, g, from, from, los, nextTurn)
  }
  return castGeometryOk(s, caster, spell, lvl, g, from, target, los, nextTurn)
}

/** Première case de `reach` d'où `spell` peut toucher `target` (−1 si aucune). */
export function firstCastCell(s: FightState, caster: Fighter, spell: KnownSpell, lvl: SpellLevelData, target: number,
                              reach: ReachInfo, los: LosOracle, nextTurn = false): number {
  const tmp = FIRST
  castCellsFor(s, caster, spell, lvl, target, reach, los, 1, tmp, nextTurn)
  return tmp.length ? tmp[0] : -1
}
const FIRST: number[] = []
