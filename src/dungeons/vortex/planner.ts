/**
 * `HourPlanner` de l'Œil de Vortex (docs/design/ai.md §12.5, §12.6, §12.8) — WP3b.
 *
 * Faisceau sur les CRÉNEAUX JOUEURS de la prévision d'horloge (`forecastHours`) : à chaque créneau d'un personnage
 * vivant, une action abstraite (rien, glyphe +k, mort d'un ou deux monstres avec glyphe avant/après, pré-dégâts) ;
 * entre deux, les créneaux des monstres (exposition), du Vortex (résurrections, corruption) et les fins de tour de jeu
 * (vagues) sont appliqués par le modèle abstrait (abstract.ts). Le plan répond à « qui tue quoi à quelle heure » :
 * marquages aux heures bon marché, corruptions sous l'étoile, glyphes qui recalent l'horloge, paliers de PV pour un
 * tueur suivant, et il chiffre chaque action du créneau courant (`rootScores`) pour les pricers (pricer.ts).
 *
 * Récompenses (PVe, §12.5) :
 *  - mort sous l'étoile : `+corruptBonus` ; mort à une heure h : `−C_mon(m, h) − [h ∉ hoursUsed]·C_vx(h)` (hourCost.ts),
 *    `−unreachableHourCost` si aucun tueur vivant ne reverra une heure du monstre dans les 3 tours (sans glyphe) ;
 *  - `−(1 − pKill)·failCost` par action de kill ; `pKill = Φ((E − PV)/(0,15·E))` (oracle §12.6, `KillOracle`) ;
 *  - glyphe : `−glyphCost + bonus du poseur` au créneau courant ; créneau futur : disponibilité `glyphAvailability`
 *    (coût `(1 − dispo)·failCost`) ;
 *  - créneau monstre : `−wExposure·menace` de chaque monstre vivant qui joue (invulnérable compris) ; monstres des vagues
 *    futures (sans créneau dans la prévision) : une fois par tour de jeu, au créneau du Vortex ;
 *  - submersion : `−overloadCost·(vivants − maxAliveFactor·N)` par créneau joueur en surnombre ;
 *  - coût restant (borne optimiste, `futureCost`) : exposition jusqu'à la première fenêtre d'étoile accessible à un
 *    tueur (après résurrection), meilleur compromis attente + cycle + coût d'heure pour un monstre encore à marquer ;
 *    aucun bonus de corruption futur (corrompre dans l'horizon reste préféré). Il sert de coût terminal ET de rang du
 *    faisceau (score − coût restant, à la A*, plus les PV restant à retirer × θ.vortex.waveHpSlope) : une mort payée
 *    maintenant est comparée à l'exposition qu'elle évite, et les pré-dégâts qui préparent un kill survivent.
 *
 * Élagage (§12.5) : ≤ `maxKillsPerSlot` morts par créneau, jamais un monstre mort/corrompu/invulnérable ; hors créneau
 * courant, pas de mort à une heure NOUVELLE de `C_vx > badHourVx` si une heure moins chère existe dans l'horizon, pas de
 * contrat pour un joueur exclu (`canContract`, §9.2), pré-dégâts sur 3 cibles ; ≤ `maxActions` actions par créneau.
 * Au créneau courant, TOUTES les morts possibles sont générées (prix contrefactuels) ; les actions avec glyphe
 * indisponible et les morts improbables (P(kill) < `minKillP`) sont « hypothétiques » : chiffrées dans `rootScores`,
 * jamais retenues dans le plan.
 * Déduplication : `absHash` (statuts, heures, étoiles, PV par paliers de 500, décalage d'horloge) × action racine.
 * Déterminisme : aucun aléa ; départages par score, clé d'action, empreinte.
 */
import type { AIMode, StrategyParams } from '../../ai/types'
import { mix32 } from '../../core/hash'
import type { AbsAction, ClockSlot, PlanStep, ScenarioPlan } from '../types'
import {
  applyAbs as applyAbsImpl,
  beginSlot as beginSlotImpl,
  DEFAULT_ABS_PARAMS,
  normalCdf,
  resurrection,
  type AbsMonster,
  type AbsParams,
  type AbsState,
} from './abstract'
import { HOUR_COUNT as HOURS } from './constants'
import type { HourCostModel } from './hourCost'

// Alias locaux des fonctions des modules voisins (chemins chauds : une seule résolution d'import).
const applyAbs = applyAbsImpl
const mix = mix32
const beginSlot = beginSlotImpl
const HOUR_COUNT: number = HOURS
const nextHour = (h: number, k = 1): number => ((((h - 1 + k) % 12) + 12) % 12) + 1
const hourBit = (h: number): number => (h >= 1 && h <= 12 ? 1 << (h - 1) : 0)
const maskHas = (mask: number, h: number): boolean => (mask & hourBit(h)) !== 0

/** Φ tabulée (pas de 0,005 sur [−6 ; 6], interpolation linéaire) à partir de `normalCdf` : déterministe et rapide. */
const PHI_STEP = 0.005
const PHI_TABLE = (() => {
  const n = Math.round(12 / PHI_STEP)
  const t = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) t[i] = normalCdf(-6 + i * PHI_STEP)
  return t
})()
function phiFast(z: number): number {
  if (z <= -6) return 0
  if (z >= 6) return 1
  const x = (z + 6) / PHI_STEP
  const i = Math.floor(x)
  const f = x - i
  return PHI_TABLE[i] + f * ((PHI_TABLE[i + 1] ?? 1) - PHI_TABLE[i])
}
/** Oracle de kill (§12.6) : `Φ((E − PV)/(0,15·E))` (même formule que `abstract.killProbability`, Φ tabulée). */
export function pKillOf(expected: number, hp: number): number {
  if (hp <= 0) return 1
  if (expected <= 0) return 0
  return phiFast((expected - hp) / (0.15 * expected))
}
const killProbability = pKillOf

// ───────────────────────────── configuration ─────────────────────────────

