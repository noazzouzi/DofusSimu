// Compléments pour le placement retenu (départ 354, 381, 380, 451 → chaîne 354, 381, 408, 435) :
//  E1 : vérification 24 ordres × (dfs, bfs) × 30 manches ;
//  E2 : après la mort d'un Crâ (manche 4), recherche d'un repli à 3 (cases cibles parmi les chaînes candidates) ;
//  E3 : délai d'accès des monstres depuis chaque case bleue (Reine : premier tour où Mort en Sursis peut viser un Crâ ;
//       autres : premier tour au contact), sans tacle, formation et bombes de la manche 3 comme obstacles.
import { readFileSync } from 'node:fs'
import { loadMap, simulate, permutations, xy, type SimState } from './modele-bombes'
import { pointToCell as P, distance, CELL_COUNT, CELL_X, CELL_Y } from '/home/user/DofusSimu/src/map/geometry'
import { bfsDistances } from '/home/user/DofusSimu/src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '/home/user/DofusSimu/src/map/los'

const map = loadMap()
const START = [354, 381, 380, 451]
const DEST = new Map([[354, 354], [381, 381], [380, P(17, -12)], [451, P(17, -14)]])
function pathLen(from: number, to: number, st: SimState, self: number): number {
  if (from === to) return 0
  const occ = new Set<number>([...st.monsters])
  for (const p of st.players) if (p.alive && p.idx !== self) occ.add(p.cell)
  for (const b of st.bombs) if (b.alive) occ.add(b.cell)
  if (occ.has(to)) return 99
  const d = bfsDistances(from, c => !!map.walk[c] && !occ.has(c), 12)
  return d[to] < 0 ? 99 : d[to]
}
function run(order: number[], extra: Partial<Parameters<typeof simulate>[2]> = {}, chain: 'dfs' | 'bfs' = 'dfs', rounds = 30) {
  let fail = false
  const move = (r: number, idx: number, st: SimState) => {
    const u = extra.move?.(r, idx, st)
    if (u !== undefined) return u
    if (r !== 1) return undefined
    const to = DEST.get(order[idx])!
    const len = pathLen(st.players[idx].cell, to, st, idx)
    if (len > 6) { fail = true; return undefined }
    return to
  }
  const res = simulate(map, order, { rounds, ...extra, chain, move })
  return { res, ok: res.ok && !fail, fail }
}

console.log('== E1 : départ', START.map(c => `${xy(c)}→${xy(DEST.get(c)!)}`).join('  '))
let n = 0
const mults: number[] = []
for (const ord of permutations(START)) {
  const a = run(ord, {}, 'dfs'), b = run(ord, {}, 'bfs')
  if (a.ok && b.ok) n++
  else console.log('  échec', ord.join('→'))
  mults.push(...a.res.bombsDuring.slice(1).flat().filter(x => x >= 0).map(k => Math.pow(0.9, k)))
}
console.log(`  ordres sans mort sur 30 manches (dfs et bfs) : ${n}/24 ; multiplicateur moyen de la Reine (manches 2-30, tous ordres) ${(mults.reduce((s, x) => s + x, 0) / mults.length).toFixed(3)}`)
const ref = [354, 381, 380, 451]
const r0 = run(ref, { log: true }, 'dfs', 3)
console.log('  trace manche 1 (ordre 354→381→380→451) :')
for (const e of r0.res.events.filter(e => e.round === 1)) console.log(`    J${e.turn + 1} ${e.kind} ${xy(e.cell)} ${e.info ?? ''}`)
const h = run(ref, {}, 'dfs', 30).res.healsBy
console.log('  soins bleus (manches) :', h.map((x, i) => `J${i + 1}@${xy(DEST.get(ref[i])!)}: ${x.join(',')}`).join(' ; '))

