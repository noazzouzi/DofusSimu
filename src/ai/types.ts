/**
 * Contrats partagés de l'IA (docs/design/ai.md §5.1) — WP1, GELÉ en S0 (J3).
 * Toute modification passe par une revue des quatre responsables de lot (§18.1).
 *
 * Unité de valeur unique : le PVe (PV-équivalent, 1 = un point de vie d'un personnage allié).
 * Les interfaces du socle de perception (§6 : AIView, ReachInfo, SpellProfile, DptTable, ThreatModel, PotentialModel)
 * sont déclarées ici pour que WP2 (groupe), WP3 (scénario) et WP4 (optimiseur) codent contre elles pendant que WP1
 * les implémente dans src/ai/core/**.
 */
import type { TeamId } from '../core/types'
import type { SpellLevelData, StatesClause, ZoneSpec } from '../data/model'
import type { Engine } from '../engine/engine'
import type { Controller, ControllerProvider } from '../engine/runner'
import type { Action, Fighter, FightState, Trap } from '../engine/types'
import type { ThetaJson } from './theta'

export type { ThetaJson } from './theta'

// ───────────────────────────── modes, catégories, rôles, tactiques ─────────────────────────────

/** Mode de l'IA des joueurs (§8.3). L'IA des monstres est la même dans tous les modes (§11.1). */
export type AIMode = 'scripted' | 'fast' | 'standard' | 'deep'
/** Catégorie d'un candidat (quotas de simulation, §8.1). */
export type CandidateCat = 'damage' | 'control' | 'placement' | 'heal' | 'buff' | 'summon' | 'mark' | 'utility'
/** Rôles inférés (§9.2). */
export type RoleId = 'killer' | 'zoneDps' | 'mpLock' | 'apLock' | 'placer' | 'tank' | 'healer' | 'support' | 'summoner'
/** Tactiques proposeuses (§10) : les 8 premières en v1, les 8 suivantes en v2. */
export type TacticId = 'stateChain' | 'mpLock' | 'carryThrow' | 'glyphClock' | 'healCleanse' | 'bodyBlock'
  | 'groupForZone' | 'burstSetup' | 'apLock' | 'tackleTrap' | 'pushCollision' | 'losShield' | 'lineDodge'
  | 'corruptedWall' | 'baitSummon' | 'dispelAlly'

export const ROLE_IDS: readonly RoleId[] = ['killer', 'zoneDps', 'mpLock', 'apLock', 'placer', 'tank', 'healer', 'support', 'summoner']
export const CANDIDATE_CATS: readonly CandidateCat[] = ['damage', 'control', 'placement', 'heal', 'buff', 'summon', 'mark', 'utility']
export const TACTICS_V1: readonly TacticId[] = ['stateChain', 'mpLock', 'carryThrow', 'glyphClock', 'healCleanse', 'bodyBlock', 'groupForZone', 'burstSetup']

// ───────────────────────────── macro-actions et budgets ─────────────────────────────

/** Macro-action : déplacement optionnel PUIS lancer optionnel, ou séquence proposée par une tactique. */
export interface MacroAction {
  /** path[0] = case actuelle. */
  path?: number[]
  cast?: { spellId: number; cell: number }
  /** Séquence simulée d'un bloc (tactiques, macros de données). */
  seq?: MacroAction[]
  cat: CandidateCat
  /** Estimation analytique (PVe), tri et départage. */
  prior: number
  /** Simulé hors quota (kill sous contrat, levier d'horloge, intention). */
  mandatory?: boolean
  tactic?: TacticId
  /** Signature déterministe « spellId:cell:pathEnd » (départage, journal). */
  key: string
}

/** Actions moteur d'une macro-action, dans l'ordre (déplacement puis lancer ; séquences aplaties). */
export function toActions(m: MacroAction): Action[] {
  const out: Action[] = []
  const walk = (x: MacroAction) => {
    if (x.path && x.path.length > 1) out.push({ type: 'move', path: x.path })
    if (x.cast) out.push({ type: 'cast', spellId: x.cast.spellId, cell: x.cast.cell })
    if (x.seq) for (const s of x.seq) walk(s)
  }
  walk(m)
  return out
}

/** Budget d'un tour de joueur (§8.3, construit depuis θ.tactical selon le mode). */
export interface TurnBudget {
  maxNodes: number; width: number; topK: number; maxDepth: number; endCells: number
  rollouts: number; pessimism: number; keyDecisionBoost: number; maxKeyDecisions: number
  mctsIterations: number; maxReplans: number; replanFraction: number
  quotas: Record<CandidateCat, number>; mandatoryMax: number
}

