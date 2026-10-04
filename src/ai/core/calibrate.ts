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
import { CELL_COUNT, distance } from '../../map/geometry'
import { levelFor, selfZoneHits } from './castCells'
import { createDptTable } from './dpt'
import { createSpellProfileIndex } from './spellProfile'

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
 * Place `me` (case modifiée directement : placement libre) d'où `spellId` touche `target` et renvoie la case à viser,
 * −1 si aucune. Sort à distance : lancé à distance ≥ 2 si possible (le moteur applique les modificateurs de mêlée selon
 * la distance réelle ; le DPT suppose « mêlée » ⇔ portée ≤ 1). Sort de portée 0 à zone : case du lanceur, cible dans
 * la zone.
 */
export function placeForCast(engine: Engine, fight: FightState, me: Fighter, spellId: number, target: number): number {
  const ks = me.spells.find(s => s.spellId === spellId)
  if (!ks) return -1
  const lvl = levelFor(me, ks)
  const prof = createSpellProfileIndex(engine).ofSpell(me, ks.level)
  const free: number[] = []
  for (let c = 0; c < CELL_COUNT; c++) {
    if (fight.map.cells[c]?.walkable && !fight.fighters.some(f => f.alive && f.cell === c && f.id !== me.id)) free.push(c)
  }
  const max = lvl.range + (lvl.rangeBoostable ? me.stats.range : 0)
  if (max === 0 && prof.zone && prof.zoneRadius > 0) {
    free.sort((a, b) => distance(a, target) - distance(b, target) || a - b)
    for (const c of free) {
      if (!selfZoneHits(prof.zone, prof.zoneRadius, c, target)) continue
      me.cell = c
      if (canCast(engine, fight, me, ks, c) === null) return c
    }
    return -1
  }
  const want = max <= 1 ? 1 : 2
  const ok = (c: number) => (want === 1 ? distance(c, target) <= 1 : distance(c, target) >= 2 || lvl.range < 2)
  if (ok(me.cell) && canCast(engine, fight, me, ks, target) === null) return target
  free.sort((a, b) => Math.abs(distance(a, target) - want) - Math.abs(distance(b, target) - want) || a - b)
  for (const c of free) {
    if (canCast(engine, fight, me, ks, target, { fromCell: c }) === null) {
      me.cell = c
      return target
    }
  }
  return -1
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
  return { analytic, simulated, ratio, casts }
}
