/**
 * Éditeur d'équipe de la section « Stuffs » (web/src/stuffs.ts, API du serveur de développement web/plugins/stuffs.ts) :
 * l'utilisateur change les classes, les presets (identité IA : rôle, rotation, variantes), les objets, la forgemagie,
 * les points et les variantes de sorts ; le moteur recalcule les fiches et le fichier d'équipe est écrit au format lu
 * par la CLI (`parseTeamFile`).
 *
 *  - `draftsOf` : brouillons d'une équipe résolue (build personnalisé seulement si le fichier en donnait un) ;
 *  - `previewTeam` : fiches d'un brouillon, build effectif et options de forgemagie de chaque membre ;
 *  - `teamFileFromDraft` : fichier d'équipe à écrire (en-tête conservé, note datée des modifications) ;
 *  - `editorMeta`, `itemCatalog` : classes, presets, stuffs, rôles et objets proposés par l'interface.
 * Sans `fs` : l'écriture est faite par teamfile.ts / le plugin.
 */
import { ROLE_IDS, type RoleId } from '../../ai/types'
import type { EquipmentSlot } from '../../data/model'
import type { GameDataStore } from '../../data/store'
import { listExoOptions, type ForgeKind } from '../../stats/forgemagie'
import type { PrimaryStat } from '../../stats/characteristicPoints'
import type { StatKey } from '../../core/types'
import {
  effectLine,
  ROLE_LABELS_FR,
  SLOT_ORDER,
  statLabelFr,
  type DraftMember,
  type SheetBuild,
  type SheetDataSource,
  type StuffSheet,
} from '../../stats/sheet'
import type { MemberSpec } from '../types'
import { allocatePoints, BASE_PRESETS, normalizeName, PRESET_LEVEL, PRESETS, STUFFS, type PresetPoints } from './presets'
import { memberSheet } from './sheets'
import { classIdOf, classNameOf, compositionFromTeamFile, isScenarioPreset, parseTeamFile, resolveComposition, type BuildOption, type TeamFile, type TeamFileMember } from './userteam'

// ───────────────────────────── brouillons ─────────────────────────────

/** Build tel qu'écrit dans un fichier d'équipe (copie profonde). */
export function rawBuild(member: MemberSpec): SheetBuild {
  const b = member.build
  return {
    level: b.level,
    items: b.items.map(it => ({ ...it, exos: it.exos?.map(e => ({ ...e })), rolls: it.rolls ? { ...it.rolls } : undefined })),
    characteristicPoints: { ...b.characteristicPoints },
    scrolls: { ...b.scrolls },
    spellVariants: (member.variants.length ? member.variants : (b.spellVariants ?? [])).slice(),
  }
}

/**
 * Brouillons d'une équipe d'après son fichier et sa résolution : `build` seulement si le fichier personnalisait le build
 * (`build` ou `variants`) — sinon le preset (et son `@stuff`) reste la source, comme dans le fichier.
 */
export function draftsOf(file: TeamFile, options: readonly BuildOption[]): DraftMember[] {
  return file.members.map((m, i) => {
    const o = options[i]
    const [presetId, stuffInPreset] = (m.preset ?? '').split('@').map(s => s.trim())
    const custom = m.build !== undefined || m.variants !== undefined
    return {
      breedId: o.member.breedId,
      name: m.name,
      preset: presetId || o.preset.id,
      stuff: custom ? undefined : stuffInPreset || m.stuff,
      role: m.role,
      fixed: m.fixed,
      build: custom ? rawBuild(o.member) : undefined,
      candidates: m.candidates?.slice(),
    }
  })
}

/** Membre de fichier d'équipe d'un brouillon. */
function fileMember(d: DraftMember): TeamFileMember {
  const m: TeamFileMember = { class: normalizeName(classNameOf(d.breedId)) }
  if (d.name?.trim()) m.name = d.name.trim()
  if (d.preset) m.preset = d.stuff && !d.build ? `${d.preset}@${d.stuff}` : d.preset
  if (d.role) m.role = d.role as RoleId
  if (d.build) m.build = d.build
  if (d.candidates?.length && !d.fixed) m.candidates = d.candidates.slice()
  if (d.fixed) m.fixed = true
  return m
}

