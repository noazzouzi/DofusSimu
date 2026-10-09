/**
 * Theorycraft contre un boss — entrée des ANALYSES (docs/design/theorycraft.md §1.7-1.9).
 *
 * Contrairement à `index.ts` (API pure : index des boss, fiches, profil), ces modules s'appuient sur le proxy et
 * l'optimiseur de stuff, qui tirent indirectement des modules du Vortex (`VORTEX_TARGET_MIX`, défaut historique de
 * proxy.ts). Ils n'en dépendent pas pour autant : toute cible passe par `bossProxyOptions` (`strictTargets`), jamais par
 * le mix du Vortex. Aucun accès fichier : les accès Node restent dans node.ts.
 */
export * from './index'
export { ADD_EXPOSURE, bossProxyOptions, CONTACT_SHARE, DEFAULT_RANGE_NEED, resolveStyle, type BossProxyOptions, type BossTarget } from './target'
export { AXIS_INFO, COMPOSITION_RULES, COMPOSITION_THRESHOLDS, rankClasses, RANKING_AXES, type RankClassesOptions } from './classes'
export {
  DEFAULT_ITERATIONS,
  DEFAULT_LEVEL,
  DEFAULT_TOP,
  dominantElement,
  statEquivalences,
  stuffVsBoss,
  type StuffInput,
  type StuffProgress,
  type StuffVsBossOptions,
} from './stuff'
export { CLASS_CONFIDENCE, CLASS_MODEL_LIMITS, classUtilities, MECHANIC_RELEVANCE, relevance, UTILITY_TAG_LABELS } from './utilities'
export { STANCES, bestStance, stancesOf } from './stances'
export { contactShare, sustainedDamage } from './rotation'
export { ELEMENT_LABELS, formatBoss, type FormatBossOptions } from './formatBoss'
export { formatClasses, type FormatClassesOptions } from './formatClasses'
export { formatStuffVsBoss, type FormatStuffOptions } from './formatStuff'
