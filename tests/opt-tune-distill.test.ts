/**
 * WP4b — distillation `fast` ← `standard` (docs/design/ai.md §15.3) : à partir de décisions journalisées (termes bruts
 * de V(s) de chaque candidat + choix de l'IA lente), la CEM sur la perte logistique par paires retrouve un jeu de poids
 * qui reproduit les choix. Journal SYNTHÉTIQUE (l'IA lente WP2 n'est pas encore livrée) : « professeur » linéaire aux
 * poids connus, 3 % de choix bruités.
 */
import { describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai/theta'
import type { EvalBreakdown } from '../src/ai/types'
import { Rng } from '../src/core/rng'
import { agreement, breakdownFeatures, defaultTemperature, DISTILL_TERMS, distillWeights, rankingLoss, TERM_TO_THETA, weightsToTheta, type DecisionRecord } from '../src/optimizer/distill'

const N = DISTILL_TERMS.length

function makeRecords(teacher: number[], count: number, seed: number): DecisionRecord[] {
  const rng = new Rng(seed)
  const out: DecisionRecord[] = []
  for (let k = 0; k < count; k++) {
    const n = 4 + rng.int(0, 6)
    const candidates = Array.from({ length: n }, () => Array.from({ length: N }, () => (rng.next() - 0.5) * 1000))
    let chosen = 0
    let best = -Infinity
    candidates.forEach((c, i) => {
      const s = c.reduce((a, x, j) => a + x * teacher[j], 0)
      if (s > best) {
        best = s
        chosen = i
      }
    })
    if (rng.chance(0.03)) chosen = rng.int(0, n - 1)
    out.push({ candidates, chosen })
  }
  return out
}

describe('distillation', () => {
  const teacher = DISTILL_TERMS.map((_, i) => [1, 0.3, 1, 0.5, 1, 1.6, 0.9, 0.6, 0.35, 0.8, 0.08, 0.2, 1][i])
  const init = DISTILL_TERMS.map((_, i) => [1, 0.3, 1, 0.5, 1, 0.4, 0.9, 0.05, 1.2, 0.2, 0.08, 0.2, 1][i])

  it('la CEM améliore la perte et l’accord top-1 (≥ 90 % sur des décisions de test)', () => {
    const train = makeRecords(teacher, 300, 1)
    const test = makeRecords(teacher, 300, 2)
    const r = distillWeights(train, init, { generations: 40, rngSeed: 3 })
    expect(r.loss).toBeLessThan(r.initialLoss)
    expect(r.agreement).toBeGreaterThan(r.initialAgreement)
    expect(agreement(test, r.weights)).toBeGreaterThanOrEqual(0.9)
    expect(agreement(test, r.weights)).toBeGreaterThan(agreement(test, init) + 0.1)
    // Les poids restent positifs et la perte est déterministe.
    for (const w of r.weights) expect(w).toBeGreaterThan(0)
    expect(distillWeights(train, init, { generations: 40, rngSeed: 3 }).weights).toEqual(r.weights)
    expect(rankingLoss(train, r.weights, defaultTemperature(train, init))).toBeCloseTo(r.loss, 6)
    // CEM seule : moins précise mais améliore déjà l'accord.
    const cem = distillWeights(train, init, { method: 'cem', generations: 40, rngSeed: 3 })
    expect(cem.agreement).toBeGreaterThan(cem.initialAgreement)
  })

  it('poids figés et termes sans poids (0) restent inchangés', () => {
    const train = makeRecords(teacher, 100, 5)
    const zeroed = init.slice()
    zeroed[2] = 0
    const r = distillWeights(train, zeroed, { generations: 10, frozen: [0] })
    expect(r.weights[2]).toBe(0)
    expect(r.weights[0]).toBe(init[0])
  })

  it('caractéristiques d’une décomposition et report sur θ', () => {
    const b: EvalBreakdown = { total: 0, enemyLife: -100, kills: 50, allyLife: 4000, erosion: -5, allyDeath: 0, incoming: -800, pendingDot: -10, control: 15, potential: 35, continuation: 80, resources: -2, position: 10, scenario: 0 }
    const f = breakdownFeatures(b, { incoming: 0.8, control: 0.15 })
    expect(f[DISTILL_TERMS.indexOf('incoming')]).toBeCloseTo(-1000, 9)
    expect(f[DISTILL_TERMS.indexOf('control')]).toBeCloseTo(100, 9)
    const theta = loadTheta()
    const learned = init.slice()
    learned[DISTILL_TERMS.indexOf('incoming')] = init[DISTILL_TERMS.indexOf('incoming')] * 2
    const t2 = weightsToTheta(theta, init, learned)
    expect(t2.value.incoming).toBeCloseTo(theta.value.incoming * 2, 6)
    expect(t2.value.control).toBe(theta.value.control)
    expect(t2.monster).toEqual(theta.monster)
    for (const path of Object.values(TERM_TO_THETA)) expect(path!.startsWith('value.')).toBe(true)
  })
})
