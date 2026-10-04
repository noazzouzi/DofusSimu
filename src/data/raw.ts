/**
 * Types des fichiers JSON bruts de `data/dofusdb/` et `data/maps/`, tels qu'écrits par
 * `scripts/fetch-dofusdb.mjs` et `scripts/fetch-maps.mjs` (voir docs/research/dofusdb-api.md §7 et maps.md §3).
 *
 * Conventions communes :
 *  - les champs localisés sont réduits à `{fr, en}` (`null` si le texte est vide) ;
 *  - les champs « secondaires » des effets de sort sont omis quand ils valent leur défaut (`effectDefaults`,
 *    répété dans chaque fichier de sorts) : réhydrater avec `{...effectDefaults, ...effet}` ;
 *  - les booléens « absents = false » (états, objets) sont typés optionnels.
 *
 * Ces types ne servent qu'à la conversion (src/data/convert.ts) : le reste du simulateur utilise le
 * modèle runtime de src/data/model.ts.
 */

/** Texte localisé (`{id, fr, en, de, es, pt}` DofusDB réduit à fr/en). */
export interface RawLocalized {
  fr: string | null
  en: string | null
}

// ───────────────────────────── sorts ─────────────────────────────

/** Valeurs par défaut des champs d'effet omis (`effectDefaults` des fichiers de sorts et du manifeste). */
export interface RawEffectDefaults {
  baseEffectId: number
  targetId: number
  modificator: number
  effectElement: number
  effectTriggerDuration: number
  displayZero: boolean
  visibleInTooltip: boolean
  visibleInBuffUi: boolean
  visibleInFightLog: boolean
  visibleOnTerrain: boolean
  forClientOnly: boolean
  trigger: boolean
}

/**
 * Effet de sort normalisé (`EffectInstanceDice`). Champs principaux toujours présents ; champs secondaires
 * présents seulement s'ils diffèrent de `effectDefaults`.
 */
export interface RawSpellEffect extends Partial<RawEffectDefaults> {
  effectId: number
  effectUid: number
  order: number
  diceNum: number
  diceSide: number
  value: number
  duration: number
  delay: number
  random: number
  group: number
  targetMask: string
  triggers: string
  /** Valeurs observées 1, 2, 3 (énumération FightDispellableEnum, cf. effects.md §1). */
  dispellable: number
  /**
   * Zone compacte `"<forme><param1>,<param2>,<damageDecreaseStepPercent>,<maxDamageDecreaseApplyCount>"`,
   * ex. `"L3,0,10,4"`. Absente si `zoneDescr.shape` = 0 (jamais observé).
   */
  zone?: string
  /** Drapeaux de zone : c includeCarried, s isStopAtTarget, d forcedDirection, v onlyAffectIfInSightLine. */
  zoneFlags?: string
  /** `zoneDescr.cellIds` s'il est non vide (formes `;`, `a`, `A`). */
  zoneCells?: number[]
  /** Ancienne zone texte Dofus 2 (jamais observée dans les données Dofus 3). */
  rawZone?: string
}

/** Effet de sort après réhydratation des défauts. */
export type RawSpellEffectFull = RawSpellEffect & RawEffectDefaults

/** Zone d'aperçu d'un niveau de sort (zones au format compact de `RawSpellEffect.zone`). */
export interface RawPreviewZone {
  id?: number
  display?: string
  displayFlags?: string
  displayCells?: number[]
  activation?: string
  activationFlags?: string
  activationCells?: number[]
  casterMask?: string
  activationMask?: string
  hidden?: boolean
}

