import { describe, expect, it } from 'vitest'
import geo from '../data/research/map-geometry.json'
import {
  CARDINAL_DIRECTIONS,
  CELL_COUNT,
  CELL_X,
  CELL_Y,
  DIRECTION_DX,
  DIRECTION_DY,
  DIRECTIONS,
  ORTHOGONAL_DIRECTIONS,
  areAdjacent,
  cellInDirection,
  cellToPoint,
  cellsBetween,
  cellsInDirection,
  chebyshevDistance,
  diagonalNeighborsOf,
  directionBetween,
  distance,
  inDiagonal,
  inLine,
  isCardinal,
  isOrthogonal,
  isValidCell,
  isValidPoint,
  lookDirection4,
  lookDirection8,
  neighbors,
  neighborsOf,
  oppositeDirection,
  pointToCell,
  rotateDirection,
} from '../src/map/geometry'

interface CellExample {
  cellId: number
  row: number
  col: number
  x: number
  y: number
  neighbors4: Record<string, number>
  diagonals: Record<string, number>
}

const examples = geo.cellExamples as CellExample[]

describe('géométrie : repère logique (map-geometry.json)', () => {
  it('560 cellules, bijection cellId <-> (x, y), bornes documentées', () => {
    expect(CELL_COUNT).toBe(geo.constants.CELL_COUNT)
    const [xmin, xmax] = geo.constants.X_RANGE
    const [ymin, ymax] = geo.constants.Y_RANGE
    for (let c = 0; c < CELL_COUNT; c++) {
      const p = cellToPoint(c)
      expect(pointToCell(p.x, p.y)).toBe(c)
      expect(p.x).toBe(CELL_X[c])
      expect(p.y).toBe(CELL_Y[c])
      expect(p.x).toBeGreaterThanOrEqual(xmin)
      expect(p.x).toBeLessThanOrEqual(xmax)
      expect(p.y).toBeGreaterThanOrEqual(ymin)
      expect(p.y).toBeLessThanOrEqual(ymax)
      // Formules du document : x = col + ceil(row/2), y = col − floor(row/2), x − y = row, x + y = 2·col + row%2.
      const row = Math.floor(c / 14)
      const col = c % 14
      expect(p.x).toBe(col + Math.ceil(row / 2))
      expect(p.y).toBe(col - Math.floor(row / 2))
      expect(p.x - p.y).toBe(row)
      expect(p.x + p.y).toBe(2 * col + (row % 2))
      expect(isValidPoint(p.x, p.y)).toBe(true)
    }
  })

  it('pointToCell : −1 hors carte (y compris non entiers), isValidPoint cohérent', () => {
    let valid = 0
    for (let x = -5; x <= 40; x++)
      for (let y = -25; y <= 20; y++) {
        const c = pointToCell(x, y)
        const inMap = x + y >= 0 && x + y <= 27 && x - y >= 0 && x - y <= 39
        expect(c >= 0).toBe(inMap)
        expect(isValidPoint(x, y)).toBe(inMap)
        if (inMap) valid++
      }
    expect(valid).toBe(CELL_COUNT)
    expect(pointToCell(1.5, 0)).toBe(-1)
    expect(pointToCell(Number.NaN, 0)).toBe(-1)
    expect(isValidCell(0)).toBe(true)
    expect(isValidCell(559)).toBe(true)
    expect(isValidCell(560)).toBe(false)
    expect(isValidCell(-1)).toBe(false)
    expect(isValidCell(1.5)).toBe(false)
  })

  it('les 10 cellules d’exemple : coordonnées, voisins (1/3/5/7) et diagonales (0/2/4/6)', () => {
    for (const ex of examples) {
      const p = cellToPoint(ex.cellId)
      expect([p.x, p.y], `cellule ${ex.cellId}`).toEqual([ex.x, ex.y])
      for (const [key, expected] of [...Object.entries(ex.neighbors4), ...Object.entries(ex.diagonals)]) {
        const dir = Number(key.split('_')[0])
        expect(cellInDirection(ex.cellId, dir), `cellule ${ex.cellId}, direction ${dir}`).toBe(expected)
      }
      const ns = Object.values(ex.neighbors4).filter(n => n >= 0)
      expect(neighbors(ex.cellId).sort((a, b) => a - b)).toEqual(ns.sort((a, b) => a - b))
      const ds = Object.values(ex.diagonals).filter(n => n >= 0)
      expect([...diagonalNeighborsOf(ex.cellId)].sort((a, b) => a - b)).toEqual(ds.sort((a, b) => a - b))
    }
  })

  it('distances d’exemple et alignements', () => {
    for (const ex of geo.distanceExamples) {
      expect(distance(ex.a, ex.b), `${ex.a}-${ex.b}`).toBe(ex.distance)
      expect(inLine(ex.a, ex.b)).toBe(ex.inLine)
      expect(inDiagonal(ex.a, ex.b)).toBe(ex.inDiagonal)
    }
    expect(distance(100, 300)).toBe(14)
    expect(distance(215, 300)).toBe(6)
    expect(chebyshevDistance(215, 300)).toBe(4)
    expect(areAdjacent(14, 0)).toBe(true)
    expect(areAdjacent(14, 15)).toBe(false) // diagonale logique : distance 2
  })
})

