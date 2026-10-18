// Ventre de la Baleine (donjon 84, Protozorreur) : monstres, états et mécaniques, partagés par les outils de ce dossier
// (bilan.ts : journaux des combats ; menaces.ts : cases que les monstres peuvent toucher). Sources : données du jeu 3.7
// (.cache/data-3.7, descriptions des sorts de départ) et fiche https://www.dofuspourlesnoobs.com/ventre-de-la-baleine.html ;
// synthèse dans docs/strategies/ventre-de-la-baleine/README.md.

export const DONJON = 84

/**
 * Salles connues : carte où se joue le combat (relevée en jeu) et carte de la salle dans les données du donjon. Comme
 * pour la Reine (137101316 et non 137101312), le combat se joue sur une autre carte que celle de la salle : 140771332 a
 * les mêmes cases de placement que 140771328, mais 214 cases praticables au lieu de 300.
 */
export const SALLES: { salle: string; carte: number; carteSalle?: number }[] = [
  { salle: 'Salle 1', carte: 140771332, carteSalle: 140771328 },
  { salle: 'Salle 2', carte: 140772356, carteSalle: 140772352 },
  { salle: 'Salle annexe', carte: 140773380, carteSalle: 140773376 },
]

export const salleDeCarte = (carte: number) => SALLES.find(s => s.carte === carte || s.carteSalle === carte)?.salle

export const MALAMIBE = 3822
export const TABACILLE = 3823
export const VERMINOCULE = 3824
export const BACTERRIB = 3825
export const VIRUSTINE = 3826
export const PATAUGERME = 3827
export const PROTOZORREUR = 3828

export interface Krobe {
  nom: string
  /**
   * Sorts de la Restauration du monstre : leurs effets sont retirés puis reposés quand le compte à rebours est
   * réinitialisé ; l'effet 141 (« Tue la cible », délai 3, 6 pour le boss) de l'un d'eux (re)lance le compte à rebours.
   */
  restauration: number[]
  /** Condition à tenir à chaque tour pour que le compte à rebours aille au bout. */
  condition: string
  /** Tours du compte à rebours (délai de l'effet 141). */
  tours: number
  /** Variante « Nécro » : le Krobe dont elle reprend la Restauration. */
  base?: number
}

/** Krobes (monstres du donjon) et variantes « Nécro » (5212-5215, mêmes Restaurations dans les données). */
export const KROBES: Record<number, Krobe> = {
  [TABACILLE]: { nom: 'Tabacille', restauration: [5179, 4938, 4937], tours: 3, condition: 'aucun personnage soigné (sinon réinitialisé) ; +150 Puissance à chaque début de tour' },
  [VERMINOCULE]: { nom: 'Verminocule', restauration: [4942, 4941, 4965, 4944, 4974], tours: 3, condition: 'un personnage à son contact au début de son tour' },
  [BACTERRIB]: { nom: 'Bacterrib', restauration: [4948, 4946, 4947], tours: 3, condition: 'aucun personnage à 5 cases ou moins au début de son tour' },
  [VIRUSTINE]: { nom: 'Virustine', restauration: [4953, 4951, 4952], tours: 3, condition: 'jamais poussée, attirée, échangée, portée ni visée par un retrait de PM ; −1 PM par dommage de poussée' },
  [PATAUGERME]: { nom: 'Pataugerme', restauration: [4959, 4956, 4957], tours: 3, condition: 'touché en Feu, Eau, Air et Terre entre deux de ses tours' },
  [PROTOZORREUR]: { nom: 'Protozorreur', restauration: [4972, 4971, 4970, 4969, 4968, 4966, 4967], tours: 6, condition: 'Infection (glyphe violet) au moins tous les 2 tours, 6 tours de suite' },
  5212: { nom: 'Nécrobacterrib', base: BACTERRIB, restauration: [4948, 4946, 4947], tours: 3, condition: 'aucun personnage à 5 cases ou moins au début de son tour' },
  5213: { nom: 'Nécrotabacille', base: TABACILLE, restauration: [5179, 4938, 4937], tours: 3, condition: 'aucun personnage soigné' },
  5214: { nom: 'Nécroverminocule', base: VERMINOCULE, restauration: [4942, 4941, 4965, 4944, 4974], tours: 3, condition: 'un personnage à son contact au début de son tour' },
  5215: { nom: 'Nécrovirustine', base: VIRUSTINE, restauration: [4953, 4951, 4952], tours: 3, condition: 'jamais déplacée ni visée par un retrait de PM' },
}

