// Rejoue une manche du dernier combat du journal : actions réelles des Crâs, monstres simulés (round.ts), et compare
// la case de fin de chaque tour à la case réelle. Écrit le replay dans .cache/round-<manche>.json.
//   npx tsx tools/reine-des-voleurs/planificateur/rejouer.ts --manche 1
import { writeFileSync } from 'node:fs'
import { journalRound } from './web'

const i = process.argv.indexOf('--manche')
const round = i > 0 ? Number(process.argv[i + 1]) : 1
const res = journalRound(round)
for (const t of res.turns) {
  const real = t.realEnd !== undefined ? ` | réel : fin ${t.realEnd}` : ''
  console.log(`M${t.round} ${t.name.padEnd(22)} ${t.actions.join(' ; ') || '(rien)'} — fin ${t.endCell}${t.alive ? '' : ' ✝'}${real}`)
}
console.log('morts :', res.deaths.join(', ') || 'aucune')
writeFileSync(`.cache/round-${round}.json`, JSON.stringify(res.replay))
console.log(`replay : .cache/round-${round}.json (${res.replay.events.length} événements)`)