/** Décomposition de V(s) (§7), en PVe ; `total` = somme pondérée des termes. */
export interface EvalBreakdown {
  total: number; enemyLife: number; kills: number; allyLife: number; erosion: number; allyDeath: number
  incoming: number; pendingDot: number; control: number; potential: number; continuation: number
  resources: number; position: number; scenario: number
}

// ───────────────────────────── couche stratégique → tactique ─────────────────────────────

/** Prix publiés par la couche stratégique pour le combattant courant (PVe). */
export interface PriceTable {
  /** kill.get(m)[0] = mort sous étoile (corruption) ; [h] (1..12) = mort pendant l'heure h ; absent = générique. */
  kill: Map<number, Float32Array>
  /** Valeur d'un PV retiré à m, et palier optionnel attendu par un allié suivant. */
  hp: Map<number, { slope: number; floor?: number; bandMin?: number; bandMax?: number; bandBonus?: number }>
  /** Valeur d'avancer l'horloge de k heures (glyphes) pendant ce tour, k = 0, 1, 2. */
  clock: [number, number, number]
  /** Valeur de finir le tour sur chaque case (sécurité de scénario) ; absent = 0. */
  cell?: Float32Array
}

export type IntentKind = 'control' | 'protect' | 'cleanse' | 'position' | 'setup' | 'reserve' | 'burst' | 'survive'
export interface Intent {
  id: string; kind: IntentKind; owner: number
  window: { fromRound: number; fromIndex: number; toRound: number; toIndex: number }
  target?: number; cells?: number[]; params?: Record<string, number>
  /** PVe si pleinement satisfaite. */
  price: number
  source: 'planner' | 'allocator' | 'burst' | 'emergency' | 'doctrine'
  /** Texte FR pour le replay. */
  explain: string
}

export type PhaseId = 'fight' | 'opening' | 'waveCycle' | 'waiting' | 'transition' | 'burst'
export interface RoleAssignment { primary: RoleId; secondary?: RoleId; scores: Record<RoleId, number> }
export interface Blackboard {
  version: number; round: number; phase: PhaseId; emergency: boolean
  roles: Map<number, RoleAssignment>
  /** Ennemis par priorité. */
  focus: number[]
  reservations: Map<number, { targetId: number; p: number; value: number; spellIds: number[] }>
  /** Prix pour le combattant courant. */
  prices: PriceTable
  /** Tous porteurs (attentes envers les alliés suivants). */
  intents: Intent[]
  /** Case → allié (fin de tour). */
  reservedCells: Map<number, number>
  /** ScenarioPlan opaque (WP3, src/dungeons/types.ts), lu par explain/rewind. */
  plan?: unknown
}

// ───────────────────────────── configuration ─────────────────────────────

/** Type généré depuis data/ai/theta-default.json (annexe A ; src/ai/theta.ts). */
export type StrategyParams = ThetaJson
/** Réglage de l'IA des monstres (§11.1). */
export type MonsterSetting = 'play' | 'predict' | 'reference'
export interface MonsterAIConfig { topK: number; predictTopK: number; noiseTau: number; referenceTopK: number }
export interface AIConfig {
  mode: AIMode; budget: TurnBudget; theta: StrategyParams; monster: MonsterAIConfig
  /** Graine IA dérivée de la graine de combat (§13). */
  seed: number
  explain: boolean; unsupportedSpells: 'skip' | 'allow'
}

/** Ce que le socle fournit aux couches supérieures et au scénario. */
export interface Perception {
  dpt: DptTable; threat: ThreatModel; potential: PotentialModel; profiles: SpellProfileIndex
  /** Recalcul incrémental (rev / empreinte par combattant). */
  sync(s: FightState): void
}

/** Statistiques d'IA d'un combat (alimentent `FightSummary`, src/optimizer/types.ts). */
export interface AIRunStats {
  /** Nœuds simulés (rollouts et splits compris). */
  nodes: number
  /** Plans marqués « créatifs » (§10.3). */
  creativeActions: number
  /** Usage des tactiques dans les plans retenus. */
  tactics: Partial<Record<TacticId, number>>
  /** Décisions clés traitées (§8.8). */
  keyDecisions: number
}

