/**
 * Rollouts d'équipe (docs/design/ai.md §8.6) — WP2.
 *
 * En Dofus les tours alternent (P1 M1 P2 M2…) : un bon tour se juge APRÈS la réponse des ennemis et le tour de
 * l'allié suivant.
 *
 * ```
 * teamRollout(feuille) :
 *   s = clone(feuille après déplacement final)
 *   advanceUntil(s, ennemis → MonsterBrain 'predict', nos invocations → politique d'allié,
 *                arrêt au début du tour du prochain PERSONNAGE allié)       // effets de début/fin de tour appliqués
 *   vPred = V(s) ; vAlt = vPred − perte si l'ennemi le plus menaçant frappait sa 2e cible (analytique, voir plus bas)
 *   vMon  = (1 − β)·vPred + β·min(vPred, vAlt)                              // pessimisme, β = θ.tactical.beta
 *   renvoie 0,5·vMon + 0,5·V(s après un tour `fast` de cet allié, tableau noir figé)
 * ```
 *
 * Écart assumé (simplification) : le « 2e choix du monstre le plus menaçant » n'est pas rejoué (le `MonsterBrain`
 * n'expose pas son classement) ; il est estimé analytiquement sur la feuille avec le modèle de menace : perte si
 * l'ennemi de plus forte menace frappait sa 2e cible (π) au lieu de la prédite (dégâts plafonnés aux PV effectifs +
 * coût de mort si le coup tue), ce qui pénalise les plans qui ne tiennent que si le monstre choisit « bien ».
 */
import type { Engine } from '../../engine/engine'
import { greedyController } from '../fallback'
import type { Controller } from '../../engine/runner'
import type { Fighter, FightState } from '../../engine/types'
import { advanceUntil, applyMacro, createView, hpEff, simClone, simSalt, type PerceptionX } from '../core'
import { createMonsterBrain } from '../monster/brain'
import type { AIConfig, MacroAction, NodeBudget, TurnBudget } from '../types'
import { evalLeaf } from './evaluate'
import type { FinalLeaf, TacticalContext } from './node'
import { searchTurn } from './turnSearch'

/** Sous-budget de `n` nœuds au plus, imputés aussi au budget parent. */
export function subBudget(parent: NodeBudget, n: number): NodeBudget {
  const cap = Math.max(0, Math.min(n, parent.remaining()))
  const st = { used: 0 }
  return {
    max: cap,
    get used() {
      return st.used
    },
    spend(k = 1) {
      st.used += k
      parent.spend(k)
    },
    exhausted: () => st.used >= cap || parent.exhausted(),
    remaining: () => Math.max(0, Math.min(cap - st.used, parent.remaining())),
  }
}

/** Budget `fast` (θ.tactical.fast) : recherches imbriquées et invocations. */
export function fastBudget(cfg: AIConfig, nodes?: number): TurnBudget {
  const f = cfg.theta.tactical.fast
  return {
    ...cfg.budget,
    maxNodes: nodes ?? f.nodes,
    width: f.width,
    topK: f.topK,
    maxDepth: f.depth,
    endCells: 2,
    rollouts: 0,
    keyDecisionBoost: 1,
    maxKeyDecisions: 0,
    mctsIterations: 0,
  }
}

const PREDICTORS = new WeakMap<AIConfig, Controller>()
const GREEDY = greedyController({ maxActions: 6 })

/** Cerveau de prédiction des ennemis (MonsterBrain 'predict', un par configuration). */
export function predictorFor(cfg: AIConfig): Controller {
  let c = PREDICTORS.get(cfg)
  if (!c) PREDICTORS.set(cfg, (c = createMonsterBrain(cfg, 'predict')))
  return c
}

/**
 * Perte (PVe) si l'ennemi le plus menaçant frappait sa 2e cible au lieu de la cible prédite : dégâts plafonnés aux PV
 * effectifs, plus un coût de mort (PV max de base + 2 × potentiel ; 0,4 × PV max pour une invocation) si le coup tue.
 */
