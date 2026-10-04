/**
 * Famille « buffs » — régressions de la relecture adversariale (sorts réels) :
 *  - Sagesse en combat : pas de double compte du ⌊Sag/10⌋ en Retrait / Esquive PA-PM (*Tourbe écrasante*) ;
 *  - déclencheurs APA / MPA seulement sur une perte réelle (OTOMAI `ApStolen > 0`), CMPA sur toute tentative ;
 *  - 1075 (*Heuristique*) : DIS seulement si un buff a été retiré, durées ≥ 63 intactes ;
 *  - cumul (`maxStack`) : deux effets distincts du même sort se cumulent (*Intenable*), version critique ↔ normale
 *    du même effet non (*Puissance*) ;
 *  - 1045 sur une cible qui ne joue pas (*Mot d'Amitié* du Lapino) : relance bloquant ses N prochains tours ;
 *  - espérance d'un retrait esquivable à jet variable (*Jet de pierre* : −4 à −6 PM) ;
 *  - `enforceMaxStack(…, 'trigger')` : règle de cumul applicable aux buffs déclencheurs du noyau (*Injection Toxique*).
 */
import { describe, expect, it } from 'vitest'
import { expectedApMpRemoved } from '../src/damage/apmp'
import { canCast, castSpell } from '../src/engine/cast'
import { enforceMaxStack } from '../src/engine/effects/buffs'
import { castSubSpell } from '../src/engine/effects/core'
import { createMonsterFighter } from '../src/engine/factory'
import { apply, cellAt, data, effect, fight, monster, newEngine, player, turnOf } from './effects-buffs-helpers'

const TOURBE_ECRASANTE = 1279 // +1000 Sagesse (124) sur soi, 6 tours
const MALADRESSE = 13337 // Enutrof : −2 PM esquivables (1080)
const HEURISTIQUE = 5068 // Vortex : 1075 −2 puis Pacifiste
const INTENABLE = 15595 // rang 2 : 1171 +30 % si Pesanteur (7), 1171 +30 % si Indéplaçable (97), cumul 1
const PUISSANCE = 13118 // Iop : +300 (CC +350) Puissance, cumul 1
const MOT_AMITIE = 25795 // Eniripsa : invoque le Lapino
const MOT_AMITIE_LAPINO = 25794 // rang 2 : 1045 « Mot d'Amitié : relance fixée à 2 » sur l'invocateur (h,P)
const LAPINO = 7370
const JET_DE_PIERRE = 235 // −4 à −6 PM esquivables (1080)
const INJECTION = 12940 // Sram : poison TB (98) + −1 PM esquivable, cumul 2

describe('Sagesse en combat (124)', () => {
  it('Tourbe écrasante : +1000 Sagesse ⇒ +100 Retrait et Esquive PA/PM (une seule fois)', () => {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: 8, spellIds: [], cell: cellAt(5, 0), stats: { initiative: 100 } })
    const b = player({ name: 'B', breedId: 8, spellIds: [], team: 1, cell: cellAt(9, 0) })
    const fs = fight(engine, [a, b])
    turnOf(engine, fs, a)
    const before = { ...a.stats }
    expect(castSubSpell(engine, fs, a, TOURBE_ECRASANTE, 1, a.cell, false, 0)).toBe(true)
    expect(a.stats.wisdom - before.wisdom).toBe(1000)
    for (const k of ['apReduction', 'mpReduction', 'apParry', 'mpParry'] as const) expect(a.stats[k] - before[k]).toBe(100)
  })
})

