# Eliotrope — analyse complète pour DofusSimu (breed 16)

> « Créateur de portails ». Données : API DofusDB (fichiers du jeu Dofus 3, mises à jour 2026) — `breeds/16`,
> `spell-variants?breedId=16`, `spells`, `spell-levels`, `spell-states`, `monsters/5109` (Totem Eliotrope) et sorts cachés des
> types 2003 (« Sort initial Eliotrope » : Le Portail Eliotrope 14631/32780, Portail 24955, Errance 24956) et 709 (« Déclenchés
> Eliotrope »). Cache : `.cache/classes/rzse/`. Rôles officiels : **Placement 8/10** (« les portails permettent aux alliés et aux
> ennemis de se téléporter »), **Dégâts 7/10** (« les portails augmentent les dommages des sorts qui les traversent »),
> **Soins 6/10**, Amélioration 5, Entrave 3, Invocation 1. Complexité 5/5.

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

- **Portails** : l’Eliotrope pose des portails (marques au sol). Dès que plusieurs portails sont actifs, (1) une entité qui
  marche (ou est poussée) sur un portail est **téléportée** au portail de sortie, (2) un sort **lancé sur un portail** est
  **projeté** depuis le dernier portail du réseau et ses **dommages et soins sont augmentés de 2 % par case de distance**
  cumulée entre les portails traversés (données actuelles : `FightAddPortal` param1 = 2, base = 0). De plus, chaque projection
  donne à l’Eliotrope **+2 % dommages finaux et +2 % soins finaux** pendant 3 tours (cumulable 10 fois → +20 %).
- **Presque tous ses sorts ont un « bonus portail »** (masque `R` = lancé via un portail) : retrait PM/PA (Raillerie, Sarcasme),
  poisons (Extinction, Affliction), vols (Faisceau, Persiflage), buffs renforcés (Cabale, Coalition), etc. — voir tableau.
- **Soins** : Rayon de Wakfu (soigne les alliés et frappe les ennemis sur une ligne), Cicatrisation (8 % PV max en zone),
  Thérapie, Affliction, Sinécure (soin ou vol), Résilience (10 %), Distribution (25 % des dommages subis par la cible soignent les
  alliés autour), Cataclysme (les alliés de la zone récupèrent 50 % des dommages infligés), Entraide/Coalition/Totem (soins
  au passage des portails).
- **Soutien** : Cabale (+200 Puissance +2 PM via portail), Coalition (+2 PA via portail), Orgueil (renvoi 30 % + 150 Puissance),
  Transcendance (Intaclable + portails supplémentaires).
- **Éléments** : les 4 éléments sont représentés (Air : Affront, Mépris, Brimade, Raillerie, Sermon ; Eau : Audace,
  Tribulation, Insolence, Aplomb, Poing Fulgurant, Affliction ; Terre : Commotion, Convulsion, Persiflage, Camouflet, Sarcasme,
  Thérapie ; Feu : Rayon de Wakfu, Faisceau, Outrage, Cataclysme, Offense, Extinction).

**Effets bonus des sorts projetés** :

| Sort (paire) | Effet normal | Effet si projeté dans un portail (masque `R`) |
|---|---|---|
| Affront (1) | Air 26–28 en barre de 3 + repousse 2 | pas de poussée |
| Audace (2) | le lanceur avance de 2 + Eau 26–29 (ennemis) | pas de rapprochement ; touche aussi les alliés |
| Commotion (3) | Terre 23–26 en croix sans centre + attire 1 (pas le lanceur) | l’attirance affecte aussi le lanceur |
| Faisceau (4) | Feu 23–26 en cône | devient un **vol de vie** |
| Persiflage (7) | Terre 25–29 + -3 PO | **vol** de 3 PO |
| Sinécure (7) | vol de vie Air 12–14 / soin allié 12–14 | + -40 résistance poussée (2 tours) |
| Conjuration (8) | réduit d’1 tour la durée des effets | + soins reçus ×70 % sur l’ennemi |
| Outrage (9) | Feu 24–28 | + 1 PO au lanceur (2 tours) |
| Aplomb (9) | Eau 32–36 | + 1 PM au lanceur (1 tour) |
| Insolence (11) | recule de 2 + Eau 25–28 (ennemis) | pas de recul ; touche aussi les alliés |
| Camouflet (11) | Terre 24–27 en croix | + -40 Dommages (1 tour) |
| Cabale (12) | +100 Puissance +1 PM (croix r1, 2 tours) | **+200 Puissance +2 PM** |
| Résilience (12) | soin 10 % PV max | + soins reçus ×115 % |
| Brimade (13) | Air 23–25 + repousse 2 depuis le centre (pas le lanceur) | la poussée affecte aussi le lanceur |
| Poing Fulgurant (15) | Eau 23–25 + repousse 2 | repousse 4 |
| Affliction (17) | vol de vie Eau 23–26 / soin allié | + poison Eau 23–26 en début de tour (ennemi) / soin en début de tour (allié) |
| Raillerie (19) | Air 32–36 | **+ -3 PM** |
| Sarcasme (19) | Terre 34–38 | **+ -3 PA** |
| Extinction (21) | Feu 32–35 | + poison Feu 32–35 en fin de tour |
| Sermon (21) | Air 38–42 + repousse 2 | repousse 4 |
| Coalition (22) | +1 PA (2 tours) + état Coalition | **+2 PA** |

## 2. Rôles en groupe PvM (niveau 200)

- **dps-distance-amplifié** (priorité 1, élément(s) : Air/Terre (Raillerie, Sermon, Sarcasme) ou Feu/Eau (Extinction, Aplomb) — multi possible) — Sorts 4–5 PA à 32–42 de base, amplifiés de +2 %/case de réseau (souvent +20 à +40 %) et par le passif (+2 % finaux par projection, jusqu’à +20 %). Peut frapper hors de la ligne de vue directe grâce aux portails.
- **placement-mobilité** (priorité 1, élément(s) : -) — Réseau de portails = téléportation gratuite pour TOUT le groupe (et les ennemis après le 1er tour !) ; Exil/Résonance (téléporter une cible), Stupeur (échange), Sillage (se téléporter), Odyssée/Exode, poussées/attirances.
- **soin-secondaire** (priorité 2, élément(s) : Feu/Eau/Terre/Air + % PV) — Cicatrisation 8 % zone, Résilience 10 % (+15 % soins reçus via portail), Rayon de Wakfu, Thérapie, Affliction (soin sur la durée via portail), Distribution, Cataclysme, Entraide ; soins amplifiés par les portails.
- **soutien-buff** (priorité 2, élément(s) : -) — Cabale (+200 Puissance +2 PM en croix r1 via portail), Coalition (+2 PA via portail), Orgueil (renvoi de 30 % des dommages finaux + 150 Puissance au tour suivant).
- **entrave** (priorité 3, élément(s) : Air/Terre) — Raillerie -3 PM et Sarcasme -3 PA (via portail), Persiflage -3 PO / vol 3 PO, Conjuration (désenvoûtement partiel + anti-soin), Camouflet -40 Dommages, Neutral/Interruption (désactiver les portails pour piéger les ennemis).

## 3. Mécaniques de classe à implémenter (moteur)

### 3.1 Portails : pose, limite, activation

Portail (14574, 1 PA, PO 1–6 LdV, case libre sans portail, 2/tour) ou Errance (14604, 1 PA, PO 1–4, case sans portail — peut être posé sous une entité, 3/tour). Le choix de la variante fixe l’état permanent « Portail » (3737) ou « Errance » (3738) posé en début de combat (sorts initiaux 24955/24956) ; les autres sorts qui créent des portails (Exil, Sillage, Stupeur, Résonance, Totem) posent le portail du type correspondant. Effet 1181 `FightAddPortal` : diceNum = 2 (% de bonus par case), value = 0 (bonus de base), durée infinie. Maximum **4 portails** par Eliotrope (INCERTAIN pour Dofus 3, source historique jeuxonline). Neutral (1 PA rendu → gratuit) désactive un portail 1 tour ; Interruption désactive tous les portails 1 tour. Les ennemis ne peuvent pas emprunter les portails pendant leur 1er tour (état 678 « Téléportail impossible » posé par le passif au début du combat). Les invocations reçoivent les états « Portails alliés/ennemis » (7021/7022) à leur apparition (INCERTAIN : leur permet d’utiliser les portails).

