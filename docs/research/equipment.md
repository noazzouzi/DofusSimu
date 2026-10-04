# Équipements, caractéristiques et forgemagie — théorie pour l'optimiseur de stuff (Dofus 3)

> Recherche du 2026-10-04 pour **DofusSimu**. Jeu ciblé : **Dofus 3 (Unity)**, données DofusDB extraites des fichiers
> client (enregistrements `updatedAt` jusqu'à l'été 2026, cf. [`dofusdb-api.md`](dofusdb-api.md)).
>
> Fichiers produits :
> - [`data/research/characteristics-map.json`](../../data/research/characteristics-map.json) — `{effectId: {stat, sign, unit, fr, context, …}}`
>   pour **tous** les effets rencontrés sur les 3 878 objets équipables et 931 panoplies (+ effets de buff de combat liés à une caractéristique).
>   NB : les 3 878 incluent 52 **compagnons** (type 169, non équipables dans les 16 emplacements) ; l'extraction
>   `data/dofusdb/equipment.json` en contient 3 826 (sans type 169) et `item-sets.json` 521 panoplies sur 931.
> - [`data/research/forgemagie.json`](../../data/research/forgemagie.json) — poids des runes, plafonds d'over, exos possibles
>   (rareté / palier de coût), 81 runes de transcendance, gravures, orbes, profils de FM réalistes, lignes typiques niv. 190-200.
>
> Les deux JSON ont été générés depuis l'API DofusDB (réponses brutes en cache local `.cache/equipment/`, non versionné) ;
> ils se régénèrent à partir de `data/dofusdb/effects.json`, `equipment.json` et `item-sets.json` (mêmes champs).
>
> Convention : **INCERTAIN** = non confirmé par une source primaire (meilleure estimation donnée). Les données du jeu
> (DofusDB) priment sur les guides ; les désaccords sont signalés.

---

## 0. L'essentiel pour les ingénieurs (TL;DR)

1. **Valeur d'une ligne d'objet** : `possibleEffects[i] = {effectId, diceNum, diceSide}` → jet ∈ `[diceNum, diceSide]`,
   et si `diceSide == 0` la valeur est fixe = `diceNum`. **Le signe n'est pas dans les nombres** : il est porté par
   l'`effectId` (ex. 118 = +Force, 157 = −Force ; 210 = +% Rés. Terre, 215 = −% Rés. Terre). Le champ calculé par DofusDB
   `effects[] {from, to, characteristic}` est, lui, déjà signé (`-16..-20`). Utiliser `characteristics-map.json` → `sign`.
2. **Totaux** (logique exacte du « stuff creator » DofusDB, code JS récupéré, §13) :
   `total(stat) = base investie + parchemins + Σ objets + bonus de panoplie + exos`, puis :
   PA = `(niv ≥ 100 ? 7 : 6) + Σ`, **plafond 12** ; PM = `3 + Σ`, **plafond 6** ; PO = `Σ`, plafond **6** (INCERTAIN, cf. §7) ;
   Invocations = `1 + Σ` ; PV = `55 + 5·(niv−1) + Vitalité` (= 1 050 + Vitalité au niv. 200) ;
   Initiative = `bonus + Force + Intelligence + Chance + Agilité` ; Prospection = `100 + ⌊Chance/10⌋ + bonus` ;
   Tacle/Fuite = `⌊Agilité/10⌋ + bonus` ; Esquive/Retrait PA/PM = `⌊Sagesse/10⌋ + bonus` ; Pods = `1000 + 5·(niv−1) + 5·Force + bonus`.
3. **Points de caractéristiques** : `5 × (niveau − 1)` = **995 au niveau 200**. Coûts **identiques pour les 19 classes**
   (données `breeds`) : Force/Intel/Chance/Agi = 1 pt/point jusqu'à 100, 2 de 101 à 200, 3 de 201 à 300, 4 au-delà ;
   Vitalité 1:1 (Sacrieur compris) ; Sagesse 3:1. **Parchemins** : +100 max sur chacune des 6 caractéristiques, hors paliers.
   Tout dans un élément ⇒ **398** de base (+100 parchemin) ; variante « 300 élément + 395 Vitalité ».
4. **Panoplies** : bonus du palier `n` = `effects[n−1]` (**non cumulatif**, chaque palier contient le bonus total) ;
   `n` = nombre d'objets équipés portant ce `itemSetId`. Deux anneaux identiques interdits **s'ils sont de panoplie**.
5. **Slots** : amulette, coiffe, cape, 2 anneaux, ceinture, bottes, arme, bouclier, 1 familier/montilier/monture,
   **6 emplacements Dofus/Trophées/Prysmaradite** (pas de doublon ; **1 seule prysmaradite** — règle rappelée par la
   MàJ 3.3 du 22/09/2025, pas introduite par elle). **Bouclier compatible avec toutes les armes** : la notion d'arme
   à 1 ou 2 mains a été supprimée en 2.41 (2017) ; dans les données, un seul objet (Balai rudimentaire, outil de quête
   niv. 1) a encore `twoHanded = true` → ne pas implémenter de règle « deux mains ⇒ pas de bouclier ».
6. **Exos PA/PM/PO** : ~1 % de succès par rune, **un seul exo de chaque type compté par personnage** ; puis plafonds 12/6.
   Le fameux « exo 1 % dommages aux sorts » = **rune de transcendance Ta Do Per So** (+1 % Do. sorts, niv. 200, 100 % de
   réussite, verrouille l'objet, objet sans over ni exo) ; les stuffs THL en posent sur ~6 objets ⇒ **+6 à 7 %**.
7. **Overmax** : une ligne ne peut dépasser **101 de poids** (valeur × poids/pt), sauf si le jet max naturel dépasse déjà
   101. Seuls les **meilleurs** objets 200 sont déjà au plafond (Vita 500, stat 100, Do élém. 20) : sur les 514 objets
   non-armes niv. 190-200, la ligne **médiane** est Vita 350 (poids 70), stat 60, Do élém. 12 ⇒ il reste une marge d'over
   théorique importante (Vita → 505, stat → 101), mais coûteuse (puits) ; **PA/PM/PO ne peuvent jamais être over**
   (+1 point ⇒ poids ≥ 102). Profils par défaut de l'optimiseur : jet parfait + exos + transcendances, over en option.
8. **Résistances %** : plafonnées à **50 %** pour un joueur dans le calcul de dégâts (100 % pour un monstre) — code Haxe
   Dofus 3 (`MaxResistHuman = 50`, appliqué à `% rés. élémentaire + % rés. tous éléments`) et client D2
   (`Math.min(resistPercent, 50)` si cible non-monstre).
9. **Conditions** (`criterions`) : grammaire `&`, `|`, parenthèses ; `CA>299` = Agilité totale > 299, `CP<12` = PA total < 12,
   `Pk<3` = « bonus de panoplie < 3 » où le nombre de bonus = Σ_panoplies max(0, n−1). Recommandation : évaluer toutes les
   conditions **sur l'état final** du stuff (valeurs brutes avant plafonds), cf. §6.
10. **Dofus / prysmaradites / objets légendaires** : beaucoup d'effets sont des **sorts passifs** (effet 1175, `diceNum` = id de
    sort) → à implémenter dans le moteur de combat (Turquoise, Ocre, Vulbis, Pourpre, Abyssal, Nébuleux, Ivoire…), §8.

---

## 1. Sources

| Sujet | Source | Nature |
|---|---|---|
| Caractéristiques (123), effets (872), objets (21 776), panoplies (931), montures (266), classes | `https://api.dofusdb.fr/{characteristics,effects,items,item-sets,mounts,breeds}` | Données du jeu (primaire) |
| Calcul des totaux d'un stuff | Code JS du « stuff creator » de DofusDB (`https://dofusdb.fr/js/chunk-common.7f69c15e.js`, modules `b9bf`, `56dd`, `1a46`, `ece7` ; `app.4ffd550b.js` : `bn`, `Sn`, `wn`) | Implémentation de référence |
| Conditions d'objets | Client Dofus 2 décompilé : `com/ankamagames/dofus/datacenter/items/criterion/{ItemCriterionFactory,ItemCriterion,BonusSetItemCriterion,ItemCriterionOperator}.as` (https://github.com/Romain-P/d2gen) | Code client (D2, INCERTAIN pour D3) |
| Plafond de résistance | `.cache/domath/haxe/FighterManagement/HaxeFighter.cs` (bibliothèque de dégâts Dofus 3 utilisée par DoMath) ; `Romain-P_d2gen.DamageUtil.as` l. 2360 | Code |
| Limites PA/PM/PO, exos | Devblog 2.3.4 : https://dofus.jeuxonline.info/actualite/30454/devblog-nouvelles-restrictions-pa-pm-po | Officiel (2011) |
| Condition PA < 12 | Devblog 2.9 : https://dofus.jeuxonline.info/actualite/38150/devblog-nouveaux-objets-29 | Officiel |
| Parchemins / paliers | https://dofus.jeuxonline.info/actualite/46554/amelioration-systeme-caracteristiques (2.26) | Officiel |
| Trophées | https://dofus.jeuxonline.info/article/13994/trophees | Guide |
| Familiers (niveau = % des bonus) | https://dofus.jeuxonline.info/actualite/54999/maj-248-presentation-refonte-familiers | Officiel (2.48) |
| MàJ 3.3 (rappel « 1 seule prysmaradite », fusion de variantes, initiative) | https://www.dofuspourlesnoobs.com/mise-a-jour-303.html (MàJ mise en ligne le 22/09/2025) | Patch notes résumées |
| Boucliers compatibles avec toutes les armes (fin des armes à 2 mains, 2.41) | https://dofus.jeuxonline.info/actualite/52365/devblog-refonte-boucliers (21/03/2017) | Officiel |
| MàJ 3.5 (montures niv. 200) | https://guidactik.com/dofus/resume-de-la-mise-a-jour-3-5-de-dofus/ (03/03/2026), https://www.next-stage.fr/?p=235408 | Guides |
| Niveaux Oméga | https://dofus.jeuxonline.info/actualite/53580/245-devblog-niveaux-omega | Officiel |
| Forgemagie | https://www.gamosaurus.com/?p=118767 ; https://dafous.app/guides/poids-runes-fm.html (02/2026) ; https://dofus.jeuxonline.info/article/3736/forgemagie ; https://dofusbuilds.com/guides/exos-and-forgemagie (08/2026) | Guides |
| Transcendance | https://www.next-stage.fr/2026/03/runes-transcendance-dofus-comment-elles-fonctionnent-comment-utiliser.html ; https://www.millenium.org/guide/316947.html | Guides |
| Méta 200 | Gamosaurus « Dofus Unity Stuff Terre/Feu/Eau/Air/Tank niveau 200 » (12/2024) ; https://guidactik.com/dofus/tous-les-meilleurs-stuff-pour-dofus-unity/ (2026) | Guides |

