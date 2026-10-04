# Zobal — analyse complète pour DofusSimu (breed 14)

> « Guerrier lunatique ». Données : API DofusDB (fichiers du jeu Dofus 3, mises à jour 2026) — `breeds/14`,
> `spell-variants?breedId=14`, `spells`, `spell-levels`, `spell-states`, `monsters/5152` (Masque Grimaçant) et sorts cachés
> des types 1333 (« Sorts initiaux Zobal » : Le Masque du Zobal 18633), 610 (« Déclenchés Zobal »), 2441 (Masque Grimaçant).
> Cache : `.cache/classes/rzse/`. Rôles officiels : **Tank 7/10** (« utilise son masque de l’intrépide pour voler de la vie et
> maintenir ses adversaires au contact »), **Protection 7/10** (« applique des boucliers »), **Dégâts 7/10** (« masque du
> psychopathe »), Amélioration 6, Placement 5, Entrave 5, Invocation 1. Complexité 3/5.
> NB : le Zobal a été **refondu** (sorts aux noms de capoeira : Brincadeira, Parafuso, Martelo, Ginga…) — les guides antérieurs
> (Plastron/Boliche « ancienne version ») ne sont plus valables : seules les données du jeu font foi.

## 0. Règles moteur communes déduites des données (valables pour les 4 classes Roublard/Zobal/Steamer/Eliotrope)

1. **Sélection des cibles « instantanée »** : pour UN lancer de sort, les cibles de **tous** les effets (zone + masque, y compris
   les conditions d’état `E<id>`/`e<id>`) sont calculées **avant** d’appliquer le premier effet (port C# du client :
   `DamageCalculator.ExecuteSpell → GenerateTargets`, recalcul uniquement après un effet de résurrection). Preuves dans les
   données : la chaîne d’états Combo du Roublard (20497 : « applique Combo II si Combo I », puis « retire Combo I »…) ou
   l’Évolution du Steamer (pose « Évolution bloquée » puis teste « sans Évolution bloquée ») n’ont de sens qu’avec cette règle
   (sinon une bombe passerait de Combo I à XV en un lancer). Les **sous-sorts** (effets 1160, 792, 2794…) sont des lancers
   séparés : leurs cibles sont calculées au moment où l’effet parent est atteint, donc ils voient les effets déjà appliqués.
   ⚠ La fiche `cra.md` d’un autre agent suggère une évaluation au moment de l’application : à harmoniser (cette règle-ci est
   celle du code du client porté).
2. **Effets `forClientOnly = true`** : purement descriptifs (info-bulle). Ne jamais les exécuter ; le comportement réel est dans
   un sous-sort (souvent conditionnel). Exemple : « Rend 1 PA » d’Amarrage n’est réellement appliqué que si la cible est une
   tourelle (sous-sort 29587).
3. **Effets « lance un sort »** (diceNum = id du sort, diceSide = niveau) : 1160 `CasterExecuteSpell` / 2160 (limite globale)
   = le lanceur lance le sous-sort sur chaque cible ; 792 `TargetExecuteSpell` / 2792 = chaque cible le lance sur elle-même ;
   2794 `TargetExecuteSpellOnCell` / 2795 = la cible le lance sur sa cellule ; 2960 `CasterExecuteSpellOnCell` = le lanceur le
   lance sur la cellule d’impact ; 1017/2017 = la cible le lance sur le déclencheur ; 1018 = le déclencheur le lance sur la
   cible ; 1019 = le déclencheur sur lui-même. Les effets 3792/3793 (`ExecuteSpellScriptUsage`) sont visuels. `value = 999`
   apparaît sur certains de ces effets (sens INCERTAIN, sans impact connu).
