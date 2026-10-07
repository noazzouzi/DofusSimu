/**
 * Récepteur du journal de combats AnkaBot (tools/ankabot/journal-combats.lua) : `node scripts/fightlog-server.mjs`.
 *
 * Écoute en local (127.0.0.1, port 8765 ou FIGHTLOG_PORT) : POST /log reçoit des lignes JSON (une par message, photo
 * d'état ou événement) et les ajoute à data/fightlogs/<date>/session-<heure>.jsonl, précédées d'une ligne de lot
 * {"k":"b","at":<horodatage ISO>,"n":<lignes>} (le script Lua n'a pas d'horloge documentée : l'heure est celle de la
 * réception du lot). GET /status : compteurs de la session. Aucune dépendance.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.FIGHTLOG_PORT ?? 8765)
const started = new Date()
const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dir = join(ROOT, 'data', 'fightlogs', stamp.slice(0, 10))
const file = join(dir, `session-${stamp.slice(11)}.jsonl`)
mkdirSync(dir, { recursive: true })

const stats = { batches: 0, lines: 0, messages: 0, snapshots: 0, events: 0, invalid: 0, fights: 0, names: new Set() }

function ingest(body) {
  const lines = body.split('\n').filter(l => l.trim())
  const out = [JSON.stringify({ k: 'b', at: new Date().toISOString(), n: lines.length })]
  for (const line of lines) {
    try {
      const o = JSON.parse(line)
      if (o.k === 'm') {
        stats.messages++
        stats.names.add(o.n)
      } else if (o.k === 's') stats.snapshots++
      else if (o.k === 'e') {
        stats.events++
        if (o.ev === 'fightStart') stats.fights++
      }
    } catch {
      stats.invalid++
    }
    out.push(line)
  }
  appendFileSync(file, out.join('\n') + '\n')
  stats.batches++
  stats.lines += lines.length
  return lines.length
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/log')) {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const n = ingest(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`ok ${n}`)
      process.stdout.write(`\r${stats.lines} lignes · ${stats.messages} messages (${stats.names.size} noms) · ${stats.snapshots} photos · ${stats.fights} combat(s) · ${stats.invalid} invalides   `)
    })
    return
  }
  if (req.method === 'GET' && req.url?.startsWith('/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ file: relative(ROOT, file), ...stats, names: stats.names.size }))
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Journal de combats : http://127.0.0.1:${PORT}/log → ${relative(ROOT, file)}`)
  console.log('Charger tools/ankabot/journal-combats.lua dans AnkaBot (mode MITM). Ctrl+C pour arrêter.')
})
