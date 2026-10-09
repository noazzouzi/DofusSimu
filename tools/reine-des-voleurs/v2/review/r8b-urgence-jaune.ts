// Relecture (suite de r8) : même sauvetage quand le Crâ commence son tour sur sa case JAUNE (N4 + tour suivant,
// manches impaires ≥ 3) et doit finir sur sa case tenue. Budget : 5 PM en tout (aller + retour), Flèche de Recul.
import { readFileSync } from 'node:fs'
import { loadMap } from '../search/modele2'
import { CELL_X, CELL_Y, distance, pointToCell } from '../../../../src/map/geometry'
import { bfsDistances } from '../../../../src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '../../../../src/map/los'
const map = loadMap()
const mapJson = JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as { cells: { id: number; los: boolean }[] }
const opaque = opaqueCells(mapJson.cells as never)
const T0: Record<string, number> = { A: 311, B: 398, C: 392, D: 479 }, Y0: Record<string, number> = { A: 325, B: 412, C: 406, D: 493 }
const inLine10 = (a: number, b: number) => a !== b && (CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]) && distance(a, b) <= 10
for (const [lect, rep] of [['N4 lecture C (repli NE2)', 27], ['N4 lecture E (repli NE4)', 54]] as const) for (const who of ['A', 'B', 'C', 'D']) {
  const start = Y0[who], end = T0[who]
  const enemy = start - 56, bomb = start - rep
  const others = Object.keys(T0).filter(n => n !== who).map(n => Y0[n]) // les autres sont aussi sur leur case jaune
  const occ = new Set<number>([...others, enemy, bomb])
  const victims = [...others, start].filter(c => inLine10(bomb, c)).concat(inLine10(bomb, end) ? [end] : [])
  const dS = bfsDistances(start, c => !!map.walk[c] && !occ.has(c), 6)
  const sols: string[] = []
  for (let x = 0; x < 560; x++) {
    if (!map.walk[x] || (occ.has(x))) continue
    const d1 = x === start ? 0 : dS[x]
    if (d1 < 0) continue
    const dE = bfsDistances(x, c => !!map.walk[c] && !occ.has(c), 6)[end]
    if (dE < 0 || d1 + dE > 5) continue
    const dx = CELL_X[bomb] - CELL_X[x], dy = CELL_Y[bomb] - CELL_Y[x]
    if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) continue
    const r = distance(x, bomb)
    if (r < 1 || r > 10 || !hasLineOfSightOnMap(opaque, x, bomb, c => c !== x && c !== bomb && occ.has(c))) continue
    let cur = bomb, moved = 0
    for (let s = 0; s < 2; s++) { const n = pointToCell(CELL_X[cur] + Math.sign(dx), CELL_Y[cur] + Math.sign(dy)); if (n < 0 || !map.walk[n] || occ.has(n) || n === x) break; cur = n; moved++ }
    if (!moved) continue
    const finals = [...others, end]
    if (finals.every(c => !inLine10(cur, c))) sols.push(`depuis ${x} (${d1}+${dE} PM) → bombe en ${cur}`)
  }
  console.log(`${lect} : ${who} commence sur ${start}, ennemi sur ${enemy}, bombe en ${bomb} (en ligne avec ${victims.join(',') || 'personne'}) ; sauvetage : ${sols.slice(0, 3).join(' | ') || 'AUCUN'}`)
}
