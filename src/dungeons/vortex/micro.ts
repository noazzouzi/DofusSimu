/**
 * Micro-scénarios de l'Œil de Vortex (docs/design/ai.md §12.11) — WP3.
 *
 *  - `prefix12` : tours 1-12 du vrai scénario (vague 1, vague 2, arrivée de la vague 3) ; note de progression
 *    (corrompus, marqués, morts, PV) convertie en P(victoire) par une régression logistique. Les coefficients par
 *    défaut sont PROVISOIRES (non calibrés) : la calibration sur ≈ 2 000 combats complets (§12.11) relève de la boucle
 *    externe (`setPrefix12Calibration`).
 *  - `phase2` : Vortex déverrouillé dès le début par *Action !* (5060, données) avec des heures portées par les
 *    monstres de la vague 1 (paramètre `phase2Hours`, sinon tirage pondéré par la graine : heures bon marché plus
 *    probables) ; P(Vortex tué) dans `phase2MaxRounds` tours (défaut 8).
 *  - `poutch` : 3 tours contre le mannequin aux résistances du mix Vortex (generic/dummy.ts) : dégâts par personnage.
 *
 * Le moteur passé à `createFight` doit être créé avec `vortexHooks` (prefix12, phase2) ; `poutch` fonctionne avec tout
 * moteur (aucune règle serveur).
 */
import { mix32 } from '../../core/hash'
import { Rng } from '../../core/rng'
import { castSubSpell } from '../../engine/effects/core'
import type { Engine } from '../../engine/engine'
import type { Fighter, FightState } from '../../engine/types'
import { createDummyFight, dummyDamage } from '../generic/dummy'
import type { FightSetupOptions, MicroId, MicroResult, MicroScenario } from '../types'
import { hourCount, isWaveMonster } from './clock'
import { AURORAIRE, C_VX_FALLBACK, HOUR_COUNT, HOUR_STATE_BASE, MARGINAL, ROMAN, SPELL, VORTEX, WAVE_COUNT } from './constants'
import { patchVortexState, vortexState } from './params'
import { createVortexFight } from './setup'
import { trackVortex } from './tracker'

// ───────────────────────────── outils ─────────────────────────────

/** Sigmoïde rationnelle (déterministe, sans `Math.exp`, §13.2) : 0,5·(1 + x/(1 + |x|)). */
export function rationalSigmoid(x: number): number {
  return 0.5 * (1 + x / (1 + Math.abs(x)))
}

function teamHp(fight: FightState): { alive: number; n: number; hpPct: number; deaths: number; damageTaken: number } {
  const players = fight.fighters.filter(f => f.team === 0 && f.kind === 'player')
  const hp = players.reduce((a, f) => a + (f.alive ? f.hp : 0), 0)
  const max = players.reduce((a, f) => a + f.baseMaxHp, 0)
  const alive = players.filter(f => f.alive).length
  return {
    alive,
    n: players.length,
    hpPct: max ? hp / max : 0,
    deaths: players.length - alive,
    damageTaken: players.reduce((a, f) => a + (fight.metrics[f.id]?.damageTaken ?? 0), 0),
  }
}

const withParams = (o: FightSetupOptions, extra: Record<string, number | string | boolean | readonly number[]>): FightSetupOptions => ({
  ...o,
  params: { ...o.params, ...extra },
})

// ───────────────────────────── prefix12 ─────────────────────────────

export const PREFIX12_ROUNDS = 12

/** Coefficients de la régression logistique de `prefix12` (logit = biais + Σ coef·mesure). */
export interface Prefix12Calibration {
  bias: number
  /** Part des monstres apparus qui sont corrompus. */
  corrupted: number
  /** Part des monstres apparus marqués (≥ 1 heure de mort) et non corrompus. */
  marked: number
  /** PV restants des personnages (fraction). */
  hp: number
  /** Personnages morts. */
  deaths: number
}

/** Coefficients PROVISOIRES (non calibrés) : seulement monotones dans le bon sens. */
export const DEFAULT_PREFIX12_CALIBRATION: Readonly<Prefix12Calibration> = { bias: -2, corrupted: 4, marked: 1.5, hp: 2, deaths: -1.2 }
let prefix12Calibration: Prefix12Calibration = { ...DEFAULT_PREFIX12_CALIBRATION }

/** Remplace les coefficients de `prefix12` (boucle externe, §12.11) ; sans argument, rétablit les défauts. */
export function setPrefix12Calibration(c?: Partial<Prefix12Calibration>): void {
  prefix12Calibration = { ...DEFAULT_PREFIX12_CALIBRATION, ...c }
}

