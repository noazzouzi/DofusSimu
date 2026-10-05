/**
 * Modèle stratégique COMPLET de l'Œil de Vortex (`ScenarioAIModel`, docs/design/ai.md §5.2, §9.4, §12) — WP3b.
 *
 * `update` (début du tour de chaque joueur) :
 *  1. modèle de base (scenario.ts : phase, croix de l'Auroraire au prochain créneau du Vortex, décisions clés) ;
 *  2. coûts d'heures (hourCost.ts) calculés UNE fois par combat (mesurés en `standard`/`deep`, table de repli en
 *     `fast`/`scripted`, sauf option `costs`) ;
 *  3. phases `opening`/`waveCycle` : oracle de kill (DPT de chaque joueur sur chaque monstre, `canKillNow` pour le
 *     joueur courant en `standard`/`deep`, calibration en ligne §12.6), racine abstraite (tracker), `HourPlanner`
 *     (planner.ts), prix (`HeuristicPricer` en `fast`, `SearchPricer` sinon, pricer.ts) → `bb.prices`, `bb.plan` ;
 *     coût de mort d'un allié pour l'horloge (`allyDeathExtra`) ; cache entre événements symboliques en `fast` ;
 *  4. `waiting` : aucun contrat, prix vides (cases d'échange forcé seulement) ; `transition`/`burst` : `BurstPlan`
 *     (burst.ts) → intentions 'burst' et prix du Vortex ; `bb.plan` = plan de burst.
 *
 * Contrat avec V(s) (§7) : `damageWeight` = pente `hp.slope` du prix (θ.vortex.waveHpSlope par défaut ; 0 pour un
 * corrompu et pour le Vortex hors burst) ; `deathValue` = `kill[m][0]` si le monstre est mort sous l'étoile,
 * `kill[m][h]` pour une mort à l'heure h LUE dans ses états (jamais supposée), `θ.vortex.vortexKill` pour le Vortex ;
 * `extraIncoming` = croix d'*En temps et en heure* (modèle de base) + Heuristique depuis la case d'arrivée d'Heurage
 * en phase 2 (lignes ≤ 8 sans LdV) ; `allyDeathExtra` = perte de score du plan si l'allié meurt (son créneau ne fait
 * plus avancer l'horloge, ses contrats tombent). Hors contrat (ajout WP3b, à brancher par WP2 dans le terme `scenario`
 * de `evaluate.ts`) : `revivedValue(root, leaf, bb)` = prix des morts que `deathValue` ne voit pas, monstres tués PUIS
 * ressuscités (corrompus ou zombies) dans un rollout qui traverse le tour du Vortex.
 *
 * Honnêteté (§6.1) : lit l'état public (états, PV, cases, buffs, timeline, `deaths`) et les métriques de SON équipe
 * (dégâts infligés : calibration) ; jamais `fight.events` ni les dés.
 * Enregistrement : `registerVortexAIModel()` (appelé à l'import de ce module) branche ce modèle sur
 * `vortexScenario.aiModel` (`setVortexAIModelFactory`, scenario.ts).
 */
import { createDptTable, type DptTableImpl } from '../../ai/core/dpt'
import { damageDigest } from '../../ai/core/hash'
import { mix32 } from '../../core/hash'
import { canKillNow } from '../../ai/core/kill'
import type { PerceptionX } from '../../ai/core/perception'
import { computeReach } from '../../ai/core/reach'
import { createControllers, defaultAIConfig } from '../../ai/index'
import type { AIMode, AIView, Blackboard, Intent, Perception, PhaseId, PriceTable, ReferenceTargets, StrategyParams } from '../../ai/types'
import type { Engine } from '../../engine/engine'
import { cloneFighter } from '../../engine/engine'
import { createMonsterFighter } from '../../engine/factory'
import type { ControllerProvider } from '../../engine/runner'
import type { Fighter, FightState } from '../../engine/types'
import { CELL_COUNT, CELL_X, CELL_Y, distance } from '../../map/geometry'
import type { AbsAction, CandidateHint, ClockSlot, KeyDecisionReason, MicroResult, ScenarioAIModel, ScenarioParams, ScenarioPlan } from '../types'
import { absFromFight, absParamsOf, type AbsMonster, type AbsState } from './abstract'
import { planBurst, type VortexBurstPlan } from './burst'
import { checkForecast, currentHour, deathHours, forecastHours, hasStar, isCorrupted, isWaveMonster, lineCells, nextVortexSlot } from './clock'
import { GLYPH_PLANNER_BONUS, HOUR_CELL, HOUR_COUNT, MEJAIRE, nextHour, SPELL, VORTEX, VORTEX_SCENARIO_ID, WAVE_MONSTER_IDS, type VortexParams } from './constants'
import { fallbackHourCosts, HIT_FACTOR, HourCostModel, measureHourCosts, teamTurnDamage, waveMonsterElements } from './hourCost'
import { prefix12Micro } from './micro'
import { resolveVortexParams, vortexState } from './params'
import { rankVortexPlacements } from './placement'
import { actionKey, KillOracle, planHours, plannerConfig, slotsWithoutPlayer, type PlannerConfig, type PlannerContext, type PlanResult } from './planner'
import { heuristicPrices, rootPredictedDamage, searchPrices, swapCellPrices } from './pricer'
import { basicVortexAIModel, setVortexAIModelFactory, vortexPhase, vortexVulnerableAt } from './scenario'
import { VortexTracker } from './tracker'

// ───────────────────────────── options ─────────────────────────────

export interface VortexModelOptions {
  /** Coûts d'heures : 'auto' (mesurés en standard/deep, repli en fast/scripted), 'measured', 'fallback'. */
  costs?: 'auto' | 'measured' | 'fallback'
  /** Placement « simulé » (§12.10) : candidats analytiques joués sur `prefix12` (défaut 8 × 16 graines, IA `fast`). */
  placementCandidates?: number
  placementSeeds?: number
  placementMode?: AIMode
}

