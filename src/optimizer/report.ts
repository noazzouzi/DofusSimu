/**
 * Rapport d'optimisation (docs/design/ai.md §15.9) — WP4b : Markdown + JSON dans `docs/reports/`.
 *
 * Contenu : équipe et rôles, stuffs (objets, emplacements, exos, transcendances, points, parchemins, objets à sort
 * passif non simulé), variantes de sorts (sorts actifs, bascules acceptées), θ (écarts au défaut), plan de combat
 * (placement, rôles, heures vues par personnage au Vortex et heures « bon marché », rotations), taux de victoire
 * (robuste, par variante INCERTAINE, pire valeur, IC de Wilson), tours, morts, heures utilisées, frise des corruptions,
 * usage des tactiques, coups créatifs, causes d'échec, historique d'optimisation (L2-L5), rembobinage (optimiste) et
 * trois replays (victoire médiane, meilleure victoire, échec typique) rejoués avec `record: true`.
 *
 * Le rapport n'invente rien : chaque nombre vient d'un lot de combats joués (ou du proxy, signalé comme tel). La date
 * est fournie par l'appelant (`createdAt`) : aucune horloge dans le code de simulation.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defaultTheta, flattenTheta } from '../ai/theta'
import type { GameDataStore } from '../data/store'
import { C_VX_FALLBACK, ROMAN, VORTEX_SCENARIO_ID } from '../dungeons/vortex/constants'
import type { Replay } from '../replay/types'
import { computeBuildStats } from '../stats/build'
import { PRIMARY_STAT_NAMES_FR, type PrimaryStat } from '../stats/characteristicPoints'
import { EFFECT_PASSIVE_SPELL } from '../stats/effects'
import type { FightCache } from './cache'
import { notableSeeds, type FightExecutor } from './montecarlo'
import type { RewindResult } from './rewind'
import { runOne, toReplay } from './runner'
import { campaignSeeds } from './seeds'
import { failReasons, mean, variantMarginals, variantMinN, worstMarginal, worstVariant } from './stats'
import type { StuffResult } from './stuff/search'
import { findPreset } from './team/presets'
import type { CampaignResult } from './team/halving'
import { evaluateSpec, type ConfigEval, type TuneResult } from './tune'
import type { BatchResult, FightSpec, FightSummary, MemberSpec } from './types'
import type { VariantSearchResult } from './variants'

// ───────────────────────────── modèle du rapport ─────────────────────────────

export interface ReportItem {
  slot: string
  itemId: number
  name: string
  level: number
  set?: string
  forgemagie: string[]
  passiveUnsimulated: boolean
}

export interface ReportMember {
  name: string
  className: string
  presetId: string
  presetLabel?: string
  role?: string
  element?: string
  stats: { ap: number; mp: number; range: number; hp: number; mainStat: string; mainValue: number; critical: number; power: number }
  items: ReportItem[]
  points: Record<string, number>
  scrolls: Record<string, number>
  spells: { pair: number; active: string; activeId: number; other: string; changedFromPreset: boolean }[]
  rotation: string[]
}

export interface ReportPlan {
  placement?: number[]
  roles: { name: string; role?: string }[]
  /** Vortex : heures vues par chaque personnage (k = N joueurs, joueurs en tête), heures bon marché. */
  hours?: { name: string; hours: string[] }[]
  cheapHours?: string[]
  doctrine: string[]
}

export interface ReportResults {
  mode: string
  n: number
  result: BatchResult
  meanObjective: number
  meanDeaths: number
  meanHoursUsed: number
  /** Monstres corrompus moyens à la fin de chaque tour (frise). */
  corruptionTimeline: number[]
  worstVariant?: { key: string; n: number; winRate: number }
  worstValue?: { param: string; value: string; n: number; winRate: number; baseWinRate: number }
  marginals: { param: string; value: string; n: number; winRate: number; baseWinRate: number }[]
  failReasons: { reason: string; n: number }[]
  tactics: Record<string, number>
  creativeActions: number
  unknownEffects: number
  nodes: number
}

