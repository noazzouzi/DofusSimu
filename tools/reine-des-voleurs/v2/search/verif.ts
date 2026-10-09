// Vérifications : (1) modele2 variante A == modele-bombes règle 'n' (d'origine) ; (2) fastsim == modele2 sur toutes variantes.
import { loadMap, simulate, VARIANTS } from './modele2'
import * as orig from '../../../../tools/reine-des-voleurs/modele-bombes'
import { initFast, fastSim, stats } from './fastsim'
import { distance } from '../../../../src/map/geometry'
const map = loadMap()
const omap = orig.loadMap()
initFast(map)
let seed = 12345
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const cands: number[] = []
for (let c = 0; c < 560; c++) if (map.walk[c] && map.red.some(r => distance(r, c) <= 6)) cands.push(c)
let n1 = 0, bad1 = 0, n2 = 0, bad2 = 0, nDeath = 0
for (let it = 0; it < 6000; it++) {
  const set: number[] = []
  while (set.length < 4) { const c = cands[Math.floor(rnd() * cands.length)]; if (!set.includes(c)) set.push(c) }
  const timing = rnd() < 0.5 ? 'next' : 'same'
  const chain = rnd() < 0.5 ? 'dfs' : 'bfs'
  const mons = rnd() < 0.3 ? [cands[Math.floor(rnd() * cands.length)]].filter(c => !set.includes(c)) : []
  // moves at round 1 for half the cases
  const mv = rnd() < 0.5 ? set.map(() => (rnd() < 0.5 ? cands[Math.floor(rnd() * cands.length)] : -1)) : undefined
  const moveFn = mv ? (r: number, i: number, st: any) => (r === 1 && mv[i] >= 0 && !st.players.some((p: any) => p.alive && p.cell === mv[i]) && !st.bombs.some((b: any) => b.alive && b.cell === mv[i]) && !mons.includes(mv[i]) ? mv[i] : undefined) : undefined
  // (1)
  const a = simulate(map, set, { rounds: 20, variant: 0, timing, chain, monsters: mons, move: moveFn })
  const b = orig.simulate(omap, set, { rounds: 20, spawnRule: 'n', timing, chain, monsters: mons, move: moveFn })
  n1++
  const ka = JSON.stringify(a.deaths.map(d => [d.idx, d.round, d.turnOf])), kb = JSON.stringify(b.deaths.map(d => [d.idx, d.round, d.turnOf]))
  if (ka !== kb || JSON.stringify(a.healsBy) !== JSON.stringify(b.healsBy)) { bad1++; if (bad1 < 4) console.log('DIFF1', set, timing, chain, ka, kb) }
  // (2) toutes variantes ; pour fastsim, déplacements résolus via la simulation de référence (cases réellement atteintes)
  for (let v = 0; v < VARIANTS.length; v++) {
    const ref = simulate(map, set, { rounds: 20, variant: v, timing, chain, monsters: mons, move: moveFn, log: true })
    const moves = mv ? [Int16Array.from(set.map((_, i) => { const e = ref.events.find(e => e.kind === 'move' && e.round === 1 && e.who === i); return e ? e.cell : -1 }))] : undefined
    const d = fastSim(set, { variant: v, timing: timing === 'next' ? 0 : 1, chain: chain === 'dfs' ? 0 : 1, rounds: 20, monsters: mons, moves, stopAtDeath: true })
    n2++
    const exp = ref.deaths.length ? ref.deaths[0].round : 0
    if (exp) nDeath++
    let okHeal = true
    if (!exp) for (let p = 0; p < 4; p++) if (stats.heals[p] !== ref.healsBy[p].length) okHeal = false
    if (d !== exp || (!exp && stats.beyond !== ref.beyond.length) || !okHeal || (exp && stats.deathIdx !== ref.deaths[0].idx)) { bad2++; if (bad2 < 6) console.log('DIFF2', v, set, timing, chain, mons, mv, d, exp, stats.deathIdx, ref.deaths[0]) }
  }
}
console.log(`(1) modele2 A vs modele-bombes 'n' : ${n1 - bad1}/${n1} identiques`)
console.log(`(2) fastsim vs modele2 (5 variantes) : ${n2 - bad2}/${n2} identiques ; cas avec mort ${nDeath}`)
