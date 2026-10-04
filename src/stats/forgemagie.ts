/**
 * Forgemagie : poids des runes, overmax, exos (PA/PM/PO/…), transcendances et paliers de coût.
 *
 * Source : docs/research/equipment.md §11 et data/research/forgemagie.json (tables recopiées ici et vérifiées contre
 * le JSON par tests/stats-forgemagie.test.ts). Règles appliquées :
 *  - poids d'une ligne = valeur × poids par point (`|effectPowerRate|`) ; une ligne ne peut pas dépasser 101 de poids
 *    (over ou exo), sauf si le jet max naturel de l'objet dépasse déjà 101 : dans ce cas, pas d'over au-delà du jet max ;
 *  - exo = ligne absente de l'objet de base ; over = ligne existante poussée au-delà de son jet max ;
 *  - un seul exo PA, un seul exo PM et un seul exo PO comptés par personnage (devblog 2.3.4) ; exo Invocation non limité ;
 *  - transcendance (Ta/Pata/Rata, 100 % de réussite) : objet sans over ni exo (au mieux au jet parfait), une seule par
 *    objet (elle verrouille l'objet), niveau de l'objet ≥ niveau de la rune (INCERTAIN) ; si elle crée un over sur une
 *    ligne existante, le plafond de 101 de poids s'applique (next-stage 03/2026) ;
 *  - Dofus, trophées, prysmaradites, familiers, montiliers et montures ne se forgemagent pas.
 * Paliers de coût (`costTier`, 0-5) : exo PA/PM 5, PO 4, transcendance Do Per So 4, autres transcendances 3,
 * Invo/Do/Do Per So 3, Pui/Do Crit/Ré % (et autres exos) 2, over 1. Les prix réels varient selon les serveurs (INCERTAIN).
 */
import type { StatKey } from '../core/types'
import type { EquipmentSlot, ItemData } from '../data/model'
import { itemEffectSign, itemEffectStat } from './effects'

export const LINE_WEIGHT_CAP = 101

/**
 * Poids d'un point de caractéristique (forgemagie.json → runeWeights.weightPerPoint), par clé `Stats`.
 * `forgeable: false` : pas de rune classique (poids utile seulement pour la « puissance » d'un objet).
 */
const RUNE_WEIGHTS: readonly (readonly [StatKey, number, boolean])[] = [
  ['ap', 100, true],
  ['mp', 90, true],
  ['range', 51, true],
  ['summons', 30, true],
  ['damage', 20, true],
  ['critical', 10, true],
  ['heals', 10, true],
  ['meleeDamagePct', 15, true],
  ['rangedDamagePct', 15, true],
  ['weaponDamagePct', 15, true],
  ['spellDamagePct', 15, true],
  ['meleeResPct', 10, true],
  ['rangedResPct', 10, true],
  ['weaponResPct', 15, false],
  ['spellResPct', 15, false],
  ['apReduction', 7, true],
  ['mpReduction', 7, true],
  ['apParry', 7, true],
  ['mpParry', 7, true],
  ['earthResPct', 6, true],
  ['fireResPct', 6, true],
  ['waterResPct', 6, true],
  ['airResPct', 6, true],
  ['neutralResPct', 6, true],
  ['earthDamage', 5, true],
  ['fireDamage', 5, true],
  ['waterDamage', 5, true],
  ['airDamage', 5, true],
  ['neutralDamage', 5, true],
  ['criticalDamage', 5, true],
  ['pushDamage', 5, true],
  ['trapDamage', 5, true],
  ['reflect', 5, true],
  ['tackleBlock', 4, true],
  ['tackleEvade', 4, true],
  ['wisdom', 3, true],
  ['prospecting', 3, true],
  ['power', 2, true],
  ['trapPower', 2, true],
  ['earthRes', 2, true],
  ['fireRes', 2, true],
  ['waterRes', 2, true],
  ['airRes', 2, true],
  ['neutralRes', 2, true],
  ['criticalRes', 2, true],
  ['pushRes', 2, true],
  ['strength', 1, true],
  ['intelligence', 1, true],
  ['chance', 1, true],
  ['agility', 1, true],
  ['vitality', 0.2, true],
  ['initiative', 0.1, true],
]

