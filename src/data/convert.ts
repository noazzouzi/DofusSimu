/**
 * Conversion des données brutes DofusDB (src/data/raw.ts) vers le modèle runtime (src/data/model.ts).
 *
 * Fonctions pures (sans accès disque, utilisables dans le navigateur). Les zones sont « internées » : deux
 * effets de même zone partagent le même objet ZoneSpec (données immuables), ce qui réduit fortement la
 * mémoire (≈ 52 000 effets pour ≈ 700 zones distinctes).
 */
import type { StatKey, Stats } from '../core/types'
import { CELL_COUNT } from '../map/geometry'
import { normalizeStatesCriterion, parseStatesCriterion } from './criteria'
import type {
  BreedData,
  EffectData,
  EquipmentSlot,
  ItemData,
  ItemEffectRange,
  ItemSetData,
  MapCell,
  MapData,
  MonsterData,
  MonsterGrade,
  SpellData,
  SpellLevelData,
  WeaponData,
  ZoneSpec,
} from './model'
import type {
  RawBreed,
  RawBreedRoleDef,
  RawEffectDefaults,
  RawEquipment,
  RawItemEffect,
  RawItemSet,
  RawLocalized,
  RawMapFile,
  RawMonster,
  RawMonsterGrade,
  RawSpell,
  RawSpellEffect,
  RawSpellEffectFull,
  RawSpellLevel,
  RawSpellState,
} from './raw'
import type { SpellStateData } from './store'

// ───────────────────────────── utilitaires ─────────────────────────────

/** Défauts des champs d'effet omis (identiques dans tous les fichiers de sorts et le manifeste). */
export const DEFAULT_EFFECT_DEFAULTS: Readonly<RawEffectDefaults> = Object.freeze({
  baseEffectId: 0,
  targetId: 0,
  modificator: 0,
  effectElement: -1,
  effectTriggerDuration: 0,
  displayZero: false,
  visibleInTooltip: true,
  visibleInBuffUi: true,
  visibleInFightLog: true,
  visibleOnTerrain: true,
  forClientOnly: false,
  trigger: false,
})

/** Texte français (repli anglais, puis chaîne vide). */
export function textFr(l: RawLocalized | null | undefined): string {
  return l?.fr ?? l?.en ?? ''
}

/** Texte anglais s'il existe. */
export function textEn(l: RawLocalized | null | undefined): string | undefined {
  return l?.en ?? undefined
}

// ───────────────────────────── zones ─────────────────────────────

const zoneCache = new Map<string, ZoneSpec>()

function internZone(key: string, build: () => ZoneSpec): ZoneSpec {
  let z = zoneCache.get(key)
  if (!z) {
    z = Object.freeze(build()) as ZoneSpec
    zoneCache.set(key, z)
  }
  return z
}

/** Zone ponctuelle (cible unique). */
export const POINT_ZONE: ZoneSpec = parseZone('P1,0,0,0')

/**
 * Zone compacte Dofus 3 écrite par le script : `"<forme><param1>,<param2>,<pas%>,<maxPas>"` + drapeaux
 * (`c` includeCarried, `s` isStopAtTarget, `d` forcedDirection, `v` onlyAffectIfInSightLine) + cellules
 * explicites. `size = param1` et `minSize = param2` sont repris tels quels (pour la forme `l`, param1 est la
 * distance minimale et param2 la longueur — cf. effects.md §4.2). Zone absente => point.
 */
export function parseZone(zone: string | undefined, flags = '', cells?: readonly number[]): ZoneSpec {
  if (!zone) return POINT_ZONE
  const key = cells && cells.length ? `${zone}|${flags}|${cells.join(',')}` : `${zone}|${flags}`
  return internZone(key, () => {
    const parts = zone.slice(1).split(',')
    return {
      shape: zone[0],
      size: num(parts[0]),
      minSize: num(parts[1]),
      decreaseStepPct: num(parts[2]),
      maxDecreaseCount: num(parts[3]),
      stopAtTarget: flags.includes('s'),
      includeCarried: flags.includes('c'),
      onlyIfInSight: flags.includes('v'),
      forcedDirection: flags.includes('d'),
      cells: cells && cells.length ? Object.freeze(cells.slice()) as number[] : undefined,
    }
  })
}

