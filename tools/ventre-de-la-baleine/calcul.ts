// Fil de calcul du serveur de plans du Ventre de la Baleine (serveur.ts) : garde le journal en mémoire, reconstitue
// l'état exact du tour en cours (journaux des 4 Crâs fusionnés, etat.ts), cherche le tour (planificateur.ts) ou le
// placement (placement.ts), sans bloquer le fil principal qui reçoit les journaux.
// Aussi celui du Féca contre les Krobes (tools/feca/serveur.ts) : planificateur choisi par la race du personnage
// (tools/feca/planificateur.ts pour un Féca) ; personnage seul, l'état envoyé par son script recale celui du journal.
//
// Messages reçus : { type: 'batch', header, lines } ; { type: 'plan', id, who, q } ; { type: 'placement', id, who, q } ;
// { type: 'force', id }. Messages envoyés : { type: 'plan' | 'placement', id, text, log?, record? }.
// Même protocole que le serveur de la Reine (tools/reine-des-voleurs/planificateur/serveur-calcul.ts).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'
import type { MapData } from '../../src/data/model'
import { mergeStreams } from '../fightlog/fusion'
import { MSG } from '../fightlog/rejeu'
import { corners } from '../fightlog/scenario'
import { data } from '../reine-des-voleurs/planificateur/etat'
import { chainsOf, keepCurrentFights, spellListOf } from '../reine-des-voleurs/planificateur/journal'
import type { FStep } from '../reine-des-voleurs/planificateur/formation'
import { ELEMENTS_TUEUSES, FECA, PLAN_RAPIDE } from '../feca/feca'
import { caseTueuse, ordreDesMules } from '../feca/placement'
import { planTourFeca } from '../feca/planificateur'
import { appliquerVariantes, lireVariantes } from '../feca/variantes'
import { appliquerEtatDirect, etatCombat, lireEtatDirect, type EtatCombat } from './etat'
import { moteurDuTour } from './moteur'
import { placementBaleine } from './placement'
import { decrirePas, planTourBaleine } from './planificateur'

const ATTENTE_MS = Number(process.env.BALEINE_ATTENTE_MS ?? 4000)
const CHEF = process.env.BALEINE_CHEF ?? 'Lowkey-Jealous'
/** Carte par défaut (salle 1) quand le script ne la donne pas. */
const CARTE_DEFAUT = 140771332
const PART: { index: number; count: number } | undefined = workerData?.part && workerData.part.count > 1 ? workerData.part : undefined
/**
 * Serveur du Féca (tools/feca/serveur.ts) : personnages joués, les autres du groupe sont des mules. Leurs journaux sont
 * complets (messages du silence mis en file, QUIET_QUEUE) : l'état vient du plus récent, pris seul, sans fusion.
 */
const JOUEURS_SERVIS: string[] | undefined = Array.isArray(workerData?.joueurs) ? workerData.joueurs : undefined
/** Tueuses (serveur du Féca, TUEUSES) : placées avec les mules, elles les tuent puis vont mourir (planTourBaleine, tueuse). */
const TUEUSES_SERVIES: string[] = Array.isArray(workerData?.tueuses) ? workerData.tueuses : []

const lines: any[] = []
let version = 0
/** Version du dernier lot reçu de chaque personnage (journal le plus récent). */
const lastBatch = new Map<string, number>()
let lastMap = CARTE_DEFAUT
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const SPELLS_FILE = join(workerData?.logsDir ?? join(process.cwd(), 'data', 'fightlogs'), 'sorts-connus.json')
/** Variantes équipées déclarées par personnage (tools/feca/variantes.ts) : la liste du jeu n'a que les sorts de base. */
const VARIANTES_FILE = join(SPELLS_FILE, '..', 'variantes.json')
type KnownSpells = Record<string, { at: string; spells: { spellId: number; grade: number }[] }>
const knownSpells: KnownSpells = (() => {
  try {
    return existsSync(SPELLS_FILE) ? (JSON.parse(readFileSync(SPELLS_FILE, 'utf8')) as KnownSpells) : {}
  } catch {
    return {}
  }
})()
function rememberSpells(name: string, spells: { spellId: number; grade: number }[]): void {
  if (JSON.stringify(knownSpells[name]?.spells) === JSON.stringify(spells)) return
  knownSpells[name] = { at: new Date().toISOString(), spells }
  if (PART && PART.index !== 0) return
  try {
    mkdirSync(join(SPELLS_FILE, '..'), { recursive: true })
    // (relu avant d'écrire : le serveur de la Reine, lancé en même temps, écrit le même fichier pour ses Crâs)
    const disk = existsSync(SPELLS_FILE) ? (JSON.parse(readFileSync(SPELLS_FILE, 'utf8')) as KnownSpells) : {}
    writeFileSync(SPELLS_FILE, JSON.stringify({ ...disk, [name]: knownSpells[name] }, null, 2) + '\n')
  } catch {
    // (liste gardée pour ce lancement du serveur)
  }
}

