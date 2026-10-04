/**
 * DataStore en mémoire, construit à partir d'un lot de données au format runtime (`DataBundle`, sérialisable
 * en JSON) — pour le navigateur et les tests — et extraction d'un lot minimal (`createBundle`) : uniquement ce
 * dont un combat a besoin (sorts, monstres, carte, objets…) avec la fermeture des références (sorts lancés par
 * les effets, invocations, sorts de départ, états).
 */
import { BaseDataStore, type DataKind } from './base'
import { internZoneSpec } from './convert'
import { statesOfCondition } from './criteria'
import type { BreedData, EffectData, ItemData, ItemSetData, MapData, MonsterData, SpellData, SpellLevelData } from './model'
import {
  effectSpellLevelRef,
  effectSpellRef,
  effectStateRef,
  effectSummonRef,
  itemEffectSpellRef,
  targetMaskStates,
  triggerStates,
} from './refs'
import type { DataStore, GameDataStore, SpellStateData } from './store'

export const BUNDLE_FORMAT = 'dofussimu-data'
/**
 * Version du format des lots. 2 : `MonsterGrade.lifePoints` / `stats` sans `bonusCharacteristics` (devenu
 * `summonerShare`) — les lots de version 1 sont refusés (à régénérer) plutôt que mal interprétés.
 */
export const BUNDLE_VERSION = 2

/** Lot de données runtime (tableaux triés par id). */
export interface DataBundle {
  format: typeof BUNDLE_FORMAT
  version: number
  spells: SpellData[]
  states: SpellStateData[]
  monsters: MonsterData[]
  breeds: BreedData[]
  items: ItemData[]
  itemSets: ItemSetData[]
  maps: MapData[]
}

export function emptyBundle(): DataBundle {
  return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, spells: [], states: [], monsters: [], breeds: [], items: [], itemSets: [], maps: [] }
}

export class MemoryDataStore extends BaseDataStore {
  private readonly spells = new Map<number, SpellData>()
  private readonly levels = new Map<number, SpellLevelData>()
  private readonly states = new Map<number, SpellStateData>()
  private readonly monsters = new Map<number, MonsterData>()
  private readonly breeds = new Map<number, BreedData>()
  private readonly items = new Map<number, ItemData>()
  private readonly itemSets = new Map<number, ItemSetData>()
  private readonly maps = new Map<number, MapData>()
  private breedList?: BreedData[]

  constructor(bundle: Partial<DataBundle> = {}) {
    super()
    this.add(bundle)
  }

  /**
   * Ajoute (ou remplace, à id égal) les données d'un lot. Les objets sont référencés, pas copiés ; seules les
   * zones relues depuis JSON (non gelées) sont remplacées par leur version partagée (cf. internZoneSpec), pour que
   * le cache de compilation des zones du moteur reste petit.
   */
  add(bundle: Partial<DataBundle>): this {
    if (bundle.format !== undefined && bundle.format !== BUNDLE_FORMAT) throw new Error(`Format de lot inconnu : ${bundle.format}`)
    if (bundle.version !== undefined && bundle.version !== BUNDLE_VERSION)
      throw new Error(`Version de lot non prise en charge : ${bundle.version} (attendue : ${BUNDLE_VERSION} ; régénérer le lot)`)
    for (const s of bundle.spells ?? []) {
      const old = this.spells.get(s.id)
      if (old) for (const l of old.levels) if (l.levelId !== undefined && this.levels.get(l.levelId) === l) this.levels.delete(l.levelId)
      this.spells.set(s.id, s)
      for (const l of s.levels) {
        if (l.levelId !== undefined) this.levels.set(l.levelId, l)
        internEffectZones(l.effects)
        internEffectZones(l.criticalEffects)
      }
    }
    for (const s of bundle.states ?? []) this.states.set(s.id, s)
    for (const m of bundle.monsters ?? []) this.monsters.set(m.id, m)
    for (const b of bundle.breeds ?? []) this.breeds.set(b.id, b)
    for (const it of bundle.items ?? []) {
      if (it.weaponZone) {
        const z = internZoneSpec(it.weaponZone)
        if (z !== it.weaponZone) it.weaponZone = z
      }
      this.items.set(it.id, it)
    }
    for (const s of bundle.itemSets ?? []) this.itemSets.set(s.id, s)
    for (const m of bundle.maps ?? []) this.maps.set(m.id, m)
    if (bundle.breeds?.length) this.breedList = undefined
    if (bundle.items?.length) this.invalidateItemIndex()
    return this
  }

