/**
 * Tactique `stateChain` (docs/design/ai.md §10.2, v1, toutes classes) — séquences tirées des DONNÉES :
 *  (a) buff / invocation / état posé sur soi PUIS le plus gros sort à dégâts depuis la même case (« buff puis
 *      frappe » : Balise Tactique puis Flèche Explosive, Puissance puis Épée) ;
 *  (b) débuff « dommages subis » (> 100 %) sur un ennemi PUIS le plus gros sort sur ce même ennemi ;
 *  (c) A pose l'état S exigé par le critère d'états de B (`statesCriterion` « E<S> ») ⇒ A puis B ;
 *  (d) mobilité (téléportation du lanceur) PUIS un lancer impossible depuis l'accessibilité actuelle.
 * Valeur captée par V (la simulation décide) ; le faisceau seul peut élaguer A avant d'en voir le bénéfice.
 */
import type { Fighter } from '../../engine/types'
import { believedCell, type PerceptionX, type SpellProfileX } from '../core'
import { castFrom, castOnly, genericCands, hitsTarget, profileOf, seqMacro } from '../tactical/cands'
import type { SearchNode, Tactic, TacticalContext } from '../tactical/node'
import type { MacroAction } from '../types'
import { castableNow, castOkFrom, enemiesIn, meOf, profilesOf, requiredStates } from './util'

const OFFENSIVE_STATS = new Set(['power', 'spellPower', 'damage', 'strength', 'intelligence', 'chance', 'agility', 'finalDamagePct',
  'spellDamagePct', 'meleeDamagePct', 'rangedDamagePct', 'criticalDamage', 'critical', 'ap', 'fireDamage', 'waterDamage', 'earthDamage',
  'airDamage', 'neutralDamage'])

/** Le profil prépare-t-il une frappe (buff offensif sur soi, invocation, état sur soi) ? */
function isSetup(p: SpellProfileX): boolean {
  if (p.damage.length) return false
  if (p.stats.some(l => l.sign > 0 && (l.sides.self || l.sides.selfOnly) && OFFENSIVE_STATS.has(l.stat as string))) return true
  if (p.summonLines.length) return true
  return p.states.some(l => !l.remove && l.on === 'self')
}

/** Débuff « dommages subis » sur un ennemi. */
function isAmplifier(p: SpellProfileX): boolean {
  return p.received.some(r => r.pct > 100 && r.sides.enemy)
}

function apCost(ctx: TacticalContext, me: Fighter, m: MacroAction): number {
  return m.cast ? (profileOf(ctx, me, m.cast.spellId)?.prof.apCost ?? 99) : 0
}

export const stateChain: Tactic = {
  id: 'stateChain',
  requires(_me, profiles) {
    return profiles.some(p => !p.unsupported && (isSetup(p) || isAmplifier(p) || p.moves.some(m => m.onCaster && m.kind === 'teleport')))
  },
  relevance(ctx: TacticalContext, node: SearchNode) {
    const me = meOf(ctx, node)
    if (!me || me.ap < 2 || node.depth > 2) return 0
    return enemiesIn(node.s, ctx.view.team).length ? 2 : 0
  },
  propose(ctx, node, limit) {
    const me = meOf(ctx, node)
    if (!me) return []
    const s = node.s
    const meCell = believedCell(me, ctx.view.team)
    const cands = genericCands(ctx, node)
    const damage = cands.filter(m => m.cat === 'damage' && m.cast).sort((a, b) => b.prior - a.prior)
    const out: MacroAction[] = []
    const push = (a: MacroAction, b: MacroAction, bonus = 0): void => {
      if (apCost(ctx, me, a) + apCost(ctx, me, b) > me.ap + 1e-9) return
      out.push(seqMacro([a, b], 'stateChain', 'sc', bonus))
    }
    // (a) buff / invocation / état sur soi puis frappe depuis la même case ; (b) amplificateur puis frappe sur la cible.
    for (const a of cands) {
      if (!a.cast || a.cat === 'damage') continue
      const pa = profileOf(ctx, me, a.cast.spellId)
      if (!pa) continue
      const from = castFrom(a, meCell)
      if (isSetup(pa.prof)) {
        const b = damage.find(d => d.cast!.spellId !== a.cast!.spellId && castFrom(d, meCell) === from)
        if (b) push(a, castOnly(b), 0.2 * b.prior)
      } else if (isAmplifier(pa.prof)) {
        const t = s.fighters.find(f => f.alive && f.team !== me.team && believedCell(f, ctx.view.team) === a.cast!.cell)
        if (!t) continue
        const b = damage.find(d => d.cast!.spellId !== a.cast!.spellId && castFrom(d, meCell) === from && hitsTarget(ctx, s, me, d, t.id))
        if (b) push(a, castOnly(b), 0.5 * b.prior)
      }
    }
    // (c) A pose l'état exigé par B.
    const profs = profilesOf(ctx, me)
    const dpt = (ctx.perception as PerceptionX).dpt
    for (let bi = 0; bi < me.spells.length; bi++) {
      const pb = profs[bi]
      const need = requiredStates(pb.level.statesCriterion)
      if (!need.length || !pb.damage.length || castableNow(ctx, me, bi)) continue
      for (const a of cands) {
        if (!a.cast) continue
        const pa = profileOf(ctx, me, a.cast.spellId)
        if (!pa || !pa.prof.states.some(l => !l.remove && l.on === 'self' && need.includes(l.stateId))) continue
        const from = castFrom(a, meCell)
        let best: MacroAction | undefined
        for (const e of enemiesIn(s, ctx.view.team)) {
          if (!castOkFrom(ctx, s, me, me.spells[bi], from, e.cell)) continue
          const mean = dpt.perCast(me, bi, e).mean
          if (!best || mean > best.prior) best = { cast: { spellId: me.spells[bi].spellId, cell: e.cell }, cat: 'damage', prior: mean, key: `${me.spells[bi].spellId}:${e.cell}:${from}` }
        }
        if (best) push(a, best, 0.2 * best.prior)
      }
    }
    // (d) téléportation du lanceur puis lancer depuis la case d'arrivée.
    for (const a of cands) {
      if (!a.cast) continue
      const pa = profileOf(ctx, me, a.cast.spellId)
      if (!pa || !pa.prof.moves.some(m => m.onCaster && m.kind === 'teleport') || pa.prof.damage.length) continue
      const dest = a.cast.cell
      let best: MacroAction | undefined
      for (let bi = 0; bi < me.spells.length; bi++) {
        const pb = profs[bi]
        if (!pb.damage.length || me.spells[bi].spellId === a.cast.spellId || !castableNow(ctx, me, bi, me.ap - pa.prof.apCost)) continue
        for (const e of enemiesIn(s, ctx.view.team)) {
          if (!castOkFrom(ctx, s, me, me.spells[bi], dest, e.cell, meCell)) continue
          const mean = dpt.perCast(me, bi, e).mean
          if (!best || mean > best.prior) best = { cast: { spellId: me.spells[bi].spellId, cell: e.cell }, cat: 'damage', prior: mean, key: `${me.spells[bi].spellId}:${e.cell}:${dest}` }
        }
      }
      if (best) push(a, best, 0.2 * best.prior)
    }
    out.sort((x, y) => y.prior - x.prior || (x.key < y.key ? -1 : 1))
    return out.slice(0, limit)
  },
}
