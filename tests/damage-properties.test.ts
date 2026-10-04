/**
 * Propriétés du pipeline de dégâts : équivalence avec une copie littérale de DoMath `Rg`, référence entière
 * exacte (BigInt), monotonies, plafonds de résistance, critique ≥ normal, espérance, explication, non-mutation.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '../src/core/rng'
import { Element, ELEMENT_KEYS, ELEMENTS, emptyStats, type ElementKey, type Stats } from '../src/core/types'
import {
  createPreparedDamage,
  damageRange,
  damageRoll,
  domathDamageRoll,
  domathToDamageInput,
  expectedDamage,
  explainDamage,
  meanPrepared,
  normalizeDomathStats,
  prepareDamage,
  rollPrepared,
  type DamageInput,
  type DomathStats,
} from '../src/damage'

// ───────────────────────────── copie littérale de DoMath (main.e2dd4684.js, fn Rg) ─────────────────────────────

function literalRg(e: DomathStats, t: number, n: ElementKey, a: boolean): number {
  const carac = (el: ElementKey): 'strength' | 'intelligence' | 'luck' | 'agility' =>
    el === 'fire' ? 'intelligence' : el === 'water' ? 'luck' : el === 'air' ? 'agility' : 'strength'
  let r = 0
  const i = 1 - e.areaDistance * (e.hit.type === 'spell' ? 0.1 : 0.25)
  const o = 1 + (e.portal.type === 'normal' && e.portal.redirection > 0 ? 0 + 0.02 * e.portal.redirection : 0)
  if (t === 0) return 0
  r += t + (t * Math.max(0, e.power + e[carac(n)])) / 100
  r = Math.trunc(r)
  if ((r += e.damages.fixed[n] + e.damages.fixed.damages + (a ? e.damages.fixed.critical : 0)) < 0) return 0
  r *= i
  r *= o
  r = Math.trunc(r)
  if ((r -= e.resistances.fixed[n] + (a ? e.resistances.fixed.critical : 0)) < 0) return 0
  r *= 1 - e.resistances.percentage[n] / 100
  r = Math.trunc(r)
  r *= e.damages.percentage.sustained
  r = Math.trunc(r / 100)
  r *= 100 + e.damages.percentage.final
  r = Math.trunc(r / 100)
  r *= 100 + e.damages.percentage[e.hit.type]
  r = Math.trunc(r / 100)
  r *= 100 + e.damages.percentage[e.hit.distance]
  r = Math.trunc(r / 100)
  r *= 1 - e.resistances.percentage[e.hit.type] / 100
  r *= 1 - e.resistances.percentage[e.hit.distance] / 100
  r = Math.trunc(r)
  return r
}

/** Même pipeline en rationnels exacts (BigInt) : référence du mode `integer`. */
function exactRg(e: DomathStats, base: number, n: ElementKey, crit: boolean): number {
  const B = BigInt
  const carac = n === 'fire' ? e.intelligence : n === 'water' ? e.luck : n === 'air' ? e.agility : e.strength
  if (base === 0) return 0
  const div = (x: bigint, y: bigint) => x / y // BigInt : division tronquée vers 0
  let r = div(B(base) * B(100 + Math.max(0, e.power + carac)), 100n)
  r += B(e.damages.fixed[n] + e.damages.fixed.damages + (crit ? e.damages.fixed.critical : 0))
  if (r < 0n) return 0
  const step = e.hit.type === 'spell' ? 10 : 25
  const area = Math.max(0, 100 - e.areaDistance * step)
  const portal = 100 + (e.portal.type === 'normal' && e.portal.redirection > 0 ? 2 * e.portal.redirection : 0)
  r = div(r * B(area) * B(portal), 10000n)
  r -= B(e.resistances.fixed[n] + (crit ? e.resistances.fixed.critical : 0))
  if (r < 0n) return 0
  r = div(r * B(100 - e.resistances.percentage[n]), 100n)
  r = div(r * B(e.damages.percentage.sustained), 100n)
  r = div(r * B(100 + e.damages.percentage.final), 100n)
  r = div(r * B(100 + e.damages.percentage[e.hit.type]), 100n)
  r = div(r * B(100 + e.damages.percentage[e.hit.distance]), 100n)
  r = div(r * B(100 - e.resistances.percentage[e.hit.type]) * B(100 - e.resistances.percentage[e.hit.distance]), 10000n)
  return r > 0n ? Number(r) : 0
}

