# Œil de Vortex — dossier de simulation

> Dossier de référence pour le simulateur DofusSimu (démo : donjon de dimension du Xélorium).
> Données machine : [`data/dungeons/vortex.json`](../../data/dungeons/vortex.json). Cache brut DofusDB : `.cache/vortex/`.
> Date de collecte : 2026-10-04. Les données de jeu viennent de l'API DofusDB (fichiers du client Dofus 3) ; les règles
> « serveur » (vagues, IA) viennent des guides. Tout ce qui n'est pas prouvé par les données est marqué **INCERTAIN**.

## 0. Résumé pour les ingénieurs (TL;DR)

- **Une seule salle** (carte `143393281`, « Salle des heures perdues »), **5 vagues**. Vague 1 = **Vortex + (N−1) monstres**,
  vagues 2-5 = **N monstres**, N = nombre de personnages au début du combat. Vagues suivantes toutes les **5 tours**
  (vague 2 au **tour 7** selon dofuspourlesnoobs 2024, tour 6 selon JOL 2016 — paramétrable). Chaque nouvelle vague est
  **invulnérable 1 tour**.
- **Le Vortex (3835) est invulnérable, indéplaçable et à −100 PM** tant que tous les monstres ne sont pas **corrompus**.
- **Horloge** : l'invocation **Auroraire (3833)** occupe successivement 12 cases (chiffres I..XII). Elle avance d'**une heure
  au début du tour de chaque personnage joueur**, et d'une heure **chaque fois qu'un personnage déclenche le glyphe d'un
  monstre**. Elle commence à XII (case 255) et passe à I (case 173) au premier tour d'un personnage.
- **Mort / résurrection / corruption** : un monstre tué reçoit l'état de l'heure courante (221..232) ; au début de chaque
  tour du Vortex il est **ressuscité** (20-30 % PV, état Zombi ; −1 PM permanent **INCERTAIN**, voir §6) avec le **bonus de
  chaque heure** où il a été tué. Quand l'horloge revient sur une de ses heures il reçoit **« Même heure » (234, étoile jaune)** ; le tuer à ce moment le
  **corrompt** : il revient invulnérable et passe tous ses tours (état 6611).
- **Déverrouillage** : quand tous les monstres sont corrompus (et pas avant le ~26e tour du Vortex : délai 25 dans les
  données, décompte exact ±1 **INCERTAIN**), un tour s'écoule, puis **« Action ! »** : tout le monde est téléporté à sa case de départ, tous les monstres
  meurent, le Vortex récupère **une fois par heure distincte** les bonus d'heures des monstres, reste invulnérable et passe son
  tour ; au tour suivant il est **vulnérable** (16 PA, 5 PM).
- **Danger permanent** : *En temps et en heure* (dès le 2e tour du Vortex, 1×/tour) : tous les ennemis **en ligne (même x
  ou même y) avec l'Auroraire** prennent **500 Terre de base + 50 % de leurs PV érodés** et **+20 % d'érosion** (2 tours).
  Avec 4 joueurs (et sans glyphe), l'Auroraire est sur **IV, VIII, XII** aux tours du Vortex (s'il joue après les 4 joueurs :
  équipe des joueurs qui commence + Vortex dernier de son équipe, cf. §5 ; sinon III, VII, XI).
