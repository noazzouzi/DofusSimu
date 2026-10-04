/**
 * Extensions moteur demandées par l'IA (docs/design/ai.md §3.3), toutes rétro-compatibles :
 *  E1 re-semis des dés par tour (`FightOptions.rngRekey`), E2 copie de l'état de scénario (`ScenarioHooks.cloneState`),
 *  E3 événement `aiNote` (+ replay), E4 révision des combattants (`Fighter.rev`), E5 compteur d'effets inconnus par
 *  combat et couverture des sorts (`isSpellSupported`).
 */
import { describe, expect, it, vi } from 'vitest'
import { mix32 } from '../src/core/hash'
import { emptyStats, type TeamId } from '../src/core/types'
import type { EffectData, MapData, SpellLevelData, ZoneSpec } from '../src/data/model'
import { loadDataStore } from '../src/data/node'
import type { DataStore } from '../src/data/store'
import { runEffect } from '../src/engine/effects/core'
import { setCell } from '../src/engine/effects/movement/common'
import { getEffectHandler } from '../src/engine/effects/registry'
import { isSpellSupported, spellSupport } from '../src/engine/effects/support'
import { cloneFighter, Engine } from '../src/engine/engine'
import { createPlayerFighter } from '../src/engine/factory'
import { move } from '../src/engine/move'
import { neighbors } from '../src/map/geometry'
import { nextRandom } from '../src/engine/random'
import { createEngine } from '../src/engine'
import type { Fighter, FightEvent, FightState, ScenarioHooks } from '../src/engine/types'
import { LogBuilder } from '../src/replay/log'
import { applyEventMut, cloneState, initialState } from '../src/replay/reducer'
import type { Replay } from '../src/replay/types'
import { parseReplay, sanitizeEvent } from '../src/replay/validate'

const data = loadDataStore()
const OPEN: MapData = { id: 1, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }

function fighter(name: string, team: TeamId, cell: number, initiative = 100): Fighter {
  return createPlayerFighter(data, {
    name,
    breedId: 8,
    level: 200,
    stats: { ...emptyStats(), ap: 12, mp: 6, initiative },
    maxHp: 3000,
    spellIds: [],
    cell,
    team,
  })
}

function bareFight(opts: { seed?: number; rngRekey?: 'none' | 'perTurn'; hooks?: ScenarioHooks } = {}): { engine: Engine; fight: FightState } {
  const engine = new Engine(data, opts.hooks)
  const fight = engine.createFight({
    map: OPEN,
    fighters: [fighter('A', 0, 300, 300), fighter('B', 1, 304, 200), fighter('C', 0, 310, 100), fighter('D', 1, 314, 50)],
    options: { seed: opts.seed ?? 42, rngRekey: opts.rngRekey },
  })
  return { engine, fight }
}

/** Joue `turns` tours vides ; `during(f, fight)` est appelé pendant chaque tour. */
function playTurns(engine: Engine, fight: FightState, turns: number, during?: (f: Fighter) => void): void {
  for (let i = 0; i < turns; i++) {
    const f = engine.nextTurn(fight)
    if (!f) return
    during?.(f)
    engine.endTurn(fight, f)
  }
}

// ───────────────────────────── E1 ─────────────────────────────

