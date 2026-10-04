/**
 * Ligne de vue (LdV) — algorithme EXACT du client (docs/research/mechanics.md §3, map-geometry.json#lineOfSight).
 *
 * Le client Dofus 2 (`LosDetector` → `Dofus2Line` → `MapTools.getLOSCellsVector`, code Haxe partagé avec
 * Dofus 3) trace la ligne entre les CENTRES des deux cellules dans le repère logique (x, y) avec un DDA ;
 * le portage C# du code Haxe D3 est `MapTools.GetCellsIdBetween` (.cache/domath/haxe/Tools/MapTools.cs) :
 *
 *   d = √(dx² + dy²) ; pasX = |d/dx| (∞ si dx = 0) ; pasY = |d/dy| ; progX = pasX/2 ; progY = pasY/2
 *   tant que (x, y) ≠ cible :
 *     si |progX − progY| < 1e-4 : x += sx, y += sy   (passage EXACT par un coin : pas diagonal,
 *                                                       les deux cases latérales ne sont PAS testées)
 *     sinon si progX < progY    : x += sx
 *     sinon                     : y += sy
 *     ajouter cellule(x, y)
 *
 * La liste exclut la case de départ et se termine par la case cible. Elle est symétrique (A→B et B→A testent
 * les mêmes cases intermédiaires) et vérifiée identique à la décompilation Kohana sur les 313 040 paires.
 *
 * Règle de visibilité : chaque case INTERMÉDIAIRE doit être transparente (los = true) et sans entité
 * bloquante (tout combattant vivant, sauf le combattant actif) ; la case CIBLE doit seulement être
 * transparente (son occupant ne bloque pas). Les marques (glyphes, pièges...) ne bloquent jamais.
 *
 * Performances : les lignes sont précalculées paresseusement par cellule source (toutes les cibles d'un
 * coup, tableaux typés) ; une requête de LdV ne fait alors aucune allocation.
 */
import { CELL_COUNT, CELL_X, CELL_Y, pointToCell } from './geometry'

/** Prédicat de blocage d'une cellule (obstacle `los = false` et/ou entité bloquante). */
export type BlocksLos = (cellId: number) => boolean

const EPSILON = 0.0001

/**
 * Trace la ligne du client de `a` vers `b` (DDA de `GetCellsIdBetween`) et ajoute les cellules à `out`
 * (`a` exclue, `b` incluse en dernier). Les points hors carte sont ignorés (jamais rencontrés en pratique :
 * la carte est convexe dans le repère logique). Renvoie `out`.
 */
export function traceLine(a: number, b: number, out: number[] = []): number[] {
  if (a === b || a < 0 || b < 0 || a >= CELL_COUNT || b >= CELL_COUNT) return out
  let x = CELL_X[a]
  let y = CELL_Y[a]
  const x2 = CELL_X[b]
  const y2 = CELL_Y[b]
  const dx = x2 - x
  const dy = y2 - y
  // Mêmes opérations flottantes que le port C# (doubles IEEE, √ correctement arrondie) : résultats identiques.
  const dist = Math.sqrt(dx * dx + dy * dy)
  const stepX = dx / dist
  const stepY = dy / dist
  const absStepX = Math.abs(1 / stepX)
  const absStepY = Math.abs(1 / stepY)
  const signX = stepX < 0 ? -1 : 1
  const signY = stepY < 0 ? -1 : 1
  let progressX = 0.5 * absStepX
  let progressY = 0.5 * absStepY
  while (x !== x2 || y !== y2) {
    if (Math.abs(progressX - progressY) < EPSILON) {
      progressX += absStepX
      progressY += absStepY
      x += signX
      y += signY
    } else if (progressX < progressY) {
      progressX += absStepX
      x += signX
    } else {
      progressY += absStepY
      y += signY
    }
    const c = pointToCell(x, y)
    if (c >= 0) out.push(c)
  }
  return out
}

// Cache paresseux par source : offsets[a] (561 entrées) et données (cellules de toutes les lignes depuis a).
const LINE_OFFSETS: (Int32Array | undefined)[] = new Array(CELL_COUNT)
const LINE_DATA: (Int16Array | undefined)[] = new Array(CELL_COUNT)
const scratch: number[] = []

