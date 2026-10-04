/**
 * Banc B6 (docs/design/ai.md §16.6) — débit du pool de workers en mode `fast` sur l'Œil de Vortex complet, graines
 * fixes : 1, 2 et 4 workers. Cible : ≥ 4 combats/s à 4 workers (échec CI < 2). Une itération = un lot de 16 combats
 * (pool déjà démarré et préchauffé sur la configuration mesurée : chargement des données et JIT exclus). Le combat de contrôle (4 monstres de
 * vague) et le mode `scripted` sont mesurés en complément.
 *
 *   npx vitest bench bench/pool.bench.ts
 */
import { afterAll, bench, describe } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { runBatch } from '../src/optimizer/montecarlo'
import { createNodePool } from '../src/optimizer/pool/node'
import type { ManagedPool } from '../src/optimizer/pool/pool'
import { campaignSeeds } from '../src/optimizer/seeds'
import { parseTeam } from '../src/optimizer/team/presets'
import type { AIMode } from '../src/ai/types'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const TEAM = parseTeam('iop:killer,cra:killer,enutrof:mpLock,pandawa:placer', DATA)
const SEEDS = campaignSeeds(6, 16)
const pools = new Map<number, ManagedPool>()
const rates: string[] = []

function spec(mode: AIMode, scenarioId = 'vortex'): FightSpec {
  return { scenarioId, team: TEAM, mode, theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
}

async function poolOf(n: number): Promise<ManagedPool> {
  let p = pools.get(n)
  if (!p) {
    p = createNodePool(n)
    pools.set(n, p)
    await runBatch(spec('scripted'), SEEDS.slice(0, n), p, { chunk: 1 }) // démarrage + chargement des données
  }
  return p
}

const warmed = new Set<string>()

async function measure(label: string, n: number, s: FightSpec): Promise<void> {
  const pool = await poolOf(n)
  // Préchauffage par configuration (JIT des chemins de l'IA et du scénario mesurés) hors mesure : 2 graines par worker.
  const key = `${n}:${s.mode}:${s.scenarioId}`
  if (!warmed.has(key)) {
    warmed.add(key)
    await runBatch(s, campaignSeeds(0x5eed, 2 * n), pool, { chunk: 1 })
  }
  const t0 = performance.now()
  await runBatch(s, SEEDS, pool) // paquets adaptatifs (autoChunk)
  const sec = (performance.now() - t0) / 1000
  rates.push(`${label} : ${(SEEDS.length / sec).toFixed(2)} combats/s`)
}

const opts = { time: 0, iterations: 2, warmupTime: 0, warmupIterations: 0 }

describe('B6 — débit du pool (Vortex complet, 16 combats par itération)', () => {
  for (const n of [1, 2, 4]) {
    bench(`fast — ${n} worker(s)`, () => measure(`B6 fast ${n} worker(s)`, n, spec('fast')), opts)
  }
  bench('scripted — 4 workers', () => measure('scripted 4 workers', 4, spec('scripted')), opts)
  bench('fast — 4 workers — combat de contrôle', () => measure('contrôle fast 4 workers', 4, spec('fast', 'control:143393281:3834,3836,3837,3838')), opts)
})

afterAll(async () => {
  console.log(`\n${rates.join('\n')}`)
  await Promise.all([...pools.values()].map(p => p.close()))
})