export interface ReportReplay {
  label: string
  seed: number
  file: string
  win: boolean
  rounds: number
  /** Le combat rejoué (`record: true`) est-il exactement celui du lot (même empreinte `eventsHash`) ? */
  reproduced?: boolean
}

export interface OptimizationReport {
  id: string
  title: string
  createdAt?: string
  scenarioId: string
  team: ReportMember[]
  theta: { changes: Record<string, [number, number]> }
  plan: ReportPlan
  results: ReportResults
  history: string[]
  stuff?: { member: string; startLogJ: number; bestLogJ: number; startDpt: number; bestDpt: number; startEhp: number; bestEhp: number; ms: number }[]
  variants?: { accepted: { member: string; pair: number; from: string; to: string; reason: string }[]; base: number; final: number }
  tune?: { accepted: boolean; diff: number; z: number; selected: string[] }
  campaign?: { stages: { name: string; teams: number; kept: string[] }[]; t0Evaluated?: number }
  rewind?: { seed: number; failRound: number; attempts: number; winningLine?: string; from?: number; robust?: string; replay?: string }
  replays: ReportReplay[]
  notes: string[]
}

// ───────────────────────────── construction ─────────────────────────────

const SLOT_FR: Readonly<Record<string, string>> = {
  amulet: 'Amulette', ring: 'Anneau', belt: 'Ceinture', boots: 'Bottes', hat: 'Coiffe', cloak: 'Cape', shield: 'Bouclier',
  weapon: 'Arme', pet: 'Familier/Monture', dofus: 'Dofus/Trophée', other: 'Autre',
}
const ELEMENT_FR: Readonly<Record<string, string>> = { earth: 'Terre', fire: 'Feu', water: 'Eau', air: 'Air' }
const MAIN_STAT: Readonly<Record<string, PrimaryStat>> = { earth: 'strength', fire: 'intelligence', water: 'chance', air: 'agility' }

/** Libellés français des caractéristiques de forgemagie (clé `Stats` sinon). */
const STAT_FR: Readonly<Record<string, string>> = {
  ap: 'PA', mp: 'PM', range: 'PO', summons: 'Invocations', vitality: 'Vitalité', wisdom: 'Sagesse', strength: 'Force',
  intelligence: 'Intelligence', chance: 'Chance', agility: 'Agilité', power: 'Puissance', damage: 'Dommages',
  critical: '% Critique', criticalDamage: 'Dommages critiques', heals: 'Soins', spellDamagePct: '% Dommages aux sorts',
  weaponDamagePct: '% Dommages d’armes', meleeDamagePct: '% Dommages mêlée', rangedDamagePct: '% Dommages distance',
  earthDamage: 'Dommages Terre', fireDamage: 'Dommages Feu', waterDamage: 'Dommages Eau', airDamage: 'Dommages Air',
  neutralDamage: 'Dommages Neutre', pushDamage: 'Dommages de poussée', mpReduction: 'Retrait PM', apReduction: 'Retrait PA',
  mpParry: 'Esquive PM', apParry: 'Esquive PA', tackleBlock: 'Tacle', tackleEvade: 'Fuite', initiative: 'Initiative',
  criticalRes: 'Résistance critique', pushRes: 'Résistance poussée', earthResPct: '% Résistance Terre',
  fireResPct: '% Résistance Feu', waterResPct: '% Résistance Eau', airResPct: '% Résistance Air',
  neutralResPct: '% Résistance Neutre', meleeResPct: '% Résistance mêlée', rangedResPct: '% Résistance distance',
}

function forgeLabel(stat: string, value: number, kind?: string): string {
  const name = STAT_FR[stat] ?? stat
  return kind === 'transcendence' ? `transcendance ${name} +${value}` : `exo ${name} +${value}`
}

