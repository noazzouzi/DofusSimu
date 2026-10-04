/**
 * Géométrie des cartes de combat Dofus : 560 cellules (14 colonnes × 40 demi-lignes isométriques).
 *
 * Deux repères coexistent :
 *  - le repère « logique » (x, y) obtenu par rotation de 45° (MapPoint du client Dofus) :
 *    deux cellules adjacentes diffèrent de 1 sur x OU sur y ; la distance de jeu est |dx| + |dy| ;
 *    « en ligne » = même x ou même y ; « en diagonale » = |dx| == |dy|.
 *  - le repère d'affichage (colonne, demi-ligne) utilisé pour dessiner la grille isométrique.
 *
 * Formules (docs/research/mechanics.md §1, data/research/map-geometry.json, port D3 `MapTools.cs`) :
 *   row = floor(id / 14), col = id % 14, x = col + ceil(row / 2), y = col − floor(row / 2)
 *   valide(x, y) ⇔ 0 ≤ x + y ≤ 27 et 0 ≤ x − y ≤ 39 ; id = (x − y)·14 + floor((x + y) / 2)
 *
 * Directions (DirectionsEnum / MapDirection du client), vecteurs dans le repère logique :
 *   0 E (1,1) · 1 SE (1,0) · 2 S (1,−1) · 3 SW (0,−1) · 4 W (−1,−1) · 5 NW (−1,0) · 6 N (−1,1) · 7 NE (0,1)
 * Les directions IMPAIRES sont les 4 directions de déplacement (voisins par un côté, « orthogonales » dans le
 * code Haxe) ; les PAIRES sont les diagonales logiques (horizontales/verticales à l'écran, « cardinales » Haxe).
 *
 * Toutes les tables sont précalculées (tableaux typés) : aucune allocation dans les fonctions de requête,
 * sauf celles qui retournent explicitement un nouveau tableau.
 */
export const MAP_WIDTH = 14
export const MAP_HEIGHT = 20
export const CELL_COUNT = MAP_WIDTH * MAP_HEIGHT * 2 // 560
/** Valeur « infinie » du client (portée illimitée, durée infinie...). */
export const PSEUDO_INFINITE = 63

export interface Point {
  x: number
  y: number
}

// Bornes du repère logique : x ∈ [0, 33], y ∈ [−19, 13].
export const MIN_X = 0
export const MAX_X = 33
export const MIN_Y = -19
export const MAX_Y = 13
const GRID_H = MAX_Y - MIN_Y + 1 // 33

/** Coordonnées logiques par cellule (tables plates, accès sans allocation). */
export const CELL_X = new Int8Array(CELL_COUNT)
export const CELL_Y = new Int8Array(CELL_COUNT)
const CELL_POS: readonly Point[] = buildCellPositions()
/** (x − MIN_X) × GRID_H + (y − MIN_Y) → cellule, ou −1. */
const POS_TO_CELL = new Int16Array((MAX_X - MIN_X + 1) * GRID_H).fill(-1)

function buildCellPositions(): Point[] {
  // Boucle d'initialisation de MapPoint.init() (client Dofus 2), identique aux formules du port Haxe.
  const pos: Point[] = []
  let startX = 0
  let startY = 0
  let cell = 0
  for (let a = 0; a < MAP_HEIGHT; a++) {
    for (let b = 0; b < MAP_WIDTH; b++) pos[cell++] = Object.freeze({ x: startX + b, y: startY + b })
    startX++
    for (let b = 0; b < MAP_WIDTH; b++) pos[cell++] = Object.freeze({ x: startX + b, y: startY + b })
    startY--
  }
  return pos
}

for (let id = 0; id < CELL_COUNT; id++) {
  const p = CELL_POS[id]
  CELL_X[id] = p.x
  CELL_Y[id] = p.y
  POS_TO_CELL[(p.x - MIN_X) * GRID_H + (p.y - MIN_Y)] = id
}

export function isValidCell(cellId: number): boolean {
  return Number.isInteger(cellId) && cellId >= 0 && cellId < CELL_COUNT
}

