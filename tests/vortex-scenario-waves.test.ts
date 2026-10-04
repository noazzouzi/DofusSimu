/**
 * Outils génériques des scénarios (src/dungeons/waves.ts) et escarmouche sur une autre carte, sur le moteur et les
 * données RÉELS : cases libres (repli quand les cases bleues sont prises), insertion des arrivants dans la timeline
 * (ordre des présents figé, initiative décroissante dans l'équipe), reconstruction de la timeline (équipe qui commence,
 * invocations après leur invocateur), invulnérabilité d'arrivée.
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { getScenario } from '../src/dungeons'
import { nearestAttackController, uniformProvider } from '../src/dungeons/generic/controllers'
import { isWaveMonster } from '../src/dungeons/vortex/clock'
import { AURORAIRE, BLUE_START_CELLS, BRABUZAR, BUBOXOR, HARPILLE, IKARGN, VORTEX, VORTEX_DEFAULT_PARAMS, VORTEX_MAP_ID } from '../src/dungeons/vortex/constants'
import { vortexState } from '../src/dungeons/vortex/params'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { BLUE_SPAWN_ORDER, createVortexFight, spawnVortexWave, vortexHooks } from '../src/dungeons/vortex/setup'
import {
  addArrivalInvulnerability,
  arrivalInvulnerableUntil,
  averageInitiative,
  bestInitiative,
  expireArrivalInvulnerability,
  insertNewcomers,
  pickFreeCells,
  rebuildTimeline,
  spawnWave,
  startingTeam,
} from '../src/dungeons/waves'
import { createEngine } from '../src/engine'
import { initiativeOf, type Engine } from '../src/engine/engine'
import { createMonsterFighter } from '../src/engine/factory'
import { runFight } from '../src/engine/runner'
import type { Fighter, FightState } from '../src/engine/types'
import { distance } from '../src/map/geometry'

const data = loadDataStore('data')

function vortexFight(o: { initiative?: number; seed?: number } = {}): { engine: Engine; fight: FightState; players: Fighter[] } {
  const engine = createEngine(data, vortexHooks)
  const players = createSmokeTeam(data, undefined, { initiative: o.initiative ?? 4000, hp: 1_000_000 })
  const fight = createVortexFight(engine, players, { params: VORTEX_DEFAULT_PARAMS, seed: o.seed ?? 1, rollMode: 'random', record: true, rngRekey: 'perTurn' })
  return { engine, fight, players }
}

/** Vérifie la règle d'insertion d'un arrivant `n` (timeline après insertion). */
function checkInsertion(fight: FightState, n: Fighter): void {
  const tl = fight.timeline
  const at = tl.indexOf(n.id)
  expect(at).toBeGreaterThanOrEqual(0)
  // Coéquipiers racines présents AVANT l'arrivant : initiative ≥ la sienne (sinon il serait passé devant).
  for (let i = 0; i < at; i++) {
    const f = fight.fighters[tl[i]]
    if (f.team === n.team && f.summonerId === undefined && f.tags.startCell !== undefined && f.wave !== n.wave) {
      expect(initiativeOf(f)).toBeGreaterThanOrEqual(initiativeOf(n))
    }
  }
  // Le premier coéquipier racine (d'une autre vague) après lui a une initiative strictement inférieure.
  for (let i = at + 1; i < tl.length; i++) {
    const f = fight.fighters[tl[i]]
    if (f.team !== n.team || f.summonerId !== undefined || f.wave === n.wave) continue
    expect(initiativeOf(f)).toBeLessThan(initiativeOf(n))
    break
  }
}