/** Description d'un membre (stuff, points, variantes, rotation). */
export function describeMember(data: GameDataStore, m: MemberSpec): ReportMember {
  const preset = findPreset(m.presetId)
  const r = computeBuildStats(m.build, data)
  const el = preset?.element ?? 'earth'
  const main = MAIN_STAT[el]
  const items: ReportItem[] = m.build.items.map(eq => {
    const it = data.item(eq.itemId)
    return {
      slot: SLOT_FR[it?.slot ?? 'other'],
      itemId: eq.itemId,
      name: it?.name ?? `objet ${eq.itemId}`,
      level: it?.level ?? 0,
      set: it?.setId != null ? data.itemSet(it.setId)?.name : undefined,
      forgemagie: (eq.exos ?? []).map(x => forgeLabel(x.stat, x.value, x.kind)),
      passiveUnsimulated: !!it?.effects.some(e => e.effectId === EFFECT_PASSIVE_SPELL),
    }
  })
  const breed = data.breed(m.breedId)
  const variants = m.variants.length ? m.variants : (m.build.spellVariants ?? [])
  const spells = (breed?.spellPairs ?? []).map(([a, b], pair) => {
    const v = variants[pair] ?? 0
    const active = v ? b : a
    const other = v ? a : b
    return {
      pair,
      active: data.spell(active)?.name ?? String(active),
      activeId: active,
      other: data.spell(other)?.name ?? String(other),
      changedFromPreset: !!preset && (preset.variants[pair] ?? 0) !== v,
    }
  })
  const rotation = (preset?.rotation ?? []).map(s => `${data.spell(s.spell)?.name ?? s.spell}${s.repeat && s.repeat > 1 ? ` ×${s.repeat}` : ''}`)
  const pts: Record<string, number> = {}
  for (const [k, v] of Object.entries(m.build.characteristicPoints)) if (v) pts[PRIMARY_STAT_NAMES_FR[k as PrimaryStat]] = v
  const scrolls: Record<string, number> = {}
  for (const [k, v] of Object.entries(m.build.scrolls)) if (v) scrolls[PRIMARY_STAT_NAMES_FR[k as PrimaryStat]] = v
  return {
    name: m.name,
    className: preset?.className ?? breed?.name ?? String(m.breedId),
    presetId: m.presetId,
    presetLabel: preset?.label,
    role: m.role ?? preset?.role,
    element: ELEMENT_FR[el],
    stats: {
      ap: r.stats.ap,
      mp: r.stats.mp,
      range: r.stats.range,
      hp: r.maxHp,
      mainStat: PRIMARY_STAT_NAMES_FR[main],
      mainValue: r.stats[main],
      critical: r.stats.critical,
      power: r.stats.power,
    },
    items,
    points: pts,
    scrolls,
    spells,
    rotation,
  }
}

