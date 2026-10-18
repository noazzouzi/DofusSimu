// Lecture du journal AnkaBot (data/fightlogs, tools/ankabot/journal-combats.lua) : flux des messages d'un personnage
// sur plusieurs sessions, et instantané du combat au début du tour d'un Crâ.
//
// Les noms des messages et des champs sont obfusqués et changent quand Ankama les renouvelle : ils sont tous réunis
// dans PROTO ci-dessous (relevés le 2026-10-09). Après une rotation, il faut les relever à nouveau dans un journal.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { CELL_COUNT, distance } from '../../../src/map/geometry'
import { comparePositions } from '../../../src/engine/effects/summons'
import { BOMB, DEFAULT_SPELLS, MAP_ID, data, monsterCooldowns, type EntitySnap, type Snapshot } from './etat'

/** Dictionnaire du protocole (version du 2026-10-09). */
export const PROTO = {
  round: 'jvi', // fxjj = numéro de manche
  turnStart: 'jvj', // fxjr = combattant qui commence son tour
  turnEnd: 'jup', // fxgo = combattant qui finit son tour
  move: 'jnz', // fwab = chemin (cases), fwaf = combattant
  action: 'jsq', // fwuv = numéro d'action, fwuw = auteur ; une seule variante remplie :
  //   fwuy sort lancé (fwqq case, fwqr cible, fwqu.fwpu sort) ; fwwd dégâts (fwsf cible, fwsg PV, fwsa érosion, fwse
  //   élément) ; fwvj PA/PM (fwpj cible, fwpi variation) ; fwvb glissade (fwsr cible, fwss départ, fwst arrivée) ;
  //   fwva échange (fwog autre, fwoh case de l'auteur, fwoi case de l'autre) ; fwvp téléportation (fwoc cible, fwob
  //   case) ; fwuz mort (fwrl cible) ; fwvi invocation (fwnc.fwmv[0].fwmk.fwjd.fwie monstre ; fwmp[0].gdnt : gcaw
  //   identifiant, gcax.gblc case — champs « g » absents des journaux d'avant le 2026-10-09 12:35) ; fwvm apparence
  //   (fwnx cible, fwnw.gbmq 2866 = Bonbombe bleue).
  privateMods: ['hkk', 'hkg'], // modificateurs de sorts, reçus par le seul personnage concerné (fnwm / fnvm)
  // Sorts du personnage (variantes équipées comprises) : fnvq[] { fnve sort, fnvh grade }. Reçu à la connexion (ligne
  // « h » d'historique du journal), puis à chaque changement.
  spellList: 'hkh',
}

/** Sorts du personnage du flux (dernière liste reçue, variantes comprises), ou undefined. */
export function spellListOf(rows: Row[]): { spellId: number; grade: number }[] | undefined {
  for (let k = rows.length - 1; k >= 0; k--) {
    const r = rows[k]
    if ((r.k !== 'm' && r.k !== 'h') || r.n !== PROTO.spellList || !Array.isArray(r.d?.fnvq)) continue
    return r.d.fnvq.filter((x: any) => typeof x?.fnve === 'number' && x.fnve > 0).map((x: any) => ({ spellId: x.fnve, grade: x.fnvh ?? 1 }))
  }
  return undefined
}
export const BLUE_LOOK = 2866
const PECHE_MIGNON = new Set([4693, 4692, 4691])

export interface Row { k: string; i?: number; n?: string; d?: any; at: string; c?: string; e?: any[]; turn?: number; ms?: number; in?: string; of?: number; map?: number }

/**
 * Lignes d'un fichier, avec l'heure de leur lot et le personnage (lots nommés) ou une chaîne de numéros. Depuis le
 * script du 2026-10-10b : les lignes « p » complètent le contenu des lignes m/h écrites avec des {"$pending":…} (même
 * instance du script), et les lignes de plusieurs instances d'un même personnage sont remises dans l'ordre de leur
 * horloge « ms ».
 */
/**
 * Lignes JSON d'un fichier, lues par morceaux : une session dépasse 512 Mo (2026-10-13 : 560 Mo), trop pour une seule
 * chaîne. Dernière ligne incomplète (session en cours d'écriture) : ignorée.
 */
