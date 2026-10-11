// Planificateur de tour — fonctions de la section « Reine » du simulateur web (API web/plugins/reine.ts).
// Tout est sérialisable en JSON : instantanés, carte des dangers, tours planifiés, replays (src/replay/types.ts).
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { castSpell } from '../../../src/engine/cast'
import { move, reachableCells } from '../../../src/engine/move'
import type { FightEvent } from '../../../src/engine/types'
import type { Replay } from '../../../src/replay/types'
import { simulateHorizon, spawnCell } from './bombes'
import { BOMB, DEFAULT_SPELLS, MAP_ID, ROOT, buildFight, data, type EntitySnap, type Snapshot } from './etat'
import { characters, lastBatchAt, lastFight, readStream, snapshotAt, type TurnRecord } from './journal'
import { threatsOn } from './menaces'
import { bombWorld, planTurn, type PlannedTurn, type PlanStep } from './recherche'
import { planRound, type Placed, type TeamPlan, type TeamScore } from './equipe'
import { optimizePlacement, type CellPotential, type PlacementOptions, type PlacementResult } from './placement'
import { journalSteps, simulateRound, type TurnSummary } from './round'

export const FIGHTLOG_DIR = join(ROOT, 'data', 'fightlogs')
/** PV max à 4 personnages (Reine grade 1, monstres de vague grade 5). */
const MONSTER_HP: Record<number, number> = { 3726: 15000, 3746: 6600, 3747: 6600, 3748: 3300, 3749: 6600, 3750: 6600 }
const SKIP_ACTUAL = new Set([4693, 4692, 4691, 5952, 32558, 32998])
const spellName = (id: number) => data.spell(id)?.name ?? `Sort ${id}`

// ───────────────────────────── journal ─────────────────────────────

/** Sessions du jour le plus récent de data/fightlogs (un combat peut s'étendre sur plusieurs sessions). */
export function journalFiles(): string[] {
  if (!existsSync(FIGHTLOG_DIR)) return []
  const day = readdirSync(FIGHTLOG_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1)
  if (!day) return []
  return readdirSync(join(FIGHTLOG_DIR, day)).filter(f => /^session-.*\.jsonl$/.test(f)).sort().map(f => join(FIGHTLOG_DIR, day, f))
}

export interface JournalInfo {
  day: string | null
  names: Record<number, string>
  /** Tours des Crâs du dernier combat enregistré, du plus ancien au plus récent. */
  turns: { round: number; player: number; name: string; at: string }[]
}

export interface Loaded { files: string[]; names: Record<number, string>; rows: ReturnType<typeof lastFight> }

/** Journal du jour le plus récent : noms des personnages et dernier combat (flux le plus complet). */
export function loadJournal(): Loaded | null {
  const files = journalFiles()
  if (!files.length) return null
  const chars = characters(files)
  if (!chars.size) return null
  const names: Record<number, string> = {}
  let k = 1
  for (const [id, n] of chars) names[id] = n ?? `Crâ ${k++}`
  // Flux d'un personnage qui contient le début du combat (photo de placement) et le plus de tours de Crâs : un flux
  // commencé en plein combat (script chargé en retard) ne permet pas de reconstituer les positions.
  let best: ReturnType<typeof lastFight> | null = null
  for (const id of chars.keys()) {
    const lf = lastFight(readStream(files, id))
    if (!lf.turns.length) continue
    try {
      snapshotAt(lf.rows, lf.turns[0].round, lf.turns[0].player, names)
    } catch {
      continue
    }
    if (!best || lf.turns.length > best.turns.length || (lf.turns.length === best.turns.length && lf.rows.length > best.rows.length)) best = lf
  }
  return best ? { files, names, rows: best } : null
}

export function journalInfo(): JournalInfo {
  const l = loadJournal()
  if (!l) return { day: null, names: {}, turns: [] }
  const day = l.files[0].split(/[\\/]/).at(-2) ?? null
  return { day, names: l.names, turns: l.rows.turns.map(t => ({ ...t, name: l.names[t.player] ?? String(t.player) })) }
}

