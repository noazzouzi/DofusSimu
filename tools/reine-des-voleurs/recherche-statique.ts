// Recherche A : placements STATIQUES (personne ne bouge) qui survivent aux Bonbombes, modèle « jeu réel ».
//  A1 : les 495 ensembles de 4 cases rouges × 24 ordres de jeu.
//  A2 : la chaîne x=17 (y −8, −10, −12, −14) derrière le pilier, dans tous les ordres, avec trace.
import { loadMap, simulate, permutations, xy } from './modele-bombes'
import { pointToCell as pointToCellSafe } from '/home/user/DofusSimu/src/map/geometry'

const map = loadMap()
const R = map.red
const ROUNDS = 12

console.log('== A1 : 4 cases rouges, statiques, 12 manches, modèle jeu réel')
let nOk = 0
const okSets: string[] = []
for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) for (let k = j + 1; k < R.length; k++) for (let l = k + 1; l < R.length; l++) {
  const set = [R[i], R[j], R[k], R[l]]
  const orders = permutations(set)
  const good = orders.filter(ord => simulate(map, ord, { rounds: ROUNDS, chain: 'dfs' }).ok && simulate(map, ord, { rounds: ROUNDS, chain: 'bfs' }).ok)
  if (good.length) {
    nOk++
    okSets.push(`  ${set.map(xy).join(' ')} : ${good.length}/24 ordres, ex. ${good[0].join('→')}`)
  }
}
console.log(`ensembles survivants (au moins un ordre) : ${nOk} / 495`)
for (const s of okSets) console.log(s)

// Première mort par ensemble pour les 2 placements proposés par l'agent « données » (modèle moteur)
for (const set of [[340, 367, 378, 451], [354, 378, 381, 451]]) {
  console.log(`\nPlacement ${set.map(xy).join(' ')} (statique, modèle jeu réel) :`)
  for (const ord of permutations(set)) {
    const r = simulate(map, ord, { rounds: ROUNDS })
    const d = r.deaths[0]
    if (ord[0] === set[0] || ord[0] === set[1]) console.log(`  ordre ${ord.join('→')} : ${r.ok ? 'survie' : `1re mort manche ${d.round} (joueur ${d.idx + 1} en ${ord[d.idx]}, au tour du joueur ${d.turnOf + 1}) ; morts ${r.deaths.length}`}`)
  }
}

console.log('\n== A2 : chaîne x=17 derrière le pilier rouge')
const chain = [pointToCellSafe(17, -8), pointToCellSafe(17, -10), pointToCellSafe(17, -12), pointToCellSafe(17, -14)]
console.log('cases', chain.map(xy).join(' '))
let okOrders = 0
for (const ord of permutations(chain)) {
  const a = simulate(map, ord, { rounds: 20, chain: 'dfs' })
  const b = simulate(map, ord, { rounds: 20, chain: 'bfs' })
  if (a.ok && b.ok) okOrders++
  console.log(`  ordre ${ord.map(c => `(${xy(c)})`).join('→')} : dfs ${a.ok ? 'OK' : 'mort m' + a.deaths[0].round} / bfs ${b.ok ? 'OK' : 'mort m' + b.deaths[0].round} ; bombes vivantes pendant chaque tour m1..m4 : ${a.bombsDuring.slice(0, 4).map(x => x.join(',')).join(' | ')}`)
}
console.log(`ordres sans mort (20 manches, dfs et bfs) : ${okOrders}/24`)
const tr = simulate(map, chain, { rounds: 4, log: true })
console.log('\nTrace, ordre avant → arrière :')
for (const e of tr.events) console.log(`  m${e.round} tour J${e.turn + 1} ${e.kind} J${e.who + 1} ${xy(e.cell)} ${e.info ?? ''}`)
