// Relecture : QUI peut poser Pesanteur (Représailles, PO 3-10, LdV) sur la Reine après Mort en Sursis, cas par cas.
// Avec 4 Crâs, relance 3 et 1 lancer par tour d'équipe, seuls 2 Crâs sont disponibles à chaque tour : un cas où
// un seul Crâ (ou deux) voit la Reine peut donc laisser un trou dans la rotation.
import { readFileSync } from 'node:fs'
import { loadMap, simulate, type SimState, type Timing } from '../search/modele2'
import { CELL_COUNT, CELL_X, CELL_Y, distance, pointToCell } from '../../../../src/map/geometry'
import { bfsDistances } from '../../../../src/map/path'
import { hasLineOfSightOnMap, opaqueCells } from '../../../../src/map/los'
const map = loadMap()
const mapJson = JSON.parse(readFileSync('data/maps/137101312.json', 'utf8')) as { cells: { id: number; los: boolean }[] }
const opaque = opaqueCells(mapJson.cells as never)
const S0 = [365, 378, 437, 451], T0 = [311, 392, 398, 479], Y0 = [325, 406, 412, 493]
const NAME: Record<number, string> = { 311: 'A', 392: 'C', 398: 'B', 479: 'D', 325: 'a', 406: 'c', 412: 'b', 493: 'd' }
// sorties où rester coincé un tour est mortel (r2-robustesse.txt, partie c)
const DEADLY_STUCK_N2 = new Set([297, 384]), DEADLY_STUCK_N4 = new Set([284, 371])
function snapshot(v: number, t: Timing, round: number) {
  let snap: { players: number[]; bombs: number[] } | undefined
  const ord = [365, 437, 378, 451]
  simulate(map, ord, { rounds: round, variant: v, timing: t, chain: 'dfs',
    move: (r, idx) => { const i = S0.indexOf(ord[idx]); return v >= 2 && t === 'next' && r >= 2 && r % 2 === 0 ? Y0[i] : T0[i] },
    beforeTurn: (r, idx, st: SimState) => { if (r === round && idx === 0) snap = { players: st.players.map(p => p.cell), bombs: st.bombs.filter(b => b.alive).map(b => b.cell) } } })
  return snap!
}
let CROSS = false
let NOALLY = false
const inLine = (a: number, b: number) => CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]
function analyse(label: string, snap: { players: number[]; bombs: number[] }, deadly: Set<number>) {
  const occ = new Set([...snap.players, ...snap.bombs])
  console.log(`-- ${label} : Crâs ${snap.players.join('/')} ; bombes ${snap.bombs.join('/')}`)
  const hist: Record<string, number> = {}
  for (const target of snap.players) {
    const landings = new Set<number>()
    for (let c = 0; c < CELL_COUNT; c++) {
      if (!map.walk[c] || occ.has(c) || !inLine(c, target)) continue
      const d = distance(c, target)
      if (d < 1 || d > 5 || !hasLineOfSightOnMap(opaque, c, target, x => x !== c && x !== target && occ.has(x))) continue
      const dx = Math.sign(CELL_X[target] - CELL_X[c]), dy = Math.sign(CELL_Y[target] - CELL_Y[c])
      let cur = c
      for (let s = 0; s < 6; s++) { const n = pointToCell(CELL_X[cur] + dx, CELL_Y[cur] + dy); if (n < 0 || n === target || !map.walk[n] || occ.has(n)) break; cur = n }
      landings.add(cur)
    }
    for (const L of landings) {
      const fromCell: string[] = [], fromExit: string[] = [], fromSafeExit: string[] = []
      for (const p of snap.players) {
        const okZ = (from: number, Z: number) => { const d = distance(from, Z); return d >= 3 && d <= 10 && hasLineOfSightOnMap(opaque, from, Z, x => x !== from && x !== Z && x !== p && (occ.has(x) || x === L)) }
        const cross = (z: number) => [z, ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => pointToCell(CELL_X[z] + a, CELL_Y[z] + b))]
        let targets = CROSS ? [L, ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => pointToCell(CELL_X[L] + a, CELL_Y[L] + b)).filter(z => z >= 0 && map.walk[z])] : [L]
        if (NOALLY) targets = targets.filter(z => !cross(z).some(c => snap.players.includes(c)))
        const okFrom = (from: number) => targets.some(Z => okZ(from, Z))
        if (okFrom(p)) { fromCell.push(NAME[p]); continue }
        if (distance(p, L) === 1) continue // au contact de la Reine : tacle, pas de sortie
        const dd = bfsDistances(p, c => !!map.walk[c] && (!occ.has(c) || c === p) && c !== L && distance(c, L) > 1, 2)
        const exits: number[] = []
        for (let c = 0; c < CELL_COUNT; c++) if (dd[c] > 0 && dd[c] <= 2 && okFrom(c)) exits.push(c)
        if (exits.length) fromExit.push(`${NAME[p]}(${exits.join(',')})`)
        if (exits.some(c => !deadly.has(c))) fromSafeExit.push(NAME[p])
      }
      const n = fromCell.length + fromSafeExit.length
      hist[n] = (hist[n] ?? 0) + 1
      console.log(`   MeS sur ${NAME[target]} (${target}), Reine en ${L} : depuis la case ${fromCell.join(' ') || '—'} ; par sortie ${fromExit.join(' ') || '—'} ⇒ ${n} Crâ(s)${n <= 1 ? '  ⚠' : ''}`)
    }
  }
  console.log(`   bilan (Crâs capables, sorties « coincé = mortel » exclues) : ${JSON.stringify(hist)}`)
}
for (const [cross, noally] of [[false, false], [true, false], [true, true]] as [boolean, boolean][]) {
CROSS = cross; NOALLY = noally
console.log(`\n######## Cible de Représailles : ${cross ? 'la Reine OU une case voisine en ligne (croix X1 : elle reste dans la zone)' + (noally ? ', SANS Crâ dans la croix' : '') : 'la case de la Reine seulement'}`)
analyse('N2 / tour suivant (lecture A), début manche 3', snapshot(0, 'next', 3), DEADLY_STUCK_N2)
analyse('N2 / même tour (lecture A), début manche 3', snapshot(0, 'same', 3), DEADLY_STUCK_N2)
analyse('N4 / tour suivant (lecture C), début manche 3 (cases jaunes)', snapshot(2, 'next', 3), DEADLY_STUCK_N4)
analyse('N4 / tour suivant (lecture C), début manche 4 (cases tenues)', snapshot(2, 'next', 4), DEADLY_STUCK_N4)
}
