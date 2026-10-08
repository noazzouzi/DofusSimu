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
// Utilités de classe (utilities.ts) — ajout v1 (question 2)
// ---------------------------------------------------------------------------------------------------------------------

/** Une utilité chiffrée et les sorts qui la portent (noms français, plus forte contribution d'abord). */
export interface UtilityValue {
  value: number
  spells: string[]
}

/**
 * Utilités chiffrées d'un personnage (unités) :
 *  - `mpRemoved`, `apRemoved` : PM / PA retirés au boss par tour (espérance contre son esquive, rotation CONSACRÉE à
 *    cette réserve, relances amorties) ; deux valeurs NON additionnables (chacune suppose tout le tour : le tour mixte
 *    est `ClassUtilities.removal.combined`) ; `rangeRemoval` : PO retirée par lancer (meilleur sort) ;
 *  - `heal`, `shield` : PV soignés / PV de bouclier posés par tour, TOTAL D'ÉQUIPE (rotation consacrée, relances
 *    amorties ; limite de lancers par cible × personnages visables) ; non additionnables (tour mixte : `care`) ;
 *  - `allyReduction` : % de dommages en moins sur un allié (× 1163 < 100) × temps d'effet ; `allyArmor` : dommages
 *    retirés par coup (armure 265/105, réduite au niveau) × temps d'effet ; `selfReduction` : idem sur soi seulement ;
 *  - `damageTaken` : % de dommages subis en plus posé sur le boss (× 1163 > 100) × temps d'effet ;
 *  - `allyPower`, `allyDamage`, `allyFinalDamage`, `allyAp`, `allyMp` : bonus moyen d'un allié (valeur × temps d'effet) ;
 *  - `erosion` : % d'érosion posé sur le boss (meilleur sort) ;
 *  - `placement`, `summons`, `dispel`, `debuff` : nombre de sorts (déplacent le boss ; invoquent ; désenvoûtent le boss ou
 *    réduisent la durée de ses effets ; baissent ses caractéristiques).
 */
export type UtilityKey =
  | 'mpRemoved'
  | 'apRemoved'
  | 'rangeRemoval'
  | 'heal'
  | 'shield'
  | 'allyReduction'
  | 'allyArmor'
  | 'selfReduction'
  | 'damageTaken'
  | 'allyPower'
  | 'allyDamage'
  | 'allyFinalDamage'
  | 'allyAp'
  | 'allyMp'
  | 'erosion'
  | 'placement'
  | 'summons'
  | 'dispel'
  | 'debuff'

/** Forme du DPT mesurée (classes.ts) : parts du soutenu conservées au contact seul / à distance seule, rafale / soutenu. */
export interface DamageShape {
  meleeShare: number
  rangeShare: number
  burstRatio: number
}

export interface ClassUtilities {
  breedId: number
  /** États du lanceur supposés (posture). */
  states: number[]
  values: Record<UtilityKey, UtilityValue>
  /**
   * Points tentés par tour (esquivables) et sûrs (non esquivables) de la rotation consacrée à chaque réserve, avant
   * l'esquive du boss ; et `combined` : tour de retrait MIXTE (un seul budget de PA, réserves qui comptent seulement —
   * option `removalPools`) : PM et PA retirés espérés, PA dépensés, sorts (ajout v1.1).
   */
  removal: {
    mp: { attempted: number; sure: number }
    ap: { attempted: number; sure: number }
    combined: { mp: number; ap: number; apSpent: number; spells: string[] }
  }
  /**
   * Tour de soin MIXTE (ajout v1.1) : un seul budget de PA pour les soins et les boucliers (total d'équipe), après
   * l'entretien des sources des meilleures réduction et armure alliées ; PV soignés, PV de bouclier posés, PA dépensés,
   * sorts.
   */
  care: { heal: number; shield: number; apSpent: number; spells: string[] }
  /** Apport offensif à un allié de référence, en % de ses dégâts (heuristique décomposée, utilities.ts). */
  offensiveGain: { total: number; parts: { label: string; pct: number }[] }
  /** Forme du DPT, si elle a été mesurée (sinon les étiquettes mêlée/distance viennent des portées des sorts). */
  damage?: DamageShape
  tags: UtilityTag[]
  /** Ce qui a été écarté ou n'est pas chiffré (lignes conditionnelles, sous-sorts partagés, glyphes…). */
  notes: string[]
}

/** Atouts et limites d'un personnage contre un boss (phrases françaises, sans doublon). */
export interface Relevance {
  atouts: string[]
  limites: string[]
}

export type Confidence = 'haute' | 'moyenne' | 'basse'