/** Formes Dofus 2 dont le 2ᵉ paramètre de `rawZone` est une taille minimale (OTOMAI SpellZone.FromRawZone). */
const RAW_ZONE_MIN_SIZE_SHAPES = '#+CQRXl'

/**
 * Zone texte Dofus 2 (`item-types.rawZone`, zones d'armes) : `<forme><p0>[,<p1>[,<p2>[,<p3>[,<p4>]]]]`.
 * Formes à taille minimale (# + C Q R X l) : p1 = taille min, p2 = % dégressif, p3 = nb max ;
 * autres : p1 = % dégressif, p2 = nb max. p4 = stopAtTarget. Défauts 10 % / 4 (effects.md §4.1).
 * Ex. Bâton `"T1,10,1"`, Marteau `"X1,0,10,1"`, Pelle `"V1,10,2"`, Lance `"L3,10,3"`, `"P"`.
 */
export function parseRawZone(raw: string | undefined): ZoneSpec {
  if (!raw) return POINT_ZONE
  return internZone(`raw:${raw}`, () => {
    const shape = raw[0]
    const p = raw.length > 1 ? raw.slice(1).split(',').map(num) : []
    const withMin = RAW_ZONE_MIN_SIZE_SHAPES.includes(shape)
    const at = (i: number, def: number) => (i < p.length ? p[i] : def)
    return {
      shape,
      size: at(0, shape === 'P' ? 1 : 0),
      minSize: withMin ? at(1, 0) : 0,
      decreaseStepPct: at(withMin ? 2 : 1, 10),
      maxDecreaseCount: at(withMin ? 3 : 2, 4),
      stopAtTarget: at(4, 0) === 1,
      includeCarried: false,
      onlyIfInSight: false,
      forcedDirection: false,
      cells: undefined,
    }
  })
}