4. **Masques de cibles** (`targetMask`, liste séparée par des virgules ; port C# `SpellManager.IsSelectedByMask`) :
   lettres **inclusives** (au moins une doit correspondre) : `a` alliés (lanceur compris), `g` alliés sauf lanceur, `A` ennemis,
   `c` lanceur s’il est dans la zone, `C` lanceur partout, `h/H` joueurs alliés/ennemis (non invoqués), `i/I` invocations non
   statiques, `j/J` invocations, `s/S` invocations statiques, `m/M` monstres non invoqués, `l/L` joueurs ou compagnons,
   `d/D` compagnons ; lettres **exclusives** (toutes doivent passer) : `E<n>`/`e<n>` a / n’a pas l’état n, `F<n>`/`f<n>` est / n’est
   pas le monstre n (plusieurs `F` = OU), `B<n>`/`b<n>` est / n’est pas la classe n, `P`/`p` est / n’est pas dans le groupe du
   lanceur (lui-même, ses invocations, les invocations du même invocateur, son invocateur), `R`/`r` sort lancé via / hors
   portail, `V<n>`/`v<n>` PV < n % / ≥ n %, `T` téléfraggé ce tour, `W` téléportation ratée, `K` porté/lancé, `Q`/`q` quota
   d’invocations atteint / non atteint, `O`/`o` = la cible déclenchante, `U/u` en apparition. Préfixe `*` = la condition porte
   sur le **lanceur** (ex. `*E98` = le lanceur est en Intrépide).
5. **Conditions de lancer** (`statesCriterion`) : `HS=<n>` le lanceur doit avoir l’état n, `HS!<n>` ne doit pas l’avoir,
   `|` = OU, `&` = ET.
6. **Déclencheurs** (`triggers`, séparés par `|`) : `I` immédiat ; `TB`/`TE` début/fin du tour du porteur ; `D` dommages subis ;
   `DM`/`DR` en mêlée/à distance ; `DBA` par un allié ; `X` mort, `XD` mort par dommages, `XPD` par poussée, `XDBA` tué par un
   allié ; `P` poussé, `MA` attiré, `M` déplacé, `MS` échange de position, `PD` dommages de poussée subis, `H` soigné, `PT`
   traverse un portail, `PST` projette un sort via un portail, `PDT` dommages subis via portail, `CI` invoque, `CT` tacle
   (INCERTAIN), `CPT` une entité traverse un portail du porteur (INCERTAIN), `CMPAS` tentative de retrait PM du lanceur
   (INCERTAIN), `EON<n>`/`EOFF<n>` l’état n est appliqué/retiré. Pour un effet déclenché, `effectTriggerDuration` = nombre de
   tours pendant lesquels le déclencheur reste posé sur la cible (affiché « déclencheur actif N tour(s) ») et `duration` = durée
   de l’effet produit à chaque déclenchement (0 = instantané).
7. **Zones** (`zoneDescr.shape` + param1 = rayon, param2 = rayon minimal) : P case, C cercle, X croix, + croix diagonale,
   * étoile (8 directions), Q/# croix sans centre (orthogonale/diagonale), L ligne depuis l’impact, l ligne depuis le lanceur,
   T/- barre perpendiculaire, O anneau, G/W carré (plein/contour), D damier, U demi-cercle, V cône, F fourche, B boomerang,
   R rectangle, A/a toute la carte. `damageDecreaseStepPercent` (10 % par défaut) = dégressivité par case pour les dommages de
   zone (certaines descriptions précisent « non dégressif »).
8. **Boucliers** (1020) = X % du niveau du lanceur ; **soins** 1109 = X % des PV max de la cible ; **2822/3002** = dommages /
   soins dans le **meilleur élément** du lanceur (caractéristique la plus haute).

## 1. Vue d’ensemble

- **Trois postures (masques)** qui conditionnent les sorts utilisables : **Intrépide** (état 98 — tank/protection : vols de
  vie, attirances, boucliers, +1 PA), **Psychopathe** (état 99 — dégâts au corps-à-corps : Inferno, Furia, +10 % dommages
  mêlée, +20 Tacle) et **Pleutre** (état 100 — entrave/distance : retraits PA/PM/PO, +1 PM, +40 Fuite). Le Zobal **commence
  le combat en Intrépide** (passif 18633). Changer de masque coûte 1 PA et applique aussi le bonus aux **alliés adjacents non-Zobal**.
- **Protection de groupe exceptionnelle** : boucliers en pourcentage du niveau (Plastron 600 % = 1 200 PV en cercle de 3,
  Ginga 720 %, Scudo 360 %, Tortoruga 300 % à 4–10 PO, Transe 450 %, Diffraction 450/250/50 % selon la distance — y compris
  sur les ennemis !).
- **Entrave** : Apathie -3 PM, Martelo -2 PM en zone, Picada/Rétention -2 PA, Brincadeira -4 PO, Ponteira -50 Dommages,
  Agular soins reçus ×75 %, Fougue Insoignable, Transfiguration (-20 % dommages finaux / -10 % résistances).
- **Dégâts** : Psychopathe (Inferno 41–45 Feu + 200 Puissance, Furia 35–39 Terre + 40 Dommages, Cavalcade 38–42 Air,
  Ronda 38–42 Terre anneau), Carnavalo (meilleur élément), Mascarade (25 % des PV ou des PV manquants, Neutre).
- **Placement** : Cavalcade/Reuche/Boliche (se rapprocher), Apostasie/Appui (reculer), Pivot/Cabriole (téléport symétrique),
  Débandade, Comédie, Parafuso/Ronda/Masque de l’Intrépide (attirances), Distance, Masque de l’Hystérique (repousse).
- **Invocation** : Masque Grimaçant (tacleur qui partage les dommages avec le Zobal et copie l’effet de son masque).


**Sorts disponibles selon le masque (`statesCriterion`)** :

| Sort (paire) | Intrépide (98) | Psychopathe (99) | Pleutre (100) |
|---|---|---|---|
| Brincadeira (1) | ✔ | | ✔ |
| Picada (1) | | | ✔ |
| Catalepsie (2) | ✔ | | |
| Apostasie (2) | | | ✔ |
| Parafuso (3) | ✔ | | |
| Martelo (3) | ✔ | | ✔ |
| Cavalcade (4) | ✔ | ✔ | |
| Appeau (4) | ✔ | | |
| Plastron (6) | ✔ | | |
| Ginga (6) | ✔ | | |
| Ponteira (9) | ✔ | | ✔ |
| Agular (9) | ✔ | | ✔ |
| Furia (11) | | ✔ | |
| Bocciara (11) | | ✔ | |
| Tortoruga (12) | | | ✔ |
| Armadur (12) | | | ✔ |
| Cabriole (13) | | ✔ | |
| Purgatorio (13) | ✔ | ✔ | |
| Débandade (14) | | | ✔ (et pas Pesanteur) |
| Comédie (14) | | | ✔ |
| Inferno (15) | | ✔ | |
| Distance (15) | | | ✔ |
| Reuche (16) | ✔ | ✔ | |
| Scudo (16) | ✔ | | |
| Apathie (17) | | | ✔ |
| Rétention (17) | ✔ | | |
| Boliche (18) | ✔ | ✔ | |
| Ronda (18) | ✔ | ✔ | |
| Transe (20) | | ✔ | |
| Névrose (20) | | ✔ | |

Sans condition de masque : les 6 masques (paires 5, 8, 10), Appui, Pivot (pas Pesanteur), Fougue, Mascarade, Grimace,
Diffraction, Carnavalo, Transfiguration.

## 2. Rôles en groupe PvM (niveau 200)

- **protection-bouclier** (priorité 1, élément(s) : -) — Plastron (1 200 PV de bouclier niv. 200 en cercle 3, 2 tours, relance 3), Ginga (1 440 + Indéplaçable), Scudo, Tortoruga (à distance), Transe, Diffraction (attention : protège aussi les ennemis proches). Le meilleur « absorbeur » de burst de groupe parmi ces 4 classes.
- **tank-contact** (priorité 2, élément(s) : Terre/Eau/Feu (vols de vie)) — Intrépide : vols de vie (Catalepsie, Parafuso, Appeau, Rétention), -40 Fuite en zone, attirances ; Psychopathe : +20 Tacle ; Masque Grimaçant tacleur.
- **soutien-PA-PM** (priorité 2, élément(s) : -) — Masques : +1 PA (Intrépide/Infatigable) ou +1 PM +40 Fuite (Pleutre) ou +10 % dégâts mêlée +20 Tacle (Psychopathe) ou +10 % distance +1 PO (Couard) ou +80 dommages de poussée (Hystérique) aux alliés adjacents (2 tours) ; Armadur +2 PM, Névrose +250 Puissance, Fougue Intaclable.
- **dps-melee** (priorité 3, élément(s) : Feu/Terre/Air (Psychopathe)) — Inferno ×2 (+200 Puissance auto) puis Furia / Cavalcade / Ronda.
- **entrave** (priorité 3, élément(s) : Terre/Air/Eau) — Pleutre : Apathie -3 PM, Picada -2 PA, Martelo -2 PM zone, Brincadeira -4 PO ; Rétention -2 PA (Intrépide) ; Ponteira -50 Dommages ; Agular/Fougue anti-soin.

## 3. Mécaniques de classe à implémenter (moteur)

### 3.1 Masques (états 98/99/100) et changement de masque

Les 6 sorts de masque (paires 5, 8, 10) coûtent 1 PA, relance 2 tours, 0 PO. Séquence à l’application : (1) sous-sort 18634 « Gestion des masques » : selon le masque ACTUEL, fixe à 1 tour la relance des deux sorts de ce masque, retire l’état actuel (98/99/100) et réduit de 1 tour la relance de Carnavalo et de Transfiguration ; (2) applique le nouvel état (infini, non désenvoûtable) ; (3) 18636 désenvoûte les bonus des masques dont le Zobal n’a plus l’état, sur lui et sur les alliés non-Zobal en croix r1 ; (4) 18637 change l’apparence ; (5) applique les bonus du nouveau masque : sur le Zobal (durée infinie = tant que le masque est porté) et sur les alliés en croix r1 hors Zobal et hors Masque Grimaçant (2 tours) ; (6) fait lancer au Masque Grimaçant sa version du masque. Bonus (niv. 200) : Intrépide +1 PA + attire de 2 en croix r3 ; Infatigable (variante, état Intrépide) bouclier 100 % du niveau + 1 PA ; Pleutre +1 PM +40 Fuite ; Couard (variante, état Pleutre) +10 % dommages distance +1 PO ; Psychopathe +10 % dommages mêlée +20 Tacle ; Hystérique (variante, état Psychopathe) +80 Dommages poussée + repousse de 1 les entités adjacentes. Au début du combat, le passif 18633 pose l’état Intrépide (sans les bonus du sort).

*Notes d’implémentation* : `mask ∈ {98,99,100}` stocké comme état. Conditions de lancer `statesCriterion` : `HS=98|HS=100` = le lanceur doit avoir l’état 98 OU 100 ; `HS!7` = ne pas avoir Pesanteur ; `&` = ET. Effet 1045 (relance fixée) sur les sorts de l’ancien masque. L’ordre des sous-sorts compte : les masques des effets de 18636 testent l’état APRÈS l’étape (2) (sous-sort = nouveau lancer).

### 3.2 Boucliers en % du niveau (effet 1020) et règle des invocations

Tous les boucliers du Zobal sont « X % du niveau du lanceur » (niv. 200 : 100 % = 200 PV). Les invocations reçoivent la moitié (lignes séparées dans les données, masque `i/j`). Diffraction : bouclier selon la distance au Zobal au moment du lancer (0–5 cases 450 %, 6–11 cases 250 %, 12+ 50 %), sur TOUTES les entités (alliés et ennemis), 2 tours ; mécanique implémentée par des états temporaires 2223/2224/2225 posés en anneaux puis lus.

*Notes d’implémentation* : Bouclier = PV temporaires absorbés avant les PV, durée en tours, non cumulable avec lui-même (cumul max 1 sur la plupart des sorts → remplacement). Diffraction : l’IA doit soustraire la valeur des boucliers donnés aux ennemis (score négatif).

### 3.3 Masque Grimaçant (invocation 5152)

Grimace (3 PA, PO 1, case libre, relance 2) invoque le Masque Grimaçant (grade 3 : 6 PA, 6 PM, 20 % de résistances, tacle, consomme un emplacement d’invocation). Son sort initial 13427 : **partage des dommages** avec le Zobal et ses alliés joueurs du groupe (effet 1061, état Sacrifice 583), +bouclier 120 % du niveau au Zobal et à lui-même quand il tacle un ennemi (déclencheur CT), réduit de 1 la portée minimale de Mascarade (pour pouvoir permuter à distance), et à sa mort fixe la relance de Grimace à 2. Il copie le masque : Intrépide = attire de 2 en croix r3 autour de lui ; Pleutre = +2 PM ; Psychopathe = repousse de 1 les adjacents. Relancer Grimace quand il est vivant le **téléporte** sur la case ciblée.

*Notes d’implémentation* : Effet 1061 `CharacterShareDamages` : INCERTAIN — répartir les dommages subis entre les entités liées (au prorata ? à parts égales ?) ; à défaut, partage à parts égales entre le Masque et le Zobal. L’IA du Masque : se placer au contact du plus de ennemis possible (tacle), il ne frappe pas.

### 3.4 Dommages basés sur les PV du lanceur (Mascarade)

Mascarade (3 PA, PO 1) : si le Zobal a ≥ 50 % de ses PV, la cible subit 25 % des PV actuels du Zobal (Neutre) et le Zobal subit 25 % de ses PV manquants ; sinon les effets sont inversés. Sur le lanceur (via le Masque Grimaçant) : échange de position avec le Masque.

*Notes d’implémentation* : Effets 89 (`LifePointsLostBasedOnCasterLife`) et 279 (`…CasterLifeMissing`). INCERTAIN : ces dommages ne sont pas augmentés par les caractéristiques (DamageSender.GetDamageBasedOnCasterLife multiplie la base par les PV) mais subissent les résistances Neutre.

### 3.5 Transfiguration et Carnavalo (sorts liés aux changements de masque)

Transfiguration (2 PA, relance 5) : état 4464/4465 sur le Zobal et l’ennemi ciblé (2 tours) ; applique selon le masque -20 % dommages finaux (Intrépide), -10 % résistance distance (Pleutre), -10 % résistance mêlée (Psychopathe) ; chaque changement de masque réapplique l’effet correspondant (déclencheurs EON98/99/100) et réduit la relance d’1 tour. Carnavalo (3 PA, relance 5) : bouclier 100 %/300 % (Intrépide), dommages meilleur élément 24–28 / 39–43 (Psychopathe), poussée 1/4 (Pleutre).

*Notes d’implémentation* : Déclencheur `EON<id>` = quand l’état id est appliqué sur le porteur. Le cumul de Transfiguration est partagé entre les trois effets (cumul max 1).

### 3.6 Débuffs particuliers

Ponteira -50 Dommages fixes (1 tour) ; Agular : état « soins reçus ×75 % » déclenché à chaque soin (zone cercle 2, n’affecte pas le lanceur) ; Fougue : Insoignable (76) sur un ennemi ou Intaclable (96) sur un allié ; Purgatorio : réduit la durée des effets de la cible d’1 tour (désenvoûtement partiel) ; Névrose : +250 Puissance à un allié et Pesanteur (7) sur la cible (empêche les échanges/téléportations).

*Notes d’implémentation* : 1159 `CharacterMultiplyReceivedHeal` en buff déclenché (H). 1075 `ShortenActiveEffectsDuration` : décrémente toutes les durées de buffs désenvoûtables de la cible.

### Invocations de la classe

| Monstre (id) | Grade utilisé | PA/PM | Rés. % | Joue ? | Emplacement | Notes |
|---|---|---|---|---|---|---|
| Masque Grimaçant (5152) | 3 | 6/6 | 20 partout | oui (IA, tacle) | invocation | PV : bonusCharacteristics.lifePoints 100 (INCERTAIN : 100 % des PV de base du Zobal) ; partage des dommages |


## 4. Fiches détaillées des 44 sorts (22 paires)

Légende : valeurs au **grade maximal accessible au niveau 200** (fichiers du jeu via DofusDB). « CC » = coup critique.
Les effets sont listés **dans l’ordre d’exécution** ; « ↳ » = effets d’un sous-sort lancé par l’effet précédent (le lanceur du
sous-sort est indiqué : « le lanceur lance » = effet 1160/2160, « la cible lance sur elle-même » = 792/2792,
« la cible lance sur sa cellule » = 2794/2795, « le lanceur lance sur la cellule ciblée » = 2960). Les masques de cibles sont
traduits : `a` = alliés (lanceur inclus), `g` = alliés sauf lanceur, `A` = ennemis, `C` = lanceur, `E<id>`/`e<id>` = cible
avec/sans état, `*…` = condition sur le lanceur, `F<id>`/`f<id>` = est/n’est pas le monstre <id>, `P`/`p` = (hors) groupe du
lanceur (lui + ses invocations), `r`/`R` = lancé hors/via un portail, `V<n>`/`v<n>` = PV < n % / ≥ n %. Les zones : « croix r1 » =
croix de rayon 1 (5 cases), « croix diagonale » = X, « ligne perpendiculaire r2 » = barre de 5 cases perpendiculaire au lancer,
« anneau r2 » = cercle de rayon 2 sans le centre, « (rayon min n) » = cases à distance < n exclues.

### Paire 1 — Brincadeira / Picada

#### Brincadeira (`13425`) — variante de base, débloqué niv. 1, grade 3

> Occasionne des dommages Feu et retire de la Portée.

- **2 PA**, PO 1–8 (modifiable), ligne de vue ; 4 lancer(s)/tour, 2/cible, cumul max 1, CC 5 %
- Condition de lancer (états du lanceur) : `HS=98|HS=100` — lanceur dans l'état « Intrépide » (98) OU lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Dommages Feu 13 à 15 — cibles: alliés/ennemis
  - -4 PO — cibles: alliés/ennemis; 1 tour
- Coup critique : Dommages Feu 16 à 18
- Grades : g1 (niv 1) vs g3: Dommages Feu 7 à 9 (g1) → Dommages Feu 13 à 15 (g3) ; -2 PO (g1) → -4 PO (g3) ; PO max 6 (g1) → 8 (g3) | g2 (niv 66) vs g3: Dommages Feu 10 à 12 (g2) → Dommages Feu 13 à 15 (g3) ; -3 PO (g2) → -4 PO (g3) ; PO max 7 (g2) → 8 (g3)
- Rôle : damage, range_removal
- **Analyse tactique** : 2 PA, 4/tour : Feu 13–15 et -4 PO (1 tour) ; contre les lanceurs à distance. Intrépide ou Pleutre.

#### Picada (`13405`) — variante alternative, débloqué niv. 95, grade 2

> Occasionne des dommages Air et retire des PA.

- **3 PA**, PO 2–6 (modifiable), lancer en ligne, sans ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 15 %
- Condition de lancer (états du lanceur) : `HS=100` — lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Dommages Air 25 à 28 — cibles: alliés/ennemis
  - -2 PA (esquivable) — cibles: alliés/ennemis; 1 tour
- Coup critique : Dommages Air 30 à 33
- Grades : g1 (niv 95) vs g2: Dommages Air 20 à 22 (g1) → Dommages Air 25 à 28 (g2) ; PO max 5 (g1) → 6 (g2)
- Rôle : ap_removal, damage
- **Analyse tactique** : Air 25–28 + -2 PA (esquivable), en ligne 2–6 sans LdV ; Pleutre.


### Paire 2 — Catalepsie / Apostasie

#### Catalepsie (`13420`) — variante de base, débloqué niv. 1, grade 3

> Vole de la vie dans l'élément Terre et retire de la Fuite en zone.

- **3 PA**, PO 0–0 (non modifiable), sans ligne de vue ; 2 lancer(s)/tour, cumul max 1, CC 15 %
- Condition de lancer (états du lanceur) : `HS=98` — lanceur dans l'état « Intrépide » (98)
- Effets exécutés :
  - Vol de vie Terre 23 à 25 — croix sans centre r1; cibles: alliés sauf lanceur/ennemis
  - -40 Fuite — croix sans centre r1; cibles: alliés sauf lanceur/ennemis; 1 tour
- Coup critique : Vol de vie Terre 28 à 30
- Grades : g1 (niv 1) vs g3: Vol de vie Terre 13 à 15 (g1) → Vol de vie Terre 23 à 25 (g3) ; -10 Fuite (g1) → -40 Fuite (g3) | g2 (niv 67) vs g3: Vol de vie Terre 18 à 20 (g2) → Vol de vie Terre 23 à 25 (g3) ; -20 Fuite (g2) → -40 Fuite (g3)
- Rôle : damage, dodge_debuff, lifesteal
- **Analyse tactique** : Vol de vie Terre en croix autour du Zobal (cases adjacentes) + -40 Fuite : sustain tank au milieu des ennemis.

#### Apostasie (`13421`) — variante alternative, débloqué niv. 100, grade 2

> Éloigne le lanceur de la cible, la repousse et occasionne des dommages Feu aux ennemis.

- **3 PA**, PO 1–6 (modifiable), lancer en ligne, en diagonale, ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 15 %
- Condition de lancer (états du lanceur) : `HS=100` — lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Le lanceur recule de 2 case(s) — cibles: alliés/ennemis
  - Repousse de 2 case(s) — cibles: alliés/ennemis
  - Dommages Feu 27 à 30 — cibles: ennemis
- Coup critique : Dommages Feu 32 à 36
- Grades : g1 (niv 100) vs g2: Dommages Feu 22 à 24 (g1) → Dommages Feu 27 à 30 (g2) ; PO max 5 (g1) → 6 (g2)
- Rôle : damage, push, self_move
- **Analyse tactique** : Recule le Zobal de 2 et repousse la cible de 2 + Feu 27–30 : désengagement.


### Paire 3 — Parafuso / Martelo

#### Parafuso (`13391`) — variante de base, débloqué niv. 1, grade 3

> Vole de la vie dans l'élément Eau aux ennemis et attire les cibles vers le centre en zone.

- **3 PA**, PO 0–5 (non modifiable), sans ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Condition de lancer (états du lanceur) : `HS=98` — lanceur dans l'état « Intrépide » (98)
- Effets exécutés :
  - Vol de vie Eau 21 à 24 — croix diagonale r1; cibles: ennemis
  - Attire de 1 case(s) — croix diagonale r1 (rayon min 1); cibles: alliés/ennemis
- Coup critique : Vol de vie Eau 25 à 29
- Grades : g1 (niv 1) vs g3: Vol de vie Eau 13 à 15 (g1) → Vol de vie Eau 21 à 24 (g3) | g2 (niv 68) vs g3: Vol de vie Eau 17 à 19 (g2) → Vol de vie Eau 21 à 24 (g3)
- Rôle : damage, lifesteal, pull
- **Analyse tactique** : Vol de vie Eau en X (diagonales) et attire d’1 vers le centre : regroupe autour d’une case.

#### Martelo (`13389`) — variante alternative, débloqué niv. 105, grade 2

> Occasionne des dommages Terre et retire des PM en zone.

- **3 PA**, PO 1–5 (modifiable), lancer en ligne, sans ligne de vue ; 2 lancer(s)/tour, cumul max 1, CC 10 %
- Condition de lancer (états du lanceur) : `HS=98|HS=100` — lanceur dans l'état « Intrépide » (98) OU lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Dommages Terre 22 à 25 — demi-cercle r1; cibles: alliés/ennemis
  - -2 PM (esquivable) — demi-cercle r1; cibles: alliés/ennemis; 1 tour
- Coup critique : Dommages Terre 26 à 30
- Grades : g1 (niv 105) vs g2: Dommages Terre 20 à 22 (g1) → Dommages Terre 22 à 25 (g2) ; PO max 4 (g1) → 5 (g2)
- Rôle : aoe, damage, mp_removal
- **Analyse tactique** : Terre 22–25 + -2 PM en demi-cercle r1 : entrave au contact (touche les alliés de la zone).


### Paire 4 — Cavalcade / Appeau

#### Cavalcade (`13415`) — variante de base, débloqué niv. 1, grade 3

> Rapproche le lanceur vers la cible et occasionne des dommages Air aux ennemis.

- **4 PA**, PO 1–5 (non modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 25 %
- Condition de lancer (états du lanceur) : `HS=98|HS=99` — lanceur dans l'état « Intrépide » (98) OU lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Le lanceur avance de 4 case(s) — cibles: ennemis/alliés
  - Dommages Air 38 à 42 — cibles: ennemis
- Coup critique : Dommages Air 46 à 50
- Grades : g1 (niv 1) vs g3: Dommages Air 23 à 25 (g1) → Dommages Air 38 à 42 (g3) | g2 (niv 69) vs g3: Dommages Air 30 à 33 (g2) → Dommages Air 38 à 42 (g3)
- Rôle : damage, self_move
- **Analyse tactique** : Avance de 4 + Air 38–42 (CC 46–50) : engagement + dégâts. Intrépide ou Psychopathe.

#### Appeau (`13408`) — variante alternative, débloqué niv. 110, grade 2

> Attire la cible et vole de la vie dans l'élément Feu aux ennemis.

- **3 PA**, PO 1–4 (non modifiable), sans ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 15 %
- Condition de lancer (états du lanceur) : `HS=98` — lanceur dans l'état « Intrépide » (98)
- Effets exécutés :
  - Attire de 3 case(s) — cibles: alliés/ennemis
  - Vol de vie Feu 24 à 28 — cibles: ennemis
- Coup critique : Vol de vie Feu 29 à 33
- Grades : g1 (niv 110) vs g2: Vol de vie Feu 20 à 23 (g1) → Vol de vie Feu 24 à 28 (g2)
- Rôle : damage, lifesteal, pull
- **Analyse tactique** : Attire de 3 + vol de vie Feu : ramène une cible au contact (et dans le Masque Grimaçant).


### Paire 5 — Masque de l'Intrépide / Masque de l'Infatigable

#### Masque de l'Intrépide (`13386`) — variante de base, débloqué niv. 5, grade 3

> Applique le Masque de l'Intrépide sur le lanceur : • Applique l'état Intrépide sur le lanceur. • Augmente les PA du lanceur et de ses alliés (hors Zobals) dans une croix d'une case. • Attire les entités vers le centre en zone.

- **1 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 2 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - la cible lance sur sa cellule « Gestion des masques » (18634) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : fixe à 1 tour la relance des sorts de l’ANCIEN masque, retire l’ancien état de masque et réduit d’1 tour la relance de Carnavalo et Transfiguration (cf. §3.1)
  - Applique l'état « Intrépide » (98) — cibles: lanceur; infini; non désenvoûtable
  - la cible lance sur sa cellule « Gestion des masques » (18636) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : désenvoûte les bonus de l’ancien masque sur le Zobal et sur les alliés non-Zobal adjacents
  - la cible lance sur sa cellule « Gestion des masques » (18637) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : change l’apparence du masque (visuel)
  - +1 PA — cibles: lanceur; infini
  - +1 PA — croix r1; cibles: alliés sauf lanceur [pas classe 14; ≠monstre Masque Grimaçant (5152)]; 2 tours
  - Attire de 2 case(s) — croix sans centre r3 (rayon min 1); cibles: alliés/ennemis
  - la cible lance sur elle-même « Masque de l'Intrépide » (28708) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; =monstre Masque Grimaçant (5152)]
    - ↳ Désenvoûte les effets du sort « Masque du Pleutre » (28599) — cibles: lanceur
    - ↳ Attire de 2 case(s) — croix sans centre r3; cibles: alliés/ennemis
- Grades : g1 (niv 5) vs g3: +1 PA : durée 1 (g1) → 2 (g3) ; Attire de 1 case(s) (g1) → Attire de 2 case(s) (g3) | g2 (niv 72) vs g3: +1 PA : durée 1 (g2) → 2 (g3)
- Rôle : ally_ap_buff, mask, pull, self_ap_buff
- **Analyse tactique** : Masque tank : +1 PA permanent au Zobal, +1 PA 2 tours aux alliés adjacents, attire les entités de la croix r3.

#### Masque de l'Infatigable (`13409`) — variante alternative, débloqué niv. 115, grade 2

> Applique le Masque de l'Infatigable sur le lanceur : • Applique un bouclier sur le lanceur. • Augmente les PA du lanceur et de ses alliés (hors Zobals) en zone.

- **1 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 2 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - la cible lance sur sa cellule « Gestion des masques » (18634) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : fixe à 1 tour la relance des sorts de l’ANCIEN masque, retire l’ancien état de masque et réduit d’1 tour la relance de Carnavalo et Transfiguration (cf. §3.1)
  - Applique l'état « Intrépide » (98) — cibles: lanceur; infini; non désenvoûtable
  - la cible lance sur sa cellule « Gestion des masques » (18636) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : désenvoûte les bonus de l’ancien masque sur le Zobal et sur les alliés non-Zobal adjacents
  - la cible lance sur sa cellule « Gestion des masques » (18637) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : change l’apparence du masque (visuel)
  - Bouclier = 100% du niveau du lanceur — cibles: lanceur; infini
  - +1 PA — cibles: lanceur; infini
  - +1 PA — croix r1; cibles: alliés sauf lanceur [pas classe 14; ≠monstre Masque Grimaçant (5152)]; 2 tours
  - la cible lance sur elle-même « Masque de l'Intrépide » (28708) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; =monstre Masque Grimaçant (5152)]
    - ↳ Désenvoûte les effets du sort « Masque du Pleutre » (28599) — cibles: lanceur
    - ↳ Attire de 2 case(s) — croix sans centre r3; cibles: alliés/ennemis
- Grades : g1 (niv 115) vs g2: Bouclier = 75% du niveau du lanceur (g1) → Bouclier = 100% du niveau du lanceur (g2)
- Rôle : ally_ap_buff, mask, pull, self_ap_buff, shield
- **Analyse tactique** : Variante : bouclier 200 PV + 1 PA (pas d’attirance) — plus sûr.


### Paire 6 — Plastron / Ginga

#### Plastron (`13397`) — variante de base, débloqué niv. 10, grade 3

> Applique un bouclier sur les alliés en zone. Le bouclier est réduit de moitié sur les invocations.

- **4 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 3 tour(s), cumul max 1, CC 25 %
- Condition de lancer (états du lanceur) : `HS=98` — lanceur dans l'état « Intrépide » (98)
- Effets exécutés :
  - Bouclier = 600% du niveau du lanceur — cercle r3; cibles: alliés joueurs/compagnons/monstres alliés/lanceur(si dans zone); 2 tours
  - Bouclier = 300% du niveau du lanceur — cercle r3; cibles: invocs alliées; 2 tours
- Coup critique : Bouclier = 720% du niveau du lanceur ; Bouclier = 360% du niveau du lanceur
- Grades : g1 (niv 10) vs g3: Bouclier = 500% du niveau du lanceur (g1) → Bouclier = 600% du niveau du lanceur (g3) ; Bouclier = 250% du niveau du lanceur (g1) → Bouclier = 300% du niveau du lanceur (g3) | g2 (niv 77) vs g3: Bouclier = 550% du niveau du lanceur (g2) → Bouclier = 600% du niveau du lanceur (g3) ; Bouclier = 275% du niveau du lanceur (g2) → Bouclier = 300% du niveau du lanceur (g3)
- Rôle : shield
- **Analyse tactique** : LE sort de protection : 1 200 PV de bouclier (niv. 200) à tous les alliés dans un cercle de 3 autour du Zobal, 2 tours, relance 3. Intrépide.

#### Ginga (`13417`) — variante alternative, débloqué niv. 120, grade 2

> Applique un bouclier sur l'allié ciblé et rend la cible Indéplaçable. Le bouclier est réduit de moitié sur les invocations.

- **2 PA**, PO 0–4 (non modifiable), ligne de vue ; relance 3 tour(s), cumul max 1, CC 25 %
- Condition de lancer (états du lanceur) : `HS=98` — lanceur dans l'état « Intrépide » (98)
- Effets exécutés :
  - Bouclier = 720% du niveau du lanceur — cibles: alliés joueurs/compagnons/monstres alliés/lanceur(si dans zone); 1 tour
  - Bouclier = 360% du niveau du lanceur — cibles: invocs alliées; 1 tour
  - Applique l'état « Indéplaçable » (97) — cibles: alliés/ennemis; 1 tour
- Coup critique : Bouclier = 840% du niveau du lanceur ; Bouclier = 420% du niveau du lanceur
- Grades : g1 (niv 120) vs g2: Bouclier = 600% du niveau du lanceur (g1) → Bouclier = 720% du niveau du lanceur (g2) ; Bouclier = 300% du niveau du lanceur (g1) → Bouclier = 360% du niveau du lanceur (g2)
- Rôle : immovable, shield
- **Analyse tactique** : 1 440 PV de bouclier mono-cible + Indéplaçable, 2 PA, relance 3. Intrépide.


### Paire 7 — Appui / Pivot

#### Appui (`13403`) — variante de base, débloqué niv. 15, grade 3

> Éloigne le lanceur de la cible et occasionne des dommages Feu, Terre, Eau et Air aux ennemis et repousse la cible.

- **3 PA**, PO 1–1 (non modifiable), ligne de vue ; relance 2 tour(s), CC 10 %
- Effets exécutés :
  - Le lanceur recule de 3 case(s) — cibles: alliés/ennemis
  - Dommages Feu 8 à 9 — cibles: ennemis
  - Dommages Terre 8 à 9 — cibles: ennemis
  - Dommages Eau 8 à 9 — cibles: ennemis
  - Dommages Air 8 à 9 — cibles: ennemis
  - Repousse de 3 case(s) — cibles: alliés/ennemis
- Coup critique : Dommages Feu 10 à 11 ; Dommages Terre 10 à 11 ; Dommages Eau 10 à 11 ; Dommages Air 10 à 11
- Grades : g1 (niv 15) vs g3: Le lanceur recule de 2 case(s) (g1) → Le lanceur recule de 3 case(s) (g3) ; Dommages Feu 6 à 7 (g1) → Dommages Feu 8 à 9 (g3) ; Dommages Terre 6 à 7 (g1) → Dommages Terre 8 à 9 (g3) ; Dommages Eau 6 à 7 (g1) → Dommages Eau 8 à 9 (g3) ; Dommages Air 6 à 7 (g1) → Dommages Air 8 à 9 (g3) | g2 (niv 82) vs g3: Le lanceur recule de 2 case(s) (g2) → Le lanceur recule de 3 case(s) (g3) ; Dommages Feu 7 à 8 (g2) → Dommages Feu 8 à 9 (g3) ; Dommages Terre 7 à 8 (g2) → Dommages Terre 8 à 9 (g3) ; Dommages Eau 7 à 8 (g2) → Dommages Eau 8 à 9 (g3) ; Dommages Air 7 à 8 (g2) → Dommages Air 8 à 9 (g3)
- Rôle : damage, push, self_move
- **Analyse tactique** : Mêlée : recule de 3, 4 éléments 8–9 chacun, repousse de 3 la cible (6 cases d’écart).

#### Pivot (`13410`) — variante alternative, débloqué niv. 125, grade 2

> Téléporte le lanceur symétriquement par rapport à la cible.

- **2 PA**, PO 1–1 (non modifiable), lancer en ligne, en diagonale, ligne de vue, case occupée ; 1 lancer(s)/tour, CC 0 %
- Condition de lancer (états du lanceur) : `HS!7` — lanceur PAS dans l'état « Pesanteur » (7)
- Effets exécutés :
  - Téléportation symétrique par rapport à la cible — cibles: lanceur
- Grades : g1 (niv 125) vs g2: relance 2 (g1) → 0 (g2) ; lancers/tour 0 (g1) → 1 (g2)
- Rôle : teleport
- **Analyse tactique** : Téléport symétrique par rapport à une entité adjacente (passer derrière la cible / se dégager).


### Paire 8 — Masque du Pleutre / Masque du Couard

#### Masque du Pleutre (`13387`) — variante de base, débloqué niv. 20, grade 3

> Applique le Masque du Pleutre sur le lanceur : • Applique l'état Pleutre sur le lanceur. • Augmente les PM et la Fuite du lanceur et de ses alliés (hors Zobals) en zone.

- **1 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 2 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - la cible lance sur sa cellule « Gestion des masques » (18634) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : fixe à 1 tour la relance des sorts de l’ANCIEN masque, retire l’ancien état de masque et réduit d’1 tour la relance de Carnavalo et Transfiguration (cf. §3.1)
  - Applique l'état « Pleutre » (100) — cibles: lanceur; infini; non désenvoûtable
  - la cible lance sur sa cellule « Gestion des masques » (18636) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : désenvoûte les bonus de l’ancien masque sur le Zobal et sur les alliés non-Zobal adjacents
  - la cible lance sur sa cellule « Gestion des masques » (18637) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : change l’apparence du masque (visuel)
  - +1 PM — cibles: lanceur; infini
  - +40 Fuite — cibles: lanceur; infini
  - +1 PM — croix r1; cibles: alliés sauf lanceur [pas classe 14; ≠monstre Masque Grimaçant (5152)]; 2 tours
  - +40 Fuite — croix r1; cibles: alliés sauf lanceur [pas classe 14; ≠monstre Masque Grimaçant (5152)]; 2 tours
  - la cible lance sur elle-même « Masque du Pleutre » (28599) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; =monstre Masque Grimaçant (5152)]
    - ↳ +2 PM — cibles: alliés/ennemis; infini
- Grades : g1 (niv 20) vs g3: +20 Fuite (g1) → +40 Fuite (g3) ; +20 Fuite (g1) → +40 Fuite (g3) | g2 (niv 87) vs g3: +30 Fuite (g2) → +40 Fuite (g3) ; +30 Fuite (g2) → +40 Fuite (g3)
- Rôle : ally_dodge_buff, ally_mp_buff, mask, self_dodge_buff, self_mp_buff
- **Analyse tactique** : Masque d’entrave/fuite : +1 PM +40 Fuite au Zobal et aux adjacents.

#### Masque du Couard (`13406`) — variante alternative, débloqué niv. 130, grade 2

> Applique le Masque du Couard sur le lanceur : • Augmente les dommages à distance et la Portée du lanceur et de ses alliés (hors Zobals) en zone.

- **1 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 2 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - la cible lance sur sa cellule « Gestion des masques » (18634) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : fixe à 1 tour la relance des sorts de l’ANCIEN masque, retire l’ancien état de masque et réduit d’1 tour la relance de Carnavalo et Transfiguration (cf. §3.1)
  - Applique l'état « Pleutre » (100) — cibles: lanceur; infini; non désenvoûtable
  - la cible lance sur sa cellule « Gestion des masques » (18636) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : désenvoûte les bonus de l’ancien masque sur le Zobal et sur les alliés non-Zobal adjacents
  - la cible lance sur sa cellule « Gestion des masques » (18637) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : change l’apparence du masque (visuel)
  - +10% Dommages distance — cibles: lanceur; infini
  - +1 PO — cibles: lanceur; infini
  - +10% Dommages distance — croix r1; cibles: alliés sauf lanceur [pas classe 14; ≠monstre Masque Grimaçant (5152)]; 2 tours
  - +1 PO — croix r1; cibles: alliés sauf lanceur [pas classe 14; ≠monstre Masque Grimaçant (5152)]; 2 tours
  - la cible lance sur elle-même « Masque du Pleutre » (28599) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; =monstre Masque Grimaçant (5152)]
    - ↳ +2 PM — cibles: alliés/ennemis; infini
