import { describe, expect, it } from 'vitest'
import geo from '../data/research/map-geometry.json'
import vortexMap from '../data/maps/143393281.json'
import { CELL_COUNT, CELL_X, CELL_Y, cellToPoint, distance, inDiagonal, pointToCell } from '../src/map/geometry'
import { hasLineOfSight, hasLineOfSightOnMap, lineCells, losCells, losLine, opaqueCells, traceLine } from '../src/map/los'

// ───────────── Oracle indépendant : géométrie exacte (fractions entières) ─────────────
// Une cellule (i, j) est traversée si le segment ouvert entre les centres coupe l'INTÉRIEUR de son carré
// unité centré sur (i, j) ; un simple contact par un coin ne compte pas (règle du client). Avec des extrémités
// entières, aucun passage « presque exact » par un coin n'existe (écart ≥ 1/78 en unités de progression),
// donc l'oracle exact doit coïncider avec le DDA du client (tolérance 1e-4).

type Frac = [number, number] // numérateur, dénominateur > 0
const lt = (a: Frac, b: Frac) => a[0] * b[1] < b[0] * a[1]
const frac = (n: number, d: number): Frac => (d < 0 ? [-n, -d] : [n, d])

function oracleLine(a: number, b: number): number[] {
  const ax = CELL_X[a]
  const ay = CELL_Y[a]
  const dx = CELL_X[b] - ax
  const dy = CELL_Y[b] - ay
  const crossed: { cell: number; entry: Frac }[] = []
  for (let i = Math.min(0, dx); i <= Math.max(0, dx); i++)
    for (let j = Math.min(0, dy); j <= Math.max(0, dy); j++) {
      if (i === 0 && j === 0) continue
      let lo: Frac = [0, 1]
      let hi: Frac = [1, 1]
      let ok = true
      for (const [k, dk] of [
        [i, dx],
        [j, dy],
      ]) {
        if (dk === 0) {
          if (k !== 0) ok = false
          continue
        }
        let l = frac(2 * k - 1, 2 * dk)
        let h = frac(2 * k + 1, 2 * dk)
        if (lt(h, l)) [l, h] = [h, l]
        if (lt(lo, l)) lo = l
        if (lt(h, hi)) hi = h
      }
      if (ok && lt(lo, hi)) crossed.push({ cell: pointToCell(ax + i, ay + j), entry: lo })
    }
  crossed.sort((p, q) => (lt(p.entry, q.entry) ? -1 : lt(q.entry, p.entry) ? 1 : 0))
  return crossed.map(c => c.cell)
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('LdV : tracé du client (GetCellsIdBetween)', () => {
  it('exemples du document (map-geometry.json#lineOfSight.examples) — ordre exact', () => {
    for (const ex of geo.lineOfSight.examples) {
      expect(losCells(ex.from, ex.to), `${ex.from} -> ${ex.to}`).toEqual(ex.lineCells)
      expect(distance(ex.from, ex.to)).toBe(ex.distance)
      expect(inDiagonal(ex.from, ex.to)).toBe(ex.inDiagonal)
    }
  })

  it('exemples de mechanics.md §3 : cellules intermédiaires puis cible', () => {
    expect(lineCells(215, 300)).toEqual([230, 243, 258, 272, 286])
    expect(lineCells(200, 241)).toEqual([213, 228])
    expect(lineCells(129, 213)).toEqual([157, 185])
    expect(losCells(129, 213).at(-1)).toBe(213)
  })

  it('cas limites : même cellule, cellules adjacentes, identifiants invalides', () => {
    expect(losCells(100, 100)).toEqual([])
    expect(lineCells(100, 100)).toEqual([])
    expect(losCells(0, 14)).toEqual([14])
    expect(lineCells(0, 14)).toEqual([])
    expect(losCells(-1, 3)).toEqual([])
    expect(losCells(3, 560)).toEqual([])
    expect(traceLine(5, 5)).toEqual([])
  })

  it('le tracé reste toujours sur la carte et chaque pas est orthogonal ou diagonal (toutes les paires)', () => {
    let total = 0
    for (let a = 0; a < CELL_COUNT; a++)
      for (let b = 0; b < CELL_COUNT; b++) {
        if (a === b) continue
        const line = losLine(a, b)
        // Longueur : entre max(|dx|,|dy|) (diagonale pure) et |dx|+|dy| (aucun passage par un coin).
        const adx = Math.abs(CELL_X[b] - CELL_X[a])
        const ady = Math.abs(CELL_Y[b] - CELL_Y[a])
        if (line.length < Math.max(adx, ady) || line.length > adx + ady) throw new Error(`longueur ${a}->${b}`)
        if (line[line.length - 1] !== b) throw new Error(`fin ${a}->${b}`)
        let prev = a
        for (let i = 0; i < line.length; i++) {
          const c = line[i]
          if (c < 0 || c >= CELL_COUNT) throw new Error(`hors carte ${a}->${b}`)
          const sx = Math.abs(CELL_X[c] - CELL_X[prev])
          const sy = Math.abs(CELL_Y[c] - CELL_Y[prev])
          if (sx > 1 || sy > 1 || sx + sy === 0) throw new Error(`pas invalide ${a}->${b}`)
          prev = c
        }
        total += line.length
      }
    expect(total).toBeGreaterThan(4_000_000)
  })

  it('symétrie : A→B et B→A testent les mêmes cellules intermédiaires (313 040 paires)', () => {
    let asymmetric = 0
    for (let a = 0; a < CELL_COUNT; a++)
      for (let b = a + 1; b < CELL_COUNT; b++) {
        const ab = lineCells(a, b).sort((x, y) => x - y)
        const ba = lineCells(b, a).sort((x, y) => x - y)
        if (ab.length !== ba.length || ab.some((c, i) => c !== ba[i])) asymmetric++
      }
    expect(asymmetric).toBe(0)
  })

  it('identique à l’oracle géométrique exact (échantillon de 20 000 paires + 3 sources complètes)', () => {
    const rand = rng(42)
    const pairs: [number, number][] = []
    for (let k = 0; k < 20000; k++) pairs.push([Math.floor(rand() * CELL_COUNT), Math.floor(rand() * CELL_COUNT)])
    for (const a of [0, 300, 559]) for (let b = 0; b < CELL_COUNT; b++) pairs.push([a, b])
    for (const [a, b] of pairs) {
      if (a === b) continue
      const got = losCells(a, b)
      const want = oracleLine(a, b)
      if (got.length !== want.length || got.some((c, i) => c !== want[i])) expect(got, `${a} -> ${b}`).toEqual(want)
    }
  })

  it('le cache par source renvoie le même résultat que le tracé direct', () => {
    for (const a of [0, 13, 215, 546])
      for (let b = 0; b < CELL_COUNT; b += 3) expect(losCells(a, b)).toEqual(traceLine(a, b))
  })
})

describe('LdV : règle de visibilité', () => {
  const at = (x: number, y: number) => pointToCell(x, y)

  it('une cellule intermédiaire bloquante masque la cible ; la cible occupée ne bloque pas', () => {
    const a = at(10, -2)
    const b = at(14, -2)
    expect(hasLineOfSight(a, b, () => false)).toBe(true)
    expect(hasLineOfSight(a, b, c => c === at(12, -2))).toBe(false)
    // `blocks` n'est jamais appelé sur la cible ni sur la source.
    const seen: number[] = []
    hasLineOfSight(a, b, c => (seen.push(c), false))
    expect(seen).toEqual([at(11, -2), at(12, -2), at(13, -2)])
    expect(hasLineOfSight(a, b, c => c === b || c === a)).toBe(true)
    // targetBlocks : drapeau los de la cible.
    expect(hasLineOfSight(a, b, () => false, c => c === b)).toBe(false)
    expect(hasLineOfSight(a, a, () => true)).toBe(true)
    expect(hasLineOfSight(a, at(11, -2), () => true)).toBe(true) // adjacent : aucune intermédiaire
  })

  it('passage exact par un coin : les deux cellules latérales ne sont PAS testées', () => {
    // (0,0) → (3,1) passe par le coin (1,5 ; 0,5) : intermédiaires (1,0) et (2,1) seulement.
    const a = at(10, -3)
    const b = at(13, -2)
    expect(lineCells(a, b)).toEqual([at(11, -3), at(12, -2)])
    const laterals = new Set([at(12, -3), at(11, -2)])
    expect(hasLineOfSight(a, b, c => laterals.has(c))).toBe(true)
    // Diagonale parfaite : on voit entre deux obstacles qui se touchent par un coin.
    const d1 = at(10, -3)
    const d2 = at(13, 0)
    expect(lineCells(d1, d2)).toEqual([at(11, -2), at(12, -1)])
    const sides = new Set([at(11, -3), at(10, -2), at(12, -2), at(11, -1)])
    expect(hasLineOfSight(d1, d2, c => sides.has(c))).toBe(true)
    expect(hasLineOfSight(d1, d2, c => c === at(11, -2))).toBe(false)
  })

  it('hasLineOfSightOnMap : cases opaques intermédiaires, occupation, cible opaque', () => {
    const cells = Array.from({ length: CELL_COUNT }, () => ({ los: true }))
    const a = at(10, -2)
    const b = at(14, -2)
    cells[at(12, -2)].los = false
    let opaque = opaqueCells(cells)
    expect(hasLineOfSightOnMap(opaque, a, b)).toBe(false)
    cells[at(12, -2)].los = true
    opaque = opaqueCells(cells)
    expect(hasLineOfSightOnMap(opaque, a, b)).toBe(true)
    expect(hasLineOfSightOnMap(opaque, a, b, c => c === at(13, -2))).toBe(false)
    expect(hasLineOfSightOnMap(opaque, a, b, c => c === b)).toBe(true)
    cells[b].los = false
    expect(hasLineOfSightOnMap(opaqueCells(cells), a, b)).toBe(false)
    expect(hasLineOfSightOnMap(opaque, a, a)).toBe(true)
  })
})

describe('LdV : salle du Vortex (143393281)', () => {
  const map = vortexMap as { cells: { id: number; walkable: boolean; los: boolean }[] }
  const opaque = opaqueCells(map.cells)
  const walkable = map.cells.filter(c => c.walkable).map(c => c.id)
  const at = (x: number, y: number) => pointToCell(x, y)

  it('données cohérentes avec maps.md (222 marchables, obstacles centraux opaques)', () => {
    expect(walkable.length).toBe(222)
    for (const c of [328, 342, 343, 356, 357, 371, 367, 411, 414]) {
      expect(map.cells[c].walkable).toBe(false)
      expect(opaque[c]).toBe(1)
    }
    expect(cellToPoint(343)).toEqual({ x: 19, y: -5 })
  })

  it('l’obstacle central (x 18–20, y −5…−6) bloque la ligne (17,−5) → (21,−5) dans les deux sens', () => {
    const a = at(17, -5)
    const b = at(21, -5)
    expect(map.cells[a].walkable && map.cells[b].walkable).toBe(true)
    expect(hasLineOfSightOnMap(opaque, a, b)).toBe(false)
    expect(hasLineOfSightOnMap(opaque, b, a)).toBe(false)
    // En contournant par le nord (y = −3), la vue est dégagée.
    expect(hasLineOfSightOnMap(opaque, at(17, -3), at(21, -3))).toBe(true)
  })

  it('visibilité statique symétrique et conforme à l’oracle pour toutes les paires de cases marchables', () => {
    let visible = 0
    const oracleVisible = (a: number, b: number) => {
      const line = oracleLine(a, b)
      for (let i = 0; i < line.length - 1; i++) if (opaque[line[i]]) return false
      return !opaque[b]
    }
    for (const a of walkable)
      for (const b of walkable) {
        const v = hasLineOfSightOnMap(opaque, a, b)
        if (v !== hasLineOfSightOnMap(opaque, b, a)) throw new Error(`asymétrie ${a} ${b}`)
        if (v !== oracleVisible(a, b)) throw new Error(`oracle ${a} ${b}`)
        if (distance(a, b) <= 1 && !v) throw new Error(`adjacent masqué ${a} ${b}`)
        if (v) visible++
      }
    // La majorité des paires se voient, mais les obstacles en masquent une partie.
    expect(visible).toBeGreaterThan(walkable.length * walkable.length * 0.5)
    expect(visible).toBeLessThan(walkable.length * walkable.length)
  })

  it('les combattants sur les cases intermédiaires bloquent (callback) ; cases rouges → bleues', () => {
    const red = [424, 427, 430, 438, 440, 441, 443, 453, 455, 457, 482, 484]
    const blue = [268, 269, 270, 271, 272, 273, 274, 275, 276, 277]
    for (const r of red)
      for (const b of blue) {
        const free = hasLineOfSightOnMap(opaque, r, b)
        const viaCallback = hasLineOfSight(r, b, c => opaque[c] === 1, c => opaque[c] === 1)
        expect(viaCallback).toBe(free)
        if (!free) continue
        // Un combattant posé sur une case intermédiaire masque la cible.
        const mid = lineCells(r, b)
        if (mid.length) expect(hasLineOfSightOnMap(opaque, r, b, c => c === mid[0])).toBe(false)
      }
  })
})
