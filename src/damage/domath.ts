/**
 * Adaptateur du format de caractéristiques de DoMath (calculateur https://domath.fr, v1.3.3) vers le moteur :
 * normalisation `Dg`, jet `Rg`, min/max d'un sort (`Mg`/`jg`) et distribution exacte du Web Worker.
 * Sert aux vecteurs de test (data/research/damage-test-vectors.json) et au calculateur web, qui peut ainsi
 * accepter une saisie « à la DoMath » (stats du lanceur ET de la cible dans un seul objet).
 */
import { ELEMENT_KEYS, emptyStats, type Element, type ElementKey } from '../core/types'
import { critChance } from './crit'
import { createPreparedDamage, type DamageInput, prepareDamage, rollPrepared } from './damage'
import type { DamageMode } from './math'

export interface DomathStats {
  power: number
  strength: number
  intelligence: number
  luck: number
  agility: number
  /** % critique (s'ajoute au taux de base du sort). */
  crit: number
  damages: {
    fixed: { damages: number; neutral: number; earth: number; fire: number; water: number; air: number; critical: number }
    percentage: { sustained: number; final: number; spell: number; weapon: number; range: number; melee: number }
  }
  resistances: {
    fixed: { neutral: number; earth: number; fire: number; water: number; air: number; critical: number }
    percentage: {
      neutral: number
      earth: number
      fire: number
      water: number
      air: number
      spell: number
      weapon: number
      range: number
      melee: number
    }
  }
  hit: { type: 'spell' | 'weapon'; distance: 'range' | 'melee' }
  /** Distance au centre de la zone (0..9 dans l'interface). */
  areaDistance: number
  portal: { type: 'none' | 'normal'; redirection: number }
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }
export type DomathStatsInput = DeepPartial<DomathStats>

/**
 * Normalisation DoMath `Dg` : chaque champ vaut `x || défaut`. Quirk conservé : une valeur 0 saisie pour
 * « dommages subis » est remplacée par le défaut 100.
 */
export function normalizeDomathStats(s: DomathStatsInput = {}): DomathStats {
  const df = s.damages?.fixed ?? {}
  const dp = s.damages?.percentage ?? {}
  const rf = s.resistances?.fixed ?? {}
  const rp = s.resistances?.percentage ?? {}
  return {
    power: s.power || 0,
    strength: s.strength || 0,
    intelligence: s.intelligence || 0,
    luck: s.luck || 0,
    agility: s.agility || 0,
    crit: s.crit || 0,
    damages: {
      fixed: {
        damages: df.damages || 0,
        neutral: df.neutral || 0,
        earth: df.earth || 0,
        fire: df.fire || 0,
        water: df.water || 0,
        air: df.air || 0,
        critical: df.critical || 0,
      },
      percentage: {
        sustained: dp.sustained || 100,
        final: dp.final || 0,
        spell: dp.spell || 0,
        weapon: dp.weapon || 0,
        range: dp.range || 0,
        melee: dp.melee || 0,
      },
    },
    resistances: {
      fixed: {
        neutral: rf.neutral || 0,
        earth: rf.earth || 0,
        fire: rf.fire || 0,
        water: rf.water || 0,
        air: rf.air || 0,
        critical: rf.critical || 0,
      },
      percentage: {
        neutral: rp.neutral || 0,
        earth: rp.earth || 0,
        fire: rp.fire || 0,
        water: rp.water || 0,
        air: rp.air || 0,
        spell: rp.spell || 0,
        weapon: rp.weapon || 0,
        range: rp.range || 0,
        melee: rp.melee || 0,
      },
    },
    hit: { type: s.hit?.type || 'spell', distance: s.hit?.distance || 'range' },
    areaDistance: s.areaDistance || 0,
    portal: { type: s.portal?.type || 'none', redirection: s.portal?.redirection || 0 },
  }
}

/** Élément DoMath ('neutral', 'earth'…) ou enum → `Element`. */
export function toElement(e: Element | ElementKey): Element {
  if (typeof e === 'number') return e
  const i = ELEMENT_KEYS.indexOf(e)
  if (i < 0) throw new Error(`Élément inconnu : ${String(e)}`)
  return i as Element
}

