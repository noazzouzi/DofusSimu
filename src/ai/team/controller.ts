/**
 * Contrôleur de l'équipe des joueurs (docs/design/ai.md §9.1) — WP2.
 *
 * `TeamController` joue le tour de chaque allié (personnages et invocations, §9.7) :
 *  1. `TeamBrain.observe` : vue honnête, perception (une par équipe, synchronisée incrémentalement), capacités et
 *     rôles (affectés au premier tour, réassignés si un porteur de rôle clé meurt) ;
 *  2. `commanderUpdate` : scénario (`ScenarioAIModel.update` : phase, prix, intentions), focus, réservations,
 *     allocation des intentions, urgence (§9.4, §9.5) ;
 *  3. décision clé (§8.8 : scénario, risque de mort, fenêtre de kill, puis `closeCall` après recherche) ⇒ budget ×2 en
 *     `standard`, MCTS en `deep` ; `searchTurn` (§8.2) puis `executePlan` (§8.7 : replanification sur écart, après
 *     chaque action en `fast`) ;
 *  4. annotations `aiNote` (E3) si `cfg.explain` : plan, intentions, tactiques, focus, coups créatifs.
 * `TeamBrain` vit hors de `FightState`, est une fonction déterministe de l'historique et expose `snapshot/restore`
 * (données pures) pour le rembobinage (§15.8). Mode `scripted` : le `TeamController` n'est pas utilisé (politique
 * WP4) ; appelé quand même, il joue le tour glouton de repli.
 */
import type { ScenarioAIModel } from '../../dungeons/types'
import type { Engine } from '../../engine/engine'
import type { Controller } from '../../engine/runner'
import type { Fighter, FightState } from '../../engine/types'
import { createNodeBudget, createPerception, createView, decisionRng, type PerceptionX } from '../core'
import { playGreedyTurn } from '../fallback'
import { createMonsterBrain } from '../monster/brain'
import { creativeNote, emitNote, focusNote, intentNote, planNote, tacticNotes } from '../tactical/explain'
import { intentActive } from '../tactical/evaluate'
import { executePlan } from '../tactical/executor'
import { postKeyReason, preKeyReason } from '../tactical/keys'
import { mctsChoose } from '../tactical/mcts'
import type { SearchPlan, TacticalContext } from '../tactical/node'
import { searchTurn } from '../tactical/turnSearch'
import { tacticsFor } from '../tactics'
import type { AIConfig, AIMode, AIRunStats, AIView, Blackboard, CapabilityProfile, RoleId, TacticId, TurnBudget } from '../types'
import { deserializeBlackboard, emptyBlackboard, emptyPriceTable, serializeBlackboard, type BlackboardData } from './blackboard'
import { commanderUpdate } from './commander'
import { createGenericModel } from './genericModel'
import { assignRoles, capabilities, defaultReferenceTargets, GENERIC_NEEDS, imposedRole, roleScores } from './roles'
import { isSummon, summonBudget, summonPlays, summonRolloutPolicy } from './summons'

export { emptyBlackboard, emptyPriceTable }

/** Instantané pur du `TeamBrain` (rembobinage, §15.8). */
export interface TeamBrainSnapshot {
  version: number
  round: number
  stats: AIRunStats
  bb: BlackboardData
  keysUsed: number
  expectations: [number, string][]
  lastFocus: number
  /** Ids des personnages vivants lors de la dernière affectation des rôles. */
  rolesFor: string
  /** Anti-blocage : compteur, tour de jeu observé, PV manquants par combattant (−1 : mort). */
  stall?: { n: number; round: number; hp: number[] }
}

/** Options d'un `TeamController` (ablations §16.5, diagnostics). */
export interface TeamOptions {
  /** Tactiques interdites. */
  disabledTactics?: ReadonlySet<TacticId>
  /** Sorts non offensifs interdits (ablation). */
  offensiveOnly?: boolean
  /** Rollouts désactivés (ablation). */
  noRollouts?: boolean
  /** Rôles imposés (id → rôle), en plus de `Fighter.role`. */
  roles?: ReadonlyMap<number, RoleId>
  /** Mode imposé (défaut : `cfg.mode`). */
  mode?: AIMode
  /** Budget de tour modifié (tests, ablations sous contrainte de budget). */
  budget?: Partial<TurnBudget>
  /** Rappel après chaque tour joué (tests, rapports). */
  onTurn?: (info: TurnInfo) => void
}

/** Résumé d'un tour joué par le `TeamController`. */
export interface TurnInfo {
  fighterId: number
  round: number
  plan: SearchPlan
  replans: number
  actions: number
  nodes: number
  key?: string
}