/** Grade d'un sort (`spell-levels`). */
export interface RawSpellLevel {
  /** Id de spell-level (référencé par `monsters.grades[].startingSpellId` et l'effet 1181). */
  id: number
  spellId: number
  grade: number
  spellBreed?: number
  apCost: number
  minRange: number
  range: number
  rangeCanBeBoosted: boolean
  castInLine: boolean
  castInDiagonal: boolean
  castTestLos: boolean
  needFreeCell: boolean
  needTakenCell: boolean
  needFreeTrapCell: boolean
  needVisibleEntity?: boolean
  needCellWithoutPortal?: boolean
  portalProjectionForbidden?: boolean
  criticalHitProbability: number
  maxStack: number
  maxCastPerTurn: number
  maxCastPerTarget: number
  maxGlobalCastPerTurn?: number
  maxGlobalCastPerTarget?: number
  minCastInterval: number
  initialCooldown: number
  globalCooldown: number
  minPlayerLevel: number
  /** Condition d'états du lanceur, grammaire `HS=x` / `HS!x` avec `&`, `|` et parenthèses. */
  statesCriterion: string
  hideEffects?: boolean
  hidden?: boolean
  playAnimation?: boolean
  previewZones?: RawPreviewZone[]
  effects: RawSpellEffect[]
  /** Liste COMPLÈTE d'effets appliquée à la place de `effects` en cas de coup critique. */
  criticalEffect: RawSpellEffect[]
}

export interface RawSpell {
  id: number
  name: RawLocalized | null
  description?: RawLocalized | null
  typeId: number
  order?: number
  iconId?: number
  adminName?: string
  verboseCast?: boolean
  bypassSummoningLimit?: boolean
  canAlwaysTriggerSpells?: boolean
  hideCastConditions?: boolean
  /** Zone d'aperçu de base (format compact), absente si aucune. */
  basePreviewZone?: string
  /** Ids des spell-levels du sort (ordre DofusDB). */
  spellLevels: number[]
  /** Spell-levels référencés mais absents de l'API. */
  missingLevels?: number[]
  levels: RawSpellLevel[]
  /** monster-spells / linkedSpells : premier monstre qui possède le sort. */
  viaMonster?: number
  /** item-spells : objets portant directement ce sort. */
  itemIds?: number[]
  /** item-spells : panoplies dont un bonus donne ce sort. */
  itemSetIds?: number[]
}

/** Sort de classe (`class-spells.json.spells[]`). */
export interface RawClassSpell extends RawSpell {
  breedId: number
  variantId: number
  /** Index de la paire dans `breeds[].spellPairs`. */
  pairIndex: number
  /** 0 = sort de `breedSpellsId`, 1 = variante. */
  variant: 0 | 1
}

/** Table `id de spell-level -> id de sort` (sorts de départ des monstres, effet 1181). */
export type RawStartingSpellLevels = Record<string, number>

export interface RawClassSpellsFile {
  note: string
  effectDefaults: RawEffectDefaults
  /** Monstres invoqués par les sorts de classe (détaillés dans monsters.json). */
  summonedMonsters: number[]
  missingSpellIds: number[]
  missingSpellLevelIds: number[]
  startingSpellLevels: RawStartingSpellLevels
  spells: RawClassSpell[]
  /** Sorts non-classe atteints par références d'effets ou utilisés par les invocations. */
  linkedSpells: RawSpell[]
}

export interface RawMonsterSpellsFile {
  note: string
  scope: string
  dungeonIds: number[]
  effectDefaults: RawEffectDefaults
  seedMonsters: number[]
  reachedMonsters: number[]
  missingMonsterIds: number[]
  missingSpellIds: number[]
  missingSpellLevelIds: number[]
  startingSpellLevels: RawStartingSpellLevels
  spells: RawSpell[]
}

export interface RawItemSpellsFile {
  note: string
  effectDefaults: RawEffectDefaults
  /** Sort de classe -> objets dont un effet de catégorie 3 le modifie. */
  classSpellModifiers: Record<string, number[]>
  summonedMonsters: number[]
  missingSpellIds: number[]
  spells: RawSpell[]
}

/** Fichiers contenant des sorts (class-spells, monster-spells, item-spells). */
export type RawSpellFile = RawClassSpellsFile | RawMonsterSpellsFile | RawItemSpellsFile

