/**
 * Scénario générique « mannequin » (docs/design/ai.md §12.11 `poutch`, §16.5) — WP3 : un mannequin d'entraînement
 * immobile et passif (`ai: 'pass'`, aucun sort, PV énormes) pour mesurer les dégâts d'une équipe (calibration DPT,
 * contrôle « dégâts = calculateur ± 1 % »).
 *
 * Paramètres (plats) : `mapId` (défaut : carte de l'escarmouche), `dummyMonsterId` (Poutch Ingball 494), `dummyGrade`
 * (5), `dummyHp` (1 000 000), `resMix` ('vortex' = résistances moyennes du mix de cibles du Vortex, pondérées comme le
 * proxy de stuff §15.4 : Ikargn 3, Méjaire 4, Harpille 4, Buboxor 3, Brabuzar 5, Vortex 0,3 × 19 ; 'none' = 0 %),
 * `resPct` ([neutre, terre, feu, eau, air], prioritaire s'il est fourni), `dummyCell`, `playerCells`, `maxRounds` (3).
 * Fin de combat : règle par défaut du moteur (mannequin mort ⇒ victoire) ou limite de tours.
 */
import type { StrategyParams } from '../../ai/types'
import { createGenericModel } from '../../ai/team/genericModel'
import { ELEMENT_KEYS, type StatKey } from '../../core/types'
import type { DataStore } from '../../data/store'
import type { Engine } from '../../engine/engine'
import { createMonsterFighter } from '../../engine/factory'
import type { Fighter, FightState, ScenarioHooks } from '../../engine/types'
import type { DungeonScenario, FightSetupOptions, ScenarioParams, ScenarioSummary } from '../types'
import { BRABUZAR, BUBOXOR, HARPILLE, IKARGN, MEJAIRE, VORTEX } from '../vortex/constants'
import { createGenericFight, SKIRMISH_DEFAULT_MAP } from './skirmish'

export const DUMMY_SCENARIO_ID = 'dummy'
/** Poutch Ingball (grade 5 : 10 000 PV, 0 PA). */
export const POUTCH = 494

export interface DummyParams {
  mapId: number
  dummyMonsterId: number
  dummyGrade: number
  dummyHp: number
  resMix: 'vortex' | 'none'
  resPct: readonly number[]
  dummyCell: number
  playerCells: readonly number[]
  maxRounds: number
}

export const DUMMY_DEFAULT_PARAMS: Readonly<DummyParams> = {
  mapId: SKIRMISH_DEFAULT_MAP,
  dummyMonsterId: POUTCH,
  dummyGrade: 5,
  dummyHp: 1_000_000,
  resMix: 'vortex',
  resPct: [],
  dummyCell: -1,
  playerCells: [],
  maxRounds: 3,
}

/** Pondération du mix de cibles du Vortex (§15.4 : monstres à 4 joueurs, Vortex 0,3 × 19). */
export const VORTEX_TARGET_MIX: readonly { monsterId: number; weight: number }[] = [
  { monsterId: IKARGN, weight: 3 },
  { monsterId: MEJAIRE, weight: 4 },
  { monsterId: HARPILLE, weight: 4 },
  { monsterId: BUBOXOR, weight: 3 },
  { monsterId: BRABUZAR, weight: 5 },
  { monsterId: VORTEX, weight: 0.3 * 19 },
]

const RES_KEYS: readonly StatKey[] = ELEMENT_KEYS.map(k => `${k}ResPct` as StatKey)

/** Résistances % moyennes (neutre, terre, feu, eau, air) d'un mix pondéré de monstres au grade donné. */
export function mixResistances(data: DataStore, mix: readonly { monsterId: number; weight: number }[], grade = 5): number[] {
  const out = [0, 0, 0, 0, 0]
  let w = 0
  for (const { monsterId, weight } of mix) {
    const m = data.monster(monsterId)
    const g = m?.grades.find(x => x.grade === grade) ?? m?.grades[m.grades.length - 1]
    if (!g) continue
    RES_KEYS.forEach((k, i) => (out[i] += weight * ((g.stats as Partial<Record<StatKey, number>>)[k] ?? 0)))
    w += weight
  }
  return out.map(v => (w ? Math.round((v / w) * 10) / 10 : 0))
}

