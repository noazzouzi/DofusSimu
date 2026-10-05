/**
 * Allocation des intentions (docs/design/ai.md §9.5) — WP2.
 *
 * ```
 * besoins = []
 * pour chaque ennemi e trié par contribution à l'incoming (desc), non réservé (kill prévu avant son tour) :
 *     besoin control(e, mpMax = PM max pour que e n'atteigne aucun allié), prix = baisse de menace estimée
 * pour chaque allié a avec deathRisk > θ.team.protectDeathProb : protect(a) (et survive(a) s'il joue avant la menace)
 * pour chaque allié empoisonné (poison retiré par soin) : cleanse(a), prix = Σ des ticks restants
 * affectation gloutonne par prix décroissant, aux seuls alliés qui jouent AVANT l'échéance (timeline) :
 *     u(i, n) = prix · aptitude(rôle_i, n.kind) · faisabilité(i, n)    // portée des sorts utiles + PM
 *     ≤ θ.team.maxIntentsPerAlly intentions par allié ; tout est recalculé au tour suivant (horizon glissant)
 * ```
 * Les intentions d'allocation complètent la valeur V (déjà sensible à la menace) : leur prix est volontairement
 * modéré (½ de la baisse estimée) pour coordonner sans double compter (§7, règle 2). Les contrats de kill du plan de
 * scénario (setup/position) sont publiés par le modèle du scénario lui-même (WP3), pas ici.
 */
import { isStaticFighter } from '../../engine/targetMask'
import type { Fighter, FightState } from '../../engine/types'
import { distance } from '../../map/geometry'
import { believedCell, nextTurnApMp, pendingDotOn, type PerceptionX } from '../core'
import type { SlotOrder } from '../core/timeline'
import type { AIView, Blackboard, CapabilityProfile, Intent, IntentKind, RoleId, ThetaJson } from '../types'
import { healCleansablePoison } from '../tactical/evaluate'
import { damageRange } from './blackboard'

interface Need {
  kind: IntentKind
  target: number
  price: number
  /** Rang (timeline) de l'échéance : seuls les alliés de rang inférieur peuvent la servir. */
  deadline: number
  params?: Record<string, number>
  explain: string
  source: Intent['source']
}

/**
 * Part de la perte attendue d'un Pacifiste payée par l'intention de contrôle d'un poseur de Pacifiste (réglage, tour 4 ;
 * 0 = prix d'origine, ½ × ¾ de la contribution à l'incoming).
 */
const PAC_CONTROL = 0

/** Fenêtre (tour, index) du créneau courant jusqu'au créneau de rang `rank`. */
function windowTo(s: FightState, order: SlotOrder, rank: number): Intent['window'] {
  const sl = order.slots[Math.min(rank, order.slots.length - 1)]
  return { fromRound: s.round, fromIndex: Math.max(0, s.turnIndex), toRound: sl ? sl.round : s.round + 1, toIndex: sl ? sl.index : 0 }
}

/** Portée max d'une famille de sorts d'un allié (filtre sur le profil). */
function rangeOf(p: PerceptionX, f: Fighter, pred: (pr: ReturnType<PerceptionX['profiles']['ofFighter']>[number]) => boolean): number {
  let r = -1
  for (const pr of p.profiles.ofFighter(f)) {
    if (pr.unsupported || !pred(pr)) continue
    r = Math.max(r, pr.maxRange + (pr.level.rangeBoostable ? Math.max(0, f.stats.range) : 0))
  }
  return r
}

/** Aptitude d'un rôle à une nature d'intention. */
function aptitude(role: RoleId | undefined, kind: IntentKind): number {
  switch (kind) {
    case 'control':
      return role === 'mpLock' || role === 'apLock' ? 1 : role === 'placer' ? 0.6 : role === 'killer' || role === 'zoneDps' ? 0.4 : 0.3
    case 'protect':
      return role === 'healer' || role === 'support' || role === 'tank' ? 1 : role === 'placer' ? 0.7 : 0.4
    case 'cleanse':
      return role === 'healer' ? 1 : 0.6
    case 'survive':
      return 1
    default:
      return 0.5
  }
}