type Current = { st?: EtatCombat; spells: Record<string, { spellId: number; grade: number }[]>; names: Map<number, string>; error?: string }
let cache: (Current & { version: number; mapId: number }) | null = null

/**
 * État exact du combat en cours (journaux fusionnés), recalculé seulement si de nouvelles lignes sont arrivées.
 * `fresh` : recalculé quand même (l'état sera recalé sur celui du script, qui ne doit pas rester dans le cache).
 */
function current(mapId: number, fresh = false): Current {
  if (!fresh && cache?.version === version && cache.mapId === mapId) return cache
  const chains = chainsOf(lines).filter(x => x.c)
  const streams = chains.map(x => ({ name: x.c!, rows: x.rows }))
  // (un seul journal, personnage seul : pris tel quel — la fusion prend chaque tour chez un personnage qui ne le joue pas,
  // elle perdait les tours du Féca et le début de manche qui les ouvre ; 2026-10-17 : 3 à 6 s d'attente à chaque tour)
  const merged = streams.length === 1 ? { rows: streams[0].rows }
    : JOUEURS_SERVIS ? { rows: streams.reduce((a, b) => ((lastBatch.get(b.name) ?? 0) > (lastBatch.get(a.name) ?? 0) ? b : a)).rows }
    : mergeStreams(streams, [CHEF, ...streams.map(s => s.name).filter(n => n !== CHEF)])
  const spells: Current['spells'] = {}
  for (const s of streams) {
    const l = spellListOf(s.rows)
    if (l) {
      spells[s.name] = l
      rememberSpells(s.name, l)
    } else if (knownSpells[s.name]) spells[s.name] = knownSpells[s.name].spells
  }
  for (const [n, v] of Object.entries(knownSpells)) spells[n] ??= v.spells
  for (const [n, v] of Object.entries(lireVariantes(VARIANTES_FILE))) if (spells[n]) spells[n] = appliquerVariantes(spells[n], v)
  const names = new Map<number, string>()
  for (const c of chains) if (c.owner !== undefined && c.c) names.set(c.owner, c.c)
  let st: EtatCombat | undefined
  let error: string | undefined
  if (merged.rows.length) {
    try {
      st = etatCombat(merged.rows, { mapId })
    } catch (err) {
      error = (err as Error).message
    }
  }
  const out = { version, mapId, st, spells, names, error }
  if (!fresh) cache = out
  return out
}

const forced = new Set<number>()

/**
 * Carte du combat absente de data/maps : téléchargée depuis DofusDB (scripts/fetch-maps.mjs, quelques secondes), par le
 * premier fil seulement (les autres attendent le fichier). 2026-10-14 : la carte de la salle annexe (140773380)
 * manquait, ni placement ni plan, tous les tours passés, combat perdu.
 */