// ───────────────────────────── générateurs aléatoires (déterministes) ─────────────────────────────

function randomDomathStats(rng: Rng): DomathStats {
  const i = (a: number, b: number) => rng.int(a, b)
  return normalizeDomathStats({
    power: i(-100, 400),
    strength: i(-100, 1500),
    intelligence: i(-100, 1500),
    luck: i(-100, 1500),
    agility: i(-100, 1500),
    damages: {
      fixed: { damages: i(-50, 200), neutral: i(0, 80), earth: i(0, 80), fire: i(0, 80), water: i(0, 80), air: i(0, 80), critical: i(0, 150) },
      percentage: { sustained: rng.chance(0.7) ? 100 : i(50, 200), final: i(-30, 40), spell: i(-20, 40), weapon: i(-20, 40), range: i(-20, 30), melee: i(-20, 30) },
    },
    resistances: {
      fixed: { neutral: i(-20, 60), earth: i(-20, 60), fire: i(-20, 60), water: i(-20, 60), air: i(-20, 60), critical: i(-10, 80) },
      percentage: {
        neutral: i(-50, 100),
        earth: i(-50, 100),
        fire: i(-50, 100),
        water: i(-50, 100),
        air: i(-50, 100),
        spell: i(-20, 40),
        weapon: i(-20, 40),
        range: i(-20, 40),
        melee: i(-20, 40),
      },
    },
    hit: { type: rng.chance(0.75) ? 'spell' : 'weapon', distance: rng.chance(0.6) ? 'range' : 'melee' },
    areaDistance: rng.chance(0.5) ? 0 : i(0, 3),
    portal: { type: rng.chance(0.8) ? 'none' : 'normal', redirection: i(0, 20) },
  })
}

function randomInput(rng: Rng): DamageInput {
  const s = randomDomathStats(rng)
  const el = rng.pick(ELEMENTS)
  return {
    ...domathToDamageInput(s, el, rng.chance(0.3)),
    defenderIsPlayer: rng.chance(0.5),
    monsterResCap: undefined,
  }
}

/**
 * Stats DoMath tirées sur tout le domaine de saisie de l'interface (bornes `ss`, main.e2dd4684.js l.24400),
 * sauf puissance/caracs limitées à 3000 (l'interface accepte 999 999). `area` = bornes de la distance au centre.
 */
function uiDomainStats(rng: Rng, weapon: boolean, area: [number, number]): DomathStats {
  const i = (a: number, b: number) => rng.int(a, b)
  const fixed = () => i(-999, 999)
  return normalizeDomathStats({
    power: i(-500, 3000),
    strength: i(-500, 3000),
    intelligence: i(-500, 3000),
    luck: i(-500, 3000),
    agility: i(-500, 3000),
    damages: {
      fixed: { damages: fixed(), neutral: fixed(), earth: fixed(), fire: fixed(), water: fixed(), air: fixed(), critical: fixed() },
      percentage: { sustained: rng.chance(0.5) ? 100 : i(0, 9999), final: i(-100, 9999), spell: i(-100, 999), weapon: i(-100, 999), range: i(-100, 999), melee: i(-100, 999) },
    },
    resistances: {
      fixed: { neutral: fixed(), earth: fixed(), fire: fixed(), water: fixed(), air: fixed(), critical: fixed() },
      percentage: {
        neutral: i(-9999, 100),
        earth: i(-9999, 100),
        fire: i(-9999, 100),
        water: i(-9999, 100),
        air: i(-9999, 100),
        spell: i(-999, 100),
        weapon: i(-999, 100),
        range: i(-999, 100),
        melee: i(-999, 100),
      },
    },
    hit: { type: weapon ? 'weapon' : 'spell', distance: rng.chance(0.5) ? 'range' : 'melee' },
    areaDistance: i(area[0], area[1]),
    portal: { type: rng.chance(0.5) ? 'none' : 'normal', redirection: i(0, 999) },
  })
}

const MAIN_STAT = ['strength', 'strength', 'intelligence', 'chance', 'agility'] as const
const FIXED_DAMAGE = ['neutralDamage', 'earthDamage', 'fireDamage', 'waterDamage', 'airDamage'] as const
const FIXED_RES = ['neutralRes', 'earthRes', 'fireRes', 'waterRes', 'airRes'] as const
const RES_PCT = ['neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct'] as const

