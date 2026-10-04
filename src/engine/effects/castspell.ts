/**
 * Effets « lance un sort » (docs/research/effects.md §2.5 ; port OTOMAI `DamageCalculator.SolveSpellExecution` et
 * `HandleSpellExecution`). `diceNum` = sous-sort, `diceSide` = grade (0 ⇒ grade le plus élevé).
 *
 * | effectId                         | lanceur du sous-sort | case visée                                   |
 * |----------------------------------|----------------------|----------------------------------------------|
 * | 1160, 2160                       | lanceur de l'effet   | case de chaque cible                         |
 * | 2960                             | lanceur de l'effet   | case ciblée par le sort parent (une fois)    |
 * | 792, 793, 2792, 2793             | chaque cible         | sa propre case                               |
 * | 2794, 2795                       | chaque cible         | case ciblée par le sort parent               |
 * | 1017, 2017                       | chaque cible         | case de la source                            |
 * | 1018                             | la source            | case de chaque cible                         |
 * | 1019                             | la source            | sa propre case (une fois par cible)          |
 *
 * « Source » = l'entité déclenchante si l'effet est joué par un buff déclenché (`ctx.trigger.source` ; à défaut le
 * porteur du buff), sinon le lanceur de l'effet (port : `IsTriggered ? TriggeringFighter : caster`).
 *
 * Limites : `value` des variantes « GlobalLimitation » (2017, 2160, 2792, 2793, 2795) = nombre max d'exécutions par
 * exécution de l'effet parent, toutes cibles confondues (port `HasReachedMaxUseLimit` : `utilisations >= value`) ;
 * pour les autres, `value` ne limite que les déclenchements d'un buff (posé par le noyau : `Buff.maxTriggers`).
 * Le flag critique est hérité, le déclencheur est propagé (masques O/o, sources des sous-sorts suivants) ainsi que la
 * marque d'origine ; une exécution issue d'une mort (déclencheur X) peut être lancée par le mourant.
 */
import type { Fighter } from '../types'
import { castSubSpell, CAST_SPELL_EFFECTS, type SubSpellOptions, type TriggerEvent } from './core'
import { registerEffect, type EffectContext } from './registry'
import { casterPassesMask } from '../targetMask'

type Who = 'caster' | 'target' | 'source'
type Where = 'target' | 'cell' | 'source' | 'self'

interface Rule {
  who: Who
  where: Where
  /** Variante « GlobalLimitation » (limite d'exécutions par effet parent). */
  global: boolean
}

/** Table de résolution lanceur / case par effectId (effects.md §2.5). */
export const CAST_SPELL_RULES: Readonly<Record<number, Rule>> = {
  1160: { who: 'caster', where: 'target', global: false },
  2160: { who: 'caster', where: 'target', global: true },
  2960: { who: 'caster', where: 'cell', global: false },
  792: { who: 'target', where: 'self', global: false },
  793: { who: 'target', where: 'self', global: false },
  2792: { who: 'target', where: 'self', global: true },
  2793: { who: 'target', where: 'self', global: true },
  2794: { who: 'target', where: 'cell', global: false },
  2795: { who: 'target', where: 'cell', global: true },
  1017: { who: 'target', where: 'source', global: false },
  2017: { who: 'target', where: 'source', global: true },
  1018: { who: 'source', where: 'target', global: false },
  1019: { who: 'source', where: 'self', global: false },
}

/** Source d'un effet (entité déclenchante si déclenché, sinon lanceur). */
export function effectSource(ctx: EffectContext): Fighter {
  if (ctx.trigger) return ctx.trigger.source ?? ctx.targets[0] ?? ctx.caster
  return ctx.caster
}

/** Options de sous-sort héritées du contexte (déclencheur, marque, exécution post-mortem). */
function subOptions(ctx: EffectContext): SubSpellOptions | undefined {
  const t = ctx.trigger as TriggerEvent | undefined
  if (!t && !ctx.mark) return undefined
  return { trigger: t, mark: ctx.mark, fromDeath: !!t && (t.type === 'X' || t.killed === true) }
}

function castSpellHandler(ctx: EffectContext): void {
  const { engine, fight, effect } = ctx
  const rule = CAST_SPELL_RULES[effect.effectId]
  if (!rule) return
  const spellId = effect.diceNum
  const grade = effect.diceSide
  const opts = subOptions(ctx)
  const limit = rule.global ? effect.value : Infinity
  let used = 0
  const run = (caster: Fighter, cell: number): void => {
    if (used >= limit || fight.ended) return
    used++
    castSubSpell(engine, fight, caster, spellId, grade, cell, ctx.crit, ctx.depth, opts)
  }

  // 2960 : une seule exécution sur la case ciblée, sans besoin d'entité (conditions « * » du lanceur seulement).
  if (rule.who === 'caster' && rule.where === 'cell') {
    if (effect.targetMask && !casterPassesMask(effect.targetMask, ctx.caster)) return
    run(ctx.caster, ctx.targetCell)
    return
  }
  const source = effectSource(ctx)
  for (const t of ctx.targets) {
    if (used >= limit || fight.ended) break
    let caster: Fighter
    switch (rule.who) {
      case 'caster':
        caster = ctx.caster
        break
      case 'target':
        caster = t
        break
      default:
        caster = source
    }
    let cell: number
    switch (rule.where) {
      case 'target':
        cell = t.cell
        break
      case 'cell':
        cell = ctx.targetCell
        break
      case 'source':
        cell = source.cell
        break
      default:
        cell = caster.cell
    }
    run(caster, cell)
  }
}

registerEffect([...CAST_SPELL_EFFECTS].filter(id => id !== 2960), 'castspell', castSpellHandler, true)
registerEffect(2960, 'castspell', castSpellHandler, false)