/** Fichier d'équipe (validé) d'un brouillon : en-tête minimal, sans note. */
export function draftTeamFile(scenario: string, drafts: readonly DraftMember[]): TeamFile {
  return parseTeamFile({ version: 1, scenario, members: drafts.map(fileMember) }, 'équipe modifiée')
}

// ───────────────────────────── aperçu ─────────────────────────────

/** Ligne de forgemagie proposée pour un objet. */
export interface ForgeChoice {
  kind: ForgeKind
  stat: StatKey
  value: number
  label: string
}

export interface PreviewMember {
  sheet: StuffSheet
  /** Preset retenu (celui du brouillon, ou le preset par défaut de la classe pour le scénario). */
  preset: string
  /** Build effectif : base de toute modification (celui du preset quand le brouillon n'en a pas). */
  build: SheetBuild
  /** Forgemagie réaliste des objets équipés (`listExoOptions`), par id d'objet. */
  forge: Record<number, ForgeChoice[]>
}

export interface TeamPreview {
  members: PreviewMember[]
  error?: string
}

const FORGE_KIND_FR: Readonly<Record<ForgeKind, string>> = { exo: 'Exo', over: 'Over', transcendence: 'Transcendance' }

function forgeChoices(data: SheetDataSource, itemId: number): ForgeChoice[] {
  const item = data.item(itemId)
  if (!item) return []
  return listExoOptions(item).map(o => ({
    kind: o.kind,
    stat: o.stat,
    value: o.value,
    label: `${FORGE_KIND_FR[o.kind]} ${statLabelFr(o.stat)} +${o.value}`,
  }))
}

/** Fiches recalculées d'un brouillon ; une équipe invalide renvoie `error` (et aucune fiche). */
export function previewTeam(data: SheetDataSource, scenario: string, drafts: readonly DraftMember[]): TeamPreview {
  try {
    const file = draftTeamFile(scenario, drafts)
    const { options } = resolveComposition(compositionFromTeamFile(file), data, scenario)
    return {
      members: options.map(o => {
        const build = rawBuild(o.member)
        const forge: Record<number, ForgeChoice[]> = {}
        for (const it of build.items) forge[it.itemId] ??= forgeChoices(data, it.itemId)
        return { sheet: memberSheet(o.member, data, o), preset: o.preset.id, build, forge }
      }),
    }
  } catch (e) {
    return { members: [], error: (e as Error).message }
  }
}

// ───────────────────────────── enregistrement ─────────────────────────────

const classesOf = (members: readonly { class: string | number }[]) => members.map(m => normalizeName(String(m.class)))

/**
 * Fichier d'équipe à écrire : membres du brouillon, en-tête du fichier d'origine conservé (description, notes) avec une
 * note datée (nouveau fichier : « créé à partir de `from` ») ; si les classes changent, la date de décision est mise à jour ; `optimized` (rapport d'origine des builds
 * épinglés) est retiré dès que les membres changent (il ne décrirait plus ces builds).
 */