// ── E2 : repli après une mort
const cands = [P(17, -8), P(17, -10), P(17, -12), P(17, -14), P(17, -9), P(17, -11), P(17, -13), P(16, -9), P(16, -11), P(16, -13)]
console.log('\n== E2 : mort d\'un Crâ avant le tour du 1er joueur, manche 4 ; repli des 3 survivants vers 3 cases candidates (déplacement à leur tour suivant, ≤ 6 PM)')
for (let victim = 0; victim < 4; victim++) {
  const sols: string[] = []
  for (let a = 0; a < cands.length; a++) for (let b = 0; b < cands.length; b++) for (let c = 0; c < cands.length; c++) {
    if (a === b || b === c || a === c) continue
    const tgt = [cands[a], cands[b], cands[c]]
    const surv = [0, 1, 2, 3].filter(i => i !== victim)
    const want = new Map(surv.map((i, k) => [i, tgt[k]]))
    const beforeTurn = (r: number, idx: number) => (r === 4 && idx === 0 ? { kill: [victim] } : undefined)
    let blocked = false
    const move = (r: number, idx: number, st: SimState) => {
      if (r < 4 || st.players[victim].alive) return undefined
      const w = want.get(idx)!
      if (st.players[idx].cell === w) return undefined
      const len = pathLen(st.players[idx].cell, w, st, idx)
      if (len > 6) { blocked = true; return undefined }
      return w
    }
    const okd = run(ref, { beforeTurn, move }, 'dfs', 20)
    if (!okd.ok || blocked) continue
    const okb = run(ref, { beforeTurn, move }, 'bfs', 20)
    if (!okb.ok || blocked) continue
    const moves = surv.filter(i => want.get(i) !== DEST.get(ref[i])).length
    sols.push(`${moves} dépl. : ${surv.map(i => `J${i + 1}@${DEST.get(ref[i])}→${want.get(i)}`).join(' ')}`)
  }
  sols.sort()
  console.log(`  victime J${victim + 1} (${xy(DEST.get(ref[victim])!)}) : ${sols.length} replis sûrs (20 manches) ; ex. ${sols.slice(0, 4).join(' | ') || '—'}`)
}

// ── E3 : accès des monstres
const mapJson = JSON.parse(readFileSync('/home/user/DofusSimu/data/maps/137101312.json', 'utf8')) as { cells: { id: number; los: boolean }[] }
const opaque = opaqueCells(mapJson.cells as never)
let snap: { players: number[]; bombs: number[] } | undefined
run(ref, { beforeTurn: (r, idx, st) => { if (r === 3 && idx === 0) snap = { players: st.players.map(p => p.cell), bombs: st.bombs.filter(b => b.alive).map(b => b.cell) } } }, 'dfs', 3)
const occ = new Set([...snap!.players, ...snap!.bombs])
const chainCells = snap!.players
const mesCells = new Set<number>()
const cac = new Set<number>()
for (let c = 0; c < CELL_COUNT; c++) {
  if (!map.walk[c] || occ.has(c)) continue
  for (const p of chainCells) {
    const d = distance(c, p)
    if (d === 1) cac.add(c)
    if ((CELL_X[c] === CELL_X[p] || CELL_Y[c] === CELL_Y[p]) && d >= 1 && d <= 5 && hasLineOfSightOnMap(opaque, c, p, x => x !== c && x !== p && occ.has(x))) mesCells.add(c)
  }
}
console.log(`\n== E3 : accès depuis les cases bleues (formation et bombes de la manche 3 comme obstacles, sans tacle) ; ${mesCells.size} cases de lancer de Mort en Sursis, ${cac.size} cases au contact`)
for (const b of map.blue) {
  const d = bfsDistances(b, c => !!map.walk[c] && !occ.has(c), 60)
  let dm = 99, dc = 99
  for (const c of mesCells) if (d[c] >= 0) dm = Math.min(dm, d[c])
  for (const c of cac) if (d[c] >= 0) dc = Math.min(dc, d[c])
  const turn = (pm: number, dist: number) => (dist === 0 ? 1 : Math.ceil(dist / pm))
  console.log(`  ${xy(b).padEnd(13)} : Mort en Sursis à ${dm} PM (Reine 6 PM → tour ${turn(6, dm)}) ; contact à ${dc} PM (4 PM → tour ${turn(4, dc)}, 5 PM → tour ${turn(5, dc)}, 3 PM → tour ${turn(3, dc)})`)
}