export interface PlannerConfig {
  beamWidth: number
  horizonPlayerSlots: number
  rootDiversity: number
  maxKillsPerSlot: 1 | 2
  wExposure: number
  corruptBonus: number
  failCost: number
  glyphCost: number
  unreachableHourCost: number
  maxAliveFactor: number
  overloadCost: number
  hourCostScale: number
  /** Disponibilité d'une glyphe à un créneau futur (§12.3). */
  glyphAvailability: number
  /** P(kill) minimale d'une mort générée hors créneau courant. */
  minKillP: number
  /** Actions conservées par créneau (hors créneau courant). */
  maxActions: number
  /** Seuil de `C_vx` d'une heure « chère » (élagage). */
  badHourVx: number
  /** Tours (sans glyphe) dans lesquels un tueur doit revoir une heure de mort (§12.5 `unreachableHourCost`). */
  followUpRounds: number
  /**
   * Valeur d'un PV restant à retirer (θ.vortex.waveHpSlope) dans le RANG du faisceau seulement (guide les lignes de
   * pré-dégâts) ; le score final n'en tient pas compte (la recherche tactique paie déjà les PV par `hp.slope`).
   */
  hpSlope: number
}

/**
 * Forme du faisceau par mode (§2, §12.5) : largeur, horizon (créneaux joueurs), diversité de racine, morts par créneau.
 * Les valeurs de θ.planner sont celles du mode `standard` ; les autres modes en sont dérivés par ces rapports.
 */
export const PLANNER_SHAPE: Readonly<Record<AIMode, { beam: number; horizon: number; diversity: number; kills: 1 | 2 }>> = {
  scripted: { beam: 4, horizon: 8, diversity: 1, kills: 1 },
  fast: { beam: 4, horizon: 8, diversity: 1, kills: 1 },
  standard: { beam: 16, horizon: 12, diversity: 2, kills: 2 },
  deep: { beam: 48, horizon: 20, diversity: 3, kills: 2 },
}

/** Configuration du planificateur pour un mode (θ.planner = mode standard ; autres modes au prorata). */
export function plannerConfig(mode: AIMode, theta: StrategyParams): PlannerConfig {
  const tp = theta.planner
  const std = PLANNER_SHAPE.standard
  const shape = PLANNER_SHAPE[mode]
  const ratio = (v: number, base: number, x: number) => Math.max(1, Math.round((v * x) / base))
  return {
    beamWidth: ratio(tp.beamWidth, std.beam, shape.beam),
    horizonPlayerSlots: ratio(tp.horizonPlayerSlots, std.horizon, shape.horizon),
    rootDiversity: ratio(tp.rootDiversity, std.diversity, shape.diversity),
    maxKillsPerSlot: Math.min(shape.kills, tp.maxKillsPerSlot >= 2 ? 2 : 1) as 1 | 2,
    wExposure: tp.wExposure,
    corruptBonus: tp.corruptBonus,
    failCost: tp.failCost,
    glyphCost: tp.glyphCost,
    unreachableHourCost: tp.unreachableHourCost,
    maxAliveFactor: tp.maxAliveFactor,
    overloadCost: tp.overloadCost,
    hourCostScale: tp.hourCostScale,
    glyphAvailability: tp.glyphAvailability,
    minKillP: 0.3,
    maxActions: 14,
    badHourVx: 1000,
    followUpRounds: 3,
    hpSlope: theta.vortex.waveHpSlope,
  }
}

// ───────────────────────────── contexte ─────────────────────────────

/** Ce que le planificateur sait du combat (fourni par model.ts ; synthétique dans les puzzles). */
export interface PlannerContext {
  /** Prévision d'horloge : créneau 0 = créneau courant (`forecastHours`). */
  slots: readonly ClockSlot[]
  costs: HourCostModel
  abs?: AbsParams
  /** Personnages vivants (N : cycle de l'horloge, submersion). */
  players: number
  /** E_p(m) : dégâts attendus du joueur `playerId` sur `m` pendant le créneau `slotIdx` (0 s'il ne peut l'atteindre). */
  expected(slotIdx: number, playerId: number, m: AbsMonster): number
  /** P(kill) du créneau courant pour `m` dans l'état observé (`canKillNow`) ; undefined ⇒ oracle analytique. */
  pKillNow?(m: AbsMonster): number | undefined
  /** Le joueur peut-il tenir un contrat de kill (§9.2 : pas un mpLock/apLock à faible DPT) ? */
  canContract(playerId: number): boolean
  /** Glyphes de monstre atteignables par le joueur courant (0, 1, 2) et bonus de poseur de la meilleure. */
  glyphsNow: number
  glyphBonusNow: number
}

/** Pas d'un plan enrichi (le type gelé `PlanStep` + l'issue de chaque mort). */
export interface PlannerStep extends PlanStep {
  /** Une entrée par monstre tué : corruption (sous l'étoile) ou marquage. */
  kinds?: ('mark' | 'corrupt')[]
  pKill?: number
  /** Dégâts attendus du joueur sur la (première) cible pendant ce créneau. */
  expected?: number
}

export interface PlanOptions {
  /** Action imposée au créneau courant (relances forcées du `SearchPricer`). */
  forceRoot?: AbsAction
  /** Remplacements ponctuels de la configuration (relances : faisceau 8, horizon 8). */
  beamWidth?: number
  horizonPlayerSlots?: number
  version?: number
}

export interface PlanResult {
  plan: ScenarioPlan
  /** Score du meilleur plan (après coût terminal). */
  best: number
  /**
   * Score par action racine pour les PRIX : meilleur score final des descendants, sans les coûts propres au créneau
   * courant que la recherche tactique paie elle-même (échec du kill — la simulation tue ou non —, coût de glyphe —
   * remplacé par le détour `θ.vortex.shiftDetour`).
   */
  priceScores: Map<string, number>
  /** Clés racines dont le nœud est hypothétique (glyphe indisponible). */
  hypothetical: Set<string>
  /** Expansions (nœuds enfants créés). */
  expansions: number
  /** Score final par action racine (identique à `plan.rootScores`). */
  rootScores: Map<string, number>
}

// ───────────────────────────── outils ─────────────────────────────

/** Clé lisible d'une action racine (`rootScores`). */
export function actionKey(a: AbsAction): string {
  switch (a.t) {
    case 'none':
      return 'none'
    case 'glyph':
      return `glyph+${a.count}`
    case 'kill':
      return `kill:${a.m.join(',')}${a.glyph === 'none' ? '' : `@${a.glyph}`}`
    case 'damage':
      return `damage:${a.m}${a.glyph === 'none' ? '' : `@${a.glyph}`}`
  }
}

/** Heures avancées par une action (glyphes). */
export function glyphCount(a: AbsAction): number {
  if (a.t === 'glyph') return a.count
  if ((a.t === 'kill' || a.t === 'damage') && a.glyph !== 'none') return 1
  return 0
}

