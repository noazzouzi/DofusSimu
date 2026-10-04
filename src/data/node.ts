/**
 * DataStore Node : lecture des JSON de `data/` (Node uniquement — `fs`).
 *
 * Chargement paresseux par fichier : le premier accès à une catégorie lit et indexe le(s) fichier(s)
 * concerné(s) (sorts : class-spells + monster-spells + item-spells fusionnés ; états ; monstres ; classes ;
 * équipements + types ; panoplies) ; les cartes sont lues une par une dans `data/maps/<id>.json`.
 * Les petites tables (états, classes, objets, panoplies) sont converties en bloc ; sorts et monstres sont
 * convertis à la première demande puis mis en cache (les objets renvoyés sont partagés : ne pas les modifier).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BaseDataStore, type DataKind } from './base'
import {
  convertBreed,
  convertItem,
  convertItemSet,
  convertMap,
  convertMonster,
  convertSpell,
  convertState,
  textFr,
  type SpellLevelResolver,
} from './convert'
import type { BreedData, ItemData, ItemSetData, MapData, MonsterData, SpellData, SpellLevelData } from './model'
import type { RawEffectDefaults, RawFileName, RawFiles, RawMapFile, RawMonster, RawSpell } from './raw'
import type { SpellStateData } from './store'

export interface LoadDataStoreOptions {
  /** Lit et indexe immédiatement tous les fichiers de data/dofusdb (sinon : à la première demande). */
  eager?: boolean
}

/**
 * Ouvre les données du jeu situées dans `dataDir` (par défaut `data`, relatif au répertoire courant).
 * Lève une erreur si `<dataDir>/dofusdb` n'existe pas.
 */
export function loadDataStore(dataDir = 'data', options: LoadDataStoreOptions = {}): NodeDataStore {
  const store = new NodeDataStore(dataDir)
  if (options.eager) store.preload()
  return store
}

interface SpellEntry {
  raw: RawSpell
  defaults: RawEffectDefaults
}

interface LevelRef {
  spellId: number
  grade: number
}

export class NodeDataStore extends BaseDataStore {
  readonly dataDir: string
  readonly dofusdbDir: string
  readonly mapsDir: string

  private readonly rawCache = new Map<RawFileName, unknown>()
  // Index bruts (construits à la demande)
  private spellIndex?: Map<number, SpellEntry>
  private levelIndex?: Map<number, LevelRef>
  private monsterIndex?: Map<number, RawMonster>
  private stateMap?: Map<number, SpellStateData>
  private breedMap?: Map<number, BreedData>
  private breedList?: BreedData[]
  private itemMap?: Map<number, ItemData>
  private setMap?: Map<number, ItemSetData>
  // Caches de conversion (null = id inconnu)
  private readonly spellCache = new Map<number, SpellData | null>()
  private readonly monsterCache = new Map<number, MonsterData | null>()
  private readonly mapCache = new Map<number, MapData | null>()
  private readonly resolveLevel: SpellLevelResolver = levelId => this.levelRefs().get(levelId)

  constructor(dataDir = 'data') {
    super()
    this.dataDir = resolve(dataDir)
    this.dofusdbDir = join(this.dataDir, 'dofusdb')
    this.mapsDir = join(this.dataDir, 'maps')
    if (!existsSync(this.dofusdbDir)) throw new Error(`Données DofusDB introuvables : ${this.dofusdbDir}`)
  }

  /** Contenu brut (analysé une seule fois) d'un fichier de data/dofusdb. */
  rawFile<K extends RawFileName>(name: K): RawFiles[K] {
    let v = this.rawCache.get(name)
    if (v === undefined) {
      const path = join(this.dofusdbDir, name)
      if (!existsSync(path)) throw new Error(`Fichier de données manquant : ${path}`)
      v = JSON.parse(readFileSync(path, 'utf8'))
      this.rawCache.set(name, v)
    }
    return v as RawFiles[K]
  }

  /** Lit et indexe tous les fichiers (sans convertir sorts et monstres). */
  preload(): this {
    this.spellEntries()
    this.monsters()
    this.states()
    this.breeds()
    this.items()
    this.sets()
    return this
  }

  // ───────────────────────────── DataStore ─────────────────────────────

  spell(id: number): SpellData | undefined {
    let s = this.spellCache.get(id)
    if (s === undefined) {
      const e = this.spellEntries().get(id)
      s = e ? convertSpell(e.raw, e.defaults) : null
      this.spellCache.set(id, s)
    }
    return s ?? undefined
  }

  spellLevelById(levelId: number): SpellLevelData | undefined {
    const ref = this.levelRefs().get(levelId)
    if (!ref) return undefined
    const levels = this.spell(ref.spellId)?.levels
    if (!levels) return undefined
    for (const l of levels) if (l.levelId === levelId) return l
    return undefined
  }

