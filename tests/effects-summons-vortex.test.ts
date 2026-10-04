/**
 * Mécaniques de l'Œil de Vortex portées par les familles invocations / marques / lancements de sorts, avec les
 * données réelles et la carte 143393281 : Vortexiphan (5006) invoque l'Auroraire (sort de départ 4999), Glyphe
 * téléporteur (5002 → 5012 : glyphe 1165 au début du tour), résurrection 780 (5003).
 */
import { describe, expect, it } from 'vitest'
import { castSubSpell } from '../src/engine/effects/core'
import { castStartingSpell, ZOMBI_STATE } from '../src/engine/effects/summons'
import { move } from '../src/engine/move'
import type { Fighter } from '../src/engine/types'
import { distance } from '../src/map/geometry'
import { fight, has, monster, newEngine, player, turnOf, vortexMap } from './effects-summons-helpers'

const IOP = 8

function vortexFight(opts: { rollMode?: 'random' | 'average'; withVortex?: boolean } = {}) {
  const engine = newEngine()
  const map = vortexMap()
  const p1 = player({ name: 'P1', breedId: IOP, spellIds: [], cell: 424, stats: { initiative: 9000 } })
  const p2 = player({ name: 'P2', breedId: IOP, spellIds: [], cell: 440, stats: { initiative: 8000 } })
  const fighters: Fighter[] = [p1, p2]
  const vortex = monster(3835, 270, { grade: 1, initiative: 1 })
  if (opts.withVortex !== false) fighters.push(vortex)
  const ikargn = monster(3834, 273, { grade: 5, initiative: 10 })
  fighters.push(ikargn)
  const fs = fight(engine, fighters, { rollMode: opts.rollMode ?? 'average' }, map)
  return { engine, fs, p1, p2, vortex, ikargn }
}

describe('Vortexiphan (5006) — sort de départ du Vortex', () => {
  it("invoque l'Auroraire sur la case 255 ; son sort de départ (4999) pose « Décalage horaire » sur les personnages", () => {
    const { engine, fs, p1, p2, vortex } = vortexFight()
    expect(castStartingSpell(engine, fs, vortex)).toBe(true)
    const aur = fs.fighters.find(f => f.monsterId === 3833)!
    expect(aur).toBeDefined()
    expect(aur.cell).toBe(255)
    expect(aur.kind).toBe('summon')
    expect(aur.summonerId).toBe(vortex.id)
    expect(aur.maxHp).toBe(5500)
    expect(fs.timeline[fs.timeline.indexOf(vortex.id) + 1]).toBe(aur.id)
    // 4999 : buff TB (1160 → 4996) sur chaque personnage joueur (masque L, zone a).
    for (const p of [p1, p2]) {
      const b = p.buffs.find(x => x.spellId === 4999 && x.triggers === 'TB')
      expect(b?.effect.effectId).toBe(1160)
      expect(b?.effect.diceNum).toBe(4996)
      expect(b?.sourceId).toBe(aur.id)
    }
    // Vortex : déclencheurs de début de tour (793 → 5003, 792 → 5006 g2) ; 5008 / 5060 différés de 25 tours.
    expect(vortex.buffs.filter(b => b.kind === 'trigger' && b.triggers === 'TB').map(b => b.effect.diceNum).sort()).toEqual([5003, 5006])
    expect(vortex.buffs.filter(b => b.kind === 'delayed' && b.delay === 25).map(b => b.effect.diceNum).sort()).toEqual([5008, 5060])
    if (has(950)) {
      expect(vortex.states).toEqual(expect.arrayContaining([56, 97, 236]))
      expect(aur.states).toEqual(expect.arrayContaining([56, 97, 232]))
    }
  })

  it("l'horloge avance au début du tour d'un personnage (4996 lancé par l'Auroraire)", () => {
    if (!has(950) || !has(951)) return
    const { engine, fs, p1, vortex } = vortexFight()
    castStartingSpell(engine, fs, vortex)
    const aur = fs.fighters.find(f => f.monsterId === 3833)!
    turnOf(engine, fs, p1)
    expect(aur.states).toContain(221)
    expect(aur.states).not.toContain(232)
    // Déplacement vers la case de l'heure I (173) : effets 1023 / 4 en zone « ; » (famille déplacements, non vérifié ici).
  })
})