export function resolveDummyParams(params: ScenarioParams | Partial<DummyParams> = {}): DummyParams {
  const r = params as Record<string, unknown>
  const d = DUMMY_DEFAULT_PARAMS
  const n = (k: keyof DummyParams, def: number) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : def)
  const arr = (k: keyof DummyParams, def: readonly number[]) => (Array.isArray(r[k]) && (r[k] as unknown[]).every(x => typeof x === 'number') ? (r[k] as number[]).slice() : def.slice())
  return {
    mapId: n('mapId', d.mapId),
    dummyMonsterId: n('dummyMonsterId', d.dummyMonsterId),
    dummyGrade: n('dummyGrade', d.dummyGrade),
    dummyHp: Math.max(1, n('dummyHp', d.dummyHp)),
    resMix: r.resMix === 'none' ? 'none' : 'vortex',
    resPct: arr('resPct', d.resPct),
    dummyCell: n('dummyCell', d.dummyCell),
    playerCells: arr('playerCells', d.playerCells),
    maxRounds: Math.max(1, n('maxRounds', d.maxRounds)),
  }
}

/** Crée le mannequin (passif, sans sort, PV et résistances imposés). */
export function createDummyFighter(data: DataStore, p: DummyParams): Fighter {
  const f = createMonsterFighter(data, { monsterId: p.dummyMonsterId, grade: p.dummyGrade, team: 1, ai: 'pass' })
  const res = p.resPct.length === 5 ? p.resPct.slice() : p.resMix === 'vortex' ? mixResistances(data, VORTEX_TARGET_MIX) : [0, 0, 0, 0, 0]
  RES_KEYS.forEach((k, i) => {
    f.baseStats[k] = res[i]
    f.stats[k] = res[i]
  })
  f.baseStats.ap = 0
  f.baseStats.mp = 0
  f.spells = []
  f.hp = f.maxHp = f.baseMaxHp = Math.floor(p.dummyHp)
  f.name = `Mannequin (${f.name})`
  f.tags.dummy = true
  return f
}

export const dummyHooks: ScenarioHooks = {
  id: DUMMY_SCENARIO_ID,
  cloneState: s => ({ ...s }),
}

export function createDummyFight(engine: Engine, team: Fighter[], o: FightSetupOptions): FightState {
  const p = resolveDummyParams(o.params)
  const map = engine.data.map(p.mapId)
  if (!map) throw new Error(`Carte ${p.mapId} absente des données`)
  const dummy = createDummyFighter(engine.data, p)
  const fight = createGenericFight(engine, team, o, {
    map,
    monsters: [dummy],
    monsterCells: p.dummyCell >= 0 ? [p.dummyCell] : [],
    playerCells: p.playerCells,
    scenarioId: DUMMY_SCENARIO_ID,
    maxRounds: p.maxRounds,
    rule: 'best',
    startingSpells: false,
  })
  fight.scenarioState[DUMMY_SCENARIO_ID] = { dummyId: dummy.id, dummyHp: dummy.maxHp }
  return fight
}

/** Dégâts infligés au mannequin par chaque personnage (métriques du combat), et DPT moyen par tour de jeu. */
export function dummyDamage(fight: FightState): { byFighter: Record<number, number>; total: number; perRound: number } {
  const byFighter: Record<number, number> = {}
  let total = 0
  for (const f of fight.fighters) {
    if (f.team !== 0) continue
    const d = fight.metrics[f.id]?.damageDealt ?? 0
    byFighter[f.id] = d
    total += d
  }
  const rounds = Math.max(1, Math.min(fight.round, fight.options.maxRounds))
  return { byFighter, total, perRound: total / rounds }
}

export function summarizeDummy(fight: FightState): ScenarioSummary {
  const st = fight.scenarioState[DUMMY_SCENARIO_ID] as { dummyId: number; dummyHp: number } | undefined
  const dmg = dummyDamage(fight)
  const win = fight.ended && fight.winner === 0
  const extra: Record<string, number> = { totalDamage: dmg.total, damagePerRound: dmg.perRound }
  for (const [id, d] of Object.entries(dmg.byFighter)) extra[`damage_${id}`] = d
  return {
    win,
    rounds: Math.min(fight.round, fight.options.maxRounds),
    endReason: fight.endReason ?? '',
    failReason: win ? undefined : 'limite de tours',
    progress: st ? Math.min(1, dmg.total / Math.max(1, st.dummyHp)) : 0,
    corruptedByRound: [],
    hoursUsed: 0,
    extra,
  }
}

export const dummyScenario: DungeonScenario = {
  id: DUMMY_SCENARIO_ID,
  mapId: SKIRMISH_DEFAULT_MAP,
  defaultParams: { ...DUMMY_DEFAULT_PARAMS },
  uncertain: [],
  hooks: dummyHooks,
  createFight: createDummyFight,
  aiModel: (_params: ScenarioParams, theta: StrategyParams) => createGenericModel(theta),
  micro: {},
  summarize: summarizeDummy,
}
