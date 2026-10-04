/**
 * Contrats de l'optimiseur (docs/design/ai.md §5.3, §15) — WP4, GELÉ en S0 (J3).
 * Toute modification passe par une revue des quatre responsables de lot (§18.1).
 *
 * Un combat est décrit par une `FightSpec` (équipe, θ, mode, paramètres du scénario) et une graine ; il produit un
 * `FightSummary` (résumé seul : un combat choisi est rejoué avec `record: true`, §13.2). Les lots (`BatchResult`)
 * sont rangés par graine, indépendamment du nombre de workers.
 */
import type { AIMode, RoleId, StrategyParams, TacticId } from '../ai/types'
import type { DataBundle } from '../data/memory'
import type { MicroId, ScenarioParams } from '../dungeons/types'
import type { CharacterBuild } from '../stats/build'

export type { CharacterBuild } from '../stats/build'

/** Membre de l'équipe : classe, preset (data/ai/presets.json), build (src/stats), variantes des 22 paires de sorts. */
export interface MemberSpec { name: string; breedId: number; presetId: string; build: CharacterBuild; variants: (0 | 1)[]; role?: RoleId }

export interface FightSpec { scenarioId: string; team: MemberSpec[]; placement?: number[]; mode: AIMode
  theta: StrategyParams; params?: Partial<ScenarioParams>; variantPolicy: 'default' | 'sampled'; monsterNoise: number }

export interface FightSummary { seed: number; variant: string; win: boolean; rounds: number; endReason: string
  failReason?: string; deaths: number; hpLeftPct: number; damageTaken: number; progress: number; score: number
  corruptedByRound: number[]; hoursUsed: number; phase2Rounds?: number; vortexHpPct?: number; creativeActions: number
  tactics: Partial<Record<TacticId, number>>; spellUse: Record<number, number>; unknownEffects: number; nodes: number; eventsHash: number }

export interface BatchResult { n: number; wins: number; winRate: number; wilson95: [number, number]
  meanScore: number; meanRounds: number; p10HpLeft: number; byVariant: Record<string, { n: number; winRate: number }> }

/** Arrêt séquentiel d'un Monte-Carlo (§15.2). */
export interface StopRule { minN: number; maxN: number; halfWidth: number }

// ───────────────────────────── workers (§15.7) ─────────────────────────────

export interface WorkerTask { taskId: number; spec: FightSpec; seeds: number[]; kind: 'full' | MicroId | 't0'; record: false }
export interface WorkerResult { taskId: number; summaries: FightSummary[] }
export interface WorkerPool { size: number; run(tasks: WorkerTask[]): AsyncIterable<WorkerResult>; close(): Promise<void> }
/** Données transférées aux Web Workers (navigateur) : lot `MemoryDataStore`. */
export type WorkerDataBundle = DataBundle