describe('géométrie : directions', () => {
  it('vecteurs des 8 directions (DirectionsEnum) et parité', () => {
    const list = geo.directions.list
    for (const d of list) {
      expect([DIRECTION_DX[d.id], DIRECTION_DY[d.id]]).toEqual(d.dxdy)
      expect(isOrthogonal(d.id)).toBe(d.orthogonal)
      expect(isCardinal(d.id)).toBe(!d.orthogonal)
    }
    expect(ORTHOGONAL_DIRECTIONS).toEqual([1, 3, 5, 7])
    expect(CARDINAL_DIRECTIONS).toEqual([0, 2, 4, 6])
    expect(isOrthogonal(-1)).toBe(false)
    expect(isCardinal(8)).toBe(false)
    for (let d = 0; d < 8; d++) {
      expect(oppositeDirection(d)).toBe((d + 4) % 8)
      expect(DIRECTION_DX[oppositeDirection(d)] + DIRECTION_DX[d]).toBe(0)
      expect(DIRECTION_DY[oppositeDirection(d)] + DIRECTION_DY[d]).toBe(0)
      expect(rotateDirection(d, 8)).toBe(d)
      expect(rotateDirection(d, -1)).toBe((d + 7) % 8)
    }
  })

  it('offsets de cellId par parité de ligne (toujours validés par (x, y))', () => {
    for (const d of geo.directions.list) {
      for (let c = 0; c < CELL_COUNT; c++) {
        const n = cellInDirection(c, d.id)
        const row = Math.floor(c / 14)
        const offset = row % 2 === 0 ? d.cellIdOffset.evenRow : d.cellIdOffset.oddRow
        if (n >= 0) expect(n, `cellule ${c} direction ${d.id}`).toBe(c + offset)
        else {
          const p = cellToPoint(c)
          expect(isValidPoint(p.x + d.dxdy[0], p.y + d.dxdy[1])).toBe(false)
        }
      }
    }
  })

  it('directionBetween = GetLookDirection8Exact (−1 si non aligné ou même cellule)', () => {
    const c = pointToCell(17, -4)
    for (let d = 0; d < 8; d++)
      for (let k = 1; k <= 3; k++) {
        const t = cellInDirection(c, d, k)
        expect(directionBetween(c, t)).toBe(d)
        expect(directionBetween(t, c)).toBe(oppositeDirection(d))
      }
    expect(directionBetween(c, c)).toBe(-1)
    expect(directionBetween(c, pointToCell(19, -3))).toBe(-1)
    // Le document : en ligne → impaire, en diagonale → paire.
    for (let a = 0; a < CELL_COUNT; a += 7)
      for (let b = 0; b < CELL_COUNT; b += 11) {
        const dir = directionBetween(a, b)
        if (a === b) continue
        if (inLine(a, b)) expect(dir % 2).toBe(1)
        else if (inDiagonal(a, b)) expect(dir % 2).toBe(0)
        else expect(dir).toBe(-1)
      }
  })

  it('lookDirection4 (GetLookDirection4) : axe dominant, égalité → axe y', () => {
    const c = pointToCell(17, -4)
    expect(lookDirection4(c, pointToCell(20, -3))).toBe(1)
    expect(lookDirection4(c, pointToCell(14, -3))).toBe(5)
    expect(lookDirection4(c, pointToCell(18, -1))).toBe(7)
    expect(lookDirection4(c, pointToCell(16, -8))).toBe(3)
    expect(lookDirection4(c, pointToCell(19, -2))).toBe(7) // |dx| = |dy| → axe y
    expect(lookDirection4(c, pointToCell(19, -6))).toBe(3)
    expect(lookDirection4(c, c)).toBe(3) // comme le port
  })

  it('lookDirection8 : exacte si alignée, sinon octant (GetLookDirection8)', () => {
    const c = pointToCell(17, -4)
    expect(lookDirection8(c, pointToCell(20, -4))).toBe(1)
    expect(lookDirection8(c, pointToCell(19, -2))).toBe(0)
    // Port : |dx| ≥ |dy| et dx > 0 → 0 si dy > 0, sinon 1 (découpage du port, pas un octant symétrique).
    expect(lookDirection8(c, pointToCell(20, -3))).toBe(0)
    expect(lookDirection8(c, pointToCell(20, -5))).toBe(1)
    expect(lookDirection8(c, pointToCell(18, -1))).toBe(7) // |dx| < |dy|, dy > 0, dx ≥ 0
    expect(lookDirection8(c, pointToCell(16, -1))).toBe(6) // |dx| < |dy|, dy > 0, dx < 0
    expect(lookDirection8(c, pointToCell(16, -7))).toBe(3)
    expect(lookDirection8(c, pointToCell(18, -7))).toBe(2)
    expect(lookDirection8(c, pointToCell(14, -5))).toBe(4)
    expect(lookDirection8(c, pointToCell(14, -3))).toBe(5)
    expect(lookDirection8(c, c)).toBe(-1)
  })
})

