/**
 * Simulateur minimal et INDÉPENDANT des Bonbombes (Reine des Voleurs, carte 137101312).
 * Écrit à partir du README §1.4, des données du sort Nova 4689 (monster-spells.json) et de la règle n°1 du joueur.
 * N'utilise ni tools/reine-des-voleurs/modele-bombes.ts ni le code du chercheur.
 *
 * Règles implémentées :
 *  - Au début du tour de chaque Crâ vivant, une bombe (rouge) apparaît : case primaire (N2 ou N4), sinon case de
 *    repli (selon la variante), sinon « au-delà » (inconnu, compté ; sens horaire depuis le haut de l'écran).
 *    Une case est indisponible si : hors carte, non praticable (pilier/trou), occupée par un Crâ, une bombe ou un ennemi.
 *  - Moment d'explosion : 'TS' fin du tour SUIVANT du poseur ; 'MT' fin du même tour.
 *  - Explosion (Nova 4689) : (1) bombes en diagonale (|dx|=|dy|, 1..10 pas) → bleues ; (2) si la bombe est bleue :
 *    soigne les Crâs en ligne (1..10) et tue les bombes en ligne ; si rouge : tue tout allié en ligne (Crâs, bombes) ;
 *    (3) les bombes tuées explosent (chaîne) ; un Crâ tué fait exploser toutes ses bombes.
 *  - Modes de chaîne : 'dfs' (on tue toutes les cibles en ligne, puis on fait exploser chacune récursivement),
 *    'bfs' (file globale), 'imm' (chaque cible tuée explose aussitôt, avant la cible suivante).
 */
import { CELL_X, CELL_Y, distance, pointToCell, neighborsOf, cellToScreen, directionBetween } from '../../../../src/map/geometry.ts'
import { readFileSync } from 'node:fs'

const MAP = JSON.parse(readFileSync('data/maps/137101312.json', 'utf8'))
export const WALK = new Uint8Array(560)
for (const c of MAP.cells) if (c.walkable) WALK[c.id] = 1
export const RED: number[] = MAP.redCells

export type Variant = 'A' | 'B' | 'C' | 'D' | 'E' | 'E2' | 'NEold'
export type Timing = 'TS' | 'MT'
export type Chain = 'dfs' | 'bfs' | 'imm'
export type TargetOrder = 'near' | 'far' | 'id' | 'idrev' | 'nearc' | 'nearcw' | 'rand'

// Décalages logiques (dx, dy) — vérifiés par geo-check.ts (cellToScreen + lookDirection8) :
//  N2 = (−1,+1) : case juste au-dessus à l'écran (distance 2) ; N4 = (−2,+2) : deux cases au-dessus (distance 4)
//  NE2 = (0,+2) : 2 pas vers le haut-droite (en ligne avec le Crâ) ; « haut-droite de X » = X + (0,+1)
const PRIMARY: Record<Variant, [number, number]> = {
  A: [-1, 1], B: [-1, 1], C: [-2, 2], D: [-2, 2], E: [-2, 2], E2: [-2, 2], NEold: [0, 2],
}
const FALLBACK: Record<Variant, [number, number]> = {
  A: [0, 2], // NE2
  B: [-1, 2], // haut-droite de N2
  C: [0, 2], // NE2
  D: [-2, 3], // haut-droite de N4
  E: [0, 4], // NE4 (4 pas haut-droite, en ligne)
  E2: [-1, 3], // case à droite de N4 à l'écran (lecture alternative, sensibilité)
  NEold: [1, 1], // ancienne règle du README (contrôle) : NE2 puis E2
}

function offCell(c: number, d: [number, number]): number {
  return pointToCell(CELL_X[c] + d[0], CELL_Y[c] + d[1])
}

