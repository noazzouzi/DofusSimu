/**
 * Fiche de stuff d'un personnage — section « Stuffs » du visualiseur (web/src/stuffs.ts) et méta des replays.
 *
 * La fiche est AUTONOME et sérialisable (JSON) : objets résolus (nom, type, niveau, icône, panoplie, lignes d'effets avec
 * le jet retenu et la plage du jeu, forgemagie, conditions), panoplies et bonus actifs, caractéristiques finales groupées,
 * décomposition des caractéristiques primaires (points / parchemins / équipement), variantes de sorts et problèmes du
 * build. Le visualiseur n'a besoin d'aucune donnée du jeu pour l'afficher.
 *
 * Les valeurs sont celles de `computeBuildStats` (jets max par défaut, comme le moteur de combat) : la fiche montre
 * exactement le personnage simulé.
 */
import { ELEMENT_KEYS, type ElementKey, type StatKey } from '../core/types'
import type { BreedData, EquipmentSlot, ItemData, ItemEffectRange, SpellData } from '../data/model'
import { computeBuildStats, ITEM_TYPE_PET, rollEffect, type BuildDataSource, type CharacterBuild } from './build'
import { PRIMARY_STAT_NAMES_FR, PRIMARY_STATS, type PrimaryStat } from './characteristicPoints'
import { EFFECT_PASSIVE_SPELL, EFFECT_STAT_CAP, itemEffectSign, itemEffectStat, STAT_BY_CHARACTERISTIC_ID } from './effects'
import { forgeKind, type ForgeKind } from './forgemagie'

// ───────────────────────────── format ─────────────────────────────

export const STUFF_SHEET_VERSION = 1

/** Ligne d'effet affichable (objet ou bonus de panoplie). */
export interface SheetEffectLine {
  effectId: number
  /** Texte avec la valeur retenue (« 300 Vitalité », « -6% Résistance Terre », « 49 à 55 dommages Terre »). */
  text: string
  /** Caractéristique touchée (lignes de caractéristiques seulement). */
  stat?: StatKey
  /** Valeur SIGNÉE retenue dans le build (lignes de caractéristiques). */
  value?: number
  /** Plage du jeu (« 251 à 300 ») quand le jet n'est pas fixe. */
  range?: string
  kind: 'stat' | 'weapon' | 'heal' | 'passive' | 'other'
  /** Malus (valeur négative) : affiché en rouge. */
  malus?: boolean
}

export interface SheetForgeLine {
  stat: StatKey
  label: string
  value: number
  kind: ForgeKind
}

export interface SheetWeapon {
  apCost: number
  minRange: number
  range: number
  critChance: number
  critBonus: number
  maxCastPerTurn: number
}

export interface SheetItem {
  slot: EquipmentSlot
  slotLabel: string
  itemId: number
  name: string
  typeName?: string
  level: number
  iconId?: number
  setId?: number
  setName?: string
  legendary?: boolean
  /** Conditions d'équipement brutes (« PA<12&CS>300 »). */
  conditions?: string
  effects: SheetEffectLine[]
  forgemagie: SheetForgeLine[]
  weapon?: SheetWeapon
  /** Niveau de familier retenu (familiers seulement). */
  petLevel?: number
  /** Problèmes propres à cet objet (conditions, forgemagie…). */
  issues: string[]
}

export interface SheetSet {
  setId: number
  name: string
  /** Objets de la panoplie équipés / objets de la panoplie. */
  count: number
  size: number
  /** Palier de bonus appliqué (0 = aucun bonus). */
  tier: number
  bonus: SheetEffectLine[]
  /** Noms des objets de la panoplie équipés. */
  equipped: string[]
}

export interface SheetStat {
  key: StatKey | 'hp'
  label: string
  value: number
  pct?: boolean
  /** Surplus perdu au-delà du plafond (PA, PM, PO, invocations). */
  wasted?: number
}

export interface SheetStatGroup {
  id: 'main' | 'damage' | 'secondary' | 'resistance'
  label: string
  stats: SheetStat[]
}

