/**
 * Recherche de composition (niveau L5, docs/design/ai.md §15.6 points 3-5) — WP4b.
 *
 *  - `successiveHalving` : les équipes candidates (top T0) passent des étages de plus en plus chers sur des graines
 *    COMMUNES (CRN) : T1 = micro-scénarios (`prefix12` + `phase2` pour le Vortex : objectif moyen des deux), 16 graines,
 *    → T2 = combat complet, 64 graines → finalistes. Classement d'un étage (§15.2) : borne basse de Wilson à 95 % si
 *    au moins une victoire (+1), sinon objectif moyen ; départage par objectif moyen puis identifiant. Diversité
 *    (étage marqué `diversity`) : au moins une équipe par archétype présent (avec/sans soigneur × avec/sans placeur)
 *    parmi les équipes gardées ;
 *  - `coOptimizeTeam` : co-optimisation d'une équipe finaliste L3 (stuff de chaque membre : proxy + validation par
 *    combats) → L4 (variantes) → L2 (θ) puis une seconde passe L3 → L4 (budgets réglables) ;
 *  - `calibrateT0` : ajuste les deux paramètres libres du modèle T0 (efficacité des dégâts, exposition) sur des
 *    scores de combats observés (moindres carrés sur une grille) — le modèle analytique suit ainsi l'IA réellement
 *    utilisée (bouchons compris) ;
 *  - `runCompositionCampaign` : T0 → halving → co-optimisation → validation (mode final, ex. `standard`).
 */
import type { AIMode } from '../../ai/types'
import type { GameDataStore } from '../../data/store'
import type { FightCache } from '../cache'
import type { FightExecutor } from '../montecarlo'
import { campaignSeeds } from '../seeds'
import { rankKey, summarizeBatch, wilson } from '../stats'
import { optimizeStuff, type StuffResult, type StuffSearchOptions } from '../stuff/search'
import { validateStuffs, type StuffValidation } from '../stuff/validate'
import { evaluateSpecs, tuneThetaByFights, type ConfigEval, type Objective, type TuneOptions, type TuneResult } from '../tune'
import type { BatchResult, FightSpec, FightSummary, MemberSpec, WorkerTask } from '../types'
import { optimizeVariants, type VariantSearchOptions, type VariantSearchResult } from '../variants'
import { findPreset, presetMember, resolvePreset, type Preset } from './presets'
import { archetypeKey, archetypeOf } from './prior'
import { defaultT0Params, t0Evaluate, t0Rank, type PresetCapability, type T0Params, type T0RankOptions, type T0Result } from './t0model'

// ───────────────────────────── candidats ─────────────────────────────

export interface TeamCandidate {
  id: string
  team: MemberSpec[]
  t0?: T0Result
  archetype: string
}

/** Identifiant stable d'une équipe (presets triés). */
export function teamId(team: readonly Pick<MemberSpec, 'presetId'>[]): string {
  return team.map(m => m.presetId).slice().sort().join('+')
}

/** Candidat depuis une liste de presets (stuff du preset ; noms uniques « Iop », « Iop 2 »). */
export function candidateFromPresets(data: GameDataStore, presets: readonly Preset[], t0?: T0Result): TeamCandidate {
  const names = new Map<string, number>()
  const team = presets.map(p => {
    const k = (names.get(p.className) ?? 0) + 1
    names.set(p.className, k)
    return presetMember(p, data, { name: k > 1 ? `${p.className} ${k}` : p.className })
  })
  return { id: teamId(team), team, t0, archetype: archetypeKey(archetypeOf(presets)) }
}

/** Candidats depuis un classement T0. */
export function candidatesFromT0(data: GameDataStore, ranking: readonly T0Result[]): TeamCandidate[] {
  return ranking.map(r => candidateFromPresets(data, r.presetIds.map(id => resolvePreset(id)), r))
}

// ───────────────────────────── successive halving ─────────────────────────────

export interface HalvingStage {
  name: string
  /** Types de tâches de l'étage (objectif = moyenne par graine des types). */
  kinds: readonly WorkerTask['kind'][]
  seeds: number
  /** Équipes gardées à la sortie de l'étage. */
  keep: number
  /** Mode de l'IA de l'étage (défaut : celui de la spécification de base). */
  mode?: AIMode
  /** Imposer la diversité d'archétypes parmi les équipes gardées. */
  diversity?: boolean
}

/** Étages par défaut du design (§15.6) : T1 micro (16 graines, 40 gardées) → T2 complet (64 graines, 4 gardées). */
export const DEFAULT_STAGES: readonly HalvingStage[] = [
  { name: 'T1 micro', kinds: ['prefix12', 'phase2'], seeds: 16, keep: 40, diversity: true },
  { name: 'T2 complet', kinds: ['full'], seeds: 64, keep: 4 },
]

