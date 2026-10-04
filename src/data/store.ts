/**
 * Accès aux données statiques du jeu pendant un combat (sorts, états, monstres, cartes).
 * Implémenté par src/data/node.ts (Node : lecture paresseuse des JSON de data/) et src/data/memory.ts
 * (navigateur / tests : lot de données en mémoire, cf. createBundle).
 */
import type {
  BreedData,
  EquipmentSlot,
  ItemData,
  ItemSetData,
  MapData,
  MonsterData,
  SpellData,
  SpellLevelData,
} from './model'

export interface SpellStateData {
  id: number
  name: string
  preventsSpellCast: boolean
  preventsFight: boolean
  cantBeMoved: boolean
  cantBePushed: boolean
  cantDealDamage: boolean
  invulnerable: boolean
  invulnerableMelee: boolean
  invulnerableRange: boolean
  cantSwitchPosition: boolean
  cantTackle: boolean
  cantBeTackled: boolean
  incurable: boolean
  // Champs additionnels (présents seulement s'ils sont vrais / non vides) :
  nameEn?: string
  /** État « silencieux » (non affiché), ex. 236 Marginal. */
  isSilent?: boolean
  displayTurnRemaining?: boolean
  isMainState?: boolean
  /** Effets d'état internes (StateEffectId, cf. mechanics.md §12). */
  effectsIds?: number[]
}

export interface DataStore {
  spell(id: number): SpellData | undefined
  /** Grade le plus élevé utilisable au niveau donné (ou un grade précis). */
  spellLevel(spellId: number, gradeOrPlayerLevel: { grade?: number; playerLevel?: number }): SpellLevelData | undefined
  state(id: number): SpellStateData | undefined
  monster(id: number): MonsterData | undefined
  breed(id: number): BreedData | undefined
  item(id: number): ItemData | undefined
  itemSet(id: number): ItemSetData | undefined
  map(id: number): MapData | undefined
}

/** Sort de classe disponible à un niveau donné (cf. GameDataStore.breedSpells). */
export interface BreedSpell {
  /** Index de la paire (0..21). */
  pairIndex: number
  /** 0 = sort de base, 1 = variante. */
  variant: 0 | 1
  spellId: number
  /** Grade le plus élevé utilisable au niveau demandé. */
  level: SpellLevelData
}

/** Bornes de niveau (incluses) pour filtrer les objets. */
export interface LevelRange {
  minLevel?: number
  maxLevel?: number
}

/**
 * DataStore enrichi de requêtes d'index (implémenté par NodeDataStore et MemoryDataStore).
 *
 * Sémantique de `spellLevel(spellId, sel)` dans ces implémentations :
 *  - `grade` : grade exact, sinon le plus haut grade inférieur (ex. grade 6 demandé, sort à 1 grade → grade 1) ;
 *  - `playerLevel` : le plus haut grade dont `minPlayerLevel <= playerLevel` (undefined si aucun) ;
 *  - les deux : les deux contraintes ; aucun des deux : le grade le plus élevé.
 */
export interface GameDataStore extends DataStore {
  /** Niveau de sort par id de spell-level DofusDB (startingSpellId des monstres, effet 1181). */
  spellLevelById(levelId: number): SpellLevelData | undefined
  /**
   * Sorts de la classe débloqués au niveau `playerLevel`, dans l'ordre des paires. `variantChoice[i]` impose la
   * variante de la paire i ; sans choix (undefined/null), les deux variantes débloquées sont renvoyées.
   */
  breedSpells(breedId: number, playerLevel: number, variantChoice?: readonly (0 | 1 | null | undefined)[]): BreedSpell[]
  /** Objets d'un emplacement, triés par niveau puis id (tableau partagé : ne pas modifier). */
  itemsBySlot(slot: EquipmentSlot, range?: LevelRange): readonly ItemData[]
  /** Niveaux de sorts d'un monstre à un grade donné (via `spellGrades` ; sorts indisponibles exclus). */
  monsterSpells(monsterId: number, grade: number): SpellLevelData[]
  /** Toutes les classes, triées par id. */
  listBreeds(): readonly BreedData[]
}
