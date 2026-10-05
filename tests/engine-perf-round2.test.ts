/**
 * Régressions du 2e tour d'optimisation (performances) — chaque optimisation comparée à une implémentation de
 * RÉFÉRENCE (ancienne version, sans cache ni raccourci) :
 *  - `cloneFightForSim` (clones de l'IA) partage `stats` / `states` (objets remplacés, jamais modifiés en place) :
 *    parent intact ; `cloneFight` en garde des copies privées (appelants qui les modifient en place) ;
 *  - `computeReachFor` (ratios de fuite précalculés par tacleur, table de marchabilité) ≡ ancienne recherche, tacles
 *    négatifs et tacleur supplémentaire compris ;
 *  - `inverseRange` (borne de balayage serrée hors diagonale, cache indexé) ≡ balayage exhaustif ;
 *  - `prepareDamage` (accès nommés par élément) ≡ accès indexés `s[ELEMENT_…[el]]` ;
 *  - `target()` : zone « seulement en LdV » sur table d'occupation ≡ `fighterAt` case par case ; tris par insertion
 *    (zone, puis distance et id) ≡ tris natifs ;
 *  - empreintes mémoïsées des enregistrements (`stateHash`, `geometryKey`, `mobilityDigest`) ≡ calcul direct ;
 *  - `compileTargetMask` (mémo du dernier masque) : même objet compilé que le cache.
 */
import { describe, expect, it } from 'vitest'
import { inverseRange, type CastGeom } from '../src/ai/core/castCells'
import { fnvInt, geometryKey, mobilityDigest, stateHash } from '../src/ai/core/hash'
import { buildOccupancy, canTackleNow, computeReachFor } from '../src/ai/core/reach'
import { believedCell, trapKnownBy } from '../src/ai/core/view'
import { Rng } from '../src/core/rng'
import { ELEMENT_FIXED_DAMAGE, ELEMENT_MAIN_STAT, ELEMENT_RES_FIXED, ELEMENT_RES_PCT, STAT_KEYS, emptyStats, type Element, type TeamId } from '../src/core/types'
import { apMpAfterTackle, tackleRatio } from '../src/damage/tackle'
import { prepareDamage, type DamageInput } from '../src/damage/damage'
import { canCast, castSpell } from '../src/engine/cast'
import { ownBuffs } from '../src/engine/cow'
import { target } from '../src/engine/effects/core'
import type { Engine } from '../src/engine/engine'
import { compileTargetMask } from '../src/engine/targetMask'
import type { Fighter, FightState, Glyph } from '../src/engine/types'
import type { EffectData } from '../src/data/model'
import { CELL_COUNT, distance, isInCastRange, neighborsOf } from '../src/map/geometry'
import { parseZoneString, zoneCells } from '../src/map/zones'
import { randomScene } from './ai-core-helpers'

// ───────────────────────────── cloneFight : stats / états partagés ─────────────────────────────

describe('cloneFightForSim : caractéristiques et états partagés (remplacés, jamais modifiés en place)', () => {
  it('cloneFight garde des copies privées : une modification EN PLACE du clone ne touche pas le parent (M-R20)', () => {
    const { engine, fight } = randomScene(3, { nPlayers: 2, nMonsters: 2 })
    const f0 = fight.fighters[0]
    const crit0 = f0.stats.critical
    const c = engine.cloneFight(fight, false)
    expect(c.fighters[0].stats).not.toBe(f0.stats)
    expect(c.fighters[0].states).not.toBe(f0.states)
    c.fighters[0].stats.critical = 1000
    c.fighters[0].states.push(9999)
    expect(f0.stats.critical).toBe(crit0)
    expect(f0.states.includes(9999)).toBe(false)
  })

  it('le clone de simulation partage les objets ; ses modifications (buffs, états) ne touchent jamais le parent', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { engine, fight, me } = randomScene(seed, { nPlayers: 3, nMonsters: 4 })
      const before = fight.fighters.map(f => ({ stats: f.stats, states: f.states, json: JSON.stringify([f.stats, f.states]) }))
      const c = engine.cloneFightForSim(fight, false)
      c.fighters.forEach((f, i) => {
        expect(f.stats).toBe(fight.fighters[i].stats)
        expect(f.states).toBe(fight.fighters[i].states)
      })
      const cm = c.fighters[me.id]
      for (const sp of cm.spells) {
        for (const e of c.fighters) if (e.alive && canCast(engine, c, cm, sp, e.cell) === null) castSpell(engine, c, cm, sp.spellId, e.cell)
      }
      // Fin de tour puis tours suivants dans le clone (décomptes, buffs, états).
      for (let k = 0; k < 4 && !c.ended; k++) {
        const cur = engine.current(c)
        if (cur && cur.alive) engine.endTurn(c, cur)
        if (!engine.nextTurn(c)) break
      }
      fight.fighters.forEach((f, i) => {
        expect(f.stats, `graine ${seed} : stats du parent remplacées`).toBe(before[i].stats)
        expect(f.states).toBe(before[i].states)
        expect(JSON.stringify([f.stats, f.states]), `graine ${seed} : parent modifié en place`).toBe(before[i].json)
      })
    }
  })
})

