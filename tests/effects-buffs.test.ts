/**
 * Famille « buffs » — caractéristiques, durées, cumuls, portée, états, tour annulé, désenvoûtements, modificateurs de
 * sorts et relances, avec les sorts réels (Iop, Crâ, Sram, Xélor, Ikargn) sur une carte ouverte.
 */
import { describe, expect, it } from 'vitest'
import { castSpell, canCast, spellRange } from '../src/engine/cast'
import { modifiedSpellLevel, spellBaseDamageBonus, spellModifier } from '../src/engine/effects/buffs'
import { castSubSpell } from '../src/engine/effects/core'
import { registeredEffects } from '../src/engine/effects/registry'
import type { FightEvent } from '../src/engine/types'
import { apply, cellAt, data, effect, fight, monster, newEngine, next, player, turnOf } from './effects-buffs-helpers'

const PUISSANCE = 13118 // Iop : +300 Puissance, +120 Dommages Poussée, 3 tours, cumul 1
const AGITATION = 13143 // Iop : 406 (propre sort) + PM + Intaclable + Puissance par PM utilisé
const TIR_DE_REPLI = 32470 // Crâ : +2 Portée (117) sur soi, 1 tour
const TIRS_PUISSANTS = 32466 // Crâ : −3 Portée (116) sur soi, Puissance, Dommages Poussée, % Critique
const IMMOBILISATION = 32436 // Crâ : 293 +2 dégâts de base sur soi, 3 tours, cumul 4
const TIRS_ELOIGNES = 32465 // Crâ : 280/281 sur chaque sort offensif (les 280/281 « sort 0 » sont forClientOnly)
const ACUITE = 32469 // Crâ : 289 (ligne de vue désactivée) sur le sort 0 = tous les sorts
const INVISIBILITE = 12913 // Sram : invisibilité (150) + 2 PM
const TERRE_MYTHE = 5017 // Ikargn : vole 100 Force (271), −3 PA
const REDEMPTION = 32442 // Crâ : vol de vie Eau ; 293 affiché (forClientOnly) ; 1406 retire le rang 2 de 32462
const REDEMPTION_BONUS = 32462 // rang 1 : écoute CAPAS|CMPAS ⇒ rang 2 : 293 +6 dégâts de base sur 32442 (cumul 6)

describe('enregistrement', () => {
  it('tous les effectIds des kinds de la famille (effect-semantics.json) ont un interprète « buffs »', async () => {
    const { readFileSync } = await import('node:fs')
    const sem = JSON.parse(readFileSync('data/research/effect-semantics.json', 'utf8')).effects as Record<string, { kind: string }>
    const kinds = new Set(['stat_buff', 'stat_debuff', 'stat_steal', 'ap_mp', 'state', 'state_like', 'dispel', 'cooldown', 'spell_modifier'])
    const reg = registeredEffects()
    for (const [id, e] of Object.entries(sem)) {
      if (!kinds.has(e.kind)) continue
      expect(reg.get(Number(id))?.family, `effet ${id}`).toBe('buffs')
    }
    for (const id of [132, 140, 2188]) expect(reg.get(id)?.family).toBe('buffs')
  })
})