/** Décision d'un tour (`TeamController.decide`). */
export interface Decision {
  plan: SearchPlan
  ctx: TacticalContext
  key?: string
  /** Nœuds consommés par la décision (recherches, rollouts, splits, MCTS). */
  nodes: number
  mode: AIMode
  budget: TurnBudget
  explain: boolean
  view: AIView
}

const ROLE_KEYS: readonly RoleId[] = ['healer', 'mpLock', 'apLock', 'placer', 'killer']

/** Mémoire stratégique de l'équipe (rôles, tableau noir, calibration, décisions clés). */
export class TeamBrain {
  bb: Blackboard = emptyBlackboard()
  stats: AIRunStats = { nodes: 0, creativeActions: 0, tactics: {}, keyDecisions: 0 }
  keysUsed = 0
  /** Première action prêtée par le rollout d'un allié à l'allié suivant (cohérence, §9.3). */
  expectations = new Map<number, string>()
  lastFocus = -1
  rolesFor = ''
  /** Anti-blocage : tours de jeu consécutifs sans changement des PV (publics) des combattants. */
  stall = 0
  private stallRound = -1
  private stallHp: number[] = []
  caps = new Map<number, CapabilityProfile>()
  private perception?: PerceptionX
  private perceptionEngine?: Engine
  readonly scenario: ScenarioAIModel

  constructor(
    readonly cfg: AIConfig,
    scenario?: ScenarioAIModel,
  ) {
    this.scenario = scenario ?? createGenericModel(cfg.theta)
  }

  /** Perception de l'équipe (une par moteur et par équipe). */
  perceptionFor(view: AIView): PerceptionX {
    if (!this.perception || this.perceptionEngine !== view.engine || this.perception.side !== view.team) {
      this.perception = createPerception(view, this.cfg, this.scenario, { bb: this.bb })
      this.perceptionEngine = view.engine
    }
    this.perception.bb = this.bb
    return this.perception
  }

  /** Début du tour d'un allié : vue, perception, capacités et rôles. */
  observe(engine: Engine, fight: FightState, me: Fighter): { view: AIView; perception: PerceptionX } {
    const view = createView(engine, fight, me, this.cfg.seed)
    const perception = this.perceptionFor(view)
    perception.sync(fight)
    this.assignRolesIfNeeded(view, perception)
    this.trackStall(fight)
    return { view, perception }
  }

  /**
   * Une fois par tour de jeu : si aucun combattant n'a perdu de PV (PV manquants en hausse) ni n'est mort depuis le tour
   * précédent, `stall` + 1, sinon remis à 0 (PV publics ; vitalité, soin et bouclier ne comptent pas).
   */
  private trackStall(fight: FightState): void {
    if (fight.round === this.stallRound) return
    let lost = this.stallRound < 0
    const missing: number[] = []
    for (const f of fight.fighters) {
      // PV manquants (une vitalité qui s'éteint baisse PV et PV max ensemble : pas une perte) ; −1 : mort.
      missing[f.id] = f.alive ? f.maxHp - f.hp : -1
      const prev = this.stallHp[f.id]
      if (prev !== undefined && prev >= 0 && (missing[f.id] < 0 || missing[f.id] > prev)) lost = true
    }
    this.stall = lost ? 0 : this.stall + 1
    this.stallHp = missing
    this.stallRound = fight.round
  }

  /** Affecte les rôles au premier tour, puis à chaque mort d'un porteur de rôle clé. */
  private assignRolesIfNeeded(view: AIView, p: PerceptionX): void {
    const s = view.fight
    const players = s.fighters.filter(f => f.alive && f.team === view.team && f.kind === 'player')
    const key = players.map(f => f.id).join(',')
    if (key === this.rolesFor) return
    if (this.rolesFor) {
      // Réassignation seulement si un porteur de rôle clé est mort.
      const dead = this.rolesFor.split(',').map(Number).filter(id => !s.fighters[id]?.alive)
      const keyDead = dead.some(id => ROLE_KEYS.includes(this.bb.roles.get(id)?.primary as RoleId))
      if (!keyDead) {
        for (const id of dead) this.bb.roles.delete(id)
        this.rolesFor = key
        return
      }
    }
    this.rolesFor = key
    const ref = this.scenario.referenceTargets?.(view) ?? defaultReferenceTargets(view)
    const scores = players.map(f => {
      const c = capabilities(view, f, p, ref)
      this.caps.set(f.id, c)
      return roleScores(view, f, c, p)
    })
    const prior = new Map<number, RoleId>()
    for (const f of players) {
      const r = imposedRole(f)
      if (r) prior.set(f.id, r)
    }
    const needs = this.scenario.roleNeeds?.() ?? GENERIC_NEEDS
    this.bb.roles = assignRoles(players, scores, needs, prior)
  }

