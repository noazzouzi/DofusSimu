# Ecaflip (classe 6) — analyse complète pour le simulateur

> Données : API DofusDB (`/breeds/6`, `/spell-variants?breedId=6`, `/spells`, `/spell-levels`, `/spell-states`, `/monsters`),
> fichiers du jeu Dofus 3 (enregistrements mis à jour jusqu'au 2026-06-23), extraits le 2026-10-04 ; les données
> `data/dofusdb/class-spells.json` du dépôt ont été vérifiées identiques à l'API live (91 niveaux de sorts, 0 écart).
> Toutes les valeurs sont celles du **grade le plus élevé utilisable au niveau 200**. Les guides web ne servent qu'à
> l'interprétation ; en cas de désaccord, les données du jeu priment. Fichier machine associé :
> [`data/research/class-mechanics/ecaflip.json`](../../../data/research/class-mechanics/ecaflip.json). Dump brut décodé (tous
> sous-sorts développés) : `.cache/classes/b5_8/dump/breed_6.txt` (non versionné).

**Identité** : « Combattant imprévisible » (complexité 4). Rôles officiels DofusDB (`breeds/6.roles`, /12) : **Dégâts 9**
(« importants dommages à courte et moyenne portée »), **Amélioration 7** (« augmente PM, PA et Puissance ; bonus
aléatoires à chaque tour »), **Soins 6** (« soigne les alliés avec ses sorts offensifs ou son invocation »), Entrave 4,
Placement 3, Invocation 3, Protection 2, Tank 0.

**Résumé tactique** : l'Ecaflip est un DPS hybride soigneur, articulé autour du **Poker d'Ecaflip** : chaque sort
élémentaire **pioche une carte** déterminée par son coût en PA (2 PA Valet, 3 PA Dame, 4 PA Roi, 5 PA As) et son élément
(Air = Pique, Eau = Trèfle, Feu = Cœur, Terre = Carreau). La **Main** contient au plus 4 cartes ; chaque carte détenue
augmente les dégâts de base de certains sorts (sort de la couleur, Tout ou Rien, Bluff). **Jouer la Main** (Bonne Pioche,
Redistribution, Château de Cartes, Odorat, Roue de la Fortune, Seconde Chance, Bluff, Tromperie…) pose ses cartes sur la
**Table** (bonus de caractéristiques pendant 3 tours) et, si les 4 cartes forment une **Main Gagnante** (paires, brelans,
carrés, suites royales), donne un gros bonus (jusqu'à +200 dans les 4 caractéristiques ou +180 Puissance) et débloque
**Rekop**. Autour de ce cœur : aléatoire « positif » (Pile ou Face, Topkaj, Yams, Tromperie, Roulette, **Tarot** à 22
arcanes affectant tout le combat), soins (Langue Râpeuse, Topkaj, Neuf Vies, Bonne Étoile, Tout ou Rien, Chaton
Affectueux), boucliers (Château de Cartes) et invocations (Chatons).

## Sommaire

- Tableau des 22 paires · Efficacité brute · Mécaniques spécifiques · Détail de tous les sorts · Invocations · Rôle en groupe PvM (variantes, rotations, synergies) · États importants · Points incertains · Sources

## Tableau des 22 paires de sorts (variantes)

Chaque ligne est une paire de variantes : un personnage n'équipe qu'**un seul** sort de chaque paire (choix hors combat). Le niveau indiqué est celui du déblocage.

| # | Variante A | PA | Variante B | PA | Notes |
|---|---|---|---|---|---|
| 1 | Réflexes (12857, niv. 1) | 2 | Lapement (12873, niv. 95) | 4 | Réflexes (+1 PM par lancer, Valet de Pique) ou Lapement (croix 1 Terre, −3 PA/PM, Roi de Carreau). |
| 2 | Yams (29680, niv. 1) | 2 | Langue Râpeuse (12855, niv. 100) | 4 | Yams (+3–18 % critique, aléatoire) ou Langue Râpeuse (croix 1 soin + dommages Feu) — LE sort Feu. |
| 3 | Topkaj (12846, niv. 1) | 2 | Griffe Joueuse (12849, niv. 105) | 4 | Topkaj (16/19/22 soin ou dommages Feu, 2 PA) ou Griffe Joueuse (ligne Eau, −31–35 rés. critiques). |
| 4 | Pile ou Face (12841, niv. 1) | 2 | Fanfaronnade (12878, niv. 110) | 4 | Pile ou Face (contrôle de l'aléatoire, +1 PA/PM) ou Fanfaronnade (croix Air, rampe par déplacement). |
| 5 | Bonne Pioche (12843, niv. 5) | 1 | Redistribution (12877, niv. 115) | 1 | Bonne Pioche (pioche 1, gratuit, 3/tour) ou Redistribution (joue + pioche 4, gratuit). |
| 6 | Bond du Félin (12844, niv. 10) | 1 | Entrechat (12865, niv. 120) | 2 | Bond du Félin (+1 PM allié / téléportation 1 case, 1 PA) ou Entrechat (téléport/échange 2 PO + Fuite). |
| 7 | Jass (12864, niv. 15) | 3 | Infortune (12880, niv. 125) | 5 | Jass (Air, rés. poussée) ou Infortune (5 PA, vol Eau + dommages si pas de critique). |
| 8 | Perception (12852, niv. 20) | 2 | Prédation (12867, niv. 130) | 2 | Perception (soin 5 %/ennemi + révèle) ou Prédation (+15 % Érosion de zone). |
| 9 | Baraka (12848, niv. 25) | 3 | Toupet (12882, niv. 135) | 5 | Baraka (Eau, −% critique) ou Toupet (5 PA, vol Air + poussée + piège réactif). |
| 10 | Château de Cartes (12845, niv. 30) | 3 | Bonne Étoile (12876, niv. 140) | 2 | Château de Cartes (bouclier selon la main + joue) ou Bonne Étoile (soin 5 % + boucliers sur critiques). |
| 11 | Blakjak (12870, niv. 35) | 3 | Destin d'Ecaflip (12859, niv. 145) | 5 | Blakjak (Feu, ×0,85 soins reçus) ou Destin d'Ecaflip (5 PA, vol Terre, attire/repousse). |
| 12 | Roulette (12840, niv. 40) | 1 | Tarot d'Ecaflip (12850, niv. 150) | 1 | Roulette (1 effet global aléatoire, gratuit) ou Tarot (22 arcanes, −1 PA sur des familles de sorts). |
| 13 | Belote (12866, niv. 45) | 3 | Péril (14311, niv. 155) | 5 | Belote (Terre, −Dommages critiques) ou Péril (5 PA, vol Feu + dommages si soigné). |
| 14 | Tromperie (12881, niv. 50) | 2 | Tout ou Rien (12858, niv. 160) | 3 | Tromperie (2–5 PA aléatoire, vol/soin 4 éléments) ou Tout ou Rien (cercle 3 soin + dommages, recycle la Table). |
| 15 | Pelotage (14310, niv. 55) | 3 | Griffe de Ceangal (12851, niv. 165) | 3 | Pelotage (croix Feu + attire) ou Griffe de Ceangal (Air, repousse + avance). |
| 16 | Griffe Invocatrice (12856, niv. 60) | 3 | Caresse Invocatrice (12869, niv. 170) | 3 | Griffe Invocatrice (Chaton offensif, +90 Puissance) ou Caresse Invocatrice (Chaton soigneur). |
| 17 | Esprit Félin (12847, niv. 65) | 3 | Kraps (12883, niv. 175) | 3 | Esprit Félin (Terre, symétries, +rés. critiques) ou Kraps (croix Eau, repousse, +Dommages critiques). |
| 18 | Odorat (12854, niv. 70) | 3 | Roue de la Fortune (12863, niv. 180) | 3 | Odorat (−3 PA non esquivables puis +3 PA) ou Roue de la Fortune (999 % critique aux alliés au contact). |
| 19 | Coussinets (12875, niv. 75) | 4 | Feulement (12872, niv. 185) | 4 | Coussinets (Air, recule + repousse) ou Feulement (ligne Feu, repousse 3). |
| 20 | Seconde Chance (12842, niv. 80) | 2 | Neuf Vies (12874, niv. 190) | 3 | Seconde Chance (×0,5 puis ×1,5 dégâts subis) ou Neuf Vies (3 × 9 % PV max + 3 pioches). |
| 21 | Félintion (12861, niv. 85) | 4 | Mésaventure (12879, niv. 195) | 4 | Félintion (Eau, avance + attire) ou Mésaventure (anneau 2 Terre, symétries, −2 PA/PM). |
| 22 | Bluff (29785, niv. 90) | 3 | Rekop (12853, niv. 200) | 4 | Bluff (dommages fixes par couleur en main, joue la main) ou Rekop (paie la Main Gagnante). |

## Efficacité brute des sorts de dommages (grade niveau 200, avant caractéristiques)

Moyenne du jet de base (hors critique) ; « /PA » = moyenne ÷ coût. Les bonus conditionnels (rampes, Téléfrag, cartes…) sont indiqués en remarque. Un sort de zone touche potentiellement plusieurs cibles.

| Sort | Paire | PA | Élément | Base | CC | Moy. | Moy./PA | Zone | Lancers/tour | Remarque |
|---|---|---|---|---|---|---|---|---|---|---|
| Esprit Félin | 17A | 3 | Terre | 31–34 | 41 | 32.5 | 10.8 | cible | 2 |  |
| Pelotage | 15A | 3 | Feu | 29–32 | 38 | 30.5 | 10.2 | croix de 1 | 2 |  |
| Tromperie | 14A | 2 | Air | 19–20 | 30 | 19.5 | 9.8 | cible | 3 | vol de vie; soin miroir Air/Eau/Feu/Terre; coût/élément aléatoires : 2 PA 19–20 … 5 PA 46–50 |
| Mésaventure | 21B | 4 | Terre | 37–41 | 49 | 39.0 | 9.8 | anneau de rayon exactement 2 | 2 | −2 PA ou −2 PM |
| Blakjak | 11A | 3 | Feu | 27–31 | 37 | 29.0 | 9.7 | cible | 3 | +2..+5 par Cœur |
| Kraps | 17B | 3 | Eau | 28–30 | 34 | 29.0 | 9.7 | croix de 1 | 2 |  |
| Baraka | 9A | 3 | Eau | 27–30 | 35 | 28.5 | 9.5 | cible | 3 | +2..+5 par Trèfle |
| Belote | 13A | 3 | Terre | 27–30 | 36 | 28.5 | 9.5 | cible | 3 | +2..+5 par Carreau |
| Griffe de Ceangal | 15B | 3 | Air | 27–29 | 33 | 28.0 | 9.3 | cible | 2 |  |
| Toupet | 9B | 5 | Air | 44–48 | 58 | 46.0 | 9.2 | cible | 1 | vol de vie; + 26–28 réactif |
| Jass | 7A | 3 | Air | 26–29 | 35 | 27.5 | 9.2 | cible | 3 | +2..+5 par Pique en main |
| Coussinets | 19A | 4 | Air | 35–38 | 46 | 36.5 | 9.1 | cible | 2 |  |
| Pile ou Face | 4A | 2 | Terre | 18 | 22 | 18.0 | 9.0 | cible | 3 | fixe |
| Péril | 13B | 5 | Feu | 43–47 | 56 | 45.0 | 9.0 | cible | 1 | vol de vie; + 26–28 réactif |
| Destin d'Ecaflip | 11B | 5 | Terre | 42–46 | 55 | 44.0 | 8.8 | cible | 1 | vol de vie; + 25–27 réactif |
| Félintion | 21A | 4 | Eau | 33–36 | 43 | 34.5 | 8.6 | cible | 2 |  |
| Infortune | 7B | 5 | Eau | 41–45 | 54 | 43.0 | 8.6 | cible | 1 | vol de vie; + 31–33 fin de tour |
| Lapement | 1B | 4 | Terre | 32–36 | 43 | 34.0 | 8.5 | croix de 1 | 2 | −3 PA ou −3 PM |
| Griffe Joueuse | 3B | 4 | Eau | 31–35 | 42 | 33.0 | 8.2 | ligne depuis le lanceur jusqu'à la case ciblée (incluse), non dégressive | 2 | −31 à −35 rés. critiques |
| Topkaj | 3A | 2 | Feu | 16 | 19 | 16.0 | 8.0 | cible | 3 | soin miroir Feu; 16/19/22 équiprobables (ou soin) |
| Feulement | 19B | 4 | Feu | 30–34 | 41 | 32.0 | 8.0 | ligne de 4 cases (impact + 3 derrière) | 2 |  |
| Langue Râpeuse | 2B | 4 | Feu | 30–33 | 40 | 31.5 | 7.9 | croix de 1 | 2 | soin miroir Feu |
| Réflexes | 1A | 2 | Air | 14–17 | 20 | 15.5 | 7.8 | cible | 3 |  |
| Fanfaronnade | 4B | 4 | Air | 28–32 | 38 | 30.0 | 7.5 | croix de 1 | 1 | +6 par déplacement (max +24) |
| Tout ou Rien | 14B | 3 | meilleur élt. | 16–18 | 21 | 17.0 | 5.7 | cercle de rayon 3 | 1 (relance 2) | soin miroir meilleur élément; +4..+10 par carte en main |
| Yams | 2A | 2 | Eau | 3–18 | 21 | 10.5 | 5.2 | cible | 3 | jet très large |

## Mécaniques spécifiques à implémenter

### 1. Pioche : sort → carte

Chaque sort élémentaire lance un sous-sort « <Carte> » (#29675–#29702) si la Main n'est pas pleine (état « 4 Cartes » #5464 absent) et si la carte n'est pas déjà détenue. Coût → valeur : 2 PA Valet, 3 PA Dame, 4 PA Roi, 5 PA As ; élément → couleur : Air Pique, Eau Trèfle, Feu Cœur, Terre Carreau. Exemples : Réflexes → Valet de Pique, Jass/Griffe de Ceangal → Dame de Pique, Fanfaronnade/Coussinets → Roi de Pique, Toupet → As de Pique ; Yams → Valet de Trèfle, Baraka/Kraps → Dame de Trèfle, Griffe Joueuse/Félintion → Roi de Trèfle, Infortune → As de Trèfle ; Topkaj → Valet de Cœur, Blakjak/Pelotage → Dame de Cœur, Langue Râpeuse/Feulement → Roi de Cœur, Péril → As de Cœur ; Pile ou Face → Valet de Carreau, Belote/Esprit Félin → Dame de Carreau, Lapement/Mésaventure → Roi de Carreau, Destin d'Ecaflip → As de Carreau. Tromperie pioche selon son coût et son élément aléatoires.

*Implémentation :* Carte = 3 états (carte #5440…, couleur #5465–#5468, valeur #5476–#5479) + compteurs (« 1–4 Valets/Dames/Rois/As », « 1–4 Cartes ») + bonus permanents tant qu'elle est en main (293, durée infinie) : sort de la couleur (Jass/Baraka/Blakjak/Belote) +2/+3/+4/+5, Tout ou Rien +4/+6/+8/+10, Bluff de la couleur +4/+6/+8/+10 (Valet/Dame/Roi/As). Représenter la Main comme un ensemble de ≤ 4 cartes ; recalculer les bonus à chaque changement.

### 2. Mains Gagnantes (évaluées à la 4e carte)

Quand la 4e carte entre en main (Main d'Ecaflip #29703), l'état de la meilleure combinaison est posé + « Main Gagnante » #5554 : Carré d'As/Rois/Dames/Valets, Suite Royale Couleurs (V-D-R-A de 4 couleurs différentes), Suite Royale de Pique/Trèfle/Cœur/Carreau (V-D-R-A de la même couleur : +6 au sort de la couleur et +28 au Bluff de la couleur dès la pioche), Suite Royale (V-D-R-A), Carré Couleurs (4 couleurs), Paires (2+2), Brelans (3 + une autre figure). Les doublons sont résolus par priorité (Suite Royale Couleurs > Carrés ; Suite royale de couleur > Suite Royale ; Carré Couleurs seulement si rien d'autre).

*Implémentation :* Fonction `evaluateHand(cards)` → une combinaison (voir tableau). Les cartes étant uniques (pas de doublon possible), une main de 4 cartes forme au plus : un carré de valeur, une suite, des paires, un brelan, ou un carré de couleurs.

### 3. Jouer la Main → Table (3 tours)

Poker d'Ecaflip #29683 : retire les effets de la Table précédente, applique pour chaque carte de la main son effet de Table pendant 3 tours (Pique : +10/20/30/40 Dommages Poussée ; Trèfle : +4/6/8/10 % Critique ; Cœur : +10/20/30/40 Soins ; Carreau : +10/20/30/40 Résistances Critiques ; et +4/6/8/10 soins de base à Tout ou Rien), compteurs Table I–IV, puis le bonus de la Main Gagnante (3 tours, voir tableau), puis vide la Main (les bonus de main disparaissent). Jass/Baraka/Blakjak/Belote ne jouent que les cartes de LEUR couleur (si le lanceur en avait au moins une avant le lancer). Tout ou Rien et Rekop défaussent la Main (sans jouer) ; Tout ou Rien et Roue de la Fortune / Seconde Chance / Arcane XXI récupèrent ensuite les cartes de la Table dans la Main.

*Implémentation :* Table = liste des cartes jouées + buffs 3 tours (dispellable par défaut). Les effets de table sont des buffs du lanceur (cible C).

### 4. Aléatoire et ses contrôles

Effets aléatoires : groupes `random` (un groupe tiré avec probabilité proportionnelle aux poids). Pile ou Face sur soi pose Pile (+1 PA) ou Face (+1 PM) pour 2 tours (relancer donne l'autre état) ; ces états suppriment l'aléatoire de Lapement/Mésaventure (Pile → retrait PM, Face → retrait PA), Destin d'Ecaflip (Pile → attire, Face → repousse) et Esprit Félin (Pile → téléporte la cible, Face → le lanceur). Contrôles : effet 781 « Minimise les effets aléatoires » (Roue de la Fortune) et 782 « Maximise » (Arcane XV Le Diable, XIX Le Soleil) — les jets prennent la valeur min/max.

*Implémentation :* Implémenter `rollDice(min,max, target)` qui consulte les états Minimise/Maximise du lanceur (781/782 posés sur la cible = l'entité dont les jets sont modifiés). Les CC des sorts Ecaflip sont souvent des valeurs FIXES (ex. Réflexes CC 20, Lapement CC 43).

### 5. Tarot d'Ecaflip (22 arcanes) et Roulette

Tarot (1 PA, 1/tour) : tire 1 arcane sur 22 (4,55 % chacun) qui s'applique à TOUTES les entités pendant 1 tour (+ effets propres au lanceur : −1 PA sur une famille de sorts, interactions Poker). Roulette (1 PA remboursé, 1/tour) : tire 1 effet sur 22 appliqué à TOUT le monde pendant 1 tour (+2 PA, +2 PM, +5 PO, +400 dans une caractéristique, +50 % Critique, +50 Dommages, etc.).

*Implémentation :* Les effets touchent aussi les ennemis (masque a,A zone a1) : l'IA doit lancer Roulette/Tarot quand la plupart des alliés jouent avant les ennemis (durée décomptée au début du tour du lanceur).

### 6. Tromperie : coût, élément et puissance aléatoires

Tromperie tire en permanence un coût (2 à 5 PA, via modificateur +0/+1/+2/+3 PA et +0/5/10/15 % Critique) et un élément (25 % chacun) ; vol de vie ennemi / soin allié 19–20 (2 PA), 28–30 (3 PA), 37–40 (4 PA), 46–50 (5 PA) ; retiré et retiré à nouveau à chaque lancer et à chaque coup critique du lanceur. Elle pioche la carte correspondant à son coût/élément et joue la Main avant si elle est pleine.

*Implémentation :* États #579–#582 (élément), #5534–#5537 (coût), #5538–#5553 (combinaison). Re-tirage : Tromperie #23701 relancé après chaque lancer (et sur coup critique selon la description — déclencheur non visible dans les données, INCERTAIN).

### 7. Rampes et états réactifs

Fanfaronnade (+6 dégâts de base par poussée/attirance/échange/téléportation effectuée par le lanceur, cumul 4, retirés après le lancer — passif #30079), Réflexes (+1 PM par lancer), Yams (+3–18 % Critique 3 tours), Kraps (+28–30 Dommages Critiques 3 tours), Infortune (dommages en fin de tour si la cible n'a pas fait de coup critique), Destin d'Ecaflip (dommages si la cible fait un coup critique), Toupet (dommages si la cible déplace une entité), Péril (dommages si la cible est soignée), Bonne Étoile (bouclier à chaque coup critique de la cible).

*Implémentation :* Déclencheurs : CC (coup critique), PO|CPD (déplace une entité / dommages de poussée), H (soigné), TE (fin de tour) ; listener 1 tour.

### Cartes : pioche, bonus en main et effet sur la Table

| Valeur (coût) | Pique (Air) | Trèfle (Eau) | Cœur (Feu) | Carreau (Terre) | Bonus tant qu'en main | Effet de Table (3 tours) |
|---|---|---|---|---|---|---|
| Valet (2 PA) | Réflexes | Yams | Topkaj | Pile ou Face | sort de la couleur +2, Tout ou Rien +4, Bluff couleur +4 | Pique +10 Dommages Poussée / Trèfle +4 % Critique / Cœur +10 Soins / Carreau +10 Rés. Critiques ; Tout ou Rien +4 soins de base |
| Dame (3 PA) | Jass, Griffe de Ceangal | Baraka, Kraps | Blakjak, Pelotage | Belote, Esprit Félin | +3, +6, +6 | +20 / +6 % / +20 / +20 ; +6 soins de base |
| Roi (4 PA) | Fanfaronnade, Coussinets | Griffe Joueuse, Félintion | Langue Râpeuse, Feulement | Lapement, Mésaventure | +4, +8, +8 | +30 / +8 % / +30 / +30 ; +8 soins de base |
| As (5 PA) | Toupet | Infortune | Péril | Destin d'Ecaflip | +5, +10, +10 | +40 / +10 % / +40 / +40 ; +10 soins de base |

« Sort de la couleur » : Jass (Pique), Baraka (Trèfle), Blakjak (Cœur), Belote (Carreau). Pioche Aléatoire (Bonne Pioche,
Redistribution, Neuf Vies, Bonne Étoile, Bluff, arcanes) : 16 cartes équiprobables ; si la carte tirée est déjà en main,
+1 PA (remboursement) à la place.

### Mains Gagnantes (bonus 3 tours au moment où la main est jouée ; dégâts de Rekop)

| Combinaison | Condition | Bonus à la Table | Rekop (normal / CC) |
|---|---|---|---|
| Carré d'As | 4 As | +200 Force/Intel/Chance/Agi | 4 × 20 (Air, Eau, Feu, Terre) / 4 × 23 |
| Carré de Rois | 4 Rois | +160 aux 4 caractéristiques | 4 × 16 / 4 × 20 |
| Carré de Dames | 4 Dames | +120 | 4 × 12 / 4 × 16 |
| Carré de Valets | 4 Valets | +80 | 4 × 8 / 4 × 12 |
| Suite Royale Couleurs | V, D, R, A de 4 couleurs différentes | +140 aux 4 caractéristiques | 4 × 14 / 4 × 16 |
| Suite Royale de Pique / Trèfle / Cœur / Carreau | V, D, R, A d'une même couleur | +140 Agi / Chance / Intel / Force ; dès la pioche : sort de la couleur +6 et Bluff de la couleur +28 | 4 × 14 dans l'élément de la couleur / 4 × 16 |
| Suite Royale | V, D, R, A (couleurs mélangées) | +140 Puissance | 54 meilleur élément / 56 |
| Carré Couleurs | une carte de chaque couleur | +80 aux 4 caractéristiques | 4 × 8 / 4 × 10 |
| Paires de Rois et d'As | 2 Rois + 2 As | +180 Puissance | 2 × 36 meilleur élément / 2 × 37 |
| Paires de Dames et d'As | 2 Dames + 2 As | +160 Puissance | 2 × 24 / 2 × 25 |
| Paires de Dames et de Rois | | +140 Puissance | 2 × 21 / 2 × 22 |
| Paires de Valets et d'As | | +140 Puissance | 2 × 21 / 2 × 22 |
| Paires de Valets et de Rois | | +120 Puissance | 2 × 18 / 2 × 19 |
| Paires de Valets et de Dames | | +100 Puissance | 2 × 15 / 2 × 11 (sic) |
| Brelan d'As / Rois / Dames / Valets | 3 cartes de même valeur + une autre figure | +170 / +140 / +110 / +80 Puissance | 3 × 18 / 3 × 14 / 3 × 10 / 3 × 8 (CC 20/16/12/10) |

### Arcanes du Tarot (1 tour, toutes les entités sauf mention « lanceur »)

| Arcane | Effet global | Effet pour l'Ecaflip (lanceur) |
|---|---|---|
| 0. Le Fou | fin de tour : téléportation aléatoire d'1 case (INCERTAIN) | joue la Main et pioche 4 cartes |
| I. Le Magicien | +3 % Dommages aux sorts | −1 PA aux sorts Eau (Yams, Baraka, Félintion, Griffe Joueuse, Infortune, Kraps, Tromperie Eau) |
| II. La Cartomancienne | +20 % Soins finaux | −1 PA aux sorts Feu (Topkaj, Blakjak, Pelotage, Langue Râpeuse, Péril, Feulement, Tromperie Feu) |
| III. L'Impératrice | +2 PM sur un kill (max 3) | −1 PA aux sorts à 3 PA (Dames) |
| IV. L'Empereur | +2 PA sur un kill (max 2) | −1 PA aux sorts à 4 PA (Rois) |
| V. Le Hiérophante | +50 Retrait PA, +50 Retrait PM | −1 PA aux sorts Terre |
| VI. Les Amoureux | fin de tour : soin 10 % PV max si un allié est au contact (INCERTAIN) | pioche 1 carte ; jouer des Paires pioche 1 carte |
| VII. Le Chariot | +100 Dommages Poussée | −1 PA aux sorts Air |
| VIII. La Justice | entités ≥ 50 % PV : dommages subis ×115 % ; < 50 % : soin 15 % PV max | jouer un Brelan pioche 3 cartes |
| IX. L'Ermite | fin de tour : soin 15 % PV max si personne en ligne de vue (INCERTAIN) | pioche 4 ; jouer un Carré pioche 4 |
| X. La Roue de Fortune | +5 % Critique à chaque coup critique | pioche 4 ; relances Odorat et Roue de la Fortune à 0 ; jouer une Suite pioche 4 |
| XI. Le Croupier | +1 PM par bouclier donné (max 3) | −1 PA aux sorts à 2 PA (Valets) |
| XII. Le Pendu | −2 PM non esquivables | jouer sans Main Gagnante : +70/80/90/100 Puissance par Valet/Dame/Roi/As de la Table |
| XIII. La Mort | +20 % Érosion | vide la Table ; jouer sans Main Gagnante : +5/6/7/8 % Dommages finaux par carte |
| XIV. Le Temple | +1 PM par soin prodigué (max 3) | −1 PA aux sorts à 5 PA (As) |
| XV. Le Diable | jets aléatoires maximisés | +50 Puissance par carte piochée (INCERTAIN) |
| XVI. La Tour | Inébranlable | relances Château de Cartes, Neuf Vies, Redistribution à 0 ; +1 lancer Bonne Pioche / Redistribution |
| XVII. L'Étoile | Intaclable | relance Seconde Chance à 0 ; +1 lancer Bond du Félin, Entrechat, Bonne Étoile |
| XVIII. La Lune | −6 PO | relances Griffe/Caresse Invocatrice à 0 ; −1 PA Perception/Prédation |
| XIX. Le Soleil | +6 PO ; jets maximisés après avoir utilisé un PM (INCERTAIN) | −1 PA Perception/Prédation |
| XX. Le Jugement | durée des effets −4 (désenvoûtement massif) | jouer une Main Gagnante : bonus additionnel 1 tour (+40 à +100) |
| XXI. Le Monde | fin de tour : retour à la position de début de tour | joue la Main et récupère les cartes de la Table |

### Roulette (1 effet tiré parmi 22, toutes les entités, 1 tour)

Durée des effets −1 ; +2 PA ; +2 PM ; +5 PO ; +20 % Érosion ; +50 Tacle ; +50 Fuite ; +50 Retrait PA ; +50 Retrait PM ;
+50 Esquive PA ; +50 Esquive PM ; +50 % Critique ; +50 Dommages ; +75 Dommages Critiques ; +100 Dommages Poussée ;
+100 Rés. Critiques ; +100 Rés. Poussée ; +100 Soins ; +400 Force ; +400 Intelligence ; +400 Chance ; +400 Agilité.

## Détail de tous les sorts (grade utilisable au niveau 200)

Légende des cibles : « alliés compris » = le sort affecte aussi un allié ciblé/dans la zone (masque `a`) ; « hors lanceur » = masque `g`. Les lignes « Infobulle décodée » sont générées automatiquement à partir des effets VISIBLES de l'infobulle (CC entre parenthèses) : elles incluent des effets d'affichage (`forClientOnly`) dont les cibles/zones peuvent être plus larges que les effets réellement exécutés. Pour le moteur, la référence est la liste « Effets » ci-dessus et le champ `effects` du JSON (effets réellement exécutés, sous-sorts compris dans le dump).

### Paire 1 : Réflexes / Lapement

*Réflexes (+1 PM par lancer, Valet de Pique) ou Lapement (croix 1 Terre, −3 PA/PM, Roi de Carreau).*

#### 1A. Réflexes (id 12857, niveau de déblocage 1)

- **Caractéristiques** : **2 PA** · PO 0–6 (modifiable), LdV · case occupée · 3/tour · 2/cible · CC 5 %
- **Description officielle** : Occasionne des dommages Air et augmente les PM du lanceur. Les dommages n'affectent pas le lanceur.  Pioche un Valet de Pique.
- **Effets** :
  - 14 à 17 dommages Air (CC 20) à la cible (hors lanceur, alliés compris : masque g,A).
  - +1 PM au lanceur (1 tour) à chaque lancer (3/tour → +3 PM).
  - Pioche : Valet de Pique.
- **Rôle tactique** : 2 PA, 0–6 PO modifiable, case occupée : filler Air qui donne de la mobilité.
- **Tags** : `damage`, `air`, `mp_gain`, `draw`
- **Grades** : g1 (niv. 1) : 2 PA, PO 0–4, 3/tour, 8–10 Air ; g2 (niv. 66) : 2 PA, PO 0–5, 3/tour, 11–13 Air ; g3 (niv. 132) : 2 PA, PO 0–6, 3/tour, 14–17 Air
- *Infobulle décodée (auto)* :
  - 14 à 17 dommages Air (CC : 20 dommages Air) — cibles : alliés (hors lanceur), ennemis
  - 1 PM — cibles : lanceur ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - État « Valet de Pique » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

#### 1B. Lapement (id 12873, niveau de déblocage 95)

- **Caractéristiques** : **4 PA** · PO 0–5 (modifiable), LdV · 2/tour · cumul 1 · CC 15 %
- **Description officielle** : Occasionne des dommages Terre et retire aléatoirement des PM ou des PA en zone. N'affecte pas le lanceur.  • Pile : l'aléatoire est supprimé pour retirer des PM. • Face : l'aléatoire est supprimé pour retirer des PA.  Pioche un Roi de Carreau.
- **Effets** :
  - Zone : croix de 1 (0–5 PO modifiable). 32 à 36 dommages Terre (CC 43) aux entités de la croix hors lanceur (alliés compris).
  - Aléatoire 50/50 : −3 PM ou −3 PA esquivables (1 tour) aux mêmes cibles ; Pile → toujours −3 PM, Face → toujours −3 PA.
  - Pioche : Roi de Carreau.
- **Rôle tactique** : 4 PA, 2/tour : entrave de zone ; fixer le résultat avec Pile ou Face.
- **Tags** : `damage`, `earth`, `aoe_small`, `ap_removal`, `mp_removal`, `draw`
- **Grades** : g1 (niv. 95) : 4 PA, PO 0–4, 2/tour, 26–29 Terre ; g2 (niv. 162) : 4 PA, PO 0–5, 2/tour, 32–36 Terre
- *Infobulle décodée (auto)* :
  - 32 à 36 dommages Terre (CC : 43 dommages Terre) — cibles : alliés (hors lanceur), ennemis ; zone : croix de 1
  - -3 PM — cibles : alliés (hors lanceur), ennemis [si le lanceur a l'état « Pile »] ; zone : croix de 1 ; 1 tour(s) ; ALÉATOIRE 50 % (groupe 0) ; désenvoûtable seulement par effet fort
  - -3 PA — cibles : alliés (hors lanceur), ennemis [si le lanceur a l'état « Face »] ; zone : croix de 1 ; 1 tour(s) ; ALÉATOIRE 50 % (groupe 0) ; désenvoûtable seulement par effet fort
  - État « Roi de Carreau » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 2 : Yams / Langue Râpeuse

*Yams (+3–18 % critique, aléatoire) ou Langue Râpeuse (croix 1 soin + dommages Feu) — LE sort Feu.*

#### 2A. Yams (id 29680, niveau de déblocage 1)

- **Caractéristiques** : **2 PA** · PO 0–6 (modifiable), LdV · case occupée · 3/tour · 2/cible · cumul 1 · CC 5 %
- **Description officielle** : Occasionne des dommages Eau et augmente les chances de Critique du lanceur. Les dommages n'affectent pas le lanceur.  Pioche un Valet de Trèfle.
- **Effets** :
  - 3 à 18 dommages Eau (CC 21) à la cible (hors lanceur).
  - +3 à 18 % Critique au lanceur pendant 3 tours (CC 21 %), non cumulable.
  - Pioche : Valet de Trèfle.
- **Rôle tactique** : 2 PA : à lancer en début de combat pour monter le taux critique (synergie Kraps, Roue de la Fortune).
- **Tags** : `damage`, `water`, `crit_buff`, `random`, `draw`
- **Grades** : g1 (niv. 1) : 2 PA, PO 0–4, 3/tour, 1–6 Eau ; g2 (niv. 67) : 2 PA, PO 0–5, 3/tour, 2–12 Eau ; g3 (niv. 133) : 2 PA, PO 0–6, 3/tour, 3–18 Eau
- *Infobulle décodée (auto)* :
  - 3 à 18 dommages Eau (CC : 21 dommages Eau) — cibles : alliés (hors lanceur), ennemis
  - 3 à 18% Critique (CC : 21% Critique) — cibles : lanceur ; 3 tour(s)
  - État « Valet de Trèfle » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

#### 2B. Langue Râpeuse (id 12855, niveau de déblocage 100)

- **Caractéristiques** : **4 PA** · PO 0–6 (modifiable), LdV · 2/tour · CC 15 %
- **Description officielle** : Soigne les alliés et occasionne des dommages Feu aux ennemis en zone. N'affecte pas le lanceur.  Pioche un Roi de Cœur.
- **Effets** :
  - Zone : croix de 1 (0–6 PO modifiable).
  - 30 à 33 soins Feu (CC 40) aux alliés hors lanceur et 30 à 33 dommages Feu (CC 40) aux ennemis de la croix.
  - Pioche : Roi de Cœur.
- **Rôle tactique** : 4 PA, 2/tour : LE sort de l'Ecaflip Feu (soigne les alliés au contact de l'ennemi visé).
- **Tags** : `heal`, `damage`, `fire`, `aoe_small`, `draw`
- **Grades** : g1 (niv. 100) : 4 PA, PO 0–5, 2/tour, 24–27 Feu (soin) / 24–27 Feu ; g2 (niv. 167) : 4 PA, PO 0–6, 2/tour, 30–33 Feu (soin) / 30–33 Feu
- *Infobulle décodée (auto)* :
  - 30 à 33 soins Feu (CC : 40 soins Feu) — cibles : alliés (hors lanceur) ; zone : croix de 1
  - 30 à 33 dommages Feu (CC : 40 dommages Feu) — cibles : ennemis ; zone : croix de 1
  - État « Roi de Cœur » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 3 : Topkaj / Griffe Joueuse

*Topkaj (16/19/22 soin ou dommages Feu, 2 PA) ou Griffe Joueuse (ligne Eau, −31–35 rés. critiques).*

#### 3A. Topkaj (id 12846, niveau de déblocage 1)

- **Caractéristiques** : **2 PA** · PO 0–6 (modifiable), LdV · 3/tour · 2/cible · CC 5 %
- **Description officielle** : Occasionne des dommages Feu aux ennemis ou soigne les alliés.  Pioche un Valet de Cœur.
- **Effets** :
  - Aléatoire équiprobable (3 groupes) : 16, 19 ou 22 dommages Feu à l'ennemi (CC 19/22/25) — ou autant de soins Feu à l'allié (lanceur compris).
  - Pioche : Valet de Cœur.
- **Rôle tactique** : 2 PA, 3/tour, 2/cible : soin ou frappe à valeur fixe aléatoire.
- **Tags** : `heal`, `damage`, `fire`, `random`, `draw`, `cheap`
- **Grades** : g1 (niv. 1) : 2 PA, PO 0–4, 3/tour, 7 Feu / 7 Feu (soin) / 10 Feu / 10 Feu (soin) / 13 Feu (soin) / 13 Feu ; g2 (niv. 68) : 2 PA, PO 0–5, 3/tour, 13 Feu / 13 Feu (soin) / 16 Feu / 16 Feu (soin) / 19 Feu / 19 Feu (soin) ; g3 (niv. 134) : 2 PA, PO 0–6, 3/tour, 16 Feu / 16 Feu (soin) / 19 Feu / 19 Feu (soin) / 22 Feu / 22 Feu (soin)
- *Infobulle décodée (auto)* :
  - 16 dommages Feu (CC : 19 dommages Feu) — cibles : ennemis ; ALÉATOIRE 16.67 % (groupe 1)
  - 16 soins Feu (CC : 19 soins Feu) — cibles : alliés (lanceur compris) ; ALÉATOIRE 16.67 % (groupe 1)
  - 19 dommages Feu (CC : 22 dommages Feu) — cibles : ennemis ; ALÉATOIRE 16.67 % (groupe 2)
  - 19 soins Feu (CC : 22 soins Feu) — cibles : alliés (lanceur compris) ; ALÉATOIRE 16.67 % (groupe 2)
  - 22 dommages Feu (CC : 25 dommages Feu) — cibles : ennemis ; ALÉATOIRE 16.67 % (groupe 3)
  - 22 soins Feu (CC : 25 soins Feu) — cibles : alliés (lanceur compris) ; ALÉATOIRE 16.67 % (groupe 3)
  - État « Valet de Cœur » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

#### 3B. Griffe Joueuse (id 12849, niveau de déblocage 105)

- **Caractéristiques** : **4 PA** · PO 1–6 (fixe), en ligne, sans LdV · 2/tour · cumul 1 · CC 15 %
- **Description officielle** : Occasionne des dommages Eau et réduit les Résistances Critiques en zone.  Pioche un Roi de Trèfle.
- **Effets** :
  - Zone : toutes les cases de la ligne du lanceur jusqu'à la cible (1–6 PO en ligne, sans LdV), alliés compris.
  - 31 à 35 dommages Eau (CC 42) et −31 à −35 Résistances Critiques (CC −42, 3 tours).
  - Pioche : Roi de Trèfle.
- **Rôle tactique** : Transperce une file ; prépare les critiques de l'équipe.
- **Tags** : `damage`, `water`, `aoe_line`, `debuff`, `draw`
- **Grades** : g1 (niv. 105) : 4 PA, PO 1–5, 2/tour, 25–28 Eau ; g2 (niv. 172) : 4 PA, PO 1–6, 2/tour, 31–35 Eau
- *Infobulle décodée (auto)* :
  - 31 à 35 dommages Eau (CC : 42 dommages Eau) — cibles : alliés (lanceur compris), ennemis ; zone : ligne depuis le lanceur jusqu'à la case ciblée (incluse), non dégressive
  - -31 à -35 Résistances Critiques (CC : -42 Résistances Critiques) — cibles : alliés (lanceur compris), ennemis ; zone : ligne depuis le lanceur jusqu'à la case ciblée (incluse), non dégressive ; 3 tour(s)
  - État « Roi de Trèfle » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 4 : Pile ou Face / Fanfaronnade

*Pile ou Face (contrôle de l'aléatoire, +1 PA/PM) ou Fanfaronnade (croix Air, rampe par déplacement).*

#### 4A. Pile ou Face (id 12841, niveau de déblocage 1)

- **Caractéristiques** : **2 PA** · PO 0–6 (modifiable), LdV · 3/tour · 2/cible · cumul 1 · CC 5 %
- **Description officielle** : Occasionne des dommages Terre.  Sur le lanceur : applique aléatoirement l'état Pile ou l'état Face et lui rend 1 PA. • Pile : donne 1 PA. • Face : donne 1 PM. • Relancer le sort dans un état permet de s'appliquer l'autre.  Pioche un Valet de Carreau.
- **Effets** :
  - Sur un ennemi/allié (hors lanceur) : 18 dommages Terre fixes (CC 22).
  - Sur soi : état aléatoire Pile (+1 PA, 2 tours) ou Face (+1 PM) ; relancer dans un état donne l'autre ; rembourse 1 PA (coût net 1 PA).
  - Pile/Face suppriment l'aléatoire de Lapement, Mésaventure, Destin d'Ecaflip, Esprit Félin.
  - Pioche : Valet de Carreau.
- **Rôle tactique** : Sur soi en début de tour : PA/PM gratuits et contrôle de l'aléatoire.
- **Tags** : `damage`, `earth`, `ap_gain`, `mp_gain`, `random_control`, `draw`
- **Grades** : g1 (niv. 1) : 2 PA, PO 0–4, 3/tour, 10 Terre ; g2 (niv. 69) : 2 PA, PO 0–5, 3/tour, 14 Terre ; g3 (niv. 136) : 2 PA, PO 0–6, 3/tour, 18 Terre
- *Infobulle décodée (auto)* :
  - 18 dommages Terre (CC : 22 dommages Terre) — cibles : alliés (hors lanceur), ennemis
  - État « Pile » — cibles : lanceur (s'il est dans la zone) ; 2 tour(s) ; ALÉATOIRE 50 % (groupe 0) ; désenvoûtable seulement par effet fort
  - 1 PA — cibles : lanceur (s'il est dans la zone) ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - État « Face » — cibles : lanceur (s'il est dans la zone) ; 2 tour(s) ; ALÉATOIRE 50 % (groupe 0) ; désenvoûtable seulement par effet fort
  - 1 PM — cibles : lanceur (s'il est dans la zone) ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - Rembourse 1 PA — cibles : lanceur (s'il est dans la zone)
  - État « Valet de Carreau » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

#### 4B. Fanfaronnade (id 12878, niveau de déblocage 110)

- **Caractéristiques** : **4 PA** · PO 0–6 (modifiable), LdV · 1/tour · cumul 4 · CC 20 %
- **Description officielle** : Occasionne des dommages Air en zone. N'affecte pas le lanceur.  Les dommages du sort sont augmentés pour chaque attirance, poussée, échange de position ou téléportation effectué par le lanceur. Les effets sont retirés après utilisation du sort.
- **Effets** :
  - Zone : croix de 1 (0–6 PO modifiable). 28 à 32 dommages Air (CC 38) aux entités hors lanceur.
  - +6 dégâts de base par attirance, poussée, échange ou téléportation effectués par le lanceur (cumul 4 → +24), retirés après le lancer.
  - Pioche : Roi de Pique.
- **Rôle tactique** : 4 PA, 1/tour : finir le tour après Coussinets/Griffe de Ceangal/Entrechat (52–56 de base).
- **Tags** : `damage`, `air`, `aoe_small`, `ramp`, `draw`
- **Grades** : g1 (niv. 110) : 4 PA, PO 0–5, 1/tour, 24–27 Air ; g2 (niv. 177) : 4 PA, PO 0–6, 1/tour, 28–32 Air
- *Infobulle décodée (auto)* :
  - 28 à 32 dommages Air (CC : 38 dommages Air) — cibles : alliés (hors lanceur), ennemis ; zone : croix de 1
  - Fanfaronnade : +6 dégâts de base — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort
  - État « Roi de Pique » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 5 : Bonne Pioche / Redistribution

*Bonne Pioche (pioche 1, gratuit, 3/tour) ou Redistribution (joue + pioche 4, gratuit).*

#### 5A. Bonne Pioche (id 12843, niveau de déblocage 5)

- **Caractéristiques** : **1 PA** · PO 0–0 (fixe), sans LdV · 3/tour · CC 1 %
- **Description officielle** : Pioche une Carte aléatoire du Poker d'Ecaflip. Joue la Main avant de Piocher si elle est pleine.  Le coût en PA du sort est remboursé.
- **Effets** :
  - Si la Main est pleine : la joue d'abord.
  - Pioche 1 carte aléatoire (16 équiprobables) ; si elle est déjà en main : +1 PA.
  - Coût remboursé (1 PA net 0). 3/tour.
- **Rôle tactique** : Gratuit : compléter la main vers une combinaison.
- **Tags** : `draw`, `free`
- **Grades** : g1 (niv. 5) : 1 PA, PO 0–0, 1/tour ; g2 (niv. 72) : 1 PA, PO 0–0, 2/tour ; g3 (niv. 139) : 1 PA, PO 0–0, 3/tour
- *Infobulle décodée (auto)* :
  - lance « Joue la Main » (#29945, rang 1) — cibles : lanceur
  - lance « Pioche une Carte » (#29946, rang 1) — cibles : lanceur
  - Rembourse 1 PA — cibles : lanceur ; désenvoûtable seulement par effet fort

#### 5B. Redistribution (id 12877, niveau de déblocage 115)

- **Caractéristiques** : **1 PA** · PO 0–0 (fixe), sans LdV · 1/tour · CC 4 %
- **Description officielle** : Joue la Main et Pioche 4 Cartes aléatoires du Poker d'Ecaflip.  Le coût en PA du sort est remboursé.
- **Effets** :
  - Joue la Main (si elle existe) puis pioche 4 cartes aléatoires. Coût remboursé. 1/tour.
- **Rôle tactique** : Réinitialisation complète de la main + bonus de Table immédiat.
- **Tags** : `draw`, `play_hand`, `free`
- **Grades** : g1 (niv. 115) : 1 PA, PO 0–0, relance 2 ; g2 (niv. 182) : 1 PA, PO 0–0, 1/tour
- *Infobulle décodée (auto)* :
  - lance « Joue la Main » (#29945, rang 1) — cibles : lanceur
  - lance « Pioche 4 Cartes » (#29947, rang 1) — cibles : lanceur
  - Rembourse 1 PA — cibles : lanceur ; désenvoûtable seulement par effet fort

### Paire 6 : Bond du Félin / Entrechat

*Bond du Félin (+1 PM allié / téléportation 1 case, 1 PA) ou Entrechat (téléport/échange 2 PO + Fuite).*

#### 6A. Bond du Félin (id 12844, niveau de déblocage 10)

- **Caractéristiques** : **1 PA** · PO 0–1 (fixe), sans LdV · 3/tour · cumul 3 · CC 0 %
- **Description officielle** : Augmente les PM de l'allié ciblé ou téléporte le lanceur sur la case ciblée.
- **Effets** :
  - Allié adjacent (ou soi, PO 0) : +1 PM (1 tour) ; l'effet « téléporte sur la case ciblée » s'applique aussi : sur un allié adjacent il en résulte un échange de positions (case occupée), sur une case libre adjacente le lanceur s'y téléporte (pas en Pesanteur). 1 PA, 0–1 PO, 3/tour, cumul 3.
- **Rôle tactique** : 1 PA = 1 PM : sortir d'un tacle (téléportation) ou donner des PM à un mêlée.
- **Tags** : `mobility`, `mp_gain`, `cheap`
- **Grades** : g1 (niv. 10) : 1 PA, PO 0–1, 1/tour ; g2 (niv. 77) : 1 PA, PO 0–1, 2/tour ; g3 (niv. 144) : 1 PA, PO 0–1, 3/tour
- *Infobulle décodée (auto)* :
  - 1 PM — cibles : alliés (lanceur compris) ; 1 tour(s)
  - Téléporte sur la case ciblée — cibles : alliés (lanceur compris) [si le lanceur n'a pas l'état « Pesanteur »]

#### 6B. Entrechat (id 12865, niveau de déblocage 120)

- **Caractéristiques** : **2 PA** · PO 0–2 (fixe), sans LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Téléporte le lanceur sur la case ciblée ou échange de position avec la cible. Augmente la Fuite du lanceur et de ses alliés en zone.
- **Effets** :
  - Case libre (0–2 PO) : téléportation du lanceur (pas en Pesanteur) ; entité : échange de positions.
  - +40 Fuite (1 tour) au lanceur et aux alliés dans une croix de 1 autour de l'impact.
- **Rôle tactique** : 2 PA, 1/tour : échange de sauvetage ou désengagement.
- **Tags** : `mobility`, `swap`
- **Grades** : g1 (niv. 120) : 2 PA, PO 0–2, 1/tour ; g2 (niv. 187) : 2 PA, PO 0–2, 1/tour
- *Infobulle décodée (auto)* :
  - Téléporte sur la case ciblée — cibles : alliés (lanceur compris), ennemis [si le lanceur n'a pas l'état « Pesanteur »]
  - Échange de positions — cibles : alliés (hors lanceur), ennemis
  - 40 Fuite — cibles : lanceur, alliés (lanceur compris) ; zone : croix de 1 ; 1 tour(s)

### Paire 7 : Jass / Infortune

*Jass (Air, rés. poussée) ou Infortune (5 PA, vol Eau + dommages si pas de critique).*

#### 7A. Jass (id 12864, niveau de déblocage 15)

- **Caractéristiques** : **3 PA** · PO 0–6 (modifiable), LdV · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Occasionne des dommages Air et Pioche une Dame de Pique. N'affecte pas le lanceur.  Réduit également les Résistances Poussée selon les Cartes de Pique dans la Main (cumulable une fois par Carte). Les dommages du sort sont augmentés selon les Cartes de Pique dans la Main.  Joue les Cartes de Pique si le lanceur en possède initialement au moins une dans la Main.
- **Effets** :
  - 26 à 29 dommages Air (CC 35) à la cible hors lanceur ; dégâts augmentés par les cartes Pique en main (+2/+3/+4/+5).
  - −10/−20/−30/−40 Résistances Poussée (2 tours) pour chaque Valet/Dame/Roi/As de Pique en main (cumulable une fois par carte).
  - Pioche : Dame de Pique ; si le lanceur avait au moins un Pique : joue les cartes Pique (effets de Table).
- **Rôle tactique** : 3 PA, 3/tour : prépare les dommages de poussée (Coussinets, Toupet).
- **Tags** : `damage`, `air`, `debuff`, `draw`, `play_suit`
- **Grades** : g1 (niv. 15) : 3 PA, PO 0–4, 3/tour, 16–18 Air ; g2 (niv. 82) : 3 PA, PO 0–5, 3/tour, 21–23 Air ; g3 (niv. 149) : 3 PA, PO 0–6, 3/tour, 26–29 Air
- *Infobulle décodée (auto)* :
  - 26 à 29 dommages Air (CC : 35 dommages Air) — cibles : alliés (hors lanceur), ennemis
  - -10 à -40 Résistances Poussée — cibles : alliés (hors lanceur), ennemis ; 2 tour(s)
  - État « Dame de Pique » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort
  - lance « Joue les Cartes de Pique » (#29949, rang 1) — cibles : lanceur

#### 7B. Infortune (id 12880, niveau de déblocage 125)

- **Caractéristiques** : **5 PA** · PO 1–7 (fixe), LdV · 1/tour · cumul 1 · CC 20 %
- **Description officielle** : Vole de la vie dans l'élément Eau et applique l'état Infortune sur l'ennemi ciblé : • Occasionne des dommages Eau à la fin du tour de la cible si elle n'a pas effectué de coup critique durant son tour.  Pioche un As de Trèfle.
- **Effets** :
  - Vole 41 à 45 PV en Eau (CC 54) à la cible (alliés compris).
  - État « Infortune » (1 tour) : à la fin de son tour, 31 à 33 dommages Eau (CC 38) si elle n'a pas fait de coup critique.
  - Pioche : As de Trèfle.
- **Rôle tactique** : 5 PA, 1/tour : gros coup Eau, presque garanti contre les monstres à faible critique.
- **Tags** : `damage`, `water`, `life_steal`, `delayed`, `draw`
- **Grades** : g1 (niv. 125) : 5 PA, PO 1–6, 1/tour, 36–39 Eau (vol) / 27–29 Eau ; g2 (niv. 192) : 5 PA, PO 1–7, 1/tour, 41–45 Eau (vol) / 31–33 Eau
- *Infobulle décodée (auto)* :
  - 41 à 45 vol Eau (CC : 54 vol Eau) — cibles : alliés (lanceur compris), ennemis
  - État « Infortune » — cibles : ennemis ; 1 tour(s)
  - 31 à 33 dommages Eau (CC : 38 dommages Eau) — cibles : ennemis
  - État « As de Trèfle » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 8 : Perception / Prédation

*Perception (soin 5 %/ennemi + révèle) ou Prédation (+15 % Érosion de zone).*

#### 8A. Perception (id 12852, niveau de déblocage 20)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), sans LdV · case occupée · 1/tour · CC 0 %
- **Description officielle** : Soigne l'allié ciblé pour chaque ennemi dans la zone d'effet et dévoile les invisibles en zone.
- **Effets** :
  - Soigne l'allié ciblé (0–6 PO, sans LdV) de 5 % de ses PV max pour chaque ennemi dans un cercle de 3 autour de lui.
  - Dévoile les invisibles dans le cercle de 3.
- **Rôle tactique** : 2 PA : soin d'un tank encerclé (4 ennemis = 20 %).
- **Tags** : `heal`, `percent_heal`, `reveal`
- **Grades** : g1 (niv. 20) : 2 PA, PO 0–4, 1/tour ; g2 (niv. 87) : 2 PA, PO 0–5, 1/tour ; g3 (niv. 154) : 2 PA, PO 0–6, 1/tour
- *Infobulle décodée (auto)* :
  - Soin : 5% des PV max — cibles : ennemis [AUCUNE (masque F50000 = affichage seul)]
  - Dévoile les entités invisibles — cibles : ennemis ; zone : cercle de rayon 3

#### 8B. Prédation (id 12867, niveau de déblocage 130)

- **Caractéristiques** : **2 PA** · PO 0–4 (fixe), LdV · 1/tour · cumul 2 · CC 0 %
- **Description officielle** : Érode l'ennemi ciblé et dévoile les invisibles en zone.
- **Effets** :
  - +15 % Érosion (2 tours, cumul 2) aux ennemis dans un cercle de 2 (0–4 PO) et dévoile les invisibles.
- **Rôle tactique** : 2 PA : érosion de zone contre les boss régénérants.
- **Tags** : `erosion`, `debuff`, `reveal`
- **Grades** : g1 (niv. 130) : 2 PA, PO 0–3, 1/tour ; g2 (niv. 197) : 2 PA, PO 0–4, 1/tour
- *Infobulle décodée (auto)* :
  - 15% Érosion — cibles : ennemis ; zone : cercle de rayon 2 ; 2 tour(s)
  - Dévoile les entités invisibles — cibles : ennemis ; zone : cercle de rayon 2

### Paire 9 : Baraka / Toupet

*Baraka (Eau, −% critique) ou Toupet (5 PA, vol Air + poussée + piège réactif).*

#### 9A. Baraka (id 12848, niveau de déblocage 25)

- **Caractéristiques** : **3 PA** · PO 0–6 (modifiable), LdV · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Occasionne des dommages Eau et Pioche une Dame de Trèfle. N'affecte pas le lanceur.  Réduit également des Critiques selon les Cartes de Trèfle dans la Main (cumulable une fois par Carte). Les dommages du sort sont augmentés selon les Cartes de Trèfle dans la Main.  Joue les Cartes de Trèfle si le lanceur en possède initialement au moins une dans la Main.
- **Effets** :
  - 27 à 30 dommages Eau (CC 35) à la cible hors lanceur ; +2/+3/+4/+5 par carte Trèfle en main.
  - −4/−6/−8/−10 % Critique (3 tours) pour chaque Valet/Dame/Roi/As de Trèfle en main.
  - Pioche : Dame de Trèfle ; joue les cartes Trèfle si le lanceur en avait au moins une.
- **Rôle tactique** : Réduit le taux critique du boss (synergie Infortune).
- **Tags** : `damage`, `water`, `debuff`, `draw`, `play_suit`
- **Grades** : g1 (niv. 25) : 3 PA, PO 0–4, 3/tour, 15–17 Eau ; g2 (niv. 92) : 3 PA, PO 0–5, 3/tour, 20–23 Eau ; g3 (niv. 159) : 3 PA, PO 0–6, 3/tour, 27–30 Eau
- *Infobulle décodée (auto)* :
  - 27 à 30 dommages Eau (CC : 35 dommages Eau) — cibles : alliés (hors lanceur), ennemis
  - -4 à -10% Critique — cibles : alliés (hors lanceur), ennemis ; 3 tour(s)
  - État « Dame de Trèfle » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort
  - lance « Joue les Cartes de Trèfle » (#29950, rang 1) — cibles : lanceur

#### 9B. Toupet (id 12882, niveau de déblocage 135)

- **Caractéristiques** : **5 PA** · PO 1–5 (fixe), LdV · 1/tour · cumul 1 · CC 20 %
- **Description officielle** : Rapproche le lanceur vers la cible, vole de la vie dans l'élément Air aux ennemis, repousse la cible et applique l'état Toupet sur l'ennemi ciblé : • Occasionne des dommages Air et retire l'état si la cible attire, repousse, échange de position ou occasionne des dommages de poussée.  Pioche un As de Pique.
- **Effets** :
  - Le lanceur avance de 4 cases vers la cible (1–5 PO), vole 44 à 48 PV en Air (CC 58) et repousse la cible de 4 cases.
  - État « Toupet » (1 tour) : si la cible attire, repousse, échange ou occasionne des dommages de poussée → 26 à 28 dommages Air (CC 33), état retiré.
  - Pioche : As de Pique.
- **Rôle tactique** : 5 PA, 1/tour : gros coup Air + dommages de poussée (Dommages Poussée de la Table Pique).
- **Tags** : `damage`, `air`, `life_steal`, `gap_closer`, `push`, `draw`
- *Infobulle décodée (auto)* :
  - Avance de 4 cases — cibles : alliés (lanceur compris), ennemis
  - 44 à 48 vol Air (CC : 58 vol Air) — cibles : ennemis
  - Repousse de 4 cases — cibles : alliés (lanceur compris), ennemis
  - État « Toupet » — cibles : ennemis ; 1 tour(s)
  - 26 à 28 dommages Air (CC : 33 dommages Air) — cibles : ennemis
  - État « As de Pique » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 10 : Château de Cartes / Bonne Étoile

*Château de Cartes (bouclier selon la main + joue) ou Bonne Étoile (soin 5 % + boucliers sur critiques).*

#### 10A. Château de Cartes (id 12845, niveau de déblocage 30)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · relance 3 · cumul 1 · CC 0 % · condition : le lanceur a « Main » (`HS=5601`)
- **Description officielle** : Applique un bouclier sur la cible pour chaque Carte dans la Main selon leur valeur.  Joue la Main.
- **Effets** :
  - Nécessite une Main. Bouclier sur l'allié ciblé (0–6 PO, 2 tours) : 50 % du niveau par Valet, 100 % par Dame, 150 % par Roi, 200 % par As en main (cumulés : V+D+R+A = 500 % = 1000 pts au niveau 200, 4 As = 800 % = 1600 pts).
  - Puis joue la Main. Relance 3.
- **Rôle tactique** : Bouclier massif sur le tank avant de vider la main.
- **Tags** : `shield`, `play_hand`
- **Grades** : g1 (niv. 30) : 3 PA, PO 0–4, relance 3 ; g2 (niv. 97) : 3 PA, PO 0–5, relance 3 ; g3 (niv. 164) : 3 PA, PO 0–6, relance 3
- *Infobulle décodée (auto)* :
  - Bouclier : 50% du niveau (= 100 pts au niveau 200) — cibles : alliés (lanceur compris) [si le lanceur a l'état « Valet de Pique »] ; 2 tour(s)
  - Bouclier : 100% du niveau (= 200 pts au niveau 200) — cibles : alliés (lanceur compris) [si le lanceur a l'état « Dame de Pique »] ; 2 tour(s)
  - Bouclier : 150% du niveau (= 300 pts au niveau 200) — cibles : alliés (lanceur compris) [si le lanceur a l'état « Roi de Pique »] ; 2 tour(s)
  - Bouclier : 200% du niveau (= 400 pts au niveau 200) — cibles : alliés (lanceur compris) [si le lanceur a l'état « As de Pique »] ; 2 tour(s)
  - lance « Joue la Main » (#29945, rang 1) — cibles : lanceur

#### 10B. Bonne Étoile (id 12876, niveau de déblocage 140)

- **Caractéristiques** : **2 PA** · PO 0–6 (fixe), sans LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Soigne la cible et lui applique l'état Bonne Étoile : • Applique un bouclier sur la cible si elle effectue un coup critique (cumulable 5 fois).  Pioche une Carte aléatoire du Poker d'Ecaflip si la Main est vide.
- **Effets** :
  - Soin de 5 % PV max à la cible et état « Bonne Étoile » (1 tour) : bouclier de 50 % du niveau (100 pts, 1 tour) à chaque coup critique de la cible (cumul 5).
  - Si la Main est vide : pioche une carte aléatoire.
- **Rôle tactique** : Sur un allié à fort taux critique (après Roue de la Fortune : jusqu'à 500 de bouclier).
- **Tags** : `heal`, `shield`, `crit_synergy`, `draw`
- *Infobulle décodée (auto)* :
  - Soin : 5% des PV max — cibles : alliés (lanceur compris), ennemis
  - État « Bonne Étoile » — cibles : alliés (lanceur compris), ennemis ; 1 tour(s)
  - Bouclier : 50% du niveau (= 100 pts au niveau 200) — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; DÉCLENCHÉ quand : Le porteur realise un COUP CRITIQUE (écoute 1 t)
  - lance « Pioche une Carte » (#29946, rang 1) — cibles : lanceur

### Paire 11 : Blakjak / Destin d'Ecaflip

*Blakjak (Feu, ×0,85 soins reçus) ou Destin d'Ecaflip (5 PA, vol Terre, attire/repousse).*

#### 11A. Blakjak (id 12870, niveau de déblocage 35)

- **Caractéristiques** : **3 PA** · PO 0–6 (modifiable), LdV · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Occasionne des dommages Feu et Pioche une Dame de Cœur. N'affecte pas le lanceur.  Réduit également les soins reçus par la cible selon les Cartes de Cœur dans la Main (cumulable une fois par Carte). Les dommages du sort sont augmentés selon les Cartes de Cœur dans la Main.  Joue les Cartes de Cœur si le lanceur en possède initialement au moins une dans la Main.
- **Effets** :
  - 27 à 31 dommages Feu (CC 37) à la cible hors lanceur ; +2/+3/+4/+5 par carte Cœur en main.
  - Soins reçus ×94/×91/×88/×85 % (2 tours) pour chaque Valet/Dame/Roi/As de Cœur en main (cumulable une fois par carte).
  - Pioche : Dame de Cœur ; joue les cartes Cœur si le lanceur en avait au moins une.
- **Rôle tactique** : Anti-soin cumulable (jusqu’à ≈ ×0,64 avec les 4 Cœurs : 0,94 × 0,91 × 0,88 × 0,85).
- **Tags** : `damage`, `fire`, `anti_heal`, `draw`, `play_suit`
- **Grades** : g1 (niv. 35) : 3 PA, PO 0–4, 3/tour, 17–20 Feu ; g2 (niv. 102) : 3 PA, PO 0–5, 3/tour, 22–25 Feu ; g3 (niv. 169) : 3 PA, PO 0–6, 3/tour, 27–31 Feu
- *Infobulle décodée (auto)* :
  - 27 à 31 dommages Feu (CC : 37 dommages Feu) — cibles : alliés (hors lanceur), ennemis
  - Soins reçus x94% — cibles : alliés (hors lanceur), ennemis ; DÉCLENCHÉ quand : Le porteur est SOIGNE (écoute 2 t)
  - Soins reçus x85% — cibles : alliés (hors lanceur), ennemis ; DÉCLENCHÉ quand : Le porteur est SOIGNE (écoute 2 t)
  - État « Dame de Cœur » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort
  - lance « Joue les Cartes de Cœur » (#29951, rang 1) (CC : lance « Poker d'Ecaflip » (#29928, rang 1)) — cibles : lanceur

#### 11B. Destin d'Ecaflip (id 12859, niveau de déblocage 145)

- **Caractéristiques** : **5 PA** · PO 1–6 (fixe), LdV · 1/tour · cumul 1 · CC 20 %
- **Description officielle** : Vole de la vie dans l'élément Terre aux ennemis, attire ou repousse aléatoirement la cible et applique l'état Destin d'Ecaflip sur l'ennemi ciblé : • Occasionne des dommages Terre et retire l'état si la cible effectue un coup critique.  • Pile : l'aléatoire est supprimé pour attirer la cible. • Face : l'aléatoire est supprimé pour repousser la cible.  Pioche un As de Carreau.
- **Effets** :
  - Vole 42 à 46 PV en Terre (CC 55) ; attire (50 %) ou repousse (50 %) la cible de 4 cases (Pile → attire, Face → repousse).
  - État « Destin d'Ecaflip » (1 tour) : si la cible fait un coup critique → 25 à 27 dommages Terre (CC 31), état retiré.
  - Pioche : As de Carreau.
- **Rôle tactique** : 5 PA, 1/tour : utiliser Pile/Face pour choisir l'effet de placement.
- **Tags** : `damage`, `earth`, `life_steal`, `placement`, `random`, `draw`
- *Infobulle décodée (auto)* :
  - 42 à 46 vol Terre (CC : 55 vol Terre) — cibles : ennemis
  - Attire de 4 cases — cibles : alliés (lanceur compris), ennemis [si le lanceur n'a pas l'état « Pile »; si le lanceur n'a pas l'état « Face »] ; ALÉATOIRE 50 % (groupe 0)
  - Repousse de 4 cases — cibles : alliés (lanceur compris), ennemis [si le lanceur n'a pas l'état « Pile »; si le lanceur n'a pas l'état « Face »] ; ALÉATOIRE 50 % (groupe 0)
  - État « Destin d'Ecaflip » — cibles : ennemis ; 1 tour(s)
  - 25 à 27 dommages Terre (CC : 31 dommages Terre) — cibles : ennemis
  - État « As de Carreau » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 12 : Roulette / Tarot d'Ecaflip

*Roulette (1 effet global aléatoire, gratuit) ou Tarot (22 arcanes, −1 PA sur des familles de sorts).*

#### 12A. Roulette (id 12840, niveau de déblocage 40)

- **Caractéristiques** : **1 PA** · PO 0–0 (fixe), sans LdV · 1/tour · CC 0 %
- **Description officielle** : Applique un effet aléatoire sur tout le monde.  Le coût en PA du sort est remboursé.
- **Effets** :
  - Applique 1 effet tiré parmi 22 (4,55 % chacun) à TOUTES les entités pendant 1 tour (voir tableau Roulette).
  - Coût remboursé (gratuit), 1/tour.
- **Rôle tactique** : Lancer quand les alliés jouent avant les ennemis ; risqué contre des ennemis à fort potentiel (+400 caractéristique).
- **Tags** : `buff_global`, `random`, `free`
- **Grades** : g1 (niv. 40) : 1 PA, PO 0–0, 1/tour ; g2 (niv. 107) : 1 PA, PO 0–0, 1/tour ; g3 (niv. 174) : 1 PA, PO 0–0, 1/tour
- *Infobulle décodée (auto)* :
  - Durée des effets : -1 — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; ALÉATOIRE 4.55 % (groupe 0)
  - 2 PA — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 2 PM — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 5 Portée — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 20% Érosion — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 50 Tacle — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 50 Fuite — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 50 Retrait PA — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 50 Retrait PM — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 50 Esquive PA — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 50 Esquive PM — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 50% Critique — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 50 Dommages — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 75 Dommages Critiques — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 100 Dommages Poussée — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 100 Résistances Critiques — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 100 Résistances Poussée — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 100 Soins — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 400 Force — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 400 Intelligence — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 400 Chance — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - 400 Agilité — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0)
  - Rembourse 1 PA — cibles : lanceur

#### 12B. Tarot d'Ecaflip (id 12850, niveau de déblocage 150)

- **Caractéristiques** : **1 PA** · PO 0–0 (fixe), sans LdV · 1/tour · CC 0 %
- **Description officielle** : Pioche une Carte aléatoire du Tarot d'Ecaflip pour appliquer ses effets sur le lanceur et sur tout le monde.
- **Effets** :
  - Tire 1 arcane parmi 22 (4,55 % chacun) qui s'applique à toutes les entités pendant 1 tour, avec des effets propres au lanceur (voir tableau des arcanes).
  - 1 PA, 1/tour.
- **Rôle tactique** : Souvent rentable pour le lanceur (−1 PA sur une famille de sorts, pioches) ; effets globaux à surveiller.
- **Tags** : `buff_global`, `random`, `ap_cost_reduction`
- *Infobulle décodée (auto)* :
  - État « 0. Le Fou » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « I. Le Magicien » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « II. La Cartomancienne » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « III. L'Impératrice » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « IV. L'Empereur » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « V. Le Hiérophante » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « VI. Les Amoureux » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « VII. Le Chariot » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « VIII. La Justice » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « IX. L'Ermite » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « X. La Roue de Fortune » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XI. Le Croupier » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XII. Le Pendu » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XIII. La Mort » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XIV. Le Temple » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XV. Le Diable » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XVI. La Tour » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XVII. L'Étoile » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XVIII. La Lune » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XIX. Le Soleil » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XX. Le Jugement » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)
  - État « XXI. Le Monde » — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; ALÉATOIRE 4.55 % (groupe 0) ; non désenvoûtable (sauf mort)

### Paire 13 : Belote / Péril

*Belote (Terre, −Dommages critiques) ou Péril (5 PA, vol Feu + dommages si soigné).*

#### 13A. Belote (id 12866, niveau de déblocage 45)

- **Caractéristiques** : **3 PA** · PO 0–6 (modifiable), LdV · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Occasionne des dommages Terre aux ennemis et Pioche une Dame de Carreau. N'affecte pas le lanceur.  Réduit également les Dommages Critiques selon les Cartes de Carreau dans la Main (cumulable une fois par Carte). Les dommages du sort sont augmentés selon les Cartes de Carreau dans la Main.  Joue les Cartes de Carreau si le lanceur en possède initialement au moins une dans la Main.
- **Effets** :
  - 27 à 30 dommages Terre (CC 36) à l'ennemi ; +2/+3/+4/+5 par carte Carreau en main.
  - −10/−20/−30/−40 Dommages Critiques (2 tours) pour chaque Valet/Dame/Roi/As de Carreau en main.
  - Pioche : Dame de Carreau ; joue les cartes Carreau si le lanceur en avait au moins une.
- **Rôle tactique** : Réduit les dommages critiques du boss.
- **Tags** : `damage`, `earth`, `debuff`, `draw`, `play_suit`
- **Grades** : g1 (niv. 45) : 3 PA, PO 0–4, 3/tour, 17–19 Terre ; g2 (niv. 112) : 3 PA, PO 0–5, 3/tour, 22–25 Terre ; g3 (niv. 179) : 3 PA, PO 0–6, 3/tour, 27–30 Terre
- *Infobulle décodée (auto)* :
  - 27 à 30 dommages Terre (CC : 36 dommages Terre) — cibles : ennemis
  - -10 à -40 Dommages Critiques — cibles : alliés (hors lanceur), ennemis ; 2 tour(s)
  - État « Dame de Carreau » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort
  - lance « Joue les Cartes de Carreau » (#29952, rang 1) — cibles : lanceur

#### 13B. Péril (id 14311, niveau de déblocage 155)

- **Caractéristiques** : **5 PA** · PO 1–8 (fixe), LdV · 1/tour · cumul 1 · CC 20 %
- **Description officielle** : Vole de la vie dans l'élément Feu et applique l'état Péril sur l'ennemi ciblé : • Occasionne des dommages Feu et retire l'état si la cible est soignée.  Pioche un As de Cœur.
- **Effets** :
  - Vole 43 à 47 PV en Feu (CC 56) à la cible (1–8 PO).
  - État « Péril » (1 tour) : si la cible est soignée → 26 à 28 dommages Feu (CC 33), état retiré.
  - Pioche : As de Cœur.
- **Rôle tactique** : 5 PA, 1/tour : contre un boss/monstre soigneur.
- **Tags** : `damage`, `fire`, `life_steal`, `anti_heal`, `draw`
- *Infobulle décodée (auto)* :
  - 43 à 47 vol Feu (CC : 56 vol Feu) — cibles : alliés (lanceur compris), ennemis
  - État « Péril » — cibles : ennemis ; 1 tour(s)
  - 26 à 28 dommages Feu (CC : 33 dommages Feu) — cibles : ennemis
  - État « As de Cœur » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 14 : Tromperie / Tout ou Rien

*Tromperie (2–5 PA aléatoire, vol/soin 4 éléments) ou Tout ou Rien (cercle 3 soin + dommages, recycle la Table).*

#### 14A. Tromperie (id 12881, niveau de déblocage 50)

- **Caractéristiques** : **2 PA** · PO 0–5 (modifiable), LdV · 3/tour · 2/cible · CC 5 %
- **Description officielle** : Vole de la vie aux ennemis ou soigne les alliés dans l'élément Air, Eau, Feu ou Terre. Le coût en PA, les dommages et soins et l'élément d'attaque sont modifiés aléatoirement à chaque lancer et lorsque le lanceur effectue un coup critique.  Pioche une Carte selon les conditions de lancer et l'élément du sort. Joue la Main avant de Piocher si elle est pleine.
- **Effets** :
  - Coût et élément aléatoires : 2 PA → vole 19–20 PV (ennemi) ou soigne 19–20 (allié) ; 3 PA → 28–30 ; 4 PA → 37–40 ; 5 PA → 46–50 ; élément Air/Eau/Feu/Terre (25 % chacun) ; +0/5/10/15 % Critique selon le coût ; CC 30/40/50/60.
  - Re-tirage après chaque lancer (et sur coup critique du lanceur).
  - Pioche la carte de son coût/élément ; joue la Main avant si elle est pleine.
- **Rôle tactique** : Filler adaptatif ; les arcanes I/II/III/IV/V/VII/XI/XIV réduisent son coût.
- **Tags** : `damage`, `heal`, `life_steal`, `multi_element`, `random`, `draw`
- **Grades** : g1 (niv. 50) : 2 PA, PO 0–5, 3/tour, 11–12 Air (vol) / 11–12 Eau (vol) / 11–12 Feu (vol) / 11–12 Terre (vol) / 11–12 Air (soin) / 11–12 Eau (soin) / 11–12 Feu (soin) / 11–12 Terre (soin) / 20–22 Air (vol) / 20–22 Eau (vol) / 20–22 Feu (vol) / 20–22 Terre (vol) / 20–22 Air (soin) / 20–22 Eau (soin) / 20–22 Feu (soin) / 20–22 Terre (soin) / 29–32 Air (vol) / 29–32 Eau (vol) / 29–32 Feu (vol) / 29–32 Terre (vol) / 29–32 Air (soin) / 29–32 Eau (soin) / 29–32 Feu (soin) / 29–32 Terre (soin) / 38–42 Air (vol) / 38–42 Eau (vol) / 38–42 Feu (vol) / 38–42 Terre (vol) / 38–42 Air (soin) / 38–42 Eau (soin) / 38–42 Feu (soin) / 38–42 Terre (soin) ; g2 (niv. 117) : 2 PA, PO 0–5, 3/tour, 15–16 Air (vol) / 15–16 Eau (vol) / 15–16 Feu (vol) / 15–16 Terre (vol) / 15–16 Air (soin) / 15–16 Eau (soin) / 15–16 Feu (soin) / 15–16 Terre (soin) / 24–26 Air (vol) / 24–26 Eau (vol) / 24–26 Feu (vol) / 24–26 Terre (vol) / 24–26 Air (soin) / 24–26 Eau (soin) / 24–26 Feu (soin) / 24–26 Terre (soin) / 33–36 Air (vol) / 33–36 Eau (vol) / 33–36 Feu (vol) / 33–36 Terre (vol) / 33–36 Air (soin) / 33–36 Eau (soin) / 33–36 Feu (soin) / 33–36 Terre (soin) / 42–46 Air (vol) / 42–46 Eau (vol) / 42–46 Feu (vol) / 42–46 Terre (vol) / 42–46 Air (soin) / 42–46 Eau (soin) / 42–46 Feu (soin) / 42–46 Terre (soin) ; g3 (niv. 184) : 2 PA, PO 0–5, 3/tour, 19–20 Air (vol) / 19–20 Eau (vol) / 19–20 Feu (vol) / 19–20 Terre (vol) / 19–20 Air (soin) / 19–20 Eau (soin) / 19–20 Feu (soin) / 19–20 Terre (soin) / 28–30 Air (vol) / 28–30 Eau (vol) / 28–30 Feu (vol) / 28–30 Terre (vol) / 28–30 Air (soin) / 28–30 Eau (soin) / 28–30 Feu (soin) / 28–30 Terre (soin) / 37–40 Air (vol) / 37–40 Eau (vol) / 37–40 Feu (vol) / 37–40 Terre (vol) / 37–40 Air (soin) / 37–40 Eau (soin) / 37–40 Feu (soin) / 37–40 Terre (soin) / 46–50 Air (vol) / 46–50 Eau (vol) / 46–50 Feu (vol) / 46–50 Terre (vol) / 46–50 Air (soin) / 46–50 Eau (soin) / 46–50 Feu (soin) / 46–50 Terre (soin)
- *Infobulle décodée (auto)* :
  - 19 à 20 vol Air (CC : 30 vol Air) — cibles : ennemis [si le lanceur a l'état « Tromperie Air 2 PA »]
  - 19 à 20 soins Air (CC : 30 soins Air) — cibles : alliés (lanceur compris) [si le lanceur a l'état « Tromperie Air 2 PA »]
  - 28 à 30 vol Air (CC : 40 vol Air) — cibles : ennemis [si le lanceur a l'état « Tromperie Air 3 PA »]
  - 28 à 30 soins Air (CC : 40 soins Air) — cibles : alliés (lanceur compris) [si le lanceur a l'état « Tromperie Air 3 PA »]
  - 37 à 40 vol Air (CC : 50 vol Air) — cibles : ennemis [si le lanceur a l'état « Tromperie Air 4 PA »]
  - 37 à 40 soins Air (CC : 50 soins Air) — cibles : alliés (lanceur compris) [si le lanceur a l'état « Tromperie Air 4 PA »]
  - 46 à 50 vol Air (CC : 60 vol Air) — cibles : ennemis [si le lanceur a l'état « Tromperie Air 5 PA »]
  - 46 à 50 soins Air (CC : 60 soins Air) — cibles : alliés (lanceur compris) [si le lanceur a l'état « Tromperie Air 5 PA »]
  - lance « Joue la Main » (#29945, rang 1) — cibles : lanceur
  - lance « Pioche une Carte » (#29946, rang 1) — cibles : lanceur

#### 14B. Tout ou Rien (id 12858, niveau de déblocage 160)

- **Caractéristiques** : **3 PA** · PO 0–3 (fixe), LdV · relance 2 · CC 10 %
- **Description officielle** : Soigne les alliés et occasionne des dommages dans le meilleur élément du lanceur aux ennemis en zone. Les soins sont augmentés selon les Cartes sur la Table et les dommages selon les Cartes dans la Main.  Défausse la Main et récupère la Table.
- **Effets** :
  - Zone : cercle de 3 (0–3 PO). 16 à 18 soins du meilleur élément aux alliés et 16 à 18 dommages du meilleur élément (CC 21) aux ennemis.
  - Soins augmentés selon les cartes sur la Table (+4/6/8/10 par carte), dommages selon les cartes en main (+4/6/8/10 par carte).
  - Défausse la Main (sans la jouer) et récupère les cartes de la Table dans la Main. Relance 2.
- **Rôle tactique** : Avec 4 cartes en main (V+D+R+A : +28) : 44–46 de base en zone ; garde la combinaison de la Table.
- **Tags** : `heal`, `damage`, `best_element`, `aoe`, `recycle`
- *Infobulle décodée (auto)* :
  - 16 à 18 soins du meilleur élément (CC : 21 soins du meilleur élément) — cibles : alliés (lanceur compris) ; zone : cercle de rayon 3
  - 16 à 18 dommages du meilleur élément (CC : 21 dommages du meilleur élément) — cibles : ennemis ; zone : cercle de rayon 3
  - lance « Défausse la Main » (#30130, rang 1) — cibles : lanceur
  - lance « Récupère les Cartes sur la Table » (#30038, rang 1) — cibles : lanceur

### Paire 15 : Pelotage / Griffe de Ceangal

*Pelotage (croix Feu + attire) ou Griffe de Ceangal (Air, repousse + avance).*

#### 15A. Pelotage (id 14310, niveau de déblocage 55)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · 2/tour · CC 10 %
- **Description officielle** : Occasionne des dommages Feu aux ennemis et attire les cibles vers le centre en zone.  Pioche une Dame de Cœur.
- **Effets** :
  - Zone : croix de 1 (0–6 PO). 29 à 32 dommages Feu (CC 38) aux ennemis ; attire d'1 case vers le centre les entités de l'anneau 1.
  - Pioche : Dame de Cœur.
- **Rôle tactique** : 3 PA, 2/tour : resserre un paquet.
- **Tags** : `damage`, `fire`, `aoe_small`, `pull`, `draw`
- **Grades** : g1 (niv. 55) : 3 PA, PO 0–4, 2/tour, 17–19 Feu ; g2 (niv. 122) : 3 PA, PO 0–5, 2/tour, 23–25 Feu ; g3 (niv. 189) : 3 PA, PO 0–6, 2/tour, 29–32 Feu
- *Infobulle décodée (auto)* :
  - 29 à 32 dommages Feu (CC : 38 dommages Feu) — cibles : ennemis ; zone : croix de 1
  - Attire de 1 case — cibles : alliés (lanceur compris), ennemis ; zone : croix de 1 sans le centre ; non désenvoûtable (sauf mort)
  - État « Dame de Cœur » (CC : lance « Dame de Cœur » (#29696, rang 1)) — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

#### 15B. Griffe de Ceangal (id 12851, niveau de déblocage 165)

- **Caractéristiques** : **3 PA** · PO 1–4 (fixe), en ligne, LdV · 2/tour · CC 10 %
- **Description officielle** : Repousse la cible, rapproche le lanceur vers elle et occasionne des dommages Air aux ennemis.  Pioche une Dame de Pique.
- **Effets** :
  - Repousse la cible de 3 cases, le lanceur avance de 3 cases vers elle, puis 27 à 29 dommages Air (CC 33) (1–4 PO en ligne).
  - Pioche : Dame de Pique.
- **Rôle tactique** : Charge Fanfaronnade (2 déplacements) ; dommages de poussée.
- **Tags** : `damage`, `air`, `push`, `gap_closer`, `draw`
- *Infobulle décodée (auto)* :
  - Repousse de 3 cases — cibles : alliés (lanceur compris), ennemis
  - Avance de 3 cases — cibles : alliés (lanceur compris), ennemis
  - 27 à 29 dommages Air (CC : 33 dommages Air) — cibles : ennemis
  - État « Dame de Pique » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 16 : Griffe Invocatrice / Caresse Invocatrice

*Griffe Invocatrice (Chaton offensif, +90 Puissance) ou Caresse Invocatrice (Chaton soigneur).*

#### 16A. Griffe Invocatrice (id 12856, niveau de déblocage 60)

- **Caractéristiques** : **3 PA** · PO 1–4 (fixe), LdV · case libre · relance 4 · cumul 3 · CC 0 %
- **Description officielle** : Invoque un Chaton maîtrisable qui peut voler de la vie dans l'élément Eau, donner des PM et se téléporter. Tant qu'il est en vie, augmente la Puissance du lanceur.
- **Effets** :
  - Invoque un Chaton Enragé maîtrisable (#5847 g3, 1–4 PO, case libre, relance 4) : 6 PA, 4 PM, résistances 30 %, Chance 250, Agilité 70.
  - Tant qu'il vit : +90 Puissance à l'Ecaflip.
  - Sorts : Âme Féline (3 PA, contact : se téléporte symétriquement par rapport à la cible et vole 36–39 PV Eau, CC 30 % → 45), Déplacement Félin (2 PA : +1 PM à un allié ou téléportation 0–2 PO).
- **Rôle tactique** : +90 Puissance permanente tant que le Chaton survit : le garder à l'abri est plus important que ses attaques.
- **Tags** : `summon`, `damage`, `buff_power`
- **Grades** : g1 (niv. 60) : 3 PA, PO 1–4, relance 4 ; g2 (niv. 127) : 3 PA, PO 1–4, relance 4 ; g3 (niv. 194) : 3 PA, PO 1–4, relance 4
- *Infobulle décodée (auto)* :
  - Invoque : Chaton Enragé (#5847, grade 3) — cibles : alliés (lanceur compris), ennemis
  - 90 Puissance — cibles : personnages alliés [« famille » du lanceur (lui, ses invocations)] ; infini ; non désenvoûtable (sauf mort)

#### 16B. Caresse Invocatrice (id 12869, niveau de déblocage 170)

- **Caractéristiques** : **3 PA** · PO 1–4 (fixe), LdV · case libre · relance 4 · CC 0 %
- **Description officielle** : Invoque un Chaton maîtrisable qui peut soigner, se téléporter ou échanger de position.
- **Effets** :
  - Invoque un Chaton Affectueux maîtrisable (#5848 g2, relance 4) : 6 PA, 4 PM, résistances 30 %, Intelligence 300.
  - Sorts : Mistigri (3 PA, 0–6 PO, 3/tour, 1/cible : 30–32 soins Feu, CC 30 % → 54), Pattes de l'Expert (2 PA : téléportation 1–2 PO, échange avec un allié si l'état Contrôlé est actif).
- **Rôle tactique** : Soigneur additionnel (jusqu'à 3 soins/tour).
- **Tags** : `summon`, `heal`
- *Infobulle décodée (auto)* :
  - Invoque : Chaton Affectueux (#5848, grade 2) — cibles : alliés (lanceur compris), ennemis

### Paire 17 : Esprit Félin / Kraps

*Esprit Félin (Terre, symétries, +rés. critiques) ou Kraps (croix Eau, repousse, +Dommages critiques).*

#### 17A. Esprit Félin (id 12847, niveau de déblocage 65)

- **Caractéristiques** : **3 PA** · PO 0–1 (fixe), en ligne ou diagonale, sans LdV · case occupée · 2/tour · cumul 1 · CC 10 %
- **Description officielle** : Téléporte aléatoirement et symétriquement la cible par rapport au lanceur ou le lanceur par rapport à la cible, occasionne des dommages Terre aux ennemis et augmente les Résistances Critiques du lanceur.  • Pile : l'aléatoire est supprimé pour téléporter la cible. • Face : l'aléatoire est supprimé pour téléporter le lanceur.  Pioche une Dame de Carreau.
- **Effets** :
  - Au contact (0–1 PO en ligne/diagonale, case occupée) : aléatoire 50/50 — la cible est téléportée symétriquement par rapport au lanceur (Pile) ou le lanceur par rapport à la cible (Face).
  - 31 à 34 dommages Terre (CC 41) à l'ennemi ; +30 Résistances Critiques (CC 60) au lanceur (1 tour).
  - Pioche : Dame de Carreau.
- **Rôle tactique** : Passer de l'autre côté d'un ennemi ou le faire passer derrière soi.
- **Tags** : `damage`, `earth`, `placement`, `random`, `draw`
- **Grades** : g1 (niv. 65) : 3 PA, PO 0–1, 2/tour, 19–21 Terre ; g2 (niv. 131) : 3 PA, PO 0–1, 2/tour, 26–29 Terre ; g3 (niv. 198) : 3 PA, PO 0–1, 2/tour, 31–34 Terre
- *Infobulle décodée (auto)* :
  - Téléportation symétrique par rapport au lanceur — cibles : alliés (lanceur compris), ennemis [si le lanceur n'a pas l'état « Pile »; si le lanceur n'a pas l'état « Face »] ; ALÉATOIRE 50 % (groupe 0)
  - Téléportation symétrique par rapport à la cible — cibles : alliés (lanceur compris), ennemis [si le lanceur n'a pas l'état « Pile »; si le lanceur n'a pas l'état « Face »] ; ALÉATOIRE 50 % (groupe 0)
  - 31 à 34 dommages Terre (CC : 41 dommages Terre) — cibles : ennemis
  - 30 Résistances Critiques (CC : 60 Résistances Critiques) — cibles : lanceur ; 1 tour(s)
  - État « Dame de Carreau » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

#### 17B. Kraps (id 12883, niveau de déblocage 175)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · 2/tour · cumul 1 · CC 10 %
- **Description officielle** : Occasionne des dommages Eau aux ennemis et repousse les cibles depuis le centre en zone. Augmente également les Dommages Critiques du lanceur.  Pioche une Dame de Trèfle.
- **Effets** :
  - Zone : croix de 1 (0–6 PO). 28 à 30 dommages Eau (CC 34) aux ennemis ; repousse de 3 cases depuis le centre les entités de l'anneau 1.
  - +28 à 30 Dommages Critiques au lanceur (3 tours, CC 34).
  - Pioche : Dame de Trèfle.
- **Rôle tactique** : Buff de dommages critiques à poser avant les sorts à gros critique.
- **Tags** : `damage`, `water`, `aoe_small`, `push`, `crit_buff`, `draw`
- *Infobulle décodée (auto)* :
  - 28 à 30 dommages Eau (CC : 34 dommages Eau) — cibles : ennemis ; zone : croix de 1
  - Repousse de 3 cases — cibles : alliés (lanceur compris), ennemis ; zone : croix de 1 (centre exclu), non dégressive
  - 28 à 30 Dommages Critiques (CC : 34 Dommages Critiques) — cibles : lanceur ; 3 tour(s)
  - État « Dame de Trèfle » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 18 : Odorat / Roue de la Fortune

*Odorat (−3 PA non esquivables puis +3 PA) ou Roue de la Fortune (999 % critique aux alliés au contact).*

#### 18A. Odorat (id 12854, niveau de déblocage 70)

- **Caractéristiques** : **3 PA** · PO 0–2 (fixe), sans LdV · relance 2 · relance globale -1 · CC 0 %
- **Description officielle** : Retire immédiatement des PA non esquivables pour augmenter les PM en zone. Retire des PM non esquivables pour augmenter les PA au tour suivant. Le retrait de PA n'affecte pas le lanceur.  Joue la Main.
- **Effets** :
  - Zone : cercle de 3 (0–2 PO). Immédiatement : −3 PA NON esquivables (1 tour) à tous sauf le lanceur, +2 PM (1 tour) à tous.
  - Au tour suivant : −2 PM non esquivables et +3 PA (1 tour) à tous.
  - Joue la Main. Relance 2.
- **Rôle tactique** : Entrave PA immédiate d'un paquet ennemi (les alliés de la zone récupèrent +3 PA au tour suivant).
- **Tags** : `ap_removal`, `mp_gain`, `ap_gain`, `play_hand`
- **Grades** : g1 (niv. 70) : 3 PA, PO 0–1, relance 3 ; g2 (niv. 137) : 3 PA, PO 0–2, relance 2
- *Infobulle décodée (auto)* :
  - -3 PA — cibles : alliés (hors lanceur), ennemis ; zone : cercle de rayon 3 ; 1 tour(s)
  - 2 PM — cibles : alliés (lanceur compris), ennemis ; zone : cercle de rayon 3 ; 1 tour(s)
  - -2 PM — cibles : alliés (lanceur compris), ennemis ; zone : cercle de rayon 3 ; 1 tour(s) ; DIFFÉRÉ de 1 tour(s)
  - 3 PA — cibles : alliés (lanceur compris), ennemis ; zone : cercle de rayon 3 ; 1 tour(s) ; DIFFÉRÉ de 1 tour(s)
  - lance « Joue la Main » (#29945, rang 1) — cibles : lanceur

#### 18B. Roue de la Fortune (id 12863, niveau de déblocage 180)

- **Caractéristiques** : **3 PA** · PO 0–2 (fixe), LdV · relance 2 · CC 0 %
- **Description officielle** : Minimise immédiatement les effets aléatoires et augmente les chances de Critique au tour suivant des ennemis en zone. Les effets sont permutés sur les alliés en zone.  Joue immédiatement la Main et la défausse pour récupérer la Table au tour suivant. La Main n'est pas défaussée s'il n'y a aucune Carte sur la Table.
- **Effets** :
  - Zone : cercle de 2 (0–2 PO). Ennemis : jets minimisés (1 tour) puis 999 % Critique au tour suivant.
  - Alliés : 999 % Critique (1 tour) puis jets minimisés au tour suivant.
  - Joue immédiatement la Main ; elle est défaussée et la Table est récupérée au tour suivant (sauf Table vide). Relance 2.
- **Rôle tactique** : Coups critiques garantis pour les alliés au contact ce tour (attention au retour de bâton sur les ennemis de la zone).
- **Tags** : `buff_ally`, `crit_buff`, `debuff`, `play_hand`
- *Infobulle décodée (auto)* :
  - Minimise les effets aléatoires de la cible — cibles : ennemis ; zone : cercle de rayon 2 ; 1 tour(s)
  - 999% Critique — cibles : ennemis ; zone : cercle de rayon 2 ; 1 tour(s) ; DIFFÉRÉ de 1 tour(s)
  - 999% Critique — cibles : alliés (lanceur compris) ; zone : cercle de rayon 2 ; 1 tour(s)
  - Minimise les effets aléatoires de la cible — cibles : alliés (lanceur compris) ; zone : cercle de rayon 2 ; 1 tour(s) ; DIFFÉRÉ de 1 tour(s)
  - lance « Joue la Main » (#29945, rang 1) — cibles : lanceur
  - lance « Défausse la Main » (#30130, rang 1) — cibles : lanceur ; DIFFÉRÉ de 1 tour(s)
  - lance « Récupère les Cartes sur la Table » (#30038, rang 1) — cibles : lanceur ; DIFFÉRÉ de 1 tour(s)

### Paire 19 : Coussinets / Feulement

*Coussinets (Air, recule + repousse) ou Feulement (ligne Feu, repousse 3).*

#### 19A. Coussinets (id 12875, niveau de déblocage 75)

- **Caractéristiques** : **4 PA** · PO 1–6 (modifiable), LdV · 2/tour · CC 15 %
- **Description officielle** : Éloigne le lanceur de la cible, repousse la cible et occasionne des dommages Air aux ennemis.  Pioche un Roi de Pique.
- **Effets** :
  - Le lanceur recule de 2 cases, la cible est repoussée de 2 cases, puis 35 à 38 dommages Air (CC 46) (1–6 PO modifiable).
  - Pioche : Roi de Pique.
- **Rôle tactique** : Désengagement + dommages de poussée.
- **Tags** : `damage`, `air`, `push`, `escape`, `draw`
- **Grades** : g1 (niv. 75) : 4 PA, PO 1–5, 2/tour, 28–31 Air ; g2 (niv. 142) : 4 PA, PO 1–6, 2/tour, 35–38 Air
- *Infobulle décodée (auto)* :
  - Recule de 2 cases — cibles : alliés (lanceur compris), ennemis
  - Repousse de 2 cases — cibles : alliés (lanceur compris), ennemis
  - 35 à 38 dommages Air (CC : 46 dommages Air) — cibles : ennemis
  - État « Roi de Pique » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

#### 19B. Feulement (id 12872, niveau de déblocage 185)

- **Caractéristiques** : **4 PA** · PO 1–5 (modifiable), en ligne, LdV · 2/tour · CC 15 %
- **Description officielle** : Occasionne des dommages Feu aux ennemis et repousse les cibles en zone.  Pioche un Roi de Cœur.
- **Effets** :
  - Zone : ligne de 4 cases depuis l'impact (1–5 PO modifiable, en ligne). 30 à 34 dommages Feu (CC 41) aux ennemis ; repousse de 3 cases toutes les entités de la ligne.
  - Pioche : Roi de Cœur.
- **Rôle tactique** : Couloir : frappe et repousse une file.
- **Tags** : `damage`, `fire`, `aoe_line`, `push`, `draw`
- *Infobulle décodée (auto)* :
  - 30 à 34 dommages Feu (CC : 41 dommages Feu) — cibles : ennemis ; zone : ligne de 4 cases (impact + 3 derrière)
  - Repousse de 3 cases — cibles : alliés (lanceur compris), ennemis ; zone : ligne de 4 cases (impact + 3 derrière)
  - État « Roi de Cœur » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 20 : Seconde Chance / Neuf Vies

*Seconde Chance (×0,5 puis ×1,5 dégâts subis) ou Neuf Vies (3 × 9 % PV max + 3 pioches).*

#### 20A. Seconde Chance (id 12842, niveau de déblocage 80)

- **Caractéristiques** : **2 PA** · PO 0–6 (modifiable), LdV · relance 4 · relance globale -1 · CC 0 %
- **Description officielle** : Réduit immédiatement les dommages subis par l'allié ciblé mais les augmente au tour suivant.  Joue immédiatement la Main et la défausse pour récupérer la Table au tour suivant. La Main n'est pas défaussée s'il n'y a aucune Carte sur la Table.
- **Effets** :
  - Allié (0–6 PO modifiable) : dommages subis ×50 % jusqu'au prochain tour du lanceur, puis ×150 % pendant le tour suivant.
  - Joue immédiatement la Main ; défausse et récupération de la Table au tour suivant. Relance 4.
- **Rôle tactique** : Encaisser le tour d'ultime/burst du boss ; éviter que l'allié soit frappé au tour suivant.
- **Tags** : `protection`, `damage_reduction`, `play_hand`
- **Grades** : g1 (niv. 80) : 2 PA, PO 0–4, relance 4 ; g2 (niv. 147) : 2 PA, PO 0–6, relance 4
- *Infobulle décodée (auto)* :
  - Dommages subis x50% — cibles : alliés (lanceur compris) ; DÉCLENCHÉ quand : Le porteur subit des dommages (écoute 1 t) ; non désenvoûtable (sauf mort)
  - Dommages subis x150% — cibles : alliés (lanceur compris) ; DIFFÉRÉ de 1 tour(s) ; DÉCLENCHÉ quand : Le porteur subit des dommages (écoute 1 t) ; non désenvoûtable (sauf mort)
  - lance « Joue la Main » (#29945, rang 1) — cibles : lanceur
  - lance « Défausse la Main » (#30130, rang 1) — cibles : lanceur ; DIFFÉRÉ de 1 tour(s)
  - lance « Récupère les Cartes sur la Table » (#30038, rang 1) — cibles : lanceur ; DIFFÉRÉ de 1 tour(s)

#### 20B. Neuf Vies (id 12874, niveau de déblocage 190)

- **Caractéristiques** : **3 PA** · PO 0–9 (fixe), LdV · relance 3 · CC 0 %
- **Description officielle** : Soigne la cible immédiatement et sur les tours suivants.  Pioche une Carte aléatoire du Poker d'Ecaflip immédiatement et sur les tours suivants.
- **Effets** :
  - Soin de 9 % PV max immédiatement, au tour suivant et dans 2 tours (0–9 PO, cible alliée ou ennemie).
  - Pioche une carte aléatoire immédiatement et aux 2 tours suivants (si la Main n'est pas pleine). Relance 3.
- **Rôle tactique** : 27 % PV max sur 3 tours + 3 pioches.
- **Tags** : `heal`, `hot`, `percent_heal`, `draw`
- *Infobulle décodée (auto)* :
  - Soin : 9% des PV max — cibles : alliés (lanceur compris), ennemis
  - Soin : 9% des PV max — cibles : alliés (lanceur compris), ennemis ; DIFFÉRÉ de 1 tour(s)
  - Soin : 9% des PV max — cibles : alliés (lanceur compris), ennemis ; DIFFÉRÉ de 2 tour(s)
  - lance « Pioche une Carte » (#29946, rang 1) — cibles : lanceur
  - lance « Pioche une Carte » (#29946, rang 1) — cibles : lanceur ; DIFFÉRÉ de 1 tour(s)
  - lance « Pioche une Carte » (#29946, rang 1) — cibles : lanceur ; DIFFÉRÉ de 2 tour(s)

### Paire 21 : Félintion / Mésaventure

*Félintion (Eau, avance + attire) ou Mésaventure (anneau 2 Terre, symétries, −2 PA/PM).*

#### 21A. Félintion (id 12861, niveau de déblocage 85)

- **Caractéristiques** : **4 PA** · PO 1–6 (modifiable), LdV · 2/tour · CC 15 %
- **Description officielle** : Rapproche le lanceur vers la cible, attire la cible et occasionne des dommages Eau aux ennemis.  Pioche un Roi de Trèfle.
- **Effets** :
  - Le lanceur avance de 2 cases, attire la cible de 2 cases, puis 33 à 36 dommages Eau (CC 43) (1–6 PO modifiable).
  - Pioche : Roi de Trèfle.
- **Rôle tactique** : Rapprochement à double sens (charge Fanfaronnade de 2).
- **Tags** : `damage`, `water`, `pull`, `gap_closer`, `draw`
- **Grades** : g1 (niv. 85) : 4 PA, PO 1–5, 2/tour, 27–29 Eau ; g2 (niv. 152) : 4 PA, PO 1–6, 2/tour, 33–36 Eau
- *Infobulle décodée (auto)* :
  - Avance de 2 cases — cibles : alliés (lanceur compris), ennemis
  - Attire de 2 cases — cibles : alliés (lanceur compris), ennemis
  - 33 à 36 dommages Eau (CC : 43 dommages Eau) — cibles : ennemis
  - État « Roi de Trèfle » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

#### 21B. Mésaventure (id 12879, niveau de déblocage 195)

- **Caractéristiques** : **4 PA** · PO 0–2 (fixe), LdV · 2/tour · cumul 1 · CC 15 %
- **Description officielle** : Téléporte les cibles symétriquement par rapport au centre, occasionne des dommages Terre et retire aléatoirement des PM ou des PA aux ennemis en zone. N'affecte pas directement le lanceur.  • Pile : l'aléatoire est supprimé pour retirer des PM. • Face : l'aléatoire est supprimé pour retirer des PA.  Pioche un Roi de Carreau.
- **Effets** :
  - Zone : anneau de rayon 2 autour de l'impact (0–2 PO). Les entités (hors lanceur) sont téléportées symétriquement par rapport au centre.
  - 37 à 41 dommages Terre (CC 49) aux ennemis ; −2 PM ou −2 PA esquivables aléatoires (Pile → PM, Face → PA).
  - Pioche : Roi de Carreau.
- **Rôle tactique** : 4 PA, 2/tour : zone + entrave autour de soi.
- **Tags** : `damage`, `earth`, `aoe_ring`, `placement`, `ap_removal`, `mp_removal`, `draw`
- *Infobulle décodée (auto)* :
  - Téléportation symétrique — cibles : alliés (hors lanceur), ennemis ; zone : anneau de rayon exactement 2
  - 37 à 41 dommages Terre (CC : 49 dommages Terre) — cibles : ennemis ; zone : anneau de rayon exactement 2
  - -2 PM — cibles : ennemis [si le lanceur a l'état « Pile »] ; zone : anneau de rayon exactement 2 ; 1 tour(s) ; ALÉATOIRE 50 % (groupe 0) ; désenvoûtable seulement par effet fort
  - -2 PA — cibles : ennemis [si le lanceur a l'état « Face »] ; zone : anneau de rayon exactement 2 ; 1 tour(s) ; ALÉATOIRE 50 % (groupe 0) ; désenvoûtable seulement par effet fort
  - État « Roi de Carreau » — cibles : lanceur ; infini ; désenvoûtable seulement par effet fort

### Paire 22 : Bluff / Rekop

*Bluff (dommages fixes par couleur en main, joue la main) ou Rekop (paie la Main Gagnante).*

#### 22A. Bluff (id 29785, niveau de déblocage 90)

- **Caractéristiques** : **3 PA** · PO 1–7 (modifiable), LdV · 1/tour · CC 10 %
- **Description officielle** : Occasionne des dommages dans un ou plusieurs éléments selon les Cartes dans la Main et Joue la Main. Les dommages du sort dans un élément sont augmentés selon les Cartes.  Pioche 4 Cartes aléatoires du Poker d'Ecaflip avant d'appliquer les effets si la Main est vide.
- **Effets** :
  - Si la Main est vide : pioche d'abord 4 cartes aléatoires.
  - Dommages FIXES dans l'élément de chaque couleur présente en main (Pique Air, Trèfle Eau, Cœur Feu, Carreau Terre) = somme des bonus des cartes de cette couleur (Valet 4, Dame 6, Roi 8, As 10 ; +28 si Suite Royale de la couleur) ; CC +4. Exemple : V+D+R+A de Pique = 56 Air.
  - Puis joue la Main. 3 PA, 1–7 PO modifiable, 1/tour.
- **Rôle tactique** : Paiement d'une main mono-couleur (56 fixe) ou multi-éléments contre des résistances variées.
- **Tags** : `damage`, `multi_element`, `play_hand`, `draw`
- **Grades** : g1 (niv. 90) : 3 PA, PO 1–6, 1/tour ; g2 (niv. 157) : 3 PA, PO 1–7, 1/tour
- *Infobulle décodée (auto)* :
  - lance « Pioche 4 Cartes » (#29947, rang 1) — cibles : lanceur
  - 4 à 56 dommages Air (CC : 8 à 60 dommages Air) — cibles : alliés (lanceur compris), ennemis [AUCUNE (masque F50000 = affichage seul)] ; non désenvoûtable (sauf mort)
  - 4 à 56 dommages Eau (CC : 8 à 60 dommages Eau) — cibles : alliés (lanceur compris), ennemis [AUCUNE (masque F50000 = affichage seul)] ; non désenvoûtable (sauf mort)
  - 4 à 56 dommages Feu (CC : 8 à 60 dommages Feu) — cibles : alliés (lanceur compris), ennemis [AUCUNE (masque F50000 = affichage seul)] ; non désenvoûtable (sauf mort)
  - 4 à 56 dommages Terre (CC : 8 à 60 dommages Terre) — cibles : alliés (lanceur compris), ennemis [AUCUNE (masque F50000 = affichage seul)] ; non désenvoûtable (sauf mort)
  - lance « Joue la Main » (#29945, rang 1) — cibles : lanceur

#### 22B. Rekop (id 12853, niveau de déblocage 200)

- **Caractéristiques** : **4 PA** · PO 1–6 (modifiable), LdV · 1/tour · CC 10 % · condition : le lanceur a « Main Gagnante » (`HS=5554`)
- **Description officielle** : Utilise la Main Gagnante pour occasionner des dommages : • Carrés ou Suite Royale Couleurs : dommages dans tous les éléments. • Suite Royale d'une Couleur : dommages dans l'élément de la Couleur par Carte. • Suite Royale : dommages dans le meilleur élément. • Paires : dommages dans le meilleur élément par Paires. • Brelans : dommages dans le meilleur élément par Carte du Brelan.  Défausse la Main.
- **Effets** :
  - Nécessite une Main Gagnante. Dommages selon la combinaison (voir tableau) : Carrés/Suite Royale Couleurs dans les 4 éléments, Suite Royale d'une couleur 4 × 14 dans son élément, Suite Royale 54 meilleur élément, Paires 2 × (15 à 36), Brelans 3 × (8 à 18).
  - Défausse la Main (sans la jouer). 4 PA, 1–6 PO modifiable, 1/tour.
- **Rôle tactique** : À lancer AVANT de jouer la main (sinon plus de Main Gagnante) ; garder ensuite une pioche pour la remplir.
- **Tags** : `damage`, `multi_element`, `payoff`
- *Infobulle décodée (auto)* :
  - 8 à 20 dommages Air (CC : 16 dommages Air) — cibles : alliés (lanceur compris), ennemis
  - 8 à 20 dommages Eau (CC : 10 à 23 dommages Eau) — cibles : alliés (lanceur compris), ennemis
  - 8 à 20 dommages Feu (CC : 10 à 23 dommages Feu) — cibles : alliés (lanceur compris), ennemis
  - 8 à 20 dommages Terre (CC : 10 à 23 dommages Terre) — cibles : alliés (lanceur compris), ennemis
  - 8 à 54 dommages du meilleur élément (CC : 10 à 56 dommages du meilleur élément) — cibles : alliés (lanceur compris), ennemis
  - 8 à 36 dommages du meilleur élément (CC : 10 à 37 dommages du meilleur élément) — cibles : alliés (lanceur compris), ennemis
  - lance « Défausse la Main » (#30130, rang 1) — cibles : lanceur

## Invocations

### Chaton Enragé (monstre 5847, grade 3) — Chaton Enragé (Griffe Invocatrice, P16A)

- PA 6, PM 4 (−1 = statique), PV = 66 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 30 / Terre 30 / Feu 30 / Eau 30 / Air 30 ; caractéristiques propres : Force 0, Intelligence 0, Chance 250, Agilité 70
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 66}
- Joue : True ; tacle : True ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 80533) : voir la mécanique correspondante ci-dessus.
- Sorts : Déplacement Félin (#29960, g1), Âme Féline (#12860, g3)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 80], [10, 0.125], [11, 0], [12, 0.125], [13, 12.5], [14, 3.75], [15, 12.5], [19, 1], [23, 1], [25, 0.125]]`

### Chaton Affectueux (monstre 5848, grade 2) — Chaton Affectueux (Caresse Invocatrice, P16B)

- PA 6, PM 4 (−1 = statique), PV = 66 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 30 / Terre 30 / Feu 30 / Eau 30 / Air 30 ; caractéristiques propres : Force 0, Intelligence 300, Chance 0, Agilité 40
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 66}
- Joue : True ; tacle : True ; poussable : True ; échangeable : True ; place d'invocation : True
- Sorts : Pattes de l'Expert (#29959, g1), Mistigri (#12884, g1)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 200], [10, 0.125], [11, 0], [12, 0.125], [13, 18.75], [14, 2.5], [15, 9.375], [19, 1], [23, 1], [25, 0.125]]`

## Rôle en groupe PvM (niveau 200)

### Rôles officiels (DofusDB, valeur /12)

Dégâts 9, Amélioration 7, Soins 6, Entrave 4, Placement 3, Invocation 3, Protection 2, Tank 0

### Rôles retenus pour l'IA de composition

- **dps-hybride-feu-soin** (priorité 1, élément : Feu (Intelligence)) — Langue Râpeuse (croix 1 soin + dommages), Topkaj, Blakjak, Pelotage, Feulement, Péril, Tout ou Rien ; voie la plus jouée selon gamosaurus (portée).
- **dps-poker-multi** (priorité 2, élément : multi-éléments (Bluff, Rekop)) — Remplir la main d'une Suite Royale/Carré puis Bluff (jusqu'à 56 fixe par couleur) et Rekop (jusqu'à 4 × 20 ou 4 × 14) ; buffs de Main Gagnante +140 à +200 caractéristiques.
- **soutien-aleatoire** (priorité 3, élément : indifférent) — Roue de la Fortune (999 % critique aux alliés au contact), Château de Cartes (bouclier jusqu'à 500 % du niveau), Seconde Chance (×0,5 dégâts subis), Neuf Vies (27 % PV max sur 3 tours), Chaton Affectueux (soins).
- **entraveur-secondaire** (priorité 4, élément : Terre) — Lapement (−3 PA ou −3 PM en croix), Mésaventure (−2 PA/PM en anneau), Odorat (−3 PA non esquivables en zone), Prédation (+15 % Érosion).

### Choix des variantes par rôle

| Paire | `ecaflip_feu_hybride` | `ecaflip_air_zone_poussee` | `ecaflip_terre_entrave` |
|---|---|---|---|
| 1 | A — Réflexes | A — Réflexes | B — Lapement |
| 2 | B — Langue Râpeuse | A — Yams | A — Yams |
| 3 | A — Topkaj | A — Topkaj | A — Topkaj |
| 4 | A — Pile ou Face | B — Fanfaronnade | A — Pile ou Face |
| 5 | A — Bonne Pioche | A — Bonne Pioche | A — Bonne Pioche |
| 6 | A — Bond du Félin | B — Entrechat | A — Bond du Félin |
| 7 | A — Jass | A — Jass | A — Jass |
| 8 | A — Perception | B — Prédation | B — Prédation |
| 9 | A — Baraka | B — Toupet | A — Baraka |
| 10 | A — Château de Cartes | A — Château de Cartes | A — Château de Cartes |
| 11 | A — Blakjak | A — Blakjak | B — Destin d'Ecaflip |
| 12 | B — Tarot d'Ecaflip | A — Roulette | A — Roulette |
| 13 | B — Péril | A — Belote | A — Belote |
| 14 | B — Tout ou Rien | A — Tromperie | B — Tout ou Rien |
| 15 | A — Pelotage | B — Griffe de Ceangal | A — Pelotage |
| 16 | B — Caresse Invocatrice | A — Griffe Invocatrice | A — Griffe Invocatrice |
| 17 | B — Kraps | B — Kraps | A — Esprit Félin |
| 18 | B — Roue de la Fortune | B — Roue de la Fortune | A — Odorat |
| 19 | B — Feulement | A — Coussinets | A — Coussinets |
| 20 | B — Neuf Vies | A — Seconde Chance | A — Seconde Chance |
| 21 | A — Félintion | A — Félintion | B — Mésaventure |
| 22 | B — Rekop | A — Bluff | B — Rekop |

- `ecaflip_feu_hybride` : Ecaflip Feu soin/dégâts (groupe) : Langue Râpeuse, Topkaj, Blakjak, Pelotage, Feulement, Péril, Tout ou Rien, Tarot, Roue de la Fortune, Neuf Vies, Rekop.
- `ecaflip_air_zone_poussee` : Ecaflip Air (dégâts, poussées) : Réflexes, Fanfaronnade, Jass, Toupet, Griffe de Ceangal, Coussinets, Kraps, Bluff.
- `ecaflip_terre_entrave` : Ecaflip Terre (entrave) : Lapement, Pile ou Face (contrôle de l'aléatoire), Belote, Esprit Félin, Mésaventure, Destin d'Ecaflip, Odorat, Prédation.

### Rotations types (PA indiqués entre parenthèses, 11–12 PA / 6 PM)

**Ecaflip Feu — tour type (12 PA)** — objectif : Accumuler des Cœurs (Suite Royale de Cœur : Valet Topkaj, Dame Blakjak, Roi Langue Râpeuse, As Péril) puis jouer la main (+140 Intelligence, Blakjak +6, Bluff de Cœur +28).

1. Bonne Pioche (1, remboursé) : pioche 1 carte (ou +1 PA si déjà en main)
2. Langue Râpeuse (4) sur l'ennemi au contact des alliés (soin + dommages en croix) → Roi de Cœur
3. Blakjak (3) → Dame de Cœur (+3 à Blakjak tant qu'elle est en main)
4. Topkaj (2) ×2 (soin ou frappe 16/19/22) → Valet de Cœur
5. Pile ou Face (2) sur soi si Pile/Face utile, sinon Topkaj

**Ecaflip Poker — paiement (12 PA)** — objectif : Burst multi-éléments + buff de Table 3 tours.

1. (Main Gagnante formée) Rekop (4) sur le boss : paie la combinaison puis défausse
2. Redistribution (1, remboursé) : joue la main restante / pioche 4
3. Bluff (3) : dommages fixes selon les couleurs piochées, joue la main
4. Château de Cartes (3) : bouclier selon la nouvelle main

**Ecaflip soutien — tour critique allié (12 PA)** — objectif : Transformer le tour des alliés en tour critique garanti (Iop/Crâ à gros dommages critiques).

1. Tarot (1) en début de tour (arcane global)
2. Roue de la Fortune (3) au contact des alliés → 999 % critique pour leurs tours (attention : les ennemis de la zone auront 999 % au tour suivant)
3. Seconde Chance (2) sur l'allié exposé (×0,5 dégâts subis ce tour)
4. Neuf Vies (3) / Langue Râpeuse (4)

### Synergies

- **DPS à forts Dommages Critiques (Iop, Crâ, Sram, Ouginak)** : Roue de la Fortune : 999 % de critique aux alliés au contact pour leur tour ; Kraps/Yams pour l'Ecaflip lui-même.
- **Eniripsa / Féca** : Double soin/protection : Château de Cartes et Seconde Chance complètent les soins Eniripsa et boucliers Féca.
- **Xélor / Pandawa (placement)** : Les poussées/attirances de l'Ecaflip (Coussinets, Griffe de Ceangal, Toupet, Pelotage) chargent Fanfaronnade et Toupet ; les ennemis regroupés par un placeur subissent Langue Râpeuse, Kraps, Pelotage, Tout ou Rien.
- **Enutrof / Sram (entrave)** : Lapement/Mésaventure (avec Pile ou Face pour choisir PA ou PM) + Odorat complètent l'entrave.

### Notes pour la démo « Œil de Vortex »

- Seconde Chance (×0,5 dégâts subis) sur l'allié qui sera dans la ligne de l'Auroraire au tour du Vortex (« En temps et en heure » : 500 Terre + 50 % des PV érodés) ; Château de Cartes en complément (docs/research/vortex.md §0).
- Roue de la Fortune avant le tour de vulnérabilité du Vortex (phase 2) : 999 % de critique pour les alliés au contact ; ne pas inclure de monstres dans le cercle (ils auraient 999 % au tour suivant).
- Roulette/Tarot affectent aussi les monstres (et le Vortex) : à éviter quand plusieurs monstres jouent avant les alliés.
- Faiblesses des monstres de vague (grade 5) : Ikargn Feu −10 %, Méjaire Terre −10 %, Buboxor Air −10 %, Brabuzar Eau −10 % : Tromperie/Bluff/Rekop multi-éléments permettent de viser l'élément faible.

### Forces

- Hybride dégâts/soins à moyenne portée (Feu surtout), chaque sort élémentaire nourrit la Main.
- Gros buffs auto-générés (Main Gagnante jusqu'à +200 dans les 4 caractéristiques ou +180 Puissance, 3 tours).
- Outils de soutien uniques : 999 % critique (Roue de la Fortune), ×0,5 dégâts subis (Seconde Chance), boucliers (Château de Cartes).
- Économie de PA : Bonne Pioche/Redistribution/Roulette gratuits, Pile ou Face, Tarot (−1 PA sur des familles de sorts).

### Faiblesses

- Variance : Pioche aléatoire, Tarot/Roulette globaux (bénéficient aussi aux ennemis), Tromperie, Yams (3–18).
- Planification lourde (main à 4 cartes, cartes uniques, priorités de combinaisons) — IA complexe.
- Plusieurs sorts touchent les alliés (masque g,A : Réflexes, Lapement, Yams, Fanfaronnade, Jass, Baraka, Blakjak ; a,A : Griffe Joueuse, Infortune, Péril).
- Roue de la Fortune donne 999 % de critique aux ENNEMIS de la zone au tour suivant.

## États importants

| État | Nom (données) | Rôle |
|---|---|---|
| #5601 | Main | Main (au moins une carte en main) — condition de Château de Cartes |
| #5461 | 1 Carte | 1 Carte |
| #5462 | 2 Cartes | 2 Cartes |
| #5463 | 3 Cartes | 3 Cartes |
| #5464 | 4 Cartes | 4 Cartes (Main pleine : plus de pioche) |
| #5554 | Main Gagnante | Main Gagnante — condition de Rekop |
| #5465 | Pique | Pique (au moins une carte Pique) |
| #5466 | Trèfle | Trèfle |
| #5467 | Cœur | Cœur |
| #5468 | Carreau | Carreau |
| #5440 | Valet de Pique | Valet de Pique (en main) |
| #5442 | Dame de Pique | Dame de Pique |
| #5443 | Roi de Pique | Roi de Pique |
| #5457 | As de Pique | As de Pique |
| #5444 | Valet de Trèfle | Valet de Trèfle |
| #5446 | Dame de Trèfle | Dame de Trèfle |
| #5447 | Roi de Trèfle | Roi de Trèfle |
| #5458 | As de Trèfle | As de Trèfle |
| #5448 | Valet de Cœur | Valet de Cœur |
| #5450 | Dame de Cœur | Dame de Cœur |
| #5451 | Roi de Cœur | Roi de Cœur |
| #5459 | As de Cœur | As de Cœur |
| #5452 | Valet de Carreau | Valet de Carreau |
| #5454 | Dame de Carreau | Dame de Carreau |
| #5455 | Roi de Carreau | Roi de Carreau |
| #5460 | As de Carreau | As de Carreau |
| #5645 | Valet de Pique | Valet de Pique sur la Table (5645–5660 : cartes sur la Table) |
| #6068 | Table | Table (au moins une carte jouée) |
| #5597 | Pile | Pile |
| #5598 | Face | Face |
| #579 | Tromperie Terre | Tromperie Terre |
| #580 | Tromperie Feu | Tromperie Feu |
| #581 | Tromperie Air | Tromperie Air |
| #582 | Tromperie Eau | Tromperie Eau |
| #5620 | I. Le Magicien | I. Le Magicien (5620–5641 : arcanes du Tarot, 1 tour, sur toutes les entités) |

## Points incertains

- INCERTAIN — Déclencheurs de Fanfaronnade (passif #30079 : +4/+6 dégâts de base par déplacement) et du re-tirage de Tromperie sur coup critique : non présents dans les données (serveur).
- INCERTAIN — Arcanes : quelques effets dépendent d'interactions difficiles à lire (0 Le Fou : téléportation aléatoire d'1 case en fin de tour ; IX L'Ermite : soin 15 % si aucune entité en ligne de vue ; VI Les Amoureux : soin 10 % si un allié est au contact ; XV Le Diable : +50 Puissance par carte piochée).
- INCERTAIN — XII Le Pendu : affichage « 20 à 50 Puissance » vs effet réel +70/80/90/100 Puissance par carte de la Table (si aucune Main Gagnante) — données réelles retenues.
- INCERTAIN — Rekop, Paires de Valets et de Dames : CC 11 < normal 15 dans les données (probable coquille Ankama).
- INCERTAIN — PV des Chatons : bonusCharacteristics.lifePoints = 66 interprété comme 66 % des PV de l'Ecaflip.
- INCERTAIN — globalCooldown = −1 (Odorat, Seconde Chance) : aucune relance globale (mechanics.md §4.4).

## Sources

- https://api.dofusdb.fr/breeds/6
- https://api.dofusdb.fr/spell-variants?breedId=6
- https://api.dofusdb.fr/spells?id[$in][]=12857 (… 44 sorts) et sous-sorts liés (cartes #29675–#29761, mains #29810–#30091, arcanes #30003–#30024)
- https://api.dofusdb.fr/spell-levels?spellId[$in][]=12857 (… 91 niveaux)
- https://api.dofusdb.fr/spells/30082 (Pioche), /29994 (Mains Gagnantes), /30079 et spell-levels/79945–79946 (passif Fanfaronnade)
- https://api.dofusdb.fr/monsters/5847, /5848 (Chatons)
- https://www.gamosaurus.com/?p=219354 (refonte Ecaflip 2.72 : Pioche par coût/élément, Main de 4 cartes, Table 3 tours, Tarot 22 arcanes)
- https://www.gamosaurus.com/jeux/dofus/dofus-unity-guide-du-stuff-ecaflip (guide Dofus Unity, modifié le 2 octobre 2025 : voie Feu la plus jouée, Rekop multi-éléments)
- docs/research/effects.md, data/research/effect-semantics.json, data/research/zone-and-mask-grammar.json (groupes aléatoires)
