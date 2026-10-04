/**
 * Couche de données — point d'entrée utilisable dans le navigateur (sans `fs`).
 * Le chargement depuis le disque (Node) est dans `src/data/node.ts` (loadDataStore).
 */
export * from './model'
export * from './store'
export type * from './raw'
export * from './convert'
export * from './criteria'
export * from './refs'
export * from './base'
export * from './memory'
