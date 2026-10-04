/**
 * Menace ordonnée par la timeline (docs/design/ai.md §6.5) — WP1.
 *
 * Pour chaque ennemi actif `e` (vivant, ne passe pas son prochain tour, non statique, pas de Pacifiste couvrant son
 * prochain tour) : PA/PM de son prochain tour (buffs encore actifs à ce moment, fractionnaires admis), accessibilité
 * avec tacle (`computeReach`, interpolée entre ⌊PM⌋ et ⌈PM⌉), puis pour chaque allié `a` du camp `side` :
 *   hit(e,a)  = 1 si une case atteignable permet son meilleur sort sur a, `hitWeak` si seul un sort plus faible porte,
 *               `hitNextTurn` si a n'est atteignable qu'au tour d'après, 0 sinon ;
 *   dmg(e,a)  = dpt(e, a, PA − PA perdus au tacle) · hit + `pacifistFactor`·Pot_a si e peut poser Pacifiste sur a ;
 *   s_a       = min(dmg, hpEff_a) + [dmg ≥ hpEff_a]·(0,5·PVmax_a + menace_a)   (imite le score du MonsterBrain) ;
 *   π_e       = softmax(s / τ), τ = `tauFrac`·max s ;
 *   inc[a]   += ω_e·(π_e(a)·dmg(e,a) + `zoneFactor`·part de zone) si e joue avant le prochain tour de a,
 *               ω_e = 1 si aucun allié ne joue entre maintenant et e, `laterEnemyWeight` sinon ;
 * puis `scenario.extraIncoming`. Les DoT ne sont pas dans `incoming` (terme `pendingDot` de value.ts).
 * `deathRisk(a) = Φ((inc − hpEff)/(deathSigmaFrac·inc + 1))` (Φ déterministe, rng.ts).
 *
 * `sync(s)` ne recalcule rien si l'empreinte (positions, PV, PA/PM, révisions) n'a pas changé ; l'accessibilité de
 * chaque ennemi est mise en cache par empreinte LOCALE (combattants à portée de ses PM), réutilisée d'un nœud à l'autre.
 */
import type { TeamId } from '../../core/types'
import { apMpAfterTackle, tackleRatio } from '../../damage/tackle'
import type { ScenarioAIModel } from '../../dungeons/types'
import type { Engine } from '../../engine/engine'
import { isStaticFighter } from '../../engine/targetMask'
import type { Buff, Fighter, FightState } from '../../engine/types'
import { CELL_COUNT, CELL_X, CELL_Y, distance, neighborsOf } from '../../map/geometry'
import { hasLineOfSight } from '../../map/los'
import type { ThetaJson as StrategyParams } from '../theta'
import type { AIView, Perception, ReachInfo, ThreatModel } from '../types'
import { castGeom, firstCastCell, LosOracle, levelFor, nextTurnStaticOk } from './castCells'
import { createDptTable, type DptTableImpl } from './dpt'
import { fnvInt, mobilityDigest, positionKey, stateSig } from './hash'
import { buildOccupancy, cachedReach, canTackleNow } from './reach'
import { phi, softmaxInto } from './rng'
import type { SpellProfileX } from './spellProfile'
import { SlotOrder } from './timeline'
import { believedCell } from './view'

// ───────────────────────────── outils « prochain tour » ─────────────────────────────

/** PV effectifs : PV + 0,9 × bouclier (§7). */
export function hpEff(f: Fighter): number {
  return f.hp + 0.9 * f.shield
}

/**
 * Le buff `b` porté par `holder` sera-t-il encore actif au début du prochain tour de `holder` ? Les durées sont
 * décrémentées au début du tour du LANCEUR du buff (Engine.decrementCastedBuffs).
 */
export function buffActiveAtNextTurn(b: Buff, holder: Fighter, order: SlotOrder): boolean {
  if (b.remaining < 0) return true
  const dec = b.sourceId === holder.id || order.before(b.sourceId, holder.id) ? 1 : 0
  return b.remaining - dec > 0
}

