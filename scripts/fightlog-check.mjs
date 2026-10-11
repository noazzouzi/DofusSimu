/**
 * Bilan d'un journal de combats AnkaBot (tools/ankabot/journal-combats.lua, scripts/fightlog-server.mjs) : vérifie
 * qu'il ne manque rien avant d'exploiter un combat.
 *
 *   node scripts/fightlog-check.mjs [fichier.jsonl…]      (défaut : dernière session de data/fightlogs)
 *
 * Par personnage : version du script, instances du script en parallèle (rechargement sans redémarrer AnkaBot), lignes
 * par sorte, trous dans la numérotation de chaque instance (lignes perdues), erreurs du script,
 * marques de données incomplètes ($truncated, $depth, $more, $collection, $other, $b64), lignes écrites avec des
 * {"$pending":…} et complétées ensuite (lignes « p »), mesures du script (perf, réflexion), historique relu au
 * chargement, messages reçus selon le script (compteurs) et lignes de messages arrivées ; par combat : durée, manches,
 * tours, actions, messages les plus fréquents. Code de sortie 1 si des données manquent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOGS = join(ROOT, 'data', 'fightlogs')
// Noms obfusqués du 2026-10-09 (voir le script Lua : FIGHT_MESSAGES, ROUND_MESSAGE).
const ROUND = 'jvi', ROUND_FIELD = 'fxjj', TURN = 'jvj', ACTION = 'jsq'
const MARKS = ['$truncated', '$depth', '$more', '$collection', '$other', '$b64']

function latestSession() {
  const days = existsSync(LOGS) ? readdirSync(LOGS).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : []
  for (const d of days.reverse()) {
    const files = readdirSync(join(LOGS, d)).filter(f => f.endsWith('.jsonl')).map(f => join(LOGS, d, f))
    if (files.length) return files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1)
  }
  return undefined
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : [latestSession()].filter(Boolean)
if (!files.length) {
  console.error('Aucun journal dans data/fightlogs.')
  process.exit(1)
}

let problems = 0
const warn = (s) => {
  problems++
  console.log(`  ⚠ ${s}`)
}

for (const file of files) {
  console.log(`\n${relative(ROOT, file)}`)
  /** @type {Map<string, any>} */
  const chars = new Map()
  let cur = '?'
  let inst
  let invalid = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let r
    try {
      r = JSON.parse(line)
    } catch {
      invalid++
      continue
    }
    if (r.k === 'b') {
      cur = r.c ?? '?'
      inst = r.in
      continue
    }
    let c = chars.get(cur)
    if (!c) {
      c = { kinds: {}, segments: [], instances: new Map(), errors: new Map(), marks: {}, history: 0, historyNames: new Set(), counts: null, fights: new Map(), messages: 0, version: null, timed: 0, pending: new Map(), completed: 0, notes: [] }
      chars.set(cur, c)
    }
    c.kinds[r.k] = (c.kinds[r.k] ?? 0) + 1
    if (typeof r.i === 'number') {
      // Une numérotation par instance du script : identifiant du lot (depuis 2026-10-10), sinon chaîne de numéros
      // consécutifs (anciens journaux : plusieurs instances s'entremêlent après un rechargement).
      let seg = inst ? c.instances.get(inst) : c.segments.find(x => x.last === r.i - 1)
      if (!seg || (!inst && r.i === 1)) {
        seg = { first: r.i, last: r.i, gaps: [] }
        c.segments.push(seg)
        if (inst) c.instances.set(inst, seg)
      } else {
        if (r.i !== seg.last + 1) seg.gaps.push([seg.last + 1, r.i - 1])
        seg.last = Math.max(seg.last, r.i)
      }
    }
    if (typeof r.ms === 'number') c.timed++
    if (r.k === 'e' && r.ev === 'loggerStart') c.version = r.version ?? 'ancienne (sans version)'
    if (r.k === 'e' && r.ev === 'perf') c.notes.push(`essai d'un nom absent : ${Number(r.failedProbeMs).toFixed(3)} ms`)
    if (r.k === 'e' && r.ev === 'reflection') c.notes.push(`réflexion .NET : ${r.ok ? 'disponible' : 'indisponible'}`)
    if (r.k === 'e' && r.ev === 'history') c.notes.push(`historique : ${r.kept} message(s) de ${r.names} nom(s), ${r.calls} appel(s), ${(r.totalMs / 1000).toFixed(1)} s (appel le plus long ${r.maxMs} ms)`)
    if (r.k === 'e' && r.ev === 'historyStopped') c.notes.push(`⚠ historique arrêté : ${r.name} a pris ${r.ms} ms`)
    if (r.k === 'e' && r.ev === 'otherInstance') c.notes.push(`⚠ une autre instance du script tourne (${r.newer})`)
    if ((r.k === 'm' || r.k === 'h') && line.includes('"$pending"')) c.pending.set(`${inst}:${r.i}`, { n: r.n, f: r.f })
    if (r.k === 'p') {
      const was = c.pending.get(`${inst}:${r.of}`)
      if (was) {
        c.pending.delete(`${inst}:${r.of}`)
        c.completed++
        if (r.n === ROUND && c.fights.has(was.f)) c.fights.get(was.f).rounds = Math.max(c.fights.get(was.f).rounds, r.d?.[ROUND_FIELD] ?? 0)
      }
    }
    if (r.k === 'x') {
      const k = `${r.n} : ${String(r.err).slice(0, 120)}`
      c.errors.set(k, (c.errors.get(k) ?? 0) + 1)
    }
    if (r.k === 'h') {
      c.history++
      c.historyNames.add(r.n)
    }
    if (r.k === 'c') c.counts = r
    if (r.k === 'm') c.messages++
    if (r.k === 'm' || r.k === 'h' || r.k === 's' || r.k === 'p') for (const m of MARKS) {
      const n = line.split(`"${m}"`).length - 1
      if (n) c.marks[m] = (c.marks[m] ?? 0) + n
    }
    if (r.k === 'e' && r.ev === 'fightStart') c.fights.set(r.f, { start: r.ms, end: undefined, why: r.why, names: {}, rounds: 0, turns: 0, actions: 0 })
    if (r.k === 'e' && r.ev === 'fightEnd' && c.fights.has(r.f)) c.fights.get(r.f).end = r.ms
    if (r.k === 'm' && c.fights.has(r.f)) {
      const f = c.fights.get(r.f)
      f.names[r.n] = (f.names[r.n] ?? 0) + 1
      if (r.n === ROUND) f.rounds = Math.max(f.rounds, r.d?.[ROUND_FIELD] ?? 0)
      if (r.n === TURN) f.turns++
      if (r.n === ACTION) f.actions++
    }
  }
  if (invalid) warn(`${invalid} ligne(s) JSON invalide(s)`)
  for (const [name, c] of chars) {
    console.log(`\n${name} — script ${c.version ?? 'chargé avant cette session'}`)
    console.log(`  lignes : ${Object.entries(c.kinds).map(([k, n]) => `${k}=${n}`).join(' ')}`)
    if (c.version && c.messages === 0) warn('aucun message reçu enregistré : le script est bloqué ou ne reçoit rien (voir la console AnkaBot)')
    for (const n of c.notes) n.startsWith('⚠') ? warn(n.slice(2)) : console.log(`  ${n}`)
    if (c.completed) console.log(`  ${c.completed} ligne(s) écrite(s) avant que leurs types soient connus, complétée(s) ensuite (lignes « p »)`)
    if (c.pending.size) {
      const names = {}
      for (const v of c.pending.values()) names[v.n] = (names[v.n] ?? 0) + 1
      warn(`${c.pending.size} ligne(s) restée(s) incomplète(s) (types pas encore trouvés : AnkaBot fermé trop tôt ?) — ${Object.entries(names).map(([k, n]) => `${k}:${n}`).join(' ')}`)
    }
    if (c.timed === 0) warn('aucune ligne horodatée (« ms ») : ancien script, recharger tools/ankabot/journal-combats.lua')
    const live = c.segments.filter(x => x.last - x.first > 1).length
    if (live > 1) warn(`${live} instances du script ont enregistré en parallèle (rechargement sans redémarrer AnkaBot) : messages répartis entre elles, à remettre dans l'ordre par l'horloge « ms »`)
    const gaps = c.segments.flatMap(s => s.gaps)
    const lost = gaps.reduce((a, [x, y]) => a + y - x + 1, 0)
    if (lost) warn(`${lost} ligne(s) perdue(s) (trous de numérotation : ${gaps.slice(0, 5).map(([x, y]) => (x === y ? x : `${x}-${y}`)).join(', ')}${gaps.length > 5 ? '…' : ''})`)
    else console.log(`  numérotation continue (${c.segments.length} instance(s) du script)`)
    if (c.counts) {
      const d = c.counts.dropped ?? 0
      console.log(`  compteurs du script : ${c.counts.received} messages reçus, ${c.counts.errors} erreur(s), ${d} ligne(s) abandonnée(s), ${c.counts.types} type(s) découvert(s)`)
      if (d) warn(`${d} ligne(s) abandonnée(s) faute de récepteur (MAX_BUFFER)`)
    }
    for (const [k, n] of c.errors) warn(`erreur ×${n} — ${k}`)
    for (const [m, n] of Object.entries(c.marks)) {
      if (m === '$b64') console.log(`  ${n} champ(s) en octets bruts ($b64, décodables hors ligne)`)
      else if (m === '$more') warn(`${n} liste(s) coupée(s) ($more : MAX_ITEMS)`)
      else warn(`${n} marque(s) ${m} (données incomplètes)`)
    }
    if (c.history) console.log(`  historique d'avant le chargement : ${c.history} message(s) de ${c.historyNames.size} nom(s)`)
    for (const [i, f] of c.fights) {
      const secs = f.end !== undefined && f.start !== undefined ? ` ${Math.round((f.end - f.start) / 1000)} s,` : f.end === undefined ? ' (pas de fin),' : ''
      const top = Object.entries(f.names).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k}:${n}`).join(' ')
      console.log(`  combat ${i} (${f.why ?? '?'}) :${secs} ${f.rounds} manche(s), ${f.turns} tour(s), ${f.actions} action(s) — ${top}`)
    }
  }
}
console.log(problems ? `\n${problems} problème(s) relevé(s).` : '\nAucun problème relevé.')
process.exit(problems ? 1 : 0)
