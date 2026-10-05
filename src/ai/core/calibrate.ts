/**
 * Mesure de la calibration du DPT analytique (docs/design/ai.md §6.4) — WP1.
 *
 * Calibration = rapport « dégâts simulés / DPT analytique » d'un combattant, bornée à [0,5 ; 2] et stockée dans
 * `data/ai/calibration.json` (déterminisme : jamais recalculée pendant un combat). Elle couvre ce que l'analytique ne
 * voit pas : états cumulés (Flèche Dévorante du Crâ), sorts qui se boostent eux-mêmes, dégâts différés dissipés par
 * la relance, bombes, portails…
 *
 * Protocole (micro-scénario « poutch » simplifié, sans IA de groupe) : le combattant seul contre un mannequin (monstre
 * réel aux PV énormes qui ne joue pas), `rollMode: 'average'`, `turns` tours ; à chaque tour, le sac à dos analytique
 * du reste du tour (`DptTableImpl.turn`, NON calibré) choisit les lancers, joués dans cet ordre depuis une case valide
 * (placement libre : le DPT est « sans contrainte de position ») ; puis `settleTurns` tours sans lancer pour que les
 * dégâts différés et poisons tombent. Rapport = PV retirés au mannequin / Σ DPT analytique des tours.
 *
 * Écart au design : le design mesure la calibration avec l'IA `fast` (16 graines) ; l'IA de groupe n'étant pas livrée,
 * le protocole joue les lancers du sac à dos (même rotation que celle que le DPT suppose). Déterministe : une graine.
 */
import type { MapData } from '../../data/model'
import { canCast, castSpell } from '../../engine/cast'
import type { Engine } from '../../engine/engine'
import { createMonsterFighter } from '../../engine/factory'
import type { Fighter, FightState } from '../../engine/types'
import { matchesTargetMask } from '../../engine/targetMask'
import { CELL_COUNT, distance } from '../../map/geometry'
import { zoneMembership } from '../../map/zones'
import { levelFor, selfZoneHits } from './castCells'
import { castDamage, createDptTable } from './dpt'
import { createSpellProfileIndex, zoneRadius } from './spellProfile'

/** Bornes de la calibration (§6.4). */
export const CALIBRATION_BOUNDS: readonly [number, number] = [0.5, 2]

export interface CalibrationOptions {
  map: MapData
  /** Mannequin : monstre réel (résistances) et grade. Défaut : Buboxor (3838) grade 5. */
  targetMonsterId?: number
  targetGrade?: number
  /** Case du mannequin (défaut 300). */
  targetCell?: number
  /** Tours de lancers (défaut 3) puis tours sans lancer (défaut 3). */
  turns?: number
  settleTurns?: number
}

export interface CalibrationMeasure {
  /** Σ des DPT analytiques (non calibrés) des tours de lancers. */
  analytic: number
  /** PV retirés au mannequin (lancers + dégâts différés / poisons des tours suivants). */
  simulated: number
  /** simulated / analytic, borné ; 1 si analytique nul. */
  ratio: number
  casts: number
  /** Lancers prévus par le sac à dos analytique (`casts` < `planned` : lancers impossibles à placer ou refusés). */
  planned: number
}

/** Case libre et marchable la plus proche de `to` à distance ≥ `minDist`. */
function nearestFree(fight: FightState, to: number, minDist: number): number {
  let best = -1
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!fight.map.cells[c]?.walkable || fight.fighters.some(f => f.alive && f.cell === c)) continue
    const d = distance(c, to)
    if (d < minDist) continue
    if (best < 0 || d < distance(best, to) || (d === distance(best, to) && c < best)) best = c
  }
  return best
}