function num(s: string | undefined): number {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

// ───────────────────────────── sorts ─────────────────────────────

/** Réhydrate les champs secondaires omis d'un effet (`{...effectDefaults, ...effet}`). */
export function expandEffectDefaults(e: RawSpellEffect, defaults: RawEffectDefaults = DEFAULT_EFFECT_DEFAULTS): RawSpellEffectFull {
  return { ...defaults, ...e }
}

export function convertEffect(e: RawSpellEffect, defaults: RawEffectDefaults = DEFAULT_EFFECT_DEFAULTS): EffectData {
  // Tous les champs sont toujours posés (formes d'objets homogènes pour le moteur).
  return {
    effectId: e.effectId,
    order: e.order,
    diceNum: e.diceNum,
    diceSide: e.diceSide,
    value: e.value,
    duration: e.duration,
    delay: e.delay,
    random: e.random,
    group: e.group,
    targetMask: e.targetMask ?? '',
    targetId: e.targetId ?? defaults.targetId,
    triggers: e.triggers ?? '',
    dispellable: e.dispellable,
    element: e.effectElement ?? defaults.effectElement,
    zone: parseZone(e.zone, e.zoneFlags, e.zoneCells),
    triggerDuration: e.effectTriggerDuration ?? defaults.effectTriggerDuration,
    uid: e.effectUid,
    clientOnly: e.forClientOnly ?? defaults.forClientOnly,
  }
}

/** Effets triés par `order` (tri stable : l'ordre du fichier départage les égalités). */
function convertEffects(list: readonly RawSpellEffect[] | undefined, defaults: RawEffectDefaults): EffectData[] {
  if (!list || !list.length) return []
  const out = list.map(e => convertEffect(e, defaults))
  return out.sort((a, b) => a.order - b.order)
}

export function convertSpellLevel(l: RawSpellLevel, defaults: RawEffectDefaults = DEFAULT_EFFECT_DEFAULTS): SpellLevelData {
  const rawCriterion = l.statesCriterion ?? ''
  let statesCondition: SpellLevelData['statesCondition']
  try {
    statesCondition = parseStatesCriterion(rawCriterion)
  } catch {
    statesCondition = undefined // syntaxe inconnue : condition ignorée (aucun cas dans les données actuelles)
  }
  return {
    spellId: l.spellId,
    grade: l.grade,
    apCost: l.apCost,
    minRange: l.minRange,
    range: l.range,
    rangeBoostable: l.rangeCanBeBoosted,
    castInLine: l.castInLine,
    castInDiagonal: l.castInDiagonal,
    castTestLos: l.castTestLos,
    needFreeCell: l.needFreeCell,
    needTakenCell: l.needTakenCell,
    needFreeTrapCell: l.needFreeTrapCell,
    maxCastPerTurn: l.maxCastPerTurn,
    maxCastPerTarget: l.maxCastPerTarget,
    minCastInterval: l.minCastInterval,
    initialCooldown: l.initialCooldown,
    globalCooldown: l.globalCooldown,
    minPlayerLevel: l.minPlayerLevel,
    critChance: l.criticalHitProbability,
    maxStack: l.maxStack,
    statesCriterion: normalizeStatesCriterion(rawCriterion),
    effects: convertEffects(l.effects, defaults),
    criticalEffects: convertEffects(l.criticalEffect, defaults),
    levelId: l.id,
    statesCondition,
    needVisibleEntity: l.needVisibleEntity ?? false,
    needCellWithoutPortal: l.needCellWithoutPortal ?? false,
    portalProjectionForbidden: l.portalProjectionForbidden ?? false,
    maxGlobalCastPerTurn: l.maxGlobalCastPerTurn ?? 0,
    maxGlobalCastPerTarget: l.maxGlobalCastPerTarget ?? 0,
  }
}

/** Champs propres aux sorts de classe (class-spells.json.spells[]). */
interface ClassSpellFields {
  breedId?: number
  pairIndex?: number
  variant?: 0 | 1
}

export function convertSpell(s: RawSpell & ClassSpellFields, defaults: RawEffectDefaults = DEFAULT_EFFECT_DEFAULTS): SpellData {
  const levels = s.levels.map(l => convertSpellLevel(l, defaults)).sort((a, b) => a.grade - b.grade)
  const out: SpellData = {
    id: s.id,
    name: textFr(s.name) || `Sort ${s.id}`,
    nameEn: textEn(s.name),
    description: textFr(s.description) || undefined,
    levels,
    typeId: s.typeId,
    iconId: s.iconId,
  }
  if (s.breedId !== undefined) out.breedId = s.breedId
  if (s.pairIndex !== undefined) out.pairIndex = s.pairIndex
  if (s.variant !== undefined) out.variant = s.variant
  if (s.canAlwaysTriggerSpells) out.canAlwaysTriggerSpells = true
  if (s.bypassSummoningLimit) out.bypassSummoningLimit = true
  return out
}

// ───────────────────────────── états ─────────────────────────────

export function convertState(s: RawSpellState): SpellStateData {
  const out: SpellStateData = {
    id: s.id,
    name: textFr(s.name) || `État ${s.id}`,
    preventsSpellCast: !!s.preventsSpellCast,
    preventsFight: !!s.preventsFight,
    cantBeMoved: !!s.cantBeMoved,
    cantBePushed: !!s.cantBePushed,
    cantDealDamage: !!s.cantDealDamage,
    invulnerable: !!s.invulnerable,
    invulnerableMelee: !!s.invulnerableMelee,
    invulnerableRange: !!s.invulnerableRange,
    cantSwitchPosition: !!s.cantSwitchPosition,
    cantTackle: !!s.cantTackle,
    cantBeTackled: !!s.cantBeTackled,
    incurable: !!s.incurable,
  }
  const en = textEn(s.name)
  if (en) out.nameEn = en
  if (s.isSilent) out.isSilent = true
  if (s.displayTurnRemaining) out.displayTurnRemaining = true
  if (s.isMainState) out.isMainState = true
  if (s.effectsIds?.length) out.effectsIds = s.effectsIds.slice()
  return out
}

// ───────────────────────────── classes ─────────────────────────────

/** Clés de `statPointCosts` (StatKey) -> champ brut statsPointsFor*. */
const STAT_POINT_FIELDS = [
  ['strength', 'statsPointsForStrength'],
  ['intelligence', 'statsPointsForIntelligence'],
  ['chance', 'statsPointsForChance'],
  ['agility', 'statsPointsForAgility'],
  ['vitality', 'statsPointsForVitality'],
  ['wisdom', 'statsPointsForWisdom'],
] as const

/**
 * Classe. `roles` = rôles mis en avant (order >= 0) dans l'ordre du jeu, nommés en français
 * (`roleDefs` = breeds.json.roles) ; `roleScores` = note de chacun des rôles.
 */
export function convertBreed(b: RawBreed, roleDefs: readonly RawBreedRoleDef[] = []): BreedData {
  const roleName = (id: number) => textFr(roleDefs.find(r => r.id === id)?.name) || `Rôle ${id}`
  const statPointCosts: Record<string, [number, number][]> = {}
  for (const [key, field] of STAT_POINT_FIELDS) {
    const tiers = b[field]
    if (tiers) statPointCosts[key] = tiers.map(([from, cost]) => [from, cost] as [number, number])
  }
  const roleScores: Record<string, number> = {}
  for (const r of [...b.roles].sort((x, y) => x.roleId - y.roleId)) roleScores[roleName(r.roleId)] = r.value
  const out: BreedData = {
    id: b.id,
    name: textFr(b.shortName) || `Classe ${b.id}`,
    nameEn: textEn(b.shortName),
    description: textFr(b.description) || undefined,
    roles: b.roles
      .filter(r => r.order >= 0)
      .sort((x, y) => x.order - y.order)
      .map(r => roleName(r.roleId)),
    // Paire incomplète (variante introuvable) : -1, ignoré par spellLevel().
    spellPairs: b.spellPairs.map(([a, v]) => [a, v ?? -1] as [number, number]),
    statPointCosts,
    roleScores,
  }
  if (b.spellPairUnlockLevels) out.spellPairUnlockLevels = b.spellPairUnlockLevels.map(([a, v]) => [a, v] as [number, number])
  return out
}

// ───────────────────────────── objets ─────────────────────────────

/** Types d'armes (dofusdb-api.md §4.1). */
export const WEAPON_TYPE_IDS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 19, 20, 21, 22, 114, 271]
/** Dofus, trophées, prysmaradites (6 emplacements partagés). */
export const DOFUS_TYPE_IDS: readonly number[] = [23, 151, 217]
/** Familiers, montiliers, montures (1 emplacement). */
export const PET_TYPE_IDS: readonly number[] = [18, 121, 331, 332, 333]

