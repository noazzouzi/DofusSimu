/**
 * T-kill (docs/design/ai.md §16.1, §6.7) : probabilité de kill analytique (`canKillNow`, Φ de l'approximation
 * normale) et split léthal (`lethalSplit`, jets 'min'/'max' + mélange critique) contre 10⁴ tirages `random` du moteur.
 * Critères : ≤ 3 points (analytique, tour complet) et ≤ 7 points (split, un lancer).
 */
import { describe, expect, it } from 'vitest'
import { canKillNow, createPerception, createView, killProbability, lethalSplit, lifeToKill, placeForCast, simClone } from '../src/ai/core'
import { castSpell } from '../src/engine/cast'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'
import type { MacroAction } from '../src/ai/types'
import { BREEDS, engineFor, makeFight, monster, player, THL, VORTEX_MAP, yieldToEventLoop } from './ai-core-helpers'

const DRAWS = 10_000

/** Combat 1 contre 1 : `breedId` (THL) au contact d'un Buboxor dont les PV valent `hp`, au tour du personnage. */
function duel(engine: Engine, breedId: number, hp: number): { fight: FightState; me: Fighter; t: Fighter } {
  const me0 = player(breedId, { cell: 286, extra: THL })
  const t0 = monster(3838, 300)
  const fight = makeFight(engine, VORTEX_MAP, [me0, t0], { rollMode: 'average' })
  const me = fight.fighters[0]
  const t = fight.fighters[1]
  t.hp = hp
  let f = engine.nextTurn(fight)!
  while (f.id !== me.id) {
    engine.endTurn(fight, f)
    f = engine.nextTurn(fight)!
  }
  return { fight, me, t }
}

/**
 * Fraction de tirages `random` (graines 1..n) où `play` tue la cible. Asynchrone : rend la main à la boucle
 * d'événements tous les 1 000 tirages (un test synchrone de plus de 60 s fait expirer le RPC du worker vitest).
 */
async function empirical(engine: Engine, fight: FightState, targetId: number, play: (c: FightState) => void, n = DRAWS): Promise<number> {
  let kills = 0
  for (let i = 1; i <= n; i++) {
    if (i % 1000 === 0) await yieldToEventLoop()
    const c = engine.cloneFight(fight, false)
    c.options.rollMode = 'random'
    c.rngState = (i * 2654435761) | 0
    play(c)
    if (!c.fighters[targetId].alive) kills++
  }
  return kills / n
}

/**
 * Placements des lancers d'un plan (case du lanceur, case visée), calculés une fois sur un clone `average` : les
 * tirages `random` jouent les mêmes lancers depuis les mêmes cases (aucun sort du plan ne déplace la cible).
 */
function placements(engine: Engine, fight: FightState, meId: number, targetId: number, spells: readonly number[]): { spellId: number; from: number; cell: number }[] {
  const c = engine.cloneFight(fight, false)
  const m = c.fighters[meId]
  const out: { spellId: number; from: number; cell: number }[] = []
  for (const spellId of spells) {
    const cell = placeForCast(engine, c, m, spellId, c.fighters[targetId].cell)
    if (cell < 0) continue
    out.push({ spellId, from: m.cell, cell })
    castSpell(engine, c, m, spellId, cell)
  }
  return out
}

