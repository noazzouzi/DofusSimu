/**
 * Forgemagie d'un stuff (niveau L3, docs/design/ai.md §15.4 point 5 ; equipment.md §11.3) — WP4b.
 *
 * Profils (equipment.md §11.3) :
 *  - `none` : jets parfaits, aucune forgemagie ;
 *  - `thlStandard` : UN exo PA (si PA < 12), sinon un exo PM (si PM < 6) ;
 *  - `thlOptimized` (défaut) : exo PA, exo PM, exo PO, chacun seulement s'il est UTILE (plafonds 12/6/6, PO seulement
 *    si la portée compte pour le rôle) — un seul de chaque par personnage (devblog 2.3.4, règle de src/stats) — et
 *    transcendances sur ≤ 6 autres objets : pour chaque objet forgemageable, la meilleure rune de transcendance
 *    disponible (niveau de rune ≤ niveau de l'objet, plafond de 101 de poids respecté : `listExoOptions`) selon les
 *    poids marginaux du proxy — le plus souvent « Ta Do Per So » (+1 % dommages aux sorts) sur les objets 200.
 * Hôtes des exos : objet forgemageable d'un emplacement typique (anneaux d'abord, puis amulette, ceinture, bottes,
 * coiffe, cape) sans ligne de la caractéristique ; un objet porte au plus une ligne de forgemagie (simplification :
 * une transcendance exclut tout exo, deux exos sur un objet sont irréalistes). Un hôte préféré peut être imposé par
 * position (mouvement « déplacer l'exo » du recuit).
 */
import type { StatKey, Stats } from '../../core/types'
import type { EquipmentSlot, ItemData } from '../../data/model'
import { itemEffectStat } from '../../stats/effects'
import { isForgeable, listExoOptions, TYPICAL_EXO_SLOTS, type ExoLine, type ExoOption } from '../../stats/forgemagie'

export type ForgeProfile = 'none' | 'thlStandard' | 'thlOptimized'

export const FORGE_PROFILES: readonly ForgeProfile[] = ['none', 'thlStandard', 'thlOptimized']

/** Exos PA/PM/PO gérés (un par personnage). */
export type ExoStat = 'ap' | 'mp' | 'range'
export const EXO_STATS: readonly ExoStat[] = ['ap', 'mp', 'range']

export interface ForgeOptions {
  profile: ForgeProfile
  /** Poids marginaux du proxy (choix des transcendances, utilité de l'exo PO). */
  weights: Partial<Record<StatKey, number>>
  apCap?: number
  mpCap?: number
  rangeCap?: number
  /** Transcendances maximales (défaut 6). */
  maxTranscendences?: number
  /** Position préférée de chaque exo (index dans le stuff) ; ignorée si l'objet n'est pas un hôte valide. */
  hosts?: Partial<Record<ExoStat, number>>
}

export interface ForgePlan {
  /** Lignes de forgemagie par position (vide = aucune). */
  lines: ExoLine[][]
  /** Position de chaque exo posé. */
  exos: Partial<Record<ExoStat, number>>
  /** Transcendances posées : position et rune (stat, valeur). */
  transcendences: { position: number; stat: StatKey; value: number }[]
}

/** Ordre de préférence des hôtes d'exo par emplacement. */
const HOST_ORDER: readonly EquipmentSlot[] = ['ring', 'amulet', 'belt', 'boots', 'hat', 'cloak']

/** L'objet a-t-il une ligne (bonus ou malus) de cette caractéristique ? */
function hasLine(item: ItemData, stat: StatKey): boolean {
  return item.effects.some(e => itemEffectStat(e.effectId) === stat)
}

/** Hôte valide d'un exo PA/PM/PO. */
export function canHostExo(item: ItemData | null, stat: ExoStat): boolean {
  return !!item && isForgeable(item) && TYPICAL_EXO_SLOTS.has(item.slot) && !hasLine(item, stat)
}

const TRANSCENDENCES = new WeakMap<ItemData, ExoOption[]>()

/** Runes de transcendance applicables à un objet (cache par objet). */
export function transcendenceOptions(item: ItemData): ExoOption[] {
  let t = TRANSCENDENCES.get(item)
  if (!t) TRANSCENDENCES.set(item, (t = listExoOptions(item, { overs: false, transcendence: true }).filter(o => o.kind === 'transcendence')))
  return t
}