describe('E1 : FightOptions.rngRekey', () => {
  it("'perTurn' : startTurn pose rngState = mix32(mix32(seed, round), fighterId)", () => {
    const { engine, fight } = bareFight({ seed: 1234, rngRekey: 'perTurn' })
    for (let i = 0; i < 10; i++) {
      const f = engine.nextTurn(fight)!
      expect(fight.rngState).toBe(mix32(mix32(1234, fight.round), f.id) | 0)
      engine.endTurn(fight, f)
    }
    expect(fight.round).toBeGreaterThanOrEqual(3)
  })

  it("'perTurn' : une décision différente au tour 1 ne décale pas les dés des tours suivants", () => {
    const run = (rekey: 'none' | 'perTurn', extraDraws: number) => {
      const { engine, fight } = bareFight({ seed: 7, rngRekey: rekey })
      const states: number[] = []
      playTurns(engine, fight, 8, f => {
        if (fight.round === 1 && f.id === 0) for (let k = 0; k < extraDraws; k++) nextRandom(fight)
        if (fight.round >= 2) states.push(fight.rngState)
      })
      return states
    }
    expect(run('perTurn', 5)).toEqual(run('perTurn', 0))
    expect(run('none', 5)).not.toEqual(run('none', 0))
  })

  it('défaut (absent) : aucun re-semis, comportement inchangé', () => {
    const { engine, fight } = bareFight({ seed: 99 })
    expect(fight.options.rngRekey).toBeUndefined()
    playTurns(engine, fight, 6)
    expect(fight.rngState).toBe(99)
  })

  it('mix32 est déterministe, non signé et sensible à chaque argument', () => {
    expect(mix32(1, 2)).toBe(mix32(1, 2))
    expect(mix32(1, 2)).not.toBe(mix32(2, 1))
    expect(mix32(0, 0)).toBeGreaterThanOrEqual(0)
    expect(mix32(-5, 3)).toBeLessThan(2 ** 32)
  })
})

// ───────────────────────────── E2 ─────────────────────────────

describe('E2 : ScenarioHooks.cloneState', () => {
  it('cloneFight utilise cloneState quand il est fourni', () => {
    const cloneState = vi.fn((s: Record<string, unknown>) => ({ ...s, copied: true }))
    const { engine, fight } = bareFight({ hooks: { id: 'test', cloneState } })
    fight.scenarioState.vortex = { hour: 3 }
    const c = engine.cloneFight(fight)
    expect(cloneState).toHaveBeenCalledTimes(1)
    expect(cloneState).toHaveBeenCalledWith(fight.scenarioState)
    expect(c.scenarioState).toEqual({ vortex: { hour: 3 }, copied: true })
    expect(fight.scenarioState.copied).toBeUndefined()
  })

  it('sans cloneState : copie profonde générique (structuredClone), indépendante de l’original', () => {
    const { engine, fight } = bareFight({ hooks: { id: 'test' } })
    fight.scenarioState.deep = { a: { b: 1 } }
    const c = engine.cloneFight(fight)
    ;(c.scenarioState.deep as { a: { b: number } }).a.b = 2
    expect((fight.scenarioState.deep as { a: { b: number } }).a.b).toBe(1)
  })
})

// ───────────────────────────── E3 ─────────────────────────────

describe('E3 : événement aiNote', () => {
  const note: FightEvent = { t: 'aiNote', fighter: 0, kind: 'creative', text: 'retire 3 PM au Buboxor', cells: [301, 302], targets: [1] }

  it('émis et enregistré par le moteur comme tout événement', () => {
    const { engine, fight } = bareFight()
    engine.emit(fight, note)
    expect(fight.events.at(-1)).toEqual(note)
  })

  it('validation : accepté, nature inconnue ramenée à intent, combattant obligatoire', () => {
    expect(sanitizeEvent(note)).toEqual(note)
    expect(sanitizeEvent({ t: 'aiNote', fighter: 2, kind: 'bizarre', text: 'x', cells: ['a'] })).toEqual({ t: 'aiNote', fighter: 2, kind: 'intent', text: 'x' })
    expect(sanitizeEvent({ t: 'aiNote', kind: 'plan', text: 'x' })).toBeNull()
  })

  it('replay : conservé par parseReplay, sans effet sur l’état visuel, journal « ai » au nom du combattant', () => {
    const { fight } = bareFight()
    const events: FightEvent[] = [fight.events[0], note]
    const replay: Replay = parseReplay({ events })
    expect(replay.events).toEqual(events)
    expect(replay.warnings).toBeUndefined()
    const s0 = initialState(replay)
    const before = cloneState(s0)
    const after = applyEventMut(cloneState(s0), note, 1)
    expect(after.fighters).toEqual(before.fighters)
    const log = new LogBuilder(replay.events)
    log.add(s0, note, 1)
    const entry = log.entries.at(-1)!
    expect(entry.tone).toBe('ai')
    expect(entry.fighter).toBe(0)
    expect(entry.text).toContain('A')
    expect(entry.text).toContain('retire 3 PM au Buboxor')
  })
})

