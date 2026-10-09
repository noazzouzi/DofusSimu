// Simulateur rapide (même sémantique que modele2.simulate, sans journal) pour la recherche exhaustive.
// Vérifié contre modele2.simulate par verif.ts (mêmes morts, mêmes manches, mêmes soins).
import { CELL_X, CELL_Y, CELL_COUNT, neighborsOf } from '../../../../src/map/geometry'
import { comparePositions } from '../../../../src/engine/effects/summons'
import { spawnList, VARIANTS, type MapInfo } from './modele2'

const NV = VARIANTS.length
/** Listes d'apparition aplaties : SL[v][cell] = { cells, rank }. */
let SLc: Int16Array[][] = []
let SLr: Uint8Array[][] = []
export function initFast(map: MapInfo) {
  SLc = []; SLr = []
  walkMask = map.walk
  nbr.length = 0
  for (let c = 0; c < CELL_COUNT; c++) nbr.push([...neighborsOf(c)].filter(x => x >= 0))
  for (let v = 0; v < NV; v++) {
    SLc.push([]); SLr.push([])
    for (let c = 0; c < CELL_COUNT; c++) {
      if (!map.walk[c]) { SLc[v].push(new Int16Array(0)); SLr[v].push(new Uint8Array(0)); continue }
      const s = spawnList(map, v, c)
      SLc[v].push(s.cells); SLr[v].push(s.rank)
    }
  }
}

const CAP = 128
const bc = new Int16Array(CAP), bo = new Int8Array(CAP), bb = new Int16Array(CAP), bl = new Uint8Array(CAP), ba = new Uint8Array(CAP)
let nb = 0
const occ = new Int16Array(CELL_COUNT)
const pc = new Int16Array(8), pa = new Uint8Array(8)
let np = 4
let curRound = 0
let firstDeath = 0
let chainBfs = false
let deathBy = -1
let deathIdx = -1
/** Statistiques de la dernière simulation. */
export const stats = {
  healLast: new Int16Array(8), // dernière manche de soin par joueur
  maxGap: new Int16Array(8), // plus grand écart entre deux soins (en comptant depuis la manche 0)
  heals: new Int16Array(8),
  beyond: 0, // apparitions au-delà du repli
  fallback: 0,
  firstBeyond: 0,
  bombsSum: 0, bombsN: 0, // pour le multiplicateur de la Reine
  deathIdx: -1, deathTurnOf: -1, deathBy: -1,
  pm: 0,
}

function lineOrDiag(a: number, b: number): number {
  // 1 = en ligne ≤ 10, 2 = en diagonale ≤ 10, 0 sinon
  if (a === b) return 0
  const dx = CELL_X[a] - CELL_X[b], dy = CELL_Y[a] - CELL_Y[b]
  if (dx === 0) return dy >= -10 && dy <= 10 ? 1 : 0
  if (dy === 0) return dx >= -10 && dx <= 10 ? 1 : 0
  const ax = dx < 0 ? -dx : dx
  const ay = dy < 0 ? -dy : dy
  return ax === ay && ax <= 10 ? 2 : 0
}

function killPlayer(i: number, toKill: number[]) {
  if (!pa[i]) return
  pa[i] = 0
  occ[pc[i]]--
  if (!firstDeath) { firstDeath = curRound; stats.deathIdx = i; stats.deathBy = deathBy }
  for (let j = 0; j < nb; j++) if (ba[j] && bo[j] === i) toKill.push(j)
}

function explodeOne(i: number): number[] {
  ba[i] = 0
  occ[bc[i]]--
  const cell = bc[i]
  for (let j = 0; j < nb; j++) if (ba[j] && !bl[j] && lineOrDiag(cell, bc[j]) === 2) bl[j] = 1
  const toKill: number[] = []
  for (let p = 0; p < np; p++) {
    if (!pa[p] || lineOrDiag(cell, pc[p]) !== 1) continue
    if (bl[i]) {
      const g = curRound - stats.healLast[p]
      if (g > stats.maxGap[p]) stats.maxGap[p] = g
      stats.healLast[p] = curRound
      stats.heals[p]++
    } else { deathBy = i; killPlayer(p, toKill) }
  }
  for (let j = 0; j < nb; j++) if (ba[j] && lineOrDiag(cell, bc[j]) === 1) toKill.push(j)
  // unicité + vivantes + tri comparePositions
  const out: number[] = []
  for (const j of toKill) if (ba[j] && !out.includes(j)) out.push(j)
  if (out.length > 1) out.sort((x, y) => comparePositions(cell, bc[x], bc[y]))
  return out
}
function explode(i: number) {
  if (!ba[i]) return
  if (!chainBfs) {
    const nx = explodeOne(i)
    for (const j of nx) explode(j)
  } else {
    const q = [i]
    let h = 0
    while (h < q.length) {
      const x = q[h++]
      if (!ba[x]) continue
      const nx = explodeOne(x)
      for (const j of nx) q.push(j)
    }
  }
}

