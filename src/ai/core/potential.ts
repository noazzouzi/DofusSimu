/**
 * Potentiel offensif au prochain tour (docs/design/ai.md §6.6) — WP1.
 *
 * Symétrique de la menace : `Pot_a(s)` = meilleure valeur offensive de l'allié `a` à son PROCHAIN tour (PA/PM de ce
 * tour, retraits subis déduits ; Pacifiste ⇒ 0), via son accessibilité (tacle compris) et les anneaux de portée de
 * ses sorts, sur les ennemis vulnérables à ce moment (`scenario.vulnerableAt`, invulnérabilité encore active) :
 *   Pot_a = max_e [min(dmg, hpEff_e)·v_e + P(kill)·killValue_e] + 0,3 × 2e cible dans la zone du meilleur sort.
 * killValue_e = κ·PVmax_e + τ·menace_e (θ.value), menace_e = max_a dpt(e, a). C'est le terme qui rémunère les mises
 * en place (rapprocher un monstre, regrouper pour une zone, retirer un Pacifiste, débuff « dommages subis »).
 */
import type { TeamId } from '../../core/types'
import type { ScenarioAIModel } from '../../dungeons/types'
import { isStaticFighter } from '../../engine/targetMask'
import type { Fighter, FightState } from '../../engine/types'
import { CELL_COUNT, distance } from '../../map/geometry'
import type { ThetaJson } from '../theta'
import type { AIView, Blackboard, Perception, PotentialModel, ReachInfo } from '../types'
import { firstCastCell, LosOracle, levelFor, nextTurnStaticOk } from './castCells'
import { calibrationOf, createDptTable, type DptTableImpl } from './dpt'
import { fnvInt, mobilityDigest, stateSig } from './hash'
import { killProbability } from './kill'
import { buildOccupancy, cachedReach } from './reach'
import { SlotOrder } from './timeline'
import { believedCell } from './view'
import { flagAtNextTurn, geoFrame, hpEff, nextTurnApMp } from './threat'

export interface ValueWeights {
  monsterDamage: number
  summonDamage: number
  killKappa: number
  killTau: number
}
const DEFAULT_WEIGHTS: ValueWeights = { monsterDamage: 1, summonDamage: 0.5, killKappa: 0.3, killTau: 1 }

/** Poids de dégâts v_e d'un ennemi (§7) : scénario, sinon monstre 1 / invocation 0,5 ; statique ⇒ 0. */
export function damageWeightOf(e: Fighter, w: ValueWeights, scenario?: ScenarioAIModel, bb?: Blackboard): number {
  const sw = bb && scenario?.damageWeight ? scenario.damageWeight(e, bb) : undefined
  if (sw !== undefined) return sw
  if (isStaticFighter(e)) return 0
  return e.kind === 'summon' || e.summonerId !== undefined ? w.summonDamage : w.monsterDamage
}

/**
 * Géométrie du potentiel d'un allié (indépendante des PV et des caractéristiques offensives) : prochain tour joué,
 * PA/PM, accessibilité, LdV et mémo « (sort, case de l'ennemi) → portée ». Clé : positions de tous les combattants,
 * ordre des prochains tours, mobilité de l'allié. Partagée par tous les états de même clé.
 */
interface PotGeo {
  k2: number
  ok: boolean; roundOffset: number; ap: number
  reach: ReachInfo | null; los: LosOracle | null
  /** (sort × CELL_COUNT + case) → coefficient de portée (1, 0,6, 0) et PA restants sur la case de lancer. */
  memo: Map<number, { hit: number; apAt: number }>
}
const GEO_CACHE_MAX = 2048

export class PotentialModelImpl implements PotentialModel {
  readonly dpt: DptTableImpl
  readonly w: ValueWeights
  s!: FightState
  order!: SlotOrder
  /** Diagnostic (bancs) : géométries d'alliés réutilisées / recalculées. */
  geoHits = 0
  geoMisses = 0
  private pot = new Float64Array(0)
  private target = new Int32Array(0)
  private signature = 0
  private readonly occ = new Int16Array(CELL_COUNT)
  private readonly geoCache = new Map<number, PotGeo>()
  private threatMemo = new Float64Array(0)
  private weight = new Float64Array(0)
  private readonly enemies: Fighter[] = []
  private readonly enemyCells: number[] = []

