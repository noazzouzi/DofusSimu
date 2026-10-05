/**
 * WP4b — réglage de θ (docs/design/ai.md §15.3) : criblage, CEM en espace log, validation appariée sur graines neuves.
 *
 *  - objectif SYNTHÉTIQUE bruité (bruit commun par graine = CRN, plus un bruit propre à chaque θ) dont l'optimum est
 *    connu : la CEM doit s'en approcher et améliorer l'objectif ; le criblage doit isoler les paramètres utiles ;
 *  - combats RÉELS (combat de contrôle, politique `scripted` qui n'utilise pas θ) : la chaîne complète tourne sur le
 *    pool et REJETTE un θ sans gain significatif (θ₀ rendu) — aucune acceptation fortuite.
 */
import { describe, expect, it } from 'vitest'
import { flattenTheta, loadTheta, type ThetaJson } from '../src/ai/theta'
import { mix32 } from '../src/core/hash'
import { loadDataStore } from '../src/data/node'
import { createLocalPool } from '../src/optimizer/pool/pool'
import { parseTeam } from '../src/optimizer/team/presets'
import { cemTheta, isTunablePath, pairedObjective, screenTheta, shapedScore, tunableParams, tuneTheta, tuneThetaByFights, validateTheta, type ThetaEvaluator } from '../src/optimizer/tune'
import type { FightSpec, FightSummary } from '../src/optimizer/types'

const THETA0 = loadTheta()
/** Optimum synthétique : trois paramètres utiles (×2,5, ×0,4, ×1,8 de θ₀). */
const TARGET: Record<string, number> = {
  'value.incoming': 0.8 * 2.5,
  'value.control': 0.15 * 0.4,
  'team.commit': 0.1 * 1.8,
}
const USELESS = ['value.potAfter', 'value.erosion', 'team.coherenceBonus']

/** Bruit déterministe dans [−0,5, 0,5). */
const noise = (a: number, b: number) => (mix32(a, b) >>> 0) / 4294967296 - 0.5

let calls = 0
const synthetic: ThetaEvaluator = async (thetas, seeds) => {
  calls++
  return thetas.map(t => {
    const flat = flattenTheta(t)
    let loss = 0
    for (const [k, v] of Object.entries(TARGET)) loss += (Math.log(flat[k]) - Math.log(v)) ** 2
    const own = Math.round(loss * 1e6)
    // Monstres jamais modifiés par la boucle externe.
    expect(t.monster).toEqual(THETA0.monster)
    return seeds.map(s => 1 - 0.3 * loss + 0.3 * noise(s, 1) + 0.02 * noise(s, own))
  })
}

function distance(t: ThetaJson): number {
  const flat = flattenTheta(t)
  return Object.entries(TARGET).reduce((a, [k, v]) => a + (Math.log(flat[k]) - Math.log(v)) ** 2, 0)
}

describe('espace de θ', () => {
  it('chemins réglables : jamais les monstres ni les budgets ; bornes log [θ₀/4, 4·θ₀]', () => {
    expect(isTunablePath('monster.wDmg')).toBe(false)
    expect(isTunablePath('tactical.fast.nodes')).toBe(false)
    expect(isTunablePath('planner.beamWidth')).toBe(false)
    expect(isTunablePath('value.incoming')).toBe(true)
    expect(isTunablePath('tactics.prior.mpLock')).toBe(true)
    expect(() => tunableParams(THETA0, ['monster.kappa'])).toThrow()
    const all = tunableParams(THETA0)
    expect(all.length).toBeGreaterThan(40)
    expect(all.some(p => p.path.startsWith('monster.'))).toBe(false)
    const inc = all.find(p => p.path === 'value.incoming')!
    expect(inc).toMatchObject({ base: 0.8, min: 0.2, max: 3.2, log: true })
  })
})

