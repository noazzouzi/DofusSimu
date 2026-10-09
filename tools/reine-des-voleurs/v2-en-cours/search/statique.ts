// Recherche EXHAUSTIVE des formations statiques (4 cases, personne ne bouge) dans la région atteignable en ≤ RMAX PM
// depuis les cases rouges. Pour chaque variante d'apparition v (A..E) :
//  - « même tour » : survie ⟺ pour chaque Crâ p, sa bombe (1re case libre, seuls les Crâs occupant des cases) n'est
//    en ligne (≤ 10) avec aucun autre Crâ — exact, indépendant de l'ordre (une seule bombe en jeu à la fois) ;
//  - « tour suivant » : ce même critère est NÉCESSAIRE (quand p joue en premier, sa 1re bombe est la 1re explosion du
//    combat, donc rouge) ; on simule ensuite les 24 ordres × 2 modes de chaîne × 30 manches (arrêt au 1er échec).
// Usage : npx tsx statique.ts <shard> <nshards> <RMAX> > sortie
import { loadMap, spawnList, VARIANTS, PERMS4 } from './modele2'
import { initFast, fastSim } from './fastsim'
import { CELL_X, CELL_Y, CELL_COUNT } from '/home/user/DofusSimu/src/map/geometry'
import { bfsDistances } from '/home/user/DofusSimu/src/map/path'
const [shard, nshards, RMAX] = process.argv.slice(2).map(Number)
const map = loadMap()
initFast(map)
const NV = VARIANTS.length
const dRed = new Int16Array(CELL_COUNT).fill(99)
for (const r of map.red) { const d = bfsDistances(r, c => !!map.walk[c], 20); for (let c = 0; c < CELL_COUNT; c++) if (d[c] >= 0) dRed[c] = Math.min(dRed[c], d[c]) }
const R: number[] = []
for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && dRed[c] <= RMAX) R.push(c)
const n = R.length
const idx = new Int16Array(CELL_COUNT).fill(-1)
R.forEach((c, i) => (idx[c] = i))
const line = new Uint8Array(CELL_COUNT * CELL_COUNT)
for (const a of R) for (let b = 0; b < CELL_COUNT; b++) {
  if (a === b) continue
  const dx = CELL_X[a] - CELL_X[b], dy = CELL_Y[a] - CELL_Y[b]
  if ((dx === 0 && Math.abs(dy) <= 10) || (dy === 0 && Math.abs(dx) <= 10)) line[a * CELL_COUNT + b] = 1
}
// 6 premiers candidats par (v, case)
const K = 6
const cand = new Int16Array(NV * CELL_COUNT * K).fill(-1)
for (let v = 0; v < NV; v++) for (const c of R) { const s = spawnList(map, v, c); for (let k = 0; k < K && k < s.cells.length; k++) cand[(v * CELL_COUNT + c) * K + k] = s.cells[k] }
function spawnCell(v: number, p: number, set: number[]): number {
  const base = (v * CELL_COUNT + p) * K
  for (let k = 0; k < K; k++) { const c = cand[base + k]; if (c < 0) return -1; if (c !== set[0] && c !== set[1] && c !== set[2] && c !== set[3]) return c }
  return -1
}
const counts = { sets: 0, same: new Array(NV).fill(0), next: new Array(NV).fill(0), any: 0 }
const set = [0, 0, 0, 0]
const ord = [0, 0, 0, 0]
const out: string[] = []
const t0 = Date.now()
for (let i = shard; i < n; i += nshards) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) {
  set[0] = R[i]; set[1] = R[j]; set[2] = R[k]; set[3] = R[l]
  counts.sets++
  let sameMask = 0
  for (let v = 0; v < NV; v++) {
    let ok = true
    for (let p = 0; p < 4 && ok; p++) {
      const s = spawnCell(v, set[p], set)
      if (s < 0) { ok = false; break }
      for (let q = 0; q < 4; q++) if (q !== p && line[set[q] * CELL_COUNT + s]) { ok = false; break }
    }
    if (ok) { sameMask |= 1 << v; counts.same[v]++ }
  }
  if (!sameMask) continue
  let nextMask = 0
  for (let v = 0; v < NV; v++) {
    if (!(sameMask & (1 << v))) continue
    let ok = true
    for (const perm of PERMS4) {
      for (let x = 0; x < 4; x++) ord[x] = set[perm[x]]
      if (fastSim(ord, { variant: v, timing: 0, chain: 0, rounds: 30 }) || fastSim(ord, { variant: v, timing: 0, chain: 1, rounds: 30 })) { ok = false; break }
    }
    if (ok) { nextMask |= 1 << v; counts.next[v]++ }
  }
  counts.any++
  const pc = (x: number) => (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1) + ((x >> 4) & 1)
  if (pc(sameMask) + pc(nextMask) >= 7) out.push(`${set.join(',')} ${sameMask} ${nextMask}`)
}
process.stderr.write(`shard ${shard} : ${counts.sets} ensembles, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`)
console.log(JSON.stringify({ shard, n, counts }))
for (const s of out) console.log(s)
