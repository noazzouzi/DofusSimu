# Steamer — analyse complète pour DofusSimu (breed 15)

> « Technomage ». Données : API DofusDB (fichiers du jeu Dofus 3, mises à jour 2026) — `breeds/15`, `spell-variants?breedId=15`,
> `spells`, `spell-levels`, `spell-states`, `monsters` 5831–5837 (tourelles) et sorts cachés des types 2002 (« Sorts initiaux
> Steamer » : Marée 29129, Périscope 29145, Courant 29148, La Vapeur du Steamer 21987), 625 (« Tourelles Steamer » : Évolution
> I/II/III, Surtension), 2429 (« Activations Tourelles Steamer »), 627 (« Déclenchés Steamer ») et 721–726 (sorts spéciaux).
> Cache : `.cache/classes/rzse/`. Rôles officiels : **Soins 7/10** (« peut soigner davantage et appliquer des boucliers avec
> ses tourelles Gardienne et Bathyscaphe »), **Placement 7/10**, **Dégâts 7/10** (« en faisant évoluer ses tourelles Harponneuse
> et Foreuse »), Invocation 6, Amélioration 5, Protection 3, Entrave 3, Tank 2. Complexité 4/5.

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

- **Tourelles évolutives** : 3 paires de sorts de pose (Harponneuse/Chalutier, Gardienne/Foreuse, Tactirelle/Bathyscaphe) →
  jusqu’à **3 tourelles simultanées** (une par paire choisie), 1 pose par tour. Une tourelle naît en Évolution I, monte en II
  puis III via Évolution, Surtension, Vapor, Turbine, Court-circuit (1 évolution max par tourelle et par tour). En **Évolution II**
  elle donne en début de son tour un bonus au Steamer s’il est à ≤ 7 cases et en ligne de vue ; en **Évolution III** le bonus
  augmente, la tourelle devient **contrôlable** (le joueur la joue), débloque un sort avancé et un **sort spécial** que le Steamer
  déclenche à distance (Sonar/Embuscade, Secourisme/Sauvetage, Plongée/Submersion).
- **Marée** (passif + sort Marée) : le Steamer est en **Marée Basse** au départ ; Marée lancé sur soi bascule Basse ↔ Haute
  (rembourse le coût et le lancer, 2 fois/tour). Longue-vue, Écume, Courant et Périscope changent d’effet selon la marée
  (Basse = attirer/portée ; Haute = repousser/retrait PM).
- **Soins** : Secourisme (25–29 meilleur élément), Sauvetage (8 % PV max), Gardienne (Maintenance 6–10 % PV max, jusqu’à 3×/tour, Intervention
  12 % + 2 PM), Évolution/Surtension soignent les tourelles.
- **Placement** exceptionnel : Marée (échange), Compas, Boussole, Aiguillage, Récursivité, Cabestan, Gouvernail, Turbine,
  Courant, Écume, Torpille, Ressac, Foène, Harmattan, Tactirelle/Chalutier.
- **Dégâts** multi-éléments (Eau, Terre, Feu, Air) + tourelles offensives qui frappent dans le **meilleur élément** du Steamer
  (elles héritent à 100 % de ses caractéristiques et dommages).
- **Entrave** : Ancrage -3 PM en croix, Plongée -3 PM, Longue-vue -2 PM (Marée Haute), Périscope vol de PM, Submersion -4 PO,
  Sabotage -30 Dommages, Soupape -20 % CC, Mortier -2 PM, Chalutier III +30 retrait PM.

**Tourelles (valeurs niveau 200)** :

| Tourelle (sort, paire) | Rôle | Sort de base (tour de la tourelle) | Évolution II (aura sur le Steamer ≤ 7 cases, début de tour) | Évolution III : aura + sort avancé + contrôle | Sort spécial (activé par le Steamer) |
|---|---|---|---|---|---|
| Harponneuse (13829, p5) | offensive | Espadon 2 PA, 1–7 LdV, 3/tour, 1/cible : vol de vie meilleur élément 18–20 / 23–27 / 30–34 (Évol I/II/III ; tourelle grade 3 au niv. 200) | +20 Dommages | +25 Dommages +15 % CC ; Harponnage (attire 4) | Armada (Sonar/Embuscade) : meilleur élément 20–23 / 27–30 / 34–39 (rang 1/2/3) + réduit d’1 tour les effets de la cible |
| Chalutier (13859, p5) | tactique | Chalutage 3 PA : attire de 2/4/6 les entités en croix r3/5/7 et diagonales r2/3/4 vers lui | +30 Tacle | +40 Tacle +30 Retrait PM ; Hauban (échange de position) ; peut tacler | Mortier (Plongée/Submersion) : vol de vie meilleur élément 19–23 en cercle 2 + -2 PM (24–28 dans la version critique) |
| Gardienne (13830, p7) | défensive | Maintenance 2 PA, 3/tour, 1/cible : soin 6 / 8 / 10 % des PV max (Évol I/II/III, tourelle grade 3) | +10 % Vitalité | +12 % Vitalité +1 PM ; Faro (révèle les invisibles) | Intervention (Secourisme/Sauvetage) : soin 8/10/12 % PV max + 2 PM (2 tours) |
| Foreuse (13864, p7) | offensive | Forage 2 PA, en ligne sans LdV, 3/tour : vol de vie meilleur élément 18–20 / 23–27 / 30–34 (tourelle grade 2 au niv. 192+) | +150 Puissance | +200 Puissance +1 PO ; Tunnelier (se téléporte + attire 5 en ligne) | Excavation (Sonar/Embuscade) : +20 % érosion + meilleur élément 30–34 / 34–39 |
| Tactirelle (13831, p11) | tactique | Barycentre 3 PA : repousse de 2/4/6 en croix r2/4/6 et diagonales r1/2/3 | +40 Dommages poussée | +50 Dommages poussée +50 Fuite ; Sextant (téléport symétrique carré r1) | Écoutille (Plongée/Submersion) : échange cible ↔ Tactirelle |
| Bathyscaphe (13869, p11) | défensive | Revêtement 2 PA, 3/tour : bouclier 75 % / 125 % / 150 % du niveau | Bouclier 75 % du niveau | Bouclier 100 % +1 PA ; Rivet (bouclier 200 % à toutes les tourelles + Indéplaçable) | Décompression (Secourisme/Sauvetage) : +2 PA + bouclier 150 % (2 tours) |

## 2. Rôles en groupe PvM (niveau 200)

- **soutien-soin** (priorité 1, élément(s) : meilleur élément) — Secourisme 25–29 (CC 30–35) mono-cible à 1–6 PO + Intervention de la Gardienne III (12 % PV + 2 PM) + Décompression du Bathyscaphe III (+2 PA, bouclier 300) ; Gardienne posée = Maintenance 6–10 % PV max jusqu’à 3 fois par tour. Soigneur « secondaire » solide en groupe de 4.
- **placement** (priorité 1, élément(s) : -) — Le meilleur placeur des 4 : échanges (Marée, Compas, Boussole), téléports symétriques (Cabestan, Aiguillage, Récursivité, Tactirelle III), attirances de zone (Gouvernail, Turbine, Chalutier jusqu’à 6 cases), poussées (Torpille, Courant/Écume Marée Haute, Harmattan rebondissant, Tactirelle).
- **dps-multi-tourelles** (priorité 2, élément(s) : Eau/Terre/Feu/Air + meilleur élément) — Harponneuse/Foreuse III (vols de vie 30–34 par lancer, 3/tour sur leur propre tour) + Armada/Excavation à distance + sorts directs (Marée 34–38, Ancrage 35–38, Gouvernail 31–34, Turbine/Vapor zone).
- **entrave** (priorité 3, élément(s) : Terre/Eau) — Ancrage (-3 PM croix), Plongée (-3 PM), Longue-vue (-2 PM en Marée Haute), Périscope (vol 1 PM quand la cible est déplacée), Mortier (-2 PM zone), Submersion (-4 PO), Sabotage (-30 dommages).
- **protection** (priorité 3, élément(s) : -) — Bathyscaphe (Revêtement 300 PV, aura bouclier), Blindage (500/1000 PV + Indéplaçable), Scaphandre (400 PV + Intaclable), Brise l’Âme (la tourelle intercepte les dommages mêlée des alliés adjacents).

## 3. Mécaniques de classe à implémenter (moteur)

### 3.1 Tourelles : pose, limite, statistiques

Les 6 sorts de tourelle coûtent 2 PA, PO 1–7 avec ligne de vue sur case libre, relance 3, 1 lancer/tour et **1/tour en limite globale** (une seule tourelle posée par tour, quel que soit le type). Effet 181 `SummonCreature` (monstres 5836 Harponneuse, 5832 Chalutier, 5835 Gardienne, 5833 Foreuse, 5837 Tactirelle, 5831 Bathyscaphe ; grade = grade du sort). Statistiques : 6 PA, 0 PM (immobiles), 15 % de résistance partout, `bonusCharacteristics` = 100 % Force/Intelligence/Chance/Agilité/Sagesse et dommages élémentaires du Steamer, `lifePoints` 180 (INCERTAIN : 180 % des PV de base du Steamer), tacle hérité à 100 % (seul le Chalutier peut tacler). Les tourelles ne consomment pas d’emplacement d’invocation (`useSummonSlot=false`). Sort initial de chaque tourelle (14279, 14289…) : pose l’état « Tourelle Rang 1/2/3 » (selon le grade, utilisé par les sorts spéciaux), tue l’éventuelle tourelle du **même type** déjà présente, et programme les auras d’Évolution II/III au début de son tour.

*Notes d’implémentation* : IA des tourelles non contrôlées (Évolution I/II) : à leur tour, lancer leur sort de base sur la meilleure cible à portée (Espadon/Forage : ennemi au plus bas PV effectif ; Maintenance/Revêtement : allié le plus blessé/menacé ; Chalutage/Barycentre : si ≥ 1 ennemi dans la zone et que le déplacement est favorable). INCERTAIN : comportement exact de l’IA serveur des tourelles.

### 3.2 Évolution des tourelles (états 134/135) et contrôle

Évolution I = pas d’état. Évolution II = état 134 + « Tourelle évoluée » (6093). Évolution III = état 135 + « Contrôlé » (2130) + effet 2027 `ControlEntity` : la tourelle est jouée par le joueur (6 PA) et ses sorts conditionnés `HS=135` deviennent disponibles. Sources : Évolution (1 PA, 1/tour, +1 niveau + soin 50 % PV max, 25 % si déjà III ; sur un allié non-tourelle : +100 Puissance 2 tours), Surtension (2 PA, relance 2 : passe directement en III pour 1 tour puis redescend d’un niveau au tour suivant, soin 100 % ; sur allié +200 Puissance 1 tour), Vapor/Turbine (+1 niveau aux tourelles dans la zone du sort), Court-circuit (+1 niveau + 100 % CC à la tourelle 1 tour). L’état « Évolution bloquée » (6094, 1 tour) empêche une 2e évolution le même tour. Rétrogradation : Soupape et Sabotage (-1 niveau, et la relance du sort de pose de cette tourelle est réduite d’1 tour).

*Notes d’implémentation* : Machine à états {I, II, III} par tourelle + verrou par tour. Aura de début de tour : sous-sorts 14280/14281 (etc.) avec masque `l,m,P,*E134` → ne vise que le Steamer (seul joueur du « groupe » de la tourelle) dans un cercle de 7 (rayon min 1) ; la description exige aussi la ligne de vue. Le contrôle (2027) signifie que l’IA de groupe doit planifier le tour de la tourelle comme celui d’un personnage.

### 3.3 Sorts spéciaux de tourelle (activation à distance)

Sonar/Embuscade (offensifs), Secourisme/Sauvetage (défensifs), Plongée/Submersion (tactiques) posent un état d’activation sur la cible (130/131/132) puis « Activation Steamer » (23872 niv.1/2/3) fait lancer à chaque tourelle du Steamer en Évolution III de la bonne famille son sort spécial sur cette cible, à n’importe quelle distance (PO 0–63, sans ligne de vue) : Armada (Harponneuse), Excavation (Foreuse), Intervention (Gardienne), Décompression (Bathyscaphe), Écoutille (Tactirelle), Mortier (Chalutier). La puissance dépend du « Tourelle Rang » (grade du sort de pose).

*Notes d’implémentation* : Effets 2794 (`TargetExecuteSpellOnCell`) : la tourelle lance le sort spécial sur sa propre cellule mais la cible est l’entité marquée (état 130/131/132, masques `E130`…). Implémenter : pour chaque tourelle III du lanceur → lancer spécial(rang) sur la cible marquée.

### 3.4 Marée (états Marée Basse 5283 / Marée Haute 5282)

Le passif « Marée » (29129 niv.1) met le Steamer en Marée Basse au début du combat. Le sort Marée (13820, 3 PA, PO 0–3 en ligne/diagonale) : sur une cible, échange de position et Eau 34–38 ; **sur soi**, bascule la marée, rend 3 PA et +1 lancer (2 fois max par tour : états Marée I/II). Effets dépendants : Longue-vue (Basse : +3 PO au Steamer et à l’allié ciblé ; Haute : -2 PM), Écume (Basse : attire de 5 ; Haute : repousse de 3), Courant (Basse : attire de 6 ; Haute : repousse de 4 — une même cible ne peut être déplacée qu’une fois par tour par une marée), Périscope (Basse : sans ligne de vue et portée non modifiable ; Haute : portée modifiable et ligne de vue).

*Notes d’implémentation* : Booléen `tideHigh`. Basculer coûte 0 PA net. Les sous-sorts « Marée Basse : »/« Marée Haute : » (29146/29147) sont des info-bulles ; les vrais effets portent des masques `*E5282`/`*e5282` (état du lanceur).