/** Heure locale (HH:MM:SS) d'une heure ISO du journal. */
const clock = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
/** Au-delà, le dernier tour enregistré n'est plus « en direct ». */
const LIVE_MS = 10 * 60_000

/** Provenance de l'état affiché en mode direct (texte de la page) ; `stale` : ce n'est pas un combat en cours. */
export interface Notice { text: string; stale: boolean }

/**
 * État au début du tour d'un Crâ (journal), et ce qu'il a joué. `player` absent : mode direct — placement en cours
 * s'il y en a un, sinon début du dernier tour de Crâ enregistré, avec un avertissement s'il n'est pas récent.
 */
export function journalSnapshot(round?: number, player?: number): { snap: Snapshot; actual?: ActualTurn; notice?: Notice } {
  const l = loadJournal()
  const files = journalFiles()
  const lastAt = lastBatchAt(files)
  const live = player === undefined
  const lastTurn = l?.rows.turns.at(-1)
  if (live) {
    const p = placementSnapshot(files, l)
    if (p && (!lastTurn || p.at > lastTurn.at)) {
      return { snap: prepare(p.snap, true), notice: { text: `Placement en cours (photo AnkaBot de ${clock(p.at)}) : ordre de jeu supposé, à vérifier.`, stale: false } }
    }
  }
  if (!l || !lastTurn) throw new Error('Aucun tour de Crâ dans le journal (data/fightlogs) : chargez le script AnkaBot avant le combat.')
  const t = live ? lastTurn : l.rows.turns.find(x => x.round === round && x.player === player)
  if (!t) throw new Error(`Tour introuvable dans le journal (manche ${round}, joueur ${player})`)
  const r = snapshotAt(l.rows.rows, t.round, t.player, l.names)
  let notice: Notice | undefined
  if (live) {
    const old = Date.now() - Date.parse(t.at) > LIVE_MS
    notice = old
      ? { text: `Aucun combat en cours dans le journal : ceci est le dernier tour enregistré (${clock(t.at)}). Dernières données reçues à ${lastAt ? clock(lastAt) : '—'}.`, stale: true }
      : { text: `En direct : début du tour enregistré à ${clock(t.at)} (dernières données reçues à ${lastAt ? clock(lastAt) : '—'}).`, stale: false }
  }
  return { snap: prepare(r.snap, false), actual: describeActual(r.actual), notice }
}

/**
 * Placement d'un combat qui commence : dernière photo AnkaBot où les Crâs sont sur des cases rouges de la carte du
 * combat, prise après un début de combat signalé par AnkaBot et après le dernier début de tour de Crâ.
 */
