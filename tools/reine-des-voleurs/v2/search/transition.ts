// Transitions au tour 1 : départ sur 4 cases rouges (toutes, 325/369 signalées), chaque Crâ rejoint sa case cible
// pendant son tour 1 APRÈS l'apparition de sa bombe (chemin libre ≤ 5 PM, Crâs et bombes bloquent), puis ne bouge plus.
// Pour chaque formation cible : tous les (départ, affectation) avec distance ≤ 5, évalués sur les 10 variantes
// (5 règles × 2 moments) × 24 ordres × 2 chaînes × 30 manches. Score = nb de variantes à 24/24.
// Usage : npx tsx transition.ts <json classement> <K premiers> <shard> <nshards>
import { readFileSync } from 'node:fs'
import { loadMap, PERMS4 } from './modele2'
import { initFast, fastSim, stats, BLOCKED } from './fastsim'
import { CELL_COUNT } from '../../../../src/map/geometry'
import { bfsDistances } from '../../../../src/map/path'
const [file, Ks, shs, nss] = process.argv.slice(2)
const K = +Ks, shard = +shs, nsh = +nss
const map = loadMap(); initFast(map)
const cand = (JSON.parse(readFileSync(file, 'utf8')) as { cells: number[] }[]).slice(0, K)
const RED = map.red
const dist = new Map<number, Int16Array>()
for (const r of RED) dist.set(r, bfsDistances(r, c => !!map.walk[c], 30))
const VT: [number, 0 | 1][] = [[0, 0], [0, 1], [1, 0], [1, 1], [3, 0], [3, 1], [4, 0], [4, 1], [2, 1], [2, 0]] // ordre d'importance
const ord = new Int16Array(4)
const mv = [new Int16Array(4)]
/** 24 ordres × 2 chaînes pour une variante ; renvoie le nombre d'ordres OK (arrêt anticipé si stopFirst). */
function evalVT(S: number[], T: number[], v: number, t: 0 | 1, stopFirst: boolean): number {
  let ok = 0
  for (const perm of PERMS4) {
    for (let x = 0; x < 4; x++) { ord[x] = S[perm[x]]; mv[0][x] = T[perm[x]] }
    let good = true
    for (const ch of [0, 1] as const) {
      const r = fastSim(ord, { variant: v, timing: t, chain: ch, rounds: 30, moves: mv, maxPM: 5 })
      if (r) { good = false; break }
    }
    if (good) ok++
    else if (stopFirst) return ok
  }
  return ok
}
const results: string[] = []
for (let ti = shard; ti < cand.length; ti += nsh) {
  const T = cand[ti].cells
  const plans: { S: number[]; score: number; mask: number; pmMax: number; pmTot: number; risky: boolean }[] = []
  for (let i = 0; i < RED.length; i++) for (let j = i + 1; j < RED.length; j++) for (let k = j + 1; k < RED.length; k++) for (let l = k + 1; l < RED.length; l++) {
    const set = [RED[i], RED[j], RED[k], RED[l]]
    for (const p of PERMS4) {
      const S = p.map(x => set[x]) // S[x] → T[x]
      let mx = 0, tot = 0
      for (let x = 0; x < 4; x++) { const d = dist.get(S[x])![T[x]]; if (d < 0 || d > 5) { mx = 99; break } mx = Math.max(mx, d); tot += d }
      if (mx > 5) continue
      // filtre : A tour suivant 24/24 obligatoire
      if (evalVT(S, T, 0, 0, true) < 24) continue
      let mask = 0, score = 0
      VT.forEach(([v, t], b) => { if (evalVT(S, T, v, t, true) === 24) { mask |= 1 << b; score++ } })
      plans.push({ S, score, mask, pmMax: mx, pmTot: tot, risky: S.includes(325) || S.includes(369) })
    }
  }
  plans.sort((a, b) => b.score - a.score || Number(a.risky) - Number(b.risky) || a.pmMax - b.pmMax || a.pmTot - b.pmTot)
  const fmt = (p: (typeof plans)[0]) => `${p.S.join(',')}:${p.score}:${p.mask}:${p.pmMax}:${p.pmTot}${p.risky ? ':R' : ''}`
  const best = plans.slice(0, 3).map(fmt)
  const n2 = plans.filter(p => (p.mask & 15) === 15).slice(0, 3).map(fmt)
  results.push(`${ti} ${T.join(',')} plans=${plans.length} best=${best.join(' ')} n2=${n2.join(' ')}`)
  if (ti % 200 < nsh) process.stderr.write(`${ti} `)
}
for (const r of results) console.log(r)
