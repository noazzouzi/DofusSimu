import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyStats, STAT_KEYS, type StatKey } from '../src/core/types'
import {
  applyItemEffect,
  effectIdForStat,
  IGNORED_STAT_EFFECT_IDS,
  itemEffectSign,
  itemEffectStat,
  itemEffectStatIndex,
  NEGATIVE_EFFECT_BY_STAT,
  POSITIVE_EFFECT_BY_STAT,
  signedEffectValue,
  STAT_BY_CHARACTERISTIC_ID,
} from '../src/stats/effects'
import { copyStats, STAT_COUNT, STAT_INDEX, STAT_ORDER, statsFromArray, zeroStats } from '../src/stats/fastStats'

interface MapEntry {
  stat: string | null
  sign: number
  context: string
  characteristicId?: number
  oppositeEffectId?: number
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T

const charMap = readJson<Record<string, MapEntry>>('../data/research/characteristics-map.json')

/** Noms de caractéristiques de characteristics-map.json → clés `Stats`. */
const MAP_TO_STATS: Record<string, StatKey> = {
  actionPoints: 'ap',
  movementPoints: 'mp',
  range: 'range',
  summons: 'summons',
  criticalHit: 'critical',
  damage: 'damage',
  power: 'power',
  strength: 'strength',
  agility: 'agility',
  chance: 'chance',
  intelligence: 'intelligence',
  wisdom: 'wisdom',
  vitality: 'vitality',
  apParry: 'apParry',
  mpParry: 'mpParry',
  initiative: 'initiative',
  prospecting: 'prospecting',
  heals: 'heals',
  resPercentEarth: 'earthResPct',
  resPercentFire: 'fireResPct',
  resPercentWater: 'waterResPct',
  resPercentAir: 'airResPct',
  resPercentNeutral: 'neutralResPct',
  reflectDamage: 'reflect',
  trapDamage: 'trapDamage',
  trapPower: 'trapPower',
  resFixedEarth: 'earthRes',
  resFixedFire: 'fireRes',
  resFixedWater: 'waterRes',
  resFixedAir: 'airRes',
  resFixedNeutral: 'neutralRes',
  apReduction: 'apReduction',
  mpReduction: 'mpReduction',
  pushDamage: 'pushDamage',
  pushResistance: 'pushRes',
  criticalDamage: 'criticalDamage',
  criticalResistance: 'criticalRes',
  earthDamage: 'earthDamage',
  fireDamage: 'fireDamage',
  waterDamage: 'waterDamage',
  airDamage: 'airDamage',
  neutralDamage: 'neutralDamage',
  escape: 'tackleEvade',
  tackle: 'tackleBlock',
  meleeDamagePercent: 'meleeDamagePct',
  rangedDamagePercent: 'rangedDamagePct',
  weaponDamagePercent: 'weaponDamagePct',
  spellDamagePercent: 'spellDamagePct',
  meleeResistancePercent: 'meleeResPct',
  rangedResistancePercent: 'rangedResPct',
  weaponResistancePercent: 'weaponResPct',
  spellResistancePercent: 'spellResPct',
}

describe('stats/effects — table effectId → caractéristique', () => {
  it('couvre exactement les effets « stat » de characteristics-map.json (stat et signe)', () => {
    let checked = 0
    for (const [id, entry] of Object.entries(charMap)) {
      if (entry.context !== 'stat') continue
      const effectId = Number(id)
      const expected = entry.stat ? MAP_TO_STATS[entry.stat] : undefined
      if (expected) {
        expect(itemEffectStat(effectId), `effet ${effectId} (${entry.stat})`).toBe(expected)
        expect(itemEffectSign(effectId), `signe de ${effectId}`).toBe(entry.sign)
        checked++
      } else {
        expect(IGNORED_STAT_EFFECT_IDS.has(effectId), `effet ${effectId} (${entry.stat}) ni mappé ni ignoré`).toBe(true)
        expect(itemEffectStat(effectId)).toBeUndefined()
      }
    }
    expect(checked).toBeGreaterThan(95)
  })

  it('mappe les parchemins (606-611) et rien des contextes non statistiques', () => {
    for (const [id, entry] of Object.entries(charMap)) {
      const effectId = Number(id)
      if (entry.context === 'scroll') expect(itemEffectStat(effectId)).toBe(MAP_TO_STATS[entry.stat!])
      else if (entry.context !== 'stat') expect(itemEffectStat(effectId), `effet ${effectId} (${entry.context})`).toBeUndefined()
    }
  })

  it("chaque effet de caractéristique présent sur les objets et panoplies est pris en compte ou ignoré à dessein", () => {
    const items = readJson<{ possibleEffects: { effectId: number }[] }[]>('../data/dofusdb/equipment.json')
    const sets = readJson<{ bonusesByItemCount: Record<string, { effectId: number }[]> }[]>('../data/dofusdb/item-sets.json')
    const ids = new Set<number>()
    for (const i of items) for (const e of i.possibleEffects) ids.add(e.effectId)
    for (const s of sets) for (const arr of Object.values(s.bonusesByItemCount)) for (const e of arr) ids.add(e.effectId)
    for (const id of ids) {
      const entry = charMap[String(id)]
      expect(entry, `effet ${id} absent de characteristics-map.json`).toBeDefined()
      if (entry.context === 'stat') {
        expect(itemEffectStat(id) !== undefined || IGNORED_STAT_EFFECT_IDS.has(id), `effet ${id}`).toBe(true)
      }
    }
  })

  it('ids de caractéristique et effets opposés cohérents avec le JSON', () => {
    for (const [id, entry] of Object.entries(charMap)) {
      if (entry.context !== 'stat' || !entry.stat || !MAP_TO_STATS[entry.stat]) continue
      const stat = MAP_TO_STATS[entry.stat]
      if (entry.characteristicId !== undefined) expect(STAT_BY_CHARACTERISTIC_ID[entry.characteristicId]).toBe(stat)
      const effectId = Number(id)
      const sign = entry.sign as 1 | -1
      expect(effectIdForStat(stat, sign)).toBe(effectId)
      if (entry.oppositeEffectId !== undefined) {
        expect(itemEffectStat(entry.oppositeEffectId)).toBe(stat)
        expect(itemEffectSign(entry.oppositeEffectId)).toBe(-sign)
      }
    }
  })

  it('effets bonus/malus par caractéristique', () => {
    expect(POSITIVE_EFFECT_BY_STAT.strength).toBe(118)
    expect(NEGATIVE_EFFECT_BY_STAT.strength).toBe(157)
    expect(POSITIVE_EFFECT_BY_STAT.earthResPct).toBe(210)
    expect(NEGATIVE_EFFECT_BY_STAT.earthResPct).toBe(215)
    expect(effectIdForStat('ap')).toBe(111)
    expect(effectIdForStat('ap', -1)).toBe(168)
    expect(effectIdForStat('trapDamage', -1)).toBeUndefined()
    // Les caractéristiques sans effet d'objet (bonus de combat uniquement) n'ont pas d'effet.
    expect(effectIdForStat('finalDamagePct')).toBeUndefined()
    expect(effectIdForStat('lifePoints')).toBeUndefined()
    // Toutes les clés référencées existent dans Stats.
    for (const k of Object.keys(POSITIVE_EFFECT_BY_STAT)) expect(STAT_KEYS).toContain(k)
    expect(STAT_BY_CHARACTERISTIC_ID[1]).toBe('ap')
    expect(STAT_BY_CHARACTERISTIC_ID[23]).toBe('mp')
    expect(STAT_BY_CHARACTERISTIC_ID[19]).toBe('range')
    expect(STAT_BY_CHARACTERISTIC_ID[26]).toBe('summons')
  })
})

describe('stats/effects — applyItemEffect', () => {
  it('ajoute les bonus et retranche les malus (montant toujours positif)', () => {
    const s = emptyStats()
    expect(applyItemEffect(s, 118, 100)).toBe(true) // +100 Force
    expect(applyItemEffect(s, 157, 20)).toBe(true) // −20 Force
    expect(applyItemEffect(s, 215, 5)).toBe(true) // −5 % Rés. Terre
    expect(applyItemEffect(s, 210, 8)).toBe(true) // +8 % Rés. Terre
    expect(applyItemEffect(s, 168, 1)).toBe(true) // −1 PA
    expect(applyItemEffect(s, 2812, 3, 2)).toBe(true) // facteur
    expect(s.strength).toBe(80)
    expect(s.earthResPct).toBe(3)
    expect(s.ap).toBe(-1)
    expect(s.spellDamagePct).toBe(6)
  })

  it("ignore (et signale) les effets qui ne sont pas des caractéristiques", () => {
    const s = emptyStats()
    for (const id of [97, 100, 1175, 2897, 724, 281, 158, 1166, -1, 99999, 1.5]) {
      expect(applyItemEffect(s, id, 10), `effet ${id}`).toBe(false)
    }
    expect(s).toEqual(emptyStats())
  })

  it('signes et valeurs signées', () => {
    expect(itemEffectSign(125)).toBe(1)
    expect(itemEffectSign(153)).toBe(-1)
    expect(itemEffectSign(100)).toBe(0)
    expect(itemEffectSign(-3)).toBe(0)
    expect(itemEffectSign(118.5)).toBe(0)
    expect(itemEffectStat(118.5)).toBeUndefined()
    expect(signedEffectValue(219, 5)).toBe(-5)
    expect(signedEffectValue(753, 20)).toBe(20)
    expect(signedEffectValue(97, 20)).toBe(0)
    expect(itemEffectStat(752)).toBe('tackleEvade')
    expect(itemEffectStat(753)).toBe('tackleBlock')
    expect(itemEffectStat(220)).toBe('reflect')
  })
})

describe('stats/fastStats — objets Stats rapides et accumulateurs', () => {
  it('STAT_ORDER est une permutation de STAT_KEYS', () => {
    expect(STAT_COUNT).toBe(STAT_KEYS.length)
    expect([...STAT_ORDER].sort()).toEqual([...STAT_KEYS].sort())
    STAT_ORDER.forEach((k, i) => expect(STAT_INDEX[k]).toBe(i))
  })

  it('zeroStats, copyStats et statsFromArray sont cohérents', () => {
    expect(zeroStats()).toEqual(emptyStats())
    const a = new Float64Array(STAT_COUNT)
    for (let i = 0; i < STAT_COUNT; i++) a[i] = i * 3 + 1
    const s = statsFromArray(a)
    for (const k of STAT_KEYS) expect(s[k], k).toBe(STAT_INDEX[k] * 3 + 1)
    const c = copyStats(s)
    expect(c).toEqual(s)
    expect(c).not.toBe(s)
    expect(Object.keys(c).sort()).toEqual([...STAT_KEYS].sort())
    // Copie d'un objet construit dynamiquement (mode dictionnaire).
    const dyn = emptyStats()
    dyn.agility = 42
    expect(copyStats(dyn)).toEqual(dyn)
  })

  it('index d\'accumulateur des effets', () => {
    expect(itemEffectStatIndex(118)).toBe(STAT_INDEX.strength)
    expect(itemEffectStatIndex(157)).toBe(STAT_INDEX.strength)
    expect(itemEffectStatIndex(125)).toBe(STAT_INDEX.vitality)
    expect(itemEffectStatIndex(610)).toBe(STAT_INDEX.vitality)
    expect(itemEffectStatIndex(100)).toBe(-1)
    expect(itemEffectStatIndex(-1)).toBe(-1)
    expect(itemEffectStatIndex(5000)).toBe(-1)
    expect(itemEffectStatIndex(118.5)).toBe(-1)
    for (const [id, entry] of Object.entries(charMap)) {
      const stat = itemEffectStat(Number(id))
      expect(itemEffectStatIndex(Number(id)), `${id} (${entry.stat})`).toBe(stat ? STAT_INDEX[stat] : -1)
    }
  })
})
