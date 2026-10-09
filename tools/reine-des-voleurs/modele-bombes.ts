// Modèle « jeu réel » des Bonbombes sur la carte 137101312 (Traversée), indépendant du moteur (qui fait exploser
// la bombe à la fin de son 1er tour — divergence documentée dans modele-combat.md).
//
// Règles modélisées (sources : données 3.6 + DofusWiki Queen_of_Thieves, texte 2020 + Boss en Bref 2026) :
//  - au DÉBUT du tour de chaque joueur, une Bonbombe apparaît sur la 1re case libre et marchable à distance >= 2, dans
//    l'ordre de comparePositions (distance, puis NE, E, SE, S, SO, O, NO, N) — même ordre que DofusWiki (« 2 cases au
//    nord-est, sinon 2 cases à l'est, et ainsi de suite dans le sens horaire ») ;
//  - elle explose à la FIN du tour SUIVANT de son invocateur (1 tour après : 1 à 2 bombes par joueur en jeu) ;
//  - explosion (ordre DofusWiki) : 1) toute bombe vivante en DIAGONALE (1 à 10 pas) devient bleue ; 2) rouge : tue tous
//    les joueurs et toutes les bombes EN LIGNE (1 à 10 cases) ; bleue : soigne les joueurs en ligne, tue les bombes en
//    ligne ; 3) les bombes tuées explosent à leur tour (la plus proche d'abord, puis NE et sens horaire) ;
//  - un joueur qui meurt fait exploser ses bombes ; les zones ignorent la ligne de vue (piliers inutiles).
// Mode de chaîne : 'dfs' (chaque bombe tuée explose aussitôt, récursivement) ou 'bfs' (file d'attente).
import { readFileSync } from 'node:fs'
import { CELL_X, CELL_Y, CELL_COUNT, distance, lookDirection8 } from '/home/user/DofusSimu/src/map/geometry'
import { comparePositions } from '/home/user/DofusSimu/src/engine/effects/summons'

export interface MapInfo { id: number; walk: Uint8Array; red: number[]; blue: number[] }

export function loadMap(id = 137101312): MapInfo {
  const m = JSON.parse(readFileSync(`/home/user/DofusSimu/data/maps/${id}.json`, 'utf8')) as { redCells: number[]; blueCells: number[]; cells: { id: number; walkable: boolean }[] }
  const walk = new Uint8Array(CELL_COUNT)
  for (const c of m.cells) if (c.walkable) walk[c.id] = 1
  return { id, walk, red: m.redCells, blue: m.blueCells }
}

const orderCache = new Map<string, number[]>()
/** Cases candidates d'apparition depuis `src`, dans l'ordre d'essai. */
export function spawnOrder(map: MapInfo, src: number, rule: 'ne' | 'n' = 'ne'): number[] {
  const key = `${rule}:${src}`
  let o = orderCache.get(key)
  if (!o) {
    o = []
    for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && distance(src, c) >= 2) o.push(c)
    if (rule === 'ne') o.sort((a, b) => comparePositions(src, a, b))
    else {
      // N (6) d'abord puis sens horaire : 6,7,0,1,…
      const rank = (c: number) => (lookDirection8(src, c) + 2) & 7
      o.sort((a, b) => distance(src, a) - distance(src, b) || rank(a) - rank(b) || a - b)
    }
    orderCache.set(key, o)
  }
  return o
}

export const xy = (c: number) => `${c}(${CELL_X[c]},${CELL_Y[c]})`
const inLine10 = (a: number, b: number) => a !== b && (CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]) && distance(a, b) <= 10
const inDiag10 = (a: number, b: number) => {
  const dx = Math.abs(CELL_X[a] - CELL_X[b])
  return dx >= 1 && dx <= 10 && dx === Math.abs(CELL_Y[a] - CELL_Y[b])
}