// ---------------------------------------------------------------------------------------------------------------------
// Classement des classes (classes.ts) — ajout v1 (question 2)
// ---------------------------------------------------------------------------------------------------------------------

/** Axes du classement (aucune note globale : chaque axe est montré). */
export type RankingAxis = 'damage' | 'survival' | 'control' | 'heal' | 'team'

/** Mesures d'un preset contre le boss (sérialisable JSON). */
export interface PresetEvaluation {
  presetId: string
  breedId: number
  className: string
  label: string
  role: string
  /** Élément du preset (`earth`, `fire`, `water`, `air`). */
  element: string
  /** Stuff utilisé : identifiant du stuff générique, `unstuffed` (sans objet), ou `optimized`. */
  stuff: string
  stance: { id: string; name: string; states: number[] }
  dpt: {
    /** DPT soutenu en régime établi (rotation.ts `steady`), NON calibré, pondéré par les phases attaquables. */
    steady: number
    /** Rafale (meilleur tour isolé), même pondération. */
    burst: number
    byPhase: { phaseId: string; weight: number; steady: number }[]
    /** Soutenu de chaque posture évaluée. */
    stances: { id: string; steady: number }[]
    /**
     * Étalonnage moteur du preset (`calibrationOf`, data/ai/calibration.json : rapport « dégâts simulés / analytique »
     * mesuré en mini-combat contre un Buboxor, borné à [0,5 ; 2]) et soutenu × étalonnage. Contrôle affiché à côté, le
     * classement reste sur `steady` (ajout v1.1).
     */
    calibration: number
    calibrated: number
    /**
     * Boss à résistances ≥ 100 % (mécanique, sans fiche manuelle) : soutenu contre la phase principale si la mécanique
     * les lève (ramenées à 0) — repli de la composition quand tous les DPT sont nuls.
     */
    resLifted?: number
  }
  survival: {
    hp: number
    /** PV effectifs du proxy (PV × dégâts sans défense / avec défenses, plafond 20 × PV). */
    ehp: number
    /** Dégâts reçus par tour (un tour du boss sur ce personnage, phases pondérées). */
    incoming: number
    incomingByElement: PerElement
    /** Dégâts reçus hors élément (fixes, % de PV). */
    incomingOther: number
    /** PV / dégâts reçus par tour (0 si le boss ne frappe pas). */
    turnsToDie: number
  }
  /**
   * Contrôle : `mpRemoved` / `apRemoved` = rotation consacrée à chaque réserve (non additionnables ; 0 si le retrait est
   * puni ou si le boss n'a pas la réserve) ; `combined` = tour mixte (un budget de PA) ; `value` = combined.mp +
   * combined.ap (valeur de l'axe).
   */
  control: { mpRemoved: number; apRemoved: number; combined: { mp: number; ap: number }; value: number }
  /**
   * Soin (PV par tour, total d'équipe) : `heal` / `shield` = rotations consacrées (non additionnables) ; `reduction`
   * (%) et `armor` (dommages retirés par coup) ; `mixed` = tour mixte soin + bouclier ; `raw` = mixte + réduction ×
   * dégâts de référence + armure × coups ; `cap` = dégâts d'un tour du boss sur un personnage (médiane des presets) ;
   * `value` = min(raw, cap) (valeur de l'axe : PV UTILES) ; `protectionRaw` / `protection` = boucliers (rotation
   * consacrée) + réduction + armure, sans soin (règle « Protection »), brut / plafonné.
   */
  heal: {
    heal: number
    shield: number
    reduction: number
    armor: number
    mixed: { heal: number; shield: number }
    raw: number
    cap: number
    value: number
    protectionRaw: number
    protection: number
  }
  team: { gainPct: number; parts: { label: string; pct: number }[] }
  /** Valeur de chaque axe (unités : DPT, PV effectifs, points retirés, PV par tour, % de dégâts d'un allié). */
  axes: Record<RankingAxis, number>
  utilities: ClassUtilities
  relevance: Relevance
  confidence: { level: Confidence; reasons: string[] }
  /** Élément du preset face au boss : résistance effective (phases attaquables pondérées) et rang (0 = le plus faible). */
  elementMatch: { element: number; resPct: number; rank: number }
  /** Mode 'optimized' : objectif J du proxy (mêmes options) du stuff de départ et du stuff retenu (ajout v1.1). */
  optimization?: { startJ: number; bestJ: number }
  warnings: string[]
}

