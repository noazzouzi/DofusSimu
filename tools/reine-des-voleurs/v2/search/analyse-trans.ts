// Synthèse des transitions : meilleurs plans (nb de variantes à 24/24), et meilleurs plans couvrant les 4 variantes N2
// (A et B, deux moments). Bits : 0 A/suiv 1 A/même 2 B/suiv 3 B/même 4 D/suiv 5 D/même 6 E/suiv 7 E/même 8 C/même 9 C/suiv.
import { readFileSync, readdirSync } from 'node:fs'
const NAMES = ['A/s', 'A/m', 'B/s', 'B/m', 'D/s', 'D/m', 'E/s', 'E/m', 'C/m', 'C/s']
const info = new Map<string, any>()
for (const o of JSON.parse(readFileSync('classe1-ldv.json', 'utf8'))) info.set(o.cells.join(','), o)
type Plan = { T: string; S: string; score: number; mask: number; pmMax: number; pmTot: number; risky: boolean }
const plans: Plan[] = []
let nT = 0, nWith = 0
for (const f of readdirSync('.').filter(f => /^trans2?-\d\.txt$/.test(f))) for (const line of readFileSync(f, 'utf8').split('\n')) {
  const m = line.match(/^\d+ (\S+) plans=(\d+) best=(.*?) n2=(.*)$/)
  if (!m) continue
  nT++
  if (+m[2] > 0) nWith++
  for (const tok of (m[3] + ' ' + m[4]).split(' ').filter(Boolean)) {
    const [S, score, mask, pmMax, pmTot, r] = tok.split(':')
    plans.push({ T: m[1], S, score: +score, mask: +mask, pmMax: +pmMax, pmTot: +pmTot, risky: r === 'R' })
  }
}
const dec = (m: number) => NAMES.filter((_, i) => m & (1 << i)).join(' ')
console.log(`formations évaluées ${nT}, avec au moins un plan (A/suivant 24/24) ${nWith}`)
const hist = new Map<number, number>()
const bestByT = new Map<string, Plan>()
for (const p of plans) { const b = bestByT.get(p.T); if (!b || p.score > b.score) bestByT.set(p.T, p) }
for (const p of bestByT.values()) hist.set(p.score, (hist.get(p.score) ?? 0) + 1)
console.log('meilleur score par formation :', [...hist.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k}:${v}`).join(' '))
const masks = new Map<number, number>()
for (const p of plans) masks.set(p.mask, (masks.get(p.mask) ?? 0) + 1)
console.log('masques les plus fréquents :', [...masks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `[${dec(k)}]×${v}`).join(' ; '))
const show = (p: Plan) => { const o = info.get(p.T); return `T ${p.T} ← S ${p.S}${p.risky ? ' (325/369)' : ''} : ${p.score} [${dec(p.mask)}] PM ${p.pmMax}/${p.pmTot} ; soins statiques ${o?.heal}/24 [${o?.hv?.join(' ')}] ; LdV zone min ${o?.ldvZoneMin} somme ${o?.ldvZone} bleues ${o?.ldvBleues}` }
const uniq = (arr: Plan[]) => { const s = new Set<string>(); return arr.filter(p => { const k = p.T + '|' + p.S; if (s.has(k)) return false; s.add(k); return true }) }
console.log('\n-- meilleurs plans (score, puis sans 325/369, puis PM)')
for (const p of uniq([...plans].sort((a, b) => b.score - a.score || Number(a.risky) - Number(b.risky) || a.pmMax - b.pmMax || a.pmTot - b.pmTot)).slice(0, 25)) console.log(show(p))
console.log('\n-- meilleurs plans couvrant A et B (N2) dans les deux moments')
for (const p of uniq(plans.filter(p => (p.mask & 15) === 15).sort((a, b) => b.score - a.score || Number(a.risky) - Number(b.risky) || (info.get(b.T)?.ldvZoneMin ?? 0) - (info.get(a.T)?.ldvZoneMin ?? 0) || a.pmTot - b.pmTot)).slice(0, 40)) console.log(show(p))