/** Plan de combat lisible (rôles, placement, heures du Vortex vues par chaque personnage). */
export function fightPlan(spec: FightSpec, members: readonly ReportMember[]): ReportPlan {
  const plan: ReportPlan = { placement: spec.placement, roles: members.map(m => ({ name: m.name, role: m.role })), doctrine: [] }
  if (spec.scenarioId === VORTEX_SCENARIO_ID) {
    const n = members.length
    // Joueurs en tête (k = N) : P_i voit les heures i, i + N, i + 2N… (mod 12) au début de ses tours.
    plan.hours = members.map((m, i) => {
      const hs: string[] = []
      for (let h = i + 1; hs.length < 12 / gcd(n, 12); h += n) hs.push(ROMAN[((h - 1) % 12) + 1])
      return { name: m.name, hours: hs }
    })
    plan.cheapHours = C_VX_FALLBACK.map((c, h) => ({ c, h })).filter(x => x.h > 0 && x.c <= 600).sort((a, b) => a.c - b.c).map(x => `${ROMAN[x.h]} (${x.c} PVe)`)
    plan.doctrine.push(
      'Marquer chaque monstre à une heure bon marché vue par un tueur vivant, le corrompre 3 tours plus tard (même tueur à 4 joueurs).',
      'Éviter les kills à V et XI (bonus majeurs hérités par le Vortex) ; ne pas finir son tour sur la croix de l’Auroraire au tour du Vortex.',
      'Retrait de PM sur les monstres de mêlée (Ikargn, Buboxor, Brabuzar) ; soigner le poison des Harpilles.',
      'Phase 2 : 2 tours de préparation (buffs, placement hors des lignes du Vortex), burst au premier tour vulnérable.',
    )
  }
  return plan
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

/** Résultats agrégés d'un lot (taux robustes, variantes, frise, tactiques). */
export function aggregateResults(mode: string, e: ConfigEval): ReportResults {
  const s = e.summaries
  const maxLen = Math.max(0, ...s.map(x => x.corruptedByRound.length))
  const timeline: number[] = []
  for (let r = 0; r < maxLen; r++) timeline.push(mean(s.map(x => x.corruptedByRound[Math.min(r, x.corruptedByRound.length - 1)] ?? 0)))
  const tactics: Record<string, number> = {}
  for (const x of s) for (const [k, v] of Object.entries(x.tactics)) tactics[k] = (tactics[k] ?? 0) + (v ?? 0)
  const wv = worstVariant(e.result, variantMinN(s.length))
  const wm = worstMarginal(s, variantMinN(s.length))
  return {
    mode,
    n: s.length,
    result: e.result,
    meanObjective: e.objective,
    meanDeaths: mean(s.map(x => x.deaths)),
    meanHoursUsed: mean(s.map(x => x.hoursUsed)),
    corruptionTimeline: timeline.map(v => Math.round(v * 100) / 100),
    worstVariant: wv,
    worstValue: wm && { param: wm.param, value: wm.value, n: wm.n, winRate: wm.winRate, baseWinRate: wm.baseWinRate },
    marginals: variantMarginals(s).map(m => ({ param: m.param, value: m.value, n: m.n, winRate: m.winRate, baseWinRate: m.baseWinRate })),
    failReasons: failReasons(s),
    tactics,
    creativeActions: s.reduce((a, x) => a + x.creativeActions, 0),
    unknownEffects: s.reduce((a, x) => a + x.unknownEffects, 0),
    nodes: s.reduce((a, x) => a + x.nodes, 0),
  }
}

/** Écarts de θ au θ par défaut (chemin → [défaut, valeur]). */
export function thetaChanges(theta: FightSpec['theta']): Record<string, [number, number]> {
  const a = flattenTheta(defaultTheta())
  const b = flattenTheta(theta)
  const out: Record<string, [number, number]> = {}
  for (const k of Object.keys(b)) if (a[k] !== b[k]) out[k] = [a[k], b[k]]
  return out
}

export interface ReportInput {
  id: string
  title?: string
  createdAt?: string
  spec: FightSpec
  /** Lot de validation (déjà joué) ; sinon joué par `generateReport`. */
  evaluation: ConfigEval
  stuff?: readonly StuffResult[]
  variants?: VariantSearchResult
  tune?: TuneResult
  campaign?: CampaignResult
  rewind?: RewindResult & { seed: number }
  history?: readonly string[]
  notes?: readonly string[]
}

/** Construit le rapport (sans écrire de fichier). */
export function buildReport(data: GameDataStore, input: ReportInput): OptimizationReport {
  const team = input.spec.team.map(m => describeMember(data, m))
  const notes = [...(input.notes ?? [])]
  const passives = team.flatMap(m => m.items.filter(i => i.passiveUnsimulated).map(i => `${m.name} : ${i.name}`))
  if (passives.length) notes.push(`Sorts passifs d’objets NON simulés par le moteur (seules leurs lignes de caractéristiques comptent) : ${passives.join(' ; ')}.`)
  if (input.evaluation.summaries.every(s => s.nodes === 0) && input.spec.mode !== 'scripted') {
    notes.push(`Aucun nœud simulé en mode ${input.spec.mode} : l’IA de groupe (WP2) est encore un bouchon glouton ; les taux reflètent ce bouchon.`)
  }
  const report: OptimizationReport = {
    id: input.id,
    title: input.title ?? `Optimisation — ${input.spec.scenarioId}`,
    createdAt: input.createdAt,
    scenarioId: input.spec.scenarioId,
    team,
    theta: { changes: thetaChanges(input.spec.theta) },
    plan: fightPlan(input.spec, team),
    results: aggregateResults(input.spec.mode, input.evaluation),
    history: [...(input.history ?? []), ...(input.campaign?.log ?? [])],
    replays: [],
    notes,
  }
  if (input.stuff) {
    report.stuff = input.stuff.map(s => ({
      member: s.member,
      startLogJ: s.start.score.logJ,
      bestLogJ: s.best.score.logJ,
      startDpt: s.start.score.dpt,
      bestDpt: s.best.score.dpt,
      startEhp: s.start.score.ehp,
      bestEhp: s.best.score.ehp,
      ms: s.ms,
    }))
  }
  if (input.variants) {
    report.variants = {
      accepted: input.variants.accepted.map(t => ({
        member: input.spec.team[t.member]?.name ?? String(t.member),
        pair: t.pair,
        from: data.spell(t.spellFrom)?.name ?? String(t.spellFrom),
        to: data.spell(t.spellTo)?.name ?? String(t.spellTo),
        reason: t.reason,
      })),
      base: input.variants.base.objective,
      final: input.variants.final.objective,
    }
  }
  if (input.tune) report.tune = { accepted: input.tune.accepted, diff: input.tune.validation.paired.diff, z: input.tune.validation.paired.z, selected: input.tune.selected }
  if (input.campaign) {
    report.campaign = {
      stages: input.campaign.halving.stages.map(s => ({ name: s.name, teams: s.entries.length, kept: s.entries.filter(e => e.kept).sort((a, b) => a.rank - b.rank).map(e => e.id) })),
      t0Evaluated: input.campaign.t0?.evaluated,
    }
  }
  if (input.rewind) {
    const r = input.rewind
    report.rewind = { seed: r.seed, failRound: r.failRound, attempts: r.attempts.length, winningLine: r.winningLine?.label, from: r.winningLine?.from, robust: r.robust?.best }
  }
  return report
}

// ───────────────────────────── rendu Markdown ─────────────────────────────

const pct = (x: number) => `${(100 * x).toFixed(1)} %`
const esc = (s: string) => s.replace(/\|/g, '\\|')

/** Rendu Markdown (français) d'un rapport. */
export function renderMarkdown(r: OptimizationReport): string {
  const L: string[] = []
  const res = r.results
  L.push(`# ${r.title}`, '')
  if (r.createdAt) L.push(`*Généré le ${r.createdAt}* — scénario \`${r.scenarioId}\`, mode \`${res.mode}\`, ${res.n} combats.`, '')
  else L.push(`Scénario \`${r.scenarioId}\`, mode \`${res.mode}\`, ${res.n} combats.`, '')
  L.push('## Résultat', '')
  L.push(`| Taux de victoire | IC 95 % (Wilson) | Objectif moyen | Tours moyens | Morts moyennes | PV restants (p10) | Heures utilisées |`)
  L.push('|---|---|---|---|---|---|---|')
  L.push(`| **${pct(res.result.winRate)}** (${res.result.wins}/${res.result.n}) | ${pct(res.result.wilson95[0])} – ${pct(res.result.wilson95[1])} | ${res.meanObjective.toFixed(3)} | ${res.result.meanRounds.toFixed(1)} | ${res.meanDeaths.toFixed(2)} | ${pct(res.result.p10HpLeft)} | ${res.meanHoursUsed.toFixed(1)} |`, '')
  if (res.worstVariant && res.worstVariant.key !== 'default') L.push(`Pire variante INCERTAINE (≥ ${variantMinN(res.n)} combats) : \`${res.worstVariant.key}\` — ${pct(res.worstVariant.winRate)} sur ${res.worstVariant.n}.`, '')
  // Valeur pénalisante seulement si elle fait réellement perdre des victoires (0 % contre 0 % n'apprend rien).
  if (res.worstValue && res.worstValue.winRate < res.worstValue.baseWinRate) L.push(`Valeur INCERTAINE la plus pénalisante : \`${res.worstValue.param}=${res.worstValue.value}\` — ${pct(res.worstValue.winRate)} (${res.worstValue.n} combats) contre ${pct(res.worstValue.baseWinRate)} au défaut.`, '')
  if (res.failReasons.length) {
    L.push('Causes d’échec : ' + res.failReasons.map(f => `${f.reason} (${f.n})`).join(', ') + '.', '')
  }
  if (res.corruptionTimeline.some(v => v > 0)) {
    L.push('Frise des corruptions (monstres corrompus en moyenne, fin de chaque tour) :', '')
    L.push('`' + res.corruptionTimeline.map((v, i) => `T${i + 1}:${v}`).join(' ') + '`', '')
  }
  const tac = Object.entries(res.tactics).sort((a, b) => b[1] - a[1])
  L.push(`Tactiques utilisées : ${tac.length ? tac.map(([k, v]) => `${k} ×${v}`).join(', ') : 'aucune'} ; coups créatifs : ${res.creativeActions} ; effets non simulés rencontrés : ${res.unknownEffects} ; nœuds simulés : ${res.nodes}.`, '')

  L.push('## Équipe', '')
  L.push('| Personnage | Classe | Preset | Rôle | Élément | PA/PM/PO | PV | Carac. principale | CC | Puissance |')
  L.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const m of r.team) {
    L.push(`| ${esc(m.name)} | ${esc(m.className)} | \`${m.presetId}\` | ${m.role ?? ''} | ${m.element ?? ''} | ${m.stats.ap}/${m.stats.mp}/${m.stats.range} | ${m.stats.hp} | ${m.stats.mainStat} ${m.stats.mainValue} | ${m.stats.critical} | ${m.stats.power} |`)
  }
  L.push('')
  for (const m of r.team) {
    L.push(`### ${m.name} — ${m.className} (${m.presetLabel ?? m.presetId})`, '')
    L.push('| Emplacement | Objet | Niv. | Panoplie | Forgemagie |')
    L.push('|---|---|---|---|---|')
    for (const it of m.items) L.push(`| ${it.slot} | ${esc(it.name)}${it.passiveUnsimulated ? ' ⁽¹⁾' : ''} | ${it.level} | ${esc(it.set ?? '')} | ${it.forgemagie.join(', ')} |`)
    L.push('')
    L.push(`Points : ${Object.entries(m.points).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucun'} ; parchemins : ${Object.entries(m.scrolls).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucun'}.`, '')
    const changed = m.spells.filter(s => s.changedFromPreset)
    L.push(`Variantes de sorts : ${m.spells.map(s => s.active).join(', ')}.`)
    if (changed.length) L.push(`Bascules par rapport au preset : ${changed.map(s => `${s.other} → **${s.active}**`).join(', ')}.`)
    if (m.rotation.length) L.push(`Rotation de référence : ${m.rotation.join(' → ')}.`)
    L.push('')
  }
  if (r.team.some(m => m.items.some(i => i.passiveUnsimulated))) L.push('⁽¹⁾ sort passif d’objet non simulé par le moteur : seules ses caractéristiques comptent.', '')

  L.push('## Plan de combat', '')
  if (r.plan.placement) L.push(`Placement : ${r.plan.placement.join(', ')}.`, '')
  L.push(`Rôles : ${r.plan.roles.map(x => `${x.name} (${x.role ?? '—'})`).join(', ')}.`, '')
  if (r.plan.hours) {
    L.push('Heures vues au début de leurs tours (joueurs en tête, sans glyphe) :', '')
    for (const h of r.plan.hours) L.push(`- ${h.name} : ${h.hours.join(', ')}`)
    L.push('')
  }
  if (r.plan.cheapHours) L.push(`Heures bon marché pour le Vortex (coût PVe, table de repli) : ${r.plan.cheapHours.join(', ')}.`, '')
  for (const d of r.plan.doctrine) L.push(`- ${d}`)
  if (r.plan.doctrine.length) L.push('')

  const changes = Object.entries(r.theta.changes)
  L.push('## Paramètres de stratégie θ', '')
  L.push(changes.length ? changes.map(([k, [a, b]]) => `- \`${k}\` : ${a} → **${b}**`).join('\n') : 'θ par défaut (data/ai/theta-default.json).', '')

  if (r.stuff || r.variants || r.tune || r.campaign || r.history.length) {
    L.push('## Historique d’optimisation', '')
    if (r.campaign) {
      if (r.campaign.t0Evaluated) L.push(`- T0 analytique : ${r.campaign.t0Evaluated} équipes notées.`)
      for (const s of r.campaign.stages) L.push(`- ${s.name} : ${s.teams} équipes → ${s.kept.length} gardées (${s.kept.slice(0, 4).join(' ; ')}${s.kept.length > 4 ? ' ; …' : ''}).`)
    }
    if (r.stuff) for (const s of r.stuff) L.push(`- Stuff ${s.member} (proxy) : log J ${s.startLogJ.toFixed(3)} → ${s.bestLogJ.toFixed(3)} (DPT ${s.startDpt.toFixed(0)} → ${s.bestDpt.toFixed(0)}, EHP ${s.startEhp.toFixed(0)} → ${s.bestEhp.toFixed(0)}, ${(s.ms / 1000).toFixed(1)} s).`)
    if (r.variants) L.push(`- Variantes : objectif ${r.variants.base.toFixed(3)} → ${r.variants.final.toFixed(3)} ; ${r.variants.accepted.map(a => `${a.member} : ${a.from} → ${a.to} (${a.reason})`).join(' ; ') || 'aucune bascule significative'}.`)
    if (r.tune) L.push(`- θ (CEM) : ${r.tune.accepted ? 'accepté' : 'rejeté, θ₀ conservé'} (Δ ${r.tune.diff.toFixed(4)}, z ${r.tune.z.toFixed(2)} ; ${r.tune.selected.length} paramètres).`)
    for (const h of r.history) L.push(`- ${h}`)
    L.push('')
  }
  if (r.rewind) {
    L.push('## Rembobinage (optimiste)', '')
    L.push(`Graine ${r.rewind.seed} : échec au tour ${r.rewind.failRound}, ${r.rewind.attempts} reprise(s). ${r.rewind.winningLine ? `Ligne gagnante « mêmes dés » : reprise au tour ${r.rewind.from}, ${r.rewind.winningLine}.` : 'Aucune ligne gagnante trouvée.'}${r.rewind.robust ? ` Alternative la plus robuste au point de contrôle : ${r.rewind.robust}.` : ''}`, '')
    L.push('*Une ligne trouvée par rembobinage n’est jamais comptée dans un taux de victoire.*', '')
  }
  if (r.replays.length) {
    L.push('## Replays', '')
    for (const p of r.replays) L.push(`- ${p.label} — graine ${p.seed}, ${p.win ? 'victoire' : 'défaite'} en ${p.rounds} tours : \`${p.file}\``)
    L.push('')
  }
  if (r.notes.length) {
    L.push('## Notes et limites', '')
    for (const n of r.notes) L.push(`- ${n}`)
    L.push('')
  }
  return L.join('\n')
}