`www.dofus.com` et `dofusbook.net` renvoient 403 depuis cet environnement (non consultés directement).

---

## 2. Modèle de données des objets (DofusDB)

### 2.1 Champs utiles d'un équipement (`/items`)

| Champ | Sens |
|---|---|
| `typeId` | Type (→ slot), cf. 2.2 |
| `level` | Niveau requis (condition implicite : niveau du personnage ≥ `level`) |
| `itemSetId` | Panoplie (`-1` = aucune ; l'extraction `data/dofusdb/equipment.json` le normalise en `null`) |
| `criterions` | Conditions d'équipement (chaîne, cf. §6) |
| `possibleEffects[]` | `{effectId, diceNum, diceSide, value, …}` = **jet min / jet max** ; `diceSide = 0` ⇒ valeur fixe `diceNum` |
| `effects[]` (DofusDB) | Résumé **signé** `{from, to, characteristic, category, elementId, effectId}` (`to=0` ⇒ fixe) |
| `isLegendary`, `twoHanded`, `etheral` | Objet légendaire (sort passif), arme à 2 mains (**obsolète** depuis 2.41 : `true` sur un seul objet du jeu, le Balai rudimentaire 27645 ; ne bloque pas le bouclier), arme éthérée |
| Armes : `apCost, minRange, range, criticalHitProbability, criticalHitBonus, maxCastPerTurn, castInLine, castInDiagonal, castTestLos` | Profil de l'arme ; les lignes de dégâts sont des effets 91-100 / 2822 / 2828 (`context: "weaponLine"`) |

Exemple (Coiffe du Comte Harebourg, id 14076) : `125: 451-500` (Vitalité), `118: 71-100` (Force), `124: 41-60` (Sagesse),
`117: 1` (+1 PO fixe), `430/422: 16-20` (Do Neutre/Terre), `176: 21-30`, `219/215/218/216/217: 4-5` (= **−4 à −5 %** de
chaque résistance : l'id porte le signe), `753: 16-20` (Tacle), `410: 6-8` (Retrait PA).

### 2.2 Types et emplacements (`typeId` → slot)

| Slot | typeId | Nb objets (niv. 190-200) |
|---|---|---|
| Amulette | 1 | 334 (73) |
| Anneau ×2 | 9 | 391 (82) |
| Ceinture | 10 | 362 (65) |
| Bottes | 11 | 373 (83) |
| Coiffe (« Chapeau ») | 16 | 382 (93) |
| Cape | 17 | 311 (72) |
| Bouclier | 82 | 129 (46) |
| Arme | 2 Arc, 3 Baguette, 4 Bâton, 5 Dague, 6 Épée, 7 Marteau, 8 Pelle, 19 Hache, 20 Outil, 21 Pioche, 22 Faux, 114 Arme magique, 271 Lance | — |
| Familier / Montilier / Monture | 18 Familier, 121 Montilier, 331 Dragodinde, 332 Muldo, 333 Volkorne | 1 seul slot |
| Dofus / Trophée / Prysmaradite | 23, 151, 217 | 6 slots partagés |

Le stuff creator DofusDB modélise exactement 16 objets : `amulet, helmet, cape, rings[2], shield, boots, belt, dofus[6], weapon, pet`
(cf. `SLOTS_EQUIPABLE_BY_USER = 16` du protocole D2). Les objets d'apparat / costumes (types 199, 246-252, 299, 300…) n'ont pas de stats.
DofusDB accepte aussi dans l'emplacement d'arme les pierres d'âme (type 83) et filets de capture (type 99) : sans
statistiques (sort passif de capture / effet 722), à exclure de l'optimiseur. Les **compagnons** (type 169, 52 objets,
condition `PZ=1`) ne sont pas des équipements du personnage.

### 2.3 Règles d'équipement (vérifiées dans le code DofusDB `wn`)

- **Anneaux** : deux exemplaires du même anneau autorisés **sauf** s'il appartient à une panoplie (`typeId 9` + `itemSetId ≠ -1`).
- **Dofus, trophées, prysmaradites** (types 23/151/217) : jamais deux fois le même objet.
- **Prysmaradite** : **une seule** par personnage (règle « rappelée » par la MàJ 3.3 du 22/09/2025, donc antérieure ;
  DofusDB ne l'applique pas, à faire nous-mêmes).
- **Bouclier** : compatible avec **toutes** les armes depuis la 2.41 (« La notion d'arme à 1 ou 2 mains va disparaître en
  version 2.41, ce qui signifie que les boucliers pourront être utilisés avec toutes les armes du jeu », devblog JOL 52365).
  Le code DofusDB (`wn`) n'a d'ailleurs aucune règle arme/bouclier. Ne pas utiliser le champ `twoHanded`.
- **Niveau** : `item.level ≤ niveau du personnage`.

---

## 3. Catalogue des caractéristiques

`characteristics-map.json` donne, pour chaque `effectId` : `stat` (clé canonique camelCase), `sign` (+1/−1), `unit`
(`flat`/`percent`), `fr`, `context`, `characteristicId`, `keyword` (DofusDB), `category`, `element`,
`runeWeightPerPoint` (poids FM), `powerRate` (brut), `oppositeEffectId`, `onItems`/`onSets` (fréquence), `template`, `note`.
`onItems` = nombre de **lignes** portant l'effet sur les 3 878 objets (une arme peut porter 2 lignes 100 ; compagnons
inclus) ; `onSets` = nombre de **paliers** de panoplie (sur les 931) contenant l'effet (ex. 111 : 510 paliers dans 338
panoplies) — ce ne sont pas des nombres d'objets/panoplies distincts.