  snapshot(): TeamBrainSnapshot {
    return {
      version: this.bb.version,
      round: this.bb.round,
      stats: { ...this.stats, tactics: { ...this.stats.tactics } },
      bb: serializeBlackboard(this.bb),
      keysUsed: this.keysUsed,
      expectations: [...this.expectations],
      lastFocus: this.lastFocus,
      rolesFor: this.rolesFor,
      stall: { n: this.stall, round: this.stallRound, hp: this.stallHp.slice() },
    }
  }

  restore(snap: TeamBrainSnapshot): void {
    this.bb = snap.bb ? deserializeBlackboard(snap.bb) : emptyBlackboard()
    this.bb.version = snap.version
    this.bb.round = snap.round
    this.stats = { ...snap.stats, tactics: { ...snap.stats.tactics } }
    this.keysUsed = snap.keysUsed ?? 0
    this.expectations = new Map(snap.expectations ?? [])
    this.lastFocus = snap.lastFocus ?? -1
    this.rolesFor = snap.rolesFor ?? ''
    this.stall = snap.stall?.n ?? 0
    this.stallRound = snap.stall?.round ?? -1
    this.stallHp = snap.stall?.hp.slice() ?? []
    this.caps.clear()
    if (this.perception) this.perception.bb = this.bb
  }
}

export class TeamController implements Controller {
  readonly brain: TeamBrain
  private readonly predict: Controller

  constructor(
    readonly cfg: AIConfig,
    scenario?: ScenarioAIModel,
    readonly options: TeamOptions = {},
  ) {
    this.brain = new TeamBrain(cfg, scenario)
    this.predict = createMonsterBrain(cfg, 'predict')
  }

  /**
   * Décision du tour de `me` SANS l'exécuter (tableau noir et rôles mis à jour, aucune action sur le combat) : plan,
   * contexte de recherche, raison de décision clé, nœuds consommés. null si le combattant ne joue pas (invocation
   * statique, mode `scripted`).
   */
  decide(engine: Engine, fight: FightState, me: Fighter): Decision | null {
    const mode = this.options.mode ?? this.cfg.mode
    if (mode === 'scripted') return null
    const summon = isSummon(me)
    if (summon && !summonPlays(me)) return null
    const brain = this.brain
    const { view, perception } = brain.observe(engine, fight, me)
    const bb = brain.bb
    commanderUpdate({ view, perception, bb, mode, theta: this.cfg.theta, scenario: brain.scenario, caps: brain.caps })
    const explain = this.cfg.explain && fight.options.record
    if (explain) this.notesBeforeTurn(engine, fight, view)
    const role = bb.roles.get(me.id)?.primary ?? this.options.roles?.get(me.id)
    if (!summon && me.role === undefined && role) me.role = role
    const base: TurnBudget = summon ? summonBudget(this.cfg) : mode === this.cfg.mode ? this.cfg.budget : this.budgetFor(mode)
    const budget: TurnBudget = this.options.budget && !summon ? { ...base, ...this.options.budget } : base
    const effMode: AIMode = summon ? 'fast' : mode
    const ctx: TacticalContext = {
      view,
      cfg: this.cfg,
      budget,
      nodes: createNodeBudget(budget.maxNodes),
      perception,
      bb,
      scenario: brain.scenario,
      isKey: false,
      mode: effMode,
      role: summon ? undefined : role,
      hints: brain.scenario.hints?.(view, me, bb) ?? [],
      tactics: summon ? [] : tacticsFor(me, brain.caps.get(me.id), perception),
      disabledTactics: this.options.disabledTactics,
      offensiveOnly: this.options.offensiveOnly,
      noRollouts: this.options.noRollouts || summon,
      rng: decisionRng(this.cfg.seed, me.id, fight.round, 0),
      stats: brain.stats,
      reserved: reservedSpells(bb, me.id, fight),
      reservedCells: bb.reservedCells,
      predict: () => this.predict,
      allyPolicy: summonRolloutPolicy,
      roleOf: id => bb.roles.get(id)?.primary,
      expect: (allyId, key) => brain.expectations.set(allyId, key),
      expectedKey: brain.expectations.get(me.id),
      stall: brain.stall,
    }
    brain.expectations.delete(me.id)
    // Décision clé (§8.8).
    let key: string | undefined
    const keysLeft = brain.keysUsed < budget.maxKeyDecisions
    if (!summon && keysLeft && (effMode === 'standard' || effMode === 'deep')) {
      const r = preKeyReason(ctx)
      if (r) {
        key = r
        ctx.isKey = true
        if (effMode === 'standard') ctx.nodes = createNodeBudget(budget.maxNodes * Math.max(1, budget.keyDecisionBoost))
        else ctx.wantAlternatives = 6
      }
    }
    let plan = searchTurn(ctx)
    let used = ctx.nodes.used
    if (!summon && !key && keysLeft && effMode === 'standard') {
      const r = postKeyReason(plan)
      if (r) {
        key = r
        const ctx2: TacticalContext = { ...ctx, isKey: true, root: undefined, nodes: createNodeBudget(budget.maxNodes * Math.max(1, budget.keyDecisionBoost)) }
        plan = searchTurn(ctx2)
        used += ctx2.nodes.used
      }
    }
    if (key && effMode === 'deep' && budget.mctsIterations > 0) {
      const r = this.deepKeyDecision(ctx, plan, budget)
      plan = r.plan
      used += r.nodes
    }
    if (key) {
      plan.key = key
      brain.keysUsed++
      brain.stats.keyDecisions++
    }
    if (explain) this.notesForPlan(engine, fight, view, plan)
    return { plan, ctx, key, nodes: used, mode: effMode, budget, explain, view }
  }

