// Règle « tournante » pour la lecture N4 + tour suivant (seule façon de survivre à C/suivant) : après la transition du
// tour 1 (S → T), à partir de la manche 2 chaque Crâ alterne entre T_i et Y_i = T_i + d_i (déplacement APRÈS
// l'apparition, chemin libre ≤ 5 PM). La bombe précédente est alors sur la case N4 de l'autre case : la case primaire
// est toujours libre et la case de repli (inconnue) ne sert pas. Évalue C/D/E (et A/B pour information) « tour suivant ».
// Usage : npx tsx rotation2.ts "S1,S2,S3,S4" "T1,T2,T3,T4" [individuel]
import { loadMap, PERMS4, VARIANTS, xy } from './modele2'
import { initFast, fastSim, stats } from './fastsim'
import { pointToCell, CELL_X, CELL_Y } from '../../../../src/map/geometry'
const map = loadMap(); initFast(map)
const S = process.argv[2].split(',').map(Number), T = process.argv[3].split(',').map(Number)
const indiv = process.argv[4] === 'individuel'
const D: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]
const DN = ['SE1', 'NO1', 'NE1', 'SO1', 'E2', 'O2', 'S2', 'N2', 'SE2', 'NO2', 'NE2', 'SO2']
const ROUNDS = 30
function evalV(Y: number[], v: number, t: 0 | 1, stopFirst = true): { ok: number; beyond: number; fb: number } {
  let ok = 0, beyond = 0, fb = 0
  for (const perm of PERMS4) {
    const So = perm.map(i => S[i]), To = perm.map(i => T[i]), Yo = perm.map(i => Y[i])
    const mv: Int16Array[] = []
    for (let r = 1; r <= ROUNDS; r++) mv.push(Int16Array.from(To.map((x, i) => (r === 1 ? x : r % 2 === 0 ? Yo[i] : x))))
    let good = true
    for (const ch of [0, 1] as const) { if (fastSim(So, { variant: v, timing: t, chain: ch, rounds: ROUNDS, moves: mv, maxPM: 5 })) { good = false; break } beyond += stats.beyond; fb += stats.fallback }
    if (good) ok++
    else if (stopFirst) break
  }
  return { ok, beyond, fb }
}
const rows: any[] = []
const combos: number[][] = []
if (indiv) { for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) for (let c = 0; c < 12; c++) for (let e = 0; e < 12; e++) combos.push([a, b, c, e]) }
else for (let k = 0; k < 12; k++) combos.push([k, k, k, k])
for (const ks of combos) {
  const Y = T.map((x, i) => pointToCell(CELL_X[x] + D[ks[i]][0], CELL_Y[x] + D[ks[i]][1]))
  if (Y.some(y => y < 0 || !map.walk[y]) || new Set([...T, ...Y]).size < 8) continue
  const c = evalV(Y, 2, 0)
  if (c.ok < 24) { if (!indiv) rows.push({ Y, ds: ks.map(k => DN[k]).join('/'), res: [c.ok] }); continue }
  const d = evalV(Y, 3, 0), e = evalV(Y, 4, 0), a = evalV(Y, 0, 0, false), b = evalV(Y, 1, 0, false)
  rows.push({ Y, ds: ks.map(k => DN[k]).join('/'), res: [c.ok, d.ok, e.ok, a.ok, b.ok], beyond: c.beyond + d.beyond + e.beyond, fb: c.fb + d.fb + e.fb, pm: ks.reduce((s, k) => s + (k < 4 ? 1 : 2), 0) })
}
rows.sort((x, y) => (y.res.slice(0, 3).filter((z: number) => z === 24).length - x.res.slice(0, 3).filter((z: number) => z === 24).length) || (x.pm ?? 99) - (y.pm ?? 99))
console.log(`plan ${S.join(',')} → ${T.join(',')} ; rotations testées ${rows.length} ; C/D/E/A/B tour suivant (ordres OK /24)`)
for (const r of rows.slice(0, 12)) console.log(`  Y ${r.Y.join(',')} d ${r.ds} : ${r.res.join(' ')}${r.pm !== undefined ? ` ; replis ${r.fb} au-delà ${r.beyond} ; PM/tour ${r.pm}` : ''}`)
