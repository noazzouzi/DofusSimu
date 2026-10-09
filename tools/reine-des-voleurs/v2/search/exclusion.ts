// Vérifie : au moment « même tour », la 1re explosion du combat a lieu à la fin du tour 1 du premier Crâ, quand les 3
// autres sont encore sur leurs cases de départ. Pour chaque ensemble de 4 cases rouges, et chaque variante, ce départ
// est-il sûr quel que soit le Crâ qui joue en premier ? (indépendant des déplacements : le poseur n'est jamais en
// ligne avec sa propre bombe N2/N4 ; on vérifie aussi le cas où il aurait bougé n'importe où — non pris en compte ici)
import { loadMap, spawnList, VARIANTS } from './modele2'
import { CELL_X, CELL_Y } from '../../../../src/map/geometry'
const map = loadMap()
const R = map.red
const inLine = (a: number, b: number) => a !== b && ((CELL_X[a] === CELL_X[b] && Math.abs(CELL_Y[a] - CELL_Y[b]) <= 10) || (CELL_Y[a] === CELL_Y[b] && Math.abs(CELL_X[a] - CELL_X[b]) <= 10))
const combos = new Map<string, number>()
for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) for (let l = k + 1; l < 12; l++) {
  const S = [R[i], R[j], R[k], R[l]]
  const okV = VARIANTS.map((_, v) => S.every(p => { const s = spawnList(map, v, p).cells.find(c => !S.includes(c))!; return !S.some(q => q !== p && inLine(q, s)) }))
  const key = VARIANTS.filter((_, v) => okV[v]).map(x => x.id).join('') || '-'
  combos.set(key, (combos.get(key) ?? 0) + 1)
}
console.log('variantes sûres à la 1re explosion « même tour » (premier Crâ quelconque, autres sur leur case rouge) :')
for (const [k, n] of [...combos.entries()].sort((a, b) => b[1] - a[1])) console.log(`  {${k}} : ${n} ensembles`)