// ───────────────────────────── écriture ─────────────────────────────

export interface WriteOptions {
  /** Dossier des rapports (défaut docs/reports). */
  dir?: string
}

/** Écrit `<dir>/<id>.md`, `<dir>/<id>.json` (et les replays déjà référencés). Renvoie les chemins. */
export function writeReport(report: OptimizationReport, replays: ReadonlyMap<string, Replay> = new Map(), opts: WriteOptions = {}): { markdown: string; json: string; replays: string[] } {
  const dir = resolve(opts.dir ?? 'docs/reports')
  mkdirSync(dir, { recursive: true })
  const written: string[] = []
  for (const [file, replay] of replays) {
    const path = join(dir, file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(replay))
    written.push(path)
  }
  const md = join(dir, `${report.id}.md`)
  const json = join(dir, `${report.id}.json`)
  writeFileSync(md, renderMarkdown(report))
  writeFileSync(json, JSON.stringify(report, null, 2))
  return { markdown: md, json, replays: written }
}

export interface GenerateOptions extends Omit<ReportInput, 'evaluation' | 'spec' | 'id'> {
  id: string
  /** Combats du lot de validation (défaut 64). */
  seeds?: number
  masterSeed?: number
  cache?: FightCache
  /** Rejouer et écrire les trois replays notables (défaut vrai). */
  replays?: boolean
  dir?: string
  evaluation?: ConfigEval
}

