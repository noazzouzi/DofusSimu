/**
 * Banc B5 (docs/design/ai.md §16.6) — combat Œil de Vortex complet, un cœur, graines fixes : `fast` ≤ 1,0 s,
 * `standard` ≤ 30 s (échec CI à ×2) ; `scripted` (≈ 0,35 s visé) en référence. Mesure de bout en bout : build →
 * scénario → contrôleurs → `runFight` → résumé (pas d'enregistrement). Le temps dépend des lots WP1/WP2/WP3
 * (bouchons tant qu'ils ne sont pas livrés).
 *
 *   npx vitest bench bench/e2e.bench.ts
 */
import { afterAll, bench, describe } from 'vitest'
import { loadTheta } from '../src/ai'
import type { AIMode } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import { runOne } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const TEAM = parseTeam('iop:killer,cra:killer,enutrof:mpLock,pandawa:placer', DATA)
const SEEDS = [1, 2, 3]
const notes: string[] = []

function spec(mode: AIMode): FightSpec {
  return { scenarioId: 'vortex', team: TEAM, mode, theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
}

// Préchauffage : conversion paresseuse des données (sorts, monstres, carte) hors mesure.
runOne(DATA, spec('scripted'), 99)

let k = 0
function fight(mode: AIMode): void {
  const seed = SEEDS[k++ % SEEDS.length]
  const t0 = performance.now()
  const { summary } = runOne(DATA, spec(mode), seed)
  notes.push(`B5 ${mode} graine ${seed} : ${(performance.now() - t0).toFixed(0)} ms, ${summary.rounds} tours, ${summary.nodes} nœuds, ${summary.win ? 'victoire' : 'défaite'}`)
}

describe('B5 — combat Vortex complet (1 cœur)', () => {
  bench('scripted', () => fight('scripted'), { time: 0, iterations: 3, warmupTime: 0, warmupIterations: 0 })
  bench('fast', () => fight('fast'), { time: 0, iterations: 3, warmupTime: 0, warmupIterations: 0 })
  bench('standard', () => fight('standard'), { time: 0, iterations: 1, warmupTime: 0, warmupIterations: 0 })
})

afterAll(() => {
  console.log(`\n${notes.join('\n')}`)
})
