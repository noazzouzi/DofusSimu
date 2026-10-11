// Fil de calcul du serveur de plans (serveur.ts) : garde le journal en mémoire, reconstitue l'état exact du tour en
// cours et cherche les plans, SANS bloquer le fil principal — qui reçoit les journaux AnkaBot pendant ce temps (combat
// du 2026-10-10 : calcul de 1 à 4 s sur le fil principal → envois des journaux bloqués → scripts AnkaBot occupés →
// tours passés).
//
// Messages reçus : { type: 'batch', header, lines } (un lot du journal) ; { type: 'plan', id, who, q } (une demande).
// Messages envoyés : { type: 'plan', id, text, log?, record? } (réponse, ligne de console, ligne de plans-….jsonl).
//
// Plusieurs fils (serveur.ts, REINE_FILS) : chacun reçoit tout le journal et cherche sa part du plan (workerData.part,
// formation.ts : partition par case de tir) ; le serveur garde le meilleur.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { mergeStreams } from '../../fightlog/fusion'
import { corners } from '../../fightlog/scenario'
import { BOMB } from './etat'
import { measure } from './fidelite'
import { FORMATION_PLACEMENT_2, describeStep, planFormationTurn, type FStep, type FormationState, type PlayedTurn } from './formation'
import { chainsOf, spellListOf } from './journal'

/** Attente maximale du journal (ms) par défaut, avant de planifier quand même ou de répondre « aucun ». */
const ATTENTE_MS = Number(process.env.REINE_ATTENTE_MS ?? 4000)
/** Chef du groupe : son journal est préféré, à égalité, pour les tours des autres. */
const CHEF = process.env.REINE_CHEF ?? 'Lowkey-Jealous'

type Current = { state?: [FormationState, PlayedTurn]; sources: Record<string, number> }

/** Part de la recherche de ce fil (plusieurs fils de calcul), sinon toute la recherche. */
const PART: { index: number; count: number } | undefined = workerData?.part && workerData.part.count > 1 ? workerData.part : undefined

const lines: any[] = []
let version = 0
/**
 * Oubli des combats passés (mémoire et durée de chaque reconstitution, qui relit tout le journal gardé) : à chaque
 * nouveau combat, chaque personnage ne garde que ses KEEP_BEFORE_ROUND1 lignes d'avant sa dernière manche 1
 * (placement, noms des joueurs) et la suite, plus ses lignes d'identité et de sorts. Session de 2 h du 2026-10-11 :
 * 408 632 lignes, environ 300 Mo par fil.
 */
const KEEP_BEFORE_ROUND1 = 3000
const IDENTITY = new Set(['hkk', 'hkg', 'hkh'])
/** Lignes à garder (voir KEEP_BEFORE_ROUND1) ; `lines` n'est pas modifié. */
export function keepCurrentFights(lines: readonly any[]): any[] {
  // Personnage de chaque ligne (celui du dernier en-tête qui la précède) et dernière manche 1 de chacun.
  const owner: (string | undefined)[] = new Array(lines.length)
  const lastR1 = new Map<string, number>()
  let c: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const o = lines[i]
    if (o.k === 'b') c = o.c
    owner[i] = c
    if (c && o.k === 'm' && o.n === 'jvi' && o.d?.fxjj === 1) lastR1.set(c, i)
  }
  // Première ligne gardée de chacun : KEEP_BEFORE_ROUND1 de ses lignes avant sa dernière manche 1.
  const from = new Map<string, number>()
  for (const [name, r1] of lastR1) {
    let n = 0
    let first = r1
    for (let j = r1 - 1; j >= 0 && n < KEEP_BEFORE_ROUND1; j--) {
      if (owner[j] !== name || lines[j].k === 'b') continue
      n++
      first = j
    }
    from.set(name, first)
  }
  const kept: any[] = []
  for (let i = 0; i < lines.length; i++) {
    const o = lines[i]
    const f = o.k === 'b' || owner[i] === undefined ? undefined : from.get(owner[i]!)
    if (f !== undefined && i < f && o.k === 'm' && !IDENTITY.has(o.n)) continue
    // (en-tête dont toutes les lignes sont parties : retiré)
    if (o.k === 'b' && kept.at(-1)?.k === 'b') kept.pop()
    kept.push(o)
  }
  if (kept.at(-1)?.k === 'b') kept.pop()
  return kept
}

