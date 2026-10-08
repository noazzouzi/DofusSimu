# API DofusDB — schéma, champs utiles et extraction reproductible

> Source : API publique **DofusDB** `https://api.dofusdb.fr` (données extraites des fichiers du client Dofus 3 / Unity).
> Exploration réalisée le 2026-10-04. Les enregistrements portent `createdAt` 2026-03-03 et `updatedAt` jusqu'à
> 2026-07-21 (ex. monstre 3835), donc données ≈ version du jeu de l'été 2026.
> Script : [`scripts/fetch-dofusdb.mjs`](../../scripts/fetch-dofusdb.mjs) — sorties : [`data/dofusdb/`](../../data/dofusdb/).
> **Mise à jour 3.7 (2026-10-06)** : l'API a renommé les champs des grades de monstres ; les données du dépôt restent
> celles du 2026-10-04 (3.6). Correspondances, garde-fous et procédure de ré-extraction : §10.
>
> Convention : **INCERTAIN** = interprétation non confirmée par une source primaire (meilleure estimation donnée).

## 1. Utilisation de l'API (FeathersJS)

| Élément | Syntaxe | Remarques |
|---|---|---|
| Liste | `GET /<service>?$limit=50&$skip=0` | Réponse `{total, limit, skip, data:[...]}`. **`$limit` plafonné à 50** (une valeur de 100 renvoie 50). |
| Un enregistrement | `GET /<service>/<id>` | 404 `{"name":"NotFound",...}` si absent. |
| Tri | `$sort[id]=1` | Indispensable pour une pagination stable. |
| Sélection | `$select[]=id&$select[]=name` | Réduit fortement la taille (ex. `monsters` sans `drops`). `_id` est toujours renvoyé. |
| Filtre égalité | `?breedId=8`, `?typeId=1`, `?spellId=5068` | |
| Filtre liste | `?id[$in][]=1&id[$in][]=2` | Utilisé par paquets de 50 ids. Avec curl, utiliser `-g` (crochets). |
| Autres opérateurs | `$ne`, `$gt`, `$lt`… (Feathers standard) | |
| Champs localisés | `{id, fr, en, de, es, pt}` | `{"id":"0"}` = texte vide. Le script ne garde que `{fr, en}`. |
| Images | `https://api.dofusdb.fr/img/{spells,items,monsters,maps,breeds}/…` | Cartes : `img/maps/{1,0.75,0.5,0.25}/<mapId>.jpg` ; monstres : `img/monsters/<gfxId>.png`. |

Node 22 : `fetch` natif ne passe par le proxy qu'avec `NODE_USE_ENV_PROXY=1` (le script l'exige, cf. `npm run fetch:data`).
Le site `dofusdb.fr` (SPA Vue/Quasar) n'expose **aucune donnée de cellules de carte** : le service `maps` existe mais
renvoie `total: 0`, et le front n'utilise que les images `img/maps/...` (vérifié en parcourant ses 150 chunks JS).

### Volumétrie (totaux API au 2026-10-04)

| Service | total | | Service | total |
|---|---|---|---|---|
| `breeds` | 19 | | `items` | 21 776 |
| `breed-roles` | 8 | | `item-types` | 239 |
| `spell-variants` | 431 | | `item-super-types` | 26 |
| `spells` | 17 067 | | `item-sets` | 931 |
| `spell-levels` | 34 697 | | `monsters` | 5 135 |
| `spell-states` | 6 375 | | `monster-races` / `monster-super-races` | 265 / 35 |
| `spell-types` | 3 260 | | `dungeons` | 187 |
| `effects` | 872 | | `map-positions` | 15 363 |
| `characteristics` | 123 | | `subareas` / `areas` | 562 / 69 |
| `achievements` | 2 780 | | `achievement-objectives` | 8 948 |
| `challenges` | 842 | | `mounts` | 266 |
| `spell-pairs` | 726 | | `idols` / `finish-moves` / `map-references` | 90 / 27 / 572 |

Services inexistants (404) : `criterions`, `item-sub-types`, `breed-spells`, `spell-scripts`, `map`, `map-data`,
`world-maps`, `spell-bombs`.

## 2. Classes et sorts

### 2.1 `breeds` (19 classes)

Ids : 1 Féca, 2 Osamodas, 3 Enutrof, 4 Sram, 5 Xélor, 6 Ecaflip, 7 Eniripsa, 8 Iop, 9 Crâ, 10 Sadida, 11 Sacrieur,
12 Pandawa, 13 Roublard, 14 Zobal, 15 Steamer, 16 Eliotrope, 17 Huppermage, 18 Ouginak, **20 Forgelance**
(l'id 19 n'existe pas).

