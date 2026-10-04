/**
 * Déplacements : cellules accessibles (BFS 4-voisins), tacle/fuite, exécution d'un chemin.
 */
import { apMpAfterTackle, tackleRatio } from '../damage/tackle'
import { distance, neighbors } from '../map/geometry'
import type { Engine } from './engine'
import type { Fighter, FightState } from './types'

/**
 * Proportion de PA/PM conservés en quittant le contact d'ennemis (formule Dofus 2.x / 3) :
 * pour chaque tacleur, ratio = (fuite + 2) / (2 × (tacle + 2)) ; ratios multipliés, plafonnés à 1.
 * Formule : `tackleRatio` (src/damage/tackle.ts).
 */
export function escapeRatio(fight: FightState, mover: Fighter, engine: Engine): number {
  if (engine.stateFlag(mover, 'cantBeTackled')) return 1
  let ratio = 1
  for (const n of neighbors(mover.cell)) {
    const e = engine.fighterAt(fight, n)
    if (!e || e.team === mover.team || !e.alive) continue
    if (e.tags.cantTackle || engine.stateFlag(e, 'cantTackle')) continue
    ratio *= tackleRatio(mover.stats.tackleEvade, e.stats.tackleBlock)
  }
  return Math.max(0, Math.min(1, ratio))
}

export function isTackled(fight: FightState, f: Fighter, engine: Engine): boolean {
  return escapeRatio(fight, f, engine) < 1
}

export interface Reachable {
  /** cellule -> PM nécessaires (sans compter le tacle). */
  cost: Map<number, number>
  /** cellule -> cellule précédente (pour reconstruire le chemin). */
  prev: Map<number, number>
}

/**
 * Cellules accessibles avec `mp` PM depuis la position du combattant (sans traverser d'entités).
 * Le tacle n'est pas inclus ici : il est appliqué au départ du déplacement (voir `move`).
 */
export function reachableCells(fight: FightState, f: Fighter, engine: Engine, mp = f.mp): Reachable {
  const cost = new Map<number, number>([[f.cell, 0]])
  const prev = new Map<number, number>()
  const queue = [f.cell]
  while (queue.length) {
    const c = queue.shift()!
    const d = cost.get(c)!
    if (d >= mp) continue
    for (const n of neighbors(c)) {
      if (cost.has(n)) continue
      if (!engine.isCellFree(fight, n)) continue
      cost.set(n, d + 1)
      prev.set(n, c)
      queue.push(n)
    }
  }
  return { cost, prev }
}

export function pathTo(r: Reachable, from: number, to: number): number[] | null {
  if (!r.cost.has(to)) return null
  const path = [to]
  let c = to
  while (c !== from) {
    c = r.prev.get(c)!
    path.unshift(c)
  }
  return path
}

/**
 * Exécute un déplacement le long de `path` (path[0] = cellule actuelle).
 * Applique le tacle en quittant chaque cellule au contact d'ennemis ; s'arrête si les PM manquent,
 * sur un piège, ou si une cellule est occupée. Retourne le nombre de cellules parcourues.
 */
export function move(fight: FightState, f: Fighter, path: number[], engine: Engine): number {
  if (!path.length || path[0] !== f.cell) return 0
  if (engine.stateFlag(f, 'cantBeMoved') && f.tags.rooted) return 0
  let steps = 0
  let walked = [f.cell]
  const flush = () => {
    if (walked.length > 1) engine.emit(fight, { t: 'move', fighter: f.id, path: walked, mpUsed: walked.length - 1 })
    walked = [f.cell]
  }
  for (let i = 1; i < path.length; i++) {
    if (!f.alive || fight.ended) break
    const next = path[i]
    if (distance(f.cell, next) !== 1 || !engine.isCellFree(fight, next)) break
    const ratio = escapeRatio(fight, f, engine)
    if (ratio < 1) {
      // PA/PM restants = arrondi .5 vers le bas de points × ratio (DoMath, formulas.md §14).
      const apLost = f.ap - apMpAfterTackle(f.ap, ratio)
      const mpLost = f.mp - apMpAfterTackle(f.mp, ratio)
      if (apLost || mpLost) {
        flush()
        f.ap -= apLost
        f.mp -= mpLost
        engine.emit(fight, { t: 'tackle', fighter: f.id, apLost, mpLost })
      }
    }
    if (f.mp <= 0) break
    f.mp--
    f.cell = next
    walked.push(next)
    steps++
    const trapped = fight.traps.some(t => t.cells.includes(next))
    if (trapped || fight.glyphs.some(g => g.cells.includes(next))) {
      flush()
      engine.hooks.onEnterCell?.(fight, f, next)
    }
    if (trapped) break
  }
  flush()
  return steps
}
