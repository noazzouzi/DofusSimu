// Tanière du Meulou (donjon 15) avec un Sacrieur Terre et 7 mules : le donjon, ses monstres et le Sacrieur. Données du
// jeu 3.7 (.cache/data-3.7) ; synthèse dans docs/strategies/meulou-sacrieur/README.md.
import { emptyStats, type Stats } from '../../src/core/types'

/** Donjon « Tanière du Meulou » (DofusDB 15), niveau 100, sous-zone 213 ; entrée et sortie : carte 171706891. */
export const DONJON = 15
export const ENTREE = 171706891
/** Entrée du donjon (donnée par le joueur, 2026-10-19) : parler au PNJ 3947, puis 2 fois la première réponse. */
export const PNJ_ENTREE = 3947
export const REPONSES_ENTREE = 2
/** Première salle (donnée par le joueur, 2026-10-19). */
export const PREMIERE_SALLE = 155713536
/**
 * Sortie (donnée par le joueur, 2026-10-19) : après le boss, carte 155719680 ; le PNJ 3947, puis 1 fois la première
 * réponse, ramène à l'entrée (171706891), d'où le donjon recommence.
 */
export const SORTIE = 155719680
export const PNJ_SORTIE = 3947
export const REPONSES_SORTIE = 1
/**
 * Salles sans combat, où l'on choisit la salle suivante par une porte : carte → case de la porte (map:door). Donné par
 * le joueur, 2026-10-19 : en 155715584, porte 213.
 */
export const PORTES: Record<number, number> = { 155715584: 213 }

/**
 * Cartes de la sous-zone 213 (DofusDB) : les 8 salles (rôle « room ») et leurs autres cartes, dont celles des combats
 * (pas encore relevées en jeu ; Ventre de la Baleine : numéro de la salle + 4). Le script d'attente les prend toutes.
 */
export const SALLES: Record<number, string> = {
  155713536: 'Première salle',
  155714560: 'Deuxième salle',
  155715584: 'Troisième salle',
  155716608: 'Quatrième salle',
  155716610: 'Quatrième salle bis',
  155717632: 'Cinquième salle',
  155718656: 'Sixième salle',
  155719680: 'Sortie',
}
export const CARTES_MEULOU = [
  ...Object.keys(SALLES).map(Number),
  155713542, 155714566, 155715590, 155716614, 155717638, 155718658, 155718662, 155719682, 205788174,
]
/**
 * Cartes où le chef lance le combat de la salle. Le 2026-10-19, la salle 2 et celle du boss, atteintes par téléportation
 * après une victoire, étaient 155714566 et 155718662 (la salle de DofusDB + 6), pas 155714560 et 155718656 : les autres
 * cartes « + 6 » des salles sont prises aussi, et toutes sont dans data/maps.
 */
export const CARTES_COMBAT = [
  155713536, 155713542, 155714560, 155714566, 155716608, 155716610, 155716614, 155717632, 155717638, 155718656, 155718658,
  155718662,
]
/** Nom d'une carte du donjon (salle de DofusDB, ou salle + 6). */
export const nomCarte = (id: number) => SALLES[id] ?? (SALLES[id - 6] ? `${SALLES[id - 6]} (+6)` : SALLES[id - 2] ? `${SALLES[id - 2]} (+2)` : `carte ${id}`)

/**
 * Port du serveur du Meulou (journal, puis plans) : ni celui de la Reine et de la Baleine (8765), ni celui du Féca
 * (8766), pour que les serveurs tournent ensemble.
 */
export const PORT_MEULOU = 8767

/** Monstres du donjon (DofusDB). */
export const MULOU = 102
export const MEULOU = 232
export const CROC_GLAND = 299
export const MULOUBARD = 4866
export const COCHOLOU = 4867
export const MULOUNOKE = 4868
export const MERGRANLOU = 4869
/** Invocation du Meulou (Invocation de Milimeulou, 306). */
export const MILIMEULOU = 4870
export const MONSTRES_MEULOU = [MULOU, MEULOU, CROC_GLAND, MULOUBARD, COCHOLOU, MULOUNOKE, MERGRANLOU, MILIMEULOU]

