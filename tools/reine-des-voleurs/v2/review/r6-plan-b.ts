// Relecture : N4 + tour suivant. Si la case d'alternance (jaune, tour pair) ou la case tenue (tour impair) est prise
// par un monstre, existe-t-il une case de secours (≤ 2 PM) sans mort, pour toutes les lectures N4 (C, D, E, F),
// tous les ordres, les deux chaînes, manches 2 à 12 ?
import { loadMap, simulate, PERMS4, VARIANTS, type Timing, type Chain } from '../search/modele2'
import { distance } from '../../../../src/map/geometry'
VARIANTS.push({ id: 'F', label: 'N4→N4+E1', first: [[-2, 2], [-1, 3]] })
const map = loadMap()
const S0 = [365, 378, 437, 451], T0 = [311, 392, 398, 479], Y0 = [325, 406, 412, 493]
const NAME = ['A', 'C', 'B', 'D']
const orders = PERMS4.map(p => p.map(i => S0[i]))
const want = (i: number, r: number) => (r >= 2 && r % 2 === 0 ? Y0[i] : T0[i])
for (const parity of ['pair', 'impair'] as const) {
  console.log(`\n== Tour ${parity} : la case prévue (${parity === 'pair' ? 'jaune' : 'tenue'}) est prise ; case de secours essayée à la place`)
  for (let i = 0; i < 4; i++) {
    const base = parity === 'pair' ? T0[i] : Y0[i]
    const cand: number[] = []
    for (let z = 0; z < 560; z++) if (map.walk[z] && distance(base, z) <= 2 && z !== (parity === 'pair' ? Y0[i] : T0[i])) cand.push(z)
    const res: string[] = []
    for (const z of cand) {
      let bad = 0, tot = 0
      for (let v = 2; v < VARIANTS.length; v++) for (const o of orders) for (let k = 2; k <= 12; k++) {
        if ((k % 2 === 0) !== (parity === 'pair')) continue
        let fail = false
        for (const ch of ['dfs', 'bfs'] as Chain[]) {
          const r = simulate(map, o, { rounds: 30, variant: v, timing: 'next' as Timing, chain: ch,
            move: (r, idx, st) => {
              const j = S0.indexOf(o[idx])
              if (r === k && j === i) {
                if (st.bombs.some(b => b.alive && b.cell === z) || st.players.some(p => p.alive && p.cell === z && p.idx !== idx)) { fail = true; return st.players[idx].cell }
                return z
              }
              return want(j, r)
            } })
          if (!r.ok) fail = true
        }
        tot++; if (fail) bad++
      }
      res.push(`${z}${z === base ? '(rester)' : ''}:${Math.round(100 * bad / tot)}%`)
    }
    console.log(`  Crâ ${NAME[i]} (${T0[i]}/${Y0[i]}) : ${res.join(' ')}`)
  }
}
