/**
 * Viviers d'objets par emplacement (niveau L3, docs/design/ai.md §15.4 point 1) — WP4b.
 *
 *  - objets de `itemsBySlot(slot, { minLevel, maxLevel: niveau })` (data/dofusdb/equipment.json) : équipements
 *    niveau 180-200 par défaut ; Dofus/trophées/prysmaradites et familiers/montiliers/montures : tous niveaux ≤ niveau ;
 *  - conditions : un objet dont la condition échoue dans le build de référence (objet substitué dans son emplacement)
 *    est écarté (condition de classe, de stats inatteignables…) ; la recherche re-vérifie tout build (`valid`) ;
 *  - projection : valeur linéaire = Σ poids marginaux du proxy (∂logJ̃/∂carac, `ProxyContext.statWeights`) × lignes
 *    de l'objet au jet max ; filtre de Pareto sur les caractéristiques utiles au rôle (poids non nul), puis les
 *    `perSlot` meilleurs (30) ;
 *  - panoplies gardées à part (« la dominance ne voit pas les bonus ») : blocs de panoplie (objets d'une même panoplie
 *    dans des emplacements distincts) classés par valeur avec leur meilleur palier de bonus ; leurs objets rejoignent
 *    les viviers ;
 *  - sorts passifs (effet 1175, Dofus, prysmaradites, légendaires) : lancés par le moteur en combat mais NON modélisés
 *    par le proxy ⇒ ignorés (politique 'ignore', défaut : seules les lignes de caractéristiques comptent, objet marqué
 *    `passive`) ou objets exclus ('exclude') ; pour garder un passif, imposer l'objet (`StuffSearchOptions.fixed`).
 */
import type { StatKey } from '../../core/types'
import type { EquipmentSlot, ItemData } from '../../data/model'
import type { GameDataStore } from '../../data/store'
import { computeBuildStats, type CharacterBuild, type EquippedItem } from '../../stats/build'
import { EFFECT_PASSIVE_SPELL, itemEffectSign, itemEffectStat } from '../../stats/effects'
import type { ProxyContext } from './proxy'

/** Positions d'un stuff complet (16) : un objet par position, deux anneaux, six Dofus/trophées. */
export const STUFF_POSITIONS: readonly EquipmentSlot[] = [
  'amulet', 'ring', 'ring', 'belt', 'boots', 'hat', 'cloak', 'shield', 'weapon', 'pet',
  'dofus', 'dofus', 'dofus', 'dofus', 'dofus', 'dofus',
]

/** Emplacements distincts (ordre de `STUFF_POSITIONS`). */
export const STUFF_SLOTS: readonly EquipmentSlot[] = ['amulet', 'ring', 'belt', 'boots', 'hat', 'cloak', 'shield', 'weapon', 'pet', 'dofus']

/** Emplacements « tous niveaux » (Dofus/trophées/prysmaradites, familiers/montures). */
const ANY_LEVEL_SLOTS: ReadonlySet<EquipmentSlot> = new Set<EquipmentSlot>(['dofus', 'pet'])

export type PassivePolicy = 'ignore' | 'exclude'

export interface PoolOptions {
  /** Niveau du personnage (défaut : niveau du contexte). */
  level?: number
  /** Niveau minimal des équipements (défaut niveau − 20). */
  minLevel?: number
  /** Objets gardés par emplacement (défaut 30). */
  perSlot?: number
  /** Objets gardés pour les 6 emplacements Dofus/trophées (défaut 24). */
  dofusPool?: number
  /** Blocs de panoplie gardés (défaut 12). */
  sets?: number
  passivePolicy?: PassivePolicy
  /** Objets imposés dans les viviers (stuff de départ, graines). */
  include?: readonly number[]
  /** Build de référence (test des conditions par substitution). */
  reference?: CharacterBuild
}

export interface PoolItem {
  item: ItemData
  /** Valeur linéaire (∂logJ̃ × lignes). */
  value: number
  /** Porte un sort passif non simulé. */
  passive: boolean
}

