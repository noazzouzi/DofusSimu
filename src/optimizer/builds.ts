/**
 * Optimisation des BUILDS pour une composition FIXÉE par l'utilisateur (commande `optimize`, décision du 2026-10-05 :
 * la composition — les classes — est une entrée ; voir team/userteam.ts) — docs/design/ai.md §15.
 *
 * Pour chaque membre de la composition, options de build (`memberOptions`) : versions du scénario des presets de sa
 * classe (ex. `cra_feu_vortex`, `cra_feu_vortex_def`, `cra_air_entrave_vortex`…), presets de base sans version du
 * scénario — auxquels l'optimiseur de stuff (L3, `optimizeStuff`, proxy du scénario : `vortexProxyOptions` au Vortex,
 * Dofus à sort passif du stuff de départ gardés) construit un stuff (`<preset>@opt`) —, ou les `candidates` du fichier
 * d'équipe ; un membre `fixed` garde son build. Puis, sur des graines COMMUNES (CRN) et le pool de workers :
 *
 *  1. criblage membre par membre : chaque option d'un membre est jouée dans l'équipe de RÉFÉRENCE (build par défaut
 *     des autres membres), `screenSeeds` graines ; comparaison APPARIÉE à la référence (objectif façonné `shapedScore`
 *     de tune.ts : victoire ≈ 1, défaite = 0,8·progression — corrompus, déverrouillage, dégâts au Vortex, survivants —
 *     + départage de survie) ; on garde les `keep` meilleures options de chaque membre ;
 *  2. successive halving sur les combinaisons des options gardées (deux membres de même classe sont interchangeables :
 *     une seule des combinaisons « A/B » et « B/A ») : étages de `halving` graines CUMULÉES (préfixes de la même suite :
 *     les graines déjà jouées viennent du cache), la moitié gardée à chaque étage ; l'équipe de référence est jouée à
 *     chaque étage comme TÉMOIN (jamais éliminée, peut gagner) ; classement par objectif moyen ;
 *  3. (facultatif) variantes de sorts (L4, `optimizeVariants`) puis θ (L2, `tuneThetaByFights`) sur la meilleure
 *     affectation ;
 *  4. validation sur `validation` graines NEUVES : meilleure configuration contre la référence (apparié) ; la
 *     référence reste retenue si la validation ne confirme pas le gain (objectif moyen inférieur).
 * Mesures rapportées à chaque étape (`FightMetrics`) : victoires (IC de Wilson), objectif, corrompus (fin de combat),
 * tours, première mort (tour de la première mort d'un personnage, tours du combat s'il n'y en a pas), morts.
 *
 * Budget : `budget` 'quick' | 'normal' | 'full' (graines de chaque étape, itérations de l'optimiseur de stuff,
 * variantes) et plafond `maxFights` de combats NOUVEAUX (une graine déjà jouée par la recherche ne compte pas) :
 * la validation est réservée d'abord, un étage qui ne tient pas est réduit (moins de graines) ou sauté — signalé dans
 * `notes`. Déterministe : graines `campaignSeeds(masterSeed, …)`, classements départagés par identifiant.
 */
import type { GameDataStore } from '../data/store'
import { MemoryFightCache, type FightCache } from './cache'
import type { FightExecutor } from './montecarlo'
import { resolveScenario } from './runner'
import { campaignSeeds } from './seeds'
import { mean, wilson } from './stats'
import { hasPassive } from './stuff/pools'
import type { ProxyOptions } from './stuff/proxy'
import { optimizeStuff, type StuffResult, type StuffSearchOptions } from './stuff/search'
import { vortexProxyOptions, type VortexProfile } from './stuff/vortex'
import type { Preset } from './team/presets'
import { compositionClasses, describeComposition, isFixed, memberNames, memberOptions, type BuildOption, type BuildOrigin, type UserComposition } from './team/userteam'
import { evaluateSpecs, pairedVectors, shapedScore, tunableParams, tuneThetaByFights, type ConfigEval, type Objective, type TuneOptions, type TuneResult } from './tune'
import type { FightSpec, FightSummary, MemberSpec, WorkerTask } from './types'
import { optimizeVariants, type VariantSearchOptions, type VariantSearchResult } from './variants'

// ───────────────────────────── budgets ─────────────────────────────

export type BuildBudget = 'quick' | 'normal' | 'full'
export const BUILD_BUDGETS_IDS: readonly BuildBudget[] = ['quick', 'normal', 'full']

export interface BudgetPlan {
  /** Graines du criblage membre par membre. */
  screenSeeds: number
  /** Options gardées par membre après le criblage. */
  keep: number
  /** Graines cumulées des étages du halving. */
  halving: number[]
  /** Graines neuves de la validation finale. */
  validation: number
  /** Itérations du recuit de l'optimiseur de stuff. */
  stuffIterations: number
  /** Variantes de sorts (L4) par défaut. */
  variants: boolean
}

/**
 * Budgets (combats au Vortex, IA `fast` : ≈ 20-40 s CPU chacun). Pour la composition du Vortex (4 membres à 5-8
 * options : ≈ 23 équipes au criblage, ≈ 16 combinaisons au halving), majorants de `previewBuildSearch` : 'quick'
 * ≈ 450 combats, 'normal' ≈ 1 050, 'full' ≈ 2 750 + ≈ 450 de variantes. `--keep 3` triple à peu près le halving.
 */
