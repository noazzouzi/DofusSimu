/**
 * Constantes de l'Œil de Vortex (docs/research/vortex.md, data/dungeons/vortex.json, docs/design/ai.md §12) — WP3,
 * GELÉ en S0 (J3). Données de jeu et paramètres par défaut du scénario : aucune logique ici.
 *
 * Conventions : heures 1..12 (I..XII) ; un tableau indexé par heure a une case 0 inutilisée ; « en ligne » = même x ou
 * même y (MapPoint). Les valeurs marquées INCERTAIN sont des paramètres du scénario (variantes, §12.1).
 */
import type { RoleId } from '../../ai/types'
import type { UncertainParam } from '../types'

// ───────────────────────────── donjon et carte ─────────────────────────────

export const VORTEX_DUNGEON_ID = 87
/** « Œil de Vortex - Salle des heures perdues » (une seule salle). */
export const VORTEX_MAP_ID = 143393281
/** Centre de l'horloge (18,-5) : non marchable, bloque la LdV. */
export const CLOCK_CENTER_CELL = 328
/** Cases de départ des personnages (rouges, en bas). */
export const RED_START_CELLS: readonly number[] = [424, 427, 430, 438, 440, 441, 443, 453, 455, 457, 482, 484]
/** Cases de départ des monstres (bleues, ligne 19) ; les vagues réapparaissent dessus. */
export const BLUE_START_CELLS: readonly number[] = [268, 269, 270, 271, 272, 273, 274, 275, 276, 277]
/**
 * Départs rouges hors des croix de l'Auroraire aux tours du Vortex à 4 joueurs (IV/VIII/XII) — vortex.md §2. 484 est
 * aussi hors de ces croix mais c'est la case de VII (échange forcé quand l'horloge y arrive) : exclue.
 */
export const RED_CELLS_SAFE_K4: readonly number[] = [424, 438, 441, 443, 453, 455, 457, 482]
/** Case de départ du Vortex parmi les bleues — INCERTAIN (non documentée), paramètre `vortexCell`. */
export const VORTEX_DEFAULT_CELL = 272

// ───────────────────────────── monstres ─────────────────────────────

export const AURORAIRE = 3833
export const IKARGN = 3834
export const VORTEX = 3835
export const MEJAIRE = 3836
export const HARPILLE = 3837
export const BUBOXOR = 3838
export const BRABUZAR = 3839
/**
 * Placements des monstres de la vague 1 (4 personnages : Vortex, Ikargn, Méjaire, Harpille) — relevés sur les captures
 * du jeu fournies par l'utilisateur le 2026-10-06 (« Placement 1 … 10 », cases bleues 268 → 277 de gauche à droite).
 * Le Vortex occupe tour à tour chacune des 10 cases, les monstres sont toujours espacés d'une case. Index 0 =
 * configuration historique du simulateur (Vortex sur `vortexCell`, autres monstres dans `BLUE_SPAWN_ORDER`), qui ne
 * correspond à aucun placement observé : défaut tant que les campagnes et tests antérieurs s'y réfèrent.
 */
export const VORTEX_PLACEMENTS: readonly Readonly<Record<number, number>>[] = [
  {},
  { [VORTEX]: 268, [IKARGN]: 270, [MEJAIRE]: 272, [HARPILLE]: 274 },
  { [VORTEX]: 269, [IKARGN]: 271, [MEJAIRE]: 273, [HARPILLE]: 275 },
  { [VORTEX]: 270, [IKARGN]: 268, [MEJAIRE]: 272, [HARPILLE]: 274 },
  { [VORTEX]: 271, [IKARGN]: 269, [MEJAIRE]: 273, [HARPILLE]: 275 },
  { [VORTEX]: 272, [IKARGN]: 270, [MEJAIRE]: 268, [HARPILLE]: 274 },
  { [VORTEX]: 273, [IKARGN]: 271, [MEJAIRE]: 269, [HARPILLE]: 275 },
  { [VORTEX]: 274, [IKARGN]: 272, [MEJAIRE]: 270, [HARPILLE]: 268 },
  { [VORTEX]: 275, [IKARGN]: 273, [MEJAIRE]: 271, [HARPILLE]: 269 },
  { [VORTEX]: 276, [IKARGN]: 274, [MEJAIRE]: 272, [HARPILLE]: 270 },
  { [VORTEX]: 277, [IKARGN]: 275, [MEJAIRE]: 273, [HARPILLE]: 271 },
]
/** Nombre de placements observés (1 … 10). */
export const VORTEX_PLACEMENT_COUNT = VORTEX_PLACEMENTS.length - 1