/** Faisabilité (0..1) : un sort utile porte sur la cible après un déplacement. */
function feasibility(p: PerceptionX, a: Fighter, n: Need, target: Fighter, caps: CapabilityProfile | undefined): number {
  // Case de la cible vue par l'équipe de `a` (invisible adverse : dernière case connue, §6.1).
  const tc = believedCell(target, a.team)
  if (tc < 0) return 0
  const d = distance(a.cell, tc)
  const mp = Math.max(0, a.stats.mp)
  const within = (r: number): number => (r < 0 ? 0 : d <= r ? 1 : d <= r + mp ? 0.8 : 0.2)
  switch (n.kind) {
    case 'control': {
      const r = rangeOf(p, a, pr => pr.removals.some(x => x.pool === 'mp' && x.sides.enemy) || pr.moves.some(m => !m.onCaster && m.sides.enemy))
      return caps && caps.mpRemoval <= 0 && caps.placement <= 0 ? 0 : within(r)
    }
    case 'protect': {
      const r = rangeOf(p, a, pr => pr.heals.some(h => h.sides.ally) || pr.shields.some(h => h.sides.ally) || pr.moves.some(m => m.sides.ally))
      return within(r)
    }
    case 'cleanse': {
      const r = rangeOf(p, a, pr => pr.heals.some(h => h.sides.ally || h.sides.self))
      return within(r)
    }
    case 'survive':
      return a.id === target.id ? 1 : 0
    default:
      return 0.5
  }
}

/**
 * Recalcule les intentions d'allocation (`source` 'allocator' / 'emergency') du tableau noir ; les intentions des
 * autres sources (scénario, burst, doctrine) sont conservées.
 */
