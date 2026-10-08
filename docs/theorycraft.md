# Theorycraft contre un boss — guide d'utilisation

*Guide du 2026-10-08. Usage personnel, PvM, un joueur. Conception et état du code :
[`design/theorycraft.md`](design/theorycraft.md) ; fiches manuelles des boss :
[`../data/bosses/README.md`](../data/bosses/README.md).*

Les exemples de ce guide sont des **sorties réelles**, produites le 2026-10-08 sur les données du dépôt (DofusDB,
version 3.6 du jeu, extraites le 2026-10-04) par les fonctions qu'affichent la ligne de commande et la page web
(`formatBoss`, `formatClasses`, `formatStuffVsBoss` de `src/theorycraft/analysis.ts`). Elles sont abrégées (`[…]` marque
des lignes omises), jamais retouchées. Les calculs sont déterministes : les mêmes données et les mêmes options donnent
les mêmes chiffres.

## 1. Deux questions, une démarche déterministe

L'outil répond, pour un boss de donjon choisi, à deux questions :

1. **Quel stuff est le plus intéressant contre ce boss ?** Pour UN personnage (un preset de classe, votre build ou un
   lien RoxxSolver) : meilleur stuff trouvé par l'optimiseur, comparé au stuff de départ et aux stuffs génériques, avec
   ce que vaut chaque caractéristique contre ce boss.
2. **Quelles classes sont les plus intéressantes contre ce boss ?** Les 19 classes (49 presets) classées axe par axe
   (dégâts, survie, contrôle, soin, apport d'équipe), sans note globale, plus une composition suggérée par des règles
   écrites.

**Démarche : calcul, pas combat.** Aucun combat d'IA n'est joué. Le boss est décrit par une *fiche* calculée à partir
des données du jeu (statistiques du grade, sort de départ, dégâts de chaque sort, phases, mécaniques), puis chaque
personnage est mesuré contre cette fiche par des formules : dégâts par tour sur plusieurs tours (sac à dos sur les PA,
relances tenues), PV effectifs face aux dégâts du boss, PA/PM retirés contre son esquive, soins utiles. Pourquoi :

- **Coût.** Un combat simulé au Vortex prend 20 à 40 s de CPU et un taux de victoire se juge sur 128 à 256 combats ;
  répéter cela pour 137 boss et 49 presets n'est pas raisonnable. Ici : une fiche en quelques millisecondes (les 162
  boss en ≈ 0,13 s), le classement des classes en 0,5 à 0,8 s, un meilleur stuff en 2,5 à 5 s.
- **Fidélité.** Seul l'Œil de Vortex a un scénario de combat (`data/dungeons/vortex.json`) et une IA de boss dédiée.
  Contre un autre boss, un combat simulé mesurerait surtout les défauts d'une IA générique et d'un placement improvisé.
- **Explication.** Chaque chiffre se décompose (par sort, par élément, par caractéristique, par règle) et chaque sortie
  liste ses **hypothèses** et **avertissements**. On sait pourquoi une classe est devant.

Contrepartie : ce n'est pas une simulation de combat. Positions, ligne de vue, déplacements, invocations, glyphes,
pièges et IA réelle du boss ne sont pas modélisés (liste complète au §4). **Les classements valent plus que les valeurs
absolues** : « le Forgelance tape plus que le Iop contre ce boss » est plus fiable que « il fait 2 440 par tour ».

Valeurs par défaut : 4 joueurs (donc boss de grade 1), personnages niveau 200, les 49 presets de base, Expéditions
exclues de l'index. Tout se règle.

## 2. Prise en main

### 2.1 En ligne de commande