### 3.5 Interactions sorts ↔ tourelles (remboursements, mouvements)

Amarrage sur une tourelle : rend 1 PA ; Ressac sur une tourelle : rend 2 PA et la poussée est sans dommages ; Gouvernail et Ancrage : +1 PA si une tourelle est dans la zone ; Aspiration/Piston : déplacement de 6 cases (au lieu de 3) vers/depuis une tourelle ; Boussole : téléport symétrique par rapport à une tourelle ou échange/téléport adjacent ; Aiguillage/Récursivité : si la cible finit son déplacement au contact d’une tourelle, elle est téléportée symétriquement et l’effet est réappliqué ; Cabestan sur une tourelle : téléport symétrique des entités du carré ; Assistance : téléporte un allié près du Steamer (et soigne la tourelle 25 %) ; Brise l’Âme : état Automatique (la tourelle intercepte les dommages de mêlée des alliés adjacents et riposte avec son sort automatique quand un allié subit des dommages à distance).

*Notes d’implémentation* : Ces effets passent par des sous-sorts ciblant `TOURELLES` (`a,F5831…F5837`) — les effets de premier niveau « Rend 1 PA » sont souvent `forClientOnly` (info-bulle) : NE PAS les appliquer, seul le sous-sort conditionnel compte.

### Invocations de la classe

| Monstre (id) | Grade utilisé | PA/PM | Rés. % | Joue ? | Emplacement | Notes |
|---|---|---|---|---|---|---|
| Harponneuse (5836) | 3 (sort g3) | 6/0 | 15 partout | oui (IA ; contrôlée en Évol III) | aucun | Espadon, Harponnage (III), Armada |
| Chalutier (5832) | 2 | 6/0 | 15 | oui | aucun | Chalutage, Hauban (III), Mortier ; tacle |
| Gardienne (5835) | 3 | 6/0 | 15 | oui | aucun | Maintenance, Faro (III), Intervention |
| Foreuse (5833) | 2 | 6/0 | 15 | oui | aucun | Forage, Tunnelier (III), Excavation |
| Tactirelle (5837) | 3 | 6/0 | 15 | oui | aucun | Barycentre, Sextant (III), Écoutille |
| Bathyscaphe (5831) | 1 | 6/0 | 15 | oui | aucun | Revêtement, Rivet (III), Décompression |


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

### Paire 1 — Longue-vue / Corrosion

#### Longue-vue (`13837`) — variante de base, débloqué niv. 1, grade 3

> Occasionne des dommages Eau aux ennemis et applique des effets selon la Marée : • Marée Basse : augmente la Portée du lanceur et de l'allié ciblé. • Marée Haute : retire des PM aux ennemis.

- **3 PA**, PO 0–6 (modifiable), ligne de vue, case occupée ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 10 %
- Effets exécutés :
  - Dommages Eau 25 à 29 — cibles: ennemis
  - +3 PO — cibles: lanceur/alliés [lanceur sans état « Marée Haute » (5282)]; 2 tours
  - -2 PM (esquivable) — cibles: ennemis [lanceur avec état « Marée Haute » (5282)]; 1 tour
- Coup critique : Dommages Eau 30 à 35
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Marée Basse : » (29147) niv.1 — cibles: alliés/ennemis ; le lanceur lance « Marée Haute : » (29146) niv.1 — cibles: alliés/ennemis
- Grades : g1 (niv 1) vs g3: Dommages Eau 15 à 17 (g1) → Dommages Eau 25 à 29 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 66) vs g3: Dommages Eau 20 à 23 (g2) → Dommages Eau 25 à 29 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : ally_range_buff, damage, mp_removal, tide
- **Analyse tactique** : Eau 25–29 ; Marée Basse : +3 PO au Steamer et à l’allié ciblé ; Marée Haute : -2 PM. 3/tour.

#### Corrosion (`13866`) — variante alternative, débloqué niv. 95, grade 2

> Occasionne des dommages Air et réduit les Résistances Poussée.

- **2 PA**, PO 1–6 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 5 %
- Effets exécutés :
  - Dommages Air 17 à 19 — cibles: alliés/ennemis
  - -60 Résistance poussée — cibles: alliés/ennemis; 2 tours
- Coup critique : Dommages Air 20 à 22
- Grades : g1 (niv 95) vs g2: Dommages Air 13 à 14 (g1) → Dommages Air 17 à 19 (g2) ; -40 Résistance poussée (g1) → -60 Résistance poussée (g2) ; PO max 5 (g1) → 6 (g2)
- Rôle : damage, push_res_debuff
- **Analyse tactique** : Air 2 PA, -60 résistance poussée (2 tours) : prépare les dommages de poussée (Tactirelle, Torpille, Harmattan).


### Paire 2 — Amarrage / Soupape

#### Amarrage (`13857`) — variante de base, débloqué niv. 1, grade 3

> Occasionne des dommages Terre aux ennemis et attire la cible.  Rend 1 PA au lanceur si le sort est lancé sur une Tourelle.

- **2 PA**, PO 1–7 (non modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 5 %
- Effets exécutés :
  - le lanceur lance « Amarrage » (29587) niv.1 — cibles: alliés [tourelles]
    - ↳ Rend 1 PA — cibles: lanceur
  - Dommages Terre 16 à 18 — cibles: ennemis
  - Attire de 2 case(s) — cibles: alliés/ennemis
- Coup critique : Dommages Terre 19 à 22
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Rend 1 PA — cibles: lanceur
- Grades : g1 (niv 1) vs g3: Dommages Terre 11 à 13 (g1) → Dommages Terre 16 à 18 (g3) ; PO max 5 (g1) → 7 (g3) | g2 (niv 67) vs g3: Dommages Terre 14 à 16 (g2) → Dommages Terre 16 à 18 (g3) ; PO max 6 (g2) → 7 (g3)
- Rôle : ap_refund, damage, pull
- **Analyse tactique** : Terre 16–18 + attire 2 ; sur une tourelle : rend 1 PA (2 PA → 1 PA net) et la rapproche.

#### Soupape (`13867`) — variante alternative, débloqué niv. 100, grade 2

> Occasionne des dommages Feu et réduit les chances de Critique.  Sur une Tourelle : appliquer les effets sur les ennemis en zone et la rétrograde pour réduire son temps de relance. • Évolution III : cercle de taille 3. • Évolution II : cercle de taille 2. • Évolution I : cercle de taille 1. Le temps de relance de la Tourelle n'est pas réduit.

- **2 PA**, PO 1–7 (modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, cumul max 1, CC 5 %
- Effets exécutés :
  - le lanceur lance « Soupape » (23832) niv.6 — cibles: alliés [avec état « Évolution III » (135); tourelles]
    - ↳ la cible lance sur le déclencheur « Soupape » (23832) niv.7 — cibles: alliés [tourelles]
      - ↳ Sort « Harponneuse » (13829) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Harponneuse (5836)]
      - ↳ Sort « Gardienne » (13830) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Gardienne (5835)]
      - ↳ Sort « Tactirelle » (13831) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Tactirelle (5837)]
      - ↳ Sort « Chalutier » (13859) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Chalutier (5832)]
      - ↳ Sort « Foreuse » (13864) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Foreuse (5833)]
      - ↳ Sort « Bathyscaphe » (13869) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Bathyscaphe (5831)]
      - ↳ Retire l'état « Évolution bloquée » (6094) — cibles: lanceur
    - ↳ Dommages Feu 13 à 15 — cercle r3 (rayon min 1); cibles: ennemis
    - ↳ le lanceur lance « Soupape » (23832) niv.9 — cercle r3 (rayon min 1); cibles: ennemis
      - ↳ -20% Critique — cibles: alliés/ennemis; 1 tour
    - ↳ le lanceur lance « Évolution II » (13851) niv.3 — cibles: alliés [tourelles]
      - ↳ fait passer la tourelle en Évolution II (état 134, apparence, « Tourelle évoluée »)
  - le lanceur lance « Soupape » (23832) niv.5 — cibles: alliés [avec état « Évolution II » (134); tourelles]
    - ↳ la cible lance sur le déclencheur « Soupape » (23832) niv.7 — cibles: alliés [tourelles]
    - ↳ Dommages Feu 13 à 15 — cercle r2 (rayon min 1); cibles: ennemis
    - ↳ le lanceur lance « Soupape » (23832) niv.9 — cercle r2 (rayon min 1); cibles: ennemis
    - ↳ le lanceur lance « Évolution I » (29247) niv.3 — cibles: alliés [tourelles]
      - ↳ rétrograde la tourelle en Évolution I (retire les états II/III)
  - le lanceur lance « Soupape » (23832) niv.4 — cibles: alliés [sans état « Évolution II » (134); sans état « Évolution III » (135); tourelles]
    - ↳ Dommages Feu 13 à 15 — cercle r1 (rayon min 1); cibles: ennemis
    - ↳ le lanceur lance « Soupape » (23832) niv.9 — cercle r1 (rayon min 1); cibles: ennemis
  - Dommages Feu 13 à 15 — cibles: ennemis
  - Dommages Feu 13 à 15 — cibles: alliés [hors tourelles]
  - le lanceur lance « Soupape » (23832) niv.9 — cibles: ennemis
  - le lanceur lance « Soupape » (23832) niv.9 — cibles: alliés [hors tourelles]
- Coup critique : Dommages Feu 16 à 18 ; Dommages Feu 16 à 18
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « -1 Évolution » (29132) niv.1 — cibles: alliés/ennemis ; -20% Critique — cibles: alliés/ennemis; 1 tour
- Grades : g1 (niv 100) vs g2: le lanceur lance « Soupape » (23832) niv.3 (g1) → le lanceur lance « Soupape » (23832) niv.6 (g2) ; le lanceur lance « Soupape » (23832) niv.2 (g1) → le lanceur lance « Soupape » (23832) niv.5 (g2) ; le lanceur lance « Soupape » (23832) niv.1 (g1) → le lanceur lance « Soupape » (23832) niv.4 (g2) ; Dommages Feu 10 à 12 (g1) → Dommages Feu 13 à 15 (g2) ; Dommages Feu 10 à 12 (g1) → Dommages Feu 13 à 15 (g2) ; le lanceur lance « Soupape » (23832) niv.8 (g1) → le lanceur lance « Soupape » (23832) niv.9 (g2) ; le lanceur lance « Soupape » (23832) niv.8 (g1) → le lanceur lance « Soupape » (23832) niv.9 (g2) ; PO max 6 (g1) → 7 (g2)
- Rôle : aoe, crit_debuff, damage
- **Analyse tactique** : Feu + -20 % CC ; sur une tourelle : frappe en cercle 1/2/3 autour d’elle selon son évolution, la rétrograde et réduit la relance de son sort de pose.


### Paire 3 — Torpille / Gouvernail

#### Torpille (`13865`) — variante de base, débloqué niv. 1, grade 3

> Occasionne des dommages Air aux ennemis et repousse la cible.

- **3 PA**, PO 1–6 (modifiable), lancer en ligne, ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 10 %
- Effets exécutés :
  - Dommages Air 25 à 29 — cibles: ennemis
  - Repousse de 3 case(s) — cibles: alliés/ennemis
- Coup critique : Dommages Air 30 à 35
- Grades : g1 (niv 1) vs g3: Dommages Air 15 à 17 (g1) → Dommages Air 25 à 29 (g3) ; Repousse de 2 case(s) (g1) → Repousse de 3 case(s) (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 68) vs g3: Dommages Air 20 à 23 (g2) → Dommages Air 25 à 29 (g3) ; Repousse de 2 case(s) (g2) → Repousse de 3 case(s) (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : damage, push
- **Analyse tactique** : Air 25–29 + repousse 3 (en ligne) : classique.

#### Gouvernail (`13828`) — variante alternative, débloqué niv. 105, grade 2

> Occasionne des dommages Terre aux ennemis et attire les cibles jusqu'au centre en zone. Les dommages de zone ne sont pas dégressifs.  Rend 1 PA au lanceur si une Tourelle est dans la zone d'effet.

- **4 PA**, PO 0–5 (non modifiable), lancer en ligne, en diagonale, ligne de vue ; 1 lancer(s)/tour, CC 20 %
- Effets exécutés :
  - le lanceur lance (limite globale) « Gouvernail » (29589) niv.1 — étoile r2; cibles: alliés [tourelles]
    - ↳ Rend 1 PA — cibles: lanceur
  - Dommages Terre 31 à 34 — étoile r2; cibles: ennemis
  - Attire de 1 case(s) — croix sans centre r1; cibles: alliés/ennemis
  - Attire de 2 case(s) — croix diagonale sans centre r1; cibles: alliés/ennemis
  - Attire de 2 case(s) — croix sans centre r2 (rayon min 2); cibles: alliés/ennemis
  - Attire de 4 case(s) — croix diagonale sans centre r2 (rayon min 2); cibles: alliés/ennemis
- Coup critique : Dommages Terre 37 à 41
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Rend 1 PA — cibles: lanceur ; Attire de 2 case(s) — étoile r2; cibles: alliés/ennemis
- Grades : g1 (niv 105) vs g2: Dommages Terre 26 à 29 (g1) → Dommages Terre 31 à 34 (g2)
- Rôle : aoe, ap_refund, damage, pull
- **Analyse tactique** : Terre 31–34 en étoile r2 non dégressif + attire tout vers le centre ; +1 PA si une tourelle est dans la zone.


### Paire 4 — Sabotage / Périscope

#### Sabotage (`13858`) — variante de base, débloqué niv. 1, grade 3

> Occasionne des dommages Feu et retire des Dommages aux ennemis en zone. Les dommages du sort sont augmentés pour chaque Tourelle évoluée dans la zone avant d'appliquer les effets.  Rétrograde les Tourelles touchées pour réduire leur temps de relance.

- **3 PA**, PO 0–6 (non modifiable), ligne de vue ; 2 lancer(s)/tour, cumul max 1, CC 10 %
- Effets exécutés :
  - le lanceur lance « Sabotage » (29162) niv.3 — cercle r2; cibles: alliés [avec état « Tourelle évoluée » (6093); tourelles]
    - ↳ la cible lance sur le déclencheur « Sabotage » (29162) niv.4 — cibles: alliés [tourelles]
      - ↳ Sort « Harponneuse » (13829) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Harponneuse (5836)]
      - ↳ Sort « Gardienne » (13830) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Gardienne (5835)]
      - ↳ Sort « Tactirelle » (13831) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Tactirelle (5837)]
      - ↳ Sort « Chalutier » (13859) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Chalutier (5832)]
      - ↳ Sort « Foreuse » (13864) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Foreuse (5833)]
      - ↳ Sort « Bathyscaphe » (13869) : -1 tour(s) de relance — cibles: alliés [lanceur =monstre Bathyscaphe (5831)]
      - ↳ Retire l'état « Évolution bloquée » (6094) — cibles: lanceur
    - ↳ Sort « Sabotage » (13858) : +9 dommages de base — cibles: lanceur; 1 tour
  - Dommages Feu 22 à 25 — cercle r2; cibles: ennemis
  - -30 Dommages — cercle r2; cibles: ennemis; 1 tour
  - le lanceur lance « Sabotage » (29162) niv.5 — cercle r2; cibles: alliés [avec état « Tourelle évoluée » (6093); tourelles]
    - ↳ le lanceur lance « Évolution I » (29247) niv.3 — cibles: alliés [avec état « Évolution II » (134); tourelles]
      - ↳ rétrograde la tourelle en Évolution I (retire les états II/III)
    - ↳ le lanceur lance « Évolution II » (13851) niv.3 — cibles: alliés [avec état « Évolution III » (135); tourelles]
      - ↳ fait passer la tourelle en Évolution II (état 134, apparence, « Tourelle évoluée »)
  - Désenvoûte les effets du sort « Sabotage » (29162) — cibles: lanceur
