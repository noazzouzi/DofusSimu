/**
 * Placements des monstres de l'Œil de Vortex (`enemyPlacement`, VORTEX_PLACEMENTS : captures du jeu de l'utilisateur)
 * et scénarios de combat figés (src/optimizer/script.ts) : rejeu identique avec les mêmes dés, rupture détectée sinon.
 */
import { describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai/theta'
import { loadDataStore } from '../src/data/node'
import { HARPILLE, IKARGN, MEJAIRE, VORTEX, VORTEX_DEFAULT_PARAMS, VORTEX_PLACEMENTS } from '../src/dungeons/vortex/constants'
import { resolveVortexParams } from '../src/dungeons/vortex/params'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { BLUE_SPAWN_ORDER, createVortexFight, vortexHooks, waveSpawnCells } from '../src/dungeons/vortex/setup'
import { createEngine } from '../src/engine'
import { recordScript, runScript, summarizeChecks } from '../src/optimizer/script'
import type { FightSpec } from '../src/optimizer/types'
import { presetMember, findPreset } from '../src/optimizer/team/presets'

const data = loadDataStore('data')

function wave1(enemyPlacement: number): Record<number, number> {
  const engine = createEngine(data, vortexHooks)
  const players = createSmokeTeam(data, undefined, { initiative: 4000, hp: 1_000_000 })
  const fight = createVortexFight(engine, players, { params: { ...VORTEX_DEFAULT_PARAMS, enemyPlacement }, seed: 1, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  return Object.fromEntries(fight.fighters.filter(f => f.team === 1 && f.wave === 1).map(f => [f.monsterId, f.cell]))
}

describe('placements des monstres (vague 1)', () => {
  it('chaque placement met les 4 monstres sur ses cases (Vortex sur les 10 cases bleues tour à tour)', () => {
    for (let p = 1; p <= 10; p++) {
      expect(wave1(p)).toEqual({ ...VORTEX_PLACEMENTS[p] })
      expect(VORTEX_PLACEMENTS[p][VORTEX]).toBe(267 + p)
    }
    expect(wave1(1)).toEqual({ [VORTEX]: 268, [IKARGN]: 270, [MEJAIRE]: 272, [HARPILLE]: 274 })
    expect(wave1(7)).toEqual({ [VORTEX]: 274, [IKARGN]: 272, [MEJAIRE]: 270, [HARPILLE]: 268 })
  })

  it('configuration historique inchangée sans placement (Vortex 272, autres dans l’ordre historique)', () => {
    expect(wave1(0)).toEqual({ [VORTEX]: 272, [IKARGN]: 270, [MEJAIRE]: 274, [HARPILLE]: 268 })
    expect(resolveVortexParams({ enemyPlacement: 3 }).vortexCell).toBe(270)
    expect(() => resolveVortexParams({ enemyPlacement: 11 })).toThrow(/enemyPlacement/)
  })

  it('vagues 2 à 5 : cases de départ de la vague 1 d’abord (règle INCERTAINE), sinon ordre historique', () => {
    expect(waveSpawnCells({ enemyPlacement: 0, waveSpawn: 'auto' })).toBe(BLUE_SPAWN_ORDER)
    const cells = waveSpawnCells({ enemyPlacement: 2, waveSpawn: 'auto' })
    expect(cells.slice(0, 4)).toEqual([269, 271, 273, 275])
    expect([...cells].sort((a, b) => a - b)).toEqual([...BLUE_SPAWN_ORDER].sort((a, b) => a - b))
    expect(waveSpawnCells({ enemyPlacement: 2, waveSpawn: 'blueOrder' })).toBe(BLUE_SPAWN_ORDER)
  })
})

describe('scénarios de combat figés', () => {
  // Combat court et peu coûteux : 2 personnages contre une Méjaire, sur la salle du Vortex.
  const team = ['cra_terre_mono_vortex', 'eniripsa_soin_vortex'].map(id => presetMember(findPreset(id)!, data))
  const spec: FightSpec = { scenarioId: 'control:143393281:3836@5', team, mode: 'scripted', theta: loadTheta() as never, variantPolicy: 'default', monsterNoise: 0 }
  const { script, run } = recordScript(data, spec, 3)

  it('le script relève chaque tour (instructions des personnages, réponses du monstre)', () => {
    expect(script.turns.length).toBeGreaterThan(4)
    expect(script.turns.map(t => t.index)).toEqual(script.turns.map((_, i) => i))
    const sides = new Set(script.turns.map(t => t.side))
    expect(sides.has('player') && sides.has('monster')).toBe(true) // + 'ally' : invocations (Lapinos de l'Eniripsa)
    expect(script.turns.some(t => t.steps.some(s => s.kind === 'cast'))).toBe(true)
    expect(script.playerCells).toHaveLength(2)
    expect(script.reference).toMatchObject({ seed: 3, rollMode: 'average', win: run.summary.win, rounds: run.summary.rounds })
  })

  it('mêmes dés (jets moyens) : rejeu identique de bout en bout', () => {
    const same = runScript(data, script, 3, { rollMode: 'average' })
    expect(same.break).toBeUndefined()
    expect(same.conform).toBe(true)
    expect(same.conformTurns).toBe(script.turns.length)
    expect(same.turns.map(t => t.steps)).toEqual(script.turns.map(t => t.steps))
  })

  it('autres dés : bilan cohérent (survie décroissante, ruptures localisées)', () => {
    const runs = [11, 12, 13, 14].map(s => runScript(data, script, s))
    const c = summarizeChecks(script, runs)
    expect(c.runs).toBe(4)
    expect(c.survival).toHaveLength(script.turns.length)
    for (let k = 1; k < c.survival.length; k++) expect(c.survival[k]).toBeLessThanOrEqual(c.survival[k - 1])
    for (const r of runs) {
      if (r.conform) expect(r.conformTurns).toBe(script.turns.length)
      else expect(r.break!.index).toBe(r.conformTurns)
    }
    expect(c.breaks.reduce((n, b) => n + b.count, 0)).toBe(c.runs - c.conform)
  })

  it('un monstre qui joue autrement est une rupture « monstre » au bon tour', () => {
    const k = script.turns.findIndex(t => t.side === 'monster' && t.steps.length > 0)
    const altered = structuredClone(script)
    altered.turns[k].steps = [{ kind: 'move', to: -1, path: [] }]
    const r = runScript(data, altered, 3, { rollMode: 'average' })
    expect(r.break).toMatchObject({ kind: 'monster', index: k, expected: '→ -1' })
    expect(r.conformTurns).toBe(k)
  })
})
