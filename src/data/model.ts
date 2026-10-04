/**
 * Modèle de données « runtime » du simulateur : forme normalisée des sorts, objets et monstres,
 * indépendante du format brut DofusDB (voir src/data/convert.ts pour la conversion, src/data/raw.ts pour le format brut).
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
  // Drapeaux additionnels de zoneDescr (optionnels pour compatibilité, toujours renseignés par src/data/convert.ts) :
  /** includeCarried : la zone touche aussi l'entité portée (Pandawa). */
  includeCarried?: boolean
  /** onlyAffectIfInSightLine : seules les cases en ligne de vue du centre sont affectées. */
  onlyIfInSight?: boolean
  /** forcedDirection : direction imposée (rare, formes L). */
  forcedDirection?: boolean
  /** cellIds : liste explicite de cellules (forme ';', parfois 'a'/'A'). */
  cells?: number[]
}

/**
 * Condition d'états compilée en forme normale disjonctive : satisfaite si AU MOINS UNE clause a tous ses
 * états `has` présents et aucun de ses états `not` (cf. src/data/criteria.ts).
 */
export interface StatesClause {
  has: number[]
  not: number[]
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
  /** Valeur brute : 1 désenvoûtable, 2 retiré seulement à la mort, 3 désenvoûtement « fort » uniquement, 4 jamais (effects.md §1). */
  dispellable: number
  /** Élément (-1 = aucun ; 0..4 = Element ; 5 = meilleur élément). */
  element: number
  zone: ZoneSpec
  /** Durée (tours) d'un buff déclencheur (triggers ≠ 'I') : effectTriggerDuration DofusDB. */
  triggerDuration?: number
  /** effectUid DofusDB (identifiant unique de l'effet, utile au débogage). */
  uid?: number
  /** forClientOnly : effet purement visuel côté client (toujours renseigné par src/data/convert.ts). */
  clientOnly?: boolean
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
  /** Id DofusDB du spell-level (référencé par startingSpellId des monstres et l'effet 1181). */
  levelId?: number
  /** `statesCriterion` compilé (absent si aucune condition) — évite de re-parser la chaîne à chaque lancer. */
  statesCondition?: StatesClause[]
  needVisibleEntity?: boolean
  needCellWithoutPortal?: boolean
  portalProjectionForbidden?: boolean
  /** Limites globales (tous lanceurs alliés confondus), 0 = aucune. */
  maxGlobalCastPerTurn?: number
  maxGlobalCastPerTarget?: number
}