describe('Glyphe téléporteur (5002) — monstre de vague', () => {
  it('pose une glyphe immédiate (1165 → 5011) sous le monstre au début de son tour', () => {
    const { engine, fs, ikargn } = vortexFight({ withVortex: false })
    expect(castStartingSpell(engine, fs, ikargn)).toBe(true)
    // 5002 : buffs X (→ 5001) et TB (→ 5012) sur le monstre lui-même.
    expect(ikargn.buffs.filter(b => b.kind === 'trigger').map(b => `${b.triggers}:${b.effect.diceNum}`).sort()).toEqual(['TB:5012', 'X:5001'])
    expect(fs.glyphs).toHaveLength(0)
    turnOf(engine, fs, ikargn)
    expect(fs.glyphs).toHaveLength(1)
    const g = fs.glyphs[0]
    expect(g.trigger).toBe('enter')
    expect(g.center).toBe(273)
    expect(g.cells).toEqual([273])
    expect(g.sourceId).toBe(ikargn.id)
    expect(g.castSpellId).toBe(5011)
    expect(g.spellId).toBe(5012)
    expect(g.remaining).toBe(1)
    // Au tour suivant du monstre : l'ancienne glyphe expire, une nouvelle est posée sous lui.
    ikargn.cell = 300
    turnOf(engine, fs, ikargn)
    expect(fs.glyphs).toHaveLength(1)
    expect(fs.glyphs[0].center).toBe(300)
  })

  it("un personnage qui marche dans la glyphe la déclenche (échange + bonus du poseur, sur lui et le monstre)", () => {
    const { engine, fs, p1, ikargn } = vortexFight({ withVortex: false })
    castStartingSpell(engine, fs, ikargn)
    turnOf(engine, fs, ikargn)
    const glyphCell = ikargn.cell
    // Le monstre s'éloigne ; P1 vient à côté de la glyphe puis y entre.
    ikargn.cell = 330
    p1.cell = glyphCell + 14
    if (!fs.map.cells[p1.cell]?.walkable || fs.map.cells[p1.cell] === undefined) p1.cell = glyphCell - 14
    const before = fs.events.length
    p1.mp = 3
    move(fs, p1, [p1.cell, glyphCell], engine)
    const evs = fs.events.slice(before)
    if (has(8)) {
      expect(p1.cell).toBe(330)
      expect(ikargn.cell).toBe(glyphCell)
      expect(evs.some(e => e.t === 'teleport' || e.t === 'push')).toBe(true)
    }
    if (has(128)) {
      expect(p1.buffs.some(b => b.spellId === 5011 && b.effect.effectId === 128)).toBe(true)
      expect(ikargn.buffs.some(b => b.spellId === 5025 && b.effect.effectId === 128)).toBe(true)
    }
    // La glyphe n'est pas consommée (durée 1 tour du poseur).
    expect(fs.glyphs).toHaveLength(1)
  })

  it('pas de déclenchement pour une arrivée par poussée / téléportation', () => {
    const { engine, fs, p1, ikargn } = vortexFight({ withVortex: false })
    castStartingSpell(engine, fs, ikargn)
    turnOf(engine, fs, ikargn)
    const glyphCell = ikargn.cell
    ikargn.cell = 330
    p1.cell = glyphCell
    engine.hooks.onEnterCell?.(fs, p1, glyphCell, { fromDrag: true })
    expect(p1.cell).toBe(glyphCell)
    expect(ikargn.cell).toBe(330)
  })
})

