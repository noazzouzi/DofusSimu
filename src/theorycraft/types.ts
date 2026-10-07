/**
 * Theorycraft contre un boss — types partagés (docs/design/theorycraft.md).
 *
 * Module PUR : aucun import `node:`, aucun import de src/dungeons/vortex ni de src/dungeons/generic/dummy. Les accès
 * fichiers (dungeons.json, fiches data/bosses/*.json) passent par src/theorycraft/node.ts.
 *
 * Conventions : éléments indexés [Neutre, Terre, Feu, Eau, Air] (= `Element` de src/core/types) ; pourcentages en
 * points (25 = 25 %) ; dégâts en espérance (critique pondéré) ; « soutenu » = moyenne par tour avec relances amorties,
 * « rafale » = meilleur tour isolé (sac à dos sur les PA, relances ignorées).
 */
import type { Stats } from '../core/types'

/** Valeurs par élément, dans l'ordre [Neutre, Terre, Feu, Eau, Air]. */
export type PerElement = [number, number, number, number, number]

// ---------------------------------------------------------------------------------------------------------------------
// Index des boss (bosses.ts)
// ---------------------------------------------------------------------------------------------------------------------

/** Donjon réduit aux champs utiles (lu dans dungeons.json par l'adaptateur Node). */
export interface DungeonLite {
  id: number
  name: string
  optimalPlayerLevel: number
  minLevel?: number
  difficulty?: number
  /** `bosses[]` du donjon (peut être vide). */
  bossIds: number[]
  /** Tous les monstres du donjon (sans répartition par salle). */
  monsterIds: number[]
  /** Donjon « Expédition » (difficulté 0, niveau 200, sans `bosses[]`). */
  isExpedition: boolean
}

export interface DungeonSource {
  dungeons(): readonly DungeonLite[]
}

export interface BossEntry {
  monsterId: number
  name: string
  /** Donjons où il est boss (fusion des doublons). */
  dungeons: { id: number; name: string; level: number; isExpedition: boolean }[]
  /** Niveau du boss au grade 1 (peut différer du niveau du donjon). */
  bossLevel: number
  gradeCount: number
  isExpedition: boolean
  /** `bosses` = listé par dungeons.json[].bosses ; `isBoss` = repli sur le drapeau du monstre. */
  source: 'bosses' | 'isBoss'
}

// ---------------------------------------------------------------------------------------------------------------------
// Fiches manuelles (overrides.ts) — data/bosses/<monsterId>.json
// ---------------------------------------------------------------------------------------------------------------------

export type MechanicKind =
  | 'invulnerable'
  | 'invulnerable-melee'
  | 'invulnerable-range'
  | 'reduced-range'
  | 'reduced-melee'
  | 'damage-taken'
  | 'final-damage'
  | 'res-change'
  | 'extreme-res'
  | 'reflect'
  | 'erosion'
  | 'hp-based-damage'
  | 'ap-mp-removal'
  | 'range-removal'
  | 'punished-removal'
  | 'pacifist'
  | 'incurable'
  | 'cant-be-moved'
  | 'push-resource'
  | 'summons'
  | 'boss-heal'
  | 'boss-shield'
  | 'marks'
  | 'phases'
  | 'mp-cost'
  | 'other'

/** Utilités de classe qu'une mécanique rend utiles (`+`) ou inutiles (`-`) — clés de `ClassUtilities`. */
export type UtilityTag =
  | 'melee'
  | 'range'
  | 'zone'
  | 'burst'
  | 'indirect-damage'
  | 'mp-removal'
  | 'ap-removal'
  | 'range-removal'
  | 'heal'
  | 'shield'
  | 'damage-reduction'
  | 'placement'
  | 'push-damage'
  | 'summons'
  | 'debuff'
  | 'erosion'
  | 'ally-ap-mp'
  | 'ally-damage'
  | 'damage-taken-debuff'
  | 'dodge'
  | 'multi-element'

export interface BossPhaseOverride {
  id: string
  name: string
  /** États du boss qui définissent la phase (disponibilité de ses sorts). */
  states: number[]
  /** Part du combat passée dans cette phase (normalisée sur les phases). */
  weight: number
  /** Résistances effectives imposées dans cette phase (sinon celles du grade). */
  resPct?: PerElement | null
  /** Le boss est-il attaquable dans cette phase ? (`melee`/`range` : seulement de ce type). */
  vulnerable?: boolean | 'melee' | 'range'
  notes?: string
}

export interface BossMechanicNote {
  kind: MechanicKind
  summary: string
  /** Utilités qui répondent à la mécanique (ex. `melee` contre une invulnérabilité à distance). */
  counters?: UtilityTag[]
  /** Utilités neutralisées ou punies par la mécanique. */
  punishes?: UtilityTag[]
}

