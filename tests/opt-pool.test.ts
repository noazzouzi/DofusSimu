/**
 * WP4a — pool de workers (docs/design/ai.md §15.7, §16.5) : résultats identiques avec 1 et 4 workers
 * (`node:worker_threads`) et avec le pool local, quel que soit l'ordre d'achèvement ; arrêt séquentiel déterministe ;
 * erreurs et annulation ; modules préchargés (scénario enregistré dans chaque worker).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { runBatch } from '../src/optimizer/montecarlo'
import { createNodePool } from '../src/optimizer/pool/node'
import { createLocalPool, createPool, type Endpoint, type ManagedPool } from '../src/optimizer/pool/pool'
import { createWorkerHandler, type FromWorker } from '../src/optimizer/pool/protocol'
import { MemoryDataStore, createBundle } from '../src/data/memory'
import { STUFFS } from '../src/optimizer/team/presets'
import { runOne } from '../src/optimizer/runner'
import { campaignSeeds } from '../src/optimizer/seeds'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec, WorkerResult } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const CONTROL = 'control:143393281:3834,3836,3837,3838'
const TEAM = parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA)
const SPEC: FightSpec = { scenarioId: CONTROL, team: TEAM, mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
const SEEDS = campaignSeeds(31, 24)

let pool1: ManagedPool
let pool4: ManagedPool

beforeAll(() => {
  pool1 = createNodePool(1)
  pool4 = createNodePool(4)
})
afterAll(async () => {
  await pool1?.close()
  await pool4?.close()
})

describe('pool Node (worker_threads)', () => {
  it('1 worker = 4 workers = pool local = runOne (déterminisme, §13.2)', async () => {
    const local = await runBatch(SPEC, SEEDS, createLocalPool(DATA))
    const one = await runBatch(SPEC, SEEDS, pool1)
    const four = await runBatch(SPEC, SEEDS, pool4, { chunk: 2 })
    expect(one.summaries).toEqual(local.summaries)
    expect(four.summaries).toEqual(local.summaries)
    expect(four.result).toEqual(local.result)
    expect(local.summaries[0]).toEqual(runOne(DATA, SPEC, SEEDS[0]).summary)
    // Les 4 workers ont bien travaillé (12 paquets de 2 graines).
    expect(pool4.stats().tasksByWorker.filter(n => n > 0).length).toBeGreaterThan(1)
  }, 300_000)

  it('variantes tirées (robuste) et mode random : mêmes résultats en parallèle', async () => {
    const spec: FightSpec = { ...SPEC, scenarioId: 'vortex', variantPolicy: 'sampled', playerPolicy: 'random' }
    const seeds = SEEDS.slice(0, 8)
    const local = await runBatch(spec, seeds, createLocalPool(DATA))
    const four = await runBatch(spec, seeds, pool4, { chunk: 1 })
    expect(four.summaries).toEqual(local.summaries)
    expect(new Set(local.summaries.map(s => s.variant)).size).toBeGreaterThan(1)
  }, 300_000)

  it('arrêt séquentiel : même N d\'arrêt et mêmes résultats avec 1 et 4 workers', async () => {
    const stop = { minN: 8, maxN: 24, halfWidth: 0.2 }
    const a = await runBatch(SPEC, SEEDS, pool1, { stop, checkEvery: 4 })
    const b = await runBatch(SPEC, SEEDS, pool4, { stop, checkEvery: 4 })
    expect(b.n).toBe(a.n)
    expect(b.summaries).toEqual(a.summaries)
    expect(b.computed).toBeGreaterThanOrEqual(b.n) // préchargement éventuel au-delà de N
  }, 300_000)

  it('erreurs propagées, annulation, pool utilisable ensuite', async () => {
    const bad = pool4.run([{ taskId: 9001, spec: { ...SPEC, scenarioId: 'inconnu' }, seeds: [1], kind: 'full', record: false }])
    await expect((async () => { for await (const _ of bad) void _ })()).rejects.toThrow(/inconnu/)
    // Annulation d'une tâche en attente (la file du pool à 1 worker est occupée par la première).
    const results: WorkerResult[] = []
    const it1 = pool1.run([
      { taskId: 9101, spec: SPEC, seeds: [SEEDS[0]], kind: 'full', record: false },
      { taskId: 9102, spec: SPEC, seeds: [SEEDS[1]], kind: 'full', record: false },
    ])
    pool1.cancel(9102)
    await expect((async () => { for await (const r of it1) results.push(r) })()).rejects.toThrow(/annulée/)
    const after = await runBatch(SPEC, SEEDS.slice(0, 2), pool1)
    expect(after.summaries).toHaveLength(2)
  }, 300_000)

  it('preload : un scénario enregistré par un module est disponible dans chaque worker', async () => {
    const dungeons = new URL('../src/dungeons/index.ts', import.meta.url).href
    const runner = new URL('../src/optimizer/runner.ts', import.meta.url).href
    const code = `import { registerScenario } from '${dungeons}'; import { controlScenario } from '${runner}';` +
      ` registerScenario({ ...controlScenario('control:143393281:3838*2'), id: 'opt-test-duel' })`
    const pool = createNodePool(2, { preload: [`data:text/javascript,${encodeURIComponent(code)}`] })
    try {
      const spec: FightSpec = { ...SPEC, scenarioId: 'opt-test-duel' }
      const r = await runBatch(spec, SEEDS.slice(0, 4), pool, { chunk: 1 })
      expect(r.summaries).toHaveLength(4)
      expect(r.summaries.every(s => s.rounds > 0)).toBe(true)
    } finally {
      await pool.close()
    }
  }, 300_000)

  it('chemin navigateur : transport en mémoire (clonage structuré) + MemoryDataStore d\'un lot = mêmes résultats', async () => {
    const bundle = createBundle(DATA, {
      breedIds: TEAM.map(m => m.breedId),
      monsterIds: [3834, 3836, 3837, 3838],
      mapIds: [143393281],
      itemIds: Object.values(STUFFS).flatMap(st => st.items.map(i => i.itemId)),
    })
    const mem = new MemoryDataStore(JSON.parse(JSON.stringify(bundle)))
    const endpoint = (): Endpoint => {
      let onMsg: (m: FromWorker) => void = () => {}
      const handler = createWorkerHandler(
        m => queueMicrotask(() => onMsg(structuredClone(m))),
        init => new MemoryDataStore(init.bundle!),
      )
      return { post: m => void handler(structuredClone(m)), onMessage: cb => void (onMsg = cb), onError: () => {}, terminate: () => {} }
    }
    const pool = createPool(3, endpoint, { type: 'init', bundle })
    try {
      const seeds = SEEDS.slice(0, 6)
      const web = await runBatch(SPEC, seeds, pool, { chunk: 1 })
      const local = await runBatch(SPEC, seeds, createLocalPool(DATA))
      expect(web.summaries).toEqual(local.summaries)
      expect((await runBatch(SPEC, seeds, createLocalPool(mem))).summaries).toEqual(local.summaries)
    } finally {
      await pool.close()
    }
  }, 300_000)
})
