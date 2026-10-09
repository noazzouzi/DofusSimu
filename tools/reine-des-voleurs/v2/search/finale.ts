// Analyse complète d'un plan (départ rouge → formation) dans le modèle étendu (modele2.ts) :
//  1. matrice variantes (5 règles × 2 moments) × 24 ordres × 2 chaînes (30 manches) ;
//  2. soins bleus par Crâ (écart max entre deux soins, retrait de Mort en Sursis) ;
//  3. cases des bombes (rouges / bleues) au fil des manches ;
//  4. robustesse : Crâ décalé d'une case (retour à son tour) ; ennemi sur une case pendant une apparition ; ennemi
//     immobile sur une case ;
//  5. lignes de vue vers les cases bleues / la zone d'arrivée ;
//  6. trace des 6 premières manches.
// Usage : npx tsx finale.ts "S1,S2,S3,S4" "T1,T2,T3,T4" [ordreRéf "i,j,k,l"] [variantes de trace "A/next,B/next"]
import { readFileSync } from 'node:fs'
import { loadMap, simulate, permutations, PERMS4, VARIANTS, xy, type SimState, type SimOptions, type Timing, type Chain } from './modele2'
import { CELL_COUNT, CELL_X, CELL_Y, distance, neighborsOf } from '../../../../src/map/geometry'
import { bfsDistances } from '../../../../src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '../../../../src/map/los'

const map = loadMap()
const S0 = process.argv[2].split(',').map(Number)
const T0 = process.argv[3].split(',').map(Number)
const refPerm = process.argv[4] ? process.argv[4].split(',').map(Number) : [0, 1, 2, 3]
const traceVariants = (process.argv[5] ?? 'A/next').split(',')
/** Règle tournante optionnelle (6e argument « Y1,Y2,Y3,Y4 ») : appliquée seulement si apparition N4 + tour suivant. */
const Y0 = process.argv[6] ? process.argv[6].split(',').map(Number) : undefined
const DEST = new Map(S0.map((s, i) => [s, T0[i]]))
const ROT = Y0 ? new Map(S0.map((s, i) => [s, Y0[i]])) : undefined
/** Case où le Crâ (case de départ s) doit finir la manche r. */
function expected(s: number, r: number, v: number, t: Timing): number {
  if (ROT && v >= 2 && t === 'next' && r >= 2 && r % 2 === 0) return ROT.get(s)!
  return DEST.get(s)!
}
const VT: { v: number; t: Timing; name: string }[] = []
for (let v = 0; v < VARIANTS.length; v++) for (const t of ['next', 'same'] as Timing[]) VT.push({ v, t, name: `${VARIANTS[v].id}/${t === 'next' ? 'suivant' : 'même'}` })

function pathLen(from: number, to: number, st: SimState, self: number): number {
  if (from === to) return 0
  const occ = new Set<number>([...st.monsters])
  for (const p of st.players) if (p.alive && p.idx !== self) occ.add(p.cell)
  for (const b of st.bombs) if (b.alive) occ.add(b.cell)
  if (occ.has(to)) return 99
  const d = bfsDistances(from, c => !!map.walk[c] && !occ.has(c), 12)
  return d[to] < 0 ? 99 : d[to]
}
/** Simulation du plan pour un ordre (cases de départ dans l'ordre de jeu). */
function run(order: number[], v: number, t: Timing, chain: Chain, extra: Partial<SimOptions> = {}, rounds = 30) {
  let blocked = false
  let pm = 0
  const home = order.map(c => DEST.get(c)!)
  const move = (r: number, idx: number, st: SimState) => {
    const u = extra.move?.(r, idx, st)
    if (u !== undefined) return u
    const want = expected(order[idx], r, v, t)
    if (st.players[idx].cell === want) return undefined
    const len = pathLen(st.players[idx].cell, want, st, idx)
    if (len > 5) { blocked = true; return undefined }
    pm += len
    return want
  }
  const res = simulate(map, order, { rounds, variant: v, timing: t, chain, ...extra, move })
  return { res, blocked, pm, ok: res.ok && !blocked, home }
}
const ORDERS = PERMS4.map(p => p.map(i => S0[i]))

console.log(`== PLAN ${S0.map((s, i) => `${xy(s)}→${xy(T0[i])} (${distance(s, T0[i])})`).join('  ')}`)
// 1. matrice
console.log('\n== 1. Variantes : ordres sans mort sur 30 manches (dfs ET bfs) / 24 ; apparitions au-delà du repli (total sur 24 ordres)')
const okOrders = new Map<string, number[][]>()
for (const vt of VT) {
  const good: number[][] = []
  let beyond = 0, fb = 0, firstFail = ''
  for (const ord of ORDERS) {
    const a = run(ord, vt.v, vt.t, 'dfs'), b = run(ord, vt.v, vt.t, 'bfs')
    beyond += a.res.beyond.length; fb += a.res.fallback
    if (a.ok && b.ok) good.push(ord)
    else if (!firstFail) { const r = a.ok ? b : a; firstFail = r.blocked ? `chemin bloqué (${ord.join("→")})` : `ex. ordre ${ord.join("→")} : 1re mort J${r.res.deaths[0].idx + 1}@${r.home[r.res.deaths[0].idx]} manche ${r.res.deaths[0].round}` }
  }
  okOrders.set(vt.name, good)
  console.log(`  ${vt.name.padEnd(12)} ${String(good.length).padStart(2)}/24  replis ${String(fb).padStart(4)}  au-delà ${String(beyond).padStart(3)}  ${good.length < 24 ? firstFail : ''}`)
}

