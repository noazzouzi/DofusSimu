# Œil de Vortex — audit de fidélité du modèle (modèle DofusSimu contre jeu réel)

> Audit du 2026-10-05. Il compare le modèle du donjon (`docs/research/vortex.md`, `src/dungeons/vortex/*`,
> `src/dungeons/waves.ts`, `data/dungeons/vortex.json`) au jeu réel (Dofus 3.6, version en ligne le 05/10/2026), à
> partir des guides, des notes de version officielles, de vidéos de combats réels et des schémas des guides.
> Question posée : l'IA ne gagne jamais (0/64) et ne corrompt que 4 à 6 monstres sur 19. Notre modèle du donjon est-il
> plus dur que le vrai jeu ?
> Aucun code, test ni donnée n'a été modifié. L'expérience du §7 a tourné sur une copie figée du dépôt (commit c534378),
> hors du dépôt.

## 0. Résumé

**Verdict.** Oui, le modèle est plus dur que le jeu réel. Trois écarts sont sûrs : la cadence des vagues, le −1 PM
des ressuscités et les PV du Vortex. Les deux premiers touchent directement le mode d'échec observé (« submersion »
vers les tours 17-23) ; le troisième ne jouera qu'en phase 2. Un quatrième écart, probable, concerne la géométrie de
l'horloge. Le plus important est la **cadence des vagues**. Depuis la mise à jour 2.42 (août 2017), les vagues arrivent
**tous les 6 tours**, aux tours 1, 7, 13, 19 et 25. Notre modèle les fait arriver aux tours 1, 7, 12, 17 et 22.
L'intervalle de 6 tours vaut deux cycles d'horloge à 4 joueurs : un cycle pour tuer, un cycle pour retuer à la même
heure. C'est la base de la stratégie des vrais joueurs. Avec 5 tours, et un premier tour perdu à cause de
l'invulnérabilité d'arrivée, une vague ne peut presque jamais être corrompue avant l'arrivée de la suivante.

L'expérience appariée du §7 (24 graines, équipe méta stuffée, IA `fast`) le confirme. La cadence de 6 tours ajoute
**+1,2 monstre corrompu** (6,0 → 7,2) et **+3,2 tours** de survie, avec un effet significatif. Les autres corrections
ne sont pas mesurables sur cet échantillon. Toutes corrections sûres cumulées, on passe de 6,0 à 7,4 corrompus sur 19,
et toujours **0 victoire**.

Les écarts corrigés ne suffiront donc pas à faire gagner l'IA. De vraies équipes comparables gagnent ce donjon facilement :
Pandawa, Crâ, Eniripsa et Iop au premier essai, ou un trio Crâ, Enutrof et un frappeur, jugé « très simple ». Elles
appliquent un plan que l'IA ne suit pas : tuer toute la vague dans ses 3 premiers tours, puis la corrompre dans les 3
suivants. Le rythme de dégâts de l'IA, environ 4 000 par tour de jeu, reste aussi inférieur au minimum que ce plan
demande (§6).

### Tableau des écarts, classés par impact × confiance

| # | Sujet | Notre modèle | Jeu réel (3.6) | Confiance | Impact sur la victoire |
|---|---|---|---|---|---|
| 1 | **Cadence des vagues** | `arrivalRounds` = **1, 7, 12, 17, 22** (6 tours, puis 5) ; variante 1, 6, 11, 16, 21 | **Tous les 6 tours** depuis la 2.42 : **1, 7, 13, 19, 25** | **haute** | **haut** (mesuré : +1,2 corrompu, +3,2 tours) |
| 2 | **−1 PM des ressuscités** | désactivé par défaut (`rezMinusOneMp = false`, 70 % des variantes) | « Les monstres ressuscités ont désormais **1 PM en moins** » (2.42) | **haute** | moyen attendu ; non significatif sur 24 graines (+0,2 ± 1,4) |
| 3 | **PV du Vortex à 4 joueurs** | `bossGrade = 5` → **22 000 PV** | à 4 joueurs, le boss est de **rang 1** → **15 000 PV** (malus des boss en dessous de 8 joueurs) | **haute** | moyen en phase 2 ; nul tant que la phase 2 n'est pas atteinte |
| 4 | **Cases de l'Auroraire (horloge)** | `HOUR_CELL` = cases des données de 4996 (173 … 212) ; 6 heures sur 12 hors de l'arène ou sur le décor, d'où le correctif `syncAuroraireCell` | les 12 chiffres peints sur le **pourtour marchable** de l'arène (215 … 255) ; translation de 3 lignes d'écran | moyenne à haute | faible à moyen (lignes d'*En temps et en heure*, échanges forcés, LdV, Heurage en phase 2) |
| 5 | Variantes INCERTAINES périmées | `arrivalRounds` 1, 6, 11, 16, 21 (30 %) ; `rezHpPct` 50 % (25 %) ; `rezMinusOneMp` faux (70 %) | ces valeurs datent d'avant la 2.42 | haute | faible en mode `default` ; fausse le mode `--robust` |
| 6 | Premier *Petit poison* (Harpille) et *Décollage* (Brabuzar) | `globalCooldown` appliqué seulement après un lancer : poison possible dès le tour 1 | « ne peut pas être lancé **avant le tour 4** » ; Décollage « pas **tour 1** » (DPLN) | faible à moyenne | faible (mesuré : −0,4 ± 1,3, non significatif) |
| 7 | Ordre de jeu (k) | l'équipe méta a moins d'initiative que les monstres (3 400) : les monstres commencent, k = 3, le Vortex joue sur III/VII/XI | DPLN : à 4 joueurs, l'Auroraire est sur **IV/VIII/XII** aux tours du Vortex (k = 4) | moyenne | faible, et à double tranchant (Heurage en phase 1 donnerait +2 PM au lieu de +400 Int) |
| 8 | Mise à jour **3.7** (en ligne le **06/10/2026**) | corrompus ressuscités et laissés sur la carte (comportement 3.6) | 3.7 : le Vortex **ne ressuscite plus les corrompus** ; bonus d'heures du Vortex appliqués à la mort du monstre | haute pour la 3.7 | faible (le modèle suit la 3.6, qui est en ligne) ; à paramétrer |
| 9 | Modificateur de dimension | désactivé | un modificateur actif, qui change à chaque victoire sur le Vortex | moyenne | inconnu (selon le modificateur, il aide ou gêne) |

Pas d'écart sur les conditions de fin. La victoire est la mort du Vortex en phase 2 et la défaite la mort de tous les
personnages. La « submersion » n'est pas une règle du jeu (`vortexFailReason` n'en fait qu'un diagnostic). Aucun
guide ne mentionne de limite de tours, sauf le succès Trio (« moins de 80 tours »). Notre `maxRounds = 60` convient.