const FETCH_SCRIPT = join(fileURLToPath(new URL('../../', import.meta.url)), 'scripts', 'fetch-maps.mjs')
const fetchTried = new Set<number>()
async function ensureMap(mapId: number, log: string[]): Promise<MapData | undefined> {
  const known = data.map(mapId)
  if (known) return known
  if (PART && PART.index !== 0) {
    for (let waited = 0; waited < 60_000; waited += 250) {
      await sleep(250)
      const m = data.map(mapId)
      if (m) return m
    }
    return undefined
  }
  if (fetchTried.has(mapId)) return undefined
  fetchTried.add(mapId)
  try {
    execFileSync(process.execPath, [FETCH_SCRIPT, '--map', String(mapId)], { stdio: 'pipe', timeout: 60_000 })
    log.push(`carte ${mapId} absente : téléchargée depuis DofusDB`)
  } catch (err) {
    log.push(`carte ${mapId} absente : téléchargement impossible (${String((err as Error).message).split(/\r?\n/)[0]})`)
  }
  return data.map(mapId)
}

async function handlePlan(who: string, q: Record<string, string>, id?: number): Promise<{ text: string; log: string[]; record?: object }> {
  const t0 = Date.now()
  const log: string[] = []
  // Plan rapide (PLAN_RAPIDE du script, Féca) : le premier fil seul, sur toutes les cases de tir, réglages réduits ; le
  // script n'en joue que le premier pas, puis demande le plan complet.
  const rapide = q.rapide === '1'
  if (rapide && PART && PART.index !== 0) return { text: 'aucun plan rapide : premier fil seulement', log }
  const want = { cell: Number(q.case ?? NaN), ap: Number(q.pa ?? NaN), mp: Number(q.pm ?? NaN) }
  const mapId = Number(q.carte) > 0 ? Number(q.carte) : lastMap
  lastMap = mapId
  const wait = Number(q.attente ?? ATTENTE_MS)
  // Personnage seul (ENVOYER_ETAT) : son journal se tait pendant son tour, l'état visible qu'il envoie fait foi.
  const direct = lireEtatDirect(q)
  let cur: Current = { spells: {}, names: new Map() }
  let synced = false
  let mine: number | undefined
  for (;;) {
    cur = current(mapId)
    const st = cur.st
    if (st && direct) {
      // Synchronisé dès que le journal a reçu la manche en cours et n'est plus au milieu du tour d'un autre combattant
      // (fin du tour du dernier monstre reçue).
      const me = st.res.fighters.find(f => f.kind === 'player' && f.name === who)
      if (me) {
        mine = me.id
        synced = (st.current === undefined || st.current === mine) && (direct.manche === undefined || st.round >= direct.manche)
        if (synced) break
      }
    } else if (st && st.current !== undefined && st.res.fighters[st.current]?.name === who) {
      mine = st.current
      const cell = st.truth.cell.get(mine)
      synced = isNaN(want.cell) || cell === want.cell
      if (synced) break
    }
    if (Date.now() - t0 > wait) break
    if (id !== undefined && forced.delete(id)) {
      q = { ...q, sonde: '0' }
      break
    }
    await sleep(25)
  }
  if (!synced && q.sonde === '1') {
    const st = cur.st
    const where = !st ? (cur.error ?? 'aucun combat') : st.current === undefined ? 'aucun tour en cours' : `tour de ${st.res.fighters[st.current]?.name} en cours`
    return { text: `attendre ${where}`, log }
  }
  // (état recalé sur celui du script : une copie, hors du cache)
  if (direct && cur.st && mine !== undefined) cur = current(mapId, true)
  const st = cur.st
  if (!st || mine === undefined) {
    log.push(`${who} : pas de tour en cours dans le journal (${cur.error ?? (st?.current !== undefined ? `tour de ${st.res.fighters[st.current]?.name}` : 'aucun')})`)
    return { text: `aucun pas de tour de ${who} en cours dans le journal`, log }
  }
  if (!(await ensureMap(mapId, log))) return { text: `aucun carte ${mapId} absente de data/maps et introuvable sur DofusDB`, log }
  const tPlan = Date.now()
  const forbid = new Set((q.refus ?? '').split(';').map(x => x.trim()).filter(Boolean))
  const obstacles = direct ? appliquerEtatDirect(st, mine, direct).obstacles : undefined
  const mo = moteurDuTour(st, mine, { ap: isNaN(want.ap) ? undefined : want.ap, mp: isNaN(want.mp) ? undefined : want.mp,
    cell: isNaN(want.cell) ? undefined : want.cell, spells: cur.spells, obstacles })
  const feca = st.res.fighters[mine]?.breedId === FECA
  const res = feca ? planTourFeca(st, mo, rapide ? { forbid, ...PLAN_RAPIDE } : { forbid, partition: PART })
    : planTourBaleine(st, mo, { forbid, partition: rapide ? undefined : PART, joueurs: JOUEURS_SERVIS, tueuse: TUEUSES_SERVIES.includes(who),
      elements: TUEUSES_SERVIES.includes(who) ? ELEMENTS_TUEUSES : undefined })
  const plan = res.plans[0]
  if (!plan) {
    log.push(`${who}${rapide ? ' [plan rapide]' : ''} (manche ${st.round}) : aucun plan`)
    return { text: 'aucun pas de plan trouvé', log }
  }
  const me = mo.fight.fighters[mo.me]
  const malamibe = Object.entries(plan.parts).find(([k]) => k === 'malamibe')?.[1] ?? 0
  const out = [`plan ${plan.score} ${Math.round(malamibe)} 0 ${plan.endCell} ${Date.now() - t0}${synced ? '' : ' desynchro'}`]
  let here = me.cell
  for (const x of plan.steps) {
    out.push(stepLine(x, here, st))
    if (x.kind === 'move') here = x.path[x.path.length - 1]
  }
  out.push('fin')
  const name = (sid: number) => sid === 0 ? "Coup d'arme" : data.spell(sid)?.name ?? String(sid)
  log.push(`${who}${rapide ? " [plan rapide]" : ""} (manche ${st.round}${st.turnCasts.length ? `, suite après ${st.turnCasts.length} sort(s)` : ''}) : ` +
    `${plan.steps.map(x => decrirePas(x, name)).join(', ')} → fin ${plan.endCell} — note ${plan.score} ` +
    `(${Object.entries(plan.parts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')})` +
    `${plan.notes.length ? ' ⚠ ' + plan.notes.join(' ; ') : ''}${synced ? '' : ' [journal en retard]'}` +
    `${forbid.size ? ` [refusés : ${[...forbid].join(', ')}]` : ''} (${Date.now() - t0} ms dont ${Date.now() - tPlan} de recherche)`)
  // (état envoyé par le script d'un personnage seul : de quoi rejouer le tour, tools/feca/rejouer.ts)
  const record = { at: new Date().toISOString(), who, round: st.round, synced, cell: me.cell, ap: me.ap, mp: me.mp, score: plan.score,
    parts: plan.parts, notes: plan.notes, endCell: plan.endCell, steps: plan.steps, ms: Date.now() - t0, ...(rapide ? { rapide: true } : {}), etat: direct, carte: mapId,
    refus: forbid.size ? [...forbid] : undefined }
  return { text: out.join('\n'), log, record }
}