export interface StageEntry {
  id: string
  archetype: string
  objective: number
  winRate: number
  wilson95: [number, number]
  key: number
  rank: number
  kept: boolean
  result: BatchResult
}

export interface HalvingResult {
  stages: { name: string; entries: StageEntry[] }[]
  winners: TeamCandidate[]
  fights: number
}

export interface HalvingOptions {
  stages?: readonly HalvingStage[]
  masterSeed?: number
  cache?: FightCache
  objective?: Objective
  onStage?(name: string, entries: StageEntry[]): void
}

/** Clé de classement d'un étage (voir l'en-tête). */
export function stageKey(r: BatchResult, objective: number): number {
  return r.wins > 0 ? 1 + rankKey(r) : objective
}

/** Successive halving sur les candidats (voir l'en-tête). `base` : scénario, mode, θ… (l'équipe est remplacée). */
export async function successiveHalving(base: Omit<FightSpec, 'team'>, candidates: readonly TeamCandidate[], pool: FightExecutor, opts: HalvingOptions = {}): Promise<HalvingResult> {
  const stages = opts.stages ?? DEFAULT_STAGES
  let current = candidates.slice()
  const out: HalvingResult['stages'] = []
  let fights = 0
  for (let si = 0; si < stages.length; si++) {
    const st = stages[si]
    const seeds = campaignSeeds((opts.masterSeed ?? 0x4a1f) + si * 0x1000, st.seeds)
    const specs: FightSpec[] = current.map(c => ({ ...base, mode: st.mode ?? base.mode, team: c.team }))
    const perKind: ConfigEval[][] = []
    for (const kind of st.kinds) {
      perKind.push(await evaluateSpecs(specs, seeds, pool, { kind, cache: opts.cache, objective: opts.objective }))
      fights += specs.length * seeds.length
    }
    const entries: StageEntry[] = current.map((c, i) => {
      const summaries: FightSummary[] = perKind.flatMap(e => e[i].summaries)
      const objective = perKind.reduce((a, e) => a + e[i].objective, 0) / perKind.length
      // Résultat de l'étage : victoires du dernier type « complet » s'il existe, sinon de tous les types.
      const full = st.kinds.indexOf('full')
      const result = full >= 0 ? perKind[full][i].result : summarizeBatch(summaries)
      return { id: c.id, archetype: c.archetype, objective, winRate: result.winRate, wilson95: wilson(result.wins, result.n), key: stageKey(result, objective), rank: 0, kept: false, result }
    })
    const order = entries.map((e, i) => i).sort((a, b) => entries[b].key - entries[a].key || entries[b].objective - entries[a].objective || entries[a].id.localeCompare(entries[b].id))
    order.forEach((i, r) => (entries[i].rank = r + 1))
    let kept = order.slice(0, Math.min(st.keep, order.length))
    if (st.diversity) kept = enforceDiversity(order, kept, entries)
    for (const i of kept) entries[i].kept = true
    out.push({ name: st.name, entries })
    opts.onStage?.(st.name, entries)
    current = kept.map(i => current[i])
  }
  return { stages: out, winners: current, fights }
}

/** Au moins une équipe par archétype présent parmi les gardées (remplace les dernières non uniques). */
export function enforceDiversity(order: readonly number[], kept: number[], entries: readonly Pick<StageEntry, 'archetype' | 'rank'>[]): number[] {
  const out = kept.slice()
  const archetypes = [...new Set(order.map(i => entries[i].archetype))].sort()
  for (const a of archetypes) {
    if (out.some(i => entries[i].archetype === a)) continue
    const best = order.find(i => entries[i].archetype === a)
    if (best === undefined) continue
    // Remplacer la moins bonne équipe gardée dont l'archétype reste représenté sans elle.
    for (let k = out.length - 1; k >= 0; k--) {
      const arch = entries[out[k]].archetype
      if (out.filter(i => entries[i].archetype === arch).length > 1) {
        out[k] = best
        break
      }
    }
  }
  return out.sort((x, y) => entries[x].rank - entries[y].rank)
}

// ───────────────────────────── calibration de T0 ─────────────────────────────

export interface T0Observation {
  capabilities: readonly PresetCapability[]
  presets?: readonly Preset[]
  /** Score moyen observé (même format que `T0Result.predicted`). */
  observed: number
}

