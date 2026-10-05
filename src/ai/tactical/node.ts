/**
 * Types partagés de la couche tactique (docs/design/ai.md §8) — WP2 : contexte d'une recherche de tour, nœud du
 * faisceau, empreinte prévue d'une étape (exécuteur, §8.7) et plan enrichi renvoyé par `searchTurn`.
 *
 * Fichier de TYPES uniquement (aucune valeur exportée) : `turnSearch.ts`, `evaluate.ts`, `finalMove.ts`,
 * `rollout.ts`, `executor.ts` et les tactiques (`src/ai/tactics/**`) l'importent sans cycle d'exécution.
 */
import type { Rng } from '../../core/rng'
import type { SpellProfileX } from '../core'
import type { CandidateHint, ScenarioAIModel } from '../../dungeons/types'
import type { Controller } from '../../engine/runner'
import type { Fighter, FightState } from '../../engine/types'
import type {
  AIConfig, AIMode, AIRunStats, AIView, Blackboard, CandidateCat, CapabilityProfile, EvalBreakdown, MacroAction, NodeBudget,
  Perception, RoleId, TacticId, TurnBudget, TurnPlan,
} from '../types'

/** Proposeur de séquences (§10.2) — implémentations dans src/ai/tactics/**. */
export interface Tactic {
  id: TacticId
  /** Une fois par tour (profils des sorts du combattant, capacités) : la tactique est-elle à sa portée ? */
  requires(me: Fighter, profiles: readonly SpellProfileX[], caps?: CapabilityProfile): boolean
  /** O(µs) ; 0 = rien à proposer. */
  relevance(ctx: TacticalContext, node: SearchNode): number
  /** Séquences de 1 à 4 macro-actions (`MacroAction.seq`), marquées `tactic: id`. */
  propose(ctx: TacticalContext, node: SearchNode, limit: number): MacroAction[]
}

/** Événement de trace d'une recherche (tests, diagnostics) : n'influence aucune décision. */
export type SearchTrace =
  | { t: 'expand'; depth: number; key: string; v: number; tactic?: TacticId; cat: CandidateCat; mandatory: boolean }
  | { t: 'final'; keys: string[]; v: number; rolled: boolean }
  | { t: 'choice'; keys: string[]; v: number; pass: number }

/** Contexte d'une recherche de tour (propriété de WP2). */
export interface TacticalContext {
  view: AIView
  cfg: AIConfig
  budget: TurnBudget
  nodes: NodeBudget
  perception: Perception
  bb: Blackboard
  scenario?: ScenarioAIModel
  /** Décision clé (§8.8) : budget ×2 en standard, MCTS en deep. */
  isKey: boolean
  // ── ajouts WP2 (facultatifs) ──
  /** Mode effectif (défaut : `cfg.mode`). Les recherches imbriquées (rollouts) jouent en 'fast'. */
  mode?: AIMode
  /** Rôle principal du combattant (quotas, priors des tactiques, termes de fin de tour). */
  role?: RoleId
  /** Racine assainie (clone « vu par l'équipe ») ; construite par `searchTurn` si absente. */
  root?: FightState
  /** Indices de valeur publiés par le scénario (`ScenarioAIModel.hints`). */
  hints?: CandidateHint[]
  /** Tactiques disponibles pour ce combattant (filtrées par `requires`) ; défaut : toutes les v1. */
  tactics?: readonly Tactic[]
  /** Ablation : tactiques interdites (§16.5). */
  disabledTactics?: ReadonlySet<TacticId>
  /** Ablation « sorts non offensifs interdits » : seuls les candidats `damage` sont simulés (§16.5). */
  offensiveOnly?: boolean
  /** Rollouts désactivés (ablation, recherches imbriquées). */
  noRollouts?: boolean
  /** Générateur des départages et de l'exploration (flux « décisions IA », §13.1). */
  rng?: Rng
  /** Recherche imbriquée (tour d'un allié dans un rollout) : ni rollout, ni décision clé, ni tactique coûteuse. */
  nested?: boolean
  /** Statistiques à alimenter (nœuds, tactiques). */
  stats?: AIRunStats
  /** Trace de diagnostic (tests). */
  trace?: (ev: SearchTrace) => void
  /** Sorts réservés (intentions `reserve`) : exclus des candidats. */
  reserved?: ReadonlySet<number>
  /** Pénalité des cases réservées par les alliés (fin de tour, §9.3). */
  reservedCells?: ReadonlyMap<number, number>
  /** Contrôleurs des rollouts (§8.6) : ennemis (défaut : MonsterBrain 'predict'), invocations alliées (défaut : glouton). */
  predict?: (f: Fighter) => Controller
  allyPolicy?: (f: Fighter) => Controller
  /** Rôle d'un allié (tour `fast` d'un allié dans les rollouts). */
  roleOf?: (id: number) => RoleId | undefined
  /** Action que le rollout prête à l'allié suivant (cohérence, §9.3). */
  expect?: (allyId: number, key: string) => void
  /** Clé de la première action attendue de ce combattant par le rollout de l'allié précédent (+θ.team.coherenceBonus). */
  expectedKey?: string
  /** Renvoyer les meilleurs plans alternatifs (`SearchPlan.alternatives`, MCTS). */
  wantAlternatives?: number
  /** Tours de jeu consécutifs sans aucun dégât (anti-blocage du déplacement de fin, finalMove.ts). */
  stall?: number
}