const weightByStat: Partial<Record<StatKey, number>> = {}
const forgeableStats = new Set<StatKey>()
for (const [stat, weight, forgeable] of RUNE_WEIGHTS) {
  weightByStat[stat] = weight
  if (forgeable) forgeableStats.add(stat)
}

/** Poids par point (rune) d'une caractéristique. */
export const RUNE_WEIGHT_PER_POINT: Readonly<Partial<Record<StatKey, number>>> = weightByStat
/** Caractéristiques pour lesquelles une rune de forgemagie existe. */
export const FORGEABLE_STATS: ReadonlySet<StatKey> = forgeableStats

/** Caractéristiques dont un seul exo est compté par personnage. */
export const ONCE_PER_CHARACTER_EXO_STATS: ReadonlySet<StatKey> = new Set<StatKey>(['ap', 'mp', 'range'])

/**
 * Emplacements forgemageables. Bouclier : INCERTAIN (inclus ; exos PA/PM/PO non « typiques »).
 * Dofus/trophées/prysmaradites (`dofus`) et familiers/montures (`pet`) : non forgemageables.
 */
export const FORGEABLE_SLOTS: ReadonlySet<EquipmentSlot> = new Set<EquipmentSlot>([
  'amulet',
  'ring',
  'belt',
  'boots',
  'hat',
  'cloak',
  'shield',
  'weapon',
])

/** Emplacements où les exos PA/PM/PO sont réalistes (forgemagie.json → exoOptions.typicalSlots). */
export const TYPICAL_EXO_SLOTS: ReadonlySet<EquipmentSlot> = new Set<EquipmentSlot>([
  'ring',
  'amulet',
  'hat',
  'cloak',
  'boots',
  'belt',
])

export type ForgeKind = 'exo' | 'over' | 'transcendence'

/**
 * Ligne de forgemagie ajoutée à un objet (`EquippedItem.exos`). Seul `kind: 'transcendence'` est significatif ;
 * exo / over sont toujours déduits de l'objet (`over` s'il possède déjà une ligne bonus de cette caractéristique,
 * sinon `exo`), cf. `forgeKind`.
 */
export interface ExoLine {
  stat: StatKey
  value: number
  kind?: ForgeKind
}

export interface TranscendenceRune {
  itemId: number
  name: string
  tier: 'ta' | 'pata' | 'rata'
  level: number
  stat: StatKey
  value: number
}

/**
 * Runes de transcendance (forgemagie.json → transcendanceRunes), hors Pods (pas de clé `Stats`) :
 * [itemId, nom, palier, niveau, stat, valeur].
 */
