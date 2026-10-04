/**
 * Recherche de chemins sur la grille de combat (docs/research/mechanics.md §5, map-geometry.json#pathfinding) :
 * déplacement 4-connexe dans le repère logique (jamais en diagonale), 1 PM par case, aucun combattant ni
 * cellule non marchable traversé. Les coûts étant uniformes, un BFS suffit.
 *
 * Le tacle n'est PAS pris en compte ici (il dépend des PA/PM restants à chaque pas : voir engine/move.ts) ;
 * ces fonctions donnent la géométrie (distances, chemin le plus court, cases atteignables).
 *
 * Performances : tampons typés réutilisés (`Int16Array` de 560 cases), aucune allocation pendant la
 * recherche ; seules les fonctions qui renvoient explicitement un tableau allouent leur résultat.
 * Les recherches ne sont pas réentrantes sur une même instance de `GridSearch` (les fonctions
 * utilitaires du module partagent une instance : ne pas les appeler depuis un rappel `passable`).
 */
import { CELL_COUNT, neighborsOf } from './geometry'

/** Prédicat de franchissement d'une cellule (marchable et inoccupée, en général). */
export type CellPredicate = (cellId: number) => boolean

/** Distance d'une cellule non atteinte. */
export const UNREACHABLE = -1
const MAX_STEPS = 0x7fff

/** Masque des cellules marchables d'une carte (1 = marchable en combat). */
export function walkableMask(cells: readonly { walkable: boolean }[]): Uint8Array {
  const out = new Uint8Array(CELL_COUNT)
  for (let i = 0; i < CELL_COUNT; i++) out[i] = cells[i]?.walkable ? 1 : 0
  return out
}

/**
 * Moteur de BFS réutilisable. Après `run(start, ...)` :
 *  - `dist[c]` = nombre de pas depuis `start` (−1 si non atteinte) ;
 *  - `prev[c]` = cellule précédente sur un plus court chemin (−1 pour `start`) ;
 *  - `order[0..count-1]` = cellules atteintes par distance croissante (`start` en premier).
 * Ordre d'exploration des voisins fixe (SE, NW, NE, SW) : résultats déterministes.
 */
export class GridSearch {
  readonly dist = new Int16Array(CELL_COUNT).fill(UNREACHABLE)
  readonly prev = new Int16Array(CELL_COUNT).fill(UNREACHABLE)
  readonly order = new Int16Array(CELL_COUNT)
  /** Nombre de cellules atteintes lors de la dernière recherche. */
  count = 0
  /** Cellule de départ de la dernière recherche (−1 si aucune). */
  start = -1

  /**
   * BFS depuis `start` : une cellule voisine n'est explorée que si `passable(c)` (la case de départ n'est pas
   * testée). `maxSteps` borne la distance (ex. PM disponibles). `stopAt`, si fourni, arrête la recherche dès
   * que cette cellule est atteinte (sa distance et son chemin sont alors définitifs). Renvoie `count`.
   */
  run(start: number, passable: CellPredicate, maxSteps = MAX_STEPS, stopAt = -1): number {
    this.dist.fill(UNREACHABLE)
    this.prev.fill(UNREACHABLE)
    this.count = 0
    this.start = start
    if (start < 0 || start >= CELL_COUNT) return 0
    const dist = this.dist
    const prev = this.prev
    const order = this.order
    dist[start] = 0
    order[0] = start
    let head = 0
    let tail = 1
    while (head < tail) {
      const c = order[head++]
      if (c === stopAt) break
      const d = dist[c]
      if (d >= maxSteps) continue
      const ns = neighborsOf(c)
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i]
        if (dist[n] !== UNREACHABLE || !passable(n)) continue
        dist[n] = d + 1
        prev[n] = c
        order[tail++] = n
      }
    }
    this.count = tail
    return tail
  }

  /** Chemin de la dernière recherche jusqu'à `target` (départ et arrivée inclus), ou null si non atteinte. */
  pathTo(target: number): number[] | null {
    if (target < 0 || target >= CELL_COUNT || this.dist[target] === UNREACHABLE) return null
    const path: number[] = new Array(this.dist[target] + 1)
    let c = target
    for (let i = path.length - 1; i >= 0; i--) {
      path[i] = c
      c = this.prev[c]
    }
    return path
  }

  /** Cellules atteintes à une distance comprise entre `minSteps` et `maxSteps` (ordre de BFS). */
  reached(minSteps = 0, maxSteps = MAX_STEPS): number[] {
    const out: number[] = []
    for (let i = 0; i < this.count; i++) {
      const c = this.order[i]
      const d = this.dist[c]
      if (d > maxSteps) break
      if (d >= minSteps) out.push(c)
    }
    return out
  }
}

