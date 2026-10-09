// Cases bleues visibles par au moins un Crâ, depuis sa case ou n'importe quelle sortie ≤ 2 PM (4 états de bombes).
import { readFileSync } from 'node:fs'
import { loadMap } from '../search/modele2'
import { CELL_COUNT } from '../../../../src/map/geometry'
import { bfsDistances } from '../../../../src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '../../../../src/map/los'
const map = loadMap()
const opaque = opaqueCells((JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as any).cells)
for (const [label, crâs, bombs] of [
  ['N2 régime', [311, 398, 392, 479], [283, 370, 364, 451]],
  ['N2 fin tour 1', [311, 398, 392, 479], [337, 409, 350, 423]],
  ['N4 régime (cases tenues)', [311, 398, 392, 479], [255, 342, 336, 423]],
  ['N4 régime (cases jaunes)', [325, 412, 406, 493], [269, 356, 350, 437]],
] as [string, number[], number[]][]) {
  const occ = new Set([...crâs, ...bombs])
  const fromCell = new Set<number>(), fromOut = new Set<number>()
  for (const p of crâs) {
    const d = bfsDistances(p, c => !!map.walk[c] && (!occ.has(c) || c === p), 2)
    for (let c = 0; c < CELL_COUNT; c++) {
      if (!(c === p || (d[c] > 0 && d[c] <= 2))) continue
      for (const b of map.blue) if (hasLineOfSightOnMap(opaque, c, b, x => x !== c && x !== p && occ.has(x))) (c === p ? fromCell : fromOut).add(b)
    }
  }
  const all = new Set([...fromCell, ...fromOut])
  console.log(`${label}: depuis les cases ${[...fromCell].sort((a, b) => a - b).join(' ')} ; avec sorties ≤ 2 PM ${[...all].sort((a, b) => a - b).join(' ')} ; jamais vues : ${map.blue.filter(b => !all.has(b)).join(' ') || 'aucune'}`)
}