// ───────────────────────────── états ─────────────────────────────

/** État (`spell-states`) ; drapeaux absents = false. */
export interface RawSpellState {
  id: number
  name: RawLocalized | null
  preventsSpellCast?: boolean
  preventsFight?: boolean
  isSilent?: boolean
  cantBeMoved?: boolean
  cantBePushed?: boolean
  cantDealDamage?: boolean
  invulnerable?: boolean
  cantSwitchPosition?: boolean
  incurable?: boolean
  invulnerableMelee?: boolean
  invulnerableRange?: boolean
  cantTackle?: boolean
  cantBeTackled?: boolean
  displayTurnRemaining?: boolean
  isMainState?: boolean
  /** Ids d'« effets d'état » internes (StateEffectId, cf. mechanics.md §12). */
  effectsIds?: number[]
  iconVisibilityMask?: number
  /** Cité par un sort extrait (effets 950/951/952 ou statesCriterion). */
  referenced?: boolean
}

export interface RawSpellStatesFile {
  note: string
  scope: string
  totalInApi: number
  flagKeys: string[]
  states: RawSpellState[]
}

// ───────────────────────────── monstres ─────────────────────────────

/**
 * Bonus de caractéristiques d'un grade (surtout des invocations : bombes, Arakne, poupées…), à ajouter aux
 * valeurs du grade. Clés observées : lifePoints, strength, intelligence, chance, agility, wisdom,
 * <élément>Resistance, bonus<Élément>Damage, tackleEvade, tackleBlock (+ aPRemoval selon la doc API).
 */
export type RawMonsterBonusCharacteristics = Partial<Record<string, number>>

export interface RawMonsterGrade {
  grade: number
  level: number
  lifePoints: number
  actionPoints: number
  movementPoints: number
  vitality?: number
  wisdom?: number
  strength?: number
  intelligence?: number
  chance?: number
  agility?: number
  /** Résistances en %. */
  neutralResistance?: number
  earthResistance?: number
  fireResistance?: number
  waterResistance?: number
  airResistance?: number
  /** Esquive PA / PM. */
  paDodge?: number
  pmDodge?: number
  damageReflect?: number
  bonusRange?: number
  gradeXp?: number
  /** Id de SPELL-LEVEL (pas de sort) lancé automatiquement à l'apparition. */
  startingSpellId?: number
  hiddenLevel?: number
  bonusCharacteristics?: RawMonsterBonusCharacteristics
}

export interface RawMonster {
  id: number
  name: RawLocalized | null
  race: number
  gfxId?: number
  isBoss: boolean
  isMiniBoss: boolean
  isQuestMonster?: boolean
  canPlay: boolean
  canTackle: boolean
  canBePushed: boolean
  canSwitchPos: boolean
  canSwitchPosOnTarget?: boolean
  canBeCarried?: boolean
  canUsePortal?: boolean
  useSummonSlot: boolean
  useBombSlot?: boolean
  summonCost?: number
  speedAdjust?: number
  tags?: string[]
  /** Ids de sorts (peut contenir la sentinelle -1). */
  spells: number[]
  /**
   * Aligné sur `spells` : `spellGrades[i][g - 1]` = grade du sort `spells[i]` pour le grade `g` du monstre
   * (0 = indisponible). Peut contenir plus de colonnes que de grades.
   */
  spellGrades: number[][]
  grades: RawMonsterGrade[]
  characRatios?: [number, number][]
  scaleGradeRef?: number
  useRaceValues?: boolean
  subareas?: number[]
  favoriteSubareaId?: number
  correspondingMiniBossId?: number
  soulCaptureForbidden?: boolean
  allIdolsDisabled?: boolean
  incompatibleIdols?: number[]
  incompatibleChallenges?: number[]
  hideInBestiary?: boolean
}

