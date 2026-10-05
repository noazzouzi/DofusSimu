/**
 * Golden tests T1-T10 de l'IA des monstres (docs/design/ai.md §16.2 ; docs/research/monster-ai.md §8.10) sur la vraie
 * carte de l'Œil de Vortex, avec les vrais sorts des monstres de vague, du Vortex et de vraies classes.
 */
import { describe, expect, it } from 'vitest'
import { MonsterBrain, resolveProfile, vortexPhase1 } from '../src/ai/monster'
import { canCast } from '../src/engine/cast'
import { castStartingSpell } from '../src/engine/effects/summons'
import { createMonsterFighter } from '../src/engine/factory'
import { move } from '../src/engine/move'
import { runFight } from '../src/engine/runner'
import { distance, inLine } from '../src/map/geometry'
import {
  addState, at, AURORAIRE, brain, BRABUZAR, BREEDS, BUBOXOR, casts, data, HARPILLE, IKARGN, MEJAIRE, playTurn, scene, stateEffect,
  turnOf, VORTEX,
} from './ai-monster-helpers'

describe('T1 — Buboxor sans cible : Bouclier absorbant puis avance', () => {
  it('lance 5026 puis avance de 6 PM vers l’ennemi focal', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(26, -1) }], monsters: [{ id: BUBOXOR, cell: at(13, -8) }] })
    const bub = s.monsters[0]
    turnOf(s.engine, s.fight, bub)
    const d0 = distance(bub.cell, s.players[0].cell)
    expect(d0).toBeGreaterThan(9)
    const evs = playTurn(brain(), s, bub)
    const cs = casts(evs)
    expect(cs.map(c => c.spellId)).toEqual([5026])
    const moves = evs.filter(e => e.t === 'move')
    expect(moves.length).toBeGreaterThan(0)
    expect(cs.length && evs.indexOf(evs.find(e => e.t === 'cast')!) < evs.indexOf(moves[0])).toBe(true)
    expect(d0 - distance(bub.cell, s.players[0].cell)).toBe(6)
  })
})

describe('T2 — Méjaire : Rayonirique (Pacifiste) sur le meilleur DPS aligné', () => {
  it('vise le Iop avant l’Enutrof', () => {
    const s = scene({
      players: [{ breed: BREEDS.enutrof, cell: at(22, -8) }, { breed: BREEDS.iop, cell: at(20, -10) }],
      monsters: [{ id: MEJAIRE, cell: at(20, -8) }],
    })
    const mej = s.monsters[0]
    const iop = s.players[1]
    turnOf(s.engine, s.fight, mej)
    const evs = playTurn(brain(), s, mej)
    const cs = casts(evs)
    expect(cs[0]).toMatchObject({ spellId: 5022, cell: iop.cell })
    expect(iop.states).toContain(218)
  })
})

describe('T3 — Ikargn : Attraction ailée → Cercle de feu → Terre mythe', () => {
  it('ouvre par l’attraction quand 3 ennemis sont à ≤ 3 cases', () => {
    const s = scene({
      players: [
        { breed: BREEDS.iop, cell: at(20, -11) },
        { breed: BREEDS.cra, cell: at(23, -8) },
        { breed: BREEDS.enutrof, cell: at(17, -8) },
      ],
      monsters: [{ id: IKARGN, cell: at(20, -8) }],
    })
    const ik = s.monsters[0]
    turnOf(s.engine, s.fight, ik)
    const evs = playTurn(brain(), s, ik)
    expect(casts(evs).map(c => c.spellId)).toEqual([5015, 5016, 5017])
  })
})

describe('T4 — Harpille : Petit poison dès qu’il est prêt', () => {
  it('lance 5021 même sans cible à portée', () => {
    const s = scene({ players: [{ breed: BREEDS.cra, cell: at(26, -1) }, { breed: BREEDS.iop, cell: at(25, 0) }], monsters: [{ id: HARPILLE, cell: at(13, -9) }] })
    const h = s.monsters[0]
    turnOf(s.engine, s.fight, h)
    const evs = playTurn(brain(), s, h)
    expect(casts(evs)[0]?.spellId).toBe(5021)
    // Poison programmé sur les deux personnages.
    for (const p of s.players) expect(p.buffs.some(b => b.spellId === 5021 || b.triggers === 'TB')).toBe(true)
  })
})

describe('T5 — Brabuzar : Mise en situation sur l’avant, collision', () => {
  it('pousse le personnage de devant sur celui de derrière', () => {
    const s = scene({
      players: [{ breed: BREEDS.iop, cell: at(23, -9) }, { breed: BREEDS.cra, cell: at(23, -10) }],
      monsters: [{ id: BRABUZAR, cell: at(23, -8) }],
    })
    const br = s.monsters[0]
    const [front] = s.players
    turnOf(s.engine, s.fight, br)
    const frontCell = front.cell
    const evs = playTurn(brain(), s, br)
    const cs = casts(evs)
    expect(cs.some(c => c.spellId === 5030 && c.cell === frontCell)).toBe(true)
    // Dommages de poussée (collision) infligés aux personnages.
    expect(evs.some(e => e.t === 'damage' && e.kind === 'push')).toBe(true)
  })
})