describe('buffs de caractéristiques et durées', () => {
  function iopFight() {
    const engine = newEngine()
    const iop = player({ name: 'Iop', breedId: 8, spellIds: [PUISSANCE, AGITATION], cell: cellAt(5, 0), stats: { initiative: 1000 } })
    const ally = player({ name: 'Allié', breedId: 9, spellIds: [], cell: cellAt(7, 0), stats: { initiative: 500 } })
    const foe = player({ name: 'Ennemi', breedId: 3, spellIds: [], team: 1, cell: cellAt(5, 3), stats: { initiative: 10 } })
    const fs = fight(engine, [iop, ally, foe])
    turnOf(engine, fs, iop)
    return { engine, fs, iop, ally, foe }
  }

  it('Puissance : +300 Puissance / +120 Dommages Poussée pendant 3 tours du lanceur', () => {
    const { engine, fs, iop, ally } = iopFight()
    expect(castSpell(engine, fs, iop, PUISSANCE, ally.cell).ok).toBe(true)
    const crit = (fs.events.find(e => e.t === 'cast') as Extract<FightEvent, { t: 'cast' }>).crit
    const power = crit ? ally.stats.power : 300
    expect(ally.stats.power).toBe(power)
    expect(ally.stats.pushDamage).toBeGreaterThanOrEqual(120)
    expect(ally.buffs.map(b => b.remaining)).toEqual([3, 3])
    expect(fs.events.some(e => e.t === 'buff' && e.target === ally.id && e.label.includes('Puissance'))).toBe(true)
    // Décompte au début du tour du LANCEUR : actif pendant les tours 1, 2, 3 de l'Iop (et ceux de l'allié entre-temps).
    for (const expected of [2, 1]) {
      turnOf(engine, fs, ally)
      expect(ally.stats.power).toBe(power)
      turnOf(engine, fs, iop)
      expect(ally.buffs[0].remaining).toBe(expected)
    }
    turnOf(engine, fs, ally)
    expect(ally.stats.power).toBe(power)
    turnOf(engine, fs, iop)
    expect(ally.stats.power).toBe(0)
    expect(ally.buffs).toEqual([])
  })

  it('cumul (maxStack 1) : un second Puissance sur la même cible remplace le premier', () => {
    const { engine, fs, iop, ally } = iopFight()
    castSpell(engine, fs, iop, PUISSANCE, ally.cell)
    iop.cooldowns = {}
    iop.ap = 12
    castSpell(engine, fs, iop, PUISSANCE, ally.cell)
    expect(ally.buffs.filter(b => b.effect.effectId === 138)).toHaveLength(1)
    expect(ally.buffs.filter(b => b.effect.effectId === 414)).toHaveLength(1)
  })

  it('406 en tête de sort : relancer Agitation retire les effets précédents (non cumulable)', () => {
    const { engine, fs, iop } = iopFight()
    castSpell(engine, fs, iop, AGITATION, iop.cell)
    const mp1 = iop.stats.mp
    expect(mp1).toBe(9)
    expect(iop.states).toContain(96) // Intaclable
    iop.cooldowns = {}
    castSpell(engine, fs, iop, AGITATION, iop.cell)
    expect(iop.stats.mp).toBe(9)
    expect(iop.buffs.filter(b => b.effect.effectId === 128)).toHaveLength(1)
  })

  it('Vitalité en % (1078) : PV max et courants augmentent, puis redescendent sans tuer', () => {
    const { engine, fs, iop, ally } = iopFight()
    apply(engine, fs, iop, ally, [effect(1078, { diceNum: 20, duration: 1, targetMask: 'a' })])
    expect(ally.maxHp).toBe(3600)
    expect(ally.hp).toBe(3600)
    ally.hp = 300 // dégâts subis entre-temps
    turnOf(engine, fs, iop)
    expect(ally.maxHp).toBe(3000)
    expect(ally.hp).toBe(1)
  })

  it('vol de caractéristique (Terre mythe, Ikargn) : −100 Force à la cible, +100 au lanceur', () => {
    const engine = newEngine()
    const ika = monster(3834, cellAt(5, 0), { initiative: 100000 })
    const foe = player({ name: 'Cible', breedId: 8, spellIds: [], cell: cellAt(6, 0), stats: { strength: 500 } })
    const fs = fight(engine, [ika, foe])
    turnOf(engine, fs, ika)
    const str = ika.stats.strength
    expect(castSpell(engine, fs, ika, TERRE_MYTHE, foe.cell).ok).toBe(true)
    expect(foe.stats.strength).toBe(400)
    expect(ika.stats.strength).toBe(str + 100)
    turnOf(engine, fs, ika)
    expect(foe.stats.strength).toBe(500)
    expect(ika.stats.strength).toBe(str)
  })

  it('caractéristiques de combat optionnelles (1076, 2971, 1054) et érosion (776, lue par Engine.erosionPercent)', () => {
    const { engine, fs, iop, ally } = iopFight()
    apply(engine, fs, iop, ally, [
      effect(1076, { diceNum: 25, duration: 2, targetMask: 'a' }),
      effect(2971, { diceNum: 10, duration: 2, targetMask: 'a' }),
      effect(1054, { diceNum: 150, duration: 2, targetMask: 'a' }),
      effect(776, { diceNum: 20, duration: 2, targetMask: 'a' }),
    ])
    expect(ally.stats.allResPct).toBe(25)
    expect(ally.stats.finalHealPct).toBe(10)
    expect(ally.stats.spellPower).toBe(150)
    expect(engine.erosionPercent(ally)).toBe(30)
  })
})