/**
 * Ajuste `efficiency` et `exposure` de T0 par moindres carrés sur une grille (efficacité 0,2-1,0 ; exposition
 * 0,25-2,0). Renvoie les paramètres et l'erreur quadratique moyenne.
 */
export function calibrateT0(observations: readonly T0Observation[], base: T0Params): { params: T0Params; mse: number; grid: number } {
  let best = { params: base, mse: Infinity }
  let grid = 0
  for (let e = 0.2; e <= 1.0001; e += 0.05) {
    for (let x = 0.25; x <= 2.0001; x += 0.125) {
      const params = { ...base, efficiency: Math.round(e * 100) / 100, exposure: Math.round(x * 1000) / 1000 }
      let se = 0
      for (const o of observations) {
        const r = t0Evaluate(o.capabilities, params, o.presets)
        se += (r.predicted - o.observed) ** 2
      }
      grid++
      const mse = observations.length ? se / observations.length : 0
      if (mse < best.mse - 1e-12) best = { params, mse }
    }
  }
  return { ...best, grid }
}

// ───────────────────────────── co-optimisation ─────────────────────────────

export interface CoOptOptions {
  stuff?: StuffSearchOptions | false
  stuffValidation?: { seeds?: number; kinds?: readonly WorkerTask['kind'][] } | false
  variants?: VariantSearchOptions | false
  theta?: (TuneOptions & { kind?: WorkerTask['kind'] }) | false
  /** Passes L3 → L4 après le réglage de θ (défaut 1, design : « une seconde passe L3 → L4 »). */
  secondPass?: boolean
  cache?: FightCache
  objective?: Objective
}

export interface CoOptResult {
  team: MemberSpec[]
  theta: FightSpec['theta']
  stuff: { member: string; result: StuffResult; validation?: StuffValidation }[][]
  variants: VariantSearchResult[]
  tune?: TuneResult
  log: string[]
}

/** Co-optimisation L3 → L4 → L2 (→ L3 → L4) d'une équipe (voir l'en-tête). */
export async function coOptimizeTeam(data: GameDataStore, base: FightSpec, pool: FightExecutor, opts: CoOptOptions = {}): Promise<CoOptResult> {
  let spec: FightSpec = { ...base, team: base.team.slice() }
  const log: string[] = []
  const stuffPasses: CoOptResult['stuff'] = []
  const variantPasses: VariantSearchResult[] = []
  let tune: TuneResult | undefined

  const stuffPass = async () => {
    if (opts.stuff === false) return
    const pass: CoOptResult['stuff'][number] = []
    for (let i = 0; i < spec.team.length; i++) {
      const m = spec.team[i]
      const result = optimizeStuff(data, m, opts.stuff || {})
      let validation: StuffValidation | undefined
      let chosen = result.best.build
      if (opts.stuffValidation !== false) {
        const cands = result.front.filter(c => c.key !== 'start')
        validation = await validateStuffs(spec, i, cands, pool, { ...(opts.stuffValidation || {}), cache: opts.cache, objective: opts.objective })
        chosen = validation.builds[validation.chosen]
      }
      spec = { ...spec, team: spec.team.map((x, k) => (k === i ? { ...x, build: { ...chosen, spellVariants: x.build.spellVariants ?? chosen.spellVariants } } : x)) }
      log.push(`L3 ${m.name} : proxy ${result.start.score.logJ.toFixed(3)} → ${result.best.score.logJ.toFixed(3)}${validation ? `, combats : build ${validation.chosen} retenu (objectif ${validation.objectives[validation.chosen].toFixed(3)} contre ${validation.objectives[0].toFixed(3)})` : ''}`)
      pass.push({ member: m.name, result, validation })
    }
    stuffPasses.push(pass)
  }
  const variantPass = async () => {
    if (opts.variants === false) return
    const r = await optimizeVariants(data, spec, pool, { ...(opts.variants || {}), cache: opts.cache, objective: opts.objective })
    spec = { ...spec, team: r.team }
    variantPasses.push(r)
    log.push(`L4 : ${r.accepted.length} bascule(s), objectif ${r.base.objective.toFixed(3)} → ${r.final.objective.toFixed(3)}`)
  }
  await stuffPass()
  await variantPass()
  if (opts.theta !== false) {
    tune = await tuneThetaByFights(spec, pool, { ...(opts.theta || {}), cache: opts.cache, objective: opts.objective })
    spec = { ...spec, theta: tune.theta }
    log.push(`L2 : θ ${tune.accepted ? 'accepté' : 'rejeté (θ₀ conservé)'}, validation Δ ${tune.validation.paired.diff.toFixed(4)} (z ${tune.validation.paired.z.toFixed(2)})`)
  }
  if (opts.secondPass ?? true) {
    await stuffPass()
    await variantPass()
  }
  return { team: spec.team, theta: spec.theta, stuff: stuffPasses, variants: variantPasses, tune, log }
}