const TRANSCENDENCE: readonly (readonly [number, string, TranscendenceRune['tier'], number, StatKey, number])[] = [
  [20561, 'Rune Ta Age', 'ta', 104, 'agility', 10],
  [20562, 'Rune Pata Age', 'pata', 126, 'agility', 15],
  [20563, 'Rune Rata Age', 'rata', 148, 'agility', 20],
  [20605, 'Rune Ta Do Air', 'ta', 144, 'airDamage', 2],
  [20606, 'Rune Pata Do Air', 'pata', 166, 'airDamage', 4],
  [20607, 'Rune Rata Do Air', 'rata', 188, 'airDamage', 6],
  [20623, 'Rune Ta Ré Pa', 'ta', 104, 'apParry', 2],
  [20624, 'Rune Pata Ré Pa', 'pata', 126, 'apParry', 4],
  [20625, 'Rune Rata Ré Pa', 'rata', 148, 'apParry', 6],
  [20629, 'Rune Ta Ret Pa', 'ta', 104, 'apReduction', 2],
  [20630, 'Rune Pata Ret Pa', 'pata', 126, 'apReduction', 3],
  [20631, 'Rune Rata Ret Pa', 'rata', 148, 'apReduction', 4],
  [20564, 'Rune Ta Cha', 'ta', 104, 'chance', 10],
  [20565, 'Rune Pata Cha', 'pata', 126, 'chance', 15],
  [20566, 'Rune Rata Cha', 'rata', 148, 'chance', 20],
  [20585, 'Rune Ta Do Cri', 'ta', 166, 'criticalDamage', 6],
  [20586, 'Rune Pata Do Cri', 'pata', 188, 'criticalDamage', 8],
  [20640, 'Rune Ta Cri', 'ta', 164, 'critical', 1],
  [20641, 'Rune Pata Cri', 'pata', 188, 'critical', 2],
  [20581, 'Rune Ta Ré Cri', 'ta', 166, 'criticalRes', 9],
  [20582, 'Rune Pata Ré Cri', 'pata', 188, 'criticalRes', 12],
  [20596, 'Rune Ta Do Terre', 'ta', 144, 'earthDamage', 2],
  [20597, 'Rune Pata Do Terre', 'pata', 166, 'earthDamage', 4],
  [20598, 'Rune Rata Do Terre', 'rata', 188, 'earthDamage', 6],
  [20617, 'Rune Ta Fui', 'ta', 104, 'tackleEvade', 4],
  [20618, 'Rune Pata Fui', 'pata', 126, 'tackleEvade', 6],
  [20619, 'Rune Rata Fui', 'rata', 148, 'tackleEvade', 8],
  [20599, 'Rune Ta Do Feu', 'ta', 144, 'fireDamage', 2],
  [20600, 'Rune Pata Do Feu', 'pata', 166, 'fireDamage', 4],
  [20601, 'Rune Rata Do Feu', 'rata', 188, 'fireDamage', 6],
  [20642, 'Rune Ta So', 'ta', 124, 'heals', 4],
  [20643, 'Rune Pata So', 'pata', 146, 'heals', 7],
  [20644, 'Rune Rata So', 'rata', 168, 'heals', 10],
  [20570, 'Rune Ta Ini', 'ta', 104, 'initiative', 100],
  [20571, 'Rune Pata Ini', 'pata', 126, 'initiative', 150],
  [20572, 'Rune Rata Ini', 'rata', 148, 'initiative', 200],
  [20492, 'Rune Ta Ine', 'ta', 104, 'intelligence', 10],
  [20556, 'Rune Pata Ine', 'pata', 126, 'intelligence', 15],
  [20557, 'Rune Rata Ine', 'rata', 148, 'intelligence', 20],
  [20616, 'Rune Ta Do Per Mé', 'ta', 200, 'meleeDamagePct', 1],
  [20612, 'Rune Ta Ré Per Mé', 'ta', 200, 'meleeResPct', 1],
  [20626, 'Rune Ta Ré Pme', 'ta', 104, 'mpParry', 2],
  [20627, 'Rune Pata Ré Pme', 'pata', 126, 'mpParry', 4],
  [20628, 'Rune Rata Ré Pme', 'rata', 148, 'mpParry', 6],
  [20632, 'Rune Ta Ret Pme', 'ta', 104, 'mpReduction', 2],
  [20633, 'Rune Pata Ret Pme', 'pata', 126, 'mpReduction', 3],
  [20634, 'Rune Rata Ret Pme', 'rata', 148, 'mpReduction', 4],
  [20608, 'Rune Ta Do Neutre', 'ta', 144, 'neutralDamage', 2],
  [20609, 'Rune Pata Do Neutre', 'pata', 166, 'neutralDamage', 4],
  [20610, 'Rune Rata Do Neutre', 'rata', 188, 'neutralDamage', 6],
  [20576, 'Rune Ta Pui', 'ta', 124, 'power', 6],
  [20577, 'Rune Pata Pui', 'pata', 146, 'power', 9],
  [20578, 'Rune Rata Pui', 'rata', 168, 'power', 12],
  [20583, 'Rune Ta Do Pou', 'ta', 166, 'pushDamage', 6],
  [20584, 'Rune Pata Do Pou', 'pata', 188, 'pushDamage', 8],
  [20579, 'Rune Ta Ré Pou', 'ta', 166, 'pushRes', 9],
  [20580, 'Rune Pata Ré Pou', 'pata', 188, 'pushRes', 12],
  [20615, 'Rune Ta Do Per Di', 'ta', 200, 'rangedDamagePct', 1],
  [20611, 'Rune Ta Ré Per Di', 'ta', 200, 'rangedResPct', 1],
  [20638, 'Rune Ta Ré Per Air', 'ta', 188, 'airResPct', 2],
  [20635, 'Rune Ta Ré Per Terre', 'ta', 188, 'earthResPct', 2],
  [20636, 'Rune Ta Ré Per Feu', 'ta', 188, 'fireResPct', 2],
  [20639, 'Rune Ta Ré Per Neutre', 'ta', 188, 'neutralResPct', 2],
  [20637, 'Rune Ta Ré Per Eau', 'ta', 188, 'waterResPct', 2],
  [20613, 'Rune Ta Do Per So', 'ta', 200, 'spellDamagePct', 1],
  [20558, 'Rune Ta Fo', 'ta', 104, 'strength', 10],
  [20559, 'Rune Pata Fo', 'pata', 126, 'strength', 15],
  [20560, 'Rune Rata Fo', 'rata', 148, 'strength', 20],
  [20620, 'Rune Ta Tac', 'ta', 104, 'tackleBlock', 4],
  [20621, 'Rune Pata Tac', 'pata', 126, 'tackleBlock', 6],
  [20622, 'Rune Rata Tac', 'rata', 148, 'tackleBlock', 8],
  [20567, 'Rune Ta Vi', 'ta', 124, 'vitality', 50],
  [20568, 'Rune Pata Vi', 'pata', 146, 'vitality', 75],
  [20569, 'Rune Rata Vi', 'rata', 168, 'vitality', 100],
  [20602, 'Rune Ta Do Eau', 'ta', 144, 'waterDamage', 2],
  [20603, 'Rune Pata Do Eau', 'pata', 166, 'waterDamage', 4],
  [20604, 'Rune Rata Do Eau', 'rata', 188, 'waterDamage', 6],
  [20614, 'Rune Ta Do Per Ar', 'ta', 200, 'weaponDamagePct', 1],
]

