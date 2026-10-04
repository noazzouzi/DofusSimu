# Règles de combat Dofus (Dofus 3 / Unity, données 2026) — référence moteur

> Objet : décrire **toutes les règles de combat hors formule de dégâts** nécessaires à un moteur fidèle
> (la formule de dégâts/soins détaillée est traitée dans le dossier « formules DoMath » ; on y renvoie quand il le faut).
> Données de géométrie directement implémentables : [`data/research/map-geometry.json`](../../data/research/map-geometry.json).
>
> Rédigé le 2026-10-04. Langue : français ; identifiants de code/JSON en anglais.

## 0. Sources, méthode et niveau de confiance

Les règles ci-dessous sont reconstituées à partir de trois familles de sources, par ordre de fiabilité :

1. **Code du client officiel** (décompilé, publié sur GitHub) :
   - Client Dofus 2 (ActionScript) — dépôt `Romain-P/d2gen` (`scripts/com/ankamagames/...`), fichiers cités sous la forme `D2:NomDuFichier`.
     URL de base : `https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/`.
     Ex. [`MapPoint.as`](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/jerakine/types/positions/MapPoint.as),
     [`LosDetector.as`](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/jerakine/map/LosDetector.as),
     [`TackleUtil.as`](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/dofus/logic/game/fight/miscs/TackleUtil.as),
     [`FightTurnFrame.as`](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/dofus/logic/game/fight/frames/FightTurnFrame.as),
     [`BuffManager.as`](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/dofus/logic/game/fight/managers/BuffManager.as),
     [`SpellManager.as`](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/dofus/logic/game/fight/types/castSpellManager/SpellManager.as),
     [`CurrentPlayedFighterManager.as`](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/dofus/logic/game/fight/managers/CurrentPlayedFighterManager.as),
     [`FightSpellCastFrame.as`](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/dofus/logic/game/fight/frames/FightSpellCastFrame.as),
     `FightBattleFrame.as` (copie locale `.cache/domath/d2client/Romain-P_d2gen.FightBattleFrame.as`).
   - **Logique de calcul de combat Dofus 3** : le client Dofus 3 (Unity) embarque le code de calcul de combat écrit en Haxe
     (déjà présent dans Dofus 2 sous `src/flash/MapTools` et `DamageCalculation`). Nous utilisons un **portage C#** de ce code
     provenant du projet communautaire *BubbleBot* (namespace `Bubble.DamageCalculation`, fichiers en cache local
     `.cache/domath/haxe/` : `MapTools.cs`, `PushUtils.cs`, `Teleport.cs`, `Mark.cs`, `HaxeFighter.cs`, `FightContext.cs`,
     `DamageCalculator.cs`, `PortalUtils.cs`). Cité `D3port:Fichier`. Fiabilité élevée pour la géométrie et les règles
     « mécaniques » ; quelques approximations du portage sont signalées.
2. **Données du jeu** via l'API DofusDB (`https://api.dofusdb.fr/`) : `spell-states` (6 375 états, cache
   `.cache/mechanics/dofusdb/spell-states.json`), `spell-levels` (champs de lancement), `monsters`, `characteristics`.
3. **Guides / annonces** : JeuxOnLine (devblogs Ankama relayés), DoMath (calculateur de tacle, code JS en cache
   `.cache/domath/pretty.main.e2dd4684.js`), tofus.fr, next-stage.fr, blogs. Les sites dofus.com et dofusbook.net
   ne sont pas accessibles depuis cet environnement (403).

Convention : **[Confiance : élevée]** = lu dans du code officiel ou confirmé par ≥2 sources ; **[moyenne]** = une source
communautaire ou code d'émulateur ; **INCERTAIN** = déduction / estimation, à valider en jeu.

---

## 1. Géométrie de la carte [Confiance : élevée]

Tout est détaillé et vérifié (script sur les 560 cellules) dans `map-geometry.json`. Résumé :

| Constante | Valeur | Source |
|---|---|---|
| `MAP_WIDTH` | 14 cellules par demi-ligne | D2:MapPoint, D2:AtouinConstants |
| `MAP_HEIGHT` | 20 (lignes « pleines ») → **40 demi-lignes** | idem |
| `CELL_COUNT` | 560 (`14 × 20 × 2`) | D2:AtouinConstants `MAP_CELLS_COUNT` |
| Taille d'une cellule à l'écran | 86 × 43 px (demi-hauteur 21,5) | D2:AtouinConstants |
| « Infini » | 63 (`PSEUDO_INFINITE` : portée illimitée, relance « non relançable », durée infinie) | D2:AtouinConstants, D2:SpellManager |

### 1.1 cellId ↔ (x, y)

```
row = floor(cellId / 14)        // 0..39 (demi-ligne, de haut en bas)
col = cellId % 14               // 0..13
x   = col + ceil(row / 2)       // = col + floor((row+1)/2)
y   = col - floor(row / 2)

// inverse
valide(x,y)  ⇔  0 ≤ x+y ≤ 27  et  0 ≤ x−y ≤ 39
row = x − y ;  col = floor((x + y) / 2) ;  cellId = row*14 + col
```

Identités utiles : `x − y = row`, `x + y = 2·col + (row % 2)`. Équivalent exact de `MapPoint.init()` (D2) et de
`MapTools.GetCellCoordById / GetCellIdByCoord` (D3port). Le module existant `src/map/geometry.ts` implémente déjà
ce repère (vérifié identique).

- **Distance** (portée, PM, zones) : `|xa − xb| + |ya − yb|` (Manhattan dans le repère tourné ; D3port `GetDistance`).
- **En ligne** : `xa == xb || ya == yb` ; **en diagonale** : `|xa − xb| == |ya − yb|`.
- **Adjacent** : distance 1 → au plus 4 voisins (les directions impaires 1/3/5/7).

### 1.2 Directions (DirectionsEnum)

| id | nom | (dx, dy) | déplacement ? | offset cellId ligne paire / impaire |
|---|---|---|---|---|
| 0 | E (droite écran) | (1, 1) | non (diagonale logique) | +1 / +1 |
| 1 | SE | (1, 0) | **oui** | +14 / +15 |
| 2 | S (bas écran) | (1, −1) | non | +28 / +28 |
| 3 | SW | (0, −1) | **oui** | +13 / +14 |
| 4 | W | (−1, −1) | non | −1 / −1 |
| 5 | NW | (−1, 0) | **oui** | −15 / −14 |
| 6 | N | (−1, 1) | non | −28 / −28 |
| 7 | NE | (0, 1) | **oui** | −14 / −13 |

Les offsets doivent toujours être validés par `(x, y)` (aux bords, l'offset retombe sur l'autre bord). Dans le code Haxe,
les directions **paires** sont dites « cardinales » (`IsCardinal`) et les impaires « orthogonales » (`IsOrthogonal`).

### 1.3 Exemples (10 cellules)

| cellId | row,col | (x, y) | voisins 1/3/5/7 (SE,SW,NW,NE) | diagonales 0/2/4/6 (E,S,W,N) |
|---|---|---|---|---|
| 0 | 0,0 | (0, 0) | 14, –, –, – | 1, 28, –, – |
| 13 | 0,13 | (13, 13) | 27, 26, –, – | –, 41, 12, – |
| 14 | 1,0 | (1, 0) | 29, 28, 0, 1 | 15, 42, –, – |
| 27 | 1,13 | (14, 13) | –, 41, 13, – | –, 55, 26, – |
| 28 | 2,0 | (1, −1) | 42, –, –, 14 | 29, 56, –, 0 |
| 100 | 7,2 | (6, −1) | 115, 114, 86, 87 | 101, 128, 99, 72 |
| 215 | 15,5 | (13, −2) | 230, 229, 201, 202 | 216, 243, 214, 187 |
| 300 | 21,6 | (17, −4) | 315, 314, 286, 287 | 301, 328, 299, 272 |
| 546 | 39,0 | (20, −19) | –, –, 532, 533 | 547, –, –, 518 |
| 559 | 39,13 | (33, −6) | –, –, 545, – | –, –, 558, 531 |

(« – » = hors carte.) Distances : d(0,559)=39, d(100,300)=14, d(215,300)=6.

---

## 2. Données de cellule et placement

### 2.1 Drapeaux de cellule [Confiance : élevée]

Lus dans le fichier de carte (D2:[CellData.as](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/atouin/data/map/CellData.as)),
format conservé en Dofus 3. Pour `mapVersion ≥ 9` (champ 16 bits) : `mov = (b&1)==0`, `nonWalkableDuringFight = (b&2)!=0`,
`los = (b&8)==0`, `blue = (b&16)!=0`, `red = (b&32)!=0` (détail complet dans le JSON).