/** Sorts des monstres qui comptent pour la stratégie [D]. */
export const SORT_MONSTRE = {
  /** Meulou, 3 PA, contact, vol Neutre 51-60 ; s'il tue sa cible, invoque un Mulou grade 5 à sa place. */
  etripage: 8653,
  /** Meulou, 5 PA, sous 80 % de PV : +400 PV, +20 Tacle, +2 PM ; relance 6. */
  rageReconstituante: 8654,
  /** Meulou, 4 PA, invoque un Milimeulou ; relance 8. Le Meulou a 2 invocations au plus. */
  invocationMilimeulou: 306,
  /** Croc Gland, 4 PA, 0-9 : désenvoûte (retire les buffs du Sacrieur) ; relance 4. */
  desenvoutementCanin: 8626,
  /** Cocholou, 4 PA, 1-9 : Air 21-30, dommages subis ×115 %. */
  dentsLongues: 8665,
  /** Mulounoké, 4 PA, croix autour de lui : 20 % d'érosion, −20 Tacle, −20 Fuite, −2 PO ; relance 2. */
  froidDeMulou: 8671,
  /** Mergranlou, 4 PA, 1-8 sur un allié : +200 Puissance, +4 PA, soin Feu 21-30. */
  chaperon: 8674,
  /** Milimeulou : la victime tuée est remplacée par un Mulou. */
  mulanthropie: 8657,
} as const

/**
 * Dommages d'un monstre sur le Sacrieur en un tour où il le touche (PV perdus, après ses boucliers), mesurés sur le donjon
 * joué à la main le 2026-10-19 (npm run meulou:bilan) : Cocholou 185 en moyenne (502 au plus), Mergranlou 111, Mulounoké
 * 205, Mulou 192, Muloubard 225, Meulou 404 (536 au plus, et il se soigne de la moitié), Milimeulou 88. Croc Gland : jamais
 * vu, estimé.
 */
export const DANGER_SACRI: Record<number, number> = {
  [MULOU]: 190, [MEULOU]: 420, [CROC_GLAND]: 150, [MULOUBARD]: 230, [COCHOLOU]: 220, [MULOUNOKE]: 210, [MERGRANLOU]: 120,
  [MILIMEULOU]: 90,
}
/**
 * Monstres qui frappent au contact (journaux du 2026-10-19) : leurs coups sont renvoyés par la Couronne d'Épines à tous
 * les ennemis au contact du Sacrieur. Cocholou et Mergranlou frappent à distance (4 à 10 cases) et la gardent.
 */
export const AU_CONTACT = new Set([MULOU, MEULOU, CROC_GLAND, MULOUBARD, MULOUNOKE, MILIMEULOU])

/** Le Sacrieur (choisi par le joueur, 2026-10-19) : Terre, niveau 190. Les mules passent leurs tours. */
export const SACRIEUR = 'Larry-Kind-jumploise'
/** Race du Sacrieur (breedId). */
export const SACRI = 11

/**
 * Caractéristiques du Sacrieur, relevées sur l'écran du joueur (2026-10-19) : 3 949 PV, 12 PA, 5 PM. Dommages : le
 * total par élément affiché (dommages fixes compris). Force 1 048, Intelligence 125, Agilité 270, Chance 0.
 */
export const PV_SACRIEUR = 3949
export const STATS_SACRIEUR: Stats = {
  ...emptyStats(),
  ap: 12, mp: 5, range: 0, summons: 4, initiative: 1868, wisdom: 187, prospecting: 255,
  strength: 1048, intelligence: 125, chance: 0, agility: 270, power: 80,
  critical: 42, criticalDamage: 10, heals: 2,
  neutralDamage: 58, earthDamage: 88, fireDamage: 28, waterDamage: 19, airDamage: 56,
  neutralRes: 8, earthRes: 24, fireRes: 19, waterRes: 35, airRes: 10,
  neutralResPct: 10, earthResPct: 20, fireResPct: 15, waterResPct: 0, airResPct: 0,
  criticalRes: 7,
  tackleBlock: 10, tackleEvade: -23, apReduction: 18, mpReduction: 18, apParry: 25, mpParry: 18,
}

/**
 * Variantes équipées (écran des sorts du joueur, 2026-10-19), aussi déclarées dans data/fightlogs/variantes.json :
 * Décimation, Afflux et Entaille ; tous les autres sorts sont ceux de base de leur paire.
 */
export const VARIANTES_SACRIEUR = ['Décimation', 'Afflux', 'Entaille']