// ───────────────────────────── reach ≡ ancienne recherche ─────────────────────────────

interface RefReach {
  cells: number[]
  mp: Map<number, number>
  ap: Map<number, number>
  prev: Map<number, number>
  via: Map<number, number>
}

/**
 * Ancienne `computeReachFor` (avant le 2e tour) : tacle lu dans `LOCK` (tacle brut, ignoré s'il est négatif) et ratio
 * recalculé à chaque case ; file de priorité naïve (extraction du maximum (clé, −case) : même ordre que le tas).
 */
function refReach(engine: Engine, s: FightState, f: Fighter, team: TeamId,
                  opts: { mp?: number; ap?: number; priority?: 'mp' | 'ap'; allowEventCells?: ReadonlySet<number>; extraTackler?: { cell: number; tackle: number } } = {}): RefReach {
  const out: RefReach = { cells: [], mp: new Map(), ap: new Map(), prev: new Map(), via: new Map() }
  const start = believedCell(f, team)
  if (!f.alive || start < 0 || start >= CELL_COUNT) return out
  const mp0 = Math.max(0, Math.floor(opts.mp ?? f.mp))
  const ap0 = opts.ap ?? f.ap
  out.mp.set(start, mp0)
  out.ap.set(start, ap0)
  if (mp0 <= 0 || (engine.stateFlag(f, 'cantBeMoved') && f.tags.rooted)) {
    out.cells.push(start)
    return out
  }
  const occ = buildOccupancy(s, team)
  const event = new Set<number>()
  for (const t of s.traps) if (trapKnownBy(s, t, team)) for (const c of t.cells) if (c >= 0 && c < CELL_COUNT) event.add(c)
  for (const g of s.glyphs) if (g.trigger === 'enter' || g.markType === 'portal') for (const c of g.cells) if (c >= 0 && c < CELL_COUNT) event.add(c)
  const lock = new Map<number, number>()
  if (!engine.stateFlag(f, 'cantBeTackled')) {
    for (const e of s.fighters) {
      if (!e.alive || e.team === f.team || e.carriedBy !== undefined) continue
      const c = believedCell(e, team)
      if (c < 0 || c >= CELL_COUNT || occ[c] !== e.id || !canTackleNow(engine, e)) continue
      lock.set(c, e.stats.tackleBlock)
    }
    const x = opts.extraTackler
    if (x && x.cell >= 0 && x.cell < CELL_COUNT && (lock.get(x.cell) ?? -1) < 0) lock.set(x.cell, x.tackle)
  }
  const evade = f.stats.tackleEvade
  const apFirst = opts.priority === 'ap'
  const key = (ap: number, mp: number): number => (apFirst ? ap * 1024 + mp : mp * 4096 + ap)
  const heap: { c: number; k: number }[] = [{ c: start, k: key(ap0, mp0) }]
  const final = new Set<number>()
  while (heap.length) {
    let bi = 0
    for (let i = 1; i < heap.length; i++) if (heap[i].k > heap[bi].k || (heap[i].k === heap[bi].k && heap[i].c < heap[bi].c)) bi = i
    const c = heap.splice(bi, 1)[0].c
    if (final.has(c)) continue
    final.add(c)
    out.cells.push(c)
    if (c !== start && event.has(c)) continue
    const mp = out.mp.get(c)!
    if (mp <= 0) continue
    let ap = out.ap.get(c)!
    let mpAfter = mp
    if (lock.size) {
      let ratio = 1
      for (const n of neighborsOf(c)) {
        const l = lock.get(n)
        if (l !== undefined && l >= 0) ratio *= tackleRatio(evade, l)
      }
      if (ratio < 1) {
        ap = apMpAfterTackle(ap, ratio)
        mpAfter = apMpAfterTackle(mp, ratio)
      }
    }
    if (mpAfter <= 0) continue
    const nmp = mpAfter - 1
    for (const n of neighborsOf(c)) {
      if (final.has(n) || occ[n] >= 0 || !s.map.cells[n]?.walkable) continue
      if (event.has(n) && !(opts.allowEventCells && opts.allowEventCells.has(n))) continue
      if (out.mp.has(n)) {
        const pa = out.ap.get(n)!
        const pm = out.mp.get(n)!
        if (apFirst ? pa > ap || (pa === ap && pm >= nmp) : pm > nmp || (pm === nmp && pa >= ap)) continue
      }
      out.mp.set(n, nmp)
      out.ap.set(n, ap)
      out.prev.set(n, c)
      out.via.set(n, event.has(n) ? 1 : 0)
      heap.push({ c: n, k: key(ap, nmp) })
    }
  }
  return out
}