function forgetPastFights(): void {
  const kept = keepCurrentFights(lines)
  if (kept.length === lines.length) return
  lines.length = 0
  for (const o of kept) lines.push(o)
  version++
}
let cache: (Current & { version: number }) | null = null
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/**
 * Début de tour au journal (bombe, case) avec d'autres PA/PM que ceux du script (PM retirés par un monstre, absents
 * du journal) : passé ce délai (ms), les PA/PM du script sont pris et le plan calculé. Combats du 2026-10-11 de 18:11
 * à 19:25 : 38 plans sur 582 attendaient ainsi la limite de 6 s (« journal en retard »), 5,7 s en moyenne.
 */
const AP_MP_GRACE_MS = 800
/** Premier constat de ce seul écart, par tour (personnage, manche). */
const apMpMismatchSince = new Map<string, number>()

/**
 * Dernière liste de sorts connue de chaque Crâ, d'un combat (et d'un lancement du serveur) à l'autre. Le journal ne la
 * reçoit qu'au changement de sorts, ou relue dans l'historique d'AnkaBot au chargement : le 2026-10-10 à 23:54,
 * l'historique de Lamouit ne l'avait plus ; le serveur, sans ses variantes, lui a fait lancer Flèche d'Immobilisation,
 * qu'il n'a pas (fightManagement arrêté trois fois sur ce sort en manche 10).
 */
const SPELLS_FILE = join(workerData?.logsDir ?? join(process.cwd(), 'data', 'fightlogs'), 'sorts-connus.json')
type KnownSpells = Record<string, { at: string; spells: { spellId: number; grade: number }[] }>
const knownSpells: KnownSpells = (() => {
  try {
    return existsSync(SPELLS_FILE) ? (JSON.parse(readFileSync(SPELLS_FILE, 'utf8')) as KnownSpells) : {}
  } catch {
    return {}
  }
})()
const warnedSpells = new Set<string>()

function rememberSpells(name: string, spells: { spellId: number; grade: number }[]): void {
  if (JSON.stringify(knownSpells[name]?.spells) === JSON.stringify(spells)) return
  knownSpells[name] = { at: new Date().toISOString(), spells }
  // (plusieurs fils : le premier seul écrit le fichier)
  if (PART && PART.index !== 0) return
  try {
    mkdirSync(join(SPELLS_FILE, '..'), { recursive: true })
    writeFileSync(SPELLS_FILE, JSON.stringify(knownSpells, null, 2) + '\n')
  } catch {
    // Fichier non écrit : la liste reste connue pour ce lancement du serveur.
  }
}

/** État exact du tour en cours (journal fusionné), recalculé seulement si de nouvelles lignes sont arrivées. */
function currentTurn(log: string[]): Current {
  if (cache?.version === version) return cache
  const streams = chainsOf(lines).filter(x => x.c).map(x => ({ name: x.c!, rows: x.rows }))
  const merged = mergeStreams(streams, [CHEF, ...streams.map(s => s.name).filter(n => n !== CHEF)])
  // Sorts de chaque Crâ (variantes équipées) : la liste du jeu, dans son propre journal ; à défaut, la dernière connue.
  const spellLists: Record<string, { spellId: number; grade: number }[]> = {}
  for (const s of streams) {
    const l = spellListOf(s.rows)
    if (l) {
      spellLists[s.name] = l
      rememberSpells(s.name, l)
    } else if (knownSpells[s.name]) {
      spellLists[s.name] = knownSpells[s.name].spells
      if (!warnedSpells.has(s.name)) {
        warnedSpells.add(s.name)
        log.push(`sorts de ${s.name} absents du journal : dernière liste connue (${knownSpells[s.name].at})`)
      }
    }
  }
  let state: [FormationState, PlayedTurn] | undefined
  if (merged.rows.length) {
    try {
      measure(merged.rows, { fast: true, spellLists, onCurrentTurn: (s, p) => (state = [s, p]) })
    } catch (err) {
      log.push(`reconstitution impossible : ${(err as Error).message}`)
    }
  }
  cache = { version, state, sources: merged.sources }
  return cache
}

/** Demandes à calculer tout de suite, journal à jour ou non (message « force » : demande « dernière » du script). */
const forced = new Set<number>()

