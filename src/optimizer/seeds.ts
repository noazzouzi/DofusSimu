/**
 * Graines des campagnes et variantes INCERTAINES (docs/design/ai.md §13.1, §12.1) — WP4.
 *
 *  - Campagne : `fightSeed(i) = mix32(masterSeed, i)` ; toutes les configurations comparées utilisent les MÊMES
 *    graines (nombres aléatoires communs, CRN) ; avec E1 (`rngRekey: 'perTurn'`, défaut de `runOne`) les dés d'un
 *    tour ne dépendent que de (graine, tour, combattant).
 *  - Variante de scénario : `Rng(mix32(fightSeed, 0x5C))` ; chaque paramètre INCERTAIN (`UncertainParam`, première
 *    valeur = défaut) est tiré indépendamment selon ses poids, dans l'ordre de `scenario.uncertain`. La clé de variante
 *    (`FightSummary.variant`) liste les paramètres hors défaut (`clé=valeur` séparés par ';'), 'default' sinon.
 *
 * Tout est entier ou à base de `Rng.next()` (opérations 32 bits + division exacte) : mêmes tirages en Node et dans le
 * navigateur, quel que soit le nombre de workers.
 */
import { mix32 } from '../core/hash'
import { Rng } from '../core/rng'
import type { ScenarioParams, UncertainParam } from '../dungeons/types'

/** Sel du flux « variante de scénario » (§13.1). */
export const VARIANT_SALT = 0x5c

/** Graine du i-ème combat d'une campagne : `mix32(masterSeed, i)` (non signée). */
export function campaignSeed(masterSeed: number, i: number): number {
  return mix32(masterSeed, i)
}

/** Graines `[offset, offset + n)` d'une campagne (CRN : mêmes graines pour toutes les configurations). */
export function campaignSeeds(masterSeed: number, n: number, offset = 0): number[] {
  const out = new Array<number>(Math.max(0, n))
  for (let i = 0; i < out.length; i++) out[i] = campaignSeed(masterSeed, offset + i)
  return out
}

/** Flux aléatoire de la variante INCERTAINE d'un combat. */
export function variantRng(fightSeed: number): Rng {
  return new Rng(mix32(fightSeed, VARIANT_SALT))
}

/** Valeur d'un paramètre en texte stable (clés de variante, rapports). */
export function paramText(v: unknown): string {
  return Array.isArray(v) ? `[${v.join(',')}]` : String(v)
}

/** Index tiré selon des poids (somme quelconque > 0 ; poids négatifs ou non finis ignorés). */
export function weightedIndex(weights: readonly number[], u: number): number {
  let total = 0
  for (const w of weights) if (w > 0 && Number.isFinite(w)) total += w
  if (!(total > 0)) return 0
  let r = u * total
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] > 0 && Number.isFinite(weights[i]) ? weights[i] : 0
    if (r < w) return i
    r -= w
  }
  return weights.length - 1
}

export interface SampledVariant {
  /** Valeurs tirées hors défaut (à fusionner sur les paramètres par défaut du scénario). */
  params: Record<string, ScenarioParams[string]>
  /** Clé lisible : 'default' ou `clé=valeur;…` (paramètres hors défaut, ordre de `uncertain`). */
  key: string
}

/**
 * Tire la variante INCERTAINE d'un combat. `fixed` : clés imposées par la spécification (non tirées, mais le flux
 * consomme quand même un tirage par paramètre : la variante des autres paramètres ne dépend pas de ce qui est imposé).
 */
export function sampleVariant(uncertain: readonly UncertainParam[], fightSeed: number, fixed: ReadonlySet<string> = new Set()): SampledVariant {
  const rng = variantRng(fightSeed)
  const params: Record<string, ScenarioParams[string]> = {}
  const parts: string[] = []
  for (const u of uncertain) {
    const i = weightedIndex(u.weights, rng.next())
    if (fixed.has(u.key) || i === 0 || i >= u.values.length) continue
    const v = u.values[i]
    params[u.key] = Array.isArray(v) ? v.slice() : v
    parts.push(`${u.key}=${paramText(v)}`)
  }
  return { params, key: parts.length ? parts.join(';') : 'default' }
}

/** Clé de variante de paramètres imposés (hors défaut), même format que `sampleVariant`. */
export function variantKeyOf(uncertain: readonly UncertainParam[], params: Readonly<Record<string, unknown>>): string {
  const parts: string[] = []
  for (const u of uncertain) {
    if (!(u.key in params)) continue
    const v = params[u.key]
    if (paramText(v) === paramText(u.values[0])) continue
    parts.push(`${u.key}=${paramText(v)}`)
  }
  return parts.length ? parts.join(';') : 'default'
}

/** Paquets de graines (répartition sur les workers, §15.2 : paquets de 8). */
export function chunkSeeds(seeds: readonly number[], size = 8): number[][] {
  const out: number[][] = []
  const n = Math.max(1, Math.floor(size))
  for (let i = 0; i < seeds.length; i += n) out.push(seeds.slice(i, i + n))
  return out
}
