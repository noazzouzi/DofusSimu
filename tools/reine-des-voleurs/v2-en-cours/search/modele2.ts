// Modèle « jeu réel » des Bonbombes, étendu aux variantes de la règle d'apparition donnée par le joueur
// (« en haut, à la 2e case du personnage ; si elle est occupée, à sa diagonale, en haut à droite »).
//
// Même sémantique que tools/reine-des-voleurs/modele-bombes.ts (vérifiée identique sur la règle 'n' par verif.ts) :
//  - début du tour d'un joueur : une Bonbombe apparaît sur la 1re case candidate libre et praticable ;
//  - explosion à la fin du tour SUIVANT du poseur ('next') ou à la fin du même tour ('same') ;
//  - explosion : bombes vivantes en DIAGONALE (1..10) → bleues ; rouge : tue joueurs + bombes EN LIGNE (1..10) ;
//    bleue : soigne les joueurs en ligne, tue les bombes en ligne ; les bombes tuées explosent (dfs ou bfs, la plus
//    proche d'abord, puis NE et sens horaire = comparePositions) ; un joueur mort fait exploser ses bombes.
// Repère logique (x, y) du dépôt : N écran = (−1, +1) (distance 2, id − 28) ; NE écran adjacent = (0, +1) ;
// NE à distance 2 = (0, +2) (id − 27), en ligne avec le joueur ; E écran = (+1, +1).
//
// Variantes d'apparition (case primaire, case de repli, puis « suite » = toutes les cases à distance ≥ 2, triées par
// distance puis N d'abord et sens horaire — la règle 'n' du modèle d'origine — sans les deux premières) :
//   A  N2  → NE2       : N à distance 2, repli NE à distance 2 du joueur (= règle 'n' d'origine)
//   B  N2  → N2+NE1    : N à distance 2, repli « en haut à droite de la case N » (−1, +2)
//   C  N4  → NE2       : N à distance 4 (−2, +2), repli NE à distance 2 du joueur
//   D  N4  → N4+NE1    : N à distance 4, repli en haut à droite de la case N (−2, +3)
//   E  N4  → NE4       : N à distance 4, repli NE à distance 4 (0, +4) (« 2e case » lue de la même façon)
import { readFileSync } from 'node:fs'
import { CELL_X, CELL_Y, CELL_COUNT, distance, lookDirection8, pointToCell } from '/home/user/DofusSimu/src/map/geometry'
import { comparePositions } from '/home/user/DofusSimu/src/engine/effects/summons'

export interface MapInfo { id: number; walk: Uint8Array; los: Uint8Array; red: number[]; blue: number[] }
export function loadMap(id = 137101312): MapInfo {
  const m = JSON.parse(readFileSync(`/home/user/DofusSimu/data/maps/${id}.json`, 'utf8')) as { redCells: number[]; blueCells: number[]; cells: { id: number; walkable: boolean; los: boolean }[] }
  const walk = new Uint8Array(CELL_COUNT)
  const los = new Uint8Array(CELL_COUNT)
  for (const c of m.cells) { if (c.walkable) walk[c.id] = 1; if (c.los) los[c.id] = 1 }
  return { id, walk, los, red: m.redCells, blue: m.blueCells }
}

export const VARIANTS: { id: string; label: string; first: [number, number][] }[] = [
  { id: 'A', label: 'N2→NE2', first: [[-1, 1], [0, 2]] },
  { id: 'B', label: 'N2→N2+NE1', first: [[-1, 1], [-1, 2]] },
  { id: 'C', label: 'N4→NE2', first: [[-2, 2], [0, 2]] },
  { id: 'D', label: 'N4→N4+NE1', first: [[-2, 2], [-2, 3]] },
  { id: 'E', label: 'N4→NE4', first: [[-2, 2], [0, 4]] },
]
export type Timing = 'next' | 'same'
export type Chain = 'dfs' | 'bfs'

/** Ordre 'n' (modèle d'origine) : distance ≥ 2, puis N d'abord et sens horaire, puis id. */
function nOrder(map: MapInfo, src: number): number[] {
  const o: number[] = []
  for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && distance(src, c) >= 2) o.push(c)
  const rank = (c: number) => (lookDirection8(src, c) + 2) & 7
  o.sort((a, b) => distance(src, a) - distance(src, b) || rank(a) - rank(b) || a - b)
  return o
}

