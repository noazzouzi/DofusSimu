// Placement proposé sous la règle actuelle du moteur (explosion à la fin du même tour) : quels ordres passent ?
import { loadMap, simulate, permutations, type SimState } from './modele-bombes'
import { pointToCell as P } from '/home/user/DofusSimu/src/map/geometry'
const map = loadMap()
const dest = new Map([[354, 354], [381, 381], [380, P(17, -12)], [451, P(17, -14)]])
let okBefore = 0, okAfter = 0, nBefore = 0, nAfter = 0
for (const ord of permutations([354, 381, 380, 451])) {
  const move = (r: number, i: number, _st: SimState) => (r === 1 ? dest.get(ord[i]) : undefined)
  const ok = (['dfs', 'bfs'] as const).every(chain => simulate(map, ord, { rounds: 20, timing: 'same', chain, move }).ok)
  const before = ord.indexOf(380) < ord.indexOf(451)
  if (before) { nBefore++; if (ok) okBefore++ } else { nAfter++; if (ok) okAfter++ }
}
console.log(`même tour : 380 joue avant 451 → ${okBefore}/${nBefore} ordres sans mort ; 380 après 451 → ${okAfter}/${nAfter}`)
