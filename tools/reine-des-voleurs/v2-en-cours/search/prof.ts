import { loadMap, spawnList, VARIANTS, PERMS4 } from './modele2'
import { initFast, fastSim } from './fastsim'
import { CELL_X, CELL_Y, CELL_COUNT } from '/home/user/DofusSimu/src/map/geometry'
import { bfsDistances } from '/home/user/DofusSimu/src/map/path'
const map = loadMap(); initFast(map)
const dRed = new Int16Array(CELL_COUNT).fill(99)
for (const r of map.red) { const d = bfsDistances(r, c => !!map.walk[c], 20); for (let c = 0; c < CELL_COUNT; c++) if (d[c] >= 0) dRed[c] = Math.min(dRed[c], d[c]) }
const R: number[] = []; for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && dRed[c] <= 5) R.push(c)
const inLine = (a: number, b: number) => a !== b && ((CELL_X[a] === CELL_X[b] && Math.abs(CELL_Y[a] - CELL_Y[b]) <= 10) || (CELL_Y[a] === CELL_Y[b] && Math.abs(CELL_X[a] - CELL_X[b]) <= 10))
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
let same = [0,0,0,0,0], N = 20000, simCount = 0, nextPass=[0,0,0,0,0], firstFailIdx: number[] = []
const t0 = Date.now()
for (let it = 0; it < N; it++) {
  const set: number[] = []; while (set.length < 4) { const c = R[Math.floor(rnd() * R.length)]; if (!set.includes(c)) set.push(c) }
  for (let v = 0; v < 5; v++) {
    let ok = true
    for (const p of set) { const s = spawnList(map, v, p).cells.find(c => !set.includes(c))!; if (set.some(q => q !== p && inLine(q, s))) ok = false }
    if (!ok) continue
    same[v]++
    let k = 0, good = true
    for (const perm of PERMS4) { k++; const o = perm.map(i => set[i]); simCount += 1; if (fastSim(o, { variant: v, timing: 0, chain: 0, rounds: 30 })) { good = false; break } simCount++; if (fastSim(o, { variant: v, timing: 0, chain: 1, rounds: 30 })) { good = false; break } }
    if (good) nextPass[v]++; else firstFailIdx.push(k)
  }
}
const dt = Date.now() - t0
console.log({ N, same, nextPass, simCount, msTotal: dt, usPerSim: (dt * 1000 / simCount).toFixed(1), avgOrdersBeforeFail: (firstFailIdx.reduce((a, b) => a + b, 0) / firstFailIdx.length).toFixed(2) })
console.log('C(130,4)=', 130*129*128*127/24)