async function handlePlan(who: string, q: Record<string, string>, id?: number): Promise<{ text: string; log: string[]; record?: object }> {
  const t0 = Date.now()
  const log: string[] = []
  const want = { cell: Number(q.case ?? NaN), ap: Number(q.pa ?? NaN), mp: Number(q.pm ?? NaN) }
  const wait = Number(q.attente ?? ATTENTE_MS)
  let cur: Current = { sources: {} }
  let synced = false
  // Attendre que le journal fusionné en soit au même point que le personnage (les lots arrivent entre deux essais).
  for (;;) {
    cur = currentTurn(log)
    const st = cur.state
    if (st && st[1].name === who) {
      const me = st[0].fight.fighters[st[0].active]
      const bomb = st[1].steps.length > 0 || [...st[0].bombs.values()].some(b => b.owner === st[1].gameId && b.born === st[1].round)
      const cellOk = isNaN(want.cell) || me.cell === want.cell
      const apMpOk = (isNaN(want.ap) || me.ap === want.ap) && (isNaN(want.mp) || me.mp === want.mp)
      synced = bomb && cellOk && apMpOk
      if (synced) break
      if (bomb && cellOk && st[1].steps.length === 0 && !isNaN(want.ap) && !isNaN(want.mp)) {
        const key = `${who}:${st[1].round}`
        const since = apMpMismatchSince.get(key) ?? Date.now()
        apMpMismatchSince.set(key, since)
        if (Date.now() - since >= AP_MP_GRACE_MS) {
          // Le plus petit des deux : PM retirés par un monstre absents du journal (script plus bas), ou PM réduits au
          // début du tour que fightCharacter:getMP() ne montre pas encore (journal plus bas : combat du 2026-10-12 à
          // 00:58, Lamouit à 3 PM, le script en annonçait 6 ; plan à 6 PM, bloquée hors de sa colonne, tuée par les
          // Bonbombes). Trop peu de PM coûte un peu de dégâts ; trop, le retour sur la colonne.
          const ap = Math.min(me.ap, want.ap)
          const mp = Math.min(me.mp, want.mp)
          log.push(`${who} (manche ${st[1].round}) : PA/PM du journal ${me.ap}/${me.mp}, du script ${want.ap}/${want.mp} : ${ap}/${mp} (le plus petit)`)
          me.ap = ap
          me.mp = mp
          synced = true
          break
        }
      }
    }
    if (Date.now() - t0 > wait) break
    if (id !== undefined && forced.delete(id)) {
      q = { ...q, sonde: '0' }
      break
    }
    // (lots du journal traités entre deux essais ; 25 ms : le calcul part dès qu'il est prêt)
    await sleep(25)
  }
  // Sonde (sonde=1) : pas encore synchronisé → réponse immédiate « attendre » ; le script redemande peu après, sans
  // rester bloqué dans une longue requête (2026-10-10 à 15:08 : tours clos par AnkaBot pendant l'attente).
  if (!synced && q.sonde === '1') {
    const s = cur.state
    const where = !s ? 'aucun tour de Crâ en cours' : s[1].name !== who ? `tour de ${s[1].name} en cours` : 'bombe, case ou PA/PM pas encore au journal'
    return { text: `attendre ${where}`, log }
  }
  const st = cur.state
  if (!st || st[1].name !== who) {
    const last = st ? `${st[1].name}, manche ${st[1].round}` : 'aucun'
    log.push(`${who} : pas de tour en cours dans le journal (dernier tour de Crâ vu : ${last}) après ${Date.now() - t0} ms`)
    return { text: `aucun pas de tour de ${who} en cours dans le journal (dernier : ${last})`, log }
  }
  const [state, played] = st
  // Colonne : envoyée par le script (Nom=case;…), sinon celle du Placement 2.
  const colonne: Record<string, number> = { ...FORMATION_PLACEMENT_2 }
  if (q.colonne) for (const part of q.colonne.split(';')) {
    const [n, c] = part.split('=')
    if (n && c && !isNaN(Number(c))) colonne[n.trim()] = Number(c)
  }
  for (const [name, cell] of Object.entries(colonne)) {
    const f = state.fight.fighters.find(x => x.name === name)
    if (f) state.anchors.set(state.gameIdOf.get(f.id)!, cell)
  }
  const tPlan = Date.now()
  // Sorts refusés pendant ce tour (« sort@case@depuis », envoyés par le script) : pas replanifiés.
  const forbid = new Set((q.refus ?? '').split(';').map(x => x.trim()).filter(Boolean))
  const plan = planFormationTurn(state, { top: 1, forbid, partition: PART }).plans[0]
  const me = state.fight.fighters[state.active]
  if (!plan) {
    log.push(`${who} (manche ${played.round}) : aucun plan`)
    return { text: 'aucun pas de plan trouvé', log }
  }
  const dmg = [...plan.damage.values()].reduce((a, x) => a + x, 0)
  const nova = [...plan.nova.values()].reduce((a, x) => a + x, 0)
  const out = [`plan ${Math.round(plan.score)} ${dmg} ${nova} ${plan.endCell} ${Date.now() - t0}${synced ? '' : ' desynchro'}`]
  let here = me.cell
  const byGid = new Map([...state.gameIdOf].map(([id, g]) => [g, state.fight.fighters[id]]))
  for (const x of plan.steps) {
    out.push(stepLine(x, here, byGid, state.gameIdOf.get(me.id)!))
    if (x.kind === 'move') here = x.path[x.path.length - 1]
  }
  // Recherche de la Reine sous Brume : plan de la suite à redemander après le tir (le journal dira où elle est).
  if (plan.probe) out.push(`suite reine ${plan.probe.center} ${plan.probe.covered.join(',')}`)
  out.push('fin')
  log.push(`${who} (manche ${played.round}${played.steps.length ? `, suite après ${played.steps.length} action(s)` : ''}) : ${dmg} dégâts` +
    `${nova ? ` + ${nova} explosions` : ''}, fin en ${plan.endCell}${plan.probe ? ` (recherche de la Reine sous Brume : milieu ${plan.probe.center}, ` +
      `cases possibles ${plan.probe.cells.join(',')}, couvertes ${plan.probe.covered.join(',')} ; suite redemandée)` : plan.atAnchor ? '' : ' (HORS COLONNE)'}` +
    `${synced ? '' : ' [journal en retard]'} — ` +
    `${plan.steps.map(describeStep).join(', ')}${forbid.size ? ` [refusés : ${[...forbid].join(', ')}]` : ''} (${Date.now() - t0} ms dont ${Date.now() - tPlan} de recherche ; tours pris chez ` +
    `${Object.entries(cur.sources).map(([k, v]) => `${k} ${v}`).join(', ')})`)
  const record = {
    at: new Date().toISOString(), who, round: played.round, synced, cell: me.cell, ap: me.ap, mp: me.mp, already: played.steps.length,
    score: plan.score, parts: plan.parts, damage: dmg, nova, endCell: plan.endCell, steps: plan.steps, ms: Date.now() - t0, searchMs: Date.now() - tPlan,
    hidden: state.hidden, probe: plan.probe,
  }
  return { text: out.join('\n'), log, record }
}

