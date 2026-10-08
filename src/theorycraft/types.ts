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
import type { StatKey, Stats } from '../core/types'
import type { CharacterBuild } from '../stats/build'
import type { PrimaryStat } from '../stats/characteristicPoints'
import type { StuffSheet } from '../stats/sheet'

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
  /**
   * Moyenne des tours simulés, depuis un début de combat (sorts à relance prêts au tour 1) : dépend de l'horizon
   * (`turns`) et penche vers la rafale sur un horizon court.
   */
  mean: number
  /** Meilleur tour isolé (rafale, relances ignorées). */
  burst: number
  /** Sorts lancés à chaque tour (ids). */
  casts: number[][]
  /**
   * DPT soutenu en régime établi (relances amorties, indépendant de l'horizon) : moyenne d'une période de la rotation.
   * C'est le « soutenu » de ce contrat (en-tête) : la valeur à utiliser pour classer.
   */
  steady: number
  /** Période du régime établi en tours (0 : non trouvée dans le plafond de simulation, `steady` approché). */
  period: number
}

// ---------------------------------------------------------------------------------------------------------------------
// Stuff contre un boss (stuff.ts) — question (1), docs/design/theorycraft.md §1.7
// ---------------------------------------------------------------------------------------------------------------------

/** Élément principal d'un stuff (caractéristique principale : Force, Intelligence, Chance, Agilité). */
export type StuffElement = 'earth' | 'fire' | 'water' | 'air'

/**
 * Origine d'un stuff évalué : `start` = stuff du preset, point de départ de l'optimisation ; `user` = stuff de
 * l'utilisateur (build ou lien RoxxSolver), alors point de départ ; `preset` = stuff du preset quand le départ est le
 * stuff de l'utilisateur ; `generic` = stuff générique de data/ai/presets.json (hors stuffs de scénario `vortex_*`) ;
 * `optimized` = stuff produit par l'optimiseur.
 */
export type StuffOrigin = 'start' | 'preset' | 'generic' | 'user' | 'optimized'

/** Objet d'un stuff, prêt à afficher. */
export interface StuffItemLine {
  itemId: number
  name: string
  /** Emplacement (`EquipmentSlot`) et son libellé français. */
  slot: string
  slotLabel: string
  level: number
  /** Lignes de forgemagie (« 1 PA (exo) », « 1% Dommages aux sorts (transcendance) »…). */
  forge: string[]
  /** L'objet porte un sort passif (effet 1175 : Dofus Ocre, Vulbis…) que le proxy valorise à 0. */
  passive?: boolean
}

/** Contribution d'un sort au DPT soutenu (rotation retenue, phases du boss pondérées). */
export interface StuffSpellLine {
  spellId: number
  name: string
  apCost: number
  /** Lancers par tour en régime établi. */
  castsPerTurn: number
  /** Dégâts moyens d'un lancer (espérance, critique pondéré, résistances effectives du boss). */
  damagePerCast: number
  /** Dégâts par tour apportés par le sort (= lancers par tour × dégâts par lancer). */
  damagePerTurn: number
  /** Part du DPT soutenu (0..1). */
  share: number
}

/** Dégâts infligés au boss par un stuff. */
export interface StuffDamage {
  /**
   * DPT du proxy de stuff (objectif de l'optimiseur) : meilleur tour isolé (sac à dos sur les PA, relances ignorées)
   * × calibration du preset (mesurée au Vortex), sans posture de classe.
   */
  proxy: number
  /** DPT SOUTENU en régime établi (rotation.ts, relances amorties, meilleure posture, NON calibré) : valeur à comparer. */
  steady: number
  /** Rafale (un tour isolé, relances ignorées, même posture, non calibrée). */
  burst: number
  /** Posture de classe retenue (stances.ts ; « Sans posture » pour les classes qui n'en ont pas). */
  stance: { id: string; name: string }
  /** Période de la rotation établie (tours ; 0 = non trouvée, `steady` approché). */
  period: number
  /** Détail par sort de la rotation établie, du plus gros contributeur au plus petit. */
  spells: StuffSpellLine[]
}

/** Survie d'un stuff contre le boss. */
export interface StuffSurvival {
  hp: number
  /** PV effectifs du proxy : PV × (dégâts reçus sans défense / avec défenses), plafonnés à 20 × PV. */
  ehp: number
  /** Le plafond de 20 × PV est atteint (aucun dégât calculable, ou défenses saturées) : comparaison sans valeur. */
  capped: boolean
  /** Dégâts reçus par tour (évaluation exacte du proxy, phases et adds pondérés). */
  incoming: number
  /** Dégâts reçus par tour par élément [Neutre, Terre, Feu, Eau, Air] (forme fermée du proxy). */
  incomingByElement: PerElement
  /** Dégâts reçus par tour hors élément (fixes, % de PV ; forme fermée). */
  incomingOther: number
}

