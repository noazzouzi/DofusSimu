/**
 * Réducteur de replay : calcule l'état visuel (PV, PA/PM, positions, buffs, états, glyphes,
 * vague, tour courant...) après n'importe quel événement d'un replay.
 *
 *  - `reduce(state, event, index)` est PUR (copie l'état puis applique l'événement).
 *  - `ReplayTimeline` précalcule le journal, les marqueurs (tours, vagues, morts) et des
 *    images clés (keyframes) tous les N événements : `stateAt(i)` part de l'image clé la plus
 *    proche et rejoue au plus N événements, ce qui rend le défilement arrière instantané.
 *
 * Le réducteur suit la sémantique du moteur (src/engine/engine.ts) :
 *  - `cast` retire `apCost` PA au lanceur ; `apmp` donne les valeurs ABSOLUES de PA/PM ;
 *  - `damage.amount` = PV retirés (après bouclier) ; `shieldAbsorbed` est retiré du bouclier,
 *    `erosion` des PV max ; la mort arrive par un événement `death` séparé ;
 *  - les durées de buffs sont décrémentées au début du tour de leur lanceur ;
 *  - les dommages de collision d'une poussée arrivent par un événement `damage` (kind 'push') :
 *    `push.collisionDamage` n'est qu'informatif ;
 *  - à la mort d'un combattant, ses glyphes/pièges disparaissent (le moteur ne l'annonce pas).
 */
import type { FightEvent, FighterSnapshot } from '../engine/types'
import { LogBuilder } from './log'
import type {
  FighterMetricsView,
  FighterView,
  LogEntry,
  OverlayView,
  Replay,
  ReplayMeta,
  ViewState,
} from './types'

export const DEFAULT_KEYFRAME_INTERVAL = 64

export interface ReducerContext {
  meta?: ReplayMeta
}

function emptyMetrics(): FighterMetricsView {
  return { damageDealt: 0, damageTaken: 0, healingDone: 0, shieldGiven: 0, apRemoved: 0, mpRemoved: 0, kills: 0, turnsPlayed: 0 }
}

/** Un combattant est un boss si les métadonnées le disent ou si son rôle est « boss ». */
export function isBoss(snap: Pick<FighterSnapshot, 'id' | 'role' | 'kind'>, meta?: ReplayMeta): boolean {
  const info = meta?.fighters?.[String(snap.id)]
  if (info?.boss !== undefined) return info.boss
  return snap.kind === 'monster' && !!snap.role && /boss/i.test(snap.role)
}

export function fighterFromSnapshot(snap: FighterSnapshot, index: number, ctx: ReducerContext = {}, wave?: number): FighterView {
  return {
    id: snap.id,
    team: snap.team,
    kind: snap.kind,
    name: snap.name,
    breedId: snap.breedId,
    monsterId: snap.monsterId,
    level: snap.level,
    summonerId: snap.summonerId,
    role: snap.role,
    boss: isBoss(snap, ctx.meta),
    hp: snap.hp,
    maxHp: snap.maxHp,
    baseMaxHp: snap.maxHp,
    shield: 0,
    ap: snap.ap,
    mp: snap.mp,
    apMax: snap.ap,
    mpMax: snap.mp,
    cell: snap.cell,
    alive: snap.hp > 0,
    states: [],
    buffs: [],
    wave,
    spawnedAt: index,
    metrics: emptyMetrics(),
  }
}

/** État après l'événement 0 (`fightStart`). */
export function initialState(replay: Replay): ViewState {
  const ev = replay.events[0]
  if (!ev || ev.t !== 'fightStart') throw new Error('Replay invalide : le premier événement doit être « fightStart ».')
  const ctx: ReducerContext = { meta: replay.meta }
  return {
    index: 0,
    mapId: ev.mapId,
    seed: ev.seed,
    scenario: ev.scenario,
    round: 0,
    current: null,
    turnActive: false,
    fighters: ev.fighters.map(f => fighterFromSnapshot(f, 0, ctx)),
    glyphs: [],
    traps: [],
    wave: null,
    lastCast: null,
    ended: null,
  }
}