*Notes d’implémentation* : Marque {cell, teamId, ownerId, active, createdTurn}. Si plus de 4 portails : supprimer le plus ancien (INCERTAIN). Les portails sont des marques d’équipe (l’IA ennemie peut les emprunter à partir du tour 2).

### 3.2 Réseau, portail de sortie et téléportation

Le réseau se parcourt en **chaîne** : depuis le portail d’entrée, on va au portail actif le plus proche non encore visité (distance de Manhattan en cases ; en cas d’égalité, départage par l’angle — PortalUtils.GetNextNearestPortalCell), et ainsi de suite ; le **dernier** portail de la chaîne est la sortie. Une entité qui entre sur un portail (déplacement volontaire ou poussée/attirance) est téléportée sur la sortie (effet 1182 `FightUsePortal`).

*Notes d’implémentation* : Implémenter `portalChain(entry)` exactement comme PortalUtils.GetPortalChainFromPortalCells (cache .cache/domath/haxe/Tools/PortalUtils.cs). Téléportation impossible si la sortie est occupée (INCERTAIN). Les poussées qui font passer une entité sur un portail la téléportent (PushUtils, ThroughPortal).

### 3.3 Projection de sorts et bonus de distance

Lancer un sort SUR un portail d’entrée (≥ 2 portails actifs) le fait ressortir par le portail de sortie, « de façon symétrique selon la position du lanceur par rapport au portail ciblé » (jeuxonline) : l’origine du sort devient la sortie (les poussées/attirances partent de la sortie). Bonus : multiplicateur `1 + (max(base) + Σ distances entre portails successifs de la chaîne × 2) / 100` appliqué aux dommages ET aux soins (sauf soins « splash »). Exemple : 3 portails espacés de 6 puis 7 cases → +26 %.

*Notes d’implémentation* : FightContext.GetPortalBonus + DamageEffectHandler (efficiency *= 1 + bonus × 0,01) dans le port C#. Hypothèse de ciblage (INCERTAIN) : cible effective = sortie + (portail d’entrée − lanceur), même distance que lanceur→entrée. Les masques `R`/`r` (via / hors portail) activent les effets bonus. Déclencheur `PST` sur le lanceur à chaque projection.

### 3.4 Passif « Le Portail Eliotrope » (14631) et Totem

Chaque sort projeté (déclencheur PST) donne +2 % dommages finaux et +2 % soins finaux pendant 3 tours, cumulable 10 fois. Vestige (14612) invoque le Totem Eliotrope (5109, 0 PA/0 PM, 15 % résistances, 1 par équipe, relance 3) : il se soigne de 15 % quand une entité traverse un portail et, quand un allié l’attaque, pose et active un portail sous cet allié (téléportation) et lui donne +1 PM (2 tours, cumul 2).

*Notes d’implémentation* : `1171`/`2971` (×% dommages/soins finaux) en buff cumulable (maxStack 10 de 14631 niv.2). Déclencheurs : `CPT` (une entité traverse un portail du porteur, INCERTAIN), `DBA` (dommages subis d’un allié).

### 3.5 Soins indirects (Distribution, Cataclysme, Orgueil)

Distribution (relance 3) : état sur une cible ; quand elle subit des dommages, les alliés en cercle 2 autour d’elle (hors elle) sont soignés de 25 % des dommages occasionnés. Cataclysme : Feu 34–38 en carré r1 aux ennemis ; les alliés du carré (état 2252) sont soignés de 50 % des dommages occasionnés. Orgueil : l’allié renvoie 30 % des dommages finaux subis à l’attaquant (effet 1223) et gagne +150 Puissance au tour suivant.

*Notes d’implémentation* : Effet 2973 `FightCasterSplashHeal` = soin proportionnel aux dommages finaux infligés par l’effet déclencheur ; non amplifié par les portails (IsPortalBonus exclut les splash heals).

### Invocations de la classe

| Monstre (id) | Grade utilisé | PA/PM | Rés. % | Joue ? | Emplacement | Notes |
|---|---|---|---|---|---|---|
| Totem Eliotrope (5109) | 1 | 0/0 | 15 partout | oui (passif) | aucun (1 par équipe) | Soin 15 % au passage d’un portail ; portail + 1 PM sous l’allié qui l’attaque |


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

### Paire 1 — Affront / Mépris

#### Affront (`14575`) — variante de base, débloqué niv. 1, grade 3

> Occasionne des dommages Air aux ennemis et repousse les cibles en zone.  La poussée n'est pas appliquée si le sort est projeté dans un portail.

- **3 PA**, PO 1–5 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Dommages Air 26 à 28 — ligne perpendiculaire r1; cibles: ennemis
  - le lanceur lance « Affront » (26192) niv.1 — ligne perpendiculaire r1; cibles: alliés/ennemis [non lancé via portail]
    - ↳ Repousse de 2 case(s) — cibles: alliés/ennemis
- Coup critique : Dommages Air 31 à 34
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Repousse de 2 case(s) — ligne perpendiculaire r1; cibles: alliés/ennemis [non lancé via portail]
- Grades : g1 (niv 1) vs g3: Dommages Air 15 à 17 (g1) → Dommages Air 26 à 28 (g3) | g2 (niv 66) vs g3: Dommages Air 20 à 22 (g2) → Dommages Air 26 à 28 (g3)
- Rôle : aoe, damage, push
- **Analyse tactique** : Air 26–28 en barre de 3 perpendiculaire + repousse 2 (sauf via portail).

#### Mépris (`14602`) — variante alternative, débloqué niv. 95, grade 2

> Occasionne des dommages Air aux ennemis et repousse les cibles en zone.

- **3 PA**, PO 1–7 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Dommages Air 24 à 27 — ligne 2; cibles: ennemis
  - Repousse de 2 case(s) — ligne 2; cibles: alliés/ennemis
- Coup critique : Dommages Air 29 à 32
- Grades : g1 (niv 95) vs g2: Dommages Air 19 à 22 (g1) → Dommages Air 24 à 27 (g2) ; PO max 6 (g1) → 7 (g2)
- Rôle : aoe, damage, push
- **Analyse tactique** : Air 24–27 sur 2 cases en ligne + repousse 2.


### Paire 2 — Audace / Tribulation

#### Audace (`14593`) — variante de base, débloqué niv. 1, grade 3

> Rapproche le lanceur de la cible et occasionne des dommages Eau aux ennemis. Le rapprochement n'est pas appliqué si le sort est projeté dans un portail.

- **3 PA**, PO 1–5 (non modifiable), sans ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 10 %
- Effets exécutés :
  - Le lanceur avance de 2 case(s) — cibles: alliés/ennemis [non lancé via portail]
  - Dommages Eau 26 à 29 — cibles: ennemis [non lancé via portail]
  - Dommages Eau 26 à 29 — cibles: alliés/ennemis [lancé via portail]
- Coup critique : Dommages Eau 31 à 35 ; Dommages Eau 31 à 35
- Grades : g1 (niv 1) vs g3: Dommages Eau 15 à 17 (g1) → Dommages Eau 26 à 29 (g3) ; Dommages Eau 15 à 17 (g1) → Dommages Eau 26 à 29 (g3) | g2 (niv 67) vs g3: Dommages Eau 20 à 23 (g2) → Dommages Eau 26 à 29 (g3) ; Dommages Eau 20 à 23 (g2) → Dommages Eau 26 à 29 (g3)
- Rôle : damage, self_move
- **Analyse tactique** : Se rapproche de 2 + Eau 26–29 ; via portail touche aussi les alliés (attention).

#### Tribulation (`14603`) — variante alternative, débloqué niv. 100, grade 2

> Occasionne des dommages Eau aux ennemis et attire les cibles vers le centre en zone.

- **3 PA**, PO 1–7 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Applique l'état « Tribulation cibles » (3979) — ligne perpendiculaire r1; cibles: alliés/ennemis; 1 tour
  - Dommages Eau 23 à 26 — ligne perpendiculaire r1; cibles: ennemis
  - le lanceur lance sur la cellule ciblée « Tribulation » (25448) niv.1 — cibles: lanceur
    - ↳ Applique l'état « Tribulation bloquée » (3980) — cibles: alliés/ennemis; infini; non désenvoûtable
  - le lanceur lance sur la cellule ciblée « Tribulation » (25448) niv.2 — cibles: lanceur
    - ↳ Attire de 1 case(s) — ligne perpendiculaire r1; cibles: alliés/ennemis [sans état « Tribulation bloquée » (3980); avec état « Tribulation cibles » (3979)]
    - ↳ Retire l'état « Tribulation bloquée » (3980) — toute la carte; cibles: alliés/ennemis [avec état « Tribulation bloquée » (3980)]
    - ↳ Retire l'état « Tribulation cibles » (3979) — toute la carte; cibles: alliés/ennemis [avec état « Tribulation cibles » (3979)]
