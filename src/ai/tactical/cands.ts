/**
 * Candidats génériques d'un nœud (docs/design/ai.md §8.1, C1-C8 de src/ai/core/candidates.ts) mis en cache sur le nœud,
 * et petites aides partagées par la génération (`generate.ts`) et les tactiques (src/ai/tactics/**) : case de lancer
 * d'une macro, cibles touchées, profil du sort lancé. Aucune dépendance vers les tactiques (pas de cycle).
 */
import type { Fighter, FightState } from '../../engine/types'
import { zoneMembership } from '../../map/zones'
import { believedCell, generateCasts, viewOn, type PerceptionX, type SpellProfileX } from '../core'
import type { MacroAction } from '../types'
import type { SearchNode, TacticalContext } from './node'

const CANDS = new WeakMap<SearchNode, MacroAction[]>()

/** Candidats génériques (C1-C8, priors `quick`) du combattant sur l'état du nœud, mis en cache. */
export function genericCands(ctx: TacticalContext, node: SearchNode): MacroAction[] {
  let c = CANDS.get(node)
  if (c) return c
  const s = node.s
  const me = s.fighters[ctx.view.me.id]
  if (!me || !me.alive || s.ended) c = []
  else {
    const fast = (ctx.mode ?? ctx.cfg.mode) === 'fast'
    c = generateCasts(viewOn(ctx.view, s), s, me, {
      perception: ctx.perception,
      unsupportedSpells: ctx.cfg.unsupportedSpells,
      reserved: ctx.reserved,
      scenario: ctx.scenario,
      bb: ctx.bb,
      maxCastCells: fast ? 2 : 3,
      maxZoneCenters: fast ? 4 : 6,
    })
  }
  CANDS.set(node, c)
  return c
}

/** Case d'où la macro lance son sort (fin du chemin, sinon la case actuelle). */
export function castFrom(m: MacroAction, meCell: number): number {
  return m.path && m.path.length ? m.path[m.path.length - 1] : meCell
}

/** Profil du sort `spellId` de `me` (index dans `me.spells`), ou undefined. */
export function profileOf(ctx: TacticalContext, me: Fighter, spellId: number): { prof: SpellProfileX; index: number } | undefined {
  const i = me.spells.findIndex(k => k.spellId === spellId)
  if (i < 0) return undefined
  const prof = (ctx.perception as PerceptionX).profiles.ofFighter(me)[i]
  return prof ? { prof, index: i } : undefined
}

/** Combattants (vivants, placés) dont la case est dans la zone principale du sort lancé par `m`. */
export function touchedBy(ctx: TacticalContext, s: FightState, me: Fighter, m: MacroAction): Fighter[] {
  const out: Fighter[] = []
  if (!m.cast) return out
  const p = profileOf(ctx, me, m.cast.spellId)
  if (!p) return out
  const from = castFrom(m, believedCell(me, ctx.view.team))
  const zone = p.prof.zone
  const inZone = zone && p.prof.zoneRadius > 0 ? zoneMembership(zone, m.cast.cell, from) : null
  for (const f of s.fighters) {
    if (!f.alive || f.carriedBy !== undefined) continue
    const c = f.id === me.id ? from : believedCell(f, ctx.view.team)
    if (c < 0) continue
    if (inZone ? inZone(c) : c === m.cast.cell) out.push(f)
  }
  return out
}

/** La macro (premier lancer) vise-t-elle la case de `target` (directement ou dans sa zone) ? */
export function hitsTarget(ctx: TacticalContext, s: FightState, me: Fighter, m: MacroAction, targetId: number): boolean {
  if (!m.cast) return false
  return touchedBy(ctx, s, me, m).some(f => f.id === targetId)
}

/** Macro sans chemin (lancer depuis la case où l'on se trouve après la macro précédente d'une séquence). */
export function castOnly(m: MacroAction): MacroAction {
  return { cast: m.cast, cat: m.cat, prior: m.prior, key: m.key }
}

/** Séquence de macros (tactiques) : catégorie et prior agrégés, clé déterministe. */
export function seqMacro(parts: MacroAction[], tactic: MacroAction['tactic'], prefix: string, bonus = 0): MacroAction {
  let prior = bonus
  for (const p of parts) prior += p.prior
  return { seq: parts, cat: parts[0]?.cat ?? 'utility', prior, tactic, key: `${prefix}[${parts.map(p => p.key).join('>')}]` }
}