/** Un stuff évalué contre le boss (départ, générique, utilisateur, optimisé). */
export interface StuffEvaluation {
  /** Identifiant stable dans le résultat (`start`, `generic:terre`, `user`, `top1`…). */
  id: string
  origin: StuffOrigin
  label: string
  /** Build valide (`computeBuildStats` : niveau, conditions, forgemagie, points). */
  valid: boolean
  /** Problèmes du build (`computeBuildStats().issues`). */
  issues: string[]
  /** Élément principal du stuff (caractéristique élémentaire la plus haute). */
  element: StuffElement
  /**
   * logJ exact du proxy (J = DPT^a · EHP^b · (1 + c·UTIL) × pénalités, exposants du rôle et du profil) : comparable
   * seulement à personnage, rôle, profil et boss égaux ; null pour un build invalide.
   */
  logJ: number | null
  damage: StuffDamage
  survival: StuffSurvival
  /** UTIL du rôle (retrait, soins, tacle…) et pénalité (PA/PM/PO sous les objectifs). */
  util: number
  penalty: number
  ap: number
  mp: number
  range: number
  /** Objets par emplacement (ordre de la fiche). */
  items: StuffItemLine[]
  /** Différences avec le stuff de départ (objets ajoutés et retirés). */
  changes: { added: StuffItemLine[]; removed: StuffItemLine[] }
  /** Points investis, parchemins et répartition de points retenue par l'optimiseur (`pointsOptions`). */
  points: Partial<Record<PrimaryStat, number>>
  scrolls: Partial<Record<PrimaryStat, number>>
  pointsId?: string
  /** Build complet (format des fichiers d'équipe). */
  build: CharacterBuild
  /** Fiche affichable (`buildStuffSheet`). */
  sheet: StuffSheet
}

/** Équivalence lisible d'une caractéristique contre le boss (poids marginaux du proxy, `statWeightsAt`). */
export interface StatEquivalence {
  stat: StatKey
  label: string
  /** Gain de logJ par point (différences finies de la forme fermée, au meilleur stuff ; PA/PM/PO : un point sous le plafond). */
  perPoint: number
  /** Points de la caractéristique de référence qui valent un point de `stat` (null : référence sans valeur). */
  inReference: number | null
  /** Valeur par unité de poids de rune (forgemagie), relative à la référence (1 = autant qu'une unité de poids de la référence). */
  perRuneWeight: number | null
  /** Phrase affichée (« 1 PA ≈ 212 Force »). */
  text: string
}

export interface StuffStatWeights {
  /**
   * Caractéristique de référence : principale de l'élément du stuff ; si elle ne vaut rien, la caractéristique
   * élémentaire la plus utile, sinon la Vitalité.
   */
  reference: StatKey
  referenceLabel: string
  /** Équivalences, de la plus forte valeur par point à la plus faible (caractéristiques sans valeur omises). */
  items: StatEquivalence[]
  /** Explications (mode de calcul, limites). */
  notes: string[]
}

/** Résultat d'une optimisation pour un élément (option `elements: 'all'`). */
export interface StuffElementOption {
  element: StuffElement
  label: string
  /** Résistance effective moyenne du boss dans cet élément (phases attaquables pondérées). */
  bossResPct: number
  /** Meilleur stuff de cet élément, re-noté dans le contexte commun (logJ comparables entre éléments). */
  best: StuffEvaluation
  chosen: boolean
}

/** Réponse à « quel stuff est le plus intéressant contre ce boss ? » (sérialisable en JSON). */
export interface StuffVsBossResult {
  version: 1
  boss: {
    monsterId: number
    name: string
    grade: number
    players?: number
    level: number
    hp: number
    resPct: PerElement
    weakestElements: number[]
    /** Réductions effectives des dommages à distance / en mêlée (ex. Merkator : 50 % à distance). */
    rangedResPct: number
    meleeResPct: number
    /** Mécaniques détectées ou décrites (résumés de la fiche du boss). */
    mechanics: string[]
  }
  character: {
    breedId: number
    className: string
    presetId: string
    presetLabel: string
    role: string
    roleLabel: string
    element: StuffElement
    elementLabel: string
    level: number
    /** Joué au contact (PO non exigée). */
    melee: boolean
    /** Origine du stuff de départ. */
    input: 'preset' | 'build' | 'roxx'
    variants: (0 | 1)[]
  }
  options: {
    level: number
    iterations: number
    /** Recherches relancées (graines `seed`, `seed + 1`…) par élément. */
    restarts: number
    profile: string
    top: number
    /** Objets différents exigés entre deux stuffs du top. */
    minDifferences: number
    elements: 'preset' | 'all'
    seed: number
    keepPassives: boolean
    fixed: number[]
    exclude: number[]
  }
  /** Stuff de départ de l'optimisation (stuff du preset, ou stuff de l'utilisateur) ; aussi en tête de `comparison`. */
  start: StuffEvaluation
  /** Le stuff de départ est-il valide ? (un départ invalide n'est jamais présenté comme meilleur) */
  startValid: boolean
  /**
   * Lignes de comparaison : départ d'abord, puis stuff du preset (départ = stuff de l'utilisateur), puis stuffs
   * génériques (meilleur logJ d'abord, invalides à la fin).
   */
  comparison: StuffEvaluation[]
  /** Meilleur stuff (= `top[0]`). */
  best: StuffEvaluation
  /**
   * Meilleurs stuffs DISTINCTS (au moins `options.minDifferences` objets de différence, places restantes complétées par
   * des ensembles d'objets simplement différents), re-notés en exact, meilleur d'abord.
   */
  top: StuffEvaluation[]
  /** Comparaison des quatre éléments (option `elements: 'all'`). */
  elements?: StuffElementOption[]
  statWeights: StuffStatWeights
  assumptions: string[]
  warnings: string[]
  search: {
    ms: number
    /** Optimisations lancées (une par élément). */
    runs: number
    evaluations: { surrogate: number; exact: number }
    pools: { examined: number; kept: number; setBlocks: number }
    /** Stuffs méta gardés comme graines (identifiants de STUFFS ; jamais `vortex_*`). */
    seedStuffs: string[]
  }
}