/** Monstres de vague (hors boss et Auroraire). */
export const WAVE_MONSTER_IDS: readonly number[] = [IKARGN, MEJAIRE, HARPILLE, BUBOXOR, BRABUZAR]
/** Invocation-horloge (statique : 0 PA / 0 PM, invulnérable, indéplaçable). */
export const SUMMON_IDS: readonly number[] = [AURORAIRE]

/** Grades : niveau 200/203/206/209/212 (vague) ; boss niveau 220. Grade des monstres de vague par défaut : 5 (niveau 212,
 * 6 600 PV — confirmé, docs/research/vortex-audit.md). */
export const DEFAULT_MONSTER_GRADE = 5
/**
 * Rang du boss selon le nombre de personnages (donjons modulaires, devblog 2.7 : malus de PV du boss sous 8 joueurs ;
 * DPLN, bestiaire 3.7 : « à 4, le boss sera de rang 1 ») : joueurs − 3, borné à 1..5 (docs/research/vortex-audit.md §3).
 */
export function bossGradeFor(players: number): number {
  return Math.max(1, Math.min(5, Math.floor(players) - 3))
}
export const DEFAULT_BOSS_GRADE = bossGradeFor(4)
/** PV du Vortex par grade (1..5). */
export const VORTEX_HP_BY_GRADE: readonly number[] = [0, 15000, 17000, 18000, 20000, 22000]
/** PA/PM du Vortex en phase 2 (vulnérable). */
export const VORTEX_PHASE2_AP = 16
export const VORTEX_PHASE2_MP = 5

/** Élément le plus faible de chaque monstre au grade 5 (0 neutre, 1 terre, 2 feu, 3 eau, 4 air). */
export const WEAKEST_ELEMENT: Readonly<Record<number, number>> = {
  [IKARGN]: 2,
  [MEJAIRE]: 1,
  [HARPILLE]: 0,
  [BUBOXOR]: 4,
  [BRABUZAR]: 3,
  [VORTEX]: 0,
}

// ───────────────────────────── sorts ─────────────────────────────

/** Sorts des monstres de vague, dans l'ordre des données. */
export const MONSTER_SPELLS: Readonly<Record<number, readonly number[]>> = {
  [IKARGN]: [5015, 5016, 5017], // Attraction ailée, Cercle de feu, Terre mythe
  [MEJAIRE]: [5022, 5023, 5024], // Rayonirique, Plumière, Envolupté
  [HARPILLE]: [5018, 5019, 5021], // Tirs optiques, Superfidie, Petit poison
  [BUBOXOR]: [5026, 5027, 5028], // Bouclier absorbant, Feinterception, Hoxor
  [BRABUZAR]: [5030, 5032, 5033], // Mise en situation, Décollage, Neutralisation
  [VORTEX]: [5068, 5070, 5062, 5066, 5064], // Heuristique, Morfaille, En temps et en heure, Heurage, Contamination zombie
}