export interface SetBlock {
  setId: number
  name: string
  /** Objets du bloc (ids), au plus un par position (deux anneaux possibles). */
  items: number[]
  /** Palier de bonus atteint par le bloc complet. */
  tier: number
  value: number
}

export interface StuffPools {
  bySlot: Record<EquipmentSlot, PoolItem[]>
  setBlocks: SetBlock[]
  /** Objets examinés / écartés (conditions, passifs). */
  examined: number
  rejected: { condition: number; passive: number }
}

/** Lignes de caractéristiques d'un objet au jet max (montants signés), sorts passifs exclus. */
export function itemStatDelta(item: ItemData): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = {}
  for (const line of item.effects) {
    const stat = itemEffectStat(line.effectId)
    if (!stat) continue
    out[stat] = (out[stat] ?? 0) + itemEffectSign(line.effectId) * Math.max(line.min, line.max)
  }
  return out
}

/** L'objet porte-t-il un sort passif (effet 1175) ? */
export function hasPassive(item: ItemData): boolean {
  return item.effects.some(e => e.effectId === EFFECT_PASSIVE_SPELL)
}

/** Valeur linéaire d'un vecteur de caractéristiques. */
export function linearValue(delta: Partial<Record<StatKey, number>>, weights: Partial<Record<StatKey, number>>): number {
  let v = 0
  for (const k in delta) v += (weights[k as StatKey] ?? 0) * (delta[k as StatKey] ?? 0)
  return v
}

/** A domine-t-il B sur les caractéristiques utiles (signe des poids) ? */
function dominates(a: Partial<Record<StatKey, number>>, b: Partial<Record<StatKey, number>>, useful: readonly StatKey[], weights: Partial<Record<StatKey, number>>): boolean {
  let strict = false
  for (const k of useful) {
    const s = (weights[k] ?? 0) > 0 ? 1 : -1
    const da = s * (a[k] ?? 0)
    const db = s * (b[k] ?? 0)
    if (da < db) return false
    if (da > db) strict = true
  }
  return strict
}

/** Le build `reference` avec `item` à la place d'un objet de même emplacement satisfait-il la condition de l'objet ? */
function conditionHolds(data: GameDataStore, reference: CharacterBuild | undefined, item: ItemData): boolean {
  if (!item.conditions || !reference) return true
  const items: EquippedItem[] = []
  let replaced = false
  for (const it of reference.items) {
    const d = data.item(it.itemId)
    if (!replaced && d && d.slot === item.slot) {
      replaced = true
      continue
    }
    if (it.itemId === item.id) continue
    items.push({ itemId: it.itemId, exos: it.exos })
  }
  items.push({ itemId: item.id })
  const r = computeBuildStats({ ...reference, items }, data)
  return !r.issues.some(i => i.code === 'condition' && i.itemId === item.id)
}