Contextes : `stat` (bonus permanent d'objet/panoplie, à sommer) · `fightBuff` (n'existe qu'en combat : buffs de sorts/passifs) ·
`weaponLine` (lignes de dégâts/vol/soin d'arme) · `spellModifier` (bonus de sort de classe, effets 281-297 : `diceNum` = id de sort,
`value` = valeur) · `passiveSpell` (1175, `diceNum` = id de sort passif) · `statCap` (2897, plafond de caractéristique) ·
`scroll` (606-611, « caractéristique additionnelle ») · `special` (795 arme de chasse, 700 gravure) · `ignore` (liens, titres,
attitudes, technique monture…). Les **150** effectIds distincts présents sur les objets et les 931 panoplies (151 annoncés
initialement ; recompté à 150 lors de la vérification) sont tous couverts.

### 3.1 Caractéristiques d'objets (ids d'effets +/−, poids FM = `effectPowerRate`)

| Stat (clé) | Carac. id / keyword | Effet + | Effet − | Unité | Poids/pt | Rôle (résumé) |
|---|---|---|---|---|---|---|
| Vitalité `vitality` | 11 vitality | 125 | 153 | fixe | 0,2 | +1 PV/pt |
| Sagesse `wisdom` | 12 wisdom | 124 | 156 | fixe | 3 | Esquive/Retrait PA/PM (+⌊Sa/10⌋), XP |
| Force `strength` | 10 | 118 | 157 | fixe | 1 | Dégâts Terre **et Neutre**, pods |
| Intelligence `intelligence` | 15 | 126 | 155 | fixe | 1 | Dégâts Feu, soins |
| Chance `chance` | 13 | 123 | 152 | fixe | 1 | Dégâts Eau, prospection (+⌊Ch/10⌋) |
| Agilité `agility` | 14 | 119 | 154 | fixe | 1 | Dégâts Air, tacle & fuite (+⌊Ag/10⌋) |
| PA `actionPoints` | 1 | 111 | 168 | fixe | 100 | plafond 12 |
| PM `movementPoints` | 23 | 128 | 169 | fixe | 90 | plafond 6 |
| Portée `range` | 19 | 117 | 116 | fixe | 51 | plafond 6 (INCERTAIN) |
| Invocations `summons` | 26 | 182 | 2990 | fixe | 30 | base 1 |
| % Critique `criticalHit` | 18 | 115 | 171 | % | 10 | s'ajoute au taux de CC du sort |
| Puissance `power` | 25 damagePercent | 138 | 186 | fixe | 2 | ajoutée à la stat élémentaire dans la formule |
| Dommages `damage` | 16 allDamageBonus | 112 | 145 | fixe | 20 | +dommages fixes tous éléments |
| Do. Terre/Feu/Eau/Air/Neutre | 88/89/90/91/92 | 422/424/426/428/430 | 423/425/427/429/431 | fixe | 5 | dommages fixes par élément |
| Do. Critiques `criticalDamage` | 86 | 418 | 419 | fixe | 5 | ajout sur coup critique |
| Do. Poussée `pushDamage` | 84 | 414 | 415 | fixe | 5 | dégâts de poussée |
| Do. Pièges / Puissance pièges | 70 / 69 | 225 / 226 | — | fixe | 5 / 2 | pièges (Sram) |
| Soins `heals` | 49 | 178 | 179 | fixe | 10 | soins fixes |
| Renvoi `reflectDamage` | 50 | 220 | — | fixe | 5 (INCERTAIN, guides : 10) | renvoi de dommages |
| Retrait PA / PM | 82 / 83 | 410 / 412 | 411 / 413 | fixe | 7 | +⌊Sa/10⌋ |
| Esquive PA / PM | 27 / 28 | 160 / 161 | 162 / 163 | fixe | 7 | +⌊Sa/10⌋ |
| Tacle / Fuite | 79 / 78 | 753 / 752 | 755 / 754 | fixe | 4 | +⌊Ag/10⌋ |
| Initiative | 44 | 174 | 175 | fixe | 0,1 | + somme des 4 stats élémentaires |
| Prospection | 48 | 176 | 177 | fixe | 3 | 100 + ⌊Ch/10⌋ |
| Pods | 40 weight | 158 | 159 | fixe | 0,25 | 1000 + 5·(niv−1) + 5·Fo |
| % Rés. Terre/Feu/Eau/Air/Neutre | 33/34/35/36/37 | 210/213/211/212/214 | 215/218/216/217/219 | % | 6 | **plafond 50 % (joueur)** |
| Rés. fixes Terre/Feu/Eau/Air/Neutre | 54/55/56/57/58 | 240/243/241/242/244 | 245/248/246/247/249 | fixe | 2 | réduction fixe |
| Rés. Critiques | 87 | 420 | 421 | fixe | 2 | réduit les do. crit subis |
| Rés. Poussée | 85 | 416 | 417 | fixe | 2 | réduit les dégâts de poussée |
| % Do. mêlée / distance | 125 / 120 | 2800 / 2804 | 2801 / 2805 | % | 15 | multiplicateurs (cf. formules DoMath) |
| % Do. armes / sorts | 122 / 123 | 2808 / 2812 | 2809 / 2813 | % | 15 | multiplicateurs |
| % Rés. mêlée / distance | 124 / 121 | 2803 / 2807 | 2802 / 2806 | % | 10 (INCERTAIN, guides : 15) | multiplicateurs défensifs |
| % Rés. armes / sorts | 142 / 141 | 2811 / 2815 | 2810 / 2814 | % | 15 | (pas de rune) |
| Puissance glyphes | 106 | 1166 | — | fixe | 2 | (pas de rune) |

Caractéristiques **uniquement de combat** (jamais sur un objet, `context: "fightBuff"`) : `% Dommages finaux` (107 ; effets
1171/1172 — Dofus Turquoise/Pourpre/Vulbis, légendaires…), `Puissance sorts` (98 ; 1054), `Puissance armes` (103 ; 1144),
`% Dommages poussée` (158 ; 2414/2415), `% Résistance tous éléments` (101 ; 1076/1077), `% Force/Agi/…` (126-139, en % de la
base), Érosion (75), vols de stats (266-271, `kind: "steal"`), etc. Le moteur et les formules de dégâts (cf. recherche DoMath)
s'en servent ; l'agrégateur de stuff les ignore.

Anomalies notées : effet 159 (−Pods) a `characteristic = 0` dans les données (corrigé via l'effet opposé 158) ; effet 165
« `#2% Dommages #1` » = maîtrise d'arme (pas une ligne d'objet) ; 122 « Échecs critiques » = ancien malus (absent des objets).

### 3.2 Valeurs de base et formules dérivées

Implémentées par DofusDB (`chunk-common` module `b9bf`) — à reprendre telles quelles pour `src/stats` :

| Stat | Formule | Source |
|---|---|---|
| PV | `55 + 5·(niveau−1) + Vitalité totale` (1 050 + Vita au niv. 200) | DofusDB ; https://wow.allakhazam.com/wiki/Life_%28DoFus%29 |
| PA | `min((niveau ≥ 100 ? 7 : 6) + Σ PA, 12)` (plafond 12) | DofusDB ; devblog 2.3.4 |
| PM | `min(3 + Σ PM, 6)` | idem |
| PO | `min(Σ PO, 6)` | DofusDB (6) vs devblog 2.3.4 (9) — **INCERTAIN** |
| Invocations | `min(1 + Σ, 6)` | DofusDB (plafond 6 : INCERTAIN côté jeu) |
| Initiative | `Σ initiative + Fo + Int + Cha + Agi` | DofusDB. MàJ 3.3 : l'initiative ne dépend plus du % de vie |
| Prospection | `100 + ⌊Chance/10⌋ + Σ` | DofusDB |
| Tacle, Fuite | `⌊Agilité/10⌋ + Σ` | DofusDB |
| Esquive PA/PM, Retrait PA/PM | `⌊Sagesse/10⌋ + Σ` | DofusDB |
| Pods | `1000 + 5·(niveau−1) + 5·Force + Σ` | DofusDB (terme `5·(niveau−1)` non vérifié en jeu, sans impact combat) |
| % Rés. élémentaires | `min(Σ, 50)` (joueur) | DofusDB (affichage) + code de dégâts Dofus 3/D2 ; en combat le plafond porte sur `% rés. élém. + % rés. tous éléments` (`HaxeFighter.GetElementMainResist`) |
| Plafonds spéciaux | `min(…, plafond 2897)` si un objet/une panoplie porte « #1 max. #2 » (ex. Malédiction de Cire Momore : PM/PO/Invo max 4→2) | DofusDB module `56dd` |

« Stat totale » d'une caractéristique primaire = `base + additionnel (parchemins) + objets/monture + bonus d'alignement +
contexte` (`getTotalCharac` du client D2). La Puissance n'est **pas** ajoutée à la stat affichée : elle s'ajoute dans la formule
de dégâts (stat + puissance). Le Neutre utilise la Force. Le moteur de dégâts (DoMath) est documenté séparément.

---

## 4. Points de caractéristiques, parchemins, niveaux

- **Points** : 5 par niveau gagné ⇒ `5·(niveau−1)` = **995** au niveau 200 (code DofusDB `Sn`). Les **niveaux Oméga** (>200)
  ne donnent **aucun** point ni stat (devblog 2.45).
- **Coûts par palier** (données `breeds.statsPointsFor*`, identiques pour les 19 classes, Sacrieur compris) :
  `[[0,1],[100,2],[200,3],[300,4]]` pour Force/Intelligence/Chance/Agilité ; Vitalité `[[0,1]]` ; Sagesse `[[0,3]]`.
  Coût pour atteindre `x` dans une stat élémentaire : `x` si x≤100, `100 + 2(x−100)` si ≤200, `300 + 3(x−200)` si ≤300,
  `600 + 4(x−300)` sinon (fonction `bn` de DofusDB : `e + 2r + 3n + 4t`).
  - 995 points dans un élément ⇒ **398** (600 pts pour 300, 392 pts pour +98, 3 points perdus).
  - Variante de survie très courante : **300 élément + 395 Vitalité** (600 + 395 = 995).
  - Sagesse pure : 331 Sagesse (993 pts).
- **Parchemins de caractéristiques** (type 76) : +100 max sur **chacune** des 6 caractéristiques (Vitalité et Sagesse
  incluses), comptés à part (« additionnel ») et **non soumis aux paliers** (MàJ 2.26 ; plafond 100 dans le code DofusDB
  `In`). Un perso THL est supposé « parchoté » : +100 partout.
- **Historique** : le Sacrieur gagnait 2 Vitalité par point ; les données Dofus 3 indiquent 1:1 pour toutes les classes.
- Pas d'autre source permanente pertinente pour l'optimiseur (bonus d'alignement = PvP).

---

## 5. Panoplies

- Données : `/item-sets` (931). `effects[k]` = **bonus total actif avec k+1 objets** équipés (index 0 = 1 objet, souvent vide).
  Paliers **non cumulatifs** : ex. Comte Harebourg 2 objets = `+300 Vi, +60 Fo, +15 Tacle, +30 Ré Pou, +25 Ré Cri, +1 PO, +3 % rés.` ;
  3 objets = le même bloc **avec +5 % rés. au lieu de +3 %** et `+1 PA, +15 Esq. PM, +500 Ini`.
- DofusDB : `activeIndex = min(nbÉquipés − 1, effects.length − 1)` ; `nbÉquipés` = nombre d'objets équipés ayant ce `itemSetId`
  (module `1a46`).
- Les panoplies niv. 200 à 3 objets donnent presque toutes **+1 PA** au palier complet ; quelques-unes donnent plus
  (Harpinoplie : +2 PA +1 PM +1 PO +1 Invo +200 Pui ; Volkorne 5 objets : +1 PA +1 PM ; Reliques de l'Aurore Pourpre 6 objets :
  +2 PA +2 PO ; Ankarton 8 objets : +4 PA… mais objets d'événement à condition `OS=505` et compteur d'utilisation, à exclure).
- Interaction avec les trophées : la condition `Pk<3` compte les bonus de panoplie (§6.3).

---

## 6. Conditions d'objets (`criterions`)

### 6.1 Syntaxe

- Expression booléenne : `&` (ET), `|` (OU), parenthèses. Ex. `PZ=1&((Qa=2037&Qo>14621)|Qa=2038)`, `CP<12|CM<6`.
- Atome = `<code 2 lettres><opérateur><valeur>`, l'opérateur étant en 3ᵉ position (parse client D2 `indexOf(op) == 2`) :
  `>` `<` `=` `!` (différent) `~` (contient/égal souple, ex. `PN~nom`) et quelques opérateurs rares (`#`, `s`, `S`, `e`, `E`, `v`, `i`, `X`, `/`).
- Les comparaisons sont **strictes** : `CA>299` ⇔ Agilité ≥ 300 ; `CP<12` ⇔ PA ≤ 11.

### 6.2 Codes rencontrés sur les 3 878 équipements

| Code | Sens (client D2 `ItemCriterionFactory`) | Nb | Exemple |
|---|---|---|---|
| `CA`/`CC`/`CI`/`CS`/`CV`/`CW` | Agilité / Chance / Intelligence / Force / Vitalité / Sagesse **totales** | 52/49/59/65/7/4 | `CA>299&CS>299` (Baguette de Torkélonia) |
| `Ca`/`Cc`/… (minuscule 2ᵉ lettre) | même stat, valeur **de base** ; `ca`… = additionnel (parchemins) | 0 | — |
| `CP` / `CM` | PA / PM **totaux** | 46 / 40 | `CP<12\|CM<6` (Coiffe Ranshi, Ailes du Chaos, Kidibonnet…) |
| `Ct` / `CT` | Fuite / Tacle totaux | 0 | — |
| `Pk` | Nombre de **bonus de panoplie** actifs | 87 | `Pk<3` (trophées de 3ᵉ génération) |
| `PL` | Niveau | 1 | `PL<6` |
| `PG` | Classe (breed id) | 4 | `PG=3` (Enutrof) |
| `PS` | Sexe | 6 | |
| `Ps` / `Pa` | Alignement (1 Bonta, 2 Brâkmar) / niveau d'alignement | 10 / 3 | |
| `PJ`/`Pj` | Métier `id,niveau` | 24 | `PJ>24,120` |
| `Qa`/`Qf`/`Qc`, `Qo` | Quête active / finie / …, objectif de quête | 25 / 11 | Dofus Sylvestre lié (`Qa=2488\|Qa=2489`) |
| `PZ` | Abonné | 54 (dont 51 compagnons type 169 ; 3 vrais équipements) | compagnons, Crocobur 100 |
| `Oa` | Points de succès | 5 | `Oa>2999` |
| `PO` | Possède un objet (`!` = ne possède pas) | 6 | `PO!10119` |
| `PK` | Kamas | 1 | `PK>49999` |
| `PE` | Émote | 2 | |
| `PN` | Nom du personnage | 5 | objets nominatifs |
| `PX` | Droits de compte (admin) | 6 | |
| `BI` | Objet inutilisable | 14 | |
| `Sc`, `SG`, `Sd` | Critère statique (événement), mois, jour | 7/2/3 | `Sc=968&SG=08&Sd>18` |
| `Pm` | Carte (map id) — **INCERTAIN** : code absent de `ItemCriterionFactory` D2 ; valeurs = ids de carte (`Pm=181404680`) | 5 | |
| `OS`, `Pn` | Inconnus du client D2 (ex. `OS=505` sur la panoplie Ankarton) — **INCERTAIN** | 8 / 1 | |

### 6.3 Sémantique

- **Stats** (`ItemCriterion.getTotalCharac`) : `base + additionnel + bonus d'alignement + modif. de contexte + objets & monture`.
  Pour `CP`/`CM`, la valeur comparée est le total des PA/PM **hors combat** (base 6/7 PA, 3 PM + équipement).
- **`Pk` (BonusSetItemCriterion)** : pour chaque panoplie présente, n objets ⇒ `n − 1` bonus (1 objet = 0) ; `Pk` = somme.
  `Pk<3` ⇒ au plus 2 « bonus » : une panoplie à 3 objets, ou deux panoplies à 2 objets, plus des objets hors panoplie.
  Le guide JOL parle de « Bonus de panoplies < 2 » pour l'ancienne valeur ; les données actuelles disent `Pk<3`.
- **Application** : le client n'évalue la condition qu'avant l'équipement (`isRespected` sur l'état courant). L'intention
  officielle de `PA < 12` est que l'objet « devient inéquipable si le joueur essaie d'atteindre 12 PA avec » (devblog 2.9).
  Le comportement serveur exact (re-vérification et déséquipement automatique après changement de stuff) n'a pas été trouvé
  — **INCERTAIN**. **Politique recommandée pour l'optimiseur** : toutes les conditions doivent être vraies **sur le stuff final**,
  valeurs **brutes avant plafond** (un stuff à 13 PA bruts ne satisfait pas `CP<12`), objet évalué inclus. C'est la lecture la
  plus stricte, conforme à l'intention du devblog et à ce qu'affichent les outils de stuff (conditions en rouge).
