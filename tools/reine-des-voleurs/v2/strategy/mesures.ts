// Mesures complémentaires pour la stratégie (formation F-A), dans le modèle étendu des bombes (../search/modele2.ts).
//  1. Mort d'un Crâ (Bombe Illicale, dégâts…) : les survivants gardent leur plan ; morts supplémentaires ?
//     Puis recherche de replis simples (un survivant se déplace de ≤ 5 PM au tour qui suit la mort).
//  2. Accès des monstres depuis les cases bleues : premier tour où chaque menace peut agir sur un Crâ de la formation.
//  3. Représailles (PO 3-10, LdV) : combien de Crâs peuvent viser la Reine, depuis leur case ou une sortie ≤ 2 PM,
//     quand elle vient de lancer Mort en Sursis (case d'arrivée au contact de sa cible).
// Usage : npx tsx mesures.ts (depuis ce dossier ou n'importe où ; chemins absolus)
import { readFileSync } from 'node:fs'
import { loadMap, simulate, PERMS4, VARIANTS, xy, type SimState, type Timing, type Chain } from '../search/modele2'
import { CELL_COUNT, CELL_X, CELL_Y, distance, pointToCell } from '../../../../src/map/geometry'
import { bfsDistances } from '../../../../src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '../../../../src/map/los'

const map = loadMap()
const mapJson = JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as { cells: { id: number; los: boolean }[] }
const opaque = opaqueCells(mapJson.cells as never)

const S0 = [365, 378, 437, 451]
const T0 = [311, 392, 398, 479]
const Y0 = [325, 406, 412, 493]
const DEST = new Map(S0.map((s, i) => [s, T0[i]]))
const ROT = new Map(S0.map((s, i) => [s, Y0[i]]))
const VALID_SAME_N2 = ['365,437,378,451', '365,437,451,378', '437,365,378,451', '437,365,451,378']

function expected(s: number, r: number, v: number, t: Timing): number {
  if (v >= 2 && t === 'next' && r >= 2 && r % 2 === 0) return ROT.get(s)!
  return DEST.get(s)!
}
function pathLen(from: number, to: number, st: SimState, self: number): number {
  if (from === to) return 0
  const occ = new Set<number>([...st.monsters])
  for (const p of st.players) if (p.alive && p.idx !== self) occ.add(p.cell)
  for (const b of st.bombs) if (b.alive) occ.add(b.cell)
  if (occ.has(to)) return 99
  const d = bfsDistances(from, c => !!map.walk[c] && !occ.has(c), 12)
  return d[to] < 0 ? 99 : d[to]
}
const VT: { v: number; t: Timing; name: string }[] = []
for (let v = 0; v < VARIANTS.length; v++) for (const t of ['next', 'same'] as Timing[]) VT.push({ v, t, name: `${VARIANTS[v].id}/${t === 'next' ? 'suivant' : 'même'}` })
function ordersFor(v: number, t: Timing): number[][] {
  const all = PERMS4.map(p => p.map(i => S0[i]))
  if (v <= 1 && t === 'same') return all.filter(o => VALID_SAME_N2.includes(o.join(',')))
  return all
}

/** Une partie : `kill` = [case de départ de la victime, manche, avant le tour du joueur d'indice k] ;
 *  `repli` = déplacement d'un survivant (case de départ → nouvelle case tenue) à partir de la manche suivante. */
function run(order: number[], v: number, t: Timing, chain: Chain, kill?: [number, number, number], repli?: Map<number, number>) {
  let blocked = false
  const victimIdx = kill ? order.indexOf(kill[0]) : -1
  const move = (r: number, idx: number, st: SimState) => {
    let want = expected(order[idx], r, v, t)
    if (repli && kill && r > kill[1] && repli.has(order[idx])) want = repli.get(order[idx])!
    if (st.players[idx].cell === want) return undefined
    const len = pathLen(st.players[idx].cell, want, st, idx)
    if (len > 5) { blocked = true; return undefined }
    return want
  }
  const beforeTurn = kill ? (r: number, idx: number) => (r === kill[1] && idx === kill[2] ? { kill: [victimIdx] } : undefined) : undefined
  const res = simulate(map, order, { rounds: 30, variant: v, timing: t, chain, move, beforeTurn })
  return { ok: res.ok && !blocked, res, blocked }
}

