/**
 * Socle IA : T-hash, T-parity (docs/design/ai.md §16.1) et briques déterministes (§6.1, §6.8, §13).
 *  - T-hash : A puis B ≡ B puis A quand les lancers sont indépendants ; aucune collision 64 bits sur 10⁶ états
 *    distincts (corpus construit par mutations d'états réels).
 *  - T-parity : `advanceUntil` enchaîne exactement les mêmes tours que `runFight` (20 combats, événements comparés).
 *  - rng : graines (§13.1), exp / Φ / softmax déterministes ; budget en nœuds ; vue honnête (pas de lecture de
 *    `fight.events`, dés du vrai combat intacts, clones re-semés).
 */
import { describe, expect, it } from 'vitest'
import {
  advanceUntil, aiSeed, applyMacro, cloneRngState, createNodeBudget, createPerception, createView, detExp, endCurrentTurn,
  fightAISeed, fighterDigest, forecastSlots, generateCasts, mix32, phi, sanitizeForTeam, simClone, simSalt, softmaxInto,
  stateHash, valueOf,
} from '../src/ai/core'
import { playGreedyTurn } from '../src/ai/fallback'
import { runFight, type ControllerProvider } from '../src/engine/runner'
import type { FightEvent, FightState } from '../src/engine/types'
import { engineFor, randomScene, yieldToEventLoop } from './ai-core-helpers'

