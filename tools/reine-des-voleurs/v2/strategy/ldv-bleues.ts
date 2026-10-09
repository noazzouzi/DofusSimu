// Ligne de vue et distance des cases tenues (et sorties ≤ 2 PM) vers les 12 cases bleues (arrivée des monstres),
// Crâs et bombes (A/suivant début manche 3, puis manche 1 après les déplacements) comme obstacles.
import { readFileSync } from 'node:fs'
import { loadMap } from '../search/modele2'
import { CELL_COUNT, distance } from '../../../../src/map/geometry'
import { bfsDistances } from '../../../../src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '../../../../src/map/los'
const map = loadMap()
const opaque = opaqueCells((JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as any).cells)
const crâs = [311, 398, 392, 479]
const names: Record<number, string> = { 311: 'A', 398: 'B', 392: 'C', 479: 'D' }
const states: [string, number[]][] = [
  ['fin du tour 1, lecture N2 (bombes 337 409 350 423)', [337, 409, 350, 423]],
  ['fin du tour 1, lecture N4 (bombes 309 381 322 395)', [309, 381, 322, 395]],
  ['régime N2 (bombes 283 370 364 451)', [283, 370, 364, 451]],
  ['régime N4 (bombes 255 342 336 423)', [255, 342, 336, 423]],
]
for (const [label, bombs] of states) {
  console.log(`== ${label}`)
  const occ = new Set([...crâs, ...bombs])
  for (const p of crâs) {
    const from = [p]
    const d = bfsDistances(p, c => !!map.walk[c] && (!occ.has(c) || c === p), 2)
    const outs: string[] = []
    for (const c0 of [p, ...Array.from({ length: CELL_COUNT }, (_, i) => i).filter(c => d[c] > 0 && d[c] <= 2)]) {
      const vis = map.blue.filter(b => hasLineOfSightOnMap(opaque, c0, b, x => x !== c0 && x !== p && occ.has(x)))
      if (c0 === p || vis.length) outs.push(`${c0 === p ? 'case' : `${c0}(${d[c0]} PM)`}: ${vis.map(b => `${b}@${distance(c0, b)}`).join(' ') || '—'}`)
    }
    const best = outs.slice(0, 1).concat(outs.slice(1).sort((a, b) => b.split('@').length - a.split('@').length).slice(0, 3))
    console.log(`  ${names[p]} ${p} : ${best.join(' | ')}`)
  }
}
