// Repères : ancienne formation (README) et quelques formations « à la main » sous les 5 variantes × 2 moments.
import { loadMap, simulate, VARIANTS, PERMS4, xy } from './modele2'
import { initFast, fastSim, stats } from './fastsim'
import { pointToCell as P } from '/home/user/DofusSimu/src/map/geometry'
const map = loadMap()
initFast(map)
function evalStatic(name: string, cells: number[], moves?: number[]) {
  const row: string[] = []
  for (let v = 0; v < VARIANTS.length; v++) for (const t of [0, 1] as const) {
    let ok = 0
    for (const perm of PERMS4) {
      const ord = perm.map(i => cells[i])
      const mv = moves ? [Int16Array.from(perm.map(i => moves[i]))] : undefined
      let good = true
      for (const ch of [0, 1] as const) if (fastSim(ord, { variant: v, timing: t, chain: ch, rounds: 30, moves: mv })) { good = false; break }
      if (good) ok++
    }
    row.push(`${VARIANTS[v].id}/${t ? 'même' : 'suiv'}:${String(ok).padStart(2)}`)
  }
  console.log(name.padEnd(44), row.join(' '))
}
evalStatic('ancienne 354,381,380→408,451→435', [354, 381, 380, 451], [354, 381, 408, 435])
evalStatic('ancienne colonne statique 354,381,408,435', [354, 381, 408, 435])
// lignes horizontales écran (pas 2) sur différentes rangées
for (const row of [[350, 352, 354, 356], [352, 354, 356, 358], [378, 380, 382, 384], [379, 381, 383, 385], [406, 408, 410, 412], [364, 366, 368, 370], [392, 394, 396, 398], [336, 338, 340, 342]]) evalStatic('rangée ' + row.join(','), row)
const t0 = Date.now()
let n = 0
for (let i = 0; i < 200000; i++) { const s = [300 + (i % 50), 340 + ((i * 7) % 60), 380 + ((i * 13) % 40), 420 + ((i * 3) % 30)]; for (let v = 0; v < 5; v++) for (const t of [0, 1] as const) { fastSim(s, { variant: v, timing: t, chain: 0, rounds: 30 }); n++ } }
console.log('µs par simulation (avec arrêt à la 1re mort) :', ((Date.now() - t0) * 1000 / n).toFixed(2))