/** Dommages et résistances d'un élément. */
export interface SheetElement {
  element: ElementKey
  label: string
  damage: number
  resPct: number
  res: number
}

export interface SheetPrimary {
  stat: PrimaryStat
  label: string
  /** Points investis (capital dépensé). */
  invested: number
  /** Valeur obtenue par les points. */
  base: number
  scrolls: number
  /** Objets, panoplies et forgemagie. */
  equipment: number
  total: number
}

export interface SheetSpellPair {
  pair: number
  active: string
  other: string
  variant: 0 | 1
  /** Variante différente de celle du preset. */
  changed?: boolean
}

export interface StuffSheet {
  version: number
  name: string
  className: string
  breedId: number
  level: number
  presetId?: string
  presetLabel?: string
  /** Build retenu (preset dérivé, `preset@stuff`, `preset+build`…) quand il diffère du preset. */
  buildId?: string
  /** Origine du build (fichier d'équipe, preset du scénario, stuff optimisé…). */
  origin?: string
  role?: string
  roleLabel?: string
  element?: ElementKey
  elementLabel?: string
  /** Libellé du stuff (presets.json) et sa provenance. */
  stuffLabel?: string
  stuffSource?: string
  hp: number
  valid: boolean
  items: SheetItem[]
  sets: SheetSet[]
  primary: SheetPrimary[]
  points: { available: number; spent: number; remaining: number }
  groups: SheetStatGroup[]
  elements: SheetElement[]
  spells: SheetSpellPair[]
  passiveSpells: string[]
  issues: { severity: 'error' | 'warning'; message: string }[]
}

/** Build tel qu'écrit dans un fichier d'équipe (`TeamFileBuild`). */
export interface SheetBuild {
  level?: number
  items: CharacterBuild['items']
  characteristicPoints?: Partial<Record<PrimaryStat, number>>
  scrolls?: Partial<Record<PrimaryStat, number>>
  spellVariants?: (0 | 1)[]
}

/**
 * Membre d'équipe en cours d'édition (section « Stuffs », src/optimizer/team/editor.ts). Sans `build`, le build est celui
 * du preset (avec `stuff` : `preset@stuff`) ; avec `build`, c'est un build personnalisé écrit tel quel dans le fichier.
 */
export interface DraftMember {
  breedId: number
  name?: string
  preset?: string
  stuff?: string
  role?: string
  fixed?: boolean
  build?: SheetBuild
  /** Candidats d'`optimize` (conservés tels quels, retirés si la classe change). */
  candidates?: string[]
}

/** Équipe d'un scénario (fichier `data/teams/<scénario>.json`) avec la fiche de chaque membre. */
export interface TeamStuffs {
  scenario: string
  scenarioName: string
  /** Fichier d'équipe, relatif à la racine du dépôt. */
  file: string
  /** Nom du fichier dans data/teams (`vortex.json`). */
  fileName: string
  /** Membres sous forme éditable (mêmes builds que les fiches). */
  drafts: DraftMember[]
  chosenBy?: string
  decidedAt?: string
  description?: string
  notes: string[]
  optimized?: { report: string; date?: string; note?: string }
  members: StuffSheet[]
  /** Erreur de résolution (équipe illisible) : `members` est alors vide. */
  error?: string
}

/** Catalogue de la section « Stuffs » (module virtuel `virtual:dofussimu-stuffs`, voir web/plugins/stuffs.ts). */
export interface StuffCatalog {
  version: number
  generatedAt: string
  teams: TeamStuffs[]
  /** Édition possible (serveur de développement : API d'enregistrement dans data/teams). */
  editable?: boolean
  error?: string
}

// ───────────────────────────── libellés ─────────────────────────────

export const SLOT_ORDER: readonly EquipmentSlot[] = ['amulet', 'hat', 'cloak', 'belt', 'boots', 'ring', 'weapon', 'shield', 'pet', 'dofus', 'other']

