/**
 * Presets de personnages niveau 200 (docs/design/ai.md §15.6) — WP4.
 *
 * Un preset = classe + rôle + élément + variantes des 22 paires de sorts + rotation `scripted` + stuff de départ. Les
 * données sont dans `data/ai/presets.json` (49 presets pour les 19 classes, 2 ou 3 par classe) :
 *  - variantes et rotations tirées des fiches de classe (`data/research/class-mechanics/*.json` : `variantChoices`,
 *    `spellSets`, `recommendedSets`, `rotations`) ;
 *  - stuffs (`stuffs`) = stuffs méta PvM d'equipment.md §12 (objets réels, jets max, un exo PA et un exo PM placés sur
 *    des objets sans ligne PA/PM) : Terre, Eau, Feu, Air, Tank, Sagesse/retrait — tous valides (conditions, plafonds)
 *    pour toutes les classes avec les points du preset et des parchemins complets (tests/opt-runner-presets.test.ts).
 *
 * Choix de stuff d'un membre (`StuffChoice`) : 'default' (stuff du preset), un identifiant de `stuffs`, 'unstuffed'
 * (aucun objet ; points et parchemins du preset — référence « sans stuff ») ou 'naked' (ni objet, ni point, ni
 * parchemin).
 *
 * Ce module ne dépend que des données (pas du moteur ni de l'IA) : il est partagé par l'optimiseur, la CLI, les
 * workers et la politique `scripted` (src/ai/policies/scripted.ts).
 */
import presetsJson from '../../../data/ai/presets.json'
import type { RoleId } from '../../ai/types'
import { ROLE_IDS } from '../../ai/types'
import { allocateAll, PRIMARY_STATS, type PrimaryStat } from '../../stats/characteristicPoints'
import { computeBuildStats, fullScrolls, type BuildDataSource, type BuildStatsResult, type CharacterBuild, type EquippedItem } from '../../stats/build'
import type { MemberSpec } from '../types'

// ───────────────────────────── types ─────────────────────────────

/** Cible d'une étape de rotation : indice pour la politique `scripted` (la nature du sort reste prioritaire). */
export type PresetTarget = 'enemy' | 'self' | 'ally' | 'zone' | 'auto'
export type PresetElement = 'earth' | 'fire' | 'water' | 'air'

export interface RotationStep {
  spell: number
  target: PresetTarget
  /** Lancers successifs visés (défaut 1). */
  repeat?: number
}

export interface StuffTemplate {
  label: string
  element: PresetElement
  items: EquippedItem[]
}

/** Répartition des points de caractéristiques (`allocateAll`). */
export interface PresetPoints {
  primary: PrimaryStat
  /** Valeur de base maximale dans `primary` (ex. 300 pour un tank) ; reste dans `rest`. */
  primaryCap?: number
  rest?: PrimaryStat | null
}

export interface Preset {
  id: string
  breedId: number
  className: string
  label: string
  role: RoleId
  secondaryRole?: RoleId
  element: PresetElement
  /** Identifiant du stuff de départ (`stuffs`). */
  stuff: string
  points: PresetPoints
  /** Variante (0 = sort de base, 1 = variante) de chacune des 22 paires, dans l'ordre de `BreedData.spellPairs`. */
  variants: (0 | 1)[]
  /** Rotation `scripted` (ordre de priorité des sorts). */
  rotation: RotationStep[]
  /** Provenance (fiche de classe, set, rotations). */
  source: string
}

export interface PresetsFile {
  version: number
  description: string
  level: number
  stuffs: Record<string, StuffTemplate>
  presets: Preset[]
}

/** Choix de stuff d'un membre (voir l'en-tête). */
export type StuffChoice = 'default' | 'unstuffed' | 'naked' | (string & {})

// ───────────────────────────── données ─────────────────────────────

const FILE = presetsJson as unknown as PresetsFile

/** Fichier des presets (lecture seule). */
export const PRESETS_FILE: Readonly<PresetsFile> = FILE
/** Tous les presets, dans l'ordre du fichier. */
export const PRESETS: readonly Preset[] = FILE.presets
/** Stuffs de départ par identifiant. */
export const STUFFS: Readonly<Record<string, StuffTemplate>> = FILE.stuffs
/** Niveau des presets. */
export const PRESET_LEVEL = FILE.level

const BY_ID = new Map(PRESETS.map(p => [p.id, p]))