- Coup critique : Dommages Feu 26 à 30
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Sort « Sabotage » (13858) : +9 dommages de base — cibles: lanceur ; le lanceur lance « -1 Évolution » (29132) niv.1 — cercle r2; cibles: alliés/ennemis
- Grades : g1 (niv 1) vs g3: le lanceur lance « Sabotage » (29162) niv.1 (g1) → le lanceur lance « Sabotage » (29162) niv.3 (g3) ; Dommages Feu 13 à 15 (g1) → Dommages Feu 22 à 25 (g3) ; -10 Dommages (g1) → -30 Dommages (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 69) vs g3: le lanceur lance « Sabotage » (29162) niv.2 (g2) → le lanceur lance « Sabotage » (29162) niv.3 (g3) ; Dommages Feu 18 à 21 (g2) → Dommages Feu 22 à 25 (g3) ; -20 Dommages (g2) → -30 Dommages (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : aoe, damage, damage_debuff
- **Analyse tactique** : Feu 22–25 en cercle 2 + -30 Dommages ; +9 dégâts de base par tourelle évoluée dans la zone ; rétrograde les tourelles touchées.

#### Périscope (`13870`) — variante alternative, débloqué niv. 110, grade 2

> Occasionne des dommages Eau aux ennemis et leur applique l'état Mal de Mer : • Vole des PM si la cible est attirée, poussée ou transposée (cumulable 3 fois).  • Marée Basse : désactive la portée modifiable et la ligne de vue du sort. • Marée Haute : rend sa portée modifiable et active sa ligne de vue.

- **3 PA**, PO 1–5 (non modifiable), ligne de vue ; 2 lancer(s)/tour, cumul max 1, CC 10 %
- Effets exécutés :
  - Dommages Eau 28 à 32 — croix r1; cibles: ennemis
  - le lanceur lance « Périscope » (29154) niv.3 — croix r1; cibles: ennemis
    - ↳ Applique l'état « Mal de Mer » (5313) — cibles: alliés/ennemis; 2 tours
  - le lanceur lance « Périscope » (29154) niv.1 — croix r1; cibles: ennemis; déclenché quand le porteur se déplace/est déplacé (déclencheur actif 2 tour(s))
    - ↳ le lanceur lance « Périscope » (29154) niv.2 — cibles: ennemis [sans état « Flibuste III » (3557)]
      - ↳ la cible lance sur elle-même « Périscope » (30758) niv.1 — cibles: lanceur
      - ↳ -1 PM (esquivable) — cibles: alliés/ennemis; 1 tour
      - ↳ Désenvoûte les effets du sort « Périscope » (30758) — cibles: lanceur
- Coup critique : Dommages Eau 34 à 38
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Applique l'état « Mal de Mer » (5313) — croix r1; cibles: ennemis; 2 tours ; Vole 1 PM — croix r1; cibles: ennemis; 1 tour; déclenché quand le porteur se déplace/est déplacé (déclencheur actif 2 tour(s))
- Grades : g1 (niv 110) vs g2: Dommages Eau 24 à 28 (g1) → Dommages Eau 28 à 32 (g2) ; PO max 4 (g1) → 5 (g2)
- Rôle : aoe, damage, mp_removal, mp_steal, tide
- **Analyse tactique** : Eau 28–32 en croix + état Mal de Mer (vol 1 PM à chaque déplacement forcé, 3 cumuls).


### Paire 5 — Harponneuse / Chalutier

#### Harponneuse (`13829`) — variante de base, débloqué niv. 5, grade 3

> Pose une Tourelle offensive qui vole de la vie dans le meilleur élément du lanceur.

- **2 PA**, PO 1–7 (non modifiable), ligne de vue, case libre ; relance 3 tour(s), 1 lancer(s)/tour, 1/tour (limite globale), CC 0 %
- Effets exécutés :
  - Invoque Harponneuse (5836) grade 3 — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Évolutions Harponneuse » (29190) niv.1 — cibles: alliés/ennemis
- Grades : g1 (niv 5) vs g3: Invoque Harponneuse (5836) grade 1 (g1) → Invoque Harponneuse (5836) grade 3 (g3) | g2 (niv 72) vs g3: Invoque Harponneuse (5836) grade 2 (g2) → Invoque Harponneuse (5836) grade 3 (g3)
- Rôle : summon, turret
- **Analyse tactique** : Tourelle offensive principale (vol de vie meilleur élément, aura +Dommages/+CC).

#### Chalutier (`13859`) — variante alternative, débloqué niv. 115, grade 2

> Pose une Tourelle tactique qui attire les cibles en zone autour d'elle et qui peut tacler.

- **2 PA**, PO 1–7 (non modifiable), ligne de vue, case libre ; relance 3 tour(s), 1 lancer(s)/tour, 1/tour (limite globale), CC 0 %
- Effets exécutés :
  - Invoque Chalutier (5832) grade 2 — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Évolutions Chalutier » (29198) niv.1 — cibles: alliés/ennemis
- Grades : g1 (niv 115) vs g2: Invoque Chalutier (5832) grade 1 (g1) → Invoque Chalutier (5832) grade 2 (g2)
- Rôle : summon, turret
- **Analyse tactique** : Tourelle tactique : regroupe les ennemis vers elle et tacle ; aura +Tacle/+Retrait PM.


### Paire 6 — Évolution / Surtension

#### Évolution (`13832`) — variante de base, débloqué niv. 10, grade 3

> Évolue et soigne une Tourelle. Les soins sont plus importants sur une Tourelle qui évolue.  Sur un allié : augmente sa Puissance.

- **1 PA**, PO 1–7 (non modifiable), ligne de vue ; 1 lancer(s)/tour, cumul max 2, CC 0 %
- Effets exécutés :
  - Applique l'état « Évolution bloquée » (6094) — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]; 1 tour; non désenvoûtable
  - le lanceur lance « Évolution II » (13851) niv.3 — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution II » (134); sans état « Évolution bloquée » (6094); tourelles]
    - ↳ fait passer la tourelle en Évolution II (état 134, apparence, « Tourelle évoluée »)
  - le lanceur lance « Évolution III » (13852) niv.3 — cibles: alliés [avec état « Évolution II » (134); sans état « Évolution bloquée » (6094); tourelles]
    - ↳ fait passer la tourelle en Évolution III (état 135, devient CONTRÔLABLE, sort avancé débloqué)
  - Soin = 50% des PV max — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]
  - Soin = 25% des PV max — cibles: alliés [avec état « Évolution III » (135); tourelles]
  - Soin = 25% des PV max — cibles: alliés [sans état « Évolution III » (135); avec état « Évolution bloquée » (6094); tourelles]
  - +100 Puissance — cibles: alliés [hors tourelles]; 2 tours
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « +1 Évolution » (23844) niv.1 — cibles: alliés/ennemis
- Grades : g1 (niv 10) vs g3: +40 Puissance (g1) → +100 Puissance (g3) ; PO max 5 (g1) → 7 (g3) | g2 (niv 77) vs g3: +70 Puissance (g2) → +100 Puissance (g3) ; PO max 6 (g2) → 7 (g3)
- Rôle : ally_power_buff, heal, turret_evolution
- **Analyse tactique** : 1 PA : +1 évolution + soin 50 % de la tourelle ; sur un allié +100 Puissance (2 tours).

#### Surtension (`13868`) — variante alternative, débloqué niv. 120, grade 2

> Évolue au maximum et soigne une Tourelle. Les soins sont plus importants sur une Tourelle qui évolue.  Sur un allié : augmente sa Puissance.

- **2 PA**, PO 1–7 (non modifiable), ligne de vue ; relance 2 tour(s), relance initiale 1, cumul max 1, CC 0 %
- Effets exécutés :
  - Applique l'état « Évolution bloquée » (6094) — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]; 1 tour; non désenvoûtable
  - le lanceur lance « Évolution III » (13852) niv.3 — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]
    - ↳ fait passer la tourelle en Évolution III (état 135, devient CONTRÔLABLE, sort avancé débloqué)
  - Soin = 100% des PV max — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]
  - Soin = 50% des PV max — cibles: alliés [avec état « Évolution III » (135); tourelles]
  - Soin = 50% des PV max — cibles: alliés [sans état « Évolution III » (135); avec état « Évolution bloquée » (6094); tourelles]
  - +200 Puissance — cibles: alliés [hors tourelles]; 1 tour
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Surtension » (29149) niv.3 — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles] ; le lanceur lance « +1 à 2 Évolutions » (29131) niv.1 — cibles: alliés/ennemis; 1 tour ; Applique l'état « Surtension » (2921) — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]; 2 tours ; le lanceur lance « -1 Évolution » (29132) niv.1 — cibles: alliés [sans état « Évolution bloquée » (6094); tourelles]; après 1 tour(s)
- Grades : g1 (niv 120) vs g2: +150 Puissance (g1) → +200 Puissance (g2) ; PO max 6 (g1) → 7 (g2)
- Rôle : ally_power_buff, heal, turret_evolution
- **Analyse tactique** : Évolution III immédiate (1 tour) puis -1 : permet le sort spécial/contrôle dès la pose.


### Paire 7 — Gardienne / Foreuse

#### Gardienne (`13830`) — variante de base, débloqué niv. 15, grade 3

> Pose une Tourelle défensive qui soigne.

- **2 PA**, PO 1–7 (non modifiable), ligne de vue, case libre ; relance 3 tour(s), 1 lancer(s)/tour, 1/tour (limite globale), CC 0 %
- Effets exécutés :
  - Invoque Gardienne (5835) grade 3 — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Évolutions Gardienne » (29193) niv.1 — cibles: alliés/ennemis
- Grades : g1 (niv 15) vs g3: Invoque Gardienne (5835) grade 1 (g1) → Invoque Gardienne (5835) grade 3 (g3) | g2 (niv 82) vs g3: Invoque Gardienne (5835) grade 2 (g2) → Invoque Gardienne (5835) grade 3 (g3)
- Rôle : summon, turret
- **Analyse tactique** : Tourelle de soin (Maintenance 3×/tour) ; aura +Vitalité/+PM.

#### Foreuse (`13864`) — variante alternative, débloqué niv. 125, grade 2

> Pose une Tourelle offensive qui vole de la vie dans le meilleur élément du lanceur.

- **2 PA**, PO 1–7 (non modifiable), ligne de vue, case libre ; relance 3 tour(s), 1 lancer(s)/tour, 1/tour (limite globale), CC 0 %
- Effets exécutés :
  - Invoque Foreuse (5833) grade 2 — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Évolutions Foreuse » (29200) niv.1 — cibles: alliés/ennemis
- Grades : g1 (niv 125) vs g2: Invoque Foreuse (5833) grade 1 (g1) → Invoque Foreuse (5833) grade 2 (g2)
- Rôle : summon, turret
- **Analyse tactique** : Seconde tourelle offensive (vol de vie en ligne sans LdV) ; aura +Puissance/+PO.


### Paire 8 — Aspiration / Piston

#### Aspiration (`13838`) — variante de base, débloqué niv. 20, grade 3

> Rapproche le lanceur vers l'allié ciblé. Le rapprochement est plus important sur les Tourelles.

- **2 PA**, PO 2–8 (non modifiable), lancer en ligne, en diagonale, ligne de vue ; 2 lancer(s)/tour, 1/cible, CC 0 %
- Effets exécutés :
  - Le lanceur avance de 3 case(s) — cibles: alliés [hors tourelles]
  - Le lanceur avance de 6 case(s) — cibles: alliés [tourelles]