describe('T-hash : transpositions', () => {
  it('A puis B ≡ B puis A pour des lancers indépendants (cibles différentes, sans déplacement ni état)', () => {
    const engine = engineFor()
    let pairs = 0
    for (let seed = 1; seed <= 40 && pairs < 60; seed++) {
      const { fight, me } = randomScene(seed, { engine })
      const view = createView(engine, fight, me, 5)
      const p = createPerception(view)
      const cands = generateCasts(view, fight, me, { perception: p }).filter(m => !m.path)
      for (let i = 0; i < cands.length && pairs < 60; i++) {
        for (let j = i + 1; j < cands.length && pairs < 60; j++) {
          const A = cands[i]
          const B = cands[j]
          if (A.cast!.cell === B.cast!.cell || A.cast!.spellId === B.cast!.spellId) continue
          const prof = (id: number) => p.profiles.ofFighter(me)[me.spells.findIndex(s => s.spellId === id)]
          const pa = prof(A.cast!.spellId)
          const pb = prof(B.cast!.spellId)
          const pure = (x: typeof pa) => x.zoneRadius === 0 && !x.moves.length && !x.states.length && !x.stats.length && !x.removals.length
            && !x.hasTriggers && !x.received.length && !x.summons.length && !x.glyph && !x.trap && !x.heals.length && !x.shields.length
          if (!pure(pa) || !pure(pb)) continue
          const ab = simClone(view, fight, 1)
          const ba = simClone(view, fight, 1)
          if (!applyMacro(engine, ab, me.id, A) || !applyMacro(engine, ab, me.id, B)) continue
          if (!applyMacro(engine, ba, me.id, B) || !applyMacro(engine, ba, me.id, A)) continue
          expect(stateHash(ab)).toBe(stateHash(ba))
          pairs++
        }
      }
    }
    expect(pairs).toBeGreaterThan(20)
  })

  it('états différents ⇒ hash différent : aucune collision sur 10⁶ états distincts', () => {
    const engine = engineFor()
    const bases: FightState[] = []
    for (let seed = 1; seed <= 4; seed++) bases.push(randomScene(seed, { engine }).fight)
    const N = 1_000_000
    const hashes = new BigInt64Array(N)
    let k = 0
    // Mutations disjointes (base, combattant, PV, PA, PM, case) : chaque état est unique par construction.
    outer: for (const base of bases) {
      const s = engine.cloneFight(base, false)
      const n = s.fighters.length
      for (let id = 0; id < n; id++) {
        const f = s.fighters[id]
        const hp0 = f.hp
        const ap0 = f.ap
        const mp0 = f.mp
        for (let dh = 1; dh <= 400; dh++) {
          f.hp = hp0 - 10 * dh
          for (let ap = 0; ap < 13; ap++) {
            f.ap = ap
            for (let mp = 0; mp < 7; mp++) {
              f.mp = mp
              hashes[k++] = BigInt.asIntN(64, stateHash(s))
              if (k >= N) break outer
            }
          }
        }
        f.hp = hp0
        f.ap = ap0
        f.mp = mp0
      }
    }
    expect(k).toBe(N)
    hashes.sort()
    let dup = 0
    for (let i = 1; i < N; i++) if (hashes[i] === hashes[i - 1]) dup++
    expect(dup).toBe(0)
  }, 60_000)

  it('corpus d’états de recherche réels : hash égaux ⇔ états égaux sur les champs du hash (aucune collision)', async () => {
    // Clé canonique indépendante (chaîne) des champs couverts par §6.8 : case, PV par paliers de 10, bouclier, PA/PM
    // × 100, buffs sans uid ni ordre, relances, lancers du tour, morts (buffs conservés), marques, tour et créneau.
    const canon = (st: FightState): string => {
      const parts: string[] = [`${st.round}/${st.turnIndex}`]
      for (const f of st.fighters) {
        const buffs = f.buffs.map(b => `${b.sourceId}:${b.spellId}:${b.effect.effectId}:${Math.round(b.value * 100)}:${b.remaining}:${b.delay}`).sort().join(',')
        if (!f.alive) {
          parts.push(`~${f.id}[${buffs}]`)
          continue
        }
        const rec = (r: Record<string, number>) => Object.keys(r).filter(k => r[k]).sort().map(k => `${k}=${r[k]}`).join(',')
        parts.push(`${f.id}@${f.cell}:${Math.floor(f.hp / 10)}:${f.shield}:${Math.round(f.ap * 100)}:${Math.round(f.mp * 100)}[${buffs}]{${rec(f.cooldowns)}}{${rec(f.castsThisTurn)}}`)
      }
      parts.push(st.glyphs.map(m => `${m.sourceId}:${m.spellId}:${m.center}:${m.remaining}`).sort().join(','))
      parts.push(st.traps.map(m => `${m.sourceId}:${m.spellId}:${m.center}`).sort().join(','))
      return parts.join('|')
    }
    const engine = engineFor()
    const byHash = new Map<bigint, string>()
    let states = 0
    for (let seed = 1; seed <= 24; seed++) {
      await yieldToEventLoop()
      const { fight, me } = randomScene(seed, { engine })
      const view = createView(engine, fight, me, 3)
      const frontier: FightState[] = [fight]
      for (let depth = 0; depth < 2; depth++) {
        const next: FightState[] = []
        for (const st of frontier.slice(0, 6)) {
          const m0 = st.fighters[me.id]
          const vs = createView(engine, st, m0, 3)
          for (const m of generateCasts(vs, st, m0, { perception: createPerception(vs) })) {
            const c = simClone(view, st, depth)
            if (!applyMacro(engine, c, me.id, m)) continue
            const h = stateHash(c)
            const key = canon(c)
            const prev = byHash.get(h)
            if (prev !== undefined) expect(prev, `collision (graine ${seed})`).toBe(key)
            else byHash.set(h, key)
            next.push(c)
            states++
          }
        }
        frontier.splice(0, frontier.length, ...next)
      }
    }
    // Des transpositions existent (mêmes états par deux ordres) : moins de hash distincts que d'états.
    expect(states).toBeGreaterThan(5000)
    expect(byHash.size).toBeLessThan(states)
  }, 120_000)

  it('empreinte de combattant : stable sur clone, sensible aux caractéristiques et à la case', () => {
    const engine = engineFor()
    const { fight } = randomScene(3, { engine })
    const c = engine.cloneFight(fight, false)
    for (const f of fight.fighters) expect(fighterDigest(c.fighters[f.id])).toBe(fighterDigest(f))
    const f = c.fighters[0]
    const d0 = fighterDigest(f)
    f.stats.strength += 1
    expect(fighterDigest(f)).not.toBe(d0)
    f.stats.strength -= 1
    f.cell = f.cell + 1
    expect(fighterDigest(f)).not.toBe(d0)
  })
})

describe('T-parity : advanceUntil = runFight', () => {
  it('20 combats : mêmes tours, mêmes événements, même état final', async () => {
    const engine = engineFor()
    const ctrl: ControllerProvider = () => ({ playTurn: (e, f, me) => playGreedyTurn(e, f, me) })
    const strip = (evs: FightEvent[]) => evs.filter(e => e.t !== 'log' && e.t !== 'aiNote' && e.t !== 'fightEnd')
    for (let seed = 1; seed <= 20; seed++) {
      await yieldToEventLoop()
      const { fight } = randomScene(seed, { engine, nPlayers: 2, nMonsters: 3 })
      const a = engine.cloneFight(fight, true)
      const b = engine.cloneFight(fight, true)
      a.options.rollMode = b.options.rollMode = 'random'
      a.events = []
      b.events = []
      // runFight démarre par `nextTurn` : on termine d'abord le tour en cours, comme le fait `advanceUntil`.
      endCurrentTurn(engine, a)
      runFight(engine, a, ctrl, 30)
      const turns: number[] = []
      advanceUntil(engine, b, ctrl, f => {
        turns.push(f.id)
        return false
      }, 30)
      const ea = strip(a.events)
      const eb = strip(b.events)
      expect(eb.length).toBeGreaterThan(10)
      expect(eb).toEqual(ea.slice(0, eb.length))
      if (a.ended && b.ended) expect(stateHash(b)).toBe(stateHash(a))
      expect(turns.length).toBeGreaterThan(0)
    }
  }, 60_000)
})

