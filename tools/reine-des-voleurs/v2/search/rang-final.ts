// Classement final des plans détaillés : couverture (variantes 24/24 sans « au-delà »), soins (A/s, E/s : ordres où
// chaque Crâ est soigné avec un écart ≤ 5), LdV, PM.
import { readFileSync } from 'node:fs'
import { bfsDistances } from '../../../../src/map/path'
import { loadMap } from './modele2'
const map = loadMap()
const files = process.argv.slice(2)
const all: any[] = []
for (const f of files) all.push(...JSON.parse(readFileSync(f, 'utf8')))
const dist = new Map<number, Int16Array>()
for (const r of map.red) dist.set(r, bfsDistances(r, c => !!map.walk[c], 30))
for (const o of all) { const d = o.S.map((s: number, i: number) => dist.get(s)![o.T[i]]); o.pmMax = Math.max(...d); o.pmTot = d.reduce((a: number, b: number) => a + b, 0); o.nMove = d.filter((x: number) => x > 0).length }
const key = (o: any) => o.fullClean.join(' ')
const groups = new Map<string, any[]>()
for (const o of all) { const k = key(o); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(o) }
console.log('couvertures (variantes 24/24 sans au-delà) :', [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10).map(([k, v]) => `[${k}]×${v.length}`).join(' ; '))
const healScore = (o: any) => (o.per['A/s'].heal ?? 0) + (o.per['E/s'].heal ?? 0) + (o.per['B/s'].heal ?? 0) + (o.per['D/s'].heal ?? 0)
for (const want of process.env.WANT ? process.env.WANT.split('|') : [...groups.keys()].sort((a, b) => b.split(' ').length - a.split(' ').length).slice(0, 3)) {
  const g = (groups.get(want) ?? []).filter((o: any) => !o.risky)
  g.sort((a, b) => healScore(b) - healScore(a) || b.ldvZoneMin - a.ldvZoneMin || a.pmTot - b.pmTot)
  console.log(`\n== [${want}] : ${g.length} plans (sans 325/369)`)
  for (const o of g.slice(0, 15)) console.log(`  T ${o.T.join(',')} ← S ${o.S.join(',')} PM ${o.pmMax}/${o.pmTot} (${o.nMove} Crâs bougent) ; soins A/s ${o.per['A/s'].heal}/24 (écart ${o.per['A/s'].gap}) E/s ${o.per['E/s'].heal} (${o.per['E/s'].gap}) B/s ${o.per['B/s'].heal} D/s ${o.per['D/s'].heal} ; LdV min ${o.ldvZoneMin} somme ${o.ldvZone} bleues ${o.ldvBleues} ; partiel : ${Object.entries(o.per).filter(([n, x]: any) => x.ok < 24 && x.ok > 0).map(([n, x]: any) => n + ' ' + x.ok).join(', ')}`)
}