/**
 * Place `me` (case modifiée directement : placement libre) d'où `spellId` touche l'entité sur `target` et renvoie la
 * case à viser, −1 si aucune. Même placement que celui que suppose le DPT « sans contrainte de position »
 * (`castDamage`) :
 *  - sort dont les dégâts portent sur la case d'impact : la case de l'entité est visée ;
 *  - sort dont les dégâts ne portent que sur la COURONNE de la zone (« croix sans centre » de Fourvoiement, Brimade,
 *    Souffle ; cercles « hors centre » de Vajra, Lance du Lac) ou qui exige une case LIBRE (Propulsion du Pandawa) :
 *    une case voisine est visée, de sorte qu'une ligne de dégâts de rayon ≥ 1 (masque accepté) couvre l'entité. Viser
 *    l'entité elle-même ne lui infligeait rien (ou était refusé) et faussait la calibration (0,5 pour la Forgelance,
 *    0,53 pour l'Éliotrope, 0,56 pour le Sram « air poisons »).
 * Distance lanceur → entité : 1 pour un sort de mêlée (portée ≤ 1), ≥ 2 sinon si possible (le moteur applique les
 * modificateurs de mêlée selon la distance réelle ; le DPT suppose « mêlée » ⇔ portée ≤ 1). Sort de portée 0 à zone :
 * case du lanceur, entité dans la zone.
 */
export function placeForCast(engine: Engine, fight: FightState, me: Fighter, spellId: number, target: number): number {
  const ks = me.spells.find(s => s.spellId === spellId)
  if (!ks) return -1
  const lvl = levelFor(me, ks)
  const prof = createSpellProfileIndex(engine).ofSpell(me, ks.level)
  // Cases libres (calculées à la demande : le cas courant — case actuelle valide — n'en a pas besoin).
  let freeCells: number[] | null = null
  const freeList = (): number[] => {
    if (!freeCells) {
      const occupied = new Set<number>()
      for (const f of fight.fighters) if (f.alive && f.id !== me.id) occupied.add(f.cell)
      freeCells = []
      for (let c = 0; c < CELL_COUNT; c++) if (fight.map.cells[c]?.walkable && !occupied.has(c)) freeCells.push(c)
    }
    return freeCells
  }
  const max = lvl.range + (lvl.rangeBoostable ? me.stats.range : 0)
  if (max === 0 && prof.zone && prof.zoneRadius > 0) {
    const free = freeList().sort((a, b) => distance(a, target) - distance(b, target) || a - b)
    for (const c of free) {
      if (!selfZoneHits(prof.zone, prof.zoneRadius, c, target)) continue
      me.cell = c
      if (canCast(engine, fight, me, ks, c) === null) return c
    }
    return -1
  }
  const want = max <= 1 ? 1 : 2
  // Distance lanceur → entité conforme à l'hypothèse « mêlée ⇔ portée ≤ 1 » du DPT.
  const ok = (c: number) => (want === 1 ? distance(c, target) <= 1 : distance(c, target) >= 2 || lvl.range < 2)
  const victim = fight.fighters.find(f => f.alive && f.cell === target && f.carriedBy === undefined)
  let ring = lvl.needFreeCell
  if (!ring && victim && prof.damage.some(l => l.aroundCaster || zoneRadius(l.zone) > 0)) {
    const cd = castDamage(me, victim, prof, ks.isWeapon === true)
    if ((cd.ringMean ?? 0) > (cd.centerMean ?? 0)) ring = true
  }
  let sorted = false
  const free = (): number[] => {
    const list = freeList()
    if (!sorted) list.sort((a, b) => Math.abs(distance(a, target) - want) - Math.abs(distance(b, target) - want) || a - b)
    sorted = true
    return list
  }
  const atCenter = (): number => {
    if (lvl.needFreeCell) return -1
    if (ok(me.cell) && canCast(engine, fight, me, ks, target) === null) return target
    for (const c of free()) {
      if (canCast(engine, fight, me, ks, target, { fromCell: c }) === null) {
        me.cell = c
        return target
      }
    }
    return -1
  }
  if (!ring) return atCenter()
  // Couronne : case visée t ≠ entité, une ligne de dégâts de rayon ≥ 1 (masque accepté) couvre l'entité ; une ligne
  // « autour du lanceur » (sous-sort lancé sur sa case) la couvre depuis la case du lanceur, éventuellement visée
  // elle-même (Jormun). À défaut (sort à case occupée sans autre entité : Tempête de Puissance), l'entité est visée.
  const lines = victim ? prof.damage.filter(l => zoneRadius(l.zone) > 0 && matchesTargetMask(l.mask, me, victim)) : []
  if (!lines.length) return atCenter()
  const hits = (t: number, c: number): boolean => lines.some(l => (l.aroundCaster ? zoneMembership(l.zone, c, c) : zoneMembership(l.zone, t, c))(target))
  // Rayon utile borné (zones « toute la carte » : une case voisine suffit).
  let R = 0
  for (const l of lines) if (!l.aroundCaster) R = Math.max(R, Math.min(6, zoneRadius(l.zone)))
  const aims: number[] = []
  for (let c = 0; c < CELL_COUNT; c++) {
    const d = distance(c, target)
    if (d >= 1 && d <= R && fight.map.cells[c]?.walkable) aims.push(c)
  }
  aims.sort((a, b) => distance(a, target) - distance(b, target) || a - b)
  const around = lines.some(l => l.aroundCaster)
  const old = me.cell
  for (const pass of [0, 1]) {
    for (const c of free()) {
      if (pass === 0 && !ok(c)) continue
      // Cases visées : sa propre case (lignes « autour du lanceur »), l'entité, puis les cases voisines de l'entité.
      const tries = around ? [c, target, ...aims] : aims
      for (const t of tries) {
        if ((t === c && !around) || !hits(t, c)) continue
        // Lanceur déjà sur `c` pendant le test (sinon sa case d'origine compterait comme occupée).
        me.cell = c
        if (canCast(engine, fight, me, ks, t) === null) return t
        me.cell = old
      }
    }
  }
  return atCenter()
}