- Coup critique : Dommages Eau 28 à 31
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Attire de 1 case(s) — ligne perpendiculaire r1; cibles: alliés/ennemis
- Grades : g1 (niv 100) vs g2: Dommages Eau 19 à 21 (g1) → Dommages Eau 23 à 26 (g2) ; PO max 6 (g1) → 7 (g2)
- Rôle : aoe, damage, pull
- **Analyse tactique** : Eau 23–26 en barre de 3 + attire vers le centre.


### Paire 3 — Commotion / Convulsion

#### Commotion (`14583`) — variante de base, débloqué niv. 1, grade 3

> Occasionne des dommages Terre aux ennemis et attire les cibles vers le centre en zone. L'attirance affecte le lanceur uniquement si le sort est projeté dans un portail.

- **3 PA**, PO 0–6 (non modifiable), ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Dommages Terre 23 à 26 — croix sans centre r1 (rayon min 1); cibles: ennemis
  - Attire de 1 case(s) — croix sans centre r1 (rayon min 1); cibles: alliés sauf lanceur/ennemis [non lancé via portail]
  - Attire de 1 case(s) — croix sans centre r1 (rayon min 1); cibles: alliés/ennemis [lancé via portail]
- Coup critique : Dommages Terre 28 à 31
- Grades : g1 (niv 1) vs g3: Dommages Terre 14 à 16 (g1) → Dommages Terre 23 à 26 (g3) | g2 (niv 68) vs g3: Dommages Terre 18 à 20 (g2) → Dommages Terre 23 à 26 (g3)
- Rôle : aoe, damage, pull
- **Analyse tactique** : Terre 23–26 autour de la case + attire 1 vers le centre.

#### Convulsion (`14605`) — variante alternative, débloqué niv. 105, grade 2

> Occasionne des dommages Terre aux ennemis et repousse les cibles vers les extrémités en zone.

- **3 PA**, PO 0–5 (non modifiable), ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Dommages Terre 24 à 27 — croix diagonale r1; cibles: ennemis
  - Repousse de 2 case(s) — croix diagonale r1; cibles: alliés/ennemis
- Coup critique : Dommages Terre 29 à 32
- Grades : g1 (niv 105) vs g2: Dommages Terre 19 à 22 (g1) → Dommages Terre 24 à 27 (g2)
- Rôle : aoe, damage, push
- **Analyse tactique** : Terre 24–27 en X + repousse 2 vers l’extérieur.


### Paire 4 — Rayon de Wakfu / Faisceau

#### Rayon de Wakfu (`14579`) — variante de base, débloqué niv. 1, grade 3

> Soigne les alliés et occasionne des dommages Feu aux ennemis en zone.

- **3 PA**, PO 1–5 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Soin Feu 26 à 28 — ligne 2; cibles: alliés
  - Dommages Feu 26 à 28 — ligne 2; cibles: ennemis
- Coup critique : Soin Feu 31 à 34 ; Dommages Feu 31 à 34
- Grades : g1 (niv 1) vs g3: Soin Feu 15 à 17 (g1) → Soin Feu 26 à 28 (g3) ; Dommages Feu 15 à 17 (g1) → Dommages Feu 26 à 28 (g3) | g2 (niv 69) vs g3: Soin Feu 21 à 23 (g2) → Soin Feu 26 à 28 (g3) ; Dommages Feu 21 à 23 (g2) → Dommages Feu 26 à 28 (g3)
- Rôle : aoe, damage, heal
- **Analyse tactique** : Soigne les alliés et frappe les ennemis sur 2 cases en ligne (Feu 26–28) : sort hybride très rentable via portail (+bonus aux soins).

#### Faisceau (`14606`) — variante alternative, débloqué niv. 110, grade 2

> Occasionne des dommages Feu en zone. Les dommages deviennent du vol de vie si le sort est projeté dans un portail.  N'affecte pas le lanceur.

- **3 PA**, PO 1–6 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Dommages Feu 23 à 26 — cône r1; cibles: alliés sauf lanceur/ennemis [non lancé via portail]
  - Vol de vie Feu 23 à 26 — cône r1; cibles: alliés sauf lanceur/ennemis [lancé via portail]
- Coup critique : Dommages Feu 28 à 31 ; Vol de vie Feu 28 à 31
- Grades : g1 (niv 110) vs g2: Dommages Feu 19 à 21 (g1) → Dommages Feu 23 à 26 (g2) ; Vol de vie Feu 19 à 21 (g1) → Vol de vie Feu 23 à 26 (g2) ; PO max 5 (g1) → 6 (g2)
- Rôle : aoe, damage, lifesteal
- **Analyse tactique** : Feu 23–26 en cône (pas le lanceur, touche les alliés) ; vol de vie via portail.


### Paire 5 — Portail / Errance

#### Portail (`14574`) — variante de base, débloqué niv. 5, grade 3

> Pose un portail.  Lorsque plusieurs portails sont actifs, ils permettent de se téléporter ou de projeter des sorts. Les dommages et soins des sorts projetés sont augmentés par les portails.  Les dommages et soins finaux du lanceur sont augmentés lorsqu'il projette un sort dans un portail (cumulable 10 fois). Les combattants ennemis ne peuvent pas emprunter un portail au premier tour de jeu.

- **1 PA**, PO 1–6 (non modifiable), ligne de vue, case libre, case sans portail ; 2 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis; infini
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : +2% Dommages finaux — cibles: lanceur; 3 tours ; +2% Soins finaux — cibles: lanceur; 3 tours
- Grades : g1 (niv 5) vs g3: PO max 4 (g1) → 6 (g3) | g2 (niv 72) vs g3: PO max 5 (g2) → 6 (g3)
- Rôle : portal, self_final_damage_buff
- **Analyse tactique** : Portail : 1 PA, PO 1–6 sur case libre, 2/tour.

#### Errance (`14604`) — variante alternative, débloqué niv. 115, grade 2

> Pose un portail.  Lorsque plusieurs portails sont actifs, ils permettent de se téléporter ou de projeter des sorts. Les dommages et soins des sorts projetés sont augmentés par les portails.  Les dommages et soins finaux du lanceur sont augmentés lorsqu'il projette un sort dans un portail (cumulable 10 fois). Les combattants ennemis ne peuvent pas emprunter un portail au premier tour de jeu.

- **1 PA**, PO 1–4 (non modifiable), ligne de vue, case sans portail ; 3 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis; infini
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : +2% Dommages finaux — cibles: lanceur; 3 tours ; +2% Soins finaux — cibles: lanceur; 3 tours
- Grades : g1 (niv 115) vs g2: PO max 3 (g1) → 4 (g2)
- Rôle : portal, self_final_damage_buff
- **Analyse tactique** : Errance : 1 PA, PO 1–4, 3/tour, posable sous une entité.


### Paire 6 — Neutral / Interruption

#### Neutral (`14582`) — variante de base, débloqué niv. 10, grade 3

> Désactive un portail.  Le coût en PA du sort est remboursé.

- **1 PA**, PO 0–8 (non modifiable), ligne de vue ; 2 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Désactive un portail — cibles: alliés/ennemis; 1 tour
  - Rend 1 PA — cibles: lanceur
- Grades : g1 (niv 10) vs g3: PO max 6 (g1) → 8 (g3) | g2 (niv 77) vs g3: PO max 7 (g2) → 8 (g3)
- Rôle : ap_refund, portal
- **Analyse tactique** : Désactive un portail (gratuit) : couper la route aux ennemis.

#### Interruption (`14607`) — variante alternative, débloqué niv. 120, grade 2

> Désactive tous les portails.

- **1 PA**, PO 0–0 (non modifiable), sans ligne de vue ; 2 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Désactive un portail — toute la carte; cibles: alliés/ennemis; 1 tour
- Grades : g1 (niv 120) vs g2: lancers/tour 1 (g1) → 2 (g2)
- Rôle : portal
- **Analyse tactique** : Désactive tous les portails.


### Paire 7 — Persiflage / Sinécure

#### Persiflage (`14620`) — variante de base, débloqué niv. 15, grade 3

> Retire de la Portée et occasionne des dommages Terre. Le retrait devient un vol si le sort est projeté dans un portail.

