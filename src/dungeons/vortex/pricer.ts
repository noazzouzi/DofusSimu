/**
 * Du plan aux prix (docs/design/ai.md §9.6, §12.7) — WP3b : `PriceTable` du combattant courant (PVe).
 *
 *  - `heuristicPrices` (`HeuristicPricer`, mode `fast`) : formules fermées du §12.7, constantes de θ.vortex ;
 *  - `searchPrices` (`SearchPricer`, modes `standard`/`deep`) : prix CONTREFACTUELS du `HourPlanner` :
 *    `kill[m][x] = best(tuer m à x) − best(sans tuer m)`, `clock[k] = best(glyphe +k) − best(0) − k·détour`,
 *    `hp[m].slope = (best(dégâts E sur m) − best(rien))/E` bornée à [0,5·pente par défaut ; 1,2]. Écart au §9.6 : chaque
 *    action chiffrée est rejouée par une relance FORCÉE de même réglage (faisceau θ/4, horizon 8, ≤ `maxReplans`), et non
 *    lue sur le faisceau principal où l'action dominante reçoit l'essentiel des nœuds (prix biaisés). Les prix de kill
 *    restent bornés à [killMin ; killMax] ; les heures non accessibles maintenant gardent le prix heuristique.
 *
 * Tableaux `kill` : index 0 = mort sous l'étoile (corruption), 1..12 = mort pendant l'heure h. `hp` : pente (valeur
 * d'un PV retiré), plancher (pente nulle en dessous), bande [bandMin ; bandMax] avant le créneau du tueur prévu
 * (bonus `bandBonus`). `cell` : seulement ce que la menace ne compte pas déjà — la croix de l'Auroraire passe par
 * `extraIncoming` dans `ThreatModel` (§6.5) ; on n'y ajoute que les cases d'échange forcé (484 à VII, 292 à IV).
 */
import type { PriceTable, StrategyParams } from '../../ai/types'
import { CELL_COUNT } from '../../map/geometry'
import type { AbsAction, ClockSlot, ScenarioPlan } from '../types'
import { resurrection, type AbsMonster, type AbsState } from './abstract'
import { maskHas } from './clock'
import { HOUR_CELL, HOUR_COUNT, nextHour } from './constants'
import { actionKey, followUpRoundsFor, pKillOf, type PlanResult, type PlannerConfig, type PlannerContext } from './planner'

/** Entrée commune des pricers. */
export interface PricerInput {
  result: PlanResult
  root: AbsState
  ctx: PlannerContext
  cfg: PlannerConfig
  theta: StrategyParams
  /** Combattant du créneau courant (`ctx.slots[0].fighterId`). */
  me: number
  /**
   * Plancher de PV d'un monstre qu'on ne veut pas tuer maintenant (μ du plus gros coup d'un allié + 2σ + DoT en
   * attente) ; défaut 0 (pas de plancher).
   */
  floorOf?(m: AbsMonster): number
  /** Relance forcée du planificateur (SearchPricer) : action racine imposée, faisceau réduit, horizon 8. */
  replan?(force: AbsAction): PlanResult
  /** Relances autorisées (défaut 6). */
  maxReplans?: number
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Prochain tour de jeu où le monstre `m` (abstrait) pourra être corrompu selon le plan, ou undefined. */
function plannedCorruptRound(plan: ScenarioPlan, id: number): number | undefined {
  for (const c of plan.contracts) if (c.m === id && c.kind === 'corrupt') return c.round
  return undefined
}

/** Créneaux du monstre `id` avant la prochaine résurrection (tour du Vortex) : tours évités par une mort maintenant. */
function turnsBeforeRez(slots: readonly ClockSlot[], id: number): number {
  let n = 0
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].isVortex) break
    if (slots[i].fighterId === id) n++
  }
  return n
}

/**
 * Fenêtre de re-kill : après la résurrection qui suit le créneau courant, un tueur vivant (contrat autorisé) verra-t-il
 * l'heure h (sans glyphe) dans `followUpRoundsFor` tours (au moins un cycle d'horloge), avec assez de dégâts pour
 * retuer le zombie ?
 */