- Grades : g1 (niv 20) vs g3: PO max 6 (g1) → 8 (g3) ; lancers/tour 1 (g1) → 2 (g3) | g2 (niv 87) vs g3: PO max 7 (g2) → 8 (g3) ; lancers/tour 1 (g2) → 2 (g3)
- Rôle : self_move
- **Analyse tactique** : Se rapproche de 3 (6 vers une tourelle) — mobilité.

#### Piston (`14308`) — variante alternative, débloqué niv. 130, grade 2

> Éloigne le lanceur de la cible. Le recul est plus important sur les Tourelles.

- **1 PA**, PO 1–2 (non modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, CC 0 %
- Effets exécutés :
  - Le lanceur recule de 3 case(s) — cibles: alliés [hors tourelles]
  - Le lanceur recule de 3 case(s) — cibles: ennemis
  - Le lanceur recule de 6 case(s) — cibles: alliés [tourelles]
- Grades : g1 (niv 130) vs g2: lancers/tour 1 (g1) → 2 (g2)
- Rôle : self_move
- **Analyse tactique** : Recule de 3 (6 depuis une tourelle) — désengagement 1 PA.


### Paire 9 — Marée / Vapor

#### Marée (`13820`) — variante de base, débloqué niv. 25, grade 3

> Échange de position avec la cible et occasionne des dommages Eau aux ennemis.  Sur le lanceur : modifie l'état de Marée et rembourse le coût en PA et l'utilisation du sort. Cet effet peut être déclenché 2 fois maximum par tour.

- **3 PA**, PO 0–3 (non modifiable), lancer en ligne, en diagonale, ligne de vue ; 1 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Échange de positions avec le lanceur — cibles: alliés sauf lanceur/ennemis [lanceur sans état « Marée cible » (5317)]
  - Dommages Eau 34 à 38 — cibles: ennemis [lanceur sans état « Marée cible » (5317)]
  - la cible lance sur elle-même « Marée » (29129) niv.3 — cibles: lanceur(si dans zone)
    - ↳ Applique l'état « Marée I » (5304) — cibles: lanceur [lanceur sans état « Marée I » (5304)]; 1 tour; non désenvoûtable
    - ↳ Retire l'état « Marée I » (5304) — cibles: lanceur [lanceur avec état « Marée I » (5304)]
    - ↳ Applique l'état « Marée II » (5307) — cibles: lanceur [lanceur avec état « Marée I » (5304)]; 1 tour; non désenvoûtable
    - ↳ Sort « Marée » (13820) : +1 portée min — cibles: lanceur [lanceur avec état « Marée I » (5304); lanceur sans état « Marée cible » (5317)]; 1 tour
    - ↳ la cible lance sur elle-même « Marée » (29129) niv.2 — cibles: lanceur [lanceur sans état « Marée II » (5307)]
      - ↳ Retire l'état « Marée Basse » (5283) — cibles: lanceur [lanceur avec état « Marée Basse » (5283)]
      - ↳ Applique l'état « Marée Haute » (5282) — cibles: lanceur [lanceur avec état « Marée Basse » (5283)]; infini; non désenvoûtable
      - ↳ Retire l'état « Marée Haute » (5282) — cibles: lanceur [lanceur avec état « Marée Haute » (5282)]
      - ↳ Applique l'état « Marée Basse » (5283) — cibles: lanceur [lanceur avec état « Marée Haute » (5282)]; infini; non désenvoûtable
    - ↳ Rend 3 PA — cibles: lanceur [lanceur sans état « Marée II » (5307)]; 1 tour
    - ↳ Sort « Marée » (13820) : +1 lancer(s)/tour — cibles: lanceur [lanceur sans état « Marée II » (5307)]; 1 tour
    - ↳ Sort « Marée » (13820) : relance fixée à 1 tour(s) — cibles: lanceur [lanceur avec état « Marée I » (5304); lanceur avec état « Marée cible » (5317)]
  - le lanceur lance « Marée » (29129) niv.4 — cibles: alliés sauf lanceur/ennemis [lanceur sans état « Marée cible » (5317)]
    - ↳ Applique l'état « Marée cible » (5317) — cibles: lanceur; 1 tour; non désenvoûtable
    - ↳ Sort « Marée » (13820) : +1 lancer(s)/tour — cibles: lanceur [lanceur sans état « Marée II » (5307)]; 1 tour
    - ↳ Sort « Marée » (13820) : portée min fixée à 0 — cibles: lanceur [lanceur sans état « Marée II » (5307)]; 1 tour
    - ↳ Sort « Marée » (13820) : portée max fixée à 0 — cibles: lanceur [lanceur sans état « Marée II » (5307)]; 1 tour
- Coup critique : Dommages Eau 41 à 46
- Grades : g1 (niv 25) vs g3: Dommages Eau 21 à 24 (g1) → Dommages Eau 34 à 38 (g3) | g2 (niv 92) vs g3: Dommages Eau 27 à 31 (g2) → Dommages Eau 34 à 38 (g3)
- Rôle : ap_refund, damage, swap, tide
- **Analyse tactique** : Échange + Eau 34–38 ; sur soi : bascule la marée (gratuit, 2×/tour).

#### Vapor (`13826`) — variante alternative, débloqué niv. 135, grade 1

> Occasionne des dommages Feu aux ennemis et repousse les cibles depuis le centre en zone.  Évolue également les Tourelles dans la zone d'effet.

- **3 PA**, PO 0–7 (non modifiable), ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Dommages Feu 29 à 33 — croix r2; cibles: ennemis
  - Repousse de 2 case(s) — croix sans centre r2; cibles: alliés/ennemis
  - le lanceur lance « Évolution » (30136) niv.1 — croix r2; cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]
    - ↳ le lanceur lance « Évolution » (30136) niv.3 — cibles: alliés/ennemis
      - ↳ le lanceur lance « Évolution » (30136) niv.2 — cibles: alliés/ennemis [avec état « Évolution II » (134); lanceur sans état « Évolution en cours » (6095)]
      - ↳ Applique l'état « Évolution bloquée » (6094) — cibles: alliés/ennemis [avec état « Évolution II » (134); lanceur sans état « Évolution en cours » (6095)]; 1 tour; non désenvoûtable
      - ↳ Applique l'état « Évolution bloquée » (6094) — cibles: alliés/ennemis [sans état « Évolution II » (134); sans état « Évolution III » (135)]; 1 tour; non désenvoûtable
      - ↳ le lanceur lance « Évolution II » (13851) niv.3 — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution II » (134); sans état « Évolution bloquée » (6094); tourelles]
        - ↳ fait passer la tourelle en Évolution II (état 134, apparence, « Tourelle évoluée »)
      - ↳ le lanceur lance « Évolution III » (13852) niv.3 — cibles: alliés [avec état « Évolution II » (134); sans état « Évolution bloquée » (6094); lanceur sans état « Évolution en cours » (6095); tourelles]
        - ↳ fait passer la tourelle en Évolution III (état 135, devient CONTRÔLABLE, sort avancé débloqué)
  - Retire l'état « Évolution en cours » (6095) — cibles: lanceur
- Coup critique : Dommages Feu 35 à 40
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « +1 Évolution » (23844) niv.1 — croix r2; cibles: alliés/ennemis
- Rôle : aoe, damage, push
- **Analyse tactique** : Feu 29–33 en croix r2 + repousse depuis le centre ; évolue les tourelles de la zone.


### Paire 10 — Turbine / Flibuste

#### Turbine (`13874`) — variante de base, débloqué niv. 30, grade 3

> Occasionne des dommages Feu aux ennemis et attire les cibles jusqu'au centre en zone.  Évolue également les Tourelles dans la zone d'effet.

- **3 PA**, PO 0–7 (modifiable), ligne de vue, case occupée ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Dommages Feu 27 à 31 — croix r3; cibles: ennemis
  - Attire de 1 case(s) — croix sans centre r1; cibles: alliés/ennemis
  - Attire de 2 case(s) — croix sans centre r2 (rayon min 2); cibles: alliés/ennemis
  - Attire de 3 case(s) — croix sans centre r3 (rayon min 3); cibles: alliés/ennemis
  - le lanceur lance « Évolution » (30136) niv.1 — croix r3; cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]
    - ↳ le lanceur lance « Évolution » (30136) niv.3 — cibles: alliés/ennemis
      - ↳ le lanceur lance « Évolution » (30136) niv.2 — cibles: alliés/ennemis [avec état « Évolution II » (134); lanceur sans état « Évolution en cours » (6095)]
      - ↳ Applique l'état « Évolution bloquée » (6094) — cibles: alliés/ennemis [avec état « Évolution II » (134); lanceur sans état « Évolution en cours » (6095)]; 1 tour; non désenvoûtable
      - ↳ Applique l'état « Évolution bloquée » (6094) — cibles: alliés/ennemis [sans état « Évolution II » (134); sans état « Évolution III » (135)]; 1 tour; non désenvoûtable
      - ↳ le lanceur lance « Évolution II » (13851) niv.3 — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution II » (134); sans état « Évolution bloquée » (6094); tourelles]
        - ↳ fait passer la tourelle en Évolution II (état 134, apparence, « Tourelle évoluée »)
      - ↳ le lanceur lance « Évolution III » (13852) niv.3 — cibles: alliés [avec état « Évolution II » (134); sans état « Évolution bloquée » (6094); lanceur sans état « Évolution en cours » (6095); tourelles]
        - ↳ fait passer la tourelle en Évolution III (état 135, devient CONTRÔLABLE, sort avancé débloqué)
  - Retire l'état « Évolution en cours » (6095) — cibles: lanceur
- Coup critique : Dommages Feu 32 à 37
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « +1 Évolution » (23844) niv.1 — croix r3; cibles: alliés/ennemis
- Grades : g1 (niv 30) vs g3: Dommages Feu 17 à 20 (g1) → Dommages Feu 27 à 31 (g3) ; PO max 5 (g1) → 7 (g3) | g2 (niv 97) vs g3: Dommages Feu 22 à 25 (g2) → Dommages Feu 27 à 31 (g3) ; PO max 6 (g2) → 7 (g3)
- Rôle : aoe, damage, pull
- **Analyse tactique** : Feu 27–31 en croix r3 + attire vers le centre ; évolue les tourelles de la zone.

#### Flibuste (`13823`) — variante alternative, débloqué niv. 140, grade 1

> Occasionne des dommages Air et applique l'état Flibuste sur l'ennemi ciblé : • Occasionne des dommages Air aux ennemis en zone et retire l'état si la cible subit des dommages de poussée.

- **4 PA**, PO 1–7 (modifiable), ligne de vue ; 2 lancer(s)/tour, cumul max 1, CC 15 %
- Effets exécutés :
  - Dommages Air 33 à 37 — cibles: alliés/ennemis
  - Applique l'état « Flibuste » (5383) — cibles: ennemis; 2 tours
  - le lanceur lance « Flibuste » (31025) niv.1 — cibles: ennemis; déclenché quand le porteur subit des dommages de poussée ou à la mort du porteur (tué par dommages de poussée) (déclencheur actif 2 tour(s))
    - ↳ le lanceur lance « Flibuste » (31025) niv.2 — cibles: ennemis
      - ↳ Désenvoûte les effets du sort « Flibuste » (13823) — cibles: ennemis
      - ↳ Dommages Air 23 à 25 — carré r1; cibles: ennemis
- Coup critique : Dommages Air 40 à 44 ; Dommages Air 28 à 30
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Dommages Air 23 à 25 — carré r1; cibles: ennemis; déclenché quand le porteur subit des dommages de poussée ou à la mort du porteur (tué par dommages de poussée) (déclencheur actif 2 tour(s))
- Rôle : aoe, damage
- **Analyse tactique** : Air 33–37 + état Flibuste : si la cible subit des dommages de poussée, Air 23–25 en carré autour.


### Paire 11 — Tactirelle / Bathyscaphe

#### Tactirelle (`13831`) — variante de base, débloqué niv. 35, grade 3

> Pose une Tourelle tactique qui repousse les cibles en zone.

- **2 PA**, PO 1–7 (non modifiable), ligne de vue, case libre ; relance 3 tour(s), 1 lancer(s)/tour, 1/tour (limite globale), CC 0 %
- Effets exécutés :
  - Invoque Tactirelle (5837) grade 3 — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Évolutions Tactirelle » (29196) niv.1 — cibles: alliés/ennemis
- Grades : g1 (niv 35) vs g3: Invoque Tactirelle (5837) grade 1 (g1) → Invoque Tactirelle (5837) grade 3 (g3) | g2 (niv 102) vs g3: Invoque Tactirelle (5837) grade 2 (g2) → Invoque Tactirelle (5837) grade 3 (g3)
- Rôle : summon, turret
- **Analyse tactique** : Tourelle tactique : repousse en zone ; aura +dommages poussée/+Fuite.

#### Bathyscaphe (`13869`) — variante alternative, débloqué niv. 145, grade 1

> Pose une Tourelle défensive qui applique du bouclier.

- **2 PA**, PO 1–7 (non modifiable), ligne de vue, case libre ; relance 3 tour(s), 1 lancer(s)/tour, 1/tour (limite globale), CC 0 %
- Effets exécutés :
  - Invoque Bathyscaphe (5831) grade 1 — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Évolutions Bathyscaphe » (29201) niv.1 — cibles: alliés/ennemis
- Rôle : summon, turret
- **Analyse tactique** : Tourelle défensive (Revêtement 3×/tour) ; aura bouclier/+1 PA.


### Paire 12 — Scaphandre / Blindage

#### Scaphandre (`13819`) — variante de base, débloqué niv. 40, grade 3

> Applique un bouclier sur le lanceur et les Tourelles et le rend Intaclable. Le bouclier est plus important sur le lanceur.

