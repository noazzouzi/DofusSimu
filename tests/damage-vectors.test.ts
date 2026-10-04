/**
 * Vecteurs de test de référence (data/research/damage-test-vectors.json) : CHAQUE cas est exécuté.
 * Les catégories `domath-*` proviennent du code DoMath exécuté tel quel, `client-*` des clients D2/D3.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Element, emptyStats, type ElementKey } from '../src/core/types'
import {
  apMpAfterTackle,
  apMpRemovalDistribution,
  apMpRemovalProbability,
  applyDamageToPool,
  areaEfficiency,
  capHeal,
  critChance,
  damageDistribution,
  damageRoll,
  decreasingCurve,
  distributionMean,
  domathDamageRoll,
  domathSpellMinMax,
  domathToDamageInput,
  effectiveResistPercent,
  erosion,
  erosionPercent,
  expectedDamage,
  explainDamage,
  heal,
  healLastDamage,
  lifeSteal,
  normalizeDomathStats,
  pushDamage,
  tackleLossDofus2,
  tacklePath,
  tackleRatio,
  tackleThresholds,
  type DamageInput,
  type DomathDamageLine,
  type DomathStatsInput,
  type LifePool,
} from '../src/damage'

// ───────────────────────────── chargement ─────────────────────────────

interface VectorCase {
  id: string
  category: string
  description: string
  fn: string
  input: unknown
  expected: unknown
}
interface VectorFile {
  meta: { caseCount: number }
  cases: VectorCase[]
  informative: { description: string; input: InformativeInput; expected: { domath: number; haxeOrderDouble: number } }[]
}

const FILE = JSON.parse(
  readFileSync(new URL('../data/research/damage-test-vectors.json', import.meta.url), 'utf8'),
) as VectorFile

/** Catégories connues -> nombre de cas traités (garde-fou : aucun vecteur ignoré). */
const HANDLED = new Map<string, number>()
function casesOf<I, E>(category: string): { c: VectorCase; input: I; expected: E }[] {
  const list = FILE.cases.filter(c => c.category === category)
  HANDLED.set(category, list.length)
  return list.map(c => ({ c, input: c.input as I, expected: c.expected as E }))
}
const title = (c: VectorCase) => `${c.id} — ${c.description}`

// ───────────────────────────── domath-damage ─────────────────────────────

describe('domath-damage : jet DoMath Rg', () => {
  type In = { stats: DomathStatsInput; baseDamage: number; element: ElementKey; isCritical: boolean }
  type Ex = { damage: number; integerSafeDamage?: number }
  const list = casesOf<In, Ex>('domath-damage')

  it('43 cas', () => expect(list.length).toBe(43))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      const { stats, baseDamage, element, isCritical } = input
      // Mode DoMath (flottants identiques) via l'adaptateur DoMath…
      expect(domathDamageRoll(stats, baseDamage, element, isCritical)).toBe(expected.damage)
      // … via l'API moteur (`damageRoll` sur un DamageInput équivalent) …
      const di = domathToDamageInput(normalizeDomathStats(stats), element, isCritical)
      expect(damageRoll(di, baseDamage)).toBe(expected.damage)
      // … et via l'explication pas à pas (dernière étape = résultat).
      const ex = explainDamage(di, baseDamage)
      expect(ex.damage).toBe(expected.damage)
      expect(ex.steps.at(-1)).toMatchObject({ id: 'result', value: expected.damage })
      // Mode entiers exacts : integerSafeDamage si DoMath diverge, sinon même valeur.
      const exact = expected.integerSafeDamage ?? expected.damage
      expect(domathDamageRoll(stats, baseDamage, element, isCritical, 'integer')).toBe(exact)
      expect(damageRoll({ ...di, mode: 'integer' }, baseDamage)).toBe(exact)
    })
  }
})

// ───────────────────────────── domath-spell ─────────────────────────────