/** Preset par identifiant (undefined si inconnu). */
export function findPreset(id: string | undefined): Preset | undefined {
  return id === undefined ? undefined : BY_ID.get(id)
}

/** Preset par identifiant ; erreur explicite s'il est inconnu. */
export function getPreset(id: string): Preset {
  const p = BY_ID.get(id)
  if (!p) throw new Error(`Preset inconnu : « ${id} »`)
  return p
}

/** Presets d'une classe (ordre du fichier : le premier est le preset par défaut de la classe). */
export function presetsOf(breedId: number): Preset[] {
  return PRESETS.filter(p => p.breedId === breedId)
}

/** Preset par défaut d'une classe. */
export function defaultPresetOf(breedId: number): Preset {
  const p = PRESETS.find(x => x.breedId === breedId)
  if (!p) throw new Error(`Aucun preset pour la classe ${breedId}`)
  return p
}

// ───────────────────────────── noms de classes ─────────────────────────────

/** Normalisation des noms (minuscules, sans accents, apostrophes droites). */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").toLowerCase().trim()
}

/** Identifiants de classe par nom normalisé (« iop », « cra », « xelor »…, + quelques alias). */
export const CLASS_IDS: Readonly<Record<string, number>> = (() => {
  const out: Record<string, number> = {}
  for (const p of PRESETS) out[normalizeName(p.className)] = p.breedId
  Object.assign(out, { eni: 7, enu: 3, osa: 2, sacri: 11, panda: 12, roub: 13, hupper: 17, ougi: 18, elio: 16, steam: 15, forge: 20 })
  return out
})()

/** Classe désignée par un nom (accents et casse ignorés) ou un id numérique. */
export function breedIdOf(name: string): number | undefined {
  const n = normalizeName(name)
  if (/^\d+$/.test(n)) return PRESETS.some(p => p.breedId === Number(n)) ? Number(n) : undefined
  return CLASS_IDS[n]
}

// ───────────────────────────── builds ─────────────────────────────

/** Points de caractéristiques d'un preset au niveau donné. */
export function presetPoints(preset: Preset, data: BuildDataSource, level = PRESET_LEVEL): Partial<Record<PrimaryStat, number>> {
  const p = preset.points
  return allocateAll(data.breed(preset.breedId), level, p.primary, {
    primaryCap: p.primaryCap,
    rest: p.rest === undefined ? 'vitality' : p.rest,
  }).points
}

/** Copie profonde des objets d'un stuff (les builds ne partagent rien avec le JSON). */
function copyItems(items: readonly EquippedItem[]): EquippedItem[] {
  return items.map(it => ({ ...it, exos: it.exos?.map(e => ({ ...e })), rolls: it.rolls ? { ...it.rolls } : undefined }))
}

/** Objets d'un choix de stuff pour un preset. */
export function stuffItems(preset: Preset, stuff: StuffChoice = 'default'): EquippedItem[] {
  if (stuff === 'unstuffed' || stuff === 'naked') return []
  const id = stuff === 'default' ? preset.stuff : stuff
  const tpl = STUFFS[id]
  if (!tpl) throw new Error(`Stuff inconnu : « ${id} » (connus : ${Object.keys(STUFFS).join(', ')}, unstuffed, naked)`)
  return copyItems(tpl.items)
}

export interface PresetBuildOptions {
  stuff?: StuffChoice
  level?: number
  name?: string
}

/** Build complet d'un preset (points, parchemins, objets, variantes). */
export function presetBuild(preset: Preset, data: BuildDataSource, opts: PresetBuildOptions = {}): CharacterBuild {
  const stuff = opts.stuff ?? 'default'
  const level = opts.level ?? PRESET_LEVEL
  const naked = stuff === 'naked'
  return {
    name: opts.name ?? preset.className,
    breedId: preset.breedId,
    level,
    characteristicPoints: naked ? {} : presetPoints(preset, data, level),
    scrolls: naked ? {} : fullScrolls(),
    items: stuffItems(preset, stuff),
    spellVariants: preset.variants.slice(),
  }
}

/** Caractéristiques d'un preset (validité, conditions, plafonds) avec un choix de stuff. */
export function validatePreset(preset: Preset, data: BuildDataSource, stuff: StuffChoice = 'default'): BuildStatsResult {
  return computeBuildStats(presetBuild(preset, data, { stuff }), data)
}

export interface MemberOptions extends PresetBuildOptions {
  /** Rôle imposé (défaut : rôle du preset). */
  role?: RoleId
}