export interface ClassSummary {
  breedId: number
  className: string
  /** Meilleur preset de la classe sur chaque axe. */
  best: Record<RankingAxis, { presetId: string; value: number }>
  /**
   * Confiance du MODÈLE pour la classe (`CLASS_CONFIDENCE` : mécaniques de classe non modélisées), indépendante du
   * preset ; la confiance d'un preset (`PresetEvaluation.confidence`) peut être plus basse (posture incertaine,
   * invocateur, DPT nul contre ce boss).
   */
  confidence: Confidence
}

export interface AxisRanking {
  axis: RankingAxis
  label: string
  unit: string
  /**
   * Une ligne par classe (son meilleur preset sur l'axe), meilleure d'abord. `rank` : rang partagé par les ex æquo
   * (1, 1, 3…), `tied` : valeur égale à celle d'une autre ligne (ajout v1.1).
   */
  entries: { breedId: number; className: string; presetId: string; value: number; rank: number; tied: boolean }[]
}

export interface CompositionMember {
  presetId: string
  breedId: number
  className: string
  /** Rôle tenu dans la composition (« Dégâts », « Soin »…). */
  slot: string
  reason: string
}

export interface ClassRanking {
  boss: { monsterId: number; name: string; grade: number; players?: number; level: number }
  level: number
  players: number
  stuff: 'preset' | 'optimized'
  presets: PresetEvaluation[]
  classes: ClassSummary[]
  axes: AxisRanking[]
  /** Composition suggérée : membres, règles appliquées, et notes (règles écartées et pourquoi). */
  composition: { members: CompositionMember[]; rules: string[]; notes: string[] }
  assumptions: string[]
  warnings: string[]
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
  /**
   * logJ SOUTENU : le même logJ où le DPT du proxy est remplacé par le DPT soutenu (`damage.steady`, × calibration du
   * preset pour rester à l'échelle du proxy) — a·ln(DPT soutenu) + b·ln PVe + ln(1 + c·UTIL) + ln(pénalités). Classe
   * les stuffs quand le proxy ne voit pas les dégâts de la classe (posture, `StuffVsBossResult.ranking`) ; null pour
   * un build invalide.
   */
  logJSustained: number | null
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
  /**
   * Gain du score de classement par point (différences finies de la forme fermée d'un contexte du proxy construit AU
   * meilleur stuff — son élément, sa rotation ; DPT soutenu en posture quand `ranking.by = 'sustained'`) ; PA/PM/PO :
   * un point sous le plafond.
   */
  perPoint: number
  /** Points de la caractéristique de référence qui valent un point de `stat` (null : référence sans valeur). */
  inReference: number | null
  /**
   * PA, PM et PO : part de `perPoint` due aux seules pénalités de l'objectif (×0,85 par PA, ×0,9 par PM, ×0,95 par PO
   * sous les valeurs visées) — un réglage de l'objectif, pas un effet modélisé contre le boss (absent : aucune).
   */
  objectivePenalty?: number
  /** `inReference` sans la part `objectivePenalty` : valeur du point pour les dégâts, la survie et l'utilité modélisés. */
  modeledInReference?: number | null
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
    /** PO visée par l'objectif (pénalité ×0,95 par PO manquante ; 0 au contact). */
    rangeNeed: number
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
   * des ensembles d'objets simplement différents), re-notés en exact, triés par le score de `ranking` (meilleur
   * d'abord). Candidats : stuffs de la recherche ET stuffs de référence valides (départ, stuff du preset, génériques) —
   * un stuff de référence que rien ne bat reste devant.
   */
  top: StuffEvaluation[]
  /** Comparaison des quatre éléments (option `elements: 'all'`). */
  elements?: StuffElementOption[]
  /**
   * Score qui CLASSE les stuffs (meilleur, top, éléments) : `proxy` = logJ du proxy (objectif de l'optimiseur) ;
   * `sustained` = logJ soutenu (`StuffEvaluation.logJSustained`), retenu quand le proxy ne voit pas les dégâts de la
   * classe (posture de classe que le proxy ne pose pas) — stuffs de référence et candidats de la recherche classés
   * ensemble. `reason` : explication affichée.
   */
  ranking: { by: 'proxy' | 'sustained'; reason: string }
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
    /** Stuffs méta proposés comme graines et écartés par `theorySeedFilter` (stuffs `vortex_*`, objets trop hauts). */
    excludedSeeds: string[]
    /**
     * Affinage en DPT soutenu (classement soutenu seulement) : durée, montées lancées et gain de logJ soutenu sur le
     * meilleur stuff d'avant l'affinage (0 : rien trouvé de mieux).
     */
    polish?: { ms: number; starts: number; gain: number }
  }
}
