// Classement des sorts du Crâ selon les contraintes de la formation (données : sorts-effets.txt).
//  SUR       : cible unique (ou zone « ennemis seulement »), ne déplace ni le lanceur ni un allié.
//  ZONE      : zone qui touche aussi les alliés (Crâs) et les bombes (masques a / g), sans déplacement : seulement si
//              aucun allié ni aucune bombe n'est dans la zone.
//  POUSSE    : pousse ou attire tout ce qui est dans sa zone, alliés et bombes compris : seulement sur une cible loin
//              de la colonne (aucun allié/bombe dans la zone).
//  INTERDIT  : déplace le LANCEUR (recul, avance, téléportation, échange) ou attire les alliés (piège) — casse la règle
//              « chaque Crâ finit son tour sur sa case et n'est jamais déplacé ».
//  BUFF      : soi-même (aucun effet sur les alliés).
export const SUR = new Set([32426, 32435, 32708, 32531, 32444, 32433, 32427, 32436, 32448, 32471, 32456, 32460, 32438, 32442, 32446, 32450, 32472])
export const BUFF = new Set([32466, 32465, 32475, 32469])
export const ZONE = new Set([32445, 32457, 32437, 32431, 32454, 32439, 32441, 32453, 32432, 32467])
export const POUSSE = new Set([32429, 32449, 32443, 32428, 32459])
export const INTERDIT = new Set([32455, 32458, 32447, 32464, 32470, 32473, 32474, 32618])

export const WHY: Record<number, string> = {
  32426: 'pousse la CIBLE de 2 (cible unique) — chasse un monstre d\'une case de bombe',
  32449: 'repousse de 2 tout ce qui est sur les 4 diagonales de la cible (masque a,A : alliés compris)',
  32435: 'cible unique, −2 PA',
  32708: 'cible unique, SANS ligne de vue (PO 1-10 non modifiable), dégâts au début du tour de la cible',
  32455: 'le LANCEUR recule de 3 cases (effet 1041)',
  32531: 'à distance : pousse la cible de 2, −1 PA ; au contact : le LANCEUR recule de 2',
  32443: 'repousse de 1 tout ce qui est sur la ligne perpendiculaire (T2), alliés compris',
  32459: 'repousse de 3 tout ce qui est dans la fourche F2 (alliés compris), PO 1-3 en ligne',
  32464: 'téléporte le LANCEUR de 2 cases (impossible sous Pesanteur)',
  32467: 'invoque une balise (occupe une case) ; frappée, elle ATTIRE de 2 tout ce qui est à 3 cases (alliés compris)',
  32465: '+6 PO max et +3 PO min à tous les sorts du Crâ (1 tour) ; +3 PO aux alliés NON Crâs seulement',
  32471: '×115 % sur le prochain coup subi par la cible (un seul Tir Perçant actif par cible), érosion 25 %',
  32444: 'cible unique ; l\'explosion (C2 sans centre) ne touche que les ennemis',
  32439: 'cône V2 : dégâts, −2 PA, −1 PM sur tout ce qui est dedans, alliés compris',
  32453: '1er lancer cible unique, 2e en croix X1, 3e en cercle C2 : alliés compris',
  32433: 'cible unique ; 2e coup si la cible n\'est plus en ligne de vue au début du tour suivant',
  32427: 'cible unique, −2 PM',
  32458: 'à distance : le LANCEUR avance de 3 vers la cible (1042) ; au contact : pousse la cible de 3',
  32436: 'cible unique, vole 1 PM',
  32448: 'cible unique (poison de fin de tour)',
  32466: 'soi : +250 Puissance, +15 % CC, −3 PO (1 tour)',
  32618: 'pose « Sacrifice » / partage des dommages entre alliés',
  32428: 'repousse les alliés et ennemis autour de la cible (anneaux Q1/Q2)',
  32447: 'le LANCEUR recule de 1 et repousse de 2 toute la ligne L4 (alliés compris)',
  32445: 'cercle C3 : alliés et bombes compris (PO min 4)',
  32457: 'demi-cercle U1 : alliés compris',
  32437: 'cercle C2 : alliés compris (−3 PO aux alliés), dévoile les invisibles',
  32431: 'cercle C3 : tous sauf le lanceur (alliés compris), 2e pluie au tour suivant ; 2 lancers/tour pour l\'équipe',
  32454: 'croix X1 : tous sauf le lanceur (alliés compris)',
  32441: 'carré G1 : alliés compris (−1 PA −2 PM)',
  32474: 'balise : soigne 7 % PV max à tous les alliés 2 tours, mais ÉCHANGE de position avec le Crâ sur déclenchement',
  32472: 'croix X1 : Pesanteur (état 7) sur alliés ET ennemis, ×110 % aux dégâts subis par les ennemis (2 tours) ; 1 lancer/tour pour l\'équipe',
  32470: 'le LANCEUR recule de 2 (cible ennemie) ou avance de 2 (cible alliée) ; +2 PO',
  32473: 'piège : attire de 3 tout ce qui est à 3 cases (alliés compris)',
  32456: 'cible unique, rampe +24/+32 aux tours suivants, érosion 15 %',
  32460: 'cible unique ; 1re ligne × PM restants / PM max (PM utilisés avant le tir = perte)',
  32438: 'cible unique, PO min 6, relance 2, rampe +36 aux tours +2 et +4',
  32442: 'cible unique',
  32429: 'ligne L3 derrière la cible : repousse de 3 tout ce qui s\'y trouve (alliés compris)',
  32432: 'cible puis retour : touche aussi les entités sur la ligne de retour (alliés compris, −2 PM)',
  32446: 'cible unique ; 4 lancers/tour pour TOUTE l\'équipe ; détonation sur les ennemis marqués',
  32450: 'rebondit sur les ennemis à 2 cases ; 1 lancer/tour pour TOUTE l\'équipe',
  32469: 'soi : +3 PO min, LIGNE DE VUE DÉSACTIVÉE 1 tour, +15 % CC ; relance 4',
  32475: 'soi : +20 % dommages distance, +10 PO 2 tours, −2 % et −1 PO par PM utilisé ; dévoile les invisibles ; 1/tour équipe',
}

export const ofMode = (mode: 'libre' | 'zones' | 'strict', all: number[]): Set<number> =>
  new Set(all.filter(s => mode === 'libre' || SUR.has(s) || BUFF.has(s) || (mode === 'zones' && ZONE.has(s))))