  /** Contenu actuel sous forme de lot (tableaux triés par id). */
  toBundle(): DataBundle {
    return {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      spells: sortedValues(this.spells),
      states: sortedValues(this.states),
      monsters: sortedValues(this.monsters),
      breeds: sortedValues(this.breeds),
      items: sortedValues(this.items),
      itemSets: sortedValues(this.itemSets),
      maps: sortedValues(this.maps),
    }
  }

  spell(id: number): SpellData | undefined {
    return this.spells.get(id)
  }
  spellLevelById(levelId: number): SpellLevelData | undefined {
    return this.levels.get(levelId)
  }
  state(id: number): SpellStateData | undefined {
    return this.states.get(id)
  }
  monster(id: number): MonsterData | undefined {
    return this.monsters.get(id)
  }
  breed(id: number): BreedData | undefined {
    return this.breeds.get(id)
  }
  listBreeds(): readonly BreedData[] {
    return (this.breedList ??= sortedValues(this.breeds))
  }
  item(id: number): ItemData | undefined {
    return this.items.get(id)
  }
  itemSet(id: number): ItemSetData | undefined {
    return this.itemSets.get(id)
  }
  map(id: number): MapData | undefined {
    return this.maps.get(id)
  }

  ids(kind: DataKind): number[] {
    const source: Map<number, unknown> = {
      spell: this.spells,
      state: this.states,
      monster: this.monsters,
      breed: this.breeds,
      item: this.items,
      itemSet: this.itemSets,
      map: this.maps,
    }[kind]
    return [...source.keys()].sort((a, b) => a - b)
  }

  protected allItems(): Iterable<ItemData> {
    return this.items.values()
  }
}

function sortedValues<T extends { id: number }>(m: Map<number, T>): T[] {
  return [...m.values()].sort((a, b) => a.id - b.id)
}

/** Remplace les zones non gelées (relues depuis JSON) par leur version internée. */
function internEffectZones(effects: readonly EffectData[]): void {
  for (const e of effects) {
    const z = internZoneSpec(e.zone)
    if (z !== e.zone) e.zone = z
  }
}

// ───────────────────────────── extraction d'un lot ─────────────────────────────

export interface BundleRequest {
  spellIds?: Iterable<number>
  monsterIds?: Iterable<number>
  mapIds?: Iterable<number>
  itemIds?: Iterable<number>
  itemSetIds?: Iterable<number>
  /** Classes : avec la fermeture, leurs 44 sorts sont inclus. */
  breedIds?: Iterable<number>
  stateIds?: Iterable<number>
  /**
   * Fermeture transitive (défaut : true) : sorts référencés par les effets (lancers, glyphes, pièges, sorts
   * passifs d'objets, portails 1181…), monstres invoqués et leurs sorts, sorts de départ des monstres, états
   * (effets 950-952, masques E#/e#, déclencheurs EON#/EOFF#/EACT#/EK:/EC:, conditions de lancer), panoplies des
   * objets.
   */
  closure?: boolean
}