describe('géométrie : déplacements de cellule', () => {
  it('cellInDirection avec plusieurs pas, cellsInDirection s’arrête au bord', () => {
    expect(cellInDirection(0, 1, 2)).toBe(pointToCell(2, 0))
    expect(cellInDirection(0, 5)).toBe(-1)
    expect(cellInDirection(0, 9)).toBe(-1)
    expect(cellInDirection(-1, 1)).toBe(-1)
    const ray = cellsInDirection(0, 1, 100)
    expect(ray.length).toBe(27) // (0,0) → (27,0) : x + y ≤ 27
    ray.forEach((c, i) => expect(cellToPoint(c)).toEqual({ x: i + 1, y: 0 }))
    expect(cellsInDirection(0, 1, 3)).toEqual([pointToCell(1, 0), pointToCell(2, 0), pointToCell(3, 0)])
  })

  it('cellsBetween : cellules strictement entre deux cellules alignées', () => {
    const a = pointToCell(17, -4)
    expect(cellsBetween(a, pointToCell(21, -4))).toEqual([pointToCell(18, -4), pointToCell(19, -4), pointToCell(20, -4)])
    expect(cellsBetween(a, pointToCell(19, -6))).toEqual([pointToCell(18, -5)])
    expect(cellsBetween(a, pointToCell(18, -4))).toEqual([])
    expect(cellsBetween(a, pointToCell(19, -3))).toEqual([])
  })

  it('voisins : 4 au maximum, à distance 1, ordre fixe SE/NW/NE/SW, version partagée identique', () => {
    expect(DIRECTIONS.map(d => [d.x, d.y])).toEqual([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
    for (let c = 0; c < CELL_COUNT; c++) {
      const ns = neighbors(c)
      expect(ns).toEqual([...neighborsOf(c)])
      expect(ns.length).toBeLessThanOrEqual(4)
      for (const n of ns) expect(distance(c, n)).toBe(1)
      // La copie renvoyée est indépendante du cache.
      ns.reverse()
      expect(neighbors(c)).toEqual([...neighborsOf(c)])
    }
    expect(Object.isFrozen(neighborsOf(0))).toBe(true)
    expect(Object.isFrozen(cellToPoint(0))).toBe(true)
  })
})
