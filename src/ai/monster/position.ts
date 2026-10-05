/**
 * Position des monstres : score d'une case par comportement et déplacement de fin de tour (docs/design/ai.md §11.5 ;
 * docs/research/monster-ai.md §8.6) — WP1.
 *
 *   pos(c) = glyph(c) + behaviourTerm(c) − λ·danger(c) + hook endPosition(c)
 *
 *  | comportement | behaviourTerm(c) |
 *  |---|---|
 *  | aggressive   | −20·dist(c, focale) + 40·ennemis adjacents (R1 ; 10 s'il ne peut pas tacler) |
 *  | kiter        | −20·|dist(c, focale) − portée idéale| + 30·[aligné selon ses sorts] + 15·[LdV] − 25·[au contact] |
 *  | fearful      | +15·distMin(c, ennemis) (après une action offensive, ou R13) ; sinon comme aggressive (R12) |
 *  | devoted      | −20·dist(c, invocateur) + 10·distMin(c, ennemis) |
 *  | blocker      | 60·ennemis adjacents − 5·distMin(c, ennemis) (R23) |
 *  | mad          | comme aggressive, tout le monde étant ennemi |
 *  | apathetic    | +10·distMin(c, ennemis) |
 *  | support      | +30·alliés à portée de soin + 10·min(distMin, 6) − 25·[au contact] |
 *  | static       | ne bouge pas |
 *
 * `dist(c, focale)` : distance de marche (BFS sur les cases libres) depuis la case de la focale — un monstre ne se
 * colle pas au mur du centre de l'horloge ; repli : distance + 4. `danger(c)` = Σ menace des ennemis qui atteignent c
 * au prochain tour (PM + portée), × 0,5 si un autre monstre est plus proche d'eux ; λ : kiter 0,03, fearful 0,06,
 * support 0,04, sinon 0. `glyph(c)` (R3) : valeur des effets des glyphes de début/fin de tour pour CE monstre (soin
 * seulement s'il est blessé, dégâts et retraits négatifs). Fin de tour : meilleure case atteignable (tacle exact,
 * pièges connus et glyphes « à l'entrée » contournés : R4, R5, R14), immobile si le gain < `endMoveMinGain` (5 PVe).
 */
import { matchesTargetMask } from '../../engine/targetMask'
import type { Fighter, FightState } from '../../engine/types'
import { CELL_COUNT, distance, inDiagonal, inLine, neighborsOf } from '../../map/geometry'
import { UNREACHABLE, GridSearch } from '../../map/path'
import { castGeom, levelFor, LosOracle } from '../core/castCells'
import { buildOccupancy, computeReach, reachPath } from '../core/reach'
import { believedCell } from '../core/view'
import type { MonsterContext } from './context'
import type { Behaviour } from './types'

/** Cadre de position d'un état : tout ce qui ne dépend pas de la case évaluée. */
export interface PosFrame {
  s: FightState
  behaviour: Behaviour
  meId: number
  enemies: { f: Fighter; cell: number; reach: number; threat: number }[]
  allyCells: number[]
  focalCell: number
  /** Distances de marche depuis la focale (null : pas de focale). */
  focalDist: Int16Array | null
  summonerCell: number
  ideal: number
  align: 'none' | 'line' | 'diag' | 'any'
  los: LosOracle | null
  lambda: number
  adjWeight: number
  healRange: number
  /** Valeur des glyphes par case (null : aucune glyphe active). */
  glyph: Float32Array | null
  hook: ((cell: number) => number) | null
}

const SEARCH = new GridSearch()
const DAMAGE_EFFECTS = new Set([96, 97, 98, 99, 100, 91, 92, 93, 94, 95, 82, 1012, 1013, 1014, 1015, 1016])
const HEAL_EFFECTS = new Set([81, 108, 143, 407, 1109, 2998, 2999, 3000, 3001, 3002])
const LOSS_EFFECTS = new Set([77, 84, 101, 127, 168, 169, 1079, 1080])
const BUFF_EFFECTS = new Set([110, 111, 112, 115, 117, 118, 119, 123, 125, 126, 128, 138, 160, 161, 178])