describe('domath-spell : min/max par lancer et × compteur (Mg / jg / nx)', () => {
  type MinMax = { normal: { min: number; max: number }; crit: { min: number; max: number } }
  type In = { statsPartial: DomathStatsInput; damageLines: DomathDamageLine[]; counter: number }
  type Ex = { perCast: MinMax; totalWithCounter: MinMax }
  const list = casesOf<In, Ex>('domath-spell')

  it('3 cas', () => expect(list.length).toBe(3))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      expect(domathSpellMinMax(input.statsPartial, input.damageLines)).toEqual(expected.perCast)
      expect(domathSpellMinMax(input.statsPartial, input.damageLines, input.counter)).toEqual(expected.totalWithCounter)
    })
  }
})

// ───────────────────────────── domath-crit-chance ─────────────────────────────

describe('domath-crit-chance : chance de coup critique', () => {
  type In = { spellBaseCrit: number; statCrit: number }
  type Ex = { critChancePercent: number }
  const list = casesOf<In, Ex>('domath-crit-chance')

  it('4 cas', () => expect(list.length).toBe(4))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      expect(critChance(input.spellBaseCrit, input.statCrit)).toBe(expected.critChancePercent)
    })
  }
})

// ───────────────────────────── domath-distribution ─────────────────────────────

describe('domath-distribution : distribution exacte du worker DoMath', () => {
  type In = { statsPartial: DomathStatsInput; damageLines: DomathDamageLine[]; spellBaseCrit: number; counter: number }
  type Ex = {
    distribution: { value: number; probability: number }[]
    expectedDamage: number
    decreasingCurvePercent: { x: number; y: number }[]
  }
  const list = casesOf<In, Ex>('domath-distribution')

  it('2 cas', () => expect(list.length).toBe(2))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      const dist = damageDistribution([
        { stats: input.statsPartial, crit: input.spellBaseCrit, damageLines: input.damageLines, counter: input.counter },
      ])
      expect(dist.map(d => d.value)).toEqual(expected.distribution.map(d => d.value))
      dist.forEach((d, i) => expect(d.probability).toBeCloseTo(expected.distribution[i].probability, 10))
      expect(distributionMean(dist)).toBeCloseTo(expected.expectedDamage, 8)
      decreasingCurve(dist).forEach((pt, i) => {
        expect(pt.x).toBe(expected.decreasingCurvePercent[i].x)
        expect(pt.y).toBeCloseTo(expected.decreasingCurvePercent[i].y, 6)
      })

      // L'espérance de l'API moteur (somme des lignes × lancers) coïncide.
      const stats = normalizeDomathStats(input.statsPartial)
      const chance = critChance(input.spellBaseCrit, stats.crit)
      let perCast = 0
      for (const line of input.damageLines) {
        const normal = domathToDamageInput(stats, line.element, false)
        const crit = domathToDamageInput(stats, line.element, true)
        const r = line.baseDamage
        perCast += expectedDamage(normal, crit, { min: r.normal.min, max: r.normal.max, critMin: r.crit.min, critMax: r.crit.max }, chance)
      }
      expect(perCast * input.counter).toBeCloseTo(expected.expectedDamage, 8)
    })
  }
})

// ───────────────────────────── domath-tackle ─────────────────────────────

describe('domath-tackle : PA/PM restants par case (bk) et après chemin (Ek)', () => {
  type In = { lockers: number[]; dodge: number; ap: number; mp: number; composition: number[][] }
  type Ex = { perCell: { remainingPercent: number; ap: number; mp: number }[]; afterPath: { ap: number; mp: number } }
  const list = casesOf<In, Ex>('domath-tackle')

  it('9 cas', () => expect(list.length).toBe(9))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      const res = tacklePath(input.dodge, input.lockers, input.composition, input.ap, input.mp)
      expect(res.perCell).toEqual(expected.perCell)
      expect(res.afterPath).toEqual(expected.afterPath)
      // Première case : cohérence avec les primitives utilisées par le moteur.
      const firstLocks = input.composition[0].map(i => input.lockers[i])
      let ratio = 1
      for (const l of firstLocks) ratio *= tackleRatio(input.dodge, l)
      expect(ratio).toBe(expected.perCell[0].remainingPercent)
      expect(apMpAfterTackle(input.ap, ratio)).toBe(expected.perCell[0].ap)
      expect(apMpAfterTackle(input.mp, ratio)).toBe(expected.perCell[0].mp)
    })
  }
})