export function evaluatePrefix12(fight: FightState): MicroResult {
  const snap = trackVortex(fight)
  const team = teamHp(fight)
  const present = snap.tracks.filter(t => t.status !== 'pending')
  const spawned = Math.max(1, present.length)
  const marked = present.filter(t => t.status !== 'corrupt' && t.hours !== 0).length
  const corruptedPct = snap.corrupted / spawned
  const markedPct = marked / spawned
  const c = prefix12Calibration
  const logit = c.bias + c.corrupted * corruptedPct + c.marked * markedPct + c.hp * team.hpPct + c.deaths * team.deaths
  const progress = Math.max(0, Math.min(1, 0.6 * corruptedPct + 0.25 * markedPct + 0.15 * (team.n ? team.alive / team.n : 0)))
  const lost = fight.ended && fight.winner === 1
  return {
    pWin: lost ? 0 : rationalSigmoid(logit),
    progress,
    rounds: Math.min(fight.round, PREFIX12_ROUNDS),
    deaths: team.deaths,
    hpLeftPct: team.hpPct,
    metrics: {
      spawned: present.length,
      corrupted: snap.corrupted,
      marked,
      hoursUsed: hourCount(snap.hoursUsedMask),
      damageTaken: team.damageTaken,
      logit,
    },
  }
}

export const prefix12Micro: MicroScenario = {
  id: 'prefix12',
  description: 'Tours 1 à 12 du Vortex (vagues 1-2, arrivée de la vague 3) : progression → P(victoire)',
  maxRounds: PREFIX12_ROUNDS,
  createFight: (engine: Engine, team: Fighter[], o: FightSetupOptions) => createVortexFight(engine, team, withParams(o, { maxRounds: PREFIX12_ROUNDS })),
  done: fight => fight.ended || fight.round > PREFIX12_ROUNDS,
  evaluate: evaluatePrefix12,
}

// ───────────────────────────── phase2 ─────────────────────────────

export const PHASE2_DEFAULT_ROUNDS = 8
export const PHASE2_DEFAULT_HOUR_COUNT = 4

/**
 * Heures hérités par le Vortex dans `phase2` : `params.phase2Hours` si fourni, sinon `count` heures distinctes tirées
 * (graine) avec un poids ∝ 1/(1 + C_vx/1000) — les heures bon marché (VII, II, X…) sont les plus probables.
 */
export function samplePhase2Hours(seed: number, count = PHASE2_DEFAULT_HOUR_COUNT): number[] {
  const rng = new Rng(mix32(seed, 0x92))
  const pool = Array.from({ length: HOUR_COUNT }, (_, i) => i + 1)
  const out: number[] = []
  for (let k = 0; k < Math.min(count, HOUR_COUNT); k++) {
    const weights = pool.map(h => 1 / (1 + C_VX_FALLBACK[h] / 1000))
    const total = weights.reduce((a, b) => a + b, 0)
    let r = rng.next() * total
    let pick = pool.length - 1
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i]
      if (r < 0) {
        pick = i
        break
      }
    }
    out.push(pool[pick])
    pool.splice(pick, 1)
  }
  return out.sort((a, b) => a - b)
}

