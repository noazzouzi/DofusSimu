/**
 * WP4b — successive halving et campagne de composition (docs/design/ai.md §15.6) sur combats réels : combat de
 * contrôle à 6 monstres de vague du Vortex (grade 5, vraie salle), politique `scripted`, CRN, 4 workers.
 *
 * Les équipes « sans stuff » (mêmes presets, aucun objet) doivent être éliminées dès le premier étage ; la
 * campagne réduite (candidats imposés → halving → co-optimisation stuff + variantes → validation) doit produire une
 * équipe validée et un journal lisible.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { createNodePool } from '../src/optimizer/pool/node'
import { candidateFromPresets, enforceDiversity, runCompositionCampaign, successiveHalving, teamId, type TeamCandidate } from '../src/optimizer/team/halving'
import { parseTeam, resolvePreset } from '../src/optimizer/team/presets'
import { archetypeKey, archetypeOf } from '../src/optimizer/team/prior'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const CONTROL = 'control:143393281:3834,3836,3837,3838,3839,3834'
const base: Omit<FightSpec, 'team'> = { scenarioId: CONTROL, mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
const pool = createNodePool(4)
afterAll(() => pool.close())

function candidate(spec: string, stuff?: 'unstuffed'): TeamCandidate {
  const team = parseTeam(spec, DATA, { stuff })
  const presets = team.map(m => resolvePreset(m.presetId))
  return { id: `${teamId(team)}${stuff ? '@nu' : ''}`, team, archetype: archetypeKey(archetypeOf(presets)) }
}

describe('successive halving', () => {
  it('diversité : au moins une équipe par archétype parmi les gardées', () => {
    const entries = [
      { archetype: 'soin/sans-placeur', rank: 1 },
      { archetype: 'soin/sans-placeur', rank: 2 },
      { archetype: 'soin/sans-placeur', rank: 3 },
      { archetype: 'sans-soin/placeur', rank: 4 },
      { archetype: 'sans-soin/sans-placeur', rank: 5 },
    ]
    const kept = enforceDiversity([0, 1, 2, 3, 4], [0, 1, 2], entries)
    expect(kept.map(i => entries[i].archetype).sort()).toEqual(['sans-soin/placeur', 'sans-soin/sans-placeur', 'soin/sans-placeur'])
    expect(kept).toContain(0)
  })

  it('élimine les équipes sans stuff, classe sur graines communes', async () => {
    const cands = [
      candidate('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer'),
      candidate('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', 'unstuffed'),
      candidate('iop:killer,cra:feu,pandawa:placer,eniripsa:healer'),
      candidate('sacrieur:tank,cra:feu,xelor:zoneDps,sadida:healer'),
      candidate('sacrieur:tank,cra:feu,xelor:zoneDps,sadida:healer', 'unstuffed'),
    ]
    const r = await successiveHalving(base, cands, pool, {
      stages: [
        { name: 'T1', kinds: ['full'], seeds: 8, keep: 3, diversity: true },
        { name: 'T2', kinds: ['full'], seeds: 12, keep: 1 },
      ],
    })
    expect(r.fights).toBe(5 * 8 + 3 * 12)
    const t1 = r.stages[0].entries
    expect(t1.filter(e => e.kept).length).toBe(3)
    for (const e of t1.filter(x => x.id.endsWith('@nu'))) expect(e.kept).toBe(false)
    expect(new Set(t1.map(e => e.rank))).toEqual(new Set([1, 2, 3, 4, 5]))
    for (const e of t1) {
      expect(e.wilson95[0]).toBeLessThanOrEqual(e.winRate)
      expect(e.wilson95[1]).toBeGreaterThanOrEqual(e.winRate)
    }
    expect(r.winners.length).toBe(1)
    expect(r.winners[0].id.endsWith('@nu')).toBe(false)
    const best = r.stages[1].entries.find(e => e.kept)!
    for (const e of r.stages[1].entries) expect(best.key).toBeGreaterThanOrEqual(e.key)
  }, 600_000)

  it('campagne depuis T0 : T0 calibré sur de vrais combats (EQM non dégradée), classement recalculé, journal', async () => {
    const subset = ['cra_feu_zone', 'enutrof_retrait_pm_eau', 'iop_terre_burst', 'eniripsa_soin_feu', 'pandawa_placement', 'sacrieur_tank'].map(resolvePreset)
    const lines: string[] = []
    const r = await runCompositionCampaign(DATA, base, pool, {
      t0: { presets: subset, top: 6 },
      calibrate: { teams: 3, seeds: 3 },
      halving: { stages: [{ name: 'T1', kinds: ['full'], seeds: 2, keep: 1 }] },
      finalists: 1,
      coopt: false,
      validation: { seeds: 2 },
      onLog: l => lines.push(l),
    })
    const cal = r.t0!.calibration!
    expect(cal.observations.length).toBe(3)
    expect(cal.fights).toBe(9)
    const mse = (k: 'predictedBefore' | 'predictedAfter') => cal.observations.reduce((a, o) => a + (o[k] - o.observed) ** 2, 0) / cal.observations.length
    expect(mse('predictedAfter')).toBeLessThanOrEqual(mse('predictedBefore') + 1e-12)
    expect(cal.mse).toBeCloseTo(mse('predictedAfter'), 12)
    for (const o of cal.observations) {
      expect(o.observed).toBeGreaterThanOrEqual(0)
      expect(o.observed).toBeLessThanOrEqual(1.1)
    }
    expect(r.t0!.params).toEqual(cal.params)
    expect(r.t0!.top.length).toBe(6)
    expect(r.halving.stages[0].entries.length).toBe(6)
    expect(lines.some(l => l.startsWith('T0 calibré'))).toBe(true)
    expect(r.best.validation.summaries.length).toBe(2)
  }, 600_000)

  it('campagne réduite : halving → co-optimisation (stuff validé par combats, variantes) → validation', async () => {
    const cands = [
      candidateFromPresets(DATA, ['iop_terre_burst', 'cra_feu_zone', 'enutrof_retrait_pm_eau', 'eniripsa_soin_feu'].map(resolvePreset)),
      candidateFromPresets(DATA, ['iop_terre_burst', 'cra_feu_zone', 'pandawa_placement', 'eniripsa_soin_feu'].map(resolvePreset)),
    ]
    const lines: string[] = []
    const r = await runCompositionCampaign(DATA, base, pool, {
      candidates: cands,
      halving: { stages: [{ name: 'T1', kinds: ['full'], seeds: 6, keep: 1 }] },
      finalists: 1,
      coopt: {
        stuff: { iterations: 40, perSlot: 8, dofusPool: 8, topExact: 6, diversity: 2, points: false },
        stuffValidation: { seeds: 4 },
        variants: { seeds: 4, usageSeeds: 0, maxCandidates: 1, members: [0] },
        theta: false,
        secondPass: false,
      },
      validation: { seeds: 6 },
      onLog: l => lines.push(l),
    })
    expect(r.finalists.length).toBe(1)
    expect(r.best.validation.summaries.length).toBe(6)
    expect(Number.isFinite(r.best.validation.objective)).toBe(true)
    const coopt = r.finalists[0].coopt!
    expect(coopt.stuff[0].length).toBe(4)
    for (const s of coopt.stuff[0]) {
      expect(s.result.best.score.logJ).toBeGreaterThanOrEqual(s.result.start.score.logJ)
      expect(s.validation!.builds.length).toBeGreaterThanOrEqual(2)
    }
    expect(lines.some(l => l.startsWith('T1'))).toBe(true)
    expect(lines.some(l => l.includes('L3'))).toBe(true)
    expect(lines.some(l => l.startsWith('Validation'))).toBe(true)
    expect(r.log).toEqual(lines)
  }, 600_000)
})
