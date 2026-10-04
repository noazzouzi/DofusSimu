import { describe, expect, it } from 'vitest'
import type { ZoneSpec } from '../src/data/model'
import { CELL_COUNT, CELL_X, CELL_Y, distance, pointToCell } from '../src/map/geometry'
import {
  KNOWN_SHAPES,
  compileZone,
  isCellInZone,
  parseZoneString,
  shapeChar,
  zoneCells,
  zoneCellsInto,
  zoneDirection,
  zoneDistance,
  zoneEfficiency,
  zoneMalusPct,
  zoneMembership,
} from '../src/map/zones'

// Centre de référence au milieu de la carte : (17, −4) = cellule 300.
const CX = 17
const CY = -4
const CENTER = pointToCell(CX, CY)
const at = (dx: number, dy: number) => pointToCell(CX + dx, CY + dy)
/** Lanceurs : à l'ouest (direction 1 vers le centre), au sud-ouest logique (direction 7), en diagonale (0), non aligné. */
const WEST = at(-3, 0)
const BELOW = at(0, -3)
const DIAG = at(-2, -2)
const SKEW = at(-3, 1)

const z = (s: string, flags = '') => parseZoneString(s, flags)
const key = (c: number) => `${CELL_X[c] - CX},${CELL_Y[c] - CY}`
/** Cellules d'une zone en coordonnées relatives au centre, triées. */
function rel(zone: ZoneSpec, caster: number, center = CENTER, opts?: Parameters<typeof zoneCells>[3]): string[] {
  return zoneCells(zone, center, caster, opts).map(key).sort()
}
const pts = (...p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).sort()