/** Crée un combat déjà en phase 2 (voir l'en-tête) : *Action !* est lancé avant le premier tour. */
export function createPhase2Fight(engine: Engine, team: Fighter[], o: FightSetupOptions): FightState {
  const raw = o.params as Record<string, unknown>
  const rounds = typeof raw.phase2MaxRounds === 'number' ? raw.phase2MaxRounds : PHASE2_DEFAULT_ROUNDS
  const hours = Array.isArray(raw.phase2Hours) ? (raw.phase2Hours as number[]).filter(h => h >= 1 && h <= HOUR_COUNT) : samplePhase2Hours(o.seed, typeof raw.phase2HourCount === 'number' ? raw.phase2HourCount : PHASE2_DEFAULT_HOUR_COUNT)
  const fight = createVortexFight(engine, team, withParams(o, { maxRounds: rounds }))
  const vx = vortexState(fight)!
  const vortex = fight.fighters[vx.vortexId]
  const aur = fight.fighters.find(f => f.alive && f.monsterId === AURORAIRE)
  const monsters = fight.fighters.filter(isWaveMonster)
  // Heures portées par les monstres (états 221..232, comme 5000) : réparties à tour de rôle.
  hours.forEach((h, i) => {
    const m = monsters[i % Math.max(1, monsters.length)]
    if (!m || m.states.includes(HOUR_STATE_BASE + h)) return
    const e = engine.data.spellLevel(SPELL.GLYPHE_MARK_HOUR, { grade: 1 })?.effects.find(x => x.effectId === 950 && x.value === HOUR_STATE_BASE + h)
    if (!e) return
    engine.addBuff(fight, m, {
      sourceId: aur?.id ?? m.id, spellId: SPELL.GLYPHE_MARK_HOUR, effect: e, value: HOUR_STATE_BASE + h, remaining: -1, delay: 0,
      dispellable: false, stateId: HOUR_STATE_BASE + h, kind: 'stat', label: `Heure de mort : ${ROMAN[h]}`,
    })
  })
  // Combat « avancé » (≈ tour 26) : les délais de relance initiaux (Heurage, En temps et en heure…) sont échus.
  for (const f of fight.fighters) f.cooldowns = {}
  // Plus de vague ni de Marginal : *Action !* (données) déverrouille le Vortex.
  for (const b of vortex.buffs.slice()) if (b.stateId === MARGINAL) engine.removeBuff(fight, vortex, b.uid)
  patchVortexState(fight, { wavesSpawned: WAVE_COUNT, actionRound: 1, allCorruptSince: 1 })
  engine.log(fight, `Phase 2 (micro-scénario) : heures héritées ${hours.map(h => ROMAN[h]).join(', ') || 'aucune'}.`, 'warn')
  castSubSpell(engine, fight, vortex, SPELL.ACTION, 1, vortex.cell, false, 0)
  return fight
}

export function evaluatePhase2(fight: FightState): MicroResult {
  const vx = vortexState(fight)
  const vortex = vx ? fight.fighters[vx.vortexId] : fight.fighters.find(f => f.monsterId === VORTEX)
  const team = teamHp(fight)
  const dead = !!vortex && !vortex.alive
  const hpPct = vortex ? (vortex.alive ? vortex.hp / Math.max(1, vortex.maxHp) : 0) : 1
  return {
    pWin: dead ? 1 : 0,
    progress: 1 - hpPct,
    rounds: fight.round,
    deaths: team.deaths,
    hpLeftPct: team.hpPct,
    metrics: {
      vortexHpPct: hpPct,
      vortexAp: vortex?.stats.ap ?? 0,
      vortexMp: vortex?.stats.mp ?? 0,
      vortexMaxHp: vortex?.maxHp ?? 0,
      damageTaken: team.damageTaken,
    },
  }
}

export const phase2Micro: MicroScenario = {
  id: 'phase2',
  description: 'Vortex déverrouillé (Action !) avec des heures héritées : P(Vortex tué), tours, morts',
  maxRounds: PHASE2_DEFAULT_ROUNDS,
  createFight: createPhase2Fight,
  done: fight => {
    if (fight.ended) return true
    const raw = vortexState(fight)
    return raw ? fight.round > raw.maxRounds : fight.round > PHASE2_DEFAULT_ROUNDS
  },
  evaluate: evaluatePhase2,
}

// ───────────────────────────── poutch ─────────────────────────────

export const POUTCH_ROUNDS = 3

export const poutchMicro: MicroScenario = {
  id: 'poutch',
  description: '3 tours contre un mannequin aux résistances du mix Vortex : dégâts par personnage (calibration DPT)',
  maxRounds: POUTCH_ROUNDS,
  createFight: (engine, team, o) => createDummyFight(engine, team, { ...o, params: { maxRounds: POUTCH_ROUNDS, resMix: 'vortex' } }),
  done: fight => fight.ended || fight.round > POUTCH_ROUNDS,
  evaluate(fight) {
    const dmg = dummyDamage(fight)
    const metrics: Record<string, number> = { totalDamage: dmg.total, damagePerRound: dmg.perRound }
    for (const [id, d] of Object.entries(dmg.byFighter)) metrics[`dpt_${id}`] = d / POUTCH_ROUNDS
    const team = teamHp(fight)
    return { pWin: 0, progress: 0, rounds: Math.min(fight.round, POUTCH_ROUNDS), deaths: team.deaths, hpLeftPct: team.hpPct, metrics }
  },
}

export const vortexMicro: Partial<Record<MicroId, MicroScenario>> = {
  prefix12: prefix12Micro,
  phase2: phase2Micro,
  poutch: poutchMicro,
}