export function teamFileFromDraft(original: TeamFile | undefined, scenario: string, drafts: readonly DraftMember[], date: string, from?: string): TeamFile {
  const members = draftTeamFile(scenario, drafts).members
  const sameMembers = !!original && JSON.stringify(original.members) === JSON.stringify(members)
  const classesChanged = !original || classesOf(original.members).join(',') !== classesOf(members).join(',')
  const notes = original?.notes === undefined ? [] : Array.isArray(original.notes) ? original.notes.slice() : [original.notes]
  const names = members.map(m => classNameOf(classIdOf(m.class)))
  if (!original) notes.push(`Créé dans l'interface (section Stuffs) le ${date}${from ? ` à partir de ${from}` : ''} : ${names.join(', ')}.`)
  else if (!sameMembers) notes.push(`Modifié dans l'interface (section Stuffs) le ${date} : ${names.join(', ')}${classesChanged ? ' (composition changée)' : ''}.`)
  const out: TeamFile = {
    version: 1,
    scenario,
    description:
      classesChanged || !original?.description
        ? `Composition choisie par l'utilisateur : ${names.join(', ')}. Le simulateur optimise les builds et la stratégie pour cette composition (npm run sim -- optimize ${scenario}).`
        : original.description,
    chosenBy: 'utilisateur',
    decidedAt: classesChanged ? date : (original?.decidedAt ?? date),
    members,
    notes,
  }
  if (sameMembers && original?.optimized) out.optimized = original.optimized
  return parseTeamFile(out, 'équipe modifiée')
}

/** Nom de fichier d'équipe sûr (`vortex-air.json`) ; erreur sinon. */
export function teamFileName(name: string): string {
  const base = normalizeName(name.trim().replace(/\.json$/i, ''))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) throw new Error(`Nom de fichier d'équipe invalide : « ${name} »`)
  return `${base}.json`
}

// ───────────────────────────── données de l'éditeur ─────────────────────────────

export interface EditorMeta {
  classes: { breedId: number; name: string }[]
  presets: { id: string; breedId: number; label: string; role: string; element: string; stuff: string; scenario: boolean }[]
  stuffs: { id: string; label: string; breeds?: number[] }[]
  roles: { id: string; label: string }[]
  level: number
}

/** Classes, presets (versions du scénario en tête), stuffs nommés et rôles. */
export function editorMeta(scenario: string): EditorMeta {
  const classes = [...new Map(BASE_PRESETS.map(p => [p.breedId, p.className])).entries()]
    .map(([breedId, name]) => ({ breedId, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const presets = PRESETS.map(p => ({ id: p.id, breedId: p.breedId, label: p.label, role: p.role, element: p.element, stuff: p.stuff, scenario: isScenarioPreset(p, scenario) }))
    .sort((a, b) => Number(b.scenario) - Number(a.scenario) || a.label.localeCompare(b.label, 'fr'))
  const stuffs = Object.entries(STUFFS).map(([id, s]) => ({ id, label: s.label, breeds: s.breeds }))
  return { classes, presets, stuffs, roles: ROLE_IDS.map(id => ({ id, label: ROLE_LABELS_FR[id] ?? id })), level: PRESET_LEVEL }
}

/** Objet proposé par le sélecteur de l'interface. */
export interface CatalogItem {
  id: number
  name: string
  slot: EquipmentSlot
  typeName?: string
  level: number
  iconId?: number
  setName?: string
  conditions?: string
  /** Lignes d'effets (jets max). */
  lines: string[]
}

/** Tous les objets équipables, par emplacement puis niveau décroissant. */
export function itemCatalog(data: GameDataStore): CatalogItem[] {
  const out: CatalogItem[] = []
  for (const slot of SLOT_ORDER) {
    if (slot === 'other') continue
    const items = [...data.itemsBySlot(slot)].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, 'fr'))
    for (const it of items) {
      out.push({
        id: it.id,
        name: it.name,
        slot,
        typeName: it.typeName,
        level: it.level,
        iconId: it.iconId,
        setName: it.setId != null ? data.itemSet(it.setId)?.name : undefined,
        conditions: it.conditions || undefined,
        lines: it.effects.map(l => effectLine(l, data)?.text).filter((t): t is string => !!t),
      })
    }
  }
  return out
}

/** Points de caractéristiques d'une répartition (caractéristique principale, puis le reste). */
export function allocate(data: GameDataStore, breedId: number, points: PresetPoints, level = PRESET_LEVEL): Partial<Record<PrimaryStat, number>> {
  return allocatePoints(points, breedId, data, level)
}