describe('cases libres (pickFreeCells)', () => {
  it('cases candidates libres d’abord, dans l’ordre', () => {
    const { engine, fight } = vortexFight()
    const occupied = new Set(fight.fighters.filter(f => f.alive).map(f => f.cell))
    const cells = pickFreeCells(engine, fight, BLUE_SPAWN_ORDER, 4)
    expect(cells).toEqual(BLUE_SPAWN_ORDER.filter(c => !occupied.has(c)).slice(0, 4))
  })

  it('cases bleues toutes prises : repli sur les cases libres les plus proches (parcours en largeur)', () => {
    const { engine, fight } = vortexFight()
    // Occupe toutes les cases bleues libres.
    for (const c of BLUE_START_CELLS) {
      if (!engine.isCellFree(fight, c)) continue
      engine.addFighter(fight, createMonsterFighter(data, { monsterId: BUBOXOR, grade: 1, team: 1, cell: c }))
    }
    expect(BLUE_START_CELLS.every(c => !engine.isCellFree(fight, c))).toBe(true)
    const cells = pickFreeCells(engine, fight, BLUE_SPAWN_ORDER, 4)
    expect(cells).toHaveLength(4)
    expect(new Set(cells).size).toBe(4)
    for (const c of cells) {
      expect(engine.isCellFree(fight, c)).toBe(true)
      expect(Math.min(...BLUE_START_CELLS.map(b => distance(b, c)))).toBeLessThanOrEqual(2)
    }
    // Exclusions respectées.
    const again = pickFreeCells(engine, fight, BLUE_SPAWN_ORDER, 4, new Set(cells))
    expect(again.some(c => cells.includes(c))).toBe(false)
  })

  it('vague du Vortex quand les cases bleues sont prises : aucun monstre perdu, aucune case partagée', () => {
    const { engine, fight } = vortexFight()
    for (const c of BLUE_START_CELLS) {
      if (engine.isCellFree(fight, c)) engine.addFighter(fight, createMonsterFighter(data, { monsterId: HARPILLE, grade: 1, team: 1, cell: c }))
    }
    // Premier tour joué (vague forcée au tour 1 pour le test).
    engine.nextTurn(fight)
    const arrived = spawnVortexWave(engine, fight, 2)
    expect(arrived).toHaveLength(4)
    const cells = fight.fighters.filter(f => f.alive).map(f => f.cell)
    expect(new Set(cells).size).toBe(cells.length)
    for (const m of arrived) expect(fight.map.cells[m.cell].walkable).toBe(true)
    expect(vortexState(fight)!.wavesSpawned).toBe(2)
    expect(fight.events.filter(e => e.t === 'wave' && e.index === 2)).toHaveLength(1)
  })
})

describe('timeline : arrivants et équipe qui commence', () => {
  it('vagues réelles : chaque arrivant inséré selon son initiative, ordre des présents inchangé', () => {
    const { engine, fight } = vortexFight({ seed: 4 })
    let checked = 0
    for (let i = 0; i < 4000 && fight.round < 23; i++) {
      const before = fight.timeline.slice()
      const prevWaves = vortexState(fight)!.wavesSpawned
      const f = engine.nextTurn(fight)
      if (!f) break
      const vx = vortexState(fight)!
      if (vx.wavesSpawned > prevWaves) {
        const arrivals = fight.fighters.filter(m => isWaveMonster(m) && m.wave === vx.wavesSpawned)
        expect(arrivals).toHaveLength(4)
        // Les présents (encore vivants) gardent leur ordre relatif.
        const kept = fight.timeline.filter(id => before.includes(id))
        expect(kept).toEqual(before.filter(id => fight.timeline.includes(id)))
        for (const a of arrivals) {
          checkInsertion(fight, a)
          checked++
        }
      }
      engine.endTurn(fight, f)
    }
    expect(checked).toBe(16)
  })

  it('insertNewcomers : avant le premier coéquipier moins rapide, sinon après le dernier et ses invocations', () => {
    const { engine, fight } = vortexFight()
    const vortex = fight.fighters.find(f => f.monsterId === VORTEX)!
    const aur = fight.fighters.find(f => f.monsterId === AURORAIRE)!
    // Arrivant le plus lent possible : après le dernier coéquipier ET l'Auroraire si le Vortex est le dernier.
    const slow = createMonsterFighter(data, { monsterId: BRABUZAR, grade: 1, team: 1, cell: 277 })
    slow.stats.initiative = slow.baseStats.initiative = 1
    engine.addFighter(fight, slow)
    // Arrivant le plus rapide : devant tous ses coéquipiers.
    const fast = createMonsterFighter(data, { monsterId: IKARGN, grade: 5, team: 1, cell: 276 })
    fast.stats.initiative = fast.baseStats.initiative = 99999
    engine.addFighter(fight, fast)
    const before = fight.timeline.slice()
    insertNewcomers(fight, [slow, fast])
    const tl = fight.timeline
    expect(tl.filter(id => before.includes(id))).toEqual(before)
    const team1 = tl.filter(id => fight.fighters[id].team === 1 && fight.fighters[id].summonerId === undefined)
    expect(team1[0]).toBe(fast.id)
    expect(team1[team1.length - 1]).toBe(slow.id)
    const lastRoot = before.filter(id => fight.fighters[id].team === 1 && fight.fighters[id].summonerId === undefined).pop()!
    if (lastRoot === vortex.id) expect(tl.indexOf(slow.id)).toBe(tl.indexOf(aur.id) + 1)
    else expect(tl.indexOf(slow.id)).toBeGreaterThan(tl.indexOf(lastRoot))
  })

  it('rebuildTimeline : alternance depuis l’équipe qui commence, invocation juste après son invocateur', () => {
    const { engine, fight } = vortexFight({ initiative: 1000 })
    expect(startingTeam(fight, 'average')).toBe(1)
    expect(averageInitiative(fight, 0)).toBeLessThan(averageInitiative(fight, 1))
    expect(bestInitiative(fight, 0)).toBe(1000)
    for (const rule of ['average', 'best'] as const) {
      rebuildTimeline(engine, fight, rule)
      const tl = fight.timeline.map(id => fight.fighters[id])
      const roots = tl.filter(f => f.summonerId === undefined)
      expect(roots[0].team).toBe(startingTeam(fight, rule))
      for (let i = 1; i < Math.min(roots.length, 8); i++) expect(roots[i].team).not.toBe(roots[i - 1].team)
      const vi = tl.findIndex(f => f.monsterId === VORTEX)
      expect(tl[vi + 1].monsterId).toBe(AURORAIRE)
    }
  })
})

