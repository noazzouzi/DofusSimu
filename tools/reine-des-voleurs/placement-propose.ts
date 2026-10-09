// Choix et analyse du placement proposé (modèle « jeu réel » des Bonbombes, modele-bombes.ts).
//  1. Pour chaque ensemble de départ rouge et chaque affectation case→case de chaîne C17a : nombre d'ordres de jeu
//     (sur 24) sans mort sur 15 manches (dfs ET bfs). Exclut 325 et 369 (Mort en Sursis possible dès le tour 1).
//  2. Placement retenu : trace, soins bleus par Crâ (retrait de Mort en Sursis), bombes en jeu (réduction Reine).
//  3. Perturbations : (a) un Crâ déplacé d'une case (échange de Mort en Sursis) avant un tour, retour à son tour ;
//     (b) un ennemi sur une case pendant UNE apparition ; (c) mort d'un Crâ (par les monstres) et resserrement.
//  4. Ligne de vue depuis les cases de la chaîne (piliers + Crâs + bombes en place).
import { readFileSync } from 'node:fs'
import { loadMap, simulate, permutations, xy, type SimState } from './modele-bombes'
import { pointToCell as P, distance, CELL_COUNT, CELL_X, CELL_Y, neighborsOf } from '/home/user/DofusSimu/src/map/geometry'
import { bfsDistances } from '/home/user/DofusSimu/src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '/home/user/DofusSimu/src/map/los'

const map = loadMap()
const T = [P(17, -8), P(17, -10), P(17, -12), P(17, -14)] // 354 381 408 435
const ROUNDS = 15
const okBoth = (o: Parameters<typeof simulate>[2], cells: number[]) => simulate(map, cells, { ...o, chain: 'dfs' }).ok && simulate(map, cells, { ...o, chain: 'bfs' }).ok

function pathLen(from: number, to: number, st: SimState, self: number): number {
  if (from === to) return 0
  const occ = new Set<number>([...st.monsters])
  for (const p of st.players) if (p.alive && p.idx !== self) occ.add(p.cell)
  for (const b of st.bombs) if (b.alive) occ.add(b.cell)
  if (occ.has(to)) return 99
  const d = bfsDistances(from, c => !!map.walk[c] && !occ.has(c), 12)
  return d[to] < 0 ? 99 : d[to]
}
/** Simulation d'un départ `order` (cases dans l'ordre de jeu) avec la table de destination `dest` (case de départ → case). */
function runStart(order: number[], dest: Map<number, number>, extra: Partial<Parameters<typeof simulate>[2]> = {}, chain: 'dfs' | 'bfs' = 'dfs', rounds = ROUNDS) {
  let fail = false
  let pm = 0
  const starts = order.slice()
  const move = (r: number, idx: number, st: SimState) => {
    const userMove = extra.move?.(r, idx, st)
    if (userMove !== undefined) return userMove
    if (r !== 1) return undefined
    const to = dest.get(starts[idx])!
    const len = pathLen(st.players[idx].cell, to, st, idx)
    if (len > 6) { fail = true; return undefined }
    pm += len
    return to
  }
  const res = simulate(map, order, { rounds, ...extra, chain, move })
  return { res, fail, pm, ok: res.ok && !fail }
}