/**
 * Ordre du module Haxe de Dofus 3 (formulas.md §3.5) en rationnels exacts, écrit indépendamment de src/damage :
 * étapes (1)-(5) communes, puis sorts|armes, distance|mêlée, reçus sorts|armes, reçus distance|mêlée, finaux,
 * subis — une troncature par facteur. Couvre les options d'entrée utilisées par `randomInput`.
 */
function exactHaxeOrder(input: DamageInput, roll: number): number {
  const B = BigInt
  const a = input.attacker
  const d = input.defender
  const el = input.element
  const { crit, isWeapon: weapon, isMelee: melee } = input
  const base = roll + (input.baseDamageBonus ?? 0) + (crit && weapon ? (input.weaponCritBonus ?? 0) : 0)
  if (base <= 0) return 0
  const power = Math.max(0, a.power + a[MAIN_STAT[el]] + (weapon ? (input.weaponPower ?? 0) : (input.spellPower ?? 0)))
  let r = (B(base) * B(100 + power)) / 100n
  r += B(a[FIXED_DAMAGE[el]] + a.damage + (crit ? a.criticalDamage : 0))
  if (r < 0n) return 0
  if (weapon) r = (r * B(100 + (input.weaponSkillPct ?? a.weaponSkillPct))) / 100n
  const area = Math.max(0, 100 - (input.areaSteps ?? 0) * (input.areaStepPct ?? (weapon ? 25 : 10)))
  r = (r * B(area) * B(100 + 2 * (input.portalCells ?? 0))) / 10000n
  r -= B(d[FIXED_RES[el]] + (crit ? d.criticalRes : 0) + (input.armorReduction ?? 0))
  if (r < 0n) return 0
  const res = Math.min(d[RES_PCT[el]], input.defenderIsPlayer ? 50 : (input.monsterResCap ?? 100))
  r = (r * B(100 - res)) / 100n
  if (r < 0n) r = 0n
  const factors = [
    100 + (weapon ? a.weaponDamagePct : a.spellDamagePct),
    100 + (melee ? a.meleeDamagePct : a.rangedDamagePct),
    100 - (weapon ? d.weaponResPct : d.spellResPct),
    100 - (melee ? d.meleeResPct : d.rangedResPct),
    100 + a.finalDamagePct,
    input.sustainedPct ?? 100,
  ]
  for (const m of factors) r = (r * B(m)) / 100n
  return r > 0n ? Number(r) : 0
}

const withStat = (s: Stats, patch: Partial<Stats>): Stats => ({ ...s, ...patch })

// ───────────────────────────── équivalences ─────────────────────────────