/**
 * Fournisseur de contrôleurs renvoyé par `createControllers` (src/ai/index.ts) : c'est un `ControllerProvider` du
 * moteur (utilisable tel quel par `runFight`), enrichi de l'accès aux statistiques et à l'état du `TeamBrain`
 * (données pures, rembobinage §15.8).
 */
export interface AIControllerProvider extends ControllerProvider {
  stats(): AIRunStats
  snapshot(): unknown
  restore(snapshot: unknown): void
}

/** Contrôleur d'un monstre (§11.2) : même cerveau en combat réel et dans les prévisions des joueurs. */
export interface MonsterController extends Controller {
  readonly setting: MonsterSetting
}

// ───────────────────────────── §6.1 vue honnête, ordre des tours ─────────────────────────────

/** Créneau à venir de la timeline (ordre public des prochains tours). */
export interface SlotForecast {
  /** Tour de jeu du créneau. */
  round: number
  /** Index du créneau dans la timeline de ce tour. */
  index: number
  fighterId: number
  team: TeamId
  /** Personnage joueur non invoqué (fait avancer l'horloge du Vortex). */
  isPlayer: boolean
  isSummon: boolean
  /** Le début de tour a lieu mais le combattant ne joue pas (tour annulé, cannotPlay, preventsFight). */
  passes: boolean
}

/** Vue « honnête » d'un combat pour une équipe (§6.1, §13.2 : l'IA ne lit ni `fight.events` ni les dés futurs). */
export interface AIView {
  readonly engine: Engine
  readonly fight: FightState
  readonly me: Fighter
  readonly team: TeamId
  /** Graine IA (`AIConfig.seed`) : sels des clones (`simClone`), jamais l'état réel des dés. Ajout S0. */
  readonly seed: number
  /** Invisibles adverses placés sur leur dernière case connue. */
  visible(): readonly Fighter[]
  /** Pièges invisibles adverses exclus. */
  knownTraps(): readonly Trap[]
  /** Ordre public des prochains tours. */
  upcoming(n: number): SlotForecast[]
}

// ───────────────────────────── §6.2 accessibilité ─────────────────────────────

/** Cases atteignables avec tacle (tableaux typés indexés par case, sauf `cells`/`count`). */
export interface ReachInfo {
  /** Cases atteignables (les `count` premières entrées). */
  cells: Int16Array
  count: number
  /** PM / PA restants en arrivant sur la case (−1 si non atteignable). */
  mpLeft: Float32Array
  apLeft: Float32Array
  /** Case précédente sur le meilleur chemin (−1 = départ / non atteignable). */
  prev: Int16Array
  /** 1 si le chemin traverse une case-événement admise (glyphe, piège connu). */
  viaEvent: Uint8Array
}

// ───────────────────────────── §6.3 profils de sorts ─────────────────────────────

export interface DamageLine {
  element: number; min: number; max: number; critMin: number; critMax: number
  zone: ZoneSpec; mask: string; lifeSteal: boolean; delayed: number; dotTurns: number
}
export type DisplacementKind = 'push' | 'pull' | 'teleport' | 'swap' | 'symmetric' | 'carry' | 'throw' | 'return'
export interface SpellProfile {
  spellId: number; apCost: number; minRange: number; maxRange: number; los: boolean; line: boolean; diagonal: boolean
  castsPerTurn: number; castsPerTarget: number; cooldown: number
  damage: DamageLine[]; apRemoval: number; mpRemoval: number; dodgeable: boolean
  displacement: { kind: DisplacementKind; cells: number }[]
  heal: number; shield: number; appliesStates: { stateId: number; on: 'self' | 'target' | 'zone'; duration: number }[]
  requiresStates?: StatesClause[]; summons: number[]; glyph: boolean; trap: boolean
  selfBuff: boolean; allyBuff: boolean; enemyDebuff: boolean; dispel: boolean
  /** Catégorie dominante (quotas). */
  cat: CandidateCat
  hasRandomGroups: boolean; hasTriggers: boolean
  /** Part de la valeur estimable sans simulation (< 0,7 ⇒ candidat d'exploration). */
  analyticCoverage: number
  /** Un effet sans interprète (E5, `isSpellSupported`) ⇒ exclu des candidats si unsupportedSpells = 'skip'. */
  unsupported: boolean
}
/** Index des profils (calculés une fois par `SpellLevelData`, normal et critique). */
export interface SpellProfileIndex {
  of(level: SpellLevelData, crit?: boolean): SpellProfile
  /** Profils des sorts connus d'un combattant (modificateurs de sorts appliqués), dans l'ordre de `f.spells`. */
  ofFighter(f: Fighter): readonly SpellProfile[]
}

