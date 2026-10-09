// Classement des formations statiques 9/10 (toutes variantes sauf C/tour suivant) issues de statique.ts :
//  (b) soins bleus : pour A, B, D, E (tour suivant) × 24 ordres × 2 chaînes, tous les Crâs soignés avec un écart
//      maximal ≤ 5 manches (depuis la manche 1 jusqu'à la manche 30) ;
//  apparitions « au-delà » (règle inconnue) : nombre total sur toutes les variantes/ordres ;
//  PM : meilleure affectation depuis 4 cases rouges (hors 325/369), distance sans obstacle (max, total).
// Usage : npx tsx classe-statique.ts <fichiers...>
import { readFileSync, writeFileSync } from 'node:fs'
import { loadMap, PERMS4, VARIANTS } from './modele2'
import { initFast, fastSim, stats } from './fastsim'
import { CELL_COUNT } from '/home/user/DofusSimu/src/map/geometry'
import { bfsDistances } from '/home/user/DofusSimu/src/map/path'
const map = loadMap(); initFast(map)
const files = process.argv.slice(2)
const sets: { cells: number[]; same: number; next: number }[] = []
for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n')) {
  const m = line.match(/^(\d+),(\d+),(\d+),(\d+) (\d+) (\d+)$/)
  if (!m) continue
  const same = +m[5], next = +m[6]
  if (same === 31 && next === 27) sets.push({ cells: [+m[1], +m[2], +m[3], +m[4]], same, next })
}
console.error('ensembles 9/10 :', sets.length)
const RED = map.red.filter(c => c !== 325 && c !== 369)
const dist = new Map<number, Int16Array>()
for (const r of map.red) dist.set(r, bfsDistances(r, c => !!map.walk[c], 30))
function pmBest(T: number[]) {
  let best = { max: 99, tot: 99, S: [] as number[] }
  for (let i = 0; i < RED.length; i++) for (let j = i + 1; j < RED.length; j++) for (let k = j + 1; k < RED.length; k++) for (let l = k + 1; l < RED.length; l++) {
    const S = [RED[i], RED[j], RED[k], RED[l]]
    for (const p of PERMS4) {
      let mx = 0, tot = 0
      for (let x = 0; x < 4; x++) { const d = dist.get(S[p[x]])![T[x]]; if (d < 0) { mx = 99; break } mx = Math.max(mx, d); tot += d }
      if (mx < best.max || (mx === best.max && tot < best.tot)) best = { max: mx, tot, S: p.map(x => S[x]) }
    }
  }
  return best
}
const NEXTV = [0, 1, 3, 4]
const out: any[] = []
const ord = [0, 0, 0, 0]
for (const s of sets) {
  let healOk = 0, beyond = 0, healOkA = 0, healOkB = 0, healOkD = 0, healOkE = 0
  let worstGap = 0
  for (const v of NEXTV) for (const perm of PERMS4) for (const ch of [0, 1] as const) {
    for (let x = 0; x < 4; x++) ord[x] = s.cells[perm[x]]
    fastSim(ord, { variant: v, timing: 0, chain: ch, rounds: 30 })
    beyond += stats.beyond
    let g = 0
    for (let p = 0; p < 4; p++) g = Math.max(g, stats.maxGap[p])
    worstGap = Math.max(worstGap, g)
    if (g <= 5) { healOk++; if (v === 0) healOkA++; if (v === 1) healOkB++; if (v === 3) healOkD++; if (v === 4) healOkE++ }
  }
  for (const v of [0, 1, 2, 3, 4]) for (const perm of PERMS4) { for (let x = 0; x < 4; x++) ord[x] = s.cells[perm[x]]; fastSim(ord, { variant: v, timing: 1, chain: 0, rounds: 30 }); beyond += stats.beyond }
  const pm = pmBest(s.cells)
  out.push({ cells: s.cells, healOk, healOkA, healOkB, healOkD, healOkE, worstGap, beyond, pmMax: pm.max, pmTot: pm.tot, S: pm.S })
}
out.sort((a, b) => b.healOk - a.healOk || a.beyond - b.beyond || a.pmMax - b.pmMax || a.pmTot - b.pmTot)
writeFileSync('classe-statique.json', JSON.stringify(out))
console.log('ensembles 9/10 :', out.length)
console.log('répartition healOk (sur 192 = 4 variantes × 24 ordres × 2 chaînes) :')
const hist = new Map<number, number>()
for (const o of out) hist.set(o.healOk, (hist.get(o.healOk) ?? 0) + 1)
console.log([...hist.entries()].sort((a, b) => b[0] - a[0]).slice(0, 15).map(([k, v]) => `${k}:${v}`).join(' '))
console.log('sans apparition au-delà :', out.filter(o => o.beyond === 0).length, '; atteignables en ≤ 5 PM :', out.filter(o => o.pmMax <= 5).length)
for (const o of out.slice(0, 40)) console.log(`${o.cells.join(',')}  soins ${o.healOk}/192 (A ${o.healOkA} B ${o.healOkB} D ${o.healOkD} E ${o.healOkE}) écart max ${o.worstGap}  au-delà ${o.beyond}  PM max ${o.pmMax} tot ${o.pmTot} depuis ${o.S.join(',')}`)
