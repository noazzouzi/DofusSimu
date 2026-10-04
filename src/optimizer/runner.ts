/**
 * Exécution d'UN combat à partir d'une `FightSpec` et d'une graine (docs/design/ai.md §15.2) — WP4.
 *
 * BOUCHON S0 (fonctionnel mais minimal) — TODO(WP4) : variantes INCERTAINES échantillonnées (`variantPolicy`), sorts
 * passifs des objets (1175), placement choisi par le scénario, bruit des monstres, `spellUse` sans enregistrement,
 * cache (§15.2), micro-scénarios. Le pipeline est celui de la cible : build → combattants → scénario → contrôleurs IA
 * → `runFight` → `FightSummary`.
 */
import { createControllers, defaultAIConfig } from '../ai'
import { fnv1a32 } from '../core/hash'
import type { DataStore } from '../data/store'
import { getScenario } from '../dungeons'
import type { ScenarioParams } from '../dungeons/types'
import { createPlayerFighter } from '../engine/factory'
import { runFight } from '../engine/runner'
import { createEngine } from '../engine'
import type { Fighter, FightEvent, FightState } from '../engine/types'
import { computeBuildStats } from '../stats/build'
import type { FightSpec, FightSummary, MemberSpec } from './types'

export interface RunOptions {
  /** Enregistrer les événements (replay) ; défaut faux (lots : résumés seulement, §13.2). */
  record?: boolean
  /** Re-semis des dés par tour (E1) ; défaut 'perTurn' (CRN). */
  rngRekey?: 'none' | 'perTurn'
}

export interface RunResult {
  summary: FightSummary
  fight: FightState
}

/** Combattants des personnages d'une équipe (caractéristiques calculées par src/stats). */
export function buildTeam(data: DataStore, members: readonly MemberSpec[]): Fighter[] {
  return members.map(m => {
    const res = computeBuildStats(m.build, data)
    return createPlayerFighter(data, {
      name: m.name,
      breedId: m.breedId,
      level: m.build.level,
      stats: res.stats,
      maxHp: res.maxHp,
      variants: m.variants,
      role: m.role,
      ai: 'player',
    })
  })
}

/** Hash des événements hors `log` / `aiNote` (replays enregistrés) ; 0 si le combat n'est pas enregistré. */
export function eventsHash(events: readonly FightEvent[]): number {
  let h = 0x811c9dc5
  for (const e of events) {
    if (e.t === 'log' || e.t === 'aiNote') continue
    h = fnv1a32(JSON.stringify(e), h)
  }
  return events.length ? h : 0
}

/**
 * Empreinte déterministe d'un combat terminé (`FightSummary.eventsHash`, §13.2, §16.5) : état final complet (dés,
 * tour, timeline, combattants, buffs, marques, registre des morts, métriques). Contrairement à `eventsHash`, elle ne
 * dépend PAS de l'enregistrement : identique avec `record` vrai ou faux, 1 ou 4 workers, Node ou navigateur. Deux
 * combats qui divergent à un moment quelconque (dés, décision, effet) ont, sauf collision, des empreintes différentes.
 * `Fighter.rev` (opaque, E4) en est exclu.
 */
export function fightDigest(fight: FightState): number {
  const p: (number | string)[] = [fight.round, fight.turnIndex, fight.rngState, fight.nextUid, fight.winner ?? -1,
    fight.ended ? 1 : 0, fight.endReason ?? '', fight.unknownEffects ?? 0, fight.timeline.join('.')]
  for (const f of fight.fighters) {
    p.push(f.id, f.team, f.alive ? 1 : 0, f.hp, f.shield, f.maxHp, f.cell, Math.round(f.ap * 100), Math.round(f.mp * 100),
      f.states.join('.'))
    for (const b of f.buffs) p.push(b.uid, b.sourceId, b.spellId, b.effect.effectId, b.value, b.remaining)
    const m = fight.metrics[f.id]
    if (m) p.push(m.damageDealt, m.damageTaken, m.healingDone, m.apRemoved, m.mpRemoved, m.kills, m.turnsPlayed)
  }
  for (const g of fight.glyphs) p.push('g', g.uid, g.spellId, g.center, g.remaining)
  for (const t of fight.traps) p.push('t', t.uid, t.spellId, t.center)
  for (const d of fight.deaths ?? []) p.push('d', d.fighter, d.round, d.cell, d.killer ?? -1)
  return fnv1a32(p.join(','))
}

/** Score d'un combat (§15.2) : `win ? 1 + 0,1·PV% − tours/600 : 0,8·progress` (PV% en fraction [0, 1]). */
export function fightScore(win: boolean, hpLeftPct: number, rounds: number, progress: number): number {
  return win ? 1 + 0.1 * hpLeftPct - rounds / 600 : 0.8 * progress
}

/** Joue un combat complet et le résume. */
export function runOne(data: DataStore, spec: FightSpec, seed: number, opts: RunOptions = {}): RunResult {
  const scenario = getScenario(spec.scenarioId)
  const engine = createEngine(data, scenario.hooks)
  const team = buildTeam(data, spec.team)
  const params = { ...scenario.defaultParams, ...spec.params } as ScenarioParams
  const fight = scenario.createFight(engine, team, {
    params,
    seed,
    placement: spec.placement,
    rollMode: 'random',
    record: opts.record ?? false,
    rngRekey: opts.rngRekey ?? 'perTurn',
  })
  const cfg = defaultAIConfig(spec.mode, seed, spec.theta)
  const controllers = createControllers(engine, cfg, { scenario: scenario.aiModel(params, spec.theta) })
  runFight(engine, fight, controllers)
  const s = scenario.summarize(fight)
  const chars = fight.fighters.filter(f => f.team === 0 && f.kind === 'player')
  const hpLeftPct = chars.reduce((a, f) => a + (f.alive ? f.hp : 0), 0) / Math.max(1, chars.reduce((a, f) => a + f.baseMaxHp, 0))
  const spellUse: Record<number, number> = {}
  for (const e of fight.events) if (e.t === 'cast' && fight.fighters[e.fighter]?.team === 0) spellUse[e.spellId] = (spellUse[e.spellId] ?? 0) + 1
  const st = controllers.stats()
  const summary: FightSummary = {
    seed,
    variant: 'default',
    win: s.win,
    rounds: s.rounds,
    endReason: s.endReason,
    failReason: s.failReason,
    deaths: chars.filter(f => !f.alive).length,
    hpLeftPct,
    damageTaken: chars.reduce((a, f) => a + (fight.metrics[f.id]?.damageTaken ?? 0), 0),
    progress: s.progress,
    score: fightScore(s.win, hpLeftPct, s.rounds, s.progress),
    corruptedByRound: s.corruptedByRound,
    hoursUsed: s.hoursUsed,
    phase2Rounds: s.phase2Rounds,
    vortexHpPct: s.vortexHpPct,
    creativeActions: st.creativeActions,
    tactics: st.tactics,
    spellUse,
    unknownEffects: fight.unknownEffects ?? 0,
    nodes: st.nodes,
    eventsHash: fightDigest(fight),
  }
  return { summary, fight }
}