- **3 PA**, PO 1–6 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 15 %
- Effets exécutés :
  - le lanceur lance « Persiflage » (31024) niv.1 — cibles: alliés/ennemis [non lancé via portail]
    - ↳ -3 PO — cibles: alliés/ennemis; 1 tour
  - le lanceur lance « Persiflage » (31024) niv.2 — cibles: alliés/ennemis [lancé via portail]
    - ↳ Vole 3 PO — cibles: alliés/ennemis; 1 tour
  - Dommages Terre 25 à 29 — cibles: alliés/ennemis
- Coup critique : Dommages Terre 30 à 35
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : -3 PO — cibles: alliés/ennemis [non lancé via portail]; 1 tour ; Vole 3 PO — cibles: alliés/ennemis [lancé via portail]; 1 tour
- Grades : g1 (niv 15) vs g3: Dommages Terre 16 à 18 (g1) → Dommages Terre 25 à 29 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 82) vs g3: Dommages Terre 20 à 23 (g2) → Dommages Terre 25 à 29 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : damage, range_removal, range_steal
- **Analyse tactique** : Terre 25–29 + -3 PO (vol via portail) : contre les lanceurs à distance.

#### Sinécure (`14610`) — variante alternative, débloqué niv. 125, grade 2

> Vole de la vie dans l'élément Air aux ennemis ou soigne l'allié ciblé. Réduit également les Résistances Poussée de l'ennemi ciblé si le sort est projeté dans un portail.

- **2 PA**, PO 1–6 (modifiable), ligne de vue ; 2 lancer(s)/tour, cumul max 2, CC 5 %
- Effets exécutés :
  - Vol de vie Air 12 à 14 — cibles: ennemis
  - Soin Air 12 à 14 — cibles: alliés
  - -40 Résistance poussée — cibles: ennemis [lancé via portail]; 2 tours
- Coup critique : Vol de vie Air 15 à 17 ; Soin Air 15 à 17
- Grades : g1 (niv 125) vs g2: Vol de vie Air 9 à 11 (g1) → Vol de vie Air 12 à 14 (g2) ; Soin Air 9 à 11 (g1) → Soin Air 12 à 14 (g2) ; -30 Résistance poussée (g1) → -40 Résistance poussée (g2) ; PO max 5 (g1) → 6 (g2)
- Rôle : damage, heal, lifesteal, push_res_debuff
- **Analyse tactique** : Vol de vie Air / soin 12–14 (2 PA).


### Paire 8 — Cicatrisation / Conjuration

#### Cicatrisation (`14587`) — variante de base, débloqué niv. 20, grade 3

> Soigne les alliés en zone.

- **3 PA**, PO 0–2 (non modifiable), ligne de vue ; 1 lancer(s)/tour, cumul max 1, CC 15 %
- Effets exécutés :
  - Soin = 8% des PV max — cercle r2; cibles: alliés
- Coup critique : Soin = 10% des PV max
- Grades : g1 (niv 20) vs g3: Soin = 6% des PV max (g1) → Soin = 8% des PV max (g3) | g2 (niv 87) vs g3: Soin = 7% des PV max (g2) → Soin = 8% des PV max (g3)
- Rôle : heal
- **Analyse tactique** : Soin 8 % PV max en cercle 2 (1/tour) : soin de groupe.

#### Conjuration (`14622`) — variante alternative, débloqué niv. 130, grade 2

> Réduit la durée des effets sur la cible. Réduit également les soins reçus par l'ennemi ciblé si le sort est projeté dans un portail.

