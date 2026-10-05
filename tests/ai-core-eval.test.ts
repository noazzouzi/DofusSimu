/**
 * T-eval (docs/design/ai.md §16.1, §7) : fonction de valeur V(s) sur de vraies scènes.
 *  - monotonie : dégâts infligés aux ennemis ↑ ⇒ V ↑ ; dégâts subis par les alliés ↑ ⇒ V ↓ ;
 *  - invariance par permutation des ids (ordre de création des monstres) ;
 *  - les caches n'influencent aucune décision : même V et mêmes candidats (priors compris) sur un moteur neuf et sur un
 *    moteur qui a déjà évalué d'autres combats (cartes, classes et ids différents) ;
 *  - décomposition : `total` = somme des termes ; continuation seulement sur les feuilles non terminales.
 */
import { describe, expect, it } from 'vitest'
import { applyMacro, createPerception, createView, generateCasts, simClone, valueOf } from '../src/ai/core'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'
import { BREEDS, engineFor, makeFight, MAP_IDS, monster, player, randomScene, THL, VORTEX_MONSTERS, yieldToEventLoop } from './ai-core-helpers'

function V(engine: Engine, fight: FightState, me: Fighter, opts: Parameters<typeof valueOf>[3] = {}) {
  const view = createView(engine, fight, me, 3)
  return valueOf(view, fight, createPerception(view), opts)
}

const TERMS = ['enemyLife', 'kills', 'allyLife', 'erosion', 'allyDeath', 'incoming', 'pendingDot', 'control', 'potential',
  'continuation', 'resources', 'position', 'scenario'] as const

