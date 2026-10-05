/**
 * Branchement de l'IA des monstres dans le registre des contrôleurs (src/ai/index.ts, docs/design/ai.md §4) et menace
 * vue par les joueurs : clés `fighter.ai` exactes des monstres à profil (`monster:<id>`, `boss:<id>`), pas de capture
 * des préfixes (une invocation de personnage reste à l'IA de son équipe), tour joué par `createControllers` identique
 * au `MonsterBrain` 'play' ; `vortexThreatOrigins` (cases d'Heurage du Vortex en phase 2).
 */
import { describe, expect, it } from 'vitest'
import { createControllers, defaultAIConfig } from '../src/ai'
import { createMonsterBrain, MonsterBrain, monsterAIKeys, registerMonsterControllers, vortexThreatOrigins } from '../src/ai/monster'
import { createMonsterFighter } from '../src/engine/factory'
import type { FightEvent } from '../src/engine/types'
import { distance } from '../src/map/geometry'
import { HOUR_CELL, nextHour } from '../src/dungeons/vortex/constants'
import { forecastSlots } from '../src/ai/core/timeline'
import { addState, at, AURORAIRE, BREEDS, data, IKARGN, MEJAIRE, scene, turnOf, VORTEX } from './ai-monster-helpers'

describe('registre des contrôleurs', () => {
  it('clés exactes des monstres à profil, sans préfixe générique', () => {
    const keys = monsterAIKeys()
    expect(keys).toContain('boss:3835')
    expect(keys).toContain('monster:3834')
    expect(keys).toContain('monster:3833')
    expect(keys).not.toContain('monster')
    expect(keys).not.toContain('boss')
    const got = new Map<string, unknown>()
    registerMonsterControllers((k, f) => got.set(k, f))
    expect([...got.keys()].sort()).toEqual([...keys].sort())
    const factory = got.get('monster:3834') as (e: unknown, c: unknown) => unknown
    const c = factory(undefined, defaultAIConfig('fast', 1))
    expect(c).toBeInstanceOf(MonsterBrain)
    expect((c as MonsterBrain).setting).toBe('play')
  })

  it('createControllers : le tour d’un monstre du Vortex est celui du MonsterBrain play', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -10) }, { breed: BREEDS.cra, cell: at(25, -6) }], monsters: [{ id: IKARGN, cell: at(23, -7) }] })
    const m = s.monsters[0]
    expect(m.ai).toBe('monster:3834')
    turnOf(s.engine, s.fight, m)
    const cfg = defaultAIConfig('fast', 1)
    const a = s.engine.cloneFight(s.fight, true)
    const b = s.engine.cloneFight(s.fight, true)
    const n = s.fight.events.length
    createControllers(s.engine, cfg)(a.fighters[m.id]).playTurn(s.engine, a, a.fighters[m.id])
    createMonsterBrain(cfg, 'play').playTurn(s.engine, b, b.fighters[m.id])
    const acts = (evs: FightEvent[]) => evs.slice(n).filter(e => e.t === 'cast' || e.t === 'move').map(e => JSON.stringify(e))
    expect(acts(a.events).length).toBeGreaterThan(0)
    expect(acts(a.events)).toEqual(acts(b.events))
  })
})

describe('menace vue par les joueurs : cases d’Heurage du Vortex (§11.7 threatOrigins)', () => {
  it('phase 2, Heurage prêt : cases voisines de la future case de l’Auroraire ; rien en phase 1', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -10) }], monsters: [{ id: VORTEX, cell: at(20, -12) }, { id: MEJAIRE, cell: at(25, -6) }] })
    const v = s.monsters[0]
    const aur = createMonsterFighter(data, { monsterId: AURORAIRE, grade: 5, team: 1, cell: HOUR_CELL[6], summonerId: v.id, summoner: v })
    s.engine.spawn(s.fight, aur, { afterId: v.id })
    const a = s.fight.fighters[s.fight.fighters.length - 1]
    addState(s.engine, s.fight, a, 226) // heure VI
    turnOf(s.engine, s.fight, s.players[0])
    const cells = vortexThreatOrigins(s.engine, s.fight, v)
    expect(cells.length).toBeGreaterThan(0)
    // Heure au prochain tour du Vortex : VI + un cran par tour de personnage qui le précède (ordre public).
    const slots = forecastSlots(s.engine, s.fight, s.fight.timeline.length)
    const k = slots.slice(0, slots.findIndex(x => x.fighterId === v.id)).filter(x => x.isPlayer && !x.isSummon).length
    for (const c of cells) expect(distance(c, HOUR_CELL[nextHour(6, k)])).toBe(1)
    // Heurage en relance : rien.
    v.cooldowns[5066] = 2
    expect(vortexThreatOrigins(s.engine, s.fight, v)).toEqual([])
    v.cooldowns[5066] = 0
    // Phase 1 (Marginal) : rien.
    addState(s.engine, s.fight, v, 236)
    expect(vortexThreatOrigins(s.engine, s.fight, v)).toEqual([])
  })
})
