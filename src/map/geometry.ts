/**
 * Géométrie des cartes de combat Dofus : 560 cellules (14 colonnes × 40 demi-lignes isométriques).
 *
 * Deux repères coexistent :
 *  - le repère « logique » (x, y) obtenu par rotation de 45° (MapPoint du client Dofus) :
 *    deux cellules adjacentes diffèrent de 1 sur x OU sur y ; la distance de jeu est |dx| + |dy| ;
 *    « en ligne » = même x ou même y ; « en diagonale » = |dx| == |dy|.
 *  - le repère d'affichage (colonne, demi-ligne) utilisé pour dessiner la grille isométrique.
 */
export const MAP_WIDTH = 14
export const MAP_HEIGHT = 20
export const CELL_COUNT = MAP_WIDTH * MAP_HEIGHT * 2 // 560

export interface Point {
  x: number
  y: number
}

const CELL_POS: Point[] = []
const POS_TO_CELL = new Map<number, number>()
const key = (x: number, y: number) => (x + 1000) * 4096 + (y + 1000)

;(() => {
  let startX = 0
  let startY = 0
  let cell = 0
  for (let a = 0; a < MAP_HEIGHT; a++) {
    for (let b = 0; b < MAP_WIDTH; b++) CELL_POS[cell++] = { x: startX + b, y: startY + b }
    startX++
    for (let b = 0; b < MAP_WIDTH; b++) CELL_POS[cell++] = { x: startX + b, y: startY + b }
    startY--
  }
  CELL_POS.forEach((p, id) => POS_TO_CELL.set(key(p.x, p.y), id))
})()

export function isValidCell(cellId: number): boolean {
  return Number.isInteger(cellId) && cellId >= 0 && cellId < CELL_COUNT
}

export function cellToPoint(cellId: number): Point {
  return CELL_POS[cellId]
}

/** Cellule aux coordonnées logiques (x, y), ou -1 si hors carte. */
export function pointToCell(x: number, y: number): number {
  return POS_TO_CELL.get(key(x, y)) ?? -1
}

export function distance(a: number, b: number): number {
  const pa = CELL_POS[a]
  const pb = CELL_POS[b]
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y)
}

export function inLine(a: number, b: number): boolean {
  const pa = CELL_POS[a]
  const pb = CELL_POS[b]
  return pa.x === pb.x || pa.y === pb.y
}

export function inDiagonal(a: number, b: number): boolean {
  const pa = CELL_POS[a]
  const pb = CELL_POS[b]
  return Math.abs(pa.x - pb.x) === Math.abs(pa.y - pb.y)
}

/** Les 4 directions de déplacement (pas de déplacement en diagonale en combat). */
export const DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

/** Cellules adjacentes (orthogonales dans le repère logique) existant sur la carte. */
export function neighbors(cellId: number): number[] {
  const p = CELL_POS[cellId]
  const out: number[] = []
  for (const d of DIRECTIONS) {
    const n = pointToCell(p.x + d.x, p.y + d.y)
    if (n >= 0) out.push(n)
  }
  return out
}

/** Position d'affichage isométrique : colonne (avec décalage d'une demi-case une ligne sur deux) et demi-ligne. */
export function cellToScreen(cellId: number, cellW: number, cellH: number): { px: number; py: number } {
  const row = Math.floor(cellId / MAP_WIDTH)
  const col = cellId % MAP_WIDTH
  return { px: col * cellW + (row % 2) * (cellW / 2), py: row * (cellH / 2) }
}
