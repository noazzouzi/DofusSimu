/**
 * Déterminisme et honnêteté de l'IA des monstres (docs/design/ai.md §13.2, §16.2, §16.5) : combats rejoués bit à bit,
 * la réflexion n'avance pas les dés du vrai combat et ne modifie pas l'état, l'IA ne lit jamais `fight.events`, un
 * monstre ne contourne pas un piège invisible, bruit `noiseTau` reproductible, mémoire du mode peureux dans les tags.
 */
import { describe, expect, it } from 'vitest'
import { stateHash } from '../src/ai/core/hash'
import { fnv1a32 } from '../src/core/hash'
import { nearestAttackController } from '../src/dungeons/generic/controllers'
import { VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { createEngine } from '../src/engine'
import { runFight } from '../src/engine/runner'
import type { FightEvent, FightState } from '../src/engine/types'
import { at, brain, BREEDS, data, HARPILLE, IKARGN, MEJAIRE, playTurn, scene, turnOf } from './ai-monster-helpers'

function eventsHash(evs: FightEvent[]): number {
  return fnv1a32(JSON.stringify(evs.filter(e => e.t !== 'log' && e.t !== 'aiNote')))
}

function vortexRun(seed: number, rounds = 8, noiseTau = 0): FightState {
  const engine = createEngine(data, vortexHooks)
  const team = createSmokeTeam(data, [8, 9, 3, 7], { hp: 30000 })
  const fight = createVortexFight(engine, team, { params: { ...VORTEX_DEFAULT_PARAMS, maxRounds: rounds }, seed, rollMode: 'random', record: true, rngRekey: 'perTurn' })
  const players = nearestAttackController()
  const monsters = brain('play', seed, { noiseTau })
  runFight(engine, fight, f => (f.team === 0 ? players : monsters))
  return fight
}

describe('déterminisme', () => {
  it('même graine ⇒ même combat (8 tours du Vortex, cerveaux neufs)', () => {
    const a = vortexRun(11)
    const b = vortexRun(11)
    expect(a.events.filter(e => e.t === 'cast').length).toBeGreaterThan(20)
    expect(eventsHash(a.events)).toBe(eventsHash(b.events))
  })

  it('bruit noiseTau = 0,3 : reproductible pour une graine donnée', () => {
    const a = vortexRun(5, 6, 0.3)
    const b = vortexRun(5, 6, 0.3)
    expect(eventsHash(a.events)).toBe(eventsHash(b.events))
  })
})

describe('honnêteté', () => {
  it('decide() ne touche ni aux dés du vrai combat ni à l’état', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -10) }, { breed: BREEDS.cra, cell: at(25, -6) }], monsters: [{ id: IKARGN, cell: at(23, -7) }] })
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    const rng = s.fight.rngState
    const h = stateHash(s.fight)
    const n = s.fight.events.length
    const d = brain().decide(s.engine, s.fight, m)
    expect(d).not.toBeNull()
    expect(s.fight.rngState).toBe(rng)
    expect(stateHash(s.fight)).toBe(h)
    expect(s.fight.events.length).toBe(n)
  })

  it('le cerveau ne lit jamais fight.events', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -10) }, { breed: BREEDS.cra, cell: at(25, -6) }], monsters: [{ id: HARPILLE, cell: at(23, -7) }], record: false })
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    let reads = 0
    s.fight.events = new Proxy([] as FightEvent[], {
      get(t, k, r) {
        reads++
        return Reflect.get(t, k, r)
      },
    })
    brain().playTurn(s.engine, s.fight, m)
    expect(reads).toBe(0)
    // Le monstre a bien joué (PA dépensés).
    expect(m.ap).toBeLessThan(12)
  })

  it('un piège invisible des joueurs n’est pas contourné ; un piège visible l’est', () => {
    const run = (visible: boolean) => {
      // Ikargn sans PA : il marche vers le personnage le long de la colonne x = 23.
      const s = scene({ players: [{ breed: BREEDS.cra, cell: at(23, -12) }], monsters: [{ id: IKARGN, cell: at(23, -7) }] })
      const m = s.monsters[0]
      const trapCell = at(23, -9)
      s.fight.traps.push({ uid: s.fight.nextUid++, sourceId: s.players[0].id, spellId: 0, center: trapCell, cells: [trapCell], effects: [], visible, color: '#f00', team: 0 })
      turnOf(s.engine, s.fight, m)
      m.ap = 0
      const evs = playTurn(brain(), s, m)
      const path = evs.flatMap(e => (e.t === 'move' && e.fighter === m.id ? e.path : []))
      return path.includes(trapCell)
    }
    expect(run(false)).toBe(true)
    expect(run(true)).toBe(false)
  })
})

describe('mémoire dans les tags (§11.2)', () => {
  it('le mode peureux suit le clone : la prédiction rejoue le même cerveau', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(26, -1) }], monsters: [{ id: MEJAIRE, cell: at(13, -9) }] })
    const m = s.monsters[0]
    m.tags.aiBehaviour = 2
    turnOf(s.engine, s.fight, m)
    playTurn(brain(), s, m)
    expect(m.tags.aiFearAggro).toBe(true)
    turnOf(s.engine, s.fight, m, s.fight.round + 1)
    const clone = s.engine.cloneFight(s.fight, true)
    expect(clone.fighters[m.id].tags.aiFearAggro).toBe(true)
    const real = playTurn(brain('play', 3), s, m)
    const c = { ...s, fight: clone }
    const pred = playTurn(brain('play', 3), c, clone.fighters[m.id])
    const pick = (evs: FightEvent[]) => evs.filter(e => e.t === 'cast' || e.t === 'move').map(e => JSON.stringify(e))
    expect(pick(pred)).toEqual(pick(real))
  })
})