describe('zones : formes non orientées', () => {
  it('P : la case d’impact seule (param1 ignoré)', () => {
    expect(rel(z('P1,0,10,4'), WEST)).toEqual(pts([0, 0]))
    expect(rel(z('P5,3,10,4'), WEST)).toEqual(pts([0, 0]))
  })

  it('C : cercle (losange) avec rayon minimal ; C0 = centre ; C63 = toute la carte', () => {
    expect(zoneCells(z('C2,0,10,4'), CENTER, WEST).length).toBe(13)
    expect(rel(z('C1,0,10,4'), WEST)).toEqual(pts([0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]))
    const ring = rel(z('C2,1,10,4'), WEST)
    expect(ring.length).toBe(12)
    expect(ring).not.toContain('0,0')
    expect(rel(z('C0,0,10,4'), WEST)).toEqual(pts([0, 0]))
    expect(zoneCells(z('C63,0,0,0'), CENTER, WEST).length).toBe(CELL_COUNT)
    expect(zoneCells(z('C63,1,10,4'), CENTER, WEST).length).toBe(CELL_COUNT - 1)
    expect(zoneCells(z('C63,4,10,4'), 0, 0).every(c => distance(0, c) >= 4)).toBe(true)
  })

  it('O : anneau exact ; I : tout sauf le losange intérieur', () => {
    expect(rel(z('O2,0,10,4'), WEST)).toEqual(pts([2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1]))
    expect(rel(z('O1,0,10,4'), WEST).length).toBe(4)
    const inv = zoneCells(z('I3,0,10,4'), CENTER, WEST)
    expect(inv.length).toBe(CELL_COUNT - 13)
    expect(inv.every(c => distance(CENTER, c) >= 3)).toBe(true)
  })

  it('D : damier — distances de même parité que le rayon (D60 pair, D61 impair)', () => {
    const d4 = zoneCells(z('D4,0,10,4'), CENTER, WEST)
    expect(d4.length).toBe(25)
    expect(d4.every(c => distance(CENTER, c) % 2 === 0 && distance(CENTER, c) <= 4)).toBe(true)
    expect(rel(z('D1,0,10,4'), WEST)).toEqual(pts([1, 0], [-1, 0], [0, 1], [0, -1]))
    const even = new Set(zoneCells(z('D60,0,10,4'), CENTER, WEST))
    const odd = new Set(zoneCells(z('D61,0,10,4'), CENTER, WEST))
    for (let c = 0; c < CELL_COUNT; c++) {
      expect(even.has(c)).toBe(distance(CENTER, c) % 2 === 0)
      expect(odd.has(c)).toBe(distance(CENTER, c) % 2 === 1)
    }
  })

  it('X / Q : croix sur les axes (rayon minimal ; Q exclut toujours le centre)', () => {
    expect(rel(z('X1,0,10,4'), WEST)).toEqual(pts([0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]))
    const x21 = rel(z('X2,1,10,4'), WEST)
    expect(x21.length).toBe(8)
    expect(x21).not.toContain('0,0')
    expect(rel(z('X3,3,10,4'), WEST)).toEqual(pts([3, 0], [-3, 0], [0, 3], [0, -3]))
    expect(rel(z('Q1,0,10,4'), WEST)).toEqual(pts([1, 0], [-1, 0], [0, 1], [0, -1]))
    expect(rel(z('Q1,1,10,4'), WEST)).toEqual(rel(z('Q1,0,10,4'), WEST))
    expect(rel(z('Q2,2,10,4'), WEST)).toEqual(pts([2, 0], [-2, 0], [0, 2], [0, -2]))
    expect(rel(z('X6,1,10,4'), WEST).length).toBe(24)
  })

  it('+ / # : croix diagonales (pas diagonaux) ; * : étoile 8 directions', () => {
    expect(rel(z('+1,0,10,4'), WEST)).toEqual(pts([0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]))
    expect(rel(z('+1,1,10,4'), WEST)).toEqual(pts([1, 1], [1, -1], [-1, 1], [-1, -1]))
    expect(rel(z('+3,1,10,4'), WEST).length).toBe(12)
    expect(rel(z('#1,0,10,4'), WEST)).toEqual(pts([1, 1], [1, -1], [-1, 1], [-1, -1]))
    expect(rel(z('#2,2,10,4'), WEST)).toEqual(pts([2, 2], [2, -2], [-2, 2], [-2, -2]))
    const star = rel(z('*2,0,10,4'), WEST)
    expect(star.length).toBe(17)
    expect(star).toContain('2,2')
    expect(star).toContain('0,-2')
    expect(star).not.toContain('1,2')
  })

  it('G : carré (Chebyshev) ; W : carré sans ses diagonales (ni centre) ; Z : hors du cercle euclidien', () => {
    expect(rel(z('G1,0,10,4'), WEST).length).toBe(9)
    expect(rel(z('G2,0,0,0'), WEST).length).toBe(25)
    const w = rel(z('W2,0,10,4'), WEST)
    expect(w.length).toBe(16)
    for (const p of ['0,0', '1,1', '-2,2', '2,-2']) expect(w).not.toContain(p)
    expect(w).toContain('2,1')
    const zz = zoneCells(z('Z4,0,10,4'), CENTER, WEST)
    for (let c = 0; c < CELL_COUNT; c++) {
      const dx = CELL_X[c] - CX
      const dy = CELL_Y[c] - CY
      expect(zz.includes(c)).toBe(Math.sqrt(dx * dx + dy * dy) >= 4)
    }
  })

  it('A / a : toute la carte ; ; : liste explicite ; forme inconnue = point ; " " = vide', () => {
    expect(zoneCells(z('a1,0,10,4'), CENTER, WEST).length).toBe(CELL_COUNT)
    expect(zoneCells(z('A1,0,10,4'), 0, 559).length).toBe(CELL_COUNT)
    const list = parseZoneString(';1,0,10,4', '', [27, 300, 27, 999])
    expect(zoneCells(list, CENTER, WEST)).toEqual([27, 300])
    expect(zoneCells(parseZoneString(';1,0,10,4'), CENTER, WEST)).toEqual([])
    expect(zoneCells(z('K3,0,10,4'), CENTER, WEST)).toEqual([CENTER])
    expect(zoneCells({ shape: ' ', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false }, CENTER, WEST)).toEqual([])
  })

  it('bords de carte : seules les cellules valides, centre invalide → aucune', () => {
    const corner = zoneCells(z('C2,0,10,4'), 0, 14)
    expect(corner.every(c => c >= 0 && c < CELL_COUNT && distance(0, c) <= 2)).toBe(true)
    expect(corner.length).toBe(6) // (0,0) en coin : x+y ≥ 0 et x−y ≥ 0
    expect(zoneCells(z('C2,0,10,4'), -1, 14)).toEqual([])
    expect(zoneCells(z('C2,0,10,4'), 560, 14)).toEqual([])
  })
})