describe('équivalence avec DoMath et avec l’arithmétique exacte', () => {
  it('mode domath = copie littérale de Rg sur 20 000 tirages aléatoires', () => {
    const rng = new Rng(1234)
    for (let k = 0; k < 20000; k++) {
      const s = randomDomathStats(rng)
      const el = rng.pick(ELEMENT_KEYS)
      const crit = rng.chance(0.3)
      const base = rng.int(0, 120)
      const expected = Math.max(0, literalRg(s, base, el, crit))
      expect(domathDamageRoll(s, base, el, crit)).toBe(expected === 0 ? 0 : expected)
    }
  })

  it('mode integer = référence rationnelle exacte (BigInt) sur 20 000 tirages', () => {
    const rng = new Rng(98765)
    for (let k = 0; k < 20000; k++) {
      const s = randomDomathStats(rng)
      const el = rng.pick(ELEMENT_KEYS)
      const crit = rng.chance(0.3)
      const base = rng.int(0, 120)
      expect(domathDamageRoll(s, base, el, crit, 'integer')).toBe(exactRg(s, base, el, crit))
    }
  })

  it('les deux modes ne diffèrent que par des artefacts flottants (écart faible, rare)', () => {
    const rng = new Rng(42)
    let diffs = 0
    const n = 20000
    for (let k = 0; k < n; k++) {
      const input = randomInput(rng)
      const base = rng.int(1, 100)
      const a = damageRoll(input, base)
      const b = damageRoll({ ...input, mode: 'integer' }, base)
      if (a !== b) diffs++
      expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(3, Math.ceil(b * 0.02)))
    }
    expect(diffs / n).toBeLessThan(0.1)
  })

  it('mode domath = Rg sur tout le domaine saisissable de DoMath (bornes `ss`), jets entiers et « moyens » (x,5)', () => {
    const rng = new Rng(31337)
    for (let k = 0; k < 20000; k++) {
      const weapon = rng.chance(0.4)
      const s = uiDomainStats(rng, weapon, weapon ? [0, 4] : [0, 9])
      const el = rng.pick(ELEMENT_KEYS)
      const crit = rng.chance(0.5)
      // Mode « dégâts moyens » du simulateur de pièges : jet (min + max) / 2 non arrondi (vecteur domath-damage-043).
      const base = rng.chance(0.15) ? rng.int(0, 200) + 0.5 : rng.int(0, 300)
      const expected = Math.max(0, literalRg(s, base, el, crit))
      expect(domathDamageRoll(s, base, el, crit)).toBe(expected === 0 ? 0 : expected)
    }
  })

  it('écart documenté : arme à 5..9 cases du centre (facteur DoMath négatif) — facteur de zone borné à 0', () => {
    const rng = new Rng(2718)
    let divergent = 0
    for (let k = 0; k < 5000; k++) {
      const s = uiDomainStats(rng, true, [5, 9])
      const el = rng.pick(ELEMENT_KEYS)
      const crit = rng.chance(0.5)
      const base = rng.int(1, 300)
      const ours = domathDamageRoll(s, base, el, crit)
      // Toujours le dégât d'une efficacité nulle…
      expect(ours).toBe(damageRoll({ ...domathToDamageInput(s, el, crit), efficiency: 0 }, base))
      // … identique à DoMath dès que les résistances fixes soustraites sont ≥ 0 (cas réel).
      const fixedRes = s.resistances.fixed[el] + (crit ? s.resistances.fixed.critical : 0)
      const literal = Math.max(0, literalRg(s, base, el, crit))
      if (fixedRes >= 0) expect(ours).toBe(literal === 0 ? 0 : literal)
      else if (ours !== literal) divergent++
    }
    expect(divergent).toBeGreaterThan(0) // l'écart existe bien (rés. fixes négatives), il est voulu
  })

  it('ordre Dofus 3 (mode integer) = référence rationnelle exacte (BigInt) de formulas.md §3.5', () => {
    const rng = new Rng(1618)
    for (let k = 0; k < 10000; k++) {
      const input = randomInput(rng)
      input.order = 'dofus3'
      input.mode = 'integer'
      if (rng.chance(0.3)) input.weaponSkillPct = rng.int(-10, 40)
      if (rng.chance(0.3)) input.armorReduction = rng.int(0, 120)
      const base = rng.int(0, 120)
      expect(damageRoll(input, base)).toBe(exactHaxeOrder(input, base))
    }
  })

  it('artefacts documentés (formulas.md §3.4) : zone, %rés, portail', () => {
    // r = 90, distance 3 : 90 × 0.7 = 62.99999999999999 → 62 (63 en entiers)
    expect(domathDamageRoll({ areaDistance: 3, damages: { fixed: { damages: 70 } } }, 20, 'earth', false)).toBe(62)
    expect(domathDamageRoll({ areaDistance: 3, damages: { fixed: { damages: 70 } } }, 20, 'earth', false, 'integer')).toBe(63)
    // r = 10, rés 80 % : 10 × 0.19999999999999996 → 1 (2 en entiers)
    expect(domathDamageRoll({ resistances: { percentage: { earth: 80 } } }, 10, 'earth', false)).toBe(1)
    expect(domathDamageRoll({ resistances: { percentage: { earth: 80 } } }, 10, 'earth', false, 'integer')).toBe(2)
    // r = 25, redirection 8 : 25 × 1.16 = 28.999999999999996 → 28 (29 en entiers)
    expect(domathDamageRoll({ portal: { type: 'normal', redirection: 8 } }, 25, 'earth', false)).toBe(28)
    expect(domathDamageRoll({ portal: { type: 'normal', redirection: 8 } }, 25, 'earth', false, 'integer')).toBe(29)
  })
})

// ───────────────────────────── monotonies ─────────────────────────────

