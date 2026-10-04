/**
 * BOUCHON S0 — contrôleur de repli « glouton » (docs/design/ai.md §18.2). Utilisé par les bouchons du
 * `TeamController` (WP2), du `MonsterBrain` (WP1) et de la politique `scripted` (WP4) en attendant S1 ; il disparaît
 * quand ces trois composants sont livrés. TODO(WP1/WP2/WP4) : ne plus l'utiliser.
 *
 * Tour : tant qu'un lancer depuis la case actuelle a un score immédiat > 0 (simulé sur un clone en 'average' :
 * dégâts infligés aux ennemis + ½ soins alliés − dégâts subis par les alliés, mort du lanceur interdite), le jouer ;
 * sinon s'approcher (case atteignable d'où un sort à dégâts porte sur un ennemi, sinon la plus proche d'un ennemi),
 * puis réessayer. ≤ `maxActions` actions. Déterministe (aucun `Math.random`, sel fixe des clones).
 */
import { mix32 } from '../core/hash'
import { canCast, castSpell } from '../engine/cast'
import type { Engine } from '../engine/engine'
import { pathTo, reachableCells } from '../engine/move'
import { performAction, type Controller } from '../engine/runner'
import type { Fighter, FightState, KnownSpell } from '../engine/types'
import { distance } from '../map/geometry'

export interface GreedyOptions {
  /** Actions maximales par tour (lancers + déplacements). */
  maxActions?: number
}

const isDamaging = (s: KnownSpell): boolean => s.level.effects.some(e => e.element >= 0 && e.element <= 4)

/** Score immédiat d'un lancer simulé sur un clone (PVe approximatifs), −Infinity si impossible ou suicidaire. */
function castScore(engine: Engine, fight: FightState, me: Fighter, spellId: number, cell: number): number {
  const c = engine.cloneFight(fight, false)
  c.options.rollMode = 'average'
  c.rngState = mix32(0x5bd1e995, spellId * 1024 + cell) | 0
  const before = c.fighters.map(f => (f.alive ? f.hp + f.shield : 0))
  const caster = c.fighters[me.id]
  if (!castSpell(engine, c, caster, spellId, cell).ok) return -Infinity
  if (!caster.alive) return -Infinity
  let score = 0
  c.fighters.forEach((f, i) => {
    const delta = before[i] - (f.alive ? f.hp + f.shield : 0)
    if (f.team !== me.team) score += delta + (before[i] > 0 && !f.alive ? 0.5 * f.maxHp : 0)
    else score += delta > 0 ? -delta : -0.5 * delta
  })
  return score
}

function bestCast(engine: Engine, fight: FightState, me: Fighter): { spellId: number; cell: number; score: number } | undefined {
  let best: { spellId: number; cell: number; score: number } | undefined
  for (const sp of me.spells) {
    for (const f of fight.fighters) {
      if (!f.alive || f.cell < 0 || f.carriedBy !== undefined) continue
      if (canCast(engine, fight, me, sp, f.cell) !== null) continue
      const score = castScore(engine, fight, me, sp.spellId, f.cell)
      if (score > 0 && (!best || score > best.score)) best = { spellId: sp.spellId, cell: f.cell, score }
    }
  }
  return best
}

/** Case d'approche : d'où un sort à dégâts porte (le plus de couples sort × ennemi), sinon la plus proche d'un ennemi. */
function approach(engine: Engine, fight: FightState, me: Fighter): number[] | null {
  if (me.mp < 1) return null
  const enemies = fight.fighters.filter(f => f.alive && f.team !== me.team && f.cell >= 0 && f.carriedBy === undefined)
  if (!enemies.length) return null
  const reach = reachableCells(fight, me, engine)
  const damaging = me.spells.filter(isDamaging)
  const nearest = (c: number) => Math.min(...enemies.map(e => distance(c, e.cell)))
  const rate = (c: number) => {
    let n = 0
    for (const sp of damaging) for (const e of enemies) if (canCast(engine, fight, me, sp, e.cell, { fromCell: c }) === null) n++
    return n
  }
  let bestCell = me.cell
  let bestRate = rate(me.cell)
  let bestDist = nearest(me.cell)
  let bestCost = 0
  for (const [c, cost] of reach.cost) {
    if (c === me.cell) continue
    const r = rate(c)
    const d = nearest(c)
    if (r > bestRate || (r === bestRate && (d < bestDist || (d === bestDist && (cost < bestCost || (cost === bestCost && c < bestCell)))))) {
      bestCell = c
      bestRate = r
      bestDist = d
      bestCost = cost
    }
  }
  if (bestCell === me.cell) return null
  return pathTo(reach, me.cell, bestCell)
}

/** Joue un tour glouton pour `me` (voir l'en-tête). */
export function playGreedyTurn(engine: Engine, fight: FightState, me: Fighter, opts: GreedyOptions = {}): void {
  const maxActions = opts.maxActions ?? 8
  let moved = false
  for (let step = 0; step < maxActions && me.alive && !fight.ended; step++) {
    const cast = bestCast(engine, fight, me)
    if (cast) {
      if (!performAction(engine, fight, me, { type: 'cast', spellId: cast.spellId, cell: cast.cell }).ok) break
      continue
    }
    if (moved) break
    const path = approach(engine, fight, me)
    if (!path || path.length < 2) break
    moved = true
    if (!performAction(engine, fight, me, { type: 'move', path }).ok) break
  }
}

/** Contrôleur glouton de repli (S0). */
export function greedyController(opts: GreedyOptions = {}): Controller {
  return { playTurn: (engine, fight, me) => playGreedyTurn(engine, fight, me, opts) }
}