// 2. soins
console.log('\n== 2. Soins par bombe bleue (retrait de Mort en Sursis) : écart max entre deux soins, pire ordre (manches 1→30)')
for (const vt of VT.filter(x => x.t === 'next')) {
  const worst = [0, 0, 0, 0]
  let allOk = 0, nOk = 0
  for (const ord of ORDERS) for (const ch of ['dfs', 'bfs'] as Chain[]) {
    const r = run(ord, vt.v, vt.t, ch)
    if (!r.ok) continue
    nOk++
    let good = true
    r.home.forEach((h, i) => {
      const hs = [1, ...r.res.healsBy[i], 31]
      let g = 0
      for (let k = 1; k < hs.length; k++) g = Math.max(g, hs[k] - hs[k - 1])
      const slot = T0.indexOf(h)
      worst[slot] = Math.max(worst[slot], g)
      if (g > 5) good = false
    })
    if (good) allOk++
  }
  if (!nOk) { console.log(`  ${vt.name.padEnd(12)} — (aucun ordre sans mort)`); continue }
  console.log(`  ${vt.name.padEnd(12)} écart max par case ${T0.map((c, i) => `${c}:${worst[i] >= 30 ? 'jamais' : worst[i]}`).join(' ')} ; (ordre, chaîne) où tous ≤ 5 : ${allOk}/48`)
}

// 3. bombes (ordre de référence)
const ref = refPerm.map(i => S0[i])
console.log(`\n== 3. Cases des bombes, ordre de référence ${ref.join('→')} (J1..J4), manches 1 à 10`)
for (const tv of traceVariants) {
  const vt = VT.find(x => x.name.startsWith(tv.split('/')[0] + '/') && x.t === (tv.split('/')[1] === 'same' ? 'same' : 'next'))!
  const r = run(ref, vt.v, vt.t, 'dfs', { log: true }, 10)
  console.log(`  -- ${vt.name}`)
  for (let m = 1; m <= 10; m++) {
    const sp = r.res.events.filter(e => e.round === m && e.kind === 'spawn').map(e => `J${e.who + 1}:${e.cell}${e.info === 'primaire' ? '' : e.info === 'repli' ? "'" : '*'}`)
    const ex = r.res.events.filter(e => e.round === m && e.kind === 'explode').map(e => `${e.cell}${e.info!.includes('BLEUE') ? 'b' : 'R'}`)
    const he = r.res.events.filter(e => e.round === m && e.kind === 'heal').map(e => `J${e.who + 1}`)
    console.log(`    m${String(m).padStart(2)} apparitions ${sp.join(' ').padEnd(34)} explosions ${ex.join(' ').padEnd(30)} soins ${he.join(',')}`)
  }
}
// cases explosant rouge / bleu sur tous les ordres (A/next)
for (const vt of VT.filter(x => x.v <= 1)) {
  const red = new Map<number, number>(), blue = new Map<number, number>()
  for (const ord of ORDERS) {
    const r = run(ord, vt.v, vt.t, 'dfs', { log: true }, 30)
    for (const e of r.res.events) if (e.kind === 'explode' && e.round >= 3) (e.info!.includes('BLEUE') ? blue : red).set(e.cell, ((e.info!.includes('BLEUE') ? blue : red).get(e.cell) ?? 0) + 1)
  }
  console.log(`  ${vt.name} (24 ordres, manches 3-30) explosions rouges : ${[...red.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(' ') || 'aucune'} ; bleues : ${[...blue.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(' ') || 'aucune'}`)
}