- **Marchable en combat** : `mov && !nonWalkableDuringFight` (D2:DataMapProvider `pointMov`).
- **Transparent pour la LdV** : `los` (D2:DataMapProvider `pointLos`). Un trou/de l'eau est typiquement `mov=0, los=1`.
- **Attention au format Dofus 3 / DofusDB** : `https://api.dofusdb.fr/maps/<id>.json` → `cellsData[i]` expose des champs
  **déjà décodés**, en 0/1 et en **sémantique positive** : `mov=1` ⇒ marchable, `los=1` ⇒ transparent,
  `nonWalkableDuringFight`, `red`, `blue` (vérifié sur la carte Vortex 143393281 : 222 cases `mov=1`, 262 `mov=0,los=1`,
  76 `mov=0,los=0`, 12 rouges, 10 bleues). Ne **pas** réappliquer les masques de bits ci-dessus (bit 1 *posé* = non
  marchable dans le fichier binaire) sur ces champs. Détail du format : `docs/research/maps.md`.
- Les cellules peuvent être modifiées en combat (`updateCellMovLov`) par certains effets (murs, éléments de décor) :
  le moteur doit garder un calque `mov/los` dynamique par-dessus la carte.

### 2.2 Phase de placement [Confiance : élevée pour les couleurs, moyenne pour le reste]

- Deux équipes : **challengers** (`teamId 0`, cases **rouges** 0xDD2200) et **défenseurs** (`teamId 1`, cases **bleues**
  0x0022DD) — D2:[FightPreparationFrame.as](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/dofus/logic/game/fight/frames/FightPreparationFrame.as)
  (`COLOR_CHALLENGER = 14492160`, `COLOR_DEFENDER = 8925`). En PvM, les joueurs qui agressent un groupe sont les
  challengers (rouge), les monstres les défenseurs (bleu).
- Le serveur envoie les listes `positionsForChallengers` / `positionsForDefenders` (issues des données de la carte) ;
  un joueur ne peut se placer que sur une case libre de sa liste ; il peut échanger de place avec un allié.
- Placement des monstres : choisi par le serveur parmi les cases bleues (**INCERTAIN** : aléatoire ou fixe selon la carte ;
  pour la démo Vortex, utiliser les positions fixes documentées dans le dossier Vortex/cartes).
- **Simulateur** : la phase de placement est une décision d'IA (choix des cases rouges pour les 4 personnages) — c'est un
  levier d'optimisation important (LdV initiale, distance aux monstres, tacle).

---

## 3. Ligne de vue (LdV) [Confiance : élevée]

### 3.1 Algorithme du client

`LosDetector.getCell` (D2) appelle `Dofus2Line.getLine(caster, cible)` qui délègue (car `Dofus1Line.useDofus2Line = true`)
au code Haxe `MapTools.getLOSCellsVector`. Le portage D3 de ce code est `MapTools.GetCellsIdBetween` : un **DDA sur les
centres de cellules dans le repère (x, y)** :

```
cells = []
(x1,y1)=xy(caster); (x2,y2)=xy(cible); dx=x2−x1; dy=y2−y1; d=√(dx²+dy²)
absStepX = |d/dx| (∞ si dx=0) ; absStepY = |d/dy| (∞ si dy=0)
progressX = absStepX/2 ; progressY = absStepY/2
tant que (x1,y1) ≠ (x2,y2) :
   si |progressX − progressY| < 1e-4 : avancer x ET y   (passage exact par un coin)
   sinon si progressX < progressY      : avancer x
   sinon                                : avancer y
   cells.push(cellId(x1,y1))
// cells exclut la case du lanceur et se termine par la case cible
```