describe('computeReachFor ≡ ancienne recherche (tacle exact, tacles négatifs, tacleur supplémentaire)', () => {
  it('scènes aléatoires : mêmes cases (ordre), PM/PA restants, prédécesseurs et cases-événements', () => {
    let compared = 0
    for (let seed = 1; seed <= 24; seed++) {
      const rng = new Rng(seed * 7919)
      const { engine, fight, me } = randomScene(seed, { nPlayers: 3, nMonsters: 5, spread: 5 })
      // Tacles variés (négatifs compris), fuite du marcheur : objets `stats` REMPLACÉS (contrat de partage).
      for (const f of fight.fighters) {
        const tackleBlock = Math.floor(rng.next() * 120) - 30
        const tackleEvade = Math.floor(rng.next() * 90) - 10
        f.stats = { ...f.stats, tackleBlock, tackleEvade }
      }
      // Glyphe « à l'entrée » sur deux cases proches du marcheur (cases-événements).
      const near = neighborsOf(me.cell).filter(c => fight.map.cells[c]?.walkable)
      if (near.length) {
        const g: Glyph = { uid: 9999, sourceId: me.id, spellId: 0, cells: near.slice(0, 2), center: near[0], remaining: 2, effects: [], trigger: 'enter', color: '#000' }
        fight.glyphs = [...fight.glyphs, g]
      }
      for (const priority of ['mp', 'ap'] as const) {
        for (const mp of [3, 4.5, 6]) {
          const ap = 6 + Math.floor(rng.next() * 6) + (rng.next() < 0.3 ? 0.25 : 0)
          const extraCell = near.length > 2 ? near[2] : -1
          const extraTackler = rng.next() < 0.5 && extraCell >= 0 ? { cell: extraCell, tackle: Math.floor(rng.next() * 80) - 20 } : undefined
          const allow = rng.next() < 0.5 ? new Set(near.slice(0, 1)) : undefined
          const got = computeReachFor(engine, fight, me, me.team, { mp, ap, priority, extraTackler, allowEventCells: allow })
          const ref = refReach(engine, fight, me, me.team, { mp, ap, priority, extraTackler, allowEventCells: allow })
          const label = `graine ${seed} ${priority} PM ${mp} PA ${ap}`
          expect(Array.from(got.cells.subarray(0, got.count)), label).toEqual(ref.cells)
          for (let c = 0; c < CELL_COUNT; c++) {
            expect(got.mpLeft[c], `${label} PM case ${c}`).toBe(ref.mp.has(c) ? Math.fround(ref.mp.get(c)!) : -1)
            expect(got.apLeft[c], `${label} PA case ${c}`).toBe(ref.ap.has(c) ? Math.fround(ref.ap.get(c)!) : -1)
            expect(got.prev[c]).toBe(ref.prev.get(c) ?? -1)
            expect(got.viaEvent[c]).toBe(ref.via.get(c) ?? 0)
          }
          compared++
        }
      }
    }
    expect(compared).toBe(24 * 6)
  })
})

// ───────────────────────────── anneaux inverses : borne serrée ─────────────────────────────

function refRing(g: CastGeom, t: number): number[] {
  const out: number[] = []
  for (let c = 0; c < CELL_COUNT; c++) if (isInCastRange(c, t, g.min, g.max, g.line, g.diag)) out.push(c)
  return out.sort((a, b) => distance(a, t) - distance(b, t) || a - b)
}