export const BUILD_BUDGETS: Readonly<Record<BuildBudget, BudgetPlan>> = {
  quick: { screenSeeds: 8, keep: 2, halving: [8, 16], validation: 32, stuffIterations: 5000, variants: false },
  normal: { screenSeeds: 16, keep: 2, halving: [16, 32, 64], validation: 64, stuffIterations: 20000, variants: false },
  full: { screenSeeds: 32, keep: 2, halving: [32, 64, 128, 256], validation: 256, stuffIterations: 30000, variants: true },
}

export interface BuildStuffOptions extends StuffSearchOptions {
  /** Profil du proxy du Vortex (défaut 'balanced'). */
  vortexProfile?: VortexProfile
  /** Garder les Dofus/trophées à sort passif du stuff de départ (le proxy ne les valorise pas ; défaut vrai). */
  keepPassiveDofus?: boolean
}

export interface BuildSearchOptions {
  budget?: BuildBudget
  screenSeeds?: number
  keep?: number
  halving?: readonly number[]
  validation?: number
  /** Plafond de combats nouveaux (voir l'en-tête). */
  maxFights?: number
  masterSeed?: number
  /** Type de combat du criblage (défaut 'full' ; 'prefix12'/'phase2' si le scénario les a). */
  screenKind?: WorkerTask['kind']
  /** Stuffs optimisés pour les presets sans stuff du scénario ; `false` = non. */
  stuff?: BuildStuffOptions | false
  /** Variantes de sorts (L4) : défaut selon le budget. */
  variants?: VariantSearchOptions | boolean
  /** θ (L2) : défaut non (coûteux). */
  theta?: (TuneOptions & { kind?: WorkerTask['kind'] }) | boolean
  cache?: FightCache
  objective?: Objective
  level?: number
  onLog?(line: string): void
}

// ───────────────────────────── mesures ─────────────────────────────

