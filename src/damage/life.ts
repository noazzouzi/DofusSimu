/**
 * Points de vie : érosion, application d'un dégât (bouclier, érosion, PV) et dégâts basés sur les PV.
 * Références : docs/research/formulas.md §5, §8, §9 ; effects.md §7.1 ; codes D2 `DamageUtil.getHpBasedDamage`,
 * port D3 `DamageSender.GetDamageBasedOnCasterLife` / `DamageReceiver.GetDamageBasedOnTargetLife`.
 */
import { Element, ELEMENT_RES_FIXED, ELEMENT_RES_PCT, type Stats } from '../core/types'
import { assertResolvedElement, effectiveResistPercent, MONSTER_RES_CAP } from './damage'
import type { DamageMode } from './math'

/** Érosion de base de tout combattant (%). */
export const BASE_EROSION_PCT = 10
/** Plafond d'érosion (%) : AS3 l.2407, port D3 `GetPermanentDamage`. */
export const MAX_EROSION_PCT = 50

/** Érosion totale (%) = `min(50, 10 + bonus)`, au moins 0. */
export function erosionPercent(bonus = 0): number {
  const e = BASE_EROSION_PCT + bonus
  return e < 0 ? 0 : e > MAX_EROSION_PCT ? MAX_EROSION_PCT : e
}

export interface ErosionOptions {
  mode?: DamageMode
  /** PV actuels de la cible : l'érosion ne peut pas tuer (port D3 : au plus PV − 1). */
  currentHp?: number
}

/**
 * PV max retirés par un dégât : `floor(dégâts × érosion / 100)`, calculé sur les dégâts **avant** bouclier.
 * `erosionPct` est l'érosion totale (base comprise), bornée à [0, 50]. Mode `domath` : `floor(v × (e / 100))`
 * (artefacts flottants rares du simulateur de pièges) ; mode `integer` : `floor(v × e / 100)` (client D2).
 */
export function erosion(damage: number, erosionPct: number, opts?: ErosionOptions): number {
  if (damage <= 0) return 0
  const e = erosionPct < 0 ? 0 : erosionPct > MAX_EROSION_PCT ? MAX_EROSION_PCT : erosionPct
  let v = opts?.mode === 'integer' ? Math.floor((damage * e) / 100) : Math.floor(damage * (e / 100))
  if (opts?.currentHp !== undefined && v > opts.currentHp - 1) v = opts.currentHp - 1
  return v > 0 ? v : 0
}

/** Réserve de vie d'une entité (format du simulateur de pièges DoMath). */
export interface LifePool {
  health: number
  maxHealth: number
  shield: number
  /** Érosion totale en %. */
  erosion: number
}

export interface PoolDamageResult {
  /** Dégâts passés au travers du bouclier (DoMath `E`, non bornés aux PV restants). */
  lifeLost: number
  /** PV réellement perdus : `min(PV avant, lifeLost)` (base du vol de vie côté client D2). */
  hpLost: number
  /** Dégâts absorbés par le bouclier. */
  absorbed: number
  /** PV max retirés par l'érosion (sur les dégâts totaux, bouclier compris). */
  erodedMaxHp: number
  health: number
  maxHealth: number
  shield: number
  /** Derniers dégâts subis (pour « soigne de X % des derniers dégâts ») ; null si aucun PV perdu. */
  lastDamage: number | null
}

/**
 * Applique un dégât final à une réserve de vie (DoMath `HT`, l.41108) : le bouclier absorbe d'abord, l'érosion
 * porte sur la valeur totale (avant bouclier), puis PV = min(PV, PV max). Fonction pure.
 */
export function applyDamageToPool(pool: LifePool, damage: number, mode: DamageMode = 'domath'): PoolDamageResult {
  const value = damage > 0 ? damage : 0
  let lifeLost = value
  let shield = pool.shield
  if (shield > 0) {
    lifeLost = value - shield > 0 ? value - shield : 0
    shield = shield - value > 0 ? shield - value : 0
  }
  const eroded = erosion(value, pool.erosion, { mode })
  const maxHealth = pool.maxHealth - eroded
  let health = pool.health - lifeLost
  if (health > maxHealth) health = maxHealth
  return {
    lifeLost,
    hpLost: Math.min(pool.health > 0 ? pool.health : 0, lifeLost),
    absorbed: value - lifeLost,
    erodedMaxHp: eroded,
    health,
    maxHealth,
    shield,
    lastDamage: lifeLost > 0 ? lifeLost : null,
  }
}

// ───────────────────────────── dégâts basés sur les PV ─────────────────────────────