/** Candidats d'apparition : cellules et rang conceptuel (0 primaire, 1 repli, 2 = au-delà). */
export interface SpawnList { cells: Int16Array; rank: Uint8Array }
const spawnCache = new Map<string, SpawnList>()
export function spawnList(map: MapInfo, v: number, src: number): SpawnList {
  const key = `${map.id}:${v}:${src}`
  let s = spawnCache.get(key)
  if (s) return s
  const cells: number[] = []
  const rank: number[] = []
  const first = VARIANTS[v].first
  first.forEach(([dx, dy], i) => {
    const c = pointToCell(CELL_X[src] + dx, CELL_Y[src] + dy)
    if (c >= 0 && map.walk[c]) { cells.push(c); rank.push(i) }
  })
  for (const c of nOrder(map, src)) if (!cells.includes(c)) { cells.push(c); rank.push(2) }
  s = { cells: Int16Array.from(cells), rank: Uint8Array.from(rank) }
  spawnCache.set(key, s)
  return s
}

export const xy = (c: number) => `${c}(${CELL_X[c]},${CELL_Y[c]})`
export function inLine10(a: number, b: number): boolean {
  if (a === b) return false
  const dx = CELL_X[a] - CELL_X[b], dy = CELL_Y[a] - CELL_Y[b]
  return (dx === 0 && dy >= -10 && dy <= 10) || (dy === 0 && dx >= -10 && dx <= 10)
}
export function inDiag10(a: number, b: number): boolean {
  const dx = Math.abs(CELL_X[a] - CELL_X[b])
  return dx >= 1 && dx <= 10 && dx === Math.abs(CELL_Y[a] - CELL_Y[b])
}

export interface Bomb { id: number; owner: number; cell: number; born: number; blue: boolean; alive: boolean }
export interface Player { idx: number; cell: number; alive: boolean }
export interface SimEvent { round: number; turn: number; kind: 'spawn' | 'explode' | 'death' | 'heal' | 'move' | 'blue'; who: number; cell: number; info?: string }
export interface SimState { players: Player[]; bombs: Bomb[]; monsters: Set<number> }
export interface SimOptions {
  rounds: number
  variant: number
  timing: Timing
  chain: Chain
  monsters?: number[]
  /** Déplacement scripté du joueur `idx` à la manche `round`, APRÈS l'apparition de sa bombe (renvoie la case finale). */
  move?: (round: number, idx: number, st: SimState) => number | undefined
  /** Phase « monstres » avant le tour du joueur `idx` (avant l'apparition) : peut déplacer joueurs/ennemis, tuer. */
  beforeTurn?: (round: number, idx: number, st: SimState) => void | { kill?: number[] }
  log?: boolean
}
export interface SimResult {
  ok: boolean
  deaths: { idx: number; round: number; turnOf: number; by: number }[]
  events: SimEvent[]
  healsBy: number[][]
  /** Apparitions au-delà de la case de repli (règle inconnue), par manche. */
  beyond: { round: number; idx: number; cell: number }[]
  /** Apparitions sur la case de repli (rang 1). */
  fallback: number
  /** Bombes vivantes pendant le tour de chaque joueur (après apparition). */
  bombsDuring: number[][]
  /** Cases des bombes (couleur au moment de l'apparition = rouge) : historique par manche. */
  externalDeaths: { idx: number; round: number }[]
}