describe('déclencheurs de perte de PA/PM', () => {
  function setup(stats: { mpReduction: number; mpParry: number }) {
    const engine = newEngine()
    const enu = player({ name: 'Enutrof', breedId: 3, spellIds: [MALADRESSE], cell: cellAt(5, 0), stats: { initiative: 1000, mpReduction: stats.mpReduction } })
    const foe = player({ name: 'Cible', breedId: 8, spellIds: [], team: 1, cell: cellAt(9, 0), stats: { mpParry: stats.mpParry } })
    const fs = fight(engine, [enu, foe], { record: false })
    turnOf(engine, fs, enu)
    // Écouteurs synthétiques : MPA (perte subie) ⇒ état 74 sur la cible ; CMPA (tentative) ⇒ état 76 sur le lanceur.
    apply(engine, fs, foe, foe, [effect(950, { triggers: 'MPA', value: 74, duration: 1, triggerDuration: 2, targetMask: 'a', dispellable: 4 })])
    apply(engine, fs, enu, enu, [effect(950, { triggers: 'CMPA', value: 76, duration: 1, triggerDuration: 2, targetMask: 'a', dispellable: 4 })])
    return { engine, fs, enu, foe }
  }

  it('MPA seulement si des PM ont été perdus ; CMPA à chaque tentative (jets seedés)', () => {
    const { engine, fs, enu, foe } = setup({ mpReduction: 1, mpParry: 1000 }) // 10 % par point
    let dodged = 0
    for (let i = 0; i < 200; i++) {
      const c = engine.cloneFight(fs)
      c.rngState = (i * 2654435761 + 3) | 0
      expect(castSpell(engine, c, c.fighters[enu.id], MALADRESSE, foe.cell).ok).toBe(true)
      const t = c.fighters[foe.id]
      const lost = t.stats.mp < 6
      if (!lost) dodged++
      expect(t.states.includes(74)).toBe(lost)
      expect(c.fighters[enu.id].states).toContain(76)
    }
    expect(dodged).toBeGreaterThan(100) // ≈ 81 % d'esquive totale
  })

  it('cible insensible aux pertes de PM (effet d’état 30) : ni débuff ni MPA, mais CMPA', () => {
    const { engine, fs, enu, foe } = setup({ mpReduction: 5000, mpParry: 1 })
    let immune = 0
    for (let id = 1; id < 8000 && !immune; id++) if (data().state(id)?.effectsIds?.includes(30)) immune = id
    apply(engine, fs, foe, foe, [effect(950, { value: immune, duration: 2, targetMask: 'a' })])
    expect(castSpell(engine, fs, enu, MALADRESSE, foe.cell).ok).toBe(true)
    expect(foe.stats.mp).toBe(6)
    expect(foe.states).not.toContain(74)
    expect(enu.states).toContain(76)
  })
})

describe('Heuristique (1075) : DIS et durées permanentes', () => {
  function vortexFight() {
    const engine = newEngine()
    const vortex = monster(3835, cellAt(5, 0), { initiative: 100000 })
    const target = player({ name: 'Crâ', breedId: 9, spellIds: [], team: 0, cell: cellAt(11, 0), stats: { initiative: 50 } })
    const fs = fight(engine, [vortex, target], { rollMode: 'average' })
    turnOf(engine, fs, vortex)
    // Écouteur DIS non désenvoûtable (état 74) et déclencheur « tout le combat » (63 tours) DÉSENVOÛTABLE.
    apply(engine, fs, target, target, [effect(950, { triggers: 'DIS', value: 74, duration: 1, triggerDuration: 3, targetMask: 'a', dispellable: 4 })])
    apply(engine, fs, target, target, [effect(128, { triggers: 'MPA', diceNum: 1, duration: 1, triggerDuration: 63, targetMask: 'a', dispellable: 1 })])
    return { engine, fs, vortex, target }
  }

  it('aucun buff retiré ⇒ pas de DIS (OTOMAI ReduceBuffDurations) ; le déclencheur 63 tours est intact', () => {
    const { engine, fs, vortex, target } = vortexFight()
    const listener = target.buffs.find(b => b.effect.effectId === 128)!
    expect(listener.remaining).toBe(63)
    expect(castSpell(engine, fs, vortex, HEURISTIQUE, target.cell).ok).toBe(true)
    expect(target.states).not.toContain(74)
    expect(listener.remaining).toBe(63)
    expect(target.states).toContain(218) // Pacifiste posé ensuite
  })

  it('un buff retiré ⇒ DIS', () => {
    const { engine, fs, vortex, target } = vortexFight()
    apply(engine, fs, target, target, [effect(119, { diceNum: 50, duration: 2, targetMask: 'a', dispellable: 1 })])
    expect(castSpell(engine, fs, vortex, HEURISTIQUE, target.cell).ok).toBe(true)
    expect(target.stats.agility).toBe(0)
    expect(target.states).toContain(74)
  })
})