export const SPELL = {
  // Monstres de vague
  ATTRACTION_AILEE: 5015,
  CERCLE_DE_FEU: 5016,
  TERRE_MYTHE: 5017,
  TIRS_OPTIQUES: 5018,
  SUPERFIDIE: 5019,
  PETIT_POISON: 5021,
  RAYONIRIQUE: 5022,
  PLUMIERE: 5023,
  ENVOLUPTE: 5024,
  BOUCLIER_ABSORBANT: 5026,
  FEINTERCEPTION: 5027,
  HOXOR: 5028,
  MISE_EN_SITUATION: 5030,
  DECOLLAGE: 5032,
  NEUTRALISATION: 5033,
  // Vortex
  EN_TEMPS_ET_EN_HEURE: 5062,
  CONTAMINATION_ZOMBIE: 5064,
  HEURAGE: 5066,
  HEURISTIQUE: 5068,
  MORFAILLE: 5070,
  // Sorts internes (scripts du donjon)
  DECALAGE_HORAIRE: 4996,
  HEURE_DU_TEMPS_FEINTE: 4997,
  HEURE_DU_TEMPS_REACTION: 4998,
  /** Sort de départ de l'Auroraire (spell-level 22879). */
  HEURE_DU_TEMPS: 4999,
  GLYPHE_MARK_HOUR: 5000,
  GLYPHE_ON_DEATH: 5001,
  /** Sort de départ de chaque monstre de vague (spell-level 22882), relancé à chaque résurrection. */
  GLYPHE_TELEPORTEUR: 5002,
  /** Résurrection des morts au début du tour du Vortex (780, 20-30 % PV). */
  VORTEXIPHAN_REZ: 5003,
  HEURE_DU_TEMPS_ADVANCE: 5005,
  /** Sort de départ du Vortex (spell-level 22886) : invoque l'Auroraire, Marginal 25 tours… */
  VORTEXIPHAN: 5006,
  VORTEXIPHAN_MARGINAL_1: 5007,
  /** Début de tour du Vortex après le délai : Marginal 1 tour tant qu'un monstre n'est pas corrompu, sinon Action !. */
  VORTEXIPHAN_UNLOCK: 5008,
  /** Bonus d'heures transmis au Vortex au déverrouillage (une fois par heure). */
  VORTEXIPHAN_HOUR_BONUS: 5009,
  /** Effet du glyphe déclenché par un personnage (échange + bonus + horloge +1). */
  GLYPHE_TRIGGER: 5011,
  /** Pose du glyphe au début du tour d'un monstre de vague non invulnérable. */
  GLYPHE_POSE: 5012,
  ATTRACTION_AILEE_SELF: 5013,
  ATTRACTION_AILEE_DELAYED: 5014,
  PETIT_POISON_CLEANSE: 5020,
  GLYPHE_BONUS: 5025,
  MISE_EN_SITUATION_PULL: 5029,
  DECOLLAGE_HEAL: 5031,
  ACTION: 5060,
  EN_TEMPS_ET_EN_HEURE_HIT: 5061,
  CONTAMINATION_ZOMBIE_INCURABLE: 5063,
  /** Heurage phase 1 (Auroraire) : bonus de l'heure courante à tous les monstres vivants. */
  HEURAGE_PHASE1: 5065,
  /** Heurage phase 2 : téléportation du Vortex au contact de l'Auroraire. */
  HEURAGE_PHASE2: 5067,
  MORFAILLE_ZONE: 5069,
} as const

/** Sorts internes du donjon (27, vortex.json `internalSpells`). */
export const INTERNAL_SPELL_IDS: readonly number[] = [
  4996, 4997, 4998, 4999, 5000, 5001, 5002, 5003, 5005, 5006, 5007, 5008, 5009, 5011, 5012, 5013, 5014, 5020, 5025, 5029,
  5031, 5060, 5061, 5063, 5065, 5067, 5069,
]
/** Sorts du Vortex utilisables en phase 1 (Marginal) et en phase 2 (vulnérable). */
export const VORTEX_PHASE1_SPELLS: readonly number[] = [5062, 5064, 5066]
export const VORTEX_PHASE2_SPELLS: readonly number[] = [5066, 5068, 5070, 5062]

/** Spell-levels des sorts de départ (startingSpellLevelId des grades). */
export const STARTING_SPELL_LEVEL = { [AURORAIRE]: 22879, [VORTEX]: 22886, wave: 22882 } as const