// ── 0. contrôle : plan sans perturbation
console.log('== 0. Contrôle F-A (365/378/437/451 → 311/392/398/479, alternance 325/406/412/493 si N4 + tour suivant)')
for (const { v, t, name } of VT) {
  const os = ordersFor(v, t)
  let ok = 0
  for (const o of os) if (run(o, v, t, 'dfs').ok && run(o, v, t, 'bfs').ok) ok++
  console.log(`  ${name.padEnd(11)} ${ok}/${os.length}`)
}

// ── 1. Mort d'un Crâ
console.log('\n== 1. Mort d\'un Crâ (tué par un monstre avant le tour du joueur k, manches 2 à 10), survivants immobiles sur leur plan')
console.log('   cas mortels = au moins une mort SUPPLÉMENTAIRE par bombe dans les 30 manches (chaîne dfs et bfs)')
const DEATH_ROUNDS = [2, 3, 4, 5, 6, 7, 8, 9, 10]
const deathTable: Record<string, Record<number, [number, number]>> = {}
for (const { v, t, name } of VT) {
  const row: Record<number, [number, number]> = {}
  for (const victim of S0) {
    let bad = 0, tot = 0
    for (const o of ordersFor(v, t)) for (const R of DEATH_ROUNDS) for (let k = 0; k < 4; k++) {
      for (const ch of ['dfs', 'bfs'] as Chain[]) {
        tot++
        if (!run(o, v, t, ch, [victim, R, k]).ok) bad++
      }
    }
    row[victim] = [bad, tot]
  }
  deathTable[name] = row
  console.log(`  ${name.padEnd(11)} ` + S0.map(s => `mort du Crâ de ${s}→${DEST.get(s)} : ${row[s][0]}/${row[s][1]} (${Math.round((100 * row[s][0]) / row[s][1])} %)`).join(' ; '))
}

console.log('\n   (replis : rester immobile est sûr dans 100 % des cas mesurés, voir ci-dessus)')