// ───────────────────────────── E4 ─────────────────────────────

describe('E4 : Fighter.rev', () => {
  it('renouvelé par recomputeStats (création comprise)', () => {
    const { engine, fight } = bareFight()
    const a = fight.fighters[0]
    const r0 = a.rev ?? 0
    expect(r0).toBeGreaterThan(0)
    engine.recomputeStats(a)
    expect(a.rev!).toBeGreaterThan(r0)
  })

  it('renouvelé à chaque case parcourue par move, et par setCell (porteur et porté)', () => {
    const { engine, fight } = bareFight()
    const a = fight.fighters[0]
    a.mp = 6
    const seen = [a.rev!]
    const step1 = neighbors(300).find(c => engine.isCellFree(fight, c))!
    const step2 = neighbors(step1).find(c => c !== 300 && engine.isCellFree(fight, c))!
    let steps = 0
    // Une case à la fois pour observer chaque renouvellement.
    steps += move(fight, a, [300, step1], engine)
    seen.push(a.rev!)
    steps += move(fight, a, [step1, step2], engine)
    seen.push(a.rev!)
    expect(steps).toBe(2)
    expect(seen[1]).toBeGreaterThan(seen[0])
    expect(seen[2]).toBeGreaterThan(seen[1])
    const c = fight.fighters[2]
    a.carrying = c.id
    c.carriedBy = a.id
    const ra = a.rev!
    const rc = c.rev!
    setCell(fight, a, 320)
    expect(a.rev!).toBeGreaterThan(ra)
    expect(c.rev!).toBeGreaterThan(rc)
    expect(a.rev).not.toBe(c.rev)
  })

  it('unique entre clones frères : (id, rev) égaux ⇒ même état (clé de cache sûre)', () => {
    const { engine, fight } = bareFight()
    const left = engine.cloneFight(fight)
    const right = engine.cloneFight(fight)
    expect(left.fighters[0].rev).toBe(fight.fighters[0].rev)
    // Deux modifications différentes du même combattant dans deux clones issus du même parent.
    setCell(left, left.fighters[0], 320)
    setCell(right, right.fighters[0], 321)
    expect(left.fighters[0].rev).not.toBe(right.fighters[0].rev)
    engine.recomputeStats(left.fighters[1])
    engine.recomputeStats(right.fighters[1])
    expect(left.fighters[1].rev).not.toBe(right.fighters[1].rev)
    // Combattant non modifié : même révision que dans le parent.
    expect(left.fighters[2].rev).toBe(fight.fighters[2].rev)
  })

  it('incrémenté à la mort (case −1) ; copié par cloneFighter sans partage', () => {
    const { engine, fight } = bareFight()
    const b = fight.fighters[1]
    const copy = cloneFighter(b)
    expect(copy.rev).toBe(b.rev)
    const r0 = b.rev!
    engine.kill(fight, b)
    expect(b.cell).toBe(-1)
    expect(b.rev!).toBeGreaterThan(r0)
    expect(copy.rev).toBe(r0)
  })
})

// ───────────────────────────── E5 ─────────────────────────────

const ZONE_P: ZoneSpec = { shape: 'P', size: 0, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false }

function effect(effectId: number, extra: Partial<EffectData> = {}): EffectData {
  return {
    effectId, order: 0, diceNum: 0, diceSide: 0, value: 0, duration: 0, delay: 0, random: 0, group: 0, targetMask: 'a,A',
    targetId: 0, triggers: 'I', dispellable: 1, element: -1, zone: ZONE_P, ...extra,
  }
}

function level(spellId: number, effects: EffectData[]): SpellLevelData {
  return {
    spellId, grade: 1, apCost: 3, minRange: 1, range: 5, rangeBoostable: false, castInLine: false, castInDiagonal: false,
    castTestLos: true, needFreeCell: false, needTakenCell: false, needFreeTrapCell: false, maxCastPerTurn: 0,
    maxCastPerTarget: 0, minCastInterval: 0, initialCooldown: 0, globalCooldown: 0, minPlayerLevel: 1, critChance: 0,
    maxStack: 0, statesCriterion: '', effects, criticalEffects: [],
  }
}

