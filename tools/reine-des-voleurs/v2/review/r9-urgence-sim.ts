// Relecture : effet du sauvetage « Flèche de Recul sur sa propre bombe de repli » (r8) dans le modèle complet :
// ennemi sur la case habituelle pendant UNE apparition (manches 2 à 10, 4 Crâs, tous les ordres valides, dfs+bfs).
// Sans sauvetage vs avec sauvetage (la bombe de repli est poussée de 2 cases vers le haut de l'écran dans le même tour).
import { loadMap, simulate, PERMS4, VARIANTS, type SimState, type Timing, type Chain } from '../search/modele2'
const map = loadMap()
const S0 = [365, 378, 437, 451], T0 = [311, 392, 398, 479], Y0 = [325, 406, 412, 493]
const VALID_SAME_N2 = ['365,437,378,451', '365,437,451,378', '437,365,378,451', '437,365,451,378']
const ordersAll = PERMS4.map(p => p.map(i => S0[i]))
const ordersOK = (v: number, t: Timing) => (v <= 1 && t === 'same') ? ordersAll.filter(o => VALID_SAME_N2.includes(o.join(','))) : ordersAll
const want = (s: number, r: number, v: number, t: Timing) => { const i = S0.indexOf(s); return v >= 2 && t === 'next' && r >= 2 && r % 2 === 0 ? Y0[i] : T0[i] }
// case habituelle (primaire) par Crâ et lecture, depuis la case tenue / jaune ; repli NE2 ; destination après poussée (N2 = −28)
for (const v of [0, 2]) for (const t of ['same', 'next'] as Timing[]) {
  for (const rescue of [false, true]) {
    let bad = 0, tot = 0
    for (const o of ordersOK(v, t)) for (let k = 2; k <= 10; k++) for (let j = 0; j < 4; j++) {
      let fail = false
      for (const ch of ['dfs', 'bfs'] as Chain[]) {
        let enemyCell = -1
        const res = simulate(map, o, { rounds: 30, variant: v, timing: t, chain: ch,
          beforeTurn: (r, idx, st: SimState) => {
            st.monsters.clear()
            if (r === k && idx === j) {
              const cur = st.players[idx].cell
              enemyCell = v === 0 ? cur - 28 : cur - 56 // case N2 / N4 du joueur
              if (!st.bombs.some(b => b.alive && b.cell === enemyCell)) st.monsters.add(enemyCell); else enemyCell = -1
            }
          },
          move: (r, idx, st) => {
            if (rescue && r === k && idx === j && enemyCell >= 0) {
              const cur = st.players[idx].cell
              const fb = st.bombs.find(b => b.alive && b.owner === idx && b.born === r && b.cell === cur - 27) // repli NE2
              // destinations réelles mesurées par r8 / r8b : depuis la case tenue, la bombe monte de 2 cases (−56) ;
              // depuis la case jaune (N4 + tour suivant), tir depuis la case en haut à droite de la case tenue
              const YD: Record<number, number> = { 298: 300, 385: 386, 379: 381, 466: 467 }
              const dest = Y0.includes(cur) ? (YD[cur - 27] ?? -1) : cur - 27 - 56
              if (dest < 0) return want(o[idx], r, v, t)
              if (fb && map.walk[dest] && !st.bombs.some(b => b.alive && b.cell === dest)) fb.cell = dest
            }
            return want(o[idx], r, v, t)
          } })
        if (!res.ok) fail = true
      }
      tot++; if (fail) bad++
    }
    console.log(`${VARIANTS[v].id} ${VARIANTS[v].label}/${t === 'next' ? 'suivant' : 'même'} ${rescue ? 'AVEC sauvetage' : 'sans sauvetage'} : ${bad}/${tot} parties avec une mort (${(100 * bad / tot).toFixed(1)} %)`)
  }
}
