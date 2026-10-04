/**
 * Replay de démonstration SYNTHÉTIQUE (scénarisé à la main, pas simulé) : un groupe Iop / Crâ /
 * Eniripsa / Enutrof contre une salle de l'Œil de Vortex (vagues + boss invulnérable).
 *
 * Il n'utilise que les types publics `FightEvent` : un petit « metteur en scène » tient à jour
 * positions, PV, PA/PM, buffs et glyphes pour que la suite d'événements soit cohérente (chemins
 * adjacents, cellules libres, PV jamais négatifs, PA absolus corrects...). Il sera remplacé par
 * de vrais combats du moteur ; il sert aussi de banc d'essai au visualiseur et à ses tests.
 */
import { Element, type TeamId } from '../core/types'
import type { MapCell, MapData } from '../data/model'
import type { DamageKind, FightEvent, FighterKind, FighterSnapshot } from '../engine/types'
import { CELL_COUNT, MAP_WIDTH, cellToPoint, distance, neighbors, pointToCell } from '../map/geometry'
import type { Replay } from './types'

export const DEMO_MAP_ID = 990001

// ───────────────────────────── carte ─────────────────────────────

const at = (x: number, y: number): number => {
  const c = pointToCell(x, y)
  if (c < 0) throw new Error(`Cellule hors carte (${x}, ${y})`)
  return c
}

/** Piliers (bloquent la ligne de vue) et fissures (trous : non marchables, vue dégagée). */
const PILLARS: [number, number][] = [
  [15, -2], [19, -4], [19, -5], [13, -6], [21, 1], [14, 3 + 3], [17, -12],
]
/** Cellules de départ (logiques) : joueurs puis gardiens de la vague 1 et Vortex. */
const PLAYER_STARTS: [number, number][] = [[17, -8], [15, -9], [16, -10], [19, -9]]
const MONSTER_STARTS: [number, number][] = [[16, 1], [13, 3], [14, 3], [18, 2], [12, 6]]
const HOLES: [number, number][] = [
  [17, -4], [18, -4], [17, -5], [11, -1], [12, -1], [22, -7], [23, -7],
]

/**
 * Salle de démonstration « Salle du Vortex » : arène ovale (≈ 330 cellules) avec piliers et
 * fissures temporelles. Placement des joueurs en bas à gauche, des monstres en haut à droite.
 */
export function createDemoMap(): MapData {
  const arena = new Set<number>()
  for (let c = 0; c < CELL_COUNT; c++) {
    const row = Math.floor(c / MAP_WIDTH)
    const col = c % MAP_WIDTH
    const x = col + (row % 2) * 0.5 + 0.5
    const y = (row + 1) / 4
    const dx = (x - 7.25) / 6.05
    const dy = (y - 5.125) / 4.3
    if (dx * dx + dy * dy <= 1) arena.add(c)
  }
  // Supprime les excroissances d'une cellule (moins de 2 voisines dans l'arène).
  for (let pass = 0; pass < 2; pass++) {
    for (const c of [...arena]) if (neighbors(c).filter(n => arena.has(n)).length < 2) arena.delete(c)
  }
  const pillars = new Set(PILLARS.map(([x, y]) => at(x, y)))
  const holes = new Set(HOLES.map(([x, y]) => at(x, y)))
  const starts1 = new Set(PLAYER_STARTS.map(([x, y]) => at(x, y)))
  const starts2 = new Set(MONSTER_STARTS.map(([x, y]) => at(x, y)))
  const cells: MapCell[] = []
  for (let id = 0; id < CELL_COUNT; id++) {
    const inside = arena.has(id)
    const p = cellToPoint(id)
    let placement: 0 | 1 | 2 = 0
    if (inside && !pillars.has(id) && !holes.has(id)) {
      const sparse = (p.x * 2 + p.y) % 3 === 0
      if (starts1.has(id) || (sparse && p.y >= -11 && p.y <= -8 && p.x >= 14 && p.x <= 20)) placement = 1
      if (starts2.has(id) || (sparse && p.y >= 1 && p.y <= 4 && p.x >= 12 && p.x <= 18)) placement = 2
    }
    cells.push({
      id,
      walkable: inside && !pillars.has(id) && !holes.has(id),
      // Hors arène : vide (non marchable, ligne de vue libre) ; piliers : bloquent la vue.
      los: !pillars.has(id),
      placement,
    })
  }
  return { id: DEMO_MAP_ID, name: 'Salle du Vortex (démo)', cells }
}

// ───────────────────────────── metteur en scène ─────────────────────────────

interface Actor {
  snap: FighterSnapshot
  hp: number
  maxHp: number
  shield: number
  ap: number
  mp: number
  apBase: number
  mpBase: number
  cell: number
  alive: boolean
}

interface ActiveBuff {
  uid: number
  target: number
  source: number
  spellId: number
  label: string
  remaining: number
  ap: number
  mp: number
  state?: { id: number; name: string }
}

interface ActiveGlyph {
  uid: number
  source: number
  spellId: number
  cells: number[]
  color: string
  remaining: number
  onTurnStart?: (b: DemoDirector, fighter: number) => void
}

export interface SpellDef {
  id: number
  name: string
  ap: number
  element?: Element
  /** Forme de zone : P point, C cercle, X croix. */
  shape?: 'P' | 'C' | 'X'
  size?: number
}

/** Construit une suite d'événements cohérente (lève une erreur au moindre incohérence). */
export class DemoDirector {
  readonly events: FightEvent[] = []
  readonly actors = new Map<number, Actor>()
  readonly timeline: number[] = []
  private buffs: ActiveBuff[] = []
  private glyphs: ActiveGlyph[] = []
  private traps: ActiveGlyph[] = []
  private nextUid = 1
  round = 0
  current: number | null = null
  ended = false

  constructor(readonly map: MapData) {}

  // ── requêtes ──
  actor(id: number): Actor {
    const a = this.actors.get(id)
    if (!a) throw new Error(`Combattant inconnu #${id}`)
    return a
  }
  occupant(cell: number): Actor | undefined {
    for (const a of this.actors.values()) if (a.alive && a.cell === cell) return a
    return undefined
  }
  isFree(cell: number): boolean {
    return cell >= 0 && cell < CELL_COUNT && this.map.cells[cell].walkable && !this.occupant(cell)
  }
  emit(ev: FightEvent): void {
    if (this.ended) throw new Error(`Événement après la fin du combat : ${ev.t}`)
    this.events.push(ev)
  }

