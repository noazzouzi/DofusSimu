// Classement des formations statiques 9/10 (toutes variantes sauf C/tour suivant) issues de statique.ts.
// Passe 1 (tous les ensembles, partagée en shards) : sous-échantillon 4 variantes « tour suivant » (A, B, D, E) ×
//   6 ordres × chaîne dfs : nb de cas où chaque Crâ est soigné par une bombe bleue avec un écart ≤ 5 manches ; nb
//   d'apparitions au-delà du repli ; PM depuis les cases rouges.
// Passe 2 (classe-statique2.ts) : calcul complet sur les meilleurs.
// Usage : npx tsx classe-statique.ts <shard> <nshards> <fichiers...>
import { readFileSync, writeFileSync } from 'node:fs'
import { loadMap, PERMS4 } from './modele2'
import { initFast, fastSim, stats } from './fastsim'
import { bfsDistances } from '../../../../src/map/path'
const [shs, nss, ...files] = process.argv.slice(2)
const shard = +shs, nsh = +nss
const map = loadMap(); initFast(map)
const sets: number[][] = []
let seen = 0
for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n')) {
  const m = line.match(/^(\d+),(\d+),(\d+),(\d+) (\d+) (\d+)$/)
  if (!m) continue
  if (+m[5] === 31 && +m[6] === 27) { if (seen++ % nsh === shard) sets.push([+m[1], +m[2], +m[3], +m[4]]) }
}
const RED = map.red
const dist = new Map<number, Int16Array>()
for (const r of RED) dist.set(r, bfsDistances(r, c => !!map.walk[c], 30))
function pmBest(T: number[], excl: number[]) {
  const R = RED.filter(c => !excl.includes(c))
  let best = { max: 99, tot: 99, S: [] as number[] }
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) for (let k = j + 1; k < R.length; k++) for (let l = k + 1; l < R.length; l++) {
    const S = [R[i], R[j], R[k], R[l]]
    for (const p of PERMS4) {
      let mx = 0, tot = 0
      for (let x = 0; x < 4; x++) { const d = dist.get(S[p[x]])![T[x]]; if (d < 0) { mx = 99; break } mx = Math.max(mx, d); tot += d }
      if (mx < best.max || (mx === best.max && tot < best.tot)) best = { max: mx, tot, S: p.map(x => S[x]) }
    }
  }
  return best
}
const SUB = [0, 5, 10, 14, 19, 23].map(i => PERMS4[i])
const out: any[] = []
const ord = [0, 0, 0, 0]
for (const T of sets) {
  let heal = 0, beyond = 0
  const hv = [0, 0, 0, 0]
  ;[0, 1, 3, 4].forEach((v, vi) => {
    for (const perm of SUB) {
      for (let x = 0; x < 4; x++) ord[x] = T[perm[x]]
      fastSim(ord, { variant: v, timing: 0, chain: 0, rounds: 30 })
      beyond += stats.beyond
      let g = 0
      for (let p = 0; p < 4; p++) g = Math.max(g, stats.maxGap[p])
      if (g <= 5) { heal++; hv[vi]++ }
    }
  })
  const pm = pmBest(T, [325, 369])
  out.push({ cells: T, heal, hv, beyond, pmMax: pm.max, pmTot: pm.tot, S: pm.S })
}
writeFileSync(`classe1-${shard}.json`, JSON.stringify(out))
console.log(`shard ${shard} : ${out.length} ensembles`)
