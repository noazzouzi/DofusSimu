// Robustesse de F-A face aux pertes : deux Crâs morts ; une bombe tuée avant son heure (elle explose tout de suite,
// avec sa couleur du moment) ; un Crâ tué avec les bombes proches (≈ Bombe Illicale : cercle de 2 au contact).
// Usage : npx tsx mesures2.ts
import { loadMap, PERMS4, VARIANTS, type SimState, type Timing, type Chain } from '../search/modele2'
import { simulate2 } from './sim2'
import { bfsDistances } from '../../../../src/map/path'
import { distance } from '../../../../src/map/geometry'

const map = loadMap()
const S0 = [365, 378, 437, 451]
const T0 = [311, 392, 398, 479]
const Y0 = [325, 406, 412, 493]
const DEST = new Map(S0.map((s, i) => [s, T0[i]]))
const ROT = new Map(S0.map((s, i) => [s, Y0[i]]))
const VALID_SAME_N2 = ['365,437,378,451', '365,437,451,378', '437,365,378,451', '437,365,451,378']
const expected = (s: number, r: number, v: number, t: Timing) => (v >= 2 && t === 'next' && r >= 2 && r % 2 === 0 ? ROT.get(s)! : DEST.get(s)!)
function pathLen(from: number, to: number, st: SimState, self: number): number {
  if (from === to) return 0
  const occ = new Set<number>([...st.monsters])
  for (const p of st.players) if (p.alive && p.idx !== self) occ.add(p.cell)
  for (const b of st.bombs) if (b.alive) occ.add(b.cell)
  if (occ.has(to)) return 99
  const d = bfsDistances(from, c => !!map.walk[c] && !occ.has(c), 12)
  return d[to] < 0 ? 99 : d[to]
}
const VT: { v: number; t: Timing; name: string }[] = []
for (let v = 0; v < VARIANTS.length; v++) for (const t of ['next', 'same'] as Timing[]) VT.push({ v, t, name: `${VARIANTS[v].id}/${t === 'next' ? 'suivant' : 'même'}` })
const ordersFor = (v: number, t: Timing) => {
  const all = PERMS4.map(p => p.map(i => S0[i]))
  return v <= 1 && t === 'same' ? all.filter(o => VALID_SAME_N2.includes(o.join(','))) : all
}
type Hook = (r: number, idx: number, st: SimState, order: number[]) => void | { kill?: number[]; explode?: number[] }
function run(order: number[], v: number, t: Timing, chain: Chain, hook?: Hook) {
  let blocked = false
  const move = (r: number, idx: number, st: SimState) => {
    const want = expected(order[idx], r, v, t)
    if (st.players[idx].cell === want) return undefined
    if (pathLen(st.players[idx].cell, want, st, idx) > 5) { blocked = true; return undefined }
    return want
  }
  const res = simulate2(map, order, { rounds: 30, variant: v, timing: t, chain, move, beforeTurn: hook ? (r, i, st) => hook(r, i, st, order) : undefined })
  return { ok: res.ok && !blocked, res }
}
const ROUNDS = [2, 3, 4, 5, 6, 7, 8]

// ── a. Deux Crâs morts (même manche ou manches différentes), survivants immobiles
console.log('== a. Deux Crâs tués par des monstres (manches 2 à 8, avant le tour du joueur 0 ou 2), les 2 survivants gardent leur plan')
for (const { v, t, name } of VT) {
  let bad = 0, tot = 0
  const worst: string[] = []
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    let b2 = 0, t2 = 0
    for (const o of ordersFor(v, t)) for (const R1 of ROUNDS) for (const R2 of ROUNDS) {
      if (R2 < R1) continue
      for (const k of [0, 2]) for (const ch of ['dfs', 'bfs'] as Chain[]) {
        const hook: Hook = (r, idx, _st, order) => {
          const kill: number[] = []
          if (r === R1 && idx === k) kill.push(order.indexOf(S0[i]))
          if (r === R2 && idx === k) kill.push(order.indexOf(S0[j]))
          return kill.length ? { kill } : undefined
        }
        t2++
        if (!run(o, v, t, ch, hook).ok) b2++
      }
    }
    bad += b2; tot += t2
    if (b2) worst.push(`${S0[i]}+${S0[j]}:${Math.round((100 * b2) / t2)}%`)
  }
  console.log(`  ${name.padEnd(11)} ${bad}/${tot} cas avec une mort de plus (${Math.round((100 * bad) / tot)} %) ${worst.length ? '— paires touchées ' + worst.join(' ') : ''}`)
}

// ── b. Une bombe tuée avant son heure (explose aussitôt, rouge ou bleue selon son état)
console.log('\n== b. Une bombe vivante tuée par un tiers (explose aussitôt) avant le tour du joueur k, manches 2 à 8 ; toutes les bombes testées')
for (const { v, t, name } of VT) {
  let bad = 0, tot = 0
  const byCell = new Map<number, [number, number]>()
  for (const o of ordersFor(v, t)) for (const R of ROUNDS) for (let k = 0; k < 4; k++) {
    // bombes vivantes à ce moment (simulation de référence)
    let alive: number[] = []
    run(o, v, t, 'dfs', (r, idx, st) => { if (r === R && idx === k) alive = st.bombs.filter(b => b.alive).map(b => b.cell) })
    for (const c of alive) for (const ch of ['dfs', 'bfs'] as Chain[]) {
      tot++
      const ok = run(o, v, t, ch, (r, idx) => (r === R && idx === k ? { explode: [c] } : undefined)).ok
      if (!ok) bad++
      const e = byCell.get(c) ?? [0, 0]
      e[1]++
      if (!ok) e[0]++
      byCell.set(c, e)
    }
  }
  const cells = [...byCell.entries()].filter(([, e]) => e[0] > 0).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).map(([c, e]) => `${c}:${e[0]}/${e[1]}`)
  console.log(`  ${name.padEnd(11)} ${bad}/${tot} cas mortels (${Math.round((100 * bad) / tot)} %) ; cases en cause : ${cells.join(' ') || 'aucune'}`)
}

// ── c. Un Crâ tué ET les bombes à ≤ 3 cases de lui explosent (approximation de la Bombe Illicale au contact)
console.log('\n== c. Un Crâ tué + toutes les bombes à ≤ 3 cases de lui tuées au même moment (≈ Bombe Illicale), manches 2 à 8, avant le tour du joueur k')
for (const { v, t, name } of VT) {
  const per: string[] = []
  let bad = 0, tot = 0
  for (const victim of S0) {
    let b2 = 0, t2 = 0
    for (const o of ordersFor(v, t)) for (const R of ROUNDS) for (let k = 0; k < 4; k++) for (const ch of ['dfs', 'bfs'] as Chain[]) {
      t2++
      const ok = run(o, v, t, ch, (r, idx, st, order) => {
        if (r !== R || idx !== k) return undefined
        const vi = order.indexOf(victim)
        const vc = st.players[vi].cell
        return { explode: st.bombs.filter(b => b.alive && b.owner !== vi && distance(b.cell, vc) <= 3).map(b => b.cell), kill: [vi] }
      }).ok
      if (!ok) b2++
    }
    bad += b2; tot += t2
    per.push(`${victim}→${DEST.get(victim)} ${Math.round((100 * b2) / t2)}%`)
  }
  console.log(`  ${name.padEnd(11)} ${bad}/${tot} (${Math.round((100 * bad) / tot)} %) — ${per.join(' ; ')}`)
}