/** PV de référence d'un effet basé sur les PV. */
export type HpBasedSource =
  | 'casterLife' // PV actuels du lanceur (85-89)
  | 'casterMissingLife' // PV manquants du lanceur (275, 279)
  | 'casterMidLife' // « milieu des PV » du lanceur (672)
  | 'casterErodedLife' // PV érodés du lanceur (1118-1122)
  | 'targetLife' // PV actuels de la cible (1067-1071)
  | 'targetErodedLife' // PV érodés de la cible (1092-1096)
  | 'lifeLoss' // perte de % des PV actuels, ignore tout (1048)

/**
 * Multiplicateurs appliqués après les résistances :
 *  - `none` : seulement « dommages subis » (port D3 : effets non « boostables ») ;
 *  - `received` : + % résistances sorts|armes et distance|mêlée de la cible (client D2, listes HP_BASED) ;
 *  - `all` : tous les multiplicateurs du lanceur et de la cible (client D2 pour 1092-1096).
 */
export type HpBasedMultipliers = 'none' | 'received' | 'all'

export interface HpBasedEffectInfo {
  source: HpBasedSource
  /** Élément (-1 : aucun). */
  element: Element | -1
  /** Multiplicateurs selon le client Dofus 2 (le port D3 n'applique que `none`) — INCERTAIN. */
  dofus2Multipliers: HpBasedMultipliers
  /** Ignore résistances et multiplicateurs (1048). */
  ignoresResistances: boolean
}

function hpEffect(source: HpBasedSource, element: Element | -1, d2: HpBasedMultipliers, ignores = false): HpBasedEffectInfo {
  return { source, element, dofus2Multipliers: d2, ignoresResistances: ignores }
}

/** Effets de dégâts basés sur les PV (éléments : DofusDB `/effects.elementId`). */
export const HP_BASED_DAMAGE_EFFECTS: ReadonlyMap<number, HpBasedEffectInfo> = new Map([
  [85, hpEffect('casterLife', Element.Water, 'received')],
  [86, hpEffect('casterLife', Element.Earth, 'received')],
  [87, hpEffect('casterLife', Element.Air, 'received')],
  [88, hpEffect('casterLife', Element.Fire, 'received')],
  [89, hpEffect('casterLife', Element.Neutral, 'received')],
  [672, hpEffect('casterMidLife', Element.Neutral, 'received')],
  [275, hpEffect('casterMissingLife', Element.Water, 'received')],
  [279, hpEffect('casterMissingLife', Element.Neutral, 'received')],
  [1067, hpEffect('targetLife', Element.Air, 'received')],
  [1068, hpEffect('targetLife', Element.Water, 'received')],
  [1069, hpEffect('targetLife', Element.Fire, 'received')],
  [1070, hpEffect('targetLife', Element.Earth, 'received')],
  [1071, hpEffect('targetLife', Element.Neutral, 'received')],
  [1092, hpEffect('targetErodedLife', Element.Neutral, 'all')],
  [1093, hpEffect('targetErodedLife', Element.Air, 'all')],
  [1094, hpEffect('targetErodedLife', Element.Fire, 'all')],
  [1095, hpEffect('targetErodedLife', Element.Water, 'all')],
  [1096, hpEffect('targetErodedLife', Element.Earth, 'all')],
  [1118, hpEffect('casterErodedLife', Element.Neutral, 'received')],
  [1119, hpEffect('casterErodedLife', Element.Air, 'received')],
  [1120, hpEffect('casterErodedLife', Element.Fire, 'received')],
  [1121, hpEffect('casterErodedLife', Element.Water, 'received')],
  [1122, hpEffect('casterErodedLife', Element.Earth, 'received')],
  [1048, hpEffect('lifeLoss', -1, 'none', true)],
])

/** PV des deux protagonistes (PV max de base = avant érosion). */
export interface HpSnapshot {
  casterHp: number
  casterMaxHp: number
  casterBaseMaxHp: number
  targetHp: number
  targetMaxHp: number
  targetBaseMaxHp: number
}

/**
 * Multiplicateur « milieu de vie » de l'effet 672 (client D2 `getMidLifeDamageMultiplier`) :
 * `(cos(2π(p/100 − 0,5)) + 1)² / 4` avec `p` = % de PV entier (1 à 50 % de vie, 0 à 0 % et 100 %). INCERTAIN en D3.
 */
export function midLifeMultiplier(hp: number, maxHp: number): number {
  const raw = maxHp > 0 ? Math.trunc((100 * hp) / maxHp) : 0
  const p = raw < 0 ? 0 : raw > 100 ? 100 : raw
  const c = Math.cos(2 * Math.PI * (p * 0.01 - 0.5)) + 1
  return (c * c) / 4
}

