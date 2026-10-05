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

/**
 * Candidats génériques (C1-C8, priors `quick`) du combattant sur l'état du nœud, mis en cache ; prior corrigé pour
 * les sorts lancés sur un ennemi invulnérable qu'ils ne peuvent pas rendre vulnérable (`correctInvulnerablePrior`).
 */
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
    }).map(m => correctInvulnerablePrior(ctx, s, me, m))
  }
  CANDS.set(node, c)
  return c
}

/**
 * Le sort `spellIndex` de `me` peut-il lever l'invulnérabilité de `f` (règle R9) ? Lecture directe des effets du
 * niveau (sans sous-sorts) contre les buffs d'état invulnérable de la cible : 951/952 sur l'état, 132 si un tel buff
 * est désenvoûtable, 406/1406 s'il vient du sort retiré, 1075 s'il est désenvoûtable et finit dans le tour.
 */
function liftsInvulnerability(ctx: TacticalContext, me: Fighter, spellIndex: number, f: Fighter): boolean {
  const engine = ctx.view.engine
  const inv = f.states.filter(st => engine.data.state(st)?.invulnerable && !(f.disabledStates?.includes(st)))
  if (!inv.length) return false
  const buffs = f.buffs.filter(b => b.stateId !== undefined && inv.includes(b.stateId))
  for (const e of me.spells[spellIndex]?.level.effects ?? []) {
    const id = e.effectId
    if ((id === 951 || id === 952) && inv.includes(e.value)) return true
    if (id === 132 && buffs.some(b => b.dispellable)) return true
    if ((id === 406 || id === 1406) && buffs.some(b => b.spellId === e.value)) return true
    if (id === 1075 && buffs.some(b => b.dispellable && b.remaining <= Math.max(1, e.diceNum))) return true
  }
  return false
}

/**
 * Correction du prior `quick` (WP1, src/ai/core/candidates.ts) : il prête +0,3·PVmax à TOUT sort « qui retire des
 * états » (`removesStates` : 132, 406, 1075, 1406, 951, 952) lancé sur un ennemi invulnérable, comme s'il levait
 * l'invulnérabilité. Or 406/1075 retirent les effets d'un sort donné ou raccourcissent les buffs désenvoûtables : tous
 * les « Mots » de l'Eniripsa (406 sur leur propre famille) visaient ainsi le Vortex invulnérable de la phase 1
 * (+7 300 de prior chacun) et évinçaient soins et contrôles des quotas — l'Eniripsa ne soignait plus. Le bonus est
 * retiré quand le sort ne peut pas lever cette invulnérabilité (À RETIRER quand WP1 corrigera `quickEstimate`).
 */
function correctInvulnerablePrior(ctx: TacticalContext, s: FightState, me: Fighter, m: MacroAction): MacroAction {
  if (!m.cast || m.seq) return m
  const p = profileOf(ctx, me, m.cast.spellId)
  if (!p || !p.prof.removesStates) return m
  const team = ctx.view.team
  for (const f of s.fighters) {
    if (!f.alive || f.team === team || f.carriedBy !== undefined || believedCell(f, team) !== m.cast.cell) continue
    if (!ctx.view.engine.stateFlag(f, 'invulnerable') || liftsInvulnerability(ctx, me, p.index, f)) return m
    return { ...m, prior: m.prior - 0.3 * f.maxHp }
  }
  return m
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
