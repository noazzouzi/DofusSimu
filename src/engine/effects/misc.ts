/**
 * Effets visuels / neutres (docs/research/effects.md §7.12, §10 règle 7) : aucun effet de gameplay. Ils sont
 * enregistrés explicitement pour ne pas être comptés comme inconnus, et journalisés (indices d'animation pour le
 * replay) seulement quand le combat enregistre ses événements.
 *
 *  - 149 apparence, 333 couleur, 335 apparence ajoutée, 1060 / 2868 / 2871 taille ;
 *  - 3792 / 3793 scripts visuels (`value` = id dans `spell.boundScriptUsageData` ; vérifié sans gameplay) ;
 *  - 666 « Pas d'effet supplémentaire », 2883 « Durée du tour » (sans objet en simulation) : non journalisés.
 */
import { registerEffect, type EffectContext } from './registry'

/** Ids sans effet de gameplay, avec un libellé court pour le journal. */
export const VISUAL_EFFECTS: Readonly<Record<number, string>> = {
  149: 'apparence',
  333: 'couleur',
  335: 'apparence',
  1060: 'taille',
  2868: 'taille',
  2871: 'taille',
  3792: 'script visuel',
  3793: 'script visuel',
}
export const NOOP_EFFECTS: readonly number[] = [666, 2883]

function visualHandler(ctx: EffectContext): void {
  const { engine, fight } = ctx
  if (!fight.options.record) return
  const label = VISUAL_EFFECTS[ctx.effect.effectId] ?? 'visuel'
  const who = ctx.targets.length ? ctx.targets.map(t => t.name).join(', ') : ctx.caster.name
  engine.log(fight, `Effet ${label} (${ctx.effect.effectId}) sur ${who}.`)
}

registerEffect(Object.keys(VISUAL_EFFECTS).map(Number), 'visual', visualHandler, false)
registerEffect([...NOOP_EFFECTS], 'noop', () => {}, false)
