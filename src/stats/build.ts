/**
 * Builds de personnages et agrégation stuff → caractéristiques.
 *
 * Algorithme (docs/research/equipment.md §3.2, §5, §7, §13 — logique du « stuff creator » DofusDB, corrigée) :
 *   brut(stat) = base investie + parchemins + Σ objets (jets choisis) + bonus de panoplie + exos
 *   PA = min(6 (7 dès niv. 100) + Σ, plafond 2897, 12) ; PM = min(3 + Σ, 2897, 6) ; PO = min(Σ, 2897, 6) ;
 *   Invocations = min(1 + Σ, 2897, 6) ; PV = 55 + 5·(niv − 1) + Vitalité ;
 *   Initiative = bonus + Force + Intelligence + Chance + Agilité ; Prospection = 100 (Enutrof 120) + ⌊Chance/10⌋ + bonus ;
 *   Tacle/Fuite = ⌊Agilité/10⌋ + bonus ; Esquive/Retrait PA/PM = ⌊Sagesse/10⌋ + bonus.
 * Améliorations par rapport à DofusDB (§13) : un seul exo PA/PM/PO compté, une seule prysmaradite, conditions évaluées
 * sur l'état final (valeurs brutes avant plafonds), familiers au prorata de leur niveau, totaux bruts conservés.
 *
 * Les % de résistance ne sont PAS plafonnés par défaut (le plafond joueur de 50 % s'applique dans le calcul de
 * dégâts, après les buffs/débuffs de combat) : option `capResistances` pour un affichage façon DofusDB.
 *
 * Performance (optimiseur de stuff) : sommes dans un `Float64Array` réutilisé, contributions des objets et des paliers
 * de panoplie pré-calculées par politique de jet (caches `WeakMap`), conditions analysées une seule fois :
 * ~5 µs pour un stuff complet de 16 objets.
 */
import type { Stats, StatKey } from '../core/types'
import type { BreedData, EquipmentSlot, ItemData, ItemEffectRange, ItemSetData } from '../data/model'
import {
  availableCharacteristicPoints,
  baseStatsFromPoints,
  emptyPrimaryStats,
  MAX_SCROLL_PER_STAT,
  PRIMARY_STAT_NAMES_FR,
  PRIMARY_STATS,
  statLevel,
  type PrimaryStatRecord,
} from './characteristicPoints'
import { evaluateCriterion, explainCriterion, parseCriterion, type ConditionProfile, type CriterionContext } from './conditions'
import { EFFECT_PASSIVE_SPELL, EFFECT_STAT_CAP, itemEffectSign, itemEffectStatIndex, STAT_BY_CHARACTERISTIC_ID } from './effects'
import { copyStats, STAT_COUNT, STAT_INDEX, statsFromArray } from './fastStats'
import { checkItemForgemagie, forgeKind, isValidForgeValue, ONCE_PER_CHARACTER_EXO_STATS, type ExoLine } from './forgemagie'

// ───────────────────────────── types ─────────────────────────────

/** Objet équipé dans un build. */
export interface EquippedItem {
  /** Emplacement (facultatif : déduit de l'objet ; s'il est fourni il doit correspondre à `item.slot`). */
  slot?: EquipmentSlot
  itemId: number
  /**
   * Jets choisis par effectId : montant POSITIF comme dans les données (le signe vient de l'effet, ex. 215 = −% Rés.
   * Terre). Défaut : selon `rollPolicy` (jet max). Une valeur au-delà du jet max est un over (contrôlé).
   */
  rolls?: Record<number, number>
  /** Lignes de forgemagie : exos (ligne absente), overs (ligne existante), transcendances. */
  exos?: ExoLine[]
  /**
   * Niveau du familier (entier 0-100, type 18 seulement) : bonus au prorata, `round(jet × niveau / 100)` (INCERTAIN).
   * Défaut 100. Hors plage ⇒ erreur `petLevel` (bonus pleins) ; sur un objet qui n'est pas un familier ⇒ ignoré.
   */
  petLevel?: number
}