export function cloneFighterView(f: FighterView): FighterView {
  return { ...f, states: f.states.slice(), buffs: f.buffs.map(b => ({ ...b })), metrics: { ...f.metrics } }
}

/** Copie profonde de l'état (les tableaux de cellules immuables restent partagés). */
export function cloneState(s: ViewState): ViewState {
  return {
    ...s,
    fighters: s.fighters.map(cloneFighterView),
    glyphs: s.glyphs.slice(),
    traps: s.traps.slice(),
    wave: s.wave ? { ...s.wave } : null,
    lastCast: s.lastCast,
    ended: s.ended ? { ...s.ended } : null,
  }
}

export function getFighter(s: ViewState, id: number | undefined | null): FighterView | undefined {
  if (id === undefined || id === null) return undefined
  // Les ids du moteur sont des index : accès direct, puis recherche si l'ordre diffère.
  const direct = s.fighters[id]
  if (direct && direct.id === id) return direct
  for (const f of s.fighters) if (f.id === id) return f
  return undefined
}

export function fighterAt(s: ViewState, cell: number): FighterView | undefined {
  for (const f of s.fighters) if (f.alive && f.cell === cell) return f
  return undefined
}

function addFighter(s: ViewState, f: FighterView): void {
  const i = s.fighters.findIndex(o => o.id === f.id)
  if (i >= 0) s.fighters[i] = f
  else s.fighters.push(f)
}

/**
 * Applique un événement EN PLACE (usage interne et pour les passes séquentielles rapides).
 * Les événements incohérents (combattant inconnu...) sont ignorés sans erreur.
 */
