// Reconstitution d'un combat réel depuis le journal AnkaBot, vérifiée paquet par paquet (rejeu.ts).
//   npx tsx tools/fightlog/index.ts [--fichier data/fightlogs/…/session-….jsonl] [--perso Lowkey-Jealous]
//                                   [--combat -1] [--replay fichier.json] [--publier]
// Défaut : dernier fichier de data/fightlogs, chef du groupe (ou personnage au flux le plus long), dernier combat.
// --publier : écrit le replay dans web/public/replays/ et l'ajoute à index.json (menu de la section « Combats »).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadStream, rebuild } from './rejeu'

const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : undefined
}
const ROOT = process.cwd()
const LOGS = join(ROOT, 'data', 'fightlogs')

function latest(): string {
  const files: string[] = []
  for (const d of readdirSync(LOGS)) {
    const p = join(LOGS, d)
    if (statSync(p).isDirectory()) for (const f of readdirSync(p)) if (f.endsWith('.jsonl')) files.push(join(p, f))
  }
  return files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1)!
}

const file = arg('--fichier') ?? latest()
const { rows, character } = loadStream(file, arg('--perso'))
const res = rebuild(rows, { which: Number(arg('--combat') ?? -1), title: `Combat réel — ${basename(file)} (${character})` })

const pct = (a: number, b: number) => (b ? ((100 * a) / (a + b)).toFixed(1) : '100.0')
console.log(`${file} — flux de ${character}`)
console.log(`${res.fighters.length} combattants (${res.fighters.filter(f => f.kind === 'summon').length} invocations), ${res.rounds} manches, ${res.turns} tours, ${res.actions} actions`)
console.log(`Vérification — synchronisations du serveur : ${res.checks.sync.ok} justes, ${res.checks.sync.bad} fausses (${pct(res.checks.sync.ok, res.checks.sync.bad)} %)`)
console.log(`             — photos d'AnkaBot : ${res.checks.photo.ok} justes, ${res.checks.photo.bad} fausses (${pct(res.checks.photo.ok, res.checks.photo.bad)} %)`)
const byField: Record<string, number> = {}
for (const m of res.checks.mismatches) byField[`${m.source}/${m.field}`] = (byField[`${m.source}/${m.field}`] ?? 0) + 1
console.log('Écarts par nature :', JSON.stringify(byField))
for (const m of res.checks.mismatches.filter(m => m.source === 'sync').slice(0, 15)) console.log(`  sync manche ${m.round} ${m.fighter} ${m.field} : serveur ${m.expected}, reconstitué ${m.got}`)
for (const m of res.checks.mismatches.filter(m => m.source === 'photo').slice(0, 10)) console.log(`  photo n°${m.at} manche ${m.round} ${m.fighter} ${m.field} : AnkaBot ${m.expected}, reconstitué ${m.got}`)
console.log('Dégâts infligés (reconstitués / statistiques du serveur) :', Object.entries(res.damageBy).map(([k, v]) => `${k} ${v.rebuilt}/${v.server ?? '?'}`).join(' · '))
console.log('Paquets non interprétés :', JSON.stringify(res.unhandled))
const out = arg('--replay')
if (out) {
  writeFileSync(out, JSON.stringify(res.replay))
  console.log(`Replay : ${out} (${res.replay.events.length} événements)`)
}
if (process.argv.includes('--publier')) {
  const dir = join(ROOT, 'web', 'public', 'replays')
  const stamp = basename(file).replace(/^session-|\.jsonl$/g, '')
  const day = basename(join(file, '..'))
  const name = `combat-reel-${day}-${stamp}.json`
  writeFileSync(join(dir, name), JSON.stringify(res.replay))
  const indexFile = join(dir, 'index.json')
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { replays: [] }
  const title = `Combat réel du ${day} (journal AnkaBot, ${res.rounds} manches, ${res.turns} tours) — reconstitué paquet par paquet`
  index.replays = [{ file: name, title, createdAt: new Date().toISOString() }, ...index.replays.filter((r: { file: string }) => r.file !== name)]
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n')
  console.log(`Publié : web/public/replays/${name} (menu de la section « Combats »)`)
}