export function allocateIntents(view: AIView, p: PerceptionX, bb: Blackboard, theta: ThetaJson, caps: ReadonlyMap<number, CapabilityProfile>): void {
  const s = view.fight
  p.sync(s)
  const team = view.team
  const order = p.threat.order
  const tt = theta.team
  bb.intents = bb.intents.filter(i => i.source !== 'allocator' && i.source !== 'emergency')
  const allies = s.fighters.filter(f => f.alive && f.team === team && f.cell >= 0 && !isStaticFighter(f))
  const needs: Need[] = []
  const reserved = new Set<number>()
  for (const r of bb.reservations.values()) if (r.p >= 0.8) reserved.add(r.targetId)
  // Contrôle des ennemis menaçants (par contribution décroissante).
  const enemies = s.fighters.filter(f => f.alive && f.team !== team && believedCell(f, team) >= 0 && !isStaticFighter(f))
    .map(e => ({ e, c: p.threat.contribution(e) }))
    .filter(x => x.c > 0)
    .sort((a, b) => b.c - a.c || a.e.id - b.e.id)
  for (const { e, c } of enemies) {
    if (reserved.has(e.id)) continue
    const row = p.threat.rowOf(e)
    if (!row || !row.active || row.hitsFromStart) continue
    const ec = believedCell(e, team)
    let dmin = Infinity
    for (const a of allies) dmin = Math.min(dmin, distance(ec, a.cell))
    let mpMax = Math.max(0, dmin - damageRange(p, e) - 1)
    const next = nextTurnApMp(e, order, { ap: 0, mp: 0 })
    let price = 0.5 * 0.75 * c
    let what = "qu'il n'atteigne personne"
    // Poseur de Pacifiste (Méjaire, réglage tour 4) : le contrôle vaut la perte attendue des tours de dégâts des
    // personnages qu'il peut pacifier (2 cibles par tour : min(1, 2π)·portée·valeur du Pacifiste) ; PM maximaux pour
    // rester hors de portée du sort Pacifiste (et non du meilleur sort à dégâts, plus long : Plumière 3-7).
    if (PAC_CONTROL > 0 && row.pacifist && row.pacSpells) {
      let pac = 0
      for (let i = 0; i < row.nA; i++) {
        const a = p.threat.allies[i]
        if (!a || a.kind !== 'player' || !order.before(e.id, a.id)) continue
        pac += Math.min(1, 2 * row.pi[i]) * Math.min(1, row.pacH[i]) * row.pacU[i]
      }
      if (PAC_CONTROL * pac > price) {
        let pr = 0
        for (const k of row.pacSpells) pr = Math.max(pr, p.profiles.ofFighter(e)[k]?.maxRange ?? 0)
        let dminP = Infinity
        for (const a of allies) if (a.kind === 'player') dminP = Math.min(dminP, distance(ec, a.cell))
        price = PAC_CONTROL * pac
        mpMax = Math.max(0, dminP - pr - 1)
        what = "qu'il ne puisse pacifier personne"
      }
    }
    if (next.mp <= mpMax) continue
    needs.push({
      kind: 'control', target: e.id, price, deadline: order.rank(e.id), params: { mpMax },
      explain: `Contrôler ${e.name} : PM ≤ ${mpMax} pour ${what}`, source: 'allocator',
    })
  }
  // Protection / survie / purge.
  const emergency = theta.team.emergencyDeathProb
  bb.emergency = false
  for (const a of allies) {
    const risk = p.threat.deathRisk(a.id)
    const summon = a.kind === 'summon' || a.summonerId !== undefined
    if (risk > tt.protectDeathProb && !summon) {
      const urgent = risk > emergency
      if (urgent) bb.emergency = true
      const deathCost = a.baseMaxHp + 2 * p.potential.potential(a.id)
      const price = 0.5 * risk * deathCost * (urgent ? 1.5 : 1)
      // Échéance : premier ennemi actif qui joue avant le prochain tour de l'allié.
      let deadline = order.rank(a.id)
      for (const { e } of enemies) if (order.before(e.id, a.id)) deadline = Math.min(deadline, order.rank(e.id))
      needs.push({ kind: 'protect', target: a.id, price, deadline, explain: `Protéger ${a.name} (risque de mort ${Math.round(risk * 100)} %)`, source: urgent ? 'emergency' : 'allocator' })
      needs.push({ kind: 'survive', target: a.id, price, deadline, explain: `${a.name} doit survivre`, source: urgent ? 'emergency' : 'allocator' })
    }
    if (healCleansablePoison(a)) {
      const price = theta.value.dot * pendingDotOn(s, a, theta.value.dotDecay)
      if (price > 0) needs.push({ kind: 'cleanse', target: a.id, price, deadline: order.rank(a.id), explain: `Soigner ${a.name} pour retirer son poison`, source: 'allocator' })
    }
  }
  needs.sort((a, b) => b.price - a.price || a.target - b.target || a.kind.localeCompare(b.kind))
  const count = new Map<number, number>()
  for (const n of needs) {
    const target = s.fighters[n.target]
    if (!target) continue
    let best: Fighter | undefined
    let bu = 0
    for (const a of allies) {
      if ((count.get(a.id) ?? 0) >= tt.maxIntentsPerAlly) continue
      // Seuls les alliés qui jouent avant l'échéance (le combattant courant joue maintenant).
      if (a.id !== view.me.id && order.rank(a.id) >= n.deadline) continue
      if (n.kind === 'survive' && a.id !== target.id) continue
      if (n.kind !== 'survive' && a.id === target.id && n.kind !== 'cleanse') continue
      const u = n.price * aptitude(bb.roles.get(a.id)?.primary, n.kind) * feasibility(p, a, n, target, caps.get(a.id))
      if (u > bu + 1e-9) {
        bu = u
        best = a
      }
    }
    if (!best || bu <= 0) continue
    count.set(best.id, (count.get(best.id) ?? 0) + 1)
    bb.intents.push({
      id: `${n.source}:${n.kind}:${n.target}:${best.id}`,
      kind: n.kind,
      owner: best.id,
      window: windowTo(s, order, n.deadline),
      target: n.target,
      ...(n.params ? { params: n.params } : {}),
      price: n.price,
      source: n.source,
      explain: n.explain,
    })
  }
}