/** PA/PM du prochain tour de `f` : caractéristiques actuelles sans les buffs qui auront expiré d'ici là. */
export function nextTurnApMp(f: Fighter, order: SlotOrder, out = { ap: 0, mp: 0 }): { ap: number; mp: number } {
  let ap = f.stats.ap
  let mp = f.stats.mp
  for (const b of f.buffs) {
    const sd = b.statDelta
    if (!sd || b.delay > 0 || (sd.ap === undefined && sd.mp === undefined)) continue
    if (buffActiveAtNextTurn(b, f, order)) continue
    if (sd.ap) ap -= sd.ap
    if (sd.mp) mp -= sd.mp
  }
  out.ap = ap > 0 ? ap : 0
  out.mp = mp > 0 ? mp : 0
  return out
}

/** `f` porte-t-il un état au drapeau `flag` qui restera actif à son prochain tour ? */
export function flagAtNextTurn(engine: Engine, f: Fighter, flag: 'cantDealDamage' | 'invulnerable' | 'preventsFight', order: SlotOrder): boolean {
  if (!engine.stateFlag(f, flag)) return false
  for (const b of f.buffs) {
    if (b.stateId === undefined || b.delay > 0) continue
    if (f.disabledStates?.includes(b.stateId)) continue
    const st = engine.data.state(b.stateId)
    if (st && st[flag] && buffActiveAtNextTurn(b, f, order)) return true
  }
  // État sans buff identifiable (posé par le scénario) : supposé permanent.
  return !f.buffs.some(b => b.stateId !== undefined && engine.data.state(b.stateId)?.[flag])
}

/** États qui empêchent d'infliger des dommages (Pacifiste) parmi ceux posés par un profil sur une cible ennemie. */
export function pacifistStates(engine: Engine, p: SpellProfileX): boolean {
  for (const st of p.states) {
    if (st.remove || !st.sides.enemy) continue
    if (engine.data.state(st.stateId)?.cantDealDamage) return true
  }
  return false
}

// ───────────────────────────── modèle ─────────────────────────────

/**
 * Ligne de la menace d'un ennemi : valeurs par allié (indexées comme `ThreatModelImpl.allies`). Les lignes (et leurs
 * tableaux) sont réutilisées d'un `sync` à l'autre : ne pas les conserver au-delà du prochain `sync`.
 */
export interface EnemyThreat {
  e: Fighter
  active: boolean
  ap: number
  mp: number
  /** Accessibilité à ⌊PM⌋ et, si PM fractionnaires, à ⌈PM⌉ (poids `frac`). */
  reachLo: ReachInfo | null
  reachHi: ReachInfo | null
  frac: number
  weight: number
  hit: Float64Array
  /** PA restants sur la case de lancer retenue (le DPT est calculé avec ces PA). */
  apAt: Float64Array
  dmg: Float64Array
  /** dpt complet (hit = 1) sur l'allié. */
  full: Float64Array
  score: Float64Array
  pi: Float64Array
  /** Indice du meilleur sort contre l'allié (−1 : aucun). */
  best: Int16Array
  threat: number
  target: number
  /** L'ennemi peut frapper un allié sans se déplacer (α de mpWorth = 0,15 ; sinon 0,6). */
  hitsFromStart: boolean
  /** L'ennemi peut poser Pacifiste (cantDealDamage) sur un allié. */
  pacifist: boolean
}

/** Portée d'un ennemi sur une case avec un sort donné (mémo de géométrie). */
interface PairHit { hit: number; apAt: number; fromStart: boolean }

/**
 * Géométrie d'un ennemi (indépendante des PV, des boucliers et des caractéristiques offensives) : actif, PA/PM du
 * prochain tour, accessibilité, LdV et mémo « (sort, case visée) → portée ». Clé : positions de tous les combattants
 * (`positionKey`), ordre des prochains tours, mobilité de l'ennemi (`mobilityDigest`). Partagée par tous les états de
 * même clé (enfants d'un nœud qui ne déplacent personne), d'où une menace « incrémentale ».
 */
