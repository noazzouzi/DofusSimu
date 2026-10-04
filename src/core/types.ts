/**
 * Types fondamentaux partagés par tout le simulateur (données, moteur, IA, optimiseurs, interface).
 */

/** Éléments de dégâts. L'ordre suit `effectElement` de DofusDB (0 neutre, 1 terre, 2 feu, 3 eau, 4 air). */
export enum Element {
  Neutral = 0,
  Earth = 1,
  Fire = 2,
  Water = 3,
  Air = 4,
}

export const ELEMENTS: readonly Element[] = [Element.Neutral, Element.Earth, Element.Fire, Element.Water, Element.Air]
export const ELEMENT_KEYS = ['neutral', 'earth', 'fire', 'water', 'air'] as const
export type ElementKey = (typeof ELEMENT_KEYS)[number]
export const ELEMENT_NAMES_FR: Record<Element, string> = {
  [Element.Neutral]: 'Neutre',
  [Element.Earth]: 'Terre',
  [Element.Fire]: 'Feu',
  [Element.Water]: 'Eau',
  [Element.Air]: 'Air',
}

/**
 * Caractéristiques d'un combattant (valeurs totales : base + équipements + panoplies + bonus).
 * Les pourcentages sont exprimés en points de pourcentage (ex. 12 = 12 %).
 */
export interface Stats {
  vitality: number
  wisdom: number
  strength: number
  intelligence: number
  chance: number
  agility: number
  ap: number
  mp: number
  range: number
  summons: number
  initiative: number
  prospecting: number
  critical: number // % coups critiques
  heals: number // soins fixes
  power: number // puissance
  damage: number // dommages fixes (tous éléments)
  neutralDamage: number
  earthDamage: number
  fireDamage: number
  waterDamage: number
  airDamage: number
  criticalDamage: number
  pushDamage: number
  trapDamage: number
  trapPower: number
  spellDamagePct: number // % dommages aux sorts
  weaponDamagePct: number // % dommages d'armes
  meleeDamagePct: number // % dommages mêlée
  rangedDamagePct: number // % dommages distance
  finalDamagePct: number // % dommages finaux
  apReduction: number // retrait PA
  mpReduction: number // retrait PM
  apParry: number // esquive PA
  mpParry: number // esquive PM
  tackleBlock: number // tacle
  tackleEvade: number // fuite
  neutralResPct: number
  earthResPct: number
  fireResPct: number
  waterResPct: number
  airResPct: number
  neutralRes: number // résistances fixes
  earthRes: number
  fireRes: number
  waterRes: number
  airRes: number
  criticalRes: number
  pushRes: number
  meleeResPct: number
  rangedResPct: number
  spellResPct: number
  weaponResPct: number
  reflect: number // renvoi de dommages
  lifePoints: number // PV bonus fixes hors vitalité (ex. bonus de monstres)
  weaponSkillPct: number // maîtrise d'arme
  // ── Caractéristiques de combat OPTIONNELLES (buffs de sorts uniquement, hors STAT_KEYS ; absentes = 0) ──
  /** % résistance à tous les éléments (effets 1076 / 1077, carac 101), ajouté à chaque % élémentaire AVANT plafond. */
  allResPct?: number
  /** % soins finaux (effets 2971 / 2972). */
  finalHealPct?: number
  /** % dommages combo des bombes Roublard (effet 1027). */
  comboDamagePct?: number
  /** Puissance aux sorts (effet 1054, carac 98), ajoutée à la puissance pour les sorts uniquement. */
  spellPower?: number
}

/** Clés des caractéristiques toujours présentes (celles de STAT_KEYS) : les caractéristiques optionnelles en sont exclues. */
export type StatKey = { [K in keyof Stats]-?: undefined extends Stats[K] ? never : K }[keyof Stats]
/** Caractéristiques de combat optionnelles (absentes de STAT_KEYS, lues avec `?? 0`). */
export type FightStatKey = Exclude<keyof Stats, StatKey>

