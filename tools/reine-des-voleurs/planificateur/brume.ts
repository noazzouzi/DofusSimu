// Reine des Voleurs sous Brume (sort 4697, puis 4696 sur sa case d'arrivée) : invisible, sa case n'est plus envoyée.
//
// Règle (joueur, 2026-10-10) : elle est sur la case du milieu de la brume ou sur une des cases « en haut ». Journaux du
// 2026-10-10 : 3 Brumes sur 4 la placent sur la ligne +y (vers le haut de l'écran, à l'opposé de la colonne des Crâs),
// à 1, 2 ou 3 cases du milieu (301 → 261, 204 → 177, 275 → 262) ; exception : 202 → 176, à côté de la ligne.
// Pour la trouver du premier coup : Flèche Perforante sur la case du milieu, lancée d'en dessous (même x, y plus petit).
// Sa zone (ligne de 3 cases derrière la cible) couvre le milieu et les 3 cases du haut, et repousse de 3 : la Reine finit
// sur la plus haute case de la ligne (elle était au milieu, toujours invisible) ou hors de la brume (de nouveau visible).
//
// Croyance : cases possibles, réduites à chaque lancer d'un Crâ (touchée : dans la zone, puis poussée ; pas touchée :
// hors de la zone). Une poussée ou une téléportation envoyée par le serveur avec sa case la donne exactement.
import type { SpellProfileX } from '../../../src/ai/core/spellProfile'
import { CELL_X, CELL_Y, cellInDirection, directionBetween, distance, isValidPoint, pointToCell } from '../../../src/map/geometry'
import { zoneCells } from '../../../src/map/zones'

/** Sous-sort de Brume qui pose la brume et rend la Reine invisible (sur la case où elle finit sa marche). */
export const BRUME = 4696
export const BRUME_RADIUS = 3
export const PERFORANTE = 32429

export interface Hidden {
  /** Case du milieu de la brume (dernière case connue). */
  center: number
  /** Cases possibles (vide : perdue). */
  cells: number[]
  /** Case donnée par le serveur (poussée, téléportation) : plus rien à déduire. */
  exact?: boolean
}

/** Cases possibles juste après la Brume posée en `center` : le milieu, puis la ligne +y jusqu'à 3 cases. */
export function brumeCells(center: number, walkable: (c: number) => boolean): number[] {
  const out = [center]
  for (let k = 1; k <= BRUME_RADIUS; k++) {
    const x = CELL_X[center]
    const y = CELL_Y[center] + k
    if (!isValidPoint(x, y)) break
    const c = pointToCell(x, y)
    if (walkable(c)) out.push(c)
  }
  return out
}

/** Cases où le sort blesse un ennemi (zones de ses lignes de dégâts), lancé de `from` sur `target`. */
export function hitCells(p: SpellProfileX, from: number, target: number): Set<number> {
  const out = new Set<number>()
  for (const l of p.damage) {
    if (!l.sides.enemy) continue
    for (const c of zoneCells(l.zone, l.aroundCaster ? from : target, from)) out.add(c)
  }
  return out
}

/** Poussée du sort (cases) sur un ennemi de sa zone, 0 sinon. */
export function pushOf(p: SpellProfileX): number {
  return Math.max(0, ...p.moves.filter(m => m.kind === 'push' && !m.onCaster && m.sides.enemy).map(m => m.cells))
}

/** Case après une poussée de `n` cases dans la direction `from` → `target`, arrêtée devant une case bloquée. */
export function pushed(cell: number, from: number, target: number, n: number, blocked: (c: number) => boolean): number {
  const dir = directionBetween(from, target)
  let at = cell
  for (let k = 0; k < n; k++) {
    const next = cellInDirection(at, dir, 1)
    if (next < 0 || blocked(next)) break
    at = next
  }
  return at
}

/**
 * Ce qu'un lancer apprend. Touchée : elle était dans la zone ; poussée si le sort pousse ; encore invisible, donc
 * encore dans la brume (`stillHidden`). Pas touchée : elle n'était pas dans la zone.
 */
export function learn(h: Hidden, p: SpellProfileX, from: number, target: number, hit: boolean, stillHidden: boolean,
  blocked: (c: number) => boolean): Hidden {
  if (h.exact || !h.cells.length) return h
  const zone = hitCells(p, from, target)
  if (!hit) return { ...h, cells: h.cells.filter(c => !zone.has(c)) }
  const n = pushOf(p)
  let cells = h.cells.filter(c => zone.has(c)).map(c => (n ? pushed(c, from, target, n, blocked) : c))
  if (stillHidden) cells = cells.filter(c => distance(c, h.center) <= BRUME_RADIUS)
  return { ...h, cells: [...new Set(cells)] }
}