export function readJsonLines(file: string): any[] {
  const out: any[] = []
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(16 * 1024 * 1024)
    let rest = Buffer.alloc(0)
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n <= 0) break
      const chunk = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n)
      let start = 0
      for (let i = chunk.indexOf(10); i >= 0; i = chunk.indexOf(10, start)) {
        const line = chunk.toString('utf8', start, i).trim()
        if (line) out.push(JSON.parse(line))
        start = i + 1
      }
      rest = Buffer.from(chunk.subarray(start))
    }
    const last = rest.toString('utf8').trim()
    if (last) {
      try {
        out.push(JSON.parse(last))
      } catch {
        // (ligne en cours d'écriture)
      }
    }
  } finally {
    closeSync(fd)
  }
  return out
}

function chains(file: string) {
  return chainsOf(readJsonLines(file))
}

/** Chaîne d'un journal (une instance de script) : ses lignes, son personnage. */
export type Chain = ReturnType<typeof chainsOf>[number]

/** Lecture des chaînes d'un fichier, une seule fois par fichier (plusieurs passes sur une session de 500 Mo). */
export function chainsReader(): (file: string) => Chain[] {
  const cache = new Map<string, Chain[]>()
  return file => {
    let c = cache.get(file)
    if (!c) cache.set(file, (c = chains(file)))
    return c
  }
}

/** Comme `chains`, sur les lignes déjà lues (lignes de lot « b » comprises) : journal gardé en mémoire (serveur). */
export function chainsOf(lines: any[]) {
  const batches: { at: string; c?: string; in?: string; rows: Row[] }[] = []
  for (const o of lines) {
    if (o.k === 'b') batches.push({ at: o.at ?? batches.at(-1)?.at ?? '', c: o.c, in: o.in, rows: [] })
    else batches.at(-1)?.rows.push(o)
  }
  for (const b of batches) for (const r of b.rows) r.in = b.in
  const inst: { c?: string; last: number; rows: Row[]; owner?: number }[] = []
  for (const b of batches) {
    const nums = b.rows.filter(r => typeof r.i === 'number')
    if (!nums.length) continue
    let k = b.c ? inst.findIndex(x => x.c === b.c) : inst.findIndex(x => !x.c && x.last + 1 === nums[0].i)
    if (k < 0) {
      inst.push({ c: b.c, last: 0, rows: [] })
      k = inst.length - 1
    }
    for (const r of b.rows) r.at = b.at
    inst[k].rows.push(...b.rows)
    inst[k].last = nums.at(-1)!.i!
  }
  for (const x of inst) {
    const byNum = new Map<string, Row>()
    for (const r of x.rows) if ((r.k === 'm' || r.k === 'h') && typeof r.i === 'number') byNum.set(`${r.in}:${r.i}`, r)
    for (const r of x.rows) {
      const target = r.k === 'p' && typeof r.of === 'number' ? byNum.get(`${r.in}:${r.of}`) : undefined
      if (target) target.d = r.d
    }
    if (new Set(x.rows.map(r => r.in)).size > 1 && x.rows.every(r => r.k === 't' || typeof r.ms === 'number')) {
      let last = 0
      const keyed = x.rows.map((r, j) => ({ r, j, ms: (last = typeof r.ms === 'number' ? r.ms : last) }))
      keyed.sort((a, b) => a.ms - b.ms || a.j - b.j)
      x.rows = keyed.map(e => e.r)
    }
    const ids = new Map<number, number>()
    for (const r of x.rows) {
      const id = r.n === 'hkk' ? r.d?.fnwm : r.n === 'hkg' ? r.d?.fnvm : undefined
      if (id) ids.set(id, (ids.get(id) ?? 0) + 1)
    }
    x.owner = [...ids].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  return inst
}

/** Flux complet d'un personnage (identifiant de jeu), sessions mises bout à bout dans l'ordre des fichiers. */
export function readStream(files: string[], owner: number, read: (file: string) => Chain[] = chains): Row[] {
  const rows: Row[] = []
  for (const f of files) {
    const x = read(f).find(c => c.owner === owner)
    // (boucle : plusieurs millions de lignes dans une session de 500 Mo, trop d'arguments pour push(...))
    if (x) for (const r of x.rows) rows.push(r)
  }
  return rows
}

/**
 * Personnages des journaux : identifiant de jeu → nom (lots nommés, depuis le 2026-10-09 12:35), et identifiants des
 * flux sans nom (journaux plus anciens).
 */
export function characters(files: string[], read: (file: string) => Chain[] = chains): Map<number, string | undefined> {
  const out = new Map<number, string | undefined>()
  for (const f of files) for (const x of read(f)) if (x.owner !== undefined && (x.c || !out.has(x.owner))) out.set(x.owner, x.c ?? out.get(x.owner))
  return out
}

/** Heure (ISO) du lot le plus récent des fichiers, tous personnages confondus. */
export function lastBatchAt(files: string[]): string | null {
  let last: string | null = null
  for (const f of files) {
    const at = lastBatchOf(f)
    if (at && (!last || at > last)) last = at
  }
  return last
}

/** Heure du dernier lot d'un fichier, lu par la fin (morceaux de 4 Mo, de plus en plus loin) : une session dépasse 512 Mo. */
function lastBatchOf(file: string): string | null {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    for (let span = 4 * 1024 * 1024; ; span *= 4) {
      const from = Math.max(0, size - span)
      const buf = Buffer.alloc(size - from)
      readSync(fd, buf, 0, buf.length, from)
      const lines = buf.toString('utf8').trimEnd().split('\n')
      for (let i = lines.length - 1; i >= (from > 0 ? 1 : 0); i--) {
        if (!lines[i].startsWith('{"k":"b"')) continue
        try {
          const at = JSON.parse(lines[i]).at as string | null
          if (at) return at
        } catch {
          // (ligne en cours d'écriture)
        }
      }
      if (from === 0) return null
    }
  } finally {
    closeSync(fd)
  }
}

