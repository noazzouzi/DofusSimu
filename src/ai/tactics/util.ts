/**
 * Aides partagées des tactiques proposeuses (docs/design/ai.md §10) — WP2 : ennemis/alliés actifs, PM maximaux d'un
 * ennemi pour qu'il n'atteigne personne, distances de marche (BFS sur la carte), validité géométrique d'un lancer
 * depuis une case hypothétique, profils des sorts lançables.
 */
import { isStaticFighter } from '../../engine/targetMask'
import type { Fighter, FightState, KnownSpell } from '../../engine/types'
import { CELL_COUNT, distance, neighborsOf } from '../../map/geometry'
import {
  believedCell, buildOccupancy, castFailureStatic, castGeom, castGeometryOk, LosOracle, levelFor, nextTurnApMp, type PerceptionX,
  type SpellProfileX,
} from '../core'
import type { SearchNode, TacticalContext } from '../tactical/node'

/** Combattant courant de la recherche dans l'état du nœud. */
export function meOf(ctx: TacticalContext, node: SearchNode): Fighter | undefined {
  const me = node.s.fighters[ctx.view.me.id]
  return me && me.alive ? me : undefined
}

/** Ennemis actifs (vivants, placés, non statiques, non portés). */
export function enemiesIn(s: FightState, team: number): Fighter[] {
  return s.fighters.filter(f => f.alive && f.team !== team && f.cell >= 0 && f.carriedBy === undefined && !isStaticFighter(f))
}

/** Alliés vivants et placés (soi compris). */
export function alliesIn(s: FightState, team: number): Fighter[] {
  return s.fighters.filter(f => f.alive && f.team === team && f.cell >= 0 && f.carriedBy === undefined)
}

/** Profils des sorts de `me` (dans l'ordre de `me.spells`). */
export function profilesOf(ctx: TacticalContext, me: Fighter): readonly SpellProfileX[] {
  return (ctx.perception as PerceptionX).profiles.ofFighter(me)
}

/** Le sort `i` est-il lançable maintenant (filtre statique C1, PA compris) ? */
export function castableNow(ctx: TacticalContext, me: Fighter, i: number, ap: number = me.ap): boolean {
  const ks = me.spells[i]
  const p = profilesOf(ctx, me)[i]
  if (!ks || !p || (p.unsupported && ctx.cfg.unsupportedSpells === 'skip')) return false
  return castFailureStatic(ctx.view.engine, me, ks, levelFor(me, ks), ap) === null
}

/** Portée max des sorts à dégâts d'un combattant (portée boostable comprise). */
export function damageRangeOf(p: PerceptionX, f: Fighter): number {
  let r = 1
  for (const pr of p.profiles.ofFighter(f)) {
    if (!pr.damage.length || pr.unsupported) continue
    r = Math.max(r, pr.maxRange + (pr.level.rangeBoostable ? Math.max(0, f.stats.range) : 0))
  }
  return r
}

/** PM maximaux de `e` pour qu'il n'atteigne aucun allié (portée de ses sorts à dégâts, distance au plus proche). */
export function mpMaxFor(p: PerceptionX, s: FightState, team: number, e: Fighter): number {
  const ec = believedCell(e, team as never)
  let dmin = Infinity
  for (const a of alliesIn(s, team)) dmin = Math.min(dmin, distance(ec, a.cell))
  if (!Number.isFinite(dmin)) return 99
  return Math.max(0, dmin - damageRangeOf(p, e) - 1)
}

/** PM de `e` à son prochain tour (buffs/retraits encore actifs). */
export function nextMpOf(p: PerceptionX, e: Fighter): number {
  const order = p.threat.order
  return order ? nextTurnApMp(e, order, { ap: 0, mp: 0 }).mp : e.stats.mp
}

/**
 * Distances de marche (BFS 4-voisins, cases marchables non occupées, `free` autorisées malgré l'occupation) depuis
 * `start`. −1 = inaccessible.
 */
export function walkDistances(s: FightState, team: number, start: number, free: ReadonlySet<number>, blocked = -1): Int16Array {
  const dist = new Int16Array(CELL_COUNT).fill(-1)
  const occ = buildOccupancy(s, team as never)
  if (blocked >= 0) occ[blocked] = 32767
  if (start < 0 || start >= CELL_COUNT) return dist
  const queue = new Int16Array(CELL_COUNT)
  let head = 0
  let tail = 0
  dist[start] = 0
  queue[tail++] = start
  while (head < tail) {
    const c = queue[head++]
    for (const n of neighborsOf(c)) {
      if (n < 0 || dist[n] >= 0) continue
      const mc = s.map.cells[n]
      if (!mc || !mc.walkable) continue
      if (occ[n] >= 0 && !free.has(n)) continue
      dist[n] = dist[c] + 1
      queue[tail++] = n
    }
  }
  return dist
}

/** `walkDistances` avec la case `blocked` rendue infranchissable. */
export function walkDistancesBlocked(s: FightState, team: number, start: number, free: ReadonlySet<number>, blocked: number): Int16Array {
  const f2 = new Set(free)
  f2.delete(blocked)
  return walkDistances(s, team, start, f2, blocked)
}

/**
 * Le sort `ks` de `me` peut-il être lancé depuis `from` sur `target` (géométrie, LdV, case libre) en supposant `me`
 * arrivé sur `from` et la case `vacated` libérée ? Approximation des tactiques : la simulation reste juge.
 */
export function castOkFrom(ctx: TacticalContext, s: FightState, me: Fighter, ks: KnownSpell, from: number, target: number, vacated = -1): boolean {
  const occ = buildOccupancy(s, ctx.view.team)
  if (vacated >= 0) occ[vacated] = -1
  const los = new LosOracle(s, ctx.view.team, me.id, occ)
  const lvl = levelFor(me, ks)
  return castGeometryOk(s, me, ks, lvl, castGeom(me, lvl), from, target, los)
}

/** Cases libres et marchables à distance [min, max] de `from` (ordre stable). */
export function freeCellsAround(s: FightState, team: number, from: number, min: number, max: number, vacated = -1): number[] {
  const occ = buildOccupancy(s, team as never)
  if (vacated >= 0) occ[vacated] = -1
  const out: number[] = []
  for (let c = 0; c < CELL_COUNT; c++) {
    const d = distance(from, c)
    if (d < min || d > max) continue
    const mc = s.map.cells[c]
    if (!mc || !mc.walkable || occ[c] >= 0) continue
    out.push(c)
  }
  return out
}

/** États exigés (« E<id> ») par un critère d'états de sort. */
export function requiredStates(criterion: string | undefined): number[] {
  if (!criterion) return []
  const out: number[] = []
  const re = /E(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(criterion))) out.push(Number(m[1]))
  return out
}