describe('inverseRange : borne de balayage serrée (Manhattan ≤ PO hors diagonale) ≡ balayage exhaustif', () => {
  it('portées 0-14 (entières, fractionnaires, négatives), toutes géométries, cases de bord', () => {
    const targets = [0, 1, 13, 14, 27, 280, 300, 545, 546, 559]
    const rng = new Rng(4242)
    for (let i = 0; i < 20; i++) targets.push(Math.floor(rng.next() * CELL_COUNT))
    for (const line of [false, true]) {
      for (const diag of [false, true]) {
        for (const min of [0, 1, 3]) {
          for (const max of [-1, 0, 1, 2, 3, 5, 6.5, 8, 11, 14]) {
            const g = { min, max, line, diag }
            for (const t of targets) expect(Array.from(inverseRange(g, t)), `${JSON.stringify(g)} → ${t}`).toEqual(refRing(g, t))
          }
        }
      }
    }
  })
})

// ───────────────────────────── prepareDamage : accès nommés ─────────────────────────────

describe('prepareDamage : lectures nommées par élément ≡ accès indexés', () => {
  it('entrées aléatoires (5 éléments, CC, arme, piège)', () => {
    const rng = new Rng(77)
    const rnd = (): number => Math.floor(rng.next() * 400) - 100
    for (let i = 0; i < 2000; i++) {
      const a = emptyStats()
      const d = emptyStats()
      for (const k of STAT_KEYS) {
        a[k] = rnd()
        d[k] = rnd()
      }
      const el = (i % 5) as Element
      const crit = rng.next() < 0.5
      const input: DamageInput = {
        attacker: a, defender: d, element: el, crit, isWeapon: rng.next() < 0.3, isMelee: rng.next() < 0.5,
        isTrap: rng.next() < 0.2, defenderIsPlayer: rng.next() < 0.5,
      } as DamageInput
      const p = prepareDamage(input)
      const sa = a as unknown as Record<string, number>
      const sd = d as unknown as Record<string, number>
      const power = a.power + sa[ELEMENT_MAIN_STAT[el]] + (input.isTrap ? a.trapPower : 0)
      expect(p.power).toBe(power > 0 ? power : 0)
      expect(p.fixedDamage).toBe(sa[ELEMENT_FIXED_DAMAGE[el]] + a.damage + (crit ? a.criticalDamage : 0) + (input.isTrap ? a.trapDamage : 0))
      expect(p.fixedRes).toBe(sd[ELEMENT_RES_FIXED[el]] + (crit ? d.criticalRes : 0))
      expect(p.rawResPct).toBe(sd[ELEMENT_RES_PCT[el]])
    }
  })
})

// ───────────────────────────── target() : LdV de zone et tris ─────────────────────────────

describe('target() : zone « seulement en LdV » sur table d’occupation, tris par insertion', () => {
  it('mêmes cases que `fighterAt` case par case ; cibles triées comme le tri natif ; ordre de zone conservé', () => {
    let withTargets = 0
    for (let seed = 1; seed <= 10; seed++) {
      const { engine, fight, me } = randomScene(seed, { nPlayers: 5, nMonsters: 8, spread: 6 })
      const base = me.spells[0].level.effects[0]
      for (const z of ['C3', 'C5', 'X4', 'G2', 'L5', 'T3', 'A', 'P']) {
        for (const flags of ['v', '']) {
          const zone = parseZoneString(z, flags)
          const eff: EffectData = { ...base, zone, targetMask: '' }
          for (const f of fight.fighters) {
            if (!f.alive) continue
            const cell = f.cell
            const prep = target(engine, fight, me, eff, cell, me.cell)
            const ref = zone.onlyIfInSight
              ? zoneCells(zone, cell, me.cell, { blocksLos: c => !fight.map.cells[c]?.los || (c !== cell && !!engine.fighterAt(fight, c)) })
              : zoneCells(zone, cell, me.cell)
            expect(prep.cells, `${z}${flags} sur ${cell}`).toEqual(ref)
            const sorted = [...prep.targets].sort((a, b) => distance(cell, a.cell) - distance(cell, b.cell) || a.id - b.id)
            expect(prep.targets.map(t => t.id)).toEqual(sorted.map(t => t.id))
            // Efficacités insérées dans l'ordre des cases de la zone (rang de la première occurrence).
            const rank = (c: number): number => ref.indexOf(c)
            const inZone = fight.fighters.filter(o => o.alive && o.carriedBy === undefined && o.cell >= 0 && rank(o.cell) >= 0)
            inZone.sort((a, b) => rank(a.cell) - rank(b.cell))
            expect([...prep.efficiency.keys()]).toEqual(inZone.map(o => o.id))
            if (prep.targets.length > 1) withTargets++
          }
        }
      }
    }
    expect(withTargets).toBeGreaterThan(100)
  })
})

