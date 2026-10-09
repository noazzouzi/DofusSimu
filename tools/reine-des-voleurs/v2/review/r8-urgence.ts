// Relecture : lecture « même tour ». Un ennemi a pris la case habituelle de la bombe ; elle apparaît en repli, EN LIGNE
// avec son poseur et un 2e Crâ, et explose à la fin du tour. Le poseur peut-il la sortir de la ligne avec Flèche de
// Recul (repousse de 2 cases dans l'axe tireur→bombe, PO 1-10 avec 4 PO, LdV), en sortant d'au plus 2 PM et en rentrant ?
import { readFileSync } from 'node:fs'
import { loadMap } from '../search/modele2'
import { CELL_X, CELL_Y, distance, pointToCell } from '../../../../src/map/geometry'
import { bfsDistances } from '../../../../src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '../../../../src/map/los'
const map = loadMap()
const mapJson = JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as { cells: { id: number; los: boolean }[] }
const opaque = opaqueCells(mapJson.cells as never)
const HELD: Record<string, number> = { A: 311, B: 398, C: 392, D: 479 }
const inLine10 = (a: number, b: number) => a !== b && (CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]) && distance(a, b) <= 10
// cas : [poseur, case habituelle prise, case de repli] pour les lectures N2/A (NE2), N4/C (NE2), N4/E (NE4)
const CASES: [string, string, number, number][] = [
  ['N2 lecture A', 'A', 283, 284], ['N2 lecture A', 'B', 370, 371], ['N2 lecture A', 'C', 364, 365], ['N2 lecture A', 'D', 451, 452],
  ['N4 lecture C', 'A', 255, 284], ['N4 lecture C', 'B', 342, 371], ['N4 lecture C', 'C', 336, 365], ['N4 lecture C', 'D', 423, 452],
  ['N4 lecture E', 'A', 255, 257], ['N4 lecture E', 'B', 342, 344], ['N4 lecture E', 'C', 336, 338], ['N4 lecture E', 'D', 423, 425],
]
for (const [lect, who, enemy, bomb] of CASES) {
  const held = HELD[who]
  const others = Object.values(HELD).filter(c => c !== held)
  const victims = Object.entries(HELD).filter(([, c]) => inLine10(bomb, c)).map(([n]) => n)
  const occ = new Set<number>([...others, enemy, bomb])
  const dist = bfsDistances(held, c => !!map.walk[c] && !occ.has(c), 3)
  const sols: string[] = []
  for (let x = 0; x < 560; x++) {
    const d = x === held ? 0 : dist[x]
    if (d < 0 || d > 2 || (x !== held && occ.has(x))) continue
    const dx = CELL_X[bomb] - CELL_X[x], dy = CELL_Y[bomb] - CELL_Y[x]
    const aligned = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)
    if (!aligned) continue
    const r = distance(x, bomb)
    if (r < 1 || r > 10) continue
    if (!hasLineOfSightOnMap(opaque, x, bomb, c => c !== x && c !== bomb && (occ.has(c) || c === held))) continue
    const sx = Math.sign(dx), sy = Math.sign(dy)
    let cur = bomb, moved = 0
    for (let s = 0; s < 2; s++) { const n = pointToCell(CELL_X[cur] + sx, CELL_Y[cur] + sy); if (n < 0 || !map.walk[n] || occ.has(n) || n === held) break; cur = n; moved++ }
    if (moved === 0) continue
    const after = Object.values(HELD).filter(c => inLine10(cur, c))
    if (after.length === 0) sols.push(`depuis ${x}${x === held ? ' (sa case)' : ` (${d} PM)`} → bombe en ${cur}`)
  }
  console.log(`${lect} : ennemi sur ${enemy} au tour de ${who} → bombe en ${bomb}, en ligne avec ${victims.join('+')} ; sauvetage par Flèche de Recul : ${sols.slice(0, 4).join(' | ') || 'AUCUN'}`)
}