- **2 PA**, PO 1–6 (non modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, cumul max 1, CC 0 %
- Effets exécutés :
  - Réduit la durée des effets de 1 tour(s) — cibles: alliés/ennemis
  - Soins reçus x70% — cibles: ennemis [lancé via portail]; déclenché quand le porteur est soigné (déclencheur actif 2 tour(s))
- Grades : g1 (niv 130) vs g2: PO max 5 (g1) → 6 (g2)
- Rôle : heal_modifier, shorten_effects
- **Analyse tactique** : Réduit la durée des effets (désenvoûtement partiel) ; anti-soin ×70 % via portail.


### Paire 9 — Outrage / Aplomb

#### Outrage (`14608`) — variante de base, débloqué niv. 25, grade 3

> Occasionne des dommages Feu. Augmente également la Portée du lanceur si le sort est projeté dans un portail.

- **3 PA**, PO 1–7 (modifiable), ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Dommages Feu 24 à 28 — cibles: alliés/ennemis
  - +1 PO — cibles: lanceur [lancé via portail]; 2 tours
- Coup critique : Dommages Feu 29 à 34
- Grades : g1 (niv 25) vs g3: Dommages Feu 15 à 18 (g1) → Dommages Feu 24 à 28 (g3) ; PO max 5 (g1) → 7 (g3) | g2 (niv 92) vs g3: Dommages Feu 19 à 23 (g2) → Dommages Feu 24 à 28 (g3) ; PO max 6 (g2) → 7 (g3)
- Rôle : ally_range_buff, damage
- **Analyse tactique** : Feu 24–28 ; +1 PO via portail.

#### Aplomb (`14618`) — variante alternative, débloqué niv. 135, grade 1

> Occasionne des dommages Eau. Augmente également les PM du lanceur si le sort est projeté dans un portail.

- **4 PA**, PO 1–8 (modifiable), ligne de vue, case occupée ; 3 lancer(s)/tour, 2/cible, CC 20 %
- Effets exécutés :
  - Dommages Eau 32 à 36 — cibles: alliés/ennemis
  - +1 PM — cibles: lanceur [lancé via portail]; 1 tour
- Coup critique : Dommages Eau 39 à 43
- Rôle : ally_mp_buff, damage
- **Analyse tactique** : Eau 32–36 à 1–8 PO ; +1 PM via portail.


### Paire 10 — Odyssée / Exode

#### Odyssée (`14589`) — variante de base, débloqué niv. 30, grade 3

> Sur un ennemi : éloigne le lanceur de la cible et attire la cible. Sur un allié : repousse la cible et rapproche le lanceur vers elle.

- **1 PA**, PO 1–4 (non modifiable), ligne de vue ; 2 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - Le lanceur recule de 1 case(s) — cibles: ennemis
  - Attire de 1 case(s) — cibles: ennemis
  - Repousse de 1 case(s) — cibles: alliés
  - Le lanceur avance de 1 case(s) — cibles: alliés
- Grades : g1 (niv 30) vs g3: PO max 2 (g1) → 4 (g3) | g2 (niv 97) vs g3: PO max 3 (g2) → 4 (g3)
- Rôle : pull, push, self_move
- **Analyse tactique** : Micro-placement 1 PA (ennemi : recule + attire ; allié : repousse + avance).

#### Exode (`14616`) — variante alternative, débloqué niv. 140, grade 1

> Téléporte le lanceur symétriquement par rapport à la cible.

- **2 PA**, PO 1–1 (non modifiable), lancer en ligne, en diagonale, sans ligne de vue, case occupée ; 1 lancer(s)/tour, CC 0 %
- Condition de lancer (états du lanceur) : `HS!7` — lanceur PAS dans l'état « Pesanteur » (7)
- Effets exécutés :
  - Téléportation symétrique par rapport à la cible — cibles: alliés/ennemis
- Rôle : teleport
- **Analyse tactique** : Téléport symétrique autour d’une entité adjacente.


### Paire 11 — Insolence / Camouflet

#### Insolence (`14637`) — variante de base, débloqué niv. 35, grade 3

> Éloigne le lanceur de la cible et occasionne des dommages Eau aux ennemis. Le recul n'est pas appliqué si le sort est projeté dans un portail.

- **3 PA**, PO 1–6 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 10 %
- Effets exécutés :
  - Le lanceur recule de 2 case(s) — cibles: alliés/ennemis [non lancé via portail]
  - Dommages Eau 25 à 28 — cibles: ennemis [non lancé via portail]
  - Dommages Eau 25 à 28 — cibles: alliés/ennemis [lancé via portail]
- Coup critique : Dommages Eau 30 à 34 ; Dommages Eau 30 à 34
- Grades : g1 (niv 35) vs g3: Dommages Eau 16 à 18 (g1) → Dommages Eau 25 à 28 (g3) ; Dommages Eau 16 à 18 (g1) → Dommages Eau 25 à 28 (g3) | g2 (niv 102) vs g3: Dommages Eau 20 à 23 (g2) → Dommages Eau 25 à 28 (g3) ; Dommages Eau 20 à 23 (g2) → Dommages Eau 25 à 28 (g3)
- Rôle : damage, self_move
- **Analyse tactique** : Recule de 2 + Eau 25–28.

#### Camouflet (`14590`) — variante alternative, débloqué niv. 145, grade 1

> Occasionne des dommages Terre aux ennemis en zone. Retire également des Dommages aux ennemis en zone si le sort est projeté dans un portail.

- **3 PA**, PO 1–4 (modifiable), ligne de vue ; 2 lancer(s)/tour, cumul max 1, CC 15 %
- Effets exécutés :
  - Dommages Terre 24 à 27 — croix r1; cibles: ennemis
  - -40 Dommages — croix r1; cibles: ennemis [lancé via portail]; 1 tour
- Coup critique : Dommages Terre 29 à 33
- Rôle : aoe, damage, damage_debuff
- **Analyse tactique** : Terre 24–27 en croix ; -40 Dommages via portail.


### Paire 12 — Cabale / Résilience

#### Cabale (`14617`) — variante de base, débloqué niv. 40, grade 3

> Augmente la Puissance et les PM des alliés en zone. Le bonus est plus important si le sort est projeté dans un portail.

- **2 PA**, PO 0–6 (modifiable), ligne de vue ; 1 lancer(s)/tour, cumul max 1, CC 0 %
- Effets exécutés :
  - Désenvoûte les effets du sort « Cabale » (14617) — croix r1; cibles: alliés
  - +100 Puissance — croix r1; cibles: alliés [non lancé via portail]; 2 tours
  - +1 PM — croix r1; cibles: alliés [non lancé via portail]; 2 tours
  - +200 Puissance — croix r1; cibles: alliés [lancé via portail]; 2 tours
  - +2 PM — croix r1; cibles: alliés [lancé via portail]; 2 tours
- Grades : g1 (niv 40) vs g3: +50 Puissance (g1) → +100 Puissance (g3) ; +100 Puissance (g1) → +200 Puissance (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 107) vs g3: +75 Puissance (g2) → +100 Puissance (g3) ; +150 Puissance (g2) → +200 Puissance (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : ally_mp_buff, ally_power_buff
- **Analyse tactique** : +100 Puissance +1 PM (croix r1) ; +200/+2 PM via portail : excellent buff de groupe.

#### Résilience (`14615`) — variante alternative, débloqué niv. 150, grade 1

> Soigne l'allié ciblé. Augmente également ses soins reçus si le sort est projeté dans un portail.

- **3 PA**, PO 0–4 (modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, cumul max 1, CC 15 %
- Effets exécutés :
  - Soin = 10% des PV max — cibles: alliés
  - Soins reçus x115% — cibles: alliés [lancé via portail]; déclenché quand le porteur est soigné (déclencheur actif 2 tour(s))
- Coup critique : Soin = 12% des PV max
- Rôle : heal, heal_modifier
- **Analyse tactique** : Soin 10 % PV max ; +15 % soins reçus via portail.


### Paire 13 — Brimade / Cataclysme

#### Brimade (`14592`) — variante de base, débloqué niv. 45, grade 3

> Occasionne des dommages Air aux ennemis en zone et repousse les cibles depuis le centre de la zone. La poussée affecte le lanceur uniquement si le sort est projeté dans un portail.

- **3 PA**, PO 0–6 (non modifiable), sans ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Dommages Air 23 à 25 — croix sans centre r1; cibles: ennemis
  - Repousse de 2 case(s) — croix sans centre r1; cibles: alliés sauf lanceur/ennemis [non lancé via portail]
  - Repousse de 2 case(s) — croix sans centre r1; cibles: alliés/ennemis [lancé via portail]
- Coup critique : Dommages Air 28 à 30
- Grades : g1 (niv 45) vs g3: Dommages Air 14 à 16 (g1) → Dommages Air 23 à 25 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 112) vs g3: Dommages Air 18 à 20 (g2) → Dommages Air 23 à 25 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : aoe, damage, push
- **Analyse tactique** : Air 23–25 autour de la case + repousse 2 depuis le centre.

#### Cataclysme (`14619`) — variante alternative, débloqué niv. 155, grade 1

> Occasionne des dommages Feu aux ennemis et soigne les alliés selon les dommages occasionnés en zone.

- **4 PA**, PO 0–4 (non modifiable), lancer en ligne, sans ligne de vue ; 1 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Applique l'état « Cataclysme » (2252) — carré r1; cibles: alliés; 1 tour
  - le lanceur lance « Cataclysme » (14630) niv.1 — carré r1; cibles: ennemis
    - ↳ le lanceur lance « Cataclysme » (14630) niv.2 — cibles: ennemis; déclenché quand le porteur subit des dommages ou à la mort du porteur (tué par dommages) (déclencheur actif 1 tour(s))
      - ↳ Désenvoûte les effets du sort « Cataclysme » (14630) — cibles: ennemis
      - ↳ Soin du lanceur = 50% des dommages occasionnés — toute la carte; cibles: alliés [avec état « Cataclysme » (2252)]
  - Dommages Feu 34 à 38 — carré r1; cibles: ennemis
  - la cible lance sur elle-même « Cataclysme » (14630) niv.3 — cibles: lanceur
    - ↳ Désenvoûte les effets du sort « Cataclysme » (14630) — toute la carte; cibles: ennemis
    - ↳ Retire l'état « Cataclysme » (2252) — toute la carte; cibles: alliés/ennemis
- Coup critique : Dommages Feu 41 à 46
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Soin du lanceur = 50% des dommages occasionnés — carré r1; cibles: alliés [avec état « Cataclysme » (2252)]
- Rôle : aoe, damage, heal
- **Analyse tactique** : Feu 34–38 en carré r1 + soigne les alliés du carré de 50 % des dommages.


### Paire 14 — Sillage / Stupeur

#### Sillage (`14591`) — variante de base, débloqué niv. 50, grade 3

> Pose un portail sous le lanceur et le téléporte sur la case ciblée.

- **3 PA**, PO 1–4 (non modifiable), ligne de vue, case libre ; relance 3 tour(s), relance initiale 1, CC 0 %
- Condition de lancer (états du lanceur) : `HS!7` — lanceur PAS dans l'état « Pesanteur » (7)
- Effets exécutés :
  - le lanceur lance « Sillage » (31021) niv.1 — cibles: lanceur
    - ↳ Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Portail » (3737)]; infini
    - ↳ Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Errance » (3738)]; infini
  - Téléporte le lanceur sur la case ciblée — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Portail » (3737)]; infini ; Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Errance » (3738)]; infini
- Grades : g1 (niv 50) vs g3: PO max 3 (g1) → 4 (g3) ; relance 4 (g1) → 3 (g3) | g2 (niv 117) vs g3: PO max 3 (g2) → 4 (g3)
- Rôle : portal, teleport
- **Analyse tactique** : Portail sous le lanceur + téléportation sur la case ciblée (1–4).

#### Stupeur (`14585`) — variante alternative, débloqué niv. 160, grade 1

> Pose deux portails sous le lanceur et la cible et échange de position avec cette dernière.

- **2 PA**, PO 1–5 (non modifiable), ligne de vue, case occupée ; relance 3 tour(s), relance initiale 1, CC 0 %
- Condition de lancer (états du lanceur) : `HS!7` — lanceur PAS dans l'état « Pesanteur » (7)
- Effets exécutés :
  - le lanceur lance « Stupeur » (31023) niv.1 — cibles: alliés/ennemis
    - ↳ le lanceur lance « Stupeur » (31023) niv.2 — cibles: lanceur
      - ↳ Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Portail » (3737)]; infini
      - ↳ Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Errance » (3738)]; infini
    - ↳ le lanceur lance « Stupeur » (31023) niv.2 — cibles: alliés/ennemis
  - Échange de positions avec le lanceur — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Portail » (3737)]; infini ; Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Errance » (3738)]; infini
- Rôle : portal, swap
- **Analyse tactique** : Deux portails (lanceur et cible) + échange de position.


### Paire 15 — Thérapie / Poing Fulgurant

#### Thérapie (`14581`) — variante de base, débloqué niv. 55, grade 3

> Vole de la vie dans l'élément Terre aux ennemis ou soigne l'allié ciblé et attire la cible.

- **3 PA**, PO 1–7 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 10 %
- Effets exécutés :
  - Vol de vie Terre 23 à 25 — cibles: ennemis
  - Soin Terre 23 à 25 — cibles: alliés
  - Attire de 2 case(s) — cibles: alliés/ennemis
