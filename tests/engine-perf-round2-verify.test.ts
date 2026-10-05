/**
 * Vérification adverse du 2e tour d'optimisation (performances) : caches et partages introduits par ce tour, sous
 * des MUTATIONS entre deux appels (déplacements, morts, portés, changement de carte, relances remplies en place avant
 * le combat, parent qui avance après un clone de simulation) — cas que tests/engine-perf-round2.test.ts (comparaison
 * appel par appel à l'ancienne implémentation) ne couvre pas :
 *  - `computeReachFor` : table de marchabilité PAR CARTE (WeakMap) et ratios de fuite par tacleur (`RATIO`) — aucun
 *    résultat ne dépend de l'appel précédent (ordre des appels, carte précédente) ;
 *  - `target()` : table d'occupation `LOS_OCC` (zones « seulement en LdV ») ≡ `fighterAt` après déplacements, morts,
 *    portés, et en alternant deux combats ;
 *  - `zoneCells` : tri par origine réécrit en place avec des vues par longueur (`SCRATCH_VIEWS`) ≡ balayage trié ;
 *  - empreintes mémoïsées des relances / lancers (src/ai/core/hash.ts) ≡ calcul sur des enregistrements neufs, au fil
 *    de vrais tours (lancers, fins de tour, relances décomptées) et pour un enregistrement VIDE rempli en place
 *    (src/dungeons/waves.ts `applyInitialCooldowns`) ;
 *  - `cloneFightForSim` : un clone de simulation garde ses caractéristiques / états quand le PARENT avance ensuite.
 */
import { describe, expect, it } from 'vitest'
import { geometryKey, mobilityDigest, stateHash } from '../src/ai/core/hash'
import { computeReachFor, escapeRatioAt } from '../src/ai/core/reach'
import { apMpAfterTackle } from '../src/damage/tackle'
import { Rng } from '../src/core/rng'
import type { MapData } from '../src/data/model'
import { canCast, castSpell } from '../src/engine/cast'
import { target } from '../src/engine/effects/core'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'
import type { EffectData } from '../src/data/model'
import { CELL_COUNT, CELL_X, CELL_Y, neighborsOf } from '../src/map/geometry'
import { isCellInZone, parseZoneString, zoneCells } from '../src/map/zones'
import { randomScene } from './ai-core-helpers'

/** Résultat complet d'un `computeReachFor` (copie : le ReachInfo est réutilisé). */
function snapReach(engine: Engine, s: FightState, f: Fighter, opts: Parameters<typeof computeReachFor>[4] = {}): string {
  const r = computeReachFor(engine, s, f, f.team, opts)
  const cells = Array.from(r.cells.subarray(0, r.count))
  return JSON.stringify(cells.map(c => [c, r.mpLeft[c], r.apLeft[c], r.prev[c], r.viaEvent[c]]))
}

// ───────────────────────────── reach : caches indépendants de l'appel précédent ─────────────────────────────