describe('zones : formes orientées (direction lanceur → impact)', () => {
  it('L : impact + r cases en s’éloignant du lanceur (en ligne et en diagonale)', () => {
    expect(rel(z('L3,0,10,4'), WEST)).toEqual(pts([0, 0], [1, 0], [2, 0], [3, 0]))
    expect(rel(z('L2,0,10,4'), BELOW)).toEqual(pts([0, 0], [0, 1], [0, 2]))
    expect(rel(z('L3,0,10,4'), DIAG)).toEqual(pts([0, 0], [1, 1], [2, 2], [3, 3]))
    // Non aligné : axe de déplacement le plus proche (écart assumé au port, cf. en-tête de zones.ts).
    expect(rel(z('L2,0,10,4'), SKEW)).toEqual(pts([0, 0], [1, 0], [2, 0]))
    // Lanceur sur l'impact : direction 1 et la case du lanceur exclue (port).
    expect(rel(z('L2,0,10,4'), CENTER)).toEqual(pts([1, 0], [2, 0]))
    // '/' a la même géométrie que L.
    expect(rel(z('/3,0,10,4'), WEST)).toEqual(rel(z('L3,0,10,4'), WEST))
  })

  it('L : direction forcée (drapeau d → paliers, ou option) et L63 jusqu’au bord', () => {
    expect(zoneDirection(z('L1,0,10,4', 'd'), CENTER, WEST)).toBe(4)
    expect(rel(z('L1,0,10,4', 'd'), WEST)).toEqual(pts([0, 0], [-1, -1]))
    expect(rel(z('L1,0,10,4'), WEST, CENTER, { direction: 7 })).toEqual(pts([0, 0], [0, 1]))
    const long = zoneCells(z('L63,0,10,4'), CENTER, WEST)
    expect(long[0]).toBe(CENTER)
    expect(long.every((c, i) => CELL_Y[c] === CY && CELL_X[c] === CX + i)).toBe(true)
    expect(pointToCell(CX + long.length, CY)).toBe(-1)
  })

  it('l : ligne depuis le lanceur (param1 = min, param2 = longueur) ; stopAtTarget = jusqu’à la case ciblée', () => {
    expect(rel(z('l1,63,0,0', 's'), WEST)).toEqual(pts([-2, 0], [-1, 0], [0, 0]))
    expect(zoneCells(z('l1,63,0,0', 's'), CENTER, WEST)).toEqual([at(-2, 0), at(-1, 0), CENTER])
    expect(rel(z('l1,3,10,4'), WEST)).toEqual(pts([-2, 0], [-1, 0], [0, 0]))
    expect(rel(z('l2,3,10,4'), WEST)).toEqual(pts([-1, 0], [0, 0]))
    // Sans stopAtTarget : jusqu'au bord de la carte.
    const full = zoneCells(z('l1,63,0,0'), CENTER, WEST)
    expect(full.length).toBeGreaterThan(3)
    expect(full.every(c => CELL_Y[c] === CY && CELL_X[c] > CX - 3)).toBe(true)
    // Le lanceur n'est jamais dans sa ligne (même avec min = 0).
    expect(zoneCells(z('l0,6,10,4', 's'), CENTER, WEST)).not.toContain(WEST)
    // Rayon nul : zone vide (l1,0 — port).
    expect(zoneCells(z('l1,0,0,0'), CENTER, WEST)).toEqual([])
    // Diagonale + stopAtTarget : la borne est la distance de Manhattan (non divisée) comme le client.
    expect(rel(z('l1,63,0,0', 's'), DIAG)).toEqual(pts([-1, -1], [0, 0], [1, 1], [2, 2]))
  })

  it('stopAtOccupied (option hors client) : coupe la ligne à la première case occupée', () => {
    const occ = at(-1, 0)
    expect(rel(z('l1,63,0,0', 's'), WEST, CENTER, { stopAtOccupied: c => c === occ })).toEqual(pts([-2, 0], [-1, 0]))
    // Sans stopAtTarget, l'option est ignorée.
    expect(zoneCells(z('l1,3,0,0'), CENTER, WEST, { stopAtOccupied: c => c === occ }).length).toBe(3)
    expect(rel(z('L3,0,10,4', 's'), WEST, CENTER, { stopAtOccupied: c => c === at(2, 0) })).toEqual(pts([0, 0], [1, 0], [2, 0]))
  })

  it('T / - : ligne perpendiculaire (orthogonale ou diagonale selon le lancer)', () => {
    expect(rel(z('T2,0,10,4'), WEST)).toEqual(pts([0, 0], [0, 1], [0, 2], [0, -1], [0, -2]))
    expect(rel(z('T1,0,10,4'), BELOW)).toEqual(pts([0, 0], [1, 0], [-1, 0]))
    expect(rel(z('T2,0,10,4'), DIAG)).toEqual(pts([0, 0], [1, -1], [2, -2], [-1, 1], [-2, 2]))
    expect(rel(z('-2,0,10,4'), DIAG)).toEqual(rel(z('T2,0,10,4'), DIAG))
  })

  it('U : demi-cercle, branches revenant vers le lanceur', () => {
    expect(rel(z('U1,0,10,4'), WEST)).toEqual(pts([0, 0], [-1, 1], [-1, -1]))
    expect(rel(z('U2,0,10,4'), WEST)).toEqual(pts([0, 0], [-1, 1], [-1, -1], [-2, 2], [-2, -2]))
    expect(rel(z('U1,0,10,4'), DIAG)).toEqual(pts([0, 0], [0, -1], [-1, 0]))
  })

  it('V : cône 4 directions (profondeur k : 2k+1 cases), F : fourche à 3 dents', () => {
    expect(rel(z('V1,0,10,4'), WEST)).toEqual(pts([0, 0], [1, 0], [1, 1], [1, -1]))
    expect(rel(z('V2,0,10,4'), WEST).length).toBe(9)
    expect(rel(z('V1,0,10,4'), BELOW)).toEqual(pts([0, 0], [0, 1], [1, 1], [-1, 1]))
    expect(rel(z('V1,0,10,4'), SKEW)).toEqual(rel(z('V1,0,10,4'), WEST))
    expect(rel(z('V1,0,10,4'), CENTER)).toEqual(pts([0, 0], [0, -1], [1, -1], [-1, -1])) // lanceur = impact : 3
    expect(rel(z('F1,0,10,4'), WEST)).toEqual(pts([0, 0], [1, 0], [1, 1], [1, -1]))
    expect(rel(z('F2,0,0,0'), WEST)).toEqual(pts([0, 0], [1, 0], [1, 1], [1, -1], [2, 0], [2, 2], [2, -2]))
    expect(rel(z('F1,0,10,4'), at(0, 3))).toEqual(pts([0, 0], [0, -1], [1, -1], [-1, -1]))
  })

  it('R : rectangle (demi-largeur param1, profondeur param2) orienté', () => {
    const r13 = rel(z('R1,3,0,0'), WEST)
    expect(r13.length).toBe(12)
    expect(r13).toContain('3,1')
    expect(r13).not.toContain('-1,0')
    expect(rel(z('R2,1,10,4'), WEST).length).toBe(10)
    expect(rel(z('R1,3,0,0'), BELOW)).toContain('1,3')
    expect(rel(z('R1,3,0,0'), at(3, 0))).toContain('-3,-1') // lanceur à l'est : vers −x
    // Paramètres < 1 ramenés à 1 (port).
    expect(rel(z('R0,0,0,0'), WEST)).toEqual(pts([0, 0], [0, 1], [0, -1], [1, 0], [1, 1], [1, -1]))
  })

  it('B : boomerang (bras perpendiculaires puis crochet vers le lanceur)', () => {
    expect(rel(z('B1,0,10,4'), WEST)).toEqual(pts([0, 0], [-1, 1], [-1, -1]))
    expect(rel(z('B2,0,10,4'), WEST)).toEqual(pts([0, 0], [0, 1], [0, -1], [-1, 2], [-1, -2]))
    expect(rel(z('B3,0,10,4'), WEST)).toEqual(pts([0, 0], [0, 1], [0, -1], [0, 2], [0, -2], [-1, 3], [-1, -3]))
  })

  it('zoneDirection : −1 pour les formes non orientées, sinon direction du lancer', () => {
    expect(zoneDirection(z('C2,0,10,4'), CENTER, WEST)).toBe(-1)
    expect(zoneDirection(z('L2,0,10,4'), CENTER, WEST)).toBe(1)
    expect(zoneDirection(z('L2,0,10,4'), CENTER, DIAG)).toBe(0)
    expect(zoneDirection(z('L2,0,10,4'), CENTER, SKEW)).toBe(1)
    expect(zoneDirection(z('V2,0,10,4'), CENTER, DIAG)).toBe(7) // 4 directions : égalité → axe y
    expect(zoneDirection(z('V2,0,10,4'), CENTER, WEST, { direction: 2 })).toBe(1) // direction paire refusée pour V
    expect(zoneDirection(z('V2,0,10,4'), CENTER, WEST, { direction: 5 })).toBe(5)
    expect(zoneDirection(compileZone(z('T1,0,10,4')), CENTER, BELOW)).toBe(7)
  })
})