export const TRANSCENDENCE_RUNES: readonly TranscendenceRune[] = TRANSCENDENCE.map(
  ([itemId, name, tier, level, stat, value]) => ({ itemId, name, tier, level, stat, value }),
)

/**
 * Exos « classiques » (forgemagie.json → exoOptions) : [id, stat, valeur min, valeur max, palier de coût, rareté].
 * Les PA/PM/PO valent toujours 1. Ré % : une option par élément.
 */
const EXO_CATALOG: readonly (readonly [string, StatKey, number, number, number, string])[] = [
  ['exoPA', 'ap', 1, 1, 5, 'très rare'],
  ['exoPM', 'mp', 1, 1, 5, 'très rare'],
  ['exoPO', 'range', 1, 1, 4, 'rare'],
  ['exoSummon', 'summons', 1, 1, 3, 'peu commun'],
  ['exoDamage', 'damage', 1, 5, 3, 'peu commun'],
  ['exoSpellDamagePercent', 'spellDamagePct', 1, 3, 3, 'rare'],
  ['exoPower', 'power', 5, 30, 2, 'commun'],
  ['exoCriticalDamage', 'criticalDamage', 3, 10, 2, 'commun'],
  ['exoResPercent:earth', 'earthResPct', 2, 8, 2, 'commun'],
  ['exoResPercent:fire', 'fireResPct', 2, 8, 2, 'commun'],
  ['exoResPercent:water', 'waterResPct', 2, 8, 2, 'commun'],
  ['exoResPercent:air', 'airResPct', 2, 8, 2, 'commun'],
  ['exoResPercent:neutral', 'neutralResPct', 2, 8, 2, 'commun'],
]