/** Meilleure transcendance d'un objet pour des poids donnés (undefined si aucune n'a de valeur). */
function bestTranscendence(item: ItemData, weights: Partial<Record<StatKey, number>>): { option: ExoOption; value: number } | undefined {
  let best: ExoOption | undefined
  let bestV = 0
  for (const o of transcendenceOptions(item)) {
    const v = (weights[o.stat] ?? 0) * o.value
    if (v > bestV + 1e-12 || (best && Math.abs(v - bestV) <= 1e-12 && o.id < best.id)) {
      best = o
      bestV = v
    }
  }
  return best && bestV > 0 ? { option: best, value: bestV } : undefined
}

/** Informations de forgemagie d'un objet, mises en cache par planificateur (poids fixés). */
interface ItemForgeInfo {
  forgeable: boolean
  host: Record<ExoStat, boolean>
  trans?: { option: ExoOption; value: number }
}

/**
 * Planificateur de forgemagie à poids fixés (un par recherche) : mêmes décisions que `planForgemagie`, avec un cache
 * par objet (hôtes possibles, meilleure transcendance).
 */
export class ForgePlanner {
  private readonly info = new WeakMap<ItemData, ItemForgeInfo>()

  constructor(readonly opts: Omit<ForgeOptions, 'hosts'>) {}

  private of(item: ItemData): ItemForgeInfo {
    let i = this.info.get(item)
    if (!i) {
      i = {
        forgeable: isForgeable(item),
        host: { ap: canHostExo(item, 'ap'), mp: canHostExo(item, 'mp'), range: canHostExo(item, 'range') },
        trans: isForgeable(item) ? bestTranscendence(item, this.opts.weights) : undefined,
      }
      this.info.set(item, i)
    }
    return i
  }

  plan(items: readonly (ItemData | null)[], stats: Stats, hosts?: Partial<Record<ExoStat, number>>): ForgePlan {
    const opts = this.opts
    const lines: ExoLine[][] = items.map(() => [])
    const plan: ForgePlan = { lines, exos: {}, transcendences: [] }
    if (opts.profile === 'none') return plan
    const apCap = opts.apCap ?? 12
    const mpCap = opts.mpCap ?? 6
    const rangeCap = opts.rangeCap ?? 6
    const wanted: ExoStat[] = []
    if (opts.profile === 'thlStandard') {
      if (stats.ap < apCap) wanted.push('ap')
      else if (stats.mp < mpCap) wanted.push('mp')
    } else {
      if (stats.ap < apCap) wanted.push('ap')
      if (stats.mp < mpCap) wanted.push('mp')
      if (stats.range < rangeCap && (opts.weights.range ?? 0) > 1e-6) wanted.push('range')
    }
    let busy = 0
    for (const stat of wanted) {
      let host = -1
      const pref = hosts?.[stat]
      if (pref !== undefined && pref >= 0 && pref < items.length && !(busy & (1 << pref))) {
        const it = items[pref]
        if (it && this.of(it).host[stat]) host = pref
      }
      if (host < 0) {
        for (const slot of HOST_ORDER) {
          for (let i = 0; i < items.length; i++) {
            const it = items[i]
            if (!it || it.slot !== slot || busy & (1 << i) || !this.of(it).host[stat]) continue
            host = i
            break
          }
          if (host >= 0) break
        }
      }
      if (host < 0) continue
      busy |= 1 << host
      lines[host].push({ stat, value: 1 })
      plan.exos[stat] = host
    }
    if (opts.profile !== 'thlOptimized') return plan
    const offers: { position: number; option: ExoOption; value: number }[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it || busy & (1 << i)) continue
      const t = this.of(it).trans
      if (t) offers.push({ position: i, option: t.option, value: t.value })
    }
    offers.sort((a, b) => b.value - a.value || a.position - b.position)
    const max = opts.maxTranscendences ?? 6
    for (let k = 0; k < offers.length && k < max; k++) {
      const o = offers[k]
      lines[o.position].push({ stat: o.option.stat, value: o.option.value, kind: 'transcendence' })
      plan.transcendences.push({ position: o.position, stat: o.option.stat, value: o.option.value })
    }
    return plan
  }
}

/**
 * Plan de forgemagie d'un stuff (voir l'en-tête). `stats` = caractéristiques du stuff SANS forgemagie (plafonnées) :
 * elles décident des exos utiles.
 */
export function planForgemagie(items: readonly (ItemData | null)[], stats: Stats, opts: ForgeOptions): ForgePlan {
  return new ForgePlanner(opts).plan(items, stats, opts.hosts)
}