/**
 * Convertit des stats DoMath (normalisées) en `DamageInput` équivalent : aucun plafond de résistance
 * (DoMath n'en a pas), dégressivité 10 %/25 % sans limite de paliers, portail « redirection » × 2 %.
 */
export function domathToDamageInput(
  stats: DomathStats,
  element: Element | ElementKey,
  crit: boolean,
  mode: DamageMode = 'domath',
): DamageInput {
  const attacker = emptyStats()
  attacker.power = stats.power
  attacker.strength = stats.strength
  attacker.intelligence = stats.intelligence
  attacker.chance = stats.luck
  attacker.agility = stats.agility
  attacker.critical = stats.crit
  const df = stats.damages.fixed
  attacker.damage = df.damages
  attacker.neutralDamage = df.neutral
  attacker.earthDamage = df.earth
  attacker.fireDamage = df.fire
  attacker.waterDamage = df.water
  attacker.airDamage = df.air
  attacker.criticalDamage = df.critical
  const dp = stats.damages.percentage
  attacker.finalDamagePct = dp.final
  attacker.spellDamagePct = dp.spell
  attacker.weaponDamagePct = dp.weapon
  attacker.rangedDamagePct = dp.range
  attacker.meleeDamagePct = dp.melee

  const defender = emptyStats()
  const rf = stats.resistances.fixed
  defender.neutralRes = rf.neutral
  defender.earthRes = rf.earth
  defender.fireRes = rf.fire
  defender.waterRes = rf.water
  defender.airRes = rf.air
  defender.criticalRes = rf.critical
  const rp = stats.resistances.percentage
  defender.neutralResPct = rp.neutral
  defender.earthResPct = rp.earth
  defender.fireResPct = rp.fire
  defender.waterResPct = rp.water
  defender.airResPct = rp.air
  defender.spellResPct = rp.spell
  defender.weaponResPct = rp.weapon
  defender.rangedResPct = rp.range
  defender.meleeResPct = rp.melee

  return {
    attacker,
    defender,
    element: toElement(element),
    crit,
    isWeapon: stats.hit.type === 'weapon',
    isMelee: stats.hit.distance === 'melee',
    defenderIsPlayer: false,
    monsterResCap: Infinity,
    areaSteps: stats.areaDistance,
    portalCells: stats.portal.type === 'normal' ? stats.portal.redirection : 0,
    sustainedPct: dp.sustained,
    mode,
  }
}

/** Jet DoMath `Rg(Dg(stats), base, élément, critique)`. */
export function domathDamageRoll(
  stats: DomathStatsInput,
  baseDamage: number,
  element: Element | ElementKey,
  isCritical: boolean,
  mode: DamageMode = 'domath',
): number {
  const input = domathToDamageInput(normalizeDomathStats(stats), element, isCritical, mode)
  return rollPrepared(prepareDamage(input), baseDamage)
}

export interface DomathRollRange {
  min: number
  max: number
}

/** Ligne de dégâts d'un sort DoMath : élément et jets normaux / critiques. */
export interface DomathDamageLine {
  element: Element | ElementKey
  baseDamage: { normal: DomathRollRange; crit: DomathRollRange }
}

export interface DomathSpellMinMax {
  normal: DomathRollRange
  crit: DomathRollRange
}

/**
 * Min / max d'un lancer (DoMath `Mg` par ligne, `jg` pour la somme des lignes) ; le composant résultat
 * multiplie par le nombre de lancers (`counter`).
 */
export function domathSpellMinMax(
  stats: DomathStatsInput,
  lines: readonly DomathDamageLine[],
  counter = 1,
  mode: DamageMode = 'domath',
): DomathSpellMinMax {
  const s = normalizeDomathStats(stats)
  const normal = createPreparedDamage()
  const crit = createPreparedDamage()
  const out: DomathSpellMinMax = { normal: { min: 0, max: 0 }, crit: { min: 0, max: 0 } }
  for (const line of lines) {
    prepareDamage(domathToDamageInput(s, line.element, false, mode), normal)
    prepareDamage(domathToDamageInput(s, line.element, true, mode), crit)
    out.normal.min += rollPrepared(normal, line.baseDamage.normal.min)
    out.normal.max += rollPrepared(normal, line.baseDamage.normal.max)
    out.crit.min += rollPrepared(crit, line.baseDamage.crit.min)
    out.crit.max += rollPrepared(crit, line.baseDamage.crit.max)
  }
  out.normal.min *= counter
  out.normal.max *= counter
  out.crit.min *= counter
  out.crit.max *= counter
  return out
}