// ───────────────────────────── domath-tackle-min ─────────────────────────────

describe('domath-tackle-min : tableaux « Tacle min. » / « Fuite min. » (wk / xk)', () => {
  type In = { lockers: number[]; dodge: number; ap: number; mp: number; composition: number[][] }
  type Row = { target: string; value: number }
  type Ex = { minLockForRemainingAp: Row[]; minLockForRemainingMp: Row[]; minDodgeToKeepAp: Row[]; minDodgeToKeepMp: Row[] }
  const list = casesOf<In, Ex>('domath-tackle-min')

  it('2 cas', () => expect(list.length).toBe(2))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      const t = tackleThresholds(input.dodge, input.lockers, input.composition, input.ap, input.mp)
      const rows = (r: { remaining: number; value: number }[], unit: 'AP' | 'MP') =>
        r.map(x => ({ target: `${x.remaining} ${unit}`, value: x.value }))
      expect(rows(t.minLockForRemainingAp, 'AP')).toEqual(expected.minLockForRemainingAp)
      expect(rows(t.minLockForRemainingMp, 'MP')).toEqual(expected.minLockForRemainingMp)
      expect(rows(t.minDodgeToKeepAp, 'AP')).toEqual(expected.minDodgeToKeepAp)
      expect(rows(t.minDodgeToKeepMp, 'MP')).toEqual(expected.minDodgeToKeepMp)
    })
  }
})

// ───────────────────────────── domath-trap-apply ─────────────────────────────

describe('domath-trap-apply : bouclier, érosion, vol de vie, soin du dernier dégât', () => {
  const list = casesOf<Record<string, number> & { entity?: LifePool }, Record<string, number | null>>('domath-trap-apply')

  it('8 cas', () => expect(list.length).toBe(8))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      if (c.fn.startsWith('applyDamageToEntity')) {
        const r = applyDamageToPool(input.entity!, input.damage)
        expect({ lifeLost: r.lifeLost, health: r.health, maxHealth: r.maxHealth, shield: r.shield, lastDamage: r.lastDamage }).toEqual(expected)
        // Mode entiers : mêmes valeurs ici (pas d'artefact flottant sur ces cas).
        expect(applyDamageToPool(input.entity!, input.damage, 'integer').maxHealth).toBe(expected.maxHealth)
      } else if (c.fn.startsWith('lifeSteal')) {
        const healed = lifeSteal(input.lifeLostByTarget)
        expect(healed).toBe(expected.heal)
        expect(input.casterHealth + capHeal(healed, input.casterHealth, input.casterMaxHealth)).toBe(expected.casterHealthAfter)
      } else if (c.fn.startsWith('healLastDamage')) {
        expect(healLastDamage(input.percent, input.lastDamage)).toBe(expected.heal)
        expect(healLastDamage(input.percent, input.lastDamage, 'integer')).toBe(expected.heal)
      } else {
        throw new Error(`fonction inattendue : ${c.fn}`)
      }
    })
  }
})

// ───────────────────────────── client-push-damage ─────────────────────────────

