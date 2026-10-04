/**
 * Modèle abstrait de l'Œil de Vortex pour le planificateur d'heures (docs/design/ai.md §12.3, §12.5) — WP3.
 *
 * État ABSTRAIT (pas de cases ni de sorts) : heure, monstres (statut, PV, heures de mort, étoile), heures distinctes
 * posées. Les transitions reproduisent les règles du moteur vérifiées par T-clock / le tracker :
 *  - `beginSlot` (passage au créneau i de la prévision `forecastHours`) : fin de tour de jeu (vagues `pending →
 *    invulnerable → alive`, invulnérables `arrivalInvulnerableTurns` tours), heure du créneau (+ décalage des glyphes du
 *    plan), ÉTOILES recalculées à chaque arrivée d'heure (4996 : retire toutes les étoiles, les pose sur les monstres
 *    vivants non corrompus qui portent l'heure qui arrive), créneau du Vortex : résurrection et corruption des tués sous
 *    étoile. PV d'un ressuscité comme dans le moteur : `rezHpPct`·PV de base (780), puis la Vitalité de XI (+30 % des
 *    PV de base, 1078 de 5002) s'ajoute aux PV courants ET aux PV max, sans cumul d'une vie à l'autre (bonus en
 *    `dispellable` 2, vortex.md §6) ;
 *  - `applyAbs` (créneau joueur) : glyphes « avant », morts (heure de mort marquée ; sous étoile ⇒ corrompu au réveil),
 *    pré-dégâts plafonnés à PV − 1, glyphes « après ».
 * Les coûts (exposition, coûts d'heures, prix) appartiennent au planificateur (planner.ts, WP3b) : ce module fournit
 * `exposureAt`, `killProbability` (oracle §12.6) et `absHash` (déduplication §12.5).
 *
 * Copie paresseuse : `monsters` est partagé tant qu'aucun monstre ne change ; un monstre modifié est remplacé.
 */
import { mix32 } from '../../core/hash'
import type { Fighter, FightState } from '../../engine/types'
import type { AbsAction, ClockSlot, MonsterTrack, PlanStep } from '../types'
import { hourBit, maskHas } from './clock'
import { HOUR_COUNT, nextHour } from './constants'
import { vortexState } from './params'
import { trackVortex, type TrackOptions } from './tracker'

export interface AbsMonster {
  /** Id du combattant (négatif pour un monstre d'une vague à venir, cf. tracker). */
  id: number
  monsterId: number
  wave: number
  status: MonsterTrack['status']
  hp: number
  maxHp: number
  /** Heures de mort (masque 12 bits). */
  hours: number
  star: boolean
  /** Tué sous étoile : corrompu à la prochaine résurrection (créneau du Vortex). */
  corruptOnWake: boolean
  /** Vague à venir : tour d'arrivée ; vague arrivée invulnérable : tour où l'invulnérabilité tombe. */
  arrivesRound?: number
  invulnerableUntil?: number
  /** Menace propre (PVe/tour) : coût d'exposition quand le monstre joue. */
  threat: number
  /** PV max hors bonus (base des résurrections) ; défaut : `maxHp`. */
  baseMaxHp?: number
}

/** Pas d'un plan chaîné (trace remontante). */
export interface AbsTrace {
  step: PlanStep
  prev: AbsTrace | null
}

export interface AbsState {
  /** Index du créneau courant dans la prévision. */
  slotIdx: number
  hour: number
  /** Heures avancées par les glyphes du plan depuis la racine (décalage des heures prévues). */
  glyphShift: number
  round: number
  vortexTurns: number
  /** ≤ 24 monstres (copie paresseuse). */
  monsters: readonly AbsMonster[]
  /** Heures distinctes posées (masque) : bonus hérités par le Vortex. */
  hoursUsed: number
  score: number
  trace: AbsTrace | null
}