/** Le point logique (x, y) est-il sur la carte ? (MapPoint.isInMap) */
export function isValidPoint(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x + y >= 0 && x + y <= 27 && x - y >= 0 && x - y <= 39
}

/** Coordonnées logiques d'une cellule (objet partagé et gelé : ne pas le modifier). */
export function cellToPoint(cellId: number): Point {
  return CELL_POS[cellId]
}

/** Cellule aux coordonnées logiques (x, y), ou −1 si hors carte. */
export function pointToCell(x: number, y: number): number {
  if (x < MIN_X || x > MAX_X || y < MIN_Y || y > MAX_Y) return -1
  const v = POS_TO_CELL[(x - MIN_X) * GRID_H + (y - MIN_Y)]
  return v === undefined ? -1 : v
}

/** Distance de jeu (portée, PM, zones) : Manhattan dans le repère logique. */
export function distance(a: number, b: number): number {
  return Math.abs(CELL_X[a] - CELL_X[b]) + Math.abs(CELL_Y[a] - CELL_Y[b])
}

/** Distance de Chebyshev max(|dx|, |dy|) (zones carrées G/R/W). */
export function chebyshevDistance(a: number, b: number): number {
  return Math.max(Math.abs(CELL_X[a] - CELL_X[b]), Math.abs(CELL_Y[a] - CELL_Y[b]))
}

export function inLine(a: number, b: number): boolean {
  return CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]
}

export function inDiagonal(a: number, b: number): boolean {
  return Math.abs(CELL_X[a] - CELL_X[b]) === Math.abs(CELL_Y[a] - CELL_Y[b])
}

export function areAdjacent(a: number, b: number): boolean {
  return distance(a, b) === 1
}

// ───────────────────────────── directions ─────────────────────────────

/** Identifiants de direction (DirectionsEnum). */
export const Direction = {
  E: 0,
  SE: 1,
  S: 2,
  SW: 3,
  W: 4,
  NW: 5,
  N: 6,
  NE: 7,
} as const
export type DirectionId = (typeof Direction)[keyof typeof Direction]

/** Vecteur (dx, dy) de chaque direction 0..7. */
export const DIRECTION_DX: readonly number[] = [1, 1, 1, 0, -1, -1, -1, 0]
export const DIRECTION_DY: readonly number[] = [1, 0, -1, -1, -1, 0, 1, 1]
export const DIRECTION_VECTORS: readonly Point[] = DIRECTION_DX.map((dx, i) => Object.freeze({ x: dx, y: DIRECTION_DY[i] }))
/** Directions de déplacement (impaires) et diagonales logiques (paires), dans l'ordre du client. */
export const ORTHOGONAL_DIRECTIONS: readonly number[] = [1, 3, 5, 7]
export const CARDINAL_DIRECTIONS: readonly number[] = [0, 2, 4, 6]

/**
 * Les 4 directions de déplacement (pas de déplacement en diagonale en combat), dans l'ordre historique du
 * module : SE (1), NW (5), NE (7), SW (3). Cet ordre fixe l'ordre des voisins (déterminisme des BFS).
 */
export const DIRECTIONS: readonly Point[] = [DIRECTION_VECTORS[1], DIRECTION_VECTORS[5], DIRECTION_VECTORS[7], DIRECTION_VECTORS[3]]
const NEIGHBOR_DIRS = [1, 5, 7, 3]

export function isValidDirection(dir: number): boolean {
  return Number.isInteger(dir) && dir >= 0 && dir <= 7
}

/** Direction impaire : direction de déplacement (voisin par un côté). `IsOrthogonal` du code Haxe. */
export function isOrthogonal(dir: number): boolean {
  return isValidDirection(dir) && (dir & 1) === 1
}

/** Direction paire : diagonale logique (axe horizontal/vertical de l'écran). `IsCardinal` du code Haxe. */
export function isCardinal(dir: number): boolean {
  return isValidDirection(dir) && (dir & 1) === 0
}

export function oppositeDirection(dir: number): number {
  return (dir + 4) & 7
}

/** Rotation de `steps` huitièmes de tour (sens des identifiants croissants). */
export function rotateDirection(dir: number, steps: number): number {
  return (((dir + steps) % 8) + 8) % 8
}

