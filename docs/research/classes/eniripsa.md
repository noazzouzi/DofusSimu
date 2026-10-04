# Eniripsa (classe 7) — analyse complète pour le simulateur

> Données : API DofusDB (`/breeds/7`, `/spell-variants?breedId=7`, `/spells`, `/spell-levels`, `/spell-states`, `/monsters`),
> fichiers du jeu Dofus 3 (enregistrements mis à jour jusqu'au 2026-06-30), extraits le 2026-10-04 ; les données
> `data/dofusdb/class-spells.json` du dépôt ont été vérifiées identiques à l'API live (91 niveaux de sorts, 0 écart).
> Toutes les valeurs sont celles du **grade le plus élevé utilisable au niveau 200**. Les guides web ne servent qu'à
> l'interprétation ; en cas de désaccord, les données du jeu priment. Fichier machine associé :
> [`data/research/class-mechanics/eniripsa.json`](../../../data/research/class-mechanics/eniripsa.json). Dump brut décodé (tous
> sous-sorts développés) : `.cache/classes/b5_8/dump/breed_7.txt` (non versionné).

**Identité** : « Guérisseur » (complexité 1). Rôles officiels DofusDB (`breeds/7.roles`, /12) : **Soins 12** (« soigne les
alliés dans tous les éléments »), **Entrave 9** (« retire PA, PM, Puissance et Dommages avec ses Moqueries »),
**Amélioration 9** (« augmente PA, PM et Puissance avec ses Encouragements »), Dégâts 7, Placement 5, Invocation 5,
Protection 2, Tank 0.

**Résumé tactique** : l'Eniripsa est LE soigneur du jeu : presque tous ses sorts élémentaires « soignent les alliés OU
frappent les ennemis » avec les mêmes valeurs (Mot Tapageur, Onguent Ancestral, Scalpel, Mot Turbulent, Mot Farceur,
Mot Secret, Mot Interdit, Mot Distrayant, Bosquet Enchanté, Chœur Strident, Murmure…), complétés par des soins en
pourcentage (Mot de Jouvence 10 % PV max + début de tour, Fontaine de Jouvence 10 % en zone, Mot de Reconstitution
100 %) et des soins « vampiriques » (Sanglots, Lamentations). Ses **Encouragements** (Stimulant +2 PA, Vivifiant +2 PM,
Galvanisant +150 Puissance + bouclier, Jouvence soin/désenvoûtement) et **Moqueries** (Décourageant −2 PA, Accablant
−3 PM, Déprimant −150 Puissance −25 Dommages, Déclin −1 tour d'effets et ×0,75 soins reçus) partagent un même cumul et,
lancés sur une case vide, invoquent une **Luciole** contrôlable (Fée ou Feu Follet, 2 max par tour) qui porte l'effet
plus loin. Deux invocations « alchimiques » complètent le kit : le **Lapino** (soin/bouclier, ou forme Mutante offensive
dans l'élément du dernier Mot) et les **Fioles** (remplies par les Mots élémentaires, consommées pour soigner + donner
+150 caractéristique, ou explosées). Tout Mot élémentaire qui touche un Lapino/une Fiole rembourse 1 PA (1×/tour) :
c'est l'**Alchi-Rhétorique**.

## Sommaire

- Tableau des 22 paires · Efficacité brute · Mécaniques spécifiques · Détail de tous les sorts · Invocations · Rôle en groupe PvM (variantes, rotations, synergies) · États importants · Points incertains · Sources

## Tableau des 22 paires de sorts (variantes)

Chaque ligne est une paire de variantes : un personnage n'équipe qu'**un seul** sort de chaque paire (choix hors combat). Le niveau indiqué est celui du déblocage.

| # | Variante A | PA | Variante B | PA | Notes |
|---|---|---|---|---|---|
| 1 | Mot Espiègle (25877, niv. 1) | 3 | Mot Malicieux (25878, niv. 95) | 4 | Mot Espiègle (−2 PM, Air) pour l'entrave ; Mot Malicieux (Air, −30 Puissance par PM utilisé) contre un monstre mobile. |
| 2 | Mot Tapageur (25858, niv. 1) | 3 | Cri Assourdissant (25857, niv. 100) | 3 | Mot Tapageur (soin + dommages Feu en croix 2) est le soin de zone de base ; Cri Assourdissant (−2 PA) pour l'entrave. |
| 3 | Mot Vampirique (25870, niv. 1) | 3 | Sanglots (25872, niv. 105) | 3 | Mot Vampirique (vol Eau / transfert de vie) ; Sanglots (soin des alliés proches = 100 % des dommages). |
| 4 | Juron (25867, niv. 1) | 3 | Onguent Ancestral (25869, niv. 110) | 4 | Juron (Terre + poussée) ou Onguent Ancestral (soin/dommages Terre, ×1,25 / ×0,75 soins reçus). |
| 5 | Mot d'Amitié (25795, niv. 5) | 3 | Mot Alchimique (25802, niv. 115) | 2 | Mot d'Amitié (Lapino soigneur/bouclier) en groupe ; Mot Alchimique (Fioles) pour les buffs de caractéristique. |
| 6 | Mot Stimulant (25742, niv. 10) | 2 | Mot de Déclin (25746, niv. 120) | 2 | Mot Stimulant (+2 PA) est quasi obligatoire ; Mot de Déclin contre un boss qui se soigne/se buffe. |
| 7 | Mot de Frayeur (13175, niv. 15) | 1 | Scalpel (25832, niv. 125) | 4 | Scalpel (40–44 soin/dommages meilleur élément, désenvoûtement) ; Mot de Frayeur (poussée 1 PA). |
| 8 | Lamentations (25871, niv. 20) | 4 | Vacarme (25856, niv. 130) | 3 | Lamentations (vol Eau en cercle 2 + soins) ou Vacarme (soin/dommages Feu, Feux Follets). |
| 9 | Mot Turbulent (25860, niv. 25) | 4 | Mot Furieux (25865, niv. 135) | 4 | Mot Turbulent (soin/dommages Feu croix 1) ; Mot Furieux (cône Terre + poussée 3). |
| 10 | Mot Vivifiant (25744, niv. 30) | 2 | Mot Galvanisant (25745, niv. 140) | 2 | Mot Vivifiant (+2 PM, Fuite) ou Mot Galvanisant (+150 Puissance + bouclier 300). |
| 11 | Mot Farceur (25879, niv. 35) | 3 | Mot Défendu (25876, niv. 145) | 4 | Mot Farceur (soin/dommages Air + retour en fin de tour) ; Mot Défendu (cône vol Eau + attirance). |
| 12 | Peinture de Guerre (25868, niv. 40) | 2 | Mot Secret (25882, niv. 150) | 4 | Peinture de Guerre (soin périodique / −60 rés. poussée) ; Mot Secret (ligne Air, 58–62 tous les 2 tours). |
| 13 | Mot de Jouvence (25743, niv. 45) | 2 | Mot Déprimant (25748, niv. 155) | 2 | Mot de Jouvence (soin 10 % ×2 + désenvoûtement) ; Mot Déprimant (−150 Puissance, −25 Dommages). |
| 14 | Cri de Guerre (25863, niv. 50) | 4 | Mot Rituel (25864, niv. 160) | 3 | Cri de Guerre (Terre autour de soi + repousse 4) ; Mot Rituel (aura de Peinture, soin cercle 2). |
| 15 | Mot Interdit (25873, niv. 55) | 5 | Mot Exsangue (13217, niv. 165) | 4 | Mot Interdit (46–50 soin/dommages Eau) ; Mot Exsangue (les attaquants de la cible se soignent de 25 %). |
| 16 | Mot Accablant (25749, niv. 60) | 2 | Mot Décourageant (25747, niv. 170) | 2 | Mot Accablant (−3 PM) ou Mot Décourageant (−2 PA). |
| 17 | Chapardage (25859, niv. 65) | 3 | Mot Distrayant (25862, niv. 175) | 4 | Chapardage (vol de PO + vol Feu) ; Mot Distrayant (regroupe + soin/dommages Feu croix 3). |
| 18 | Mot Fleuri (25880, niv. 70) | 4 | Bosquet Enchanté (25881, niv. 180) | 4 | Mot Fleuri (Air + soin de fin de tour) ; Bosquet Enchanté (zone autour des alliés Encouragés). |
| 19 | Mot d'Envol (13184, niv. 75) | 3 | Fontaine de Jouvence (25874, niv. 185) | 3 | Mot d'Envol (échange avec un allié) ; Fontaine de Jouvence (10 % PV max en zone ×2). |
| 20 | Pinceau Tribal (25866, niv. 80) | 3 | Chœur Strident (25861, niv. 190) | 5 | Pinceau Tribal (Peintures) ; Chœur Strident (40–44 soin/dommages Feu + rampe). |
| 21 | Cryothérapie (25875, niv. 85) | 3 | Murmure (25883, niv. 195) | 2 | Cryothérapie (bouclier 200 / −60 Fuite + explosion) ; Murmure (2 PA, vol 1 PM / +1 PM). |
| 22 | Mot de Reconstitution (13187, niv. 90) | 5 | Mot de Solidarité (13219, niv. 200) | 1 | Mot de Reconstitution (soin 100 %, relance 6) ; Mot de Solidarité (transferts de vie). |

## Efficacité brute des sorts de dommages (grade niveau 200, avant caractéristiques)

Moyenne du jet de base (hors critique) ; « /PA » = moyenne ÷ coût. Les bonus conditionnels (rampes, Téléfrag, cartes…) sont indiqués en remarque. Un sort de zone touche potentiellement plusieurs cibles.

| Sort | Paire | PA | Élément | Base | CC | Moy. | Moy./PA | Zone | Lancers/tour | Remarque |
|---|---|---|---|---|---|---|---|---|---|---|
| Scalpel | 7B | 4 | meilleur élt. | 40–44 | 48–53 | 42.0 | 10.5 | cible | 1 (relance 3) | soin miroir meilleur élément |
| Mot Rituel | 14B | 3 | Terre | 28–32 | 34–38 | 30.0 | 10.0 | anneau de rayon exactement 3 | 1 (relance 2) | soin miroir Terre |
| Cri de Guerre | 14A | 4 | Terre | 37–41 | 44–49 | 39.0 | 9.8 | anneau 1–3 autour de l'impact (centre exclu), non dégressive | 1 |  |
| Mot Turbulent | 9A | 4 | Feu | 36–41 | 43–49 | 38.5 | 9.6 | croix de 1 | 1 | soin miroir Feu |
| Mot Exsangue | 15B | 4 | Eau | 37–40 | 41–45 | 38.5 | 9.6 | cible | 2 | soin miroir Eau; attaquants soignés de 25 % |
| Mot Interdit | 15A | 5 | Eau | 46–50 | 55–60 | 48.0 | 9.6 | cible | 1 | soin miroir Eau |
| Mot Vampirique | 3A | 3 | Eau | 27–30 | 32–36 | 28.5 | 9.5 | cible | 3 | vol de vie |
| Onguent Ancestral | 4B | 4 | Terre | 35–38 | 40–44 | 36.5 | 9.1 | cible | 2 | soin miroir Terre |
| Bosquet Enchanté | 18B | 4 | Air | 34–38 | 40–45 | 36.0 | 9.0 | cercle de rayon 2 | 1 | soin miroir Air |
| Vacarme | 8B | 3 | Feu | 25–28 | 30–33 | 26.5 | 8.8 | cible | 2 | soin miroir Feu |
| Mot Fleuri | 18A | 4 | Air | 33–37 | 40–44 | 35.0 | 8.8 | croix diagonale de 1 | 2 | soin miroir Air |
| Cri Assourdissant | 2B | 3 | Feu | 24–28 | 30–34 | 26.0 | 8.7 | cible | 2 |  |
| Murmure | 21B | 2 | Air | 16–18 | 19–22 | 17.0 | 8.5 | cible | 2 | soin miroir Air |
| Chœur Strident | 20B | 5 | Feu | 40–44 | 48–53 | 42.0 | 8.4 | cible | 1 | soin miroir Feu; +5/+10/+15 (Chœur Strident) |
| Sanglots | 3B | 3 | Eau | 23–26 | 28–31 | 24.5 | 8.2 | cible | 2 | soigne les alliés autour (100 % des dégâts) |
| Mot Malicieux | 1B | 4 | Air | 30–34 | 36–41 | 32.0 | 8.0 | cible | 3 |  |
| Mot Furieux | 9B | 4 | Terre | 30–34 | 36–41 | 32.0 | 8.0 | cône de 2 | 1 |  |
| Mot Distrayant | 17B | 4 | Feu | 30–34 | 37–41 | 32.0 | 8.0 | croix de 3 | 1 | soin miroir Feu |
| Mot Tapageur | 2A | 3 | Feu | 22–25 | 27–30 | 23.5 | 7.8 | croix de 2 | 2 | soin miroir Feu |
| Juron | 4A | 3 | Terre | 22–25 | 26–30 | 23.5 | 7.8 | cible | 2 |  |
| Mot Farceur | 11A | 3 | Air | 22–24 | 26–28 | 23.0 | 7.7 | cible | 2 | soin miroir Air |
| Lamentations | 8A | 4 | Eau | 29–32 | 35–38 | 30.5 | 7.6 | cercle de rayon 2 | 1 | vol de vie; soigne les alliés de la zone (50 %) |
| Mot Espiègle | 1A | 3 | Air | 21–24 | 25–29 | 22.5 | 7.5 | cible | 3 |  |
| Mot Secret | 12B | 4 | Air | 28–32 | 34–38 | 30.0 | 7.5 | ligne de 3 cases (impact + 2 derrière) | 1 | soin miroir Air; +30 si non relancé au tour suivant |
| Mot Défendu | 11B | 4 | Eau | 28–31 | 34–37 | 29.5 | 7.4 | cône de 2 | 1 | vol de vie |
| Chapardage | 17A | 3 | Feu | 20–22 | 23–26 | 21.0 | 7.0 | cible | 2 | vol de vie |
| Pinceau Tribal | 20A | 3 | Terre | 19–22 | 23–26 | 20.5 | 6.8 | cible | 2 | soin miroir Terre; +8 par ennemi peint (sur soi) |
| Peinture de Guerre | 12A | 2 | Terre | 9–11 | 12–14 | 10.0 | 5.0 | cible | 2 | soin miroir Terre |
| Cryothérapie | 21A | 3 | Eau | 14–16 | 17–19 | 15.0 | 5.0 | cible | 2 | soin miroir Eau |

## Mécaniques spécifiques à implémenter

### 1. Soins et dommages miroirs

La majorité des sorts portent deux effets de mêmes valeurs : un soin élémentaire (108 Feu, 2998 Eau, 2999 Air, 3000 Terre, 3002 meilleur élément) sur les alliés (masque a ou g) et un dommage du même élément sur les ennemis (A). Les soins sont boostés par la caractéristique de l'élément (Intelligence pour Feu, Chance Eau, Agilité Air, Force Terre) et le bonus Soins fixe ; la Puissance ne s'applique PAS aux soins ; plafond = PV max courants.

*Implémentation :* Formule (docs/research/formulas.md) : soin = floor((jet + soinsDeBase) × (100 + carac)/100 + Soins) × soinsFinaux, dégressivité de zone appliquée. Les vols de vie (91–95) soignent le lanceur de 50 % des dommages réellement infligés (pas de déclencheur H).

### 2. Encouragements et Moqueries (cumul partagé)

Encouragements (alliés) : Mot Stimulant (+2 PA, 2 tours), Mot Vivifiant (+2 PM et +30 Fuite, 2 tours), Mot Galvanisant (+150 Puissance et bouclier 150 % du niveau, 2 tours), Mot de Jouvence (durée des effets −1, soin 10 % PV max immédiat puis en début de tour pendant 2 tours). Moqueries (ennemis) : Mot Décourageant (−2 PA esquivables, −20 Esquive PA), Mot Accablant (−3 PM esquivables, −20 Esquive PM), Mot Déprimant (−150 Puissance, −25 Dommages), Mot de Déclin (durée −1, soins reçus ×75 %). Chaque application retire les 4 effets de la même famille déjà présents (406 sur les 4 sous-sorts) : une cible n'a qu'UN Encouragement (état Encouragé #4157) et qu'UNE Moquerie (état Moqué #4163) à la fois. 2 PA, 1 lancer par tour pour chaque sort.

*Implémentation :* Les valeurs dépendent d'états « rang » du lanceur (Vivifiant #5171–#5173 : Fuite 10/20/30 ; Jouvence #5174–#5176 : 6/8/10 % ; Accablant #5168–#5170 : −2/−2/−3 PM, Esquive −10/−15/−20) qu'aucun sort ne pose : supposés posés par le serveur selon le grade du sort (INCERTAIN) — au niveau 200, rang maximal.

### 3. Lucioles : Fées et Feux Follets

Un Encouragement lancé sur une case libre invoque la Fée correspondante (#7372 Stimulante, #7373 Jouvence, #7374 Vivifiante, #7375 Galvanisante) ; une Moquerie invoque le Feu Follet correspondant (#7376 Décourageant, #7377 Déclin, #7378 Accablant, #7379 Déprimant). Lucioles contrôlables : 4 PA, 5 PM, 30 % des PV et 100 % des caractéristiques/dommages élémentaires de l'Eniripsa (INCERTAIN), Intaclables et Intacleurs, état Encouragé (Fées). Elles meurent après avoir lancé un sort, à la moindre attaque subie (D, poisons, poussée) ou à la fin de leur 2e tour. Sorts : Fée = Compliment (10 soins meilleur élément au contact), Espièglerie (échange avec un allié à 1–2 PO), Encouragement X (applique l'Encouragement à un allié au contact) ; Feu Follet = Insulte (10 dommages meilleur élément au contact), Cachoterie (échange), Moquerie X. Maximum 2 Lucioles invoquées par tour (états #5237 puis #5240 qui rendent la cible visible/case occupée obligatoire).

*Implémentation :* Invocations jouables qui consomment une place d'invocation (useSummonSlot = true). Effet net : un Encouragement ou une Moquerie porté à 5 PM + 1 PO de la Luciole, utilisable au tour suivant ; ou un échange de position. Une Luciole qui meurt avec l'état Turbulent/Farce déclenche ces effets (Mot Turbulent/Mot Farceur g2, DECL[X]).

### 4. Alchi-Rhétorique, Lapino et Fioles

Chaque Mot élémentaire lance le sous-sort Alchi-Rhétorique #25797 (g1 Terre, g2 Feu, g3 Eau, g4 Air) sur les Lapino (#7370) et Fioles (#7371) de l'Eniripsa touchés : (1) Lapino → état « Mot de <élément> » (ses sorts offensifs passent dans cet élément) ; (2) Fiole vide → remplie (« Fiole Craquelée/Embrasée/Givrée/Éventée ») ; Fiole déjà pleine du MÊME élément → détruite (explosion) ; (3) 1 fois par tour (états Alchi-Rhétorique I/II) : rembourse 1 PA au lanceur pendant son tour (état #4247 « Tour Eniripsa ») ou +1 PA au tour suivant sinon, et +10 % Soins finaux (1 tour). Un Encouragement/Moquerie lancé sur le Lapino s'applique aussi aux alliés/ennemis dans un anneau 1–2 autour ; sur une Fiole, il la détruit et s'applique dans l'anneau 1–2.

*Implémentation :* Fiole pleine attaquée par un allié (trigger D) : elle est consommée — l'attaquant est soigné de 20 dans l'élément et gagne +150 de la caractéristique de l'élément pendant 3 tours (rang 2 au niveau 200). Mot Alchimique sur sa propre Fiole pleine : même consommation au profit de l'Eniripsa ; sur une Fiole vide : la détruit et rembourse 2 PA ; +1 lancer de Mot Alchimique ce tour. Fiole détruite (X) : 20 dommages de son élément aux ennemis et aux autres Fioles dans un anneau 1–2 (explosions en chaîne). Ordre : les masques de destruction (E417x) sont évalués avant le remplissage (cibles pré-calculées).

### 5. Peinture (Peinture de Guerre, Pinceau Tribal, Mot Rituel)

État Peinture (2 tours) : sur un ennemi −60 Résistances Poussée (rang 3) ; sur un allié soin Terre 9–11 au début de son tour (2 tours). Pinceau Tribal sur une cible peinte propage la peinture (anneau 1–2) et frappe/soigne en cercle 2 ; lancé sur soi, il consomme TOUTES les Peintures : 19–22 Terre à chaque ennemi peint de la carte, +8 dégâts de base par ennemi peint touché (cumul 5, appliqué avant les dommages) et +30 Dommages Poussée (2 tours, cumul 5) par allié peint.

*Implémentation :* États cachés #4243 (Peinture alliée) / #4244 (ennemie) ; rangs #4211–#4213 portés par le lanceur (INCERTAIN). Un Mot non-Terre lancé sur un Lapino/une Fiole retire sa Peinture (406 Peinture #25901).

### 6. Chœur Strident (rampe sur Moqueries)

Chœur Strident gagne +5 dégâts de base et +5 soins de base par palier (I → II → III, max +15) à chaque Moquerie appliquée par le lanceur ou à la mort d'un de ses Feux Follets (1 fois par tour), et redescend d'un palier après chaque utilisation.

*Implémentation :* Condition : le lanceur porte l'état #4202 « Chœur Strident » (posé par le serveur quand la variante est équipée — INCERTAIN). Compteur via états #4231–#4233 ; bonus 293 + 2935 infinis (dispellable 2).

### 7. Effets de fin de tour et retardés

Mot Turbulent (repousse d'1 case les entités au contact de la cible à la fin de son tour), Mot Farceur (retour à la position précédente en fin de tour), Mot Fleuri (soin en étoile 2 autour de la cible en fin de tour), Mot Secret (+30 dégâts/soins de base dans 2 tours s'il n'est pas relancé au tour suivant), Cryothérapie (explosion soin/dommages au tour suivant ou au désenvoûtement), Fontaine de Jouvence (glyphe de fin de tour 10 % PV max).

*Implémentation :* Triggers TE (fin de tour du porteur), delay 1/2 (début du N-ième prochain tour du lanceur), DIS (désenvoûtement de la cible).

### 8. Réduction de durée des effets (désenvoûtement partiel)

Scalpel, Mot Interdit (alliés et ennemis), Mot de Jouvence (allié), Mot de Déclin (ennemi) : effet 1075 « Durée des effets −1 » sur les effets désenvoûtables (dispellable = 1).

*Implémentation :* Un effet ramené à 0 est retiré ; déclenche DIS sur la cible. Ne touche pas les effets dispellable 2/3/4.

### Tableau Encouragements / Moqueries (rang maximal, niveau 200)

| Sort (paire) | Cible | Effet (2 tours sauf mention) | Luciole invoquée sur case libre | Sort spécial de la Luciole |
|---|---|---|---|---|
| Mot Stimulant (6A) | allié | +2 PA, Stimulé, Encouragé | Fée Stimulante (#7372) | Encouragement Stimulant |
| Mot Vivifiant (10A) | allié | +2 PM, +30 Fuite | Fée Vivifiante (#7374) | Encouragement Vivifiant |
| Mot Galvanisant (10B) | allié | +150 Puissance, bouclier 150 % du niveau (300) | Fée Galvanisante (#7375) | Encouragement Galvanisant |
| Mot de Jouvence (13A) | allié | durée des effets −1, soin 10 % PV max immédiat + début du tour suivant | Fée de Jouvence (#7373) | Encouragement de Jouvence |
| Mot Décourageant (16B) | ennemi | −2 PA esquivables (1 tour), −20 Esquive PA | Feu Décourageant (#7376) | Moquerie Décourageante |
| Mot Accablant (16A) | ennemi | −3 PM esquivables (1 tour), −20 Esquive PM | Feu Accablant (#7378) | Moquerie Accablante |
| Mot Déprimant (13B) | ennemi | −150 Puissance, −25 Dommages | Feu Déprimant (#7379) | Moquerie Déprimante |
| Mot de Déclin (6B) | ennemi | durée des effets −1, soins reçus ×75 % | Feu de Déclin (#7377) | Moquerie de Déclin |

Toutes les Fées ont aussi Compliment (10 soins du meilleur élément au contact) et Espièglerie (échange avec un allié) ;
tous les Feux Follets ont Insulte (10 dommages du meilleur élément au contact) et Cachoterie (échange). Chaque Luciole
meurt après son premier sort.

### Alchi-Rhétorique : quel sort remplit quoi

| Élément du Mot | Sorts | Lapino | Fiole (consommée par un allié) |
|---|---|---|---|
| Terre (g1) | Juron, Onguent Ancestral, Mot Furieux, Cri de Guerre, Mot Rituel, Peinture (ticks), Pinceau Tribal | Mot de Terre | Craquelée : 20 soins Terre, +150 Force (3 tours) |
| Feu (g2) | Mot Tapageur, Cri Assourdissant, Vacarme, Mot Turbulent, Chapardage, Mot Distrayant, Chœur Strident | Mot de Feu | Embrasée : 20 soins Feu, +150 Intelligence |
| Eau (g3) | Mot Vampirique, Sanglots, Lamentations, Mot Interdit, Mot Exsangue, Mot Défendu, Cryothérapie | Mot d'Eau | Givrée : 20 soins Eau, +150 Chance |
| Air (g4) | Mot Espiègle, Mot Malicieux, Mot Farceur, Mot Secret, Mot Fleuri, Bosquet Enchanté, Murmure | Mot d'Air | Éventée : 20 soins Air, +150 Agilité |

## Détail de tous les sorts (grade utilisable au niveau 200)

Légende des cibles : « alliés compris » = le sort affecte aussi un allié ciblé/dans la zone (masque `a`) ; « hors lanceur » = masque `g`. Les lignes « Infobulle décodée » sont générées automatiquement à partir des effets VISIBLES de l'infobulle (CC entre parenthèses) : elles incluent des effets d'affichage (`forClientOnly`) dont les cibles/zones peuvent être plus larges que les effets réellement exécutés. Pour le moteur, la référence est la liste « Effets » ci-dessus et le champ `effects` du JSON (effets réellement exécutés, sous-sorts compris dans le dump).

### Paire 1 : Mot Espiègle / Mot Malicieux

*Mot Espiègle (−2 PM, Air) pour l'entrave ; Mot Malicieux (Air, −30 Puissance par PM utilisé) contre un monstre mobile.*

#### 1A. Mot Espiègle (id 25877, niveau de déblocage 1)

- **Caractéristiques** : **3 PA** · PO 1–7 (modifiable), LdV · 3/tour · 2/cible · cumul 1 · CC 10 %
- **Description officielle** : Occasionne des dommages Air et retire des PM.
- **Effets** :
  - 21 à 24 dommages Air (CC 25 à 29) et −2 PM esquivables (1 tour) à la cible (alliés compris : masque a,A).
  - Alchi-Rhétorique Air si la cible est son Lapino/sa Fiole.
- **Rôle tactique** : 3 PA, 1–7 PO modifiable, 3/tour, 2/cible : retrait PM à distance.
- **Tags** : `damage`, `air`, `mp_removal`
- **Grades** : g1 (niv. 1) : 3 PA, PO 1–5, 3/tour, 12–14 Air ; g2 (niv. 66) : 3 PA, PO 1–6, 3/tour, 16–19 Air ; g3 (niv. 132) : 3 PA, PO 1–7, 3/tour, 21–24 Air
- *Infobulle décodée (auto)* :
  - 21 à 24 dommages Air (CC : 25 à 29 dommages Air) — cibles : alliés (lanceur compris), ennemis
  - -2 PM — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort

#### 1B. Mot Malicieux (id 25878, niveau de déblocage 95)

- **Caractéristiques** : **4 PA** · PO 1–8 (modifiable), LdV · 3/tour · 2/cible · cumul 1 · CC 15 %
- **Description officielle** : Occasionne des dommages Air et applique l'état Malice sur la cible : • Retire de la Puissance à la cible pour chaque PM qu'elle utilise (cumulable 10 fois).
- **Effets** :
  - 30 à 34 dommages Air (CC 36 à 41) à la cible (alliés compris).
  - État « Malice » (1 tour) : −30 Puissance (1 tour) pour chaque PM que la cible utilise (cumulable 10 fois → −300).
- **Rôle tactique** : 4 PA, 1–8 PO : sur un monstre de mêlée qui doit marcher pour attaquer.
- **Tags** : `damage`, `air`, `debuff_power`
- **Grades** : g1 (niv. 95) : 4 PA, PO 1–7, 3/tour, 24–27 Air ; g2 (niv. 162) : 4 PA, PO 1–8, 3/tour, 30–34 Air
- *Infobulle décodée (auto)* :
  - 30 à 34 dommages Air (CC : 36 à 41 dommages Air) — cibles : alliés (lanceur compris), ennemis
  - État « Malice » — cibles : alliés (lanceur compris), ennemis ; 1 tour(s)
  - -30 Puissance — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; DÉCLENCHÉ quand : Pour CHAQUE PM utilise (écoute 1 t)

### Paire 2 : Mot Tapageur / Cri Assourdissant

*Mot Tapageur (soin + dommages Feu en croix 2) est le soin de zone de base ; Cri Assourdissant (−2 PA) pour l'entrave.*

#### 2A. Mot Tapageur (id 25858, niveau de déblocage 1)

- **Caractéristiques** : **3 PA** · PO 0–5 (modifiable), LdV · case occupée · 2/tour · CC 10 %
- **Description officielle** : Soigne les alliés et occasionne des dommages Feu aux ennemis en zone.
- **Effets** :
  - Zone : croix de 2 autour de l'impact (0–5 PO modifiable, case occupée).
  - 22 à 25 soins Feu (CC 27 à 30) aux alliés (lanceur compris) et 22 à 25 dommages Feu (CC 27 à 30) aux ennemis de la croix (dégressif).
- **Rôle tactique** : 3 PA, 2/tour : soin de zone de base, centré sur un ennemi au contact du groupe.
- **Tags** : `heal`, `damage`, `fire`, `aoe`
- **Grades** : g1 (niv. 1) : 3 PA, PO 0–3, 2/tour, 12–14 Feu (soin) / 12–14 Feu ; g2 (niv. 67) : 3 PA, PO 0–4, 2/tour, 17–19 Feu (soin) / 17–19 Feu ; g3 (niv. 133) : 3 PA, PO 0–5, 2/tour, 22–25 Feu (soin) / 22–25 Feu
- *Infobulle décodée (auto)* :
  - 22 à 25 soins Feu (CC : 27 à 30 soins Feu) — cibles : alliés (lanceur compris) ; zone : croix de 2
  - 22 à 25 dommages Feu (CC : 27 à 30 dommages Feu) — cibles : ennemis ; zone : croix de 2

#### 2B. Cri Assourdissant (id 25857, niveau de déblocage 100)

- **Caractéristiques** : **3 PA** · PO 1–6 (modifiable), LdV · 2/tour · cumul 1 · CC 10 %
- **Description officielle** : Occasionne des dommages Feu et retire des PA.
- **Effets** :
  - 24 à 28 dommages Feu (CC 30 à 34) et −2 PA esquivables (1 tour) à la cible (alliés compris).
- **Rôle tactique** : 3 PA, 1–6 PO modifiable, 2/tour.
- **Tags** : `damage`, `fire`, `ap_removal`
- **Grades** : g1 (niv. 100) : 3 PA, PO 1–5, 2/tour, 19–22 Feu ; g2 (niv. 167) : 3 PA, PO 1–6, 2/tour, 24–28 Feu
- *Infobulle décodée (auto)* :
  - 24 à 28 dommages Feu (CC : 30 à 34 dommages Feu) — cibles : alliés (lanceur compris), ennemis
  - -2 PA — cibles : alliés (lanceur compris), ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort

### Paire 3 : Mot Vampirique / Sanglots

*Mot Vampirique (vol Eau / transfert de vie) ; Sanglots (soin des alliés proches = 100 % des dommages).*

#### 3A. Mot Vampirique (id 25870, niveau de déblocage 1)

- **Caractéristiques** : **3 PA** · PO 1–6 (modifiable), LdV · 3/tour · 2/cible · CC 10 %
- **Description officielle** : Vole de la vie dans l'élément Eau aux ennemis ou transfère une partie de la vie du lanceur à l'allié ciblé.
- **Effets** :
  - Ennemi : vole 27 à 30 PV en Eau (CC 32 à 36).
  - Allié : transfère 12 % (CC 14 %) des PV actuels du lanceur à l'allié (le lanceur perd ces PV).
- **Rôle tactique** : 3 PA, 3/tour, 2/cible : soin d'appoint sans soin élémentaire (transfert).
- **Tags** : `damage`, `water`, `life_steal`, `heal_transfer`
- **Grades** : g1 (niv. 1) : 3 PA, PO 1–4, 3/tour, 16–18 Eau (vol) ; g2 (niv. 68) : 3 PA, PO 1–5, 3/tour, 21–23 Eau (vol) ; g3 (niv. 134) : 3 PA, PO 1–6, 3/tour, 27–30 Eau (vol)
- *Infobulle décodée (auto)* :
  - 27 à 30 vol Eau (CC : 32 à 36 vol Eau) — cibles : ennemis
  - Transfère 12% des PV (CC : Transfère 14% des PV) — cibles : alliés (lanceur compris)

#### 3B. Sanglots (id 25872, niveau de déblocage 105)

- **Caractéristiques** : **3 PA** · PO 1–6 (fixe), sans LdV · 2/tour · CC 10 %
- **Description officielle** : Occasionne des dommages Eau à la cible et soigne les alliés selon les dommages occasionnés en zone autour d'elle.
- **Effets** :
  - 23 à 26 dommages Eau (CC 28 à 31) à la cible (1–6 PO, sans LdV).
  - Les alliés dans un anneau 1–2 autour de la cible sont soignés de 100 % des dommages occasionnés.
- **Rôle tactique** : Frapper un ennemi collé à plusieurs alliés = soin de groupe proportionnel aux dégâts.
- **Tags** : `damage`, `water`, `heal`, `aoe_heal`
- **Grades** : g1 (niv. 105) : 3 PA, PO 1–5, 2/tour, 19–21 Eau ; g2 (niv. 172) : 3 PA, PO 1–6, 2/tour, 23–26 Eau
- *Infobulle décodée (auto)* :
  - 23 à 26 dommages Eau (CC : 28 à 31 dommages Eau) — cibles : alliés (lanceur compris), ennemis
  - Soin : 100% des dommages occasionnés — cibles : alliés (lanceur compris), ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu), non dégressive

### Paire 4 : Juron / Onguent Ancestral

*Juron (Terre + poussée) ou Onguent Ancestral (soin/dommages Terre, ×1,25 / ×0,75 soins reçus).*

#### 4A. Juron (id 25867, niveau de déblocage 1)

- **Caractéristiques** : **3 PA** · PO 1–6 (modifiable), LdV · 2/tour · CC 10 %
- **Description officielle** : Occasionne des dommages Terre aux ennemis et repousse la cible.
- **Effets** :
  - 22 à 25 dommages Terre (CC 26 à 30) à l'ennemi et repousse la cible de 2 cases (alliés compris).
- **Rôle tactique** : 3 PA, 1–6 PO modifiable, 2/tour : dégager un allié.
- **Tags** : `damage`, `earth`, `push`
- **Grades** : g1 (niv. 1) : 3 PA, PO 1–4, 2/tour, 14–16 Terre ; g2 (niv. 69) : 3 PA, PO 1–5, 2/tour, 18–20 Terre ; g3 (niv. 136) : 3 PA, PO 1–6, 2/tour, 22–25 Terre
- *Infobulle décodée (auto)* :
  - 22 à 25 dommages Terre (CC : 26 à 30 dommages Terre) — cibles : ennemis
  - Repousse de 2 cases — cibles : alliés (lanceur compris), ennemis

#### 4B. Onguent Ancestral (id 25869, niveau de déblocage 110)

- **Caractéristiques** : **4 PA** · PO 0–6 (modifiable), LdV · 2/tour · cumul 1 · CC 15 %
- **Description officielle** : Occasionne des dommages Terre aux ennemis ou soigne les alliés. Réduit également les soins reçus par l'ennemi ciblé ou augmente ceux par l'allié ciblé.
- **Effets** :
  - Ennemi : 35 à 38 dommages Terre (CC 40 à 44) et soins reçus ×75 % (1 tour).
  - Allié : 35 à 38 soins Terre (CC 40 à 44) et soins reçus ×125 % (1 tour).
- **Rôle tactique** : 4 PA, 0–6 PO modifiable, 2/tour : à lancer sur l'allié AVANT les autres soins (+25 %).
- **Tags** : `heal`, `damage`, `earth`, `heal_amplifier`, `anti_heal`
- **Grades** : g1 (niv. 110) : 4 PA, PO 0–5, 2/tour, 31–33 Terre / 31–33 Terre (soin) ; g2 (niv. 177) : 4 PA, PO 0–6, 2/tour, 35–38 Terre / 35–38 Terre (soin)
- *Infobulle décodée (auto)* :
  - 35 à 38 dommages Terre (CC : 40 à 44 dommages Terre) — cibles : ennemis
  - 35 à 38 soins Terre (CC : 40 à 44 soins Terre) — cibles : alliés (lanceur compris)
  - Soins reçus x75% — cibles : ennemis ; DÉCLENCHÉ quand : Le porteur est SOIGNE (écoute 1 t)
  - Soins reçus x125% — cibles : alliés (lanceur compris) ; DÉCLENCHÉ quand : Le porteur est SOIGNE (écoute 1 t)

### Paire 5 : Mot d'Amitié / Mot Alchimique

*Mot d'Amitié (Lapino soigneur/bouclier) en groupe ; Mot Alchimique (Fioles) pour les buffs de caractéristique.*

#### 5A. Mot d'Amitié (id 25795, niveau de déblocage 5)

- **Caractéristiques** : **3 PA** · PO 1–3 (fixe), LdV · case libre · relance 1 · CC 0 % · condition : le lanceur n'a pas « Lapino Invoqué et limite atteinte » (`HS!4190`)
- **Description officielle** : Invoque un Lapino maîtrisable qui peut soigner ou appliquer un bouclier. Il peut également se transformer s'il est dans l'état Contrôlé pour occasionner des dommages dans l'élément de l'Alchi-Rhétorique.  Le Lapino est téléporté et immobilisé sur la case ciblée si le sort est relancé quand il est en vie.  À sa mort, le lanceur pose un glyphe sous le Lapino qui occasionne des dommages aux ennemis ou soigne les alliés dans le meilleur élément du lanceur et le temps de relance du sort est fixé à 2 tours.
- **Effets** :
  - Invoque un Lapino maîtrisable (#7370 g3, case libre, 1–3 PO, relance 1) : 7 PA, 3 PM, 100 % des PV de l'Eniripsa (INCERTAIN), résistances 10 %, caractéristiques propres 300.
  - Forme Lapinou : Bisou Magique (soin 6 % PV max, 0–8 PO, 2/tour) et Prévention (bouclier 100 % du niveau, 1 tour, 2/tour, 1/cible).
  - Forme Mutante (Mutation, nécessite l'état Contrôlé ; +25 % Vitalité, +2 PM, +15 % résistances) : Lapinopoing (21–25 dommages, Neutre ou élément du dernier Mot) et Souffle Alchimique (cône : 26–30 vol + attire 2).
  - Si le Lapino est déjà en vie : il est téléporté sur la case ciblée et immobilisé (−100 PM, 1 tour).
  - À sa mort : relance fixée à 2 tours et glyphe (cercle 2, 2 tours) : 20 dommages du meilleur élément aux ennemis en début de tour, 20 soins du meilleur élément aux alliés en fin de tour.
- **Rôle tactique** : 3 PA : soigneur/boucliers additionnel et relais de zone des Encouragements.
- **Tags** : `summon`, `heal`, `shield`, `relay`
- **Grades** : g1 (niv. 5) : 3 PA, PO 1–3, relance 1 ; g2 (niv. 72) : 3 PA, PO 1–3, relance 1 ; g3 (niv. 139) : 3 PA, PO 1–3, relance 1
- *Infobulle décodée (auto)* :
  - Invoque : Lapino (#7370, grade 3) — cibles : alliés (lanceur compris), ennemis [si le lanceur n'a pas l'état « Lapino Invoqué »]
  - Téléporte sur la case ciblée — cibles : alliés (lanceur compris) [« famille » du lanceur (lui, ses invocations); monstre Lapino]
  - -100 PM — cibles : alliés (lanceur compris) [« famille » du lanceur (lui, ses invocations); monstre Lapino] ; 1 tour(s) ; non désenvoûtable (sauf mort)
  - Pose un glyphe de début de tour → lance « Lapinoglyphe » (#25948, rang 5) — cibles : alliés (lanceur compris), ennemis [si le lanceur a l'état « Lapino rang 3 »] ; zone : cercle de rayon 2, non dégressive ; 2 tour(s)
  - Pose un glyphe de fin de tour → lance « Lapinoglyphe » (#25948, rang 6) — cibles : alliés (lanceur compris), ennemis [si le lanceur a l'état « Lapino rang 3 »] ; zone : cercle de rayon 2, non dégressive ; 2 tour(s)
  - Mot d'Amitié : relance fixée à 2 tour — cibles : lanceur

#### 5B. Mot Alchimique (id 25802, niveau de déblocage 115)

- **Caractéristiques** : **2 PA** · PO 1–6 (fixe), LdV · 2/tour · CC 0 % · condition : le lanceur n'a pas « Fiole Alchimique Invoquée et limite atteinte » (`HS!4192`)
- **Description officielle** : Invoque une Fiole vide statique qui peut être remplie d'un élément avec l'Alchi-Rhétorique. Lorsqu'elle est attaquée par un allié, il consomme son contenu pour que le lanceur le soigne et augmente les caractéristiques selon le contenu. Lorsqu'elle est détruite, elle occasionne des dommages selon son contenu aux ennemis et aux autres Fioles du lanceur en zone.  Sur une Fiole pleine du lanceur : consomme le contenu de la Fiole. Sur une Fiole vide du lanceur : détruit la Fiole et rembourse le coût en PA.  Utiliser le sort sur une Fiole rembourse l'utilisation du sort dans le tour.
- **Effets** :
  - Case libre : invoque une Fiole Alchimique statique (#7371 g2, 1–6 PO, 2/tour) qui hérite de 100 % des caractéristiques et dommages élémentaires de l'Eniripsa, 50 % des PV (INCERTAIN).
  - Sur sa Fiole pleine : consomme son contenu → l'Eniripsa est soignée de 20 (élément) et gagne +150 de la caractéristique de l'élément pendant 3 tours.
  - Sur sa Fiole vide : la détruit et rembourse 2 PA. Lancer sur une Fiole donne +1 lancer de Mot Alchimique ce tour.
  - Fiole détruite : 20 dommages de son élément aux ennemis et aux autres Fioles dans un anneau 1–2 (réactions en chaîne).
- **Rôle tactique** : Fioles remplies par les Mots élémentaires puis frappées par les alliés (+150 Force/Intel/Chance/Agi, 3 tours).
- **Tags** : `summon`, `buff_self`, `buff_ally`, `aoe`
- **Grades** : g1 (niv. 115) : 2 PA, PO 1–5, 2/tour, 10 Terre (soin) / 10 Feu (soin) / 10 Eau (soin) / 10 Air (soin) / 10 Terre / 10 Feu / 10 Eau / 10 Air ; g2 (niv. 182) : 2 PA, PO 1–6, 2/tour, 20 Terre (soin) / 20 Feu (soin) / 20 Eau (soin) / 20 Air (soin) / 20 Terre / 20 Feu / 20 Eau / 20 Air
- *Infobulle décodée (auto)* :
  - Invoque : Fiole Alchimique (#7371, grade 2) — cibles : [case; si le lanceur n'a pas atteint sa limite d'invocations]
  - 20 soins Terre — cibles : alliés (lanceur compris)
  - 150 Force — cibles : alliés (lanceur compris) ; 3 tour(s)
  - 20 soins Feu — cibles : alliés (lanceur compris)
  - 150 Intelligence — cibles : alliés (lanceur compris) ; 3 tour(s)
  - 20 soins Eau — cibles : alliés (lanceur compris)
  - 150 Chance — cibles : alliés (lanceur compris) ; 3 tour(s)
  - 20 soins Air — cibles : alliés (lanceur compris)
  - 150 Agilité — cibles : alliés (lanceur compris) ; 3 tour(s)
  - 20 dommages Terre — cibles : ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu)
  - 20 dommages Feu — cibles : ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu)
  - 20 dommages Eau — cibles : ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu)
  - 20 dommages Air — cibles : ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu)

### Paire 6 : Mot Stimulant / Mot de Déclin

*Mot Stimulant (+2 PA) est quasi obligatoire ; Mot de Déclin contre un boss qui se soigne/se buffe.*

#### 6A. Mot Stimulant (id 25742, niveau de déblocage 10)

- **Caractéristiques** : **2 PA** · PO 0–5 (fixe), LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Augmente les PA de l'allié ciblé et lui applique l'état Encouragé. Le cumul est partagé entre les Encouragements.  Sur une case libre : invoque une Fée Stimulante.
- **Effets** :
  - Allié (0–5 PO) : +2 PA (2 tours), états Stimulé et Encouragé ; retire tout autre Encouragement.
  - Case libre : invoque une Fée Stimulante (Luciole) ; sur le Lapino : appliqué aussi aux alliés en anneau 1–2 autour ; sur une Fiole : la détruit et s'applique en anneau 1–2.
  - 1 lancer par tour.
- **Rôle tactique** : 2 PA : +2 PA sur le DPS principal à chaque tour.
- **Tags** : `buff_ally`, `ap_gain`, `summon`
- **Grades** : g1 (niv. 10) : 2 PA, PO 0–3, 1/tour ; g2 (niv. 77) : 2 PA, PO 0–4, 1/tour ; g3 (niv. 144) : 2 PA, PO 0–5, 1/tour
- *Infobulle décodée (auto)* :
  - 2 PA — cibles : alliés (lanceur compris) ; 2 tour(s)
  - État « Stimulé » — cibles : alliés (lanceur compris) ; 2 tour(s)
  - État « Encouragé » — cibles : alliés (lanceur compris) ; 2 tour(s)
  - lance « Invoque une Fée Stimulante » (#25751, rang 1) — cibles : alliés (lanceur compris), ennemis

#### 6B. Mot de Déclin (id 25746, niveau de déblocage 120)

- **Caractéristiques** : **2 PA** · PO 1–5 (fixe), LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Réduit la durée des effets sur l'ennemi ciblé, lui réduit ses soins reçus et lui applique l'état Moqué. Le cumul est partagé entre les Moqueries.  Sur une case libre : invoque un Feu de Déclin.
- **Effets** :
  - Ennemi (1–5 PO) : durée des effets −1, soins reçus ×75 % (2 tours), états Décadent et Moqué ; retire toute autre Moquerie.
  - Case libre : invoque un Feu de Déclin (Luciole). Alimente Chœur Strident.
- **Rôle tactique** : Contre un boss qui se soigne ou se buffe.
- **Tags** : `debuff`, `dispel`, `anti_heal`, `summon`
- **Grades** : g1 (niv. 120) : 2 PA, PO 1–5, 1/tour ; g2 (niv. 187) : 2 PA, PO 1–5, 1/tour
- *Infobulle décodée (auto)* :
  - Durée des effets : -1 — cibles : ennemis
  - Soins reçus x75% — cibles : ennemis ; DÉCLENCHÉ quand : Le porteur est SOIGNE (écoute 2 t)
  - État « Décadent » — cibles : ennemis ; 2 tour(s)
  - État « Moqué » — cibles : ennemis ; 2 tour(s)
  - lance « Invoque un Feu de Déclin » (#25755, rang 1) — cibles : alliés (lanceur compris), ennemis

### Paire 7 : Mot de Frayeur / Scalpel

*Scalpel (40–44 soin/dommages meilleur élément, désenvoûtement) ; Mot de Frayeur (poussée 1 PA).*

#### 7A. Mot de Frayeur (id 13175, niveau de déblocage 15)

- **Caractéristiques** : **1 PA** · PO 1–7 (fixe), en ligne, LdV · 3/tour · 2/cible · CC 0 %
- **Description officielle** : Repousse la cible.
- **Effets** :
  - Repousse la cible (alliée ou ennemie) de 1 case (1–7 PO en ligne, LdV).
- **Rôle tactique** : 1 PA, 3/tour : finir un déplacement, pousser dans un mur (dommages de poussée).
- **Tags** : `push`, `placement`, `cheap`
- **Grades** : g1 (niv. 15) : 1 PA, PO 1–5, 3/tour ; g2 (niv. 82) : 1 PA, PO 1–6, 3/tour ; g3 (niv. 149) : 1 PA, PO 1–7, 3/tour
- *Infobulle décodée (auto)* :
  - Repousse de 1 case — cibles : alliés (lanceur compris), ennemis

#### 7B. Scalpel (id 25832, niveau de déblocage 125)

- **Caractéristiques** : **4 PA** · PO 0–4 (fixe), LdV · relance 3 · CC 25 %
- **Description officielle** : Réduit la durée des effets sur la cible et occasionne des dommages aux ennemis ou soigne les alliés dans le meilleur élément.
- **Effets** :
  - Durée des effets −1 sur la cible (alliée ou ennemie).
  - Ennemi : 40 à 44 dommages du meilleur élément (CC 48 à 53) ; allié : 40 à 44 soins du meilleur élément (CC 48 à 53). Relance 3, CC 25 %.
- **Rôle tactique** : 4 PA, 0–4 PO : gros soin mono-cible ou désenvoûtement d'un buff ennemi.
- **Tags** : `heal`, `damage`, `best_element`, `dispel`
- **Grades** : g1 (niv. 125) : 4 PA, PO 0–3, relance 3, 35–38 meilleur élément / 35–38 meilleur élément (soin) ; g2 (niv. 192) : 4 PA, PO 0–4, relance 3, 40–44 meilleur élément / 40–44 meilleur élément (soin)
- *Infobulle décodée (auto)* :
  - Durée des effets : -1 — cibles : alliés (lanceur compris), ennemis
  - 40 à 44 dommages du meilleur élément (CC : 48 à 53 dommages du meilleur élément) — cibles : ennemis
  - 40 à 44 soins du meilleur élément (CC : 48 à 53 soins du meilleur élément) — cibles : alliés (lanceur compris)

### Paire 8 : Lamentations / Vacarme

*Lamentations (vol Eau en cercle 2 + soins) ou Vacarme (soin/dommages Feu, Feux Follets).*

#### 8A. Lamentations (id 25871, niveau de déblocage 20)

- **Caractéristiques** : **4 PA** · PO 0–6 (modifiable), LdV · 1/tour · CC 20 %
- **Description officielle** : Vole de la vie dans l'élément Eau aux ennemis et soigne les alliés selon les dommages occasionnés en zone. N'affecte pas le lanceur.
- **Effets** :
  - Zone : cercle de 2 (0–6 PO modifiable).
  - Vole 29 à 32 PV en Eau (CC 35 à 38) aux ennemis de la zone.
  - Les alliés (hors lanceur) dans la zone sont soignés de 50 % des dommages occasionnés à chaque ennemi.
- **Rôle tactique** : 4 PA, 1/tour : mêlée générale alliés/ennemis → soin de groupe important.
- **Tags** : `damage`, `water`, `life_steal`, `aoe`, `aoe_heal`
- **Grades** : g1 (niv. 20) : 4 PA, PO 0–4, 1/tour, 18–20 Eau (vol) ; g2 (niv. 87) : 4 PA, PO 0–5, 1/tour, 23–26 Eau (vol) ; g3 (niv. 154) : 4 PA, PO 0–6, 1/tour, 29–32 Eau (vol)
- *Infobulle décodée (auto)* :
  - 29 à 32 vol Eau (CC : 35 à 38 vol Eau) — cibles : ennemis ; zone : cercle de rayon 2
  - Soin : 50% des dommages occasionnés — cibles : alliés (lanceur compris), ennemis ; zone : cercle de rayon 2

#### 8B. Vacarme (id 25856, niveau de déblocage 130)

- **Caractéristiques** : **3 PA** · PO 0–6 (modifiable), LdV · 2/tour · cumul 1 · CC 10 %
- **Description officielle** : Soigne les alliés ou occasionne des dommages Feu aux ennemis.  Sur un Feu Follet du lanceur : applique les effets en zone et augmente les dommages finaux de tous les Feux Follets du lanceur.
- **Effets** :
  - Allié : 25 à 28 soins Feu ; ennemi : 25 à 28 dommages Feu (CC 30 à 33).
  - Sur un Feu Follet du lanceur : effets appliqués dans un anneau 1–2 autour de lui et +25 % Dommages finaux (1 tour) à tous ses Feux Follets.
- **Rôle tactique** : 3 PA, 2/tour : soin Feu mono-cible bon marché.
- **Tags** : `heal`, `damage`, `fire`
- **Grades** : g1 (niv. 130) : 3 PA, PO 0–5, 2/tour, 23–25 Feu (soin) / 23–25 Feu (soin) / 23–25 Feu / 23–25 Feu (soin) / 23–25 Feu ; g2 (niv. 197) : 3 PA, PO 0–6, 2/tour, 25–28 Feu (soin) / 25–28 Feu (soin) / 25–28 Feu / 25–28 Feu (soin) / 25–28 Feu
- *Infobulle décodée (auto)* :
  - 25 à 28 soins Feu (CC : 30 à 33 soins Feu) — cibles : alliés (lanceur compris) [hors famille du lanceur]
  - 25 à 28 dommages Feu (CC : 30 à 33 dommages Feu) — cibles : ennemis
  - 25 à 28 soins Feu (CC : 30 à 33 soins Feu) — cibles : alliés (lanceur compris) ; zone : anneau 1–2 autour de l'impact (centre exclu)
  - 25 à 28 dommages Feu (CC : 30 à 33 dommages Feu) — cibles : ennemis ; zone : anneau 1–2 autour de l'impact (centre exclu)
  - 25% Dommages finaux — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; désenvoûtable seulement par effet fort

### Paire 9 : Mot Turbulent / Mot Furieux

*Mot Turbulent (soin/dommages Feu croix 1) ; Mot Furieux (cône Terre + poussée 3).*

#### 9A. Mot Turbulent (id 25860, niveau de déblocage 25)

- **Caractéristiques** : **4 PA** · PO 0–4 (modifiable), LdV · 1/tour · cumul 1 · CC 20 %
- **Description officielle** : Soigne les alliés, occasionne des dommages Feu aux ennemis et leur applique l'état Turbulent en zone : • Repousse les entités au contact de la cible à la fin de son tour.
- **Effets** :
  - Zone : croix de 1 (0–4 PO).
  - 36 à 41 soins Feu (CC 43 à 49) aux alliés et 36 à 41 dommages Feu aux ennemis de la croix.
  - État « Turbulent » (1 tour) sur toutes les cibles : à la fin du tour du porteur, les entités au contact sont repoussées de 1 case.
- **Rôle tactique** : 4 PA, 1/tour : meilleur rapport soin/PA en zone serrée.
- **Tags** : `heal`, `damage`, `fire`, `aoe`, `push`
- **Grades** : g1 (niv. 25) : 4 PA, PO 0–4, 1/tour, 23–26 Feu (soin) / 23–26 Feu ; g2 (niv. 92) : 4 PA, PO 0–4, 1/tour, 29–33 Feu (soin) / 29–33 Feu ; g3 (niv. 159) : 4 PA, PO 0–4, 1/tour, 36–41 Feu (soin) / 36–41 Feu
- *Infobulle décodée (auto)* :
  - 36 à 41 soins Feu (CC : 43 à 49 soins Feu) — cibles : alliés (lanceur compris) ; zone : croix de 1
  - 36 à 41 dommages Feu (CC : 43 à 49 dommages Feu) — cibles : ennemis ; zone : croix de 1
  - État « Turbulent » — cibles : alliés (lanceur compris), ennemis ; zone : croix de 1 ; 1 tour(s)
  - Repousse de 1 case — cibles : alliés (lanceur compris), ennemis ; zone : croix de 1 sans le centre ; DÉCLENCHÉ quand : Fin du tour du PORTEUR (écoute 1 t)

#### 9B. Mot Furieux (id 25865, niveau de déblocage 135)

- **Caractéristiques** : **4 PA** · PO 1–3 (fixe), en ligne, LdV · 1/tour · CC 20 %
- **Description officielle** : Occasionne des dommages Terre aux ennemis et repousse les cibles en zone.
- **Effets** :
  - Zone : cône de 2 (1–3 PO en ligne).
  - 30 à 34 dommages Terre (CC 36 à 41) aux ennemis et repousse de 3 cases toutes les entités du cône.
- **Rôle tactique** : Dégagement de zone devant l'Eniripsa.
- **Tags** : `damage`, `earth`, `aoe`, `push`
- *Infobulle décodée (auto)* :
  - 30 à 34 dommages Terre (CC : 36 à 41 dommages Terre) — cibles : ennemis ; zone : cône de 2
  - Repousse de 3 cases — cibles : alliés (lanceur compris), ennemis ; zone : cône de 2

### Paire 10 : Mot Vivifiant / Mot Galvanisant

*Mot Vivifiant (+2 PM, Fuite) ou Mot Galvanisant (+150 Puissance + bouclier 300).*

#### 10A. Mot Vivifiant (id 25744, niveau de déblocage 30)

- **Caractéristiques** : **2 PA** · PO 0–5 (fixe), LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Augmente les PM et la Fuite de l'allié ciblé et lui applique l'état Encouragé. Le cumul est partagé entre les Encouragements.  Sur une case libre : invoque une Fée Vivifiante.
- **Effets** :
  - Allié : +2 PM et +30 Fuite (2 tours), états Vivifié et Encouragé ; retire tout autre Encouragement.
  - Case libre : Fée Vivifiante. 1 lancer par tour.
- **Rôle tactique** : Pour un allié de mêlée taclé ou à distance de sa cible.
- **Tags** : `buff_ally`, `mp_gain`, `mobility`, `summon`
- **Grades** : g1 (niv. 30) : 2 PA, PO 0–3, 1/tour ; g2 (niv. 97) : 2 PA, PO 0–4, 1/tour ; g3 (niv. 164) : 2 PA, PO 0–5, 1/tour
- *Infobulle décodée (auto)* :
  - 2 PM — cibles : alliés (lanceur compris) ; 2 tour(s)
  - 30 Fuite — cibles : alliés (lanceur compris) ; 2 tour(s)
  - État « Vivifié » — cibles : alliés (lanceur compris) ; 2 tour(s)
  - État « Encouragé » — cibles : alliés (lanceur compris) ; 2 tour(s)
  - lance « Invoque une Fée Vivifiante » (#25759, rang 1) — cibles : alliés (lanceur compris), ennemis

#### 10B. Mot Galvanisant (id 25745, niveau de déblocage 140)

- **Caractéristiques** : **2 PA** · PO 0–5 (fixe), LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Augmente la Puissance de l'allié ciblé et lui applique un bouclier et l'état Encouragé. Le cumul est partagé entre les Encouragements.  Sur une case libre : invoque une Fée Galvanisante.
- **Effets** :
  - Allié : +150 Puissance et bouclier de 150 % du niveau (300 pts) pendant 2 tours, états Galvanisé et Encouragé ; retire tout autre Encouragement.
  - Case libre : Fée Galvanisante. 1 lancer par tour.
- **Rôle tactique** : Alternative à Mot Stimulant quand le DPS n'a pas besoin de PA.
- **Tags** : `buff_ally`, `buff_power`, `shield`, `summon`
- *Infobulle décodée (auto)* :
  - 150 Puissance — cibles : alliés (lanceur compris) ; 2 tour(s)
  - Bouclier : 150% du niveau (= 300 pts au niveau 200) — cibles : alliés (lanceur compris) ; 2 tour(s)
  - État « Galvanisé » — cibles : alliés (lanceur compris) ; 2 tour(s)
  - État « Encouragé » — cibles : alliés (lanceur compris) ; 2 tour(s)
  - lance « Invoque une Fée Galvanisante » (#25760, rang 1) — cibles : alliés (lanceur compris), ennemis

### Paire 11 : Mot Farceur / Mot Défendu

*Mot Farceur (soin/dommages Air + retour en fin de tour) ; Mot Défendu (cône vol Eau + attirance).*

#### 11A. Mot Farceur (id 25879, niveau de déblocage 35)

- **Caractéristiques** : **3 PA** · PO 0–6 (modifiable), LdV · 2/tour · cumul 1 · CC 10 %
- **Description officielle** : Occasionne des dommages Air aux ennemis ou soigne les alliés et applique l'état Farce sur la cible : • Téléporte la cible à sa position précédente à la fin de son tour.
- **Effets** :
  - Ennemi : 22 à 24 dommages Air (CC 26 à 28) ; allié : 22 à 24 soins Air.
  - État « Farce » (1 tour) : à la fin de son tour, la cible est téléportée à sa position précédente.
- **Rôle tactique** : Sur un allié : il peut avancer frapper puis revenir à sa case en fin de tour.
- **Tags** : `heal`, `damage`, `air`, `placement`
- **Grades** : g1 (niv. 35) : 3 PA, PO 0–4, 2/tour, 15–17 Air / 15–17 Air (soin) ; g2 (niv. 102) : 3 PA, PO 0–5, 2/tour, 18–20 Air / 18–20 Air (soin) ; g3 (niv. 169) : 3 PA, PO 0–6, 2/tour, 22–24 Air / 22–24 Air (soin)
- *Infobulle décodée (auto)* :
  - 22 à 24 dommages Air (CC : 26 à 28 dommages Air) — cibles : ennemis
  - 22 à 24 soins Air (CC : 26 à 28 soins Air) — cibles : alliés (lanceur compris)
  - État « Farce » — cibles : alliés (lanceur compris), ennemis ; 1 tour(s)
  - Téléporte à la position précédente — cibles : alliés (lanceur compris), ennemis ; DÉCLENCHÉ quand : Fin du tour du PORTEUR (écoute 1 t)

#### 11B. Mot Défendu (id 25876, niveau de déblocage 145)

- **Caractéristiques** : **4 PA** · PO 1–4 (fixe), en ligne, LdV · 1/tour · CC 20 %
- **Description officielle** : Vole de la vie dans l'élément Eau aux ennemis et attire les cibles vers la case ciblée en zone.
- **Effets** :
  - Zone : cône de 2 (1–4 PO en ligne).
  - Vole 28 à 31 PV en Eau (CC 34 à 37) aux ennemis et attire de 2 cases vers la case ciblée toutes les entités de la zone.
- **Rôle tactique** : Regroupe un paquet devant l'Eniripsa.
- **Tags** : `damage`, `water`, `life_steal`, `aoe`, `pull`
- *Infobulle décodée (auto)* :
  - 28 à 31 vol Eau (CC : 34 à 37 vol Eau) — cibles : ennemis ; zone : cône de 2
  - Attire de 2 cases — cibles : alliés (lanceur compris), ennemis ; zone : cône de 2

### Paire 12 : Peinture de Guerre / Mot Secret

*Peinture de Guerre (soin périodique / −60 rés. poussée) ; Mot Secret (ligne Air, 58–62 tous les 2 tours).*

#### 12A. Peinture de Guerre (id 25868, niveau de déblocage 40)

- **Caractéristiques** : **2 PA** · PO 0–7 (modifiable), LdV · 2/tour · 1/cible · cumul 1 · CC 5 %
- **Description officielle** : Peint la cible et occasionne des dommages Terre aux ennemis ou soigne les alliés.  État Peinture : • Sur un ennemi : réduit ses Résistances Poussée. • Sur un allié : soigne au début de son tour.
- **Effets** :
  - Ennemi : 9 à 11 dommages Terre (CC 12 à 14) et Peinture (2 tours) : −60 Résistances Poussée.
  - Allié : 9 à 11 soins Terre et Peinture (2 tours) : 9 à 11 soins Terre au début de chacun de ses tours.
  - 2 PA, 0–7 PO modifiable, 2/tour, 1/cible.
- **Rôle tactique** : Soin sur la durée bon marché ; prépare Pinceau Tribal.
- **Tags** : `heal`, `hot`, `damage`, `earth`, `debuff`
- **Grades** : g1 (niv. 40) : 2 PA, PO 0–5, 2/tour, 6–7 Terre (soin) / 6–7 Terre / 6–7 Terre (soin) ; g2 (niv. 107) : 2 PA, PO 0–6, 2/tour, 7–9 Terre (soin) / 7–9 Terre / 7–9 Terre (soin) ; g3 (niv. 174) : 2 PA, PO 0–7, 2/tour, 9–11 Terre (soin) / 9–11 Terre / 9–11 Terre (soin)
- *Infobulle décodée (auto)* :
  - État « Peinture » — cibles : alliés (lanceur compris), ennemis ; 2 tour(s)
  - -60 Résistances Poussée — cibles : ennemis ; 2 tour(s)
  - 9 à 11 soins Terre — cibles : alliés (lanceur compris) ; DÉCLENCHÉ quand : Debut du tour du PORTEUR (écoute 2 t)
  - 9 à 11 dommages Terre (CC : 12 à 14 dommages Terre) — cibles : ennemis
  - 9 à 11 soins Terre (CC : 12 à 14 soins Terre) — cibles : alliés (lanceur compris)

#### 12B. Mot Secret (id 25882, niveau de déblocage 150)

- **Caractéristiques** : **4 PA** · PO 1–10 (modifiable), en ligne, LdV · 1/tour · cumul 1 · CC 20 %
- **Description officielle** : Soigne les alliés et occasionne des dommages Air aux ennemis en zone. Les soins et les dommages sont augmentés dans 2 tours si le sort n'est pas relancé au tour suivant.  Augmente les soins finaux de toutes les Fées du lanceur si une entité est touchée.
- **Effets** :
  - Zone : ligne de 3 cases (1–10 PO en ligne).
  - 28 à 32 soins Air (CC 34 à 38) aux alliés et 28 à 32 dommages Air aux ennemis.
  - S'il n'est pas relancé au tour suivant : +30 soins de base et +30 dégâts de base pendant 1 tour, 2 tours plus tard (relancer annule le bonus en attente).
  - +25 % Soins finaux (1 tour) à toutes les Fées du lanceur si une entité est touchée.
- **Rôle tactique** : À lancer un tour sur deux : 58–62 de base.
- **Tags** : `heal`, `damage`, `air`, `aoe_line`, `ramp`
- *Infobulle décodée (auto)* :
  - 28 à 32 soins Air (CC : 34 à 38 soins Air) — cibles : alliés (lanceur compris) ; zone : ligne de 3 cases (impact + 2 derrière)
  - 28 à 32 dommages Air (CC : 34 à 38 dommages Air) — cibles : ennemis ; zone : ligne de 3 cases (impact + 2 derrière)
  - Mot Secret : +30 soins de base — cibles : lanceur ; 1 tour(s) ; DIFFÉRÉ de 2 tour(s) ; non désenvoûtable (sauf mort)
  - Mot Secret : +30 dégâts de base — cibles : lanceur ; 1 tour(s) ; DIFFÉRÉ de 2 tour(s) ; non désenvoûtable (sauf mort)
  - 25% Soins finaux — cibles : alliés (lanceur compris), ennemis ; zone : toute la carte ; 1 tour(s) ; désenvoûtable seulement par effet fort

### Paire 13 : Mot de Jouvence / Mot Déprimant

*Mot de Jouvence (soin 10 % ×2 + désenvoûtement) ; Mot Déprimant (−150 Puissance, −25 Dommages).*

#### 13A. Mot de Jouvence (id 25743, niveau de déblocage 45)

- **Caractéristiques** : **2 PA** · PO 0–5 (fixe), LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Réduit la durée des effets sur l'allié ciblé, le soigne immédiatement et en début de tour et lui applique l'état Encouragé. Le cumul est partagé entre les Encouragements.  Sur une case libre : invoque une Fée de Jouvence.
- **Effets** :
  - Allié : durée des effets −1, soin de 10 % de ses PV max immédiatement puis au début de ses tours suivants tant que l'écoute dure (2 tours ; nombre exact de déclenchements INCERTAIN : 1 ou 2), états Rajeuni et Encouragé (2 tours) ; retire tout autre Encouragement.
  - Case libre : Fée de Jouvence. 1 lancer par tour.
- **Rôle tactique** : 2 PA pour 20 % (ou plus) des PV max sur 2 tours : soin le plus rentable sur un tank.
- **Tags** : `heal`, `hot`, `dispel`, `summon`
- **Grades** : g1 (niv. 45) : 2 PA, PO 0–3, 1/tour ; g2 (niv. 112) : 2 PA, PO 0–4, 1/tour ; g3 (niv. 179) : 2 PA, PO 0–5, 1/tour
- *Infobulle décodée (auto)* :
  - Durée des effets : -1 — cibles : alliés (lanceur compris)
  - Soin : 10% des PV max — cibles : alliés (lanceur compris) ; DÉCLENCHÉ quand : Instantane: l'effet s'applique au lancer / Debut du tour du PORTEUR (écoute 2 t)
  - État « Rajeuni » — cibles : alliés (lanceur compris) ; 2 tour(s)
  - État « Encouragé » — cibles : alliés (lanceur compris) ; 2 tour(s)
  - lance « Invoque une Fée de Jouvence » (#25758, rang 1) — cibles : alliés (lanceur compris), ennemis

#### 13B. Mot Déprimant (id 25748, niveau de déblocage 155)

- **Caractéristiques** : **2 PA** · PO 1–5 (fixe), LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Retire de la Puissance et des Dommages à l'ennemi ciblé et lui applique l'état Moqué. Le cumul est partagé entre les Moqueries.  Sur une case libre : invoque un Feu Déprimant.
- **Effets** :
  - Ennemi : −150 Puissance et −25 Dommages (2 tours), états Déprimé et Moqué ; retire toute autre Moquerie.
  - Case libre : Feu Déprimant. Alimente Chœur Strident.
- **Rôle tactique** : Réduit fortement les dégâts du boss (−150 % de bonus élémentaire).
- **Tags** : `debuff`, `debuff_power`, `summon`
- *Infobulle décodée (auto)* :
  - -150 Puissance — cibles : ennemis ; 2 tour(s)
  - -25 Dommages — cibles : ennemis ; 2 tour(s)
  - État « Déprimé » — cibles : ennemis ; 2 tour(s)
  - État « Moqué » — cibles : ennemis ; 2 tour(s)
  - lance « Invoque un Feu Déprimant » (#25757, rang 1) — cibles : alliés (lanceur compris), ennemis

### Paire 14 : Cri de Guerre / Mot Rituel

*Cri de Guerre (Terre autour de soi + repousse 4) ; Mot Rituel (aura de Peinture, soin cercle 2).*

#### 14A. Cri de Guerre (id 25863, niveau de déblocage 50)

- **Caractéristiques** : **4 PA** · PO 0–0 (fixe), sans LdV · 1/tour · CC 20 %
- **Description officielle** : Occasionne des dommages Terre aux ennemis et repousse les cibles en zone. Les dommages de zone ne sont pas dégressifs.
- **Effets** :
  - Lancé sur soi : anneau 1–3 autour du lanceur, dommages non dégressifs.
  - 37 à 41 dommages Terre (CC 44 à 49) aux ennemis et repousse de 4 cases toutes les entités (sauf le lanceur) de l'anneau.
- **Rôle tactique** : 4 PA, 1/tour : se dégager d'un encerclement.
- **Tags** : `damage`, `earth`, `aoe`, `push`, `escape`
- **Grades** : g1 (niv. 50) : 4 PA, PO 0–0, 1/tour, 23–26 Terre ; g2 (niv. 117) : 4 PA, PO 0–0, 1/tour, 31–35 Terre ; g3 (niv. 184) : 4 PA, PO 0–0, 1/tour, 37–41 Terre
- *Infobulle décodée (auto)* :
  - 37 à 41 dommages Terre (CC : 44 à 49 dommages Terre) — cibles : ennemis ; zone : anneau 1–3 autour de l'impact (centre exclu), non dégressive
  - Repousse de 4 cases — cibles : alliés (hors lanceur), ennemis ; zone : anneau 1–3 autour de l'impact (centre exclu), non dégressive

#### 14B. Mot Rituel (id 25864, niveau de déblocage 160)

- **Caractéristiques** : **3 PA** · PO 0–4 (fixe), LdV · relance 2 · cumul 1 · CC 25 %
- **Description officielle** : Pose un glyphe-aura qui peint les entités en zone. Occasionne également des dommages Terre aux ennemis dans la zone d'effet et soigne les alliés à l'intérieur de la zone.
- **Effets** :
  - Glyphe-aura (anneau de rayon 3, 1 tour) qui applique la Peinture aux entités qui s'y trouvent.
  - 28 à 32 dommages Terre (CC 34 à 38) aux ennemis de l'anneau de rayon 3 ; 28 à 32 soins Terre aux alliés dans le cercle de 2 (non dégressif). Relance 2.
- **Rôle tactique** : Soin de zone central + dégâts en couronne.
- **Tags** : `heal`, `damage`, `earth`, `aoe`, `glyph`
- *Infobulle décodée (auto)* :
  - Pose un glyphe-aura → lance « Mot Rituel » (#25909, rang 1) — cibles : alliés (lanceur compris), ennemis ; zone : anneau de rayon exactement 3 ; 1 tour(s)
  - 28 à 32 dommages Terre (CC : 34 à 38 dommages Terre) — cibles : ennemis ; zone : anneau de rayon exactement 3
  - 28 à 32 soins Terre (CC : 34 à 38 soins Terre) — cibles : alliés (lanceur compris) ; zone : cercle de rayon 2, non dégressive

### Paire 15 : Mot Interdit / Mot Exsangue

*Mot Interdit (46–50 soin/dommages Eau) ; Mot Exsangue (les attaquants de la cible se soignent de 25 %).*

#### 15A. Mot Interdit (id 25873, niveau de déblocage 55)

- **Caractéristiques** : **5 PA** · PO 0–5 (fixe), LdV · 1/tour · CC 25 %
- **Description officielle** : Réduit la durée des effets sur la cible, occasionne des dommages Eau aux ennemis ou soigne les alliés.
- **Effets** :
  - Durée des effets −1 sur la cible.
  - Ennemi : 46 à 50 dommages Eau (CC 55 à 60) ; allié : 46 à 50 soins Eau (CC 55 à 60). 5 PA, 1/tour.
- **Rôle tactique** : Plus gros soin/coup élémentaire mono-cible.
- **Tags** : `heal`, `damage`, `water`, `dispel`
- **Grades** : g1 (niv. 55) : 5 PA, PO 0–5, 1/tour, 30–33 Eau / 30–33 Eau (soin) ; g2 (niv. 122) : 5 PA, PO 0–5, 1/tour, 40–44 Eau / 40–44 Eau (soin) ; g3 (niv. 189) : 5 PA, PO 0–5, 1/tour, 46–50 Eau / 46–50 Eau (soin)
- *Infobulle décodée (auto)* :
  - Durée des effets : -1 — cibles : alliés (lanceur compris), ennemis
  - 46 à 50 dommages Eau (CC : 55 à 60 dommages Eau) — cibles : ennemis
  - 46 à 50 soins Eau (CC : 55 à 60 soins Eau) — cibles : alliés (lanceur compris)

#### 15B. Mot Exsangue (id 13217, niveau de déblocage 165)

- **Caractéristiques** : **4 PA** · PO 0–5 (modifiable), LdV · 2/tour · cumul 1 · CC 15 %
- **Description officielle** : Occasionne des dommages Eau et soigne les attaquants de la cible.  Sur un allié : soigne la cible.
- **Effets** :
  - Ennemi : 37 à 40 dommages Eau (CC 41 à 45) ; pendant 1 tour, chaque attaquant qui lui inflige des dommages est soigné de 25 % des dommages infligés.
  - Allié : 37 à 40 soins Eau (CC 41 à 45).
- **Rôle tactique** : Sur la cible que tout le groupe frappe : soin passif de toute l'équipe.
- **Tags** : `heal`, `damage`, `water`, `group_heal`
- *Infobulle décodée (auto)* :
  - 37 à 40 dommages Eau (CC : 41 à 45 dommages Eau) — cibles : ennemis
  - Soin sur l'attaquant : 0% des dommages — cibles : ennemis ; DÉCLENCHÉ quand : Le porteur subit des dommages (écoute 1 t)
  - 37 à 40 soins Eau (CC : 41 à 45 soins Eau) — cibles : alliés (lanceur compris)

### Paire 16 : Mot Accablant / Mot Décourageant

*Mot Accablant (−3 PM) ou Mot Décourageant (−2 PA).*

#### 16A. Mot Accablant (id 25749, niveau de déblocage 60)

- **Caractéristiques** : **2 PA** · PO 1–5 (fixe), LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Retire des PM et de l'Esquive PM à l'ennemi ciblé et lui applique l'état Moqué. Le cumul est partagé entre les Moqueries.  Sur une case libre : invoque un Feu Accablant.
- **Effets** :
  - Ennemi (1–5 PO) : −3 PM esquivables (1 tour), −20 Esquive PM (2 tours), états Accablé et Moqué ; retire toute autre Moquerie.
  - Case libre : Feu Accablant. Alimente Chœur Strident.
- **Rôle tactique** : Retrait PM principal de l'Eniripsa.
- **Tags** : `mp_removal`, `debuff`, `summon`
- **Grades** : g1 (niv. 60) : 2 PA, PO 1–3, 1/tour ; g2 (niv. 127) : 2 PA, PO 1–4, 1/tour ; g3 (niv. 194) : 2 PA, PO 1–5, 1/tour
- *Infobulle décodée (auto)* :
  - -3 PM — cibles : ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - -20 Esquive PM — cibles : ennemis ; 2 tour(s)
  - État « Accablé » — cibles : ennemis ; 2 tour(s)
  - État « Moqué » — cibles : ennemis ; 2 tour(s)
  - lance « Invoque un Feu Accablant » (#25756, rang 1) — cibles : alliés (lanceur compris), ennemis

#### 16B. Mot Décourageant (id 25747, niveau de déblocage 170)

- **Caractéristiques** : **2 PA** · PO 1–5 (fixe), LdV · 1/tour · cumul 1 · CC 0 %
- **Description officielle** : Retire des PA et de l'Esquive PA à l'ennemi ciblé et lui applique l'état Moqué. Le cumul est partagé entre les Moqueries.  Sur une case libre : invoque un Feu Décourageant.
- **Effets** :
  - Ennemi (1–5 PO) : −2 PA esquivables (1 tour), −20 Esquive PA (2 tours), états Découragé et Moqué ; retire toute autre Moquerie.
  - Case libre : Feu Décourageant. Alimente Chœur Strident.
- **Rôle tactique** : Retrait PA principal de l'Eniripsa.
- **Tags** : `ap_removal`, `debuff`, `summon`
- *Infobulle décodée (auto)* :
  - -2 PA — cibles : ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - -20 Esquive PA — cibles : ennemis ; 2 tour(s)
  - État « Découragé » — cibles : ennemis ; 2 tour(s)
  - État « Moqué » — cibles : ennemis ; 2 tour(s)
  - lance « Invoque un Feu Décourageant » (#25752, rang 1) — cibles : alliés (lanceur compris), ennemis

### Paire 17 : Chapardage / Mot Distrayant

*Chapardage (vol de PO + vol Feu) ; Mot Distrayant (regroupe + soin/dommages Feu croix 3).*

#### 17A. Chapardage (id 25859, niveau de déblocage 65)

- **Caractéristiques** : **3 PA** · PO 1–8 (modifiable), LdV · 2/tour · cumul 2 · CC 10 %
- **Description officielle** : Vole de la Portée à la cible et de la vie dans l'élément Feu aux ennemis.
- **Effets** :
  - Vole 2 PO (1 tour) à la cible (alliés compris) et 20 à 22 PV en Feu (CC 23 à 26) à l'ennemi. Cumul 2 (−4 PO).
- **Rôle tactique** : 3 PA, 1–8 PO modifiable : réduit la portée des lanceurs ennemis et allonge celle de l'Eniripsa.
- **Tags** : `damage`, `fire`, `life_steal`, `range_steal`
- **Grades** : g1 (niv. 65) : 3 PA, PO 1–6, 2/tour, 15–17 Feu (vol) ; g2 (niv. 131) : 3 PA, PO 1–7, 2/tour, 18–20 Feu (vol) ; g3 (niv. 198) : 3 PA, PO 1–8, 2/tour, 20–22 Feu (vol)
- *Infobulle décodée (auto)* :
  - Vole 2 Portée — cibles : alliés (lanceur compris), ennemis ; 1 tour(s)
  - 20 à 22 vol Feu (CC : 23 à 26 vol Feu) — cibles : ennemis

#### 17B. Mot Distrayant (id 25862, niveau de déblocage 175)

- **Caractéristiques** : **4 PA** · PO 0–6 (modifiable), LdV · case occupée · 1/tour · CC 20 %
- **Description officielle** : Attire les cibles vers le centre, soigne les alliés et occasionne des dommages Feu aux ennemis en zone. L'attirance n'affecte pas le lanceur.
- **Effets** :
  - Attire de 2 cases vers la case ciblée les entités (hors lanceur) dans une croix de 3 sans centre.
  - Puis 30 à 34 soins Feu (CC 37 à 41) aux alliés et 30 à 34 dommages Feu aux ennemis dans la croix de 3 (case occupée, 0–6 PO).
- **Rôle tactique** : Regroupe les alliés pour la suite des soins de zone (et les ennemis pour les zones alliées).
- **Tags** : `heal`, `damage`, `fire`, `aoe`, `pull`, `packing`
- *Infobulle décodée (auto)* :
  - Attire de 2 cases — cibles : alliés (hors lanceur), ennemis ; zone : croix de 3 sans le centre
  - 30 à 34 soins Feu (CC : 37 à 41 soins Feu) — cibles : alliés (lanceur compris) ; zone : croix de 3
  - 30 à 34 dommages Feu (CC : 37 à 41 dommages Feu) — cibles : ennemis ; zone : croix de 3

### Paire 18 : Mot Fleuri / Bosquet Enchanté

*Mot Fleuri (Air + soin de fin de tour) ; Bosquet Enchanté (zone autour des alliés Encouragés).*

#### 18A. Mot Fleuri (id 25880, niveau de déblocage 70)

- **Caractéristiques** : **4 PA** · PO 0–6 (modifiable), LdV · 2/tour · cumul 1 · CC 15 %
- **Description officielle** : Occasionne des dommages Air aux ennemis et applique l'état Floraison sur les cibles en zone : • Soigne les alliés en zone autour de la cible à la fin de son tour.
- **Effets** :
  - Zone : croix diagonale de 1 (impact + 4 diagonales).
  - 33 à 37 dommages Air (CC 40 à 44) aux ennemis.
  - État « Floraison » (1 tour) sur toutes les entités de la zone : à la fin du tour du porteur, 33 à 37 soins Air aux alliés dans une étoile de 2 autour de lui.
- **Rôle tactique** : Sur un ennemi au milieu des alliés : soin de groupe à la fin de son tour.
- **Tags** : `damage`, `air`, `aoe`, `delayed_heal`
- **Grades** : g1 (niv. 70) : 4 PA, PO 0–5, 2/tour, 26–29 Air / 26–29 Air (soin) ; g2 (niv. 137) : 4 PA, PO 0–6, 2/tour, 33–37 Air / 33–37 Air (soin)
- *Infobulle décodée (auto)* :
  - 33 à 37 dommages Air (CC : 40 à 44 dommages Air) — cibles : ennemis ; zone : croix diagonale de 1
  - État « Floraison » — cibles : alliés (lanceur compris), ennemis ; zone : croix diagonale de 1 ; 1 tour(s)
  - 33 à 37 soins Air (CC : 40 à 44 soins Air) — cibles : alliés (lanceur compris) ; zone : étoile (8 directions) de 2 ; DÉCLENCHÉ quand : Fin du tour du PORTEUR (écoute 1 t)

#### 18B. Bosquet Enchanté (id 25881, niveau de déblocage 180)

- **Caractéristiques** : **4 PA** · PO 0–7 (modifiable), en ligne, LdV · 1/tour · CC 25 %
- **Description officielle** : Soigne les alliés et occasionne des dommages Air aux ennemis en zone. La zone s'étend autour des Fées du lanceur et des alliés Encouragés.  Les effets ne sont appliqués qu'une seule fois par lancer.
- **Effets** :
  - Zone : cercle de 2 autour de l'impact (0–7 PO en ligne) et autour de chaque allié Encouragé (dont les Fées).
  - 34 à 38 soins Air (CC 40 à 45) aux alliés et 34 à 38 dommages Air aux ennemis ; chaque entité n'est affectée qu'une fois par lancer.
- **Rôle tactique** : Avec plusieurs Encouragés/Fées répartis, couvre toute la carte.
- **Tags** : `heal`, `damage`, `air`, `aoe`
- *Infobulle décodée (auto)* :
  - 34 à 38 soins Air (CC : 40 à 45 soins Air) — cibles : alliés (lanceur compris) ; zone : cercle de rayon 2
  - 34 à 38 dommages Air (CC : 40 à 45 dommages Air) — cibles : ennemis ; zone : cercle de rayon 2

### Paire 19 : Mot d'Envol / Fontaine de Jouvence

*Mot d'Envol (échange avec un allié) ; Fontaine de Jouvence (10 % PV max en zone ×2).*

#### 19A. Mot d'Envol (id 13184, niveau de déblocage 75)

- **Caractéristiques** : **3 PA** · PO 1–5 (fixe), sans LdV · relance 3 · CC 0 % · condition : le lanceur n'a pas « Pesanteur » (`HS!7`)
- **Description officielle** : Échange de position avec l'allié ciblé.
- **Effets** :
  - Échange de position avec l'allié ciblé (1–5 PO, sans LdV, pas en Pesanteur). Relance 3.
- **Rôle tactique** : Sauver un allié encerclé ou fuir derrière un tank.
- **Tags** : `mobility`, `swap`, `rescue`
- **Grades** : g1 (niv. 75) : 3 PA, PO 1–4, relance 3 ; g2 (niv. 142) : 3 PA, PO 1–5, relance 3
- *Infobulle décodée (auto)* :
  - Échange de positions — cibles : alliés (lanceur compris)

#### 19B. Fontaine de Jouvence (id 25874, niveau de déblocage 185)

- **Caractéristiques** : **3 PA** · PO 0–2 (fixe), sans LdV · relance 3 · CC 0 %
- **Description officielle** : Soigne les alliés et pose un glyphe de fin de tour qui soigne les alliés en zone. Rend le lanceur Intaclable tant qu'il est dans le glyphe.
- **Effets** :
  - Soin de 10 % des PV max aux alliés dans un cercle de 3 (0–2 PO, non dégressif).
  - Glyphe de fin de tour (cercle 3, 1 tour) : 10 % des PV max aux alliés qui finissent leur tour dedans.
  - Glyphe-aura : le lanceur est Intaclable tant qu'il s'y trouve. Relance 3.
- **Rôle tactique** : 20 % PV max potentiels à chaque allié groupé (scalable sur les gros PV).
- **Tags** : `heal`, `aoe_heal`, `percent_heal`, `glyph`
- *Infobulle décodée (auto)* :
  - Soin : 10% des PV max — cibles : alliés (lanceur compris) ; zone : cercle de rayon 3, non dégressive
  - Pose un glyphe de fin de tour → lance « Fontaine de Jouvence » (#25892, rang 1) — cibles : alliés (lanceur compris) ; zone : cercle de rayon 3, non dégressive ; 1 tour(s)
  - Pose un glyphe-aura → lance « Fontaine de Jouvence » (#25893, rang 1) — cibles : lanceur (s'il est dans la zone) ; zone : cercle de rayon 3, non dégressive ; 1 tour(s)

### Paire 20 : Pinceau Tribal / Chœur Strident

*Pinceau Tribal (Peintures) ; Chœur Strident (40–44 soin/dommages Feu + rampe).*

#### 20A. Pinceau Tribal (id 25866, niveau de déblocage 80)

- **Caractéristiques** : **3 PA** · PO 0–6 (fixe), LdV · 2/tour · 1/cible · cumul 5 · CC 10 %
- **Description officielle** : Peint la cible et soigne les alliés ou occasionne des dommages Terre aux ennemis.  Sur une cible Peinte : propage la Peinture, soigne les alliés et occasionne des dommages Terre aux ennemis en zone.  Sur le lanceur : consomme toutes les Peintures pour occasionner des dommages Terre à tous les ennemis Peints. • Les dommages sont augmentés pour chaque ennemi touché avant d'appliquer les effets. • Augmente les Dommages Poussée du lanceur pour chaque allié touché.
- **Effets** :
  - Cible non peinte : la peint, 19 à 22 soins Terre (allié hors lanceur) ou 19 à 22 dommages Terre (ennemi), CC 23 à 26.
  - Cible peinte : propage la Peinture (anneau 1–2) et applique soins/dommages en cercle 2.
  - Sur soi : consomme toutes les Peintures — 19 à 22 dommages Terre à chaque ennemi peint (+8 dégâts de base par ennemi peint touché, cumul 5) et +30 Dommages Poussée (2 tours, cumul 5) par allié peint.
- **Rôle tactique** : 3 PA, 2/tour : peindre plusieurs ennemis puis tout consommer d'un coup (jusqu'à 59–62 de base sur chacun).
- **Tags** : `heal`, `damage`, `earth`, `aoe`, `global`
- **Grades** : g1 (niv. 80) : 3 PA, PO 0–6, 2/tour, 15–18 Terre (soin) / 15–18 Terre / 15–18 Terre (soin) / 15–18 Terre ; g2 (niv. 147) : 3 PA, PO 0–6, 2/tour, 19–22 Terre (soin) / 19–22 Terre / 19–22 Terre (soin) / 19–22 Terre
- *Infobulle décodée (auto)* :
  - État « Peinture » — cibles : alliés (hors lanceur), ennemis ; 2 tour(s)
  - 19 à 22 soins Terre (CC : 23 à 26 soins Terre) — cibles : alliés (hors lanceur) [si la cible n'a pas l'état « Peinture »]
  - 19 à 22 dommages Terre (CC : 23 à 26 dommages Terre) — cibles : ennemis [si la cible n'a pas l'état « Peinture »]
  - 19 à 22 soins Terre (CC : 23 à 26 soins Terre) — cibles : alliés (hors lanceur) ; zone : cercle de rayon 2
  - 19 à 22 dommages Terre (CC : 23 à 26 dommages Terre) — cibles : ennemis ; zone : cercle de rayon 2
  - Pinceau Tribal : +8 dégâts de base — cibles : lanceur (s'il est dans la zone)
  - 30 Dommages Poussée — cibles : lanceur ; 2 tour(s)

#### 20B. Chœur Strident (id 25861, niveau de déblocage 190)

- **Caractéristiques** : **5 PA** · PO 1–5 (modifiable), LdV · case occupée · 1/tour · cumul 3 · CC 25 %
- **Description officielle** : Occasionne des dommages Feu aux ennemis ou soigne les alliés. Les dommages et les soins sont augmentés à l'application d'une Moquerie par le lanceur ou à la mort d'un de ses Feux Follets.  Les effets ne peuvent être augmentés qu'une seule fois par tour, et se décrémentent après utilisation du sort.
- **Effets** :
  - Ennemi : 40 à 44 dommages Feu (CC 48 à 53) ; allié : 40 à 44 soins Feu (case occupée, 1–5 PO modifiable, 5 PA, 1/tour).
  - +5 dégâts et soins de base par palier (max +15) à chaque Moquerie appliquée ou Feu Follet mort (1×/tour) ; −1 palier après chaque lancer.
- **Rôle tactique** : Alterner Moqueries et Chœur Strident : 55–59 de base au palier III.
- **Tags** : `heal`, `damage`, `fire`, `ramp`
- *Infobulle décodée (auto)* :
  - 40 à 44 dommages Feu (CC : 48 à 53 dommages Feu) — cibles : ennemis
  - 40 à 44 soins Feu (CC : 48 à 53 soins Feu) — cibles : alliés (lanceur compris)
  - Chœur Strident : +5 dégâts de base — cibles : lanceur ; infini ; non désenvoûtable (sauf mort)
  - Chœur Strident : +5 soins de base — cibles : lanceur ; infini ; non désenvoûtable (sauf mort)

### Paire 21 : Cryothérapie / Murmure

*Cryothérapie (bouclier 200 / −60 Fuite + explosion) ; Murmure (2 PA, vol 1 PM / +1 PM).*

#### 21A. Cryothérapie (id 25875, niveau de déblocage 85)

- **Caractéristiques** : **3 PA** · PO 0–6 (modifiable), LdV · 2/tour · 1/cible · cumul 1 · CC 10 %
- **Description officielle** : Occasionne des dommages Eau aux ennemis et applique l'état Cryothérapie sur la cible : • Applique un bouclier sur l'allié ciblé ou retire de la Fuite aux ennemis. • Retire les effets du sort pour soigner les alliés et occasionner des dommages Eau aux ennemis en zone si la cible perd l'état.
- **Effets** :
  - Ennemi : 14 à 16 dommages Eau (CC 17 à 19) et −60 Fuite (1 tour) ; allié : bouclier 100 % du niveau (200 pts, 1 tour).
  - État « Cryothérapie » (1 tour) : au tour suivant ou si la cible est désenvoûtée, effets retirés et 14 à 16 soins Eau aux alliés / dommages Eau aux ennemis dans un cercle de 2 autour d'elle.
- **Rôle tactique** : 3 PA, 2/tour, 1/cible : bouclier + soin différé de zone sur le tank.
- **Tags** : `shield`, `damage`, `water`, `debuff`, `delayed_heal`
- **Grades** : g1 (niv. 85) : 3 PA, PO 0–5, 2/tour, 11–13 Eau / 11–13 Eau (soin) / 11–13 Eau ; g2 (niv. 152) : 3 PA, PO 0–6, 2/tour, 14–16 Eau / 14–16 Eau (soin) / 14–16 Eau
- *Infobulle décodée (auto)* :
  - 14 à 16 dommages Eau (CC : 17 à 19 dommages Eau) — cibles : ennemis
  - État « Cryothérapie » — cibles : alliés (lanceur compris), ennemis ; 1 tour(s)
  - Bouclier : 100% du niveau (= 200 pts au niveau 200) — cibles : alliés (lanceur compris) ; 1 tour(s)
  - -60 Fuite — cibles : ennemis ; 1 tour(s)
  - 14 à 16 soins Eau (CC : 17 à 19 soins Eau) — cibles : alliés (lanceur compris) ; zone : cercle de rayon 2
  - 14 à 16 dommages Eau (CC : 17 à 19 dommages Eau) — cibles : ennemis ; zone : cercle de rayon 2

#### 21B. Murmure (id 25883, niveau de déblocage 195)

- **Caractéristiques** : **2 PA** · PO 0–6 (modifiable), LdV · 2/tour · cumul 1 · CC 5 %
- **Description officielle** : Occasionne des dommages Air et vole des PM aux ennemis.  Sur un allié : soigne la cible et augmente ses PM.
- **Effets** :
  - Ennemi : 16 à 18 dommages Air (CC 19 à 22) et vole 1 PM (1 tour).
  - Allié : 16 à 18 soins Air et +1 PM (1 tour).
- **Rôle tactique** : 2 PA, 2/tour : remplissage de PA.
- **Tags** : `heal`, `damage`, `air`, `mp_steal`, `mp_gain`, `cheap`
- *Infobulle décodée (auto)* :
  - 16 à 18 dommages Air (CC : 19 à 22 dommages Air) — cibles : ennemis
  - Vole 1 PM — cibles : ennemis ; 1 tour(s) ; désenvoûtable seulement par effet fort
  - 16 à 18 soins Air (CC : 19 à 22 soins Air) — cibles : alliés (lanceur compris)
  - 1 PM — cibles : alliés (lanceur compris) ; 1 tour(s)

### Paire 22 : Mot de Reconstitution / Mot de Solidarité

*Mot de Reconstitution (soin 100 %, relance 6) ; Mot de Solidarité (transferts de vie).*

#### 22A. Mot de Reconstitution (id 13187, niveau de déblocage 90)

- **Caractéristiques** : **5 PA** · PO 0–8 (modifiable), en ligne, LdV · relance 6 · CC 0 %
- **Description officielle** : Soigne totalement l'allié ciblé mais le rend Insoignable.
- **Effets** :
  - Soigne 100 % des PV max de l'allié ciblé (0–8 PO en ligne) et le rend Insoignable 4 tours (désenvoûtable seulement par effet fort). Relance 6.
- **Rôle tactique** : Urgence : un allié vital presque mort. Ne plus compter sur aucun soin pour lui pendant 4 tours.
- **Tags** : `heal`, `emergency`
- **Grades** : g1 (niv. 90) : 5 PA, PO 0–7, relance 6 ; g2 (niv. 157) : 5 PA, PO 0–8, relance 6
- *Infobulle décodée (auto)* :
  - Soin : 100% des PV max — cibles : alliés (lanceur compris)
  - État « Insoignable » — cibles : alliés (lanceur compris) ; 4 tour(s) ; désenvoûtable seulement par effet fort

#### 22B. Mot de Solidarité (id 13219, niveau de déblocage 200)

- **Caractéristiques** : **1 PA** · PO 0–7 (modifiable), LdV · 2/tour · 1/cible · CC 0 %
- **Description officielle** : Transfère une partie de la vie de l'allié ciblé à tous les alliés Encouragés. Le transfert venant d'une Fée du lanceur est plus important.  Sur un allié Encouragé : transfère une partie de la vie de tous les alliés Encouragés à la cible.
- **Effets** :
  - Sur un allié non Encouragé : transfère 10 % de ses PV vers chaque allié Encouragé (90 % si la source est une Fée du lanceur).
  - Sur un allié Encouragé : transfère vers lui 10 % des PV de chaque allié Encouragé (90 % depuis les Fées).
  - 1 PA, 0–7 PO modifiable, 2/tour, 1/cible.
- **Rôle tactique** : Sacrifier une Fée (90 % de ses PV) pour soigner un allié en urgence.
- **Tags** : `heal_transfer`, `emergency`
- *Infobulle décodée (auto)* :
  - Transfère 10% des PV — cibles : alliés (lanceur compris), ennemis
  - Transfère 90% des PV — cibles : alliés (lanceur compris), ennemis

## Invocations

### Lapino (monstre 7370, grade 3) — Lapino (Mot d'Amitié, P5A)

- PA 7, PM 3 (−1 = statique), PV = 100 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 10 / Terre 10 / Feu 10 / Eau 10 / Air 10 ; caractéristiques propres : Force 300, Intelligence 300, Chance 300, Agilité 300
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 100}
- Joue : True ; tacle : True ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65640) : voir la mécanique correspondante ci-dessus.
- Sorts : Lapinopoing (#25790, g3), Bisou Magique (#25785, g3), Prévention (#25786, g3), Mutation (#25787, g1), Souffle Alchimique (#25788, g3)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 140], [10, 0.125], [11, 0], [12, 18.75], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Fiole Alchimique (monstre 7371, grade 2) — Fiole Alchimique (Mot Alchimique, P5B)

- PA 0, PM -1 (−1 = statique), PV = 50 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 50, 'strength': 100, 'wisdom': 100, 'chance': 100, 'agility': 100, 'intelligence': 100, 'bonusEarthDamage': 100, 'bonusFireDamage': 100, 'bonusWaterDamage': 100, 'bonusAirDamage': 100}
- Joue : False ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65659) : voir la mécanique correspondante ci-dessus.
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 180], [10, 37.5], [11, 0], [12, 31.25], [13, 37.5], [14, 0.125], [15, 37.5], [19, 1], [23, 1], [25, 0.125]]`

### Fée Stimulante (monstre 7372, grade 3) — Fée Stimulante (Mot Stimulant sur case libre)

- PA 4, PM 5 (−1 = statique), PV = 30 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 30, 'strength': 100, 'wisdom': 100, 'chance': 100, 'agility': 100, 'intelligence': 100, 'bonusEarthDamage': 100, 'bonusFireDamage': 100, 'bonusWaterDamage': 100, 'bonusAirDamage': 100}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65598) : voir la mécanique correspondante ci-dessus.
- Sorts : Compliment (#25770, g3), Espièglerie (#25771, g1), Encouragement Stimulant (#25765, g1)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 0.125], [11, 0], [12, 23.75], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Fée de Jouvence (monstre 7373, grade 3) — Fée de Jouvence

- PA 4, PM 5 (−1 = statique), PV = 30 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 30, 'strength': 100, 'wisdom': 100, 'chance': 100, 'agility': 100, 'intelligence': 100, 'bonusEarthDamage': 100, 'bonusFireDamage': 100, 'bonusWaterDamage': 100, 'bonusAirDamage': 100}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65598) : voir la mécanique correspondante ci-dessus.
- Sorts : Espièglerie (#25771, g1), Compliment (#25770, g3), Encouragement de Jouvence (#25766, g3)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 0.125], [11, 0], [12, 23.75], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Fée Vivifiante (monstre 7374, grade 3) — Fée Vivifiante

- PA 4, PM 5 (−1 = statique), PV = 30 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 30, 'strength': 100, 'wisdom': 100, 'chance': 100, 'agility': 100, 'intelligence': 100, 'bonusEarthDamage': 100, 'bonusFireDamage': 100, 'bonusWaterDamage': 100, 'bonusAirDamage': 100}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65598) : voir la mécanique correspondante ci-dessus.
- Sorts : Espièglerie (#25771, g1), Compliment (#25770, g3), Encouragement Vivifiant (#25767, g3)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 0.125], [11, 0], [12, 23.75], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Fée Galvanisante (monstre 7375, grade 3) — Fée Galvanisante

- PA 4, PM 5 (−1 = statique), PV = 30 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 30, 'strength': 100, 'wisdom': 100, 'chance': 100, 'agility': 100, 'intelligence': 100, 'bonusEarthDamage': 100, 'bonusFireDamage': 100, 'bonusWaterDamage': 100, 'bonusAirDamage': 100}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65598) : voir la mécanique correspondante ci-dessus.
- Sorts : Espièglerie (#25771, g1), Encouragement Galvanisant (#25768, g1), Compliment (#25770, g3)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 0.125], [11, 0], [12, 23.75], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Feu Décourageant (monstre 7376, grade 3) — Feu Décourageant (Mot Décourageant sur case libre)

- PA 4, PM 5 (−1 = statique), PV = 30 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 30, 'strength': 100, 'wisdom': 100, 'chance': 100, 'agility': 100, 'intelligence': 100, 'bonusEarthDamage': 100, 'bonusFireDamage': 100, 'bonusWaterDamage': 100, 'bonusAirDamage': 100}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65723) : voir la mécanique correspondante ci-dessus.
- Sorts : Moquerie Décourageante (#25778, g1), Cachoterie (#25818, g1), Insulte (#25777, g3)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 0.125], [11, 0], [12, 23.75], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Feu de Déclin (monstre 7377, grade 3) — Feu de Déclin

- PA 4, PM 5 (−1 = statique), PV = 30 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 30, 'strength': 100, 'wisdom': 100, 'chance': 100, 'agility': 100, 'intelligence': 100, 'bonusEarthDamage': 100, 'bonusFireDamage': 100, 'bonusWaterDamage': 100, 'bonusAirDamage': 100}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65723) : voir la mécanique correspondante ci-dessus.
- Sorts : Moquerie de Déclin (#25779, g1), Cachoterie (#25818, g1), Insulte (#25777, g3)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 0.125], [11, 0], [12, 23.75], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Feu Accablant (monstre 7378, grade 3) — Feu Accablant

- PA 4, PM 5 (−1 = statique), PV = 30 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 30, 'strength': 100, 'wisdom': 100, 'chance': 100, 'agility': 100, 'intelligence': 100, 'bonusEarthDamage': 100, 'bonusFireDamage': 100, 'bonusWaterDamage': 100, 'bonusAirDamage': 100}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65723) : voir la mécanique correspondante ci-dessus.
- Sorts : Cachoterie (#25818, g1), Insulte (#25777, g3), Moquerie Accablante (#25780, g3)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 0.125], [11, 0], [12, 23.75], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

### Feu Déprimant (monstre 7379, grade 3) — Feu Déprimant

- PA 4, PM 5 (−1 = statique), PV = 30 % des PV de l'invocateur (convention du projet, INCERTAIN) + PV de base 0
- Résistances % : Neutre 0 / Terre 0 / Feu 0 / Eau 0 / Air 0 ; caractéristiques propres : Force 0, Intelligence 0, Chance 0, Agilité 0
- Bonus hérités de l'invocateur (en %, INCERTAIN) : {'lifePoints': 30, 'strength': 100, 'wisdom': 100, 'chance': 100, 'agility': 100, 'intelligence': 100, 'bonusEarthDamage': 100, 'bonusFireDamage': 100, 'bonusWaterDamage': 100, 'bonusAirDamage': 100}
- Joue : True ; tacle : False ; poussable : True ; échangeable : True ; place d'invocation : True
- Sort de départ (niveau de sort 65723) : voir la mécanique correspondante ci-dessus.
- Sorts : Moquerie Déprimante (#25781, g1), Cachoterie (#25818, g1), Insulte (#25777, g3)
- characRatios (donnée brute, sémantique INCERTAINE) : `[[0, 300], [10, 0.125], [11, 0], [12, 23.75], [13, 0.125], [14, 0.125], [15, 0.125], [19, 1], [23, 1], [25, 0.125]]`

## Rôle en groupe PvM (niveau 200)

### Rôles officiels (DofusDB, valeur /12)

Soins 12, Entrave 9, Amélioration 9, Dégâts 7, Placement 5, Invocation 5, Protection 2, Tank 0

### Rôles retenus pour l'IA de composition

- **soigneur-principal** (priorité 1, élément : Feu (Intelligence) en groupe, Eau (Chance) en solo, Air possible) — Mot Tapageur (croix 2), Mot Turbulent (croix 1, 36–41), Mot Distrayant (croix 3), Vacarme, Chœur Strident (40–44 + rampe), Mot de Jouvence (10 % PV max ×2), Fontaine de Jouvence (10 % en zone ×2), Mot de Reconstitution (100 %), Lamentations/Sanglots (soins vampiriques).
- **booster** (priorité 2, élément : indifférent) — Mot Stimulant (+2 PA 2 tours) sur le meilleur DPS chaque tour (1/tour), Mot Galvanisant (+150 Puissance + 300 bouclier), Mot Vivifiant (+2 PM), Alchi-Rhétorique (+10 % soins finaux, PA remboursé).
- **entraveur** (priorité 3, élément : indifférent) — Moqueries : −2 PA, −3 PM, −150 Puissance −25 Dommages, ou ×0,75 soins reçus ; Cri Assourdissant (−2 PA), Mot Espiègle (−2 PM), Murmure (vol de PM), Mot Malicieux (−30 Puissance par PM utilisé).
- **dps-hybride** (priorité 4, élément : Air ou Eau) — Mot Interdit (46–50), Scalpel (40–44 meilleur élément), Mot Fleuri, Bosquet Enchanté, Lamentations (cercle 2), Mot Secret (ligne, 58–62 tous les 2 tours).

### Choix des variantes par rôle

| Paire | `eniripsa_soin_feu_groupe` | `eniripsa_air_boost` | `eniripsa_entrave_moqueries` |
|---|---|---|---|
| 1 | A — Mot Espiègle | B — Mot Malicieux | A — Mot Espiègle |
| 2 | A — Mot Tapageur | A — Mot Tapageur | B — Cri Assourdissant |
| 3 | A — Mot Vampirique | A — Mot Vampirique | A — Mot Vampirique |
| 4 | B — Onguent Ancestral | B — Onguent Ancestral | A — Juron |
| 5 | A — Mot d'Amitié | A — Mot d'Amitié | B — Mot Alchimique |
| 6 | A — Mot Stimulant | A — Mot Stimulant | B — Mot de Déclin |
| 7 | B — Scalpel | B — Scalpel | A — Mot de Frayeur |
| 8 | B — Vacarme | A — Lamentations | A — Lamentations |
| 9 | A — Mot Turbulent | A — Mot Turbulent | A — Mot Turbulent |
| 10 | B — Mot Galvanisant | B — Mot Galvanisant | A — Mot Vivifiant |
| 11 | A — Mot Farceur | A — Mot Farceur | B — Mot Défendu |
| 12 | A — Peinture de Guerre | B — Mot Secret | A — Peinture de Guerre |
| 13 | A — Mot de Jouvence | A — Mot de Jouvence | B — Mot Déprimant |
| 14 | A — Cri de Guerre | A — Cri de Guerre | A — Cri de Guerre |
| 15 | A — Mot Interdit | A — Mot Interdit | A — Mot Interdit |
| 16 | A — Mot Accablant | A — Mot Accablant | A — Mot Accablant |
| 17 | B — Mot Distrayant | A — Chapardage | A — Chapardage |
| 18 | B — Bosquet Enchanté | B — Bosquet Enchanté | A — Mot Fleuri |
| 19 | B — Fontaine de Jouvence | B — Fontaine de Jouvence | A — Mot d'Envol |
| 20 | B — Chœur Strident | A — Pinceau Tribal | B — Chœur Strident |
| 21 | A — Cryothérapie | B — Murmure | B — Murmure |
| 22 | A — Mot de Reconstitution | A — Mot de Reconstitution | A — Mot de Reconstitution |

- `eniripsa_soin_feu_groupe` : Eniripsa soigneur Feu (groupe 4) : soins de zone Feu, Encouragements, Jouvence, Fontaine, Reconstitution.
- `eniripsa_air_boost` : Eniripsa Air (dégâts + soins Air) avec Encouragements : Mot Fleuri, Bosquet Enchanté, Mot Secret, Mot Farceur, Murmure.
- `eniripsa_entrave_moqueries` : Eniripsa entraveur : Moqueries (Décourageant/Accablant/Déprimant/Déclin), Cri Assourdissant, Mot Espiègle, Murmure, Feux Follets.

### Rotations types (PA indiqués entre parenthèses, 11–12 PA / 6 PM)

**Eniripsa soin — tour type (12 PA)** — objectif : Remettre le groupe à flot tout en boostant le DPS ; garder Mot de Reconstitution (5 PA) pour une urgence.

1. Mot Stimulant (2) sur le DPS principal (+2 PA, 2 tours)
2. Mot Turbulent (4) ou Mot Tapageur (3) centré sur les alliés blessés au contact des ennemis (soigne les alliés, frappe les ennemis)
3. Mot de Jouvence (2) sur l'allié le plus bas (10 % PV max maintenant + 10 % au début de son tour)
4. Fontaine de Jouvence (3) si 2+ alliés à portée, sinon Mot Tapageur / Vacarme

**Eniripsa entrave — boss (12 PA)** — objectif : Une Moquerie par ennemi + retraits élémentaires ; Moqueries lancées sur case vide = Feux Follets pour atteindre d'autres cibles au tour suivant.

1. Mot Décourageant (2) −2 PA ou Mot Accablant (2) −3 PM
2. Mot Déprimant (2) sur le frappeur (−150 Puissance, −25 Dommages) — remplace la Moquerie précédente : choisir UNE Moquerie par cible
3. Cri Assourdissant (3) −2 PA
4. Mot Espiègle (3) −2 PM
5. Mot Stimulant (2) sur un allié

**Eniripsa Alchi-Rhétorique (12 PA)** — objectif : Utiliser le Lapino comme relais de zone pour les Encouragements.

1. Mot d'Amitié (3) : Lapino au contact du groupe
2. Mot Tapageur (3) en croix incluant le Lapino → +1 PA remboursé, +10 % soins finaux, Lapino en Feu
3. Mot Turbulent (4) / Mot Tapageur (3)
4. Mot Stimulant (2) sur le Lapino → appliqué aussi aux alliés dans l'anneau 1–2 autour de lui

### Synergies

- **Iop / Crâ / Sram (DPS)** : Mot Stimulant (+2 PA 2 tours) + Mot Galvanisant (+150 Puissance) sur le DPS ; cumulable avec Puissance de l'Iop (Encouragements et sorts d'autres classes ne s'excluent pas).
- **Féca / Pandawa (tank)** : Soins massifs sur le tank, Mot Exsangue sur un boss (les alliés qui le frappent se soignent de 25 %), Cryothérapie (bouclier).
- **Xélor / Enutrof (entrave)** : Moqueries −2 PA / −3 PM cumulées aux retraits des entraveurs ; Mot de Déclin réduit les soins des boss qui se soignent.
- **Sacrieur** : Le Sacrieur encaisse et l'Eniripsa le soigne en zone ; attention, Mot de Reconstitution rend Insoignable 4 tours.
- **Ecaflip** : Double soigneur hybride (Langue Râpeuse, Topkaj, Neuf Vies) ; la Roue de la Fortune de l'Ecaflip donne 999 % de critique aux alliés au contact.

### Notes pour la démo « Œil de Vortex »

- « En temps et en heure » ajoute +20 % d'érosion (2 tours) et frappe 500 Terre + 50 % des PV érodés : les soins de l'Eniripsa sont plafonnés par les PV max érodés ; prioriser les soins en % (Jouvence, Fontaine) et Mot de Reconstitution en urgence (docs/research/vortex.md §0).
- Les bonus d'heure donnés par Heurage aux monstres sont `dispellable 2` : Mot de Déclin / Scalpel / Mot Interdit (durée −1, dispellable 1 seulement) ne les retirent PAS.
- Phase 2 : Mot Déprimant (−150 Puissance, −25 Dommages) et Mot Décourageant (−2 PA) sur le Vortex (16 PA) ; Mot Stimulant sur le DPS principal pour le tour de vulnérabilité.
- Mot d'Envol / Mot Farceur (retour en fin de tour) pour sortir un allié de la ligne de l'Auroraire.

### Forces

- Meilleur soigneur du jeu : soins de zone, soins en % PV max, soin total, soins sur vol de vie et soins périodiques.
- Boosts universels (+2 PA, +2 PM, +150 Puissance, bouclier) utilisables chaque tour.
- Entrave complète via Moqueries (PA, PM, Puissance/Dommages, soins reçus) + retraits élémentaires.
- Polyvalence élémentaire : chaque élément a ses soins.

### Faiblesses

- Dégâts modestes comparés à un DPS dédié ; beaucoup de sorts mono-cible.
- Peu de mobilité (Mot d'Envol seulement) et fragile ; cible prioritaire des IA.
- Encouragements/Moqueries limités à 1 par cible (cumul partagé) et 1 lancer par sort et par tour.
- Plusieurs effets reposent sur des invocations (Lapino, Fioles, Lucioles) qui consomment des places d'invocation.

## États importants

| État | Nom (données) | Rôle |
|---|---|---|
| #4157 | Encouragé | Encouragé — un seul Encouragement à la fois |
| #4163 | Moqué | Moqué — une seule Moquerie à la fois |
| #4159 | Stimulé | Stimulé (+2 PA) |
| #4160 | Rajeuni | Rajeuni (Jouvence) |
| #4161 | Vivifié | Vivifié (+2 PM) |
| #4162 | Galvanisé | Galvanisé (+150 Puissance) |
| #4164 | Découragé | Découragé (−2 PA) |
| #4165 | Décadent | Décadent (Déclin) |
| #4166 | Déprimé | Déprimé (−150 Puissance) |
| #4167 | Accablé | Accablé (−3 PM) |
| #4175 | Mot de Terre | Mot de Terre (Lapino) |
| #4176 | Mot de Feu | Mot de Feu (Lapino) |
| #4177 | Mot d'Eau | Mot d'Eau (Lapino) |
| #4178 | Mot d'Air | Mot d'Air (Lapino) |
| #4171 | Fiole Craquelée | Fiole Craquelée (Terre) |
| #4172 | Fiole Embrasée | Fiole Embrasée (Feu) |
| #4173 | Fiole Givrée | Fiole Givrée (Eau) |
| #4174 | Fiole Éventée | Fiole Éventée (Air) |
| #4185 | Alchi-Rhétorique I | Alchi-Rhétorique I (remboursement déjà obtenu ce tour) |
| #4186 | Alchi-Rhétorique II | Alchi-Rhétorique II |
| #4168 | Lapinou | Lapinou (Lapino soigneur) |
| #4169 | Lapino Mutant | Lapino Mutant (offensif) |
| #2130 | Contrôlé | Contrôlé (invocations maîtrisées : condition de Mutation) |
| #4189 | Lapino Invoqué | Lapino Invoqué |
| #4190 | Lapino Invoqué et limite atteinte | Lapino Invoqué et limite atteinte |
| #4440 | Peinture | Peinture (affichée) |
| #4243 | Peinture | Peinture alliée |
| #4244 | Peinture | Peinture ennemie |
| #4231 | Chœur Strident I | Chœur Strident I (+5) |
| #4232 | Chœur Strident II | Chœur Strident II (+10) |
| #4233 | Chœur Strident III | Chœur Strident III (+15) |
| #76 | Insoignable | Insoignable (Mot de Reconstitution, 4 tours) |
| #4201 | Turbulent | Turbulent |
| #4206 | Farce | Farce |
| #4438 | Floraison | Floraison |
| #4462 | Cryothérapie | Cryothérapie |
| #4205 | Malice | Malice |

## Points incertains

- INCERTAIN — États de rang (#4211–#4213 Peinture, #4252–#4254 Lapino, #5168–#5170 Accablant, #5171–#5173 Vivifiant, #5174–#5176 Jouvence, #4182/#4183 Fiole) jamais posés par un sort : supposés posés par le serveur selon le grade ; valeurs de rang maximal retenues au niveau 200.
- INCERTAIN — État #4247 « Tour Eniripsa » (remboursement immédiat vs +1 PA au tour suivant) et #4202 « Chœur Strident » : posés par le serveur (INCERTAIN).
- INCERTAIN — Potions des Fioles : les masques *E4182/*E4183 testent le lanceur du sous-sort ; la consommation par un allié est supposée utiliser le rang de la Fiole (20 soins, +150 caractéristique au niveau 200).
- INCERTAIN — Niveau utilisé pour les boucliers de Prévention (Lapino) : niveau de l'Eniripsa ou de l'invocation (grade 3 niveau 134) — INCERTAIN.
- INCERTAIN — PV des invocations : bonusCharacteristics.lifePoints (Lapino 100, Fiole 50, Lucioles 30) interprété comme % des PV de l'Eniripsa.
- INCERTAIN — Mot Stimulant : +2 PA « 2 tours » = l'allié profite du bonus sur 2 de ses tours (durée décomptée au début du tour du lanceur).

## Sources

- https://api.dofusdb.fr/breeds/7
- https://api.dofusdb.fr/spell-variants?breedId=7
- https://api.dofusdb.fr/spells?id[$in][]=25877 (… 44 sorts) et sous-sorts liés (data/dofusdb/class-spells.json)
- https://api.dofusdb.fr/spell-levels?spellId[$in][]=25877 (… 91 niveaux)
- https://api.dofusdb.fr/spells/25930, /25931 (textes Alchi-Rhétorique du Lapino / de la Fiole), /25753 (Fée), /25754 (Feu Follet)
- https://api.dofusdb.fr/monsters/7370 (Lapino), /7371 (Fiole Alchimique), /7372–7379 (Lucioles)
- docs/research/effects.md, data/research/effect-semantics.json, docs/research/formulas.md
- https://www.gamosaurus.com/?p=178715 (refonte Eniripsa 2.68 : Fées/Feux Follets, Fioles, Peinture, Chœur Strident)
- https://www.gamosaurus.com/jeux/dofus/guide-stuff-eniripsa-sur-dofus-items-equipements-dofusbook (guide Dofus Unity, modifié le 2 octobre 2025 : Eau solo, Air/Feu groupe)