function placementSnapshot(files: string[], l: Loaded | null): { snap: Snapshot; at: string } | null {
  const red = new Set(data.map(MAP_ID)?.redCells ?? [])
  const names = l?.names ?? {}
  let best: { row: { e?: { Id: number; CellId: number; CreatureGenericId: number; LifePoints: number; MaxLifePoints: number }[]; at: string } } | null = null
  for (const id of characters(files).keys()) {
    const rows = readStream(files, id)
    let start = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i] as { k: string; ev?: string; n?: string; d?: { fxjr?: number } }
      if (r.k === 'm' && r.n === 'jvj' && (r.d?.fxjr ?? 0) > 0) break
      if (r.k === 'e' && r.ev === 'fightStart') {
        start = i
        break
      }
    }
    if (start < 0) continue
    for (let i = rows.length - 1; i > start; i--) {
      const r = rows[i]
      if (r.k !== 's') continue
      const cras = (r.e ?? []).filter(e => e.Id > 0)
      if (cras.length >= 1 && cras.every(e => red.has(e.CellId))) {
        if (!best || r.at > best.row.at) best = { row: r as never }
        break
      }
    }
  }
  if (!best) return null
  const ents = (best.row.e ?? []).filter(e => e.CreatureGenericId !== BOMB)
  const entities: EntitySnap[] = ents.map(e =>
    e.Id > 0
      ? { name: names[e.Id] ?? `Crâ ${e.Id}`, kind: 'cra', gameId: e.Id, cell: e.CellId, hp: e.MaxLifePoints, maxHp: e.MaxLifePoints, spells: DEFAULT_SPELLS, cooldowns: {} }
      : { name: `${data.monster(e.CreatureGenericId)?.name ?? e.CreatureGenericId} ${e.Id}`, kind: 'monster', gameId: e.Id, monsterId: e.CreatureGenericId, cell: e.CellId, hp: MONSTER_HP[e.CreatureGenericId] ?? e.LifePoints, maxHp: MONSTER_HP[e.CreatureGenericId] ?? e.MaxLifePoints },
  )
  // Ordre de jeu : celui du combat précédent s'il porte sur les mêmes combattants, sinon la Reine, puis Crâs et monstres
  // en alternance (comme le 2026-10-09).
  const ids = entities.map(e => e.gameId)
  const prev = l ? snapshotAt(l.rows.rows, l.rows.turns[0].round, l.rows.turns[0].player, l.names).snap.order : []
  let order = prev.filter(id => ids.includes(id))
  if (order.length !== ids.length) {
    const cras = entities.filter(e => e.kind === 'cra').map(e => e.gameId)
    const mons = entities.filter(e => e.kind === 'monster').sort((a, b) => (a.monsterId === 3726 ? -1 : b.monsterId === 3726 ? 1 : 0)).map(e => e.gameId)
    order = []
    if (mons.length) order.push(mons.shift()!)
    while (cras.length || mons.length) {
      if (cras.length) order.push(cras.shift()!)
      if (mons.length) order.push(mons.shift()!)
    }
  }
  const active = order.find(id => id > 0) ?? entities.find(e => e.kind === 'cra')?.gameId ?? 0
  return { snap: { mapId: MAP_ID, round: 1, active, order, entities, source: `placement en cours (journal, ${clock(best.row.at)})` }, at: best.row.at }
}

export interface ActualTurn {
  casts: string[]
  endCell?: number
  damage: number
}

function describeActual(a: TurnRecord): ActualTurn {
  return {
    casts: a.casts.filter(c => !SKIP_ACTUAL.has(c.spell)).map(c => spellName(c.spell)),
    endCell: a.moves.at(-1)?.at(-1),
    damage: a.damage.reduce((s, d) => s + d.amount, 0),
  }
}

// ───────────────────────────── nouveau combat ─────────────────────────────

/**
 * Début d'un nouveau combat (manche 1, tour du 1er Crâ) : placement et ordre de jeu du combat du 2026-10-09 (Crâs en
 * 424, 410, 368, 354 ; Reine 132, Mâchassin 134, Terristocrate 178, Doublure 208 et sa copie 194). À ajuster sur la
 * carte avant de calculer. Noms et identifiants des Crâs : ceux du journal s'il y en a un.
 */
export function newFightSnapshot(): Snapshot {
  const known = loadJournal()?.names ?? {}
  const DEF: [number, string, number][] = [[900265148709, 'Java', 354], [900264624421, 'Lamouit', 368], [900264689957, 'Lowkey', 410], [900266590501, 'Kemist', 424]]
  const cras: EntitySnap[] = DEF.map(([id, name, cell]) => ({ name: known[id] ?? name, kind: 'cra', gameId: id, cell, hp: 3342, maxHp: 3342, spells: DEFAULT_SPELLS, cooldowns: {} }))
  const mon = (gameId: number, monsterId: number, cell: number, linkedTo?: number): EntitySnap => ({
    name: `${data.monster(monsterId)?.name ?? monsterId} ${gameId}`,
    kind: 'monster',
    gameId,
    monsterId,
    cell,
    hp: MONSTER_HP[monsterId],
    maxHp: MONSTER_HP[monsterId],
    linkedTo,
    owner: linkedTo,
  })
  const snap: Snapshot = {
    mapId: MAP_ID,
    round: 1,
    active: DEF[0][0],
    order: [-13, DEF[0][0], -16, -17, DEF[1][0], -15, DEF[2][0], -14, DEF[3][0]],
    entities: [...cras, mon(-13, 3726, 132), mon(-14, 3746, 134), mon(-15, 3747, 178), mon(-16, 3748, 208), mon(-17, 3748, 194, -16)],
    source: 'nouveau combat (placement du 2026-10-09)',
  }
  return prepare(snap, true)
}