export interface CharacterBuild {
  name: string
  breedId: number
  level: number
  /** Points de caractéristiques INVESTIS (capital dépensé, pas la valeur obtenue). */
  characteristicPoints: Partial<PrimaryStatRecord>
  /** Parchemins (« additionnel »), 100 max par caractéristique. */
  scrolls: Partial<PrimaryStatRecord>
  items: EquippedItem[]
  /** Choix de variante (0/1) pour chacune des 22 paires de sorts. */
  spellVariants?: (0 | 1)[]
  title?: string
  /** Sexe (0/1), pour les conditions `PS`. */
  sex?: 0 | 1
}

/** Accès aux données nécessaires (sous-ensemble de `DataStore`, indépendant de la source). */
export interface BuildDataSource {
  item(id: number): ItemData | undefined
  itemSet(id: number): ItemSetData | undefined
  breed(id: number): BreedData | undefined
}

/** Politique de jet par défaut : `max` (DofusDB/DofusBook : |jet| max, malus compris), `min`, `mean` ⌊(min+max)/2⌋,
 * `best` (bonus au max, malus au min). */
export type RollPolicy = 'max' | 'min' | 'mean' | 'best'

export interface StatCaps {
  ap: number
  mp: number
  range: number
  summons: number
  /** Plafond des % de résistance d'un joueur (appliqué seulement avec `capResistances`). */
  resPct: number
}

/**
 * Plafonds hors combat. PO : 6 (DofusDB, guides 2026 ; equipment.md §7) — mechanics.md §18 cite 9 (devblog 2.3.4),
 * INCERTAIN ⇒ paramètre. Invocations : 6 (DofusDB, INCERTAIN).
 */
export const DEFAULT_STAT_CAPS: Readonly<StatCaps> = { ap: 12, mp: 6, range: 6, summons: 6, resPct: 50 }

export interface BuildStatsOptions {
  rollPolicy?: RollPolicy
  caps?: Partial<StatCaps>
  /** Plafonner les % de résistance à `caps.resPct` (affichage). Défaut : faux. */
  capResistances?: boolean
  /** Vérifier les conditions d'objets. Défaut : vrai. */
  checkConditions?: boolean
  /**
   * Interdire le bouclier avec une arme `twoHanded`. Défaut : faux — la notion d'arme à deux mains a disparu en 2.41
   * (equipment.md §2.3 ; seul le Balai rudimentaire garde le drapeau). Conservé en option (règle Dofus 2 historique).
   */
  twoHandedBlocksShield?: boolean
  conditionProfile?: ConditionProfile
}

export type BuildIssueCode =
  | 'breed'
  | 'level'
  | 'points'
  | 'scroll'
  | 'item'
  | 'slot'
  | 'itemLevel'
  | 'duplicate'
  | 'twoHanded'
  | 'condition'
  | 'forgemagie'
  | 'exoLimit'
  | 'cap'
  | 'spellVariants'
  | 'rolls'
  | 'petLevel'

export interface BuildIssue {
  /** `error` : build impossible en jeu ; `warning` : build valide mais sous-optimal / à vérifier. */
  severity: 'error' | 'warning'
  code: BuildIssueCode
  message: string
  itemId?: number
}

export interface BuildSetCount {
  setId: number
  /** Nombre d'objets distincts de la panoplie équipés. */
  count: number
  /** Palier de bonus appliqué (nombre d'objets de la clé utilisée, 0 = aucun bonus). */
  tier: number
}

