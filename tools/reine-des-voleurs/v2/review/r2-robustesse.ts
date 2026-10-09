// Relecture adverse de F-A dans le modèle étendu (../search/modele2.ts) :
//  a. contrôle des 10 lectures + lecture F « N4 → case à droite de N4 » (−1,+3) (« sa diagonale à droite » au sens Dofus) ;
//  b. alternance ratée une fois (N4 + tour suivant) : Crâ privé de PM un tour ;
//  c. Crâ qui finit UN tour sur sa case de sortie (tacle / retrait de PM pendant la sortie) ;
//  d. ennemi présent pendant UNE apparition (il a pu y entrer pendant le tour du monstre qui joue juste avant le Crâ).
import { loadMap, simulate, PERMS4, VARIANTS, xy, type SimState, type Timing, type Chain } from '../search/modele2'
import { CELL_COUNT, distance } from '../../../../src/map/geometry'
VARIANTS.push({ id: 'F', label: 'N4→N4+E1', first: [[-2, 2], [-1, 3]] })
const map = loadMap()
const S0 = [365, 378, 437, 451], T0 = [311, 392, 398, 479], Y0 = [325, 406, 412, 493]
const VALID_SAME_N2 = ['365,437,378,451', '365,437,451,378', '437,365,378,451', '437,365,451,378']
const isN4 = (v: number) => v >= 2
const alt = (v: number, t: Timing) => isN4(v) && t === 'next'
function want(s: number, r: number, v: number, t: Timing) { const i = S0.indexOf(s); return alt(v, t) && r >= 2 && r % 2 === 0 ? Y0[i] : T0[i] }
const ordersAll = PERMS4.map(p => p.map(i => S0[i]))
const ordersOK = (v: number, t: Timing) => (v <= 1 && t === 'same') ? ordersAll.filter(o => VALID_SAME_N2.includes(o.join(','))) : ordersAll
const ordersFront = ordersAll.filter(o => VALID_SAME_N2.includes(o.join(',')))
type Pert = { move?: (r: number, idx: number, st: SimState, order: number[], dflt: number) => number; before?: (r: number, idx: number, st: SimState, order: number[]) => void }
function run(order: number[], v: number, t: Timing, ch: Chain, pert?: Pert) {
  const res = simulate(map, order, {
    rounds: 30, variant: v, timing: t, chain: ch,
    move: (r, idx, st) => { const d = want(order[idx], r, v, t); return pert?.move ? pert.move(r, idx, st, order, d) : d },
    beforeTurn: pert?.before ? (r, idx, st) => pert.before!(r, idx, st, order) : undefined,
  })
  return res
}
const NAMES = (v: number, t: Timing) => `${VARIANTS[v].id} ${VARIANTS[v].label}/${t === 'next' ? 'suivant' : 'même'}`
console.log('== a. Contrôle (sans perturbation) ; ordres « frise » = A et B avant C et D')
for (let v = 0; v < VARIANTS.length; v++) for (const t of ['next', 'same'] as Timing[]) {
  let ok = 0, okF = 0, beyond = 0, fallback = 0, heals = 0
  for (const o of ordersAll) {
    const a = run(o, v, t, 'dfs'), b = run(o, v, t, 'bfs')
    if (a.ok && b.ok) ok++
    if (ordersFront.some(f => f.join() === o.join()) && a.ok && b.ok) okF++
    beyond += a.beyond.length; fallback += a.fallback; heals += a.healsBy.flat().length
  }
  console.log(`  ${NAMES(v, t).padEnd(22)} tous ordres ${ok}/24 ; ordres frise ${okF}/4 ; apparitions au-delà du repli ${beyond} ; replis ${fallback} ; soins ${heals}`)
}
// b. alternance ratée
console.log('\n== b. N4 + tour suivant : un Crâ ne peut pas bouger pendant UN tour (0 PM, Pesanteur…), manches 2 à 12')
for (let v = 2; v < VARIANTS.length; v++) {
  const t: Timing = 'next'
  for (const kind of ['reste sur sa case un tour pair', 'reste sur la case jaune un tour impair'] as const) {
    let bad = 0, tot = 0
    const perVictim: Record<number, [number, number]> = {}
    for (const o of ordersAll) for (let vi = 0; vi < 4; vi++) for (let k = 2; k <= 12; k++) {
      if (kind.includes('pair') && !kind.includes('impair') && k % 2 !== 0) continue
      if (kind.includes('impair') && k % 2 === 0) continue
      const victim = S0[vi]
      let fail = false
      for (const ch of ['dfs', 'bfs'] as Chain[]) {
        const res = run(o, v, t, ch, { move: (r, idx, st, order, d) => (r === k && order[idx] === victim ? st.players[idx].cell : d) })
        if (!res.ok) fail = true
      }
      tot++; if (fail) bad++
      perVictim[victim] ??= [0, 0]; perVictim[victim][1]++; if (fail) perVictim[victim][0]++
    }
    console.log(`  ${NAMES(v, t).padEnd(22)} ${kind} : ${bad}/${tot} parties avec une mort (${Math.round(100 * bad / tot)} %) — ` + S0.map(s => `${s}:${Math.round(100 * perVictim[s][0] / perVictim[s][1])}%`).join(' '))
  }
}
// c. Crâ coincé sur sa case de sortie pendant un tour
console.log('\n== c. Crâ qui finit UN tour sur une case de sortie (tacle, retrait de PM), puis rentre au tour suivant ; manches 2 à 12')
const SORTIES: Record<number, number[]> = { 365: [297, 284], 437: [384, 371], 378: [378], 451: [465] }
for (let v = 0; v < VARIANTS.length; v++) for (const t of ['next', 'same'] as Timing[]) {
  const parts: string[] = []
  for (const s of [365, 437]) for (const exitCell of SORTIES[s]) {
    let bad = 0, tot = 0
    for (const o of ordersOK(v, t)) for (let k = 2; k <= 12; k++) {
      let fail = false, skip = false
      for (const ch of ['dfs', 'bfs'] as Chain[]) {
        const res = run(o, v, t, ch, { move: (r, idx, st, order, d) => {
          if (r === k && order[idx] === s) { if (st.bombs.some(b => b.alive && b.cell === exitCell)) { skip = true; return d } return exitCell }
          return d
        } })
        if (!res.ok) fail = true
      }
      if (skip) continue
      tot++; if (fail) bad++
    }
    parts.push(`${s === 365 ? 'A' : 'B'} en ${exitCell} : ${bad}/${tot} (${tot ? Math.round(100 * bad / tot) : 0} %)`)
  }
  console.log(`  ${NAMES(v, t).padEnd(22)} ` + parts.join(' ; '))
}
// d. ennemi présent pendant une seule apparition
console.log('\n== d. Ennemi sur une case pendant UNE apparition (arrivé pendant le tour du monstre qui précède le Crâ, chassé ensuite) ; manches 2 à 10')
const near: number[] = []
for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && Math.min(...T0.map(x => distance(x, c)), ...Y0.map(x => distance(x, c))) <= 4 && !T0.includes(c) && !Y0.includes(c)) near.push(c)
for (let v = 0; v < VARIANTS.length; v++) for (const t of ['next', 'same'] as Timing[]) {
  const bads: string[] = []
  for (const c of near) {
    let bad = 0, tot = 0
    for (const o of ordersOK(v, t)) for (let k = 2; k <= 10; k++) for (let j = 0; j < 4; j++) {
      let fail = false
      for (const ch of ['dfs', 'bfs'] as Chain[]) {
        const res = run(o, v, t, ch, { before: (r, idx, st) => {
          if (r === k && idx === j) { if (!st.bombs.some(b => b.alive && b.cell === c) && !st.players.some(p => p.alive && p.cell === c)) st.monsters.add(c) }
          else st.monsters.delete(c)
        } })
        if (!res.ok) fail = true
      }
      tot++; if (fail) bad++
    }
    if (bad) bads.push(`${c}:${Math.round(100 * bad / tot)}%`)
  }
  console.log(`  ${NAMES(v, t).padEnd(22)} cases mortelles (taux) : ${bads.join(' ') || 'aucune'}`)
}
