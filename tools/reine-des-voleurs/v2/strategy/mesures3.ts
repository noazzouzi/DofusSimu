// Crâ attiré hors de sa case (Vers la lumière du Bourôliste : attire de 6 en ligne, puis Tournoyade −10 PM et
// Pesanteur 2 tours) : il est déplacé de d cases EN LIGNE avant le tour d'un joueur, reste bloqué n tours (ne bouge
// pas), puis rentre (≤ 5 PM par tour). Morts par bombe dans les 30 manches ? Comparé à « le Crâ meurt ».
// Usage : npx tsx mesures3.ts
import { loadMap, PERMS4, VARIANTS, type SimState, type Timing, type Chain } from '../search/modele2'
import { simulate2 } from './sim2'
import { bfsDistances } from '../../../../src/map/path'
import { CELL_X, CELL_Y, pointToCell } from '../../../../src/map/geometry'

const map = loadMap()
const S0 = [365, 378, 437, 451]
const T0 = [311, 392, 398, 479]
const Y0 = [325, 406, 412, 493]
const DEST = new Map(S0.map((s, i) => [s, T0[i]]))
const ROT = new Map(S0.map((s, i) => [s, Y0[i]]))
const VALID_SAME_N2 = ['365,437,378,451', '365,437,451,378', '437,365,378,451', '437,365,451,378']
const expected = (s: number, r: number, v: number, t: Timing) => (v >= 2 && t === 'next' && r >= 2 && r % 2 === 0 ? ROT.get(s)! : DEST.get(s)!)
const VT: { v: number; t: Timing; name: string }[] = []
for (let v = 0; v < VARIANTS.length; v++) for (const t of ['next', 'same'] as Timing[]) VT.push({ v, t, name: `${VARIANTS[v].id}/${t === 'next' ? 'suivant' : 'même'}` })
const ordersFor = (v: number, t: Timing) => {
  const all = PERMS4.map(p => p.map(i => S0[i]))
  return v <= 1 && t === 'same' ? all.filter(o => VALID_SAME_N2.includes(o.join(','))) : all
}
function stepPath(from: number, to: number, st: SimState, self: number): number | undefined {
  // case atteinte en ≤ 5 PM vers `to` (si `to` est trop loin, on s'en rapproche au mieux)
  const occ = new Set<number>([...st.monsters])
  for (const p of st.players) if (p.alive && p.idx !== self) occ.add(p.cell)
  for (const b of st.bombs) if (b.alive) occ.add(b.cell)
  const dTo = bfsDistances(to, c => !!map.walk[c] && !occ.has(c), 40)
  const dFrom = bfsDistances(from, c => !!map.walk[c] && !occ.has(c), 5)
  let best = from, bestD = dTo[from] < 0 ? 99 : dTo[from]
  for (let c = 0; c < dFrom.length; c++) if (dFrom[c] >= 0 && dTo[c] >= 0 && dTo[c] < bestD && !occ.has(c)) { best = c; bestD = dTo[c] }
  return best
}
const DIRS: [string, number, number][] = [['y+ (haut-droite écran)', 0, 1], ['x− (haut-gauche écran)', -1, 0], ['x+ (bas-droite écran)', 1, 0], ['y− (bas-gauche écran)', 0, -1]]
const ROUNDS = [3, 5, 7]
console.log('== Crâ attiré de d cases en ligne (avant le tour du joueur k), bloqué 2 tours, puis retour ; proportion de parties avec une mort par bombe')
for (const [dirName, dx, dy] of DIRS.slice(0, 2)) {
  for (const d of [1, 2, 4, 6]) {
    const parts: string[] = []
    let badAll = 0, totAll = 0
    for (const { v, t, name } of VT) {
      let bad = 0, tot = 0
      for (const o of ordersFor(v, t)) for (const victim of S0) for (const R of ROUNDS) for (const k of [0, 2]) for (const ch of ['dfs'] as Chain[]) {
        const vi = o.indexOf(victim)
        let stuckUntil = -1
        let skipped = false
        const res = simulate2(map, o, {
          rounds: 30, variant: v, timing: t, chain: ch,
          beforeTurn: (r, idx, st) => {
            if (r === R && idx === k) {
              const p = st.players[vi]
              const z = pointToCell(CELL_X[p.cell] + dx * d, CELL_Y[p.cell] + dy * d)
              const occ = new Set([...st.players.filter(q => q.alive && q.idx !== vi).map(q => q.cell), ...st.bombs.filter(b => b.alive).map(b => b.cell)])
              if (z < 0 || !map.walk[z] || occ.has(z)) { skipped = true; return }
              p.cell = z
              stuckUntil = vi >= k ? R + 1 : R + 2 // bloqué pendant ses 2 tours suivants
            }
          },
          move: (r, idx, st) => {
            if (idx === vi && stuckUntil > 0 && r <= stuckUntil && r >= R) return undefined
            const want = expected(o[idx], r, v, t)
            if (st.players[idx].cell === want) return undefined
            return stepPath(st.players[idx].cell, want, st, idx)
          },
        })
        if (skipped) continue
        tot++
        if (!res.ok) bad++
      }
      badAll += bad; totAll += tot
      parts.push(`${name} ${tot ? Math.round((100 * bad) / tot) : '—'}%`)
    }
    console.log(`  ${dirName}, d=${d} : ${badAll}/${totAll} (${Math.round((100 * badAll) / Math.max(1, totAll))} %) — ${parts.join(' ')}`)
  }
}
