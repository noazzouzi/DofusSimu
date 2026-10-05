/**
 * Fonction de valeur V(s) (docs/design/ai.md §7) — WP1 (`tactical/evaluate.ts` de WP2 y ajoute bandes de PV, horloge
 * et intentions, §8.4).
 *
 * Valeur ABSOLUE d'un état du point de vue de l'équipe de la vue ; une décision compare V(feuille) − V(racine).
 * Unité : PVe. Notations : hpEff = PV + 0,9·bouclier ; A = alliés (personnages + invocations) ; E = ennemis non
 * statiques. Poids : θ.value (annexe A).
 *
 * | terme        | formule                                                                                         |
 * |--------------|-------------------------------------------------------------------------------------------------|
 * | enemyLife    | −Σ_e v_e·hpEff_e (v_e : scénario `damageWeight`, monstre 1, invocation 0,5, invulnérable 0 (**)) |
 * | kills        | Σ_{e mort depuis la racine} deathValue ?? (κ·PVmax_e + τ·menace_e)                              |
 * | allyLife     | Σ_a ω_a·(PV_a + 0,8·bouclier_a), ω 1 (invocations 0,4)                                           |
 * | erosion      | −w_er·Σ_a (PVmax non érodés − PVmax)                                                             |
 * | allyDeath    | −Σ_{a mort} (PVmax de base + 2·dpt_a + U_role + allyDeathExtra) (invocations : 0,4·PVmax)       |
 * | incoming     | −Σ_a w_inc·[min(inc_a, hpEff_a) + deathRisk_a·coût de mort_a] (tank 0,6)                        |
 * | pendingDot   | −w_dot·Σ_a Σ_k 0,8^k·DoT_a(k) + w_dot·Σ_e v_e·min(Σ_k 0,8^k·DoT_e(k), hpEff_e)  (*)              |
 * | control      | w_ctl·Σ_e (ΔPA_next·apWorth_e + ΔPM_next·mpWorth_e) depuis la racine                           |
 * | potential    | Σ_a w_pot(a)·Pot_a (0,35 si a joue avant l'ennemi le plus menaçant, sinon 0,15)                 |
 * | continuation | w_cont·restOfTurn(me, s) sur les feuilles NON terminales                                        |
 * | resources    | −0,08·Σ_{sorts lancés} relance·valeur moyenne − 2·PA inutilisés (feuille terminale)              |
 * | position     | `opts.position` (termes de rôle de WP2, case finale)                                            |
 * | scenario     | 0 ici : bandes, horloge, cases et intentions sont ajoutées par `evaluate.ts` (WP2)                |
 *
 * (**) Seulement si l'ennemi était déjà invulnérable à la racine : sinon un sort qui rend un ennemi invulnérable un
 * tour (Emprise du Iop, Corruption de l'Enutrof) ferait « disparaître » ses PV de V (écart de lecture du design).
 * (*) Écart assumé : le design ne compte que les poisons ALLIÉS ; les DoT posés sur les ennemis sont ajoutés (même
 * poids) pour qu'un poison rapporte dès sa pose plutôt qu'au tour suivant (sinon seuls les rollouts le voient).
 */
import type { TeamId } from '../../core/types'
import type { ScenarioAIModel } from '../../dungeons/types'
import type { EffectData } from '../../data/model'
import { DAMAGE_SPECS, unerodedMaxHp } from '../../engine/effects/damage/pipeline'
import { isStaticFighter } from '../../engine/targetMask'
import type { Fighter, FightState } from '../../engine/types'
import { distance } from '../../map/geometry'
import type { ThetaJson } from '../theta'
import type { AIView, Blackboard, EvalBreakdown, Perception, RoleId } from '../types'
import { castFailureStatic, hitCellsFor, hitsFrom, LosOracle, levelFor } from './castCells'
import { calibrationOf, lineDamage, type DptTableImpl } from './dpt'
import { killProbability } from './kill'
import type { PerceptionX } from './perception'
import { damageWeightOf, type ValueWeights } from './potential'
import { buildOccupancy, cachedReach } from './reach'
import type { DamageLineX } from './spellProfile'
import { flagAtNextTurn, hpEff, nextTurnApMp } from './threat'
import { believedCell } from './view'

export interface ValueOptions {
  /** État racine de la décision (termes relatifs : kills, morts alliées, contrôle, ressources). */
  root?: FightState
  scenario?: ScenarioAIModel
  bb?: Blackboard
  /** Feuille terminale (défaut vrai) : continuation 0 et pénalité des PA inutilisés ; faux dans le faisceau. */
  terminal?: boolean
  /** Combattant qui décide (défaut : `view.me`). */
  meId?: number
  /** Terme de position calculé par la couche tactique (WP2). */
  position?: number
}

