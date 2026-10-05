/**
 * Tactiques proposeuses (docs/design/ai.md §10) — WP2.
 *
 * Une tactique PROPOSE des séquences que la génération générique ne produirait pas (cases libres bien choisies,
 * séquences qui ne paient qu'au 2e ou 3e pas) ; elle ne note jamais : la simulation décide, l'ablation juge (§16.4,
 * §16.5 : chaque tactique est testée par un puzzle où la désactiver fait perdre de la valeur).
 *
 * ```ts
 * interface Tactic { id; requires(me, profils, capacités); relevance(ctx, nœud); propose(ctx, nœud, limite) }
 * quota de la tactique = round(θ.tactics.prior[id] · relevance), plafond global θ.tactics.maxPerNode par nœud
 * ```
 * v1 (8) : stateChain, mpLock, carryThrow, glyphClock, healCleanse, bodyBlock, groupForZone, burstSetup.
 * v2 (apLock, tackleTrap, pushCollision, losShield, lineDodge, corruptedWall, baitSummon, dispelAlly) : non implémentées.
 */
import type { Fighter } from '../../engine/types'
import type { PerceptionX } from '../core'
import type { SearchNode, Tactic, TacticalContext } from '../tactical/node'
import type { CapabilityProfile, MacroAction, TacticId } from '../types'
import { bodyBlock } from './bodyBlock'
import { burstSetup } from './burstSetup'
import { carryThrow } from './carryThrow'
import { glyphClock } from './glyphClock'
import { groupForZone } from './groupForZone'
import { healCleanse } from './healCleanse'
import { mpLock } from './mpLock'
import { stateChain } from './stateChain'

export type { Tactic } from '../tactical/node'
export { bodyBlock, burstSetup, carryThrow, glyphClock, groupForZone, healCleanse, mpLock, stateChain }

/** Tactiques v1 (ordre stable : départage des propositions). */
export const TACTICS: readonly Tactic[] = [stateChain, mpLock, carryThrow, glyphClock, healCleanse, bodyBlock, groupForZone, burstSetup]

/** Tactique par identifiant. */
export function tacticById(id: TacticId): Tactic | undefined {
  return TACTICS.find(t => t.id === id)
}

/**
 * Tactiques à la portée d'un combattant (`requires` sur ses profils de sorts et capacités) ; sans profils, toutes.
 * `profiles` : profils des sorts de `me` (perception de l'équipe).
 */
export function tacticsFor(me: Fighter, caps: CapabilityProfile | undefined, perception?: PerceptionX): Tactic[] {
  if (!perception) return TACTICS.slice()
  const profiles = perception.profiles.ofFighter(me)
  return TACTICS.filter(t => t.requires(me, profiles, caps))
}

/** Propositions des tactiques pour un nœud (quotas θ.tactics.prior · relevance, plafond maxPerNode). */
export function proposeTactics(ctx: TacticalContext, node: SearchNode): MacroAction[] {
  const list = ctx.tactics ?? TACTICS
  if (!list.length || ctx.offensiveOnly) return []
  const th = ctx.cfg.theta.tactics
  const cap = th.maxPerNode
  const byTactic: MacroAction[][] = []
  for (const t of list) {
    if (ctx.disabledTactics?.has(t.id)) continue
    const prior = (th.prior as Record<string, number>)[t.id] ?? 1
    const quota = Math.round(prior * t.relevance(ctx, node))
    if (quota <= 0) continue
    const props = t.propose(ctx, node, Math.min(quota, cap)).map(m => (m.tactic ? m : { ...m, tactic: t.id }))
    if (props.length) byTactic.push(props)
  }
  // Équité : la meilleure proposition de chaque tactique d'abord (par prior), puis complément par prior.
  const out: MacroAction[] = []
  const keys = new Set<string>()
  const add = (m: MacroAction): void => {
    if (out.length >= cap || keys.has(m.key)) return
    keys.add(m.key)
    out.push(m)
  }
  const heads = byTactic.map(l => l[0]).sort(byPrior)
  for (const m of heads) add(m)
  const rest = byTactic.flatMap(l => l.slice(1)).sort(byPrior)
  for (const m of rest) add(m)
  return out
}

const byPrior = (a: MacroAction, b: MacroAction): number => b.prior - a.prior || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
