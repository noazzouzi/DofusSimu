/**
 * Récepteur du journal de combats AnkaBot (tools/ankabot/journal-combats.lua) : `node scripts/fightlog-server.mjs`.
 *
 * Écoute en local (127.0.0.1, port 8765 ou FIGHTLOG_PORT) : POST /log reçoit des lignes JSON (une par message, photo
 * d'état, événement ou type découvert) et les ajoute à data/fightlogs/<date>/session-<heure>.jsonl, précédées d'une
 * ligne de lot {"k":"b","at":<horodatage ISO>,"n":<lignes>,"c":<personnage>,"in":<instance>} (heure de réception du
 * lot ; le personnage et l'instance du script viennent des paramètres ?c= et &i= de l'adresse ; les lignes qui suivent
 * un lot sont les siennes jusqu'au lot suivant ; chaque ligne porte aussi l'horloge du script, « ms »). Les types
 * découverts ({"k":"t","t":<type>,"f":[<champs>]}) sont aussi gardés dans
 * data/fightlogs/schemas.json, que GET /schemas renvoie au script (lignes « <type>\t<champ>,<champ>… ») pour lui
 * éviter de les rechercher à nouveau. GET /status : compteurs de la session. Aucune dépendance.
 * Variables : FIGHTLOG_PORT (défaut 8765), FIGHTLOG_DIR (défaut data/fightlogs, pour des essais hors du dépôt).
 * Module : `startReceiver(opts)` (utilisé par le serveur de plans de la Reine, qui y ajoute la route /plan).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Instance du script (&i=), absente avant la version du 2026-10-10. */
function instanceOf(url) {
  return /[?&]i=([\w-]+)/.exec(url)?.[1]
}

/** Nom du personnage (?c=). MoonSharp encode les caractères accentués octet par octet en Latin-1 (%E9 pour é). */
export function characterOf(url) {
  const raw = /[?&]c=([^&]*)/.exec(url)?.[1]
  if (raw === undefined) return '?'
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  }
}

/**
 * Démarre le récepteur. Options : `port`, `logsDir`, `onBatch(batch)` (chaque lot reçu : { header, lines } — la ligne de
 * lot écrite dans le fichier et les lignes analysées, pour qui garde le journal en mémoire), `route(req, res)` (routes
 * supplémentaires : rend vrai si la requête est traitée), `banner` (lignes affichées au démarrage, après l'adresse).
 * Rend { server, file, stats }.
 */
export function startReceiver(opts = {}) {
  const PORT = Number(opts.port ?? process.env.FIGHTLOG_PORT ?? 8765)
  const started = new Date()
  const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const LOGS = opts.logsDir ?? process.env.FIGHTLOG_DIR ?? join(ROOT, 'data', 'fightlogs')
  const dir = join(LOGS, stamp.slice(0, 10))
  const file = join(dir, `session-${stamp.slice(11)}.jsonl`)
  const schemaFile = join(LOGS, 'schemas.json')
  mkdirSync(dir, { recursive: true })

  /** @type {Record<string, string[]>} type .NET → noms des champs */
  const schemas = existsSync(schemaFile) ? JSON.parse(readFileSync(schemaFile, 'utf8')) : {}

  const stats = { characters: new Set(), instances: new Set(), batches: 0, lines: 0, messages: 0, history: 0, snapshots: 0, events: 0, errors: 0, types: 0, invalid: 0, fights: 0, names: new Set() }

  function ingest(body, character, instance) {
    const lines = body.split('\n').filter(l => l.trim())
    const header = { k: 'b', at: new Date().toISOString(), n: lines.length, c: character, ...(instance ? { in: instance } : {}) }
    const out = [JSON.stringify(header)]
    const parsed = []
    let schemasChanged = false
    for (const line of lines) {
      try {
        const o = JSON.parse(line)
        parsed.push(o)
        if (o.k === 'm') {
          stats.messages++
          stats.names.add(o.n)
        } else if (o.k === 'h') stats.history++
        else if (o.k === 'x') stats.errors++
        else if (o.k === 's') stats.snapshots++
        else if (o.k === 'e') {
          stats.events++
          if (o.ev === 'fightStart') stats.fights++
        } else if (o.k === 't' && typeof o.t === 'string' && Array.isArray(o.f)) {
          stats.types++
          schemas[o.t] = o.f
          schemasChanged = true
        }
      } catch {
        stats.invalid++
      }
      out.push(line)
    }
    appendFileSync(file, out.join('\n') + '\n')
    if (schemasChanged) writeFileSync(schemaFile, JSON.stringify(schemas, null, 1) + '\n')
    stats.batches++
    stats.lines += lines.length
    opts.onBatch?.({ header, lines: parsed })
    return lines.length
  }

  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/log')) {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        const character = characterOf(req.url)
        const instance = instanceOf(req.url)
        stats.characters.add(character)
        if (instance) stats.instances.add(`${character}/${instance}`)
        const n = ingest(Buffer.concat(chunks).toString('utf8'), character, instance)
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`ok ${n}`)
        if (!opts.quiet) process.stdout.write(`\r${stats.characters.size} perso (${stats.instances.size} instance(s)) · ${stats.lines} lignes · ${stats.messages} messages (${stats.names.size} noms) · ${stats.history} d'historique · ${stats.types} types découverts · ${stats.snapshots} photos · ${stats.fights} combat(s) · ${stats.errors} erreur(s) · ${stats.invalid} invalides   `)
      })
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/schemas')) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(Object.entries(schemas).map(([t, f]) => `${t}\t${f.join(',')}`).join('\n'))
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/status')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ file: relative(ROOT, file), ...stats, characters: [...stats.characters], instances: [...stats.instances], names: stats.names.size, knownTypes: Object.keys(schemas).length }))
      return
    }
    if (opts.route?.(req, res)) return
    res.writeHead(404)
    res.end()
  })

  server.listen(PORT, '127.0.0.1', () => {
    if (opts.quiet) return
    console.log(`Journal de combats : http://127.0.0.1:${PORT}/log → ${relative(ROOT, file)} (${Object.keys(schemas).length} types connus)`)
    for (const l of opts.banner ?? ['Charger tools/ankabot/journal-combats.lua dans AnkaBot (mode MITM). Bilan : node scripts/fightlog-check.mjs. Ctrl+C pour arrêter.']) console.log(l)
  })
  return { server, file, stats }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startReceiver()