export interface RawMonsterRacesFile {
  superRaces: { id: number; name: RawLocalized | null }[]
  races: { id: number; name: RawLocalized | null; superRaceId: number; monsters: number[] }[]
}

// ───────────────────────────── classes ─────────────────────────────

export interface RawBreedRoleDef {
  id: number
  name: RawLocalized | null
  description?: RawLocalized | null
  color?: number
  assetId?: number
}

/** Note d'une classe pour un rôle (`order >= 0` = rôle mis en avant, dans cet ordre). */
export interface RawBreedRole {
  roleId: number
  value: number
  order: number
  description?: RawLocalized | null
}

/** Paliers de coût des points de caractéristiques : `[[seuil, coût], …]`. */
export type RawStatPointCosts = [number, number][]

export interface RawBreed {
  id: number
  shortName: RawLocalized | null
  longName?: RawLocalized | null
  gameplayDescription?: RawLocalized | null
  description?: RawLocalized | null
  gameplayClassDescription?: RawLocalized | null
  complexity?: number
  sortIndex?: number
  roles: RawBreedRole[]
  statsPointsForStrength: RawStatPointCosts
  statsPointsForIntelligence: RawStatPointCosts
  statsPointsForChance: RawStatPointCosts
  statsPointsForAgility: RawStatPointCosts
  statsPointsForVitality: RawStatPointCosts
  statsPointsForWisdom: RawStatPointCosts
  /** 22 sorts (un par paire), ordre d'affichage du jeu. */
  breedSpellsId: number[]
  /** Paires `[variante 0, variante 1]` (variante 1 `null` si la paire est introuvable). */
  spellPairs: [number, number | null][]
  spellVariantIds: (number | null)[]
  /** Niveaux de déblocage `[variante 0, variante 1]` par paire. */
  spellPairUnlockLevels?: [number, number][]
  spellPairNames?: [string, string][]
}

export interface RawBreedsFile {
  roles: RawBreedRoleDef[]
  breeds: RawBreed[]
  unassignedSpellVariants: { id: number; breedId: number; spellIds: number[] }[]
}

// ───────────────────────────── objets ─────────────────────────────

/**
 * Effet d'objet ou de panoplie (`possibleEffects`) : jet `diceNum..diceSide` (`diceSide = 0` ⇒ valeur fixe
 * `diceNum`) ; le signe est porté par `effectId` ; `value` = 3ᵉ paramètre (id de sort de 722, valeur d'un
 * modificateur de sort…).
 */
export interface RawItemEffect {
  effectId: number
  diceNum: number
  diceSide: number
  value: number
  baseEffectId?: number
}

/** Emplacement brut écrit par le script (manifest.equipmentTypes). */
export type RawEquipmentSlot =
  | 'amulet'
  | 'ring'
  | 'belt'
  | 'boots'
  | 'hat'
  | 'cloak'
  | 'shield'
  | 'weapon'
  | 'dofus'
  | 'trophy'
  | 'prysmaradite'
  | 'pet'
  | 'petsmount'
  | 'mount'

export interface RawEquipment {
  id: number
  name: RawLocalized | null
  typeId: number
  superTypeId?: number
  slot?: RawEquipmentSlot
  level: number
  /** `null` = aucune panoplie (DofusDB : -1). */
  itemSetId: number | null
  iconId?: number
  criterions: string
  criterionsTarget?: string
  possibleEffects: RawItemEffect[]
  evolutiveEffectIds?: number[]
  isLegendary?: boolean
  etheral?: boolean
  exchangeable?: boolean
  visibilityCriterion?: string
  hideEffects?: boolean
  twoHanded?: boolean
  // Champs d'arme (présents seulement pour les armes)
  apCost?: number
  minRange?: number
  range?: number
  castInLine?: boolean
  castInDiagonal?: boolean
  castTestLos?: boolean
  criticalHitProbability?: number
  criticalHitBonus?: number
  maxCastPerTurn?: number
  /** Zone de l'arme au format texte Dofus 2 (`item-types[].rawZone`), ex. `"T1,10,1"`, `"P"`. */
  weaponZone?: string
}