describe('T-kill : probabilité de kill analytique (tour complet)', () => {
  it('Iop et Enutrof, PV autour des dégâts attendus : |p analytique − p empirique| ≤ 3 points', async () => {
    const engine = engineFor()
    let checked = 0
    for (const breedId of [BREEDS.iop, BREEDS.enutrof]) {
      // PV calés sur les dégâts attendus du tour : quantiles bas, médian et haut.
      const probe = duel(engine, breedId, 1_000_000)
      const view0 = createView(engine, probe.fight, probe.me, 1)
      const ref = canKillNow(view0, probe.me, probe.t, createPerception(view0))
      expect(ref.spells.length).toBeGreaterThan(0)
      const p0 = createPerception(view0)
      const mean = p0.dpt.turn(probe.me, probe.t, probe.me.ap, 'now').mean
      for (const frac of [0.85, 1, 1.12]) {
        const hp = Math.round(mean * frac)
        const { fight, me, t } = duel(engine, breedId, hp)
        const view = createView(engine, fight, me, 1)
        const k = canKillNow(view, me, t, createPerception(view))
        const plan = placements(engine, fight, me.id, t.id, k.spells)
        expect(plan.length).toBe(k.spells.length)
        const pEmp = await empirical(engine, fight, t.id, c => {
          const m = c.fighters[me.id]
          for (const x of plan) {
            if (!m.alive || !c.fighters[t.id].alive) break
            m.cell = x.from
            castSpell(engine, c, m, x.spellId, x.cell)
          }
        })
        console.log(`T-kill ${me.name} PV ${hp} (${frac} × espérance) : analytique ${k.p.toFixed(3)}, empirique ${pEmp.toFixed(3)} (${k.spells.join('+')})`)
        expect(Math.abs(k.p - pEmp)).toBeLessThanOrEqual(0.03)
        checked++
      }
    }
    expect(checked).toBe(6)
  }, 120_000)

  it('killProbability : bornes et monotonie', () => {
    expect(killProbability(100, 0, 100)).toBe(1)
    expect(killProbability(99, 0, 100)).toBe(0)
    expect(killProbability(0, 0, 0)).toBe(1)
    expect(killProbability(100, 400, 100)).toBeCloseTo(0.5, 6)
    expect(killProbability(120, 400, 100)).toBeGreaterThan(killProbability(110, 400, 100))
    expect(killProbability(120, 400, 100)).toBeCloseTo(0.84134, 4)
    expect(killProbability(140, 400, 100)).toBeCloseTo(0.97725, 4)
  })
})

describe('T-kill : split léthal (un lancer, jets min/max + critique)', () => {
  it('lancers isolés près du seuil : |p split − p empirique| ≤ 7 points', async () => {
    const engine = engineFor()
    let checked = 0
    for (const [breedId, spellId] of [[BREEDS.iop, 13125], [BREEDS.enutrof, 13333], [BREEDS.cra, 32429]] as const) {
      const probe = duel(engine, breedId, 1_000_000)
      const view0 = createView(engine, probe.fight, probe.me, 1)
      const p0 = createPerception(view0)
      const si = probe.me.spells.findIndex(s => s.spellId === spellId)
      expect(si).toBeGreaterThanOrEqual(0)
      const mean = p0.dpt.perCast(probe.me, si, probe.t).mean
      for (const frac of [0.9, 1, 1.1]) {
        const hp = Math.round(mean * frac)
        const { fight, me, t } = duel(engine, breedId, hp)
        const cell = placeForCast(engine, fight, me, spellId, t.cell)
        expect(cell).toBeGreaterThanOrEqual(0)
        const view = createView(engine, fight, me, 1)
        const macro: MacroAction = { cast: { spellId, cell }, cat: 'damage', prior: 0, key: `${spellId}:${cell}:${me.cell}` }
        const split = lethalSplit(view, fight, me.id, macro, t.id, 7)!
        expect(split).not.toBeNull()
        expect(split.nodes).toBeGreaterThanOrEqual(2)
        const pEmp = await empirical(engine, fight, t.id, c => {
          castSpell(engine, c, c.fighters[me.id], spellId, cell)
        })
        console.log(`T-kill split ${me.name} ${spellId} PV ${hp} : split ${split.p.toFixed(3)}, empirique ${pEmp.toFixed(3)}`)
        expect(Math.abs(split.p - pEmp)).toBeLessThanOrEqual(0.07)
        // États retenus : tué ⇔ p > 0, survivant ⇔ p < 1.
        if (split.p > 0) expect(split.killed && !split.killed.fighters[t.id].alive).toBe(true)
        if (split.p < 1) expect(split.survived && split.survived.fighters[t.id].alive).toBe(true)
        // États prolongeables par la recherche : jets moyens.
        for (const st of [split.killed, split.survived]) if (st) expect(st.options.rollMode).toBe('average')
        checked++
      }
    }
    expect(checked).toBe(9)
  }, 120_000)

  it('la réflexion ne touche pas aux dés du vrai combat', () => {
    const engine = engineFor()
    const { fight, me, t } = duel(engine, BREEDS.iop, 3000)
    const rng = fight.rngState
    const view = createView(engine, fight, me, 1)
    canKillNow(view, me, t, createPerception(view))
    lethalSplit(view, fight, me.id, { cast: { spellId: 13125, cell: t.cell }, cat: 'damage', prior: 0, key: 'x' }, t.id, 3)
    simClone(view, fight, 5)
    expect(fight.rngState).toBe(rng)
    expect(lifeToKill(t)).toBe(t.hp + t.shield)
  })
})