/** Effet de pose du glyphe des monstres (glyphe à effet immédiat, déclenché à l'entrée par défaut). */
export const MONSTER_GLYPH_EFFECT = 1165
/** Cumul maximal de glyphes de monstre. */
export const MONSTER_GLYPH_MAX_STACK = 2

// ───────────────────────────── états ─────────────────────────────

export const STATE = {
  PESANTEUR: 7,
  INVULNERABLE: 56,
  ZOMBI: 74,
  INSOIGNABLE: 76,
  INTACLABLE: 96,
  INDEPLACABLE: 97,
  INEBRANLABLE: 157,
  PACIFISTE: 218,
  /** État d'heure h = HOUR_STATE_BASE + h (221..232). */
  HOUR_STATE_BASE: 220,
  MORT_LATENTE: 233,
  /** « Même heure » : étoile jaune — un kill sous cet état corrompt le monstre. */
  MEME_HEURE: 234,
  MARGINAL: 236,
  FEINTE: 237,
  VORTEX_ALLY_INITIAL: 945,
  /** « Vortex (monstre tué à la même heure) » : corrompu (tour annulé + invulnérable). */
  CORRUPTED: 6611,
} as const

export const HOUR_STATE_BASE = STATE.HOUR_STATE_BASE
export const SAME_HOUR = STATE.MEME_HEURE
export const LATENT_DEATH = STATE.MORT_LATENTE
export const MARGINAL = STATE.MARGINAL
export const ZOMBI = STATE.ZOMBI
export const CORRUPTED = STATE.CORRUPTED
export const INVULNERABLE = STATE.INVULNERABLE
export const UNMOVABLE = STATE.INDEPLACABLE
/** États d'heure 221..232 (index 0 = heure I). */
export const HOUR_STATES: readonly number[] = Array.from({ length: 12 }, (_, i) => HOUR_STATE_BASE + 1 + i)
/** Heure (1..12) d'un état d'heure, 0 sinon. */
export function hourOfState(stateId: number): number {
  return stateId > HOUR_STATE_BASE && stateId <= HOUR_STATE_BASE + 12 ? stateId - HOUR_STATE_BASE : 0
}

// ───────────────────────────── horloge (Auroraire) ─────────────────────────────

export const HOUR_COUNT = 12
export const ROMAN: readonly string[] = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
/** Case de l'Auroraire à chaque heure (index 1..12). */
export const HOUR_CELL: readonly number[] = [0, 173, 176, 220, 292, 376, 444, 484, 481, 436, 365, 281, 212]
/** Case d'heure marchable (IV..IX) : un occupant y est échangé de force avec l'Auroraire quand elle y arrive. */
export const HOUR_CELL_WALKABLE: readonly boolean[] = [false, false, false, false, true, true, true, true, true, true, false, false, false]
/** Case d'invocation de l'Auroraire et heure initiale (XII ; passe à I au premier tour d'un personnage). */
export const AURORAIRE_SUMMON_CELL = 255
export const AURORAIRE_INITIAL_HOUR = 12
/** Heure suivante (XII → I). */
export function nextHour(h: number, k = 1): number {
  return ((((h - 1 + k) % 12) + 12) % 12) + 1
}

/** Bonus d'une heure (posé sur les monstres ressuscités, par Heurage, et sur le Vortex au déverrouillage). */
export interface HourBonus {
  hour: number
  roman: string
  stateId: number
  cell: number
  label: string
  /** Caractéristiques ajoutées (clés de `Stats`). */
  stats?: Partial<Record<'critical' | 'criticalDamage' | 'intelligence' | 'mp' | 'chance' | 'criticalRes' | 'ap' | 'strength' | 'agility', number>>
  /** État accordé (Intaclable 96, Inébranlable 157). */
  grantsState?: number
  /** Multiplicateur de dommages subis (V) : monstres / Vortex. */
  damageTakenMult?: { monster: number; vortex: number }
  /** Bonus de PV max en % (XI). */
  vitalityPct?: number
  /** Élément boosté par +400 d'une caractéristique (III, VI, IX, XII) : coût réduit si le monstre n'a pas de sort de cet élément. */
  boostedElement?: number
}