// ───────────────────────────── empreintes mémoïsées ≡ calcul direct ─────────────────────────────

/** Ancien `stateHash` (enregistrements parcourus à chaque appel). */
function refStateHash(s: FightState): bigint {
  const rec2 = (sa0: number, sb0: number, r: Readonly<Record<string, number>>): [number, number] => {
    let sa = 0
    let sb = 0
    for (const k in r) {
      const v = r[k]
      if (v) {
        sa = (sa + fnvInt(fnvInt(sa0, Number(k)), v)) | 0
        sb = (sb + fnvInt(fnvInt(sb0, Number(k)), v)) | 0
      }
    }
    return [sa, sb]
  }
  const buffs2 = (f: Fighter, sa0: number, sb0: number): [number, number] => {
    let sa = 0
    let sb = 0
    for (const b of f.buffs) {
      const value = Math.round(b.value * 100)
      let ha = fnvInt(sa0, b.sourceId)
      let hb = fnvInt(sb0, b.sourceId)
      ha = fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(ha, b.spellId), b.effect.effectId), value), b.remaining), b.delay)
      hb = fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(hb, b.spellId), b.effect.effectId), value), b.remaining), b.delay)
      sa = (sa + ha) | 0
      sb = (sb + hb) | 0
    }
    return [sa, sb]
  }
  let a = fnvInt(fnvInt(0x811c9dc5, s.round), s.turnIndex)
  let b = fnvInt(fnvInt(0x050c5d1f, s.round), s.turnIndex)
  for (const f of s.fighters) {
    if (!f.alive) {
      const [ba, bb] = buffs2(f, 0x811c9dc5, 0x050c5d1f)
      a = fnvInt(fnvInt(a, ~f.id), ba)
      b = fnvInt(fnvInt(b, ~f.id), bb)
      continue
    }
    const hp10 = Math.floor(f.hp / 10)
    const ap = Math.round(f.ap * 100)
    const mp = Math.round(f.mp * 100)
    a = fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(a, f.id), f.cell), hp10), f.shield), ap), mp)
    b = fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(b, f.id), f.cell), hp10), f.shield), ap), mp)
    const [ba, bb] = buffs2(f, 0x811c9dc5, 0x050c5d1f)
    a = fnvInt(a, ba)
    b = fnvInt(b, bb)
    const [ca, cb] = rec2(0x811c9dc5, 0x050c5d1f, f.cooldowns)
    const [ta, tb] = rec2(0x01000193, 0x2545f491, f.castsThisTurn)
    a = fnvInt(fnvInt(a, ca), ta)
    b = fnvInt(fnvInt(b, cb), tb)
  }
  let ma = 0
  let mb = 0
  for (const m of s.glyphs) {
    ma = (ma + fnvInt(fnvInt(fnvInt(fnvInt(0x811c9dc5, m.sourceId), m.spellId), m.center), m.remaining)) | 0
    mb = (mb + fnvInt(fnvInt(fnvInt(fnvInt(0x050c5d1f, m.sourceId), m.spellId), m.center), m.remaining)) | 0
  }
  for (const m of s.traps) {
    ma = (ma + fnvInt(fnvInt(fnvInt(fnvInt(0x811c9dc5, m.sourceId), m.spellId), m.center), -1)) | 0
    mb = (mb + fnvInt(fnvInt(fnvInt(fnvInt(0x050c5d1f, m.sourceId), m.spellId), m.center), -1)) | 0
  }
  a = fnvInt(a, ma)
  b = fnvInt(b, mb)
  return (BigInt(a >>> 0) << 32n) | BigInt(b >>> 0)
}

/** Enregistrement aléatoire (clés de sorts réelles ou non, valeurs 0..4, parfois vide). */
function randomRecord(rng: Rng, keys: number[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const k of keys) if (rng.next() < 0.4) out[k] = Math.floor(rng.next() * 5)
  return out
}

