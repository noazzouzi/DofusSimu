/**
 * Mathématiques déterministes des boucles d'optimisation (docs/design/ai.md §13.2) — WP4b.
 *
 * Les décisions des boucles (classement de stuffs, acceptation du recuit, échantillonnage de la CEM) n'utilisent ni
 * `Math.log`/`Math.exp`/`Math.pow` (arrondis non garantis identiques d'un moteur JavaScript à l'autre) ni
 * `Math.random` : logarithme par réduction exacte en puissances de 2 + série d'atanh, exponentielle de src/ai/core
 * (`detExp`), normales par somme de 12 uniformes (Irwin-Hall) d'un `Rng` graine.
 */
import { detExp } from '../../ai/core/rng'
import type { Rng } from '../../core/rng'

const LN2 = 0.6931471805599453

/** ln(x) déterministe (x > 0) ; −Infinity pour 0, NaN pour x < 0. Erreur relative < 1e-15. */
export function detLog(x: number): number {
  if (x !== x || x < 0) return NaN
  if (x === 0) return -Infinity
  if (x === Infinity) return Infinity
  let k = 0
  let m = x
  // Réduction exacte (multiplications par 2 et 1/2) vers m ∈ [√½, √2).
  while (m >= 1.4142135623730951) {
    m *= 0.5
    k++
  }
  while (m < 0.7071067811865476) {
    m *= 2
    k--
  }
  // ln(m) = 2·atanh(z), z = (m − 1)/(m + 1) ∈ [−0,172 ; 0,172].
  const z = (m - 1) / (m + 1)
  const z2 = z * z
  let term = z
  let sum = z
  for (let n = 3; n < 40; n += 2) {
    term *= z2
    const add = term / n
    sum += add
    if (Math.abs(add) < 1e-18) break
  }
  return 2 * sum + k * LN2
}

/** x^a déterministe (x > 0). */
export function detPow(x: number, a: number): number {
  if (a === 0) return 1
  if (x <= 0) return x === 0 ? (a > 0 ? 0 : Infinity) : NaN
  return detExp(a * detLog(x))
}

export { detExp }

/** Loi normale centrée réduite approchée (Irwin-Hall : somme de 12 uniformes − 6), bornée à ±6. */
export function normal01(rng: Rng): number {
  let s = 0
  for (let i = 0; i < 12; i++) s += rng.next()
  return s - 6
}

/** Arrondi à `digits` chiffres significatifs (θ réglés : clés de cache stables, JSON lisible). */
export function roundSig(x: number, digits = 4): number {
  if (x === 0 || !Number.isFinite(x)) return x
  const neg = x < 0
  let a = neg ? -x : x
  let e = 0
  while (a >= 10) {
    a /= 10
    e++
  }
  while (a < 1) {
    a *= 10
    e--
  }
  const scale = 10 ** (digits - 1)
  const r = Math.round(a * scale) / scale
  const out = e >= 0 ? r * 10 ** e : r / 10 ** -e
  // Nettoie les queues binaires (0.30000000000000004).
  const fixed = Number(out.toPrecision(digits))
  return neg ? -fixed : fixed
}
