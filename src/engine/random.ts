/**
 * Aléatoire du combat : état sur un seul entier 32 bits (mulberry32) stocké dans FightState.rngState,
 * pour que le clonage d'un combat (simulations de l'IA) copie aussi l'état du générateur.
 */
import type { FightState, RollMode } from './types'

export function nextRandom(fight: FightState): number {
  let t = (fight.rngState = (fight.rngState + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Jet entier dans [min, max] selon le mode de jet du combat. */
export function roll(fight: FightState, min: number, max: number, mode: RollMode = fight.options.rollMode): number {
  if (max < min) max = min
  switch (mode) {
    case 'min':
      return min
    case 'max':
      return max
    case 'average':
      return (min + max) / 2
    default:
      return min + Math.floor(nextRandom(fight) * (max - min + 1))
  }
}

/** Tirage d'une probabilité p ∈ [0,1]. En mode 'average', renvoie vrai si p ≥ 0.5 (décision déterministe). */
export function chance(fight: FightState, p: number): boolean {
  if (p <= 0) return false
  if (p >= 1) return true
  if (fight.options.rollMode !== 'random') return p >= 0.5
  return nextRandom(fight) < p
}