interface GeoRow {
  k2: number
  active: boolean; ap: number; mp: number; frac: number; weight: number; maxRange: number; pacifist: boolean
  reachLo: ReachInfo | null; reachHi: ReachInfo | null; los: LosOracle | null
  memo: Map<number, PairHit>
}
/** Plafond du cache de géométries (vidé en bloc : aucune influence sur les décisions). */
const GEO_CACHE_MAX = 2048

interface ThreatParams {
  tauFrac: number
  zoneFactor: number
  laterEnemyWeight: number
  hitWeak: number
  hitNextTurn: number
  pacifistFactor: number
  deathSigmaFrac: number
}
const DEFAULT_PARAMS: ThreatParams = { tauFrac: 0.25, zoneFactor: 0.6, laterEnemyWeight: 0.8, hitWeak: 0.6, hitNextTurn: 0.25, pacifistFactor: 0.9, deathSigmaFrac: 0.25 }

/** Hash de l'ordre des prochains tours (combattants et tours passés). */
export function orderKey(order: SlotOrder): number {
  let h = 0x811c9dc5
  for (const sl of order.slots) h = fnvInt(h, sl.fighterId * 2 + (sl.passes ? 1 : 0))
  return h
}

/** Drapeaux de tacle d'un combattant (clé de position) : ne tacle pas (1), intaclable (2). */
export function tackleFlags(engine: Engine, f: Fighter): number {
  return (canTackleNow(engine, f) ? 0 : 1) | (engine.stateFlag(f, 'cantBeTackled') ? 2 : 0)
}

/**
 * Cadre d'un état partagé par la menace et le potentiel d'un même camp : ordre des prochains tours et clé de position
 * (64 bits, ordre compris). Mémo à une entrée par (moteur, camp) validé par l'identité de l'état et `stateSig`.
 */
export interface GeoFrame { order: SlotOrder; p1: number; p2: number }
interface FrameMemo extends GeoFrame { engine: Engine; s: FightState; side: TeamId; sig: number }
const FRAMES: FrameMemo[] = []

export function geoFrame(engine: Engine, s: FightState, side: TeamId, sig: number): GeoFrame {
  for (const f of FRAMES) if (f.s === s && f.sig === sig && f.side === side && f.engine === engine) return f
  const order = new SlotOrder(engine, s)
  const ok = orderKey(order)
  const pk = positionKey(s, f => believedCell(f, side), f => tackleFlags(engine, f))
  const memo: FrameMemo = { engine, s, side, sig, order, p1: fnvInt(pk.h1, ok), p2: fnvInt(pk.h2, ok) }
  if (FRAMES.length >= 4) FRAMES.shift()
  FRAMES.push(memo)
  return memo
}

export class ThreatModelImpl implements ThreatModel {
  readonly dpt: DptTableImpl
  readonly params: ThreatParams
  order!: SlotOrder
  s!: FightState
  /** Alliés (camp `side`) vivants et placés, dans l'ordre des ids. */
  allies: Fighter[] = []
  enemies: EnemyThreat[] = []
  /** incoming par id de combattant. */
  inc = new Float64Array(0)
  /** Diagnostic (bancs) : géométries d'ennemis réutilisées / recalculées. */
  geoHits = 0
  geoMisses = 0
  private allyIndex = new Int16Array(0)
  private enemyIndex = new Int16Array(0)
  private signature = 0
  private occ = new Int16Array(CELL_COUNT)
  private readonly cellMemo = new Map<number, { own: number; teamDelta: number }>()
  private readonly geoCache = new Map<number, GeoRow>()
  private readonly pool: EnemyThreat[] = []
  private readonly tmpScores = new Float64Array(64)
  private readonly tmpPi = new Float64Array(64)