// 4. robustesse
console.log('\n== 4. Robustesse (ordres valides de chaque variante, chaîne dfs)')
const robVT = VT.filter(x => (okOrders.get(x.name)?.length ?? 0) > 0)
for (const vt of robVT) {
  const ords = okOrders.get(vt.name)!.filter((_, k) => k % 3 === 0) // 8 ordres sur 24 pour limiter le coût
  // 4a. décalage d'une case
  let tot = 0, bad = 0
  for (const ord of ords) for (let victim = 0; victim < 4; victim++) for (const phase of [0, 1, 2, 3]) for (const r0 of [3, 4, 5]) {
    const home = expected(ord[victim], r0 - 1, vt.v, vt.t)
    for (const nb of neighborsOf(home)) {
      if (nb < 0 || !map.walk[nb]) continue
      let displaced = false
      const beforeTurn = (r: number, idx: number, st: SimState) => {
        if (r === r0 && idx === phase && !displaced) {
          const occ = st.monsters.has(nb) || st.players.some(p => p.alive && p.cell === nb) || st.bombs.some(b => b.alive && b.cell === nb)
          if (!occ) { st.players[victim].cell = nb; displaced = true }
        }
      }
      const move = (r: number, idx: number, st: SimState) => { if (r === 1) return undefined; const w = expected(ord[idx], r, vt.v, vt.t); return st.players[idx].cell !== w && pathLen(st.players[idx].cell, w, st, idx) <= 5 ? w : undefined }
      const a = run(ord, vt.v, vt.t, 'dfs', { beforeTurn, move }, r0 + 6)
      if (!displaced) continue
      tot++
      if (!a.ok) bad++
    }
  }
  // 4b. ennemi pendant une seule apparition ; 4c. ennemi immobile
  const near: number[] = []
  for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && !T0.includes(c) && Math.min(...T0.map(p => distance(p, c))) <= 3) near.push(c)
  const bad1 = new Set<number>(), badP = new Set<number>()
  for (const c of near) {
    for (const ord of ords.slice(0, 4)) {
      for (const phase of [0, 1, 2, 3]) for (const r0 of [3, 4]) {
        const beforeTurn = (r: number, idx: number, st: SimState) => {
          st.monsters.clear()
          if (r === r0 && idx === phase && !st.bombs.some(b => b.alive && b.cell === c)) st.monsters.add(c)
        }
        if (!run(ord, vt.v, vt.t, 'dfs', { beforeTurn }, r0 + 6).ok) bad1.add(c)
      }
      // immobile à partir de la manche 2
      const beforeTurn = (r: number, idx: number, st: SimState) => { if (r >= 2 && !st.monsters.has(c) && !st.bombs.some(b => b.alive && b.cell === c) && !st.players.some(p => p.cell === c)) st.monsters.add(c) }
      if (!run(ord, vt.v, vt.t, 'dfs', { beforeTurn }, 16).ok) badP.add(c)
    }
  }
  console.log(`  ${vt.name.padEnd(12)} décalage d'une case : ${bad}/${tot} cas mortels ; ennemi 1 apparition : ${bad1.size}/${near.length} cases dangereuses [${[...bad1].sort((a, b) => a - b).join(' ')}] ; ennemi immobile : ${badP.size} [${[...badP].sort((a, b) => a - b).join(' ')}]`)
}

// 5. ligne de vue
const mapJson = JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as { cells: { id: number; los: boolean }[] }
const opaque = opaqueCells(mapJson.cells as never)
let snap: { players: number[]; bombs: number[] } | undefined
run(ref, 0, 'next', 'dfs', { beforeTurn: (r, idx, st) => { if (r === 3 && idx === 0) snap = { players: st.players.map(p => p.cell), bombs: st.bombs.filter(b => b.alive).map(b => b.cell) } } }, 3)
const occ = new Set<number>([...snap!.players, ...snap!.bombs])
const zone: number[] = []
for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && CELL_Y[c] >= -6 && CELL_Y[c] <= 3) zone.push(c)
console.log(`\n== 5. Ligne de vue (A/suivant, début manche 3, bombes en ${snap!.bombs.join(' ')}) — zone d'approche y ∈ [−6, 3] (${zone.length} cases), cases bleues (${map.blue.length})`)
for (const p of T0) {
  const others = new Set([...occ].filter(c => c !== p))
  const seen = (from: number, z: number[], maxD: number) => z.filter(c => !others.has(c) && c !== from && distance(from, c) <= maxD && hasLineOfSightOnMap(opaque, from, c, x => x !== from && others.has(x)))
  const vz = seen(p, zone, 12), vb = seen(p, map.blue, 99)
  const d = bfsDistances(p, c => !!map.walk[c] && !others.has(c), 3)
  let best1 = { c: -1, n: 0, b: 0 }, best2 = { c: -1, n: 0, b: 0 }
  for (let c = 0; c < CELL_COUNT; c++) {
    if (d[c] < 1 || d[c] > 2) continue
    const n = seen(c, zone, 12).length, b = seen(c, map.blue, 99).length
    const slot = d[c] === 1 ? best1 : best2
    if (n > slot.n) Object.assign(slot, { c, n, b })
  }
  console.log(`  ${xy(p).padEnd(13)} voit ${String(vz.length).padStart(3)} cases de la zone (≤ 12) et ${vb.length}/12 cases bleues ; meilleure sortie à 1 PM ${best1.c >= 0 ? `${best1.c} (${best1.n} cases, ${best1.b} bleues)` : '—'} ; à 2 PM ${best2.c >= 0 ? `${best2.c} (${best2.n} cases, ${best2.b} bleues)` : '—'}`)
}

// 6. trace
for (const tv of traceVariants) {
  const vt = VT.find(x => x.name.startsWith(tv.split('/')[0] + '/') && x.t === (tv.split('/')[1] === 'same' ? 'same' : 'next'))!
  const r = run(ref, vt.v, vt.t, 'dfs', { log: true }, 6)
  console.log(`\n== 6. Trace ${vt.name}, ordre ${ref.join('→')} (J1..J4), 6 manches`)
  for (const e of r.res.events) console.log(`  m${e.round} tour J${e.turn + 1} ${e.kind.padEnd(7)} J${e.who + 1} ${xy(e.cell)} ${e.info ?? ''}`)
}