/**
 * Remet en cohérence un instantané modifié : bombe de la manche courante du Crâ actif replacée selon la règle
 * d'apparition (elle apparaît au début de son tour, depuis sa case), PV bornés.
 */
export function prepare(snap: Snapshot, recomputeActiveBomb = true): Snapshot {
  const s: Snapshot = { ...snap, entities: snap.entities.map(e => ({ ...e })) }
  if (recomputeActiveBomb) {
    s.entities = s.entities.filter(e => !(e.kind === 'bomb' && e.owner === s.active && e.born === s.round))
    const me = s.entities.find(e => e.gameId === s.active)
    if (me) {
      const occupied = new Set(s.entities.map(e => e.cell))
      const world = { walk: (c: number) => !!data.map(s.mapId)?.cells[c]?.walkable, players: [], bombs: [], monsters: occupied, order: [] }
      const cell = spawnCell(world, me.cell)
      const id = Math.min(-17, ...s.entities.map(e => e.gameId)) - 1
      if (cell >= 0) s.entities.push({ name: `Bombe ${me.name}`, kind: 'bomb', gameId: id, monsterId: BOMB, cell, owner: s.active, born: s.round, blue: false })
    }
  }
  for (const e of s.entities) if (e.hp !== undefined && e.maxHp !== undefined) e.hp = Math.max(0, Math.min(e.hp, e.maxHp))
  return s
}

// ───────────────────────────── dangers ─────────────────────────────

export interface CellDanger {
  cell: number
  /** PM nécessaires pour s'y rendre depuis le début du tour. */
  mp: number
  threats: { monster: string; spell: string; from: number; viaSwap?: number }[]
  /** Le Crâ actif meurt d'une bombe d'ici son prochain tour s'il finit ici. */
  bombDeath: boolean
  /** Crâs tués par l'explosion de la fin de ce tour si le Crâ actif finit ici. */
  alliesKilled: string[]
}

/** Pour chaque case accessible au Crâ actif ce tour-ci : qui peut l'y toucher, et les bombes. */
export function dangerMap(snap: Snapshot): CellDanger[] {
  const b = buildFight(snap)
  const me = b.byGameId.get(snap.active)
  if (!me) return []
  const name = (gid: number) => snap.entities.find(e => e.gameId === gid)?.name ?? String(gid)
  const reach = reachableCells(b.fight, me, b.engine, me.mp)
  const out: CellDanger[] = []
  const home = me.cell
  for (const [cell, mp] of reach.cost) {
    const threats = threatsOn(b.engine, b.fight, me, cell)
    me.cell = cell
    const h = simulateHorizon(bombWorld(b, b.fight, snap), snap.active, snap.round)
    me.cell = home
    out.push({
      cell,
      mp,
      threats: threats.map(t => ({ monster: b.fight.fighters[t.monster].name, spell: spellName(t.spell), from: t.from, viaSwap: t.viaSwap })),
      bombDeath: h.deaths.some(d => d.id === snap.active),
      alliesKilled: h.deaths.filter(d => d.atActiveEnd && d.id !== snap.active).map(d => name(d.id)),
    })
  }
  return out
}

// ───────────────────────────── tours planifiés ─────────────────────────────

export interface WebPlan {
  total: number
  score: number
  apUsed: number
  mpUsed: number
  shootCell: number
  endCell: number
  safe: boolean
  steps: ({ kind: 'move'; path: number[] } | { kind: 'cast'; spell: number; spellName: string; cell: number; target?: string })[]
  damage: { name: string; amount: number }[]
  killed: string[]
  threats: { monster: string; spell: string; from: number; viaSwap?: number }[]
  bombDeaths: { name: string; round: number; atActiveEnd: boolean }[]
  laterDeaths: { name: string; round: number; turnOf: string }[]
}

