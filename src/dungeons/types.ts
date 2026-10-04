/**
 * Contrats des scénarios de donjon (docs/design/ai.md §5.2, §12) — WP3, GELÉ en S0 (J3).
 * Toute modification passe par une revue des quatre responsables de lot (§18.1).
 *
 * Un scénario fournit (1) les règles « serveur » absentes des données sous forme de `ScenarioHooks` du moteur, (2) la
 * mise en place d'un combat, (3) le modèle stratégique `ScenarioAIModel` consommé par l'IA de groupe (WP2), (4) des
 * micro-scénarios et un résumé de combat consommés par l'optimiseur (WP4). Valeurs en PVe.
 */
import type {
  AIMode,
  AIView,
  Blackboard,
  Intent,
  Perception,
  ReferenceTargets,
  RoleId,
  StrategyParams,
} from '../ai/types'
import type { Engine } from '../engine/engine'
import type { Fighter, FightState, RollMode, ScenarioHooks } from '../engine/types'

// ───────────────────────────── paramètres et variantes ─────────────────────────────

/** Paramètres d'un scénario (plats, immuables ; stockés dans `fight.scenarioState`). */
export type ScenarioParams = Readonly<Record<string, number | string | boolean | readonly number[]>>
/** Règle INCERTAINE : valeurs possibles (la première = défaut) et poids de tirage (somme 1). */
export interface UncertainParam { key: string; values: (number | string | boolean | number[])[]; weights: number[] }

/** Micro-scénarios (§12.11). */
export type MicroId = 'prefix12' | 'phase2' | 'poutch'

export interface FightSetupOptions {
  params: ScenarioParams
  seed: number
  /** Cases de départ des personnages (dans l'ordre de `team`) ; défaut : choix du scénario. */
  placement?: number[]
  rollMode: RollMode
  record: boolean
  rngRekey: 'none' | 'perTurn'
}

export interface DungeonScenario {
  id: string; mapId: number
  defaultParams: ScenarioParams; uncertain: UncertainParam[]
  /** Les hooks lisent les paramètres dans fight.scenarioState (une seule instance Engine pour toutes les variantes). */
  hooks: ScenarioHooks
  /** Crée le combat sur `engine` (construit avec `hooks`) : carte, placement, monstres, sorts de départ. */
  createFight(engine: Engine, team: Fighter[], o: FightSetupOptions): FightState
  aiModel(params: ScenarioParams, theta: StrategyParams): ScenarioAIModel
  /** 'prefix12', 'phase2', 'poutch' (sous-ensemble selon le scénario). */
  micro: Partial<Record<MicroId, MicroScenario>>
  summarize(fight: FightState): ScenarioSummary
}

// ───────────────────────────── contrat scénario (WP3) ↔ IA de groupe (WP2) ─────────────────────────────

/** Contrat entre le scénario (WP3) et l'IA de groupe (WP2). Toutes les valeurs sont en PVe. */
export interface ScenarioAIModel {
  id: string
  /** Début du tour de chaque joueur : phase, plan (horizon glissant), prix et intentions du combattant courant. */
  update(view: AIView, bb: Blackboard, perception: Perception, mode: AIMode): void
  /** Remplace v_e. */
  damageWeight?(e: Fighter, bb: Blackboard): number | undefined
  deathValue?(root: FightState, leaf: FightState, victim: Fighter, bb: Blackboard): number | undefined
  /** Lignes de l'Auroraire, Heurage… */
  extraIncoming?(s: FightState, a: Fighter, cell: number): number
  /** Vague invulnérable, Vortex Marginal. */
  vulnerableAt?(s: FightState, e: Fighter, roundOffset: number): boolean
  /** Mort qui casse le cycle d'horloge. */
  allyDeathExtra?(s: FightState, a: Fighter): number
  hints?(view: AIView, me: Fighter, bb: Blackboard): CandidateHint[]
  isKeyDecision?(view: AIView, bb: Blackboard): KeyDecisionReason | null
  choosePlacement?(team: Fighter[], perception: Perception, budget: 'analytic' | 'simulated'): number[]
  /**
   * Ajout S0 (§9.2) : vecteur de besoins en rôles publié par le scénario (Vortex : killer 2, mpLock 1, zoneDps 1,
   * placer 0,5, healer 0,5, tank 0,5) ; absent = besoins génériques du `GenericModel`.
   */
  roleNeeds?(): Partial<Record<RoleId, number>>
  /** Ajout S0 (§9.2, §15.4) : cibles de référence (mix pondéré) pour `capabilities` et le DPT des rôles. */
  referenceTargets?(view: AIView): ReferenceTargets
}
export interface CandidateHint { kind: 'glyph' | 'kill' | 'avoidCells' | 'reachCell'; cells?: number[]; targetId?: number; weight: number }
export type KeyDecisionReason = 'corruptionKill' | 'allyDeathRisk' | 'closeCall' | 'burst' | 'waveArrival' | 'phaseChange'

