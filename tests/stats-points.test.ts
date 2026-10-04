import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BreedData } from '../src/data/model'
import {
  allocateAll,
  availableCharacteristicPoints,
  baseStatsFromPoints,
  breedCostTiers,
  costToRaise,
  DEFAULT_STAT_POINT_COSTS,
  pointsForStatValue,
  PRIMARY_STATS,
  statLevel,
  statValueFromPoints,
  type CostTiers,
} from '../src/stats/characteristicPoints'

const ELEM = DEFAULT_STAT_POINT_COSTS.strength
const VIT = DEFAULT_STAT_POINT_COSTS.vitality
const WIS = DEFAULT_STAT_POINT_COSTS.wisdom

interface RawBreed {
  id: number
  shortName: { fr: string }
  statsPointsForStrength: [number, number][]
  statsPointsForIntelligence: [number, number][]
  statsPointsForChance: [number, number][]
  statsPointsForAgility: [number, number][]
  statsPointsForVitality: [number, number][]
  statsPointsForWisdom: [number, number][]
}

const rawBreeds = (
  JSON.parse(readFileSync(new URL('../data/dofusdb/breeds.json', import.meta.url), 'utf8')) as { breeds: RawBreed[] }
).breeds

function breedWith(costs: Record<string, [number, number][]> | undefined, id = 1): BreedData {
  return { id, name: `classe ${id}`, roles: [], spellPairs: [], statPointCosts: costs }
}

describe('stats/characteristicPoints — points disponibles', () => {
  it('5 points par niveau après le premier, 995 au niveau 200, rien au-delà (Oméga)', () => {
    expect(availableCharacteristicPoints(1)).toBe(0)
    expect(availableCharacteristicPoints(2)).toBe(5)
    expect(availableCharacteristicPoints(100)).toBe(495)
    expect(availableCharacteristicPoints(199)).toBe(990)
    expect(availableCharacteristicPoints(200)).toBe(995)
    expect(availableCharacteristicPoints(250)).toBe(995)
    expect(availableCharacteristicPoints(0)).toBe(0)
    expect(statLevel(-5)).toBe(1)
    expect(statLevel(150.7)).toBe(150)
  })
})

describe('stats/characteristicPoints — coûts par palier', () => {
  it('stat élémentaire : 1/2/3/4 points par point après 100/200/300', () => {
    expect(pointsForStatValue(ELEM, 0)).toBe(0)
    expect(pointsForStatValue(ELEM, 100)).toBe(100)
    expect(pointsForStatValue(ELEM, 101)).toBe(102)
    expect(pointsForStatValue(ELEM, 200)).toBe(300)
    expect(pointsForStatValue(ELEM, 201)).toBe(303)
    expect(pointsForStatValue(ELEM, 300)).toBe(600)
    expect(pointsForStatValue(ELEM, 301)).toBe(604)
    expect(pointsForStatValue(ELEM, 398)).toBe(992)
    // Formule de la doc (fonction DofusDB `bn`) : x, 100 + 2(x−100), 300 + 3(x−200), 600 + 4(x−300).
    for (let x = 0; x <= 600; x++) {
      const expected = x <= 100 ? x : x <= 200 ? 100 + 2 * (x - 100) : x <= 300 ? 300 + 3 * (x - 200) : 600 + 4 * (x - 300)
      expect(pointsForStatValue(ELEM, x)).toBe(expected)
    }
  })

  it('Vitalité 1:1, Sagesse 3:1', () => {
    expect(pointsForStatValue(VIT, 995)).toBe(995)
    expect(pointsForStatValue(WIS, 331)).toBe(993)
    expect(costToRaise(WIS, 10, 20)).toBe(30)
  })

  it('coût depuis une base non nulle', () => {
    expect(costToRaise(ELEM, 100, 101)).toBe(2)
    expect(costToRaise(ELEM, 99, 101)).toBe(3)
    expect(costToRaise(ELEM, 250, 300)).toBe(150)
    expect(costToRaise(ELEM, 300, 300)).toBe(0)
    expect(costToRaise(ELEM, 300, 200)).toBe(0)
  })

  it('valeur obtenue à partir des points investis (avec points perdus)', () => {
    expect(statValueFromPoints(ELEM, 995)).toEqual({ value: 398, spent: 992, leftover: 3 })
    expect(statValueFromPoints(ELEM, 101)).toEqual({ value: 100, spent: 100, leftover: 1 })
    expect(statValueFromPoints(ELEM, 102)).toEqual({ value: 101, spent: 102, leftover: 0 })
    expect(statValueFromPoints(ELEM, 600)).toEqual({ value: 300, spent: 600, leftover: 0 })
    expect(statValueFromPoints(WIS, 995)).toEqual({ value: 331, spent: 993, leftover: 2 })
    expect(statValueFromPoints(VIT, 995)).toEqual({ value: 995, spent: 995, leftover: 0 })
    expect(statValueFromPoints(ELEM, 0)).toEqual({ value: 0, spent: 0, leftover: 0 })
    expect(statValueFromPoints(ELEM, -10)).toEqual({ value: 0, spent: 0, leftover: 0 })
    // Depuis une base de 100 : 2 points par point.
    expect(statValueFromPoints(ELEM, 10, 100)).toEqual({ value: 5, spent: 10, leftover: 0 })
  })

  it('aller-retour valeur → points → valeur', () => {
    for (const tiers of [ELEM, VIT, WIS]) {
      for (let v = 0; v <= 500; v++) expect(statValueFromPoints(tiers, pointsForStatValue(tiers, v)).value).toBe(v)
    }
  })

  it('paliers avec gain > 1 (ancien Sacrieur : 1 point = 2 Vitalité)', () => {
    const sacri: CostTiers = [[0, 1, 2]]
    expect(statValueFromPoints(sacri, 10)).toEqual({ value: 20, spent: 10, leftover: 0 })
    expect(pointsForStatValue(sacri, 20)).toBe(10)
    expect(pointsForStatValue(sacri, 21)).toBe(11) // on dépasse à 22
    const mixed: CostTiers = [
      [0, 1, 2],
      [100, 2, 1],
    ]
    // 50 points ⇒ 100 ; puis 2 points par point.
    expect(statValueFromPoints(mixed, 60)).toEqual({ value: 105, spent: 60, leftover: 0 })
    expect(pointsForStatValue(mixed, 105)).toBe(60)
  })

  it('paliers vides ⇒ 1:1', () => {
    expect(pointsForStatValue([], 42)).toBe(42)
    expect(statValueFromPoints([], 42).value).toBe(42)
  })
})