describe('computeReachFor : table de marchabilité par carte, ratios de fuite par tacleur', () => {
  it('une carte modifiée (nouvel objet) n’hérite pas de la table de l’ancienne, et réciproquement', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { engine, fight, me } = randomScene(seed, { nPlayers: 2, nMonsters: 3, spread: 5 })
      const map0 = fight.map
      const ref0 = snapReach(engine, fight, me, { mp: 6, ap: 10 })
      // Cases marchables libres autour du marcheur rendues non marchables sur une COPIE de la carte.
      const blocked = new Set(neighborsOf(me.cell).filter(c => map0.cells[c]?.walkable && !engine.fighterAt(fight, c)).slice(0, 2))
      if (!blocked.size) continue
      const map1: MapData = { ...map0, cells: map0.cells.map((c, i) => (blocked.has(i) ? { ...c, walkable: false } : c)) }
      const map1b: MapData = { ...map0, cells: map0.cells.map((c, i) => (blocked.has(i) ? { ...c, walkable: false } : c)) }
      fight.map = map1
      const ref1 = snapReach(engine, fight, me, { mp: 6, ap: 10 })
      const r = computeReachFor(engine, fight, me, me.team, { mp: 6, ap: 10 })
      for (let i = 0; i < r.count; i++) expect(blocked.has(r.cells[i]), `graine ${seed} : case non marchable atteinte`).toBe(false)
      expect(ref1).not.toBe(ref0)
      // Retour à la carte d'origine : résultat d'origine ; copie identique (autre objet) : même résultat que map1.
      fight.map = map0
      expect(snapReach(engine, fight, me, { mp: 6, ap: 10 })).toBe(ref0)
      fight.map = map1b
      expect(snapReach(engine, fight, me, { mp: 6, ap: 10 })).toBe(ref1)
      fight.map = map0
    }
  })

  it('tacles et fuite changés entre deux appels : résultat indépendant de l’ordre des appels', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = new Rng(seed * 104729)
      const { engine, fight, me } = randomScene(seed, { nPlayers: 2, nMonsters: 5, spread: 4 })
      const enemies = fight.fighters.filter(f => f.alive && f.team !== me.team)
      // Configurations : (tacle de chaque ennemi, fuite du marcheur, tacleur supplémentaire), objets `stats` remplacés.
      const configs = Array.from({ length: 6 }, () => ({
        tackles: enemies.map(() => Math.floor(rng.next() * 140) - 30),
        evade: Math.floor(rng.next() * 100) - 10,
        extra: rng.next() < 0.5 ? { cell: neighborsOf(me.cell)[Math.floor(rng.next() * 4)], tackle: Math.floor(rng.next() * 90) - 20 } : undefined,
      }))
      const run = (k: number): string => {
        const cfg = configs[k]
        enemies.forEach((e, i) => (e.stats = { ...e.stats, tackleBlock: cfg.tackles[i] }))
        me.stats = { ...me.stats, tackleEvade: cfg.evade }
        const extra = cfg.extra && cfg.extra.cell >= 0 && cfg.extra.cell < CELL_COUNT ? cfg.extra : undefined
        return snapReach(engine, fight, me, { mp: 5, ap: 11, extraTackler: extra })
      }
      const forward = configs.map((_, k) => run(k))
      const backward = configs.map((_, k) => configs.length - 1 - k).map(k => run(k)).reverse()
      expect(backward, `graine ${seed}`).toEqual(forward)
      // Chaque configuration seule, juste après une configuration sans aucun tacleur effectif.
      for (let k = 0; k < configs.length; k++) {
        enemies.forEach(e => (e.stats = { ...e.stats, tackleBlock: -5 }))
        snapReach(engine, fight, me, { mp: 5, ap: 11 })
        expect(run(k), `graine ${seed} config ${k}`).toBe(forward[k])
      }
    }
  })

  it('PM restants de chaque case ≡ ratio de fuite recalculé (`escapeRatioAt`) sur la case précédente, tacles changés', () => {
    let tackledSteps = 0
    for (let seed = 1; seed <= 10; seed++) {
      const rng = new Rng(seed * 7727)
      const { engine, fight, me } = randomScene(seed, { nPlayers: 2, nMonsters: 6, spread: 4 })
      const enemies = fight.fighters.filter(f => f.alive && f.team !== me.team)
      for (let k = 0; k < 5; k++) {
        // Tacles ≥ 0 (un tacle négatif est ignoré par la recherche mais compté à 0 par `escapeRatioAt` : écart connu).
        enemies.forEach(e => (e.stats = { ...e.stats, tackleBlock: Math.floor(rng.next() * 120) }))
        me.stats = { ...me.stats, tackleEvade: Math.floor(rng.next() * 60) }
        const r = computeReachFor(engine, fight, me, me.team, { mp: 6, ap: 10 })
        for (let i = 1; i < r.count; i++) {
          const n = r.cells[i]
          const p = r.prev[n]
          const ratio = escapeRatioAt(engine, fight, me, p)
          const mpAfter = ratio < 1 ? apMpAfterTackle(r.mpLeft[p], ratio) : r.mpLeft[p]
          expect(r.mpLeft[n], `graine ${seed} config ${k} : case ${n} depuis ${p}`).toBe(Math.fround(mpAfter - 1))
          if (ratio < 1) tackledSteps++
        }
      }
    }
    expect(tackledSteps).toBeGreaterThan(50)
  })
})

// ───────────────────────────── target() : occupation remise à jour ─────────────────────────────