/** Tour planifié pour la page : noms des cibles et des monstres pris dans l'instantané (identifiant moteur = index). */
function webPlan(p: PlannedTurn, snap: Snapshot): WebPlan {
  const name = (gid: number) => snap.entities.find(e => e.gameId === gid)?.name ?? String(gid)
  const cellOwner = new Map(snap.entities.map(e => [e.cell, e.name]))
  return {
    total: Math.round(p.total),
    score: Math.round(p.score),
    apUsed: Math.round(p.apUsed),
    mpUsed: Math.round(p.mpUsed),
    shootCell: p.shootCell,
    endCell: p.endCell,
    safe: p.safe,
    steps: p.steps.map(s => (s.kind === 'move' ? s : { kind: 'cast' as const, spell: s.spell, spellName: spellName(s.spell), cell: s.cell, target: s.cell === p.shootCell ? 'soi' : cellOwner.get(s.cell) })),
    damage: [...p.damage].map(([gid, amount]) => ({ name: name(gid), amount: Math.round(amount) })),
    killed: p.killed.map(name),
    threats: p.threats.map(t => ({ monster: snap.entities[t.monster]?.name ?? String(t.monster), spell: spellName(t.spell), from: t.from, viaSwap: t.viaSwap })),
    bombDeaths: p.bombDeaths.map(d => ({ name: name(d.id), round: d.round, atActiveEnd: d.atActiveEnd })),
    laterDeaths: p.laterDeaths.map(d => ({ name: name(d.id), round: d.round, turnOf: name(d.turnOf) })),
  }
}

export function planForWeb(snap: Snapshot, top = 5): { plans: WebPlan[]; unsafe: WebPlan[]; evaluated: number; ms: number } {
  const t0 = Date.now()
  const res = planTurn(snap, { top })
  const conv = (p: PlannedTurn) => webPlan(p, snap)
  return { plans: res.plans.map(conv), unsafe: res.unsafe.map(conv), evaluated: res.evaluated, ms: Date.now() - t0 }
}

// ───────────────────────────── meilleur round de l'équipe ─────────────────────────────

export interface WebTeamTurn {
  name: string
  round: number
  /** Rang du tour parmi les candidats du Crâ (0 : son meilleur tour pris seul). */
  rank: number
  plan: WebPlan | null
  /** État au début du tour du Crâ (après les tours précédents de la suite), pour la carte. */
  replay: Replay
}

export interface WebTeam {
  score: TeamScore
  turns: WebTeamTurn[]
  /** Déroulé complet (monstres compris) jusqu'au début du tour du premier Crâ de la manche suivante. */
  summaries: TurnSummary[]
  replay: Replay
  alternatives: { score: TeamScore; ranks: number[] }[]
  /** Cases de départ des Crâs. */
  placement: Placed[]
  evaluated: number
  ms: number
}

/** Meilleure suite de tours des 4 Crâs pour la manche de l'instantané (equipe.ts). */
export function teamForWeb(snap: Snapshot): WebTeam {
  return webTeam(planRound(snap))
}

function webTeam(res: TeamPlan): WebTeam {
  return {
    score: res.score,
    turns: res.turns.map(t => ({ name: t.name, round: t.round, rank: t.rank, plan: t.plan ? webPlan(t.plan, t.snapshot) : null, replay: stateReplay(t.snapshot) })),
    summaries: res.summaries,
    replay: res.replay,
    alternatives: res.alternatives.map(a => ({ score: a.score, ranks: a.turns.map(t => t.rank) })),
    placement: res.placement,
    evaluated: res.evaluated,
    ms: res.ms,
  }
}

export interface WebPlacement {
  potentials: CellPotential[]
  sets: PlacementResult['sets']
  /** Meilleur round avec le placement retenu (la Reine joue la première). */
  team: WebTeam
  /** Placement retenu, au début du tour du premier Crâ (à charger dans la page). */
  snapshot: Snapshot
  ms: number
}