export interface AbsParams {
  /** PV des ressuscités en % des PV max de base (moyenne du jet). */
  rezHpPct: number
  /** Bonus de PV de l'heure XI (+30 % des PV de base, ajouté aux PV courants et max). */
  vitalityXiPct: number
  /** Tours de jeu d'invulnérabilité d'une vague qui arrive (`arrivalInvulnerableTurns`, défaut 1). */
  arrivalInvulnerableTurns?: number
}

export const DEFAULT_ABS_PARAMS: Readonly<AbsParams> = { rezHpPct: 25, vitalityXiPct: 30, arrivalInvulnerableTurns: 1 }

/** Paramètres abstraits depuis l'état du scénario (moyenne du jet `rezHpPct`). */
export function absParamsOf(fight: FightState): AbsParams {
  const vx = vortexState(fight)
  if (!vx) return { ...DEFAULT_ABS_PARAMS }
  return {
    rezHpPct: (vx.rezHpPct[0] + vx.rezHpPct[1]) / 2,
    vitalityXiPct: DEFAULT_ABS_PARAMS.vitalityXiPct,
    arrivalInvulnerableTurns: vx.arrivalInvulnerableTurns,
  }
}

/**
 * PV max et PV d'un monstre ressuscité (voir l'en-tête) : `base`·(1 + XI·30 %) et `rezHpPct`·`base` + bonus de XI.
 * Mêmes arrondis que le moteur (780 : plancher du pourcentage ; 1078 : plancher de 30 % des PV de base).
 */
export function resurrection(m: Pick<AbsMonster, 'hours' | 'maxHp' | 'baseMaxHp'>, p: AbsParams = DEFAULT_ABS_PARAMS): { hp: number; maxHp: number } {
  const base = m.baseMaxHp ?? m.maxHp
  const bonus = maskHas(m.hours, 11) ? Math.floor((base * p.vitalityXiPct) / 100) : 0
  const maxHp = base + bonus
  return { maxHp, hp: Math.max(1, Math.min(maxHp, Math.floor((base * p.rezHpPct) / 100) + bonus)) }
}

/** Racine abstraite au créneau 0 de `slots` (observée par le tracker). */
export function absFromFight(fight: FightState, slots: readonly ClockSlot[], o: TrackOptions = {}): AbsState {
  const snap = trackVortex(fight, o)
  const vx = vortexState(fight)
  const monsters: AbsMonster[] = snap.tracks.map(t => ({
    id: t.fighterId,
    monsterId: t.monsterId,
    wave: t.wave,
    status: t.status,
    hp: t.hp,
    maxHp: t.maxHp,
    hours: t.hours,
    star: t.star,
    corruptOnWake: t.status === 'dead' && t.star,
    arrivesRound: t.arrivesRound,
    invulnerableUntil: t.invulnerableUntil || undefined,
    threat: t.threat,
    baseMaxHp: t.baseMaxHp,
  }))
  return {
    slotIdx: 0,
    hour: slots[0]?.hour ?? snap.hour,
    glyphShift: 0,
    round: slots[0]?.round ?? Math.max(1, fight.round),
    vortexTurns: vx?.vortexTurns ?? 0,
    monsters,
    hoursUsed: snap.hoursUsedMask,
    score: 0,
    trace: null,
  }
}

function withMonster(s: AbsState, i: number, m: AbsMonster): AbsMonster[] {
  const out = s.monsters.slice()
  out[i] = m
  return out
}

/** Recalcule les étoiles à l'arrivée de l'heure `h` (4996). */
function arriveAt(monsters: readonly AbsMonster[], h: number): AbsMonster[] {
  let out: AbsMonster[] | null = null
  monsters.forEach((m, i) => {
    const star = (m.status === 'alive' || m.status === 'invulnerable') && maskHas(m.hours, h)
    if (star !== m.star) {
      out ??= monsters.slice()
      out[i] = { ...m, star }
    }
  })
  return out ?? (monsters as AbsMonster[])
}