Champs utiles : `shortName`, `description`, `gameplayDescription` (« Guerrier téméraire »…), `complexity`,
`sortIndex`, `breedRoles[] {roleId, value, order, description}` (value = note du rôle ; `order >= 0` pour les rôles
mis en avant), `statsPointsForStrength|Intelligence|Chance|Agility|Vitality|Wisdom` (paliers de coût des points de
caractéristique : `[[0,1],[100,2],[200,3],[300,4]]` = 1 point/pt jusqu'à 100, puis 2…; sagesse `[[0,3]]`),
**`breedSpellsId`** (22 ids de sorts, un par paire). Ignorés : `maleLook`, `femaleLook`, couleurs, `creatureBonesId`, images.

`breed-roles` : 1 Entrave, 2 Tank, 3 Protection, 4 Soins, 5 Dégâts, 6 Placement, 7 Invocation, 8 Amélioration.
Exemple : Enutrof (3) a le rôle Entrave à 8 ; Iop (8) Dégâts à 12 ; Pandawa (12) Placement à 12.

### 2.2 Lien classe → sorts : `breedSpellsId` + `spell-variants`

- `spell-variants` : `{id, breedId, spellIds:[spellA, spellB]}` = une **paire** de sorts mutuellement exclusifs
  (le joueur choisit l'un des deux). Les variantes sont aussi renvoyées avec les sorts complets embarqués (`spells`).
- `breeds[].breedSpellsId` liste **22 sorts** (un par paire), dans l'ordre d'affichage du jeu. Pour chaque id, la
  variante qui le contient donne le second sort. 19 classes × 22 paires × 2 = **836 sorts de classe** ; **Iop = 44 sorts**.
- Le sort listé dans `breedSpellsId` est la variante « de base » ; pour les 19 classes, la variante 0 de la
  paire k se débloque au niveau 1 (paires 0-3) puis 5, 10, …, 90 (+5 par paire), la variante 1 au niveau 95 + 5k
  (95 → 200) (`spell-levels[].minPlayerLevel` du grade 1) — **sauf Crâ** : variantes 1 des paires 2 et 3 inversées
  (110 puis 105). Ne pas recalculer le niveau à partir de l'index : utiliser `breeds.json.spellPairUnlockLevels`.
  Ex. Iop : paire 0 = Pression (niv. 1) / Fracture (niv. 95), …, paire 21 = Fureur (niv. 90) / Colère de Iop (niv. 200).
- 13 variantes ont `breedId: 19` (classe inexistante) : ignorées, listées dans `breeds.json.unassignedSpellVariants`.
- `spells[].typeId` vaut l'id de classe **seulement pour la variante 0 des classes 1-18** (`spell-types/8` = « Iop ») ;
  les variantes 1 ont un type « Variantes <classe> » (ex. 592 Variantes Féca, 598 Iop) et la Forgelance utilise
  2374/2376. Pour rattacher un sort à sa classe, utiliser `class-spells.json.spells[].breedId`, pas `typeId`.
  425 = « _VRAC » (fourre-tout utilisé par beaucoup de sorts de monstres).
- `spell-pairs` (726) n'est **pas** la table des variantes : ce sont des bonus de « paires » (ex. id 8 « Distance mesurée »).
  **INCERTAIN** : probablement un mode de jeu annexe ; non extrait.

### 2.3 `spells`

`{id, name, description, typeId, order, iconId, spellLevels:[ids de spell-levels], scriptParams, scriptId,
scriptIdCritical, boundScriptUsageData, criticalHitBoundScriptUsageData, basePreviewZoneDescr, adminName,
verboseCast, bypassSummoningLimit, canAlwaysTriggerSpells, hideCastConditions}`.
Les `script*` / `boundScriptUsageData` décrivent l'**animation** (FX) et ne sont pas extraits.
Un sort de classe a typiquement 1 à 3 grades ; un sort de monstre a 1 grade par grade de monstre utilisé (jusqu'à 6+).

### 2.4 `spell-levels` (grades)

Un enregistrement par grade : `id, spellId, grade, spellBreed, apCost, minRange, range, rangeCanBeBoosted,
castInLine, castInDiagonal, castTestLos, needFreeCell, needTakenCell, needFreeTrapCell, needVisibleEntity,
needCellWithoutPortal, portalProjectionForbidden, criticalHitProbability, maxStack, maxCastPerTurn,
maxCastPerTarget, maxGlobalCastPerTurn, maxGlobalCastPerTarget, minCastInterval (= relance en tours),
initialCooldown, globalCooldown, minPlayerLevel, statesCriterion, effects[], criticalEffect[], previewZones[],
hideEffects, hidden, playAnimation`.

- `statesCriterion` : condition d'état du lanceur, ex. `"HS!236"` (les sorts Heuristique 5068 et Morfaille 5070 de Vortex ne
  sont lançables que si le lanceur n'a **pas** l'état 236 « Marginal », Contamination zombie 5064 seulement s'il **l'a**
  : `HS=236`) ; grammaire `HS=x` / `HS!x` (a / n'a pas l'état x), combinaisons `&` `|` **et parenthèses**
  (ex. `HS=3360|HS=3589`, motifs `(…|…)&…`, `…|(…&…&…)` observés). Le plus fréquent : `HS!7` (192 grades extraits).
- `maxStack` : cumul max. des effets du sort sur une cible (-1 = illimité). **INCERTAIN** pour la valeur 0.
- `criticalEffect` est une liste **complète** d'effets (pas un delta) : en cas de coup critique, on applique cette liste
  à la place de `effects`.

### 2.5 Effets de sort (`EffectInstanceDice`)

Champs : `effectId` (→ `effects`), `effectUid`, `baseEffectId`, `order`, `diceNum`, `diceSide`, `value`, `duration`
(tours, -1 = infini), `delay`, `random` (% de chance si > 0), `group`, `modificator`, `dispellable`, `targetId`,
`targetMask`, `triggers`,
`effectElement`, `effectTriggerDuration`, `spellId`, `zoneDescr`, `displayZero`, `visibleInTooltip`,
`visibleInBuffUi`, `visibleInFightLog`, `visibleOnTerrain`, `forClientOnly`, `trigger`, `m_flags`.

- Valeurs : dégâts « 16 à 18 » ⇒ `diceNum=16, diceSide=18` ; valeur fixe ⇒ `diceNum=x, diceSide=0`. `value` sert de
  paramètre #3 (ex. id d'état pour 950).
- `dispellable` : valeurs observées 1 (26 083 effets), 3 (8 805), 2 (3 621). Meilleure estimation (énumération
  `FightDispellableEnum` de Dofus 2) : 1 = désenvoûtable, 2 = désenvoûtable seulement par un désenvoûtement « fort »,
  3 = retiré seulement à la mort, 4 = jamais — **INCERTAIN**.
- `triggers` : `"I"` = immédiat (34 758 effets) ; sinon déclencheurs de buff séparés par `|`. Les plus fréquents :
  `TB` (806, début de tour), `D` (594, dommages subis), `TE` (541, fin de tour), `X` (267), `H` (131), `DM` (107),
  `DR` (74), `DF`/`DW`/`DA`/`DE`/`DN` (≈65 chacun, dommages subis par élément), `MPA` (55), `PD` (40), `P`, `M`…
  Sens supposés : M = déplacement, P = poussée, DM/DR = dommages mêlée/distance, X = mort — **INCERTAIN** ; la
  grammaire complète relève de la doc effets/zones.
- `targetMask` : liste séparée par des virgules ; minuscule = alliés, majuscule = ennemis (`a,A` = tous) ; `c`/`C` =
  lanceur ; `g` (692), `h,P`, `L`, `J`, `T`, `U`, `O` (types d'entités) ; conditions `E<état>` (a l'état), `e<état>`
  (n'a pas l'état), `*E<état>` (condition portant sur le lanceur), `F<monstre>` (famille/id de monstre). Ex.
  `c,E234` = le lanceur s'il a l'état 234. Masques les plus fréquents : `C` 7 914, `A` 7 204, `a,A` 6 700, `a` 1 846.
  **INCERTAIN** sur le détail de chaque lettre.
- `zoneDescr` (Dofus 3 remplace l'ancien `rawZone` texte par un objet) :
  `{shape, param1, param2, damageDecreaseStepPercent, maxDamageDecreaseApplyCount, isStopAtTarget, forcedDirection,
  includeCarried, onlyAffectIfInSightLine, cellIds}` où `shape` est un **code de caractère** (80 = `P`, 67 = `C`…).
  Formes rencontrées dans les sorts extraits (nb. d'effets) : P 36 148, C 5 191, a 2 768, X 2 676, Q 809, A 793,
  L 661, `;` 589, G 539, V 308, T 295, `+` 242, l 198, `*` 181, O 171, U 146, I 74, `#` 63, F 50, B 38, D 27, R 19,
  `-` 12, `/` 12, W 9, Z 1. Sens usuels (hérités de Dofus 2) : P point, C cercle (losange de rayon param1, param2 =
  rayon min.), X croix, L ligne, T ligne perpendiculaire, O anneau, Q croix creuse, G carré, U demi-cercle, V cône,
  `#` croix diagonale, `+` étoile, `/` diagonale, `-` perpendiculaire, A/a toute la carte. **INCERTAIN** pour `;`,
  `l`, `*`, I, F, B, R, W, Z, D.
  `damageDecreaseStepPercent` / `maxDamageDecreaseApplyCount` = dégressivité par cellule d'éloignement du centre
  (ex. 10 % par case, max 4 fois).

### 2.6 Effets qui référencent d'autres sorts / monstres / états

Indispensable pour simuler glyphes, pièges, invocations, sorts déclenchés. Déterminé empiriquement (taux de
correspondance des paramètres avec des ids existants) puis codé dans le script (`manifest.json.spellRefEffects`) :

| Rôle | effectId | Paramètre |
|---|---|---|
| Lance / déclenche un sort (description « #1 ») | 792, 793, 1017, 1018, 1019, 1160, 1175, 1187, 2017, 2160, 2792, 2793, 2794, 2795, 2960 (+237, 814, 1084, 1161, 2880 non observés) | `diceNum` = sort, `diceSide` = grade |
| Piège / glyphe / glyphe-aura / glyphe-prison / rune | 400, 401, 402, 1165, 1091, 4040, 2022 | `diceNum` = sort, `diceSide` = grade |
| Dissipe les glyphes d'un sort | 2018 | `diceNum` = sort |
| Déclenche les glyphes | 1026 | `value` = sort |
| Ajoute un sort temporaire | 722, 2997 | `value` = sort, `diceSide` = grade (ex. Dofus Verdoyant, Épée Nécronyx, bonus de la Panoplie du Vampyre maudit) |
| Enlève les effets d'un sort | 406 (« … du sort #2 »), 1406 (« … du rang #1 du sort #2 ») | **`value` = sort** (406 : 1 139/1 164 valeurs = sorts existants, `diceSide` toujours 0) ; 1406 : `diceSide` = rang/grade (1-6). Le gabarit « #2 » est trompeur (corrigé le 2026-10-04, cf. §9) |
| Pose un portail (Eliotrope) | 1181 | `diceSide` = **id de spell-level** (44338 → sort 14573) |
| Modificateurs de sort (« #1 : +#3 Portée »…) | catégorie 3 : 280-299, 314, 798, 799, 2905-2935, 3281-3296, 3333, 3935 ; + 1035, 1036, 1045, 4052 (relance) | `diceNum` = sort modifié, `value` = valeur |
| Invocation | 181, 1011 (invocation), 1008 (bombe), 405 / 2796 (tue la cible et la remplace par l'invocation) | `diceNum` = monstre, `diceSide` = grade |
| Double / résurrection | 180, 1189 (double du lanceur) ; 780, 1034 (invoque le dernier allié mort, `diceNum` = % PV) | pas d'id de monstre |
| États | 950 (ajoute), 951 (enlève), 952 (désactive) | `value` = état (`spell-states`) |

### 2.7 `spell-states` (6 375)

`{id, name, preventsSpellCast, preventsFight, isSilent, cantBeMoved, cantBePushed, cantDealDamage, invulnerable,
cantSwitchPosition, incurable, invulnerableMelee, invulnerableRange, cantTackle, cantBeTackled,
displayTurnRemaining, isMainState, effectsIds, icon, iconVisibilityMask}`.
Exemples : 56 Invulnérable (`invulnerable`), 97 Indéplaçable (`cantBeMoved`), 218 Pacifiste (`cantDealDamage`),
236 Marginal (`isSilent`). `effectsIds` : liste d'ids d'« effets d'état » internes (56→[7], 97→[3,17], 218→[6]) —
**INCERTAIN** (énumération client non exposée).

## 3. Tables de référence

### 3.1 `effects` (872)

`{id, description (gabarit « #1{{~1~2 à }}#2 Force »), theoreticalDescription, characteristic, category,
characteristicOperator ('+', '-', '/', ''), elementId, useDice, forceMinMax, boost, active, oppositeId, bonusType
(1 bonus, -1 malus, 0 autre), isInPercent, useInFight, showInTooltip, showInSet, hideValueInTooltip, parametersFixed,
effectPriority, effectPowerRate, theoreticalPattern, effectTriggerDuration, actionFiltersId, textIconReferenceId}`.

- `category` : 0 caractéristique/divers, 1 résistances, 2 dégâts/soins/vols d'arme et de sort, 3 modificateurs de sort,
  5-7 cosmétique/technique (**INCERTAIN** pour 4-7 ; 6 = effets de monture).
- `oppositeId` : effet inverse (111 +PA ↔ 168 -PA).
- **`effectPowerRate` = poids de rune de forgemagie** (utile pour les exos et le « puits ») : PA 100, PM 90, PO 51,
  Invocation 30, Dommages 20, % Dommages mêlée/distance/armes/sorts 15, % Critique 10, Soins 10, % Rés. mêlée/distance 10,
  Esquive PA/PM 7, Retrait PA/PM 7, % Rés. élémentaire 6, Dommages élémentaires/Poussée/Critiques/Pièges/Renvoi 5,
  Fuite/Tacle 4, Sagesse 3, Prospection 3, Puissance 2, Rés. fixes (élém., poussée, critiques) 2, Force/Intel/Chance/Agi 1,
  Vitalité 0.2, Initiative 0.1. Ces valeurs coïncident avec le tableau des poids de runes de JOL
  (<https://dofus.jeuxonline.info/article/3736/forgemagie> : Vi 1 pour 5, stats 1, Ini 1 pour 10, Sa 3, Pui 2, Ré fixe 2,
  Ré PA/PM 7, Ret PA/PM 7, Ré poussée/crit 2, Fui/Tac 4, Prospe 3, Do élém. 5, Do poussée/pièges 5, Renvoi 5, Cri 10,
  Soins 10, Do 20). Les effets **négatifs** ont un `effectPowerRate` négatif égal à la moitié (ex. 168 -PA : -50,
  2813 -% dommages sorts : -7.5) — utile pour le calcul de puits.

Effets d'équipement les plus courants (id → caractéristique) :

| effectId | Stat | charac. | | effectId | Stat | charac. |
|---|---|---|---|---|---|---|
| 111 / 168 | ±PA | 1 | | 210/211/212/213/214 | % rés. Terre/Eau/Air/Feu/Neutre | 33/35/36/34/37 |
| 128 / 169 | ±PM | 23 | | 240/241/242/243/244 | rés. fixe Terre/Eau/Air/Feu/Neutre | 54/56/57/55/58 |
| 117 / 116 | ±Portée | 19 | | 422/424/426/428/430 | dommages Terre/Feu/Eau/Air/Neutre | 88-92 |
| 182 | Invocations | 26 | | 414 / 416 | dommages / rés. poussée | 84 / 85 |
| 112 | Dommages | 16 | | 418 / 420 | dommages / rés. critiques | 86 / 87 |
| 138 | Puissance | 25 | | 410 / 412 | retrait PA / PM | 82 / 83 |
| 115 | % Critique | 18 | | 160 / 161 | esquive PA / PM | 27 / 28 |
| 118/126/123/119 | Force/Intel/Chance/Agi | 10/15/13/14 | | 752 / 753 | fuite / tacle | 78 / 79 |
| 125 | Vitalité | 11 | | 174 / 176 / 178 | initiative / prospection / soins | 44 / 48 / 49 |
| 124 | Sagesse | 12 | | 2800/2804/2808/2812 | % dommages mêlée/distance/armes/sorts | 125/120/122/123 |
| 220 | renvoi | 50 | | 2803/2807 | % rés. mêlée/distance | 124/121 |

Dégâts d'arme : 96 Eau, 97 Terre, 98 Air, 99 Feu, 100 Neutre ; vols de vie 91-95 ; soins 108 ; 2822 « dommages du
meilleur élément ». Négatifs : 152-157 (stats), 215-219 (% rés.), 171 (% crit)…

### 3.2 `characteristics` (123)

`{id, keyword, name, categoryId, visible, order, upgradable, scaleFormulaId, asset}`. Ex. 0 hitPoints, 1 actionPoints,
10 strength, 11 vitality, 12 wisdom, 13 chance, 14 agility, 15 intelligence, 16 allDamageBonus, 18 criticalHit,
19 range, 23 movementPoints, 25 damagePercent (puissance), 26 maxSummonedCreaturesBoost, 33-37 % rés.,
44 initiative, 54-58 rés. fixes, 75 permanentDamagePercent (érosion), 78 tackleEvade, 79 tackleBlock, 82/83 retrait
PA/PM, 84/85 poussée, 86/87 critiques, 88-92 dommages élémentaires, 96 shield, 98 damagePercentSpell,
120-125 multiplicateurs distance/armes/sorts/mêlée, 150 allDamageMultiplier.

## 4. Objets

### 4.1 `item-super-types` / `item-types` → emplacements

`item-super-types[].positions` = positions d'inventaire du client : 0 amulette, 1 arme, 2 et 4 anneaux, 3 ceinture,
5 bottes, 6 chapeau, 7 cape, 8 familier/monture, 9-14 Dofus/trophées/prysmaradites, 15 bouclier.

| Emplacement (`slot`) | superTypeId | typeIds | Nb (tous niveaux) |
|---|---|---|---|
| `amulet` | 1 | 1 Amulette | 334 |
| `ring` (×2) | 3 | 9 Anneau | 391 |
| `belt` | 4 | 10 Ceinture | 362 |
| `boots` | 5 | 11 Bottes | 373 |
| `hat` | 10 | 16 Chapeau | 382 |
| `cloak` | 11 | 17 Cape (il n'existe plus de type « sac à dos » distinct) | 311 |
| `shield` | 7 | 82 Bouclier | 129 |
| `weapon` | 2 | 2 Arc, 3 Baguette, 4 Bâton, 5 Dague, 6 Épée, 7 Marteau, 8 Pelle, 19 Hache, 20 Outil, 21 Pioche, 22 Faux, 114 Arme magique, 271 Lance | 769 |
| `dofus` / `trophy` / `prysmaradite` (×6) | 13 | 23 Dofus, 151 Trophée, 217 Prysmaradite | 34 / 261 / 25 |
| `pet` / `petsmount` / `mount` (×1) | 12 | 18 Familier, 121 Montilier, 331 Dragodinde, 332 Muldo, 333 Volkorne (311 « Monture » vide) | 122 / 25 / 308 |

Non extraits : 22 Cosmétiques (apparat, 113 objets vivants), 69 équipement de percepteur, 23 Compagnons (52, types 169).
**Zone des armes** : donnée par `item-types[].rawZone` (et non par le `zoneDescr` des effets, qui vaut toujours `C1`
par défaut) : Bâton `T1,10,1`, Marteau `X1,0,10,1`, Pelle `V1,10,2`, Faux `U1,10,1`, Lance `L3,10,3`, les autres `P`
(format Dofus 2 : forme + taille [, taille min.] [, % dégressif, nb max.]). Recopiée dans `equipment.json` (`weaponZone`).

### 4.2 `items` (ItemData / WeaponData)

Champs utiles : `id, name, typeId, level, itemSetId (-1 = aucune), criterions (conditions de port, ex. "CP<12|CM<6"),
criterionsTarget, possibleEffects[] (EffectInstanceDice : effectId, diceNum, diceSide, value, baseEffectId…),
evolutiveEffectIds (familiers/montures), isLegendary, etheral, exchangeable, twoHanded`, et pour les armes
(`className: "WeaponData"`) `apCost, minRange, range, castInLine, castInDiagonal, castTestLos,
criticalHitProbability, criticalHitBonus, maxCastPerTurn`. DofusDB ajoute `effects[] {from,to,characteristic,
category,elementId,effectId}` (résumé redondant) et embarque `type`. Ignorés : recettes, drops, prix, poids, images.

- Jets : `possibleEffects` donne la plage **min–max** (`diceNum`–`diceSide`, `diceSide=0` ⇒ valeur fixe `diceNum`).
- Sorts portés par des objets : effet **1175** (`diceNum` = sort ; ex. Dofus Pourpre → sort 8395, Émeraude → 8393,
  Turquoise → 5952) et **722** (`value` = sort) → extraits dans `item-spells.json`.
- Bonus d'objets de classe sur les sorts : effets de catégorie 3, `diceNum` = sort, `value` = valeur (ex. Casque
  Keutumedi : 281 sur 13139 Fracture, value 2 ⇒ « Fracture : +2 Portée maximale ») ⇒ index
  `item-spells.json.classSpellModifiers`.
- Montures (types 331-333) : stats fixes dans `possibleEffects` (ex. Dragodinde à Plumes : 400 Vitalité, 40 Renvoi) +
  effets 3829-3845 (capacités de monture, catégorie 6).
- **Exos / forgemagie** : l'API ne décrit pas les règles d'exo (limites +1 PA/PM/PO, overmage, puits). Seuls les
  **poids de runes** sont disponibles (`effects[].effectPowerRate`, §3.1). Les règles devront venir d'une autre
  source (guides forgemagie) — voir la doc stats/optimiseur.

### 4.3 `item-sets` (931, dont 521 non cosmétiques)

`{id, name, items[] (objets complets embarqués), effects[][], possibleEffects[][], bonusIsSecret, isCosmetic, level, typeIds}`.
`possibleEffects[i]` (EffectInstanceDice bruts, comme les objets) = bonus actifs avec **i+1 objets équipés** ;
`possibleEffects[0]` est vide en pratique. Chaque palier est le bonus **total** (il reprend les bonus des paliers
inférieurs) : **ne pas additionner les paliers**. Ex. Panoplie Tue-Mouche (107) : 2 objets → +1 PO, +1 Invocation,
+40 Intelligence, +30 Prospection, +40 Soins, +5 Dommages Feu ; 3 objets → idem + 1 PA ; 4 objets → +1 PA, +1 PO,
+2 Invocations, +50 Intelligence…

`effects[i]` est un **résumé DofusDB** `{from, to, characteristic, category, elementId, effectId}` à **ne pas utiliser** :
il perd `value` (ex. 722 « Ajouter un sort temporaire » → id du sort 8166…8170/10913 de la Panoplie du Vampyre maudit
perdu), il signe les malus (218 « -#1% Résistance Feu » : `from = -20` alors que `diceNum = 20` → double négation si on
applique l'opérateur de l'effet) et il omet certains effets (ex. 10 « Attitude »). Le script lit `possibleEffects`
depuis la vérification (8 paliers non cosmétiques diffèrent du résumé, hors signe/valeur).

## 5. Monstres, donjons, cartes

### 5.1 `monsters` (5 135)

`{id, name, race, gfxId, grades[], spells[], spellGrades[], isBoss, isMiniBoss, isQuestMonster, canPlay, canTackle,
canBePushed, canSwitchPos, canSwitchPosOnTarget, canBeCarried, canUsePortal, useSummonSlot, useBombSlot, summonCost,
tags[], characRatios, scaleGradeRef, subareas, favoriteSubareaId, correspondingMiniBossId, drops[], temporisDrops[],
aggressive*, incompatibleIdols, incompatibleChallenges, soulCaptureForbidden, allIdolsDisabled, useRaceValues, …}`.

- `grades[]` : `{grade, level, lifePoints, actionPoints, movementPoints, vitality, wisdom, strength, intelligence,
  chance, agility, neutral|earth|fire|water|airResistance (en %), paDodge, pmDodge, damageReflect, gradeXp,
  startingSpellId, bonusRange, bonusCharacteristics{lifePoints, strength, …, earthResistance…, tackleEvade,
  tackleBlock, bonusEarthDamage…, aPRemoval}}`. **Aucune résistance fixe** n'est présente dans les grades
  (les monstres ont des % ; d'éventuels bonus passent par `bonusCharacteristics` ou par des sorts/états).
  Schéma 3.6 : depuis la 3.7, les noms ont changé et l'API expose résistances fixes, critiques, poussée, tacle, fuite
  et initiative (§10).
- **`startingSpellId` est un id de `spell-levels`** (pas de `spells`) : sort lancé automatiquement au début du combat
  (états initiaux, invocations…). Ex. Vortex : 22886 → sort 5006 « Vortexiphan » (invulnérable, indéplaçable, -100 PM,
  état Marginal, invoque Auroraire 3833) ; vagues : 22882 → sort 5002 « Glyphe téléporteur ».
- **`spellGrades[i]`** (chaîne `"1,220;1,220;…"`) est aligné sur `spells[i]` ; chaque segment `;` correspond à un grade
  du monstre et vaut `<grade du sort>,<niveau du monstre>` ; `0` = sort indisponible à ce grade. Le script le convertit
  en `[[1,1,1,1,1,1], …]`. Certaines chaînes ont plus de segments que de grades (Vortex : 10 segments pour 6 grades).
- `tags` : étiquettes DofusDB du comportement (`retPM`, `push`, `tp`, `heal`, `boostAP`…) — utiles pour l'IA.
- `characRatios` `[[characteristicId, ratio], …]` et `scaleGradeRef` : **INCERTAIN** — paramètres de mise à l'échelle
  des caractéristiques (probablement pour les invocations ou les donjons modulés : 0 = PV, 10-15 = stats, 19 PO, 23 PM,
  25 puissance).

### 5.2 `dungeons` (187)

`{id, name, optimalPlayerLevel, minLevel, difficulty, mapIds[] (salles de combat dans l'ordre), entranceMapId,
exitMapId, monsters[], bosses[], subarea, achievements[], requiredObjects[{id, quantity}] (clef),
availableInAutomaticGroupSearch, availableInLobby, availableOnKeyring}`.

### 5.3 `subareas`, `map-positions`

- `subareas` : `{id, areaId, name, mapIds[], level, monsters[], dungeonId, associatedZaapMapId, shape, …}`.
- `map-positions` (MapInformationData) : `{id, posX, posY, subAreaId, worldMap, name, outdoor, mapHasTemplate,
  tacticalModeTemplateId, isTransition, capabilityAllow*}`. **Pas de cellules** (sol, LdV, placements) : la
  géométrie de combat doit venir d'une autre source (fichiers de carte du client, ou relevé manuel à partir de l'image).

### 5.4 Succès et challenges

- `achievements` : `{id, name, description, points, level, categoryId, objectiveIds, rewardIds, objectives[]
  (embarqués, avec readableCriterion)}`. La description contient `[challenge,<id>]` pour les succès de challenge.
- `achievement-objectives` : `{id, achievementId, order, criterion, name}` ; critères : `EM>3835,0,d` (avoir tué le
  monstre 3835 en donjon), `EH>332,0` (avoir réussi le challenge 332), `PL>189` (niveau > 189).
- `challenges` : `{id, name, description, categoryId, completionCriterion, activationCriterion, targetMonsterId,
  incompatibleChallenges}`.

## 6. Données Vortex (donjon 87) — résumé extrait

Donjon **Œil de Vortex** : niveau optimal 200, min. 190, difficulté 4, clef = objet 15808, **une seule carte de combat**
`143393281` « Œil de Vortex - Salle des heures perdues » (posX 7, posY -7, sous-zone 841, zone 55, worldMap 15),
entrée/sortie 144445702. La sous-zone 841 contient aussi 143393285, 143394305 (Sortie), 143395329 et 143396353
(« Puits des âmes »), 143397377, 205787162 (« Œil de Vortex »). Race 132 « Égarés ».

Les valeurs ci-dessous sont celles du **grade 1** ; pour les monstres de vague, chaque grade ajoute ≈ +3 niveaux,
+50 aux stats (Force/Intel/Chance/Agi **et** Sagesse : 650 → 700 → 750 → 800 → 850, grade 6 = grade 5) et **+1 point
à chaque résistance %** (ex. Ikargn N/T/F/E/A 3/8/-14/24/39 au grade 1 → 7/12/-10/28/43 au grade 5) ; PV 6000/6200/6300/
6500/6600(/6600). Vérifié en direct sur `GET /monsters?id[$in][]=3833…3839` le 2026-10-04.

| id | Monstre | grades | niveau | PV | PA/PM | rés. % N/T/F/E/A (g1, +1/grade) | stats F/I/C/A/Sa (g1 → g5) | esq. PA/PM | sorts | sort de départ |
|---|---|---|---|---|---|---|---|---|---|---|
| 3834 | Ikargn | 6 | 200-212 | 6000-6600 | 12/5 | 3/8/-14/24/39 | 650 → 850 | 0/0 | 5015 Attraction ailée, 5016 Cercle de feu, 5017 Terre mythe | 5002 |
| 3836 | Méjaire | 6 | 200-212 | 6000-6600 | 12/4 | 8/-14/24/39/3 | 650 → 850 | 0/0 | 5022 Rayonirique, 5023 Plumière, 5024 Envolupté | 5002 |
| 3837 | Harpille | 6 | 200-212 | 6000-6600 | 12/5 | -14/24/39/3/8 | 650 → 850 | 0/0 | 5018 Tirs optiques, 5019 Superfidie, 5021 Petit poison | 5002 |
| 3838 | Buboxor | 6 | 200-212 | 6000-6600 | 12/6 | 24/39/3/8/-14 | 650 → 850 | 0/0 | 5026 Bouclier absorbant, 5027 Feinterception, 5028 Hoxor | 5002 |
| 3839 | Brabuzar | 5 | 200-212 | 6000-6600 | 12/5 | 39/3/8/-14/24 | 650 → 850 | 0/0 | 5030 Mise en situation, 5032 Décollage, 5033 Neutralisation | 5002 |
| 3835 | **Vortex** (boss) | 6 | 220 | 15000-22000 | 16/5 | 6/33/12/21/28 (tous grades) | 800 (tous grades) | 0/20 | 5068 Heuristique, 5070 Morfaille, 5062 En temps et en heure, 5066 Heurage, 5064 Contamination zombie | 5006 (grades 1-5 : niv. 22886, grade 6 : 83735) |
| 3833 | Auroraire (invoqué par Vortex) | 6 | 200 | 5500 | 0/0 | 0 | 0 | 0/0 | — | 4999 « Heure du temps » (grades 1-5 : niv. 22879, grade 6 : 83737) |

Déroulé encodé dans les données (utile pour le scénario) : Vortexiphan (5006, niv. 22886) rend Vortex Invulnérable (56)
et Indéplaçable (97) sans limite, lui retire 100 PM et lui donne Marginal (236) pour **25 tours** ; il invoque Auroraire
et relance 5003/5006 à chaque début de tour (`TB`), puis lance 5008 et 5060 « Action ! » avec **`delay` 25**. Tant qu'il
est Marginal, Vortex ne peut pas lancer Heuristique/Morfaille (`HS!236`) mais peut lancer Contamination zombie (`HS=236`),
En temps et en heure et Heurage. Les monstres de vague reçoivent 5002 « Glyphe téléporteur » (niv. 22882) dont les
bonus dépendent de leur « heure » (états 221 « Première heure » … 232 « Douzième heure ») : 221 +10 % crit. et +200 do
crit., 222 Intaclable (96), 223 +400 Intel., 224 +2 PM, 225 dommages subis ×70 %, 226 +400 Chance, 227 +150 rés. crit.,
228 +4 PA, 229 +400 Force, 230 Inébranlable (157), 231 +30 % Vitalité, 232 +400 Agi. ; état 234 « Même heure » → tour
annulé (effet 140) + Invulnérable (56) + état 6611. Le mécanisme qui attribue l'heure (Auroraire / 4999 « Heure du
temps », 4996 « Décalage horaire ») et le rôle des sous-sorts 5003, 5008, 5060 : **INCERTAIN**, à étudier dans
`monster-spells.json`.

Succès : 1156 Œil de Vortex, 1157 Focus (challenge 332), 1158 Hardi (333), 1159 Trio (334, 20 pts),
6243 Spécial (challenge 1078 « Heure de la mort » : tous les ennemis achevés « à la même heure »). Détails :
`data/dofusdb/achievements-vortex.json`. Le grade 6 de Vortex (22 000 PV, sort de départ 83735 = grade 4 de 5006,
Auroraire grade 6, état Marginal 1 tour au lieu de 25) correspond probablement à un mode « difficile »/modulé —
**INCERTAIN**.

## 7. Le script `scripts/fetch-dofusdb.mjs`

```bash
NODE_USE_ENV_PROXY=1 node scripts/fetch-dofusdb.mjs            # ou : npm run fetch:data
NODE_USE_ENV_PROXY=1 node scripts/fetch-dofusdb.mjs --refresh  # ignore le cache
#   --concurrency=4  --delay=60 (ms entre deux requêtes)  --monster-spells=all|vortex  --max-depth=20
#   --game-version=3.7  (version inscrite dans manifest.json, sinon déduite du schéma des grades, §10.4)
```

- Sans dépendance, Node ≥ 22 ; ~880 requêtes en ~75 s à froid (4 requêtes simultanées), < 10 s avec le cache.
- **Pagination** `$limit=50` + `$skip` + `$sort[id]=1` ; **listes d'ids** par `id[$in][]` (paquets de 50).
- **Retries** : 7 tentatives, backoff exponentiel 0,5 s → 30 s + gigue, sur erreurs réseau, 429 et 5xx ; 404 ⇒ `null`.
- **Cache brut** : chaque réponse est stockée telle quelle dans `.cache/dofusdb/<service>/<requête>.json`
  (≈ 200 Mo, gitignoré). Relancer le script réutilise le cache ; `--refresh` le réécrit.
- **Fermeture transitive** des sorts (§2.6) : sorts de classe → sorts référencés (glyphes, pièges, sorts lancés…) →
  monstres invoqués → leurs sorts et sorts de départ → …, jusqu'à stabilité (garde-fou `--max-depth`, défaut 20 ;
  stabilisé en 5 (classes), 8 (monstres) et 9 (objets) itérations — l'ancien défaut 8 était donc juste à la limite).
- Étapes : tables de référence → classes → monstres → sorts de classe → équipements/panoplies → sorts d'objets →
  donjons/cartes → sorts de monstres → états → challenges/succès Vortex → `manifest.json` (+ contrôles).
- **Écriture tout ou rien** (depuis le 2026-10-08) : les sorties sont préparées dans `.cache/dofusdb-out/` et
  déplacées dans `data/dofusdb/` à la fin seulement ; un échec laisse `data/dofusdb/` intact (§10.4).

### 7.1 Fichiers produits (`data/dofusdb/`, 40,6 Mo au total)

Format : JSON valide avec **une entrée par ligne** (compact mais diff git lisible) ; `achievements-vortex.json` et
`manifest.json` sont indentés. Noms localisés réduits à `{fr, en}`. Supprimés partout : `_id`, `m_id`, `className`,
`createdAt`, `updatedAt`, `img`, `look`, `slug`, `m_flags`, données de craft/drop/scripts d'animation.

| Fichier | Entrées | Taille | Contenu |
|---|---|---|---|
| `breeds.json` | 19 | 0,06 Mo | `{roles[8], breeds[], unassignedSpellVariants[]}` ; chaque classe : noms, descriptions, rôles, paliers de stats, `breedSpellsId`, **`spellPairs` [[A,B]×22]**, `spellVariantIds`, `spellPairUnlockLevels`, `spellPairNames` |
| `class-spells.json` | 836 | 8,9 Mo | `{note, effectDefaults, summonedMonsters[83], missingSpellIds, missingSpellLevelIds, startingSpellLevels, spells[836], linkedSpells[958]}` ; `spells[]` = `{breedId, variantId, pairIndex, variant (0/1), id, name, description, typeId, …, levels[]}` |
| `item-spells.json` | 260 | 0,90 Mo | sorts des Dofus/légendaires/objets (effets 1175, 722) **et des bonus de panoplie** (722) hors sorts de classe ; `itemIds` / `itemSetIds` ; + `classSpellModifiers` (sort → objets qui le modifient) |
| `monster-spells.json` | 4 675 | 12,8 Mo | périmètre **all** : sorts de 894 monstres de donjon + invocations (1 160 monstres atteints), `startingSpellLevels` (410 niveaux de départ → sort) |
| `monsters.json` | 5 135 | 12,1 Mo | tous les monstres (grades complets, `spellGrades` parsés, drapeaux de comportement, tags) |
| `monster-races.json` | 265 | 0,05 Mo | `{superRaces[35], races[]}` |
| `equipment.json` | 3 826 | 2,8 Mo | tous les équipements niv. 1-200 (`slot`, `possibleEffects`, champs d'arme + `weaponZone`) |
| `item-sets.json` | 521 | 0,62 Mo | panoplies non cosmétiques : `items[]`, `bonusesByItemCount {"2":[{effectId,diceNum,diceSide,value,baseEffectId?}],…}` — **même forme que `equipment.json.possibleEffects`** (montant dans `diceNum`, malus = effet négatif avec montant positif, `value` = 3ᵉ paramètre, ex. id de sort pour 722) ; chaque clé n = bonus **total** avec n objets (ne pas cumuler les paliers) |
| `item-types.json` | 239 | 0,04 Mo | `{superTypes[26], types[239]}` avec `slot` (null = non équipable) et `rawZone` |
| `effects.json` | 872 | 0,45 Mo | tous les effets (description fr/en, characteristic, category, operator, elementId, useDice, bonusType, effectPriority, effectPowerRate…) |
| `characteristics.json` | 123 | 0,02 Mo | toutes les caractéristiques (`keyword`, nom fr/en) |
| `spell-states.json` | 6 375 | 0,59 Mo | tous les états (< 3 Mo) ; booléens absents = false ; `referenced` = cité par un sort extrait (1 853) |
| `dungeons.json` | 187 | 0,32 Mo | donjons + sous-zone (cartes, monstres) + succès (nom, description, `challengeId`) |
| `dungeon-maps.json` | 1 788 | 0,56 Mo | cartes des donjons : `roles` (`room` = `mapIds`, `entrance`, `exit`, `subarea`), `roomIndex`, posX/posY, `imageUrl` |
| `challenges.json` | 842 | 0,31 Mo | tous les challenges (critères d'activation/complétion) |
| `achievements-vortex.json` | 5 | 0,01 Mo | succès 1156-1159, 6243 + objectifs + challenges 332, 333, 334, 1078 |
| `manifest.json` | — | — | date, URLs sources, tailles/compteurs, `effectDefaults`, listes d'effets référents, contrôles |

### 7.2 Format normalisé des sorts (class-spells, monster-spells, item-spells)

```jsonc
{ "id": 13106, "name": {"fr": "Pression", "en": "Pressure"}, "description": {...}, "typeId": 8, "order": 1,
  "iconId": 11830, "verboseCast": true, "bypassSummoningLimit": false, "canAlwaysTriggerSpells": false,
  "hideCastConditions": false, /* "basePreviewZone": "C2,0,10,4" si zone d'aperçu (absent si shape 0) */ "spellLevels": [41274, 41275, 41276],
  "levels": [ { "id": 41274, "spellId": 13106, "grade": 1, "spellBreed": 8, "apCost": 3, "minRange": 1, "range": 4,
      "rangeCanBeBoosted": false, "castInLine": false, "castInDiagonal": false, "castTestLos": true,
      "needFreeCell": false, "needTakenCell": false, "needFreeTrapCell": false, "needVisibleEntity": false,
      "needCellWithoutPortal": false, "portalProjectionForbidden": false, "criticalHitProbability": 10, "maxStack": 2,
      "maxCastPerTurn": 4, "maxCastPerTarget": 2, "maxGlobalCastPerTurn": 0, "maxGlobalCastPerTarget": 0,
      "minCastInterval": 0, "initialCooldown": 0, "globalCooldown": 0, "minPlayerLevel": 1, "statesCriterion": "",
      "hideEffects": false, "hidden": false, "playAnimation": true,
      "effects": [ { "effectId": 776, "order": 0, "diceNum": 10, "duration": 2, … /* érosion 10 % */ },
                   { "effectId": 97, "effectUid": 209278, "order": 1, "diceNum": 16, "diceSide": 18, "value": 0,
                     "duration": 0, "delay": 0, "random": 0, "group": 0, "targetMask": "a,A", "triggers": "I",
                     "dispellable": 1, "zone": "P1,0,10,4", "zoneFlags": "c", "effectElement": 1 } ],
      "criticalEffect": [ ... ] } ] }
```

- **Champs d'effet principaux** (toujours présents) : `effectId, effectUid, order, diceNum, diceSide, value, duration,
  delay, random, group, targetMask, triggers, dispellable, zone` (`zone` serait absent si `zoneDescr.shape` = 0 :
  jamais observé sur les 52 085 effets extraits).
- **Champs secondaires omis quand ils valent leur défaut** (`effectDefaults`, répété dans chaque fichier de sorts et dans
  `manifest.json`) : `baseEffectId 0, targetId 0, modificator 0, effectElement -1, effectTriggerDuration 0,
  displayZero false, visibleInTooltip true, visibleInBuffUi true, visibleInFightLog true, visibleOnTerrain true,
  forClientOnly false, trigger false`. Rehydrater : `{...effectDefaults, ...effect}`.
- **`zone`** = `"<forme><param1>,<param2>,<damageDecreaseStepPercent>,<maxDamageDecreaseApplyCount>"` (forme =
  caractère de `zoneDescr.shape`) ; **`zoneFlags`** (si non vide) : `c` includeCarried, `s` isStopAtTarget,
  `d` forcedDirection, `v` onlyAffectIfInSightLine ; **`zoneCells`** si `cellIds` non vide.
- **`previewZones[]`** (si non vide) = `{id, display, displayFlags?, activation, activationFlags?, casterMask?,
  activationMask?, hidden?}` : `display` = zone d'aperçu affichée, `activation` = zone d'activation (ex. Barrière 13019 :
  `display "O3,0,10,4"`, `activation "P1,0,10,4"`), au format `zone`. (Avant la vérification : converti à tort en `[{}]`.)
- `linkedSpells[]` / `spells[]` de monster-spells ont en plus `viaMonster` (premier monstre qui possède le sort).

### 7.3 Contrôles de cohérence (dernier run)

- 19 classes, **836 sorts de classe**, **Iop : 44 sorts / 22 paires** ✔.
- Vortex 3835 : grades `[1..6]`, niveau 220, PV 15000/17000/18000/20000/22000/22000, 16 PA / 5 PM — identiques à
  `GET /monsters/3835` ✔ ; ses 5 sorts (5068, 5070, 5062, 5066, 5064) sont présents dans `monster-spells.json` ✔.
- 3 826 équipements (dont 769 armes, 391 anneaux, 382 chapeaux, 308 montures…) ✔.
- Ids de sorts référencés mais absents de l'API (ignorés, listés dans `missingSpellIds`) : `-1` (sentinelle dans
  `monsters[].spells`, ex. Sac Animé 3329), `5` (valeur non-sort d'un effet 406 du sort 4933) et des ids supprimés
  (13692, 13735, 13737, 13739, 25434, 460, 5663, 15284, 31391, 31553, 10141, 20869). Les « ids » 1, 2, 3, 4, 6, 9 du
  premier run venaient de la mauvaise lecture de 1406 (`diceSide` = rang) et ont disparu après correction.

### 7.4 Étendre l'extraction

- Ajouter un service : écrire une fonction `stepXxx()` qui appelle `fetchAll(service, filtres, select)` ou
  `fetchByIds(service, ids, select)` puis `writeOut('xxx.json', données)` ; l'appeler dans `main()`.
- Restreindre les sorts de monstres au seul Vortex : `--monster-spells=vortex` (bascule automatique si > 40 Mo).
- Ajouter un type d'objet équipable : compléter `EQUIPMENT_TYPES` (typeId → slot).
- Un nouvel effet qui référence un sort/monstre : compléter `SPELL_REF_*` / `SUMMON_EFFECTS` (les modificateurs de
  catégorie 3 et les effets « #1 » sont détectés automatiquement à partir de `effects`).

## 8. Points ouverts / INCERTAIN

1. **Cellules de carte** (sol/obstacles/LdV/placements) : absentes de DofusDB ; à obtenir ailleurs (client, outils
   communautaires) ou à relever à la main sur `img/maps/1/143393281.jpg`.
2. Règles d'**exo/forgemagie** : seuls les poids (`effectPowerRate`) sont dans l'API.
3. Sens exact de `characRatios`/`scaleGradeRef`, de `spell-states.effectsIds`, de certaines formes de zone
   (`;`, `l`, `*`, I, F, B, R, W, Z) et lettres de `targetMask`/`triggers`.
4. Grade 6 de Vortex (et segments supplémentaires de `spellGrades`) : mode modulé/difficile probable, à confirmer.
5. Les descriptions DofusDB des effets 2876/2877 (catégorie 3, sans texte, `value` ≈ 450-475) ne sont pas interprétées.
6. Effets 3792/3793 (sans description, `useInFight: false`) : `value` ressemble à un id de sort **ou** de niveau de sort
   (ex. 21342 existe dans les deux tables) ; probablement visuels/scripts — non suivis par la fermeture (**INCERTAIN**).
7. Coûts des points de caractéristiques (`statsPointsFor*`, paliers 1/2/3/4 par 100) : tels que dans les fichiers du
   client ; non recoupés avec une source de jeu 2026 (**INCERTAIN** si Ankama a modifié le système depuis).

## 9. Vérification (relecture contradictoire du 2026-10-04)

Contrôles refaits contre l'API **en direct** (pas seulement le cache) et en relançant le script.

**Vérifié sans écart**
- Validité JSON des 17 fichiers ; totaux API = comptes extraits (effects 872, characteristics 123, item-types 239,
  monsters 5 135, dungeons 187, challenges 842, spell-states 6 375, item-sets 931 dont 521 non cosmétiques).
- Équipements : total API par `typeId` (29 types) = 3 826 = `equipment.json` ; aucun objet de niveau > 200 dans l'API ;
  aucun autre type rattaché aux super-types équipables (1-5, 7, 10-13).
- Échantillon aléatoire comparé champ par champ à l'API : 15 monstres (tous les champs des grades, `spellGrades`,
  drapeaux), 15 objets (`possibleEffects`, champs d'arme, panoplie, conditions), 20 sorts et tous leurs niveaux
  (portée, PA, relances, `statesCriterion`, effets et effets critiques) : **0 écart**. 10 panoplies au hasard après
  correction : 0 écart.
- `$limit` plafonné à 50, `maps` → `total: 0` (après redirection 301), image `img/maps/1/143393281.jpg` (200), services
  404 listés au §1, totaux de la volumétrie.
- Classes : 19 classes (ids 1-18, 20), 22 paires chacune, 836 sorts, 13 variantes orphelines `breedId 19`.
- Effets d'équipement (ids ↔ caractéristiques, opérateurs) et poids de runes `effectPowerRate` (recoupés avec JOL).
- Vortex : donjon 87 (niv. 200/190, difficulté 4, clef 15808, carte unique 143393281, entrée/sortie 144445702, sous-zone
  841), grades/PV/PA/PM/résistances/esquives des 7 monstres, sorts, niveaux de départ (22886/83735 → 5006, 22882 → 5002,
  22879/83737 → 4999), contenu de Vortexiphan, succès 1156-1159/6243 et challenges 332/333/334/1078.
- `criticalEffect` = liste complète (Pression : 776 + 97 dans les deux listes) ; 1181 → niveau 44338 = sort 14573.
- Déterminisme : deux relances depuis le cache produisent des fichiers identiques octet pour octet (hors manifest).

**Erreurs trouvées et corrigées** (script + données régénérées)
1. **406 / 1406 mal décodés** : le sort est dans `value`, pas dans `diceSide` (0/1 164 et 0/22 correspondances via
   `diceSide` ; 1 139/1 164 et 20/22 via `value`). Conséquences : faux ids 1, 2, 3, 4, 5, 6, 9 dans `missingSpellIds`
   et sorts réellement référencés manquants. Correction : 406/1406 déplacés dans `valueIsSpell` ; +2 sorts liés de
   classe (30079 Fanfaronnade, 32462 Flèche de Rédemption), +3 sorts de monstres (32565-32567).
2. **Bonus de panoplie** lus depuis le résumé DofusDB `effects` : perte de `value` (722 → sorts 8166-8170, 10913 de la
   Panoplie du Vampyre maudit), malus signés (double négation, ex. Panoplie de l'Abraknyde : 218/217 `-20`), effets
   omis. Correction : lecture de `possibleEffects` ; **format changé** en `{effectId, diceNum, diceSide, value,
   baseEffectId?}` (identique à `equipment.json`) ; les sorts donnés par les panoplies sont ajoutés à `item-spells.json`
   (`itemSetIds`) : +13 sorts (247 → 260).
3. **`previewZones`** converti en `[{}]` (230 niveaux de sorts de classe) car la structure réelle est
   `{displayZoneDescr, activationZoneDescr, …}` : corrigé (§7.2).
4. **Profondeur max. 8** : la fermeture « objets » se stabilisait exactement à la 9ᵉ itération (profondeur 8) → défaut
   porté à 20 (simple garde-fou).
5. Petit défaut du limiteur de concurrence (un waiter réveillé pouvait faire dépasser `--concurrency`) : le créneau est
   désormais transmis directement.

**Affirmations de la doc précisées**
- Déblocage des variantes : exception Crâ (paires 2/3 inversées) ; `typeId` = classe seulement pour la variante 0.
- Monstres de vague : stats/résistances données au grade 1, elles augmentent avec le grade (§6) ; Morfaille aussi
  bloquée par Marginal, Contamination zombie le requiert.
- Correspondances 210-214 / 240-244 → caractéristiques explicitées (ordre non monotone) ; grammaire `statesCriterion`
  avec parenthèses ; liste à jour des `missingSpellIds`.

**Non vérifié / reste INCERTAIN** : sémantique des lettres `targetMask`/`triggers`, valeurs de `dispellable`, formes de
zone rares, effets 3792/3793/2876/2877, mécanisme exact des « heures » de Vortex, coûts des points de caractéristiques
en 2026 (cf. §8).

## 10. Schéma 3.7 (2026-10-07)

**Constat.** Avec la mise à jour 3.7 du jeu (2026-10-06), DofusDB a changé le schéma des grades de monstres :
constaté le 2026-10-07 (`GET /monsters/3835` et `/monsters/1045`), revérifié le 2026-10-08 par 3 requêtes GET
(`/monsters/3835`, `/1045`, `/3534`, `updatedAt` 2026-10-07T22:25Z), puis par une 4e lors de la relecture
(`/monsters?id[$in][]=53&id[$in][]=3112` : Bwork Mage, esquive PA 3.6 non nulle, et Explobombe, parts de l'invocateur). Les champs `neutralResistance…`, `paDodge`,
`pmDodge`, `bonusRange` et `gradeXp` n'existent plus. L'ancienne normalisation lisait `g.neutralResistance`
(`undefined`) et `compact()` supprimait la clé : une nouvelle extraction aurait donné **0 % de résistance à tous les
monstres, sans erreur**. Les données de `data/dofusdb/` (2026-10-04) sont en 3.6 et **ne sont pas ré-extraites**
(décision de l'utilisateur : cela changerait des valeurs de référence du Vortex) ; `manifest.json` porte
`game.version: "3.6"`, renseigné à la main.

Extraits réduits des réponses (un à trois grades complets, tels que renvoyés) :
[`tests/fixtures/dofusdb-3.7/`](../../tests/fixtures/dofusdb-3.7/) (`monster-3835.json`, `monster-1045.json`,
`monster-3534.json`, `monster-53.json`, `monster-3112.json`) ; référence 3.6 figée aux mêmes grades (tirée de
`monsters.json`, pour survivre à une ré-extraction) :
[`tests/fixtures/dofusdb-3.6/monsters-extract.json`](../../tests/fixtures/dofusdb-3.6/monsters-extract.json). Données
DofusDB sous LPNC-IA 1.0 (usage non commercial) ; leur utilisation est autorisée pour ce projet selon le README
(« Sources et licences »).

### 10.1 Correspondance des champs de grade

Normalisation : [`scripts/lib/dofusdb-normalize.mjs`](../../scripts/lib/dofusdb-normalize.mjs) (`normGrade`, table
`RENAMED_37`), importée par `fetch-dofusdb.mjs`. Elle lit les deux schémas et écrit le format historique de
`monsters.json` : champs existants **toujours écrits, mêmes clés, même ordre** (renormaliser les 26 970 grades actuels
les rend octet pour octet) ; champs nouveaux **écrits seulement s'ils sont non nuls** (sinon ≈ 25 clés nulles de plus
par grade). Si l'ancien et le nouveau nom coexistent, l'ancien l'emporte. Conversion : `src/data/convert.ts`
(`GRADE_STAT_FIELDS_37`), appliquée seulement aux champs présents (aucune valeur actuelle ne change : empreinte des
5 135 monstres convertis identique avant/après).

| API 3.7 | `monsters.json` (normalisé) | `Stats` (convert.ts) | Remarque (Vortex / Kimbo / Merkator, grade 5) |
|---|---|---|---|
| `reductionNeutral/Earth/Fire/Water/Air` | `neutralResistance…` | `neutralResPct…` | mêmes valeurs qu'en 3.6 (6/33/12/21/28 ; 400 ; 14/27/16/22/12) |
| `paLostDodge` | `paDodge` | `apParry` | même grandeur, valeur baissée (−24 / −24 / −21 contre 0 ; Bwork Mage 4 / 3 contre 10) : §10.2 |
| `mpLostDodge` | `pmDodge` | `mpParry` | mêmes valeurs (20 / 0 / 30) |
| `rangeBonus`, `xp` | `bonusRange`, `gradeXp` | `range`, — | |
| `grade, level, lifePoints, actionPoints, movementPoints, vitality, wisdom, strength, intelligence, chance, agility, damageReflect, startingSpellId` | inchangés | inchangés | PV, PA, PM, caractéristiques identiques |
| `reduction<Élément>Flat` | `<élément>ResistanceFlat` | `neutralRes…` (fixes) | nouveau ; 0 sur les 3 boss |
| `criticalDamageReduction` | idem | `criticalRes` | nouveau ; 0 |
| `pushDamageReduction` | idem | `pushRes` | nouveau ; Kimbo 9999 |
| `tackleBonus` | `tackleBlock` | `tackleBlock` | 20 / 0 / 30 ; ajouté à Agi/10 par le moteur (**INCERTAIN** : bonus ou total) |
| `tackleEvade` | idem | `tackleEvade` | 20 / 0 / 30 ; idem |
| `initiativeBonus` | idem | `initiative` | 15000 / 0 / 5000 ; ajouté à Fo + Int + Cha + Agi par le moteur |
| `damageBonus`, `<élément>DamageBonus` | `damageBonus`, `bonus<Élément>Damage` | `damage`, `<élément>Damage` | 0 ; noms de `bonusCharacteristics` 3.6 ; Explobombe : 100 (parts) |
| `criticalHitBonus`, `criticalDamageBonus`, `pushDamageBonus` | idem | `critical`, `criticalDamage`, `pushDamage` | 0 |
| `healBonus`, `trapDamageBonus`, `trapDamageBonusPercent` | idem | `heals`, `trapDamage`, `trapPower` | 0 |
| `apAttack`, `mpAttack` | idem | `apReduction`, `mpReduction` | 0 |
| `percentDamageBonus` | idem | `power` (Puissance) | 0 ; Explobombe : 100 (parts). **Déduit**, non vérifié en jeu : ci-dessous |
| `maxSummon` | idem | **non converti** | 1 / 1 / 7 ; le moteur lit `stats.summons` dans les masques de cible (targetMask.ts) |
| `monsterId`, `honoursPoints` | ignorés | — | redondant ; points d'honneur (JcJ) |

Noms : les clés gardées telles quelles sont les noms d'API ; `criticalDamageReduction` et `pushDamageReduction` sont
aussi des mots-clés de `characteristics.json` (ids 87 et 85), pas `initiativeBonus` (mot-clé `initiative`, id 44).

`percentDamageBonus` = Puissance, par déduction : `characteristics.json` associe `trapDamageBonus` à « Dommages Pièges »
et `trapDamageBonusPercent` à « Puissance Pièges » (ids 70 et 69), et la Puissance y a le mot-clé `damagePercent`
(id 25) ; le couple `damageBonus` / `percentDamageBonus` suit le même schéma, et l'Explobombe 3.7 reçoit les deux à
100 %, comme un Roublard dont la bombe hérite des dommages ET de la puissance. Non vérifié en jeu.

`bonusCharacteristics` (part en % des caractéristiques de l'invocateur) porte en 3.7 les mêmes clés que le grade, plus
`aPRemoval` : mêmes renommages (`reductionEarth` → `earthResistance`, `earthDamageBonus` → `bonusEarthDamage`,
`tackleBonus` → `tackleBlock`…), valeurs nulles retirées ; `MONSTER_BONUS_STATS` connaît les nouveaux noms sauf
`apAttack`/`mpAttack` (ils coexistent avec `aPRemoval`/`mPRemoval` : doublon possible, non tranché). Parts nulles sur les
3 boss ; sur l'Explobombe (3112, grade 1), mêmes parts qu'en 3.6 (PV 90 %, caractéristiques et dommages élémentaires
100 %) **plus** `damageBonus`, `percentDamageBonus` et `neutralDamageBonus` à 100 : la sémantique « part en % » tient,
et la bombe 3.7 hérite en plus des dommages fixes, de la Puissance et des dommages neutres de l'invocateur
(`summonerShare` : `damage`, `power`, `neutralDamage` à 100). Le test « toute part de l'invocateur non nulle est prise
en charge » (data-fetch-schema, sur les fixtures) et celui de data-node (sur les données) signalent une clé que
`convertSummonerShare` écarterait.

### 10.2 Sens de `paLostDodge`

| Monstre, grade | Sagesse | ⌊Sagesse/10⌋ | `paDodge` 3.6 | `paLostDodge` 3.7 | Esquive PA du moteur 3.6 → 3.7 |
|---|---|---|---|---|---|
| Vortex 3835, g1 et g5 | 800 | 80 | 0 | −24 | 80 → 56 |
| Kimbo 1045, g5 | 800 | 80 | 0 | −24 | 80 → 56 |
| Merkator 3534, g5 | 700 | 70 | 0 | −21 | 70 → 49 |
| Bwork Mage 53, g1 | 112 | 11 | 10 | 4 | 21 → 15 |
| Bwork Mage 53, g3 | 126 | 12 | 10 | 4 | 22 → 16 |
| Bwork Mage 53, g5 | 140 | 14 | 10 | 3 | 24 → 17 |

Le moteur calcule l'esquive PA d'un monstre = ⌊Sagesse/10⌋ + `paDodge` (`engine/factory.ts`). Dans tous les cas :

> esquive PA finale 3.7 = ⌈0,7 × esquive finale 3.6⌉, soit `paLostDodge` = `paDodge` − ⌊0,3 × (`paDodge` + ⌊Sagesse/10⌋)⌋

C'est la baisse de 30 % de l'esquive PA des monstres annoncée pour la 3.7 (notes de mise à jour relevées le 2026-10-07
sur DofusPourLesNoobs, page « mise-a-jour-307 »), arrondie en faveur du monstre (plafond : le Bwork Mage g3 passe de
22 à 16, un arrondi au plus proche donnerait 15). **Conclusion : même grandeur et même sens (bonus fixe ajouté à
Sagesse/10), pas d'inversion de signe** ; la 3.7 inscrit sa baisse dans ce bonus, qui peut devenir négatif. `normGrade`
le recopie tel quel dans `paDodge`. Ces chiffres corroborent aussi l'hypothèse du moteur « la Sagesse donne l'esquive
aux monstres ». `mpLostDodge` = `pmDodge`, inchangé (la baisse ne touche que les PA). Une première version de cette
section donnait `paDodge` − 0,3 × Sagesse/10 : juste seulement quand `paDodge` 3.6 vaut 0 (7 039 grades actuels ont
un `paDodge` non nul, dont 350 négatif ; relecture du 2026-10-08). Limites : 8 grades observés, esquive finale 3.6
toujours positive (le sens de l'arrondi d'une esquive finale négative, 1 grade actuel, n'est pas observé). Vérifié par
`tests/data-fetch-schema.test.ts`.

### 10.3 Autres écarts constatés (3 boss, Bwork Mage, Explobombe)

- `tags` vides (`[]`) en 3.7, contre 6 / 6 / 3 étiquettes en 3.6 (vides aussi pour le Bwork Mage, 6 en 3.6, et
  l'Explobombe). L'IA ne s'en sert que pour `summon` (`src/ai/monster/archetype.ts`) ; le script avertit si aucun
  monstre n'a de tags.
- Explobombe (3112) : 3 grades en 3.7 (niveaux 1, 66, 132) contre 7 grades de niveau 1 en 3.6 ; ses parts de
  l'invocateur gagnent dommages fixes, Puissance et dommages neutres (§10.1).
- Kimbo : mêmes sorts, dans un autre ordre (`spellGrades` reste aligné : sans effet).
- Champs du monstre (`MONSTER_SELECT`) : tous présents, mêmes formats (`spellGrades` en chaîne, `characRatios`…).
- Aucun numéro de version du jeu dans les réponses `/monsters` (les autres services n'ont pas été examinés).

### 10.4 Garde-fous de l'extraction

- Bilan des grades bruts par schéma (`3.6` / `3.7` / `inconnu`) et clés que la normalisation ne connaît pas : journal
  et `manifest.json` (`game.gradeSchemas`, `game.unknownGradeKeys`). Un futur renommage devient visible.
- **Échec explicite** (message en français, `assertBossResistances`) si un monstre `isBoss` a un grade sans ses 5
  résistances en %, ou aucun grade ; si aucun monstre n'est `isBoss` ; si le boss témoin, le Vortex (3835,
  `SENTINEL_BOSS_IDS`), manque ou n'est plus `isBoss`. Sans ces deux derniers contrôles, un renommage de `isBoss`
  viderait la liste des boss à vérifier et le garde-fou passerait sans rien contrôler.
- **Écriture tout ou rien** : les fichiers sont préparés dans `.cache/dofusdb-out/` puis déplacés dans `data/dofusdb/`
  seulement à la fin d'une extraction réussie (`publishOutputs`, `manifest.json` en dernier). Un échec (garde-fou,
  erreur HTTP…) laisse `data/dofusdb/` intact, y compris les tables de référence (`effects.json`, `characteristics.json`,
  `item-types.json`) préparées avant les monstres ; le message d'échec le rappelle.
- `manifest.json` → `game.version` : `--game-version=X.Y`, sinon déduite du schéma (« 3.7 » = 3.7 ou postérieure ;
  l'API ne publie pas de version). `checks.vortexBossResPctAndDodge` = résistances et esquives du Vortex au grade 5.
- Testé hors réseau par `tests/data-fetch-script.test.ts` : le script (copié dans un dossier temporaire) interroge un
  faux serveur local qui sert les fixtures 3.7. Schéma 3.7 → grades complets publiés, `game.version: "3.7"` ; clés de
  résistance renommées ou `isBoss` renommé → code de sortie 1, message français, `data/dofusdb` inchangé.
- Seuls les monstres ont été examinés : un renommage dans les autres services (objets, sorts, états) n'est pas détecté.

### 10.5 Procédure de ré-extraction (à décider par l'utilisateur)

1. `NODE_USE_ENV_PROXY=1 node scripts/fetch-dofusdb.mjs --refresh --game-version=3.7` (≈ 880 requêtes, ≈ 75 s ;
   `--refresh` est indispensable : le cache contiendrait sinon des réponses 3.6).
2. Lire le journal : `schémas des grades : {"3.7": …}` seul, pas de « clés de grade inconnues », pas d'« Extraction
   DofusDB refusée », et `== Publication` en fin de run. En cas d'échec, `data/dofusdb` n'a pas bougé : compléter
   `RENAMED_37` et relancer (le cache évite de tout retélécharger).
3. Contrôler `manifest.json` : `game`, `checks.vortexBossResPctAndDodge` = `[6, 33, 12, 21, 28, -24, 20]` attendu ;
   `git diff --stat data/dofusdb`.
4. Relancer les tests `data-*`, puis la suite complète. Changements attendus : esquive PA des monstres ramenée à
   ⌈70 %⌉ (Vortex 80 → 56 : retraits de PA plus efficaces), tacle, fuite et initiative des boss en hausse, résistance
   poussée de certains boss, tags absents, bombes du Roublard qui héritent aussi des dommages fixes, de la Puissance et
   des dommages neutres (et Explobombe à 3 grades). Tests à mettre à jour, relevés par une simulation (grades des 5
   monstres des fixtures remplacés par leur version 3.7 normalisée dans une copie de `monsters.json`, `game.version`
   3.7 ; tests `data-*` et `stats-*` seulement) :
   - `data-node` « Vortex (3835) : grades, caractéristiques, résistances… » : `apParry` vaut −24 (attendu absent) ;
   - `data-node` « bonusCharacteristics = part (%)… » : part de l'Explobombe + `damage`, `power`, `neutralDamage` à
     100 ; `stats.tackleBlock` n'est plus toujours absent des grades (Vortex 20, Merkator 30) ;
   - `data-fetch-schema` : les deux tests propres aux données 3.6 sont ignorés (`it.runIf`, `game.version` ≠ 3.6) ; les
     comparaisons 3.6 / 3.7 utilisent l'extrait 3.6 figé et restent valables.
   Non vérifié : les ≈ 60 autres fichiers de tests qui citent le Vortex (`ai-*`, `effects-*`, `opt-*`, `vortex-*`) et
   les tests des invocations du Roublard ; recalibrer `data/ai/calibration.json` si besoin.
5. Mettre à jour ce document (§7.3) et les rapports qui citent des valeurs du Vortex.