const SLOT_BY_TYPE = new Map<number, EquipmentSlot>([
  [1, 'amulet'],
  [9, 'ring'],
  [10, 'belt'],
  [11, 'boots'],
  [16, 'hat'],
  [17, 'cloak'],
  [82, 'shield'],
  ...WEAPON_TYPE_IDS.map(t => [t, 'weapon'] as [number, EquipmentSlot]),
  ...DOFUS_TYPE_IDS.map(t => [t, 'dofus'] as [number, EquipmentSlot]),
  ...PET_TYPE_IDS.map(t => [t, 'pet'] as [number, EquipmentSlot]),
])

/** Emplacement d'équipement d'un type d'objet ('other' si non équipable). */
export function slotForTypeId(typeId: number): EquipmentSlot {
  return SLOT_BY_TYPE.get(typeId) ?? 'other'
}

/** Effet d'objet / de panoplie : `min = diceNum`, `max = diceSide || diceNum`, `value` si non nul. */
export function convertItemEffect(e: RawItemEffect): ItemEffectRange {
  const out: ItemEffectRange = { effectId: e.effectId, min: e.diceNum, max: e.diceSide || e.diceNum }
  if (e.value) out.value = e.value
  return out
}

/** Objet. `typeName` : nom du type (item-types.json), si connu. */
export function convertItem(raw: RawEquipment, typeName?: string): ItemData {
  const slot = slotForTypeId(raw.typeId)
  const out: ItemData = {
    id: raw.id,
    name: textFr(raw.name) || `Objet ${raw.id}`,
    nameEn: textEn(raw.name),
    typeId: raw.typeId,
    typeName,
    slot,
    level: raw.level,
    setId: raw.itemSetId && raw.itemSetId > 0 ? raw.itemSetId : null,
    conditions: raw.criterions ?? '',
    effects: raw.possibleEffects.map(convertItemEffect),
    iconId: raw.iconId,
  }
  if (raw.isLegendary) out.isLegendary = true
  if (slot === 'weapon' && raw.apCost !== undefined) {
    const weapon: WeaponData = {
      apCost: raw.apCost,
      minRange: raw.minRange ?? 1,
      range: raw.range ?? 1,
      critChance: raw.criticalHitProbability ?? 0,
      critBonus: raw.criticalHitBonus ?? 0,
      maxCastPerTurn: raw.maxCastPerTurn ?? 1,
      castInLine: !!raw.castInLine,
      castInDiagonal: !!raw.castInDiagonal,
      castTestLos: raw.castTestLos ?? true,
      twoHanded: !!raw.twoHanded,
    }
    out.weapon = weapon
    out.weaponZone = parseRawZone(raw.weaponZone)
  }
  return out
}

