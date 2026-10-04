/**
 * Effets d'objets / de panoplies → caractéristiques (`Stats`).
 *
 * Source : data/research/characteristics-map.json (contextes `stat` et `scroll`), cf. docs/research/equipment.md §3.
 * Le signe n'est jamais dans les montants (diceNum/diceSide sont positifs) : il est porté par l'effectId
 * (118 = +Force, 157 = −Force ; 210 = +% Rés. Terre, 215 = −% Rés. Terre).
 *
 * La table est recopiée ici (et vérifiée contre le JSON par tests/stats-effects.test.ts) pour que le moteur
 * et l'interface n'aient pas à charger les 80 Ko du JSON de recherche au runtime. Les recherches se font dans
 * des tableaux denses indexés par effectId (aucune allocation, aucun hachage dans les boucles chaudes).
 */
import type { Stats, StatKey } from '../core/types'
import { STAT_INDEX } from './fastStats'

export type StatSign = 1 | -1

/** Effet de sort passif conféré par un objet (Dofus, prysmaradites, légendaires) : `min` (diceNum) = id du sort. */
export const EFFECT_PASSIVE_SPELL = 1175
/**
 * Plafond de caractéristique « #1 max. #2 » (panoplies maudites) : diceNum = id de caractéristique,
 * diceSide = valeur maximale. Avec le modèle runtime `{min, max}` : `min` = id de caractéristique, `max` = plafond.
 */
export const EFFECT_STAT_CAP = 2897

/**
 * Lignes « stat » : [effectId bonus, effectId malus (0 = aucun), clé Stats, id de caractéristique DofusDB].
 * Les effets 606-611 (parchemins, « caractéristique additionnelle ») sont ajoutés à part.
 */
const STAT_LINES: readonly (readonly [number, number, StatKey, number])[] = [
  [111, 168, 'ap', 1],
  [128, 169, 'mp', 23],
  [117, 116, 'range', 19],
  [182, 2990, 'summons', 26],
  [115, 171, 'critical', 18],
  [138, 186, 'power', 25],
  [112, 145, 'damage', 16],
  [125, 153, 'vitality', 11],
  [124, 156, 'wisdom', 12],
  [118, 157, 'strength', 10],
  [126, 155, 'intelligence', 15],
  [123, 152, 'chance', 13],
  [119, 154, 'agility', 14],
  [422, 423, 'earthDamage', 88],
  [424, 425, 'fireDamage', 89],
  [426, 427, 'waterDamage', 90],
  [428, 429, 'airDamage', 91],
  [430, 431, 'neutralDamage', 92],
  [418, 419, 'criticalDamage', 86],
  [414, 415, 'pushDamage', 84],
  [225, 0, 'trapDamage', 70],
  [226, 0, 'trapPower', 69],
  [178, 179, 'heals', 49],
  [220, 0, 'reflect', 50],
  [410, 411, 'apReduction', 82],
  [412, 413, 'mpReduction', 83],
  [160, 162, 'apParry', 27],
  [161, 163, 'mpParry', 28],
  [753, 755, 'tackleBlock', 79],
  [752, 754, 'tackleEvade', 78],
  [174, 175, 'initiative', 44],
  [176, 177, 'prospecting', 48],
  [210, 215, 'earthResPct', 33],
  [213, 218, 'fireResPct', 34],
  [211, 216, 'waterResPct', 35],
  [212, 217, 'airResPct', 36],
  [214, 219, 'neutralResPct', 37],
  [240, 245, 'earthRes', 54],
  [243, 248, 'fireRes', 55],
  [241, 246, 'waterRes', 56],
  [242, 247, 'airRes', 57],
  [244, 249, 'neutralRes', 58],
  [420, 421, 'criticalRes', 87],
  [416, 417, 'pushRes', 85],
  [2800, 2801, 'meleeDamagePct', 125],
  [2804, 2805, 'rangedDamagePct', 120],
  [2808, 2809, 'weaponDamagePct', 122],
  [2812, 2813, 'spellDamagePct', 123],
  [2803, 2802, 'meleeResPct', 124],
  [2807, 2806, 'rangedResPct', 121],
  [2811, 2810, 'weaponResPct', 142],
  [2815, 2814, 'spellResPct', 141],
]

/** Parchemins de caractéristiques (« +#1 <stat> additionnelle »). */
const SCROLL_LINES: readonly (readonly [number, StatKey])[] = [
  [606, 'wisdom'],
  [607, 'strength'],
  [608, 'chance'],
  [609, 'agility'],
  [610, 'vitality'],
  [611, 'intelligence'],
]

/**
 * Effets de contexte `stat` volontairement ignorés : pas de clé `Stats` correspondante et aucun rôle en combat
 * pour le simulateur (Pods 158/159, Échecs critiques 122, Réductions physique/magique 173/183/184 absentes des
 * objets, Puissance glyphes 1166 absente des objets).
 */
