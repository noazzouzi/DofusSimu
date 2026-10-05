/**
 * Garde-fou de déterminisme des optimisations de performance : empreintes de combats à graines fixes.
 *
 * Pour chaque graine : combat Vortex (équipe méta) joué en mode `--mode` (fast par défaut), enregistré (`record`) ;
 * sortie JSON par ligne : empreinte d'état (`fightDigest` = FightSummary.eventsHash), hash strict de TOUS les
 * événements du replay (logs et annotations compris), hash hors log/aiNote, nombre d'événements, tours, nœuds.
 * `--turns N` : s'arrête après N tours de combattants (mode standard : quelques tours seulement).
 * `--norecord` : même combat sans enregistrement (l'empreinte d'état doit être identique).
 * `--deepclone` : `Engine.cloneFight` ramené à l'ancienne sémantique (combattants copiés en profondeur, métriques
 * copiées) — référence du partage copie-sur-écriture (src/engine/cow.ts) : sorties identiques avec et sans, sur le
 * même arbre (aucune autre différence de code nécessaire, contrairement à une comparaison entre deux commits).
 *
 *   npx tsx scripts/perf-digest.ts --mode fast --seeds 1-10 > before.jsonl
 *   npx tsx scripts/perf-digest.ts --mode standard --turns 12 --seeds 1-3
 *   npx tsx scripts/perf-digest.ts --seeds 1-10 --deepclone > deep.jsonl   # puis : cmp before.jsonl deep.jsonl
 */
import { createControllers, defaultAIConfig, loadTheta } from '../src/ai'
import type { AIMode, StrategyParams } from '../src/ai/types'
import { fnv1a32 } from '../src/core/hash'
import { loadDataStore } from '../src/data/node'
import { createEngine } from '../src/engine'
import { cloneFighter, Engine } from '../src/engine/engine'
import type { FightEvent, FighterMetrics, FightState } from '../src/engine/types'
import { buildTeam, eventsHash, fightDigest, fightParams, resolveScenario, runOne } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'

const META = 'cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu'

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def
}
function seedsOf(text: string): number[] {
  const out: number[] = []
  for (const part of text.split(',')) {
    const m = /^(\d+)-(\d+)$/.exec(part)
    if (m) for (let s = Number(m[1]); s <= Number(m[2]); s++) out.push(s)
    else out.push(Number(part))
  }
  return out
}

const mode = arg('mode', 'fast') as AIMode
const turns = Number(arg('turns', '0'))
const scenarioId = arg('scenario', 'vortex')
const record = !process.argv.includes('--norecord')
const seeds = seedsOf(arg('seeds', '1-10'))
const data = loadDataStore('data')

if (process.argv.includes('--deepclone')) {
  const shared = Engine.prototype.cloneFight
  Engine.prototype.cloneFight = function (this: Engine, fight: FightState, rec = false): FightState {
    const c = shared.call(this, fight, rec)
    c.fighters = c.fighters.map(cloneFighter)
    const m: Record<number, FighterMetrics> = {}
    for (const k in c.metrics) m[k] = { ...c.metrics[k] }
    c.metrics = m
    return c
  }
  process.stderr.write('cloneFight : copie profonde (--deepclone)\n')
}
const spec: FightSpec = { scenarioId, team: parseTeam(arg('team', META), data), mode, theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }

function strictHash(events: readonly FightEvent[]): number {
  let h = 0x811c9dc5
  for (const e of events) h = fnv1a32(JSON.stringify(e), h)
  return h
}

for (const seed of seeds) {
  const t0 = performance.now()
  let digest: number
  let fightEvents: readonly FightEvent[]
  let rounds: number
  let nodes = 0
  if (turns <= 0) {
    const r = runOne(data, spec, seed, { record })
    digest = r.summary.eventsHash
    if (digest !== fightDigest(r.fight)) throw new Error('digest mismatch')
    fightEvents = r.fight.events
    rounds = r.summary.rounds
    nodes = r.summary.nodes
  } else {
    // Même préparation que `runOne` (src/optimizer/runner.ts `prepare`), arrêt après `turns` tours.
    const scenario = resolveScenario(spec.scenarioId)
    const engine = createEngine(data, scenario.hooks)
    const team = buildTeam(data, spec.team)
    const { params } = fightParams(scenario, spec, seed)
    const fight = scenario.createFight(engine, team, { params, seed, placement: spec.placement, rollMode: 'random', record, rngRekey: 'perTurn' })
    const cfg = defaultAIConfig(spec.mode, seed, spec.theta as StrategyParams)
    cfg.monster = { ...cfg.monster, noiseTau: spec.monsterNoise }
    cfg.explain = record
    const controllers = createControllers(engine, cfg, { scenario: scenario.aiModel(params, spec.theta) })
    for (let i = 0; i < turns && !fight.ended; i++) {
      const f = engine.nextTurn(fight)
      if (!f) break
      const canPlay = f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
      if (canPlay) controllers(f).playTurn(engine, fight, f)
      if (!fight.ended && f.alive) engine.endTurn(fight, f)
      else if (!fight.ended) engine.emit(fight, { t: 'turnEnd', fighter: f.id })
    }
    digest = fightDigest(fight)
    fightEvents = fight.events
    rounds = fight.round
    nodes = controllers.stats().nodes
  }
  const ms = performance.now() - t0
  const line = {
    seed, mode, turns, record, digest,
    strict: record ? strictHash(fightEvents) : 0,
    events: record ? eventsHash(fightEvents) : 0,
    n: fightEvents.length, rounds, nodes,
  }
  process.stdout.write(`${JSON.stringify(line)}\n`)
  process.stderr.write(`seed ${seed} ${mode}${turns ? ` ${turns} tours` : ''} : ${ms.toFixed(0)} ms\n`)
}