describe('cumul (maxStack) : identité des effets', () => {
  it('Intenable : les deux 1171 (conditions d’états différentes) se cumulent malgré maxStack 1', () => {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: 12, spellIds: [], cell: cellAt(5, 0), stats: { initiative: 100 } })
    const b = player({ name: 'B', breedId: 8, spellIds: [], team: 1, cell: cellAt(9, 0) })
    const fs = fight(engine, [a, b])
    turnOf(engine, fs, a)
    const lvl = data().spellLevel(INTENABLE, { grade: 2 })!
    expect(lvl.maxStack).toBe(1)
    apply(engine, fs, a, a, [effect(950, { value: 7, duration: 1, targetMask: 'C' }), effect(950, { value: 97, duration: 1, targetMask: 'C' })])
    expect(castSubSpell(engine, fs, a, INTENABLE, 2, a.cell, false, 0)).toBe(true)
    expect(a.buffs.filter(x => x.effect.effectId === 1171)).toHaveLength(2)
    expect(a.stats.finalDamagePct).toBe(60)
    // Les états consommés (951), un second lancer sous Pesanteur seule remplace le seul 1171 « Pesanteur ».
    apply(engine, fs, a, a, [effect(950, { value: 7, duration: 1, targetMask: 'C' })])
    expect(castSubSpell(engine, fs, a, INTENABLE, 2, a.cell, false, 0)).toBe(true)
    expect(a.buffs.filter(x => x.effect.effectId === 1171)).toHaveLength(2)
    expect(a.stats.finalDamagePct).toBe(60)
  })

  it('Puissance : la version critique remplace la version normale (même effet, cumul 1)', () => {
    const engine = newEngine()
    const iop = player({ name: 'Iop', breedId: 8, spellIds: [PUISSANCE], cell: cellAt(5, 0), stats: { initiative: 100 } })
    const b = player({ name: 'B', breedId: 8, spellIds: [], team: 1, cell: cellAt(9, 0) })
    const fs = fight(engine, [iop, b])
    turnOf(engine, fs, iop)
    const grade = iop.spells[0].level.grade
    expect(castSubSpell(engine, fs, iop, PUISSANCE, grade, iop.cell, false, 0)).toBe(true)
    expect(castSubSpell(engine, fs, iop, PUISSANCE, grade, iop.cell, true, 0)).toBe(true)
    expect(iop.buffs.filter(x => x.effect.effectId === 138)).toHaveLength(1)
    expect(iop.stats.power).toBe(iop.spells[0].level.criticalEffects.find(e => e.effectId === 138)!.diceNum)
    expect(castSubSpell(engine, fs, iop, PUISSANCE, grade, iop.cell, false, 0)).toBe(true)
    expect(iop.buffs.filter(x => x.effect.effectId === 138)).toHaveLength(1)
    expect(iop.stats.power).toBe(300)
  })
})

describe('maxStack des buffs déclencheurs (API pour le noyau)', () => {
  it('Injection Toxique (cumul 2) : enforceMaxStack(…, "trigger") ramène les poisons TB à maxStack − 1 avant un nouvel ajout', () => {
    const engine = newEngine()
    const sram = player({ name: 'Sram', breedId: 4, spellIds: [INJECTION], cell: cellAt(5, 0), stats: { initiative: 1000, ap: 50 } })
    const foe = player({ name: 'Cible', breedId: 8, spellIds: [], team: 1, cell: cellAt(8, 0) })
    const fs = fight(engine, [sram, foe], { rollMode: 'average' })
    turnOf(engine, fs, sram)
    for (let k = 0; k < 3; k++) {
      sram.cooldowns = {}
      sram.castsOnTarget = {}
      expect(castSpell(engine, fs, sram, INJECTION, foe.cell).ok).toBe(true)
    }
    const known = sram.spells[0]
    const poison = known.level.effects.find(e => e.effectId === 98 && e.triggers === 'TB')!
    // Le noyau ne plafonne pas encore ses buffs déclencheurs (3 poisons pour un cumul de 2) : l'API le permet.
    expect(foe.buffs.filter(b => b.kind === 'trigger' && b.effect.effectId === 98)).toHaveLength(3)
    const ctx = {
      engine, fight: fs, caster: sram, spell: known, spellId: INJECTION, effect: poison, targetCell: foe.cell, casterCell: sram.cell,
      cells: [foe.cell], targets: [foe], efficiency: new Map([[foe.id, 1]]), crit: false, indirect: false, depth: 0,
    }
    enforceMaxStack(ctx, foe, 0, 'trigger')
    expect(foe.buffs.filter(b => b.kind === 'trigger' && b.effect.effectId === 98)).toHaveLength(known.level.maxStack - 1)
    // Les débuffs de PM (buffs « instantanés » de la famille) ne sont pas comptés avec les déclencheurs.
    expect(foe.buffs.filter(b => b.kind !== 'trigger' && b.effect.effectId === 1080).length).toBeLessThanOrEqual(2)
  })
})