- Coup critique : Vol de vie Terre 28 à 30 ; Soin Terre 28 à 30
- Grades : g1 (niv 55) vs g3: Vol de vie Terre 15 à 17 (g1) → Vol de vie Terre 23 à 25 (g3) ; Soin Terre 15 à 17 (g1) → Soin Terre 23 à 25 (g3) ; PO max 5 (g1) → 7 (g3) | g2 (niv 122) vs g3: Vol de vie Terre 20 à 22 (g2) → Vol de vie Terre 23 à 25 (g3) ; Soin Terre 20 à 22 (g2) → Soin Terre 23 à 25 (g3) ; PO max 6 (g2) → 7 (g3)
- Rôle : damage, heal, lifesteal, pull
- **Analyse tactique** : Vol de vie Terre / soin allié 23–25 + attire 2.

#### Poing Fulgurant (`14576`) — variante alternative, débloqué niv. 165, grade 1

> Occasionne des dommages Eau aux ennemis et repousse la cible. La poussée est plus importante si le sort est projeté dans un portail.

- **3 PA**, PO 1–4 (non modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 15 %
- Effets exécutés :
  - Dommages Eau 23 à 25 — cibles: ennemis
  - Repousse de 2 case(s) — cibles: alliés/ennemis [non lancé via portail]
  - Repousse de 4 case(s) — cibles: alliés/ennemis [lancé via portail]
- Coup critique : Dommages Eau 28 à 30
- Rôle : damage, push
- **Analyse tactique** : Eau 23–25 + repousse 2 (4 via portail).


### Paire 16 — Distribution / Orgueil

#### Distribution (`14577`) — variante de base, débloqué niv. 60, grade 3

> Soigne les alliés d'une partie des dommages occasionnés à la cible en zone autour d'elle.

- **2 PA**, PO 0–6 (modifiable), ligne de vue ; relance 3 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - le lanceur lance « Distribution » (14578) niv.3 — cibles: alliés/ennemis; déclenché quand le porteur subit des dommages ou à la mort du porteur (tué par dommages) (déclencheur actif 1 tour(s))
    - ↳ Soin du lanceur = 25% des dommages occasionnés — cercle r2 (rayon min 1); cibles: alliés
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Soin du lanceur = 25% des dommages occasionnés — cibles: alliés; déclenché quand le porteur subit des dommages ou à la mort du porteur (tué par dommages) (déclencheur actif 1 tour(s))
- Grades : g1 (niv 60) vs g3: le lanceur lance « Distribution » (14578) niv.1 (g1) → le lanceur lance « Distribution » (14578) niv.3 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 127) vs g3: le lanceur lance « Distribution » (14578) niv.2 (g2) → le lanceur lance « Distribution » (14578) niv.3 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : heal
- **Analyse tactique** : Les dommages subis par la cible soignent les alliés autour (25 %).

#### Orgueil (`14614`) — variante alternative, débloqué niv. 170, grade 1

> Applique l'état Orgueil sur l'allié ciblé : • Renvoie une partie des dommages subis par la cible à son attaquant.  Augmente la Puissance de la cible au tour suivant.

- **2 PA**, PO 0–6 (non modifiable), ligne de vue ; relance 3 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - Applique l'état « Orgueil » (6049) — cibles: alliés; 1 tour
  - la cible lance sur elle-même « Orgueil » (31017) niv.1 — cibles: alliés; déclenché quand le porteur subit des dommages ou à la mort du porteur (tué par dommages) (déclencheur actif 1 tour(s))
    - ↳ Renvoie/propage 30% des dommages finaux subis (en zone) — cibles: alliés/ennemis [= cible déclenchante]
  - +150 Puissance — cibles: alliés; 1 tour, après 1 tour(s)
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Renvoie/propage 30% des dommages finaux subis (en zone) — cibles: alliés; déclenché quand le porteur subit des dommages ou à la mort du porteur (tué par dommages) (déclencheur actif 1 tour(s))
- Rôle : ally_power_buff, damage_return
- **Analyse tactique** : Renvoi 30 % des dommages + 150 Puissance au tour suivant.


### Paire 17 — Affliction / Offense

#### Affliction (`14584`) — variante de base, débloqué niv. 65, grade 3

> Vole de la vie dans l'élément Eau aux ennemis ou soigne l'allié ciblé. Applique également un poison Eau de début de tour sur l'ennemi ciblé ou soigne l'allié ciblé au début de son tour si le sort est projeté dans un portail.

- **4 PA**, PO 1–6 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 20 %
- Effets exécutés :
  - Vol de vie Eau 23 à 26 — cibles: ennemis
  - Soin Eau 23 à 26 — cibles: alliés
  - le lanceur lance « Affliction » (29098) niv.5 — cibles: alliés/ennemis [lancé via portail]
    - ↳ Dommages Eau 23 à 26 — cibles: ennemis; déclenché en début de tour (déclencheur actif 1 tour(s))
    - ↳ Soin Eau 23 à 26 — cibles: alliés; déclenché en début de tour (déclencheur actif 1 tour(s))
- Coup critique : Vol de vie Eau 28 à 32 ; Dommages Eau 28 à 32 ; Soin Eau 28 à 32 ; Soin Eau 28 à 32
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Dommages Eau 23 à 26 — cibles: ennemis [lancé via portail]; déclenché en début de tour (déclencheur actif 1 tour(s)) ; Soin Eau 23 à 26 — cibles: alliés [lancé via portail]; déclenché en début de tour (déclencheur actif 1 tour(s))
- Grades : g1 (niv 65) vs g3: Vol de vie Eau 14 à 16 (g1) → Vol de vie Eau 23 à 26 (g3) ; Soin Eau 14 à 16 (g1) → Soin Eau 23 à 26 (g3) ; le lanceur lance « Affliction » (29098) niv.1 (g1) → le lanceur lance « Affliction » (29098) niv.5 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 131) vs g3: Vol de vie Eau 18 à 21 (g2) → Vol de vie Eau 23 à 26 (g3) ; Soin Eau 18 à 21 (g2) → Soin Eau 23 à 26 (g3) ; le lanceur lance « Affliction » (29098) niv.3 (g2) → le lanceur lance « Affliction » (29098) niv.5 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : damage, heal, lifesteal, poison
- **Analyse tactique** : Vol de vie Eau / soin ; poison ou soin de début de tour via portail.

#### Offense (`14588`) — variante alternative, débloqué niv. 175, grade 1

> Occasionne des dommages Feu en zone. N'affecte pas le lanceur.

- **4 PA**, PO 0–7 (non modifiable), ligne de vue ; 1 lancer(s)/tour, CC 20 %
- Effets exécutés :
  - Dommages Feu 30 à 34 — cercle r2; cibles: alliés sauf lanceur/ennemis
- Coup critique : Dommages Feu 36 à 41
- Rôle : aoe, damage
- **Analyse tactique** : Feu 30–34 en cercle 2 (touche les alliés, pas le lanceur).


### Paire 18 — Transcendance / Exil

#### Transcendance (`14580`) — variante de base, débloqué niv. 70, grade 2

> Rend le lanceur Intaclable et augmente le nombre de lancers par tour du sort Portail ou la Portée maximale du sort Errance.

- **2 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 3 tour(s), relance initiale 1, CC 0 %
- Effets exécutés :
  - Applique l'état « Intaclable » (96) — cibles: lanceur; 1 tour; non désenvoûtable
  - Sort « Portail » (14574) : +1 lancer(s)/tour — cibles: lanceur [avec état « Portail » (3737)]; 1 tour
  - Sort « Errance » (14604) : +2 portée max — cibles: lanceur [avec état « Errance » (3738)]; 1 tour
- Grades : g1 (niv 70) vs g2: relance 4 (g1) → 3 (g2)
- Rôle : untackleable
- **Analyse tactique** : Intaclable + 1 lancer de Portail (ou +2 PO d’Errance) pour le tour.

#### Exil (`14609`) — variante alternative, débloqué niv. 180, grade 1

> Pose et active un portail sous une cible.

- **2 PA**, PO 0–6 (non modifiable), ligne de vue, case occupée ; relance 2 tour(s), relance initiale 1, CC 0 %
- Effets exécutés :
  - Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Portail » (3737)]; infini
  - Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Errance » (3738)]; infini
  - Téléportail (traverse le réseau de portails) — cibles: alliés/ennemis