const ZERO: EvalBreakdown = {
  total: 0, enemyLife: 0, kills: 0, allyLife: 0, erosion: 0, allyDeath: 0, incoming: 0, pendingDot: 0,
  control: 0, potential: 0, continuation: 0, resources: 0, position: 0, scenario: 0,
}

/** Rôle principal d'un allié (tableau noir), s'il est connu. */
function roleOf(bb: Blackboard | undefined, id: number): RoleId | undefined {
  return bb?.roles.get(id)?.primary
}

/** U_role : coût additionnel de la mort d'un porteur de rôle clé (θ.value.roleUtility). */
function roleUtility(theta: ThetaJson, role: RoleId | undefined): number {
  if (!role) return 0
  const u = theta.value.roleUtility as Record<string, number>
  return u[role] ?? 0
}

/** Source de DPT : table (`DptTableImpl`) ou cadre de l'état `ref` (`DptFrame`). */
export interface DptSource { dpt(a: Fighter, d: Fighter): number }

/** Meilleur DPT de `a` contre les ennemis vivants de `ref` (`dpt_a` du terme allyDeath). */
export function bestDpt(dpt: DptSource, a: Fighter, ref: FightState, side: TeamId): number {
  let best = 0
  for (const e of ref.fighters) {
    if (!e.alive || e.team === side || isStaticFighter(e)) continue
    const d = dpt.dpt(a, e)
    if (d > best) best = d
  }
  return best
}

/** Menace propre d'un ennemi : max des DPT sur les alliés vivants de `ref`. */
export function enemyThreatIn(dpt: DptSource, e: Fighter, ref: FightState, side: TeamId): number {
  let best = 0
  for (const a of ref.fighters) {
    if (!a.alive || a.team !== side || a.cell < 0) continue
    const d = dpt.dpt(e, a)
    if (d > best) best = d
  }
  return best
}

const DOT_LINES = new WeakMap<EffectData, DamageLineX | null>()

/** Ligne de dégâts (lanceur = source du buff) d'un buff de poison (déclencheur TB/TE). */
function dotLine(e: EffectData): DamageLineX | null {
  let l = DOT_LINES.get(e)
  if (l !== undefined) return l
  const spec = DAMAGE_SPECS.get(e.effectId)
  l = spec
    ? { element: spec.element, min: e.diceNum, max: Math.max(e.diceNum, e.diceSide), critMin: e.diceNum, critMax: Math.max(e.diceNum, e.diceSide),
        zone: e.zone, mask: e.targetMask, lifeSteal: spec.steal, delayed: 0, dotTurns: 1, effectId: e.effectId, family: spec.family,
        p: 1, sub: false, sides: { enemy: true, ally: true, self: true, selfOnly: false }, effect: e, critEffect: null }
    : null
  DOT_LINES.set(e, l)
  return l
}

/** Dégâts programmés (poisons TB/TE) sur `f`, décrus de 0,8 par tour : Σ_k 0,8^k·tick. */
export function pendingDotOn(s: FightState, f: Fighter, decay: number): number {
  let total = 0
  for (const b of f.buffs) {
    if (b.kind !== 'trigger' || !b.triggers || !/(^|\|)(TB|TE)(\||$)/.test(b.triggers)) continue
    const line = dotLine(b.effect)
    if (!line) continue
    const src = s.fighters[b.sourceId] ?? f
    const tick = lineDamage(src, f, line, b.spellId, false, false, 1, 0).mean
    const ticks = b.remaining < 0 ? 3 : Math.max(1, b.remaining)
    let w = 0
    let k = 1
    for (let i = 0; i < ticks; i++, k *= decay) w += k
    total += tick * w
  }
  return total
}

/**
 * Valeur analytique du reste du tour de `me` sur `s` (terme `continuation`) : meilleur ennemi de
 * [min(dégâts, hpEff)·v_e + P(kill)·valeur du kill] avec les PA/PM restants, depuis les cases atteignables d'où au
 * moins un sort porte (sac à dos « reste du tour » des sorts lançables depuis la même case).
 */