/**
 * Joue le lot de validation (si absent), rejoue les combats notables avec `record: true`, construit et écrit le
 * rapport. Renvoie le rapport et les chemins écrits.
 */
export async function generateReport(data: GameDataStore, spec: FightSpec, pool: FightExecutor, opts: GenerateOptions): Promise<{ report: OptimizationReport; files: { markdown: string; json: string; replays: string[] } }> {
  const evaluation = opts.evaluation ?? (await evaluateSpec(spec, campaignSeeds(opts.masterSeed ?? 0x2e9047, opts.seeds ?? 64), pool, { cache: opts.cache }))
  const report = buildReport(data, { ...opts, spec, evaluation })
  const replays = new Map<string, Replay>()
  if (opts.replays ?? true) {
    const notable = notableSeeds(evaluation.summaries)
    const picks: [string, number | undefined][] = [['Victoire médiane', notable.medianWin], ['Meilleure victoire', notable.bestWin], ['Échec typique', notable.typicalFail]]
    const done = new Set<number>()
    for (const [label, seed] of picks) {
      if (seed === undefined || done.has(seed)) continue
      done.add(seed)
      const run = runOne(data, spec, seed, { record: true, explain: true })
      const file = `${opts.id}/replay-${seed}.json`
      replays.set(file, toReplay(data, spec, run, { title: `${report.title} — ${label}`, generator: 'dofussimu-report', createdAt: opts.createdAt }))
      // Le replay doit montrer LE combat compté dans le lot (§13.2 : record on/off ⇒ même combat).
      const counted = evaluation.summaries.find(x => x.seed === seed)
      const reproduced = !!counted && counted.eventsHash === run.summary.eventsHash
      if (!reproduced) report.notes.push(`Replay de la graine ${seed} : le combat rejoué diffère de celui du lot (empreintes différentes) — déterminisme à vérifier.`)
      report.replays.push({ label, seed, file, win: run.summary.win, rounds: run.summary.rounds, reproduced })
    }
  }
  if (opts.rewind?.winningLine?.replay) {
    const file = `${opts.id}/rewind-${opts.rewind.seed}.json`
    replays.set(file, opts.rewind.winningLine.replay)
    if (report.rewind) report.rewind.replay = file
    report.replays.push({ label: 'Rembobinage — ligne gagnante (optimiste)', seed: opts.rewind.seed, file, win: true, rounds: opts.rewind.winningLine.summary.rounds })
  }
  const files = writeReport(report, replays, { dir: opts.dir })
  return { report, files }
}

/** Résumés d'un lot (outils). */
export function summariesOf(e: ConfigEval): readonly FightSummary[] {
  return e.summaries
}