describe('T-eval : V(s)', () => {
  it('monotonie sur 60 scènes : −PV ennemis ⇒ V ↑ ; −PV alliés ⇒ V ↓', () => {
    const engine = engineFor()
    let checks = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { fight, me } = randomScene(seed, { engine })
      const v0 = V(engine, fight, me).total
      for (const f of fight.fighters) {
        if (!f.alive) continue
        for (const dmg of [200, 1500]) {
          const c = engine.cloneFight(fight, false)
          const t = c.fighters[f.id]
          t.hp = Math.max(1, t.hp - dmg)
          const v1 = V(engine, c, c.fighters[me.id]).total
          if (f.team === me.team) expect(v1, `allié ${f.name} −${dmg}`).toBeLessThan(v0)
          else expect(v1, `ennemi ${f.name} −${dmg}`).toBeGreaterThan(v0)
          checks++
        }
      }
    }
    expect(checks).toBeGreaterThan(700)
  }, 60_000)

  it('mort d’un ennemi (depuis la racine) : terme kills > 0 ; mort d’un allié : allyDeath < 0', () => {
    const engine = engineFor()
    const { fight, me } = randomScene(5, { engine })
    const enemy = fight.fighters.find(f => f.team !== me.team)!
    const ally = fight.fighters.find(f => f.team === me.team && f.id !== me.id)!
    const c = engine.cloneFight(fight, false)
    engine.kill(c, c.fighters[enemy.id], c.fighters[me.id])
    engine.kill(c, c.fighters[ally.id], c.fighters[enemy.id])
    const b = V(engine, c, c.fighters[me.id], { root: fight })
    expect(b.kills).toBeGreaterThan(0)
    expect(b.allyDeath).toBeLessThan(-ally.baseMaxHp)
  })

  it('invariance par permutation des ids des monstres', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const build = (reverse: boolean) => {
        const engine = engineFor()
        const p = [player(BREEDS.cra, { cell: 300, extra: THL }), player(BREEDS.iop, { cell: 302, extra: THL })]
        const cells = [330, 357, 274, 359]
        const ms = cells.map((c, i) => monster(VORTEX_MONSTERS[(seed + i) % 5], c))
        const fight = makeFight(engine, MAP_IDS[0], [...p, ...(reverse ? ms.reverse() : ms)])
        let f = engine.nextTurn(fight)!
        for (let g = 0; g < 10 && f.kind !== 'player'; g++) {
          engine.endTurn(fight, f)
          f = engine.nextTurn(fight)!
        }
        return { engine, fight, me: f }
      }
      const a = build(false)
      const b = build(true)
      // Initiatives égales départagées par id : on impose à b l'ordre de jeu de a (seuls les ids diffèrent).
      const idOf = (name: string) => b.fight.fighters.find(f => f.name === name)!.id
      b.fight.timeline = a.fight.timeline.map(id => idOf(a.fight.fighters[id].name))
      b.fight.turnIndex = a.fight.turnIndex
      expect(b.fight.fighters[b.fight.timeline[b.fight.turnIndex]].name).toBe(a.me.name)
      const va = V(a.engine, a.fight, a.me)
      const vb = V(b.engine, b.fight, b.fight.fighters.find(f => f.name === a.me.name)!)
      for (const k of TERMS) expect(vb[k], `${k} (graine ${seed})`).toBeCloseTo(va[k], 6)
    }
  })

  it('les caches n’influencent aucune décision (moteur neuf = moteur « chaud »)', () => {
    const warm = engineFor()
    for (let seed = 1; seed <= 30; seed++) {
      const { fight, me } = randomScene(seed, { engine: warm })
      const view = createView(warm, fight, me, 3)
      const p = createPerception(view)
      valueOf(view, fight, p)
      generateCasts(view, fight, me, { perception: p })
    }
    for (const seed of [7, 19, 31, 44]) {
      const cold = randomScene(seed)
      const hot = randomScene(seed, { engine: warm })
      const vc = V(cold.engine, cold.fight, cold.me)
      const vh = V(warm, hot.fight, hot.me)
      for (const k of TERMS) expect(vh[k], `${k} graine ${seed}`).toBe(vc[k])
      const vcCands = generateCasts(createView(cold.engine, cold.fight, cold.me, 3), cold.fight, cold.me, { perception: createPerception(createView(cold.engine, cold.fight, cold.me, 3)) })
      const vhCands = generateCasts(createView(warm, hot.fight, hot.me, 3), hot.fight, hot.me, { perception: createPerception(createView(warm, hot.fight, hot.me, 3)) })
      expect(vhCands.map(m => `${m.key}/${m.prior}`)).toEqual(vcCands.map(m => `${m.key}/${m.prior}`))
    }
  })

  it('les caches n’influencent aucune décision le long d’une recherche (enfants et petits-enfants, ordres différents)', async () => {
    // Perception « chaude » (ordre de la recherche), perception parcourue en ordre inverse, perception neuve par état :
    // mêmes termes (cadres DPT ancrés, géométries de menace/potentiel et lignes « PV » réutilisées).
    const engine = engineFor()
    let checks = 0
    for (const seed of [3, 7, 12, 21, 30, 44]) {
      await yieldToEventLoop()
      const { fight, me } = randomScene(seed, { engine })
      const view = createView(engine, fight, me, 1)
      const p = createPerception(view)
      const states: FightState[] = []
      for (const m of generateCasts(view, fight, me, { perception: p }).slice(0, 30)) {
        const c = simClone(view, fight, 7)
        if (applyMacro(engine, c, me.id, m)) states.push(c)
      }
      for (const k of states.slice(0, 4)) {
        const vk = createView(engine, k, k.fighters[me.id], 1)
        for (const m of generateCasts(vk, k, k.fighters[me.id], { perception: createPerception(vk) }).slice(0, 6)) {
          const c = simClone(view, k, 9)
          if (applyMacro(engine, c, me.id, m)) states.push(c)
        }
      }
      const warm = states.map(st => valueOf(view, st, p, { root: fight, terminal: false }))
      const p2 = createPerception(view)
      const rev = states.slice().reverse().map(st => valueOf(view, st, p2, { root: fight, terminal: false })).reverse()
      states.forEach((st, i) => {
        const cold = valueOf(view, st, createPerception(view), { root: fight, terminal: false })
        for (const k of TERMS) {
          expect(warm[i][k], `${k} graine ${seed} état ${i} (chaud)`).toBeCloseTo(cold[k], 6)
          expect(rev[i][k], `${k} graine ${seed} état ${i} (inverse)`).toBeCloseTo(cold[k], 6)
          checks++
        }
      })
    }
    expect(checks).toBeGreaterThan(2000)
  }, 120_000)

  it('décomposition : total = Σ termes ; continuation seulement hors feuille terminale', () => {
    const engine = engineFor()
    for (const seed of [2, 8, 13]) {
      const { fight, me } = randomScene(seed, { engine })
      const t = V(engine, fight, me)
      const n = V(engine, fight, me, { terminal: false })
      let sum = 0
      for (const k of TERMS) sum += t[k]
      expect(t.total).toBeCloseTo(sum, 6)
      expect(t.continuation).toBe(0)
      expect(n.continuation).toBeGreaterThanOrEqual(0)
      // Feuille terminale : les PA inutilisés coûtent θ.value.unusedAp (2) chacun.
      expect(t.resources).toBeCloseTo(-2 * me.ap, 6)
      expect(n.resources).toBe(0)
    }
  })
})
