/**
 * Tactique `healCleanse` (docs/design/ai.md §10.2, v1 — Eniripsa, Pandawa, Osamodas, Enutrof) : couverture MINIMALE
 * des alliés empoisonnés par un poison « retiré par un soin » (Petit poison des Harpilles) : soin de zone qui couvre
 * plusieurs empoisonnés d'abord, puis soins unitaires bon marché, depuis la même case de lancer (≤ 3 lancers).
 * Valeur captée par `pendingDot` (poisons programmés) et l'intention `cleanse`.
 */
import { believedCell } from '../core'
import { castFrom, castOnly, genericCands, profileOf, seqMacro, touchedBy } from '../tactical/cands'
import { healCleansablePoison } from '../tactical/evaluate'
import type { Tactic } from '../tactical/node'
import type { MacroAction } from '../types'
import { alliesIn, meOf } from './util'

export const healCleanse: Tactic = {
  id: 'healCleanse',
  requires(_me, profiles) {
    return profiles.some(p => !p.unsupported && p.heals.some(h => h.sides.ally || h.sides.self))
  },
  relevance(ctx, node) {
    const me = meOf(ctx, node)
    if (!me || me.ap < 1) return 0
    const n = alliesIn(node.s, ctx.view.team).filter(healCleansablePoison).length
    return Math.min(2, n)
  },
  propose(ctx, node, limit) {
    const me = meOf(ctx, node)
    if (!me) return []
    const s = node.s
    const meCell = believedCell(me, ctx.view.team)
    const poisoned = new Set(alliesIn(s, ctx.view.team).filter(healCleansablePoison).map(a => a.id))
    if (!poisoned.size) return []
    const heals = genericCands(ctx, node).filter(m => m.cast && (profileOf(ctx, me, m.cast.spellId)?.prof.heals.length ?? 0) > 0).map(m => {
      const cover = touchedBy(ctx, s, me, m).filter(f => poisoned.has(f.id)).map(f => f.id)
      const cost = Math.max(1, profileOf(ctx, me, m.cast!.spellId)!.prof.apCost)
      return { m, cover, cost }
    }).filter(h => h.cover.length > 0)
    if (!heals.length) return []
    const out: MacroAction[] = []
    // Couverture gloutonne (meilleur rapport « empoisonnés couverts / PA »), depuis la case du premier soin.
    heals.sort((a, b) => b.cover.length / b.cost - a.cover.length / a.cost || b.m.prior - a.m.prior || a.m.key.localeCompare(b.m.key))
    for (const start of heals.slice(0, 2)) {
      const from = castFrom(start.m, meCell)
      const covered = new Set(start.cover)
      const parts: MacroAction[] = [start.m]
      let ap = me.ap - start.cost
      const used = new Map<number, number>([[start.m.cast!.spellId, 1]])
      while (covered.size < poisoned.size && parts.length < 3) {
        let pick: (typeof heals)[number] | undefined
        let bestGain = 0
        for (const h of heals) {
          if (h.cost > ap || castFrom(h.m, meCell) !== from) continue
          const pr = profileOf(ctx, me, h.m.cast!.spellId)!.prof
          if ((used.get(h.m.cast!.spellId) ?? 0) >= (pr.castsPerTurn > 0 ? pr.castsPerTurn : 3)) continue
          const gain = h.cover.filter(id => !covered.has(id)).length / h.cost
          if (gain > bestGain) {
            bestGain = gain
            pick = h
          }
        }
        if (!pick) break
        parts.push(castOnly(pick.m))
        for (const id of pick.cover) covered.add(id)
        ap -= pick.cost
        used.set(pick.m.cast!.spellId, (used.get(pick.m.cast!.spellId) ?? 0) + 1)
      }
      const bonus = 200 * covered.size
      out.push(parts.length === 1 ? { ...start.m, tactic: 'healCleanse', key: `hc[${start.m.key}]`, prior: start.m.prior + bonus } : seqMacro(parts, 'healCleanse', 'hc', bonus))
    }
    return out.slice(0, limit)
  },
}
