import { describe, expect, it } from 'vitest'
import vortexMap from '../data/maps/143393281.json'
import { CELL_COUNT, distance, neighborsOf, pointToCell } from '../src/map/geometry'
import {
  GridSearch,
  UNREACHABLE,
  bfsDistances,
  cellsWithinMp,
  pathLength,
  pathToAdjacent,
  pathToNearest,
  shortestPath,
  walkableMask,
} from '../src/map/path'

const all = () => true
const at = pointToCell

/** Vérifie qu'un chemin est une suite de pas orthogonaux sur des cellules franchissables. */
function expectValidPath(path: number[], from: number, to: number, passable: (c: number) => boolean) {
  expect(path[0]).toBe(from)
  expect(path[path.length - 1]).toBe(to)
  for (let i = 1; i < path.length; i++) {
    expect(distance(path[i - 1], path[i])).toBe(1)
    if (i < path.length) expect(passable(path[i])).toBe(true)
  }
}

describe('chemins : carte vide', () => {
  it('BFS 4-connexe = distance de Manhattan entre toutes les cellules (carte convexe)', () => {
    const search = new GridSearch()
    for (const start of [0, 13, 14, 300, 546, 559]) {
      expect(search.run(start, all)).toBe(CELL_COUNT)
      for (let c = 0; c < CELL_COUNT; c++) expect(search.dist[c]).toBe(distance(start, c))
      expect(search.prev[start]).toBe(-1)
      expect(search.order[0]).toBe(start)
    }
  })

  it('shortestPath : longueur = distance, pas orthogonaux, départ = arrivée', () => {
    for (const [a, b] of [
      [0, 559],
      [300, 215],
      [14, 1],
      [546, 13],
    ]) {
      const p = shortestPath(a, b, all)!
      expect(p.length - 1).toBe(distance(a, b))
      expectValidPath(p, a, b, all)
      expect(pathLength(a, b, all)).toBe(distance(a, b))
    }
    expect(shortestPath(300, 300, all)).toEqual([300])
    expect(pathLength(300, 300, all)).toBe(0)
    expect(shortestPath(-1, 3, all)).toBeNull()
    expect(shortestPath(3, 560, all)).toBeNull()
    expect(pathLength(3, 560, all)).toBe(UNREACHABLE)
  })

  it('cellsWithinMp : losange de rayon PM (départ exclu), triées par distance', () => {
    const c = at(17, -4)
    const r3 = cellsWithinMp(c, 3, all)
    expect(r3.length).toBe(24) // 2·3·(3+1)
    expect(r3).not.toContain(c)
    for (let i = 1; i < r3.length; i++) expect(distance(c, r3[i - 1])).toBeLessThanOrEqual(distance(c, r3[i]))
    expect(r3.every(x => distance(c, x) <= 3)).toBe(true)
    expect(cellsWithinMp(c, 0, all)).toEqual([])
    expect(cellsWithinMp(c, -2, all)).toEqual([])
  })

  it('bfsDistances : copie dans un tampon fourni ou nouveau', () => {
    const out = new Int16Array(CELL_COUNT)
    const res = bfsDistances(300, all, 2, out)
    expect(res).toBe(out)
    expect(out[300]).toBe(0)
    expect(out[at(19, -4)]).toBe(2)
    expect(out[at(20, -4)]).toBe(UNREACHABLE) // au-delà de maxSteps
    const fresh = bfsDistances(300, all)
    expect(fresh).not.toBe(out)
    expect(fresh[at(20, -4)]).toBe(3)
  })
})

