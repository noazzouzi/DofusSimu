/**
 * Contrats gelés en S0 (docs/design/ai.md §5, §18.2) : θ par défaut et chargeur, constantes du Vortex cohérentes avec
 * data/dungeons/vortex.json, aides du socle (référence S0), et chaîne complète bouchonnée
 * (build → scénario → contrôleurs → runFight → FightSummary) déterministe.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { budgetFor, createControllers, defaultAIConfig } from '../src/ai'
import { advanceUntil, aiSeed, createView, fighterDigest, forecastSlots, killProbability, mix32, simClone, simSalt, stateHash } from '../src/ai/core'
import { defaultTheta, flattenTheta, loadTheta, thetaHash, thetaWithPaths } from '../src/ai/theta'
import { toActions, type AIMode } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import { getScenario, listScenarios } from '../src/dungeons'
import {
  ARRIVAL_ROUNDS_ALT,
  ARRIVAL_ROUNDS_DEFAULT,
  BLUE_START_CELLS,
  EXTRA_MONSTER_PER_PLAYER,
  HOUR_BONUS,
  HOUR_CELL,
  HOUR_CELL_WALKABLE,
  INTERNAL_SPELL_IDS,
  MONSTER_SPELLS,
  RED_START_CELLS,
  STATE,
  VORTEX,
  VORTEX_DEFAULT_PARAMS,
  VORTEX_HP_BY_GRADE,
  VORTEX_MAP_ID,
  VORTEX_UNCERTAIN,
  WAVES_4P,
  hourOfState,
  nextHour,
  waveComposition,
} from '../src/dungeons/vortex/constants'
import { runFight } from '../src/engine/runner'
import { createEngine } from '../src/engine'
import { buildTeam, runOne } from '../src/optimizer/runner'
import type { FightSpec, MemberSpec } from '../src/optimizer/types'
import { fullScrolls, nakedBuild } from '../src/stats/build'

const thetaJson = JSON.parse(readFileSync(new URL('../data/ai/theta-default.json', import.meta.url), 'utf8'))
const vortexJson = JSON.parse(readFileSync(new URL('../data/dungeons/vortex.json', import.meta.url), 'utf8'))
const data = loadDataStore()

describe('θ (annexe A) : data/ai/theta-default.json et loadTheta', () => {
  it('toutes les sections de l’annexe A, valeurs du JSON', () => {
    const t = loadTheta()
    expect(Object.keys(t)).toEqual(['value', 'threat', 'tactical', 'tactics', 'team', 'planner', 'vortex', 'burst', 'monster'])
    expect(t).toEqual(thetaJson)
    expect(t.value.incoming).toBe(0.8)
    expect(t.tactical.standard.nodes).toBe(1500)
    expect(t.vortex.vortexKill).toBe(20000)
    expect(t.monster.topK).toBe(8)
  })

  it('fusion profonde des surcharges, sans muter les valeurs par défaut', () => {
    const t = loadTheta({ value: { incoming: 0.5, roleUtility: { healer: 3000 } } }, { tactical: { fast: { nodes: 60 } } })
    expect(t.value.incoming).toBe(0.5)
    expect(t.value.roleUtility).toEqual({ healer: 3000, mpLock: 1500, apLock: 1500, placer: 1000 })
    expect(t.value.control).toBe(0.15)
    expect(t.tactical.fast).toEqual({ width: 1, topK: 6, depth: 8, rollouts: 0, nodes: 60 })
    expect(loadTheta().value.incoming).toBe(0.8)
    expect(defaultTheta()).not.toBe(defaultTheta())
  })

  it('clé inconnue ou type invalide : erreur', () => {
    expect(() => loadTheta({ value: { incomming: 1 } } as never)).toThrow(/incomming/)
    expect(() => loadTheta({ value: { roleUtility: 3 } } as never)).toThrow(/roleUtility/)
    expect(() => loadTheta({ value: { incoming: 'x' } } as never)).toThrow(/incoming/)
  })

  it('chemins pointés (réglage L2) et empreinte', () => {
    const flat = flattenTheta(loadTheta())
    expect(flat['planner.failCost']).toBe(800)
    expect(flat['tactics.prior.mpLock']).toBe(1)
    const t2 = thetaWithPaths(loadTheta(), { 'planner.failCost': 900 })
    expect(t2.planner.failCost).toBe(900)
    expect(() => thetaWithPaths(loadTheta(), { 'planner.nope': 1 })).toThrow()
    expect(thetaHash(loadTheta())).toBe(thetaHash(loadTheta()))
    expect(thetaHash(t2)).not.toBe(thetaHash(loadTheta()))
  })
})

describe('constantes du Vortex = data/dungeons/vortex.json', () => {
  it('carte, cases de départ, horloge', () => {
    expect(VORTEX_MAP_ID).toBe(vortexJson.mapId)
    expect([...RED_START_CELLS]).toEqual(vortexJson.map.playerStartCells)
    expect([...BLUE_START_CELLS]).toEqual(vortexJson.map.monsterStartCells)
    for (const h of vortexJson.map.auroraire.hours) {
      expect(HOUR_CELL[h.hour]).toBe(h.auroraireCell)
      expect(HOUR_CELL_WALKABLE[h.hour]).toBe(h.cellWalkable)
      expect(HOUR_BONUS[h.hour]!.stateId).toBe(h.stateId)
      expect(hourOfState(h.stateId)).toBe(h.hour)
    }
    expect(nextHour(12)).toBe(1)
    expect(nextHour(11, 2)).toBe(1)
    expect(nextHour(4, 4)).toBe(8)
  })

  it('vagues, sorts, états, PV du Vortex', () => {
    expect(WAVES_4P.map(w => [...w])).toEqual(vortexJson.waves.compositionByPlayers['4'])
    for (const [n, list] of Object.entries(vortexJson.waves.compositionByPlayers.additionalMonsterPerWaveForPlayer)) expect([...EXTRA_MONSTER_PER_PLAYER[Number(n)]]).toEqual(list)
    expect([...ARRIVAL_ROUNDS_DEFAULT]).toEqual(vortexJson.waves.arrivalRound.default)
    expect([...ARRIVAL_ROUNDS_ALT]).toEqual(vortexJson.waves.arrivalRound.alternative)
    expect(waveComposition(4)).toEqual(WAVES_4P.map(w => [...w]))
    expect(waveComposition(5)[0]).toHaveLength(5)
    for (const m of vortexJson.monsters) expect([...MONSTER_SPELLS[m.id]]).toEqual(m.spells.map((s: { id: number }) => s.id))
    expect([...INTERNAL_SPELL_IDS]).toEqual(vortexJson.internalSpells.map((s: { id: number }) => s.id))
    const stateIds = new Set(vortexJson.states.map((s: { id: number }) => s.id))
    for (const id of Object.values(STATE)) if (id !== STATE.HOUR_STATE_BASE) expect(stateIds.has(id)).toBe(true)
    const boss = vortexJson.monsters.find((m: { id: number }) => m.id === VORTEX)
    for (let g = 1; g <= 5; g++) expect(VORTEX_HP_BY_GRADE[g]).toBe(boss.grades[g - 1].lifePoints)
  })

  it('variantes INCERTAINES : poids normalisés, première valeur = défaut', () => {
    for (const u of VORTEX_UNCERTAIN) {
      expect(u.values.length).toBe(u.weights.length)
      expect(u.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
      expect(u.values[0]).toEqual((VORTEX_DEFAULT_PARAMS as unknown as Record<string, unknown>)[u.key])
    }
    expect(Math.max(...VORTEX_DEFAULT_PARAMS.arrivalRounds)).toBeLessThan(VORTEX_DEFAULT_PARAMS.unlockVortexTurn)
  })
})

describe('socle (référence S0) et configuration', () => {
  it('toActions aplatit déplacement, lancer et séquences', () => {
    expect(toActions({ path: [1, 2], cast: { spellId: 5, cell: 9 }, cat: 'damage', prior: 0, key: 'k',
      seq: [{ cast: { spellId: 6, cell: 3 }, cat: 'control', prior: 0, key: 'k2' }] })).toEqual([
      { type: 'move', path: [1, 2] }, { type: 'cast', spellId: 5, cell: 9 }, { type: 'cast', spellId: 6, cell: 3 },
    ])
    expect(toActions({ path: [4], cat: 'placement', prior: 0, key: 'k' })).toEqual([])
  })

  it('budgets par mode tirés de θ ; configuration complète', () => {
    const theta = loadTheta()
    const modes: AIMode[] = ['scripted', 'fast', 'standard', 'deep']
    const b = Object.fromEntries(modes.map(m => [m, budgetFor(m, theta)]))
    expect(b.fast).toMatchObject({ maxNodes: 40, width: 1, topK: 6, maxDepth: 8, rollouts: 0 })
    expect(b.standard).toMatchObject({ maxNodes: 1500, width: 6, topK: 12, maxDepth: 6, rollouts: 3, keyDecisionBoost: 2, maxKeyDecisions: 12 })
    expect(b.deep).toMatchObject({ maxNodes: 15000, width: 12, topK: 20, mctsIterations: 1500, maxKeyDecisions: 30 })
    expect(b.scripted.maxNodes).toBe(0)
    const cfg = defaultAIConfig('fast', 42)
    expect(cfg.monster).toEqual({ topK: 8, predictTopK: 4, noiseTau: 0, referenceTopK: 24 })
    expect(cfg.seed).toBe(defaultAIConfig('fast', 42).seed)
    expect(cfg.seed).not.toBe(defaultAIConfig('fast', 43).seed)
    expect(aiSeed(1, 2, 3, 4)).toBe(aiSeed(1, 2, 3, 4))
  })

  it('stateHash : transpositions (ordre et uid des buffs ignorés), sensible à la case et aux PV ; simSalt 64 bits', () => {
    const scenario = getScenario('vortex')
    const engine = createEngine(data, scenario.hooks)
    const fight = scenario.createFight(engine, team(), { params: scenario.defaultParams, seed: 9, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    const effect = data.spellLevel(5015, { grade: 1 })!.effects[0]
    const buff = (s: typeof fight, target: number, sourceId: number, value: number) =>
      engine.addBuff(s, s.fighters[target], { sourceId, spellId: 5015, effect, value, remaining: 2, delay: 0, dispellable: true, label: 'test', kind: 'special' })
    const x = engine.cloneFight(fight)
    const y = engine.cloneFight(fight)
    expect(stateHash(x)).toBe(stateHash(fight))
    buff(x, 0, 4, 10)
    buff(x, 1, 5, 20)
    buff(y, 1, 5, 20)
    buff(y, 0, 4, 10)
    expect(x.fighters[0].buffs.at(-1)!.uid).not.toBe(y.fighters[0].buffs.at(-1)!.uid)
    expect(stateHash(x)).toBe(stateHash(y))
    expect(fighterDigest(x.fighters[0])).toBe(fighterDigest(y.fighters[0]))
    expect(stateHash(x)).not.toBe(stateHash(fight))
    const z = engine.cloneFight(y)
    z.fighters[2].hp -= 50
    expect(stateHash(z)).not.toBe(stateHash(y))
    const w = engine.cloneFight(y)
    w.fighters[2].cell = RED_START_CELLS.find(c => !w.fighters.some(f => f.cell === c))!
    expect(stateHash(w)).not.toBe(stateHash(y))
    expect(fighterDigest(w.fighters[2])).not.toBe(fighterDigest(y.fighters[2]))
    // Morts : les buffs conservés (heures de mort du Vortex, indissipables) distinguent deux états.
    const victim = y.fighters.findIndex(f => f.team === 1)
    const d1 = engine.cloneFight(y)
    const d2 = engine.cloneFight(y)
    engine.addBuff(d2, d2.fighters[victim], { sourceId: 0, spellId: 5015, effect: { ...effect, dispellable: 4 }, value: 7, remaining: -1, delay: 0, dispellable: false, label: 'heure', kind: 'special' })
    engine.kill(d1, d1.fighters[victim])
    engine.kill(d2, d2.fighters[victim])
    expect(stateHash(d1)).not.toBe(stateHash(d2))
    const h = stateHash(x)
    expect(simSalt(h, 2)).toBe(simSalt(h, 2))
    expect(simSalt(h, 2)).not.toBe(simSalt(h, 3))
    expect(simSalt(h, 2)).toBeLessThan(2 ** 32)
  })

  it('killProbability : bornes et monotonie', () => {
    expect(killProbability(1000, 0, 999)).toBe(1)
    expect(killProbability(1000, 0, 1001)).toBe(0)
    expect(killProbability(1000, 100 ** 2, 1000)).toBeCloseTo(0.5, 6)
    expect(killProbability(1200, 100 ** 2, 1000)).toBeGreaterThan(0.95)
    expect(killProbability(800, 100 ** 2, 1000)).toBeLessThan(0.05)
  })

  it('vue, prévision des tours, clone honnête et avance du temps sur la vraie salle du Vortex', () => {
    const scenario = getScenario('vortex')
    const engine = createEngine(data, scenario.hooks)
    const fight = scenario.createFight(engine, team(), { params: scenario.defaultParams, seed: 5, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    const first = engine.nextTurn(fight)!
    const view = createView(engine, fight, first, 77)
    const slots = forecastSlots(engine, fight, 10)
    expect(slots).toHaveLength(10)
    expect(view.upcoming(3)).toEqual(slots.slice(0, 3))
    expect(slots[0].fighterId).not.toBe(first.id)
    const rng = fight.rngState
    const c = simClone(view, fight, 123)
    expect(c.options.rollMode).toBe('average')
    expect(c.options.record).toBe(false)
    expect(fight.rngState).toBe(rng)
    // E1 dans les clones : les débuts de tour simulés re-sèment depuis la graine IA, jamais depuis la vraie graine.
    expect(c.options.rngRekey).toBe('perTurn')
    expect(c.options.seed).toBe(mix32(77 ^ 0x5bd1e995, 123) | 0)
    expect(fight.options.seed).toBe(5)
    const cfg = defaultAIConfig('fast', 5)
    const next = advanceUntil(engine, c, createControllers(engine, cfg), f => f.id !== first.id)
    expect(next).toBeDefined()
    expect(c.rngState).not.toBe(mix32(mix32(5, c.round), next!.id) | 0)
    expect(fight.rngState).toBe(rng)
    expect(fight.round).toBe(1)
    const later = advanceUntil(engine, c, createControllers(engine, cfg), f => f.kind === 'player' && f.id !== first.id)
    expect(later === undefined || later.kind === 'player').toBe(true)
    expect(fight.rngState).toBe(rng)
  })
})

function member(name: string, breedId: number): MemberSpec {
  return { name, breedId, presetId: 'naked', build: { ...nakedBuild(breedId, 200, name), scrolls: fullScrolls() }, variants: [] }
}
const MEMBERS = (): MemberSpec[] => [member('Iop', 8), member('Crâ', 9), member('Enutrof', 3), member('Pandawa', 12)]
const team = () => buildTeam(data, MEMBERS())

describe('chaîne complète bouchonnée (S0)', () => {
  const spec: FightSpec = {
    scenarioId: 'vortex',
    team: MEMBERS(),
    mode: 'fast',
    theta: loadTheta(),
    variantPolicy: 'default',
    monsterNoise: 0,
  }

  it('le registre connaît le Vortex', () => {
    expect(listScenarios()).toContain('vortex')
    expect(() => getScenario('nope')).toThrow(/nope/)
  })

  it('runOne termine, résume et est reproductible (même hash avec la même graine)', () => {
    const a = runOne(data, spec, 11, { record: true })
    const b = runOne(data, spec, 11, { record: true })
    const quiet = runOne(data, spec, 11, { record: false })
    expect(a.fight.ended).toBe(true)
    expect(a.summary.eventsHash).not.toBe(0)
    expect(a.summary.eventsHash).toBe(b.summary.eventsHash)
    expect(quiet.summary.rounds).toBe(a.summary.rounds)
    expect(quiet.summary.win).toBe(a.summary.win)
    expect(quiet.summary.damageTaken).toBe(a.summary.damageTaken)
    // Empreinte indépendante de l'enregistrement (les lots ne sont jamais enregistrés, §13.2) et sensible à la graine.
    expect(quiet.summary.eventsHash).toBe(a.summary.eventsHash)
    expect(quiet.summary).toEqual({ ...a.summary, spellUse: quiet.summary.spellUse })
    expect(runOne(data, spec, 12, { record: false }).summary.eventsHash).not.toBe(a.summary.eventsHash)
    expect(a.summary.unknownEffects).toBeGreaterThanOrEqual(0)
    expect(a.summary.score).toBeGreaterThanOrEqual(0)
  })

  it('createControllers : un ControllerProvider pour runFight, avec stats et instantané', () => {
    const scenario = getScenario('vortex')
    const engine = createEngine(data, scenario.hooks)
    const fight = scenario.createFight(engine, team(), { params: scenario.defaultParams, seed: 3, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    fight.options.maxRounds = 3
    const provider = createControllers(engine, defaultAIConfig('fast', 3))
    runFight(engine, fight, provider)
    expect(fight.ended).toBe(true)
    // Le contrôleur d'équipe réel (WP2) cherche : des nœuds sont simulés.
    expect(provider.stats().nodes).toBeGreaterThan(0)
    const snap = provider.snapshot()
    expect(() => provider.restore(snap)).not.toThrow()
  })
})
