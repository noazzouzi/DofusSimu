/**
 * Socle de perception de l'IA (docs/design/ai.md §6, §7, §13) — WP1. Point d'entrée UNIQUE du socle pour WP2/WP3/WP4 :
 * réexportations des modules de §4 (signatures du contrat S0 conservées, paramètres optionnels ajoutés).
 *
 *  rng.ts          graines (`fightAISeed`, `aiSeed`, `simSalt`), Φ / exp / softmax déterministes
 *  view.ts         vue honnête (`createView`, `sanitizeForTeam`, mémoire de visibilité)
 *  timeline.ts     ordre public des tours (`forecastSlots`, `SlotOrder`, `canPlay`)
 *  sim.ts          clones (`simClone`), macro-actions (`applyMacro`), avance du temps (`advanceUntil`)
 *  budget.ts       budget en nœuds (`createNodeBudget`)
 *  hash.ts         transpositions (`stateHash`), empreintes (`fighterDigest`, `revKey`)
 *  reach.ts        accessibilité avec tacle exact (`computeReach`, `cachedReach`, `reachPath`)
 *  castCells.ts    portée inverse, LdV mémoïsée, cases de lancer
 *  spellProfile.ts profils analytiques des sorts
 *  dpt.ts          DPT calibré (`createDptTable`), dégâts d'un lancer
 *  threat.ts       menace ordonnée par la timeline (`buildThreat`)
 *  potential.ts    potentiel offensif (`buildPotential`)
 *  kill.ts         `killProbability`, `canKillNow`, `lethalSplit`
 *  value.ts        V(s) → `EvalBreakdown` (`valueOf`)
 *  candidates.ts   candidats génériques C1-C8 (`generateCasts`) et préfiltre `quickEstimate`
 *  perception.ts   `createPerception` (DPT + profils + potentiel + menace synchronisés)
 */
import type { Engine } from '../../engine/engine'
import type { Fighter, FightState } from '../../engine/types'
import { toActions } from '../types'
import { computeReachFor, reachPath } from './reach'

export { toActions }
export { aiSeed, clamp, cloneRngState, decisionRng, detExp, fightAISeed, mix32, phi, simSalt, softmaxInto } from './rng'
export { believedCell, createView, isInvisible, LAST_SEEN_TAG, observeVisibility, sanitizeForTeam, STATE_INVISIBLE, trapKnownBy, viewOn } from './view'
export { canPlay, forecastSlots, SlotOrder } from './timeline'
export { advanceUntil, applyMacro, endCurrentTurn, simClone } from './sim'
export { CountingBudget, createNodeBudget } from './budget'
export { fighterDigest, fnvInt, revKey, stateHash } from './hash'
export {
  apSpent, buildOccupancy, cachedReach, canTackleNow, cloneReach, computeReach, computeReachFor, createReachInfo,
  escapeRatioAt, mpSpent, reachPath, type ReachOptions,
} from './reach'
export {
  castCellsFor, castFailureStatic, castGeom, castGeometryOk, firstCastCell, inverseRange, levelFor, LosOracle,
  nextTurnStaticOk, occupantAfterMove, type CastGeom,
} from './castCells'
export {
  createSpellProfileIndex, maskSides, zoneRadius, type DamageLineX, type HealLineX, type MaskSides, type MoveLineX,
  type ReceivedLineX, type RemovalLineX, type ShieldLineX, type SpellProfileIndexX, type SpellProfileX, type StatLineX,
  type StateLineX,
} from './spellProfile'
export {
  calibrationOf, castDamage, castsAvailable, createDptTable, DptTableImpl, isMeleeSpell, lineDamage, receivedMods,
  spellCritPct, zoneHitsCenter, type CalibrationTable, type CastDamage, type TurnDamage, type TurnMode,
} from './dpt'
export {
  buffActiveAtNextTurn, buildThreat, flagAtNextTurn, hpEff, nextTurnApMp, pacifistStates, ThreatModelImpl, type EnemyThreat,
} from './threat'
export { buildPotential, damageWeightOf, PotentialModelImpl, type ValueWeights } from './potential'
export { canKillNow, killProbability, lethalSplit, lifeToKill } from './kill'
export { bestDpt, enemyThreatIn, pendingDotOn, restOfTurn, valueOf, type ValueOptions } from './value'
export { generateCasts, quickEstimate, type GenerateOptions } from './candidates'
export { createPerception, type PerceptionX } from './perception'

/** Chemin vers une case atteignable (accessibilité avec tacle, positions vues par l'équipe de `f`), ou null. */
export function simplePath(engine: Engine, s: FightState, f: Fighter, to: number): number[] | null {
  return reachPath(computeReachFor(engine, s, f, f.team), f.cell, to)
}
