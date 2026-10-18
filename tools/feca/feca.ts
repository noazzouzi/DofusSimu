// Féca contre les Krobes : ses sorts utiles, ses protections et ce qu'il ne doit pas faire. Données du jeu 3.7
// (.cache/data-3.7) ; synthèse et vidéo de référence dans docs/strategies/krobes-feca/README.md.
import { BACTERRIB, PATAUGERME, PROTOZORREUR, TABACILLE, VERMINOCULE, VIRUSTINE } from '../ventre-de-la-baleine/donjon'

/** Race du Féca (breedId). */
export const FECA = 1

/**
 * Port du serveur du Féca (journal et plans, tools/feca/serveur.ts et FecaCombat.lua) : pas celui de la Reine et de la
 * Baleine (8765), pour que les deux serveurs tournent ensemble et qu'un Féca ne demande jamais son tour aux Crâs.
 */
export const PORT_FECA = 8766

export const SORT = {
  stratus: 13015,
  verglas: 13023,
  bulle: 12994,
  giboulee: 13022,
  terreBattue: 12987,
  barricade: 12979,
  bastion: 12995,
  bouclierFeca: 12982,
  fortification: 13009,
  rempart: 12981,
  ataraxie: 13027,
  defiance: 12988,
  barriere: 13019,
  refuge: 13021,
  treve: 12980,
  transhumance: 12986,
  bergerie: 12991,
} as const

export interface Protection {
  nom: string
  /** Multiplicateur des dommages reçus au contact et à distance. */
  melee: number
  distance: number
  /**
   * Durée (tours) : chaque retrait lui en ôte un (Bacterrib au début de son tour, Féca à 6 cases ou plus d'elle ;
   * Remontée gastrique de la Tabacille). Elle tombe au retrait numéro `tours`.
   */
  tours: number
  /** Multiplicateur de la première attaque reçue seulement (Ataraxie), au lieu de `melee` et `distance`. */
  premiere?: number
  /** Glyphe-aura posé sur la case visée : le Féca doit y finir son tour. */
  aura?: boolean
}

/**
 * Protections que le Féca pose sur lui-même [D], sauf [R] (valeur fixe du jeu inconnue, estimée). Durées mesurées sur
 * les 218 coups reçus par Kaskyzo le 2026-10-17 (coups rapportés à leur valeur habituelle) :
 * - Barricade + Bastion intacts : 0 dommage, même en critique ; tous deux retirés au premier retrait (journal : « effets
 *   retirés », +2 PM et +200 Puissance) ;
 * - Ataraxie : jamais retirée par un retrait, seulement par la première attaque (×0,06 à ×0,24 sur celle-ci) ;
 * - Bouclier Féca : tient un retrait (Rempart + Bouclier après un retrait : ×0,44 à ×0,51, comme intacts), pas deux ;
 * - Rempart seul après un retrait : ×0,9 (retiré) [R].
 */
export const PROTECTIONS: Record<number, Protection> = {
  [SORT.barricade]: { nom: 'Barricade', melee: 0, distance: 1, tours: 1 },
  [SORT.bastion]: { nom: 'Bastion', melee: 1, distance: 0, tours: 1 },
  [SORT.bouclierFeca]: { nom: 'Bouclier Féca', melee: 0.7, distance: 0.7, tours: 2 },
  [SORT.fortification]: { nom: 'Fortification', melee: 0.8, distance: 0.8, tours: 1 }, // [R]
  [SORT.rempart]: { nom: 'Rempart', melee: 0.85, distance: 0.85, tours: 1 }, // [R]
  [SORT.ataraxie]: { nom: 'Ataraxie', melee: 1, distance: 1, tours: Infinity, premiere: 0.25 },
  [SORT.defiance]: { nom: 'Défiance', melee: 0.7, distance: 1, tours: 1, aura: true },
  [SORT.barriere]: { nom: 'Barrière', melee: 1, distance: 0.7, tours: 1, aura: true },
  [SORT.refuge]: { nom: 'Refuge', melee: 0.85, distance: 0.85, tours: 2, aura: true },
}

/**
 * Dommages d'un Krobe sur le Féca en un tour, quand il le touche : mesurés sur les combats de Kaskyzo du 2026-10-17
 * (Baleine, salles 2, annexe et 4 : 430 à 440 en moyenne, 820 au plus), marge comprise. Les Crâs en prenaient 2 à 3 fois
 * plus (DANGER du planificateur des Crâs). Virustine : 313 à 1 465 par tour (Contamination 557 puis Boulet Viral 908, Roc
 * des Salbatroces, 2026-10-17 au matin ; le Boulet croît avec ses PM restants). Tabacille, Protozorreur : au prorata des
 * Crâs.
 */