/** Vortex « phase 2 » sur moteur nu : pas de Vortexiphan (pas de Marginal), Auroraire invoquée à la main. */
function vortexPhase2Scene(players: { breed: number; cell: number }[], vortexCell: number, auroraireCell: number) {
  const s = scene({ players, monsters: [{ id: VORTEX, cell: vortexCell }] })
  const v = s.monsters[0]
  const aur = createMonsterFighter(data, { monsterId: AURORAIRE, grade: 5, team: 1, cell: auroraireCell, summonerId: v.id, summoner: v })
  s.engine.spawn(s.fight, aur, { afterId: v.id })
  return { ...s, v, aur: s.fight.fighters[s.fight.fighters.length - 1] }
}

describe('T6 — Vortex phase 2 : Heurage puis Heuristique sur des cibles alignées distinctes', () => {
  it('Heurage en premier, puis Heuristique (≤ 3 cibles distinctes, alignées à ≤ 8)', () => {
    const s = vortexPhase2Scene(
      [{ breed: BREEDS.iop, cell: at(24, -2) }, { breed: BREEDS.cra, cell: at(14, -2) }, { breed: BREEDS.enutrof, cell: at(24, -8) }],
      at(20, -12),
      at(19, -2),
    )
    turnOf(s.engine, s.fight, s.v)
    expect(vortexPhase1(s.v)).toBe(false)
    const evs = playTurn(brain(), s, s.v)
    const cs = casts(evs)
    expect(cs[0]?.spellId).toBe(5066)
    const heur = cs.filter(c => c.spellId === 5068)
    expect(heur.length).toBeGreaterThan(0)
    expect(heur.length).toBeLessThanOrEqual(3)
    expect(new Set(heur.map(c => c.cell)).size).toBe(heur.length)
  })
})

describe('T7 — Vortex phase 1 : immobile, En temps et en heure si aligné, Contamination près d’un zombie entouré', () => {
  function phase1(playerCells: number[]) {
    const s = scene({ players: playerCells.map((cell, i) => ({ breed: [BREEDS.iop, BREEDS.cra, BREEDS.enutrof][i % 3], cell })), monsters: [{ id: VORTEX, cell: at(16, -3) }, { id: IKARGN, cell: at(16, -9) }] })
    const v = s.monsters[0]
    castStartingSpell(s.engine, s.fight, v)
    const aur = s.fight.fighters.find(f => f.monsterId === AURORAIRE)!
    return { ...s, v, aur, ik: s.monsters[1] }
  }

  it('ne bouge pas, lance En temps et en heure sur l’Auroraire quand un personnage est aligné', () => {
    const s = phase1([at(25, -1)])
    turnOf(s.engine, s.fight, s.v, 2)
    expect(vortexPhase1(s.v)).toBe(true)
    // Place un personnage sur une case alignée avec l’Auroraire.
    const p = s.players[0]
    const line = s.fight.map.cells.filter(c => c.walkable && inLine(c.id, s.aur.cell) && c.id !== s.aur.cell && !s.engine.fighterAt(s.fight, c.id)).map(c => c.id)
    expect(line.length).toBeGreaterThan(0)
    p.cell = line[0]
    const cell0 = s.v.cell
    const evs = playTurn(brain(), s, s.v)
    expect(s.v.cell).toBe(cell0)
    expect(evs.some(e => e.t === 'move' && e.fighter === s.v.id)).toBe(false)
    expect(casts(evs).some(c => c.spellId === 5062 && c.cell === s.aur.cell)).toBe(true)
  })

  it('sans personnage aligné : pas d’En temps et en heure ; Contamination seulement sur un zombie entouré', () => {
    const s = phase1([at(25, -1)])
    turnOf(s.engine, s.fight, s.v, 2)
    const p = s.players[0]
    const free = s.fight.map.cells.filter(c => c.walkable && !inLine(c.id, s.aur.cell) && !s.engine.fighterAt(s.fight, c.id)).map(c => c.id)
    p.cell = free.find(c => distance(c, s.ik.cell) > 4)!
    let evs = playTurn(brain(), s, s.v)
    expect(casts(evs).some(c => c.spellId === 5062)).toBe(false)
    expect(casts(evs).some(c => c.spellId === 5064)).toBe(false)
    // Zombie (état 74) avec un personnage à ≤ 2 cases : Contamination zombie.
    const s2 = phase1([at(25, -1)])
    turnOf(s2.engine, s2.fight, s2.v, 2)
    addState(s2.engine, s2.fight, s2.ik, 74)
    expect(canCast(s2.engine, s2.fight, s2.v, s2.v.spells.find(x => x.spellId === 5064)!, s2.ik.cell)).toBeNull()
    const p2 = s2.players[0]
    const near = s2.fight.map.cells.filter(c => c.walkable && !inLine(c.id, s2.aur.cell) && distance(c.id, s2.ik.cell) === 2 && !s2.engine.fighterAt(s2.fight, c.id)).map(c => c.id)
    expect(near.length).toBeGreaterThan(0)
    p2.cell = near[0]
    evs = playTurn(brain(), s2, s2.v)
    expect(casts(evs).some(c => c.spellId === 5064 && c.cell === s2.ik.cell)).toBe(true)
  })
})