/** Comportement de fin de tour (bascule R12/R13 déjà appliquée par le cerveau). */
export function endBehaviour(ctx: MonsterContext): Behaviour {
  const b = ctx.baseBehaviour
  if (b !== 'fearful') return b
  if (ctx.offensive) return 'fearful'
  return ctx.me.tags.aiFearAggro === true ? 'aggressive' : 'fearful'
}

/** Comportement utilisé pendant le tour (cases de lancer). */
export function turnBehaviour(ctx: MonsterContext): Behaviour {
  return ctx.behaviour
}

/** Cadre de position du monstre de `ctx` sur l'état `s` (focale de la racine si elle y est vivante, sinon la plus proche). */
export function buildFrame(ctx: MonsterContext, s: FightState, behaviour: Behaviour): PosFrame {
  const me = s.fighters[ctx.me.id] ?? ctx.me
  const team = ctx.team
  const enemies: PosFrame['enemies'] = []
  const allyCells: number[] = []
  for (const f of s.fighters) {
    if (!f.alive || f.id === me.id || f.carriedBy !== undefined) continue
    const cell = believedCell(f, team)
    if (cell < 0) continue
    if (ctx.isEnemy(f)) enemies.push({ f, cell, reach: -1, threat: 0 })
    else if (f.team === team) allyCells.push(cell)
  }
  let focalCell = -1
  const root = ctx.focal()
  if (root) {
    const f = s.fighters[root.id]
    if (f && f.alive) focalCell = believedCell(f, team)
  }
  if (focalCell < 0 && enemies.length) {
    let best = 1e9
    for (const e of enemies) {
      const d = distance(me.cell, e.cell)
      if (d < best) {
        best = d
        focalCell = e.cell
      }
    }
  }
  let focalDist: Int16Array | null = null
  if (focalCell >= 0 && (behaviour === 'aggressive' || behaviour === 'mad')) {
    const occ = buildOccupancy(s, team)
    const cells = s.map.cells
    SEARCH.run(focalCell, c => !!cells[c]?.walkable && (occ[c] < 0 || occ[c] === me.id))
    focalDist = SEARCH.dist.slice()
  }
  // Géométrie de ses sorts de dégâts (kiter) : alignement exigé et ligne de vue.
  let line = 0
  let diag = 0
  let free = 0
  let anyLos = false
  const profiles = ctx.spellProfiles(me)
  let healRange = 0
  for (let i = 0; i < me.spells.length; i++) {
    const p = profiles[i]
    const lvl = levelFor(me, me.spells[i])
    if (p.heals.some(h => h.sides.ally)) healRange = Math.max(healRange, castGeom(me, lvl).max)
    if (!p.damage.length || lvl.range === 0) continue
    if (lvl.castInLine && !lvl.castInDiagonal) line++
    else if (lvl.castInDiagonal && !lvl.castInLine) diag++
    else free++
    if (lvl.castTestLos) anyLos = true
  }
  const align: PosFrame['align'] = free > 0 || line + diag === 0 ? 'none' : line > 0 && diag > 0 ? 'any' : line > 0 ? 'line' : 'diag'
  const pr = ctx.profile.preferredRange ?? ctx.archetype.preferredRange ?? [1, 1]
  const ideal = Math.max(Math.min(Math.max(2, pr[0]), pr[1]), Math.round((pr[0] + pr[1]) / 2))
  const lambda = behaviour === 'kiter' ? 0.03 : behaviour === 'fearful' ? 0.06 : behaviour === 'support' ? 0.04 : 0
  // Menace et portée des ennemis : seulement pour le terme de danger (λ > 0).
  if (lambda > 0) {
    for (const e of enemies) {
      e.reach = ctx.attackReach(e.f)
      e.threat = ctx.threatOf(e.f)
    }
  }
  const summoner = me.summonerId !== undefined ? s.fighters[me.summonerId] : undefined
  const canTackle = me.tags.canTackle !== false && !me.tags.cantTackle && !ctx.engine.stateFlag(me, 'cantTackle')
  const frame: PosFrame = {
    s, behaviour, meId: me.id, enemies, allyCells, focalCell, focalDist,
    summonerCell: summoner && summoner.alive ? summoner.cell : -1,
    ideal, align,
    los: behaviour === 'kiter' && anyLos && focalCell >= 0 ? new LosOracle(s, team, me.id) : null,
    lambda, adjWeight: canTackle ? 40 : 10, healRange: Math.max(1, healRange),
    glyph: s.glyphs.length ? glyphValues(ctx, s, me) : null,
    hook: null,
  }
  const hook = ctx.profile.hooks?.endPosition
  if (hook) frame.hook = cell => hook(ctx, cell, s)
  return frame
}

