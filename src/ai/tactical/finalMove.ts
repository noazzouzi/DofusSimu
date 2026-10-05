/**
 * Déplacement de fin de tour (docs/design/ai.md §8.5) — WP2.
 *
 * Pour chaque case atteignable avec les PM restants (tacle inclus) :
 *   pos(c) = −w_inc·cellIncoming(me, c)·(1 + deathRisk) + 0,25·opportunité(me, c) + roleTerm(me, c) + cell[c]
 *            + sat(intentions position/survive)·prix − pénalité des cases réservées par un allié ± indices du scénario
 * puis simulation des `endCells` meilleures (pièges, glyphes, échanges forcés : la simulation est juge) ; « rester »
 * est toujours candidat ; un déplacement qui rapporte moins de θ.value.endMoveMinGain PVe (30 en `fast`) est refusé.
 *
 * Préfiltre (coût) : `cellIncoming` n'est calculé que pour les 12 meilleures cases selon les termes bon marché (rôle,
 * prix de case, indices, opportunité) et les 8 cases les plus éloignées des ennemis (abri).
 */
import { isStaticFighter } from '../../engine/targetMask'
import type { Fighter, FightState } from '../../engine/types'
import { distance, neighborsOf } from '../../map/geometry'
import { applyMacro, buildOccupancy, cachedReach, hpEff, reachPath, simClone, simSalt, type PerceptionX } from '../core'
import { damageWeightOf } from '../core/potential'
import type { MacroAction, RoleId } from '../types'
import { evalLeaf, intentActive } from './evaluate'
import type { FinalLeaf, SearchNode, TacticalContext } from './node'

/** Cible focale du combattant : premier ennemi vivant du focus, sinon le plus proche. */
export function focalTarget(ctx: TacticalContext, s: FightState, me: Fighter): Fighter | undefined {
  for (const id of ctx.bb.focus) {
    const f = s.fighters[id]
    if (f && f.alive && f.team !== me.team && f.cell >= 0) return f
  }
  let best: Fighter | undefined
  let bd = Infinity
  for (const f of s.fighters) {
    if (!f.alive || f.team === me.team || f.cell < 0 || isStaticFighter(f)) continue
    const d = distance(me.cell, f.cell)
    if (d < bd || (d === bd && best && f.id < best.id)) {
      bd = d
      best = f
    }
  }
  return best
}

/** Portée idéale : portée max du sort à dégâts le plus fort (1 pour un corps-à-corps), bornée à [1, 8]. */
export function idealRange(ctx: TacticalContext, me: Fighter): number {
  const p = ctx.perception as PerceptionX
  const profs = p.profiles.ofFighter(me)
  let best = -1
  let range = 1
  for (let i = 0; i < profs.length; i++) {
    const pr = profs[i]
    if (!pr.damage.length || pr.unsupported) continue
    const m = pr.baseDamage
    if (m > best) {
      best = m
      range = pr.maxRange + (pr.level.rangeBoostable ? Math.max(0, me.stats.range) : 0)
    }
  }
  return Math.max(1, Math.min(8, range))
}

/** Le combattant frappe-t-il surtout à distance (meilleur sort de portée > 2) ? */
function isRanged(ctx: TacticalContext, me: Fighter): boolean {
  return idealRange(ctx, me) > 2
}

/** Portée max des sorts de soin / buff allié. */
function supportRange(ctx: TacticalContext, me: Fighter): number {
  const p = ctx.perception as PerceptionX
  let r = 0
  for (const pr of p.profiles.ofFighter(me)) {
    if (pr.unsupported) continue
    if (pr.heals.length || pr.shields.length || pr.allyBuff) r = Math.max(r, pr.maxRange + (pr.level.rangeBoostable ? Math.max(0, me.stats.range) : 0))
  }
  return r
}

/** Portée max des sorts de déplacement d'autrui (placeur). */
function placementRange(ctx: TacticalContext, me: Fighter): number {
  const p = ctx.perception as PerceptionX
  let r = 0
  for (const pr of p.profiles.ofFighter(me)) {
    if (pr.unsupported || pr.apCost > 2) continue
    if (pr.moves.some(m => !m.onCaster)) r = Math.max(r, pr.maxRange + (pr.level.rangeBoostable ? Math.max(0, me.stats.range) : 0))
  }
  return r
}

/** Ennemis non statiques vivants et placés. */
function activeEnemies(s: FightState, me: Fighter): Fighter[] {
  const out: Fighter[] = []
  for (const f of s.fighters) if (f.alive && f.team !== me.team && f.cell >= 0 && !isStaticFighter(f) && f.carriedBy === undefined) out.push(f)
  return out
}