export interface FightMetrics {
  n: number
  wins: number
  winRate: number
  wilson95: [number, number]
  objective: number
  /** Monstres corrompus en fin de combat (moyenne). */
  corrupted: number
  rounds: number
  /** Tour de la première mort d'un personnage (tours du combat sans mort), moyenne. */
  firstDeath: number
  deaths: number
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000
/** z d'une comparaison appariée pour le rapport : 0 sous 2 graines (pas d'erreur type), 99 si l'écart est exact. */
const zOf = (p: { n: number; z: number }): number => (p.n < 2 ? 0 : Number.isFinite(p.z) ? Math.round(p.z * 100) / 100 : 99)

/** Mesures d'un lot (voir l'en-tête). */
export function fightMetrics(summaries: readonly FightSummary[], objective: Objective = shapedScore): FightMetrics {
  const n = summaries.length
  const wins = summaries.filter(s => s.win).length
  return {
    n,
    wins,
    winRate: n ? wins / n : 0,
    wilson95: wilson(wins, n),
    objective: r3(mean(summaries.map(objective))),
    corrupted: r3(mean(summaries.map(s => s.corruptedByRound[s.corruptedByRound.length - 1] ?? 0))),
    rounds: r3(mean(summaries.map(s => s.rounds))),
    firstDeath: r3(mean(summaries.map(s => s.firstDeathRound ?? s.rounds))),
    deaths: r3(mean(summaries.map(s => s.deaths))),
  }
}

// ───────────────────────────── résultat ─────────────────────────────

export interface OptionEntry {
  option: string
  origin: BuildOrigin
  metrics: FightMetrics
  /** Différence appariée d'objectif avec la référence (option − référence), erreur type, z. */
  diff: number
  se: number
  z: number
  kept: boolean
}

export interface SlotReport {
  name: string
  className: string
  fixed: boolean
  reference: string
  options: { id: string; origin: BuildOrigin; note?: string }[]
  screen?: OptionEntry[]
  kept: string[]
}

export interface AssignmentEntry {
  id: string
  options: string[]
  control: boolean
  metrics: FightMetrics
  diff: number
  se: number
  z: number
  rank: number
  kept: boolean
}

export interface HalvingRound {
  name: string
  seeds: number
  entries: AssignmentEntry[]
}

export interface Assignment {
  /** Une option par membre. */
  options: BuildOption[]
  id: string
}

export interface BuildValidation {
  seeds: number
  best: ConfigEval
  reference: ConfigEval
  bestMetrics: FightMetrics
  referenceMetrics: FightMetrics
  paired: { diff: number; se: number; z: number; winDiff: number }
  /** 'best' : configuration optimisée retenue ; 'reference' : la validation ne confirme pas le gain. */
  chosen: 'best' | 'reference'
  /** La meilleure configuration EST la référence (aucun changement). */
  same: boolean
}

export interface BuildSearchResult {
  scenarioId: string
  mode: string
  composition: UserComposition
  budget: BuildBudget
  plan: BudgetPlan
  masterSeed: number
  screenKind: WorkerTask['kind']
  maxFights?: number
  slots: SlotReport[]
  screenSeeds: number
  halving: HalvingRound[]
  reference: Assignment
  /** Meilleure affectation de builds (avant variantes/θ). */
  best: Assignment
  variants?: VariantSearchResult
  tune?: TuneResult
  /** Stuffs construits par l'optimiseur (un par preset sans stuff du scénario). */
  stuff: StuffResult[]
  validation: BuildValidation
  /** Configuration retenue (équipe, θ) et son lot de validation. */
  chosen: { spec: FightSpec; options: BuildOption[]; evaluation: ConfigEval }
  /** Combats nouveaux demandés par la recherche (graines distinctes par configuration). */
  fights: number
  log: string[]
  notes: string[]
}

// ───────────────────────────── outils ─────────────────────────────

/** Presets joués au contact (pas de PO visée à 6 dans le proxy du Vortex ; même liste que la campagne des stuffs). */
const MELEE_PRESET = /^(iop_terre|ouginak|sacrieur|zobal|feca_protecteur|pandawa_saoul)/

/** Options du proxy de stuff pour un preset dans un scénario (Vortex : `vortexProxyOptions` ; sinon défaut du proxy). */
export function scenarioProxyOptions(scenarioId: string, preset: Preset, profile: VortexProfile = 'balanced'): ProxyOptions | undefined {
  if (scenarioId !== 'vortex') return undefined
  return vortexProxyOptions(preset.role, { profile, melee: MELEE_PRESET.test(preset.extends ?? preset.id) })
}

/** Identifiant d'une affectation (options des membres jointes par « , »). */
export function assignmentId(options: readonly BuildOption[]): string {
  return options.map(o => o.id).join(',')
}

/** Clé d'interchangeabilité : options triées au sein de chaque classe (deux Crâs A/B ≡ B/A). */
function canonicalKey(options: readonly BuildOption[]): string {
  const byClass = new Map<number, string[]>()
  options.forEach(o => byClass.set(o.member.breedId, [...(byClass.get(o.member.breedId) ?? []), o.id]))
  return [...byClass.entries()].sort((a, b) => a[0] - b[0]).map(([k, ids]) => `${k}:${ids.slice().sort().join('|')}`).join(';')
}

/** Équipe d'une affectation : le membre de chaque option, renommé selon son rang dans la composition. */
function teamOf(options: readonly BuildOption[], names: readonly string[]): MemberSpec[] {
  return options.map((o, i) => (o.member.name === names[i] ? o.member : { ...o.member, name: names[i], build: { ...o.member.build, name: names[i] } }))
}

/** Membre renommé (option partagée entre deux membres de même classe). */
function renamed(o: BuildOption, name: string): BuildOption {
  if (o.member.name === name) return o
  return { ...o, member: { ...o.member, name, build: { ...o.member.build, name } } }
}

/** Compteur de combats nouveaux (configuration × graine × type) et plafond. */
class FightBudget {
  private readonly done = new Set<string>()
  used = 0
  constructor(readonly max: number | undefined) {}
  /** Combats nouveaux qu'ajouterait l'évaluation de `ids` sur `seeds`. */
  cost(ids: readonly string[], seeds: readonly number[], kind: string): number {
    let n = 0
    for (const id of new Set(ids)) for (const s of seeds) if (!this.done.has(`${id}#${kind}#${s}`)) n++
    return n
  }
  take(ids: readonly string[], seeds: readonly number[], kind: string): void {
    for (const id of new Set(ids)) {
      for (const s of seeds) {
        const k = `${id}#${kind}#${s}`
        if (!this.done.has(k)) {
          this.done.add(k)
          this.used++
        }
      }
    }
  }
  /** Combats encore disponibles en gardant `reserve` (∞ sans plafond). */
  left(reserve = 0): number {
    return this.max === undefined ? Infinity : Math.max(0, this.max - this.used - reserve)
  }
}

/**
 * Options de build de chaque membre (référence en tête) : `memberOptions` + stuffs optimisés `<preset>@opt` pour les
 * presets sans stuff du scénario (sauf `stuff: false` ou membre imposé). `runStuff` faux (aperçu) : l'option `@opt`
 * est annoncée sans lancer l'optimiseur de stuff (build de départ).
 */
function buildSlotOptions(data: GameDataStore, base: Omit<FightSpec, 'team'>, comp: UserComposition, opts: BuildSearchOptions, plan: BudgetPlan, say: (s: string) => void, runStuff: boolean): { slotOptions: BuildOption[][]; stuff: StuffResult[] } {
  const names = memberNames(comp)
  const stuffResults: StuffResult[] = []
  const stuffMemo = new Map<string, BuildOption>()
  // Builds par défaut et options : presets du scénario de la composition (fichier d'équipe), sinon du combat.
  const buildScenario = comp.scenarioId ?? base.scenarioId
  const slotOptions = comp.members.map((m, i) => {
    const list = memberOptions(comp, i, data, buildScenario, opts.level)
    if (opts.stuff === false || isFixed(m)) return list
    const out: BuildOption[] = []
    list.forEach((o, k) => {
      // Preset sans stuff propre au scénario (y compris le build donné par l'utilisateur, qui reste joué tel quel en
      // référence) : une option `@opt` avec un stuff construit pour le scénario.
      const auto = !o.scenarioStuff && (o.origin === 'class' || o.origin === 'candidate' || o.origin === 'scenario' || o.origin === 'user')
      if (!auto) {
        out.push(o)
        return
      }
      if (k === 0) out.push(o) // la référence reste jouée telle quelle
      const key = `${o.id}|${o.member.role ?? ''}`
      let memo = stuffMemo.get(key)
      if (!memo && !runStuff) {
        memo = { ...o, id: `${o.id}@opt`, origin: 'stuff-optimizer', scenarioStuff: true, note: 'stuff à optimiser (aperçu)' }
        stuffMemo.set(key, memo)
      }
      if (!memo) {
        const so = opts.stuff || {}
        const fixed = (so.keepPassiveDofus ?? true) ? o.member.build.items.map(it => data.item(it.itemId)).filter(it => !!it && it.slot === 'dofus' && hasPassive(it)).map(it => it!.id) : []
        const result = optimizeStuff(data, o.member, {
          iterations: plan.stuffIterations,
          proxy: scenarioProxyOptions(base.scenarioId, o.preset, so.vortexProfile),
          ...so,
          fixed: [...fixed, ...(so.fixed ?? [])],
        })
        stuffResults.push(result)
        const member: MemberSpec = { ...o.member, build: { ...result.best.build, name: o.member.name, spellVariants: o.member.build.spellVariants?.slice() ?? result.best.build.spellVariants } }
        // Un départ invalide (objets au-dessus du niveau…) n'est retenu que faute de candidat valide (search.ts).
        const outcome = !result.startValid ? (result.best === result.start ? ', départ invalide, aucun candidat valide' : ', départ invalide') : result.best === result.start ? ', aucune amélioration' : ''
        const note = `stuff optimisé (proxy ${result.start.score.logJ.toFixed(3)} → ${result.best.score.logJ.toFixed(3)}${outcome})`
        memo = { ...o, id: `${o.id}@opt`, member, origin: 'stuff-optimizer', scenarioStuff: true, note }
        stuffMemo.set(key, memo)
        say(`Stuff ${o.member.name} ${o.id} : ${note}, ${(result.ms / 1000).toFixed(1)} s.`)
      }
      if (!out.some(x => x.id === memo!.id)) out.push(renamed(memo, names[i]))
    })
    return out
  })
  return { slotOptions, stuff: stuffResults }
}

/** Graine maîtresse par défaut d'`optimizeBuilds`. */
const DEFAULT_MASTER = 0xb1d5

/** Options du réglage de θ dans `optimizeBuilds` (défauts réduits : 8 graines de criblage, CEM 8 × 4 × 8, 32 de validation). */
export function thetaTuneOptions(theta: BuildSearchOptions['theta'], master: number): TuneOptions {
  const to: TuneOptions & { kind?: WorkerTask['kind'] } = typeof theta === 'object' ? theta : {}
  return {
    keep: 6,
    ...to,
    screen: to.screen === false ? false : { seeds: 8, masterSeed: master ^ 0x5c3e, ...(to.screen || {}) },
    cem: { population: 8, elite: 2, generations: 4, seedsPerGeneration: 8, masterSeed: master ^ 0xce3, ...(to.cem ?? {}) },
    validation: { seeds: 32, masterSeed: master ^ 0x7a11d, ...(to.validation ?? {}) },
  }
}

/**
 * Combats d'un réglage de θ (`tuneTheta` : criblage (1 + 2·P) × graines si P > keep, CEM population × générations ×
 * graines, validation 2 × graines), défauts de tune.ts pour les champs absents.
 */
export function thetaTuneCost(theta: FightSpec['theta'], o: TuneOptions): number {
  const p = tunableParams(theta, o.paths).length
  const keep = o.keep ?? 10
  const screened = o.screen !== false && p > keep
  const screen = screened ? (1 + 2 * p) * ((o.screen || {}).seeds ?? 64) : 0
  const cem = Math.max(2, o.cem?.population ?? 12) * (o.cem?.generations ?? 10) * (o.cem?.seedsPerGeneration ?? 16)
  return screen + cem + 2 * (o.validation?.seeds ?? 200)
}

/** Plan de budget effectif (budget + surcharges). */
function effectivePlan(opts: BuildSearchOptions): { budget: BuildBudget; plan: BudgetPlan } {
  const budget = opts.budget ?? 'normal'
  const preset = BUILD_BUDGETS[budget]
  if (!preset) throw new Error(`Budget inconnu : « ${budget} » (${BUILD_BUDGETS_IDS.join(', ')})`)
  return {
    budget,
    plan: {
      ...preset,
      ...(opts.screenSeeds !== undefined ? { screenSeeds: opts.screenSeeds } : {}),
      ...(opts.keep !== undefined ? { keep: opts.keep } : {}),
      ...(opts.halving !== undefined ? { halving: opts.halving.slice() } : {}),
      ...(opts.validation !== undefined ? { validation: opts.validation } : {}),
    },
  }
}

export interface BuildSearchPreview {
  budget: BuildBudget
  plan: BudgetPlan
  slots: { name: string; className: string; fixed: boolean; options: { id: string; origin: BuildOrigin }[] }[]
  /** Combats prévus (majorant : sans le cache ni les graines partagées du criblage et du premier étage). */
  estimate: { screen: number; halving: number; variants: number; theta: number; validation: number; total: number }
}

/**
 * Aperçu d'`optimizeBuilds` sans combat ni optimiseur de stuff : options de chaque membre et nombre de combats prévu
 * (CLI `optimize --dry-run`).
 */
export function previewBuildSearch(data: GameDataStore, base: Omit<FightSpec, 'team'>, comp: UserComposition, opts: BuildSearchOptions = {}): BuildSearchPreview {
  const { budget, plan } = effectivePlan(opts)
  const { slotOptions } = buildSlotOptions(data, base, comp, opts, plan, () => undefined, false)
  const names = memberNames(comp)
  const lens = slotOptions.map(l => l.length)
  const searchable = lens.some(x => x > 1)
  const screenConfigs = 1 + lens.reduce((a, x) => a + x - 1, 0)
  const screen = searchable && plan.screenSeeds > 0 ? screenConfigs * plan.screenSeeds : 0
  let combos = searchable ? lens.reduce((a, x) => a * (plan.screenSeeds > 0 ? Math.min(plan.keep, x) : x), 1) - 1 : 0
  let halving = 0
  let prev = 0
  for (const h of plan.halving) {
    if (combos <= 0 || h <= prev) continue
    halving += (combos + 1) * (h - prev)
    prev = h
    if (combos <= 1) break
    combos = Math.ceil(combos / 2)
  }
  const wantVariants = opts.variants === undefined ? plan.variants : opts.variants !== false
  const vSeeds = budget === 'full' ? 24 : 16
  const variants = wantVariants ? vSeeds + (budget === 'full' ? 32 : 16) + comp.members.length * (budget === 'full' ? 4 : 3) * vSeeds : 0
  const validation = 2 * plan.validation
  const theta = opts.theta ? thetaTuneCost(base.theta, thetaTuneOptions(opts.theta, opts.masterSeed ?? DEFAULT_MASTER)) : 0
  let total = screen + halving + variants + theta + validation
  if (opts.maxFights !== undefined) total = Math.min(total, opts.maxFights)
  return {
    budget,
    plan,
    slots: comp.members.map((m, i) => ({ name: names[i], className: m.className, fixed: isFixed(m), options: slotOptions[i].map(o => ({ id: o.id, origin: o.origin })) })),
    estimate: { screen, halving, variants, theta, validation, total },
  }
}

// ───────────────────────────── recherche ─────────────────────────────

/** Optimise les builds d'une composition fixée (voir l'en-tête). `base` : scénario, mode, θ… (équipe remplacée). */
export async function optimizeBuilds(data: GameDataStore, base: Omit<FightSpec, 'team'>, comp: UserComposition, pool: FightExecutor, opts: BuildSearchOptions = {}): Promise<BuildSearchResult> {
  const { budget, plan } = effectivePlan(opts)
  const master = opts.masterSeed ?? DEFAULT_MASTER
  const screenKind = opts.screenKind ?? 'full'
  if (screenKind !== 'full' && screenKind !== 't0' && !resolveScenario(base.scenarioId).micro[screenKind]) {
    throw new Error(`Criblage « ${screenKind} » : micro-scénario absent du scénario ${base.scenarioId}`)
  }
  const cache = opts.cache ?? new MemoryFightCache()
  const objective = opts.objective ?? shapedScore
  const log: string[] = []
  const notes: string[] = []
  const say = (s: string) => {
    log.push(s)
    opts.onLog?.(s)
  }
  const fights = new FightBudget(opts.maxFights)
  const names = memberNames(comp)
  const n = comp.members.length
  say(`Composition fixée : ${describeComposition(comp)} ; budget ${budget}${opts.maxFights !== undefined ? `, au plus ${opts.maxFights} combats` : ''}.`)

  // ── options et stuffs optimisés ──
  const { slotOptions, stuff: stuffResults } = buildSlotOptions(data, base, comp, opts, plan, say, true)
  const reference: Assignment = { options: slotOptions.map(l => l[0]), id: assignmentId(slotOptions.map(l => l[0])) }
  const specOf = (options: readonly BuildOption[]): FightSpec => ({ ...base, team: teamOf(options, names) })
  const slots: SlotReport[] = comp.members.map((m, i) => ({
    name: names[i],
    className: m.className,
    fixed: isFixed(m),
    reference: slotOptions[i][0].id,
    options: slotOptions[i].map(o => ({ id: o.id, origin: o.origin, ...(o.note ? { note: o.note } : {}) })),
    kept: [slotOptions[i][0].id],
  }))
  for (const s of slots) say(`${s.name} (${s.className}${s.fixed ? ', imposé' : ''}) : référence ${s.reference} ; ${s.options.length} option(s) — ${s.options.map(o => o.id).join(', ')}.`)

  const validationReserve = 2 * plan.validation
  const evalAssignments = async (list: readonly Assignment[], seeds: readonly number[], kind: WorkerTask['kind']): Promise<ConfigEval[]> => {
    const evals = await evaluateSpecs(list.map(a => specOf(a.options)), seeds, pool, { kind, cache, objective })
    fights.take(list.map(a => a.id), seeds, kind)
    return evals
  }

  // ── 1. criblage membre par membre ──
  let screenSeeds = plan.screenSeeds
  const searchable = slotOptions.some(l => l.length > 1)
  const keptBySlot: BuildOption[][] = slotOptions.map(l => [l[0]])
  if (searchable && screenSeeds <= 0) {
    // Criblage désactivé (`screenSeeds` 0) : toutes les combinaisons vont au halving (64 au plus).
    const product = slotOptions.reduce((a, l) => a * l.length, 1)
    if (product > 64) throw new Error(`Sans criblage, ${product} combinaisons de builds : trop pour le halving (64 au plus) — garder le criblage`)
    slotOptions.forEach((l, i) => {
      keptBySlot[i] = l.slice()
      slots[i].kept = l.map(o => o.id)
    })
  }
  if (searchable && screenSeeds > 0) {
    const configs: Assignment[] = [reference]
    const where: { slot: number; option: number; config: number }[] = []
    slotOptions.forEach((list, i) => {
      list.forEach((o, k) => {
        if (k === 0) {
          where.push({ slot: i, option: 0, config: 0 })
          return
        }
        const options = reference.options.map((x, j) => (j === i ? renamed(o, names[i]) : x))
        const id = assignmentId(options)
        let c = configs.findIndex(a => a.id === id)
        if (c < 0) {
          configs.push({ options, id })
          c = configs.length - 1
        }
        where.push({ slot: i, option: k, config: c })
      })
    })
    const ids = configs.map(c => c.id)
    const fit = fights.left(validationReserve)
    let reduced = false
    if (fights.cost(ids, campaignSeeds(master, screenSeeds), screenKind) > fit) {
      reduced = true
      screenSeeds = Math.floor(fit / configs.length)
      notes.push(`Plafond de combats : criblage réduit à ${screenSeeds} graine(s) (prévu ${plan.screenSeeds}).`)
    }
    // Un criblage réduit par le plafond à moins de 4 graines (ou du nombre prévu s'il est plus petit) ne classe rien.
    if (screenSeeds >= 1 && (!reduced || screenSeeds >= Math.min(4, plan.screenSeeds))) {
      const seeds = campaignSeeds(master, screenSeeds)
      say(`Criblage membre par membre : ${configs.length} équipes × ${seeds.length} graines (${screenKind}).`)
      const evals = await evalAssignments(configs, seeds, screenKind)
      const ref = evals[0]
      slotOptions.forEach((list, i) => {
        if (list.length < 2) {
          slots[i].kept = [list[0].id]
          return
        }
        const entries: OptionEntry[] = list.map((o, k) => {
          const e = evals[where.find(w => w.slot === i && w.option === k)!.config]
          const p = pairedVectors(ref.perSeed, e.perSeed)
          return { option: o.id, origin: o.origin, metrics: fightMetrics(e.summaries, objective), diff: r3(p.diff), se: r3(p.se), z: zOf(p), kept: false }
        })
        const order = entries.map((_, k) => k).sort((a, b) => entries[b].metrics.objective - entries[a].metrics.objective || entries[a].option.localeCompare(entries[b].option))
        const keep = order.slice(0, Math.max(1, plan.keep))
        for (const k of keep) entries[k].kept = true
        keptBySlot[i] = keep.map(k => list[k])
        slots[i].screen = entries
        slots[i].kept = keep.map(k => list[k].id)
        say(`  ${names[i]} : ${order.map(k => `${entries[k].option} ${entries[k].metrics.objective.toFixed(3)} (Δ ${entries[k].diff >= 0 ? '+' : ''}${entries[k].diff.toFixed(3)}, z ${entries[k].z.toFixed(1)}; corrompus ${entries[k].metrics.corrupted.toFixed(1)}, tours ${entries[k].metrics.rounds.toFixed(1)})`).join(' ; ')} → gardées : ${slots[i].kept.join(', ')}`)
      })
    } else {
      screenSeeds = 0
      notes.push('Plafond de combats : criblage sauté, builds par défaut conservés.')
    }
  } else screenSeeds = 0

  // ── 2. successive halving sur les combinaisons ──
  const combos: Assignment[] = []
  const seen = new Set<string>([canonicalKey(reference.options)])
  const walk = (i: number, acc: BuildOption[]) => {
    if (i === n) {
      const options = acc.map((o, j) => renamed(o, names[j]))
      const key = canonicalKey(options)
      if (seen.has(key)) return
      seen.add(key)
      combos.push({ options, id: assignmentId(options) })
      return
    }
    for (const o of keptBySlot[i]) walk(i + 1, [...acc, o])
  }
  walk(0, [])
  const halving: HalvingRound[] = []
  let current = combos.slice()
  let best: Assignment = reference
  if (current.length) {
    say(`Halving : ${current.length} combinaison(s) + la référence (témoin).`)
    let previous = 0
    let lastEntries: AssignmentEntry[] | undefined
    for (const [si, nSeeds] of plan.halving.entries()) {
      if (nSeeds <= previous) continue
      const seeds = campaignSeeds(master, nSeeds)
      const list = [reference, ...current]
      const cost = fights.cost(list.map(a => a.id), seeds, 'full')
      if (cost > fights.left(validationReserve)) {
        notes.push(`Plafond de combats : halving arrêté avant l'étage ${si + 1} (${nSeeds} graines, ${cost} combats nouveaux).`)
        break
      }
      const evals = await evalAssignments(list, seeds, 'full')
      const ref = evals[0]
      const entries: AssignmentEntry[] = list.map((a, k) => {
        const p = pairedVectors(ref.perSeed, evals[k].perSeed)
        return { id: a.id, options: a.options.map(o => o.id), control: k === 0, metrics: fightMetrics(evals[k].summaries, objective), diff: r3(p.diff), se: r3(p.se), z: zOf(p), rank: 0, kept: false }
      })
      const order = entries.map((_, k) => k).sort((a, b) => entries[b].metrics.objective - entries[a].metrics.objective || entries[a].id.localeCompare(entries[b].id))
      order.forEach((k, r) => (entries[k].rank = r + 1))
      const candidates = order.filter(k => k !== 0)
      const keepN = Math.max(1, Math.ceil(candidates.length / 2))
      const kept = candidates.slice(0, keepN)
      entries[0].kept = true
      for (const k of kept) entries[k].kept = true
      halving.push({ name: `Étage ${si + 1}`, seeds: nSeeds, entries })
      say(`  Étage ${si + 1} (${nSeeds} graines) : ${order.slice(0, 6).map(k => `${entries[k].control ? '[témoin] ' : ''}${entries[k].id} ${entries[k].metrics.objective.toFixed(3)} (Δ ${entries[k].diff >= 0 ? '+' : ''}${entries[k].diff.toFixed(3)}, z ${entries[k].z.toFixed(1)}; ${entries[k].metrics.wins}/${entries[k].metrics.n} V, corrompus ${entries[k].metrics.corrupted.toFixed(1)}, tours ${entries[k].metrics.rounds.toFixed(1)}, 1re mort ${entries[k].metrics.firstDeath.toFixed(1)})`).join(' ; ')}`)
      current = kept.map(k => list[k])
      lastEntries = entries
      previous = nSeeds
      if (current.length <= 1) break
    }
    if (lastEntries) {
      const top = lastEntries.slice().sort((a, b) => a.rank - b.rank)[0]
      best = top.control ? reference : [reference, ...combos].find(a => a.id === top.id) ?? reference
    }
  }
  say(`Meilleure affectation : ${best === reference ? 'la référence' : best.id}.`)

  // ── 3. variantes (L4) puis θ (L2) ──
  let spec: FightSpec = specOf(best.options)
  let variants: VariantSearchResult | undefined
  const wantVariants = opts.variants === undefined ? plan.variants : opts.variants !== false
  if (wantVariants) {
    const vo: VariantSearchOptions = typeof opts.variants === 'object' ? opts.variants : {}
    const seeds = vo.seeds ?? (budget === 'full' ? 24 : 16)
    const usage = vo.usageSeeds ?? (budget === 'full' ? 32 : 16)
    let maxCandidates = vo.maxCandidates ?? (budget === 'full' ? 4 : 3)
    const estimate = (mc: number) => seeds + usage + n * mc * seeds
    while (maxCandidates > 0 && estimate(maxCandidates) > fights.left(validationReserve)) maxCandidates--
    if (maxCandidates > 0) {
      say(`Variantes de sorts : ≤ ${maxCandidates} bascule(s) essayée(s) par membre, ${seeds} graines.`)
      variants = await optimizeVariants(data, spec, pool, { seeds, usageSeeds: usage, maxCandidates, masterSeed: master ^ 0x7a12, ...vo, cache, objective })
      fights.used += variants.fights
      spec = { ...spec, team: variants.team }
      say(`  ${variants.accepted.length} bascule(s) acceptée(s), objectif ${variants.base.objective.toFixed(3)} → ${variants.final.objective.toFixed(3)}.`)
    } else notes.push('Plafond de combats : variantes de sorts sautées.')
  }
  let tune: TuneResult | undefined
  if (opts.theta) {
    const to: TuneOptions & { kind?: WorkerTask['kind'] } = typeof opts.theta === 'object' ? opts.theta : {}
    const merged = thetaTuneOptions(opts.theta, master)
    // θ respecte le plafond de combats comme les autres étapes (≈ 1 400 combats avec les 68 paramètres par défaut).
    const cost = thetaTuneCost(spec.theta, merged)
    if (cost > fights.left(validationReserve)) notes.push(`Plafond de combats : réglage de θ sauté (≈ ${cost} combats prévus, ${fights.left(validationReserve)} disponibles ; --theta-paths pour moins de paramètres).`)
    else {
      say(`θ (L2) : criblage → CEM → validation appariée (≈ ${cost} combats).`)
      tune = await tuneThetaByFights(spec, pool, { ...merged, cache, objective, kind: to.kind })
      fights.used += tune.evaluations
      if (tune.accepted) spec = { ...spec, theta: tune.theta }
      say(`  θ ${tune.accepted ? 'accepté' : 'rejeté (θ de départ conservé)'} : Δ ${tune.validation.paired.diff.toFixed(4)} (z ${tune.validation.paired.z.toFixed(2)}).`)
    }
  }

  // ── 4. validation sur graines neuves ──
  const vSeeds = campaignSeeds(master ^ 0x5a1d, plan.validation)
  const refSpec = specOf(reference.options)
  const same = JSON.stringify(spec) === JSON.stringify(refSpec)
  const vEvals = await evaluateSpecs(same ? [spec] : [spec, refSpec], vSeeds, pool, { cache, objective })
  fights.used += (same ? 1 : 2) * vSeeds.length
  const bestEval = vEvals[0]
  const refEval = same ? vEvals[0] : vEvals[1]
  const p = pairedVectors(refEval.perSeed, bestEval.perSeed)
  const winDiff = mean(bestEval.summaries.map((s, k) => (s.win ? 1 : 0) - (refEval.summaries[k].win ? 1 : 0)))
  const chosenName: BuildValidation['chosen'] = same || bestEval.objective >= refEval.objective ? 'best' : 'reference'
  const validation: BuildValidation = {
    seeds: vSeeds.length,
    best: bestEval,
    reference: refEval,
    bestMetrics: fightMetrics(bestEval.summaries, objective),
    referenceMetrics: fightMetrics(refEval.summaries, objective),
    paired: { diff: r3(p.diff), se: r3(p.se), z: zOf(p), winDiff: r3(winDiff) },
    chosen: chosenName,
    same,
  }
  const vm = validation.bestMetrics
  const rm = validation.referenceMetrics
  say(`Validation (${vSeeds.length} graines neuves) : optimisée ${vm.wins}/${vm.n} V, objectif ${vm.objective.toFixed(3)}, corrompus ${vm.corrupted.toFixed(1)}, tours ${vm.rounds.toFixed(1)}, 1re mort ${vm.firstDeath.toFixed(1)}${same ? ' (= référence)' : ` ; référence ${rm.wins}/${rm.n} V, objectif ${rm.objective.toFixed(3)}, corrompus ${rm.corrupted.toFixed(1)}, tours ${rm.rounds.toFixed(1)}, 1re mort ${rm.firstDeath.toFixed(1)} ; Δ ${validation.paired.diff >= 0 ? '+' : ''}${validation.paired.diff.toFixed(3)} (z ${validation.paired.z.toFixed(2)})`}.`)
  if (chosenName === 'reference') notes.push('La validation ne confirme pas le gain de la configuration optimisée : la référence (builds par défaut) est retenue.')
  if (vm.n < 128) notes.push(`Taux de victoire sur ${vm.n} combats seulement : à confirmer sur ≥ 128-256 graines (victoires rares au Vortex).`)
  const chosen = chosenName === 'best'
    ? { spec, options: best.options, evaluation: bestEval }
    : { spec: refSpec, options: reference.options, evaluation: refEval }
  say(`Combats nouveaux demandés : ${fights.used}.`)
  return {
    scenarioId: base.scenarioId,
    mode: base.mode,
    composition: comp,
    budget,
    plan,
    masterSeed: master,
    screenKind,
    maxFights: opts.maxFights,
    slots,
    screenSeeds,
    halving,
    reference,
    best,
    variants,
    tune,
    stuff: stuffResults,
    validation,
    chosen,
    fights: fights.used,
    log,
    notes,
  }
}

// ───────────────────────────── résumé pour le rapport ─────────────────────────────

/** Section « recherche des builds » du rapport (JSON sans spécifications ni lots). */
export interface BuildsReport {
  composition: { classes: string[]; source: string; file?: string; chosenBy: string; decidedAt?: string; text: string; notes: string[] }
  budget: string
  mode: string
  screenKind: string
  masterSeed: number
  maxFights?: number
  fights: number
  screenSeeds: number
  slots: (SlotReport & { chosen: string })[]
  halving: HalvingRound[]
  validation: { seeds: number; chosen: 'best' | 'reference'; same: boolean; best: { options: string[]; metrics: FightMetrics }; reference: { options: string[]; metrics: FightMetrics }; paired: BuildValidation['paired'] }
  variants?: { accepted: number; base: number; final: number }
  theta?: { accepted: boolean; diff: number; z: number }
  notes: string[]
}

/** Section du rapport (voir `BuildsReport`). */
export function buildsReport(r: BuildSearchResult): BuildsReport {
  const c = r.composition
  return {
    composition: { classes: compositionClasses(c), source: c.source, file: c.file, chosenBy: c.chosenBy, decidedAt: c.decidedAt, text: describeComposition(c), notes: c.notes.slice() },
    budget: r.budget,
    mode: r.mode,
    screenKind: r.screenKind,
    masterSeed: r.masterSeed,
    maxFights: r.maxFights,
    fights: r.fights,
    screenSeeds: r.screenSeeds,
    slots: r.slots.map((s, i) => ({ ...s, chosen: r.chosen.options[i].id })),
    halving: r.halving,
    validation: {
      seeds: r.validation.seeds,
      chosen: r.validation.chosen,
      same: r.validation.same,
      best: { options: r.best.options.map(o => o.id), metrics: r.validation.bestMetrics },
      reference: { options: r.reference.options.map(o => o.id), metrics: r.validation.referenceMetrics },
      paired: r.validation.paired,
    },
    variants: r.variants && { accepted: r.variants.accepted.length, base: r3(r.variants.base.objective), final: r3(r.variants.final.objective) },
    theta: r.tune && { accepted: r.tune.accepted, diff: r3(r.tune.validation.paired.diff), z: Math.round(r.tune.validation.paired.z * 100) / 100 },
    notes: r.notes.slice(),
  }
}