/**
 * Direction EXACTE de `a` vers `b` (`GetLookDirection8Exact`) : la direction d dont la demi-droite issue de `a`
 * passe par `b` (en ligne → impaire, en diagonale → paire), ou −1 si les cellules ne sont pas alignées.
 * Contrairement au port Haxe (qui renvoie 1 pour a == b), renvoie −1 pour une même cellule.
 */
export function directionBetween(a: number, b: number): number {
  return directionBetweenXY(CELL_X[a], CELL_Y[a], CELL_X[b], CELL_Y[b])
}

/** Variante de `directionBetween` sur des coordonnées logiques. */
export function directionBetweenXY(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return -1
  if (dy === 0) return dx < 0 ? 5 : 1
  if (dx === 0) return dy < 0 ? 3 : 7
  if (dx === -dy) return dx < 0 ? 6 : 2
  if (dx === dy) return dx < 0 ? 4 : 0
  return -1
}

/**
 * Direction de déplacement (impaire) la plus proche de `a` vers `b` (`GetLookDirection4` du port Haxe) :
 * axe x si |dx| > |dy|, sinon axe y (égalité → axe y). Pour a == b, renvoie 3 comme le port.
 */
export function lookDirection4(a: number, b: number): number {
  const dx = CELL_X[b] - CELL_X[a]
  const dy = CELL_Y[b] - CELL_Y[a]
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 5
  return dy > 0 ? 7 : 3
}

/**
 * Direction parmi 8 de `a` vers `b` (`GetLookDirection8`) : exacte si les cellules sont alignées, sinon
 * approchée (octant). Renvoie −1 pour a == b.
 */
export function lookDirection8(a: number, b: number): number {
  const exact = directionBetween(a, b)
  if (exact >= 0 || a === b) return exact
  const dx = CELL_X[b] - CELL_X[a]
  const dy = CELL_Y[b] - CELL_Y[a]
  if (Math.abs(dx) < Math.abs(dy)) {
    if (dy > 0) return dx < 0 ? 6 : 7
    return dx < 0 ? 3 : 2
  }
  if (dx > 0) return dy > 0 ? 0 : 1
  return dy < 0 ? 4 : 5
}

/** Cellule à `steps` pas de `cellId` dans la direction `dir` (−1 si hors carte ou direction invalide). */
export function cellInDirection(cellId: number, dir: number, steps = 1): number {
  if (!isValidDirection(dir) || cellId < 0 || cellId >= CELL_COUNT) return -1
  return pointToCell(CELL_X[cellId] + DIRECTION_DX[dir] * steps, CELL_Y[cellId] + DIRECTION_DY[dir] * steps)
}

/**
 * Cellules successives depuis `cellId` (exclue) dans la direction `dir`, au plus `count` cellules ;
 * s'arrête au bord de la carte. Les cellules sont ajoutées à `out` (nouveau tableau par défaut).
 */
export function cellsInDirection(cellId: number, dir: number, count: number, out: number[] = []): number[] {
  if (!isValidDirection(dir) || cellId < 0 || cellId >= CELL_COUNT) return out
  let x = CELL_X[cellId]
  let y = CELL_Y[cellId]
  for (let i = 0; i < count; i++) {
    x += DIRECTION_DX[dir]
    y += DIRECTION_DY[dir]
    const c = pointToCell(x, y)
    if (c < 0) break
    out.push(c)
  }
  return out
}

/** Cellules strictement entre deux cellules alignées (ligne ou diagonale), de `a` vers `b` ; [] sinon. */
export function cellsBetween(a: number, b: number): number[] {
  const dir = directionBetween(a, b)
  if (dir < 0) return []
  const steps = Math.max(Math.abs(CELL_X[b] - CELL_X[a]), Math.abs(CELL_Y[b] - CELL_Y[a]))
  return cellsInDirection(a, dir, steps - 1)
}

// ───────────────────────────── portée de lancer ─────────────────────────────

