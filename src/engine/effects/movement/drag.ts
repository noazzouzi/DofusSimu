/**
 * Poussées et attirances (« drag ») — port D3 `PushUtils` (mechanics.md §15, formulas.md §10) :
 *
 *  - direction (`GetPushDirection`) : de la case ciblée vers la cible, ou du lanceur (sa case AVANT le sort) si la
 *    cible est sur la case ciblée ; depuis la case principale de la marque pour un effet de piège/glyphe ; alignement
 *    diagonal ⇒ direction diagonale (paire), sinon direction de déplacement la plus proche (`lookDirection4`). Une
 *    attirance prend la direction opposée, calculée depuis la case ACTUELLE du lanceur ;
 *  - en diagonale, une force n déplace de ceil(n / 2) cases, et chaque pas exige que les deux cases latérales soient
 *    libres (`AdjacentCellsAllowAccess`) ;
 *  - arrêt : case non marchable / hors carte / occupée (collision), piège (le poussé s'arrête SUR le piège, sans
 *    dommages de collision) ; un portail actif transporte le poussé, qui continue depuis la sortie avec la force
 *    restante ;
 *  - immunités : Indéplaçable (état 3), « CantBePushed » (état 0), monstre `canBePushed = false` — sauf poussée
 *    forcée (1021 / 1022). L'invulnérabilité n'empêche PAS la poussée (seulement les dommages) ;
 *  - dommages de collision (5 et 1041 seulement) : force restante (×2 en diagonale) ; cible k = 0 puis au plus
 *    `force` combattants percutés en chaîne derrière elle (k = 1, 2...), chacun avec SES résistances poussée :
 *    `trunc(force × (floor(niv/2) + 32 + DoPou − RePou) / (4 × 2^k))` (src/damage/push.ts, variante 'dofus3') ; niveau
 *    de l'invocateur pour une invocation ; puis × « dommages subis » (1163) de la cible s'il s'applique à la poussée
 *    (buff instantané ou déclencheur PD : effects/damage/pipeline.ts `sustainedPercent`) — ni résistances, ni armure,
 *    ni bonus ; nuls si le lanceur est Pacifiste ou la cible immunisée (effet d'état 26) ; appliqués par
 *    `Engine.applyDamage(kind 'push')` (bouclier, érosion) ⇒ déclencheurs PD / CPD ;
 *  - un porteur poussé lâche le porté sur sa case de départ ; la case d'arrivée déclenche ses marques ;
 *  - déclencheurs : 'P' (poussé) ou 'MA' (attiré) sur la cible si elle a bougé, 'PO' sur le lanceur.
 *
 * Chemin critique de l'IA : aucune allocation hors événements de replay (résultat du calcul de destination dans des
 * variables de module).
 */
import { pushDamage } from '../../../damage/push'
import {
  CELL_X,
  CELL_Y,
  cellInDirection,
  directionBetween,
  distance,
  lookDirection4,
  lookDirection8,
  oppositeDirection,
} from '../../../map/geometry'
import type { Engine } from '../../engine'
import type { Fighter, FightState, Glyph } from '../../types'
import { sustainedPercent } from '../damage/pipeline'
import { throwCarried } from './carry'
import {
  cantBeMoved,
  cantBePushed,
  enterCell,
  fireMoveTriggers,
  hasStateEffect,
  isFreeCell,
  isPacifist,
  monsterFlag,
  SE_INVULNERABLE_TO_PUSH,
  setCell,
} from './common'
import { hasAnyPortal, portalAt, portalExit, travelThrough } from './portals'

/**
 * Direction de poussée (`PushUtils.GetPushDirection`) d'une cible en `targetPos`, pour un effet centré sur
 * `targeted` et une source `source` (lanceur avant le sort, ou case principale de la marque). −1 si aucune.
 */
export function pushDirection(source: number, targeted: number, targetPos: number): number {
  if (targetPos < 0) return -1
  if (targetPos === targeted && targetPos === source) return -1
  const mid = targeted === targetPos ? source : targeted
  if (mid < 0 || mid === targetPos) return -1
  const adx = Math.abs(CELL_X[targetPos] - CELL_X[mid])
  const ady = Math.abs(CELL_Y[targetPos] - CELL_Y[mid])
  return adx === ady ? directionBetween(mid, targetPos) : lookDirection4(mid, targetPos)
}

/** Direction d'attirance (`GetPullDirection`) : opposée à la poussée. */
export function pullDirection(source: number, targeted: number, targetPos: number): number {
  const d = pushDirection(source, targeted, targetPos)
  return d < 0 ? d : oppositeDirection(d)
}

/**
 * Ordre d'application des cibles (port `TargetManagement.ComparePositions`, tri de `DamageCalculator.ComputeEffect`) :
 * distance à la case ciblée `ref` décroissante pour une poussée (`push`), croissante sinon ; à distance égale,
 * direction approchée depuis `ref` (`GetLookDirection8`, rang `(dir + 1) % 8` décroissant pour une poussée), puis
 * numéro de case (décroissant pour les directions 0 / 5 / 6 / 7 d'une poussée, croissant sinon ; inversé pour une
 * attirance). Ordre total : le résultat ne dépend pas de l'algorithme de tri.
 */