export function convertItemSet(raw: RawItemSet): ItemSetData {
  const bonuses: Record<number, ItemEffectRange[]> = {}
  for (const [n, list] of Object.entries(raw.bonusesByItemCount)) bonuses[Number(n)] = list.map(convertItemEffect)
  return {
    id: raw.id,
    name: textFr(raw.name) || `Panoplie ${raw.id}`,
    items: raw.items.slice(),
    bonuses,
    level: raw.level,
  }
}

/**
 * Bonus actif d'une panoplie avec `equipped` objets portés : palier le plus haut <= equipped (les paliers sont
 * des totaux, non cumulatifs — equipment.md §5). Tableau vide si aucun palier n'est atteint.
 */
export function itemSetBonusesFor(set: ItemSetData, equipped: number): readonly ItemEffectRange[] {
  let best = 0
  for (const k in set.bonuses) {
    const n = Number(k)
    if (n <= equipped && n > best) best = n
  }
  return best ? set.bonuses[best] : []
}

// ───────────────────────────── monstres ─────────────────────────────

/** Champs de grade -> caractéristique runtime. */
const GRADE_STAT_FIELDS: readonly (readonly [keyof RawMonsterGrade, StatKey])[] = [
  ['vitality', 'vitality'],
  ['wisdom', 'wisdom'],
  ['strength', 'strength'],
  ['intelligence', 'intelligence'],
  ['chance', 'chance'],
  ['agility', 'agility'],
  ['neutralResistance', 'neutralResPct'],
  ['earthResistance', 'earthResPct'],
  ['fireResistance', 'fireResPct'],
  ['waterResistance', 'waterResPct'],
  ['airResistance', 'airResPct'],
  ['paDodge', 'apParry'],
  ['pmDodge', 'mpParry'],
  ['damageReflect', 'reflect'],
  ['bonusRange', 'range'],
]

/**
 * Clés de `bonusCharacteristics` -> caractéristique runtime (ajoutées aux valeurs du grade).
 * `lifePoints` est traité à part (ajouté aux PV du grade). Les clés inconnues sont ignorées.
 */
export const MONSTER_BONUS_STATS: Readonly<Record<string, StatKey>> = {
  vitality: 'vitality',
  wisdom: 'wisdom',
  strength: 'strength',
  intelligence: 'intelligence',
  chance: 'chance',
  agility: 'agility',
  actionPoints: 'ap',
  movementPoints: 'mp',
  neutralResistance: 'neutralResPct',
  earthResistance: 'earthResPct',
  fireResistance: 'fireResPct',
  waterResistance: 'waterResPct',
  airResistance: 'airResPct',
  paDodge: 'apParry',
  pmDodge: 'mpParry',
  tackleEvade: 'tackleEvade',
  tackleBlock: 'tackleBlock',
  bonusNeutralDamage: 'neutralDamage',
  bonusEarthDamage: 'earthDamage',
  bonusFireDamage: 'fireDamage',
  bonusWaterDamage: 'waterDamage',
  bonusAirDamage: 'airDamage',
  aPRemoval: 'apReduction',
  mPRemoval: 'mpReduction',
  damageReflect: 'reflect',
  bonusRange: 'range',
}

/** Résolution d'un id de spell-level (sort de départ) en sort + grade. */
export type SpellLevelResolver = (levelId: number) => { spellId: number; grade: number } | undefined

export function convertMonsterGrade(g: RawMonsterGrade, resolveLevel?: SpellLevelResolver): MonsterGrade {
  const stats: Partial<Stats> = {}
  const add = (k: StatKey, v: number | undefined) => {
    if (v) stats[k] = (stats[k] ?? 0) + v
  }
  add('ap', g.actionPoints)
  add('mp', g.movementPoints)
  for (const [field, key] of GRADE_STAT_FIELDS) add(key, g[field] as number | undefined)
  let lifePoints = g.lifePoints ?? 0
  const bonus = g.bonusCharacteristics
  if (bonus) {
    for (const k in bonus) {
      const v = bonus[k]
      if (!v) continue
      if (k === 'lifePoints') lifePoints += v
      else {
        const key = MONSTER_BONUS_STATS[k]
        if (key) add(key, v)
      }
    }
  }
  const out: MonsterGrade = {
    grade: g.grade,
    level: g.level,
    lifePoints,
    ap: stats.ap ?? 0,
    mp: stats.mp ?? 0,
    stats,
  }
  if (g.startingSpellId) {
    out.startingSpellLevelId = g.startingSpellId
    const ref = resolveLevel?.(g.startingSpellId)
    if (ref) out.startingSpell = { spellId: ref.spellId, grade: ref.grade }
  }
  return out
}

