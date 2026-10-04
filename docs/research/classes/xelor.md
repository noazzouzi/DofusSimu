# Xélor (classe 5) — analyse complète pour le simulateur

> Données : API DofusDB (`/breeds/5`, `/spell-variants?breedId=5`, `/spells`, `/spell-levels`, `/spell-states`, `/monsters`),
> fichiers du jeu Dofus 3 (enregistrements mis à jour jusqu'au 2026-06-23), extraits le 2026-10-04 ; les données
> `data/dofusdb/class-spells.json` du dépôt ont été vérifiées identiques à l'API live (91 niveaux de sorts, 0 écart).
> Toutes les valeurs sont celles du **grade le plus élevé utilisable au niveau 200**. Les guides web ne servent qu'à
> l'interprétation ; en cas de désaccord, les données du jeu priment. Fichier machine associé :
> [`data/research/class-mechanics/xelor.json`](../../../data/research/class-mechanics/xelor.json). Dump brut décodé (tous
> sous-sorts développés) : `.cache/classes/b5_8/dump/breed_5.txt` (non versionné).

**Identité** : « Maître du temps » (complexité 5, la plus élevée du jeu). Rôles officiels DofusDB (`breeds/5.roles`, /12) :
**Placement 9** (« déplace les alliés et ennemis en manipulant le temps »), **Entrave 7** (« retire des points d'action »),
**Dégâts 7** (« optimise ses dégâts en manipulant le temps »), Amélioration 4, Tank 2, Invocation 2, Protection 0, Soin 0.

**Résumé tactique** : le Xélor est un **placeur-entraveur** qui joue dans les 4 éléments (Feu : Perturbation, Poussière,
Rayon Obscur, Sablier, Réfraction, Sables du Temps ; Terre : Rouage, Frappe de Xélor, Engrenage, Aiguille, Horloge,
Régulateur ; Eau : Gelure, Permutation, Compte-goutte, Ralentissement, Clepsydre, Pétrification ; Air : Souvenir, Pendule,
Flétrissement, Dessèchement, Gousset, Distorsion ; Glas = 4 éléments). Toute la classe tourne autour de l'état
**Téléfrag** : quand une téléportation (ou un échange de positions) d'un sort Xélor fait atterrir une entité sur une case
occupée, les deux entités échangent leurs places et passent en Téléfrag pendant 2 tours ; le Xélor gagne **+2 PA (une
fois par sort et par tour)**. Les sorts « consommateurs » retirent ensuite ce Téléfrag pour un bonus (dégâts de base,
retrait/vol de PA, PM, zone, relance…). Ses outils d'entrave sont nombreux (−1 à −2 PA esquivables sur la plupart des
sorts Eau/Terre, Flou Temporel −2 PA non esquivables en zone, Cadran/Instabilité −2 PA en aura) et son placement est le
plus riche du jeu (symétries, retours à la position précédente / de début de tour, échanges, pièges de symétrie).
Pour un moteur de combat, c'est la classe la plus exigeante : il faut **historiser la position précédente et la position
de début de tour de chaque entité**, gérer les échanges en cas de case occupée et propager les déclencheurs Téléfrag.

## Sommaire

- Tableau des 22 paires · Efficacité brute · Mécaniques spécifiques · Détail de tous les sorts · Invocations · Rôle en groupe PvM (variantes, rotations, synergies) · États importants · Points incertains · Sources

## Tableau des 22 paires de sorts (variantes)

Chaque ligne est une paire de variantes : un personnage n'équipe qu'**un seul** sort de chaque paire (choix hors combat). Le niveau indiqué est celui du déblocage.

| # | Variante A | PA | Variante B | PA | Notes |
|---|---|---|---|---|---|
| 1 | Perturbation (13288, niv. 1) | 3 | Rouage (13283, niv. 95) | 4 | Perturbation (mono-cible, en ligne, vol Feu) pour générer un Téléfrag à coup sûr contre un allié collé ; Rouage (anneau 2) pour les paquets. |
| 2 | Gelure (13245, niv. 1) | 2 | Poussière (13257, niv. 100) | 4 | Gelure (2 PA, sans LdV, 4/tour) est le générateur de Téléfrag le moins cher ; Poussière pour la zone Feu. |
| 3 | Souvenir (13281, niv. 1) | 2 | Permutation (13285, niv. 105) | 4 | Souvenir (2 PA, vol Air) en filler ; Permutation (échange à 2 PO exactement) pour sauver un allié ou placer. |
| 4 | Frappe de Xélor (13252, niv. 1) | 3 | Pendule (13294, niv. 110) | 4 | Frappe de Xélor (symétrie de la cible) très polyvalente ; Pendule pour un burst Air de zone sans LdV. |
| 5 | Complice (13287, niv. 5) | 2 | Cadran de Xélor (13258, niv. 115) | 3 | Cadran pour l'entrave/soutien PA ; Complice comme ancre mobile (Paradoxe/Faille) et renvoi 75 %. |
| 6 | Téléportation (13249, niv. 10) | 2 | Astrolabe (13282, niv. 120) | 2 | Téléportation (relance réinitialisée par les Téléfrags) = mobilité principale ; Astrolabe pour échanger/revenir. |
| 7 | Flétrissement (13254, niv. 15) | 3 | Aiguille (13244, niv. 125) | 2 | Flétrissement (Air, rampe +6 sur Téléfrag) ; Aiguille (poison Terre) pour un Xélor Terre. |
| 8 | Engrenage (13299, niv. 20) | 3 | Compte-goutte (13259, niv. 130) | 3 | Engrenage (croix, Terre) génère plusieurs Téléfrags ; Compte-goutte double retour (cible + lanceur). |
| 9 | Fuite du Temps (13251, niv. 25) | 1 | Prémonition (13293, niv. 135) | 2 | Fuite du Temps (1 PA) protège un allié et prépare un retour ; Prémonition pour une téléportation différée. |
| 10 | Rayon Obscur (13253, niv. 30) | 4 | Dessèchement (13284, niv. 140) | 4 | Rayon Obscur (Feu, ligne, +12 par Téléfrag) ; Dessèchement (Air, rebonds, +PM). |
| 11 | Ralentissement (13242, niv. 35) | 2 | Sablier de Xélor (13261, niv. 145) | 2 | Ralentissement (−1 PA, vol sur Téléfrag) est le cœur du retrait PA ; Sablier pour la voie Feu. |
| 12 | Flou Temporel (13246, niv. 40) | 2 | Conservation (13291, niv. 150) | 2 | Flou Temporel (−2 PA non esquivables en zone) ; Conservation (×0,76 dégâts subis) pour protéger. |
| 13 | Raulebaque (13262, niv. 45) | 2 | Instabilité (13301, niv. 155) | 3 | Raulebaque (masse de Téléfrags, 2 PA, relance 2) ; Instabilité (glyphe + aura −2 PA). |
| 14 | Horloge (13256, niv. 50) | 4 | Clepsydre (13298, niv. 160) | 4 | Horloge (Terre, +24 dégâts de base) ou Clepsydre (Eau, +1 PA au tour suivant). |
| 15 | Réfraction (13286, niv. 55) | 2 | Régulateur (13248, niv. 165) | 3 | Réfraction (Feu, propage le Téléfrag et frappe en zone) ; Régulateur (Terre, désenvoûtement −1 tour). |
| 16 | Rembobinage (13243, niv. 60) | 2 | Rémanence (13255, niv. 170) | 3 | Rembobinage (retour début de tour, sauvetage d'allié) ; Rémanence (anti-fuite). |
| 17 | Paradoxe (13250, niv. 65) | 2 | Faille (13295, niv. 175) | 4 | Paradoxe (double symétrie autour du Complice/Cadran) ; Faille (échange + retour, protège la Synchro). |
| 18 | Pétrification (13290, niv. 70) | 4 | Gousset (14651, niv. 180) | 2 | Pétrification (Eau, coût réduit) ; Gousset (Air, explosion différée). |
| 19 | Distorsion (13289, niv. 75) | 4 | Sables du Temps (13292, niv. 185) | 4 | Distorsion (carré 3×3 Air, retours) ; Sables du Temps (Feu, rebonds). |
| 20 | Désynchronisation (13296, niv. 80) | 2 | Espace-temps (13297, niv. 190) | 2 | Désynchronisation (piège de symétrie) ; Espace-temps (allié protégé / renvoi). |
| 21 | Momification (13260, niv. 85) | 2 | Vingt-cinquième Heure (14650, niv. 195) | 3 | Momification (+2 PM, +60 Retrait PA, Intaclable) ; Vingt-cinquième Heure contre Pesanteur/Enracinement. |
| 22 | Synchro (13247, niv. 90) | 2 | Glas (13300, niv. 200) | 4 | Synchro (explosion multipliée) ou Glas (4 éléments, nécessite une consommation de Téléfrag). |

## Efficacité brute des sorts de dommages (grade niveau 200, avant caractéristiques)

Moyenne du jet de base (hors critique) ; « /PA » = moyenne ÷ coût. Les bonus conditionnels (rampes, Téléfrag, cartes…) sont indiqués en remarque. Un sort de zone touche potentiellement plusieurs cibles.

| Sort | Paire | PA | Élément | Base | CC | Moy. | Moy./PA | Zone | Lancers/tour | Remarque |
|---|---|---|---|---|---|---|---|---|---|---|
| Flétrissement | 7A | 3 | Air | 25–28 | 30–34 | 26.5 | 8.8 | cible | 3 | +6/Téléfrag (cumul 3) |
| Régulateur | 15B | 3 | Terre | 25–28 | 30–34 | 26.5 | 8.8 | cible | 1 | +1 lancer sur Téléfrag |
| Clepsydre | 14B | 4 | Eau | 33–37 | 40–44 | 35.0 | 8.8 | cible | 3 | +1 PA au tour suivant sur Téléfrag |
| Pendule | 4B | 4 | Air | 33–36 | 40–43 | 34.5 | 8.6 | cible | 2 | + même dégâts en anneau 1–2 autour du lanceur |
| Sables du Temps | 19B | 4 | Feu | 33–36 | 40–43 | 34.5 | 8.6 | cible | 1 | rebonds (anneau 1–2) |
| Réfraction | 15A | 2 | Feu | 16–18 | 19–22 | 17.0 | 8.5 | cible | 3 | cercle 2 si cible Téléfrag |
| Perturbation | 1A | 3 | Feu | 23–26 | 28–31 | 24.5 | 8.2 | cible | 3 | vol de vie |
| Rayon Obscur | 10A | 4 | Feu | 31–34 | 37–41 | 32.5 | 8.1 | ligne de 4 cases (impact + 3 derrière), non dégressive | 1 | +12 par Téléfrag |
| Dessèchement | 10B | 4 | Air | 31–34 | 37–41 | 32.5 | 8.1 | cible | 1 | rebonds (anneau 1–2), +1 PM/Téléfrag |
| Ralentissement | 11A | 2 | Eau | 15–17 | 18–20 | 16.0 | 8.0 | cible | 4 |  |
| Frappe de Xélor | 4A | 3 | Terre | 22–25 | 26–30 | 23.5 | 7.8 | cible | 3 |  |
| Engrenage | 8A | 3 | Terre | 22–24 | 26–29 | 23.0 | 7.7 | croix de 1, non dégressive | 2 |  |
| Poussière | 2B | 4 | Feu | 29–32 | 35–38 | 30.5 | 7.6 | cercle de rayon 2 | 2 |  |
| Distorsion | 19A | 4 | Air | 29–32 | 35–38 | 30.5 | 7.6 | carré 3×3, non dégressive | 2 |  |
| Pétrification | 18A | 4 | Eau | 27–30 | 32–36 | 28.5 | 7.1 | cible | 3 | coût −1 PA sur Téléfrag (cumul 2) |
| Compte-goutte | 8B | 3 | Eau | 18–21 | 22–25 | 19.5 | 6.5 | cible | 3 |  |
| Gousset | 18B | 2 | Air | 12–14 | 15–17 | 13.0 | 6.5 | cible | 2 | + 30–32 différé sur Téléfrag |
| Horloge | 14A | 4 | Terre | 23–25 | 28–30 | 24.0 | 6.0 | cible | 3 | +24 sur Téléfrag |
| Permutation | 3B | 4 | Eau | 21–24 | 25–29 | 22.5 | 5.6 | cible | 2 | vol de vie |
| Gelure | 2A | 2 | Eau | 10–12 | 13–15 | 11.0 | 5.5 | cible | 4 |  |
| Souvenir | 3A | 2 | Air | 10–12 | 13–15 | 11.0 | 5.5 | cible | 4 | vol de vie |
| Sablier de Xélor | 11B | 2 | Feu | 10–12 | 13–15 | 11.0 | 5.5 | cible | 2 | + 23–25 différé (cercle 2) |
| Rouage | 1B | 4 | Terre | 20–22 | 24–26 | 21.0 | 5.2 | anneau de rayon exactement 2 | 2 | vol de vie |
| Aiguille | 7B | 2 | Terre | 9–12 | 13–16 | 10.5 | 5.2 | cible | 3 | poison 2 tours |

## Mécaniques spécifiques à implémenter

### 1. Téléfrag : génération

Spell 24510 (texte officiel) : « Cet état s'applique sur 2 entités lorsqu'elles échangent de positions classiques ou suite aux effets de téléportation d'un sort Xélor, pour 2 tours ; sur une ou plusieurs entités immédiatement avec des sorts, pour 1 tour. Lorsqu'un Téléfrag est généré, le lanceur gagne 2 PA, 1 fois par sort et par tour. » Dans les données, chaque sort générateur lance après son effet de téléportation (1) le sous-sort commun Téléfrag #13265 g1 sur les cibles de masque `T` (entités téléfraguées par ce lancer) et (2) un sous-sort propre au sort (ex. Perturbation #18996 g1, effet 2160 limité à 1 exécution par lancer) qui donne +2 PA (1 tour) au lanceur s'il n'a pas déjà l'état « Téléfrag <sort> » (posé 1 tour) → +2 PA une fois par sort et par tour.

*Implémentation :* Effets de téléportation Xélor (4, 8, 1099, 1100, 1101, 1104, 1105, 1106) : si la case d'arrivée est occupée par une entité qui peut échanger (pas Pesanteur #7, Enraciné #6, Indéplaçable #97, monstre canSwitchPos), les deux entités échangent leurs places et sont marquées `teleportedInTelefragThisCast` (masque T, recalculé au moment de l'effet). Téléfrag #13265 g1 pose alors : état affiché #3622 (2 tours, dispellable 2) sur les deux + état caché #244 (si allié du lanceur) ou #251 (si ennemi) — ce sont #244/#251 que testent tous les sorts (E244/E251). Une entité déjà en Téléfrag est simplement rafraîchie. Le +2 PA est un buff 111 durée 1 (donc utilisable immédiatement dans le tour).

### 2. Téléfrag : effets passifs déclenchés à la génération/consommation

Le sous-sort Téléfrag g1 (génération) et g4 (consommation) déclenchent selon des états « (sélection) » portés par le Xélor : Téléportation #13249 voit sa relance fixée à 0 (état #3461 « Téléportation (sélection) », sauf état #2918 « Téléportation (blocage) ») ; Astrolabe #13282 relance fixée à 0 (état #6139 « Retour Spontané (sélection) ») ; le glyphe d'Instabilité est déclenché immédiatement (état #3460 « Instabilité (sélection) », 1 fois via l'état #3620) ; en consommation : compteur de Glas (+6 dégâts de base, état #3459 « Glas (sélection) ») et réduction du retardement de Sablier (états #6129/#6130). En génération : un Complice téléfragué gagne +3 PM (Dispersion #29242 g2).

*Implémentation :* Aucun sort des données ne pose les états « (sélection) » #3459/#3460/#3461/#6139 : ils sont (INCERTAIN, déduction) posés par le serveur en début de combat quand la variante correspondante est équipée. Implémenter : `hasSelectedVariant(spellId)` ⇔ état présent. Les relances fixées à 0 (effet 1045) rendent Téléportation/Astrolabe relançables dans le même tour (leur limite 1/cible reste).

### 3. Téléfrag : consommation

Les sorts « consommateurs » (Rayon Obscur, Dessèchement, Horloge, Clepsydre, Réfraction, Régulateur, Pétrification, Gousset) testent E244/E251 sur la cible, lancent Téléfrag #13265 g4 (retire #3622/#244/#251) puis appliquent leur bonus. Le bonus est appliqué AVANT les dommages du sort (sous-sort placé en tête dans la liste d'effets) : Horloge passe à 47–49 contre une cible Téléfrag.

*Implémentation :* Ordre : 1) sous-sorts de consommation (bonus 293/285/290/128/111…), 2) dommages. Les cibles des effets sont calculées avant exécution (règle commune) ; seuls les masques T/U sont réévalués. Glas exige l'état #707 « 1 Téléfrag consommé » (posé par la 1re consommation) : `statesCriterion HS=707`.