- **3 PA**, PO 0–0 (non modifiable), sans ligne de vue ; relance 3 tour(s), cumul max 1, CC 20 %
- Effets exécutés :
  - Bouclier = 200% du niveau du lanceur — cibles: lanceur; 2 tours
  - Bouclier = 125% du niveau du lanceur — toute la carte; cibles: alliés [tourelles]; 2 tours
  - Applique l'état « Intaclable » (96) — cibles: lanceur; 1 tour
  - Change d'apparence (look 1035) — cibles: lanceur; 2 tours
- Coup critique : Bouclier = 250% du niveau du lanceur ; Bouclier = 150% du niveau du lanceur
- Grades : g1 (niv 40) vs g3: Bouclier = 100% du niveau du lanceur (g1) → Bouclier = 200% du niveau du lanceur (g3) ; Bouclier = 75% du niveau du lanceur (g1) → Bouclier = 125% du niveau du lanceur (g3) | g2 (niv 107) vs g3: Bouclier = 150% du niveau du lanceur (g2) → Bouclier = 200% du niveau du lanceur (g3) ; Bouclier = 100% du niveau du lanceur (g2) → Bouclier = 125% du niveau du lanceur (g3)
- Rôle : shield, untackleable
- **Analyse tactique** : Bouclier 400 PV au Steamer + 250 PV à toutes les tourelles + Intaclable.

#### Blindage (`13863`) — variante alternative, débloqué niv. 150, grade 1

> Applique un bouclier sur l'allié ciblé et le rend Indéplaçable. Le bouclier est plus important sur les Tourelles.

- **3 PA**, PO 0–7 (non modifiable), ligne de vue ; relance 3 tour(s), cumul max 1, CC 20 %
- Effets exécutés :
  - Bouclier = 250% du niveau du lanceur — cibles: lanceur(si dans zone)/alliés [hors tourelles]; 2 tours
  - Bouclier = 500% du niveau du lanceur — cibles: alliés [tourelles]; 2 tours
  - Applique l'état « Indéplaçable » (97) — cibles: alliés; 1 tour
  - Change d'apparence (look 1035) — cibles: lanceur; 2 tours
- Coup critique : Bouclier = 300% du niveau du lanceur ; Bouclier = 600% du niveau du lanceur
- Rôle : immovable, shield
- **Analyse tactique** : Bouclier 500 PV (1 000 sur une tourelle) + Indéplaçable.


### Paire 13 — Foène / Cabestan

#### Foène (`13824`) — variante de base, débloqué niv. 45, grade 3

> Occasionne des dommages Air aux ennemis et repousse les cibles en zone.

- **3 PA**, PO 1–6 (non modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 10 %
- Effets exécutés :
  - Dommages Air 28 à 32 — fourche r1; cibles: ennemis
  - Repousse de 2 case(s) — fourche r1; cibles: alliés/ennemis
- Coup critique : Dommages Air 34 à 38
- Grades : g1 (niv 45) vs g3: Dommages Air 18 à 20 (g1) → Dommages Air 28 à 32 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 112) vs g3: Dommages Air 23 à 26 (g2) → Dommages Air 28 à 32 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : aoe, damage, push
- **Analyse tactique** : Air 28–32 en fourche + poussée 2.

#### Cabestan (`13875`) — variante alternative, débloqué niv. 155, grade 1

> Occasionne des dommages Terre aux ennemis et attire les cibles jusqu'au centre en zone. Téléporte également symétriquement les entités par rapport au centre si le sort est ciblé sur une Tourelle.  Les dommages de zone ne sont pas dégressifs. L'attirance n'affecte pas le lanceur.

- **3 PA**, PO 0–7 (non modifiable), ligne de vue ; 1 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Dommages Terre 29 à 33 — carré r1; cibles: ennemis
  - Attire de 1 case(s) — croix sans centre r1; cibles: alliés sauf lanceur/ennemis
  - Attire de 2 case(s) — croix diagonale sans centre r1; cibles: alliés sauf lanceur/ennemis
  - le lanceur lance « Cabestan » (29262) niv.1 — cibles: alliés [tourelles]
    - ↳ Téléportation symétrique par rapport au point d'impact — carré r1; cibles: alliés/ennemis
- Coup critique : Dommages Terre 35 à 40
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Attire de 2 case(s) — carré r1; cibles: alliés sauf lanceur/ennemis ; Téléportation symétrique par rapport au point d'impact — carré r1; cibles: alliés sauf lanceur/ennemis
- Rôle : aoe, damage, pull, teleport
- **Analyse tactique** : Terre 29–33 en carré r1 + attire ; sur une tourelle : téléport symétrique des entités autour.


### Paire 14 — Ressac / Écume

#### Ressac (`13821`) — variante de base, débloqué niv. 50, grade 3

> Occasionne des dommages Terre aux ennemis et repousse la cible.  Rend 2 PA au lanceur et la poussée ne fait pas de dommages si le sort est lancé sur une Tourelle.

- **3 PA**, PO 1–7 (non modifiable), ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 10 %
- Effets exécutés :
  - le lanceur lance « Ressac » (29588) niv.1 — cibles: alliés [tourelles]
    - ↳ Rend 2 PA — cibles: lanceur
  - Dommages Terre 23 à 27 — cibles: ennemis
  - Repousse de 2 case(s) — cibles: ennemis
  - Repousse de 2 case(s) — cibles: alliés [hors tourelles]
  - Repousse de 2 case(s) (sans dommages de poussée) — cibles: alliés [tourelles]
- Coup critique : Dommages Terre 28 à 32
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Rend 2 PA — cibles: lanceur
- Grades : g1 (niv 50) vs g3: Dommages Terre 15 à 17 (g1) → Dommages Terre 23 à 27 (g3) ; PO max 5 (g1) → 7 (g3) | g2 (niv 117) vs g3: Dommages Terre 20 à 23 (g2) → Dommages Terre 23 à 27 (g3) ; PO max 6 (g2) → 7 (g3)
- Rôle : ap_refund, damage, push
- **Analyse tactique** : Terre 23–27 + repousse 2 ; sur une tourelle : rend 2 PA et poussée sans dommages (repositionner une tourelle gratuitement).

#### Écume (`13825`) — variante alternative, débloqué niv. 160, grade 1

> Occasionne des dommages Eau aux ennemis et déplace les cibles selon la Marée en zone : • Marée Basse : attire les cibles vers le lanceur. • Marée Haute : repousse les cibles depuis le lanceur.

- **4 PA**, PO 1–6 (modifiable), lancer en ligne, ligne de vue ; 2 lancer(s)/tour, CC 15 %
- Effets exécutés :
  - Dommages Eau 32 à 36 — cône r2; cibles: ennemis
  - le lanceur lance « Écume » (29585) niv.2 — cône r2; cibles: alliés/ennemis [lanceur sans état « Marée Haute » (5282)]
    - ↳ Attire de 5 case(s) — cibles: alliés/ennemis
  - Applique l'état « Écume » (5314) — cône r2; cibles: alliés/ennemis [lanceur avec état « Marée Haute » (5282)]; 1 tour
  - le lanceur lance « Écume » (29585) niv.1 — cône r2; cibles: lanceur [lanceur avec état « Marée Haute » (5282)]
    - ↳ Repousse de 3 case(s) — toute la carte; cibles: alliés/ennemis [avec état « Écume » (5314)]
    - ↳ Retire l'état « Écume » (5314) — toute la carte; cibles: alliés/ennemis [avec état « Écume » (5314)]
- Coup critique : Dommages Eau 38 à 43
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Marée Basse : » (29147) niv.1 — cibles: alliés/ennemis ; Attire de 5 case(s) — cône r2; cibles: alliés/ennemis [lanceur sans état « Marée Haute » (5282)] ; le lanceur lance « Marée Haute : » (29146) niv.1 — cibles: alliés/ennemis ; Repousse de 3 case(s) — cône r2; cibles: alliés/ennemis [lanceur avec état « Marée Haute » (5282)]
- Rôle : aoe, damage, pull, push, tide
- **Analyse tactique** : Eau 32–36 en cône ; Basse : attire de 5 ; Haute : repousse de 3.


### Paire 15 — Sonar / Embuscade

#### Sonar (`13873`) — variante de base, débloqué niv. 55, grade 3

> Active les sorts spéciaux des Tourelles offensives du lanceur sur l'ennemi ciblé.  Occasionne des dommages dans le meilleur élément du lanceur aux ennemis.  Sur un allié : repousse les cibles depuis le centre et dévoile les invisibles en zone. N'affecte pas le lanceur.

- **3 PA**, PO 1–4 (modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, CC 10 %
- Effets exécutés :
  - Applique l'état « Activation offensive » (130) — cibles: ennemis; 1 tour
  - le lanceur lance « Activation Steamer » (23872) niv.1 — cibles: ennemis
    - ↳ la cible lance sur elle-même « Armada » (23850) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Harponneuse (5836)]
      - ↳ le lanceur lance « Armada » (13893) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Harponneuse (5836)]
      - ↳ le lanceur lance « Armada » (13893) niv.2 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 2 » (3496); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Harponneuse (5836)]
      - ↳ le lanceur lance « Armada » (13893) niv.3 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 3 » (3497); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Harponneuse (5836)]
    - ↳ la cible lance sur elle-même « Excavation » (23854) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Foreuse (5833)]
      - ↳ le lanceur lance « Excavation » (13888) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Foreuse (5833)]
      - ↳ le lanceur lance « Excavation » (13888) niv.2 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 2 » (3496); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Foreuse (5833)]
    - ↳ Retire l'état « Activation offensive » (130) — toute la carte; cibles: ennemis [avec état « Activation offensive » (130)]
  - Dommages meilleur élément 11 à 13 — cibles: ennemis
  - le lanceur lance « Sonar » (13880) niv.1 — cibles: alliés
    - ↳ Repousse de 2 case(s) — cercle r2 (rayon min 1); cibles: alliés sauf lanceur/ennemis
    - ↳ Révèle les entités invisibles — cercle r2; cibles: ennemis
  - Retire l'état « Activation offensive » (130) — cibles: ennemis
- Coup critique : Dommages meilleur élément 14 à 16
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur sa cellule « Spécial : Armada » (24232) niv.3 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Harponneuse (5836)] ; la cible lance sur sa cellule « Spécial : Excavation » (24236) niv.2 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Foreuse (5833)] ; Repousse de 2 case(s) — cercle r2 (rayon min 1); cibles: alliés sauf lanceur/ennemis ; Révèle les entités invisibles — cercle r2; cibles: ennemis
- Grades : g1 (niv 55) vs g3: Dommages meilleur élément 5 à 7 (g1) → Dommages meilleur élément 11 à 13 (g3) | g2 (niv 122) vs g3: Dommages meilleur élément 8 à 10 (g2) → Dommages meilleur élément 11 à 13 (g3)
- Rôle : damage, push, reveal_invisible, turret_special
- **Analyse tactique** : Active les spéciaux offensifs (Armada/Excavation) + meilleur élément 11–13 ; sur un allié : repousse et révèle les invisibles.

#### Embuscade (`13835`) — variante alternative, débloqué niv. 165, grade 1

> Active les sorts spéciaux des Tourelles offensives du lanceur sur la cible.  Occasionne des dommages Eau, Terre, Air et Feu.

- **4 PA**, PO 2–6 (non modifiable), ligne de vue ; 1 lancer(s)/tour, CC 5 %
- Effets exécutés :
  - Applique l'état « Activation offensive » (130) — cibles: ennemis; 1 tour
  - le lanceur lance « Activation Steamer » (23872) niv.1 — cibles: ennemis
    - ↳ la cible lance sur elle-même « Armada » (23850) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Harponneuse (5836)]
      - ↳ le lanceur lance « Armada » (13893) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Harponneuse (5836)]
      - ↳ le lanceur lance « Armada » (13893) niv.2 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 2 » (3496); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Harponneuse (5836)]
      - ↳ le lanceur lance « Armada » (13893) niv.3 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 3 » (3497); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Harponneuse (5836)]
    - ↳ la cible lance sur elle-même « Excavation » (23854) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Foreuse (5833)]
      - ↳ le lanceur lance « Excavation » (13888) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Foreuse (5833)]
      - ↳ le lanceur lance « Excavation » (13888) niv.2 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 2 » (3496); lanceur avec état « Évolution III » (135); avec état « Activation offensive » (130); lanceur =monstre Foreuse (5833)]
    - ↳ Retire l'état « Activation offensive » (130) — toute la carte; cibles: ennemis [avec état « Activation offensive » (130)]
  - Dommages Eau 7 à 9 — cibles: alliés/ennemis
  - Dommages Terre 7 à 9 — cibles: alliés/ennemis
  - Dommages Feu 7 à 9 — cibles: alliés/ennemis
  - Dommages Air 7 à 9 — cibles: alliés/ennemis
  - Retire l'état « Activation offensive » (130) — cibles: ennemis
- Coup critique : la cible lance sur sa cellule « Spécial : Armada » (24232) niv.4 ; la cible lance sur sa cellule « Spécial : Excavation » (24236) niv.3 ; Dommages Eau 10 à 12 ; Dommages Terre 10 à 12 ; Dommages Feu 10 à 12 ; Dommages Air 10 à 12
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur sa cellule « Spécial : Armada » (24232) niv.1 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Harponneuse (5836)] ; la cible lance sur sa cellule « Spécial : Excavation » (24236) niv.1 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Foreuse (5833)]
- Rôle : damage, turret_special
- **Analyse tactique** : Spéciaux offensifs + 4 éléments 7–9.


### Paire 16 — Courant / Harmattan

#### Courant (`13822`) — variante de base, débloqué niv. 60, grade 3