describe('monotonies', () => {
  const rng = new Rng(7)
  const inputs = Array.from({ length: 300 }, () => randomInput(rng))

  it('croissant avec le jet de base (tous modes, tous ordres)', () => {
    for (const input of inputs) {
      for (const variant of [input, { ...input, mode: 'integer' as const }, { ...input, order: 'dofus3' as const }]) {
        const p = prepareDamage(variant)
        let prev = 0
        for (let r = 0; r <= 80; r++) {
          const v = rollPrepared(p, r)
          expect(v).toBeGreaterThanOrEqual(prev)
          prev = v
        }
      }
    }
  })

  it('croissant avec la carac, la puissance, les dommages fixes et les % de dommages du lanceur', () => {
    const keys = ['power', 'damage', 'finalDamagePct', 'spellDamagePct', 'weaponDamagePct', 'meleeDamagePct', 'rangedDamagePct', 'criticalDamage'] as const
    for (const input of inputs) {
      const main = (['strength', 'strength', 'intelligence', 'chance', 'agility'] as const)[input.element]
      for (const key of [...keys, main]) {
        for (const base of [1, 17, 45]) {
          const lo = damageRoll(input, base)
          const hi = damageRoll({ ...input, attacker: withStat(input.attacker, { [key]: input.attacker[key] + 37 }) }, base)
          expect(hi, key).toBeGreaterThanOrEqual(lo)
        }
      }
    }
  })

  it('décroissant avec les résistances de la cible', () => {
    const resKeys = ['earthRes', 'fireRes', 'waterRes', 'airRes', 'neutralRes', 'criticalRes', 'spellResPct', 'weaponResPct', 'meleeResPct', 'rangedResPct'] as const
    const pctKeys = ['neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct'] as const
    for (const input of inputs) {
      for (const key of [...resKeys, pctKeys[input.element]]) {
        for (const base of [3, 30]) {
          const lo = damageRoll(input, base)
          const hi = damageRoll({ ...input, defender: withStat(input.defender, { [key]: input.defender[key] + 11 }) }, base)
          expect(hi, key).toBeLessThanOrEqual(lo)
        }
      }
    }
  })

  it('décroissant avec la distance au centre de la zone, croissant avec la redirection de portail', () => {
    for (const input of inputs) {
      let prev = Infinity
      for (let d = 0; d <= 12; d++) {
        const v = damageRoll({ ...input, areaSteps: d }, 40)
        expect(v).toBeLessThanOrEqual(prev)
        prev = v
      }
      // Efficacité bornée à 0 (une résistance fixe négative ajoute encore des dégâts ensuite).
      expect(damageRoll({ ...input, areaSteps: 20 }, 40)).toBe(damageRoll({ ...input, efficiency: 0 }, 40))
      expect(damageRoll({ ...input, areaSteps: 30 }, 40)).toBe(damageRoll({ ...input, areaSteps: 20 }, 40))
      if (prepareDamage(input).fixedRes >= 0) {
        expect(damageRoll({ ...input, areaSteps: 20 }, 40)).toBe(0)
      }
      expect(damageRoll({ ...input, portalCells: 5 }, 40)).toBeGreaterThanOrEqual(damageRoll({ ...input, portalCells: 0 }, 40))
    }
  })
})

// ───────────────────────────── résistances, critiques, bornes ─────────────────────────────

