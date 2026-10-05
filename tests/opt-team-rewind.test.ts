/**
 * WP4b — rembobinage stratégique (niveau L*, docs/design/ai.md §15.8) sur combats réels : combat de contrôle à 6
 * monstres de vague du Vortex, politique `scripted`, dés re-semés par tour (E1).
 *
 * Exigences : le combat instrumenté (points de contrôle) est identique au combat du runner ; une reprise « à
 * l'identique » depuis un point de contrôle redonne exactement le même combat (déterminisme) ; sur des combats perdus,
 * une ligne gagnante « mêmes dés » est trouvée par une alternative ; le résultat est toujours marqué optimiste ; la
 * sortie « robuste » compare les alternatives sur des dés différents ; le replay de la ligne est valide.
 */
import { describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { loadDataStore } from '../src/data/node'
import { alternativeLabel, failureRound, jitterTheta, rewindFight } from '../src/optimizer/rewind'
import { runOne } from '../src/optimizer/runner'
import { campaignSeeds } from '../src/optimizer/seeds'
import { parseTeam } from '../src/optimizer/team/presets'
import type { FightSpec } from '../src/optimizer/types'

const DATA = loadDataStore('data')
const spec: FightSpec = {
  scenarioId: 'control:143393281:3834,3836,3837,3838,3839,3834',
  team: parseTeam('iop:killer,cra:feu,enutrof:mpLock,eniripsa:healer', DATA),
  mode: 'scripted',
  theta: loadTheta(),
  variantPolicy: 'default',
  monsterNoise: 0,
}

describe('rembobinage', () => {
  it('combats perdus : ligne gagnante « mêmes dés », déterminisme, sortie robuste, replay', () => {
    const seeds = campaignSeeds(11, 2)
    let found = 0
    for (const [k, seed] of seeds.entries()) {
      const ref = runOne(DATA, spec, seed).summary
      const r = rewindFight(DATA, spec, seed, { modes: ['fast', 'standard'], jitters: 1, robustSeeds: 2, maxResumes: 12, record: k === 0 })
      expect(r.optimistic).toBe(true)
      expect(r.original.eventsHash).toBe(ref.eventsHash)
      expect(r.original.score).toBe(ref.score)
      expect(r.deterministic).toBe(true)
      expect(r.checkpoints[0]).toBe(1)
      expect(r.attempts.length).toBeLessThanOrEqual(12)
      if (ref.win) continue
      expect(r.failRound).toBeGreaterThanOrEqual(1)
      expect(r.failRound).toBeLessThanOrEqual(ref.rounds)
      for (const a of r.attempts) expect(a.from).toBeLessThanOrEqual(r.failRound)
      if (r.winningLine) {
        found++
        expect(r.winningLine.summary.win).toBe(true)
        expect(r.winningLine.label).toBe(alternativeLabel(r.winningLine.alternative))
        if (k === 0) {
          const ev = r.winningLine.replay!.events
          expect(ev[0].t).toBe('fightStart')
          expect(ev.some(e => e.t === 'fightEnd')).toBe(true)
          expect(r.winningLine.replay!.meta?.description).toContain('optimiste')
        }
      }
      expect(r.robust).toBeDefined()
      expect(r.robust!.seeds).toBe(2)
      expect(r.robust!.results.length).toBeGreaterThanOrEqual(2)
      for (const x of r.robust!.results) {
        expect(x.winRate).toBeGreaterThanOrEqual(0)
        expect(x.winRate).toBeLessThanOrEqual(1)
      }
    }
    expect(found).toBeGreaterThanOrEqual(1)
  }, 600_000)

  it('outils : θ perturbé ±20 % (jamais les monstres), round d’échec', () => {
    const t = jitterTheta(spec.theta, 1)
    expect(t.monster).toEqual(spec.theta.monster)
    expect(t.tactical).toEqual(spec.theta.tactical)
    const r = t.value.incoming / spec.theta.value.incoming
    expect(r).toBeGreaterThanOrEqual(0.8 - 1e-9)
    expect(r).toBeLessThanOrEqual(1.2 + 1e-9)
    expect(jitterTheta(spec.theta, 1)).toEqual(t)
    expect(jitterTheta(spec.theta, 2)).not.toEqual(t)
    const run = runOne(DATA, spec, 5)
    const fr = failureRound(run.fight, 0)
    expect(fr).toBeGreaterThanOrEqual(1)
    expect(fr).toBeLessThanOrEqual(run.fight.round)
  })
})
