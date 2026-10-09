// Carte 137101312 : cases (id) par ligne écran, avec marquage, et région atteignable depuis les cases rouges.
import { readFileSync } from 'node:fs'
import { CELL_X, CELL_Y, CELL_COUNT } from '/home/user/DofusSimu/src/map/geometry'
import { bfsDistances } from '/home/user/DofusSimu/src/map/path'
const m = JSON.parse(readFileSync('/home/user/DofusSimu/data/maps/137101312.json', 'utf8')) as { redCells: number[]; blueCells: number[]; cells: { id: number; walkable: boolean; los: boolean }[] }
const walk = (c: number) => m.cells[c].walkable
let minR = 99, maxR = 0
for (let c = 0; c < CELL_COUNT; c++) if (walk(c)) { const r = Math.floor(c / 14); minR = Math.min(minR, r); maxR = Math.max(maxR, r) }
const dRed = new Int16Array(CELL_COUNT).fill(99)
for (const r of m.redCells) { const d = bfsDistances(r, walk, 20); for (let c = 0; c < CELL_COUNT; c++) if (d[c] >= 0) dRed[c] = Math.min(dRed[c], d[c]) }
console.log('rows', minR, maxR)
for (let r = minR; r <= maxR; r++) {
  let s = (r % 2 ? '   ' : '') + String(r).padStart(3) + ' '
  for (let c = 0; c < 14; c++) {
    const id = r * 14 + c
    const k = m.redCells.includes(id) ? `R${id}` : m.blueCells.includes(id) ? `B${id}` : !m.cells[id].los ? '####' : walk(id) ? String(id) : '    '
    s += k.padStart(4) + '  '
  }
  console.log(s)
}
let n5 = 0, n10 = 0
for (let c = 0; c < CELL_COUNT; c++) { if (dRed[c] <= 5) n5++; if (dRed[c] <= 10) n10++ }
console.log('cases à ≤5 PM d\'une case rouge', n5, '; ≤10 PM', n10, '; praticables', m.cells.filter(c => c.walkable).length)
console.log('pilier rouge', [313, 326, 327, 341].map(c => `${c}(${CELL_X[c]},${CELL_Y[c]})`).join(' '))
console.log('rouges', m.redCells.map(c => `${c}(${CELL_X[c]},${CELL_Y[c]})`).join(' '))
console.log('bleues', m.blueCells.map(c => `${c}(${CELL_X[c]},${CELL_Y[c]})`).join(' '))
