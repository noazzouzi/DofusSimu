/**
 * Effets « spéciaux » restants (docs/research/effects.md §11, effect-semantics.json) :
 *  - 141 CharacterKill : tue la cible (avec un `delay`, fait mourir une invocation à la fin de son N-ième tour) ;
 *  - 781 CharacterUnlucky / 782 CharacterLucky : les jets aléatoires du porteur prennent la valeur minimale /
 *    maximale pendant `duration` (lu par castSpell, cf. `forcedRollMode`) ;
 *  - 2027 ControlEntity : l'invocation ciblée devient contrôlable (marqueur pour l'IA ; nos IA pilotent déjà toute l'équipe) ;
 *  - 202 DecorsRevealUnvisible : retire l'invisibilité des entités de la zone ;
 *  - 1009 CharacterActivateBomb : la bombe ciblée lance son sort d'explosion sur sa case puis meurt ;
 *  - 1031 CharacterPassCurrentTurn : termine immédiatement le tour du lanceur.
 */
import type { Engine } from '../engine'
import type { Fighter, FightState, RollMode } from '../types'
import { STATE_INVISIBLE } from './buffs/states'
import { castSubSpell } from './core'
import { registerEffect } from './registry'

registerEffect(141, 'special', ctx => {
  for (const t of ctx.targets) if (t.alive) ctx.engine.kill(ctx.fight, t, ctx.caster)
})

for (const id of [781, 782]) {
  registerEffect(id, 'special', ctx => {
    for (const t of ctx.targets) {
      ctx.engine.addBuff(ctx.fight, t, {
        sourceId: ctx.caster.id,
        spellId: ctx.spellId,
        effect: ctx.effect,
        value: 0,
        remaining: ctx.effect.duration < 0 || ctx.effect.duration >= 63 ? -1 : Math.max(1, ctx.effect.duration),
        delay: 0,
        dispellable: ctx.effect.dispellable === 1,
        kind: 'special',
        label: id === 781 ? 'Poisse (jets minimaux)' : 'Chance (jets maximaux)',
      })
    }
  })
}

registerEffect(2027, 'special', ctx => {
  for (const t of ctx.targets) if (t.summonerId === ctx.caster.id) t.tags.controlled = true
})

registerEffect(202, 'special', ctx => {
  for (const t of ctx.targets) {
    for (const b of t.buffs.slice()) {
      if (b.stateId === STATE_INVISIBLE || b.effect.effectId === 150) ctx.engine.removeBuff(ctx.fight, t, b.uid)
    }
  }
})

registerEffect(1009, 'special', ctx => {
  for (const bomb of ctx.targets) {
    if (!bomb.alive || bomb.tags.bombSlot !== true) continue
    // Sort d'explosion : premier sort de la bombe qui inflige des dommages (sinon son premier sort).
    const explosion =
      bomb.spells.find(s => s.level.effects.some(e => e.effectId >= 96 && e.effectId <= 100)) ?? bomb.spells[0]
    if (explosion) castSubSpell(ctx.engine, ctx.fight, bomb, explosion.spellId, explosion.level.grade, bomb.cell, false, ctx.depth + 1)
    if (bomb.alive) ctx.engine.kill(ctx.fight, bomb, ctx.caster)
  }
})

registerEffect(
  1031,
  'special',
  ctx => {
    const c = ctx.caster
    if (!c.alive) return
    c.ap = 0
    c.mp = 0
    c.tags.endTurnNow = true
    ctx.engine.emit(ctx.fight, { t: 'apmp', target: c.id, ap: 0, mp: 0, reason: 'fin de tour' })
  },
  false,
)

/** Mode de jet imposé au lanceur par Poisse (781) / Chance (782), ou undefined. */
export function forcedRollMode(_engine: Engine, _fight: FightState, caster: Fighter): RollMode | undefined {
  for (const b of caster.buffs) {
    if (b.kind !== 'special') continue
    if (b.effect.effectId === 781) return 'min'
    if (b.effect.effectId === 782) return 'max'
  }
  return undefined
}
