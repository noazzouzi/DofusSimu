// Relecture : géométrie de F-A, chemins du tour 1 (toutes lectures, tous ordres), distances entre Crâs.
import { loadMap, simulate, PERMS4, VARIANTS, xy, spawnList, type SimState, type Timing } from '../search/modele2'
import { CELL_X, CELL_Y, distance } from '../../../../src/map/geometry'
import { bfsDistances, shortestPath } from '../../../../src/map/path'
const map = loadMap()
const S0 = [365, 378, 437, 451], T0 = [311, 392, 398, 479], Y0 = [325, 406, 412, 493]
const all = [...S0, ...T0, ...Y0, 337, 309, 409, 381, 350, 322, 423, 395, 283, 284, 269, 370, 371, 356, 364, 365, 451, 452, 437, 255, 342, 336, 297, 384]
console.log('Coordonnées :', [...new Set(all)].map(xy).join(' '))
console.log('Murs/pilier rouge 313,326,327,341 marchables ?', [313, 326, 327, 341].map(c => map.walk[c]).join(','))
const pd = (cs: number[]) => cs.flatMap((a, i) => cs.slice(i + 1).map(b => `${a}-${b}:${distance(a, b)}`)).join(' ')
console.log('Distances entre cases tenues :', pd(T0))
console.log('Distances entre cases jaunes :', pd(Y0))
console.log('Tenue↔jaune (même Crâ) :', T0.map((t, i) => `${t}-${Y0[i]}:${distance(t, Y0[i])} enLigne=${CELL_X[t] === CELL_X[Y0[i]] || CELL_Y[t] === CELL_Y[Y0[i]]}`).join(' '))
console.log('Sorties en ligne (Pas Chassé 1-2 en ligne) :', [[311, 297], [311, 284], [398, 384], [398, 371]].map(([a, b]) => `${a}->${b}: d=${distance(a, b)} enLigne=${CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]}`).join(' '))
// Chemins du tour 1 avec bombes et Crâs comme obstacles, 10 lectures × 24 ordres × 2 moments
let worst: Record<string, number> = {}
let blockedCases = 0, tot = 0
for (let v = 0; v < VARIANTS.length; v++) for (const t of ['next', 'same'] as Timing[]) for (const p of PERMS4) {
  const order = p.map(i => S0[i])
  tot++
  let bad = false
  simulate(map, order, {
    rounds: 1, variant: v, timing: t, chain: 'dfs',
    move: (r, idx, st: SimState) => {
      const from = st.players[idx].cell, to = T0[S0.indexOf(order[idx])]
      const occ = new Set<number>()
      for (const q of st.players) if (q.alive && q.idx !== idx) occ.add(q.cell)
      for (const b of st.bombs) if (b.alive) occ.add(b.cell)
      const d = bfsDistances(from, c => !!map.walk[c] && !occ.has(c), 20)[to]
      const k = `${from}->${to}`
      worst[k] = Math.max(worst[k] ?? 0, d < 0 ? 99 : d)
      if (d < 0 || d > 5) bad = true
      return to
    },
  })
  if (bad) blockedCases++
}
console.log(`Tour 1, chemin le plus long observé (10 lectures × 24 ordres) :`, worst, `; parties avec un chemin > 5 PM : ${blockedCases}/${tot}`)
const sp = (a: number, b: number) => shortestPath(a, b, c => !!map.walk[c])
console.log('Chemin type 437→398 :', sp(437, 398)?.join('→'), ' ; 365→311 :', sp(365, 311)?.join('→'), ' ; 451→479 :', sp(451, 479)?.join('→'))
// Nombre de chemins les plus courts 437→398 (5 PM) : marge si une case est prise
function countShortest(a: number, b: number, blocked: Set<number>) {
  const da = bfsDistances(a, c => !!map.walk[c] && !blocked.has(c), 30)
  const L = da[b]
  return L
}
console.log('437→398 si une case intermédiaire est prise :', (sp(437, 398) ?? []).slice(1, -1).map(c => `${c}:${countShortest(437, 398, new Set([c]))}`).join(' '))
console.log('365→311 si une case intermédiaire est prise :', (sp(365, 311) ?? []).slice(1, -1).map(c => `${c}:${countShortest(365, 311, new Set([c]))}`).join(' '))