### 4. Téléfrag : application directe (1 tour)

Momification (sur soi) et Réfraction (propagation en anneau 1–2 autour d'une cible Téléfrag) appliquent Téléfrag #13265 g2 : Téléfrag 1 tour, SANS +2 PA ni réinitialisation de relance. La Synchro ne reçoit jamais l'état caché #244 par application directe (masque f3958) : elle n'explose pas.

*Implémentation :* g2 = états #3622/#244/#251 durée 1, masque excluant la Synchro pour #244. Dispersion (Complice +3 PM) est tout de même déclenchée.

### 5. Primitives de téléportation et mémoire de position

1105 : cible symétrique par rapport au lanceur (Perturbation, Frappe) ; 1104 : lanceur symétrique par rapport à la cible (Téléportation, Pendule) ; 1106 : chaque cible de la zone symétrique par rapport à la case d'impact (Rouage, Engrenage, Poussière, Paradoxe, Désynchronisation) ; 1100 : retour à la position précédente (Gelure, Souvenir, Compte-goutte, Raulebaque, Distorsion, Sables du Temps, Fuite du Temps, Rémanence, Espace-temps) ; 1099 : retour à la position de début de tour (Rembobinage) ; 8 : échange (Permutation, Astrolabe, Faille) ; 1101 : téléporte ou échange (Prémonition) ; 4 : téléporte sur la case (Astrolabe).

*Implémentation :* Stocker pour chaque entité `previousCell` (case avant son DERNIER déplacement, quel qu'il soit : marche, poussée, téléportation, échange) et `turnStartCell` (case au début de SON tour). Les cibles en Pesanteur #7 / Indéplaçable #97 / Enraciné #6 sont exclues (masque e7,e97,e6). Une case symétrique hors carte ou non marchable : téléportation annulée (INCERTAIN, comportement standard Dofus). Pesanteur interdit Téléportation/Bond/Faille côté lanceur (statesCriterion HS!7). Ces primitives servent aussi aux monstres (Vortex, Morfaille : 1100).

### 6. Synchro : synchronisations et explosion

Synchro (monstre #3958 g2, 0 PA, statique, 120 % des PV du Xélor INCERTAIN, Agilité propre 500) : à l'invocation, elle reçoit −200 % Dommages finaux (infini) et un état « Téléfrag inactif : <sort> » pour chaque sort générateur de Téléfrag équipé par le Xélor (états #3712–#3731, #6115–#6118). Chaque fois que le Xélor génère un Téléfrag avec un sort dont la Synchro porte encore l'état inactif (et si elle n'est pas déjà « Synchronisée » ce tour-ci), elle se synchronise : retire l'état inactif des DEUX variantes de la paire, état Synchronisé (1 tour), +200 % Dommages finaux (infini, cumulable), soin de 100 % de ses PV, compteur Synchro I→XV. Quand la Synchro entre elle-même dans l'état Téléfrag (#244, échange de positions par un sort Xélor), elle occasionne 23 dommages Air (non dégressifs) aux ennemis dans un cercle de 3 puis meurt (sauf état « Faille (blocage) » #614). Une seule Synchro par équipe.

*Implémentation :* Multiplicateur final de la Synchro = (100 − 200 + 200 × k) / 100 = 2k − 1 avec k synchronisations (0 si k = 0) — INCERTAIN (cumul additif des Dommages finaux). Au plus 1 synchronisation par tour (Synchronisé retiré à chaque début de tour par Fin des Temps g4 récursif). Au plus 1 par paire de sorts. Rembobinage et Rémanence posent « Synchro (blocage) » #3621 pendant leur effet de fin de tour → pas d'explosion. Faille pose #614 sur la Synchro pour le tour. Dégâts = 23 Air × (1 + Agilité/100 …) × (2k−1) ; avec k = 4 (×7) une explosion vaut plusieurs centaines par cible.

### 7. Complice et Cadran de Xélor (et Paradoxe / Faille)

Complice (#5144, invocation contrôlable via 1011, 12 PA, 3 PM, Intaclable et Intacleur, aucun sort, ne prend pas de place d'invocation) : obstacle mobile et ancre de téléfrag ; +3 PM quand il est téléfragué ; quand il subit des dommages de sort de la « famille » du Xélor, 75 % des dommages finaux sont infligés aux ennemis dans un anneau 1–3 autour de lui. Cadran (#3960, statique, 1 par équipe, relance 3) : au début de son tour −2 PA (esquivables) aux ennemis Téléfrag et +2 PA (2 tours) aux alliés Téléfrag dans un anneau 1–4 ; renvoie 25 % des dommages de sort subis à l'attaquant ennemi ; 75 % des dommages subis du Xélor vers les ennemis en anneau 1–4. Paradoxe (sur le Complice/Cadran) : symétrie de toutes les entités (hors lanceur, Synchro et Pesanteur) dans un cercle de 4 autour de l'invocation, Indéplaçable 1 tour, relances Complice/Cadran fixées à 1, et re-symétrie au début du tour de l'invocation. Faille : échange le Xélor avec son Complice/Cadran, relances fixées à 1, retour de l'invocation à sa position précédente en fin de tour du Xélor, Synchro protégée de l'explosion ce tour.

*Implémentation :* Le renvoi 1223 (pourcentage des dommages FINAUX, non boosté, sans dégressivité, élément du coup) ne déclenche pas d'autres renvois. Les splashes du Complice/Cadran ne se déclenchent que sur dommages de SORT (trigger DS) venant du Xélor ou de sa famille (masque h,P,O). Implémentation conseillée : `onDamaged(summon, attacker, finalDamage, isSpell)`.

### 8. Économie de PA du Xélor

Sources de PA : +2 PA par sort générateur et par tour, Ralentissement sur cible Téléfrag (vol de 1 PA), Clepsydre (+1 PA au tour suivant par Téléfrag consommé, cumul 3), Flou Temporel (+2 PA au tour suivant), Conservation (allié +1 PA par attaque ennemie, cumul 2), Cadran (+2 PA aux alliés Téléfrag), Pétrification (−1 PA de coût par Téléfrag consommé, cumul 2), Régulateur (+1 lancer). Un tour Xélor « parfait » dépasse souvent 16 PA.

*Implémentation :* L'IA doit évaluer chaque séquence : générer un Téléfrag avec un sort 2 PA (Gelure/Souvenir) le rend « gratuit » (+2 PA). Rechercher en priorité les paires (allié collé à un ennemi, etc.) qui produisent un Téléfrag.

### 9. Effets retardés et de fin de tour

Fuite du Temps (retour à la position précédente au tour suivant), Prémonition (téléportation/échange au tour suivant), Sablier (explosion Feu après 2 tours, accélérée par chaque Téléfrag consommé), Gousset (explosion Air en fin du tour suivant du lanceur), Rembobinage/Rémanence/Espace-temps (alliés : effet appliqué à la FIN de leur tour), Flou Temporel (+2 PA au tour suivant).

*Implémentation :* delay N = appliqué au début du N-ième prochain tour du lanceur (règle durations du projet). Les effets TE sont attachés au tour de la cible (porteur).

### Tableau des générateurs et consommateurs de Téléfrag

| Sort | Paire | Rôle Téléfrag | Effet du Téléfrag / bonus |
|---|---|---|---|
| Perturbation, Frappe de Xélor | 1A, 4A | génère (symétrie de la cible / lanceur) | +2 PA (1×/sort/tour) |
| Rouage, Engrenage, Poussière, Désynchronisation, Paradoxe | 1B, 8A, 2B, 20A, 17A | génère (symétrie par rapport à l'impact) | +2 PA ; Poussière téléporte d'abord les Téléfrag de la zone |
| Gelure, Souvenir, Compte-goutte, Distorsion, Sables du Temps, Raulebaque, Fuite du Temps, Rémanence, Espace-temps, Instabilité | 2A, 3A, 8B, 19A, 19B, 13A, 9A, 16B, 20B, 13B | génère (retour position précédente) | +2 PA |
| Rembobinage | 16A | génère (retour début de tour) | +2 PA (au tour suivant si lancé sur soi) |
| Téléportation, Pendule | 6A, 4B | génère (lanceur symétrique) | +2 PA ; Téléportation relance remise à 0 |
| Permutation, Astrolabe, Faille, Prémonition | 3B, 6B, 17B, 9B | génère (échange) | +2 PA |
| Momification, Réfraction (propagation) | 21A, 15A | applique (1 tour) | pas de +2 PA |
| Horloge | 14A | consomme | +24 dégâts de base (3 tours) |
| Clepsydre | 14B | consomme | +1 PA au tour suivant (cumul 3) |
| Rayon Obscur | 10A | consomme (ligne) | +12 dégâts de base par Téléfrag |
| Dessèchement | 10B | consomme (rebonds) | +1 PM par Téléfrag (cumul 3) |
| Réfraction | 15A | consomme | dégâts en cercle 2 + propagation |
| Régulateur | 15B | consomme | +1 lancer de Régulateur ce tour |
| Pétrification | 18A | consomme | −1 PA de coût (3 tours, cumul 2) |
| Gousset | 18B | consomme | explosion Air cercle 2 en fin du tour suivant |
| Ralentissement | 11A | utilise (sans consommer) | retrait → vol de 1 PA |
| Flétrissement | 7A | utilise | +6 dégâts de base (3 tours, cumul 3) |
| Aiguille | 7B | réagit à la PERTE | dégâts Terre |
| Sablier | 11B | réagit à la consommation | retardement réduit |
| Glas | 22B | compteur | +6 dégâts de base par Téléfrag consommé depuis le dernier lancer (max 6) |
| Cadran | 5B | aura | −2 PA ennemis Téléfrag / +2 PA alliés Téléfrag (anneau 1–4) |

### Pseudo-code : lancer d'un sort Xélor qui téléporte

```
cast(spell, target):
  for effect in spell.effects:              # ordre des données
    targets = effect.mask has 'T'|'U' ? evalNow() : precomputedTargets
    if effect is teleport (4/8/1099/1100/1101/1104/1105/1106):
       for e in targets: dest = computeDest(effect, e)
          if dest occupied by f and canSwap(e, f): swap(e, f); markTelefrag(e, f)   # T mask
          elif dest free & walkable: move(e, dest)
          e.previousCell = oldCell                                             # mémoire
    elif effect is 2160 (sous-sort "Téléfrag <sort>", 1 exécution max) on T:
       if !caster.has(stateTelefragSpell): caster.addState(stateTelefragSpell,1); caster.AP += 2
       if synchro alive & !synchro.has(306) & synchro.has(inactiveStateOf(spellPair)): synchronize(synchro)
    elif effect is 1160 Téléfrag#13265 g1 on T: applyTelefrag(2 turns) ; fireHooks(generate)
    ...
```

## Détail de tous les sorts (grade utilisable au niveau 200)

Légende des cibles : « alliés compris » = le sort affecte aussi un allié ciblé/dans la zone (masque `a`) ; « hors lanceur » = masque `g`. Les lignes « Infobulle décodée » sont générées automatiquement à partir des effets VISIBLES de l'infobulle (CC entre parenthèses) : elles incluent des effets d'affichage (`forClientOnly`) dont les cibles/zones peuvent être plus larges que les effets réellement exécutés. Pour le moteur, la référence est la liste « Effets » ci-dessus et le champ `effects` du JSON (effets réellement exécutés, sous-sorts compris dans le dump).

### Paire 1 : Perturbation / Rouage

*Perturbation (mono-cible, en ligne, vol Feu) pour générer un Téléfrag à coup sûr contre un allié collé ; Rouage (anneau 2) pour les paquets.*

#### 1A. Perturbation (id 13288, niveau de déblocage 1)

- **Caractéristiques** : **3 PA** · PO 1–4 (fixe), en ligne, LdV · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Téléporte la cible symétriquement par rapport au lanceur et vole de la vie dans l'élément Feu aux ennemis.  Peut générer un Téléfrag.
- **Effets** :
  - Téléporte la cible (alliée ou ennemie) sur la case symétrique par rapport au lanceur (1105) ; case occupée → échange et Téléfrag (+2 PA au lanceur, 1×/tour pour ce sort).
  - Vole 23 à 26 PV en Feu (CC 28 à 31) à la cible ennemie (vol : le lanceur est soigné de la moitié des dommages infligés).
- **Rôle tactique** : 3 PA, 1–4 PO en ligne, 3/tour, 2/cible : faire passer un ennemi « derrière » le Xélor sur un allié pour générer un Téléfrag rentable (coût net 1 PA).
- **Tags** : `damage`, `fire`, `life_steal`, `placement`, `telefrag_generator`
- **Grades** : g1 (niv. 1) : 3 PA, PO 1–4, 3/tour, 14–16 Feu (vol) ; g2 (niv. 66) : 3 PA, PO 1–4, 3/tour, 18–20 Feu (vol) ; g3 (niv. 132) : 3 PA, PO 1–4, 3/tour, 23–26 Feu (vol)
- *Infobulle décodée (auto)* :
  - Téléportation symétrique par rapport au lanceur — cibles : alliés (lanceur compris), ennemis
  - 23 à 26 vol Feu (CC : 28 à 31 vol Feu) — cibles : ennemis

#### 1B. Rouage (id 13283, niveau de déblocage 95)

- **Caractéristiques** : **4 PA** · PO 0–2 (fixe), LdV · 2/tour · CC 15 %
- **Description officielle** : Téléporte les cibles symétriquement par rapport au centre et vole de la vie dans l'élément Terre aux ennemis en zone. N'affecte pas directement le lanceur.  Peut générer un Téléfrag.
- **Effets** :
  - Zone : anneau de rayon exactement 2 autour de l'impact (0–2 PO, LdV).
  - Toutes les entités de l'anneau (sauf le lanceur) sont téléportées symétriquement par rapport à l'impact (1106) → Téléfrags possibles.
  - Vole 20 à 22 PV en Terre (CC 24 à 26) aux ennemis de l'anneau.
- **Rôle tactique** : 4 PA, 2/tour : lancé sur soi au milieu d'un paquet, inverse les positions des ennemis situés à 2 cases.
- **Tags** : `damage`, `earth`, `life_steal`, `aoe_ring`, `placement`, `telefrag_generator`
- **Grades** : g1 (niv. 95) : 4 PA, PO 0–2, 2/tour, 16–18 Terre (vol) ; g2 (niv. 162) : 4 PA, PO 0–2, 2/tour, 20–22 Terre (vol)
- *Infobulle décodée (auto)* :
  - Téléportation symétrique — cibles : alliés (hors lanceur), ennemis ; zone : anneau de rayon exactement 2
  - 20 à 22 vol Terre (CC : 24 à 26 vol Terre) — cibles : ennemis ; zone : anneau de rayon exactement 2

### Paire 2 : Gelure / Poussière

*Gelure (2 PA, sans LdV, 4/tour) est le générateur de Téléfrag le moins cher ; Poussière pour la zone Feu.*

#### 2A. Gelure (id 13245, niveau de déblocage 1)

- **Caractéristiques** : **2 PA** · PO 1–6 (modifiable), en ligne, sans LdV · 4/tour · 2/cible · CC 5 %
- **Description officielle** : Téléporte la cible à sa position précédente et occasionne des dommages Eau aux ennemis.  Peut générer un Téléfrag.
- **Effets** :
  - Téléporte la cible (alliée ou ennemie, sauf Pesanteur/Indéplaçable/Enraciné) à sa position précédente (1100) → Téléfrag si la case est occupée.
  - 10 à 12 dommages Eau (CC 13 à 15) à la cible ennemie.
- **Rôle tactique** : 2 PA, 1–6 PO modifiable, en ligne, SANS ligne de vue, 4/tour : générateur de Téléfrag le moins cher (rentable dès qu'il génère : +2 PA).
- **Tags** : `damage`, `water`, `placement`, `telefrag_generator`, `cheap`
- **Grades** : g1 (niv. 1) : 2 PA, PO 1–4, 4/tour, 6–8 Eau ; g2 (niv. 67) : 2 PA, PO 1–5, 4/tour, 8–10 Eau ; g3 (niv. 133) : 2 PA, PO 1–6, 4/tour, 10–12 Eau
- *Infobulle décodée (auto)* :
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis [si la cible n'a pas l'état « Pesanteur »; si la cible n'a pas l'état « Indéplaçable »; si la cible n'a pas l'état « Enraciné »]
  - 10 à 12 dommages Eau (CC : 13 à 15 dommages Eau) — cibles : ennemis

#### 2B. Poussière (id 13257, niveau de déblocage 100)

- **Caractéristiques** : **4 PA** · PO 0–6 (fixe), LdV · 2/tour · CC 15 %
- **Description officielle** : Occasionne des dommages Feu aux ennemis en zone. Téléporte également les cibles Téléfrag dans la zone symétriquement par rapport au centre avant d'appliquer les effets.  Peut générer un Téléfrag.
- **Effets** :
  - Zone : cercle de 2 autour de l'impact (0–6 PO).
  - D'abord, les entités Téléfrag de l'anneau 1–2 (état « Poussière Temporelle ») sont téléportées symétriquement par rapport au centre (peut générer de nouveaux Téléfrags).
  - Puis 29 à 32 dommages Feu (CC 35 à 38) aux ennemis de la zone (dégressif).
- **Rôle tactique** : 4 PA, 2/tour : meilleure zone Feu du Xélor sur un paquet déjà téléfragué.
- **Tags** : `damage`, `fire`, `aoe`, `placement`, `telefrag_generator`
- **Grades** : g1 (niv. 100) : 4 PA, PO 0–6, 2/tour, 23–26 Feu ; g2 (niv. 167) : 4 PA, PO 0–6, 2/tour, 29–32 Feu
- *Infobulle décodée (auto)* :
  - Téléportation symétrique — cibles : alliés (lanceur compris), ennemis ; zone : cercle de rayon 2
  - 29 à 32 dommages Feu (CC : 35 à 38 dommages Feu) — cibles : ennemis ; zone : cercle de rayon 2

### Paire 3 : Souvenir / Permutation

*Souvenir (2 PA, vol Air) en filler ; Permutation (échange à 2 PO exactement) pour sauver un allié ou placer.*

#### 3A. Souvenir (id 13281, niveau de déblocage 1)

- **Caractéristiques** : **2 PA** · PO 1–6 (modifiable), LdV · 4/tour · 2/cible · CC 5 %
- **Description officielle** : Téléporte la cible à sa position précédente et vole de la vie dans l'élément Air aux ennemis.  Peut générer un Téléfrag.
- **Effets** :
  - Téléporte la cible à sa position précédente (sauf Pesanteur/Indéplaçable/Enraciné) → Téléfrag possible.
  - Vole 10 à 12 PV en Air (CC 13 à 15) à la cible ennemie.
- **Rôle tactique** : 2 PA, 1–6 PO modifiable, LdV, 4/tour : équivalent Air de Gelure (avec LdV).
- **Tags** : `damage`, `air`, `life_steal`, `placement`, `telefrag_generator`, `cheap`
- **Grades** : g1 (niv. 1) : 2 PA, PO 1–4, 4/tour, 6–8 Air (vol) ; g2 (niv. 68) : 2 PA, PO 1–5, 4/tour, 8–10 Air (vol) ; g3 (niv. 134) : 2 PA, PO 1–6, 4/tour, 10–12 Air (vol)
- *Infobulle décodée (auto)* :
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis [si la cible n'a pas l'état « Pesanteur »; si la cible n'a pas l'état « Indéplaçable »; si la cible n'a pas l'état « Enraciné »]
  - 10 à 12 vol Air (CC : 13 à 15 vol Air) — cibles : ennemis

#### 3B. Permutation (id 13285, niveau de déblocage 105)

- **Caractéristiques** : **4 PA** · PO 2–2 (fixe), LdV · case occupée · 2/tour · CC 15 %
- **Description officielle** : Échange de position avec la cible et vole de la vie dans l'élément Eau aux ennemis.  Peut générer un Téléfrag.
- **Effets** :
  - Échange de position avec la cible (exactement 2 PO, LdV, case occupée) ; l'échange génère un Téléfrag (déclencheur MS/TP) sur le lanceur et la cible.
  - Vole 21 à 24 PV en Eau (CC 25 à 29) à la cible ennemie.
- **Rôle tactique** : 4 PA, 2/tour : sauvetage d'un allié encerclé ou entrée dans un paquet ; Téléfrag garanti (+2 PA).
- **Tags** : `damage`, `water`, `life_steal`, `placement`, `swap`, `telefrag_generator`
- **Grades** : g1 (niv. 105) : 4 PA, PO 2–2, 2/tour, 17–19 Eau (vol) ; g2 (niv. 172) : 4 PA, PO 2–2, 2/tour, 21–24 Eau (vol)
- *Infobulle décodée (auto)* :
  - Échange de positions — cibles : alliés (lanceur compris), ennemis
  - 21 à 24 vol Eau (CC : 25 à 29 vol Eau) — cibles : ennemis

### Paire 4 : Frappe de Xélor / Pendule

*Frappe de Xélor (symétrie de la cible) très polyvalente ; Pendule pour un burst Air de zone sans LdV.*

#### 4A. Frappe de Xélor (id 13252, niveau de déblocage 1)

- **Caractéristiques** : **3 PA** · PO 1–3 (fixe), LdV · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Téléporte la cible symétriquement par rapport au lanceur et occasionne des dommages Terre aux ennemis.  Peut générer un Téléfrag.
- **Effets** :
  - Téléporte la cible symétriquement par rapport au lanceur (1–3 PO) → Téléfrag si case occupée.
  - 22 à 25 dommages Terre (CC 26 à 30) à la cible ennemie.
- **Rôle tactique** : 3 PA, 3/tour, 2/cible : passe un ennemi de l'autre côté du Xélor (souvent dans le dos d'un allié).
- **Tags** : `damage`, `earth`, `placement`, `telefrag_generator`
- **Grades** : g1 (niv. 1) : 3 PA, PO 1–3, 3/tour, 13–15 Terre ; g2 (niv. 69) : 3 PA, PO 1–3, 3/tour, 17–20 Terre ; g3 (niv. 136) : 3 PA, PO 1–3, 3/tour, 22–25 Terre
- *Infobulle décodée (auto)* :
  - Téléportation symétrique par rapport au lanceur — cibles : alliés (lanceur compris), ennemis
  - 22 à 25 dommages Terre (CC : 26 à 30 dommages Terre) — cibles : ennemis

#### 4B. Pendule (id 13294, niveau de déblocage 110)

- **Caractéristiques** : **4 PA** · PO 0–4 (fixe), sans LdV · case occupée · relance initiale 1 · 2/tour · 1/cible · CC 15 %
- **Description officielle** : Téléporte le lanceur symétriquement par rapport à la cible, occasionne des dommages Air à l'ennemi ciblé et aux ennemis en zone autour du lanceur et le téléporte à sa position précédente. Les effets ne sont appliqués qu'une seule fois par lancer.  Peut générer un Téléfrag.
- **Effets** :
  - Le lanceur se téléporte symétriquement par rapport à la cible (0–4 PO, sans LdV, case occupée).
  - 33 à 36 dommages Air (CC 40 à 43) à l'ennemi ciblé, puis 33 à 36 Air aux autres ennemis dans un anneau 1–2 autour de la nouvelle position du lanceur (une seule fois par cible).
  - Enfin le lanceur est téléporté à sa position précédente ; chaque téléportation peut générer un Téléfrag. Relance initiale 1, 2/tour, 1/cible.
- **Rôle tactique** : 4 PA : burst Air de zone sans bouger réellement ; excellent derrière un mur (sans LdV).
- **Tags** : `damage`, `air`, `aoe`, `mobility`, `telefrag_generator`
- **Grades** : g1 (niv. 110) : 4 PA, PO 0–4, 2/tour, 27–29 Air / 27–29 Air ; g2 (niv. 177) : 4 PA, PO 0–4, 2/tour, 33–36 Air / 33–36 Air
- *Infobulle décodée (auto)* :
  - Téléportation symétrique par rapport à la cible — cibles : alliés (lanceur compris), ennemis
  - 33 à 36 dommages Air (CC : 40 à 43 dommages Air) — cibles : ennemis
  - 33 à 36 dommages Air (CC : 40 à 43 dommages Air) — cibles : ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu)
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis

### Paire 5 : Complice / Cadran de Xélor

*Cadran pour l'entrave/soutien PA ; Complice comme ancre mobile (Paradoxe/Faille) et renvoi 75 %.*

#### 5A. Complice (id 13287, niveau de déblocage 5)

- **Caractéristiques** : **2 PA** · PO 1–5 (fixe), LdV · case libre · 1/tour · CC 0 %
- **Description officielle** : Invoque un Complice contrôlable qui sert d'obstacle. Le Complice gagne des PM lorsqu'il entre dans l'état Téléfrag. Il renvoie également une partie des dommages qu'il subit par son invocateur aux ennemis en zone autour de lui.  Si le Complice du lanceur est encore présent et que celui-ci est ré-invoqué, l'ancien est détruit pour laisser place au nouveau.
- **Effets** :
  - Invoque un Complice contrôlable (#5144 g3, case libre, 1–5 PO) : 12 PA, 3 PM, résistances 24 %, Intaclable et Intacleur, aucun sort ; ne prend pas de place d'invocation ; un nouveau Complice remplace l'ancien.
  - +3 PM (1 tour) au Complice quand il entre dans l'état Téléfrag.
  - Quand il subit des dommages de sort de la famille du Xélor : 75 % des dommages finaux sont infligés aux ennemis dans un anneau 1–3 autour de lui (non dégressif).
- **Rôle tactique** : 2 PA, 1/tour : ancre de Téléfrag mobile (bloquer une case, servir de cible d'échange) et relais de dégâts (frapper son Complice au milieu des ennemis).
- **Tags** : `summon`, `placement`, `aoe_splash`, `obstacle`
- **Grades** : g1 (niv. 5) : 2 PA, PO 1–3, 1/tour ; g2 (niv. 72) : 2 PA, PO 1–4, 1/tour ; g3 (niv. 139) : 2 PA, PO 1–5, 1/tour
- *Infobulle décodée (auto)* :
  - Invoque : Complice (#5144, grade 3) — cibles : alliés (lanceur compris), ennemis

#### 5B. Cadran de Xélor (id 13258, niveau de déblocage 115)

- **Caractéristiques** : **3 PA** · PO 1–5 (fixe), LdV · case libre · relance 3 · CC 0 %
- **Description officielle** : Invoque un Cadran de Xélor statique qui peut retirer ou donner des PA aux entités Téléfrag en zone. Il peut également renvoyer une partie des dommages qu'il subit à ses attaquants ennemis. Il renvoie également une partie des dommages qu'il subit par le lanceur aux ennemis en zone autour de lui.  Il ne peut y avoir qu'un seul Cadran de Xélor par équipe. Si le Cadran est encore présent et que celui-ci est ré-invoqué, l'ancien est détruit pour laisser place au nouveau.
- **Effets** :
  - Invoque un Cadran statique (#3960 g3, 1 par équipe, relance 3) : 120 % des PV du Xélor (INCERTAIN), résistances 24 %.
  - Au début de chacun de ses tours : −2 PA esquivables (1 tour) aux ennemis Téléfrag et +2 PA (2 tours) aux alliés Téléfrag dans un anneau 1–4.
  - Renvoie 25 % des dommages de sort subis à l'attaquant ennemi ; 75 % des dommages subis du Xélor sont infligés aux ennemis dans un anneau 1–4.
- **Rôle tactique** : Poser au centre du combat : chaque Téléfrag devient du retrait PA (ennemis) ou du gain de PA (alliés).
- **Tags** : `summon`, `ap_removal`, `ap_gain`, `aoe_splash`
- **Grades** : g1 (niv. 115) : 3 PA, PO 1–4, relance 3 ; g2 (niv. 182) : 3 PA, PO 1–5, relance 3
- *Infobulle décodée (auto)* :
  - Invoque : Cadran de Xélor (#3960, grade 3) — cibles : alliés (lanceur compris), ennemis
  - lance « Oscillation » (#24546, rang 1) — cibles : alliés (lanceur compris), ennemis

### Paire 6 : Téléportation / Astrolabe

*Téléportation (relance réinitialisée par les Téléfrags) = mobilité principale ; Astrolabe pour échanger/revenir.*

#### 6A. Téléportation (id 13249, niveau de déblocage 10)

- **Caractéristiques** : **2 PA** · PO 1–5 (fixe), sans LdV · case occupée · relance 2 · relance initiale 1 · 1/cible · CC 0 % · condition : le lanceur n'a pas « Pesanteur » ET le lanceur n'a pas « Indéplaçable » ET le lanceur n'a pas « Enraciné » (`HS!7&HS!97&HS!6`)
- **Description officielle** : Téléporte le lanceur symétriquement par rapport à la cible.  Peut générer un Téléfrag.  Le temps de relance est réinitialisé lorsque le lanceur génère ou consomme un Téléfrag.
- **Effets** :
  - Le lanceur se téléporte symétriquement par rapport à la cible (1–5 PO, sans LdV, case occupée, 1/cible) → Téléfrag possible.
  - Interdit si le lanceur est Pesanteur, Indéplaçable ou Enraciné.
  - Relance 2 (initiale 1), remise à 0 chaque fois que le lanceur génère ou consomme un Téléfrag.
- **Rôle tactique** : Mobilité principale : avec des Téléfrags réguliers, relançable plusieurs fois par tour (une fois par cible).
- **Tags** : `mobility`, `telefrag_generator`
- **Grades** : g1 (niv. 10) : 2 PA, PO 1–3, relance 2 ; g2 (niv. 77) : 2 PA, PO 1–4, relance 2 ; g3 (niv. 144) : 2 PA, PO 1–5, relance 2
- *Infobulle décodée (auto)* :
  - Téléportation symétrique par rapport à la cible — cibles : alliés (lanceur compris), ennemis

#### 6B. Astrolabe (id 13282, niveau de déblocage 120)

- **Caractéristiques** : **2 PA** · PO 0–3 (fixe), LdV · relance 2 · 1/cible · CC 0 %
- **Description officielle** : Téléporte le lanceur sur la case ciblée ou échange de position avec la cible.  Sur le lanceur : le téléporte à sa position précédente.  Peut générer un Téléfrag.  Le temps de relance est réinitialisé lorsque le lanceur génère ou consomme un Téléfrag.
- **Effets** :
  - Sur une case libre (0–3 PO) : le lanceur s'y téléporte (pas en Pesanteur).
  - Sur une entité (allié hors lanceur ou ennemi) : échange de positions → Téléfrag sur les deux.
  - Sur soi : retour à la position précédente → Téléfrag possible.
  - Relance 2, 1/cible, remise à 0 à chaque génération/consommation de Téléfrag.
- **Rôle tactique** : Couteau suisse 2 PA : avance, échange un allié en danger ou annule un déplacement subi.
- **Tags** : `mobility`, `swap`, `telefrag_generator`
- **Grades** : g1 (niv. 120) : 2 PA, PO 0–2, relance 2 ; g2 (niv. 187) : 2 PA, PO 0–3, relance 2
- *Infobulle décodée (auto)* :
  - Téléporte sur la case ciblée — cibles : alliés (lanceur compris), ennemis [si le lanceur n'a pas l'état « Pesanteur »] ; non désenvoûtable (sauf mort)
  - Échange de positions — cibles : alliés (hors lanceur), ennemis ; non désenvoûtable (sauf mort)
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis [si le lanceur n'a pas l'état « Pesanteur »; si le lanceur n'a pas l'état « Enraciné »; si le lanceur n'a pas l'état « Indéplaçable »]

### Paire 7 : Flétrissement / Aiguille

*Flétrissement (Air, rampe +6 sur Téléfrag) ; Aiguille (poison Terre) pour un Xélor Terre.*

#### 7A. Flétrissement (id 13254, niveau de déblocage 15)

- **Caractéristiques** : **3 PA** · PO 1–6 (modifiable), LdV · 3/tour · 2/cible · cumul 3 · CC 10 %
- **Description officielle** : Occasionne des dommages Air. Les dommages sont augmentés après chaque lancer si la cible est Téléfrag.
- **Effets** :
  - 25 à 28 dommages Air (CC 30 à 34) à la cible (alliés compris, masque a,A).
  - Si la cible est Téléfrag (sans le consommer) : +6 dégâts de base à Flétrissement pendant 3 tours (cumulable 3 fois → +18).
- **Rôle tactique** : 3 PA, 3/tour, 1–6 PO modifiable : filler Air qui monte à 43–46 de base après 3 lancers sur Téléfrag.
- **Tags** : `damage`, `air`, `ramp`
- **Grades** : g1 (niv. 15) : 3 PA, PO 1–4, 3/tour, 16–18 Air ; g2 (niv. 82) : 3 PA, PO 1–5, 3/tour, 20–23 Air ; g3 (niv. 149) : 3 PA, PO 1–6, 3/tour, 25–28 Air
- *Infobulle décodée (auto)* :
  - 25 à 28 dommages Air (CC : 30 à 34 dommages Air) — cibles : alliés (lanceur compris), ennemis
  - Flétrissement : +6 dégâts de base — cibles : lanceur ; 3 tour(s) ; désenvoûtable seulement par effet fort

#### 7B. Aiguille (id 13244, niveau de déblocage 125)

- **Caractéristiques** : **2 PA** · PO 1–6 (fixe), en ligne ou diagonale, LdV · relance globale 1 · 3/tour · 1/cible · cumul 1 · CC 5 %
- **Description officielle** : Applique un poison Terre de début de tour et l'état Aiguille sur la cible : • Occasionne des dommages Terre si la cible perd l'état Téléfrag.  Les dommages ne peuvent être déclenchés qu'une seule fois par tour.
- **Effets** :
  - Poison Terre : 9 à 12 dommages (CC 13 à 16) au début de chacun des 2 prochains tours de la cible et état « Aiguille » (2 tours) ; relancer retire l'Aiguille précédente.
  - Si la cible perd son état Téléfrag (consommation, fin de durée) : 9 à 12 dommages Terre supplémentaires (au plus 1 déclenchement — INCERTAIN, cf. incertitudes).
  - 2 PA, 1–6 PO en ligne ou diagonale, 3/tour, 1/cible, relance globale 1.
- **Rôle tactique** : Poser sur plusieurs ennemis Téléfrag avant de les consommer avec Horloge/Régulateur (Terre).
- **Tags** : `damage`, `earth`, `poison`, `dot`
- **Grades** : g1 (niv. 125) : 2 PA, PO 1–6, 3/tour, 6–8 Terre / 6–8 Terre ; g2 (niv. 192) : 2 PA, PO 1–6, 3/tour, 9–12 Terre / 9–12 Terre
- *Infobulle décodée (auto)* :
  - 9 à 12 dommages Terre (CC : 13 à 16 dommages Terre) — cibles : alliés (lanceur compris), ennemis ; DÉCLENCHÉ quand : Debut du tour du PORTEUR (écoute 2 t)
  - État « Aiguille » — cibles : alliés (lanceur compris), ennemis ; 2 tour(s)
  - 9 à 12 dommages Terre (CC : 13 à 16 dommages Terre) — cibles : alliés (lanceur compris), ennemis [si le lanceur a l'état « Téléfrag »]

### Paire 8 : Engrenage / Compte-goutte

*Engrenage (croix, Terre) génère plusieurs Téléfrags ; Compte-goutte double retour (cible + lanceur).*

#### 8A. Engrenage (id 13299, niveau de déblocage 20)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · 2/tour · CC 10 %
- **Description officielle** : Téléporte les cibles symétriquement par rapport au centre et occasionne des dommages Terre aux ennemis en zone. Les dommages de zone ne sont pas dégressifs. N'affecte pas directement le lanceur.  Peut générer un Téléfrag.
- **Effets** :
  - Zone : croix de 1 autour de l'impact (0–6 PO), dommages non dégressifs.
  - Les entités de la croix (sauf le lanceur) sont téléportées symétriquement par rapport à l'impact → Téléfrags multiples possibles.
  - 22 à 24 dommages Terre (CC 26 à 29) aux ennemis de la croix.
- **Rôle tactique** : 3 PA, 2/tour : sur un ennemi collé à un allié, inverse le couple et génère 2 Téléfrags.
- **Tags** : `damage`, `earth`, `aoe_small`, `placement`, `telefrag_generator`
- **Grades** : g1 (niv. 20) : 3 PA, PO 0–4, 2/tour, 14–16 Terre ; g2 (niv. 87) : 3 PA, PO 0–5, 2/tour, 18–20 Terre ; g3 (niv. 154) : 3 PA, PO 0–6, 2/tour, 22–24 Terre
- *Infobulle décodée (auto)* :
  - Téléportation symétrique — cibles : alliés (hors lanceur), ennemis ; zone : croix de 1, non dégressive
  - 22 à 24 dommages Terre (CC : 26 à 29 dommages Terre) — cibles : ennemis ; zone : croix de 1, non dégressive

#### 8B. Compte-goutte (id 13259, niveau de déblocage 130)

- **Caractéristiques** : **3 PA** · PO 1–6 (fixe), LdV · case occupée · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Téléporte la cible et le lanceur à leur position précédente et occasionne des dommages Eau aux ennemis.  Peut générer un Téléfrag.
- **Effets** :
  - Téléporte la cible ET le lanceur à leur position précédente (cible case occupée, 1–6 PO) → Téléfrags possibles.
  - 18 à 21 dommages Eau (CC 22 à 25) à la cible ennemie.
- **Rôle tactique** : 3 PA, 3/tour : annule le dernier déplacement des deux protagonistes (souvent garanti de créer un Téléfrag).
- **Tags** : `damage`, `water`, `placement`, `telefrag_generator`
- **Grades** : g1 (niv. 130) : 3 PA, PO 1–5, 3/tour, 16–19 Eau ; g2 (niv. 197) : 3 PA, PO 1–6, 3/tour, 18–21 Eau
- *Infobulle décodée (auto)* :
  - Téléporte à la position précédente — cibles : lanceur, alliés (lanceur compris), ennemis [si la cible n'a pas l'état « Pesanteur »; si la cible n'a pas l'état « Indéplaçable »; si la cible n'a pas l'état « Enraciné »]
  - 18 à 21 dommages Eau (CC : 22 à 25 dommages Eau) — cibles : ennemis

### Paire 9 : Fuite du Temps / Prémonition

*Fuite du Temps (1 PA) protège un allié et prépare un retour ; Prémonition pour une téléportation différée.*

#### 9A. Fuite du Temps (id 13251, niveau de déblocage 25)

- **Caractéristiques** : **1 PA** · PO 0–6 (modifiable), sans LdV · case occupée · 3/tour · 2/cible · CC 0 %
- **Description officielle** : Augmente la Fuite de l'allié ciblé. Téléporte la cible à sa position précédente au tour suivant.  Peut générer un Téléfrag.
- **Effets** :
  - +30 Fuite (1 tour) à l'allié ciblé.
  - Au tour suivant (délai 1) : la cible (alliée ou ennemie) est téléportée à sa position précédente → Téléfrag possible.
  - 1 PA, 0–6 PO modifiable, sans LdV, case occupée, 3/tour, 2/cible.
- **Rôle tactique** : 1 PA : sur un allié qui va se déplacer, garantit un retour (et souvent un Téléfrag) au tour suivant.
- **Tags** : `placement`, `delayed`, `buff_ally`, `telefrag_generator`, `cheap`
- **Grades** : g1 (niv. 25) : 1 PA, PO 0–4, 3/tour ; g2 (niv. 92) : 1 PA, PO 0–5, 3/tour ; g3 (niv. 159) : 1 PA, PO 0–6, 3/tour
- *Infobulle décodée (auto)* :
  - 30 Fuite — cibles : alliés (lanceur compris) ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis ; DIFFÉRÉ de 1 tour(s) ; non désenvoûtable (sauf mort)

#### 9B. Prémonition (id 13293, niveau de déblocage 135)

- **Caractéristiques** : **2 PA** · PO 0–5 (fixe), sans LdV · 1/tour · CC 0 %
- **Description officielle** : Téléporte le lanceur ou échange sa position avec l'entité sur la case ciblée au tour suivant.  Peut générer un Téléfrag.
- **Effets** :
  - Au tour suivant (délai 1) : le lanceur se téléporte sur la case ciblée, ou échange sa position avec l'entité qui s'y trouve (pas en Pesanteur/Indéplaçable/Enraciné) → Téléfrag possible.
  - 2 PA, 0–5 PO, sans LdV, 1/tour.
- **Rôle tactique** : Planifier une évasion ou une entrée au tour suivant.
- **Tags** : `mobility`, `delayed`, `swap`, `telefrag_generator`
- *Infobulle décodée (auto)* :
  - Téléporte ou échange de positions — cibles : alliés (hors lanceur), ennemis [si le lanceur n'a pas l'état « Pesanteur »; si le lanceur n'a pas l'état « Indéplaçable »; si le lanceur n'a pas l'état « Enraciné »] ; DIFFÉRÉ de 1 tour(s) ; non désenvoûtable (sauf mort)

### Paire 10 : Rayon Obscur / Dessèchement

*Rayon Obscur (Feu, ligne, +12 par Téléfrag) ; Dessèchement (Air, rebonds, +PM).*

#### 10A. Rayon Obscur (id 13253, niveau de déblocage 30)

- **Caractéristiques** : **4 PA** · PO 1–6 (fixe), en ligne, LdV · 1/tour · CC 15 %
- **Description officielle** : Occasionne des dommages Feu aux ennemis en zone. Les dommages du sort sont augmentés pour chaque entité Téléfrag dans la zone avant d'appliquer les effets. Les dommages de zone ne sont pas dégressifs.  Consomme les états Téléfrag sur les cibles.
- **Effets** :
  - Zone : ligne de 4 cases depuis l'impact (1–6 PO, en ligne, LdV), non dégressive.
  - Pour chaque entité Téléfrag (alliée ou ennemie) dans la ligne : consomme son Téléfrag et +12 dégâts de base à Rayon Obscur (pour ce lancer).
  - Puis 31 à 34 dommages Feu (CC 37 à 41) aux ennemis de la ligne (31 + 12 × n de base).
- **Rôle tactique** : 4 PA, 1/tour : finisher de vague ; 3 Téléfrags dans la ligne = 67–70 de base sur chaque ennemi.
- **Tags** : `damage`, `fire`, `aoe_line`, `telefrag_consumer`
- **Grades** : g1 (niv. 30) : 4 PA, PO 1–4, 1/tour, 20–22 Feu ; g2 (niv. 97) : 4 PA, PO 1–5, 1/tour, 27–30 Feu ; g3 (niv. 164) : 4 PA, PO 1–6, 1/tour, 31–34 Feu
- *Infobulle décodée (auto)* :
  - Enlève l'état « Téléfrag » — cibles : alliés (lanceur compris), ennemis ; zone : ligne de 4 cases (impact + 3 derrière), non dégressive
  - Rayon Obscur : +12 dégâts de base — cibles : alliés (lanceur compris), ennemis
  - 31 à 34 dommages Feu (CC : 37 à 41 dommages Feu) — cibles : ennemis ; zone : ligne de 4 cases (impact + 3 derrière), non dégressive

#### 10B. Dessèchement (id 13284, niveau de déblocage 140)

- **Caractéristiques** : **4 PA** · PO 1–6 (fixe), en ligne, LdV · case occupée · relance globale 1 · 1/tour · cumul 3 · CC 15 %
- **Description officielle** : Occasionne des dommages Air aux ennemis. Rebondit sur l'entité la plus proche dans un cercle de taille 2. Augmente également les PM du lanceur pour chaque entité Téléfrag touchée.  Consomme les états Téléfrag sur les cibles.
- **Effets** :
  - 31 à 34 dommages Air (CC 37 à 41) à l'ennemi ciblé (case occupée, 1–6 PO en ligne).
  - Rebondit sur l'entité la plus proche (anneau 1–2) non encore touchée, et ainsi de suite ; chaque ennemi touché subit les mêmes dommages.
  - Chaque entité Téléfrag touchée : consomme son Téléfrag et +1 PM au lanceur (1 tour, cumul 3). Relance globale 1.
- **Rôle tactique** : 4 PA, 1/tour : excellent sur une file d'ennemis espacés de 1–2 cases.
- **Tags** : `damage`, `air`, `chain`, `telefrag_consumer`, `mp_gain`
- *Infobulle décodée (auto)* :
  - Enlève l'état « Téléfrag » — cibles : alliés (lanceur compris), ennemis
  - 1 PM — cibles : lanceur ; 1 tour(s)
  - 31 à 34 dommages Air (CC : 37 à 41 dommages Air) — cibles : ennemis

### Paire 11 : Ralentissement / Sablier de Xélor

*Ralentissement (−1 PA, vol sur Téléfrag) est le cœur du retrait PA ; Sablier pour la voie Feu.*

#### 11A. Ralentissement (id 13242, niveau de déblocage 35)

- **Caractéristiques** : **2 PA** · PO 1–6 (modifiable), LdV · 4/tour · 2/cible · cumul 2 · CC 5 %
- **Description officielle** : Retire des PA et occasionne des dommages Eau. Le retrait devient un vol si la cible est Téléfrag.
- **Effets** :
  - −1 PA esquivable (1 tour) et 15 à 17 dommages Eau (CC 18 à 20) à la cible (alliés compris).
  - Si la cible est Téléfrag : le retrait devient un vol (le lanceur gagne 1 PA pour le tour si le retrait réussit).
- **Rôle tactique** : 2 PA, 1–6 PO modifiable, 4/tour, 2/cible : retrait PA de base ; sur Téléfrag, coût net 1 PA.
- **Tags** : `ap_removal`, `ap_steal`, `damage`, `water`, `cheap`
- **Grades** : g1 (niv. 35) : 2 PA, PO 1–4, 4/tour, 9–11 Eau ; g2 (niv. 102) : 2 PA, PO 1–5, 4/tour, 12–14 Eau ; g3 (niv. 169) : 2 PA, PO 1–6, 4/tour, 15–17 Eau
- *Infobulle décodée (auto)* :
  - -1 PA — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - Vole 1 PA — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - 15 à 17 dommages Eau (CC : 18 à 20 dommages Eau) — cibles : alliés (lanceur compris), ennemis

#### 11B. Sablier de Xélor (id 13261, niveau de déblocage 145)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), en ligne, sans LdV · 2/tour · 1/cible · cumul 1 · CC 5 %
- **Description officielle** : Retire des PA et occasionne des dommages Feu aux ennemis et applique l'état Sablier sur la cible : • Occasionne des dommages Feu à retardement aux ennemis en zone.  Le retardement est réduit pour chaque Téléfrag consommé sur la cible.
- **Effets** :
  - −2 PA esquivables (1 tour) et 10 à 12 dommages Feu (CC 13 à 15) à l'ennemi ciblé (0–6 PO en ligne, sans LdV).
  - État « Sablier » (2 tours) : 2 tours plus tard, 23 à 25 dommages Feu (CC 28 à 30) aux ennemis dans un cercle de 2 autour de la cible.
  - Chaque Téléfrag consommé sur la cible réduit le retardement d'1 tour (Sablier II → I → explosion immédiate).
- **Rôle tactique** : 2 PA, 2/tour, 1/cible : poser puis consommer 2 Téléfrags sur la cible pour une explosion le tour même.
- **Tags** : `ap_removal`, `damage`, `fire`, `delayed`, `aoe`
- *Infobulle décodée (auto)* :
  - -2 PA — cibles : ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - 10 à 12 dommages Feu (CC : 13 à 15 dommages Feu) — cibles : ennemis
  - État « Sablier » — cibles : alliés (lanceur compris), ennemis ; 2 tour(s) ; non désenvoûtable (sauf mort)
  - 23 à 25 dommages Feu (CC : 28 à 30 dommages Feu) — cibles : ennemis ; zone : cercle de rayon 2 ; DIFFÉRÉ de 2 tour(s) ; non désenvoûtable (sauf mort)

### Paire 12 : Flou Temporel / Conservation

*Flou Temporel (−2 PA non esquivables en zone) ; Conservation (×0,76 dégâts subis) pour protéger.*

#### 12A. Flou Temporel (id 13246, niveau de déblocage 40)

- **Caractéristiques** : **2 PA** · PO 0–3 (fixe), LdV · relance 3 · CC 0 %
- **Description officielle** : Retire immédiatement des PA non esquivables en zone pour les augmenter au tour suivant. Le retrait de PA n'affecte pas le lanceur.
- **Effets** :
  - Zone : cercle de 3 (0–3 PO).
  - −2 PA NON esquivables (1 tour) à toutes les entités de la zone sauf le lanceur.
  - Au tour suivant : +2 PA (1 tour) à toutes les entités de la zone (lanceur compris). Relance 3.
- **Rôle tactique** : Retrait PA garanti de zone avant le tour critique d'un paquet ; sur les alliés seulement si leur tour suivant compte plus que l'actuel.
- **Tags** : `ap_removal`, `ap_gain`, `control`
- **Grades** : g1 (niv. 40) : 2 PA, PO 0–1, relance 3 ; g2 (niv. 107) : 2 PA, PO 0–2, relance 3 ; g3 (niv. 174) : 2 PA, PO 0–3, relance 3
- *Infobulle décodée (auto)* :
  - -2 PA — cibles : alliés (hors lanceur), ennemis ; zone : cercle de rayon 3 ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - 2 PA — cibles : alliés (lanceur compris), ennemis ; zone : cercle de rayon 3 ; 1 tour(s) ; DIFFÉRÉ de 1 tour(s) ; non désenvoûtable (sauf mort)

#### 12B. Conservation (id 13291, niveau de déblocage 150)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), LdV · relance 3 · cumul 1 · CC 0 %
- **Description officielle** : Réduit les dommages subis par l'allié ciblé et lui applique l'état Conservation : • Augmente les PA de la cible pour chaque attaque ennemie (cumulable 2 fois).
- **Effets** :
  - Allié ciblé (0–6 PO) : dommages subis ×76 % jusqu'au prochain tour du lanceur et état « Conservation ».
  - +1 PA (1 tour) à chaque attaque ennemie subie (cumul 2). Relance 3.
- **Rôle tactique** : Protection de 24 % sur le tank/l'allié ciblé par le boss ; il gagne jusqu'à 2 PA pour son tour.
- **Tags** : `protection`, `damage_reduction`, `ap_gain`
- *Infobulle décodée (auto)* :
  - Dommages subis x76% — cibles : alliés (lanceur compris) ; DÉCLENCHÉ quand : Le porteur subit des dommages (écoute 1 t) ; non désenvoûtable (sauf mort)
  - État « Conservation » — cibles : alliés (lanceur compris) ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - 1 PA — cibles : alliés (lanceur compris) ; 1 tour(s) ; DÉCLENCHÉ quand : Dommages subis d'un ENNEMI (écoute 1 t)

### Paire 13 : Raulebaque / Instabilité

*Raulebaque (masse de Téléfrags, 2 PA, relance 2) ; Instabilité (glyphe + aura −2 PA).*

#### 13A. Raulebaque (id 13262, niveau de déblocage 45)

- **Caractéristiques** : **2 PA** · PO 0–0 (fixe), sans LdV · relance 2 · CC 0 %
- **Description officielle** : Téléporte tout le monde à sa position précédente.  Peut générer un Téléfrag.
- **Effets** :
  - Téléporte TOUTES les entités du combat (alliés et ennemis, sauf Pesanteur/Indéplaçable/Enraciné) à leur position précédente.
  - Génère autant de Téléfrags que de collisions ; 2 PA, relance 2.
- **Rôle tactique** : Annule les déplacements ennemis du tour (retour au contact, sortie de zone) ; prépare Rayon Obscur/Réfraction.
- **Tags** : `placement`, `mass_teleport`, `telefrag_generator`
- **Grades** : g1 (niv. 45) : 2 PA, PO 0–0, relance 4 ; g2 (niv. 112) : 2 PA, PO 0–0, relance 3 ; g3 (niv. 179) : 2 PA, PO 0–0, relance 2
- *Infobulle décodée (auto)* :
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis [si la cible n'a pas l'état « Pesanteur »; si la cible n'a pas l'état « Indéplaçable »; si la cible n'a pas l'état « Enraciné »] ; zone : toute la carte

#### 13B. Instabilité (id 13301, niveau de déblocage 155)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · relance 3 · CC 0 %
- **Description officielle** : Pose un glyphe de début de tour qui téléporte les cibles à leur position précédente. Pose également un glyphe-aura qui rend les alliés Intaclables et retire des PA aux ennemis.  Le glyphe est déclenché si le lanceur génère ou consomme un Téléfrag.  Peut générer un Téléfrag.
- **Effets** :
  - Glyphe de début de tour (cercle 4, 1 tour) : au début du tour de chaque entité dedans, elle est téléportée à sa position précédente (Téléfrag possible).
  - Glyphe-aura (cercle 4, 1 tour) : alliés Intaclables, ennemis −2 PA esquivables (le sous-sort d'aura #13327 porte une zone C3 : portée exacte de l'aura INCERTAINE, 3 ou 4).
  - Le glyphe est déclenché immédiatement chaque fois que le lanceur génère ou consomme un Téléfrag. Relance 3.
- **Rôle tactique** : Zone de contrôle : un ennemi qui y entre perd 2 PA et revient en arrière.
- **Tags** : `glyph`, `ap_removal`, `placement`, `telefrag_generator`
- *Infobulle décodée (auto)* :
  - Pose un glyphe de début de tour → lance « Instabilité » (#13312, rang 1) — cibles : alliés (lanceur compris), ennemis ; zone : cercle de rayon 4 ; 1 tour(s)
  - Pose un glyphe-aura → lance « Instabilité » (#13327, rang 1) — cibles : alliés (lanceur compris), ennemis ; zone : cercle de rayon 4 ; 1 tour(s)

### Paire 14 : Horloge / Clepsydre

*Horloge (Terre, +24 dégâts de base) ou Clepsydre (Eau, +1 PA au tour suivant).*

#### 14A. Horloge (id 13256, niveau de déblocage 50)

- **Caractéristiques** : **4 PA** · PO 1–6 (fixe), en ligne, LdV · 3/tour · 2/cible · cumul 1 · CC 15 %
- **Description officielle** : Retire des PA et occasionne des dommages Terre. Les dommages du sort sont augmentés avant d'appliquer les effets si la cible est Téléfrag.  Consomme l'état Téléfrag sur la cible.
- **Effets** :
  - Si la cible est Téléfrag : consomme le Téléfrag et +24 dégâts de base à Horloge pendant 3 tours (non cumulable).
  - −2 PA esquivables (1 tour) et 23 à 25 dommages Terre (CC 28 à 30) à la cible (alliés compris).
  - 4 PA, 1–6 PO en ligne, 3/tour, 2/cible.
- **Rôle tactique** : Sort principal Terre : 47–49 de base contre un Téléfrag (et pour les lancers suivants pendant 3 tours).
- **Tags** : `ap_removal`, `damage`, `earth`, `telefrag_consumer`
- **Grades** : g1 (niv. 50) : 4 PA, PO 1–4, 3/tour, 14–16 Terre ; g2 (niv. 117) : 4 PA, PO 1–5, 3/tour, 19–21 Terre ; g3 (niv. 184) : 4 PA, PO 1–6, 3/tour, 23–25 Terre
- *Infobulle décodée (auto)* :
  - Enlève l'état « Téléfrag » — cibles : alliés (lanceur compris), ennemis
  - Horloge : +24 dégâts de base — cibles : lanceur ; 3 tour(s) ; désenvoûtable seulement par effet fort
  - -2 PA — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - 23 à 25 dommages Terre (CC : 28 à 30 dommages Terre) — cibles : alliés (lanceur compris), ennemis

#### 14B. Clepsydre (id 13298, niveau de déblocage 160)

- **Caractéristiques** : **4 PA** · PO 1–6 (fixe), LdV · case occupée · 3/tour · 2/cible · cumul 1 · CC 15 %
- **Description officielle** : Retire des PA et occasionne des dommages Eau. Augmente les PA du lanceur au tour suivant si la cible est Téléfrag (cumulable 3 fois).  Consomme l'état Téléfrag sur la cible.
- **Effets** :
  - Si la cible est Téléfrag : consomme le Téléfrag et +1 PA au lanceur au tour suivant (cumulable 3 fois).
  - −2 PA esquivables (1 tour) et 33 à 37 dommages Eau (CC 40 à 44) à la cible (case occupée, alliés compris).
- **Rôle tactique** : 4 PA, 3/tour : gros coup Eau + entrave ; jusqu'à +3 PA au tour suivant.
- **Tags** : `ap_removal`, `damage`, `water`, `telefrag_consumer`, `ap_gain`
- *Infobulle décodée (auto)* :
  - Enlève l'état « Téléfrag » — cibles : alliés (lanceur compris), ennemis
  - -2 PA — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - 1 PA — cibles : lanceur ; 1 tour(s) ; DIFFÉRÉ de 1 tour(s) ; désenvoûtable seulement par effet fort
  - 33 à 37 dommages Eau (CC : 40 à 44 dommages Eau) — cibles : alliés (lanceur compris), ennemis

### Paire 15 : Réfraction / Régulateur

*Réfraction (Feu, propage le Téléfrag et frappe en zone) ; Régulateur (Terre, désenvoûtement −1 tour).*

#### 15A. Réfraction (id 13286, niveau de déblocage 55)

- **Caractéristiques** : **2 PA** · PO 1–6 (modifiable), LdV · 3/tour · 2/cible · CC 5 %
- **Description officielle** : Occasionne des dommages Feu aux ennemis. Propage l'état Téléfrag et applique les effets en zone si la cible est Téléfrag.  Consomme l'état Téléfrag sur la cible.
- **Effets** :
  - Sur un ennemi non Téléfrag : 16 à 18 dommages Feu (CC 19 à 22).
  - Sur une cible Téléfrag (alliée ou ennemie) : consomme le Téléfrag, 16 à 18 dommages Feu aux ennemis dans un cercle de 2 autour d'elle et applique Téléfrag (1 tour) aux entités de l'anneau 1–2 (propagation ; la Synchro n'est pas affectée).
- **Rôle tactique** : 2 PA, 3/tour : chaîne de zones Feu — chaque lancer re-propage les Téléfrags au lancer suivant.
- **Tags** : `damage`, `fire`, `aoe`, `telefrag_consumer`, `telefrag_applier`, `cheap`
- **Grades** : g1 (niv. 55) : 2 PA, PO 1–4, 3/tour, 10–12 Feu / 10–12 Feu ; g2 (niv. 122) : 2 PA, PO 1–5, 3/tour, 13–15 Feu / 13–15 Feu ; g3 (niv. 189) : 2 PA, PO 1–6, 3/tour, 16–18 Feu / 16–18 Feu
- *Infobulle décodée (auto)* :
  - Enlève l'état « Téléfrag » — cibles : alliés (lanceur compris), ennemis
  - 16 à 18 dommages Feu (CC : 19 à 22 dommages Feu) — cibles : ennemis [si la cible n'a pas l'état « Téléfrag »]
  - 16 à 18 dommages Feu (CC : 19 à 22 dommages Feu) — cibles : ennemis ; zone : cercle de rayon 2
  - État « Téléfrag » — cibles : alliés (lanceur compris), ennemis ; zone : cercle de rayon 2 ; 1 tour(s) ; non désenvoûtable (sauf mort)

#### 15B. Régulateur (id 13248, niveau de déblocage 165)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), en ligne ou diagonale, LdV · 1/tour · 1/cible · CC 10 %
- **Description officielle** : Réduit la durée des effets sur la cible et occasionne des dommages Terre aux ennemis. Augmente le nombre de lancers maximal par tour du sort pour le tour en cours si la cible est Téléfrag.  Consomme l'état Téléfrag sur la cible.
- **Effets** :
  - Réduit de 1 tour la durée des effets désenvoûtables de la cible (alliée ou ennemie).
  - 25 à 28 dommages Terre (CC 30 à 34) à l'ennemi.
  - Si la cible est Téléfrag : consomme le Téléfrag et +1 lancer par tour de Régulateur pour ce tour.
- **Rôle tactique** : 3 PA, 1/tour (2 avec Téléfrag), en ligne/diagonale : raccourcit les buffs d'un boss.
- **Tags** : `damage`, `earth`, `dispel`, `telefrag_consumer`
- *Infobulle décodée (auto)* :
  - Enlève l'état « Téléfrag » — cibles : alliés (lanceur compris), ennemis
  - Durée des effets : -1 — cibles : alliés (lanceur compris), ennemis
  - 25 à 28 dommages Terre (CC : 30 à 34 dommages Terre) — cibles : ennemis
  - Régulateur : +1 lancer(s) par tour — cibles : lanceur ; 1 tour(s) ; désenvoûtable seulement par effet fort

### Paire 16 : Rembobinage / Rémanence

*Rembobinage (retour début de tour, sauvetage d'allié) ; Rémanence (anti-fuite).*

#### 16A. Rembobinage (id 13243, niveau de déblocage 60)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), en ligne, LdV · relance 3 · relance globale -1 · CC 0 %
- **Description officielle** : Téléporte la cible à sa position de début de tour. Les effets sont appliqués à la fin du tour de la cible si c'est un allié.  Peut générer un Téléfrag.
- **Effets** :
  - Téléporte la cible à sa position de DÉBUT de tour (1099) → Téléfrag possible.
  - Ennemi : immédiatement. Allié : à la fin de SON prochain tour. Lanceur : à la fin de son tour (le +2 PA du Téléfrag arrive alors au tour suivant).
  - La Synchro est protégée de l'explosion pendant l'effet (état #3621). 0–6 PO en ligne, relance 3.
- **Rôle tactique** : Un allié peut aller frapper puis revenir à l'abri en fin de tour ; un ennemi qui s'est approché est renvoyé.
- **Tags** : `placement`, `rescue`, `telefrag_generator`
- **Grades** : g1 (niv. 60) : 2 PA, PO 0–4, relance 3 ; g2 (niv. 127) : 2 PA, PO 0–5, relance 3 ; g3 (niv. 194) : 2 PA, PO 0–6, relance 3
- *Infobulle décodée (auto)* :
  - Téléporte à la position de début de tour — cibles : alliés (lanceur compris) ; non désenvoûtable (sauf mort)
  - Téléporte à la position de début de tour — cibles : alliés (lanceur compris) ; DÉCLENCHÉ quand : Fin du tour du PORTEUR (écoute 1 t) ; non désenvoûtable (sauf mort)

#### 16B. Rémanence (id 13255, niveau de déblocage 170)

- **Caractéristiques** : **3 PA** · PO 0–3 (fixe), LdV · relance 3 · relance globale -1 · CC 0 %
- **Description officielle** : Applique l'état Rémanent sur la cible : • Téléporte la cible à sa position précédente pour chaque PM qu'elle utilise. • Les effets sont appliqués à la fin du tour de la cible si c'est un allié.  Peut générer un Téléfrag.
- **Effets** :
  - État « Rémanent » (1 tour) sur la cible (0–3 PO).
  - Ennemi : à chaque PM qu'il utilise, il est téléporté à sa position précédente (déplacement annulé, Téléfrag possible).
  - Allié / lanceur : téléporté à sa position précédente à la fin de son tour (INCERTAIN : une fois par PM utilisé). Relance 3.
- **Rôle tactique** : Équivalent d'un retrait PM total sur un fuyard ou un monstre qui veut venir au contact.
- **Tags** : `control`, `anti_movement`, `telefrag_generator`
- *Infobulle décodée (auto)* :
  - État « Rémanent » — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis ; DÉCLENCHÉ quand : Pour CHAQUE PM utilise (écoute 1 t) ; non désenvoûtable (sauf mort)

### Paire 17 : Paradoxe / Faille

*Paradoxe (double symétrie autour du Complice/Cadran) ; Faille (échange + retour, protège la Synchro).*

#### 17A. Paradoxe (id 13250, niveau de déblocage 65)

- **Caractéristiques** : **2 PA** · PO 0–0 (fixe), sans LdV · relance 2 · relance initiale 1 · CC 0 %
- **Description officielle** : Sur le Complice ou le Cadran de Xélor du lanceur : • Rend l'invocation Indéplaçable. • Téléporte les entités symétriquement par rapport à l'invocation en zone autour d'elle. • Fixe le temps de relance des sorts Complice et Cadran de Xélor du lanceur à 1 tour. • Au début du tour de l'invocation, téléporte de nouveau ces entités symétriquement par rapport à elle.  N'affecte pas la Synchro et le lanceur.  Peut générer un Téléfrag.
- **Effets** :
  - Lancé sur soi (PO 0, relance 2, initiale 1) ; nécessite un Complice ou un Cadran vivant.
  - L'invocation devient Indéplaçable (1 tour) ; toutes les entités (sauf lanceur, Synchro et Pesanteur) dans un cercle de 4 autour d'elle sont téléportées symétriquement par rapport à elle → Téléfrags.
  - Relances de Complice et Cadran fixées à 1 tour ; au début du tour de l'invocation, ces entités sont de nouveau téléportées symétriquement (retour).
- **Rôle tactique** : Génère beaucoup de Téléfrags autour du Complice/Cadran placé au milieu des ennemis.
- **Tags** : `placement`, `mass_teleport`, `telefrag_generator`
- **Grades** : g1 (niv. 65) : 2 PA, PO 0–0, relance 4 ; g2 (niv. 131) : 2 PA, PO 0–0, relance 3 ; g3 (niv. 198) : 2 PA, PO 0–0, relance 2
- *Infobulle décodée (auto)* :
  - État « Indéplaçable » — cibles : alliés (lanceur compris) [« famille » du lanceur (lui, ses invocations); monstre Cadran de Xélor; monstre Complice] ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - Téléportation symétrique — cibles : alliés (hors lanceur), ennemis [sauf Synchro; si la cible n'a pas l'état « Pesanteur »] ; zone : cercle de rayon 4
  - Complice : relance fixée à 1 tour — cibles : lanceur ; désenvoûtable seulement par effet fort
  - Cadran de Xélor : relance fixée à 1 tour — cibles : lanceur ; désenvoûtable seulement par effet fort
  - Téléportation symétrique — cibles : alliés (lanceur compris), ennemis [si la cible a l'état « Paradoxe »; si la cible n'a pas l'état « Pesanteur »] ; zone : toute la carte ; 1 tour(s)

#### 17B. Faille (id 13295, niveau de déblocage 175)

- **Caractéristiques** : **4 PA** · PO 0–0 (fixe), sans LdV · relance 2 · relance initiale 1 · CC 0 % · condition : le lanceur n'a pas « Pesanteur » (`HS!7`)
- **Description officielle** : Échange de position avec la Complice ou le Cadran de Xélor du lanceur et fixe leur temps de relance à 1 tour. À la fin du tour du lanceur, téléporte le Complice ou le Cadran à leur position précédente.  Empêche l'application du Téléfrag sur la Synchro pour le tour en cours.  Peut générer un Téléfrag.
- **Effets** :
  - Lancé sur soi (4 PA, relance 2, initiale 1, pas en Pesanteur) : échange de position avec son Complice ou son Cadran (Téléfrag) ; leurs relances sont fixées à 1 tour.
  - À la fin du tour du lanceur : l'invocation retourne à sa position précédente (Téléfrag possible).
  - La Synchro ne peut pas exploser ce tour (état « Faille (blocage) »).
- **Rôle tactique** : Téléportation longue distance vers son invocation puis retour de celle-ci.
- **Tags** : `mobility`, `swap`, `telefrag_generator`
- *Infobulle décodée (auto)* :
  - Échange de positions — cibles : alliés (lanceur compris) [« famille » du lanceur (lui, ses invocations); monstre Cadran de Xélor; monstre Complice]
  - Complice : relance fixée à 1 tour — cibles : lanceur ; désenvoûtable seulement par effet fort
  - Cadran de Xélor : relance fixée à 1 tour — cibles : lanceur ; désenvoûtable seulement par effet fort
  - Téléporte à la position précédente — cibles : alliés (lanceur compris) [« famille » du lanceur (lui, ses invocations); monstre Cadran de Xélor; monstre Complice] ; DÉCLENCHÉ quand : Fin du tour du PORTEUR (écoute 1 t) ; non désenvoûtable (sauf mort)

### Paire 18 : Pétrification / Gousset

*Pétrification (Eau, coût réduit) ; Gousset (Air, explosion différée).*

#### 18A. Pétrification (id 13290, niveau de déblocage 70)

- **Caractéristiques** : **4 PA** · PO 1–6 (modifiable), LdV · 3/tour · 2/cible · cumul 1 · CC 15 %
- **Description officielle** : Occasionne des dommages Eau et retire des PA. Le coût en PA du sort est réduit après le lancer si la cible est Téléfrag (cumulable 2 fois).  Consomme l'état Téléfrag sur la cible.
- **Effets** :
  - Si la cible est Téléfrag : consomme le Téléfrag et Pétrification coûte 1 PA de moins pendant 3 tours (cumulable 2 fois → 2 PA).
  - 27 à 30 dommages Eau (CC 32 à 36) et −2 PA esquivables (1 tour) à la cible (alliés compris).
- **Rôle tactique** : 4 PA (2 PA après 2 consommations), 3/tour : moteur Eau d'entrave.
- **Tags** : `ap_removal`, `damage`, `water`, `telefrag_consumer`
- **Grades** : g1 (niv. 70) : 4 PA, PO 1–5, 3/tour, 21–23 Eau ; g2 (niv. 137) : 4 PA, PO 1–6, 3/tour, 27–30 Eau
- *Infobulle décodée (auto)* :
  - Enlève l'état « Téléfrag » — cibles : alliés (lanceur compris), ennemis
  - Pétrification : -1 PA — cibles : lanceur ; 3 tour(s) ; désenvoûtable seulement par effet fort
  - 27 à 30 dommages Eau (CC : 32 à 36 dommages Eau) — cibles : alliés (lanceur compris), ennemis
  - -2 PA — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort

#### 18B. Gousset (id 14651, niveau de déblocage 180)

- **Caractéristiques** : **2 PA** · PO 0–6 (modifiable), LdV · 2/tour · 1/cible · cumul 1 · CC 5 %
- **Description officielle** : Retire des PA et occasionne des dommages Air aux ennemis. Occasionne des dommages Air supplémentaires aux ennemis en zone sur la case ciblée à la fin du prochain tour du lanceur si la cible est Téléfrag.  Consomme l'état Téléfrag sur la cible.
- **Effets** :
  - −2 PA esquivables (1 tour) et 12 à 14 dommages Air (CC 15 à 17) à l'ennemi ciblé.
  - Si la cible est Téléfrag : consomme ; à la fin du prochain tour du lanceur, 30 à 32 dommages Air (CC 36 à 38) aux ennemis dans un cercle de 2 autour de la case ciblée.
- **Rôle tactique** : 2 PA, 2/tour, 1/cible : entrave Air bon marché + bombe de zone différée.
- **Tags** : `ap_removal`, `damage`, `air`, `delayed`, `aoe`, `telefrag_consumer`
- *Infobulle décodée (auto)* :
  - Enlève l'état « Téléfrag » — cibles : alliés (lanceur compris), ennemis
  - -2 PA — cibles : ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - 12 à 14 dommages Air (CC : 15 à 17 dommages Air) — cibles : ennemis
  - 30 à 32 dommages Air (CC : 36 à 38 dommages Air) — cibles : ennemis ; zone : cercle de rayon 2 ; DIFFÉRÉ de 1 tour(s) ; non désenvoûtable (sauf mort)

### Paire 19 : Distorsion / Sables du Temps

*Distorsion (carré 3×3 Air, retours) ; Sables du Temps (Feu, rebonds).*

#### 19A. Distorsion (id 13289, niveau de déblocage 75)

- **Caractéristiques** : **4 PA** · PO 0–3 (fixe), LdV · 2/tour · CC 15 %
- **Description officielle** : Téléporte les cibles à leur position précédente et occasionne des dommages Air aux ennemis en zone. Les dommages de zone ne sont pas dégressifs. N'affecte pas le lanceur.  Peut générer un Téléfrag.
- **Effets** :
  - Zone : carré 3×3 autour de l'impact (0–3 PO), non dégressif.
  - Toutes les entités de la zone sauf le lanceur retournent à leur position précédente → Téléfrags possibles.
  - 29 à 32 dommages Air (CC 35 à 38) aux ennemis de la zone.
- **Rôle tactique** : 4 PA, 2/tour : zone Air la plus large du Xélor (9 cases).
- **Tags** : `damage`, `air`, `aoe`, `placement`, `telefrag_generator`
- **Grades** : g1 (niv. 75) : 4 PA, PO 0–3, 2/tour, 23–26 Air ; g2 (niv. 142) : 4 PA, PO 0–3, 2/tour, 29–32 Air
- *Infobulle décodée (auto)* :
  - Téléporte à la position précédente — cibles : alliés (hors lanceur), ennemis [si la cible n'a pas l'état « Pesanteur »; si la cible n'a pas l'état « Indéplaçable »; si la cible n'a pas l'état « Enraciné »] ; zone : carré 3×3, non dégressive
  - 29 à 32 dommages Air (CC : 35 à 38 dommages Air) — cibles : ennemis ; zone : carré 3×3, non dégressive

#### 19B. Sables du Temps (id 13292, niveau de déblocage 185)

- **Caractéristiques** : **4 PA** · PO 1–6 (modifiable), LdV · case occupée · 1/tour · CC 15 %
- **Description officielle** : Téléporte la cible à sa position précédente et occasionne des dommages Feu aux ennemis. Rebondit sur l'entité la plus proche dans un cercle de taille 2.  Le rebond s'effectue depuis la position initiale de chaque cible.  Peut générer un Téléfrag.
- **Effets** :
  - La cible (case occupée, 1–6 PO modifiable) retourne à sa position précédente → Téléfrag possible ; 33 à 36 dommages Feu (CC 40 à 43) si ennemie.
  - Rebondit sur l'entité la plus proche dans un anneau 1–2 autour de la position INITIALE de chaque cible, qui subit les mêmes effets (une fois par entité).
- **Rôle tactique** : 4 PA, 1/tour : nettoie une file d'ennemis et génère des Téléfrags en chaîne.
- **Tags** : `damage`, `fire`, `chain`, `placement`, `telefrag_generator`
- *Infobulle décodée (auto)* :
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis [si la cible n'a pas l'état « Pesanteur »; si la cible n'a pas l'état « Indéplaçable »; si la cible n'a pas l'état « Enraciné »]
  - 33 à 36 dommages Feu (CC : 40 à 43 dommages Feu) — cibles : ennemis

### Paire 20 : Désynchronisation / Espace-temps

*Désynchronisation (piège de symétrie) ; Espace-temps (allié protégé / renvoi).*

#### 20A. Désynchronisation (id 13296, niveau de déblocage 80)

- **Caractéristiques** : **2 PA** · PO 1–6 (modifiable), sans LdV · case libre · case sans piège · 2/tour · CC 0 %
- **Description officielle** : Pose un piège mono-cellule qui téléporte les entités symétriquement par rapport au piège en zone.  Peut générer un Téléfrag.
- **Effets** :
  - Pose un piège mono-cellule (1–6 PO modifiable, sans LdV, case libre sans piège, 2/tour).
  - Déclenché : les entités dans un anneau 1–2 autour du piège sont téléportées symétriquement par rapport à lui → Téléfrags possibles.
- **Rôle tactique** : Piéger le chemin d'un monstre de mêlée pour le renvoyer / créer des Téléfrags au tour ennemi.
- **Tags** : `trap`, `placement`, `telefrag_generator`
- **Grades** : g1 (niv. 80) : 2 PA, PO 1–5, 2/tour ; g2 (niv. 147) : 2 PA, PO 1–6, 2/tour
- *Infobulle décodée (auto)* :
  - Pose un piège → lance « Désynchronisation » (#13309, rang 1) — cibles : alliés (lanceur compris), ennemis

#### 20B. Espace-temps (id 13297, niveau de déblocage 190)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), LdV · relance 3 · CC 0 %
- **Description officielle** : Applique l'état Espace-temps sur la cible : • Téléporte la cible et son attaquant à leur position précédente si elle subit des dommages. • Renvoie également une partie des dommages subis par la cible à son attaquant si c'est un ennemi Téléfrag.  Peut générer un Téléfrag.
- **Effets** :
  - État « Espace-temps » (1 tour) sur la cible (0–6 PO, relance 3).
  - Quand elle subit des dommages : la cible ET son attaquant retournent à leur position précédente (Téléfrags possibles).
  - Sur un allié : 30 % des dommages finaux subis sont renvoyés à l'attaquant s'il est un ennemi Téléfrag.
- **Rôle tactique** : Sur le tank au contact : chaque coup ennemi annule les déplacements et renvoie des dégâts.
- **Tags** : `protection`, `placement`, `reflect`, `telefrag_generator`
- *Infobulle décodée (auto)* :
  - État « Espace-temps » — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis ; DÉCLENCHÉ quand : Le porteur subit des dommages / (ou mort) Le porteur subit des dommages (écoute 1 t) ; non désenvoûtable (sauf mort)
  - Dommages : 30% des dommages finaux subis — cibles : ennemis [entité déclenchante] ; DÉCLENCHÉ quand : Le porteur subit des dommages / (ou mort) Le porteur subit des dommages (écoute 1 t) ; non désenvoûtable (sauf mort)

### Paire 21 : Momification / Vingt-cinquième Heure

*Momification (+2 PM, +60 Retrait PA, Intaclable) ; Vingt-cinquième Heure contre Pesanteur/Enracinement.*

#### 21A. Momification (id 13260, niveau de déblocage 85)

- **Caractéristiques** : **2 PA** · PO 0–0 (fixe), sans LdV · relance 3 · relance initiale 1 · CC 0 %
- **Description officielle** : Applique l'état Téléfrag sur le lanceur, le rend Intaclable et augmente ses PM et son Retrait PA.
- **Effets** :
  - Sur soi (relance 3, initiale 1) : état Téléfrag (1 tour, application directe : pas de +2 PA), Intaclable, +2 PM et +60 Retrait PA (1 tour).
- **Rôle tactique** : Avant une séquence de retrait PA ; le Xélor Téléfrag devient une cible de consommation (Réfraction sur soi pour propager).
- **Tags** : `self_buff`, `mobility`, `ap_removal_boost`, `telefrag_applier`
- **Grades** : g1 (niv. 85) : 2 PA, PO 0–0, relance 3 ; g2 (niv. 152) : 2 PA, PO 0–0, relance 3
- *Infobulle décodée (auto)* :
  - État « Téléfrag » — cibles : lanceur ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - État « Intaclable » — cibles : lanceur ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - 2 PM — cibles : lanceur ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - 60 Retrait PA — cibles : lanceur ; 1 tour(s) ; non désenvoûtable (sauf mort)

#### 21B. Vingt-cinquième Heure (id 14650, niveau de déblocage 195)

- **Caractéristiques** : **3 PA** · PO 0–0 (fixe), sans LdV · relance 5 · relance initiale 1 · CC 0 %
- **Description officielle** : Désactive les états Enraciné, Indéplaçable et Pesanteur sur le lanceur pour le tour en cours.
- **Effets** :
  - Sur soi (3 PA, relance 5, initiale 1) : désactive les états Enraciné, Indéplaçable et Pesanteur du lanceur pour le tour en cours.
- **Rôle tactique** : Contre les boss qui posent Pesanteur (le Xélor perd sinon Téléportation, Faille et ses téléportations de lanceur).
- **Tags** : `self_cleanse`, `anti_control`
- *Infobulle décodée (auto)* :
  - Désactive l'état « Enraciné » — cibles : lanceur ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - Désactive l'état « Indéplaçable » — cibles : lanceur ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - Désactive l'état « Pesanteur » — cibles : lanceur ; 1 tour(s) ; non désenvoûtable (sauf mort)

### Paire 22 : Synchro / Glas

*Synchro (explosion multipliée) ou Glas (4 éléments, nécessite une consommation de Téléfrag).*

#### 22A. Synchro (id 13247, niveau de déblocage 90)

- **Caractéristiques** : **2 PA** · PO 1–4 (fixe), sans LdV · case libre · relance 3 · CC 0 %
- **Description officielle** : Invoque une Synchro statique qui peut occasionner des dommages Air aux ennemis en zone lorsqu'elle entre dans l'état Téléfrag. Elle est détruite après avoir occasionné ses dommages.  La Synchro est immunisée contre l'application directe du Téléfrag et contre les effets de fin de tour des sorts Rembobinage et Rémanence.  Il ne peut y avoir qu'une seule Synchro par équipe. Si la Synchro est encore présente et que celle-ci est ré-invoquée, l'ancienne est détruite pour laisser place à la nouvelle.
- **Effets** :
  - Invoque une Synchro statique (#3958 g2, 1–4 PO, sans LdV, case libre, relance 3, 1 par équipe) ; voir la mécanique « Synchro » (synchronisations +200 % Dommages finaux, soin 100 %, explosion 23 Air cercle 3 quand elle est téléfraguée).
- **Rôle tactique** : À invoquer tôt au milieu des ennemis, synchroniser sur plusieurs tours puis la téléfraguer.
- **Tags** : `summon`, `burst`, `aoe`
- **Grades** : g1 (niv. 90) : 2 PA, PO 1–3, relance 3 ; g2 (niv. 157) : 2 PA, PO 1–4, relance 3
- *Infobulle décodée (auto)* :
  - Invoque : Synchro (#3958, grade 2) — cibles : alliés (lanceur compris), ennemis
  - lance « Fin des Temps » (#24524, rang 1) — cibles : lanceur

#### 22B. Glas (id 13300, niveau de déblocage 200)

- **Caractéristiques** : **4 PA** · PO 0–3 (fixe), en ligne, LdV · relance 3 · cumul 6 · CC 5 % · condition : le lanceur a « 1 Téléfrag consommé » (`HS=707`)
- **Description officielle** : Occasionne des dommages Feu, Eau, Air et Terre aux ennemis en zone.  Les dommages sont augmentés pour chaque Téléfrag consommé depuis son dernier lancer. Les effets sont retirés après utilisation du sort.  Nécessite de consommer au moins un Téléfrag pour être utilisé.
- **Effets** :
  - Nécessite d'avoir consommé au moins un Téléfrag (état #707).
  - Zone : carré 3×3 (0–3 PO en ligne). 6 dommages Feu + 6 Eau + 6 Air + 6 Terre (CC 7 chacun) aux ennemis.
  - +6 dégâts de base à chaque élément par Téléfrag consommé depuis le dernier lancer (Glas I à VI, max +36 → 42 par élément) ; bonus retirés après le lancer. Relance 3.
- **Rôle tactique** : 4 PA : jusqu'à 4 × 42 de base sur chaque ennemi du carré pour un Xélor multi-éléments.
- **Tags** : `damage`, `multi_element`, `aoe`, `telefrag_payoff`
- *Infobulle décodée (auto)* :
  - 6 dommages Feu (CC : 7 dommages Feu) — cibles : ennemis [si le lanceur a l'état « 1 Téléfrag consommé »] ; zone : carré 3×3
  - 6 dommages Eau (CC : 7 dommages Eau) — cibles : ennemis [si le lanceur a l'état « 1 Téléfrag consommé »] ; zone : carré 3×3
  - 6 dommages Air (CC : 7 dommages Air) — cibles : ennemis [si le lanceur a l'état « 1 Téléfrag consommé »] ; zone : carré 3×3
  - 6 dommages Terre (CC : 7 dommages Terre) — cibles : ennemis [si le lanceur a l'état « 1 Téléfrag consommé »] ; zone : carré 3×3
  - Glas : +6 dégâts de base — cibles : lanceur [si la cible a l'état « Glas »] ; infini ; désenvoûtable seulement par effet fort

## Invocations

### Synchro (monstre 3958, grade 2) — Synchro (Synchro, P22A)

- PA 0, PM -1 (−1 = statique), PV = 120 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 12 / Terre 12 / Feu 12 / Eau 12 / Air 12 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 500
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 120}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : False
- Sort de départ (niveau de sort 41596) : voir la mécanique correspondante ci-dessus.
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 37.5], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Cadran de Xélor (monstre 3960, grade 3) — Cadran de Xélor (P5B)

- PA 12, PM -1 (−1 = statique), PV = 120 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 24 / Terre 24 / Feu 24 / Eau 24 / Air 24 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 120, 'wisdom': 100}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : False
- Sort de départ (niveau de sort 41594) : voir la mécanique correspondante ci-dessus.
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 3.75], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Complice (monstre 5144, grade 3) — Complice (P5A)

- PA 12, PM 3 (−1 = statique), PV = 60 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 24 / Terre 24 / Feu 24 / Eau 24 / Air 24 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 60}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : False
- Sort de départ (niveau de sort 77943) : voir la mécanique correspondante ci-dessus.
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 130], [10, 0.125], [11, 0], [12, 0.125], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

## Rôle en groupe PvM (niveau 200)

### Rôles officiels (DofusDB, valeur /12)

Placement 9, Entrave 7, Dégâts 7, Amélioration 4, Tank 2, Invocation 2, Protection 0, Soins 0

### Rôles retenus pour l'IA de composition

- **entraveur-retrait-PA** (priorité 1, élément : Eau/Terre (Chance/Force) ou Eau/Feu) — Ralentissement (−1 PA, 4/tour), Horloge et Pétrification (−2 PA), Clepsydre (−2 PA), Flou Temporel (−2 PA non esquivables en zone), Cadran (−2 PA en aura), Momification (+60 Retrait PA). Contre un boss : 4 à 8 PA retirés par tour avec beaucoup de Retrait PA.
- **placeur** (priorité 2, élément : indifférent) — Symétries (Perturbation, Frappe, Engrenage, Rouage), retours (Gelure, Souvenir, Raulebaque, Rembobinage), échanges (Permutation, Astrolabe) et pièges de symétrie (Désynchronisation) pour regrouper des ennemis dans les zones alliées, sortir un allié du contact ou mettre un ennemi au contact d'un Iop/Sacrieur.
- **dps-zone-feu-air** (priorité 3, élément : Feu/Air (Intelligence/Agilité)) — Rayon Obscur (+12 par Téléfrag), Poussière, Réfraction (zone sur Téléfrag), Pendule, Distorsion (carré 3×3), Sables du Temps / Dessèchement (rebonds), Gousset, Synchro (explosion cercle 3 multipliée), Glas (4 éléments, +6 par Téléfrag consommé).

### Choix des variantes par rôle

| Paire | `xelor_entraveur_eau_terre` | `xelor_zone_feu_air_vagues` | `xelor_soutien_placement` |
|---|---|---|---|
| 1 | A — Perturbation | A — Perturbation | A — Perturbation |
| 2 | A — Gelure | B — Poussière | A — Gelure |
| 3 | A — Souvenir | A — Souvenir | B — Permutation |
| 4 | A — Frappe de Xélor | B — Pendule | A — Frappe de Xélor |
| 5 | B — Cadran de Xélor | A — Complice | A — Complice |
| 6 | A — Téléportation | A — Téléportation | B — Astrolabe |
| 7 | B — Aiguille | A — Flétrissement | A — Flétrissement |
| 8 | A — Engrenage | A — Engrenage | B — Compte-goutte |
| 9 | A — Fuite du Temps | A — Fuite du Temps | B — Prémonition |
| 10 | A — Rayon Obscur | A — Rayon Obscur | A — Rayon Obscur |
| 11 | A — Ralentissement | B — Sablier de Xélor | A — Ralentissement |
| 12 | A — Flou Temporel | A — Flou Temporel | B — Conservation |
| 13 | A — Raulebaque | A — Raulebaque | A — Raulebaque |
| 14 | A — Horloge | A — Horloge | B — Clepsydre |
| 15 | B — Régulateur | A — Réfraction | A — Réfraction |
| 16 | B — Rémanence | A — Rembobinage | A — Rembobinage |
| 17 | A — Paradoxe | A — Paradoxe | B — Faille |
| 18 | A — Pétrification | B — Gousset | A — Pétrification |
| 19 | A — Distorsion | A — Distorsion | A — Distorsion |
| 20 | A — Désynchronisation | A — Désynchronisation | B — Espace-temps |
| 21 | A — Momification | A — Momification | A — Momification |
| 22 | B — Glas | A — Synchro | A — Synchro |

- `xelor_entraveur_eau_terre` : Xélor retrait PA (Eau/Terre) pour boss : Ralentissement, Horloge, Pétrification, Clepsydre, Flou Temporel, Cadran, Glas.
- `xelor_zone_feu_air_vagues` : Xélor dégâts de zone (Feu/Air) pour les combats de vagues : Poussière, Pendule, Rayon Obscur, Sablier, Réfraction, Gousset, Distorsion, Synchro.
- `xelor_soutien_placement` : Xélor de soutien : Conservation (×0,76 dégâts subis), Espace-temps, Rembobinage, Prémonition, Astrolabe pour sauver/replacer des alliés.

### Rotations types (PA indiqués entre parenthèses, 11–12 PA / 6 PM)

**Xélor entraveur — tour type (12 PA)** — objectif : Retirer 5–7 PA au boss avant son tour tout en infligeant des dégâts Eau/Terre.

1. Gelure (2) sur un ennemi dont la position précédente est maintenant occupée (allié, Complice) → échange + Téléfrag (+2 PA)
2. Horloge (4) sur l'ennemi Téléfrag → consomme, +24 dégâts de base, −2 PA
3. Pétrification (4) → −2 PA
4. Ralentissement (2) ×2 → −1 PA ×2
5. (PA bonus) Ralentissement / Flou Temporel

**Xélor zone — vague (12 PA)** — objectif : Enchaîner génération puis consommation de Téléfrags sur un paquet.

1. Raulebaque (2) → tous les ennemis qui ont bougé reviennent ; Téléfrags multiples (+2 PA)
2. Rayon Obscur (4) dans la ligne de Téléfrags → +12 dégâts de base par Téléfrag
3. Réfraction (2) sur une cible Téléfrag → zone cercle 2 + propagation
4. Poussière (4) ou Pendule (4)
5. (+2 PA) Réfraction

**Xélor Synchro — préparation sur 3 tours** — objectif : Burst de zone multiplié (INCERTAIN sur le multiplicateur exact).

1. T1 : Synchro (2) au milieu des ennemis ; générer un Téléfrag avec un sort A (synchro k=1)
2. T2 : générer un Téléfrag avec un sort d'une AUTRE paire (k=2, ×3)
3. T3 : idem (k=3, ×5) puis téléfraguer la Synchro elle-même (Perturbation/Frappe sur un ennemi qui atterrit sur elle) → explosion cercle 3

### Synergies

- **Iop / Sacrieur / Ouginak (mêlée)** : Symétries et échanges amènent l'ennemi au contact ; le retrait PA protège le mêlée exposé ; Conservation réduit ses dégâts subis.
- **Crâ / Huppermage / Roublard (zones)** : Raulebaque, Engrenage, Rouage, Paradoxe regroupent ou alignent les ennemis dans les zones ; Désynchronisation piège un couloir.
- **Enutrof / Sram (retrait PM)** : Double entrave PA+PM : le boss ne joue plus ; Rémanence remplace le retrait PM sur un fuyard.
- **Eniripsa** : Mot Stimulant (+2 PA) et Rembobinage/Fuite du Temps pour sauver l'Eniripsa ; les Encouragements augmentent la fenêtre de Téléfrag.
- **Pandawa (anti-synergie)** : Les états Pesanteur/Enraciné et le porté bloquent les téléportations ; éviter de téléporter un allié porté.
- **Féca** : Les glyphes Féca + Instabilité/Désynchronisation maintiennent les ennemis dans les auras.

### Notes pour la démo « Œil de Vortex »

- Le Vortex est Indéplaçable (et à −100 PM) tant que les monstres ne sont pas tous corrompus : aucune téléportation/symétrie Xélor ne le déplace en phase 1 (masque e97) ; seuls les monstres de vague et l'Auroraire (invocation) sont des cibles de placement (docs/research/vortex.md §0).
- « En temps et en heure » frappe tous les ennemis du Vortex alignés avec l'Auroraire (500 Terre de base + 50 % des PV érodés) : Rembobinage (allié ramené à sa case de début de tour en fin de tour), Fuite du Temps, Permutation/Astrolabe et Prémonition servent à sortir un allié de la ligne avant le tour du Vortex.
- Les primitives de téléportation Xélor (1100, 1104, 1105, 1106, échanges) sont aussi utilisées par les monstres du Xélorium (ex. Morfaille utilise 1100) : implémentation commune indispensable.
- Phase 2 (Vortex vulnérable, 16 PA / 5 PM) : le retrait PA (Flou Temporel non esquivable, Horloge/Pétrification/Ralentissement, Cadran) est la contribution principale du Xélor.
- Vagues de N monstres : Raulebaque + Rayon Obscur / Réfraction / Synchro pour les dégâts de zone ; attention à ne pas tuer un monstre hors de sa « Même heure » si l'on veut le corrompre.

### Forces

- Meilleur placement du jeu (symétries, retours, échanges, pièges) et retrait PA massif (esquivable et non esquivable).
- Économie de PA très élevée grâce aux Téléfrags (+2 PA par sort générateur et par tour).
- Quatre éléments jouables et dégâts de zone importants sur paquets téléfragués (Rayon Obscur, Réfraction, Synchro, Glas).
- Outils de sauvetage d'alliés (Rembobinage, Fuite du Temps, Permutation, Astrolabe, Conservation, Espace-temps).

### Faiblesses

- Complexité extrême : le gain dépend de la géométrie (cases occupées) et de l'historique de position ; IA difficile.
- Inopérant contre les cibles Pesanteur/Indéplaçables/Enracinées (boss souvent immunisés aux déplacements).
- Aucun soin ; peu de résistance propre ; plusieurs sorts touchent les alliés (Ralentissement, Horloge, Pétrification, Clepsydre, Flétrissement : masque a,A).
- Le retrait PA est esquivable (sauf Flou Temporel) : rendement faible contre une forte Esquive PA.

## États importants

| État | Nom (données) | Rôle |
|---|---|---|
| #3622 | Téléfrag | Téléfrag (affiché) — 2 tours (génération) ou 1 tour (application directe) |
| #244 | Téléfrag | Téléfrag (caché, entité ALLIÉE du lanceur) — testé par E244 |
| #251 | Téléfrag | Téléfrag (caché, entité ENNEMIE) — testé par E251 |
| #707 | 1 Téléfrag consommé | 1 Téléfrag consommé — condition de lancement de Glas (HS=707) |
| #306 | Synchronisé | Synchronisé (Synchro) — 1 synchronisation par tour |
| #3621 | Synchro (blocage) | Synchro (blocage) — posé pendant Rembobinage/Rémanence de fin de tour |
| #614 | Faille (blocage) | Faille (blocage) — la Synchro n'explose pas ce tour |
| #7 | Pesanteur | Pesanteur — bloque téléportations/échanges (cible e7 ; Téléportation/Faille HS!7) |
| #97 | Indéplaçable | Indéplaçable — idem |
| #6 | Enraciné | Enraciné — idem |
| #6128 | Sablier | Sablier — explosion Feu retardée |
| #2328 | Aiguille | Aiguille — dégâts Terre quand la cible perd son Téléfrag |
| #6135 | Rémanent | Rémanent — retour à la position précédente à chaque PM utilisé |
| #3998 | Espace-temps | Espace-temps — cible et attaquant reviennent à leur position précédente |
| #6138 | Conservation | Conservation — ×0,76 dégâts subis et +1 PA par attaque ennemie |
| #3459 | Glas (sélection) | Glas (sélection) — INCERTAIN, variante équipée |
| #3460 | Instabilité (sélection) | Instabilité (sélection) |
| #3461 | Téléportation (sélection) | Téléportation (sélection) |
| #6139 | Retour Spontané (sélection) | Retour Spontané (sélection) — Astrolabe |

## Points incertains

- INCERTAIN — États « (sélection) » (#3459 Glas, #3460 Instabilité, #3461 Téléportation, #6139 Retour Spontané) jamais posés par un sort : supposés posés par le serveur quand la variante est équipée.
- INCERTAIN — Masque `*E37xx` dans Fin des Temps g2 (états « Téléfrag inactif » posés sur la Synchro) : supposé = le Xélor porte un état équivalent quand le sort est équipé ; sinon la Synchro aurait tous les états.
- INCERTAIN — Multiplicateur de dégâts de la Synchro (2k−1) déduit du cumul additif des Dommages finaux (−200 % puis +200 % par synchronisation).
- INCERTAIN — Aiguille : déclenchement sur perte du Téléfrag `max1` = une seule fois sur les 2 tours (données) vs « une seule fois par tour » (description).
- INCERTAIN — PV des invocations : bonusCharacteristics.lifePoints (Synchro/Cadran 120, Complice 60) interprété comme % des PV du Xélor (convention du projet).
- INCERTAIN — globalCooldown = 1 (Aiguille, Dessèchement) : relance partagée entre Xélors de l'équipe ; −1 (Rembobinage, Rémanence) : aucune (mechanics.md §4.4).
- INCERTAIN — Rémanence sur un allié : nombre de retours en fin de tour (un par PM utilisé ou un seul) non déterminable avec certitude.

## Sources

- https://api.dofusdb.fr/breeds/5
- https://api.dofusdb.fr/spell-variants?breedId=5
- https://api.dofusdb.fr/spells?id[$in][]=13288 (… 44 sorts) et sous-sorts liés (data/dofusdb/class-spells.json, linkedSpells)
- https://api.dofusdb.fr/spell-levels?spellId[$in][]=13288 (… 91 niveaux)
- https://api.dofusdb.fr/spells/24510 (texte officiel de l'état Téléfrag)
- https://api.dofusdb.fr/monsters/3958, /3960, /5144 (Synchro, Cadran, Complice)
- docs/research/effects.md, data/research/effect-semantics.json, data/research/zone-and-mask-grammar.json, docs/research/mechanics.md
- https://www.gamosaurus.com/jeux/dofus/guide-stuff-xelor-dofus-items-equipements-panoplies-dofusbook (guide Dofus Unity, modifié le 2 octobre 2025 : « classe de dégâts et de placement »)
- https://www.breakflip.com/fr/dofus/guide/dofus-guide-des-sorts-et-variantes-du-xelor-2231 (historique 2.45 : +2 PA par Téléfrag, Synchro)
- https://www.millenium.org/guide/337530.html (historique 2.52)