export function reKillWindow(ctx: PlannerContext, cfg: PlannerConfig, m: AbsMonster, hours: number, abs = ctx.abs): boolean {
  const slots = ctx.slots
  let v = -1
  for (let i = 1; i < slots.length; i++) if (slots[i].isVortex) {
    v = i
    break
  }
  if (v < 0) return true
  const maxRound = slots[0].round + followUpRoundsFor(cfg, ctx.players)
  const zHp = resurrection({ ...m, hours }, abs).hp
  const z: AbsMonster = { ...m, hours, status: 'alive', hp: zHp }
  for (let j = v + 1; j < slots.length && slots[j].round <= maxRound; j++) {
    const sl = slots[j]
    if (!sl.isPlayer || sl.index < 0 || !ctx.canContract(sl.fighterId)) continue
    if (!maskHas(hours, sl.hour)) continue
    if (ctx.expected(j, sl.fighterId, z) >= 0.6 * zHp) return true
  }
  return false
}

/**
 * Masque des heures h (bit h − 1) qui ont une fenêtre de re-kill pour un monstre NEUF tué maintenant à h : même règle
 * que `reKillWindow(ctx, cfg, m, bit(h))` pour les 12 heures, en un seul parcours de la prévision.
 */
export function reKillMask(ctx: PlannerContext, cfg: PlannerConfig, m: AbsMonster, abs = ctx.abs): number {
  const slots = ctx.slots
  let v = -1
  for (let i = 1; i < slots.length; i++) if (slots[i].isVortex) {
    v = i
    break
  }
  if (v < 0) return (1 << HOUR_COUNT) - 1
  const maxRound = slots[0].round + followUpRoundsFor(cfg, ctx.players)
  // Zombie marqué à une seule heure h : PV identiques pour toutes les heures sauf XI (+30 % de PV de base).
  const zOf = (h: number): AbsMonster => {
    const hours = 1 << (h - 1)
    return { ...m, hours, status: 'alive', hp: resurrection({ ...m, hours }, abs).hp }
  }
  const zBase = zOf(1)
  const zXI = zOf(11)
  let mask = 0
  for (let j = v + 1; j < slots.length && slots[j].round <= maxRound; j++) {
    const sl = slots[j]
    if (!sl.isPlayer || sl.index < 0 || sl.hour < 1 || sl.hour > HOUR_COUNT) continue
    const bit = 1 << (sl.hour - 1)
    if (mask & bit || !ctx.canContract(sl.fighterId)) continue
    const z = sl.hour === 11 ? zXI : { ...zBase, hours: bit }
    if (ctx.expected(j, sl.fighterId, z) >= 0.6 * z.hp) mask |= bit
  }
  return mask
}

/** Ligne de prix de kill heuristique d'un monstre (§12.7), index 0..12. */
export function heuristicKillRow(inp: PricerInput, m: AbsMonster): Float32Array {
  const { ctx, cfg, theta, result, root } = inp
  const tv = theta.vortex
  const costs = ctx.costs
  const N = Math.max(1, ctx.players)
  const row = new Float32Array(HOUR_COUNT + 1)
  const now = ctx.slots[0]
  // Corruption : bonus du planificateur + menace évitée jusqu'à la corruption prévue (un cycle à défaut).
  const planned = plannedCorruptRound(result.plan, m.id)
  const turnsAvoided = planned !== undefined ? Math.max(0, planned - (now?.round ?? root.round)) : HOUR_COUNT / N
  row[0] = clamp(Math.max(tv.corruptKill, cfg.corruptBonus + m.threat * turnsAvoided), tv.killMin, Math.max(tv.killMax, tv.corruptKill))
  const exposure = m.threat * turnsBeforeRez(ctx.slots, m.id)
  const windows = m.hours === 0 ? reKillMask(ctx, cfg, m) : 0
  for (let h = 1; h <= HOUR_COUNT; h++) {
    const fresh = !maskHas(root.hoursUsed, h)
    const vx = fresh ? costs.cVx(h) : 0
    const cm = costs.cMon(m.monsterId, h)
    let v: number
    if (m.hours === 0) {
      const contract = result.plan.contracts.some(c => c.m === m.id && c.kind === 'mark' && c.hour === h)
      if (contract || maskHas(windows, h)) v = tv.plannedFirstKill - cm - vx
      else v = -(tv.unplannedKillBase + cm + vx)
    } else if (maskHas(m.hours, h)) v = 0.3 * exposure
    else v = 0.3 * exposure - cm - vx
    row[h] = clamp(v, tv.killMin, tv.killMax)
  }
  return row
}