/** Valeur des glyphes actives (début / fin de tour, auras) pour `me`, par case (R3). */
function glyphValues(ctx: MonsterContext, s: FightState, me: Fighter): Float32Array {
  const out = new Float32Array(CELL_COUNT)
  const missing = me.maxHp - me.hp
  for (const g of s.glyphs) {
    if (g.trigger === 'enter') continue
    const src = s.fighters[g.sourceId] ?? me
    let v = 0
    for (const e of g.effects) {
      if (!matchesTargetMask(e.targetMask, src, me)) continue
      const avg = (e.diceNum + Math.max(e.diceNum, e.diceSide)) / 2
      if (DAMAGE_EFFECTS.has(e.effectId)) v -= avg * 4
      else if (HEAL_EFFECTS.has(e.effectId)) v += missing > 0 ? Math.min(missing, avg * 4) : 0
      else if (LOSS_EFFECTS.has(e.effectId)) v -= 30 * Math.max(1, e.diceNum)
      else if (BUFF_EFFECTS.has(e.effectId)) v += 20
    }
    if (!v) continue
    for (const c of g.cells) if (c >= 0 && c < CELL_COUNT) out[c] += v
  }
  return out
}

function adjacentEnemies(frame: PosFrame, cell: number): number {
  let n = 0
  for (const e of frame.enemies) if (distance(cell, e.cell) === 1) n++
  return n
}

function distMin(frame: PosFrame, cell: number): number {
  let d = 99
  for (const e of frame.enemies) {
    const x = distance(cell, e.cell)
    if (x < d) d = x
  }
  return frame.enemies.length ? d : 0
}

/** Σ menace des ennemis qui atteignent `cell` au prochain tour (× 0,5 si un autre monstre leur est plus proche). */
function danger(frame: PosFrame, cell: number): number {
  let v = 0
  for (const e of frame.enemies) {
    if (e.reach < 0 || e.threat <= 0) continue
    const d = distance(cell, e.cell)
    if (d > e.reach) continue
    let closer = false
    for (const a of frame.allyCells) {
      if (distance(a, e.cell) < d) {
        closer = true
        break
      }
    }
    v += closer ? 0.5 * e.threat : e.threat
  }
  return v
}

function focalDistance(frame: PosFrame, cell: number): number {
  if (frame.focalCell < 0) return distMin(frame, cell)
  if (frame.focalDist) {
    const d = frame.focalDist[cell]
    if (d !== UNREACHABLE) return d
  }
  return distance(cell, frame.focalCell) + 4
}