  playTurn(engine: Engine, fight: FightState, me: Fighter): void {
    if ((this.options.mode ?? this.cfg.mode) === 'scripted') {
      playGreedyTurn(engine, fight, me)
      return
    }
    const d = this.decide(engine, fight, me)
    if (!d) return
    const { plan, ctx, budget, view, explain } = d
    const brain = this.brain
    const bb = brain.bb
    const effMode = d.mode
    let used = d.nodes
    // Exécution (replanification sur écart ; après chaque action en fast).
    const turnNodes = ctx.nodes
    const exec = executePlan(engine, fight, me, plan, {
      mode: effMode,
      hpDev: this.cfg.theta.tactical.replanHpDev,
      maxReplans: effMode === 'fast' ? 12 : budget.maxReplans,
      replan: () => {
        if (!me.alive || fight.ended) return null
        let nodes = turnNodes
        if (effMode === 'fast') {
          if (turnNodes.remaining() < 2) return null
        } else nodes = createNodeBudget(Math.max(1, Math.floor(budget.maxNodes * budget.replanFraction)))
        const before = turnNodes.used
        const c2: TacticalContext = { ...ctx, isKey: false, root: undefined, nodes, expectedKey: undefined, wantAlternatives: undefined }
        const np = searchTurn(c2)
        used += nodes === turnNodes ? turnNodes.used - before : nodes.used
        return np
      },
      onPlan: np => {
        if (explain) emitNote(engine, fight, me.id, planNote(view, np))
      },
    })
    // Case finale réservée pour les alliés suivants du même tour de jeu.
    if (me.alive && me.cell >= 0) bb.reservedCells.set(me.cell, me.id)
    brain.stats.nodes += used
    // Un tour compte au plus une fois comme « créatif » ; tactiques : plans (au moins en partie) exécutés.
    if (exec.plans.some(p => p.creative && p.actions.length)) brain.stats.creativeActions++
    for (const p of exec.plans) for (const t of p.tactics ?? []) brain.stats.tactics[t] = (brain.stats.tactics[t] ?? 0) + 1
    this.options.onTurn?.({ fighterId: me.id, round: fight.round, plan, replans: exec.replans, actions: exec.actions, nodes: used, key: d.key })
  }

  /** Budget d'un mode imposé (options.mode) différent de celui de la configuration. */
  private budgetFor(mode: AIMode): TurnBudget {
    const t = this.cfg.theta.tactical
    const b = this.cfg.budget
    if (mode === 'fast') return { ...b, maxNodes: t.fast.nodes, width: t.fast.width, topK: t.fast.topK, maxDepth: t.fast.depth, endCells: 2, rollouts: t.fast.rollouts, keyDecisionBoost: 1, maxKeyDecisions: 0, mctsIterations: 0 }
    if (mode === 'standard') return { ...b, maxNodes: t.standard.nodes, width: t.standard.width, topK: t.standard.topK, maxDepth: t.standard.depth, endCells: 4, rollouts: t.standard.rollouts, keyDecisionBoost: t.standard.keyBoost, maxKeyDecisions: t.standard.maxKeys, mctsIterations: 0 }
    return { ...b, maxNodes: t.deep.nodes, width: t.deep.width, topK: t.deep.topK, maxDepth: t.deep.depth, endCells: 6, rollouts: t.deep.rollouts, keyDecisionBoost: 1, maxKeyDecisions: t.deep.maxKeys, mctsIterations: t.deep.mcts }
  }