Toutes les commandes passent par `npm run sim -- <commande>` (`npm run sim -- help` pour l'aide complète). Conventions :
les **arguments positionnels d'abord** (le boss, puis `classes` ou `stuff`), les options ensuite ; `--json` écrit le
résultat complet en JSON sur la sortie standard (pour un script ou un tableur) ; une erreur s'affiche
« Erreur : … » avec le code de sortie 1 ; aucun fichier n'est écrit sans `--out`.

| Commande | Rôle |
|---|---|
| `bosses [recherche] [--all] [--json]` | Liste ou recherche des boss : nom, id, donjon(s), niveau du donjon, niveau du boss, nombre de grades, Expédition. `--all` inclut les Expéditions (exclues par défaut). |
| `boss <nom\|id> [--players N \| --grade G] [--details] [--no-overrides] [--json]` | Fiche du boss. `--details` : en plus, tableau de tous ses sorts (PA, lancers, relance, dégâts par élément, drapeaux) et arbre de son sort de départ (aide à rédiger une fiche manuelle, §5). La fiche manuelle `data/bosses/<id>.json` est appliquée si elle existe ; `--no-overrides` l'ignore. |
| `boss <nom\|id> classes [--players N \| --grade G] [--optimize [--iterations N] [--profile P]] [--level L] [--json] [--out fichier]` | Classement des classes (§3.2). `--optimize` : stuff optimisé contre le boss pour chaque preset, progression sur la sortie d'erreur ; `--iterations` et `--profile` n'existent qu'avec `--optimize` (sinon erreur). `--out` : classement écrit dans un fichier (JSON si `.json`, texte sinon). |
| `boss <nom\|id> stuff --class <classe\|preset> [--roxx <lien> \| --build fichier.json] [--elements preset\|all] [--profile balanced\|defensive\|offensive] [--top N] [--iterations N] [--restarts N] [--seed S] [--level L] [--range N] [--fixed ids] [--exclude ids] [--out fichier.json] [--json]` | Meilleur stuff pour un personnage (§3.3). |
| `degats --preset <preset> [--build fichier.json \| --roxx <lien>] --sort <nom\|id> [--boss <nom\|id> [--players N \| --grade G]] [--res n,t,f,e,a] [--crit] [--trace] [--json]` | Dégâts d'UN sort, ligne par ligne, pour vérifier en jeu (§6). |

Désigner le boss : un id de monstre (`4726`) ou un nom — du boss ou de son donjon —, sans accents ni majuscules
(`"pere ver"`). Une requête ambiguë est refusée avec la liste des candidats :

```
Erreur : « tynril » est ambigu : Tynril Ahuri (1087, Laboratoire du Tynril) ; Tynril Perfide (1086, Laboratoire du Tynril) ; Tynril Consterné (1072, Laboratoire du Tynril) ; Tynril Déconcerté (1085, Laboratoire du Tynril). Précisez le nom ou donnez l'id du monstre.
```

Désigner le personnage (`--class`, `--preset`) : un preset (`cra_terre_mono`), une désignation `classe:qualificatif`
(`cra:terre`) ou une classe seule (`cra`, `Crâ`, `9`). **Sans `--roxx` ni `--build`, une classe seule prend le premier
preset de base de la classe** (pour le Crâ : `cra_feu_zone`, rôle Dégâts de zone) et la sortie liste les autres en
note : pour un autre, donner le preset (`npm run sim -- presets` les liste) ; `--elements all` compare de toute façon
les quatre éléments. **Avec `--roxx` ou `--build`**, la classe vient du build et une classe seule ne fait que la
vérifier : le preset (variantes de sorts, rôle donc exposants de l'objectif, étalonnage) est le premier preset de base
de la classe dont l'élément est la caractéristique élémentaire la plus haute du build, et la ligne « Personnage » de la
sortie le nomme. Pour imposer le rôle et les variantes de VOTRE personnage, donner le preset
(`--class cra_terre_mono --roxx …`).

Options communes :

- `--players N` (1 à 8) ou `--grade G` (exclusifs) : grade du boss = `joueurs − 3`, borné à 1..5 et aux grades du
  monstre (règle des donjons modulaires) ; 1 à 4 joueurs ⇒ grade 1, 5 ⇒ 2… 8 ⇒ 5 ; le 6e grade de certains boss
  (Père Ver) n'est accessible que par `--grade`. Le grade change surtout les PV, rarement les caractéristiques, presque
  jamais les résistances.
- `--level L` : niveau des personnages (défaut 200). Sous 200, les stuffs génériques (objets niveau 200) ne sont pas
  portables : le classement des classes par défaut prend alors des personnages **sans équipement** (signalé) ;
  `classes --optimize` leur donne au contraire un stuff optimisé avec des objets de leur niveau (mesuré contre le Père
  Ver au niveau 150 : 2,9 s pour les 49 presets).
- `--profile` : `balanced` (défaut), `defensive` (survie d'abord), `offensive` (dégâts d'abord) — décale les exposants
  de l'objectif de l'optimiseur (§3.3). Pour `classes`, seulement avec `--optimize`.
- `--iterations N` : itérations du recuit de l'optimiseur (stuff : 30 000 par défaut ; `--optimize` des classes : 0,
  montée par coordonnées seule ; pour `classes`, seulement avec `--optimize`). `--restarts N` (stuff) : nombre de
  recherches, chacune avec sa graine (défaut 2, une seule par élément avec `--elements all`) ; `--seed S` : première
  graine (défaut 1). Mêmes options, même résultat.
- `--fixed ids` / `--exclude ids` (stuff) : ids d'objets, séparés par des virgules, **imposés** dans tous les stuffs
  candidats / **interdits** à la recherche (ids DofusDB : champ `itemId` du fichier `--out` ou de la sortie `--json`,
  ou adresse de l'objet sur dofusdb.fr). Un objet imposé au-dessus de `--level` est ignoré (signalé).

Exemples :

```bash
npm run sim -- bosses ver                              # recherche (nom du boss ou du donjon)
npm run sim -- boss "pere ver"                         # fiche du boss, 4 joueurs (grade 1)
npm run sim -- boss 4726 --players 8 --details         # grade 5, avec tous les sorts du boss
npm run sim -- boss "pere ver" classes                 # classement des classes, stuffs génériques
npm run sim -- boss "pere ver" classes --optimize      # stuffs optimisés contre le boss (≈ 15 s)
npm run sim -- boss "pere ver" stuff --class zobal_psychopathe --out runs/zobal-pere-ver.json
npm run sim -- boss solar stuff --class cra:terre --elements all
npm run sim -- boss merkator stuff --class cra --roxx 'https://roxxsolver.com/solver?build=…'
npm run sim -- degats --preset enutrof_soutien --sort "Lancer de Pièces" --trace
```

**Recherche.** `bosses ver` cherche « ver » dans le nom du boss et celui de son donjon (sans accents). Résultat réel de
la recherche (`searchBosses`) :

| Boss | Id | Donjon | Niveau du donjon | Niveau du boss | Grades | Expédition |
|---|---|---|---|---|---|---|
| Père Ver | 4726 | Boyau du Père Ver | 170 | 170 | 6 | non |
| El Piko | 4609 | Caverne d'El Piko | 130 | 130 | 5 | non |
| Kolosso | 2986 | Cavernes du Kolosso | 190 | 190 | 5 | non |
| Koulosse | 670 | Caverne du Koulosse | 100 | 100 | 5 | non |
| Père Fwetar | 1194 | Caverne de Nowel | 110 | 180 | 5 | non |
| Professeur Xa | 2992 | Cavernes du Kolosso | 190 | 190 | 5 | non |

L'index compte **137 boss** de donjon (`bosses[]` de `dungeons.json`) et **162** avec les Expéditions (25 boss propres
aux Expéditions, retrouvés par le drapeau `isBoss`). Un boss de plusieurs donjons n'a qu'une entrée (Guerre : Trône de
Sang + Tempête de l'Eliocalypse). Le niveau du boss peut différer de celui du donjon (Père Fwetar).

**Fiche du boss.** `boss "pere ver"` (extrait) :

```
Père Ver (4726) — grade 1, 4 joueur(s)
======================================
  Niveau 170 · PV 12 000 · PA 11 · PM 0 · Esquive PA 88 · Esquive PM 68 · Tacle 68

Résistances
  Élément  Brute  Effective
  -------  -----  ---------
  Neutre    35 %       35 %
  Terre     20 %       20 %
  Feu       10 %       10 %
  Eau       10 %       10 %
  Air       50 %       50 %
  Éléments du plus faible au plus fort : Feu (10 %), Eau (10 %), Terre (20 %), Neutre (35 %), Air (50 %).

Profil offensif par phase
  Phase              Poids  Attaquable   Pic/tour  Soutenu/tour  Neutre  Terre  Feu  Eau   Air
  -----------------  -----  -----------  --------  ------------  ------  -----  ---  ---  ----
  Base (aucun état)  100 %  mêlée seule       693           542    28 %      —    —    —  72 %
  Répartition des dégâts reçus (phases pondérées) : Neutre 28 %, Air 72 %.

Mécaniques
  - [invulnérable à distance] Invulnérable à distance : état « Invulnérable à Distance » (375) dès le début du combat. — contre : mêlée — punit : distance
  - [érosion] Érosion infligée jusqu'à 10 %. — contre : boucliers, réductions — punit : soin
  - [soin du boss] Se soigne ou soigne ses alliés (Digestion Lente, Paternalisme). — contre : rafale, érosion
  - [glyphes / pièges] Pose des glyphes ou des pièges (Digestion Lente). — contre : placement
```

**Classes.** `boss "pere ver" classes` (extrait : axe Dégâts et composition) :

```
Dégâts (DPT soutenu)
  Valeur : DPT analytique (classement) ; « Étalonné » = × étalonnage moteur du preset (contrôle, data/ai/calibration.json).
    #  Classe      Preset                 Valeur  Étalonné (moteur)  Rafale  Élément (rés.)  Posture                Confiance
  ---  ----------  ---------------------  ------  -----------------  ------  --------------  ---------------------  ---------
    1  Forgelance  forgelance_zone_terre   2 440      2 440 (×1,00)   2 440  Terre (20 %)    Armé                   moyenne
    2  Iop         iop_soutien             2 156      2 156 (×1,00)   2 156  Terre (20 %)    —                      moyenne
    3  Sram        sram_terre_pieges       1 896      1 572 (×0,83)   1 896  Terre (20 %)    —                      basse
    4  Zobal       zobal_psychopathe       1 852      1 850 (×1,00)   1 852  Terre (20 %)    Masque de l’Intrépide  moyenne
    5  Ouginak     ouginak_eau_air         1 719      1 798 (×1,05)   1 719  Eau (10 %)      Sans Rage              moyenne
  […]
  =12  Crâ         cra_air_entrave             0          0 (×1,20)       0  Air (50 %)      —                      basse
  =12  Eliotrope   eliotrope_passeur           0          0 (×1,00)       0  Air (50 %)      Portail                basse
  […]
Composition suggérée (4 personnage(s))
  Rôle             Classe      Preset                 Raison
  ---------------  ----------  ---------------------  -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Dégâts           Forgelance  forgelance_zone_terre  Meilleur DPT soutenu contre ce boss : 2 440 par tour (Terre, résistance effective 20 %).
  Dégâts           Iop         iop_soutien            Deuxième DPT : 2 156 par tour (Terre, résistance effective 20 %) — pas un élément faible du boss, retenu pour son DPT.
  Apport d'équipe  Huppermage  huppermage_entrave     +34,0 % de dégâts pour un allié (« dommages subis » sur le boss 15,0 %, Puissance 10,7 %, PA 8,3 %) ; ne touche pas le boss (DPT propre nul) : apport seul ; confiance basse.
  Dégâts           Sram        sram_terre_pieges      DPT suivant : 1 896 par tour (Terre, résistance effective 20 %) ; étalonnage moteur ×0,83 ⇒ ≈ 1 572 par tour — pas un élément faible du boss, retenu pour son DPT.
  Notes :
    - Pas de soigneur dédié : un tour du boss retire 13 % des PV d'un personnage (seuil 20 %).
    - Pas de retrait PM : le boss n'a pas de PM.
    - Deuxième DPT d'un autre élément faible écarté : le meilleur, Ouginak ouginak_eau_air (Eau), n'atteint que 80 % du meilleur DPT restant (seuil 85 %).
```

Le Père Ver est invulnérable à distance : les presets qui ne frappent qu'à distance (Crâ, Eliotrope, Enutrof…) ont un
DPT nul et la composition ne prend que des classes de mêlée pour les dégâts.

**Stuff.** `boss merkator stuff --class cra_terre_mono` (extrait) :

```
Stuff contre Merkator (3534) — grade 1 (4 joueurs), niveau 220, 13 000 PV
  Résistances effectives : Neutre 14 % · Terre 27 % · Feu 16 % · Eau 22 % · Air 12 % (plus faible : Air) ; réduction distance 50 %
  Mécaniques : Tenter de lui retirer des PM déclenche une riposte (« Mer Veille ») ; Dommages subis à distance ×50 % (sur coup à distance) : équivaut à 50 % de résistance distance ; % Dommages finaux : +2 (sur coup à distance) ; Indéplaçable : état « Indéplaçable » (97) dès le début du combat ; Retire des PA/PM aux joueurs (Mer Kantile, Baphe Thysca)
  Personnage : Crâ niveau 200, preset cra_terre_mono (Crâ Terre mono-cible), rôle Tueur, élément Terre, à distance
  Les classements valent plus que les valeurs absolues (voir les hypothèses).

Comparaison
  Stuff                                                         logJ (écart au départ)  DPT soutenu  DPT proxy     PV    PVe  Reçus/tour  PA/PM/PO  Pénalité
  Stuff du preset (Terre — Cœur Saignant / Brouce / Torkéloni…                   7,479        1 064      1 099  4 153  5 393       1 546    12/6/6         —
  Générique Feu — Séculaire / Cycloïde / Atcham / Padgref               7,374 (−0,105)        1 034      1 068  3 603  4 812       1 504    12/6/5    ×0,950
  Générique Air — Allister / Cycloïde / Submergée                       7,276 (−0,203)          828        855  4 153  5 835       1 429    12/6/5    ×0,950
  Générique Eau — Danathor / Sinistrofu                                 7,249 (−0,231)          733        800  4 103  5 245       1 571    12/6/6         —
  Générique Sagesse/retrait — Léthaline / Ventouse / Anerice …          6,916 (−0,563)          429        443  4 253  6 867       1 244    12/6/6         —
  Générique Tank — Anerice / Pol Ouatnos / Gloursonne / Balei…          6,819 (−0,660)          508        525  5 053  9 597       1 057    11/6/3    ×0,729
  Optimisé n° 1                                                         7,568 (+0,089)        1 167      1 205  4 153  5 847       1 426    12/6/6         —
  Optimisé n° 2                                                         7,561 (+0,082)        1 075      1 111  4 253  6 903       1 237    12/6/6         —
  Optimisé n° 3                                                         7,560 (+0,081)        1 048      1 083  4 753  7 308       1 306    12/6/6         —
  Optimisé n° 4                                                         7,556 (+0,077)        1 047      1 082  4 753  7 229       1 320    12/6/6         —
  Optimisé n° 5                                                         7,556 (+0,076)        1 035      1 069  4 253  7 413       1 152    12/6/6         —
  Classement par le logJ du proxy (objectif de l’optimiseur) ; stuffs de référence et candidats de la recherche classés ensemble.
  […]
Meilleur stuff : Optimisé n° 1 — logJ 7,568 (+0,089 par rapport au départ)
  DPT soutenu 1 167 (rafale 1 167, période 1 tour, posture « Sans posture ») ; DPT proxy 1 205
  PV 4 153, PVe 5 847, dégâts reçus 1 426/tour (Terre 621, Eau 808)
  12 PA, 6 PM, 6 PO
  Objets :
  […]
  DPT soutenu par sort (lancers/tour × dégâts par lancer) :
    Sort                PA  Lancers/tour  Dégâts/lancer  Dégâts/tour  Part
    Flèche Vagabonde     3          2,00            297          594  51 %
    Œil pour Œil         3          1,00            302          302  26 %
    Flèche Assaillante   3          1,00            271          271  23 %
```

**Comparer les éléments.** `boss solar stuff --class cra:terre --elements all` lance une recherche par élément et les
compare dans un même contexte (même personnage, mêmes variantes de sorts, points reportés sur la caractéristique de
l'élément) :

```
Comparaison des éléments (une recherche par élément)
  Élément  Rés. du boss   logJ  DPT soutenu    PVe
  Terre            20 %  8,118        2 570  5 795
  Feu               5 %  8,306        3 334  5 912  ← retenu
  Eau              20 %  8,025        2 076  6 046
  Air               5 %  8,186        2 758  6 158
```

**Réutiliser le meilleur stuff.** `--out fichier.json` écrit le meilleur build au format des fichiers d'équipe (champ
`build` d'un membre de `data/teams/<scénario>.json`, voir le README) : il se relit avec `--build fichier.json` (stuff,
dégâts d'un sort) ou se cite comme `"build": "<chemin relatif au fichier d'équipe>"` dans un fichier d'équipe pour les
commandes de combat.

### 2.2 Page web « Boss »

```bash
npm run dev          # http://localhost:5173/#boss
```

L'onglet **Boss** de l'interface (à côté de Combats et Stuffs) donne les mêmes analyses. Il n'existe qu'avec le
serveur de développement (`npm run dev`) : les calculs tournent dans Vite (plugin `web/plugins/theory.ts`, mêmes données
chargées une fois pour les stuffs et le theorycraft) ; la version construite (`npm run build`) ne l'a pas.

- **Recherche** du boss avec suggestions (nom du boss ou du donjon, sans accents) ; réglage du nombre de joueurs
  (1 à 8) ou du grade.
- Onglet **Fiche** : PV, PA, PM ; résistances brutes et effectives en barres aux couleurs des éléments ; éléments
  faibles ; profil offensif par phase avec ses parts élémentaires ; mécaniques avec ce qui les contre et ce qu'elles
  punissent ; avertissements et hypothèses repliables. La fiche manuelle `data/bosses/<id>.json` est appliquée si elle
  existe.
- Onglet **Classes** : un tableau triable par axe (rangs partagés « =1 »), la composition suggérée avec ses raisons,
  atouts, limites et confiance dépliables ; le bouton « optimiser les stuffs » relance le classement avec des stuffs
  optimisés contre le boss (plus long, indicateur de chargement).
- Onglet **Stuff** : choix du preset, champ « lien RoxxSolver », éléments (ceux du preset ou les quatre), profil,
  taille du top ; résultat : tableau comparatif, meilleur stuff objet par objet (icônes DofusDB, repli hors ligne),
  objets changés, équivalences des caractéristiques, DPT par sort, hypothèses et avertissements.
- L'adresse garde l'état : `#boss/<monsterId>` (fiche) ou `#boss/<monsterId>/<onglet>` (`classes`, `stuff` ; ex.
  `#boss/4726/classes`), à mettre en favori.

Les mêmes calculs sont accessibles en JSON (serveur de dev) : `GET /api/theory/bosses?all=1`,
`GET /api/theory/presets`, `GET /api/theory/boss?id=&players=&grade=`, `POST /api/theory/classes`
(`{ id, players?, grade?, stuff?: 'preset' | 'optimized', iterations?, profile? }`) et `POST /api/theory/stuff`
(`{ id, players?, grade?, preset?, roxx?, elements?, profile?, top?, iterations?, rangeNeed? }`) ; une erreur rend
`{ error }` avec un code HTTP.

### 2.3 Depuis un script

L'API est utilisable directement (TypeScript, `npx tsx script.ts`) :

```ts
import { loadDataStore } from './src/data/node'
import { loadBossOverrides, nodeDungeonSource } from './src/theorycraft/node'
import { bossProfile, formatClasses, listBosses, rankClasses, resolveBoss, stuffVsBoss } from './src/theorycraft/analysis'

const data = loadDataStore('data')
const boss = resolveBoss(listBosses(data, nodeDungeonSource(data)), 'pere ver')
const profile = bossProfile(data, boss.monsterId, { players: 4, overrides: loadBossOverrides().get(boss.monsterId) })
console.log(formatClasses(rankClasses(data, profile)))
const best = stuffVsBoss(data, { preset: 'iop_terre_burst' }, profile, { elements: 'all' }).best
```

`src/theorycraft/index.ts` est l'API pure (index des boss, fiches manuelles, fiche du boss ; utilisable dans un
navigateur) ; `analysis.ts` y ajoute les analyses (classes, stuff, rendus texte) ; `node.ts` lit les fichiers
(`dungeons.json`, `data/bosses`). Les résultats (`ClassRanking`, `StuffVsBossResult`, types de
`src/theorycraft/types.ts`) sont sérialisables en JSON.

## 3. Lire les résultats

### 3.1 La fiche du boss

- **En-tête** : grade et nombre de joueurs supposé, niveau, PV, PA, PM, esquives PA/PM, tacle.
- **Résistances** : *brute* = données du grade ; *effective* = après le sort de départ du boss (appliqué par le calcul :
  buffs de résistance, « dommages subis ×% »…) et la fiche manuelle. « Autres résistances » : réductions à distance ou
  en mêlée (Merkator : `distance 50 %`, son « −50 % de dommages subis à distance » traduit en résistance). Les éléments
  sont ensuite classés du plus faible au plus fort.
- **Profil offensif par phase** : une phase = un ensemble d'états du boss qui rend certains de ses sorts lançables
  (Solar : Aurore, Zénith, Crépuscule, Nadir). Colonnes : poids (part du combat supposée, égale par défaut),
  *attaquable* (`oui`, `non`, `mêlée seule`, `distance seule`), *pic/tour* = meilleure combinaison de sorts sur UNE
  cible en un tour (borne haute), *soutenu/tour* = moyenne sur 6 tours avec les relances, parts élémentaires des
  dégâts. La ligne « Répartition des dégâts reçus » pondère les phases qui frappent : c'est ce que vos résistances
  doivent couvrir. Ces dégâts sont calculés contre un joueur à 0 % de résistance.
- **Mécaniques** : détectées dans les données (états posés et leurs propriétés, invocations, soins, renvoi, érosion,
  retraits, glyphes…) ou ajoutées par la fiche manuelle (« fiche manuelle »). `contre` = ce qui y répond (mêlée,
  zone, esquive…), `punit` = ce qu'elle neutralise ; ces étiquettes alimentent les atouts et limites des classes.
- **Avertissements** : ce qui fausse le calcul pour ce boss (résistances ≥ 100 %, sorts qui ne frappent que dans une
  phase, invocations non comptées, effets de dégâts non gérés comptés à 0, données 3.6…).
- **Hypothèses** : les choix faits à sa place (grade, PV de référence de 4 000 pour les dégâts en % de PV, phases à
  poids égaux, invulnérabilité de départ supposée levée…).

Résistance ≥ 100 % (Kimbo : 400 % partout) : c'est une mécanique à faire tomber en combat, pas une immunité ; sans
fiche manuelle le calcul la prend au pied de la lettre (aucun dégât). Le classement des classes ajoute alors la colonne
« Rés. levées » (DPT si la mécanique ramène ces résistances à 0) et s'en sert pour la composition :

```
   #  Classe      Preset                   Valeur  Étalonné (moteur)  Rafale  Élément (rés.)  Posture                Rés. levées  Confiance
  --  ----------  -----------------------  ------  -----------------  ------  --------------  ---------------------  -----------  ---------
   1  Crâ         cra_feu_zone                  0          0 (×0,73)       0  Feu (400 %)     —                            3 967  basse
   2  Iop         iop_soutien                   0          0 (×1,00)       0  Terre (400 %)   —                            3 433  basse
   3  Ecaflip     ecaflip_terre_entrave         0          0 (×1,00)       0  Terre (400 %)   —                            3 213  basse
  […]
  Notes :
    - DPT nul pour tous les presets (résistances ≥ 100 % sans fiche manuelle) : les places « Dégâts » sont classées sur le DPT si la mécanique lève ces résistances.
```

Pour un résultat utile, écrire la fiche manuelle du boss (§5).

### 3.2 Le classement des classes

Chaque preset de base (49, de 2 à 3 voies par classe) est évalué avec son **stuff générique** (6 stuffs méta de
12/2024, jets max, partagés entre classes d'un même élément) ou, avec `--optimize`, un stuff optimisé contre le boss.
Pour chaque axe, une classe est représentée par **son meilleur preset sur cet axe** : le preset change d'un tableau à
l'autre. **Aucune note globale** : un tour consacré au soin n'est pas consacré aux dégâts, additionner les axes n'aurait
pas de sens. Le rang `=4` signale des ex æquo.

| Axe | Valeur | Comment la lire |
|---|---|---|
| **Dégâts** | DPT soutenu : dégâts par tour en régime établi (relances amorties), contre chaque phase attaquable du boss pondérée, meilleure posture de classe. | *Rafale* = meilleur tour isolé (relances ignorées). *Étalonné* = soutenu × étalonnage moteur du preset (`data/ai/calibration.json`, mesuré en mini-combat contre un Buboxor) : un **contrôle**, pas une correction ; un écart de plus de 10 % est signalé (Sram ×0,83 : le moteur inflige 17 % de moins). *Élément (rés.)* : élément du preset et résistance effective du boss. *Posture* : celle retenue (Zobal, Forgelance, Pandawa, Eliotrope, Steamer, Ouginak). |
| **Survie** | PV effectifs (PVe) du **stuff seul** face aux dégâts du boss. | Identiques pour les presets d'un même stuff générique (d'où les ex æquo) ; le kit défensif de classe compte dans l'axe Soin. *Reçus/tour* : un tour du boss sur ce personnage ; *Tours* = PV / reçus. |
| **Contrôle** | PM + PA retirés en UN tour (un seul budget de PA), espérance contre l'esquive du boss. | *PM seul* / *PA seul* : tour entier consacré à une réserve (non additionnables). Vaut 0 si le boss punit ce retrait (Merkator et les PM) ou n'a pas la réserve (Père Ver : 0 PM). |
| **Soin** | PV soignés ou préservés **utiles** par tour, total d'équipe : soin + bouclier (un budget de PA) + réductions et armures converties en PV. | Plafonné aux dégâts d'un tour du boss sur un personnage (*Brut* = avant plafond) : contre un boss qui tape peu, beaucoup de classes atteignent le plafond (ex æquo). Boucliers supposés consommés. |
| **Apport d'équipe** | % de dégâts gagnés par un allié de référence (Crâ Terre, 1 300 de caractéristique + Puissance, jets de 30, 12 PA). | Décomposé : « dommages subis » posés sur le boss, Puissance, Dommages, % dommages finaux, PA donnés (les PM ne comptent pas). Heuristique, jamais ajoutée au DPT. |

Le tableau **Par classe** reprend la meilleure valeur de chaque classe sur chaque axe. **Atouts et limites** croisent
les mécaniques du boss avec les utilités du preset (« Mêlée — invulnérable à distance : seuls les coups de mêlée
comptent ») ; **Non modélisé** liste ce que le calcul ignore pour cette classe (rampes du Iop, pièges du Sram,
invocations…). La **confiance** (haute, moyenne, basse) résume cette part non modélisée (Eniripsa et Enutrof hautes,
Sram, Féca, Osamodas basses…) et baisse pour un preset qui ne touche pas le boss ou dont la posture est incertaine.

**Composition suggérée.** Pour `--players` personnages (défaut 4), des règles écrites appliquées dans l'ordre, chaque
membre avec sa raison chiffrée, chaque règle écartée dans les notes :

1. **Dégâts** : le meilleur DPT soutenu.
2. **Soin** : si un tour du boss retire au moins **20 %** des PV d'un personnage (médiane des presets) et que le boss ne
   rend pas insoignable, le meilleur en PV soignés ou préservés utiles.
3. **Protection** : si le boss rend insoignable ou érode d'au moins **20 %**, le meilleur en boucliers et réductions.
4. **Retrait PM** : si le boss a des PM, que le retrait n'est pas puni et que le meilleur preset retire au moins
   **1 PM** par tour malgré l'esquive.
5. **Deuxième dégât** : le meilleur DPT d'une autre classe ; un preset d'un autre élément faible (moins de **10 points**
   de résistance d'écart avec le plus faible) est préféré s'il atteint **85 %** de ce DPT.
6. **Apport d'équipe** : le meilleur apport offensif d'une autre classe (la raison donne son DPT propre).
7. **Places restantes** : DPT suivants.

Une classe au plus par composition (doublon seulement faute d'alternative, signalé) ; si tous les DPT sont nuls
(résistances ≥ 100 % sans fiche), les places « Dégâts » utilisent les DPT « résistances levées ». C'est un point de
départ lisible, pas une optimisation de groupe : les synergies entre personnages ne sont pas calculées.

**Mode `--optimize`.** Chaque preset reçoit d'abord un stuff optimisé contre le boss selon **l'objectif de son rôle**
(§3.3) : un preset de soutien reçoit un stuff plus défensif, son DPT peut baisser. Surtout, l'optimiseur ne voit pas les
dégâts des classes à posture (§4) : contre le Père Ver (mesure du 2026-10-08, ≈ 15 s pour les 49 presets), le DPT
soutenu de `zobal_psychopathe` passe de 1 852 (stuff générique) à 538 et celui de `forgelance_zone_terre` de 2 440 à
1 237.
Pour ces classes, comparer avec le mode par défaut, ou chercher leur stuff avec `boss … stuff --class <preset>`, qui
classe leurs stuffs en DPT soutenu.

### 3.3 Le meilleur stuff

L'optimiseur de stuff (celui des commandes `stuff` et `optimize` du Vortex) cherche, avec la forgemagie supposée (un exo
PA, PM et PO au plus, jusqu'à 6 transcendances, pas d'over) et les jets max, le stuff qui maximise un **objectif J**
contre ce boss :

> J = DPT^a · PVe^b · (1 + c·UTIL) × pénalités, soit **logJ** = a·ln DPT + b·ln PVe + ln(1 + c·UTIL) + ln(pénalités)

- **a, b, c** viennent du **rôle** du preset (Tueur : a = 0,7, b = 0,3, c = 0 ; soigneur : 0,2 / 0,5 / 1…) et du
  **profil** : `defensive` retire 0,2 à a et l'ajoute à b, `offensive` ajoute 0,15 à a et le retire à b.
- **UTIL** : l'utilité du rôle (retraits, soins, tacle…).
- **Pénalités** : ×0,85 par PA, ×0,9 par PM et ×0,95 par PO sous les valeurs visées (12 PA, 6 PM, 6 PO à distance ou
  0 au contact ; `--range N` pour viser moins, ex. un Crâ qui compte sur ses bonus de PO temporaires). Un réglage de
  l'objectif, pas un effet du boss : la colonne *Pénalité* l'affiche (×0,950 = une PO manquante ; ×0,729 = 1 PA et
  3 PO manquants).

**Lire logJ.** Il n'a de sens qu'à personnage, rôle, profil et boss égaux. Un écart de +0,089 signifie J × e^0,089
≈ ×1,09 : environ 9 % de mieux sur l'objectif, à répartir entre dégâts (poids a) et survie (poids b). Dans l'exemple de
Merkator, l'« Optimisé n° 1 » gagne 10 % de DPT soutenu (1 064 → 1 167) et 8 % de PVe (5 393 → 5 847) sur le stuff du
preset ; l'« Optimisé n° 2 » échange un peu de DPT contre des PVe : le top montre ces compromis.

**Colonnes du tableau** :

- **DPT soutenu** : dégâts par tour en régime établi, meilleure posture, non calibré — la valeur à comparer. La rotation
  établie se répète tous les *période* tours ; le détail « DPT soutenu par sort » donne lancers par tour × dégâts par
  lancer (critique pondéré, résistances effectives du boss).
- **DPT proxy** : ce que l'optimiseur maximise (un tour isolé, relances ignorées, × calibration du preset, sans
  posture). Les deux vont dans le même sens pour la plupart des classes ; un DPT proxy nul avec un DPT soutenu positif
  signale une classe à posture.
- **PV / PVe** : PV effectifs = PV × (dégâts reçus sans défense / avec défenses) face au profil offensif du boss,
  plafonnés à 20 × PV (plafond signalé : la comparaison des PVe perd alors son sens). Ni soins, boucliers, érosion ni
  kit défensif de classe.
- **Reçus/tour** : un tour du boss sur ce personnage (phases pondérées), détaillé par élément sous le meilleur stuff.
- **PA/PM/PO** et **Pénalité** (ci-dessus).

**Classes à posture.** L'optimiseur ne pose aucune posture (masques du Zobal, Armé du Forgelance, Saoul du Pandawa…) :
il voit parfois un DPT nul. Quand le DPT soutenu sans posture est sous 1/1,2 de celui en meilleure posture, les stuffs
sont classés par le **logJ soutenu** (DPT du proxy remplacé par le DPT soutenu en posture), puis affinés par une montée
par coordonnées sur ce score. Contre le Père Ver, Zobal Psychopathe :

```
  Stuff                                                         logJ soutenu (écart au départ)  DPT soutenu  DPT proxy     PV     PVe  Reçus/tour  PA/PM/PO  Pénalité
  Stuff du preset (Terre — Cœur Saignant / Brouce / Torkéloni…                           7,831        1 852          0  4 153   5 173         556    12/6/6         —
  Générique Air — Allister / Cycloïde / Submergée                               7,361 (−0,470)          958          0  4 153   5 016         573    12/6/5         —
  […]
  Optimisé n° 1 (affiné en DPT soutenu)                                         7,893 (+0,061)        1 577          0  4 853   9 234         364    12/6/4         —
  Optimisé n° 2 (affiné en DPT soutenu)                                         7,891 (+0,059)        1 734          0  4 753   7 345         448    12/6/6         —
  Optimisé n° 3 (affiné en DPT soutenu)                                         7,874 (+0,042)        1 573          0  4 953   8 707         394    12/6/6         —
  Optimisé n° 4                                                                 7,687 (−0,145)          937          0  5 903  15 664         261    12/6/5         —
  Classement par le logJ SOUTENU : le proxy de l'optimiseur ne pose aucune posture de classe et ne voit au départ que 0 de DPT soutenu sans posture, contre 1852 en « Masque de l’Intrépide ». Le DPT du proxy est remplacé par le DPT soutenu en posture (× calibration du preset) pour classer ensemble stuffs de référence et candidats ; la recherche, elle, reste aveugle à ces dégâts (ses stuffs privilégient la survie).
  […]
Meilleur stuff : Optimisé n° 1 (affiné en DPT soutenu) — logJ soutenu 7,893 (+0,061 par rapport au départ)
  DPT soutenu 1 577 (rafale 1 577, période 1 tour, posture « Masque de l’Intrépide ») ; DPT proxy 0
  PV 4 853, PVe 9 234, dégâts reçus 364/tour (Neutre 175, Air 192)
```

Ici le meilleur stuff perd près de 15 % de DPT soutenu (1 852 → 1 577) mais gagne 78 % de PVe (5 173 → 9 234) : c'est le
compromis du rôle Tueur (a = 0,7, b = 0,3). Au-delà de 15 % de perte de DPT, la sortie l'avertit ; pour privilégier les
dégâts, `--profile offensive`.

**Le meilleur stuff** est détaillé objet par objet (emplacement, niveau, forgemagie supposée), avec les points, les
parchemins (100 partout ; un lien RoxxSolver sans parchemins reçoit 100 partout, signalé), les **objets changés** par
rapport au départ et le DPT par sort. Les Dofus et objets à **sort passif** (Ocre, Vulbis, Abyssal…) valent 0 pour le
calcul : ceux du départ sont gardés imposés (« sort passif non valorisé »). Le **top** (5 par défaut, `--top N`) ne
garde que des stuffs qui diffèrent d'au moins 2 objets ; un stuff de référence (départ, générique) que rien ne bat
reste en tête. Un départ invalide (objets trop hauts pour `--level`, conditions non remplies) n'est jamais présenté
comme meilleur.

**Équivalences des caractéristiques.** Ce que vaut un point de chaque caractéristique contre CE boss, en points de la
caractéristique principale du stuff (dérivées de l'objectif au meilleur stuff) :

```
Équivalences des caractéristiques contre ce boss (référence : Force)
  1 PA (sous le plafond) ≈ 712 Force, dont 519 de pénalité d’objectif (194 pour les effets modélisés) — par poids de rune : ×7,12
  1 PM (sous le plafond) ≈ 336 Force, dont 336 de pénalité d’objectif (0 pour les effets modélisés) — par poids de rune : ×3,74
  1 Portée (sous le plafond) ≈ 164 Force, dont 164 de pénalité d’objectif (0 pour les effets modélisés) — par poids de rune : ×3,21
  1 % Dommages distance ≈ 21 Force — par poids de rune : ×1,40
  1 % Dommages aux sorts ≈ 21 Force — par poids de rune : ×1,40
  1 % Résistance aux sorts ≈ 9,62 Force — par poids de rune : ×0,64
```

- « 1 % Dommages distance ≈ 21 Force » : pour ce Crâ contre Merkator, 1 % de dommages distance vaut 21 Force.
- **PA, PM, PO** : valeur d'un point *sous le plafond* (au-delà, un point ne vaut rien), dont la part due aux seules
  **pénalités de l'objectif** (« dont 519 de pénalité d'objectif ») : la part *modélisée* (dégâts, survie) est le reste
  (194 Force pour un PA). Un PM vaut 0 pour les effets modélisés : aucune position n'est simulée.
- **Par poids de rune** : la même comparaison à coût de forgemagie égal (poids des runes) ; ×1,40 = plus rentable que
  la Force à la forgemagie.
- Valeurs locales (petits changements autour du meilleur stuff), pour ce boss, ce rôle et ce profil.

## 4. Hypothèses et limites

Chaque sortie liste les siennes ; voici l'ensemble, sans fard.

**Pas un combat.**
- Aucune position, ligne de vue, déplacement, tacle ni placement ; aucun PM dépensé ; un sort de zone frappe la seule
  cible visée.
- Ni invocations (les vôtres comme celles du boss), ni glyphes, pièges, bombes, tourelles ; l'arme n'est pas lancée.
- Ni rampes ni cumuls entre tours (Fureur, Colère de Iop au retour de relance, paliers de Flèche Dévorante), ni buffs
  entre sorts d'un même personnage, ni PA rendus en cours de tour ; poisons et effets différés par heuristique.
- Buffs d'équipe entre personnages affichés à part (axe Apport d'équipe), jamais ajoutés aux dégâts.
- Postures de classe : la meilleure, supposée tenue tout le combat, sans coût de changement.
- **PA et PM retirés par le boss non déduits** : chaque personnage dispose de tous ses PA à chaque tour, même contre
  un boss qui en retire (mécanique « retrait PA/PM », ex. Merkator). Le DPT est alors surestimé, et l'esquive PA/PM
  des personnages n'est valorisée ni par l'objectif de l'optimiseur ni par les équivalences : la mécanique n'apparaît
  que dans la fiche et dans les atouts et limites des classes.

**Les dégâts du boss sont une estimation, pas une borne.** Le pic est optimiste (la meilleure combinaison de sorts sur
une cible), mais plusieurs sources de dégâts ne sont pas comptées : le total peut être SOUS-estimé, et avec lui la
colonne *Reçus/tour* et le seuil de 20 % de la règle Soin de la composition, surtout contre un boss à zones, à
invocations ou à sorts en réaction. Les PVe (un rapport : dégâts sans défense / avec défenses) en dépendent aussi, par
la répartition élémentaire et le poids des résistances fixes, et peuvent être faussés dans un sens ou dans l'autre.
- Ses dégâts viennent d'un sac à dos sur ses PA (meilleure combinaison de sorts sur une cible), pas de son IA ; le
  soutenu suppose qu'il frappe une cible par tour ; zones (une seule cible touchée), sorts déclenchés en réaction et
  dégâts de ses invocations ne sont pas comptés ; les sorts lancés par ses alliés non plus.
- Lignes aléatoires pondérées par leur probabilité (espérance, pas le pire tirage) ; critique pondéré.
- Dégâts en % de PV : 4 000 PV de référence par joueur, boss à mi-vie, 10 % de PV érodés. Effets de dégâts rares non
  gérés (dommages par PA/PM utilisé, % des dommages subis…) comptés à 0 et listés dans les avertissements.
- Phases à poids égaux, déduites des conditions d'états de ses sorts (6 au plus) ; une invulnérabilité de départ est
  supposée levée ; les buffs d'une phase de départ ne sont pas appliqués. Seule une fiche manuelle dit comment le
  combat se déroule vraiment.
- Résistances ≥ 100 % : immunité dans le calcul tant qu'une fiche manuelle ne donne pas les résistances réellement
  subies. **Aucune fiche manuelle n'est encore écrite** (`data/bosses/` ne contient que le modèle) : tous les boss sont
  calculés à partir des seules données.

**Les personnages sont des modèles.**
- **Presets écrits à la main** : 49, de 2 à 3 voies par classe, variantes de sorts fixées. Une classe peut avoir une
  meilleure voie contre ce boss que ses presets.
- **Stuffs génériques de 12/2024** (6 stuffs méta, jets max), partagés par élément : l'axe Survie ne distingue pas deux
  classes du même stuff.
- Optimiseur : jets max des objets, forgemagie supposée réalisable, sorts passifs valorisés à 0, recherche aléatoire à
  graine fixe (déterministe, pas une preuve d'optimalité : écart moyen au meilleur logJ observé 0,003 avec les réglages
  par défaut, mesure du 2026-10-08 sur 8 presets × 5 boss).
- Le DPT du proxy porte une calibration mesurée au Vortex ; le DPT soutenu n'est pas calibré ; l'étalonnage affiché à
  côté a été mesuré contre un Buboxor, pas contre le boss.
- `--optimize` (classes) : le stuff suit l'objectif du rôle de chaque preset et ne voit pas les postures (§3.2).
- Sous le niveau 200, le classement des classes par défaut compare des personnages sans équipement (les kits de classe,
  pas les stuffs) ; `--optimize` leur donne un stuff optimisé avec des objets de ce niveau (§2.1).

**Données.**
- **Données DofusDB de la version 3.6, extraites le 2026-10-04.** La 3.7 est en ligne depuis le **2026-10-06** : elle a
  modifié plusieurs boss (esquive PA des monstres −30 %, tacle, fuite, initiative, résistance à la poussée…) ; rien de
  cela n'est intégré (§7). Les boss et donjons ajoutés par la 3.7, s'il y en a, sont absents.
- La formule de dégâts reproduit **DoMath** (vérifiée contre DoMath, pas contre le jeu) ; la vérification en jeu reste
  à faire (§6).

## 5. Écrire une fiche de boss (`data/bosses/<id>.json`)

Les données disent ce que le boss **peut** faire, pas **comment** le combat se joue : quelles résistances il a vraiment
après sa mécanique, combien de temps dure chaque phase, quels sorts son IA ne lance jamais, quels monstres
l'accompagnent. Une fiche manuelle le dit ; elle est facultative et appliquée automatiquement (CLI sans
`--no-overrides`, page web, `loadBossOverrides`).