/** Monstres tués par une action. */
export function killedBy(a: AbsAction): readonly number[] {
  return a.t === 'kill' ? a.m : []
}

/** Coût symbolique d'un pré-dégât (départage : « rien » à valeur égale). */
const DAMAGE_EPSILON = 1

const isActionSlot = (sl: ClockSlot): boolean => sl.isPlayer && sl.index >= 0
const isActive = (m: AbsMonster): boolean => m.status === 'alive' || m.status === 'invulnerable'

function strHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

interface PNode {
  s: AbsState
  /** Clé de l'action racine ('' avant le créneau courant). */
  key: string
  hypo: boolean
  /** Coûts du créneau courant à rendre pour les prix. */
  adj: number
  /** Empreinte de déduplication (état abstrait × action racine) et empreinte structurelle, calculées à la demande. */
  h?: number
  sh?: number
  /** Coût restant (borne de fin) de l'état au créneau en cours, calculé à la demande. */
  hv?: number
  /** Rang (score − coût restant) au moment de la sélection. */
  f?: number
}

/** Candidat d'un créneau joueur : l'état enfant n'est construit (`applyAbs`) que s'il est retenu. */
interface Cand {
  n: PNode
  a: AbsAction
  key: string
  score: number
  adj: number
  hypo: boolean
  hour: number
  kinds?: ('mark' | 'corrupt')[]
  pKill?: number
  expected?: number
  node?: PNode | null
  /** Rang de génération (départage déterministe hors créneau courant). */
  tie?: number
  /** Rang dans le faisceau : score − coût restant de l'enfant. */
  f?: number
}

// ───────────────────────────── planificateur ─────────────────────────────

