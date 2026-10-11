// Bonbombes : ce qui se passe entre la FIN du tour du Crâ actif et le DÉBUT de son tour suivant.
//
// Règles (docs/strategies/reine-des-voleurs §1.4, modèle tools/reine-des-voleurs/modele-bombes.ts) :
//  - au début du tour de chaque Crâ, une bombe apparaît sur la 1re case libre à distance >= 2 dans l'ordre de
//    comparePositions (NE en ligne, puis E, puis sens horaire) — vérifié sur 5 apparitions réelles le 2026-10-09 ;
//  - une bombe explose juste après le tour SUIVANT de son poseur (vérifié : bombe de Java posée à la manche 1,
//    explosée à la manche 2 juste après le tour de Java) ;
//  - explosion : les bombes vivantes en DIAGONALE (1 à 10) deviennent bleues ; une rouge tue joueurs et bombes EN LIGNE
//    (1 à 10 cases), une bleue soigne les joueurs en ligne et tue les bombes en ligne ; les bombes tuées explosent à
//    leur tour (la plus proche d'abord) ; la ligne de vue est ignorée ; un joueur tué fait exploser ses bombes.
// Hypothèse : entre deux tours, les Crâs et les monstres ne bougent pas (on ne connaît pas encore leurs tours).
import { CELL_COUNT, CELL_X, CELL_Y, distance } from '../../../src/map/geometry'
import { comparePositions } from '../../../src/engine/effects/summons'

export interface BombState { id: number; owner: number; cell: number; born: number; blue: boolean; alive: boolean }
export interface PlayerState { id: number; cell: number; alive: boolean }

export interface BombWorld {
  walk: (cell: number) => boolean
  players: PlayerState[]
  bombs: BombState[]
  /** Cases occupées par les monstres (immobiles pendant la simulation). */
  monsters: Set<number>
  /** Ordre de jeu (identifiants), bombes exclues. */
  order: number[]
}

export interface BombEvent { round: number; turnOf: number; kind: 'spawn' | 'explode' | 'death' | 'heal' | 'blue'; who: number; cell: number }

export interface HorizonResult {
  /** Joueurs tués, avec le moment (manche, tour de qui) : `atActiveEnd` = à la fin même du tour du Crâ actif. */
  deaths: { id: number; round: number; turnOf: number; atActiveEnd: boolean }[]
  heals: { id: number; round: number }[]
  events: BombEvent[]
  /** Bombes vivantes au début du tour suivant du Crâ actif. */
  bombsAtNextTurn: BombState[]
}

const inLine10 = (a: number, b: number) => a !== b && (CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]) && distance(a, b) <= 10
const inDiag10 = (a: number, b: number) => {
  const dx = Math.abs(CELL_X[a] - CELL_X[b])
  return dx >= 1 && dx <= 10 && dx === Math.abs(CELL_Y[a] - CELL_Y[b])
}

/** Case d'apparition de la bombe d'un joueur en `from` (−1 si aucune). */
export function spawnCell(world: BombWorld, from: number): number {
  const occupied = new Set<number>(world.monsters)
  for (const p of world.players) if (p.alive) occupied.add(p.cell)
  for (const b of world.bombs) if (b.alive) occupied.add(b.cell)
  let best = -1
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!world.walk(c) || occupied.has(c) || distance(from, c) < 2) continue
    if (best < 0 || comparePositions(from, c, best) < 0) best = c
  }
  return best
}

/**
 * Simule de la fin du tour de `active` (manche `round`) jusqu'au début de son tour suivant. `world` est copié.
 */
export function simulateHorizon(input: BombWorld, active: number, round: number): HorizonResult {
  const world: BombWorld = {
    ...input,
    players: input.players.map(p => ({ ...p })),
    bombs: input.bombs.map(b => ({ ...b })),
  }
  const res: HorizonResult = { deaths: [], heals: [], events: [], bombsAtNextTurn: [] }
  let curRound = round
  let curTurn = active
  let atActiveEnd = true
  let nextId = Math.min(0, ...world.bombs.map(b => b.id)) - 1

  const killPlayer = (p: PlayerState, toKill: BombState[]) => {
    if (!p.alive) return
    p.alive = false
    res.deaths.push({ id: p.id, round: curRound, turnOf: curTurn, atActiveEnd })
    res.events.push({ round: curRound, turnOf: curTurn, kind: 'death', who: p.id, cell: p.cell })
    for (const b of world.bombs) if (b.alive && b.owner === p.id) toKill.push(b)
  }
  const explodeOne = (b: BombState): BombState[] => {
    b.alive = false
    res.events.push({ round: curRound, turnOf: curTurn, kind: 'explode', who: b.id, cell: b.cell })
    for (const c of world.bombs) {
      if (c.alive && !c.blue && inDiag10(b.cell, c.cell)) {
        c.blue = true
        res.events.push({ round: curRound, turnOf: curTurn, kind: 'blue', who: c.id, cell: c.cell })
      }
    }
    const toKill: BombState[] = []
    for (const p of world.players) {
      if (!p.alive || !inLine10(b.cell, p.cell)) continue
      if (b.blue) {
        res.heals.push({ id: p.id, round: curRound })
        res.events.push({ round: curRound, turnOf: curTurn, kind: 'heal', who: p.id, cell: p.cell })
      } else killPlayer(p, toKill)
    }
    for (const c of world.bombs) if (c.alive && inLine10(b.cell, c.cell)) toKill.push(c)
    const next = [...new Set(toKill)].filter(c => c.alive)
    next.sort((x, y) => comparePositions(b.cell, x.cell, y.cell))
    return next
  }
  const explode = (b: BombState) => {
    if (!b.alive) return
    for (const c of explodeOne(b)) explode(c)
  }
  const endOfTurn = (id: number) => {
    for (const b of world.bombs.slice()) if (b.alive && b.owner === id && b.born === curRound - 1) explode(b)
  }

  // 1) fin du tour du Crâ actif
  endOfTurn(active)
  atActiveEnd = false
  // 2) tours suivants jusqu'au retour du Crâ actif
  const order = world.order
  let k = order.indexOf(active)
  for (let guard = 0; guard < order.length + 1; guard++) {
    k++
    if (k >= order.length) {
      k = 0
      curRound++
    }
    const id = order[k]
    curTurn = id
    const p = world.players.find(q => q.id === id)
    if (id === active) {
      // début du tour suivant : on s'arrête avant l'apparition de sa nouvelle bombe
      break
    }
    if (!p || !p.alive) continue
    const cell = spawnCell(world, p.cell)
    if (cell >= 0) {
      world.bombs.push({ id: nextId--, owner: id, cell, born: curRound, blue: false, alive: true })
      res.events.push({ round: curRound, turnOf: id, kind: 'spawn', who: id, cell })
    }
    endOfTurn(id)
  }
  res.bombsAtNextTurn = world.bombs.filter(b => b.alive)
  return res
}

/**
 * Explosions à la fin du tour de `active` seulement (sa bombe de la manche précédente) : morts immédiates, que le
 * Crâ actif provoque ou subit sans que personne puisse réagir.
 */
export function deathsAtActiveEnd(world: BombWorld, active: number, round: number): number[] {
  return simulateHorizon({ ...world, order: [active] }, active, round).deaths.filter(d => d.atActiveEnd).map(d => d.id)
}