export const DANGER_FECA: Record<number, number> = {
  [VERMINOCULE]: 650,
  [BACTERRIB]: 600,
  [PATAUGERME]: 600,
  [VIRUSTINE]: 1100,
  [TABACILLE]: 450,
  [PROTOZORREUR]: 900,
}

/**
 * Ligne de Brûlure d'estomac que chaque élément reçu ajoute au tour suivant du Pataugerme, sur le Féca (2026-10-17,
 * salle 4 : 64 à 198 par ligne élémentaire, 25 à 122 pour la ligne Neutre ; Brûlure de 444 à 664 avec les 4 éléments).
 */
export const BRULURE_PAR_ELEMENT = 130

/**
 * Portée d'attaque d'un Krobe depuis sa case d'arrivée (sorts, zones, attirance comprises) : Verminocule, Gonflement en
 * étoile de 3 (il attire) ; Pataugerme, Brûlure à 4 cases en cercle de 2 ; Virustine, Boulet Viral à 3 ; Tabacille,
 * Échange subtil à 4 ; Bacterrib, Sécrétion à 10. Sert à prévoir le tour suivant (distance, sans les obstacles).
 */
export const PORTEE_ATTAQUE: Record<number, number> = {
  [VERMINOCULE]: 3,
  [PATAUGERME]: 6,
  [VIRUSTINE]: 3,
  [TABACILLE]: 4,
  [BACTERRIB]: 10,
}

/**
 * Remontée gastrique de la Tabacille (4 PA) : durée des effets du Féca −1, donc ses protections d'un tour tombent avant
 * les coups des Krobes qui jouent après elle (2026-10-17, Roc des Salbatroces : Bastion, Barricade et Ataraxie retirés
 * deux fois au 1er tour, puis −904 et −1 275 PV). Portée relevée dans les journaux : 2 ou 4 cases, toujours en diagonale
 * (480 lancers ; 1 à 2 dans les données 3.7).
 * Pour s'approcher, elle s'échange avec ses alliés (Échange subtil : 4 cases, 4 PA, deux fois par tour).
 */
export const PORTEE_REMONTEE = 4
export const PORTEE_ECHANGE = 4
export const ECHANGES_PAR_TOUR = 2

/** Part des dommages de chaque Krobe portée au contact, le reste à distance (sorts des monstres, données 3.7). */
export const MELEE: Record<number, number> = {
  [VERMINOCULE]: 1, // Gonflement l'attire au contact, puis Jet d'acide
  [VIRUSTINE]: 0.5, // Boulet Viral (1-3), Contamination (contact)
  [TABACILLE]: 0.3, // Échange subtil (1-4), Remontée gastrique (1-2)
  [BACTERRIB]: 0, // Sécrétion, Danse répulsive (6-10)
  [PATAUGERME]: 0.5,
  [PROTOZORREUR]: 0.5,
}

/** Sorts écartés : Trêve rend Pacifiste tout ce qui est dans son glyphe, le Féca compris. */
export const ECARTES = new Set<number>([SORT.treve])

/** Sorts qui téléportent le Féca sur une case libre : cases d'arrivée cherchées loin des Bacterribs. */
export const TELEPORTS = new Set<number>([SORT.transhumance])

/**
 * Objet « Le Singe et la Lune » (sort 6149, lancé par le porteur au début du combat) : soigne de 10 % de sa vie au début de
 * ses tours 3, 6, 9… Tout soin relance les Tabacilles, et le journal, muet pendant le tour du Féca, ne le voit pas
 * (2026-10-17, 13:26 : Tabacille relancée en manche 3 puis 6, jamais morte ; Féca tué par la Malamibe).
 */
export const SINGE_ET_LUNE = 6149
export const SOIN_PERIODE = 3

/**
 * État Inébranlable (157, « ne peut pas être poussé ») : le Gonflement du Verminocule n'attire plus le Féca. Bergerie le
 * donne dans son glyphe-aura ; la Pesanteur d'Ataraxie n'empêche que les échanges (état 7) — Féca attiré 3 fois sur 10
 * sous Ataraxie le 2026-10-17.
 */
export const INEBRANLABLE = 157

/**
 * Lanterne du Berger (monstre 7841), invoquée sur case libre par Verglas, Vallée, Défiance, Terre Battue, Refuge,
 * Barrière : un leurre. Vidéo de référence, combats 2 et 3 : un Verminocule (Gonflement −302, Jet d'acide −13) et une
 * Tabacille (Remontée gastrique −315) l'ont frappée au lieu du Féca. Le monstre leurré ne garde pour le Féca que
 * `LEURRE` de ses coups (une attaque sur trois). [R] : les combats de Kaskyzo n'en ont jamais posé.
 */
