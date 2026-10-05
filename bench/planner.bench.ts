/**
 * Banc B7 — planificateur d'heures de l'Œil de Vortex (WP3b ; docs/design/ai.md §12.5, §14.1, §16.6), un cœur,
 * données, carte et équipe RÉELLES (presets méta : Crâ feu, Enutrof retrait PM, Iop terre, Eniripsa).
 *
 * | Mesure | Cible | Échec |
 * |---|---|---|
 * | B7 `HourPlanner` `standard` (faisceau 16 × 12 créneaux joueurs) — combat réel, tour 8 (vagues 1-2) | ≤ 10 ms | > 20 ms |
 * | `HourPlanner` `standard` — état synthétique chargé (8 monstres vivants, 4 en attente) | ≤ 10 ms | > 20 ms |
 * | `HourPlanner` `fast` (4 × 8) | ≤ 0,3 ms visés « en cache » ; non caché mesuré ≈ 1 ms | — |
 * | `HourPlanner` `deep` (48 × 20) | ≤ 40 ms | > 80 ms |
 * | `measureHourCosts` (une fois par combat) | ≤ 2 ms | — |
 * | `VortexAIModel.update` `fast` / `standard` (oracle, plan, prix, relances, coût de mort) | ≈ 2 ms / ≈ 15 ms | — |
 * | `planBurst` (phase 2) | ≤ 1 ms | — |
 *
 * Échec à ×2 (machines de CI variables) : signalé dans le résumé imprimé, pas d'assertion (vitest bench).
 *
 *   npx vitest bench bench/planner.bench.ts
 */
import { afterAll, bench, describe } from 'vitest'
import { createDptTable } from '../src/ai/core/dpt'
import { createPerception } from '../src/ai/core/perception'
import { createView } from '../src/ai/core/view'
import { emptyBlackboard } from '../src/ai/team/controller'
import { loadTheta } from '../src/ai/theta'
import type { AIMode } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import type { ClockSlot } from '../src/dungeons/types'
import { absFromFight, absParamsOf, type AbsMonster, type AbsState } from '../src/dungeons/vortex/abstract'
import { planBurst } from '../src/dungeons/vortex/burst'
import { deathHours, forecastHours, isWaveMonster } from '../src/dungeons/vortex/clock'
import { BRABUZAR, BUBOXOR, HARPILLE, IKARGN, MEJAIRE, nextHour, VORTEX_DEFAULT_PARAMS, WAVE_MONSTER_IDS } from '../src/dungeons/vortex/constants'
import { fallbackHourCosts, measureHourCosts } from '../src/dungeons/vortex/hourCost'
import { createPhase2Fight } from '../src/dungeons/vortex/micro'
import { createVortexAIModel } from '../src/dungeons/vortex/model'
import { KillOracle, planHours, plannerConfig, type PlannerContext } from '../src/dungeons/vortex/planner'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { createEngine } from '../src/engine'
import { createMonsterFighter } from '../src/engine/factory'
import type { FightState } from '../src/engine/types'
import { buildTeam } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'

const DATA = loadDataStore('data')
const theta = loadTheta()
const META = 'cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu'
const notes: string[] = []