describe('invulnérabilité d’arrivée (générique)', () => {
  it('état 56 jusqu’au début du tour demandé, puis retrait ; rien si le tour est déjà passé', () => {
    const { engine, fight } = vortexFight()
    engine.nextTurn(fight)
    const m = createMonsterFighter(data, { monsterId: HARPILLE, grade: 5, team: 1, cell: 277 })
    engine.addFighter(fight, m)
    addArrivalInvulnerability(engine, fight, m, fight.round + 2)
    expect(m.states).toContain(56)
    expect(arrivalInvulnerableUntil(m)).toBe(fight.round + 2)
    expect(engine.stateFlag(m, 'invulnerable')).toBe(true)
    expireArrivalInvulnerability(engine, fight)
    expect(m.states).toContain(56)
    fight.round += 2
    expireArrivalInvulnerability(engine, fight)
    expect(m.states).not.toContain(56)
    expect(arrivalInvulnerableUntil(m)).toBe(0)
    const n = createMonsterFighter(data, { monsterId: HARPILLE, grade: 5, team: 1, cell: 276 })
    engine.addFighter(fight, n)
    addArrivalInvulnerability(engine, fight, n, fight.round)
    expect(n.states).not.toContain(56)
  })

  it('spawnWave générique (hors Vortex) : événement wave avant les arrivants, monstres sans case libre ignorés', () => {
    const sc = getScenario('skirmish')
    const engine = createEngine(data, sc.hooks)
    const fight = sc.createFight(engine, createSmokeTeam(data), { params: sc.defaultParams, seed: 1, rollMode: 'random', record: true, rngRekey: 'none' })
    engine.nextTurn(fight)
    const free = fight.map.cells.filter(c => c.walkable && engine.isCellFree(fight, c.id)).map(c => c.id)
    const res = spawnWave(engine, fight, [{ monsterId: 101, grade: 1 }, { monsterId: 101, grade: 1 }], { wave: 2, total: 2, cells: free.slice(0, 2), invulnerableUntilRound: fight.round + 1 })
    expect(res.fighters).toHaveLength(2)
    expect(res.skipped).toHaveLength(0)
    expect(res.fighters.every(f => f.states.includes(56) && f.wave === 2)).toBe(true)
    const wi = fight.events.findIndex(e => e.t === 'wave' && e.index === 2)
    expect(wi).toBeGreaterThan(0)
    for (const f of res.fighters) expect(fight.timeline).toContain(f.id)
  })
})

describe('escarmouche : n’importe quels monstres sur n’importe quelle carte', () => {
  it('monstres du Vortex sur la carte du Vortex, cases imposées, fin par la règle du moteur', () => {
    const sc = getScenario('skirmish')
    const engine = createEngine(data, sc.hooks)
    const team = createSmokeTeam(data, undefined, { hp: 200_000 })
    const params = { mapId: VORTEX_MAP_ID, monsterIds: [IKARGN, HARPILLE], monsterGrades: [1], monsterCells: [270, 274], playerCells: [424, 438, 441, 443], maxRounds: 40 }
    const fight = sc.createFight(engine, team, { params, seed: 3, rollMode: 'random', record: true, rngRekey: 'perTurn' })
    expect(fight.map.id).toBe(VORTEX_MAP_ID)
    expect(team.map(f => f.cell)).toEqual([424, 438, 441, 443])
    const mons = fight.fighters.filter(f => f.team === 1 && f.summonerId === undefined)
    expect(mons.map(m => [m.monsterId, m.cell, m.grade])).toEqual([[IKARGN, 270, 1], [HARPILLE, 274, 1]])
    runFight(engine, fight, uniformProvider(nearestAttackController()))
    const sum = sc.summarize(fight)
    expect(fight.ended).toBe(true)
    expect(sum.win).toBe(true)
    expect(sum.progress).toBe(1)
    expect(sum.extra?.enemiesAlive).toBe(0)
  })

  it('paramètres invalides rejetés', () => {
    const sc = getScenario('skirmish')
    const engine = createEngine(data, sc.hooks)
    expect(() => sc.createFight(engine, createSmokeTeam(data), { params: { monsterIds: [] }, seed: 1, rollMode: 'random', record: false, rngRekey: 'none' })).toThrow(/monstre/)
    expect(() => sc.createFight(engine, createSmokeTeam(data), { params: { mapId: 1 }, seed: 1, rollMode: 'random', record: false, rngRekey: 'none' })).toThrow(/absente/)
  })
})
