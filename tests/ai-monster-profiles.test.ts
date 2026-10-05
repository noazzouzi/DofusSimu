/**
 * Profils et overrides de l'Œil de Vortex (docs/design/ai.md §11.7) au-delà des golden tests : rapprochement par
 * Envolupté (Méjaire) seulement sans cible en ligne, PM volés par Hoxor utilisés pour rejoindre le contact (Buboxor),
 * annotations `aiNote` du replay (E3), classement `decideTop` pour les rollouts des joueurs, et suivi de la cohérence
 * avec la cible prédite par la menace du socle (§6.5).
 */
import { describe, expect, it } from 'vitest'
import { createPerception, createView } from '../src/ai/core'
import { distance } from '../src/map/geometry'
import { randomScene, engineFor } from './ai-core-helpers'
import { at, brain, BREEDS, BUBOXOR, casts, IKARGN, MEJAIRE, playTurn, scene, turnOf } from './ai-monster-helpers'

describe('Méjaire — Envolupté comme rapprochement (gapCloser)', () => {
  it('sans ennemi atteignable en ligne : échange avec un allié proche des personnages', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -7) }], monsters: [{ id: MEJAIRE, cell: at(13, -9) }, { id: IKARGN, cell: at(21, -9) }] })
    const [mej, ik] = s.monsters
    turnOf(s.engine, s.fight, mej)
    const ikCell = ik.cell
    const evs = playTurn(brain(), s, mej)
    expect(casts(evs).some(c => c.spellId === 5024 && c.cell === ikCell)).toBe(true)
    expect(distance(mej.cell, s.players[0].cell)).toBeLessThan(10)
  })

  it('un ennemi en ligne à portée : pas d’Envolupté', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(18, -9) }], monsters: [{ id: MEJAIRE, cell: at(13, -9) }, { id: IKARGN, cell: at(21, -9) }] })
    const mej = s.monsters[0]
    turnOf(s.engine, s.fight, mej)
    const evs = playTurn(brain(), s, mej)
    expect(casts(evs).some(c => c.spellId === 5024)).toBe(false)
    expect(casts(evs).length).toBeGreaterThan(0)
  })
})

describe('Buboxor — PM volés (Hoxor) = mobilité', () => {
  it('Hoxor puis contact et Feinterception', () => {
    const s = scene({ players: [{ breed: BREEDS.cra, cell: at(25, -8) }], monsters: [{ id: BUBOXOR, cell: at(16, -8) }] })
    const [p] = s.players
    const bub = s.monsters[0]
    turnOf(s.engine, s.fight, bub)
    const evs = playTurn(brain(), s, bub)
    const cs = casts(evs).map(c => c.spellId)
    expect(cs).toContain(5028)
    expect(cs).toContain(5027)
    expect(distance(bub.cell, p.cell)).toBe(1)
  })
})

describe('annotations du replay et classement', () => {
  it('explain : une annotation par lancer ; sinon aucune', () => {
    const run = (explain: boolean) => {
      const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -10) }, { breed: BREEDS.cra, cell: at(25, -6) }], monsters: [{ id: IKARGN, cell: at(23, -7) }] })
      const m = s.monsters[0]
      turnOf(s.engine, s.fight, m)
      const evs = playTurn(brain('play', 1, { explain }), s, m)
      return { notes: evs.filter(e => e.t === 'aiNote').length, casts: casts(evs).length }
    }
    const on = run(true)
    expect(on.notes).toBeGreaterThanOrEqual(on.casts)
    expect(run(false).notes).toBe(0)
  })

  it('decideTop : la décision de `decide` d’abord, puis les autres par préférence', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -10) }, { breed: BREEDS.cra, cell: at(25, -6) }], monsters: [{ id: BUBOXOR, cell: at(23, -7) }] })
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    const b = brain()
    const top = b.decideTop(s.engine, s.fight, m, 3)
    const d = b.decide(s.engine, s.fight, m)
    expect(top.length).toBeGreaterThanOrEqual(2)
    expect(top[0].cand.key).toBe(d?.cand.key)
    for (let i = 1; i < top.length; i++) expect(top[i].score).toBeLessThanOrEqual(top[i - 1].score + 1e-9)
  })
})

describe('cohérence avec la menace du socle (suivi, §6.5)', () => {
  it('cible prédite par ThreatModel = première cible directe du MonsterBrain (suivi ≥ 60 %, design 85 %)', () => {
    const engine = engineFor()
    const b = brain('play', 3)
    let n = 0
    let agree = 0
    for (let seed = 1; seed <= 250; seed++) {
      const { fight, me } = randomScene(seed, { engine })
      const view = createView(engine, fight, me, 1)
      const next = view.upcoming(1)[0]
      if (!next || next.isPlayer || next.team === me.team) continue
      const mon = fight.fighters[next.fighterId]
      const pred = createPerception(view).threat.predictedTarget(mon)
      engine.endTurn(fight, me)
      if (engine.nextTurn(fight)?.id !== mon.id) continue
      const d = b.decide(engine, fight, mon)
      const t = d?.cand.cast ? fight.fighters.find(f => f.alive && f.cell === d.cand.cast!.cell && f.team !== mon.team) : undefined
      if (!t) continue
      n++
      if (pred === t.id) agree++
    }
    console.log(`cible prédite par la menace = première cible du MonsterBrain : ${agree}/${n} (${((100 * agree) / n).toFixed(1)} %)`)
    expect(n).toBeGreaterThan(80)
    expect(agree / n).toBeGreaterThanOrEqual(0.6)
  })
})
