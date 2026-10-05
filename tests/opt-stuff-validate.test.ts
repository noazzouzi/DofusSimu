/**
 * WP4b — validation des stuffs par combats (niveau L3 point 7, docs/design/ai.md §15.4) : le proxy propose, les
 * combats décident. Membre de départ SANS stuff (Iop) dans une équipe équipée ; les builds diversifiés trouvés par
 * l'optimiseur sont comparés dans l'équipe sur graines communes (combat de contrôle réel, `scripted`, 4 workers) : un
 * build optimisé doit être retenu et améliorer l'objectif apparié.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { createNodePool } from '../src/optimizer/pool/node'
import { optimizeStuff } from '../src/optimizer/stuff/search'
import { validateStuffs } from '../src/optimizer/stuff/validate'
import { getPreset, parseTeam, presetMember } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const pool = createNodePool(4)
afterAll(() => pool.close())

describe('validation des stuffs par combats', () => {
  it('membre nu : un build optimisé est retenu et améliore l’objectif apparié', async () => {
    const team = parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA)
    team[0] = presetMember(getPreset('iop_terre_burst'), DATA, { stuff: 'unstuffed', name: 'Iop' })
    const spec: FightSpec = { scenarioId: 'control:143393281:3834,3836,3837,3838,3839,3834', team, mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
    const opt = optimizeStuff(DATA, team[0], { iterations: 200, perSlot: 10, dofusPool: 10, topExact: 10, diversity: 3, points: false })
    expect(opt.best.score.logJ).toBeGreaterThan(opt.start.score.logJ)
    const v = await validateStuffs(spec, 0, opt.front, pool, { seeds: 16 })
    expect(v.builds.length).toBe(1 + opt.front.length)
    expect(v.objectives.length).toBe(v.builds.length)
    expect(v.chosen).toBeGreaterThan(0)
    expect(v.objectives[v.chosen]).toBeGreaterThan(v.objectives[0])
    expect(v.paired[v.chosen].diff).toBeGreaterThan(0)
    expect(v.paired[0].diff).toBe(0)
    // Micro-scénario + combat complet cumulés : objectif = moyenne par graine des types.
    const v2 = await validateStuffs(spec, 0, [opt.best], pool, { seeds: 4, kinds: ['full', 'full'] })
    expect(v2.evals.length).toBe(2)
    expect(v2.objectives[1]).toBeCloseTo(v2.evals[0][1].objective, 12)
  }, 600_000)
})
