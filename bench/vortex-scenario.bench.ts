/**
 * Bancs du scénario Œil de Vortex (WP3a ; docs/design/ai.md §14, §16.6) — un cœur, données et carte RÉELLES.
 *
 * | Mesure | Cible | Pourquoi |
 * |---|---|---|
 * | `forecastHours` 2 tours (début de tour de joueur) | ≤ 20 µs | appelé à chaque tour de joueur et par le pricer |
 * | `forecastHours` 12 créneaux joueurs (horizon `standard`) | ≤ 40 µs | racine du `HourPlanner` |
 * | `trackVortex` (19 monstres, vagues à venir comprises) | ≤ 20 µs | racine abstraite, signature du tracker |
 * | `absFromFight` + `beginSlot` sur tout l'horizon | ≤ 30 µs | racine et transitions du planificateur |
 * | `vortexHooks.cloneState` (E2) | ≤ 1 µs | part du scénario dans `cloneFight` (`structuredClone` ≈ 7 µs) |
 * | modèle de base : `update` (début de tour de joueur) | ≤ 30 µs | prévision 2 tours + croix par créneau |
 * | modèle de base : `extraIncoming` (une case) | ≤ 0,5 µs | appelé par allié × case par la menace (`cellIncoming` ≤ 2 µs) |
 * | `cloneFight` complet (référence moteur) | ≤ 12 µs | §14.1 — coût du MOTEUR (combattants, buffs), hors WP3a |
 * | placement analytique (11 880 affectations) | ≤ 60 ms | §12.10 (≈ 5 µs par affectation visés) |
 * | combat passif de 30 tours (moteur + règles serveur seules) | ≤ 50 ms | §14.2 « Moteur 0,05 s » par combat ; mesuré
 * |   |   | ≈ 220-300 ms, dont ≈ 50 % dans `target()` (src/engine/effects/core.ts) : les 13 effets en zone `a1` de 4996
 * |   |   | (chaque début de tour de personnage) et les 12 de 5000 (chaque mort) parcourent les 560 cases avec une recherche
 * |   |   | linéaire de l'occupant par case — coût MOTEUR, signalé dans le rapport WP3a |
 * | `runVortexSmoke` 30 tours (attaque au plus près, replay enregistré) | ≤ 400 ms | tests de fumée |
 *
 * Échec à ×2 (machines de CI variables) : signalé dans le résumé imprimé, pas d'assertion (vitest bench).
 *
 *   npx vitest bench bench/vortex-scenario.bench.ts
 */
