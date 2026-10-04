/**
 * Combats complets (sans IA ni CLI) sur le moteur et les données RÉELS : `runVortexSmoke` (30 tours, replay accepté par
 * src/replay/validate), micro-scénarios (prefix12, phase2, poutch), scénarios génériques (escarmouche, mannequin),
 * modèle stratégique de base du Vortex.
 */
import { describe, expect, it } from 'vitest'
import { emptyBlackboard } from '../src/ai/team/controller'
import { createView } from '../src/ai/core'
import { loadTheta } from '../src/ai/theta'
import type { Perception } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import { getScenario } from '../src/dungeons'
import { nearestAttackController, scriptedVortexController, uniformProvider } from '../src/dungeons/generic/controllers'
import { mixResistances, VORTEX_TARGET_MIX } from '../src/dungeons/generic/dummy'
import { BOUFTOU } from '../src/dungeons/generic/skirmish'
import { forecastHours, isWaveMonster, lineCells, nextVortexSlot } from '../src/dungeons/vortex/clock'
import { VORTEX, VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { evaluatePrefix12, phase2Micro, poutchMicro, prefix12Micro, rationalSigmoid, samplePhase2Hours } from '../src/dungeons/vortex/micro'
import { vortexState } from '../src/dungeons/vortex/params'
import { basicVortexAIModel, createSmokeTeam, runVortexSmoke, vortexPhase, vortexScenario, vortexVulnerableAt } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { createEngine } from '../src/engine'
import { runFight } from '../src/engine/runner'
import type { FightState } from '../src/engine/types'
import { eventsHash } from '../src/optimizer/runner'
import { ReplayTimeline } from '../src/replay/reducer'
import { parseReplay } from '../src/replay/validate'

const data = loadDataStore('data')

describe('runVortexSmoke : 30 tours du vrai scénario, replay valide', () => {
  for (const seed of [1, 2, 3]) {
    it(`graine ${seed}`, () => {
      const r = runVortexSmoke(seed, { data })
      const { fight, summary } = r
      // 30 tours joués (fin par la limite de tours), toutes les vagues arrivées, aucune exception.
      expect(fight.ended).toBe(true)
      expect(fight.endReason).toBe('Limite de tours atteinte')
      expect(summary.rounds).toBe(30)
      expect(fight.round).toBe(31)
      const vx = vortexState(fight)!
      expect(vx.waveRounds).toEqual([1, 7, 12, 17, 22])
      expect(vx.vortexTurns).toBe(30)
      expect(fight.unknownEffects ?? 0).toBe(0)
      expect(summary.corruptedByRound).toHaveLength(30)
      expect(summary.progress).toBeGreaterThanOrEqual(0)
      expect(summary.progress).toBeLessThanOrEqual(1)
      // Mécaniques exercées : morts, résurrections (événements summon), heures posées, glyphes.
      expect(fight.deaths?.length ?? 0).toBeGreaterThan(0)
      expect(fight.events.filter(e => e.t === 'summon').length).toBeGreaterThan(1)
      expect(fight.events.filter(e => e.t === 'wave')).toHaveLength(5)
      expect(fight.events.some(e => e.t === 'glyph' && e.added)).toBe(true)
      // Replay : sérialisable, accepté sans avertissement par la validation, rejouable par le réducteur.
      const replay = parseReplay(JSON.parse(JSON.stringify(r.replay)))
      expect(replay.warnings).toBeUndefined()
      expect(replay.events.length).toBe(fight.events.length)
      const tl = new ReplayTimeline(replay)
      const last = tl.stateAt(replay.events.length - 1)
      expect(last.ended).toBeDefined()
      expect(tl.markers.filter(m => m.kind === 'wave')).toHaveLength(5)
    })
  }

  it('déterministe : même graine ⇒ mêmes événements', () => {
    const a = runVortexSmoke(9, { data, rounds: 12 })
    const b = runVortexSmoke(9, { data, rounds: 12 })
    expect(eventsHash(a.fight.events)).toBe(eventsHash(b.fight.events))
    const c = runVortexSmoke(10, { data, rounds: 12 })
    expect(eventsHash(c.fight.events)).not.toBe(eventsHash(a.fight.events))
  })

  it('contrôleur passif : 30 tours sans action, horloge et vagues seules', () => {
    const r = runVortexSmoke(4, { data, controller: 'pass' })
    expect(r.fight.round).toBe(31)
    expect(r.fight.fighters.filter(isWaveMonster)).toHaveLength(19)
    expect(r.summary.hoursUsed).toBe(0)
  })
})

/** Joue un micro-scénario jusqu'à `done` avec un fournisseur de contrôleurs. */
function playMicro(fight: FightState, engine: ReturnType<typeof createEngine>, done: (f: FightState) => boolean): void {
  const ctrl = uniformProvider(scriptedVortexController())
  for (let i = 0; i < 4000 && !fight.ended && !done(fight); i++) {
    const f = engine.nextTurn(fight)
    if (!f) break
    if (done(fight)) break
    ctrl(f).playTurn(engine, fight, f)
    if (!fight.ended && f.alive) engine.endTurn(fight, f)
  }
}

describe('micro-scénarios', () => {
  it('prefix12 : s’arrête après le tour 12, vagues 1-3 apparues, P(victoire) dans [0, 1]', () => {
    const engine = createEngine(data, vortexHooks)
    const team = createSmokeTeam(data, undefined, { hp: 60_000 })
    const fight = prefix12Micro.createFight(engine, team, { params: VORTEX_DEFAULT_PARAMS, seed: 3, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    playMicro(fight, engine, prefix12Micro.done)
    expect(prefix12Micro.done(fight)).toBe(true)
    expect(vortexState(fight)!.waveRounds).toEqual([1, 7, 12])
    const res = prefix12Micro.evaluate(fight)
    expect(res.metrics.spawned).toBe(11)
    expect(res.pWin).toBeGreaterThan(0)
    expect(res.pWin).toBeLessThan(1)
    expect(res.rounds).toBe(12)
    expect(evaluatePrefix12(fight)).toEqual(res)
    expect(rationalSigmoid(0)).toBe(0.5)
    expect(rationalSigmoid(5)).toBeGreaterThan(rationalSigmoid(1))
  })

  it('phase2 : Action ! des données avant le 1er tour (heures VIII et VII héritées), Vortex vulnérable ensuite', () => {
    const engine = createEngine(data, vortexHooks)
    const team = createSmokeTeam(data, undefined, { hp: 60_000 })
    const fight = phase2Micro.createFight(engine, team, { params: { ...VORTEX_DEFAULT_PARAMS, phase2Hours: [8, 7] }, seed: 1, rollMode: 'random', record: true, rngRekey: 'perTurn' })
    const vx = vortexState(fight)!
    const vortex = fight.fighters[vx.vortexId]
    // 5009 : +4 PA (VIII), +150 rés. critiques (VII) ; Vortexiphan retiré ; monstres tués ; invulnérable + tour passé.
    expect(vortex.stats.ap).toBe(20)
    expect(vortex.stats.mp).toBe(5)
    expect(vortex.stats.criticalRes).toBeGreaterThanOrEqual(150)
    expect(fight.fighters.filter(isWaveMonster).every(m => !m.alive)).toBe(true)
    expect(vortex.states).toContain(56)
    expect(team.map(p => p.cell)).toEqual(vx.startCells)
    playMicro(fight, engine, phase2Micro.done)
    const res = phase2Micro.evaluate(fight)
    expect(res.progress).toBeGreaterThan(0) // le Vortex a perdu des PV après le tour invulnérable
    expect([0, 1]).toContain(res.pWin)
  })

  it('phase2 : heures tirées par graine (déterministe, heures distinctes)', () => {
    const h = samplePhase2Hours(5)
    expect(h).toEqual(samplePhase2Hours(5))
    expect(new Set(h).size).toBe(h.length)
    expect(h.length).toBe(4)
  })

  it('poutch : 3 tours contre le mannequin, dégâts par personnage', () => {
    const engine = createEngine(data, vortexHooks)
    const team = createSmokeTeam(data)
    const fight = poutchMicro.createFight(engine, team, { params: VORTEX_DEFAULT_PARAMS, seed: 2, rollMode: 'average', record: false, rngRekey: 'none' })
    runFight(engine, fight, uniformProvider(nearestAttackController()))
    expect(poutchMicro.done(fight)).toBe(true)
    const res = poutchMicro.evaluate(fight)
    expect(res.metrics.totalDamage).toBeGreaterThan(0)
    expect(Object.keys(res.metrics).filter(k => k.startsWith('dpt_'))).toHaveLength(4)
    const dummy = fight.fighters.find(f => f.team === 1)!
    expect(dummy.alive).toBe(true)
    expect(dummy.tags.dummy).toBe(true)
  })
})

describe('scénarios génériques', () => {
  it('escarmouche : 4 personnages contre 4 Bouftous ⇒ victoire en ≤ 3 tours', () => {
    const sc = getScenario('skirmish')
    const engine = createEngine(data, sc.hooks)
    const team = createSmokeTeam(data)
    const fight = sc.createFight(engine, team, { params: sc.defaultParams, seed: 1, rollMode: 'random', record: true, rngRekey: 'perTurn' })
    expect(fight.fighters.filter(f => f.team === 1 && f.monsterId === BOUFTOU)).toHaveLength(4)
    runFight(engine, fight, uniformProvider(nearestAttackController()))
    const sum = sc.summarize(fight)
    expect(sum.win).toBe(true)
    expect(sum.rounds).toBeLessThanOrEqual(3)
    expect(sum.progress).toBe(1)
    expect(parseReplay({ events: fight.events, map: fight.map }).warnings).toBeUndefined()
  })

  it('mannequin : passif, résistances du mix Vortex, pas de fin avant la limite', () => {
    const sc = getScenario('dummy')
    const engine = createEngine(data, sc.hooks)
    const fight = sc.createFight(engine, createSmokeTeam(data), { params: sc.defaultParams, seed: 1, rollMode: 'average', record: false, rngRekey: 'none' })
    const dummy = fight.fighters.find(f => f.team === 1)!
    const res = mixResistances(data, VORTEX_TARGET_MIX)
    expect(dummy.stats.earthResPct).toBe(res[1])
    expect(dummy.maxHp).toBe(1_000_000)
    runFight(engine, fight, uniformProvider(nearestAttackController()))
    const sum = sc.summarize(fight)
    expect(sum.win).toBe(false)
    expect(sum.extra?.totalDamage).toBeGreaterThan(0)
    expect(sum.progress).toBeGreaterThan(0)
  })
})

describe('modèle stratégique de base du Vortex', () => {
  const stubPerception = {} as Perception

  it('phase, vulnérabilité, lignes de l’Auroraire au prochain créneau du Vortex', () => {
    const engine = createEngine(data, vortexHooks)
    const team = createSmokeTeam(data, undefined, { hp: 1_000_000 })
    const fight = createVortexFight(engine, team, { params: VORTEX_DEFAULT_PARAMS, seed: 1, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    const model = vortexScenario.aiModel(VORTEX_DEFAULT_PARAMS, loadTheta())
    expect(model.roleNeeds?.()).toMatchObject({ killer: 2, mpLock: 1 })
    // Tour 2 : En temps et en heure frappera au créneau du Vortex.
    let p1 = engine.nextTurn(fight)!
    for (let i = 0; i < 30 && !(fight.round === 2 && p1.id === team[0].id); i++) {
      engine.endTurn(fight, p1)
      p1 = engine.nextTurn(fight)!
    }
    const bb = emptyBlackboard()
    model.update(createView(engine, fight, p1, 1), bb, stubPerception, 'fast')
    expect(bb.phase).toBe('waveCycle')
    expect(vortexPhase(fight)).toBe('waveCycle')
    const slots = forecastHours(fight, 2, VORTEX_DEFAULT_PARAMS)
    const vh = slots[nextVortexSlot(slots, 1)].hour
    expect(vh).toBe(8)
    const onLine = Array.from(lineCells(vh)).find(c => fight.map.cells[c]?.walkable)!
    const p4 = team[3]
    // P1 (créneau courant) ne rejoue pas avant le Vortex : sur la croix, il prend En temps et en heure.
    expect(model.extraIncoming!(fight, p1, onLine)).toBeGreaterThan(300)
    // P4 joue avant le Vortex : il peut encore sortir de la ligne (pas de dégâts comptés ici).
    expect(model.extraIncoming!(fight, p4, onLine)).toBe(0)
    const off = fight.map.cells.findIndex((c, i) => c.walkable && !Array.from(lineCells(vh)).includes(i))
    expect(model.extraIncoming!(fight, p1, off)).toBe(0)
    const vortex = fight.fighters.find(f => f.monsterId === VORTEX)!
    expect(vortexVulnerableAt(fight, vortex, 0)).toBe(false)
    const ika = fight.fighters.find(f => isWaveMonster(f))!
    expect(vortexVulnerableAt(fight, ika, 0)).toBe(true)
  })

  it('basicVortexAIModel : P1 sur la croix de l’heure du Vortex reçoit des dégâts attendus', () => {
    const engine = createEngine(data, vortexHooks)
    const team = createSmokeTeam(data, undefined, { hp: 1_000_000 })
    const fight = createVortexFight(engine, team, { params: VORTEX_DEFAULT_PARAMS, seed: 1, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    const model = basicVortexAIModel(VORTEX_DEFAULT_PARAMS)
    // Tour 2, créneau de P4 (dernier joueur avant le Vortex) : P1-P3 ne rejouent pas avant lui.
    let f = engine.nextTurn(fight)!
    for (let i = 0; i < 40 && !(fight.round === 2 && f.id === team[3].id); i++) {
      engine.endTurn(fight, f)
      f = engine.nextTurn(fight)!
    }
    model.update(createView(engine, fight, f, 1), emptyBlackboard(), stubPerception, 'fast')
    const cells = Array.from(lineCells(8)).filter(c => fight.map.cells[c]?.walkable)
    const hit = model.extraIncoming!(fight, team[0], cells[0])
    expect(hit).toBeGreaterThan(300)
    expect(model.extraIncoming!(fight, team[3], cells[0])).toBe(hit) // P4 joue maintenant : il ne rejoue pas avant
  })
})