/** Membre d'équipe (`MemberSpec`) construit depuis un preset. */
export function presetMember(preset: Preset, data: BuildDataSource, opts: MemberOptions = {}): MemberSpec {
  const build = presetBuild(preset, data, opts)
  return {
    name: build.name,
    breedId: preset.breedId,
    presetId: preset.id,
    build,
    variants: preset.variants.slice(),
    role: opts.role ?? preset.role,
  }
}

// ───────────────────────────── équipes en texte (CLI) ─────────────────────────────

const isRole = (s: string): s is RoleId => (ROLE_IDS as readonly string[]).includes(s)
const ELEMENT_WORDS: Readonly<Record<string, PresetElement>> = {
  terre: 'earth', earth: 'earth', force: 'earth', feu: 'fire', fire: 'fire', intel: 'fire', intelligence: 'fire',
  eau: 'water', water: 'water', chance: 'water', air: 'air', agi: 'air', agilite: 'air', agility: 'air',
}

/**
 * Preset désigné par un texte : identifiant exact (`enutrof_retrait_pm_eau`), ou `classe[:rôle|élément|mot]`
 * (`iop:killer`, `cra:feu`, `enutrof:mpLock`, `pandawa:placement`). Le premier preset de la classe qui correspond
 * l'emporte (ordre du fichier) ; sans qualificatif, preset par défaut de la classe.
 */
export function resolvePreset(text: string): Preset {
  const exact = findPreset(text.trim())
  if (exact) return exact
  const [cls, qual] = text.split(':').map(s => s.trim())
  const breedId = breedIdOf(cls)
  if (breedId === undefined) throw new Error(`Classe inconnue : « ${cls} »`)
  const list = presetsOf(breedId)
  if (!qual) return list[0]
  const q = normalizeName(qual)
  const role = ROLE_IDS.find(r => r.toLowerCase() === q)
  const byRole = role && (list.find(p => p.role === role) ?? list.find(p => p.secondaryRole === role))
  if (byRole) return byRole
  const el = ELEMENT_WORDS[q]
  const byEl = el && list.find(p => p.element === el)
  if (byEl) return byEl
  const byWord = list.find(p => p.id.includes(q) || normalizeName(p.label).includes(q))
  if (byWord) return byWord
  throw new Error(`Aucun preset « ${qual} » pour ${list[0].className} (presets : ${list.map(p => `${p.id} [${p.role}]`).join(', ')})`)
}

/**
 * Équipe décrite en texte : membres séparés par des virgules, chacun `preset` ou `classe[:qualificatif]`, avec un
 * stuff facultatif après '@' (`iop:killer@unstuffed`, `cra:feu@air`). Le rôle demandé (`iop:killer`) est imposé au
 * membre ; les noms sont rendus uniques (« Iop », « Iop 2 »).
 */
export function parseTeam(spec: string, data: BuildDataSource, opts: { stuff?: StuffChoice; level?: number } = {}): MemberSpec[] {
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean)
  if (!parts.length) throw new Error('Équipe vide')
  const names = new Map<string, number>()
  return parts.map(part => {
    const [who, stuff] = part.split('@').map(s => s.trim())
    const preset = resolvePreset(who)
    const qual = who.includes(':') ? who.split(':')[1].trim() : ''
    const n = (names.get(preset.className) ?? 0) + 1
    names.set(preset.className, n)
    return presetMember(preset, data, {
      stuff: stuff || opts.stuff,
      level: opts.level,
      name: n > 1 ? `${preset.className} ${n}` : preset.className,
      role: isRole(qual) ? qual : undefined,
    })
  })
}

/** Résumé lisible d'un build (méta des replays) : « Terre, 12 PA 6 PM 6 PO, 4 153 PV ». */
export function buildSummary(member: MemberSpec, data: BuildDataSource): string {
  const r = computeBuildStats(member.build, data)
  const preset = findPreset(member.presetId)
  const el: Record<PresetElement, string> = { earth: 'Terre', fire: 'Feu', water: 'Eau', air: 'Air' }
  const main = preset ? el[preset.element] : PRIMARY_STATS.join('/')
  const stuff = member.build.items.length ? `${member.build.items.length} objets` : 'sans stuff'
  return `${main}, ${r.stats.ap} PA ${r.stats.mp} PM ${r.stats.range} PO, ${r.maxHp} PV, ${stuff}`
}