export function simulate(map: MapInfo, startCells: number[], o: SimOptions): SimResult {
  const st: SimState = { players: startCells.map((cell, idx) => ({ idx, cell, alive: true })), bombs: [], monsters: new Set(o.monsters ?? []) }
  const events: SimEvent[] = []
  const deaths: SimResult['deaths'] = []
  const healsBy: number[][] = startCells.map(() => [])
  const beyond: SimResult['beyond'] = []
  const bombsDuring: number[][] = []
  const externalDeaths: SimResult['externalDeaths'] = []
  let fallback = 0
  let nextId = 0
  let curRound = 0, curTurn = 0
  const occupied = (c: number) => st.monsters.has(c) || st.players.some(p => p.alive && p.cell === c) || st.bombs.some(b => b.alive && b.cell === c)

  function killPlayer(p: Player, by: number, toKill: Bomb[]) {
    if (!p.alive) return
    p.alive = false
    deaths.push({ idx: p.idx, round: curRound, turnOf: curTurn, by })
    if (o.log) events.push({ round: curRound, turn: curTurn, kind: 'death', who: p.idx, cell: p.cell, info: `tué par la bombe #${by}` })
    for (const b of st.bombs) if (b.alive && b.owner === p.idx) toKill.push(b)
  }
  function explodeOne(b: Bomb): Bomb[] {
    b.alive = false
    if (o.log) events.push({ round: curRound, turn: curTurn, kind: 'explode', who: b.owner, cell: b.cell, info: `#${b.id} ${b.blue ? 'BLEUE' : 'rouge'}` })
    for (const c of st.bombs) if (c.alive && !c.blue && inDiag10(b.cell, c.cell)) {
      c.blue = true
      if (o.log) events.push({ round: curRound, turn: curTurn, kind: 'blue', who: c.owner, cell: c.cell, info: `#${c.id}` })
    }
    const toKill: Bomb[] = []
    for (const p of st.players) {
      if (!p.alive || !inLine10(b.cell, p.cell)) continue
      if (b.blue) {
        healsBy[p.idx].push(curRound)
        if (o.log) events.push({ round: curRound, turn: curTurn, kind: 'heal', who: p.idx, cell: p.cell, info: `par #${b.id}` })
      } else killPlayer(p, b.id, toKill)
    }
    for (const c of st.bombs) if (c.alive && inLine10(b.cell, c.cell)) toKill.push(c)
    const uniq = [...new Set(toKill)].filter(c => c.alive)
    uniq.sort((x, y) => comparePositions(b.cell, x.cell, y.cell))
    return uniq
  }
  function explode(b: Bomb) {
    if (!b.alive) return
    if (o.chain === 'dfs') {
      for (const c of explodeOne(b)) explode(c)
    } else {
      const q: Bomb[] = [b]
      while (q.length) {
        const x = q.shift()!
        if (!x.alive) continue
        q.push(...explodeOne(x))
      }
    }
  }
  for (let r = 1; r <= o.rounds; r++) {
    curRound = r
    const during: number[] = []
    for (const p of st.players) {
      curTurn = p.idx
      if (!p.alive) { during.push(-1); continue }
      const ext = o.beforeTurn?.(r, p.idx, st)
      if (ext && ext.kill) for (const k of ext.kill) {
        const victim = st.players[k]
        if (!victim.alive) continue
        const toKill: Bomb[] = []
        killPlayer(victim, -1, toKill)
        deaths.pop()
        externalDeaths.push({ idx: k, round: r })
        for (const b of toKill) explode(b)
      }
      if (!p.alive) { during.push(-1); continue }
      const sl = spawnList(map, o.variant, p.cell)
      let cell = -1, rk = 0
      for (let i = 0; i < sl.cells.length; i++) if (!occupied(sl.cells[i])) { cell = sl.cells[i]; rk = sl.rank[i]; break }
      if (cell >= 0) {
        if (rk === 1) fallback++
        if (rk >= 2) beyond.push({ round: r, idx: p.idx, cell })
        st.bombs.push({ id: nextId++, owner: p.idx, cell, born: r, blue: false, alive: true })
        if (o.log) events.push({ round: r, turn: p.idx, kind: 'spawn', who: p.idx, cell, info: rk === 0 ? 'primaire' : rk === 1 ? 'repli' : 'AU-DELÀ' })
      }
      during.push(st.bombs.filter(b => b.alive).length)
      const to = o.move?.(r, p.idx, st)
      if (to !== undefined && to !== p.cell) {
        if (o.log) events.push({ round: r, turn: p.idx, kind: 'move', who: p.idx, cell: to, info: `depuis ${p.cell}` })
        p.cell = to
      }
      const due = o.timing === 'next' ? r - 1 : r
      for (const b of st.bombs.slice()) if (b.alive && b.owner === p.idx && b.born === due) explode(b)
      if (!st.players.some(q => q.alive)) break
    }
    bombsDuring.push(during)
    st.bombs = st.bombs.filter(b => b.alive)
  }
  return { ok: deaths.length === 0, deaths, events, healsBy, beyond, fallback, bombsDuring, externalDeaths }
}

export function permutations<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a.slice()]
  const out: T[][] = []
  a.forEach((x, i) => {
    for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...p])
  })
  return out
}
export const PERMS4: number[][] = permutations([0, 1, 2, 3])