describe('stats/characteristicPoints — paliers des classes', () => {
  it('les 19 classes ont les paliers communs de la doc (Sacrieur compris)', () => {
    expect(rawBreeds).toHaveLength(19)
    for (const b of rawBreeds) {
      const breed = breedWith({
        statsPointsForStrength: b.statsPointsForStrength,
        statsPointsForIntelligence: b.statsPointsForIntelligence,
        statsPointsForChance: b.statsPointsForChance,
        statsPointsForAgility: b.statsPointsForAgility,
        statsPointsForVitality: b.statsPointsForVitality,
        statsPointsForWisdom: b.statsPointsForWisdom,
      }, b.id)
      for (const s of PRIMARY_STATS) expect(breedCostTiers(breed, s), `${b.shortName.fr} ${s}`).toEqual(DEFAULT_STAT_POINT_COSTS[s])
    }
  })

  it('accepte les conventions de clés de BreedData.statPointCosts et retombe sur les paliers par défaut', () => {
    const custom: [number, number][] = [[0, 5]]
    expect(breedCostTiers(breedWith({ strength: custom }), 'strength')).toBe(custom)
    expect(breedCostTiers(breedWith({ Strength: custom }), 'strength')).toBe(custom)
    expect(breedCostTiers(breedWith({ statsPointsForStrength: custom }), 'strength')).toBe(custom)
    expect(breedCostTiers(breedWith({ strength: [] }), 'strength')).toBe(ELEM)
    expect(breedCostTiers(breedWith({ strength: custom }), 'agility')).toBe(ELEM)
    expect(breedCostTiers(breedWith(undefined), 'wisdom')).toBe(WIS)
    expect(breedCostTiers(undefined, 'vitality')).toBe(VIT)
  })
})

describe('stats/characteristicPoints — allocateAll', () => {
  it('tout dans un élément au niveau 200 ⇒ 398 (+3 points en Vitalité)', () => {
    const a = allocateAll(undefined, 200, 'strength')
    expect(a.values.strength).toBe(398)
    expect(a.points.strength).toBe(992)
    expect(a.values.vitality).toBe(3)
    expect(a.points.vitality).toBe(3)
    expect(a.spent).toBe(995)
    expect(a.unused).toBe(0)
    expect(a.available).toBe(995)
  })

  it('sans caractéristique de reste : 3 points inutilisés', () => {
    const a = allocateAll(undefined, 200, 'agility', { rest: null })
    expect(a.values.agility).toBe(398)
    expect(a.unused).toBe(3)
    expect(a.spent).toBe(992)
  })

  it('variante « 300 élément + 395 Vitalité »', () => {
    const a = allocateAll(undefined, 200, 'intelligence', { primaryCap: 300 })
    expect(a.values.intelligence).toBe(300)
    expect(a.points.intelligence).toBe(600)
    expect(a.values.vitality).toBe(395)
    expect(a.unused).toBe(0)
  })

  it('Sagesse pure ⇒ 331, Vitalité pure ⇒ 995', () => {
    const w = allocateAll(undefined, 200, 'wisdom')
    expect(w.values.wisdom).toBe(331)
    expect(w.points.wisdom).toBe(993)
    expect(w.values.vitality).toBe(2)
    const v = allocateAll(undefined, 200, 'vitality')
    expect(v.values.vitality).toBe(995)
    expect(v.points.vitality).toBe(995)
    const w2 = allocateAll(undefined, 200, 'wisdom', { rest: 'wisdom' })
    expect(w2.values.wisdom).toBe(331)
    expect(w2.unused).toBe(2)
  })

  it('niveaux bas et plafond supérieur aux points disponibles', () => {
    expect(allocateAll(undefined, 1, 'chance').spent).toBe(0)
    const a = allocateAll(undefined, 50, 'chance', { primaryCap: 1000 })
    expect(a.values.chance).toBe(100 + Math.floor((245 - 100) / 2))
    expect(a.points.chance + a.points.vitality).toBe(245)
  })

  it('baseStatsFromPoints convertit des points investis indépendants', () => {
    const r = baseStatsFromPoints(undefined, { strength: 995, wisdom: 30, vitality: 10 })
    expect(r.values).toEqual({ vitality: 10, wisdom: 10, strength: 398, intelligence: 0, chance: 0, agility: 0 })
    expect(r.spent).toBe(1035)
    expect(r.leftover.strength).toBe(3)
    expect(r.leftover.wisdom).toBe(0)
  })
})