/** Plan publié dans `Blackboard.plan` : plan d'heures (phases de vagues) ou plan de burst (phase 2). */
export type VortexBlackboardPlan = { kind: 'hours'; plan: ScenarioPlan } | { kind: 'burst'; burst: VortexBurstPlan }

/** Plan Vortex d'un tableau noir (undefined si absent ou d'un autre scénario). */
export function vortexPlanOf(bb: Blackboard): VortexBlackboardPlan | undefined {
  const p = bb.plan as VortexBlackboardPlan | undefined
  return p && (p.kind === 'hours' || p.kind === 'burst') ? p : undefined
}

/**
 * État pur du modèle (rembobinage, §15.8) : tout ce qui influence une décision future et ne se recalcule pas à
 * l'identique depuis l'état du combat — calibration de l'oracle, coûts d'heures (mesurés UNE fois, avec l'équipe
 * vivante d'alors : un modèle neuf restauré après une mort les mesurerait autrement), fin de la première fenêtre de
 * burst (décision clé), prévision précédente (auto-contrôle de l'horloge).
 */
export interface VortexModelSnapshot {
  oracle: ReturnType<KillOracle['snapshot']>
  tracker: { version: number; sig: number }
  version: number
  costs?: { key: string; source: 'measured' | 'fallback'; mon: [number, number[]][]; vx: number[] }
  burstWindowEnd?: { round: number; index: number }
  lastSlots?: ClockSlot[]
  forecastMismatches?: number
}

// ───────────────────────────── outils ─────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Plafond du coût « horloge » d'une mort d'allié (PVe, s'ajoute au coût de mort de V(s), ≈ 10 000). */
export const DEATH_EXTRA_MAX = 4000

const STATUS_BITS: Record<AbsMonster['status'], number> = { pending: 1, invulnerable: 2, alive: 3, dead: 4, corrupt: 5 }

/** Clé d'un créneau (tour de jeu, combattant). */
const slotKey = (round: number, fighterId: number): number => round * 65536 + fighterId

/** Personnages vivants (racines) d'une équipe. */
function livingPlayers(s: FightState, team: number): Fighter[] {
  return s.fighters.filter(f => f.alive && f.team === team && f.kind === 'player' && f.summonerId === undefined)
}

/** Portée de frappe : PM + plus grande portée d'un sort de dégâts (PO comprise si modifiable). */
function strikeReach(dpt: DptTableImpl, f: Fighter): number {
  let r = 0
  for (const p of dpt.profiles.ofFighter(f)) if (p.damage.length) r = Math.max(r, p.maxRange + (p.level.rangeBoostable ? Math.max(0, f.stats.range) : 0))
  return Math.max(0, Math.floor(f.mp)) + r
}

/** Glyphes de monstre de vague sur la carte (cases centrales et poseur). */
function monsterGlyphs(s: FightState): { cell: number; monsterId: number }[] {
  const out: { cell: number; monsterId: number }[] = []
  for (const g of s.glyphs) {
    if (g.castSpellId !== SPELL.GLYPHE_TRIGGER && g.spellId !== SPELL.GLYPHE_POSE) continue
    const src = s.fighters[g.sourceId]
    if (!src || !isWaveMonster(src)) continue
    out.push({ cell: g.center, monsterId: src.monsterId! })
  }
  return out
}

/** Heures portées par un monstre au moment d'une mort simulée : bits apparus entre la racine et la feuille. */
function newDeathHour(root: Fighter | undefined, leaf: Fighter): number {
  const before = root ? deathHours(root) : 0
  const added = deathHours(leaf) & ~before
  for (let h = HOUR_COUNT; h >= 1; h--) if (added & (1 << (h - 1))) return h
  return 0
}

// ───────────────────────────── modèle ─────────────────────────────

export class VortexAIModel implements ScenarioAIModel {
  readonly id = VORTEX_SCENARIO_ID
  readonly params: VortexParams
  private readonly base: ScenarioAIModel
  readonly oracle: KillOracle
  readonly tracker = new VortexTracker()
  costs?: HourCostModel
  private costsKey = ''
  /** Dernier plan d'heures, dernier plan de burst, dernière racine abstraite. */
  lastPlan?: PlanResult
  lastBurst?: VortexBurstPlan
  lastRoot?: AbsState
  lastPhase: PhaseId = 'fight'
  /** Coût de mort de chaque allié (horloge), recalculé à chaque mise à jour. */
  readonly deathExtra = new Map<number, number>()
  /** Cases des glyphes atteignables par le joueur courant (indices). */
  private glyphCells: number[] = []
  private version = 0
  private cache?: { key: string; prices: PriceTable; plan: PlanResult; root: AbsState }
  private refs = new Map<number, Fighter>()
  private refThreat = new Map<number, number>()
  /** DPT d'un joueur sur un monstre de référence, par (joueur, empreinte « dégâts », monstre). */
  private refDpt = new Map<string, number>()
  private engine?: Engine
  private meId = -1
  private deathKey = ''
  private lastSlots?: ReturnType<typeof forecastHours>
  /** Menace intrinsèque (dégâts d'un tour répartis sur l'équipe) par (monstre, révision), pour une équipe donnée. */
  private intrinsicCache = new Map<string, number>()
  private intrinsicTeam = ''
  /** Créneaux où l'heure lue différait de la prévision précédente (auto-contrôle §12.2). */
  forecastMismatches = 0
  /** Fin de la première fenêtre de burst (tour du Vortex qui la clôt). */
  private burstWindowEnd?: { round: number; index: number }

  constructor(
    params: ScenarioParams,
    readonly theta: StrategyParams,
    readonly options: VortexModelOptions = {},
  ) {
    this.params = resolveVortexParams(params)
    this.base = basicVortexAIModel(params, theta)
    this.oracle = new KillOracle(theta.planner.oracleAlpha)
  }