> Occasionne des dommages Eau aux ennemis et déplace la cible selon la Marée : • Marée Basse : attire la cible. • Marée Haute : repousse la cible.  Une même cible ne peut être affectée qu'une seule fois par le déplacement d'une Marée dans le tour en cours.

- **3 PA**, PO 1–4 (modifiable), lancer en ligne, en diagonale, ligne de vue ; 3 lancer(s)/tour, 2/cible, CC 10 %
- Effets exécutés :
  - Applique l'état « Courant Bas » (5306) — cibles: alliés/ennemis [sans état « Courant Bas » (5306); lanceur sans état « Marée Haute » (5282)]; 1 tour; non désenvoûtable
  - Applique l'état « Courant Haut » (5305) — cibles: alliés/ennemis [sans état « Courant Haut » (5305); lanceur avec état « Marée Haute » (5282)]; 1 tour; non désenvoûtable
  - Dommages Eau 30 à 34 — cibles: ennemis
  - Attire de 6 case(s) — cibles: alliés/ennemis [sans état « Courant Bas » (5306); lanceur sans état « Marée Haute » (5282)]
  - Repousse de 4 case(s) — cibles: alliés/ennemis [sans état « Courant Haut » (5305); lanceur avec état « Marée Haute » (5282)]
- Coup critique : Dommages Eau 36 à 41
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « Marée Basse : » (29147) niv.1 — cibles: alliés/ennemis ; le lanceur lance « Marée Haute : » (29146) niv.1 — cibles: alliés/ennemis
- Grades : g1 (niv 60) vs g3: Dommages Eau 22 à 25 (g1) → Dommages Eau 30 à 34 (g3) | g2 (niv 127) vs g3: Dommages Eau 27 à 30 (g2) → Dommages Eau 30 à 34 (g3)
- Rôle : damage, pull, push, tide
- **Analyse tactique** : Eau 30–34 ; Basse : attire de 6 ; Haute : repousse de 4.

#### Harmattan (`13861`) — variante alternative, débloqué niv. 170, grade 1

> Repousse la cible et occasionne des dommages Air aux ennemis. Rebondit sur les entités au contact de la cible.

- **4 PA**, PO 1–6 (modifiable), ligne de vue ; 1 lancer(s)/tour, 1/tour (limite globale), CC 20 %
- Effets exécutés :
  - le lanceur lance « Harmattan » (29269) niv.1 — cibles: alliés/ennemis
    - ↳ le lanceur lance « Harmattan » (29269) niv.2 — cibles: alliés/ennemis; déclenché à la mort du porteur (déclencheur actif 1 tour(s))
      - ↳ le lanceur lance « Harmattan » (29269) niv.2 — croix sans centre r1 (rayon min 1); cibles: alliés/ennemis [sans état « Harmattan » (5309)]; déclenché à la mort du porteur (déclencheur actif 1 tour(s))
      - ↳ Applique l'état « Harmattan » (5309) — croix sans centre r1 (rayon min 1); cibles: alliés/ennemis [sans état « Harmattan » (5309)]; 1 tour
      - ↳ Repousse de 2 case(s) — croix sans centre r1 (rayon min 1); cibles: alliés/ennemis [sans état « Harmattan » (5309)]
      - ↳ Dommages Air 31 à 35 — croix sans centre r1 (rayon min 1); cibles: ennemis [sans état « Harmattan » (5309)]
      - ↳ Désenvoûte les effets du sort « Harmattan » (29269) — croix sans centre r1 (rayon min 1); cibles: alliés/ennemis [sans état « Harmattan » (5309)]
      - ↳ Applique l'état « Harmattan » (5309) — croix sans centre r1 (rayon min 1); cibles: alliés/ennemis [sans état « Harmattan » (5309)]; 1 tour; non désenvoûtable
      - ↳ le lanceur lance « Harmattan » (29269) niv.2 — croix sans centre r1 (rayon min 1); cibles: alliés/ennemis [sans état « Harmattan » (5309)]
    - ↳ Applique l'état « Harmattan » (5309) — cibles: alliés/ennemis; 1 tour
    - ↳ Repousse de 2 case(s) — cibles: alliés/ennemis
    - ↳ Dommages Air 31 à 35 — cibles: ennemis
    - ↳ Désenvoûte les effets du sort « Harmattan » (29269) — cibles: alliés/ennemis
    - ↳ Applique l'état « Harmattan » (5309) — cibles: alliés/ennemis; 1 tour
    - ↳ le lanceur lance « Harmattan » (29269) niv.2 — cibles: alliés/ennemis
  - Retire l'état « Harmattan » (5309) — toute la carte; cibles: alliés/ennemis
- Coup critique : Dommages Air 37 à 42
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Repousse de 2 case(s) — cibles: alliés/ennemis ; Dommages Air 31 à 35 — cibles: ennemis
- Rôle : aoe, damage, push
- **Analyse tactique** : Air 31–35 + repousse 2 et rebondit sur les entités au contact de la cible.


### Paire 17 — Secourisme / Sauvetage

#### Secourisme (`13836`) — variante de base, débloqué niv. 65, grade 3

> Active les sorts spéciaux des Tourelles défensives du lanceur sur l'allié ciblé.  Soigne la cible dans le meilleur élément du lanceur.

- **3 PA**, PO 1–6 (modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, CC 10 %
- Effets exécutés :
  - Applique l'état « Activation défensive » (131) — cibles: alliés; 1 tour
  - le lanceur lance « Activation Steamer » (23872) niv.2 — cibles: alliés
    - ↳ la cible lance sur elle-même « Intervention » (23851) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Gardienne (5835)]
      - ↳ le lanceur lance « Intervention » (13848) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation défensive » (131); lanceur =monstre Gardienne (5835)]
      - ↳ le lanceur lance « Intervention » (13848) niv.2 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 2 » (3496); lanceur avec état « Évolution III » (135); avec état « Activation défensive » (131); lanceur =monstre Gardienne (5835)]
      - ↳ le lanceur lance « Intervention » (13848) niv.3 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 3 » (3497); lanceur avec état « Évolution III » (135); avec état « Activation défensive » (131); lanceur =monstre Gardienne (5835)]
    - ↳ la cible lance sur elle-même « Décompression » (23855) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Bathyscaphe (5831)]
      - ↳ le lanceur lance « Décompression » (13891) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation défensive » (131); lanceur =monstre Bathyscaphe (5831)]
    - ↳ Retire l'état « Activation défensive » (131) — toute la carte; cibles: alliés [avec état « Activation défensive » (131)]
  - Soin meilleur élément 25 à 29 — cibles: alliés/ennemis
  - Retire l'état « Activation défensive » (131) — cibles: alliés
- Coup critique : la cible lance sur sa cellule « Spécial : Intervention » (24233) niv.6 ; la cible lance sur sa cellule « Spécial : Décompression » (24237) niv.2 ; Soin meilleur élément 30 à 35
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur sa cellule « Spécial : Intervention » (24233) niv.3 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Gardienne (5835)] ; la cible lance sur sa cellule « Spécial : Décompression » (24237) niv.1 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Bathyscaphe (5831)]
- Grades : g1 (niv 65) vs g3: Soin meilleur élément 18 à 21 (g1) → Soin meilleur élément 25 à 29 (g3) ; PO max 4 (g1) → 6 (g3) | g2 (niv 131) vs g3: Soin meilleur élément 22 à 26 (g2) → Soin meilleur élément 25 à 29 (g3) ; PO max 5 (g2) → 6 (g3)
- Rôle : heal, turret_special
- **Analyse tactique** : Soin meilleur élément 25–29 + spéciaux défensifs (Intervention/Décompression) sur l’allié.

#### Sauvetage (`13871`) — variante alternative, débloqué niv. 175, grade 1

> Active les sorts spéciaux des Tourelles défensives du lanceur sur l'allié ciblé.  Soigne la cible.

- **3 PA**, PO 1–5 (non modifiable), sans ligne de vue ; 2 lancer(s)/tour, 1/cible, CC 10 %
- Effets exécutés :
  - Applique l'état « Activation défensive » (131) — cibles: alliés; 1 tour
  - le lanceur lance « Activation Steamer » (23872) niv.2 — cibles: alliés
    - ↳ la cible lance sur elle-même « Intervention » (23851) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Gardienne (5835)]
      - ↳ le lanceur lance « Intervention » (13848) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation défensive » (131); lanceur =monstre Gardienne (5835)]
      - ↳ le lanceur lance « Intervention » (13848) niv.2 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 2 » (3496); lanceur avec état « Évolution III » (135); avec état « Activation défensive » (131); lanceur =monstre Gardienne (5835)]
      - ↳ le lanceur lance « Intervention » (13848) niv.3 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 3 » (3497); lanceur avec état « Évolution III » (135); avec état « Activation défensive » (131); lanceur =monstre Gardienne (5835)]
    - ↳ la cible lance sur elle-même « Décompression » (23855) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Bathyscaphe (5831)]
      - ↳ le lanceur lance « Décompression » (13891) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation défensive » (131); lanceur =monstre Bathyscaphe (5831)]
    - ↳ Retire l'état « Activation défensive » (131) — toute la carte; cibles: alliés [avec état « Activation défensive » (131)]
  - Soin = 8% des PV max — cibles: alliés/ennemis
  - Retire l'état « Activation défensive » (131) — cibles: alliés
- Coup critique : la cible lance sur sa cellule « Spécial : Intervention » (24233) niv.6 ; la cible lance sur sa cellule « Spécial : Décompression » (24237) niv.2 ; Soin = 10% des PV max
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur sa cellule « Spécial : Intervention » (24233) niv.3 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Gardienne (5835)] ; la cible lance sur sa cellule « Spécial : Décompression » (24237) niv.1 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Bathyscaphe (5831)]
- Rôle : heal, turret_special
- **Analyse tactique** : Soin 8 % PV max (sans LdV) + spéciaux défensifs.


### Paire 18 — Ancrage / Court-circuit

#### Ancrage (`13827`) — variante de base, débloqué niv. 70, grade 2

> Occasionne des dommages Terre et retire des PM aux ennemis en zone. Les dommages de zone ne sont pas dégressifs.  Rend 1 PA au lanceur si une Tourelle est dans la zone d'effet.

- **4 PA**, PO 0–7 (non modifiable), ligne de vue ; 2 lancer(s)/tour, cumul max 1, CC 15 %
- Effets exécutés :
  - le lanceur lance (limite globale) « Ancrage » (29276) niv.1 — croix r1; cibles: alliés [tourelles]
    - ↳ Rend 1 PA — cibles: lanceur
  - Dommages Terre 35 à 38 — croix r1; cibles: ennemis
  - -3 PM (esquivable) — croix r1; cibles: ennemis; 1 tour
- Coup critique : Dommages Terre 42 à 46
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Rend 1 PA — cibles: lanceur
- Grades : g1 (niv 70) vs g2: Dommages Terre 27 à 30 (g1) → Dommages Terre 35 à 38 (g2)
- Rôle : aoe, ap_refund, damage, mp_removal
- **Analyse tactique** : Terre 35–38 en croix + -3 PM (zone non dégressive) ; +1 PA si tourelle dans la zone.

#### Court-circuit (`13872`) — variante alternative, débloqué niv. 180, grade 1

> Occasionne des dommages Feu aux ennemis en zone autour d'une Tourelle.  Évolue également la Tourelle et augmente ses chances de Critique.

- **4 PA**, PO 1–7 (non modifiable), ligne de vue ; 1 lancer(s)/tour, 1/tour (limite globale), CC 20 %
- Effets exécutés :
  - Dommages Feu 33 à 37 — cercle r3 (rayon min 1); cibles: ennemis [=monstre monstre #50000]
  - le lanceur lance « Court-circuit » (29594) niv.1 — cibles: alliés [tourelles]
    - ↳ Dommages Feu 33 à 37 — cercle r3 (rayon min 1); cibles: ennemis
  - le lanceur lance « Court-circuit » (29594) niv.3 — cibles: alliés [sans état « Évolution bloquée » (6094); tourelles]
    - ↳ Applique l'état « Évolution bloquée » (6094) — cibles: alliés [sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]; 1 tour; non désenvoûtable
    - ↳ le lanceur lance « Évolution II » (13851) niv.3 — cibles: alliés [sans état « Évolution II » (134); sans état « Évolution III » (135); sans état « Évolution bloquée » (6094); tourelles]
      - ↳ fait passer la tourelle en Évolution II (état 134, apparence, « Tourelle évoluée »)
    - ↳ le lanceur lance « Évolution III » (13852) niv.3 — cibles: alliés [avec état « Évolution II » (134); sans état « Évolution bloquée » (6094); tourelles]
      - ↳ fait passer la tourelle en Évolution III (état 135, devient CONTRÔLABLE, sort avancé débloqué)
  - +100% Critique — cibles: alliés [tourelles]; 1 tour
- Coup critique : Dommages Feu 40 à 44
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : le lanceur lance « +1 Évolution » (23844) niv.1 — cibles: alliés/ennemis
- Rôle : ally_crit_buff, aoe, damage
- **Analyse tactique** : Feu 33–37 en cercle 3 autour d’une tourelle + évolue la tourelle + 100 % CC (1 tour).


### Paire 19 — Plongée / Submersion

#### Plongée (`13833`) — variante de base, débloqué niv. 75, grade 2

> Active les sorts spéciaux des Tourelles tactiques du lanceur sur la cible.  Retire des PM aux ennemis.

- **3 PA**, PO 0–6 (modifiable), ligne de vue ; 2 lancer(s)/tour, 1/cible, cumul max 1, CC 0 %
- Effets exécutés :
  - Applique l'état « Activation tactique » (132) — cibles: alliés/ennemis; 1 tour
  - le lanceur lance « Activation Steamer » (23872) niv.3 — cibles: alliés/ennemis
    - ↳ la cible lance sur elle-même « Écoutille » (23852) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Tactirelle (5837)]
      - ↳ le lanceur lance « Écoutille » (13853) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Évolution III » (135); avec état « Activation tactique » (132); lanceur =monstre Tactirelle (5837)]
    - ↳ la cible lance sur elle-même « Mortier » (23853) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Chalutier (5832)]
      - ↳ le lanceur lance « Mortier » (29127) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation tactique » (132); lanceur =monstre Chalutier (5832)]
      - ↳ le lanceur lance « Mortier » (29127) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 2 » (3496); lanceur avec état « Évolution III » (135); avec état « Activation tactique » (132); lanceur =monstre Chalutier (5832)]
    - ↳ Retire l'état « Activation tactique » (132) — toute la carte; cibles: alliés/ennemis [avec état « Activation tactique » (132)]
  - -3 PM (esquivable) — cibles: ennemis; 1 tour
  - Retire l'état « Activation tactique » (132) — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur sa cellule « Spécial : Écoutille » (24234) niv.1 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Tactirelle (5837)] ; la cible lance sur sa cellule « Spécial : Mortier » (24235) niv.1 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Chalutier (5832)]