- Grades : g1 (niv 130) vs g2: +7% Dommages distance (g1) → +10% Dommages distance (g2) ; +7% Dommages distance (g1) → +10% Dommages distance (g2)
- Rôle : ally_mp_buff, ally_range_buff, ally_range_damage_buff, mask, self_range_buff, self_range_damage_buff
- **Analyse tactique** : Variante distance : +10 % dommages distance +1 PO au Zobal et aux adjacents — bon buff pour un allié DPS distance collé au Zobal.


### Paire 9 — Ponteira / Agular

#### Ponteira (`13422`) — variante de base, débloqué niv. 25, grade 3

> Occasionne des dommages Eau et retire des Dommages.

- **3 PA**, PO 1–7 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 10 %
- Condition de lancer (états du lanceur) : `HS=98|HS=100` — lanceur dans l'état « Intrépide » (98) OU lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Dommages Eau 23 à 26 — cibles: alliés/ennemis
  - -50 Dommages — cibles: alliés/ennemis; 1 tour
- Coup critique : Dommages Eau 28 à 31
- Grades : g1 (niv 25) vs g3: Dommages Eau 14 à 16 (g1) → Dommages Eau 23 à 26 (g3) ; -20 Dommages (g1) → -50 Dommages (g3) ; PO max 5 (g1) → 7 (g3) | g2 (niv 92) vs g3: Dommages Eau 19 à 21 (g2) → Dommages Eau 23 à 26 (g3) ; -35 Dommages (g2) → -50 Dommages (g3) ; PO max 6 (g2) → 7 (g3)
- Rôle : damage, damage_debuff
- **Analyse tactique** : Eau 23–26 et -50 Dommages (1 tour) : réduit les frappes d’un monstre (fixes).