  // ── préparation ──
  add(s: Omit<FighterSnapshot, 'id' | 'maxHp'> & { maxHp?: number }): number {
    const id = this.actors.size
    const snap: FighterSnapshot = { ...s, id, maxHp: s.maxHp ?? s.hp }
    if (!this.map.cells[snap.cell]?.walkable || this.occupant(snap.cell)) throw new Error(`Placement invalide pour ${snap.name}`)
    this.actors.set(id, {
      snap,
      hp: snap.hp,
      maxHp: snap.maxHp,
      shield: 0,
      ap: snap.ap,
      mp: snap.mp,
      apBase: snap.ap,
      mpBase: snap.mp,
      cell: snap.cell,
      alive: true,
    })
    return id
  }

  start(order: number[], scenario?: string): void {
    this.timeline.push(...order)
    this.emit({ t: 'fightStart', mapId: this.map.id, fighters: [...this.actors.values()].map(a => ({ ...a.snap })), seed: 42, scenario })
  }

  log(text: string, level: 'info' | 'ai' | 'warn' = 'info'): void {
    this.emit({ t: 'log', text, level })
  }

  // ── tours ──
  roundStart(): void {
    this.round++
    this.emit({ t: 'roundStart', round: this.round })
  }

  /** Joue le tour d'un combattant (ignoré s'il est mort ou si le combat est terminé). */
  turn(id: number, play?: (d: this) => void): void {
    const a = this.actor(id)
    if (!a.alive || this.ended) return
    // Durées des buffs et glyphes lancés par ce combattant (comme le moteur).
    for (const b of this.buffs.slice()) {
      if (b.source !== id || b.remaining < 0) continue
      b.remaining--
      if (b.remaining <= 0) this.removeBuff(b.uid)
    }
    for (const g of this.glyphs.slice()) {
      if (g.source !== id || g.remaining < 0) continue
      g.remaining--
      if (g.remaining <= 0) this.removeGlyph(g.uid)
    }
    for (const g of this.traps.slice()) {
      if (g.source !== id || g.remaining < 0) continue
      g.remaining--
      if (g.remaining <= 0) this.removeTrap(g.uid)
    }
    let ap = a.apBase
    let mp = a.mpBase
    for (const b of this.buffs) if (b.target === id) ((ap += b.ap), (mp += b.mp))
    a.ap = Math.max(0, ap)
    a.mp = Math.max(0, mp)
    this.current = id
    this.emit({ t: 'turnStart', fighter: id, ap: a.ap, mp: a.mp })
    for (const g of this.glyphs.slice()) if (g.cells.includes(a.cell) && g.onTurnStart) g.onTurnStart(this, id)
    if (a.alive && !this.ended) play?.(this)
    if (!this.ended) this.emit({ t: 'turnEnd', fighter: id })
  }

  // ── déplacements ──
  /** Chemin le plus court (BFS 4-voisins) entre cellules libres ; null si inaccessible. */
  path(from: number, to: number, maxSteps = 99): number[] | null {
    if (from === to) return [from]
    const prev = new Map<number, number>([[from, from]])
    const dist = new Map<number, number>([[from, 0]])
    const queue = [from]
    while (queue.length) {
      const c = queue.shift()!
      const d = dist.get(c)!
      if (d >= maxSteps) continue
      for (const n of neighbors(c).sort((p, q) => p - q)) {
        if (prev.has(n) || !this.isFree(n)) continue
        prev.set(n, c)
        dist.set(n, d + 1)
        if (n === to) {
          const out = [n]
          let k = n
          while (k !== from) out.unshift((k = prev.get(k)!))
          return out
        }
        queue.push(n)
      }
    }
    return null
  }

  /** Cellules accessibles (cellule -> nombre de pas) avec `steps` PM au plus. */
  reachable(from: number, steps: number): Map<number, number> {
    const dist = new Map<number, number>([[from, 0]])
    const queue = [from]
    while (queue.length) {
      const c = queue.shift()!
      const d = dist.get(c)!
      if (d >= steps) continue
      for (const n of neighbors(c)) {
        if (dist.has(n) || !this.isFree(n)) continue
        dist.set(n, d + 1)
        queue.push(n)
      }
    }
    return dist
  }

  moveTo(id: number, to: number): void {
    const a = this.actor(id)
    if (to === a.cell) return
    const p = this.path(a.cell, to)
    if (!p) throw new Error(`${a.snap.name} ne peut pas atteindre la cellule ${to}`)
    const used = p.length - 1
    if (used > a.mp) throw new Error(`${a.snap.name} n'a que ${a.mp} PM pour ${used} cases`)
    a.mp -= used
    a.cell = to
    this.emit({ t: 'move', fighter: id, path: p, mpUsed: used })
  }

  /** Se rapproche d'une cible jusqu'à la distance voulue (ou au plus près avec les PM restants). */
  approach(id: number, target: number, dist = 1, maxSteps?: number): void {
    const a = this.actor(id)
    const t = this.actor(target)
    const steps = Math.min(a.mp, maxSteps ?? a.mp)
    let best = a.cell
    let bestScore = Math.abs(distance(a.cell, t.cell) - dist) * 100
    for (const [c, d] of this.reachable(a.cell, steps)) {
      const score = Math.abs(distance(c, t.cell) - dist) * 100 + d
      if (score < bestScore || (score === bestScore && c < best)) ((best = c), (bestScore = score))
    }
    this.moveTo(id, best)
  }

  /** S'éloigne d'une cible (maximise la distance) avec au plus `maxSteps` PM. */
  retreat(id: number, from: number, maxSteps?: number): void {
    const a = this.actor(id)
    const f = this.actor(from)
    const steps = Math.min(a.mp, maxSteps ?? a.mp)
    let best = a.cell
    let bestScore = -distance(a.cell, f.cell) * 100
    for (const [c, d] of this.reachable(a.cell, steps)) {
      const score = -distance(c, f.cell) * 100 + d
      if (score < bestScore || (score === bestScore && c < best)) ((best = c), (bestScore = score))
    }
    this.moveTo(id, best)
  }

