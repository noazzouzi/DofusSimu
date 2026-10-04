import { describe, expect, it } from 'vitest'
import { CELL_COUNT, cellToPoint, distance, inLine, neighbors, pointToCell } from '../src/map/geometry'

describe('géométrie de carte', () => {
  it('a 560 cellules et des coordonnées bijectives', () => {
    expect(CELL_COUNT).toBe(560)
    for (let c = 0; c < CELL_COUNT; c++) {
      const p = cellToPoint(c)
      expect(pointToCell(p.x, p.y)).toBe(c)
    }
  })

  it('les voisines sont à distance 1 (cellule 0 en coin : 2 voisines, cellule centrale : 4)', () => {
    expect(neighbors(0).sort((a, b) => a - b)).toEqual([14])
    const center = 14 * 20 + 7
    const ns = neighbors(center)
    expect(ns.length).toBe(4)
    for (const n of ns) expect(distance(center, n)).toBe(1)
  })

  it('la cellule 14 (début de demi-ligne décalée) est adjacente à 0 et 1', () => {
    expect(distance(14, 0)).toBe(1)
    expect(distance(14, 1)).toBe(1)
    expect(inLine(14, 0)).toBe(true)
  })
})