#### Agular (`13407`) — variante alternative, débloqué niv. 135, grade 1

> Réduit les soins reçus par les cibles et occasionne des dommages Air en zone. N'affecte pas le lanceur.

- **4 PA**, PO 0–6 (modifiable), ligne de vue ; 2 lancer(s)/tour, cumul max 1, CC 15 %
- Condition de lancer (états du lanceur) : `HS=98|HS=100` — lanceur dans l'état « Intrépide » (98) OU lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Soins reçus x75% — cercle r2; cibles: alliés sauf lanceur/ennemis; déclenché quand le porteur est soigné (déclencheur actif 1 tour(s))
  - Dommages Air 30 à 34 — cercle r2; cibles: alliés sauf lanceur/ennemis
- Coup critique : Dommages Air 36 à 41
- Rôle : aoe, damage, heal_modifier
- **Analyse tactique** : Air 30–34 en cercle 2 (pas le lanceur, touche les alliés !) + soins reçus ×75 % : anti-soin de zone.


### Paire 10 — Masque du Psychopathe / Masque de l'Hystérique

#### Masque du Psychopathe (`13388`) — variante de base, débloqué niv. 30, grade 3

> Applique le Masque du Psychopathe sur le lanceur : • Applique l'état Psychopathe sur le lanceur. • Augmente les dommages en mêlée et le Tacle du lanceur et de ses alliés (hors Zobals) en zone.