describe('client-push-damage : dommages de poussée (D2 et D3)', () => {
  type In = { casterLevel: number; pushDamageBonus: number; targetPushResistance: number; remainingCells: number; collisionIndex: number }
  type Ex = { dofus2Client: number; dofus3Haxe: number }
  const list = casesOf<In, Ex>('client-push-damage')

  it('9 cas', () => expect(list.length).toBe(9))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      const base = {
        casterLevel: input.casterLevel,
        pushDamage: input.pushDamageBonus,
        pushRes: input.targetPushResistance,
        remainingCells: input.remainingCells,
        chainIndex: input.collisionIndex,
      }
      expect(pushDamage(base)).toBe(expected.dofus2Client)
      expect(pushDamage({ ...base, variant: 'dofus2' })).toBe(expected.dofus2Client)
      expect(pushDamage({ ...base, variant: 'dofus3' })).toBe(expected.dofus3Haxe)
    })
  }
})

// ───────────────────────────── client-ap-mp-removal ─────────────────────────────

describe('client-ap-mp-removal : distribution du nombre de points retirés', () => {
  type In = { retrait: number; esquive: number; currentPoints: number; maxPoints: number; attempted: number }
  type Ex = { firstPointProbability: number; distribution: Record<string, number>; expectedRemoved: number }
  const list = casesOf<In, Ex>('client-ap-mp-removal')

  it('6 cas', () => expect(list.length).toBe(6))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      const { retrait, esquive, currentPoints, maxPoints, attempted } = input
      expect(apMpRemovalProbability(retrait, esquive, currentPoints, maxPoints)).toBeCloseTo(expected.firstPointProbability, 12)
      const dist = apMpRemovalDistribution(retrait, esquive, currentPoints, maxPoints, attempted)
      for (let k = 0; k < dist.length; k++) {
        const e = expected.distribution[String(k)]
        if (e === undefined) expect(dist[k]).toBe(0)
        else expect(dist[k]).toBeCloseTo(e, 11)
      }
      let mean = 0
      dist.forEach((p, k) => (mean += k * p))
      expect(mean).toBeCloseTo(expected.expectedRemoved, 11)
    })
  }
})

// ───────────────────────────── client-heal ─────────────────────────────

describe('client-heal : soin (client D2 getHeal)', () => {
  type In = { baseHeal: number; intelligence: number; healBonus: number }
  const list = casesOf<In, { heal: number }>('client-heal')

  it('4 cas', () => expect(list.length).toBe(4))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      const healer = { ...emptyStats(), intelligence: input.intelligence, heals: input.healBonus }
      expect(heal(input.baseHeal, healer)).toBe(expected.heal)
    })
  }
})

// ───────────────────────────── client-area-efficiency ─────────────────────────────

describe('client-area-efficiency : dégressivité de zone', () => {
  type In = { distance: number; minRadius: number; degressionPercent: number; maxTicks: number }
  const list = casesOf<In, { efficiency: number }>('client-area-efficiency')

  it('5 cas', () => expect(list.length).toBe(5))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      expect(areaEfficiency(input.distance, input.minRadius, input.degressionPercent, input.maxTicks)).toBe(expected.efficiency)
    })
  }
})

// ───────────────────────────── client-misc ─────────────────────────────

