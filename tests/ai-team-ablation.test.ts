/**
 * Ablations appariées de l'IA de groupe sur combats complets (docs/design/ai.md §10.3, §16.4, §16.5) — WP2.
 *
 * « Une tactique propose, la simulation décide, l'ablation juge » : sur P1 (`mpLock`), P8 (`healCleanse`), P15
 * (`bodyBlock`) la recherche générique retrouve le même plan d'un tour avec ou sans la tactique ; leur valeur se mesure
 * donc au niveau du COMBAT. Combat dur de référence : équipe méta (Iop, Crâ, Enutrof, Eniripsa ; presets et stuffs
 * réels de WP4) contre 4 monstres du Vortex au grade 5 sur la vraie salle, `fast`, mêmes graines (dés re-semés par
 * tour, E1 : comparaison appariée). Score d'un combat (§15.2) : `victoire ? 1 + 0,1·PV% − tours/600 : 0,8·progrès`,
 * sommé sur les graines ; la configuration complète doit faire STRICTEMENT mieux que chaque ablation.
 *
 * Mesures de la revue (12 graines, fast) — complète : 12/12, 5,25 tours, 95 % de PV, 0 mort (et identique sous des
 * perturbations neutres de θ à ±1 %) ; sans stateChain 7,25 tours / 80 % / 5 morts ; sans mpLock 6,67 / 77 % / 6 ;
 * sans healCleanse 6,08 / 90 % / 2 ; sans groupForZone 11/12, 65 % / 15 morts ; sans burstSetup 5,58 / 68 % / 12 ;
 * sans aucune tactique 6,92 / 93 % / 0 ; sorts non offensifs interdits 5,67 / 79 % / 2 ; sans bodyBlock 5,00 / 95 % /
 * 0 (aucun gain mesurable sur cette salle ouverte : non testé ici). Ces écarts dépendent de l'IA des monstres (WP1) :
 * un échec après une évolution de celle-ci signale une tactique qui ne paie plus (§10.3 : elle serait retirée).
 */
import { describe, expect, it } from 'vitest'
import { defaultAIConfig, loadTheta } from '../src/ai'
import { observeVisibility } from '../src/ai/core'
import { createMonsterBrain } from '../src/ai/monster/brain'
import { TeamController, type TeamOptions } from '../src/ai/team/controller'
import type { TacticId } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import { createEngine } from '../src/engine'
import { runFight } from '../src/engine/runner'
import { buildTeam, fightParams, resolveScenario } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'
import { yieldToEventLoop } from './ai-core-helpers'

const DATA = loadDataStore('data')
const THETA = loadTheta()
const HARD = 'control:143393281:3834,3836,3837,3838'
const META = 'iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer'

interface Outcome { win: boolean; rounds: number; hp: number; deaths: number; score: number }

/** Combat complet `fast` du combat dur avec un `TeamController` configuré (`opts` : ablation). */
function fight(seed: number, opts: TeamOptions): Outcome {
  const scenario = resolveScenario(HARD)
  const engine = createEngine(DATA, scenario.hooks)
  const spec: FightSpec = { scenarioId: HARD, team: parseTeam(META, DATA), mode: 'fast', theta: THETA, variantPolicy: 'default', monsterNoise: 0 }
  const players = buildTeam(DATA, spec.team)
  const { params } = fightParams(scenario, spec, seed)
  const f = scenario.createFight(engine, players, { params, seed, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  const cfg = defaultAIConfig('fast', seed, THETA)
  const team = new TeamController(cfg, scenario.aiModel(params, THETA), opts)
  const monsters = createMonsterBrain(cfg, 'play')
  const side = players[0].team
  runFight(engine, f, () => ({
    playTurn(e, s, me) {
      observeVisibility(s)
      ;(me.team === side ? team : monsters).playTurn(e, s, me)
    },
  }))
  const sum = scenario.summarize(f)
  const chars = f.fighters.filter(x => x.team === side && x.kind === 'player')
  const hp = chars.reduce((a, x) => a + (x.alive ? Math.min(x.hp, x.baseMaxHp) : 0), 0) / chars.reduce((a, x) => a + x.baseMaxHp, 0)
  const score = sum.win ? 1 + 0.1 * hp - sum.rounds / 600 : 0.8 * sum.progress
  return { win: sum.win, rounds: sum.rounds, hp, deaths: chars.filter(x => !x.alive).length, score }
}

async function campaign(seeds: number[], opts: TeamOptions): Promise<{ score: number; line: string }> {
  let score = 0
  const parts: string[] = []
  for (const seed of seeds) {
    const o = fight(seed, opts)
    score += o.score
    parts.push(`${seed}:${o.win ? 'V' : 'D'}${o.rounds}/${o.hp.toFixed(2)}/${o.deaths}`)
    await yieldToEventLoop()
  }
  return { score, line: `${score.toFixed(4)} | ${parts.join(' ')}` }
}

const off = (...ids: TacticId[]): TeamOptions => ({ disabledTactics: new Set(ids) })
const ALL: TacticId[] = ['stateChain', 'mpLock', 'carryThrow', 'glyphClock', 'healCleanse', 'bodyBlock', 'groupForZone', 'burstSetup']

describe('ablations appariées sur combats complets (§10.3, §16.5) — fast, combat dur', () => {
  it('chaque tactique v1 démontrée ici (stateChain, mpLock, groupForZone, burstSetup) fait gagner du score (4 graines)', async () => {
    const seeds = [1, 2, 3, 4]
    const base = await campaign(seeds, {})
    const lines = [`complète         ${base.line}`]
    const worse: string[] = []
    for (const id of ['stateChain', 'mpLock', 'groupForZone', 'burstSetup'] as TacticId[]) {
      const r = await campaign(seeds, off(id))
      lines.push(`sans ${id.padEnd(12)} ${r.line}`)
      if (!(r.score < base.score)) worse.push(id)
    }
    console.info(`[ablations] ${lines.join('\n             ')}`)
    expect(worse).toEqual([])
  }, 600_000)

  it('healCleanse, toutes les tactiques, sorts non offensifs : la configuration complète fait mieux (6 graines)', async () => {
    const seeds = [1, 2, 3, 4, 5, 6]
    const base = await campaign(seeds, {})
    const variants: [string, TeamOptions][] = [['sans healCleanse', off('healCleanse')], ['sans tactiques', off(...ALL)], ['offensifs seuls', { offensiveOnly: true }]]
    const lines = [`complète         ${base.line}`]
    const worse: string[] = []
    for (const [name, o] of variants) {
      const r = await campaign(seeds, o)
      lines.push(`${name.padEnd(16)} ${r.line}`)
      if (!(r.score < base.score)) worse.push(name)
    }
    console.info(`[ablations] ${lines.join('\n             ')}`)
    expect(worse).toEqual([])
  }, 600_000)
})
