/**
 * T-reach (docs/design/ai.md §16.1) : `computeReach` contre `move` réel (tacle compris) sur de vraies cartes, et contre
 * une recherche exhaustive des chemins (ensemble des cases atteignables, meilleur couple PA/PM). Vue honnête :
 * invisibles adverses, pièges cachés, cases-événements.
 */
import { describe, expect, it } from 'vitest'
import { computeReach, createView, observeVisibility, reachPath, sanitizeForTeam, simClone, STATE_INVISIBLE } from '../src/ai/core'
import { Rng } from '../src/core/rng'
import { escapeRatio, move } from '../src/engine/move'
import { apMpAfterTackle } from '../src/damage/tackle'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'
import { neighborsOf } from '../src/map/geometry'
import { BREEDS, engineFor, makeFight, mapOf, MAP_IDS, monster, pickCells, player, VORTEX_MONSTERS } from './ai-core-helpers'

/** Scène de tacle : un marcheur, des ennemis (tacleurs aux tacles tirés) et des alliés, sur une carte réelle. */
function tackleScene(rng: Rng, seed: number): { engine: Engine; fight: FightState; mover: Fighter } {
  const engine = engineFor()
  const mapId = MAP_IDS[seed % MAP_IDS.length]
  const map = mapOf(mapId)
  const nE = 1 + Math.floor(rng.next() * 5)
  const nA = Math.floor(rng.next() * 3)
  // Fenêtre compacte : contacts fréquents.
  const all = pickCells(rng, map, 1)
  const center = all[0]
  const near = map.cells.filter(c => c.walkable && Math.abs(c.id - center) < 60).map(c => c.id)
  const cells: number[] = []
  while (cells.length < 1 + nE + nA && near.length) {
    const i = Math.floor(rng.next() * near.length)
    cells.push(near.splice(i, 1)[0])
  }
  const mover = player(BREEDS.cra, { cell: cells[0] })
  const fighters: Fighter[] = [mover]
  for (let i = 0; i < nE && 1 + i < cells.length; i++) fighters.push(monster(VORTEX_MONSTERS[i % 5], cells[1 + i]))
  for (let i = 0; i < nA && 1 + nE + i < cells.length; i++) fighters.push(player(BREEDS.iop, { cell: cells[1 + nE + i] }))
  const fight = makeFight(engine, mapId, fighters, { seed })
  const m = fight.fighters[0]
  const evade = Math.floor(rng.next() * 60)
  m.stats.tackleEvade = evade
  m.ap = 6 + Math.floor(rng.next() * 7)
  m.mp = 1 + Math.floor(rng.next() * 7)
  for (const f of fight.fighters) {
    if (f.team === m.team) continue
    f.stats.tackleBlock = Math.floor(rng.next() * 120)
    if (rng.next() < 0.15) f.tags.cantTackle = true
  }
  return { engine, fight, mover: m }
}

/** Recherche exhaustive (DFS, élagage de Pareto) des couples (PA, PM) atteignables par case, sémantique de `move`. */
function exhaustive(engine: Engine, fight: FightState, f: Fighter): Map<number, [number, number][]> {
  const front = new Map<number, [number, number][]>()
  const start = f.cell
  const add = (c: number, ap: number, mp: number): boolean => {
    const list = front.get(c) ?? []
    if (list.some(([a, m]) => a >= ap && m >= mp)) return false
    front.set(c, [...list.filter(([a, m]) => !(ap >= a && mp >= m)), [ap, mp]])
    return true
  }
  const walk = (c: number, ap: number, mp: number) => {
    if (mp <= 0) return
    f.cell = c
    const ratio = escapeRatio(fight, f, engine)
    let ap2 = ap
    let mp2 = mp
    if (ratio < 1) {
      ap2 = apMpAfterTackle(ap, ratio)
      mp2 = apMpAfterTackle(mp, ratio)
    }
    if (mp2 <= 0) return
    for (const n of neighborsOf(c)) {
      f.cell = c
      if (!engine.isCellFree(fight, n)) continue
      if (add(n, ap2, mp2 - 1)) walk(n, ap2, mp2 - 1)
    }
    f.cell = c
  }
  add(start, f.ap, f.mp)
  walk(start, f.ap, f.mp)
  f.cell = start
  return front
}

