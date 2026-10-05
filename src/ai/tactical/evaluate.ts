/**
 * Évaluation d'une feuille de la recherche tactique (docs/design/ai.md §8.4) — WP2.
 *
 *   evalLeaf(s) = valueOf(s).total                        §7 (src/ai/core/value.ts), damageWeight / deathValue du scénario
 *               + Σ_m bande(m, s)                          PriceTable.hp : bandBonus si PV_m ∈ [bandMin, bandMax]
 *               − Σ_m pente·max(0, palier − PV_m)          PriceTable.hp.floor : pente nulle sous le palier
 *               + clock[heures avancées pendant le tour]   heure de l'Auroraire lue dans l'état (glyphes déclenchés)
 *               + cell[case finale]                        feuilles terminales seulement
 *               + Σ_i price_i · sat_i(racine, s)           intentions du combattant courant (§8.4)
 *               + revivedValue(racine, s)                  morts puis résurrections traversées par un rollout (Vortex)
 *
 * Les quatre derniers termes forment `EvalBreakdown.scenario`. Les grandeurs de la racine (heure, PA/PM du prochain
 * tour des ennemis, incoming et potentiel des alliés, sorts lancés) sont calculées une fois par racine et mises en
 * cache (`rootInfo`). L'évaluation ne lit que l'état simulé (vue honnête) : jamais `fight.events` ni les dés.
 */
import { currentHour } from '../../dungeons/vortex/clock'
import type { Fighter, FightState } from '../../engine/types'
import { distance } from '../../map/geometry'
import { hpEff, nextTurnApMp, valueOf, viewOn, type PerceptionX } from '../core'
import type { Blackboard, EvalBreakdown, Intent } from '../types'
import type { TacticalContext } from './node'

export interface LeafOptions {
  /** Feuille terminale : `continuation` = 0, PA inutilisés pénalisés, `cell[case finale]` compté. */
  terminal: boolean
  /** Terme de position (rôle, fin de tour). */
  position?: number
  /** L'état est encore dans le tour du combattant (vrai) ou au-delà (rollout) : `clock[k]` seulement dans le tour. */
  inTurn?: boolean
}

export interface LeafEval {
  v: number
  b: EvalBreakdown
}

/** Grandeurs de la racine d'une recherche (cache par état racine). */
export interface RootInfo {
  v: EvalBreakdown
  hour: number
  /** PA/PM du prochain tour (ennemis), par id. */
  nextAp: Map<number, number>
  nextMp: Map<number, number>
  /** incoming / potentiel des alliés, par id. */
  incoming: Map<number, number>
  potential: Map<number, number>
  deathRisk: Map<number, number>
  hpEff: Map<number, number>
  /** Lancers de ce tour (par sort) du combattant courant. */
  casts: Record<number, number>
}

const ROOT_INFO = new WeakMap<FightState, Map<number, RootInfo>>()

/** Heure de l'Auroraire (Vortex), 0 hors scénario d'horloge. */
export function hourOf(s: FightState): number {
  return s.scenarioState && 'vortex' in s.scenarioState ? currentHour(s) : 0
}

/** Combattant courant de la recherche (même id que `ctx.view.me`). */
function meIn(ctx: TacticalContext, s: FightState): Fighter | undefined {
  return s.fighters[ctx.view.me.id]
}