// ───────────────────────────── §6.4-§6.7 DPT, menace, potentiel, kills ─────────────────────────────

/** Dégâts par tour analytiques calibrés (§6.4) ; cache par (a.id, a.rev, d.id, d.rev, ap). */
export interface DptTable {
  /** Espérance des dégâts de `a` sur `d` en un tour, sans contrainte de position, avec `ap` PA (défaut : prochain tour). */
  dpt(a: Fighter, d: Fighter, ap?: number): number
  /** Variance associée (kill.ts). */
  dptVariance(a: Fighter, d: Fighter, ap?: number): number
  /** Facteur de calibration appliqué à `a` (preset ou monstre), borné à [0,5 ; 2]. */
  calibration(a: Fighter): number
}

/** Menace ordonnée par la timeline (§6.5). */
export interface ThreatModel {
  /** Incrémental (rev / empreinte). */
  sync(s: FightState): void
  /** Dégâts attendus sur l'allié avant son prochain tour. */
  incoming(id: number): number
  /** Idem si f finissait sur `cell` (autres positions figées). */
  cellIncoming(f: Fighter, cell: number): number
  /** Φ((inc − hpEff) / (0,25·inc + 1)). */
  deathRisk(id: number): number
  /** Menace propre d'un ennemi (PVe par tour). */
  threatOf(e: Fighter): number
  predictedTarget(e: Fighter): number | undefined
}

/** Potentiel offensif au prochain tour (§6.6). */
export interface PotentialModel {
  sync(s: FightState): void
  /** Pot_a : meilleure valeur offensive de l'allié `id` à son prochain tour (PVe), 0 sous Pacifiste. */
  potential(id: number): number
  /** Ennemi qui réalise `potential(id)` (undefined si aucun). */
  bestTarget(id: number): number | undefined
}

/** Meilleur plan analytique de kill depuis `reach` (§6.7 `canKillNow`). */
export interface KillEstimate { p: number; apNeeded: number; spells: number[]; castCell: number }

/**
 * Split léthal (§6.7, `standard`/`deep`) : le lancer rejoué en `rollMode` 'min' et 'max'. `p` = probabilité de kill
 * (1 si 'min' tue, 0 si 'max' ne tue pas, sinon interpolation) ; `killed` / `survived` = états simulés retenus pour
 * V(tué) et V(survivant) (null si l'issue est impossible) ; `nodes` = nœuds consommés (à compter dans `NodeBudget`).
 * Valeur de la feuille = p·V(killed) + (1 − p)·V(survived).
 */
export interface LethalSplit { p: number; killed: FightState | null; survived: FightState | null; nodes: number }

/** Compteur de nœuds simulés (§6.8) : le budget est en nœuds, jamais en millisecondes. */
export interface NodeBudget {
  readonly max: number
  readonly used: number
  spend(n?: number): void
  exhausted(): boolean
  remaining(): number
}

// ───────────────────────────── §8, §9 sorties tactiques et capacités ─────────────────────────────

/** Plan d'un tour choisi par `TurnSearch` (§8.2). */
export interface TurnPlan {
  actions: MacroAction[]
  /** V(feuille finale) − V(racine) (PVe). */
  value: number
  breakdown?: EvalBreakdown
  nodes: number
  creative?: boolean
  tactics?: TacticId[]
  /** Annotations FR destinées au replay (`aiNote`). */
  notes?: string[]
}

/** Capacités d'un combattant contre les cibles de référence du scénario (§9.2). */
export interface CapabilityProfile { fighterId: number
  /** PVe/tour contre la cible de référence du scénario. */
  dptMono: number; dptZone3: number; burst1: number
  /** Points retirés attendus/tour (esquive de référence). */
  mpRemoval: number; apRemoval: number
  placement: number; heal: number; shield: number; cleanse: boolean; dispel: boolean; summons: number
  tackle: number; evade: number; ehp: number; maxRange: number; mobility: number; initiative: number }

/** Cibles de référence publiées par le scénario (mix pondéré : monstres de vague, boss…). */
export interface ReferenceTargets { targets: { fighter: Fighter; weight: number }[] }