  // ── mise à jour ──

  update(view: AIView, bb: Blackboard, perception: Perception, mode: AIMode): void {
    this.base.update(view, bb, perception, mode)
    const s = view.fight
    const vx = vortexState(s)
    this.engine = view.engine
    this.meId = view.me.id
    this.lastPhase = bb.phase
    this.refreshHeuristiqueLines(s)
    if (!vx) return
    const px = perception as Partial<PerceptionX> | undefined
    const dpt: DptTableImpl = px?.dpt && typeof px.dpt.dpt === 'function' ? (px.dpt as DptTableImpl) : createDptTable(view.engine)
    const players = livingPlayers(s, view.team)
    this.ensureCosts(view.engine, players, bb, mode, dpt)
    // Calibration de l'oracle : prévisions des tours joués depuis.
    this.oracle.observe(id => {
      const m = s.metrics[id]
      return m ? { dealt: m.damageDealt, turns: m.turnsPlayed } : undefined
    })
    bb.intents = bb.intents.filter(i => i.source !== 'planner' && i.source !== 'burst')
    const phase = bb.phase
    if (phase === 'transition' || phase === 'burst') {
      this.lastPlan = undefined
      const burst = planBurst(view, { theta: this.theta, params: this.params, dpt })
      this.lastBurst = burst
      this.deathExtra.clear()
      if (!burst) return
      // Première fenêtre de burst (décision clé 'burst') : du premier créneau vulnérable au tour suivant du Vortex.
      if (phase === 'burst' && !this.burstWindowEnd && burst.vulnerableNow) this.burstWindowEnd = burst.windowEnd ?? { round: s.round + 1, index: 0 }
      bb.prices = { ...burst.prices, cell: swapCellPrices(forecastHours(s, 2, this.params), view.me.id, this.theta) }
      for (const st of burst.steps) bb.intents.push(...st.intents)
      bb.plan = { kind: 'burst', burst } satisfies VortexBlackboardPlan
      return
    }
    this.lastBurst = undefined
    if (phase === 'waiting') {
      this.lastPlan = undefined
      this.deathExtra.clear()
      const slots = forecastHours(s, 2, this.params)
      bb.prices = { kill: new Map(), hp: new Map(), clock: [0, 0, 0] }
      const cell = swapCellPrices(slots, view.me.id, this.theta)
      if (cell) bb.prices.cell = cell
      bb.plan = { kind: 'hours', plan: emptyPlan(++this.version) } satisfies VortexBlackboardPlan
      return
    }
    // Phases de vagues : planificateur d'heures + prix.
    const { prices, plan, root } = this.planWaves(view, bb, px, mode, dpt, players)
    bb.prices = prices
    bb.plan = { kind: 'hours', plan: plan.plan } satisfies VortexBlackboardPlan
    this.lastPlan = plan
    this.lastRoot = root
  }

  /** Coûts d'heures (une fois par combat et par équipe). */
  private ensureCosts(engine: Engine, players: Fighter[], bb: Blackboard, mode: AIMode, dpt: DptTableImpl): void {
    const vx = this.params
    const key = players.map(p => p.id).join(',')
    if (this.costs && (this.costsKey === key || !players.length)) return
    if (this.costs && this.costsKey && key.split(',').length < this.costsKey.split(',').length) return // une mort ne refait pas la mesure
    const hasPlacer = [...bb.roles.values()].some(r => r.primary === 'placer') || players.some(p => p.role === 'placer')
    const want = this.options.costs ?? 'auto'
    const measured = want === 'measured' || (want === 'auto' && (mode === 'standard' || mode === 'deep'))
    if (measured) this.costs = measureHourCosts(engine, { params: vx, theta: this.theta, team: players, hasPlacer, dpt })
    else {
      const els = waveMonsterElements(engine, vx.monsterGrade)
      this.costs = fallbackHourCosts({ hasPlacer, scale: this.theta.planner.hourCostScale, elementsOf: id => els.get(id) })
    }
    this.costsKey = key
  }

  /** Monstre de référence (grade du combat) d'un identifiant de monstre de vague. */
  private refOf(engine: Engine, monsterId: number): Fighter {
    let r = this.refs.get(monsterId)
    if (!r) {
      r = createMonsterFighter(engine.data, { monsterId, grade: this.params.monsterGrade, team: 1 })
      r.id = -300 - monsterId
      engine.recomputeStats(r)
      this.refs.set(monsterId, r)
    }
    return r
  }