- **Phase 2** : *Heuristique* (ligne 1-8 PO **sans LdV**, 3×/tour, Pacifiste), *Morfaille* (1-4 PO, zone r2 répétée),
  *Heurage* (téléportation au contact de l'Auroraire, relance 3).
- **Phase 1, piège peu documenté** : *Heurage* (relance 3, pas avant le tour 4) donne à **tous les monstres** le bonus de
  l'heure courante (permanent, cumulable) — confirmé par les données (sort 5065) et par Tofus.
- Faiblesses (grade 5) : Ikargn **Feu −10 %**, Méjaire **Terre −10 %**, Harpille **Neutre −10 %**, Buboxor **Air −10 %**,
  Brabuzar **Eau −10 %** ; Vortex : Neutre 6 %, Feu 12 % (les plus basses).
- Aucune ligne de vue n'est requise pour les zones (croix r63) : un obstacle ne protège PAS d'*En temps et en heure*.

## 1. Identité du donjon (DofusDB `dungeons/87`)

| Champ | Valeur |
|---|---|
| Nom | Œil de Vortex (en : Eye of Vortex) |
| Dimension / zone | Xélorium, sous-zone 841 « Œil de Vortex », position [7,-7] — dernier donjon du Xélorium |
| Niveau | optimal 200, minimum 190, difficulté 4 ; monstres 200-212, boss 220 |
| Boss | Vortex (3835) — non capturable (`soulCaptureForbidden`) |
| Monstres | Ikargn 3834, Méjaire 3836, Harpille 3837, Buboxor 3838, Brabuzar 3839 (+ invocation Auroraire 3833) |
| Salle | 1 seule : carte 143393281 « Œil de Vortex - Salle des heures perdues » |
| Entrée / sortie | carte 144445702 |
| Clé | Clef de l'Œil de Vortex (15808) : 2× Serre d'Ikargn, 2× Griffe de Buboxor, 2× Corne de Méjaire, 2× Œil de Harpille, 1× Boucle des Égarés (avant-poste, 3 Orichor), 1× Perce-Neige, 1× Poisskaille, 1× Frostiz. Trousseau **non** utilisable (dimension). |
| Recherche de groupe | `availableInAutomaticGroupSearch: true`, `availableInLobby: true` |
| Succès | 1156, 1157, 1158, 1159, 6243 (voir §12) |

Historique : le donjon date de la mise à jour des dimensions divines (2015-2016, article JOL du 01/02/2016). Il a été
**simplifié en 2.42** (nerf des donjons end-game — [Millenium](https://www.millenium.org/guide/273667.html),
[Gamosaurus](https://www.gamosaurus.com/?p=61151)). Les données DofusDB utilisées ici sont celles de Dofus 3 (2026).

## 2. La carte (salle des heures perdues)

Source des cellules : `data/maps/143393281.json` (extrait de `https://api.dofusdb.fr/maps/143393281.json`, `cellsData`) —
222 cases marchables, 76 cases bloquant la ligne de vue, 12 cases de départ rouges, 10 bleues. Image :
<https://api.dofusdb.fr/img/maps/1/143393281.jpg> (une horloge géante, chiffres romains I..XII sur l'anneau).

Rendu ASCII (lignes de cellules à l'écran, une ligne sur deux décalée comme en jeu ; colonne de gauche = n° de ligne et
id de la 1re cellule de la ligne) :

```
légende : . marchable   # obstacle (bloque LdV)   (blanc) non marchable sans blocage de LdV
          J départ joueurs (cases rouges)   M départ monstres (cases bleues)   @ Auroraire au départ (255)
          + centre de l'horloge (328, obstacle)   1..9 = heures I..IX, a = X, b = XI, c = XII (cases de l'Auroraire)
11 154 |
12 168 |          1   # 2
13 182 |         # # # # # #
14 196 |        # # # . # # #
15 210 |     c # . . . . . . 3
16 224 |      # . . . . . . . #
17 238 |     # . . . . . . . . #
18 252 |    # @ . . . . . . . . #
19 266 |   # M M M M M M M M M M #
20 280 |  b . . . . . . . . . . 4 #
21 294 | # . . . . . . . . . . . . #
22 308 |  # . . . . . . . . . . . #
23 322 | # . . . . . + . . . . . . #
24 336 |  # . . . . # # . . . . . #
25 350 | # . . . . . # # . . . . . #
26 364 |  a . # . . . # . . . . 5 #
27 378 | # . . . . . . . . . . . . #
28 392 |  # . . . . . . . . . . . #
29 406 | # . . . . # . . # . . . . #
30 420 |  # . . J . . J . . J . . #
31 434 | # . 9 . J . J J . J 6 . . #
32 448 |  # . . . J . J . J . . . #
33 462 |   # . . . . . . . . . . #
34 476 |    # . . 8 J . 7 . . . #
35 490 |     # . . . . . . . . #
36 504 |      # . . . . . . . #
37 518 |       # # . . . . # #
```

- **Cases de départ** : rouges `424, 427, 430, 438, 440, 441, 443, 453, 455, 457, 482, 484` (en bas) ; bleues
  `268..277` (ligne 19, en haut). Hypothèse : joueurs = rouge, monstres = bleu (convention PvM ; cohérent avec les guides
  « les monstres restés en haut ») — **INCERTAIN** mais très probable. Les vagues réapparaissent **sur les cases où la vague
  1 a commencé** (JOL).
- **La case 484 (départ joueur) est la case de l'heure VII** : quand l'Auroraire passe à VII, l'occupant est échangé de
  force avec elle.
- Coordonnées : convention `MapPoint` de Dofus (voir `map.coordinateSystem` du JSON). « En ligne » = même x ou même y
  (ce sont les diagonales à l'écran). Distance = |dx| + |dy|.
- Les cases d'heures I, II, III, X, XI, XII et le centre sont **non marchables** (décor) : l'Auroraire y est placée par
  script ; ses lignes traversent quand même l'arène. III (220), X (365), XI (281) et le centre (328) bloquent en plus la
  ligne de vue (`los = 0`) ; I, II, XII non. La case d'invocation 255 est marchable.

**Lignes de l'Auroraire** (cases frappées par *En temps et en heure* quand l'Auroraire est sur l'heure ; données dans `map.auroraire.hours[]`) :

| Heure | État | Case | (x,y) | Case marchable | Bonus (monstre tué à cette heure) | Cases marchables en ligne | Cases de départ joueurs en ligne | Cases de départ monstres en ligne |
|---|---|---|---|---|---|---|---|---|
| I | 221 | 173 | (11,-1) | non | +10 % Critique, +200 Dommages critiques | 13 | — | [274] |
| II | 222 | 176 | (14,2) | non | État Intaclable (96) | 19 | — | [270, 277] |
| III | 223 | 220 | (18,3) | non | +400 Intelligence | 15 | — | [274] |
| IV | 224 | 292 | (22,2) | oui | +2 PM | 22 | [427, 440] | [277] |
| V | 225 | 376 | (25,-1) | oui | Dommages subis x70 % (Vortex : x75 %) | 25 | [430, 443, 457, 484] | [274] |
| VI | 226 | 444 | (26,-5) | oui | +400 Chance | 24 | [430] | [270] |
| VII | 227 | 484 | (25,-9) | oui | +150 Résistances critiques | 27 | [430, 440, 443, 455, 457] | — |
| VIII | 228 | 481 | (22,-12) | oui | +4 PA | 27 | [427, 440] | — |
| IX | 229 | 436 | (18,-13) | oui | +400 Force | 23 | — | [274] |
| X | 230 | 365 | (14,-12) | non | État Inébranlable (157) : ne peut pas être poussé | 24 | — | [270] |
| XI | 231 | 281 | (11,-9) | non | +30 % Vitalité (PV max) | 15 | [440, 455, 484] | — |
| XII | 232 | 212 | (10,-5) | non | +400 Agilité | 14 | [430] | [270] |

**Lecture pratique à 4 joueurs** (Vortex jouant après les 4 joueurs, aucun glyphe déclenché) : heures IV → VIII → XII aux
tours du Vortex. IV (22,2) et VIII (22,−12) partagent la **colonne x = 22** : les départs `427` (22,−8) et `440` (22,−9)
sont dans la ligne de IV **et** de VIII ; `430` (25,−5) est dans la ligne de XII (y = −5). Départs sûrs vis-à-vis de ces
trois heures : `424, 438, 441, 443, 453, 455, 457, 482` (et `484`, mais c'est la case de VII).

## 3. Vue d'ensemble du combat (machine à états)

```
Début : Vortex + (N−1) monstres (vague 1) sur les cases bleues ; joueurs sur les rouges.
        Vortex lance Vortexiphan (5006 g1) : invoque l'Auroraire (case 255, heure XII), Invulnérable, Indéplaçable,
        −100 PM, Marginal 25 tours, + déclencheurs de début de tour.
        Chaque monstre lance « Glyphe téléporteur » (5002) : marquage à la mort, glyphe à chaque début de tour.

Boucle (phase 1, Vortex Marginal) :
  début du tour d'un personnage  -> Auroraire +1 heure (et déplacement sur la case de l'heure, échange forcé si occupée)
  début du tour d'un monstre     -> glyphe sous lui (si non invulnérable) ; repousse de 2 ses alliés invulnérables (croix r2)
  personnage déclenche un glyphe -> échange de place avec le monstre, bonus pour les deux, Auroraire +1 heure
  mort d'un monstre              -> état de l'heure courante (cumulable)
  début du tour du Vortex        -> résurrection des morts (20-30 % PV, Zombi, −1 PM ?, bonus d'heures ; corrompu si
                                    tué en « Même heure ») ; [tour >= ~26] Marginal 1 tour s'il reste un non-corrompu ;
                                    [tour >= ~26 et plus Marginal] Action !
  tour du Vortex                 -> En temps et en heure (tour >= 2), Contamination zombie (x2), Heurage (tour >= 4, relance 3)
  timer de vague (5 tours)       -> nouvelle vague (N monstres, invulnérables 1 tour)

Transition : dernier monstre corrompu -> 1 tour du Vortex « à vide » (plus Marginal : Heurage = téléportation 5067)
             -> Action ! (téléportation de tous aux cases de départ, mort de tous les monstres, bonus d'heures au
             Vortex, Vortex invulnérable + tour passé 1 tour)

Phase 2 : Vortex vulnérable, 16 PA / 5 PM (+ bonus d'heures) : Heurage (tp Auroraire, /3 tours), Heuristique, Morfaille,
          En temps et en heure. L'Auroraire continue d'avancer. Victoire à la mort du Vortex.
```

## 4. Les vagues

| Paramètre | Valeur | Source |
|---|---|---|
| Nombre de vagues | 5 (la vague 1 contient le boss) | DPLN, JOL, Tofus, Gamosaurus |
| Monstres par vague | vague 1 : Vortex + (N−1) ; vagues 2-5 : N | DPLN (« boss dès le début + 3 autres monstres si vous êtes 4 ») |
| N | nombre de personnages **au début** du combat (un mort ne réduit pas les vagues suivantes) | JOL |
| Intervalle | 5 tours ; la vague 1 dure un tour de plus : vagues aux tours **1, 7, 12, 17, 22** (DPLN 2024) — JOL : 1, 6, 11, 16, 21 | DPLN / JOL |
| Vague anticipée | si tous les monstres d'une vague sont tués avant le timer, la suivante arrive immédiatement — **INCERTAIN** dans le Vortex (les monstres ressuscitent / restent corrompus sur la carte) | DPLN (règle générale) |
| Invulnérabilité | 1 tour pour les nouveaux arrivants | DPLN, JOL, next-stage |
| Apparition | sur les cases où la vague 1 a commencé (cases bleues) | JOL |
| Grade | JOL : tous les monstres de vague niveau 212 (grade 5) ; boss 220 (grade 1-5 : 15 000 à 22 000 PV) — grade effectif **INCERTAIN**, défaut grade 5 | JOL, Tofus |

Composition (tableau JOL, 2016/2019 — **INCERTAIN** s'il a changé depuis) :

| Joueurs | Vague 1 | Vague 2 | Vague 3 | Vague 4 | Vague 5 |
|---|---|---|---|---|---|
| 4 | **Vortex**, Ikargn, Méjaire, Harpille | Harpille, Harpille, Buboxor, Brabuzar | Méjaire, Méjaire, Harpille, Brabuzar | Brabuzar, Brabuzar, Méjaire, Ikargn | Buboxor, Buboxor, Brabuzar, Ikargn |
| +5e | + Buboxor | + Ikargn | + Ikargn | + Harpille | + Méjaire |
| +6e | + Brabuzar | + Harpille | + Buboxor | + Brabuzar | + Harpille |
| +7e | + Ikargn | + Ikargn | + Méjaire | + Buboxor | + Brabuzar |
| +8e | + Harpille | + Méjaire | + Harpille | + Méjaire | + Méjaire |

Moins de 4 joueurs : non documenté ; hypothèse de travail = retirer les derniers monstres de chaque vague de la ligne « 4 »
(**INCERTAIN**). À 4 joueurs, le combat compte donc **19 monstres de vague + Vortex** ; tous doivent être corrompus.

Le Brabuzar n'existe que dans le donjon (sous-zone 841), les autres monstres vivent aussi dans la tour (sous-zone 838).

## 5. L'Auroraire et les heures (mécanique centrale du Xélorium)

**Données** (sorts 4999, 4996, 5000-5002, 5009, 5065) :

1. Vortexiphan invoque l'**Auroraire (3833)** sur la case **255** : 5 500 PV, 0 PA, 0 PM, toutes caractéristiques à 0,
   ne tacle pas, ne peut être ni poussée ni portée. Son sort de départ *Heure du temps* (4999) la rend **Invulnérable** et
   **Indéplaçable**, lui donne l'état **Douzième heure (232)** et pose sur chaque **personnage joueur** (masque `L`) un
   déclencheur « début de tour » qui lui fait lancer *Décalage horaire* (4996).
2. **Décalage horaire (4996)**, lancé par l'Auroraire à l'heure h :
   - retire « Même heure » (234) de tous les alliés ;
   - pose « Même heure » sur chaque monstre **non corrompu** (sans 6611) qui porte l'état de l'heure **h+1** ;
   - se déplace vers la case de l'heure h+1 : **échange forcé** (1023) avec l'entité qui l'occupe, sinon téléportation (4) ;
   - remplace son état d'heure par h+1 (XII → I).
3. **Autres sources d'avance** : chaque déclenchement d'un glyphe de monstre (sort 5011 → 5025 → 4996). La réaction
   « si l'Auroraire subit des dommages » (4998) est probablement inactive puisqu'elle est invulnérable — **INCERTAIN**.
   Même déclenchée, elle n'avance pas toujours l'heure : téléportation symétrique de l'attaquant (masque `o`), puis, si
   une entité est **téléfraguée** (masque `T`, sens donné par `effects.md` §5), état Feinte (4997) sur l'Auroraire et
   renvoi de 100 % des dommages ; 5005 n'avance l'heure que si Feinte est posée (sauf en Songes, 6490 : toujours).
4. **Cycle** : avec N joueurs et sans glyphe, +N heures par tour de jeu ; N ∈ {2,3,4,6} (diviseurs de 12) ⇒ un même
   personnage joue toujours aux mêmes heures et le Vortex voit toujours les mêmes heures :
   - 4 joueurs : 3 tours pour un cycle complet ; Vortex sur IV / VIII / XII (DPLN) ;
   - 3 joueurs : 4 tours ; Vortex sur III / VI / IX / XII ;
   - 6 joueurs : 2 tours ; Vortex sur VI / XII ;
   - 5, 7, 8 joueurs : cycle irrégulier.
   Formule (sans glyphe) : `heure(t) = ((k + N·(t−1) − 1) mod 12) + 1`, k = nombre de tours de personnages joués avant le
   Vortex au tour 1 ; chaque glyphe déclenché ajoute +1.
   **Pourquoi k = 4 à 4 joueurs** (déduit, **INCERTAIN**) : la timeline alterne les équipes par initiative
   (`mechanics.md` §8 ; initiative = somme des 4 caractéristiques × PV/PVmax). Vortex : 4 × 800 = 3 200 ; monstres de vague
   grade 5 : 4 × 850 = 3 400 → le Vortex est le **dernier** de son équipe. Si l'équipe des joueurs commence :
   P1 M1 P2 M2 P3 M3 P4 V → k = 4 (IV/VIII/XII, cas DPLN). Si les monstres commencent : M1 P1 M2 P2 M3 P3 V P4 → k = 3
   (III/VII/XI : XI = +30 % vitalité). Aux grades 1-3 des monstres (650-750), le Vortex aurait la meilleure initiative de
   son équipe. Tofus recommande d'ailleurs un personnage « à l'initiative ».

**Bonus par heure** (posés sur les monstres ressuscités par 5002, sur tous les monstres par *Heurage* 5065, et sur le Vortex
au déverrouillage par 5009 — une seule fois par heure pour le Vortex) :

| Heure | État | Case Auroraire | Bonus |
|---|---|---|---|
| I | 221 Première heure | 173 | +10 % Critique, +200 Dommages critiques |
| II | 222 Deuxième heure | 176 | État Intaclable (96) |
| III | 223 Troisième heure | 220 | +400 Intelligence |
| IV | 224 Quatrième heure | 292 | +2 PM |
| V | 225 Cinquième heure | 376 | Dommages subis ×70 % (monstres) / ×75 % (Vortex, 5009) |
| VI | 226 Sixième heure | 444 | +400 Chance |
| VII | 227 Septième heure | 484 | +150 Résistances critiques |
| VIII | 228 Huitième heure | 481 | +4 PA |
| IX | 229 Neuvième heure | 436 | +400 Force |
| X | 230 Dixième heure | 365 | État Inébranlable (157) : ne peut pas être poussé |
| XI | 231 Onzième heure | 281 | +30 % Vitalité |
| XII | 232 Douzième heure | 212 | +400 Agilité |

Tous ces bonus sont permanents (`duration −1`) et non désenvoûtables (`dispellable` 2 ou 3). Heures à éviter pour les
kills (guides) : **V** (×70 %), **XI** (+30 % PV), **I** (critiques) ; heures « confortables » : III, VI, VIII, IX, XII.

## 6. Mort, résurrection, corruption

**À la mort** d'un monstre de vague (déclencheur `X` posé par 5002) : il prend *Mort latente* (233, 1 tour) et l'Auroraire
lui pose l'état de **l'heure courante** (5000). Les états d'heure s'accumulent si on le tue à plusieurs heures.

**Au début de chaque tour du Vortex** (5006 → 5003, avec animation) :
- `780` *Invoque le dernier allié mort avec 20 à 30 % de ses PV*, zone cercle r63 « min 3 » autour du Vortex : les guides
  confirment que **tous** les monstres morts depuis son dernier tour reviennent, placés à **3 PO du Vortex**, dans le sens
  horaire (DPLN, section Sadida). JOL/Tofus disent « moitié de ses PV » : **les données (20-30 %) font foi**, à vérifier
  en jeu (**INCERTAIN**).
- Le ressuscité est en état **Zombi (74)** (état ajouté par la résurrection — déduit, cible de *Contamination zombie*)
  et relance **5002**. Les données contiennent aussi **−1 PM permanent** (effet 169, masque `a,A,U`), mais dans une zone
  **P1 centrée sur le Vortex** alors que le ressuscité apparaît à ≥ 3 cases (780 et le 792→5002 utilisent, eux, la zone
  C63,3) : il ne s'applique que si le masque `U` ignore la zone — **INCERTAIN**, aucun guide ne le mentionne. 5002 :
  - s'il porte **Même heure (234)** → **corrompu** : *Tour annulé* permanent (140), **Invulnérable** permanent, état
    **6611** « Vortex (monstre tué à la même heure) » ;
  - sinon il gagne (à nouveau) le bonus de **chaque** état d'heure qu'il porte (le cumul exact à chaque résurrection est
    **INCERTAIN** ; les guides parlent d'un bonus par heure de mort).

**Corruption** : il faut tuer un monstre **pendant qu'il porte l'étoile « Même heure »**, c'est-à-dire quand l'Auroraire
est sur une des heures où il a déjà été tué. Précision déduite des données (4996) : l'étoile n'est posée qu'au moment où
l'horloge **arrive** sur l'heure, et seulement sur les monstres **vivants** non corrompus ; un monstre ressuscité alors que
l'horloge est déjà sur une de ses heures n'a pas l'étoile avant le passage suivant. Exemple DPLN : Méjaire tuée à VII → ressuscitée avec +150 rés. crit → la
retuer quand l'Auroraire est à VII. Si on la tue entre-temps à III, elle revient avec VII et III et pourra être corrompue à
III ou à VII. À 4 joueurs, le même personnage retrouve la même heure 3 tours plus tard (ex. Iop tue au tour 2 → corrompt
au tour 5).

Un monstre corrompu **reste sur la carte** (bloque les cases et la ligne de vue ; Gamosaurus : peut encore tacler ;
Tofus : « inébranlable, bloque juste les LdV ») jusqu'à *Action !*. Il est déplaçable (Pandawa) — utilisé pour le succès
Hardi. Les monstres qui commencent leur tour repoussent de 2 cases les alliés invulnérables en croix r2 (5012).

## 7. Glyphes des monstres

Au **début de son tour**, chaque monstre de vague **non invulnérable** pose un glyphe (effet 1165, sort 5011, durée 1,
cumulable 2) sur sa case. Un **personnage joueur** (pas une invocation) qui le déclenche :
1. **échange de place** avec le monstre poseur (sauf s'il est en Pesanteur / stabilisé / porté — Gamosaurus) ;
2. reçoit, **ainsi que le monstre**, le bonus du poseur ;
3. fait avancer l'Auroraire d'**une heure**.

| Poseur | Bonus (personnage ET monstre) |
|---|---|
| Ikargn | +1 PM (1 tour) |
| Méjaire | Soin 10 % des PV max |
| Harpille | +200 Puissance (1 tour) |
| Buboxor | Dommages subis ×50 % (1 tour) |
| Brabuzar | +200 Dommages de poussée (1 tour) |

Déclenchement : « en marchant dedans » (DPLN, JOL, Gamosaurus) ; Tofus dit « en terminant son tour dessus ». L'effet 1165
s'appelle `FightAddGlyphCastingSpellImmediate` → déclenchement **à l'entrée** retenu (**INCERTAIN** sur les cas limites :
téléportation dans le glyphe, début de tour dans le glyphe).

Usage tactique : **régler l'horloge** (+1 heure) pour que le bon personnage tue à la bonne heure, ou pour décaler la
position de l'Auroraire au tour du Vortex.

## 8. Le Vortex (boss, 3835)

Niveau 220 (tous grades), 16 PA, 5 PM, Force/Intelligence/Chance/Agilité 800, Sagesse 800, **esquive PM 20** (+ sagesse),
résistances Neutre 6 %, Terre 33 %, Feu 12 %, Eau 21 %, Air 28 %. PV : 15 000 / 17 000 / 18 000 / 20 000 / 22 000
(grades 1-5) ; grade 6 (22 000 PV, sort de départ 83735) = variante *Songes infinis*, hors donjon.

### 8.1 Phase 1 — « Marginal » (pendant les vagues)

Sort de départ **Vortexiphan (5006 grade 1, niveau 22886)** :
- invoque l'Auroraire (cellule 255) ; Invulnérable (56), Indéplaçable (97), **−100 PM** — tous permanents et non
  désenvoûtables ; **Marginal (236) 25 tours** ;
- propage Vortexiphan (grades 2/3) aux alliés « hors famille » (monstres étrangers, ex. invocations) : ils reçoivent aussi
  la mécanique d'heures (état 945) ;
- déclencheurs **début de tour** : résurrection (5003) ; **à partir de son ~26e tour** (délai 25, ±1 **INCERTAIN**) :
  Marginal 1 tour s'il reste un monstre non invoqué non corrompu (5008, masque `h,m,d,e6611` : l'Auroraire, invocation,
  n'est pas comptée), puis *Action !* (5060) s'il n'est plus Marginal.

Sorts utilisables (16 PA) :

| Sort | Coût | Portée | Règles | Effet |
|---|---|---|---|---|
| En temps et en heure (5062) | 1 PA | 1-63, sans LdV | 1×/tour, pas au tour 1 ; cible l'Auroraire | L'Auroraire exécute 5061 : **+20 % érosion (2 tours)**, **500 Terre** de base (Auroraire sans caractéristiques → ≈500 avant résistances, **INCERTAIN**) et **Terre = 50 % des PV érodés de la cible**, sur tous les ennemis en **croix r63** autour d'elle (hors sa case). + « +10 PA » technique (masque `a,A,T`, **INCERTAIN**). |
| Contamination zombie (5064) | 4 PA | 1-63, LdV | 2×/tour, 1×/cible ; seulement si Marginal | Cible un allié **Zombi** : **Insoignable 1 tour** aux ennemis à 1-2 cases de ce monstre. |
| Heurage (5066) | 4 PA | soi | relance 3, pas avant le tour 4 | Si Marginal : l'Auroraire donne à **tous les monstres sauf Vortex** le bonus de l'heure courante (permanent, cumulable). |

### 8.2 Transition — « Action ! » (5060)

Déclenchée au début du tour du Vortex quand il n'est plus Marginal (donc : plus aucun monstre non corrompu et ≥ ~26 tours) :
1. **Vortex et tous les personnages** sont téléportés à leur **case de début de combat** (784) ;
2. retrait des effets de Vortexiphan (invulnérabilité, −100 PM, indéplaçable, déclencheurs) ;
3. chaque monstre exécute 5009 : le Vortex reçoit le **bonus de chaque heure portée** par les monstres — **une seule fois
   par heure** (`maxStack 1`) ; ex. monstres tués à III et IV → +400 Int et +2 PM ;
4. **tous les monstres (sauf l'Auroraire) sont tués** (141) ;
5. Vortex **Invulnérable 1 tour** + **tour annulé** ;
6. si le Vortex possède les **12 heures**, les personnages reçoivent « dommages subis ×75 % » pour 63 tours (déduit du
   masque `L,*E221…*E232`, **INCERTAIN**) ;
7. retrait des états d'heure du Vortex.

Selon DPLN (2024) : « tour durant lequel vous avez achevé le dernier monstre → Vortex peut se téléporter sur l'Auroraire →
un tour complet avec tous les mobs corrompus → Vortex invulnérable, ne joue pas, tous les monstres disparaissent et tout le
monde retourne à sa position de départ → au prochain tour il perd Invulnérable et joue ». Deux tours « à vide » pour se
booster et se placer. Latences/déconnexions possibles au moment où il tue les monstres.

Lecture des données pour ce tour « à vide » (vérification) : au début du tour du Vortex qui suit le dernier kill, 5003
ressuscite le monstre **corrompu** puis 5008 ne pose plus Marginal ; *Action !* ne part pourtant qu'au tour suivant
(probablement parce que le Marginal 1 tour posé au tour précédent est encore actif quand les déclencheurs `TB` sont
évalués — **INCERTAIN**). Pendant ce tour le Vortex **n'est plus Marginal** : *Heurage* prend donc la variante
**téléportation** (5067), ce que décrit DPLN — et non la variante buff de phase 1. Conséquence non rapportée par les guides
(**INCERTAIN**) : *Heuristique*/*Morfaille* (`HS!236`) seraient déjà lançables ce tour-là (Vortex toujours invulnérable et
à −100 PM).

### 8.3 Phase 2 — Vortex vulnérable

| Sort | Coût | Portée | Règles | Effet |
|---|---|---|---|---|
| Heurage (5066) | 4 PA | soi | relance 3 | Si non Marginal : se **téléporte au contact de l'Auroraire** (5067). Utilisé dès qu'il est disponible (au plus tard le 1er tour vulnérable). |
| Heuristique (5068) | 4 PA | 1-8 **en ligne, sans LdV** | 3×/tour, 1×/cible, CC 20 % ; non Marginal | −2 tours aux effets de la cible (désenvoûtement partiel), **Pacifiste 1 tour (désenvoûtable)**, 41-50 Air + 41-50 Feu (CC 46-55 chacun). |
| Morfaille (5070) | 4 PA | 1-4, LdV | 3×/tour, 1×/cible, CC 20 % ; non Marginal | Renvoie la cible à sa **position précédente**, puis 5069 tout de suite **et au tour suivant** : 41-50 Neutre + 41-50 Eau aux ennemis à **1-2 cases** de la cible (pas la cible) + Terre = **20 % des PV érodés du lanceur** en cercle r2 (cible incluse). **Coup critique** : les effets critiques n'ont **pas** le 5069 différé (pas de répétition). Zones dégressives (§16) : Neutre/Eau 100 % à 1 case, 90 % à 2 ; Terre 100/90/80 %. |
| En temps et en heure (5062) | 1 PA | — | 1×/tour | voir phase 1 |

Estimation (grade quelconque, 800 stats, sans bonus d'heures) : Heuristique ≈ 369-450 Air + 369-450 Feu avant
résistances ; avec +400 Agi/+400 Int récupérés : ×13 au lieu de ×9 (≈ 533-650 par élément).

IA (guides + données) : téléportation près de l'Auroraire tous les 3 tours, puis cibler jusqu'à 3 personnages alignés
(Pacifiste) ; Morfaille sur un personnage entouré d'alliés. Conseils : rester hors des **lignes** du Vortex (8 PO, sans LdV)
**et** hors des lignes/de la proximité de la **future case de l'Auroraire** ; retirer des PM ; idéalement le tuer avant
qu'il ne joue (« One-Turn » après les 2 tours à vide).

## 9. Monstres des vagues — synthèse

| Monstre | PM | Faiblesse (gr. 5) | Résistance max | Portée | Menace principale |
|---|---|---|---|---|---|
| Ikargn (3834) | 5 | Feu −10 % | Air 43 % | CàC / zone r2-r3 autour de lui | Attraction ailée (attire r3, −3 PM, Pesanteur), Cercle de feu ≈579-760, Terre mythe −3 PA |
| Méjaire (3836) | 4 | Terre −10 % | Eau 43 % | ligne 1-3 / 3-7, swap 8-10 | **Pacifiste non désenvoûtable** (Rayonirique), +50 % dommages subis (Plumière) |
| Harpille (3837) | 5 | Neutre −10 % | Feu 43 % | diagonale 1-5, ligne 1-7 | Poison Eau sur **tous** les personnages (≈475/tour, 3 tours, retiré par soin), ×2 prochains dommages, −4 PM |
| Buboxor (3838) | 6 | Air −10 % | Terre 43 % | CàC, ligne 1-3 | Vol de vie, vole 2 PM, **+100 Puissance/+1 PM par coup à distance** subi (×3) |
| Brabuzar (3839) | 5 | Eau −10 % | Neutre 43 % | ligne 1-3 | Poussée 4 + attirance des alliés de la cible (+200 do poussée), téléportation symétrique, −300 rés. poussée |

Caractéristiques des monstres de vague au grade 5 : 850 dans les 4 éléments ⇒ multiplicateur ×9,5 sur les dégâts de base.
Leur **Sagesse (650-850)** donne probablement de l'esquive PA/PM (1 pour 10 de sagesse en Dofus 2.x/3) en plus de
`paDodge/pmDodge` = 0 — à confirmer par le calculateur (**INCERTAIN**) : important pour un Enutrof retrait PM.
Tous les sorts coûtent 4 PA : 3 sorts par tour avec 12 PA (4 avec le bonus +4 PA de l'heure VIII).

### Notes d'IA par monstre (pour le moteur)

**Ikargn (3834)** — Mêlée/zone : attire (r3), retire PA/PM, vole caractéristiques ; faible Feu
- Monstre de corps-à-corps : avance vers les personnages pour placer Terre mythe (CàC, 2x/tour, 1x/cible) et Cercle de feu (zone cercle r2 autour de lui, relance 1 tour).
- Attraction ailée (pas au tour 1, relance 3) : attire de 3 cases tous les ennemis dans un cercle r3, -3 PM esquivables, état Pesanteur 1 tour (empêche téléportations/échanges de place), vole 100 Agilité 2 tours ; puis au tour suivant (délai 1) il déclenche 80 Air de base (≈760 au grade 5) en cercle r3 autour de lui et lance 5013 (-10 PM 1 tour sur le lanceur, a priori l'Ikargn lui-même, une fois par personnage dans la zone - INCERTAIN).
- Ordre probable d'un tour : Attraction ailée (si dispo) -> Cercle de feu -> Terre mythe x2 (12 PA = 3 sorts à 4 PA).
- Danger : regroupe l'équipe au CàC puis frappe en zone ; garder > 3 cases de distance (> 2 hors tour d'Attraction).
- Glyphe de début de tour : +1 PM (1 tour) pour le personnage qui y marche ET pour l'Ikargn.

**Méjaire (3836)** — Distance en ligne : état Pacifiste (non désenvoûtable), +50 % dommages subis, échange de place avec allié à 8-10 PO ; faible Terre
- Monstre à distance en ligne : Plumière (3-7 PO en ligne, LdV, 2x/tour) applique 'dommages subis x150 %' 1 tour ; Rayonirique (1-3 PO en ligne, LdV, 2x/tour) applique Pacifiste 1 tour NON désenvoûtable.
- Envolupté (8-10 PO, sans LdV, case occupée par un allié, relance 3) : échange de place avec un allié puis repousse de 2 cases les ennemis à 1-2 cases de la case d'arrivée -> sert à se repositionner / à 'téléporter' un allié CàC.
- 4 PM seulement : la cible prioritaire du retrait PM et de la mise hors ligne. La plus dangereuse pour un DPS (Pacifiste) selon dofuspourlesnoobs.
- Glyphe : soigne 10 % PV max le personnage qui y marche et la Méjaire.

**Harpille (3837)** — Distance (diagonale/ligne) : x2 prochains dommages subis, -4 PM, poison Eau sur tous les personnages ; faible Neutre
- Petit poison (lanceur, relance 3, relance globale 3 entre Harpilles) : poison Eau (50 de base) à chaque début de tour de TOUS les personnages pendant 3 tours, retiré dès que la cible est soignée.
- Superfidie (1-7 PO en ligne, LdV, 1x/tour) : Feu + -4 PM esquivables 1 tour, retiré si la cible est déplacée.
- Tirs optiques (1-5 PO en diagonale, LdV, 2x/tour, 1x/cible) : Neutre + 'dommages subis x200 %' sur la prochaine attaque reçue (retiré au premier dommage subi).
- Combo typique : Tirs optiques sur une cible puis gros coup d'un autre monstre. Se tenir hors des diagonales <= 5.
- Glyphe : +200 Puissance 1 tour pour le personnage et la Harpille.

**Buboxor (3838)** — Mêlée : vol de vie Air, vole 2 PM, se boost (Puissance/PM) quand frappé à distance ; faible Air
- Corps-à-corps : Feinterception (CàC, 2x/tour, 1x/cible) vol de vie Air + la cible soigne ses attaquants de 50 % des dommages qu'elle subit pendant 1 tour ; Hoxor (1-3 PO en ligne, sans LdV, 2x/tour) Eau + vole 2 PM 1 tour.
- Bouclier absorbant (relance 3, cumulable 3x) : pendant 1 tour, chaque attaque À DISTANCE subie lui donne +100 Puissance et +1 PM pour 2 tours -> le frapper au CàC ou le tuer en un tour.
- 6 PM : le monstre le plus mobile.
- Glyphe : 'dommages subis x50 %' 1 tour pour le personnage et le Buboxor.

**Brabuzar (3839)** — Contrôle : poussée 4 + attirance des alliés de la cible, téléportation symétrique, malus résistance poussée ; faible Eau
- Mise en situation (1-3 PO en ligne, LdV, 2x/tour) : la cible attire de 3 cases ses propres alliés situés en étoile (lignes+diagonales) r3 autour d'elle, le Brabuzar gagne +200 dommages de poussée 2 tours, puis repousse la cible de 4 cases -> grosses collisions.
- Neutralisation (1-3 PO en ligne, LdV, 2x/tour, 1x/cible) : téléporte la cible symétriquement par rapport au Brabuzar puis Neutre (56-75 de base) ; si la cible subit des dommages de poussée pendant le tour, -3 PM esquivables.
- Décollage (relance 3) : -300 résistance poussée à tous les ennemis 1 tour ; pendant 1 tour, chaque dommage de poussée subi par un ennemi soigne le Brabuzar de 15 % de ses PV max.
- Danger principal pour un porteur (Pandawa) : la téléportation symétrique / poussée peut faire lâcher ou isoler. Stabiliser.
- Glyphe : +200 dommages de poussée 1 tour pour le personnage et le Brabuzar.

**Vortex (3835)** — Boss : invulnérable et immobile tant que les vagues ne sont pas corrompues, puis frappeur Air/Feu à 8 PO en ligne sans LdV + téléportation sur l'Auroraire
- Phase 1 (état Marginal, invulnérable, -100 PM, indéplaçable) : chaque tour il lance En temps et en heure (dès son 2e tour) qui frappe toutes les cases en ligne (même x ou même y) avec l'Auroraire ; Contamination zombie (2x/tour) sur un monstre ressuscité (état Zombi) en ligne de vue -> Insoignable 1 tour aux ennemis à <= 2 cases de ce monstre ; Heurage (relance 3, pas avant le tour 4) -> l'Auroraire donne à tous les monstres (sauf Vortex) le bonus de l'heure courante (permanent, cumulable).
- Début de chacun de ses tours : ressuscite les monstres morts depuis son dernier tour (20 à 30 % PV selon DofusDB ; 'moitié' selon JOL/Tofus) à >= 3 cases de lui, avec les bonus des heures auxquelles il a été tué ; -1 PM permanent INCERTAIN (effet 169 du sort 5003 en zone P1 = case du Vortex, alors que le ressuscité est à >= 3 cases).
- Phase 2 (après déverrouillage) : priorité Heurage (si disponible) pour se téléporter au contact de l'Auroraire, puis Heuristique (ligne, 1-8 PO, sans LdV, 3x/tour, 1x/cible : Air+Feu, -2 tours d'envoûtements, Pacifiste 1 tour désenvoûtable) et Morfaille (1-4 PO, LdV, 3x/tour : renvoie la cible à sa position précédente, Neutre+Eau en anneau r2 autour de la cible, répété au tour suivant SAUF sur coup critique : la version critique n'a pas la répétition différée). En temps et en heure continue chaque tour.
- 16 PA / 5 PM en phase 2 (+ bonus d'heures récupérés au déverrouillage : jusqu'à +4 PA, +2 PM, +400 dans chaque caractéristique, etc.).
- Toujours prévoir la position de l'Auroraire au tour du Vortex : c'est là qu'il se téléporte (Heurage, tous les 3 tours) et ce sont ses lignes qui sont frappées.

**Auroraire (3833)** — Horloge (Auroraire) : invocation invulnérable et indéplaçable, 0 PA/0 PM, avance d'une heure à chaque début de tour d'un personnage
- Ne joue pas (0 PA, 0 PM) ; invulnérable et indéplaçable. Avance d'une heure (et se déplace sur la case de l'heure suivante) au début du tour de chaque personnage joueur, et chaque fois qu'un personnage déclenche le glyphe d'un monstre.
- Si une entité occupe la case de l'heure suivante, elle échange de place de force avec l'Auroraire.
- Sert de cible au sort 'En temps et en heure' du Vortex : toutes les cases en ligne avec elle sont frappées.

## 10. Fiches détaillées (toutes les données DofusDB décodées)

Notation des effets : `cible` = masque DofusDB brut (voir glossaire §15), `déclencheur` : I instantané, TB début de tour du
porteur, D dommages subis, DR dommages à distance subis, PD dommages de poussée subis, M déplacé, H soigné, X mort, CI
**INCERTAIN** ; « (n t) » = durée du déclencheur. Les dégâts estimés = base × (1 + stat/100), sans Puissance ni dommages
fixes, avant résistances (Neutre/Terre → Force, Feu → Intelligence, Eau → Chance, Air → Agilité), **tronqués** :
`floor(base × (100 + stat)/100)` comme DoMath (`formulas.md` §3 ; la 1re version arrondissait les .5 au pair, d'où des
écarts de 1 corrigés à la vérification), et **avant dégressivité de zone** (§16).

#### Ikargn (3834) — grades

| Grade | Niv. | PV | PA | PM | For/Int/Cha/Agi | Sag | Rés. Neutre | Terre | Feu | Eau | Air | Esq. PA/PM | XP | Sort de départ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 200 | 6000 | 12 | 5 | 650/650/650/650 | 650 | 3% | 8% | -14% | 24% | 39% | 0/0 | 121000 | 5002 g1 (22882) |
| 2 | 203 | 6200 | 12 | 5 | 700/700/700/700 | 700 | 4% | 9% | -13% | 25% | 40% | 0/0 | 128000 | 5002 g1 (22882) |
| 3 | 206 | 6300 | 12 | 5 | 750/750/750/750 | 750 | 5% | 10% | -12% | 26% | 41% | 0/0 | 136000 | 5002 g1 (22882) |
| 4 | 209 | 6500 | 12 | 5 | 800/800/800/800 | 800 | 6% | 11% | -11% | 27% | 42% | 0/0 | 144000 | 5002 g1 (22882) |
| 5 | 212 | 6600 | 12 | 5 | 850/850/850/850 | 850 | 7% | 12% | -10% | 28% | 43% | 0/0 | 151000 | 5002 g1 (22882) |
| 6 | 212 | 6600 | 12 | 5 | 850/850/850/850 | 850 | 7% | 12% | -10% | 28% | 43% | 0/0 | 60500 | 5002 g1 (22882) |

#### Ikargn (3834) — sorts

| Sort | PA | Portée | LdV | Ligne/Diag. | Relance (initiale/globale) | Max/tour | Max/cible | CC % | Condition |
|---|---|---|---|---|---|---|---|---|---|
| Attraction ailée (5015) | 4 | 0-0 | non | — | 3 (1/0) | ∞ | ∞ | 0 | — |
| Cercle de feu (5016) | 4 | 0-0 | non | — | 1 (0/0) | ∞ | ∞ | 20 | — |
| Terre mythe (5017) | 4 | 1-1 | non | — | 0 (0/0) | 2 | 1 | 20 | — |

- **Attraction ailée** (5015, niveau 22899) :
  - Attire de 3 cases · cible `A` · cercle r3 (hors r<1)
  - -3 PM · durée 1 · cible `A` · cercle r3 (hors r<1)
  - État « Pesanteur » (7) · durée 1 · cible `A` · cercle r3 (hors r<1)
  - Vole 100 Agilité · durée 2 · cible `A` · cercle r3 (hors r<1)
  - lance le sort 5014 « Attraction ailée » (grade 1) · délai 1 · cible `C` · case
- **Cercle de feu** (5016, niveau 22900) :
  - Vole 100 Intelligence · durée 2 · cible `A` · cercle r2 (hors r<1)
  - 61 à 80 dommages Feu · cible `A` · cercle r2 (hors r<1)
  - *Critique* : 71 à 90 dommages Feu
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Feu 579-760; CC Feu 674-855
- **Terre mythe** (5017, niveau 22901) :
  - Vole 100 Force · durée 1 · cible `A` · case
  - -3 PA · durée 1 · cible `A` · case
  - 51 à 70 dommages Terre · cible `A` · case
  - *Critique* : 71 à 90 dommages Terre
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Terre 484-665; CC Terre 674-855

#### Méjaire (3836) — grades

| Grade | Niv. | PV | PA | PM | For/Int/Cha/Agi | Sag | Rés. Neutre | Terre | Feu | Eau | Air | Esq. PA/PM | XP | Sort de départ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 200 | 6000 | 12 | 4 | 650/650/650/650 | 650 | 8% | -14% | 24% | 39% | 3% | 0/0 | 121000 | 5002 g1 (22882) |
| 2 | 203 | 6200 | 12 | 4 | 700/700/700/700 | 700 | 9% | -13% | 25% | 40% | 4% | 0/0 | 128000 | 5002 g1 (22882) |
| 3 | 206 | 6300 | 12 | 4 | 750/750/750/750 | 750 | 10% | -12% | 26% | 41% | 5% | 0/0 | 136000 | 5002 g1 (22882) |
| 4 | 209 | 6500 | 12 | 4 | 800/800/800/800 | 800 | 11% | -11% | 27% | 42% | 6% | 0/0 | 144000 | 5002 g1 (22882) |
| 5 | 212 | 6600 | 12 | 4 | 850/850/850/850 | 850 | 12% | -10% | 28% | 43% | 7% | 0/0 | 151000 | 5002 g1 (22882) |
| 6 | 212 | 6600 | 12 | 4 | 850/850/850/850 | 850 | 12% | -10% | 28% | 43% | 7% | 0/0 | 60500 | 5002 g1 (22882) |

#### Méjaire (3836) — sorts

| Sort | PA | Portée | LdV | Ligne/Diag. | Relance (initiale/globale) | Max/tour | Max/cible | CC % | Condition |
|---|---|---|---|---|---|---|---|---|---|
| Rayonirique (5022) | 4 | 1-3 | oui | ligne | 0 (0/0) | 2 | 1 | 20 | — |
| Plumière (5023) | 4 | 3-7 | oui | ligne | 0 (0/0) | 2 | 1 | 20 | — |
| Envolupté (5024) | 4 | 8-10 | non | — | 3 (0/0) | ∞ | ∞ | 0 | — |

- **Rayonirique** (5022, niveau 22906) :
  - 31 à 40 dommages Eau · cible `A` · case
  - État « Pacifiste » (218) · durée 1 · cible `A` · case · désenv.=2
  - *Critique* : 41 à 50 dommages Eau
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Eau 294-380; CC Eau 389-475
- **Plumière** (5023, niveau 22907) :
  - 31 à 40 dommages Terre · cible `A` · case
  - Dommages subis x150% · déclencheur D (1 t) · cible `A` · case
  - *Critique* : 41 à 50 dommages Terre
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Terre 294-380; CC Terre 389-475
- **Envolupté** (5024, niveau 22908) — case occupée requise :
  - Échange de positions · cible `a` · case
  - Repousse de 2 cases · cible `A` · cercle r2 (hors r<1)

#### Harpille (3837) — grades

| Grade | Niv. | PV | PA | PM | For/Int/Cha/Agi | Sag | Rés. Neutre | Terre | Feu | Eau | Air | Esq. PA/PM | XP | Sort de départ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 200 | 6000 | 12 | 5 | 650/650/650/650 | 650 | -14% | 24% | 39% | 3% | 8% | 0/0 | 121000 | 5002 g1 (22882) |
| 2 | 203 | 6200 | 12 | 5 | 700/700/700/700 | 700 | -13% | 25% | 40% | 4% | 9% | 0/0 | 128000 | 5002 g1 (22882) |
| 3 | 206 | 6300 | 12 | 5 | 750/750/750/750 | 750 | -12% | 26% | 41% | 5% | 10% | 0/0 | 136000 | 5002 g1 (22882) |
| 4 | 209 | 6500 | 12 | 5 | 800/800/800/800 | 800 | -11% | 27% | 42% | 6% | 11% | 0/0 | 144000 | 5002 g1 (22882) |
| 5 | 212 | 6600 | 12 | 5 | 850/850/850/850 | 850 | -10% | 28% | 43% | 7% | 12% | 0/0 | 151000 | 5002 g1 (22882) |
| 6 | 212 | 6600 | 12 | 5 | 850/850/850/850 | 850 | -10% | 28% | 43% | 7% | 12% | 0/0 | 60500 | 5002 g1 (22882) |

#### Harpille (3837) — sorts

| Sort | PA | Portée | LdV | Ligne/Diag. | Relance (initiale/globale) | Max/tour | Max/cible | CC % | Condition |
|---|---|---|---|---|---|---|---|---|---|
| Tirs optiques (5018) | 4 | 1-5 | oui | diagonale | 0 (0/0) | 2 | 1 | 20 | — |
| Superfidie (5019) | 4 | 1-7 | oui | ligne | 0 (0/0) | 1 | ∞ | 20 | — |
| Petit poison (5021) | 4 | 0-0 | non | — | 3 (0/3) | ∞ | ∞ | 0 | — |

- **Tirs optiques** (5018, niveau 22902) :
  - 31 à 40 dommages Neutre · cible `A` · case
  - Dommages subis x200% · déclencheur D (1 t) · cible `A` · case
  - Enlève les effets du sort 5018 « Tirs optiques » · déclencheur D (1 t) · cible `A` · case
  - *Critique* : 41 à 50 dommages Neutre
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Neutre 294-380; CC Neutre 389-475
- **Superfidie** (5019, niveau 22903) :
  - 31 à 40 dommages Feu · cible `A` · case
  - -4 PM · durée 1 · cible `A` · case
  - Enlève les effets du sort 5019 « Superfidie » · déclencheur M (1 t) · cible `A` · case
  - *Critique* : 41 à 50 dommages Feu
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Feu 294-380; CC Feu 389-475
- **Petit poison** (5021, niveau 22905) :
  - 50 dommages Eau · déclencheur TB (3 t) · cible `L` · toute la carte
  - lance le sort 5020 « Petit poison » (grade 1) · cible `L` · toute la carte
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Eau 475-475

#### Buboxor (3838) — grades

| Grade | Niv. | PV | PA | PM | For/Int/Cha/Agi | Sag | Rés. Neutre | Terre | Feu | Eau | Air | Esq. PA/PM | XP | Sort de départ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 200 | 6000 | 12 | 6 | 650/650/650/650 | 650 | 24% | 39% | 3% | 8% | -14% | 0/0 | 121000 | 5002 g1 (22882) |
| 2 | 203 | 6200 | 12 | 6 | 700/700/700/700 | 700 | 25% | 40% | 4% | 9% | -13% | 0/0 | 128000 | 5002 g1 (22882) |
| 3 | 206 | 6300 | 12 | 6 | 750/750/750/750 | 750 | 26% | 41% | 5% | 10% | -12% | 0/0 | 136000 | 5002 g1 (22882) |
| 4 | 209 | 6500 | 12 | 6 | 800/800/800/800 | 800 | 27% | 42% | 6% | 11% | -11% | 0/0 | 144000 | 5002 g1 (22882) |
| 5 | 212 | 6600 | 12 | 6 | 850/850/850/850 | 850 | 28% | 43% | 7% | 12% | -10% | 0/0 | 151000 | 5002 g1 (22882) |
| 6 | 212 | 6600 | 12 | 6 | 850/850/850/850 | 850 | 28% | 43% | 7% | 12% | -10% | 0/0 | 60500 | 5002 g1 (22882) |

#### Buboxor (3838) — sorts

| Sort | PA | Portée | LdV | Ligne/Diag. | Relance (initiale/globale) | Max/tour | Max/cible | CC % | Condition |
|---|---|---|---|---|---|---|---|---|---|
| Bouclier absorbant (5026) | 4 | 0-0 | non | — | 3 (0/0) | ∞ | ∞ | 0 | — |
| Feinterception (5027) | 4 | 1-1 | non | — | 0 (0/0) | 2 | 1 | 20 | — |
| Hoxor (5028) | 4 | 1-3 | non | ligne | 0 (0/0) | 2 | 1 | 20 | — |

- **Bouclier absorbant** (5026, niveau 22910) :
  - 100 Puissance · durée 2 · déclencheur DR (1 t) · cible `C` · case
  - 1 PM · durée 2 · déclencheur DR (1 t) · cible `C` · case
- **Feinterception** (5027, niveau 22911) :
  - 51 à 70 vol Air · cible `A` · case
  - Soin sur l'attaquant : 50% des dommages · déclencheur D (1 t) · cible `A` · case
  - *Critique* : 71 à 90 vol Air
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Air 484-665; CC Air 674-855
- **Hoxor** (5028, niveau 22912) :
  - Vole 2 PM · durée 1 · cible `A` · case
  - 41 à 60 dommages Eau · cible `A` · case
  - *Critique* : 61 à 80 dommages Eau
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Eau 389-570; CC Eau 579-760

#### Brabuzar (3839) — grades

| Grade | Niv. | PV | PA | PM | For/Int/Cha/Agi | Sag | Rés. Neutre | Terre | Feu | Eau | Air | Esq. PA/PM | XP | Sort de départ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 200 | 6000 | 12 | 5 | 650/650/650/650 | 650 | 39% | 3% | 8% | -14% | 24% | 0/0 | 121000 | 5002 g1 (22882) |
| 2 | 203 | 6200 | 12 | 5 | 700/700/700/700 | 700 | 40% | 4% | 9% | -13% | 25% | 0/0 | 128000 | 5002 g1 (22882) |
| 3 | 206 | 6300 | 12 | 5 | 750/750/750/750 | 750 | 41% | 5% | 10% | -12% | 26% | 0/0 | 136000 | 5002 g1 (22882) |
| 4 | 209 | 6500 | 12 | 5 | 800/800/800/800 | 800 | 42% | 6% | 11% | -11% | 27% | 0/0 | 144000 | 5002 g1 (22882) |
| 5 | 212 | 6600 | 12 | 5 | 850/850/850/850 | 850 | 43% | 7% | 12% | -10% | 28% | 0/0 | 151000 | 5002 g1 (22882) |

#### Brabuzar (3839) — sorts

| Sort | PA | Portée | LdV | Ligne/Diag. | Relance (initiale/globale) | Max/tour | Max/cible | CC % | Condition |
|---|---|---|---|---|---|---|---|---|---|
| Mise en situation (5030) | 4 | 1-3 | oui | ligne | 0 (0/0) | 2 | 1 | 0 | — |
| Décollage (5032) | 4 | 0-0 | non | — | 3 (0/1) | ∞ | ∞ | 0 | — |
| Neutralisation (5033) | 4 | 1-3 | oui | ligne | 0 (0/0) | 2 | 1 | 20 | — |

- **Mise en situation** (5030, niveau 22914) :
  - lance le sort 5029 « Mise en situation » (grade 1) · cible `A` · case
  - 200 Dommages Poussée · durée 2 · cible `C` · case
  - Repousse de 4 cases · cible `A` · case
- **Décollage** (5032, niveau 22916) :
  - lance le sort 5031 « Décollage » (grade 1) · déclencheur PD (1 t) · cible `A` · toute la carte · désenv.=2
  - -300 Résistances Poussée · durée 1 · cible `A` · toute la carte
- **Neutralisation** (5033, niveau 22917) :
  - Téléportation symétrique par rapport au lanceur · cible `A` · case
  - 56 à 75 dommages Neutre · cible `A` · case
  - -3 PM · durée 1 · déclencheur PD (1 t) · cible `A` · case
  - *Critique* : 71 à 90 dommages Neutre
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Neutre 532-712; CC Neutre 674-855

#### Vortex (3835) — grades

| Grade | Niv. | PV | PA | PM | For/Int/Cha/Agi | Sag | Rés. Neutre | Terre | Feu | Eau | Air | Esq. PA/PM | XP | Sort de départ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 220 | 15000 | 16 | 5 | 800/800/800/800 | 800 | 6% | 33% | 12% | 21% | 28% | 0/20 | 1800000 | 5006 g1 (22886) |
| 2 | 220 | 17000 | 16 | 5 | 800/800/800/800 | 800 | 6% | 33% | 12% | 21% | 28% | 0/20 | 2300000 | 5006 g1 (22886) |
| 3 | 220 | 18000 | 16 | 5 | 800/800/800/800 | 800 | 6% | 33% | 12% | 21% | 28% | 0/20 | 2800000 | 5006 g1 (22886) |
| 4 | 220 | 20000 | 16 | 5 | 800/800/800/800 | 800 | 6% | 33% | 12% | 21% | 28% | 0/20 | 3300000 | 5006 g1 (22886) |
| 5 | 220 | 22000 | 16 | 5 | 800/800/800/800 | 800 | 6% | 33% | 12% | 21% | 28% | 0/20 | 3800000 | 5006 g1 (22886) |
| 6 | 220 | 22000 | 16 | 5 | 800/800/800/800 | 800 | 6% | 33% | 12% | 21% | 28% | 0/20 | 3800000 | 5006 g4 (83735) |

#### Vortex (3835) — sorts

| Sort | PA | Portée | LdV | Ligne/Diag. | Relance (initiale/globale) | Max/tour | Max/cible | CC % | Condition |
|---|---|---|---|---|---|---|---|---|---|
| Heuristique (5068) | 4 | 1-8 | non | ligne | 0 (0/0) | 3 | 1 | 20 | HS!236 |
| Morfaille (5070) | 4 | 1-4 | oui | — | 0 (0/0) | 3 | 1 | 20 | HS!236 |
| En temps et en heure (5062) | 1 | 1-63 | non | — | 0 (1/0) | 1 | ∞ | 0 | — |
| Heurage (5066) | 4 | 0-0 | non | — | 3 (3/0) | ∞ | ∞ | 0 | — |
| Contamination zombie (5064) | 4 | 1-63 | oui | — | 0 (0/0) | 2 | 1 | 0 | HS=236 |

- **Heuristique** (5068, niveau 22952) :
  - Durée des effets : -2 · cible `A` · case
  - État « Pacifiste » (218) · durée 1 · cible `A` · case
  - 41 à 50 dommages Air · cible `A` · case
  - 41 à 50 dommages Feu · cible `A` · case
  - *Critique* : 46 à 55 dommages Air ; 46 à 55 dommages Feu
  - *Estimation grade 5 (floor(base×(100+stat)/100), avant résistances/bonus/dégressivité)* : Air 369-450; Feu 369-450; CC Air 414-495; CC Feu 414-495
- **Morfaille** (5070, niveau 22954) :
  - Téléporte à la position précédente · cible `A` · case
  - lance le sort 5069 « Morfaille » (grade 1) · cible `A` · case
  - lance le sort 5069 « Morfaille » (grade 1) · délai 1 · cible `A` · case
- **En temps et en heure** (5062, niveau 22946) :
  - lance le sort 5061 « En temps et en heure » (grade 1) · cible `a,A,F3833` · case
  - 10 PA · cible `a,A,T` · case
- **Heurage** (5066, niveau 22950) :
  - lance le sort 5065 « Heurage » (grade 1) · cible `g,F3833,*E236` · toute la carte
  - lance le sort 5067 « Heurage » (grade 1) · cible `g,F3833,*e236` · toute la carte
- **Contamination zombie** (5064, niveau 22948) :
  - lance le sort 5063 « Contamination zombie » (grade 1) · cible `a,E74` · case

#### Auroraire (3833) — grades

| Grade | Niv. | PV | PA | PM | For/Int/Cha/Agi | Sag | Rés. Neutre | Terre | Feu | Eau | Air | Esq. PA/PM | XP | Sort de départ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 200 | 5500 | 0 | 0 | 0/0/0/0 | 0 | 0% | 0% | 0% | 0% | 0% | 0/0 | 0 | 4999 g1 (22879) |
| 2 | 200 | 5500 | 0 | 0 | 0/0/0/0 | 0 | 0% | 0% | 0% | 0% | 0% | 0/0 | 0 | 4999 g1 (22879) |
| 3 | 200 | 5500 | 0 | 0 | 0/0/0/0 | 0 | 0% | 0% | 0% | 0% | 0% | 0/0 | 0 | 4999 g1 (22879) |
| 4 | 200 | 5500 | 0 | 0 | 0/0/0/0 | 0 | 0% | 0% | 0% | 0% | 0% | 0/0 | 0 | 4999 g1 (22879) |
| 5 | 200 | 5500 | 0 | 0 | 0/0/0/0 | 0 | 0% | 0% | 0% | 0% | 0% | 0/0 | 0 | 4999 g1 (22879) |
| 6 | 200 | 5500 | 0 | 0 | 0/0/0/0 | 0 | 0% | 0% | 0% | 0% | 0% | 0/0 | 0 | 4999 g2 (83737) |

### 10.1 Sorts internes (scripts du donjon)

| Id | Nom | Rôle |
|---|---|---|
| 4996 | Décalage horaire | Décalage horaire : avance l'Auroraire d'une heure (retire 'Même heure' à tous, la pose sur les monstres tués à l'heure qui arrive, déplace l'Auroraire sur la case de l'heure suivante avec échange forcé si occupée, change son état d'heure). |
| 4997 | Heure du temps | Heure du temps (technique) : pose l'état Feinte (237) sur le lanceur. |
| 4998 | Heure du temps | Heure du temps : réaction de l'Auroraire si elle subit des dommages (probablement jamais déclenché car invulnérable - INCERTAIN) : téléportation symétrique de l'attaquant (masque o) ; si une entité est téléfraguée (masque T, sens effects.md - INCERTAIN) : état Feinte sur l'Auroraire (4997) et renvoi de 100 % des dommages initiaux à un allié téléfragué, puis 5005 avance d'une heure seulement si Feinte est posée (toujours en Songes, 6490). |
| 4999 | Heure du temps | Heure du temps : sort de départ de l'Auroraire (invulnérable, indéplaçable, état Douzième heure ; à chaque début de tour d'un personnage -> Décalage horaire). |
| 5000 | Glyphe téléporteur | Glyphe téléporteur (technique) : l'Auroraire marque le monstre mourant (état Mort latente) avec l'état de l'heure courante. |
| 5001 | Glyphe téléporteur | Glyphe téléporteur (technique, à la mort) : Mort latente 1 tour sur le mourant + l'Auroraire lance 5000. |
| 5002 | Glyphe téléporteur | Glyphe téléporteur : sort de départ de chaque monstre de vague (et relancé à chaque résurrection) : marquage à la mort, glyphe à chaque début de tour, corruption si 'Même heure', bonus des heures déjà enregistrées. |
| 5003 | Vortexiphan | Vortexiphan : résurrection (au début de chaque tour du Vortex) des monstres alliés morts (masque h,m,d ; 20-30 % PV) à >= 3 cases, relance 5002 sur eux ; -1 PM permanent sur 'U' mais en zone P1 (case du Vortex) : application réelle INCERTAINE. |
| 5005 | Heure du temps | Heure du temps : si l'Auroraire a l'état Feinte -> Décalage horaire. |
| 5006 | Vortexiphan | Vortexiphan : sort de départ du Vortex (grade 1 = donjon, grade 4 = Songes). Invoque l'Auroraire (cellule 255), Invulnérable + Indéplaçable + -100 PM, Marginal 25 tours, déclencheurs de début de tour (résurrection, vérification de corruption, 'Action !'). |
| 5007 | Vortexiphan | Vortexiphan (technique) : Marginal 1 tour sur le Vortex. |
| 5008 | Vortexiphan | Vortexiphan : au début du tour du Vortex (à partir du ~26e tour, délai 25, décompte exact ±1 INCERTAIN), s'il existe un monstre allié non invoqué (h,m,d : l'Auroraire est exclue) NON corrompu (sans état 6611), le Vortex reste Marginal 1 tour. |
| 5009 | Vortexiphan | Vortexiphan : au déverrouillage, chaque monstre transmet au Vortex les bonus de ses heures (non cumulable : maxStack 1 -> une seule fois par heure). |
| 5011 | Glyphe téléporteur | Glyphe téléporteur : effet du glyphe quand un personnage le déclenche : échange de place avec le monstre poseur + bonus selon le monstre + le monstre reçoit le même bonus + l'Auroraire avance d'une heure. |
| 5012 | Glyphe téléporteur | Glyphe téléporteur : début de tour d'un monstre de vague : pose un glyphe (durée 1) sous lui s'il n'est pas invulnérable, et repousse de 2 cases les alliés invulnérables (hors Vortex) en croix r2. |
| 5013 | Attraction ailée | Attraction ailée (technique) : -10 PM 1 tour sur le lanceur. |
| 5014 | Attraction ailée | Attraction ailée (différée d'un tour) : 80 Air de base en cercle r3 autour de l'Ikargn + lance 5013. |
| 5020 | Petit poison | Petit poison (technique) : si la cible est soignée, retire le poison 5021. |
| 5025 | Glyphe téléporteur | Glyphe téléporteur (technique) : bonus de glyphe sur le monstre + Décalage horaire. |
| 5029 | Mise en situation | Mise en situation (technique, lancé par la cible) : attire de 3 cases les alliés de la cible en étoile r3. |
| 5031 | Décollage | Décollage (technique) : soin 15 % PV max du Brabuzar. |
| 5060 | Action ! | Action ! : déverrouillage du Vortex (si plus Marginal) : téléporte Vortex + personnages à leur position de début de combat, retire Vortexiphan (invulnérabilité, -100 PM, indéplaçable), transmet les bonus d'heures, tue tous les monstres (sauf Auroraire), Vortex invulnérable + tour passé 1 tour, (x75 % dommages subis aux personnages si le Vortex a les 12 heures - INCERTAIN), retire les états d'heure du Vortex. |
| 5061 | En temps et en heure | En temps et en heure (exécuté par l'Auroraire) : +20 % érosion 2 tours, 500 Terre de base et Terre = 50 % des PV érodés de la cible, sur tous les ennemis en croix (lignes) r63 autour de l'Auroraire (hors sa case). |
| 5063 | Contamination zombie | Contamination zombie (technique) : Insoignable 1 tour sur les ennemis à 1-2 cases du monstre zombie ciblé. |
| 5065 | Heurage | Heurage phase 1 (exécuté par l'Auroraire) : donne à tous les alliés (sauf Vortex) le bonus de l'heure courante (permanent, non désenvoûtable). |
| 5067 | Heurage | Heurage phase 2 : téléporte le Vortex sur/à côté de la case de l'Auroraire. |
| 5069 | Morfaille | Morfaille (technique) : Neutre + Eau en anneau r2 (hors centre) autour de la cible, et Terre = 20 % des PV érodés du lanceur en cercle r2 (centre inclus). |

### 10.2 États référencés

| Id | Nom | Propriétés |
|---|---|---|
| 7 | Pesanteur | cantSwitchPosition, displayTurnRemaining |
| 56 | Invulnérable | invulnerable, displayTurnRemaining |
| 74 | Zombi | — |
| 76 | Insoignable | incurable, displayTurnRemaining |
| 96 | Intaclable | cantBeTackled |
| 97 | Indéplaçable | cantBeMoved, displayTurnRemaining |
| 157 | Inébranlable | cantBePushed, displayTurnRemaining |
| 218 | Pacifiste | cantDealDamage, displayTurnRemaining |
| 221 | Première heure | — |
| 222 | Deuxième heure | — |
| 223 | Troisième heure | — |
| 224 | Quatrième heure | — |
| 225 | Cinquième heure | — |
| 226 | Sixième heure | — |
| 227 | Septième heure | — |
| 228 | Huitième heure | — |
| 229 | Neuvième heure | — |
| 230 | Dixième heure | — |
| 231 | Onzième heure | — |
| 232 | Douzième heure | — |
| 233 | Mort latente | isSilent |
| 234 | Même heure | — |
| 236 | Marginal | isSilent |
| 237 | Feinte | isSilent |
| 945 | Vortex : sort initial alliés hors famille | — |
| 6490 | Xélorium (Songes) | isSilent |
| 6491 | Xélorium (Songes) - 1 | isSilent |
| 6492 | Xélorium (Songes) - 2 | isSilent |
| 6493 | Xélorium (Songes) - 3 | isSilent |
| 6494 | Xélorium (Songes) - 4 | isSilent |
| 6495 | Xélorium (Songes) - 5 | isSilent |
| 6496 | Xélorium (Songes) - 6 | isSilent |
| 6497 | Xélorium (Songes) - 7 | isSilent |
| 6498 | Xélorium (Songes) - 8 | isSilent |
| 6499 | Xélorium (Songes) - 9 | isSilent |
| 6500 | Xélorium (Songes) - 10 | isSilent |
| 6501 | Xélorium (Songes) - 11 | isSilent |
| 6502 | Xélorium (Songes) - 12 | isSilent |
| 6611 | Vortex (monstre tué à la même heure) | isSilent |

## 11. Mécaniques propres au Xélorium

1. **Le temps** : toute la dimension tourne autour des heures. Dans ce donjon, c'est l'Auroraire (horloge) + les 12 états
   d'heure (221-232) + « Même heure » (234) + « Mort latente » (233) + « Marginal » (236). Rien d'autre (pas de compte à
   rebours global) : les « tours » comptent via les délais d'effets (délai 25 du Vortex) et le timer de vagues.
2. **Variante *Songes infinis*** : le grade 6 du Vortex (sort de départ 83735 = Vortexiphan grade 4) et de l'Auroraire
   (sort 4999 grade 2) utilisent les états « Xélorium (Songes) » 6490-6502 : l'Auroraire ne se déplace plus physiquement
   (les effets 1023/4 exigent l'absence de 6490), Marginal ne dure qu'1 tour et les déclencheurs n'ont plus de délai. Le
   grade 6 des monstres de vague (même niveau que le grade 5, XP divisée par ~2,5) garde le même sort de départ (5002 g1) ;
   l'attribuer aux Songes est une **hypothèse** (le Brabuzar, exclusif au donjon, n'a pas de grade 6). **Hors périmètre du
   donjon** — ne pas utiliser le grade 6 pour la démo.
3. **Modificateurs de dimension** (DPLN ; 10 par dimension, ils changent quand le Vortex est vaincu ; existence en Dofus 3
   **INCERTAIN**) — sorts DofusDB retrouvés par nom :

| Modificateur | Effet (guide + données) | Sorts |
|---|---|---|
| En quête d'action | À chaque retrait de PA subi, l'ennemi subit 5 jets de 5 % de ses PV actuels (un par élément, 1067-1071 ; ~25 % avant résistances) | 5170 |
| Puissance cyclique | Ennemis +50 % vitalité ; alliés +25 % dommages finaux par tour à partir du 2e, remise à zéro tous les 5 tours | 4655, 4667 |
| Saute-Bouftou | Un allié qui subit des dommages d'un autre allié : ce dernier est téléporté symétriquement par rapport à sa cible | 5171 |
| Disparitions détonantes | À sa mort, un ennemi inflige à ses alliés à 1-2 cases 5 jets de 20 % de ses PV manquants (un par élément, 275-279 ; à la mort ≈ PV max, soit jusqu'à ~100 % avant résistances) | 4613, 4615 |
| Retour arrière | Un ennemi touché en mêlée retourne à sa position précédente | 5172 |
| Liaison longue portée | 20 % des dommages finaux subis par un ennemi sont infligés à ses alliés à plus de 10 PO | 5165 |
| Actions entravées | Les dommages d'arme retirent 1 PA (2 tours) | 5173 |
| Poussées revigorantes | Un ennemi qui subit des dommages de poussée soigne ses alliés à 1-2 cases de 10 % PV max | 5164 |
| Solitude momifiante | Début de tour sans allié à ≤ 5 cases : momie, dommages subis ×66 % 1 tour | 5174 |
| Invocations incapacitantes | Dommages d'invocations non statiques : −1 PA (données) / −1 tour d'envoûtement (guide) — **INCERTAIN** | 5166 |

Pour la simulation de base, **désactiver** les modificateurs (option) ; « Liaison longue portée » est la seule citée comme
stratégie (succès Focus avec mur de bombes).

## 12. Succès (DofusDB)

| Id | Nom | Condition | Challenge | Points | Récompense |
|---|---|---|---|---|---|
| 1156 | Œil de Vortex | Vaincre Vortex dans son donjon (niv. > 189) | — | 10 | 2× Aile de Vortex (15715), XP ×4, kamas ×1 |
| 1157 | Vortex (Focus) | « Lorsqu'un ennemi est attaqué par un allié, il doit être achevé avant qu'un autre ennemi ne soit attaqué. » | 332 Focus (`SF=1`, ≥ 2 joueurs) | 10 | idem |
| 1158 | Vortex (Hardi) | « Les combattants alliés doivent finir leur tour sur une cellule adjacente à celle d'un ennemi. » | 333 Hardi (`TD<2`) | 10 | idem |
| 1159 | Vortex (Trio) | « Vaincre tous les monstres avec 3 personnages maximum et en moins de 80 tours. » | 334 Trio (`GN<4`, `ST<80`) | 20 | 2× Aile, XP ×8 |
| 6243 | Vortex (Spécial) | « Tous les ennemis doivent être achevés à la même heure. » | 1078 Heure de la mort (`Ma=1`) | 10 | idem |
| 1160 | Vortexicomane (méta) | Obtenir 1157 (Focus), 1158 (Hardi) et 1159 (Trio) (objectifs 3582-3584 `OA=…`) | — | 20 | 2× Aile, XP ×8, kamas ×1 |

Il n'existe **pas** de succès « Duo », « Premier », « Zombie », « Statue », « Anachorète » pour ce donjon (liste DofusDB du
donjon 87 : 1156, 1157, 1158, 1159, 6243). Le méta-succès **1160 Vortexicomane** (catégorie 59) n'est pas dans cette liste
mais concerne le donjon (ajouté à la vérification : <https://api.dofusdb.fr/achievements/1160>). Les succès 2396, 2772,
2874 « Vortex » (catégories 104-106 « Donjons (Première/Seconde/Dernière vague) », 0 point) sont propres aux serveurs
temporaires (vaincre Vortex 1, 2 ou 3 fois après l'ouverture du serveur). Les anciens succès « Score 150 / Score 200 »
(idoles) cités par JOL et DPLN n'existent plus.

Conseils des guides :
- **Focus** : long ; retrait PM ; taper un invulnérable ne fait pas échouer ; variante mur de bombes + modificateur
  « Liaison longue portée » en y plaçant des monstres corrompus.
- **Hardi** : coller un **monstre corrompu** (invulnérable, passe ses tours) contre l'équipe : Pandawa (porter/jeter la
  Harpille, la moins dangereuse, puis un corrompu) + Sram (Brume pour détacler) ; ou Sadida (Force, arbres collés au Vortex,
  Poison de proximité + Force de la nature tue toutes les résurrections chaque tour) + Pandawa tank + idole Leukide.
  Prévoir de l'OT du Vortex au tour où il redevient vulnérable.
- **Trio** : Crâ + Enutrof retrait PM + un frappeur, ou Pandawa + Roublard + 1 ; à 3 l'Auroraire est sur III/VI/IX/XII aux
  tours du Vortex et un personnage retrouve son heure 4 tours plus tard.
- **Heure de la mort** : à 4 (ou 6), choisir une heure peu pénalisante (III, VI, VIII, IX, XII) ; le personnage qui joue à
  cette heure doit achever **tous** les ennemis (y compris le Vortex) ; un chiffre romain au-dessus de l'Auroraire rappelle
  l'heure du premier kill.

## 13. Stratégie et implications pour le simulateur

### 13.1 Ce que disent les guides
1. **Taper fort à distance** et corrompre vague par vague sans prendre de retard ; profiter du tour supplémentaire de la
   vague 1 pour corrompre ses 3 monstres avant la vague 2.
2. **Retrait PM / contrôle** : Enutrof (retrait PM), Crâ, Pandawa (placement/stabilisation), Roublard (mur de bombes ; ne
   pas placer de bombes dans les lignes de l'Auroraire au tour du Vortex), Éliotrope (portails, peut faire le donjon à 6).
3. **Méjaires à distance** (Pacifiste non désenvoûtable, surtout la vague 3 qui en a deux), **poison des Harpilles** retiré
   par n'importe quel soin (sort Cawotte : rester sur ses glyphes).
4. **Ne pas finir son tour en ligne avec l'Auroraire** au tour du Vortex (voir §2) ; éviter de tuer à V et XI.
5. **Même tueur** : à 4 joueurs, noter qui a tué quoi à quelle heure ; le même personnage corrompt 3 tours après. Un
   Enutrof « full retrait » ne doit pas être celui qui fait les kills.
6. **Retirer le Dofus Ébène** (son poison persiste sur les ressuscités et peut les tuer à la mauvaise heure / casser Focus).
7. Variante défensive : retuer immédiatement les ressuscités pour ne pas être submergé ; ils finissent par porter l'étoile,
   au prix de bonus d'heures cumulés.
8. **Fin** : 2 tours « à vide » pour se booster / se placer, puis le Vortex joue : rester hors de ses lignes, loin de la
   future case de l'Auroraire (Heurage tous les 3 tours), lui retirer des PM ; idéalement l'OT.

### 13.2 Recommandations pour l'IA de groupe (DofusSimu)
- **Planificateur d'heures** : l'état du combat doit exposer pour chaque monstre l'ensemble de ses heures de mort ; l'IA
  calcule à quel tour (et pour quel personnage) l'Auroraire repassera par ces heures, et peut **insérer des déclenchements
  de glyphe** (+1 heure) pour réaligner. Objectif « kill planifié » : ne tuer un monstre « neuf » qu'à une heure où un
  personnage capable de le retuer jouera de nouveau (à 4 joueurs : tout personnage, 3 tours plus tard).
- **Contrôle** : un rôle « retrait PM » (Enutrof / Sram / Crâ) réduit la pression des monstres de CàC (Ikargn, Buboxor,
  Brabuzar) ; garder les Méjaires et Harpilles hors de leurs lignes/diagonales.
- **Placement** : fonction de danger par case = Σ menaces (lignes de l'Auroraire au tour du Vortex + portées monstres) ;
  la case 484 est à éviter (échange forcé à VII).
- **Gestion du temps** : le Vortex ne peut pas être déverrouillé avant son ~26e tour (±1) : inutile de se presser au-delà ;
  minimiser les dégâts subis (combat long, ~30-40 tours).
- **Phase 2** : maximiser les dégâts sur 2 tours de préparation (buffs) + 1 tour de burst ; éléments à privilégier :
  Neutre (6 %) / Feu (12 %) / Eau (21 %) ; éviter Terre (33 %).

### 13.3 Compositions citées
- Roublard + Pandawa + 2 frappeurs (méthode JOL n°1, mur de bombes + placement).
- Crâ + Enutrof (retrait PM) + rox (+1) — DPLN (Trio, Score).
- Éliotrope + retrait PM (JOL n°2, jusqu'à 6 personnages).
- Sadida Force + Pandawa tank (+ idole Leukide) — Hardi / Trio.
- Pandawa + Sram + roxeurs — Hardi.

## 14. Désaccords entre sources et points INCERTAINS

| Sujet | DofusDB (données) | Guides | Retenu |
|---|---|---|---|
| PV des ressuscités | 20 à 30 % (effet 780) | JOL/Tofus : moitié | DofusDB |
| Arrivée vague 2 | — (serveur) | DPLN 2024 : tour 7 ; JOL : tour 6 | tour 7 (paramétrable) |
| Morfaille, partie Terre | 20 % PV érodés du **lanceur** (1122, exécuté via 1160 `CasterExecuteSpell` → lanceur = Vortex) | DPLN : de la cible ; JOL : du lanceur | DofusDB (+ JOL) |
| En temps et en heure | 500 Terre base exécutés par l'Auroraire + 50 % PV érodés, +20 % érosion 2 t | DPLN « 800 », Gamosaurus « base 500 » mais « 50 % d'érosion », Tofus « 500 à 1500 » et « 20 % d'érosion pour 1 tour » | DofusDB ; lanceur effectif = Auroraire (INCERTAIN) |
| Heuristique | 1-8 en ligne sans LdV | JOL : 1-2 PO (ancien) | DofusDB |
| Petit poison | relance 3, relance globale 3, pas de délai initial | DPLN : pas avant le tour 4 | DofusDB |
| Décollage | relance 3, globale 1, pas de délai initial | DPLN : pas au tour 1 | DofusDB |
| Heurage en phase 1 | buff d'heure à tous les monstres | DPLN : seulement la téléportation (phase 2) ; Tofus décrit les boosts | DofusDB |
| Glyphe Méjaire | soin 10 % PV max | DPLN ≈400, Gamosaurus « 10 % + 400 vita » | DofusDB |
| Vortex après Action ! | invulnérable + tour annulé 1 tour | DPLN 2024 : joue au tour suivant ; ancienne version : passe encore un tour | DPLN 2024 |
| Heure V | monstres ×70 %, Vortex ×75 % | ×70 % | DofusDB |
| Déclenchement du glyphe | effet 1165 « immédiat » | DPLN/JOL/Gamo : en marchant dedans ; Tofus : fin de tour | à l'entrée |

Autres INCERTAINS : grade réel des monstres/du boss ; composition des vagues à < 4 joueurs ; masques `T` (téléfrag) et
`U` (zone ignorée ?) dans ce donjon (les autres lettres sont alignées sur `effects.md` §5) ; ré-application des bonus
d'heures à chaque résurrection ; **−1 PM des ressuscités** (zone P1, §6) ; décompte exact du délai 25 et ordre
« déclencheurs `TB` / décrément des durées » (tour exact d'*Action !*, sorts lançables pendant le tour « à vide », §8.2) ;
esquive PA/PM issue de la sagesse des monstres ; effet « ×75 % si 12 heures » d'*Action !* ; position initiale exacte du
Vortex parmi les cases bleues ; ordre d'initiative (Vortex après les 4 joueurs : seulement si l'équipe des joueurs
commence, §5).

## 15. Glossaire DofusDB (pour l'interpréteur d'effets)

- **Masques de cible** (séparés par des virgules ; lettres de cible = OU, conditions = ET ; **aligné à la vérification
  sur `effects.md` §5**, qui s'appuie sur le code OTOMAI `SpellManager.IsSelectedByMask` et D2 `verifySpellEffectMask`) :
  `a` alliés (lanceur inclus s'il est dans la zone), `A` ennemis, `c` lanceur dans la zone, `C` lanceur toujours, `g`
  alliés hors lanceur (*Action !* tue `g` sans tuer le Vortex), `h`/`H` joueurs non invoqués alliés/ennemis, `m`/`M`
  monstres non invoqués non statiques (donc `h,m,d` des sorts 5003/5008 = monstres de vague, **sans l'Auroraire** —
  sinon le Vortex ne pourrait jamais perdre Marginal), `d`/`D` compagnons, `l`/`L` joueurs ou compagnons alliés/**ennemis**
  (ici les personnages joueurs, pas leurs invocations : glyphes, poison, téléportation de départ), `T` entité
  **téléfraguée** ce tour (sens Xélor ; la 1re version disait « entité déclencheuse » — **INCERTAIN** ici), `U` entité
  qui vient d'apparaître (invoquée/ressuscitée par l'effet précédent), `o`/`O` entité **déclencheuse** (attaquant ; `o` :
  dans la zone) ; `E<n>`/`e<n>` cible avec/sans l'état n ; `F<n>`/`f<n>` cible est/n'est pas le monstre n (les `F` forment
  un OU) ; préfixe `*` = la condition porte sur le **lanceur**.
- **Déclencheurs** (`effects.md` §6) : `I` instantané, `TB` début du tour du porteur, `D` dommages subis, `DR` dommages à
  distance subis, `PD` dommages de poussée subis, `M` déplacé, `H` soigné, `X` mort du porteur, `CI` **le porteur
  invoque** (Vortexiphan grade 3 sur les alliés hors famille). `effectTriggerDuration` (JSON : `triggerDurationTurns`) =
  durée de vie du buff déclencheur (63 = tout le combat).
- **Zones** : `P` case, `C` cercle (param1 rayon, param2 rayon minimal), `X` croix (lignes), `*` étoile (lignes +
  diagonales), `a` toute la carte, `;` liste de cellules (`cellIds`).
- **Désenvoûtable** : 1 oui, 2 non, 3 non et persistant (technique).
- **Exécution de sorts** : 792 `TargetExecuteSpell` (la cible lance le sort), 793 idem avec animation, 1160
  `CasterExecuteSpell` (le lanceur lance le sort sur la cible) ; `diceNum` = id du sort, `diceSide` = grade.
- `initialCooldown` = tours avant le premier lancer ; `minCastInterval` = relance ; `globalCooldown` = relance partagée
  entre monstres ; `maxCastPerTurn` 0 = illimité ; `statesCriterion` `HS=n` / `HS!n` = lanceur avec / sans l'état n.

## 16. Effets à supporter par le moteur pour ce donjon

`4` téléportation sur case, `5` poussée, `6` attirance, `8` échange de positions, `77` vol de PM, `93` vol de vie Air,
`96-100` dommages Eau/Terre/Air/Feu/Neutre, `111` +PA, `115` +% CC, `118/119/123/126` +Force/Agi/Cha/Int, `128` +PM,
`138` +Puissance, `140` tour annulé, `141` tue la cible, `169` −PM, `181` invocation, `268/269/271` vol d'Agi/Int/For,
`406` retire les effets d'un sort, `414` +do poussée, `417` −rés. poussée, `418` +do critiques, `420` +rés. critiques,
`776` érosion, `780` résurrection du dernier allié mort, `784` téléportation à la position de départ, `786` soin des
attaquants, `792/793/1160` exécution de sort, `950/951` états, `1023` échange forcé, `1075` réduction de durée des
effets, `1078` +% vitalité, `1079/1080` −PA/−PM esquivables, `1096/1122` dommages Terre en % des PV érodés (cible /
lanceur), `1100` retour à la position précédente, `1105` téléportation symétrique, `1109` soin % PV max, `1123` renvoi de
dommages, `1163` multiplicateur de dommages subis, `1165` glyphe à effet immédiat. Déclencheurs : `I, TB, D, DR, PD, M, H,
X, CI`. (Liste vérifiée : exactement les 53 `effectId` et 9 déclencheurs présents dans les 52 niveaux de sorts du cache.)

**Dégressivité de zone** (ajout de la vérification ; règle `effects.md` §4.3 : malus = min(max(dist − rayonMin, 0), 4) ×
10 %, aucune si forme P/a/A/I/; ou taille > 50) : *Cercle de feu* (C2,1) et *Morfaille* Neutre/Eau (C2,1) → 100 % à
1 case, 90 % à 2 ; *Attraction ailée* différée (5014, C3,1) → 100/90/80 % ; *Morfaille* Terre (C2,0) → 100/90/80 % ;
*En temps et en heure* (X63) **non dégressif**. Le JSON garde désormais `damageDecreaseStepPercent`,
`maxDamageDecreaseApplyCount`, `onlyAffectIfInSightLine`, `isStopAtTarget`, `includeCarried` et un booléen calculé
`aoeMalusApplies` dans chaque `zone`.

## 17. Sources

Données de jeu (consultées le 2026-10-04, cache dans `.cache/vortex/`) :
- <https://api.dofusdb.fr/dungeons/87>
- <https://api.dofusdb.fr/monsters/3834> … `/3839`, `/3833` (Auroraire), `/3851` (Sicogne, référencée par le glyphe)
- <https://api.dofusdb.fr/spells/5068> etc. et `spell-levels/<id>` (sorts 4996-5070, niveaux 22876-22954, 39077, 39078,
  65913, 83735, 83737)
- <https://api.dofusdb.fr/spell-states/221> etc. (états 7, 56, 74, 76, 96, 97, 157, 218, 221-234, 236, 237, 945,
  6490-6502, 6611)
- <https://api.dofusdb.fr/effects> (catalogue), noms d'actions : `.cache/effects/actionid_names.json`
- <https://api.dofusdb.fr/achievements/1156> (+1157, 1158, 1159, 6243, **1160** Vortexicomane) et `achievement-objectives`,
  `achievement-rewards` (2065, 2770, 4377, 2068, 2778, 4385, 10946, 10947, 11084, 2069, 2798, 4405)
- <https://api.dofusdb.fr/map-positions/143393281>, <https://api.dofusdb.fr/maps/143393281.json>, `data/maps/143393281.json`
- <https://api.dofusdb.fr/items/15808>, <https://api.dofusdb.fr/recipes/15808>

Guides :
- dofuspourlesnoobs — <https://www.dofuspourlesnoobs.com/oeil-de-vortex.html> (Arkaw, mis à jour le 24/08/2024) — source
  principale pour les règles serveur (vagues, horloge, phases, succès).
- JeuxOnLine — <https://dofus.jeuxonline.info/article/13603/il-vortex> (Kiwigae, 01/02/2016, m.à.j. 04/07/2019) — tableau
  des vagues.
- Gamosaurus — <https://www.gamosaurus.com/?p=61151> (Timtoobias, 2021) — glyphes, poussée des invulnérables, phase 2.
- Tofus — <https://www.tofus.fr/donjons/vortex.php> — boosts de Vortex aux monstres, corrompus inébranlables.
- guidedofus — <https://www.guidedofus.com/v2/oeil-de-vortex> (ancienne copie du guide DPLN).
- next-stage — <https://www.next-stage.fr/2025/04/guide-dofus-strategies-vaincre-loeil-vortex-ses-succes.html> (paraphrase
  de DPLN).
- Millenium — <https://www.millenium.org/guide/273667.html> (simplification 2.42 des donjons end-game).
- DoMath v1.3.3 — <https://domath.fr/static/js/main.e2dd4684.js> (troncature du jet de dégâts, vérification).

## 18. Vérification (revue adverse du 2026-10-04)

**Contrôlé (sources primaires)** :
- **Cache = API live** : `dungeons/87`, les 8 monstres (3833-3839, 3851), les 47 sorts et 52 niveaux de sorts, 12 états
  tirés au sort : **0 écart** (hors `createdAt`/`updatedAt`). Toutes les références « lance un sort / glyphe / retire les
  effets » (sort + grade) se résolvent dans le cache : **extraction complète**.
- **JSON** : valide ; régénéré à l'identique par `.cache/vortex/scripts/build_json.py` (avant corrections) ; **1 898 champs**
  (grades des 7 monstres, 14 sorts tirés au sort : PA, portées, relances, effets, masques, déclencheurs, durées) comparés
  directement à l'API live : **0 écart**.
- **Carte** (`maps/143393281` brut) : 222 cases marchables, 76 bloquant la LdV, 12 rouges, 10 bleues ; coordonnées
  `MapPoint` des 12 heures, nombres de cases en ligne et départs en ligne recalculés : **identiques** ; rendu ASCII
  régénéré : identique (au décalage d'un espace près). Correspondance heure → case relue dans les `cellIds` des effets
  1023/4 du sort 4996 ; case d'invocation 255 relue dans l'effet 181 de 5006.
- **Mécaniques** relues effet par effet dans les niveaux bruts (4996, 4998-5003, 5006-5009, 5011, 5012, 5025, 5060-5070 et
  les 15 sorts de monstres) ; **§16** : liste des `effectId` et déclencheurs exacte (53 / 9).
- **Guides** : tableau des vagues JOL reparsé depuis le HTML (identique), tour 7 (DPLN) / tour 6 (JOL), IV/VIII/XII
  (DPLN), bonus d'heures (DPLN), glyphes (Gamosaurus), « moitié des PV » (JOL/Tofus).
- **Succès** : critères, points et récompenses relus (`achievement-rewards`) ; recette de la clé 15808 (`recipes/15808`).
- **Formule d'estimation** : vérifiée dans le code DoMath (`Math.trunc`) et vecteurs recalculés (61→579, 41→389 à 850 ;
  41/50→369/450, CC 46/55→414/495 à 800 ; 41/50→533/650 à 1 200 ; poison 50→475).

**Corrigé** :
1. **Estimations de dégâts** : `round()` (arrondi au pair) remplacé par `floor` comme DoMath/Dofus → Cercle de feu 579-760
   (et non 580), Hoxor 389-570 / CC 579-760, CC de Rayonirique/Plumière/Tirs optiques/Superfidie 389 (et non 390).
2. **Champs de zone perdus** dans le JSON (`damageDecreaseStepPercent`, `maxDamageDecreaseApplyCount`,
   `onlyAffectIfInSightLine`, `isStopAtTarget`, `includeCarried`) : rétablis + `aoeMalusApplies` ; règle de dégressivité
   ajoutée (§16, §8.3).
3. **−1 PM des ressuscités** présenté comme certain : l'effet 169 de 5003 est en zone P1 (case du Vortex) alors que le
   ressuscité est à ≥ 3 cases → **INCERTAIN** (§0, §3, §6, §9, §10.1, JSON).
4. **Tour « à vide » avant *Action !*** : le JSON disait « Heurage (variante phase 1) » ; d'après les données et DPLN, le
   Vortex n'est déjà plus Marginal → variante **téléportation** 5067 ; ajout : Heuristique/Morfaille théoriquement
   lançables ce tour (**INCERTAIN**). Délai 25 → « ~26e tour, ±1 ».
5. **Glossaire des masques** aligné sur `effects.md` §5 (code OTOMAI/D2) : `T` = téléfraguée (et non « entité
   déclencheuse »), `o`/`O` = déclencheuse, `h`/`m`/`d` = joueurs / monstres non invoqués / compagnons, `L` = joueurs ou
   compagnons ennemis ; `CI` = le porteur invoque. Conséquences notées : `h,m,d` exclut l'Auroraire (sinon déverrouillage
   impossible) ; la réaction 4998 n'avance l'heure qu'en cas de téléfrag.
6. **Morfaille critique** : ses effets critiques n'ont **pas** la répétition au tour suivant (ajouté).
7. **Méta-succès 1160 Vortexicomane** (Focus + Hardi + Trio, 20 points) manquant : ajouté ; succès de serveurs temporaires
   2396/2772/2874 signalés.
8. **Ordre de jeu** : IV/VIII/XII n'est vrai que si l'équipe des joueurs commence et que le Vortex est dernier de son
   équipe (initiative 3 200 contre 3 400 au grade 5) ; sinon III/VII/XI (§5).
9. Précisions : grade 6 (même sort de départ, Brabuzar sans grade 6), modificateurs « 5 jets » (En quête d'action,
   Disparitions détonantes), étoile posée seulement à l'arrivée de l'horloge, LdV des cases d'heures, JOL d'accord avec
   les données pour Morfaille, Gamosaurus « 50 % d'érosion ».
10. Scripts : `dump.py` écrit désormais `spells_decoded_dump.txt` dans le cache et affiche `effectTriggerDuration`, les
    `cellIds` et la dégressivité ; `modcrawl.py` ne dépend plus du scratchpad.

**Non résolu (reste INCERTAIN)** : sens exact de `T`/`U` ici, décompte ±1 du délai 25, comportement du glyphe 1165
(entrée / fin de tour), grade réellement tiré, −1 PM, effet ×75 % « 12 heures », PV des ressuscités (20-30 % contre
« moitié »).

