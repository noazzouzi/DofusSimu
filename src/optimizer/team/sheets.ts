/**
 * Fiche de stuff d'un membre de combat (section « Stuffs » du visualiseur, méta des replays) — voir src/stats/sheet.ts.
 *
 * `memberSheet` enrichit la fiche du preset du membre (rôle, élément, variantes) et du stuff de data/ai/presets.json dont
 * il porte exactement les objets (libellé, provenance). Sans `fs` : utilisable dans les workers (replays). Les fiches
 * des fichiers d'équipe (`teamStuffs`, `stuffCatalog`) sont dans teamfile.ts.
 */
import type { EquippedItem } from '../../stats/build'
import { buildStuffSheet, type SheetDataSource, type StuffSheet } from '../../stats/sheet'
import type { MemberSpec } from '../types'
import { findPreset, PRESETS, STUFFS, type Preset, type StuffTemplate } from './presets'
import type { BuildOption, BuildOrigin } from './userteam'

const ORIGIN_FR: Readonly<Record<BuildOrigin, string>> = {
  fixed: 'build imposé',
  user: 'preset choisi dans le fichier d’équipe',
  scenario: 'preset du scénario',
  class: 'preset de la classe',
  candidate: 'candidat du fichier d’équipe',
  'stuff-optimizer': 'stuff construit par l’optimiseur',
  'file-build': 'build complet du fichier d’équipe',
}

/** Empreinte d'une liste d'objets (ids et forgemagie, ordre indifférent). */
function itemsKey(items: readonly EquippedItem[]): string {
  return items
    .map(it => `${it.itemId}:${(it.exos ?? []).map(x => `${x.stat}${x.kind === 'transcendence' ? 'T' : ''}${x.value}`).sort().join(',')}`)
    .sort()
    .join('|')
}

let stuffIndex: Map<string, [string, StuffTemplate]> | undefined

/** Stuff de data/ai/presets.json dont le build porte exactement les objets (et la forgemagie), sinon undefined. */
export function matchStuff(items: readonly EquippedItem[], preferred?: string): [string, StuffTemplate] | undefined {
  if (!items.length) return undefined
  const key = itemsKey(items)
  if (preferred && STUFFS[preferred] && itemsKey(STUFFS[preferred].items) === key) return [preferred, STUFFS[preferred]]
  if (!stuffIndex) {
    stuffIndex = new Map()
    for (const [id, tpl] of Object.entries(STUFFS)) {
      const k = itemsKey(tpl.items)
      if (!stuffIndex.has(k)) stuffIndex.set(k, [id, tpl])
    }
  }
  return stuffIndex.get(key)
}

/** Fiche d'un membre de combat ; `option` (résolution d'une composition) précise le preset dérivé et l'origine. */
export function memberSheet(member: MemberSpec, data: SheetDataSource, option?: BuildOption): StuffSheet {
  const base = findPreset(member.presetId)
  const stuffHint = option?.id.includes('@') ? option.id.split('@')[1].split('+')[0] : (option?.preset ?? base)?.stuff
  const stuff = matchStuff(member.build.items, stuffHint)
  // Sans option (replays) : `presetId` est le preset de BASE ; le preset dérivé qui porte ce stuff est plus parlant.
  const derived = !option && stuff ? PRESETS.find(p => p.extends === member.presetId && p.stuff === stuff[0]) : undefined
  const preset: Preset | undefined = option?.preset ?? derived ?? base
  return buildStuffSheet({ ...member.build, spellVariants: member.variants.length ? member.variants : member.build.spellVariants }, data, {
    name: member.name,
    className: preset?.className,
    presetId: preset?.id ?? member.presetId,
    presetLabel: preset?.label ?? base?.label,
    buildId: option && option.id !== preset?.id ? option.id : undefined,
    origin: option ? ORIGIN_FR[option.origin] : undefined,
    role: member.role ?? preset?.role,
    element: preset?.element,
    stuffLabel: stuff ? stuff[1].label : member.build.items.length ? undefined : 'Sans équipement',
    stuffSource: stuff ? (stuff[1].source ?? `data/ai/presets.json (stuff « ${stuff[0]} »)`) : undefined,
    presetVariants: preset?.variants ?? base?.variants,
  })
}
