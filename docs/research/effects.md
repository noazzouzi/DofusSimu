# Effets de sorts — sémantique pour le moteur de combat DofusSimu

> Objectif : permettre au moteur d'**interpréter fidèlement** les sorts tels que décrits par les données
> du jeu (DofusDB = fichiers du client Dofus 3 / Unity). Ce document explique le modèle de données d'un
> effet, l'ordre d'exécution d'un sort, les durées/délais/déclencheurs, la grammaire des zones et des
> masques de cible, puis le catalogue complet des **218 `effectId`** rencontrés.
>
> Fichiers machine associés :
> - [`data/research/effect-semantics.json`](../../data/research/effect-semantics.json) — une entrée par
>   `effectId` : `kind`, `subkind`, `element`, `params` (quel champ porte quoi), `notes`, `uncertain`,
>   `sources`, statistiques d'usage, exemples bruts réels.
> - [`data/research/zone-and-mask-grammar.json`](../../data/research/zone-and-mask-grammar.json) — formes de
>   zone, dégressivité, masques de cible, déclencheurs, `statesCriterion`, règles de durée.
> - Voir aussi [`data/research/map-geometry.json`](../../data/research/map-geometry.json) (géométrie de la grille,
>   produit par un autre volet), [`formulas.md`](formulas.md) (formules de dégâts DoMath),
>   [`mechanics.md`](mechanics.md), [`vortex.md`](vortex.md) et [`classes/`](classes/).
>
> Convention : tout ce qui n'est pas confirmé par du code client ou par une observation non ambiguë des
> données est marqué **INCERTAIN** avec la meilleure estimation.

---

## 0. Corpus et méthode