/** Terme de rôle sur une case (§8.5), borné à ±θ.value.positionCap. */
export function roleTerm(ctx: TacticalContext, s: FightState, me: Fighter, cell: number, role: RoleId | undefined = ctx.role): number {
  const cap = ctx.cfg.theta.value.positionCap
  if (!role) return 0
  const enemies = activeEnemies(s, me)
  let adj = 0
  for (const e of enemies) if (distance(cell, e.cell) === 1) adj++
  let v = 0
  switch (role) {
    case 'killer':
    case 'zoneDps':
    case 'mpLock':
    case 'apLock': {
      const focal = focalTarget(ctx, s, me)
      const ideal = idealRange(ctx, me)
      if (focal) v -= 15 * Math.abs(distance(cell, focal.cell) - ideal)
      if (adj > 0 && ideal > 2) v -= 200
      break
    }
    case 'tank': {
      if (me.stats.tackleBlock > 0) v += 150 * adj
      // Case sur le plus court chemin d'un ennemi vers un allié fragile (entre les deux, à distance 1 de la droite).
      for (const a of s.fighters) {
        if (!a.alive || a.team !== me.team || a.id === me.id || a.cell < 0) continue
        if (a.maxHp > me.maxHp * 0.8) continue
        for (const e of enemies) {
          const de = distance(e.cell, a.cell)
          if (distance(e.cell, cell) + distance(cell, a.cell) <= de + 1 && distance(e.cell, cell) >= 1) {
            v += 100
            break
          }
        }
      }
      break
    }
    case 'healer':
    case 'support': {
      const r = supportRange(ctx, me)
      for (const a of s.fighters) if (a.alive && a.team === me.team && a.id !== me.id && a.cell >= 0 && distance(cell, a.cell) <= r) v += 60
      if (adj > 0) v -= 200
      break
    }
    case 'placer': {
      const r = placementRange(ctx, me)
      if (r > 0) for (const f of s.fighters) if (f.alive && f.id !== me.id && f.cell >= 0 && !isStaticFighter(f) && distance(cell, f.cell) <= r) v += 40
      break
    }
    case 'summoner': {
      let free = false
      for (const n of neighborsOf(cell)) {
        const mc = s.map.cells[n]
        if (mc?.walkable && !s.fighters.some(f => f.alive && f.cell === n)) {
          free = true
          break
        }
      }
      if (free) v += 40
      break
    }
  }
  return Math.max(-cap, Math.min(cap, v))
}

/** Opportunité offensive de `me` au prochain tour depuis `cell` (approximation : portée + PM). */
export function opportunity(ctx: TacticalContext, s: FightState, me: Fighter, cell: number): number {
  const p = ctx.perception as PerceptionX
  const range = idealRange(ctx, me)
  const mp = Math.max(0, me.stats.mp)
  const w = ctx.cfg.theta.value
  let best = 0
  for (const e of activeEnemies(s, me)) {
    const d = distance(cell, e.cell)
    const f = d <= range ? 1 : d <= range + mp ? 0.6 : d <= range + 2 * mp ? 0.2 : 0
    if (f <= 0) continue
    const v = damageWeightOf(e, w, ctx.scenario, ctx.bb)
    const val = f * Math.min(p.dpt.dpt(me, e), hpEff(e)) * v
    if (val > best) best = val
  }
  return best
}

/** Termes de case hors menace : prix de case, intentions position/survive, cases réservées, indices du scénario. */
function cellExtras(ctx: TacticalContext, me: Fighter, cell: number): number {
  let v = 0
  const prices = ctx.bb.prices
  if (prices.cell) v += prices.cell[cell] ?? 0
  const root = ctx.root ?? ctx.view.fight
  for (const it of ctx.bb.intents) {
    if (it.owner !== me.id || it.kind !== 'position' || !it.cells?.length || !intentActive(it, root)) continue
    let d = Infinity
    for (const c of it.cells) d = Math.min(d, distance(cell, c))
    v += it.price * (d === 0 ? 1 : Math.max(0, 1 - 0.2 * d))
  }
  const owner = ctx.reservedCells?.get(cell) ?? ctx.bb.reservedCells.get(cell)
  if (owner !== undefined && owner !== me.id) v -= ctx.cfg.theta.team.reservedCellPenalty
  for (const h of ctx.hints ?? []) {
    if (!h.cells?.length) continue
    if (h.kind === 'avoidCells' && h.cells.includes(cell)) v -= h.weight
    else if (h.kind === 'reachCell' && h.cells.includes(cell)) v += h.weight
  }
  return v
}

