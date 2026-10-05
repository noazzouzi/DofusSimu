/**
 * Cas de mesure des chemins chauds (moteur + socle IA), partagés par `scripts/perf-bench.ts` (exécution simple) et
 * les comparaisons A/B entrelacées dans un même processus (deux versions du code chargées côte à côte).
 *
 * Corpus : débuts de tours (avant décision) de combats Vortex `fast` complets (équipe méta, graines fixes), clonés.
 * Chaque cas micro est `fn(i)` sur l'élément i (modulo `n`) d'une liste préparée hors mesure.
 */
import { createControllers, defaultAIConfig, loadTheta } from '../src/ai'
import { applyMacro, computeReachFor, createPerception, createView, generateCasts, simClone } from '../src/ai/core'
import { fightAISeed } from '../src/ai/core/rng'
import { createMonsterBrain } from '../src/ai/monster'
import { TeamController } from '../src/ai/team/controller'
import type { AIConfig, AIMode, MacroAction, StrategyParams } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import type { DataStore } from '../src/data/store'
import { createEngine, type Engine } from '../src/engine'
import { canCast, castSpell } from '../src/engine/cast'
import { applyEffects, target } from '../src/engine/effects/core'
import type { Buff, Fighter, FightState, KnownSpell } from '../src/engine/types'
import { buildTeam, fightParams, resolveScenario, runOne } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'

export const META = 'cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu'

export interface MicroCase {
  name: string
  n: number
  fn: (i: number) => void
}

export interface FightResult {
  rounds: number
  nodes: number
  digest: number
}

export interface PerfCases {
  data: DataStore
  /** Combat Vortex complet (`runOne`, sans enregistrement). */
  fight(mode: AIMode, seed: number): FightResult
  /** `turns` tours de combattants d'un combat Vortex (mode donné), sans enregistrement. */
  turns(mode: AIMode, seed: number, turns: number): void
  /** Micro-cas (corpus capturé à la demande : quelques secondes). */
  micro(corpusSeeds?: number[]): { cases: MicroCase[]; info: string; nodesPerDecision: () => number }
}

