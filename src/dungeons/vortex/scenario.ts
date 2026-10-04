/**
 * Scénario « Œil de Vortex » (docs/design/ai.md §12) — WP3.
 *
 * BOUCHON S0 — TODO(WP3) : mise en place minimale seulement (carte 143393281, personnages sur les cases rouges,
 * vague 1 = Vortex + 3 monstres sur les cases bleues, paramètres rangés dans `fight.scenarioState.vortex`).
 * Manquent : sorts de départ (5006 Vortexiphan / Auroraire, 5002), règles serveur des hooks (vagues, invulnérabilité
 * d'arrivée, équipe qui commence, résurrection, déverrouillage, fin de combat), variantes INCERTAINES, `aiModel`
 * (HourPlanner, pricers, burst, placement), micro-scénarios et résumé complet (§12.1-§12.11).
 */
import type { Engine } from '../../engine/engine'
import { createMonsterFighter } from '../../engine/factory'
import type { Fighter, FightState, ScenarioHooks } from '../../engine/types'
import type { DungeonScenario, FightSetupOptions, ScenarioAIModel, ScenarioParams, ScenarioSummary } from '../types'
import {
  BLUE_START_CELLS,
  CORRUPTED,
  RED_CELLS_SAFE_K4,
  VORTEX,
  VORTEX_DEFAULT_PARAMS,
  VORTEX_MAP_ID,
  VORTEX_ROLE_NEEDS,
  VORTEX_SCENARIO_ID,
  VORTEX_STATE_KEY,
  VORTEX_UNCERTAIN,
  waveComposition,
  type VortexParams,
} from './constants'

/** Paramètres typés à partir de paramètres plats (défauts complétés). TODO(WP3) : validation (params.ts). */
export function vortexParams(params: ScenarioParams): VortexParams {
  return { ...VORTEX_DEFAULT_PARAMS, ...(params as Partial<VortexParams>) }
}

/** Hooks serveur du scénario (BOUCHON S0 : seulement la copie rapide de l'état, E2). */
export const vortexHooks: ScenarioHooks = {
  id: VORTEX_SCENARIO_ID,
  // E2 : `scenarioState.vortex` est plat (paramètres immuables partagés + compteurs) : copie superficielle suffisante.
  cloneState: s => {
    const v = s[VORTEX_STATE_KEY]
    return v && typeof v === 'object' ? { ...s, [VORTEX_STATE_KEY]: { ...(v as object) } } : { ...s }
  },
  // TODO(WP3) : onFightStart (timeline 'average'), onRoundStart (vagues), onTurnStart (horloge des morts),
  // onDeath, checkEnd (victoire à la mort du Vortex), canBeDamaged (invulnérabilité d'arrivée).
}

function createVortexFight(engine: Engine, team: Fighter[], o: FightSetupOptions): FightState {
  const map = engine.data.map(VORTEX_MAP_ID)
  if (!map) throw new Error(`Carte du Vortex ${VORTEX_MAP_ID} absente des données`)
  const p = vortexParams(o.params)
  const placement = o.placement ?? RED_CELLS_SAFE_K4.slice(0, team.length)
  team.forEach((f, i) => {
    f.team = 0
    f.cell = placement[i] ?? RED_CELLS_SAFE_K4[i % RED_CELLS_SAFE_K4.length]
  })
  const wave1 = waveComposition(p.players)[0]
  const free = BLUE_START_CELLS.filter(c => c !== p.vortexCell)
  const monsters = wave1.map((monsterId, i) => {
    const boss = monsterId === VORTEX
    const m = createMonsterFighter(engine.data, {
      monsterId,
      grade: boss ? p.bossGrade : p.monsterGrade,
      team: 1,
      cell: boss ? p.vortexCell : free[i % free.length],
    })
    m.wave = 1
    return m
  })
  const fight = engine.createFight({
    map,
    fighters: [...team, ...monsters],
    options: { seed: o.seed, rollMode: o.rollMode, record: o.record, maxRounds: p.maxRounds, rngRekey: o.rngRekey },
    scenarioId: VORTEX_SCENARIO_ID,
  })
  fight.scenarioState[VORTEX_STATE_KEY] = { ...p }
  // TODO(WP3) : sorts de départ (castStartingSpell : Vortexiphan 5006 → Auroraire, Glyphe téléporteur 5002).
  return fight
}

/** Modèle stratégique du Vortex (BOUCHON S0 : ne publie rien). TODO(WP3) : model.ts (§12.5-§12.10). */
function vortexAIModel(_params: ScenarioParams): ScenarioAIModel {
  return {
    id: VORTEX_SCENARIO_ID,
    update(_view, bb) {
      bb.phase = 'waveCycle'
    },
    roleNeeds: () => ({ ...VORTEX_ROLE_NEEDS }),
  }
}

/** Résumé (BOUCHON S0 : victoire, tours, monstres corrompus comptés sur l'état 6611). TODO(WP3) : progression §15.2. */
function summarizeVortex(fight: FightState): ScenarioSummary {
  const win = fight.ended && fight.winner === 0
  const corrupted = fight.fighters.filter(f => f.team === 1 && f.states.includes(CORRUPTED)).length
  const vortex = fight.fighters.find(f => f.monsterId === VORTEX)
  return {
    win,
    rounds: fight.round,
    endReason: fight.endReason ?? '',
    failReason: win ? undefined : fight.round >= fight.options.maxRounds ? 'limite de tours' : 'défaite',
    progress: win ? 1 : 0,
    corruptedByRound: [corrupted],
    hoursUsed: 0,
    vortexHpPct: vortex ? vortex.hp / Math.max(1, vortex.maxHp) : undefined,
  }
}

export const vortexScenario: DungeonScenario = {
  id: VORTEX_SCENARIO_ID,
  mapId: VORTEX_MAP_ID,
  defaultParams: { ...VORTEX_DEFAULT_PARAMS },
  uncertain: [...VORTEX_UNCERTAIN],
  hooks: vortexHooks,
  createFight: createVortexFight,
  aiModel: params => vortexAIModel(params),
  micro: {}, // TODO(WP3) : prefix12, phase2, poutch (micro.ts)
  summarize: summarizeVortex,
}