// ── 1. Classement des départs
const sets = new Map<string, number[]>()
const R = map.red.filter(c => c !== 325 && c !== 369)
for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) for (let k = j + 1; k < R.length; k++) for (let l = k + 1; l < R.length; l++) sets.set([R[i], R[j], R[k], R[l]].join(','), [R[i], R[j], R[k], R[l]])
const ranking: { set: number[]; dest: Map<number, number>; orders: number; pmMax: number; pmTot: number }[] = []
for (const set of sets.values()) {
  for (const Tp of permutations(T)) {
    const dest = new Map(set.map((c, i) => [c, Tp[i]]))
    // PM nécessaires sans entités (filtre rapide)
    const raw = set.map(c => distance(c, dest.get(c)!))
    if (Math.max(...raw) > 6) continue
    let n = 0, pmMax = 0, pmTot = 0
    for (const ord of permutations(set)) {
      const a = runStart(ord, dest, {}, 'dfs')
      if (!a.ok) continue
      const b = runStart(ord, dest, {}, 'bfs')
      if (!b.ok) continue
      n++
      pmTot = Math.max(pmTot, a.pm)
    }
    if (n) {
      pmMax = Math.max(...raw)
      ranking.push({ set, dest, orders: n, pmMax, pmTot })
    }
  }
}
ranking.sort((a, b) => b.orders - a.orders || a.pmTot - b.pmTot || a.pmMax - b.pmMax)
console.log(`== 1. Départs rouges (sans 325/369) → chaîne C17a ${T.map(xy).join(' ')} : ${ranking.length} (ensemble, affectation) valides pour au moins un ordre`)
for (const r of ranking.slice(0, 15)) console.log(`  ${r.set.map(c => `${c}→${r.dest.get(c)}`).join('  ')} : ${r.orders}/24 ordres sans mort ; PM max ${r.pmMax}, PM total ${r.pmTot}`)
const full = ranking.filter(r => r.orders === 24)
console.log(`  départs valides pour les 24 ordres : ${full.length}`)

// ── 2. Placement retenu
const chosen = ranking.find(r => r.set.join(',') === '354,381,395,451') ?? ranking[0]
console.log(`\n== 2. Placement retenu : ${chosen.set.map(c => `${xy(c)}→${xy(chosen.dest.get(c)!)}`).join('  ')}`)
const validOrders: number[][] = []
for (const ord of permutations(chosen.set)) {
  const a = runStart(ord, chosen.dest, {}, 'dfs', 30)
  const b = runStart(ord, chosen.dest, {}, 'bfs', 30)
  const tag = a.ok && b.ok ? 'OK' : `mort (dfs m${a.res.deaths[0]?.round ?? '-'} / bfs m${b.res.deaths[0]?.round ?? '-'})${a.fail || b.fail ? ' chemin bloqué' : ''}`
  if (a.ok && b.ok) validOrders.push(ord)
  console.log(`  ordre ${ord.join('→')} : ${tag}`)
}
console.log(`  ordres valides sur 30 manches : ${validOrders.length}/24`)
const ref = validOrders.find(o => o.join(',') === '354,381,395,451') ?? validOrders[0]
const tr = runStart(ref, chosen.dest, { log: true }, 'dfs', 6)
console.log(`\nTrace (ordre ${ref.join('→')}, 6 manches) :`)
for (const e of tr.res.events) console.log(`  m${e.round} tour J${e.turn + 1} ${e.kind.padEnd(7)} J${e.who + 1} ${xy(e.cell)} ${e.info ?? ''}`)
const long = runStart(ref, chosen.dest, {}, 'dfs', 30)
console.log('\nSoins de bombe bleue par Crâ (manches) :')
long.res.healsBy.forEach((h, i) => {
  const gaps = h.slice(1).map((x, k) => x - h[k])
  console.log(`  J${i + 1} (${ref[i]}→${chosen.dest.get(ref[i])}) : ${h.join(',')} ; écart max entre deux soins ${gaps.length ? Math.max(...gaps) : '-'} manches`)
})
const mults = long.res.bombsDuring.map(r => r.map(n => (n < 0 ? NaN : Math.pow(0.9, n))))
console.log('Bombes en jeu pendant le tour de chaque Crâ, manches 1 à 8 :', long.res.bombsDuring.slice(0, 8).map(r => r.join(',')).join(' | '))
const flat = mults.slice(1).flat().filter(x => !Number.isNaN(x))
console.log(`Multiplicateur moyen des dégâts subis par la Reine (0,9^n, manches 2 à 30) : ${(flat.reduce((s, x) => s + x, 0) / flat.length).toFixed(3)} ; manche 1 : ${mults[0].map(x => x.toFixed(2)).join(', ')}`)

