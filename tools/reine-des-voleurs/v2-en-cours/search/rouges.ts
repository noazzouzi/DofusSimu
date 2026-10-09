import { loadMap, spawnList, VARIANTS, xy } from './modele2'
const map = loadMap()
for (const r of map.red) console.log(xy(r).padEnd(14), VARIANTS.map((v, i) => { const s = spawnList(map, i, r); return `${v.id}: ${s.cells[0]}${['', "'", '*'][s.rank[0]]} puis ${s.cells[1]}${['', "'", '*'][s.rank[1]]}` }).join(' | '))
console.log("(' = case de repli, * = au-delà du repli)")