export function applyEventMut(s: ViewState, ev: FightEvent, index: number, ctx: ReducerContext = {}): ViewState {
  s.index = index
  switch (ev.t) {
    case 'fightStart':
      break
    case 'roundStart':
      s.round = ev.round
      break
    case 'turnStart': {
      s.current = ev.fighter
      s.turnActive = true
      const f = getFighter(s, ev.fighter)
      if (f) {
        f.ap = ev.ap
        f.mp = ev.mp
        f.apMax = ev.ap
        f.mpMax = ev.mp
        f.metrics.turnsPlayed++
      }
      // Les durées des effets lancés par ce combattant baissent au début de son tour
      // (les effets arrivés à 0 ont déjà été retirés par des événements `unbuff`).
      for (const t of s.fighters) for (const b of t.buffs) if (b.sourceId === ev.fighter && b.remaining > 1) b.remaining--
      break
    }
    case 'turnEnd':
      if (s.current === ev.fighter) s.turnActive = false
      break
    case 'move': {
      const f = getFighter(s, ev.fighter)
      if (f && ev.path.length) {
        f.cell = ev.path[ev.path.length - 1]
        f.mp = Math.max(0, f.mp - ev.mpUsed)
      }
      break
    }
    case 'tackle': {
      const f = getFighter(s, ev.fighter)
      if (f) {
        f.ap = Math.max(0, f.ap - ev.apLost)
        f.mp = Math.max(0, f.mp - ev.mpLost)
      }
      break
    }
    case 'cast': {
      const f = getFighter(s, ev.fighter)
      if (f) f.ap = Math.max(0, f.ap - ev.apCost)
      const target = fighterAt(s, ev.cell)
      s.lastCast = {
        index,
        fighter: ev.fighter,
        spellId: ev.spellId,
        spellName: ev.spellName,
        cell: ev.cell,
        zone: ev.zone,
        element: ev.element,
        crit: ev.crit,
        targetId: target?.id,
      }
      break
    }
    case 'damage': {
      const t = getFighter(s, ev.target)
      if (t) {
        if (ev.shieldAbsorbed) t.shield = Math.max(0, t.shield - ev.shieldAbsorbed)
        t.hp = Math.max(0, t.hp - ev.amount)
        if (ev.erosion) t.maxHp = Math.max(1, t.maxHp - ev.erosion)
        t.hp = Math.min(t.hp, t.maxHp)
        t.metrics.damageTaken += ev.amount
      }
      const src = getFighter(s, ev.source)
      if (src && (!t || src.team !== t.team)) src.metrics.damageDealt += ev.amount
      break
    }
    case 'heal': {
      const t = getFighter(s, ev.target)
      if (t) t.hp = Math.min(t.maxHp, t.hp + ev.amount)
      const src = getFighter(s, ev.source)
      if (src) src.metrics.healingDone += ev.amount
      break
    }
    case 'shield': {
      const t = getFighter(s, ev.target)
      if (t) t.shield += ev.amount
      const src = getFighter(s, ev.source)
      if (src) src.metrics.shieldGiven += ev.amount
      break
    }
    case 'apmp': {
      const t = getFighter(s, ev.target)
      if (!t) break
      const dAp = ev.ap - t.ap
      const dMp = ev.mp - t.mp
      t.ap = Math.max(0, ev.ap)
      t.mp = Math.max(0, ev.mp)
      if (ev.reason !== 'cast' && ev.reason !== 'move') {
        // Retraits : attribués au dernier lanceur de sort (adversaire) du tour courant.
        const caster = getFighter(s, s.lastCast?.fighter)
        if (caster && caster.team !== t.team) {
          if (dAp < 0) caster.metrics.apRemoved += -dAp
          if (dMp < 0) caster.metrics.mpRemoved += -dMp
        }
      }
      break
    }
    case 'buff': {
      const t = getFighter(s, ev.target)
      if (t) {
        t.buffs = t.buffs.filter(b => b.uid !== ev.uid)
        t.buffs.push({ uid: ev.uid, sourceId: ev.source, spellId: ev.spellId, label: ev.label, remaining: ev.duration })
      }
      break
    }
    case 'unbuff': {
      const t = getFighter(s, ev.target)
      if (t) t.buffs = t.buffs.filter(b => b.uid !== ev.uid)
      break
    }
    case 'state': {
      const t = getFighter(s, ev.target)
      if (!t) break
      if (ev.added) {
        if (!t.states.some(x => x.id === ev.stateId)) t.states.push({ id: ev.stateId, name: ev.name })
      } else {
        t.states = t.states.filter(x => x.id !== ev.stateId)
      }
      break
    }
    case 'push':
    case 'teleport': {
      const t = getFighter(s, ev.target)
      if (t) t.cell = ev.to
      break
    }
    case 'summon':
      addFighter(s, fighterFromSnapshot(ev.fighter, index, ctx))
      break
    case 'death': {
      const t = getFighter(s, ev.target)
      if (t) {
        t.alive = false
        t.hp = 0
        t.shield = 0
        t.diedAt = index
        t.killer = ev.killer
        const killer = getFighter(s, ev.killer)
        if (killer && killer.team !== t.team) killer.metrics.kills++
        s.glyphs = s.glyphs.filter(g => g.sourceId !== t.id)
        s.traps = s.traps.filter(g => g.sourceId !== t.id)
      }
      break
    }
    case 'glyph':
    case 'trap': {
      const key = ev.t === 'glyph' ? 'glyphs' : 'traps'
      const data = ev.t === 'glyph' ? ev.glyph : ev.trap
      const list = s[key].filter(g => g.uid !== data.uid)
      if (ev.added) {
        const overlay: OverlayView = {
          kind: ev.t,
          uid: data.uid,
          cells: data.cells,
          color: data.color,
          spellId: data.spellId,
          sourceId: s.lastCast?.fighter ?? s.current ?? undefined,
        }
        list.push(overlay)
      }
      s[key] = list
      break
    }
    case 'wave':
      s.wave = { index: ev.index, total: ev.total }
      for (const f of ev.fighters) addFighter(s, fighterFromSnapshot(f, index, ctx, ev.index))
      break
    case 'log':
      break
    case 'fightEnd':
      s.ended = { winner: ev.winner, rounds: ev.rounds, reason: ev.reason }
      s.turnActive = false
      break
  }
  return s
}