const exoCostTierByStat: Partial<Record<StatKey, number>> = {}
for (const [, stat, , , tier] of EXO_CATALOG) exoCostTierByStat[stat] = tier

/** Palier de coût d'un over (overs marginaux au niveau 200, cf. §11.2). */
export const OVER_COST_TIER = 1
/** Palier de coût d'un exo « via puits » hors catalogue (INCERTAIN). */
export const GENERIC_EXO_COST_TIER = 2

export function runeWeightPerPoint(stat: StatKey): number | undefined {
  return weightByStat[stat]
}

/** Poids d'une ligne (valeur × poids par point). `Infinity` si la caractéristique n'a pas de poids connu. */
export function lineWeight(stat: StatKey, value: number): number {
  const w = weightByStat[stat]
  return w === undefined ? Infinity : value * w
}

/**
 * Valeur maximale d'une ligne d'objet après forgemagie (over/exo) : ⌊101 / poids⌋, ou le jet max naturel s'il est
 * déjà supérieur (aucun over possible si le jet max naturel dépasse 101 de poids). 0 si la stat n'est pas forgeable.
 */
export function maxLineValue(stat: StatKey, naturalMax = 0): number {
  const w = weightByStat[stat]
  if (w === undefined || !forgeableStats.has(stat)) return Math.max(0, naturalMax)
  if (naturalMax * w > LINE_WEIGHT_CAP) return naturalMax
  return Math.max(naturalMax, Math.floor(LINE_WEIGHT_CAP / w + 1e-9))
}

/** L'objet peut-il être forgemagé (emplacement forgeable) ? */
export function isForgeable(item: ItemData): boolean {
  return FORGEABLE_SLOTS.has(item.slot)
}

/** Jet max naturel (positif) et présence d'une ligne malus pour une caractéristique de l'objet. */
function naturalLine(item: ItemData, stat: StatKey): { max: number; hasMalus: boolean; hasLine: boolean } {
  let max = 0
  let hasMalus = false
  let hasLine = false
  for (const e of item.effects) {
    if (itemEffectStat(e.effectId) !== stat) continue
    hasLine = true
    if (itemEffectSign(e.effectId) < 0) hasMalus = true
    else max = Math.max(max, e.min, e.max)
  }
  return { max, hasMalus, hasLine }
}

/**
 * Type de ligne d'un exo sur un objet. Seule la transcendance est prise telle que déclarée (elle ne se déduit pas
 * de l'objet) ; exo / over sont TOUJOURS déduits des données : over si l'objet possède déjà une ligne bonus de cette
 * caractéristique, exo sinon. Un `kind: 'over'` déclaré sur une ligne absente ne doit pas permettre de contourner
 * la limite d'un exo PA/PM/PO par personnage.
 */
export function forgeKind(item: ItemData, line: ExoLine): ForgeKind {
  if (line.kind === 'transcendence') return 'transcendence'
  return naturalLine(item, line.stat).max > 0 ? 'over' : 'exo'
}

/** Montant de forgemagie valide : entier strictement positif. */
export function isValidForgeValue(v: number): boolean {
  return Number.isInteger(v) && v > 0
}

/** Palier de coût (0-5) d'une ligne de forgemagie sur un objet. */
export function exoCostTier(item: ItemData, line: ExoLine): number {
  const kind = forgeKind(item, line)
  if (kind === 'transcendence') return line.stat === 'spellDamagePct' ? 4 : 3
  if (kind === 'over') return OVER_COST_TIER
  return exoCostTierByStat[line.stat] ?? GENERIC_EXO_COST_TIER
}

/** Palier de coût global d'un objet forgemagé (maximum de ses lignes ; 0 sans forgemagie). */
export function itemForgeCostTier(item: ItemData, lines: readonly ExoLine[] | undefined): number {
  let tier = 0
  if (lines) for (const l of lines) tier = Math.max(tier, exoCostTier(item, l))
  return tier
}