  constructor(readonly view: AIView, readonly side: TeamId, readonly perception: Perception | undefined,
              readonly scenario?: ScenarioAIModel, theta?: StrategyParams) {
    this.dpt = (perception?.dpt as DptTableImpl | undefined) ?? createDptTable(view.engine)
    this.params = theta ? { ...DEFAULT_PARAMS, ...theta.threat } : DEFAULT_PARAMS
  }

  sync(s: FightState): void {
    const sig = stateSig(s)
    if (s === this.s && sig === this.signature) return
    this.signature = sig
    this.build(s, sig)
  }

  /** Recalcul : géométrie par ennemi (cache par position/mobilité) puis couche « PV » (DPT en cache, π, agrégation). */
  private build(s: FightState, sig: number): void {
    const side = this.side
    this.s = s
    this.cellMemo.clear()
    buildOccupancy(s, side, this.occ)
    const fr = geoFrame(this.view.engine, s, side, sig)
    const order = (this.order = fr.order)
    const p1 = fr.p1
    const p2 = fr.p2
    const n = s.fighters.length
    if (this.inc.length < n) {
      this.inc = new Float64Array(n)
      this.allyIndex = new Int16Array(n)
      this.enemyIndex = new Int16Array(n)
    }
    this.inc.fill(0)
    this.allyIndex.fill(-1)
    this.enemyIndex.fill(-1)
    this.allies = []
    for (const f of s.fighters) {
      if (!f.alive || f.team !== side || f.cell < 0 || f.carriedBy !== undefined) continue
      this.allyIndex[f.id] = this.allies.length
      this.allies.push(f)
    }
    this.enemies = []
    for (const e of s.fighters) {
      if (!e.alive || e.team === side) continue
      if (believedCell(e, side) < 0) continue
      const md = mobilityDigest(e)
      const k1 = fnvInt(fnvInt(p1, e.id), md)
      const k2 = fnvInt(fnvInt(p2, e.id), md)
      let g = this.geoCache.get(k1)
      if (g && g.k2 === k2) this.geoHits++
      else {
        g = this.geoRow(s, e, order)
        g.k2 = k2
        if (this.geoCache.size >= GEO_CACHE_MAX) this.geoCache.clear()
        this.geoCache.set(k1, g)
      }
      this.enemyIndex[e.id] = this.enemies.length
      this.enemies.push(this.hpRow(s, e, g, this.enemies.length))
    }
    // Agrégation : incoming des alliés qui jouent APRÈS l'ennemi.
    for (const row of this.enemies) {
      if (!row.active) continue
      for (let i = 0; i < this.allies.length; i++) {
        const a = this.allies[i]
        if (!order.before(row.e.id, a.id)) continue
        let v = row.pi[i] * row.dmg[i]
        v += this.zoneShare(row, i)
        this.inc[a.id] += row.weight * v
      }
    }
    if (this.scenario?.extraIncoming) {
      for (const a of this.allies) this.inc[a.id] += this.scenario.extraIncoming(s, a, a.cell)
    }
  }

  /** Part de zone : l'allié est dans le rayon du meilleur sort de `e` centré sur sa cible prédite. */
  private zoneShare(row: EnemyThreat, i: number): number {
    const t = row.target
    if (t < 0 || t === i) return 0
    const bi = row.best[t]
    if (bi < 0) return 0
    const p = this.dpt.profiles.ofFighter(row.e)[bi]
    if (!p || p.zoneRadius <= 0) return 0
    const a = this.allies[i]
    const target = this.allies[t]
    if (distance(a.cell, target.cell) > p.zoneRadius) return 0
    return this.params.zoneFactor * row.pi[t] * row.hit[t] * this.dpt.perCast(row.e, bi, a).mean
  }

  private reachOf(s: FightState, e: Fighter, mp: number, ap: number): ReachInfo {
    return cachedReach(this.view.engine, s, e, this.side, mp, ap, this.occ)
  }

