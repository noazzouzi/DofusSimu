/**
 * Theorycraft contre un boss — API publique PURE (utilisable côté navigateur) : types partagés, index des boss,
 * fiches manuelles, fiche du boss. L'adaptateur Node (lecture de dungeons.json et de data/bosses) est à importer
 * séparément depuis src/theorycraft/node.ts.
 */
export * from './types'
export { bossGradeFor, listBosses, normalize, resolveBoss, searchBosses, type ListBossesOptions } from './bosses'
export { MECHANIC_KINDS, parseBossOverrides, UTILITY_TAGS } from './overrides'
export {
  bossProfile,
  DATA_SNAPSHOT,
  DEFAULT_PLAYERS,
  DEFAULT_REF_HP,
  MAX_STATE_PHASES,
  SUSTAINED_TURNS,
  type BossProfileDetail,
  type BossProfileOptions,
  type BossSpellDetail,
  type DamageApproximation,
} from './bossProfile'
