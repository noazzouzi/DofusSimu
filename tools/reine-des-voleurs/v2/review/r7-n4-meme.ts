// Relecture : N4 + même tour. Un ennemi sur 255 (case N4 de A) au début du tour de A, manche 3 : trace.
import { loadMap, simulate, VARIANTS, type Timing } from '../search/modele2'
VARIANTS.push({ id: 'F', label: 'N4→N4+E1', first: [[-2, 2], [-1, 3]] })
const map = loadMap()
const S0 = [365, 378, 437, 451], T0 = [311, 392, 398, 479]
const NAME: Record<number, string> = { 365: 'A', 437: 'B', 378: 'C', 451: 'D' }
const ord = [365, 437, 378, 451]
for (const v of [2, 3, 4, 5]) for (const cell of [255, 342, 336, 423]) {
  const owner = { 255: 365, 342: 437, 336: 378, 423: 451 }[cell]!
  const res = simulate(map, ord, { rounds: 6, variant: v, timing: 'same' as Timing, chain: 'dfs', log: true,
    move: (r, idx) => T0[S0.indexOf(ord[idx])],
    beforeTurn: (r, idx, st) => { if (r === 3 && ord[idx] === owner) st.monsters.add(cell); else st.monsters.delete(cell) } })
  const ev = res.events.filter(e => e.round === 3 && (e.kind === 'spawn' || e.kind === 'death' || e.kind === 'explode')).map(e => `${e.kind}:${NAME[ord[e.who]] ?? e.who}@${e.cell}${e.info ? '(' + e.info + ')' : ''}`)
  console.log(`${VARIANTS[v].id} ${VARIANTS[v].label}/même, ennemi sur ${cell} au tour de ${NAME[owner]} (manche 3) : morts ${res.deaths.map(d => NAME[ord[d.idx]]).join(',') || 'aucune'} | ${ev.join(' ')}`)
}