  /** Géométrie d'un ennemi : actif, PA/PM du prochain tour, accessibilité, LdV (mémo des portées vide). */
  private geoRow(s: FightState, e: Fighter, order: SlotOrder): GeoRow {
    this.geoMisses++
    const engine = this.view.engine
    const P = this.params
    const g: GeoRow = {
      k2: 0, active: false, ap: 0, mp: 0, frac: 0, weight: 1, maxRange: 0, pacifist: false,
      reachLo: null, reachHi: null, los: null, memo: new Map(),
    }
    if (isStaticFighter(e) || order.passes(e.id) || order.rank(e.id) >= order.count) return g
    const am = nextTurnApMp(e, order)
    if (am.ap <= 0) return g
    if (flagAtNextTurn(engine, e, 'cantDealDamage', order)) return g
    g.active = true
    g.ap = am.ap
    g.mp = am.mp
    const lo = Math.floor(am.mp)
    g.frac = am.mp - lo
    g.reachLo = this.reachOf(s, e, lo, am.ap)
    if (g.frac > 1e-6) g.reachHi = this.reachOf(s, e, lo + 1, am.ap)
    g.weight = order.teamPlaysBefore(this.side, e.id, s.timeline[s.turnIndex] ?? -1) ? P.laterEnemyWeight : 1
    // L'oracle lit `this.occ`, identique à chaque réutilisation (même clé de position).
    g.los = new LosOracle(s, this.side, e.id, this.occ)
    const profiles = this.dpt.profiles.ofFighter(e)
    for (const p of profiles) if (p.damage.length && p.maxRange > g.maxRange) g.maxRange = p.maxRange
    g.pacifist = profiles.some(p => pacifistStates(engine, p))
    return g
  }

  /** Portée de `e` (meilleur sort `bi`) sur la case `cell` : 1, `hitWeak`, interpolation ⌈PM⌉, `hitNextTurn` ou 0. */
  private pairHit(s: FightState, e: Fighter, g: GeoRow, bi: number, cell: number): PairHit {
    const key = bi * CELL_COUNT + cell
    let r = g.memo.get(key)
    if (r) return r
    const P = this.params
    const reachLo = g.reachLo!
    const los = g.los!
    let hit = 0
    let apAt = g.ap
    let fromStart = false
    const c1 = this.castCell(s, e, bi, cell, reachLo, los, g.ap)
    if (c1 >= 0) {
      hit = 1
      apAt = reachLo.apLeft[c1]
      fromStart = c1 === reachLo.cells[0]
    } else {
      const profiles = this.dpt.profiles.ofFighter(e)
      let weak = -1
      for (let k = 0; k < profiles.length && weak < 0; k++) {
        if (k === bi || !profiles[k].damage.length) continue
        const c = this.castCell(s, e, k, cell, reachLo, los, g.ap)
        if (c >= 0) weak = c
      }
      let hiHit = -1
      if (g.reachHi) hiHit = this.castCell(s, e, bi, cell, g.reachHi, los, g.ap)
      if (weak >= 0) {
        hit = P.hitWeak
        apAt = reachLo.apLeft[weak]
      }
      if (hiHit >= 0) {
        if (hit === 0) apAt = g.reachHi!.apLeft[hiHit]
        hit = hit + g.frac * (1 - hit)
      }
      if (hit === 0 && distance(believedCell(e, this.side), cell) <= 2 * g.mp + g.maxRange + 1) hit = P.hitNextTurn
    }
    r = { hit, apAt, fromStart }
    g.memo.set(key, r)
    return r
  }

  /** Ligne réutilisable (tableaux de taille ≥ nombre d'alliés). */
  private rowFromPool(k: number, nA: number): EnemyThreat {
    let row = this.pool[k]
    if (!row || row.hit.length < nA) {
      const m = Math.max(nA, 4)
      row = this.pool[k] = {
        e: undefined as unknown as Fighter, active: false, ap: 0, mp: 0, reachLo: null, reachHi: null, frac: 0, weight: 1,
        hit: new Float64Array(m), apAt: new Float64Array(m), dmg: new Float64Array(m), full: new Float64Array(m),
        score: new Float64Array(m), pi: new Float64Array(m), best: new Int16Array(m), threat: 0, target: -1,
        hitsFromStart: false, pacifist: false,
      }
    }
    row.hit.fill(0)
    row.apAt.fill(0)
    row.dmg.fill(0)
    row.full.fill(0)
    row.score.fill(0)
    row.pi.fill(0)
    row.best.fill(-1)
    return row
  }