export interface BuildStatsResult {
  /**
   * Caractéristiques finales : plafonds appliqués et stats dérivées incluses (initiative, tacle, fuite, …).
   * ⚠ `initiative` est le TOTAL (bonus + Fo + Int + Cha + Agi) : un consommateur qui ajoute lui-même les 4
   * caractéristiques (ex. `initiativeOf` de src/engine/engine.ts) doit partir de `raw.initiative` (bonus seul).
   * De même `tackleBlock`/`tackleEvade`/esquives/retraits incluent ⌊Agi/10⌋ / ⌊Sa/10⌋ : après un buff de
   * caractéristique en combat, recalculer avec `finalizeStats(raw + delta)`.
   */
  stats: Stats
  /** Sommes brutes avant plafonds et sans stats dérivées (initiative = bonus seul). Sert aux conditions. */
  raw: Stats
  maxHp: number
  /** Messages lisibles de tous les problèmes (erreurs et avertissements, dans l'ordre de détection). */
  warnings: string[]
  issues: BuildIssue[]
  /** Aucun problème de sévérité `error`. */
  valid: boolean
  /** Valeurs de base issues des points investis. */
  base: PrimaryStatRecord
  /** Parchemins retenus (plafonnés à 100). */
  additional: PrimaryStatRecord
  points: { available: number; spent: number; remaining: number }
  sets: BuildSetCount[]
  /** Nombre de bonus de panoplie actifs (`Pk`) = Σ max(0, n − 1). */
  setBonusCount: number
  /** Sorts passifs conférés par les objets (effet 1175), pour le moteur de combat. */
  passiveSpells: number[]
  /** Surplus perdu au-delà des plafonds (PA/PM/PO/invocations). */
  wasted: Partial<Record<'ap' | 'mp' | 'range' | 'summons', number>>
}

// ───────────────────────────── constantes ─────────────────────────────

/** Id de classe de l'Enutrof (prospection de base 120). */
export const BREED_ENUTROF = 3
/** Type d'objet « Familier » (bonus au prorata du niveau). */
export const ITEM_TYPE_PET = 18
/** Type d'objet « Prysmaradite » (une seule par personnage, règle rappelée par la MàJ 3.3). */
export const ITEM_TYPE_PRYSMARADITE = 217

/** Nombre maximal d'objets par emplacement. */
export const SLOT_CAPACITY: Readonly<Record<EquipmentSlot, number>> = {
  amulet: 1,
  ring: 2,
  belt: 1,
  boots: 1,
  hat: 1,
  cloak: 1,
  shield: 1,
  weapon: 1,
  dofus: 6,
  pet: 1,
  other: 0,
}

const SLOT_NAMES_FR: Readonly<Record<EquipmentSlot, string>> = {
  amulet: 'amulette',
  ring: 'anneau',
  belt: 'ceinture',
  boots: 'bottes',
  hat: 'coiffe',
  cloak: 'cape',
  shield: 'bouclier',
  weapon: 'arme',
  dofus: 'Dofus/trophée',
  pet: 'familier/monture',
  other: 'non équipable',
}

const EQUIPMENT_SLOTS = Object.keys(SLOT_CAPACITY) as EquipmentSlot[]

const SPELL_PAIR_COUNT = 22

/** Noms des exos limités à un par personnage (messages). */
const ONCE_EXO_NAMES_FR = { ap: 'PA', mp: 'PM', range: 'PO' } as const

/** PA de base : 6, +1 dès le niveau 100. */
export function baseActionPoints(level: number): number {
  return statLevel(level) >= 100 ? 7 : 6
}

/** PV hors Vitalité : 55 + 5 × (niveau − 1) (1 050 au niveau 200 ; les niveaux Oméga n'en donnent plus). */
export function baseLifePoints(level: number): number {
  return 55 + 5 * (statLevel(level) - 1)
}

/**
 * Prospection de base : 100, 120 pour l'Enutrof (règle historique du jeu, demandée par la spécification ;
 * non appliquée par DofusDB — INCERTAIN, sans effet en combat).
 */
export function baseProspecting(breedId: number): number {
  return breedId === BREED_ENUTROF ? 120 : 100
}

/**
 * ⌊v/10⌋ des stats dérivées (Tacle/Fuite = ⌊Agilité/10⌋, Esquive/Retrait = ⌊Sagesse/10⌋, Prospection ⌊Chance/10⌋).
 * Arrondi INFÉRIEUR (et non troncature) comme le stuff creator DofusDB (`Math.floor`, module `b9bf`) et
 * equipment.md §3.2 / mechanics.md §6-7 : diffère de la troncature pour une caractéristique totale négative.
 */
function div10(v: number): number {
  return Math.floor(v / 10)
}

// ───────────────────────────── jets ─────────────────────────────

/** Montant (positif) d'une ligne selon la politique de jet. */
export function rollEffect(line: ItemEffectRange, policy: RollPolicy = 'max'): number {
  const lo = line.min
  const hi = Math.max(line.min, line.max)
  switch (policy) {
    case 'max':
      return hi
    case 'min':
      return lo
    case 'mean':
      return Math.floor((lo + hi) / 2)
    case 'best':
      return itemEffectSign(line.effectId) < 0 ? lo : hi
  }
}