export interface ExoOption {
  /** Identifiant stable (ex. "exoPA", "over:strength", "transcendence:20613"). */
  id: string
  kind: ForgeKind
  stat: StatKey
  /** Valeur réaliste maximale de la ligne ajoutée (utilisée par `exo`). */
  value: number
  minValue: number
  /** Poids de la ligne ajoutée (valeur × poids/pt). */
  weight: number
  costTier: number
  rarity: string
  /** Un seul exemplaire compté par personnage (exos PA/PM/PO). */
  oncePerCharacter: boolean
  /** Ligne prête à mettre dans `EquippedItem.exos`. */
  exo: ExoLine
}

export interface ExoOptionsFilter {
  /** Inclure les overs (lignes existantes poussées jusqu'à 101 de poids). Défaut : vrai. */
  overs?: boolean
  /** Inclure les transcendances (meilleur palier disponible par caractéristique). Défaut : vrai. */
  transcendence?: boolean
  /** Autoriser les exos PA/PM/PO hors emplacements typiques (arme, bouclier). Défaut : faux. */
  anySlot?: boolean
  /** Palier de coût maximal accepté. Défaut : 5. */
  maxCostTier?: number
}

/**
 * Options de forgemagie réalistes pour un objet (une seule ligne ajoutée par option ; combiner plusieurs options
 * sur un même objet reste possible mais une transcendance exclut tout over/exo).
 */
export function listExoOptions(item: ItemData, filter: ExoOptionsFilter = {}): ExoOption[] {
  if (!isForgeable(item)) return []
  const maxTier = filter.maxCostTier ?? 5
  const out: ExoOption[] = []
  const push = (o: Omit<ExoOption, 'exo' | 'weight' | 'oncePerCharacter'>): void => {
    if (o.costTier > maxTier || o.value <= 0) return
    out.push({
      ...o,
      weight: lineWeight(o.stat, o.value),
      oncePerCharacter: o.kind === 'exo' && ONCE_PER_CHARACTER_EXO_STATS.has(o.stat),
      exo: { stat: o.stat, value: o.value, kind: o.kind },
    })
  }

  for (const [id, stat, min, max, costTier, rarity] of EXO_CATALOG) {
    const nat = naturalLine(item, stat)
    if (nat.hasLine) continue // ligne déjà présente (bonus ⇒ over traité plus bas, malus ⇒ pas d'exo)
    if (ONCE_PER_CHARACTER_EXO_STATS.has(stat) && !filter.anySlot && !TYPICAL_EXO_SLOTS.has(item.slot)) continue
    const value = Math.min(max, maxLineValue(stat, 0))
    push({ id, kind: 'exo', stat, value, minValue: Math.min(min, value), costTier, rarity })
  }

  if (filter.overs ?? true) {
    const seen = new Set<StatKey>()
    for (const e of item.effects) {
      const stat = itemEffectStat(e.effectId)
      if (!stat || seen.has(stat) || itemEffectSign(e.effectId) < 0) continue
      seen.add(stat)
      const nat = naturalLine(item, stat)
      const room = maxLineValue(stat, nat.max) - nat.max
      if (room <= 0) continue
      push({ id: `over:${stat}`, kind: 'over', stat, value: room, minValue: 1, costTier: OVER_COST_TIER, rarity: 'commun' })
    }
  }

  if (filter.transcendence ?? true) {
    // Meilleur palier par caractéristique parmi les runes de niveau ≤ objet ET compatibles avec le plafond de 101 de
    // poids quand la rune s'ajoute à une ligne bonus existante (jet parfait supposé, cf. checkItemForgemagie).
    const best = new Map<StatKey, TranscendenceRune>()
    const room = new Map<StatKey, number>()
    for (const rune of TRANSCENDENCE_RUNES) {
      if (rune.level > item.level) continue
      let r = room.get(rune.stat)
      if (r === undefined) {
        const nat = naturalLine(item, rune.stat).max
        r = nat > 0 ? maxLineValue(rune.stat, nat) - nat : Infinity
        room.set(rune.stat, r)
      }
      if (rune.value > r) continue
      const cur = best.get(rune.stat)
      if (!cur || rune.value > cur.value) best.set(rune.stat, rune)
    }
    for (const rune of best.values()) {
      push({
        id: `transcendence:${rune.itemId}`,
        kind: 'transcendence',
        stat: rune.stat,
        value: rune.value,
        minValue: rune.value,
        costTier: rune.stat === 'spellDamagePct' ? 4 : 3,
        rarity: 'rare (Songes Infinis)',
      })
    }
  }
  return out
}