- **1 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 2 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - la cible lance sur sa cellule « Gestion des masques » (18634) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : fixe à 1 tour la relance des sorts de l’ANCIEN masque, retire l’ancien état de masque et réduit d’1 tour la relance de Carnavalo et Transfiguration (cf. §3.1)
  - Applique l'état « Psychopathe » (99) — cibles: lanceur; infini; non désenvoûtable
  - la cible lance sur sa cellule « Gestion des masques » (18636) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : désenvoûte les bonus de l’ancien masque sur le Zobal et sur les alliés non-Zobal adjacents
  - la cible lance sur sa cellule « Gestion des masques » (18637) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : change l’apparence du masque (visuel)
  - +10% Dommages mêlée — cibles: lanceur; infini
  - +20 Tacle — cibles: lanceur; infini
  - +10% Dommages mêlée — croix r1; cibles: alliés sauf lanceur [pas classe 14; ≠monstre Masque Grimaçant (5152)]; 2 tours
  - +20 Tacle — croix r1; cibles: alliés sauf lanceur [pas classe 14; ≠monstre Masque Grimaçant (5152)]; 2 tours
  - la cible lance sur elle-même « Masque du Psychopathe » (28707) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; =monstre Masque Grimaçant (5152)]
    - ↳ Désenvoûte les effets du sort « Masque du Pleutre » (28599) — cibles: lanceur
    - ↳ Repousse de 1 case(s) — croix sans centre r1; cibles: alliés/ennemis
- Grades : g1 (niv 30) vs g3: +7% Dommages mêlée (g1) → +10% Dommages mêlée (g3) ; +10 Tacle (g1) → +20 Tacle (g3) ; +7% Dommages mêlée (g1) → +10% Dommages mêlée (g3) ; +10 Tacle (g1) → +20 Tacle (g3) | g2 (niv 97) vs g3: +7% Dommages mêlée (g2) → +10% Dommages mêlée (g3) ; +15 Tacle (g2) → +20 Tacle (g3) ; +7% Dommages mêlée (g2) → +10% Dommages mêlée (g3) ; +15 Tacle (g2) → +20 Tacle (g3)
- Rôle : ally_melee_damage_buff, ally_tackle_buff, mask, push, self_melee_damage_buff, self_tackle_buff
- **Analyse tactique** : Masque DPS : +10 % dommages mêlée +20 Tacle au Zobal et aux adjacents (Iop/Sacrieur/Ouginak au contact).

#### Masque de l'Hystérique (`13414`) — variante alternative, débloqué niv. 140, grade 1

> Applique le Masque de l'Hystérique sur le lanceur : • Augmente les Dommages Poussée du lanceur et de ses alliés (hors Zobals) en zone. • Repousse les cibles en zone.

- **1 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 2 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - la cible lance sur sa cellule « Gestion des masques » (18634) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : fixe à 1 tour la relance des sorts de l’ANCIEN masque, retire l’ancien état de masque et réduit d’1 tour la relance de Carnavalo et Transfiguration (cf. §3.1)
  - Applique l'état « Psychopathe » (99) — cibles: lanceur; infini; non désenvoûtable
  - la cible lance sur sa cellule « Gestion des masques » (18636) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : désenvoûte les bonus de l’ancien masque sur le Zobal et sur les alliés non-Zobal adjacents
  - la cible lance sur sa cellule « Gestion des masques » (18637) niv.1 — cibles: lanceur
    - ↳ Gestion des masques : change l’apparence du masque (visuel)
  - +80 Dommages de poussée — cibles: lanceur; infini
  - +80 Dommages de poussée — croix r1; cibles: alliés sauf lanceur [pas classe 14; ≠monstre Masque Grimaçant (5152)]; 2 tours
  - Repousse de 1 case(s) — croix sans centre r1 (rayon min 1); cibles: alliés/ennemis
  - la cible lance sur elle-même « Masque du Psychopathe » (28707) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; =monstre Masque Grimaçant (5152)]
    - ↳ Désenvoûte les effets du sort « Masque du Pleutre » (28599) — cibles: lanceur
    - ↳ Repousse de 1 case(s) — croix sans centre r1; cibles: alliés/ennemis
- Rôle : ally_push_damage_buff, mask, push, self_push_damage_buff
- **Analyse tactique** : Variante : +80 Dommages poussée + repousse de 1 les adjacents : combo avec Apostasie/Distance/Appui.


### Paire 11 — Furia / Bocciara

#### Furia (`13394`) — variante de base, débloqué niv. 35, grade 3

> Occasionne des dommages Terre et augmente les Dommages du lanceur. Les dommages n'affectent pas le lanceur.

- **3 PA**, PO 0–3 (non modifiable), lancer en ligne, ligne de vue, case occupée ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 25 %
- Condition de lancer (états du lanceur) : `HS=99` — lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Dommages Terre 35 à 39 — cibles: alliés sauf lanceur/ennemis
  - +40 Dommages — cibles: lanceur; 2 tours
- Coup critique : Dommages Terre 42 à 47
- Grades : g1 (niv 35) vs g3: Dommages Terre 21 à 23 (g1) → Dommages Terre 35 à 39 (g3) ; +20 Dommages (g1) → +40 Dommages (g3) | g2 (niv 102) vs g3: Dommages Terre 28 à 31 (g2) → Dommages Terre 35 à 39 (g3) ; +30 Dommages (g2) → +40 Dommages (g3)
- Rôle : damage, self_damage_buff
- **Analyse tactique** : Terre 35–39 + 40 Dommages (2 tours, non cumulable) ; Psychopathe, PO 0–3 en ligne.

#### Bocciara (`13419`) — variante alternative, débloqué niv. 145, grade 1

> Occasionne des dommages Eau aux ennemis et augmente les Dommages Poussée du lanceur. Les dommages n'affectent pas le lanceur.

- **2 PA**, PO 0–5 (non modifiable), ligne de vue, case occupée ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 10 %
- Condition de lancer (états du lanceur) : `HS=99` — lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Dommages Eau 19 à 22 — cibles: alliés sauf lanceur/ennemis
  - +80 Dommages de poussée — cibles: lanceur; 2 tours
- Coup critique : Dommages Eau 23 à 26
- Rôle : damage, self_push_damage_buff
- **Analyse tactique** : Eau 19–22 (2 PA) + 80 Dommages poussée (2 tours).


### Paire 12 — Tortoruga / Armadur

#### Tortoruga (`13398`) — variante de base, débloqué niv. 40, grade 3

> Applique un bouclier sur l'allié ciblé. Le bouclier est réduit de moitié sur les invocations.

- **3 PA**, PO 4–10 (modifiable), sans ligne de vue ; 4 lancer(s)/tour, 1/cible, cumul max 1, CC 15 %
- Condition de lancer (états du lanceur) : `HS=100` — lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Bouclier = 300% du niveau du lanceur — cibles: alliés joueurs/compagnons/monstres alliés/lanceur(si dans zone); 3 tours
  - Bouclier = 150% du niveau du lanceur — cibles: invocs alliées; 3 tours
- Coup critique : Bouclier = 360% du niveau du lanceur ; Bouclier = 180% du niveau du lanceur
- Grades : g1 (niv 40) vs g3: PO max 6 (g1) → 10 (g3) ; lancers/tour 2 (g1) → 4 (g3) | g2 (niv 107) vs g3: PO max 8 (g2) → 10 (g3) ; lancers/tour 3 (g2) → 4 (g3)
- Rôle : shield
- **Analyse tactique** : Bouclier 600 PV à 4–10 PO (sans LdV), 4/tour au niveau 174+ (1/cible) : protège les alliés éloignés. Pleutre.

#### Armadur (`13411`) — variante alternative, débloqué niv. 150, grade 1

> Augmente les PM et la Fuite de l'allié ciblé.

- **2 PA**, PO 3–7 (modifiable), sans ligne de vue ; 2 lancer(s)/tour, 1/cible, cumul max 1, CC 0 %
- Condition de lancer (états du lanceur) : `HS=100` — lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - +2 PM — cibles: alliés; 2 tours
  - +40 Fuite — cibles: alliés; 2 tours
- Rôle : ally_dodge_buff, ally_mp_buff
- **Analyse tactique** : +2 PM +40 Fuite (2 tours) à un allié à 3–7 PO. Pleutre.


### Paire 13 — Cabriole / Purgatorio

#### Cabriole (`13395`) — variante de base, débloqué niv. 45, grade 3

> Téléporte le lanceur sur la case ciblée ou symétriquement par rapport à la cible et occasionne des dommages Air aux ennemis en zone. Les dommages de zone ne sont pas dégressifs.

- **3 PA**, PO 0–1 (non modifiable), lancer en ligne, en diagonale, ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Condition de lancer (états du lanceur) : `HS=99` — lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Téléporte le lanceur sur la case ciblée — cibles: alliés sauf lanceur/ennemis [lanceur sans état « Pesanteur » (7)]
  - le lanceur lance « Cabriole » (26216) niv.1 — cibles: alliés sauf lanceur/ennemis
    - ↳ Téléportation symétrique par rapport à la cible — cibles: lanceur
  - Dommages Air 31 à 35 — croix r1; cibles: ennemis
- Coup critique : Dommages Air 37 à 42
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Téléportation symétrique par rapport à la cible — cibles: alliés sauf lanceur/ennemis
- Grades : g1 (niv 45) vs g3: Dommages Air 20 à 23 (g1) → Dommages Air 31 à 35 (g3) | g2 (niv 112) vs g3: Dommages Air 26 à 29 (g2) → Dommages Air 31 à 35 (g3)
- Rôle : aoe, damage, teleport
- **Analyse tactique** : Téléporte sur la case (ou derrière la cible) + Air 31–35 en croix non dégressif.

#### Purgatorio (`14682`) — variante alternative, débloqué niv. 155, grade 1

> Réduit la durée des effets sur la cible et occasionne des dommages Feu aux ennemis.

- **3 PA**, PO 0–3 (non modifiable), ligne de vue ; 1 lancer(s)/tour, CC 20 %
- Condition de lancer (états du lanceur) : `HS=98|HS=99` — lanceur dans l'état « Intrépide » (98) OU lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Réduit la durée des effets de 1 tour(s) — cibles: alliés/ennemis
  - Dommages Feu 32 à 36 — cibles: ennemis
- Coup critique : Dommages Feu 38 à 43
- Rôle : damage, shorten_effects
- **Analyse tactique** : Feu 32–36 + réduit la durée des effets de la cible d’1 tour ; 1/tour.


### Paire 14 — Débandade / Comédie

#### Débandade (`13401`) — variante de base, débloqué niv. 50, grade 3

> Téléporte le lanceur sur la case ciblée et augmente ses PM.

- **2 PA**, PO 1–1 (non modifiable), lancer en ligne, ligne de vue, case libre ; 2 lancer(s)/tour, CC 0 %
- Condition de lancer (états du lanceur) : `HS=100&HS!7` — lanceur dans l'état « Pleutre » (100) ET lanceur PAS dans l'état « Pesanteur » (7)
- Effets exécutés :
  - Téléporte le lanceur sur la case ciblée — cibles: alliés/ennemis
  - +1 PM — cibles: lanceur; 1 tour
- Grades : g1 (niv 50) vs g3: relance 2 (g1) → 0 (g3) ; lancers/tour 0 (g1) → 2 (g3) | g2 (niv 117) vs g3: relance 1 (g2) → 0 (g3) ; lancers/tour 0 (g2) → 2 (g3)
- Rôle : self_mp_buff, teleport
- **Analyse tactique** : Téléporte d’1 case en ligne +1 PM ; 2/tour au niv. 184 : mobilité Pleutre.

