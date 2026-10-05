/**
 * Invocations alliées (docs/design/ai.md §9.7) — WP2.
 *
 * Les invocations de l'équipe sont jouées par le `TeamBrain` (Maîtrise des invocations) en politique `fast`, avec le
 * tableau noir de l'équipe et ω = θ.value.summonLife (0,4) dans V. Plafond de candidats par entité (Osamodas, Sadida,
 * Roublard) : θ.tactical.fast.nodes nœuds, au plus 12, ni rollout ni tactique. Une invocation qui joue juste après
 * son invocateur est simulée dans le rollout de celui-ci (politique d'allié des rollouts : `summonRolloutPolicy`).
 * Les invocations statiques (balises, `tags.static` / `canPlay` faux) ne jouent pas.
 */
import { isStaticFighter } from '../../engine/targetMask'
import type { Controller } from '../../engine/runner'
import type { Fighter } from '../../engine/types'
import { greedyController } from '../fallback'
import { fastBudget } from '../tactical/rollout'
import type { AIConfig, TurnBudget } from '../types'

/** Plafond de nœuds d'une invocation par tour (§9.7). */
export const SUMMON_MAX_NODES = 12

/** Le combattant est-il une invocation (alliée ou non) ? */
export function isSummon(f: Fighter): boolean {
  return f.kind === 'summon' || f.summonerId !== undefined
}

/** L'invocation joue-t-elle (non statique) ? */
export function summonPlays(f: Fighter): boolean {
  return !isStaticFighter(f) && f.tags.cannotPlay !== true
}

/** Budget `fast` plafonné d'une invocation. */
export function summonBudget(cfg: AIConfig): TurnBudget {
  const b = fastBudget(cfg, Math.min(SUMMON_MAX_NODES, cfg.theta.tactical.fast.nodes))
  return { ...b, maxDepth: Math.min(b.maxDepth, 4), endCells: 2 }
}

const GREEDY = greedyController({ maxActions: 4 })

/** Politique des invocations alliées dans les rollouts (prévision bon marché : glouton déterministe). */
export function summonRolloutPolicy(_f: Fighter): Controller {
  return GREEDY
}