export const IGNORED_STAT_EFFECT_IDS: ReadonlySet<number> = new Set([122, 158, 159, 173, 183, 184, 1166])

/** Borne (exclue) des effectIds indexés dans les tables denses. */
const MAX_EFFECT_ID = 4096

const EFFECT_STAT: (StatKey | null)[] = new Array<StatKey | null>(MAX_EFFECT_ID).fill(null)
const EFFECT_SIGN = new Int8Array(MAX_EFFECT_ID)
/** effectId → index d'accumulateur (`STAT_INDEX`), −1 si l'effet n'est pas une caractéristique. */
const EFFECT_STAT_INDEX = new Int16Array(MAX_EFFECT_ID).fill(-1)

const positiveByStat: Partial<Record<StatKey, number>> = {}
const negativeByStat: Partial<Record<StatKey, number>> = {}
const statByCharacteristic: Record<number, StatKey> = {}

for (const [plus, minus, stat, characteristicId] of STAT_LINES) {
  EFFECT_STAT[plus] = stat
  EFFECT_SIGN[plus] = 1
  positiveByStat[stat] = plus
  if (minus) {
    EFFECT_STAT[minus] = stat
    EFFECT_SIGN[minus] = -1
    negativeByStat[stat] = minus
  }
  statByCharacteristic[characteristicId] = stat
}
for (const [effectId, stat] of SCROLL_LINES) {
  EFFECT_STAT[effectId] = stat
  EFFECT_SIGN[effectId] = 1
}
for (let id = 0; id < MAX_EFFECT_ID; id++) {
  const stat = EFFECT_STAT[id]
  if (stat) EFFECT_STAT_INDEX[id] = STAT_INDEX[stat]
}

/** Effet « bonus » d'une caractéristique (ex. `strength` → 118). */
export const POSITIVE_EFFECT_BY_STAT: Readonly<Partial<Record<StatKey, number>>> = positiveByStat
/** Effet « malus » d'une caractéristique (ex. `strength` → 157). */
export const NEGATIVE_EFFECT_BY_STAT: Readonly<Partial<Record<StatKey, number>>> = negativeByStat
/** Id de caractéristique DofusDB → clé `Stats` (utilisé par les plafonds 2897 : 1 PA, 23 PM, 19 PO, 26 invocations…). */
export const STAT_BY_CHARACTERISTIC_ID: Readonly<Record<number, StatKey>> = statByCharacteristic

/** Caractéristique modifiée par un effet d'objet, ou `undefined` si l'effet n'est pas une caractéristique. */
export function itemEffectStat(effectId: number): StatKey | undefined {
  return (effectId >= 0 && effectId < MAX_EFFECT_ID && EFFECT_STAT[effectId]) || undefined
}

/** Index d'accumulateur (`STAT_ORDER`) de la caractéristique d'un effet, −1 si ce n'est pas une caractéristique. */
export function itemEffectStatIndex(effectId: number): number {
  if (!(effectId >= 0 && effectId < MAX_EFFECT_ID)) return -1
  return EFFECT_STAT_INDEX[effectId] ?? -1 // undefined pour un id non entier
}

/** Signe d'un effet de caractéristique (+1 bonus, −1 malus, 0 si ce n'est pas une caractéristique). */
export function itemEffectSign(effectId: number): StatSign | 0 {
  return effectId >= 0 && effectId < MAX_EFFECT_ID ? ((EFFECT_SIGN[effectId] ?? 0) as StatSign | 0) : 0
}

/** Valeur signée d'une ligne : `signedEffectValue(215, 5)` = −5 (% Rés. Terre). 0 si l'effet n'est pas une caractéristique. */
export function signedEffectValue(effectId: number, magnitude: number): number {
  return itemEffectSign(effectId) * magnitude
}

/** Effet DofusDB correspondant à une caractéristique et un signe (`effectIdForStat('ap')` = 111). */
export function effectIdForStat(stat: StatKey, sign: StatSign = 1): number | undefined {
  return sign > 0 ? positiveByStat[stat] : negativeByStat[stat]
}

/**
 * Ajoute à `stats` une ligne d'objet/de panoplie : `value` est le montant positif (jet), le signe vient de l'effet.
 * Retourne `false` (sans rien modifier) si l'effet n'est pas une caractéristique (ligne d'arme, sort passif,
 * titre, plafond 2897…).
 */
export function applyItemEffect(stats: Stats, effectId: number, value: number, factor = 1): boolean {
  if (effectId < 0 || effectId >= MAX_EFFECT_ID) return false
  const stat = EFFECT_STAT[effectId]
  if (!stat) return false
  stats[stat] += EFFECT_SIGN[effectId] * value * factor
  return true
}