export const SLOT_LABELS_FR: Readonly<Record<EquipmentSlot, string>> = {
  amulet: 'Amulette', ring: 'Anneau', belt: 'Ceinture', boots: 'Bottes', hat: 'Coiffe', cloak: 'Cape', shield: 'Bouclier',
  weapon: 'Arme', pet: 'Familier / Monture', dofus: 'Dofus / Trophée', other: 'Autre',
}

export const ELEMENT_LABELS_FR: Readonly<Record<ElementKey, string>> = { neutral: 'Neutre', earth: 'Terre', fire: 'Feu', water: 'Eau', air: 'Air' }

export const ROLE_LABELS_FR: Readonly<Record<string, string>> = {
  killer: 'Tueur', zoneDps: 'Dégâts de zone', mpLock: 'Retrait PM', apLock: 'Retrait PA', placer: 'Placeur', tank: 'Tank',
  healer: 'Soigneur', support: 'Soutien', summoner: 'Invocateur',
}

/** Libellé d'une caractéristique ; `pct` : valeur en pourcentage (« 8% Résistance Terre »). */
const STAT_META: Readonly<Record<StatKey, { label: string; pct?: boolean }>> = {
  vitality: { label: 'Vitalité' }, wisdom: { label: 'Sagesse' }, strength: { label: 'Force' },
  intelligence: { label: 'Intelligence' }, chance: { label: 'Chance' }, agility: { label: 'Agilité' },
  ap: { label: 'PA' }, mp: { label: 'PM' }, range: { label: 'Portée' }, summons: { label: 'Invocations' },
  initiative: { label: 'Initiative' }, prospecting: { label: 'Prospection' }, critical: { label: 'Critique', pct: true },
  heals: { label: 'Soins' }, power: { label: 'Puissance' }, damage: { label: 'Dommages' },
  neutralDamage: { label: 'Dommages Neutre' }, earthDamage: { label: 'Dommages Terre' }, fireDamage: { label: 'Dommages Feu' },
  waterDamage: { label: 'Dommages Eau' }, airDamage: { label: 'Dommages Air' }, criticalDamage: { label: 'Dommages Critiques' },
  pushDamage: { label: 'Dommages Poussée' }, trapDamage: { label: 'Dommages Pièges' }, trapPower: { label: 'Puissance Pièges' },
  spellDamagePct: { label: 'Dommages aux sorts', pct: true }, weaponDamagePct: { label: 'Dommages d’armes', pct: true },
  meleeDamagePct: { label: 'Dommages mêlée', pct: true }, rangedDamagePct: { label: 'Dommages distance', pct: true },
  finalDamagePct: { label: 'Dommages finaux', pct: true }, apReduction: { label: 'Retrait PA' }, mpReduction: { label: 'Retrait PM' },
  apParry: { label: 'Esquive PA' }, mpParry: { label: 'Esquive PM' }, tackleBlock: { label: 'Tacle' }, tackleEvade: { label: 'Fuite' },
  neutralResPct: { label: 'Résistance Neutre', pct: true }, earthResPct: { label: 'Résistance Terre', pct: true },
  fireResPct: { label: 'Résistance Feu', pct: true }, waterResPct: { label: 'Résistance Eau', pct: true },
  airResPct: { label: 'Résistance Air', pct: true }, neutralRes: { label: 'Résistance Neutre' }, earthRes: { label: 'Résistance Terre' },
  fireRes: { label: 'Résistance Feu' }, waterRes: { label: 'Résistance Eau' }, airRes: { label: 'Résistance Air' },
  criticalRes: { label: 'Résistance Critiques' }, pushRes: { label: 'Résistance Poussée' },
  meleeResPct: { label: 'Résistance mêlée', pct: true }, rangedResPct: { label: 'Résistance distance', pct: true },
  spellResPct: { label: 'Résistance aux sorts', pct: true }, weaponResPct: { label: 'Résistance aux armes', pct: true },
  reflect: { label: 'Dommages renvoyés' }, lifePoints: { label: 'Points de vie' }, weaponSkillPct: { label: 'Maîtrise d’arme', pct: true },
}

