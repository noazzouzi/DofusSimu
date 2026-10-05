/**
 * Ablations appariées de l'IA de groupe sur combats complets (docs/design/ai.md §10.3, §16.5) — WP2.
 *
 * Campagne coûteuse (≈ 3 min sur 1 cœur) et sensible à l'IA des monstres (WP1) et au moteur : elle n'est jouée que sur
 * demande (`AI_ABLATIONS=1 npx vitest run tests/ai-team-ablation.test.ts`). Les ablations par tactique qui tiennent au
 * niveau d'UNE décision (déterministes, robustes) sont dans la suite par défaut : `stateChain` (P3, fast), `carryThrow`
 * (P10, standard), `glyphClock` (P6), `mpLock` (P1b/P1c, fast et standard) — tests/ai-puzzles-*.test.ts.
 *
 * Combat dur de référence : équipe méta (Iop, Crâ, Enutrof, Eniripsa ; presets et stuffs réels de WP4) contre 4
 * monstres du Vortex au grade 5 sur la vraie salle, `fast`, 12 graines communes (dés re-semés par tour, E1 :
 * comparaison appariée). Score d'un combat (§15.2) : `victoire ? 1 + 0,1·PV% − tours/600 : 0,8·progrès`, sommé.
 *
 * Mesures de la revue (moteur et IA des monstres du 5 octobre après 04 h 20 ; `bodyBlock` désactivée, prior θ = 0) :
 *   complète           score 13,044 — 5,08 tours, 95,5 % PV, 0 mort
 *   sans tactiques     score 13,033 — 5,58 tours, 95,4 % PV, 0 mort
 *   offensifs seuls    score 12,956 — 5,08 tours, 88,1 % PV, 0 mort
 *   sans stateChain    score 13,057 ; sans mpLock 13,064 ; sans burstSetup 13,058 (gains par tactique non mesurables
 *                      ici : écarts de ±0,02, dans le bruit) ; sans healCleanse 13,004 ; sans groupForZone 13,021
 *   AVEC bodyBlock     score 12,808 — 5,75 tours, 77,0 % PV, 6 morts  (⇒ désactivée par défaut, §10.3)
 * Sur le moteur précédent (avant 04 h 20) : sans stateChain 7,25 tours / 80 % / 5 morts, sans mpLock 6,67 / 77 % / 6,
 * sans healCleanse 6,08 / 90 % / 2, sans groupForZone 11/12 victoires, sans burstSetup 12 morts : les écarts par
 * tactique au niveau du combat ne sont PAS stables d'une version à l'autre (dynamique chaotique) ; seuls « sans
 * tactiques » et « offensifs seuls » sont affirmés ici, les autres sont mesurés et imprimés.
 */
import { describe, expect, it } from 'vitest'
import { defaultAIConfig, loadTheta, type ThetaJson } from '../src/ai'
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

const RUN = process.env.AI_ABLATIONS === '1'
const HARD = 'control:143393281:3834,3836,3837,3838'
const META = 'iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer'
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

interface Outcome { win: boolean; rounds: number; hp: number; deaths: number; score: number }

/** Combat complet `fast` du combat dur avec un `TeamController` configuré (`opts` : ablation). */
function fight(seed: number, opts: TeamOptions, edit?: (t: ThetaJson) => void): Outcome {
  const data = loadDataStore('data')
  const theta = loadTheta()
  edit?.(theta)
  const scenario = resolveScenario(HARD)
  const engine = createEngine(data, scenario.hooks)
  const spec: FightSpec = { scenarioId: HARD, team: parseTeam(META, data), mode: 'fast', theta, variantPolicy: 'default', monsterNoise: 0 }
  const players = buildTeam(data, spec.team)
  const { params } = fightParams(scenario, spec, seed)
  const f = scenario.createFight(engine, players, { params, seed, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  const cfg = defaultAIConfig('fast', seed, theta)
  const team = new TeamController(cfg, scenario.aiModel(params, theta), opts)
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

async function campaign(opts: TeamOptions, edit?: (t: ThetaJson) => void): Promise<{ score: number; line: string }> {
  let score = 0
  let rounds = 0
  let hp = 0
  let deaths = 0
  for (const seed of SEEDS) {
    const o = fight(seed, opts, edit)
    score += o.score
    rounds += o.rounds
    hp += o.hp
    deaths += o.deaths
    await yieldToEventLoop()
  }
  const n = SEEDS.length
  return { score, line: `score ${score.toFixed(4)} — ${(rounds / n).toFixed(2)} tours, ${(100 * hp / n).toFixed(1)} % PV, ${deaths} morts` }
}

const off = (...ids: TacticId[]): TeamOptions => ({ disabledTactics: new Set(ids) })
const ALL: TacticId[] = ['stateChain', 'mpLock', 'carryThrow', 'glyphClock', 'healCleanse', 'bodyBlock', 'groupForZone', 'burstSetup']

describe.skipIf(!RUN)('ablations appariées sur combats complets (§10.3, §16.5) — fast, combat dur, 12 graines', () => {
  it('sorts non offensifs et tactiques : la configuration complète fait mieux ; écarts par tactique mesurés', async () => {
    const base = await campaign({})
    const lines = [`complète          ${base.line}`]
    const asserted: [string, TeamOptions][] = [['sans tactiques', off(...ALL)], ['offensifs seuls', { offensiveOnly: true }]]
    const measured: [string, TeamOptions][] = (['stateChain', 'mpLock', 'healCleanse', 'groupForZone', 'burstSetup'] as TacticId[]).map(id => [`sans ${id}`, off(id)])
    const worse: string[] = []
    for (const [name, o] of asserted) {
      const r = await campaign(o)
      lines.push(`${name.padEnd(17)} ${r.line}`)
      if (!(r.score < base.score)) worse.push(name)
    }
    for (const [name, o] of measured) lines.push(`${name.padEnd(17)} ${(await campaign(o)).line}`)
    lines.push(`avec bodyBlock    ${(await campaign({}, t => { (t.tactics.prior as Record<string, number>).bodyBlock = 1 })).line}`)
    console.info(`[ablations]\n  ${lines.join('\n  ')}`)
    expect(worse).toEqual([])
  }, 1_800_000)
})
