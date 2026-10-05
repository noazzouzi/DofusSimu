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
 *  - `calibrateT0OnFights` : la même calibration sur des équipes du classement T0 jouées en vrais combats ;
 *  - `evolveTeams` (option `evolve`, §15.6 point 6) : mutation d'un membre et croisement de stuffs, acceptation
 *    appariée sur graines communes — explore hors du top T0 ;
 *  - `runCompositionCampaign` : T0 → calibration de T0 sur combats (défaut) → T0 recalculé → halving → (evolve) →
 *    co-optimisation → validation (mode final, ex. `standard`).
 */
import type { AIMode } from '../../ai/types'
import { Rng } from '../../core/rng'
import type { GameDataStore } from '../../data/store'
import type { FightCache } from '../cache'
import type { FightExecutor } from '../montecarlo'
import { campaignSeeds } from '../seeds'
import { rankKey, summarizeBatch, wilson } from '../stats'
import { optimizeStuff, type StuffResult, type StuffSearchOptions } from '../stuff/search'
import { validateStuffs, type StuffValidation } from '../stuff/validate'
import { evaluateSpecs, pairedVectors, tuneThetaByFights, type ConfigEval, type Objective, type TuneOptions, type TuneResult } from '../tune'
import type { BatchResult, FightSpec, FightSummary, MemberSpec, WorkerTask } from '../types'
import { optimizeVariants, type VariantSearchOptions, type VariantSearchResult } from '../variants'
import { findPreset, presetMember, PRESETS, resolvePreset, type Preset } from './presets'
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

export interface T0FightCalibrationOptions {
  /** Équipes jouées (réparties sur le classement T0 non calibré, défaut 12). */
  teams?: number
  /** Graines par équipe (défaut 8, CRN). */
  seeds?: number
  masterSeed?: number
  cache?: FightCache
}

export interface T0FightCalibration {
  params: T0Params
  mse: number
  observations: { id: string; observed: number; predictedBefore: number; predictedAfter: number }[]
  fights: number
}

/**
 * Calibre T0 sur de VRAIS combats (`calibrateT0`) : `teams` équipes réparties régulièrement sur le classement T0
 * (rang 1, …, dernier rang du classement fourni), jouées sur des graines communes avec la spécification de base
 * (mode, θ, variantes) ; score observé = score de combat moyen (§15.2, même format que `T0Result.predicted`). Sans
 * cela, T0 (efficacité 0,5, exposition 1) prédit la victoire de presque toutes les équipes alors que l'IA réellement
 * utilisée peut toutes les faire perdre : le classement ne discrimine plus.
 */
export async function calibrateT0OnFights(data: GameDataStore, base: Omit<FightSpec, 'team'>, pool: FightExecutor, ranking: { top: readonly T0Result[]; capabilities: readonly PresetCapability[] }, presets: readonly Preset[], params: T0Params, opts: T0FightCalibrationOptions = {}): Promise<T0FightCalibration> {
  const n = Math.max(1, Math.min(opts.teams ?? 12, ranking.top.length))
  const picks: T0Result[] = []
  for (let k = 0; k < n; k++) {
    const r = ranking.top[n === 1 ? 0 : Math.round((k * (ranking.top.length - 1)) / (n - 1))]
    if (!picks.includes(r)) picks.push(r)
  }
  const seeds = campaignSeeds(opts.masterSeed ?? 0x70ca1, opts.seeds ?? 8)
  const cands = candidatesFromT0(data, picks)
  const evals = await evaluateSpecs(cands.map(c => ({ ...base, team: c.team })), seeds, pool, { cache: opts.cache })
  const capOf = (id: string) => ranking.capabilities[presets.findIndex(p => p.id === id)]
  const obs: T0Observation[] = picks.map((r, i) => ({
    capabilities: r.presetIds.map(capOf),
    presets: r.presetIds.map(id => presets.find(p => p.id === id)!),
    observed: evals[i].summaries.reduce((a, s) => a + s.score, 0) / Math.max(1, evals[i].summaries.length),
  }))
  const fit = calibrateT0(obs, params)
  return {
    params: fit.params,
    mse: fit.mse,
    observations: obs.map((o, i) => ({
      id: cands[i].id,
      observed: o.observed,
      predictedBefore: t0Evaluate(o.capabilities, params, o.presets).predicted,
      predictedAfter: t0Evaluate(o.capabilities, fit.params, o.presets).predicted,
    })),
    fights: picks.length * seeds.length,
  }
}

// ───────────────────────────── option evolve ─────────────────────────────

export interface EvolveOptions {
  /** Générations (défaut 2). */
  generations?: number
  /** Mutants essayés par équipe et par génération (défaut 8). */
  mutants?: number
  /** Graines par génération (défaut 32, renouvelées à chaque génération, CRN entre parent et mutants). */
  seeds?: number
  kind?: WorkerTask['kind']
  masterSeed?: number
  rngSeed?: number
  /** Presets candidats aux mutations (défaut : tous les presets). */
  presets?: readonly Preset[]
  /** Croisement de stuffs entre équipes (même classe) ; défaut vrai. */
  crossover?: boolean
  /** Seuil de significativité de l'acceptation d'un mutant (défaut 2). */
  minZ?: number
  maxSameClass?: number
  cache?: FightCache
  objective?: Objective
}