export interface BossOverrides {
  version: 1
  monsterId: number
  name?: string
  /** URL + date de consultation ; jamais de texte copié d'une source dont les CGU l'interdisent. */
  sources?: { url: string; date?: string; patch?: string }[]
  updatedAt?: string
  /** Version du jeu décrite par la fiche (ex. « 3.7 »). */
  patch?: string
  /** Résistances effectives imposées (toutes phases), ex. Kimbo 400 % → valeur après mécanique. */
  resPct?: PerElement
  /** Statistiques imposées au boss cible (ex. `rangedResPct: 50` pour « −50 % à distance »). */
  stats?: Partial<Stats>
  phases?: BossPhaseOverride[]
  /** Monstres qui accompagnent le boss (salle du boss), pour les dégâts reçus et la valeur des zones. */
  adds?: { monsterId: number; grade?: number; count: number }[]
  /** Sorts du boss à ignorer (non lancés en pratique) ou positionnels (à part). */
  excludeSpells?: number[]
  positionalSpells?: number[]
  mechanics?: BossMechanicNote[]
  notes?: string
}

// ---------------------------------------------------------------------------------------------------------------------
// Fiche du boss (bossProfile.ts)
// ---------------------------------------------------------------------------------------------------------------------

export type BossSpellFlag =
  | 'hp-based'
  | 'delayed'
  | 'triggered'
  | 'positional'
  | 'ring-excludes-target'
  | 'summon'
  | 'mark'
  | 'sub-spell'
  | 'excluded'

export interface BossSpellProfile {
  spellId: number
  name: string
  apCost: number
  castsPerTurn: number
  castsPerTarget: number
  cooldown: number
  /** États du lanceur exigés (forme normale disjonctive simplifiée : premier groupe). */
  requiredStates: number[]
  /** Dégâts moyens par lancer contre 0 % de résistance, par élément (critique pondéré, sous-sorts compris). */
  damageByElement: PerElement
  /** Dégâts hors élément (fixes, % de PV de référence) par lancer. */
  otherDamage: number
  flags: BossSpellFlag[]
}

export interface BossPhaseProfile {
  id: string
  name: string
  states: number[]
  weight: number
  /** Résistances effectives du boss dans la phase. */
  resPct: PerElement
  vulnerable: boolean | 'melee' | 'range'
  /** Sorts disponibles dans la phase. */
  spellIds: number[]
  /** Pic par tour (sac à dos sur les PA, une cible) et moyenne soutenue (relances amorties). */
  peakPerTurn: number
  sustainedPerTurn: number
  /** Répartition des dégâts soutenus par élément (somme = 1 si des dégâts existent). */
  elementShares: PerElement
}

export interface BossMechanic {
  kind: MechanicKind
  summary: string
  /** Origine : données DofusDB (sort de départ, sorts, états) ou fiche manuelle. */
  source: 'data' | 'overrides'
  stateId?: number
  spellId?: number
  counters?: UtilityTag[]
  punishes?: UtilityTag[]
}

export interface BossProfile {
  monsterId: number
  name: string
  grade: number
  /** Nombre de joueurs supposé (si le grade en est déduit). */
  players?: number
  level: number
  hp: number
  ap: number
  mp: number
  /** Résistances du grade (données) et effectives (après sort de départ et fiche manuelle). */
  rawResPct: PerElement
  resPct: PerElement
  /** Statistiques complètes du boss cible (dérivées de createMonsterFighter, puis surcharges). */
  stats: Stats
  /** Éléments du plus faible au plus fort (résistance effective croissante). */
  weakestElements: number[]
  apParry: number
  mpParry: number
  tackle: number
  phases: BossPhaseProfile[]
  spells: BossSpellProfile[]
  mechanics: BossMechanic[]
  /** Répartition élémentaire des dégâts reçus, pondérée par les phases. */
  incomingShares: PerElement
  warnings: string[]
  /** Hypothèses affichées (grade, joueurs, adds, phases supposées…). */
  assumptions: string[]
  /** Fiche manuelle appliquée, le cas échéant. */
  overrides?: BossOverrides
}

// ---------------------------------------------------------------------------------------------------------------------
// DPT soutenu (rotation.ts)
// ---------------------------------------------------------------------------------------------------------------------

export interface SustainedDamage {
  /** Dégâts attendus de chaque tour simulé (relances et lancers tenus d'un tour à l'autre). */
  perTurn: number[]
  /** Moyenne des tours (DPT soutenu). */
  mean: number
  /** Meilleur tour isolé (rafale, relances ignorées). */
  burst: number
  /** Sorts lancés à chaque tour (ids). */
  casts: number[][]
}