// ── 3a. Déplacement d'un Crâ d'une case avant un tour (échange de Mort en Sursis), retour à son propre tour
console.log('\n== 3a. Un Crâ déplacé d\'une case (échange de Mort en Sursis) pendant la phase monstres, puis retour sur sa case à son tour')
const finalCells = ref.map(c => chosen.dest.get(c)!)
let total = 0, bad = 0
const badList: string[] = []
for (let victim = 0; victim < 4; victim++) for (const phase of [0, 1, 2, 3]) for (const r0 of [3, 4, 5, 6]) {
  const home = finalCells[victim]
  for (const nb of neighborsOf(home)) {
    if (nb < 0 || !map.walk[nb]) continue
    let displaced = false
    const beforeTurn = (r: number, idx: number, st: SimState) => {
      if (r === r0 && idx === phase && !displaced) {
        const occ = st.players.some(p => p.alive && p.cell === nb) || st.bombs.some(b => b.alive && b.cell === nb)
        if (!occ) { st.players[victim].cell = nb; displaced = true }
      }
    }
    const move = (r: number, idx: number, st: SimState) => (r > 1 && st.players[idx].cell !== finalCells[idx] && pathLen(st.players[idx].cell, finalCells[idx], st, idx) <= 6 ? finalCells[idx] : undefined)
    const a = runStart(ref, chosen.dest, { beforeTurn, move }, 'dfs', r0 + 6)
    if (!displaced) continue
    total++
    if (!a.ok) { bad++; badList.push(`J${victim + 1} ${xy(home)}→${xy(nb)} avant le tour de J${phase + 1} m${r0} (morts : ${a.res.deaths.map(d => 'J' + (d.idx + 1) + ' m' + d.round).join(',')})`) }
  }
}
console.log(`  cas testés ${total}, cas avec au moins une mort ${bad}`)
for (const s of badList.slice(0, 40)) console.log('   ', s)

// ── 3b. Un ennemi sur une case pendant UNE seule apparition (il part ensuite)
console.log('\n== 3b. Un ennemi présent sur une case pendant une seule phase monstres (une apparition), cases à ≤ 3 de la chaîne')
const near: number[] = []
for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && !finalCells.includes(c) && Math.min(...finalCells.map(p => distance(p, c))) <= 3) near.push(c)
const badCells = new Map<number, string[]>()
for (const c of near) for (const phase of [0, 1, 2, 3]) for (const r0 of [3, 4, 5, 6]) {
  const beforeTurn = (r: number, idx: number, st: SimState) => {
    st.monsters.clear()
    if (r === r0 && idx === phase && !st.bombs.some(b => b.alive && b.cell === c)) st.monsters.add(c)
  }
  const a = runStart(ref, chosen.dest, { beforeTurn }, 'dfs', r0 + 6)
  if (!a.ok) {
    const l = badCells.get(c) ?? []
    l.push(`avant J${phase + 1} m${r0}`)
    badCells.set(c, l)
  }
}
console.log(`  ${near.length} cases testées × 4 phases × 4 manches ; cases dangereuses : ${badCells.size}`)
for (const [c, l] of badCells) console.log(`    ${xy(c)} : ${l.length} cas (${l.slice(0, 6).join(', ')})`)

// ── 3c. Mort d'un Crâ (monstres) à la manche 4 ; les Crâs derrière lui avancent de 2 cases à leur tour suivant
console.log('\n== 3c. Mort d\'un Crâ à la manche 4 (avant son tour), resserrement : chaque Crâ derrière le trou avance de 2 cases à son tour')
for (let victim = 0; victim < 4; victim++) {
  const beforeTurn = (r: number, idx: number) => (r === 4 && idx === 0 ? { kill: [victim] } : undefined)
  // après la mort, la chaîne cible devient les 3 premières cases (avant), dans l'ordre des positions
  const move = (r: number, idx: number, st: SimState) => {
    if (r < 4 || !st.players[victim] || st.players[victim].alive) return undefined
    const alive = st.players.filter(p => p.alive).sort((a, b) => CELL_Y[b.cell] - CELL_Y[a.cell])
    const k = alive.findIndex(p => p.idx === idx)
    const want = T[k]
    if (st.players[idx].cell === want) return undefined
    return pathLen(st.players[idx].cell, want, st, idx) <= 6 ? want : undefined
  }
  for (const mode of ['dfs', 'bfs'] as const) {
    const a = runStart(ref, chosen.dest, { beforeTurn, move }, mode, 16)
    console.log(`  victime J${victim + 1} (${xy(finalCells[victim])}) [${mode}] : ${a.ok ? 'aucune autre mort sur 16 manches' : 'morts ' + a.res.deaths.map(d => 'J' + (d.idx + 1) + ' m' + d.round).join(',')}`)
  }
  // variante : personne ne bouge (le trou reste)
  const s = runStart(ref, chosen.dest, { beforeTurn }, 'dfs', 16)
  console.log(`  victime J${victim + 1}, sans resserrement : ${s.ok ? 'aucune autre mort' : 'morts ' + s.res.deaths.map(d => 'J' + (d.idx + 1) + ' m' + d.round).join(',')}`)
}

