# Sram (classe 4) — analyse complète pour le simulateur

> Données : API DofusDB (`/breeds/4`, `/spell-variants?breedId=4`, `/spells`, `/spell-levels`, `/spell-states`),
> fichiers du jeu Dofus 3 mis à jour le 2026-06-23, extraits le 2026-10-04. Valeurs = grade le plus élevé utilisable au
> niveau 200. Fichier machine : [`data/research/class-mechanics/sram.json`](../../../data/research/class-mechanics/sram.json).

**Identité** : « Assassin » (complexité 2/4). Rôles officiels (`breedRoles`, /12) : Dommages 10 (« pose des pièges et peut
empoisonner ses adversaires »), Placement 7 (« pousse et attire avec ses sorts et ses pièges »), Entrave 6 (« vole des
caractéristiques et ralentit ses adversaires avec ses sorts, ses pièges et son double »), puis boost 3, soin 2, tank 2.

**Résumé tactique** : DPS polyvalent (4 éléments) qui frappe par trois canaux : **pièges** (invisibles pour l'ennemi,
déclenchés à l'entrée dans leur zone, ne font jamais de coup critique, boostés par Puissance/Dommages pièges), **poisons**
(début/fin de tour, propagation d'Épidémie) et **coups directs** (vols de caractéristiques, Attaque Mortelle, Perfidie,
Chausse-trappe). Chaque piège déclenché alimente des compteurs (Chausse-trappe, Perfidie, Marque Mortuaire, Comploteur,
Injection Toxique). L'**invisibilité** (sort ou Brume) et le **Double** lui donnent survie et repositionnement.

## Sommaire

- Tableau des 22 paires · Efficacité brute · Mécaniques spécifiques · Détail de tous les sorts · Rôle en groupe PvM (variantes, rotations, synergies) · Points incertains · Sources

## Tableau des 22 paires de sorts (variantes)

Chaque ligne est une paire de variantes : à un instant donné, un personnage n'équipe qu'**un seul** sort de chaque paire (choix hors combat). Le niveau indiqué est celui du déblocage du grade 1.

| # | Variante A | PA | Variante B | PA | Notes |
|---|---|---|---|---|---|
| 1 | Truanderie (12902, niv. 1) | 3 | Chausse-trappe (12932, niv. 95) | 4 | Chausse-trappe (+8 par piège déclenché, jusqu'à +40) pour la voie Terre pièges ; Truanderie (vol de 80 Puissance) sinon. |
| 2 | Sournoiserie (12904, niv. 1) | 3 | Coupe-gorge (12935, niv. 100) | 4 | Coupe-gorge (×110 % dommages subis) pour l'équipe ; Sournoiserie (repousse 3) pour pousser dans les pièges. |
| 3 | Arsenic (12907, niv. 1) | 3 | Toxines (12933, niv. 105) | 3 | Arsenic (−2 PO + poison début de tour) polyvalent ; Toxines pour un Sram poison-pièges. |
| 4 | Cruauté (12919, niv. 1) | 3 | Poisse (12922, niv. 110) | 4 | Cruauté (+1 PM) en DPS ; Poisse (soigne les alliés autour) en utilitaire. |
| 5 | Invisibilité (12913, niv. 5) | 2 | Brume (12930, niv. 115) | 3 | Invisibilité (2 PA, +2 PM) quasi systématique ; Brume pour cacher tout le groupe. |
| 6 | Double (12915, niv. 10) | 3 | Comploteur (12936, niv. 120) | 3 | Comploteur (explosion boostée par les pièges) en Terre pièges ; Double (+2 PM, échange) sinon. |
| 7 | Piège Sournois (12906, niv. 15) | 2 | Guet-apens (12939, niv. 125) | 3 | Piège Sournois (attire vers son centre) ; Guet-apens (vol Eau + attire vers le double). |
| 8 | Piège Fangeux (12916, niv. 20) | 3 | Épidémie (12943, niv. 130) | 4 | Épidémie (poison qui se propage) en Air ; Piège Fangeux (−2 PM) sinon. |
| 9 | Piège Funeste (12948, niv. 25) | 3 | Effraction (14742, niv. 135) | 2 | Piège Funeste (+20 par ennemi proche) ; Effraction (vol de rés. poussée) pour un build poussée. |
| 10 | Piège Répulsif (12914, niv. 30) | 2 | Piège Effroyable (12920, niv. 140) | 2 | Piège Effroyable (mono-cellule, effets en croix 3) ou Répulsif (croix 1) selon la carte. |
| 11 | Piège d'Immobilisation (12910, niv. 35) | 3 | Fosse Commune (14314, niv. 145) | 3 | Piège d'Immobilisation (−4 PM en cercle 3) : entrave de zone ; Fosse Commune (Pesanteur) contre les téléporteurs. |
| 12 | Extorsion (12938, niv. 40) | 3 | Perquisition (12947, niv. 150) | 2 | Extorsion (vol 100 Force + vol de vie Terre) en Terre ; Perquisition (repousse depuis le double). |
| 13 | Arnaque (12911, niv. 45) | 3 | Larcin (12937, niv. 155) | 4 | Arnaque (vol 100 Agilité + vol de vie Air) en Air ; Larcin (érosion 13 % + Eau en zone). |
| 14 | Pillage (12934, niv. 50) | 3 | Attaque Mortelle (12917, niv. 160) | 4 | Attaque Mortelle (54–60 sous 50 % PV) en Terre ; Pillage (vol 100 Chance) en Eau. |
| 15 | Fourberie (12905, niv. 55) | 4 | Injection Toxique (12940, niv. 165) | 5 | Injection Toxique (poison 28–32 ×3 tours + −1 PM) presque toujours ; Fourberie en Feu. |
| 16 | Peur (12908, niv. 60) | 2 | Méprise (12945, niv. 170) | 3 | Peur (pousse jusqu'à la case) indispensable pour les pièges ; Méprise (échange) pour la mobilité. |
| 17 | Piège de Dérive (12942, niv. 65) | 2 | Piège Insidieux (12918, niv. 175) | 2 | Piège Insidieux (poison) en Air ; Piège de Dérive (Feu, repousse) sinon. |
| 18 | Piège Scélérat (12931, niv. 70) | 2 | Piège à Fragmentation (12941, niv. 180) | 4 | Piège à Fragmentation (jusqu'à 47–51 en anneau 3) en burst ; Piège Scélérat (attire 3) pour regrouper. |
| 19 | Concentration de Chakra (12903, niv. 75) | 3 | Manigance (14741, niv. 185) | 2 | Manigance (+20 Dommages/Fuite alliés, vol aux ennemis) ; Concentration de Chakra (vol à chaque dégât de piège). |
| 20 | Piège Mortel (12921, niv. 80) | 3 | Calamité (12950, niv. 190) | 4 | Piège Mortel (49–54 sous 50 % PV) ; Calamité (40–44 Eau en carré + vol Fuite). |
| 21 | Fourvoiement (12909, niv. 85) | 4 | Perfidie (12949, niv. 195) | 6 | Perfidie (56–60 au contact, coût réduit par les pièges) en Terre ; Fourvoiement (Air, érosion) en Air. |
| 22 | Dérobade (14312, niv. 90) | 2 | Marque Mortuaire (14313, niv. 200) | 2 | Marque Mortuaire (×110 % + 30 % érosion au palier IV) pour l'équipe ; Dérobade pour protéger un allié. |

## Efficacité brute des sorts de dommages (grade niveau 200, avant caractéristiques)

Moyenne des dommages de base de la première ligne de dommages directs divisée par le coût en PA (indicatif ; ne tient compte ni des zones, ni des effets secondaires, ni des sous-sorts). `+` = portée modifiable. Lancers/tour `∞` = pas de limite autre que les PA/relance.

| Sort | Paire | Élément | PA | Base | Base CC | Moy./PA | PO | Lancers/tour | Relance | Zone |
|---|---|---|---|---|---|---|---|---|---|---|
| Piège Mortel | 20A | Terre | 3 | 39–43 | 39–43 | 13.7 | 1–8+ | 2 | 0 | case ciblée (piège) |
| Piège à Fragmentation | 18B | Feu | 4 | 47–51 | 47–51 | 12.2 | 1–6+ | 1 | 0 | case ciblée (piège) |
| Piège Fangeux | 8A | Eau | 3 | 33–37 | 33–37 | 11.7 | 1–6+ | 2 | 0 | case ciblée (piège) |
| Attaque Mortelle | 14B | Terre | 4 | 43–48 | 52–58 | 11.4 | 1–2 | 3 | 0 | case ciblée |
| Piège Effroyable | 10B | Terre | 2 | 20–22 | 20–22 | 10.5 | 1–7+ | 2 | 0 | croix de taille 3 (piège) |
| Calamité | 20B | Eau | 4 | 40–44 | 40–44 | 10.5 | 1–8+ | 1 | 0 | carré de taille 1 (piège) |
| Piège Funeste | 9A | Terre | 3 | 28–32 | 28–32 | 10.0 | 1–6+ | 2 | 0 | case ciblée (piège) |
| Sournoiserie | 2A | Feu | 3 | 28–31 | 34–37 | 9.8 | 1–8 | 3 | 0 | case ciblée |
| Perfidie | 21B | Terre | 6 | 56–60 | 62–66 | 9.7 | 1–1 | 3 | 0 | case ciblée |
| Extorsion | 12A | Terre | 3 | 27–30 | 32–36 | 9.5 | 1–3 | 3 | 0 | case ciblée |
| Truanderie | 1A | Terre | 3 | 26–29 | 31–35 | 9.2 | 1–6+ | 3 | 0 | case ciblée |
| Pillage | 14A | Eau | 3 | 26–29 | 31–35 | 9.2 | 1–4 | 3 | 0 | case ciblée |
| Coupe-gorge | 2B | Feu | 4 | 34–38 | 40–44 | 9.0 | 1–7 | 3 | 0 | case ciblée |
| Poisse | 4B | Eau | 4 | 34–38 | 41–46 | 9.0 | 1–5+ | 1 | 0 | case ciblée |
| Piège Sournois | 7A | Feu | 2 | 17–19 | 17–19 | 9.0 | 1–8+ | 1 | 0 | croix de taille 1 (piège) |
| Larcin | 13B | Eau | 4 | 34–38 | 41–46 | 9.0 | 0–4 | 2 | 0 | croix diagonale de taille 1 |
| Piège de Dérive | 17A | Feu | 2 | 17–19 | 17–19 | 9.0 | 1–6+ | 2 | 0 | croix diagonale de taille 1 (piège) |
| Piège Scélérat | 18A | Eau | 2 | 17–19 | 17–19 | 9.0 | 1–7+ | 2 | 0 | croix de taille 3 (piège) |
| Arnaque | 13A | Air | 3 | 25–28 | 30–34 | 8.8 | 1–6 | 3 | 0 | case ciblée |
| Fourvoiement | 21A | Air | 4 | 32–36 | 38–43 | 8.5 | 0–5 | 2 | 0 | croix sans centre de taille 1 |
| Effraction | 9B | Feu | 2 | 15–17 | 19–21 | 8.0 | 1–6 | 3 | 0 | case ciblée |
| Cruauté | 4A | Eau | 3 | 22–25 | 26–30 | 7.8 | 0–8+ | 3 | 0 | case ciblée |
| Guet-apens | 7B | Eau | 3 | 22–25 | 27–30 | 7.8 | 0–6+ | 3 | 0 | case ciblée |
| Piège Répulsif | 10A | Air | 2 | 14–17 | 14–17 | 7.8 | 1–7+ | 2 | 0 | croix de taille 1 (piège) |
| Chausse-trappe | 1B | Terre | 4 | 28–32 | 34–38 | 7.5 | 1–4 | 3 | 0 | case ciblée |
| Fourberie | 15A | Feu | 4 | 27–31 | 32–37 | 7.2 | 0–3 | 2 | 0 | anneau de taille 2 |
| Perquisition | 12B | Feu | 2 | 13–15 | 16–18 | 7.0 | 0–6 | 3 | 0 | case ciblée |
| Injection Toxique | 15B | Air | 5 | 28–32 | 34–38 | 6.0 | 1–5 | 1 | 5 | case ciblée (poison début de tour ×3) |
| Arsenic | 3A | Air | 3 | 16–18 | 19–22 | 5.7 | 1–8+ | 3 | 0 | case ciblée (poison début de tour ×2) |
| Piège Insidieux | 17B | Air | 2 | 8–9 | 8–9 | 4.2 | 1–6+ | 1 | 0 | croix diagonale de taille 1 (piège) |

Vérification croisée avec les gabarits de dégâts de DoMath (`.cache/domath/spell-templates.json`) : **17 sorts identiques**, 0 écart(s), 0 absent(s) de DoMath.

## Mécaniques spécifiques à implémenter

### 1. Pièges (effet 400 « Pose un piège »)
- Pose sur une **case libre et sans piège** (`needFreeCell`, `needFreeTrapCell`), le plus souvent **sans ligne de vue**.
- La **zone de déclenchement** est la zone de l'effet 400 (ex. Piège Sournois : croix 1 ; Piège Répulsif : croix 1 ;
  Piège de Dérive / Insidieux : croix diagonale 1 ; Piège d'Immobilisation : cercle 3 ; Calamité : carré 1). Les pièges
  « mono-cellule » (Fangeux, Funeste, Effroyable, Fosse Commune, Scélérat, Fragmentation, Mortel) n'ont que leur case.
- Déclenchement : quand une entité (ennemie **ou alliée**) entre dans une case de la zone — en marchant (son déplacement
  s'arrête), ou en y étant poussée/attirée/téléportée (règle générale Dofus ; détail à confirmer par le module de règles).
  Les effets du sous-sort du piège sont alors appliqués **depuis la case centrale du piège** avec sa propre zone
  (ex. Piège Effroyable : 1 case de déclenchement, effets en croix 3).
- Les pièges sont invisibles pour l'adversaire (l'IA des monstres ne les évite pas) et visibles pour les alliés. Ils durent
  jusqu'à leur déclenchement (durée de vie maximale : INCERTAIN). Un piège ne fait **jamais de coup critique** (sous-sorts
  à 0 % CC) ; ses dommages profitent de *Puissance pièges* (stat 69) et *Dommages pièges* (stat 70), et sont des dommages
  « de piège » (déclencheur `DT` côté cible).
- Chaque piège déclenché lance le sous-sort caché **« Pièges » (12968)** sur le Sram, qui met à jour les compteurs :
  Chausse-trappe (+8 dommages de base, 5 cumuls → +40), Perfidie (−1 PA, 4 cumuls → 6 PA → 2 PA), Marque Mortuaire
  (paliers I→IV), Injection Toxique (−1 tour de relance), Comploteur (+8 dommages de base à l'explosion du double).
  Les compteurs de Chausse-trappe, Perfidie et Marque Mortuaire sont **remis à zéro quand le sort est lancé**.
- **États « de deck »** : chaque branche du sous-sort « Pièges » est conditionnée par un état porté par le Sram
  (3762 Marque Mortuaire, 3763 Chausse-trappe, 3764 Comploteur, 3765 Perfidie, 3766 Injection Toxique ; de même 2763/2764
  « Toxines rang 1/2 » et 6050/6051 « Épidémie double rang 1/2 »). Aucun effet de sort ne pose ces états dans les données :
  ils sont vraisemblablement appliqués automatiquement en début de combat lorsque le sort correspondant est équipé (scripts
  `boundScriptUsageData` non exposés par l'API) — **INCERTAIN**. Le moteur doit les poser au début du combat selon les
  variantes choisies, sinon les compteurs ne progressent jamais.
- Masques des pièges : la plupart des dommages ne touchent que les **ennemis**, mais Piège Fangeux (−2 PM), Piège Mortel,
  Piège à Fragmentation (anneaux) et les poussées/attirances touchent **tout le monde** : attention aux alliés.

### 2. Poisons
| Sort | Déclencheur | Durée | Dégâts (rang 2 / grade max) | Particularité |
|---|---|---|---|---|
| Arsenic | début de tour (`TB`) | 2 tours | 16–18 Air (CC 19–22) | −2 PO, sans LdV, en ligne |
| Injection Toxique | début de tour | 3 tours | 28–32 Air (CC 34–38) | −1 PM 3 tours, relance 5 réduite par les pièges |
| Toxines | fin de tour (`TE`) | 2 tours | 7–9 Air, puis 13–15 / 19–21 / 25–27 / 31–33 / 37–39 à chaque réapplication (rang 2 ; rang 1 : 5–7 → 30–32) | réappliqué et augmenté (5 cumuls) quand la cible subit des dommages de piège, 1 fois/tour |
| Épidémie | fin de tour | 1 tour | 36–40 Air | se **propage** aux ennemis en cercle 2 autour de la cible à la fin de son tour (état 667) ; le Sram et son double peuvent servir de relais |
| Piège Insidieux | fin de tour | 1 tour | 8–9 Air (+ 8–9 immédiat) | pièges croix diagonale 1 |
- Les poisons sont des buffs à déclenchement `TB`/`TE` dont la durée réelle est `effectTriggerDuration` ; leurs dommages
  utilisent les caractéristiques du Sram au moment du déclenchement (INCERTAIN : au moment de la pose ?).
- Toxines dépend d'états de rang posés sur le lanceur (2763 « rang 1 », 2764 « rang 2 ») : au niveau 200 (grade 2) on
  prend les valeurs du rang 2 (origine exacte de ces états : INCERTAIN).

### 3. Invisibilité
- Effet 150 (« Rend la cible invisible ») : Invisibilité (1 tour, n'importe quelle cible, +2 PM aux alliés, relance 3 remise à
  zéro quand le Sram achève un combattant, relance globale 1), Brume (glyphe-aura cercle 3, 2 tours : alliés invisibles,
  ennemis −4 PO), Tunnel de Fortune (Enutrof).
- Une entité invisible ne peut pas être ciblée directement par l'ennemi (sorts monocibles à besoin de cible visible) mais
  reste touchée par les zones ; lancer un sort révèle brièvement sa case (règle générale Dofus). Méprise, Marque
  Mortuaire et Concentration de Chakra **dissipent l'invisibilité du lanceur**. Les Lanternes Féca et le Coffre Animé
  Enutrof révèlent les invisibles. Pour l'IA monstre : cibler la dernière position connue ou frapper en zone.

### 4. Double et Comploteur (effet 180)
- Effet 180 `CharacterAddDoubleUseSummonSlot` : invoque une **copie contrôlable** du Sram (mêmes caractéristiques ; utilise
  un emplacement d'invocation), qui n'attaque pas (états 611/705 « Double », 6052 « Double invoqué » sur le Sram).
- **Double** : à la fin de son 2e tour, il échange sa position avec le Sram (sauf Pesanteur) et donne +2 PM au Sram (1 tour),
  puis meurt. **Comploteur** : meurt à la fin de son 3e tour en infligeant 26–30 (meilleur élément) aux entités au contact,
  +8 dommages de base par piège déclenché depuis son invocation.
- Interactions : Guet-apens attire la cible **vers le double**, Perquisition repousse **depuis le double**, Méprise échange
  la cible **avec le double**, Épidémie se propage via le double ; si le double est présent, ces sorts changent de centre.

### 5. Vols de caractéristiques et érosion
- Vols (effets 266–271, 3 tours, cumulables 2 fois) : Truanderie (80 Puissance), Extorsion (100 Force), Arnaque (100 Agilité),
  Pillage (100 Chance), Fourberie (100 Intelligence) ; Manigance (±20 Fuite et Dommages), Effraction (30 rés. poussée),
  Calamité (20 Fuite). Le Sram gagne ce que la cible perd (si le vol est esquivé/limité : INCERTAIN).
- Érosion (effet 776) : Larcin et Fourvoiement 13 % (2 tours), Marque Mortuaire 10 % → 30 % selon les pièges déclenchés.
  L'érosion transforme une partie des dommages subis en perte de PV max (règle générale ; module de calcul).

### 6. Amplificateurs de dommages pour l'équipe
- Coupe-gorge : dommages subis ×110 % (1 tour) ; Marque Mortuaire : ×102 % à ×110 % + érosion (2 tours) ; Manigance :
  +20 Dommages aux alliés ; Poisse : les alliés autour de l'ennemi sont soignés de 50 % des dommages qu'il subit ensuite.

### 7. Placement
Sournoiserie (repousse 3), Peur (pousse l'entité adjacente jusqu'à la case ciblée — effet 783, cible à 1 case du lanceur),
Méprise (échange), Guet-apens (attire 2), Perquisition (repousse 2), Piège Sournois/Scélérat (attirent vers le centre),
Piège Répulsif/Dérive/Effroyable (repoussent), Dérobade (l'allié recule de 2 quand il est frappé). Combo classique :
poser un piège mono-cellule puis **Peur / Sournoiserie / Guet-apens** pour pousser ou tirer l'ennemi dedans.

## Détail de tous les sorts (grade utilisable au niveau 200)

Légende : « Effets (infobulle) » = ce que le joueur lit en jeu (valeurs de base, `CC` = coup critique). « Mécanique réelle » = effets réellement exécutés (`forClientOnly = false`), avec les sous-sorts cachés développés une seule fois par document. Les effets d'infobulle marqués côté données `forClientOnly = true` **ne doivent pas être exécutés** par le moteur : ils ne servent qu'à l'affichage, la logique passe par les sous-sorts.

### Paire 1 : Truanderie / Chausse-trappe

> Choix : Chausse-trappe (+8 par piège déclenché, jusqu'à +40) pour la voie Terre pièges ; Truanderie (vol de 80 Puissance) sinon.

#### 1A. Truanderie (id 12902)

- **3 PA** · PO 1–6 (modifiable) · LdV requise, cible requise (case occupée) · 3/tour, 2/cible · CC 15 % · élément(s) : Terre
- Grades : g1 niv.1 dmg 15–17 PO1-4 ; g2 niv.66 dmg 20–23 PO1-5 ; g3 niv.132 dmg 26–29 (grade utilisé : 3).
- Description du jeu : « Vole de la Puissance et occasionne des dommages Terre. »
- Effets (infobulle, valeurs de base) :
  - -80 Puissance — 3 tour(s)
  - 80 Puissance — cibles : lanceur ; 3 tour(s)
  - 26 à 29 dommages Terre (CC : 31 à 35 dommages Terre)
- **Rôle tactique** : 3 PA, cible requise : vole 80 Puissance (3 tours, cumulable 2) + 26–29 Terre. Monte la Puissance du Sram de 160 sur 2 lancers.
- Tags : `damage`, `steal_stat`, `earth`

#### 1B. Chausse-trappe (id 12932)

- **4 PA** · PO 1–4 (non modifiable) · LdV requise, cible requise (case occupée) · 3/tour, 2/cible · CC 20 % · élément(s) : Terre
- Grades : g1 niv.95 dmg 23–26 ; g2 niv.162 dmg 28–32 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Terre. Les dommages du sort sont augmentés pour chaque piège déclenché du lanceur. Les effets sont retirés après utilisation du sort. »
- Effets (infobulle, valeurs de base) :
  - 28 à 32 dommages Terre (CC : 34 à 38 dommages Terre)
  - «Chausse-trappe» : +8 dommages de base — cibles : lanceur ; durée infinie ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 28 à 32 dommages Terre (CC : 34 à 38 dommages Terre)
  - retire les effets du sort «Chausse-trappe» (12971) — cibles : lanceur
- **Rôle tactique** : 4 PA au contact proche (1–4) : 28–32 Terre +8 dommages de base par piège déclenché (5 cumuls, +40), compteur remis à 0 après le lancer.
- Tags : `damage`, `burst`, `earth`, `trap_synergy`

### Paire 2 : Sournoiserie / Coupe-gorge

> Choix : Coupe-gorge (×110 % dommages subis) pour l'équipe ; Sournoiserie (repousse 3) pour pousser dans les pièges.

#### 2A. Sournoiserie (id 12904)

- **3 PA** · PO 1–8 (non modifiable) · en ligne, LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Feu
- Grades : g1 niv.1 dmg 17–19 PO1-6 ; g2 niv.67 dmg 22–24 PO1-7 ; g3 niv.133 dmg 28–31 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Feu aux ennemis et repousse la cible. »
- Effets (infobulle, valeurs de base) :
  - 28 à 31 dommages Feu (CC : 34 à 37 dommages Feu) — cibles : ennemis
  - Repousse de 3 cases — cibles : ennemis, alliés (lanceur inclus)
- **Rôle tactique** : 3 PA en ligne : 28–31 Feu + repousse 3 : pousser un ennemi dans un piège ou l'éloigner.
- Tags : `damage`, `placement`, `fire`

#### 2B. Coupe-gorge (id 12935)

- **4 PA** · PO 1–7 (non modifiable) · LdV requise, cible requise (case occupée) · 3/tour, 2/cible · CC 20 % · élément(s) : Feu
- Grades : g1 niv.100 dmg 30–33 PO1-6 ; g2 niv.167 dmg 34–38 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Feu et augmente les dommages subis par la cible. »
- Effets (infobulle, valeurs de base) :
  - 34 à 38 dommages Feu (CC : 40 à 44 dommages Feu)
  - Dommages subis x110% — déclenchement : quand le porteur subit des dommages (buff 1 t.)
- **Rôle tactique** : 4 PA : 34–38 Feu et dommages subis ×110 % (1 tour) sur la cible : amplificateur de groupe.
- Tags : `damage`, `debuff`, `fire`, `team_amp`

### Paire 3 : Arsenic / Toxines

> Choix : Arsenic (−2 PO + poison début de tour) polyvalent ; Toxines pour un Sram poison-pièges.

#### 3A. Arsenic (id 12907)

- **3 PA** · PO 1–8 (modifiable) · en ligne, sans LdV · 3/tour, 1/cible · CC 15 % · élément(s) : Air
- Grades : g1 niv.1 PO1-6 ; g2 niv.68 PO1-7 ; g3 niv.134 (grade utilisé : 3).
- Description du jeu : « Retire de la Portée et applique un poison Air de début de tour sur la cible. »
- Effets (infobulle, valeurs de base) :
  - -2 Portée — 2 tour(s)
  - 16 à 18 dommages Air (CC : 19 à 22 dommages Air) — déclenchement : début de tour du porteur (buff 2 t.)
- **Rôle tactique** : 3 PA en ligne sans LdV, 1/cible : −2 PO (2 tours) et poison 16–18 Air au début des 2 prochains tours de la cible.
- Tags : `poison`, `range_removal`, `air`

#### 3B. Toxines (id 12933)

- **3 PA** · PO 1–7 (modifiable) · LdV requise · 1/tour · CC 0 % · élément(s) : Air
- Grades : g1 niv.105 PO1-6 ; g2 niv.172 (grade utilisé : 2).
- Description du jeu : « Applique un poison Air de fin de tour sur l'ennemi ciblé. Les dommages du sort sont augmentés (cumulable 5 fois) et le poison est réappliqué tant qu'il est actif et que la cible subit des dommages de pièges Cet effet ne peut être déclenché qu'une seule fois par tour. »
- Effets (infobulle, valeurs de base) :
  - 7 à 9 dommages Air — cibles : ennemis ; déclenchement : fin de tour du porteur (buff 2 t.)
  - «Toxines» : +6 dommages de base — cibles : lanceur ; durée infinie
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Toxines» (28739, grade 1) — cibles : ennemis
    - *Sous-sort «Toxines» (id 28739, grade 1)*
      - retire les effets du sort «Toxines» (28739) — cibles : ennemis
      - 5 à 7 dommages Air — cibles : ennemis ; si le lanceur a l'état «Toxines rang 1» (2763) ; déclenchement : fin de tour du porteur (buff 2 t.)
      - 7 à 9 dommages Air — cibles : ennemis ; si le lanceur a l'état «Toxines rang 2» (2764) ; déclenchement : fin de tour du porteur (buff 2 t.)
      - le lanceur lance le sort «Toxines» (28739, grade 2) — cibles : ennemis ; déclenchement : quand le porteur subit des dommages de piège (buff 2 t.)
        - *Sous-sort «Toxines» (id 28739, grade 2)*
          - le lanceur lance le sort «Toxines» (28739, grade 3) — cibles : ennemis ; si la cible n'a pas l'état «Toxines réappliquées» (612)
            - *Sous-sort «Toxines» (id 28739, grade 3)*
              - applique l'état «Toxines I» (5194) — cibles : ennemis ; 2 tour(s)
              - 10 à 12 dommages Air — cibles : ennemis ; si le lanceur a l'état «Toxines rang 1» (2763) ; déclenchement : fin de tour du porteur (buff 2 t.)
              - 13 à 15 dommages Air — cibles : ennemis ; si le lanceur a l'état «Toxines rang 2» (2764) ; déclenchement : fin de tour du porteur (buff 2 t.)
              - applique l'état «Toxines réappliquées» (612) — cibles : ennemis ; 1 tour(s) ; indésenvoûtable
              - le lanceur lance le sort «Toxines» (28739, grade 4) — cibles : ennemis ; déclenchement : quand le porteur subit des dommages de piège (buff 2 t.)
- **Rôle tactique** : 3 PA, 1/tour : poison Air de fin de tour (2 tours) qui s'intensifie et se réapplique quand la cible subit des dégâts de piège (5 cumuls).
- Tags : `poison`, `air`, `trap_synergy`

### Paire 4 : Cruauté / Poisse

> Choix : Cruauté (+1 PM) en DPS ; Poisse (soigne les alliés autour) en utilitaire.

#### 4A. Cruauté (id 12919)

- **3 PA** · PO 0–8 (modifiable) · LdV requise, cible requise (case occupée) · 3/tour, 2/cible · CC 15 % · élément(s) : Eau
- Grades : g1 niv.1 dmg 13–15 PO0-6 ; g2 niv.69 dmg 18–20 PO0-7 ; g3 niv.136 dmg 22–25 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages Eau et augmente les PM du lanceur. Les dommages n'affectent pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 22 à 25 dommages Eau (CC : 26 à 30 dommages Eau) — cibles : alliés (hors lanceur), ennemis
  - 1 PM — cibles : lanceur ; 1 tour(s)
- **Rôle tactique** : 3 PA, cible requise : 22–25 Eau (pas sur le lanceur) et +1 PM au Sram, 3/tour.
- Tags : `damage`, `water`, `self_mp`

#### 4B. Poisse (id 12922)

- **4 PA** · PO 1–5 (modifiable) · LdV requise · 1/tour · CC 20 % · élément(s) : Eau
- Grades : g1 niv.110 dmg 29–32 PO1-4 ; g2 niv.177 dmg 34–38 (grade utilisé : 2).
- Description du jeu : « Vole de la vie dans l'élément Eau et minimise les effets aléatoires de l'ennemi ciblé. Soigne également les alliés (hors lanceur) selon les dommages occasionnés à l'ennemi ciblé en zone. La minimisation des effets ne fonctionne qu'un tour sur deux sur une même cible. »
- Effets (infobulle, valeurs de base) :
  - 34 à 38 vol Eau (CC : 41 à 46 vol Eau)
  - Soin : 50% des dommages occasionnés — cibles : alliés (hors lanceur) ; zone : cercle de taille 2 (à partir de 1)
  - Minimise les effets aléatoires de la cible — cibles : ennemis ; si la cible n'a pas l'état «Poisse» (5183) ; 1 tour(s)
  - applique l'état «Poisse» (5183) — cibles : ennemis ; si la cible n'a pas l'état «Poisse» (5183) ; 2 tour(s) ; désenvoûtement fort uniquement
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Poisse» (28716, grade 1) — cibles : ennemis
    - *Sous-sort «Poisse» (id 28716, grade 1)*
      - le lanceur lance le sort «Poisse» (28716, grade 2) — cibles : ennemis ; déclenchement : quand le porteur subit des dommages / à la mort (XD) (buff 1 t.)
        - *Sous-sort «Poisse» (id 28716, grade 2)*
          - retire les effets du sort «Poisse» (28716) — cibles : ennemis
          - Soin : 50% des dommages occasionnés — cibles : alliés (hors lanceur) ; zone : cercle de taille 2 (à partir de 1)
  - 34 à 38 vol Eau (CC : 41 à 46 vol Eau)
  - retire les effets du sort «Poisse» (28716) — cibles : ennemis
  - Minimise les effets aléatoires de la cible — cibles : ennemis ; si la cible n'a pas l'état «Poisse» (5183) ; 1 tour(s)
  - applique l'état «Poisse» (5183) — cibles : ennemis ; si la cible n'a pas l'état «Poisse» (5183) ; 2 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : 4 PA : vol de vie Eau 34–38, minimise les effets aléatoires de l'ennemi (un tour sur deux) et, au prochain dégât qu'il subit, soigne les alliés en cercle 2 autour de lui de 50 % des dommages.
- Tags : `steal`, `water`, `heal_allies`, `anti_random`

### Paire 5 : Invisibilité / Brume

> Choix : Invisibilité (2 PA, +2 PM) quasi systématique ; Brume pour cacher tout le groupe.

#### 5A. Invisibilité (id 12913)

- **2 PA** · PO 0–6 (non modifiable) · sans LdV · relance 3 t., relance globale 1 · CC 0 %
- Grades : g1 niv.5 PO0-4 ; g2 niv.72 PO0-5 ; g3 niv.139 (grade utilisé : 3).
- Description du jeu : « Rend la cible invisible. Augmente également ses PM si c'est un allié. Le temps de relance est réinitialisé lorsque le lanceur achève un combattant. »
- Effets (infobulle, valeurs de base) :
  - Rend la cible invisible — 1 tour(s)
  - 2 PM — cibles : alliés (lanceur inclus) ; 2 tour(s)
- **Rôle tactique** : 2 PA sans LdV : invisibilité 1 tour sur n'importe quelle cible (+2 PM 2 tours si allié). Relance 3 réinitialisée quand le Sram achève un combattant.
- Tags : `stealth`, `buff_mp`, `survival`

#### 5B. Brume (id 12930)

- **3 PA** · PO 0–3 (non modifiable) · sans LdV · relance 5 t., relance partagée entre lanceurs (global = -1) · CC 0 %
- Grades : g1 niv.115 PO0-2 ; g2 niv.182 (grade utilisé : 2).
- Description du jeu : « Pose un glyphe-aura qui rend les alliés invisibles et retire de la Portée aux ennemis. Le temps de relance est réduit lorsque le lanceur achève un combattant. »
- Effets (infobulle, valeurs de base) :
  - pose un glyphe-aura «Brume» (12951, grade 2) — zone : cercle de taille 3 ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un glyphe-aura «Brume» (12951, grade 2) — zone : cercle de taille 3 ; 2 tour(s)
    - *Sous-sort «Brume» (id 12951, grade 2)*
      - Rend la cible invisible — cibles : alliés (lanceur inclus) ; zone : cercle de taille 3 ; 2 tour(s) ; désenvoûtement fort uniquement
      - -4 Portée — cibles : ennemis ; zone : cercle de taille 3 ; 2 tour(s) ; désenvoûtement fort uniquement
- **Rôle tactique** : 3 PA, relance 5 : glyphe-aura cercle 3 (2 tours) — alliés invisibles, ennemis −4 PO : protège tout un groupe à distance.
- Tags : `stealth`, `range_removal`, `aoe`, `group`

### Paire 6 : Double / Comploteur

> Choix : Comploteur (explosion boostée par les pièges) en Terre pièges ; Double (+2 PM, échange) sinon.

#### 6A. Double (id 12915)

- **3 PA** · PO 1–3 (non modifiable) · LdV requise, case libre requise · relance 3 t. · CC 0 % · élément(s) : Air
- Grades : g1 niv.10 PO1-1 ; g2 niv.77 PO1-2 ; g3 niv.144 (grade utilisé : 3).
- Description du jeu : « Invoque un double contrôlable qui possède les mêmes caractéristiques que l'invocateur. Il n'attaque pas et meurt à la fin de son deuxième tour pour échanger de position avec le lanceur et lui augmenter ses PM. »
- Effets (infobulle, valeurs de base) :
  - Invoque un double du lanceur
  - Échange de positions — effet différé de 2 tour(s)
  - 2 PM — 1 tour(s) ; effet différé de 2 tour(s) ; désenvoûtement fort uniquement
  - Tue la cible — cibles : alliés (lanceur inclus) ; si la cible vient d'apparaître (invocation posée par ce sort) ; effet différé de 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - Invoque un double du lanceur
  - le lanceur lance le sort «Doublure» (12966, grade 1) — cibles : alliés (lanceur inclus) ; si la cible vient d'apparaître (invocation posée par ce sort)
    - *Sous-sort «Doublure» (id 12966, grade 1)*
      - la cible lance le sort «Échange du Double» (12964, grade 1) — cibles : alliés (lanceur inclus) ; effet différé de 1 tour(s) ; déclenchement : fin de tour du porteur (buff 1 t.) ; désenvoûtement fort uniquement
        - *Sous-sort «Échange du Double» (id 12964, grade 1)*
          - la cible lance sur le lanceur le sort «Épidémie» (12956, grade 3) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur a l'état «Epidémie double - Rang 1» (6050) ; zone : toute la carte
            - *Sous-sort «Épidémie» (id 12956, grade 3)*
              - le lanceur lance le sort «Épidémie» (12956, grade 1) — cibles : personnages ennemis, invocations ennemies non statiques, monstres ennemis, compagnons ennemis ; zone : cercle de taille 2 (à partir de 1)
          - la cible lance sur le lanceur le sort «Épidémie» (12956, grade 4) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur a l'état «Epidémie double - Rang 2» (6051) ; zone : toute la carte
            - *Sous-sort «Épidémie» (id 12956, grade 4)*
              - le lanceur lance le sort «Épidémie» (12956, grade 2) — cibles : personnages ennemis, invocations ennemies non statiques, monstres ennemis, compagnons ennemis ; zone : cercle de taille 2 (à partir de 1)
          - Échange de positions — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si la cible n'a pas l'état «Pesanteur» (7) ; si le lanceur n'a pas l'état «Pesanteur» (7) ; zone : toute la carte
          - 2 PM — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; 1 tour(s) ; désenvoûtement fort uniquement
          - Tue la cible — cibles : lanceur
      - Prend le contrôle de l'entité — cibles : alliés (lanceur inclus) ; durée infinie ; désenvoûtement fort uniquement
      - applique l'état «Double» (611) — cibles : alliés (lanceur inclus) ; durée infinie ; désenvoûtement fort uniquement
      - applique l'état «Double» (705) — cibles : alliés (lanceur inclus) ; effet différé de 1 tour(s)
      - la cible lance sur le lanceur le sort «Doublure» (12966, grade 2) — cibles : alliés (lanceur inclus)
        - *Sous-sort «Doublure» (id 12966, grade 2)*
          - applique l'état «Double invoqué» (6052) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; durée infinie ; indésenvoûtable
  - applique l'état «Épidémie Double et Comploteur» (1486) — cibles : alliés (lanceur inclus) ; si la cible vient d'apparaître (invocation posée par ce sort) ; durée infinie ; indésenvoûtable
- **Rôle tactique** : 3 PA : copie contrôlable du Sram (sans attaque) qui échange de place avec lui et lui donne +2 PM à la fin de son 2e tour. Leurre et relais pour Guet-apens/Perquisition/Méprise/Épidémie.
- Tags : `double`, `mobility`, `decoy`

#### 6B. Comploteur (id 12936)

- **3 PA** · PO 1–3 (non modifiable) · LdV requise, case libre requise · relance 4 t. · CC 0 % · élément(s) : Air, meilleur élément
- Grades : g1 niv.120 PO1-2 ; g2 niv.187 (grade utilisé : 2).
- Description du jeu : « Invoque un double contrôlable qui possède les mêmes caractéristiques que l'invocateur. Il n'attaque pas et meurt à la fin de son troisième tour pour occasionner des dommages dans son meilleur élément aux entités à son contact. Les dommages à la mort du double sont augmentés pour chaque piège déclenché du lanceur depuis son invocation. »
- Effets (infobulle, valeurs de base) :
  - Invoque un double du lanceur — cibles : alliés (lanceur inclus)
  - «Comploteur» : +8 dommages de base — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Double» (611) ; durée infinie ; indésenvoûtable
  - 26 à 30 dommages du meilleur élément — zone : croix sans centre de taille 1 (à partir de 1) ; effet différé de 3 tour(s)
  - Tue la cible — cibles : alliés (lanceur inclus) ; si la cible vient d'apparaître (invocation posée par ce sort) ; effet différé de 3 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - Invoque un double du lanceur — cibles : alliés (lanceur inclus)
  - la cible lance le sort «Complot» (19724, grade 1) — cibles : alliés (lanceur inclus) ; si la cible vient d'apparaître (invocation posée par ce sort)
    - *Sous-sort «Complot» (id 19724, grade 1)*
      - la cible lance le sort «Explosion du Comploteur» (19725, grade 1) — cibles : lanceur ; effet différé de 2 tour(s) ; déclenchement : fin de tour du porteur (buff 1 t.) ; désenvoûtement fort uniquement
        - *Sous-sort «Explosion du Comploteur» (id 19725, grade 1)*
          - la cible lance sur le lanceur le sort «Épidémie» (12956, grade 3) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur a l'état «Epidémie double - Rang 1» (6050) ; zone : toute la carte
            - (sous-sort «Épidémie» 12956 g3 déjà détaillé plus haut)
          - la cible lance sur le lanceur le sort «Épidémie» (12956, grade 4) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur a l'état «Epidémie double - Rang 2» (6051) ; zone : toute la carte
            - (sous-sort «Épidémie» 12956 g4 déjà détaillé plus haut)
          - 26 à 30 dommages du meilleur élément — zone : croix sans centre de taille 1
          - Tue la cible — cibles : lanceur
      - la cible lance sur le lanceur le sort «Complot» (19724, grade 3) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
        - *Sous-sort «Complot» (id 19724, grade 3)*
          - Prend le contrôle de l'entité — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; durée infinie ; désenvoûtement fort uniquement
      - applique l'état «Double» (611) — cibles : alliés (lanceur inclus) ; durée infinie ; désenvoûtement fort uniquement
      - applique l'état «Double» (705) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; effet différé de 2 tour(s) ; désenvoûtement fort uniquement
      - applique l'état «Double invoqué» (6052) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; durée infinie ; indésenvoûtable
  - applique l'état «Épidémie Double et Comploteur» (1486) — cibles : alliés (lanceur inclus) ; si la cible vient d'apparaître (invocation posée par ce sort) ; durée infinie ; indésenvoûtable
- **Rôle tactique** : 3 PA : double qui explose à la fin de son 3e tour (26–30 meilleur élément au contact, +8 par piège déclenché depuis son invocation).
- Tags : `double`, `damage`, `trap_synergy`

### Paire 7 : Piège Sournois / Guet-apens

> Choix : Piège Sournois (attire vers son centre) ; Guet-apens (vol Eau + attire vers le double).

#### 7A. Piège Sournois (id 12906)

- **2 PA** · PO 1–8 (modifiable) · sans LdV, case libre requise, case sans piège requise · 1/tour · CC 0 % · élément(s) : Feu
- Grades : g1 niv.15 PO1-6 ; g2 niv.82 PO1-7 ; g3 niv.149 (grade utilisé : 3).
- Description du jeu : « Pose un piège qui occasionne des dommages Feu aux ennemis et attire les entités vers son centre en zone. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège Sournois» (12929, grade 3) — zone : croix de taille 1
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège Sournois» (12929, grade 3) — zone : croix de taille 1
    - *Sous-sort «Piège Sournois» (id 12929, grade 3)*
      - 17 à 19 dommages Feu — cibles : ennemis ; zone : croix de taille 1
      - Attire de 1 case — zone : croix de taille 1
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - *Sous-sort «Pièges» (id 12968, grade 1)*
          - la cible lance le sort «Injection Toxique» (12974, grade 1) — cibles : lanceur ; si le lanceur a l'état «Injection Toxique» (3766)
            - *Sous-sort «Injection Toxique» (id 12974, grade 1)*
              - «Injection Toxique» : -1 tour(s) de relance — cibles : lanceur ; durée infinie ; indésenvoûtable
          - la cible lance le sort «Perfidie» (12972, grade 1) — cibles : lanceur ; si le lanceur a l'état «Perfidie» (3765)
            - *Sous-sort «Perfidie» (id 12972, grade 1)*
              - «Perfidie» : -1 PA — cibles : lanceur ; si le lanceur n'a pas l'état «Perfidie IV» (3780) ; durée infinie ; désenvoûtement fort uniquement
              - applique l'état «Perfidie I» (3777) — cibles : lanceur ; si la cible n'a pas l'état «Perfidie I» (3777) ; si la cible n'a pas l'état «Perfidie II» (3778) ; si la cible n'a pas l'état «Perfidie III» (3779) ; si la cible n'a pas l'état «Perfidie IV» (3780) ; durée infinie ; désenvoûtement fort uniquement
              - applique l'état «Perfidie II» (3778) — cibles : lanceur ; si la cible a l'état «Perfidie I» (3777) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Perfidie I» (3777) — cibles : lanceur ; si la cible a l'état «Perfidie I» (3777)
              - applique l'état «Perfidie III» (3779) — cibles : lanceur ; si la cible a l'état «Perfidie II» (3778) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Perfidie II» (3778) — cibles : lanceur ; si la cible a l'état «Perfidie II» (3778)
              - applique l'état «Perfidie IV» (3780) — cibles : lanceur ; si la cible a l'état «Perfidie III» (3779) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Perfidie III» (3779) — cibles : lanceur ; si la cible a l'état «Perfidie III» (3779)
          - la cible lance le sort «Chausse-trappe» (12971, grade 1) — cibles : lanceur ; si le lanceur a l'état «Chausse-trappe» (3763)
            - *Sous-sort «Chausse-trappe» (id 12971, grade 1)*
              - «Chausse-trappe» : +8 dommages de base — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
              - applique l'état «Chausse-trappe I» (3767) — cibles : lanceur ; si la cible n'a pas l'état «Chausse-trappe I» (3767) ; si la cible n'a pas l'état «Chausse-trappe II» (3768) ; si la cible n'a pas l'état «Chausse-trappe III» (3769) ; si la cible n'a pas l'état «Chausse-trappe IV» (3770) ; si la cible n'a pas l'état «Chausse-trappe V» (3771) ; durée infinie ; désenvoûtement fort uniquement
              - applique l'état «Chausse-trappe II» (3768) — cibles : lanceur ; si la cible a l'état «Chausse-trappe I» (3767) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Chausse-trappe I» (3767) — cibles : lanceur ; si la cible a l'état «Chausse-trappe I» (3767)
              - applique l'état «Chausse-trappe III» (3769) — cibles : lanceur ; si la cible a l'état «Chausse-trappe II» (3768) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Chausse-trappe II» (3768) — cibles : lanceur ; si la cible a l'état «Chausse-trappe II» (3768)
              - applique l'état «Chausse-trappe IV» (3770) — cibles : lanceur ; si la cible a l'état «Chausse-trappe III» (3769) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Chausse-trappe III» (3769) — cibles : lanceur ; si la cible a l'état «Chausse-trappe III» (3769)
              - applique l'état «Chausse-trappe V» (3771) — cibles : lanceur ; si la cible a l'état «Chausse-trappe IV» (3770) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Chausse-trappe IV» (3770) — cibles : lanceur ; si la cible a l'état «Chausse-trappe IV» (3770)
          - la cible lance le sort «Marque Mortuaire» (14319, grade 1) — cibles : lanceur ; si le lanceur a l'état «Marque Mortuaire» (3762)
            - *Sous-sort «Marque Mortuaire» (id 14319, grade 1)*
              - applique l'état «Marque Mortuaire I» (1407) — cibles : lanceur ; si la cible n'a pas l'état «Marque Mortuaire I» (1407) ; si la cible n'a pas l'état «Marque Mortuaire II» (1408) ; si la cible n'a pas l'état «Marque Mortuaire III» (1409) ; si la cible n'a pas l'état «Marque Mortuaire IV» (1410) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Marque Mortuaire I» (1407) — cibles : lanceur ; si la cible a l'état «Marque Mortuaire I» (1407)
              - applique l'état «Marque Mortuaire II» (1408) — cibles : lanceur ; si la cible a l'état «Marque Mortuaire I» (1407) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Marque Mortuaire II» (1408) — cibles : lanceur ; si la cible a l'état «Marque Mortuaire II» (1408)
              - applique l'état «Marque Mortuaire III» (1409) — cibles : lanceur ; si la cible a l'état «Marque Mortuaire II» (1408) ; durée infinie ; désenvoûtement fort uniquement
              - retire l'état «Marque Mortuaire III» (1409) — cibles : lanceur ; si la cible a l'état «Marque Mortuaire III» (1409)
              - applique l'état «Marque Mortuaire IV» (1410) — cibles : lanceur ; si la cible a l'état «Marque Mortuaire III» (1409) ; durée infinie ; désenvoûtement fort uniquement
          - la cible lance le sort «Complot» (19724, grade 2) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Double» (611) ; si le lanceur a l'état «Comploteur» (3764) ; zone : toute la carte
            - *Sous-sort «Complot» (id 19724, grade 2)*
              - «Explosion du Comploteur» : +8 dommages de base — cibles : lanceur ; durée infinie ; indésenvoûtable
              - «Comploteur» : +8 dommages de base — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; durée infinie ; indésenvoûtable
              - applique l'état «Comploteur I» (3772) — cibles : lanceur ; si la cible n'a pas l'état «Comploteur I» (3772) ; si la cible n'a pas l'état «Comploteur II» (3773) ; si la cible n'a pas l'état «Comploteur III» (3774) ; si la cible n'a pas l'état «Comploteur IV» (3775) ; si la cible n'a pas l'état «Comploteur V» (3776) ; durée infinie ; indésenvoûtable
              - applique l'état «Comploteur II» (3773) — cibles : lanceur ; si la cible a l'état «Comploteur I» (3772) ; durée infinie ; indésenvoûtable
              - retire l'état «Comploteur I» (3772) — cibles : lanceur ; si la cible a l'état «Comploteur I» (3772)
              - applique l'état «Comploteur III» (3774) — cibles : lanceur ; si la cible a l'état «Comploteur II» (3773) ; durée infinie ; indésenvoûtable
              - retire l'état «Comploteur II» (3773) — cibles : lanceur ; si la cible a l'état «Comploteur II» (3773)
              - applique l'état «Comploteur IV» (3775) — cibles : lanceur ; si la cible a l'état «Comploteur III» (3774) ; durée infinie ; indésenvoûtable
              - retire l'état «Comploteur III» (3774) — cibles : lanceur ; si la cible a l'état «Comploteur III» (3774)
              - applique l'état «Comploteur V» (3776) — cibles : lanceur ; si la cible a l'état «Comploteur IV» (3775) ; durée infinie ; indésenvoûtable
              - retire l'état «Comploteur IV» (3775) — cibles : lanceur ; si la cible a l'état «Comploteur IV» (3775)
- **Rôle tactique** : 2 PA, 1/tour : piège croix 1 — 17–19 Feu aux ennemis et attire de 1 vers le centre (regroupe dans la zone d'un second piège).
- Tags : `trap`, `damage`, `placement`, `fire`

#### 7B. Guet-apens (id 12939)

- **3 PA** · PO 0–6 (modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Eau
- Grades : g1 niv.125 dmg 19–22 PO0-5 ; g2 niv.192 dmg 22–25 (grade utilisé : 2).
- Description du jeu : « Vole de la vie dans l'élément Eau aux ennemis et attire la cible. Les entités qui attaquent l'ennemi ciblé sont soignées d'une partie des dommages occasionnés. Attire la cible vers le double du lanceur s'il est présent sur le terrain. »
- Effets (infobulle, valeurs de base) :
  - 22 à 25 vol Eau (CC : 27 à 30 vol Eau) — cibles : ennemis
  - soigne l'attaquant de 25% des dommages subis — cibles : ennemis ; déclenchement : quand le porteur subit des dommages (buff 1 t.)
  - Attire de 2 cases — cibles : tous ; si le lanceur n'a pas l'état «Double invoqué» (6052)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 22 à 25 vol Eau (CC : 27 à 30 vol Eau) — cibles : ennemis
  - soigne l'attaquant de 25% des dommages subis — cibles : ennemis ; déclenchement : quand le porteur subit des dommages (buff 1 t.)
  - applique l'état «Guet-apens (cible)» (2339) — cibles : tous ; si le lanceur a l'état «Double invoqué» (6052) ; 1 tour(s) ; désenvoûtement fort uniquement
  - la cible lance le sort «Guet-apens» (12953, grade 2) — cibles : lanceur ; si le lanceur a l'état «Double invoqué» (6052)
    - *Sous-sort «Guet-apens» (id 12953, grade 2)*
      - le lanceur lance le sort «Guet-apens» (12953, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Double» (611) ; zone : toute la carte
        - *Sous-sort «Guet-apens» (id 12953, grade 1)*
          - Attire de 2 cases — cibles : ennemis ; si la cible a l'état «Guet-apens (cible)» (2339) ; zone : toute la carte
          - Attire de 2 cases — cibles : alliés (lanceur inclus) ; si la cible a l'état «Guet-apens (cible)» (2339) ; si la cible n'a pas l'état «Double» (611) ; zone : toute la carte
      - retire l'état «Guet-apens (cible)» (2339) — zone : toute la carte
  - Attire de 2 cases — cibles : tous ; si le lanceur n'a pas l'état «Double invoqué» (6052)
  - Attire de 2 cases — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Double» (611) ; si le lanceur a l'état «Double invoqué» (6052)
- **Rôle tactique** : 3 PA : vol de vie Eau 22–25, attire de 2 (vers le double s'il existe) ; pendant 1 tour, quiconque attaque la cible est soigné de 25 %.
- Tags : `steal`, `placement`, `water`, `heal_on_attack`

### Paire 8 : Piège Fangeux / Épidémie

> Choix : Épidémie (poison qui se propage) en Air ; Piège Fangeux (−2 PM) sinon.

#### 8A. Piège Fangeux (id 12916)

- **3 PA** · PO 1–6 (modifiable) · sans LdV, case libre requise, case sans piège requise · 2/tour · CC 0 % · élément(s) : Eau
- Grades : g1 niv.20 PO1-4 ; g2 niv.87 PO1-5 ; g3 niv.154 (grade utilisé : 3).
- Description du jeu : « Pose un piège qui occasionne des dommages Eau et retire des PM. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège Fangeux» (12970, grade 3)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège Fangeux» (12970, grade 3)
    - *Sous-sort «Piège Fangeux» (id 12970, grade 3)*
      - 33 à 37 dommages Eau
      - -2 PM (esquivable) — 1 tour(s) ; désenvoûtement fort uniquement
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 3 PA : piège mono-cellule — 33–37 Eau et −2 PM esquivables à l'entité qui le déclenche (y compris un allié).
- Tags : `trap`, `damage`, `mp_removal`, `water`

#### 8B. Épidémie (id 12943)

- **4 PA** · PO 0–6 (modifiable) · en ligne, LdV requise · 2/tour, 1/cible · CC 0 % · élément(s) : Air
- Grades : g1 niv.130 PO0-5 ; g2 niv.197 (grade utilisé : 2).
- Description du jeu : « Applique un poison Air de fin de tour sur l'ennemi ciblé et lui applique l'état Épidémie : • À la fin du tour de la cible, propage le poison et l'état sur les ennemis en zone autour d'elle. Le lanceur et son double peuvent servir de cible pour propager le poison. N'affecte pas les invocations statiques. »
- Effets (infobulle, valeurs de base) :
  - 36 à 40 dommages Air — cibles : ennemis ; déclenchement : fin de tour du porteur (buff 1 t.) ; indésenvoûtable
  - applique l'état «Epidémie» (667) — cibles : lanceur, ennemis ; 1 tour(s) ; indésenvoûtable
  - 36 à 40 dommages Air — cibles : ennemis ; zone : cercle de taille 2 (à partir de 1) ; déclenchement : fin de tour du porteur (buff 1 t.) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Épidémie» (12956, grade 2) — cibles : personnages ennemis, invocations ennemies non statiques, monstres ennemis, compagnons ennemis
    - (sous-sort «Épidémie» 12956 g2 déjà détaillé plus haut)
  - le lanceur lance le sort «Épidémie» (12956, grade 6) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Épidémie Double et Comploteur» (1486)
    - *Sous-sort «Épidémie» (id 12956, grade 6)*
      - le lanceur lance le sort «Épidémie» (12956, grade 4) — cibles : alliés (lanceur inclus) ; déclenchement : fin de tour du porteur (buff 1 t.) ; indésenvoûtable
        - (sous-sort «Épidémie» 12956 g4 déjà détaillé plus haut)
      - applique l'état «Epidémie» (667) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
      - retire l'état «Epidémie» (667) — cibles : alliés (lanceur inclus) ; déclenchement : fin de tour du porteur (buff 1 t.) ; indésenvoûtable
      - applique l'état «Epidémie double - Rang 2» (6051) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Épidémie Double et Comploteur» (1486) ; 1 tour(s) ; indésenvoûtable
  - le lanceur lance le sort «Épidémie» (12956, grade 6) — cibles : lanceur
    - (sous-sort «Épidémie» 12956 g6 déjà détaillé plus haut)
- **Rôle tactique** : 4 PA en ligne : poison Air de fin de tour 36–40 + état Épidémie qui, à la fin du tour de la cible, propage poison et état aux ennemis en cercle 2. Excellent sur un paquet.
- Tags : `poison`, `aoe`, `air`, `spread`

### Paire 9 : Piège Funeste / Effraction

> Choix : Piège Funeste (+20 par ennemi proche) ; Effraction (vol de rés. poussée) pour un build poussée.

#### 9A. Piège Funeste (id 12948)

- **3 PA** · PO 1–6 (modifiable) · sans LdV, case libre requise, case sans piège requise · 2/tour · CC 0 % · élément(s) : Terre
- Grades : g1 niv.25 PO1-4 ; g2 niv.92 PO1-5 ; g3 niv.159 (grade utilisé : 3).
- Description du jeu : « Pose un piège qui occasionne des dommages Terre. Les dommages du sort sont augmentés pour chaque ennemi en zone autour du piège avant d'appliquer ses effets. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège Funeste» (12962, grade 3)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège Funeste» (12962, grade 3)
    - *Sous-sort «Piège Funeste» (id 12962, grade 3)*
      - retire les effets du sort «Piège Funeste» (12962) — cibles : lanceur
      - le lanceur lance le sort «Piège Funeste» (12962, grade 6) — cibles : ennemis ; zone : cercle de taille 2 (à partir de 1)
        - *Sous-sort «Piège Funeste» (id 12962, grade 6)*
          - «Piège Funeste» : +20 dommages de base — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
      - 28 à 32 dommages Terre
      - retire les effets du sort «Piège Funeste» (12962) — cibles : lanceur
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 3 PA : piège mono-cellule — 28–32 Terre +20 dommages de base par ennemi en cercle 2 autour du piège au déclenchement.
- Tags : `trap`, `damage`, `earth`

#### 9B. Effraction (id 14742)

- **2 PA** · PO 1–6 (non modifiable) · LdV requise, cible requise (case occupée) · 3/tour, 2/cible · CC 10 % · élément(s) : Feu
- Grades : g1 niv.135 (grade utilisé : 1).
- Description du jeu : « Vole des Résistances Poussée et occasionne des dommages Feu. »
- Effets (infobulle, valeurs de base) :
  - -30 Résistances Poussée — 3 tour(s)
  - 30 Résistances Poussée — cibles : lanceur ; 3 tour(s)
  - 15 à 17 dommages Feu (CC : 19 à 21 dommages Feu)
- **Rôle tactique** : 2 PA, cible requise : vole 30 résistance poussée (3 tours) + 15–17 Feu ; prépare les dommages de poussée (Sournoiserie).
- Tags : `damage`, `steal_stat`, `fire`

### Paire 10 : Piège Répulsif / Piège Effroyable

> Choix : Piège Effroyable (mono-cellule, effets en croix 3) ou Répulsif (croix 1) selon la carte.

#### 10A. Piège Répulsif (id 12914)

- **2 PA** · PO 1–7 (modifiable) · sans LdV, case libre requise, case sans piège requise · 2/tour · CC 0 % · élément(s) : Air
- Grades : g1 niv.30 PO1-5 ; g2 niv.97 PO1-6 ; g3 niv.164 (grade utilisé : 3).
- Description du jeu : « Pose un piège qui repousse les entités depuis son centre et occasionne des dommages Air aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège Répulsif» (12928, grade 3) — zone : croix de taille 1
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège Répulsif» (12928, grade 3) — zone : croix de taille 1
    - *Sous-sort «Piège Répulsif» (id 12928, grade 3)*
      - Repousse de 2 cases — zone : croix de taille 1
      - 14 à 17 dommages Air — cibles : ennemis ; zone : croix de taille 1
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA : piège croix 1 — repousse de 2 depuis le centre et 14–17 Air aux ennemis.
- Tags : `trap`, `damage`, `placement`, `air`

#### 10B. Piège Effroyable (id 12920)

- **2 PA** · PO 1–7 (modifiable) · sans LdV, case libre requise, case sans piège requise · 2/tour · CC 0 % · élément(s) : Terre
- Grades : g1 niv.140 (grade utilisé : 1).
- Description du jeu : « Pose un piège mono-cellule qui occasionne des dommages Terre aux ennemis et repousse les entités depuis le centre en zone. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège Effroyable» (28737, grade 1)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège Effroyable» (28737, grade 1)
    - *Sous-sort «Piège Effroyable» (id 28737, grade 1)*
      - 20 à 22 dommages Terre — cibles : ennemis ; zone : croix de taille 3
      - Repousse de 2 cases — zone : croix de taille 3
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA : piège mono-cellule dont les effets couvrent une croix 3 : 20–22 Terre aux ennemis et repousse de 2 depuis le centre.
- Tags : `trap`, `damage`, `placement`, `aoe`, `earth`

### Paire 11 : Piège d'Immobilisation / Fosse Commune

> Choix : Piège d'Immobilisation (−4 PM en cercle 3) : entrave de zone ; Fosse Commune (Pesanteur) contre les téléporteurs.

#### 11A. Piège d'Immobilisation (id 12910)

- **3 PA** · PO 1–6 (modifiable) · en ligne, sans LdV, case libre requise, case sans piège requise · relance 4 t. · CC 0 %
- Grades : g1 niv.35 PO1-4 ; g2 niv.102 PO1-5 ; g3 niv.169 (grade utilisé : 3).
- Description du jeu : « Pose un piège qui retire des PM aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège d'Immobilisation» (12923, grade 3) — zone : cercle de taille 3
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège d'Immobilisation» (12923, grade 3) — zone : cercle de taille 3
    - *Sous-sort «Piège d'Immobilisation» (id 12923, grade 3)*
      - -4 PM (esquivable) — cibles : ennemis ; zone : cercle de taille 3 ; 2 tour(s)
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 3 PA en ligne, relance 4 : piège cercle 3 — −4 PM esquivables (2 tours) à tous les ennemis de la zone. Meilleur outil d'entrave du Sram.
- Tags : `trap`, `mp_removal`, `aoe`

#### 11B. Fosse Commune (id 14314)

- **3 PA** · PO 1–6 (modifiable) · sans LdV, case libre requise, case sans piège requise · relance 3 t. · CC 0 %
- Grades : g1 niv.145 (grade utilisé : 1).
- Description du jeu : « Pose un piège mono-cellule qui applique l'état Pesanteur en zone. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Fosse Commune» (12957, grade 1)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Fosse Commune» (12957, grade 1)
    - *Sous-sort «Fosse Commune» (id 12957, grade 1)*
      - applique l'état «Pesanteur» (7) — zone : cercle de taille 2 ; 1 tour(s) ; désenvoûtement fort uniquement
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 3 PA, relance 3 : piège mono-cellule qui applique Pesanteur en cercle 2 (empêche téléportations/échanges, y compris alliés).
- Tags : `trap`, `control`

### Paire 12 : Extorsion / Perquisition

> Choix : Extorsion (vol 100 Force + vol de vie Terre) en Terre ; Perquisition (repousse depuis le double).

#### 12A. Extorsion (id 12938)

- **3 PA** · PO 1–3 (non modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Terre
- Grades : g1 niv.40 dmg 17–19 ; g2 niv.107 dmg 22–24 ; g3 niv.174 dmg 27–30 (grade utilisé : 3).
- Description du jeu : « Vole de la Force et de la vie dans l'élément Terre. »
- Effets (infobulle, valeurs de base) :
  - Vole 100 Force — 3 tour(s)
  - 27 à 30 vol Terre (CC : 32 à 36 vol Terre)
- **Rôle tactique** : 3 PA, PO 1–3 : vole 100 Force (3 tours, ×2) + vol de vie Terre 27–30.
- Tags : `steal`, `steal_stat`, `earth`

#### 12B. Perquisition (id 12947)

- **2 PA** · PO 0–6 (non modifiable) · LdV requise · 3/tour, 2/cible · CC 10 % · élément(s) : Feu
- Grades : g1 niv.150 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Feu aux ennemis et repousse la cible. Repousse la cible depuis le double du lanceur s'il est présent sur le terrain. »
- Effets (infobulle, valeurs de base) :
  - 13 à 15 dommages Feu (CC : 16 à 18 dommages Feu) — cibles : ennemis
  - Repousse de 2 cases — cibles : tous ; si le lanceur n'a pas l'état «Double invoqué» (6052)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - applique l'état «Perquisition (cible)» (6059) — cibles : tous ; si le lanceur a l'état «Double invoqué» (6052) ; 1 tour(s) ; indésenvoûtable
  - 13 à 15 dommages Feu (CC : 16 à 18 dommages Feu) — cibles : ennemis
  - Repousse de 2 cases — cibles : tous ; si le lanceur n'a pas l'état «Double invoqué» (6052)
  - Repousse de 2 cases — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Double» (611) ; si le lanceur a l'état «Double invoqué» (6052)
  - la cible lance le sort «Perquisition» (30793, grade 2) — cibles : lanceur ; si le lanceur a l'état «Double invoqué» (6052)
    - *Sous-sort «Perquisition» (id 30793, grade 2)*
      - le lanceur lance le sort «Perquisition» (30793, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Double» (611) ; zone : toute la carte
        - *Sous-sort «Perquisition» (id 30793, grade 1)*
          - Repousse de 2 cases — cibles : ennemis ; si la cible a l'état «Perquisition (cible)» (6059) ; zone : toute la carte
          - Repousse de 2 cases — cibles : alliés (lanceur inclus) ; si la cible a l'état «Perquisition (cible)» (6059) ; si la cible n'a pas l'état «Double» (611) ; zone : toute la carte
      - retire l'état «Perquisition (cible)» (6059) — zone : toute la carte
- **Rôle tactique** : 2 PA : 13–15 Feu + repousse de 2 (depuis le double s'il existe).
- Tags : `damage`, `placement`, `fire`

### Paire 13 : Arnaque / Larcin

> Choix : Arnaque (vol 100 Agilité + vol de vie Air) en Air ; Larcin (érosion 13 % + Eau en zone).

#### 13A. Arnaque (id 12911)

- **3 PA** · PO 1–6 (non modifiable) · en ligne, LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Air
- Grades : g1 niv.45 dmg 16–18 ; g2 niv.112 dmg 21–23 ; g3 niv.179 dmg 25–28 (grade utilisé : 3).
- Description du jeu : « Vole de l'Agilité et de la vie dans l'élément Air. »
- Effets (infobulle, valeurs de base) :
  - Vole 100 Agilité — 3 tour(s)
  - 25 à 28 vol Air (CC : 30 à 34 vol Air)
- **Rôle tactique** : 3 PA en ligne : vole 100 Agilité (3 tours, ×2) + vol de vie Air 25–28.
- Tags : `steal`, `steal_stat`, `air`

#### 13B. Larcin (id 12937)

- **4 PA** · PO 0–4 (non modifiable) · LdV requise · 2/tour · CC 20 % · élément(s) : Eau
- Grades : g1 niv.155 (grade utilisé : 1).
- Description du jeu : « Érode les cibles et occasionne des dommages Eau en zone. N'affecte pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 13% Érosion — cibles : alliés (hors lanceur), ennemis ; zone : croix diagonale de taille 1 ; 2 tour(s)
  - 34 à 38 dommages Eau (CC : 41 à 46 dommages Eau) — cibles : alliés (hors lanceur), ennemis ; zone : croix diagonale de taille 1
- **Rôle tactique** : 4 PA : 13 % d'érosion (2 tours) et 34–38 Eau en croix diagonale 1 (pas le lanceur, mais les alliés oui).
- Tags : `damage`, `erosion`, `aoe`, `water`

### Paire 14 : Pillage / Attaque Mortelle

> Choix : Attaque Mortelle (54–60 sous 50 % PV) en Terre ; Pillage (vol 100 Chance) en Eau.

#### 14A. Pillage (id 12934)

- **3 PA** · PO 1–4 (non modifiable) · LdV requise · 3/tour, 2/cible · CC 15 % · élément(s) : Eau
- Grades : g1 niv.50 dmg 17–19 ; g2 niv.117 dmg 22–25 ; g3 niv.184 dmg 26–29 (grade utilisé : 3).
- Description du jeu : « Vole de la Chance et de la vie dans l'élément Eau. »
- Effets (infobulle, valeurs de base) :
  - Vole 100 Chance — 3 tour(s)
  - 26 à 29 vol Eau (CC : 31 à 35 vol Eau)
- **Rôle tactique** : 3 PA, PO 1–4 : vole 100 Chance + vol de vie Eau 26–29.
- Tags : `steal`, `steal_stat`, `water`

#### 14B. Attaque Mortelle (id 12917)

- **4 PA** · PO 1–2 (non modifiable) · LdV requise · 3/tour, 2/cible · CC 20 % · élément(s) : Terre
- Grades : g1 niv.160 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Terre. Les dommages sont plus importants sur les cibles ayant moins de 50% de leur vie. »
- Effets (infobulle, valeurs de base) :
  - 43 à 48 dommages Terre (CC : 52 à 58 dommages Terre) — cibles : tous ; si la cible a au moins 50% PV
  - 54 à 60 dommages Terre (CC : 65 à 72 dommages Terre) — cibles : tous ; si la cible a moins de 50% PV
- **Rôle tactique** : 4 PA, PO 1–2 : 43–48 Terre, 54–60 si la cible a moins de 50 % PV (CC 65–72) : finisseur.
- Tags : `damage`, `execute`, `earth`

### Paire 15 : Fourberie / Injection Toxique

> Choix : Injection Toxique (poison 28–32 ×3 tours + −1 PM) presque toujours ; Fourberie en Feu.

#### 15A. Fourberie (id 12905)

- **4 PA** · PO 0–3 (non modifiable) · LdV requise · 2/tour · CC 20 % · élément(s) : Feu
- Grades : g1 niv.55 dmg 18–20 ; g2 niv.122 dmg 24–27 ; g3 niv.189 dmg 27–31 (grade utilisé : 3).
- Description du jeu : « Vole de l'Intelligence et de la vie dans l'élément Feu en zone. N'affecte pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - Vole 100 Intelligence — cibles : alliés (hors lanceur), ennemis ; zone : anneau de taille 2 ; 3 tour(s)
  - 27 à 31 vol Feu (CC : 32 à 37 vol Feu) — cibles : alliés (hors lanceur), ennemis ; zone : anneau de taille 2
- **Rôle tactique** : 4 PA : vole 100 Intelligence et vol de vie Feu 27–31 en anneau 2 autour de la case ciblée (pas le lanceur).
- Tags : `steal`, `steal_stat`, `aoe`, `fire`

#### 15B. Injection Toxique (id 12940)

- **5 PA** · PO 1–5 (non modifiable) · LdV requise · relance 5 t. · CC 25 % · élément(s) : Air
- Grades : g1 niv.165 (grade utilisé : 1).
- Description du jeu : « Retire des PM et applique un poison Air de début de tour sur la cible. Le temps de relance du sort est réduit pour chaque piège déclenché du lanceur. »
- Effets (infobulle, valeurs de base) :
  - -1 PM (esquivable) — 3 tour(s)
  - 28 à 32 dommages Air (CC : 34 à 38 dommages Air) — déclenchement : début de tour du porteur (buff 3 t.)
  - «Injection Toxique» : -1 tour(s) de relance — cibles : lanceur
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - -1 PM (esquivable) — 3 tour(s)
  - 28 à 32 dommages Air (CC : 34 à 38 dommages Air) — déclenchement : début de tour du porteur (buff 3 t.)
- **Rôle tactique** : 5 PA, relance 5 (−1 par piège déclenché) : −1 PM 3 tours et poison Air 28–32 au début des 3 prochains tours de la cible.
- Tags : `poison`, `mp_removal`, `air`, `trap_synergy`

### Paire 16 : Peur / Méprise

> Choix : Peur (pousse jusqu'à la case) indispensable pour les pièges ; Méprise (échange) pour la mobilité.

#### 16A. Peur (id 12908)

- **2 PA** · PO 2–8 (non modifiable) · en ligne, sans LdV, case libre requise · 3/tour · CC 0 %
- Grades : g1 niv.60 PO2-6 ; g2 niv.127 PO2-7 ; g3 niv.194 (grade utilisé : 3).
- Description du jeu : « Pousse la cible jusqu'à la case ciblée. »
- Effets (infobulle, valeurs de base) :
  - Pousse jusqu'à la case visée
- **Rôle tactique** : 2 PA, PO 2–8 en ligne sans LdV, case libre : pousse l'entité adjacente au Sram (dans la direction choisie) jusqu'à la case ciblée. Outil n°1 pour mettre un ennemi dans un piège.
- Tags : `placement`

#### 16B. Méprise (id 12945)

- **3 PA** · PO 0–4 (non modifiable) · en ligne, LdV requise, cible requise (case occupée) · 1/tour, relance initiale 1 t. · CC 0 %
- Grades : g1 niv.170 (grade utilisé : 1).
- Description du jeu : « Échange de position avec la cible. Échange les positions de la cible et du double du lanceur s'il est présent sur le terrain. Dissipe l'invisibilité du lanceur. »
- Effets (infobulle, valeurs de base) :
  - Échange de positions — cibles : tous ; si le lanceur n'a pas l'état «Double invoqué» (6052)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - applique l'état «Méprise» (2228) — cibles : tous ; si la cible n'a pas l'état «Pesanteur» (7) ; si le lanceur a l'état «Double invoqué» (6052) ; durée infinie ; désenvoûtement fort uniquement
  - la cible lance le sort «Méprise» (12958, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Double» (611) ; si le lanceur a l'état «Double invoqué» (6052) ; zone : toute la carte
    - *Sous-sort «Méprise» (id 12958, grade 1)*
      - Échange de positions — cibles : tous ; si la cible a l'état «Méprise» (2228) ; zone : toute la carte
  - Échange de positions — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Double» (611)
  - retire l'état «Méprise» (2228) — cibles : tous ; si le lanceur a l'état «Double invoqué» (6052) ; zone : toute la carte
  - Échange de positions — cibles : tous ; si le lanceur n'a pas l'état «Double invoqué» (6052)
  - 1 dommages Neutre — cibles : tous ; si la cible est le monstre «monstre#50000» (50000)
- **Rôle tactique** : 3 PA en ligne, cible requise : échange de place avec la cible (ou échange la cible avec le double s'il existe) ; dissipe l'invisibilité du Sram.
- Tags : `mobility`, `placement`

### Paire 17 : Piège de Dérive / Piège Insidieux

> Choix : Piège Insidieux (poison) en Air ; Piège de Dérive (Feu, repousse) sinon.

#### 17A. Piège de Dérive (id 12942)

- **2 PA** · PO 1–6 (modifiable) · sans LdV, case libre requise, case sans piège requise · 2/tour · CC 0 % · élément(s) : Feu
- Grades : g1 niv.65 PO1-4 ; g2 niv.131 PO1-5 ; g3 niv.198 (grade utilisé : 3).
- Description du jeu : « Pose un piège qui occasionne des dommages Feu aux ennemis et repousse les entités depuis le centre en zone. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège de Dérive» (12955, grade 3) — zone : croix diagonale de taille 1
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège de Dérive» (12955, grade 3) — zone : croix diagonale de taille 1
    - *Sous-sort «Piège de Dérive» (id 12955, grade 3)*
      - 17 à 19 dommages Feu — cibles : ennemis ; zone : croix diagonale de taille 1
      - Repousse de 2 cases — zone : croix diagonale de taille 1
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA : piège croix diagonale 1 — 17–19 Feu aux ennemis et repousse de 2 depuis le centre.
- Tags : `trap`, `damage`, `placement`, `fire`

#### 17B. Piège Insidieux (id 12918)

- **2 PA** · PO 1–6 (modifiable) · sans LdV, case libre requise, case sans piège requise · 1/tour · CC 0 % · élément(s) : Air
- Grades : g1 niv.175 (grade utilisé : 1).
- Description du jeu : « Pose un piège qui applique un poison Air de fin de tour sur les ennemis, leur occasionne des dommages Air et attire les entités vers le centre en zone. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège Insidieux» (28736, grade 1) — zone : croix diagonale de taille 1
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège Insidieux» (28736, grade 1) — zone : croix diagonale de taille 1
    - *Sous-sort «Piège Insidieux» (id 28736, grade 1)*
      - 8 à 9 dommages Air — cibles : ennemis ; zone : croix diagonale de taille 1 ; déclenchement : fin de tour du porteur (buff 1 t.)
      - 8 à 9 dommages Air — cibles : ennemis ; zone : croix diagonale de taille 1
      - Attire de 1 case — zone : croix diagonale de taille 1 (à partir de 1)
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA, 1/tour : piège croix diagonale 1 — 8–9 Air immédiat + poison 8–9 Air en fin de tour, attire de 1 vers le centre.
- Tags : `trap`, `poison`, `placement`, `air`

### Paire 18 : Piège Scélérat / Piège à Fragmentation

> Choix : Piège à Fragmentation (jusqu'à 47–51 en anneau 3) en burst ; Piège Scélérat (attire 3) pour regrouper.

#### 18A. Piège Scélérat (id 12931)

- **2 PA** · PO 1–7 (modifiable) · sans LdV, case libre requise, case sans piège requise · 2/tour · CC 0 % · élément(s) : Eau
- Grades : g1 niv.70 PO1-6 ; g2 niv.137 (grade utilisé : 2).
- Description du jeu : « Pose un piège mono-cellule qui attire les entités vers son centre et occasionne des dommages Eau aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège Scélérat» (12952, grade 2)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège Scélérat» (12952, grade 2)
    - *Sous-sort «Piège Scélérat» (id 12952, grade 2)*
      - Attire de 3 cases — zone : croix sans centre de taille 3
      - 17 à 19 dommages Eau — cibles : ennemis ; zone : croix de taille 3
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA : piège mono-cellule — attire de 3 vers le centre tout ce qui est en croix 3 puis 17–19 Eau aux ennemis : regroupe.
- Tags : `trap`, `placement`, `damage`, `water`

#### 18B. Piège à Fragmentation (id 12941)

- **4 PA** · PO 1–6 (modifiable) · sans LdV, case libre requise, case sans piège requise · 1/tour · CC 0 % · élément(s) : Feu
- Grades : g1 niv.180 (grade utilisé : 1).
- Description du jeu : « Pose un piège mono-cellule qui occasionne des dommages Feu en zone. Les dommages sont plus importants sur la case centrale et selon la distance avec le piège. N'affecte pas l'entité qui déclenche le piège si c'est un allié. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège à Fragmentation» (12954, grade 1)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège à Fragmentation» (12954, grade 1)
    - *Sous-sort «Piège à Fragmentation» (id 12954, grade 1)*
      - 47 à 51 dommages Feu — cibles : ennemis
      - 27 à 31 dommages Feu — zone : anneau de taille 1
      - 37 à 41 dommages Feu — zone : anneau de taille 2
      - 47 à 51 dommages Feu — zone : anneau de taille 3
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 4 PA, 1/tour : piège mono-cellule — 47–51 Feu sur la case centrale et 27–31 / 37–41 / 47–51 Feu sur les anneaux 1/2/3 (alliés compris, sauf l'allié déclencheur).
- Tags : `trap`, `damage`, `aoe`, `fire`

### Paire 19 : Concentration de Chakra / Manigance

> Choix : Manigance (+20 Dommages/Fuite alliés, vol aux ennemis) ; Concentration de Chakra (vol à chaque dégât de piège).

#### 19A. Concentration de Chakra (id 12903)

- **3 PA** · PO 1–6 (non modifiable) · en ligne, LdV requise · relance 3 t., relance initiale 1 t. · CC 0 % · élément(s) : meilleur élément
- Grades : g1 niv.75 PO1-5 ; g2 niv.142 (grade utilisé : 2).
- Description du jeu : « Applique l'état Concentration de Chakra sur l'ennemi ciblé : • Vole de la vie dans le meilleur élément du lanceur à la cible si elle subit des dommages de pièges. Dissipe l'invisibilité du lanceur. »
- Effets (infobulle, valeurs de base) :
  - applique l'état «Concentration de Chakra» (643) — cibles : ennemis ; 1 tour(s)
  - 12 vol du meilleur élément — cibles : ennemis ; si la cible est le monstre «monstre#50000» (50000) ; 1 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - applique l'état «Concentration de Chakra» (643) — cibles : ennemis ; 1 tour(s)
  - 12 vol du meilleur élément — cibles : ennemis ; si la cible est le monstre «monstre#50000» (50000) ; 1 tour(s)
  - le lanceur lance le sort «Concentration de Chakra» (24003, grade 3) — cibles : ennemis ; déclenchement : quand le porteur subit des dommages de piège (buff 1 t.)
    - *Sous-sort «Concentration de Chakra» (id 24003, grade 3)*
      - le lanceur lance le sort «Concentration de Chakra» (24003, grade 4) — cibles : ennemis
        - *Sous-sort «Concentration de Chakra» (id 24003, grade 4)*
          - 12 vol du meilleur élément — cibles : ennemis
- **Rôle tactique** : 3 PA en ligne, relance 3 : état 1 tour sur un ennemi ; chaque dégât de piège qu'il subit déclenche un vol de vie de 12 (base) dans le meilleur élément. Dissipe l'invisibilité du Sram.
- Tags : `steal`, `trap_synergy`

#### 19B. Manigance (id 14741)

- **2 PA** · PO 0–5 (modifiable) · sans LdV, cible requise (case occupée) · 2/tour, 1/cible · CC 0 %
- Grades : g1 niv.185 (grade utilisé : 1).
- Description du jeu : « Vole de la Fuite et des Dommages aux ennemis ou augmente ceux du lanceur et de l'allié ciblé. »
- Effets (infobulle, valeurs de base) :
  - -20 Fuite — cibles : ennemis ; 3 tour(s)
  - -20 Dommages — cibles : ennemis ; 3 tour(s)
  - 20 Fuite — cibles : lanceur, alliés (lanceur inclus) ; 3 tour(s)
  - 20 Dommages — cibles : lanceur, alliés (lanceur inclus) ; 3 tour(s)
- **Rôle tactique** : 2 PA : sur un ennemi −20 Fuite et −20 Dommages (3 tours) ; sur un allié +20 Fuite et +20 Dommages au lanceur et à l'allié (3 tours). 2/tour.
- Tags : `buff_damage`, `debuff`, `team_amp`

### Paire 20 : Piège Mortel / Calamité

> Choix : Piège Mortel (49–54 sous 50 % PV) ; Calamité (40–44 Eau en carré + vol Fuite).

#### 20A. Piège Mortel (id 12921)

- **3 PA** · PO 1–8 (modifiable) · en ligne, sans LdV, case libre requise, case sans piège requise · 2/tour · CC 0 % · élément(s) : Terre
- Grades : g1 niv.80 PO1-7 ; g2 niv.147 (grade utilisé : 2).
- Description du jeu : « Pose un piège qui occasionne des dommages Terre. Les dommages sont plus importants sur les entités ayant moins de 50% de leurs points de vie. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Piège Mortel» (12927, grade 2)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Piège Mortel» (12927, grade 2)
    - *Sous-sort «Piège Mortel» (id 12927, grade 2)*
      - 39 à 43 dommages Terre — cibles : tous ; si la cible a au moins 50% PV
      - 49 à 54 dommages Terre — cibles : tous ; si la cible a moins de 50% PV
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 3 PA en ligne : piège mono-cellule — 39–43 Terre, 49–54 sous 50 % PV (touche aussi les alliés).
- Tags : `trap`, `damage`, `execute`, `earth`

#### 20B. Calamité (id 12950)

- **4 PA** · PO 1–8 (modifiable) · sans LdV, case libre requise, case sans piège requise · 1/tour · CC 0 % · élément(s) : Eau
- Grades : g1 niv.190 (grade utilisé : 1).
- Description du jeu : « Pose un piège qui vole de la Fuite et occasionne des dommages Eau aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - pose un piège «Calamité» (12963, grade 1) — zone : carré de taille 1
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - pose un piège «Calamité» (12963, grade 1) — zone : carré de taille 1
    - *Sous-sort «Calamité» (id 12963, grade 1)*
      - le lanceur lance le sort «Calamité» (12963, grade 2) — cibles : ennemis ; zone : carré de taille 1
        - *Sous-sort «Calamité» (id 12963, grade 2)*
          - -20 Fuite — cibles : ennemis ; 2 tour(s)
          - 20 Fuite — cibles : lanceur ; 2 tour(s)
      - 40 à 44 dommages Eau — cibles : ennemis ; zone : carré de taille 1
      - la cible lance le sort «Pièges» (12968, grade 1) — cibles : lanceur
        - (sous-sort «Pièges» 12968 g1 déjà détaillé plus haut)
- **Rôle tactique** : 4 PA, 1/tour : piège carré 1 — 40–44 Eau aux ennemis et vol de 20 Fuite (2 tours).
- Tags : `trap`, `damage`, `aoe`, `water`

### Paire 21 : Fourvoiement / Perfidie

> Choix : Perfidie (56–60 au contact, coût réduit par les pièges) en Terre ; Fourvoiement (Air, érosion) en Air.

#### 21A. Fourvoiement (id 12909)

- **4 PA** · PO 0–5 (non modifiable) · LdV requise · 2/tour · CC 20 % · élément(s) : Air
- Grades : g1 niv.85 dmg 27–31 PO0-4 ; g2 niv.152 dmg 32–36 (grade utilisé : 2).
- Description du jeu : « Érode les cibles et occasionne des dommages Air en zone. N'affecte pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 13% Érosion — cibles : alliés (hors lanceur), ennemis ; zone : croix sans centre de taille 1 ; 2 tour(s)
  - 32 à 36 dommages Air (CC : 38 à 43 dommages Air) — cibles : alliés (hors lanceur), ennemis ; zone : croix sans centre de taille 1
- **Rôle tactique** : 4 PA : 13 % d'érosion (2 tours) et 32–36 Air en croix autour de la case ciblée (pas le centre).
- Tags : `damage`, `erosion`, `aoe`, `air`

#### 21B. Perfidie (id 12949)

- **6 PA** · PO 1–1 (non modifiable) · LdV requise, cible requise (case occupée) · 3/tour, 2/cible · CC 25 % · élément(s) : Terre
- Grades : g1 niv.195 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Terre. Le coût en PA du sort est réduit pour chaque piège déclenché du lanceur. Les effets sont retirés après utilisation du sort. »
- Effets (infobulle, valeurs de base) :
  - 56 à 60 dommages Terre (CC : 62 à 66 dommages Terre)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 56 à 60 dommages Terre (CC : 62 à 66 dommages Terre)
  - retire les effets du sort «Perfidie» (12972) — cibles : lanceur
- **Rôle tactique** : 6 PA au contact : 56–60 Terre (CC 62–66, 25 % CC), −1 PA par piège déclenché (jusqu'à 2 PA), 3/tour 2/cible : le plus gros burst de la classe.
- Tags : `damage`, `burst`, `earth`, `trap_synergy`

### Paire 22 : Dérobade / Marque Mortuaire

> Choix : Marque Mortuaire (×110 % + 30 % érosion au palier IV) pour l'équipe ; Dérobade pour protéger un allié.

#### 22A. Dérobade (id 14312)

- **2 PA** · PO 0–5 (modifiable) · sans LdV · relance 3 t. · CC 0 %
- Grades : g1 niv.90 PO0-4 ; g2 niv.157 (grade utilisé : 2).
- Description du jeu : « Réduit les dommages subis par l'allié ciblé, le rend Intaclable et lui applique l'état Dérobade : • Éloigne la cible de son attaquant et augmente ses PM si elle est attaquée par un ennemi (cumulable 3 fois). Le recul ne fait pas de dommages. »
- Effets (infobulle, valeurs de base) :
  - Dommages subis x90% — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur subit des dommages d'un ennemi (buff 1 t.) ; indésenvoûtable
  - applique l'état «Intaclable» (96) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
  - applique l'état «Dérobade» (5595) — cibles : alliés (lanceur inclus) ; 1 tour(s)
  - Repousse de 2 cases (sans dommages) — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur subit des dommages d'un ennemi (buff 1 t.) ; indésenvoûtable
  - 1 PM — cibles : alliés (lanceur inclus) ; 1 tour(s) ; déclenchement : quand le porteur subit des dommages d'un ennemi (buff 1 t.) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Dérobade» (28742, grade 1) — cibles : alliés (lanceur inclus)
    - *Sous-sort «Dérobade» (id 28742, grade 1)*
      - Dommages subis x90% — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur subit des dommages (buff 1 t.) ; indésenvoûtable
      - applique l'état «Intaclable» (96) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
      - applique l'état «Dérobade» (5595) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Dérobade» (28742, grade 2) — cibles : alliés (lanceur inclus) ; déclenchement : quand le porteur subit des dommages d'un ennemi (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Dérobade» (id 28742, grade 2)*
          - applique l'état «Dérobade (cible)» (2750) — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
          - le lanceur lance le sort «Dérobade» (28742, grade 3) — cibles : ennemis ; si la cible est la cible principale
            - *Sous-sort «Dérobade» (id 28742, grade 3)*
              - retire l'état «Dérobade (cible)» (2750) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Dérobade (cible)» (2750) ; zone : cercle de taille 63 (à partir de 1)
              - Repousse de 2 cases (sans dommages) — cibles : alliés (lanceur inclus) ; si la cible a l'état «Dérobade (cible)» (2750) ; zone : cercle de taille 63 (à partir de 1)
          - 1 PM — cibles : alliés (lanceur inclus) ; 1 tour(s) ; indésenvoûtable
- **Rôle tactique** : 2 PA, relance 3 : un allié prend ×90 % de dommages des ennemis, devient Intaclable et, à chaque coup ennemi, recule de 2 (sans dommages) et gagne +1 PM (3 cumuls).
- Tags : `protection`, `mobility`, `ally_support`

#### 22B. Marque Mortuaire (id 14313)

- **2 PA** · PO 1–6 (non modifiable) · LdV requise, cible requise (case occupée) · 2/tour, 1/cible · CC 0 %
- Grades : g1 niv.200 (grade utilisé : 1).
- Description du jeu : « Augmente les dommages subis par la cible et l'érode. Les effets sont plus importants selon le nombre de pièges déclenchés du lanceur. Dissipe l'invisibilité du lanceur. »
- Effets (infobulle, valeurs de base) :
  - Dommages subis x102% — cibles : tous ; si le lanceur n'a pas l'état «Marque Mortuaire I» (1407) ; si le lanceur n'a pas l'état «Marque Mortuaire II» (1408) ; si le lanceur n'a pas l'état «Marque Mortuaire III» (1409) ; si le lanceur n'a pas l'état «Marque Mortuaire IV» (1410) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 10% Érosion — cibles : tous ; si le lanceur n'a pas l'état «Marque Mortuaire I» (1407) ; si le lanceur n'a pas l'état «Marque Mortuaire II» (1408) ; si le lanceur n'a pas l'état «Marque Mortuaire III» (1409) ; si le lanceur n'a pas l'état «Marque Mortuaire IV» (1410) ; 2 tour(s)
  - Dommages subis x104% — cibles : tous ; si le lanceur a l'état «Marque Mortuaire I» (1407) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 15% Érosion — cibles : tous ; si le lanceur a l'état «Marque Mortuaire I» (1407) ; 2 tour(s)
  - Dommages subis x106% — cibles : tous ; si le lanceur a l'état «Marque Mortuaire II» (1408) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 20% Érosion — cibles : tous ; si le lanceur a l'état «Marque Mortuaire II» (1408) ; 2 tour(s)
  - Dommages subis x108% — cibles : tous ; si le lanceur a l'état «Marque Mortuaire III» (1409) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 25% Érosion — cibles : tous ; si le lanceur a l'état «Marque Mortuaire III» (1409) ; 2 tour(s)
  - Dommages subis x110% — cibles : tous ; si le lanceur a l'état «Marque Mortuaire IV» (1410) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 30% Érosion — cibles : tous ; si le lanceur a l'état «Marque Mortuaire IV» (1410) ; 2 tour(s)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - Dommages subis x102% — cibles : tous ; si le lanceur n'a pas l'état «Marque Mortuaire I» (1407) ; si le lanceur n'a pas l'état «Marque Mortuaire II» (1408) ; si le lanceur n'a pas l'état «Marque Mortuaire III» (1409) ; si le lanceur n'a pas l'état «Marque Mortuaire IV» (1410) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 10% Érosion — cibles : tous ; si le lanceur n'a pas l'état «Marque Mortuaire I» (1407) ; si le lanceur n'a pas l'état «Marque Mortuaire II» (1408) ; si le lanceur n'a pas l'état «Marque Mortuaire III» (1409) ; si le lanceur n'a pas l'état «Marque Mortuaire IV» (1410) ; 2 tour(s)
  - Dommages subis x104% — cibles : tous ; si le lanceur a l'état «Marque Mortuaire I» (1407) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 15% Érosion — cibles : tous ; si le lanceur a l'état «Marque Mortuaire I» (1407) ; 2 tour(s)
  - Dommages subis x106% — cibles : tous ; si le lanceur a l'état «Marque Mortuaire II» (1408) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 20% Érosion — cibles : tous ; si le lanceur a l'état «Marque Mortuaire II» (1408) ; 2 tour(s)
  - Dommages subis x108% — cibles : tous ; si le lanceur a l'état «Marque Mortuaire III» (1409) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 25% Érosion — cibles : tous ; si le lanceur a l'état «Marque Mortuaire III» (1409) ; 2 tour(s)
  - Dommages subis x110% — cibles : tous ; si le lanceur a l'état «Marque Mortuaire IV» (1410) ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 30% Érosion — cibles : tous ; si le lanceur a l'état «Marque Mortuaire IV» (1410) ; 2 tour(s)
  - retire les effets du sort «Marque Mortuaire» (14319) — cibles : lanceur
  - 1 dommages Neutre — cibles : tous ; si la cible est le monstre «monstre#50000» (50000)
- **Rôle tactique** : 2 PA, cible requise : dommages subis ×102 % → ×110 % et érosion 10 % → 30 % (2 tours) selon le nombre de pièges déclenchés (paliers I–IV, remis à 0).
- Tags : `debuff`, `erosion`, `team_amp`, `trap_synergy`

## Le Sram en groupe PvM (niveau 200, 4 personnages)

### Rôles possibles
1. **DPS Terre (burst pièges)** : Piège Mortel/Funeste/Effroyable + Chausse-trappe, Perfidie (6 PA → 2 PA), Attaque
   Mortelle (54–60 sous 50 % PV), Truanderie (vol de Puissance), Extorsion. Les guides 2025 citent la voie Terre pour le
   burst à la sortie d'invisibilité.
2. **DPS Air (poisons)** : Arsenic, Injection Toxique, Toxines, Épidémie (propagation de zone), Fourvoiement, Arnaque ;
   efficace contre des groupes de monstres serrés et dans les contenus durs (dégâts sur la durée).
3. **Entraveur/placeur secondaire** : Piège d'Immobilisation (−4 PM en cercle 3), Fosse Commune (Pesanteur), Brume (−4 PO),
   Arsenic (−2 PO), Injection Toxique (−1 PM 3 tours), Manigance (−20 Dommages ennemis / +20 alliés), Marque Mortuaire.

### Voie conseillée
- **Terre** ou **Air** en PvM (source gamosaurus, mise à jour 2 oct. 2025 : « les voies Terre et Air sont remarquables en
  PvM »), **Multi DoCrit** possible. Stats : élément principal, Puissance, Dommages, **Puissance pièges / Dommages pièges**
  (pièges), Critique + Dommages critiques pour les coups directs (les pièges ne critiquent pas), PA 11–12, PM 5–6, PO.

### Choix de variantes par rôle
| Paire | DPS Terre pièges | DPS Air poisons | Utilitaire |
|---|---|---|---|
| 1 Truanderie / Chausse-trappe | B | A | A |
| 2 Sournoiserie / Coupe-gorge | A | B | B |
| 3 Arsenic / Toxines | A | B (ou A) | A |
| 4 Cruauté / Poisse | A | A | B |
| 5 Invisibilité / Brume | A | A | B |
| 6 Double / Comploteur | B | A | A |
| 7 Piège Sournois / Guet-apens | A | B | A |
| 8 Piège Fangeux / Épidémie | A | B | A |
| 9 Piège Funeste / Effraction | A | A | A |
| 10 Piège Répulsif / Piège Effroyable | B | A | A |
| 11 Piège d'Immobilisation / Fosse Commune | A | A | A |
| 12 Extorsion / Perquisition | A | B | B |
| 13 Arnaque / Larcin | A | A | A |
| 14 Pillage / Attaque Mortelle | B | A | A |
| 15 Fourberie / Injection Toxique | B | B | B |
| 16 Peur / Méprise | A | A | B |
| 17 Piège de Dérive / Piège Insidieux | A | B | A |
| 18 Piège Scélérat / Piège à Fragmentation | B | A | A |
| 19 Concentration de Chakra / Manigance | A | B | B |
| 20 Piège Mortel / Calamité | A | B | A |
| 21 Fourvoiement / Perfidie | B | A | A |
| 22 Dérobade / Marque Mortuaire | B | B | A |

### Rotations types (12 PA / 6 PM)
- **Pièges puis burst (Terre)** — Tour 1 : Invisibilité (2) → Piège Mortel (3) sur le chemin d'un ennemi → Piège Effroyable (2)
  → Peur (2) pour pousser un ennemi dans le piège → Truanderie (3). Tour 2 (compteurs chargés) : Perfidie à coût réduit
  (2–4 PA) → Chausse-trappe (4, +8 à +40) → Attaque Mortelle (4) ou Marque Mortuaire (2) d'abord pour ×110 % et 30 % d'érosion.
- **Poisons (Air)** : Injection Toxique (5, −1 PM + poison 3 tours) → Épidémie (4) sur l'ennemi au centre du paquet →
  Arsenic (3) sur un second. Tour suivant : Toxines (3) + Fourvoiement (4) + Arnaque (3) + 2 PA (Invisibilité).
- **Utilitaire** : Brume (3, alliés invisibles, −4 PO ennemis) → Piège d'Immobilisation (3, −4 PM cercle 3) → Manigance (2,
  +20 Dommages à l'allié DPS) → Coupe-gorge (4, ×110 % sur la cible du groupe).

### Forces / faiblesses
Forces : très gros dégâts (burst Perfidie/Chausse-trappe/Attaque Mortelle, poisons de zone), invisibilité pour survivre,
pièges invisibles qui ne consomment pas la ligne de vue, nombreux outils de placement, amplificateurs d'équipe (×110 %,
érosion, +20 Dommages), retrait de PM de zone (Piège d'Immobilisation).
Faiblesses : pièges inutiles contre des ennemis immobiles ou volants/inébranlables, dépendance aux déplacements ennemis,
pièges et zones qui peuvent toucher les alliés, dégâts de pièges sans critique, fragile s'il est révélé (Lanterne,
Coffre, sorts de zone).

### Synergies
- **Pandawa / Osamodas / Féca (placement)** : poussent/attirent/portent les ennemis dans les pièges (Laisse Spirituelle,
  Cravache, Regroupement, Sonnailles).
- **Enutrof / Féca (entrave)** : ennemis à 0 PM ⇒ pièges posés sur leur case adjacente + Peur pour les y pousser ; ennemis
  immobiles = cibles faciles pour Épidémie.
- **Iop / Crâ** : Marque Mortuaire (×110 % + 30 % érosion) et Coupe-gorge profitent à tout le groupe.
- **Eniripsa / Osamodas** : Poisse soigne les alliés autour de la cible.
- **Xélor** (téléportations) et **Roublard** (bombes/poussées) pour déclencher les pièges.

## Points incertains (INCERTAIN)

- Règles exactes de déclenchement des pièges (poussée/attirance/téléportation, arrêt du mouvement, durée de vie) : règles générales Dofus à confirmer.
- Origine des états de rang de Toxines (2763/2764) et des états compteurs 3762–3766 (« états de deck ») : supposés posés en début de combat selon les sorts équipés.
- Moment où les caractéristiques du Sram sont lues pour un poison (pose ou déclenchement).
- globalCooldown = 1 sur Invisibilité : relance partagée entre Srams de l'équipe ?
- Comportement exact de Peur (cible = entité adjacente dans la direction) déduit du code DoMath.

## Sources
- Données de jeu : https://api.dofusdb.fr/breeds/4, https://api.dofusdb.fr/spell-variants?breedId=4, `/spells`,
  `/spell-levels`, `/spell-states`, consultées le 2026-10-04.
- Voies PvM Terre/Air (2 oct. 2025) : https://www.gamosaurus.com/jeux/dofus/guide-stuff-sram-dofus-items-dofusbook-equipements
- Équilibrages Sram 2.70 (Chausse-trappe, Perfidie, Marque Mortuaire, Méprise) : https://www.gamosaurus.com/jeux/dofus/les-equilibrages-sram-avec-dofus-2-70 ,
  https://www.millenium.org/guide/336066.html
- Déclencheurs (DT, X, TB/TE…), masques et statistiques de pièges : code DoMath/Bubble (`HaxeBuff`, `SpellManager`,
  `ActionConstants.StatBuffActionIds`) en cache `.cache/domath/haxe`, https://domath.fr
- Noms des actions : https://github.com/PyDofus/pydofus3 (`ActionId.py`).