/** Viviers d'un personnage (voir l'en-tête). */
export function buildPools(data: GameDataStore, ctx: ProxyContext, opts: PoolOptions = {}): StuffPools {
  const level = opts.level ?? ctx.member.level
  const minLevel = opts.minLevel ?? Math.max(1, level - 20)
  const perSlot = opts.perSlot ?? 30
  const dofusPool = opts.dofusPool ?? 24
  const policy = opts.passivePolicy ?? 'ignore'
  const include = new Set(opts.include ?? [])
  const weights = ctx.statWeights()
  const useful = (Object.keys(weights) as StatKey[]).filter(k => Math.abs(weights[k] ?? 0) > 1e-7).sort()
  const bySlot = {} as Record<EquipmentSlot, PoolItem[]>
  const rejected = { condition: 0, passive: 0 }
  let examined = 0
  const eligible = new Map<number, PoolItem & { delta: Partial<Record<StatKey, number>> }>()

  for (const slot of STUFF_SLOTS) {
    const raw = data.itemsBySlot(slot, ANY_LEVEL_SLOTS.has(slot) ? { maxLevel: level } : { minLevel, maxLevel: level })
    const list: (PoolItem & { delta: Partial<Record<StatKey, number>> })[] = []
    for (const item of raw) {
      examined++
      const passive = hasPassive(item)
      if (passive && policy === 'exclude' && !include.has(item.id)) {
        rejected.passive++
        continue
      }
      if (!include.has(item.id) && !conditionHolds(data, opts.reference, item)) {
        rejected.condition++
        continue
      }
      const delta = itemStatDelta(item)
      const entry = { item, value: linearValue(delta, weights), passive, delta }
      list.push(entry)
      eligible.set(item.id, entry)
    }
    // Pareto (caractéristiques utiles), puis tri par valeur ; les objets imposés sont toujours gardés.
    const sorted = list.slice().sort((a, b) => b.value - a.value || a.item.id - b.item.id)
    const front: typeof list = []
    for (const e of sorted) {
      if (front.length >= Math.max(60, perSlot)) break
      if (front.some(f => dominates(f.delta, e.delta, useful, weights))) continue
      front.push(e)
    }
    const keep = slot === 'dofus' ? dofusPool : perSlot
    const chosen = front.slice(0, keep)
    for (const e of sorted) if (include.has(e.item.id) && !chosen.includes(e)) chosen.push(e)
    bySlot[slot] = chosen.map(({ item, value, passive }) => ({ item, value, passive }))
  }

  // Blocs de panoplie : objets éligibles de chaque panoplie (au plus un par position), meilleur palier.
  const bySet = new Map<number, (PoolItem & { delta: Partial<Record<StatKey, number>> })[]>()
  for (const e of eligible.values()) {
    if (e.item.setId === null) continue
    const l = bySet.get(e.item.setId) ?? []
    l.push(e)
    bySet.set(e.item.setId, l)
  }
  const blocks: SetBlock[] = []
  for (const [setId, items] of [...bySet.entries()].sort((a, b) => a[0] - b[0])) {
    const set = data.itemSet(setId)
    if (!set || items.length < 2) continue
    // Un objet par position : meilleur objet par emplacement (deux anneaux autorisés).
    const picked: typeof items = []
    const used = new Map<EquipmentSlot, number>()
    for (const e of items.slice().sort((a, b) => b.value - a.value || a.item.id - b.item.id)) {
      const cap = e.item.slot === 'ring' ? 2 : e.item.slot === 'dofus' ? 6 : 1
      if ((used.get(e.item.slot) ?? 0) >= cap) continue
      used.set(e.item.slot, (used.get(e.item.slot) ?? 0) + 1)
      picked.push(e)
    }
    if (picked.length < 2) continue
    const tiers = Object.keys(set.bonuses).map(Number).filter(n => n <= picked.length).sort((a, b) => a - b)
    const tier = tiers.length ? tiers[tiers.length - 1] : 0
    const bonus: Partial<Record<StatKey, number>> = {}
    for (const line of tier ? set.bonuses[tier] : []) {
      const stat = itemEffectStat(line.effectId)
      if (stat) bonus[stat] = (bonus[stat] ?? 0) + itemEffectSign(line.effectId) * Math.max(line.min, line.max)
    }
    const value = picked.reduce((a, e) => a + e.value, 0) + linearValue(bonus, weights)
    blocks.push({ setId, name: set.name, items: picked.map(e => e.item.id), tier, value })
  }
  blocks.sort((a, b) => b.value - a.value || a.setId - b.setId)
  const setBlocks = blocks.slice(0, opts.sets ?? 12)
  for (const b of setBlocks) {
    for (const id of b.items) {
      const e = eligible.get(id)!
      const list = bySlot[e.item.slot]
      if (!list.some(p => p.item.id === id)) list.push({ item: e.item, value: e.value, passive: e.passive })
    }
  }
  for (const slot of STUFF_SLOTS) bySlot[slot].sort((a, b) => b.value - a.value || a.item.id - b.item.id)
  return { bySlot, setBlocks, examined, rejected }
}