/** Grandeurs de la racine (`ctx.root`) : calculées une fois, perception synchronisée sur la racine. */
export function rootInfo(ctx: TacticalContext): RootInfo {
  const root = ctx.root ?? ctx.view.fight
  let byMe = ROOT_INFO.get(root)
  if (!byMe) ROOT_INFO.set(root, (byMe = new Map()))
  const k = ctx.view.me.id * 4 + ctx.view.team
  const cached = byMe.get(k)
  if (cached) return cached
  const p = ctx.perception as PerceptionX
  const view = viewOn(ctx.view, root)
  const v = valueOf(view, root, ctx.perception, { root, scenario: ctx.scenario, bb: ctx.bb, terminal: false, meId: ctx.view.me.id })
  const info: RootInfo = {
    v,
    hour: hourOf(root),
    nextAp: new Map(),
    nextMp: new Map(),
    incoming: new Map(),
    potential: new Map(),
    deathRisk: new Map(),
    hpEff: new Map(),
    casts: { ...(meIn(ctx, root)?.castsThisTurn ?? {}) },
  }
  const order = p.threat.order
  const tmp = { ap: 0, mp: 0 }
  for (const f of root.fighters) {
    if (!f.alive) continue
    info.hpEff.set(f.id, hpEff(f))
    if (f.team === ctx.view.team) {
      info.incoming.set(f.id, p.threat.incoming(f.id))
      info.potential.set(f.id, p.potential.potential(f.id))
      info.deathRisk.set(f.id, p.threat.deathRisk(f.id))
    } else if (order) {
      const am = nextTurnApMp(f, order, tmp)
      info.nextAp.set(f.id, am.ap)
      info.nextMp.set(f.id, am.mp)
    }
  }
  byMe.set(k, info)
  return info
}

/** Intention active pour le créneau courant (fenêtre [from, to] en (tour, index)). */
export function intentActive(it: Intent, s: FightState): boolean {
  const w = it.window
  const cur = s.round * 1000 + Math.max(0, s.turnIndex)
  return cur >= w.fromRound * 1000 + w.fromIndex && cur <= w.toRound * 1000 + w.toIndex
}

/** Le combattant porte-t-il un poison retiré par un soin (déclencheur « soigné » H, Petit poison des Harpilles) ? */
export function healCleansablePoison(f: Fighter): boolean {
  let poison = false
  let onHeal = false
  for (const b of f.buffs) {
    if (b.kind !== 'trigger' || !b.triggers) continue
    if (/(^|\|)(TB|TE)(\||$)/.test(b.triggers) && b.effect.element >= 0 && b.effect.element <= 4) poison = true
    if (/(^|\|)H(\||$)/.test(b.triggers)) onHeal = true
  }
  return poison && onHeal
}

/** Satisfaction d'une intention (§8.4), dans [−1, 1]. */
export function intentSatisfaction(ctx: TacticalContext, it: Intent, s: FightState, info: RootInfo, terminal: boolean): number {
  const p = ctx.perception as PerceptionX
  const me = meIn(ctx, s)
  const target = it.target !== undefined ? s.fighters[it.target] : undefined
  switch (it.kind) {
    case 'control': {
      if (!target) return 0
      if (!target.alive) return 1
      const order = p.threat.order
      if (!order) return 0
      const am = nextTurnApMp(target, order, { ap: 0, mp: 0 })
      let sat = 0
      let n = 0
      const mpMax = it.params?.mpMax
      if (mpMax !== undefined) {
        const m0 = info.nextMp.get(target.id) ?? target.stats.mp
        sat += m0 > mpMax ? clamp01((m0 - am.mp) / (m0 - mpMax)) : am.mp <= mpMax ? 1 : 0
        n++
      }
      const apMax = it.params?.apMax
      if (apMax !== undefined) {
        const a0 = info.nextAp.get(target.id) ?? target.stats.ap
        sat += a0 > apMax ? clamp01((a0 - am.ap) / (a0 - apMax)) : am.ap <= apMax ? 1 : 0
        n++
      }
      return n ? sat / n : 0
    }
    case 'protect': {
      if (!target) return 0
      if (!target.alive) return -1
      const inc0 = info.incoming.get(target.id) ?? 0
      if (inc0 <= 0) return 0
      return clamp(1 - p.threat.incoming(target.id) / inc0, -1, 1)
    }
    case 'cleanse': {
      if (!target || !target.alive) return 0
      return healCleansablePoison(target) ? 0 : 1
    }
    case 'position': {
      const who = target ?? me
      if (!who || !who.alive || !it.cells?.length) return 0
      if (!terminal && who.id === me?.id) return 0
      let d = Infinity
      for (const c of it.cells) d = Math.min(d, distance(who.cell, c))
      return d === 0 ? 1 : Math.max(0, 1 - 0.2 * d)
    }
    case 'setup': {
      const ally = target
      if (!ally || !ally.alive) return 0
      const gain = it.params?.gain ?? Math.max(1, it.price)
      const pot0 = info.potential.get(ally.id) ?? 0
      return clamp((p.potential.potential(ally.id) - pot0) / Math.max(1, gain), -1, 1)
    }
    case 'reserve': {
      const spellId = it.params?.spellId
      if (spellId === undefined || !me) return 0
      return (me.castsThisTurn[spellId] ?? 0) > (info.casts[spellId] ?? 0) ? -1 : 0
    }
    case 'burst': {
      const id = it.target
      if (id === undefined) return 0
      const before = info.hpEff.get(id) ?? 0
      const t = s.fighters[id]
      const after = t && t.alive ? hpEff(t) : 0
      const planned = it.params?.damage ?? before
      if (planned <= 0) return 0
      return Math.min(1.5, Math.max(0, before - after) / planned)
    }
    case 'survive': {
      const who = target ?? me
      if (!who) return 0
      if (!who.alive) return -1
      return 1 - p.threat.deathRisk(who.id)
    }
  }
  return 0
}