  private planWaves(view: AIView, bb: Blackboard, px: Partial<PerceptionX> | undefined, mode: AIMode, dpt: DptTableImpl, players: Fighter[]):
    { prices: PriceTable; plan: PlanResult; root: AbsState } {
    const s = view.fight
    const engine = view.engine
    const me = view.me
    const theta = this.theta
    const cfg = plannerConfig(mode, theta)
    const N = Math.max(1, players.length)
    const rounds = Math.ceil(cfg.horizonPlayerSlots / N) + Math.ceil(HOUR_COUNT / N) + 2
    const slots = forecastHours(s, rounds, this.params)
    // Auto-contrôle (§12.2) : l'heure lue doit être celle que la prévision précédente annonçait pour ce créneau ;
    // sinon le cache est invalidé (diagnostic `forecastMismatches`).
    if (this.lastSlots && checkForecast(this.lastSlots, s) === false) {
      this.forecastMismatches++
      this.cache = undefined
    }
    this.lastSlots = slots
    // Menace propre des monstres : perception (distance comprise), plancher 60 % de la menace intrinsèque.
    const threatFn = px?.threat && typeof px.threat.threatOf === 'function' ? px.threat : undefined
    // Clés « dégâts » (empreintes de caractéristiques, pas `rev` : un simple déplacement change `rev` et viderait les
    // caches à chaque tour).
    const teamKey = players.map(p => `${p.id}:${damageDigest(p)}`).join(',')
    if (teamKey !== this.intrinsicTeam) {
      this.intrinsicCache.clear()
      this.refThreat.clear()
      this.intrinsicTeam = teamKey
    }
    const intrinsic = (m: Fighter): number => {
      const k = `${m.id}:${damageDigest(m)}`
      let v = this.intrinsicCache.get(k)
      if (v === undefined) {
        if (this.intrinsicCache.size > 512) this.intrinsicCache.clear()
        this.intrinsicCache.set(k, (v = HIT_FACTOR * teamTurnDamage(dpt, m, players)))
      }
      return v
    }
    const threatOf = (m: Fighter): number => Math.max(threatFn ? threatFn.threatOf(m) : 0, 0.6 * intrinsic(m))
    const refThreat = (monsterId: number): number => {
      let t = this.refThreat.get(monsterId)
      if (t === undefined) this.refThreat.set(monsterId, (t = 0.6 * intrinsic(this.refOf(engine, monsterId))))
      return t
    }
    this.tracker.observe(s)
    const root = absFromFight(s, slots, { threatOf })
    // Menace des monstres sans menace observable : vagues à venir et morts en attente de résurrection (le tracker leur
    // donne 0) — monstre de référence, sinon un monstre tué plus tôt dans le tour de jeu serait sans coût d'exposition
    // après sa résurrection (et sa corruption sans urgence).
    for (const m of root.monsters as AbsMonster[]) {
      if (m.id < 0 || (m.status === 'dead' && !m.corruptOnWake)) m.threat = refThreat(m.monsterId)
    }
    // Glyphes atteignables par le joueur courant.
    const glyphs = monsterGlyphs(s)
    this.glyphCells = []
    let glyphBonus = 0
    const slot0 = slots[0]
    const meNow = slot0 && slot0.fighterId === me.id
    if (meNow && glyphs.length && me.alive && me.mp > 0) {
      const allow = new Set(glyphs.map(g => g.cell))
      const reach = computeReach(view, s, me, { allowEventCells: allow })
      for (const g of glyphs) {
        if (reach.mpLeft[g.cell] < 0 || this.glyphCells.includes(g.cell)) continue
        this.glyphCells.push(g.cell)
        const bonus = g.monsterId === MEJAIRE ? (me.hp < 0.9 * me.maxHp ? GLYPH_PLANNER_BONUS[MEJAIRE] : 0) : (GLYPH_PLANNER_BONUS[g.monsterId] ?? 0)
        glyphBonus = Math.max(glyphBonus, bonus)
      }
    }
    const glyphsNow = Math.min(2, this.glyphCells.length)
    // Cache (fast) : mêmes faits symboliques, même créneau, mêmes glyphes.
    const ver = this.tracker.version
    const cacheKey = `${ver}|${slot0?.round}.${slot0?.index}.${slot0?.fighterId}|${glyphsNow}|${mode}`
    if ((mode === 'fast' || mode === 'scripted') && this.cache?.key === cacheKey) return this.cache
    // Oracle de kill.
    const oracle = this.oracle
    oracle.reset()
    oracle.nowPlayer = meNow ? me.id : -1
    const alive = s.fighters.filter(f => f.alive && isWaveMonster(f))
    for (const p of players) {
      for (const m of alive) oracle.setDpt(p.id, { id: m.id }, dpt.dpt(p, m), deathHours(m))
      // Monstres de référence (vagues à venir, morts) : DPT mis en cache par empreinte « dégâts » du joueur (relances
      // ignorées : créneaux futurs).
      const pk = damageDigest(p)
      for (const id of WAVE_MONSTER_IDS) {
        const k = `${p.id}:${pk}:${id}`
        let v = this.refDpt.get(k)
        if (v === undefined) {
          if (this.refDpt.size > 256) this.refDpt.clear()
          this.refDpt.set(k, (v = dpt.dpt(p, this.refOf(engine, id))))
        }
        oracle.setDpt(p.id, { monsterId: id }, v)
      }
    }
    if (meNow) {
      const reach = strikeReach(dpt, me)
      const exact = mode === 'standard' || mode === 'deep'
      for (const m of alive) {
        if (isCorrupted(m) || !vortexVulnerableAt(s, m, 0)) continue
        if (exact) {
          const k = canKillNow(view, me, m, px as Perception | undefined)
          oracle.now.set(m.id, { reach: k.spells.length > 0, p: k.p })
        } else oracle.now.set(m.id, { reach: distance(me.cell, m.cell) <= reach, p: NaN })
      }
    }
    // Contrats interdits aux mpLock/apLock à faible DPT (§9.2).
    const meanDpt = new Map<number, number>()
    for (const p of players) {
      let sum = 0
      for (const id of WAVE_MONSTER_IDS) sum += oracle.dptOf(p.id, { id: -1, monsterId: id } as AbsMonster)
      meanDpt.set(p.id, sum / WAVE_MONSTER_IDS.length)
    }
    const teamMean = [...meanDpt.values()].reduce((a, b) => a + b, 0) / Math.max(1, meanDpt.size)
    const canContract = (id: number): boolean => {
      const role = bb.roles.get(id)?.primary ?? (s.fighters[id]?.role as string | undefined)
      if (role !== 'mpLock' && role !== 'apLock') return true
      return (meanDpt.get(id) ?? 0) >= theta.team.killerMinDptFrac * teamMean
    }
    const liveHp = (id: number): number | undefined => (id >= 0 ? s.fighters[id]?.hp : undefined)
    const ctx: PlannerContext = {
      slots,
      costs: this.costs!,
      abs: absParamsOf(s),
      players: N,
      expected: (i, p, m) => oracle.expected(i, p, m),
      pKillNow: m => {
        const v = oracle.pKillNow(m, liveHp(m.id))
        return v === undefined || Number.isNaN(v) ? undefined : v
      },
      canContract,
      glyphsNow,
      glyphBonusNow: glyphBonus,
    }
    const version = ++this.version
    const result = planHours(root, ctx, cfg, { version })
    // Relances forcées (SearchPricer §9.6) : même réglage pour toutes les actions chiffrées (comparaison à effort égal).
    const replanBeam = Math.max(2, Math.round(cfg.beamWidth / 4))
    const replan = (force: AbsAction): PlanResult =>
      planHours(root, ctx, cfg, { forceRoot: force, beamWidth: replanBeam, horizonPlayerSlots: Math.min(8, cfg.horizonPlayerSlots), version })
    const floorOf = (m: AbsMonster): number => this.floorOf(s, m, players, dpt)
    const inp = { result, root, ctx, cfg, theta, me: me.id, floorOf, replan: glyphsNow > 0 || mode !== 'fast' ? replan : undefined, maxReplans: mode === 'deep' ? 12 : 8 }
    const prices = mode === 'standard' || mode === 'deep' ? searchPrices(inp) : heuristicPrices(inp)
    // Calibration : dégâts prévus de MON action racine.
    if (meNow) oracle.expect(me.id, rootPredictedDamage(result, root, slot0), s.metrics[me.id]?.damageDealt ?? 0, s.metrics[me.id]?.turnsPlayed ?? 0)
    this.computeDeathExtra(root, ctx, cfg, result, players, mode)
    const out = { key: cacheKey, prices, plan: result, root }
    this.cache = out
    return out
  }