/** Version pure : retourne un nouvel état sans modifier `state`. */
export function reduce(state: ViewState, ev: FightEvent, index: number, ctx: ReducerContext = {}): ViewState {
  return applyEventMut(cloneState(state), ev, index, ctx)
}

// ───────────────────────────── chronologie d'un replay ─────────────────────────────

export interface TimelineMarker {
  index: number
  kind: 'round' | 'wave' | 'death' | 'end'
  label: string
  team?: 0 | 1
}

export interface ReplayTimelineOptions {
  /** Intervalle entre deux images clés (en événements). */
  keyframeInterval?: number
}

/**
 * Index d'un replay : images clés, journal en français, marqueurs et ordre de jeu.
 * Les états retournés par `stateAt` sont partagés avec le cache interne : NE PAS LES MODIFIER.
 */
export class ReplayTimeline {
  readonly replay: Replay
  readonly events: FightEvent[]
  readonly length: number
  readonly interval: number
  readonly log: LogEntry[]
  readonly roundStarts: { index: number; round: number }[] = []
  readonly turnStarts: number[] = []
  readonly markers: TimelineMarker[] = []
  /** Ordre de jeu global (ids), déduit de la succession des tours. */
  readonly order: number[]
  readonly finalState: ViewState
  /** Cellules occupées au moins une fois par un combattant (cadrage de la carte). */
  readonly visitedCells: Set<number> = new Set()
  private readonly keyframes: ViewState[] = []
  /** logEnd[i] = nombre d'entrées du journal produites par les événements 0..i. */
  private readonly logEnd: Int32Array
  private readonly ctx: ReducerContext
  private cache: ViewState | null = null

  constructor(replay: Replay, opts: ReplayTimelineOptions = {}) {
    this.replay = replay
    this.events = replay.events
    this.length = replay.events.length
    this.interval = Math.max(1, Math.floor(opts.keyframeInterval ?? DEFAULT_KEYFRAME_INTERVAL))
    this.ctx = { meta: replay.meta }
    const logger = new LogBuilder(replay.events)
    this.logEnd = new Int32Array(this.length)

    const s = initialState(replay)
    logger.add(s, replay.events[0], 0)
    this.logEnd[0] = logger.entries.length
    this.keyframes.push(cloneState(s))
    for (const f of s.fighters) this.visitedCells.add(f.cell)

    const roundSeqs: number[][] = []
    for (let i = 1; i < this.length; i++) {
      const ev = replay.events[i]
      logger.add(s, ev, i)
      this.collect(s, ev, i, roundSeqs)
      applyEventMut(s, ev, i, this.ctx)
      this.logEnd[i] = logger.entries.length
      if (i % this.interval === 0) this.keyframes.push(cloneState(s))
    }
    this.log = logger.entries
    this.finalState = cloneState(s)
    this.order = mergeOrder(roundSeqs, this.finalState)
  }

  /** Collecte des marqueurs/cellules (état AVANT l'événement). */
  private collect(s: ViewState, ev: FightEvent, i: number, roundSeqs: number[][]): void {
    switch (ev.t) {
      case 'roundStart':
        this.roundStarts.push({ index: i, round: ev.round })
        this.markers.push({ index: i, kind: 'round', label: `Tour ${ev.round}` })
        roundSeqs.push([])
        break
      case 'turnStart':
        this.turnStarts.push(i)
        if (!roundSeqs.length) roundSeqs.push([])
        roundSeqs[roundSeqs.length - 1].push(ev.fighter)
        break
      case 'wave':
        this.markers.push({ index: i, kind: 'wave', label: `Vague ${ev.index}/${ev.total}` })
        for (const f of ev.fighters) this.visitedCells.add(f.cell)
        break
      case 'death': {
        const t = getFighter(s, ev.target)
        this.markers.push({ index: i, kind: 'death', label: `${t?.name ?? '#' + ev.target} vaincu`, team: t?.team })
        break
      }
      case 'fightEnd':
        this.markers.push({ index: i, kind: 'end', label: 'Fin du combat' })
        break
      case 'move':
        for (const c of ev.path) this.visitedCells.add(c)
        break
      case 'push':
      case 'teleport':
        this.visitedCells.add(ev.to)
        break
      case 'summon':
        this.visitedCells.add(ev.fighter.cell)
        break
    }
  }