/** Terme `scenario` d'une feuille (bandes, paliers, horloge, case, intentions, résurrections). */
export function scenarioTerm(ctx: TacticalContext, s: FightState, info: RootInfo, o: LeafOptions): number {
  const bb: Blackboard = ctx.bb
  const prices = bb.prices
  const me = meIn(ctx, s)
  let v = 0
  // Bandes et paliers de PV (PriceTable.hp).
  if (prices.hp.size) {
    for (const [id, row] of prices.hp) {
      const m = s.fighters[id]
      if (!m || !m.alive) continue
      if (row.bandBonus && row.bandMin !== undefined && row.bandMax !== undefined && m.hp >= row.bandMin && m.hp <= row.bandMax) v += row.bandBonus
      if (row.floor !== undefined && row.slope > 0) {
        const he = hpEff(m)
        if (he < row.floor) v -= row.slope * (row.floor - he)
      }
    }
  }
  // Horloge : heures avancées pendant le tour (glyphes), lues dans l'état.
  if (o.inTurn !== false && (prices.clock[1] !== 0 || prices.clock[2] !== 0)) {
    const h0 = info.hour
    const h1 = hourOf(s)
    if (h0 > 0 && h1 > 0) {
      const k = (h1 - h0 + 12) % 12
      v += prices.clock[Math.min(2, k) as 0 | 1 | 2] ?? 0
    }
  }
  // Case finale.
  if (o.terminal && prices.cell && me && me.alive && me.cell >= 0) v += prices.cell[me.cell] ?? 0
  // Intentions du combattant courant.
  if (me && bb.intents.length) {
    const root = ctx.root ?? ctx.view.fight
    for (const it of bb.intents) {
      if (it.owner !== me.id || it.price === 0 || !intentActive(it, root)) continue
      v += it.price * intentSatisfaction(ctx, it, s, info, o.terminal)
    }
  }
  // Morts puis résurrections traversées (rollouts du Vortex) : ajout hors contrat de WP3b.
  const revived = (ctx.scenario as { revivedValue?: (root: FightState, leaf: FightState, bb: Blackboard) => number } | undefined)?.revivedValue
  if (revived && o.inTurn === false) v += revived.call(ctx.scenario, ctx.root ?? ctx.view.fight, s, bb)
  return v
}

/** Valeur d'une feuille (§8.4) : V(s) (§7) + terme de scénario. */
export function evalLeaf(ctx: TacticalContext, s: FightState, o: LeafOptions): LeafEval {
  const info = rootInfo(ctx)
  const view = viewOn(ctx.view, s)
  const b = valueOf(view, s, ctx.perception, {
    root: ctx.root ?? ctx.view.fight,
    scenario: ctx.scenario,
    bb: ctx.bb,
    terminal: o.terminal,
    meId: ctx.view.me.id,
    position: o.position ?? 0,
  })
  const scn = scenarioTerm(ctx, s, info, o)
  if (scn !== 0) {
    b.scenario += scn
    b.total += scn
  }
  return { v: b.total, b }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function clamp01(x: number): number {
  return clamp(x, 0, 1)
}