describe('T8 — peureux qui n’a rien pu faire : se rapproche (R12)', () => {
  it('bascule agressif sans action offensive, revient peureux après une attaque', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(26, -1) }], monsters: [{ id: MEJAIRE, cell: at(13, -9) }] })
    const m = s.monsters[0]
    m.tags.aiBehaviour = 2 // effet 2188 : paniqué / peureux
    expect(resolveProfile(s.engine, m).behaviour).toBe('fearful')
    const b = brain()
    turnOf(s.engine, s.fight, m)
    const d0 = distance(m.cell, s.players[0].cell)
    playTurn(b, s, m)
    expect(m.tags.aiFearAggro).toBe(true)
    const d1 = distance(m.cell, s.players[0].cell)
    expect(d1).toBeLessThan(d0)
    // Tour suivant : toujours agressif, il continue de se rapprocher (ou attaque).
    turnOf(s.engine, s.fight, m, s.fight.round + 1)
    const evs = playTurn(b, s, m)
    const d2 = distance(m.cell, s.players[0].cell)
    const attacked = casts(evs).length > 0
    expect(attacked || d2 < d1).toBe(true)
    if (attacked) expect(m.tags.aiFearAggro).toBeUndefined()
  })
})

describe('T9 — cible à renvoi mortel : pas d’attaque (R7)', () => {
  it('le Buboxor à 40 PV ne frappe pas le personnage qui renvoie 5 000 dommages', () => {
    const s = scene({ players: [{ breed: BREEDS.sacrieur, cell: at(23, -9) }], monsters: [{ id: BUBOXOR, cell: at(23, -8) }] })
    const [p] = s.players
    const bub = s.monsters[0]
    turnOf(s.engine, s.fight, bub)
    p.baseStats = { ...p.baseStats, reflect: 5000 }
    s.engine.recomputeStats(p)
    bub.hp = 40
    const evs = playTurn(brain(), s, bub)
    expect(casts(evs).filter(c => c.cell === p.cell)).toEqual([])
    expect(bub.alive).toBe(true)
  })
})

describe('T10 — monstre corrompu : ne joue pas, tacle toujours', () => {
  it('passe son tour (tour annulé) et retient un personnage au contact', () => {
    const s = scene({ players: [{ breed: BREEDS.cra, cell: at(23, -9) }], monsters: [{ id: HARPILLE, cell: at(23, -8) }] })
    const [p] = s.players
    const h = s.monsters[0]
    // Corruption : Tour annulé + Invulnérable + état 6611 (passif 5002 du donjon).
    addState(s.engine, s.fight, h, 6611)
    addState(s.engine, s.fight, h, 56)
    s.engine.addBuff(s.fight, h, { sourceId: h.id, spellId: 0, effect: stateEffect(0), value: 0, remaining: -1, delay: 0, dispellable: false, passTurn: true, kind: 'special', label: 'Tour annulé' })
    expect(s.engine.passesTurn(h)).toBe(true)
    // Le cerveau ne fait rien même s'il est appelé.
    const n = s.fight.events.length
    brain().playTurn(s.engine, s.fight, h)
    expect(s.fight.events.length).toBe(n)
    expect(MonsterBrain.plays(s.engine, s.fight, h)).toBe(false)
    // Le moteur saute son tour : sur deux tours de jeu, aucune action de la Harpille.
    const b = brain()
    s.fight.options.maxRounds = 2
    const f2 = s.engine.cloneFight(s.fight, true)
    runFight(s.engine, f2, f => (f.team === 1 ? b : { playTurn() {} }))
    expect(f2.events.some(e => (e.t === 'cast' || e.t === 'move') && e.fighter === h.id)).toBe(false)
    // Tacle : le Crâ au contact perd des PM en s'éloignant.
    turnOf(s.engine, s.fight, p)
    const mp0 = p.mp
    const away = [at(23, -10), at(23, -11)]
    move(s.fight, p, [p.cell, ...away], s.engine)
    expect(s.fight.events.some(e => e.t === 'tackle' && e.fighter === p.id) || p.mp < mp0 - 2).toBe(true)
  })
})