  /** État après l'événement `i` (borné à [0, length-1]). */
  stateAt(i: number): ViewState {
    i = Math.max(0, Math.min(this.length - 1, Math.floor(i)))
    const cache = this.cache
    if (cache && cache.index === i) return cache
    let start: ViewState = this.keyframes[Math.floor(i / this.interval)]
    // Avance séquentielle (lecture) : repartir du dernier état calculé s'il est plus proche.
    if (cache && cache.index < i && cache.index > start.index) start = cache
    const s = cloneState(start)
    for (let j = start.index + 1; j <= i; j++) applyEventMut(s, this.events[j], j, this.ctx)
    this.cache = s
    return s
  }

  /** Nombre d'entrées du journal visibles après l'événement `i`. */
  logCount(i: number): number {
    if (i < 0) return 0
    return this.logEnd[Math.min(this.length - 1, i)]
  }

  /** Entrées du journal produites par les événements 0..i. */
  logLines(i: number): LogEntry[] {
    return this.log.slice(0, this.logCount(i))
  }

  /** Tour de jeu (round) en cours après l'événement `i`. */
  roundAt(i: number): number {
    let r = 0
    for (const rs of this.roundStarts) {
      if (rs.index > i) break
      r = rs.round
    }
    return r
  }

  /** Index du prochain début de tour de combattant strictement après `i` (ou -1). */
  nextTurnIndex(i: number): number {
    for (const t of this.turnStarts) if (t > i) return t
    return -1
  }

  /** Index du dernier début de tour de combattant strictement avant `i` (ou -1). */
  prevTurnIndex(i: number): number {
    let best = -1
    for (const t of this.turnStarts) {
      if (t >= i) break
      best = t
    }
    return best
  }

  /** Ordre de jeu à afficher pour un état : combattants déjà apparus, dans l'ordre global. */
  turnOrder(state: ViewState): number[] {
    const present = new Set(state.fighters.map(f => f.id))
    return this.order.filter(id => present.has(id))
  }

  fighterName(id: number): string {
    return getFighter(this.finalState, id)?.name ?? `#${id}`
  }
}

/**
 * Ordre de jeu global : séquences de tours de chaque round fusionnées (un combattant apparu en
 * cours de combat est inséré après celui qui le précède dans le round où il joue pour la 1re fois).
 * Les combattants qui ne jouent jamais sont placés après leur invocateur, ou en fin de liste.
 */
function mergeOrder(roundSeqs: number[][], final: ViewState): number[] {
  const order: number[] = []
  for (const seq of roundSeqs) {
    seq.forEach((id, k) => {
      if (order.includes(id)) return
      const prev = k > 0 ? order.indexOf(seq[k - 1]) : -1
      order.splice(prev + 1, 0, id)
    })
  }
  const missing = final.fighters.filter(f => !order.includes(f.id))
  // Racines d'abord (alternance d'équipes), puis invocations après leur invocateur.
  const roots = missing.filter(f => f.summonerId === undefined)
  const t0 = roots.filter(f => f.team === 0)
  const t1 = roots.filter(f => f.team === 1)
  for (let i = 0; i < Math.max(t0.length, t1.length); i++) {
    if (t0[i]) order.push(t0[i].id)
    if (t1[i]) order.push(t1[i].id)
  }
  for (const f of missing.filter(m => m.summonerId !== undefined)) {
    let idx = order.indexOf(f.summonerId!)
    if (idx < 0) {
      order.push(f.id)
      continue
    }
    while (idx + 1 < order.length && getFighter(final, order[idx + 1])?.summonerId === f.summonerId) idx++
    order.splice(idx + 1, 0, f.id)
  }
  return order
}
