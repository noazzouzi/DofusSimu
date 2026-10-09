// Recherche B/C (modèle « jeu réel » des Bonbombes, modele-bombes.ts).
//  B : chaînes statiques candidates (colonne, pas de 2, case NE-2 du premier bloquée par le pilier rouge) + les 6
//      placements rouges statiques trouvés par recherche-statique.ts : survie sur 20 manches (dfs et bfs), ordres.
//  C : départ sur 4 cases rouges, déplacement pendant la manche 1 vers une chaîne, puis immobiles : survie 15 manches.
//  D : sensibilité : un ennemi immobile sur UNE case voisine casse-t-il la formation ? (toutes cases à ≤ 4 de la formation)
import { loadMap, simulate, permutations, xy, type SimState } from './modele-bombes'
import { pointToCell as P, distance, CELL_COUNT } from '/home/user/DofusSimu/src/map/geometry'
import { bfsDistances } from '/home/user/DofusSimu/src/map/path'

const map = loadMap()
const both = (cells: number[], rounds: number, monsters: number[] = [], move?: (r: number, i: number, st: SimState) => number | undefined) => {
  const a = simulate(map, cells, { rounds, chain: 'dfs', monsters, move })
  const b = simulate(map, cells, { rounds, chain: 'bfs', monsters, move })
  return { ok: a.ok && b.ok, a, b }
}

const chains: Record<string, number[]> = {
  'C17a x=17 y−8..−14': [P(17, -8), P(17, -10), P(17, -12), P(17, -14)],
  'C17b x=17 y−9..−15': [P(17, -9), P(17, -11), P(17, -13), P(17, -15)],
  'C16b x=16 y−9..−15': [P(16, -9), P(16, -11), P(16, -13), P(16, -15)],
  'C16a x=16 y−8..−14': [P(16, -8), P(16, -10), P(16, -12), P(16, -14)],
}
const redStatic: Record<string, number[]> = {
  'R1 325 354 378 381': [325, 354, 378, 381],
  'R2 325 354 381 437': [325, 354, 381, 437],
  'R3 340 365 367 369': [340, 365, 367, 369],
  'R4 340 367 369 451': [340, 367, 369, 451],
  'R5 354 378 380 381': [354, 378, 380, 381],
  'R6 354 378 381 437': [354, 378, 381, 437],
}

console.log('== B : formations statiques, 20 manches')
for (const [name, cells] of Object.entries({ ...chains, ...redStatic })) {
  const ords = permutations(cells)
  const ok = ords.filter(o => both(o, 20).ok)
  const r = ok.length ? simulate(map, ok[0], { rounds: 20 }) : undefined
  const mult = r ? r.bombsDuring.slice(1, 7).flat().filter(x => x >= 0) : []
  const avg = mult.length ? mult.reduce((s, n) => s + Math.pow(0.9, n), 0) / mult.length : 0
  console.log(`  ${name.padEnd(22)} ${cells.map(xy).join(' ')} : ${ok.length}/24 ordres sans mort${ok.length ? ` ; ex. ${ok[0].join('→')} ; bombes pendant les tours (m2..m7) ${r!.bombsDuring.slice(1, 7).map(x => x.join(',')).join(' | ')} ; multiplicateur moyen Reine ${avg.toFixed(3)} ; soins bleus ${r!.maxBlueHeal}` : ''}`)
}

// ── D : sensibilité à un ennemi immobile
function sensitivity(order: number[], rounds = 12) {
  const bad: number[] = []
  let tested = 0
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!map.walk[c] || order.includes(c)) continue
    if (Math.min(...order.map(p => distance(p, c))) > 4) continue
    tested++
    if (!both(order, rounds, [c]).ok) bad.push(c)
  }
  return { tested, bad }
}
console.log('\n== D : un ennemi immobile sur une case à ≤ 4 de la formation (12 manches) : cases qui provoquent au moins une mort')
for (const [name, cells] of Object.entries({ 'C17a': chains['C17a x=17 y−8..−14'], 'C17b': chains['C17b x=17 y−9..−15'], 'C16b': chains['C16b x=16 y−9..−15'], ...redStatic })) {
  const ords = permutations(cells).filter(o => both(o, 20).ok)
  if (!ords.length) continue
  // meilleur ordre = le moins sensible
  let best: { o: number[]; s: ReturnType<typeof sensitivity> } | undefined
  for (const o of ords.slice(0, 24)) {
    const s = sensitivity(o)
    if (!best || s.bad.length < best.s.bad.length) best = { o, s }
  }
  console.log(`  ${name.padEnd(20)} ordre ${best!.o.join('→')} : ${best!.s.bad.length}/${best!.s.tested} cases dangereuses : ${best!.s.bad.map(xy).join(' ')}`)
}

// ── C : transitions rouge → chaîne pendant la manche 1
console.log('\n== C : départ rouge, déplacement à la manche 1 vers la chaîne, puis immobiles (15 manches, dfs et bfs)')
function pathLen(from: number, to: number, st: SimState, self: number): number {
  if (from === to) return 0
  const occ = new Set<number>([...st.monsters])
  for (const p of st.players) if (p.alive && p.idx !== self) occ.add(p.cell)
  for (const b of st.bombs) if (b.alive) occ.add(b.cell)
  if (occ.has(to)) return 99
  const d = bfsDistances(from, c => !!map.walk[c] && !occ.has(c), 12)
  return d[to] < 0 ? 99 : d[to]
}
const R = map.red
for (const [name, T] of Object.entries(chains)) {
  const results: { S: number[]; T: number[]; pm: number; maxPm: number }[] = []
  // S : 4 rouges ordonnées (ordre de jeu) ; T : affectation (permutation de la chaîne)
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) for (let k = j + 1; k < R.length; k++) for (let l = k + 1; l < R.length; l++) {
    const set = [R[i], R[j], R[k], R[l]]
    for (const S of permutations(set)) for (const Tp of permutations(T)) {
      let pm = 0, maxPm = 0, fail = false
      const move = (r: number, idx: number, st: SimState) => {
        if (r !== 1) return undefined
        const len = pathLen(st.players[idx].cell, Tp[idx], st, idx)
        if (len > 6) { fail = true; return undefined }
        pm += len; maxPm = Math.max(maxPm, len)
        return Tp[idx]
      }
      const a = simulate(map, S, { rounds: 15, chain: 'dfs', move })
      if (fail || !a.ok) continue
      pm = 0; maxPm = 0
      const b = simulate(map, S, { rounds: 15, chain: 'bfs', move })
      if (fail || !b.ok) continue
      results.push({ S, T: Tp, pm, maxPm })
    }
  }
  results.sort((x, y) => x.maxPm - y.maxPm || x.pm - y.pm)
  const sets = new Set(results.map(r => [...r.S].sort((a, b) => a - b).join(',')))
  console.log(`  ${name} : ${results.length} (départ ordonné, affectation) valides ; ${sets.size} ensembles de départ distincts`)
  for (const r of results.slice(0, 12)) console.log(`    départ ${r.S.join('→')}  ⇒  ${r.T.join(',')}  (PM max ${r.maxPm}, total ${r.pm})`)
}