export function alternativeLoss(ctx: TacticalContext, s: FightState): number {
  const p = ctx.perception as PerceptionX
  p.sync(s)
  const threat = p.threat
  let row: (typeof threat.enemies)[number] | undefined
  for (const r of threat.enemies) if (r.active && (!row || r.threat > row.threat)) row = r
  if (!row) return 0
  const allies = threat.allies
  const n = Math.min(allies.length, row.pi.length)
  if (n < 2) return 0
  let t1 = -1
  for (let i = 0; i < n; i++) if (t1 < 0 || row.pi[i] > row.pi[t1]) t1 = i
  let t2 = -1
  for (let i = 0; i < n; i++) if (i !== t1 && (t2 < 0 || row.score[i] > row.score[t2])) t2 = i
  if (t1 < 0 || t2 < 0) return 0
  const loss = (i: number): number => {
    const a = allies[i]
    const he = hpEff(a)
    const dmg = row!.dmg[i]
    const summon = a.kind === 'summon' || a.summonerId !== undefined
    const death = summon ? 0.4 * a.baseMaxHp : a.baseMaxHp + 2 * p.potential.potential(a.id)
    return Math.min(dmg, he) * (summon ? 0.4 : 1) + (dmg >= he ? death : 0)
  }
  return Math.max(0, loss(t2) - loss(t1))
}

/** Joue un plan (macro-actions) d'un combattant sur un clone ; s'arrête au premier échec. */
export function playPlanOn(engine: Engine, s: FightState, fighterId: number, actions: readonly MacroAction[]): void {
  for (const m of actions) {
    if (s.ended) return
    if (!applyMacro(engine, s, fighterId, m)) return
  }
}

/** Rollout d'équipe d'une feuille terminale (§8.6) ; undefined si le budget est épuisé. */
export function teamRollout(ctx: TacticalContext, f: FinalLeaf): number | undefined {
  if (ctx.nodes.exhausted()) return undefined
  const engine = ctx.view.engine
  const team = ctx.view.team
  const meId = ctx.view.me.id
  const altLoss = alternativeLoss(ctx, f.s)
  const s = simClone(ctx.view, f.s, simSalt(f.node.hash, 0x51))
  ctx.nodes.spend(1)
  const predict = ctx.predict ?? ((): Controller => predictorFor(ctx.cfg))
  const ally = ctx.allyPolicy ?? ((): Controller => GREEDY)
  const provider = (x: Fighter): Controller => (x.team === team ? ally(x) : predict(x))
  const next = advanceUntil(engine, s, provider, x => x.team === team && x.kind === 'player', 48)
  const vPred = evalLeaf(ctx, s, { terminal: true, inTurn: false }).v
  const beta = ctx.budget.pessimism
  const vMon = (1 - beta) * vPred + beta * Math.min(vPred, vPred - altLoss)
  if (!next || s.ended || next.id === meId || !next.alive || ctx.nodes.exhausted()) return vMon
  // Tour `fast` de l'allié suivant, tableau noir figé.
  const nodes = subBudget(ctx.nodes, Math.min(ctx.cfg.theta.tactical.fast.nodes, 12))
  const view = createView(engine, s, next, ctx.view.seed)
  const plan = searchTurn({
    view,
    cfg: ctx.cfg,
    // Largeur 1 : le tour imbriqué de l'allié garde le faisceau glouton d'origine (θ `fast` est passé en largeur 3 au
    // réglage du tour 3 ; ces rollouts ne servent qu'en `standard`/`deep`, non re-mesurés).
    budget: { ...fastBudget(ctx.cfg, nodes.max), maxDepth: 3, width: 1 },
    nodes,
    perception: ctx.perception,
    bb: ctx.bb,
    scenario: ctx.scenario,
    isKey: false,
    mode: 'fast',
    role: ctx.roleOf?.(next.id),
    nested: true,
    noRollouts: true,
    tactics: [],
    rng: ctx.rng,
    reservedCells: ctx.reservedCells,
  })
  // Cohérence (§9.3) : mémorisée sur la feuille, publiée par `searchTurn` seulement pour le plan retenu.
  if (plan.actions[0]) f.expect = { allyId: next.id, key: plan.actions[0].key }
  playPlanOn(engine, s, next.id, plan.actions)
  const vAlly = evalLeaf(ctx, s, { terminal: true, inTurn: false }).v
  return 0.5 * vMon + 0.5 * vAlly
}
