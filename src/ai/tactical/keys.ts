/**
 * Décisions clés (docs/design/ai.md §8.8) — WP2.
 *
 * Déclencheurs :
 *  - scénario (`ScenarioAIModel.isKeyDecision`) : contrat de corruption dans le créneau courant (`corruptionKill`),
 *    premier tour vulnérable du Vortex (`burst`), arrivée de vague, *Action !* (`waveArrival`, `phaseChange`) ;
 *  - `allyDeathRisk` : un allié a un risque de mort ≥ 0,3 avant son prochain tour (racine, ou sous le meilleur plan) ;
 *  - `burst` (générique) : le potentiel des alliés qui jouent avant le prochain tour de l'ennemi le plus menaçant
 *    couvre ses PV effectifs (fenêtre de kill d'équipe) ;
 *  - `closeCall` : deux meilleurs plans à moins de 150 PVe avec des premières actions différentes (après recherche).
 * En `standard` : budget ×2 (largeur 10, 6 rollouts), ≤ θ.tactical.standard.maxKeys par combat ; en `deep` : MCTS.
 */
import type { KeyDecisionReason } from '../../dungeons/types'
import { isStaticFighter } from '../../engine/targetMask'
import { hpEff, type PerceptionX } from '../core'
import type { SearchPlan, TacticalContext } from './node'

/** Seuil de risque de mort d'un allié qui rend la décision clé. */
export const KEY_DEATH_RISK = 0.3

/** Raison de décision clé connue AVANT la recherche (scénario, risque de mort à la racine, fenêtre de kill). */
export function preKeyReason(ctx: TacticalContext): KeyDecisionReason | null {
  const fromScenario = ctx.scenario?.isKeyDecision?.(ctx.view, ctx.bb) ?? null
  if (fromScenario) return fromScenario
  const p = ctx.perception as PerceptionX
  const s = ctx.view.fight
  p.sync(s)
  for (const f of s.fighters) {
    if (f.alive && f.team === ctx.view.team && p.threat.deathRisk(f.id) >= KEY_DEATH_RISK) return 'allyDeathRisk'
  }
  // Fenêtre de kill d'équipe sur l'ennemi le plus menaçant.
  let top: (typeof p.threat.enemies)[number] | undefined
  for (const r of p.threat.enemies) if (r.active && (!top || r.threat > top.threat)) top = r
  if (top && !isStaticFighter(top.e)) {
    const order = p.threat.order
    let pot = 0
    for (const a of s.fighters) {
      if (!a.alive || a.team !== ctx.view.team || a.cell < 0) continue
      if (a.id !== ctx.view.me.id && !order.before(a.id, top.e.id)) continue
      if (p.potential.bestTarget(a.id) === top.e.id) pot += p.potential.potential(a.id)
    }
    if (pot > 0 && pot >= hpEff(top.e)) return 'burst'
  }
  return null
}

/** Raison de décision clé révélée par la recherche (plans serrés, risque de mort sous le plan retenu). */
export function postKeyReason(plan: SearchPlan): KeyDecisionReason | null {
  if ((plan.maxDeathRisk ?? 0) >= KEY_DEATH_RISK) return 'allyDeathRisk'
  if (plan.closeCall) return 'closeCall'
  return null
}