/** Cases d'échange forcé (484 à VII, 292 à IV) si l'horloge y arrive avant le prochain tour de `me`. */
export function swapCellPrices(slots: readonly ClockSlot[], me: number, theta: StrategyParams): Float32Array | undefined {
  let out: Float32Array | undefined
  for (let i = 1; i < slots.length; i++) {
    const sl = slots[i]
    if (sl.fighterId === me && sl.index >= 0) break
    const prev = slots[i - 1].hour
    if (sl.hour === prev) continue
    // Toutes les heures traversées entre deux créneaux (glyphes comprises dans la prévision).
    for (let h = nextHour(prev, 1), k = 0; k < HOUR_COUNT; h = nextHour(h, 1), k++) {
      if (h === 7 || h === 4) {
        out ??= new Float32Array(CELL_COUNT)
        out[HOUR_CELL[h]] = -theta.vortex.swapCell
      }
      if (h === sl.hour) break
    }
  }
  return out
}

/** Valeur de l'horloge (`clock[k]`) depuis des scores par action racine. */
function clockFrom(scores: Map<string, number>, theta: StrategyParams): [number, number, number] | undefined {
  const best = [-Infinity, -Infinity, -Infinity]
  for (const [key, v] of scores) {
    const g = glyphOfKey(key)
    if (g <= 2 && v > best[g]) best[g] = v
  }
  if (!Number.isFinite(best[0])) return undefined
  const out: [number, number, number] = [0, 0, 0]
  for (let k = 1; k <= 2; k++) out[k] = Number.isFinite(best[k]) ? clamp(best[k] - best[0] - k * theta.vortex.shiftDetour, -2000, 2000) : -k * theta.vortex.shiftDetour
  return out
}

/** Heures avancées par l'action racine d'une clé (`actionKey`). */
export function glyphOfKey(key: string): number {
  if (key.startsWith('glyph+')) return Number(key.slice(6))
  return key.endsWith('@before') || key.endsWith('@after') ? 1 : 0
}

/** Monstres tués par l'action racine d'une clé. */
function killsOfKey(key: string): number[] {
  const mt = /^kill:([-\d,]+)/.exec(key)
  return mt ? mt[1].split(',').map(Number) : []
}

/**
 * Prix heuristiques (§12.7). `clock` : relances du planificateur avec glyphe imposée si `replan` est fourni, sinon les
 * scores racines du plan (−détour par heure si une racine manque).
 */
export function heuristicPrices(inp: PricerInput): PriceTable {
  const { ctx, theta, root, result } = inp
  const tv = theta.vortex
  const kill = new Map<number, Float32Array>()
  const hp = new Map<number, { slope: number; floor?: number; bandMin?: number; bandMax?: number; bandBonus?: number }>()
  const now = ctx.slots[0]
  for (const m of root.monsters) {
    if (m.id < 0 || (m.status !== 'alive' && m.status !== 'invulnerable')) continue
    const row = heuristicKillRow(inp, m)
    kill.set(m.id, row)
    hp.set(m.id, hpEntry(inp, m, row, now?.hour ?? root.hour))
  }
  let clock = clockFrom(result.priceScores, theta)
  if (inp.replan) {
    // Relances de même réglage (comparaison à effort égal) ; scores « pour les prix » (`priceScores` : sans le coût de
    // glyphe du planificateur, remplacé par le détour), comme le SearchPricer. +2 heures seulement si deux glyphes sont
    // atteignables maintenant (sinon −2·détour : impossible ce tour-ci).
    const scores = new Map<string, number>()
    const run = (a: AbsAction): void => {
      const v = inp.replan!(a).priceScores.get(actionKey(a))
      if (v !== undefined) scores.set(actionKey(a), v)
    }
    run({ t: 'none' })
    run({ t: 'glyph', count: 1 })
    if (ctx.glyphsNow >= 2) run({ t: 'glyph', count: 2 })
    clock = clockFrom(scores, theta) ?? clock
  }
  const out: PriceTable = { kill, hp, clock: clock ?? [0, -tv.shiftDetour, -2 * tv.shiftDetour] }
  const cell = swapCellPrices(ctx.slots, inp.me, theta)
  if (cell) out.cell = cell
  return out
}

