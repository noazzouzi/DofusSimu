/**
 * Tactique `carryThrow` (docs/design/ai.md §10.2, v1 — Pandawa) : porter une entité x puis la jeter vers une case
 * « but » : REGROUPER (ennemi jeté au contact d'autres ennemis, zone de l'allié suivant), ISOLER (ennemi jeté loin de
 * nos alliés fragiles), SAUVER (allié jeté hors de portée des menaces).
 *
 * ```
 * pour chaque entité x portable dont une case voisine est atteignable (PM) avec assez de PA pour porter + jeter :
 *     porter = chemin vers la case voisine la moins coûteuse + sort de portage sur x
 *     Y = cases libres à portée du sort de jet depuis la case du porteur (case de x libérée), triées par but
 *     proposer seq(porter x, jeter vers Y) pour les 3 meilleurs Y de chaque but
 * ```
 * Simplification : pas de déplacement intermédiaire entre le portage et le jet (le design en autorise ≤ 2). Valeur
 * captée par V (potentiel de l'allié suivant, menace) et le rollout.
 */
import type { KnownSpell } from '../../engine/types'
import { distance } from '../../map/geometry'
import { believedCell, buildOccupancy, cachedReach, mpSpent, reachPath, type PerceptionX, type SpellProfileX } from '../core'
import { seqMacro } from '../tactical/cands'
import type { Tactic } from '../tactical/node'
import type { MacroAction } from '../types'
import { alliesIn, castableNow, castOkFrom, damageRangeOf, enemiesIn, freeCellsAround, meOf, profilesOf } from './util'

const carries = (p: SpellProfileX): boolean => p.moves.some(m => m.kind === 'carry')
const throws = (p: SpellProfileX): boolean => p.moves.some(m => m.kind === 'throw')

export const carryThrow: Tactic = {
  id: 'carryThrow',
  requires(_me, profiles) {
    return profiles.some(p => !p.unsupported && carries(p)) && profiles.some(p => !p.unsupported && throws(p))
  },
  relevance(ctx, node) {
    const me = meOf(ctx, node)
    if (!me || me.ap < 2 || me.carrying !== undefined || node.depth > 1) return 0
    const profs = profilesOf(ctx, me)
    if (!profs.some((p, i) => carries(p) && castableNow(ctx, me, i))) return 0
    const near = node.s.fighters.some(f => f.alive && f.id !== me.id && f.cell >= 0 && f.carriedBy === undefined && f.tags.static !== true
      && distance(believedCell(me, ctx.view.team), f.cell) <= Math.max(0, Math.floor(me.mp)) + 1)
    return near ? 3 : 0
  },
  propose(ctx, node, limit) {
    const me = meOf(ctx, node)
    if (!me) return []
    const s = node.s
    const team = ctx.view.team
    const p = ctx.perception as PerceptionX
    const profs = profilesOf(ctx, me)
    const meCell = believedCell(me, team)
    const carry = profs.map((pr, i) => ({ pr, i })).filter(x => carries(x.pr) && castableNow(ctx, me, x.i))
      .sort((a, b) => a.pr.apCost - b.pr.apCost || a.i - b.i)[0]
    if (!carry) return []
    const throwSpells = profs.map((pr, i) => ({ pr, i })).filter(x => throws(x.pr) && !x.pr.unsupported)
    const occ = buildOccupancy(s, team)
    const reach = cachedReach(ctx.view.engine, s, me, team, me.mp, me.ap, occ)
    const enemies = enemiesIn(s, team)
    const allies = alliesIn(s, team).filter(a => a.id !== me.id)
    const out: MacroAction[] = []
    const targets = s.fighters.filter(f => f.alive && f.id !== me.id && f.cell >= 0 && f.carriedBy === undefined && f.tags.static !== true)
      .sort((a, b) => distance(meCell, a.cell) - distance(meCell, b.cell) || a.id - b.id)
    for (const x of targets.slice(0, 4)) {
      // Case voisine de x la moins coûteuse (ou la case actuelle si x est adjacent).
      let at = -1
      let cost = Infinity
      for (let k = 0; k < reach.count; k++) {
        const c = reach.cells[k]
        if (distance(c, x.cell) !== 1) continue
        const sp = mpSpent(reach, c)
        if (reach.apLeft[c] < carry.pr.apCost) continue
        if (sp < cost || (sp === cost && c < at)) {
          cost = sp
          at = c
        }
      }
      if (at < 0) continue
      if (!castOkFrom(ctx, s, me, me.spells[carry.i], at, x.cell)) continue
      const path = at === meCell ? undefined : reachPath(reach, meCell, at) ?? undefined
      if (at !== meCell && !path) continue
      const carryM: MacroAction = { ...(path ? { path } : {}), cast: { spellId: me.spells[carry.i].spellId, cell: x.cell }, cat: 'placement', prior: 0, key: `${me.spells[carry.i].spellId}:${x.cell}:${at}` }
      const apAfter = reach.apLeft[at] - carry.pr.apCost
      const enemy = x.team !== team
      for (const t of throwSpells) {
        if (t.pr.apCost > apAfter + 1e-9) continue
        const ks: KnownSpell = me.spells[t.i]
        const cells = freeCellsAround(s, team, at, Math.max(1, t.pr.minRange), Math.max(1, t.pr.maxRange), x.cell).filter(c => c !== at)
        const scored: { c: number; v: number }[] = []
        for (const y of cells) {
          if (!castOkFrom(ctx, s, me, ks, at, y, x.cell)) continue
          let v = 0
          if (enemy) {
            // Regrouper : autres ennemis à ≤ 2 cases ; isoler/éloigner : distance au plus proche allié fragile.
            let near = 0
            for (const e of enemies) if (e.id !== x.id && distance(e.cell, y) <= 2) near++
            let dAlly = 99
            for (const a of allies) dAlly = Math.min(dAlly, distance(a.cell, y))
            v = 3 * near + 0.15 * Math.min(dAlly, 8) - 0.2 * Math.max(0, damageRangeOf(p, x) + Math.max(0, x.stats.mp) - dAlly)
          } else {
            // Sauver : moins d'ennemis capables d'atteindre la case.
            let threats = 0
            for (const e of enemies) if (distance(e.cell, y) <= damageRangeOf(p, e) + Math.max(0, e.stats.mp)) threats++
            v = -2 * threats + 0.1 * Math.min(8, Math.min(...enemies.map(e => distance(e.cell, y)), 8))
          }
          scored.push({ c: y, v })
        }
        scored.sort((a, b) => b.v - a.v || a.c - b.c)
        for (const { c, v } of scored.slice(0, 3)) {
          const throwM: MacroAction = { cast: { spellId: ks.spellId, cell: c }, cat: 'placement', prior: 0, key: `${ks.spellId}:${c}:${at}` }
          out.push(seqMacro([carryM, throwM], 'carryThrow', 'ct', 150 + 100 * v))
        }
      }
    }
    out.sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : 1))
    return out.slice(0, limit)
  },
}