  tackle(id: number, apLost: number, mpLost: number): void {
    const a = this.actor(id)
    a.ap = Math.max(0, a.ap - apLost)
    a.mp = Math.max(0, a.mp - mpLost)
    this.emit({ t: 'tackle', fighter: id, apLost, mpLost })
  }

  /** Cellule libre la plus proche de `near` (distance >= minDist), départagée par la proximité de `toward`. */
  freeCellNear(near: number, minDist = 1, toward?: number): number {
    let best = -1
    let bestScore = Infinity
    for (let c = 0; c < CELL_COUNT; c++) {
      if (!this.isFree(c)) continue
      const d = distance(c, near)
      if (d < minDist) continue
      const score = d * 1000 + (toward !== undefined ? distance(c, toward) : 0) * 10 + c / 1000
      if (score < bestScore) ((bestScore = score), (best = c))
    }
    if (best < 0) throw new Error('Aucune cellule libre')
    return best
  }

  // ── sorts ──
  zone(spell: SpellDef, center: number): number[] {
    const shape = spell.shape ?? 'P'
    const size = spell.size ?? 0
    const c = cellToPoint(center)
    const out: number[] = []
    for (let dx = -size; dx <= size; dx++)
      for (let dy = -size; dy <= size; dy++) {
        const d = Math.abs(dx) + Math.abs(dy)
        if (shape === 'P' && d > 0) continue
        if (shape === 'C' && d > size) continue
        if (shape === 'X' && dx !== 0 && dy !== 0) continue
        const id = pointToCell(c.x + dx, c.y + dy)
        if (id >= 0 && this.map.cells[id].walkable) out.push(id)
      }
    return out
  }

  /** Lance un sort (événements `cast` + `apmp`) ; retourne les combattants vivants dans la zone. */
  cast(id: number, spell: SpellDef, cell: number, crit = false): number[] {
    const a = this.actor(id)
    if (spell.ap > a.ap) throw new Error(`${a.snap.name} n'a que ${a.ap} PA pour ${spell.name} (${spell.ap})`)
    a.ap -= spell.ap
    const zone = this.zone(spell, cell)
    this.emit({ t: 'cast', fighter: id, spellId: spell.id, spellName: spell.name, cell, crit, apCost: spell.ap, zone, element: spell.element })
    this.emit({ t: 'apmp', target: id, ap: a.ap, mp: a.mp, reason: 'cast' })
    return [...this.actors.values()].filter(o => o.alive && zone.includes(o.cell)).map(o => o.snap.id)
  }

  /** Lance un sort sur un combattant (cible = sa cellule). */
  castOn(id: number, spell: SpellDef, target: number, crit = false): number[] {
    return this.cast(id, spell, this.actor(target).cell, crit)
  }

  // ── effets ──
  hit(source: number, target: number, raw: number, element: Element | -1, opts: { crit?: boolean; kind?: DamageKind } = {}): void {
    const t = this.actor(target)
    if (!t.alive || this.ended) return
    let amount = Math.floor(raw)
    let absorbed = 0
    if (t.shield > 0) {
      absorbed = Math.min(t.shield, amount)
      t.shield -= absorbed
      amount -= absorbed
    }
    const lost = Math.min(t.hp, amount)
    t.hp -= lost
    const erosion = Math.floor((lost * 10) / 100)
    if (erosion > 0) {
      t.maxHp = Math.max(1, t.maxHp - erosion)
      t.hp = Math.min(t.hp, t.maxHp)
    }
    this.emit({
      t: 'damage',
      source,
      target,
      amount: lost,
      element,
      kind: opts.kind ?? 'direct',
      shieldAbsorbed: absorbed || undefined,
      erosion: erosion || undefined,
      crit: opts.crit || undefined,
    })
    if (t.hp <= 0) this.kill(target, source)
  }

  heal(source: number, target: number, raw: number): void {
    const t = this.actor(target)
    const healed = Math.min(Math.floor(raw), t.maxHp - t.hp)
    if (!t.alive || healed <= 0 || this.ended) return
    t.hp += healed
    this.emit({ t: 'heal', source, target, amount: healed })
  }

  shield(source: number, target: number, amount: number): void {
    const t = this.actor(target)
    t.shield += amount
    this.emit({ t: 'shield', source, target, amount })
  }

  /** Buff / débuff (PA, PM, état) d'une durée en tours du lanceur. */
  buff(source: number, target: number, spellId: number, label: string, duration: number, mods: { ap?: number; mp?: number; state?: { id: number; name: string } } = {}): number {
    const t = this.actor(target)
    const b: ActiveBuff = { uid: this.nextUid++, target, source, spellId, label, remaining: duration, ap: mods.ap ?? 0, mp: mods.mp ?? 0, state: mods.state }
    this.buffs.push(b)
    this.emit({ t: 'buff', target, source, spellId, label, duration, uid: b.uid })
    if (b.ap || b.mp) {
      t.ap = Math.max(0, t.ap + b.ap)
      t.mp = Math.max(0, t.mp + b.mp)
      this.emit({ t: 'apmp', target, ap: t.ap, mp: t.mp, reason: b.ap < 0 || b.mp < 0 ? 'retrait' : 'buff' })
    }
    if (b.state && !this.buffs.some(o => o !== b && o.target === target && o.state?.id === b.state!.id)) {
      this.emit({ t: 'state', target, stateId: b.state.id, name: b.state.name, added: true })
    }
    return b.uid
  }

  removeBuff(uid: number): void {
    const b = this.buffs.find(x => x.uid === uid)
    if (!b) return
    this.buffs = this.buffs.filter(x => x !== b)
    const t = this.actor(b.target)
    if (!t.alive) return
    this.emit({ t: 'unbuff', target: b.target, uid })
    if (b.ap || b.mp) {
      t.ap = Math.max(0, t.ap - b.ap)
      t.mp = Math.max(0, t.mp - b.mp)
      this.emit({ t: 'apmp', target: b.target, ap: t.ap, mp: t.mp, reason: 'buff' })
    }
    if (b.state && !this.buffs.some(o => o.target === b.target && o.state?.id === b.state!.id)) {
      this.emit({ t: 'state', target: b.target, stateId: b.state.id, name: b.state.name, added: false })
    }
  }

  state(target: number, id: number, name: string, added: boolean): void {
    this.emit({ t: 'state', target, stateId: id, name, added })
  }