describe('E5 : effets inconnus par combat et couverture des sorts', () => {
  const UNKNOWN_ID = 987654

  it('runEffect sans interprète incrémente fight.unknownEffects (pas pour un effet clientOnly) ; copié par cloneFight', () => {
    const engine = createEngine(data)
    const fight = engine.createFight({ map: OPEN, fighters: [fighter('A', 0, 300), fighter('B', 1, 304)] })
    const [a, b] = fight.fighters
    const args = (e: EffectData) => ({
      caster: a, spell: null, spellId: 0, effect: e, targetCell: b.cell, casterCell: a.cell, cells: [b.cell], targets: [b],
      efficiency: new Map([[b.id, 1]]), crit: false, indirect: false, depth: 0,
    })
    expect(fight.unknownEffects).toBeUndefined()
    runEffect(engine, fight, args(effect(UNKNOWN_ID)))
    runEffect(engine, fight, args(effect(UNKNOWN_ID)))
    expect(fight.unknownEffects).toBe(2)
    runEffect(engine, fight, args(effect(UNKNOWN_ID, { clientOnly: true })))
    expect(fight.unknownEffects).toBe(2)
    expect(engine.cloneFight(fight).unknownEffects).toBe(2)
  })

  it('isSpellSupported : fermeture des sous-sorts (1160) et des sorts de marques contre registeredEffects()', () => {
    createEngine(data) // toutes les familles enregistrées
    const DMG = 98 // dommages Air
    expect(getEffectHandler(DMG)).toBeDefined()
    expect(getEffectHandler(1160)).toBeDefined()
    expect(getEffectHandler(UNKNOWN_ID)).toBeUndefined()
    const synthetic = new Map<number, SpellLevelData>([
      [900001, level(900001, [effect(DMG)])],
      [900002, level(900002, [effect(UNKNOWN_ID)])],
      [900003, level(900003, [effect(1160, { diceNum: 900002, diceSide: 1 })])],
      [900004, level(900004, [effect(1160, { diceNum: 900001, diceSide: 1 })])],
      [900005, level(900005, [effect(1160, { diceNum: 900099, diceSide: 1 })])],
      [900006, level(900006, [effect(DMG), effect(1160, { diceNum: 900006, diceSide: 1 })])],
      [900007, level(900007, [effect(DMG), effect(UNKNOWN_ID, { clientOnly: true })])],
      [900008, level(900008, [effect(1165, { diceNum: 900002, diceSide: 1 })])],
    ])
    const store: DataStore = {
      spell: id => data.spell(id),
      spellLevel: (id, sel) => synthetic.get(id) ?? data.spellLevel(id, sel),
      state: id => data.state(id),
      monster: id => data.monster(id),
      breed: id => data.breed(id),
      item: id => data.item(id),
      itemSet: id => data.itemSet(id),
      map: id => data.map(id),
    }
    const engine = new Engine(store)
    const sup = (id: number) => isSpellSupported(engine, synthetic.get(id)!)
    expect(sup(900001)).toBe(true)
    expect(sup(900002)).toBe(false)
    expect(spellSupport(engine, synthetic.get(900002)!).missingEffects).toEqual([UNKNOWN_ID])
    expect(sup(900003)).toBe(false) // sous-sort non supporté
    expect(spellSupport(engine, synthetic.get(900003)!).missingEffects).toEqual([UNKNOWN_ID])
    expect(sup(900004)).toBe(true)
    expect(sup(900005)).toBe(false) // sous-sort absent des données
    expect(spellSupport(engine, synthetic.get(900005)!).missingSpells).toEqual(['900099:1'])
    expect(sup(900006)).toBe(true) // cycle : terminé
    expect(sup(900007)).toBe(true) // effet purement visuel ignoré
    expect(sup(900008)).toBe(false) // sort joué par la glyphe non supporté
  })
})