| Élément | Valeur |
|---|---|
| Source | `https://api.dofusdb.fr` (FeathersJS) — services `breeds`, `spell-variants`, `spells`, `spell-levels`, `effects`, `spell-states`, `monsters`, `characteristics` |
| Sorts de classe | 19 classes × 44 sorts = **836 sorts** (via `spell-variants?breedId=…`, 22 paires de variantes par classe) |
| Monstres Vortex | Ikargn 3834, Vortex 3835, Méjaire 3836, Harpille 3837, Buboxor 3838, Brabuzar 3839 (20 sorts) + leurs **sorts de départ** (`grades[].startingSpellId` = id de *spell-level* : Vortexiphan 5006, Glyphe téléporteur 5002) et l'**Auroraire 3833** (Heure du temps 4999) — 23 sorts racines |
| Récursion | Sous-sorts référencés par les effets « lance un sort » / glyphe / piège / rune (`diceNum` = id de sort) et sorts des invocations (`diceNum` des effets d'invocation = id de monstre ; `spells` **et** sort de départ de chaque invocation) — jusqu'à épuisement (≤ 12 niveaux) |
| Total | **1 838 sorts**, **3 987 spell-levels**, **218 effectId distincts** (181 dans les sorts de classe/Vortex directs, 37 de plus dans les sous-sorts/invocations). *Vérification 2026-10-04 : la 1re version (1 729 / 3 754 / 212) ignorait les sorts de départ (startingSpellId) — voir § 14.* |
| Cache brut | `.cache/effects/raw/*.json` (réponses API), `.cache/effects/corpus.json`, `effects_all.json` (872 effets), `states.json` (918 états référencés) |
| Scripts | `.cache/effects/fetch.py`, `crawl.py`, `states.py`, `semantics_table.py`, `build_semantics.py`, `build_grammar.py`, `build_catalogue_md.py` |

Sources de « vérité » pour la sémantique (par ordre de confiance) :

1. **Port C# du calculateur de dommages du client Dofus 3** (`Bubble.DamageCalculation`, dépôt
   [OtomAICLIP/otomai](https://github.com/OtomAICLIP/otomai), copie locale `.cache/domath/haxe/`) — cité
   **OTOMAI** : `ActionIdHelper.cs`, `SpellManager.cs` (masques), `TargetManagement.cs`, `HaxeBuff.cs`
   (déclencheurs), `SpellZone.cs` (zones), `DamageEffectHandler.cs`, `DamageSender.cs`, `DamageReceiver.cs`.
   C'est la même logique que l'outil **DoMath** (domath.fr).
2. **Client Dofus 2 décompilé** ([Romain-P/d2gen](https://github.com/Romain-P/d2gen)) — cité **D2CLIENT** :
   `DamageUtil.as` (`verifySpellEffectMask`, `verifyEffectTrigger`, `getShapeEfficiency`),
   `SpellZoneManager.as`, zones `Cross/Line/Lozenge/Cone/HalfLozenge/Square`, `BuffManager.as`,
   `BasicBuff.as`, `TriggeredBuff.as`, `FightBattleFrame.as`.
3. **Noms des actionId Dofus 3** : [PyDofus/pydofus3 `ActionId.py`](https://github.com/PyDofus/pydofus3) — cité **PYDOFUS3**.
4. **Observation des données** (descriptions de sorts + valeurs) — cité **DATA**.

---

## 1. Anatomie d'un effet DofusDB

Exemple réel : **Couperet** (Iop, sort 13115, grade 1) — « Occasionne des dommages Feu et retire des PM en zone ».

```json
{ "effectId": 99, "order": 0, "diceNum": 17, "diceSide": 19, "value": 0,
  "duration": 0, "delay": 0, "triggers": "I", "targetMask": "a,A",
  "random": 0, "group": 0, "dispellable": 1, "effectElement": 2, "effectTriggerDuration": 0,
  "zoneDescr": { "shape": 76, "param1": 3, "param2": 0,
                 "damageDecreaseStepPercent": 10, "maxDamageDecreaseApplyCount": 4, ... } }
{ "effectId": 1080, "order": 1, "diceNum": 2, "duration": 1, "dispellable": 3, "targetMask": "a,A", ... }
```

Lecture : 17 à 19 dommages Feu (99) dans une **ligne `L3`** (`shape` 76 = `'L'`, case d'impact + 3 cases
derrière), sur alliés et ennemis (`a,A`), dégressifs de 10 % par case (max 4 crans) ; puis −2 PM
**esquivables** (1080) pendant 1 tour, non dissipables sauf désenvoûtement fort (`dispellable` 3).

| Champ | Placeholder template | Sens |
|---|---|---|
| `effectId` | — | = `ActionId` du client (ex. 99 = `CharacterLifePointsLostFromFire`) |
| `diceNum` | `#1` | valeur min / quantité / id de sort lancé / id de monstre invoqué / id de sort modifié |
| `diceSide` | `#2` | valeur max (**0 ⇒ valeur fixe = `diceNum`**) / grade du sous-sort ou de l'invocation |
| `value` | `#3` | id d'état (950/951/952), id de sort (406), limite de déclenchements (lancements de sort), couleur RGB (marques), réduction fixe (265), soin % (786) |
| `duration` | — | durée du buff en tours (−1 = infini) ; 0 = instantané |
| `delay` | — | tours d'attente avant application (effet « au tour suivant ») |
| `effectTriggerDuration` | — | durée d'écoute d'un effet **déclenché** (`triggers` ≠ `I`), 63 = tout le combat |
| `triggers` | — | `I` (instantané) ou liste `A\|B\|C` de déclencheurs (§ 6) |
| `targetMask` | — | filtre des cibles (§ 5) |
| `zoneDescr` | — | zone d'application (§ 4) |
| `random` / `group` | — | poids aléatoire (%) / groupe aléatoire (§ 2.4) |
| `dispellable` | — | 1 dissipable, 2 seulement à la mort, 3 désenvoûtement fort uniquement, 4 jamais |
| `effectElement` | — | élément côté données (−1 aucun, 0 neutre, 1 terre, 2 feu, 3 eau, 4 air, 5 meilleur) |
| `order` | — | ordre d'exécution ; les `criticalEffect` ont leurs propres valeurs (déjà majorées) |

Templates : `#1{{~1~2 à }}#2 dommages Feu` ⇒ « 17 à 19 dommages Feu ». La description de l'effet
(`/effects/<id>`) donne aussi `characteristic` (id de stat modifiée, cf. `/characteristics`),
`category` (2 = dommages/soins ; 1 = résistances ; 3 = modificateur de sort) et `elementId`.

**Piège important (Dofus 3)** : le retrait de PA/PM **esquivable** des sorts est **1079 / 1080**
(`CharacterDeboost{Action,Movement}PointsDodgeable`) et **non** 101/127. Les ids 101 et 127
(`CharacterActionPointsLost` / `MovementPointsLost`) n'apparaissent dans **aucun** sort : ce sont les
action ids de *résultat* (messages de combat). 168/169 = retraits **non esquivables** (debuff fixe).
Les vols 77/84 passent par le même jet d'esquive (OTOMAI `StatBoostToDebuffActionId`).

---

## 2. Exécution d'un sort

### 2.1 Ordre général (OTOMAI `DamageCalculator.ExecuteSpell`)

1. Choix normal/critique : jet sur `criticalHitProbability` (+ bonus de critique) ⇒ liste `effects` ou
   `criticalEffect`. Les sous-sorts **héritent** du flag critique pour les effets de lancement de sort et
   les marques (`IsCriticalFlagInherited`).
2. **Ciblage préalable** : pour chaque effet, calcul de ses cibles (zone ∩ masque) **avant** d'exécuter
   quoi que ce soit. Exceptions recalculées au moment de l'effet : effets portant un jeton `U`, `u`, `T` ou
   `W` (entité apparue, téléfraguée, téléportée sur case invalide). OTOMAI teste aussi `V`/`v`, mais par égalité
   exacte de jeton (`Masks.Contains("V")`) : les jetons réels `V50`, `*v50`… ne provoquent donc **pas** de
   recalcul (**INCERTAIN** pour le jeu réel). Conséquence : un sort qui repousse puis frappe en zone
   frappe les entités qui étaient dans la zone **au moment du lancer**, même si un effet précédent les a
   déplacées ; la dégressivité utilise aussi leur position « avant le sort » (`BeforeLastSpellPosition`).
3. Si un masque `*…` (condition sur le **lanceur**) échoue, l'effet est **retiré** de la liste (pas de cible).
4. Exécution des effets dans l'ordre (`order`), avec la gestion aléatoire (§ 2.4).
5. Chaque résultat (dommage, déplacement, état, PA perdus…) est soumis aux **déclencheurs** des buffs des
   entités concernées (§ 6) ; les effets déclenchés s'exécutent récursivement (un buff ne se redéclenche pas
   sur un événement qu'il a lui-même provoqué — `IsTriggeredByParent`, sauf `canAlwaysTriggerSpells`).
6. Les marques (pièges, glyphes-aura, portails) des cases traversées/atteintes sont exécutées lors des
   déplacements (`ExecuteMarks`).

### 2.2 Effets instantanés vs buffs

- `triggers = "I"`, `duration = 0`, `delay = 0` : effet **instantané** (dommage, soin, poussée, invocation…).
- `triggers = "I"` et `duration ≠ 0` : **buff** de durée `duration` (stat, état, bouclier, modificateur…).
- `triggers ≠ "I"` : **buff déclencheur** posé sur chaque cible (le « porteur »), actif pendant
  `effectTriggerDuration` tours ; quand l'événement survient, l'effet est joué (sa propre `duration`
  s'applique à l'effet produit). Exemple **Petit poison** (Harpille) : `96` (50 Eau) `triggers TB`,
  `duration 0`, `effectTriggerDuration 3` ⇒ 50 dommages Eau au **début de chaque tour** de la cible pendant
  3 tours = un **poison**. Exemple **Neutralisation** (Brabuzar) : `1080` −3 PM, `triggers PD`,
  `duration 1`, `effectTriggerDuration 1` ⇒ pendant 1 tour, si la cible subit des dommages de poussée,
  elle perd 3 PM (esquivables) pour 1 tour.
- `delay = N` : l'effet est stocké et s'applique au début du N-ième prochain tour du lanceur
  (« au tour suivant »). Ex. **Fermentation** (Pandawa) : bouclier 1020 immédiat + même bouclier `delay 1`.

**Dégâts directs vs indirects** : un dommage est *direct* s'il provient d'un effet `I` du sort lancé ;
il est *indirect* s'il vient d'un buff déclenché (poison TB/TE, glyphe DG, piège DT, renvoi 1223).
Les règles de type « dommages directs » / « poisons » doivent utiliser ce critère.

### 2.3 Durées et dissipation (règle de décompte)

- Les `duration` et `delay` sont **décrémentés au début du tour de la source** du buff (`aliveSource` =
  lanceur ; pour un buff issu d'un déclenchement `D…`, l'entité déclencheuse). Source : D2CLIENT
  `FightBattleFrame` (`GameFightTurnStartMessage` ⇒ `BuffManager.decrementDuration(id)`) et
  `BuffManager.incrementDuration` (`INCREMENT_MODE_SOURCE` : `buff.aliveSource == id`).
  ⇒ Un debuff « 1 tour » posé par le joueur sur un monstre **couvre tout le tour du monstre** et expire au
  début du prochain tour du joueur.
- `duration -1` (stocké −1000) ou ≥ 63 : jamais décrémenté (jusqu'à dissipation/mort/retrait).
- OTOMAI ajoute +1 tour de `TurnDuration` (= `duration + delay`) à un buff `TB` posé pendant le tour de son
  lanceur. **Attention** : ce +1 compense le décompte propre au serveur OTOMAI (absent de la lib) ; il ne faut
  **pas** le cumuler avec la règle ci-dessus (décompte au début du tour de la source), sinon un poison `TB`
  se déclencherait une fois de trop. En Dofus 3, les poisons ont `duration 0` et `effectTriggerDuration N`
  (`TurnDuration` OTOMAI = 0 ⇒ pas de bonus) : Petit poison (3 tours) = 3 déclenchements.
- `dispellable` (FightDispellableEnum) : 1 = dissipable par désenvoûtement (1075 réduit la durée de
  N tours ; `406` retire tout un sort) ; 2 = retiré à la mort (et aussi par un désenvoûtement fort :
  `BasicBuff.canBeDispell` renvoie `dying || forceUndispellable`) ; 3 = seulement par un désenvoûtement fort ;
  4 = jamais. Observé : les retraits de PM (1080) des sorts de classe et de leurs sous-sorts sont à 87 % en
  `dispellable 3` (112/129 effets normaux).
- `maxStack` (spell-level) : nombre max de cumuls des effets du sort sur une même cible (−1 = illimité).

### 2.4 Effets aléatoires

`random` = poids (en %) ; `group` = id de groupe. Les effets aléatoires de même `group` (> 0) sont tirés
ensemble ; `group 0` ⇒ chaque effet aléatoire est son propre groupe. **Un seul groupe** est exécuté
(probabilité ∝ somme des poids). Les effets non aléatoires situés avant le dernier effet aléatoire sont
exécutés avant le tirage, les suivants après (OTOMAI `RandomGroup.cs`, `ExecuteSpell`).
Exemples : **Roulette** (Ecaflip) = 22 effets à 4,55 % (un seul s'applique) ; **Topkaj** = 3 groupes
de 2 effets (grade 1 : dommages Feu 7 / 10 / 13 aux ennemis + soin Feu de même valeur aux alliés), chaque
effet pesant 16,67 % ⇒ 33,3 % par groupe ; **Pile ou Face** = état Pile (5597) ou Face
(5598) à 50/50. Les effets 781/782 (minimiser/maximiser l'aléatoire) forcent les jets min/max.

### 2.5 Sous-sorts (effets « lance un sort »)

`diceNum` = id du sous-sort, `diceSide` = grade, `value` = nombre max de déclenchements du buff (999 =
illimité) ; pour les variantes « GlobalLimitation », `value` = nombre max d'exécutions **par lancer du sort
parent**, tous déclencheurs confondus. Qui lance et sur quoi (OTOMAI `SolveSpellExecution`) :

| effectId | Lanceur du sous-sort | Cible/case du sous-sort |
|---|---|---|
| 1160 `CasterExecuteSpell`, 2160 (limite globale) | lanceur de l'effet | la cible de l'effet |
| 2960 `CasterExecuteSpellOnCell` | lanceur | la **case** ciblée (pas besoin d'entité) |
| 792 `TargetExecuteSpell`, 793 (avec animation), 2792/2793 (limite globale) | **la cible** | la cible elle-même |
| 2794 `TargetExecuteSpellOnCell`, 2795 | la cible | la case ciblée par le sort parent |
| 1017 `TargetExecuteSpellOnSource`, 2017 | la cible | la **source** |
| 1018 `SourceExecuteSpellOnTarget` | la **source** | la cible |
| 1019 `SourceExecuteSpellOnSource` | la **source** | elle-même |

« Source » = l'entité **déclencheuse** si l'effet est joué par un buff déclenché (ex. l'attaquant pour un
déclencheur `D`/`DM`/`DBA` : *Main de Pandawa* `1017` + `DM` + masque `C` ⇒ le Pandawa lance le sous-sort
sur son agresseur au corps-à-corps), sinon le lanceur de l'effet (OTOMAI `SolveSpellExecution` :
`triggeringFighter = IsTriggered ? TriggeringFighter : caster`). La case visée par un sous-sort lancé sur une
entité est sa position « avant le sort » (`GetBeforeLastSpellPosition`).

Le sous-sort ne coûte pas de PA et n'est pas soumis à ses conditions de lancer (portée, LdV) ; ses
effets ont leurs propres zones, masques et déclencheurs. C'est le mécanisme central des sorts
« conditionnels » de Dofus 3 : beaucoup de sorts ne sont qu'une suite de `1160`/`792` filtrés par des
masques d'état (`*E498` = si le lanceur est Saoul, etc.).

---

## 3. Résumé des règles de calcul impactées par les effets

(Détails des formules : [`formulas.md`](formulas.md).)

- **Dommages élémentaires** (96–100, 2822, 2832) — ordre Dofus 3 (détail et arrondis :
  [`formulas.md` § 3.5](formulas.md)) : `jet ∈ [diceNum, diceSide]` `+ dégâts de base du sort (293)` →
  `× (100 + Puissance + carac de l'élément [+ puissance pièges/glyphes/runes])/100` → `+ Dommages fixes +
  Dommages de l'élément (+ Dommages critiques si CC)` → (bonus combo bombe 1027) → **× efficacité de zone ×
  bonus portail** → côté cible : `− résistance fixe (+ rés. critiques si CC)` → `− réduction d'armure (265)`
  → `× (1 − % résistance)` → multiplicateurs sorts/armes, mêlée/distance (2800/2804/2812), reçus
  (2802/2803/2806/2807), **dommages finaux** (1171/1172), puis **dommages subis ×N %** (1163) → bouclier puis PV.
  Neutre et Terre utilisent la Force, Feu l'Intelligence, Eau la Chance, Air l'Agilité.
- **Vol de vie** (91–95, 2828) : dommage normal, puis le lanceur est soigné de **50 %** des dommages
  réellement infligés (`LifeStealMultiplicator = 0.5`).
- **Dommages basés sur les PV** (89, 279, 275, 1118, 1122, 1092, 1096, 1048) : **non boostables** (ni
  stats ni dégâts fixes), mais réduits par les résistances (sauf 1048 qui ignore tout).
- **Érosion** : chaque dommage subi retire `floor(dommage × min(érosion %, 50)/100)` PV max ; érosion de base
  10 %, +776. Les PV érodés ne sont pas soignables.
- **Soins** (108, 2998–3000, 3002) : boostés par la carac de l'élément et Soins (178) — **pas** par la Puissance ; plafonnés aux PV max
  courants ; × soins finaux (2971). 1109 (% PV max) n'est pas boosté.
- **Boucliers** : 1020 = `round(niveau du lanceur × diceNum / 100)` ; 1039 = `diceNum %` des PV max du lanceur ;
  1040 = fixe. Ni dégressivité ni multiplicateurs.
- **Retraits esquivables** (1079/1080/77/84) : pour chaque point,
  `p = clamp((PA_restants − déjà_retirés)/PA_max × RetraitPA_lanceur / max(1, EsquivePA_cible) / 2, 0.10, 0.90)`
  (idem PM), un jet par point, arrêt quand tous les PA restants sont retirés. Source :
  `.cache/domath/other/otomai.FightActor.cs` (`RollApLose`/`RollMpLose`). Le serveur émulé Giny
  (`giny.Fighter.cs`) est **proche mais pas identique** : dénominateur = PA/PM *actuels* (`TotalInContext`)
  au lieu des PA/PM max, et un bug sur le plafond PM (`0.90 − 0.10 × value`). On retient OTOMAI.

---

## 4. Zones (`zoneDescr`)

### 4.1 Format

Dofus 3 stocke la zone **déjà parsée** : `shape` (code ASCII), `param1` (taille), `param2` (taille min ou
2e dimension), `damageDecreaseStepPercent` (défaut 10), `maxDamageDecreaseApplyCount` (défaut 4),
`isStopAtTarget`, `forcedDirection`, `includeCarried`, `onlyAffectIfInSightLine`, `cellIds`. Dofus 2
utilisait une chaîne `rawZone` (`"C2"`, `"X1,0,10,4"`, `"l1,63,0,0,1"`) : le premier caractère est la forme,
puis `p0` = taille ; pour les formes à taille minimale (`# + C Q R X l`) `p1` = taille min et `p2` = %
de dégressivité ; sinon `p1` = % et `p2` = nb de crans ; `p3` = crans max (et direction), `p4` = stopAtTarget ;
pour `l`, `p0`/`p1` sont inversés (OTOMAI `SpellZone.FromRawZone`).

Coordonnées : `row = floor(id/14)`, `col = id − 14·row`, `x = floor((row+1)/2) + col`,
`y = col − (row − floor((row+1)/2))` ; distance = Manhattan `|dx|+|dy|`. Directions impaires (1,3,5,7)
= axes de la grille (lancer en ligne) ; paires = diagonales de la grille (cf. `map-geometry.json`).

### 4.2 Formes observées (22 329 effets, `effects` + `criticalEffect`)

| Forme | Nom | Cellules | param1 / param2 | Nb | Exemple réel |
|---|---|---|---|---|---|
| `P` | Point | case d'impact | (1, ignoré) | 16 335 | quasi tous les mono-cibles |
| `C` | Cercle (losange en grille) | `min ≤ manhattan ≤ rayon` | rayon / rayon min | 1 908 | Cercle de feu (Ikargn) `C2,1` = anneau 1–2 ; `C63` = toute la carte |
| `X` | Croix (axes de la grille) | centre + 4 axes jusqu'à r | rayon / rayon min | 848 | Furie `X1` ; Aimantation `X6,1` |
| `a` | Toute la carte (vivants) | toutes les entités vivantes | — | 915 | Petit poison (Harpille) |
| `Q` | Croix sans centre | comme X, min ≥ 1 | rayon / min | 405 | Aversion `Q1` ; Rassemblement `Q2,2` = 4 cases à distance 2 |
| `A` | Toute la carte (morts inclus) | toutes les entités | — | 456 | résurrections, effets globaux |
| `G` | Carré | `max(\|dx\|,\|dy\|) ≤ r` (Chebyshev) | rayon | 285 | Bain de Sang `G1` (9 cases) |
| `l` | Ligne depuis le lanceur | distance `min…min+r−1` du lanceur, vers la case ciblée | rayon min / longueur | 166 | Fulgurance `l1,63`+stopAtTarget = cases entre lanceur et cible |
| `T` | Ligne perpendiculaire | centre + 2 directions ⟂ à lanceur→impact | rayon | 164 | Tannée `T2` |
| `V` | Cône | profondeur k = 0..r, 2k+1 cases | rayon | 158 | Tromblon `V1` |
| `L` | Ligne depuis l'impact | impact + r cases en s'éloignant du lanceur | rayon | 143 | Couperet `L3` |
| `+` | Croix diagonale | centre + 4 diagonales de la grille | rayon / min | 140 | Décimation `+1` |
| `U` | Demi-cercle / arc | impact + 2 diagonales par pas, branches vers le lanceur | rayon | 98 | Désolation `U1` |
| `O` | Anneau | manhattan = r exactement | rayon | 97 | Nervosité `O2` |
| `*` | Étoile | 8 directions (X ∪ +) | rayon | 79 | Prairie `*2` |
| `F` | Fourche (D3) | fourche orientée | rayon | 50 | Foène `F1` (géométrie **INCERTAINE**) |
| `#` | Croix diagonale sans centre | + avec min | rayon / min | 35 | Croisement `#2,2` |
| `-` | Perpendiculaire diagonale | T sur les diagonales | rayon | 12 | Espingole `-2` |
| `R` | Rectangle (D3) | rectangle orienté | **INCERTAIN** (largeur / longueur) | 10 | Épieu Sismique `R1,3` |
| `;` | Liste de cases | `zoneDescr.cellIds` explicite | — | 25 | Vortexiphan : invocation de l'Auroraire sur une case fixe ; Décalage horaire |

Non observées mais connues : `W` (carré sans diagonales), `I` (tout sauf un cercle), `D` (damier),
`B` (boomerang), `Z`, `/`. Drapeaux observés (effets normaux) : `includeCarried` (P, C, Q),
`isStopAtTarget` (87 × l), `onlyAffectIfInSightLine` (60 × C), `forcedDirection` (4 × L), `cellIds` rempli pour
`a`/`A` (toutes les cases) et `;` (liste fixe).

### 4.3 Dégressivité (efficacité de zone)

```
malus% = min( min(max(dist − rayonMin', 0), maxDamageDecreaseApplyCount) × damageDecreaseStepPercent , 100 )
efficacité = (100 − malus%) / 100          (rayonMin' = 0 pour R)
```

- `dist` est mesurée entre la **case d'impact** et la case de la cible (avant le sort), avec une métrique
  dépendant de la forme : Manhattan par défaut (C, X, Q, L, l, T, *, O) ; Chebyshev pour G/R/W ;
  Manhattan/2 (division entière) pour `#`, `+`, `-`, `/`, `U` ; distance directionnelle pour `V`/`F` ; 0 pour
  `A`, `a`, `I`, `;` (OTOMAI `SpellZone.GetAoeMalus`, D2CLIENT `getShapeEfficiency`).
- Pas de malus si rayon < 1 (point) ou rayon > 50 (`C63`…), ni pour les cibles ajoutées hors zone (`C`, `O`,
  `K`), ni pour les splash (1223/2020/2973) et les boucliers (`AllowAoeMalus`).
- `damageDecreaseStepPercent = 0` ⇒ zone **non dégressive** (« Les dommages de zone ne sont pas
  dégressifs » : Amarok, Folie Sanguinaire, Ydra…).
- Exemple Couperet `L3` (10 % × 4) : impact 100 %, puis 90 %, 80 %, 70 %.
- DoMath (calculateur simplifié, `.cache/domath/extract/domath-literal.cjs`) applique
  `1 − distanceZone × 0,10` pour un **sort** et `× 0,25` pour une **arme**, puis le bonus portail
  `1 + 0,02 × cases entre portails` : cohérent avec les valeurs par défaut des données (10 %, et `value` = 0,
  `diceNum` = 2 pour tous les 1181 du corpus). Le moteur doit lire `damageDecreaseStepPercent` /
  `maxDamageDecreaseApplyCount` de chaque effet (0 % pour les zones non dégressives).

---

## 5. Masques de cible (`targetMask`)

Liste de jetons séparés par `,`. Préfixe `*` = condition sur le **lanceur**. Un nombre suit certaines
lettres (id d'état, de monstre, de classe, % de PV).

**Algorithme** (OTOMAI `SpellManager.IsSelectedByMask` / `PassMaskExclusion`, D2CLIENT `verifySpellEffectMask`) :

1. Jetons `*…` : conditions sur le lanceur, toutes requises ; un échec **supprime l'effet**.
2. **Inclusion** : la cible doit correspondre à au moins une lettre d'inclusion. Le lanceur n'est inclus
   que via `c` (s'il est dans la zone), `C` (même hors zone) ou `a` (s'il est dans la zone) — jamais `g`.
3. **Conditions** : toutes vraies (ET), **sauf** les familles `B#`, `F#`, `Z#` qui forment des groupes OU
   (`F3112,F3113,F3114` = la cible est l'une de ces bombes).
4. Pas de masque ⇒ toutes les entités de la zone.

| Inclusion | Sens | | Condition | Sens |
|---|---|---|---|---|
| `a` | alliés (+ lanceur si dans la zone) | | `E#` / `e#` | a / n'a pas l'état # |
| `g` | alliés **sauf** lanceur | | `F#` / `f#` | est / n'est pas le monstre # |
| `A` | ennemis | | `B#` / `b#` | est / n'est pas un joueur de classe # |
| `c` | lanceur s'il est dans la zone | | `Z#` / `z#` | compagnon de type # |
| `C` | lanceur même hors zone | | `P` / `p` | « famille » du lanceur (lui, ses invocations, son invocateur…) / négation |
| `h` / `H` | joueurs non invoqués alliés / ennemis | | `K` | entité portée par le lanceur (Pandawa) |
| `l` / `L` | joueurs ou compagnons alliés / ennemis | | `O` (`o`) | entité **déclencheuse** (attaquant) — `o` : doit être dans la zone |
| `d` / `D` | compagnons alliés / ennemis | | `T` | téléfraguée ce tour (Xélor) |
| `m` / `M` | monstres non invoqués non statiques | | `W` | téléportée sur une case invalide ce tour |
| `i` / `I` | invocations non statiques | | `U` / `u` | vient d'apparaître (invocation du sort) / **INCERTAIN** négation |
| `j` / `J` | invocations (toutes) | | `V#` / `v#` | PV < #% / PV ≥ #% |
| `s` / `S` | invocations statiques | | `R` / `r` | sort lancé à travers un portail / non |
| `x` | **INCERTAIN** (case vide, invocations) | | `Q` / `q` | max d'invocations atteint / non atteint |
| | | | `PB` / `pb` | **INCERTAIN** : a / n'a pas de bouclier (Flèche d'Abolition) |
| | | | `PR` / `pr` | **INCERTAIN** (Disque de Sigel, Forgelance) |

Exemples décodés :
- `a,A` : tout le monde dans la zone (lanceur compris s'il y est).
- `g,A` : alliés et ennemis **sauf le lanceur** (« N'affecte pas le lanceur »).
- `A,E516` : un ennemi qui est la Proie (état 516, Ouginak).
- `C,*E3531` : sur le lanceur, seulement si le lanceur est Sobre (3531, Pandawa).
- `a,P,F3112,F3113,F3114,F5161` : une **bombe** du lanceur (OU entre les F).
- `g,*E221,f3835` (Vortex, Heurage) : alliés hors lanceur, sauf Vortex lui-même, si Vortex est en
  « Première heure » (221).
- `A,O` (Espace-temps) : l'attaquant (entité déclencheuse), ajouté même hors zone.
- `m,M,l,L` vs `L,M,l,m` : tout sauf les invocations (Accrocs du Roquet).
- `x,*q` : invoque si le lanceur n'a pas atteint son max d'invocations (Mot Alchimique).

---

## 6. Déclencheurs (`triggers`)

Liste séparée par `|` (OU). `I` = instantané (15 618 des 16 623 effets normaux). Comptes ci-dessous : effets normaux (hors `criticalEffect`). Tout autre code transforme l'effet en **buff déclencheur**
porté par la cible (cf. § 2.2). Codes **sans préfixe C** : événement **subi** par le porteur ; codes
**préfixés C** : événement **causé** par le porteur (OTOMAI `ShouldBeTriggeredOnCaster`).

| Code | Sens | Nb | Exemple |
|---|---|---|---|
| `TB` / `TE` | début / fin du tour du porteur | 175 / 219 | poisons (Arsenic, Petit poison), soins de fin de tour (Libation) |
| `D` | dommages subis (hors collision) | 196 | Rempart (265), Tirs optiques (1163 ×2) |
| `DA` `DE` `DF` `DW` `DN` | dommages subis de l'élément | 7 / 7 / 7 / 7 / 2 | Sublimation (Huppermage) |
| `DBA` / `DBE` | dommages subis d'un allié / d'un ennemi | 7 / 23 | Liens du Sang, Friction |
| `DM` / `DR` | dommages subis en mêlée (dist ≤ 1) / à distance | 48 / 13 | Couronne d'Épines (DM), Bouclier absorbant (DR) |
| `DS` / `DCAC` | dommages de sort / d'arme | 6 / 0 | Dispersion |
| `DG` / `DT` / `DI` | dommages de glyphe / piège / invocation | 0 / 8 / 1 | Concentration de Chakra (DT) |
| `DTB` / `DTE` / `DV` | dommages en début/fin de tour (poisons) / « DV » **INCERTAIN** | 8 / 8 / 7 | Ataraxie `D\|DTE\|DTB\|DV\|PD` = tout type de dommages |
| `PD` (`PMD`, `PPD`) | dommages de **poussée** subis | 30 | Décollage, Neutralisation (Brabuzar) |
| `P` / `MA` / `M` / `MS` / `TP` / `PT` | poussé / attiré / déplacé / transposé / téléporté / passe un portail | 4/8/14/11/14/6 | Superfidie (`M` ⇒ 406 retire le malus si la cible est déplacée) |
| `APA` / `MPA` / `R` | perd des PA / des PM (ou tentative) / de la portée | 2/5/2 | Férocité (`MPA\|M\|TP`) |
| `H` / `V` `VA` `VM` `VE` / `LPU` / `S` | soigné / PV modifiés / maj PV / bouclier touché | 53 / 2 / 2 / 0 | Hémorragie (1159 soins reçus ×70 %) |
| `X` | mort du porteur | 56 | Proie (Ouginak), Poudre (bombe) |
| `K` (`KWW`, `KWS`) | le porteur tue | 4 | Tarot d'Ecaflip |
| `DIS` | le porteur est désenvoûté | 12 | Barricade, Bastion |
| `EON#` / `EOFF#` | le porteur gagne / perd l'état # | 54 / 58 | Laisse Spirituelle (`EOFF8`), Transfiguration (`EON98`) |
| `CC` | le porteur fait un coup critique | 7 | Bonne Étoile, Destin d'Ecaflip |
| `CI` / `CH` / `CS` | le porteur invoque / soigne / donne un bouclier | 5/2/2 | Faille, Tarot |
| `CD`, `CDE`… `CDBE`, `CDM`… | le porteur inflige des dommages (élément, allié/ennemi, mêlée/distance…) | 4 (CDE/CDF/CDW/CDA) | Tarot |
| `CAPA` / `CMPA` / `CAPAS` / `CMPAS` | le porteur tente / réussit un retrait de PA/PM | 0/0/1/4 | Ronces Agressives (CMPAS) |
| `CPD` / `PO` / `CPT` | le porteur cause des dommages de poussée / déplace une entité / une entité traverse un portail | 1/1/5 | Toupet (`PO\|CPD`), Entraide |
| `CCMPARR` | **pour chaque PM utilisé** par le porteur (effet empilé par PM) | 13 | Agitation (+20 Puissance/PM), Mot Malicieux (−30 Puissance/PM), Rémanence (retour arrière/PM), Tourbière, Sentinelle |
| `CMPARR` | pour chaque PM utilisé par le **lanceur** du buff — **INCERTAIN** | 8 | Laisse Spirituelle (la cible suit l'Osamodas) |
| `CT` | le porteur **tacle** un ennemi — probable (absent d'OTOMAI/D2CLIENT) | 1 | Grimace (Masque Grimaçant, Zobal) : « lorsqu'un ennemi se fait tacler par le Masque, lui et son invocateur gagnent du bouclier » |
| `X<code>` | même déclencheur, valable aussi si l'événement **tue** le porteur | 76 (XD 50, XPD 8, XDM 7, XDS 6, XDTB 2, XDBA 2, XDR 1) — **INCERTAIN** (absent d'OTOMAI) | toujours en paire `D\|XD`, `PD\|XPD`, `DM\|XDM` |

Le tableau complet (avec exemples) est dans `zone-and-mask-grammar.json#/triggers`.

**Conditions de lancer** (`statesCriterion` du spell-level, état du **lanceur**) :
`HS=x` (possède l'état x), `HS!x` (ne possède pas), `&`, `|`, parenthèses. Ex. Vortex
**Heuristique** `HS!236` (interdit en état Marginal), **Contamination zombie** `HS=236`.

---

## 7. Familles d'effets (prose) — le catalogue exhaustif est en § 11

### 7.1 Dommages et vols de vie
- 96 Eau, 97 Terre, 98 Air, 99 Feu, 100 Neutre, 2822 meilleur élément, 2832 pire élément ; vols 91 Eau,
  92 Terre, 93 Air, 94 Feu, 95 Neutre, 2828 meilleur élément. `diceNum..diceSide`.
- Basés sur les PV (non boostables) : 89 (% PV actuels du lanceur), 279/275 (% PV manquants du lanceur,
  Neutre/Eau), 1118/1122 (% PV érodés du lanceur, Neutre/Terre), 1092/1096 (% PV érodés de la cible,
  Neutre/Terre), 1048 (perte de % PV actuels, sacrifice — ignore résistances). 1013/1016 sont, eux,
  **boostés** normalement puis multipliés par `PM_restants / (PM_restants + PM_utilisés_ce_tour)` du lanceur
  (0 PM ⇒ 0 dégât ; OTOMAI `DamageSender.GetTotalDamage`).
- Renvois : 1223 (`diceNum`% des dommages finaux subis par le porteur renvoyés aux entités de la zone,
  dans le même élément) ; 1123 (idem sur les dommages **initiaux**, avant réductions — Auroraire) ; 2020 (soin de % des dommages subis) ; 2973 (soin de % des dommages occasionnés) ;
  786 (les attaquants du porteur sont soignés de `value` % des dommages).

### 7.2 Soins et boucliers
108 Feu, 2998 Eau, 2999 Air, 3000 Terre, 3002 meilleur élément ; 1109 = % PV max (non boosté) ;
90 = transfert de % des PV du lanceur vers la cible. Boucliers 1020 (% niveau du lanceur), 1039
(% PV max du lanceur), 1040 (fixe).

### 7.3 PA / PM
1079/1080 retrait **esquivable** (le standard), 168/169 retrait **non esquivable**, 77/84 vol (esquivable,
le lanceur gagne ce qui a été retiré), 111/128 gain (buff), 120 « rembourse » des PA immédiatement (sans buff).
169 avec `diceNum 100` = immobilisation (Duel, Emprise, Retraite Anticipée). Stats associées :
410–413 (Retrait PA/PM), 160–163 (Esquive PA/PM).

### 7.4 Caractéristiques (buffs/debuffs, `characteristic` = id de stat)
Force 118/157, Agilité 119/154, Chance 123/152, Intelligence 126/155, Vitalité 125, Puissance 138/186,
Dommages 112/145, % Critique 115/171, Portée 117/116, Soins 178, Invocations 182, Fuite 752/754, Tacle
753/755, Dommages Poussée 414, Résistance Poussée 416/417, Dommages Critiques 418/419, Résistance
Critiques 420/421, % Résistance élément 210–213 / 215–219, % Résistance globale 1076, Érosion 776,
Vitalité % 1078/1033 (statique, base hors contexte) et 2844, Dommages finaux 1171/1172, Dommages mêlée
2800, distance 2804/2805, sorts 2812, dommages **reçus** mêlée 2802/2803 et distance 2806/2807 (affichés
« ± % Résistance mêlée/distance »), Soins finaux 2971/2972, bonus combo des bombes 1027. Vols de stats :
266 Chance, 268 Agilité, 269 Intelligence, 271 Force, 320 Portée (−X cible, +X lanceur).

### 7.5 Modificateurs de dégâts/soins reçus
265 réduction fixe `value × (1 + niveau/20)` par coup (armure, ex. Rempart value 12 ⇒ 132 au niveau 200 ;
niveau du porteur selon OTOMAI, **INCERTAIN**) ; 1163 multiplie les dommages reçus (`diceNum`%) ; 1159
multiplie les soins reçus ; 765 interception (Sacrifice, Sac Animé) ; 1061 partage des dommages (Musette,
Harmonie) ; 781/782 minimise/maximise l'aléatoire.

### 7.6 Déplacements
5 poussée (dommages de collision possibles ; « depuis le centre » si zone), 1103 poussée sans dommages,
6 attirance (« vers le centre » si zone), 1041/1042 le **lanceur** recule/avance, 783/1043 pousse/attire
jusqu'à la case ciblée, 8 échange (bloqué par Pesanteur 7, Enraciné 6…), 1023 échange forcé, 4 téléport du
lanceur, 1101 téléport ou échange, 1104 symétrie du lanceur par rapport à la cible, 1105 symétrie de la
cible par rapport au lanceur, 1106 symétrie des cibles par rapport à l'impact, 1099 retour à la position
de début de tour, 1100 retour à la position précédente, 784 retour à la case de **début de combat** (Vortex,
*Action !*), 50/51 porter/jeter, 2184 suivre le lanceur.
**Téléfrag** (Xélor) : une téléportation sur une case occupée par une entité échangeable provoque un
échange et pose l'état Téléfrag (244/251) — consommé par les sorts via le masque `T` et `2160`.

### 7.7 États
950 pose l'état `value` (durée `duration`), 951 le retire, 952 le désactive temporairement. Les
propriétés de gameplay sont dans `spell-states` : `preventsSpellCast`, `preventsFight`, `cantBeMoved`
(Indéplaçable 97), `cantBePushed` (Enraciné 6, Inébranlable 157, Feuillu 256), `cantSwitchPosition`
(Pesanteur 7, Enraciné 6), `cantDealDamage` (Pacifiste 218), `invulnerable`, `invulnerableMelee/Range`,
`incurable` (Insoignable 76), `cantTackle`, `cantBeTackled` (Intaclable 96), `isSilent` (marqueurs
techniques). États clés : 3 Porteur, 8 Porté, 250 Invisible, 244/251 Téléfrag, 263 Infecté (Sadida),
290–293 Feu/Eau/Terre/Air (Huppermage), 296 Rune, 498 Saoul / 3531 Sobre (Pandawa), 513–515 Rage, 516 Proie
(Ouginak), 616–625 Souffrance 1–10 et 5380 Souffrance 6+ (Sacrieur), 5597/5598 Pile/Face (Ecaflip),
98/99/100 Intrépide/Psychopathe/Pleutre (Zobal), 3737 Portail (Eliotrope).

### 7.8 Invocations
181 invocation (monstre `diceNum`, grade `diceSide` ; `value` **INCERTAIN** : nombre d'invocations
multiples dans la zone — Bambouseraie 12, Pavois 3/4) ; 1011 invocation **contrôlable** (jouée par le
joueur) ; 180 double du lanceur ; 1008 bombe (slot de bombe) ; 405/2796 tue et remplace (souvent avec
`delay`, ex. Poupée Sadida ⇒ Arbre après 3 tours) ; 1097 illusions ; 141 tue (avec `delay` : mort
programmée d'une invocation) ; 2027 prise de contrôle ; 2188 change l'IA ; 1009 explosion d'une bombe ;
1031 fin du tour ; 140 **tour annulé** (la cible passe son tour tant que le buff dure) ; 780 **résurrection**
du dernier allié mort avec `diceNum`–`diceSide` % de ses PV (Vortexiphan : 20–30 % ; OTOMAI met 50 %,
**INCERTAIN**).

### 7.9 Marques
400 piège (invisible pour l'ennemi, stoppe le déplacement, lance `diceNum` au centre du piège puis
disparaît), 401 glyphe de début de tour, 402 glyphe de fin de tour, 1165 glyphe immédiat (**INCERTAIN** :
déclenché à la pose/à l'entrée), 1091 glyphe-aura (effets tant qu'on est dedans, peut suivre une entité),
2022 rune Huppermage (inerte jusqu'au déclenchement 2023), 1026 déclenche les glyphes du sort `value`,
2018 dissipe les glyphes, 1181 portail (`+value` % de base, `+diceNum` % par case entre portails),
1182 utilise/active un portail, 1183 désactive un portail. Paramètres communs : `diceNum` = sort lancé,
`diceSide` = grade, `value` = couleur, `duration` = durée en tours du lanceur, zone = forme de la marque.

### 7.10 Modificateurs de sorts et relance (category 3)
Portée min/max 280/281 (+), 2905/2906 (fixée), coût PA 285 (−)/296 (+), critique 287, ligne de vue 289,
lancers par tour/cible 290/291, dégâts de base 293, soins de base 2935, case libre/occupée 297/299/314,
cible visible 798, portée min −`value` 295 ; `diceNum` = sort modifié (0 = ensemble de sorts du lanceur, ex. Tirs Éloignés),
`value` = valeur. Relance : 1036 réduit, 1045 fixe le temps de relance du sort `diceNum` à `value`.

### 7.11 Dissipation
1075 réduit de `diceNum` tours la durée des effets dissipables de la cible (Vortex : −2) ; 406 retire tous
les effets du sort `value` (sert aussi à l'auto-consommation : déclencheur `D` + `value` = propre sort) ;
1406 retire les effets d'un rang du sort.

### 7.12 Visuels / neutres
149, 333, 335, 1060, 2868 (apparence, couleur, taille) ; 3792/3793 exécutent un *script visuel*
(`value` = id dans `spell.boundScriptUsageData`) — **aucun effet de gameplay** (vérifié sur Fermentation :
le bouclier du tour suivant est un 1020 distinct) ; 666 « Pas d'effet supplémentaire ». Le moteur peut les
ignorer (le replay peut s'en servir comme indices d'animation).

---

## 8. Mécaniques de classe : comment elles sont encodées

| Classe | Mécanique | Encodage (données) |
|---|---|---|
| Pandawa | Porter / jeter, Saoul / Sobre | 50 (masque `*e3`), 51 + effets sur `K` ; états 3/8 ; 498/3531 conditionnent via `*E498`/`*E3531` ; Karcham 3583 et sous-sorts 25507/25508 (2960) |
| Xélor | Téléfrag, retours dans le temps | 1100/1099/1104/1105/1106 ; 2160 → sous-sort (limite 1) sur masque `T` ; états 244/251/353–360 ; complice/cadran 1011, 1045 fixe leur relance |
| Eliotrope | Portails | 1181 (+2 %/case), 1171/2971 (+2 % finaux, cumul), masques `R/r`, déclencheurs `PT`/`CPT`, état 3737 |
| Huppermage | États élémentaires, runes, combinaisons | 950 états 290–293 posés par les sorts élémentaires ; 2022 rune (2 tours, état 296) ; 2023 déclenche ; deux états différents ⇒ sous-sorts de combinaison (13671 : Ébullition, Carbonisation, Enlisement, Assèchement) |
| Ouginak | Proie, Rage | état 516 (masques `A,E516`), rage 513/514/515 via sous-sorts et `statesCriterion` (« nécessite et diminue la Rage ») |
| Steamer | Tourelles | invocations 5831–5837 (`F583x`), évolutions (sous-sorts 13832, états « Évolution », 149 apparence), échanges forcés 1023 |
| Roublard | Bombes, combo, murs | 1008 (bombes 3112/3113/3114/5161…), 1027 combo, 1009 explosion en chaîne, 1011 Roublabot/Mégabombe |
| Sram | Pièges, invisibilité, double | 400 ; 150 + 202 ; 180 + 141 `delay 2` ; déclencheur `DT` |
| Sadida | Poupées, arbres, infection | 181/405 (`delay 3`), 2796, état Infecté 263 (`E263` ⇒ effets propagés à tous les infectés), Feuillu 256 |
| Sacrieur | Souffrance, sacrifice | états 616–625 / 5380 ; 765, 90, 1048 ; Berserk 1803 |
| Ecaflip | Cartes, aléatoire | `random`/`group`, états de cartes (5452…), Pile/Face 5597/5598, 781/782 |
| Zobal | Masques | états 98/99/100, sous-sorts conditionnés `*E98`… |
| Féca | Glyphes, armures | 401/402/1091/1165, 1026/2018, 265 (Rempart), états d'armure 5262–5265 |
| Osamodas | Invocations, laisse | 181, 2184 + `CMPARR`, 1061 |
| Forgelance | Lance | monstre 7139 (`F7139`), modificateurs 289/299/314/2905/2906 (états Armé/Désarmé) |
| Crâ | Balises, flèches | modificateurs globaux 280/281 (`diceNum` 0), balises invoquées, `PB/pb` |
| Enutrof | Sac/Musette, PM | 765 / 1061, nombreux 1080 |
| Eniripsa | Mots, Moqueries, Fées | états de moquerie, 402 (Fontaine), invocations Lapino/Feux follets |
| Iop | Renvois, buffs | 1223 (Massacre), boucliers 1020, 1013 (Zénith) |

---

## 9. Les sorts des monstres de l'Œil de Vortex, décodés

(grade 1 des données ; PA, portée, relance issus du spell-level ; « esq. » = esquivable.)

**Ikargn (3834)**
- *Attraction ailée* (5015) — 4 PA, sur soi, relance 3 (initiale 1). Zone **C3,1** autour de lui, ennemis :
  attire de 3, −3 PM esq. (1 t), état Pesanteur (1 t), **vole 100 Agilité** (2 t) ; au tour suivant
  (`delay 1`) il lance 5014 : **80 dommages Air fixes** en C3,1, puis pour chaque joueur (`L`) touché il lance 5013 dont l'effet (169 −10 PM non esq., 1 t, masque `C`) s'applique à **lui-même** : il s'immobilise (**INCERTAIN** : interprétation du masque `C` dans un sous-sort).
- *Cercle de feu* (5016) — 4 PA, sur soi, relance 1. C2,1 : vol 100 Intelligence (2 t) + 61–80 Feu.
- *Terre mythe* (5017) — 4 PA, mêlée, 2/tour (1/cible) : vol 100 Force (1 t), −3 PA esq., 51–70 Terre.

**Vortex (3835, boss)**
- *Heuristique* (5068) — 4 PA, PO 1–8 en ligne sans LdV, 3/tour, 1/cible, interdit si Marginal (`HS!236`) :
  **désenvoûtement −2 tours**, état **Pacifiste** 1 t (ne peut plus infliger de dommages), 41–50 Air + 41–50 Feu.
- *Morfaille* (5070) — 4 PA, PO 1–4 LdV, 3/tour, 1/cible, interdit si Marginal (`HS!236`, comme
  Heuristique) : renvoie la cible à sa **position précédente** (1100), puis
  lance 5069 sur elle maintenant **et au tour suivant** (`delay 1`, présent aussi dans `criticalEffect`) :
  41–50 Neutre + 41–50 Eau en anneau C2,1 autour de la cible (**pas** la cible elle-même) + 20 % des
  **PV érodés de Vortex** en Terre (C2, cible incluse).
- *En temps et en heure* (5062) — 1 PA, PO 1–63, 1/tour (relance initiale 1) : si la cible est un
  **Auroraire** (3833), celui-ci lance 5061 : en **croix infinie sans centre (X63,1)** : +20 % érosion
  (2 t), **500 dommages Terre fixes**, + 50 % des PV érodés de la cible ; +10 PA (instantané) à une cible
  téléfraguée (`T`).
- *Heurage* (5066) — 4 PA, sur soi, relance 3 (initiale 3) : si Vortex est **Marginal** (`*E236`), les
  Auroraires lancent 5065 : buffs permanents aux alliés (hors Vortex) selon l'**heure** courante (états
  221 « Première heure » … 232 : +10 % CC & +200 dommages critiques, Intaclable, +400 Intelligence, +2 PM,
  dommages subis ×70 %, +400 Chance, +150 rés. critiques, +4 PA, +400 Force, Inébranlable, +30 % Vitalité,
  +400 Agilité) ; sinon Vortex lance 5067 (téléportation, `diceNum` 10, **INCERTAIN**).
- *Contamination zombie* (5064) — seulement si Marginal (`HS=236`), PO 1–63 LdV, 2/tour, 1/cible : sur un
  **allié** en état Zombi (74, masque `a,E74` ; aucun sort du corpus ne pose cet état — origine **INCERTAINE**), Vortex lance 5063 centré sur lui : état **Insoignable**
  (1 t) aux **ennemis** (`A`) à 1–2 cases (C2,1).

**Méjaire (3836)**
- *Rayonirique* (5022) — PO 1–3 en ligne : 31–40 Eau + Pacifiste (1 t).
- *Plumière* (5023) — PO 3–7 en ligne : 31–40 Terre + **dommages subis ×150 %** pendant 1 tour (trigger D,
  pas d'auto-dissipation ⇒ tous les coups pendant 1 tour).
- *Envolupté* (5024) — PO 8–10, case occupée, relance 3 : échange de position avec un allié puis repousse
  de 2 les ennemis en C2,1.

**Harpille (3837)**
- *Tirs optiques* (5018) — PO 1–5 : 31–40 Neutre + le **prochain** coup subi par la cible fait ×200 %
  (1163 `D` + 406 `D` auto-dissipation).
- *Superfidie* (5019) — PO 1–7 en ligne, 1/tour : 31–40 Feu, −4 PM esq. (1 t) ; si la cible est **déplacée**
  (`M`), les effets du sort sont retirés (elle récupère ses PM).
- *Petit poison* (5021) — sur soi, zone **toute la carte**, cibles `L` (tous les joueurs/compagnons
  ennemis), relance 3 : **poison 50 Eau** au début de leur tour pendant 3 tours ; chaque cible reçoit aussi un buff `H` (3 tours,
  sous-sort 5020) : si elle est **soignée**, elle lance 5020 grade 2 = `406` retirant les effets de *Petit poison*
  ⇒ **un soin purge le poison** (sauf le soin d'un vol de vie, qui ne déclenche pas `H` — OTOMAI `HaxeBuff`).

**Buboxor (3838)**
- *Bouclier absorbant* (5026) — sur soi, relance 3, cumul 3 : chaque coup **à distance** reçu (DR) lui donne
  +100 Puissance et +1 PM pendant 2 tours ⇒ **le frapper au corps-à-corps** ou le désenvoûter.
- *Feinterception* (5027) — mêlée : vol de vie Air 51–70 + les attaquants de la cible sont soignés de 50 %.
- *Hoxor* (5028) — PO 1–3 en ligne : vol de 2 PM (1 t) + 41–60 Eau.

**Brabuzar (3839)**
- *Mise en situation* (5030) — PO 1–3 en ligne : la cible lance 5029 (attire de 3 ses alliés en étoile `*3`),
  Brabuzar +200 Dommages Poussée (2 t), repousse la cible de 4.
- *Décollage* (5032) — sur soi, relance 3, zone toute la carte : −300 **Résistance Poussée** à tous les
  ennemis (1 t) ; pendant 1 tour, chaque **dommage de poussée** subi par un ennemi soigne le Brabuzar de
  15 % de ses PV max (sous-sort 5031, `value` 100 déclenchements max).
- *Neutralisation* (5033) — PO 1–3 en ligne, cumul 3 : téléporte la cible symétriquement par rapport au
  Brabuzar, 56–75 Neutre ; si elle subit des dommages de poussée dans le tour : −3 PM esq. (1 t).

**Mécanique du donjon (sorts de départ `startingSpellId`, ajoutés lors de la vérification ; détail complet :
[`vortex.md` § 8](vortex.md))**
- *Vortexiphan* (5006, sort de départ du Vortex, grade 1) : invoque l'**Auroraire** 3833 (181, zone `;` =
  case fixe) ; Vortex **Invulnérable** (56), **Indéplaçable** (97), −100 PM non esquivables (169) permanents
  et **Marginal** (236) 25 tours. Buffs `TB` (63 tours) : à chaque début de tour du Vortex, 5003 ressuscite les
  monstres de vague morts (780, 20–30 % PV, masque `h,m,d`) et leur relance *Glyphe téléporteur* ; après
  `delay 25`, 5008 (Marginal 1 tour de plus tant qu'un monstre non « corrompu » `e6611` vit) et *Action !*
  (5060). Les grades 2/3 propagent le sort aux alliés hors famille (masque `e945`, déclencheur `CI`).
- *Action !* (5060, seulement si le Vortex n'est plus Marginal `*e236`) : Vortex et personnages renvoyés à
  leur case de **début de combat** (784), retrait de Vortexiphan (406 `value` 5006), transfert au Vortex des
  bonus d'heures des monstres (5009), mort de tous les alliés sauf l'Auroraire (141, `g,f3833`), Vortex
  Invulnérable + **tour annulé** (140) 1 tour ; si le Vortex possède les 12 états d'heure (221–232, 12 jetons
  `*E` en ET), les personnages subissent ×75 % de dommages pour le reste du combat (1163, `D`, 63 tours).
- *Heure du temps* (4999, sort de départ de l'Auroraire) : Invulnérable + Indéplaçable, état Douzième heure ;
  buff `TB` sur chaque personnage (`L`) ⇒ à chaque début de tour d'un personnage, l'Auroraire lance
  *Décalage horaire* (4996) : l'heure avance (états 221→232 sur l'Auroraire), état **Même heure** (234) posé
  sur les monstres portant l'état de l'heure atteinte, déplacement de l'Auroraire (1023/4, zone `;`). Si
  l'Auroraire subit des dommages (`D` ⇒ 4998) : symétrie de l'attaquant (1105), renvoi de 100 % des dommages
  **initiaux** (1123) aux alliés téléfragués (`a,T`) — interprétation **INCERTAINE** (elle est invulnérable).
- *Glyphe téléporteur* (5002, sort de départ de chaque monstre de vague) : `X` (mort) ⇒ marquage par
  l'Auroraire (5001/5000) ; `TB` ⇒ glyphe sous le monstre (5012/5011) ; en état Même heure : **tour annulé**
  permanent + Invulnérable + état 6611 (« corrompu ») ; bonus permanents selon les heures enregistrées (même
  table que *Heurage*).

Implications IA/équipe : Vortex et la Harpille punissent les cibles désenvoûtables/déplacées ; le Buboxor
s'abat au corps-à-corps ; contre le Brabuzar, éviter les poussées sur les alliés (soin + retraits de PM) ;
les « heures » de Vortex se jouent sur l'état Marginal (236) et les Auroraires (3833).

---

## 10. Règles d'implémentation recommandées (moteur)

1. **Pré-calculer les cibles** de chaque effet avant exécution (sauf masques U/u/T/W/V/v) ; appliquer
   les conditions `*` sur le lanceur en premier.
2. Représenter un effet non instantané comme un **Buff** `{effect, caster, aliveSource, target, duration,
   delay, triggers, triggerDuration, triggerCount, dispellable, spellId}` ; décrémenter `duration`/`delay`
   au **début du tour de `aliveSource`**.
3. Moteur d'événements : chaque résolution produit des événements typés (`damage{element, melee, source,
   isCritical, isCollision, isTrap, isGlyph, isWeapon}`, `heal`, `push`, `pull`, `teleport`, `swap`,
   `apLoss`, `mpLoss`, `rangeLoss`, `stateOn/Off`, `death`, `kill`, `turnStart`, `turnEnd`, `mpUsed`,
   `dispel`, `portal`…) que l'on confronte aux codes de déclencheurs (§ 6).
4. Limites de déclenchement : `value` des lancements de sort ; pas d'auto-déclenchement récursif.
5. Dégressivité de zone selon § 4.3, uniquement pour dommages/soins calculés.
6. Retrait de PA/PM : jet par point (§ 3) ; distinguer esquivable (1079/1080/77/84) / non esquivable (168/169).
7. Ignorer les effets `visual`/`noop` (mais les journaliser pour l'animation).
8. Priorité d'implémentation : champ `enginePriority` du JSON (**P0** = utilisé par le donjon Vortex ou ≥ 60
   occurrences : 84 effets ; P1 = sorts de classe ; P2 = rares).

---

## 11. Catalogue des 218 effectId

Colonnes : id — actionId (PYDOFUS3) — libellé DofusDB — type/sous-type — paramètres — occurrences
(total / dont sorts de classe) — exemple réel. Détails, notes et sources : `effect-semantics.json`.

<!-- CATALOGUE:START -->

#### Dommages / vols de vie

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 89 | `CharacterLifePointsLostBasedOnCasterLife` | Dommages Neutre : X% PV du lanceur | damage/percent_caster_life · neutral | percent=diceNum | 20 (6) | P1 | Transfusion (12738) d=10,0 v=0 dur=0 C3[deg=0%x4] m=A t=I |
| 91 | `CharacterLifePointsStealFromWater` | X vol Eau | life_steal/elemental · water | min=diceNum; max=diceSide | 177 (143) | P0 | Stase (12728) d=20,24 v=0 dur=0 P1 m=a,A t=I |
| 92 | `CharacterLifePointsStealFromEarth` | X vol Terre | life_steal/elemental · earth | min=diceNum; max=diceSide | 148 (127) | P0 | Supplice (12725) d=22,26 v=0 dur=0 P1 m=a,A t=I |
| 93 | `CharacterLifePointsStealFromAir` | X vol Air | life_steal/elemental · air | min=diceNum; max=diceSide | 112 (87) | P0 | Feinterception (5027) d=51,70 v=0 dur=0 P1 m=A t=I |
| 94 | `CharacterLifePointsStealFromFire` | X vol Feu | life_steal/elemental · fire | min=diceNum; max=diceSide | 150 (131) | P0 | Absorption (12734) d=20,24 v=0 dur=0 P1 m=A t=I |
| 95 | `CharacterLifePointsSteal` | X vol Neutre | life_steal/elemental · neutral | min=diceNum; max=diceSide | 42 (0) | P2 | Soif de Sang (12705) d=14,16 v=0 dur=0 P1 m=a,A t=I |
| 96 | `CharacterLifePointsLostFromWater` | X dommages Eau | damage/elemental · water | min=diceNum; max=diceSide | 689 (536) | P0 | Petit poison (5021) d=50,0 v=0 dur=0 a1 m=L t=TB |
| 97 | `CharacterLifePointsLostFromEarth` | X dommages Terre | damage/elemental · earth | min=diceNum; max=diceSide | 693 (578) | P0 | Terre mythe (5017) d=51,70 v=0 dur=0 P1 m=A t=I |
| 98 | `CharacterLifePointsLostFromAir` | X dommages Air | damage/elemental · air | min=diceNum; max=diceSide | 661 (536) | P0 | Attraction ailée (5014) d=80,0 v=0 dur=0 C3,1 m=A t=I |
| 99 | `CharacterLifePointsLostFromFire` | X dommages Feu | damage/elemental · fire | min=diceNum; max=diceSide | 733 (582) | P0 | Cercle de feu (5016) d=61,80 v=0 dur=0 C2,1 m=A t=I |
| 100 | `CharacterLifePointsLost` | X dommages Neutre | damage/elemental · neutral | min=diceNum; max=diceSide | 32 (4) | P0 | Tirs optiques (5018) d=31,40 v=0 dur=0 P1 m=A t=I |
| 275 | `CharacterLifePointsLostBasedOnCasterLifeMissingFromWater` | Dommages Eau : X% PV manquants du lanceur | damage/percent_caster_missing_life · water | percent=diceNum | 1 (0) | P2 | Prospection (13350) d=100,0 v=0 dur=0 Q1[deg=0%x0] m=A t=I |
| 279 | `CharacterLifePointsLostBasedOnCasterLifeMissing` | Dommages Neutre : X% PV manquants du lanceur | damage/percent_caster_missing_life · neutral | percent=diceNum | 16 (2) | P1 | Mascarade (13404) d=25,0 v=0 dur=0 P1 m=C,*v50 t=I |
| 1013 | `CharacterLifePointsLostBasedOnMovementPointsFromAir` | X dommages Air (% PM restants) | damage/scaled_by_caster_remaining_mp · air ⚠ | min=diceNum; max=diceSide | 2 (2) | P1 | Zénith (13145) d=52,58 v=0 dur=0 L3 m=a,A t=I |
| 1016 | `CharacterLifePointsLostBasedOnMovementPointsFromEarth` | X dommages Terre (% PM restants) | damage/scaled_by_caster_remaining_mp · earth ⚠ | min=diceNum; max=diceSide | 2 (2) | P1 | Flèche du Jugement (32460) d=36,40 v=0 dur=0 P1 m=a,A t=I |
| 1048 | `CharacterLifePointsMalusPercent` | -X% PV | damage/percent_life_loss | percent=diceNum; duration=duration | 22 (20) | P1 | Mutilation (12737) d=10,0 v=0 dur=-1 P1 m=C,*e1302 t=I |
| 1092 | `CharacterLifePointsLostBasedOnTargetMissingMaxLife` | Dommages Neutre : X% PV érodés de la cible | damage/percent_target_eroded_life · neutral ⚠ | percent=diceNum | 2 (2) | P1 | Représailles (32472) d=20,0 v=0 dur=0 X1[deg=0%x0] m=A t=I |
| 1096 | `CharacterLifePointsLostBasedOnTargetMissingMaxLifeEarth` | Dommages Terre : X% PV érodés de la cible | damage/percent_target_eroded_life · earth ⚠ | percent=diceNum | 1 (0) | P0 | En temps et en heure (5061) d=50,0 v=0 dur=0 X63,1 m=A t=I |
| 1118 | `CharacterLifePointsLostBasedOnCasterMissingMaxLife` | Dommages Neutre : X% PV érodés du lanceur | damage/percent_caster_eroded_life · neutral | percent=diceNum | 4 (4) | P1 | Punition (12741) d=35,0 v=0 dur=0 P1 m=a,A t=I |
| 1122 | `CharacterLifePointsLostBasedOnCasterMissingMaxLifeEarth` | Dommages Terre : X% PV érodés du lanceur | damage/percent_caster_eroded_life · earth | percent=diceNum | 1 (0) | P0 | Morfaille (5069) d=20,0 v=0 dur=0 C2 m=A t=I |
| 1123 | `FightSplashRawTakenDamage` | Dommages : X% des dommages initiaux subis | damage/splash_raw_damage · same_as_source | percent=diceNum | 1 (0) | P0 | Heure du temps (4998) d=100,0 v=0 dur=0 a1 m=a,T t=I |
| 1223 | `FightSplashFinalTakenDamage` | Dommages : X% des dommages finaux subis | damage/splash_final_damage · same_as_source | percent=diceNum | 25 (8) | P1 | Couronne d'Épines (12761) d=100,0 v=0 dur=0 Q1[deg=0%x0] m=a,A t=DM\|XDM |
| 2822 | `CharacterLifePointsLostFromBestElement` | X dommages du meilleur élément | damage/elemental · best | min=diceNum; max=diceSide | 162 (126) | P0 | Ébriété (12826) d=8,10 v=0 dur=0 C2,1 m=A t=I |
| 2828 | `CharacterLifePointsStealFromBestElement` | X vol du meilleur élément | life_steal/elemental · best | min=diceNum; max=diceSide | 48 (12) | P1 | Kyrja (23823) d=28,32 v=0 dur=0 l1,63[deg=0%x0;stopAtTarget] m=A t=I |
| 2832 | `CharacterLifePointsLostFromWorstElement` | X dommages du pire élément | damage/elemental · worst | min=diceNum; max=diceSide | 4 (4) | P1 | Supernova (32033) d=9,11 v=0 dur=0 P1 m=A t=I |

#### Soins

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 90 | `CharacterDispatchLifePointsPercent` | Transfère X% des PV | heal/transfer_caster_life | percent=diceNum | 41 (23) | P1 | Absorption (12734) d=10,0 v=0 dur=0 P1 m=a t=I |
| 108 | `CharacterLifePointsWinFromFire` | X soins Feu | heal/elemental · fire | min=diceNum; max=diceSide | 132 (104) | P0 | Pandikulation (12793) d=28,31 v=0 dur=0 P1 m=g,K t=I |
| 786 | `CharacterHealAttackers` | Soin sur l'attaquant : #1% des dommages | heal/heal_attackers | percent=value | 29 (24) | P0 | Feinterception (5027) d=0,0 v=50 dur=0 P1 m=A t=D |
| 1109 | `FightLifePointsWinPercent` | Soin : X% des PV max | heal/percent_max_life | percent=diceNum | 243 (117) | P0 | Glyphe téléporteur (5011) d=10,0 v=0 dur=0 P1 m=L,*F3836 t=I |
| 2020 | `FightSplashHeal` | Soin : X% des dommages subis | heal/splash_heal_taken | percent=diceNum | 4 (2) | P1 | Perfusion (12758) d=30,0 v=0 dur=0 a1 m=a t=D\|XD |
| 2973 | `FightCasterSplashHeal` | Soin : X% des dommages occasionnés | heal/splash_heal_dealt | percent=diceNum | 46 (23) | P1 | Distribution (14577) d=25,0 v=0 dur=0 P1 m=a t=D\|XD |
| 2998 | `CharacterLifePointsWinFromWater` | X soins Eau | heal/elemental · water | min=diceNum; max=diceSide | 138 (90) | P0 | Eau-de-vie (12808) d=26,29 v=0 dur=0 P1 m=a,K t=I |
| 2999 | `CharacterLifePointsWinFromAir` | X soins Air | heal/elemental · air | min=diceNum; max=diceSide | 80 (64) | P0 | Propulsion (12788) d=33,37 v=0 dur=0 P1 m=g,K t=I |
| 3000 | `CharacterLifePointsWinFromEarth` | X soins Terre | heal/elemental · earth | min=diceNum; max=diceSide | 93 (76) | P0 | Brancard (12811) d=28,32 v=0 dur=0 P1 m=g,K t=I |
| 3002 | `CharacterLifePointsWinFromBestElement` | X soins du meilleur élément | heal/elemental · best | min=diceNum; max=diceSide | 34 (17) | P1 | Ronce Apaisante (13525) d=46,54 v=0 dur=0 P1 m=a,f5894,f5900,f5901 t=I |

#### Boucliers

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 1020 | `CharacterBoostShieldBasedOnCasterLevel` | Bouclier : X% du niveau | shield/percent_caster_level | percent=diceNum; duration=duration | 275 (210) | P0 | Fermentation (12819) d=240,0 v=0 dur=1 P1 m=a t=I |
| 1039 | `CharacterBoostShieldBasedOnCasterLife` | Bouclier : X% des PV max | shield/percent_caster_max_life | percent=diceNum; duration=duration | 23 (13) | P1 | Mutilation (12737) d=15,0 v=0 dur=1 P1 m=C,*E1230 t=I |
| 1040 | `CharacterBoostShield` | X Bouclier | shield/flat | amount=diceNum..diceSide; duration=duration | 6 (0) | P2 | Ébullition <sprite name="eau"> <sprite name="feu"> (13702) d=200,0 v=0 dur=3 a1 m=a,P,F5129 t=I |

#### PA / PM

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 77 | `CharacterMovementPointsSteal` | Vole X PM | ap_mp/mp_steal | amount=diceNum; duration=duration | 26 (24) | P0 | Hoxor (5028) d=2,0 v=0 dur=1 P1 m=A t=I |
| 84 | `CharacterActionPointsSteal` | Vole X PA | ap_mp/ap_steal | amount=diceNum; duration=duration | 6 (6) | P1 | Ralentissement (13242) d=1,0 v=0 dur=1 P1 m=a,A t=I |
| 120 | `CharacterActionPointsWin` | Rembourse X PA | ap_mp/ap_gain_instant | amount=diceNum | 86 (54) | P0 | Bombance (12804) d=1,0 v=0 dur=0 P1 m=C,E498 t=I |
| 1079 | `CharacterDeboostActionPointsDodgeable` | -X PA | ap_mp/ap_loss_dodgeable | amount=diceNum; duration=duration | 120 (100) | P0 | Terre mythe (5017) d=3,0 v=0 dur=1 P1 m=A t=I |
| 1080 | `CharacterDeboostMovementPointsDodgeable` | -X PM | ap_mp/mp_loss_dodgeable | amount=diceNum; duration=duration | 221 (155) | P0 | Attraction ailée (5015) d=3,0 v=0 dur=1 C3,1 m=A t=I |

#### Caractéristiques (buffs, debuffs, vols)

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 111 | `CharacterBoostActionPoints` | X PA | stat_buff/flat_stat | amount=diceNum; duration=duration | 107 (55) | P0 | Glyphe téléporteur (5002) d=4,0 v=0 dur=-1 P1 m=c,E228 t=I |
| 112 | `CharacterBoostDamages` | X Dommage | stat_buff/flat_stat | amount=diceNum; duration=duration | 28 (22) | P1 | Roulette (12840) d=50,0 v=0 dur=1 a1 m=a,A t=I |
| 115 | `CharacterBoostCriticalHit` | X% Critique | stat_buff/flat_stat | amount=diceNum; duration=duration | 50 (34) | P0 | Glyphe téléporteur (5002) d=10,0 v=0 dur=-1 P1 m=c,E221 t=I |
| 116 | `CharacterDeboostRange` | -X Portée | stat_debuff/flat_stat | amount=diceNum; duration=duration | 106 (84) | P0 | Ethylo (12791) d=3,0 v=0 dur=1 P1 m=a,A,*E498 t=I |
| 117 | `CharacterBoostRange` | X Portée | stat_buff/flat_stat | amount=diceNum; duration=duration | 52 (35) | P1 | Ethylo (12791) d=3,0 v=0 dur=1 P1 m=C,*E3531 t=I |
| 118 | `CharacterBoostStrength` | X Force | stat_buff/flat_stat | amount=diceNum; duration=duration | 36 (12) | P0 | Glyphe téléporteur (5002) d=400,0 v=0 dur=-1 P1 m=c,E229 t=I |
| 119 | `CharacterBoostAgility` | X Agilité | stat_buff/flat_stat | amount=diceNum; duration=duration | 38 (12) | P0 | Glyphe téléporteur (5002) d=400,0 v=0 dur=-1 P1 m=c,E232 t=I |
| 123 | `CharacterBoostChance` | X Chance | stat_buff/flat_stat | amount=diceNum; duration=duration | 36 (12) | P0 | Glyphe téléporteur (5002) d=400,0 v=0 dur=-1 P1 m=c,E226 t=I |
| 125 | `CharacterBoostVitality` | X Vitalité | stat_buff/flat_stat | amount=diceNum; duration=duration | 2 (0) | P2 | Méditation Ivre (12778) d=325,0 v=0 dur=4 P1 m=C t=I |
| 126 | `CharacterBoostIntelligence` | X Intelligence | stat_buff/flat_stat | amount=diceNum; duration=duration | 36 (12) | P0 | Glyphe téléporteur (5002) d=400,0 v=0 dur=-1 P1 m=c,E223 t=I |
| 128 | `CharacterBoostMovementPoints` | X PM | stat_buff/flat_stat | amount=diceNum; duration=duration | 200 (136) | P0 | Glyphe téléporteur (5002) d=2,0 v=0 dur=-1 P1 m=c,E224 t=I |
| 138 | `CharacterBoostDamagesPercent` | X Puissance | stat_buff/flat_stat | amount=diceNum; duration=duration | 215 (107) | P0 | Glyphe téléporteur (5011) d=200,0 v=0 dur=1 P1 m=L,*F3837 t=I |
| 145 | `CharacterDeboostDamages` | -X Dommage | stat_debuff/flat_stat | amount=diceNum; duration=duration | 32 (30) | P1 | Typhon (12976) d=20,0 v=0 dur=3 L2 m=A t=I |
| 152 | `CharacterDeboostChance` | -X Chance | stat_debuff/flat_stat | amount=diceNum; duration=duration | 8 (7) | P1 | Nimbus (12984) d=100,0 v=0 dur=3 X1 m=A t=I |
| 154 | `CharacterDeboostAgility` | -X Agilité | stat_debuff/flat_stat | amount=diceNum; duration=duration | 8 (7) | P1 | Typhon (12976) d=100,0 v=0 dur=3 L2 m=A t=I |
| 155 | `CharacterDeboostIntelligence` | -X Intelligence | stat_debuff/flat_stat | amount=diceNum; duration=duration | 8 (7) | P1 | Langueur (12978) d=100,0 v=0 dur=3 P1 m=a,A t=I |
| 157 | `CharacterDeboostStrength` | -X Force | stat_debuff/flat_stat | amount=diceNum; duration=duration | 8 (7) | P1 | Retour du Bâton (12983) d=100,0 v=0 dur=3 P1 m=a,A t=I |
| 160 | `CharacterBoostActionPointsLostDodge` | X Esquive PA | stat_buff/flat_stat | amount=diceNum; duration=duration | 3 (3) | P1 | Roulette (12840) d=50,0 v=0 dur=1 a1 m=a,A t=I |
| 161 | `CharacterBoostMovementPointsLostDodge` | X Esquive PM | stat_buff/flat_stat | amount=diceNum; duration=duration | 10 (10) | P1 | Stabilisation (12789) d=40,0 v=0 dur=1 P1 m=a t=I |
| 162 | `CharacterDeboostActionPointsLostDodge` | -X Esquive PA | stat_debuff/flat_stat | amount=diceNum; duration=duration | 9 (7) | P1 | Banqueroute (14278) d=20,0 v=0 dur=2 P1 m=a,A t=I |
| 163 | `CharacterDeboostMovementPointsLostDodge` | -X Esquive PM | stat_debuff/flat_stat | amount=diceNum; duration=duration | 21 (14) | P1 | Sève Paralysante (13533) d=15,0 v=0 dur=3 P1 m=a,A t=I |
| 168 | `CharacterDeboostActionPoints` | -X PA | stat_debuff/flat_stat | amount=diceNum; duration=duration | 7 (7) | P1 | Flou Temporel (13246) d=2,0 v=0 dur=1 C3 m=g,A t=I |
| 169 | `CharacterDeboostMovementPoints` | -X PM | stat_debuff/flat_stat | amount=diceNum; duration=duration | 37 (17) | P0 | Vortexiphan (5006) d=100,0 v=0 dur=-1 P1 m=C t=I |
| 171 | `CharacterDeboostCriticalHit` | -X% Critique | stat_debuff/flat_stat | amount=diceNum; duration=duration | 43 (31) | P1 | Stase (12728) d=20,0 v=0 dur=1 P1 m=a,A t=I |
| 178 | `CharacterBoostHealBonus` | X Soin | stat_buff/flat_stat | amount=diceNum; duration=duration | 13 (3) | P1 | Roulette (12840) d=100,0 v=0 dur=1 a1 m=a,A t=I |
| 182 | `CharacterBoostMaximumSummonedCreatures` | X Invocation | stat_buff/flat_stat | amount=diceNum; duration=duration | 15 (3) | P1 | Cortège Sauvage (31119) d=3,0 v=0 dur=2 P1 m=C t=I |
| 186 | `CharacterDeboostDamagesPercent` | -X Puissance | stat_debuff/flat_stat | amount=diceNum; duration=duration | 55 (33) | P1 | Absorption (12734) d=150,0 v=0 dur=1 P1 m=A t=I |
| 210 | `CharacterBoostEarthElementPercent` | X% Résistance Terre | stat_buff/percent_stat | amount=diceNum; duration=duration | 1 (0) | P2 | Armure Terrestre (29057) d=15,0 v=0 dur=2 P1 m=a,E5262 t=I |
| 211 | `CharacterBoostWaterElementPercent` | X% Résistance Eau | stat_buff/percent_stat | amount=diceNum; duration=duration | 1 (0) | P2 | Armure Aqueuse (29059) d=15,0 v=0 dur=2 P1 m=a,E5264 t=I |
| 212 | `CharacterBoostAirElementPercent` | X% Résistance Air | stat_buff/percent_stat | amount=diceNum; duration=duration | 1 (0) | P2 | Armure Venteuse (29060) d=15,0 v=0 dur=2 P1 m=a,E5265 t=I |
| 213 | `CharacterBoostFireElementPercent` | X% Résistance Feu | stat_buff/percent_stat | amount=diceNum; duration=duration | 1 (0) | P2 | Armure Incandescente (29058) d=15,0 v=0 dur=2 P1 m=a,E5263 t=I |
| 215 | `CharacterDeboostEarthElementPercent` | -X% Résistance Terre | stat_debuff/percent_stat | amount=diceNum; duration=duration | 2 (2) | P1 | Bouclier Élémentaire (13682) d=5,0 v=0 dur=2 P1 m=a t=DE |
| 216 | `CharacterDeboostWaterElementPercent` | -X% Résistance Eau | stat_debuff/percent_stat | amount=diceNum; duration=duration | 2 (2) | P1 | Bouclier Élémentaire (13682) d=5,0 v=0 dur=2 P1 m=a t=DW |
| 217 | `CharacterDeboostAirElementPercent` | -X% Résistance Air | stat_debuff/percent_stat | amount=diceNum; duration=duration | 2 (2) | P1 | Bouclier Élémentaire (13682) d=5,0 v=0 dur=2 P1 m=a t=DA |
| 218 | `CharacterDeboostFireElementPercent` | -X% Résistance Feu | stat_debuff/percent_stat | amount=diceNum; duration=duration | 2 (2) | P1 | Bouclier Élémentaire (13682) d=5,0 v=0 dur=2 P1 m=a t=DF |
| 219 | `CharacterDeboostNeutralElementPercent` | -X% Résistance Neutre | stat_debuff/percent_stat | amount=diceNum; duration=duration | 2 (2) | P1 | Bouclier Élémentaire (13682) d=5,0 v=0 dur=2 P1 m=a t=DN |
| 266 | `CharacterStealChance` | Vole X Chance | stat_steal/flat_stat | amount=diceNum; duration=duration | 12 (12) | P1 | Pillage (12934) d=100,0 v=0 dur=3 P1 m=a,A t=I |
| 268 | `CharacterStealAgility` | Vole X Agilité | stat_steal/flat_stat | amount=diceNum; duration=duration | 13 (12) | P0 | Attraction ailée (5015) d=100,0 v=0 dur=2 C3,1 m=A t=I |
| 269 | `CharacterStealIntelligence` | Vole X Intelligence | stat_steal/flat_stat | amount=diceNum; duration=duration | 14 (12) | P0 | Cercle de feu (5016) d=100,0 v=0 dur=2 C2,1 m=A t=I |
| 271 | `CharacterStealStrength` | Vole X Force | stat_steal/flat_stat | amount=diceNum; duration=duration | 14 (12) | P0 | Terre mythe (5017) d=100,0 v=0 dur=1 P1 m=A t=I |
| 320 | `CharacterStealRange` | Vole X Portée | stat_steal/flat_stat | amount=diceNum; duration=duration | 18 (12) | P1 | Persiflage (14620) d=3,0 v=0 dur=1 P1 m=a,A,R t=I |
| 410 | `CharacterBoostApAttack` | X Retrait PA | stat_buff/flat_stat | amount=diceNum; duration=duration | 7 (5) | P1 | Roulette (12840) d=50,0 v=0 dur=1 a1 m=a,A t=I |
| 411 | `CharacterDeboostApAttack` | -X Retrait PA | stat_debuff/flat_stat | amount=diceNum; duration=duration | 6 (6) | P1 | Schnaps (12782) d=30,0 v=0 dur=2 X1 m=g,A,*E3531 t=I |
| 412 | `CharacterBoostMpAttack` | X Retrait PM | stat_buff/flat_stat | amount=diceNum; duration=duration | 7 (3) | P1 | Roulette (12840) d=50,0 v=0 dur=1 a1 m=a,A t=I |
| 413 | `CharacterDeboostMpAttack` | -X Retrait PM | stat_debuff/flat_stat | amount=diceNum; duration=duration | 6 (6) | P1 | Schnaps (12782) d=30,0 v=0 dur=2 X1 m=g,A,*E3531 t=I |
| 414 | `CharacterBoostPushDamage` | X Dommage Poussée | stat_buff/flat_stat | amount=diceNum; duration=duration | 46 (25) | P0 | Glyphe téléporteur (5011) d=200,0 v=0 dur=1 P1 m=L,*F3839 t=I |
| 416 | `CharacterBoostPushDamageReduction` | X Résistance Poussée | stat_buff/flat_stat | amount=diceNum; duration=duration | 11 (8) | P1 | Roulette (12840) d=100,0 v=0 dur=1 a1 m=a,A t=I |
| 417 | `CharacterDeboostPushDamageReduction` | -X Résistance Poussée | stat_debuff/flat_stat | amount=diceNum; duration=duration | 49 (38) | P0 | Décollage (5032) d=300,0 v=0 dur=1 a1 m=A t=I |
| 418 | `CharacterBoostCriticalDamagesBonus` | X Dommage Critiques | stat_buff/flat_stat | amount=diceNum; duration=duration | 8 (5) | P0 | Glyphe téléporteur (5002) d=200,0 v=0 dur=-1 P1 m=c,E221 t=I |
| 419 | `CharacterDeboostCriticalDamagesBonus` | -X Dommage Critiques | stat_debuff/flat_stat | amount=diceNum; duration=duration | 10 (6) | P1 | Belote (12866) d=10,40 v=0 dur=2 P1 m=g,A t=I |
| 420 | `CharacterBoostCriticalDamagesReduction` | X Résistance Critiques | stat_buff/flat_stat | amount=diceNum; duration=duration | 22 (10) | P0 | Glyphe téléporteur (5002) d=150,0 v=0 dur=-1 P1 m=c,E227 t=I |
| 421 | `CharacterDeboostCriticalDamagesReduction` | -X Résistance Critiques | stat_debuff/flat_stat | amount=diceNum; duration=duration | 4 (4) | P1 | Griffe Joueuse (12849) d=31,35 v=0 dur=3 l1,63[deg=0%x0;stopAtTarget] m=a,A t=I |
| 752 | `CharacterBoostTakleEvade` | X Fuite | stat_buff/flat_stat | amount=diceNum; duration=duration | 50 (21) | P1 | Roulette (12840) d=50,0 v=0 dur=1 a1 m=a,A t=I |
| 753 | `CharacterBoostTakleBlock` | X Tacle | stat_buff/flat_stat | amount=diceNum; duration=duration | 38 (19) | P1 | Roulette (12840) d=50,0 v=0 dur=1 a1 m=a,A t=I |
| 754 | `CharacterDeboostTakleEvade` | -X Fuite | stat_debuff/flat_stat | amount=diceNum; duration=duration | 55 (39) | P1 | Dissolution (12757) d=30,0 v=0 dur=1 X1 m=g,A t=I |
| 755 | `CharacterDeboostTakleBlock` | -X Tacle | stat_debuff/flat_stat | amount=diceNum; duration=duration | 16 (8) | P1 | Nimbus (12984) d=20,0 v=0 dur=3 X1 m=A t=I |
| 776 | `CharacterBoostPermanentDamagePercent` | X% Érosion | stat_debuff/percent_stat | amount=diceNum; duration=duration | 72 (62) | P0 | En temps et en heure (5061) d=20,0 v=0 dur=2 X63,1 m=A t=I |
| 1027 | `BombComboBonus` | X% Dommages Combo | stat_buff/percent_stat | amount=diceNum; duration=duration | 15 (0) | P2 | Combo (20500) d=360,0 v=0 dur=-1 P1 m=C t=I |
| 1033 | `CharacterDeboostVitalityPercentStatic` | -X% Vitalité | stat_debuff/percent_stat | amount=diceNum; duration=duration | 2 (2) | P1 | Dernier Souffle (13446) d=50,0 v=0 dur=2 P1 m=C t=I |
| 1076 | `CharacterBoostResistPercent` | X% Résistance | stat_buff/percent_stat | amount=diceNum; duration=duration | 5 (2) | P1 | Bouclier Élémentaire (13682) d=25,0 v=0 dur=2 P1 m=a t=I |
| 1078 | `CharacterBoostVitalityPercentStatic` | X% Vitalité | stat_buff/percent_stat | amount=diceNum; duration=duration | 65 (23) | P0 | Glyphe téléporteur (5002) d=30,0 v=0 dur=-1 P1 m=c,E231 t=I |
| 1171 | `CharacterBoostDealtDamagePercentMultiplier` | #1% Dommages finaux | stat_buff/percent_stat | amount=diceNum; duration=duration | 96 (17) | P0 | Portail (14574) d=2,0 v=0 dur=3 P1 m=C t=I |
| 1172 | `CharacterDeboostDealtDamagePercentMultiplier` | -#1% Dommages finaux | stat_debuff/percent_stat | amount=diceNum; duration=duration | 21 (14) | P1 | Stalagmite (13667) d=4,0 v=0 dur=1 P1 m=a,A t=I |
| 2800 | `CharacterBoostDealtDamagePercentMultiplierMelee` | X% Dommages mêlée | stat_buff/percent_stat | amount=diceNum; duration=duration | 10 (10) | P1 | Masque du Psychopathe (13388) d=10,0 v=0 dur=-1 P1 m=C t=I |
| 2802 | `CharacterBoostReceivedDamagePercentMultiplierMelee` | -X% Résistance mêlée | stat_debuff/percent_stat | amount=diceNum; duration=duration | 2 (1) | P1 | Transfiguration (18650) d=10,0 v=0 dur=2 P1 m=A,*E99 t=EON99 |
| 2803 | `CharacterDeboostReceivedDamagePercentMultiplierMelee` | X% Résistance mêlée | stat_buff/percent_stat | amount=diceNum; duration=duration | 8 (6) | P1 | Amarok (13802) d=10,0 v=0 dur=1 X1[deg=0%x4] m=C,a t=I |
| 2804 | `CharacterBoostDealtDamagePercentMultiplierDistance` | X% Dommages distance | stat_buff/percent_stat | amount=diceNum; duration=duration | 5 (5) | P1 | Masque du Couard (13406) d=10,0 v=0 dur=-1 P1 m=C t=I |
| 2805 | `CharacterDeboostDealtDamagePercentMultiplierDistance` | -X% Dommages distance | stat_debuff/percent_stat | amount=diceNum; duration=duration | 1 (1) | P1 | Sentinelle (32475) d=2,0 v=0 dur=2 P1 m=C t=CCMPARR |
| 2806 | `CharacterBoostReceivedDamagePercentMultiplierDistance` | -X% Résistance distance | stat_debuff/percent_stat | amount=diceNum; duration=duration | 2 (1) | P1 | Transfiguration (18650) d=10,0 v=0 dur=2 P1 m=A,*E100 t=EON100 |
| 2807 | `CharacterDeboostReceivedDamagePercentMultiplierDistance` | X% Résistance distance | stat_buff/percent_stat | amount=diceNum; duration=duration | 1 (0) | P2 | Barrière (31538) d=30,0 v=0 dur=1 C2 m=a t=I |
| 2812 | `CharacterBoostDealtDamagePercentMultiplierSpells` | X% Dommages aux sorts | stat_buff/percent_stat | amount=diceNum; duration=duration | 3 (2) | P1 | Berserk (12743) d=10,0 v=0 dur=-1 P1 m=C,e1803 t=I |
| 2844 | `CharacterBoostVitalityPercent` | X% Vitalité | stat_buff/percent_stat | amount=diceNum; duration=duration | 2 (2) | P1 | Poinçon (23401) d=100,0 v=0 dur=1 P1 m=C t=I |
| 2971 | `CharacterBoostDealtHealPercentMultiplier` | #1% Soins finaux | stat_buff/percent_stat | amount=diceNum; duration=duration | 17 (10) | P1 | Portail (14574) d=2,0 v=0 dur=3 P1 m=C t=I |
| 2972 | `CharacterDeboostDealtHealPercentMultiplier` | -#1% Soins finaux | stat_debuff/percent_stat | amount=diceNum; duration=duration | 1 (0) | P2 | Martinet (31440) d=50,0 v=0 dur=1 P1 m=C t=I |

#### Modificateurs de dégâts/soins reçus

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 265 | `CharacterLifeLostCasterModerator` | -X dommages reçus | damage_modifier/flat_reduction_armor ⚠ | reduction=value; listenerDuration=effectTriggerDuration | 17 (14) | P1 | Rempart (12981) d=0,0 v=12 dur=0 C3 m=C,a t=D |
| 765 | `CharacterSacrify` | Intercepte les dommages | damage_modifier/sacrifice_intercept | listenerDuration=effectTriggerDuration | 16 (8) | P1 | Sacrifice (12739) d=0,0 v=0 dur=0 C2 m=g t=D |
| 1061 | `CharacterShareDamages` | Partage les dommages | damage_modifier/share_damage | listenerDuration=effectTriggerDuration ou duration | 16 (8) | P1 | Musette Animée (13354) d=0,0 v=0 dur=2 Q1 m=a t=D |
| 1159 | `CharacterMultiplyReceivedHeal` | Soins reçus x#1% | damage_modifier/multiply_received_heal | percent=diceNum; listenerDuration=effectTriggerDuration | 73 (61) | P0 | Hémorragie (12748) d=70,0 v=0 dur=0 P1 m=a,A t=H |
| 1163 | `CharacterMultiplyReceivedDamage` | Dommages subis x#1% | damage_modifier/multiply_received_damage | percent=diceNum; listenerDuration=effectTriggerDuration | 102 (50) | P0 | Glyphe téléporteur (5002) d=70,0 v=0 dur=0 P1 m=c,E225 t=D |

#### Déplacements

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 4 | `CharacterTeleportOnSameMap` | Téléporte sur la case ciblée | movement/teleport | diceNum=INCERTAIN | 126 (75) | P0 | Décalage horaire (4996) d=10,0 v=0 dur=0 ;1 m=a,A,*E231,*e6490 t=I |
| 5 | `CharacterPush` | Repousse de #1 case | movement/push | cells=diceNum | 481 (399) | P0 | Glyphe téléporteur (5012) d=2,0 v=0 dur=0 X2,1 m=a,E56,f3835 t=I |
| 6 | `CharacterPull` | Attire de #1 case | movement/pull | cells=diceNum | 438 (321) | P0 | Attraction ailée (5015) d=3,0 v=0 dur=0 C3,1 m=A t=I |
| 8 | `CharacterExchangePlaces` | Échange de positions | movement/swap |  | 119 (75) | P0 | Glyphe téléporteur (5011) d=0,0 v=0 dur=0 P1 m=L t=I |
| 50 | `CarryCharacter` | Porte la cible | movement/carry |  | 10 (5) | P1 | Karcham (12787) d=0,0 v=0 dur=0 P1 m=g,A,*e3 t=I |
| 51 | `ThrowCarriedCharacter` | Lance une entité | movement/throw |  | 33 (31) | P1 | Karcham (12787) d=0,0 v=0 dur=0 P1 m=g,A,*E3 t=I |
| 783 | `CharacterPushUpTo` | Pousse jusqu'à la case visée | movement/push_up_to |  | 9 (3) | P1 | Peur (12908) d=0,0 v=0 dur=0 P1 m=a,A t=I |
| 784 | `CharacterTeleportToFightStartPos` | Téléporte à la position de début de combat | movement/teleport_fight_start_position ⚠ |  | 1 (0) | P0 | Action ! (5060) d=0,0 v=0 dur=0 a1 m=c,L,*e236 t=I |
| 1023 | `CharacterExchangePlacesForce` | Échange de positions (forcé) | movement/swap_forced |  | 18 (0) | P0 | Décalage horaire (4996) d=0,0 v=0 dur=0 ;1 m=a,A,*E231,*e6490 t=I |
| 1041 | `CharacterGetPushed` | Recule de #1 case | movement/caster_pushed_back | cells=diceNum | 90 (75) | P0 | Appui (13403) d=3,0 v=0 dur=0 P1 m=a,A t=I |
| 1042 | `CharacterGetPulled` | Avance de #1 case | movement/caster_pulled_forward | cells=diceNum | 135 (116) | P0 | Ravage (12746) d=5,0 v=0 dur=0 P1 m=a,A t=I |
| 1043 | `CharacterPullUpTo` | Attire jusqu'à la case visée | movement/pull_up_to |  | 4 (0) | P2 | Aspirateur (13452) d=0,0 v=0 dur=0 P1 m=a,A t=I |
| 1099 | `FightRollbackTurnBeginPosition` | Téléporte à la position de début de tour | movement/rollback_turn_start |  | 10 (6) | P1 | Rembobinage (13243) d=0,0 v=0 dur=0 P1 m=a t=I |
| 1100 | `FightRollbackPreviousPosition` | Téléporte à la position précédente | movement/rollback_previous_position |  | 65 (49) | P0 | Morfaille (5070) d=0,0 v=0 dur=0 P1 m=A t=I |
| 1101 | `FightTeleswap` | Téléporte ou échange de positions | movement/teleport_or_swap |  | 4 (1) | P1 | Prémonition (13293) d=0,0 v=0 dur=0 P1 m=g,A,*e7,*e97,*e6 t=I |
| 1103 | `FightPushNoDamage` | Repousse de #1 case (sans dommages) | movement/push_no_damage | cells=diceNum | 42 (37) | P1 | Botte (13434) d=1,0 v=0 dur=0 X3,3 m=a,P,F3112,F3113,F3114,F5161,F5163,F5162 t=I |
| 1104 | `FightTeleswapMirror` | Téléportation symétrique par rapport à la cible | movement/mirror_caster_around_target |  | 74 (53) | P0 | Éviction (12790) d=0,0 v=0 dur=0 P1 m=C,*E3531 t=I |
| 1105 | `FightTeleswapMirrorCaster` | Téléportation symétrique par rapport au lanceur | movement/mirror_target_around_caster |  | 46 (41) | P0 | Heure du temps (4998) d=0,0 v=0 dur=0 a1 m=A,o,*e6490 t=I |
| 1106 | `FightTeleswapMirrorImpactPoint` | Téléportation symétrique | movement/mirror_targets_around_impact |  | 76 (57) | P0 | Paradoxe (13250) d=0,0 v=0 dur=0 C4 m=g,A,f3958,e7 t=I |
| 2184 | `TargetFollowCaster` | Suit le lanceur | movement/follow_caster ⚠ |  | 4 (3) | P1 | Laisse Spirituelle (31152) d=0,0 v=0 dur=0 P1 m=g,A t=CMPARR |

#### États / invisibilité

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 150 | `CharacterMakeInvisible` | Rend la cible invisible | state_like/invisibility | duration=duration | 7 (4) | P1 | Invisibilité (12913) d=0,0 v=0 dur=1 P1 m=a,A t=I |
| 950 | `FightSetState` | État #3 | state/add_state | stateId=value; duration=duration | 2433 (1108) | P0 | Vortexiphan (5006) d=0,0 v=56 dur=-1 P1 m=C t=I |
| 951 | `FightUnsetState` | Enlève l'état #3 | state/remove_state | stateId=value | 814 (195) | P0 | Décalage horaire (4996) d=0,0 v=234 dur=0 a1 m=g t=I |
| 952 | `FightDisableState` | Désactive l'état #3 | state/disable_state | stateId=value; duration=duration | 13 (3) | P1 | Vingt-cinquième Heure (14650) d=0,0 v=6 dur=1 P1 m=C t=I |

#### Invocations / spéciaux

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 140 | `CharacterPassNextTurn` | Tour annulé | special/skip_turn ⚠ | duration=duration | 2 (0) | P0 | Glyphe téléporteur (5002) d=0,0 v=0 dur=-1 P1 m=c,E234 t=I |
| 141 | `CharacterKill` | Tue la cible | special/kill |  | 176 (31) | P0 | Action ! (5060) d=0,0 v=0 dur=0 a1 m=g,f3833,*e236 t=I |
| 180 | `CharacterAddDoubleUseSummonSlot` | Invoque un double du lanceur | summon/double_of_caster |  | 5 (5) | P1 | Double (12915) d=0,0 v=0 dur=0 P1 m=a,A t=I |
| 181 | `SummonCreature` | Invoque : #1 | summon/summon_ai | monsterId=diceNum; grade=diceSide; value=INCERTAIN: nb max d'invocations creees dans la zone | 218 (194) | P0 | Vortexiphan (5006) d=3833,6 v=0 dur=0 C63,2 m=a,A t=I |
| 202 | `DecorsRevealUnvisible` | Dévoile les entités invisibles | special/reveal_invisible |  | 34 (22) | P1 | Perception (12852) d=0,0 v=0 dur=0 C3 m=A t=I |
| 405 | `FightKillAndSummon` | Tue la cible et remplace par l'invocation : #1 | summon/kill_and_replace | monsterId=diceNum; grade=diceSide | 52 (36) | P1 | Puissance Sylvestre (13530) d=5894,1 v=0 dur=0 P1 m=a,F5901 t=I |
| 780 | `CharacterSummonDeadAllyInFight` | Invoque le dernier allié mort avec X % de ses PV | summon/revive_dead_ally ⚠ | lifePercentMin=diceNum; lifePercentMax=diceSide | 1 (0) | P0 | Vortexiphan (5003) d=20,30 v=0 dur=0 C63,3 m=h,m,d t=I |
| 781 | `CharacterUnlucky` | Minimise les effets aléatoires de la cible | special/minimize_random | duration=duration | 6 (6) | P1 | Poisse (12922) d=0,0 v=1 dur=1 P1 m=A,e5183 t=I |
| 782 | `CharacterMaximizeRoll` | Maximise les effets aléatoires sur la cible | special/maximize_random | duration=duration | 3 (0) | P2 | XIX. Le Soleil - Tarot d'Ecaflip (30021) d=0,0 v=1 dur=1 P1 m=a,A t=I |
| 1008 | `SummonBomb` | Invoque : #1 | summon/bomb | monsterId=diceNum; grade=diceSide | 32 (20) | P1 | Tornabombe (13435) d=3113,3 v=0 dur=0 P1 m=a,A t=I |
| 1009 | `CharacterActivateBomb` | Déclenche une bombe | special/activate_bomb |  | 15 (7) | P1 | Détonateur (13432) d=0,0 v=0 dur=0 P1 m=a,P,F3112,F3113,F3114,F5161 t=I |
| 1011 | `SummonSlave` | Invoque : #1 | summon/summon_controllable | monsterId=diceNum; grade=diceSide | 29 (28) | P1 | Complice (13287) d=5144,3 v=0 dur=0 P1 m=a,A t=I |
| 1031 | `CharacterPassCurrentTurn` | Termine le tour | special/end_turn |  | 6 (4) | P1 | Roublardise (13431) d=0,0 v=0 dur=0 P1 m=C t=I |
| 1097 | `CharacterAddIllusionMirror` | Crée des illusions | summon/illusions | count=diceNum | 5 (3) | P1 | Roublardise (13431) d=3,0 v=0 dur=0 P1 m=a,A t=I |
| 2027 | `ControlEntity` | Prend le contrôle de l'entité | special/control_entity | duration=duration | 4 (0) | P2 | Complot (19724) d=0,0 v=0 dur=-1 P1 m=a,P t=I |
| 2188 | `ModifyAiBehaviour` | Change le comportement du monstre | special/ai_behaviour ⚠ | behaviour=diceNum | 2 (0) | P2 | Mutation (25787) d=1,0 v=0 dur=-1 P1 m=C,*E4168 t=I |
| 2796 | `FightKillAndSummonSlave` | Tue la cible et remplace par l'invocation : #1 | summon/kill_and_replace_controllable | monsterId=diceNum; grade=diceSide | 4 (4) | P1 | Puissance Sylvestre (13530) d=5901,3 v=0 dur=0 P1 m=a,E256 t=I |

#### Marques (glyphes, pièges, runes, portails)

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 400 | `FightAddTrapCastingSpell` | Pose un piège | mark/trap | spellId=diceNum; spellGrade=diceSide; color=value; duration=duration; cells=zoneDescr de l'effet | 34 (32) | P1 | Piège Sournois (12906) d=12929,3 v=12128795 dur=0 X1 m=a,A t=I |
| 401 | `FightAddGlyphCastingSpell` | Pose un glyphe de début de tour | mark/glyph_turn_start | spellId=diceNum; spellGrade=diceSide; color=value; duration=duration; cells=zoneDescr de l'effet | 27 (22) | P1 | Terre Brûlée (12985) d=12996,3 v=13243184 dur=2 G2 m=A t=I |
| 402 | `FightAddGlyphCastingSpellEndturn` | Pose un glyphe de fin de tour | mark/glyph_turn_end | spellId=diceNum; spellGrade=diceSide; color=value; duration=duration; cells=zoneDescr de l'effet | 9 (6) | P1 | Mot d'Amitié (25795) d=25948,6 v=15407341 dur=2 C2[deg=0%x0] m=a,A,*E4254 t=I |
| 1026 | `ForceGlyphTrigger` | Déclenche les glyphes | mark/trigger_glyphs | spellId=value | 33 (32) | P1 | Transhumance (12986) d=0,0 v=12987 dur=0 P1 m=a,A,*e5366 t=I |
| 1091 | `FightAddGlyphAura` | Pose un glyphe-aura | mark/glyph_aura | spellId=diceNum; spellGrade=diceSide; color=value; duration=duration; cells=zoneDescr de l'effet | 68 (47) | P0 | Barricade (12979) d=29301,2 v=12422470 dur=1 X1 m=a t=I |
| 1165 | `FightAddGlyphCastingSpellImmediate` | Pose un glyphe | mark/glyph_immediate ⚠ | spellId=diceNum; spellGrade=diceSide; color=value; duration=duration; cells=zoneDescr de l'effet | 8 (4) | P0 | Glyphe téléporteur (5012) d=5011,1 v=4210852 dur=1 P1 m=a,A,*e56 t=I |
| 1181 | `FightAddPortal` | Pose un portail (+#3% dommages, +#1% dommages par case d'éloignement entre 2 portails) | mark/portal | bonusPerCell=diceNum; unknown=diceSide; baseBonus=value; duration=duration | 26 (19) | P1 | Portail (14574) d=2,44338 v=0 dur=-1 P1 m=a,A t=I |
| 1182 | `FightUsePortal` | Téléportail | mark/use_portal |  | 5 (3) | P1 | Résonance (14611) d=0,0 v=0 dur=0 P1 m=a,A t=D\|XD |
| 1183 | `FightDisablePortal` | Désactive un portail | mark/disable_portal | duration=duration | 5 (5) | P1 | Neutral (14582) d=0,0 v=0 dur=1 P1 m=a,A t=I |
| 2018 | `DispelGlyphsOfTarget` | Dissipe les glyphes | mark/dispel_glyphs | spellId=diceNum | 20 (8) | P1 | Pâturage (13013) d=13013,0 v=0 dur=0 P1 m=C t=I |
| 2022 | `FightAddRuneCastingSpell` | Pose une rune | mark/rune | spellId=diceNum; spellGrade=diceSide; color=value; duration=duration; cells=zoneDescr de l'effet | 124 (118) | P0 | Lance-flamme (13666) d=13665,1 v=13243184 dur=2 P1 m=a,A t=I |
| 2023 | `ForceRuneTrigger` | Déclenche les runes | mark/trigger_runes |  | 11 (9) | P1 | Runification (13670) d=0,0 v=0 dur=0 P1 m=a,A t=I |

#### Lancements de sorts

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 792 | `TargetExecuteSpell` | #1 | cast_spell/target_executes | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max de declenchements du buff si l'effet est declenche | 1578 (702) | P0 | Vortexiphan (5006) d=5006,2 v=0 dur=0 P1 m=C t=I |
| 793 | `TargetExecuteSpellWithAnimation` | #1 | cast_spell/target_executes | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max de declenchements du buff si l'effet est declenche | 3 (0) | P0 | Vortexiphan (5006) d=5003,1 v=0 dur=0 P1 m=C t=TB |
| 1017 | `TargetExecuteSpellOnSource` | #1 | cast_spell/target_executes_on_source | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max de declenchements du buff si l'effet est declenche | 74 (5) | P0 | Jormun (23268) d=30712,1 v=999 dur=0 a1 m=a,P,F7139 t=I |
| 1018 | `SourceExecuteSpellOnTarget` | #1 | cast_spell/source_executes_on_target | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max de declenchements du buff si l'effet est declenche | 1 (0) | P2 | Repérage (29071) d=29071,4 v=999 dur=0 Q63 m=g,p,o t=I |
| 1019 | `SourceExecuteSpellOnSource` | #1 | cast_spell/source_executes_on_source | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max de declenchements du buff si l'effet est declenche | 6 (4) | P1 | Muselière (13793) d=18544,2 v=0 dur=0 P1 m=A,E516 t=I |
| 1160 | `CasterExecuteSpell` | #1 | cast_spell/caster_executes | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max de declenchements du buff si l'effet est declenche | 3657 (2352) | P0 | Heure du temps (4999) d=4996,1 v=0 dur=0 a1 m=L t=TB |
| 2017 | `TargetExecuteSpellOnSourceGlobalLimitation` | #1 | cast_spell/target_executes_on_source_global_limit | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max d'execution | 2 (0) | P2 | Récursivité (13881) d=13881,4 v=1 dur=0 Q1 m=a,F5836,F5832,F5835,F5833,F5837,F5831,e2460 t=I |
| 2160 | `CasterExecuteSpellGlobalLimitation` | #1 | cast_spell/caster_executes_global_limit | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max d'execution | 137 (95) | P0 | Gelure (13245) d=13274,1 v=1 dur=0 a1 m=a,A,T t=I |
| 2792 | `TargetExecuteSpellGlobalLimitation` | #1 | cast_spell/target_executes_global_limit | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max d'execution | 34 (0) | P2 | Rembobinage (13273) d=13273,2 v=1 dur=0 a1 m=a,F3958,e306,E3715 t=I |
| 2793 | `TargetExecuteSpellWithAnimationGlobalLimitation` | #1 | cast_spell/target_executes_global_limit | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max d'execution | 2 (0) | P2 | Feuillage (13558) d=13584,1 v=6 dur=0 C63[deg=0%x0] m=g,P,E256 t=I |
| 2794 | `TargetExecuteSpellOnCell` | #1 | cast_spell/target_executes_on_cell | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max de declenchements du buff si l'effet est declenche | 186 (124) | P0 | Vertu (13142) d=29723,3 v=999 dur=0 P1 m=C t=I |
| 2795 | `TargetExecuteSpellOnCellGlobalLimitation` | #1 | cast_spell/target_executes_on_cell_global_limit | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max d'execution | 2 (2) | P1 | Flèche Boomerang (32432) d=32434,2 v=1 dur=0 Q63 m=a,A,E6975 t=I |
| 2960 | `CasterExecuteSpellOnCell` | #1 | cast_spell/caster_executes_on_cell | spellId=diceNum; spellGrade=diceSide; maxTriggerCount=value = nombre max de declenchements du buff si l'effet est declenche | 301 (234) | P0 | Karcham (12787) d=25507,1 v=0 dur=0 P1 m=C,*E4029 t=I |

#### Modificateurs de sorts / relance

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 280 | `BoostSpellRangeMin` | #1 : +#3 Portée minimale | spell_modifier/boost | spellId=diceNum; value=value; duration=duration | 177 (175) | P0 | Tirs Éloignés (32465) d=0,0 v=3 dur=1 P1 m=C t=I |
| 281 | `BoostSpellRangeMax` | #1 : +#3 Portée maximale | spell_modifier/boost | spellId=diceNum; value=value; duration=duration | 133 (112) | P0 | Karcham (12787) d=12787,0 v=5 dur=-1 P1 m=C t=I |
| 285 | `BoostSpellApCost` | #1 : -#3 PA | spell_modifier/boost | spellId=diceNum; value=value; duration=duration | 112 (4) | P0 | Pétrification (13290) d=13290,0 v=1 dur=3 P1 m=C t=I |
| 287 | `BoostSpellCc` | #1 : +#3% Critique | spell_modifier/boost | spellId=diceNum; value=value; duration=duration | 4 (0) | P2 | Tromperie (29907) d=12881,0 v=15 dur=-1 P1 m=C t=I |
| 289 | `BoostSpellNolineofsight` | #1 : ligne de vue désactivée | spell_modifier/set | spellId=diceNum; value=value; duration=duration | 7 (2) | P1 | Acuité Absolue (32469) d=0,0 v=1 dur=1 P1 m=C t=I |
| 290 | `BoostSpellMaxperturn` | #1 : +#3 lancer(s) par tour | spell_modifier/boost | spellId=diceNum; value=value; duration=duration | 15 (6) | P1 | Transcendance (14580) d=14574,0 v=1 dur=1 P1 m=C,E3737 t=I |
| 291 | `BoostSpellMaxpertarget` | #1 : +#3 lancer(s) par cible | spell_modifier/boost | spellId=diceNum; value=value; duration=duration | 2 (2) | P1 | Varappe (12813) d=12787,0 v=1 dur=1 P1 m=C,*E3583 t=I |
| 293 | `BoostSpellBaseDmg` | #1 : +#3 dégâts de base | spell_modifier/boost | spellId=diceNum; value=value; duration=duration | 328 (158) | P0 | Paume Explosive (12781) d=12781,0 v=12 dur=1 P1 m=C,*E498,*e3533 t=I |
| 295 | `DeboostSpellRangeMin` | #1 : -#3 Portée minimale | spell_modifier/deboost | spellId=diceNum; value=value; duration=duration | 2 (0) | P2 | Ardeur Estivale (28653) d=14381,0 v=1 dur=-1 P1 m=C,*E2130 t=I |
| 296 | `DeboostSpellApCost` | #1 : +#3 PA | spell_modifier/boost | spellId=diceNum; value=value; duration=duration | 14 (6) | P1 | Paume Explosive (12781) d=12781,0 v=1 dur=1 P1 m=C t=I |
| 297 | `DeboostOccupiedCell` | #1 : case occupée nécessaire désactivée | spell_modifier/set | spellId=diceNum; value=value; duration=duration | 5 (0) | P2 | Karcham (12832) d=12787,0 v=1 dur=-1 P1 m=C,*E3583 t=I |
| 299 | `BoostFreeCell` | #1 : case libre nécessaire activée | spell_modifier/set | spellId=diceNum; value=value; duration=duration | 6 (0) | P2 | Karcham (12832) d=12787,0 v=1 dur=-1 P1 m=C,*E3583 t=I |
| 314 | `BoostOccupiedCell` | #1 : case occupée nécessaire activée | spell_modifier/set | spellId=diceNum; value=value; duration=duration | 17 (0) | P2 | Lucioles (28935) d=25746,0 v=1 dur=-1 P1 m=C t=I |
| 798 | `BoostVisibleTargetOnCellOn` | #1 : cible visible nécessaire activée | spell_modifier/set | spellId=diceNum; value=value; duration=duration | 5 (0) | P2 | Empreinte (32401) d=13697,0 v=1 dur=1 P1 m=C,*e6956 t=I |
| 1036 | `CharacterRemoveSpellCooldown` | #1 : -#3 tour(s) de relance | cooldown/reduce_cooldown | spellId=diceNum; turns=value | 26 (4) | P1 | Appel de la Meute (14357) d=13774,0 v=1 dur=0 P1 m=C t=I |
| 1045 | `CharacterSetSpellCooldown` | #1 : relance fixée à #3 tour(s) | cooldown/set_cooldown | spellId=diceNum; turns=value | 67 (16) | P0 | Paradoxe (13250) d=13287,0 v=1 dur=0 P1 m=C t=I |
| 2905 | `SetSpellRangeMax` | #1 : Portée maximale fixée à #3 | spell_modifier/set | spellId=diceNum; value=value; duration=duration | 34 (0) | P2 | Marée (29129) d=13820,0 v=0 dur=1 P1 m=C,*e5307 t=I |
| 2906 | `SetSpellRangeMin` | #1 : Portée minimale fixée à #3 | spell_modifier/set | spellId=diceNum; value=value; duration=duration | 16 (0) | P2 | Marée (29129) d=13820,0 v=0 dur=1 P1 m=C,*e5307 t=I |
| 2935 | `BoostSpellBaseHeal` | #1 : +#3 soins de base | spell_modifier/boost | spellId=diceNum; value=value; duration=duration | 39 (4) | P1 | Chœur Strident (25861) d=25861,0 v=5 dur=-1 P1 m=C t=I |

#### Dissipation

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 406 | `CharacterDispellSpell` | Enlève les effets du sort #2 | dispel/remove_spell_effects | spellId=value | 661 (169) | P0 | Petit poison (5020) d=0,0 v=5021 dur=0 P1 m=C t=I |
| 1075 | `CharacterShortenActiveEffectsDuration` | Durée des effets : -X | dispel/shorten_durations | turns=diceNum | 81 (54) | P0 | Heuristique (5068) d=2,0 v=0 dur=0 P1 m=A t=I |
| 1406 | `CharacterDispellSpellLevel` | Enlève les effets du rang #1 du sort #2 | dispel/remove_spell_level_effects | spellId=value; grade=diceSide | 8 (6) | P1 | Aiguille (13244) d=0,6 v=30842 dur=0 P1 m=a,A t=I |

#### Visuels / neutres

| id | actionId | libellé DofusDB | type | paramètres | occ. (classe) | prio | exemple |
|---|---|---|---|---|---|---|---|
| 149 | `CharacterChangeLook` | Change l'apparence | visual/change_look | lookId=value | 44 (0) | P2 | Alchi-Rhétorique (25797) d=0,0 v=2164 dur=-1 P1 m=a,P,F7371,e4174 t=I |
| 333 | `CharacterChangeColor` | Change une couleur | visual/change_color | colorIndex=diceNum; color=diceSide/value | 3 (2) | P1 | Berserk (12743) d=1,3170 v=258 dur=-1 P1 m=C,e1803 t=I |
| 335 | `CharacterAddAppearance` | Change l'apparence | visual/add_appearance | appearanceId=value | 43 (22) | P1 | Scaphandre (13819) d=0,0 v=1035 dur=2 P1 m=C t=I |
| 666 | `Noop` | Pas d'effet supplémentaire | noop/noop |  | 453 (0) | P0 | Combo (20500) d=0,0 v=0 dur=0 P1 m=C t=I |
| 1060 | `CharacterAddScaleFlat` | Taille : X | visual/scale_flat | scale=diceNum | 51 (0) | P2 | Combo (20500) d=120,0 v=0 dur=-1 P1 m=C t=I |
| 2868 | `CharacterAddScalePercent` | Taille : +X% | visual/scale_percent | scalePercent=diceNum | 2 (0) | P2 | Gobgobage (31377) d=10,0 v=0 dur=-1 P1 m=C t=I |
| 3792 | `ExecuteSpellScriptUsage` | ExecuteSpellScriptUsage | visual/script_usage | boundScriptUsageId=value | 292 (282) | P0 | Propulsion (12788) d=0,0 v=20179 dur=0 P1 m=C t=I |
| 3793 | `ExecuteSpellScriptUsageOnTarget` | ExecuteSpellScriptUsageOnTarget | visual/script_usage_on_target | boundScriptUsageId=value | 177 (97) | P0 | Fermentation (12819) d=0,0 v=20171 dur=0 P1 m=a t=I |

⚠ = entrée comportant un point **INCERTAIN** (voir champ `uncertain` du JSON).

<!-- CATALOGUE:END -->

---

## 12. Questions ouvertes / INCERTAIN

- `CMPARR` vs `CCMPARR` : interprétation « PM utilisés par le lanceur » vs « par le porteur » déduite des
  descriptions ; le code client ne la documente pas (OTOMAI les compare juste textuellement).
- Préfixe `X` des déclencheurs (`XD`, `XPD`…) : « valable aussi si le porteur meurt » — **INCERTAIN** : OTOMAI
  ne gère aucun code `X<code>` (seul `X` exact est accepté sur une cible morte) ; le sens est déduit de cette
  asymétrie et de l'appariement systématique `D|XD`.
- `DV`, `DTB`, `DTE`, `PMD`, `PPD`, `CPT`, `PO`, `CT` : sens déduit, à confirmer en jeu. `CT` (tacle) apparaît
  **une fois** dans le corpus re-crawlé (Grimace, sort de départ du Masque Grimaçant du Zobal ; la 1re version
  affirmait l'inverse car les sorts de départ des invocations n'étaient pas crawlés). Les codes Dofus 2
  `DC`, `MD`, `ML`, `MP`, `A`, `m` (D2CLIENT `verifyEffectTrigger`) n'apparaissent pas.
- Masques `x`, `u`, `PB/pb`, `PR/pr` : sens partiellement déduit.
- `diceNum` de l'effet 4 (téléportation) : non utilisé par OTOMAI (valeurs 1, 2, 4, 5, 10, 63).
- `value` des invocations 181 (nombre max d'invocations multiples ?).
- Formes `F` et `R` (Dofus 3) : géométrie à valider sur des cas réels (OTOMAI `FillForkCells`,
  `FillRectangleCells`).
- 265 (réduction fixe) : niveau du porteur ou du lanceur dans `× (1 + niveau/20)`.
- 1092/1096 (dommages % PV érodés de la cible) : divergence du port OTOMAI (utilise le % d'érosion).
- 1013/1016 (dommages selon PM restants) : formule lue dans OTOMAI (`× PM_restants/(PM_restants + PM_utilisés)`),
  reste à confirmer en jeu quand les PM max changent pendant le tour.
- 780 (résurrection) : % de PV (description 20–30 % vs OTOMAI 50 %), case d'arrivée, rôle de la zone `C63,3`.
- 140 (tour annulé) : moment exact du saut de tour et décompte de la durée.
- 1165 (glyphe immédiat) : moment exact de déclenchement.
- Les monstres ont plusieurs grades (`monster.grades`, `spellGrades`) : seules les données de grade de
  sort 1 ont été décodées ici pour Vortex.

## 13. Sources

- API DofusDB : https://api.dofusdb.fr (spell-levels, spells, spell-variants, effects, spell-states, monsters, characteristics) — consulté le 2026-10-04.
- OTOMAI (port C# du calculateur Dofus 3) : https://github.com/OtomAICLIP/otomai — `libs/Bubble.DamageCalculation/*` (copie `.cache/domath/haxe/`), `libs/Bubble.Core.Datacenter/Datacenter/Effects/ActionId.cs`.
- PyDofus3 (enum ActionId Dofus 3) : https://github.com/PyDofus/pydofus3 `pydofus3/generated/pydantic/Core/DataCenter/Metadata/Effect/ActionId.py` (copie `.cache/effects/ref/`).
- Client Dofus 2 décompilé : https://github.com/Romain-P/d2gen — `DamageUtil.as`, `SpellZoneManager.as`, `BuffManager.as`, `BasicBuff.as`, `TriggeredBuff.as`, `FightBattleFrame.as`, `jerakine/types/zones/*.as`, `FightDispellableEnum.as` (copies `.cache/domath/d2client/`, `.cache/effects/ref/`).
- Formule d'esquive PA/PM : `.cache/domath/other/otomai.FightActor.cs`, `.cache/domath/other/giny.Fighter.cs`.
- Runes Huppermage : https://dofus.jeuxonline.info/article/14143/rune-huppermage
- DoMath : https://domath.fr (bundle `main.e2dd4684.js` v1.3.3, extrait `.cache/domath/extract/domath-literal.cjs`).
- OTOMAI, points vérifiés lors de la relecture : `DamageCalculator.SolveSpellExecution` (lanceur/cible des
  sous-sorts, « source »), `DamageSender.GetTotalDamage` (1013/1016, splash 1123/1223), `HaxeBuff` (codes de
  déclencheurs, `TurnDuration`), `SpellManager` (masques), `SpellZone.GetAoeMalus`, `FightContext.GetPortalBonus`,
  `HaxeFighter.GetDamageReductor` (265), `DamageReceiver.GetPermanentDamage` (érosion), `Teleport.cs` (784).

---

## 14. Vérification (relecture adversariale, 2026-10-04)

**Ce qui a été vérifié**
- **Extraction** : 16 spell-levels (14 tirés au hasard + Morfaille 22954 + Vortexiphan 22886) comparés champ par
  champ à l'API live `api.dofusdb.fr/spell-levels/<id>` (coût, portée, `statesCriterion`, `effects`,
  `criticalEffect`, `zoneDescr`) : **0 écart**. Totaux API : 19 classes (`/breeds`), 872 effets (`/effects` =
  `effects_all.json`), 418 variantes de sorts de classe (les 13 autres `spell-variants` appartiennent au breedId 19,
  absent de `/breeds`) ⇒ 836 sorts de classe complets. 40 exemples du JSON re-contrôlés contre le corpus : 0 écart.
  Références pendantes : 4 sous-sorts (13692, 13735, 13737, 13739) et 4 monstres (4258–4261) cités par des effets
  n'existent pas dans l'API (total 0) — non crawlables, sans impact.
- **Code** : formules et règles re-dérivées des sources (OTOMAI `.cache/domath/haxe/`, D2CLIENT, DoMath) :
  jet d'esquive PA/PM, dégressivité (`GetAoeMalus`, 7 vecteurs recalculés : L3 → 100/90/80/70 %, C2,1 → 100/90 %,
  C2 → 100/90/80 %, `+1` diagonale → 90 %, G1 → 90 %, C63 → 100 %, `a` → 100 %), boucliers 1020/1039/1040
  (240 % × niv. 200 = 480), armure 265 (12 × (1 + 200/20) = 132, niveau du **porteur** dans OTOMAI), vol de vie
  ×0,5, érosion (plafond 50 %, PV − 1), portails (0 + 2 %/case), groupes aléatoires (`RandomGroup.cs`), masques
  (`SpellManager`), ciblage préalable et conditions `*` (`TargetManagement.GetTargets`), codes de déclencheurs
  (`HaxeBuff`), décompte des durées (`BuffManager`/`FightBattleFrame`), `FightDispellableEnum`
  (`BasicBuff.canBeDispell`), coordonnées/directions (`MapTools`). Sorts des 6 monstres Vortex re-décodés depuis
  les données (grade 1).

**Ce qui a été corrigé**
1. **Sorties périmées** : le corpus avait été re-crawlé après la génération (correctif `crawl.py` :
   `startingSpellId` est un id de *spell-level*), mais le JSON/MD décrivaient encore l'ancien corpus
   (1 729 sorts, 212 effets). Régénération complète : **1 838 sorts, 3 987 spell-levels, 218 effectId**,
   84 effets P0 ; compteurs des § 0, 4.2, 6 et 10 mis à jour.
2. **6 effectId manquants** ajoutés à `semantics_table.py` / JSON / catalogue : **140** (tour annulé),
   **780** (résurrection), **784** (retour à la case de début de combat), **1123** (renvoi des dommages
   initiaux), **295** (−portée min d'un sort), **1018** (la source lance un sort sur la cible). Les quatre
   premiers sont utilisés par la mécanique du donjon Vortex (sous-section ajoutée au § 9).
3. **Sous-sorts « source »** (1017/2017/1019 + 1018) : la « source » est l'entité **déclencheuse** quand
   l'effet est déclenché (OTOMAI `SolveSpellExecution`), pas toujours le lanceur (§ 2.5, JSON).
4. **1013/1016** : formule lue dans OTOMAI (boost normal puis × PM restants / (PM restants + PM utilisés)) —
   n'est plus « INCERTAINE » que pour les cas limites.
5. **Esquive PA/PM** : Giny n'est **pas** identique à OTOMAI (dénominateur et plafond PM différents).
6. **`dispellable 2`** : retiré à la mort **et** par désenvoûtement fort (D2CLIENT `canBeDispell`).
7. **Bonus `TB` d'OTOMAI** : précisé qu'il ne doit pas être cumulé avec la règle de décompte D2CLIENT.
8. **Masques recalculés** : `V#`/`v#` ne déclenchent pas de recalcul dans OTOMAI (égalité exacte de jeton).
9. **Déclencheur `CT`** (tacle) : présent une fois (Grimace, Masque Grimaçant) — la 1re version affirmait le
   contraire ; ajouté au tableau § 6 et à la grammaire. Forme de zone `;` (liste de cases) désormais observée
   (25 effets). Masque `*h` documenté dans la grammaire.
10. **Vortex** : *Morfaille* était aussi `HS!236` et 1/cible, Neutre/Eau ne touchent pas la cible (anneau),
    la répétition au tour suivant existe **aussi en coup critique** ; *Contamination zombie* vise un **allié**
    Zombi et rend Insoignables les **ennemis** autour ; *Topkaj* : poids par effet (16,67 %) ≠ poids par groupe
    (33,3 %).
11. `crawl.py` : 1018 et 3026 ajoutés aux effets « id de sort dans diceNum » ; `build_semantics.py` : Auroraire
    3833 comptée comme monstre du donjon (drapeau `usedByVortexDungeon`).

**Désaccords non résolus avec d'autres livrables** : `docs/research/vortex.md` affirme que la version critique
de *Morfaille* n'a pas la répétition différée — faux d'après DofusDB (spell-level 22954, `criticalEffect` contient
`1160 5069 delay 1`, vérifié en live). `.cache/vortex/scripts/build_json.py` interprète `dispellable` 2/3
différemment (« non désenvoûtable » / « persistant ») de `FightDispellableEnum` utilisé ici.

