// Copie de simulate() (../search/modele2.ts) avec un crochet de plus : beforeTurn peut renvoyer { explode: [cases] }
// pour faire exploser tout de suite des bombes (tuées par un tiers : Bombe Illicale, etc.).
import { spawnList, inLine10, inDiag10, type MapInfo, type SimOptions, type SimResult, type SimState, type Bomb, type Player, type SimEvent } from '../search/modele2'
import { comparePositions } from '../../../../src/engine/effects/summons'
export interface SimOptions2 extends Omit<SimOptions, 'beforeTurn'> {
  beforeTurn?: (round: number, idx: number, st: SimState) => void | { kill?: number[]; explode?: number[] }
}
export function simulate2(map: MapInfo, startCells: number[], o: SimOptions2): SimResult {
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
      if (ext && (ext as any).explode) for (const c of (ext as any).explode as number[]) {
        const b = st.bombs.find(x => x.alive && x.cell === c)
        if (b) explode(b)
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

