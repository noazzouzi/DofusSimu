/**
 * Du plan aux prix (docs/design/ai.md §9.6, §12.7) — WP3b : `PriceTable` du combattant courant (PVe).
 *
 *  - `heuristicPrices` (`HeuristicPricer`, mode `fast`) : formules fermées du §12.7, constantes de θ.vortex ;
 *  - `searchPrices` (`SearchPricer`, modes `standard`/`deep`) : prix CONTREFACTUELS lus sur les scores par action
 *    racine du `HourPlanner` (`priceScores`) : `kill[m][x] = best(tuer m à x) − best(sans tuer m)`,
 *    `clock[k] = best(glyphe +k) − best(0) − k·détour`, `hp[m].slope = (best(dégâts E sur m) − best(rien))/E` bornée à
 *    [0 ; 1,2] ; une racine absente du faisceau final est relancée (`replan`, faisceau 8, horizon 8, ≤ 6 relances, comparée
 *    à une relance « rien » de même réglage). Les prix de kill restent bornés à [killMin ; killMax] ; les heures non
 *    accessibles maintenant gardent le prix heuristique.
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
import { actionKey, glyphCount, killedBy, type PlanResult, type PlannerConfig, type PlannerContext } from './planner'

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
  /** Relance forcée du planificateur (SearchPricer) : action racine imposée, faisceau 8, horizon 8. */
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
 * l'heure h (sans glyphe) dans `followUpRounds` tours, avec assez de dégâts pour retuer le zombie ?
 */
export function reKillWindow(ctx: PlannerContext, cfg: PlannerConfig, m: AbsMonster, hours: number, abs = ctx.abs): boolean {
  const slots = ctx.slots
  let v = -1
  for (let i = 1; i < slots.length; i++) if (slots[i].isVortex) {
    v = i
    break
  }
  if (v < 0) return true
  const maxRound = slots[0].round + cfg.followUpRounds
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
  for (let h = 1; h <= HOUR_COUNT; h++) {
    const fresh = !maskHas(root.hoursUsed, h)
    const vx = fresh ? costs.cVx(h) : 0
    const cm = costs.cMon(m.monsterId, h)
    let v: number
    if (m.hours === 0) {
      const contract = result.plan.contracts.some(c => c.m === m.id && c.kind === 'mark' && c.hour === h)
      if (contract || reKillWindow(ctx, cfg, m, 1 << (h - 1))) v = tv.plannedFirstKill - cm - vx
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
  if (inp.replan && (!result.priceScores.has('glyph+1') || !result.priceScores.has('glyph+2'))) {
    const s0 = inp.replan({ t: 'none' })
    const scores = new Map<string, number>([['none', s0.best]])
    for (const k of [1, 2] as const) scores.set(`glyph+${k}`, inp.replan({ t: 'glyph', count: k }).best)
    clock = clockFrom(scores, theta)
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
 * Prix contrefactuels (§9.6) : heuristiques, puis remplacés pour les actions racines chiffrées par le planificateur
 * (relances forcées pour celles qui manquent).
 */
export function searchPrices(inp: PricerInput): PriceTable {
  const table = heuristicPrices({ ...inp, replan: undefined })
  const { ctx, theta, root, result } = inp
  const tv = theta.vortex
  const scores = new Map(result.priceScores)
  const forced = new Map<string, number>()
  let replans = 0
  const maxReplans = inp.maxReplans ?? 6
  let forcedBase: number | undefined
  /** Score d'une clé racine : faisceau principal, sinon relance forcée (comparée à la relance « rien »). */
  const scoreOf = (key: string, action: AbsAction): { v: number; base: 'main' | 'forced' } | undefined => {
    const v = scores.get(key)
    if (v !== undefined) return { v, base: 'main' }
    if (!inp.replan) return undefined
    const f = forced.get(key)
    if (f !== undefined) return { v: f, base: 'forced' }
    if (replans >= maxReplans) return undefined
    if (forcedBase === undefined) {
      forcedBase = inp.replan({ t: 'none' }).best
      replans++
    }
    if (replans >= maxReplans) return undefined
    const r = inp.replan(action).best
    replans++
    forced.set(key, r)
    return { v: r, base: 'forced' }
  }
  /** Meilleur score parmi les clés qui ne tuent pas `m`, avec `g` heures de glyphe. */
  const bestWithout = (m: number, g: number): number => {
    let b = -Infinity
    for (const [k, v] of scores) if (glyphOfKey(k) === g && !killsOfKey(k).includes(m)) b = Math.max(b, v)
    return b
  }
  const h0 = ctx.slots[0]?.hour ?? root.hour
  const h1 = nextHour(h0, 1)
  for (const m of root.monsters) {
    if (m.id < 0 || m.status !== 'alive') continue
    const row = table.kill.get(m.id)
    if (!row) continue
    for (const glyph of ['none', 'before'] as const) {
      const a: AbsAction = { t: 'kill', m: [m.id], glyph }
      const key = actionKey(a)
      const g = glyph === 'none' ? 0 : 1
      const sc = scoreOf(key, a)
      if (!sc) continue
      const base = sc.base === 'main' ? bestWithout(m.id, g) : g === 0 ? forcedBase : undefined
      if (base === undefined || !Number.isFinite(base)) continue
      const h = glyph === 'none' ? h0 : h1
      const star = glyph === 'none' ? m.star : maskHas(m.hours, h1)
      row[star ? 0 : h] = clamp(sc.v - base, tv.killMin, star ? Math.max(tv.killMax, tv.corruptKill) : tv.killMax)
    }
    // Pente de PV : (best(dégâts E sur m) − best(rien)) / E (mêmes pré-dégâts que le planificateur).
    const entry = table.hp.get(m.id)
    const dmg = scores.get(`damage:${m.id}`)
    const none = scores.get('none')
    if (entry && entry.bandMax === undefined && dmg !== undefined && none !== undefined) {
      const amount = Math.min(Math.floor(0.9 * ctx.expected(0, inp.me, m)), m.hp - 1)
      // Plancher à la moitié de la pente par défaut : l'écart de deux lignes du faisceau est bruité (les monstres à ne
      // pas toucher passent par le plancher de PV, pas par une pente nulle).
      if (amount > 0) entry.slope = clamp((dmg - none) / amount, 0.5 * tv.waveHpSlope, 1.2)
    }
  }
  const clock = clockFrom(scores, theta)
  if (clock) {
    // Racines de glyphe absentes : relances forcées.
    for (const k of [1, 2] as const) {
      if (scores.has(`glyph+${k}`)) continue
      const sc = scoreOf(`glyph+${k}`, { t: 'glyph', count: k })
      if (sc && forcedBase !== undefined) clock[k] = clamp(sc.v - forcedBase - k * tv.shiftDetour, -2000, 2000)
    }
    table.clock = clock
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

export { glyphCount, killedBy }
