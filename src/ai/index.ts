/**
 * Point d'entrée de l'IA (docs/design/ai.md §4) — WP1 : `createControllers(engine, cfg)` renvoie le fournisseur de
 * contrôleurs d'un combat (`runFight(engine, fight, createControllers(engine, cfg))`), plus les aides de configuration.
 *
 * Registre (`fighter.ai`) : 'pass' → passe son tour ; personnages et leurs invocations → `TeamController` de leur
 * équipe (WP2) ; monstres, boss et leurs invocations → `MonsterBrain` réglage `play` (WP1), dans tous les modes.
 * Mode `scripted` : politique de rotations des presets (WP4, src/ai/policies/scripted.ts).
 *
 * S0 : `TeamController`, `MonsterBrain` et la politique `scripted` sont des BOUCHONS qui jouent le contrôleur glouton
 * de repli (src/ai/fallback.ts). TODO(WP1/WP2/WP4) : brancher les implémentations réelles (S1/S2).
 */
import type { TeamId } from '../core/types'
import type { ScenarioAIModel } from '../dungeons/types'
import type { Engine } from '../engine/engine'
import { passController, type Controller } from '../engine/runner'
import type { Fighter } from '../engine/types'
import { fightAISeed } from './core'
import { createMonsterBrain } from './monster/brain'
import { createScriptedPolicy } from './policies/scripted'
import { createTeamController, type TeamBrainSnapshot, type TeamController } from './team/controller'
import { createGenericModel } from './team/genericModel'
import { loadTheta, type ThetaJson } from './theta'
import type { AIConfig, AIControllerProvider, AIMode, AIRunStats, CandidateCat, TurnBudget } from './types'

export * from './types'
export { defaultTheta, flattenTheta, loadTheta, thetaHash, thetaWithPaths, type ThetaJson, type ThetaOverrides } from './theta'

/**
 * Quotas de simulation par catégorie (§8.1, standard K = 12). Le design fait partager un quota de 1 à heal/buff et à
 * summon/mark ; TODO(WP2) : appliquer le partage et moduler par rôle/mode (fast K = 6).
 */
export const DEFAULT_QUOTAS: Readonly<Record<CandidateCat, number>> = {
  damage: 5, control: 2, placement: 2, heal: 1, buff: 1, summon: 1, mark: 1, utility: 1,
}

/**
 * Budget d'un tour de joueur pour un mode, tiré de θ.tactical (§8.3). `endCells` n'est pas chiffré par le design :
 * valeurs provisoires (TODO(WP2)).
 */
export function budgetFor(mode: AIMode, theta: ThetaJson): TurnBudget {
  const t = theta.tactical
  const common = {
    pessimism: t.beta,
    maxReplans: t.maxReplans,
    replanFraction: 0.5, // §8.7
    quotas: { ...DEFAULT_QUOTAS },
    mandatoryMax: 4, // §8.1
  }
  switch (mode) {
    case 'scripted':
      return { ...common, maxNodes: 0, width: 0, topK: 0, maxDepth: 0, endCells: 0, rollouts: 0, keyDecisionBoost: 1, maxKeyDecisions: 0, mctsIterations: 0, maxReplans: 0, mandatoryMax: 0 }
    case 'fast':
      return { ...common, maxNodes: t.fast.nodes, width: t.fast.width, topK: t.fast.topK, maxDepth: t.fast.depth, endCells: 2, rollouts: t.fast.rollouts, keyDecisionBoost: 1, maxKeyDecisions: 0, mctsIterations: 0 }
    case 'standard':
      return { ...common, maxNodes: t.standard.nodes, width: t.standard.width, topK: t.standard.topK, maxDepth: t.standard.depth, endCells: 4, rollouts: t.standard.rollouts, keyDecisionBoost: t.standard.keyBoost, maxKeyDecisions: t.standard.maxKeys, mctsIterations: 0 }
    case 'deep':
      return { ...common, maxNodes: t.deep.nodes, width: t.deep.width, topK: t.deep.topK, maxDepth: t.deep.depth, endCells: 6, rollouts: t.deep.rollouts, keyDecisionBoost: 1, maxKeyDecisions: t.deep.maxKeys, mctsIterations: t.deep.mcts }
  }
}

/** Configuration complète de l'IA pour un mode et une graine de combat (θ par défaut si absent). */
export function defaultAIConfig(mode: AIMode, fightSeed: number, theta: ThetaJson = loadTheta()): AIConfig {
  const m = theta.monster
  return {
    mode,
    budget: budgetFor(mode, theta),
    theta,
    monster: { topK: m.topK, predictTopK: m.predictTopK, noiseTau: m.noiseTau, referenceTopK: m.referenceTopK },
    seed: fightAISeed(fightSeed),
    explain: false,
    unsupportedSpells: 'skip',
  }
}

export interface ControllersOptions {
  /** Modèle stratégique du scénario (WP3) ; défaut : `GenericModel` (WP2). */
  scenario?: ScenarioAIModel
}

/**
 * Fournisseur de contrôleurs d'un combat (voir l'en-tête). Un `TeamController` par équipe de personnages (partagé par
 * ses alliés, tableau noir commun) ; un `MonsterBrain` 'play' pour tous les monstres.
 */
export function createControllers(engine: Engine, cfg: AIConfig, options: ControllersOptions = {}): AIControllerProvider {
  const scenario = options.scenario ?? createGenericModel(cfg.theta)
  const teams = new Map<TeamId, TeamController>()
  const teamOf = (team: TeamId): TeamController => {
    let c = teams.get(team)
    if (!c) teams.set(team, (c = createTeamController(cfg, scenario)))
    return c
  }
  const monsters = createMonsterBrain(cfg, 'play')
  // Politique `scripted` (WP4, src/ai/policies/scripted.ts ; BOUCHON S0).
  const scripted = cfg.mode === 'scripted' ? createScriptedPolicy(cfg) : undefined
  // Équipes de personnages : une invocation joue toujours après son invocateur, son équipe est donc déjà connue.
  const playerTeams = new Set<TeamId>()
  void engine
  const pick = (f: Fighter): Controller => {
    if (f.ai === 'pass') return passController
    if (f.kind === 'player') playerTeams.add(f.team)
    else if (!playerTeams.has(f.team)) return monsters
    return scripted ?? teamOf(f.team)
  }
  const stats = (): AIRunStats => {
    const out: AIRunStats = { nodes: 0, creativeActions: 0, tactics: {}, keyDecisions: 0 }
    for (const tc of teams.values()) {
      const s = tc.brain.stats
      out.nodes += s.nodes
      out.creativeActions += s.creativeActions
      out.keyDecisions += s.keyDecisions
      for (const [k, v] of Object.entries(s.tactics)) out.tactics[k as keyof AIRunStats['tactics']] = (out.tactics[k as keyof AIRunStats['tactics']] ?? 0) + (v ?? 0)
    }
    return out
  }
  return Object.assign(pick, {
    stats,
    snapshot: (): unknown => [...teams.entries()].map(([team, tc]) => [team, tc.brain.snapshot()] as const),
    restore: (snap: unknown): void => {
      for (const [team, s] of snap as [TeamId, TeamBrainSnapshot][]) teamOf(team).brain.restore(s)
    },
  })
}