// ───────────────────────────── campagne complète ─────────────────────────────

export interface CampaignOptions {
  t0?: T0RankOptions
  /** Candidats imposés (sinon top T0). */
  candidates?: readonly TeamCandidate[]
  halving?: HalvingOptions
  coopt?: CoOptOptions | false
  /** Finalistes co-optimisés (défaut 4). */
  finalists?: number
  validation?: { mode?: AIMode; seeds?: number; kinds?: readonly WorkerTask['kind'][] }
  cache?: FightCache
  objective?: Objective
  onLog?(line: string): void
}

export interface CampaignResult {
  t0?: { evaluated: number; ms: number; top: T0Result[] }
  halving: HalvingResult
  finalists: { candidate: TeamCandidate; coopt?: CoOptResult; spec: FightSpec; validation: ConfigEval }[]
  best: { candidate: TeamCandidate; spec: FightSpec; validation: ConfigEval }
  log: string[]
}

/** Campagne de composition complète (§15.6, voir l'en-tête). */
export async function runCompositionCampaign(data: GameDataStore, base: Omit<FightSpec, 'team'>, pool: FightExecutor, opts: CampaignOptions = {}): Promise<CampaignResult> {
  const log: string[] = []
  const say = (s: string) => {
    log.push(s)
    opts.onLog?.(s)
  }
  let t0: CampaignResult['t0']
  let candidates = opts.candidates?.slice()
  if (!candidates) {
    const r = t0Rank(data, opts.t0)
    t0 = { evaluated: r.evaluated, ms: r.ms, top: r.top }
    candidates = candidatesFromT0(data, r.top)
    say(`T0 : ${r.evaluated} équipes notées en ${(r.ms / 1000).toFixed(1)} s, ${candidates.length} candidates`)
  }
  const halving = await successiveHalving(base, candidates, pool, { cache: opts.cache, objective: opts.objective, ...opts.halving })
  for (const st of halving.stages) {
    const kept = st.entries.filter(e => e.kept).sort((a, b) => a.rank - b.rank)
    say(`${st.name} : ${st.entries.length} équipes → ${kept.length} (meilleure ${kept[0]?.id ?? '—'}, objectif ${kept[0]?.objective.toFixed(3) ?? '—'})`)
  }
  const finalists: CampaignResult['finalists'] = []
  const vMode = opts.validation?.mode ?? base.mode
  const vSeeds = campaignSeeds(0x7a11, opts.validation?.seeds ?? 24)
  for (const c of halving.winners.slice(0, opts.finalists ?? 4)) {
    let spec: FightSpec = { ...base, team: c.team }
    let coopt: CoOptResult | undefined
    if (opts.coopt !== false) {
      coopt = await coOptimizeTeam(data, spec, pool, { cache: opts.cache, objective: opts.objective, ...(opts.coopt || {}) })
      spec = { ...spec, team: coopt.team, theta: coopt.theta }
      for (const l of coopt.log) say(`${c.id} — ${l}`)
    }
    const kinds = opts.validation?.kinds ?? ['full']
    const evals = await Promise.all(kinds.map(kind => evaluateSpecs([{ ...spec, mode: vMode }], vSeeds, pool, { kind, cache: opts.cache, objective: opts.objective }).then(e => e[0])))
    const validation = evals[evals.length - 1]
    say(`Validation ${vMode} ${c.id} : ${(validation.result.winRate * 100).toFixed(1)} % (IC95 ${(validation.result.wilson95[0] * 100).toFixed(1)}-${(validation.result.wilson95[1] * 100).toFixed(1)} %), objectif ${validation.objective.toFixed(3)}`)
    finalists.push({ candidate: c, coopt, spec: { ...spec, mode: vMode }, validation })
  }
  const best = finalists.slice().sort((a, b) => stageKey(b.validation.result, b.validation.objective) - stageKey(a.validation.result, a.validation.objective) || b.validation.objective - a.validation.objective || a.candidate.id.localeCompare(b.candidate.id))[0]
  return { t0, halving, finalists, best: { candidate: best.candidate, spec: best.spec, validation: best.validation }, log }
}

/** Paramètres T0 par défaut (ré-export pratique). */
export { defaultT0Params }
/** Preset d'un membre (rapports). */
export function presetOf(m: MemberSpec): Preset | undefined {
  return findPreset(m.presetId)
}
