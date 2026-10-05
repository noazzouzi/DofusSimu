/**
 * Bancs des boucles d'optimisation WP4b (docs/design/ai.md §15.3-§15.6) — un cœur :
 *  - L3a : évaluation de la forme fermée du proxy de stuff (cible ≈ 2 µs, design « fastStats ») ;
 *  - L3b : évaluation complète d'un stuff telle que la recherche la fait (computeBuildStats + forgemagie planifiée +
 *    forme fermée, sans mémo) ;
 *  - L3d : évaluation exacte du proxy (DptTable sur les 6 cibles du mix : re-notation des 50 meilleurs) ;
 *  - L3c : recherche de stuff d'un personnage, 2 000 itérations de recuit ; la recherche par défaut (20 000
 *    itérations, cible ≈ 2 s par (classe, rôle)) est mesurée dans la note affichée en fin de banc ;
 *  - L5  : modèle T0 d'une équipe (cible ≤ 0,2 ms) ;
 *  - L2  : une génération de CEM (population 12, 16 graines) sur évaluateur instantané (coût propre de la boucle).
 *
 *   npx vitest bench bench/opt-loops.bench.ts
 */
import { afterAll, bench, describe } from 'vitest'
import { loadTheta } from '../src/ai/theta'
import { loadDataStore } from '../src/data/node'
import { computeBuildStats } from '../src/stats/build'
import { createProxyContext } from '../src/optimizer/stuff/proxy'
import { evaluateStuff, optimizeStuff } from '../src/optimizer/stuff/search'
import { getPreset, PRESETS, presetMember } from '../src/optimizer/team/presets'
import { defaultT0Params, presetCapabilities, t0Evaluate, teamIndexSets } from '../src/optimizer/team/t0model'
import { cemTheta, tunableParams, type ThetaEvaluator } from '../src/optimizer/tune'

const DATA = loadDataStore('data')
const notes: string[] = []
const preset = getPreset('cra_feu_zone')
const member = presetMember(preset, DATA)
const ref = computeBuildStats(member.build, DATA)
const ctx = createProxyContext(DATA, { breedId: preset.breedId, level: 200, variants: preset.variants, role: preset.role, presetId: preset.id, element: preset.element }, ref)
let k = 0

const subset = PRESETS.slice(0, 16)
const caps = presetCapabilities(DATA, subset)
const params = defaultT0Params(DATA)
const teams = [...teamIndexSets(subset, 4, 2, 1)].slice(0, 2000).map(idx => ({ caps: idx.map(i => caps[i]), presets: idx.map(i => subset[i]) }))
let t = 0

const theta0 = loadTheta()
const tparams = tunableParams(theta0, ['value.incoming', 'value.control', 'team.commit', 'value.potBefore'])
const instant: ThetaEvaluator = async (thetas, seeds) => thetas.map(() => seeds.map(() => 0.5))

describe('boucles WP4b', () => {
  bench('L3a forme fermée du proxy (1 évaluation)', () => {
    ctx.surrogate({ ...ref.stats, intelligence: ref.stats.intelligence + (k++ % 100) }, ref.maxHp)
  })
  bench('L3b évaluation d’un stuff dans la recherche (stats + forgemagie + forme fermée)', () => {
    const items = member.build.items.map(i => ({ itemId: i.itemId }))
    evaluateStuff(DATA, ctx, { ...member.build, items: items.slice(0, 16 - (k++ % 3)) })
  })
  bench('L3d évaluation exacte du proxy (DptTable, 6 cibles)', () => {
    ctx.exact({ ...ref.stats, intelligence: ref.stats.intelligence + (k++ % 100) }, ref.maxHp)
  })
  bench('L3c recherche de stuff (2 000 itérations)', () => {
    const t0 = performance.now()
    const r = optimizeStuff(DATA, member, { iterations: 2000, seed: k++ })
    notes.push(`L3c ${preset.id} : ${(performance.now() - t0).toFixed(0)} ms, ${r.evaluations.surrogate} évaluations rapides, ${r.evaluations.exact} exactes, log J ${r.start.score.logJ.toFixed(3)} → ${r.best.score.logJ.toFixed(3)}`)
  }, { time: 0, iterations: 2, warmupTime: 0, warmupIterations: 0 })
  bench('L3e recherche de stuff par défaut (20 000 itérations)', () => {
    const t0 = performance.now()
    const r = optimizeStuff(DATA, member, { seed: k++ })
    notes.push(`L3e ${preset.id} (défaut) : ${(performance.now() - t0).toFixed(0)} ms, ${r.evaluations.surrogate} évaluations rapides, ${r.evaluations.exact} exactes, log J ${r.start.score.logJ.toFixed(3)} → ${r.best.score.logJ.toFixed(3)}`)
  }, { time: 0, iterations: 1, warmupTime: 0, warmupIterations: 0 })
  bench('L5 modèle T0 (1 équipe)', () => {
    const x = teams[t++ % teams.length]
    t0Evaluate(x.caps, params, x.presets)
  })
  bench('L2 génération CEM (12 × 16, évaluateur instantané)', async () => {
    await cemTheta(theta0, tparams, instant, { generations: 1 })
  })
})

afterAll(() => {
  console.log(`\n${notes.join('\n')}`)
})
