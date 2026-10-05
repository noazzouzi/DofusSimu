/**
 * Tactique `bodyBlock` (docs/design/ai.md §10.2, v1 — toutes classes, invocateurs) : occuper (invoquer, marcher) une
 * case d'ARTICULATION du DAG des plus courts chemins d'un monstre vers l'allié qu'il vise (couloir unique).
 *
 * ```
 * pour les 2 ennemis les plus menaçants qui doivent se déplacer pour frapper :
 *     t = cible prédite (sinon l'allié le plus proche) ; dE, dT = distances de marche depuis e et t ; L = dE(t)
 *     candidates = cases c des plus courts chemins (dE(c) + dT(c) = L) à portée de marche de e
 *     articulation = c dont le blocage allonge le trajet de e vers t d'au moins 2 cases (ou le coupe)
 *     proposer : invocation sur la meilleure articulation (plus long détour, puis la plus proche de e), lançable depuis
 *                une case atteignable ; marche jusqu'à elle (levier C11)
 * ```
 * Valeur captée par `incoming` (le monstre ne passe plus) ; la simulation tranche.
 */
import { believedCell, buildOccupancy, cachedReach, castCellsFor, LosOracle, levelFor, mpSpent, reachPath, type PerceptionX } from '../core'
import { distance } from '../../map/geometry'
import type { Tactic } from '../tactical/node'
import type { MacroAction } from '../types'
import { alliesIn, castableNow, enemiesIn, meOf, profilesOf, walkDistances, walkDistancesBlocked } from './util'

export const bodyBlock: Tactic = {
  id: 'bodyBlock',
  requires() {
    return true
  },
  relevance(ctx, node) {
    const me = meOf(ctx, node)
    if (!me || node.depth > 2) return 0
    const p = ctx.perception as PerceptionX
    p.sync(node.s)
    for (const r of p.threat.enemies) if (r.active && !r.hitsFromStart && r.threat > 0) return 2
    return 0
  },
  propose(ctx, node, limit) {
    const me = meOf(ctx, node)
    if (!me) return []
    const s = node.s
    const team = ctx.view.team
    const p = ctx.perception as PerceptionX
    p.sync(s)
    const meCell = believedCell(me, team)
    const rows = p.threat.enemies.filter(r => r.active && !r.hitsFromStart && r.threat > 0).slice().sort((a, b) => p.threat.contribution(b.e) - p.threat.contribution(a.e) || a.e.id - b.e.id)
    const allies = alliesIn(s, team)
    const profs = profilesOf(ctx, me)
    const summonIdx = profs.map((pr, i) => i).filter(i => profs[i].summonLines.some(l => !l.revive) && castableNow(ctx, me, i))
    const occ = buildOccupancy(s, team)
    const reach = cachedReach(ctx.view.engine, s, me, team, me.mp, me.ap, occ)
    const los = new LosOracle(s, team, me.id, occ)
    const out: MacroAction[] = []
    const cells: number[] = []
    for (const row of rows.slice(0, 2)) {
      const e = row.e
      if (!enemiesIn(s, team).some(x => x.id === e.id)) continue
      const tid = p.threat.predictedTarget(e)
      const t = (tid !== undefined ? s.fighters[tid] : undefined) ?? allies.slice().sort((a, b) => distance(a.cell, e.cell) - distance(b.cell, e.cell) || a.id - b.id)[0]
      if (!t) continue
      const free = new Set<number>([e.cell, t.cell, meCell])
      const dE = walkDistances(s, team, e.cell, free)
      const dT = walkDistances(s, team, t.cell, free)
      const L = dE[t.cell]
      if (L <= 1) continue
      // Cases des plus courts chemins ; « articulation » = la bloquer allonge le trajet de e d'au moins 2 cases
      // (ou le coupe) : couloir réel, pas seulement une couche du DAG en terrain ouvert.
      const choke: { c: number; detour: number; d: number }[] = []
      for (let c = 0; c < dE.length; c++) {
        if (dE[c] <= 0 || dT[c] <= 0 || dE[c] + dT[c] !== L || dE[c] > Math.max(1, e.stats.mp) + 2) continue
        const blocked = new Set(free)
        const dE2 = walkDistancesBlocked(s, team, e.cell, blocked, c)
        const detour = dE2[t.cell] < 0 ? 99 : dE2[t.cell] - L
        if (detour >= 2) choke.push({ c, detour, d: dE[c] })
      }
      choke.sort((a, b) => b.detour - a.detour || a.d - b.d || a.c - b.c)
      for (const { c } of choke.slice(0, 2)) {
        if (occ[c] >= 0 && c !== meCell) continue
        for (const i of summonIdx) {
          const ks = me.spells[i]
          castCellsFor(s, me, ks, levelFor(me, ks), c, reach, los, 16, cells)
          if (!cells.length) continue
          // Case de lancer la moins coûteuse (PM puis PA perdus) : rester de notre côté du couloir.
          let from = cells[0]
          for (const x of cells) if (mpSpent(reach, x) < mpSpent(reach, from) || (mpSpent(reach, x) === mpSpent(reach, from) && x < from)) from = x
          const path = from === meCell ? undefined : reachPath(reach, meCell, from) ?? undefined
          if (from !== meCell && !path) continue
          out.push({ ...(path ? { path } : {}), cast: { spellId: ks.spellId, cell: c }, cat: 'summon', prior: 0.5 * p.threat.contribution(e), tactic: 'bodyBlock', key: `bb[${ks.spellId}:${c}:${from}]` })
        }
        if (reach.mpLeft[c] >= 0 && c !== meCell) {
          const path = reachPath(reach, meCell, c)
          if (path && path.length > 1) out.push({ path, cat: 'placement', prior: 0.3 * p.threat.contribution(e), tactic: 'bodyBlock', key: `bb[move:${c}]` })
        }
      }
    }
    out.sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : 1))
    return out.slice(0, limit)
  },
}