/**
 * Joue le protocole de calibration pour `attacker`, un combattant NEUF (factory) qui est consommé : il est ajouté au
 * combat de mesure (équipe 0).
 */
export function measureCalibration(engine: Engine, attacker: Fighter, opts: CalibrationOptions): CalibrationMeasure {
  const targetCell = opts.targetCell ?? 300
  const dummy0 = createMonsterFighter(engine.data, { monsterId: opts.targetMonsterId ?? 3838, grade: opts.targetGrade ?? 5, cell: targetCell, team: 1 })
  attacker.team = 0
  attacker.cell = -1
  const fight = engine.createFight({ map: opts.map, fighters: [attacker, dummy0], options: { seed: 1, rollMode: 'average', record: false, maxRounds: 99 } })
  const me = fight.fighters[0]
  const dummy = fight.fighters[1]
  dummy.maxHp = dummy.baseMaxHp = dummy.hp = 10_000_000
  dummy.tags.cannotPlay = true
  me.cell = nearestFree(fight, targetCell, 1)
  const dpt = createDptTable(engine)
  const start = dummy.hp + dummy.shield
  let analytic = 0
  let casts = 0
  let planned = 0
  const turns = opts.turns ?? 3
  const total = turns + (opts.settleTurns ?? 3)
  for (let t = 0; t < total && !fight.ended; t++) {
    let f = engine.nextTurn(fight)
    for (let guard = 0; f && f.id !== me.id && guard < 8; guard++) {
      engine.endTurn(fight, f)
      f = engine.nextTurn(fight)
    }
    if (!f || !me.alive) break
    if (t < turns) {
      const plan = dpt.turn(me, dummy, me.ap, 'now')
      analytic += plan.mean
      planned += plan.casts.length
      for (const spellId of plan.casts) {
        const cell = placeForCast(engine, fight, me, spellId, dummy.cell)
        if (cell < 0) continue
        if (castSpell(engine, fight, me, spellId, cell).ok) casts++
      }
    }
    if (me.alive && !fight.ended) engine.endTurn(fight, me)
  }
  const simulated = start - (dummy.hp + dummy.shield)
  const raw = analytic > 0 ? simulated / analytic : 1
  const ratio = raw < CALIBRATION_BOUNDS[0] ? CALIBRATION_BOUNDS[0] : raw > CALIBRATION_BOUNDS[1] ? CALIBRATION_BOUNDS[1] : raw
  return { analytic, simulated, ratio, casts, planned }
}