// Ordre « au-delà » : cases à distance de jeu 2 puis 3, 4…, triées par angle écran dans le sens horaire depuis le haut.
function beyondList(c: number): number[] {
  const s = cellToScreen(c, 2, 2)
  const cand: { id: number; d: number; ang: number }[] = []
  for (let o = 0; o < 560; o++) {
    const d = distance(c, o)
    if (d < 2 || d > 6) continue
    const t = cellToScreen(o, 2, 2)
    const dx = t.px - s.px, dy = -(t.py - s.py) // dy>0 = vers le haut
    let ang = Math.atan2(dx, dy) // 0 = haut, croissant dans le sens horaire
    if (ang < -1e-9) ang += 2 * Math.PI
    cand.push({ id: o, d, ang })
  }
  cand.sort((a, b) => a.d - b.d || a.ang - b.ang)
  return cand.map((x) => x.id)
}
// Ancienne règle du README (contrôle uniquement) : NE2, E2, puis sens horaire SE2, S2, SW2, W2, NW2, N2, puis à 3 cases.
const NEOLD_BEYOND: [number, number][] = [[2, 0], [1, -1], [0, -2], [-1, -1], [-2, 0], [-1, 1], [0, 3], [3, 0], [0, -3], [-3, 0]]
export const BEYOND: number[][] = Array.from({ length: 560 }, (_, c) => (WALK[c] ? beyondList(c) : []))

export interface Bomb { id: number; owner: number; cell: number; blue: boolean; round: number; alive: boolean; dying?: boolean }

export interface Plan {
  name: string
  start: number[] // case de départ par slot
  home: number[] // case tenue par slot
  alt?: number[] // case d'alternance (1 PM) par slot
  useAlt?: (v: Variant, t: Timing) => boolean
}

export interface RunOpts {
  plan: Plan
  variant: Variant
  timing: Timing
  chain: Chain
  order: number[] // ordre de jeu (indices de slot)
  rounds?: number
  targetOrder?: TargetOrder
  enemies?: Set<number> // cases occupées par un ennemi immobile
  enemyFromRound?: number
  displace?: { slot: number; round: number; beforeSlot: number; to: number } // décalage subi
  forceAlt?: boolean | null // forcer (true/false) l'usage de l'alternance
  trace?: boolean
  diagMax?: number // pas max en diagonale (10 par défaut ; 5 = Manhattan ≤ 10)
  blueColors?: boolean // une bombe bleue colore-t-elle ses diagonales (oui par défaut, d'après 4689)
  pending?: boolean // une bombe tuée mais pas encore explosée peut-elle encore passer au bleu (dfs/bfs) ?
  seed?: number // pour targetOrder 'rand'
  stopOnDeath?: boolean
  lineMax?: number // portée en ligne (10 d'après X10)
}

export interface RunResult {
  deaths: { slot: number; round: number; turnOf: number; by: string }[]
  beyond: number
  fallback: number
  primary: number
  heals: number[][] // manches de soin par slot
  pathFail: string[]
  log: string[]
  spawnCells: Map<string, number> // "r:slot" -> case
  explosions: { round: number; turnOf: number; cell: number; blue: boolean }[]
}

