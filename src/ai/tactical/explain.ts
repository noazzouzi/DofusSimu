/**
 * Explications en français pour le replay (événements `aiNote`, E3 ; docs/design/ai.md §3.3, §10.3) — WP2.
 *
 * Textes courts : plan du tour (« Crâ : Balise Tactique en case 312 puis Flèche Explosive sur Ikargn (+1 840 PVe) »),
 * intentions du combattant, tactiques utilisées, cible prioritaire, coups « créatifs » avec le terme de V dominant
 * (« Enutrof : Maladresse sur Buboxor — menace réduite de 900 PVe »). Purement descriptif : aucune décision n'en
 * dépend, et les événements `aiNote` n'entrent pas dans le hash des événements.
 */
import type { Engine } from '../../engine/engine'
import type { AiNoteKind, Fighter, FightState } from '../../engine/types'
import { believedCell } from '../core'
import type { AIView, EvalBreakdown, Intent, MacroAction, TacticId } from '../types'
import type { SearchPlan } from './node'

/** Libellés français des tactiques (§10.2). */
export const TACTIC_LABEL: Record<TacticId, string> = {
  stateChain: 'enchaînement (état / buff puis frappe)',
  mpLock: 'verrou de PM',
  carryThrow: 'porter puis jeter',
  glyphClock: "glyphe d'horloge",
  healCleanse: 'soin qui purge le poison',
  bodyBlock: 'blocage du couloir',
  groupForZone: 'regroupement pour la zone',
  burstSetup: 'préparation du burst',
  apLock: 'verrou de PA',
  tackleTrap: 'piège de tacle',
  pushCollision: 'poussée contre obstacle',
  losShield: 'abri de ligne de vue',
  lineDodge: 'sortie de ligne',
  corruptedWall: 'mur de corrompus',
  baitSummon: 'invocation appât',
  dispelAlly: 'désenvoûtement allié',
}

const INTENT_LABEL: Record<Intent['kind'], string> = {
  control: 'contrôler',
  protect: 'protéger',
  cleanse: 'purger',
  position: 'se placer',
  setup: 'préparer',
  reserve: 'réserver',
  burst: 'burst sur',
  survive: 'survivre',
}

export interface Note {
  kind: AiNoteKind
  text: string
  cells?: number[]
  targets?: number[]
}

/** Format « 1 840 » (espaces fines insécables évitées : espace simple). */
export function fmt(v: number): string {
  const r = Math.round(v)
  const s = Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return r < 0 ? `−${s}` : s
}

function spellName(me: Fighter, spellId: number): string {
  return me.spells.find(k => k.spellId === spellId)?.name ?? `sort ${spellId}`
}

/** Occupant (vu par l'équipe) d'une case. */
function occupant(s: FightState, team: number, cell: number): Fighter | undefined {
  for (const f of s.fighters) if (f.alive && f.carriedBy === undefined && believedCell(f, team as 0 | 1) === cell) return f
  return undefined
}

/** Texte d'une macro-action. */
export function describeMacro(s: FightState, me: Fighter, m: MacroAction, team: number): string {
  if (m.seq && m.seq.length) {
    const head = m.cast || (m.path && m.path.length > 1) ? [describeMacro(s, me, { ...m, seq: undefined }, team)] : []
    return [...head, ...m.seq.map(x => describeMacro(s, me, x, team))].join(' puis ')
  }
  const parts: string[] = []
  if (m.path && m.path.length > 1 && !m.cast) return `se déplace en case ${m.path[m.path.length - 1]}`
  if (m.path && m.path.length > 1) parts.push(`se déplace (${m.path.length - 1} PM)`)
  if (m.cast) {
    const t = occupant(s, team, m.cast.cell)
    parts.push(t ? `${spellName(me, m.cast.spellId)} sur ${t.id === me.id ? 'soi' : t.name}` : `${spellName(me, m.cast.spellId)} en case ${m.cast.cell}`)
  }
  return parts.join(' puis ') || 'attend'
}

/** Cases et cibles d'un plan (flèches du replay). */
function planGeometry(s: FightState, team: number, actions: readonly MacroAction[]): { cells: number[]; targets: number[] } {
  const cells: number[] = []
  const targets: number[] = []
  const walk = (m: MacroAction): void => {
    if (m.path && m.path.length > 1) cells.push(m.path[m.path.length - 1])
    if (m.cast) {
      cells.push(m.cast.cell)
      const t = occupant(s, team, m.cast.cell)
      if (t && !targets.includes(t.id)) targets.push(t.id)
    }
    if (m.seq) for (const x of m.seq) walk(x)
  }
  for (const m of actions) walk(m)
  return { cells, targets }
}