**Procédure.**

1. Trouver l'id du boss : `npm run sim -- bosses <nom>`.
2. Lire ce que les données en disent : `npm run sim -- boss <id> --details` affiche, en plus de la fiche, le tableau de
   tous ses sorts (id, PA, lancers, relance, dégâts par élément, drapeaux) et l'arbre de son sort de départ (effets,
   états posés, sous-sorts). Les ids d'états et de sorts à citer dans la fiche viennent de là.
3. Copier `data/bosses/_template.json` vers `data/bosses/<id>.json` (le nom doit être l'id), remplacer les valeurs,
   supprimer les clés inutiles.
4. Relancer `boss <id>` : la ligne « Fiche manuelle appliquée (date) » apparaît ; une clé inconnue, un type inattendu ou
   une valeur hors domaine bloque le chargement avec le fichier et le chemin de la clé en cause.

**Brouillons.** Les fichiers dont le nom commence par `_` sont ignorés (`_template.json`, `_1045.json`…) : y rédiger
une fiche tant qu'elle n'est pas valide. `loadBossOverrides` (page web, scripts) lit **tout** le dossier : une seule
fiche invalide y empêche d'appliquer les autres (la page web le signale par un avertissement et n'en applique aucune ;
un script reçoit l'erreur). En ligne de commande, une fiche invalide fait échouer les commandes `boss` qui la lisent ;
`--no-overrides` les relance sans fiche. `--bosses-dir D` lit les fiches d'un autre dossier (pour essayer une fiche
sans toucher à `data/bosses`, comme l'exemple ci-dessous).

**Schéma (version 1)**, toutes les clés facultatives sauf `version` et `monsterId` ; éléments dans l'ordre
[Neutre, Terre, Feu, Eau, Air], pourcentages en points :

| Clé | Effet |
|---|---|
| `version`, `monsterId` | `1` ; id du monstre (= nom du fichier). |
| `name`, `notes` | Information. |
| `sources` | `[{ url, date, patch }]` : chaque source consultée, sa date de consultation, la version du jeu. |
| `updatedAt`, `patch` | Date de mise à jour de la fiche (`AAAA-MM-JJ`), version du jeu décrite (`"3.7"`). |
| `resPct` | Résistances **effectives** imposées pour toutes les phases. |
| `stats` | Caractéristiques imposées (clés de `Stats`), ex. `{ "rangedResPct": 50 }`. |
| `phases` | **Remplace** les phases calculées : `id`, `name`, `states` (états du boss qui rendent ses sorts lançables), `weight` (part du combat), `resPct` (ou `null`), `vulnerable` (`true`, `false`, `"melee"`, `"range"`), `notes`. |
| `adds` | `[{ monsterId, grade, count }]` : monstres de la salle, comptés dans les dégâts reçus de l'optimiseur (exposition 0,5 par monstre par rapport au boss). |
| `excludeSpells` | Sorts que le boss ne lance pas en pratique. |
| `positionalSpells` | Sorts qui ne touchent qu'en position particulière (listés, hors pic et soutenu). |
| `mechanics` | `[{ kind, summary, counters, punishes }]` : mécanique décrite avec vos mots, utilités qui y répondent ou qu'elle punit (listes des valeurs : `data/bosses/README.md`). |

**Exemple** (structure réelle, valeurs **fictives** : les ids d'états 29 et 30 sont ceux que les données donnent au
Kimbo, les résistances par phase sont inventées pour l'exemple) :

```json
{
  "version": 1,
  "monsterId": 1045,
  "name": "Kimbo",
  "sources": [{ "url": "https://example.org/fiche-kimbo", "date": "2026-10-08", "patch": "3.6" }],
  "updatedAt": "2026-10-08",
  "patch": "3.6",
  "phases": [
    { "id": "impair", "name": "Glyphe impair", "states": [29], "weight": 1, "resPct": [400, 400, 400, 400, 0], "vulnerable": true },
    { "id": "pair", "name": "Glyphe pair", "states": [30], "weight": 1, "resPct": [400, 0, 400, 400, 400], "vulnerable": true }
  ],
  "mechanics": [
    { "kind": "res-change", "summary": "EXEMPLE FICTIF : un élément retombe à 0 % selon la phase.", "counters": ["multi-element"] }
  ],
  "notes": "EXEMPLE FICTIF pour la documentation : valeurs inventées, à ne pas réutiliser."
}
```

Effet sur la fiche et le classement (sorties réelles de `boss kimbo --bosses-dir <dossier de test>` puis
`boss kimbo classes --bosses-dir <dossier de test>`, cette fiche seule dans le dossier) : les deux phases de la fiche
remplacent les trois phases calculées, les DPT ne sont plus nuls.

```
Kimbo (1045) — grade 1, 4 joueur(s)
===================================
  Niveau 160 · PV 6 900 · PA 10 · PM 7 · Esquive PA 80 · Esquive PM 80 · Tacle 80
  Fiche manuelle appliquée (2026-10-08).
  […]
Profil offensif par phase
  Phase          Poids  Attaquable  Pic/tour  Soutenu/tour  Neutre  Terre  Feu  Eau    Air
  -------------  -----  ----------  --------  ------------  ------  -----  ---  ---  -----
  Glyphe impair   50 %  oui              505           505       —      —    —    —  100 %
  Glyphe pair     50 %  oui              505           505       —      —    —    —  100 %
  […]
Dégâts (DPT soutenu)
  Valeur : DPT analytique (classement) ; « Étalonné » = × étalonnage moteur du preset (contrôle, data/ai/calibration.json).
   #  Classe      Preset                 Valeur  Étalonné (moteur)  Rafale  Élément (rés.)  Posture                Rés. levées  Confiance
  --  ----------  ---------------------  ------  -----------------  ------  --------------  ---------------------  -----------  ---------
   1  Iop         iop_terre_burst         2 360      2 360 (×1,00)   2 360  Terre (200 %)   —                            3 388  moyenne
   2  Féca        feca_glyphes            2 229      2 229 (×1,00)   2 229  Terre (200 %)   —                            3 111  basse
   3  Ecaflip     ecaflip_terre_entrave   2 180      2 171 (×1,00)   2 180  Terre (200 %)   —                            3 213  moyenne
```

La colonne « Élément (rés.) » affiche la résistance **moyenne** pondérée par les phases (200 % = moyenne de 400 % et
0 %) : avec des résistances qui changent selon la phase, lire plutôt le DPT.

**Règles des sources** (détail : `data/bosses/README.md`) :

1. **Écrire avec ses propres mots** : résumer une mécanique (« −50 % de dommages subis à distance »), jamais recopier
   le texte d'un guide.
2. **Citer chaque source** : URL, date de consultation, version du jeu (`sources`, `patch`, `updatedAt`). Une fiche sans
   source est une hypothèse : le dire dans `notes`.
3. **Aucune copie ni extraction automatique** (script, robot, agent) d'un site dont les conditions d'utilisation
   l'interdisent. C'est le cas de **dofuspourlesnoobs** : ses CGU interdisent l'accès automatisé, la reproduction et
   l'usage de son contenu pour alimenter une IA ou une base de connaissances. On peut le lire soi-même et en tirer des
   faits de jeu reformulés, en citant l'URL ; rien de plus.
4. **DofusWiki** (dofuswiki.fandom.com) est sous licence **CC-BY-SA** : réutilisable avec attribution (URL et licence
   dans `sources` / `notes`) et partage dans les mêmes conditions.
5. Les chiffres des données (statistiques, sorts, états) ne se recopient pas, sauf pour les **corriger** (résistances
   réellement subies…) en expliquant pourquoi dans `notes`.
6. Préférer la version courante du jeu et le dire (`patch`) : la 3.7 a modifié de nombreux boss.

Le dépôt ne respecte pas encore ces règles partout : la documentation de recherche, antérieure (`docs/research`,
surtout `mechanics.md`, `monster-ai.md` et `vortex-audit.md` sur le Vortex), cite textuellement DofusPourLesNoobs à
plusieurs endroits et mentionne une copie locale de l'une de ses pages (`.cache/vortex/guides/`, ignorée par git). Sa
mise en conformité (reformuler en faits avec l'URL, supprimer la copie) reste à faire et à décider (ROADMAP, CP6).

## 6. Vérifier en jeu

La formule de dégâts reproduit DoMath, vérifiée contre DoMath (≈ 45 000 tirages comparés à une transcription de sa
fonction de dégâts et 43 vecteurs produits par son code), **pas contre le jeu**. La commande `degats` sert à faire
cette vérification soi-même, sur un sort à la fois.

**Ce qu'elle calcule.** Pour chaque ligne de dégâts du sort (un élément par ligne ; sous-sorts, poisons, lignes
conditionnelles signalés) : dégâts min-max d'un coup normal et d'un coup critique avec leur moyenne exacte, chance de
critique, espérance d'un lancer ; contre les résistances effectives d'un boss (`--boss`) ou des résistances données
(`--res n,t,f,e,a`, défaut 0 partout). `--trace` détaille le calcul du jet max étape par étape (avec `--crit` : le jet
critique max). Hors combat : ni buffs, ni états, ni modificateurs de sort, ni sorts passifs ; la cible est touchée sur
la case d'impact (pas de réduction de zone). **Mêlée ou distance** : en jeu, un coup est en mêlée quand la cible est
sur une case adjacente au lanceur, à distance sinon, et les % de dommages et de résistances mêlée ou distance en
dépendent ; la sortie dit quel cas elle calcule (en-tête du sort et hypothèses).

**Protocole.**

1. **Un stuff connu.** Reproduire son stuff dans RoxxSolver et copier le lien (`--roxx`). RoxxSolver ne donne pas les
   jets : ils sont supposés **max**. Si vos objets ne sont pas parfaits, comparer d'abord la ligne « Lanceur » de la
   sortie (caractéristique de l'élément, Puissance, Dommages, Dommages de l'élément, Dommages critiques, Critique, % de
   dommages) avec la fiche de caractéristiques du jeu. Deux façons de traiter un écart :
   - **l'interpréter** (le plus simple) : quelques points de caractéristique en moins donnent quelques dégâts en moins,
     à garder en tête en comparant les relevés ;
   - **le corriger** dans un fichier de build (`--build`) qui porte les jets réels. Aucun outil n'écrit ce fichier à
     partir de VOTRE stuff (`stuff --out` écrit le meilleur stuff optimisé ; l'éditeur `#stuffs` importe un lien
     RoxxSolver mais n'édite pas les jets) : partir du champ `build` d'un membre de `data/teams/<nom>.json` (lien
     importé dans l'éditeur, puis « Enregistrer sous… » un nouveau fichier pour ne pas toucher à l'équipe du Vortex)
     ou d'un fichier `--out`, ou l'écrire à la main, puis ajouter à chaque objet ses jets `rolls` :
     `{ "<effectId>": valeur }`, l'effectId étant celui de la ligne de l'objet dans les données (`possibleEffects` de
     `data/dofusdb/equipment.json` ; 118 = Force, 126 = Intelligence, 123 = Chance, 119 = Agilité, 125 = Vitalité), la
     valeur positive comme dans les données. Exemple minimal (points, parchemins et variantes absents ⇒ ceux du preset
     donné par `--preset`) :

     ```json
     { "build": { "level": 200, "items": [ { "itemId": 19244, "rolls": { "118": 61 } } ] } }
     ```

     Vérifié : ce jet de Force à 61 au lieu de 80 sur l'Amulette du Cœur Saignant (19244) fait perdre 19 Force à la
     ligne « Lanceur ».
2. **Sans buffs.** En jeu, aucun buff ni état actif ; retirer (ou noter) les Dofus et objets à sort passif dont l'effet
   se déclenche en combat.
3. **Une cible connue.** Un Poutch : d'après les données, le Poutch Ingball (monstre 494) a 0 % de résistance dans les
   cinq éléments, soit le défaut de `--res`. Sur un monstre de résistances connues : `--res` avec ses pourcentages
   (Neutre, Terre, Feu, Eau, Air) ; sur un boss : `--boss <id> [--players N]`.
4. **Taper et noter.** Lancer le sort 20 à 30 fois, sans zone autour de la cible, **dans le cas que la sortie
   calcule** : au contact (case adjacente) pour un calcul en mêlée, à au moins 2 cases de la cible pour un calcul à
   distance. Un sort de portée 1 à 6 lancé au contact reçoit en jeu les % de mêlée : si la sortie le calcule à
   distance, l'écart vient de là dès que le stuff a des % de dommages mêlée ou distance. Noter chaque dégât affiché en
   séparant coups normaux et critiques.
5. **Comparer** à `npm run sim -- degats …` : chaque coup normal dans l'intervalle « Normal », chaque critique dans
   « Critique », la proportion de critiques proche de « %CC » (sur 30 lancers, un écart de ±18 points — deux
   écarts-types — reste plausible), la moyenne proche de « Espérance ».
6. **En cas d'écart**, `--trace` (puis `--trace --crit`) pour voir à quelle étape il naît (caractéristique, dommages
   fixes, résistances, % de dommages) ; noter le lien du stuff, le sort, la cible, les valeurs relevées, la date et la
   version du jeu.

**Exemple de valeurs calculées** (stuff du preset `enutrof_soutien`, jets max, Lancer de Pièces, Poutch à 0 %) :
`npm run sim -- degats --preset enutrof_soutien --sort "Lancer de Pièces"`.

| Élément | Normal | Moyenne | Critique | Moyenne CC | %CC | Espérance |
|---|---|---|---|---|---|---|
| Eau | 388-419 | 403,67 | 444-475 | 459,33 | 56 % | 434,84 |

Valeurs du stuff de ce preset : un vrai personnage aura les siennes. Fiche de relevé suggérée :

| Date / version | Stuff (lien) | Sort | Cible (rés.) | Normaux relevés (min-max, n) | Critiques relevés (min-max, n) | Calculé | Écart |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 7. Mettre à jour les données vers la 3.7

Les données du dépôt sont celles de la **3.6** (extraction DofusDB du 2026-10-04) ; la 3.7 est sortie le 2026-10-06.
Le script d'extraction lit déjà le schéma 3.7 de l'API (renommage des résistances et des esquives, nouveaux champs) et
refuse d'écrire des données incomplètes ; **la ré-extraction n'est pas faite**, parce qu'elle change des valeurs de
référence du Vortex : **c'est une décision de l'utilisateur**.

**Conséquences connues** (relevées sur des réponses 3.7 de l'API, `docs/research/dofusdb-api.md` §10) : esquive PA des
monstres ramenée à ≈ 70 % (Vortex 80 → 56 : retraits de PA plus efficaces, au Vortex comme dans l'axe Contrôle du
theorycraft), tacle, fuite et initiative des boss en hausse, résistance à la poussée de certains boss, tags des
monstres vides, bombes du Roublard qui héritent aussi des dommages fixes, de la Puissance et des dommages neutres.
Les résultats mesurés du Vortex (6,4 % de victoires, rapports de `docs/reports/`, `data/ai/calibration.json`) l'ont
été en 3.6 et ne seraient plus comparables tels quels.

**Procédure** (détail : `docs/research/dofusdb-api.md` §10.5) :

1. `NODE_USE_ENV_PROXY=1 node scripts/fetch-dofusdb.mjs --refresh --game-version=3.7` (≈ 880 requêtes, ≈ 75 s ;
   `--refresh` obligatoire, sinon le cache rend des réponses 3.6). De préférence sur une branche dédiée.
2. Lire le journal : schéma des grades `3.7` seul, aucune « clé de grade inconnue », publication en fin de run. En cas
   d'échec, `data/dofusdb/` n'a pas bougé (écriture tout ou rien).
3. Contrôler `data/dofusdb/manifest.json` (`game`, `checks.vortexBossResPctAndDodge` = `[6, 33, 12, 21, 28, -24, 20]`
   attendu) et `git diff --stat data/dofusdb`.
4. Theorycraft : mettre à jour `DATA_SNAPSHOT` dans `src/theorycraft/bossProfile.ts` (date et version affichées dans
   l'avertissement de chaque fiche) ; relancer les tests `tests/theory-*.test.ts`, dont plusieurs épinglent des valeurs
   de boss (Merkator, Père Ver, Solar, Comte Harebourg…) à revoir ; relire les fiches manuelles (`patch`).
5. Relancer les tests `data-*`, puis la suite complète ; tests à mettre à jour listés au §10.5 ; régénérer l'étalonnage
   si besoin (`WRITE_CALIBRATION=1 npx vitest run tests/ai-core-calibration.test.ts`).
6. Vortex : re-mesurer avant de citer de nouvelles valeurs (`batch`, `optimize`), mettre à jour les rapports qui citent
   des valeurs du Vortex et `docs/research/dofusdb-api.md` §7.3.

Rester en 3.6 (état actuel) garde les rapports du Vortex comparables ; le theorycraft décrit alors les boss d'avant la
3.7, ce que l'avertissement de chaque fiche rappelle.
