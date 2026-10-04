/**
 * Points de caractéristiques (capital) : coût par palier, points disponibles par niveau, répartition type.
 *
 * Règles (docs/research/equipment.md §4, données `breeds.statsPointsFor*`, code DofusDB `bn`/`Sn`) :
 *  - 5 points par niveau gagné ⇒ `5 × (niveau − 1)` = 995 au niveau 200 ; les niveaux Oméga (> 200) n'en donnent pas ;
 *  - paliers `[[seuil, coût], …]` : le coût d'un point dépend de la valeur de base ATTEINTE dans la stat
 *    (Force/Intel/Chance/Agi : 1 jusqu'à 100, 2 de 101 à 200, 3 de 201 à 300, 4 au-delà ; Vitalité 1:1 ; Sagesse 3:1),
 *    identiques pour les 19 classes en Dofus 3 (Sacrieur compris) ;
 *  - un 3ᵉ élément facultatif `[seuil, coût, gain]` (gain > 1 : ancien Sacrieur, 1 point = 2 Vitalité) est supporté
 *    au cas où les données le réintroduiraient ;
 *  - parchemins : +100 maximum par caractéristique, hors paliers (« additionnel »).
 */
import type { BreedData } from '../data/model'

export type PrimaryStat = 'vitality' | 'wisdom' | 'strength' | 'intelligence' | 'chance' | 'agility'
export type PrimaryStatRecord = Record<PrimaryStat, number>

export const PRIMARY_STATS: readonly PrimaryStat[] = ['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility']

export const PRIMARY_STAT_NAMES_FR: Readonly<Record<PrimaryStat, string>> = {
  vitality: 'Vitalité',
  wisdom: 'Sagesse',
  strength: 'Force',
  intelligence: 'Intelligence',
  chance: 'Chance',
  agility: 'Agilité',
}

/** Paliers de coût `[[seuil, coût, gain?], …]` triés par seuil croissant (format DofusDB `statsPointsFor*`). */
export type CostTiers = readonly (readonly number[])[]

export const POINTS_PER_LEVEL = 5
/** Niveau au-delà duquel plus aucun point ni statistique n'est gagné (niveaux Oméga). */
export const MAX_STAT_LEVEL = 200
/** Plafond des parchemins de caractéristiques (par caractéristique). */
export const MAX_SCROLL_PER_STAT = 100

const ELEMENT_TIERS: CostTiers = [
  [0, 1],
  [100, 2],
  [200, 3],
  [300, 4],
]

/** Paliers de coût de Dofus 3 (identiques pour toutes les classes). */
export const DEFAULT_STAT_POINT_COSTS: Readonly<Record<PrimaryStat, CostTiers>> = {
  vitality: [[0, 1]],
  wisdom: [[0, 3]],
  strength: ELEMENT_TIERS,
  intelligence: ELEMENT_TIERS,
  chance: ELEMENT_TIERS,
  agility: ELEMENT_TIERS,
}

/**
 * Clés acceptées dans `BreedData.statPointCosts` : clé `Stats` (`strength`), suffixe DofusDB (`Strength`)
 * ou nom complet du champ DofusDB (`statsPointsForStrength`) — le modèle ne fixe pas la convention.
 */
const BREED_COST_KEYS: Readonly<Record<PrimaryStat, readonly string[]>> = {
  vitality: ['vitality', 'Vitality', 'statsPointsForVitality'],
  wisdom: ['wisdom', 'Wisdom', 'statsPointsForWisdom'],
  strength: ['strength', 'Strength', 'statsPointsForStrength'],
  intelligence: ['intelligence', 'Intelligence', 'statsPointsForIntelligence'],
  chance: ['chance', 'Chance', 'statsPointsForChance'],
  agility: ['agility', 'Agility', 'statsPointsForAgility'],
}

export function emptyPrimaryStats(): PrimaryStatRecord {
  return { vitality: 0, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 }
}

/** Niveau pris en compte pour les points et les statistiques (1..200 ; Oméga ⇒ 200). */
export function statLevel(level: number): number {
  return Math.max(1, Math.min(MAX_STAT_LEVEL, Math.floor(level)))
}

/** Points de caractéristiques gagnés au niveau donné : 5 × (niveau − 1), 995 au niveau 200. */
export function availableCharacteristicPoints(level: number): number {
  return POINTS_PER_LEVEL * (statLevel(level) - 1)
}

/** Paliers de coût d'une caractéristique pour une classe (repli : paliers Dofus 3 communs). */
export function breedCostTiers(breed: BreedData | undefined, stat: PrimaryStat): CostTiers {
  const costs = breed?.statPointCosts
  if (costs) {
    for (const key of BREED_COST_KEYS[stat]) {
      const tiers = costs[key]
      if (tiers && tiers.length > 0) return tiers
    }
  }
  return DEFAULT_STAT_POINT_COSTS[stat]
}

/** Index du palier applicable à la valeur de base `value` (dernier seuil ≤ valeur). */
function tierIndexAt(tiers: CostTiers, value: number): number {
  let idx = 0
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i][0] <= value) idx = i
    else break
  }
  return idx
}

/**
 * Coût en points pour faire passer la valeur de base d'une caractéristique de `from` à `to`
 * (ex. Force 0 → 398 : 100 + 200 + 300 + 392 = 992).
 */
export function costToRaise(tiers: CostTiers, from: number, to: number): number {
  if (tiers.length === 0) tiers = [[0, 1]]
  let value = Math.max(0, from)
  let cost = 0
  while (value < to) {
    const i = tierIndexAt(tiers, value)
    const tier = tiers[i]
    const unitCost = tier[1] ?? 1
    const gain = Math.max(1, tier[2] ?? 1)
    const next = i + 1 < tiers.length ? tiers[i + 1][0] : Infinity
    const segEnd = Math.min(next, to)
    const buys = Math.ceil((segEnd - value) / gain)
    cost += buys * unitCost
    value += buys * gain
  }
  return cost
}