// ───────────────────────────── distribution exacte (Web Worker DoMath) ─────────────────────────────

export interface DomathSpell {
  stats: DomathStatsInput
  /** Taux de critique de base du sort (%). 0 = ne critique pas. */
  crit: number
  damageLines: readonly DomathDamageLine[]
  /** Nombre de lancers (défaut 1). */
  counter?: number
}

export interface DamageProbability {
  value: number
  probability: number
}

type Distribution = Map<number, number>

function convolve(a: Distribution, b: Distribution): Distribution {
  const out: Distribution = new Map()
  for (const [va, pa] of a) for (const [vb, pb] of b) out.set(va + vb, (out.get(va + vb) ?? 0) + pa * pb)
  return out
}

/** Convolution d'une liste de distributions (les plus longues d'abord, comme `we`). */
function convolveAll(list: Distribution[]): Distribution {
  if (list.length === 0) return new Map([[0, 1]])
  const sorted = list.slice().sort((x, y) => y.size - x.size)
  let acc = sorted[0]
  for (let i = 1; i < sorted.length; i++) acc = convolve(acc, sorted[i])
  return acc
}

/** Distribution uniforme des dégâts d'une ligne sur les jets entiers [min, max]. */
function lineDistribution(stats: DomathStats, line: DomathDamageLine, isCrit: boolean, mode: DamageMode): Distribution {
  const range = isCrit ? line.baseDamage.crit : line.baseDamage.normal
  const min = range.min ?? 0
  const max = range.max ?? 0
  const count = Math.max(max - min + 1, 1)
  const p = prepareDamage(domathToDamageInput(stats, line.element, isCrit, mode))
  const out: Distribution = new Map()
  for (let r = min; r <= max; r++) {
    const v = rollPrepared(p, r)
    out.set(v, (out.get(v) ?? 0) + 1 / count)
  }
  return out
}

/**
 * Distribution exacte des dégâts totaux de plusieurs sorts (worker DoMath) : jets uniformes sur les entiers,
 * lignes convoluées, mélange normal/critique avec `c = min(100, max(0, critSort ? critSort + %crit : 0))`,
 * lancers indépendants convolués. Résultat trié par valeur croissante, probabilités nulles retirées.
 */
export function damageDistribution(spells: readonly DomathSpell[], mode: DamageMode = 'domath'): DamageProbability[] {
  const casts: Distribution[] = []
  for (const spell of spells) {
    const stats = normalizeDomathStats(spell.stats)
    const o = critChance(spell.crit, stats.crit)
    for (let n = 0; n < (spell.counter ?? 1); n++) {
      const cast: Distribution = new Map()
      if (o < 100) {
        const normal = convolveAll(spell.damageLines.map(l => lineDistribution(stats, l, false, mode)))
        for (const [v, p] of normal) cast.set(v, (cast.get(v) ?? 0) + p * (1 - o / 100))
      }
      if (o > 0) {
        const crit = convolveAll(spell.damageLines.map(l => lineDistribution(stats, l, true, mode)))
        for (const [v, p] of crit) cast.set(v, (cast.get(v) ?? 0) + p * (o / 100))
      }
      casts.push(cast)
    }
  }
  const total = convolveAll(casts)
  return [...total]
    .filter(([, p]) => p > 0)
    .map(([value, probability]) => ({ value, probability }))
    .sort((x, y) => x.value - y.value)
}

/** Espérance d'une distribution. */
export function distributionMean(dist: readonly DamageProbability[]): number {
  let m = 0
  for (const d of dist) m += d.value * d.probability
  return m
}

/** Courbe décroissante DoMath : `P(X ≥ x)` en %, pour chaque valeur de la distribution triée. */
export function decreasingCurve(dist: readonly DamageProbability[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < dist.length; i++) {
    out.push({ x: dist[i].value, y: i === 0 ? 100 : out[i - 1].y - 100 * dist[i - 1].probability })
  }
  return out
}