/**
 * `to` est-elle dans la zone de PORTÉE d'un sort lancé depuis `from` ? (D2 `FightSpellCastFrame` + `Cross.as` /
 * `Lozenge.as`, mechanics.md §4.2, map-geometry.json#rangeShapes). Géométrie seule : la marchabilité de la case,
 * la LdV et la portée illimitée (63 sans ligne/diagonale/LdV, testée avant le bonus de PO) restent à l'appelant.
 *  - lancer en ligne ET en diagonale : croix 8 directions, (x ± r, y), (x, y ± r), (x ± r, y ± r) ;
 *  - en ligne seulement : (x ± r, y), (x, y ± r) ; en diagonale seulement : (x ± r, y ± r) ;
 *  - ni l'un ni l'autre : losange, min ≤ |dx| + |dy| ≤ max.
 * Avec min ≤ r ≤ max, où r compte des PAS : en diagonale, (x + r, y + r) est à r de portée (Manhattan 2r) — une PO
 * de 1 « ligne + diagonale » atteint les 8 cases autour du lanceur. min = 0 inclut la case du lanceur.
 */
export function isInCastRange(
  from: number,
  to: number,
  minRange: number,
  maxRange: number,
  castInLine: boolean,
  castInDiagonal: boolean,
): boolean {
  const adx = Math.abs(CELL_X[to] - CELL_X[from])
  const ady = Math.abs(CELL_Y[to] - CELL_Y[from])
  let r = adx + ady
  if (castInLine || castInDiagonal) {
    if (castInLine && (adx === 0 || ady === 0)) r = adx + ady
    else if (castInDiagonal && adx === ady) r = adx
    else return false
  }
  return r >= minRange && r <= maxRange
}

/** Cellules dans la zone de portée (`isInCastRange`), par identifiant croissant — ajoutées à `out`. */
export function castRangeCells(
  from: number,
  minRange: number,
  maxRange: number,
  castInLine: boolean,
  castInDiagonal: boolean,
  out: number[] = [],
): number[] {
  if (from < 0 || from >= CELL_COUNT) return out
  for (let c = 0; c < CELL_COUNT; c++) if (isInCastRange(from, c, minRange, maxRange, castInLine, castInDiagonal)) out.push(c)
  return out
}

// ───────────────────────────── voisinage ─────────────────────────────

/** Voisins orthogonaux précalculés (ordre SE, NW, NE, SW), tableaux partagés et gelés. */
const NEIGHBORS: readonly (readonly number[])[] = Array.from({ length: CELL_COUNT }, (_, id) => {
  const out: number[] = []
  for (const d of NEIGHBOR_DIRS) {
    const n = cellInDirection(id, d)
    if (n >= 0) out.push(n)
  }
  return Object.freeze(out)
})

/** Voisins diagonaux précalculés (directions 0, 2, 4, 6). */
const DIAGONAL_NEIGHBORS: readonly (readonly number[])[] = Array.from({ length: CELL_COUNT }, (_, id) => {
  const out: number[] = []
  for (const d of CARDINAL_DIRECTIONS) {
    const n = cellInDirection(id, d)
    if (n >= 0) out.push(n)
  }
  return Object.freeze(out)
})

/** Cellules adjacentes (orthogonales dans le repère logique) existant sur la carte — nouveau tableau. */
export function neighbors(cellId: number): number[] {
  return NEIGHBORS[cellId].slice()
}

/** Comme `neighbors` mais sans allocation : tableau partagé en lecture seule (chemins critiques). */
export function neighborsOf(cellId: number): readonly number[] {
  return NEIGHBORS[cellId]
}

/** Les (au plus) 4 cellules diagonales logiques autour d'une cellule (tableau partagé en lecture seule). */
export function diagonalNeighborsOf(cellId: number): readonly number[] {
  return DIAGONAL_NEIGHBORS[cellId]
}

// ───────────────────────────── affichage ─────────────────────────────

/** Position d'affichage isométrique : colonne (avec décalage d'une demi-case une ligne sur deux) et demi-ligne. */
export function cellToScreen(cellId: number, cellW: number, cellH: number): { px: number; py: number } {
  const row = Math.floor(cellId / MAP_WIDTH)
  const col = cellId % MAP_WIDTH
  return { px: col * cellW + (row % 2) * (cellW / 2), py: row * (cellH / 2) }
}