/** Coût total pour atteindre une valeur de base depuis 0. */
export function pointsForStatValue(tiers: CostTiers, value: number): number {
  return costToRaise(tiers, 0, value)
}

export interface StatFromPoints {
  /** Valeur de base obtenue. */
  value: number
  /** Points réellement consommés. */
  spent: number
  /** Points investis qui n'achètent aucun point de caractéristique (reste inférieur au coût unitaire). */
  leftover: number
}

/**
 * Valeur de base obtenue en investissant `points` dans une caractéristique (en partant de `from`).
 * Ex. 995 points en Force ⇒ 398 (992 points consommés, 3 perdus).
 */
export function statValueFromPoints(tiers: CostTiers, points: number, from = 0): StatFromPoints {
  if (tiers.length === 0) tiers = [[0, 1]]
  let value = Math.max(0, from)
  let remaining = Math.max(0, Math.floor(points))
  for (;;) {
    const i = tierIndexAt(tiers, value)
    const tier = tiers[i]
    const unitCost = Math.max(1, tier[1] ?? 1)
    const gain = Math.max(1, tier[2] ?? 1)
    const next = i + 1 < tiers.length ? tiers[i + 1][0] : Infinity
    const maxBuys = next === Infinity ? Infinity : Math.ceil((next - value) / gain)
    const buys = Math.min(maxBuys, Math.floor(remaining / unitCost))
    if (buys <= 0) break
    value += buys * gain
    remaining -= buys * unitCost
    if (buys < maxBuys) break
  }
  const invested = Math.max(0, Math.floor(points))
  return { value: value - Math.max(0, from), spent: invested - remaining, leftover: remaining }
}

/** Coût (en points) pour faire passer une caractéristique de `from` à `value` pour une classe. */
export function pointsToReach(breed: BreedData | undefined, stat: PrimaryStat, value: number, from = 0): number {
  return costToRaise(breedCostTiers(breed, stat), from, value)
}

/** Gain obtenu en investissant `points` dans une caractéristique d'une classe (depuis la base `from`). */
export function investPoints(breed: BreedData | undefined, stat: PrimaryStat, points: number, from = 0): StatFromPoints {
  return statValueFromPoints(breedCostTiers(breed, stat), points, from)
}

export interface AllocationOptions {
  /**
   * Valeur de base maximale visée dans la caractéristique principale (ex. 300 pour la variante
   * « 300 élément + reste en Vitalité »). Défaut : aucune limite.
   */
  primaryCap?: number
  /** Caractéristique qui reçoit les points restants (défaut `vitality` ; `null` = points laissés libres). */
  rest?: PrimaryStat | null
}

export interface Allocation {
  /** Points investis par caractéristique (format de `CharacterBuild.characteristicPoints`). */
  points: PrimaryStatRecord
  /** Valeurs de base obtenues. */
  values: PrimaryStatRecord
  available: number
  spent: number
  /** Points non investis ou ne donnant aucun point de caractéristique. */
  unused: number
}

/**
 * Répartition type d'un personnage : tout dans `primary` (éventuellement jusqu'à `primaryCap`), le reste dans
 * `rest` (Vitalité par défaut : 1:1, aucun point perdu).
 * Niveau 200 : `allocateAll(b, 200, 'strength')` ⇒ 398 Force (992 pts) + 3 Vitalité ;
 * `allocateAll(b, 200, 'strength', { primaryCap: 300 })` ⇒ 300 Force (600 pts) + 395 Vitalité.
 */
export function allocateAll(
  breed: BreedData | undefined,
  level: number,
  primary: PrimaryStat,
  options: AllocationOptions = {},
): Allocation {
  const available = availableCharacteristicPoints(level)
  const points = emptyPrimaryStats()
  const values = emptyPrimaryStats()
  const primaryTiers = breedCostTiers(breed, primary)
  let budget = available
  if (options.primaryCap !== undefined) {
    budget = Math.min(budget, pointsForStatValue(primaryTiers, Math.max(0, options.primaryCap)))
  }
  const main = statValueFromPoints(primaryTiers, budget)
  points[primary] = main.spent
  values[primary] = main.value
  let remaining = available - main.spent
  const rest = options.rest === undefined ? 'vitality' : options.rest
  if (rest && remaining > 0) {
    const restTiers = breedCostTiers(breed, rest)
    const extra = statValueFromPoints(restTiers, remaining, values[rest])
    points[rest] += extra.spent
    values[rest] += extra.value
    remaining -= extra.spent
  }
  return { points, values, available, spent: available - remaining, unused: remaining }
}

/**
 * Valeurs de base obtenues à partir des points investis (chaque caractéristique est indépendante).
 * `leftover` cumule les points investis qui n'achètent rien (ex. 995 en Force ⇒ 3).
 */
export function baseStatsFromPoints(
  breed: BreedData | undefined,
  invested: Partial<PrimaryStatRecord>,
): { values: PrimaryStatRecord; spent: number; leftover: PrimaryStatRecord } {
  const values = emptyPrimaryStats()
  const leftover = emptyPrimaryStats()
  let spent = 0
  for (const stat of PRIMARY_STATS) {
    const pts = invested[stat] ?? 0
    if (pts <= 0) continue
    const r = statValueFromPoints(breedCostTiers(breed, stat), pts)
    values[stat] = r.value
    leftover[stat] = r.leftover
    spent += Math.floor(pts)
  }
  return { values, spent, leftover }
}
