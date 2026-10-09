// Schémas écran (vue isométrique, une ligne sur deux décalée) des 3 formations.
// Légende : A B C D = cases de départ (rouges) ; 1 2 3 4 = cases tenues ; o = bombe « N2 » (case juste au-dessus) ;
// ' = case de repli NE2 ; ^ = bombe « N4 » ; ~ = case d'alternance (règle N4 + tour suivant) ; r/b = autres cases
// rouges/bleues ; # = pilier.
import { readFileSync } from 'node:fs'
import { CELL_X, CELL_Y, pointToCell } from '../../../../src/map/geometry'
const m = JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as { redCells: number[]; blueCells: number[]; cells: { walkable: boolean; los: boolean }[] }
const off = (c: number, dx: number, dy: number) => pointToCell(CELL_X[c] + dx, CELL_Y[c] + dy)
function draw(title: string, S: number[], T: number[], Y?: number[], rowFrom = 10, rowTo = 36) {
  const marks: Record<number, string> = {}
  for (const t of T) { marks[off(t, -1, 1)] = 'o'; marks[off(t, 0, 2)] = "'"; marks[off(t, -2, 2)] = '^' }
  if (Y) Y.forEach(y => (marks[y] = '~'))
  S.forEach((s, i) => (marks[s] = 'ABCD'[i]))
  T.forEach((t, i) => (marks[t] = String(i + 1)))
  console.log(title)
  for (let r = rowFrom; r <= rowTo; r++) {
    let s = (r % 2 ? '  ' : '') + String(r * 14).padStart(4) + '  '
    for (let c = 0; c < 14; c++) {
      const id = r * 14 + c
      const cell = m.cells[id]
      const k = marks[id] ?? (m.redCells.includes(id) ? 'r' : m.blueCells.includes(id) ? 'b' : !cell.los ? '#' : cell.walkable ? '.' : ' ')
      s += k + '   '
    }
    console.log(s.replace(/\s+$/, ''))
  }
  console.log('')
}
draw('F1 — départ A=365 B=437 C=378 D=451 → 1=297 2=370 3=392 4=464 ; ~ = alternance N4+tour suivant (312, 384, 406, 479)', [365, 437, 378, 451], [297, 370, 392, 464], [312, 384, 406, 479])
draw('F2 — départ A=340 B=367 C=365 D=437 → 1=270 2=381 3=392 4=425', [340, 367, 365, 437], [270, 381, 392, 425])
draw('F3 — départ A=365 B=437 C=378 D=451 → 1=311 2=398 3=392 4=479 ; ~ = alternance (325, 412, 406, 493)', [365, 437, 378, 451], [311, 398, 392, 479], [325, 412, 406, 493])
