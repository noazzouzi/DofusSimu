/**
 * WP4b — validation des stuffs par combats (niveau L3 point 7, docs/design/ai.md §15.4) : le proxy propose, les
 * combats décident. Membre de départ SANS stuff (Crâ) dans une équipe équipée ; les builds diversifiés trouvés par
 * l'optimiseur sont comparés dans l'équipe sur graines communes (combat de contrôle réel, `scripted`, 4 workers) avec
 * le stuff méta du preset (equipment.md §12) : un build optimisé doit être retenu, battre significativement le
 * personnage nu et ne pas être significativement moins bon que le stuff méta.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { createNodePool } from '../src/optimizer/pool/node'
import { optimizeStuff } from '../src/optimizer/stuff/search'
import { defaultValidationKinds, validateStuffs, type StuffValidation } from '../src/optimizer/stuff/validate'
import { pairedVectors } from '../src/optimizer/tune'
import { getPreset, parseTeam, presetMember } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')

/** Objectif par graine d'un build (graines × types, même disposition que `validateStuffs`). */
function seedsVector(v: StuffValidation, i: number): number[] {
  const n = v.evals[0][i].perSeed.length
  return Array.from({ length: n }, (_, s) => v.evals.map(e => e[i].perSeed[s])).flat()
}
const pool = createNodePool(4)
afterAll(() => pool.close())

describe('validation des stuffs par combats', () => {
  it('types de combats par défaut : T1 prefix12 + phase2 au Vortex (§15.4 point 7), combat complet sinon', () => {
    expect(defaultValidationKinds('vortex')).toEqual(['prefix12', 'phase2'])
    expect(defaultValidationKinds('control:143393281:3834,3838')).toEqual(['full'])
  })

  it('membre nu : un build optimisé est retenu, bat le personnage nu, pas significativement moins bon que le stuff méta', async () => {
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
    expect(v.objectives[v.chosen]).toBeGreaterThan(v.objectives[0])
    expect(v.paired[v.chosen].diff).toBeGreaterThan(0)
    expect(v.paired[v.chosen].z).toBeGreaterThan(2)
    expect(v.paired[0].diff).toBe(0)
    // Le build retenu a le meilleur objectif parmi les builds significativement meilleurs que le membre nu.
    for (let i = 1; i < v.builds.length; i++) if (v.paired[i].diff > 0) expect(v.objectives[v.chosen]).toBeGreaterThanOrEqual(v.objectives[i])
    // Le meilleur build OPTIMISÉ bat significativement le personnage nu et n'est pas significativement moins bon que
    // le stuff méta du preset (equipment.md §12) sur les mêmes graines. (Comparaison empirique : elle dépend de l'IA des
    // monstres ; « bat le méta » n'est pas exigé — avec l'IA des monstres de WP1, l'écart est dans le bruit.)
    const optObj = v.objectives.slice(1, iMeta)
    const iBest = 1 + optObj.indexOf(Math.max(...optObj))
    expect(v.paired[iBest].diff).toBeGreaterThan(0)
    expect(v.paired[iBest].z).toBeGreaterThan(2)
    const perSeed = (i: number) => seedsVector(v, i)
    const vsMeta = pairedVectors(perSeed(iBest), perSeed(iMeta))
    expect(vsMeta.diff <= 0 || vsMeta.z < 2).toBe(true)
    // Micro-scénario + combat complet cumulés : objectif = moyenne par graine des types.
    const v2 = await validateStuffs(spec, 1, [opt.best], pool, { seeds: 4, kinds: ['full', 'full'] })
    expect(v2.evals.length).toBe(2)
    expect(v2.objectives[1]).toBeCloseTo(v2.evals[0][1].objective, 12)
  }, 600_000)
})