export function comparePositions(ref: number, push: boolean, p1: number, p2: number): number {
  const sign = push ? 1 : -1
  const dA = distance(p1, ref)
  const dB = distance(p2, ref)
  if (dA !== dB) return (dB - dA) * sign
  if (p1 === p2) return 0
  let dirA = lookDirection8(ref, p1)
  let dirB = lookDirection8(ref, p2)
  if (dirA === dirB) {
    dirB = 0
    if (dirA === 0 || dirA === 7 || dirA === 6 || dirA === 5) dirA = p1 < p2 ? -1 : 1
    else dirA = p1 < p2 ? 1 : -1
  } else {
    dirA = (dirA + 1) % 8
    dirB = (dirB + 1) % 8
  }
  return (dirB - dirA) * sign
}

// ───────────────────────────── destination ─────────────────────────────

const STOP_COMPLETE = 0
const STOP_COLLISION = 1
/** Piège / mur : arrêt SUR la case, sans dommages de collision (`StopReason = ActiveObject`). */
const STOP_ACTIVE_OBJECT = 2
const STOP_PORTAL = 3

// Résultat de `dragDestination` (pas d'allocation).
let destCell = -1
let destRemaining = 0
let destStop = STOP_COMPLETE

function trapAt(fight: FightState, cell: number): boolean {
  const ts = fight.traps
  for (let i = 0; i < ts.length; i++) if (ts[i].cells.includes(cell)) return true
  return false
}

/** Un pas de `from` vers `to` (direction `dir`) est-il bloqué ? (`IsPathBlocked` + `AdjacentCellsAllowAccess`) */
function pathBlocked(engine: Engine, fight: FightState, from: number, to: number, dir: number): boolean {
  if (!isFreeCell(engine, fight, to)) return true
  if ((dir & 1) === 1) return false
  return !isFreeCell(engine, fight, cellInDirection(from, (dir + 1) & 7)) || !isFreeCell(engine, fight, cellInDirection(from, (dir + 7) & 7))
}

/** `PushUtils.GetDragCellDest` : destination, force restante et raison d'arrêt d'un glissement de `steps` pas. */
function dragDestination(
  engine: Engine,
  fight: FightState,
  mover: Fighter,
  from: number,
  dir: number,
  steps: number,
  portals: boolean,
  used: readonly Glyph[],
): void {
  let cur = from
  for (let i = 1; i <= steps; i++) {
    const next = cellInDirection(cur, dir)
    if (pathBlocked(engine, fight, cur, next, dir)) {
      destCell = cur
      destRemaining = steps - (i - 1)
      destStop = STOP_COLLISION
      return
    }
    const trap = fight.traps.length > 0 && trapAt(fight, next)
    if (trap || (portals && activePortalOnPath(engine, fight, next, mover, used))) {
      destCell = next
      destRemaining = steps - i
      destStop = trap ? STOP_ACTIVE_OBJECT : STOP_PORTAL
      return
    }
    cur = next
  }
  destCell = cur
  destRemaining = 0
  destStop = STOP_COMPLETE
}

/** Portail « actif » sur la trajectoire (port `Mark.Active`) : il mène quelque part. */
function activePortalOnPath(engine: Engine, fight: FightState, cell: number, mover: Fighter, used: readonly Glyph[]): boolean {
  const p = portalAt(fight, cell)
  return p !== undefined && portalExit(engine, fight, p, mover, used) !== undefined
}

// ───────────────────────────── glissement ─────────────────────────────

export interface DragOptions {
  /** Poussée / attirance forcée (1021 / 1022) : ignore les immunités. */
  forced?: boolean
  /** Dommages de collision (5, 1041). */
  collision?: boolean
  /** Attirance (déclencheur MA) plutôt que poussée (P). */
  pull?: boolean
}

/** Le combattant peut-il être poussé / attiré ? (`HaxeFighter.CanBePushed`) */
export function canBePushed(engine: Engine, f: Fighter): boolean {
  return !cantBeMoved(engine, f) && monsterFlag(engine, f, 'canBePushed') && !cantBePushed(engine, f)
}

/**
 * Fait glisser `f` de `distance` (force) dans la direction `dir` (`PushUtils.Drag`). `author` = lanceur de l'effet
 * (dommages de collision, déclencheurs). Retourne vrai si `f` a changé de case.
 */
