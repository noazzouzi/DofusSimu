import { RED, WALK } from './sim.ts'
import { CELL_X, CELL_Y, distance, pointToCell } from '../../../../src/map/geometry.ts'
const PRIM: Record<string, [number, number]> = { A: [-1, 1], B: [-1, 1], C: [-2, 2], D: [-2, 2], E: [-2, 2] }
const FB_: Record<string, [number, number]> = { A: [0, 2], B: [-1, 2], C: [0, 2], D: [-2, 3], E: [0, 4] }
const at = (c: number, d: [number, number]) => pointToCell(CELL_X[c] + d[0], CELL_Y[c] + d[1])
const line = (a: number, b: number) => a !== b && (CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]) && distance(a, b) <= 10
const sets: number[][] = []
for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let c = b + 1; c < 12; c++) for (let d = c + 1; d < 12; d++) sets.push([RED[a], RED[b], RED[c], RED[d]])
const spawn = (S: number[], s: number, v: string): [number, string] => {
  const occ = (x: number) => x < 0 || !WALK[x] || S.includes(x)
  let b = at(s, PRIM[v]); if (!occ(b)) return [b, 'N']
  b = at(s, FB_[v]); if (!occ(b)) return [b, 'repli']
  return [-1, 'au-delà']
}
const safe = (S: number[], v: string, beyondOk: boolean) => S.every((s) => { const [b, h] = spawn(S, s, v); if (b < 0) return beyondOk; return !S.some((o) => o !== s && line(b, o)) })
for (const bo of [false, true]) {
  const c: Record<string, number> = {}
  for (const S of sets) {
    const r: Record<string, boolean> = {}
    for (const v of ['A', 'B', 'C', 'D', 'E']) { r[v] = safe(S, v, bo); if (r[v]) c[v] = (c[v] ?? 0) + 1 }
    const k = (n: string, x: boolean) => { if (x) c[n] = (c[n] ?? 0) + 1 }
    k('A∧B', r.A && r.B); k('A∨B', r.A || r.B); k('C∧D∧E', r.C && r.D && r.E); k('C∨D∨E', r.C || r.D || r.E)
    k('(A∧B)∧(C∧D∧E)', r.A && r.B && r.C && r.D && r.E); k('A∧C', r.A && r.C); k('(A∨B)∧(C∨D∨E)', (r.A || r.B) && (r.C || r.D || r.E))
  }
  console.log(`au-delà ${bo ? 'compté sûr' : 'compté non sûr'} :`, JSON.stringify(c))
}
// sans 325 ni 369
const sets2 = sets.filter((S) => !S.includes(325) && !S.includes(369))
const cnt = (f: (S: number[]) => boolean) => sets2.filter(f).length
console.log(`sans 325/369 (${sets2.length} départs) : A∧B ${cnt((S) => safe(S, 'A', false) && safe(S, 'B', false))}, C∧D∧E ${cnt((S) => ['C', 'D', 'E'].every((v) => safe(S, v, false)))}`)
// détail des cases rouges : bombe N2 / N4 et ce qu'elle aligne
for (const s of RED) console.log(`  ${s} (${CELL_X[s]},${CELL_Y[s]}) : N2=${at(s, [-1, 1])}${WALK[at(s, [-1, 1])] ? '' : '#'} NE2=${at(s, [0, 2])}${WALK[at(s, [0, 2])] ? '' : '#'} N2+NE=${at(s, [-1, 2])}${WALK[at(s, [-1, 2])] ? '' : '#'} | N4=${at(s, [-2, 2])}${WALK[at(s, [-2, 2])] ? '' : '#'} ; rouges en ligne avec N2: ${RED.filter((o) => o !== s && line(at(s, [-1, 1]), o)).join(',')} ; avec N4: ${RED.filter((o) => o !== s && line(at(s, [-2, 2]), o)).join(',')}`)
import { BEYOND } from './sim.ts'
{
  const spawnCW = (S: number[], s: number, v: string): number => {
    const occ = (x: number) => x < 0 || !WALK[x] || S.includes(x)
    let b = at(s, PRIM[v]); if (!occ(b)) return b
    b = at(s, FB_[v]); if (!occ(b)) return b
    for (const c of BEYOND[s]) if (!occ(c)) return c
    return -1
  }
  const safeCW = (S: number[], v: string) => S.every((s) => { const b = spawnCW(S, s, v); return b >= 0 && !S.some((o) => o !== s && line(b, o)) })
  const ab = sets.filter((S) => safeCW(S, 'A') && safeCW(S, 'B'))
  const cde = sets.filter((S) => ['C', 'D', 'E'].every((v) => safeCW(S, v)))
  console.log(`au-delà = mon sens horaire (depuis le haut, distance 2 puis plus) : A∧B ${ab.length} ; C∧D∧E ${cde.length} ; les deux ${ab.filter((S) => cde.includes(S)).length}`)
  const ab0 = sets.filter((S) => safe(S, 'A', false) && safe(S, 'B', false))
  console.log('  A∧B sans recours à l\'au-delà :', ab0.map((S) => S.join('/')).join('  '))
}
