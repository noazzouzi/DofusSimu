# Cartes de combat : cellules, lignes de vue, placements

> **Attribution obligatoire** : « Données issues de DofusDB. Utilisation soumise à la LPNC-IA 1.0. »
> Licence et autorisation : voir [§ 8](#8-licence-dofusdb-lpnc-ia-10).

## TL;DR

* **Source machine-lisible trouvée et exacte** : DofusDB sert les fichiers de carte **Dofus 3** exportés en JSON statique
  à l'adresse **`https://api.dofusdb.fr/maps/<mapId>.json`** (≈ 85–300 Ko par carte). Le champ `cellsData` contient les
  560 cellules avec les drapeaux du client : `mov`, `los`, `nonWalkableDuringFight`, `red`, `blue`, `floor`, `visible`…
* `scripts/fetch-maps.mjs` télécharge ces données pour **toutes les salles de tous les donjons**
  (`api.dofusdb.fr/dungeons` → `mapIds`) et écrit `data/maps/<mapId>.json` + `data/maps/index.json`.
  Exécuté le 2026-10-04 : **187 donjons, 763 salles, 759 cartes écrites, 4 absentes** (aucun fichier côté DofusDB).
* **Salle du Vortex** (`143393281`, « Œil de Vortex - Salle des heures perdues ») : 222 cases marchables (une seule
  composante connexe), 76 cases bloquant la ligne de vue, **12 cases rouges** (joueurs), **10 cases bleues** (monstres).
  Données **non approximatives** (`approximate: false`), recoupées avec le rendu Dofus 3 et 2 schémas du guide JOL.
* Les 12 positions de l'horloge (Auroraire) ont été localisées au cell près : `1:215 2:218 3:263 4:334 5:418 6:487
  7:526 8:523 9:479 10:407 11:323 12:255` (fichier `data/maps/annotations/143393281.json`, fusionné dans la carte).

---

## 1. Démarche et sources testées

### a) DofusDB (✅ fonctionne)

1. `https://dofusdb.fr/fr/tools/map` charge `/js/app.<hash>.js` ; la table des chunks webpack
   (`"js/"+({1:"chunk-common"}[e]||e)+"."+{…}[e]+".js"`) donne les 75 chunks. La route `tools/map` charge les chunks
   0, 1 et 12 : c'est une **carte du monde Leaflet** (tuiles `api.dofusdb.fr/img/worlds/<world>/<scale>/<x>_<y>.jpg`),
   sans données de cellules.
2. Le module API de `app.js` expose `getCellData` → `GET /cell-data?mapId=&cellId=&identifier=`. Il n'est utilisé que
   par des outils d'administration (chunks 25 et 27 : « tag Interactive from map », « tag POI from map ») et renvoie
   les éléments graphiques d'une cellule. **Réponse 401 `NotAuthenticated`** sans compte → inutilisable.
3. Sondage des services Feathers : `/map`, `/cells`, `/map-data`, `/fight-maps`… → 404. Mais **`/maps`** répond
   `{"total":0,…}` et **`/maps/143393281.json` renvoie le fichier de carte complet (200, 285 Ko, `cache-control:
   public, max-age=86400`)**. Quand le fichier statique n'existe pas, la requête retombe sur le service `maps` (vide) :
   `400 BadRequest "Cast to Number failed for value \"<id>.json\""` — le script traite 400/404 comme « carte absente ».
4. Images de rendu : `https://api.dofusdb.fr/img/maps/{0.25,0.5,0.75,1}/<mapId>.jpg` (liées depuis
   `map-positions/<id>.img`), 1910×970 px à l'échelle 1 (filigrane DofusDB).
5. Noms / coordonnées : `https://api.dofusdb.fr/map-positions/<mapId>` (`name.fr`, `posX`, `posY`, `subAreaId`,
   `worldMap`, `capability*`…). ≈100 salles (surtout les Expéditions `239xxxxxx`) n'ont pas de nom en jeu
   (`name.id = "0"`) : le script les nomme « <donjon> - salle N » et pose `nameIsFallback: true`.

Le fichier de carte est bien un export **Dofus 3 (Unity)** : clés `sortableElements`, `stagingSequences`,
`mapPostProcessConfiguration`, `playlistSet.fmodEventGuid`, `materialData.atlas*`… ; `map-positions` a été mis à jour le
2026-06-23 et le fichier porte `last-modified: 2026-09-08`.

### b) GitHub (non nécessaire)

Recherches « dofus maps json », « cellsData nonWalkableDuringFight », « api.dofusdb.fr/maps » : quasiment rien de
public et à jour (ex. `0xN0x/dofus-map-drawer`, dessinateur de cartes à partir d'un JSON, non exploré). Les émulateurs
Dofus 2 (Stump : `Stump.Server.WorldServer`) lisent les `.dlm` mais ne publient pas les cartes ; Stump sert uniquement
ici de référence pour la convention de placement (§ 5).

### c) CDN Ankama / Dofus Touch (non testé)

Inutile vu (a). `www.dofus.com` renvoie 403 depuis cet environnement.

### d) Reconstruction depuis des captures (utilisée seulement pour **valider**)

Deux schémas du guide JOL (Dofus 2, mode tactique, 4 joueurs) ont servi de contrôle croisé (§ 6.3) :
`https://jolstatic.fr/dofus/equipe/226595/Articles/Vortex/Vortex200.png` et `…/Aurorairee.bmp`
(guide : https://dofus.jeuxonline.info/article/13603/il-vortex, 2016, mis à jour 2019).

---

## 2. Format brut DofusDB (`cellsData[i]`)

| Champ | Valeurs vues | Sens (client Dofus) | Repris ? |
|---|---|---|---|
| `cellNumber` | 0…559 | identifiant de la cellule | `id` |
| `mov` | 0/1 | marchable | `walkable` (combiné, voir ci-dessous) |
| `los` | 0/1 | 1 = laisse passer la ligne de vue ; 0 = obstacle opaque | `los` |
| `nonWalkableDuringFight` | 0/1 | marchable hors combat mais **bloquée en combat** (278 cartes de donjon en ont) | `nonWalkableDuringFight` + appliqué à `walkable` |
| `red` / `blue` | 0/1 | cases de placement des deux équipes | `red` / `blue` |
| `floor` | entier (souvent 0) | hauteur d'affichage de la case (110 cartes en ont ≠ 0) — **affichage seulement** | `floor` |
| `visible` | 1 partout | case affichée | `visible:false` si 0 (jamais vu) |
| `nonWalkableDuringRP`, `farmCell`, `havenbagCell`, `speed`, `mapChangeData`, `moveZone`, `linkedZone`, `arrow`, `roleplayMonstersMovementBlocked` | — | roleplay (déplacement hors combat, changement de carte, havre-sac…) | non repris |

Aucune case marchable ne bloque la ligne de vue sur les 759 cartes (`walkableNoLos = 0` partout). Les cases
**non marchables avec `los = true`** sont des trous / du vide : on ne peut pas y aller mais on tire par-dessus.

## 3. Format produit : `data/maps/<mapId>.json`

JSON compact, une cellule par ligne (diffs lisibles ; ≈23 Ko/carte, ≈2,2 Ko gzip ; 17,7 Mo pour 759 cartes).

```jsonc
{
  "mapId": 143393281,
  "name": "Œil de Vortex - Salle des heures perdues", "nameIsFallback": false,
  "dungeonIds": [87], "room": 1,              // room = rang dans dungeons.mapIds (1 = première salle)
  "posX": 7, "posY": -7, "subAreaId": 841, "worldMap": 15,
  "width": 14, "height": 20,
  "source": "https://api.dofusdb.fr/maps/143393281.json (cellsData, …)", "fetchedAt": "2026-10-04",
  "approximate": false,
  "image": "https://api.dofusdb.fr/img/maps/1/143393281.jpg",
  "neighbours": {"top": …, "bottom": …, "left": …, "right": …},
  "stats": {"walkable": 222, "losBlocking": 76, "walkableNoLos": 0, "red": 12, "blue": 10},
  "redCells": [ … ], "blueCells": [ … ],
  "annotations": { … },                      // seulement si data/maps/annotations/<mapId>.json existe
  "cells": [
    {"id": 0, "walkable": false, "los": true},
    {"id": 268, "walkable": true, "los": true, "blue": true},
    …                                         // 560 cellules, triées par id
  ]
}
```

* **`walkable` = `mov && !nonWalkableDuringFight`** : marchable **en combat**. `nonWalkableDuringFight: true` est
  conservé à titre informatif (déjà appliqué).
* Champs optionnels présents **uniquement** s'ils sont vrais / non nuls : `nonWalkableDuringFight`, `red`, `blue`,
  `floor`, `visible` (false).
* `data/maps/index.json` : `dungeons[]` (id, nom, niveaux, boss, monstres, `mapIds`), `maps{}` (nom, donjons, salle,
  stats), `failures[]`, `imageGrid` (calibration § 4.2). Les loaders qui parcourent `data/maps/*.json` doivent
  ignorer `index.json` et le sous-dossier `annotations/`.

## 4. Géométrie

### 4.1 Identifiants ↔ coordonnées

Identique à `src/map/geometry.ts` (et au client Dofus) : `row = floor(id / 14)` (0…39, demi-lignes),
`col = id % 14` ; les demi-lignes impaires sont décalées d'une demi-case vers la droite à l'écran. Repère logique
(rotation 45°) : `row` pair → `(x, y) = (row/2 + col, -row/2 + col)` ; `row` impair → `(x, y) = ((row+1)/2 + col,
-(row-1)/2 + col)` ; voisins = ±1 sur x ou y ; distance = |dx|+|dy|. Ex. : 268 → row 19, col 2 → (12, −7).

### 4.2 Superposition sur les images DofusDB (pour le visualiseur)

Calibrée à l'œil sur 2 cartes (Vortex et Cour du Bouftou Royal, 121373185) — ajustement visuel excellent (obstacles
noirs sur les décors, zone marchable sur le sol) mais **non garanti au pixel** (INCERTAIN ±5 px) :

```
image https://api.dofusdb.fr/img/maps/1/<mapId>.jpg (1910×970)
coin haut-gauche du losange :  x = 331 + col·86 + (row % 2)·43 ,  y = 0 + row·21,5
losange : 86 × 43 px   (images 0.5 → tout diviser par 2)
```

## 5. Placement : qui va sur rouge / bleu ?

* Convention Dofus (émulateur Stump, `FightManager.CreatePvMFight` :
  `new FightPlayerTeam(TEAM_CHALLENGER, map.GetRedFightPlacement())`,
  `new FightMonsterTeam(TEAM_DEFENDER, map.GetBlueFightPlacement())` —
  https://github.com/745c5412/Stump/blob/master/Server/Stump.Server.WorldServer/Game/Fights/FightManager.cs) :
  **joueurs (challengers) sur les cases rouges, monstres (défenseurs) sur les bleues**. Les schémas JOL du Vortex
  montrent bien les monstres sur la ligne bleue et le joueur sur une case rouge.
* Sur le serveur officiel, les positions sont envoyées au début du combat (`GameFightPlacementPossiblePositions`) ;
  qu'elles soient toujours égales aux drapeaux `red`/`blue` du fichier de carte est **très probable mais INCERTAIN**.
* **36 cartes de donjon n'ont aucune case rouge/bleue** (annexes, coulisses, salles de transition — ex. Potager
  d'Halouine 101192704, Antre du Koulosse, Tempête de l'Eliocalypse 2044xxxxx, Chambre des maléfices 2238xxxxx) :
  le placement y est défini côté serveur ou ces salles n'ont pas de combat. Liste : `stats.red == 0` dans l'index.

## 6. Salle du Vortex — `143393281`

Donjon 87 « Œil de Vortex » (Xélorium, niv. 190–200, une seule salle, `[7,-7]`, sous-zone 841, boss 3835,
monstres 3834–3839). Combat unique en **5 vagues** (une toutes les 5 tours, ou immédiatement si la vague en cours est
éliminée) — https://dofus.jeuxonline.info/article/13603/il-vortex.

### 6.1 Vue écran (demi-lignes 11 à 39 ; les lignes 0–10 sont hors arène)

Légende : `o` marchable · `#` obstacle (non marchable, bloque la LdV) · `.` vide (non marchable, LdV libre) ·
`R` placement rouge (joueurs) · `B` placement bleu (monstres) · `h` case d'une heure de l'horloge (marchable).

```
11 [154-167]  . . . . . . . . . . . . . .
12 [168-181] . . . . . . . # . . . . . .
13 [182-195]  . . . . # # # # # # . . . .
14 [196-209] . . . . # # # o # # # . . .
15 [210-223]  . . . # o h o o h o # . . .
16 [224-237] . . . # o o o o o o o # . .
17 [238-251]  . . # o o o o o o o o # . .
18 [252-265] . . # h o o o o o o o h # .
19 [266-279]  . # B B B B B B B B B B # .
20 [280-293] . # o o o o o o o o o o o #
21 [294-307]  # o o o o o o o o o o o o #
22 [308-321] . # o o o o o o o o o o o #
23 [322-335]  # h o o o o # o o o o o h #
24 [336-349] . # o o o o # # o o o o o #
25 [350-363]  # o o o o o # # o o o o o #
26 [364-377] . # o # o o o # o o o o o #
27 [378-391]  # o o o o o o o o o o o o #
28 [392-405] . # o o o o o o o o o o o #
29 [406-419]  # h o o o # o o # o o o h #
30 [420-433] . # o o R o o R o o R o o #
31 [434-447]  # o o o R o R R o R o o o #
32 [448-461] . # o o o R o R o R o o o #
33 [462-475]  . # o o o o o o o o o o # .
34 [476-489] . . # h o o R o R o o h # .
35 [490-503]  . . # o o o o o o o o # . .
36 [504-517] . . . # o o o o o o o # . .
37 [518-531]  . . . # # h o o h # # . . .
38 [532-545] . . . . # # o o o # # . . .
39 [546-559]  . . . . . # . . # . . . . .
```

### 6.2 Vue logique (x →, y ↑ ; distance = |dx|+|dy|, x de 11 à 29)

```
      x=1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9
y=   3 . . . . . # # # # # # # # #
y=   2 . . . . # # o o o h B o o # #
y=   1 . . # # # h o o o B o o o h # #
y=   0 . . # o o o o o B o o o o o o # #
y=  -1 . # # o o o o B o o o o o o o o # #
y=  -2 # # h o o o B o o o o o o o o o h # #
y=  -3 # o o o o B o o o o o o o o o o o o #
y=  -4 # o o o B o o o o o o o o o o o o o #
y=  -5 # o o B o o o # # # o o o o R o o o #
y=  -6 # h B o o o o # # # o o # o R o o h #
y=  -7 # B o o o o o o o o o o o o R o o o #
y=  -8 # o o o o o o o o o o R R o o o o o #
y=  -9 # o o o o o o o o # o R R o R o o # #
y= -10 # # h o o # o o o o o o o o o o h # .
y= -11 . # # o o o o o R R R o R o o o o #
y= -12   . # # o o o o o o o o o o o o .
y= -13     . # # h o o o o o o o h o .
y= -14       . # # o o o h o o # # #
y= -15         . # # # # # # # # .
```

### 6.3 Détails exploitables par le moteur / l'IA

| Élément | Cellules |
|---|---|
| Placement **rouge** (12, joueurs) | 424, 427, 430, 438, 440, 441, 443, 453, 455, 457, 482, 484 — 4 groupes : ligne gauche 424/438/453 (+482), carré central 427/440/441/455, ligne droite 430/443/457 (+484) |
| Placement **bleu** (10, monstres) | 268 → 277 (une ligne horizontale à l'écran, diagonale logique (12,-7)→(21,2)) |
| Obstacle central (6 cases, bloque LdV) | 328, 342, 343, 356, 357, 371 (x 18–20, y −5…−6) |
| Obstacles isolés (bloquent LdV) | 367 (16,−10), 411 (20,−9), 414 (23,−6) |
| Heures de l'horloge (Auroraire) | 1:215, 2:218, 3:263, 4:334, 5:418, 6:487, 7:526, 8:523, 9:479, 10:407, 11:323, 12:255 |
| Centre logique de l'horloge | (20, −6) — dans l'obstacle central |
| Distance rouge ↔ bleu | min 11, max 15 PM |

* **Vérification croisée** : (1) les cellules du fichier collent au rendu Dofus 3 (sol de l'horloge marchable, socles du
  sablier/du pendule et pilier central en obstacles) ; (2) le schéma JOL `Vortex200.png` montre exactement la ligne de
  10 bleues, les 12 rouges en 3 groupes + 2 isolées, l'obstacle central 2×3 et les 3 blocs isolés ; (3) les 12 heures
  repérées sur `Aurorairee.bmp` tombent **exactement** sur les chiffres romains I…XII peints au sol du rendu Dofus 3 et
  sont parfaitement symétriques autour de (20,−6). La salle n'a donc pas changé de forme entre Dofus 2 et Dofus 3.
* **Apparition des vagues** (JOL) : « L'endroit où apparaissent les monstres n'est pas aléatoire ; ils apparaissent là où
  les monstres de la première vague ont commencé le combat. » → réutiliser les cases bleues de départ de la vague 1.
* **Exemple de placement observé** (2 captures JOL, 4 joueurs) : monstres sur 268, 270, 272, 274 (une bleue sur deux),
  Vortex sur 270. Non garanti — INCERTAIN.
* **Auroraire** (JOL) : invulnérable, indéplaçable ; avance d'une heure à chaque tour de joueur et quand un allié marche
  dans un glyphe de monstre ; « transpose ses alliés et coopère les ennemis présents sur sa case d'arrivée » ; sa
  position au moment d'un kill détermine les bonus du sort « Heurage » du Vortex. Sens de rotation 1→12 : INCERTAIN
  (à confirmer avec les données de sorts du Vortex / de l'Auroraire).

## 7. Script `scripts/fetch-maps.mjs`

```bash
NODE_USE_ENV_PROXY=1 node scripts/fetch-maps.mjs              # toutes les salles de donjon (~763 requêtes)
node scripts/fetch-maps.mjs --dungeon 87                       # Œil de Vortex seulement (fusionne l'index)
node scripts/fetch-maps.mjs --map 143393281,121373185 --force  # cartes explicites, sans cache
```

* Node ≥ 22, ESM, **sans dépendance**. Se relance seul avec `NODE_USE_ENV_PROXY=1` si `HTTPS_PROXY` est défini.
* Concurrence 3, 150 ms entre requêtes par worker, 4 essais avec backoff ; cache gzip « allégé » (cellsData +
  voisins) dans `.cache/maps/raw/<mapId>.json.gz` (≈ 2–4 Ko) ; `.cache/maps/dungeons.json`.
* Annotations manuelles : `data/maps/annotations/<mapId>.json` est recopié dans le champ `annotations` de la carte.
* Exécution du 2026-10-04 : 759/763 cartes. **Absentes** (HTTP 400, pas de fichier DofusDB) : 232784389, 232785413
  (donjon 144 « Expédition - Cour du Bouftou Royal »), 232786435, 232787459 (donjon 157 « Expédition - Donjon des
  Squelettes »).

## 8. Licence DofusDB (LPNC-IA 1.0)

Toutes les réponses de `api.dofusdb.fr` portent l'en-tête `x-license: LPNC-IA 1.0 / NCPUL-AI 1.0`. La licence publique
(https://api.dofusdb.fr/) impose l'attribution (« Données issues de DofusDB. Utilisation soumise à la LPNC-IA 1.0. »),
un usage non commercial, le partage dans les mêmes conditions, et restreint les usages par IA (§ 4.2).

**Décision (2026-10-04)** : le propriétaire du dépôt indique que DofusDB a autorisé l'utilisation de ses données pour ce
projet ; l'extraction a donc été conservée. L'attribution figure dans le README. Les fichiers du jeu distribués par Ankama
(outil open source `doduda`, GPL-3.0) restent une source alternative/de recoupement indépendante de DofusDB.

## 9. Questions ouvertes

* Le serveur officiel utilise-t-il toujours les drapeaux `red`/`blue` des cartes pour le placement (et toujours
  rouge = joueurs en PvM) ? Probable, non vérifié sur Dofus 3.
* Positions d'apparition exactes des vagues 2–5 et placement initial exact des monstres (serveur) : seule la règle JOL
  « mêmes cases que la vague 1 » est connue.
* Sens et point de départ de l'Auroraire sur l'horloge (heure de départ, rotation), à croiser avec les sorts.
* `floor` (hauteur) n'a pas d'effet de gameplay connu ; à ignorer pour la LdV (INCERTAIN pour les cartes à étages).
* Obstacles dynamiques (portes, éléments interactifs, glyphes) non présents dans `cellsData` : à gérer par scénario.