export function run(o: RunOpts): RunResult {
  const R = o.rounds ?? 30
  const plan = o.plan
  const tOrd: TargetOrder = o.targetOrder ?? 'near'
  const pos = plan.start.slice()
  const alive = [true, true, true, true]
  const bombs: Bomb[] = []
  let bid = 0
  const res: RunResult = { deaths: [], beyond: 0, fallback: 0, primary: 0, heals: [[], [], [], []], pathFail: [], log: [], spawnCells: new Map(), explosions: [] }
  const log = (s: string) => { if (o.trace) res.log.push(s) }
  const useAlt = o.forceAlt != null ? o.forceAlt : (plan.alt && plan.useAlt ? plan.useAlt(o.variant, o.timing) : false)

  const enemyAt = (c: number, r: number) => !!o.enemies && o.enemies.has(c) && r >= (o.enemyFromRound ?? 1)
  const occupied = (c: number, r: number, ignoreSlot = -1) => {
    if (c < 0 || !WALK[c]) return true
    for (let i = 0; i < 4; i++) if (alive[i] && i !== ignoreSlot && pos[i] === c) return true
    for (const b of bombs) if (b.alive && b.cell === c) return true
    return enemyAt(c, r)
  }
  const inLine = (a: number, b: number) => (CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]) && a !== b && distance(a, b) <= (o.lineMax ?? 10)
  const inDiag = (a: number, b: number) => {
    const dx = Math.abs(CELL_X[a] - CELL_X[b]), dy = Math.abs(CELL_Y[a] - CELL_Y[b])
    return dx === dy && dx >= 1 && dx <= (o.diagMax ?? 10)
  }
  let seed = (o.seed ?? 1) >>> 0
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const sortTargets = (center: number, arr: { cell: number; key: string; kind?: string; idx?: number }[]) => {
    if (tOrd === 'rand') {
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t }
      return
    }
    arr.sort((p, q) => {
      if (tOrd === 'nearcw') {
        const d = distance(center, p.cell) - distance(center, q.cell)
        if (d) return d
        const rk = (c: number) => [7, 1, 3, 5].indexOf(directionBetween(center, c))
        return rk(p.cell) - rk(q.cell)
      }
      if (tOrd === 'nearc') {
        const d = distance(center, p.cell) - distance(center, q.cell)
        if (d) return d
        const kp = p.kind === 'p' ? -1 : p.idx!, kq = q.kind === 'p' ? -1 : q.idx!
        return kp - kq
      }
      if (tOrd === 'near') return distance(center, p.cell) - distance(center, q.cell) || p.cell - q.cell
      if (tOrd === 'far') return distance(center, q.cell) - distance(center, p.cell) || p.cell - q.cell
      if (tOrd === 'id') return p.cell - q.cell
      return q.cell - p.cell
    })
  }

  let curRound = 0, curTurn = -1
  // Explosion d'une bombe (déjà retirée du plateau). Retourne les bombes tuées à faire exploser (dfs/bfs).
  function blast(b: Bomb, depth: number): Bomb[] {
    b.dying = false
    res.explosions.push({ round: curRound, turnOf: curTurn, cell: b.cell, blue: b.blue })
    const ind = '  '.repeat(depth)
    const blued: number[] = []
    if (!b.blue || o.blueColors !== false) for (const c of bombs) if ((c.alive || (o.pending && c.dying)) && !c.blue && inDiag(b.cell, c.cell)) { c.blue = true; blued.push(c.cell) }
    // cibles en ligne
    const tgts: { cell: number; key: string; kind: 'p' | 'b'; idx: number }[] = []
    for (let i = 0; i < 4; i++) if (alive[i] && inLine(b.cell, pos[i])) tgts.push({ cell: pos[i], key: 'p' + i, kind: 'p', idx: i })
    for (let k = 0; k < bombs.length; k++) { const c = bombs[k]; if (c.alive && inLine(b.cell, c.cell)) tgts.push({ cell: c.cell, key: 'b' + k, kind: 'b', idx: k }) }
    sortTargets(b.cell, tgts)
    log(`${ind}${b.blue ? 'BLEUE' : 'ROUGE'} ${b.cell} (J${b.owner + 1}, posée m${b.round})` + (blued.length ? ` → bleues: ${blued.join(',')}` : '') + (tgts.length ? ` ; en ligne: ${tgts.map((t) => (t.kind === 'p' ? 'J' + (t.idx + 1) + '@' + t.cell : t.cell + (bombs[t.idx].blue ? 'b' : 'r'))).join(',')}` : ''))
    const killed: Bomb[] = []
    const killBomb = (c: Bomb) => { c.alive = false; c.dying = true; killed.push(c) }
    const killPlayer = (i: number) => {
      alive[i] = false
      res.deaths.push({ slot: i, round: curRound, turnOf: curTurn, by: `${b.blue ? 'bleue' : 'rouge'}@${b.cell}` })
      log(`${ind}  ✖ J${i + 1} meurt en ${pos[i]}`)
      for (const c of bombs) if (c.alive && c.owner === i) killBomb(c)
    }
    if (o.chain === 'imm') {
      for (const t of tgts) {
        if (t.kind === 'p') {
          if (!alive[t.idx]) continue
          if (b.blue) { res.heals[t.idx].push(curRound); log(`${ind}  + soin J${t.idx + 1}`) }
          else {
            const before = killed.length
            killPlayer(t.idx)
            const ks = killed.splice(before)
            for (const k of ks) { blast(k, depth + 1) }
          }
        } else {
          const c = bombs[t.idx]
          if (!c.alive) continue
          c.alive = false
          blast(c, depth + 1)
        }
      }
      return []
    }
    for (const t of tgts) {
      if (t.kind === 'p') {
        if (!alive[t.idx]) continue
        if (b.blue) { res.heals[t.idx].push(curRound); log(`${ind}  + soin J${t.idx + 1}`) }
        else killPlayer(t.idx)
      } else {
        const c = bombs[t.idx]
        if (c.alive) killBomb(c)
      }
    }
    return killed
  }
  function explode(b: Bomb) {
    b.alive = false
    if (o.chain === 'dfs' || o.chain === 'imm') {
      const rec = (x: Bomb, d: number) => { const ks = blast(x, d); for (const k of ks) rec(k, d + 1) }
      rec(b, 1)
    } else {
      const q: [Bomb, number][] = [[b, 1]]
      while (q.length) { const [x, d] = q.shift()!; for (const k of blast(x, d)) q.push([k, d + 1]) }
    }
  }
  // Un soin n'est compté que si le Crâ est vivant à la fin de la chaîne : on filtre après coup.
  function bfsPath(from: number, to: number, r: number, slot: number): number {
    if (from === to) return 0
    if (occupied(to, r, slot)) return -1
    const dist = new Map<number, number>([[from, 0]])
    const q = [from]
    while (q.length) {
      const c = q.shift()!
      const d = dist.get(c)!
      if (d >= 5) continue
      for (const n of neighborsOf(c)) {
        if (dist.has(n) || occupied(n, r, slot)) continue
        dist.set(n, d + 1)
        if (n === to) return d + 1
        q.push(n)
      }
    }
    return -1
  }

  for (let r = 1; r <= R; r++) {
    curRound = r
    log(`— manche ${r}`)
    for (const s of o.order) {
      curTurn = s
      // décalage subi juste avant le tour de beforeSlot
      if (o.displace && o.displace.round === r && o.displace.beforeSlot === s && alive[o.displace.slot]) {
        const d = o.displace
        if (!occupied(d.to, r, d.slot)) { log(`  (décalage J${d.slot + 1} ${pos[d.slot]}→${d.to})`); pos[d.slot] = d.to }
      }
      if (!alive[s]) continue
      // 1. apparition
      const p = pos[s]
      let cell = offCell(p, PRIMARY[o.variant])
      let how = 'N'
      if (occupied(cell, r)) {
        cell = offCell(p, FALLBACK[o.variant]); how = 'repli'
        if (occupied(cell, r)) {
          how = 'AU-DELÀ'; cell = -1
          const list = o.variant === 'NEold' ? NEOLD_BEYOND.map((d) => offCell(p, d)) : BEYOND[p]
          for (const c of list) if (!occupied(c, r)) { cell = c; break }
        }
      }
      if (how === 'N') res.primary++
      else if (how === 'repli') res.fallback++
      else res.beyond++
      if (cell >= 0) {
        bombs.push({ id: bid++, owner: s, cell, blue: false, round: r, alive: true })
        res.spawnCells.set(`${r}:${s}`, cell)
      }
      // 2. déplacement
      let target = plan.home[s]
      if (r >= 2 && useAlt && plan.alt) target = r % 2 === 0 ? plan.alt[s] : plan.home[s]
      const before = pos[s]
      if (target !== pos[s]) {
        const d = bfsPath(pos[s], target, r, s)
        if (d < 0) { res.pathFail.push(`m${r} J${s + 1} ${pos[s]}→${target}`) }
        else pos[s] = target
      }
      log(`  J${s + 1} [${before}] bombe ${cell}(${how})${pos[s] !== before ? ` ; va en ${pos[s]}` : ''}`)
      // 3. fin de tour : explosion des bombes échues du poseur
      const due = bombs.filter((b) => b.alive && b.owner === s && (o.timing === 'TS' ? b.round === r - 1 : b.round === r))
      const healsBefore = res.heals.map((h) => h.length)
      for (const b of due) if (b.alive) explode(b)
      // soins annulés pour les Crâs morts dans la même chaîne
      for (let i = 0; i < 4; i++) if (!alive[i]) res.heals[i].length = Math.min(res.heals[i].length, healsBefore[i])
      if (o.stopOnDeath && (res.deaths.length || res.pathFail.length)) return res
    }
  }
  // dédoublonne les manches de soin
  res.heals = res.heals.map((h) => [...new Set(h)])
  return res
}

export function perms(a: number[]): number[][] {
  if (a.length <= 1) return [a.slice()]
  const out: number[][] = []
  for (let i = 0; i < a.length; i++) for (const p of perms([...a.slice(0, i), ...a.slice(i + 1)])) out.push([a[i], ...p])
  return out
}
export const ORDERS = perms([0, 1, 2, 3])