  /** Poussée de `n` cases dans l'axe lanceur → cible ; collision si bloquée. */
  push(source: number, target: number, n: number, collisionPerCell = 0): void {
    const s = this.actor(source)
    const t = this.actor(target)
    if (!t.alive) return
    const a = cellToPoint(s.cell)
    const b = cellToPoint(t.cell)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dir = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }
    const from = t.cell
    let cell = t.cell
    let blocked = 0
    let collisionWith: number | undefined
    for (let i = 0; i < n; i++) {
      const p = cellToPoint(cell)
      const next = pointToCell(p.x + dir.x, p.y + dir.y)
      if (next < 0 || !this.isFree(next)) {
        blocked = n - i
        const occ = next >= 0 ? this.occupant(next) : undefined
        if (occ) collisionWith = occ.snap.id
        break
      }
      cell = next
    }
    t.cell = cell
    const collisionDamage = blocked && collisionPerCell ? blocked * collisionPerCell : undefined
    this.emit({ t: 'push', target, from, to: cell, collisionWith, collisionDamage })
    if (collisionDamage) {
      this.hit(source, target, collisionDamage, -1, { kind: 'push' })
      if (collisionWith !== undefined) this.hit(source, collisionWith, Math.floor(collisionDamage / 2), -1, { kind: 'push' })
    }
  }

  teleport(target: number, to: number): void {
    const t = this.actor(target)
    if (!this.isFree(to)) throw new Error(`Téléportation de ${t.snap.name} vers une cellule occupée (${to})`)
    const from = t.cell
    t.cell = to
    this.emit({ t: 'teleport', target, from, to })
  }

  summon(summoner: number, s: Omit<FighterSnapshot, 'id' | 'maxHp' | 'summonerId'>): number {
    const id = this.add({ ...s, summonerId: summoner })
    // Insertion dans la timeline juste après l'invocateur (et ses invocations).
    let idx = this.timeline.indexOf(summoner)
    while (idx + 1 < this.timeline.length && this.actors.get(this.timeline[idx + 1])?.snap.summonerId === summoner) idx++
    this.timeline.splice(idx + 1, 0, id)
    this.emit({ t: 'summon', summoner, fighter: { ...this.actor(id).snap } })
    return id
  }

  wave(index: number, total: number, list: Omit<FighterSnapshot, 'id' | 'maxHp'>[]): number[] {
    const ids = list.map(s => this.add(s))
    this.timeline.push(...ids)
    this.emit({ t: 'wave', index, total, fighters: ids.map(id => ({ ...this.actor(id).snap })) })
    return ids
  }

  glyph(source: number, spellId: number, cells: number[], color: string, duration: number, onTurnStart?: ActiveGlyph['onTurnStart']): number {
    const g: ActiveGlyph = { uid: this.nextUid++, source, spellId, cells, color, remaining: duration, onTurnStart }
    this.glyphs.push(g)
    this.emit({ t: 'glyph', glyph: { uid: g.uid, cells, color, spellId }, added: true })
    return g.uid
  }

  removeGlyph(uid: number): void {
    const g = this.glyphs.find(x => x.uid === uid)
    if (!g) return
    this.glyphs = this.glyphs.filter(x => x !== g)
    this.emit({ t: 'glyph', glyph: { uid, cells: g.cells, color: g.color, spellId: g.spellId }, added: false })
  }

  /** Piège (invisible pour l'adversaire dans le jeu) ; retiré après `duration` tours du lanceur. */
  trap(source: number, spellId: number, cells: number[], color: string, duration: number): number {
    const g: ActiveGlyph = { uid: this.nextUid++, source, spellId, cells, color, remaining: duration }
    this.traps.push(g)
    this.emit({ t: 'trap', trap: { uid: g.uid, cells, color, spellId }, added: true })
    return g.uid
  }

  removeTrap(uid: number): void {
    const g = this.traps.find(x => x.uid === uid)
    if (!g) return
    this.traps = this.traps.filter(x => x !== g)
    this.emit({ t: 'trap', trap: { uid, cells: g.cells, color: g.color, spellId: g.spellId }, added: false })
  }

  /** Pièges posés par d'autres que `id` couvrant la cellule. */
  trapsAt(cell: number): number[] {
    return this.traps.filter(t => t.cells.includes(cell)).map(t => t.uid)
  }

  trapInfo(uid: number): { source: number; spellId: number } | undefined {
    const t = this.traps.find(x => x.uid === uid)
    return t ? { source: t.source, spellId: t.spellId } : undefined
  }

  kill(target: number, killer?: number): void {
    const t = this.actor(target)
    if (!t.alive) return
    t.alive = false
    t.hp = 0
    this.emit({ t: 'death', target, killer })
    // Comme le moteur : glyphes du mort retirées sans événement, invocations tuées.
    this.glyphs = this.glyphs.filter(g => g.source !== target)
    this.traps = this.traps.filter(g => g.source !== target)
    this.buffs = this.buffs.filter(b => b.target !== target)
    for (const o of this.actors.values()) if (o.alive && o.snap.summonerId === target) this.kill(o.snap.id, killer)
    // Les effets lancés par le mort sur les autres prennent fin.
    for (const b of this.buffs.slice()) if (b.source === target) this.removeBuff(b.uid)
    this.onDeath?.(target)
  }

  /** Crochet de scénario appelé après chaque mort (vagues, fin de combat...). */
  onDeath?: (id: number) => void

  /** Joue un tour de jeu complet en suivant la timeline vivante (les arrivées en cours de tour jouent aussi). */
  playRound(script: (id: number) => ((d: this) => void) | undefined): void {
    if (this.ended) return
    this.roundStart()
    for (let k = 0; k < this.timeline.length && !this.ended; k++) {
      const id = this.timeline[k]
      this.turn(id, script(id))
    }
  }

  end(winner: TeamId | null, reason: string): void {
    this.emit({ t: 'fightEnd', winner, rounds: this.round, reason })
    this.ended = true
  }

  alive(id: number): boolean {
    return this.actor(id).alive
  }
  hp(id: number): number {
    return this.actor(id).hp
  }
}

// ───────────────────────────── scénario de démonstration ─────────────────────────────