  /** Couche « PV » d'une ligne : meilleur sort et DPT (caches), portée (mémo), dégâts attendus, score, π, menace. */
  private hpRow(s: FightState, e: Fighter, g: GeoRow, k: number): EnemyThreat {
    const P = this.params
    const nA = this.allies.length
    const row = this.rowFromPool(k, nA)
    row.e = e
    row.active = g.active
    row.ap = g.ap
    row.mp = g.mp
    row.reachLo = g.reachLo
    row.reachHi = g.reachHi
    row.frac = g.frac
    row.weight = g.weight
    row.pacifist = g.pacifist
    row.hitsFromStart = false
    row.threat = 0
    row.target = -1
    if (!g.active) return row
    const potential = this.perception?.potential
    for (let i = 0; i < nA; i++) {
      const a = this.allies[i]
      const best = this.dpt.bestCast(e, a, 'next')
      const bi = best.index
      row.best[i] = bi
      if (bi < 0) continue
      const ph = this.pairHit(s, e, g, bi, a.cell)
      const hit = ph.hit
      if (ph.fromStart) row.hitsFromStart = true
      row.hit[i] = hit
      row.apAt[i] = ph.apAt
      const full = this.dpt.dpt(e, a, ph.apAt)
      row.full[i] = full
      let dmg = full * hit
      if (g.pacifist && hit > 0 && potential) dmg += P.pacifistFactor * potential.potential(a.id) * Math.min(1, hit)
      row.dmg[i] = dmg
      row.score[i] = scoreOf(dmg, a, dmg >= hpEff(a) && dmg > 0 ? this.dpt.dpt(a, e) : 0)
    }
    this.finishRow(row)
    return row
  }

  /** π, cible prédite et menace propre d'une ligne (à partir de `score` et `dmg`). */
  private finishRow(row: EnemyThreat): void {
    const nA = this.allies.length
    let max = 0
    for (let i = 0; i < nA; i++) if (row.score[i] > max) max = row.score[i]
    row.threat = 0
    row.target = -1
    if (max <= 0) return
    softmaxInto(row.score, nA, this.params.tauFrac * max, row.pi)
    let bestPi = -1
    for (let i = 0; i < nA; i++) {
      row.threat += row.pi[i] * row.dmg[i]
      if (row.pi[i] > bestPi + 1e-12) {
        bestPi = row.pi[i]
        row.target = i
      }
    }
  }

  /** Case (de `reach`) d'où `e` peut lancer son i-ème sort sur `cell` au prochain tour, −1 sinon. */
  private castCell(s: FightState, e: Fighter, i: number, cell: number, reach: ReachInfo, los: LosOracle, ap: number): number {
    const ks = e.spells[i]
    const lvl = levelFor(e, ks)
    if (!nextTurnStaticOk(this.view.engine, e, ks, lvl, ap)) return -1
    return firstCastCell(s, e, ks, lvl, cell, reach, los, true)
  }

  incoming(id: number): number {
    return id < this.inc.length ? this.inc[id] : 0
  }

  deathRisk(id: number): number {
    const f = this.s?.fighters[id]
    if (!f || !f.alive) return 0
    const inc = this.incoming(id)
    if (inc <= 0) return 0
    return phi((inc - hpEff(f)) / (this.params.deathSigmaFrac * inc + 1))
  }

  threatOf(e: Fighter): number {
    const i = e.id < this.enemyIndex.length ? this.enemyIndex[e.id] : -1
    return i >= 0 ? this.enemies[i].threat : 0
  }