describe('boucle L2 sur objectif synthétique', () => {
  it('criblage : les 3 paramètres utiles sont les plus sensibles', async () => {
    const params = tunableParams(THETA0, [...Object.keys(TARGET), ...USELESS])
    const r = await screenTheta(THETA0, params, synthetic, { seeds: 32 })
    expect(new Set(r.entries.slice(0, 3).map(e => e.path))).toEqual(new Set(Object.keys(TARGET)))
    for (const e of r.entries.slice(3)) expect(e.sensitivity).toBeLessThan(r.entries[2].sensitivity)
  })

  it('CEM : la moyenne converge vers l’optimum et l’objectif s’améliore', async () => {
    const params = tunableParams(THETA0, [...Object.keys(TARGET), ...USELESS])
    const r = await cemTheta(THETA0, params, synthetic, { generations: 12, population: 12, elite: 3, seedsPerGeneration: 16 })
    expect(distance(r.theta)).toBeLessThan(0.25 * distance(THETA0))
    const first = r.history[0].meanObjective
    const last = r.history[r.history.length - 1].meanObjective
    expect(last).toBeGreaterThan(first)
    // Graines renouvelées à chaque génération, valeurs arrondies (4 chiffres significatifs).
    for (const v of Object.values(r.values)) expect(Number(v.toPrecision(4))).toBe(v)
    expect(r.evaluations).toBe(12 * 12 * 16)
    // Déterminisme.
    const r2 = await cemTheta(THETA0, params, synthetic, { generations: 12, population: 12, elite: 3, seedsPerGeneration: 16 })
    expect(r2.values).toEqual(r.values)
  })

  it('pipeline complet : criblage → CEM → validation acceptée, écarts publiés', async () => {
    const r = await tuneTheta(THETA0, synthetic, {
      paths: [...Object.keys(TARGET), ...USELESS],
      keep: 3,
      screen: { seeds: 32 },
      cem: { generations: 10, seedsPerGeneration: 16 },
      validation: { seeds: 64 },
    })
    expect(new Set(r.selected)).toEqual(new Set(Object.keys(TARGET)))
    expect(r.accepted).toBe(true)
    expect(r.validation.paired.diff).toBeGreaterThan(0)
    expect(r.validation.paired.z).toBeGreaterThanOrEqual(2)
    expect(Object.keys(r.changes).sort()).toEqual(Object.keys(TARGET).sort())
    expect(distance(r.theta)).toBeLessThan(distance(THETA0))
  })

  it('validation : un θ identique (aucun gain) est rejeté', async () => {
    const v = await validateTheta(THETA0, loadTheta(), synthetic, { seeds: 32 })
    expect(v.accepted).toBe(false)
    expect(v.paired.diff).toBe(0)
  })
})

describe('boucle L2 sur combats réels', () => {
  it('combat de contrôle scripted (θ inutilisé) : chaîne complète, θ₀ conservé', async () => {
    const DATA = loadDataStore('data')
    const team = parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA)
    const base: FightSpec = { scenarioId: 'control:143393281:3834,3838', team, mode: 'scripted', theta: THETA0, variantPolicy: 'default', monsterNoise: 0 }
    const r = await tuneThetaByFights(base, createLocalPool(DATA), {
      paths: ['value.incoming', 'value.control'],
      screen: false,
      cem: { generations: 2, population: 3, elite: 1, seedsPerGeneration: 3 },
      validation: { seeds: 6 },
    })
    expect(r.accepted).toBe(false)
    expect(r.theta).toEqual(THETA0)
    expect(r.evaluations).toBe(2 * 3 * 3 + 2 * 6)
  }, 300_000)

  it('objectif façonné et comparaison appariée', () => {
    const mk = (seed: number, win: boolean, score: number, rounds: number): FightSummary => ({
      seed, variant: 'default', win, rounds, endReason: '', deaths: 0, hpLeftPct: 0, damageTaken: 0, progress: 0, score,
      corruptedByRound: [], hoursUsed: 0, creativeActions: 0, tactics: {}, spellUse: {}, unknownEffects: 0, nodes: 0, eventsHash: 0,
    })
    expect(shapedScore(mk(1, false, 0, 40))).toBeCloseTo(0.02, 12)
    expect(shapedScore(mk(1, false, 0, 10))).toBeCloseTo(0.005, 12)
    expect(shapedScore(mk(1, true, 1.05, 10))).toBe(1.05)
    // Micro-scénario : score = P(victoire) ≈ 0, la progression compte.
    expect(shapedScore({ ...mk(1, false, 0, 40), progress: 0.5 })).toBeCloseTo(0.42, 12)
    // Le départage de survie ne dépasse jamais une victoire.
    expect(shapedScore(mk(1, false, 0.8, 60))).toBeLessThan(shapedScore(mk(1, true, 1 - 60 / 600, 60)))
    const a = [mk(1, false, 0.1, 5), mk(2, false, 0.2, 5), mk(3, true, 1.0, 5)]
    const b = [mk(3, true, 1.1, 5), mk(1, false, 0.2, 5), mk(2, false, 0.3, 5)]
    const p = pairedObjective(a, b)
    expect(p.n).toBe(3)
    expect(p.diff).toBeCloseTo(0.1, 12)
  })
})

void calls
