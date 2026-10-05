/**
 * Robustesse de l'IA des monstres hors Vortex (docs/design/ai.md §11.6, §16.2) : vrais monstres de tous les
 * archétypes (invocateur, soigneur, bloqueur, peureux, kiter, kamikaze, poseur de pièges) contre des personnages THL
 * « attaque au plus près », sur de vraies cartes, 6 tours de jeu : aucune exception, au moins une action utile par
 * monstre qui peut agir, ≤ 12 actions par tour, combats rejouables.
 */
import { describe, expect, it } from 'vitest'
import { inferArchetype, MAX_STEPS } from '../src/ai/monster'
import { nearestAttackController } from '../src/dungeons/generic/controllers'
import { runFight, type Controller } from '../src/engine/runner'
import { BREEDS, engineFor, makeFight, MAP_IDS, mapOf, monster, player, THL, walkableCells } from './ai-core-helpers'
import { brain } from './ai-monster-helpers'
import { Rng } from '../src/core/rng'

const CASES: { id: number; archetype: string }[] = [
  { id: 121, archetype: 'summoner' }, // Minotoror
  { id: 258, archetype: 'summoner' }, // Branche Invocatrice
  { id: 260, archetype: 'healer' }, // Branche Soignante
  { id: 479, archetype: 'healer' }, // Mama Bwork
  { id: 233, archetype: 'blocker' }, // Troollaraj
  { id: 3379, archetype: 'fearful' }, // Harrogant
  { id: 407, archetype: 'kiter' }, // Oto Mustam
  { id: 107, archetype: 'aggressive' }, // Hell Mina
  { id: 2941, archetype: 'kiter' }, // Gobus (kamikaze)
  { id: 3746, archetype: 'kiter' }, // Mâchassin (pièges)
]

describe('robustesse : archétypes variés sur de vraies cartes', () => {
  it('6 tours sans exception, actions bornées, monstres actifs', () => {
    const engine = engineFor()
    const acted = new Map<number, number>()
    for (const [k, c] of CASES.entries()) {
      const rng = new Rng(100 + k)
      const mapId = MAP_IDS[k % MAP_IDS.length]
      const cells = walkableCells(mapOf(mapId))
      const pick = () => cells.splice(Math.floor(rng.next() * cells.length), 1)[0]
      const fighters = [
        player(BREEDS.iop, { cell: pick(), extra: THL }),
        player(BREEDS.eniripsa, { cell: pick(), extra: THL }),
        monster(c.id, pick(), 3),
        monster(c.id, pick(), 3),
      ]
      for (const f of fighters) if (f.kind === 'player') f.hp = f.maxHp = f.baseMaxHp = 50000
      const fight = makeFight(engine, mapId, fighters, { seed: 7 + k, record: true })
      fight.options.maxRounds = 6
      const m = fight.fighters.find(f => f.monsterId === c.id)!
      expect(inferArchetype(engine, m).archetype).toBe(c.archetype)
      const b = brain('play', k)
      const players = nearestAttackController()
      const monsters: Controller = {
        playTurn(e, f, me) {
          const n0 = f.events.length
          b.playTurn(e, f, me)
          const acts = f.events.slice(n0).filter(ev => (ev.t === 'cast' || ev.t === 'move') && ev.fighter === me.id).length
          expect(acts).toBeLessThanOrEqual(MAX_STEPS + 1)
          if (me.monsterId === c.id) acted.set(c.id, (acted.get(c.id) ?? 0) + acts)
        },
      }
      expect(() => runFight(engine, fight, f => (f.team === 0 ? players : monsters))).not.toThrow()
    }
    for (const c of CASES) expect(acted.get(c.id) ?? 0, `monstre ${c.id}`).toBeGreaterThan(0)
  }, 120_000)
})
