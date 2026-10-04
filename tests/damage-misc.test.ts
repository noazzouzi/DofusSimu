/**
 * Formules hors dégâts directs : critiques, soins, érosion, réserve de vie, dégâts basés sur les PV, poussée,
 * retrait PA/PM, tacle (et intégration dans src/engine/move.ts), initiative, invocations, armure, renvoi.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Rng } from '../src/core/rng'
import { Element, emptyStats, type Stats } from '../src/core/types'
import type { DataStore } from '../src/data/store'
import {
  apMpAfterTackle,
  apMpRemovalDistribution,
  apMpRemovalProbability,
  applyDamageToPool,
  armorReduction,
  bestElement,
  capHeal,
  critChance,
  critProbability,
  erosion,
  erosionPercent,
  escapeRatio,
  expectedApMpRemoved,
  heal,
  healPercentMaxHp,
  hpBasedDamage,
  HP_BASED_DAMAGE_EFFECTS,
  hpReference,
  initiative,
  lifeSteal,
  midLifeMultiplier,
  pushDamage,
  reflectedDamage,
  reflectValue,
  rollApMpRemoval,
  roundHalfDown,
  roundHalfAwayFromZero,
  scaleSummonStats,
  scaleSummonValue,
  shieldFromLevel,
  shieldFromMaxHp,
  summonScaleFactor,
  tacklePath,
  tackleRatio,
  worstElement,
  type HpSnapshot,
} from '../src/damage'
import { Engine } from '../src/engine/engine'
import { move } from '../src/engine/move'
import type { Fighter } from '../src/engine/types'
import { neighbors } from '../src/map/geometry'

const stats = (patch: Partial<Stats>): Stats => ({ ...emptyStats(), ...patch })

describe('arrondis', () => {
  it('roundHalfDown : .5 vers le bas, jamais -0', () => {
    expect(roundHalfDown(1.5)).toBe(1)
    expect(roundHalfDown(1.51)).toBe(2)
    expect(roundHalfDown(2.4)).toBe(2)
    expect(roundHalfDown(-1.5)).toBe(-2)
    expect(Object.is(roundHalfDown(0.2), 0)).toBe(true)
  })
  it('roundHalfAwayFromZero', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3)
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3)
    expect(roundHalfAwayFromZero(2.49)).toBe(2)
  })
})

describe('critiques', () => {
  it('additif, plafond 100, taux de base nul ⇒ jamais', () => {
    expect(critChance(15, 35)).toBe(50)
    expect(critChance(25, 90)).toBe(100)
    expect(critChance(0, 80)).toBe(0)
    expect(critChance(10, -50)).toBe(0)
    expect(critProbability(15, 35)).toBe(0.5)
  })
  it('plancher de 1 % optionnel (patch 2.29), annulé par la Poisse', () => {
    expect(critChance(10, -50, { minChance: 1 })).toBe(1)
    expect(critChance(0, -50, { minChance: 1 })).toBe(0)
    expect(critChance(10, 50, { unlucky: true, minChance: 1 })).toBe(0)
    expect(critChance(10, 20, { spellCritBonus: 5 })).toBe(35)
  })
})

describe('soins', () => {
  const healer = stats({ intelligence: 400, chance: 100, heals: 50, weaponSkillPct: 20 })
  it('Intelligence par défaut, carac de l’élément en option (D3)', () => {
    expect(heal(20, healer)).toBe(150)
    expect(heal(20, healer, { element: Element.Water })).toBe(40 + 50)
  })
  it('options : arme, puissance sorts, soins finaux, efficacité de zone', () => {
    expect(heal(20, healer, { isWeapon: true })).toBe(Math.floor((20 * 520) / 100) + 50)
    expect(heal(20, healer, { spellPower: 100 })).toBe(Math.floor((20 * 600) / 100) + 50)
    expect(heal(20, healer, { finalHealPct: 10 })).toBe(165)
    expect(heal(20, healer, { efficiency: 0.9 })).toBe(135)
  })
  it('plafonnement aux PV manquants, vol de vie, soins en % des PV max, boucliers', () => {
    expect(capHeal(150, 900, 1000)).toBe(100)
    expect(capHeal(150, 1000, 1000)).toBe(0)
    expect(capHeal(50, 900, 1000)).toBe(50)
    expect(lifeSteal(457)).toBe(228)
    expect(lifeSteal(-10)).toBe(0)
    expect(healPercentMaxHp(3333, 10)).toBe(333)
    expect(shieldFromMaxHp(3333, 15)).toBe(499)
    expect(shieldFromLevel(200, 125)).toBe(250)
    expect(shieldFromLevel(199, 50)).toBe(100) // 99,5 arrondi loin de zéro
  })
})

describe('érosion et réserve de vie', () => {
  it('érosion : base 10, plafond 50, jamais mortelle si PV fournis', () => {
    expect(erosionPercent()).toBe(10)
    expect(erosionPercent(60)).toBe(50)
    expect(erosionPercent(-20)).toBe(0)
    expect(erosion(1000, 10)).toBe(100)
    expect(erosion(1000, 80)).toBe(500)
    expect(erosion(1000, 10, { currentHp: 40 })).toBe(39)
    expect(erosion(0, 10)).toBe(0)
  })
  it('bouclier puis PV, érosion sur la valeur totale, PV perdus bornés', () => {
    const r = applyDamageToPool({ health: 100, maxHealth: 3000, shield: 50, erosion: 10 }, 457)
    expect(r.absorbed).toBe(50)
    expect(r.lifeLost).toBe(407)
    expect(r.hpLost).toBe(100)
    expect(r.erodedMaxHp).toBe(45)
    expect(r.health).toBe(-307)
    expect(r.lastDamage).toBe(407)
  })
})

describe('dégâts basés sur les PV', () => {
  const defender = stats({ neutralRes: 20, neutralResPct: 25, spellResPct: 10 })
  const base = { percent: 10, referenceHp: 3000, defender, element: Element.Neutral as Element | -1, defenderIsPlayer: false }

  it('non boostés, résistances fixes puis %, multiplicateurs au choix', () => {
    expect(hpBasedDamage(base)).toBe(210) // 300 − 20 = 280 × 0,75
    expect(hpBasedDamage({ ...base, multipliers: 'received' })).toBe(189)
    const attacker = stats({ finalDamagePct: 10, spellDamagePct: 20, strength: 5000, damage: 500 })
    expect(hpBasedDamage({ ...base, multipliers: 'all', attacker })).toBe(249) // 231 → 277 → × 0,9
    expect(hpBasedDamage({ ...base, sustainedPct: 150 })).toBe(315)
    expect(hpBasedDamage({ ...base, mode: 'integer' })).toBe(210)
  })
  it('plafond joueur, critique, efficacité, sans résistance', () => {
    const tough = stats({ neutralRes: 20, neutralResPct: 80, criticalRes: 30 })
    expect(hpBasedDamage({ ...base, defender: tough, defenderIsPlayer: true })).toBe(140)
    expect(hpBasedDamage({ ...base, defender: tough, defenderIsPlayer: true, crit: true })).toBe(125)
    expect(hpBasedDamage({ ...base, efficiency: 0.5 })).toBe(97) // 150 − 20 = 130 × 0,75
    expect(hpBasedDamage({ ...base, ignoreResistances: true })).toBe(300)
    expect(hpBasedDamage({ ...base, element: -1 })).toBe(300)
    expect(hpBasedDamage({ ...base, referenceHp: 0 })).toBe(0)
  })
  it('PV de référence par source et multiplicateur « milieu de vie » (672)', () => {
    const s: HpSnapshot = { casterHp: 1500, casterMaxHp: 2800, casterBaseMaxHp: 3000, targetHp: 900, targetMaxHp: 1800, targetBaseMaxHp: 2000 }
    expect(hpReference('casterLife', s)).toBe(1500)
    expect(hpReference('casterMissingLife', s)).toBe(1300)
    expect(hpReference('casterErodedLife', s)).toBe(200)
    expect(hpReference('targetLife', s)).toBe(900)
    expect(hpReference('lifeLoss', s)).toBe(900)
    expect(hpReference('targetErodedLife', s)).toBe(200)
    expect(hpReference('casterMidLife', s)).toBeCloseTo(3000 * midLifeMultiplier(1500, 2800), 9)
    expect(midLifeMultiplier(50, 100)).toBe(1)
    expect(midLifeMultiplier(0, 100)).toBe(0)
    expect(midLifeMultiplier(100, 100)).toBe(0)
    expect(midLifeMultiplier(25, 100)).toBeCloseTo(0.25, 12)
  })
  it('table des effets cohérente avec DofusDB (/effects.elementId)', () => {
    const effects = JSON.parse(readFileSync(new URL('../data/dofusdb/effects.json', import.meta.url), 'utf8')) as { id: number; elementId: number }[]
    expect(HP_BASED_DAMAGE_EFFECTS.size).toBe(24)
    for (const [id, info] of HP_BASED_DAMAGE_EFFECTS) {
      const e = effects.find(x => x.id === id)
      expect(e, `effet ${id}`).toBeDefined()
      expect(info.element, `effet ${id}`).toBe(e!.elementId)
    }
    expect(HP_BASED_DAMAGE_EFFECTS.get(1096)).toMatchObject({ source: 'targetErodedLife', dofus2Multipliers: 'all' })
    expect(HP_BASED_DAMAGE_EFFECTS.get(1122)).toMatchObject({ source: 'casterErodedLife', dofus2Multipliers: 'received' })
    expect(HP_BASED_DAMAGE_EFFECTS.get(1048)).toMatchObject({ source: 'lifeLoss', ignoresResistances: true })
  })
})

describe('poussée', () => {
  const base = { casterLevel: 200, pushDamage: 0, pushRes: 0, remainingCells: 2 }
  it('direction cardinale ×2, chaîne de collision, bornes', () => {
    expect(pushDamage(base)).toBe(66)
    expect(pushDamage({ ...base, cardinal: true })).toBe(132)
    expect(pushDamage({ ...base, chainIndex: 1 })).toBe(33)
    expect(pushDamage({ ...base, remainingCells: 0 })).toBe(0)
    expect(pushDamage({ ...base, remainingCells: -1 })).toBe(0)
  })
  it('% dommages poussée et dommages subis (INCERTAINS)', () => {
    expect(pushDamage({ ...base, pushDamagePct: 50 })).toBe(99)
    expect(pushDamage({ ...base, sustainedPct: 50 })).toBe(33)
  })
  it('croissant avec la force et le bonus, décroissant avec les résistances et le rang', () => {
    for (let cells = 1; cells < 8; cells++) {
      expect(pushDamage({ ...base, remainingCells: cells + 1 })).toBeGreaterThanOrEqual(pushDamage({ ...base, remainingCells: cells }))
      expect(pushDamage({ ...base, remainingCells: cells, pushDamage: 30 })).toBeGreaterThanOrEqual(pushDamage({ ...base, remainingCells: cells }))
      expect(pushDamage({ ...base, remainingCells: cells, pushRes: 30 })).toBeLessThanOrEqual(pushDamage({ ...base, remainingCells: cells }))
      expect(pushDamage({ ...base, remainingCells: cells, chainIndex: 1 })).toBeLessThanOrEqual(pushDamage({ ...base, remainingCells: cells }))
    }
  })
})

describe('retrait PA/PM', () => {
  it('probabilité bornée [10 %, 90 %], 0 sans point restant, Retrait/Esquive ≥ 1', () => {
    expect(apMpRemovalProbability(1000, 1, 12, 12)).toBe(0.9)
    expect(apMpRemovalProbability(0, 1000, 12, 12)).toBe(0.1)
    expect(apMpRemovalProbability(100, 100, 12, 12, 12)).toBe(0)
    expect(apMpRemovalProbability(0, 0, 12, 12)).toBe(0.5) // 1/1 × 12/12 / 2
    expect(apMpRemovalProbability(100, 100, 6, 12, 2)).toBeCloseTo(4 / 12 / 2, 12)
  })
  it('tirage séquentiel avec un générateur injecté', () => {
    expect(rollApMpRemoval(100, 100, 6, 6, 4, () => 0)).toBe(4)
    expect(rollApMpRemoval(100, 100, 2, 6, 4, () => 0)).toBe(2) // pas plus que les points restants
    expect(rollApMpRemoval(1000, 1, 6, 6, 4, () => 0.95)).toBe(0) // p ≤ 90 %
    const seq = [0.4, 0.6, 0.1]
    let i = 0
    // p0 = 0,5 (0,4 < 0,5 ✓), p1 = 11/24 ≈ 0,458 (0,6 ✗), p2 = 11/24 (0,1 ✓)
    expect(rollApMpRemoval(100, 100, 12, 12, 3, () => seq[i++])).toBe(2)
  })
  it('Monte-Carlo cohérent avec la distribution exacte', () => {
    const rng = new Rng(2024)
    const n = 40000
    const counts = [0, 0, 0, 0, 0]
    for (let k = 0; k < n; k++) counts[rollApMpRemoval(90, 60, 6, 6, 4, () => rng.next())]++
    const exact = apMpRemovalDistribution(90, 60, 6, 6, 4)
    counts.forEach((c, k) => expect(Math.abs(c / n - exact[k])).toBeLessThan(0.01))
    expect(expectedApMpRemoved(90, 60, 6, 6, 4)).toBeCloseTo(2.48291015625, 12)
    expect(apMpRemovalDistribution(90, 60, 6, 6, 0)).toEqual([1])
  })
})

describe('tacle', () => {
  it('ratio par tacleur, produit, fuite/tacle négatifs ramenés à 0', () => {
    expect(tackleRatio(80, 80)).toBe(0.5)
    expect(tackleRatio(82, 40)).toBe(1)
    expect(tackleRatio(-20, 30)).toBe(2 / 64)
    expect(escapeRatio(60, [60, 60])).toBe(0.25)
    expect(escapeRatio(60, [])).toBe(1)
  })
  it('PA/PM restants : .5 vers le bas, points ≤ 0 inchangés', () => {
    expect(apMpAfterTackle(3, 0.5)).toBe(1)
    expect(apMpAfterTackle(11, 0.5)).toBe(5)
    expect(apMpAfterTackle(0, 0.5)).toBe(0)
    expect(apMpAfterTackle(-1, 0.5)).toBe(-1)
    expect(apMpAfterTackle(6, 1)).toBe(6)
  })
  it('chemin sans tacleur : seul le coût des pas', () => {
    expect(tacklePath(50, [], [[], [], []], 11, 6)).toEqual({
      perCell: [
        { remainingPercent: 1, ap: 11, mp: 6 },
        { remainingPercent: 1, ap: 11, mp: 5 },
        { remainingPercent: 1, ap: 11, mp: 4 },
      ],
      afterPath: { ap: 11, mp: 3 },
    })
  })

  it('intégration moteur : move() applique le tacle DoMath (vecteur domath-tackle-002)', () => {
    const data: DataStore = {
      spell: () => undefined,
      spellLevel: () => undefined,
      state: () => undefined,
      monster: () => undefined,
      breed: () => undefined,
      item: () => undefined,
      itemSet: () => undefined,
      map: () => undefined,
    }
    const map = { id: 1, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }
    const center = 14 * 20 + 7
    const [lockerCell, ...others] = neighbors(center)
    const dest = others.find(c => !neighbors(c).includes(lockerCell))!
    const fighter = (id: number, team: 0 | 1, cell: number, s: Stats): Fighter => ({
      id,
      team,
      kind: 'player',
      name: `F${id}`,
      level: 200,
      baseStats: s,
      stats: { ...s },
      hp: 1000,
      maxHp: 1000,
      baseMaxHp: 1000,
      shield: 0,
      ap: s.ap,
      mp: s.mp,
      cell,
      alive: true,
      states: [],
      buffs: [],
      spells: [],
      cooldowns: {},
      castsThisTurn: {},
      castsOnTarget: {},
      ai: 'none',
      direction: 1,
      tags: {},
    })
    const engine = new Engine(data)
    const fight = engine.createFight({
      map,
      fighters: [fighter(0, 0, center, stats({ ap: 12, mp: 6, tackleEvade: 50 })), fighter(1, 1, lockerCell, stats({ tackleBlock: 100 }))],
    })
    const mover = fight.fighters[0]
    expect(move(fight, mover, [center, dest], engine)).toBe(1)
    expect(mover.ap).toBe(3)
    expect(mover.mp).toBe(1)
    expect(fight.events).toContainEqual({ t: 'tackle', fighter: mover.id, apLost: 9, mpLost: 4 })
  })
})

describe('initiative, invocations, armure, renvoi, éléments', () => {
  it('initiative = somme des caracs + initiative, × PV / PV max', () => {
    const s = stats({ strength: 800, intelligence: 100, chance: 50, agility: 50, initiative: 500 })
    expect(initiative(s, 3000, 3000)).toBe(1500)
    expect(initiative(s, 1500, 3000)).toBe(750)
    expect(initiative(s, 1000, 3000)).toBe(500)
    expect(initiative(s, 5000, 3000)).toBe(1500)
    expect(initiative(s, 10, 0)).toBe(1500)
  })
  it('invocations : × (1 + niveau/100) sur PV et caractéristiques (INCERTAIN)', () => {
    expect(summonScaleFactor(200)).toBe(3)
    expect(scaleSummonValue(100, 200)).toBe(300)
    expect(scaleSummonValue(33, 150)).toBe(82)
    const src = { strength: 100, lifePoints: 500, ap: 6, earthResPct: 20 }
    const out = scaleSummonStats(src, 100)
    expect(out).toEqual({ strength: 200, lifePoints: 1000, ap: 6, earthResPct: 20 })
    expect(src.strength).toBe(100)
  })
  it('armure ×(1 + niveau/20), renvoi', () => {
    expect(armorReduction(12, 200)).toBe(132)
    expect(armorReduction(10, 1)).toBe(10)
    expect(reflectValue(30, 10, 20, 200)).toBe(30 + 10 + 220)
    expect(reflectedDamage(150, 100)).toBe(100)
    expect(reflectedDamage(80, 100)).toBe(80)
    expect(reflectedDamage(-5, 100)).toBe(0)
  })
  it('meilleur / pire élément : carac, puis dommages fixes, Terre par défaut', () => {
    expect(bestElement(emptyStats())).toBe(Element.Earth)
    expect(worstElement(emptyStats())).toBe(Element.Earth)
    expect(bestElement(stats({ intelligence: 500, agility: 400 }))).toBe(Element.Fire)
    expect(worstElement(stats({ strength: 300, intelligence: 500, chance: 400, agility: 200 }))).toBe(Element.Air)
    expect(bestElement(stats({ chance: 500, agility: 500, airDamage: 10 }))).toBe(Element.Air)
    expect(bestElement(stats({ strength: 500, neutralDamage: 10 }))).toBe(Element.Neutral)
  })
})