export const isKrobe = (monsterId?: number) => monsterId !== undefined && monsterId in KROBES
/** Krobe de base d'un monstre (une variante « Nécro » donne celui dont elle reprend la Restauration). */
export const baseKrobe = (monsterId: number) => KROBES[monsterId]?.base ?? monsterId
/** Monstre propre à ce donjon (Krobe ou Malamibe) : sert à reconnaître ses combats dans un journal. */
export const isBaleineMonster = (monsterId?: number) => monsterId === MALAMIBE || isKrobe(monsterId)

/** Effet « Tue la cible » : posé avec un délai par chaque Restauration (compte à rebours de la mort du Krobe). */
export const KILL_EFFECT = 141
/** Effets « État » posé / retiré. */
export const STATE_ADD = 950
export const STATE_REMOVE = 951
/** Puissance (Tabacille, Protozorreur à chaque début de tour) et −PM permanent de la Virustine (dommage de poussée). */
export const POWER_EFFECT = 138
export const MP_MALUS_EFFECT = 169
/** Sort de la Virustine qui lui retire 1 PM à chaque dommage de poussée. */
export const VIRUSTINE_PUSH_MALUS = 4952

export const ETAT = {
  pesanteur: 7,
  porte: 8,
  invulnerable: 56,
  indeplacable: 97,
  disloque: 214,
  infection: 215,
  feu: 479,
  eau: 480,
  air: 481,
  terre: 482,
} as const

/** États « élément reçu » du Pataugerme (durée 1) : les quatre ensemble lui donnent l'Infection. */
export const ELEMENT_STATES: Record<number, string> = { 479: 'Feu', 480: 'Eau', 481: 'Air', 482: 'Terre' }

/**
 * Sorts des Crâs à NE PAS lancer sur la Virustine (ni sur une zone qui la contient) : ils la déplacent ou tentent de lui
 * retirer des PM, ce qui réinitialise son compte à rebours (données 3.7). Une poussée qui la bute contre un obstacle
 * sans la déplacer ne la réinitialise pas et lui retire 1 PM (dommage de poussée). Flèche Vagabonde et Tir de Repli
 * n'y sont pas : leur recul (effet 1041) déplace le Crâ qui les lance, pas sa cible.
 */
export const CRA_DEPLACE_OU_RETIRE_PM: Record<number, string> = {
  32426: 'Flèche de Recul (poussée 2)',
  32427: 'Flèche Cinglante (−2 PM)',
  32428: 'Flèche de Dispersion (poussée en zone)',
  32429: 'Flèche Perforante (poussée 3 en ligne)',
  32436: "Flèche d'Immobilisation (vol de PM)",
  32439: 'Flèche Ralentissante (−1 PM en zone)',
  32443: 'Flèche de Barrage (poussée 1 en zone)',
  32458: 'Flèche Assaillante (poussée 3)',
  32467: 'Balise Tactique (attire et repousse autour d’elle)',
  32531: 'Flèche Évasive (poussée 1)',
}

/** Sorts des Crâs qui soignent un allié : ils réinitialisent les Tabacilles (le vol de vie, d'après la fiche, non). */
export const CRA_SOINS: Record<number, string> = {
  32474: 'Balise de Survie (7 % des PV max à toute l’équipe)',
}