/** Score analytique d'une case de fin de tour (§8.5) ; `inc` = cellIncoming(me, c). */
function posScore(ctx: TacticalContext, s: FightState, me: Fighter, cell: number, inc: number, risk: number): number {
  const w = ctx.cfg.theta.value
  const wInc = ctx.role === 'tank' ? w.incomingTank : w.incoming
  return -wInc * inc * (1 + risk) + 0.25 * opportunity(ctx, s, me, cell) + roleTerm(ctx, s, me, cell) + cellExtras(ctx, me, cell)
}

/** Feuille terminale sans déplacement (« rester »). */
function stayLeaf(ctx: TacticalContext, node: SearchNode): FinalLeaf {
  const me = node.s.fighters[ctx.view.me.id]
  const position = me && me.alive ? roleTerm(ctx, node.s, me, me.cell) : 0
  const e = evalLeaf(ctx, node.s, { terminal: true, position })
  return { node, s: node.s, v: e.v + node.adj, vTerminal: e.v + node.adj, breakdown: e.b, rolled: false }
}

/**
 * Rend une feuille terminale (§8.2 `finalize`) : meilleur déplacement de fin (ou « rester »), valeur terminale.
 * Consomme au plus `endCells` nœuds.
 */
export function finalize(ctx: TacticalContext, node: SearchNode): FinalLeaf {
  const stay = stayLeaf(ctx, node)
  const s = node.s
  const me = s.fighters[ctx.view.me.id]
  const b = ctx.budget
  if (!me || !me.alive || s.ended || me.mp < 1 || b.endCells <= 0 || ctx.nodes.exhausted()) return stay
  const p = ctx.perception as PerceptionX
  p.sync(s)
  const engine = ctx.view.engine
  const occ = buildOccupancy(s, ctx.view.team)
  const reach = cachedReach(engine, s, me, ctx.view.team, me.mp, me.ap, occ)
  if (reach.count <= 1) return stay
  const enemies = activeEnemies(s, me)
  // Préfiltre bon marché.
  const cheap: { c: number; v: number; far: number }[] = []
  for (let i = 0; i < reach.count; i++) {
    const c = reach.cells[i]
    if (c === me.cell) continue
    let far = Infinity
    for (const e of enemies) far = Math.min(far, distance(c, e.cell))
    cheap.push({ c, v: roleTerm(ctx, s, me, c) + cellExtras(ctx, me, c) + 0.25 * opportunity(ctx, s, me, c), far: far === Infinity ? 0 : far })
  }
  const pick = new Set<number>()
  cheap.sort((a, x) => x.v - a.v || a.c - x.c)
  for (const x of cheap.slice(0, 12)) pick.add(x.c)
  cheap.sort((a, x) => x.far - a.far || x.v - a.v || a.c - x.c)
  for (const x of cheap.slice(0, 8)) pick.add(x.c)
  const risk0 = p.threat.deathRisk(me.id)
  const stayScore = posScore(ctx, s, me, me.cell, p.threat.incoming(me.id), risk0)
  const scored: { c: number; gain: number }[] = []
  for (const c of pick) {
    const gain = posScore(ctx, s, me, c, p.threat.cellIncoming(me, c), risk0) - stayScore
    if (gain > 0) scored.push({ c, gain })
  }
  if (!scored.length) return stay
  scored.sort((a, x) => x.gain - a.gain || a.c - x.c)
  const minGain = (ctx.mode ?? ctx.cfg.mode) === 'fast' ? Math.max(30, ctx.cfg.theta.value.endMoveMinGain) : ctx.cfg.theta.value.endMoveMinGain
  let best = stay
  const salt = simSalt(node.hash, 0x7f + node.depth)
  for (const { c } of scored.slice(0, b.endCells)) {
    if (ctx.nodes.exhausted()) break
    const path = reachPath(reach, me.cell, c)
    if (!path || path.length < 2) continue
    const child = simClone(ctx.view, s, salt)
    ctx.nodes.spend(1)
    const m: MacroAction = { path, cat: 'placement', prior: 0, key: `move:${c}` }
    if (!applyMacro(engine, child, me.id, m)) continue
    const cm = child.fighters[me.id]
    if (!cm || cm.cell === me.cell) continue
    const position = cm.alive ? roleTerm(ctx, child, cm, cm.cell) : 0
    const e = evalLeaf(ctx, child, { terminal: true, position })
    const v = e.v + node.adj
    if (v > best.v + (best === stay ? minGain : 0) || (best !== stay && v > best.v)) {
      best = { node, s: child, endPath: path, v, vTerminal: v, breakdown: e.b, rolled: false }
    }
  }
  return best
}