export interface RawItemSet {
  id: number
  name: RawLocalized | null
  level: number
  bonusIsSecret?: boolean
  items: number[]
  itemsNotInEquipment?: number[]
  /** `"n"` -> bonus TOTAL avec n objets équipés (paliers non cumulatifs). */
  bonusesByItemCount: Record<string, RawItemEffect[]>
}

export interface RawItemSuperType {
  id: number
  name: RawLocalized | null
  positions: number[]
}

export interface RawItemType {
  id: number
  name: RawLocalized | null
  superTypeId: number
  categoryId?: number
  /** Emplacement logique (null = non équipable). */
  slot?: RawEquipmentSlot | null
  /** Zone d'arme texte (Dofus 2), types d'armes seulement. */
  rawZone?: string
  isInEncyclopedia?: boolean
  craftXpRatio?: number
  evolutiveTypeId?: number
}

export interface RawItemTypesFile {
  note: string
  superTypes: RawItemSuperType[]
  types: RawItemType[]
}

// ───────────────────────────── tables de référence ─────────────────────────────

/** Effet (`effects.json`). */
export interface RawEffectDef {
  id: number
  description?: RawLocalized | null
  theoreticalDescription?: RawLocalized | null
  characteristic: number
  category: number
  characteristicOperator: string
  elementId: number
  useDice: boolean
  forceMinMax: boolean
  boost: boolean
  active: boolean
  oppositeId: number
  bonusType: number
  isInPercent: boolean
  useInFight: boolean
  showInTooltip: boolean
  showInSet: boolean
  hideValueInTooltip: boolean
  parametersFixed: boolean
  effectPriority: number
  /** Poids de rune de forgemagie. */
  effectPowerRate: number
  theoreticalPattern: number
  effectTriggerDuration: number
  actionFiltersId?: number[]
  textIconReferenceId: number
  iconId?: number
}

/** Caractéristique (`characteristics.json`). */
export interface RawCharacteristic {
  id: number
  keyword: string
  name?: RawLocalized | null
  categoryId: number
  visible: boolean
  order: number
  upgradable: boolean
  scaleFormulaId: number
  asset?: string
}

// ───────────────────────────── donjons, challenges ─────────────────────────────

export interface RawDungeon {
  id: number
  name: RawLocalized | null
  optimalPlayerLevel: number
  minLevel: number
  difficulty: number
  /** Salles de combat dans l'ordre. */
  mapIds: number[]
  entranceMapId: number
  exitMapId: number
  monsters: number[]
  bosses: number[]
  requiredObjects?: { id: number; quantity: number }[]
  availableInAutomaticGroupSearch: boolean
  availableInLobby: boolean
  availableOnKeyring: boolean
  subarea?: {
    id: number
    name: RawLocalized | null
    areaId: number
    level: number
    mapIds: number[]
    monsters: number[]
  }
  achievements: { id: number; name: RawLocalized | null; description?: RawLocalized | null; points?: number; challengeId?: number }[]
}

export interface RawDungeonMap {
  id: number
  name: RawLocalized | null
  dungeonIds: number[]
  /** `room`, `entrance`, `exit`, `subarea`. */
  roles: string[]
  notInApi?: boolean
  posX?: number
  posY?: number
  subAreaId?: number
  worldMap?: number
  outdoor?: boolean
  hasTemplate?: boolean
  allowChallenge?: boolean
  allowMonsterFight?: boolean
  imageUrl?: string
  roomIndex?: number
}

export interface RawChallenge {
  id: number
  name: RawLocalized | null
  description: RawLocalized | null
  categoryId: number
  iconId: number
  completionCriterion: string
  activationCriterion?: string
  incompatibleChallenges?: number[]
  targetMonsterId?: number
}

