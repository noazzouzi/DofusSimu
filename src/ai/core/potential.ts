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
import { createDptTable, type DptTableImpl } from './dpt'
import { fnvInt, revKey } from './hash'
import { killProbability } from './kill'
import { buildOccupancy, cachedReach } from './reach'
import { SlotOrder } from './timeline'
import { believedCell } from './view'
import { flagAtNextTurn, hpEff, nextTurnApMp } from './threat'

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

export class PotentialModelImpl implements PotentialModel {
  readonly dpt: DptTableImpl
  readonly w: ValueWeights
  s!: FightState
  order!: SlotOrder
  private pot = new Float64Array(0)
  private target = new Int32Array(0)
  private signature = 0
  private readonly occ = new Int16Array(CELL_COUNT)

  constructor(readonly view: AIView, readonly side: TeamId, readonly perception?: Perception,
              readonly scenario?: ScenarioAIModel, theta?: ThetaJson, public bb?: Blackboard) {
    this.dpt = (perception?.dpt as DptTableImpl | undefined) ?? createDptTable(view.engine)
    this.w = theta ? { ...DEFAULT_WEIGHTS, ...theta.value } : DEFAULT_WEIGHTS
  }

  private sig(s: FightState): number {
    let h = fnvInt(fnvInt(0x9747b28c, s.round), s.turnIndex)
    for (const f of s.fighters) {
      if (!f.alive) {
        h = fnvInt(h, ~f.id)
        continue
      }
      h = fnvInt(fnvInt(fnvInt(fnvInt(h, f.cell), f.hp), f.shield), revKey(f))
      h = fnvInt(fnvInt(h, Math.round(f.ap * 100)), Math.round(f.mp * 100))
    }
    return h
  }

  sync(s: FightState): void {
    const sig = this.sig(s)
    if (s === this.s && sig === this.signature) return
    this.signature = sig
    this.build(s)
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

  private build(s: FightState): void {
    const engine = this.view.engine
    this.s = s
    this.order = new SlotOrder(engine, s)
    const n = s.fighters.length
    if (this.pot.length < n) {
      this.pot = new Float64Array(n)
      this.target = new Int32Array(n)
    }
    this.pot.fill(0)
    this.target.fill(-1)
    buildOccupancy(s, this.side, this.occ)
    const enemies: Fighter[] = []
    for (const e of s.fighters) {
      if (!e.alive || e.team === this.side || isStaticFighter(e)) continue
      if (believedCell(e, this.side) < 0) continue
      enemies.push(e)
    }
    if (!enemies.length) return
    for (const a of s.fighters) {
      if (!a.alive || a.team !== this.side || a.cell < 0 || a.carriedBy !== undefined) continue
      this.buildOne(s, a, enemies)
    }
  }

  private buildOne(s: FightState, a: Fighter, enemies: Fighter[]): void {
    const engine = this.view.engine
    const order = this.order
    if (isStaticFighter(a) || order.passes(a.id)) return
    if (flagAtNextTurn(engine, a, 'cantDealDamage', order)) return
    const am = nextTurnApMp(a, order)
    if (am.ap <= 0) return
    const rank = order.rank(a.id)
    const roundOffset = rank < order.count ? order.slots[rank].round - Math.max(1, s.round) : 1
    const reach = cachedReach(engine, s, a, this.side, Math.floor(am.mp), am.ap, this.occ)
    const los = new LosOracle(s, this.side, a.id, this.occ)
    const profiles = this.dpt.profiles.ofFighter(a)
    let bestVal = 0
    let bestE = -1
    let bestSpell = -1
    const vals: number[] = []
    for (const e of enemies) {
      if (this.scenario?.vulnerableAt && !this.scenario.vulnerableAt(s, e, roundOffset)) {
        vals.push(0)
        continue
      }
      if (flagAtNextTurn(engine, e, 'invulnerable', order)) {
        vals.push(0)
        continue
      }
      const eCell = believedCell(e, this.side)
      const best = this.dpt.bestCast(a, e, 'next')
      if (best.index < 0) {
        vals.push(0)
        continue
      }
      let hit = 0
      let apAt = am.ap
      const c1 = this.castCell(s, a, best.index, eCell, reach, los, am.ap)
      if (c1 >= 0) {
        hit = 1
        apAt = reach.apLeft[c1]
      } else {
        for (let k = 0; k < profiles.length; k++) {
          if (k === best.index || !profiles[k].damage.length) continue
          const c = this.castCell(s, a, k, eCell, reach, los, am.ap)
          if (c >= 0) {
            hit = 0.6
            apAt = reach.apLeft[c]
            break
          }
        }
      }
      if (hit === 0) {
        vals.push(0)
        continue
      }
      const dmg = this.dpt.dpt(a, e, apAt) * hit
      const variance = this.dpt.dptVariance(a, e, apAt) * hit
      const he = hpEff(e)
      const v = damageWeightOf(e, this.w, this.scenario, this.bb)
      const killValue = this.w.killKappa * e.maxHp + this.w.killTau * this.enemyThreat(e)
      const val = Math.min(dmg, he) * v + killProbability(dmg, variance, he) * killValue
      vals.push(val)
      if (val > bestVal) {
        bestVal = val
        bestE = enemies.indexOf(e)
        bestSpell = best.index
      }
    }
    if (bestE < 0) return
    // Deuxième cible dans la zone du meilleur sort : +0,3 × sa valeur.
    const p = profiles[bestSpell]
    if (p && p.zoneRadius > 0) {
      const tc = believedCell(enemies[bestE], this.side)
      let second = 0
      for (let i = 0; i < enemies.length; i++) {
        if (i === bestE) continue
        if (distance(believedCell(enemies[i], this.side), tc) <= p.zoneRadius && vals[i] > second) second = vals[i]
      }
      bestVal += 0.3 * second
    }
    this.pot[a.id] = bestVal
    this.target[a.id] = enemies[bestE].id
  }

  private castCell(s: FightState, a: Fighter, i: number, cell: number, reach: ReachInfo, los: LosOracle, ap: number): number {
    const ks = a.spells[i]
    const lvl = levelFor(a, ks)
    if (!nextTurnStaticOk(this.view.engine, a, ks, lvl, ap)) return -1
    return firstCastCell(s, a, ks, lvl, cell, reach, los, true)
  }
}

/** Construit le potentiel du camp de la vue (ou `side`) sur `s` (§6.6). */
export function buildPotential(view: AIView, s: FightState, p?: Perception, scenario?: ScenarioAIModel,
                               opts: { side?: TeamId; theta?: ThetaJson; bb?: Blackboard } = {}): PotentialModelImpl {
  const m = new PotentialModelImpl(view, opts.side ?? view.team, p, scenario, opts.theta, opts.bb)
  m.sync(s)
  return m
}