/** Faisceau du §12.5 depuis la racine `root` (créneau 0 de `ctx.slots`). */
export function planHours(root: AbsState, ctx: PlannerContext, cfg: PlannerConfig, opts: PlanOptions = {}): PlanResult {
  const slots = ctx.slots
  const abs = ctx.abs ?? DEFAULT_ABS_PARAMS
  const width = Math.max(1, opts.beamWidth ?? cfg.beamWidth)
  const horizon = Math.max(1, opts.horizonPlayerSlots ?? cfg.horizonPlayerSlots)
  const N = Math.max(1, ctx.players)
  const costs = ctx.costs
  let expansions = 0

  // Créneaux traités : jusqu'au dernier créneau joueur de l'horizon, plus les créneaux non joueurs qui le suivent.
  let last = slots.length - 1
  {
    let seen = 0
    for (let i = 0; i < slots.length; i++) {
      if (isActionSlot(slots[i])) {
        if (seen === horizon) {
          last = i - 1
          break
        }
        seen++
      }
    }
  }
  // Prochain créneau du Vortex après i (résurrection d'un monstre tué en i).
  const nextVortex = new Int32Array(slots.length + 1).fill(-1)
  for (let i = slots.length - 1; i >= 0; i--) nextVortex[i] = i + 1 < slots.length ? (slots[i + 1].isVortex ? i + 1 : nextVortex[i + 1]) : -1
  // Une heure « bon marché » (C_vx ≤ seuil) est-elle accessible dans l'horizon (élagage des heures chères) ?
  let cheapHourMask = 0
  for (let i = 0; i <= last; i++) if (isActionSlot(slots[i]) && costs.cVx(slots[i].hour) <= cfg.badHourVx) cheapHourMask |= hourBit(slots[i].hour)

  const zombieHp = (m: AbsMonster): number => resurrection(m, abs).hp

  /** Un tueur vivant reverra-t-il une heure de `hours` (après la résurrection qui suit le créneau i) ? */
  const followCache = new Map<number, boolean>()
  const hasFollowUp = (i: number, s: AbsState, m: AbsMonster, hours: number): boolean => {
    const v = nextVortex[i]
    if (v < 0) return true // pas de résurrection prévue dans la prévision : rien à reprocher
    const ck = ((v * 12 + (s.glyphShift % 12)) * 4096 + hours) * 1024 + ((m.id + 512) & 1023)
    const hit = followCache.get(ck)
    if (hit !== undefined) return hit
    const maxRound = slots[i].round + cfg.followUpRounds
    const z: AbsMonster = { ...m, hours, status: 'alive', hp: zombieHp({ ...m, hours }) }
    let r = false
    for (let j = v + 1; j < slots.length && slots[j].round <= maxRound && !r; j++) {
      const sl = slots[j]
      if (!isActionSlot(sl) || !ctx.canContract(sl.fighterId)) continue
      if (!maskHas(hours, nextHour(sl.hour, s.glyphShift))) continue
      if (ctx.expected(j, sl.fighterId, z) >= 0.6 * z.hp) r = true
    }
    followCache.set(ck, r)
    return r
  }

  /** Récompense d'une mort de `m` à l'heure h, heures déjà posées `used` ; `star` = sous l'étoile. */
  const killReward = (i: number, s: AbsState, m: AbsMonster, h: number, star: boolean, used: number): number => {
    if (star) return cfg.corruptBonus
    let r = -costs.markCost(m.monsterId, h, used)
    if (!hasFollowUp(i, s, m, m.hours | hourBit(h))) r -= cfg.unreachableHourCost
    return r
  }

  const anyGlyphPoser = (s: AbsState): boolean => {
    for (const m of s.monsters) if (m.status === 'alive') return true
    return false
  }
  const futureGlyphCost = cfg.glyphCost + (1 - cfg.glyphAvailability) * cfg.failCost

  /** Candidats d'un créneau joueur pour le nœud n (ajoutés à `out`). */
  const expand = (n: PNode, i: number, isRoot: boolean, out: Cand[]): void => {
    const slot = slots[i]
    const s = n.s
    const p = slot.fighterId
    const base = s.score
    const start = out.length
    const push = (c: Omit<Cand, 'n' | 'key'> & { key?: string }): void => {
      const x = c as Cand
      x.n = n
      // Clé lisible seulement au créneau courant (prix) ; ailleurs, départage par la clé racine et l'ordre de génération.
      x.key = c.key ?? (isRoot ? actionKey(c.a) : '')
      x.tie = out.length - start
      out.push(x)
    }
    push({ a: NONE, key: 'none', score: base, adj: 0, hypo: false, hour: s.hour })
    const contract = isRoot || ctx.canContract(p)
    const posers = anyGlyphPoser(s)
    const glyphCostAt = isRoot ? cfg.glyphCost - ctx.glyphBonusNow : futureGlyphCost
    // Glyphes seules.
    const glyphMax = isRoot ? 2 : posers ? 1 : 0
    for (let k = 1; k <= glyphMax; k++) {
      const cost = k * glyphCostAt
      push({ a: k === 1 ? GLYPH1 : GLYPH2, key: k === 1 ? 'glyph+1' : 'glyph+2', score: base - cost, adj: isRoot ? cost : 0, hypo: isRoot && k > ctx.glyphsNow, hour: nextHour(s.hour, k) })
    }
    // Morts simples (et variantes avec glyphe).
    let singles: { m: AbsMonster; r: number; e: number }[] | null = null
    const h0 = s.hour
    const h1 = nextHour(h0, 1)
    for (let mi = 0; mi < s.monsters.length; mi++) {
      const m = s.monsters[mi]
      if (m.status !== 'alive') continue
      if (!contract) continue
      const e = ctx.expected(i, p, m)
      for (let g = 0; g < 3; g++) {
        // g : 0 = sans glyphe, 1 = glyphe avant, 2 = glyphe après.
        if (g > 0) {
          if (!isRoot && (g === 2 || !posers)) continue
          if (!isRoot && g === 1) {
            // Glyphe avant : seulement si elle rend l'étoile ou une heure nettement moins chère.
            const starAfter = !m.star && maskHas(m.hours, h1)
            if (!starAfter && (m.star || costs.markCost(m.monsterId, h1, s.hoursUsed) + 300 >= costs.markCost(m.monsterId, h0, s.hoursUsed))) continue
          }
        }
        const h = g === 1 ? h1 : h0
        // Étoile au moment de la mort : posée à l'ARRIVÉE de l'heure (glyphe avant) sur un monstre vivant qui la porte.
        const star = g === 1 ? maskHas(m.hours, h1) : m.star
        if (!isRoot && !star && !maskHas(s.hoursUsed, h) && costs.cVx(h) > cfg.badHourVx && (cheapHourMask & ~hourBit(h)) !== 0) continue
        const pk = isRoot && g !== 1 ? (ctx.pKillNow?.(m) ?? killProbability(e, m.hp)) : killProbability(e, m.hp)
        if (!isRoot && pk < cfg.minKillP) continue
        // Au créneau courant, une mort improbable est chiffrée (prix contrefactuel) mais jamais retenue dans le plan.
        const unlikely = isRoot && pk < cfg.minKillP
        const r = killReward(i, s, m, h, star, s.hoursUsed)
        const fail = (1 - pk) * cfg.failCost
        const gc = g === 0 ? 0 : glyphCostAt
        const a: AbsAction = { t: 'kill', m: [m.id], glyph: g === 0 ? 'none' : g === 1 ? 'before' : 'after' }
        push({ a, score: base + r - fail - gc, adj: isRoot ? fail + gc : 0, hypo: unlikely || (isRoot && g !== 0 && ctx.glyphsNow < 1), hour: h, kinds: [star ? 'corrupt' : 'mark'], pKill: pk, expected: e })
        if (g === 0) (singles ??= []).push({ m, r, e })
      }
    }
    // Deux morts dans le créneau (sans glyphe).
    if (cfg.maxKillsPerSlot >= 2 && singles && singles.length >= 2) {
      const top = singles.sort((x, y) => y.r - x.r || x.m.id - y.m.id).slice(0, 4)
      for (let x = 0; x < top.length; x++) {
        for (let y = x + 1; y < top.length; y++) {
          const ma = top[x].m
          const mb = top[y].m
          const e = (top[x].e + top[y].e) / 2
          const pk = killProbability(e, ma.hp + mb.hp)
          if (!isRoot && pk < cfg.minKillP) continue
          const ra = killReward(i, s, ma, h0, ma.star, s.hoursUsed)
          const rb = killReward(i, s, mb, h0, mb.star, s.hoursUsed | (ma.star ? 0 : hourBit(h0)))
          const fail = (1 - pk) * cfg.failCost
          push({ a: { t: 'kill', m: [ma.id, mb.id], glyph: 'none' }, score: base + ra + rb - fail, adj: isRoot ? fail : 0, hypo: isRoot && pk < cfg.minKillP, hour: h0, kinds: [ma.star ? 'corrupt' : 'mark', mb.star ? 'corrupt' : 'mark'], pKill: pk, expected: e })
        }
      }
    }
    // Pré-dégâts (3 cibles : marquées / étoilées d'abord, puis les plus menaçantes).
    let dmg: { m: AbsMonster; e: number }[] | null = null
    for (const m of s.monsters) {
      if (m.status !== 'alive' || m.hp <= 1) continue
      const e = ctx.expected(i, p, m)
      if (e < 0.15 * m.hp || killProbability(e, m.hp) >= 0.9) continue
      ;(dmg ??= []).push({ m, e })
    }
    if (dmg) {
      dmg.sort((x, y) => Number(y.m.hours !== 0 || y.m.star) - Number(x.m.hours !== 0 || x.m.star) || y.m.threat - x.m.threat || x.m.id - y.m.id)
      for (let k = 0; k < dmg.length && k < 3; k++) {
        const { m, e } = dmg[k]
        const amount = Math.min(Math.floor(0.9 * e), m.hp - 1)
        if (amount <= 0) continue
        push({ a: { t: 'damage', m: m.id, amount, glyph: 'none' }, score: base - DAMAGE_EPSILON, adj: 0, hypo: false, hour: h0, expected: e })
      }
    }
    // Plafond d'actions (hors créneau courant) : « rien » + les meilleures.
    if (!isRoot && out.length - start > cfg.maxActions) {
      const rest = out.splice(start + 1).sort(byCandScore)
      for (let k = 0; k < cfg.maxActions - 1; k++) out.push(rest[k])
    }
  }

  /** État enfant d'un candidat (null si l'action est impossible). */
  const materialize = (c: Cand, i: number): PNode | null => {
    if (c.node !== undefined) return c.node
    const slot = slots[i]
    const child = c.a.t === 'none' ? c.n.s : applyAbs(c.n.s, slot, c.a)
    if (!child) return (c.node = null)
    expansions++
    const step: PlannerStep = { round: slot.round, index: slot.index, fighterId: slot.fighterId, hour: c.hour, action: c.a, score: c.score }
    if (c.kinds) step.kinds = c.kinds
    if (c.pKill !== undefined) step.pKill = c.pKill
    if (c.expected !== undefined) step.expected = c.expected
    const isRoot = i === 0
    return (c.node = {
      s: { ...child, score: c.score, trace: { step, prev: c.n.s.trace } },
      key: isRoot ? c.key : c.n.key,
      hypo: isRoot ? c.hypo : c.n.hypo,
      adj: c.n.adj + c.adj,
      f: c.f,
    })
  }

  /** Coût d'un créneau non joueur (exposition) ou joueur (submersion), après `beginSlot`. */
  const slotCost = (s: AbsState, i: number): number => {
    const slot = slots[i]
    let c = 0
    if (!slot.isPlayer) {
      for (const m of s.monsters) {
        if (!isActive(m)) continue
        if (m.id === slot.fighterId || (slot.isVortex && m.id < 0)) c += cfg.wExposure * m.threat
      }
    } else if (isActionSlot(slot)) {
      let alive = 0
      for (const m of s.monsters) if (isActive(m)) alive++
      const excess = alive - cfg.maxAliveFactor * N
      if (excess > 0) c += cfg.overloadCost * excess
    }
    return c
  }

  // ── borne de fin (coût restant optimiste) ──
  // nextSeen[i·13 + h] = premier créneau joueur APRÈS i d'un tueur autorisé qui voit l'heure h (sans glyphe), −1 sinon.
  const nextSeen = new Int32Array((slots.length + 1) * 13).fill(-1)
  for (let i = slots.length - 2; i >= -1; i--) {
    const row = (i + 1) * 13
    const nextRow = (i + 2) * 13
    if (i + 2 <= slots.length) nextSeen.copyWithin(row, nextRow, nextRow + 13)
    const sl = slots[i + 1]
    if (isActionSlot(sl) && ctx.canContract(sl.fighterId)) nextSeen[row + sl.hour] = i + 1
  }
  // Ligne « après i » : index i + 1 du tableau (i = −1 : depuis le début).
  const lastRound = slots.length ? slots[slots.length - 1].round : root.round
  const cycle = HOUR_COUNT / N
  // Tables de coût d'heure par type de monstre (h nouvelle / déjà posée).
  const typeIdx = new Map<number, number>()
  const costFresh: number[][] = []
  const costUsed: number[][] = []
  const typeOf = (monsterId: number): number => {
    let t = typeIdx.get(monsterId)
    if (t === undefined) {
      t = costFresh.length
      typeIdx.set(monsterId, t)
      const f: number[] = [0]
      const u: number[] = [0]
      for (let h = 1; h <= HOUR_COUNT; h++) {
        u.push(costs.cMon(monsterId, h))
        f.push(costs.cMon(monsterId, h) + costs.cVx(h))
      }
      costFresh.push(f)
      costUsed.push(u)
    }
    return t
  }
  // Attentes (tours de jeu) jusqu'au premier créneau d'un tueur qui voit h, après le créneau i, décalage g.
  const waitCache = new Map<number, Float64Array>()
  const waitsAfter = (i: number, g: number, round: number, hour: number): Float64Array => {
    const key = ((i + 1) * 12 + (g % 12)) * 4096 + round * 13 + hour
    let w = waitCache.get(key)
    if (w) return w
    w = new Float64Array(HOUR_COUNT + 1)
    for (let h = 1; h <= HOUR_COUNT; h++) {
      const j = nextSeen[(i + 1) * 13 + nextHour(h, -g)]
      w[h] = j >= 0 ? Math.max(0, slots[j].round - round) : Math.max(0, lastRound - round) + ((((h - hour - 1 + 24) % 12) + 1) / N)
    }
    waitCache.set(key, w)
    return w
  }
  /**
   * Coût restant d'un monstre après le créneau i (borne optimiste, §12.5 « coût terminal ») : PV restants
   * (`hpSlope`, PV d'un ressuscité pour un mort) ; marqué → exposition jusqu'au premier créneau d'un tueur qui revoit
   * une de ses heures (après sa résurrection s'il est mort) ; à marquer → meilleure heure h : attente + un cycle
   * d'horloge (+ invulnérabilité d'arrivée) d'exposition, plus le coût de h.
   */
  const futureOf = (m: AbsMonster, s: AbsState, i: number, withHp = false): number => {
    if (m.status === 'corrupt' || m.corruptOnWake) return 0
    const w = cfg.wExposure * m.threat
    // PV encore à retirer (classement seulement) : marquer puis corrompre (PV + PV d'un ressuscité) pour un monstre neuf,
    // corrompre (PV) pour un marqué vivant, PV d'un ressuscité pour un mort.
    const rez = withHp ? zombieHp(m) : 0
    const c = withHp ? cfg.hpSlope * (m.status === 'dead' ? rez : (m.status === 'pending' ? m.maxHp : m.hp) + (m.hours === 0 ? rez : 0)) : 0
    if (m.hours === 0) {
      const extra = cycle + (m.status === 'invulnerable' || m.status === 'pending' ? (abs.arrivalInvulnerableTurns ?? 1) : 0)
      const W = waitsAfter(i, s.glyphShift, s.round, s.hour)
      const t = typeOf(m.monsterId)
      const fresh = costFresh[t]
      const used = costUsed[t]
      const hu = s.hoursUsed
      let best = Infinity
      for (let h = 1; h <= HOUR_COUNT; h++) {
        const v = w * (W[h] + extra) + ((hu >> (h - 1)) & 1 ? used[h] : fresh[h])
        if (v < best) best = v
      }
      return c + best
    }
    if (m.status === 'alive' && m.star) return c
    const from = m.status === 'dead' ? Math.max(i, nextVortex[Math.max(0, i)]) : i
    const W = waitsAfter(from, s.glyphShift, s.round, s.hour)
    let d = Infinity
    for (let h = 1; h <= HOUR_COUNT; h++) if ((m.hours >> (h - 1)) & 1 && W[h] < d) d = W[h]
    return c + w * (Number.isFinite(d) ? d : cycle)
  }
  // Les monstres des vagues à venir ne dépendent des décisions que par l'heure, le décalage et les heures posées :
  // leur part est mise en cache par (créneau, décalage, heures posées).
  const pendingCache = new Map<number, number>()
  const futureCost = (s: AbsState, i: number, withHp = false): number => {
    let c = 0
    let hasPending = false
    for (const m of s.monsters) {
      if (m.status === 'pending') hasPending = true
      else c += futureOf(m, s, i, withHp)
    }
    if (hasPending) {
      const key = (((i + 1) * 12 + (s.glyphShift % 12)) * 4096 + s.hoursUsed) * 2 + (withHp ? 1 : 0)
      let p = pendingCache.get(key)
      if (p === undefined) {
        p = 0
        for (const m of s.monsters) if (m.status === 'pending') p += futureOf(m, s, i, withHp)
        pendingCache.set(key, p)
      }
      c += p
    }
    return c
  }

  /**
   * Rang d'un candidat dans le faisceau : score − coût restant de l'enfant (classement de type A* : une mort payée
   * maintenant est comparée à l'exposition qu'elle évite). Calcul incrémental pour les morts et pré-dégâts sans
   * glyphe (seuls les monstres concernés changent), complet pour les glyphes.
   */
  const rankOf = (c: Cand, i: number, materialized: (c: Cand) => PNode | null): number => {
    if (c.f !== undefined) return c.f
    const n = c.n
    const s = n.s
    const hParent = (n.hv ??= futureCost(s, i, true))
    const a = c.a
    let h = hParent
    if (a.t === 'kill' && a.glyph === 'none') {
      let used = s.hoursUsed
      for (let k = 0; k < a.m.length; k++) {
        const mi = s.monsters.findIndex(x => x.id === a.m[k])
        if (mi < 0) continue
        const m = s.monsters[mi]
        const after: AbsMonster = { ...m, status: 'dead', hp: 0, hours: m.hours | hourBit(s.hour), corruptOnWake: m.star }
        h += futureOf(after, { ...s, hoursUsed: used }, i, true) - futureOf(m, s, i, true)
        if (!m.star) used |= hourBit(s.hour)
      }
    } else if (a.t === 'damage') {
      const m = s.monsters.find(x => x.id === a.m)
      if (m) h += futureOf({ ...m, hp: Math.max(1, m.hp - a.amount) }, s, i, true) - futureOf(m, s, i, true)
    } else if (a.t !== 'none') {
      const node = materialized(c)
      h = node ? futureCost(node.s, i, true) : hParent
    }
    return (c.f = c.score - h)
  }

  // ── faisceau ──
  let beam: PNode[] = [{ s: root, key: '', hypo: false, adj: 0 }]
  const rootIsAction = slots.length > 0 && isActionSlot(slots[0])
  const cands: Cand[] = []
  for (let i = 0; i <= last && i < slots.length; i++) {
    if (i > 0) {
      for (let b = 0; b < beam.length; b++) {
        const n = beam[b]
        const s2 = beginSlot(n.s, slots, i, abs)
        const c = slotCost(s2, i)
        if (c) s2.score -= c
        beam[b] = { s: s2, key: n.key, hypo: n.hypo, adj: n.adj }
      }
    }
    if (!isActionSlot(slots[i])) {
      if (i === 0) beam = beam.map(n => ({ ...n, key: 'none' }))
      continue
    }
    const isRoot = i === 0
    cands.length = 0
    for (const n of beam) expand(n, i, isRoot, cands)
    if (isRoot && opts.forceRoot) {
      const fk = actionKey(opts.forceRoot)
      const kept = cands.filter(c => c.key === fk)
      cands.length = 0
      if (kept.length) cands.push(...kept)
      else cands.push({ n: beam[0], a: opts.forceRoot, key: fk, score: beam[0].s.score, adj: 0, hypo: false, hour: beam[0].s.hour })
    }
    for (const c of cands) rankOf(c, i, x => materialize(x, i))
    beam = selectBeam(cands, i, width, cfg.rootDiversity, isRoot, materialize)
  }
  if (!rootIsAction) beam = beam.map(n => (n.key ? n : { ...n, key: 'none' }))

  // ── fin d'horizon ──
  const lastIdx = Math.min(last, slots.length - 1)
  const finals = beam.map(n => ({ ...n, s: { ...n.s, score: n.s.score - futureCost(n.s, lastIdx) } }))
  finals.sort(byScore)
  const rootScores = new Map<string, number>()
  const priceScores = new Map<string, number>()
  const hypothetical = new Set<string>()
  for (const n of finals) {
    if (!rootScores.has(n.key)) rootScores.set(n.key, n.s.score)
    const ps = n.s.score + n.adj
    if (!priceScores.has(n.key) || ps > priceScores.get(n.key)!) priceScores.set(n.key, ps)
    if (n.hypo) hypothetical.add(n.key)
  }
  const real = finals.filter(n => !n.hypo)
  const best = real[0] ?? finals[0]
  const plan = extractPlan(best, real, root, ctx, cfg, rootScores, opts.version ?? 0)
  return { plan, best: best ? best.s.score : 0, priceScores, hypothetical, expansions, rootScores }
}

