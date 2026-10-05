/**
 * Tactique `burstSetup` (docs/design/ai.md §10.2, v1 — Iop, Enutrof, Eniripsa, Ecaflip) : buffs dont la durée couvre
 * le créneau de burst (l'allié au plus fort potentiel qui joue avant la riposte de la cible), débuffs « dommages
 * subis » sur la cible du burst ; les gros sorts sont réservés par les intentions `reserve` du plan de burst (WP3).
 * Pertinente pendant les phases `transition`/`burst`, avec une intention `setup`/`burst` du combattant, ou quand
 * l'équipe a une fenêtre de kill (potentiel de l'allié suivant ≥ ½ PV effectifs de sa cible).
 * Valeur captée par `potential` (Δpotentiel de l'allié buffé) et les intentions `setup`/`burst`.
 */
import type { Fighter } from '../../engine/types'
import { hpEff, type PerceptionX } from '../core'
import { genericCands, profileOf, touchedBy } from '../tactical/cands'
import type { Tactic, TacticalContext } from '../tactical/node'
import type { MacroAction } from '../types'
import { alliesIn, meOf } from './util'

/** Alliés (hors soi) qui jouent avant leur cible, avec un potentiel notable : [allié, potentiel]. */
function burstAllies(ctx: TacticalContext, me: Fighter): { a: Fighter; pot: number; target?: number }[] {
  const p = ctx.perception as PerceptionX
  const s = p.state()
  const out: { a: Fighter; pot: number; target?: number }[] = []
  for (const a of alliesIn(s, ctx.view.team)) {
    if (a.id === me.id || a.kind === 'summon' || a.summonerId !== undefined) continue
    const pot = p.potential.potential(a.id)
    if (pot <= 0) continue
    const t = p.potential.bestTarget(a.id)
    out.push({ a, pot, target: t })
  }
  out.sort((x, y) => y.pot - x.pot || x.a.id - y.a.id)
  return out
}

export const burstSetup: Tactic = {
  id: 'burstSetup',
  requires(_me, profiles) {
    return profiles.some(p => !p.unsupported && (p.allyBuff || p.received.some(r => r.pct > 100 && r.sides.enemy)))
  },
  relevance(ctx, node) {
    const me = meOf(ctx, node)
    if (!me || me.ap < 1 || node.depth > 2) return 0
    const phase = ctx.bb.phase
    if (phase === 'transition' || phase === 'burst') return 1
    if (ctx.bb.intents.some(i => i.owner === me.id && (i.kind === 'setup' || i.kind === 'burst'))) return 1
    const p = ctx.perception as PerceptionX
    p.sync(node.s)
    for (const { pot, target } of burstAllies(ctx, me)) {
      const t = target !== undefined ? node.s.fighters[target] : undefined
      if (t && t.alive && pot >= 0.5 * hpEff(t)) return 0.5
    }
    return 0
  },
  propose(ctx, node, limit) {
    const me = meOf(ctx, node)
    if (!me) return []
    const s = node.s
    const p = ctx.perception as PerceptionX
    p.sync(s)
    const allies = burstAllies(ctx, me)
    if (!allies.length) return []
    const potOf = new Map(allies.map(x => [x.a.id, x.pot]))
    const targets = new Set(allies.map(x => x.target).filter((x): x is number => x !== undefined))
    const out: MacroAction[] = []
    for (const m of genericCands(ctx, node)) {
      if (!m.cast) continue
      const pr = profileOf(ctx, me, m.cast.spellId)?.prof
      if (!pr) continue
      const touched = touchedBy(ctx, s, me, m)
      let gain = 0
      if (pr.allyBuff || pr.stats.some(l => l.sign > 0 && l.sides.ally)) for (const f of touched) gain += 0.3 * (potOf.get(f.id) ?? 0)
      if (pr.received.some(r => r.pct > 100 && r.sides.enemy)) for (const f of touched) if (targets.has(f.id)) gain += 0.3 * hpEff(f)
      if (gain <= 0) continue
      out.push({ ...m, tactic: 'burstSetup', key: `bs[${m.key}]`, prior: m.prior + gain })
    }
    out.sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : 1))
    return out.slice(0, limit)
  },
}