  /** Plancher de PV (μ du plus gros coup d'un allié + 2σ + DoT en attente) d'un monstre qu'on ne veut pas tuer. */
  private floorOf(s: FightState, m: AbsMonster, players: Fighter[], dpt: DptTableImpl): number {
    const f = m.id >= 0 ? s.fighters[m.id] : undefined
    if (!f) return 0
    let best = 0
    for (const p of players) best = Math.max(best, dpt.bestCast(p, f).mean)
    let dot = 0
    for (const b of f.buffs) if (b.kind === 'trigger' && b.triggers?.includes('TB') && b.effect.effectId >= 91 && b.effect.effectId <= 100) dot += b.effect.diceNum
    return Math.round(best * (1 + 2 * 0.15) + dot)
  }

  /** Coût de mort de chaque allié : écart de score du plan sans son créneau (standard/deep), forme close en fast. */
  private computeDeathExtra(root: AbsState, ctx: PlannerContext, cfg: PlannerConfig, result: PlanResult, players: Fighter[], mode: AIMode): void {
    // Recalcul à chaque événement symbolique ou nouveau tour de jeu seulement (coût : N + 1 plans `fast`). La version
    // du tracker change à CHAQUE tour de joueur (l'heure est dans son empreinte) : la clé lit les faits symboliques
    // seuls (statuts, heures de mort, étoiles), sans l'heure courante.
    let sig = root.round
    for (const m of root.monsters) sig = mix32(mix32(sig, m.id), (STATUS_BITS[m.status] << 16) ^ (m.hours << 2) ^ (m.star ? 2 : 0) ^ (m.corruptOnWake ? 1 : 0))
    const key = `${sig >>> 0}|${root.round}|${players.map(p => p.id).join(',')}|${mode}`
    if (key === this.deathKey) return
    this.deathKey = key
    this.deathExtra.clear()
    if (mode === 'standard' || mode === 'deep') {
      const fast = plannerConfig('fast', this.theta)
      const base = planHours(root, ctx, fast).best
      for (const p of players) {
        const slots = slotsWithoutPlayer(ctx.slots, p.id, this.params.deadPlayerAdvancesClock)
        const without = planHours(root, { ...ctx, slots, players: Math.max(1, ctx.players - 1) }, fast).best
        this.deathExtra.set(p.id, clamp(base - without, 0, DEATH_EXTRA_MAX))
      }
    } else {
      for (const p of players) {
        let v = 0
        for (const c of result.plan.contracts) if (c.killer === p.id) v += c.kind === 'corrupt' ? 0.5 * cfg.corruptBonus : 250
        this.deathExtra.set(p.id, Math.min(DEATH_EXTRA_MAX, v))
      }
    }
  }

  // ── contrat avec V(s) ──

  damageWeight(e: Fighter, bb: Blackboard): number | undefined {
    if (e.monsterId === VORTEX) {
      if (bb.phase !== 'burst') return 0
      return bb.prices.hp.get(e.id)?.slope ?? 1
    }
    if (!isWaveMonster(e)) return undefined
    if (isCorrupted(e)) return 0
    return bb.prices.hp.get(e.id)?.slope ?? this.theta.vortex.waveHpSlope
  }

  deathValue(root: FightState, leaf: FightState, victim: Fighter, bb: Blackboard): number | undefined {
    if (victim.monsterId === VORTEX) return this.theta.vortex.vortexKill
    if (!isWaveMonster(victim)) return undefined
    const r0 = root.fighters[victim.id]
    const row = bb.prices.kill.get(victim.id)
    // Étoile au moment de la mort : portée par le mort (état persistant), ou à la racine si l'heure n'a pas bougé.
    const star = hasStar(victim) || (r0 !== undefined && hasStar(r0) && newDeathHour(r0, victim) === 0)
    if (star) return row ? row[0] : this.theta.vortex.corruptKill
    const h = newDeathHour(r0, victim) || currentHour(leaf)
    if (row && h >= 1 && h <= HOUR_COUNT) return row[h]
    // Monstre sans prix (apparu depuis la mise à jour) : mort non planifiée (coût zombie + Vortex si l'heure est neuve).
    return this.unplannedDeath(root, victim, h)
  }