export interface FastOpts {
  variant: number
  timing: 0 | 1 // 0 = next, 1 = same
  chain: 0 | 1 // 0 = dfs, 1 = bfs
  rounds: number
  /** Case visée à la fin de la manche r (r = 1, 2, ...) par joueur, ou -1 : moves[r-1][idx]. Pas de contrôle de chemin. */
  moves?: Int16Array[]
  monsters?: number[]
  /** Arrêter à la première mort (recherche). */
  stopAtDeath?: boolean
  /** Si défini : chaque déplacement scripté doit avoir un chemin libre de ≤ maxPM pas (sinon renvoie BLOCKED). */
  maxPM?: number
}
export const BLOCKED = 999
const nbr: number[][] = []
let walkMask: Uint8Array = new Uint8Array(0)
const bfsD = new Int16Array(CELL_COUNT)
const bfsQ = new Int16Array(CELL_COUNT)
/** Longueur du chemin from→to (cases libres : praticables et occ = 0), ou -1 si > max. */
export function pathLen(from: number, to: number, max: number): number {
  if (from === to) return 0
  if (occ[to] !== 0 || !walkMask[to]) return -1
  bfsD.fill(-1)
  let h = 0, t = 0
  bfsQ[t++] = from; bfsD[from] = 0
  while (h < t) {
    const c = bfsQ[h++]
    const d = bfsD[c]
    if (d >= max) continue
    for (const nn of nbr[c]) {
      if (bfsD[nn] >= 0 || !walkMask[nn] || occ[nn] !== 0) continue
      bfsD[nn] = d + 1
      if (nn === to) return d + 1
      bfsQ[t++] = nn
    }
  }
  return -1
}

/** Renvoie la manche de la première mort par bombe (0 = aucune). Joueurs dans l'ordre de jeu. */
export function fastSim(cells: ArrayLike<number>, o: FastOpts): number {
  np = cells.length
  occ.fill(0)
  nb = 0
  firstDeath = 0
  chainBfs = o.chain === 1
  stats.healLast.fill(1); stats.maxGap.fill(0); stats.heals.fill(0) // référence manche 1 : Mort en Sursis au plus tôt au tour 2 de la Reine
  stats.beyond = 0; stats.fallback = 0; stats.firstBeyond = 0; stats.bombsSum = 0; stats.bombsN = 0
  stats.deathIdx = -1; stats.deathTurnOf = -1; stats.deathBy = -1; stats.pm = 0
  for (let i = 0; i < np; i++) { pc[i] = cells[i]; pa[i] = 1; occ[cells[i]]++ }
  if (o.monsters) for (const m of o.monsters) occ[m]++
  const v = o.variant
  const stop = o.stopAtDeath !== false
  for (let r = 1; r <= o.rounds; r++) {
    curRound = r
    for (let p = 0; p < np; p++) {
      if (!pa[p]) continue
      // apparition
      const L = SLc[v][pc[p]], R = SLr[v][pc[p]]
      for (let k = 0; k < L.length; k++) {
        const c = L[k]
        if (occ[c] === 0) {
          if (nb >= CAP) throw new Error('CAP')
          bc[nb] = c; bo[nb] = p; bb[nb] = r; bl[nb] = 0; ba[nb] = 1; nb++
          occ[c]++
          if (R[k] === 1) stats.fallback++
          else if (R[k] >= 2) { stats.beyond++; if (!stats.firstBeyond) stats.firstBeyond = r }
          break
        }
      }
      let alive = 0
      for (let j = 0; j < nb; j++) alive += ba[j]
      stats.bombsSum += alive; stats.bombsN++
      // déplacement
      if (o.moves && r <= o.moves.length) {
        const to = o.moves[r - 1][p]
        if (to >= 0 && to !== pc[p]) {
          if (o.maxPM !== undefined) {
            occ[pc[p]]--
            const L2 = pathLen(pc[p], to, o.maxPM)
            occ[pc[p]]++
            if (L2 < 0) return BLOCKED
            stats.pm += L2
          }
          occ[pc[p]]--; pc[p] = to; occ[to]++
        }
      }
      // explosions dues
      const due = o.timing === 0 ? r - 1 : r
      const firstBefore = firstDeath
      for (let j = 0; j < nb; j++) if (ba[j] && bo[j] === p && bb[j] === due) explode(j)
      if (firstDeath && !firstBefore) stats.deathTurnOf = p
      if (firstDeath && stop) return firstDeath
    }
    // compactage
    let k = 0
    for (let j = 0; j < nb; j++) if (ba[j]) { bc[k] = bc[j]; bo[k] = bo[j]; bb[k] = bb[j]; bl[k] = bl[j]; ba[k] = 1; k++ }
    nb = k
  }
  // écart final (dernier soin → fin)
  for (let p = 0; p < np; p++) {
    const g = o.rounds + 1 - stats.healLast[p]
    if (g > stats.maxGap[p]) stats.maxGap[p] = g
  }
  return firstDeath
}