// ── combat réel au tour 8 (créneau d'un personnage), monstres des vagues 1-2 présents ──
const engine = createEngine(DATA, vortexHooks)
const team = buildTeam(DATA, parseTeam(META, DATA))
for (const p of team) p.hp = p.maxHp = p.baseMaxHp = 1_000_000 // personne ne meurt pendant l'avance passive
const fight: FightState = createVortexFight(engine, team, { params: VORTEX_DEFAULT_PARAMS, seed: 5, rollMode: 'random', record: false, rngRekey: 'perTurn' })
for (let i = 0; i < 4000 && !fight.ended; i++) {
  const f = engine.nextTurn(fight)
  if (!f) break
  if (fight.round >= 8 && f.kind === 'player') break
  engine.endTurn(fight, f)
}
const me = engine.current(fight)!
const players = fight.fighters.filter(f => f.alive && f.kind === 'player')
const dpt = createDptTable(engine)
const measured = measureHourCosts(engine, { params: VORTEX_DEFAULT_PARAMS, theta, team: players })
const slots = forecastHours(fight, 8, VORTEX_DEFAULT_PARAMS)
const realRoot = absFromFight(fight, slots, { threatOf: m => 0.75 * dpt.dpt(m, players[0]) })
const oracle = new KillOracle(theta.planner.oracleAlpha)
for (const p of players) {
  for (const m of fight.fighters) if (m.alive && isWaveMonster(m)) oracle.setDpt(p.id, { id: m.id }, dpt.dpt(p, m), deathHours(m))
  for (const id of WAVE_MONSTER_IDS) oracle.setDpt(p.id, { monsterId: id }, dpt.dpt(p, createMonsterFighter(DATA, { monsterId: id, grade: 5, team: 1 })))
}
oracle.nowPlayer = me.id
const realCtx: PlannerContext = {
  slots, costs: measured, abs: absParamsOf(fight), players: players.length,
  expected: (i, p, m) => oracle.expected(i, p, m), canContract: () => true, glyphsNow: 1, glyphBonusNow: 0,
}

// ── état synthétique chargé : 8 vivants (4 marqués), 4 en attente ──
function cycleSlots(rounds: number): ClockSlot[] {
  const out: ClockSlot[] = []
  let h = 8
  for (let r = 6; r < 6 + rounds; r++) {
    const tl: [number, boolean][] = [[0, true], [10, false], [1, true], [11, false], [2, true], [12, false], [3, true], [13, false], [20, false], [21, false], [22, false], [23, false], [4, false]]
    tl.forEach(([id, pl], index) => {
      if (pl) h = nextHour(h, 1)
      out.push({ round: r, index, fighterId: id, isPlayer: pl, isVortex: id === 4, hour: h })
    })
  }
  return out
}
const mon = (id: number, monsterId: number, o: Partial<AbsMonster> = {}): AbsMonster =>
  ({ id, monsterId, wave: 1, status: 'alive', hp: 6600, maxHp: 6600, hours: 0, star: false, corruptOnWake: false, threat: 900, baseMaxHp: 6600, ...o })
const synSlots = cycleSlots(9)
const synRoot: AbsState = {
  slotIdx: 0, hour: synSlots[0].hour, glyphShift: 0, round: 6, vortexTurns: 5, hoursUsed: (1 << 8) | (1 << 9) | (1 << 11) | 1, score: 0, trace: null,
  monsters: [
    mon(10, IKARGN, { hours: 1 << 8, hp: 1650, star: true }), mon(11, MEJAIRE, { hours: 1 << 9, hp: 1650 }), mon(12, HARPILLE, { hours: 1 << 11, hp: 1650 }),
    mon(13, BUBOXOR, { hours: 1, hp: 1650 }), mon(20, HARPILLE), mon(21, HARPILLE), mon(22, BUBOXOR), mon(23, BRABUZAR),
    ...[IKARGN, MEJAIRE, MEJAIRE, BRABUZAR].map((id, k) => mon(-(30 + k), id, { status: 'pending', hp: 0, arrivesRound: 7 })),
  ],
}
const E: Record<number, number> = { 0: 4400, 1: 2600, 2: 800, 3: 3000 }
const synCtx: PlannerContext = {
  slots: synSlots, costs: fallbackHourCosts(), players: 4, glyphsNow: 1, glyphBonusNow: 0,
  expected: (i, p, m) => E[p] * (m.hours & 16 ? 0.7 : 1) * (i === 0 ? 1 : 0.85), canContract: p => p !== 2,
}
const cfg = (mode: AIMode) => plannerConfig(mode, theta)

// ── modèle complet ──
const model = { fast: createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta), standard: createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta) }
const view = createView(engine, fight, me, 7)
const bb = emptyBlackboard()
const perception = createPerception(view, { theta }, model.standard, { bb })
const updateOnce = (mode: 'fast' | 'standard') => {
  // Cache `fast` invalidé à chaque appel (mesure du coût non caché d'une mise à jour).
  ;(model[mode] as unknown as { cache?: unknown }).cache = undefined
  model[mode].update(view, emptyBlackboard(), perception, mode)
}