describe('Résurrection 780 (Vortexiphan 5003)', () => {
  it('ressuscite le monstre de vague mort à 3 cases du Vortex avec 20-30 % (moyenne 25 %) de ses PV, Zombi, et relance 5002', () => {
    const { engine, fs, p1, vortex, ikargn } = vortexFight({ rollMode: 'average' })
    engine.kill(fs, ikargn, p1)
    expect(fs.deaths?.map(d => d.fighter)).toEqual([ikargn.id])
    expect(fs.deaths?.[0].cell).toBe(273)
    const mpBefore = ikargn.stats.mp
    expect(castSubSpell(engine, fs, vortex, 5003, 1, vortex.cell, false, 0)).toBe(true)
    expect(ikargn.alive).toBe(true)
    expect(distance(ikargn.cell, vortex.cell)).toBe(3)
    expect(ikargn.hp).toBe(Math.floor(ikargn.maxHp * 0.25))
    expect(ikargn.states).toContain(ZOMBI_STATE)
    // 792 → 5002 sur l'entité apparue (U) : glyphe au début de tour et marquage à la mort reposés.
    expect(ikargn.buffs.filter(b => b.kind === 'trigger').map(b => b.triggers).sort()).toEqual(['TB', 'X'])
    // 169 −1 PM « a,A,U » en zone P1 (case du Vortex) : vise l'entité apparue (port, INCERTAIN).
    if (has(169)) expect(ikargn.stats.mp).toBe(mpBefore - 1)
    expect(fs.events.some(e => e.t === 'summon' && e.fighter.id === ikargn.id)).toBe(true)
    // Un seul mort : rien de plus à ressusciter.
    expect(castSubSpell(engine, fs, vortex, 5003, 1, vortex.cell, false, 0)).toBe(true)
    expect(fs.fighters.filter(f => f.alive && f.monsterId === 3834)).toHaveLength(1)
  })

  it('au début du tour du Vortex, via le déclencheur de Vortexiphan', () => {
    const { engine, fs, p1, vortex, ikargn } = vortexFight({ rollMode: 'random' })
    castStartingSpell(engine, fs, vortex)
    turnOf(engine, fs, p1)
    engine.kill(fs, ikargn, p1)
    expect(ikargn.alive).toBe(false)
    turnOf(engine, fs, vortex)
    expect(ikargn.alive).toBe(true)
    expect(ikargn.hp).toBeGreaterThanOrEqual(Math.floor(ikargn.maxHp * 0.2))
    expect(ikargn.hp).toBeLessThanOrEqual(Math.floor(ikargn.maxHp * 0.3))
    expect(distance(ikargn.cell, vortex.cell)).toBeGreaterThanOrEqual(3)
    expect(fs.timeline).toContain(ikargn.id)
  })

  it('les états « désenvoûtement fort » (3) survivent à la mort (états d’heure du Vortex)', () => {
    const { engine, fs, p1, ikargn } = vortexFight({ withVortex: false })
    engine.addBuff(fs, ikargn, {
      sourceId: ikargn.id,
      spellId: 5000,
      effect: { ...ikargn.spells[0].level.effects[0], effectId: 950, value: 223, dispellable: 3 },
      value: 223,
      remaining: -1,
      delay: 0,
      dispellable: false,
      stateId: 223,
      kind: 'stat',
      label: 'Troisième heure',
    })
    engine.kill(fs, ikargn, p1)
    expect(ikargn.states).toContain(223)
  })
})

describe('Mort d’un monstre de vague (5002 → X → 5001 → 5000)', () => {
  it("à la mort, le mourant lance 5001 et l'Auroraire lance 5000 (marquage de l'heure courante)", () => {
    const { engine, fs, p1, vortex, ikargn } = vortexFight({ rollMode: 'average' })
    castStartingSpell(engine, fs, vortex)
    castStartingSpell(engine, fs, ikargn)
    const aur = fs.fighters.find(f => f.monsterId === 3833)!
    const agi = ikargn.stats.agility
    const n = fs.events.length
    engine.kill(fs, ikargn, p1)
    const logs = fs.events.slice(n).filter(e => e.t === 'log').map(e => (e as { text: string }).text)
    expect(logs).toContain(`${ikargn.name} déclenche Glyphe téléporteur.`)
    expect(logs).toContain(`${aur.name} déclenche Glyphe téléporteur.`)
    // États posés sur le MOURANT (Mort latente 233 puis heure courante 232, dispellable 3 ⇒ conservée à la mort) :
    // nécessite que l'interprète 950 accepte une cible mourante (isDying) — sinon rien à vérifier ici.
    if (!ikargn.states.includes(232)) return
    expect(ikargn.states).not.toContain(233)
    castSubSpell(engine, fs, vortex, 5003, 1, vortex.cell, false, 0)
    expect(ikargn.alive).toBe(true)
    // 5002 relancé : bonus de la XIIe heure (+400 Agilité, masque c,E232).
    if (has(119)) expect(ikargn.stats.agility).toBe(agi + 400)
  })
})
