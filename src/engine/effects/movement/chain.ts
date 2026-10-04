/**
 * Chaîne « plus proche voisin » entre cellules (port D3 `PortalUtils.GetPortalChainFromPortalCells`), utilisée :
 *  - pour la sortie d'un réseau de portails (dernier maillon de la chaîne partant du portail d'entrée) ;
 *  - par la téléportation 4 sur une zone non ponctuelle (`Teleport.GetTeleportedPosition`) : les cellules de la zone
 *    sont parcourues depuis la case ciblée (Fulgurance : de la cible vers le lanceur ⇒ case libre la plus proche de
 *    la cible).
 * Départage des égalités de distance (Manhattan) par l'angle orienté autour de la cellule courante, comme le port
 * (`GetNextNearestPortalCell`, y compris son tri `Array.Sort` .NET à comparateur arrondi). Pas sur un chemin critique.
 */
import { CELL_X, CELL_Y, distance } from '../../../map/geometry'

const LIKE = 0
const UNLIKE = 1
const CLOCKWISE = 2
const COUNTERCLOCKWISE = 3

/** `MathUtils.CompareAngles(p1, p2, p3)` (vecteurs p1→p2 et p1→p3). */
function compareAngles(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): number {
  const v1x = x2 - x1
  const v1y = y2 - y1
  const v2x = x3 - x1
  const v2y = y3 - y1
  const det = v1x * v2y - v1y * v2x
  if (det !== 0) return det > 0 ? CLOCKWISE : COUNTERCLOCKWISE
  return v1x >= 0 === v2x >= 0 && v1y >= 0 === v2y >= 0 ? LIKE : UNLIKE
}

/** `MathUtils.GetAngle` : angle en p1 du triangle (p1, p2, p3). */
function angleAt(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): number {
  const a = Math.hypot(x2 - x3, y2 - y3)
  const b = Math.hypot(x1 - x2, y1 - y2)
  const c = Math.hypot(x1 - x3, y1 - y3)
  return Math.acos((b * b + c * c - a * a) / (2 * b * c))
}

/** `MathUtils.GetPositiveOrientedAngle(t, t + (0, 1), cell)`. */
function orientedAngle(tx: number, ty: number, cell: number): number {
  const x = CELL_X[cell]
  const y = CELL_Y[cell]
  switch (compareAngles(tx, ty, tx, ty + 1, x, y)) {
    case LIKE:
      return 0
    case UNLIKE:
      return Math.PI
    case CLOCKWISE:
      return angleAt(tx, ty, tx, ty + 1, x, y)
    default:
      return 2 * Math.PI - angleAt(tx, ty, tx, ty + 1, x, y)
  }
}

/** `Array.Sort(T[], Comparison<T>)` de .NET pour ≤ 16 éléments (cas 2 / 3 câblés, sinon tri par insertion). */
function dotnetSmallSort(a: number[], cmp: (x: number, y: number) => number): void {
  const swapIfGreater = (i: number, j: number) => {
    if (cmp(a[i], a[j]) > 0) {
      const t = a[i]
      a[i] = a[j]
      a[j] = t
    }
  }
  if (a.length < 2) return
  if (a.length === 2) return swapIfGreater(0, 1)
  if (a.length === 3) {
    swapIfGreater(0, 1)
    swapIfGreater(0, 2)
    swapIfGreater(1, 2)
    return
  }
  // Au-delà de 16 éléments, .NET passe à l'introsort : cas jamais rencontré ici (égalités de distance), tri par insertion.
  for (let i = 0; i < a.length - 1; i++) {
    const t = a[i + 1]
    let j = i
    while (j >= 0 && cmp(t, a[j]) < 0) {
      a[j + 1] = a[j]
      j--
    }
    a[j + 1] = t
  }
}

/** `GetNextNearestPortalCell` : départage angulaire de cellules à égale distance de `cell`. */
function nextNearest(cell: number, nearest: number[]): number {
  const tx = CELL_X[cell]
  const ty = CELL_Y[cell]
  dotnetSmallSort(nearest, (p, q) => Math.floor(orientedAngle(tx, ty, p) - orientedAngle(tx, ty, q)))
  // GetNextNearestPortalWhenTargetedPortalCellIsNotContained
  if (nearest.length >= 2) {
    let prev = nearest[nearest.length - 1]
    for (let i = 0; i < nearest.length; i++) {
      const cur = nearest[i]
      const cmp = compareAngles(tx, ty, CELL_X[prev], CELL_Y[prev], CELL_X[cur], CELL_Y[cur])
      if (cmp === UNLIKE) {
        if (nearest.length <= 2) break
      } else if (cmp === COUNTERCLOCKWISE) return prev
      prev = cur
    }
  }
  return nearest[0]
}

/** `GetNearestPortalCell` : cellule de `pool` la plus proche de `cell` (distance < 63), −1 si aucune. */
export function nearestCell(cell: number, pool: readonly number[]): number {
  let best = 63
  let found: number[] | undefined
  let single = -1
  for (const c of pool) {
    const d = distance(cell, c)
    if (d < best) {
      best = d
      single = c
      found = undefined
    } else if (d === best && single >= 0) {
      if (found === undefined) found = [single]
      found.push(c)
    }
  }
  if (single < 0) return -1
  return found === undefined ? single : nextNearest(cell, found)
}

/**
 * Chaîne depuis `start` : à chaque pas, la cellule restante la plus proche. Renvoie les maillons SANS `start`
 * (tableau vide si aucun maillon) ; `ordered` inverse l'ordre (port `isOrdered`).
 */
export function nearestChain(start: number, cells: readonly number[], ordered = false): number[] {
  const pool = cells.slice()
  const chain: number[] = []
  let cur = start
  const total = pool.includes(cur) ? pool.length : pool.length + 1
  for (let i = 0; i < total; i++) {
    chain.push(cur)
    const k = pool.indexOf(cur)
    if (k >= 0) pool.splice(k, 1)
    const n = nearestCell(cur, pool)
    if (n < 0) break
    cur = n
  }
  if (chain.length < 2) return []
  chain.splice(chain.indexOf(start), 1)
  if (ordered) chain.reverse()
  return chain
}