export interface SpellData {
  id: number
  name: string
  nameEn?: string
  description?: string
  breedId?: number
  /** Grades triés par `grade` croissant. */
  levels: SpellLevelData[]
  /** Type de sort DofusDB (= id de classe pour la variante 0 des classes 1-18 seulement). */
  typeId?: number
  iconId?: number
  /** Sorts de classe : index de la paire (0..21) et variante (0 = sort de base, 1 = variante). */
  pairIndex?: number
  variant?: 0 | 1
  /** Peut déclencher des buffs sur des événements issus de lui-même (présent seulement si vrai). */
  canAlwaysTriggerSpells?: boolean
  /** Invocation hors limite d'invocations (présent seulement si vrai). */
  bypassSummoningLimit?: boolean
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

/**
 * Plage de valeur d'un effet d'objet (jet min..max) : `min = diceNum`, `max = diceSide || diceNum`.
 * Pour les effets qui référencent un sort (1175 sort passif : min = id du sort, max = grade ; 281-297
 * modificateurs : min = max = id du sort modifié, `value` = valeur), les bornes portent ces paramètres bruts.
 */
export interface ItemEffectRange {
  effectId: number
  min: number
  max: number
  /** 3ᵉ paramètre brut (`value`), présent seulement s'il est non nul (id de sort de 722, valeur de 281-297…). */
  value?: number
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
  iconId?: number
  /** Zone des armes (item-types.rawZone : Bâton T1, Marteau X1, Pelle V1, Faux U1, Lance L3, sinon P). */
  weaponZone?: ZoneSpec
}

export interface ItemSetData {
  id: number
  name: string
  items: number[]
  /** bonuses[n] = effets accordés quand n objets de la panoplie sont équipés. */
  bonuses: Record<number, ItemEffectRange[]>
  level?: number
}

/**
 * Part (en %) des caractéristiques de l'INVOCATEUR reçue par une invocation (DofusDB `bonusCharacteristics`).
 * Ex. Explobombe 3112 : 90 % des PV, 100 % de Force/Intelligence/Chance/Agilité/Sagesse et des dommages élémentaires ;
 * tourelles Steamer : 180 % des PV ; Arbre 5894 : 60 % des PV ; Aiguille 8186 : 200 % du Tacle et de la Fuite.
 * Ce sont des pourcentages, pas des bonus fixes (valeurs 50/75/100/200, PV de base 0 : cf. docs/research/classes/
 * roublard.md, steamer.md, sadida.md, zobal.md, sacrieur.md, forgelance.md) ; base exacte des PV (PV de base ou max
 * de l'invocateur) INCERTAINE.
 */
export interface SummonerShare {
  /** % des PV de l'invocateur (0 si absent). */
  lifePct: number
  /** % de chaque caractéristique de l'invocateur (clés runtime : strength, earthDamage, tackleBlock, earthResPct…). */
  stats: Partial<Stats>
}

export interface MonsterGrade {
  grade: number
  level: number
  /**
   * PV propres du grade (la vitalité éventuelle est dans `stats.vitality`). Les PV hérités de l'invocateur
   * (`summonerShare.lifePct`) n'y sont PAS inclus.
   */
  lifePoints: number
  ap: number
  mp: number
  /** Caractéristiques non nulles propres au grade, `ap`/`mp` inclus (hors part héritée de l'invocateur). */
  stats: Partial<Stats>
  /** Part des caractéristiques de l'invocateur (bonusCharacteristics), présente seulement si non vide. */
  summonerShare?: SummonerShare
  /** Id de spell-level brut du sort de départ (DofusDB `startingSpellId`). */
  startingSpellLevelId?: number
  /** Sort de départ résolu (absent si le spell-level n'est pas dans les données extraites). */
  startingSpell?: { spellId: number; grade: number }
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
  /**
   * Aligné sur `spells` : `spellGrades[i][g - 1]` = grade du sort `spells[i]` pour le grade `g` du monstre
   * (0 = sort indisponible à ce grade).
   */
  spellGrades?: number[][]
  gfxId?: number
  canSwitchPosOnTarget?: boolean
  canBeCarried?: boolean
  canUsePortal?: boolean
  useBombSlot?: boolean
  summonCost?: number
  /**
   * Paramètres bruts de mise à l'échelle (DofusDB `characRatios` `[[characteristicId, ratio], …]` : 0 = PV,
   * 10-15 = caractéristiques, 19 PO, 23 PM, 25 puissance ; et `scaleGradeRef`). Sens exact INCERTAIN
   * (dofusdb-api.md §5.1, mechanics.md §11) : non appliqués par la couche de données.
   */
  characRatios?: [number, number][]
  scaleGradeRef?: number
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
  /** Note de la classe pour chacun des 8 rôles DofusDB (nom français -> note). */
  roleScores?: Record<string, number>
  /** Niveaux de déblocage [variante 0, variante 1] de chaque paire. */
  spellPairUnlockLevels?: [number, number][]
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
  /** Cases de placement rouges (équipe 0, joueurs) et bleues (équipe 1, monstres), même non marchables. */
  redCells?: number[]
  blueCells?: number[]
  dungeonIds?: number[]
  image?: string
  /** Annotations manuelles (ex. `clockPositions` de la salle du Vortex). */
  annotations?: Record<string, unknown>
}