const shared = new GridSearch()

/**
 * Distances (en pas) depuis `start` vers toutes les cellules, en ne traversant que les cellules `passable`.
 * Résultat copié dans `out` (alloué si absent) : −1 = non atteignable.
 */
export function bfsDistances(start: number, passable: CellPredicate, maxSteps = MAX_STEPS, out?: Int16Array): Int16Array {
  shared.run(start, passable, maxSteps)
  const res = out ?? new Int16Array(CELL_COUNT)
  res.set(shared.dist)
  return res
}

export interface PathOptions {
  /** La cellule d'arrivée peut être infranchissable (ex. aller « vers » une entité) : elle est atteinte sans être traversée. */
  allowBlockedTarget?: boolean
  /** Longueur maximale (en pas). */
  maxSteps?: number
}

/**
 * Plus court chemin 4-connexe de `from` à `to` (les deux inclus), ou null. `[from]` si from == to.
 * Les cellules intermédiaires et l'arrivée doivent être `passable` (sauf `allowBlockedTarget`).
 */
export function shortestPath(from: number, to: number, passable: CellPredicate, opts: PathOptions = {}): number[] | null {
  if (from < 0 || from >= CELL_COUNT || to < 0 || to >= CELL_COUNT) return null
  if (from === to) return [from]
  const pass = opts.allowBlockedTarget ? (c: number) => c === to || passable(c) : passable
  shared.run(from, pass, opts.maxSteps ?? MAX_STEPS, to)
  return shared.pathTo(to)
}

/** Nombre de pas du plus court chemin (−1 si aucun). */
export function pathLength(from: number, to: number, passable: CellPredicate, opts: PathOptions = {}): number {
  if (from < 0 || from >= CELL_COUNT || to < 0 || to >= CELL_COUNT) return UNREACHABLE
  if (from === to) return 0
  const pass = opts.allowBlockedTarget ? (c: number) => c === to || passable(c) : passable
  shared.run(from, pass, opts.maxSteps ?? MAX_STEPS, to)
  return shared.dist[to]
}

/**
 * Cellules atteignables depuis `start` avec au plus `mp` PM (sans tacle), `start` exclue,
 * par distance croissante puis ordre de BFS.
 */
export function cellsWithinMp(start: number, mp: number, passable: CellPredicate): number[] {
  if (mp <= 0) return []
  shared.run(start, passable, mp)
  return shared.reached(1, mp)
}

/**
 * Plus court chemin de `from` vers la cellule la plus proche satisfaisant `goal` (ex. une case adjacente à une
 * cible, une case en ligne de vue...). `from` elle-même est candidate. Renvoie le chemin (départ inclus) ou null.
 */
export function pathToNearest(
  from: number,
  goal: CellPredicate,
  passable: CellPredicate,
  maxSteps = MAX_STEPS,
): number[] | null {
  if (from < 0 || from >= CELL_COUNT) return null
  shared.run(from, passable, maxSteps)
  for (let i = 0; i < shared.count; i++) {
    const c = shared.order[i]
    if (goal(c)) return shared.pathTo(c)
  }
  return null
}

/** Chemin le plus court vers une case ADJACENTE à `target` (corps-à-corps), ou null. Déjà adjacent → [from]. */
export function pathToAdjacent(from: number, target: number, passable: CellPredicate, maxSteps = MAX_STEPS): number[] | null {
  if (target < 0 || target >= CELL_COUNT) return null
  const adj = neighborsOf(target)
  return pathToNearest(from, c => adj.includes(c), passable, maxSteps)
}