describe('T-reach : computeReach = move réel (tacle exact)', () => {
  it('500 cas aléatoires : PA/PM restants identiques après exécution du chemin (priorités PM et PA)', () => {
    const rng = new Rng(20261004)
    let checked = 0
    let tackledPaths = 0
    for (let k = 0; k < 500; k++) {
      const { engine, fight, mover } = tackleScene(rng, k)
      const view = createView(engine, fight, mover, 1)
      for (const priority of ['mp', 'ap'] as const) {
        const reach = computeReach(view, fight, mover, { priority })
        expect(reach.count).toBeGreaterThan(0)
        expect(reach.cells[0]).toBe(mover.cell)
        // Jusqu'à 4 cases tirées parmi les atteignables (plus la plus lointaine).
        const picks = new Set<number>([reach.cells[reach.count - 1]])
        for (let i = 0; i < 3; i++) picks.add(reach.cells[Math.floor(rng.next() * reach.count)])
        for (const cell of picks) {
          const path = reachPath(reach, mover.cell, cell)!
          expect(path[0]).toBe(mover.cell)
          const c = engine.cloneFight(fight)
          const m = c.fighters[mover.id]
          const ap0 = m.ap
          const steps = move(c, m, path, engine)
          expect(steps).toBe(path.length - 1)
          expect(m.cell).toBe(cell)
          expect(m.ap).toBe(reach.apLeft[cell])
          expect(m.mp).toBe(reach.mpLeft[cell])
          if (m.ap < ap0) tackledPaths++
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(3000)
    // Le corpus exerce vraiment le tacle.
    expect(tackledPaths).toBeGreaterThan(200)
  })

  it('priorité PM : ensemble des cases = recherche exhaustive, PM maximaux exacts, PA optimaux parmi ces chemins', () => {
    const rng = new Rng(77)
    let cells = 0
    let optimalAp = 0
    let apFirstCells = 0
    let apFirstOptimal = 0
    let apFirstMissing = 0
    for (let k = 0; k < 150; k++) {
      const { engine, fight, mover } = tackleScene(rng, 1000 + k)
      mover.mp = Math.min(mover.mp, 5)
      const view = createView(engine, fight, mover, 1)
      const reach = computeReach(view, fight, mover)
      const reachAp = computeReach(view, fight, mover, { priority: 'ap' })
      const ref = exhaustive(engine, engine.cloneFight(fight), engine.cloneFight(fight).fighters[mover.id])
      const got = new Set(Array.from(reach.cells.subarray(0, reach.count)))
      expect(got).toEqual(new Set(ref.keys()))
      for (const [c, list] of ref) {
        const maxMp = Math.max(...list.map(x => x[1]))
        const maxApAtMaxMp = Math.max(...list.filter(x => x[1] === maxMp).map(x => x[0]))
        expect(reach.mpLeft[c]).toBe(maxMp)
        cells++
        if (reach.apLeft[c] === maxApAtMaxMp) optimalAp++
        // Priorité PA : sous-ensemble, PA maximaux du front dans la quasi-totalité des cas.
        if (reachAp.mpLeft[c] < 0) {
          apFirstMissing++
          continue
        }
        const maxAp = Math.max(...list.map(x => x[0]))
        apFirstCells++
        if (reachAp.apLeft[c] === maxAp) apFirstOptimal++
      }
      for (let i = 0; i < reachAp.count; i++) expect(ref.has(reachAp.cells[i])).toBe(true)
    }
    expect(optimalAp / cells).toBeGreaterThan(0.995)
    expect(apFirstOptimal / apFirstCells).toBeGreaterThan(0.99)
    // Le corpus (tacles extrêmes) contient des cases qu'un arbre « PA d'abord » ne voit pas : d'où la priorité PM.
    expect(apFirstMissing).toBeGreaterThan(0)
  })

  it('0 PM : seule la case actuelle ; PM fractionnaires : chemins sur ⌊PM⌋', () => {
    const { engine, fight, mover } = tackleScene(new Rng(5), 5)
    const view = createView(engine, fight, mover, 1)
    expect(computeReach(view, fight, mover, { mp: 0 }).count).toBe(1)
    const r = computeReach(view, fight, mover, { mp: 2.9 })
    for (let i = 0; i < r.count; i++) expect(r.mpLeft[r.cells[i]]).toBeGreaterThanOrEqual(0)
    expect(r.mpLeft[mover.cell]).toBe(2)
  })
})

describe('vue honnête (§6.1)', () => {
  it('invisible adverse : dernière case connue dans la vue, l’accessibilité et les clones ; jamais sa vraie case', () => {
    const engine = engineFor()
    const map = mapOf(MAP_IDS[1])
    const cells = pickCells(new Rng(3), map, 3)
    const cra = player(BREEDS.cra, { cell: cells[0] })
    const sram = player(BREEDS.sram, { cell: cells[1], team: 1 })
    const fight = makeFight(engine, map.id, [cra, sram])
    observeVisibility(fight)
    const s = fight.fighters[1]
    expect(s.tags.aiLastSeen).toBe(cells[1])
    // Le Sram devient invisible puis se déplace : la vue de l'adversaire garde l'ancienne case.
    const effect = { ...engine.data.spellLevel(13141, { grade: 1 })!.effects[0], effectId: 950, value: STATE_INVISIBLE }
    engine.addBuff(fight, s, { sourceId: s.id, spellId: 0, effect, value: STATE_INVISIBLE, stateId: STATE_INVISIBLE, remaining: 3, delay: 0, dispellable: true, label: 'inv' })
    s.cell = cells[2]
    observeVisibility(fight)
    const view = createView(engine, fight, fight.fighters[0], 9)
    const seen = view.visible().find(f => f.id === s.id)!
    expect(seen.cell).toBe(cells[1])
    expect(createView(engine, fight, s, 9).visible().find(f => f.id === s.id)!.cell).toBe(cells[2])
    const c = simClone(view, fight, 1)
    expect(c.fighters[s.id].cell).toBe(cells[1])
    expect(fight.fighters[s.id].cell).toBe(cells[2])
    // L'accessibilité du Crâ ne contourne pas la vraie case (inconnue) du Sram.
    const reach = computeReach(view, fight, fight.fighters[0], { mp: 30 })
    expect(reach.mpLeft[cells[2]]).toBeGreaterThanOrEqual(0)
    expect(reach.mpLeft[cells[1]]).toBe(-1)
  })

  it('pièges : invisibles adverses retirés des clones ; pièges connus = cases-événements terminales', () => {
    const engine = engineFor()
    const map = mapOf(MAP_IDS[2])
    const [a, b] = pickCells(new Rng(11), map, 2)
    const cra = player(BREEDS.cra, { cell: a })
    const enemy = monster(3838, b)
    const fight = makeFight(engine, map.id, [cra, enemy])
    const trapCell = neighborsOf(a).find(n => map.cells[n]?.walkable && n !== b)!
    fight.traps.push({ uid: 900, sourceId: 1, spellId: 0, center: trapCell, cells: [trapCell], effects: [], visible: false, color: '', team: 1 })
    const view = createView(engine, fight, fight.fighters[0], 1)
    expect(view.knownTraps()).toHaveLength(0)
    expect(simClone(view, fight, 1).traps).toHaveLength(0)
    expect(fight.traps).toHaveLength(1)
    // Piège adverse caché : l'IA ne le voit pas, la case est librement traversable dans sa vue.
    expect(computeReach(view, fight, fight.fighters[0]).mpLeft[trapCell]).toBeGreaterThanOrEqual(0)
    // Piège visible : contourné ; admis seulement comme case terminale.
    fight.traps[0].visible = true
    const r1 = computeReach(view, fight, fight.fighters[0])
    expect(r1.mpLeft[trapCell]).toBe(-1)
    const r2 = computeReach(view, fight, fight.fighters[0], { allowEventCells: new Set([trapCell]) })
    expect(r2.mpLeft[trapCell]).toBeGreaterThanOrEqual(0)
    expect(r2.viaEvent[trapCell]).toBe(1)
    for (let i = 0; i < r2.count; i++) expect(r2.prev[r2.cells[i]]).not.toBe(trapCell)
    const s2 = engine.cloneFight(fight)
    sanitizeForTeam(s2, 0)
    expect(s2.traps).toHaveLength(1)
  })
})