/** Table des heures (vortex.md §5) ; index 1..12, index 0 vide. */
export const HOUR_BONUS: readonly (HourBonus | undefined)[] = [
  undefined,
  { hour: 1, roman: 'I', stateId: 221, cell: 173, label: '+10 % Critique, +200 Dommages critiques', stats: { critical: 10, criticalDamage: 200 } },
  { hour: 2, roman: 'II', stateId: 222, cell: 176, label: 'État Intaclable (96)', grantsState: STATE.INTACLABLE },
  { hour: 3, roman: 'III', stateId: 223, cell: 220, label: '+400 Intelligence', stats: { intelligence: 400 }, boostedElement: 2 },
  { hour: 4, roman: 'IV', stateId: 224, cell: 292, label: '+2 PM', stats: { mp: 2 } },
  { hour: 5, roman: 'V', stateId: 225, cell: 376, label: 'Dommages subis ×70 % (Vortex : ×75 %)', damageTakenMult: { monster: 0.7, vortex: 0.75 } },
  { hour: 6, roman: 'VI', stateId: 226, cell: 444, label: '+400 Chance', stats: { chance: 400 }, boostedElement: 3 },
  { hour: 7, roman: 'VII', stateId: 227, cell: 484, label: '+150 Résistances critiques', stats: { criticalRes: 150 } },
  { hour: 8, roman: 'VIII', stateId: 228, cell: 481, label: '+4 PA', stats: { ap: 4 } },
  { hour: 9, roman: 'IX', stateId: 229, cell: 436, label: '+400 Force', stats: { strength: 400 }, boostedElement: 1 },
  { hour: 10, roman: 'X', stateId: 230, cell: 365, label: 'État Inébranlable (157) : ne peut pas être poussé', grantsState: STATE.INEBRANLABLE },
  { hour: 11, roman: 'XI', stateId: 231, cell: 281, label: '+30 % Vitalité (PV max)', vitalityPct: 30 },
  { hour: 12, roman: 'XII', stateId: 232, cell: 212, label: '+400 Agilité', stats: { agility: 400 }, boostedElement: 4 },
]

/**
 * Coûts d'heures de repli (PVe, docs/design/ai.md §12.4 ; mode `fast` sans calcul et tests). `C_MON` : vie de zombie
 * (III/VI/IX/XII : `C_MON_NO_ELEMENT` si le monstre n'a pas de sort de l'élément boosté ; X : `C_MON_X_WITH_PLACER` si
 * l'équipe a un placeur). `C_VX` : bonus hérité par le Vortex, payé une fois par heure distincte.
 */
export const C_MON_FALLBACK: readonly number[] = [0, 400, 100, 500, 400, 600, 500, 0, 1200, 500, 50, 300, 500]
export const C_MON_NO_ELEMENT = 100
export const C_MON_X_WITH_PLACER = 300
export const C_VX_FALLBACK: readonly number[] = [0, 1500, 100, 1200, 1000, 4000, 600, 0, 2500, 400, 100, 5000, 1200]

// ───────────────────────────── glyphes des monstres ─────────────────────────────

/** Bonus du glyphe de chaque monstre (pour le personnage qui le déclenche ET le monstre). */
export const GLYPH_BONUS_LABEL: Readonly<Record<number, string>> = {
  [IKARGN]: '+1 PM (1 tour)',
  [MEJAIRE]: 'Soin 10 % PV max',
  [HARPILLE]: '+200 Puissance (1 tour)',
  [BUBOXOR]: 'Dommages subis ×50 % (1 tour)',
  [BRABUZAR]: '+200 Dommages de poussée (1 tour)',
}
/** « Bonus du poseur » ajouté au prix d'une glyphe par le planificateur (PVe, §12.5). */
export const GLYPH_PLANNER_BONUS: Readonly<Record<number, number>> = {
  [HARPILLE]: 150,
  [MEJAIRE]: 200, // si blessé
  [BUBOXOR]: 100,
  [IKARGN]: 50,
  [BRABUZAR]: 30,
}