- **Codes non-statistiques** : traiter `PZ` comme vrai (abonné), `Q*`/`PJ`/`Oa`/`PG`/`PS`/`Ps` comme des options du profil
  joueur (par défaut vrai pour quêtes/métiers/succès, classe et sexe évalués), et `BI`, `PX`, `PN`, `Pm`, `Sc`, `SG`, `Sd`, `OS`,
  `PO`, `PK`, `PE` comme **faux** (objets d'événement / nominatifs / temporaires exclus par défaut).

---

## 7. Plafonds PA / PM / PO / invocations / résistances

| Plafond | Valeur | Remarques / sources |
|---|---|---|
| PA (hors combat) | **12** | Base 6 (7 dès niv. 100). Devblog 2.3.4 ; DofusDB. Le surplus est simplement perdu ; les buffs de combat peuvent dépasser. |
| PM | **6** | Base 3. Idem. |
| PO bonus | **6** (DofusDB, guides 2026) / 9 (devblog 2.3.4 de 2011) | **INCERTAIN** — paramètre `rangeCap`, défaut 6 (conservateur ; les stuffs méta visent 5-6). |
| Invocations | 6 (DofusDB) | INCERTAIN ; base 1. |
| Exos | 1 exo PA + 1 exo PM + 1 exo PO comptés par personnage | Devblog 2.3.4 ; Gamosaurus ; dofusbuilds 08/2026. Exo Invocation non limité (Gamosaurus). |
| % Résistances (joueur) | **50 %** dans le calcul de dégâts | `MaxResistHuman = 50` / `MaxResistMonster = 100` (Haxe Dofus 3). L'affichage peut dépasser (stuff tank Gamosaurus : 56 % Terre). |
| Érosion | 50 % | `if(totalErosionPercent > 50) totalErosionPercent = 50` (client D2 `DamageUtil.as` l. 2070-2072) ; non retrouvé dans les fichiers Haxe Dofus 3 en cache — supposé inchangé |

Les 12 PA/6 PM sont **l'objectif standard** d'un stuff THL ; « 11 PA / 6 PM » est le compromis tank/placeur courant.
Atteindre 12/6 sans exo impose de cumuler des sources : panoplies (+1 PA chacune au palier complet), Dofus Ocre (+1 PA),
Dofus Vulbis (+1 PM), Volkorne (+1 PA) ou Muldo (+1 PM) en monture, trophées Turbulent (+1 PA −1 PM) / Voyageur (+1 PM),
prysmaradites (Pryssion +1 PA ; Prycipithon +1 PA **−1 PM** ; Sprynt/Ratrapry +1 PM), objets à condition `CP<12|CM<6`
(qui, eux, interdisent justement d'être à 12 PA **et** 6 PM).

---

## 8. Dofus, trophées, prysmaradites, objets légendaires

### 8.1 Règles communes

- 6 emplacements partagés « Dofus/Trophées » ; aucun doublon (même `id`) ; **1 prysmaradite max** (règle antérieure,
  « Rappel : Vous ne pouvez équiper qu'une seule prysmaradite » dans les notes de la MàJ 3.3 du 22/09/2025 ; « 1er
  emplacement uniquement » depuis la 2.54 selon le chercheur initial — non revérifié).
- Trophées (type 151, 261 objets) : 3 générations × (mineur niv. 50 / normal 100 / majeur 150) ; 1ʳᵉ génération sans malus
  (ex. Puissant majeur +40 Pui), 2ᵉ avec malus (Robuste majeur +80 Pui −12 % CC), 3ᵉ avec condition **`Pk<3`** (Vigoureux
  majeur +80 Pui, Érudit/Enragé/Cascadeur/Chanceux majeur +100 stat, Sanguinaire majeur +12 Do tous élém., Remueur +1 PA,
  Nomade +1 PM, Observateur +2 PO). On peut combiner mineur/normal/majeur d'un même trophée (ids différents).
  Trophées récents sans condition : **Arcaniste** (+6 % Do sorts, −6 % rés. distance et mêlée), Impétueux (+6 % Do distance,
  −6 % rés. distance), Pugiliste (+6 % Do mêlée, −6 % rés. distance), Barbare (+6 % Do armes, −3 %/−3 %), Prudent, Audacieux ;
  Turbulent (+1 PA −1 PM), Voyageur (+1 PM −30 Tacle −30 Fuite), Examinateur (+1 PO). Non forgeables.
- Beaucoup d'effets passent par des **sorts passifs** (effet 1175 : `diceNum` = id de sort `/spells/<id>`), à coder dans le moteur.

### 8.2 Dofus (niv. ≥ 100) et leur passif

| Dofus (id) | Niv. | Stats d'objet | Passif (sort) — effet |
|---|---|---|---|
| Dofus Ocre (7754) | 160 | +1 PA | Jaune Ocre (8394) : début de tour, +1 PA si non attaqué depuis son tour, sinon +20 Fuite |
| Dofus Vulbis (6980) | 180 | +1 PM | Rouge Vermeil (8396) : début de tour, +10 % dommages finaux si non attaqué, sinon +20 Tacle |
| Dofus Turquoise (739) | 160 | +10 % CC | Bleu Turquoise (5952) : sur CC, +1 % dommages finaux 3 tours (cumul 10) |
| Dofus Pourpre (694) | 110 | +80 Puissance | Pourpre Profond (8395) : attaqué ⇒ +1 % dommages finaux 2 tours (cumul 10) |
| Dofus Abyssal (18043) | 180 | — | Descente aux Abysses (6828) : début de tour, +1 PM si aucun ennemi au contact, sinon +1 PA |
| Dofus des Glaces (7043) | 180 | +25 Do Neutre/Terre/Feu/Eau/Air | — |
| Dofus Sylvestre (29136) | 180 | +2 PO | Garde Champêtre (28516) : +8 Pui 2 tours par PM utilisé ; 0 PM utilisé ⇒ soin 8 % |
| Dofus Nébuleux (8698) | 180 | — | Rêve Nébuleux (5454) : tours impairs −10 % soins / +20 % do. finaux, pairs l'inverse |
| Dofus Ivoire (7115) | 180 | +4 % toutes rés. | Blanc Ivoire (18665) : −50 % sur 1 attaque sur 5 |
| Dofus Émeraude (737) | 100 | +200 Vitalité | Vert Émeraude (8393) : fin de tour, bouclier 100 % du niveau par ennemi au contact |
| Dofus Tacheté (7112) | 180 | +30 Rés. crit | Harmonie de Pandala (18888) (synergie Dorigami/Domakuro) |
| Dofus Ébène (7114) | 180 | +40 Fuite | Noir Ébène (18629) : alterne mêlée/distance ⇒ +2 % do. de l'autre type (cumul 5) |
| Dofus du Cauchemar (26066) | 180 | +1000 Ini | Éternel Cauchemar (20981) : bouclier si désenvoûté/entravé, +100 Pui si poussée ; les deux ⇒ dommages occasionnés/subis augmentés |
| Dofus Forgelave (19398) | 180 | +100 Rés. poussée | Forge du Volcan (10164) : boucliers sur effets subis |
| Dofus Argenté Scintillant (20286) | 180 | +300 Vitalité | Promesse d'Argent (18672) : <20 % PV ⇒ soin 30 % + 20 % do. finaux (1×/combat) |
| Dofoozbz (31794) | 170 | +2 Invocations | Éclosion Explosive (31607) |
| Domakuro (23237) | 120 | +1 Invocation | Rivière d'Encre (17006) : jusqu'à +16 Dommages cumulés sur 4 tours (moins si on attaque) |
| Dorigami (23408) | 150 | +20 Esq. PM | Tigre de Papier (17307) : bouclier 100 % niv. sur 5 premiers tours |
| Dolmanax (13344) | 100 | +70 Fo/Int/Cha/Agi | — |
| Dofus Cawotte (972) | 60 | +60 Sagesse | Sagesse Wabbit (8418) : tentative de retrait PA/PM subie ⇒ +25 Esq. PA ou PM 1 tour |
| Dom de Pin (27803) | 180 | +1 PO | — |

### 8.3 Prysmaradites et objets légendaires niv. 200 (passifs, effet 1175)

Stats d'objet dans DofusDB (`/items/<id>`) ; passifs via `/spells/<id>` (descriptions du jeu, résumées) :

Lignes de stats des prysmaradites (données) : Pryssion Mate/Brillante/Iridescente +1 PA −50 Do pou ; Prycipithon ×3 +1 PA −1 PM ;
Sprynt +1 PM −1 PO ; Ratrapry +1 PM −40 Tacle ; Surpryz +10 % CC −1000 Ini ; Prysmenvout +80 Pui −1000 Ini ; Supprys +40 Soins
−1000 Ini ; Prynyang −2 PO +25 Do crit ; Pryximite +6 % Do armes −30 Ré pou ; Prygen +200 Vi −1 Invo ; Caraprys −1 PM +2 Invo ;
Espryt +20 Ret PA/PM −20 Esq ; Korprys +30 Esq PA/PM −30 Ret ; Prymune +3 % toutes rés. −30 Esq ; Prytek ×3 −100 Vi +40 rés. fixes ;
Aprybou −1000 Ini +40 rés. fixes ; Prysmaru +1000 Ini −30 Esq ; Prysantor +30 Ré crit −30 Ré pou ; Indeprys −25 Ré crit +100 Ré pou.
La MàJ 3.3 a fusionné les variantes Brillante/Iridescente de **5** prysmaradites : Prygen, Telprys (→ Caraprys),
Aprykou (→ Prynyang), Ratrapry, Surpryz — elles n'ont bien **qu'une** entrée dans les données (22010, 22018, 22004,
22007, 22001). Les trois variantes Mate/Brillante/Iridescente de **Prytek, Pryssion et Prycipithon** n'étaient pas
concernées et existent toujours (même ligne de stats, passif différent). Pas d'incohérence données/patch notes.

| Objet (id) | Sort passif (id) | Effet (résumé du jeu) |
|---|---|---|
| Crocobur (20353) | Appétit de Crocobur (11352) | À chaque début de tour, le porteur s'inflige 15 de dommages dans son meilleur élément d'attaque pour infliger les mêmes dommages en vol de vie aux … |
| Ciseaux du Destin (20354) | Destin Fatidique (11354) | À chaque fin de tour, le porteur partage les dommages entre les ennemis dans un carré de taille 1 et augmente les dommages qu'ils subissent de 6% p… |
| Frisson de Brumaire (20355) | Froid de Novamaire (12147) | À chaque fin de tour, le porteur retire 1 PA aux ennemis à son contact pendant 1 tour (cumulable 1 fois). Lorsqu'un combattant ennemi est achevé, l… |
| Plume de Buhorado (20356) | Plume de Buhorado (11357) | Lorsque le porteur effectue un coup critique, il gagne 10 de Dommages Poussée pendant 3 tours (cumulable 10 fois). |
| Droiture de Fallanster (20357) | Droiture de Fallanster (11358) | Lorsque le porteur termine son tour en ligne de vue d'un ennemi, il pose un glyphe-aura dans un carré de taille 1 qui réduit les dommages subis par… |
| Trompe-la-Mort (20358) | Trompe-la-Mort (11359) | Lorsque le porteur a plus de 50% de sa vie, ses dommages finaux sont augmentés de 7%, mais il perd 10% de sa vie à chaque début de tour. Lorsqu'il … |
| Couronne de Brâm Barbe-Monde (20359) | Roi sous la Montagne (11360) | Lorsque le porteur effectue ou subit une tentative de retrait de PA ou PM, il gagne 2% de dommages finaux pendant 2 tours (cumulable 5 fois). Les e… |
| Diadème de Ganymède (20360) | Sagesse de Ganymède (11361) | Le porteur gagne 2 PA les tours pairs, et perd 1 PA et 1 PM les tours impairs. |
| Bravoure de Rykke Errel (20361) | Bravoure de Rykke Errel (11363) | Lorsque le porteur subit une attaque à distance, il gagne 10% de son niveau en bouclier et perd 1% de dommages à distance pendant 1 tour par case d… |
| Noblesse de Jahash Jurgen (20362) | Assimilation Élémentaire (11365) | Lorsque le porteur subit des dommages dans un élément, il gagne 4% de résistance dans cet élément pendant 2 tours (cumulable 5 fois, partagé entre … |
| Bottes de Mille Lieues (20363) | Mille Lieues (11366) | Le porteur gagne 2 PM les tours impairs. |
| Bottes du Cul Botté (20364) | Les Culs Bottés (11367) | À chaque début et fin de tour, le porteur repousse de 2 cases les entités à son contact. |
| Audace de Dodge (20365) | Audace de Dodge (11368) | À chaque début de tour, le porteur se téléporte ou échange de position sur une case adjacente aléatoire et gagne 1 PM et 10% Critique, ou n'est pas… |
| Courage de Dame Jhessica (20366) | Courage de Dame Jhessica (11369) | À chaque fin de tour, le porteur retire 60 de Fuite aux ennemis à son contact et gagne 1% de dommages aux sorts pour chaque ennemi touché pendant 1… |
| Hachebarde de Guerre (22368) | Guerre de Positions (15739) | À chaque fin de tour, le porteur retire 2 PM aux ennemis à son contact pendant 1 tour (cumulable 1 fois). Lorsqu'un combattant ennemi est achevé, l… |
| Pestilence de Corruption (22412) | Nuée Pestilentielle (15975) | Lorsque le porteur remonte à 90% de sa vie, il applique un poison de début de tour de 18 dans son meilleur élément d'attaque sur les entités à 2 ca… |
| Étreinte de Servitude (22429) | Fers de la Tyrannie (15984) | À chaque fin de tour, le porteur attire les entités à 3 cases ou moins alignés à lui. S'il n'y a aucune entité à son contact, il devient Indéplaçab… |
| Balance-Fléau de Misère (22444) | Épreuve de la Balance (15996) | Lorsque le porteur subit une tentative de retrait de PA, de PM ou de Portée, il vole 2% de résistances à son attaquant pendant 2 tours (cumulable 4… |
| Ardeur d'Oto Mustam (32114) | Ardeur de la Cité Sombre (31856) | À chaque début de tour, le porteur et ses alliés gagnent 1% de dommages finaux pendant 1 tour pour chaque combattant ennemi en vie (cumulable 4 fois). |
| Bouclier Miroir (32115) | Reflet Aveuglant (31857) | Le porteur réduit et renvoie 75% des dommages initiaux de la première attaque alliée subie à l'ennemi le plus proche de lui dans sa ligne de vue (u… |
| Lance-Éclair de Menalt (32116) | Ordre du Tonnerre (31859) | À chaque fin de tour, le porteur donne 1 PM et 40 Dommages Poussée pendant 1 tour à tous les alliés dans sa ligne de vue (cumulable 1 fois). Lorsqu… |
| Jugement de Thanatena (32117) | Jugement de Thanatena (31860) | À chaque début de tour, le porteur érode et augmente les dommages subis par tout le monde de 4% pendant 1 tour (cumulable 1 fois). Lorsqu'il achève… |
| Amour d'Helséphine (32118) | Amour d'Helséphine (31861) | Lorsque le porteur applique du bouclier ou occasionne des dommages en mêlée, il soigne ses alliés de 8% de leur vie à 3 cases ou moins autour de lu… |
| Ponctualité d'Henual (32119) | Ponctualité d'Henual (31862) | Lorsque le porteur subit une tentative de retrait de PA ou de PM, il est téléporté à sa position précédente, une fois maximum pour chaque type de r… |
| Clairvoyance de Mériana (32121) | Clairvoyance de Mériana (31858) | Lorsque le porteur occasionne des dommages élémentaires, il gagne du Retrait selon l'élément pendant 2 tours (cumulable 8 fois, partagé entre les e… |
| Indeprys (32164) | Indeprys (31881) | Le porteur est Indéplaçable tant qu'il n'a pas subi de dommages. S'il en subit, la durée de l'état passe à 1 tour. |
| Prytek Mate (21451) | Prytek Mate (14762) | Le porteur gagne 550% de son niveau en bouclier au premier tour, puis 200% au deuxième tour, et 100% au troisième tour. |
| Prytek Brillante (21452) | Prytek Brillante (14763) | Le porteur gagne 150% de son niveau en bouclier au premier tour, puis 450% au deuxième tour et 150% au troisième tour. |
| Prytek Iridescente (21453) | Prytek Iridescente (14764) | Le porteur gagne 100% de son niveau en bouclier au premier tour, puis 200% au deuxième tour et 350% au troisième tour. |
| Sprynt (21995) | Sprynt (14902) | Le porteur est Intaclable tant qu'il n'a pas occasionné de dommages. S'il en occasionne, la durée de l'état passe à 1 tour. |
| Pryssion Mate (21996) | Pryssion Mate (14903) | Le porteur sacrifie 10% de dommages finaux pour gagner 1 PA pendant 3 tours. |
| Pryssion Brillante (21997) | Pryssion Brillante (14904) | Le porteur sacrifie 35% de dommages finaux pour gagner 2 PA pendant 2 tours. |
| Pryssion Iridescente (21998) | Pryssion Iridescente (14905) | Le porteur sacrifie 50% de dommages finaux pour gagner 3 PA pendant 1 tour. |
| Surpryz (22001) | Surpryz (14908) | Le porteur gagne 100% de Critique au premier tour, puis 35% au deuxième tour, et 15% au troisième tour. |
| Prynyang (22004) | Prynyang (14913) | Le porteur sacrifie 10% de résistance pour gagner 10% de dommages finaux au premier tour, puis gagne 3% de dommages finaux et de résistance au deux… |
| Ratrapry (22007) | Ratrapry (14919) | Le porteur gagne 1 PM pendant 1 tour pour chaque combattant ennemi à plus de 9 cases de lui au début des 3 premiers tours de jeu (cumulable 3 fois). |
| Prygen (22010) | Prygen (14926) | Soigne 60% des dommages ennemis subis au premier tour, puis 30% au deuxième tour, et 10% au troisième tour. |
| Prycipithon Mate (22011) | Prycipithon Mate (14930) | Le porteur gagne 2 PA au premier tour. |
| Prycipithon Brillante (22012) | Prycipithon Brillante (14931) | Le porteur sacrifie 2 PM pour gagner 3 PA au premier tour. |
| Prycipithon Iridescente (22013) | Prycipithon Iridescente (14932) | Le porteur sacrifie 4 PM pour gagner 4 PA au premier tour. |
| Espryt (22014) | Espryt (14933) | Le porteur gagne 100 de Retrait au premier tour, puis 50 au deuxième tour, et 25 au troisième tour. |
| Korprys (22015) | Korprys (14934) | Le porteur gagne 200 d'Esquive au premier tour, puis 100 au deuxième tour, et 50 au troisième tour. |
| Caraprys (22018) | Caraprys (14939) | Le porteur donne 15% de résistances à ses invocations au premier tour, puis 10% au deuxième tour, et 5% au troisième tour. |
| Prysmaru (22019) | Prysmaru (14940) | Le porteur devient invisible pendant 1 tour au début de son premier tour de jeu. L'invisibilité ne se dissipe pas lorsqu'il attaque, mais elle est … |
| Prysmenvout (22020) | Prysmenvout (14941) | Le porteur réduit la durée des effets actifs sur lui de 4 tours au début de son premier tour de jeu. |
| Supprys (22021) | Supprys (14943) | Le porteur augmente les soins reçus par ses combattants alliés de 10% pendant son tour de jeu au premier tour, puis de 35% au deuxième tour, et de … |
| Aprybou (22022) | Aprybou (14945) | Le porteur gagne 200% de son niveau en bouclier jusqu'à la fin du combat au début du premier tour de jeu de chaque combattant ennemi qui joue avant… |
| Pryximite (22023) | Pryximite (14948) | Le porteur gagne 2% de dommages en mêlée pendant 3 tours pour chaque combattant ennemi à 3 cases ou moins de lui au début et à la fin de son premie… |
| Prymune (22024) | Prymune (14949) | Le porteur réduit tout type de dommages subis de 80% au premier tour. |
| Prysantor (22025) | Prysantor (14950) | Le porteur est dans l'état Pesanteur tant qu'il n'a pas subi de dommages. S'il en subit, la durée de l'état passe à 1 tour. |

---

## 9. Familiers, montiliers, montures

- **Un seul slot** pour familier (type 18), montilier (121) ou monture (331 Dragodinde, 332 Muldo, 333 Volkorne).
- **Familiers** : depuis la refonte 2.48 (2018) ils ne meurent plus (« ne disposeront plus de points de vie ») et gagnent
  de l'expérience en étant nourris de ressources ; leur niveau « varie de 0 à 100 et chaque niveau débloqué augmentera
  donc le bonus apporté par votre familier » (devblog JOL 54999). La **proportionnalité exacte** (niv. 50 ⇒ 50 % des
  bonus, arrondi) n'est **pas** écrite dans la source : **INCERTAIN**, hypothèse linéaire `round(max × niveau/100)`.
  Les valeurs DofusDB (`possibleEffects`, `diceSide = 0`) sont les valeurs **maximales** (niv. 100) ; niveau requis 20. Exemples : Vampyrette +400 Vi +40 Fuite ; Bwak +50 Pui +25 % rés. élém. ;
  Booftrool blanc +70 Pui +15 % CC ; Dragoune Dorée +2 PO +40 Esq. PA ; Sourisette +2 PO +2000 Ini.
- **Montiliers** : niveau 60 requis, bonus directement au maximum. Ex. Kougnard +1 PA +2000 Ini ; Phorror +10 % CC +1 PM ;
  Sakochère +1 PA +50 Do crit ; Balafreux +1 PM +100 Do pou ; Koliphant +120 stat +15 % CC ; Siroko/Dehluge/Kompost/Brûlih +160 stat.
- **Montures (MàJ 3.5, 03/03/2026)** : les montures sont désormais des **objets** (types 331-333, `level` 60 = niveau minimum
  pour monter, cf. `CHAR_MIN_LEVEL_RIDE = 60`), niveau de monture **1 → 200**. Les valeurs DofusDB des objets 331-333 sont
  les valeurs max (Vitalité 400 sur les Dragodindes ; le service `/mounts`, antérieur, affiche encore 300 = valeur niv. 100).
  - Dragodindes : +400 Vitalité + stats (ex. Amande et Ébène : +90 Agi +1200 Ini ; Amande et Dorée : +1 Invocation +1200 Ini ; Amande : +1700 Ini).
  - **Muldos : +1 PM** + résistances / esquives / Do crit (ex. Ivoire : +1 PM +50 Esq. PA).
  - **Volkornes : +1 PA** + rés. / poussée / CC / stat (ex. Améthyste : +1 PA +14 % rés. Air).
  - Progression : « Vitalité plafonnée à 300 au niveau 100, puis à 400 au niveau 200 » (next-stage 04/2026), progression
    plus lente après 100. La loi exacte (linéaire ? arrondi ?) est **INCERTAIN** ; pour l'optimiseur on suppose une monture niv. 200.
  - Les PA/PM des montures et familiers comptent dans les plafonds 12/6 (bonus d'objets).

---

## 10. Consommables (optionnel)

Friandises/bonbons (type 42) qui posent des « Goûts » (type 28) pour N combats, ex. Shigekax Melon +1 PA, Vanille +5 % CC,
Chocolat +15 Vi/Fo/Int/Cha ; Bénédictions (type 29) +25 stat ou +5 % rés. Les plafonds 12 PA / 6 PM s'appliquent aux
consommables (devblog 2.3.4 : la restriction concerne « les bonus apportés par les équipements et les bonus temporaires
apportés par les consommables »). MàJ 3.3 : nouveaux consommables d'initiative de pêcheur (±100/200/500 Ini, 1 combat),
« cumuler jusqu'à 4 » à la fois, pas deux fois le même. Règles de cumul des bonbons/bénédictions **INCERTAIN** → option
désactivée par défaut.

---

## 11. Forgemagie et exos

### 11.1 Poids des runes

Le poids d'un point de caractéristique = `|effectPowerRate|` de l'effet (données du jeu), identique aux tables des guides
(Ga Pa 100, Ga Pme 90, Po 51, Invo 30, Do 20, Do Per 15, Cri/So 10, Ret/Esq 7, Ré Per 6, Do élém./Cri/Pou/Pi 5, Tac/Fui 4,
Sa/Prospe 3, Pui/Ré fixes 2, stats 1, Pod 0,25, Vi 0,2, Ini 0,1). Valeurs des runes (`/items?typeId=78`, 105 runes) :
Rune/Pa/Ra = ×1/×3/×10 (Vi 5/15/50, Ini et Pod 10/30/100). Le détail par effet est dans `forgemagie.json → runeWeights`.

Désaccords : Vitalité **0,2** (données ; Rune Vi = +5 pour poids 1) contre 0,25 sur dafous.app (ancienne valeur, Vi over 404) ;
Renvoi **5** (données, JOL) contre 10 (dafous.app) ; Ré Per Mé/Di **10** (données) contre 15 (JOL). → INCERTAIN, on garde les
données du jeu. Les lignes négatives ont en général un `powerRate` égal à −½ du positif (sert au calcul de « puissance »
d'objet) ; exceptions : 145 −Dommages = −5 (−¼ de 20), 159 −Pods = +0,125 (signe et `characteristic` anormaux).

### 11.2 Mécanique (synthèse Gamosaurus/dafous.app)

- Résultats : **succès critique** (la rune passe sans perte), **succès neutre** (passe, d'autres lignes perdent ≈ son poids),
  **échec critique** (ne passe pas, pertes ; l'excédent alimente le **puits**).
- **Puits** = `poids perdu − poids utilisé` ; propre à l'objet, absorbe les pertes futures, sert à passer overs/exos (hors PA/PM/PO) ;
  perdu si l'objet est échangé/mis en vente.
- **Overmax** : ligne ≤ **101 de poids** (Vitalité 505, stat 101, Sagesse 33, CC 10, Pui 50, Do élém. 20, Ré % 16), sauf si
  le jet max naturel dépasse déjà 101 (alors pas d'over) — Gamosaurus : « Une statistique ne peut pas dépasser le poids
  total de 101, sauf si le jet théorique de l'item le permet » (101 × 5 = 505 Vitalité). Au niveau 190-200, d'après les
  514 objets non-armes analysés, la Vitalité médiane max est 350 (poids 70), les stats élémentaires 60 (max 100), la
  Sagesse 40 (poids 120, donc souvent pas d'over possible), les Do élém. 12 (max 20-25) : `forgemagie.json →
  typicalLevel200Lines` (`shareWithOvermaxRoom` = part des lignes où `(jet max + 1 incrément de rune) × poids ≤ 101` ;
  0 pour PA/PM/PO). L'over n'est donc **pas** marginal en théorie, seulement cher.
- **Exos** : PA/PM/PO **et Invocation** ≈ **1 %** de succès critique par rune (Ga Pa / Ga Pme / Po / Invo), sans besoin de
  puits (Gamosaurus : « Certains Exos ne nécessitent pas de puits : les exos PA, PM, PO ou Invo », « le succès critique
  n'a que 1% de chance ») ; un seul exo PA, un seul PM, un seul PO comptés par personnage (devblog 2.3.4 : « il ne sera
  pas possible de cumuler plus de 1 PA, 1 PM, 1PO via des bonus de forgemagie exotique ») ; Invo non limitée. Autres
  stats exo via le puits (Do, Pui, Ré %, Do Crit…). Le puits disparaît si l'objet est échangé, mis en vente ou déplacé
  (inventaire de monture…).
- **Transcendance** (81 runes, type 211, Songes Infinis) : 100 % de réussite, effet 2825 « Empêche les futures forgemagies »,
  exige un objet sans over ni exo. Paliers Ta/Pata/Rata (niv. 104/126/148 pour les stats, jusqu'à 200) : ex. Rata Vi +100,
  Rata Fo +20, Rata Pui +12, Pata Cri +2, Rata Do élém. +6, Pata Do Cri +8, Ta Ré Per élém. +2 %, et **Ta Do Per So / Ta Do Per
  Di / Ta Do Per Mé / Ta Do Per Ar / Ta Ré Per Mé / Ta Ré Per Di = +1 % (niv. 200)**. Règle de niveau rune ↔ objet INCERTAIN.
  next-stage (03/2026) : « Votre item ne doit posséder ni over ni exo. Au maximum, il peut être à jet parfait » ; si la
  rune porte sur une ligne existante et crée un over, la règle de densité ≤ 100 s'applique ; l'objet devient ensuite
  « intouchable pour toute forgemagie ultérieure ». Nombre max de transcendances par stuff : non documenté (une par objet).
- **Gravures** (type 258) : changent définitivement l'élément des dégâts neutres d'une arme, en gardant **85 %** des dégâts
  de base (Incendie/Ouragan/Séisme/Tsunami, niv. 80) ou **50 %** (Étincelle/Courant d'air/Secousse/Crachin, niv. 20) — effet 700 :
  `value` = % conservé, `diceSide` = élément cible (58 Feu, 59 Air, 60 Terre, 61 Eau ; vérifié sur les 8 gravures).
  « Seul le vol de vie est modifié par cette gravure » (texte du jeu). (dofusbuilds : `floor(dégâts × 0,85)`.)
- **Orbes régénérants** (type 189) : re-tirent les jets d'un objet de niveau ≤ orbe (60/120/180/200).

### 11.3 Ce que l'optimiseur doit modéliser (profils réalistes)

| Profil | Jets | Exos | Transcendances | Usage |
|---|---|---|---|---|
| `average` | moyenne `(min+max)/2` | — | — | joueur moyen |
| `perfect` | max (`diceSide`) ; lignes négatives : DofusDB prend le malus **maximal** (`to`), un « vrai » jet parfait prendrait le malus minimal (`diceNum`) — option `negativeRoll: "worst"|"best"`, défaut `worst` comme DofusDB | — | — | défaut DofusDB/DofusBook |
| `thlStandard` | max | 1 exo PA **ou** PM (anneau/amulette) | — | THL courant |
| `thlOptimized` | max | exo PA + exo PM (2 objets) | Ta Do Per So sur ~6 autres objets (+6 % Do sorts) | THL optimisé (stuffs Gamosaurus) |

Paliers de coût (`costTier`, 0-5) et rareté pour chaque option dans `forgemagie.json → exoOptions` (exo PA/PM : 5 ; PO : 4 ;
transcendance Do Per So : 4 ; Invo/Do : 3 ; Pui/Do Crit/Ré % : 2). Les prix en kamas varient selon les serveurs (INCERTAIN).
Alternative à l'exo PA : la Pata Vi (+75 Vi) en transcendance sur une coiffe tank (Gamosaurus).

---

## 12. Méta PvM niveau 200 (2025-2026) — pour valider l'optimiseur

### 12.1 Panoplies et objets par élément (guides Gamosaurus 12/2024 et Guidactik 2026)

| Élément | Panoplies / objets cités au niveau 200 |
|---|---|
| Terre | Comte Harebourg, Brouce Boulgoure, Tréfonds ; Cœur Saignant + Brouce + 2 Torkélonia (Corne/Baguette) + Bague de Corruption + Kokulte (familier) — 12 PA/6 PM, 82 % CC, ~1 250 Force |
| Feu | Otomaï, Séculaire ; Coiffe/Amulette/Ceinture Séculaire + Cape/Sabres d'Atcham + Cycloïde (bouclier, anneau, bottes) + Anneau de Padgref + Bisouglours — ~1 370 Int, 63 % CC |
| Eau | Danathor, Fosse ; Danathor (coiffe, ceinture, L'Écu de Danathor) + Sinistrofu (cape, bottes, amulette) + Anneaux Volkorne & Rtograf + Dagoulinantes + Kanigloups — 1 458 Cha, 51 % CC, 4 103 PV, 12 PA/6 PM/6 PO, exos PA/PM sur les anneaux, « Ta Do Per So » pour ~6 % Do sorts (Gamosaurus 12/2024) |
| Air | Allister, Valet Veinard ; Couronne/Anneau/Bottes d'Allister + Cycloïde (bouclier, anneau, amulette) + Submergée (Cape de Crânonier, Sangle Oriole, Lance Horselé) + Blérodoudou — ~1 420 Agi, 67 % CC, 5 PO |
| Tank | Anerice (cape, bouclier), Casque Dragoeuf, Baleinabottes, Pol Ouatnos, Alliance Gloursonne, Courage de Dame Jhessica — ~4 950 PV, 11 PA/6 PM, ~230 Tacle, rés. 39-56 % |
| Sagesse/retrait | Léthaline, Ougah, Ventouse, Kralano/Annolamour, Dofus Cawotte (niv. 199 : ~1 050 Sagesse, 117/123 retrait PA/PM) |

**Dofus récurrents** : Ocre, Vulbis, Turquoise, Abyssal, des Glaces, Sylvestre ; puis Pourpre, Dolmanax, Ivoire, Émeraude
(tank). **Trophées** : Équilibriste majeur (air), Obstructeur/Bloqueur majeurs (tacle), Audacieux ; et désormais Arcaniste
pour les classes à sorts. **Prysmaradite** : 1 max (souvent un +1 PA/+1 PM pour fermer 12/6).
Profils de stats typiques à vérifier : 12 PA / 6 PM, 1 250-1 460 dans l'élément principal, 3 900-4 150 PV (élément pur,
parchoté), 60-82 % CC pour les builds critiques, 5-6 PO, Do élém. 100-150, Do crit 100-140.

### 12.2 Vecteur de validation calculé avec nos règles (stuff Terre Gamosaurus)

Objets : Corne de Torkélonia, Cape du Cœur Saignant, Écorce de Brouce (bouclier), Baguette de Torkélonia, Kokulte,
Amulette du Cœur Saignant, Anneau de Brouce, Bague de Corruption, Ceinture de Brouce, Bottes du Cœur Saignant ;
Dofus Abyssal, Ocre, Vulbis, des Glaces, Turquoise, Sylvestre. Jets max, panoplies Torkélonia (2), Cœur Saignant (3),
Brouce (3), base 398 Force + parchemins 100.

| Stat | Calcul DofusSimu (règles §3/§5) | Guide |
|---|---|---|
| % CC | **82** | 82 ✔ |
| Sagesse | **415** (315 + 100 parchemin) | 415 ✔ |
| Force | 1 258 | 1 246 (≈, version d'objet) |
| PA / PM | 11 / 5 hors exos | 12 / 6 → le guide suppose **exo PA + exo PM** (cohérent avec ses conseils de FM) |
| PO | 4 (+2 si Dofus Sylvestre 29136 au lieu de la version liée 29134) | 6 ✔ |

Remarque : la Baguette de Torkélonia exige `CA>299&CS>299` ; le guide affiche 300 Agi (notre calcul : 250) ⇒ la condition
impose une source d'Agilité supplémentaire (exo/parchemin/version d'objet) : bon exemple de contrôle de conditions.

### 12.3 Second vecteur de validation (stuff Eau Gamosaurus, 12/2024 — ajouté lors de la vérification)

Objets (ids) : Coiffe de Danathor 13120, L'Écu de Danathor 30690, Ceinture de Danathor 13122, Cape/Amulette/Bottes du
Sinistrofu 14085/14086/14087, Dagoulinantes 18017, Kanigloups 11950 (familier, valeurs max), Anneau Volkorne 19985,
Anneau Rtograf 24035 ; Dofus Abyssal, Sylvestre 29136, Vulbis 6980, des Glaces, Turquoise, Ocre. Panoplies Danathor (3)
et Sinistrofu (3) ; Fosse et Volkorne à 1 objet (aucun bonus). Base 398 Chance + parchemins 100 partout.
Source : https://www.gamosaurus.com/jeux/dofus/dofus-unity-stuff-eau-niveau-200.

| Stat | Calcul (règles §3/§5, jets max) | Guide |
|---|---|---|
| Chance | **1 458** (398 + 100 + 960) | 1 458 ✔ |
| % CC | **51** | 51 ✔ |
| PO | **6** | 6 ✔ |
| PV | 4 100 (1 050 + 100 parchemin + 2 950) | 4 103 (≈) |
| PA / PM | 11 / 5 | 12 / 6 → exo PA + exo PM (le guide les place sur les deux anneaux) |

Ce second stuff confirme les règles de cumul (panoplies non cumulatives, palier = nombre d'objets) et la logique
« 11/5 + 2 exos = 12/6 » des stuffs THL.

---

## 13. Comment DofusDB (et DofusBook) calculent les totaux — algorithme recommandé pour `src/stats`

DofusDB (code récupéré, cf. §1) :

```text
items = [amulet, helmet, cape, ring1, ring2, shield, boots, belt, dofus×6, weapon, pet] (non nuls)
valeurObjet(item, carac) = Σ effects[e].to || effects[e].from  pour e.characteristic == carac   // jet max signé
                           // (pour une ligne négative « -4 à -5 », to = -5 : DofusDB prend le pire malus)
                           (ou valeur forgemagée saisie par l'utilisateur, + exos par objet)
setCount[setId] = nb d'items avec itemSetId == setId
bonusPano(carac) = Σ_sets  set.effects[min(n−1, len−1)] où characteristic == carac
d(carac) = base[carac] + parchemin[carac] + Σ valeurObjet + bonusPano + exoGlobal[carac]
cap(carac) = min des « #1 max #2 » (effet 2897) des objets/panoplies, sinon +∞
PA = min((niv≥100?7:6) + d(PA), cap, 12); PM = min(3 + d(PM), cap, 6); PO = min(d(PO), cap, 6); Invo = min(1 + d(Invo), cap, 6)
PV = 55 + 5(niv−1) + d(Vita) ; Pods = 1000 + 5(niv−1) + 5·Force + d(Pods)
Ini = d(Ini) + Agi + Cha + Int + Fo ; Prospection = 100 + ⌊Cha/10⌋ + d(Prosp)
Tacle/Fuite = ⌊Agi/10⌋ + d(·) ; Esquive/Retrait PA/PM = ⌊Sa/10⌋ + d(·) ; %Rés = min(d(·), 50)
points restants = 5(niv−1) − Vita − 3·Sa − coût(Fo) − coût(Cha) − coût(Agi) − coût(Int)
```

DofusBook (non consultable ici, 403) fonctionne de la même façon d'après ses utilisateurs (jets max par défaut, édition
ligne à ligne, exos/overs, parchemins, conditions signalées en rouge) — **INCERTAIN** dans le détail.

**Améliorations à apporter dans DofusSimu par rapport à DofusDB** :
1. Exos PA/PM/PO : ne compter qu'**un** exo de chaque type (DofusDB additionne sa liste d'exos).
2. Une seule prysmaradite (règle en vigueur, rappelée en 3.3) ; pas de transcendance + exo/over sur un même objet.
3. Vérifier les conditions (§6.3) sur l'état final, valeurs brutes avant plafond.
4. Familier : bonus × niveau/100 ; monture : niveau 200 supposé (ou paramètre).
5. Conserver séparément les stats « plafonnées » et « brutes » (utile pour `CP<12`, et pour savoir qu'un exo est gaspillé).
6. Passifs (effet 1175) : transmis au moteur de combat, pas sommés dans les stats.
7. Paramètres INCERTAIN exposés : `rangeCap = 6`, `summonCap = 6`, `resistCapPlayer = 50`, `mountLevel = 200`,
   `petLevel = 100` (bonus supposé linéaire), `negativeRoll = "worst"`.
8. **Ne pas** implémenter de règle « arme à deux mains ⇒ pas de bouclier » (supprimée en 2.41) ; exclure de l'optimiseur
   les pierres d'âme / filets (types 83, 99) et les compagnons (type 169).

---

## 14. Points ouverts / INCERTAIN

- Plafond de PO (6 vs 9) et d'invocations (6 ?) dans Dofus 3.
- Re-vérification serveur des conditions après changement d'équipement (déséquipement automatique ? ordre d'équipement ?).
- Codes de condition `OS` et `Pn` (inconnus du client D2).
- Loi de progression des stats de monture entre les niveaux 1 et 200 (3.5) ; loi (linéaire ?) et arrondis des bonus de
  familier selon son niveau 0-100.
- Plafond « brut » ou « plafonné » utilisé par le serveur pour `CP`/`CM` (la valeur `objectsAndMountBonus` envoyée au
  client est-elle déjà plafonnée à 12/6 ?).
- Poids FM de Renvoi (5 vs 10) et de Ré Per Mé/Di (10 vs 15) ; taux exact d'exo PA/PM/PO ; règle de niveau des runes de transcendance.
- Coût réel (kamas) des exos et transcendances par serveur (seulement des paliers relatifs ici).
- Règles de cumul des consommables (bonbons/bénédictions) avec les plafonds.

---

## 15. Vérification (revue adverse du 2026-10-04)

Revue indépendante des affirmations principales contre les sources primaires (API DofusDB live, code JS DofusDB en cache
`.cache/equipment/ddbjs/`, client D2 décompilé `.cache/equipment/d2/`, code Haxe Dofus 3 `.cache/domath/haxe/`, pages
guides/devblogs). Réponses live mises en cache dans `.cache/verify-equipment/`.

**Vérifié, conforme :**
- Totaux API : 872 effets, 123 caractéristiques, 21 776 objets, 931 panoplies, 266 montures ; comptes par type (1, 9, 10,
  11, 16, 17, 82, 18, 121, 331-333, 23, 151, 217) et niveau 190-200 du tableau §2.2 identiques à l'API.
- `characteristics-map.json` : 247/248 effets recoupés avec `/effects` live (le 205 n'existe pas dans l'API, comme noté) :
  `characteristic`, `effectPowerRate`, `oppositeId`, gabarit `fr` identiques ; le `sign` des 108 entrées `stat` correspond à
  `characteristicOperator` (+/−) sauf 122 (Échecs critiques, absent des objets, note ajoutée) et 183/184 (opérateur `/`,
réductions magique/physique, absentes des objets). Couverture : les 150 ids
  d'effets présents sur les 3 878 objets et les 931 panoplies sont tous dans la carte. `onItems`/`onSets` recalculés à
  l'identique (ce sont des nombres de lignes/paliers, précisé en §3).
- 15 objets tirés au hasard dans `data/dofusdb/equipment.json` identiques à l'API live (effets, niveau, type, panoplie,
  conditions) ; Coiffe du Comte Harebourg 14076 et panoplie 270 (paliers non cumulatifs) conformes.
- Formules du stuff creator DofusDB (modules `b9bf`, `56dd`, `1a46`, `ece7`, fonctions `bn`, `Sn`, `wn`, `In`, `vn`) relues :
  PA/PM/PO/Invo/PV/Pods/Ini/Prospection/Tacle/Fuite/Esquive/Retrait/rés. % 50, palier de panoplie `min(n−1, len−1)`,
  plafonds 2897 (`diceNum` = carac., `diceSide` = max ; vérifié sur la panoplie 507), anneaux de panoplie, Dofus sans doublon.
- Coûts de caractéristiques des 19 classes (`/breeds` live) : identiques, Vitalité 1:1, Sagesse 3:1 ; 398 / 331 / 995 OK.
- `Pk` (D2 `BonusSetItemCriterion`) = Σ max(0, n−1) : tracé du code confirmé ; 87 trophées `Pk<3` ; opérateurs stricts
  (`ItemCriterionOperator.compare`) ; `getTotalCharac` = base + additionnel + alignement + contexte + objets/monture.
- Plafond de résistance 50/100 (`HaxeFighter.cs` l. 13-14, 1235) et D2 (`DamageUtil.as` l. 2360).
- Dofus (21 lignes) : ids, niveaux, stats et sorts passifs conformes à l'API ; descriptions des passifs relues.
  Tableau §8.3 : 50 couples objet ↔ sort passif conformes ; lignes de stats des 25 prysmaradites conformes.
- Montures (types 331-333, niv. 60, 400 Vi / +1 PM / +1 PA), montiliers et familiers cités : conformes.
- `forgemagie.json` : 103 runes (+ Signature + chasse = 105) et 81 runes de transcendance comparées à l'API live (id, nom,
  niveau, effet, valeur, poids = |effectPowerRate| × valeur, plafond `floor(101/poids)`) : **aucun écart**.
  Ta Do Per So = 20613, niv. 200, effets 2812 (+1) / 2825 / 2826 / 2827.
- Règles d'exo : devblog 2.3.4 (12 PA / 6 PM / 9 PO, « pas plus de 1 PA, 1 PM, 1 PO » en exo) et Gamosaurus (1 %, 505 Vi).
- Vecteur Terre §12.2 recalculé indépendamment : Force 1 258, Sagesse 415, CC 82, PA 11, PM 5, PO 6 (avec 29136) : identique.
  **Ajout** d'un second vecteur (stuff Eau, §12.3) : Chance 1 458, CC 51, PO 6 exacts.

**Erreurs trouvées et corrigées :**
1. **Arme à deux mains ⇒ pas de bouclier : FAUX** depuis la 2.41 (2017, devblog JOL 52365) ; un seul objet du jeu
   (Balai rudimentaire) a `twoHanded = true`. Corrigé dans §0, §2.1, §2.3, §13.
2. **Prysmaradite unique « depuis la MàJ 3.3 »** : la 3.3 (22/09/2025, pas le 23) ne fait qu'un « Rappel » d'une règle
   existante. Corrigé (§0, §1, §2.3, §8.1).
3. **Fusion des prysmaradites « contredite par les données » : FAUX** — les 5 fusionnées (Prygen, Telprys→Caraprys,
   Aprykou→Prynyang, Ratrapry, Surpryz) n'ont bien qu'une entrée ; Prytek/Pryssion/Prycipithon n'étaient pas concernées.
4. **« Over marginal au niveau 200 »** : contredit par les propres statistiques du chercheur (médianes Vi 350, stat 60,
   Do élém. 12). Reformulé (§0, §11.2, `forgemagie.json → rules.overmax.level200Reality`).
5. **`typicalLevel200Lines.shareWithOvermaxRoom` faux** : comptait PA/PM/PO comme over-possibles (0,98 / 0,99 / 0,88 au lieu
   de 0) et surestimait 15 autres lignes (ex. Do Pou 0,54 → 0,21, Soins 0,43 → 0,14). Recalculé avec
   `(jet max + incrément) × poids ≤ 101`, définition ajoutée dans `_meta`.
6. Exo **Invocation** : taux `null` → ≈1 % sans puits (Gamosaurus), `forgemagie.json` et §11.2.
7. Érosion 50 % attribuée au « code Haxe » : seul le client D2 est vérifié (`DamageUtil.as` l. 2070) ; corrigé §7.
8. Familiers « niv. 50 ⇒ 50 % » : la source (devblog 2.48) dit seulement « varie de 0 à 100 et chaque niveau augmente le
   bonus » → hypothèse linéaire marquée INCERTAIN (§9, §13, §14).
9. Mineurs : « min 12 » → `min(…, 12)` (§3.2) ; `powerRate` négatif = −½ sauf 145/159 (§11.1) ; « Dofus du Cauchemar » ;
   Prycipithon = +1 PA **−1 PM** (§7) ; 3 878 objets = 3 826 équipements + 52 compagnons, `PZ` 54 = 51 compagnons + 3 ;
   `Pm` absent de la factory D2 (INCERTAIN) ; plafond de rés. appliqué à élém. + tous éléments ; lignes négatives prises au
   pire malus par DofusDB (option `negativeRoll`) ; gravures : `diceSide` = élément cible ; effet 722 (sort temporaire)
   documenté dans la carte ; transcendance : citation next-stage (ni over ni exo, densité ≤ 100) ; consommables
   d'initiative 3.3 (cumul 4).

**Non vérifié / reste INCERTAIN :** plafond PO 6 vs 9 et invocations 6 (aucune source primaire Dofus 3 trouvée ; le
devblog 2011 dit 9 PO) ; poids FM Vitalité 0,2 (données, Gamosaurus 505) vs 0,25 (dafous.app 404) ; Ré Per Mé/Di 10 vs 15 ;
`Pods` terme `5·(niveau−1)` ; comportement serveur des conditions `CP<12` (brut vs plafonné) ; paliers de coût `costTier`
(subjectifs) ; lignes de méta Feu/Air/Tank (§12.1) non recalculées.