export interface EvolveStep {
  generation: number
  parent: string
  child: string
  kind: 'mutation' | 'crossover'
  detail: string
  diff: number
  z: number
  accepted: boolean
}

export interface EvolveResult {
  teams: TeamCandidate[]
  steps: EvolveStep[]
  fights: number
  log: string[]
}

/** Équipe renommée (noms uniques par classe : « Iop », « Iop 2 »), identifiant et archétype recalculés. */
function teamCandidate(team: MemberSpec[], tag = ''): TeamCandidate {
  const names = new Map<number, number>()
  const renamed = team.map(m => {
    const preset = findPreset(m.presetId)
    const cls = preset?.className ?? m.name.replace(/ \d+$/, '')
    const k = (names.get(m.breedId) ?? 0) + 1
    names.set(m.breedId, k)
    const name = k > 1 ? `${cls} ${k}` : cls
    return { ...m, name, build: { ...m.build, name } }
  })
  const presets = renamed.map(m => findPreset(m.presetId)).filter((p): p is Preset => !!p)
  return { id: `${teamId(renamed)}${tag}`, team: renamed, archetype: archetypeKey(archetypeOf(presets)) }
}

/**
 * Option `evolve` (§15.6 point 6) : explore HORS du top T0 par mutation d'un membre (un preset remplacé par un autre
 * preset, stuff du preset, ≤ `maxSameClass` par classe, jamais deux fois le même preset) et croisement de stuffs (un
 * membre reprend le build d'un membre de même classe d'une autre équipe de la population). À chaque génération, chaque
 * équipe et ses mutants sont joués sur les mêmes graines (CRN, renouvelées par génération) ; le meilleur mutant
 * remplace l'équipe si le gain apparié est significatif (Δ objectif > 0, z ≥ `minZ`). Déterministe (`Rng` graine).
 */
export async function evolveTeams(data: GameDataStore, base: Omit<FightSpec, 'team'>, population: readonly TeamCandidate[], pool: FightExecutor, opts: EvolveOptions = {}): Promise<EvolveResult> {
  const rng = new Rng(opts.rngSeed ?? 0xe401)
  const presets = opts.presets ?? PRESETS
  const maxSame = opts.maxSameClass ?? 2
  const nSeeds = opts.seeds ?? 32
  const steps: EvolveStep[] = []
  const log: string[] = []
  let fights = 0
  let current = population.slice()
  for (let g = 0; g < (opts.generations ?? 2); g++) {
    const seeds = campaignSeeds(opts.masterSeed ?? 0xe401, nSeeds, g * nSeeds)
    const next: TeamCandidate[] = []
    for (const [pi, parent] of current.entries()) {
      // Mutations possibles (membre i → preset q), tirées sans remise.
      const options: { child: TeamCandidate; kind: EvolveStep['kind']; detail: string }[] = []
      const pairs: [number, Preset][] = []
      parent.team.forEach((m, i) => {
        for (const q of presets) {
          if (q.id === m.presetId || parent.team.some(x => x.presetId === q.id)) continue
          const sameClass = parent.team.filter((x, k) => k !== i && x.breedId === q.breedId).length
          if (sameClass >= maxSame) continue
          pairs.push([i, q])
        }
      })
      for (let k = pairs.length - 1; k > 0; k--) {
        const j = rng.int(0, k)
        ;[pairs[k], pairs[j]] = [pairs[j], pairs[k]]
      }
      for (const [i, q] of pairs.slice(0, opts.mutants ?? 8)) {
        const team = parent.team.map((m, k) => (k === i ? presetMember(q, data, { name: q.className }) : m))
        options.push({ child: teamCandidate(team), kind: 'mutation', detail: `${parent.team[i].name} (${parent.team[i].presetId}) → ${q.id}` })
      }
      // Croisement de stuffs : même classe dans une autre équipe de la population, build différent.
      if (opts.crossover ?? true) {
        current.forEach((other, oi) => {
          if (oi === pi) return
          parent.team.forEach((m, i) => {
            const donor = other.team.find(x => x.breedId === m.breedId && JSON.stringify(x.build.items) !== JSON.stringify(m.build.items))
            if (!donor) return
            const team = parent.team.map((x, k) => (k === i ? { ...x, build: { ...donor.build, name: x.name, spellVariants: x.build.spellVariants ?? donor.build.spellVariants } } : x))
            options.push({ child: teamCandidate(team, `@x${g}.${oi}.${i}`), kind: 'crossover', detail: `${m.name} reprend le stuff de ${donor.name} (${other.id})` })
          })
        })
      }
      if (!options.length) {
        next.push(parent)
        continue
      }
      const specs = [parent, ...options.map(o => o.child)].map(c => ({ ...base, team: c.team }))
      const evals = await evaluateSpecs(specs, seeds, pool, { kind: opts.kind, cache: opts.cache, objective: opts.objective })
      fights += specs.length * seeds.length
      let best = -1
      let bestObj = evals[0].objective
      options.forEach((o, k) => {
        const p = pairedVectors(evals[0].perSeed, evals[k + 1].perSeed)
        const accepted = p.diff > 0 && p.z >= (opts.minZ ?? 2)
        steps.push({ generation: g, parent: parent.id, child: o.child.id, kind: o.kind, detail: o.detail, diff: p.diff, z: p.z, accepted })
        if (accepted && evals[k + 1].objective > bestObj) {
          best = k
          bestObj = evals[k + 1].objective
        }
      })
      if (best >= 0) {
        next.push(options[best].child)
        log.push(`evolve g${g} : ${parent.id} → ${options[best].child.id} (${options[best].kind} : ${options[best].detail}), objectif ${evals[0].objective.toFixed(3)} → ${bestObj.toFixed(3)}`)
      } else {
        next.push(parent)
        log.push(`evolve g${g} : ${parent.id} conservée (${options.length} variantes, aucune significativement meilleure)`)
      }
    }
    current = next
  }
  return { teams: current, steps, fights, log }
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
  /**
   * Calibration de T0 sur de vrais combats avant le classement définitif (`calibrateT0OnFights`) ; défaut : activée
   * (12 équipes × 8 graines) quand les candidats viennent de T0 ; `false` pour la désactiver.
   */
  calibrate?: T0FightCalibrationOptions | false
  /** Candidats imposés (sinon top T0). */
  candidates?: readonly TeamCandidate[]
  halving?: HalvingOptions
  /** Option `evolve` (§15.6 point 6) appliquée aux finalistes du halving avant la co-optimisation ; défaut : non. */
  evolve?: EvolveOptions | false
  coopt?: CoOptOptions | false
  /** Finalistes co-optimisés (défaut 4). */
  finalists?: number
  validation?: { mode?: AIMode; seeds?: number; kinds?: readonly WorkerTask['kind'][] }
  cache?: FightCache
  objective?: Objective
  onLog?(line: string): void
}