// ───────────────────────────── vagues ─────────────────────────────

export const WAVE_COUNT = 5
/** Composition des vagues à 4 personnages (JOL 2016/2019) ; vague 1 = Vortex + 3 monstres. */
export const WAVES_4P: readonly (readonly number[])[] = [
  [VORTEX, IKARGN, MEJAIRE, HARPILLE],
  [HARPILLE, HARPILLE, BUBOXOR, BRABUZAR],
  [MEJAIRE, MEJAIRE, HARPILLE, BRABUZAR],
  [BRABUZAR, BRABUZAR, MEJAIRE, IKARGN],
  [BUBOXOR, BUBOXOR, BRABUZAR, IKARGN],
]
/** Monstre ajouté à chaque vague pour le 5e..8e personnage (index = vague − 1). */
export const EXTRA_MONSTER_PER_PLAYER: Readonly<Record<number, readonly number[]>> = {
  5: [BUBOXOR, IKARGN, IKARGN, HARPILLE, MEJAIRE],
  6: [BRABUZAR, HARPILLE, BUBOXOR, BRABUZAR, HARPILLE],
  7: [IKARGN, IKARGN, MEJAIRE, BUBOXOR, BRABUZAR],
  8: [HARPILLE, MEJAIRE, HARPILLE, MEJAIRE, MEJAIRE],
}
/**
 * Tours d'arrivée des vagues : tous les 6 tours depuis la 2.42 (notes de version : « Le nombre de tours entre 2 vagues de
 * monstres est augmenté : 5 tours -> 6 tours » ; DPLN 2024 : « la deuxième vague arrive tour 7 ») —
 * docs/research/vortex-audit.md §1.1.
 */
export const ARRIVAL_ROUNDS_DEFAULT: readonly number[] = [1, 7, 13, 19, 25]
/** Cadence d'AVANT la 2.42 (tous les 5 tours, JOL 2016) : historique, plus échantillonnée. */
export const ARRIVAL_ROUNDS_ALT: readonly number[] = [1, 6, 11, 16, 21]

/** Composition des vagues pour `players` personnages (≤ 4 : derniers monstres retirés — INCERTAIN). */
export function waveComposition(players: number): number[][] {
  const n = Math.max(1, Math.min(8, Math.floor(players)))
  return WAVES_4P.map((wave, w) => {
    const out = wave.slice(0, Math.min(4, n))
    for (let p = 5; p <= n; p++) out.push(EXTRA_MONSTER_PER_PLAYER[p][w])
    return out
  })
}

// ───────────────────────────── paramètres du scénario (§12.1) ─────────────────────────────

/** Paramètres typés du scénario (lus dans `fight.scenarioState.vortex`, plats). */
export interface VortexParams {
  players: number
  monsterGrade: number
  bossGrade: number
  vortexCell: number
  /**
   * Placement des monstres de la vague 1 (`VORTEX_PLACEMENTS`, 1 … 10) ; 0 = configuration historique. Un placement
   * impose la case du Vortex (`vortexCell` est alors ignoré).
   */
  enemyPlacement: number
  /**
   * Cases d'apparition des vagues 2 à 5 — INCERTAIN (« sur les cases où la vague 1 a commencé », JOL) : 'placement' =
   * les cases de départ de la vague 1 (de gauche à droite), puis les autres cases bleues ; 'blueOrder' = toutes les
   * cases bleues dans l'ordre historique `BLUE_SPAWN_ORDER` ; 'auto' = 'placement' avec un placement, sinon 'blueOrder'.
   */
  waveSpawn: 'auto' | 'placement' | 'blueOrder'
  /** Équipe qui commence : moyenne d'initiative (mechanics.md §8) ou meilleur combattant (moteur actuel). */
  startingTeamRule: 'average' | 'best'
  arrivalRounds: readonly number[]
  arrivalInvulnerableTurns: number
  wave1Invulnerable: boolean
  earlySpawnIfCleared: boolean
  /** PV des ressuscités en % des PV max : [min, max] (jet uniforme). */
  rezHpPct: readonly number[]
  rezMinusOneMp: boolean
  rezAllPerTurn: boolean
  deadPlayerAdvancesClock: boolean
  unlockVortexTurn: number
  /** Tours du Vortex entre la dernière corruption et *Action !*. */
  actionDelay: number
  glyphTrigger: 'enter' | 'turnEnd'
  maxRounds: number
}

