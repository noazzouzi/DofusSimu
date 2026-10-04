/**
 * Famille « buffs » — mécaniques de l'Œil de Vortex : *Rayonirique* (Méjaire, Pacifiste non désenvoûtable, retiré à
 * la mort du lanceur) et *Heuristique* (Vortex : désenvoûtement −2 tours puis Pacifiste désenvoûtable).
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { apply, cellAt, effect, fight, monster, newEngine, player, turnOf } from './effects-buffs-helpers'

const RAYONIRIQUE = 5022
const HEURISTIQUE = 5068
const PUISSANCE = 13118
const PACIFISTE = 218

describe('Méjaire — Rayonirique', () => {
  function setup() {
    const engine = newEngine()
    const mej = monster(3836, cellAt(5, 0), { initiative: 100000 })
    const target = player({ name: 'Iop', breedId: 8, spellIds: [], team: 0, cell: cellAt(7, 0), stats: { initiative: 10 } })
    const fs = fight(engine, [mej, target], { rollMode: 'average' })
    turnOf(engine, fs, mej)
    expect(castSpell(engine, fs, mej, RAYONIRIQUE, target.cell).ok).toBe(true)
    return { engine, fs, mej, target }
  }

  it('pose Pacifiste (cantDealDamage) pour 1 tour du Méjaire', () => {
    const { engine, fs, mej, target } = setup()
    expect(target.states).toContain(PACIFISTE)
    expect(engine.stateFlag(target, 'cantDealDamage')).toBe(true)
    const buff = target.buffs.find(b => b.stateId === PACIFISTE)!
    expect(buff.remaining).toBe(1)
    expect(buff.effect.dispellable).toBe(2)
    turnOf(engine, fs, target) // tout le tour de la cible est sous Pacifiste
    expect(engine.stateFlag(target, 'cantDealDamage')).toBe(true)
    turnOf(engine, fs, mej)
    expect(target.states).not.toContain(PACIFISTE)
  })

  it('non désenvoûtable (dispellable 2) : résiste à 132 et 1075, mais disparaît à la mort du Méjaire', () => {
    const { engine, fs, mej, target } = setup()
    apply(engine, fs, mej, target, [effect(132)])
    apply(engine, fs, mej, target, [effect(1075, { diceNum: 5 })])
    expect(target.states).toContain(PACIFISTE)
    engine.kill(fs, mej, target)
    expect(target.states).not.toContain(PACIFISTE)
  })
})

describe('Vortex — Heuristique', () => {
  it('−2 tours aux effets désenvoûtables de la cible (DIS), puis Pacifiste 1 tour désenvoûtable', () => {
    const engine = newEngine()
    const vortex = monster(3835, cellAt(5, 0), { initiative: 100000 })
    const target = player({ name: 'Crâ', breedId: 9, spellIds: [], team: 0, cell: cellAt(11, 0), stats: { initiative: 50 } })
    const iop = player({ name: 'Iop', breedId: 8, spellIds: [PUISSANCE], team: 0, cell: cellAt(13, 0), stats: { initiative: 60 } })
    const fs = fight(engine, [vortex, target, iop], { rollMode: 'average' })
    // Avant le Vortex : l'Iop booste le Crâ (Puissance : 3 tours, désenvoûtable).
    turnOf(engine, fs, iop)
    expect(castSpell(engine, fs, iop, PUISSANCE, target.cell).ok).toBe(true)
    apply(engine, fs, iop, target, [
      effect(128, { diceNum: 2, duration: 1, dispellable: 1 }), // +2 PM 1 tour : retiré par −2
      effect(1080, { diceNum: 0, duration: 3, dispellable: 3 }), // (jet nul : aucun débuff posé)
      effect(752, { diceNum: 30, duration: 3, dispellable: 3 }), // +30 Fuite non désenvoûtable : intact
      effect(753, { diceNum: 40, duration: -1, dispellable: 1 }), // +40 Tacle permanent : intact
    ])
    apply(engine, fs, target, target, [effect(950, { triggers: 'DIS', value: 74, duration: 1, triggerDuration: 3, targetMask: 'a', dispellable: 4 })])
    expect(target.stats.mp).toBe(8)
    turnOf(engine, fs, vortex)
    const puissance = target.buffs.find(b => b.effect.effectId === 138)!
    expect(puissance.remaining).toBe(3)
    expect(castSpell(engine, fs, vortex, HEURISTIQUE, target.cell).ok).toBe(true)
    expect(puissance.remaining).toBe(1)
    expect(target.stats.power).toBe(300)
    expect(target.stats.mp).toBe(6)
    expect(target.stats.tackleEvade).toBe(30)
    expect(target.stats.tackleBlock).toBe(40)
    expect(target.states).toContain(74) // déclencheur DIS
    // Pacifiste posé APRÈS le désenvoûtement (order 1) : présent, désenvoûtable, 1 tour du Vortex.
    const paci = target.buffs.find(b => b.stateId === PACIFISTE)!
    expect(paci.remaining).toBe(1)
    expect(paci.dispellable).toBe(true)
    // Un second Heuristique (autre lanceur) désenvoûterait le Pacifiste précédent avant d'en poser un nouveau.
    apply(engine, fs, vortex, target, [effect(1075, { diceNum: 2 })])
    expect(target.states).not.toContain(PACIFISTE)
    expect(target.stats.power).toBe(0)
  })
})
