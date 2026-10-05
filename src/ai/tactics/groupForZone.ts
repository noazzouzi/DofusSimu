/**
 * Tactique `groupForZone` (docs/design/ai.md §10.2, v1 — Pandawa, Xélor, Iop, Steamer) : rapprocher 2-3 monstres dans
 * la zone du meilleur sort de zone de l'allié qui joue ensuite (ou du combattant lui-même) par une poussée, une
 * attirance ou un échange. Case d'arrivée prédite (direction du moteur, arrêt avant un obstacle ou une entité) ;
 * score = paires d'ennemis à distance ≤ rayon de la zone, après − avant. Valeur captée par `potential` (2e cible de
 * zone) et le rollout (l'allié suivant joue sa zone).
 */
import { pullDirection, pushDirection } from '../../engine/effects/movement/drag'
import type { Fighter, FightState } from '../../engine/types'
import { cellInDirection, distance } from '../../map/geometry'
import { believedCell, type PerceptionX } from '../core'
import { castFrom, genericCands, profileOf } from '../tactical/cands'
import type { Tactic, TacticalContext } from '../tactical/node'
import type { MacroAction } from '../types'
import { enemiesIn, meOf } from './util'

/** Rayon de zone du meilleur sort de zone à dégâts d'un allié (0 si aucun). */
function zoneRadiusOf(p: PerceptionX, f: Fighter): number {
  let r = 0
  for (const pr of p.profiles.ofFighter(f)) if (pr.damage.length && !pr.unsupported && pr.zoneRadius > r) r = Math.min(3, pr.zoneRadius)
  return r
}

/** Allié qui joue le prochain (personnage ou soi), et le rayon de zone à servir. */
function zoneUser(ctx: TacticalContext, s: FightState, me: Fighter): number {
  const p = ctx.perception as PerceptionX
  p.sync(s)
  const order = p.threat.order
  for (const sl of order.slots) {
    if (sl.team !== ctx.view.team || sl.passes) continue
    const f = s.fighters[sl.fighterId]
    if (!f || !f.alive) continue
    const r = zoneRadiusOf(p, f)
    if (r > 0) return r
    break
  }
  return zoneRadiusOf(p, me)
}

/** Paires d'ennemis à distance ≤ r. */
function pairs(cells: number[], r: number): number {
  let n = 0
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) if (distance(cells[i], cells[j]) <= r) n++
  return n
}

/** Case d'arrivée d'une entité déplacée (poussée/attirance) de `n` cases. */
function moved(s: FightState, team: number, from: number, target: number, pos: number, push: boolean, n: number, moverId: number): number {
  const dir = push ? pushDirection(from, target, pos) : pullDirection(from, target, pos)
  if (dir < 0) return pos
  let cur = pos
  for (let k = 0; k < n; k++) {
    const nx = cellInDirection(cur, dir)
    if (nx < 0 || !s.map.cells[nx]?.walkable || nx === from) break
    if (s.fighters.some(f => f.alive && f.id !== moverId && f.carriedBy === undefined && believedCell(f, team as never) === nx)) break
    cur = nx
  }
  return cur
}

export const groupForZone: Tactic = {
  id: 'groupForZone',
  requires(_me, profiles) {
    return profiles.some(p => !p.unsupported && p.moves.some(m => !m.onCaster && (m.kind === 'push' || m.kind === 'pull') && m.sides.enemy))
  },
  relevance(ctx, node) {
    const me = meOf(ctx, node)
    if (!me || me.ap < 1 || node.depth > 2) return 0
    if (enemiesIn(node.s, ctx.view.team).length < 2) return 0
    return zoneUser(ctx, node.s, me) > 0 ? 2 : 0
  },
  propose(ctx, node, limit) {
    const me = meOf(ctx, node)
    if (!me) return []
    const s = node.s
    const team = ctx.view.team
    const r = zoneUser(ctx, s, me)
    if (r <= 0) return []
    const meCell = believedCell(me, team)
    const enemies = enemiesIn(s, team)
    const base = pairs(enemies.map(e => e.cell), r)
    const out: MacroAction[] = []
    for (const m of genericCands(ctx, node)) {
      if (!m.cast) continue
      const pr = profileOf(ctx, me, m.cast.spellId)?.prof
      if (!pr) continue
      const mv = pr.moves.find(x => !x.onCaster && (x.kind === 'push' || x.kind === 'pull') && x.sides.enemy)
      if (!mv) continue
      const t = enemies.find(e => e.cell === m.cast!.cell)
      if (!t) continue
      const dest = moved(s, team, castFrom(m, meCell), m.cast.cell, t.cell, mv.kind === 'push', mv.cells, t.id)
      if (dest === t.cell) continue
      const after = pairs(enemies.map(e => (e.id === t.id ? dest : e.cell)), r)
      const gain = after - base
      if (gain <= 0) continue
      out.push({ ...m, tactic: 'groupForZone', key: `gz[${m.key}]`, prior: m.prior + 250 * gain })
    }
    out.sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : 1))
    return out.slice(0, limit)
  },
}