export const VORTEX_DEFAULT_PARAMS: Readonly<VortexParams> = {
  players: 4,
  monsterGrade: DEFAULT_MONSTER_GRADE,
  bossGrade: DEFAULT_BOSS_GRADE,
  vortexCell: VORTEX_DEFAULT_CELL,
  enemyPlacement: 0,
  waveSpawn: 'auto',
  startingTeamRule: 'average',
  arrivalRounds: ARRIVAL_ROUNDS_DEFAULT,
  arrivalInvulnerableTurns: 1,
  wave1Invulnerable: false,
  earlySpawnIfCleared: false,
  rezHpPct: [20, 30],
  // 2.42 : « Les monstres ressuscités ont désormais 1 PM en moins » (docs/research/vortex-audit.md §1.2).
  rezMinusOneMp: true,
  rezAllPerTurn: true,
  deadPlayerAdvancesClock: false,
  unlockVortexTurn: 26,
  actionDelay: 1,
  glyphTrigger: 'enter',
  // Le jeu n'a pas de limite de tours (docs/research/vortex-audit.md) : 150 n'est qu'un filet de sécurité de la
  // simulation. À 60, des combats à 19 / 19 corrompus étaient perdus « à la limite » pendant la phase 2 (tour 5).
  maxRounds: 150,
}

/**
 * Règles INCERTAINES échantillonnées par graine (§12.1) ; `values[0]` = défaut. Les variantes d'avant la 2.42 (vagues
 * tous les 5 tours, ressuscités à 50 % sans −1 PM) ont été retirées (docs/research/vortex-audit.md §1.5).
 */
export const VORTEX_UNCERTAIN: readonly UncertainParam[] = [
  { key: 'startingTeamRule', values: ['average', 'best'], weights: [0.5, 0.5] },
  { key: 'wave1Invulnerable', values: [false, true], weights: [0.8, 0.2] },
  { key: 'earlySpawnIfCleared', values: [false, true], weights: [0.9, 0.1] },
  { key: 'rezAllPerTurn', values: [true, false], weights: [0.9, 0.1] },
  { key: 'deadPlayerAdvancesClock', values: [false, true], weights: [0.8, 0.2] },
  // 25 retiré : la dernière vague arrive au tour 25 (invariant « dernière vague avant le déverrouillage »).
  { key: 'unlockVortexTurn', values: [26, 27], weights: [0.9, 0.1] },
  { key: 'actionDelay', values: [1, 0], weights: [0.6, 0.4] },
  { key: 'glyphTrigger', values: ['enter', 'turnEnd'], weights: [0.9, 0.1] },
]

/** Besoins en rôles publiés par le scénario (docs/design/ai.md §9.2, `ScenarioAIModel.roleNeeds`). */
export const VORTEX_ROLE_NEEDS: Readonly<Partial<Record<RoleId, number>>> = {
  killer: 2,
  mpLock: 1,
  zoneDps: 1,
  placer: 0.5,
  healer: 0.5,
  tank: 0.5,
}

/** Clé de `fight.scenarioState` où le scénario range ses paramètres et son état (plat). */
export const VORTEX_STATE_KEY = 'vortex'
/** Identifiant du scénario (registre src/dungeons/index.ts). */
export const VORTEX_SCENARIO_ID = 'vortex'