  /** Mort non planifiée d'un monstre à l'heure h : −(base + C_mon + [h neuve]·C_vx), heures posées lues à la racine. */
  private unplannedDeath(root: FightState, victim: Fighter, h: number): number {
    const tv = this.theta.vortex
    if (!this.costs || h < 1 || h > HOUR_COUNT) return -tv.unplannedKillBase
    let used = 0
    for (const f of root.fighters) if (isWaveMonster(f)) used |= deathHours(f)
    return Math.max(tv.killMin, -(tv.unplannedKillBase + this.costs.markCost(victim.monsterId!, h, used)))
  }

  /**
   * Morts INVISIBLES à `deathValue` (V(s) ne l'appelle que pour un mort) : monstres de vague vivants à la racine ET
   * dans `leaf`, tués puis ressuscités entre les deux — rollouts qui traversent le tour du Vortex (§8.6). Corrompu
   * depuis la racine ⇒ `kill[m][0]` ; heure de mort nouvelle h (masque agrandi) ⇒ `kill[m][h]`. Somme à ajouter au
   * terme `scenario` de l'évaluation (WP2, `tactical/evaluate.ts`) pour que la corruption d'un rollout garde sa valeur.
   */
  revivedValue(root: FightState, leaf: FightState, bb: Blackboard): number {
    let v = 0
    for (const f of leaf.fighters) {
      if (!f.alive || !isWaveMonster(f)) continue
      const r0 = root.fighters[f.id]
      if (!r0 || !r0.alive) continue
      const row = bb.prices.kill.get(f.id)
      if (isCorrupted(f) && !isCorrupted(r0)) {
        v += row ? row[0] : this.theta.vortex.corruptKill
        continue
      }
      const h = newDeathHour(r0, f)
      if (h) v += row ? row[h] : this.unplannedDeath(root, f, h)
    }
    return v
  }

  extraIncoming(s: FightState, a: Fighter, cell: number): number {
    let v = this.base.extraIncoming?.(s, a, cell) ?? 0
    v += this.heuristiqueIncoming(s, a, cell)
    return v
  }

  /**
   * Phase 2 : Heuristique depuis la case d'arrivée d'Heurage (contact de la future case de l'Auroraire) si Heurage
   * sera prêt au prochain tour du Vortex et que `a` ne rejoue pas avant ; ligne ≤ 8, sans LdV.
   */
  private heuristiqueIncoming(s: FightState, a: Fighter, cell: number): number {
    const vx = vortexState(s)
    if (!vx || vx.actionRound === 0 || cell < 0) return 0
    const v = s.fighters[vx.vortexId]
    if (!v || !v.alive || (v.cooldowns[SPELL.HEURAGE] ?? 0) > 1) return 0
    // Heure de l'Auroraire au prochain tour du Vortex : heure LUE dans `s` (une glyphe simulée la décale) + heures
    // restantes jusqu'au créneau du Vortex (prévision faite par `update`, indexée par créneau : valable dans les clones
    // et les rollouts des 2 tours suivants, sans prévision par appel). Un allié qui rejoue avant peut encore bouger.
    const cur = s.turnIndex >= 0 ? s.fighters[s.timeline[s.turnIndex]] : undefined
    const line = cur ? this.heurLines.get(slotKey(s.round, cur.id)) : undefined
    if (!line || line.movers.has(a.id)) return 0
    const h = currentHour(s)
    if (!h) return 0
    const target = HOUR_CELL[nextHour(h, line.offset)]
    if (!(target > 0)) return 0
    let aligned = false
    for (const c of this.contactCells(s, target)) {
      if (c !== cell && (CELL_X[c] === CELL_X[cell] || CELL_Y[c] === CELL_Y[cell]) && distance(c, cell) <= 8) {
        aligned = true
        break
      }
    }
    if (!aligned || !this.engine) return 0
    const dpt = createDptTable(this.engine)
    const idx = v.spells.findIndex(k => k.spellId === SPELL.HEURISTIQUE)
    return idx >= 0 ? dpt.perCast(v, idx, a).mean : 0
  }

  /** Phase 2 : heures restantes jusqu'au prochain créneau du Vortex et alliés qui jouent avant lui, par créneau. */
  private heurLines = new Map<number, { offset: number; movers: ReadonlySet<number> }>()

  /** Recalcule `heurLines` depuis l'état réel (début du tour d'un joueur) ; vide avant *Action !*. */
  private refreshHeuristiqueLines(s: FightState): void {
    this.heurLines = new Map()
    const vx = vortexState(s)
    if (!vx || vx.actionRound === 0) return
    const slots = forecastHours(s, 3, this.params).filter(sl => sl.index >= 0)
    for (let i = 0; i < slots.length; i++) {
      let j = i + 1
      while (j < slots.length && !slots[j].isVortex) j++
      if (j >= slots.length) continue
      const key = slotKey(slots[i].round, slots[i].fighterId)
      if (this.heurLines.has(key)) continue
      const movers = new Set<number>()
      for (let k = i + 1; k < j; k++) movers.add(slots[k].fighterId)
      this.heurLines.set(key, { offset: (((slots[j].hour - slots[i].hour) % 12) + 12) % 12, movers })
    }
  }

  /** Cases marchables au contact d'une case (arrivée d'Heurage), par carte. */
  private contactCache = new Map<number, number[]>()
  private contactCells(s: FightState, target: number): number[] {
    let out = this.contactCache.get(target)
    if (!out) {
      out = []
      for (let c = 0; c < CELL_COUNT; c++) if (distance(c, target) === 1 && s.map.cells[c]?.walkable) out.push(c)
      this.contactCache.set(target, out)
    }
    return out
  }

  private slotsCache?: { s: FightState; round: number; turn: number; slots: ReturnType<typeof forecastHours> }
  private burstSlots(s: FightState): ReturnType<typeof forecastHours> {
    const c = this.slotsCache
    if (c && c.s === s && c.round === s.round && c.turn === s.turnIndex) return c.slots
    const slots = forecastHours(s, 2, this.params)
    this.slotsCache = { s, round: s.round, turn: s.turnIndex, slots }
    return slots
  }

