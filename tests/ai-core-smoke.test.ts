/**
 * Socle IA en combat réel (revue WP1-core) : un joueur « socle » minimal — `generateCasts` + préfiltre, 8 meilleurs
 * candidats simulés (`simClone` + `applyMacro`), jugés par `valueOf` depuis la racine — joue de vrais combats
 * (`runFight`, jets aléatoires, enregistrement) contre des monstres de l'Œil de Vortex, pour les 19 classes. Vérifie
 * qu'aucune brique du socle ne lève d'exception (invocations, morts, portés, marques, sous-sorts…), que les combats
 * se terminent, que la réflexion ne lit pas `fight.events` (Proxy) et qu'un combat est rejouable bit à bit.
 */
import { describe, expect, it } from 'vitest'
import {
  applyMacro, createPerception, createView, generateCasts, observeVisibility, simClone, simSalt, stateHash, valueOf,
} from '../src/ai/core'
import { playGreedyTurn } from '../src/ai/fallback'
import { toActions } from '../src/ai/types'
import { fnv1a32 } from '../src/core/hash'
import { Rng } from '../src/core/rng'
import type { Engine } from '../src/engine/engine'
import { performAction, runFight, type ControllerProvider } from '../src/engine/runner'
import type { Fighter, FightEvent, FightState } from '../src/engine/types'
import { data, engineFor, makeFight, mapOf, MAP_IDS, monster, pickCells, player, THL, VORTEX_MONSTERS, yieldToEventLoop } from './ai-core-helpers'

/** Tour d'un joueur « socle » : jusqu'à 8 actions, chacune la meilleure de 8 candidats simulés (gain ≥ 20 PVe). */
function corePlayerTurn(engine: Engine, fight: FightState, me: Fighter): void {
  observeVisibility(fight)
  for (let step = 0; step < 8 && me.alive && !fight.ended; step++) {
    const view = createView(engine, fight, me, 77)
    const p = createPerception(view)
    const v0 = valueOf(view, fight, p).total
    const cands = generateCasts(view, fight, me, { perception: p })
      .sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, 8)
    let best = null
    let bestV = v0 + 20
    for (const m of cands) {
      const c = simClone(view, fight, simSalt(stateHash(fight), step))
      if (!applyMacro(engine, c, me.id, m)) continue
      const v = valueOf(view, c, p, { root: fight }).total
      if (v > bestV) {
        bestV = v
        best = m
      }
    }
    if (!best) break
    for (const a of toActions(best)) if (!performAction(engine, fight, me, a).ok) return
  }
}

/** Combat n° `seed` : 3 classes (tournantes) contre 4 monstres du Vortex sur une carte réelle. */
function fightFor(engine: Engine, seed: number): FightState {
  const breeds = data.listBreeds().map(b => b.id)
  const rng = new Rng(seed)
  const map = mapOf(MAP_IDS[seed % MAP_IDS.length])
  const cells = pickCells(rng, map, 7)
  const fs: Fighter[] = []
  for (let i = 0; i < 3; i++) fs.push(player(breeds[(seed * 3 + i) % breeds.length], { cell: cells[i], extra: THL, name: `P${i}` }))
  for (let i = 0; i < 4; i++) fs.push(monster(VORTEX_MONSTERS[(seed + i) % 5], cells[3 + i]))
  return makeFight(engine, map.id, fs, { seed, rollMode: 'random', record: true })
}

const controllers = (engine: Engine): ControllerProvider => f => ({
  playTurn: f.kind === 'player' ? (_e, fight, me) => corePlayerTurn(engine, fight, me) : (e, fight, me) => playGreedyTurn(e, fight, me),
})

const eventsHash = (evs: readonly FightEvent[]) => fnv1a32(JSON.stringify(evs.filter(e => e.t !== 'log' && e.t !== 'aiNote')))

describe('socle IA en combat réel (19 classes)', () => {
  it('7 combats couvrant les 19 classes : aucune exception, combats terminés, fight.events jamais lu par la réflexion', async () => {
    const engine = engineFor()
    const seen = new Set<number>()
    for (let seed = 0; seed < 7; seed++) {
      await yieldToEventLoop()
      const fight = fightFor(engine, seed)
      for (const f of fight.fighters) if (f.breedId !== undefined) seen.add(f.breedId)
      // Les contrôleurs n'ont pas le droit de lire le journal : seul le moteur y écrit (push).
      const real = fight.events
      const guard = new Proxy(real, {
        get(t, k, r) {
          if (k === 'push' || k === 'length') return Reflect.get(t, k, r)
          throw new Error(`lecture de fight.events (${String(k)})`)
        },
      })
      fight.events = guard
      runFight(engine, fight, controllers(engine), 400)
      fight.events = real
      expect(fight.ended, `combat ${seed}`).toBe(true)
      expect(fight.events.length).toBeGreaterThan(100)
    }
    expect(seen.size).toBe(data.listBreeds().length)
  }, 240_000)

  it('déterminisme : même combat, mêmes événements (deux exécutions)', async () => {
    const engine = engineFor()
    for (const seed of [3, 11]) {
      await yieldToEventLoop()
      const a = fightFor(engine, seed)
      runFight(engine, a, controllers(engine), 400)
      await yieldToEventLoop()
      const b = fightFor(engine, seed)
      runFight(engine, b, controllers(engine), 400)
      expect(eventsHash(b.events)).toBe(eventsHash(a.events))
      expect(b.round).toBe(a.round)
    }
  }, 240_000)
})
