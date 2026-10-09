// Rotation (règle N4 + tour suivant) sur un lot de plans du groupe [A/s A/m B/s B/m] (et du groupe 7) : d commun puis
// d individuel limité aux déplacements d'1 PM. Garde les plans où C/s, D/s, E/s passent 24/24.
import { readFileSync, writeFileSync } from 'node:fs'
import { loadMap, PERMS4 } from './modele2'
import { initFast, fastSim, stats } from './fastsim'
import { pointToCell, CELL_X, CELL_Y } from '../../../../src/map/geometry'
const map = loadMap(); initFast(map)
const [want, shs, nss] = process.argv.slice(2)
const shard = +shs, nsh = +nss
const all: any[] = []
for (const f of ['detail-plans.json', 'detail-n2-0.json', 'detail-n2-1.json', 'detail-n2-2.json', 'detail-n2-3.json']) all.push(...JSON.parse(readFileSync(f, 'utf8')))
const seen = new Set<string>()
const plans = all.filter(o => o.fullClean.join(' ') === want && !o.risky && !seen.has(o.T + '|' + o.S) && seen.add(o.T + '|' + o.S)).filter((_, i) => i % nsh === shard)
const D: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]
const DN = ['SE1', 'NO1', 'NE1', 'SO1', 'E2', 'O2', 'S2', 'N2', 'SE2', 'NO2', 'NE2', 'SO2']
function evalV(S: number[], T: number[], Y: number[], v: number): number {
  let ok = 0
  for (const perm of PERMS4) {
    const So = perm.map(i => S[i]), To = perm.map(i => T[i]), Yo = perm.map(i => Y[i])
    const mv: Int16Array[] = []
    for (let r = 1; r <= 30; r++) mv.push(Int16Array.from(To.map((x, i) => (r === 1 ? x : r % 2 === 0 ? Yo[i] : x))))
    for (const ch of [0, 1] as const) if (fastSim(So, { variant: v, timing: 0, chain: ch, rounds: 30, moves: mv, maxPM: 5 }) || stats.beyond) return ok
    ok++
  }
  return ok
}
const out: any[] = []
for (const p of plans) {
  const found: string[] = []
  const tryKs = (ks: number[]) => {
    const Y = p.T.map((x: number, i: number) => pointToCell(CELL_X[x] + D[ks[i]][0], CELL_Y[x] + D[ks[i]][1]))
    if (Y.some((y: number) => y < 0 || !map.walk[y]) || new Set([...p.T, ...Y]).size < 8) return
    if (evalV(p.S, p.T, Y, 2) < 24 || evalV(p.S, p.T, Y, 3) < 24 || evalV(p.S, p.T, Y, 4) < 24) return
    found.push(`${Y.join(',')}:${ks.map(k => DN[k]).join('/')}:${ks.reduce((s, k) => s + (k < 4 ? 1 : 2), 0)}`)
  }
  for (let k = 0; k < 12; k++) tryKs([k, k, k, k])
  if (!found.length) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) for (let e = 0; e < 4; e++) { if (found.length >= 3) break; tryKs([a, b, c, e]) }
  if (found.length) out.push({ ...p, rot: found })
}
writeFileSync(`rot-${want.replace(/[ /]/g, '')}-${shard}.json`, JSON.stringify(out))
console.log(`shard ${shard} : ${plans.length} plans, ${out.length} avec rotation C/D/E`)