#### Comédie (`13418`) — variante alternative, débloqué niv. 160, grade 1

> Téléporte les cibles symétriquement par rapport au centre puis les repousse en zone.

- **2 PA**, PO 0–6 (modifiable), ligne de vue, case occupée ; 1 lancer(s)/tour, CC 0 %
- Condition de lancer (états du lanceur) : `HS=100` — lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Téléportation symétrique par rapport au point d'impact — croix sans centre r1; cibles: alliés/ennemis
  - le lanceur lance « Comédie » (32163) niv.1 — cibles: alliés/ennemis
    - ↳ Repousse de 3 case(s) — croix sans centre r1; cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Repousse de 3 case(s) — croix sans centre r1; cibles: alliés/ennemis
- Rôle : push, teleport
- **Analyse tactique** : Téléport symétrique des entités adjacentes à la cible puis repousse 3 : désorganise un groupe ennemi.


### Paire 15 — Inferno / Distance

#### Inferno (`13423`) — variante de base, débloqué niv. 55, grade 3

> Occasionne des dommages Feu et augmente la Puissance du lanceur. Les dommages n'affectent pas le lanceur.

- **4 PA**, PO 0–4 (non modifiable), ligne de vue, case occupée ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 25 %
- Condition de lancer (états du lanceur) : `HS=99` — lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Dommages Feu 41 à 45 — cibles: alliés sauf lanceur/ennemis
  - +200 Puissance — cibles: lanceur; 2 tours
- Coup critique : Dommages Feu 49 à 54
- Grades : g1 (niv 55) vs g3: Dommages Feu 27 à 29 (g1) → Dommages Feu 41 à 45 (g3) ; +100 Puissance (g1) → +200 Puissance (g3) | g2 (niv 122) vs g3: Dommages Feu 36 à 39 (g2) → Dommages Feu 41 à 45 (g3) ; +150 Puissance (g2) → +200 Puissance (g3)
- Rôle : damage, self_power_buff
- **Analyse tactique** : Feu 41–45 (CC 49–54) + 200 Puissance (2 tours, cumul 1) ; le 2e lancer du tour profite déjà du bonus. Psychopathe.

#### Distance (`13392`) — variante alternative, débloqué niv. 165, grade 1

> Occasionne des dommages Eau aux ennemis et repousse la cible.

- **3 PA**, PO 2–8 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Condition de lancer (états du lanceur) : `HS=100` — lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Dommages Eau 28 à 30 — cibles: ennemis
  - Repousse de 3 case(s) — cibles: alliés/ennemis
- Coup critique : Dommages Eau 33 à 36
- Rôle : damage, push
- **Analyse tactique** : Eau 28–30 + repousse 3 (2–8 PO en ligne) : garder un ennemi à distance.


### Paire 16 — Reuche / Scudo

#### Reuche (`13400`) — variante de base, débloqué niv. 60, grade 3

> Rapproche le lanceur vers la cible.

- **2 PA**, PO 2–8 (non modifiable), lancer en ligne, ligne de vue, case occupée ; 1/cible, CC 0 %
- Condition de lancer (états du lanceur) : `HS=98|HS=99` — lanceur dans l'état « Intrépide » (98) OU lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Le lanceur avance de 7 case(s) — cibles: alliés/ennemis
- Grades : g1 (niv 60) vs g3: Le lanceur avance de 5 case(s) (g1) → Le lanceur avance de 7 case(s) (g3) ; PO max 6 (g1) → 8 (g3) | g2 (niv 127) vs g3: Le lanceur avance de 6 case(s) (g2) → Le lanceur avance de 7 case(s) (g3) ; PO max 7 (g2) → 8 (g3)
- Rôle : self_move
- **Analyse tactique** : Avance de 7 cases vers la cible (2–8 en ligne) : la meilleure mobilité offensive.

#### Scudo (`13412`) — variante alternative, débloqué niv. 170, grade 1

> Applique un bouclier sur l'allié ciblé. Le bouclier est réduit de moitié sur les invocations.

