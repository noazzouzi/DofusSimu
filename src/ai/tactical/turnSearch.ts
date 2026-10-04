/**
 * Recherche tactique d'un tour de joueur (docs/design/ai.md §8.2) — WP2.
 *
 * BOUCHON S0 — TODO(WP2) : `searchTurn` renvoie un plan vide (« ne rien lancer »). À remplacer par le faisceau
 * paramétré (fast = largeur 1 replanifiée, standard = 6 + rollouts, deep = 12 + MCTS), génération C1-C12 + quotas,
 * transpositions, emplacement de diversité, split léthal, `finalize`, rollouts d'équipe.
 * `TacticalContext` appartient à WP2 (non gelé) : WP2 peut l'enrichir librement.
 */
import type { ScenarioAIModel } from '../../dungeons/types'
import type { AIConfig, AIView, Blackboard, NodeBudget, Perception, TurnBudget, TurnPlan } from '../types'

/** Contexte d'une recherche de tour (propriété de WP2). */
export interface TacticalContext {
  view: AIView
  cfg: AIConfig
  budget: TurnBudget
  nodes: NodeBudget
  perception: Perception
  bb: Blackboard
  scenario?: ScenarioAIModel
  /** Décision clé (§8.8) : budget ×2 en standard, MCTS en deep. */
  isKey: boolean
}

/** Meilleur plan du tour pour `ctx.view.me` (BOUCHON S0 : plan vide). */
export function searchTurn(ctx: TacticalContext): TurnPlan {
  return { actions: [], value: 0, nodes: ctx.nodes.used }
}