### Ce qu'il faut changer d'abord

Les écarts 1, 2, 3 et 5 se corrigent par paramètres, sans toucher au moteur. Voir §8 pour l'ordre et l'expérience
appariée du §7, qui mesure leur effet sur l'IA actuelle.

## 1. Écarts en détail

### 1.1 Cadence des vagues : tous les 6 tours (écart n° 1)

- **Notre modèle** : `ARRIVAL_ROUNDS_DEFAULT = [1, 7, 12, 17, 22]`, avec la variante `[1, 6, 11, 16, 21]` (poids 0,3).
  `vortex.md` §4 attribue ce calendrier à DPLN. En réalité, DPLN ne dit que « la deuxième vague arrive tour 7 » ;
  l'intervalle de 5 tours vient de JOL, dont l'article date d'avant la 2.42.
- **Jeu réel** : la 2.42 a porté l'intervalle de 5 à 6 tours.
  - Notes de version 2.42, section Égarés/Vortex (copie intégrale sur
    [rr-jiva](https://rr-jiva.darkbb.com/t4259-change-log-2-42-devblog-simplification) et sur le
    [wiki JOL de la 2.42](https://forums.jeuxonline.info/showthread.php?t=1358346), reprise par
    [Millenium, 08/08/2017](https://www.millenium.org/guide/273667.html?page=10)) :
    « *Le pourcentage de vie des monstres ressuscités est réduit : 50% -> 20%. Les monstres ressuscités ont désormais
    1 PM en moins. Le nombre de tours entre 2 vagues de monstres est augmenté : 5 tours -> 6 tours* ».
  - Ancienne règle (JOL, 2016) : « *Chaque vague arrive 5 tours après la précédente. La vague 2 arrivera donc au tour
    6. La vague 3 au tour 11* ». Cela donnait 1, 6, 11, 16, 21. Avec 6 tours, on obtient 1, 7, 13, 19, 25.
  - DPLN (m.à.j. 24/08/2024) : « *la deuxième vague arrive tour 7* », ce qui concorde avec l'intervalle de 6 tours.
  - Vidéo [HonnyTTV, « VORTEX du PREMIER COUP ! »](https://www.youtube.com/watch?v=8jrZW5Ny5i8) (21/08/2017, juste
    après la 2.42 ; équipe Panda/Crâ/Eni/Iop), 5:15–6:16, sous-titres automatiques corrigés : « *le plus important
    c'est de pas se faire submerger […] vu que vous êtes 4 il vous faut 3 tours pour que l'horaire fasse un tour
    complet […] les vagues apparaissent tous les six tours, donc au lieu de cinq […] il faut que tout le monde ait été
    tué au bout du troisième tour de la vague, comme ça pendant les trois derniers tours de la vague vous allez […]
    esquiver les attaques des monstres et les tuer aux heures adéquates* ».
  - Les données concordent aussi. *Marginal* dure 25 tours et le déclencheur 5008 a un délai de 25 tours. Le Vortex ne
    peut donc pas être déverrouillé avant son ~26e tour, c'est-à-dire juste après la vague 5 au tour 25. Avec notre
    calendrier, la vague 5 arrive au tour 22 et laisse 4 tours vides inexpliqués.
- **Confiance : haute.** La note de version est officielle, une source indépendante dit la même chose juste après la
  2.42, la vague 2 au tour 7 est confirmée et les délais des données concordent. Aucune des notes de version relues
  ensuite ne revient dessus (pages DPLN 2.46, 2.49, 2.70 à 2.73, 3.1, 3.3 à 3.7 ; les versions 2.43 à 2.69 hors 2.46
  et 2.49 n'ont pas été relues).
- **Impact : haut.** À 4 joueurs, l'horloge fait un tour complet en 3 tours, et une vague ne peut pas être frappée à son
  1er tour (invulnérable). Le calendrier de corruption d'une vague est donc :

  | Tour de la vague | 1 | 2 | 3 | 4 | 5 | 6 |
  |---|---|---|---|---|---|---|
  | Jeu réel (6 tours) | arrivée, invulnérable | 1re mort | 1re mort | — | **corruption** (2 + 3) | **corruption** (3 + 3) |
  | Notre modèle (5 tours) | arrivée, invulnérable | 1re mort | 1re mort | — | **corruption** (2 + 3) | = 1er tour de la vague suivante |

  Dans le modèle, seuls les monstres tués au 2e tour de leur vague peuvent être corrompus avant la vague suivante. Dans
  le jeu, ce sont ceux tués aux 2e et 3e tours, ce qui double la fenêtre. Les vagues 3, 4 et 5 arrivent aussi 1, 2 et
  3 tours plus tôt. Au tour 17, notre modèle a déjà fait entrer 15 monstres, le jeu 11. Au tour 22, le modèle en a 19,
  le jeu 15. Le tuning-log décrit exactement ce mode d'échec : « *vague 2 : 2,2 monstres sur 4 marqués (tour 11,2) mais
  l'étoile arrive 3 tours plus tard, quand l'équipe meurt* ».
- **Recommandation** : `arrivalRounds = [1, 7, 13, 19, 25]` par défaut. Retirer la variante `[1, 6, 11, 16, 21]`
  (antérieure à la 2.42) et ne garder aucune variante `[1, 7, 12, 17, 22]` (aucune source). Attention à l'invariant
  `max(arrivalRounds) < unlockVortexTurn` : 25 < 26 passe, mais la variante `unlockVortexTurn = 25` devient invalide.
  Il faut la retirer, ou passer l'invariant à ≤ si 5008 est évalué après l'arrivée de la vague du même tour.

### 1.2 Les ressuscités ont 1 PM de moins (écart n° 2)

- **Notre modèle** : l'effet 169 « −1 PM » de 5003 vise `a,A,U` dans la zone P1 (case du Vortex). `vortex.md` l'a
  jugé INCERTAIN parce que le ressuscité apparaît à 3 cases ou plus. Le scénario le **retire** par défaut
  (`rezMinusOneMp = false`, poids 0,7).
- **Jeu réel** : la note de version 2.42 citée au §1.1 dit « *Les monstres ressuscités ont désormais 1 PM en moins* ».
  Le devblog 2.42 donne cet exemple : « *contre Vortex, les monstres ressuscités ont désormais moins de vie et moins de
  PM* » ([devblog « Simplification du contenu haut niveau »](https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/698902-simplification-contenu-haut-niveau),
  texte recopié sur rr-jiva). L'effet existe dans les données. Le masque `U` (entité qui vient d'apparaître) ignore donc
  la zone.
- **Confiance : haute. Impact : moyen attendu, non significatif sur 24 graines (§7).** Les zombies passent à
  Ikargn 4, Méjaire **3**, Harpille 4, Buboxor 5 et Brabuzar 4 PM. La Méjaire ressuscitée près du Vortex, en haut de la carte, qui pose *Pacifiste* (1-3 PO en ligne) sur
  le tueur prévu, est la **première cause d'étoiles manquées** dans le tuning-log (47 sur 227). Sa portée effective
  passe de 7 à 6 cases.
- **Recommandation** : `rezMinusOneMp = true` par défaut, et retirer la variante `false`. L'effet est désenvoûtable
  (`dispellable 1`) et retiré à la mort : −1 PM par vie, sans cumul. La lecture de `vortex.md` §6 est donc bonne.

### 1.3 Le Vortex est de rang 1 à 4 joueurs : 15 000 PV et non 22 000 (écart n° 3)

- **Notre modèle** : `DEFAULT_BOSS_GRADE = 5`, soit 22 000 PV. `vortex.md` §4 laisse le « grade effectif » INCERTAIN.
- **Jeu réel** :
  - Devblog des donjons modulaires (2.7.0, [copie JOL](https://dofus.jeuxonline.info/actualite/35775/devblog-donjons-modulaires)) :
    « *Nous appliquons également un malus à la vie et aux caractéristiques du Boss de donjon lorsqu'il n'est pas
    affronté avec 8 personnages* ». Les dimensions gardent ce fonctionnement modulaire
    ([JOL, dimensions divines](https://dofus.jeuxonline.info/actualite/43821/dimensions-divines-presentent)).
  - DPLN, présentation de la 3.7 et du nouveau bestiaire ([mise-a-jour-307](https://www.dofuspourlesnoobs.com/mise-a-jour-307.html),
    04/10/2026) : « *Si l'entité est un boss, cela correspond à son butin (si vous faites le donjon à 4, le boss sera de
    rang 1, si vous faites le donjon à 8, le boss sera de rang 5)* ». Et pour les monstres : « *un monstre de niveau
    200 est de rang 1 tandis qu'un monstre de niveau 212 est de rang 5* ».
  - Les grades du Vortex ne diffèrent que par les PV (15 000, 17 000, 18 000, 20 000, 22 000 ; 800 dans chaque
    caractéristique). À 4 joueurs, le Vortex a donc **15 000 PV**, 32 % de moins que dans notre modèle.
- **Confiance : haute. Impact** : nul aujourd'hui (l'IA n'atteint jamais *Action !*), moyen ensuite. Le burst de
  phase 2 est dimensionné sur 22 000 PV (`burst.ts`, prix de victoire).
- **Recommandation** : `bossGrade` dérivé du nombre de joueurs, `clamp(players − 3, 1, 5)`, soit 1 à 4 joueurs.
  Les monstres de vague restent au grade 5 (niveau 212, voir §3).

### 1.4 Les cases de l'horloge sont décalées de 3 lignes (écart n° 4)

- **Notre modèle** : `HOUR_CELL = [—, 173, 176, 220, 292, 376, 444, 484, 481, 436, 365, 281, 212]`, lu dans les
  `cellIds` des effets 1023 et 4 du sort 4996. Six heures (I, II, III, X, XI, XII) tombent sur des cases non
  marchables, et I et II se trouvent **au-delà du mur nord**. Le moteur ne peut pas y téléporter l'Auroraire :
  `syncAuroraireCell` l'y replace de force (règle « serveur » supposée). VII tombe sur 484, une case de départ des
  joueurs. L'Auroraire est invoquée sur 255 avec l'état « Douzième heure », alors que la case de XII serait 212.
- **Jeu réel** : `docs/research/maps.md` et `data/maps/annotations/143393281.json` relèvent déjà d'autres cases :
  `1:215 2:218 3:263 4:334 5:418 6:487 7:526 8:523 9:479 10:407 11:323 12:255`. Elles viennent du schéma JOL « Les
  placements de l'Auroraire » et sont vérifiées sur les chiffres peints du rendu Dofus 3. Je l'ai recontrôlé :
  - Le schéma JOL ([Aurorairee.bmp](https://jolstatic.fr/dofus/equipe/226595/Articles/Vortex/Aurorairee.bmp)) place
    les 12 positions sur le **pourtour de l'arène** : 1 et 2 sur le bord nord, 12 et 3 aux extrémités de la ligne bleue,
    7 et 8 sur le bord sud, sous les cases rouges.
  - Le schéma DPLN des lignes de frappe
    ([dj2-placement-frappe-auroraire](https://www.dofuspourlesnoobs.com/uploads/1/3/0/1/13010384/dj2-placement-frappe-auroraire_orig.png))
    montre les poteaux de l'Auroraire sur le bord de l'arène, 7 et 8 sur le bord sud.
  - Le rendu Dofus 3 (`api.dofusdb.fr/img/maps/1/143393281.jpg`) montre I à XII peints sur l'anneau marchable du
    pourtour.
  - Les 12 cases relevées sont **toutes marchables**. Les guides disent que l'Auroraire échange sa place avec
    n'importe quelle entité présente sur sa case d'arrivée (DPLN : « *personnage, monstre, invocation statique ou
    non* ») ; c'est impossible sur une case de décor.
  - **XII = 255 = case d'invocation de l'Auroraire** (effet 181 de 5006), et l'Auroraire commence à XII. Le modèle
    actuel, lui, l'invoque à 3 lignes de sa propre case XII.
  - L'écart est une **translation uniforme** de 42 ou 43 cases, soit 3 lignes d'écran, (−2, +1) en MapPoint. Les deux
    anneaux sont parfaitement symétriques, autour de (18, −5) pour les données et de (20, −6) pour le rendu.
- **Confiance : moyenne à haute.** Je ne sais pas expliquer pourquoi les `cellIds` de 4996 sont décalés : peut-être
  une numérotation de carte différente entre les données de sorts et l'export de carte. Mais quatre indices
  indépendants (deux schémas de guides, le rendu Dofus 3 et la case d'invocation) désignent l'anneau du pourtour.
- **Impact : faible à moyen.** Les lignes d'*En temps et en heure* changent presque entièrement : 0 à 2 cases communes
  par heure (calcul sur la carte du dépôt).

  | Cycle du Vortex | Cases de départ rouges hors des lignes : données (modèle) | Cases rouges hors des lignes : pourtour (jeu) |
  |---|---|---|
  | k = 3 (III/VII/XI) | 424, 427, 438, 441, 453, 482 (6/12) | toutes sauf 438 (11/12) |
  | k = 4 (IV/VIII/XII) | 424, 438, 441, 443, 453, 455, 457, 482, 484 (9/12) | toutes sauf 443 (11/12) |

  Le placement de départ (`placement.ts`), l'évitement des lignes (`extraIncoming`), l'échange forcé sur VII (484 dans
  le modèle, 526 en jeu) et la case d'arrivée d'Heurage en phase 2 reposent donc sur des cases fausses. L'Auroraire
  occupe aussi une case du pourtour : obstacle et LdV. Dans le modèle, elle se trouve souvent dans le décor. Les
  lignes coûtent peu dans les lots actuels, car l'IA les évite : une seule défaite classée « croix de l'Auroraire » sur
  128 (tuning-log, tour 3), et 600 à 1 250 dégâts par combat dans la colonne « Vortex » de `vortex-stuffs.md`. L'effet
  direct sur la victoire est donc limité, mais la géométrie tactique est fausse.
- **Recommandation** : un paramètre `clockCells: 'painted' | 'data'`, défaut `'painted'`, qui translate les `cellIds`
  de 4996 de +3 lignes (ou les remplace par `annotations.clockPositions`). Retirer `syncAuroraireCell` dans ce mode,
  puisque toutes les cases sont marchables. Corriger `vortex.md` §2 : tableau des heures et ASCII. **À vérifier en
  jeu** : sur quelle case se trouve l'Auroraire à I ?

### 1.5 Variantes INCERTAINES périmées (écart n° 5)

`VORTEX_UNCERTAIN` tire avec un poids notable des règles antérieures à la 2.42 :

- `arrivalRounds = [1, 6, 11, 16, 21]` (0,3) : intervalle de 5 tours, celui de JOL 2016 ;
- `rezHpPct = [50, 50]` (0,25) : « moitié des PV » de JOL et Tofus, remplacé par 20 % en 2.42 ;
- `rezMinusOneMp = false` (0,7) : contredit par la 2.42.

En mode `--robust`, ces tirages durcissent artificiellement les campagnes. **Confiance haute**, impact faible en mode
`default`. Il faut aussi relire `vortex.md` §14 : JOL et Tofus ne sont pas « en désaccord » avec DofusDB, ils décrivent
une version périmée.

### 1.6 Premier lancer de *Petit poison* et de *Décollage* (écart n° 6)

- **Notre modèle** : les données donnent `initialCooldown 0` et `globalCooldown 3` pour *Petit poison* (5021),
  `initialCooldown 0` et `globalCooldown 1` pour *Décollage* (5032). Le moteur n'applique la relance globale **qu'après
  un lancer** (`src/engine/cast.ts`), comme l'émulateur Stump 2.71 (`SpellHistory.CanCastSpell`). La Harpille de la
  vague 1 peut donc empoisonner les 4 personnages dès le tour 1.
- **Jeu réel** : DPLN, recopié par guidedofus et dofus-portals : *Petit poison* « *ne peut pas être lancé avant le
  tour 4, relance de 3 tours* » ; *Décollage* « *ne peut pas être lancé tour 1, relance de 3 tours* » ; *Attraction
  ailée* « *ne peut pas être lancé tour 1* » (`initialCooldown 1` dans les données). La restriction annoncée par DPLN
  vaut **exactement** la relance globale des données (3 donne le tour 4, 1 donne « pas au tour 1 »). Pour les sorts
  sans relance initiale ni globale (Envolupté, Bouclier absorbant), DPLN n'annonce aucune restriction.
- **Confiance : faible à moyenne.** La correspondance est systématique, mais seul DPLN l'atteste, et le code du serveur
  est inconnu. **Impact : faible** (mesuré au §7 : −0,4 ± 1,3 corrompu, non significatif). Le poison des Harpilles
  est pourtant la 1re source de dégâts subis : 5 000 à 6 000 par combat, et 15 000 à 17 000 pour l'ensemble des
  Harpilles (tuning-log, `vortex-stuffs.md`). Un premier poison au tour 4 au lieu du tour 1 retire une application
  sur 4 personnages pendant la phase la plus tendue de la vague 1.
- **Recommandation** : un paramètre INCERTAIN `globalCooldownAtStart` (défaut à décider) qui pose la relance globale
  comme relance initiale. Question ouverte : l'appliquer depuis le début du combat ou depuis l'arrivée de chaque
  Harpille ?

### 1.7 Qui joue avant le Vortex : k = 3 ou k = 4 (écart n° 7)

- **Notre modèle** : avec la règle `average` comme avec `best`, l'équipe méta stuffée a beaucoup moins d'initiative
  que les monstres (relevé sur la copie figée : Crâ ≈ 1 800, Iop ≈ 1 780, monstres 3 400, Vortex 3 200). L'ordre est
  Ikargn, Crâ, Méjaire, Iop, Harpille, Eniripsa, **Vortex**, Enutrof. On a donc k = 3 : le Vortex joue sur III, VII et
  XI, et *Heurage* en phase 1 (tours 4, 7, 10…) donne toujours **+400 Intelligence** cumulables aux monstres vivants.
- **Jeu réel** : DPLN affirme qu'à 4 joueurs « *l'Auroraire sera uniquement sur les heures 4, 8 et 12 aux tours du
  Vortex* », soit k = 4 : les 4 personnages jouent avant le Vortex au premier tour. La formule d'initiative des
  monstres est inconnue (formule communautaire non vérifiée). Le bestiaire de la 3.7 affichera « *l'initiative de tous
  les monstres* », ce qui tranchera la question.
- **Confiance : moyenne. Impact : faible et ambigu.** Avec k = 4, le monstre de tête ne joue plus avant les
  personnages et les lignes changent. Mais *Heurage* en phase 1 tomberait toujours sur IV, soit **+2 PM** cumulables
  aux monstres vivants, ce qu'aucun guide ne signale (voir §2, point 5, et §4, question 6).
- **Recommandation** : mesurer l'initiative des monstres dans le bestiaire 3.7, puis recaler la formule d'initiative
  des monstres ou le paramètre `startingTeamRule`.

### 1.8 Mise à jour 3.7, en ligne le 6 octobre 2026 (écart n° 8)

DPLN ([mise-a-jour-307](https://www.dofuspourlesnoobs.com/mise-a-jour-307.html), bêta depuis le 17/09/2026) :
« *Vortex : Vortex ne ressuscite plus les monstres corrompus (ceux qui ont été éliminés 2 fois à la même heure et qui
passent leurs tours). Les bonus obtenus par le Vortex quand un monstre est éliminé à une certaine heure sont désormais
appliqués à la mort du monstre et non plus quand Vortex est seul sur le terrain. Cette modification n'a quasiment aucun
impact sur le combat.* » Et plus loin : « *Le Vortex ne ressuscite plus les monstres qui ont été éliminés 2 fois à la
même heure rendant le combat plus clair et le succès Hardi légèrement plus compliqué* ».

- Notre modèle et nos données DofusDB (mises à jour le 23/06/2026) suivent la **3.6**, encore en ligne le 05/10. Ce
  n'est donc pas une erreur aujourd'hui.
- Conséquences en 3.7 : les corrompus disparaissent. Ils ne tiennent plus de case, ne bloquent plus la LdV et ne
  taclent plus (Gamosaurus : « *les monstres réinvoqués pourront toujours vous tacler* »). La tactique des joueurs qui
  s'entourent de corrompus invulnérables disparaît, et l'anneau de résurrection autour du Vortex reste libre.
  **Question ouverte** : une vague entièrement corrompue, donc entièrement morte, déclenche-t-elle désormais la vague
  suivante en avance ? C'est la règle générale des dimensions (DPLN : « *si vous tuez tous les monstres d'une vague
  avant le nombre de tours impartis, alors la prochaine vague se lance directement* »).
- **Recommandation** : un paramètre `patch: '3.6' | '3.7'`, avec `corruptedResurrected` et `vortexBonusAtDeath`.

### 1.9 Modificateurs de dimension (écart n° 9)

Les 10 modificateurs du Xélorium existent toujours (DPLN 2024, dofus-portals 2025-2026). Le modificateur actif change
à chaque victoire sur le Vortex (« *Un modificateur change uniquement lorsque vous finissez le donjon niveau 200 de la
zone* »). Le combat réel se joue donc toujours avec **un** modificateur. Certains aident beaucoup : *En quête
d'action* avec retrait de PA, *Liaison longue portée*, ou *Puissance cyclique* (+25 % de dommages par tour, mais
ennemis à +50 % de vitalité). D'autres gênent. Désactiver les modificateurs reste un choix neutre et raisonnable.
**Confiance moyenne, impact inconnu.**

## 2. Réponses point par point aux questions de l'audit

1. **Condition de victoire** : corrompre **tous** les monstres de vague (19 à 4 joueurs : vague 1 = Vortex + 3, puis
   4 par vague ; JOL, DPLN « *boss dès le début + 3 autres monstres si vous êtes 4* »), puis tuer le Vortex quand il
   est vulnérable. DPLN décrit la séquence : tour où l'on achève le dernier monstre, puis un tour complet avec tous les
   corrompus sur le terrain, puis *Action !* (monstres tués, retour aux cases de départ, Vortex invulnérable qui passe
   son tour), puis le Vortex vulnérable joue. HonnyTTV confirme : « *le premier tour il tue tous les monstres […]
   deuxième tour il est vulnérable donc je commence à le taper et troisième tour il va vous taper* ». **Défaite** :
   seulement la mort de tous les personnages. Aucune « submersion » ni limite de tours, hors succès Trio.
2. **Vagues** : 5 vagues de N monstres, N fixé au début du combat. Un mort ne réduit pas les vagues suivantes (JOL :
   « *contiendra bien le même nombre de monstres qu'au début du combat* »). Elles arrivent **tous les 6 tours** :
   1, 7, 13, 19, 25 (§1.1), sur les cases de départ de la vague 1 (JOL), **invulnérables 1 tour** (DPLN, JOL,
   dofus-portals). Composition par joueur : seul le tableau JOL existe, aucune source ne le contredit.
3. **Horloge** : +1 heure au début du tour de chaque **personnage** (« *À chaque début de tour d'un personnage
   l'Auroraire avance d'une heure* », DPLN) et +1 quand un personnage marche dans un glyphe de monstre (DPLN, JOL,
   Gamosaurus). Les invocations ne déclenchent pas les glyphes (Gamosaurus). L'**étoile jaune** (« Même heure »)
   apparaît sur un monstre déjà tué quand l'horloge revient à une de ses heures de mort. Le tuer à ce moment le
   **corrompt** : en 3.6 il revient invulnérable et passe ses tours ; en 3.7 il ne revient pas. Tué à une autre heure,
   il revient avec le bonus de cette heure et pourra être corrompu à **l'une ou l'autre** de ses heures (exemple de la
   Méjaire de DPLN). Le Vortex récupère chaque bonus d'heure **une seule fois** (« *si vous tuez cinq monstres à 3
   heure il ne gagnera que une fois les boost de 400 intelligence* »). Les cases parcourues par l'Auroraire font
   l'objet de l'écart n° 4.
4. **Morts des personnages** : pas de résurrection. Un personnage mort **ne fait plus avancer l'horloge**. DPLN
   (stratégie Sadida + Pandawa, partie commencée à 3 ou 4 dont 1 ou 2 meurent vite) : « *Ils seront donc
   automatiquement « corrompus » au bout de 6 tours (car vous ne serez plus que deux dans le combat le Sadida et le
   Pandawa)* ». Une période de 6 tours suppose N = 2 personnages **vivants**. Notre défaut
   `deadPlayerAdvancesClock = false` est donc confirmé. Côté monstres, tous les morts ressuscitent au début de chaque
   tour du Vortex, à 3 PO de lui, dans le sens horaire (DPLN). Notre défaut `rezAllPerTurn = true` est confirmé.
5. **Caractéristiques des monstres** : monstres de vague au niveau 212 (JOL : « (212) » partout), soit le rang 5
   d'après la règle du bestiaire 3.7. Ils ont 6 600 PV, 850 dans chaque caractéristique, et **notre défaut est
   juste**. Le Vortex est au **rang 1 à 4 joueurs** (§1.3). Les nerfs 2.42 sont déjà dans les données : PM de
   l'Ikargn et du Brabuzar à 5, *Terre mythe* à portée 1, *Hoxor* en ligne, *Bouclier absorbant* déclenché pendant 1
   tour, dégâts de base de la Harpille et de la Méjaire (31-40) environ 30 % sous ceux de l'Ikargn et du Brabuzar
   (51-75). L'esquive PA/PM vaut Sagesse/10 : JOL affiche « 60 à 80 » pour les monstres de vague et 80/100 pour le
   Vortex (80 + 20 d'esquive PM des données). C'est l'hypothèse du moteur (`factory.ts`).
   - *Petit poison* touche tous les personnages et un soin le retire. Le premier lancer est peut-être retardé (§1.6).
   - *Rayonirique* (Méjaire) pose un *Pacifiste* non désenvoûtable ; *Heuristique* (Vortex) un *Pacifiste*
     désenvoûtable (DPLN).
   - Brabuzar : téléportation symétrique et poussées. DPLN : « *stabilisez le Pandawa au début de chaque nouvelle vague
     pour éviter que le Brabuzar vous pousse* ».
   - *Heurage* en phase 1 : DPLN implique que le Vortex le lance périodiquement en phase 1 (« *Il ne l'utilisera que
     s'il est disponible (ce qui n'est pas forcément le cas selon le tour auquel vous achevez le dernier monstre)* ») ;
     Tofus (avant la 2.42) a vu les bonus donnés à « *tous les monstres* ». C'est conforme aux données.
   - *Marginal* et *Action !* : conformes (§3).
6. **Compositions et stratégies** : voir le §6.

## 3. Points du modèle confirmés

| Point | Preuve |
|---|---|
| 5 vagues ; vague 1 = Vortex + (N−1) ; N figé au début ; 19 monstres + Vortex à 4 | DPLN, JOL, dofus-portals |
| Invulnérabilité d'arrivée de 1 tour ; vague 1 frappable dès le tour 1 | DPLN (« *invulnérable durant 1 tour* ») ; stratégies Hardi et Sadida qui frappent la vague 1 au tour 1 |
| Réapparition sur les cases de départ de la vague 1 | JOL |
| Monstres de vague au niveau 212 (6 600 PV) | JOL, DofusDB, règle des rangs du bestiaire 3.7 |
| Horloge à +1 par début de tour de personnage, +1 par glyphe ; invocations sans effet | DPLN, JOL, Gamosaurus |
| Étoile, corruption, heures multiples, Vortex bonifié une fois par heure | DPLN, JOL, données (4996, 5002, 5009) |
| Corrompus ressuscités, invulnérables, passent leurs tours, taclent (3.6) | DPLN, JOL, Gamosaurus |
| Tous les morts ressuscités à chaque tour du Vortex, à 3 PO, sens horaire | DPLN |
| PV des ressuscités ≈ 20 % (données : 20 à 30 %) | note de version 2.42 (« *50% -> 20%* ») |
| Un mort ne fait plus avancer l'horloge | DPLN (« *6 tours […] vous ne serez plus que deux* ») |
| Table des 12 bonus d'heures | DPLN, dofus-portals, données |
| Glyphes déclenchés à l'entrée, échange de place, liste des bonus | DPLN, JOL, Gamosaurus (Pesanteur ou porté : pas d'échange) |
| *Action !* : un tour « à vide », puis Vortex invulnérable qui passe son tour, puis phase 2 (`actionDelay = 1`) | DPLN, next-stage ; HonnyTTV (19:05) |
| Phase 2 : Heurage tous les 3 tours, Heuristique 1-8 en ligne sans LdV avec *Pacifiste* désenvoûtable, Morfaille | DPLN, Gamosaurus |
| *En temps et en heure* : ≈ 500 Terre + 50 % des PV érodés + 20 % d'érosion sur les lignes de l'Auroraire | données ; DPLN (« 800 »), Gamosaurus (« base 500 ») |
| Nerfs 2.42 (PM, portées, dégâts) intégrés aux données | note de version 2.42 contre DofusDB |
| Esquive PA/PM des monstres = Sagesse/10 | encadrés JOL (60-80 ; Vortex 80/100) |
| Pas de limite de tours (succès Trio : < 80 tours) | DofusDB 1159, JOL |

## 4. Questions ouvertes (aucune source ne les documente)

1. **Cases réelles de l'Auroraire** (écart n° 4) : sur quelle case se trouve l'Auroraire à I ? Une capture en jeu
   suffit à trancher.
2. **Initiative des monstres** et ordre de départ (k). Le bestiaire 3.7 l'affiche.
3. **Relance globale au début du combat** (*Petit poison*, *Décollage*) : par combat ou par monstre arrivé ?
4. **Vague anticipée** si toute la vague présente est morte. En 3.6, cela n'arrive presque jamais, puisque les
   corrompus sont vivants et les morts ressuscités au tour du Vortex. En 3.7, la question devient réelle.
5. **Composition des vagues** : seul le tableau JOL (2016, m.à.j. 2019) existe.
6. ***Heurage* en phase 1 avec k = 4** : il donnerait +2 PM cumulables aux monstres vivants tous les 3 tours, effet
   qu'aucun guide ne mentionne. Est-il bien lancé à chaque fois ?
7. **Tour exact d'*Action !*** (délai 25 ± 1). Avec la vague 5 au tour 25, la question ne se pose plus en pratique :
   la dernière vague ne peut pas être corrompue avant le ~28e tour.
8. **Modificateur de dimension** actif au moment de la tentative.

## 5. Ce qui pèse dans la balance

Les écarts n° 1 à n° 3 se cumulent dans le même sens. Le modèle impose aux vagues 2 à 5 un rythme impossible, laisse
1 PM de plus aux ressuscités et donne 47 % de PV en plus au boss. Aucun écart trouvé ne rend le modèle **plus facile**
que le jeu, à deux réserves près. Le modificateur de dimension, désactivé, peut aider en jeu. *Heurage* avec k = 4
serait plus dur.

Le modèle est aussi **cohérent** avec les données sur de nombreux points vérifiés (§3). Le moteur exécute fidèlement
les sorts du donjon, et le dossier `vortex.md` a correctement anticipé la plupart des règles. Les erreurs viennent
surtout de **sources périmées** (JOL et Tofus, d'avant la 2.42), d'un calendrier hybride et d'un défaut de grade du
boss.

## 6. Calibrage : ce que font les joueurs qui gagnent

- **Équipes** : HonnyTTV, Panda/Crâ/Eni/Iop, quasi identique à notre équipe méta, gagne **au premier essai** en 2017
  (« *Donjon très facile honnêtement quand on fait un peu attention et avec beaucoup de rox* »). DPLN qualifie le Trio
  de « *très simple avec un Crâ et un Énutrof retrait PM accompagné d'une autre classe* ». Des duos gagnent aussi :
  Sadida + Pandawa (idole Leukide), Pandawa + Sacrieur. Entraax : « *le combat vraiment très très simple jusqu'au kill
  du vortex* » ([vidéo](https://www.youtube.com/watch?v=gIk9Y4c91c0), 9:53). Les méthodes JOL sont Roublard + Pandawa
  (mur de bombes), Éliotrope (portails), ou « *sans classe particulière* » avec retrait de PM et sorts de zone.
- **Plan de vague**, d'après HonnyTTV : tuer **les 4 monstres pendant les 3 premiers tours** de la vague (en pratique
  aux 2e et 3e tours, le 1er étant invulnérable), puis, pendant les 3 derniers, esquiver et retuer chaque zombie à
  « son » heure. Le même personnage retue ce qu'il a tué, 3 tours plus tard (DPLN).
- **Variante défensive** (DPLN) : « *retuer les monstres ressuscités directement* » à chaque tour pour ne jamais être
  submergé ; ils finissent par porter l'étoile. C'est la stratégie Sadida, une *Force de la Nature* sur les zombies à
  chaque tour.
- **Contrôle** : retrait de PM, surtout sur les Méjaires (« *gardez-les à distance* »). Stabiliser le porteur contre le
  Brabuzar. Retirer le poison par un soin (Cawotte). Ne jamais finir en ligne avec la future case de l'Auroraire.
- **Corrompus comme murs** (3.6) : le Pandawa porte des corrompus invulnérables autour de l'équipe. Entraax : « *dès
  que j'ai la possibilité je vais récupérer des mobs invulnérables […] à mon corps à corps afin que les mobs ne
  puissent plus venir à mon corps à corps […] à partir de la vague 3 ou de la vague 4 […] je vais plus jamais subir de
  dommages* » ([vidéo](https://www.youtube.com/watch?v=PXMQxAKDE68), 4:08–4:26). Cette tactique disparaît en 3.7.
- **Danger perçu** : DPLN dit de la Harpille que « *c'est le monstre qui frappe le moins* ». Entraax, en tank
  Pandawa, dit des Buboxor et Ikargn qu'ils ne sont « *pas du tout un danger* ». Dans nos lots, au contraire, les
  Harpilles infligent 15 000 à 17 000 dégâts par combat (poison compris). Les humains tuent les Harpilles vite et
  retirent le poison par des soins : l'écart vient probablement de l'IA, pas du modèle.
- **Ordre de grandeur des dégâts nécessaires** : une vague de 4 monstres demande 26 400 PV pour les premières morts,
  plus environ 4 × 1 650 PV (zombies à ~25 %) pour les corruptions, soit environ 33 000 PV effectifs par vague. En
  6 tours, c'est au moins 5 500 par tour de jeu, sans gaspillage. Le plan HonnyTTV demande environ 13 000 par tour
  pendant les 2 tours de mise à mort. L'IA stuffée inflige environ **4 000 par tour de jeu** (82 600 en 20,5 tours,
  `vortex-stuffs.md`), soit 30 à 45 % de son potentiel analytique d'après le tuning-log. Même avec la bonne cadence,
  il lui faudra environ 1,5 à 3 fois plus de dégâts utiles.

## 7. Expérience appariée (copie figée, hors dépôt)

Protocole : copie de `src/` et `data/` du commit c534378 dans le scratchpad. Équipe
`cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,eniripsa_soin_vortex`, IA `fast`, variante `default`,
**24 graines** `campaignSeeds(21, 24)`, appariées d'un bras à l'autre. Seuls les paramètres du scénario changent
(`--param` du harnais `runOne`).

Le bras E utilise une deuxième copie, dont `applyInitialCooldowns` (`src/dungeons/waves.ts`) pose aussi la relance
globale des sorts de monstres comme relance initiale : *Petit poison* lançable à partir du 4e tour de chaque Harpille
présente ou arrivante.

| Bras | Paramètres | Victoires | Tours survécus | Corrompus T7 / T13 / T17 / T19 | Corrompus (fin) | Causes d'échec |
|---|---|---|---|---|---|---|
| A — modèle actuel | défauts | 0/24 | 23,4 | 2,17 / 4,04 / 5,33 / 5,54 | **6,00** | submersion 21, vague non corrompue au déverrouillage 2, croix 1 |
| B — cadence 6 tours | `arrivalRounds=1;7;13;19;25` | 0/24 | 26,6 | 2,17 / 4,38 / 5,67 / 6,21 | **7,21** | vague non corrompue 10, submersion 13, croix 1 |
| C — B + −1 PM | + `rezMinusOneMp=true` | 0/24 | 26,5 | 2,21 / 4,50 / 5,83 / 6,29 | **7,42** | submersion 12, vague non corrompue 12 |
| D — C + boss rang 1 | + `bossGrade=1` | 0/24 | 26,5 | identique à C | **7,42** | identique à C (aucun combat n'atteint la phase 2) |
| E — D + relance globale initiale | D + code modifié (bras E) | 0/24 | 26,0 | 1,96 / 4,38 / 5,75 / 6,08 | **7,04** | submersion 12, vague non corrompue 8, croix 3, défaite 1 |

Différences appariées (moyenne ± demi-IC 95 %, graines meilleures / moins bonnes) :

| Comparaison | Corrompus (fin) | Corrompus T19 | Tours survécus |
|---|---|---|---|
| B − A (cadence) | **+1,21 ± 0,71** (+15 / −4) | +0,67 ± 0,50 (+13 / −4) | **+3,2 ± 1,2** (+20 / −4) |
| C − B (−1 PM) | +0,21 ± 1,39 (+12 / −11) | +0,08 ± 0,85 | −0,1 ± 1,8 |
| D − C (boss rang 1) | 0 (combats identiques) | 0 | 0 |
| E − D (relance globale initiale) | −0,38 ± 1,26 (+7 / −13) | −0,21 ± 0,82 | −0,5 ± 1,7 |
| **D − A (corrections sûres cumulées)** | **+1,42 ± 1,14** (+15 / −6) | +0,75 ± 0,78 | **+3,1 ± 1,8** (+17 / −5) |

Lecture :
- **La cadence est le seul effet significatif** : +1,2 monstre corrompu (+20 %) et +3 tours. Une partie des tours en
  plus est mécanique (les vagues arrivent plus tard). La cause d'échec se déplace : l'équipe atteint plus souvent le
  tour de déverrouillage du Vortex avec des monstres non corrompus.
- Le −1 PM et le délai initial du poison ne sont pas mesurables sur 24 graines avec l'IA actuelle (non significatifs,
  dans un sens comme dans l'autre). Ce sont pourtant des faits de jeu (−1 PM) ou des hypothèses plausibles (poison).
- Le rang du boss ne change rien tant que l'IA n'atteint pas *Action !*.
- **Même corrigé, le modèle reste à 0 victoire et environ 7,4 monstres corrompus sur 19.** L'écart restant vient
  surtout de l'IA (§6).
- L'écart n° 4 (cases de l'horloge) n'est pas mesuré : il demande une modification du moteur (remappage de 4996).

## 8. Recommandation : quoi changer d'abord dans le modèle

1. **Cadence des vagues** : `arrivalRounds = [1, 7, 13, 19, 25]` par défaut ; supprimer les variantes
   `[1, 6, 11, 16, 21]` et `[1, 7, 12, 17, 22]` ; régler l'invariant avec `unlockVortexTurn` (retirer la variante 25).
   Gain attendu le plus fort (écart n° 1).
2. **Ressuscités à −1 PM** : `rezMinusOneMp = true` par défaut ; supprimer la variante `false`.
3. **Boss au rang 1 à 4 joueurs** : `bossGrade = clamp(players − 3, 1, 5)`, soit 15 000 PV à 4. Recalculer les prix
   de phase 2 (`burst.ts`, prix de victoire).
4. **Nettoyer `VORTEX_UNCERTAIN`** : retirer `rezHpPct = [50, 50]`. On peut ajouter `[20, 20]` (« 20 % » de la note de
   version) à côté du jet des données (20 à 30 %).
5. **Horloge** (après vérification en jeu ou sur une capture) : cases peintes du pourtour (+3 lignes) et suppression
   de `syncAuroraireCell`. Revoir `placement.ts` et `RED_CELLS_SAFE_K4`, qui deviennent presque toutes sûres.
6. Paramètres INCERTAINS à ajouter : `globalCooldownAtStart` (*Petit poison*, *Décollage*) et `patch: '3.6' | '3.7'`.
7. **Documentation** : corriger `vortex.md` §0, §4 et §14 (cadence, −1 PM confirmé, sources JOL et Tofus périmées),
   §1 (rang du boss), §2 (cases d'horloge, après vérification) ; `vortex.json` (`waves.arrivalRound`, `openQuestions`).

Ensuite, côté IA (hors périmètre du modèle, mais c'est là que reste l'essentiel de l'écart), suivre le plan des
joueurs :
- tuer toute la vague à ses 2e et 3e tours, puis retuer les zombies à leur heure ;
- en défense, retuer les zombies à chaque tour ;
- retirer des PM aux Méjaires ;
- en 3.6, porter des corrompus pour s'en faire des murs.

## 9. Sources

Notes de version et devblogs :
- Note de version 2.42, section Vortex (copies) : <https://rr-jiva.darkbb.com/t4259-change-log-2-42-devblog-simplification>,
  <https://forums.jeuxonline.info/showthread.php?t=1358346>, <https://www.millenium.org/guide/273667.html?page=10>
  (08/08/2017).
- Devblog officiel « Simplification du contenu haut niveau » :
  <https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/698902-simplification-contenu-haut-niveau> (texte cité
  d'après la copie rr-jiva ; dofus.com refuse l'accès automatisé).
- Devblog « Donjons modulaires » (2.7.0) : <https://dofus.jeuxonline.info/actualite/35775/devblog-donjons-modulaires>.
- Devblog « Dimensions divines » : <https://dofus.jeuxonline.info/actualite/43821/dimensions-divines-presentent>.
- DPLN, mise à jour 3.7 (bestiaire, rangs, Vortex) : <https://www.dofuspourlesnoobs.com/mise-a-jour-307.html>
  (04/10/2026) ; 3.6 (Vortex en Songes : changer d'heure en frappant l'Auroraire, sans rapport avec le donjon) :
  <https://www.dofuspourlesnoobs.com/mise-a-jour-306.html> ; pages DPLN 2.46, 2.49, 2.70 à 2.73, 3.1, 3.3 à 3.5
  relues, sans autre changement du donjon (seule la 3.1 touche la panoplie de Vortex).

Guides :
- DPLN (Arkaw, m.à.j. 24/08/2024) : <https://www.dofuspourlesnoobs.com/oeil-de-vortex.html> ; schémas
  `dj2-placement-frappe-auroraire_orig.png`, `dj2-zones-a-eviter-a-3-4-6_orig.png`.
- JOL (Kiwigae, 2016, m.à.j. 2019, antérieur à la 2.42 pour la cadence) :
  <https://dofus.jeuxonline.info/article/13603/il-vortex> ; schéma
  <https://jolstatic.fr/dofus/equipe/226595/Articles/Vortex/Aurorairee.bmp>.
- Gamosaurus (2021) : <https://www.gamosaurus.com/?p=61151>.
- Tofus (antérieur à la 2.42 : « tous les 5 tours », « moitié de sa vitalité ») : <https://www.tofus.fr/donjons/vortex.php>.
- dofus-portals (reformulation de DPLN) : <https://dofus-portals.fr/donjons/ail-de-vortex/>.
- next-stage (paraphrase de DPLN) : <https://www.next-stage.fr/2025/04/guide-dofus-strategies-vaincre-loeil-vortex-ses-succes.html>.
- guidedofus (ancienne copie de DPLN) : <https://www.guidedofus.com/v2/oeil-de-vortex>.

Vidéos (transcriptions YouTube) :
- HonnyTTV, « Tutoriel : VORTEX du PREMIER COUP ! » (21/08/2017, Panda/Crâ/Eni/Iop) :
  <https://www.youtube.com/watch?v=8jrZW5Ny5i8> (5:15–6:16 cadence et plan de vague ; 19:05 phase 2).
- Entraax, « TUTO VORTEX - TRIO+HARDI TECHNIQUE LOW COST » (31/03/2021, Sadida + Pandawa) :
  <https://www.youtube.com/watch?v=gIk9Y4c91c0> (6:03, 9:53, 11:22).
- Entraax, « VORTEX TRIO+HARDI AUTOWIN - PANDA SACRI » (16/03/2022) : <https://www.youtube.com/watch?v=PXMQxAKDE68>
  (4:08–4:26 corrompus en murs ; 7:30 Vortex tué en 3 ou 4 tours).

Données et dépôt :
- DofusDB (cache `.cache/vortex/`) : sorts 4996 (`cellIds` des heures), 5003 (780 « 20 à 30 % », 169 −1 PM), 5006
  (invocation sur 255), 5021 et 5032 (relances), monstres 3833 à 3839.
- `data/maps/annotations/143393281.json` et `docs/research/maps.md` (cases peintes de l'horloge) ; rendu
  `api.dofusdb.fr/img/maps/1/143393281.jpg`.
- Émulateur Stump 2.71, `SpellHistory.cs` (relance globale appliquée seulement après un lancer) :
  <https://github.com/Daymortel/Stump-2.71>.