export interface CampaignResult {
  t0?: { evaluated: number; ms: number; top: T0Result[]; params?: T0Params; calibration?: T0FightCalibration }
  halving: HalvingResult
  evolve?: EvolveResult
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
    let r = t0Rank(data, opts.t0)
    const presets = opts.t0?.presets ?? PRESETS
    let params: T0Params = { ...defaultT0Params(data, opts.t0?.size ?? 4), ...opts.t0?.params }
    let calibration: T0FightCalibration | undefined
    say(`T0 : ${r.evaluated} équipes notées en ${(r.ms / 1000).toFixed(1)} s`)
    if (opts.calibrate !== false) {
      calibration = await calibrateT0OnFights(data, base, pool, r, presets, params, { cache: opts.cache, ...(opts.calibrate || {}) })
      params = calibration.params
      say(`T0 calibré sur ${calibration.fights} combats (${calibration.observations.length} équipes) : efficacité ${params.efficiency}, exposition ${params.exposure}, EQM ${calibration.mse.toFixed(4)}`)
      r = t0Rank(data, { ...opts.t0, presets, capabilities: r.capabilities, params })
    }
    t0 = { evaluated: r.evaluated, ms: r.ms, top: r.top, params, calibration }
    candidates = candidatesFromT0(data, r.top)
    say(`T0 : ${candidates.length} candidates`)
  }
  const halving = await successiveHalving(base, candidates, pool, { cache: opts.cache, objective: opts.objective, ...opts.halving })
  for (const st of halving.stages) {
    const kept = st.entries.filter(e => e.kept).sort((a, b) => a.rank - b.rank)
    say(`${st.name} : ${st.entries.length} équipes → ${kept.length} (meilleure ${kept[0]?.id ?? '—'}, objectif ${kept[0]?.objective.toFixed(3) ?? '—'})`)
  }
  let winners = halving.winners.slice(0, opts.finalists ?? 4)
  let evolve: EvolveResult | undefined
  if (opts.evolve) {
    evolve = await evolveTeams(data, base, winners, pool, { cache: opts.cache, objective: opts.objective, ...opts.evolve })
    winners = evolve.teams
    for (const l of evolve.log) say(l)
  }
  const finalists: CampaignResult['finalists'] = []
  const vMode = opts.validation?.mode ?? base.mode
  const vSeeds = campaignSeeds(0x7a11, opts.validation?.seeds ?? 24)
  for (const c of winners) {
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
  return { t0, halving, evolve, finalists, best: { candidate: best.candidate, spec: best.spec, validation: best.validation }, log }
}

/** Paramètres T0 par défaut (ré-export pratique). */
export { defaultT0Params }
/** Preset d'un membre (rapports). */
export function presetOf(m: MemberSpec): Preset | undefined {
  return findPreset(m.presetId)
}