// ── phase 2 ──
const p2engine = createEngine(DATA, vortexHooks)
const p2fight = createPhase2Fight(p2engine, buildTeam(DATA, parseTeam(META, DATA)), { params: { ...VORTEX_DEFAULT_PARAMS, phase2Hours: [2, 7, 10] }, seed: 5, rollMode: 'random', record: false, rngRekey: 'perTurn' })
const p2me = p2engine.nextTurn(p2fight)!
const p2view = createView(p2engine, p2fight, p2me, 1)

/** Mesure ad hoc (ms par appel) imprimée en fin de banc, avec la cible. */
function measure(label: string, targetMs: number, n: number, fn: () => unknown): void {
  for (let i = 0; i < Math.min(20, n); i++) fn()
  const t0 = performance.now()
  for (let i = 0; i < n; i++) fn()
  const ms = (performance.now() - t0) / n
  const verdict = ms <= targetMs ? 'OK' : ms <= targetMs * 1.2 ? 'avertissement (+20 %)' : ms <= targetMs * 2 ? 'au-dessus de la cible' : 'ÉCHEC (×2)'
  notes.push(`${label} : ${ms.toFixed(2)} ms (cible ${targetMs} ms) — ${verdict}`)
}

describe('B7 — HourPlanner', () => {
  bench('standard — combat réel tour 8', () => {
    planHours(realRoot, realCtx, cfg('standard'))
  })
  bench('standard — synthétique 8 vivants + 4 en attente', () => {
    planHours(synRoot, synCtx, cfg('standard'))
  })
  bench('fast — combat réel tour 8', () => {
    planHours(realRoot, realCtx, cfg('fast'))
  })
  bench('deep — combat réel tour 8', () => {
    planHours(realRoot, realCtx, cfg('deep'))
  }, { time: 0, iterations: 30, warmupIterations: 3 })
})

describe('WP3b — coûts, modèle, burst', () => {
  bench('measureHourCosts (équipe réelle)', () => {
    measureHourCosts(engine, { params: VORTEX_DEFAULT_PARAMS, theta, team: players })
  }, { time: 0, iterations: 30, warmupIterations: 3 })
  bench('VortexAIModel.update fast (non caché)', () => updateOnce('fast'))
  bench('VortexAIModel.update standard', () => updateOnce('standard'), { time: 0, iterations: 30, warmupIterations: 3 })
  bench('planBurst (phase 2)', () => {
    planBurst(p2view, { theta, params: VORTEX_DEFAULT_PARAMS, dpt: createDptTable(p2engine) })
  })
})

afterAll(() => {
  measure('B7 HourPlanner standard — combat réel', 10, 60, () => planHours(realRoot, realCtx, cfg('standard')))
  measure('B7 HourPlanner standard — synthétique chargé', 10, 60, () => planHours(synRoot, synCtx, cfg('standard')))
  measure('HourPlanner fast — combat réel (non caché)', 1, 200, () => planHours(realRoot, realCtx, cfg('fast')))
  measure('HourPlanner deep — combat réel', 40, 20, () => planHours(realRoot, realCtx, cfg('deep')))
  measure('measureHourCosts', 2, 30, () => measureHourCosts(engine, { params: VORTEX_DEFAULT_PARAMS, theta, team: players }))
  measure('VortexAIModel.update fast (non caché)', 3, 60, () => updateOnce('fast'))
  measure('VortexAIModel.update standard', 20, 30, () => updateOnce('standard'))
  measure('planBurst', 1, 200, () => planBurst(p2view, { theta, params: VORTEX_DEFAULT_PARAMS, dpt: createDptTable(p2engine) }))
  const r = planHours(realRoot, realCtx, cfg('standard'))
  notes.push(`plan standard (tour 8) : ${r.plan.contracts.length} contrats, ${r.expansions} expansions, ${realRoot.monsters.filter(m => m.status !== 'pending').length} monstres présents`)
  console.log(`\n── WP3b, B7 (planificateur d'heures) ──\n${notes.join('\n')}\n`)
})