- Grades : g1 (niv 75) vs g2: PO max 5 (g1) → 6 (g2)
- Rôle : mp_removal, turret_special
- **Analyse tactique** : -3 PM + spéciaux tactiques (Écoutille/Mortier).

#### Submersion (`14306`) — variante alternative, débloqué niv. 185, grade 1

> Active les sorts spéciaux des Tourelles tactiques du lanceur sur la cible.  Retire de la Portée aux ennemis.

- **3 PA**, PO 0–7 (non modifiable), sans ligne de vue ; 2 lancer(s)/tour, 1/cible, cumul max 1, CC 0 %
- Effets exécutés :
  - Applique l'état « Activation tactique » (132) — cibles: alliés/ennemis; 1 tour
  - le lanceur lance « Activation Steamer » (23872) niv.3 — cibles: alliés/ennemis
    - ↳ la cible lance sur elle-même « Écoutille » (23852) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Tactirelle (5837)]
      - ↳ le lanceur lance « Écoutille » (13853) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Évolution III » (135); avec état « Activation tactique » (132); lanceur =monstre Tactirelle (5837)]
    - ↳ la cible lance sur elle-même « Mortier » (23853) niv.1 — toute la carte; cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Chalutier (5832)]
      - ↳ le lanceur lance « Mortier » (29127) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 1 » (3495); lanceur avec état « Évolution III » (135); avec état « Activation tactique » (132); lanceur =monstre Chalutier (5832)]
      - ↳ le lanceur lance « Mortier » (29127) niv.1 — toute la carte; cibles: alliés/ennemis [lanceur avec état « Tourelle Rang 2 » (3496); lanceur avec état « Évolution III » (135); avec état « Activation tactique » (132); lanceur =monstre Chalutier (5832)]
    - ↳ Retire l'état « Activation tactique » (132) — toute la carte; cibles: alliés/ennemis [avec état « Activation tactique » (132)]
  - -4 PO — cibles: ennemis; 1 tour
  - Retire l'état « Activation tactique » (132) — cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : la cible lance sur sa cellule « Spécial : Écoutille » (24234) niv.1 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Tactirelle (5837)] ; la cible lance sur sa cellule « Spécial : Mortier » (24235) niv.1 — cibles: alliés [groupe du lanceur; avec état « Évolution III » (135); =monstre Chalutier (5832)]
- Rôle : range_removal, turret_special
- **Analyse tactique** : -4 PO + spéciaux tactiques.


### Paire 20 — Compas / Boussole

#### Compas (`13877`) — variante de base, débloqué niv. 80, grade 2

> Échange les positions de la première et de la dernière cible dans la zone d'effet.  Sur le lanceur : téléporte les entités à son contact symétriquement par rapport à lui.

- **2 PA**, PO 0–8 (modifiable), lancer en ligne, ligne de vue ; relance initiale 1, 1 lancer(s)/tour, CC 0 %
- Effets exécutés :
  - la cible lance sur elle-même « Compas » (13882) niv.6 — cibles: lanceur(si dans zone)
    - ↳ Applique l'état « Compas ciblé caster » (5289) — cibles: lanceur; 1 tour
    - ↳ Téléportation symétrique par rapport au point d'impact — croix sans centre r1; cibles: alliés/ennemis
  - le lanceur lance « Compas » (13882) niv.1 — ligne 2; cibles: alliés/ennemis
    - ↳ le lanceur lance « Compas » (13882) niv.2 — cibles: alliés/ennemis [lanceur sans état « Compas ciblé caster » (5289)]
      - ↳ Applique l'état « Compas I » (5284) — cibles: alliés/ennemis [lanceur sans état « Compas Caster I » (5290); lanceur sans état « Compas Caster II » (5291); lanceur sans état « Compas Caster III » (5292)]; 1 tour
      - ↳ Applique l'état « Compas II » (5285) — cibles: alliés/ennemis [lanceur avec état « Compas Caster I » (5290)]; 1 tour
      - ↳ Applique l'état « Compas III » (5286) — cibles: alliés/ennemis [lanceur avec état « Compas Caster II » (5291)]; 1 tour
      - ↳ Applique l'état « Compas Caster I » (5290) — cibles: lanceur [lanceur sans état « Compas Caster I » (5290); lanceur sans état « Compas Caster II » (5291); lanceur sans état « Compas Caster III » (5292)]; 1 tour
      - ↳ Retire l'état « Compas Caster I » (5290) — cibles: lanceur [lanceur avec état « Compas Caster I » (5290)]
      - ↳ Applique l'état « Compas Caster II » (5291) — cibles: lanceur [lanceur avec état « Compas Caster I » (5290)]; 1 tour
      - ↳ Retire l'état « Compas Caster II » (5291) — cibles: lanceur [lanceur avec état « Compas Caster II » (5291)]
      - ↳ Applique l'état « Compas Caster III » (5292) — cibles: lanceur [lanceur avec état « Compas Caster II » (5291)]; 1 tour
  - la cible lance sur elle-même « Compas » (13882) niv.3 — cibles: lanceur
    - ↳ la cible lance sur elle-même « Compas » (13882) niv.4 — toute la carte; cibles: alliés/ennemis [avec état « Compas I » (5284); lanceur avec état « Compas Caster II » (5291)]
      - ↳ Échange de positions avec le lanceur — toute la carte; cibles: alliés sauf lanceur/ennemis [avec état « Compas II » (5285)]
    - ↳ la cible lance sur elle-même « Compas » (13882) niv.5 — toute la carte; cibles: alliés/ennemis [avec état « Compas I » (5284); lanceur avec état « Compas Caster III » (5292)]
      - ↳ Échange de positions avec le lanceur — toute la carte; cibles: alliés sauf lanceur/ennemis [avec état « Compas III » (5286)]
    - ↳ Retire l'état « Compas I » (5284) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Compas II » (5285) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Compas III » (5286) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Compas Caster I » (5290) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Compas Caster II » (5291) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Compas Caster III » (5292) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Compas ciblé caster » (5289) — toute la carte; cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Échange de positions avec le lanceur — ligne 2; cibles: alliés/ennemis ; Téléportation symétrique par rapport au point d'impact — cibles: alliés/ennemis
- Grades : g1 (niv 80) vs g2: PO max 7 (g1) → 8 (g2)
- Rôle : swap, teleport
- **Analyse tactique** : Échange la première et la dernière cible d’une ligne de 2 ; sur soi : téléport symétrique des adjacents.

#### Boussole (`13860`) — variante alternative, débloqué niv. 190, grade 1

> Téléporte le lanceur symétriquement par rapport à une Tourelle.  Sur une case adjacente à une Tourelle : téléporte le lanceur sur la case ciblée ou échange de position avec la cible.

- **2 PA**, PO 1–1 (non modifiable), lancer en ligne, en diagonale, ligne de vue ; 2 lancer(s)/tour, 1/cible, CC 0 %
- Condition de lancer (états du lanceur) : `HS!7` — lanceur PAS dans l'état « Pesanteur » (7)
- Effets exécutés :
  - le lanceur lance « Boussole » (29138) niv.1 — cibles: alliés [tourelles]
    - ↳ Applique l'état « Boussole tourelle » (5299) — cibles: lanceur; 1 tour
    - ↳ Téléportation symétrique par rapport à la cible — cibles: alliés/ennemis
  - le lanceur lance (limite globale) « Boussole » (29138) niv.2 — croix sans centre r1; cibles: alliés [tourelles]
    - ↳ Applique l'état « Boussole » (5293) — cibles: lanceur [lanceur sans état « Boussole tourelle » (5299)]; 1 tour
  - le lanceur lance sur la cellule ciblée « Boussole » (29138) niv.3 — cibles: alliés/ennemis
    - ↳ Téléporte le lanceur sur la case ciblée — cibles: alliés/ennemis [lanceur avec état « Boussole » (5293); lanceur sans état « Boussole tourelle » (5299)]
    - ↳ Échange de positions avec le lanceur — cibles: alliés/ennemis [lanceur avec état « Boussole » (5293); lanceur sans état « Boussole tourelle » (5299)]
    - ↳ Retire l'état « Boussole » (5293) — cibles: lanceur
    - ↳ Retire l'état « Boussole tourelle » (5299) — cibles: lanceur
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Téléportation symétrique par rapport à la cible — cibles: alliés [tourelles] ; Téléporte le lanceur sur la case ciblée — cibles: alliés/ennemis ; Échange de positions avec le lanceur — cibles: alliés/ennemis
- Rôle : swap, teleport
- **Analyse tactique** : Téléport symétrique par rapport à une tourelle (ou échange/téléport près d’elle).


### Paire 21 — Assistance / Aiguillage

#### Assistance (`13862`) — variante de base, débloqué niv. 85, grade 2

> Téléporte l'allié ciblé sur la première case disponible entre le lanceur et lui.  Soigne également la cible si c'est une Tourelle.

- **2 PA**, PO 1–8 (non modifiable), lancer en ligne, sans ligne de vue, case occupée ; relance 2 tour(s), CC 0 %
- Effets exécutés :
  - Applique l'état « Assistance » (2230) — cibles: lanceur; 1 tour; non désenvoûtable
  - la cible lance sur elle-même « Assistance » (13878) niv.1 — cibles: alliés
    - ↳ le lanceur lance « Assistance » (13878) niv.2 — toute la carte; cibles: alliés/ennemis [avec état « Assistance » (2230)]
      - ↳ Téléporte le lanceur sur la case ciblée — ligne depuis le lanceur 0; cibles: alliés/ennemis [lanceur sans état « Pesanteur » (7)]
  - Soin = 25% des PV max — cibles: alliés [tourelles]
  - Retire l'état « Assistance » (2230) — cibles: lanceur
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Téléporte le lanceur sur la case ciblée — cibles: alliés/ennemis
- Grades : g1 (niv 85) vs g2: PO max 7 (g1) → 8 (g2)
- Rôle : heal, teleport
- **Analyse tactique** : Ramène un allié contre le Steamer (sauvetage) ; soigne une tourelle.

#### Aiguillage (`13834`) — variante alternative, débloqué niv. 195, grade 1

> Attire la cible vers la Tourelle la plus proche dans une croix de taille 5 autour d'elle. Si la cible termine son déplacement au contact d'une Tourelle, cette dernière la téléporte symétriquement et lui réapplique les effets du sort.

- **2 PA**, PO 0–1 (non modifiable), lancer en ligne, sans ligne de vue ; relance 2 tour(s), CC 0 %
- Effets exécutés :
  - Attire de 4 case(s) — cibles: alliés/ennemis
  - la cible lance sur elle-même « Aiguillage » (29143) niv.1 — cibles: ennemis
    - ↳ Applique l'état « Aiguillage cible » (5298) — cibles: lanceur; 1 tour
    - ↳ la cible lance sur elle-même (limite globale) « Aiguillage » (29143) niv.3 — croix sans centre r5; cibles: ennemis [sans état « Aiguillage » (5297); tourelles]
      - ↳ la cible lance sur elle-même « Aiguillage » (29143) niv.8 — cibles: lanceur
      - ↳ Attire de 4 case(s) — croix sans centre r5; cibles: alliés/ennemis [avec état « Aiguillage cible » (5298)]
      - ↳ la cible lance sur elle-même « Aiguillage » (29143) niv.5 — cibles: lanceur
      - ↳ Applique l'état « Aiguillage » (5297) — cibles: lanceur; 1 tour; non désenvoûtable
      - ↳ la cible lance sur elle-même « Aiguillage » (29143) niv.1 — toute la carte; cibles: alliés/ennemis [avec état « Aiguillage cible » (5298)]
  - la cible lance sur elle-même « Aiguillage » (29143) niv.2 — cibles: alliés
    - ↳ Applique l'état « Aiguillage cible » (5298) — cibles: lanceur; 1 tour
    - ↳ la cible lance sur elle-même (limite globale) « Aiguillage » (29143) niv.4 — croix sans centre r5; cibles: alliés [sans état « Aiguillage » (5297); tourelles]
      - ↳ la cible lance sur elle-même « Aiguillage » (29143) niv.8 — cibles: lanceur
      - ↳ Attire de 4 case(s) — croix sans centre r5; cibles: alliés/ennemis [avec état « Aiguillage cible » (5298)]
      - ↳ la cible lance sur elle-même « Aiguillage » (29143) niv.5 — cibles: lanceur
      - ↳ Applique l'état « Aiguillage » (5297) — cibles: lanceur; 1 tour; non désenvoûtable
      - ↳ la cible lance sur elle-même « Aiguillage » (29143) niv.2 — toute la carte; cibles: alliés/ennemis [avec état « Aiguillage cible » (5298)]
  - la cible lance sur elle-même « Aiguillage » (29143) niv.6 — cibles: lanceur
    - ↳ Retire l'état « Aiguillage » (5297) — toute la carte; cibles: alliés/ennemis
    - ↳ Retire l'état « Aiguillage cible » (5298) — toute la carte; cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Téléportation symétrique par rapport au point d'impact — cibles: alliés/ennemis