describe('portée', () => {
  it('Tir de Repli : +2 Portée 1 tour (sorts à portée modifiable) ; Tirs Puissants : −3 Portée + déclencheur R', () => {
    const engine = newEngine()
    const cra = player({ name: 'Crâ', breedId: 9, spellIds: [TIR_DE_REPLI, TIRS_PUISSANTS, IMMOBILISATION], cell: cellAt(5, 0), stats: { initiative: 1000 } })
    const foe = player({ name: 'Cible', breedId: 8, spellIds: [], team: 1, cell: cellAt(9, 0) })
    // Mode 'average' : pas de coup critique (valeurs normales des effets).
    const fs = fight(engine, [cra, foe], { rollMode: 'average' })
    turnOf(engine, fs, cra)
    const lvl = cra.spells.find(s => s.spellId === IMMOBILISATION)!.level
    const base = spellRange(cra, lvl).max
    expect(castSpell(engine, fs, cra, TIR_DE_REPLI, foe.cell).ok).toBe(true)
    expect(cra.stats.range).toBe(2)
    expect(spellRange(cra, lvl).max).toBe(base + 2)
    // Déclencheur 'R' (perte de portée) : état 74 posé au porteur.
    apply(engine, fs, cra, cra, [effect(950, { triggers: 'R', value: 74, duration: 1, triggerDuration: 1, targetMask: 'a' })])
    expect(castSpell(engine, fs, cra, TIRS_PUISSANTS, cra.cell).ok).toBe(true)
    expect(cra.stats.range).toBe(-1)
    expect(cra.stats.power).toBe(250)
    expect(cra.states).toContain(74)
    turnOf(engine, fs, cra)
    expect(cra.stats.range).toBe(0)
  })
})