/** Sorts équipés du Sacrieur (données 3.7, grade du niveau 190). */
export const SORT = {
  // Dommages Terre
  entaille: 12751, // variante de Hécatombe : 4 PA, contact, Terre 47-51, −10 % PV au lanceur
  punition: 12741, // 4 PA, contact, meilleur élément 31-35 + Neutre 35 % des PV érodés du lanceur ; relance 3
  ravage: 12746, // 3 PA, 1-6 en ligne, avance de 5, Terre 28-32
  decimation: 12731, // variante d'Hémorragie : 3 PA, 0-1 en ligne, Terre 29-32 en croix diagonale, dommages subis ×103 %
  supplice: 12725, // 3 PA, contact, vol Terre 22-26
  bainDeSang: 12732, // 4 PA, carré 3×3 autour de lui, vol Terre 27-31, +15 Tacle par entité
  afflux: 12729, // variante de Condensation : 2 PA, croix de 3 autour de lui, attire de 2, Terre 12-15
  // Dommages Neutre selon ses PV
  transfusion: 12738, // 2 PA, cercle de 3 autour de lui, Neutre 10 % de ses PV
  // Autres éléments (Force 1 048 contre Agilité 270, Intelligence 125, Chance 0 : peu de dommages)
  absorption: 12734, // 3 PA, 1-6, vol Feu 20-24, −150 Puissance à la cible 1 tour
  stase: 12728, // 3 PA, 1-5 sans ligne de vue, vol Eau 20-24, −20 % Critique 1 tour
  hostilite: 12756, // 2 PA, 1-6, Feu 15-18, repousse de 2
  dissolution: 12757, // 4 PA, 0-5, vol Eau 25-29 en croix, −30 Fuite
  desolation: 12753, // 4 PA, 1-4 en ligne, vol Air 26-30 et −3 PM en demi-cercle
  // Buffs, protection, soin
  mutilation: 12737, // 2 PA, +150 Puissance, −10 % PV à chaque début de tour ; relancé : bouclier (Coagulation)
  berserk: 12743, // 2 PA, −70 % PV, +10 % dommages aux sorts, Intaclable, soins reçus ×30 % ; relance 2
  couronneEpines: 12761, // 2 PA, bouclier 10 % PV max, Pesanteur en croix, renvoie les dommages de mêlée ; relance 3
  libation: 12759, // 2 PA, −30 % PV, durée de ses effets −1, soin en fin de tour selon la Souffrance ; relance 3
  sacrifice: 12739, // 2 PA, intercepte les dommages des alliés en cercle de 2 ; relance 4
  epeeVorace: 12744, // 3 PA, 1-3 en ligne, invoque une Épée Vorace ; relance 4
  // Déplacements
  attirance: 12735, // 2 PA, 2-10 en ligne, attire de 9 (13 en Souffrance 6+)
  transposition: 12736, // 3 PA, 1-9 (+4 en Souffrance 6+), échange ; relance 3
  assaut: 12733, // 2 PA, 1-2, échange, Air 14-17
} as const

/**
 * Souffrance (états 616 à 625) : selon les PV restants du Sacrieur, par tranche de 10 % (moins de 100 % : Souffrance 1,
 * moins de 50 % : Souffrance 6, moins de 10 % : Souffrance 10). Dommages subis et dommages finaux par niveau [D].
 * Souffrance 6 et plus (état 5380) : Attirance, Transposition et Liens du Sang +4 PO, Attirance 13 cases, Fluctuation
 * +4 PM, Couronne d'Épines +5 % de bouclier par ennemi dans sa zone, Pilori indélogeable.
 */
export const SOUFFRANCE = [
  { niveau: 1, subis: 0.99, finaux: 1 },
  { niveau: 2, subis: 0.97, finaux: 3 },
  { niveau: 3, subis: 0.95, finaux: 5 },
  { niveau: 4, subis: 0.91, finaux: 9 },
  { niveau: 5, subis: 0.86, finaux: 14 },
  { niveau: 6, subis: 0.81, finaux: 19 },
  { niveau: 7, subis: 0.77, finaux: 23 },
  { niveau: 8, subis: 0.74, finaux: 26 },
  { niveau: 9, subis: 0.72, finaux: 28 },
  { niveau: 10, subis: 0.7, finaux: 30 },
] as const

/** Niveau de Souffrance (0 à 10) pour une part de PV restants (0..1). */
export function souffranceDe(partPV: number): number {
  if (partPV >= 1) return 0
  return Math.min(10, Math.max(1, 10 - Math.floor(Math.max(0, partPV) * 10)))
}