// ───────────────────────────── finalisation ─────────────────────────────

export interface FinalizeOptions {
  level: number
  breedId: number
  caps?: Partial<StatCaps>
  /** Plafonds spécifiques (effet 2897) par caractéristique. */
  statCaps?: Partial<Record<StatKey, number>>
  capResistances?: boolean
}

const RES_PCT_KEYS: readonly StatKey[] = ['neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct']

/**
 * Applique plafonds et stats dérivées à des sommes brutes (cf. `BuildStatsResult.raw`). Utilisable par le moteur
 * pour recalculer les dérivées après des buffs de caractéristiques.
 */
export function finalizeStats(
  raw: Stats,
  opts: FinalizeOptions,
): { stats: Stats; maxHp: number; wasted: BuildStatsResult['wasted'] } {
  const caps = opts.caps ? { ...DEFAULT_STAT_CAPS, ...opts.caps } : DEFAULT_STAT_CAPS
  const stats = copyStats(raw)
  const wasted: BuildStatsResult['wasted'] = {}
  const capOne = (key: 'ap' | 'mp' | 'range' | 'summons', cap: number): void => {
    const specific = opts.statCaps?.[key]
    const limit = specific === undefined ? cap : Math.min(cap, specific)
    if (stats[key] > limit) {
      wasted[key] = stats[key] - limit
      stats[key] = limit
    }
  }
  capOne('ap', caps.ap)
  capOne('mp', caps.mp)
  capOne('range', caps.range)
  capOne('summons', caps.summons)
  if (opts.statCaps) {
    for (const k in opts.statCaps) {
      const key = k as StatKey
      if (key === 'ap' || key === 'mp' || key === 'range' || key === 'summons') continue
      const limit = opts.statCaps[key]!
      if (stats[key] > limit) stats[key] = limit
    }
  }
  if (opts.capResistances) for (const k of RES_PCT_KEYS) stats[k] = Math.min(stats[k], caps.resPct)

  const agi = div10(stats.agility)
  const wis = div10(stats.wisdom)
  stats.initiative = raw.initiative + stats.strength + stats.intelligence + stats.chance + stats.agility
  stats.prospecting = baseProspecting(opts.breedId) + div10(stats.chance) + raw.prospecting
  stats.tackleBlock = agi + raw.tackleBlock
  stats.tackleEvade = agi + raw.tackleEvade
  stats.apParry = wis + raw.apParry
  stats.mpParry = wis + raw.mpParry
  stats.apReduction = wis + raw.apReduction
  stats.mpReduction = wis + raw.mpReduction
  const maxHp = baseLifePoints(opts.level) + stats.vitality + stats.lifePoints
  return { stats, maxHp, wasted }
}

// ───────────────────────────── agrégation ─────────────────────────────

interface ResolvedItem {
  eq: EquippedItem
  item: ItemData
}

/** Jets retenus (montants positifs) de chaque ligne d'un objet ; réutilisé entre objets (pas d'allocation par ligne). */
let lineBuffer: number[] = []

/** Accumulateur des sommes brutes (indexé selon `STAT_ORDER`), réutilisé d'un appel à l'autre. */
const acc = new Float64Array(STAT_COUNT)
const I_AP = STAT_INDEX.ap
const I_MP = STAT_INDEX.mp
const I_SUMMONS = STAT_INDEX.summons
const PRIMARY_INDEX: readonly number[] = PRIMARY_STATS.map(s => STAT_INDEX[s])

/** Contributions d'un objet pré-calculées pour chaque politique de jet (lignes de caractéristiques seulement). */
interface CompiledItem {
  /** Index d'accumulateur de chaque ligne de caractéristique. */
  indices: number[]
  /** Valeurs signées alignées sur `indices`, par politique de jet. */
  values: Record<RollPolicy, number[]>
  passiveSpells: number[]
  caps: ItemEffectRange[]
}