describe('target() : zone « seulement en LdV » ≡ fighterAt après mutations, deux combats alternés', () => {
  it('déplacements, morts, porté, puis un autre combat : mêmes cases que la référence case par case', () => {
    const zones = ['C3', 'C5', 'X4', 'G2', 'L5', 'T3'].map(z => parseZoneString(z, 'v'))
    const scenes = [1, 2, 3, 4].map(seed => randomScene(seed, { nPlayers: 4, nMonsters: 6, spread: 6 }))
    const rng = new Rng(99)
    let checked = 0
    let blockedSomewhere = 0
    const check = (sc: (typeof scenes)[number]): void => {
      const { engine, fight, me } = sc
      const base = me.spells[0].level.effects[0]
      for (const zone of zones) {
        const eff: EffectData = { ...base, zone, targetMask: '' }
        for (const f of fight.fighters) {
          if (f.cell < 0) continue
          const cell = f.cell
          const prep = target(engine, fight, me, eff, cell, me.cell)
          const ref = zoneCells(zone, cell, me.cell, { blocksLos: c => !fight.map.cells[c]?.los || (c !== cell && !!engine.fighterAt(fight, c)) })
          expect(prep.cells).toEqual(ref)
          if (ref.length < zoneCells(zone, cell, me.cell).length) blockedSomewhere++
          checked++
        }
      }
    }
    for (let round = 0; round < 4; round++) {
      for (const sc of scenes) {
        check(sc)
        // Mutations du combat : un combattant déplacé sur une case libre, un mort, un porté (puis rendus).
        const { engine, fight } = sc
        const free = fight.map.cells.map((_, c) => c).filter(c => engine.isCellFree(fight, c))
        const mover = fight.fighters[1 + Math.floor(rng.next() * (fight.fighters.length - 1))]
        if (mover.alive && free.length) mover.cell = free[Math.floor(rng.next() * free.length)]
        const victim = fight.fighters[(round + 2) % fight.fighters.length]
        const carried = fight.fighters[(round + 3) % fight.fighters.length]
        const carrier = fight.fighters[(round + 4) % fight.fighters.length]
        const wasAlive = victim.alive
        victim.alive = false
        if (carried !== carrier && carried.alive) carried.carriedBy = carrier.id
        check(sc)
        victim.alive = wasAlive
        carried.carriedBy = undefined
      }
    }
    expect(checked).toBeGreaterThan(500)
    expect(blockedSomewhere).toBeGreaterThan(20)
  })
})

// ───────────────────────────── zones : tri par origine en place ─────────────────────────────

describe('zoneCells (formes en rayons, tri par origine en place) ≡ balayage trié par (distance, id)', () => {
  it('toutes tailles de résultat, vues de tri réutilisées d’une longueur à l’autre', () => {
    const rng = new Rng(1234)
    const centers = [0, 13, 27, 280, 300, 559]
    for (let i = 0; i < 12; i++) centers.push(Math.floor(rng.next() * CELL_COUNT))
    const lens = new Set<number>()
    for (const shape of ['X', '+', '*', 'T', 'L', 'l', '-', 'U', 'Q', '#', '/']) {
      for (const r of [0, 1, 2, 3, 5, 8, 12, 20]) {
        const zone = parseZoneString(`${shape}${r}`)
        for (const center of centers) {
          const caster = centers[(center + r) % centers.length]
          const origin = shape === 'l' ? caster : center
          const ox = CELL_X[origin]
          const oy = CELL_Y[origin]
          const ref: number[] = []
          for (let c = 0; c < CELL_COUNT; c++) if (isCellInZone(zone, c, center, caster)) ref.push(c)
          ref.sort((a, b) => Math.abs(CELL_X[a] - ox) + Math.abs(CELL_Y[a] - oy) - (Math.abs(CELL_X[b] - ox) + Math.abs(CELL_Y[b] - oy)) || a - b)
          const got = zoneCells(zone, center, caster)
          expect(got, `${shape}${r} centre ${center} lanceur ${caster}`).toEqual(ref)
          lens.add(got.length)
        }
      }
    }
    expect(lens.size).toBeGreaterThan(20)
  })
})

// ───────────────────────────── empreintes mémoïsées au fil de vrais tours ─────────────────────────────

