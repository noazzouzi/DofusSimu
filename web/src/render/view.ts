/**
 * Géométrie d'affichage de la carte : classification des cellules (sol, trou, pilier, vide),
 * cadrage (zone utile de la carte), mise à l'échelle HiDPI et tests de clic.
 *
 * Unités « carte » : une cellule fait CELL_W × CELL_H (losange 2:1) ; `cellToScreen` de
 * src/map/geometry.ts donne le coin supérieur gauche du losange.
 */
import { CELL_COUNT, cellToPoint, cellToScreen, pointToCell } from '@/map/geometry'
import type { MapData } from '@/data/model'

export const CELL_W = 64
export const CELL_H = 32
/** Hauteur des piliers et épaisseur de la dalle (unités carte). */
export const PILLAR_H = 22
export const SLAB_H = 9

export type CellKind = 'floor' | 'hole' | 'pillar' | 'void'

export interface Pt {
  x: number
  y: number
}

/** Centre du losange d'une cellule (unités carte). */
export function cellCenter(cell: number): Pt {
  const { px, py } = cellToScreen(cell, CELL_W, CELL_H)
  return { x: px + CELL_W / 2, y: py + CELL_H / 2 }
}

/**
 * Classe chaque cellule. Une cellule non marchable « intérieure » (des cellules marchables dans au
 * moins 3 des 4 directions) est un obstacle : pilier si elle bloque la vue, trou sinon. Les autres
 * cellules non marchables sont le vide hors de l'arène (non dessiné).
 */
export function classifyCells(map: MapData): CellKind[] {
  const out: CellKind[] = new Array(CELL_COUNT).fill('void')
  const walk = (c: number) => c >= 0 && !!map.cells[c]?.walkable
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (let c = 0; c < CELL_COUNT; c++) {
    if (walk(c)) {
      out[c] = 'floor'
      continue
    }
    const p = cellToPoint(c)
    let seen = 0
    for (const [dx, dy] of dirs) {
      for (let k = 1; k <= 8; k++) {
        const n = pointToCell(p.x + dx * k, p.y + dy * k)
        if (n < 0) break
        if (walk(n)) {
          seen++
          break
        }
      }
    }
    if (seen >= 3) out[c] = map.cells[c]?.los === false ? 'pillar' : 'hole'
  }
  return out
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Rectangle englobant (unités carte) des cellules utiles, marges comprises. */
export function computeBounds(kinds: CellKind[], extraCells: Iterable<number>): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (c: number) => {
    if (c < 0 || c >= CELL_COUNT) return
    const { px, py } = cellToScreen(c, CELL_W, CELL_H)
    minX = Math.min(minX, px)
    minY = Math.min(minY, py)
    maxX = Math.max(maxX, px + CELL_W)
    maxY = Math.max(maxY, py + CELL_H)
  }
  kinds.forEach((k, c) => k !== 'void' && add(c))
  for (const c of extraCells) add(c)
  if (!Number.isFinite(minX)) {
    for (let c = 0; c < CELL_COUNT; c++) add(c)
  }
  // Marges : jetons et barres de vie au-dessus de la rangée du haut, dalle en dessous.
  return { minX: minX - 14, minY: minY - 62, maxX: maxX + 14, maxY: maxY + SLAB_H + 12 }
}

/**
 * Transformation unités carte -> pixels CSS du canvas, avec caméra : à zoom 1 toute la carte est
 * visible (centrée) ; au-delà, la caméra (coin haut-gauche `left`/`top`) suit un point d'intérêt.
 */
export class Viewport {
  /** Échelle d'ajustement (px CSS par unité à zoom 1). */
  scale = 1
  zoom = 1
  left = 0
  top = 0
  cssW = 0
  cssH = 0
  dpr = 1
  private baseLeft = 0

  constructor(public bounds: Bounds) {
    this.left = bounds.minX
    this.top = bounds.minY
  }

  get width(): number {
    return this.bounds.maxX - this.bounds.minX
  }
  get height(): number {
    return this.bounds.maxY - this.bounds.minY
  }
  /** px CSS par unité carte (zoom compris). */
  get k(): number {
    return this.scale * this.zoom
  }
  get visW(): number {
    return this.cssW / this.k
  }
  get visH(): number {
    return this.cssH / this.k
  }

  /** Ajuste à la largeur disponible, en limitant la hauteur. */
  fit(availW: number, maxH: number, dpr: number, forcedH?: number): void {
    this.dpr = Math.max(1, Math.min(3, dpr || 1))
    this.scale = Math.max(0.1, Math.min(availW / this.width, maxH / this.height))
    this.cssW = Math.round(availW)
    this.cssH = Math.round(forcedH ?? this.height * this.scale)
    this.baseLeft = this.bounds.minX - (this.cssW - this.width * this.scale) / 2 / this.scale
    if (this.zoom <= 1.001) {
      this.left = this.baseLeft
      this.top = this.bounds.minY
    }
  }

  /** Centre la caméra sur un point (bornée aux limites de la carte). */
  lookAt(x: number, y: number): void {
    if (this.zoom <= 1.001) {
      this.left = this.baseLeft
      this.top = this.bounds.minY
      return
    }
    const b = this.bounds
    const vw = this.visW
    const vh = this.visH
    this.left = vw >= this.width ? b.minX - (vw - this.width) / 2 : Math.max(b.minX, Math.min(b.maxX - vw, x - vw / 2))
    this.top = vh >= this.height ? b.minY - (vh - this.height) / 2 : Math.max(b.minY, Math.min(b.maxY - vh, y - vh / 2))
  }

  /** Matrice à passer à ctx.setTransform pour dessiner en unités carte. */
  matrix(): [number, number, number, number, number, number] {
    const k = this.k * this.dpr
    return [k, 0, 0, k, -this.left * k, -this.top * k]
  }

  toMap(cssX: number, cssY: number): Pt {
    return { x: cssX / this.k + this.left, y: cssY / this.k + this.top }
  }

  /** Convertit des pixels CSS en unités carte (tailles de texte lisibles quel que soit le zoom). */
  px(n: number): number {
    return n / this.k
  }

  /** Zone visible (unités carte). */
  visible(): Bounds {
    return { minX: this.left, minY: this.top, maxX: this.left + this.visW, maxY: this.top + this.visH }
  }
}

/** Cellule sous un point (unités carte), ou -1. */
export function cellAtPoint(p: Pt): number {
  const row = Math.floor(p.y / (CELL_H / 2))
  let best = -1
  let bestD = Infinity
  for (let r = row - 2; r <= row + 1; r++) {
    if (r < 0 || r >= 40) continue
    for (let col = 0; col < 14; col++) {
      const c = r * 14 + col
      const cc = cellCenter(c)
      const d = Math.abs(p.x - cc.x) / (CELL_W / 2) + Math.abs(p.y - cc.y) / (CELL_H / 2)
      if (d <= 1 && d < bestD) ((bestD = d), (best = c))
    }
  }
  return best
}

/** Trace le losange d'une cellule (chemin courant). */
export function diamondPath(ctx: CanvasRenderingContext2D, cell: number, inset = 0): void {
  const { x, y } = cellCenter(cell)
  const hw = CELL_W / 2 - inset * 2
  const hh = CELL_H / 2 - inset
  ctx.moveTo(x, y - hh)
  ctx.lineTo(x + hw, y)
  ctx.lineTo(x, y + hh)
  ctx.lineTo(x - hw, y)
  ctx.closePath()
}