**Contre-vérification (ajoutée lors de la vérification)** : dans le client D2, `getLOSCellsVector` appelle
`_createCellsListForCells` (corps non décompilé dans d2gen). L'émulateur Java *kohana-gameserver*
([MapTools.java](https://raw.githubusercontent.com/SharpMan/kohana-gameserver/master/src/koh/game/entities/maps/pathfinding/MapTools.java))
en contient une décompilation : parcours **colonne par colonne** de l'axe principal, avec 1 ou 2 cases par colonne selon
que le segment franchit une frontière, arrondi à 1e‑4. Une fois les conditions décompilées remises dans leur sens
logique (De Morgan ; la version littérale est manifestement cassée : elle renvoie une mauvaise case même entre deux
cases adjacentes), cet algorithme renvoie **exactement les mêmes ensembles de cases** que le DDA ci-dessus sur les
**313 040 paires ordonnées** de la carte. Les deux algorithmes sautent aussi les deux cases latérales lors d'un passage
exact par un coin. Le DDA est en outre symétrique : A→B et B→A testent les mêmes cases intermédiaires pour toutes les
paires. ⚠ Le module existant `src/map/los.ts` teste au contraire **les deux cases latérales** d'un passage par un coin
(« la vue est bloquée si l'une d'elles bloque »). Il est donc plus restrictif que le client sur les 86 640 paires
ordonnées (≈ 28 %) dont la ligne passe exactement par au moins un coin. **À corriger côté moteur.**

### 3.2 Règle de visibilité

Pour chaque case de `cells`, dans l'ordre (D2:LosDetector + D2:DataMapProvider) :
- **cases intermédiaires** : il faut `los = true` **et** aucune entité bloquante ;
- **case cible** : seulement `los = true` (l'entité sur la case ciblée ne bloque évidemment pas).

Entités bloquantes : `hasEntity(x,y,true)` = une entité « obstacle » qui n'est ni `canWalkTo` ni `canSeeThrough`.
Tous les combattants vivants (joueurs, monstres, **invocations**, y compris statiques, bombes, tourelles…) bloquent la LdV ;
seul le combattant dont c'est le tour est rendu transparent (`CurrentPlayedFighterManager` : `setCanSeeThrough(true)`
sur le combattant actif). Les marques (glyphes, pièges, portails, runes) ne bloquent pas.

Conséquences importantes :
- en **diagonale parfaite**, seules les cases de la diagonale sont testées : on voit « entre » deux obstacles qui se touchent
  par un coin ;
- une cellule non marchable mais `los=1` (trou) ne bloque pas.

**INCERTAIN** : un combattant **invisible** bloque-t-il la LdV côté serveur ? Le client ne le connaît pas (il ne peut
donc pas l'afficher comme bloquant). Recommandation moteur : un invisible **ne bloque pas** la LdV pour l'équipe adverse
(choix cohérent avec ce que voit le joueur) — paramètre configurable.

Exemples calculés (JSON `lineOfSight.examples`) : 215→300 teste `[230, 243, 258, 272, 286]` puis la cible 300 ;
200→241 teste `[213, 228]` puis 241 ; 129→213 (diagonale) teste `[157, 185]` puis 213.

---

## 4. Lancer un sort : portée, conditions, limites [Confiance : élevée]

### 4.1 Champs DofusDB (`spell-levels`)

`apCost`, `minRange`, `range`, `rangeCanBeBoosted`, `castInLine`, `castInDiagonal`, `castTestLos`, `needFreeCell`,
`needTakenCell`, `needFreeTrapCell`, `needVisibleEntity`, `needCellWithoutPortal`, `portalProjectionForbidden`,
`criticalHitProbability` (en %), `maxCastPerTurn`, `maxCastPerTarget`, `maxStack`, `minCastInterval`,
`initialCooldown`, `globalCooldown`, `maxGlobalCastPerTurn/PerTarget`, `minPlayerLevel`, `statesCriterion`,
`effects`, `criticalEffect`, `previewZones`.

### 4.2 Zone de portée (D2:FightSpellCastFrame)

```
castInLine = castInLine || forme de zone du sort == 'l'      // une zone « ligne » force le lancer en ligne
si !castInLine && !castInDiagonal && !castTestLos && range == 63 → toute la carte (test AVANT le bonus de PO)
maxRange = range
si rangeCanBeBoosted : maxRange += bonusPO ; maxRange = max(maxRange, minRange)
maxRange = max(0, min(maxRange, 280))          // 280 = MAP_WIDTH × MAP_HEIGHT
pour r de minRange à maxRange :
  si castInLine && castInDiagonal → (x±r, y), (x, y±r) ET (x±r, y±r)   // croix 8 directions
  sinon si castInLine             → (x±r, y), (x, y±r)                 // croix 4 directions
  sinon si castInDiagonal         → (x±r, y±r)                         // diagonales seules
sinon (ni ligne ni diagonale)     → losange : toutes les cases avec minRange ≤ |dx|+|dy| ≤ maxRange
(minRange = 0 ⇒ la case du lanceur est incluse)
on ne garde que les cases MARCHABLES (pointMov : mov && !nonWalkableDuringFight)
si castTestLos → filtrer par la LdV (§3)
```

⚠ **Correction (vérification)** : pour les cases en diagonale, le rayon `r` compte des **pas diagonaux**. La case
`(x+r, y+r)` est à la distance de Manhattan `2r`. Un sort « ligne + diagonale » de PO 1 touche donc les **8 cases
autour** du lanceur, et non 4 (D2:[Cross.as](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/jerakine/types/zones/Cross.as)
`getCells` : `addCell(x + r, y - r)`…). C'est cohérent avec les données DofusDB : *Esprit Félin* (Écaflip, 12847),
*Cabriole* (Zobal, 13395) et *Cri de l'Ours* (Osamodas, 31132) sont `castInLine && castInDiagonal` avec une PO de 0 à 1.
Le seul sort de classe « diagonale seule » est *Espingole* (Roublard, 13440, PO 1–6). Les zones `Cross` et `Lozenge`
n'ajoutent **que les cases marchables** (`addCell` → `pointMov`) : un trou ou un obstacle n'est jamais ciblable
(D2:[Lozenge.as](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/jerakine/types/zones/Lozenge.as)).

### 4.3 Ordre de validation d'un lancer (D2:CurrentPlayedFighterManager.canCastThisSpell)

1. `minPlayerLevel` ≤ niveau ; sort connu ;
2. `apCost` (après modificateurs de sort) ≤ PA courants ;
3. pour chaque état porté par le lanceur :
   - état `preventsFight` (ex. *Affaibli* 42, *Saoul* 1) → **arme interdite** ;
   - état listé comme interdit par le sort → refus ;
   - état `preventsSpellCast` (ex. *Silencieux* 41, *Porteur* 3, *Gelé* 18) → refus **sauf** si le sort requiert/autorise
     explicitement cet état. Dans le code client, ce test n'est pas limité aux sorts : il s'applique aussi à l'arme
     (`spellId == 0`) ;
4. états requis présents ;
5. limite d'invocations (`canSummon`, sauf `bypassSummoningLimit`) et de bombes (`canBomb`) ;
6. `maxCastPerTurn` (0 = illimité) ;
7. relance (`cooldown > 0`, 63 = plus lançable) ;
8. `maxCastPerTarget` (+ bonus) pour la cible visée (0 = illimité).

En Dofus 3 (DofusDB), états requis/interdits sont encodés dans **`statesCriterion`** : `HS=<id>` (doit avoir l'état),
`HS!<id>` (ne doit pas l'avoir), combinés par `&` et `|` (et parenthèses). Statistiques sur les 2 416 niveaux de sorts
concernés (requête DofusDB, cache `.cache/mechanics/dofusdb/states_criterion.json` ; total revérifié en direct :
2 416 sur 34 697 niveaux de sorts). Critère **exactement égal** à : `HS!7` (pas en *Pesanteur*) ×503, `HS!1` ×54,
`HS=3` (*Porteur* requis : sorts de lancer du Pandawa) ×30. Le terme **apparaît** (seul ou combiné) dans :
`HS!7` ×624 niveaux (354 sorts), `HS!1` ×54, `HS=3` ×42 (24 sorts). Opérateurs rencontrés : `&` ×594, `|` ×113,
parenthèses ×13 ; seules les formes `HS=` et `HS!` existent.
Puis, côté cible (D3port:`DamageComputation`) : `needFreeCell` ⇒ pas de combattant vivant sur la case ; `needTakenCell` ⇒
un combattant vivant ; `needVisibleEntity` ⇒ combattant vivant et non invisible. `needFreeTrapCell` ⇒ pas de piège
(déduit du nom du champ ; ce test n'est pas dans le portage).

### 4.4 Relance (intervalle), relance initiale, relance globale (D2:SpellManager)

Chaque combattant a un compteur `currentTurn` (ses propres tours, +1 à la **fin** de chacun de ses tours ; recalé sur
`roundNumber − 1` à chaque nouveau tour de jeu). Au lancer : `lastCastTurn = currentTurn`.

```
cooldownRestant = minCastInterval + lastCastTurn − currentTurn      (≤0 ⇒ lançable)
relanceInitiale = initialCooldown − currentTurn (depuis le début du combat ou l'apparition de l'invocation)
```

Exemples : `minCastInterval = 1` ⇒ 1 fois par tour (relançable au tour suivant) ; `= 3` lancé à mon tour T ⇒ relançable
à mon tour T+3. `initialCooldown = 2` ⇒ lançable à partir de mon 3ᵉ tour. `minCastInterval = 63` ⇒ une seule fois par combat.
Les modificateurs de sort (`CAST_INTERVAL`, `CAST_INTERVAL_SET`) réduisent/fixent l'intervalle.
`globalCooldown` (> 0, surtout des sorts de monstres ; −1 ou 0 = aucun) : la relance s'applique à **tous les lanceurs**
de l'équipe possédant ce sort (**[moyenne]**, sémantique déduite du nom et des données : 166 niveaux de sorts concernés).

`maxCastPerTurn` et `maxCastPerTarget` sont remis à zéro à la **fin** de chaque tour du lanceur
(D2:FightBattleFrame `confirmTurnEnd` → `SpellCastInFightManager.nextTurn()` → `SpellManager.newTurn()`). Ils valent donc
zéro au début de son tour suivant.

### 4.5 Cumul d'effets (`maxStack`)

`maxStack ≤ 0` ⇒ illimité. Sinon, quand une cible porte déjà `maxStack` buffs identiques (même effet du même sort),
le portage D3 **retire le plus ancien** puis applique le nouveau (D3port:`HaxeFighter.StorePendingBuff`). Le client D2
n'affichait simplement pas le nouveau (`BuffManager.addBuff`). **INCERTAIN** : en cas de doute, appliquer la règle D3.

### 4.6 Coups critiques [Confiance : élevée]

- Depuis la 2.29 (refonte annoncée par JOL le 28/04/2015) : **P(critique) = taux de base du sort (%) + stat Critique
  du lanceur (+ bonus de sort)**. Le seul plafond est 100 %, l'Agilité n'a plus d'effet, et un sort dont le taux de base
  est 0 ne peut pas critiquer
  ([JOL — Évolution du système de coups critiques](https://dofus.jeuxonline.info/actualite/47963/evolution-systeme-coups-critiques)).
  Le même article donne un **plancher de 1 %** pour un sort qui peut critiquer : les malus de Critique ne peuvent pas
  descendre en dessous. Il ne s'applique pas aux effets de « minimisation des effets aléatoires » (ex. *Poisse*), qui
  empêchent toujours le critique. Dans le client D2 (`SpellWrapper.getCriticalHitProbability` / `playerCriticalRate`),
  la valeur est stockée sous la forme héritée `55 − taux` : `55 − criticalHitProbability − bonus de sort − Critique`,
  bornée à 55 (= 0 %). Une fois décodée, c'est bien la formule additive ci-dessus.
- Valeurs DofusDB : `criticalHitProbability` ∈ {0, 5, 10, 15, 20, 25…}. Revérifié en direct : les 61 niveaux de sorts
  `spellBreed=1` (Féca) se répartissent en 0 ×33, 15 ×23, 10 ×5.
- Les **échecs critiques** n'existent plus depuis la 2.11 (2013 : « Nous supprimons purement et simplement les échecs
  critiques des sorts et des armes en version 2.11 », [Millenium](https://www.millenium.org/news/112103.html)). La stat
  `criticalMiss` (id 39) est résiduelle. Le jet critique est tiré une fois par lancer ; le sort applique alors
  `criticalEffect` (ses propres effets, souvent plus forts) au lieu de `effects`.
- Exemple : sort 15 % + 35 Critique ⇒ 50 %.

---

## 5. Déplacement [Confiance : élevée]

- 4-connexe dans (x, y), **jamais en diagonale** (D2:Pathfinding.findPath appelé avec `allowDiag=false`,
  `bAllowTroughEntity=false`, `bIsFighting=true` dans D2:FightTurnFrame.drawPath).
- 1 PM par case ; le chemin ne traverse **aucun** combattant (allié ou ennemi) ni case non marchable.
- Le moteur peut utiliser un BFS (coûts uniformes), mais il doit **évaluer le tacle sur le chemin** (§6) : deux chemins de
  même longueur peuvent coûter des PM/PA différents. Le client affiche le chemin et les cases non atteignables en tenant
  compte du tacle (D2:FightReachableCellsMaker).
- **Pièges** : entrer dans une cellule d'un piège le déclenche et **arrête le déplacement** sur cette case (le reste du
  chemin est annulé, les PM non dépensés sont conservés) [moyenne : comportement classique ; cf. `StopDrag` côté poussée].
- **Invisible sur le chemin** : le déplacement s'arrête devant lui (**INCERTAIN**, comportement connu des joueurs ; le
  moteur peut l'implémenter en coupant le chemin à la case précédant l'invisible).
- **Glyphes-aura** : entrer/sortir pendant le déplacement applique/retire l'aura (§13).

---

## 6. Tacle et fuite [Confiance : élevée]

Système déterministe (devblog « Tacle déterministe », [JOL](https://dofus.jeuxonline.info/actualite/30452/devblog-tacle-deterministe)),
implémenté dans D2:[TackleUtil.as](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/dofus/logic/game/fight/miscs/TackleUtil.as)
et le calculateur DoMath.

```
pour un combattant M qui QUITTE la case C :
  tacleurs = ennemis vivants sur les 4 cases adjacentes à C pouvant tacler
  p = 1
  pour chaque tacleur T :
      r = (max(0, Fuite_M) + 2) / (2 * (max(0, Tacle_T) + 2))
      si r < 1 : p *= r                  // borne par tacleur à 1 (DoMath : min(1, r))
  PM_perdus = floor(PM_courants * (1 − p) + 0.5)       // arrondi au plus proche, .5 vers le haut
  PA_perdus = floor(PA_courants * (1 − p) + 0.5)
```

- Évalué **à chaque pas** quittant une case adjacente à un ennemi, sur les PA/PM **restants** à ce moment
  (D2:FightTurnFrame.drawPath : `mpLost += int((PM − pasDéjàFaits)·(1−p) + 0.5)`).
- Si les PM restants tombent à 0, le déplacement s'arrête (le personnage reste sur la case).
- Conditions (D2:TackleUtil `canBeTackled` / `canBeTackler`) :
  - **ne peut pas être taclé** : état avec `cantBeTackled` (*Intaclable* 96, *Enraciné* 6), invisible (ou détecté),
    porté (sur la case du porteur) ;
  - **ne peut pas tacler** : état `cantTackle` (*Intacleur* 95, *Enraciné* 6), invisible, porté, mort, même équipe,
    monstre dont `canTackle = false` (DofusDB `monsters.canTackle`).
- Stats : Tacle et Fuite = `floor(Agilité/10)` + bonus (tofus.fr) ; DofusDB `tackleBlock` (79), `tackleEvade` (78).
- Seuils utiles (DoMath / JOL) : immobilisation totale si `Tacle ≥ PM·(Fuite+2) − 2` ; aucune perte si
  `Fuite ≥ 2·Tacle + 2` ; à valeurs égales on perd la moitié.

Exemple : Fuite 40, PM 6, PA 11 ; un tacleur à 60 ⇒ r = 42/124 = 0,339 ⇒ PM perdus = round(6×0,661) = 4 (reste 2),
PA perdus = round(11×0,661) = 7 (reste 4). Avec un 2ᵉ tacleur à 30 (r = 42/64 = 0,656) : p = 0,222 ⇒ PM perdus 5.

---

## 7. Retrait et esquive de PA/PM [Confiance : moyenne]

Formule communautaire stable (forum officiel « Formule de calcul du retrait PA/PM ») et blog
[Alterya 2016](https://alterya.over-blog.com/index.php/2016/07/01/aldaron-nouvelles-esquive-papm-et-petit-comparaison/).
Exemple d'Alterya : « 7/10 × 60/50 × ½ = 42 % », puis 6/10 × … = 36 % pour le 2ᵉ PA, avec PA actuels / PA max. On la
retrouve **à l'identique** dans l'émulateur Dofus 3 `.cache/domath/other/otomai.FightActor.cs` (`RollApLose` :
`(Ap.Total − value) / Ap.TotalMax`, bornes 0,10–0,90). Correction lors de la vérification : l'émulateur Giny
(`giny.Fighter.cs` `RollAPLose`) **diffère**. Il divise par les PA **courants** (`(PA − i) / PA`, et non par les PA max),
et pour les PM il remplace la borne haute par `0,90 − 0,10 × i`. Les deux émulateurs ne sont donc pas « identiques ».
Retenir la forme Alterya/Otomai :

```
pour i = 0 .. n−1 (chaque point est tiré séparément) :
   P_i = 0.5 × (Retrait_lanceur / Esquive_cible) × (PA_actuels_cible − i) / PA_max_cible
   P_i = clamp(P_i, 0.10, 0.90)        ; Retrait et Esquive valent au minimum 1
   si rand() < P_i : 1 point retiré
```

- Retrait PA/PM et Esquive PA/PM = `floor(Sagesse/10)` + bonus (Alterya ; DofusDB `apReduction` 82, `mpReduction` 83,
  `DodgeApLostProbability` 27, `DodgeMpLostProbability` 28).
- Les retraits « non esquivables » (effets dédiés, ex. vol de PM fixe, tacle) ne passent pas par ce jet.
- Un état avec effet *InvulnerableToLostAp/Mp* (ids d'effet d'état 29/30) annule le retrait.
- Les PA/PM retirés pendant le tour d'un autre combattant sont généralement des **buffs de durée 1** sur la cible : ils
  diminuent ses PA/PM pour son prochain tour puis disparaissent (décompte §9).
- **INCERTAIN** : le dénominateur exact (`PA_max` incluant les buffs ou non) et l'existence d'un plafond spécifique en
  Dofus 3. Le calculateur DoMath prévoit une page « retrait » non publiée.

---

## 8. Ordre de jeu (timeline) [Confiance : élevée pour l'alternance, moyenne pour le reste]

- **Initiative** = (Force + Intelligence + Chance + Agilité + bonus Initiative) × PV_actuels / PV_max
  ([tofus.fr](https://www.tofus.fr/guide/guide-du-debutant-dofus.php) : « Il y a toujours alternance entre allié et
  ennemi », chaque point de caractéristique élémentaire donne 1 initiative, entrer blessé réduit l'initiative ;
  DofusDB `initiative` id 44). Le facteur exact `× PV/PVmax` est une formule communautaire **[moyenne]** : tofus dit
  seulement que « votre initiative est réduite si vous lancez le combat sans avoir toute votre vitalité ». Pour les
  monstres, les grades DofusDB n'ont **pas** de champ initiative (champs : `strength`, `intelligence`, `chance`,
  `agility`, `lifePoints`… ; vérifié sur Ikargn 3834). Utiliser la même formule, soit Ikargn grade 5 : 4 × 850 = 3 400
  (**INCERTAIN**).
- **Construction de la timeline** au début du combat :
  1. trier chaque équipe par initiative décroissante ;
  2. l'équipe dont le **meilleur** combattant a la plus haute initiative commence (égalité : aléatoire, **INCERTAIN**) ;
  3. alterner A1, B1, A2, B2… ; quand une équipe est épuisée, les combattants restants de l'autre jouent à la suite.
- L'ordre est **figé** pour tout le combat. Un mort garde sa place (le serveur envoie `turnsList` + `deadTurnsList`, D2
  `FightTurnListStep`) : son « tour » est sauté mais déclenche quand même le décompte de ses buffs (D2:FightBattleFrame,
  `GameFightTurnEndMessage` d'un mort ⇒ `decrementDuration`).
- **Invocations** : insérées dans la timeline **juste après leur invocateur** ; si plusieurs sont invoquées, la dernière
  invoquée joue la première après l'invocateur (règle historique documentée pour Dofus 1.29 sur
  [dofux.org](https://www.dofux.org/articles-197-Les-combats.dx) ; **INCERTAIN** pour Dofus 3 — à vérifier en jeu).
  Une invocation créée pendant le tour de son invocateur joue donc dans le même tour de jeu.
  Depuis la 2.58, le joueur peut contrôler ses invocations via *Maîtrise des invocations*
  ([JOL](https://dofus.jeuxonline.info/article/14922/comment-obtenir-sort-maitrise-invocations-dofus-258)) — pour le
  simulateur : invocations contrôlées par l'IA de groupe.
- **Tour de jeu** (`roundNumber`, message `GameFightNewRoundMessage`) : commence à 1 et s'incrémente quand la timeline
  reboucle. C'est l'unité utilisée par les vagues (§17) et les mécaniques de boss.
- Temps de tour, AFK, « passer son tour » automatique : **ignorés** par le simulateur.

---

## 9. Début et fin de tour, durées [Confiance : élevée pour les décomptes, INCERTAIN pour l'ordre fin]

### 9.1 Décompte des durées

- À **chaque début de tour d'un combattant X**, toutes les durées des effets dont la « source vivante » est X (sur
  n'importe quelle cible) diminuent de 1 ; ceux qui atteignent 0 disparaissent (D2:FightBattleFrame
  `GameFightTurnStartMessage` ⇒ `BuffManager.decrementDuration(X)` en mode `INCREMENT_MODE_SOURCE`,
  `buff.aliveSource == X`).
  ⇒ un effet « 1 tour » lancé par X pendant son tour dure jusqu'au début du prochain tour de X (il couvre le tour de
  tous les autres).
  ⚠ **Précision (vérification)** : `aliveSource` n'est **pas** toujours le lanceur. D2:[BasicBuff.as](https://raw.githubusercontent.com/Romain-P/d2gen/master/scripts/com/ankamagames/dofus/logic/game/fight/types/BasicBuff.as) fixe
  `aliveSource = fightBattleFrame.currentPlayerId`, c'est-à-dire le combattant **dont c'est le tour** quand le buff est
  créé (le lanceur `source` n'est utilisé qu'en reconnexion ou en spectateur). Un effet créé pendant le tour d'un autre
  combattant est donc décompté au tour de **ce combattant** : piège ou glyphe déclenché par un ennemi qui marche,
  riposte ou effet « quand subit des dommages »… Exemple : un retrait de PA de 1 tour posé par un piège pendant le tour
  de l'ennemi E s'applique tout de suite, sur le tour en cours de E. Il expire au début du tour suivant de E et ne
  pénalise donc pas ce tour-là. Le moteur doit mémoriser, pour chaque buff, le combattant actif au moment de sa création
  (code client ; le serveur est supposé identique puisque le client affiche ces durées).
- Durées ≥ 63 ou −1000 : jamais décomptées (permanent / tant que la condition dure ; ex. états *Porteur*/*Porté*).
  Durée 0 : effet instantané.
- Les marques (glyphes, pièges, murs, portails) ont aussi une durée (celle de l'effet de pose, −1 = permanente,
  D3port:`Mark.Duration/DecrementDuration`) ; nous supposons le même décompte au début du tour de leur lanceur
  (**INCERTAIN** : l'appelant n'est pas dans le portage ; c'est le comportement observé des glyphes Féca « 2 tours »).
- Effets à **retardement** (`delay > 0`) : décomptés au tour du lanceur et déclenchés quand le délai atteint 0
  (**INCERTAIN** sur l'instant exact : début du tour du lanceur).
- Si le lanceur meurt, ses buffs continuent d'être décomptés à son tour « fantôme » (cf. §8).

### 9.2 Ordre recommandé pour le moteur

Début du tour de X :
1. `roundNumber` : si X est le premier de la timeline, nouveau tour de jeu (vagues, horloges de boss…) ;
2. décompte des durées des effets lancés par X (retrait des expirés, y compris marques de X) ;
3. effets déclenchés « début de tour » (`triggers` contenant `TB`) portés par X : poisons, soins périodiques… (dans
   l'ordre d'application) ;
4. glyphes « début de tour » sur la case de X (dans l'ordre de pose) ;
5. si X est mort ou passe son tour (état/effet *PasseSonTour*) → fin de tour immédiate ; sinon X agit (PA/PM pleins).

Fin du tour de X :
1. effets `TE` (fin de tour) portés par X ; glyphes de fin de tour (`EndTrigger`) sous X ;
2. PA/PM remis à leur maximum (D2:FightBattleFrame `confirmTurnEnd`) ; compteurs de lancers/turn remis à zéro ;
   `currentTurn` (relances) de X +1.

L'ordre relatif des étapes 3 et 4 du début de tour est **INCERTAIN** (non observable dans le code client) ; il n'a
d'impact que sur des cas rares (poison + glyphe létaux).

Codes de déclencheurs vus dans les effets (D3port `HaxeBuff`, `SpellManager`) : `I` (instantané), `TB`/`TE`
(début/fin de tour), `D…` (dommages subis), `M` (déplacé), `K` (tue), `PO` (position occupée), `CAPA`/`CMPA`
(tentative de vol PA/PM), `ION` (devient invisible), `PST` (passage par portail)… La grammaire complète des effets est
dans le dossier dédié aux effets.

---

## 10. Points de vie, érosion, résistances, soins

- **Érosion** [moyenne pour la base, élevée pour le plafond] : chaque perte de PV par dommages retire aussi
  `floor(dommages × érosion%)` PV **maximum** (non soignables). Base **10 %** pour tous les combattants (consensus
  communautaire : forums officiels « L'Érosion faut-il en parler ? » / JVC, résumé moteur de recherche ; non lu dans le
  code), + bonus des sorts/équipements, **plafonnée à 50 %** (D3port:`DamageReceiver.GetPermanentDamage` :
  `min(PermanentDamagePercent, 50)` ; idem émulateur Giny). L'érosion ne peut pas tuer : `min(érosion, PV − 1)`.
  Caractéristique DofusDB `permanentDamagePercent` (75). Ex. 1 000 dommages à 10 % ⇒ PV max −100.
- **Résistances % élémentaires** : plafond **50 % pour un personnage joueur**, 100 % pour un monstre
  (D3port:`HaxeFighter.GetElementMainResist` : `MaxResistHuman = 50`, `MaxResistMonster = 100` ; confirmé par
  [dofuspourlesnoobs — Les dommages](https://www.dofuspourlesnoobs.com/les-dommages.html)). Le plafond s'applique à
  `résistance élémentaire % + résistance % globale`. Résistances fixes non plafonnées. Les invocations de joueurs sont des
  `Monster` dans le code ⇒ plafond 100 % (**INCERTAIN**).
- **Soins** : ne dépassent pas le PV max courant (érodé). État *Insoignable* (76, `incurable`) ⇒ soins sans effet.
  Formule de soin et modificateurs (`healBonus` 49, `dealtHealMultiplier` 143, `incomingPercentHealMultiplicator` 105)
  : voir dossier formules.
- **Boucliers** (`shield`, id 96) : absorbent les dommages avant les PV (détail : dossier formules).
- Mort : PV ≤ 0 ⇒ le combattant meurt immédiatement (déclencheurs de mort, retrait des états, ses invocations meurent —
  §11).

## 11. Invocations [Confiance : moyenne]

- **Limite** : stat *Invocation* (`maxSummonedCreaturesBoost`, id 26), base 1 pour un personnage (tofus.fr). On compte
  les invocations **vivantes** du lanceur dont le monstre a `useSummonSlot = true` et qui ne sont pas des éléments statiques
  (D3port:`FightContext.GetFighterCurrentSummonCount`). Bombes : `useBombSlot` + stat `maxBomb` (93).
- **Caractéristiques** : monstre DofusDB (`effect` d'invocation : `diceNum` = id du monstre, `diceSide` = grade, en
  général le grade = niveau du sort). Les monstres ont des champs `scaleGradeRef` et `characRatios`, présents **aussi sur
  des monstres qui ne sont pas des invocations**. Ex. Ikargn 3834, monstre de vague du Vortex : `scaleGradeRef = 6`,
  `characRatios` = [[0, 1,1], [10, 0,93], [11, 0], [12, 0,93], …, [25, 0,0012]], où la caractéristique 0 est les PV et
  10 la Force. Ils servent vraisemblablement à la mise à l'échelle (Songes, donjons modulaires) et peut-être à celle des
  invocations (**INCERTAIN**).
  **INCERTAIN** : règle exacte d'adaptation au niveau de l'invocateur. Approximation d'émulateur couramment utilisée :
  PV et caractéristiques × (1 + niveauInvocateur/100). À valider sur des valeurs en jeu.
- Les invocations utilisent le **niveau de leur invocateur** pour les dommages de poussée
  (D3port:`PushUtils.GetCollisionDamage`). Pour une collision provoquée par une bombe (Roublard) ou une tourelle
  (Steamer), `ApplyCollisionDamage` remplace le lanceur par l'invocateur. Dans le portage, cette variable n'est
  cependant pas réutilisée : les dommages restent calculés avec le bonus de Poussée de la bombe/tourelle et le niveau de
  l'invocateur. L'intention (Poussée de l'invocateur) est probable mais **INCERTAINE**.
- **Mort de l'invocateur** ⇒ ses invocations meurent (règle usuelle, **INCERTAIN** pour quelques invocations
  « persistantes » spécifiques).
- `startingSpellId` (DofusDB `monsters.grades`) : sort lancé automatiquement à l'apparition (passif de monstre).
- Ordre de jeu : §8.

## 12. États [Confiance : élevée — données DofusDB]

Les états ont des **drapeaux** et des **effets d'état** (`effectsIds`, énumération `StateEffectId` du code Haxe :
0 CantBePushed, 1 CantBeTackled, 2 CantTackle, 3 CantBeMoved, 4 CantBeCarried, 5 CantBeHealed, 6 Pacifist,
7 Invulnerable, 8 CantUseSpells, 9 CantUseWeapons, 12 IaShy, 13 IaDisoriented, 15 CanOnlyUseBows, 16 ServerSideOnly,
17 CantUsePortals, 18 CantSwitchPosition, 19 InvulnerableToMelee, 20 InvulnerableToRanged, 21–25 invulnérable à
Feu/Air/Eau/Terre/Neutre, 26 InvulnerableToPush, 27 …Critical, 28 …Weapons, 29 …LostAp, 30 …LostMp, 31 …Summoned).
Un état peut être neutralisé par un effet « désactiver l'état » (D3port:`HasStateEffect`).

| id | État | Effets | Conséquences moteur |
|---|---|---|---|
| 1 | Saoul | 9 | pas d'arme |
| 3 | Porteur | 9, 8, 4 | porte un allié/ennemi ; seuls les sorts exigeant l'état (`HS=3`) sont lançables ; non portable |
| 6 | Enraciné | 0, 1, 2, 17, 18 | ni poussé/attiré, ni taclé, ne tacle pas, pas de portail, pas d'échange de place |
| 7 | Pesanteur | 18 | pas d'échange de place ; les sorts de mobilité ont `HS!7` ⇒ interdits |
| 8 | Porté | – | sur la case du porteur ; ne tacle pas, n'est pas taclé ; peut quitter le porteur en se déplaçant (D2:FightReachableCellsMaker) |
| 18 / 19 | Gelé / Fissuré | 9, 8 | ni sort ni arme |
| 41 | Silencieux | 8 | aucun sort |
| 42 | Affaibli | 9 | pas d'arme |
| 56 | Invulnérable | 7 | aucun dommage (y compris poussée) |
| 63 | Lourd | 4 | ne peut pas être porté |
| 76 | Insoignable | 5 | aucun soin |
| 95 | Intacleur | 2 | ne tacle pas |
| 96 | Intaclable | 1 | ne peut pas être taclé |
| 97 | Indéplaçable | 3, 17 | ni poussée/attirance, ni téléportation/échange, ni portage, ni portail |
| 157 | Inébranlable | 0 | ni poussé ni attiré (téléportation possible) |
| 218 | Pacifiste | 6 | inflige 0 dommage (même de poussée) |
| 250 | Invisible | 16 | voir §14 |

Monstres : drapeaux intrinsèques DofusDB `canPlay`, `canTackle`, `canBePushed`, `canSwitchPos`,
`canSwitchPosOnTarget`, `canBeCarried`, `canUsePortal`, `isBoss`, `useSummonSlot`. Invulnérabilités de boss par phase
(« invulnérable tant que… ») = états 56 / 19 / 20 / 21–25 posés et retirés par les scripts de boss (dossier IA/Vortex).
« Mêlée » = cible à distance 1 du lanceur (**INCERTAIN** sur le cas des zones, à confirmer dans le dossier formules).

## 13. Marques : glyphes, pièges, murs, runes, portails

Types (D2 `GameActionMarkTypeEnum`) : 1 GLYPH, 2 TRAP, 3 WALL, 4 PORTAL, 5 RUNE (D3 ajoute un type *Aura*).
Une marque a une case principale, des cellules (zone de l'effet de pose), une équipe, un lanceur, une durée et un sort
associé (D3port:`Mark`).

- **Glyphes « début de tour »** : appliquent leur sort à un combattant qui **commence son tour** dans la glyphe
  (ennemis en général, selon le masque de cibles). Ne se déclenchent **pas** quand on y est poussé
  (D3port:`ExecuteMarks` ignore les glyphes non-aura `fromDrag`). Quelques glyphes sont « immédiates »
  (`IsImmediate`) ou de **fin de tour** (`EndTrigger`).
- **Glyphes-aura** : effet appliqué en **entrant** dans la zone (y compris par poussée), retiré en sortant ; une seule
  application par combattant tant qu'il y reste (`TriggeredFighters`)
  ([Breakflip — refonte Féca](https://www.breakflip.com/?p=127283)).
- **Pièges** : invisibles pour l'équipe adverse ; se déclenchent dès qu'un combattant (de n'importe quelle équipe)
  **entre** dans une cellule du piège — marche, poussée, téléportation, lancer — puis disparaissent ; ils **arrêtent la
  poussée** (`StopDrag` pour TRAP et WALL) et le déplacement. Les réseaux de pièges (Sram) se résolvent en chaîne : voir
  le simulateur de pièges DoMath et `DamageCalculator.ExecuteMarks` (récursivité ≤ 10).
- **Murs** (Roublard) : `ExecuteWallDamage` quand on traverse/entre ; arrêtent la poussée.
- **Portails** : §16.
- Une case peut porter plusieurs marques ; elles se déclenchent dans l'ordre de pose (**INCERTAIN**).

## 14. Invisibilité [Confiance : élevée pour le code, moyenne pour le reste]

- État 250. Un invisible ne peut ni tacler ni être taclé, n'est pas ciblable par les sorts `needVisibleEntity`.
- Quand un personnage (non-monstre) invisible lance un sort qui **inflige des dommages immédiats** (ou une arme), il
  **redevient visible** ; un autre sort ne fait que **révéler sa position** ponctuellement
  (D3port:`DamageCalculator.DamageComputation` / `DispelInvisibility`). Être porté ou porter dissipe l'invisibilité
  (D3port:`Teleport.CarryFighter`).
- Pour l'IA ennemie : position connue = dernière position révélée (**INCERTAIN**, l'IA monstre officielle pourrait tricher).

## 15. Poussée, attirance, collisions, téléportations [Confiance : élevée]

(D3port:`PushUtils.cs` ; formule de dommages détaillée dans le dossier formules.)

- **Direction** : depuis la case ciblée (centre de la zone) vers la cible ; si la cible est sur la case ciblée, depuis le
  lanceur ; pour une poussée provoquée par une marque (piège, glyphe), depuis la case principale de la marque ; à travers
  un portail, depuis le portail de sortie (D3port:`PushUtils.Push/Pull/GetPushDirection`). Alignement diagonal ⇒
  direction diagonale (paire), sinon direction orthogonale (`GetLookDirection4`, égalité |dx|=|dy| impossible ici).
  Attirance = direction opposée.
- **Diagonale** : une poussée de *n* en diagonale déplace de `ceil(n/2)` cases ; un pas diagonal exige que les deux cases
  latérales soient libres.
- **Arrêt** : obstacle, case non marchable, combattant (collision), piège ou mur (pas de dommages de collision dans ce
  cas : `StopReason = ActiveObject`), portail (la poussée continue en sortie du portail avec la force restante).
- **Dommages de collision** (si force restante > 0 et arrêt ≠ piège/mur) :
  `max(0, floor(force × (floor(niveauLanceur/2) + 32 + Poussée_lanceur − Poussée_fixe_cible) / (4 × 2^k)))`, avec
  `k = 0` pour la cible et `k = 1, 2…` pour chaque combattant percuté derrière elle. La **même force** sert pour tous ;
  seul le diviseur `2^k` change. Correction lors de la vérification : la force n'est **pas** diminuée par combattant. Dans
  `GetCollateralTargets`, le compteur `force--` ne sert qu'à **limiter le nombre** de combattants percutés : on en touche
  au plus `force`, en chaîne contiguë dans la direction de la poussée. `ApplyCollisionDamageOnTarget` reçoit ensuite
  `collisionData.RemainingForce` inchangé pour chacun. Force restante = distance non parcourue (en pas diagonaux pour
  une poussée diagonale), puis ×2 si la direction est diagonale. Dommages nuls si le lanceur est *Pacifiste* ; niveau de
  l'invocateur pour une invocation ; réductions normales ensuite (voir formules) ; immunité via l'état-effet 26
  *InvulnerableToPush* ou *Invulnérable*. Pas de dommages pour une attirance qui bute.
  Ex. niveau 200, Poussée 0, cible sans résistance, poussée de 4 bloquée après 1 case (force 3) :
  cible `floor(3 × 132 / 4) = 99`, 1ᵉʳ percuté `floor(3 × 132 / 8) = 49`, 2ᵉ `floor(3 × 132 / 16) = 24`.
- **Immunités** : `CantBeMoved` (3) ou monstre `canBePushed=false` ⇒ pas de poussée ; `CantBePushed` (0) idem.
- **Téléportation / échange** : impossible si `CantBeMoved` ; échange (« teleswap », symétries, retour position de début
  de tour…) impossible si `CantSwitchPosition` (18) ; monstres : `canSwitchPos`, `canSwitchPosOnTarget`
  (D3port:`HaxeFighter.CanTeleport/CanSwitchPosition`). La case d'arrivée doit être libre et marchable.
- Toute arrivée sur une case (poussée, téléportation, lancer) déclenche les pièges et glyphes-aura de cette case ;
  le passage sur des cases « larges » dissipe les illusions (Steamer/Sram) (`GetCellsIdOnLargeWay`).

## 16. Porter / jeter (Pandawa) et portails (Eliotrope)

### Porter / jeter [Confiance : élevée]

- *Porter* : la cible (ni `CantBeMoved`, ni `CantBeCarried`, monstre `canBeCarried`) est placée sur la case du porteur ;
  états *Porteur* (3) sur le porteur et *Porté* (8) sur la cible, durée infinie ; invisibilités dissipées
  (D3port:`Teleport.CarryFighter`).
- Le porteur se déplace avec le porté ; le porteur ne peut lancer que les sorts exigeant *Porteur* (§12).
- *Jeter* : le porté est posé sur la case ciblée (déclenche les pièges/auras), les deux états sont retirés
  (`ThrowFighter`). Si le porteur est **poussé**, il lâche le porté sur sa case de départ.
- Correction lors de la vérification : D2:FightReachableCellsMaker ignore comme obstacle/tacleur l'entité **portée par
  le combattant qui se déplace** (`carryingCharacterId == moi`). Le **porteur** se déplace donc avec le porté sans être
  gêné par lui. Le code ne montre pas qu'un porté peut se libérer en marchant : « le porté quitte le porteur en se
  déplaçant » est **INCERTAIN**. Libérations attestées dans D3port : **téléporter le porté** le libère
  (`Teleport.TeleportFighter` : `HasState(8)` ⇒ `ReleaseFighter`), et une poussée du porteur le jette (`Drag` ⇒
  `ThrowFighter`). Mort du porteur : **INCERTAIN** (par défaut, poser le porté sur la case du porteur).
- **Ciblage d'un porté** : un combattant dans l'état *Porté* (8) est exclu des cibles des zones de sort, sauf pour les
  formes de zone `a`/`A` (D3port:`FightContext.GetFightersFromZone` : `!fighter.HasState(8) || shape == 'a'`). DofusDB
  expose aussi `zoneDescr.includeCarried` (sémantique exacte **INCERTAINE**).
- Un porteur ou un porté (état 3 chez l'un des deux) ne peut pas **échanger de place** (`HaxeFighter.CanSwitchPosition`).

### Portails [Confiance : élevée]

- Marques de type PORTAL d'une même équipe, actives (un portail traversé est désactivé jusqu'à… : `Use()`,
  `DisabledUntilThisFighterPlay` — **INCERTAIN** sur la durée exacte, en général jusqu'au prochain tour de l'Eliotrope).
- **Chaîne** : depuis le portail d'entrée, aller au portail le plus proche (distance Manhattan ; égalité départagée par
  l'angle), puis au plus proche non visité, etc. ; le **dernier** est la sortie (D2:LinkedCellsManager.getLinks,
  D3port:`PortalUtils`).
- **Ciblage à travers un portail** : on cible la case du portail d'entrée (portée/LdV jusqu'à lui) ; la vraie cible est
  `sortie + (entrée − lanceur)` (même vecteur, D2:FightSpellCastFrame.getTargetThroughPortal), avec LdV recalculée depuis
  le portail de sortie ; sorts avec l'effet « désactive les portails » ou `portalProjectionForbidden` non redirigés.
- **Bonus de dommages** : `bonus% = maxBonus + multiplicateur × Σ distances entre portails successifs de la chaîne`
  (`param3` / `param1` de l'effet de pose de portail, D3port:`FightContext.GetPortalBonus`).
- Un combattant qui entre dans un portail (marche, poussée) ressort par le portail de sortie si `canUsePortal` et pas
  `CantUsePortals` (17) ; lors d'une poussée pendant le **premier tour de jeu**, seuls les portails de sa propre équipe
  le transportent (D3port:`PushUtils.ApplyDrag` : `TeamId == fighter.TeamId || GameTurn != 1`). La poussée continue
  en sortie de portail avec la force restante.

## 17. Fin de combat, vagues et donjons de dimension

- **Fin** : quand tous les combattants d'une équipe sont morts (les invocations ne maintiennent pas l'équipe en vie ;
  **INCERTAIN** pour des cas spéciaux) ou ont abandonné. Résultats : `RESULT_LOST 0`, `DRAW 1`, `VICTORY 2`
  (D2 `FightOutcomeEnum`). Dans un combat à vagues, la victoire exige que **toutes les vagues** soient vaincues.
- **Vagues** (mécanisme générique serveur, message `GameFightNewWaveMessage(teamId, id, nbTurnBeforeNextWave)`,
  D2:FightBattleFrame) : des monstres supplémentaires apparaissent pour une équipe au bout d'un nombre de tours de jeu.
  Utilisé par l'Œil de Vortex et, depuis la 3.5 (mars 2026), par les combats à vagues des Songes
  ([guidactik — 3.5](https://guidactik.com/dofus/resume-de-la-mise-a-jour-3-5-de-dofus/)).
- **Œil de Vortex** (donjon de dimension Xélorium, une seule salle/combat) d'après
  [JOL](https://dofus.jeuxonline.info/article/13603/donjon-vortex),
  [dofuspourlesnoobs](https://www.dofuspourlesnoobs.com/) (DPLN, cache `.cache/vortex/guides/dppln.txt`) et
  [next-stage](https://www.next-stage.fr/2025/04/guide-dofus-strategies-vaincre-loeil-vortex-ses-succes.html) :
  5 vagues espacées de 5 tours. **Désaccord entre sources (précisé lors de la vérification)** : JOL (2016) écrit « La
  vague 2 arrivera donc au tour 6. La vague 3 au tour 11 » ; DPLN (2024) écrit « Vous avez un tour de plus pour la
  première vague (la deuxième vague arrive tour 7) ». Le moteur doit rendre ce délai paramétrable (défaut :
  DPLN, plus récent, cf. `docs/research/vortex.md`). Vague 1 = **Vortex + (N − 1) monstres**, vagues 2 à 5 = N monstres,
  avec N = nombre de personnages au début du combat. Apparition aux emplacements de départ de la vague 1 (JOL) ; les
  nouveaux arrivants sont invulnérables 1 tour. Règle générique des dimensions : si une vague est entièrement tuée avant
  l'échéance, la suivante arrive immédiatement. Dans le Vortex, cette règle est **INCERTAINE**, car les monstres tués
  ressuscitent et restent sur la carte jusqu'à leur « corruption ». Le détail (Auroraire, corruption, Heurage…) est
  dans le dossier Vortex.
- **INCERTAIN** : position des nouveaux arrivants dans la timeline. Proposition : les insérer dans l'équipe des défenseurs
  par initiative décroissante en conservant l'alternance pour les tours suivants.
- Les dimensions interdisent la téléportation hors combat (sans effet sur le moteur).

## 18. Caractéristiques de base et plafonds

- Personnage : **6 PA** (+1 au niveau 100 ⇒ 7), **3 PM**, 1 invocation, 0 PO bonus
  ([JOL — Les bases du combat](https://dofus.jeuxonline.info/article/1720/bases-combat), tofus.fr).
- **Plafond d'équipement** (devblog 2.3.4, [JOL](https://dofus.jeuxonline.info/actualite/30454/devblog-nouvelles-restrictions-pa-pm-po)) :
  un personnage ne peut cumuler plus de **12 PA, 6 PM et 9 de portée** via équipements et consommables (le surplus est
  ignoré, l'objet reste équipable) ; les bonus temporaires des sorts ne sont pas plafonnés ; au plus **1 PA, 1 PM, 1 PO
  via la forgemagie exotique**. Texte revérifié (devblog du 16/03/2011, mise à jour du 29/03/2011) : « fixer une
  limitation à 12 PA, 6 PM et 9 PO cumulables au maximum par personnage ». Pour PA et PM, ce sont des **totaux, base
  incluse** : 12 PA = 7 de base + 5 d'équipement au niveau ≥ 100, et 6 PM = 3 + 3. C'est l'usage de tous les outils de
  build (« 12/6 »). La PO de base étant 0, les 9 PO sont des bonus. **INCERTAIN** : validité inchangée en 3.x (aucune
  annonce contraire trouvée).
- Stats dérivées : Tacle/Fuite = Agilité/10 ; Retrait/Esquive PA-PM = Sagesse/10 ; Initiative = somme des 4
  caractéristiques élémentaires (+ bonus) ; Prospection = 100 + Chance/10 (hors combat).

## 19. Dofus 2 → Dofus 3

- Dofus 3 (Unity, décembre 2024) est un **portage** de Dofus 2.7x : mêmes cartes (560 cellules), mêmes données de
  sorts/états, même logique de calcul (le code Haxe partagé est conservé ; le portage C# BubbleBot en dérive).
- Champs de données qui changent : DofusDB expose `statesCriterion` (au lieu de `statesRequired/statesForbidden/
  statesAuthorized`), nouveaux types de marques (*Aura*), nouvelles caractéristiques (`dealtHealMultiplier`…).
- Mises à jour 3.x (3.1→3.5, 2025–2026) : surtout équilibrages de classes et contenu (élevage, Songes) ; aucune
  modification des règles de base (tacle, LdV, initiative, érosion) n'a été trouvée — **INCERTAIN** faute d'accès aux
  notes officielles complètes.
- Mécaniques historiques qui n'existent plus : échecs critiques (supprimés en 2.11), critique dépendant de l'Agilité (2.29), tacle
  aléatoire (remplacé par le tacle déterministe).

## 20. Résumé « à implémenter » (checklist moteur)

1. Géométrie + LdV + zones de portée (JSON ; diagonales comptées en pas diagonaux, cases marchables seulement) ;
   calque dynamique mov/los ; marques.
2. Timeline fixe alternée par initiative, invocations après l'invocateur, morts conservés.
3. Début de tour : décompte des effets du joueur actif → TB → glyphes → action ; fin : TE → reset PA/PM, compteurs.
4. Validation de lancer (§4.3) + relances (§4.4) + critique (§4.6).
5. Déplacement 4-connexe avec tacle par pas (§6), arrêt sur piège/invisible.
6. États (§12) via `effectsIds` + `statesCriterion` ; monstres via leurs drapeaux.
7. Poussées/collisions/téléportations/portage/portails (§15–16).
8. Érosion (base 10 %, max 50 %), résistances max 50 % joueurs.
9. Vagues (§17).

## 21. Questions ouvertes

Voir aussi les mentions INCERTAIN ci-dessus. Principales :
1. Position exacte des invocations et des monstres de vague dans la timeline en Dofus 3.
2. Ordre TB ↔ glyphes en début de tour ; instant exact des effets à retardement.
3. Formule exacte d'adaptation des invocations au niveau de l'invocateur (`characRatios`, `scaleGradeRef`).
4. Blocage de la LdV par un invisible côté serveur.
5. Base d'érosion (10 %) : confirmée par la communauté mais non lue dans le code.
6. Formule de retrait PA/PM : bornes 10–90 % et dénominateur (PA max avec buffs ?) à confirmer en Dofus 3.
7. Plafonds 12 PA / 6 PM / 9 PO toujours en vigueur en Dofus 3 (aucune annonce contraire trouvée).
8. Vortex : vague 2 au tour 6 (JOL 2016) ou 7 (DPLN 2024) ; arrivée anticipée d'une vague dans le Vortex.
9. Durées des buffs créés hors du tour de leur lanceur (`aliveSource`) : comportement serveur supposé identique au client.

## 22. Vérification (relecture contradictoire, 2026-10-04)

Méthode : la plupart des affirmations ont été recontrôlées sur les sources primaires : code client D2 en cache, portage
D3 BubbleBot, code JS DoMath, API DofusDB en direct et pages des guides. Le script de contrôle est indépendant de celui
de l'auteur.

**Vérifié sans changement**
- Géométrie : les 560 cellules, `cellId ↔ (x, y)`, `isInMap` et les formules Haxe `GetCellCoordById`/`GetCellIdByCoord`
  sont identiques à `MapPoint.init()`. Les offsets de cellId par parité de ligne sont vérifiés sur toutes les cellules.
  Les 10 exemples de cellules (coordonnées, voisins, diagonales, position écran), les 8 distances et les 8 lignes de vue
  du JSON ont été recalculés : tous exacts. Directions et `DirectionsEnum` ✓. `src/map/geometry.ts` utilise le même
  repère ✓.
- LdV : la règle de visibilité de `LosDetector` est correcte (cases intermédiaires = `los` + aucune entité, cible =
  `los`). Le DDA (D3port `GetCellsIdBetween`) est **confirmé indépendamment** : il donne les mêmes ensembles de cases
  que la décompilation Kohana du `_createCellsListForCells` Haxe (conditions corrigées) sur 313 040 paires (§3.1).
- Tacle : la formule `TackleUtil` (`(F+2)/(T+2)/2`, borne 1 par tacleur, produit), l'arrondi
  `int(x·(1−p)+0,5)` par pas (`FightTurnFrame.drawPath`) et le code DoMath (`−Math.round(−PA·p)` sur le reste =
  même résultat) sont vérifiés. Exemple Fuite 40 / Tacle 60 (+30) recalculé : 4 PM et 7 PA perdus avec un tacleur, 5 PM avec deux ✓. Seuils ✓. États 6, 8,
  95, 96 ✓.
- Validation de lancer (`canCastThisSpell`, ordre exact), relances (`SpellManager.cooldown`,
  `currentTurn = roundNumber − 1`, +1 en fin de tour), 63 = une fois par combat, `initialCooldown` ✓. `globalCooldown > 0`
  = 166 niveaux de sorts (API en direct) ✓. Tous les champs de `spell-levels` cités existent ✓.
- États : les 19 ids de la table §12, leurs `effectsIds` et leurs drapeaux ont été recontrôlés via l'API en direct ;
  l'énumération `StateEffectId` est conforme ✓. 6 375 états au total ✓. Ids de caractéristiques (26, 27, 28, 39, 44, 49,
  75, 78, 79, 82, 83, 93, 96, 105, 143) ✓.
- Drapeaux de cellule (v ≥ 9 et < 9), couleurs de placement (14492160 = 0xDD2200, 8925 = 0x0022DD),
  `TEAM_CHALLENGER = 0`, types de marques, `FightOutcomeEnum` ✓.
- Érosion : `min(érosion, 50)` et `min(·, PV−1)` dans `DamageReceiver.GetPermanentDamage` ✓. Résistances 50/100
  (`GetElementMainResist`, élémentaire + globale) ✓.
- Poussée : direction (`GetPushDirection`), `ceil(n/2)` en diagonale, cases latérales libres
  (`AdjacentCellsAllowAccess`), arrêt piège/mur sans dommages (`StopDrag`, `ActiveObject`), portails, force ×2 en
  diagonale, formule `floor(niv/2)+32+Poussée−Poussée_fixe` / `4·2^k`, attirance sans dommages ✓.
- Portage (états 3/8, durée −1000), lancer, chaîne de portails (`PortalUtils`, plus proche en Manhattan, égalité à
  l'angle), bonus de portail (`GetPortalBonus`), portails du 1er tour, invisibilité (`DispelInvisibility`), glyphes non
  déclenchées par poussée (`ExecuteMarks`) ✓.
- Critique : article JOL relu (formule additive, plafond 100 %, plancher 1 %, Agilité retirée) ✓.
- Plafonds 12 PA / 6 PM / 9 PO et 1/1/1 en exotique : devblog relu sur JOL ✓.
- `GameFightNewWaveMessage(teamId, id, nbTurnBeforeNextWave)` ✓. URLs citées : toutes répondent avec le bon titre.

**Corrigé**
1. §4.2 et JSON `rangeShapes` : la PO en **diagonale** compte des **pas diagonaux** (`Cross.as`), et non la distance de
   Manhattan. Seules les cases **marchables** sont ciblables. Une zone de forme `l` force le lancer en ligne. Le test
   « portée 63 = toute la carte » se fait avant le bonus de PO. Erreur importante : avec l'ancienne règle, les sorts
   « 8 directions » de PO 1 (Esprit Félin, Cabriole, Cri de l'Ours) ne pouvaient pas viser les cases diagonales.
2. §15 et JSON `pushGeometry` : les combattants percutés en chaîne reçoivent la **même force** (seul `2^k` change).
   La force ne sert qu'à limiter leur nombre, et non à diminuer de 1 par combattant. Exemple chiffré ajouté.
3. §9.1 : le décompte des durées se fait sur `aliveSource` = combattant **actif** à la création du buff, et pas
   forcément le lanceur (pièges, ripostes…).
4. §7 : les émulateurs Giny et Otomai ne sont **pas** identiques (Giny divise par les PA courants et a une borne PM
   spéciale). La forme Alterya (exemple 7/10) = Otomai est retenue.
5. §4.3 : les statistiques `statesCriterion` comptaient les critères **exactement égaux** (`HS!7` = 503). `HS!7`
   apparaît en réalité dans 624 niveaux (354 sorts), `HS=3` dans 42 niveaux. Précisé, ainsi que le fait que
   `preventsSpellCast` bloque aussi l'arme dans le client.
6. §4.6 : date de la 2.29 (annonce du 28/04/2015), suppression des échecs critiques en **2.11** (Millenium) et encodage
   client `55 − taux`. Exemple Féca remplacé par des valeurs revérifiées (0 ×33, 15 ×23, 10 ×5 sur 61 niveaux).
7. §16 : FightReachableCellsMaker ignore le **porté** quand le **porteur** bouge, et non l'inverse. La libération du
   porté par la marche est désormais INCERTAINE. Ajouts : un porté n'est pas ciblé par les zones (sauf `a`/`A`), et
   pas d'échange de place pour porteur ou porté.
8. §17 : Vortex — désaccord tour 6 (JOL) / tour 7 (DPLN 2024) signalé ; vague 1 = Vortex + (N−1) ; arrivée anticipée
   INCERTAINE dans le Vortex (résurrections).
9. §18 : les 12 PA / 6 PM sont des **totaux base incluse** (citation du devblog).
10. §8 : les grades DofusDB n'ont pas de champ initiative ; le facteur PV/PVmax relève de la communauté.
    §11 : `characRatios` existe aussi hors invocations (caractéristique 0 = PV).
    §11/§15 : remplacement du lanceur par l'invocateur pour bombes/tourelles nuancé (variable non réutilisée dans le
    portage).
11. §2.1 : les cartes DofusDB/Dofus 3 exposent `mov`/`los`… **déjà décodés** (sémantique positive). Ne pas réappliquer
    les masques de bits.
12. §4.4 : les compteurs par tour sont remis à zéro en **fin** de tour (`confirmTurnEnd` → `nextTurn`).

**Signalé hors périmètre (non modifié)** : `src/map/los.ts` teste les deux cases latérales lors d'un passage exact par
un coin. Il est donc plus restrictif que le client sur ≈ 28 % des paires de cases (§3.1). À aligner sur le DDA.