  state(id: number): SpellStateData | undefined {
    return this.states().get(id)
  }

  monster(id: number): MonsterData | undefined {
    let m = this.monsterCache.get(id)
    if (m === undefined) {
      const raw = this.monsters().get(id)
      m = raw ? convertMonster(raw, this.resolveLevel) : null
      this.monsterCache.set(id, m)
    }
    return m ?? undefined
  }

  breed(id: number): BreedData | undefined {
    return this.breeds().get(id)
  }

  listBreeds(): readonly BreedData[] {
    this.breeds()
    return this.breedList!
  }

  item(id: number): ItemData | undefined {
    return this.items().get(id)
  }

  itemSet(id: number): ItemSetData | undefined {
    return this.sets().get(id)
  }

  map(id: number): MapData | undefined {
    let m = this.mapCache.get(id)
    if (m === undefined) {
      m = null
      if (Number.isSafeInteger(id) && id >= 0) {
        const path = join(this.mapsDir, `${id}.json`)
        if (existsSync(path)) m = convertMap(JSON.parse(readFileSync(path, 'utf8')) as RawMapFile)
      }
      this.mapCache.set(id, m)
    }
    return m ?? undefined
  }

  ids(kind: DataKind): number[] {
    let keys: Iterable<number>
    switch (kind) {
      case 'spell':
        keys = this.spellEntries().keys()
        break
      case 'state':
        keys = this.states().keys()
        break
      case 'monster':
        keys = this.monsters().keys()
        break
      case 'breed':
        keys = this.breeds().keys()
        break
      case 'item':
        keys = this.items().keys()
        break
      case 'itemSet':
        keys = this.sets().keys()
        break
      case 'map':
        keys = existsSync(this.mapsDir)
          ? readdirSync(this.mapsDir)
              .filter(f => /^\d+\.json$/.test(f))
              .map(f => Number(f.slice(0, -5)))
          : []
        break
    }
    return [...keys].sort((a, b) => a - b)
  }

  protected allItems(): Iterable<ItemData> {
    return this.items().values()
  }

  // ───────────────────────────── chargement ─────────────────────────────

  /** Sorts des trois fichiers ; en cas de doublon, le premier fichier lu l'emporte (classe > monstres > objets). */
  private spellEntries(): Map<number, SpellEntry> {
    if (this.spellIndex) return this.spellIndex
    const index = new Map<number, SpellEntry>()
    const levels = new Map<number, LevelRef>()
    const add = (list: readonly RawSpell[] | undefined, defaults: RawEffectDefaults) => {
      if (!list) return
      for (const raw of list) {
        if (index.has(raw.id)) continue
        index.set(raw.id, { raw, defaults })
        for (const l of raw.levels) if (!levels.has(l.id)) levels.set(l.id, { spellId: raw.id, grade: l.grade })
      }
    }
    const cls = this.rawFile('class-spells.json')
    add(cls.spells, cls.effectDefaults)
    add(cls.linkedSpells, cls.effectDefaults)
    const mon = this.rawFile('monster-spells.json')
    add(mon.spells, mon.effectDefaults)
    const itm = this.rawFile('item-spells.json')
    add(itm.spells, itm.effectDefaults)
    this.levelIndex = levels
    this.spellIndex = index
    return index
  }

  private levelRefs(): Map<number, LevelRef> {
    if (!this.levelIndex) this.spellEntries()
    return this.levelIndex!
  }

  private monsters(): Map<number, RawMonster> {
    if (!this.monsterIndex) this.monsterIndex = new Map(this.rawFile('monsters.json').map(m => [m.id, m]))
    return this.monsterIndex
  }

  private states(): Map<number, SpellStateData> {
    if (!this.stateMap) this.stateMap = new Map(this.rawFile('spell-states.json').states.map(s => [s.id, convertState(s)]))
    return this.stateMap
  }

  private breeds(): Map<number, BreedData> {
    if (!this.breedMap) {
      const file = this.rawFile('breeds.json')
      this.breedList = file.breeds.map(b => convertBreed(b, file.roles)).sort((a, b) => a.id - b.id)
      this.breedMap = new Map(this.breedList.map(b => [b.id, b]))
    }
    return this.breedMap
  }

  private items(): Map<number, ItemData> {
    if (!this.itemMap) {
      const typeNames = new Map(this.rawFile('item-types.json').types.map(t => [t.id, textFr(t.name)]))
      this.itemMap = new Map(this.rawFile('equipment.json').map(it => [it.id, convertItem(it, typeNames.get(it.typeId) || undefined)]))
    }
    return this.itemMap
  }

  private sets(): Map<number, ItemSetData> {
    if (!this.setMap) this.setMap = new Map(this.rawFile('item-sets.json').map(s => [s.id, convertItemSet(s)]))
    return this.setMap
  }
}
