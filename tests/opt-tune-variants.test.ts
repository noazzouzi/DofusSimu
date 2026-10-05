/**
 * WP4b — variantes de sorts (niveau L4, docs/design/ai.md §15.5) sur combats réels : combat de contrôle à 6 monstres de
 * vague du Vortex (grade 5, vraie salle), politique `scripted`, graines communes (CRN), 4 workers.
 *
 * Départ volontairement mauvais : les 22 variantes du Crâ inversées par rapport à son preset (Crâ Feu zone). La
 * recherche gloutonne (bascules « sort jamais lancé » puis « doctrine » du preset) doit trouver des bascules
 * SIGNIFICATIVES et améliorer l'objectif apparié ; elle ne peut jamais rendre une configuration moins bonne sur ses
 * graines d'évaluation.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { createNodePool } from '../src/optimizer/pool/node'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'
import { applyToggle, candidateToggles, memberVariants, optimizeVariants, pairSupported } from '../src/optimizer/variants'

const DATA = loadDataStore('data')
const CONTROL = 'control:143393281:3834,3836,3837,3838,3839,3834'
const team = parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA)
const pool = createNodePool(4)
afterAll(() => pool.close())

/** Crâ (membre 1) aux variantes inversées. */
function flippedCra(): FightSpec {
  let cra = team[1]
  for (let p = 0; p < 22; p++) cra = applyToggle(cra, p, (1 - (cra.variants[p] ?? 0)) as 0 | 1)
  return { scenarioId: CONTROL, team: team.map((m, i) => (i === 1 ? cra : m)), mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
}

describe('variantes de sorts', () => {
  it('bascules : membre et build cohérents, paires supportées, candidats « unused » puis « doctrine »', () => {
    const spec = flippedCra()
    const cra = spec.team[1]
    expect(memberVariants(cra)).toEqual(cra.build.spellVariants)
    expect(memberVariants(cra).every((v, i) => v !== team[1].variants[i])).toBe(true)
    const toggled = applyToggle(cra, 3, team[1].variants[3])
    expect(toggled.variants[3]).toBe(team[1].variants[3])
    expect(toggled.build.spellVariants![3]).toBe(team[1].variants[3])
    // Usage fictif : un seul sort lancé ⇒ les autres paires sont « unused ».
    const breed = DATA.breed(cra.breedId)!
    const active0 = breed.spellPairs[0][memberVariants(cra)[0]]
    const cands = candidateToggles(DATA, spec.team, 1, { [active0]: 3 })
    expect(cands.length).toBeGreaterThan(0)
    expect(cands.some(t => t.pair === 0 && t.reason === 'unused')).toBe(false)
    const firstDoctrine = cands.findIndex(t => t.reason === 'doctrine')
    if (firstDoctrine >= 0) expect(cands.slice(firstDoctrine).every(t => t.reason === 'doctrine')).toBe(true)
    for (const t of cands) {
      expect(pairSupported(DATA, cra.breedId, t.pair, 200)).toBe(true)
      expect(t.spellFrom).toBe(breed.spellPairs[t.pair][t.from])
      expect(t.spellTo).toBe(breed.spellPairs[t.pair][t.to])
    }
  })

  it('depuis des variantes inversées : bascules significatives, objectif apparié amélioré', async () => {
    const r = await optimizeVariants(DATA, flippedCra(), pool, { seeds: 24, usageSeeds: 32, members: [1], maxCandidates: 10 })
    expect(r.trials.length).toBeGreaterThan(0)
    expect(r.accepted.length).toBeGreaterThanOrEqual(1)
    expect(r.final.objective).toBeGreaterThan(r.base.objective)
    for (const t of r.trials.filter(x => x.accepted)) {
      expect(t.paired.diff).toBeGreaterThan(0)
      expect(t.paired.z).toBeGreaterThanOrEqual(2)
    }
    // Les bascules acceptées sont appliquées à l'équipe rendue (membre et build).
    for (const t of r.accepted) {
      expect(r.team[1].variants[t.pair]).toBe(t.to)
      expect(r.team[1].build.spellVariants![t.pair]).toBe(t.to)
    }
    // Les autres membres sont inchangés.
    for (const i of [0, 2, 3]) expect(r.team[i].variants).toEqual(team[i].variants)
    expect(r.fights).toBe(24 * (1 + r.trials.length) + 32)
  }, 600_000)
})