import { afterAll, bench, describe } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { absFromFight, beginSlot } from '../src/dungeons/vortex/abstract'
import { forecastHours } from '../src/dungeons/vortex/clock'
import { VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { rankVortexPlacements } from '../src/dungeons/vortex/placement'
import { createView } from '../src/ai/core'
import { emptyBlackboard } from '../src/ai/team/controller'
import type { Perception } from '../src/ai/types'
import { basicVortexAIModel, createSmokeTeam, runVortexSmoke } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { trackVortex } from '../src/dungeons/vortex/tracker'
import { createEngine } from '../src/engine'
import { passController, runFight } from '../src/engine/runner'
import type { FightState } from '../src/engine/types'

const DATA = loadDataStore('data')
const notes: string[] = []

function newFight(seed: number, rounds = 60): { engine: ReturnType<typeof createEngine>; fight: FightState } {
  const engine = createEngine(DATA, vortexHooks)
  const team = createSmokeTeam(DATA, undefined, { hp: 1_000_000 })
  const fight = createVortexFight(engine, team, { params: { ...VORTEX_DEFAULT_PARAMS, maxRounds: rounds }, seed, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  return { engine, fight }
}

/** Combat avancé passivement jusqu'au tour 13, créneau d'un personnage (vagues 1-3 présentes, morts et zombies). */
function midFight(): { engine: ReturnType<typeof createEngine>; fight: FightState } {
  const s = newFight(5)
  const { engine, fight } = s
  for (let i = 0; i < 4000 && !fight.ended; i++) {
    const f = engine.nextTurn(fight)
    if (!f) break
    if (fight.round >= 13 && f.kind === 'player') break
    engine.endTurn(fight, f)
  }
  return s
}

/** Mesure ad hoc (µs par appel) imprimée en fin de banc, avec la cible. */
function measure(label: string, targetUs: number, n: number, fn: () => unknown): void {
  for (let i = 0; i < Math.min(50, n); i++) fn()
  const t0 = performance.now()
  for (let i = 0; i < n; i++) fn()
  const us = ((performance.now() - t0) * 1000) / n
  const verdict = us <= targetUs ? 'OK' : us <= targetUs * 1.2 ? 'avertissement (+20 %)' : us <= targetUs * 2 ? 'au-dessus de la cible' : 'ÉCHEC (×2)'
  notes.push(`${label} : ${us < 1000 ? `${us.toFixed(1)} µs` : `${(us / 1000).toFixed(1)} ms`} (cible ${targetUs < 1000 ? `${targetUs} µs` : `${targetUs / 1000} ms`}) — ${verdict}`)
}

const mid = midFight()
const horizon = forecastHours(mid.fight, 4, VORTEX_DEFAULT_PARAMS)
const midMe = mid.engine.current(mid.fight)!
const midView = createView(mid.engine, mid.fight, midMe, 1)
const model = basicVortexAIModel(VORTEX_DEFAULT_PARAMS)
const bb = emptyBlackboard()
const noPerception = {} as Perception
model.update(midView, bb, noPerception, 'fast')
const allies = mid.fight.fighters.filter(f => f.alive && f.team === midMe.team)
let cellCursor = 0
const extraOnce = () => {
  cellCursor = (cellCursor + 37) % mid.fight.map.cells.length
  return model.extraIncoming!(mid.fight, allies[cellCursor % allies.length], cellCursor)
}
const team = createSmokeTeam(DATA)
// Préchauffage : conversion paresseuse des données (sorts, monstres, carte) hors mesure.
runVortexSmoke(99, { data: DATA, rounds: 3 })

describe('WP3a — horloge, suivi, modèle abstrait (tour 13, créneau joueur)', () => {
  bench('forecastHours 2 tours', () => {
    forecastHours(mid.fight, 2, VORTEX_DEFAULT_PARAMS)
  })
  bench('forecastHours 4 tours, 48 créneaux', () => {
    forecastHours(mid.fight, 4, VORTEX_DEFAULT_PARAMS, undefined, { maxSlots: 48 })
  })
  bench('trackVortex', () => {
    trackVortex(mid.fight)
  })
  bench('absFromFight + beginSlot (horizon complet)', () => {
    let a = absFromFight(mid.fight, horizon)
    for (let i = 1; i < horizon.length; i++) a = beginSlot(a, horizon, i)
  })
  bench('vortexHooks.cloneState (E2)', () => {
    vortexHooks.cloneState!(mid.fight.scenarioState)
  })
  bench('modèle de base : update', () => {
    model.update(midView, bb, noPerception, 'fast')
  })
  bench('modèle de base : extraIncoming', () => {
    extraOnce()
  })
  bench('cloneFight complet (référence moteur)', () => {
    mid.engine.cloneFight(mid.fight, false)
  })
})

describe('WP3a — placement et combats', () => {
  bench('placement analytique (11 880 affectations)', () => {
    rankVortexPlacements(team, VORTEX_DEFAULT_PARAMS, { top: 8 })
  }, { time: 0, iterations: 10, warmupIterations: 1 })
  bench('combat passif 30 tours (moteur + règles serveur)', () => {
    const { engine, fight } = newFight(7, 30)
    runFight(engine, fight, () => passController)
  }, { time: 0, iterations: 10, warmupIterations: 1 })
  bench('runVortexSmoke 30 tours (replay enregistré)', () => {
    runVortexSmoke(3, { data: DATA })
  }, { time: 0, iterations: 5, warmupIterations: 1 })
})

afterAll(() => {
  measure('forecastHours 2 tours', 20, 20000, () => forecastHours(mid.fight, 2, VORTEX_DEFAULT_PARAMS))
  measure('forecastHours horizon 12 créneaux joueurs', 40, 20000, () => forecastHours(mid.fight, 4, VORTEX_DEFAULT_PARAMS, undefined, { maxSlots: 48 }))
  measure('trackVortex', 20, 20000, () => trackVortex(mid.fight))
  measure('absFromFight + beginSlot', 30, 20000, () => {
    let a = absFromFight(mid.fight, horizon)
    for (let i = 1; i < horizon.length; i++) a = beginSlot(a, horizon, i)
    return a
  })
  measure('vortexHooks.cloneState (E2)', 1, 50000, () => vortexHooks.cloneState!(mid.fight.scenarioState))
  measure('modèle de base : update', 30, 20000, () => model.update(midView, bb, noPerception, 'fast'))
  measure('modèle de base : extraIncoming', 0.5, 200000, extraOnce)
  measure('cloneFight complet (référence moteur, hors WP3a)', 12, 20000, () => mid.engine.cloneFight(mid.fight, false))
  measure('placement analytique', 60_000, 10, () => rankVortexPlacements(team, VORTEX_DEFAULT_PARAMS, { top: 8 }))
  measure('combat passif 30 tours (dominé par le moteur)', 50_000, 10, () => {
    const { engine, fight } = newFight(7, 30)
    runFight(engine, fight, () => passController)
  })
  measure('runVortexSmoke 30 tours', 400_000, 5, () => runVortexSmoke(3, { data: DATA }))
  console.log(`\nWP3a — mesures (1 cœur) :\n${notes.join('\n')}`)
}, 300_000)
