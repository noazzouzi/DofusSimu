/**
 * Accès aux données statiques du jeu pendant un combat (sorts, états, monstres, cartes).
 * Implémenté par src/data/loaders.ts (Node : lecture des JSON ; navigateur : import des JSON).
 */
import type { BreedData, ItemData, ItemSetData, MapData, MonsterData, SpellData, SpellLevelData } from './model'

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