/** Extrait de `source` un lot contenant les données demandées (ids inconnus ignorés). */
export function createBundle(source: DataStore, request: BundleRequest): DataBundle {
  const closure = request.closure !== false
  const byLevelId = (source as Partial<GameDataStore>).spellLevelById?.bind(source)
  const out = {
    spells: new Map<number, SpellData>(),
    states: new Map<number, SpellStateData>(),
    monsters: new Map<number, MonsterData>(),
    breeds: new Map<number, BreedData>(),
    items: new Map<number, ItemData>(),
    itemSets: new Map<number, ItemSetData>(),
    maps: new Map<number, MapData>(),
  }
  const seen = { spell: new Set<number>(), monster: new Set<number>(), state: new Set<number>(), set: new Set<number>() }
  const spellQueue: number[] = []
  const monsterQueue: number[] = []
  const visitSpell = (id: number) => {
    if (id > 0 && !seen.spell.has(id)) {
      seen.spell.add(id)
      spellQueue.push(id)
    }
  }
  const visitMonster = (id: number) => {
    if (id > 0 && !seen.monster.has(id)) {
      seen.monster.add(id)
      monsterQueue.push(id)
    }
  }
  const visitState = (id: number) => {
    if (seen.state.has(id)) return
    seen.state.add(id)
    const s = source.state(id)
    if (s) out.states.set(id, s)
  }
  const visitSpellLevel = (levelId: number) => {
    const lvl = byLevelId?.(levelId)
    if (lvl) visitSpell(lvl.spellId)
  }
  const visitSet = (id: number) => {
    if (seen.set.has(id)) return
    seen.set.add(id)
    const set = source.itemSet(id)
    if (!set) return
    out.itemSets.set(id, set)
    if (closure)
      for (const list of Object.values(set.bonuses))
        for (const e of list) {
          const ref = itemEffectSpellRef(e)
          if (ref) visitSpell(ref.spellId)
        }
  }

  for (const id of request.spellIds ?? []) visitSpell(id)
  for (const id of request.monsterIds ?? []) visitMonster(id)
  for (const id of request.stateIds ?? []) visitState(id)
  for (const id of request.itemSetIds ?? []) visitSet(id)
  for (const id of request.mapIds ?? []) {
    const m = source.map(id)
    if (m) out.maps.set(id, m)
  }
  for (const id of request.breedIds ?? []) {
    const b = source.breed(id)
    if (!b) continue
    out.breeds.set(id, b)
    if (!closure) continue
    for (const [a, v] of b.spellPairs) {
      visitSpell(a)
      visitSpell(v)
    }
  }
  for (const id of request.itemIds ?? []) {
    const it = source.item(id)
    if (!it) continue
    out.items.set(id, it)
    if (!closure) continue
    if (it.setId !== null) visitSet(it.setId)
    for (const e of it.effects) {
      const ref = itemEffectSpellRef(e)
      if (ref) visitSpell(ref.spellId)
    }
  }

  while (spellQueue.length || monsterQueue.length) {
    const spellId = spellQueue.pop()
    if (spellId !== undefined) {
      const s = source.spell(spellId)
      if (!s) continue
      out.spells.set(spellId, s)
      if (!closure) continue
      for (const lvl of s.levels) {
        for (const st of statesOfCondition(lvl.statesCondition)) visitState(st)
        for (const list of [lvl.effects, lvl.criticalEffects])
          for (const e of list) {
            const ref = effectSpellRef(e)
            if (ref) visitSpell(ref.spellId)
            const levelRef = effectSpellLevelRef(e)
            if (levelRef !== undefined) visitSpellLevel(levelRef)
            const summon = effectSummonRef(e)
            if (summon) visitMonster(summon.monsterId)
            const state = effectStateRef(e)
            if (state !== undefined) visitState(state)
            for (const ms of targetMaskStates(e.targetMask)) visitState(ms)
            for (const ts of triggerStates(e.triggers)) visitState(ts)
          }
      }
      continue
    }
    const monsterId = monsterQueue.pop()!
    const m = source.monster(monsterId)
    if (!m) continue
    out.monsters.set(monsterId, m)
    if (!closure) continue
    for (const id of m.spells) visitSpell(id)
    for (const g of m.grades) {
      if (g.startingSpell) visitSpell(g.startingSpell.spellId)
      else if (g.startingSpellLevelId !== undefined) visitSpellLevel(g.startingSpellLevelId)
    }
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    spells: sortedValues(out.spells),
    states: sortedValues(out.states),
    monsters: sortedValues(out.monsters),
    breeds: sortedValues(out.breeds),
    items: sortedValues(out.items),
    itemSets: sortedValues(out.itemSets),
    maps: sortedValues(out.maps),
  }
}

/** Fusionne plusieurs lots (à id égal, le dernier l'emporte). */
export function mergeBundles(...bundles: Partial<DataBundle>[]): DataBundle {
  const store = new MemoryDataStore()
  for (const b of bundles) store.add(b)
  return store.toBundle()
}