describe('1045 sur une cible qui ne joue pas', () => {
  it('Mot d’Amitié (Lapino → Eniripsa, h,P) : « relance fixée à 2 » bloque les 2 prochains tours de l’Eniripsa', () => {
    const engine = newEngine()
    const eni = player({ name: 'Eniripsa', breedId: 7, spellIds: [MOT_AMITIE], cell: cellAt(5, 0), stats: { initiative: 1000 } })
    const foe = player({ name: 'Ennemi', breedId: 8, spellIds: [], team: 1, cell: cellAt(5, 3), stats: { initiative: 10 } })
    const fs = fight(engine, [eni, foe])
    turnOf(engine, fs, eni)
    const lapino = engine.spawn(fs, createMonsterFighter(data(), { monsterId: LAPINO, grade: 1, team: 0, cell: cellAt(3, 0), summonerId: eni.id, summoner: eni }))
    turnOf(engine, fs, lapino)
    expect(castSubSpell(engine, fs, lapino, MOT_AMITIE_LAPINO, 2, lapino.cell, false, 0)).toBe(true)
    const known = eni.spells.find(s => s.spellId === MOT_AMITIE)!
    const free = cellAt(7, 0)
    for (const blocked of [true, true, false]) {
      turnOf(engine, fs, eni)
      expect(canCast(engine, fs, eni, known, free)).toBe(blocked ? 'cooldown' : null)
    }
  })

  it('sur soi pendant son tour : « relance fixée à 1 » bloque seulement le tour suivant', () => {
    const engine = newEngine()
    const eni = player({ name: 'Eniripsa', breedId: 7, spellIds: [MOT_AMITIE], cell: cellAt(5, 0), stats: { initiative: 1000 } })
    const foe = player({ name: 'Ennemi', breedId: 8, spellIds: [], team: 1, cell: cellAt(5, 3), stats: { initiative: 10 } })
    const fs = fight(engine, [eni, foe])
    turnOf(engine, fs, eni)
    apply(engine, fs, eni, eni, [effect(1045, { diceNum: MOT_AMITIE, value: 1, targetMask: 'C' })])
    expect(eni.cooldowns[MOT_AMITIE]).toBe(1)
    turnOf(engine, fs, eni)
    expect(eni.cooldowns[MOT_AMITIE]).toBe(0)
  })
})

describe("espérance d'un retrait esquivable à jet variable", () => {
  it("Jet de pierre (−4 à −6 PM) en mode 'average' : moyenne exacte sur les 3 jets", () => {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: 3, spellIds: [], cell: cellAt(5, 0), stats: { initiative: 1000, mpReduction: 60 } })
    const b = player({ name: 'B', breedId: 8, spellIds: [], team: 1, cell: cellAt(6, 0), stats: { mpParry: 40 } })
    const fs = fight(engine, [a, b], { rollMode: 'average' })
    turnOf(engine, fs, a)
    expect(castSubSpell(engine, fs, a, JET_DE_PIERRE, 1, b.cell, false, 0)).toBe(true)
    const expected = (expectedApMpRemoved(60, 40, 6, 6, 4) + expectedApMpRemoved(60, 40, 6, 6, 5) + expectedApMpRemoved(60, 40, 6, 6, 6)) / 3
    expect(6 - b.stats.mp).toBeCloseTo(expected, 10)
    expect(fs.metrics[a.id].mpRemoved).toBeCloseTo(expected, 10)
  })
})