describe('modificateurs de sorts (catégorie 3) et relances', () => {
  function craFight() {
    const engine = newEngine()
    const cra = player({ name: 'Crâ', breedId: 9, spellIds: [IMMOBILISATION, TIRS_ELOIGNES, ACUITE], cell: cellAt(5, 0), stats: { initiative: 1000, ap: 30 } })
    const a = player({ name: 'A', breedId: 8, spellIds: [], team: 1, cell: cellAt(8, 0), stats: { initiative: 1 } })
    const b = player({ name: 'B', breedId: 8, spellIds: [], team: 1, cell: cellAt(5, 3), stats: { initiative: 2 } })
    const c = player({ name: 'C', breedId: 8, spellIds: [], team: 1, cell: cellAt(2, 0), stats: { initiative: 3 } })
    const fs = fight(engine, [cra, a, b, c])
    turnOf(engine, fs, cra)
    return { engine, fs, cra, a, b, c }
  }

  it('293 Flèche d’Immobilisation : +2 dégâts de base par lancer, plafonné à maxStack (4) cumuls', () => {
    const { engine, fs, cra, a, b, c } = craFight()
    const lvl = cra.spells.find(s => s.spellId === IMMOBILISATION)!.level
    const bonus = lvl.effects.find(e => e.effectId === 293)!.value
    expect(lvl.maxStack).toBe(4)
    for (const t of [a, a, b, b]) expect(castSpell(engine, fs, cra, IMMOBILISATION, t.cell).ok).toBe(true)
    expect(spellBaseDamageBonus(cra, IMMOBILISATION)).toBe(4 * bonus)
    turnOf(engine, fs, cra)
    expect(castSpell(engine, fs, cra, IMMOBILISATION, c.cell).ok).toBe(true)
    // 5ᵉ lancer : le plus ancien cumul est retiré, toujours 4 cumuls.
    expect(cra.buffs.filter(x => x.effect.effectId === 293)).toHaveLength(4)
    expect(spellBaseDamageBonus(cra, IMMOBILISATION)).toBe(4 * bonus)
    expect(spellBaseDamageBonus(cra, TIRS_ELOIGNES)).toBe(0)
  })

  it('Tirs Éloignés : portées min/max de chaque sort offensif (sans double compte du « sort 0 » client)', () => {
    const { engine, fs, cra } = craFight()
    const lvl = cra.spells.find(s => s.spellId === IMMOBILISATION)!.level
    const te = cra.spells.find(s => s.spellId === TIRS_ELOIGNES)!.level
    const dMin = te.effects.find(e => e.effectId === 280 && e.diceNum === IMMOBILISATION)!.value
    const dMax = te.effects.find(e => e.effectId === 281 && e.diceNum === IMMOBILISATION)!.value
    expect(castSpell(engine, fs, cra, TIRS_ELOIGNES, cra.cell).ok).toBe(true)
    const m = modifiedSpellLevel(cra, lvl)
    expect(m.minRange).toBe(lvl.minRange + dMin)
    expect(m.range).toBe(lvl.range + dMax)
    expect(spellModifier(cra, IMMOBILISATION, 'rangeMax')).toBe(dMax)
    expect(spellRange(cra, m).max).toBe(lvl.range + dMax)
    // Cible trop proche après le bonus de portée minimale.
    const near = player({ breedId: 8, spellIds: [], team: 1, cell: cellAt(6, 0) })
    engine.spawn(fs, near)
    expect(canCast(engine, fs, cra, cra.spells.find(s => s.spellId === IMMOBILISATION)!, near.cell)).toBe('range')
    // Durée 1 : fin au tour suivant du Crâ ; le niveau non modifié est rendu tel quel.
    turnOf(engine, fs, cra)
    expect(cra.spellMods).toBeUndefined()
    expect(modifiedSpellLevel(cra, lvl)).toBe(lvl)
  })

  it('Acuité Absolue : 289 sur le sort 0 = ligne de vue désactivée pour tous les sorts', () => {
    const { engine, fs, cra } = craFight()
    const known = cra.spells.find(s => s.spellId === IMMOBILISATION)!
    // Cible à 5 cases, derrière A (case 8,0) qui bloque la ligne de vue (Acuité ajoute aussi +3 de portée minimale).
    const far = engine.spawn(fs, player({ name: 'Loin', breedId: 8, spellIds: [], team: 1, cell: cellAt(10, 0) }))
    expect(canCast(engine, fs, cra, known, far.cell)).toBe('los')
    expect(castSpell(engine, fs, cra, ACUITE, cra.cell).ok).toBe(true)
    expect(modifiedSpellLevel(cra, known.level).castTestLos).toBe(false)
    expect(canCast(engine, fs, cra, known, far.cell)).toBeNull()
  })

  it('Flèche de Rédemption : +6 dégâts de base par retrait réussi (CMPAS ⇒ 32462 rang 2), remis à zéro par 1406', () => {
    const engine = newEngine()
    const cra = player({ name: 'Crâ', breedId: 9, spellIds: [IMMOBILISATION, REDEMPTION], cell: cellAt(5, 0), stats: { initiative: 1000, mpReduction: 100000, ap: 40 } })
    const foe = player({ name: 'Cible', breedId: 8, spellIds: [], team: 1, cell: cellAt(10, 0), stats: { mpParry: 1 } })
    const fs = fight(engine, [cra, foe], { seed: 9 })
    turnOf(engine, fs, cra)
    // Le 293 du sort principal est purement visuel : aucun bonus sans retrait réussi.
    expect(castSpell(engine, fs, cra, REDEMPTION, foe.cell).ok).toBe(true)
    expect(spellBaseDamageBonus(cra, REDEMPTION)).toBe(0)
    // Écouteur (rang 1, normalement posé par le passif de classe) puis retraits de PM réussis (vol 77, 90 %/point).
    expect(castSubSpell(engine, fs, cra, REDEMPTION_BONUS, 1, cra.cell, false, 0)).toBe(true)
    let successes = 0
    for (let i = 0; i < 3; i++) {
      const before = fs.metrics[cra.id].mpRemoved
      expect(castSpell(engine, fs, cra, IMMOBILISATION, foe.cell).ok).toBe(true)
      if (fs.metrics[cra.id].mpRemoved > before) successes++
      cra.castsOnTarget = {}
    }
    expect(successes).toBeGreaterThan(0)
    expect(spellBaseDamageBonus(cra, REDEMPTION)).toBe(6 * successes)
    // Utilisation du sort : 1406 retire les effets du rang 2 de 32462 ⇒ bonus remis à zéro.
    cra.castsThisTurn = {}
    expect(castSpell(engine, fs, cra, REDEMPTION, foe.cell).ok).toBe(true)
    expect(spellBaseDamageBonus(cra, REDEMPTION)).toBe(0)
  })

  it('coût en PA (285), lancers par tour (290) et relances (1045 / 1036)', () => {
    const { engine, fs, cra, a } = craFight()
    const known = cra.spells.find(s => s.spellId === IMMOBILISATION)!
    apply(engine, fs, cra, cra, [
      effect(285, { diceNum: IMMOBILISATION, value: 1, duration: 1, targetMask: 'C' }),
      effect(290, { diceNum: IMMOBILISATION, value: 2, duration: 1, targetMask: 'C' }),
    ])
    const m = modifiedSpellLevel(cra, known.level)
    expect(m.apCost).toBe(known.level.apCost - 1)
    expect(m.maxCastPerTurn).toBe(known.level.maxCastPerTurn + 2)
    const ap = cra.ap
    expect(castSpell(engine, fs, cra, IMMOBILISATION, a.cell).ok).toBe(true)
    expect(cra.ap).toBe(ap - m.apCost)
    cra.cooldowns[TIRS_ELOIGNES] = 5
    apply(engine, fs, cra, cra, [effect(1045, { diceNum: TIRS_ELOIGNES, value: 1, targetMask: 'C' })])
    expect(cra.cooldowns[TIRS_ELOIGNES]).toBe(1)
    cra.cooldowns[ACUITE] = 4
    apply(engine, fs, cra, cra, [effect(1036, { diceNum: ACUITE, value: 3, targetMask: 'C' })])
    expect(cra.cooldowns[ACUITE]).toBe(1)
  })
})

