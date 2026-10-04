/**
 * Arithmétique partagée par les formules de combat.
 *
 * Deux modes de calcul coexistent (cf. docs/research/formulas.md §3.4) :
 *  - `domath` (défaut) : reproduit à l'identique les calculs flottants de DoMath (référence de l'utilisateur),
 *    y compris ses artefacts (ex. `trunc(10 × (1 − 0.8)) = 1`) ;
 *  - `integer` : même pipeline en arithmétique entière exacte (`integerSafeDamage` des vecteurs de test).
 */

export type DamageMode = 'domath' | 'integer'

/** Arrondi « .5 vers le bas » : `-Math.round(-x)` (1,5 → 1 ; 1,6 → 2). Convention DoMath (tacle). */
export function roundHalfDown(x: number): number {
  const r = -Math.round(-x)
  // Normalise -0 en 0 (Object.is(-0, 0) est faux).
  return r === 0 ? 0 : r
}

/** Arrondi « .5 loin de zéro » (C# `Math.Round(x, MidpointRounding.AwayFromZero)`). */
export function roundHalfAwayFromZero(x: number): number {
  const r = x < 0 ? -Math.round(-x) : Math.round(x)
  return r === 0 ? 0 : r
}

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x
}

/** `trunc` qui ne renvoie jamais -0 (les vecteurs comparent avec Object.is). */
export function trunc0(x: number): number {
  const r = Math.trunc(x)
  return r === 0 ? 0 : r
}