// ── 2. Accès des monstres
function snapshot(v: number, t: Timing, round: number) {
  let snap: { players: number[]; bombs: number[] } | undefined
  const order = S0
  const move = (r: number, idx: number, st: SimState) => {
    const want = expected(order[idx], r, v, t)
    if (st.players[idx].cell === want) return undefined
    return want
  }
  simulate(map, order, {
    rounds: round, variant: v, timing: t, chain: 'dfs', move,
    beforeTurn: (r, idx, st) => { if (r === round && idx === 0) snap = { players: st.players.map(p => p.cell), bombs: st.bombs.filter(b => b.alive).map(b => b.cell) } },
  })
  return snap!
}
const inLine = (a: number, b: number) => CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]
function access(label: string, snap: { players: number[]; bombs: number[] }) {
  const occ = new Set([...snap.players, ...snap.bombs])
  const blk = (a: number, b: number) => (x: number) => x !== a && x !== b && occ.has(x)
  const crâs = snap.players
  const sets: Record<string, Set<number>> = { mes: new Set(), lum: new Set(), sub: new Set(), bom: new Set(), cac: new Set() }
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!map.walk[c] || occ.has(c)) continue
    for (const p of crâs) {
      const d = distance(c, p)
      if (d === 1) sets.cac.add(c)
      // Mort en Sursis : en ligne 1-5, LdV
      if (inLine(c, p) && d >= 1 && d <= 5 && hasLineOfSightOnMap(opaque, c, p, blk(c, p))) sets.mes.add(c)
      // Vers la lumière (Bourôliste) : en ligne 2-7, LdV
      if (inLine(c, p) && d >= 2 && d <= 7 && hasLineOfSightOnMap(opaque, c, p, blk(c, p))) sets.lum.add(c)
      // Bombe Illicale : 1-6, LdV
      if (d >= 1 && d <= 6 && hasLineOfSightOnMap(opaque, c, p, blk(c, p))) sets.bom.add(c)
    }
    // Subtilité (Doublure) : case visée z à 1-6 en LdV, un Crâ à ≤ 3 de z (attire 3 / repousse 2)
    for (let z = 0; z < CELL_COUNT && !sets.sub.has(c); z++) {
      if (!map.walk[z] || !crâs.some(p => distance(p, z) <= 3)) continue
      const d = distance(c, z)
      if (d >= 1 && d <= 6 && hasLineOfSightOnMap(opaque, c, z, blk(c, z))) sets.sub.add(c)
    }
  }
  const danger = snap.bombs
  console.log(`  -- ${label} : Crâs ${crâs.join('/')} ; bombes ${snap.bombs.join('/')}`)
  const turn = (pm: number, dist: number) => (dist >= 99 ? '—' : dist === 0 ? '1' : String(Math.ceil(dist / pm)))
  const rows: string[] = []
  const agg: Record<string, number[]> = { mes: [], lum: [], sub: [], bom: [], cac4: [], cac3: [], cac5: [] }
  for (const b of map.blue) {
    const d = bfsDistances(b, c => !!map.walk[c] && !occ.has(c), 80)
    const min = (s: Set<number>) => { let m = 99; for (const c of s) if (d[c] >= 0) m = Math.min(m, d[c]); return m }
    const m = { mes: min(sets.mes), lum: min(sets.lum), sub: min(sets.sub), bom: min(sets.bom), cac: min(sets.cac) }
    agg.mes.push(m.mes); agg.lum.push(m.lum); agg.sub.push(m.sub); agg.bom.push(m.bom); agg.cac4.push(m.cac)
    rows.push(`    ${xy(b).padEnd(12)} Mort en Sursis ${String(m.mes).padStart(2)} PM (Reine 6 PM : tour ${turn(6, m.mes)}) | Vers la lumière ${String(m.lum).padStart(2)} PM (Bourô 5 PM : tour ${turn(5, m.lum)}) | Subtilité ${String(m.sub).padStart(2)} PM (Doublure 3 PM : tour ${turn(3, m.sub)}) | Bombe Illicale ${String(m.bom).padStart(2)} PM (Terri 4 PM : tour ${turn(4, m.bom)}) | contact ${String(m.cac).padStart(2)} PM (3/4/5 PM : tours ${turn(3, m.cac)}/${turn(4, m.cac)}/${turn(5, m.cac)})`)
  }
  for (const r of rows) console.log(r)
  const lo = (a: number[]) => Math.min(...a), hi = (a: number[]) => Math.max(...a)
  console.log(`    bilan (min–max sur les 12 cases bleues) : Mort en Sursis ${lo(agg.mes)}–${hi(agg.mes)} PM ; Vers la lumière ${lo(agg.lum)}–${hi(agg.lum)} ; Subtilité ${lo(agg.sub)}–${hi(agg.sub)} ; Bombe Illicale ${lo(agg.bom)}–${hi(agg.bom)} ; contact ${lo(agg.cac4)}–${hi(agg.cac4)}`)
  // cases de bombe (danger si un ennemi s'y trouve) : PM depuis la case bleue la plus proche
  const dangerCells = label.startsWith('N2') ? [283, 370, 364, 451] : [269, 350, 356, 437, 325, 406, 412, 493]
  const dd = dangerCells.map(c => {
    let m = 99
    for (const b of map.blue) { const d = bfsDistances(b, x => !!map.walk[x] && (!occ.has(x) || x === c), 80); if (d[c] >= 0) m = Math.min(m, d[c]) }
    return `${c}:${m} PM`
  })
  console.log(`    cases où un ennemi est mortel (PM depuis la case bleue la plus proche) : ${dd.join(' ')}`)
}
console.log('\n== 2. Accès des monstres depuis les cases bleues (formation et bombes comme obstacles, sans tacle ni autres monstres)')
access('N2 / tour suivant (A), début manche 3', snapshot(0, 'next', 3))
access('N4 / tour suivant (C), début manche 3', snapshot(2, 'next', 3))
// Départs (tour 1, avant les déplacements) : Mort en Sursis possible au tour 1 ?
{
  const occ = new Set(S0)
  let worst = 99
  const per: string[] = []
  for (const p of [...S0, ...T0]) {
    const casts: number[] = []
    for (let c = 0; c < CELL_COUNT; c++) if (map.walk[c] && !occ.has(c) && inLine(c, p) && distance(c, p) >= 1 && distance(c, p) <= 5 && hasLineOfSightOnMap(opaque, c, p, x => x !== c && x !== p && occ.has(x))) casts.push(c)
    let m = 99
    for (const b of map.blue) { const d = bfsDistances(b, x => !!map.walk[x] && !occ.has(x), 80); for (const c of casts) if (d[c] >= 0) m = Math.min(m, d[c]) }
    per.push(`${p}:${m}`)
    worst = Math.min(worst, m)
  }
  console.log(`  Mort en Sursis au tour 1 (PM minimum de la Reine depuis une case bleue, Crâs sur leurs cases de départ/formation) : ${per.join(' ')}`)
}