/** Score de position d'une case (voir l'en-tête). */
export function posScore(frame: PosFrame, cell: number): number {
  let v = frame.glyph ? frame.glyph[cell] : 0
  switch (frame.behaviour) {
    case 'aggressive':
    case 'mad':
      v += -20 * focalDistance(frame, cell) + frame.adjWeight * adjacentEnemies(frame, cell)
      break
    case 'kiter': {
      if (frame.focalCell >= 0) {
        const d = distance(cell, frame.focalCell)
        v -= 20 * Math.abs(d - frame.ideal)
        if (frame.align !== 'none') {
          const l = inLine(cell, frame.focalCell)
          const dg = inDiagonal(cell, frame.focalCell)
          if ((frame.align === 'line' && l) || (frame.align === 'diag' && dg) || (frame.align === 'any' && (l || dg))) v += 30
        }
        if (frame.los && frame.los.los(cell, frame.focalCell)) v += 15
      }
      if (adjacentEnemies(frame, cell) > 0) v -= 25
      break
    }
    case 'fearful':
      v += 15 * distMin(frame, cell)
      break
    case 'devoted':
      if (frame.summonerCell >= 0) v -= 20 * distance(cell, frame.summonerCell)
      v += 10 * distMin(frame, cell)
      break
    case 'blocker':
      v += 60 * adjacentEnemies(frame, cell) - 5 * distMin(frame, cell)
      break
    case 'apathetic':
      v += 10 * distMin(frame, cell)
      break
    case 'support': {
      let n = 0
      for (const a of frame.allyCells) if (distance(cell, a) <= frame.healRange) n++
      v += 30 * n + 10 * Math.min(distMin(frame, cell), 6)
      if (adjacentEnemies(frame, cell) > 0) v -= 25
      break
    }
    case 'static':
      break
  }
  if (frame.lambda > 0) v -= frame.lambda * danger(frame, cell)
  if (frame.hook) v += frame.hook(cell)
  return v
}

/**
 * Déplacement de fin de tour (§11.5) avec les PM restants : meilleure case atteignable (tacle exact, R4/R5 ; pièges
 * connus et glyphes « à l'entrée » contournés, R14), immobile si le gain < `endMoveMinGain`. Renvoie le chemin joué.
 */
export function finalMove(ctx: MonsterContext): number[] | null {
  const me = ctx.me
  const fight = ctx.fight
  if (!me.alive || fight.ended || me.mp < 1 || me.tags.endTurnNow) return null
  const behaviour = endBehaviour(ctx)
  if (behaviour === 'static') return null
  const reach = computeReach(ctx.view, fight, me, { allowEventCells: harmlessGlyphCells(fight, me) })
  if (reach.count <= 1) return null
  const frame = buildFrame(ctx, fight, behaviour)
  if (!frame.enemies.length && behaviour !== 'devoted' && !frame.glyph && !frame.hook) return null
  const start = me.cell
  const here = posScore(frame, start)
  let best = start
  let bestV = here
  let bestCost = 0
  for (let i = 0; i < reach.count; i++) {
    const c = reach.cells[i]
    if (c === start) continue
    const v = posScore(frame, c)
    const cost = reach.mpLeft[start] - reach.mpLeft[c]
    if (v > bestV + 1e-9 || (Math.abs(v - bestV) <= 1e-9 && (cost < bestCost || (cost === bestCost && c < best)))) {
      best = c
      bestV = v
      bestCost = cost
    }
  }
  if (best === start || bestV - here < ctx.w.endMoveMinGain) return null
  const path = reachPath(reach, start, best)
  if (!path || path.length < 2) return null
  ctx.note('intent', `${me.name} se replace (${behaviour})`, [best])
  return ctx.perform({ type: 'move', path }) ? path : null
}

/**
 * Cases de glyphes « à l'entrée » sans effet sur `me` (masques : glyphes des monstres du Vortex qui ne visent que les
 * personnages) : admises comme cases d'arrivée de fin de tour (l'accessibilité du socle les contourne par défaut).
 */
export function harmlessGlyphCells(s: FightState, me: Fighter): Set<number> | undefined {
  let out: Set<number> | undefined
  for (const g of s.glyphs) {
    if (g.trigger !== 'enter') continue
    const src = s.fighters[g.sourceId] ?? me
    if (g.effects.some(e => matchesTargetMask(e.targetMask, src, me))) continue
    out ??= new Set()
    for (const c of g.cells) out.add(c)
  }
  return out
}

/** Cases voisines libres (aide des overrides). */
export function freeNeighbours(s: FightState, cell: number, team: Fighter['team']): number[] {
  const occ = buildOccupancy(s, team)
  return neighborsOf(cell).filter(c => s.map.cells[c]?.walkable && occ[c] < 0)
}
