/**
 * Famille « buffs » : caractéristiques (buffs, débuffs, vols), PA/PM (retraits esquivables ou non, vols, gains),
 * portée, états (pose, retrait, neutralisation, invisibilité, tour annulé, comportement d'IA), désenvoûtements
 * (132, 1075, 406, 1406), modificateurs de sorts (catégorie 3) et relances (1036, 1045).
 *
 * Importer ce module enregistre les interprètes (effets de side-effect au chargement) ; les sous-modules de
 * src/engine/effects/buffs/ détaillent chaque groupe. Les handlers n'implémentent que l'application INSTANTANÉE :
 * différés et déclencheurs sont gérés par effects/core.ts.
 */
import { SPELL_MODIFIER_EFFECT_IDS } from './buffs/modifiers'
import { STAT_EFFECT_IDS, STEAL_EFFECT_IDS } from './buffs/stats'
import './buffs/apmp'
import './buffs/states'
import './buffs/dispel'

export { addEffectBuff, buffDuration, enforceMaxStack, spellMaxStack } from './buffs/common'
export { applyStatBuff, statBuffDef, statLabel, STAT_EFFECT_IDS, STEAL_EFFECT_IDS } from './buffs/stats'
export { immuneToLoss, rollDodgeableRemoval } from './buffs/apmp'
export { addState, removeState, STATE_INVISIBLE } from './buffs/states'
export { canBeDispelled, dispelBuffs, removeSpellBuffs, shortenBuffs } from './buffs/dispel'
export { SPELL_MODIFIER_EFFECT_IDS } from './buffs/modifiers'
export {
  ALL_SPELLS,
  modifiedSpellLevel,
  spellBaseDamageBonus,
  spellBaseHealBonus,
  spellDamageBonus,
  spellModifier,
  spellModifierValue,
} from './buffs/spellMods'

/** Ids d'effets interprétés par la famille (couverture). */
export const BUFF_EFFECT_IDS: readonly number[] = [
  ...STAT_EFFECT_IDS,
  ...STEAL_EFFECT_IDS,
  ...SPELL_MODIFIER_EFFECT_IDS,
  // PA / PM
  77, 78, 84, 120, 168, 169, 440, 441, 1079, 1080,
  // états, invisibilité, tour annulé, IA
  140, 150, 950, 951, 952, 2188,
  // désenvoûtements
  132, 406, 1075, 1406,
  // relances
  1036, 1045,
]