const S = {
  // Iop
  puissance: { id: 9101, name: 'Puissance', ap: 2 },
  bond: { id: 9102, name: 'Bond', ap: 5 },
  epeeDivine: { id: 9103, name: 'Épée Divine', ap: 4, element: Element.Air },
  epeeCeleste: { id: 9104, name: 'Épée Céleste', ap: 4, element: Element.Air, shape: 'C', size: 1 },
  intimidation: { id: 9105, name: 'Intimidation', ap: 2, element: Element.Neutral },
  pression: { id: 9106, name: 'Pression', ap: 3, element: Element.Earth },
  colere: { id: 9107, name: 'Colère de Iop', ap: 6, element: Element.Earth },
  // Crâ
  tirEloigne: { id: 9201, name: 'Tir Éloigné', ap: 2 },
  flecheExplosive: { id: 9202, name: 'Flèche Explosive', ap: 5, element: Element.Fire, shape: 'C', size: 1 },
  flecheGlacee: { id: 9203, name: 'Flèche Glacée', ap: 3, element: Element.Fire },
  flecheRecul: { id: 9204, name: 'Flèche de Recul', ap: 3, element: Element.Air },
  flecheMagique: { id: 9205, name: 'Flèche Magique', ap: 3, element: Element.Air },
  // Eniripsa
  motStimulant: { id: 9301, name: 'Mot Stimulant', ap: 2 },
  motSoignant: { id: 9302, name: 'Mot Soignant', ap: 3, element: Element.Fire },
  motPrevention: { id: 9303, name: 'Mot de Prévention', ap: 3 },
  motInterdit: { id: 9304, name: 'Mot Interdit', ap: 3, element: Element.Fire },
  motReconstitution: { id: 9305, name: 'Mot de Reconstitution', ap: 5, element: Element.Water, shape: 'C', size: 1 },
  // Enutrof
  sacAnime: { id: 9401, name: 'Sac Animé', ap: 2 },
  pelleFantomatique: { id: 9402, name: 'Pelle Fantomatique', ap: 4, element: Element.Water, shape: 'C', size: 1 },
  lancerPieces: { id: 9403, name: 'Lancer de Pièces', ap: 2, element: Element.Water },
  // Monstres de l'Œil de Vortex
  morsure: { id: 9501, name: 'Morsure Temporelle', ap: 4, element: Element.Earth },
  onde: { id: 9507, name: 'Onde Tellurique', ap: 4, element: Element.Earth },
  rayonAbyssal: { id: 9502, name: 'Rayon Abyssal', ap: 4, element: Element.Water },
  volPlane: { id: 9503, name: 'Vol Plané', ap: 2 },
  griffes: { id: 9504, name: 'Griffes Harpiennes', ap: 4, element: Element.Air },
  flaque: { id: 9505, name: 'Flaque Corrosive', ap: 3, element: Element.Earth, shape: 'C', size: 1 },
  crachat: { id: 9506, name: 'Crachat Acide', ap: 4, element: Element.Neutral },
  distorsion: { id: 9601, name: 'Distorsion Temporelle', ap: 3 },
  rayonVortex: { id: 9602, name: 'Rayon du Vortex', ap: 4, element: Element.Water },
  aspiration: { id: 9603, name: 'Aspiration', ap: 3 },
  effondrement: { id: 9604, name: 'Effondrement Temporel', ap: 5, element: Element.Fire, shape: 'C', size: 2 },
} satisfies Record<string, SpellDef>

const INVULNERABLE = { id: 9900, name: 'Invulnérable' }
const DESYNC = { id: 9901, name: 'Désynchronisé' }


type Turn = (() => void) | undefined