/** Une ligne de la réponse (format du serveur de la Reine, lu par le script AnkaBot). */
function stepLine(x: FStep, here: number, st: EtatCombat): string {
  if (x.kind === 'move') return `deplacer ${x.path.join(',')} ${corners(x.path).join(',')}`
  const t = x.target !== undefined ? st.res.fighters[x.target] : undefined
  let kind = 'case'
  if (t && t.id === st.current) kind = 'soi'
  else if (t?.kind === 'player') kind = 'allie'
  else if (t) kind = 'ennemi'
  const espece = kind === 'ennemi' ? (t?.monsterId ?? 0) : 0
  const gid = kind === 'case' || kind === 'soi' ? 0 : (t?.gameId ?? 0)
  return `sort ${x.spell} ${x.cell} ${kind} ${espece} ${gid} ${here}`
}

/**
 * Répartition calculée pour un combat (carte, monstres, cases) : les 4 Crâs demandent leur case l'un après l'autre et
 * doivent recevoir la même répartition, même si la liste des tours arrive entre deux demandes. `given` : cases déjà
 * données (gardées si un Crâ absent de la répartition demande la sienne).
 */
const placements = new Map<string, { at: number; cells: Record<string, number>; given: Record<string, number>; log: string }>()
const PLACEMENT_MS = 180_000