export function createPerfCases(dataDir = 'data'): PerfCases {
  const data = loadDataStore(dataDir)
  const theta = loadTheta()
  const specOf = (mode: AIMode): FightSpec => ({ scenarioId: 'vortex', team: parseTeam(META, data), mode, theta, variantPolicy: 'default', monsterNoise: 0 })

  function prepared(mode: AIMode, seed: number) {
    const spec = specOf(mode)
    const scenario = resolveScenario(spec.scenarioId)
    const engine = createEngine(data, scenario.hooks)
    const team = buildTeam(data, spec.team)
    const { params } = fightParams(scenario, spec, seed)
    const fight = scenario.createFight(engine, team, { params, seed, placement: undefined, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    const controllers = createControllers(engine, defaultAIConfig(mode, seed, theta as StrategyParams), { scenario: scenario.aiModel(params, theta) })
    return { engine, fight, controllers }
  }

  interface Sample { engine: Engine; fight: FightState; meId: number; kind: Fighter['kind']; team: number }

  /** Débuts de tours (avant décision) d'un combat Vortex `fast` complet (graine fixe), clonés. */
  function captureCorpus(seed: number): Sample[] {
    const { engine, fight, controllers } = prepared('fast', seed)
    const out: Sample[] = []
    for (let i = 0; i < 5000 && !fight.ended; i++) {
      const f = engine.nextTurn(fight)
      if (!f) break
      const canPlay = f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')
      if (canPlay && f.ap > 0) out.push({ engine, fight: engine.cloneFight(fight, false), meId: f.id, kind: f.kind, team: f.team })
      if (canPlay) controllers(f).playTurn(engine, fight, f)
      if (!fight.ended && f.alive) engine.endTurn(fight, f)
      else if (!fight.ended) engine.emit(fight, { t: 'turnEnd', fighter: f.id })
    }
    return out
  }

  function monsterCfg(seed: number): AIConfig {
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

  return {
    data,
    fight(mode, seed) {
      const r = runOne(data, specOf(mode), seed)
      return { rounds: r.summary.rounds, nodes: r.summary.nodes, digest: r.summary.eventsHash }
    },
    turns(mode, seed, turns) {
      const { engine, fight, controllers } = prepared(mode, seed)
      for (let i = 0; i < turns && !fight.ended; i++) {
        const f = engine.nextTurn(fight)
        if (!f) break
        if (f.tags.cannotPlay !== true && !engine.stateFlag(f, 'preventsFight')) controllers(f).playTurn(engine, fight, f)
        if (!fight.ended && f.alive) engine.endTurn(fight, f)
      }
    },
    micro(corpusSeeds = [1, 2]) {
      const corpus = corpusSeeds.flatMap(captureCorpus)
      const nF = corpus.reduce((a, s) => a + s.fight.fighters.length, 0) / Math.max(1, corpus.length)
      const nB = corpus.reduce((a, s) => a + s.fight.fighters.reduce((b, f) => b + f.buffs.length, 0), 0) / Math.max(1, corpus.length)
      const cases: MicroCase[] = []
      const add = (name: string, n: number, fn: (i: number) => void) => cases.push({ name, n, fn })

      // Lancers (sort, case) par état : cibles = cases des combattants vivants ; valides = `canCast` nul.
      interface CastCase { s: Sample; spellId: number; cell: number; spell: KnownSpell }
      const casts: CastCase[] = []
      const checks: CastCase[] = []
      for (const s of corpus) {
        const me = s.fight.fighters[s.meId]
        const cells = new Set<number>()
        for (const o of s.fight.fighters) if (o.alive && o.cell >= 0) cells.add(o.cell)
        for (const sp of me.spells) {
          for (const c of cells) {
            const cc = { s, spellId: sp.spellId, cell: c, spell: sp }
            checks.push(cc)
            if (!canCast(s.engine, s.fight, me, sp, c)) casts.push(cc)
          }
        }
      }

      add('fighterAt (560 cases)', corpus.length, i => {
        const s = corpus[i]
        for (let c = 0; c < 560; c++) s.engine.fighterAt(s.fight, c)
      })
      add('cloneFight', corpus.length, i => {
        const s = corpus[i]
        s.engine.cloneFight(s.fight, false)
      })
      add('canCast', checks.length, i => {
        const c = checks[i]
        canCast(c.s.engine, c.s.fight, c.s.fight.fighters[c.s.meId], c.spell, c.cell)
      })
      add('clone + castSpell', casts.length, i => {
        const c = casts[i]
        const f = c.s.engine.cloneFight(c.s.fight, false)
        castSpell(c.s.engine, f, f.fighters[c.s.meId], c.spellId, c.cell)
      })
      add('clone + castSpell (average)', casts.length, i => {
        const c = casts[i]
        const f = c.s.engine.cloneFight(c.s.fight, false)
        f.options.rollMode = 'average'
        castSpell(c.s.engine, f, f.fighters[c.s.meId], c.spellId, c.cell)
      })
      add('target() (tous les effets du sort)', casts.length, i => {
        const c = casts[i]
        const me = c.s.fight.fighters[c.s.meId]
        for (const e of c.spell.level.effects) target(c.s.engine, c.s.fight, me, e, c.cell, me.cell)
      })
      add('clone + applyEffects (sans canCast)', casts.length, i => {
        const c = casts[i]
        const f = c.s.engine.cloneFight(c.s.fight, false)
        const me = f.fighters[c.s.meId]
        applyEffects(c.s.engine, f, me, c.spell, c.spellId, c.spell.level.effects, c.cell, me.cell, false, false, 0)
      })
      add('computeReach (combattant courant)', corpus.length, i => {
        const s = corpus[i]
        computeReachFor(s.engine, s.fight, s.fight.fighters[s.meId], s.team as 0 | 1)
      })

      // Buffs nombreux (cas des tourelles du Steamer) : 40 buffs de caractéristiques / états sur un combattant.
      {
        const s = corpus[0]
        const f0 = s.engine.cloneFight(s.fight, false)
        const holder = f0.fighters[s.meId]
        const effect = { ...(holder.spells[0]?.level.effects[0] ?? {}), effectId: 118 } as Buff['effect']
        for (let k = 0; k < 40; k++) {
          s.engine.addBuff(f0, holder, {
            sourceId: holder.id, spellId: 1, effect, value: 10, remaining: 3, delay: 0, dispellable: true,
            statDelta: { strength: 10 + k, agility: k % 3 }, stateId: k % 5 === 0 ? 1000 + k : undefined, label: 'test', kind: 'stat',
          })
        }
        let k = 0
        add('recomputeStats (40 buffs)', 1, () => s.engine.recomputeStats(holder))
        add('addBuff + removeBuff (40 buffs)', 1, () => {
          const b = s.engine.addBuff(f0, holder, {
            sourceId: holder.id, spellId: 1, effect, value: 5, remaining: 2, delay: 0, dispellable: true,
            statDelta: { intelligence: 5 + (k++ & 7) }, label: 'x', kind: 'stat',
          })
          s.engine.removeBuff(f0, holder, b.uid)
        })
        add('cloneFight (40 buffs en plus)', 1, () => s.engine.cloneFight(f0, false))
      }

      // Nœud de recherche (B1) : simClone + applyMacro sur les candidats générés (tours de joueurs).
      const nodes: { s: Sample; view: ReturnType<typeof createView>; m: MacroAction }[] = []
      for (const s of corpus) {
        if (s.kind !== 'player') continue
        const me = s.fight.fighters[s.meId]
        const view = createView(s.engine, s.fight, me, 1234)
        const p = createPerception(view)
        for (const m of generateCasts(view, s.fight, me, { perception: p })) nodes.push({ s, view, m })
      }
      add('B1 simClone + applyMacro', nodes.length, i => {
        const { s, view, m } = nodes[i]
        const c = simClone(view, s.fight, 7)
        applyMacro(s.engine, c, s.meId, m)
      })
      add('generateCasts (perception neuve)', corpus.length, i => {
        const s = corpus[i]
        if (s.kind !== 'player') return
        const me = s.fight.fighters[s.meId]
        const view = createView(s.engine, s.fight, me, 99)
        generateCasts(view, s.fight, me, { perception: createPerception(view) })
      })

      // Tour de monstre (cerveau `play`, sans bruit) et décision de joueur (fast), sur clones.
      const mons = corpus.filter(s => s.kind !== 'player' && s.team === 1)
      const brain = createMonsterBrain(monsterCfg(9), 'play')
      add('tour de monstre play', mons.length, i => {
        const s = mons[i]
        const c = s.engine.cloneFight(s.fight, false)
        brain.playTurn(s.engine, c, c.fighters[s.meId])
      })
      const players = corpus.filter(s => s.kind === 'player')
      let nodesSum = 0
      let calls = 0
      add('décision joueur fast', players.length, i => {
        const s = players[i]
        const tc = new TeamController(defaultAIConfig('fast', i + 1, theta as StrategyParams))
        const d = tc.decide(s.engine, s.fight, s.fight.fighters[s.meId])
        nodesSum += d?.nodes ?? 0
        calls++
      })
      const info = `corpus : ${corpus.length} débuts de tours (${mons.length} monstres, ${players.length} joueurs), ${nF.toFixed(1)} combattants et ${nB.toFixed(0)} buffs en moyenne ; ${casts.length} lancers valides / ${checks.length} ; ${nodes.length} candidats B1`
      return { cases, info, nodesPerDecision: () => nodesSum / Math.max(1, calls) }
    },
  }
}
