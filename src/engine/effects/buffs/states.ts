/**
 * États et effets assimilés (kinds `state`, `state_like` ; docs/research/effects.md §7.7, mechanics.md §12, §14) :
 *  - 950 : pose l'état `value` pour `duration` tours (−1 = permanent) — les drapeaux viennent de `data.state(id)`
 *    (Engine.stateFlag), les déclencheurs EON/EOFF sont émis par Engine.addBuff/removeBuff ;
 *  - 951 : retire l'état `value` (tous les buffs qui l'accordent, quels que soient lanceur et désenvoûtabilité) ;
 *  - 952 : neutralise l'état `value` pendant `duration` tours (présent pour les masques et conditions, sans drapeaux) ;
 *  - 150 : invisibilité = état 250 « Invisible » pendant `duration` tours (+ déclencheur 'ION') ;
 *  - 140 : « Tour annulé » — buff `passTurn` : le porteur passe ses tours tant qu'il est actif (Engine.nextTurn) ;
 *  - 2188 : change le comportement d'IA d'un monstre (`tags.aiBehaviour` = diceNum, sinon value ; sens INCERTAIN).
 */
import type { Buff, Fighter } from '../../types'
import type { EffectContext } from '../registry'
import { addEffectBuff, buffDuration, enforceMaxStack, recording, registerBuffEffect } from './common'

/** État « Invisible ». */
export const STATE_INVISIBLE = 250

function stateName(ctx: EffectContext, stateId: number): string {
  return ctx.engine.data.state(stateId)?.name ?? `État ${stateId}`
}

/** Buff d'état identique déjà posé (même lanceur, même sort, même désenvoûtabilité) — rafraîchi plutôt qu'empilé. */
function sameStateBuff(ctx: EffectContext, t: Fighter, stateId: number): Buff | undefined {
  for (const b of t.buffs) {
    if (b.stateId !== stateId || b.delay > 0 || b.kind !== 'stat') continue
    if (b.sourceId === ctx.caster.id && b.spellId === ctx.spellId && b.effect.dispellable === ctx.effect.dispellable) return b
  }
  return undefined
}

/** Pose l'état `stateId` sur `t` (ou rafraîchit sa durée). Retourne vrai si l'état était absent avant. */
export function addState(ctx: EffectContext, t: Fighter, stateId: number): boolean {
  if (!t.alive || !stateId) return false
  const had = t.states.includes(stateId)
  const remaining = buffDuration(ctx.effect)
  const existing = sameStateBuff(ctx, t, stateId)
  if (existing) {
    existing.remaining = existing.remaining < 0 || remaining < 0 ? -1 : Math.max(existing.remaining, remaining)
    return !had
  }
  enforceMaxStack(ctx, t, stateId)
  addEffectBuff(ctx, t, { value: stateId, stateId, remaining }, recording(ctx) ? stateName(ctx, stateId) : '')
  return !had
}

/** Retire tous les buffs accordant l'état `stateId` à `t`. */
export function removeState(ctx: EffectContext, t: Fighter, stateId: number): void {
  let uids: number[] | undefined
  for (const b of t.buffs) if (b.stateId === stateId) (uids ??= []).push(b.uid)
  if (!uids) return
  for (const uid of uids) ctx.engine.removeBuff(ctx.fight, t, uid)
}

registerBuffEffect(950, ctx => {
  const stateId = ctx.effect.value
  for (const t of ctx.targets) addState(ctx, t, stateId)
})

registerBuffEffect(951, ctx => {
  const stateId = ctx.effect.value
  for (const t of ctx.targets) removeState(ctx, t, stateId)
})

registerBuffEffect(952, ctx => {
  const stateId = ctx.effect.value
  if (!stateId) return
  for (const t of ctx.targets) {
    if (!t.alive) continue
    enforceMaxStack(ctx, t, stateId)
    addEffectBuff(ctx, t, { value: stateId, disabledStateId: stateId }, recording(ctx) ? `${stateName(ctx, stateId)} désactivé` : '')
  }
})

registerBuffEffect(150, ctx => {
  for (const t of ctx.targets) {
    if (addState(ctx, t, STATE_INVISIBLE) && t.alive) ctx.engine.trigger(ctx.fight, t, { type: 'ION', source: ctx.caster })
  }
})

registerBuffEffect(140, ctx => {
  for (const t of ctx.targets) {
    if (!t.alive) continue
    enforceMaxStack(ctx, t)
    addEffectBuff(ctx, t, { value: 1, passTurn: true, kind: 'special' }, recording(ctx) ? 'Tour annulé' : '')
  }
})

registerBuffEffect(2188, ctx => {
  const behaviour = ctx.effect.diceNum || ctx.effect.value
  for (const t of ctx.targets) if (t.alive) t.tags.aiBehaviour = behaviour
})
