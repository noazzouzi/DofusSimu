/**
 * Garde-fous des optimisations de performance du moteur et du socle IA (comportement identique) :
 *  - partage copie-sur-écriture de `cloneFight` (src/engine/cow.ts) : un clone et son parent restent indépendants
 *    sous les opérations du moteur (lancers, tours, morts, buffs, relances, compteurs, métriques) ;
 *  - anneaux de portée inverse (`inverseRange`) = balayage exhaustif trié ;
 *  - LdV par occupation lue depuis la cible (`hasLineOfSightOcc`) = `hasLineOfSightOnMap` avec rappel ;
 *  - zones « toute la carte » copiées (`zoneCells`) = parcours générique (`zoneCellsInto`).
 * Le garde-fou principal reste l'égalité des empreintes et des replays de combats complets (scripts/perf-digest.ts).
 */
import { describe, expect, it } from 'vitest'
import { inverseRange, type CastGeom } from '../src/ai/core/castCells'
import { Rng } from '../src/core/rng'
import { castSpell } from '../src/engine/cast'
import type { Engine } from '../src/engine/engine'
import type { FightState } from '../src/engine/types'
import { CELL_COUNT, cellsByDistance, distance, isInCastRange } from '../src/map/geometry'
import { hasLineOfSightOcc, hasLineOfSightOnMap, opaqueCells } from '../src/map/los'
import { zoneCells, zoneCellsInto } from '../src/map/zones'
import { mapOf, randomScene, VORTEX_MAP } from './ai-core-helpers'

/** Empreinte texte de l'état mutable des combattants (buffs sans l'objet d'effet, relances, compteurs, PV…). */
function snap(fight: FightState): string {
  return JSON.stringify({
    fighters: fight.fighters.map(f => ({
      id: f.id, hp: f.hp, maxHp: f.maxHp, shield: f.shield, ap: f.ap, mp: f.mp, cell: f.cell, alive: f.alive,
      states: f.states, stats: f.stats, cooldowns: f.cooldowns, castsThisTurn: f.castsThisTurn, castsOnTarget: f.castsOnTarget,
      buffs: f.buffs.map(b => ({ ...b, effect: b.effect.effectId })),
    })),
    metrics: fight.metrics,
    glyphs: fight.glyphs.map(g => [g.uid, g.remaining]),
    round: fight.round,
    rng: fight.rngState,
  })
}

/** Joue `turns` tours : chaque combattant tente chacun de ses sorts sur chaque ennemi vivant. */
function play(engine: Engine, fight: FightState, turns: number): void {
  for (let t = 0; t < turns && !fight.ended; t++) {
    const f = engine.nextTurn(fight)
    if (!f) break
    for (const sp of f.spells) {
      for (const e of fight.fighters) {
        if (fight.ended || !f.alive) break
        if (e.alive && e.team !== f.team && e.cell >= 0) castSpell(engine, fight, f, sp.spellId, e.cell)
      }
    }
    if (!fight.ended && f.alive) engine.endTurn(fight, f)
  }
}

describe('cloneFight : partage copie-sur-écriture', () => {
  it('un clone modifié ne change pas son parent, et réciproquement (buffs, relances, compteurs, morts)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { engine, fight } = randomScene(seed, { nMonsters: 4 })
      fight.options.rollMode = 'random'
      play(engine, fight, 3) // des buffs, relances et compteurs existent avant le partage
      const before = snap(fight)
      const c = engine.cloneFight(fight, false)
      expect(snap(c)).toBe(before)
      play(engine, c, 8)
      expect(snap(fight), `graine ${seed} : parent modifié par son clone`).toBe(before)
      const c2 = engine.cloneFight(fight, false)
      const c3 = engine.cloneFight(c2, false)
      const s2 = snap(c2)
      play(engine, fight, 8)
      expect(snap(c2), `graine ${seed} : clone modifié par son parent`).toBe(s2)
      play(engine, c3, 8)
      expect(snap(c2), `graine ${seed} : clone modifié par son propre clone`).toBe(s2)
    }
  })

  it('deux clones d’un même parent rejouent à l’identique (même suite d’opérations)', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const { engine, fight } = randomScene(seed, { nMonsters: 4 })
      fight.options.rollMode = 'random'
      play(engine, fight, 2)
      const a = engine.cloneFight(fight, false)
      const b = engine.cloneFight(fight, false)
      play(engine, a, 10)
      play(engine, b, 10)
      expect(snap(a)).toBe(snap(b))
    }
  })
})

describe('anneaux de portée inverse', () => {
  it('égaux au balayage exhaustif trié par (distance, id)', () => {
    const geoms: CastGeom[] = []
    for (const line of [false, true]) {
      for (const diag of [false, true]) {
        for (let min = 0; min <= 2; min++) for (let max = min; max <= 14; max += 3) geoms.push({ min, max, line, diag })
      }
    }
    geoms.push({ min: 1, max: 63, line: false, diag: false })
    for (const g of geoms) {
      for (let target = 0; target < CELL_COUNT; target += 7) {
        const ref: number[] = []
        for (let c = 0; c < CELL_COUNT; c++) if (isInCastRange(c, target, g.min, g.max, g.line, g.diag)) ref.push(c)
        ref.sort((a, b) => distance(a, target) - distance(b, target) || a - b)
        expect(Array.from(inverseRange(g, target))).toEqual(ref)
      }
    }
  })

  it('ordre par distance précalculé = tri explicite', () => {
    for (const o of [0, 13, 280, 559]) {
      const ref = Array.from({ length: CELL_COUNT }, (_, c) => c).sort((a, b) => distance(a, o) - distance(b, o) || a - b)
      expect(Array.from(cellsByDistance(o))).toEqual(ref)
    }
  })
})

describe('ligne de vue par occupation', () => {
  it('hasLineOfSightOcc = hasLineOfSightOnMap avec rappel d’occupation', () => {
    const map = mapOf(VORTEX_MAP)
    const opaque = opaqueCells(map.cells)
    const rng = new Rng(7)
    for (let round = 0; round < 20; round++) {
      const occ = new Int16Array(CELL_COUNT).fill(-1)
      for (let k = 0; k < 25; k++) occ[Math.floor(rng.next() * CELL_COUNT)] = k % 12
      const except = round % 12
      const blocked = (c: number): boolean => occ[c] >= 0 && occ[c] !== except
      for (let k = 0; k < 2000; k++) {
        const a = Math.floor(rng.next() * CELL_COUNT)
        const b = Math.floor(rng.next() * CELL_COUNT)
        expect(hasLineOfSightOcc(opaque, a, b, occ, except)).toBe(hasLineOfSightOnMap(opaque, a, b, blocked))
      }
    }
  })
})

describe('zones « toute la carte »', () => {
  it('zoneCells (copie de l’ordre précalculé) = zoneCellsInto (parcours générique)', () => {
    const shapes = [
      { shape: 'a', size: 1, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false },
      { shape: 'A', size: 1, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false },
      { shape: 'C', size: 63, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false },
    ]
    const out: number[] = []
    for (const z of shapes) {
      for (const center of [0, 77, 300, 559]) {
        const a = zoneCells(z, center, 120)
        expect(a).toEqual(zoneCellsInto(z, center, 120, out).slice())
        a.pop() // nouveau tableau : le modifier ne touche pas le cache
        expect(zoneCells(z, center, 120).length).toBe(CELL_COUNT)
      }
    }
  })
})