export function restOfTurn(view: AIView, s: FightState, me: Fighter, p: PerceptionX, w: ValueWeights, scenario?: ScenarioAIModel, bb?: Blackboard): number {
  if (!me.alive || me.ap <= 0) return 0
  const engine = view.engine
  const dpt = p.dpt
  const occ = buildOccupancy(s, view.team)
  const reach = cachedReach(engine, s, me, view.team, me.mp, me.ap, occ)
  const los = new LosOracle(s, view.team, me.id, occ)
  const profiles = dpt.profiles.ofFighter(me)
  const usable: number[] = []
  for (let i = 0; i < me.spells.length; i++) {
    if (!profiles[i].damage.length) continue
    const ks = me.spells[i]
    if (castFailureStatic(engine, me, ks, levelFor(me, ks), me.ap) === null) usable.push(i)
  }
  if (!usable.length) return 0
  const calib = calibrationOf(me)
  let best = 0
  for (const e of s.fighters) {
    if (!e.alive || e.team === me.team || isStaticFighter(e)) continue
    const cell = believedCell(e, view.team)
    if (cell < 0) continue
    const v = damageWeightOf(e, w, scenario, bb)
    if (v <= 0 && !(scenario?.deathValue)) continue
    const seen = new Set<number>()
    for (const i of usable) {
      const ks = me.spells[i]
      // Case d'où ce sort inflige ses dégâts à e (visée directe, couronne, zone autour du lanceur, portée 0 à zone).
      hitCellsFor(s, me, ks, levelFor(me, ks), profiles[i], cell, reach, los, 1, HIT_CELLS)
      const c = HIT_CELLS.length ? HIT_CELLS[0] : -1
      if (c < 0 || seen.has(c)) continue
      seen.add(c)
      const filter = (k: number) => {
        if (!usable.includes(k)) return false
        if (k === i) return true
        const kk = me.spells[k]
        const lvl = levelFor(me, kk)
        return reach.apLeft[c] >= lvl.apCost && hitsFrom(s, me, kk, lvl, profiles[k], c, cell, los)
      }
      const t = dpt.turn(me, e, reach.apLeft[c], 'now', filter)
      const mean = t.mean * calib
      const he = hpEff(e)
      const killValue = w.killKappa * e.maxHp + w.killTau * enemyThreatIn(dpt, e, s, view.team)
      const val = Math.min(mean, he) * v + killProbability(mean, t.variance * calib * calib, e.hp + e.shield) * killValue
      if (val > best) best = val
    }
  }
  return best
}

/** Valeur moyenne d'un lancer d'un sort (pour le coût de relance) : meilleur lancer sur un ennemi de `ref`. */
function meanSpellValue(dpt: DptTableImpl, me: Fighter, spellIndex: number, ref: FightState): number {
  let best = 0
  for (const e of ref.fighters) {
    if (!e.alive || e.team === me.team || isStaticFighter(e)) continue
    const m = dpt.perCast(me, spellIndex, e).mean
    if (m > best) best = m
  }
  return best
}