/** Meilleur placement des Crâs pour les positions des monstres de l'instantané (placement.ts). */
export function placementForWeb(snap: Snapshot, opts?: PlacementOptions): WebPlacement {
  const res = optimizePlacement(snap, opts)
  const first = res.snapshot.order.find(g => res.snapshot.entities.some(e => e.gameId === g && e.kind === 'cra'))!
  return { potentials: res.potentials, sets: res.sets, team: webTeam(res.best), snapshot: prepare({ ...res.snapshot, active: first }, true), ms: res.ms }
}

// ───────────────────────────── replays ─────────────────────────────

function meta(snap: Snapshot, title: string) {
  return { title, description: snap.source ?? '' }
}

/** Replay réduit à l'état de l'instantané (affichage de la carte). */
export function stateReplay(snap: Snapshot): Replay {
  const b = buildFight(snap)
  return { events: b.fight.events.slice(0, 1), map: b.fight.map, meta: meta(snap, 'Reine des Voleurs') }
}

/**
 * Replay d'un tour planifié : le tour du Crâ actif joué par le moteur, puis les explosions de bombes de la fin de son
 * tour (modèle bombes.ts) sous forme de morts.
 */
export function planReplay(snap: Snapshot, steps: PlanStep[], title: string): Replay {
  const b = buildFight(snap)
  const { engine, fight } = b
  const me = b.byGameId.get(snap.active)!
  const ev: FightEvent[] = fight.events
  ev.push({ t: 'roundStart', round: snap.round }, { t: 'turnStart', fighter: me.id, ap: me.ap, mp: me.mp })
  for (const s of steps) {
    if (s.kind === 'move') move(fight, me, s.path[0] === me.cell ? s.path : [me.cell, ...s.path.slice(1)], engine)
    else castSpell(engine, fight, me, s.spell, s.cell)
  }
  ev.push({ t: 'turnEnd', fighter: me.id })
  const h = simulateHorizon({ ...bombWorld(b, fight, snap), order: [snap.active] }, snap.active, snap.round)
  for (const e of h.events) {
    if (e.kind !== 'explode' && e.kind !== 'death') continue
    const f = b.byGameId.get(e.who)
    if (f && f.alive) {
      f.alive = false
      ev.push({ t: 'death', target: f.id })
    }
  }
  return { events: ev, map: fight.map, meta: meta(snap, title) }
}

// ───────────────────────────── round complet ─────────────────────────────

/**
 * Manche `round` du dernier combat du journal rejouée depuis le début du tour de la Reine : actions réelles des Crâs
 * (cibles suivies), monstres simulés (monstres.ts), bombes et PV partagés (round.ts). Résumé de chaque tour avec la
 * case de fin réelle quand le journal la donne.
 */
export function journalRound(round: number): { replay: Replay; turns: (TurnSummary & { realEnd?: number })[]; deaths: string[] } {
  const l = loadJournal()
  if (!l) throw new Error('Journal vide')
  const rows = l.rows.rows
  const any = l.rows.turns.find(t => t.round === round)
  if (!any) throw new Error(`Manche ${round} absente du journal`)
  const queen = snapshotAt(rows, round, any.player, l.names).snap.entities.find(e => e.monsterId === 3726)
  if (!queen) throw new Error('Reine absente du journal')
  const start = snapshotAt(rows, round, queen.gameId, l.names)
  const res = simulateRound(start.snap, { craSteps: journalSteps(rows, l.names), title: `Manche ${round} : vos actions, monstres simulés` })
  const turns = res.turns.map(t => {
    try {
      const r = snapshotAt(rows, t.round, t.gameId, l.names)
      return { ...t, realEnd: r.actual.moves.at(-1)?.at(-1) ?? r.snap.entities.find(e => e.gameId === t.gameId)?.cell }
    } catch {
      return t
    }
  })
  return { replay: res.replay, turns, deaths: res.deaths }
}