/**
 * Vérifie la forgemagie d'un objet équipé. `lineValues[i]` = montant (positif) retenu pour `item.effects[i]`
 * (jet choisi, éventuellement au-delà du jet max = over). Retourne la liste des violations (vide si valide).
 */
export function checkItemForgemagie(
  item: ItemData,
  lineValues: ArrayLike<number>,
  exos: readonly ExoLine[] | undefined,
): string[] {
  const errors: string[] = []
  const name = item.name
  const hasExos = !!exos && exos.length > 0
  let transcendences = 0
  let forged = false // over ou exo présent

  // Lignes naturelles : jets au-delà du max (over via `rolls`).
  const effects = item.effects
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i]
    const stat = itemEffectStat(e.effectId)
    if (!stat) continue
    const v = lineValues[i]
    if (!(v >= 0) || !Number.isInteger(v)) errors.push(`${name} : jet invalide (${v}) sur la ligne ${e.effectId}`)
    if (itemEffectSign(e.effectId) > 0 && v > Math.max(e.min, e.max)) forged = true
  }

  if (hasExos) {
    if (!isForgeable(item)) errors.push(`${name} : objet non forgemageable (exo/over/transcendance impossible)`)
    for (const line of exos) {
      if (!isValidForgeValue(line.value)) errors.push(`${name} : valeur d'exo invalide (${line.stat} ${line.value})`)
      const kind = forgeKind(item, line)
      if (kind === 'transcendence') {
        transcendences++
        const rune = TRANSCENDENCE_RUNES.find(r => r.stat === line.stat && r.value === line.value)
        if (!rune) errors.push(`${name} : aucune rune de transcendance « ${line.stat} +${line.value} »`)
        else if (rune.level > item.level) errors.push(`${name} : ${rune.name} (niv. ${rune.level}) trop haute pour l'objet`)
      } else {
        forged = true
        if (!forgeableStats.has(line.stat)) errors.push(`${name} : aucune rune pour la caractéristique ${line.stat}`)
      }
    }
  }
  if (transcendences > 1) errors.push(`${name} : une seule rune de transcendance par objet`)
  if (transcendences > 0 && forged) errors.push(`${name} : transcendance incompatible avec un over ou un exo`)

  // Plafond de poids par caractéristique : ligne naturelle (jet retenu) + exos/overs/transcendances du même type
  // (une transcendance qui crée un over sur une ligne existante reste soumise au plafond, cf. equipment.md §11.2).
  if (forged || transcendences > 0) {
    const checked = new Set<StatKey>()
    const check = (stat: StatKey): void => {
      if (checked.has(stat)) return
      checked.add(stat)
      let total = 0
      let naturalMax = 0
      for (let i = 0; i < effects.length; i++) {
        const e = effects[i]
        if (itemEffectStat(e.effectId) !== stat) continue
        const sign = itemEffectSign(e.effectId)
        total += sign * lineValues[i]
        if (sign > 0) naturalMax = Math.max(naturalMax, e.min, e.max)
      }
      if (exos) for (const l of exos) if (l.stat === stat) total += l.value
      if (total <= naturalMax) return
      const cap = maxLineValue(stat, naturalMax)
      if (total > cap) {
        errors.push(
          `${name} : ligne ${stat} à ${total} au-delà du plafond de forgemagie (${cap}, poids max ${LINE_WEIGHT_CAP})`,
        )
      }
    }
    for (const e of effects) {
      const stat = itemEffectStat(e.effectId)
      if (stat) check(stat)
    }
    if (exos) for (const l of exos) check(l.stat)
  }
  return errors
}
