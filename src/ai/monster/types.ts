/**
 * Types de l'IA des monstres (docs/design/ai.md §11, docs/research/monster-ai.md §3, §8) — WP1.
 *
 * Un monstre = un COMPORTEMENT de déplacement (`Behaviour`) + des CAPACITÉS qui ne changent que des poids + un
 * profil déclaratif optionnel (ordre des sorts, sorts d'ouverture, sorts « dès que prêts », valeurs d'états…) et des
 * hooks de boss (`MonsterHooks`). Les mécaniques elles-mêmes (sorts de départ, déclencheurs, phases par états) sont
 * dans les données et exécutées par le moteur : l'IA ne fait que CHOISIR parmi les sorts lançables.
 */
import type { Engine } from '../../engine/engine'
import type { Action, FightState, Fighter } from '../../engine/types'
import type { MacroAction } from '../types'
import type { MonsterContext } from './context'

/**
 * Comportement de déplacement (monster-ai.md §3) : `aggressive` (défaut), `fearful` (peureux / paniqué : agit puis
 * s'éloigne, R12/R13), `kiter` (« archer » : anneau de portée idéale), `devoted` (invocation de soutien : près de
 * l'invocateur), `blocker` (se colle au plus d'ennemis, R23), `mad` (fou : tout le monde est une cible), `apathetic`
 * (n'inflige rien, s'écarte), `support` (soigneur : à portée de soin des alliés, loin des ennemis), `static` (ne joue pas).
 */
export type Behaviour = 'aggressive' | 'fearful' | 'kiter' | 'devoted' | 'blocker' | 'mad' | 'apathetic' | 'support' | 'static'
export const BEHAVIOURS: readonly Behaviour[] = ['aggressive', 'fearful', 'kiter', 'devoted', 'blocker', 'mad', 'apathetic', 'support', 'static']

/** Archétype inféré des sorts (monster-ai.md §3, première règle vraie). */
export type Archetype = 'static' | 'apathetic' | 'summoner' | 'healer' | 'blocker' | 'fearful' | 'kiter' | 'aggressive'

/** Capacités (ne changent que des poids / priorités). */
export type Capability = 'summon' | 'heal' | 'buff' | 'kamikaze' | 'invisible'

/** Poids du score (PVe, §11.4). Les valeurs par défaut viennent de θ.monster ; les autres sont des constantes du design. */
export interface ScoreWeights {
  wDmg: number
  wKill: number
  /** κ : part des PV max d'un ennemi tué ajoutée au bonus de kill. */
  kappa: number
  wAP: number
  wMP: number
  wHeal: number
  /** Tir ami (× PV retirés à un allié). */
  wFF: number
  /** Allié tué : × PV max de l'allié (1,0). */
  wAllyKill: number
  /** v(e) d'une invocation ennemie (dégâts « entamés » seulement, le bonus de kill reste entier). */
  summonValue: number
  /** Malus supplémentaire × dommages renvoyés subis (R8). */
  reflectAversion: number
  /** Sous ce score, le monstre « passe » (après un kill notamment, §1.3). */
  minActionScore: number
  /** Poids du terme de position pendant le tour (cases de lancer). */
  positionDuringTurn: number
  /** Valeur d'un état « ne peut pas infliger de dommages » (Pacifiste) × menace de la cible. */
  pacifist: number
  /** Soin d'un allié ignoré au-dessus de cette part de PV (0,95) ; soin de soi d'un soigneur : 0,7. */
  healThreshold: number
  selfHealThreshold: number
  /** Gain minimal (PVe) d'un déplacement de fin de tour. */
  endMoveMinGain: number
}

/** Sort d'ouverture : joué en priorité dès qu'il est lançable et touche au moins `minTargets` ennemis. */
export interface Opener {
  spellId: number
  minTargets?: number
}