describe('zones : filtres (LdV, cellules marchables)', () => {
  it('onlyIfInSight : seules les cellules en LdV du centre (si blocksLos est fourni)', () => {
    const zone = z('C63,0,10,4', 'v')
    expect(zoneCells(zone, CENTER, WEST).length).toBe(CELL_COUNT) // sans rappel : drapeau ignoré
    const wall = at(1, 0)
    const cells = zoneCells(zone, CENTER, WEST, { blocksLos: c => c === wall })
    expect(cells).toContain(wall) // la case de l'obstacle elle-même n'a pas d'intermédiaire
    expect(cells).not.toContain(at(2, 0))
    expect(cells).not.toContain(at(5, 0))
    expect(cells).toContain(at(2, 1))
    expect(cells).toContain(CENTER)
    expect(isCellInZone(zone, at(3, 0), CENTER, WEST, { blocksLos: c => c === wall })).toBe(false)
  })

  it('cellFilter : filtre final', () => {
    const even = zoneCells(z('C2,0,10,4'), CENTER, WEST, { cellFilter: c => c % 2 === 0 })
    expect(even.length).toBeGreaterThan(0)
    expect(even.every(c => c % 2 === 0)).toBe(true)
  })
})

describe('zones : ordre, cohérence et API', () => {
  const shapes = [
    'P1,0,10,4', 'C2,1,10,4', 'C3,0,10,4', 'O2,0,10,4', 'I2,0,10,4', 'D4,0,10,4', 'X2,1,10,4', 'Q3,0,10,4', '+3,1,10,4',
    '#2,2,10,4', '*2,0,10,4', 'G2,0,10,4', 'W2,0,10,4', 'Z5,0,10,4', 'L3,0,10,4', '/3,0,10,4', 'T2,0,10,4', '-2,0,10,4',
    'U2,0,10,4', 'V2,0,10,4', 'F2,0,10,4', 'R1,3,10,4', 'R2,1,10,4', 'B3,0,10,4', 'a1,0,10,4', 'A1,0,10,4', 'C63,1,10,4',
  ]
  const lines: [string, string][] = [
    ['l1,63,0,0', 's'],
    ['l1,7,10,4', ''],
    ['l0,6,10,4', 's'],
    ['L1,0,10,4', 'd'],
  ]

  it('isCellInZone et zoneMembership ⇔ appartenance à zoneCells (centres et lanceurs variés)', () => {
    const centers = [CENTER, 0, 13, 546, 559, 215, 400]
    for (const [s, f] of [...shapes.map(s => [s, ''] as [string, string]), ...lines]) {
      const zone = z(s, f)
      for (const center of centers)
        for (const caster of [WEST, BELOW, DIAG, SKEW, center, 100]) {
          const cells = new Set(zoneCells(zone, center, caster))
          const inZone = zoneMembership(zone, center, caster)
          for (let c = 0; c < CELL_COUNT; c += 1) {
            const a = isCellInZone(zone, c, center, caster)
            if (a !== cells.has(c) || inZone(c) !== a) throw new Error(`${s} centre ${center} lanceur ${caster} cellule ${c}`)
          }
        }
    }
  })

  it('ordre : distance croissante à l’origine (impact, ou lanceur pour l), puis identifiant', () => {
    for (const s of shapes) {
      const cells = zoneCells(z(s), CENTER, WEST)
      for (let i = 1; i < cells.length; i++) {
        const d0 = distance(CENTER, cells[i - 1])
        const d1 = distance(CENTER, cells[i])
        expect(d0 < d1 || (d0 === d1 && cells[i - 1] < cells[i]), s).toBe(true)
      }
      expect(new Set(cells).size).toBe(cells.length)
    }
    const line = zoneCells(z('l1,63,0,0', 's'), CENTER, WEST)
    expect(line.map(c => distance(WEST, c))).toEqual([1, 2, 3])
  })

  it('zoneCellsInto réutilise le tableau ; zoneCells renvoie un nouveau tableau', () => {
    const out = [999, 998]
    const res = zoneCellsInto(z('X1,0,10,4'), CENTER, WEST, out)
    expect(res).toBe(out)
    expect(out.sort((a, b) => a - b)).toEqual(zoneCells(z('X1,0,10,4'), CENTER, WEST).sort((a, b) => a - b))
    const a1 = zoneCells(z('X1,0,10,4'), CENTER, WEST)
    const a2 = zoneCells(z('X1,0,10,4'), CENTER, WEST)
    expect(a1).not.toBe(a2)
    expect(zoneCellsInto(z('X1,0,10,4'), -1, WEST, out)).toEqual([])
  })

  it('ZoneSpec construit à la main (sans drapeaux optionnels) et shapeChar', () => {
    const manual: ZoneSpec = { shape: 'C', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false }
    expect(zoneCells(manual, CENTER, WEST).length).toBe(5)
    expect(shapeChar(67)).toBe('C')
    expect(shapeChar('X')).toBe('X')
    expect(compileZone(manual)).toBe(compileZone(manual)) // cache par objet
  })

  it('compileZone : rayons effectifs du client', () => {
    expect(compileZone(z('P3,2,10,4'))).toMatchObject({ shape: 'P', radius: 0, minRadius: 0 })
    expect(compileZone(z('O3,0,10,4'))).toMatchObject({ radius: 3, minRadius: 3 })
    expect(compileZone(z('I2,0,10,4'))).toMatchObject({ radius: 63, minRadius: 2 })
    expect(compileZone(z('l1,63,0,0', 's'))).toMatchObject({ radius: 63, minRadius: 1, stopAtTarget: true })
    expect(compileZone(z('Q1,0,10,4'))).toMatchObject({ radius: 1, minRadius: 1 })
    expect(compileZone(z('#1,0,10,4'))).toMatchObject({ radius: 1, minRadius: 1 })
    expect(compileZone(z('*2,1,10,4'))).toMatchObject({ radius: 2, minRadius: 0 })
    expect(compileZone(z('R0,0,0,0'))).toMatchObject({ radius: 1, minRadius: 1 })
    expect(compileZone(z('L1,0,10,4', 'd'))).toMatchObject({ forcedDirection: 4, orientation: 8 })
    expect(compileZone(z('V1,0,10,4'))).toMatchObject({ orientation: 4, forcedDirection: -1 })
    expect(compileZone(z('C2,0,10,4', 'v'))).toMatchObject({ onlyIfInSight: true, orientation: 0 })
    for (const s of KNOWN_SHAPES) expect(compileZone({ shape: s, size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false }).shape).toBe(s)
  })

  it('parseZoneString : paramètres, défauts, drapeaux, cache et objet gelé', () => {
    expect(z('C2,1,10,4')).toEqual({ shape: 'C', size: 2, minSize: 1, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false })
    expect(z('L3')).toEqual({ shape: 'L', size: 3, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false })
    expect(z('')).toMatchObject({ shape: 'P', size: 1 })
    expect(z('l1,63,0,0', 'cs')).toMatchObject({ stopAtTarget: true, includeCarried: true })
    expect(z('C63,0,0,0', 'v')).toMatchObject({ onlyIfInSight: true })
    expect(z('L1,0,10,4', 'd')).toMatchObject({ forcedDirection: true })
    expect(z('C2,1,10,4')).toBe(z('C2,1,10,4'))
    expect(Object.isFrozen(z('C2,1,10,4'))).toBe(true)
    expect(parseZoneString(';1,0,10,4', '', [27]).cells).toEqual([27])
  })
})