/**
 * Placement : monstres « espèce@case;… », cases de placement « case,… » ; ordre de jeu : dernière liste des tours.
 * Réponse « case <la mienne> <cases de tous les Crâs> ».
 */
async function handlePlacement(who: string, q: Record<string, string>): Promise<{ text: string; log: string[] }> {
  const log: string[] = []
  const mapId = Number(q.carte) > 0 ? Number(q.carte) : lastMap
  lastMap = mapId
  const map = await ensureMap(mapId, log)
  if (!map) return { text: `aucun carte ${mapId} absente de data/maps et introuvable sur DofusDB`, log }
  const monsters = (q.monstres ?? '').split(';').filter(Boolean).map(x => x.split('@').map(Number)).map(([monsterId, cell]) => ({ monsterId, cell }))
  const cells = (q.cases ?? '').split(',').filter(Boolean).map(Number)
  const key = `${mapId}|${q.monstres ?? ''}|${[...cells].sort((a, b) => a - b).join(',')}`
  let known = placements.get(key)
  if (known && Date.now() - known.at >= PLACEMENT_MS) known = undefined
  if (known && known.cells[who] !== undefined) {
    known.given[who] = known.cells[who]
    log.push(`placement de ${who} : ${known.cells[who]} (répartition déjà calculée : ${known.log})`)
    return { text: `case ${known.cells[who]} ${Object.values(known.cells).join(',')}`, log }
  }
  const chains = chainsOf(lines).filter(x => x.c)
  const names = new Map<number, string>()
  // (tueuses : placées avec les mules, comme elles)
  for (const c of chains) if (c.owner !== undefined && c.c && !TUEUSES_SERVIES.includes(c.c)) names.set(c.owner, c.c)
  // Dernière liste des tours (phase de placement) : nos Crâs par leur identifiant, les monstres (identifiants négatifs) ;
  // les autres personnages (mules, sans journal ; tueuses) ne comptent pas.
  let timeline: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i]
    if (o.k !== 'm' || o.n !== MSG.turnList || !Array.isArray(o.d?.fxlo)) continue
    timeline = o.d.fxlo.map((x: any) => x?.fxkv?.fxld).filter((g: unknown) => typeof g === 'number' && (names.has(g) || g < 0))
      .map((g: number) => (names.has(g) ? `cra:${names.get(g)}` : 'monstre'))
    break
  }
  const crasKnown = timeline.filter(x => x.startsWith('cra:')).map(x => x.slice(4))
  if (q.mule === '1') {
    // (Fécas : ceux de l'ordre de jeu, sinon tous ceux qui ont un journal, dans l'ordre de repli de leur propre demande)
    const fecas = crasKnown.length ? crasKnown : [...new Set(names.values())]
    const tl = crasKnown.length ? timeline : [...monsters.map(() => 'monstre'), ...fecas.map(n => `cra:${n}`)]
    return placeMule(who, { key, known, map, monsters, cells, timeline: tl, crasKnown: fecas, log })
  }
  if (!crasKnown.includes(who)) {
    // Ordre inconnu : les monstres d'abord (le Pataugerme a joué en premier le 2026-10-14), puis les Crâs.
    const all = [...new Set([...crasKnown, ...names.values(), who])]
    timeline = [...monsters.map(() => 'monstre'), ...all.map(n => `cra:${n}`)]
  }
  if (!monsters.length || !cells.length) return { text: 'aucun monstres ou cases de placement manquants', log }
  const given = { ...known?.given }
  const res = placementBaleine({ map, monsters, cells, timeline, fixed: given, eloigner: !!JOUEURS_SERVIS })
  const cell = res.cells[who]
  const summary = `${res.notes.join(' ; ')} — note ${res.score}`
  log.push(`placement (carte ${mapId}, ordre ${timeline.map(x => (x === 'monstre' ? 'M' : x.slice(4))).join(' ')}) : ${summary}`)
  if (cell === undefined) return { text: `aucun ${who} absent de l'ordre de jeu`, log }
  const all = { ...given, ...res.cells }
  placements.set(key, { at: Date.now(), cells: all, given: { ...given, [who]: cell }, log: summary })
  return { text: `case ${cell} ${Object.values(all).join(',')}`, log }
}