export function dragFighter(
  engine: Engine,
  fight: FightState,
  author: Fighter,
  f: Fighter,
  distance: number,
  dir: number,
  opts: DragOptions = {},
): boolean {
  if (!f.alive || dir < 0 || dir > 7 || !(distance > 0) || f.carriedBy !== undefined) return false
  if (!opts.forced && !canBePushed(engine, f)) return false
  let steps = (dir & 1) === 0 ? Math.ceil(distance / 2) : distance
  const initial = f.cell
  const portals = fight.glyphs.length > 0 && hasAnyPortal(fight)
  let used: Glyph[] | undefined
  let segmentStart = initial
  let moved = false
  let stop = STOP_COMPLETE
  let remaining = 0
  for (;;) {
    dragDestination(engine, fight, f, f.cell, dir, steps, portals, used ?? NO_PORTALS)
    stop = destStop
    remaining = destRemaining
    const to = destCell
    if (to === f.cell) break
    if (!moved) {
      moved = true
      // Un porteur poussé lâche le porté sur sa case de départ (port `Drag` → `ThrowFighter`).
      if (f.carrying !== undefined) throwCarried(engine, fight, f, f.cell, author)
    }
    setCell(fight, f, to)
    if (stop === STOP_PORTAL) {
      const entry = portalAt(fight, to)
      if (entry !== undefined) {
        if (fight.options.record && segmentStart !== to) engine.emit(fight, { t: 'push', target: f.id, from: segmentStart, to })
        used ??= []
        travelThrough(engine, fight, f, entry, used, author, true)
        segmentStart = f.cell
      }
    }
    steps = remaining
    if (stop !== STOP_PORTAL || steps <= 0 || !f.alive) break
  }

  // Dommages de collision (force restante, ×2 en diagonale) : cible puis percutés en chaîne.
  let force = opts.collision && stop !== STOP_ACTIVE_OBJECT && remaining > 0 && f.alive ? remaining : 0
  if ((dir & 1) === 0) force *= 2
  const firstHit = force > 0 ? collidedAt(engine, fight, cellInDirection(f.cell, dir)) : undefined
  const dmg0 = force > 0 ? collisionDamage(engine, fight, author, f, force, 0) : 0
  if (fight.options.record && (moved || force > 0)) {
    engine.emit(fight, {
      t: 'push',
      target: f.id,
      from: segmentStart,
      to: f.cell,
      collisionWith: firstHit?.id,
      collisionDamage: force > 0 ? dmg0 : undefined,
    })
  }
  if (force > 0) {
    const stopCell = f.cell
    applyCollision(engine, fight, author, f, dmg0)
    // Percutés : une case de plus par point de force (port `GetCollateralTargets`), même force, diviseur 2^k.
    let cell = cellInDirection(stopCell, dir)
    let hit = collidedAt(engine, fight, cell)
    for (let k = 1, n = force; n > 0 && hit !== undefined && !fight.ended; k++, n--) {
      applyCollision(engine, fight, author, hit, collisionDamage(engine, fight, author, hit, force, k))
      cell = cellInDirection(cell, dir)
      hit = collidedAt(engine, fight, cell)
    }
  }
  if (!moved || fight.ended) return moved
  if (f.alive) {
    enterCell(engine, fight, f, f.cell)
    // 'PT' a déjà été émis au passage d'un portail (travelThrough).
    if (!fight.ended) fireMoveTriggers(engine, fight, f, opts.pull ? 'MA' : 'P', author)
  }
  return moved
}

const NO_PORTALS: readonly Glyph[] = []

function collidedAt(engine: Engine, fight: FightState, cell: number): Fighter | undefined {
  if (cell < 0) return undefined
  const o = engine.fighterAt(fight, cell)
  return o !== undefined && o.alive ? o : undefined
}

/** Niveau servant aux dommages de poussée : celui de l'invocateur pour une invocation (`GetCollisionDamage`). */
function pusherLevel(fight: FightState, author: Fighter): number {
  if (author.summonerId !== undefined) {
    const s = fight.fighters[author.summonerId]
    if (s !== undefined) return s.level
  }
  return author.level
}

const PUSH_INFO = { kind: 'push' as const }

/** Dommages de collision subis par `target` au rang `k` de la chaîne (avant bouclier). */
export function collisionDamage(engine: Engine, fight: FightState, author: Fighter, target: Fighter, force: number, k: number): number {
  if (force <= 0 || isPacifist(engine, author)) return 0
  const sustained = target.buffs.length > 0 ? sustainedPercent(fight, target, author, PUSH_INFO) : 100
  return pushDamage({
    casterLevel: pusherLevel(fight, author),
    pushDamage: author.stats.pushDamage,
    pushRes: target.stats.pushRes,
    remainingCells: force,
    chainIndex: k,
    variant: 'dofus3',
    sustainedPct: sustained === 100 ? undefined : sustained,
  })
}

function applyCollision(engine: Engine, fight: FightState, author: Fighter, target: Fighter, amount: number): void {
  if (amount <= 0 || !target.alive || hasStateEffect(engine, target, SE_INVULNERABLE_TO_PUSH)) return
  engine.applyDamage(fight, author, target, amount, -1, 'push')
}
