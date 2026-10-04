/**
 * Désenvoûtements et retraits d'effets (kind `dispel` + 132 ; docs/research/effects.md §2.3, §7.11) :
 *  - 132 « Enlève les envoûtements » : retire tous les buffs désenvoûtables (`dispellable` 1) de la cible ;
 *  - 1075 « Durée des effets : −X » : réduit de `diceNum` tours les buffs désenvoûtables (1) de la cible ; un buff
 *    ramené à 0 est retiré ; les effets permanents (−1) et encore différés ne sont pas touchés (OTOMAI
 *    `HaxeFighter.ReduceBuffDurations`) — Vortex *Heuristique* : −2 tours ;
 *  - 406 « Enlève les effets du sort `value` » : tous les buffs issus de ce sort, quels que soient leur lanceur et leur
 *    désenvoûtabilité (auto-consommation : déclencheur D + propre sort, purge du poison par un soin…) ;
 *  - 1406 « Enlève les effets du rang `diceSide` du sort `value` » (rang 0 = tous les rangs).
 * 132 et 1075 émettent le déclencheur 'DIS' (« le porteur est désenvoûté ») sur la cible ; 406/1406 non (ce sont des
 * retraits ciblés, souvent l'auto-consommation d'un buff).
 */
import type { Engine } from '../../engine'
import type { Buff, Fighter, FightState } from '../../types'
import type { EffectContext } from '../registry'
import { levelOfEffect, registerBuffEffect, rollValue } from './common'

/**
 * Le buff peut-il être retiré par un désenvoûtement ? Normal : `dispellable` 1 ; fort : 1, 2 ou 3
 * (D2 `BasicBuff.canBeDispell` : 2 = « retiré à la mort » et désenvoûtement fort ; 4 = jamais).
 */
export function canBeDispelled(b: Buff, strong = false): boolean {
  const d = b.effect.dispellable
  if (strong) return d >= 1 && d <= 3
  return b.dispellable
}

/** Désenvoûte `target` (retire ses buffs désenvoûtables), puis déclenche 'DIS'. Retourne le nombre de buffs retirés. */
export function dispelBuffs(engine: Engine, fight: FightState, target: Fighter, opts: { strong?: boolean; source?: Fighter } = {}): number {
  let uids: number[] | undefined
  for (const b of target.buffs) if (canBeDispelled(b, opts.strong)) (uids ??= []).push(b.uid)
  if (uids) for (const uid of uids) engine.removeBuff(fight, target, uid)
  if (target.alive && !fight.ended) engine.trigger(fight, target, { type: 'DIS', source: opts.source })
  return uids?.length ?? 0
}

/** Réduit de `turns` la durée des buffs désenvoûtables de `target` (retire ceux qui tombent à 0), puis 'DIS'. */
export function shortenBuffs(engine: Engine, fight: FightState, target: Fighter, turns: number, source?: Fighter): void {
  let uids: number[] | undefined
  if (turns > 0) {
    for (const b of target.buffs) {
      if (!b.dispellable || b.delay > 0 || b.kind === 'delayed' || b.remaining < 0) continue
      b.remaining -= turns
      if (b.remaining <= 0) (uids ??= []).push(b.uid)
    }
  }
  if (uids) for (const uid of uids) engine.removeBuff(fight, target, uid)
  if (target.alive && !fight.ended) engine.trigger(fight, target, { type: 'DIS', source })
}

/** Retire de `target` les buffs issus du sort `spellId` (optionnellement d'un seul rang). */
export function removeSpellBuffs(engine: Engine, fight: FightState, target: Fighter, spellId: number, accept?: (b: Buff) => boolean): void {
  let uids: number[] | undefined
  for (const b of target.buffs) if (b.spellId === spellId && (!accept || accept(b))) (uids ??= []).push(b.uid)
  if (uids) for (const uid of uids) engine.removeBuff(fight, target, uid)
}

registerBuffEffect(132, ctx => {
  for (const t of ctx.targets) if (t.alive) dispelBuffs(ctx.engine, ctx.fight, t, { source: ctx.caster })
})

registerBuffEffect(1075, ctx => {
  const turns = rollValue(ctx)
  for (const t of ctx.targets) if (t.alive) shortenBuffs(ctx.engine, ctx.fight, t, turns, ctx.caster)
})

registerBuffEffect(406, ctx => {
  const spellId = ctx.effect.value
  if (!spellId) return
  for (const t of ctx.targets) removeSpellBuffs(ctx.engine, ctx.fight, t, spellId)
})

/** effectUid -> rang (grade) du sort qui le contient. */
const GRADE_BY_UID = new Map<number, number>()

function gradeOf(ctx: EffectContext, b: Buff): number {
  const uid = b.effect.uid
  if (uid !== undefined) {
    const g = GRADE_BY_UID.get(uid)
    if (g !== undefined) return g
  }
  const g = levelOfEffect(ctx, b.spellId, b.effect)?.grade ?? 0
  if (uid !== undefined) GRADE_BY_UID.set(uid, g)
  return g
}

registerBuffEffect(1406, ctx => {
  const spellId = ctx.effect.value
  const grade = ctx.effect.diceSide
  if (!spellId) return
  for (const t of ctx.targets) {
    removeSpellBuffs(ctx.engine, ctx.fight, t, spellId, grade > 0 ? b => gradeOf(ctx, b) === grade : undefined)
  }
})