/** Libellé d'une caractéristique (texte de la fiche). */
export function statLabelFr(stat: StatKey): string {
  return STAT_META[stat]?.label ?? stat
}

/** Texte « valeur + caractéristique » d'une ligne (« 8% Résistance Terre », « -20 Tacle »). */
function statText(stat: StatKey, value: number): string {
  const m = STAT_META[stat]
  return m?.pct ? `${value}% ${m.label}` : `${value} ${m?.label ?? stat}`
}

/** Lignes d'armes (dégâts, vols, soins) : libellé après la plage de dés. */
const WEAPON_LINES: Readonly<Record<number, string>> = {
  91: 'vol Eau', 92: 'vol Terre', 93: 'vol Air', 94: 'vol Feu', 95: 'vol Neutre',
  96: 'dommages Eau', 97: 'dommages Terre', 98: 'dommages Air', 99: 'dommages Feu', 100: 'dommages Neutre', 108: 'soins Feu',
}

/** Effets sans intérêt pour le combat (attitude, arme de chasse, échangeabilité, marqueurs internes). */
const HIDDEN_EFFECTS: ReadonlySet<number> = new Set([10, 795, 983, 984, 3829, 3830, 3831, 3832, 3833, 3834, 3835])

function rangeText(lo: number, hi: number, signed: boolean): string | undefined {
  if (hi <= lo) return undefined
  return signed ? `-${lo} à -${hi}` : `${lo} à ${hi}`
}

export interface SheetDataSource extends BuildDataSource {
  spell(id: number): SpellData | undefined
}

/**
 * Ligne d'effet affichable : `amount` = jet retenu (positif, comme dans les données) pour une caractéristique ;
 * undefined pour un effet masqué.
 */