  /** `deep` : MCTS plat sur les meilleurs plans + le plan `fast` (§8.8, simplifié, voir mcts.ts). */
  private deepKeyDecision(ctx: TacticalContext, plan: SearchPlan, budget: TurnBudget): { plan: SearchPlan; nodes: number } {
    const nodes = createNodeBudget(this.cfg.theta.tactical.fast.nodes)
    const fast = searchTurn({ ...ctx, root: undefined, mode: 'fast', budget: this.budgetFor('fast'), nodes, isKey: false, noRollouts: true, wantAlternatives: undefined })
    const candidates = [plan, ...(plan.alternatives ?? []), fast]
    const seen = new Set<string>()
    const uniq = candidates.filter(p => {
      const k = p.actions.map(m => m.key).join('>')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, 7)
    if (uniq.length < 2) return { plan, nodes: nodes.used }
    const r = mctsChoose(ctx, uniq, budget.mctsIterations)
    // Chaque itération du MCTS compte comme un nœud simulé (statistiques).
    return { plan: uniq[r.index], nodes: nodes.used + r.iterations }
  }

  /** Notes de début de tour : focus (s'il change) et intentions du combattant. */
  private notesBeforeTurn(engine: Engine, fight: FightState, view: AIView): void {
    const bb = this.brain.bb
    const f0 = bb.focus[0] ?? -1
    if (f0 !== this.brain.lastFocus) {
      this.brain.lastFocus = f0
      const n = focusNote(fight, view.team, bb.focus)
      if (n) emitNote(engine, fight, view.me.id, n)
    }
    for (const it of bb.intents) if (it.owner === view.me.id && intentActive(it, fight)) emitNote(engine, fight, view.me.id, intentNote(fight, it))
  }

  /** Notes d'un plan : plan, tactiques, coup créatif. */
  private notesForPlan(engine: Engine, fight: FightState, view: AIView, plan: SearchPlan): void {
    emitNote(engine, fight, view.me.id, planNote(view, plan))
    for (const n of tacticNotes(view, plan)) emitNote(engine, fight, view.me.id, n)
    const c = creativeNote(view, plan)
    if (c) emitNote(engine, fight, view.me.id, c)
  }
}

/** Sorts réservés du combattant (intentions `reserve` actives). */
function reservedSpells(bb: Blackboard, meId: number, fight: FightState): ReadonlySet<number> | undefined {
  let out: Set<number> | undefined
  for (const it of bb.intents) {
    if (it.owner !== meId || it.kind !== 'reserve' || it.params?.spellId === undefined || !intentActive(it, fight)) continue
    ;(out ??= new Set()).add(it.params.spellId)
  }
  return out
}

/** Contrôleur partagé par tous les alliés d'une équipe. */
export function createTeamController(cfg: AIConfig, scenario?: ScenarioAIModel, options?: TeamOptions): TeamController {
  return new TeamController(cfg, scenario, options)
}

/**
 * Enregistrement du contrôleur de groupe dans le registre de l'IA (src/ai/index.ts) : la clé `team` (`fighter.ai` =
 * 'team' ou 'team:<mode>') fait jouer le combattant par un `TeamController` du mode indiqué (défaut : `cfg.mode`),
 * un par équipe, avec le `GenericModel` (le registre ne transmet pas de modèle de scénario : les personnages
 * ordinaires, clé 'player', passent par l'aiguillage par défaut de `createControllers`, qui fournit le modèle du
 * scénario). Usage : échelle des modes et miroirs « fast contre standard » (§16.5). `register` est passé par
 * l'appelant pour éviter un cycle d'import.
 */
export function registerTeamControllers(register: (key: string, factory: (engine: Engine, cfg: AIConfig) => Controller) => void): void {
  register('team', (_engine, cfg) => {
    const byKey = new Map<string, TeamController>()
    return {
      playTurn(engine, fight, f) {
        const colon = f.ai.indexOf(':')
        const m = colon > 0 ? f.ai.slice(colon + 1) : ''
        const mode: AIMode = m === 'fast' || m === 'standard' || m === 'deep' || m === 'scripted' ? m : cfg.mode
        const k = `${f.team}:${mode}`
        let c = byKey.get(k)
        if (!c) byKey.set(k, (c = new TeamController(cfg, undefined, { mode })))
        c.playTurn(engine, fight, f)
      },
    }
  })
}
