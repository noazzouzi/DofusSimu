// Relecture : premières apparitions en repli (N2 + tour suivant, lectures A et B) pour les 4 ordres « frise ».
import { loadMap, simulate, type Timing } from '../search/modele2'
const map = loadMap()
const S0 = [365, 378, 437, 451], T0 = [311, 392, 398, 479]
const NAME: Record<number, string> = { 365: 'A', 437: 'B', 378: 'C', 451: 'D' }
for (const v of [0, 1]) for (const ord of [[365, 437, 378, 451], [437, 365, 378, 451], [365, 437, 451, 378], [437, 365, 451, 378]]) {
  const res = simulate(map, ord, { rounds: 4, variant: v, timing: 'next' as Timing, chain: 'dfs', log: true, move: (r, idx) => T0[S0.indexOf(ord[idx])] })
  const sp = res.events.filter(e => e.kind === 'spawn').map(e => `t${e.round}:${NAME[ord[e.who]]}@${e.cell}${e.info === 'repli' ? '(REPLI)' : ''}`)
  console.log(`${v === 0 ? 'A N2→NE2' : 'B N2→N2+NE1'} ordre ${ord.map(c => NAME[c]).join('')} : ${sp.join(' ')}`)
}