/** Génère le replay de démonstration (déterministe). */
export function createDemoReplay(): Replay {
  const map = createDemoMap()
  const d = new DemoDirector(map)
  const player = (name: string, breedId: number, cell: number, hp: number, ap: number, mp: number, role: string) =>
    d.add({ team: 0, kind: 'player' as FighterKind, name, breedId, level: 200, hp, ap, mp, cell, role })
  const monster = (name: string, monsterId: number, cell: number, hp: number, ap: number, mp: number, level = 200, role?: string) =>
    d.add({ team: 1, kind: 'monster' as FighterKind, name, monsterId, level, hp, ap, mp, cell, role })

  const [pIop, pCra, pEni, pEnu] = PLAYER_STARTS.map(([x, y]) => at(x, y))
  const [mIka, mMej, mHar, mBub, mVor] = MONSTER_STARTS.map(([x, y]) => at(x, y))
  const iop = player('Iop', 8, pIop, 4350, 12, 6, 'DPS mêlée')
  const cra = player('Crâ', 9, pCra, 3620, 12, 6, 'DPS distance')
  const eni = player('Eniripsa', 7, pEni, 3480, 12, 6, 'Soin')
  const enu = player('Enutrof', 3, pEnu, 3950, 11, 6, 'Retrait PM')
  const ika = monster('Ikargn', 5101, mIka, 3650, 10, 5)
  const mej = monster('Méjaire', 5102, mMej, 2800, 10, 4)
  const har = monster('Harpille', 5103, mHar, 2600, 10, 5)
  const bub = monster('Buboxor', 5104, mBub, 3600, 9, 3)
  const vor = monster('Vortex', 5100, mVor, 8800, 12, 4, 220, 'boss')
  let sac = -1
  const wave2 = { ika: -1, har: -1 }
  let wave = 1

  // Scénario : vague 2 quand la vague 1 est vaincue, puis le Vortex devient vulnérable.
  d.onDeath = () => {
    if (d.ended) return
    const guards = [...d.actors.values()].filter(a => a.snap.team === 1 && a.snap.id !== vor)
    if (!d.alive(vor)) {
      if (!guards.some(a => a.alive)) d.end(0, 'Tous les monstres sont morts')
      return
    }
    if (guards.some(a => a.alive)) return
    if (wave === 1) {
      wave = 2
      d.log('Première vague vaincue : le Vortex appelle ses derniers gardiens !', 'warn')
      ;[wave2.ika, wave2.har] = d.wave(2, 2, [
        { team: 1, kind: 'monster', name: 'Ikargn', monsterId: 5101, level: 200, hp: 3400, ap: 10, mp: 5, cell: d.freeCellNear(d.actor(vor).cell, 2, at(16, -4)) },
        { team: 1, kind: 'monster', name: 'Harpille', monsterId: 5103, level: 200, hp: 2700, ap: 10, mp: 5, cell: d.freeCellNear(at(18, 1), 0) },
      ])
    } else {
      d.state(vor, INVULNERABLE.id, INVULNERABLE.name, false)
      d.log('Toutes les vagues sont vaincues : le Vortex devient vulnérable !', 'warn')
    }
  }

  const enemiesIn = (ids: number[]) => ids.filter(t => d.actor(t).snap.team === 1 && (t !== vor || wave > 2 || !isInvulnerable()))
  let vorInvulnerable = true
  const isInvulnerable = () => vorInvulnerable
  const origOnDeath = d.onDeath
  d.onDeath = id => {
    origOnDeath(id)
    if (wave === 2 && !d.alive(wave2.ika) && !d.alive(wave2.har)) vorInvulnerable = false
  }

  d.start([iop, ika, cra, vor, eni, mej, enu, har, bub], 'Œil de Vortex — salle du boss')
  d.wave(1, 2, [])
  d.state(vor, INVULNERABLE.id, INVULNERABLE.name, true)
  d.log('Le Vortex est invulnérable tant que ses vagues de gardiens ne sont pas vaincues.')

  // ════════ Tour 1 ════════
  d.playRound((id): Turn => {
    switch (id) {
      case iop:
        return () => {
          d.log('IA de groupe : le Iop engage Ikargn pour fixer la mêlée.', 'ai')
          d.cast(iop, S.puissance, d.actor(iop).cell)
          d.buff(iop, iop, S.puissance.id, '+300 Puissance', 3)
          d.approach(iop, ika, 6, 4)
          const landing = d.freeCellNear(d.actor(ika).cell, 1, d.actor(iop).cell)
          d.cast(iop, S.bond, landing)
          d.teleport(iop, landing)
          d.castOn(iop, S.epeeDivine, ika, true)
          d.hit(iop, ika, 1234, Element.Air, { crit: true })
        }
      case ika:
        return () => {
          d.castOn(ika, S.morsure, iop)
          d.hit(ika, iop, 612, Element.Earth)
          d.castOn(ika, S.morsure, iop, true)
          d.hit(ika, iop, 845, Element.Earth, { crit: true })
        }
      case cra:
        return () => {
          d.cast(cra, S.tirEloigne, d.actor(cra).cell)
          d.buff(cra, cra, S.tirEloigne.id, '+6 Portée', 4)
          d.approach(cra, mej, 10, 2)
          for (const t of enemiesIn(d.castOn(cra, S.flecheExplosive, mej, true))) d.hit(cra, t, t === mej ? 905 : 688, Element.Fire, { crit: true })
          d.castOn(cra, S.flecheGlacee, har)
          d.hit(cra, har, 402, Element.Fire)
          d.buff(cra, har, S.flecheGlacee.id, '-2 PA', 1, { ap: -2 })
        }
      case vor:
        return () => {
          d.log('IA du Vortex : isole le personnage le plus éloigné de son groupe.', 'ai')
          d.castOn(vor, S.distorsion, cra)
          d.teleport(cra, d.freeCellNear(at(14, -4), 0, d.actor(cra).cell))
          d.buff(vor, cra, S.distorsion.id, 'Désynchronisé', 1, { state: DESYNC })
          d.castOn(vor, S.rayonVortex, cra)
          d.hit(vor, cra, 540, Element.Water)
        }
      case eni:
        return () => {
          d.approach(eni, iop, 6, 3)
          d.castOn(eni, S.motStimulant, iop)
          d.buff(eni, iop, S.motStimulant.id, '+2 PA', 1, { ap: 2 })
          d.castOn(eni, S.motSoignant, iop)
          d.heal(eni, iop, 980)
          d.castOn(eni, S.motPrevention, cra)
          d.shield(eni, cra, 600)
        }
      case mej:
        return () => {
          d.castOn(mej, S.rayonAbyssal, cra)
          d.hit(mej, cra, 734, Element.Water)
          d.castOn(mej, S.rayonAbyssal, cra)
          d.hit(mej, cra, 701, Element.Water)
          d.retreat(mej, cra, 2)
        }
      case enu:
        return () => {
          d.log('IA de groupe : l’Enutrof retire les PM d’Ikargn pour soulager le Iop.', 'ai')
          d.approach(enu, ika, 5, 4)
          const sacCell = d.freeCellNear(d.actor(enu).cell, 1, d.actor(ika).cell)
          d.cast(enu, S.sacAnime, sacCell)
          sac = d.summon(enu, { team: 0, kind: 'summon', name: 'Sac Animé', level: 200, hp: 1200, ap: 6, mp: 4, cell: sacCell })
          for (const t of enemiesIn(d.castOn(enu, S.pelleFantomatique, ika))) {
            d.hit(enu, t, t === ika ? 544 : 431, Element.Water)
            if (d.alive(t)) d.buff(enu, t, S.pelleFantomatique.id, '-3 PM', 1, { mp: -3 })
          }
          d.castOn(enu, S.lancerPieces, ika)
          d.hit(enu, ika, 318, Element.Water)
        }
      case har:
        return () => {
          const to = d.freeCellNear(d.actor(eni).cell, 1, d.actor(har).cell)
          d.cast(har, S.volPlane, to)
          d.teleport(har, to)
          d.castOn(har, S.griffes, eni)
          d.hit(har, eni, 562, Element.Air)
          d.buff(har, eni, S.griffes.id, '-1 PM', 1, { mp: -1 })
        }
      case bub:
        return () => {
          d.approach(bub, iop, 2)
          const center = d.actor(iop).cell
          d.cast(bub, S.flaque, center)
          d.glyph(bub, S.flaque.id, d.zone(S.flaque, center), '#7cb342', 2, (dd, f) => {
            if (dd.actor(f).snap.team === 0) dd.hit(bub, f, 236, Element.Earth, { kind: 'glyph' })
          })
          d.castOn(bub, S.crachat, iop)
          d.hit(bub, iop, 455, Element.Neutral)
        }
    }
    return undefined
  })

  // ════════ Tour 2 ════════
  d.playRound((id): Turn => {
    switch (id) {
      case iop:
        return () => {
          d.castOn(iop, S.intimidation, ika)
          d.hit(iop, ika, 268, Element.Neutral)
          d.push(iop, ika, 2, 90)
          d.approach(iop, mej, 1)
          for (const t of enemiesIn(d.castOn(iop, S.epeeCeleste, mej))) d.hit(iop, t, t === mej ? 1412 : 1105, Element.Air)
          if (d.alive(mej)) {
            d.castOn(iop, S.epeeDivine, mej)
            d.hit(iop, mej, 1186, Element.Air)
          }
        }
      case ika:
        return () => {
          if (!d.alive(sac)) return
          d.log('IA d’Ikargn : vise la cible la plus fragile à sa portée (Sac Animé).', 'ai')
          d.approach(ika, sac, 1)
          const spell = distance(d.actor(ika).cell, d.actor(sac).cell) > 1 ? S.onde : S.morsure
          d.castOn(ika, spell, sac)
          d.hit(ika, sac, 640, Element.Earth)
          d.castOn(ika, spell, sac, true)
          d.hit(ika, sac, 802, Element.Earth, { crit: true })
        }
      case cra:
        return () => {
          d.retreat(cra, vor, 3)
          d.castOn(cra, S.flecheRecul, ika)
          d.hit(cra, ika, 433, Element.Air)
          d.push(cra, ika, 3, 120)
          d.castOn(cra, S.flecheMagique, har)
          d.hit(cra, har, 781, Element.Air)
          d.castOn(cra, S.flecheMagique, har, true)
          d.hit(cra, har, 1064, Element.Air, { crit: true })
        }
      case vor:
        return () => {
          d.log('IA du Vortex : attire le soigneur à lui.', 'ai')
          d.castOn(vor, S.aspiration, eni)
          d.teleport(eni, d.freeCellNear(d.actor(vor).cell, 1, d.actor(eni).cell))
          d.castOn(vor, S.rayonVortex, eni)
          d.hit(vor, eni, 486, Element.Water)
        }
      case eni:
        return () => {
          d.tackle(eni, 1, 2)
          d.retreat(eni, vor, 3)
          d.castOn(eni, S.motSoignant, eni)
          d.heal(eni, eni, 760)
          for (const t of d.cast(eni, S.motReconstitution, d.actor(iop).cell)) if (d.actor(t).snap.team === 0) d.heal(eni, t, 640)
          if (d.alive(bub)) {
            d.castOn(eni, S.motInterdit, bub)
            d.hit(eni, bub, 523, Element.Fire)
          }
        }
      case enu:
        return () => {
          if (d.alive(bub)) {
            for (const t of enemiesIn(d.castOn(enu, S.pelleFantomatique, bub))) {
              d.hit(enu, t, 612, Element.Water)
              if (d.alive(t)) d.buff(enu, t, S.pelleFantomatique.id, '-2 PM', 1, { mp: -2 })
            }
          }
          while (d.alive(ika) && d.actor(enu).ap >= S.lancerPieces.ap) {
            d.castOn(enu, S.lancerPieces, ika)
            d.hit(enu, ika, 336, Element.Water)
          }
        }
      case bub:
        return () => {
          d.castOn(bub, S.crachat, iop)
          d.hit(bub, iop, 517, Element.Neutral)
        }
    }
    return undefined
  })

  // ════════ Tour 3 ════════
  d.playRound((id): Turn => {
    if (id === iop)
      return () => {
        const landing = d.freeCellNear(d.actor(bub).cell, 1, d.actor(iop).cell)
        d.cast(iop, S.bond, landing)
        d.teleport(iop, landing)
        d.castOn(iop, S.colere, bub, true)
        d.hit(iop, bub, 2580, Element.Earth, { crit: true })
      }
    if (id === cra)
      return () => {
        d.approach(cra, wave2.ika, 7, 2)
        for (const t of enemiesIn(d.castOn(cra, S.flecheExplosive, wave2.ika))) d.hit(cra, t, 1240, Element.Fire)
        d.castOn(cra, S.flecheMagique, wave2.ika)
        d.hit(cra, wave2.ika, 742, Element.Air)
      }
    if (id === vor)
      return () => {
        d.castOn(vor, S.rayonVortex, iop)
        d.hit(vor, iop, 688, Element.Water)
        d.castOn(vor, S.rayonVortex, cra, true)
        d.hit(vor, cra, 905, Element.Water, { crit: true })
      }
    if (id === eni)
      return () => {
        d.approach(eni, cra, 6, 4)
        d.castOn(eni, S.motSoignant, cra)
        d.heal(eni, cra, 1020)
        d.castOn(eni, S.motPrevention, iop)
        d.shield(eni, iop, 750)
        d.castOn(eni, S.motSoignant, iop)
        d.heal(eni, iop, 940)
      }
    if (id === enu)
      return () => {
        d.log('IA de groupe : l’Enutrof immobilise la seconde vague.', 'ai')
        d.approach(enu, wave2.ika, 5)
        for (const t of enemiesIn(d.castOn(enu, S.pelleFantomatique, wave2.ika))) {
          d.hit(enu, t, 598, Element.Water)
          if (d.alive(t)) d.buff(enu, t, S.pelleFantomatique.id, '-3 PM', 1, { mp: -3 })
        }
        d.castOn(enu, S.lancerPieces, wave2.ika)
        d.hit(enu, wave2.ika, 341, Element.Water)
      }
    if (id === wave2.ika)
      return () => {
        d.approach(wave2.ika, iop, 1)
        d.castOn(wave2.ika, S.morsure, iop)
        d.hit(wave2.ika, iop, 701, Element.Earth)
      }
    if (id === wave2.har)
      return () => {
        const to = d.freeCellNear(d.actor(cra).cell, 1, d.actor(wave2.har).cell)
        d.cast(wave2.har, S.volPlane, to)
        d.teleport(wave2.har, to)
        d.castOn(wave2.har, S.griffes, cra)
        d.hit(wave2.har, cra, 612, Element.Air)
        d.buff(wave2.har, cra, S.griffes.id, '-1 PM', 1, { mp: -1 })
      }
    return undefined
  })

  // ════════ Tour 4 ════════
  d.playRound((id): Turn => {
    if (id === iop)
      return () => {
        if (d.alive(wave2.ika)) {
          d.approach(iop, wave2.ika, 1)
          d.castOn(iop, S.epeeDivine, wave2.ika, true)
          d.hit(iop, wave2.ika, 1490, Element.Air, { crit: true })
        }
        if (d.alive(wave2.har) && distance(d.actor(iop).cell, d.actor(wave2.har).cell) <= 4) {
          d.castOn(iop, S.epeeDivine, wave2.har)
          d.hit(iop, wave2.har, 1150, Element.Air)
        } else {
          d.cast(iop, S.puissance, d.actor(iop).cell)
          d.buff(iop, iop, S.puissance.id, '+300 Puissance', 3)
        }
      }
    if (id === cra)
      return () => {
        if (d.alive(wave2.har)) d.tackle(cra, 0, 1)
        d.retreat(cra, wave2.har, 2)
        for (const t of [wave2.ika, wave2.har]) {
          while (d.alive(t) && d.actor(cra).ap >= S.flecheMagique.ap) {
            d.castOn(cra, S.flecheMagique, t)
            d.hit(cra, t, 812, Element.Air)
          }
        }
        if (!vorInvulnerable && d.actor(cra).ap >= S.flecheMagique.ap) {
          d.castOn(cra, S.flecheMagique, vor)
          d.hit(cra, vor, 788, Element.Air)
        }
      }
    if (id === vor)
      return () => {
        d.log('IA du Vortex : frappe la zone où le groupe est le plus serré.', 'ai')
        for (const t of d.cast(vor, S.effondrement, d.actor(iop).cell)) if (d.actor(t).snap.team === 0) d.hit(vor, t, t === iop ? 820 : 560, Element.Fire)
        d.castOn(vor, S.rayonVortex, eni)
        d.hit(vor, eni, 512, Element.Water)
      }
    if (id === eni)
      return () => {
        for (const t of d.cast(eni, S.motReconstitution, d.actor(iop).cell)) if (d.actor(t).snap.team === 0) d.heal(eni, t, 880)
        d.castOn(eni, S.motInterdit, vor)
        d.hit(eni, vor, 612, Element.Fire)
        d.castOn(eni, S.motStimulant, iop)
        d.buff(eni, iop, S.motStimulant.id, '+2 PA', 1, { ap: 2 })
      }
    if (id === enu)
      return () => {
        d.approach(enu, vor, 4)
        d.castOn(enu, S.pelleFantomatique, vor)
        d.hit(enu, vor, 702, Element.Water)
        d.buff(enu, vor, S.pelleFantomatique.id, '-3 PM', 2, { mp: -3 })
        d.castOn(enu, S.lancerPieces, vor)
        d.hit(enu, vor, 355, Element.Water)
        d.castOn(enu, S.lancerPieces, vor, true)
        d.hit(enu, vor, 498, Element.Water, { crit: true })
      }
    return undefined
  })

  // ════════ Tour 5 ════════
  d.playRound((id): Turn => {
    if (id === iop)
      return () => {
        d.approach(iop, vor, 1)
        d.castOn(iop, S.colere, vor, true)
        d.hit(iop, vor, 3420, Element.Earth, { crit: true })
        d.castOn(iop, S.epeeDivine, vor)
        d.hit(iop, vor, 1310, Element.Air)
        d.castOn(iop, S.pression, vor)
        d.hit(iop, vor, 1045, Element.Earth)
      }
    if (id === cra)
      return () => {
        while (d.alive(vor) && d.actor(cra).ap >= S.flecheMagique.ap) {
          d.castOn(cra, S.flecheMagique, vor)
          d.hit(cra, vor, 845, Element.Air)
        }
      }
    if (id === vor)
      return () => {
        d.castOn(vor, S.rayonVortex, iop)
        d.hit(vor, iop, 734, Element.Water)
      }
    if (id === eni)
      return () => {
        d.castOn(eni, S.motInterdit, vor)
        d.hit(eni, vor, 640, Element.Fire)
      }
    if (id === enu)
      return () => {
        while (d.alive(vor) && d.actor(enu).ap >= S.lancerPieces.ap) {
          d.castOn(enu, S.lancerPieces, vor)
          d.hit(enu, vor, 420, Element.Water)
        }
      }
    return undefined
  })
  if (!d.ended) d.end(null, 'Fin de l’extrait de démonstration')

  return {
    version: 1,
    events: d.events,
    map,
    meta: {
      title: 'Démo — Œil de Vortex',
      description:
        'Combat synthétique (scénarisé, pas encore simulé par le moteur) : deux vagues de gardiens puis le Vortex, invulnérable tant que ses vagues ne sont pas vaincues.',
      scenario: 'Œil de Vortex',
      seed: 42,
      generator: 'démo intégrée',
      team: [
        { name: 'Iop', breed: 'Iop', breedId: 8, role: 'DPS mêlée', build: 'Air/Terre · 12 PA 6 PM', fighterId: iop },
        { name: 'Crâ', breed: 'Crâ', breedId: 9, role: 'DPS distance', build: 'Feu/Air · 12 PA 6 PM · +6 PO', fighterId: cra },
        { name: 'Eniripsa', breed: 'Eniripsa', breedId: 7, role: 'Soin', build: 'Feu/Eau · soins', fighterId: eni },
        { name: 'Enutrof', breed: 'Enutrof', breedId: 3, role: 'Retrait PM', build: 'Eau · retrait PM', fighterId: enu },
      ],
      fighters: {
        [vor]: { boss: true, notes: 'Invulnérable tant que des gardiens de vague sont en vie.' },
        [iop]: {
          stats: { Vitalité: 3200, Force: 850, Agilité: 900, Puissance: 220, Dommages: 95, '% Critique': 42 },
          spells: ['Épée Divine', 'Épée Céleste', 'Bond', 'Pression', 'Colère de Iop', 'Intimidation', 'Puissance'],
        },
        [cra]: {
          stats: { Vitalité: 2500, Intelligence: 980, Agilité: 760, Portée: 6, '% Critique': 38 },
          spells: ['Flèche Explosive', 'Flèche Glacée', 'Flèche Magique', 'Flèche de Recul', 'Tir Éloigné'],
        },
        [eni]: {
          stats: { Vitalité: 2400, Intelligence: 900, Chance: 700, Soins: 140 },
          spells: ['Mot Soignant', 'Mot de Reconstitution', 'Mot Stimulant', 'Mot de Prévention', 'Mot Interdit'],
        },
        [enu]: {
          stats: { Vitalité: 2800, Chance: 1050, 'Retrait PM': 110, Prospection: 320 },
          spells: ['Pelle Fantomatique', 'Lancer de Pièces', 'Sac Animé'],
        },
      },
    },
  }
}