const NONE: AbsAction = { t: 'none' }
const GLYPH1: AbsAction = { t: 'glyph', count: 1 }
const GLYPH2: AbsAction = { t: 'glyph', count: 2 }

function cmpKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function byCandScore(a: Cand, b: Cand): number {
  return (b.f ?? b.score) - (a.f ?? a.score) || cmpKey(a.key, b.key) || cmpKey(a.n.key, b.n.key) || (a.tie ?? 0) - (b.tie ?? 0) || nodeHash(a.n) - nodeHash(b.n)
}

function nodeHash(n: PNode): number {
  return (n.h ??= mix(stateHash(n.s), strHash(n.key)) >>> 0)
}

function byScore(a: PNode, b: PNode): number {
  return b.s.score - a.s.score || cmpKey(a.key, b.key) || nodeHash(a) - nodeHash(b)
}

/** Empreinte de l'état abstrait (mêmes champs que `abstract.absHash`, §12.5). */
function stateHash(s: AbsState): number {
  let h = mix(s.slotIdx, (s.hour << 8) | (s.glyphShift % 12))
  for (const m of s.monsters) {
    h = mix(h, m.id)
    h = mix(h, (m.hours << 12) | (STATUS_CODE[m.status] << 8) | (m.star ? 2 : 0) | (m.corruptOnWake ? 1 : 0))
    h = mix(h, Math.floor(m.hp / 500))
  }
  return h >>> 0
}

