/**
 * Valeur d'un kill hors simulation (tuning-log, tour 1) : le préfiltre `quick` et le terme `continuation` lisent le prix
 * du scénario (`deathValue` sur l'état courant) au lieu de la valeur générique κ·PVmax + τ·menace. Sans ce prix, un sort
 * qui achève un monstre réservé (prix négatif) était classé en tête du préfiltre et, en `fast`, seuls des candidats
 * « mauvais kill » étaient simulés.
 */
import { describe, expect, it } from 'vitest'
import { createPerception, createView, generateCasts } from '../src/ai/core'
import { killValueNow } from '../src/ai/core/kill'
import { emptyBlackboard } from '../src/ai/team/blackboard'
import type { ScenarioAIModel } from '../src/dungeons/types'
import type { Fighter } from '../src/engine/types'
import { BREEDS, engineFor, makeFight, monster, player, VORTEX_MAP } from './ai-core-helpers'

const W = { killKappa: 0.3, killTau: 1 }

describe('killValueNow', () => {
  it('prix du scénario s’il existe, sinon κ·PVmax + τ·menace', () => {
    const e = { id: 7, maxHp: 6000 } as Fighter
    const s = {} as never
    expect(killValueNow(s, e, W, () => 1000)).toBeCloseTo(0.3 * 6000 + 1000)
    const scenario = { deathValue: () => -2500 }
    expect(killValueNow(s, e, W, () => 1000, scenario, emptyBlackboard())).toBe(-2500)
    // Sans tableau noir, le prix du scénario n'est pas lisible : valeur générique.
    expect(killValueNow(s, e, W, () => 1000, scenario, undefined)).toBeCloseTo(2800)
    // Scénario qui ne prix pas ce monstre (undefined) : valeur générique.
    expect(killValueNow(s, e, W, () => 1000, { deathValue: () => undefined }, emptyBlackboard())).toBeCloseTo(2800)
  })

  it('quick : un sort qui achève un monstre au prix de mort négatif est classé sous un coup sur un autre monstre', () => {
    const engine = engineFor()
    const iop = player(BREEDS.iop, { cell: 341 })
    const weak = monster(3834, 327) // Ikargn adjacent, presque mort (réservé à une corruption)
    const other = monster(3837, 355) // Harpille adjacente, pleine vie
    const fight = makeFight(engine, VORTEX_MAP, [iop, weak, other])
    const w = fight.fighters.find(f => f.monsterId === 3834)!
    w.hp = 60
    const me = fight.fighters.find(f => f.kind === 'player')!
    const view = createView(engine, fight, me, 1)
    const bb = emptyBlackboard()
    const priced: ScenarioAIModel = {
      id: 'test',
      update() {},
      damageWeight: () => 0.8,
      deathValue: (_r, _l, victim) => (victim.id === w.id ? -3000 : 2000),
    }
    const best = (scenario?: ScenarioAIModel): { hitsWeak: boolean; prior: number } => {
      const p = createPerception(view, undefined, scenario, { bb })
      p.sync(fight)
      const cands = generateCasts(view, fight, me, { perception: p, scenario, bb } as never)
      cands.sort((a, b) => b.prior - a.prior)
      const top = cands[0]
      return { hitsWeak: top.cast?.cell === w.cell, prior: top.prior }
    }
    // Valeur générique : achever l'Ikargn (≈ +2 000 PVe de kill) passe en tête.
    expect(best(undefined).hitsWeak).toBe(true)
    // Prix du scénario (mort interdite à cette heure) : le meilleur candidat ne vise plus l'Ikargn.
    expect(best(priced).hitsWeak).toBe(false)
  })
})
