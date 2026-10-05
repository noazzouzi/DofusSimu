/**
 * Tactique `glyphClock` (docs/design/ai.md §10.2, v1 — toutes classes, Œil de Vortex) : traverser une glyphe de
 * monstre (+1 heure à l'entrée) EN TÊTE de plan (glyphe puis kill) ou EN FIN de plan (kill puis glyphe), quand le
 * scénario paie l'avance de l'horloge (`PriceTable.clock[1] > θ.planner.glyphCost`, indice `glyph` du modèle).
 *
 * ```
 * pour chaque glyphe atteignable (case-événement admise, PM suffisants, tacle compris) :
 *     seq(chemin vers la glyphe, meilleur kill sous contrat lançable depuis la glyphe)
 *     seq(meilleur kill sous contrat, chemin de la case de lancer vers la glyphe)
 *     levier seul : chemin vers la glyphe (C11)
 * ```
 * Si `clock[1] < 0`, rien n'est proposé et les chemins génériques évitent déjà les glyphes (cases-événements).
 * Valeur captée par `clock[k]` et `kill[m][h]` (heure de mort lue dans les états de la victime simulée).
 */
import { believedCell, buildOccupancy, computeReachFor, reachPath, type PerceptionX } from '../core'
import { castFrom, castOnly, genericCands, hitsTarget, seqMacro } from '../tactical/cands'
import type { Tactic } from '../tactical/node'
import type { MacroAction } from '../types'
import { castOkFrom, meOf } from './util'

export const glyphClock: Tactic = {
  id: 'glyphClock',
  requires() {
    return true
  },
  relevance(ctx, node) {
    const me = meOf(ctx, node)
    if (!me || me.mp < 1) return 0
    const glyph = (ctx.hints ?? []).find(h => h.kind === 'glyph' && h.cells?.length)
    return glyph && ctx.bb.prices.clock[1] > ctx.cfg.theta.planner.glyphCost ? 3 : 0
  },
  propose(ctx, node, limit) {
    const me = meOf(ctx, node)
    if (!me) return []
    const s = node.s
    const team = ctx.view.team
    const engine = ctx.view.engine
    const meCell = believedCell(me, team)
    const glyphCells = new Set<number>()
    for (const h of ctx.hints ?? []) if (h.kind === 'glyph') for (const c of h.cells ?? []) glyphCells.add(c)
    if (!glyphCells.size) return []
    const reach = computeReachFor(engine, s, me, team, { allowEventCells: glyphCells })
    const killTargets = (ctx.hints ?? []).filter(h => h.kind === 'kill' && h.targetId !== undefined && h.weight > 0).map(h => h.targetId!)
    const cands = genericCands(ctx, node)
    // Lancers qui touchent une cible sous contrat, classés par dégâts sur elle (plafonnés à ses PV) puis par prior : le
    // prior est calculé à l'heure ACTUELLE, où la mort est justement mal payée (avant la glyphe) ; trié par prior, il
    // plaçait en tête les coups qui ne tuent pas et la séquence « glyphe puis kill » ne tuait plus (tuning-log tour 1).
    const p = ctx.perception as PerceptionX
    const dmgOn = (m: MacroAction): number => {
      const i = me.spells.findIndex(x => x.spellId === m.cast!.spellId)
      let best = 0
      for (const t of killTargets) {
        const f = s.fighters[t]
        if (!f || !f.alive || i < 0 || !hitsTarget(ctx, s, me, m, t)) continue
        best = Math.max(best, Math.min(p.dpt.perCast(me, i, f).mean, f.hp + f.shield))
      }
      return best
    }
    const kills = cands.filter(m => m.cast && m.cat === 'damage' && killTargets.some(t => hitsTarget(ctx, s, me, m, t)))
      .map(m => ({ m, d: dmgOn(m) }))
      .sort((a, b) => b.d - a.d || b.m.prior - a.m.prior)
      .slice(0, 3)
      .map(x => x.m)
    const lever = ctx.bb.prices.clock[1]
    const out: MacroAction[] = []
    for (const g of glyphCells) {
      if (reach.mpLeft[g] < 0) continue
      const path = reachPath(reach, meCell, g)
      if (!path || path.length < 2) continue
      const move: MacroAction = { path, cat: 'placement', prior: lever, key: `glyph:${g}` }
      out.push({ ...move, tactic: 'glyphClock', mandatory: true, key: `gc[${move.key}]` })
      // Glyphe puis kill (lancé depuis la glyphe).
      for (const k of kills) {
        const ks = me.spells.find(x => x.spellId === k.cast!.spellId)
        if (!ks || !castOkFrom(ctx, s, me, ks, g, k.cast!.cell, meCell)) continue
        out.push({ ...seqMacro([move, castOnly(k)], 'glyphClock', 'gc', lever), mandatory: true })
      }
      // Kill puis glyphe (chemin depuis la case de lancer avec les PM restants).
      for (const k of kills) {
        const from = castFrom(k, meCell)
        const spent = from === meCell ? 0 : Math.max(0, k.path ? k.path.length - 1 : 0)
        const occ = buildOccupancy(s, team)
        occ[meCell] = -1
        occ[from] = me.id
        const r2 = computeReachFor(engine, s, me, team, { start: from, mp: me.mp - spent, ap: me.ap, occupancy: occ, allowEventCells: glyphCells })
        if (r2.mpLeft[g] < 0) continue
        const p2 = reachPath(r2, from, g)
        if (!p2 || p2.length < 2) continue
        out.push({ ...seqMacro([k, { path: p2, cat: 'placement', prior: lever, key: `glyph:${g}` }], 'glyphClock', 'gc', lever), mandatory: true })
      }
    }
    out.sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : 1))
    return out.slice(0, limit)
  },
}