export function effectLine(line: ItemEffectRange, data: Pick<SheetDataSource, 'spell'>, amount?: number): SheetEffectLine | undefined {
  const id = line.effectId
  if (HIDDEN_EFFECTS.has(id)) return undefined
  const lo = line.min
  const hi = Math.max(line.min, line.max)
  const stat = itemEffectStat(id)
  if (stat) {
    const sign = itemEffectSign(id) < 0 ? -1 : 1
    const value = sign * (amount ?? hi)
    return { effectId: id, kind: 'stat', stat, value, text: statText(stat, value), range: rangeText(lo, hi, sign < 0), malus: value < 0 || undefined }
  }
  if (WEAPON_LINES[id]) return { effectId: id, kind: id === 108 ? 'heal' : 'weapon', text: `${hi > lo ? `${lo} à ${hi}` : hi} ${WEAPON_LINES[id]}` }
  if (id === 101 || id === 127) return { effectId: id, kind: 'weapon', text: `-${hi > lo ? `${lo} à ${hi}` : hi} ${id === 101 ? 'PA' : 'PM'}`, malus: true }
  if (id === 6) return { effectId: id, kind: 'weapon', text: `Attire de ${hi} case${hi > 1 ? 's' : ''}` }
  if (id === EFFECT_PASSIVE_SPELL) return { effectId: id, kind: 'passive', text: `Sort : ${data.spell(lo)?.name ?? `#${lo}`}` }
  if (id === EFFECT_STAT_CAP) {
    const capped = STAT_BY_CHARACTERISTIC_ID[lo]
    return { effectId: id, kind: 'other', text: `${capped ? statLabelFr(capped) : `Caractéristique ${lo}`} max. ${line.max}` }
  }
  return { effectId: id, kind: 'other', text: `Effet ${id} (${hi > lo ? `${lo} à ${hi}` : hi})` }
}

// ───────────────────────────── construction ─────────────────────────────

/** Identité d'un personnage (preset, rôle, élément) : tout est facultatif. */
export interface SheetIdentity {
  name: string
  className?: string
  presetId?: string
  presetLabel?: string
  buildId?: string
  origin?: string
  role?: string
  element?: ElementKey
  stuffLabel?: string
  stuffSource?: string
  /** Variantes du preset (pour signaler les variantes changées). */
  presetVariants?: readonly (0 | 1)[]
}

const MAIN_KEYS: readonly StatKey[] = ['ap', 'mp', 'range', 'summons', 'initiative', 'prospecting', 'critical']
const DAMAGE_KEYS: readonly StatKey[] = [
  'power', 'damage', 'criticalDamage', 'heals', 'pushDamage', 'spellDamagePct', 'weaponDamagePct', 'meleeDamagePct',
  'rangedDamagePct', 'finalDamagePct', 'trapDamage', 'trapPower', 'weaponSkillPct',
]
const SECONDARY_KEYS: readonly StatKey[] = ['tackleBlock', 'tackleEvade', 'apReduction', 'mpReduction', 'apParry', 'mpParry']
const RESISTANCE_KEYS: readonly StatKey[] = ['meleeResPct', 'rangedResPct', 'spellResPct', 'weaponResPct', 'criticalRes', 'pushRes', 'reflect']
/** Toujours affichées, même nulles. */
const ALWAYS: ReadonlySet<StatKey> = new Set<StatKey>([
  ...MAIN_KEYS, 'power', 'damage', 'criticalDamage', 'heals', ...SECONDARY_KEYS, 'criticalRes', 'pushRes',
])

function slotRank(slot: EquipmentSlot): number {
  const i = SLOT_ORDER.indexOf(slot)
  return i < 0 ? SLOT_ORDER.length : i
}

function sheetItem(eq: CharacterBuild['items'][number], item: ItemData, data: SheetDataSource, issues: string[]): SheetItem {
  const petFactor = item.typeId === ITEM_TYPE_PET && eq.petLevel !== undefined ? eq.petLevel : 100
  const effects: SheetEffectLine[] = []
  for (const line of item.effects) {
    const rolled = eq.rolls?.[line.effectId] ?? rollEffect(line)
    const amount = petFactor === 100 ? rolled : Math.round((rolled * petFactor) / 100)
    const l = effectLine(line, data, amount)
    if (l) effects.push(l)
  }
  const forgemagie: SheetForgeLine[] = (eq.exos ?? []).map(x => ({ stat: x.stat, label: statText(x.stat, x.value), value: x.value, kind: forgeKind(item, x) }))
  const w = item.weapon
  return {
    slot: item.slot,
    slotLabel: SLOT_LABELS_FR[item.slot],
    itemId: item.id,
    name: item.name,
    typeName: item.typeName,
    level: item.level,
    iconId: item.iconId,
    setId: item.setId ?? undefined,
    setName: item.setId != null ? data.itemSet(item.setId)?.name : undefined,
    legendary: item.isLegendary || undefined,
    conditions: item.conditions || undefined,
    effects,
    forgemagie,
    weapon: w ? { apCost: w.apCost, minRange: w.minRange, range: w.range, critChance: w.critChance, critBonus: w.critBonus, maxCastPerTurn: w.maxCastPerTurn } : undefined,
    petLevel: item.typeId === ITEM_TYPE_PET ? petFactor : undefined,
    issues,
  }
}

function spellPairs(breed: BreedData | undefined, build: CharacterBuild, data: SheetDataSource, presetVariants?: readonly (0 | 1)[]): SheetSpellPair[] {
  const variants = build.spellVariants ?? []
  return (breed?.spellPairs ?? []).map(([a, b], pair) => {
    const variant: 0 | 1 = variants[pair] ? 1 : 0
    const active = variant ? b : a
    const other = variant ? a : b
    const changed = presetVariants ? (presetVariants[pair] ?? 0) !== variant : false
    return { pair, active: data.spell(active)?.name ?? `#${active}`, other: data.spell(other)?.name ?? `#${other}`, variant, changed: changed || undefined }
  })
}

/** Fiche de stuff d'un build (caractéristiques de `computeBuildStats`, jets max). */
export function buildStuffSheet(build: CharacterBuild, data: SheetDataSource, id: SheetIdentity): StuffSheet {
  const r = computeBuildStats(build, data)
  const breed = data.breed(build.breedId)
  const itemIssues = new Map<number, string[]>()
  for (const is of r.issues) if (is.itemId !== undefined) itemIssues.set(is.itemId, [...(itemIssues.get(is.itemId) ?? []), is.message])

  const items: SheetItem[] = []
  for (const eq of build.items) {
    const item = data.item(eq.itemId)
    if (item) items.push(sheetItem(eq, item, data, itemIssues.get(item.id) ?? []))
  }
  items.sort((a, b) => slotRank(a.slot) - slotRank(b.slot))

  const sets: SheetSet[] = r.sets.map(s => {
    const set = data.itemSet(s.setId)
    const ids = new Set(set?.items ?? [])
    const bonus = (s.tier ? (set?.bonuses[s.tier] ?? []) : []).map(l => effectLine(l, data)).filter((l): l is SheetEffectLine => !!l)
    return {
      setId: s.setId,
      name: set?.name ?? `Panoplie ${s.setId}`,
      count: s.count,
      size: ids.size,
      tier: s.tier,
      bonus,
      equipped: items.filter(it => ids.has(it.itemId)).map(it => it.name),
    }
  })
  sets.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const primary: SheetPrimary[] = PRIMARY_STATS.map(stat => {
    const base = r.base[stat]
    const scrolls = r.additional[stat]
    const total = r.stats[stat]
    return { stat, label: PRIMARY_STAT_NAMES_FR[stat], invested: build.characteristicPoints[stat] ?? 0, base, scrolls, equipment: total - base - scrolls, total }
  })

  const toStat = (key: StatKey): SheetStat => {
    const m = STAT_META[key]
    const value = r.stats[key]
    const wasted = (r.wasted as Partial<Record<StatKey, number>>)[key]
    return { key, label: m.label, value, pct: m.pct || undefined, wasted: wasted || undefined }
  }
  const pick = (keys: readonly StatKey[]) => keys.filter(k => ALWAYS.has(k) || r.stats[k] !== 0).map(toStat)
  const groups: SheetStatGroup[] = [
    { id: 'main', label: 'Principales', stats: [{ key: 'hp', label: 'Points de vie', value: r.maxHp }, ...pick(MAIN_KEYS)] },
    { id: 'damage', label: 'Dommages', stats: pick(DAMAGE_KEYS) },
    { id: 'secondary', label: 'Tacle, fuite, retraits', stats: pick(SECONDARY_KEYS) },
    { id: 'resistance', label: 'Autres résistances', stats: pick(RESISTANCE_KEYS) },
  ]
  const elements: SheetElement[] = ELEMENT_KEYS.map(el => {
    const resPct = r.stats[`${el}ResPct` as StatKey]
    return { element: el, label: ELEMENT_LABELS_FR[el], damage: r.stats[`${el}Damage` as StatKey], resPct, res: r.stats[`${el}Res` as StatKey] }
  })

  return {
    version: STUFF_SHEET_VERSION,
    name: id.name,
    className: id.className ?? breed?.name ?? `Classe ${build.breedId}`,
    breedId: build.breedId,
    level: build.level,
    presetId: id.presetId,
    presetLabel: id.presetLabel,
    buildId: id.buildId,
    origin: id.origin,
    role: id.role,
    roleLabel: id.role ? (ROLE_LABELS_FR[id.role] ?? id.role) : undefined,
    element: id.element,
    elementLabel: id.element ? ELEMENT_LABELS_FR[id.element] : undefined,
    stuffLabel: id.stuffLabel,
    stuffSource: id.stuffSource,
    hp: r.maxHp,
    valid: r.valid,
    items,
    sets,
    primary,
    points: r.points,
    groups,
    elements,
    spells: spellPairs(breed, build, data, id.presetVariants),
    passiveSpells: r.passiveSpells.map(s => data.spell(s)?.name ?? `#${s}`),
    issues: r.issues.map(i => ({ severity: i.severity, message: i.message })),
  }
}