/** Pente, plancher et bande de PV d'un monstre (§12.7). */
function hpEntry(inp: PricerInput, m: AbsMonster, row: Float32Array, hourNow: number): { slope: number; floor?: number; bandMin?: number; bandMax?: number; bandBonus?: number } {
  const { theta, result, me } = inp
  const tv = theta.vortex
  const now = inp.ctx.slots[0]
  const after = (c: { round: number; index: number }) => !now || c.round > now.round || (c.round === now.round && c.index > now.index)
  const contract = result.plan.contracts.find(c => c.m === m.id && after(c) && c.killer !== me)
  const killNow = m.star ? row[0] : row[hourNow]
  if (contract) {
    const band = result.plan.bands.find(b => b.m === m.id && b.beforeKiller === contract.killer)
    const price = Math.max(0, contract.kind === 'corrupt' ? row[0] : row[contract.hour])
    const bandMax = band ? band.hpMax : undefined
    // Avant le créneau du tueur : 0,7 jusqu'au palier (pente nulle en dessous), bonus si les PV sont dans la bande.
    return { slope: tv.contractHpSlope, floor: bandMax, bandMin: 1, bandMax, bandBonus: bandMax !== undefined ? 0.5 * price : undefined }
  }
  if (killNow < 0 && inp.floorOf) {
    const floor = inp.floorOf(m)
    if (floor > 0) return { slope: tv.waveHpSlope, floor }
  }
  return { slope: tv.waveHpSlope }
}

/**
 * Prix contrefactuels (§9.6). Pour que deux actions racines soient comparées à effort égal, chaque action chiffrée est
 * rejouée par une relance FORCÉE de même réglage (`replan` : faisceau réduit, horizon 8) plutôt que lue sur le faisceau
 * principal (où l'action dominante reçoit l'essentiel des nœuds et serait sur-évaluée) : « rien », puis la mort de
 * chaque monstre atteignable maintenant avec P(kill) ≥ `minKillP` (décroissante), puis glyphe +1 / mort avec glyphe
 * avant / glyphe +2 si une glyphe est atteignable, puis les morts improbables, puis des pré-dégâts (pente de PV), dans
 * la limite de `maxReplans`. Une racine imposée est supposée réalisée (jamais hypothétique). Prix = score de l'action −
 * meilleur score des actions relancées qui ne tuent pas ce monstre (même nombre d'heures de glyphe) ; horloge =
 * score(glyphe +k) − score(rien) − k·détour. Les entrées non relancées (ou impossibles dans le modèle abstrait)
 * gardent le prix heuristique ; sans `replan`, lecture du faisceau principal.
 */
