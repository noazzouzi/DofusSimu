// Robustesse du placement proposé aux deux incertitudes majeures sur les Bonbombes :
//  - moment de l'explosion : 'next' (fin du tour SUIVANT du poseur, jeu réel d'après DofusWiki/vidéos/état Mèche courte)
//    ou 'same' (fin du même tour, comportement actuel du moteur) ;
//  - case d'apparition : 'ne' (DofusWiki, moteur) ou 'n' (lecture « vers le haut » de JOL).
// Compare avec les placements statiques proposés par l'agent « données » (analyse au tour 1, modèle moteur).
import { loadMap, simulate, permutations, xy, type SimState } from './modele-bombes'
import { pointToCell as P } from '/home/user/DofusSimu/src/map/geometry'
import { bfsDistances } from '/home/user/DofusSimu/src/map/path'

const map = loadMap()
function pathLen(from: number, to: number, st: SimState, self: number): number {
  if (from === to) return 0
  const occ = new Set<number>([...st.monsters])
  for (const p of st.players) if (p.alive && p.idx !== self) occ.add(p.cell)
  for (const b of st.bombs) if (b.alive) occ.add(b.cell)
  if (occ.has(to)) return 99
  const d = bfsDistances(from, c => !!map.walk[c] && !occ.has(c), 12)
  return d[to] < 0 ? 99 : d[to]
}
const cases: { name: string; start: number[]; dest: Map<number, number> }[] = [
  { name: 'PROPOSÉ 354,381,380,451 → 354,381,408,435', start: [354, 381, 380, 451], dest: new Map([[354, 354], [381, 381], [380, P(17, -12)], [451, P(17, -14)]]) },
  { name: 'agent données {340,367,378,451} immobiles', start: [340, 367, 378, 451], dest: new Map([[340, 340], [367, 367], [378, 378], [451, 451]]) },
  { name: 'agent données {354,378,381,451} immobiles', start: [354, 378, 381, 451], dest: new Map([[354, 354], [378, 378], [381, 381], [451, 451]]) },
  { name: 'chaîne directe 354,381 + 395→408, 451→435', start: [354, 381, 395, 451], dest: new Map([[354, 354], [381, 381], [395, P(17, -12)], [451, P(17, -14)]]) },
]
for (const c of cases) {
  console.log(`== ${c.name}`)
  for (const timing of ['next', 'same'] as const) for (const spawnRule of ['ne', 'n'] as const) {
    let ok = 0
    let firstFail = ''
    for (const ord of permutations(c.start)) {
      let good = true
      for (const chain of ['dfs', 'bfs'] as const) {
        let fail = false
        const move = (r: number, idx: number, st: SimState) => {
          if (r !== 1) return undefined
          const to = c.dest.get(ord[idx])!
          const len = pathLen(st.players[idx].cell, to, st, idx)
          if (len > 6) { fail = true; return undefined }
          return to
        }
        const res = simulate(map, ord, { rounds: 20, chain, timing, spawnRule, move })
        if (!res.ok || fail) {
          good = false
          if (!firstFail) firstFail = `ex. ordre ${ord.join('→')} : ${fail ? 'chemin bloqué' : 'mort J' + (res.deaths[0].idx + 1) + ' manche ' + res.deaths[0].round}`
          break
        }
      }
      if (good) ok++
    }
    console.log(`  explosion ${timing === 'next' ? 'tour suivant' : 'même tour  '} / apparition ${spawnRule === 'ne' ? 'NE (wiki) ' : 'N (JOL)   '} : ${String(ok).padStart(2)}/24 ordres sans mort (20 manches) ${ok < 24 ? firstFail : ''}`)
  }
}