/**
 * Empreinte STRUCTURELLE (statuts, heures, étoiles, heure, décalage, PV par quarts de PV max ; pas l'action racine) :
 * complément du faisceau. Les quarts de PV gardent distinctes les lignes de pré-dégâts (un monstre entamé pour le
 * tueur suivant) sans dupliquer des lignes qui ne diffèrent que de quelques centaines de PV.
 */
function structHash(n: PNode): number {
  if (n.sh !== undefined) return n.sh
  const s = n.s
  let h = mix(s.slotIdx, (s.hour << 8) | (s.glyphShift % 12))
  for (const m of s.monsters) {
    const q = m.maxHp > 0 ? Math.min(4, Math.floor((4 * m.hp) / m.maxHp)) : 0
    h = mix(h, (m.hours << 12) | (STATUS_CODE[m.status] << 8) | (q << 2) | (m.star ? 2 : 0) | (m.corruptOnWake ? 1 : 0))
  }
  return (n.sh = h >>> 0)
}
const STATUS_CODE: Record<AbsMonster['status'], number> = { pending: 1, invulnerable: 2, alive: 3, dead: 4, corrupt: 5 }

/**
 * Sélection du faisceau parmi les candidats (triés par score, états construits à la demande) : (1) diversité de
 * racine — le meilleur nœud de chaque action racine (puis les suivants jusqu'à `diversity` par racine), dans la limite
 * de la moitié du faisceau (tout le faisceau au créneau courant) ; (2) complément par score, une seule fois par
 * empreinte STRUCTURELLE (deux lignes qui ne diffèrent que par des PV ou par l'action racine n'occupent pas deux
 * places), nœuds hypothétiques exclus ; (3) places restantes par score. Doublons exacts (état × racine) écartés.
 */
