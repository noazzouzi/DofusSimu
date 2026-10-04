/**
 * Zones d'effet des sorts (zoneDescr DofusDB). Les formes sont décrites par un caractère :
 *  P point · C cercle · X croix · L ligne · T ligne perpendiculaire · D damier · O anneau ·
 *  Q croix sans centre · G carré · # / + croix diagonale · U demi-cercle · V cône · W bord de carré ·
 *  R rectangle · A / a toute la carte · - ligne perpendiculaire (alias) · / ligne depuis le lanceur.
 * `size` = param1, `minSize` = param2 (rayon intérieur exclu pour les formes pleines).
 */
import type { ZoneSpec } from '../data/model'
import { CELL_COUNT, cellToPoint, distance, pointToCell, type Point } from './geometry'

/** Direction unitaire (dans le repère logique) du lanceur vers la cible ; à défaut (+1, 0). */
export function castDirection(from: number, to: number): Point {
  const a = cellToPoint(from)
  const b = cellToPoint(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return { x: 1, y: 0 }
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx), y: 0 }
  return { x: 0, y: Math.sign(dy) }
}

export function shapeChar(shape: number | string): string {
  return typeof shape === 'number' ? String.fromCharCode(shape) : shape
}

/**
 * Cellules couvertes par une zone centrée sur `center`, lancée depuis `casterCell`.
 * Les cellules hors carte sont ignorées ; l'appelant filtre les cellules non marchables si besoin.
 */
export function zoneCells(zone: ZoneSpec, center: number, casterCell: number): number[] {
  const shape = shapeChar(zone.shape)
  const size = Math.max(0, zone.size | 0)
  const min = Math.max(0, zone.minSize | 0)
  const c = cellToPoint(center)
  const dir = castDirection(casterCell, center)
  const out: number[] = []
  const push = (x: number, y: number) => {
    const id = pointToCell(x, y)
    if (id >= 0 && !out.includes(id)) out.push(id)
  }
  switch (shape) {
    case 'P':
      push(c.x, c.y)
      break
    case 'C': // cercle (losange de distance de Manhattan)
      for (let dx = -size; dx <= size; dx++)
        for (let dy = -size; dy <= size; dy++) {
          const d = Math.abs(dx) + Math.abs(dy)
          if (d <= size && d >= min) push(c.x + dx, c.y + dy)
        }
      break
    case 'O': // anneau
      for (let dx = -size; dx <= size; dx++)
        for (let dy = -size; dy <= size; dy++) if (Math.abs(dx) + Math.abs(dy) === size) push(c.x + dx, c.y + dy)
      break
    case 'D': // damier
      for (let dx = -size; dx <= size; dx++)
        for (let dy = -size; dy <= size; dy++) {
          const d = Math.abs(dx) + Math.abs(dy)
          if (d <= size && d % 2 === 0) push(c.x + dx, c.y + dy)
        }
      break
    case 'X': // croix
    case 'Q': // croix sans centre
      if (shape === 'X' && min === 0) push(c.x, c.y)
      for (let i = Math.max(1, min); i <= size; i++) {
        push(c.x + i, c.y)
        push(c.x - i, c.y)
        push(c.x, c.y + i)
        push(c.x, c.y - i)
      }
      break
    case '+': // croix diagonale
    case '#':
      if (min === 0) push(c.x, c.y)
      for (let i = Math.max(1, min); i <= size; i++) {
        push(c.x + i, c.y + i)
        push(c.x - i, c.y - i)
        push(c.x + i, c.y - i)
        push(c.x - i, c.y + i)
      }
      break
    case 'G': // carré
      for (let dx = -size; dx <= size; dx++) for (let dy = -size; dy <= size; dy++) push(c.x + dx, c.y + dy)
      break
    case 'W': // bord de carré
      for (let dx = -size; dx <= size; dx++)
        for (let dy = -size; dy <= size; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === size) push(c.x + dx, c.y + dy)
      break
    case 'L': // ligne dans la direction du lancer, à partir du centre
      for (let i = min; i <= size; i++) push(c.x + dir.x * i, c.y + dir.y * i)
      break
    case '/': // ligne depuis le lanceur
      for (let i = 0; i <= size; i++) push(c.x + dir.x * i, c.y + dir.y * i)
      break
    case 'T': // ligne perpendiculaire
    case '-':
      push(c.x, c.y)
      for (let i = 1; i <= size; i++) {
        push(c.x + dir.y * i, c.y + dir.x * i)
        push(c.x - dir.y * i, c.y - dir.x * i)
      }
      break
    case 'R': // rectangle : longueur size dans la direction, largeur min de chaque côté
      for (let i = 0; i <= size; i++)
        for (let j = -min; j <= min; j++) push(c.x + dir.x * i + dir.y * j, c.y + dir.y * i + dir.x * j)
      break
    case 'U': // demi-cercle tourné vers le lanceur
    case 'V': // cône s'ouvrant dans la direction du lancer
      for (let i = 0; i <= size; i++)
        for (let j = -i; j <= i; j++) {
          const s = shape === 'U' ? -1 : 1
          push(c.x + s * dir.x * i + dir.y * j, c.y + s * dir.y * i + dir.x * j)
        }
      break
    case 'A':
    case 'a':
      for (let id = 0; id < CELL_COUNT; id++) out.push(id)
      break
    default:
      push(c.x, c.y)
  }
  return out
}

/**
 * Efficacité d'un effet sur une cellule de la zone : baisse de `decreaseStepPct` % par cellule
 * d'éloignement du centre, au plus `maxDecreaseCount` paliers.
 */
export function zoneEfficiency(zone: ZoneSpec, center: number, cell: number): number {
  if (!zone.decreaseStepPct) return 1
  const shape = shapeChar(zone.shape)
  if (shape === 'P' || shape === 'A' || shape === 'a') return 1
  const steps = Math.min(distance(center, cell), zone.maxDecreaseCount || Infinity)
  return Math.max(0, 1 - (steps * zone.decreaseStepPct) / 100)
}
