/**
 * Combats de contrôle de l'IA de groupe (docs/design/ai.md §16.5) — WP2, combats COMPLETS sur vraies données
 * (presets et stuffs réels de WP4, scénarios génériques de WP3 via `runOne`) :
 *  - 4 personnages équipés contre 4 Bouftous ⇒ victoire en ≤ 3 tours (fast sur 8 graines, standard sur 2) ;
 *  - miroir 1 c 1 (même classe, même stuff, côté et équipe qui commence tirés sur la graine) ⇒ ≈ 50 % ;
 *  - échelle : `fast` fait au moins aussi bien que `scripted` sur un combat dur (4 monstres du Vortex, grade 5),
 *    appariée sur les mêmes graines ; l'IA simule réellement (nœuds > 0), joue des actions non offensives
 *    (coups « créatifs ») et utilise ses tactiques.
 */
import { describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { runOne } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'
import { yieldToEventLoop } from './ai-core-helpers'

const DATA = loadDataStore('data')
const THETA = loadTheta()
const META = 'iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer'

function spec(scenarioId: string, team: string, mode: FightSpec['mode']): FightSpec {
  return { scenarioId, team: parseTeam(team, DATA), mode, theta: THETA, variantPolicy: 'default', monsterNoise: 0 }
}

describe('combats de contrôle (§16.5)', () => {
  it('4 personnages équipés contre 4 Bouftous : 100 % de victoires en ≤ 3 tours (fast, 8 graines)', async () => {
    const s = spec('control:121373185:101*4', META, 'fast')
    for (let seed = 1; seed <= 8; seed++) {
      const r = runOne(DATA, s, seed).summary
      expect(r.win, `graine ${seed} : ${r.endReason}`).toBe(true)
      expect(r.rounds, `graine ${seed}`).toBeLessThanOrEqual(3)
      expect(r.nodes).toBeGreaterThan(0)
      await yieldToEventLoop()
    }
  }, 180_000)

  it('4 personnages équipés contre 4 Bouftous en standard : victoire en ≤ 3 tours (2 graines)', async () => {
    const s = spec('control:121373185:101*4', META, 'standard')
    for (const seed of [1, 2]) {
      const r = runOne(DATA, s, seed).summary
      expect(r.win).toBe(true)
      expect(r.rounds).toBeLessThanOrEqual(3)
      await yieldToEventLoop()
    }
  }, 180_000)

  it('miroir 1 c 1 (Iop contre Iop, fast) : ≈ 50 % de victoires parmi les combats décidés (24 graines, ±25 points)', async () => {
    const s = spec('mirror', 'iop:killer', 'fast')
    let wins = 0
    let decided = 0
    for (let seed = 1; seed <= 24; seed++) {
      const r = runOne(DATA, s, seed).summary
      await yieldToEventLoop()
      if (r.endReason.includes('Limite')) continue
      decided++
      if (r.win) wins++
    }
    // Anti-blocage (finalMove.ts) : la majorité des miroirs se décident avant la limite de 30 tours.
    expect(decided).toBeGreaterThanOrEqual(12)
    const rate = wins / decided
    console.info(`[miroir] ${wins}/${decided} = ${(100 * rate).toFixed(0)} %`)
    expect(rate).toBeGreaterThanOrEqual(0.25)
    expect(rate).toBeLessThanOrEqual(0.75)
  }, 300_000)

  it('échelle appariée sur un combat dur (4 monstres du Vortex) : fast ≥ scripted, IA réellement simulée et créative', async () => {
    const hard = 'control:143393281:3834,3836,3837,3838'
    let fastWins = 0
    let scriptedWins = 0
    let fastHp = 0
    let scriptedHp = 0
    let creative = 0
    const tactics = new Set<string>()
    for (let seed = 1; seed <= 6; seed++) {
      const f = runOne(DATA, spec(hard, META, 'fast'), seed).summary
      const sc = runOne(DATA, spec(hard, META, 'scripted'), seed).summary
      if (f.win) fastWins++
      if (sc.win) scriptedWins++
      fastHp += f.win ? f.hpLeftPct : 0
      scriptedHp += sc.win ? sc.hpLeftPct : 0
      expect(f.nodes).toBeGreaterThan(0)
      expect(sc.nodes).toBe(0)
      creative += f.creativeActions
      for (const k of Object.keys(f.tactics)) tactics.add(k)
      await yieldToEventLoop()
    }
    console.info(`[échelle] fast ${fastWins}/6 (PV ${fastHp.toFixed(2)}) — scripted ${scriptedWins}/6 (PV ${scriptedHp.toFixed(2)}) — créatifs ${creative}, tactiques ${[...tactics].join(', ')}`)
    expect(fastWins).toBeGreaterThanOrEqual(scriptedWins)
    expect(fastWins + fastHp).toBeGreaterThan(scriptedWins + scriptedHp)
    expect(creative).toBeGreaterThan(0)
    expect(tactics.size).toBeGreaterThan(0)
  }, 600_000)
})
