// Ré-évaluation détaillée des meilleurs plans de transition : par variante, ordres OK /24 (dfs et bfs), apparitions
// au-delà du repli (règle inconnue) dans les simulations sans mort, soins bleus (écart ≤ 5 pour les 4 Crâs).
// Usage : npx tsx detail-plans.ts <scoreMin> > sortie
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { loadMap, PERMS4 } from './modele2'
import { initFast, fastSim, stats } from './fastsim'
const map = loadMap(); initFast(map)
const scoreMin = +process.argv[2]
const maskReq = +(process.argv[3] ?? 0)
const shard = +(process.argv[4] ?? 0), nsh = +(process.argv[5] ?? 1)
const outFile = process.argv[6] ?? 'detail-plans.json'
const info = new Map<string, any>()
for (const o of JSON.parse(readFileSync('classe1-ldv.json', 'utf8'))) info.set(o.cells.join(','), o)
const seen = new Set<string>()
const plans: { T: number[]; S: number[] }[] = []
for (const f of readdirSync('.').filter(f => /^trans2?-\d\.txt$/.test(f))) for (const line of readFileSync(f, 'utf8').split('\n')) {
  const m = line.match(/^\d+ (\S+) plans=(\d+) best=(.*?) n2=(.*)$/)
  if (!m) continue
  for (const tok of (m[3] + ' ' + m[4]).split(' ').filter(Boolean)) {
    const [S, score, mask] = tok.split(':')
    if (+score < scoreMin || (+mask & maskReq) !== maskReq) continue
    const k = m[1] + '|' + S
    if (seen.has(k)) continue
    seen.add(k)
    if (seen.size % nsh !== shard) continue
    plans.push({ T: m[1].split(',').map(Number), S: S.split(',').map(Number) })
  }
}
const VT: [number, 0 | 1, string][] = [[0, 0, 'A/s'], [0, 1, 'A/m'], [1, 0, 'B/s'], [1, 1, 'B/m'], [2, 0, 'C/s'], [2, 1, 'C/m'], [3, 0, 'D/s'], [3, 1, 'D/m'], [4, 0, 'E/s'], [4, 1, 'E/m']]
const out: any[] = []
const ord = new Int16Array(4)
const mv = [new Int16Array(4)]
for (const p of plans) {
  const per: Record<string, { ok: number; beyond: number; heal: number; gap: number }> = {}
  for (const [v, t, name] of VT) {
    let ok = 0, beyond = 0, heal = 0, gapW = 0
    for (const perm of PERMS4) {
      for (let x = 0; x < 4; x++) { ord[x] = p.S[perm[x]]; mv[0][x] = p.T[perm[x]] }
      let good = true, b = 0, h = true
      for (const ch of [0, 1] as const) {
        const r = fastSim(ord, { variant: v, timing: t, chain: ch, rounds: 30, moves: mv, maxPM: 5 })
        if (r) { good = false; break }
        b += stats.beyond
        for (let q = 0; q < 4; q++) { if (stats.maxGap[q] > 5) h = false; gapW = Math.max(gapW, stats.maxGap[q]) }
      }
      if (good) { ok++; beyond += b; if (h) heal++ }
    }
    per[name] = { ok, beyond, heal, gap: ok ? gapW : -1 }
  }
  const full = VT.filter(([, , n]) => per[n].ok === 24).map(([, , n]) => n)
  const fullClean = full.filter(n => per[n].beyond === 0)
  const o = info.get(p.T.join(','))
  out.push({ T: p.T, S: p.S, per, full, fullClean, ldvZoneMin: o?.ldvZoneMin, ldvZone: o?.ldvZone, ldvBleues: o?.ldvBleues, pmMax: Math.max(...p.T.map((t, i) => 0)), risky: p.S.includes(325) || p.S.includes(369) })
}
const w: Record<string, number> = { 'A/s': 16, 'A/m': 8, 'B/s': 8, 'B/m': 4, 'D/s': 2, 'E/s': 2, 'C/m': 1, 'D/m': 1, 'E/m': 1, 'C/s': 1 }
for (const o of out) o.wscore = o.fullClean.reduce((s: number, n: string) => s + w[n], 0)
out.sort((a, b) => b.fullClean.length - a.fullClean.length || b.wscore - a.wscore || Number(a.risky) - Number(b.risky) || b.ldvZoneMin - a.ldvZoneMin)
writeFileSync(outFile, JSON.stringify(out))
console.log('plans détaillés :', out.length)
const fmt = (o: any) => `T ${o.T.join(',')} ← S ${o.S.join(',')}${o.risky ? ' (325/369)' : ''} : 24/24 sans au-delà [${o.fullClean.join(' ')}] (24/24 avec au-delà [${o.full.filter((n: string) => !o.fullClean.includes(n)).join(' ')}]) ; soins A/s ${o.per['A/s'].heal}/24 B/s ${o.per['B/s'].heal} D/s ${o.per['D/s'].heal} E/s ${o.per['E/s'].heal} ; LdV min ${o.ldvZoneMin} somme ${o.ldvZone} bleues ${o.ldvBleues}`
console.log('-- par nombre de variantes propres (sans au-delà)')
for (const o of out.slice(0, 25)) console.log(fmt(o))
console.log('-- par poids de plausibilité (A/s 16, A/m 8, B/s 8, B/m 4, D/s 2, E/s 2, autres 1)')
for (const o of [...out].sort((a, b) => b.wscore - a.wscore || Number(a.risky) - Number(b.risky) || b.ldvZoneMin - a.ldvZoneMin).slice(0, 25)) console.log(fmt(o))