- Rôle : pull, teleport
- **Analyse tactique** : Attire la cible vers la tourelle la plus proche (croix 5) ; au contact : téléport symétrique + réapplication.


### Paire 22 — Brise l'Âme / Récursivité

#### Brise l'Âme (`13849`) — variante de base, débloqué niv. 90, grade 2

> Applique l'état Automatique sur une Tourelle et la soigne : • La Tourelle intercepte les dommages subis en mêlée par les alliés à son contact au lancer du sort. • Si un des alliés subit des dommages à distance, la Tourelle s'active en utilisant son sort automatique sur l'allié ou sur son attaquant.  L'activation peut être déclenchée qu'une seule fois par cible par tour et si l'allié ou l'attaquant est à portée de la Tourelle.

- **3 PA**, PO 1–7 (modifiable), ligne de vue, case occupée ; relance 4 tour(s), cumul max 1, CC 0 %
- Effets exécutés :
  - la cible lance sur elle-même « Brise l'Âme » (13850) niv.1 — cibles: alliés [tourelles]
    - ↳ Applique l'état « Automatique » (5294) — cibles: lanceur; 2 tours
    - ↳ Intercepte les dommages destinés à la cible (sacrifice) — croix sans centre r1; cibles: alliés sauf lanceur; déclenché quand le porteur subit des dommages en mêlée (déclencheur actif 2 tour(s))
    - ↳ Applique l'état « Sacrifice » (583) — croix sans centre r1; cibles: alliés sauf lanceur; 2 tours
    - ↳ Désenvoûte les effets du sort « Brise l'Âme » (29141) — croix sans centre r1; cibles: alliés sauf lanceur
    - ↳ le lanceur lance « Brise l'Âme » (29141) niv.1 — croix sans centre r1; cibles: alliés sauf lanceur
      - ↳ le lanceur lance « Brise l'Âme » (29141) niv.2 — cibles: alliés [tourelles]; déclenché quand le porteur subit des dommages à distance (déclencheur actif 2 tour(s))
      - ↳ le lanceur lance « Brise l'Âme » (29141) niv.4 — cibles: alliés [tourelles]; déclenché quand le porteur subit des dommages à distance (déclencheur actif 2 tour(s))
  - Soin = 25% des PV max — cibles: alliés [tourelles]
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Applique l'état « Automatique » (5294) — cibles: alliés [tourelles]; 2 tours ; Intercepte les dommages destinés à la cible (sacrifice) — croix r1; cibles: alliés/ennemis; déclenché quand le porteur subit des dommages en mêlée (déclencheur actif 2 tour(s))
- Grades : g1 (niv 90) vs g2: PO max 6 (g1) → 7 (g2)
- Rôle : heal, sacrifice, turret_support
- **Analyse tactique** : Tourelle « Automatique » : intercepte la mêlée des alliés adjacents et riposte automatiquement.

#### Récursivité (`13876`) — variante alternative, débloqué niv. 200, grade 1

> Repousse la cible. Si la cible termine son déplacement au contact d'une Tourelle, cette dernière la téléporte symétriquement et lui réapplique les effets du sort.  La poussée initiale n'affecte pas le lanceur.

- **3 PA**, PO 0–1 (non modifiable), sans ligne de vue, case occupée ; relance 2 tour(s), relance initiale 1, CC 0 %
- Effets exécutés :
  - Repousse de 4 case(s) — cibles: alliés sauf lanceur/ennemis
  - la cible lance sur elle-même « Récursivité » (13881) niv.1 — cibles: ennemis
    - ↳ la cible lance sur le déclencheur (limite globale) « Récursivité » (13881) niv.3 — croix sans centre r1; cibles: ennemis [sans état « Récursivité » (2460); tourelles]
      - ↳ Téléportation symétrique par rapport au lanceur — cibles: alliés/ennemis
      - ↳ le lanceur lance « Récursivité » (13881) niv.5 — cibles: alliés/ennemis
      - ↳ Applique l'état « Récursivité » (2460) — cibles: lanceur; 1 tour; non désenvoûtable
      - ↳ la cible lance sur elle-même « Récursivité » (13881) niv.1 — cibles: alliés/ennemis
  - la cible lance sur elle-même « Récursivité » (13881) niv.2 — cibles: alliés
    - ↳ la cible lance sur le déclencheur (limite globale) « Récursivité » (13881) niv.4 — croix sans centre r1; cibles: alliés [sans état « Récursivité » (2460); tourelles]
      - ↳ Téléportation symétrique par rapport au lanceur — cibles: alliés/ennemis
      - ↳ le lanceur lance « Récursivité » (13881) niv.5 — cibles: alliés/ennemis
      - ↳ Applique l'état « Récursivité » (2460) — cibles: lanceur; 1 tour; non désenvoûtable
      - ↳ la cible lance sur elle-même « Récursivité » (13881) niv.2 — cibles: alliés/ennemis
  - la cible lance sur elle-même « Récursivité » (13881) niv.6 — cibles: lanceur
    - ↳ Retire l'état « Récursivité » (2460) — toute la carte; cibles: alliés/ennemis
- Info-bulle uniquement (`forClientOnly`, non exécuté tel quel) : Téléportation symétrique par rapport au point d'impact — cibles: alliés/ennemis
- Rôle : push, teleport
- **Analyse tactique** : Repousse de 4 ; au contact d’une tourelle : téléport symétrique + réapplication (rebond).


## 5. Choix des variantes (« sets de sorts ») par rôle

### Set « Ingénieur soutien » (soin + placement, recommandé en groupe de 4)

Gardienne + Harponneuse + Bathyscaphe, Secourisme pour le soin direct, Marée/Compas/Boussole pour le placement, Ancrage pour l’entrave.

| Paire | Choix | Pourquoi |
|---|---|---|
| 1 | Longue-vue | +3 PO allié / -2 PM |
| 2 | Amarrage | 1 PA net sur tourelle |
| 3 | Gouvernail | regroupement de zone |
| 4 | Sabotage | -30 dommages en zone |
| 5 | Harponneuse | DPS + aura dommages |
| 6 | Évolution | 1 PA/évolution + soin |
| 7 | Gardienne | soins automatiques |
| 8 | Aspiration | mobilité |
| 9 | Marée | échange + bascule gratuite |
| 10 | Turbine | zone + évolution |
| 11 | Bathyscaphe | boucliers + aura +1 PA |
| 12 | Blindage | bouclier + Indéplaçable |
| 13 | Cabestan | attire/téléport |
| 14 | Ressac | repositionner une tourelle |
| 15 | Sonar | Armada à distance |
| 16 | Courant | placement marée |
| 17 | Secourisme | soin + Intervention/Décompression |
| 18 | Ancrage | -3 PM zone |
| 19 | Plongée | -3 PM |
| 20 | Boussole | téléport |
| 21 | Assistance | sauvetage d’allié |
| 22 | Brise l’Âme | tourelle protectrice |

### Set « Artillerie » (DPS)

Harponneuse + Foreuse + Tactirelle, Surtension pour l’Évolution III immédiate, Sonar/Embuscade, sorts de zone.

| Paire | Choix | Pourquoi |
|---|---|---|
| 5 | Harponneuse |  |
| 7 | Foreuse |  |
| 11 | Tactirelle |  |
| 6 | Surtension |  |
| 15 | Embuscade |  |
| 18 | Court-circuit |  |


## 6. Rotations types (11–12 PA / 6 PM)

### Tour 1 — pose et évolution (12 PA)

*Contexte* : Début de combat, ennemis à distance.

1. Harponneuse (2 PA) à portée des ennemis (Évol I).
2. Évolution (1 PA) sur la Harponneuse → Évol II (aura +20 Dommages au Steamer au prochain tour de la tourelle).
3. Marée sur soi (3 PA rendus, 0 net) si besoin de passer en Marée Haute pour Longue-vue -2 PM.
4. Longue-vue (3 PA) ou Ancrage (4 PA, -3 PM) sur un ennemi.
5. Amarrage sur la tourelle (2 PA, 1 rendu) pour la rapprocher, ou Gouvernail (4 PA).

*Résultat attendu* : Une tourelle en II, ennemis ralentis.

### Tour 2 — 2e tourelle + spéciaux (12 PA)

*Contexte* : Harponneuse en II.

1. Gardienne (2 PA) près du groupe.
2. Évolution (1 PA) sur la Harponneuse → III (contrôlable, Armada débloqué).
3. Sonar (3 PA) sur un ennemi : Armada de la Harponneuse III (34–39 meilleur élément) + 11–13.
4. Secourisme (3 PA) sur un allié blessé.
5. 3 PA restants : Torpille/Longue-vue.
6. Jouer ensuite la Harponneuse III (6 PA : 3 × Espadon 30–34 vol de vie, 1/cible, ou Harponnage).

*Résultat attendu* : ≈ 3 actions de dégâts supplémentaires par tour via la tourelle contrôlée.


## 7. Forces et faiblesses

**Forces**

- Placement et contrôle du terrain inégalés (échanges, téléports symétriques, attirances de zone).
- Soins/boucliers continus via Gardienne/Bathyscaphe + Secourisme ; utile dans un groupe sans Eniripsa.
- Actions supplémentaires : une tourelle III contrôlée = un « 5e personnage » (6 PA).
- Économies de PA (Amarrage, Ressac, Marée, Gouvernail, Ancrage).

**Faiblesses**

- Montée en puissance lente (évolutions, 1 tourelle/tour, relance 3).
- Tourelles immobiles : vulnérables aux dégâts de zone, à repositionner (Ressac, Amarrage).
- Beaucoup d’effets dépendent de la géométrie (lignes, contact des tourelles) : IA complexe.
- Dégâts directs modestes sans tourelles évoluées.

## 8. Synergies avec les autres classes

- **Roublard** — Gouvernail/Turbine/Chalutier regroupent les ennemis sur les bombes ; Tactirelle repousse dans les murs.
- **Iop / Sacrieur / Zobal** — Placement des ennemis au contact des tanks ; Intervention (+2 PM) et Décompression (+2 PA) sur le DPS mêlée.
- **Crâ / Eliotrope** — Longue-vue +3 PO à l’allié ciblé ; Courant/Écume en Marée Haute repoussent les ennemis loin des DPS distance.
- **Enutrof / Sram (entrave)** — Chalutier III (+30 retrait PM) et Ancrage complètent le retrait PM.

## 9. Conseils pour l’IA de groupe

- Traiter chaque tourelle III comme un agent contrôlé supplémentaire dans la recherche de tour du groupe.
- Planifier les évolutions : 1 par tourelle et par tour ; prioriser la tourelle dont l’aura/le spécial apporte le plus (Harponneuse pour le DPS, Gardienne pour la survie).
- Garder Marée (bascule gratuite) pour adapter Courant/Écume/Longue-vue au besoin du tour.
- Utiliser Ressac/Amarrage sur ses propres tourelles quand elles sont hors de portée (gain de PA).

### 9.1 Pertinence pour l’Œil de Vortex (démo)

Analyse croisée avec `docs/research/vortex.md` (dossier d’un autre agent) :

- Placement des alliés hors des lignes de l’Auroraire : Marée (échange), Assistance (ramène un allié), Compas, Boussole ; et des monstres DANS ces lignes (Courant, Gouvernail, Tactirelle) — les dommages de l’Auroraire ne visent que les ennemis du Vortex, mais aligner les monstres sur l’heure voulue aide à les tuer au bon moment (INCERTAIN : vérifier qui est touché).
- Soins/boucliers continus (Gardienne, Bathyscaphe, Secourisme) pour encaisser l’érosion (+20 % 2 tours) des lignes.
- Les tourelles sont des cibles statiques : les placer hors des lignes récurrentes (IV/VIII/XII à 4 joueurs).
- Sabotage (-30 dommages) / Soupape (-20 % CC) contre le Vortex en phase 2.

## 10. Points incertains

- INCERTAIN — PV des tourelles (`bonusCharacteristics.lifePoints` = 180) et héritage du tacle.
- INCERTAIN — IA serveur des tourelles non contrôlées (choix de cible).
- INCERTAIN — Limite « 1/tour (global) » : interprétée comme une seule pose de tourelle par tour toutes tourelles confondues.
- INCERTAIN — La ligne de vue exigée pour les auras d’Évolution (description) n’apparaît pas dans les masques.
- INCERTAIN — Écarts avec la table de sorts embarquée dans DoMath (domath.fr, bundle main.js) : Corrosion 26–30 Air / CC 10 % chez DoMath contre 17–19 / CC 5 % dans les fichiers du jeu (DofusDB, 2026) ; Vapor et Turbine CC 15 % chez DoMath contre 10 % ici. Les données DofusDB sont retenues (plus récentes) ; 30 autres sorts du Steamer concordent.

## 11. Sources

- https://api.dofusdb.fr/breeds/15 ; https://api.dofusdb.fr/spell-variants?breedId=15 ; spells/spell-levels (ids cités) ; monsters 5831–5837
- Descriptions des sorts 23996 et 29182–29187 « Évolutions … » (DofusDB) pour les règles d’Évolution II/III
- https://dofus.jeuxonline.info/actualite/35637/dossier-savons-nous-steamers (contexte historique)