- **3 PA**, PO 1–2 (non modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, cumul max 1, CC 15 %
- Condition de lancer (états du lanceur) : `HS=98` — lanceur dans l'état « Intrépide » (98)
- Effets exécutés :
  - Bouclier = 360% du niveau du lanceur — cibles: alliés joueurs/compagnons/monstres alliés/lanceur(si dans zone); 2 tours
  - Bouclier = 180% du niveau du lanceur — cibles: invocs alliées; 2 tours
- Coup critique : Bouclier = 420% du niveau du lanceur ; Bouclier = 210% du niveau du lanceur
- Rôle : shield
- **Analyse tactique** : Bouclier 720 PV (niv. 200) mono-cible à 1–2 PO.


### Paire 17 — Apathie / Rétention

#### Apathie (`13393`) — variante de base, débloqué niv. 65, grade 3

> Occasionne des dommages Terre et retire des PM.

- **4 PA**, PO 2–8 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 20 %
- Condition de lancer (états du lanceur) : `HS=100` — lanceur dans l'état « Pleutre » (100)
- Effets exécutés :
  - Dommages Terre 31 à 35 — cibles: alliés/ennemis
  - -3 PM (esquivable) — cibles: alliés/ennemis; 1 tour
- Coup critique : Dommages Terre 37 à 42
- Grades : g1 (niv 65) vs g3: Dommages Terre 23 à 26 (g1) → Dommages Terre 31 à 35 (g3) ; PO max 6 (g1) → 8 (g3) | g2 (niv 131) vs g3: Dommages Terre 28 à 31 (g2) → Dommages Terre 31 à 35 (g3) ; PO max 7 (g2) → 8 (g3)
- Rôle : damage, mp_removal
- **Analyse tactique** : Terre 31–35 + -3 PM (esquivable), 2/cible : le retrait PM principal. Pleutre.

#### Rétention (`13390`) — variante alternative, débloqué niv. 175, grade 1

> Vole de la vie dans l'élément Air et retire des PA.

- **3 PA**, PO 1–3 (non modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 15 %
- Condition de lancer (états du lanceur) : `HS=98` — lanceur dans l'état « Intrépide » (98)
- Effets exécutés :
  - Vol de vie Air 27 à 31 — cibles: alliés/ennemis
  - -2 PA (esquivable) — cibles: alliés/ennemis; 1 tour
- Coup critique : Vol de vie Air 33 à 37
- Rôle : ap_removal, damage, lifesteal
- **Analyse tactique** : Vol de vie Air 27–31 + -2 PA. Intrépide.


### Paire 18 — Boliche / Ronda

#### Boliche (`13396`) — variante de base, débloqué niv. 70, grade 2

> Rapproche le lanceur vers la cible, occasionne des dommages Eau aux ennemis et repousse la cible.

- **3 PA**, PO 1–5 (non modifiable), lancer en ligne, ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 25 %
- Condition de lancer (états du lanceur) : `HS=98|HS=99` — lanceur dans l'état « Intrépide » (98) OU lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Le lanceur avance de 4 case(s) — cibles: alliés/ennemis
  - Dommages Eau 29 à 32 — cibles: ennemis
  - Repousse de 3 case(s) — cibles: alliés/ennemis
- Coup critique : Dommages Eau 35 à 38
- Grades : g1 (niv 70) vs g2: Le lanceur avance de 3 case(s) (g1) → Le lanceur avance de 4 case(s) (g2) ; Dommages Eau 23 à 25 (g1) → Dommages Eau 29 à 32 (g2) ; PO max 4 (g1) → 5 (g2)
- Rôle : damage, push, self_move
- **Analyse tactique** : Avance de 4, Eau 29–32, repousse de 3 : « charge » qui replace la cible.

#### Ronda (`14681`) — variante alternative, débloqué niv. 180, grade 1

> Occasionne des dommages Terre aux ennemis et attire les cibles vers le lanceur en zone.

- **4 PA**, PO 0–1 (non modifiable), lancer en ligne, en diagonale, ligne de vue ; 1 lancer(s)/tour, CC 15 %
- Condition de lancer (états du lanceur) : `HS=98|HS=99` — lanceur dans l'état « Intrépide » (98) OU lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Dommages Terre 38 à 42 — anneau r2; cibles: ennemis
  - le lanceur lance « Ronda » (14683) niv.1 — anneau r2; cibles: alliés/ennemis
    - ↳ Attire de 2 case(s) — cibles: alliés/ennemis
- Coup critique : Dommages Terre 46 à 50
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Attire de 2 case(s) — cibles: alliés/ennemis
- Rôle : aoe, damage, pull
- **Analyse tactique** : Terre 38–42 en anneau r2 autour d’une case adjacente + attire 2 : nettoyage de vague au corps-à-corps.


### Paire 19 — Fougue / Mascarade

#### Fougue (`13402`) — variante de base, débloqué niv. 75, grade 2

> Rend l'allié ciblé Intaclable ou l'ennemi ciblé Insoignable.

- **2 PA**, PO 0–6 (modifiable), ligne de vue ; relance 3 tour(s), CC 0 %
- Effets exécutés :
  - Applique l'état « Intaclable » (96) — cibles: alliés; 1 tour
  - Applique l'état « Insoignable » (76) — cibles: ennemis; 1 tour
- Grades : g1 (niv 75) vs g2: PO max 5 (g1) → 6 (g2) ; relance 4 (g1) → 3 (g2)
- Rôle : anti_heal, untackleable
- **Analyse tactique** : Allié Intaclable (fuir un tacle) ou ennemi Insoignable 1 tour (boss soigneur).

#### Mascarade (`13404`) — variante alternative, débloqué niv. 185, grade 1

> Occasionne des dommages Neutre au lanceur et à la cible : • Les dommages sur la cible dépendent de la vie restante du lanceur. • Les dommages sur le lanceur dépendent de sa vie manquante. • Les effets sont permutés si le lanceur est à moins de 50% de sa vie.  Sur le lanceur : échange de position avec son Masque Grimaçant.

- **3 PA**, PO 1–1 (non modifiable), sans ligne de vue, case occupée ; relance 3 tour(s), relance initiale 1, CC 0 %
- Effets exécutés :
  - le lanceur lance « Mascarade » (28595) niv.1 — cibles: alliés sauf lanceur/ennemis
    - ↳ Dommages Neutre = 25% des PV du lanceur — cibles: alliés sauf lanceur/ennemis [lanceur PV ≥ 50%]
    - ↳ Dommages Neutre = 25% des PV manquants du lanceur — cibles: lanceur [lanceur PV ≥ 50%]
    - ↳ Dommages Neutre = 25% des PV manquants du lanceur — cibles: alliés/ennemis [lanceur PV < 50%]
    - ↳ Dommages Neutre = 25% des PV du lanceur — cibles: lanceur [lanceur PV < 50%]
  - le lanceur lance « Mascarade » (28595) niv.2 — cibles: lanceur(si dans zone)
    - ↳ le lanceur lance « Mascarade » (28595) niv.3 — toute la carte; cibles: alliés [groupe du lanceur; lanceur sans état « Pesanteur » (7); sans état « Pesanteur » (7); =monstre Masque Grimaçant (5152)]
      - ↳ Échange de positions avec le lanceur — cibles: alliés
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Dommages Neutre = 25% des PV du lanceur — cibles: alliés sauf lanceur/ennemis [lanceur PV ≥ 50%] ; Dommages Neutre = 25% des PV manquants du lanceur — cibles: lanceur [lanceur PV ≥ 50%] ; Dommages Neutre = 25% des PV manquants du lanceur — cibles: alliés sauf lanceur/ennemis [lanceur PV < 50%] ; Dommages Neutre = 25% des PV du lanceur — cibles: lanceur [lanceur PV < 50%] ; Échange de positions avec le lanceur — cibles: alliés
- Rôle : damage, swap
- **Analyse tactique** : 25 % des PV actuels du Zobal en Neutre à la cible (si ≥ 50 % PV) : très fort sur un Zobal vitalité.


### Paire 20 — Transe / Névrose

#### Transe (`13399`) — variante de base, débloqué niv. 80, grade 2

> Sacrifie une partie de la vie du lanceur pour appliquer un bouclier sur les alliés en zone. Le bouclier est réduit de moitié sur les invocations.

- **3 PA**, PO 0–1 (non modifiable), sans ligne de vue ; relance 3 tour(s), cumul max 1, CC 25 %
- Condition de lancer (états du lanceur) : `HS=99` — lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - Désenvoûte les effets du sort « Transe » (13399) — croix r1; cibles: alliés joueurs/compagnons/monstres alliés/lanceur(si dans zone)
  - -70% PV (érosion de PV max, INCERTAIN) — croix r1; cibles: lanceur; 2 tours
  - Bouclier = 450% du niveau du lanceur — croix r1; cibles: alliés joueurs/compagnons/monstres alliés/lanceur(si dans zone); 2 tours
  - Bouclier = 225% du niveau du lanceur — croix r1; cibles: invocs alliées; 2 tours
- Coup critique : Bouclier = 600% du niveau du lanceur ; Bouclier = 300% du niveau du lanceur
- Grades : g1 (niv 80) vs g2: -75% PV (érosion de PV max, INCERTAIN) (g1) → -70% PV (érosion de PV max, INCERTAIN) (g2)
- Rôle : shield
- **Analyse tactique** : Perd 70 % de ses PV (érosion, 2 tours, INCERTAIN) pour 900 PV de bouclier aux alliés en croix r1. Psychopathe.

#### Névrose (`13426`) — variante alternative, débloqué niv. 190, grade 1

> Augmente la Puissance de l'allié ciblé et applique l'état Pesanteur sur la cible.

- **2 PA**, PO 0–6 (non modifiable), ligne de vue ; relance 3 tour(s), cumul max 1, CC 0 %
- Condition de lancer (états du lanceur) : `HS=99` — lanceur dans l'état « Psychopathe » (99)
- Effets exécutés :
  - +250 Puissance — cibles: alliés; 2 tours
  - Applique l'état « Pesanteur » (7) — cibles: alliés/ennemis; 1 tour
- Rôle : ally_power_buff, gravity
- **Analyse tactique** : +250 Puissance (2 tours) à un allié + Pesanteur : buff DPS.


### Paire 21 — Grimace / Diffraction

#### Grimace (`13424`) — variante de base, débloqué niv. 85, grade 2

> Invoque un Masque Grimaçant maîtrisable qui tacle les ennemis et partage ses dommages avec son invocateur tant qu'il est en vie. Lorsqu'un ennemi se fait tacler par le Masque, lui et son invocateur gagnent du bouclier.  Le Masque Grimaçant s'applique également des effets selon le masque porté par son invocateur : • Intrépide : attire les entités en zone autour de lui. • Pleutre : augmente ses PM. • Psychopathe : repousse les entités à son contact.  Le Masque est téléporté sur la case ciblée si le sort est relancé quand il est en vie. À sa mort, le temps de relance du sort est fixé à 2 tours.

- **3 PA**, PO 1–1 (non modifiable), sans ligne de vue, case libre ; relance 2 tour(s), CC 0 %
- Condition de lancer (états du lanceur) : `HS!4106` — lanceur PAS dans l'état « Masque Grimaçant non invoqué et limite atteinte » (4106)
- Effets exécutés :
  - Invoque Masque Grimaçant (5152) grade 3 — cibles: alliés/ennemis [lanceur sans état « Masque Grimaçant invoqué » (4105)]
  - la cible lance sur sa cellule « Grimace » (28600) niv.1 — cibles: lanceur [lanceur avec état « Masque Grimaçant invoqué » (4105)]
    - ↳ la cible lance sur sa cellule « Grimace » (28600) niv.2 — toute la carte; cibles: alliés [groupe du lanceur; sans état « Pesanteur » (7); =monstre Masque Grimaçant (5152)]
      - ↳ Téléporte le lanceur sur la case ciblée — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Bouclier = 120% du niveau du lanceur — cibles: alliés joueurs/compagnons [groupe du lanceur]; 2 tours ; Attire de 2 case(s) — croix sans centre r3; cibles: alliés/ennemis ; +2 PM — cibles: alliés/ennemis; infini ; Repousse de 2 case(s) — croix sans centre r1; cibles: alliés/ennemis ; Sort « Grimace » (13424) : relance fixée à 2 tour(s) — cibles: lanceur ; Téléporte le lanceur sur la case ciblée — cibles: alliés [groupe du lanceur; =monstre Masque Grimaçant (5152)]
- Grades : g1 (niv 85) vs g2: Invoque Masque Grimaçant (5152) grade 1 (g1) → Invoque Masque Grimaçant (5152) grade 3 (g2)
- Rôle : ally_mp_buff, pull, push, shield, summon, tackle, teleport
- **Analyse tactique** : Masque Grimaçant tacleur et absorbeur de dommages.

#### Diffraction (`13385`) — variante alternative, débloqué niv. 195, grade 1

> Applique un bouclier sur tout le monde selon la distance avec le lanceur : • 0 à 5 cases : 450% du niveau en bouclier. • 6 à 11 cases : 250% du niveau en bouclier. • 12 cases et plus : 50% du niveau en bouclier. Le bouclier est réduit de moitié sur les invocations.

- **3 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 3 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - le lanceur lance « Diffraction » (18967) niv.5 — cibles: lanceur
    - ↳ Applique l'état « Diffraction 0-5 » (2223) — cercle r5; cibles: alliés/ennemis; 1 tour; non désenvoûtable
    - ↳ Applique l'état « Diffraction 6-11 » (2224) — cercle r11 (rayon min 6); cibles: alliés/ennemis; 1 tour; non désenvoûtable
    - ↳ Applique l'état « Diffraction 12+ » (2225) — cercle r63 (rayon min 12); cibles: alliés/ennemis; 1 tour; non désenvoûtable
  - le lanceur lance « Diffraction » (18967) niv.1 — cibles: lanceur
    - ↳ Bouclier = 450% du niveau du lanceur — toute la carte; cibles: alliés joueurs/compagnons/monstres alliés/ennemis joueurs/compagnons/monstres ennemis/lanceur(si dans zone) [avec état « Diffraction 0-5 » (2223)]; 2 tours
    - ↳ Bouclier = 225% du niveau du lanceur — toute la carte; cibles: invocs alliées/invocs ennemies [avec état « Diffraction 0-5 » (2223)]; 2 tours
  - le lanceur lance « Diffraction » (18967) niv.2 — cibles: lanceur
    - ↳ Bouclier = 250% du niveau du lanceur — toute la carte; cibles: alliés joueurs/compagnons/monstres alliés/ennemis joueurs/compagnons/monstres ennemis/lanceur(si dans zone) [avec état « Diffraction 6-11 » (2224)]; 2 tours
    - ↳ Bouclier = 125% du niveau du lanceur — toute la carte; cibles: invocs alliées/invocs ennemies [avec état « Diffraction 6-11 » (2224)]; 2 tours
  - le lanceur lance « Diffraction » (18967) niv.3 — cibles: lanceur
    - ↳ Bouclier = 50% du niveau du lanceur — toute la carte; cibles: alliés joueurs/compagnons/monstres alliés/ennemis joueurs/compagnons/monstres ennemis/lanceur(si dans zone) [avec état « Diffraction 12+ » (2225)]; 2 tours
    - ↳ Bouclier = 25% du niveau du lanceur — toute la carte; cibles: invocs alliées/invocs ennemies [avec état « Diffraction 12+ » (2225)]; 2 tours
  - le lanceur lance « Diffraction » (18967) niv.4 — cibles: lanceur
    - ↳ Retire l'état « Diffraction 0-5 » (2223) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Diffraction 6-11 » (2224) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Diffraction 12+ » (2225) — toute la carte; cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Bouclier = 450% du niveau du lanceur — toute la carte; cibles: alliés joueurs/compagnons/monstres alliés/ennemis joueurs/compagnons/monstres ennemis; 2 tours ; Bouclier = 225% du niveau du lanceur — toute la carte; cibles: invocs alliées/invocs ennemies; 2 tours ; Bouclier = 250% du niveau du lanceur — toute la carte; cibles: alliés joueurs/compagnons/monstres alliés/ennemis joueurs/compagnons/monstres ennemis; 2 tours ; Bouclier = 125% du niveau du lanceur — toute la carte; cibles: invocs alliées/invocs ennemies; 2 tours ; Bouclier = 50% du niveau du lanceur — toute la carte; cibles: alliés joueurs/compagnons/monstres alliés/ennemis joueurs/compagnons/monstres ennemis; 2 tours ; Bouclier = 25% du niveau du lanceur — toute la carte; cibles: invocs alliées/invocs ennemies; 2 tours
- Rôle : shield
- **Analyse tactique** : Boucliers de 900/500/100 PV selon la distance… y compris aux ennemis : se placer pour couvrir les alliés et éloigner les ennemis (≥ 12 cases).


### Paire 22 — Carnavalo / Transfiguration

#### Carnavalo (`18651`) — variante de base, débloqué niv. 90, grade 2

> Applique un bouclier sur le lanceur, occasionne des dommages dans son meilleur élément d'attaque aux ennemis et repousse la cible. Chaque effet devient plus important selon le masque porté par le lanceur : • État Intrépide : le bouclier est plus important. • État Pleutre : la poussée est plus importante. • État Psychopathe : les dommages sont plus importants.  Chaque changement de masque diminue l'intervalle de relance du sort d'un tour.

- **3 PA**, PO 1–3 (non modifiable), ligne de vue, case occupée ; relance 5 tour(s), CC 15 %
- Effets exécutés :
  - Bouclier = 100% du niveau du lanceur — cibles: lanceur [lanceur sans état « Intrépide » (98)]; 2 tours
  - Bouclier = 300% du niveau du lanceur — cibles: lanceur [lanceur avec état « Intrépide » (98)]; 2 tours
  - Dommages meilleur élément 24 à 28 — cibles: ennemis [lanceur sans état « Psychopathe » (99)]
  - Dommages meilleur élément 39 à 43 — cibles: ennemis [lanceur avec état « Psychopathe » (99)]
  - Repousse de 1 case(s) — cibles: alliés/ennemis [lanceur sans état « Pleutre » (100)]
  - Repousse de 4 case(s) — cibles: alliés/ennemis [lanceur avec état « Pleutre » (100)]
- Coup critique : Dommages meilleur élément 29 à 34 ; Dommages meilleur élément 45 à 50
- Grades : g1 (niv 90) vs g2: Dommages meilleur élément 19 à 23 (g1) → Dommages meilleur élément 24 à 28 (g2) ; Dommages meilleur élément 29 à 33 (g1) → Dommages meilleur élément 39 à 43 (g2)
- Rôle : damage, push, shield
- **Analyse tactique** : Effet selon le masque, relance 5 réduite d’1 à chaque changement de masque.

#### Transfiguration (`18650`) — variante alternative, débloqué niv. 200, grade 1

> Applique l'état Transfiguration sur le lanceur et l'ennemi ciblé, en appliquant des effets sur l'ennemi selon le masque porté : • État Intrépide : réduit les dommages finaux occasionnés. • État Pleutre : réduit les résistances à distance. • État Psychopathe : réduit les résistances en mêlée. Le cumul est partagé entre les effets.  Chaque changement de masque réduit le temps de relance du sort d'un tour et réapplique les effets du sort si le lanceur est dans l'état Transfiguration.

- **2 PA**, PO 1–6 (non modifiable), ligne de vue, case occupée ; relance 5 tour(s), relance globale -1 (INCERTAIN : partagée), cumul max 1, CC 0 %
- Effets exécutés :
  - le lanceur lance « Transfiguration » (26244) niv.1 — cibles: ennemis
    - ↳ Applique l'état « Transfiguration » (4466) — cibles: lanceur/ennemis; 2 tours
    - ↳ Applique l'état « Transfiguration » (4464) — cibles: lanceur; 2 tours
    - ↳ Applique l'état « Transfiguration » (4465) — cibles: ennemis; 2 tours
    - ↳ le lanceur lance « Transfiguration » (26244) niv.2 — cibles: ennemis [lanceur avec état « Intrépide » (98)]
      - ↳ -20% Dommages finaux — toute la carte; cibles: ennemis [avec état « Transfiguration » (4465)]; 2 tours
    - ↳ le lanceur lance « Transfiguration » (26244) niv.3 — cibles: ennemis [lanceur avec état « Pleutre » (100)]
      - ↳ -10% Résistance distance — toute la carte; cibles: ennemis [avec état « Transfiguration » (4465)]; 2 tours
    - ↳ le lanceur lance « Transfiguration » (26244) niv.4 — cibles: ennemis [lanceur avec état « Psychopathe » (99)]
      - ↳ -10% Résistance mêlée — toute la carte; cibles: ennemis [avec état « Transfiguration » (4465)]; 2 tours
    - ↳ la cible lance sur elle-même « Transfiguration » (26244) niv.2 — cibles: lanceur; déclenché quand l'état « Intrépide » (98) est appliqué (déclencheur actif 2 tour(s))
    - ↳ la cible lance sur elle-même « Transfiguration » (26244) niv.3 — cibles: lanceur; déclenché quand l'état « Pleutre » (100) est appliqué (déclencheur actif 2 tour(s))
    - ↳ la cible lance sur elle-même « Transfiguration » (26244) niv.4 — cibles: lanceur; déclenché quand l'état « Psychopathe » (99) est appliqué (déclencheur actif 2 tour(s))
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Applique l'état « Transfiguration » (4464) — cibles: lanceur/ennemis; 2 tours ; -20% Dommages finaux — cibles: ennemis [lanceur avec état « Intrépide » (98)]; 2 tours; déclenché quand l'état « Intrépide » (98) est appliqué (déclencheur actif 2 tour(s)) ; -10% Résistance distance — cibles: ennemis [lanceur avec état « Pleutre » (100)]; 2 tours; déclenché quand l'état « Pleutre » (100) est appliqué (déclencheur actif 2 tour(s)) ; -10% Résistance mêlée — cibles: ennemis [lanceur avec état « Psychopathe » (99)]; 2 tours; déclenché quand l'état « Psychopathe » (99) est appliqué (déclencheur actif 2 tour(s))
- Rôle : debuff, final_damage_debuff, melee_res_debuff, range_res_debuff
- **Analyse tactique** : Débuff qui suit les changements de masque (-20 % dommages finaux / -10 % rés. distance / -10 % rés. mêlée).


## 5. Choix des variantes (« sets de sorts ») par rôle

### Set « Rempart » (protection/tank, recommandé en groupe de 4)

Rester majoritairement en Intrépide (+1 PA) : Plastron + Scudo/Ginga, vols de vie, attirances, Grimace pour tacler ; Pleutre en dépannage pour Apathie/Tortoruga.

| Paire | Choix | Pourquoi |
|---|---|---|
| 1 | Brincadeira | 2 PA, -4 PO, Intrépide/Pleutre |
| 2 | Catalepsie | sustain au contact |
| 3 | Parafuso | vol de vie + regroupement |
| 4 | Cavalcade | engagement |
| 5 | Masque de l’Intrépide | +1 PA, attirance |
| 6 | Plastron | bouclier de groupe |
| 7 | Pivot | repositionnement |
| 8 | Masque du Pleutre | +1 PM +Fuite |
| 9 | Ponteira | -50 dommages |
| 10 | Masque du Psychopathe | +Tacle, DPS |
| 11 | Furia | dégâts Psychopathe |
| 12 | Tortoruga | bouclier à distance |
| 13 | Purgatorio | désenvoûtement partiel |
| 14 | Débandade | mobilité |
| 15 | Inferno | gros dégâts |
| 16 | Scudo | bouclier 720 |
| 17 | Apathie | -3 PM |
| 18 | Ronda | zone + attirance |
| 19 | Fougue | Insoignable/Intaclable |
| 20 | Névrose | +250 Puissance allié |
| 21 | Grimace | tacleur + partage |
| 22 | Transfiguration | -20 % dommages finaux du boss |

### Set « Psychopathe » (DPS mêlée + soutien Tacle)

Inferno/Furia/Ronda/Cavalcade, Masque du Psychopathe pour +10 % mêlée aux alliés adjacents, Névrose sur le meilleur DPS.

| Paire | Choix | Pourquoi |
|---|---|---|
| 10 | Masque du Psychopathe |  |
| 15 | Inferno |  |
| 11 | Furia |  |
| 18 | Ronda |  |
| 13 | Cabriole | téléport + Air |
| 20 | Névrose |  |
| 22 | Carnavalo | 39–43 meilleur élément en Psychopathe |


## 6. Rotations types (11–12 PA / 6 PM)

### Ouverture protection (Intrépide, 12 PA)

*Contexte* : Début de vague/boss, groupe regroupé autour du Zobal.

1. (Déjà Intrépide au tour 1.) Plastron (4 PA) : 1 200 PV de bouclier aux alliés dans le cercle 3.
2. Cavalcade (4 PA) vers l’ennemi le plus menaçant (avance 4 + Air 38–42).
3. Catalepsie (3 PA) au contact (vol de vie Terre + -40 Fuite).
4. Masque de l’Intrépide (1 PA) au tour suivant seulement si besoin de l’attirance (relance 2) ; sinon Brincadeira (2 PA) si 13 PA.

*Résultat attendu* : Groupe protégé (≈ 1 200 PV absorbés chacun) et ennemi principal tacle/au contact.

### Burst Psychopathe (12–13 PA)

*Contexte* : Boss au contact, alliés adjacents au Zobal.

1. Masque du Psychopathe (1 PA) : +10 % mêlée, +20 Tacle au Zobal et aux adjacents.
2. Inferno (4 PA) : Feu 41–45 + 200 Puissance.
3. Inferno (4 PA) : profite des +200 Puissance.
4. Furia (3 PA) : Terre 35–39 + 40 Dommages.

*Résultat attendu* : ≈ 125 dégâts de base mono-cible + buffs, puis reprendre Intrépide 2 tours plus tard.

### Tour entrave (Pleutre, 12 PA)

*Contexte* : Ennemis rapides à ralentir, Zobal à distance.

1. Masque du Pleutre (1 PA) : +1 PM +40 Fuite.
2. Apathie (4 PA) : -3 PM.
3. Apathie (4 PA) sur une 2e cible (2/cible) ou la même.
4. Picada (3 PA) : -2 PA.

*Résultat attendu* : Jusqu’à -6 PM et -2 PA (esquivables) répartis.


## 7. Forces et faiblesses

**Forces**

- Boucliers de groupe énormes et à faible coût (Plastron 4 PA = 1 200 PV × N alliés), relances courtes.
- Polyvalence : tank, protection, entrave et dégâts selon le masque, changement de masque à 1 PA.
- Buff +1 PA / +1 PM aux alliés adjacents (masques) et +250 Puissance (Névrose).
- Très mobile (Reuche 7 cases, Cavalcade, Pivot, Cabriole, Débandade).

**Faiblesses**

- Contraintes d’état : un sort n’est lançable que dans le bon masque ; relance de 2 tours par masque.
- Dégâts moyens hors Psychopathe ; portée courte de la plupart des sorts offensifs.
- Diffraction et Agular touchent aussi les ennemis/alliés : risque de mauvais usage par l’IA.
- Masque Grimaçant : partage des dommages qui peut tuer le Zobal si le masque est focalisé.

## 8. Synergies avec les autres classes

- **Iop / Sacrieur / Ouginak / Forgelance (DPS mêlée)** — Masque du Psychopathe (+10 % mêlée, +20 Tacle) et Intrépide (+1 PA) aux alliés adjacents ; Névrose +250 Puissance.
- **Crâ / Eliotrope / Roublard (DPS distance)** — Masque du Couard (+10 % distance, +1 PO) ; Tortoruga/Scudo protègent ; Pleutre +1 PM pour garder la distance.
- **Eniripsa / Steamer (soigneurs)** — Boucliers + soins = très haute survivabilité ; éviter Agular sur les alliés.
- **Sram / Enutrof (entrave)** — Apathie/Martelo complètent le retrait PM ; le Masque Grimaçant bloque les couloirs.

## 9. Conseils pour l’IA de groupe

- Garder Plastron pour le tour où ≥ 3 alliés sont dans le cercle 3 et où une grosse attaque ennemie est attendue (boss qui charge).
- Coller les DPS mêlée au Zobal au moment du changement de masque (bonus en croix r1).
- Score de Diffraction = Σ boucliers alliés - Σ boucliers ennemis (pondérés par la menace) : ne lancer que si positif.
- Planifier les masques : Intrépide (protéger) → Psychopathe (burst) → Intrépide, en tenant compte de la relance 1 tour imposée à l’ancien masque.

### 9.1 Pertinence pour l’Œil de Vortex (démo)

Analyse croisée avec `docs/research/vortex.md` (dossier d’un autre agent) :

- *En temps et en heure* inflige 500 Terre de base + 50 % des PV érodés : Plastron (1 200 PV de bouclier à tout le groupe en cercle 3) / Scudo / Ginga absorbent ce pic — le Zobal est le meilleur « filet de sécurité » des 4 classes.
- Masque du Pleutre (+1 PM +40 Fuite au groupe adjacent) et Reuche/Débandade aident à sortir des lignes de l’Auroraire ; Masque de l’Intrépide (+1 PA) augmente le burst nécessaire pour tuer au bon moment.
- Diffraction est risquée : elle protège aussi les monstres proches (qu’il faut tuer à l’heure exacte).
- Transfiguration (-20 % dommages finaux) et Ponteira (-50 dommages) sur le Vortex en phase 2 (16 PA).

## 10. Points incertains

- INCERTAIN — Effet 1061 (partage de dommages) du Masque Grimaçant : règle exacte de répartition.
- INCERTAIN — Transe : effet 1048 « -70 % PV » interprété comme une perte de 70 % des PV actuels/érosion (2 tours) — à vérifier en jeu.
- INCERTAIN — Mascarade : dommages basés sur les PV non boostés par les caractéristiques (hypothèse).
- INCERTAIN — PV du Masque Grimaçant (`bonusCharacteristics.lifePoints` = 100).
- INCERTAIN — Validation croisée : 22 sorts du Zobal concordent avec la table de DoMath ; Carnavalo y est noté « Neutre » alors que les données donnent « meilleur élément » (effet 2822).

## 11. Sources

- https://api.dofusdb.fr/breeds/14 ; https://api.dofusdb.fr/spell-variants?breedId=14 ; spells/spell-levels (ids cités) ; spell-states ; monsters/5152
- Port C# du calcul de dégâts du client (.cache/domath/haxe, SpellManager/DamageSender) pour les masques et les dommages basés sur les PV
