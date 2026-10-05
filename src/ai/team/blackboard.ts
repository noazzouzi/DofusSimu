/**
 * Tableau noir de l'équipe (docs/design/ai.md §9.3) — WP2.
 *
 * Mis à jour au début du tour de chaque allié (< 1 ms) :
 *  - FOCUS : prio_e = menace_e·(fenêtre de kill d'équipe ? 1,5 : 1)/max(1, TTK_e) + bonus de contrat, avec
 *    TTK_e = PV effectifs / Σ_a dpt(a, e)·atteignabilité(a, e) (tours alliés nécessaires) et la fenêtre de kill
 *    d'équipe = Σ des contributions des alliés qui jouent AVANT le prochain tour de e ≥ PV effectifs de e ;
 *  - RÉSERVATIONS (clé = allié qui réserve) : si `canKillNow(me, t).p ≥ 0,6` pour une cible focale (2 premières),
 *    `t` est réservée par `me` (le terme `continuation` protège les PA nécessaires ; bonus de contrat du focus) ;
 *  - CASES RÉSERVÉES : la case finale choisie par un allié est pénalisée (θ.team.reservedCellPenalty) pour les alliés
 *    suivants du même tour de jeu (vidées à chaque nouveau tour de jeu) ;
 *  - COHÉRENCE : l'action que le rollout d'un allié prêtait à l'allié suivant lui vaut θ.team.coherenceBonus s'il la
 *    joue (gérée par le `TeamBrain`).
 * Sérialisation pure (`serializeBlackboard`/`deserializeBlackboard`) pour le rembobinage (§15.8).
 */
import type { TeamId } from '../../core/types'
import { isStaticFighter } from '../../engine/targetMask'
import type { Fighter, FightState } from '../../engine/types'
import { distance } from '../../map/geometry'
import { believedCell, canKillNow, hpEff, type PerceptionX } from '../core'
import type { AIView, Blackboard, Intent, PhaseId, PriceTable, RoleAssignment } from '../types'

export function emptyPriceTable(): PriceTable {
  return { kill: new Map(), hp: new Map(), clock: [0, 0, 0] }
}

export function emptyBlackboard(): Blackboard {
  return {
    version: 0,
    round: 0,
    phase: 'fight',
    emergency: false,
    roles: new Map(),
    focus: [],
    reservations: new Map(),
    prices: emptyPriceTable(),
    intents: [],
    reservedCells: new Map(),
  }
}

/** Ennemis actifs (vivants, placés — case connue de l'équipe —, non statiques) de l'équipe `team`. */
export function activeEnemies(s: FightState, team: number): Fighter[] {
  return s.fighters.filter(f => f.alive && f.team !== team && believedCell(f, team as TeamId) >= 0 && !isStaticFighter(f) && f.carriedBy === undefined)
}

/**
 * Atteignabilité grossière de `e` par `a` au prochain tour : 1 à portée, 0,6 après un déplacement, 0,25 au-delà.
 * Cases vues par l'équipe de `a` (un invisible adverse est sur sa dernière case connue, §6.1).
 */
export function reachFactor(a: Fighter, e: Fighter, range: number): number {
  const d = distance(believedCell(a, a.team), believedCell(e, a.team))
  const mp = Math.max(0, a.stats.mp)
  return d <= range ? 1 : d <= range + mp ? 0.6 : 0.25
}

/** Portée max des sorts à dégâts d'un combattant (portée boostable comprise). */
export function damageRange(p: PerceptionX, f: Fighter): number {
  let r = 1
  for (const pr of p.profiles.ofFighter(f)) {
    if (!pr.damage.length || pr.unsupported) continue
    r = Math.max(r, pr.maxRange + (pr.level.rangeBoostable ? Math.max(0, f.stats.range) : 0))
  }
  return r
}

/** Priorités des ennemis (§9.3) : ids triés par priorité décroissante. */
export function computeFocus(view: AIView, p: PerceptionX, bb: Blackboard): number[] {
  const s = view.fight
  p.sync(s)
  const team = view.team
  const allies = s.fighters.filter(f => f.alive && f.team === team && f.cell >= 0 && !isStaticFighter(f))
  const order = p.threat.order
  const rows: { id: number; prio: number }[] = []
  const contractBonus = new Map<number, number>()
  for (const r of bb.reservations.values()) contractBonus.set(r.targetId, (contractBonus.get(r.targetId) ?? 0) + 0.2 * r.value)
  for (const e of activeEnemies(s, team)) {
    const he = hpEff(e)
    let sum = 0
    let window = 0
    for (const a of allies) {
      const d = p.dpt.dpt(a, e) * reachFactor(a, e, damageRange(p, a))
      sum += d
      if (a.id === view.me.id || order.before(a.id, e.id)) window += d
    }
    const ttk = sum > 0 ? he / sum : 99
    const th = Math.max(p.threat.contribution(e), p.threat.threatOf(e))
    const prio = (th * (window >= he ? 1.5 : 1)) / Math.max(1, ttk) + (contractBonus.get(e.id) ?? 0)
    rows.push({ id: e.id, prio })
  }
  rows.sort((a, b) => b.prio - a.prio || a.id - b.id)
  return rows.map(r => r.id)
}