/** Un tour de Crâ dans le journal : manche, identifiant de jeu, heure du lot. */
export interface JournalTurn { round: number; player: number; at: string }

/**
 * Dernier combat d'un flux : lignes à partir de sa phase de placement (repérée en remontant depuis le dernier début
 * de manche 1 jusqu'à la première action d'un Crâ ou d'un autre combat), et tours des Crâs dans l'ordre.
 */
export function lastFight(rows: Row[]): { rows: Row[]; turns: JournalTurn[] } {
  let k = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].k === 'm' && rows[i].n === PROTO.round && rows[i].d?.fxjj === 1) {
      k = i
      break
    }
  }
  if (k < 0) return { rows, turns: [] }
  let start = k
  while (start > 0) {
    const r = rows[start - 1]
    if (r.k === 'm' && (r.n === PROTO.round || (r.n === PROTO.action && r.d?.fwuw > 0) || (r.n === PROTO.move && r.d?.fwaf > 0))) break
    start--
  }
  const fight = rows.slice(start)
  const turns: JournalTurn[] = []
  let round = 0
  for (const r of fight) {
    if (r.k !== 'm') continue
    if (r.n === PROTO.round) round = r.d.fxjj
    else if (r.n === PROTO.turnStart && r.d.fxjr > 0) turns.push({ round, player: r.d.fxjr, at: r.at })
  }
  return { rows: fight, turns }
}

const RED_CELLS = new Set<number>(data.map(MAP_ID)!.redCells ?? [])
const WALK = new Set<number>(data.map(MAP_ID)!.cells.filter(c => c.walkable).map(c => c.id))

/** Case d'apparition d'une Bonbombe (règle vérifiée sur 5 apparitions le 2026-10-09 : moteur, comparePositions). */
export function bombSpawnCell(owner: number, occupied: Set<number>): number {
  let best = -1
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!WALK.has(c) || occupied.has(c) || distance(owner, c) < 2) continue
    if (best < 0 || comparePositions(owner, c, best) < 0) best = c
  }
  return best
}

interface Track {
  cell?: number
  hp?: number
  maxHp?: number
  monsterId?: number
  owner?: number
  born?: number
  blue?: boolean
  alive: boolean
}

const MONSTER_HP: Record<number, number> = { 3726: 15000, 3746: 6600, 3747: 6600, 3748: 3300, 3749: 6600, 3750: 6600, 3725: 1 }

export type TurnStep = { kind: 'move'; path: number[] } | { kind: 'cast'; spell: number; cell: number; target?: number }

export interface TurnRecord {
  round: number
  actor: number
  /** Déplacements et lancers du joueur, dans l'ordre du journal. */
  steps: TurnStep[]
  casts: { spell: number; cell: number; target?: number }[]
  moves: number[][]
  damage: { target: number; amount: number }[]
}

/**
 * Rejoue le flux et renvoie l'instantané au début du tour de `player` à la manche `round` (après l'apparition de sa
 * bombe), et ce que le joueur a réellement fait pendant ce tour.
 */