/** Note « plan du tour ». */
export function planNote(view: AIView, plan: SearchPlan): Note {
  const me = view.me
  const s = view.fight
  const text = plan.actions.length
    ? `${me.name} : ${plan.actions.map(m => describeMacro(s, me, m, view.team)).join(', ')} (${plan.value >= 0 ? '+' : ''}${fmt(plan.value)} PVe)`
    : `${me.name} : rien d'utile à lancer, garde ses PA`
  return { kind: 'plan', text, ...planGeometry(s, view.team, plan.actions) }
}

/** Terme non offensif dominant d'un plan par rapport à « rien » (marquage créatif). */
export function dominantReason(b: EvalBreakdown, p: EvalBreakdown): string {
  const d = (k: keyof EvalBreakdown): number => (b[k] as number) - (p[k] as number)
  const terms: { k: keyof EvalBreakdown; v: number; text: (v: number) => string }[] = [
    { k: 'incoming', v: d('incoming'), text: v => `menace réduite de ${fmt(v)} PVe` },
    { k: 'control', v: d('control'), text: v => `contrôle des ennemis (+${fmt(v)} PVe)` },
    { k: 'potential', v: d('potential'), text: v => `mise en place pour l'équipe (+${fmt(v)} PVe de potentiel)` },
    { k: 'pendingDot', v: d('pendingDot'), text: v => `poisons gérés (+${fmt(v)} PVe)` },
    { k: 'allyLife', v: d('allyLife') + d('erosion'), text: v => `soins et protections (+${fmt(v)} PVe)` },
    { k: 'allyDeath', v: d('allyDeath'), text: v => `mort d'un allié évitée (+${fmt(v)} PVe)` },
    { k: 'scenario', v: d('scenario'), text: v => `objectif du scénario (+${fmt(v)} PVe)` },
  ]
  terms.sort((a, x) => x.v - a.v)
  const top = terms[0]
  return top && top.v > 0 ? top.text(top.v) : `gain de ${fmt(b.total - p.total)} PVe`
}

/** Note « coup créatif » (§10.3). */
export function creativeNote(view: AIView, plan: SearchPlan): Note | undefined {
  if (!plan.creative || !plan.breakdown || !plan.passBreakdown) return undefined
  const me = view.me
  const acts = plan.actions.filter(m => m.cat !== 'damage' || m.seq)
  const text = `${me.name} : ${(acts.length ? acts : plan.actions).map(m => describeMacro(view.fight, me, m, view.team)).join(', ')} — ${dominantReason(plan.breakdown, plan.passBreakdown)}`
  return { kind: 'creative', text, ...planGeometry(view.fight, view.team, plan.actions) }
}

/** Notes « tactique » d'un plan. */
export function tacticNotes(view: AIView, plan: SearchPlan): Note[] {
  const out: Note[] = []
  for (const id of plan.tactics ?? []) {
    const acts = plan.actions.filter(m => m.tactic === id)
    out.push({
      kind: 'tactic',
      text: `${view.me.name} — tactique « ${TACTIC_LABEL[id]} » : ${acts.map(m => describeMacro(view.fight, view.me, m, view.team)).join(', ')}`,
      ...planGeometry(view.fight, view.team, acts),
    })
  }
  return out
}

/** Note d'une intention. */
export function intentNote(s: FightState, it: Intent): Note {
  const t = it.target !== undefined ? s.fighters[it.target] : undefined
  const owner = s.fighters[it.owner]
  const text = it.explain || `${owner?.name ?? it.owner} : ${INTENT_LABEL[it.kind]}${t ? ` ${t.name}` : ''} (${fmt(it.price)} PVe)`
  return { kind: 'intent', text, cells: it.cells?.slice(0, 12), targets: t ? [t.id] : undefined }
}

/** Note de la cible prioritaire. */
export function focusNote(s: FightState, team: number, focus: readonly number[]): Note | undefined {
  const f = focus.length ? s.fighters[focus[0]] : undefined
  if (!f || !f.alive || f.team === team) return undefined
  // Case vue par l'équipe (un invisible adverse est montré sur sa dernière case connue).
  const cell = believedCell(f, team as 0 | 1)
  return { kind: 'focus', text: `Cible prioritaire de l'équipe : ${f.name}`, targets: [f.id], cells: cell >= 0 ? [cell] : undefined }
}

/** Émet une note dans le combat réel (enregistrée seulement si le combat enregistre ses événements). */
export function emitNote(engine: Engine, fight: FightState, fighterId: number, n: Note): void {
  if (!fight.options.record) return
  engine.emit(fight, { t: 'aiNote', fighter: fighterId, kind: n.kind, text: n.text, ...(n.cells?.length ? { cells: n.cells } : {}), ...(n.targets?.length ? { targets: n.targets } : {}) })
}
