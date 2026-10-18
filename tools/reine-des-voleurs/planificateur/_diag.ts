import { readFileSync } from 'node:fs'
import { mergeStreams } from '../../fightlog/fusion'
import { measure } from './fidelite'
import { chainsOf, spellListOf } from './journal'
const all = readFileSync('data/fightlogs/2026-10-12/session-19-45-46.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const CHEF = 'Lowkey-Jealous'
for (const cut of process.argv.slice(2)) {
  // lignes reçues jusqu'à « cut » (heure du lot)
  const lines: any[] = []
  let keep = true
  for (const o of all) {
    if (o.k === 'b') keep = (o.at ?? '') <= cut
    if (keep) lines.push(o)
  }
  const streams = chainsOf(lines).filter(x => x.c).map(x => ({ name: x.c!, rows: x.rows }))
  const merged = mergeStreams(streams, [CHEF, ...streams.map(s => s.name).filter(n => n !== CHEF)])
  const spellLists: Record<string, any> = {}
  for (const s of streams) { const l = spellListOf(s.rows); if (l) spellLists[s.name] = l }
  let state: any
  try {
    measure(merged.rows, { fast: true, spellLists, onCurrentTurn: (s, p) => (state = [s, p]) })
    console.log(cut, '→', state ? `tour de ${state[1].name}, manche ${state[1].round}` : 'AUCUN tour en cours', '| lignes fusionnées', merged.rows.length, JSON.stringify(merged.sources))
  } catch (e) { console.log(cut, '→ ERREUR', (e as Error).message.slice(0, 300)) }
}