/** Une ligne de la réponse ; `here` = case du Crâ avant ce pas (case de départ d'un sort). */
function stepLine(x: FStep, here: number, byGid: Map<number, { kind: string; monsterId?: number }>, myGid: number): string {
  if (x.kind === 'move') return `deplacer ${x.path.join(',')} ${corners(x.path).join(',')}`
  const t = x.target !== undefined ? byGid.get(x.target) : undefined
  let kind = 'case'
  if (x.target === myGid) kind = 'soi'
  else if (t?.monsterId === BOMB) kind = 'bombe'
  else if (t?.kind === 'player') kind = 'allie'
  else if (t) kind = 'ennemi'
  const espece = kind === 'ennemi' || kind === 'bombe' ? (t?.monsterId ?? 0) : 0
  const id = kind === 'case' || kind === 'soi' ? 0 : (x.target ?? 0)
  return `sort ${x.spell} ${x.cell} ${kind} ${espece} ${id} ${here}`
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
    if (round1) forgetPastFights()
  } else if (m.type === 'force') {
    forced.add(m.id)
    // (demandes déjà finies : oubliées)
    if (forced.size > 64) forced.delete(forced.values().next().value!)
  } else if (m.type === 'plan') {
    handlePlan(m.who, m.q, m.id)
      .then(r => parentPort!.postMessage({ type: 'plan', id: m.id, ...r }))
      .catch(err => parentPort!.postMessage({ type: 'plan', id: m.id, text: `aucun erreur du serveur : ${String(err?.message ?? err).replace(/\s+/g, ' ')}`, log: [`${m.who} : ${err?.stack ?? err}`] }))
  }
})