- Rôle : portal, teleport
- **Analyse tactique** : Portail sous une cible + la téléporte via le réseau (relance 2).


### Paire 19 — Raillerie / Sarcasme

#### Raillerie (`14595`) — variante de base, débloqué niv. 75, grade 2

> Occasionne des dommages Air. Retire également des PM si le sort est projeté dans un portail.

- **4 PA**, PO 1–6 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 20 %
- Effets exécutés :
  - Dommages Air 32 à 36 — cibles: alliés/ennemis
  - -3 PM (esquivable) — cibles: alliés/ennemis [lancé via portail]; 1 tour
- Coup critique : Dommages Air 38 à 43
- Grades : g1 (niv 75) vs g2: Dommages Air 26 à 29 (g1) → Dommages Air 32 à 36 (g2) ; PO max 5 (g1) → 6 (g2)
- Rôle : damage, mp_removal
- **Analyse tactique** : Air 32–36 ; -3 PM via portail : retrait PM principal.

#### Sarcasme (`14638`) — variante alternative, débloqué niv. 185, grade 1

> Occasionne des dommages Terre.  Retire également des PA si le sort est projeté dans un portail.

- **4 PA**, PO 1–4 (non modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 20 %
- Effets exécutés :
  - Dommages Terre 34 à 38 — cibles: alliés/ennemis
  - -3 PA (esquivable) — cibles: alliés/ennemis [lancé via portail]; 1 tour
- Coup critique : Dommages Terre 41 à 46
- Rôle : ap_removal, damage
- **Analyse tactique** : Terre 34–38 ; -3 PA via portail.


### Paire 20 — Résonance / Vestige

#### Résonance (`14611`) — variante de base, débloqué niv. 80, grade 2

> Applique l'état Résonance sur la cible : • Pose et active un portail sous la cible sur la première attaque subie.

- **2 PA**, PO 0–6 (non modifiable), ligne de vue ; relance 3 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - Applique l'état « Résonance » (6251) — cibles: alliés/ennemis; 1 tour
  - le lanceur lance « Résonance » (31020) niv.1 — cibles: alliés/ennemis; déclenché quand le porteur subit des dommages ou à la mort du porteur (tué par dommages) (déclencheur actif 1 tour(s))
    - ↳ Désenvoûte les effets du sort « Résonance » (14611) — cibles: alliés/ennemis
    - ↳ Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Portail » (3737)]; infini
    - ↳ Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Errance » (3738)]; infini
    - ↳ Téléportail (traverse le réseau de portails) — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Portail » (3737)]; infini; déclenché quand le porteur subit des dommages ou à la mort du porteur (tué par dommages) (déclencheur actif 1 tour(s)) ; Pose un portail (+2% dommages par case entre 2 portails; base 0%) — cibles: alliés/ennemis [lanceur avec état « Errance » (3738)]; infini; déclenché quand le porteur subit des dommages ou à la mort du porteur (tué par dommages) (déclencheur actif 1 tour(s)) ; Téléportail (traverse le réseau de portails) — cibles: alliés/ennemis; déclenché quand le porteur subit des dommages ou à la mort du porteur (tué par dommages) (déclencheur actif 1 tour(s))
- Grades : g1 (niv 80) vs g2: PO max 5 (g1) → 6 (g2)
- Rôle : portal, teleport
- **Analyse tactique** : À la 1re attaque subie, portail sous la cible + téléportation (piège à ennemi ou sauvetage d’allié).

#### Vestige (`14612`) — variante alternative, débloqué niv. 190, grade 1

> Invoque un Totem Eliotrope qui peut poser et activer un portail sous son attaquant allié et augmenter ses PM (cumulable 2 fois). Le Totem se soigne lorsqu'une entité traverse un portail.  Il ne peut y avoir qu'un seul Totem Eliotrope par équipe. Si le Totem est encore présent et que celui-ci est ré-invoqué, l'ancien est détruit pour laisser place au nouveau.

- **2 PA**, PO 1–3 (non modifiable), ligne de vue, case libre ; relance 3 tour(s), relance initiale 1, relance globale -1 (INCERTAIN : partagée), CC 0 %
- Effets exécutés :
  - Invoque Totem Eliotrope (5109) grade 1 — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : +1 PM — cibles: alliés; 2 tours ; Soin = 15% des PV max — cibles: alliés; déclenché quand une entité traverse un portail du porteur (INCERTAIN) (déclencheur actif 63 tour(s))
- Rôle : ally_mp_buff, heal, portal, summon
- **Analyse tactique** : Totem Eliotrope (soin, portails sous les alliés qui le frappent).


### Paire 21 — Extinction / Sermon

#### Extinction (`14594`) — variante de base, débloqué niv. 85, grade 2

> Occasionne des dommages Feu. Applique également un poison Feu de fin de tour sur la cible si le sort est projeté dans un portail.

