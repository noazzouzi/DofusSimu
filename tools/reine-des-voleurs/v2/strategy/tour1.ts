// Tour 1 : pour chaque case bleue (départ possible de la Reine), PM nécessaires pour lancer Mort en Sursis sur
// chaque Crâ à sa case de formation (bombes de la manche 1 en place, lecture N2 puis N4), et distance / ligne de vue
// de ce Crâ vers la case bleue (Représailles 3-10, ou 6-16 sous Tirs Éloignés).
import { readFileSync } from 'node:fs'
import { loadMap } from '../search/modele2'
import { CELL_COUNT, CELL_X, CELL_Y, distance } from '../../../../src/map/geometry'
import { bfsDistances } from '../../../../src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '../../../../src/map/los'
const map = loadMap()
const opaque = opaqueCells((JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as any).cells)
const inLine = (a: number, b: number) => CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]
for (const [label, bombs] of [['N2', [337, 409, 350, 423]], ['N4', [309, 381, 322, 395]]] as [string, number[]][]) {
  const crâs = [311, 398, 392, 479]
  const occ = new Set([...crâs, ...bombs])
  console.log(`== lecture ${label}, fin du tour 1 (Crâs 311/398/392/479, bombes ${bombs.join(' ')})`)
  for (const b of map.blue) {
    const d = bfsDistances(b, c => !!map.walk[c] && !occ.has(c), 60)
    const parts: string[] = []
    for (const p of crâs) {
      let m = 99
      for (let c = 0; c < CELL_COUNT; c++) {
        if (!map.walk[c] || occ.has(c) || !inLine(c, p)) continue
        const dd = distance(c, p)
        if (dd < 1 || dd > 5) continue
        if (!hasLineOfSightOnMap(opaque, c, p, x => x !== c && x !== p && occ.has(x))) continue
        if (d[c] >= 0) m = Math.min(m, d[c])
      }
      const los = hasLineOfSightOnMap(opaque, p, b, x => x !== p && x !== b && occ.has(x))
      parts.push(`${p}: MeS ${m} PM${m <= 6 ? ' ⚠' : ''}, vue ${los ? 'oui' : 'non'} à ${distance(p, b)}`)
    }
    console.log(`  Reine en ${b} → ${parts.join(' | ')}`)
  }
}