describe('client-misc : plafonds de résistance, érosion, arrondis du tacle', () => {
  const list = casesOf<Record<string, unknown>, Record<string, unknown>>('client-misc')

  it('4 cas', () => expect(list.length).toBe(4))

  for (const { c, input, expected } of list) {
    it(title(c), () => {
      if (c.fn.startsWith('effectiveResistPercent')) {
        const cases = input.cases as [number, boolean][]
        const ex = expected as { values: number[]; dofus2ClientValues: number[] }
        expect(cases.map(([r, isMonster]) => effectiveResistPercent(r, !isMonster))).toEqual(ex.values)
        expect(cases.map(([r, isMonster]) => effectiveResistPercent(r, !isMonster, Infinity))).toEqual(ex.dofus2ClientValues)
      } else if (c.fn.startsWith('erosionPercent')) {
        const cases = input.cases as [number, number][]
        const ex = expected as { values: { erosionPercent: number; maxHpLost: number }[] }
        cases.forEach(([bonus, dmg], i) => {
          const e = erosionPercent(bonus)
          expect(e).toBe(ex.values[i].erosionPercent)
          expect(erosion(dmg, e)).toBe(ex.values[i].maxHpLost)
          expect(erosion(dmg, e, { mode: 'integer' })).toBe(ex.values[i].maxHpLost)
        })
      } else if (c.fn.startsWith('officialTackleLoss')) {
        const cases = input.cases as [number, number][]
        const ex = expected as { values: { lost: number; remainingDomath: number }[] }
        cases.forEach(([mp, p], i) => {
          expect(tackleLossDofus2(mp, p)).toBe(ex.values[i].lost)
          expect(apMpAfterTackle(mp, p)).toBe(ex.values[i].remainingDomath)
          expect(apMpAfterTackle(mp, p, 'dofus2')).toBe(mp - ex.values[i].lost)
        })
      } else if (c.fn.startsWith('tackleTieCase')) {
        const { dodge, lock, mp } = input as { dodge: number; lock: number; mp: number }
        const ex = expected as { remainingDomath: number; remainingDofus2Client: number }
        const ratio = tackleRatio(dodge, lock)
        expect(apMpAfterTackle(mp, ratio)).toBe(ex.remainingDomath)
        expect(apMpAfterTackle(mp, ratio, 'dofus2')).toBe(ex.remainingDofus2Client)
      } else {
        throw new Error(`fonction inattendue : ${c.fn}`)
      }
    })
  }
})

// ───────────────────────────── informatif : ordre Dofus 3 ─────────────────────────────

interface InformativeInput {
  base: number
  stat: number
  power: number
  flat: number
  elemFlat: number
  critFlat: number
  isCrit: boolean
  fixedRes: number
  critRes: number
  pctRes: number
  dealtSpells: number
  dealtRange: number
  recvSpells: number
  recvRange: number
  dealtFinal: number
  recvMult: number
}

function informativeInput(o: InformativeInput): DamageInput {
  const attacker = { ...emptyStats(), strength: o.stat, power: o.power, damage: o.flat, earthDamage: o.elemFlat, criticalDamage: o.critFlat }
  attacker.spellDamagePct = o.dealtSpells - 100
  attacker.rangedDamagePct = o.dealtRange - 100
  attacker.finalDamagePct = o.dealtFinal - 100
  const defender = { ...emptyStats(), earthRes: o.fixedRes, criticalRes: o.critRes, earthResPct: o.pctRes }
  defender.spellResPct = 100 - o.recvSpells
  defender.rangedResPct = 100 - o.recvRange
  return {
    attacker,
    defender,
    element: Element.Earth,
    crit: o.isCrit,
    isWeapon: false,
    isMelee: false,
    defenderIsPlayer: false,
    sustainedPct: o.recvMult,
  }
}

describe('informatif : ordre DoMath vs ordre du module Haxe de Dofus 3', () => {
  for (const v of FILE.informative) {
    it(`${v.description} (jet ${v.input.base}${v.input.isCrit ? ', CC' : ''})`, () => {
      const input = informativeInput(v.input)
      expect(damageRoll(input, v.input.base)).toBe(v.expected.domath)
      expect(damageRoll({ ...input, order: 'dofus3' }, v.input.base)).toBe(v.expected.haxeOrderDouble)
      expect(damageRoll({ ...input, order: 'dofus3', mode: 'integer' }, v.input.base)).toBe(v.expected.haxeOrderDouble)
    })
  }
})

// ───────────────────────────── garde-fou ─────────────────────────────

describe('couverture des vecteurs', () => {
  it('toutes les catégories sont traitées et les 99 cas exécutés', () => {
    const categories = new Set(FILE.cases.map(c => c.category))
    for (const cat of categories) expect(HANDLED.has(cat), `catégorie non testée : ${cat}`).toBe(true)
    let total = 0
    for (const n of HANDLED.values()) total += n
    expect(total).toBe(FILE.cases.length)
    expect(total).toBe(FILE.meta.caseCount)
  })
})
