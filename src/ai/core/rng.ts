/**
 * Aléa, graines et mathématiques déterministes de l'IA (docs/design/ai.md §6.1, §13).
 *
 *  - `fightAISeed`, `aiSeed`, `simSalt` : flux séparés (§13.1) — la réflexion n'avance jamais `fight.rngState` du vrai
 *    combat, les clones de recherche sont re-semés depuis la graine IA et un sel déterministe.
 *  - `decisionRng` : générateur sfc32 (`src/core/rng.ts`) des départages / bruit / exploration.
 *  - `detExp`, `phi`, `softmaxInto` : exponentielle, Φ et softmax sans `Math.exp` (§13.2 : les arrondis de
 *    `Math.exp/log/pow` peuvent différer d'un moteur JavaScript à l'autre ; les quatre opérations et `Math.sqrt`, elles,
 *    sont correctement arrondies par IEEE 754 et donnent partout le même résultat).
 */
import { mix32 } from '../../core/hash'
import { Rng } from '../../core/rng'

export { mix32 } from '../../core/hash'

/** Graine IA d'un combat (`AIConfig.seed`), dérivée de la graine de combat. */
export function fightAISeed(fightSeed: number): number {
  return mix32(fightSeed ^ 0xa1a1a1a1, 0x5eed)
}

/** Graine des décisions IA : `aiSeed(f, id, r, k) = mix32(mix32(f ^ 0xa1a1a1a1, id), (r << 8) | k)` (§13.1). */
export function aiSeed(fightSeed: number, fighterId: number, round: number, k: number): number {
  return mix32(mix32(fightSeed ^ 0xa1a1a1a1, fighterId), (round << 8) | k)
}

/** Générateur des décisions IA (départages, bruit `noiseTau`, exploration ε, dés des itérations MCTS). */
export function decisionRng(fightSeed: number, fighterId: number, round: number, k: number): Rng {
  return new Rng(aiSeed(fightSeed, fighterId, round, k))
}

/**
 * Sel d'un clone de recherche : hash du nœud parent ^ profondeur (même sel pour tous les frères, §6.1). Accepte le
 * hash 64 bits de `stateHash` (replié sur 32 bits) ou un hash 32 bits.
 */
export function simSalt(parentHash: number | bigint, depth: number): number {
  const h = typeof parentHash === 'bigint' ? Number((parentHash ^ (parentHash >> 32n)) & 0xffffffffn) : parentHash
  return (h ^ depth) >>> 0
}

/** État des dés d'un clone : `mix32(seed ^ 0x5bd1e995, sel)` (signé 32 bits, comme `FightState.rngState`). */
export function cloneRngState(aiSeedValue: number, salt: number): number {
  return mix32(aiSeedValue ^ 0x5bd1e995, salt) | 0
}

// ───────────────────────────── mathématiques déterministes ─────────────────────────────

const LN2_HI = 0.6931471803691238
const LN2_LO = 1.9082149292705877e-10
const INV_LN2 = 1.4426950408889634

/** Puissances de deux exactes 2^k, k ∈ [−1022, 1023] (construites par doublements : aucune approximation). */
const POW2 = new Float64Array(2046)
{
  let v = 1
  for (let k = 0; k <= 1023; k++, v *= 2) POW2[k + 1022] = v
  v = 1
  for (let k = 0; k >= -1022; k--, v /= 2) POW2[k + 1022] = v
}

/**
 * e^x déterministe (erreur relative < 2e-16 sur [−700, 700]) : réduction x = k·ln2 + r (|r| ≤ ln2/2), polynôme de
 * Taylor de degré 13 en schéma de Horner, puis × 2^k exact. N'utilise que + − × / et `Math.round` (exacts).
 */
export function detExp(x: number): number {
  if (x !== x) return x
  if (x > 709) return Infinity
  if (x < -708) return 0
  const k = Math.round(x * INV_LN2)
  const r = x - k * LN2_HI - k * LN2_LO
  let p = 1 / 6227020800 // 1/13!
  p = p * r + 1 / 479001600
  p = p * r + 1 / 39916800
  p = p * r + 1 / 3628800
  p = p * r + 1 / 362880
  p = p * r + 1 / 40320
  p = p * r + 1 / 5040
  p = p * r + 1 / 720
  p = p * r + 1 / 120
  p = p * r + 1 / 24
  p = p * r + 1 / 6
  p = p * r + 0.5
  p = p * r + 1
  p = p * r + 1
  return p * POW2[k + 1022]
}

/**
 * Fonction de répartition de la loi normale centrée réduite Φ(x), déterministe (erreur absolue < 1,5e-7) :
 * erfc de Numerical Recipes (approximation de Tchebychev) avec `detExp`.
 */
export function phi(x: number): number {
  if (x !== x) return 0.5
  const z = Math.abs(x) * Math.SQRT1_2
  const t = 1 / (1 + 0.5 * z)
  const poly =
    -z * z -
    1.26551223 +
    t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
  const erfc = t * detExp(poly)
  const p = 0.5 * erfc // = P(N > |x|)
  return x >= 0 ? 1 - p : p
}

/**
 * Softmax déterministe de `scores[0..n)` divisés par `tau` dans `out` (somme 1). `tau ≤ 0` ⇒ argmax (ex æquo
 * partagés). Renvoie `out`.
 */
export function softmaxInto(scores: ArrayLike<number>, n: number, tau: number, out: Float64Array | number[]): Float64Array | number[] {
  if (n <= 0) return out
  let max = -Infinity
  for (let i = 0; i < n; i++) if (scores[i] > max) max = scores[i]
  if (!(tau > 0) || !Number.isFinite(max)) {
    let ties = 0
    for (let i = 0; i < n; i++) if (scores[i] === max) ties++
    for (let i = 0; i < n; i++) out[i] = scores[i] === max && ties ? 1 / ties : 0
    return out
  }
  let sum = 0
  for (let i = 0; i < n; i++) {
    const e = detExp((scores[i] - max) / tau)
    out[i] = e
    sum += e
  }
  for (let i = 0; i < n; i++) out[i] = out[i] / sum
  return out
}

/** Borne `x` dans [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
