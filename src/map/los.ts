/**
 * Ligne de vue (LdV) sur la grille logique Dofus.
 *
 * Algorithme (inspiré de Dofus2Line du client) : on trace le segment entre les centres des deux
 * cellules dans le repère logique et on teste toutes les cellules traversées (hors départ/arrivée).
 *  - diagonale parfaite (|dx| = |dy|) : seules les cellules diagonales sont testées ;
 *  - sinon : parcours « supercover » ; quand le segment passe exactement par un coin, les deux
 *    cellules adjacentes au coin sont testées (la vue est bloquée si l'une d'elles bloque).
 * Une cellule bloque si elle n'a pas de LdV (obstacle) ou si elle est occupée par une entité.
 */
import { cellToPoint, pointToCell } from './geometry'

export type BlocksLos = (cellId: number) => boolean

/** Cellules intermédiaires traversées par la ligne a -> b (a et b exclus). */
export function lineCells(a: number, b: number): number[][] {
  const pa = cellToPoint(a)
  const pb = cellToPoint(b)
  const dx = pb.x - pa.x
  const dy = pb.y - pa.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  const out: number[][] = []
  if (adx === 0 && ady === 0) return out
  if (adx === ady) {
    for (let i = 1; i < adx; i++) {
      const c = pointToCell(pa.x + i * sx, pa.y + i * sy)
      if (c >= 0) out.push([c])
    }
    return out
  }
  // Parcours de grille (Amanatides-Woo) sur des cases unitaires centrées sur les coordonnées entières.
  let x = pa.x
  let y = pa.y
  const tDeltaX = adx === 0 ? Infinity : 1 / adx
  const tDeltaY = ady === 0 ? Infinity : 1 / ady
  let tMaxX = adx === 0 ? Infinity : 0.5 / adx
  let tMaxY = ady === 0 ? Infinity : 0.5 / ady
  const EPS = 1e-9
  while (true) {
    if (Math.abs(tMaxX - tMaxY) < EPS) {
      // Passage exact par un coin : les deux voisines sont « touchées ».
      const c1 = pointToCell(x + sx, y)
      const c2 = pointToCell(x, y + sy)
      x += sx
      y += sy
      tMaxX += tDeltaX
      tMaxY += tDeltaY
      if (x === pb.x && y === pb.y) break
      const group = [c1, c2].filter(c => c >= 0 && c !== b)
      if (group.length) out.push(group)
      const c = pointToCell(x, y)
      if (c >= 0) out.push([c])
      continue
    }
    if (tMaxX < tMaxY) {
      x += sx
      tMaxX += tDeltaX
    } else {
      y += sy
      tMaxY += tDeltaY
    }
    if (x === pb.x && y === pb.y) break
    const c = pointToCell(x, y)
    if (c >= 0) out.push([c])
  }
  return out
}

export function hasLineOfSight(a: number, b: number, blocks: BlocksLos): boolean {
  for (const group of lineCells(a, b)) {
    if (group.some(blocks)) return false
  }
  return true
}
