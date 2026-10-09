// Ligne de vue (cases bleues et zone d'arrivée) des formations du classement 1 : Crâs = obstacles, piliers opaques.
// Ajoute à chaque ensemble : bleues vues (somme sur les 4 Crâs), zone vue (somme, et min par Crâ), puis sélection.
import { readFileSync, writeFileSync } from 'node:fs'
import { loadMap } from './modele2'
import { CELL_COUNT, CELL_Y, distance } from '../../../../src/map/geometry'
import { hasLineOfSightOnMap, opaqueCells } from '../../../../src/map/los'
const map = loadMap()
const mapJson = JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as { cells: { id: number; los: boolean }[] }
const opaque = opaqueCells(mapJson.cells as never)
const zone: number[] = []
for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && CELL_Y[c] >= -6 && CELL_Y[c] <= 3) zone.push(c)
const all = JSON.parse(readFileSync('classe1.json', 'utf8')) as any[]
for (const o of all) {
  const T: number[] = o.cells
  let blue = 0, zs = 0, zmin = 999
  for (const p of T) {
    const blk = (x: number) => x !== p && T.includes(x)
    const b = map.blue.filter(c => hasLineOfSightOnMap(opaque, p, c, blk)).length
    const z = zone.filter(c => !T.includes(c) && distance(p, c) <= 12 && hasLineOfSightOnMap(opaque, p, c, blk)).length
    blue += b; zs += z; zmin = Math.min(zmin, z)
  }
  Object.assign(o, { ldvBleues: blue, ldvZone: zs, ldvZoneMin: zmin })
}
writeFileSync('classe1-ldv.json', JSON.stringify(all))
const sel = all.filter(o => o.heal === 12 && o.beyond === 0 && o.pmMax <= 5)
console.log('heal 12, sans au-delà, PM ≤ 5 :', sel.length)
sel.sort((a, b) => b.ldvZoneMin - a.ldvZoneMin || b.ldvZone - a.ldvZone || a.pmTot - b.pmTot)
for (const o of sel.slice(0, 15)) console.log(`${o.cells.join(',')} zone min ${o.ldvZoneMin} somme ${o.ldvZone} bleues ${o.ldvBleues}/48 PM ${o.pmMax}/${o.pmTot}`)
const byPm = [...sel].sort((a, b) => a.pmTot - b.pmTot || b.ldvZoneMin - a.ldvZoneMin)
console.log('-- par PM')
for (const o of byPm.slice(0, 10)) console.log(`${o.cells.join(',')} zone min ${o.ldvZoneMin} somme ${o.ldvZone} bleues ${o.ldvBleues}/48 PM ${o.pmMax}/${o.pmTot}`)
// sélection pour les transitions : 300 meilleurs en LdV + 150 meilleurs en PM (sans doublon)
const pick = new Map<string, any>()
for (const o of sel.slice(0, 300)) pick.set(o.cells.join(','), o)
for (const o of byPm.slice(0, 150)) pick.set(o.cells.join(','), o)
// et l'ensemble « TT-- » (soins A et B)
for (const o of all.filter(o => o.hv[1] > 0)) pick.set(o.cells.join(','), o)
writeFileSync('selection-transition.json', JSON.stringify([...pick.values()]))
console.log('sélection pour transitions :', pick.size)
console.log('ensembles avec soins en B ou D :', all.filter(o => o.hv[1] > 0 || o.hv[2] > 0).map(o => `${o.cells.join(',')} [${o.hv.join(' ')}] PM ${o.pmMax}`).join(' ; '))