/** Empreinte prévue après une macro-action (comparée à l'état réel par l'exécuteur, §8.7). */
export interface StepDigest {
  meCell: number
  meAp: number
  meMp: number
  /** Nombre de combattants (apparitions / invocations). */
  fighters: number
  /** ids vivants (ordre croissant). */
  alive: number[]
  /** PV (+ bouclier) prévus des combattants touchés par l'étape : [id, pv prévus, pv avant l'étape]. */
  hp: [number, number, number][]
  /** Empreinte symbolique du scénario (heure de l'Auroraire au Vortex), −1 si sans objet. */
  symbol: number
  /**
   * Autres combattants déplacés ou dont les PA/PM (caractéristiques) ont changé pendant l'étape : [id, case, PA, PM]
   * prévus (retrait de PM esquivé, poussée bloquée, portage…). Facultatif (empreintes construites à la main).
   */
  moved?: [number, number, number, number][]
}

/** Nœud du faisceau (§8.2). */
export interface SearchNode {
  s: FightState
  hash: bigint
  depth: number
  /** Macro-actions depuis la racine. */
  actions: MacroAction[]
  /** Valeur de classement (feuille non terminale, `continuation` comprise) + ajustement de split. */
  v: number
  breakdown?: EvalBreakdown
  /** Ajustement cumulé du split léthal (V mélangée − V de la branche suivie). */
  adj: number
  /** Un split léthal a déjà été appliqué sur ce chemin (au plus un, §6.7). */
  split: boolean
  tactics: TacticId[]
  cats: CandidateCat[]
  hasMandatory: boolean
  /** Empreintes prévues après chaque macro-action. */
  digests: StepDigest[]
}

/** Feuille terminale (déplacement de fin compris) comparée aux autres plans complets. */
export interface FinalLeaf {
  node: SearchNode
  /** État après le déplacement de fin (= node.s si « rester »). */
  s: FightState
  /** Déplacement de fin (chemin), absent si « rester ». */
  endPath?: number[]
  /** Valeur terminale (+ ajustement de split), puis mélange avec le rollout. */
  v: number
  vTerminal: number
  breakdown: EvalBreakdown
  rolled: boolean
  rollout?: number
  /** Première action prêtée par le rollout à l'allié suivant (cohérence, §9.3) ; publiée seulement si ce plan est retenu. */
  expect?: { allyId: number; key: string }
}

/** Plan enrichi (le contrat `TurnPlan` est gelé : champs ajoutés par extension). */
export interface SearchPlan extends TurnPlan {
  /** Empreintes prévues après chaque macro-action de `actions`. */
  digests: StepDigest[]
  /** Valeur absolue de la feuille retenue et de « ne rien lancer ». */
  leafV: number
  passV: number
  rootV: number
  /** Le plan contient un candidat obligatoire. */
  hasMandatory: boolean
  /** Raison de décision clé traitée (§8.8). */
  key?: string
  /** Meilleur plan « purement offensif » (marquage créatif, §10.3), en ΔV. */
  bestOffensive?: number
  /** Deux meilleurs plans à moins de 150 PVe avec des premières actions différentes (`closeCall`). */
  closeCall?: boolean
  /** Risque de mort maximal d'un allié sous le plan retenu (`allyDeathRisk`). */
  maxDeathRisk?: number
  /** Décomposition de V pour « ne rien lancer » (explications, marquage créatif). */
  passBreakdown?: EvalBreakdown
  /** Autres plans complets (premières actions distinctes) : racines du MCTS `deep` (§8.8). */
  alternatives?: SearchPlan[]
}
