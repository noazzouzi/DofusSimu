/**
 * Famille « invocations » (src/engine/effects/summons.ts) avec des sorts réels : Osamodas (Tofu), Sadida (Arbre,
 * Puissance Sylvestre), Steamer (Harponneuse), Roublard (Explobombe), Sram (Double).
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { registerEffect } from '../src/engine/effects/registry'
import { availableSummonSlots, comparePositions, summonOptions } from '../src/engine/effects/summons'
import { applyEffects, usedSummonSlots } from '../src/engine/effects/core'
import type { FightEvent } from '../src/engine/types'
import { cellAt, data, effect, fight, has, monster, newEngine, player, turnOf } from './effects-summons-helpers'

const OSAMODAS = 2
const SRAM = 4
const SADIDA = 10
const ROUBLARD = 13
const STEAMER = 15

const summonEvents = (evs: FightEvent[]) => evs.filter((e): e is Extract<FightEvent, { t: 'summon' }> => e.t === 'summon')

describe('181 — Tofu (Osamodas 31115)', () => {
  const setup = () => {
    const engine = newEngine()
    const osa = player({
      name: 'Osa',
      breedId: OSAMODAS,
      spellIds: [31115],
      cell: cellAt(10, 0),
      hp: 3000,
      stats: { agility: 400, wisdom: 200, tackleEvade: 40, airDamage: 30, summons: 1, initiative: 5000 },
    })
    const enemy = monster(3834, cellAt(16, 0), { grade: 1 })
    const fs = fight(engine, [osa, enemy])
    turnOf(engine, fs, osa)
    return { engine, fs, osa, enemy }
  }

  it("invoque le Tofu sur la case ciblée avec la part des caractéristiques de l'invocateur", () => {
    const { engine, fs, osa } = setup()
    const target = cellAt(11, 0)
    expect(castSpell(engine, fs, osa, 31115, target).ok).toBe(true)
    const tofu = fs.fighters.find(f => f.monsterId === 8070)!
    expect(tofu).toBeDefined()
    expect(tofu.kind).toBe('summon')
    expect(tofu.summonerId).toBe(osa.id)
    expect(tofu.team).toBe(osa.team)
    expect(tofu.cell).toBe(target)
    // Grade 3 : 4 PA / 8 PM ; summonerShare : 50 % des PV, Sagesse, Agilité, Fuite, Dommages Air.
    expect(tofu.stats.ap).toBe(4)
    expect(tofu.stats.mp).toBe(8)
    expect(tofu.maxHp).toBe(1500)
    expect(tofu.stats.agility).toBe(200)
    expect(tofu.stats.wisdom).toBe(100)
    expect(tofu.stats.airDamage).toBe(15)
    expect(tofu.tags.summonCost).toBe(1)
    // Événement de replay et place dans la timeline (juste après l'invocateur).
    const ev = summonEvents(fs.events)
    expect(ev).toHaveLength(1)
    expect(ev[0].summoner).toBe(osa.id)
    expect(ev[0].fighter.id).toBe(tofu.id)
    expect(fs.timeline[fs.timeline.indexOf(osa.id) + 1]).toBe(tofu.id)
    // Sort de départ 31971 : Intacleur (95) + Intaclable (96).
    if (has(950)) expect(tofu.states).toEqual(expect.arrayContaining([95, 96]))
  })

  it("respecte la limite d'invocations (points d'invocation = summonCost)", () => {
    const { engine, fs, osa } = setup()
    expect(castSpell(engine, fs, osa, 31115, cellAt(11, 0)).ok).toBe(true)
    expect(usedSummonSlots(fs, osa)).toBe(1)
    expect(availableSummonSlots(fs, osa)).toBe(0)
    osa.cooldowns = {}
    expect(castSpell(engine, fs, osa, 31115, cellAt(10, 1)).ok).toBe(true)
    expect(fs.fighters.filter(f => f.monsterId === 8070)).toHaveLength(1)
    // Une invocation de plus autorisée : la deuxième est insérée après la première.
    osa.baseStats.summons = 2
    engine.recomputeStats(osa)
    osa.cooldowns = {}
    expect(castSpell(engine, fs, osa, 31115, cellAt(10, 1)).ok).toBe(true)
    const tofus = fs.fighters.filter(f => f.monsterId === 8070)
    expect(tofus).toHaveLength(2)
    const i = fs.timeline.indexOf(osa.id)
    expect(fs.timeline.slice(i + 1, i + 3)).toEqual([tofus[0].id, tofus[1].id])
  })

  it("déclenche « CI » (le porteur invoque) sur l'invocateur", () => {
    const { engine, fs, osa } = setup()
    let fired = 0
    registerEffect(990001, 'test', () => fired++, true)
    engine.addBuff(fs, osa, {
      sourceId: osa.id,
      spellId: 0,
      effect: effect(990001, { triggers: 'CI', targetMask: 'C' }),
      value: 0,
      remaining: -1,
      delay: 0,
      dispellable: false,
      triggers: 'CI',
      kind: 'trigger',
      label: 'test CI',
    })
    castSpell(engine, fs, osa, 31115, cellAt(11, 0))
    expect(fired).toBe(1)
  })

  it("joue juste après son invocateur et meurt avec lui", () => {
    const { engine, fs, osa } = setup()
    castSpell(engine, fs, osa, 31115, cellAt(11, 0))
    const tofu = fs.fighters.find(f => f.monsterId === 8070)!
    engine.endTurn(fs, osa)
    expect(engine.nextTurn(fs)?.id).toBe(tofu.id)
    engine.kill(fs, osa)
    expect(tofu.alive).toBe(false)
  })

  it('refuse une case occupée', () => {
    const { engine, fs, osa, enemy } = setup()
    enemy.cell = cellAt(11, 0)
    castSpell(engine, fs, osa, 31115, cellAt(11, 0))
    expect(fs.fighters.some(f => f.monsterId === 8070)).toBe(false)
  })
})

describe('181 / 2796 — Sadida (Arbre 13519, Puissance Sylvestre 13530)', () => {
  it("l'Arbre (statique, sans emplacement) a 60 % des PV du Sadida et ne compte pas dans la limite", () => {
    const engine = newEngine()
    const sadi = player({ name: 'Sadi', breedId: SADIDA, spellIds: [13519, 13530], cell: cellAt(10, 0), hp: 4000, stats: { summons: 0, initiative: 5000 } })
    const enemy = monster(3834, cellAt(18, 0))
    const fs = fight(engine, [sadi, enemy])
    turnOf(engine, fs, sadi)
    expect(castSpell(engine, fs, sadi, 13519, cellAt(12, 0)).ok).toBe(true)
    expect(castSpell(engine, fs, sadi, 13519, cellAt(10, 2)).ok).toBe(true)
    const trees = fs.fighters.filter(f => f.monsterId === 5894)
    expect(trees).toHaveLength(2)
    for (const t of trees) {
      expect(t.maxHp).toBe(2400)
      expect(t.tags.canPlay).toBe(false)
      expect(t.tags.summonCost).toBe(0)
    }
    expect(usedSummonSlots(fs, sadi)).toBe(0)
  })

  it('2796 tue un arbre Feuillu et le remplace par une Groute contrôlable', () => {
    const engine = newEngine()
    const sadi = player({ name: 'Sadi', breedId: SADIDA, spellIds: [13519, 13530], cell: cellAt(10, 0), hp: 4000, stats: { summons: 0, initiative: 5000 } })
    const enemy = monster(3834, cellAt(18, 0))
    const fs = fight(engine, [sadi, enemy])
    turnOf(engine, fs, sadi)
    castSpell(engine, fs, sadi, 13519, cellAt(12, 0))
    const tree = fs.fighters.find(f => f.monsterId === 5894)!
    // Feuillu (256) : posé côté serveur un tour après la pose ; posé ici directement.
    engine.addBuff(fs, tree, { sourceId: sadi.id, spellId: 13519, effect: effect(950, { value: 256 }), value: 256, remaining: -1, delay: 0, dispellable: false, stateId: 256, kind: 'stat', label: 'Feuillu' })
    expect(castSpell(engine, fs, sadi, 13530, tree.cell).ok).toBe(true)
    expect(tree.alive).toBe(false)
    const groute = fs.fighters.find(f => f.monsterId === 5901)!
    expect(groute).toBeDefined()
    expect(groute.alive).toBe(true)
    expect(groute.cell).toBe(cellAt(12, 0))
    expect(groute.summonerId).toBe(sadi.id)
    expect(groute.tags.controllable).toBe(true)
  })
})

describe('181 — tourelle Steamer (Harponneuse 13829)', () => {
  it('180 % des PV et 100 % des caractéristiques du Steamer, hors limite, après le Steamer', () => {
    const engine = newEngine()
    const steam = player({
      name: 'Steam',
      breedId: STEAMER,
      spellIds: [13829],
      cell: cellAt(10, 0),
      hp: 3500,
      stats: { strength: 800, intelligence: 100, chance: 50, agility: 20, wisdom: 300, tackleBlock: 30, fireDamage: 40, summons: 0, initiative: 5000 },
    })
    const enemy = monster(3834, cellAt(18, 0))
    const fs = fight(engine, [steam, enemy])
    turnOf(engine, fs, steam)
    expect(castSpell(engine, fs, steam, 13829, cellAt(13, 0)).ok).toBe(true)
    const t = fs.fighters.find(f => f.monsterId === 5836)!
    expect(t).toBeDefined()
    expect(t.maxHp).toBe(6300)
    expect(t.stats.strength).toBe(800)
    expect(t.stats.intelligence).toBe(100)
    expect(t.stats.wisdom).toBe(300)
    expect(t.stats.fireDamage).toBe(40)
    expect(t.stats.ap).toBe(6)
    expect(t.stats.mp).toBe(0)
    expect(t.tags.summonCost).toBe(0)
    expect(fs.timeline[fs.timeline.indexOf(steam.id) + 1]).toBe(t.id)
  })
})

describe('1008 — bombe Roublard (Explobombe 13444)', () => {
  const setup = (maxBombs?: number) => {
    const engine = newEngine()
    const roub = player({ name: 'Roub', breedId: ROUBLARD, spellIds: [13444], cell: cellAt(10, 0), hp: 3000, stats: { intelligence: 500, fireDamage: 25, summons: 1, initiative: 5000 } })
    if (maxBombs !== undefined) roub.tags.maxBombs = maxBombs
    const enemy = monster(3834, cellAt(18, 0))
    const fs = fight(engine, [roub, enemy])
    turnOf(engine, fs, roub)
    return { engine, fs, roub, enemy }
  }

  it('pose une bombe statique (90 % des PV + 10 vitalité, 100 % Intelligence) sur emplacement de bombe', () => {
    const { engine, fs, roub } = setup()
    expect(castSpell(engine, fs, roub, 13444, cellAt(12, 0)).ok).toBe(true)
    const bomb = fs.fighters.find(f => f.monsterId === 3112)!
    expect(bomb).toBeDefined()
    expect(bomb.kind).toBe('summon')
    expect(bomb.maxHp).toBe(2710)
    expect(bomb.stats.intelligence).toBe(500)
    expect(bomb.stats.fireDamage).toBe(25)
    expect(bomb.tags.canPlay).toBe(false)
    expect(bomb.tags.bombSlot).toBe(true)
    expect(bomb.tags.summonCost).toBe(0)
    expect(usedSummonSlots(fs, roub)).toBe(0)
  })

  it('limite le nombre de bombes (tags.maxBombs)', () => {
    const { engine, fs, roub } = setup(1)
    castSpell(engine, fs, roub, 13444, cellAt(12, 0))
    roub.castsThisTurn = {}
    roub.ap = 12
    castSpell(engine, fs, roub, 13444, cellAt(10, 2))
    expect(fs.fighters.filter(f => f.monsterId === 3112)).toHaveLength(1)
  })

  it("sur une entité : pas d'invocation (sort « sur entité » de la bombe à la place)", () => {
    const { engine, fs, roub, enemy } = setup()
    enemy.cell = cellAt(12, 0)
    castSpell(engine, fs, roub, 13444, enemy.cell)
    expect(fs.fighters.some(f => f.monsterId === 3112)).toBe(false)
  })
})

describe('180 — Double (Sram 12915)', () => {
  it('invoque une copie du lanceur ; les effets « U » visent le double apparu', () => {
    const engine = newEngine()
    const sram = player({ name: 'Sram', breedId: SRAM, spellIds: [12915], cell: cellAt(10, 0), hp: 2800, stats: { agility: 700, summons: 1, initiative: 5000 } })
    const enemy = monster(3834, cellAt(18, 0))
    const fs = fight(engine, [sram, enemy])
    turnOf(engine, fs, sram)
    sram.hp = 2000
    const target = cellAt(11, 0)
    expect(castSpell(engine, fs, sram, 12915, target).ok).toBe(true)
    const dbl = fs.fighters.find(f => f.tags.double === true)!
    expect(dbl).toBeDefined()
    expect(dbl.cell).toBe(target)
    expect(dbl.breedId).toBe(SRAM)
    expect(dbl.monsterId).toBeUndefined()
    expect(dbl.summonerId).toBe(sram.id)
    expect(dbl.stats.agility).toBe(sram.stats.agility)
    expect(dbl.hp).toBe(2000)
    expect(usedSummonSlots(fs, sram)).toBe(1)
    if (has(950)) {
      // 950 état 1486 « a,U » (zone P1) : posé sur le double qui vient d'apparaître.
      expect(dbl.states).toContain(1486)
      expect(sram.states).not.toContain(1486)
    }
  })

  it('pas de double pour une invocation', () => {
    const engine = newEngine()
    const sram = player({ name: 'Sram', breedId: SRAM, spellIds: [12915], cell: cellAt(10, 0), stats: { summons: 2, initiative: 5000 } })
    const enemy = monster(3834, cellAt(18, 0))
    const fs = fight(engine, [sram, enemy])
    turnOf(engine, fs, sram)
    castSpell(engine, fs, sram, 12915, cellAt(11, 0))
    const dbl = fs.fighters.find(f => f.tags.double === true)!
    dbl.spells = sram.spells
    const before = fs.fighters.length
    dbl.ap = 12
    castSpell(engine, fs, dbl, 12915, cellAt(12, 0))
    expect(fs.fighters.length).toBe(before)
  })
})

describe('outils', () => {
  it("comparePositions : distance croissante puis sens horaire à partir du nord-est (port)", () => {
    const ref = cellAt(10, 0)
    const ring = [cellAt(11, 0), cellAt(10, 1), cellAt(9, 0), cellAt(10, -1)]
    const sorted = ring.slice().sort((a, b) => comparePositions(ref, a, b))
    // lookDirection8 : (+1,0) = 1 (SE), (0,+1) = 7 (NE), (−1,0) = 5 (NW), (0,−1) = 3 (SW) ⇒ ordre (dir+1)%8 : 7, 1, 3, 5.
    expect(sorted).toEqual([cellAt(10, 1), cellAt(11, 0), cellAt(10, -1), cellAt(9, 0)])
    expect(comparePositions(ref, cellAt(12, 0), cellAt(11, 0))).toBeGreaterThan(0)
    expect(summonOptions.reviveAllInArea).toBe(true)
    expect(data().monster(8070)?.summonCost).toBe(1)
  })
})

describe('1097 — illusions (Roublardise)', () => {
  it('crée les illusions sur les 3 autres axes et téléporte le lanceur sur la case ciblée', () => {
    const engine = newEngine()
    const roub = player({ name: 'Roub', breedId: ROUBLARD, spellIds: [], cell: cellAt(10, 0), stats: { initiative: 5000 } })
    const enemy = monster(3834, cellAt(18, 5))
    const fs = fight(engine, [roub, enemy])
    turnOf(engine, fs, roub)
    applyEffects(engine, fs, roub, null, 13431, [effect(1097, { diceNum: 3 })], cellAt(12, 0), roub.cell, false, false, 0)
    expect(roub.cell).toBe(cellAt(12, 0))
    const ill = fs.fighters.filter(f => f.tags.illusion === true)
    expect(ill.map(f => f.cell).sort((a, b) => a - b)).toEqual([cellAt(10, -2), cellAt(8, 0), cellAt(10, 2)].sort((a, b) => a - b))
    for (const f of ill) {
      expect(f.maxHp).toBe(1)
      expect(f.summonerId).toBe(roub.id)
    }
    expect(usedSummonSlots(fs, roub)).toBe(0)
  })
})

describe('780 / 1034 — résurrection hors Vortex', () => {
  const setup = () => {
    const engine = newEngine()
    const healer = monster(3836, cellAt(10, 0), { grade: 1, initiative: 9000 })
    const ally = monster(3834, cellAt(12, 0), { grade: 1 })
    const enemy = player({ name: 'P', breedId: 8, spellIds: [], cell: cellAt(16, 0) })
    const fs = fight(engine, [healer, ally, enemy], { rollMode: 'average' })
    turnOf(engine, fs, healer)
    return { engine, fs, healer, ally, enemy }
  }

  it('780 : le dernier allié mort revient sur sa case de mort (sinon la case ciblée) avec #1 % de ses PV', () => {
    const { engine, fs, healer, ally, enemy } = setup()
    engine.kill(fs, ally, enemy)
    applyEffects(engine, fs, healer, null, 0, [effect(780, { diceNum: 50 })], cellAt(11, 3), healer.cell, false, false, 0)
    expect(ally.alive).toBe(true)
    expect(ally.cell).toBe(cellAt(12, 0))
    expect(ally.hp).toBe(Math.floor(ally.maxHp / 2))
    expect(ally.summonerId).toBeUndefined()
    // Mort de nouveau, case occupée : case ciblée.
    engine.kill(fs, ally, enemy)
    enemy.cell = cellAt(12, 0)
    applyEffects(engine, fs, healer, null, 0, [effect(780, { diceNum: 50 })], cellAt(11, 3), healer.cell, false, false, 0)
    expect(ally.cell).toBe(cellAt(11, 3))
    // Aucun ennemi n'est ressuscité.
    engine.kill(fs, enemy, healer)
    expect(fs.ended).toBe(true)
  })

  it('1034 : un monstre mort revient comme invocation du même monstre', () => {
    const { engine, fs, healer, ally, enemy } = setup()
    engine.kill(fs, ally, enemy)
    applyEffects(engine, fs, healer, null, 0, [effect(1034, { diceNum: 25 })], cellAt(11, 3), healer.cell, false, false, 0)
    const s = fs.fighters.find(f => f.alive && f.monsterId === 3834)!
    expect(s.id).not.toBe(ally.id)
    expect(s.summonerId).toBe(healer.id)
    // Nouvelle invocation : sur la case ciblée (port `Summon` : `TargetedCell`), pas sur la case de mort.
    expect(s.cell).toBe(cellAt(11, 3))
    expect(s.hp).toBe(Math.floor(s.maxHp / 4))
    // Le cadavre est consommé : un second 1034 n'en refait pas une copie.
    applyEffects(engine, fs, healer, null, 0, [effect(1034, { diceNum: 25 })], cellAt(11, 4), healer.cell, false, false, 0)
    expect(fs.fighters.filter(f => f.alive && f.monsterId === 3834)).toHaveLength(1)
  })
})
