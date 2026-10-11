/**
 * Bonbombes de la Reine des Voleurs (tools/reine-des-voleurs/planificateur/bombes.ts) contre le combat réel du
 * 2026-10-09 (journal AnkaBot, carte 137101316) : cases d'apparition, réaction en chaîne et apparitions suivantes.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { simulateHorizon, spawnCell, type BombWorld } from '../tools/reine-des-voleurs/planificateur/bombes'

const map = JSON.parse(readFileSync(new URL('../data/maps/137101316.json', import.meta.url), 'utf8')) as { cells: { id: number; walkable: boolean }[] }
const walk = (c: number) => !!map.cells[c]?.walkable
const J = 1, LA = 2, LO = 3, K = 4

describe('Bonbombes (combat réel du 2026-10-09)', () => {
  it('apparition : 2 cases au nord-est en ligne, sinon à l’est (5 apparitions relevées)', () => {
    const world = (occupied: number[]): BombWorld => ({ walk, players: [], bombs: [], monsters: new Set(occupied), order: [] })
    expect(spawnCell(world([]), 412)).toBe(385)
    expect(spawnCell(world([]), 439)).toBe(412)
    expect(spawnCell(world([]), 453)).toBe(426)
    expect(spawnCell(world([453]), 480)).toBe(481) // case nord-est prise par un Crâ
    expect(spawnCell(world([]), 427)).toBe(400)
  })

  it('fin du tour de Java (manche 2) : les 5 bombes explosent en chaîne sans tuer personne, puis 412, 426, 481', () => {
    const res = simulateHorizon({
      walk,
      players: [{ id: J, cell: 427, alive: true }, { id: LA, cell: 439, alive: true }, { id: LO, cell: 453, alive: true }, { id: K, cell: 480, alive: true }],
      bombs: [
        { id: -18, owner: J, cell: 327, born: 1, blue: false, alive: true },
        { id: -19, owner: LA, cell: 341, born: 1, blue: false, alive: true },
        { id: -20, owner: LO, cell: 370, born: 1, blue: false, alive: true },
        { id: -21, owner: K, cell: 397, born: 1, blue: false, alive: true },
        { id: -22, owner: J, cell: 356, born: 2, blue: false, alive: true },
      ],
      monsters: new Set([258, 218, 220, 193, 249]),
      order: [-13, J, -16, -17, LA, -15, LO, -14, K],
    }, J, 2)
    expect(res.deaths).toEqual([])
    expect(res.events.filter(e => e.kind === 'explode').map(e => e.who).sort((a, b) => a - b)).toEqual([-22, -21, -20, -19, -18])
    // la bombe -21 passe au bleu (diagonale de -19) : le journal montre son changement d'apparence
    expect(res.events.some(e => e.kind === 'blue' && e.who === -21)).toBe(true)
    expect(res.bombsAtNextTurn.map(b => b.cell)).toEqual([412, 426, 481])
  })

  it('sans les poussées de Java (bombes -20 et -22 non déplacées), la chaîne tue Lamouit, Lowkey et Kemist', () => {
    const res = simulateHorizon({
      walk,
      players: [{ id: J, cell: 427, alive: true }, { id: LA, cell: 439, alive: true }, { id: LO, cell: 453, alive: true }, { id: K, cell: 480, alive: true }],
      bombs: [
        { id: -18, owner: J, cell: 327, born: 1, blue: false, alive: true },
        { id: -19, owner: LA, cell: 341, born: 1, blue: false, alive: true },
        { id: -20, owner: LO, cell: 383, born: 1, blue: false, alive: true },
        { id: -21, owner: K, cell: 397, born: 1, blue: false, alive: true },
        { id: -22, owner: J, cell: 385, born: 2, blue: false, alive: true },
      ],
      monsters: new Set([258, 218, 220, 193, 249]),
      order: [-13, J, -16, -17, LA, -15, LO, -14, K],
    }, J, 2)
    expect(res.deaths.filter(d => d.atActiveEnd).map(d => d.id).sort()).toEqual([LA, LO, K])
  })
})
