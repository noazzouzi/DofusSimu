/**
 * MCTS des décisions clés en mode `deep` (docs/design/ai.md §8.8) — WP2.
 *
 * SIMPLIFIÉ (écart assumé) : bandit UCT « plat » sur les plans racines (les 6 meilleurs plans d'un faisceau + le plan
 * `fast`), sans arbre sous la racine ni élargissement progressif. Chaque itération :
 *  1. choisit un plan racine par PUCT (`Q + c·√N/(1 + n)`, c = 0,7 ; pas de logarithme : déterminisme §13.2) ;
 *  2. le joue sur un clone de la racine assainie, dés TIRÉS (`rollMode` 'random', graine d'itération issue du flux
 *     « décisions IA » : la probabilité d'échec d'un kill est mesurée, jamais lue dans les dés réels) ;
 *  3. avance jusqu'au début du prochain tour du combattant : ennemis en `play` (même cerveau qu'en combat réel),
 *     alliés en politique gloutonne (simplification : le design prévoit `fast`) ;
 *  4. note V(s) (feuille terminale, hors tour), normalisée par le min/max observé.
 * Le plan retenu est le plus visité (départage : meilleure moyenne, puis rang d'entrée).
 */
import { mix32 } from '../../core/hash'
import type { Controller } from '../../engine/runner'
import type { Fighter } from '../../engine/types'
import { greedyController } from '../fallback'
import { advanceUntil, simClone } from '../core'
import { createMonsterBrain } from '../monster/brain'
import { evalLeaf } from './evaluate'
import type { SearchPlan, TacticalContext } from './node'
import { playPlanOn } from './rollout'

export interface MctsResult {
  index: number
  visits: number[]
  means: number[]
  iterations: number
}

const C_PUCT = 0.7

/** Choisit un plan parmi `plans` (index) par MCTS plat (voir l'en-tête). `iterations` ≥ 1. */
export function mctsChoose(ctx: TacticalContext, plans: readonly SearchPlan[], iterations: number): MctsResult {
  const n = plans.length
  const visits = new Array<number>(n).fill(0)
  const sums = new Array<number>(n).fill(0)
  if (n <= 1 || iterations <= 0) return { index: 0, visits, means: sums, iterations: 0 }
  const engine = ctx.view.engine
  const team = ctx.view.team
  const meId = ctx.view.me.id
  const play = createMonsterBrain(ctx.cfg, 'play')
  const ally = greedyController({ maxActions: 6 })
  const provider = (f: Fighter): Controller => (f.team === team ? ally : play)
  const root = ctx.root ?? ctx.view.fight
  let lo = Infinity
  let hi = -Infinity
  let total = 0
  for (let it = 0; it < iterations; it++) {
    // Sélection PUCT (chaque plan est d'abord visité une fois).
    let pick = -1
    let best = -Infinity
    for (let i = 0; i < n; i++) {
      if (visits[i] === 0) {
        pick = i
        break
      }
      const q = hi > lo ? (sums[i] / visits[i] - lo) / (hi - lo) : 0.5
      const u = q + (C_PUCT * Math.sqrt(total)) / (1 + visits[i])
      if (u > best) {
        best = u
        pick = i
      }
    }
    const s = simClone(ctx.view, root, mix32(ctx.view.seed ^ 0x3c75, it), 'random')
    playPlanOn(engine, s, meId, plans[pick].actions)
    if (!s.ended) advanceUntil(engine, s, provider, f => f.id === meId, 48)
    const r = evalLeaf(ctx, s, { terminal: true, inTurn: false }).v
    // Normalisation : moyennes recalculées sur l'échelle min/max courante.
    if (r < lo) lo = r
    if (r > hi) hi = r
    visits[pick]++
    sums[pick] += r
    total++
  }
  const means = sums.map((x, i) => (visits[i] ? x / visits[i] : -Infinity))
  let index = 0
  for (let i = 1; i < n; i++) {
    if (visits[i] > visits[index] || (visits[i] === visits[index] && means[i] > means[index])) index = i
  }
  return { index, visits, means, iterations: total }
}