describe('empreintes mémoïsées des relances / lancers ≡ calcul direct', () => {
  it('stateHash, geometryKey, mobilityDigest : mémo (même objet) = objet neuf = ancien calcul', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = new Rng(seed * 31)
      const { engine, fight } = randomScene(seed, { nPlayers: 3, nMonsters: 4 })
      const believed = (f: Fighter): number => f.cell
      for (let round = 0; round < 12; round++) {
        for (const f of fight.fighters) {
          const keys = f.spells.map(s => s.spellId).concat([7, 13328])
          f.cooldowns = randomRecord(rng, keys)
          f.castsThisTurn = randomRecord(rng, keys)
        }
        const h1 = stateHash(fight)
        const g1 = { ...geometryKey(fight, believed) }
        const m1 = fight.fighters.map(mobilityDigest)
        // Deuxième appel : empreintes mémoïsées (mêmes objets).
        expect(stateHash(fight)).toBe(h1)
        expect({ ...geometryKey(fight, believed) }).toEqual(g1)
        expect(fight.fighters.map(mobilityDigest)).toEqual(m1)
        expect(h1).toBe(refStateHash(fight))
        // Objets neufs de même contenu (aucune mémo) : mêmes empreintes.
        for (const f of fight.fighters) {
          f.cooldowns = { ...f.cooldowns }
          f.castsThisTurn = { ...f.castsThisTurn }
        }
        expect(stateHash(fight)).toBe(h1)
        expect({ ...geometryKey(fight, believed) }).toEqual(g1)
        expect(fight.fighters.map(mobilityDigest)).toEqual(m1)
      }
      // Buffs NON possédés (après un clonage, src/engine/cow.ts) : clone = ancien calcul ; tableaux neufs (copies) :
      // mêmes empreintes ; un buff modifié dans un tableau rendu possédé (moteur) : empreinte recalculée.
      const c = engine.cloneFight(fight, false)
      const hc = stateHash(c)
      expect(hc).toBe(refStateHash(c))
      const mc = c.fighters.map(mobilityDigest)
      expect(stateHash(c)).toBe(hc)
      for (const f of c.fighters) f.buffs = f.buffs.slice()
      expect(stateHash(c)).toBe(hc)
      expect(c.fighters.map(mobilityDigest)).toEqual(mc)
      const holder = c.fighters.find(f => f.alive && f.buffs.some(b => b.remaining > 1))
      if (holder) {
        engine.cloneFight(c, false) // nouvelle époque : rien n'est possédé
        const before = stateHash(c)
        const bs = ownBuffs(holder)
        const b = bs.find(x => x.remaining > 1)!
        b.remaining--
        expect(stateHash(c)).toBe(refStateHash(c))
        expect(stateHash(c)).not.toBe(before)
      }
      // Sensibilité : une relance > 1 change la géométrie et la mobilité ; un lancer du tour change le hash.
      const f0 = fight.fighters[0]
      const sid = f0.spells[0].spellId
      f0.cooldowns = { ...f0.cooldowns, [sid]: 0 }
      const g0 = { ...geometryKey(fight, believed) }
      const mob0 = mobilityDigest(f0)
      f0.cooldowns = { ...f0.cooldowns, [sid]: 3 }
      expect({ ...geometryKey(fight, believed) }).not.toEqual(g0)
      expect(mobilityDigest(f0)).not.toBe(mob0)
      const h0 = stateHash(fight)
      f0.castsThisTurn = { ...f0.castsThisTurn, [sid]: (f0.castsThisTurn[sid] ?? 0) + 1 }
      expect(stateHash(fight)).not.toBe(h0)
    }
  })
})

// ───────────────────────────── masques compilés ─────────────────────────────

describe('compileTargetMask : mémo du dernier masque', () => {
  it('appels alternés et chaînes égales de contenu : toujours l’objet du cache', () => {
    const masks = ['a,A', 'A', 'a', 'C', 'a,A,E1', '', 'O']
    const first = masks.map(m => compileTargetMask(m))
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < masks.length; i++) {
        expect(compileTargetMask(masks[i])).toBe(first[i])
        expect(compileTargetMask([...masks[i]].join(''))).toBe(first[i]) // autre objet chaîne, même contenu
        expect(compileTargetMask(masks[(i + 3) % masks.length])).toBe(first[(i + 3) % masks.length])
      }
    }
  })
})