describe('plafonds de résistance et bornes', () => {
  const attacker = { ...emptyStats(), strength: 800, power: 100, damage: 50 }
  const base = (defender: Stats, defenderIsPlayer: boolean): DamageInput => ({
    attacker,
    defender,
    element: Element.Earth,
    crit: false,
    isWeapon: false,
    isMelee: false,
    defenderIsPlayer,
  })

  it('joueur : % résistance élémentaire plafonné à 50', () => {
    const at50 = damageRoll(base({ ...emptyStats(), earthResPct: 50 }, true), 30)
    expect(damageRoll(base({ ...emptyStats(), earthResPct: 80 }, true), 30)).toBe(at50)
    expect(damageRoll(base({ ...emptyStats(), earthResPct: 80 }, false), 30)).toBeLessThan(at50)
  })

  it('monstre : plafond 100 (0 dégât), sans plafond si monsterResCap = Infinity (résultat borné à 0)', () => {
    expect(damageRoll(base({ ...emptyStats(), earthResPct: 100 }, false), 30)).toBe(0)
    expect(damageRoll(base({ ...emptyStats(), earthResPct: 150 }, false), 30)).toBe(0)
    expect(damageRoll({ ...base({ ...emptyStats(), earthResPct: 150 }, false), monsterResCap: Infinity }, 30)).toBe(0)
  })

  it('« % Résistance » à tous les éléments (101) : ajoutée AVANT le plafond, visible dans l’explication', () => {
    const at = (earthResPct: number, isPlayer: boolean, allResPct?: number) =>
      damageRoll({ ...base({ ...emptyStats(), earthResPct }, isPlayer), allResPct }, 30)
    expect(at(40, true, 20)).toBe(at(50, true)) // 60 plafonné à 50
    expect(at(40, true, 5)).toBe(at(45, true))
    expect(at(40, false, 20)).toBe(at(60, false))
    expect(at(90, false, 30)).toBe(0) // 120 plafonné à 100 (monstre)
    expect(at(-20, true, -10)).toBe(at(-30, true)) // pas de plancher
    const ex = explainDamage({ ...base({ ...emptyStats(), earthResPct: 40 }, true), allResPct: 20 }, 30)
    expect(ex.params.rawResPct).toBe(60)
    expect(ex.params.resPct).toBe(50)
    expect(ex.steps.find(s => s.id === 'percentRes')!.label).toContain('brut 60 %')
  })

  it('élément non résolu (meilleur / pire / aucun) : erreur explicite au lieu de 0 dégât silencieux', () => {
    for (const el of [-1, 5, 6, 7, 1.5]) {
      const input = { ...base(emptyStats(), false), element: el as Element }
      expect(() => damageRoll(input, 30), `élément ${el}`).toThrow(RangeError)
      expect(() => explainDamage(input, 30)).toThrow(RangeError)
      expect(() => expectedDamage(input, null, { min: 1, max: 2 }, 50)).toThrow(RangeError)
    }
  })

  it('pas de plancher : une résistance négative augmente les dégâts, sans plafond pour % sorts/distance', () => {
    const neutral = damageRoll(base(emptyStats(), true), 30)
    expect(damageRoll(base({ ...emptyStats(), earthResPct: -50 }, true), 30)).toBeGreaterThan(neutral)
    // % rés. sorts non plafonnées à 50 pour un joueur
    expect(damageRoll(base({ ...emptyStats(), spellResPct: 80 }, true), 30)).toBeLessThan(damageRoll(base({ ...emptyStats(), spellResPct: 50 }, true), 30))
  })

  it('les résultats ne sont jamais négatifs ni -0, et 0 pour un jet nul', () => {
    const rng = new Rng(99)
    for (let k = 0; k < 5000; k++) {
      const input = randomInput(rng)
      input.defender.spellResPct = rng.int(-50, 250)
      input.monsterResCap = Infinity
      const v = damageRoll(input, rng.int(-5, 60))
      expect(v >= 0 && !Object.is(v, -0)).toBe(true)
      expect(damageRoll(input, 0)).toBe(0)
    }
  })

  it('critique ≥ normal à jet égal quand la cible n’a pas de résistance critique', () => {
    const rng = new Rng(5)
    for (let k = 0; k < 3000; k++) {
      const input = randomInput(rng)
      input.defender.criticalRes = 0
      const r = rng.int(1, 60)
      const normal = damageRoll({ ...input, crit: false }, r)
      const crit = damageRoll({ ...input, crit: true }, r)
      expect(crit).toBeGreaterThanOrEqual(normal)
      // jets critiques plus élevés ⇒ encore plus de dégâts
      expect(damageRoll({ ...input, crit: true }, r + 5)).toBeGreaterThanOrEqual(crit)
    }
  })

  it('arme : dégressivité 25 %/case par défaut, maîtrise d’arme et bonus critique d’arme', () => {
    const w: DamageInput = { ...base(emptyStats(), false), isWeapon: true }
    expect(damageRoll({ ...w, areaSteps: 1 }, 30)).toBe(Math.trunc(Math.trunc((30 * 1000) / 100 + 50) * 0.75))
    expect(damageRoll({ ...w, weaponSkillPct: 20 }, 30)).toBe(Math.trunc((350 * 120) / 100))
    expect(damageRoll({ ...w, attacker: { ...attacker, weaponSkillPct: 20 } }, 30)).toBe(420)
    // la maîtrise d'arme ne s'applique pas aux sorts
    expect(damageRoll({ ...base(emptyStats(), false), weaponSkillPct: 20 }, 30)).toBe(350)
    // bonus critique d'arme : ajouté au jet en cas de CC seulement
    expect(damageRoll({ ...w, crit: true, weaponCritBonus: 5 }, 30)).toBe(Math.trunc((35 * 1000) / 100) + 50)
    expect(damageRoll({ ...w, weaponCritBonus: 5 }, 30)).toBe(350)
  })

  it('options additives : puissance sorts/armes, pièges, bonus de jet, armure, dommages subis', () => {
    const s = base(emptyStats(), false)
    expect(damageRoll({ ...s, spellPower: 100 }, 30)).toBe(Math.trunc((30 * 1100) / 100) + 50)
    expect(damageRoll({ ...s, weaponPower: 100 }, 30)).toBe(350) // ignorée pour un sort
    expect(damageRoll({ ...s, isWeapon: true, weaponPower: 100 }, 30)).toBe(380)
    expect(damageRoll({ ...s, attacker: { ...attacker, trapPower: 100, trapDamage: 20 }, isTrap: true }, 30)).toBe(330 + 70)
    expect(damageRoll({ ...s, baseDamageBonus: 10 }, 30)).toBe(Math.trunc((40 * 1000) / 100) + 50)
    expect(damageRoll({ ...s, armorReduction: 100 }, 30)).toBe(250)
    expect(damageRoll({ ...s, sustainedPct: 150 }, 30)).toBe(525)
    expect(damageRoll({ ...s, extraFixedDamage: 7, extraPower: 50 }, 30)).toBe(Math.trunc((30 * 1050) / 100) + 57)
  })

  it('paliers de zone : plafond `areaMaxSteps`, `efficiency` directe équivalente', () => {
    const s = base(emptyStats(), false)
    expect(damageRoll({ ...s, areaSteps: 7, areaMaxSteps: 4 }, 30)).toBe(damageRoll({ ...s, areaSteps: 4 }, 30))
    for (let d = 0; d <= 4; d++) {
      const eff = (100 - 10 * d) / 100
      expect(damageRoll({ ...s, efficiency: eff, mode: 'integer' }, 30)).toBe(damageRoll({ ...s, areaSteps: d, mode: 'integer' }, 30))
    }
    expect(damageRoll({ ...s, areaSteps: 2, areaStepPct: 20 }, 30)).toBe(Math.trunc(350 * 0.6))
  })
})

