/**
 * Effets « portés par l'invocation » (effects/core.ts `isSummonOwned`) et recalcul des cibles après une apparition.
 *
 * Bug trouvé par le réglage de l'IA (docs/tuning-log.md, tour 1) : le 141 « tue la cible » différé (masque `C`) du
 * Sac Animé tuait l'Enutrof 3 tours après l'invocation, et l'interception 765 faisait de l'Enutrof l'intercepteur.
 * Descriptions des sorts : le Sac « intercepte les dommages des alliés situés dans sa zone d'invocation » et « est
 * détruit 3 tours après son invocation » ; la Musette Animée et la Pelle de Fortune sont détruites 2 tours après.
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { applyEffects } from '../src/engine/effects/core'
import type { Fighter, FightState } from '../src/engine/types'
import type { Engine } from '../src/engine/engine'
import { cellAt, effect, fight, monster, newEngine, player, turnOf, zone } from './effects-summons-helpers'

const ENUTROF = 3
const SAC_ANIME = 13328
const MUSETTE_ANIMEE = 13354
const PELLE_DE_FORTUNE = 29755

function setup(spellId: number): { engine: Engine; fs: FightState; enu: Fighter; enemy: Fighter; summon: Fighter } {
  const engine = newEngine()
  const enu = player({ name: 'Enu', breedId: ENUTROF, spellIds: [spellId], cell: cellAt(10, 0), hp: 4000, stats: { summons: 3, initiative: 5000 } })
  const enemy = monster(3834, cellAt(20, 0), { grade: 1 })
  const fs = fight(engine, [enu, enemy])
  turnOf(engine, fs, enu)
  expect(castSpell(engine, fs, enu, spellId, cellAt(11, 0)).ok).toBe(true)
  const summon = fs.fighters.find(f => f.kind === 'summon' && f.summonerId === enu.id)
  expect(summon).toBeDefined()
  return { engine, fs, enu, enemy, summon: summon! }
}

/** Nombre de tours de l'Enutrof (après celui de l'invocation) avant la mort de l'invocation, au plus `max`. */
function turnsUntilDeath(engine: Engine, fs: FightState, enu: Fighter, summon: Fighter, max = 6): number {
  for (let i = 1; i <= max; i++) {
    turnOf(engine, fs, enu)
    if (!summon.alive) return i
  }
  return Infinity
}

describe('invocations Enutrof : effets portés par l’invocation', () => {
  it('Sac Animé : l’Enutrof survit, le Sac est détruit 3 tours après son invocation', () => {
    const { engine, fs, enu, summon } = setup(SAC_ANIME)
    // Délai 3 décompté sur les tours de l'Enutrof (`aliveSourceId`) : le Sac joue 3 tours et est détruit au début du
    // 3e tour suivant de l'Enutrof — en même temps que la fin de son interception (durée 3).
    expect(turnsUntilDeath(engine, fs, enu, summon)).toBe(3)
    expect(enu.buffs.some(b => b.effect.effectId === 765)).toBe(false)
    expect(enu.alive).toBe(true)
    expect(fs.events.some(e => e.t === 'death' && e.target === enu.id)).toBe(false)
  })

  it('Sac Animé : c’est le Sac qui intercepte les dommages des alliés de sa zone (765 portée par lui)', () => {
    const { engine, fs, enu, enemy, summon } = setup(SAC_ANIME)
    const intercept = enu.buffs.find(b => b.effect.effectId === 765)
    expect(intercept?.sourceId).toBe(summon.id)
    expect(summon.buffs.some(b => b.effect.effectId === 765)).toBe(false)
    const enuHp = enu.hp
    const sacHp = summon.hp
    const hit = effect(97, { diceNum: 100, diceSide: 100, targetMask: 'A', zone: zone('P', 1) })
    applyEffects(engine, fs, enemy, null, 0, [hit], enu.cell, enemy.cell, false, false, 0)
    expect(enu.hp).toBe(enuHp)
    expect(summon.hp).toBeLessThan(sacHp)
  })

  it('Musette Animée : détruite 2 tours après son invocation (141 « a,A » P1 recalculé après l’invocation)', () => {
    const { engine, fs, enu, summon } = setup(MUSETTE_ANIMEE)
    expect(turnsUntilDeath(engine, fs, enu, summon)).toBe(2)
    expect(enu.alive).toBe(true)
  })

  it('Pelle de Fortune : détruite 2 tours après son invocation, l’Enutrof survit (et reçoit le soin 1109)', () => {
    const { engine, fs, enu, summon } = setup(PELLE_DE_FORTUNE)
    expect(enu.buffs.some(b => b.kind === 'delayed' && b.effect.effectId === 1109)).toBe(true)
    expect(enu.buffs.some(b => b.kind === 'delayed' && b.effect.effectId === 141)).toBe(false)
    expect(turnsUntilDeath(engine, fs, enu, summon)).toBe(2)
    expect(enu.alive).toBe(true)
    // Le soin et la destruction ont lieu au même début de tour de l'Enutrof.
    expect(enu.buffs.some(b => b.kind === 'delayed')).toBe(false)
  })
})