// ── 3. Représailles sur la Reine après Mort en Sursis
console.log('\n== 3. Représailles (PO 3-10, LdV, Crâs et bombes bloquent la vue) sur la Reine posée au contact de sa cible après Mort en Sursis')
function repr(label: string, snap: { players: number[]; bombs: number[] }) {
  const occ = new Set([...snap.players, ...snap.bombs])
  const counts: number[] = [0, 0, 0, 0, 0]
  const countsCell: number[] = [0, 0, 0, 0, 0]
  const lines: string[] = []
  for (const target of snap.players) {
    // cases de lancer de Mort en Sursis sur `target`, puis case d'arrivée (avance de 6 vers la cible, arrêt sur obstacle)
    const landings = new Set<number>()
    for (let c = 0; c < CELL_COUNT; c++) {
      if (!map.walk[c] || occ.has(c) || !inLine(c, target)) continue
      const d = distance(c, target)
      if (d < 1 || d > 5 || !hasLineOfSightOnMap(opaque, c, target, x => x !== c && x !== target && occ.has(x))) continue
      const dx = Math.sign(CELL_X[target] - CELL_X[c]), dy = Math.sign(CELL_Y[target] - CELL_Y[c])
      let cur = c
      for (let s = 0; s < 6; s++) {
        const n = pointToCell(CELL_X[cur] + dx, CELL_Y[cur] + dy)
        if (n < 0 || n === target || !map.walk[n] || occ.has(n)) break
        cur = n
      }
      landings.add(cur)
    }
    for (const L of landings) {
      let nCell = 0, nOut = 0
      for (const p of snap.players) {
        const blk = (x: number) => x !== p && x !== L && occ.has(x)
        const okFrom = (from: number) => { const d = distance(from, L); return d >= 3 && d <= 10 && hasLineOfSightOnMap(opaque, from, L, (x: number) => x !== from && x !== L && occ.has(x) && x !== p) }
        if (okFrom(p)) { nCell++; nOut++; continue }
        const dd = bfsDistances(p, c => !!map.walk[c] && (!occ.has(c) || c === p) && c !== L, 2)
        let found = false
        for (let c = 0; c < CELL_COUNT && !found; c++) if (dd[c] > 0 && dd[c] <= 2 && okFrom(c)) found = true
        if (found) nOut++
        void blk
      }
      counts[nOut]++
      countsCell[nCell]++
    }
    lines.push(`    cible ${target} : ${landings.size} cases d'arrivée possibles`)
  }
  const tot = counts.reduce((a, b) => a + b, 0)
  console.log(`  -- ${label}`)
  for (const l of lines) console.log(l)
  console.log(`    Crâs capables de lancer Représailles (depuis leur case | depuis case ou sortie ≤ 2 PM), sur ${tot} cas : ` +
    [0, 1, 2, 3, 4].map(n => `${n} Crâ(s) ${countsCell[n]} | ${counts[n]}`).join(' ; '))
}
repr('N2 / tour suivant (A), état début manche 3', snapshot(0, 'next', 3))
repr('N4 / tour suivant (C), état début manche 3', snapshot(2, 'next', 3))