/** PV de référence d'une source (peut être fractionnaire pour `casterMidLife`). */
export function hpReference(source: HpBasedSource, s: HpSnapshot): number {
  switch (source) {
    case 'casterLife':
      return s.casterHp
    case 'casterMissingLife':
      return Math.max(0, s.casterMaxHp - s.casterHp)
    case 'casterMidLife':
      return s.casterBaseMaxHp * midLifeMultiplier(s.casterHp, s.casterMaxHp)
    case 'casterErodedLife':
      return Math.max(0, s.casterBaseMaxHp - s.casterMaxHp)
    case 'targetLife':
    case 'lifeLoss':
      return s.targetHp
    case 'targetErodedLife':
      return Math.max(0, s.targetBaseMaxHp - s.targetMaxHp)
  }
}

export interface HpBasedDamageInput {
  /** Jet de l'effet, en % des PV de référence. */
  percent: number
  /** PV de référence (`hpReference`). */
  referenceHp: number
  defender: Stats
  /** Élément (-1 : aucun, pas de résistance élémentaire). */
  element: Element | -1
  defenderIsPlayer: boolean
  /** Coup critique : soustrait aussi les résistances critiques (port D3 `GetFlatResistance`). */
  crit?: boolean
  /** Réduction d'armure déjà mise à l'échelle (`armorReduction`) : le port D3 l'applique à tout dégât hors poussée. */
  armorReduction?: number
  /** « % Résistance » à tous les éléments (carac 101), ajoutée avant plafonnement (cf. `DamageInput.allResPct`). */
  allResPct?: number
  /** Efficacité de zone (0..1, client D2 ; 672 n'en tient pas compte). Défaut 1. */
  efficiency?: number
  /** Ignore toutes les résistances et multiplicateurs (1048). */
  ignoreResistances?: boolean
  /** Défaut `none` (port Dofus 3). */
  multipliers?: HpBasedMultipliers
  /** Lanceur (requis pour `all`). */
  attacker?: Stats
  isWeapon?: boolean
  isMelee?: boolean
  sustainedPct?: number
  monsterResCap?: number
  mode?: DamageMode
}

/**
 * Dégâts basés sur les PV : `trunc(% × PV / 100 × efficacité)` puis − rés. fixes (+ critiques, + armure ; ≥ 0),
 * × (1 − %rés), puis les multiplicateurs choisis (ordre DoMath : subis, finaux, sorts|armes, distance|mêlée,
 * reçus). Non boostés par les caractéristiques ni les dommages fixes. INCERTAIN : multiplicateurs (D2 ≠ D3), et
 * rés. fixes pour 1092-1096 (le client D2 ne les soustrait pas, le port D3 si), cf. formulas.md §5.
 * L'élément doit être 0..4 ou -1 (aucun) ; sinon RangeError.
 */
export function hpBasedDamage(input: HpBasedDamageInput): number {
  const domath = input.mode !== 'integer'
  const eff = input.efficiency ?? 1
  let r = domath
    ? Math.trunc(((input.percent * input.referenceHp) / 100) * eff)
    : Math.trunc((input.percent * input.referenceHp * Math.round(eff * 100)) / 10000)
  if (r <= 0) return 0
  if (input.ignoreResistances) return r
  const d = input.defender
  const el = input.element
  if (el !== -1) {
    assertResolvedElement(el)
    r -= d[ELEMENT_RES_FIXED[el]] + (input.crit ? d.criticalRes : 0) + (input.armorReduction ?? 0)
    if (r <= 0) return 0
    const raw = d[ELEMENT_RES_PCT[el]] + (input.allResPct ?? 0)
    const res = effectiveResistPercent(raw, input.defenderIsPlayer, input.monsterResCap ?? MONSTER_RES_CAP)
    r = domath ? Math.trunc(r * (1 - res / 100)) : Math.trunc((r * (100 - res)) / 100)
  } else if (input.armorReduction) {
    r -= input.armorReduction
    if (r <= 0) return 0
  }
  r = Math.trunc((r * (input.sustainedPct ?? 100)) / 100)
  const multipliers = input.multipliers ?? 'none'
  if (multipliers !== 'none') {
    const weapon = input.isWeapon ?? false
    const melee = input.isMelee ?? false
    if (multipliers === 'all') {
      const a = input.attacker
      if (a) {
        r = Math.trunc((r * (100 + a.finalDamagePct)) / 100)
        r = Math.trunc((r * (100 + (weapon ? a.weaponDamagePct : a.spellDamagePct))) / 100)
        r = Math.trunc((r * (100 + (melee ? a.meleeDamagePct : a.rangedDamagePct))) / 100)
      }
    }
    const rc = weapon ? d.weaponResPct : d.spellResPct
    const rd = melee ? d.meleeResPct : d.rangedResPct
    r = domath ? Math.trunc(r * (1 - rc / 100) * (1 - rd / 100)) : Math.trunc((r * (100 - rc) * (100 - rd)) / 10000)
  }
  return r > 0 ? r : 0
}