export function searchPrices(inp: PricerInput): PriceTable {
  const table = heuristicPrices({ ...inp, replan: undefined })
  const { ctx, theta, root } = inp
  const tv = theta.vortex
  const h0 = ctx.slots[0]?.hour ?? root.hour
  const h1 = nextHour(h0, 1)
  const canAct = ctx.slots[0]?.isPlayer === true && (ctx.slots[0]?.index ?? -1) >= 0
  const scores = new Map<string, number>()
  /**
   * Actions chiffrées mais improbables maintenant (mort à P(kill) < `minKillP`) : une racine imposée est SUPPOSÉE
   * réalisée ; son score ne sert pas de référence « sans tuer m » au prix d'une mort PROBABLE — sinon une corruption
   * sûre était comparée au meurtre imaginaire d'un monstre neuf à 6 600 PV et tombait à `killMin` (réglage, tour 2 :
   * puzzle P17 en `standard`). Une mort improbable reste comparée à toutes les actions (hypothèse contre hypothèse,
   * puzzle P4).
   */
  const unlikelyKeys = new Set<string>()
  if (inp.replan && canAct) {
    const budget = Math.max(1, inp.maxReplans ?? 6)
    const run = (a: AbsAction, unlikely = false): void => {
      const key = actionKey(a)
      if (scores.has(key) || scores.size >= budget) return
      const r = inp.replan!(a)
      // Action impossible dans le modèle abstrait (faisceau vide) : pas de score, le prix heuristique reste.
      const v = r.priceScores.get(key)
      if (v !== undefined) {
        scores.set(key, v)
        if (unlikely) unlikelyKeys.add(key)
      }
    }
    run({ t: 'none' })
    const reachable = root.monsters
      .filter(m => m.id >= 0 && m.status === 'alive' && ctx.expected(0, inp.me, m) > 0)
      .map(m => ({ m, p: ctx.pKillNow?.(m) ?? pKillOf(ctx.expected(0, inp.me, m), m.hp), e: ctx.expected(0, inp.me, m) }))
      .sort((a, b) => b.p - a.p || b.e / b.m.hp - a.e / a.m.hp || a.m.id - b.m.id)
    // Ordre du budget : morts plausibles (P(kill) ≥ minKillP), levier d'horloge (glyphe +1, mort après glyphe, +2),
    // puis morts improbables : avec 7 monstres à portée, le budget ne doit pas s'épuiser sur des morts à 5 % avant
    // d'avoir chiffré la glyphe.
    const likely = reachable.filter(x => x.p >= inp.cfg.minKillP)
    for (const { m } of likely) run({ t: 'kill', m: [m.id], glyph: 'none' })
    if (ctx.glyphsNow >= 1) {
      run({ t: 'glyph', count: 1 })
      for (const { m } of likely) run({ t: 'kill', m: [m.id], glyph: 'before' })
      if (ctx.glyphsNow >= 2) run({ t: 'glyph', count: 2 })
    }
    for (const { m, p } of reachable) run({ t: 'kill', m: [m.id], glyph: 'none' }, p < inp.cfg.minKillP)
    if (ctx.glyphsNow >= 1) for (const { m, p } of reachable) run({ t: 'kill', m: [m.id], glyph: 'before' }, p < inp.cfg.minKillP)
    // Budget restant : pente de PV des monstres atteignables sans contrat (mêmes pré-dégâts que le planificateur).
    for (const { m, e } of reachable) {
      if (table.hp.get(m.id)?.bandMax !== undefined) continue
      const amount = Math.min(Math.floor(0.9 * e), m.hp - 1)
      if (amount > 0) run({ t: 'damage', m: m.id, amount, glyph: 'none' })
    }
  } else for (const [k, v] of inp.result.priceScores) scores.set(k, v)
  /**
   * Meilleur score parmi les actions chiffrées qui ne tuent pas `m`, avec `g` heures de glyphe ; `real` : seulement les
   * actions non improbables (référence du prix d'une mort probable).
   */
  const bestWithout = (m: number, g: number, real: boolean): number => {
    let b = -Infinity
    for (const [k, v] of scores) if (glyphOfKey(k) === g && !killsOfKey(k).includes(m) && !(real && unlikelyKeys.has(k))) b = Math.max(b, v)
    return b
  }
  for (const m of root.monsters) {
    if (m.id < 0 || m.status !== 'alive') continue
    const row = table.kill.get(m.id)
    if (!row) continue
    for (const glyph of ['none', 'before'] as const) {
      const key = actionKey({ t: 'kill', m: [m.id], glyph })
      const v = scores.get(key)
      if (v === undefined) continue
      const base = bestWithout(m.id, glyph === 'none' ? 0 : 1, !unlikelyKeys.has(key))
      if (!Number.isFinite(base)) continue
      const star = glyph === 'none' ? m.star : maskHas(m.hours, h1)
      row[star ? 0 : glyph === 'none' ? h0 : h1] = clamp(v - base, tv.killMin, star ? Math.max(tv.killMax, tv.corruptKill) : tv.killMax)
    }
  }
  const none = scores.get('none')
  // Pente de PV : (best(dégâts E sur m) − best(rien)) / E, bornée à [0,5·pente par défaut ; 1,2] (l'écart de deux
  // relances reste bruité ; les monstres à ne pas toucher passent par le plancher de PV, pas par une pente nulle).
  if (none !== undefined) {
    for (const m of root.monsters) {
      const entry = table.hp.get(m.id)
      const dmg = scores.get(`damage:${m.id}`)
      if (!entry || entry.bandMax !== undefined || dmg === undefined) continue
      const amount = Math.min(Math.floor(0.9 * ctx.expected(0, inp.me, m)), m.hp - 1)
      if (amount > 0) entry.slope = clamp((dmg - none) / amount, 0.5 * tv.waveHpSlope, 1.2)
    }
  }
  if (none !== undefined) {
    for (const k of [1, 2] as const) {
      const g = scores.get(`glyph+${k}`)
      if (g !== undefined) table.clock[k] = clamp(g - none - k * tv.shiftDetour, -2000, 2000)
    }
  }
  return table
}

/**
 * Dégâts prévus de l'action racine d'un plan (calibration de l'oracle, §12.6) : pré-dégâts, ou PV des monstres tués
 * (bornés par l'espérance) ; 0 pour « rien » et les glyphes.
 */
export function rootPredictedDamage(result: PlanResult, root: AbsState, slot0: ClockSlot | undefined): number {
  const st = result.plan.steps[0] as (typeof result.plan.steps)[number] & { expected?: number }
  if (!st || !slot0 || st.round !== slot0.round || st.index !== slot0.index) return 0
  if (st.action.t === 'damage') return st.action.amount
  if (st.action.t === 'kill') {
    let hp = 0
    for (const id of st.action.m) hp += root.monsters.find(m => m.id === id)?.hp ?? 0
    return Math.min(hp, st.expected ?? hp)
  }
  return 0
}