// ───────────────────────────── micro-scénarios et résumé ─────────────────────────────

/** Résultat d'un micro-scénario (§12.11). */
export interface MicroResult {
  /** P(victoire) estimée (prefix12 : régression logistique calibrée ; phase2 : 1 si le Vortex meurt). */
  pWin: number
  /** Note de progression [0, 1]. */
  progress: number
  rounds: number
  deaths: number
  hpLeftPct: number
  /** Mesures propres au micro-scénario (ex. dptByFighter pour `poutch`, corrupted, spawned). */
  metrics: Record<string, number>
}

export interface MicroScenario {
  id: MicroId
  description: string
  /** Tours de jeu simulés (borne). */
  maxRounds: number
  createFight(engine: Engine, team: Fighter[], o: FightSetupOptions): FightState
  /** Arrêt anticipé (ex. fin du tour 12 pour `prefix12`). */
  done(fight: FightState): boolean
  evaluate(fight: FightState): MicroResult
}

/** Résumé d'un combat calculé par le scénario (champs propres au scénario de `FightSummary`, src/optimizer/types.ts). */
export interface ScenarioSummary {
  win: boolean
  rounds: number
  endReason: string
  /** Cause d'échec regroupée (§15.2), absente en cas de victoire. */
  failReason?: string
  /** Progression [0, 1] (§15.2) : utile tant que le taux de victoire est nul. */
  progress: number
  /** Nombre cumulé de monstres corrompus à la fin de chaque tour de jeu (index 0 = tour 1). */
  corruptedByRound: number[]
  /** Heures distinctes posées (bonus hérités par le Vortex). */
  hoursUsed: number
  phase2Rounds?: number
  vortexHpPct?: number
  /** Mesures libres du scénario (rapport). */
  extra?: Record<string, number>
}

// ───────────────────────────── horloge, suivi, plan (Vortex, §12.2-§12.9) ─────────────────────────────

/** Créneau de la timeline avec l'heure de l'Auroraire pendant ce créneau (§12.2 `forecastHours`). */
export interface ClockSlot { round: number; index: number; fighterId: number; isPlayer: boolean; isVortex: boolean; hour: number }

/** Suivi d'un monstre de vague (tracker, §12.3) ; `hours` = masque 12 bits (bit h−1 = tué à l'heure h). */
export interface MonsterTrack { fighterId: number; monsterId: number; wave: number
  status: 'pending' | 'invulnerable' | 'alive' | 'dead' | 'corrupt'; hp: number; maxHp: number
  hours: number; star: boolean; arrivesRound?: number; threat: number }

/** Action abstraite d'un créneau joueur du planificateur (§12.3). */
export type AbsAction = { t: 'none' } | { t: 'glyph'; count: 1 | 2 }
  | { t: 'kill'; m: number[]; glyph: 'none' | 'before' | 'after' }                 // 1 ou 2 morts
  | { t: 'damage'; m: number; amount: number; glyph: 'none' | 'before' | 'after' } // plafonné à PV − 1

/** Pas d'un plan : action abstraite prévue au créneau (round, index) d'un joueur. */
export interface PlanStep { round: number; index: number; fighterId: number; hour: number; action: AbsAction
  /** Score cumulé du plan après ce pas (PVe). */
  score: number }

/** Sortie du `HourPlanner` (§12.5), publiée dans `Blackboard.plan`. */
export interface ScenarioPlan { version: number; steps: PlanStep[]; alternatives: PlanStep[][]
  contracts: { m: number; round: number; index: number; killer: number; kind: 'mark' | 'corrupt'; hour: number; pKill: number }[]
  forbid: { m: number; untilRound: number; reason: 'badHour' | 'noFollowUp' | 'waveSync' }[]
  glyphs: { round: number; index: number; count: 1 | 2; when: 'beforeKills' | 'afterKills' }[]
  bands: { m: number; beforeKiller: number; hpMin: number; hpMax: number }[]
  rootScores: Map<string, number>; etaAllCorrupted: number }

/** Plan de burst de phase 2 (§12.9). */
export interface BurstPlan { vulnerableFrom: { round: number; index: number }; prepSlots: { round: number; index: number }[]
  steps: { fighterId: number; intents: Intent[] }[]; reserve: { fighterId: number; spellId: number }[]
  safeCells(round: number, index: number): Uint8Array; pKill: number }
