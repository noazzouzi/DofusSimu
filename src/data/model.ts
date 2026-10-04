/**
 * Modèle de données « runtime » du simulateur : forme normalisée des sorts, objets et monstres,
 * indépendante du format brut DofusDB (voir src/data/loaders.ts pour la conversion).
 */
import type { Stats } from '../core/types'

/** Zone d'effet d'un sort (zoneDescr DofusDB). `shape` est le caractère de forme ('P', 'C', 'X', 'L', ...). */
export interface ZoneSpec {
  shape: string
  /** Taille principale (param1) : rayon / longueur. */
  size: number
  /** Taille secondaire (param2) : rayon minimal (anneaux) ou largeur selon la forme. */
  minSize: number
  /** Baisse d'efficacité (%) par cellule d'éloignement du centre de la zone. */
  decreaseStepPct: number
  /** Nombre maximal de paliers de baisse appliqués. */
  maxDecreaseCount: number
  /** La zone (ligne) s'arrête sur la première entité rencontrée. */
  stopAtTarget: boolean
}

/** Un effet de sort ou d'arme, avec les champs bruts nécessaires à son interprétation. */
export interface EffectData {
  effectId: number
  order: number
  diceNum: number
  diceSide: number
  value: number
  duration: number
  delay: number
  /** Probabilité d'application en % (0 = toujours). */
  random: number
  group: number
  targetMask: string
  targetId: number
  /** Déclencheurs ('I' = immédiat, sinon conditions de déclenchement d'un buff). */
  triggers: string
  dispellable: number
  /** Élément (-1 = aucun). */
  element: number
  zone: ZoneSpec
  /** Durée (tours) d'un buff déclencheur (triggers ≠ 'I') : effectTriggerDuration DofusDB. */
  triggerDuration?: number
}

export interface SpellLevelData {
  spellId: number
  grade: number
  apCost: number
  minRange: number
  range: number
  rangeBoostable: boolean
  castInLine: boolean
  castInDiagonal: boolean
  castTestLos: boolean
  needFreeCell: boolean
  needTakenCell: boolean
  needFreeTrapCell: boolean
  maxCastPerTurn: number
  maxCastPerTarget: number
  /** Délai de relance (tours). */
  minCastInterval: number
  initialCooldown: number
  globalCooldown: number
  minPlayerLevel: number
  /** Probabilité de coup critique de base (%), 0 = ne peut pas faire de critique. */
  critChance: number
  maxStack: number
  /** Condition d'états du lanceur (ex. "E123&e456"). */
  statesCriterion: string
  effects: EffectData[]
  criticalEffects: EffectData[]
}

export interface SpellData {
  id: number
  name: string
  nameEn?: string
  description?: string
  breedId?: number
  levels: SpellLevelData[]
}

export type EquipmentSlot =
  | 'amulet'
  | 'ring'
  | 'belt'
  | 'boots'
  | 'hat'
  | 'cloak'
  | 'shield'
  | 'weapon'
  | 'dofus' // dofus, trophées, prysmaradites
  | 'pet' // familiers, montiliers, montures
  | 'other'

/** Plage de valeur d'un effet d'objet (jet min..max). */
export interface ItemEffectRange {
  effectId: number
  min: number
  max: number
}

export interface WeaponData {
  apCost: number
  minRange: number
  range: number
  critChance: number
  critBonus: number
  maxCastPerTurn: number
  castInLine: boolean
  castInDiagonal: boolean
  castTestLos: boolean
  twoHanded: boolean
}

export interface ItemData {
  id: number
  name: string
  nameEn?: string
  typeId: number
  typeName?: string
  slot: EquipmentSlot
  level: number
  setId: number | null
  /** Conditions d'équipement brutes (ex. "PA<12&CS>300"). */
  conditions: string
  effects: ItemEffectRange[]
  weapon?: WeaponData
  isLegendary?: boolean
}

export interface ItemSetData {
  id: number
  name: string
  items: number[]
  /** bonuses[n] = effets accordés quand n objets de la panoplie sont équipés. */
  bonuses: Record<number, ItemEffectRange[]>
}

export interface MonsterGrade {
  grade: number
  level: number
  lifePoints: number
  ap: number
  mp: number
  stats: Partial<Stats>
}

export interface MonsterData {
  id: number
  name: string
  nameEn?: string
  raceId: number
  isBoss: boolean
  isMiniBoss: boolean
  canTackle: boolean
  canBePushed: boolean
  canSwitchPos: boolean
  canPlay: boolean
  useSummonSlot: boolean
  tags: string[]
  spells: number[]
  grades: MonsterGrade[]
}

export interface BreedData {
  id: number
  name: string
  nameEn?: string
  description?: string
  roles: string[]
  /** Paires de variantes de sorts [sortA, sortB] dans l'ordre du jeu. */
  spellPairs: [number, number][]
  /** Paliers de coût des points de caractéristiques par stat (DofusDB statsPointsFor*). */
  statPointCosts?: Record<string, [number, number][]>
}

/** Données d'une carte de combat. */
export interface MapCell {
  id: number
  walkable: boolean
  los: boolean
  /** 0 = aucune, 1 = placement équipe 0 (joueurs), 2 = placement équipe 1 (monstres). */
  placement: 0 | 1 | 2
}

export interface MapData {
  id: number
  name?: string
  cells: MapCell[]
  approximate?: boolean
}