describe('états', () => {
  function duel() {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: 4, spellIds: [INVISIBILITE], cell: cellAt(5, 0), stats: { initiative: 1000 } })
    const b = player({ name: 'B', breedId: 8, spellIds: [], team: 1, cell: cellAt(9, 0), stats: { initiative: 10 } })
    const fs = fight(engine, [a, b])
    turnOf(engine, fs, a)
    return { engine, fs, a, b }
  }

  it('Invisibilité (Sram) : état 250 + déclencheur ION, +2 PM utilisables tout de suite', () => {
    const { engine, fs, a } = duel()
    apply(engine, fs, a, a, [effect(950, { triggers: 'ION', value: 74, duration: 1, triggerDuration: 1, targetMask: 'a' })])
    expect(castSpell(engine, fs, a, INVISIBILITE, a.cell).ok).toBe(true)
    expect(a.states).toContain(250)
    expect(a.states).toContain(74)
    expect(a.stats.mp).toBe(8)
    expect(a.mp).toBe(8)
    turnOf(engine, fs, a)
    expect(a.states).not.toContain(250)
  })

  it('950 / 951 : pose (drapeaux de data.state), rafraîchissement sans empilement, retrait', () => {
    const { engine, fs, a, b } = duel()
    apply(engine, fs, a, b, [effect(950, { value: 6, duration: 2 })]) // Enraciné
    apply(engine, fs, a, b, [effect(950, { value: 6, duration: 1 })])
    expect(b.buffs.filter(x => x.stateId === 6)).toHaveLength(1)
    expect(b.buffs[0].remaining).toBe(2)
    expect(engine.stateFlag(b, 'cantBePushed')).toBe(true)
    apply(engine, fs, a, b, [effect(951, { value: 6 })])
    expect(b.states).not.toContain(6)
    expect(fs.events.filter(e => e.t === 'state' && e.stateId === 6).map(e => (e as { added: boolean }).added)).toEqual([true, false])
  })

  it('952 : l’état reste présent (masques, conditions) mais ses drapeaux sont neutralisés', () => {
    const { engine, fs, a, b } = duel()
    apply(engine, fs, a, b, [effect(950, { value: 6, duration: -1 })])
    apply(engine, fs, a, b, [effect(952, { value: 6, duration: 1 })])
    expect(b.states).toContain(6)
    expect(engine.stateFlag(b, 'cantBePushed')).toBe(false)
    turnOf(engine, fs, a)
    expect(engine.stateFlag(b, 'cantBePushed')).toBe(true)
  })

  it('140 « Tour annulé » : la cible commence puis termine aussitôt son tour, tant que le buff dure', () => {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: 8, spellIds: [], cell: cellAt(5, 0), stats: { initiative: 1000 } })
    const b = player({ name: 'B', breedId: 8, spellIds: [], team: 1, cell: cellAt(9, 0), stats: { initiative: 500 } })
    const c = player({ name: 'C', breedId: 8, spellIds: [], cell: cellAt(2, 0), stats: { initiative: 100 } })
    const fs = fight(engine, [a, b, c])
    turnOf(engine, fs, a)
    expect(fs.timeline.map(id => fs.fighters[id].name)).toEqual(['A', 'B', 'C'])
    apply(engine, fs, a, b, [effect(140, { duration: 1 })])
    expect(engine.passesTurn(b)).toBe(true)
    const before = fs.events.length
    expect(next(engine, fs)?.name).toBe('C')
    const evs = fs.events.slice(before)
    expect(evs.some(e => e.t === 'turnStart' && e.fighter === b.id)).toBe(true)
    expect(evs.some(e => e.t === 'turnEnd' && e.fighter === b.id)).toBe(true)
    expect(next(engine, fs)?.name).toBe('A') // début du tour de A : fin du buff
    expect(engine.passesTurn(b)).toBe(false)
    expect(next(engine, fs)?.name).toBe('B')
  })

  it('2188 : comportement d’IA stocké dans les tags', () => {
    const { engine, fs, a } = duel()
    apply(engine, fs, a, a, [effect(2188, { diceNum: 6, duration: -1, targetMask: 'C' })])
    expect(a.tags.aiBehaviour).toBe(6)
  })
})