- **5 PA**, PO 1–5 (modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, cumul max 1, CC 25 %
- Effets exécutés :
  - Dommages Feu 32 à 35 — cibles: alliés/ennemis
  - Dommages Feu 32 à 35 — cibles: alliés/ennemis [lancé via portail]; déclenché en fin de tour (déclencheur actif 1 tour(s))
- Coup critique : Dommages Feu 38 à 42 ; Dommages Feu 38 à 42
- Grades : g1 (niv 85) vs g2: Dommages Feu 26 à 28 (g1) → Dommages Feu 32 à 35 (g2) ; Dommages Feu 26 à 28 (g1) → Dommages Feu 32 à 35 (g2) ; PO max 4 (g1) → 5 (g2)
- Rôle : damage, poison
- **Analyse tactique** : Feu 32–35 (5 PA) ; poison Feu de fin de tour via portail (≈ double dégâts).

#### Sermon (`14613`) — variante alternative, débloqué niv. 195, grade 1

> Occasionne des dommages Air aux ennemis et repousse la cible. La poussée est plus importante si le sort est projeté dans un portail.

- **4 PA**, PO 1–5 (modifiable), ligne de vue ; 3 lancer(s)/tour, 1/cible, CC 20 %
- Effets exécutés :
  - Dommages Air 38 à 42 — cibles: ennemis
  - Repousse de 2 case(s) — cibles: alliés/ennemis [non lancé via portail]
  - Repousse de 4 case(s) — cibles: alliés/ennemis [lancé via portail]
- Coup critique : Dommages Air 46 à 50
- Rôle : damage, push
- **Analyse tactique** : Air 38–42 (4 PA) + repousse 2 (4 via portail) : meilleur sort Air.


### Paire 22 — Entraide / Coalition

#### Entraide (`14596`) — variante de base, débloqué niv. 90, grade 2

> Applique l'état Entraide sur le lanceur, qui applique des effets lorsqu'une entité traverse un portail :  • Augmente les PA du lanceur. • Soigne le lanceur et ses alliés en zone autour de lui.

- **2 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 3 tour(s), relance globale -1 (INCERTAIN : partagée), cumul max 2, CC 0 %
- Effets exécutés :
  - le lanceur lance « Entraide » (14598) niv.1 — cibles: lanceur; déclenché quand une entité traverse un portail du porteur (INCERTAIN) (déclencheur actif 2 tour(s))
    - ↳ +1 PA — cibles: lanceur; 1 tour
    - ↳ Soin = 3% des PV max — cercle r2; cibles: alliés
  - le lanceur lance « Entraide » (14598) niv.2 — cibles: lanceur
    - ↳ Applique l'état « Entraide » (6252) — cibles: lanceur; 2 tours; non désenvoûtable
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Applique l'état « Entraide » (6252) — cibles: lanceur; 2 tours; non désenvoûtable ; +1 PA — cibles: lanceur; 1 tour ; Soin = 3% des PV max — cercle r2; cibles: alliés
- Grades : g1 (niv 90) vs g2: relance 4 (g1) → 3 (g2)
- Rôle : heal, self_ap_buff
- **Analyse tactique** : +1 PA et soin 3 % en zone à chaque passage de portail (2 tours).

#### Coalition (`14621`) — variante alternative, débloqué niv. 200, grade 1

> Augmente les PA de l'allié ciblé et lui applique l'état Coalition : • Soigne la cible lorsqu'elle traverse un portail.  Le bonus est plus important si le sort est projeté dans un portail.

- **2 PA**, PO 0–4 (non modifiable), ligne de vue ; 1 lancer(s)/tour, cumul max 1, CC 0 %
- Effets exécutés :
  - Désenvoûte les effets du sort « Coalition » (14621) — cibles: alliés
  - +1 PA — cibles: alliés [non lancé via portail]; 2 tours
  - +2 PA — cibles: alliés [lancé via portail]; 2 tours
  - Applique l'état « Coalition » (6249) — cibles: alliés; 2 tours
  - le lanceur lance « Coalition » (31018) niv.1 — cibles: alliés; déclenché quand le porteur passe par un portail (déclencheur actif 2 tour(s))
    - ↳ Soin = 3% des PV max — cibles: alliés
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Soin = 3% des PV max — cibles: alliés
- Rôle : ally_ap_buff, heal
- **Analyse tactique** : +1 PA (+2 via portail) à un allié + soin 3 % quand il traverse un portail.


## 5. Choix des variantes (« sets de sorts ») par rôle

### Set « Passeur » (DPS + soutien, recommandé en groupe de 4)

Variante Portail (PO 6, 2/tour) pour un réseau long ; sorts à bonus portail forts (Raillerie -3 PM, Sarcasme -3 PA, Sermon, Extinction) ; Cabale/Coalition pour le groupe ; Cicatrisation/Résilience pour les soins.

| Paire | Choix | Pourquoi |
|---|---|---|
| 1 | Affront | zone Air |
| 2 | Tribulation | regroupe |
| 3 | Commotion | regroupe |
| 4 | Rayon de Wakfu | soin + dégâts |
| 5 | Portail | réseau long |
| 6 | Neutral | gratuit |
| 7 | Persiflage | -3 PO |
| 8 | Cicatrisation | soin de zone |
| 9 | Aplomb | Eau 32–36 PO 8 |
| 10 | Odyssée | placement 1 PA |
| 11 | Camouflet | -40 dommages |
| 12 | Cabale | +200 Puissance +2 PM |
| 13 | Cataclysme | zone + soin |
| 14 | Stupeur | échange + portails |
| 15 | Thérapie | vol/soin |
| 16 | Distribution | soin indirect |
| 17 | Affliction | poison/HoT |
| 18 | Transcendance | portail supplémentaire |
| 19 | Raillerie | -3 PM via portail |
| 20 | Résonance | sauvetage/piège |
| 21 | Sermon | Air 38–42 |
| 22 | Coalition | +2 PA allié |


## 6. Rotations types (11–12 PA / 6 PM)

### Tour 1 — réseau + buffs (12 PA)

*Contexte* : Début de combat : groupe au placement, ennemis à 8–12 cases.

1. Portail (1 PA) à 1–2 cases du groupe.
2. Portail (1 PA) le plus loin possible (6 cases) vers les ennemis → réseau de 2 portails (bonus ≈ +12 à +20 %).
3. Cabale (2 PA) projetée via le portail sur la croix d’alliés : +200 Puissance, +2 PM.
4. Coalition (2 PA) via portail sur le DPS principal : +2 PA (2 tours).
5. Raillerie (4 PA) via portail sur l’ennemi le plus dangereux : Air 32–36 ×bonus + -3 PM.
6. 2 PA restants : Persiflage impossible (3) → garder pour Neutral/placement.

*Résultat attendu* : Groupe buffé (+2 PA/+2 PM/+200 Puissance), 3 projections = +6 % finaux.

### Tour type DPS (12 PA)

*Contexte* : Réseau de 3–4 portails en place.

1. Extinction (5 PA) via portail : Feu 32–35 + même valeur en poison de fin de tour.
2. Sermon (4 PA) via portail : Air 38–42, repousse 4 (dans un portail = téléporter l’ennemi loin, ou dans un mur de bombes).
3. Outrage (3 PA) via portail (+1 PO).

*Résultat attendu* : ≈ 140 dégâts de base × (1 + 0,02 × distance du réseau) × (1 + passif) — le meilleur rendement PA→dégâts des 4 classes à distance.


## 7. Forces et faiblesses

**Forces**

- Amplification de dégâts/soins par la géométrie (portails) + passif cumulable (+20 %).
- Mobilité de groupe : le réseau de portails déplace tout le groupe (et coupe les distances de la carte).
- Polyvalence : DPS, soins, buffs PA/PM/Puissance, entrave PA/PM via portail.
- Sorts hors ligne de vue directe via portails.

**Faiblesses**

- Très dépendant de la mise en place (2 PA de portails par tour, positions) et de la carte (cases libres, LdV vers les portails).
- Les ennemis peuvent emprunter les portails dès leur 2e tour : risque de « livrer » les ennemis au groupe… ou l’inverse si mal placé.
- Peu de protection propre (pas de bouclier, Intaclable seulement).
- IA complexe : choix du portail d’entrée/sortie, calcul du bonus et de la case d’impact.

## 8. Synergies avec les autres classes

- **Roublard** — Sermon/Poing Fulgurant (repousse 4 via portail) et téléportations d’ennemis vers les bombes ; Cabale +200 Puissance augmente les explosions (les bombes héritent des caractéristiques — INCERTAIN pour la Puissance).
- **DPS mêlée (Iop, Sacrieur, Zobal Psychopathe)** — Portails = engagement instantané à travers la carte ; Coalition +2 PA ; Orgueil.
- **Steamer** — Les tourelles immobiles profitent des portails pour être « déplacées » (poussées dans un portail) ; double contrôle du terrain.
- **Zobal / Féca (protection)** — Compensent le manque de boucliers de l’Eliotrope.

## 9. Conseils pour l’IA de groupe

- Évaluer le bonus portail pour chaque couple (portail d’entrée accessible, chaîne) : bonus = 2 × Σ distances ; préférer des réseaux longs et des projections sur les sorts à bonus `R` (Raillerie, Sarcasme, Cabale, Coalition, Extinction).
- Neutral/Interruption au tour ennemi suivant si les portails permettent aux ennemis d’atteindre des alliés fragiles.
- Utiliser les poussées (Sermon/Poing Fulgurant/Affront) pour expédier un ennemi dans un portail (téléportation loin du groupe).

### 9.1 Pertinence pour l’Œil de Vortex (démo)

Analyse croisée avec `docs/research/vortex.md` (dossier d’un autre agent) :

- Mobilité de groupe : un réseau de portails permet de sortir des lignes de l’Auroraire sans PM et de rejoindre les monstres (arène en horloge de ≈ 13 cases de large).
- Raillerie (-3 PM) / Sarcasme (-3 PA) via portail pour figer un monstre sur une case/heure donnée ; poussées via portail pour téléporter un monstre.
- Attention : les ennemis peuvent emprunter les portails dès leur 2e tour (Neutral/Interruption pour fermer le réseau).
- Soins amplifiés (Cicatrisation 8 % zone, Résilience 10 %) contre l’érosion des lignes ; Feu (Extinction, Cataclysme, Offense) contre le Vortex (rés. Feu 12 %).

## 10. Points incertains

- INCERTAIN — Nombre maximum de portails (4 historiquement) et comportement quand on en pose un de plus.
- INCERTAIN — Case d’impact exacte d’un sort projeté (hypothèse : sortie + vecteur lanceur→entrée) et ligne de vue après projection.
- INCERTAIN — La téléportation stoppe-t-elle le déplacement ? (hypothèse : oui, PM restants réutilisables).
- INCERTAIN — Déclencheur `CPT` (Entraide/Totem) interprété comme « une entité traverse un portail du porteur ».
- INCERTAIN — Les guides antérieurs (Dofus 2.45) mentionnent +25 % de base par portail : les données actuelles (2026) donnent 0 % de base et +2 %/case (désaccord noté, données prioritaires).
- INCERTAIN — Écart avec DoMath : Sermon 32–36 (CC 38–43) chez DoMath contre 38–42 (CC 46–50) dans les fichiers du jeu (DofusDB 2026) — données DofusDB retenues ; les autres sorts concordent.

## 11. Sources

- https://api.dofusdb.fr/breeds/16 ; https://api.dofusdb.fr/spell-variants?breedId=16 ; spells/spell-levels (ids cités) ; monsters/5109
- Port C# du client : .cache/domath/haxe/FightContext.cs (GetPortalBonus), Tools/PortalUtils.cs, DamageEffectHandler.cs
- https://dofus.jeuxonline.info/article/13521/portail-eliotrope (4 portails max, projection « symétrique »)
- https://www.breakflip.com/fr/dofus/guide/dofus-guide-des-sorts-et-variantes-de-l-eliotrope-2281 (version 2.45, +25 %, obsolète)
