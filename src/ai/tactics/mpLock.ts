/**
 * Tactique `mpLock` (docs/design/ai.md §10.2, v1 — Enutrof, Crâ, Sram, Féca) : retirer à chaque monstre JUSTE assez
 * de PM pour qu'il n'atteigne personne, dans l'ordre de la timeline (menaces les plus proches d'abord).
 *
 * ```
 * mpLock(e) : need = PM_next(e) − PMmax(e)          // PMmax : distance au plus proche allié − portée − 1
 *             options = lancers de retrait de PM qui touchent e ; espérance = expectedApMpRemoved(retrait, esquive, PM)
 *             séquence de coût minimal en PA (meilleur rapport retrait/PA d'abord, même case de lancer) qui atteint need
 * ```
 * Valeur captée par `incoming` (la simulation recalcule la menace avec les PM restants).
 */
import { expectedApMpRemoved } from '../../damage/apmp'
import type { Fighter } from '../../engine/types'
import { believedCell, type PerceptionX } from '../core'
import { castFrom, castOnly, genericCands, hitsTarget, profileOf, seqMacro } from '../tactical/cands'
import type { SearchNode, Tactic, TacticalContext } from '../tactical/node'
import type { MacroAction } from '../types'
import { enemiesIn, meOf, mpMaxFor, nextMpOf } from './util'

/** Ennemis à verrouiller : actifs, doivent se déplacer pour frapper, PM au prochain tour > PM maximaux. */
function lockTargets(ctx: TacticalContext, node: SearchNode): { e: Fighter; need: number; c: number }[] {
  const p = ctx.perception as PerceptionX
  const s = node.s
  p.sync(s)
  const out: { e: Fighter; need: number; c: number }[] = []
  for (const e of enemiesIn(s, ctx.view.team)) {
    const row = p.threat.rowOf(e)
    if (!row || !row.active || row.hitsFromStart) continue
    const need = nextMpOf(p, e) - mpMaxFor(p, s, ctx.view.team, e)
    const c = p.threat.contribution(e)
    if (need > 0.25 && c > 0) out.push({ e, need, c })
  }
  const order = p.threat.order
  out.sort((a, b) => order.rank(a.e.id) - order.rank(b.e.id) || b.c - a.c || a.e.id - b.e.id)
  return out
}

/** PM retirés attendus par un lancer de `m` sur `e`. */
function removalOf(ctx: TacticalContext, me: Fighter, m: MacroAction, e: Fighter, already: number): number {
  const p = m.cast ? profileOf(ctx, me, m.cast.spellId) : undefined
  if (!p) return 0
  let v = 0
  for (const r of p.prof.removals) {
    if (r.pool !== 'mp' || r.delay > 0 || !r.sides.enemy) continue
    const pts = Math.max(0, e.stats.mp - already - v)
    v += r.dodgeable ? expectedApMpRemoved(me.stats.mpReduction, e.stats.mpParry, pts, pts, Math.round(r.value)) : Math.min(pts, r.value)
  }
  return v
}

export const mpLock: Tactic = {
  id: 'mpLock',
  requires(_me, profiles) {
    return profiles.some(p => !p.unsupported && p.removals.some(r => r.pool === 'mp' && r.delay <= 0 && r.sides.enemy))
  },
  relevance(ctx, node) {
    const me = meOf(ctx, node)
    if (!me || me.ap < 1) return 0
    return Math.min(2, lockTargets(ctx, node).length)
  },
  propose(ctx, node, limit) {
    const me = meOf(ctx, node)
    if (!me) return []
    const s = node.s
    const meCell = believedCell(me, ctx.view.team)
    const cands = genericCands(ctx, node).filter(m => m.cast && (profileOf(ctx, me, m.cast.spellId)?.prof.removals.some(r => r.pool === 'mp' && r.delay <= 0) ?? false))
    const out: MacroAction[] = []
    for (const { e, need, c } of lockTargets(ctx, node)) {
      if (out.length >= limit) break
      const opts = cands.filter(m => hitsTarget(ctx, s, me, m, e.id)).map(m => {
        const pr = profileOf(ctx, me, m.cast!.spellId)!.prof
        return { m, rem: removalOf(ctx, me, m, e, 0), cost: Math.max(1, pr.apCost), max: pr.castsPerTurn > 0 ? pr.castsPerTurn : 3 }
      }).filter(o => o.rem > 0)
      if (!opts.length) continue
      // Première étape : meilleure efficacité (chemin éventuel) ; puis lancers depuis la même case.
      opts.sort((a, b) => b.rem / b.cost - a.rem / a.cost || a.m.key.localeCompare(b.m.key))
      const first = opts[0]
      const from = castFrom(first.m, meCell)
      const parts: MacroAction[] = [first.m]
      let removed = first.rem
      let ap = me.ap - first.cost
      const used = new Map<number, number>([[first.m.cast!.spellId, 1]])
      for (const o of opts) {
        if (removed >= need - 0.25 || parts.length >= 3) break
        if (castFrom(o.m, meCell) !== from || o.cost > ap) continue
        const n = used.get(o.m.cast!.spellId) ?? 0
        if (n >= o.max) continue
        const rem = removalOf(ctx, me, o.m, e, removed)
        if (rem <= 0.05) continue
        used.set(o.m.cast!.spellId, n + 1)
        parts.push(castOnly(o.m))
        removed += rem
        ap -= o.cost
      }
      out.push(parts.length === 1 ? { ...first.m, tactic: 'mpLock', key: `ml[${first.m.key}]`, prior: first.m.prior + 0.375 * c } : seqMacro(parts, 'mpLock', 'ml', 0.375 * c))
    }
    return out
  },
}
