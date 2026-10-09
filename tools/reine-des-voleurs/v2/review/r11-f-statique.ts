// Relecture : lecture F (N4 → case à droite de N4), tour suivant, SANS alternance (Crâs immobiles) : sûr ou non ?
import { loadMap, simulate, PERMS4, VARIANTS, type Timing, type Chain } from '../search/modele2'
VARIANTS.push({ id: 'F', label: 'N4→N4+E1', first: [[-2, 2], [-1, 3]] })
const map = loadMap()
const S0 = [365, 378, 437, 451], T0 = [311, 392, 398, 479]
for (let v = 2; v < VARIANTS.length; v++) {
  let ok = 0
  for (const p of PERMS4) { const o = p.map(i => S0[i]); let good = true
    for (const ch of ['dfs', 'bfs'] as Chain[]) if (!simulate(map, o, { rounds: 30, variant: v, timing: 'next' as Timing, chain: ch, move: (r, idx) => T0[S0.indexOf(o[idx])] }).ok) good = false
    if (good) ok++ }
  console.log(`${VARIANTS[v].id} ${VARIANTS[v].label}/suivant sans alternance : ${ok}/24`)
}