/**
 * Monstre. Les ids de sorts invalides (sentinelle -1) sont retirés avec leur ligne de `spellGrades`.
 * `resolveLevel` résout les sorts de départ (id de spell-level -> sort + grade).
 */
export function convertMonster(raw: RawMonster, resolveLevel?: SpellLevelResolver): MonsterData {
  const spells: number[] = []
  const spellGrades: number[][] = []
  raw.spells.forEach((id, i) => {
    if (!(id > 0)) return
    spells.push(id)
    spellGrades.push((raw.spellGrades[i] ?? []).slice())
  })
  return {
    id: raw.id,
    name: textFr(raw.name) || `Monstre ${raw.id}`,
    nameEn: textEn(raw.name),
    raceId: raw.race,
    isBoss: !!raw.isBoss,
    isMiniBoss: !!raw.isMiniBoss,
    canTackle: !!raw.canTackle,
    canBePushed: !!raw.canBePushed,
    canSwitchPos: !!raw.canSwitchPos,
    canPlay: !!raw.canPlay,
    useSummonSlot: !!raw.useSummonSlot,
    tags: raw.tags ? raw.tags.slice() : [],
    spells,
    grades: raw.grades.map(g => convertMonsterGrade(g, resolveLevel)).sort((a, b) => a.grade - b.grade),
    spellGrades,
    gfxId: raw.gfxId,
    canSwitchPosOnTarget: !!raw.canSwitchPosOnTarget,
    canBeCarried: !!raw.canBeCarried,
    canUsePortal: !!raw.canUsePortal,
    useBombSlot: !!raw.useBombSlot,
    summonCost: raw.summonCost ?? 0,
  }
}

// ───────────────────────────── cartes ─────────────────────────────

const truthy = (v: boolean | number | undefined) => v === true || (typeof v === 'number' && v !== 0)

/**
 * Carte de combat (data/maps/<mapId>.json). `walkable = mov && !nonWalkableDuringFight` (le fichier porte déjà
 * `walkable` ; `mov` est accepté pour un export DofusDB brut). Placement : rouge -> 1 (équipe 0, joueurs /
 * challengers), bleu -> 2 (équipe 1, monstres / défenseurs) ; une case à la fois rouge et bleue est classée
 * rouge dans `placement` mais figure dans les deux listes `redCells` / `blueCells`.
 */
export function convertMap(raw: RawMapFile): MapData {
  let count = CELL_COUNT
  for (const c of raw.cells) if (c.id >= count) count = c.id + 1
  const cells: MapCell[] = new Array(count)
  for (let id = 0; id < count; id++) cells[id] = { id, walkable: false, los: true, placement: 0 }
  const redCells: number[] = []
  const blueCells: number[] = []
  for (const c of raw.cells) {
    if (!(c.id >= 0)) continue
    const mov = c.walkable !== undefined ? c.walkable : truthy(c.mov)
    const red = truthy(c.red)
    const blue = truthy(c.blue)
    if (red) redCells.push(c.id)
    if (blue) blueCells.push(c.id)
    cells[c.id] = {
      id: c.id,
      walkable: mov && !truthy(c.nonWalkableDuringFight),
      los: truthy(c.los),
      placement: red ? 1 : blue ? 2 : 0,
    }
  }
  redCells.sort((a, b) => a - b)
  blueCells.sort((a, b) => a - b)
  const out: MapData = {
    id: raw.mapId,
    name: raw.name,
    cells,
    approximate: raw.approximate ?? false,
    redCells,
    blueCells,
  }
  if (raw.dungeonIds) out.dungeonIds = raw.dungeonIds.slice()
  if (raw.image) out.image = raw.image
  if (raw.annotations) out.annotations = raw.annotations
  return out
}