/** Profil déclaratif d'un monstre (monster-ai.md §7.3, §8.1). */
export interface MonsterAIProfile {
  behaviour: Behaviour
  capabilities?: Partial<Record<Capability, boolean>>
  weights?: Partial<ScoreWeights>
  /** Anneau de distance idéal (kiter) : [min, max]. */
  preferredRange?: readonly [number, number]
  /** Départage : ordre souhaité des sorts (premier = prioritaire). */
  castOrder?: readonly number[]
  openers?: readonly Opener[]
  /** Sorts « gratuits » joués dès qu'ils sont lançables (poison global, buffs d'équipe). */
  alwaysCastWhenReady?: readonly number[]
  forbidSpells?: readonly number[]
  /** Valeur des états posés sur un ennemi : 'targetThreat' = `pacifist` × menace de la cible, nombre = PVe fixes. */
  stateValue?: Readonly<Record<number, 'targetThreat' | number>>
  /** Sort de rapprochement (Envolupté) : seulement si aucun ennemi n'est atteignable en ligne à ≤ `lineRange` ce tour. */
  gapCloser?: { spellId: number; lineRange?: number }
  /** Buff de soi joué (obligatoire) quand aucun sort offensif n'atteint d'ennemi ce tour (Bouclier absorbant). */
  selfBuffWhenNoTarget?: number
  /** Les PM volés comptent comme mobilité de ce tour (Hoxor du Buboxor). */
  mpStealIsMobility?: boolean
  /** Sorts évalués avec 1 pas d'anticipation (valeur de la meilleure suite) — désactivé par défaut (R25). */
  lookahead?: readonly number[]
  hooks?: MonsterHooks
  /** Libellé (journal, replay). */
  note?: string
}

/** Hooks de boss / overrides de priorités (monster-ai.md §8.7). */
export interface MonsterHooks {
  /** Actions imposées en début de tour (après les effets TB), jouées si lançables. */
  beforeTurn?(ctx: MonsterContext): Action[]
  /** Candidats supplémentaires (sorts que la génération générique ne propose pas) : simulés hors quota. */
  extraCandidates?(ctx: MonsterContext): MacroAction[]
  /** Faux = candidat exclu. */
  filterCast?(ctx: MonsterContext, c: MonsterCandidate): boolean
  /** Ajuste le score simulé (`sim` = état après le candidat). */
  scoreCast?(ctx: MonsterContext, c: MonsterCandidate, base: number, sim: FightState): number
  /** Score additionnel d'une case de fin de tour. */
  endPosition?(ctx: MonsterContext, cell: number, s: FightState): number
  /**
   * Cases d'où ce monstre pourra frapper à son prochain tour en plus de son accessibilité (téléportation d'Heurage du
   * Vortex en phase 2) : pour la menace vue par les joueurs (src/ai/core/threat.ts, scénario).
   */
  threatOrigins?(engine: Engine, s: FightState, me: Fighter): number[]
}

/** Candidat d'un pas de tour : macro-action (déplacement puis lancer) + métadonnées du monstre. */
export interface MonsterCandidate extends MacroAction {
  /** Index du sort dans `me.spells` (−1 : aucun lancer). */
  spellIndex: number
  /** Case de lancer (fin du chemin, ou case actuelle). */
  from: number
  /** Raison d'un candidat obligatoire : 'opener', 'always', 'selfBuff', 'explore', 'hook', 'altCell'. */
  reason?: string
  /** Joué en priorité s'il est utile (ouverture, « dès que prêt », buff sans cible). */
  forced?: boolean
}

/** Décomposition du score d'un candidat (PVe, §11.4). */
export interface ScoreParts {
  damage: number
  kills: number
  removal: number
  states: number
  buffs: number
  nextHit: number
  dot: number
  heal: number
  friendly: number
  self: number
  summons: number
  position: number
  special: number
  total: number
  /** Le lancer a eu un effet négatif sur un ennemi (dégâts, retrait, état, poison) : bascule R12. */
  offensive: boolean
  /** Le lanceur meurt (R7) : score −∞. */
  casterDead: boolean
  /** Un ennemi visé n'a rien subi (invulnérable, résistances, renvoi) : condition R13. */
  blocked: boolean
}

/** Décision d'un pas : candidat retenu et son score simulé. */
export interface MonsterDecision {
  cand: MonsterCandidate
  score: number
  parts: ScoreParts
  /** Rang du candidat dans le préfiltre (0 = meilleur `prior`). */
  rank: number
  /** Nombre de candidats simulés pendant ce pas. */
  simulated: number
}

/** Statistiques d'un cerveau (bancs, tests). */
export interface MonsterBrainStats {
  turns: number
  steps: number
  simulations: number
  candidates: number
  casts: number
  moves: number
}