function linesFrom(a: number): void {
  const offsets = new Int32Array(CELL_COUNT + 1)
  const all: number[] = []
  for (let b = 0; b < CELL_COUNT; b++) {
    offsets[b] = all.length
    scratch.length = 0
    traceLine(a, b, scratch)
    for (let i = 0; i < scratch.length; i++) all.push(scratch[i])
  }
  offsets[CELL_COUNT] = all.length
  LINE_OFFSETS[a] = offsets
  LINE_DATA[a] = Int16Array.from(all)
}

/**
 * Cellules de la ligne du client de `a` vers `b` (`a` exclue, `b` incluse en dernier), dans l'ordre du tracé.
 * Vue en lecture seule sur le cache (aucune copie) : ne pas la modifier.
 */
export function losLine(a: number, b: number): Int16Array {
  if (a < 0 || a >= CELL_COUNT || b < 0 || b >= CELL_COUNT) return EMPTY
  if (!LINE_OFFSETS[a]) linesFrom(a)
  const off = LINE_OFFSETS[a]!
  return LINE_DATA[a]!.subarray(off[b], off[b + 1])
}
const EMPTY = new Int16Array(0)

/** Cellules de la ligne de `a` vers `b` (`a` exclue, `b` incluse) — nouveau tableau. */
export function losCells(a: number, b: number): number[] {
  return Array.from(losLine(a, b))
}

/** Cellules INTERMÉDIAIRES de la ligne (ni `a` ni `b`), dans l'ordre du tracé — nouveau tableau. */
export function lineCells(a: number, b: number): number[] {
  const line = losLine(a, b)
  return Array.from(line.subarray(0, Math.max(0, line.length - 1)))
}

/**
 * Ligne de vue de `a` vers `b` : vraie si aucune cellule intermédiaire ne bloque.
 * `blocks` n'est appelé que sur les cellules intermédiaires (obstacles ET entités) ; `targetBlocks`, optionnel,
 * teste la cellule cible (seulement son drapeau `los` : l'entité ciblée ne bloque pas).
 * a == b → vrai. Aucune allocation (lecture directe du cache).
 */
export function hasLineOfSight(a: number, b: number, blocks: BlocksLos, targetBlocks?: BlocksLos): boolean {
  if (a === b) return !targetBlocks || !targetBlocks(b)
  if (a < 0 || a >= CELL_COUNT || b < 0 || b >= CELL_COUNT) return false
  if (!LINE_OFFSETS[a]) linesFrom(a)
  const off = LINE_OFFSETS[a]!
  const data = LINE_DATA[a]!
  const end = off[b + 1] - 1 // index de la cible
  for (let i = off[b]; i < end; i++) if (blocks(data[i])) return false
  return !targetBlocks || !targetBlocks(b)
}

/**
 * Prédicat de LdV statique pour une carte : cellule opaque (`los = false`) ou absente.
 * À combiner avec l'occupation des cellules pour la règle complète.
 */
export function opaqueCells(cells: readonly { los: boolean }[]): Uint8Array {
  const out = new Uint8Array(CELL_COUNT)
  for (let i = 0; i < CELL_COUNT; i++) out[i] = cells[i]?.los ? 0 : 1
  return out
}

/**
 * LdV sur une carte selon la règle du client : cellules intermédiaires transparentes et inoccupées, cellule
 * cible transparente. `opaque` vient de `opaqueCells(map.cells)` ; `occupied(c)` indique une entité bloquante
 * (le combattant actif doit être exclu par l'appelant).
 */
export function hasLineOfSightOnMap(
  opaque: Uint8Array,
  a: number,
  b: number,
  occupied?: (cellId: number) => boolean,
): boolean {
  if (a === b) return true
  if (a < 0 || a >= CELL_COUNT || b < 0 || b >= CELL_COUNT) return false
  if (!LINE_OFFSETS[a]) linesFrom(a)
  const off = LINE_OFFSETS[a]!
  const data = LINE_DATA[a]!
  const end = off[b + 1] - 1
  for (let i = off[b]; i < end; i++) {
    const c = data[i]
    if (opaque[c] || (occupied && occupied(c))) return false
  }
  return !opaque[b]
}