/**
 * Réservations de kill (clé = allié qui réserve) : celles dont l'allié ou la cible est mort sont purgées ; celle du
 * combattant courant est recalculée sur les deux premières cibles focales (`canKillNow ≥ 0,6`, meilleure probabilité).
 */
export function updateReservations(view: AIView, p: PerceptionX, bb: Blackboard): void {
  const s = view.fight
  const me = view.me
  for (const [owner, r] of [...bb.reservations]) {
    if (!s.fighters[owner]?.alive || !s.fighters[r.targetId]?.alive) bb.reservations.delete(owner)
  }
  bb.reservations.delete(me.id)
  for (const id of bb.focus.slice(0, 2)) {
    const t = s.fighters[id]
    if (!t || !t.alive) continue
    const k = canKillNow(view, me, t, p)
    if (k.p < 0.6) continue
    const prev = bb.reservations.get(me.id)
    if (prev && prev.p >= k.p) continue
    const value = p.theta.value.killKappa * t.maxHp + p.theta.value.killTau * p.threat.threatOf(t)
    bb.reservations.set(me.id, { targetId: id, p: k.p, value, spellIds: k.spells.slice() })
  }
}

// ───────────────────────────── sérialisation (rembobinage) ─────────────────────────────

export interface BlackboardData {
  version: number
  round: number
  phase: PhaseId
  emergency: boolean
  roles: [number, RoleAssignment][]
  focus: number[]
  reservations: [number, { targetId: number; p: number; value: number; spellIds: number[] }][]
  prices: { kill: [number, number[]][]; hp: [number, PriceTable['hp'] extends Map<number, infer V> ? V : never][]; clock: [number, number, number]; cell?: number[] }
  intents: Intent[]
  reservedCells: [number, number][]
}

/** Copie pure (JSON) d'un tableau noir ; `plan` (opaque, scénario) n'est pas copié : il est recalculé au tour suivant. */
export function serializeBlackboard(bb: Blackboard): BlackboardData {
  return {
    version: bb.version,
    round: bb.round,
    phase: bb.phase,
    emergency: bb.emergency,
    roles: [...bb.roles].map(([id, r]) => [id, { primary: r.primary, ...(r.secondary ? { secondary: r.secondary } : {}), scores: { ...r.scores } }]),
    focus: bb.focus.slice(),
    reservations: [...bb.reservations].map(([id, r]) => [id, { ...r, spellIds: r.spellIds.slice() }]),
    prices: {
      kill: [...bb.prices.kill].map(([id, row]) => [id, Array.from(row)]),
      hp: [...bb.prices.hp].map(([id, row]) => [id, { ...row }]),
      clock: [bb.prices.clock[0], bb.prices.clock[1], bb.prices.clock[2]],
      ...(bb.prices.cell ? { cell: Array.from(bb.prices.cell) } : {}),
    },
    intents: bb.intents.map(i => ({ ...i, window: { ...i.window }, ...(i.cells ? { cells: i.cells.slice() } : {}), ...(i.params ? { params: { ...i.params } } : {}) })),
    reservedCells: [...bb.reservedCells],
  }
}

export function deserializeBlackboard(d: BlackboardData): Blackboard {
  const bb = emptyBlackboard()
  bb.version = d.version
  bb.round = d.round
  bb.phase = d.phase
  bb.emergency = d.emergency
  bb.roles = new Map(d.roles.map(([id, r]) => [id, { primary: r.primary, ...(r.secondary ? { secondary: r.secondary } : {}), scores: { ...r.scores } }]))
  bb.focus = d.focus.slice()
  bb.reservations = new Map(d.reservations.map(([id, r]) => [id, { ...r, spellIds: r.spellIds.slice() }]))
  bb.prices = {
    kill: new Map(d.prices.kill.map(([id, row]) => [id, Float32Array.from(row)])),
    hp: new Map(d.prices.hp.map(([id, row]) => [id, { ...row }])),
    clock: [d.prices.clock[0], d.prices.clock[1], d.prices.clock[2]],
    ...(d.prices.cell ? { cell: Float32Array.from(d.prices.cell) } : {}),
  }
  bb.intents = d.intents.map(i => ({ ...i, window: { ...i.window }, ...(i.cells ? { cells: i.cells.slice() } : {}), ...(i.params ? { params: { ...i.params } } : {}) }))
  bb.reservedCells = new Map(d.reservedCells)
  return bb
}