describe('briques déterministes : graines, maths, budget, vue', () => {
  it('graines (§13.1) : aiSeed, simSalt, état des clones', () => {
    expect(aiSeed(42, 3, 5, 1)).toBe(mix32(mix32(42 ^ 0xa1a1a1a1, 3), (5 << 8) | 1))
    expect(fightAISeed(42)).toBe(fightAISeed(42))
    expect(fightAISeed(42)).not.toBe(fightAISeed(43))
    expect(simSalt(0x12345678n << 32n, 3)).toBe((0x12345678 ^ 3) >>> 0)
    expect(cloneRngState(7, 9)).toBe(mix32(7 ^ 0x5bd1e995, 9) | 0)
  })

  it('exp, Φ et softmax déterministes (sans Math.exp)', () => {
    for (const x of [-700, -50, -3.3, -1, -1e-9, 0, 1e-9, 0.5, 1, 2.7, 10, 100, 700]) {
      const ref = Math.exp(x)
      expect(Math.abs(detExp(x) - ref) / Math.max(ref, 1e-300)).toBeLessThan(1e-13)
    }
    expect(phi(0)).toBeCloseTo(0.5, 7)
    expect(phi(1)).toBeCloseTo(0.8413447, 6)
    expect(phi(-1.96)).toBeCloseTo(0.0249979, 6)
    expect(phi(3)).toBeCloseTo(0.9986501, 6)
    const out = new Float64Array(4)
    softmaxInto([1, 2, 3, 3], 4, 1, out)
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    expect(out[2]).toBe(out[3])
    softmaxInto([1, 5, 5, 2], 4, 0, out)
    expect(Array.from(out)).toEqual([0, 0.5, 0.5, 0])
  })

  it('budget en nœuds : décompte, épuisement, sous-budgets imputés au parent', () => {
    const b = createNodeBudget(10)
    b.spend(4)
    expect(b.remaining()).toBe(6)
    const c = b.child(3)
    c.spend(2)
    expect(c.remaining()).toBe(1)
    expect(b.used).toBe(6)
    c.spend(1)
    expect(c.exhausted()).toBe(true)
    b.spend(4)
    expect(b.exhausted()).toBe(true)
    expect(b.remaining()).toBe(0)
  })

  it('honnêteté : la réflexion ne lit pas fight.events et ne touche pas aux dés réels ; vue et créneaux', () => {
    const engine = engineFor()
    const { fight, me } = randomScene(9, { engine })
    const real = fight.events
    fight.events = new Proxy(real, {
      get(t, k, r) {
        throw new Error(`lecture de fight.events (${String(k)})`)
        return Reflect.get(t, k, r)
      },
    })
    const rng = fight.rngState
    const view = createView(engine, fight, me, 11)
    const p = createPerception(view)
    valueOf(view, fight, p)
    const cands = generateCasts(view, fight, me, { perception: p })
    for (const m of cands.slice(0, 20)) {
      const c = simClone(view, fight, 2)
      expect(c.rngState).toBe(cloneRngState(11, 2))
      expect(c.options.record).toBe(false)
      applyMacro(engine, c, me.id, m)
      valueOf(view, c, p, { root: fight })
    }
    expect(fight.rngState).toBe(rng)
    fight.events = real
    // Créneaux à venir : ordre public = forecastSlots ; vue = combattants vivants.
    expect(view.upcoming(5)).toEqual(forecastSlots(engine, fight, 5))
    expect(view.visible().length).toBe(fight.fighters.filter(f => f.alive).length)
    // sanitizeForTeam est idempotent.
    const c = engine.cloneFight(fight, false)
    sanitizeForTeam(c, me.team)
    const h = stateHash(c)
    sanitizeForTeam(c, me.team)
    expect(stateHash(c)).toBe(h)
  })
})