function selectBeam(cands: Cand[], i: number, width: number, diversity: number, isRoot: boolean,
                    materialize: (c: Cand, i: number) => PNode | null): PNode[] {
  cands.sort(byCandScore)
  const out: PNode[] = []
  const used = new Set<Cand>()
  const exact = new Set<number>()
  const structs = new Set<number>()
  const take = (c: Cand, structural: boolean): boolean => {
    const n = materialize(c, i)
    used.add(c)
    if (!n) return false
    const h = nodeHash(n)
    if (exact.has(h)) return false
    const sh = structHash(n)
    if (structural && structs.has(sh)) return false
    exact.add(h)
    structs.add(sh)
    out.push(n)
    return true
  }
  const divCap = isRoot ? width : Math.max(1, Math.floor(width / 2))
  const rootKey = (c: Cand) => (isRoot ? c.key : c.n.key)
  const perKey = new Map<string, number>()
  for (let round = 1; round <= diversity && out.length < divCap; round++) {
    for (const c of cands) {
      if (out.length >= divCap) break
      if (used.has(c)) continue
      const k = rootKey(c)
      if ((perKey.get(k) ?? 0) >= round) continue
      if (take(c, false)) perKey.set(k, (perKey.get(k) ?? 0) + 1)
    }
  }
  for (const c of cands) {
    if (out.length >= width) break
    if (used.has(c) || (isRoot ? c.hypo : c.n.hypo)) continue
    take(c, true)
  }
  for (const c of cands) {
    if (out.length >= width) break
    if (used.has(c) || (isRoot ? c.hypo : c.n.hypo)) continue
    take(c, false)
  }
  return out.sort(byRank)
}

function byRank(a: PNode, b: PNode): number {
  return (b.f ?? b.s.score) - (a.f ?? a.s.score) || byScore(a, b)
}

// ───────────────────────────── extraction ─────────────────────────────

function stepsOf(n: PNode | undefined): PlannerStep[] {
  const out: PlannerStep[] = []
  for (let t = n?.s.trace ?? null; t; t = t.prev) out.push(t.step as PlannerStep)
  return out.reverse()
}

function extractPlan(
  best: PNode | undefined,
  real: PNode[],
  root: AbsState,
  ctx: PlannerContext,
  cfg: PlannerConfig,
  rootScores: Map<string, number>,
  version: number,
): ScenarioPlan {
  const steps = stepsOf(best)
  // Alternatives : actions racines différentes d'abord, puis séquences différentes.
  const alternatives: PlanStep[][] = []
  const seenKeys = new Set<string>([best?.key ?? ''])
  const sig = (st: PlanStep[]) => st.map(x => `${x.round}.${x.index}:${actionKey(x.action)}`).join('|')
  const seenSigs = new Set<string>([sig(steps)])
  for (const n of real) {
    if (alternatives.length >= 4) break
    if (seenKeys.has(n.key)) continue
    seenKeys.add(n.key)
    const st = stepsOf(n)
    seenSigs.add(sig(st))
    alternatives.push(st)
  }
  for (const n of real) {
    if (alternatives.length >= 4) break
    const st = stepsOf(n)
    const k = sig(st)
    if (seenSigs.has(k)) continue
    seenSigs.add(k)
    alternatives.push(st)
  }
  const contracts: ScenarioPlan['contracts'] = []
  const glyphs: ScenarioPlan['glyphs'] = []
  const bands: ScenarioPlan['bands'] = []
  const first = ctx.slots[0]
  let lastCorruptRound = 0
  for (const st of steps) {
    const a = st.action
    const g = glyphCount(a)
    if (g > 0) glyphs.push({ round: st.round, index: st.index, count: (a.t === 'glyph' ? a.count : 1) as 1 | 2, when: a.t === 'kill' && a.glyph === 'after' ? 'afterKills' : 'beforeKills' })
    if (a.t !== 'kill') continue
    a.m.forEach((m, k) => {
      const kind = st.kinds?.[k] ?? 'mark'
      contracts.push({ m, round: st.round, index: st.index, killer: st.fighterId, kind, hour: st.hour, pKill: st.pKill ?? 1 })
      if (kind === 'corrupt') lastCorruptRound = Math.max(lastCorruptRound, st.round)
      const isNow = first && st.round === first.round && st.index === first.index
      if (!isNow && st.expected !== undefined && st.expected > 0) bands.push({ m, beforeKiller: st.fighterId, hpMin: 1, hpMax: Math.max(1, Math.floor(0.8 * st.expected)) })
    })
  }
  // Interdits : morts possibles maintenant dont le prix est nettement inférieur au meilleur plan.
  const forbid: ScenarioPlan['forbid'] = []
  const bestScore = best?.s.score ?? 0
  const lastRound = steps.length ? steps[steps.length - 1].round : first?.round ?? 0
  if (best) {
    for (const [key, sc] of rootScores) {
      const mt = /^kill:(-?\d+)$/.exec(key)
      if (!mt || sc >= bestScore - 300) continue
      const m = Number(mt[1])
      if (contracts.some(c => c.m === m && first && c.round === first.round && c.index === first.index)) continue
      const later = contracts.find(c => c.m === m)
      const mon = root.monsters.find(x => x.id === m)
      const h = first?.hour ?? 0
      const cost = mon && !mon.star ? ctx.costs.markCost(mon.monsterId, h, root.hoursUsed) : 0
      forbid.push({ m, untilRound: later ? later.round : lastRound, reason: cost >= cfg.badHourVx ? 'badHour' : later ? 'waveSync' : 'noFollowUp' })
    }
  }
  // Fin prévue des corruptions : dernière corruption du plan, sinon estimation terminale.
  let eta = lastCorruptRound
  if (best) {
    const N = Math.max(1, ctx.players)
    for (const m of best.s.monsters) {
      if (m.status === 'corrupt' || m.corruptOnWake) continue
      const extra = m.hours === 0 ? HOUR_COUNT / N + 1 : HOUR_COUNT / N
      eta = Math.max(eta, Math.ceil(best.s.round + extra))
    }
  }
  return {
    version,
    steps,
    alternatives,
    contracts,
    forbid,
    glyphs,
    bands,
    rootScores,
    etaAllCorrupted: eta,
  }
}