/**
 * Passage au créneau `i` (> `s.slotIdx`) : fin(s) de tour de jeu, heure du créneau (+ `glyphShift`), étoiles à chaque
 * arrivée d'heure, résurrection au créneau du Vortex.
 */
export function beginSlot(s: AbsState, slots: readonly ClockSlot[], i: number, p: AbsParams = DEFAULT_ABS_PARAMS): AbsState {
  const slot = slots[i]
  if (!slot) return s
  let monsters = s.monsters as AbsMonster[]
  let round = s.round
  // Fin(s) de tour de jeu : vagues à venir → invulnérables → vivantes.
  while (round < slot.round) {
    round++
    let changed: AbsMonster[] | null = null
    monsters.forEach((m, k) => {
      let n: AbsMonster | undefined
      if (m.status === 'pending' && m.arrivesRound !== undefined && m.arrivesRound <= round) {
        const turns = p.arrivalInvulnerableTurns ?? 1
        n = turns > 0 ? { ...m, status: 'invulnerable', invulnerableUntil: round + turns, hp: m.maxHp } : { ...m, status: 'alive', hp: m.maxHp }
      } else if (m.status === 'invulnerable' && (m.invulnerableUntil ?? 0) <= round) n = { ...m, status: 'alive' }
      if (n) {
        changed ??= monsters.slice()
        changed[k] = n
      }
    })
    if (changed) monsters = changed
  }
  const prevHour = s.hour
  const hour = nextHour(slot.hour, s.glyphShift)
  // Arrivée(s) d'heure : les étoiles suivent la DERNIÈRE heure arrivée (un saut de k heures = k décalages successifs).
  if (hour !== prevHour) monsters = arriveAt(monsters, hour)
  let vortexTurns = s.vortexTurns
  if (slot.isVortex) {
    vortexTurns++
    let changed: AbsMonster[] | null = null
    monsters.forEach((m, k) => {
      if (m.status !== 'dead') return
      changed ??= monsters.slice()
      if (m.corruptOnWake) changed[k] = { ...m, status: 'corrupt', star: false, corruptOnWake: false }
      else changed[k] = { ...m, status: 'alive', star: false, ...resurrection(m, p) }
    })
    if (changed) monsters = changed
  }
  return { ...s, slotIdx: i, hour, round, vortexTurns, monsters, trace: s.trace }
}

/** Index d'un monstre abstrait par id (−1 si absent). */
export function absIndex(s: AbsState, id: number): number {
  for (let i = 0; i < s.monsters.length; i++) if (s.monsters[i].id === id) return i
  return -1
}

function glyphs(s: AbsState, count: number): AbsState {
  let hour = s.hour
  let monsters = s.monsters as AbsMonster[]
  for (let k = 0; k < count; k++) {
    hour = nextHour(hour, 1)
    monsters = arriveAt(monsters, hour)
  }
  return { ...s, hour, glyphShift: (s.glyphShift + count) % HOUR_COUNT, monsters }
}

/**
 * Applique l'action abstraite d'un créneau joueur (sans coût : le planificateur note). Une action impossible
 * (monstre absent, déjà mort ou corrompu, invulnérable) renvoie null.
 */
export function applyAbs(s: AbsState, slot: ClockSlot, a: AbsAction): AbsState | null {
  if (a.t === 'none') return s
  if (a.t === 'glyph') return glyphs(s, a.count)
  let cur = a.glyph === 'before' ? glyphs(s, 1) : s
  if (a.t === 'kill') {
    for (const id of a.m) {
      const i = absIndex(cur, id)
      if (i < 0) return null
      const m = cur.monsters[i]
      if (m.status !== 'alive') return null
      const h = cur.hour
      const n: AbsMonster = { ...m, status: 'dead', hp: 0, hours: m.hours | hourBit(h), corruptOnWake: m.star, star: m.star }
      cur = { ...cur, monsters: withMonster(cur, i, n), hoursUsed: cur.hoursUsed | hourBit(h) }
    }
  } else {
    const i = absIndex(cur, a.m)
    if (i < 0) return null
    const m = cur.monsters[i]
    if (m.status !== 'alive') return null
    cur = { ...cur, monsters: withMonster(cur, i, { ...m, hp: Math.max(1, m.hp - Math.max(0, a.amount)) }) }
  }
  if (a.glyph === 'after') cur = glyphs(cur, 1)
  void slot
  return cur
}