  vulnerableAt(s: FightState, e: Fighter, roundOffset: number): boolean {
    return vortexVulnerableAt(s, e, roundOffset)
  }

  allyDeathExtra(_s: FightState, a: Fighter): number {
    return this.deathExtra.get(a.id) ?? 0
  }

  // ── candidats, décisions clés, placement ──

  hints(view: AIView, me: Fighter, bb: Blackboard): CandidateHint[] {
    const out: CandidateHint[] = []
    const glyphCost = this.theta.planner.glyphCost
    if (me.id === this.meId && this.glyphCells.length && bb.prices.clock[1] > glyphCost) out.push({ kind: 'glyph', cells: this.glyphCells.slice(), weight: bb.prices.clock[1] })
    const plan = this.lastPlan?.plan
    const slot0 = plan?.steps[0]
    if (plan && slot0) {
      for (const c of plan.contracts) {
        if (c.killer !== me.id || c.round !== slot0.round || c.index !== slot0.index) continue
        const row = bb.prices.kill.get(c.m)
        out.push({ kind: 'kill', targetId: c.m, weight: row ? row[c.kind === 'corrupt' ? 0 : c.hour] : 0 })
      }
    }
    const avoid: number[] = []
    if (bb.prices.cell) for (let c = 0; c < bb.prices.cell.length; c++) if (bb.prices.cell[c] < 0) avoid.push(c)
    const s = view.fight
    if (this.lastPhase !== 'burst' && this.lastPhase !== 'transition') {
      // Croix de l'Auroraire au prochain tour du Vortex si je ne rejoue pas avant.
      const slots = this.burstSlots(s)
      const vi = nextVortexSlot(slots, 1)
      if (vi > 0 && !slots.slice(1, vi).some(x => x.fighterId === me.id) && (vortexState(s)?.vortexTurns ?? 0) >= 1) for (const c of lineCells(slots[vi].hour)) avoid.push(c)
    } else if (this.lastBurst) {
      const safe = this.lastBurst.safeCells(s.round, s.turnIndex)
      for (let c = 0; c < safe.length; c++) if (!safe[c] && s.map.cells[c]?.walkable) avoid.push(c)
      const pos = bb.intents.find(i => i.owner === me.id && i.kind === 'position' && i.source === 'burst')
      if (pos?.cells?.length) out.push({ kind: 'reachCell', cells: pos.cells.slice(), weight: pos.price })
    }
    if (avoid.length) out.push({ kind: 'avoidCells', cells: [...new Set(avoid)], weight: this.theta.vortex.swapCell })
    return out
  }

  isKeyDecision(view: AIView, bb: Blackboard): KeyDecisionReason | null {
    const base = this.base.isKeyDecision?.(view, bb) ?? null
    if (base) return base
    const end = this.burstWindowEnd
    const s = view.fight
    if (bb.phase === 'burst' && end && (s.round < end.round || (s.round === end.round && s.turnIndex < end.index))) return 'burst'
    const plan = this.lastPlan?.plan
    const st = plan?.steps[0]
    if (plan && st && st.fighterId === view.me.id && plan.contracts.some(c => c.kind === 'corrupt' && c.killer === view.me.id && c.round === st.round && c.index === st.index)) return 'corruptionKill'
    return null
  }

  roleNeeds() {
    return this.base.roleNeeds!()
  }

  referenceTargets(view: AIView): ReferenceTargets {
    return this.base.referenceTargets!(view)
  }

  /**
   * Placement initial (§12.10) : 'analytic' = classement de `rankVortexPlacements` (indice θ.vortex.placementIndex) ;
   * 'simulated' = les `placementCandidates` meilleures affectations analytiques jouées sur `prefix12` (IA
   * `placementMode`, `placementSeeds` graines CRN), meilleure P(victoire) moyenne (départage : rang analytique). Le
   * moteur est pris dans la perception (`PerceptionX.view.engine`) ; sans moteur, repli analytique.
   */
  choosePlacement(team: Fighter[], perception: Perception, budget: 'analytic' | 'simulated'): number[] {
    const idx = Math.max(0, Math.floor(this.theta.vortex.placementIndex ?? 0))
    const p = { ...this.params, players: team.length }
    const top = budget === 'simulated' ? Math.max(idx + 1, this.options.placementCandidates ?? 8) : idx + 1
    const ranked = rankVortexPlacements(team, p, { top })
    const engine = (perception as Partial<PerceptionX> | undefined)?.view?.engine ?? this.engine
    if (budget !== 'simulated' || !engine || ranked.length <= 1) return ranked[Math.min(idx, ranked.length - 1)].cells
    const results = simulatePlacements(engine, team, ranked.map(r => r.cells), {
      params: this.params, theta: this.theta, seeds: this.options.placementSeeds ?? 16, mode: this.options.placementMode ?? 'fast',
    })
    let best = 0
    for (let i = 1; i < results.length; i++) if (results[i].pWin > results[best].pWin + 1e-9) best = i
    return ranked[best].cells
  }

  // ── rembobinage, journal ──

  snapshot(): VortexModelSnapshot {
    const out: VortexModelSnapshot = { oracle: this.oracle.snapshot(), tracker: this.tracker.snapshot(), version: this.version }
    if (this.costs) {
      out.costs = { key: this.costsKey, source: this.costs.source, mon: [...this.costs.mon].map(([id, row]) => [id, Array.from(row)]), vx: Array.from(this.costs.vx) }
    }
    if (this.burstWindowEnd) out.burstWindowEnd = { ...this.burstWindowEnd }
    if (this.lastSlots) out.lastSlots = this.lastSlots.map(sl => ({ ...sl }))
    if (this.forecastMismatches) out.forecastMismatches = this.forecastMismatches
    return out
  }