// ── 4. Ligne de vue depuis la chaîne (état au début de la manche 3, bombes en place)
const mapJson = JSON.parse(readFileSync('/home/user/DofusSimu/data/maps/137101312.json', 'utf8')) as { cells: { id: number; los: boolean }[] }
const opaque = opaqueCells(mapJson.cells as never)
let snapshot: SimState | undefined
runStart(ref, chosen.dest, { beforeTurn: (r, idx, st) => { if (r === 3 && idx === 0) snapshot = JSON.parse(JSON.stringify({ players: st.players, bombs: st.bombs })) as SimState } }, 'dfs', 3)
const occ = new Set<number>([...snapshot!.players.map(p => p.cell), ...snapshot!.bombs.filter(b => b.alive).map(b => b.cell)])
console.log(`\n== 4. Ligne de vue au début de la manche 3 (bombes en ${snapshot!.bombs.filter(b => b.alive).map(b => xy(b.cell)).join(' ')})`)
const zone: number[] = []
for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && CELL_Y[c] >= -6 && CELL_Y[c] <= 3) zone.push(c)
for (const p of finalCells) {
  const vis = zone.filter(c => !occ.has(c) && distance(p, c) <= 12 && hasLineOfSightOnMap(opaque, p, c, x => x !== p && occ.has(x)))
  const vis8 = vis.filter(c => distance(p, c) <= 8)
  console.log(`  ${xy(p)} : voit ${vis.length}/${zone.length} cases de la zone d'approche (y −6..3) à ≤ 12, dont ${vis8.length} à ≤ 8`)
}
// sorties latérales : cases à 1-2 PM de chaque Crâ et nombre de cases de la zone vues depuis là
for (const p of finalCells) {
  const others = new Set([...occ].filter(c => c !== p))
  const d = bfsDistances(p, c => !!map.walk[c] && !others.has(c), 3)
  const outs: string[] = []
  for (let c = 0; c < CELL_COUNT; c++) {
    if (d[c] < 1 || d[c] > 2) continue
    const vis = zone.filter(z => !others.has(z) && distance(c, z) <= 10 && hasLineOfSightOnMap(opaque, c, z, x => x !== c && others.has(x)))
    outs.push(`${xy(c)}:${d[c]}PM/${vis.length}`)
  }
  outs.sort((a, b) => Number(b.split('/')[1]) - Number(a.split('/')[1]))
  console.log(`  sorties de ${xy(p)} (case:PM/cases vues à ≤ 10) : ${outs.slice(0, 5).join('  ')}`)
}

// ── 5. Mort en Sursis : cases d'où la Reine peut viser chaque Crâ de la chaîne (en ligne ≤ 5, LdV, bombes en place)
console.log('\n== 5. Cases de lancer de Mort en Sursis (en ligne 1-5, LdV) sur chaque case de la chaîne, état manche 3')
for (const p of finalCells) {
  const from: number[] = []
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!map.walk[c] || occ.has(c)) continue
    if (!(CELL_X[c] === CELL_X[p] || CELL_Y[c] === CELL_Y[p])) continue
    const d = distance(c, p)
    if (d < 1 || d > 5) continue
    if (hasLineOfSightOnMap(opaque, c, p, x => x !== c && x !== p && occ.has(x))) from.push(c)
  }
  console.log(`  ${xy(p)} : ${from.map(xy).join(' ')}`)
}