export function snapshotAt(rows: Row[], round: number, player: number, names: Record<number, string>): { snap: Snapshot; actual: TurnRecord } {
  const res = replay(rows, round, player, names, true)
  if (!res.snap) throw new Error(`tour de ${names[player] ?? player} à la manche ${round} introuvable`)
  // Ordre de jeu complet (bombes exclues), relevé sur toute la manche 1.
  res.snap.order = replay(rows, Infinity, player, names, false).order
  return { snap: res.snap, actual: res.actual }
}

function replay(rows: Row[], round: number, player: number, names: Record<number, string>, stop: boolean) {
  const ents = new Map<number, Track>()
  const get = (id: number) => {
    let t = ents.get(id)
    if (!t) ents.set(id, (t = { alive: true }))
    return t
  }
  let curRound = 0
  let cur: number | undefined
  let order: number[] = []
  let started = false
  let snap: Snapshot | undefined
  const actual: TurnRecord = { round, actor: player, steps: [], casts: [], moves: [], damage: [] }
  let minId = 0
  /** Dernière manche où chaque combattant a lancé chaque sort (relances). */
  const lastCast = new Map<number, Map<number, number>>()
  /** Combattants qui ont déjà commencé leur tour à la manche courante. */
  let played = new Set<number>()

  // Positions de départ : dernière photo AnkaBot où les 4 Crâs sont sur des cases de placement rouges, prise avant la
  // première action d'un Crâ (les photos plus anciennes datent de la phase de placement, où les cases changent).
  // (les déplacements d'avant la 1re photo sont ceux de la carte d'entrée, avant le combat).
  const firstSnap = rows.findIndex(r => r.k === 's')
  const firstPlayerAction = rows.findIndex((r, k) => k > firstSnap && r.k === 'm' && ((r.n === PROTO.move && r.d.fwaf > 0) || (r.n === PROTO.action && r.d.fwuw > 0)))
  const onRed = (r: Row) => r.k === 's' && (r.e ?? []).filter(e => e.Id > 0).length >= 4 && (r.e ?? []).filter(e => e.Id > 0).every(e => RED_CELLS.has(e.CellId))
  const first = rows.slice(0, firstPlayerAction < 0 ? rows.length : firstPlayerAction).filter(onRed).at(-1)
  if (!first) throw new Error('aucune photo de placement dans le journal')
  for (const e of first.e!) {
    if (e.CreatureGenericId === BOMB) continue
    const t = get(e.Id)
    t.cell = e.CellId
    t.monsterId = e.Id < 0 ? e.CreatureGenericId : undefined
    t.maxHp = e.Id < 0 ? MONSTER_HP[e.CreatureGenericId] : e.MaxLifePoints
    t.hp = t.maxHp
    minId = Math.min(minId, e.Id)
  }
  const startIdx = rows.indexOf(first)
  for (let k = 0; k < startIdx; k++) if (rows[k].n === PROTO.round) curRound = rows[k].d.fxjj
  const occupied = () => new Set([...ents.values()].filter(t => t.alive && t.cell !== undefined).map(t => t.cell!))

  const take = () => {
    const entities: EntitySnap[] = []
    for (const [id, t] of ents) {
      if (!t.alive || t.cell === undefined) continue
      if (id > 0) {
        const cooldowns: Record<number, number> = {}
        for (const [spell, r] of lastCast.get(id) ?? []) {
          const k = data.spellLevel(spell, { playerLevel: 200 })?.minCastInterval ?? 0
          if (k > 0 && k - (round - r) > 0) cooldowns[spell] = k - (round - r)
        }
        entities.push({ name: names[id] ?? String(id), kind: 'cra', gameId: id, cell: t.cell, hp: t.hp, maxHp: t.maxHp, spells: DEFAULT_SPELLS, cooldowns })
      }
      else if (t.monsterId === BOMB) entities.push({ name: `Bombe ${names[t.owner!] ?? id}`, kind: 'bomb', gameId: id, monsterId: BOMB, cell: t.cell, owner: t.owner, born: t.born, blue: !!t.blue })
      else {
        const linked = t.owner !== undefined && ents.get(t.owner)?.monsterId === t.monsterId ? t.owner : undefined
        const next = played.has(id) && id !== player ? round + 1 : round
        const cooldowns = monsterCooldowns(t.monsterId!, next, lastCast.get(id))
        entities.push({ name: `${data.monster(t.monsterId!)?.name ?? t.monsterId} ${id}`, kind: 'monster', gameId: id, monsterId: t.monsterId, cell: t.cell, hp: t.hp, maxHp: t.maxHp, linkedTo: linked, cooldowns })
      }
    }
    snap = { mapId: MAP_ID, round, active: player, order: order.slice(), entities, source: `journal, manche ${round}, début du tour de ${names[player] ?? player}` }
  }

  for (let k = startIdx; k < rows.length; k++) {
    const r = rows[k]
    if (r.k !== 'm') continue
    const d = r.d
    if (r.n === PROTO.round) {
      if (d.fxjj !== curRound) played = new Set()
      curRound = d.fxjj
      if (curRound > (stop ? round + 1 : 1)) break
      continue
    }
    if (r.n === PROTO.turnStart) {
      cur = d.fxjr
      if (cur !== undefined) played.add(cur)
      if (curRound === 1 && cur !== undefined && ents.get(cur)?.monsterId !== BOMB && !order.includes(cur)) order.push(cur)
      if (stop && snap && cur !== player) break
      if (curRound === round && cur === player) started = true
      continue
    }
    const inTurn = started && cur === player && curRound === round
    if (r.n === PROTO.move) {
      if (inTurn && !snap) take()
      if (inTurn && d.fwaf === player) {
        actual.moves.push(d.fwab)
        actual.steps.push({ kind: 'move', path: d.fwab })
      }
      const t = get(d.fwaf)
      t.cell = d.fwab.at(-1)
      continue
    }
    if (r.n !== PROTO.action) continue
    const a = d.fwuv
    if (d.fwuy) {
      const spell = d.fwuy.fwqu?.fwpu
      if (d.fwuw !== undefined && !(snap && inTurn)) {
        if (!lastCast.has(d.fwuw)) lastCast.set(d.fwuw, new Map())
        lastCast.get(d.fwuw)!.set(spell, curRound)
      }
      if (inTurn && d.fwuw === player && !PECHE_MIGNON.has(spell)) {
        if (!snap) take()
        actual.casts.push({ spell, cell: d.fwuy.fwqq, target: d.fwuy.fwqr || undefined })
        actual.steps.push({ kind: 'cast', spell, cell: d.fwuy.fwqq, target: d.fwuy.fwqr || undefined })
      }
    } else if (d.fwwd) {
      const t = get(d.fwwd.fwsf)
      if (t.hp !== undefined) t.hp -= d.fwwd.fwsg
      if (t.maxHp !== undefined) t.maxHp -= d.fwwd.fwsa
      if (inTurn && snap) actual.damage.push({ target: d.fwwd.fwsf, amount: d.fwwd.fwsg })
    } else if (d.fwvb) get(d.fwvb.fwsr).cell = d.fwvb.fwst
    else if (d.fwva) {
      get(d.fwuw).cell = d.fwva.fwoh
      get(d.fwva.fwog).cell = d.fwva.fwoi
    } else if (d.fwvp) get(d.fwvp.fwoc).cell = d.fwvp.fwob
    else if (d.fwuz) get(d.fwuz.fwrl).alive = false
    else if (d.fwvm && d.fwvm.fwnw?.gbmq === BLUE_LOOK) get(d.fwvm.fwnx).blue = true
    else if (d.fwvi && (a === 181 || a === 180)) {
      const s = d.fwvi.fwnc?.fwmv?.[0]
      const monsterId = s?.fwmk?.fwjd?.fwie
      const placed = s?.fwmp?.[0]?.gdnt
      // Copie de la Doublure invoquée en début de combat : déjà connue par la photo de départ (journaux sans champs « g »).
      if (placed?.gcaw === undefined && monsterId !== BOMB) {
        const known = [...ents].find(([id, t]) => t.alive && t.monsterId === monsterId && id !== d.fwuw && id < d.fwuw)
        if (known) {
          known[1].owner = d.fwuw
          continue
        }
      }
      const id: number = placed?.gcaw ?? minId - 1
      minId = Math.min(minId, id)
      const t = get(id)
      t.monsterId = monsterId
      t.owner = d.fwuw
      t.born = curRound
      t.maxHp = t.hp = MONSTER_HP[monsterId] ?? 1
      const ownerCell = ents.get(d.fwuw)?.cell
      t.cell = placed?.gcax?.gblc ?? (monsterId === BOMB && ownerCell !== undefined ? bombSpawnCell(ownerCell, occupied()) : undefined)
    }
  }
  if (!snap && started) take()
  return { snap, actual, order }
}

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
