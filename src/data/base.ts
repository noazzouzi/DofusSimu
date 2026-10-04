/**
 * Socle commun des DataStore (Node et mémoire) : sélection du grade d'un sort, sorts de classe par niveau,
 * sorts d'un monstre par grade, index des objets par emplacement.
 */
import type { BreedData, EquipmentSlot, ItemData, ItemSetData, MapData, MonsterData, SpellData, SpellLevelData } from './model'
import type { BreedSpell, GameDataStore, LevelRange, SpellStateData } from './store'

/** Catégories de données énumérables (cf. BaseDataStore.ids). */
export type DataKind = 'spell' | 'state' | 'monster' | 'breed' | 'item' | 'itemSet' | 'map'

/** Critère de sélection d'un grade (cf. GameDataStore pour la sémantique). */
export interface SpellLevelSelector {
  grade?: number
  playerLevel?: number
}

/**
 * Grade le plus élevé satisfaisant le sélecteur, parmi des grades triés par `grade` croissant :
 * `grade <= sel.grade` et `minPlayerLevel <= sel.playerLevel` (contraintes absentes = ignorées).
 * Sans allocation (appelé dans les boucles de simulation).
 */
export function selectSpellLevel(levels: readonly SpellLevelData[], sel: SpellLevelSelector): SpellLevelData | undefined {
  const g = sel.grade
  const pl = sel.playerLevel
  for (let i = levels.length - 1; i >= 0; i--) {
    const l = levels[i]
    if (g !== undefined && l.grade > g) continue
    if (pl !== undefined && l.minPlayerLevel > pl) continue
    return l
  }
  return undefined
}

export abstract class BaseDataStore implements GameDataStore {
  abstract spell(id: number): SpellData | undefined
  abstract state(id: number): SpellStateData | undefined
  abstract monster(id: number): MonsterData | undefined
  abstract breed(id: number): BreedData | undefined
  abstract item(id: number): ItemData | undefined
  abstract itemSet(id: number): ItemSetData | undefined
  abstract map(id: number): MapData | undefined
  abstract spellLevelById(levelId: number): SpellLevelData | undefined
  abstract listBreeds(): readonly BreedData[]
  /** Ids disponibles d'une catégorie (triés). */
  abstract ids(kind: DataKind): number[]
  /** Tous les objets (source de l'index par emplacement). */
  protected abstract allItems(): Iterable<ItemData>

  private slotIndex?: Map<EquipmentSlot, ItemData[]>

  spellLevel(spellId: number, sel: SpellLevelSelector): SpellLevelData | undefined {
    const s = this.spell(spellId)
    return s ? selectSpellLevel(s.levels, sel) : undefined
  }

  breedSpells(breedId: number, playerLevel: number, variantChoice?: readonly (0 | 1 | null | undefined)[]): BreedSpell[] {
    const breed = this.breed(breedId)
    const out: BreedSpell[] = []
    if (!breed) return out
    const sel = { playerLevel }
    breed.spellPairs.forEach((pair, pairIndex) => {
      const choice = variantChoice?.[pairIndex]
      for (const variant of [0, 1] as const) {
        if (choice != null && choice !== variant) continue
        const spellId = pair[variant]
        const level = this.spellLevel(spellId, sel)
        if (level) out.push({ pairIndex, variant, spellId, level })
      }
    })
    return out
  }

  monsterSpells(monsterId: number, grade: number): SpellLevelData[] {
    const m = this.monster(monsterId)
    const out: SpellLevelData[] = []
    if (!m || !m.grades.some(g => g.grade === grade)) return out
    m.spells.forEach((spellId, i) => {
      const row = m.spellGrades?.[i]
      // Sans spellGrades : grade du sort = grade du monstre (borné par les grades existants).
      const spellGrade = row ? (row[grade - 1] ?? 0) : grade
      if (spellGrade <= 0) return
      const lvl = this.spellLevel(spellId, { grade: spellGrade })
      if (lvl) out.push(lvl)
    })
    return out
  }

  itemsBySlot(slot: EquipmentSlot, range?: LevelRange): readonly ItemData[] {
    if (!this.slotIndex) {
      const index = new Map<EquipmentSlot, ItemData[]>()
      for (const it of this.allItems()) {
        let list = index.get(it.slot)
        if (!list) index.set(it.slot, (list = []))
        list.push(it)
      }
      for (const list of index.values()) list.sort((a, b) => a.level - b.level || a.id - b.id)
      this.slotIndex = index
    }
    const list = this.slotIndex.get(slot) ?? []
    if (!range || (range.minLevel === undefined && range.maxLevel === undefined)) return list
    const lo = firstIndex(list, it => it.level >= (range.minLevel ?? -Infinity))
    const hi = firstIndex(list, it => it.level > (range.maxLevel ?? Infinity))
    return list.slice(lo, hi)
  }

  /** À appeler si les objets changent (MemoryDataStore). */
  protected invalidateItemIndex(): void {
    this.slotIndex = undefined
  }
}

/** Recherche dichotomique du premier index vérifiant `pred` (prédicat monotone sur une liste triée par niveau). */
function firstIndex(list: readonly ItemData[], pred: (it: ItemData) => boolean): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (pred(list[mid])) hi = mid
    else lo = mid + 1
  }
  return lo
}