/** V(s) décomposée (§7), du point de vue de `view.team`. `p` est synchronisée sur `s`. */
export function valueOf(view: AIView, s: FightState, perception: Perception, opts: ValueOptions = {}): EvalBreakdown {
  const p = perception as PerceptionX
  const theta: ThetaJson = p.theta
  const tv = theta.value
  const side = view.team
  const root = opts.root
  const scenario = opts.scenario ?? p.scenario
  const bb = opts.bb ?? p.bb
  const engine = view.engine
  const dpt = p.dpt
  if (p.bb !== bb) p.bb = bb
  p.sync(s)
  const threat = p.threat
  const potential = p.potential
  const order = threat.order
  // Paires (a → d) de l'état courant : cadre DPT de la perception (mémo sans hachage).
  const cur: DptSource = p.frame && p.frame.s === s ? p.frame : dpt
  const w: ValueWeights = tv
  const out: EvalBreakdown = { ...ZERO }

  // Ennemi le plus menaçant (pour w_pot).
  let topThreatId = -1
  let topThreat = 0
  for (const row of threat.enemies) {
    if (row.active && row.threat > topThreat) {
      topThreat = row.threat
      topThreatId = row.e.id
    }
  }

  for (const f of s.fighters) {
    const r0 = root?.fighters[f.id]
    if (f.team === side) {
      const summon = f.kind === 'summon' || f.summonerId !== undefined
      const omega = summon ? tv.summonLife : 1
      if (f.alive) {
        out.allyLife += omega * (f.hp + tv.allyShield * f.shield)
        const lost = unerodedMaxHp(f) - f.maxHp
        if (lost > 0) out.erosion -= tv.erosion * lost * omega
        const inc = threat.incoming(f.id)
        if (inc > 0) {
          const role = roleOf(bb, f.id)
          const wInc = role === 'tank' ? tv.incomingTank : tv.incoming
          const risk = threat.deathRisk(f.id)
          const deathCost = summon ? omega * f.baseMaxHp
            : f.baseMaxHp + tv.deathPotMult * bestDpt(cur, f, s, side) + roleUtility(theta, role) + (scenario?.allyDeathExtra?.(s, f) ?? 0)
          out.incoming -= wInc * omega * (Math.min(inc, hpEff(f)) + risk * deathCost)
        }
        if (f.buffs.length) out.pendingDot -= tv.dot * omega * pendingDotOn(s, f, tv.dotDecay)
        if (!isStaticFighter(f)) {
          const pot = potential.potential(f.id)
          if (pot > 0) out.potential += (topThreatId < 0 || order.before(f.id, topThreatId) ? tv.potBefore : tv.potAfter) * pot
        }
      } else if (!root || (r0 && r0.alive)) {
        if (summon) out.allyDeath -= omega * f.baseMaxHp
        else {
          const ref = root ?? s
          const a0 = r0 ?? f
          out.allyDeath -= f.baseMaxHp + tv.deathPotMult * bestDpt(dpt, a0, ref, side) + roleUtility(theta, roleOf(bb, f.id))
            + (scenario?.allyDeathExtra?.(s, f) ?? 0)
        }
      }
      continue
    }
    // Ennemis.
    if (f.alive) {
      if (isStaticFighter(f)) continue
      let v = damageWeightOf(f, w, scenario, bb)
      // Invulnérable jusqu'au prochain tour allié ⇒ v_e = 0, mais seulement si l'ennemi l'était déjà à la racine :
      // rendre un ennemi invulnérable (Emprise, Corruption…) ne fait pas disparaître ses PV.
      if (v > 0 && engine.stateFlag(f, 'invulnerable') && flagAtNextTurn(engine, f, 'invulnerable', order)
          && (!r0 || engine.stateFlag(r0, 'invulnerable'))) v = 0
      const he = hpEff(f)
      out.enemyLife -= v * he
      if (v > 0 && f.buffs.length) {
        const dot = pendingDotOn(s, f, tv.dotDecay)
        if (dot > 0) out.pendingDot += tv.dot * v * Math.min(dot, he)
      }
      if (root && r0 && r0.alive && tv.control !== 0) {
        const a0 = nextTurnApMp(r0, order, AM0)
        const a1 = nextTurnApMp(f, order, AM1)
        const dAp = a0.ap - a1.ap
        const dMp = a0.mp - a1.mp
        if (dAp !== 0 || dMp !== 0) {
          const th = enemyThreatIn(dpt, r0, root, side)
          let alpha = 0.15
          const best = dpt.profiles.ofFighter(r0).reduce((m, x) => (x.damage.length && x.maxRange > m ? x.maxRange : m), 0)
          let near = Infinity
          const c0 = believedCell(r0, side)
          for (const a of root.fighters) if (a.alive && a.team === side && a.cell >= 0) near = Math.min(near, distance(c0, a.cell))
          if (near > best) alpha = 0.6
          out.control += tv.control * (dAp * (th / Math.max(1, a0.ap)) + dMp * ((alpha * th) / Math.max(1, a0.mp)))
        }
      }
    } else if (root && r0 && r0.alive) {
      const dv = bb && scenario?.deathValue ? scenario.deathValue(root, s, f, bb) : undefined
      out.kills += dv ?? tv.killKappa * f.maxHp + tv.killTau * enemyThreatIn(dpt, r0, root, side)
    }
  }

  // Combattant qui décide : continuation, ressources.
  const meId = opts.meId ?? view.me.id
  const me = s.fighters[meId]
  const terminal = opts.terminal !== false
  if (me && me.alive && me.team === side) {
    if (!terminal) out.continuation = tv.continuation * restOfTurn(view, s, me, p, w, scenario, bb)
    else if (me.ap > 0 && engine.current(s)?.id === me.id) out.resources -= tv.unusedAp * me.ap
    if (root) {
      const m0 = root.fighters[meId]
      if (m0) {
        // Sorts lancés depuis la racine (clés des lancers du tour : quelques entrées, pas la liste des sorts).
        for (const k in me.castsThisTurn) {
          const cast = me.castsThisTurn[k] - (m0.castsThisTurn[k] ?? 0)
          if (!(cast > 0)) continue
          const spellId = Number(k)
          const i = me.spells.findIndex(x => x.spellId === spellId)
          if (i < 0) continue
          const cd = levelFor(me, me.spells[i]).minCastInterval
          if (cd > 0) out.resources -= tv.cdCost * cd * meanSpellValue(dpt, m0, i, root)
        }
      }
    }
  }
  out.position = opts.position ?? 0
  out.total = out.enemyLife + out.kills + out.allyLife + out.erosion + out.allyDeath + out.incoming + out.pendingDot
    + out.control + out.potential + out.continuation + out.resources + out.position + out.scenario
  return out
}

const HIT_CELLS: number[] = []
const AM0 = { ap: 0, mp: 0 }
const AM1 = { ap: 0, mp: 0 }
