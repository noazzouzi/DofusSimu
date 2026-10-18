import { readFileSync } from 'node:fs'
import { mergeStreams } from '../../fightlog/fusion'
import { chainsOf } from './journal'
const all = readFileSync('data/fightlogs/2026-10-12/session-19-45-46.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const cut = process.argv[2]
const lines: any[] = []
let keep = true
for (const o of all) { if (o.k === 'b') keep = (o.at ?? '') <= cut; if (keep) lines.push(o) }
const streams = chainsOf(lines).filter(x => x.c).map(x => ({ name: x.c!, rows: x.rows }))
for (const s of streams) {
  const m = s.rows.filter(r => r.k === 'm')
  const firstRound = m.map((r, i) => (r.n === 'jvi' && r.d?.fxjj === 1 ? i : -1)).filter(i => i >= 0)
  console.log(s.name, 'lignes', s.rows.length, 'manche 1 aux index', firstRound.slice(-4).join(','), '| dernières :', m.slice(-6).map(r => r.n + (r.n === 'jvj' ? ':' + r.d.fxjr : r.n === 'jvi' ? ':' + r.d.fxjj : '')).join(' '))
}
const merged = mergeStreams(streams, ['Lowkey-Jealous', ...streams.map(s => s.name).filter(n => n !== 'Lowkey-Jealous')])
const m = merged.rows.filter((r: any) => r.k === 'm')
console.log('FUSION', m.length, 'messages ; séquence (jvi/jvj/juo/jwh/fin) :')
console.log(m.map((r: any) => (r.n === 'jvi' ? `M${r.d.fxjj}` : r.n === 'jvj' ? `T${r.d.fxjr}` : r.n === 'juo' ? 'SYNC' : r.n === 'jwh' ? 'FIN' : r.n === 'jup' ? '' : '')).filter(Boolean).join(' ').slice(0, 1500))