const ROLL_POLICIES: readonly RollPolicy[] = ['max', 'min', 'mean', 'best']
/** Cache par objet (les données d'objets sont statiques : un `ItemData` ne doit pas être muté après usage). */
const compiledItems = new WeakMap<ItemData, CompiledItem>()

/** Panoplie pré-compilée : paliers triés et bonus de chaque palier (indices d'accumulateur + valeurs signées). */
interface CompiledSet {
  tiers: number[]
  bonuses: Map<number, { indices: number[]; values: number[]; caps: ItemEffectRange[] }>
}
const compiledSets = new WeakMap<ItemSetData, CompiledSet>()

function compileSet(set: ItemSetData): CompiledSet {
  let c = compiledSets.get(set)
  if (c) return c
  c = { tiers: [], bonuses: new Map() }
  for (const k in set.bonuses) {
    const n = Number(k)
    const tier = { indices: [] as number[], values: [] as number[], caps: [] as ItemEffectRange[] }
    for (const line of set.bonuses[n]) {
      if (line.effectId === EFFECT_STAT_CAP) {
        tier.caps.push(line)
        continue
      }
      const index = itemEffectStatIndex(line.effectId)
      if (index < 0) continue
      tier.indices.push(index)
      tier.values.push(itemEffectSign(line.effectId) * Math.max(line.min, line.max))
    }
    c.tiers.push(n)
    c.bonuses.set(n, tier)
  }
  c.tiers.sort((a, b) => a - b)
  compiledSets.set(set, c)
  return c
}

function compileItem(item: ItemData): CompiledItem {
  let c = compiledItems.get(item)
  if (c) return c
  c = { indices: [], values: { max: [], min: [], mean: [], best: [] }, passiveSpells: [], caps: [] }
  for (const line of item.effects) {
    if (line.effectId === EFFECT_PASSIVE_SPELL) c.passiveSpells.push(line.min)
    else if (line.effectId === EFFECT_STAT_CAP) c.caps.push(line)
    else {
      const index = itemEffectStatIndex(line.effectId)
      if (index < 0) continue
      const sign = itemEffectSign(line.effectId)
      c.indices.push(index)
      for (const p of ROLL_POLICIES) c.values[p].push(sign * rollEffect(line, p))
    }
  }
  compiledItems.set(item, c)
  return c
}

/**
 * Calcule les caractéristiques d'un build. Tous les problèmes (objets introuvables, emplacements, conditions,
 * forgemagie, points…) sont signalés dans `issues`/`warnings` sans interrompre le calcul : les stats de TOUS les objets
 * fournis sont sommées, `valid` indique si le build est réalisable en jeu.
 */
