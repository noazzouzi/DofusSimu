// Schémas écran (vue isométrique comme en jeu) du placement proposé et de la formation, pour modele-combat.md.
import { readFileSync } from 'node:fs'
const m = JSON.parse(readFileSync('/home/user/DofusSimu/data/maps/137101312.json', 'utf8')) as { redCells: number[]; blueCells: number[]; cells: { walkable: boolean; los: boolean }[] }
function draw(title: string, marks: Record<number, string>, rowFrom = 9, rowTo = 34) {
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
// Placement de départ : Crâs A (354) B (381) C (380) D (451) ; monstres V1 sur les cases bleues par défaut du simulateur.
draw('PLACEMENT (début de combat) — A,B,C,D = Crâs ; Q Reine, M Mâchassin, T Terristocrate, D2 → « U » Doublure ; r/b = autres cases rouges/bleues ; # pilier', {
  354: 'A', 381: 'B', 380: 'C', 451: 'D', 159: 'Q', 160: 'M', 161: 'T', 162: 'U',
})
// Formation tenue à partir de la fin de la manche 1.
draw('FORMATION (à partir de la manche 2) — 1..4 = Crâs ; o = case de bombe rouge (E de chaque Crâ) ; + = bombe bleue tournante ; ! = case d\'intervalle', {
  354: '1', 381: '2', 408: '3', 435: '4', 355: 'o', 382: 'o', 409: 'o', 436: 'o', 383: '+', 410: '+', 437: '+', 464: '+', 368: '!', 395: '!', 422: '!',
}, 17, 34)