export const STAT_KEYS: readonly StatKey[] = [
  'vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility', 'ap', 'mp', 'range', 'summons',
  'initiative', 'prospecting', 'critical', 'heals', 'power', 'damage', 'neutralDamage', 'earthDamage',
  'fireDamage', 'waterDamage', 'airDamage', 'criticalDamage', 'pushDamage', 'trapDamage', 'trapPower',
  'spellDamagePct', 'weaponDamagePct', 'meleeDamagePct', 'rangedDamagePct', 'finalDamagePct', 'apReduction',
  'mpReduction', 'apParry', 'mpParry', 'tackleBlock', 'tackleEvade', 'neutralResPct', 'earthResPct',
  'fireResPct', 'waterResPct', 'airResPct', 'neutralRes', 'earthRes', 'fireRes', 'waterRes', 'airRes',
  'criticalRes', 'pushRes', 'meleeResPct', 'rangedResPct', 'spellResPct', 'weaponResPct', 'reflect',
  'lifePoints', 'weaponSkillPct',
]

/** Caractéristiques à zéro — littéral objet (forme stable pour V8 : accès et copies rapides). */
export function emptyStats(): Stats {
  return {
    vitality: 0,
    wisdom: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
    ap: 0,
    mp: 0,
    range: 0,
    summons: 0,
    initiative: 0,
    prospecting: 0,
    critical: 0,
    heals: 0,
    power: 0,
    damage: 0,
    neutralDamage: 0,
    earthDamage: 0,
    fireDamage: 0,
    waterDamage: 0,
    airDamage: 0,
    criticalDamage: 0,
    pushDamage: 0,
    trapDamage: 0,
    trapPower: 0,
    spellDamagePct: 0,
    weaponDamagePct: 0,
    meleeDamagePct: 0,
    rangedDamagePct: 0,
    finalDamagePct: 0,
    apReduction: 0,
    mpReduction: 0,
    apParry: 0,
    mpParry: 0,
    tackleBlock: 0,
    tackleEvade: 0,
    neutralResPct: 0,
    earthResPct: 0,
    fireResPct: 0,
    waterResPct: 0,
    airResPct: 0,
    neutralRes: 0,
    earthRes: 0,
    fireRes: 0,
    waterRes: 0,
    airRes: 0,
    criticalRes: 0,
    pushRes: 0,
    meleeResPct: 0,
    rangedResPct: 0,
    spellResPct: 0,
    weaponResPct: 0,
    reflect: 0,
    lifePoints: 0,
    weaponSkillPct: 0,
  }
}

export function addStats(target: Stats, source: Partial<Stats>, factor = 1): Stats {
  for (const k in source) {
    const v = source[k as StatKey]
    // `?? 0` : une caractéristique de combat optionnelle peut être absente de `target`.
    if (v) target[k as StatKey] = (target[k as StatKey] ?? 0) + v * factor
  }
  return target
}

/** Caractéristique principale associée à chaque élément (neutre et terre : force). */
export const ELEMENT_MAIN_STAT: Record<Element, StatKey> = {
  [Element.Neutral]: 'strength',
  [Element.Earth]: 'strength',
  [Element.Fire]: 'intelligence',
  [Element.Water]: 'chance',
  [Element.Air]: 'agility',
}
export const ELEMENT_FIXED_DAMAGE: Record<Element, StatKey> = {
  [Element.Neutral]: 'neutralDamage',
  [Element.Earth]: 'earthDamage',
  [Element.Fire]: 'fireDamage',
  [Element.Water]: 'waterDamage',
  [Element.Air]: 'airDamage',
}
export const ELEMENT_RES_PCT: Record<Element, StatKey> = {
  [Element.Neutral]: 'neutralResPct',
  [Element.Earth]: 'earthResPct',
  [Element.Fire]: 'fireResPct',
  [Element.Water]: 'waterResPct',
  [Element.Air]: 'airResPct',
}
export const ELEMENT_RES_FIXED: Record<Element, StatKey> = {
  [Element.Neutral]: 'neutralRes',
  [Element.Earth]: 'earthRes',
  [Element.Fire]: 'fireRes',
  [Element.Water]: 'waterRes',
  [Element.Air]: 'airRes',
}

/** Équipes : 0 = joueurs (« défenseurs » côté placement bleu/rouge selon la carte), 1 = monstres. */
export type TeamId = 0 | 1