describe('zones : dégressivité (GetAoeMalus)', () => {
  it('Couperet L3 (10 % × 4) : 100 %, 90 %, 80 %, 70 %', () => {
    const zone = z('L3,0,10,4')
    expect(zoneCells(zone, CENTER, WEST).map(c => zoneEfficiency(zone, CENTER, c, WEST))).toEqual([1, 0.9, 0.8, 0.7])
  })

  it('Manhattan par défaut, moins le rayon minimal ; paliers plafonnés', () => {
    const c2 = z('C2,0,10,4')
    expect(zoneEfficiency(c2, CENTER, CENTER)).toBe(1)
    expect(zoneEfficiency(c2, CENTER, at(1, 0))).toBe(0.9)
    expect(zoneEfficiency(c2, CENTER, at(1, 1))).toBe(0.8)
    const c31 = z('C3,1,10,4')
    expect(zoneEfficiency(c31, CENTER, at(1, 0))).toBe(1)
    expect(zoneEfficiency(c31, CENTER, at(3, 0))).toBe(0.8)
    expect(zoneMalusPct(z('X6,1,10,4'), CENTER, at(6, 0))).toBe(40) // min(5, 4) × 10
    expect(zoneMalusPct(z('C3,0,25,4'), CENTER, at(3, 0))).toBe(75)
    expect(zoneMalusPct(z('C9,0,30,9'), CENTER, at(5, 0))).toBe(100) // plafond 100 %
    expect(zoneDistance(z('C2,0,10,4'), CENTER, at(1, 1))).toBe(2)
  })

  it('G / R / W : Chebyshev (R ignore le rayon minimal)', () => {
    expect(zoneEfficiency(z('G2,0,10,4'), CENTER, at(2, 1))).toBe(0.8)
    expect(zoneEfficiency(z('W2,0,10,4'), CENTER, at(1, 2))).toBe(0.8)
    expect(zoneEfficiency(z('R1,3,10,4'), CENTER, at(3, 1), WEST)).toBe(0.7)
    expect(zoneEfficiency(z('R1,3,10,4'), CENTER, at(0, 1), WEST)).toBe(0.9)
  })

  it('# + - / U : Manhattan >> 1', () => {
    expect(zoneEfficiency(z('+3,1,10,4'), CENTER, at(3, 3))).toBe(0.8) // (6 >> 1) − 1 = 2
    expect(zoneEfficiency(z('#2,2,10,4'), CENTER, at(2, -2))).toBe(1)
    expect(zoneEfficiency(z('U2,0,10,4'), CENTER, at(-2, 2), WEST)).toBe(0.8)
    expect(zoneEfficiency(z('/3,0,10,4'), CENTER, at(3, 0), WEST)).toBe(0.9)
    expect(zoneEfficiency(z('-2,0,10,4'), CENTER, at(1, -1), DIAG)).toBe(0.9)
    // L sur une diagonale : Manhattan (pas de division), comme le port.
    expect(zoneEfficiency(z('L3,0,10,4'), CENTER, at(1, 1), DIAG)).toBe(0.8)
  })

  it('V / F : profondeur selon la direction du lancer', () => {
    const v = z('V2,0,10,4')
    expect(zoneEfficiency(v, CENTER, at(2, 2), WEST)).toBe(0.8)
    expect(zoneEfficiency(v, CENTER, at(1, -1), WEST)).toBe(0.9)
    expect(zoneEfficiency(v, CENTER, at(1, 2), BELOW)).toBe(0.8)
    expect(zoneEfficiency(v, CENTER, at(2, 2), SKEW)).toBe(1) // non aligné : distance 0 (port)
    expect(zoneEfficiency(v, CENTER, at(1, 2), DIAG)).toBe(0.8) // diagonale : Chebyshev
    expect(zoneEfficiency(v, CENTER, at(2, 1), CENTER)).toBe(0.8) // lanceur = impact : axe x (port)
    expect(zoneEfficiency(z('F2,0,10,4'), CENTER, at(2, 2), WEST)).toBe(0.8)
  })

  it('pas de dégressivité : point, toute la carte, I, O, pas nul, rayon > 50', () => {
    expect(zoneEfficiency(z('a1,0,10,4'), CENTER, at(5, 5))).toBe(1)
    expect(zoneEfficiency(z('A1,0,10,4'), CENTER, at(5, 5))).toBe(1)
    expect(zoneEfficiency(z('I2,0,10,4'), CENTER, at(5, 5))).toBe(1)
    expect(zoneEfficiency(z('O3,0,10,4'), CENTER, at(3, 0))).toBe(1)
    expect(zoneEfficiency(z('C2,0,0,0'), CENTER, at(2, 0))).toBe(1)
    expect(zoneEfficiency(z('C63,0,10,4'), CENTER, at(5, 0))).toBe(1)
    expect(zoneEfficiency(z('l1,63,10,4', 's'), CENTER, at(-2, 0), WEST)).toBe(1)
    expect(zoneEfficiency(z('P1,0,10,4'), CENTER, CENTER)).toBe(1)
    expect(zoneEfficiency(z('X1,0,10,0'), CENTER, at(1, 0))).toBe(1) // 0 palier
  })

  it('l à rayon ≤ 50 : distance mesurée depuis la case d’impact, moins le rayon minimal (port)', () => {
    const zone = z('l1,7,10,4')
    const far = pointToCell(CX + 4, CY)
    expect(zoneEfficiency(zone, far, at(-2, 0), WEST)).toBe(0.6) // d = 6 − 1 = 5 → 4 paliers
    expect(zoneEfficiency(zone, far, at(3, 0), WEST)).toBe(1)
  })
})
