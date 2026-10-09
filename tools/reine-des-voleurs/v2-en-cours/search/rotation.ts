// Formations « tournantes » (période 2) : chaque Crâ alterne entre sa case X et Y = X + d à chaque tour (déplacement
// APRÈS l'apparition de sa bombe ; chemin libre requis). Idée : la bombe précédente est sur la case « N » de l'AUTRE
// case, donc la case primaire est toujours libre : la case de repli (inconnue) ne sert jamais.
// Évalue, pour des ensembles X (classement statique) et un vecteur d commun ou propre à chaque Crâ :
//  les 10 variantes × 24 ordres × 2 chaînes × 30 manches, Crâs posés sur X au départ (manche 1 : X → Y).
// Usage : npx tsx rotation.ts <json> <K> <mode: commun|individuel>
import { readFileSync } from 'node:fs'
import { loadMap, PERMS4, VARIANTS, xy } from './modele2'
import { initFast, fastSim, stats } from './fastsim'
import { pointToCell, CELL_X, CELL_Y } from '/home/user/DofusSimu/src/map/geometry'
const [file, Ks, mode] = process.argv.slice(2)
const map = loadMap(); initFast(map)
const cand = (JSON.parse(readFileSync(file, 'utf8')) as { cells: number[] }[]).slice(0, +Ks)
const D: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]
const DN = ['SE1', 'NO1', 'NE1', 'SO1', 'E2', 'O2', 'S2', 'N2', 'SE2', 'NO2', 'NE2', 'SO2']
const ROUNDS = 30
function sched(X: number[], Y: number[]): Int16Array[] {
  const m: Int16Array[] = []
  for (let r = 1; r <= ROUNDS; r++) m.push(Int16Array.from(X.map((x, i) => (r % 2 ? Y[i] : x))))
  return m
}
function evalAll(X: number[], Y: number[]) {
  const res: number[] = []
  const ord = [0, 0, 0, 0]
  for (let v = 0; v < VARIANTS.length; v++) for (const t of [0, 1] as const) {
    let ok = 0
    for (const perm of PERMS4) {
      const Xo = perm.map(i => X[i]), Yo = perm.map(i => Y[i])
      const mv = sched(Xo, Yo)
      let good = true
      for (const ch of [0, 1] as const) if (fastSim(Xo, { variant: v, timing: t, chain: ch, rounds: ROUNDS, moves: mv, maxPM: 5 })) { good = false; break }
      if (good) ok++
      else break
    }
    res.push(ok)
  }
  return res
}
const rows: { X: number[]; Y: number[]; ds: string; res: number[]; nextFull: number; full: number }[] = []
for (const c of cand) {
  const X = c.cells
  const combos: number[][] = mode === 'individuel' ? [] : D.map((_, k) => [k, k, k, k])
  if (mode === 'individuel') for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) for (let e = 0; e < 12; e++) for (let f = 0; f < 12; f++) combos.push([a, b, e, f])
  for (const ks of combos) {
    const Y = X.map((x, i) => pointToCell(CELL_X[x] + D[ks[i]][0], CELL_Y[x] + D[ks[i]][1]))
    if (Y.some(y => y < 0 || !map.walk[y]) || new Set([...X, ...Y]).size < 8) continue
    const res = evalAll(X, Y)
    const nextFull = [0, 2, 4, 6, 8].filter(k => res[k] === 24).length
    const full = res.filter(x => x === 24).length
    rows.push({ X, Y, ds: ks.map(k => DN[k]).join('/'), res, nextFull, full })
  }
}
rows.sort((a, b) => b.nextFull - a.nextFull || b.full - a.full)
console.log('meilleures rotations (ordres OK /24 pour A/s A/m B/s B/m C/s C/m D/s D/m E/s E/m ; s = tour suivant, m = même tour)')
for (const r of rows.slice(0, 30)) console.log(`  X ${r.X.join(',')} Y ${r.Y.join(',')} d ${r.ds} : ${r.res.join(' ')}  (tour suivant 24/24 : ${r.nextFull}/5)`)
const hist = new Map<number, number>()
for (const r of rows) hist.set(r.nextFull, (hist.get(r.nextFull) ?? 0) + 1)
console.log('répartition (variantes « tour suivant » à 24/24) :', [...hist.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k}:${v}`).join(' '))