  predictedTarget(e: Fighter): number | undefined {
    const i = e.id < this.enemyIndex.length ? this.enemyIndex[e.id] : -1
    if (i < 0) return undefined
    const t = this.enemies[i].target
    return t >= 0 ? this.allies[t].id : undefined
  }

  /** Ligne de menace d'un ennemi (undefined si inconnu). */
  rowOf(e: Fighter | number): EnemyThreat | undefined {
    const id = typeof e === 'number' ? e : e.id
    const i = id < this.enemyIndex.length ? this.enemyIndex[id] : -1
    return i >= 0 ? this.enemies[i] : undefined
  }

  /** Index de l'allié dans les lignes (−1 si absent). */
  allyIdx(id: number): number {
    return id < this.allyIndex.length ? this.allyIndex[id] : -1
  }

  /**
   * Dégâts attendus sur l'allié `f` s'il finissait sur `cell` (autres positions figées) : accessibilité des ennemis
   * réduite par le tacle de `f` s'il est adjacent, cible prédite recalculée, + `extraIncoming(cell)`.
   */
  cellIncoming(f: Fighter, cell: number): number {
    return this.cellEval(f, cell).own
  }

  /**
   * Variation de l'incoming TOTAL de l'équipe si `f` finissait sur `cell` : quand `f` se met à l'abri, les ennemis
   * reportent leurs coups sur ses alliés (π recalculé sur tous les alliés).
   */
  cellIncomingTeamDelta(f: Fighter, cell: number): number {
    return this.cellEval(f, cell).teamDelta
  }

  private cellEval(f: Fighter, cell: number): { own: number; teamDelta: number } {
    const ai = this.allyIdx(f.id)
    if (!this.s || ai < 0 || cell === f.cell) return { own: ai < 0 ? 0 : this.incoming(f.id), teamDelta: 0 }
    const memoKey = f.id * 1024 + cell
    let r = this.cellMemo.get(memoKey)
    if (!r) {
      r = this.cellEvalRaw(f, cell, ai)
      this.cellMemo.set(memoKey, r)
    }
    return r
  }