  constructor(readonly view: AIView, readonly side: TeamId, readonly perception?: Perception,
              readonly scenario?: ScenarioAIModel, theta?: ThetaJson, public bb?: Blackboard) {
    this.dpt = (perception?.dpt as DptTableImpl | undefined) ?? createDptTable(view.engine)
    this.w = theta ? { ...DEFAULT_WEIGHTS, ...theta.value } : DEFAULT_WEIGHTS
  }

  sync(s: FightState): void {
    const sig = stateSig(s)
    if (s === this.s && sig === this.signature) return
    this.signature = sig
    this.build(s, sig)
  }

  potential(id: number): number {
    return id < this.pot.length ? this.pot[id] : 0
  }

  bestTarget(id: number): number | undefined {
    const t = id < this.target.length ? this.target[id] : -1
    return t >= 0 ? t : undefined
  }

  /** Menace propre d'un ennemi (max des DPT sur les alliés), utilisée pour la valeur d'un kill. */
  enemyThreat(e: Fighter): number {
    let best = 0
    for (const a of this.s.fighters) {
      if (!a.alive || a.team !== this.side || a.cell < 0) continue
      const d = this.dpt.dpt(e, a)
      if (d > best) best = d
    }
    return best
  }

  private build(s: FightState, sig: number): void {
    this.s = s
    const n = s.fighters.length
    if (this.pot.length < n) {
      this.pot = new Float64Array(n)
      this.target = new Int32Array(n)
    }
    this.pot.fill(0)
    this.target.fill(-1)
    const fr = geoFrame(this.view.engine, s, this.side, sig)
    const order = (this.order = fr.order)
    const enemies = this.enemies
    const cells = this.enemyCells
    enemies.length = 0
    cells.length = 0
    for (const e of s.fighters) {
      if (!e.alive || e.team === this.side || isStaticFighter(e)) continue
      const c = believedCell(e, this.side)
      if (c < 0) continue
      enemies.push(e)
      cells.push(c)
    }
    if (!enemies.length) return
    buildOccupancy(s, this.side, this.occ)
    const p1 = fr.p1
    const p2 = fr.p2
    if (this.threatMemo.length < enemies.length) {
      this.threatMemo = new Float64Array(enemies.length + 8)
      this.weight = new Float64Array(enemies.length + 8)
    }
    this.threatMemo.fill(-1)
    const engine = this.view.engine
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j]
      // −1 : invulnérable à son prochain tour (aucun potentiel sur lui) ; sinon v_e (§7).
      this.weight[j] = flagAtNextTurn(engine, e, 'invulnerable', order) ? -1 : damageWeightOf(e, this.w, this.scenario, this.bb)
    }
    if (VALS.length < enemies.length) {
      VALS = new Float64Array(enemies.length + 8)
      BEST = new Int16Array(enemies.length + 8)
    }
    for (const a of s.fighters) {
      if (!a.alive || a.team !== this.side || a.cell < 0 || a.carriedBy !== undefined) continue
      const md = mobilityDigest(a)
      const k1 = fnvInt(fnvInt(p1, a.id), md)
      const k2 = fnvInt(fnvInt(p2, a.id), md)
      let g = this.geoCache.get(k1)
      if (g && g.k2 === k2) this.geoHits++
      else {
        g = this.geoOne(s, a, order)
        g.k2 = k2
        if (this.geoCache.size >= GEO_CACHE_MAX) this.geoCache.clear()
        this.geoCache.set(k1, g)
      }
      if (g.ok) this.hpOne(s, a, g)
    }
  }

  /** Géométrie d'un allié : joue-t-il, PA/PM du prochain tour, accessibilité, LdV. */
  private geoOne(s: FightState, a: Fighter, order: SlotOrder): PotGeo {
    this.geoMisses++
    const engine = this.view.engine
    const g: PotGeo = { k2: 0, ok: false, roundOffset: 1, ap: 0, reach: null, los: null, memo: new Map() }
    if (isStaticFighter(a) || order.passes(a.id)) return g
    if (flagAtNextTurn(engine, a, 'cantDealDamage', order)) return g
    const am = nextTurnApMp(a, order)
    if (am.ap <= 0) return g
    g.ok = true
    g.ap = am.ap
    const rank = order.rank(a.id)
    g.roundOffset = rank < order.count ? order.slots[rank].round - Math.max(1, s.round) : 1
    g.reach = cachedReach(engine, s, a, this.side, Math.floor(am.mp), am.ap, this.occ)
    // L'oracle lit `this.occ`, identique à chaque réutilisation (même clé de position).
    g.los = new LosOracle(s, this.side, a.id, this.occ)
    return g
  }

  /** Portée de l'allié sur la case `cell` avec son meilleur sort `bi` (1), un sort plus faible (0,6) ou rien (0). */
  private pairHit(s: FightState, a: Fighter, g: PotGeo, bi: number, cell: number): { hit: number; apAt: number } {
    const key = bi * CELL_COUNT + cell
    let r = g.memo.get(key)
    if (r) return r
    r = { hit: 0, apAt: g.ap }
    const reach = g.reach!
    const los = g.los!
    const c1 = this.castCell(s, a, bi, cell, reach, los, g.ap)
    if (c1 >= 0) {
      r.hit = 1
      r.apAt = reach.apLeft[c1]
    } else {
      const profiles = this.dpt.profiles.ofFighter(a)
      for (let k = 0; k < profiles.length; k++) {
        if (k === bi || !profiles[k].damage.length) continue
        const c = this.castCell(s, a, k, cell, reach, los, g.ap)
        if (c >= 0) {
          r.hit = 0.6
          r.apAt = reach.apLeft[c]
          break
        }
      }
    }
    g.memo.set(key, r)
    return r
  }

  /** Couche « PV » : Pot_a = max_e [min(dmg, hpEff_e)·v_e + P(kill)·killValue_e] + 0,3 × 2e cible dans la zone. */
  private hpOne(s: FightState, a: Fighter, g: PotGeo): void {
    const enemies = this.enemies
    const nE = enemies.length
    const vals = VALS
    const calib = calibrationOf(a)
    let bestVal = 0
    let bestJ = -1
    for (let j = 0; j < nE; j++) {
      vals[j] = 0
      BEST[j] = -1
      const v = this.weight[j]
      if (v < 0) continue // invulnérable à son prochain tour
      const e = enemies[j]
      if (this.scenario?.vulnerableAt && !this.scenario.vulnerableAt(s, e, g.roundOffset)) continue
      const best = this.dpt.bestCast(a, e, 'next')
      const bi = best.index
      if (bi < 0) continue
      BEST[j] = bi
      const ph = this.pairHit(s, a, g, bi, this.enemyCells[j])
      if (ph.hit <= 0) continue
      const t = this.dpt.turn(a, e, ph.apAt, 'next')
      const dmg = t.mean * calib * ph.hit
      const variance = t.variance * calib * calib * ph.hit
      const he = hpEff(e)
      let th = this.threatMemo[j]
      if (th < 0) this.threatMemo[j] = th = this.enemyThreat(e)
      const killValue = this.w.killKappa * e.maxHp + this.w.killTau * th
      const val = Math.min(dmg, he) * v + killProbability(dmg, variance, he) * killValue
      vals[j] = val
      if (val > bestVal) {
        bestVal = val
        bestJ = j
      }
    }
    if (bestJ < 0) return
    // Deuxième cible dans la zone du meilleur sort : +0,3 × sa valeur.
    const p = this.dpt.profiles.ofFighter(a)[BEST[bestJ]]
    if (p && p.zoneRadius > 0) {
      const tc = this.enemyCells[bestJ]
      let second = 0
      for (let j = 0; j < nE; j++) {
        if (j === bestJ) continue
        if (distance(this.enemyCells[j], tc) <= p.zoneRadius && vals[j] > second) second = vals[j]
      }
      bestVal += 0.3 * second
    }
    this.pot[a.id] = bestVal
    this.target[a.id] = enemies[bestJ].id
  }

  private castCell(s: FightState, a: Fighter, i: number, cell: number, reach: ReachInfo, los: LosOracle, ap: number): number {
    const ks = a.spells[i]
    const lvl = levelFor(a, ks)
    if (!nextTurnStaticOk(this.view.engine, a, ks, lvl, ap)) return -1
    return firstCastCell(s, a, ks, lvl, cell, reach, los, true)
  }
}

let VALS = new Float64Array(16)
let BEST = new Int16Array(16)

/** Construit le potentiel du camp de la vue (ou `side`) sur `s` (§6.6). */
export function buildPotential(view: AIView, s: FightState, p?: Perception, scenario?: ScenarioAIModel,
                               opts: { side?: TeamId; theta?: ThetaJson; bb?: Blackboard } = {}): PotentialModelImpl {
  const m = new PotentialModelImpl(view, opts.side ?? view.team, p, scenario, opts.theta, opts.bb)
  m.sync(s)
  return m
}