/** Copie du combat dont relances / lancers sont des objets NEUFS (aucune mémo possible) : référence des empreintes. */
function freshRecords(engine: Engine, s: FightState): FightState {
  const c = engine.cloneFight(s, false)
  for (const f of c.fighters) {
    f.cooldowns = { ...f.cooldowns }
    f.castsThisTurn = { ...f.castsThisTurn }
  }
  return c
}

function digests(s: FightState): string {
  const g = geometryKey(s, f => f.cell)
  return JSON.stringify([stateHash(s).toString(), g.h1, g.h2, s.fighters.map(mobilityDigest)])
}

describe('empreintes mémoïsées des relances / lancers ≡ enregistrements neufs, au fil de vrais tours', () => {
  it('lancers, fins de tour, relances décomptées ; enregistrement vide rempli en place avant le combat', () => {
    let casts = 0
    for (let seed = 1; seed <= 5; seed++) {
      const { engine, fight } = randomScene(seed, { nPlayers: 3, nMonsters: 3, spread: 6 })
      // Enregistrement VIDE (fabrique) rempli en place : seul cas d'écriture en place admis (applyInitialCooldowns).
      const f0 = fight.fighters[fight.fighters.length - 1]
      f0.cooldowns = {}
      expect(digests(fight)).toBe(digests(freshRecords(engine, fight)))
      for (const sp of f0.spells.slice(0, 3)) f0.cooldowns[sp.spellId] = 3
      expect(digests(fight)).toBe(digests(freshRecords(engine, fight)))
      for (let turn = 0; turn < 10 && !fight.ended; turn++) {
        const cur = engine.current(fight)
        if (!cur) break
        if (cur.alive) {
          for (const sp of cur.spells) {
            for (const t of fight.fighters) {
              if (!t.alive || t.team === cur.team || canCast(engine, fight, cur, sp, t.cell) !== null) continue
              castSpell(engine, fight, cur, sp.spellId, t.cell)
              casts++
              expect(digests(fight), `graine ${seed} tour ${turn} : après un lancer`).toBe(digests(freshRecords(engine, fight)))
              break
            }
          }
          engine.endTurn(fight, cur)
        }
        expect(digests(fight), `graine ${seed} tour ${turn} : après la fin de tour`).toBe(digests(freshRecords(engine, fight)))
        if (!engine.nextTurn(fight)) break
        expect(digests(fight), `graine ${seed} tour ${turn} : début de tour`).toBe(digests(freshRecords(engine, fight)))
      }
    }
    expect(casts).toBeGreaterThan(10)
  })
})

// ───────────────────────────── cloneFightForSim : le parent avance ensuite ─────────────────────────────

describe('cloneFightForSim : le parent qui avance ne change pas un clone de simulation pris avant', () => {
  it('lancers et tours du parent (stats / états remplacés) : clone intact, puis le clone joue normalement', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { engine, fight } = randomScene(seed, { nPlayers: 3, nMonsters: 3, spread: 6 })
      const sim = engine.cloneFightForSim(fight, false)
      const snap = sim.fighters.map(f => JSON.stringify([f.stats, f.states, f.buffs.length]))
      for (let turn = 0; turn < 6 && !fight.ended; turn++) {
        const cur = engine.current(fight)
        if (!cur) break
        if (cur.alive) {
          for (const sp of cur.spells) {
            const t = fight.fighters.find(o => o.alive && canCast(engine, fight, cur, sp, o.cell) === null)
            if (t) castSpell(engine, fight, cur, sp.spellId, t.cell)
          }
          engine.endTurn(fight, cur)
        }
        if (!engine.nextTurn(fight)) break
      }
      expect(sim.fighters.map(f => JSON.stringify([f.stats, f.states, f.buffs.length])), `graine ${seed}`).toEqual(snap)
      // Le clone joue ensuite sans toucher le parent.
      const parentSnap = fight.fighters.map(f => JSON.stringify([f.stats, f.states, f.hp, f.cell]))
      const cur = engine.current(sim)
      if (cur && cur.alive) {
        for (const sp of cur.spells) {
          const t = sim.fighters.find(o => o.alive && o.team !== cur.team && canCast(engine, sim, cur, sp, o.cell) === null)
          if (t) castSpell(engine, sim, cur, sp.spellId, t.cell)
        }
      }
      expect(fight.fighters.map(f => JSON.stringify([f.stats, f.states, f.hp, f.cell]))).toEqual(parentSnap)
    }
  })
})
