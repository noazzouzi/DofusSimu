/**
 * WP4b — validation des stuffs par combats (niveau L3 point 7, docs/design/ai.md §15.4) : le proxy propose, les
 * combats décident. Membre de départ SANS stuff (Crâ) dans une équipe équipée ; les builds diversifiés trouvés par
 * l'optimiseur sont comparés dans l'équipe sur graines communes (combat de contrôle réel, `scripted`, 4 workers) avec
 * le stuff méta du preset (equipment.md §12) : un build optimisé doit être retenu et battre significativement le
 * personnage nu ET le stuff méta.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { createNodePool } from '../src/optimizer/pool/node'
import { optimizeStuff } from '../src/optimizer/stuff/search'
import { defaultValidationKinds, validateStuffs } from '../src/optimizer/stuff/validate'
import { getPreset, parseTeam, presetMember } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const pool = createNodePool(4)
afterAll(() => pool.close())

describe('validation des stuffs par combats', () => {
  it('types de combats par défaut : T1 prefix12 + phase2 au Vortex (§15.4 point 7), combat complet sinon', () => {
    expect(defaultValidationKinds('vortex')).toEqual(['prefix12', 'phase2'])
    expect(defaultValidationKinds('control:143393281:3834,3838')).toEqual(['full'])
  })

  it('membre nu : un build optimisé est retenu, bat le personnage nu et le stuff méta du preset', async () => {
    const team = parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA)
    const meta = team[1].build
    team[1] = presetMember(getPreset('cra_feu_zone'), DATA, { stuff: 'unstuffed', name: 'Crâ' })
    const spec: FightSpec = { scenarioId: 'control:143393281:3834,3836,3837,3838,3839,3834', team, mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
    const opt = optimizeStuff(DATA, team[1], { iterations: 1000, seed: 2, diversity: 3 })
    expect(opt.best.score.logJ).toBeGreaterThan(opt.start.score.logJ)
    // Front : profils distincts.
    expect(new Set(opt.front.map(c => `${Math.round(c.score.dpt)}|${Math.round(c.score.ehp)}`)).size).toBe(opt.front.length)
    const v = await validateStuffs(spec, 1, [...opt.front, meta], pool, { seeds: 24 })
    const iMeta = v.builds.length - 1
    expect(v.builds.length).toBe(2 + opt.front.length)
    expect(v.objectives.length).toBe(v.builds.length)
    expect(v.chosen).toBeGreaterThan(0)
    expect(v.chosen).not.toBe(iMeta)
    expect(v.objectives[v.chosen]).toBeGreaterThan(v.objectives[0])
    expect(v.paired[v.chosen].diff).toBeGreaterThan(0)
    expect(v.paired[v.chosen].z).toBeGreaterThan(2)
    expect(v.paired[0].diff).toBe(0)
    // Le stuff optimisé bat aussi le stuff méta du preset (appariement sur les mêmes graines).
    expect(v.objectives[v.chosen]).toBeGreaterThan(v.objectives[iMeta])
    // Micro-scénario + combat complet cumulés : objectif = moyenne par graine des types.
    const v2 = await validateStuffs(spec, 1, [opt.best], pool, { seeds: 4, kinds: ['full', 'full'] })
    expect(v2.evals.length).toBe(2)
    expect(v2.objectives[1]).toBeCloseTo(v2.evals[0][1].objective, 12)
  }, 600_000)
})
