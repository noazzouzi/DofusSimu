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
 * Stuffs « build complet » (ex. `vortex_*`, docs/reports/vortex-stuffs.md) : un stuff peut porter sa propre répartition
 * de points (`points`, elle remplace celle du preset quand ce stuff est choisi) et être réservé à des classes
 * (`breeds`). Presets dérivés (`extends`) : un preset `{ id, extends: <base>, stuff, label?, source? }` hérite de TOUS
 * les champs absents du preset de base (variantes, rotation, rôle, élément, points), lus au chargement — un réglage des
 * variantes du preset de base s'y propage. Pour l'IA, un membre construit depuis un preset dérivé garde l'identifiant
 * du preset de BASE (`MemberSpec.presetId` : calibration DPT de data/ai/calibration.json, rotation `scripted`) : un
 * preset dérivé est un alias « base@stuff » (`cra_feu_vortex` ≡ `cra_feu_zone@vortex_cra_feu`). Les presets dérivés
 * ne sont pas candidats par défaut de la recherche de composition (`BASE_PRESETS`).
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
  /**
   * Répartition des points propre au stuff (stuff « build complet », ex. optimisé pour un donjon) : remplace celle du
   * preset quand ce stuff est choisi. Absent : points du preset.
   */
  points?: PresetPoints
  /** Classes pour lesquelles le stuff est conçu (absent : toutes ; les stuffs génériques valent pour toutes). */
  breeds?: number[]
  /** Provenance (optimiseur, rapport). */
  source?: string
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
  /** Preset dérivé : identifiant du preset de base dont il hérite les champs absents (voir l'en-tête). */
  extends?: string
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

/**
 * Résout les presets dérivés (`extends`) : champs absents repris du preset de base (copies : variantes et rotation ne
 * sont pas partagées). Erreur explicite si la base est inconnue, elle-même dérivée, ou d'une autre classe.
 */
export function resolvePresetExtends(raw: readonly Partial<Preset>[]): Preset[] {
  const byId = new Map(raw.map(p => [p.id, p]))
  return raw.map(p => {
    if (!p.extends) return p as Preset
    const base = byId.get(p.extends)
    if (!base) throw new Error(`Preset « ${p.id} » : base « ${p.extends} » inconnue`)
    if (base.extends) throw new Error(`Preset « ${p.id} » : la base « ${p.extends} » est elle-même dérivée`)
    if (p.breedId !== undefined && p.breedId !== base.breedId) throw new Error(`Preset « ${p.id} » : classe différente de sa base « ${base.id} »`)
    const out = { ...base, ...p } as Preset
    out.variants = (p.variants ?? base.variants ?? []).slice()
    out.rotation = (p.rotation ?? base.rotation ?? []).map(r => ({ ...r }))
    out.points = { ...(p.points ?? base.points!) }
    return out
  })
}

/** Fichier des presets (lecture seule ; presets dérivés NON résolus). */
export const PRESETS_FILE: Readonly<PresetsFile> = FILE
/** Tous les presets, dans l'ordre du fichier (presets dérivés résolus). */
export const PRESETS: readonly Preset[] = resolvePresetExtends(FILE.presets)
/** Presets de base (non dérivés) : candidats par défaut de la recherche de composition (src/optimizer/team). */
export const BASE_PRESETS: readonly Preset[] = PRESETS.filter(p => !p.extends)
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

/** Preset par défaut d'une classe (premier preset de base de la classe). */
export function defaultPresetOf(breedId: number): Preset {
  const p = BASE_PRESETS.find(x => x.breedId === breedId)
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

/** Points de caractéristiques d'une répartition (`PresetPoints`) pour une classe, au niveau donné. */
export function allocatePoints(p: PresetPoints, breedId: number, data: BuildDataSource, level = PRESET_LEVEL): Partial<Record<PrimaryStat, number>> {
  return allocateAll(data.breed(breedId), level, p.primary, {
    primaryCap: p.primaryCap,
    rest: p.rest === undefined ? 'vitality' : p.rest,
  }).points
}

/** Points de caractéristiques d'un preset au niveau donné (répartition du preset ; voir `stuffPoints`). */
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

/** Gabarit d'un choix de stuff pour un preset (undefined pour 'unstuffed' / 'naked'). */
export function stuffTemplateOf(preset: Preset, stuff: StuffChoice = 'default'): StuffTemplate | undefined {
  if (stuff === 'unstuffed' || stuff === 'naked') return undefined
  const id = stuff === 'default' ? preset.stuff : stuff
  const tpl = STUFFS[id]
  if (!tpl) throw new Error(`Stuff inconnu : « ${id} » (connus : ${Object.keys(STUFFS).join(', ')}, unstuffed, naked)`)
  return tpl
}

/** Objets d'un choix de stuff pour un preset. */
export function stuffItems(preset: Preset, stuff: StuffChoice = 'default'): EquippedItem[] {
  const tpl = stuffTemplateOf(preset, stuff)
  return tpl ? copyItems(tpl.items) : []
}

/** Répartition des points d'un preset avec un choix de stuff : celle du stuff s'il en porte une, sinon celle du preset. */
export function stuffPoints(preset: Preset, stuff: StuffChoice = 'default'): PresetPoints {
  return stuffTemplateOf(preset, stuff)?.points ?? preset.points
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
    characteristicPoints: naked ? {} : allocatePoints(stuffPoints(preset, stuff), preset.breedId, data, level),
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

/**
 * Membre d'équipe (`MemberSpec`) construit depuis un preset. Preset dérivé (`extends`) : le membre porte l'identifiant
 * du preset de BASE (identité pour l'IA, voir l'en-tête) avec le stuff (et les points) du preset dérivé.
 */
export function presetMember(preset: Preset, data: BuildDataSource, opts: MemberOptions = {}): MemberSpec {
  const build = presetBuild(preset, data, opts)
  return {
    name: build.name,
    breedId: preset.breedId,
    presetId: preset.extends ?? preset.id,
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
