// Ordres de jeu qui passent pour un plan (S→T) et une variante donnée (30 manches, dfs et bfs).
import { loadMap, PERMS4, VARIANTS } from './modele2'
import { initFast, fastSim } from './fastsim'
const map = loadMap(); initFast(map)
const S = process.argv[2].split(',').map(Number), T = process.argv[3].split(',').map(Number)
for (const [v, t] of [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]] as [number, 0 | 1][]) {
  const ok: string[] = []
  for (const perm of PERMS4) {
    const So = perm.map(i => S[i]), To = Int16Array.from(perm.map(i => T[i]))
    let g = true
    for (const ch of [0, 1] as const) if (fastSim(So, { variant: v, timing: t, chain: ch, rounds: 30, moves: [To], maxPM: 5 })) g = false
    if (g) ok.push(So.join('→'))
  }
  console.log(`${VARIANTS[v].id}/${t ? 'même' : 'suivant'} : ${ok.length}/24 ${ok.length < 24 ? ok.join('  ') : ''}`)
}