export interface RawAchievementObjective {
  id: number
  order: number
  criterion: string
  name: RawLocalized | null
  readableCriterion?: unknown[]
}

export interface RawAchievementsVortexFile {
  dungeonId: number
  note: string
  achievements: {
    id: number
    name: RawLocalized | null
    description: RawLocalized | null
    points: number
    level: number
    categoryId: number
    objectives: RawAchievementObjective[]
    rewardIds: number[]
    challengeId?: number
  }[]
  challenges: RawChallenge[]
}

// ───────────────────────────── manifeste ─────────────────────────────

/** Listes d'effets qui référencent un sort / un monstre / un état (manifest.json.spellRefEffects). */
export interface RawSpellRefEffects {
  diceNumIsSpell: number[]
  spellModifiers: number[]
  diceSideIsSpell: number[]
  valueIsSpell: number[]
  diceSideIsSpellLevel: number[]
  summonDiceNumIsMonster: number[]
  stateValueIsState: number[]
  notes?: string
}

export interface RawManifest {
  generatedBy: string
  fetchedAt: string
  api: string
  sourceServices: string[]
  options: Record<string, unknown>
  files: Record<string, { bytes: number; count: number }>
  totalBytes: number
  counts: Record<string, number>
  effectDefaults: RawEffectDefaults
  spellRefEffects: RawSpellRefEffects
  /** typeId -> emplacement brut. */
  equipmentTypes: Record<string, RawEquipmentSlot>
  checks: Record<string, unknown>
  http?: Record<string, number>
}

// ───────────────────────────── cartes (data/maps/<mapId>.json) ─────────────────────────────

/**
 * Cellule de carte. Le fichier écrit `walkable` (= `mov && !nonWalkableDuringFight`, déjà appliqué) ;
 * `mov` est accepté pour les fichiers bruts DofusDB (`cellsData`). Drapeaux absents = false.
 */
export interface RawMapCell {
  id: number
  walkable?: boolean
  mov?: boolean | number
  los: boolean | number
  nonWalkableDuringFight?: boolean | number
  red?: boolean | number
  blue?: boolean | number
  floor?: number
  visible?: boolean
}

export interface RawMapFile {
  mapId: number
  name?: string
  nameIsFallback?: boolean
  dungeonIds?: number[]
  room?: number
  posX?: number
  posY?: number
  subAreaId?: number
  worldMap?: number
  width?: number
  height?: number
  source?: string
  fetchedAt?: string
  approximate?: boolean
  image?: string
  neighbours?: Partial<Record<'top' | 'bottom' | 'left' | 'right', number>>
  stats?: { walkable: number; losBlocking: number; walkableNoLos: number; red: number; blue: number }
  redCells?: number[]
  blueCells?: number[]
  /** Annotations manuelles (`data/maps/annotations/<mapId>.json`), ex. heures de l'horloge du Vortex. */
  annotations?: Record<string, unknown>
  cells: RawMapCell[]
}

// ───────────────────────────── table des fichiers ─────────────────────────────

/** Fichiers de `data/dofusdb/` et leur type brut. */
export interface RawFiles {
  'achievements-vortex.json': RawAchievementsVortexFile
  'breeds.json': RawBreedsFile
  'challenges.json': RawChallenge[]
  'characteristics.json': RawCharacteristic[]
  'class-spells.json': RawClassSpellsFile
  'dungeon-maps.json': RawDungeonMap[]
  'dungeons.json': RawDungeon[]
  'effects.json': RawEffectDef[]
  'equipment.json': RawEquipment[]
  'item-sets.json': RawItemSet[]
  'item-spells.json': RawItemSpellsFile
  'item-types.json': RawItemTypesFile
  'manifest.json': RawManifest
  'monster-races.json': RawMonsterRacesFile
  'monster-spells.json': RawMonsterSpellsFile
  'monsters.json': RawMonster[]
  'spell-states.json': RawSpellStatesFile
}

export type RawFileName = keyof RawFiles