/**
 * Case d'une mule du Féca (q.mule=1, tools/feca/placement.ts) : la suivante du groupe des mules, après la case des
 * Fécas (calculée d'abord s'ils ne l'ont pas encore demandée, et gardée pour eux).
 */
function placeMule(who: string, c: {
  key: string; known?: { at: number; cells: Record<string, number>; given: Record<string, number>; log: string }; map: MapData
  monsters: { monsterId: number; cell: number }[]; cells: number[]; timeline: string[]; crasKnown: string[]; log: string[]
}): { text: string; log: string[] } {
  const { key, known, map, monsters, cells, timeline, crasKnown, log } = c
  if (!monsters.length || !cells.length) return { text: 'aucun monstres ou cases de placement manquants', log }
  const all: Record<string, number> = { ...known?.cells }
  const given = { ...known?.given }
  let summary = known?.log ?? ''
  if (crasKnown.length && !crasKnown.every(n => all[n] !== undefined)) {
    const res = placementBaleine({ map, monsters, cells, timeline, fixed: given, eloigner: !!JOUEURS_SERVIS })
    Object.assign(all, res.cells)
    summary = `${res.notes.join(' ; ')} — note ${res.score}`
  }
  const fecas = crasKnown.map(n => all[n]).filter((x): x is number => x !== undefined)
  const { ordre, centre, couvertes } = ordreDesMules(map, monsters, cells, fecas)
  const taken = new Set(Object.values(all))
  // (tueuse : à portée de ses sorts de zone du groupe des mules, hors du groupe)
  const tueuse = TUEUSES_SERVIES.includes(who)
  const cell = tueuse ? caseTueuse(monsters, ordre, taken, centre, ordre.slice(0, couvertes)) : ordre.find(x => !taken.has(x))
  log.push(`placement de ${tueuse ? 'la tueuse' : 'la mule'} ${who} : ${cell ?? 'aucune case'} (groupe des mules autour de ${centre}, ${couvertes} case(s) ; Féca ${fecas.join(',') || '?'})`)
  if (cell === undefined) return { text: 'aucun plus de case libre pour les mules', log }
  all[who] = cell
  placements.set(key, { at: Date.now(), cells: all, given: { ...given, [who]: cell }, log: summary })
  return { text: `case ${cell} ${Object.values(all).join(',')}`, log }
}

parentPort?.on('message', (m: any) => {
  if (m.type === 'batch') {
    lines.push(m.header)
    let round1 = false
    for (const o of m.lines) {
      lines.push(o)
      if (o.k === 'm' && o.n === 'jvi' && o.d?.fxjj === 1) round1 = true
    }
    version++
    if (typeof m.header?.c === 'string') lastBatch.set(m.header.c, version)
    if (round1) {
      const kept = keepCurrentFights(lines)
      if (kept.length !== lines.length) {
        lines.length = 0
        for (const o of kept) lines.push(o)
      }
    }
  } else if (m.type === 'force') {
    forced.add(m.id)
    if (forced.size > 64) forced.delete(forced.values().next().value!)
  } else if (m.type === 'plan') {
    handlePlan(m.who, m.q, m.id)
      .then(r => parentPort!.postMessage({ type: 'plan', id: m.id, ...r }))
      .catch(err => parentPort!.postMessage({ type: 'plan', id: m.id, text: `aucun erreur du serveur : ${String(err?.message ?? err).replace(/\s+/g, ' ')}`, log: [`${m.who} : ${err?.stack ?? err}`] }))
  } else if (m.type === 'placement') {
    // (un seul fil répond au placement : le premier)
    if (PART && PART.index !== 0) return
    handlePlacement(m.who, m.q)
      .then(r => parentPort!.postMessage({ type: 'placement', id: m.id, ...r }))
      .catch((err: any) => parentPort!.postMessage({ type: 'placement', id: m.id, text: `aucun erreur du serveur : ${String(err?.message ?? err)}`, log: [String(err?.stack ?? err)] }))
  }
})
