/**
 * Banc B3 de l'IA des monstres (docs/design/ai.md §14.1, §16.6) : millisecondes par tour de monstre `play` / `predict`
 * (cibles ≤ 1,8 / ≤ 0,9 ms, échec CI à ×2), 1 cœur, vraies données.
 *
 * Corpus : débuts de tours de monstres de vrais combats de l'Œil de Vortex (scénario complet : vagues, heures,
 * glyphes ; personnages et monstres « attaque au plus près », 30 000 PV), capturés par clonage : le corpus ne dépend
 * pas du cerveau mesuré. Chaque appel de `bench` joue UN tour
 * sur un clone neuf de l'état suivant du corpus ; le banc « clone seul » donne le coût du clonage à retrancher.
 *
 *   npx vitest bench bench/monster.bench.ts
 */
import { bench, describe } from 'vitest'
import { fightAISeed } from '../src/ai/core/rng'
import { createMonsterBrain, type MonsterBrain } from '../src/ai/monster'
import { loadTheta } from '../src/ai/theta'
import type { AIConfig } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import { nearestAttackController, scriptedVortexController } from '../src/dungeons/generic/controllers'
import { VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { createEngine, type Engine } from '../src/engine'
import { runFight, type Controller } from '../src/engine/runner'
import type { FightState } from '../src/engine/types'

const data = loadDataStore('data')
const theta = loadTheta()

function cfg(seed: number): AIConfig {
  const m = theta.monster
  return {
    mode: 'fast',
    budget: { maxNodes: 0, width: 0, topK: 0, maxDepth: 0, endCells: 0, rollouts: 0, pessimism: 0, keyDecisionBoost: 1, maxKeyDecisions: 0, mctsIterations: 0, maxReplans: 0, replanFraction: 0, quotas: { damage: 0, control: 0, placement: 0, heal: 0, buff: 0, summon: 0, mark: 0, utility: 0 }, mandatoryMax: 0 },
    theta,
    monster: { topK: m.topK, predictTopK: m.predictTopK, noiseTau: 0, referenceTopK: m.referenceTopK },
    seed: fightAISeed(seed),
    explain: false,
    unsupportedSpells: 'skip',
  }
}

interface Sample { engine: Engine; fight: FightState; meId: number }
const corpus: Sample[] = []
let turns = 0
for (const seed of [1, 2, 3]) {
  const engine = createEngine(data, vortexHooks)
  const team = createSmokeTeam(data, [8, 9, 3, 7], { hp: 30000 })
  const fight = createVortexFight(engine, team, { params: { ...VORTEX_DEFAULT_PARAMS, maxRounds: 14 }, seed, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  // Corpus indépendant du cerveau mesuré : les monstres jouent « au plus près » (contrôleur de fumée du scénario).
  const players = nearestAttackController()
  const smoke = scriptedVortexController()
  const monsters: Controller = {
    playTurn(e, f, me) {
      if (me.ap > 0 && !e.passesTurn(me)) corpus.push({ engine: e, fight: e.cloneFight(f, false), meId: me.id })
      smoke.playTurn(e, f, me)
      turns++
    },
  }
  runFight(engine, fight, f => (f.team === 0 ? players : monsters))
}

const brains: Record<'play' | 'predict', MonsterBrain> = { play: createMonsterBrain(cfg(9), 'play'), predict: createMonsterBrain(cfg(9), 'predict') }
const idx = { play: 0, predict: 0, clone: 0 }
// Préchauffage (JIT, profils de sorts, tables DPT) : un passage complet par réglage.
for (const k of ['play', 'predict'] as const) {
  for (const s of corpus) {
    const c = s.engine.cloneFight(s.fight, false)
    brains[k].playTurn(s.engine, c, c.fighters[s.meId])
  }
}

// Chaque banc parcourt le corpus entier au moins une fois (moyenne sur tous les débuts de tours, pas sur les premiers).
const opts = { iterations: corpus.length, time: 2000 }

describe(`B3 — tour de monstre (${corpus.length} débuts de tours, ${turns} tours capturés)`, () => {
  bench('B3 play (clone + tour)', () => {
    const s = corpus[idx.play++ % corpus.length]
    const c = s.engine.cloneFight(s.fight, false)
    brains.play.playTurn(s.engine, c, c.fighters[s.meId])
  }, opts)
  bench('B3 predict (clone + tour)', () => {
    const s = corpus[idx.predict++ % corpus.length]
    const c = s.engine.cloneFight(s.fight, false)
    brains.predict.playTurn(s.engine, c, c.fighters[s.meId])
  }, opts)
  bench('référence : clone seul', () => {
    const s = corpus[idx.clone++ % corpus.length]
    s.engine.cloneFight(s.fight, false)
  }, opts)
})