export function computeBuildStats(
  build: CharacterBuild,
  data: BuildDataSource,
  options: BuildStatsOptions = {},
): BuildStatsResult {
  const issues: BuildIssue[] = []
  const error = (code: BuildIssueCode, message: string, itemId?: number): void => {
    issues.push({ severity: 'error', code, message, itemId })
  }
  const warn = (code: BuildIssueCode, message: string, itemId?: number): void => {
    issues.push({ severity: 'warning', code, message, itemId })
  }
  const policy = options.rollPolicy ?? 'max'

  // ── niveau et classe
  if (!(build.level >= 1)) error('level', `Niveau invalide : ${build.level}`)
  const level = statLevel(build.level || 1)
  const breed = data.breed(build.breedId)
  if (!breed) warn('breed', `Classe inconnue : ${build.breedId} (paliers de coût par défaut)`)

  acc.fill(0)

  // ── points de caractéristiques
  const invested = build.characteristicPoints
  for (const s of PRIMARY_STATS) {
    const pts = invested[s] ?? 0
    if (!Number.isInteger(pts) || pts < 0) error('points', `Points investis invalides en ${PRIMARY_STAT_NAMES_FR[s]} : ${pts}`)
  }
  const fromPoints = baseStatsFromPoints(breed, invested)
  const base = fromPoints.values
  const available = availableCharacteristicPoints(level)
  if (fromPoints.spent > available) {
    error('points', `${fromPoints.spent} points investis pour ${available} disponibles au niveau ${level}`)
  }
  for (let k = 0; k < PRIMARY_STATS.length; k++) {
    const s = PRIMARY_STATS[k]
    acc[PRIMARY_INDEX[k]] += base[s]
    const lost = fromPoints.leftover[s]
    if (lost > 0) warn('points', `${lost} point(s) investi(s) en ${PRIMARY_STAT_NAMES_FR[s]} sans effet (palier de coût)`)
  }

  // ── parchemins
  const additional = emptyPrimaryStats()
  for (let k = 0; k < PRIMARY_STATS.length; k++) {
    const s = PRIMARY_STATS[k]
    const v = build.scrolls[s] ?? 0
    if (!Number.isInteger(v) || v < 0) {
      error('scroll', `Parchemin invalide en ${PRIMARY_STAT_NAMES_FR[s]} : ${v}`)
      continue
    }
    if (v > MAX_SCROLL_PER_STAT) {
      warn('scroll', `Parchemins de ${PRIMARY_STAT_NAMES_FR[s]} plafonnés à ${MAX_SCROLL_PER_STAT} (${v} demandés)`)
    }
    additional[s] = Math.min(v, MAX_SCROLL_PER_STAT)
    acc[PRIMARY_INDEX[k]] += additional[s]
  }

  // ── bases de classe
  acc[I_AP] += baseActionPoints(level)
  acc[I_MP] += 3
  acc[I_SUMMONS] += 1

  // ── objets : résolution et règles d'emplacement
  const resolved: ResolvedItem[] = []
  const slotCount: Record<EquipmentSlot, number> = {
    amulet: 0, ring: 0, belt: 0, boots: 0, hat: 0, cloak: 0, shield: 0, weapon: 0, dofus: 0, pet: 0, other: 0,
  }
  for (const eq of build.items) {
    const item = data.item(eq.itemId)
    if (!item) {
      error('item', `Objet introuvable : ${eq.itemId}`, eq.itemId)
      continue
    }
    if (eq.slot !== undefined && eq.slot !== item.slot) {
      error('slot', `${item.name} : emplacement ${SLOT_NAMES_FR[item.slot]}, pas ${SLOT_NAMES_FR[eq.slot]}`, item.id)
    }
    slotCount[item.slot]++
    if (item.level > build.level) error('itemLevel', `${item.name} : niveau ${item.level} requis`, item.id)
    resolved.push({ eq, item })
  }
  for (const s of EQUIPMENT_SLOTS) {
    if (slotCount[s] > SLOT_CAPACITY[s]) {
      error('slot', `${slotCount[s]} objet(s) « ${SLOT_NAMES_FR[s]} » pour ${SLOT_CAPACITY[s]} emplacement(s)`)
    }
  }
  let prysmaradites = 0
  let twoHanded: ItemData | undefined
  let shield: ItemData | undefined
  for (let i = 0; i < resolved.length; i++) {
    const item = resolved[i].item
    if (item.typeId === ITEM_TYPE_PRYSMARADITE) prysmaradites++
    if (item.slot === 'weapon' && item.weapon?.twoHanded) twoHanded = item
    if (item.slot === 'shield') shield = item
    for (let j = 0; j < i; j++) {
      if (resolved[j].item.id !== item.id) continue
      if (item.slot === 'dofus') error('duplicate', `${item.name} : impossible d'équiper deux fois le même Dofus/trophée`, item.id)
      else if (item.slot === 'ring' && item.setId !== null) {
        error('duplicate', `${item.name} : deux anneaux identiques interdits pour un anneau de panoplie`, item.id)
      }
    }
  }
  if (prysmaradites > 1) error('slot', `${prysmaradites} prysmaradites équipées (une seule autorisée)`)
  if (options.twoHandedBlocksShield && twoHanded && shield) {
    error('twoHanded', `${twoHanded.name} est une arme à deux mains : bouclier ${shield.name} interdit`, shield.id)
  }

  // ── objets : lignes, sorts passifs, plafonds 2897, exos
  const passiveSpells: number[] = []
  const statCaps: Partial<Record<StatKey, number>> = {}
  const addCap = (line: ItemEffectRange): void => {
    const stat = STAT_BY_CHARACTERISTIC_ID[line.min]
    if (!stat) return
    const cur = statCaps[stat]
    statCaps[stat] = cur === undefined ? line.max : Math.min(cur, line.max)
  }
  const onceExoCounted = new Set<StatKey>()
  const setItems = new Map<number, number[]>()

  for (const { eq, item } of resolved) {
    const rolls = eq.rolls
    const exos = eq.exos
    let petFactor = 100
    if (eq.petLevel !== undefined) {
      if (item.typeId !== ITEM_TYPE_PET) {
        warn('petLevel', `${item.name} : niveau de familier ignoré (pas un familier)`, item.id)
      } else if (!Number.isInteger(eq.petLevel) || eq.petLevel < 0 || eq.petLevel > 100) {
        error('petLevel', `${item.name} : niveau de familier invalide (${eq.petLevel}, attendu 0-100)`, item.id)
      } else {
        petFactor = eq.petLevel
      }
    }
    if (!rolls && !exos?.length && petFactor === 100) {
      // Chemin rapide : contributions pré-calculées (cas courant de l'optimiseur).
      const c = compileItem(item)
      const values = c.values[policy]
      const indices = c.indices
      for (let i = 0; i < indices.length; i++) acc[indices[i]] += values[i]
      for (const spellId of c.passiveSpells) if (!passiveSpells.includes(spellId)) passiveSpells.push(spellId)
      for (const cap of c.caps) addCap(cap)
    } else {
      const effects = item.effects
      if (lineBuffer.length < effects.length) lineBuffer = new Array<number>(effects.length * 2).fill(0)
      let usedRolls = 0
      for (let i = 0; i < effects.length; i++) {
        const line = effects[i]
        const id = line.effectId
        if (id === EFFECT_PASSIVE_SPELL) {
          if (!passiveSpells.includes(line.min)) passiveSpells.push(line.min)
          continue
        }
        if (id === EFFECT_STAT_CAP) {
          addCap(line)
          continue
        }
        let override = rolls?.[id]
        if (override !== undefined) {
          usedRolls++
          if (!Number.isInteger(override) || override < 0) {
            // Jet invalide (NaN, négatif, non entier) : signalé, remplacé par le jet de la politique (stats finies).
            error('rolls', `${item.name} : jet invalide (${override}) sur la ligne ${id}`, item.id)
            override = undefined
          }
        }
        let v = override ?? rollEffect(line, policy)
        lineBuffer[i] = v
        if (petFactor !== 100) v = Math.round((v * petFactor) / 100)
        const index = itemEffectStatIndex(id)
        if (index >= 0) acc[index] += itemEffectSign(id) * v
      }
      if (rolls) {
        const known = Object.keys(rolls).length
        if (usedRolls < known) {
          warn('rolls', `${item.name} : ${known - usedRolls} jet(s) sur des effets absents de l'objet`, item.id)
        }
      }
      // Forgemagie (overs via `rolls`, exos, transcendances).
      if (rolls || exos?.length) {
        for (const msg of checkItemForgemagie(item, lineBuffer, exos)) error('forgemagie', msg, item.id)
      }
    }
    if (exos) {
      for (const line of exos) {
        // Valeur ou caractéristique invalide : signalée par checkItemForgemagie, jamais sommée (stats finies, et pas
        // d'écriture hors index dans l'accumulateur pour une clé inconnue venue d'un JSON).
        const index: unknown = STAT_INDEX[line.stat]
        if (!isValidForgeValue(line.value) || typeof index !== 'number') continue
        if (ONCE_PER_CHARACTER_EXO_STATS.has(line.stat) && forgeKind(item, line) === 'exo') {
          if (onceExoCounted.has(line.stat)) {
            const label = ONCE_EXO_NAMES_FR[line.stat as keyof typeof ONCE_EXO_NAMES_FR] ?? line.stat
            warn('exoLimit', `${item.name} : exo ${label} ignoré (un seul exo de ce type compté par personnage)`, item.id)
            continue
          }
          onceExoCounted.add(line.stat)
        }
        acc[index] += line.value
      }
    }

    if (item.setId !== null) {
      const ids = setItems.get(item.setId)
      if (!ids) setItems.set(item.setId, [item.id])
      else if (!ids.includes(item.id)) ids.push(item.id)
    }
  }

  // ── panoplies
  const sets: BuildSetCount[] = []
  let setBonusCount = 0
  for (const [setId, ids] of setItems) {
    const count = ids.length
    setBonusCount += Math.max(0, count - 1)
    const set = data.itemSet(setId)
    let tier = 0
    if (!set) {
      if (count > 1) warn('item', `Panoplie introuvable : ${setId}`)
    } else {
      const cs = compileSet(set)
      for (const n of cs.tiers) if (n <= count) tier = n
      const bonus = tier > 0 ? cs.bonuses.get(tier) : undefined
      if (bonus) {
        const { indices, values } = bonus
        for (let i = 0; i < indices.length; i++) acc[indices[i]] += values[i]
        for (const cap of bonus.caps) addCap(cap)
      }
    }
    sets.push({ setId, count, tier })
  }

  const raw = statsFromArray(acc)

  // ── conditions (état final, valeurs brutes avant plafonds, objet évalué inclus)
  if (options.checkConditions ?? true) {
    const ctx: CriterionContext = {
      raw,
      base,
      additional,
      level: build.level,
      breedId: build.breedId,
      setBonusCount,
      profile: build.sex === undefined ? options.conditionProfile : { ...options.conditionProfile, sex: build.sex },
    }
    const unknown = new Set<string>()
    for (const { item } of resolved) {
      if (!item.conditions) continue
      let ok: boolean
      try {
        ok = evaluateCriterion(parseCriterion(item.conditions), ctx, unknown)
      } catch (e) {
        warn('condition', `${item.name} : condition illisible « ${item.conditions} » (${(e as Error).message})`, item.id)
        continue
      }
      if (!ok) {
        const why = explainCriterion(item.conditions, ctx).join(', ')
        error('condition', `${item.name} : condition « ${item.conditions} » non remplie${why ? ` — ${why}` : ''}`, item.id)
      }
    }
    if (unknown.size > 0) warn('condition', `Conditions non interprétées (supposées vraies) : ${[...unknown].join(', ')}`)
  }

  // ── variantes de sorts
  const variants = build.spellVariants
  if (variants) {
    if (variants.length !== SPELL_PAIR_COUNT) {
      warn('spellVariants', `${variants.length} choix de variantes de sorts (${SPELL_PAIR_COUNT} attendus)`)
    }
    const unlock = breed?.spellPairUnlockLevels
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]
      if (v !== 0 && v !== 1) {
        warn('spellVariants', `Variante de sort invalide (paire ${i + 1}) : ${String(v)}`)
        continue
      }
      const need = unlock?.[i]?.[v]
      if (need !== undefined && need > build.level) {
        warn('spellVariants', `Paire ${i + 1} : variante ${v} débloquée au niveau ${need}`)
      }
    }
  }

  // ── finalisation
  const fin = finalizeStats(raw, {
    level,
    breedId: build.breedId,
    caps: options.caps,
    statCaps,
    capResistances: options.capResistances,
  })
  const names: Record<'ap' | 'mp' | 'range' | 'summons', string> = { ap: 'PA', mp: 'PM', range: 'PO', summons: 'invocations' }
  for (const k in fin.wasted) {
    const key = k as keyof typeof names
    warn('cap', `${names[key]} : ${fin.wasted[key]} au-delà du plafond (${fin.stats[key]}), perdu(s)`)
  }

  const spent = fromPoints.spent
  return {
    stats: fin.stats,
    raw,
    maxHp: fin.maxHp,
    warnings: issues.map(i => i.message),
    issues,
    valid: !issues.some(i => i.severity === 'error'),
    base,
    additional,
    points: { available, spent, remaining: available - spent },
    sets,
    setBonusCount,
    passiveSpells,
    wasted: fin.wasted,
  }
}

/** Build vide (personnage nu, sans points ni parchemins). */
export function nakedBuild(breedId: number, level = 200, name = 'Nu'): CharacterBuild {
  return { name, breedId, level, characteristicPoints: {}, scrolls: {}, items: [] }
}

/** Parchemins à 100 dans les 6 caractéristiques (personnage « parchoté »). */
export function fullScrolls(): PrimaryStatRecord {
  return { vitality: 100, wisdom: 100, strength: 100, intelligence: 100, chance: 100, agility: 100 }
}