/** Coût d'exposition d'un créneau monstre : menace du monstre qui joue s'il est vivant et non corrompu (invulnérable compris). */
export function exposureAt(s: AbsState, slot: ClockSlot): number {
  if (slot.isPlayer) return 0
  const i = absIndex(s, slot.fighterId)
  if (i < 0) return 0
  const m = s.monsters[i]
  return m.status === 'alive' || m.status === 'invulnerable' ? m.threat : 0
}

/**
 * Φ (loi normale) sans fonction transcendante de la bibliothèque (§13.2 : décisions identiques d'un moteur JS à l'autre) :
 * série de Taylor de erf (opérations IEEE exactes), |z| plafonné à 6. Erreur absolue < 1e-9.
 */
export function normalCdf(z: number): number {
  if (z >= 6) return 1
  if (z <= -6) return 0
  const x = z / Math.SQRT2
  const x2 = x * x
  let term = x
  let sum = x
  for (let n = 1; n < 200; n++) {
    term *= -x2 / n
    const add = term / (2 * n + 1)
    sum += add
    if (Math.abs(add) < 1e-17) break
  }
  const erf = (2 / Math.sqrt(Math.PI)) * sum
  return Math.max(0, Math.min(1, 0.5 * (1 + erf)))
}

/** Oracle de kill (§12.6) : `pKill = Φ((E − PV)/(0,15·E))`. */
export function killProbability(expected: number, hp: number): number {
  if (hp <= 0) return 1
  if (expected <= 0) return 0
  return normalCdf((expected - hp) / (0.15 * expected))
}

/**
 * Empreinte de déduplication (§12.5) : statuts, masques d'heures, étoiles, PV par paliers de 500, `glyphShift` mod 12,
 * heure et créneau.
 */
export function absHash(s: AbsState): number {
  let h = mix32(s.slotIdx, (s.hour << 8) | (s.glyphShift % HOUR_COUNT))
  for (const m of s.monsters) {
    h = mix32(h, m.id)
    h = mix32(h, (m.hours << 12) | (STATUS[m.status] << 8) | (m.star ? 2 : 0) | (m.corruptOnWake ? 1 : 0))
    h = mix32(h, Math.floor(m.hp / 500))
  }
  return h >>> 0
}

const STATUS: Record<MonsterTrack['status'], number> = { pending: 1, invulnerable: 2, alive: 3, dead: 4, corrupt: 5 }

/** Ajoute un pas à la trace d'un état (score cumulé inclus). */
export function pushStep(s: AbsState, slot: ClockSlot, action: AbsAction, score: number): AbsState {
  const step: PlanStep = { round: slot.round, index: slot.index, fighterId: slot.fighterId, hour: s.hour, action, score }
  return { ...s, score, trace: { step, prev: s.trace } }
}

/** Pas d'un plan dans l'ordre chronologique. */
export function traceSteps(s: AbsState): PlanStep[] {
  const out: PlanStep[] = []
  for (let t = s.trace; t; t = t.prev) out.push(t.step)
  return out.reverse()
}

/** Monstres abstraits encore à corrompre (hors corrompus). */
export function remainingMonsters(s: AbsState): AbsMonster[] {
  return s.monsters.filter(m => m.status !== 'corrupt')
}

/** Recherche du combattant réel d'un monstre abstrait (undefined pour une vague à venir). */
export function fighterOf(fight: FightState, m: AbsMonster): Fighter | undefined {
  return m.id >= 0 ? fight.fighters[m.id] : undefined
}