// ───────────────────────────── plage, espérance, explication ─────────────────────────────

describe('plage, espérance et explication', () => {
  it('damageRange = jets min et max ; min ≤ max', () => {
    const rng = new Rng(11)
    for (let k = 0; k < 500; k++) {
      const input = randomInput(rng)
      const lo = rng.int(1, 40)
      const hi = lo + rng.int(0, 15)
      const r = damageRange(input, lo, hi)
      expect(r).toEqual({ min: damageRoll(input, lo), max: damageRoll(input, hi) })
      expect(r.min).toBeLessThanOrEqual(r.max)
    }
  })

  it('espérance = moyenne exacte sur les jets entiers, bornée par min et max', () => {
    const rng = new Rng(12)
    for (let k = 0; k < 300; k++) {
      const input = randomInput(rng)
      const normal = { ...input, crit: false }
      const crit = { ...input, crit: true }
      const rolls = { min: rng.int(1, 30), max: 0, critMin: 0, critMax: 0 }
      rolls.max = rolls.min + rng.int(0, 10)
      rolls.critMin = rolls.min + 3
      rolls.critMax = rolls.max + 3
      let sumN = 0
      for (let r = rolls.min; r <= rolls.max; r++) sumN += damageRoll(normal, r)
      let sumC = 0
      for (let r = rolls.critMin; r <= rolls.critMax; r++) sumC += damageRoll(crit, r)
      const meanN = sumN / (rolls.max - rolls.min + 1)
      const meanC = sumC / (rolls.critMax - rolls.critMin + 1)
      const c = rng.int(0, 100)
      expect(expectedDamage(normal, crit, rolls, c)).toBeCloseTo((1 - c / 100) * meanN + (c / 100) * meanC, 9)
      expect(expectedDamage(normal, crit, rolls, 0)).toBeCloseTo(meanN, 9)
      expect(expectedDamage(normal, crit, rolls, 100)).toBeCloseTo(meanC, 9)
      expect(expectedDamage(normal, null, rolls, 100)).toBeCloseTo(meanC, 9) // critInput déduit
      const range = damageRange(normal, rolls.min, rolls.max)
      expect(meanN).toBeGreaterThanOrEqual(range.min)
      expect(meanN).toBeLessThanOrEqual(range.max)
    }
  })

  it('critInput null ⇒ variante critique de l’entrée normale (tous les champs dépendant du CC)', () => {
    const rng = new Rng(14)
    for (let k = 0; k < 2000; k++) {
      const input = { ...randomInput(rng), crit: false }
      if (rng.chance(0.5)) input.weaponCritBonus = rng.int(0, 20) // jet + bonus critique (arme)
      input.attacker.criticalDamage = rng.int(0, 150)
      input.defender.criticalRes = rng.int(-20, 80)
      const rolls = { min: rng.int(1, 30), max: 0 }
      rolls.max = rolls.min + rng.int(0, 10)
      const c = rng.int(1, 100)
      expect(expectedDamage(input, null, rolls, c)).toBe(expectedDamage(input, { ...input, crit: true }, rolls, c))
      expect(input.crit).toBe(false) // l'entrée n'est pas modifiée
    }
  })

  it('jets critiques absents : les jets normaux sont utilisés ; chance hors bornes ramenée à [0, 100]', () => {
    const input = domathToDamageInput(normalizeDomathStats({ strength: 300, damages: { fixed: { critical: 40 } } }), 'earth', false)
    const p = prepareDamage({ ...input, crit: true }, createPreparedDamage())
    expect(expectedDamage(input, null, { min: 10, max: 14 }, 150)).toBeCloseTo(meanPrepared(p, 10, 14), 12)
    expect(expectedDamage(input, null, { min: 10, max: 14 }, -5)).toBeCloseTo(meanPrepared(prepareDamage(input), 10, 14), 12)
  })

  it('explication (chemin tracé) identique au chemin rapide, étapes ordonnées, dernière = résultat', () => {
    const rng = new Rng(13)
    for (let k = 0; k < 10000; k++) {
      const input = randomInput(rng)
      input.order = rng.chance(0.3) ? 'dofus3' : 'domath'
      input.mode = rng.chance(0.3) ? 'integer' : 'domath'
      if (rng.chance(0.2)) input.weaponSkillPct = rng.int(-10, 30)
      if (rng.chance(0.2)) input.efficiency = rng.int(0, 10) / 10
      if (rng.chance(0.2)) input.baseDamageBonus = rng.int(-10, 20)
      if (rng.chance(0.2)) input.armorReduction = rng.int(0, 150)
      const r = rng.int(-2, 60)
      const ex = explainDamage(input, r)
      expect(ex.damage).toBe(damageRoll(input, r))
      expect(ex.steps[0].id).toBe('base')
      expect(ex.steps.at(-1)!.id).toBe('result')
      expect(ex.steps.at(-1)!.value).toBe(ex.damage)
      for (const s of ex.steps) expect(s.label.length).toBeGreaterThan(0)
    }
  })

  it('explication d’un build complet (DoMath 614)', () => {
    const input = domathToDamageInput(
      normalizeDomathStats({
        strength: 1100,
        power: 180,
        damages: { fixed: { damages: 120, earth: 40, critical: 95 }, percentage: { spell: 18, range: 12, final: 10 } },
        resistances: { fixed: { earth: 25, critical: 30 }, percentage: { earth: 35, spell: 10, range: 0 } },
      }),
      'earth',
      true,
    )
    const ex = explainDamage(input, 38)
    expect(ex.steps.map(s => [s.id, s.value])).toEqual([
      ['base', 38],
      ['stats', 524],
      ['fixed', 779],
      ['area', 779],
      ['fixedRes', 724],
      ['percentRes', 470],
      ['sustained', 470],
      ['final', 517],
      ['category', 610],
      ['distance', 683],
      ['received', 614],
      ['result', 614],
    ])
    expect(ex.params.power).toBe(1280)
    expect(ex.params.fixedDamage).toBe(255)
    expect(ex.params.fixedRes).toBe(55)
  })
})

// ───────────────────────────── pureté ─────────────────────────────

describe('pureté et réutilisation', () => {
  it('ne modifie pas les entrées et donne le même résultat à chaque appel', () => {
    const rng = new Rng(21)
    for (let k = 0; k < 200; k++) {
      const input = randomInput(rng)
      Object.freeze(input.attacker)
      Object.freeze(input.defender)
      Object.freeze(input)
      const a = damageRoll(input, 33)
      damageRoll(randomInput(rng), 12) // l'objet interne réutilisé ne fuit pas d'un appel à l'autre
      expect(damageRoll(input, 33)).toBe(a)
      expect(explainDamage(input, 33).damage).toBe(a)
    }
  })

  it('prepareDamage réutilise l’objet fourni', () => {
    const out = createPreparedDamage()
    const input = randomInput(new Rng(3))
    expect(prepareDamage(input, out)).toBe(out)
  })
})