describe('chemins : obstacles et occupation', () => {
  // Mur vertical x = 18 pour y ∈ [−8, 0] : il faut le contourner.
  const wall = new Set<number>()
  for (let y = -8; y <= 0; y++) wall.add(at(18, y))
  const passable = (c: number) => !wall.has(c)

  it('contourne un mur ; le chemin ne traverse jamais une cellule bloquée', () => {
    const a = at(16, -4)
    const b = at(20, -4)
    const p = shortestPath(a, b, passable)!
    expectValidPath(p, a, b, passable)
    expect(p.some(c => wall.has(c))).toBe(false)
    // Détour minimal : passer à y = 1 ou y = −9 (5 au-dessus / en dessous de y = −4).
    expect(p.length - 1).toBe(4 + 2 * 5)
  })

  it('cible infranchissable : null, sauf allowBlockedTarget (aller « vers » une entité)', () => {
    const a = at(16, -4)
    const target = at(18, -4)
    expect(shortestPath(a, target, passable)).toBeNull()
    const p = shortestPath(a, target, passable, { allowBlockedTarget: true })!
    expect(p).toEqual([a, at(17, -4), target])
    expect(pathLength(a, target, passable, { allowBlockedTarget: true })).toBe(2)
  })

  it('maxSteps limite la recherche', () => {
    expect(shortestPath(at(16, -4), at(20, -4), passable, { maxSteps: 10 })).toBeNull()
    expect(shortestPath(at(16, -4), at(20, -4), passable, { maxSteps: 14 })).not.toBeNull()
  })

  it('cellule enfermée : inaccessible', () => {
    const c = at(17, -4)
    const ring = new Set(neighborsOf(c))
    const p = (x: number) => !ring.has(x)
    expect(cellsWithinMp(c, 6, p)).toEqual([])
    expect(shortestPath(c, at(10, -4), p)).toBeNull()
    expect(bfsDistances(c, p)[at(10, -4)]).toBe(UNREACHABLE)
  })

  it('pathToAdjacent / pathToNearest', () => {
    const a = at(16, -4)
    const enemy = at(20, -4)
    const p = pathToAdjacent(a, enemy, c => c !== enemy)!
    expect(distance(p[p.length - 1], enemy)).toBe(1)
    expect(p.length - 1).toBe(3)
    expect(pathToAdjacent(at(19, -4), enemy, all)).toEqual([at(19, -4)])
    expect(pathToAdjacent(a, -1, all)).toBeNull()
    const goal = pathToNearest(a, c => c === at(16, 0), all)!
    expect(goal.length - 1).toBe(4)
    expect(pathToNearest(a, () => false, all)).toBeNull()
    expect(pathToNearest(-3, all, all)).toBeNull()
  })

  it('GridSearch.reached / pathTo après une recherche', () => {
    const s = new GridSearch()
    s.run(at(17, -4), passable, 2)
    expect(s.reached(1, 1).length).toBe(3) // le voisin x = 18 est un mur
    expect(s.reached(2, 2).every(c => s.dist[c] === 2)).toBe(true)
    expect(s.pathTo(at(17, -2))).toEqual([at(17, -4), at(17, -3), at(17, -2)])
    expect(s.pathTo(at(18, -4))).toBeNull()
    expect(s.pathTo(-1)).toBeNull()
    expect(s.run(-1, all)).toBe(0)
    expect(s.count).toBe(0)
  })
})

describe('chemins : salle du Vortex', () => {
  const map = vortexMap as { cells: { id: number; walkable: boolean }[]; redCells: number[]; blueCells: number[] }
  const walk = walkableMask(map.cells)
  const passable = (c: number) => walk[c] === 1

  it('toutes les cases marchables sont connexes ; distances rouges ↔ bleues 11 à 15 PM (maps.md)', () => {
    const walkable = map.cells.filter(c => c.walkable).map(c => c.id)
    const d = bfsDistances(walkable[0], passable)
    expect(walkable.every(c => d[c] >= 0)).toBe(true)
    let min = Infinity
    let max = -Infinity
    for (const r of map.redCells) {
      const dr = bfsDistances(r, passable)
      for (const b of map.blueCells) {
        min = Math.min(min, dr[b])
        max = Math.max(max, dr[b])
      }
    }
    expect(min).toBe(11)
    expect(max).toBe(15)
  })

  it('l’obstacle central impose un détour (chemin > distance de Manhattan)', () => {
    const a = at(17, -5)
    const b = at(21, -5)
    expect(distance(a, b)).toBe(4)
    const p = shortestPath(a, b, passable)!
    expectValidPath(p, a, b, passable)
    expect(p.length - 1).toBeGreaterThan(4)
  })

  it('occupation dynamique : un combattant bloque le passage', () => {
    const occupied = new Set([at(17, -4)])
    const p = shortestPath(at(16, -4), at(18, -4), c => passable(c) && !occupied.has(c))
    expect(p).not.toBeNull()
    expect(p!.includes(at(17, -4))).toBe(false)
  })
})