describe('désenvoûtements', () => {
  function buffed() {
    const engine = newEngine()
    const a = player({ name: 'A', breedId: 8, spellIds: [], cell: cellAt(5, 0), stats: { initiative: 1000 } })
    const b = player({ name: 'B', breedId: 8, spellIds: [], team: 1, cell: cellAt(9, 0), stats: { initiative: 10 } })
    const fs = fight(engine, [a, b])
    turnOf(engine, fs, a)
    apply(engine, fs, a, b, [
      effect(138, { diceNum: 100, duration: 3, dispellable: 1 }),
      effect(118, { diceNum: 50, duration: 1, dispellable: 1 }),
      effect(126, { diceNum: 70, duration: -1, dispellable: 1 }),
      effect(119, { diceNum: 80, duration: 3, dispellable: 2 }),
      effect(123, { diceNum: 90, duration: 3, dispellable: 3 }),
    ])
    // Déclencheur DIS : état 74 au porteur.
    apply(engine, fs, b, b, [effect(950, { triggers: 'DIS', value: 74, duration: 1, triggerDuration: 3, targetMask: 'a', dispellable: 4 })])
    return { engine, fs, a, b }
  }

  it('132 : retire tous les buffs dispellable 1 (pas 2/3/4), puis DIS', () => {
    const { engine, fs, a, b } = buffed()
    apply(engine, fs, a, b, [effect(132)])
    expect(b.stats.power).toBe(0)
    expect(b.stats.strength).toBe(0)
    expect(b.stats.intelligence).toBe(0)
    expect(b.stats.agility).toBe(80)
    expect(b.stats.chance).toBe(90)
    expect(b.states).toContain(74)
  })

  it('1075 −2 : durées réduites, buffs à 0 retirés, permanents et non désenvoûtables intacts', () => {
    const { engine, fs, a, b } = buffed()
    apply(engine, fs, a, b, [effect(1075, { diceNum: 2 })])
    expect(b.buffs.find(x => x.effect.effectId === 138)!.remaining).toBe(1)
    expect(b.stats.strength).toBe(0) // 1 tour − 2 ⇒ retiré
    expect(b.stats.intelligence).toBe(70) // permanent
    expect(b.buffs.find(x => x.effect.effectId === 119)!.remaining).toBe(3)
    expect(b.buffs.find(x => x.effect.effectId === 123)!.remaining).toBe(3)
    expect(b.states).toContain(74)
  })

  it('406 / 1406 : retrait des effets d’un sort (quelle que soit la désenvoûtabilité), d’un rang', () => {
    const { engine, fs, a, b } = buffed()
    apply(engine, fs, a, b, [effect(406, { value: 999001 })])
    expect(b.buffs.filter(x => x.spellId === 999001)).toEqual([])
    expect(b.states).not.toContain(74) // retrait ciblé : pas de déclencheur DIS
    // 1406 : rang réel (Flèche d'Immobilisation, rang 3 de la donnée ; rang 1 inexistant sur la cible).
    const lvl = data().spellLevel(IMMOBILISATION, { playerLevel: 200 })!
    const e293 = lvl.effects.find(e => e.effectId === 293)!
    const fake = { ...e293, diceNum: 4242, targetMask: 'a,A' }
    apply(engine, fs, a, b, [fake], IMMOBILISATION)
    expect(spellBaseDamageBonus(b, 4242)).toBe(e293.value)
    apply(engine, fs, a, b, [effect(1406, { value: IMMOBILISATION, diceSide: lvl.grade === 1 ? 2 : 1 })])
    expect(spellBaseDamageBonus(b, 4242)).toBe(e293.value)
    apply(engine, fs, a, b, [effect(1406, { value: IMMOBILISATION, diceSide: lvl.grade })])
    expect(spellBaseDamageBonus(b, 4242)).toBe(0)
  })
})