  restore(snap: VortexModelSnapshot): void {
    this.oracle.restore(snap.oracle)
    this.tracker.restore(snap.tracker)
    this.version = snap.version
    this.cache = undefined
    this.deathKey = ''
    if (snap.costs) {
      const mon = new Map<number, Float64Array>(snap.costs.mon.map(([id, row]) => [id, Float64Array.from(row)]))
      this.costs = new HourCostModel(mon, Float64Array.from(snap.costs.vx), snap.costs.source)
      this.costsKey = snap.costs.key
    } else {
      this.costs = undefined
      this.costsKey = ''
    }
    this.burstWindowEnd = snap.burstWindowEnd ? { ...snap.burstWindowEnd } : undefined
    this.lastSlots = snap.lastSlots?.map(sl => ({ ...sl }))
    this.forecastMismatches = snap.forecastMismatches ?? 0
  }

  /** Résumé FR du plan courant (aiNote 'plan'). */
  explain(): string {
    if (this.lastBurst) return describeBurstShort(this.lastBurst)
    const plan = this.lastPlan?.plan
    if (!plan) return this.lastPhase === 'waiting' ? 'Attente : tout est corrompu, sécurité hors des lignes de l’Auroraire' : ''
    return describePlan(plan)
  }
}

function emptyPlan(version: number): ScenarioPlan {
  return { version, steps: [], alternatives: [], contracts: [], forbid: [], glyphs: [], bands: [], rootScores: new Map(), etaAllCorrupted: 0 }
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

/** Résumé FR d'un plan d'heures (contrats, glyphes). */
export function describePlan(plan: ScenarioPlan, name: (id: number) => string = id => `#${id}`): string {
  const parts = plan.contracts.map(c => `${name(c.killer)} ${c.kind === 'corrupt' ? 'corrompt' : 'marque'} ${name(c.m)} à ${ROMAN[c.hour]} (tour ${c.round}, ${(c.pKill * 100).toFixed(0)} %)`)
  for (const g of plan.glyphs) parts.push(`glyphe +${g.count} au tour ${g.round}`)
  return parts.length ? `Plan : ${parts.join(' ; ')}` : 'Plan : pas de mort utile dans l’horizon'
}

function describeBurstShort(b: VortexBurstPlan): string {
  return `Burst : P(kill) ${(b.pKill * 100).toFixed(0)} % (μ ${Math.round(b.mean)} / ${b.hp} PV), vulnérable au tour ${b.vulnerableFrom.round}`
}

// ───────────────────────────── placement simulé ─────────────────────────────

export interface SimulatePlacementOptions {
  params: VortexParams
  theta: StrategyParams
  seeds: number
  mode: AIMode
  /** Graine maîtresse des graines CRN (défaut 0x9137). */
  masterSeed?: number
}

/**
 * Joue chaque placement sur le micro-scénario `prefix12` (mêmes graines pour tous : CRN) avec l'IA `mode` et le
 * modèle Vortex complet ; renvoie la P(victoire) moyenne (régression de `prefix12`) et la progression moyenne.
 */
export function simulatePlacements(engine: Engine, team: readonly Fighter[], placements: readonly number[][], o: SimulatePlacementOptions):
  { pWin: number; progress: number }[] {
  const out: { pWin: number; progress: number }[] = []
  const master = o.masterSeed ?? 0x9137
  for (const cells of placements) {
    let pWin = 0
    let progress = 0
    for (let k = 0; k < o.seeds; k++) {
      const seed = ((master ^ Math.imul(k + 1, 0x9e3779b9)) >>> 0) % 0x7fffffff
      const fighters = team.map(f => {
        const c = cloneFighter(f)
        c.buffs = []
        c.alive = true
        c.hp = f.baseMaxHp
        return c
      })
      const fight = prefix12Micro.createFight(engine, fighters, { params: { ...o.params, players: team.length }, seed, placement: cells, rollMode: 'random', record: false, rngRekey: 'perTurn' })
      const model = new VortexAIModel({ ...o.params } as ScenarioParams, o.theta, { costs: 'fallback' })
      const controllers = createControllers(engine, defaultAIConfig(o.mode, seed, o.theta), { scenario: model })
      const r = runMicroFight(engine, fight, controllers, f => prefix12Micro.done(f), prefix12Micro.evaluate)
      pWin += r.pWin
      progress += r.progress
    }
    out.push({ pWin: pWin / Math.max(1, o.seeds), progress: progress / Math.max(1, o.seeds) })
  }
  return out
}

/** Boucle de `runFight` avec arrêt anticipé (même logique de tour que le moteur : cannotPlay, preventsFight). */
function runMicroFight(engine: Engine, fight: FightState, controllers: ControllerProvider, done: (f: FightState) => boolean,
                       evaluate: (f: FightState) => MicroResult, maxTurns = 4000): MicroResult {
  for (let i = 0; i < maxTurns && !fight.ended && !done(fight); i++) {
    const f = engine.nextTurn(fight)
    if (!f) break
    const canPlay = f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
    if (canPlay) controllers(f).playTurn(engine, fight, f)
    if (!fight.ended && f.alive) engine.endTurn(fight, f)
    else if (!fight.ended) engine.emit(fight, { t: 'turnEnd', fighter: f.id })
  }
  return evaluate(fight)
}

// ───────────────────────────── enregistrement ─────────────────────────────

/** Fabrique du modèle complet (contrat `DungeonScenario.aiModel`). */
export function createVortexAIModel(params: ScenarioParams, theta: StrategyParams, options?: VortexModelOptions): VortexAIModel {
  return new VortexAIModel(params, theta, options)
}

/** Branche le modèle complet sur `vortexScenario.aiModel` (idempotent). */
export function registerVortexAIModel(options?: VortexModelOptions): void {
  setVortexAIModelFactory((params, theta) => createVortexAIModel(params, theta, options))
}

registerVortexAIModel()

export { actionKey, vortexPhase }
export type { Intent }