// ───────────────────────────── oracle de kill (§12.6) ─────────────────────────────

/**
 * Oracle de kill : `E_i(m) = dpt(i, m)·ρ_i(m)·c_i`, ρ = 1 si une case de lancer est accessible maintenant (créneau
 * courant), `futureReach` pour un créneau futur ; `c_i` = moyenne mobile (α = θ.planner.oracleAlpha) du rapport dégâts
 * réalisés / prévus du joueur i dans ce combat (borné à [0,4 ; 1,3]) ; un tour sans aucun dégât (contrôle, soin) ne
 * met pas la calibration à jour. Un monstre qui aura l'heure V au moment du créneau
 * (et ne la porte pas encore) subit ×70 %.
 */
export class KillOracle {
  /** dpt(i, m) de base : clé `i:id` (monstre présent) ou `i:#monsterId` (référence). */
  private readonly base = new Map<string, number>()
  /** Heures portées par chaque monstre présent au moment du calcul (bonus déjà dans son DPT). */
  private readonly ownHours = new Map<number, number>()
  /** Atteignabilité au créneau courant (monstre présent → vrai/faux) et P(kill) de `canKillNow`. */
  readonly now = new Map<number, { reach: boolean; p: number }>()
  readonly calib = new Map<number, number>()
  private readonly pending = new Map<number, { predicted: number; dealt: number; turns: number }>()
  nowPlayer = -1

  constructor(
    readonly alpha = 0.2,
    readonly futureReach = 0.85,
  ) {}

  /** Réinitialise les DPT de base (début de chaque mise à jour du modèle). */
  reset(): void {
    this.base.clear()
    this.ownHours.clear()
    this.now.clear()
    this.nowPlayer = -1
  }

  setDpt(playerId: number, monster: { id: number } | { monsterId: number }, value: number, hours?: number): void {
    if ('id' in monster) {
      this.base.set(`${playerId}:${monster.id}`, value)
      if (hours !== undefined) this.ownHours.set(monster.id, hours)
    } else this.base.set(`${playerId}:#${monster.monsterId}`, value)
  }

  dptOf(playerId: number, m: AbsMonster): number {
    return this.base.get(`${playerId}:${m.id}`) ?? this.base.get(`${playerId}:#${m.monsterId}`) ?? 0
  }

  expected(slotIdx: number, playerId: number, m: AbsMonster): number {
    let e = this.dptOf(playerId, m)
    if (e <= 0) return 0
    const own = this.ownHours.get(m.id) ?? 0
    if (maskHas(m.hours, 5) && !maskHas(own, 5)) e *= 0.7
    if (slotIdx === 0 && playerId === this.nowPlayer) {
      const r = this.now.get(m.id)
      if (r && !r.reach) return 0
    } else e *= this.futureReach
    return e * (this.calib.get(playerId) ?? 1)
  }

  pKillNow(m: AbsMonster, liveHp: number | undefined): number | undefined {
    const r = this.now.get(m.id)
    if (!r || liveHp === undefined || liveHp !== m.hp) return undefined
    return r.p
  }

  /** Note la prévision du tour d'un joueur (dégâts prévus du plan, dégâts déjà infligés, tours joués). */
  expect(playerId: number, predicted: number, dealt: number, turns: number): void {
    if (predicted > 0) this.pending.set(playerId, { predicted, dealt, turns })
    else this.pending.delete(playerId)
  }

  /** Calibration en ligne : résout les prévisions des joueurs qui ont joué depuis. */
  observe(metrics: (id: number) => { dealt: number; turns: number } | undefined): void {
    for (const [id, pr] of [...this.pending]) {
      const m = metrics(id)
      if (!m || m.turns <= pr.turns) continue
      // Aucun dégât : choix tactique (contrôle, soin, placement), pas une erreur du modèle — prévision abandonnée.
      if (m.dealt <= pr.dealt) {
        this.pending.delete(id)
        continue
      }
      const ratio = Math.max(0.4, Math.min(1.3, (m.dealt - pr.dealt) / pr.predicted))
      const c = this.calib.get(id) ?? 1
      this.calib.set(id, (1 - this.alpha) * c + this.alpha * ratio)
      this.pending.delete(id)
    }
  }

  snapshot(): { calib: [number, number][]; pending: [number, { predicted: number; dealt: number; turns: number }][] } {
    return { calib: [...this.calib], pending: [...this.pending].map(([k, v]) => [k, { ...v }]) }
  }

  restore(s: ReturnType<KillOracle['snapshot']>): void {
    this.calib.clear()
    this.pending.clear()
    for (const [k, v] of s.calib) this.calib.set(k, v)
    for (const [k, v] of s.pending) this.pending.set(k, { ...v })
  }
}

/** Contexte « prévision modifiée » : personnage `deadId` retiré (mort), selon la règle d'horloge des morts. */
export function slotsWithoutPlayer(slots: readonly ClockSlot[], deadId: number, deadAdvancesClock: boolean): ClockSlot[] {
  const out: ClockSlot[] = []
  let shift = 0
  for (const sl of slots) {
    if (sl.isPlayer && sl.fighterId === deadId && sl.index >= 0 && out.length > 0) {
      if (deadAdvancesClock) out.push({ ...sl, index: -1, hour: nextHour(sl.hour, shift) })
      else shift -= 1
      continue
    }
    out.push(shift ? { ...sl, hour: nextHour(sl.hour, shift) } : sl)
  }
  return out
}