  private cellEvalRaw(f: Fighter, cell: number, ai: number): { own: number; teamDelta: number } {
    const s = this.s
    const P = this.params
    const engine = this.view.engine
    let own = 0
    let teamDelta = 0
    const scores = this.tmpScores
    const pi = this.tmpPi
    const nA = this.allies.length
    for (const row of this.enemies) {
      if (!row.active || !row.reachLo) continue
      const e = row.e
      const bi = row.best[ai]
      if (bi < 0) continue
      const eCell = believedCell(e, this.side)
      // Tacle de f si la case est adjacente à e : PM de e après sa sortie de contact.
      let mpBudget = row.mp
      if (distance(cell, eCell) === 1 && canTackleNow(engine, f) && !engine.stateFlag(e, 'cantBeTackled')) {
        let ratio = tackleRatio(e.stats.tackleEvade, f.stats.tackleBlock)
        for (const n of neighborsOf(eCell)) {
          const id = this.occ[n]
          if (id < 0 || id === f.id) continue
          const o = s.fighters[id]
          if (o.team !== e.team && canTackleNow(engine, o)) ratio *= tackleRatio(e.stats.tackleEvade, o.stats.tackleBlock)
        }
        mpBudget = apMpAfterTackle(Math.floor(row.mp), ratio)
      }
      let hit = 0
      let apAt = row.ap
      const reach = row.reachLo
      const p = this.dpt.profiles.ofFighter(e)[bi]
      const ks = e.spells[bi]
      const lvl = levelFor(e, ks)
      if (nextTurnStaticOk(engine, e, ks, lvl, row.ap)) {
        const g = castGeom(e, lvl)
        const mp0 = reach.mpLeft[reach.cells[0]]
        // Case de lancer gardant le plus de PA (le tacle peut en coûter).
        for (let k = 0; k < reach.count; k++) {
          const c = reach.cells[k]
          if (mp0 - reach.mpLeft[c] > mpBudget) continue
          if (reach.apLeft[c] < lvl.apCost || (hit > 0 && reach.apLeft[c] <= apAt)) continue
          if (c === cell) continue
          if (!inRangeLos(s, g, c, cell, lvl.castTestLos, this.occ, e.id, f.id)) continue
          hit = 1
          apAt = reach.apLeft[c]
          if (apAt >= row.ap) break
        }
      }
      if (hit === 0) hit = distance(eCell, cell) <= 2 * row.mp + p.maxRange + 1 ? P.hitNextTurn : 0
      let dmg = this.dpt.dpt(e, f, apAt) * hit
      if (row.pacifist && hit > 0 && this.perception?.potential) dmg += P.pacifistFactor * this.perception.potential.potential(f.id) * Math.min(1, hit)
      for (let i = 0; i < nA; i++) scores[i] = i === ai ? scoreOf(dmg, f, this.dpt.dpt(f, e)) : row.score[i]
      let max = 0
      for (let i = 0; i < nA; i++) if (scores[i] > max) max = scores[i]
      if (max <= 0) pi.fill(0, 0, nA)
      else softmaxInto(scores, nA, P.tauFrac * max, pi)
      for (let i = 0; i < nA; i++) {
        const a = this.allies[i]
        if (!this.order.before(e.id, a.id)) continue
        const after = pi[i] * (i === ai ? dmg : row.dmg[i])
        const before = row.pi[i] * row.dmg[i]
        teamDelta += row.weight * (after - before)
        if (i === ai) own += row.weight * after
      }
    }
    if (this.scenario?.extraIncoming) {
      const extra = this.scenario.extraIncoming(s, f, cell)
      own += extra
      teamDelta += extra - this.scenario.extraIncoming(s, f, f.cell)
    }
    return { own, teamDelta }
  }
}

function scoreOf(dmg: number, a: Fighter, threatA: number): number {
  const he = hpEff(a)
  let sc = Math.min(dmg, he)
  if (dmg >= he && dmg > 0) sc += 0.5 * a.maxHp + threatA
  return sc
}

/** Portée + LdV de `from` vers `to` (la case d'origine de l'allié déplacé `movedId` ne bloque pas). */
function inRangeLos(s: FightState, g: { min: number; max: number; line: boolean; diag: boolean }, from: number, to: number,
                    los: boolean, occ: Int16Array, casterId: number, movedId: number): boolean {
  const adx = Math.abs(cellX(to) - cellX(from))
  const ady = Math.abs(cellY(to) - cellY(from))
  let r = adx + ady
  if (g.line || g.diag) {
    if (g.line && (adx === 0 || ady === 0)) r = adx + ady
    else if (g.diag && adx === ady) r = adx
    else return false
  }
  if (r < g.min || r > g.max) return false
  if (!los || adx + ady <= 1) return !!s.map.cells[to]?.walkable
  return losFree(s, from, to, occ, casterId, movedId)
}

function cellX(c: number): number {
  return CELL_X[c]
}
function cellY(c: number): number {
  return CELL_Y[c]
}
function losFree(s: FightState, from: number, to: number, occ: Int16Array, casterId: number, movedId: number): boolean {
  const cells = s.map.cells
  return hasLineOfSight(
    from,
    to,
    c => {
      const mc = cells[c]
      if (!mc || !mc.los) return true
      const id = occ[c]
      return id >= 0 && id !== casterId && id !== movedId
    },
    c => !cells[c]?.los,
  )
}

/** Construit le modèle de menace du camp `side` sur l'état `s` (§6.5). */
export function buildThreat(view: AIView, s: FightState, side: TeamId, p?: Perception, scenario?: ScenarioAIModel, theta?: StrategyParams): ThreatModelImpl {
  const t = new ThreatModelImpl(view, side, p, scenario, theta)
  t.sync(s)
  return t
}