export const LANTERNE = 7841
export const LEURRE = 1 / 3

/** PV d'une Malamibe face à un personnage seul (1 + 2 000 par personnage). */
export const MALAMIBE_PV = 2001
/**
 * Coup d'arme du Féca (spellId 0 pour AnkaBot : « Coup de poing », l'arme équipée, au corps à corps), sur les mules et les
 * tueuses seulement. Mesuré sur les 3 essais du 2026-10-18 (00:38 à 00:42) : accepté par AnkaBot ; 5 PA (le sort suivant
 * refusé faute de PA avec 4) ; par cible, une ligne Eau de 355 à 493 et deux lignes Air de 81 à 114 (≈ 700 sur une mule,
 * 1,5 à 1,75 fois une Bulle sur la même cible) ; zone : la cible et ses cases voisines (mule derrière la cible touchée,
 * Virustine à côté d'elle aussi), jamais le Féca. Modèle : une ligne Eau (dés de Bulle × 1,8), en croix de 1.
 */
export const ARME = { pa: 5, parTour: 1, effet: 96, element: 3, min: 30, max: 36, zone: 'X', taille: 1 }

/**
 * Réglages du plan rapide (demande `rapide=1`, PLAN_RAPIDE du script) : 2 cases de tir, faisceau de 4, 5 fins de tour
 * (8, 32 et 40 pour le plan complet). Mesuré sur 59 tours de Kaskyzo du 2026-10-18 (00:00 à 00:26), sur un seul fil :
 * 294 ms en médiane, 1,1 s au plus (1er tour avec les mules), contre 1,2 s et 5,6 s ; 23 plans moins bons de plus de 50
 * points, premier pas différent 14 fois. Le script n'en joue donc que le premier pas, puis demande le plan complet.
 */
export const PLAN_RAPIDE = { shootCells: 2, beam: 4, finishers: 5 }

/** PV de la Malamibe par personnage vivant : une mule tuée lui en retire autant (vidéo : 16 001 → 2 001 PV, 7 mules). */
export const MALAMIBE_PAR_PERSO = 2000
/**
 * PV des mules comptés dans les plans (×) : une mule n'est donnée pour morte qu'avec de la marge (jets moyens du moteur ;
 * 2026-10-17 à 21:51, mule à 89 PV visée par Kyanna-Lee, 16 PV restants, Malamibe ratée de 31 PV).
 */
export const MARGE_MULE = 1.3
/**
 * Même marge pour les plans de Kyanna-Lee (tueuse) : le moteur surestime ses coups. 2026-10-18 (01:19 à 01:23), 9 coups
 * Eau sur les mules : 0,59 à 0,94 fois la prévision, 0,8 en moyenne (Œil de Taupe, Flèches Glacée et d'Immobilisation,
 * après Tirs Puissants ou non) ; avec 1,3, Kimera-Meruem et Larry-Kind-jumploise laissées à 177 et 53 PV, Malamibe ratée
 * d'environ 450 PV. Les Bulles du Féca tombent juste (372 prévus, 372 portés).
 */
export const MARGE_MULE_TUEUSE = 1.6

/**
 * Personnages joués par le serveur du Féca (tools/ankabot/FecaCombat.lua, chargé sur le chef et par AnkaBot sur les
 * mules) : le Féca, et Kyanna-Lee (Crâ 199, planificateur des Crâs de la Baleine), qui frappe les Krobes (chaque coup
 * compte double sur la Malamibe) et peut achever les mules (consigne du joueur, 2026-10-17). Tout autre personnage du
 * groupe est une mule : placée en appât, elle passe ses tours.
 */
export const JOUEURS = ['Kaskyzo', 'Kyanna-Lee']
/**
 * Tueuses (consigne du joueur, 2026-10-17, comme la mule Lycris de la vidéo) : placées avec les mules, elles les tuent à
 * leur 1er tour à coups de sorts de zone, puis vont mourir chez les monstres ; le Féca entame leurs PV à son 1er tour,
 * sans les tuer tant qu'une mule vit. But : à la fin de la manche 1, seul le Féca reste (Malamibe à 2 001 PV).
 */
export const TUEUSES = ['Kyanna-Lee']
/** Éléments des sorts d'attaque des tueuses : Eau (Kyanna-Lee équipée Eau ; ses sorts Terre ne font presque rien). */
export const ELEMENTS_TUEUSES = [3]

/** Les attaques des Krobes coûtent 4 PA : 12 PA font 3 attaques, 8 à 11 PA deux. */
export const PA_ATTAQUE = 4
export const attaquesDe = (ap: number) => Math.max(0, Math.min(3, Math.floor(Math.round(ap) / PA_ATTAQUE)))