export interface Bomb { id: number; owner: number; cell: number; born: number; blue: boolean; alive: boolean }
export interface Player { idx: number; cell: number; alive: boolean }
export interface SimEvent { round: number; turn: number; kind: 'spawn' | 'explode' | 'death' | 'heal' | 'move' | 'blue'; who: number; cell: number; info?: string }
export interface SimOptions {
  rounds: number
  monsters?: number[] // cases occupées par des ennemis (statiques)
  chain?: 'dfs' | 'bfs'
  /** Déplacement scripté : renvoie la nouvelle case du joueur `idx` au tour `round` (après l'apparition de sa bombe). */
  move?: (round: number, idx: number, st: SimState) => number | undefined
  /** Phase « monstres » juste avant le tour du joueur `idx` (avant l'apparition) : peut déplacer joueurs et ennemis. */
  beforeTurn?: (round: number, idx: number, st: SimState) => void | { kill?: number[] }
  log?: boolean
  /** 'next' (jeu réel, défaut) : explosion à la fin du tour SUIVANT du poseur ; 'same' (moteur actuel) : fin du même tour. */
  timing?: 'next' | 'same'
  /** 'ne' (DofusWiki / moteur, défaut) : NE puis sens horaire ; 'n' (lecture JOL « vers le haut ») : N puis sens horaire. */
  spawnRule?: 'ne' | 'n'
}
export interface SimState { players: Player[]; bombs: Bomb[]; monsters: Set<number> }
export interface SimResult {
  ok: boolean
  deaths: { idx: number; round: number; turnOf: number }[]
  /** Nombre de bombes vivantes pendant le tour de chaque joueur (après apparition), par manche. */
  bombsDuring: number[][]
  events: SimEvent[]
  maxBlueHeal: number
  /** Manches où chaque joueur a reçu un soin de bombe bleue (retrait de Mort en Sursis). */
  healsBy: number[][]
  externalDeaths: { idx: number; round: number }[]
}

export function simulate(map: MapInfo, startCells: number[], o: SimOptions): SimResult {
  const st: SimState = { players: startCells.map((cell, idx) => ({ idx, cell, alive: true })), bombs: [], monsters: new Set(o.monsters ?? []) }
  const events: SimEvent[] = []
  const deaths: SimResult['deaths'] = []
  const bombsDuring: number[][] = []
  let nextId = 0
  let heals = 0
  const healsBy: number[][] = startCells.map(() => [])
  const externalDeaths: { idx: number; round: number }[] = []
  const occupied = (c: number) => st.monsters.has(c) || st.players.some(p => p.alive && p.cell === c) || st.bombs.some(b => b.alive && b.cell === c)
  let curRound = 0
  let curTurn = 0

  function killPlayer(p: Player, by: number, toKill: Bomb[]) {
    if (!p.alive) return
    p.alive = false
    deaths.push({ idx: p.idx, round: curRound, turnOf: curTurn })
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
        heals++
        healsBy[p.idx].push(curRound)
        if (o.log) events.push({ round: curRound, turn: curTurn, kind: 'heal', who: p.idx, cell: p.cell })
      } else killPlayer(p, b.id, toKill)
    }
    for (const c of st.bombs) if (c.alive && inLine10(b.cell, c.cell)) toKill.push(c)
    const uniq = [...new Set(toKill)].filter(c => c.alive)
    uniq.sort((x, y) => comparePositions(b.cell, x.cell, y.cell))
    return uniq
  }

  function explode(b: Bomb) {
    if (!b.alive) return
    if ((o.chain ?? 'dfs') === 'dfs') {
      const next = explodeOne(b)
      for (const c of next) explode(c)
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
        deaths.pop() // mort « externe » (monstres) : pas comptée comme mort par bombe
        externalDeaths.push({ idx: k, round: r })
        for (const b of toKill) explode(b)
      }
      if (!p.alive) { during.push(-1); continue }
      // début de tour : apparition
      const cand = spawnOrder(map, p.cell, o.spawnRule ?? 'ne')
      let cell = -1
      for (const c of cand) if (!occupied(c)) { cell = c; break }
      if (cell >= 0) {
        st.bombs.push({ id: nextId++, owner: p.idx, cell, born: r, blue: false, alive: true })
        if (o.log) events.push({ round: r, turn: p.idx, kind: 'spawn', who: p.idx, cell })
      }
      during.push(st.bombs.filter(b => b.alive).length)
      // déplacement éventuel
      const to = o.move?.(r, p.idx, st)
      if (to !== undefined && to !== p.cell) {
        if (o.log) events.push({ round: r, turn: p.idx, kind: 'move', who: p.idx, cell: to, info: `depuis ${p.cell}` })
        p.cell = to
      }
      // fin de tour : explosion des bombes posées au tour précédent
      const due = (o.timing ?? 'next') === 'next' ? r - 1 : r
      for (const b of st.bombs.slice()) if (b.alive && b.owner === p.idx && b.born === due) explode(b)
      if (!st.players.some(q => q.alive)) break
    }
    bombsDuring.push(during)
    st.bombs = st.bombs.filter(b => b.alive)
  }
  return { ok: deaths.length === 0, deaths, bombsDuring, events, maxBlueHeal: heals, healsBy, externalDeaths }
}

export function permutations<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a.slice()]
  const out: T[][] = []
  a.forEach((x, i) => {
    for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...p])
  })
  return out
}
