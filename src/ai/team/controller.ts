/**
 * Contrôleur de l'équipe des joueurs (docs/design/ai.md §9.1) — WP2.
 *
 * `TeamController` joue le tour de chaque allié (personnages et invocations, §9.7) : `TeamBrain.observe` →
 * `Commander.update` (ScenarioAIModel, prix, intentions) → `TurnSearch` → `Executor` → annotations `aiNote`.
 * `TeamBrain` vit hors de `FightState`, est une fonction déterministe de l'historique et expose `snapshot/restore`
 * (données pures) pour le rembobinage (§15.8).
 *
 * BOUCHON S0 — TODO(WP2) : le tour est joué par le contrôleur glouton de repli (src/ai/fallback.ts) ; le tableau
 * noir n'est que tenu à jour (round, version). Signatures = contrat utilisé par `createControllers` (WP1) et WP4.
 */
import type { ScenarioAIModel } from '../../dungeons/types'
import type { Engine } from '../../engine/engine'
import type { Controller } from '../../engine/runner'
import type { Fighter, FightState } from '../../engine/types'
import { playGreedyTurn } from '../fallback'
import type { AIConfig, AIRunStats, Blackboard, PriceTable } from '../types'

export function emptyPriceTable(): PriceTable {
  return { kill: new Map(), hp: new Map(), clock: [0, 0, 0] }
}

export function emptyBlackboard(): Blackboard {
  return {
    version: 0,
    round: 0,
    phase: 'fight',
    emergency: false,
    roles: new Map(),
    focus: [],
    reservations: new Map(),
    prices: emptyPriceTable(),
    intents: [],
    reservedCells: new Map(),
  }
}

/** Instantané pur du `TeamBrain` (rembobinage). BOUCHON S0 : version et tour seulement. */
export interface TeamBrainSnapshot {
  version: number
  round: number
  stats: AIRunStats
}

/** Mémoire stratégique de l'équipe (rôles, tableau noir, plan engagé, calibration de l'oracle). */
export class TeamBrain {
  bb: Blackboard = emptyBlackboard()
  stats: AIRunStats = { nodes: 0, creativeActions: 0, tactics: {}, keyDecisions: 0 }

  constructor(
    readonly cfg: AIConfig,
    readonly scenario?: ScenarioAIModel,
  ) {}

  /** Début du tour d'un allié : perception, rôles, calibration (TODO(WP2)). */
  observe(_engine: Engine, fight: FightState, _me: Fighter): void {
    this.bb.round = fight.round
    this.bb.version++
  }

  snapshot(): TeamBrainSnapshot {
    return { version: this.bb.version, round: this.bb.round, stats: { ...this.stats, tactics: { ...this.stats.tactics } } }
  }

  restore(snap: TeamBrainSnapshot): void {
    this.bb = emptyBlackboard()
    this.bb.version = snap.version
    this.bb.round = snap.round
    this.stats = { ...snap.stats, tactics: { ...snap.stats.tactics } }
  }
}

export class TeamController implements Controller {
  readonly brain: TeamBrain

  constructor(cfg: AIConfig, scenario?: ScenarioAIModel) {
    this.brain = new TeamBrain(cfg, scenario)
  }

  playTurn(engine: Engine, fight: FightState, me: Fighter): void {
    this.brain.observe(engine, fight, me)
    // TODO(WP2) : Commander.update → searchTurn (tactical/turnSearch.ts) → Executor → aiNote.
    playGreedyTurn(engine, fight, me)
  }
}

/** Contrôleur partagé par tous les alliés d'une équipe. */
export function createTeamController(cfg: AIConfig, scenario?: ScenarioAIModel): TeamController {
  return new TeamController(cfg, scenario)
}
