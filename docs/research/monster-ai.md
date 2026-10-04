# IA des monstres Dofus — recherche et conception pour DofusSimu

> Dossier de recherche (CP1). Objectif : écrire des IA de monstres/boss **fidèles** au jeu (Dofus 3 / Unity,
> données 2026) pour le moteur TypeScript (`src/ai`), puis les IA spécifiques de l'**Œil de Vortex**.
> Convention : tout ce qui n'est pas confirmé par une source officielle ou par les données du jeu (DofusDB)
> est marqué **INCERTAIN** avec la meilleure estimation. Les sources sont listées en fin de document (§11)
> et référencées par des tags `[S#]`.

## 0. Résumé exécutif (à lire en premier)

1. **Il n'existe pas de « script » d'IA par monstre côté client** : l'IA tourne sur le serveur (fermé).
   Ankama a dit qu'il y a **une seule IA générique** et que ce qui change d'un monstre à l'autre est son
   **comportement** (« le Dragonnet est peureux, le Craqueleur agressif ») `[S1]`. Les comportements
   nommés dans les notes de version officielles sont : **agressif**, **peureux**, **fou**, **dévoué** `[S2–S6]`,
   et dans les données Dofus 3 l'effet **2188 `ModifyAiBehaviour`** (« Change le comportement du monstre »)
   révèle des profils numérotés : **1 = Agressif, 2 = Paniqué, 5 = Apathique** (et 3 sur « Zarbivore
   perturbé ») `[S12]`.
2. **L'essentiel des mécaniques de boss est encodé dans les DONNÉES, pas dans l'IA** : sort de départ
   passif (`grades[].startingSpellId`, présent sur **157 des 209 boss** de DofusDB), effets **déclenchés**
   (`triggers` : début/fin de tour `TB/TE`, mort `X`, dommages subis `D/DR/DM`, déplacement `M`, dommages
   de poussée `PD`, soin `H`, apparition/disparition d'état `EON#/EOFF#`…), **masques de cible
   conditionnels** (`E#/e#` état, `F#/f#` id de monstre, `V#/v#` seuil de % PV, préfixe `*` = condition sur
   le **lanceur**) et `statesCriterion` des sorts (`HS=x`, `HS!x`). Le Vortex en est l'exemple parfait (§7).
   ⇒ Le moteur doit exécuter fidèlement ces données ; l'IA ne fait que **choisir parmi les sorts
   lançables**. Les « overrides » par boss ne servent qu'à reproduire des **priorités de décision**.
3. Règles comportementales **officielles** (notes de version, §1.2) : l'agressif se place sur les cases
   adjacentes à plusieurs ennemis pour les tacler, recule pour lancer une zone, ne tente pas de fuir un
   tacle s'il a peu de chances d'y arriver, finit son tour sur les glyphes positifs et évite les négatifs,
   ne pose pas de piège qu'il déclencherait, tient compte des dommages de collision de poussée, évite
   d'attaquer un ennemi qui le tuerait par renvoi/déclenchement, évite les cibles sous renvoi de sorts,
   tape les invulnérables si cela retire un état, utilise tous ses PA s'il rate un kill estimé. Le
   **peureux** attaque puis s'éloigne ; **s'il n'a fait aucune action offensive de son tour, il devient
   agressif jusqu'à sa prochaine action offensive** `[S4]` (sauf s'il ne peut rien infliger à cause des
   résistances/renvois `[S5]`).
4. Choix de cible (observations 2.0 `[S9]`, confirmées indirectement par les notes) : le **% de PV** et les
   **résistances** comptent ; l'IA préfère **achever** (et n'utilise alors que les PA nécessaires) ; elle
   préfère les **dommages de poussée** à une poussée « gratuite ». Les émulateurs (non officiels) font :
   Stump → maximiser les dégâts effectifs avec amortissement de l'overkill ; 1.29 → cible au plus bas PV.
5. Conception proposée (§8) : un **cerveau générique** qui génère des plans « (déplacement) + sort + cible »,
   les évalue par **simulation** sur un clone de l'état (`rollMode: 'average'`), choisit le meilleur de façon
   gloutonne (fidèle à Ankama) avec option beam-search (« smart ») ; la fonction de score est une somme
   pondérée en **PV-équivalents** (dégâts effectifs plafonnés, bonus de kill, retraits PA/PM pondérés par
   la menace de la cible, états, buffs, soins, tir ami, terme de position spécifique au comportement).
   Les **profils** (agressif/peureux/fou/dévoué/apathique/soutien/statique/bloqueur) et les **overrides
   par monstre** (hooks `beforeTurn`, `scoreCast`, `filterCast`, `endPosition`) sont déclaratifs.
6. Œil de Vortex : profils détaillés §7 (Ikargn brute de zone/attireur, Méjaire lanceuse en ligne +
   Pacifiste, Harpille diagonale/ligne + poison global, Buboxor corps-à-corps voleur de PM, Brabuzar
   pousseur/téléporteur ; Vortex en 2 phases pilotées par l'état **236 « Marginal »**).
7. ⚠️ Écart détecté dans le code existant : `src/engine/targetMask.ts` interprète `*E#` comme une condition
   sur la **cible**, `*F#/*f#` comme des **états** du lanceur, et traite `E#`, `e#`, `F#`, `f#`, `V#`, `v#`
   **sans étoile** comme des lettres (jamais satisfaites). D'après le client (DamageUtil.as `[S13]`) et
   `data/research/zone-and-mask-grammar.json` : `*` = condition évaluée sur le **lanceur** ; `E#/e#` = la
   cible (ou le lanceur si `*`) a / n'a pas l'état # ; `F#/f#` = la cible est / n'est pas le **monstre
   d'id #** (plusieurs `F` = OU) ; `V#/v#` = PV% ≤ # / > #. À corriger, sinon les mécaniques du Vortex
   (heures, Marginal, Auroraire `F3833`) seront fausses.

---

## 1. Ce que l'on sait de l'IA officielle

### 1.1 Architecture : une IA générique + des comportements

* Citation (forum officiel, visible via moteur de recherche — **verbatim INCERTAIN**, dofus.com renvoie 403
  depuis cet environnement) : « *Il n'y a qu'une seule IA générale dans DOFUS, mais ce qui change c'est le
  comportement des monstres : le dragonnet peureux tandis que le craqueleur est agressif* » `[S1]`.
* Devblog Dopeuls `[S10]` : « *Comme toutes les invocations, les Dopeuls dépendent d'une intelligence
  artificielle et ne sont donc absolument pas contrôlés par leur invocateur.* » — et Ankama a réduit leurs
  sorts à 3 pour rendre leur comportement « *plus facile à anticiper* » : l'IA est **gloutonne** et
  prévisible ; plus il y a de sorts, plus le résultat est difficile à prévoir.
* Comportements cités officiellement :

| Comportement | Source | Ce qui est dit |
|---|---|---|
| **Agressif** | 2.2.0 `[S2]`, 2.3.5 `[S4]`, 2.4.0 `[S5]` | se rapproche des ennemis, tacle, recule pour placer une zone, gère les téléportations |
| **Peureux** | 27/07/10 `[S6]`, 2.3.5 `[S4]`, 2.4.0 `[S5]` | attaque puis garde ses distances ; bascule agressif s'il n'a rien fait d'offensif ; « *La Surpuissante ne tente plus de se rapprocher inutilement des adversaires* » |
| **Fou** | 2.3.1 `[S3]` | « *Les monstres au comportement « fou » (comme le Chaferfu par exemple) n'attaquent plus les glyphes* » — INCERTAIN : vraisemblablement attaque n'importe quelle entité (alliés compris) |
| **Dévoué** | 2.2.0 `[S2]` | « *continuent de prendre en compte la position de leur invocateur mais évitent désormais de se rapprocher des ennemis* » (invocations de soutien) |
| **Paniqué / Agressif / Apathique** | données Dofus 3 `[S12]` | sorts 31043/31044/31049 (Zarbivores) : effet 2188 avec `value` 2 / 1 / 5 ; « Zarbivore perturbé » (31519) : `diceNum` 3 |

  Hypothèse (INCERTAIN) sur l'énumération serveur : `1 = agressif`, `2 = peureux/paniqué`,
  `3 = variante (perturbé/fou ?)`, `4 = dévoué ?`, `5 = apathique` (n'inflige rien : l'état 6261
  « Apathique » a le drapeau `cantDealDamage`). Le comportement d'un monstre « normal » n'est **pas** exposé
  dans les données (pas de champ `aiType` dans `monsters`) → nous devons l'**inférer** (§3) ou le
  configurer à la main (overrides).
* Les comportements peuvent **changer en combat** via l'effet 2188 (Mutation du Lapino `[S12]`, Zarbivores :
  `Alerté` déclenché sur `VE|X`, puis bascule Agressif/Paniqué/Protecteur selon des états de « saison »).

### 1.2 Règles comportementales officielles (notes de version)

Chaque ligne est une règle à implémenter (ou un test à écrire).

| # | Règle (citation abrégée) | Version / source | Implication moteur |
|---|---|---|---|
| R1 | « *Les monstres au comportement agressif tentent désormais de se positionner sur les cellules adjacentes partagées par plusieurs adversaires, afin d'essayer de tacler le plus d'adversaires possible.* » | 2.2.0 `[S2]` | terme de position `+tackle × nbEnnemisAdjacents` |
| R2 | « *…tentent désormais de reculer pour utiliser des sorts avec une zone d'effet de plus d'une case qu'ils ne pourraient pas lancer sans reculer.* » | 2.2.0 `[S2]` | la recherche de case de lancer inclut des cases plus éloignées de la cible |
| R3 | « *Les monstres tentent désormais de terminer leurs tours sur les glyphes positifs et de ne pas terminer leur tour sur les glyphes négatifs.* » + « *n'invoquent plus sur des glyphes aux effets négatifs* » ; 2.3.5 : « *ne cherchent plus à se positionner sur les glyphes qui soignent s'ils ont tous leurs points de vie* » | 2.2.0 `[S2]`, 2.3.5 `[S4]` | terme de position « glyphe » évalué par la valeur des effets de la glyphe pour ce monstre |
| R4 | « *si l'IA sait qu'elle a très peu de chance de réussir à sortir d'une zone de tacle, elle ne tentera pas de déplacement* » | 2.2.1 `[S7]` | estimer la fuite (`escapeRatio`) avant de bouger |
| R5 | « *L'IA gère désormais correctement le tacle lorsqu'elle est entourée par plusieurs ennemis.* » ; invocations agressives qui taclent 2 cibles ne cherchent plus à sortir | 2.3.1 `[S3]`, 2.3.5 `[S4]` | coût du tacle intégré au coût de chemin |
| R6 | « *Les monstres prennent donc correctement en compte les dommages qu'ils vont occasionner en poussant une cible sur une autre.* » | 2.3.1 `[S3]` | simuler les collisions de poussée dans le score |
| R7 | « *les monstres évitent désormais d'attaquer les ennemis qui pourraient automatiquement les tuer sur réception de dommages* » | 2.4.0 `[S5]` | pénalité si le score simulé inclut la mort du lanceur (renvoi, déclencheurs `D`) |
| R8 | « *L'intelligence artificielle aura moins tendance à lancer des sorts sur les cibles bénéficiant d'un effet de renvoi de sorts.* » | 2.11 `[S8]` | la simulation applique le renvoi ; malus explicite optionnel |
| R9 | « *L'IA tente désormais d'attaquer des cibles invulnérables si l'attaque permet de retirer certains états.* » | 2.4.0 `[S5]` | ne pas filtrer les cibles invulnérables : laisser le score (états retirés) décider |
| R10 | « *L'IA utilise correctement tous ses PA disponibles si elle estimait tuer une cible en une seule attaque mais qu'elle n'y parvient pas.* » | 2.4.0 `[S5]` | replanifier après chaque lancer (jets aléatoires) |
| R11 | « *L'IA gère mieux les enchaînements d'actions lorsqu'une des cibles meurt.* » ; Dragonnet Rouge « *capable d'attaquer une cible qui était cachée par une cible qu'il a tuée* » | 2.3.5 `[S4]`, 2.3.1 `[S3]` | replanification après chaque action (LdV recalculée) |
| R12 | Peureux sans action offensive → agressif jusqu'à la prochaine action offensive | 2.3.5 `[S4]` | machine à états par combattant (`fighter.tags.aiMode`) |
| R13 | Peureux incapable d'effets négatifs (résistances/renvoi) → ne bascule pas | 2.4.0 `[S5]` | condition de la bascule R12 |
| R14 | « *les monstres ne posent plus de pièges qu'ils vont déclencher en se déplaçant* » | 2.4.0 `[S5]` | filtrer les plans « piège puis mouvement à travers » |
| R15 | « *Les monstres ne peuvent plus être bloqués sur les bords de carte.* » | 2.4.0 `[S5]` | pathfinding correct (pas de bug d'adjacence de bord, cf. 2.3.5) |
| R16 | Monstres avec sorts d'invisibilité « *essayent désormais de se déplacer avant leur fin de tour et après avoir dévoilé leur position* » | 2.2.0 `[S2]` | profil « invisible » : se déplacer après une attaque |
| R17 | Invisibles : « *lorsqu'un monstre attaque une case vide mais potentiellement occupée par un invisible, il estime une nouvelle position pour l'invisible si la case était vide, sinon il continue d'attaquer la même case* » | 2.3.5 `[S4]` | modèle de croyance (§4.6) |
| R18 | Effets de déplacement sur attaque (Dérobade) : « *les monstres n'attaquent plus dans le vide après le déplacement de leur cible* » | 2.3.5 `[S4]` | replanification |
| R19 | Effets de début de tour mieux gérés (ex. +1 PA du Craqueleur Légendaire) | 2.3.5 `[S4]` | l'IA planifie APRÈS l'application des `TB` |
| R20 | « *L'IA gère plus efficacement les effets qui ne se déclenchent que lors des coups critiques.* » | 2.3.1 `[S3]` | espérance = (1-p)·normal + p·critique |
| R21 | Cumuls max par cible : le Dopeul Crâ « *ne devrait plus lancer son sort Tir Puissant sur son invocateur si celui-ci profite déjà des effets du sort* » | 2.4.0 `[S5]` | respecter `maxStack` ; buff sans effet ⇒ score 0 |
| R22 | Résurrection de plusieurs alliés dans le même tour (Glourséleste) | 2.4.0 `[S5]` | sorts de rez (780) re-candidats tant qu'il reste des morts |
| R23 | Le Double « *tente désormais de bloquer deux cibles* », évite les pièges sans ennemi | 2.2.0 `[S2]` | profil « bloqueur » |
| R24 | Monstres sans PM lançant des zones « cercle inversé » correctement | 2.2.0 `[S2]` | candidats « lancer sur place » pour monstres à 0 PM (cas du Vortex phase 1) |
| R25 | « *Le fonctionnement de l'IA est optimisé afin d'améliorer les performances globales des serveurs* » | 25/05/10 `[S11]` | l'IA officielle est bornée en calcul ⇒ gloutonne, pas de recherche profonde |

### 1.3 Observations communautaires (wiki JOL 1.29 → 2.0, 2010) `[S9]`

Tableau rédigé par des joueurs (non officiel, ancien mais cohérent avec R7–R10) — comportement 2.0 :

* **Choix de la cible** : « *Le % de vie importe dans le choix de la cible. Ainsi, une invocation […]
  utilisera 4/12 PA pour tuer une cible et passer son tour ensuite au lieu d'en utiliser 12/12 pour amocher
  une cible.* » ; « *Les résistances importent dans le choix de la cible. Ce comportement pousse les
  invocations à tenter le tacle pour changer de cible.* » ; « *Préfèrent taper l'invocation* » (en 2.0).
* **Renvoi de sorts** : « *N'attaquent que si des dommages peuvent être occasionnés.* »
* **Réductions** : « *Ne tapent pas mais peuvent parfois taper une seule fois pour tester les réductions.* »
* **Poussée** : « *Préfèrent occasionner des dommages de poussée plutôt que de repousser de plusieurs
  cases.* »
* **Invisibles** : « *Les monstres calculent toutes les cases où la cible pourrait se trouver en fonction
  de ses PM et de sa dernière position connue.* » ; si un allié du monstre le révèle via un sort monocible,
  « *tous les mobs se dirigent vers l'invisible* ».
* Un même post rapporte qu'en 2.0 les invocations « *pètent un câble* » face à un invisible (tapent des
  alliés) → ne pas reproduire, c'était un bug.

Ce que ce tableau implique : la fonction d'utilité officielle est **orientée kill / dégâts effectifs**
(résistances incluses), pas « cible la plus proche ». Le « plus proche » ne sert qu'au **déplacement** par
défaut quand rien n'est lançable.

### 1.4 Ce qui est scripté dans les données (et doit être exécuté par le moteur, pas par l'IA)

Constat sur `data/dofusdb/monsters.json` + `monster-spells.json` (5 135 monstres, 4 672 sorts) :

* **Sort de départ** (`grades[].startingSpellId` → `startingSpellLevels`) : 2 146 monstres, **157/209
  boss**. C'est un sort passif lancé à l'apparition (glyphes, états permanents, buffs déclencheurs).
  Exemples Vortex : 5006 « Vortexiphan » (Vortex), 4999 « Heure du temps » (Auroraire), 5002 « Glyphe
  téléporteur » (tous les monstres de vague).
* **Déclencheurs** (`triggers`, fréquences dans les sorts de monstres) : `I` 25 214, `TB` 836, `D` 680,
  `TE` 430, `X` 224, `H` 119, `DM` 93, `DE` 88, `DR` 86, `MPA` 79, `PD` 72, `DW/DA/DF/DN` (dommages d'un
  élément), `M` 59, `DTB/DTE`, `P`, `DCAC`, `APA`, `DBE/DBA`, `MS`, `CT`, `CI`, `TP`, `PPD`, `R`,
  `EON<état>`/`EOFF<état>` (apparition/disparition d'un état — phases), `TR<sort>` (déclenché par un sort
  donné — ex. « Tanukouï San Phase I/II/III »), `EK:…`, `EC:…` (conditions de comptage), `VE` (Zarbivores).
  La grammaire complète est dans `data/research/zone-and-mask-grammar.json` (autre ingénieur) ; codes
  confirmés côté client dans `DamageUtil.verifyEffectTrigger` `[S13]` : `I, D, DA, DBA, DBE, DC, DE, DF,
  DM (dist ≤ 1), DN, DR (dist > 1), DS, DW, M, MD, ML, MP, MS, A (PA perdus), m (PM perdus), H (soigné)`.
* **Masques conditionnels** (fréquences) : `A` 16 610, `a` 8 184, `C` 7 351, `F#` 3 132, `E#` 1 942,
  `e#` 1 890, `*E#` 1 639, `g` 1 437, `*e#` 1 064, `f#` 696, `*F#` 520, `L` 264, `P` 192, `B#` 190,
  `U` 175, `V#` 125, `v#` 98, `O` 74, `*v#` 59, `*V#` 57, `T` 29…
  Sémantique client `[S13]` : `*` = condition évaluée sur le **lanceur** ; `E#`/`e#` = a / n'a pas
  l'état # ; `F#`/`f#` = la cible est / n'est pas le monstre # (plusieurs `F` = OU) ; `V#` = PV% ≤ # ;
  `v#` = PV% > # ; `P` = invocation du lanceur ; `O/o` = entité ayant déclenché ; `T, U, W, K, Z, p, b`
  non résolus côté client (serveur) → INCERTAIN (cf. fichier de grammaire).
* **Phases par seuil de PV** : 166 effets de monstres utilisent `V#/v#`, ex. « Comtoise » (3646) :
  bandes `v90`, `v75,V90`, `v60,V75`, `v45,V60`, `v30,V45`, `v0,V30` ; « Sacrifice Douloureux » (233) :
  `*V50`. **Phases par état** : « Tanukouï San Phase I/II/III » (16841-16843) se retirent/remplacent
  (406) et posent les états 1893/1894/1895 ; « Débuff des Bonus de phases » (12326) sur `EON1088…1091`.
* `statesCriterion` des sorts (`HS=x`, `HS!x`, `&`, `|`) : **le sort n'est lançable que si le lanceur a
  (n'a pas) l'état** → c'est ainsi qu'un boss change de « deck » selon la phase (Vortex : Heuristique et
  Morfaille `HS!236`, Contamination zombie `HS=236`).
* `canPlay=false` (204 monstres), `canTackle`, `canBePushed`, `canSwitchPos`, `canBeCarried`,
  `useSummonSlot`, `summonCost` : contraintes à respecter par le moteur et l'IA.

**Conséquence de conception** : le cerveau générique doit être capable de jouer *n'importe quel* sort en
évaluant ses effets par simulation (dont les sous-sorts 792/793/1160…, les états, les déclencheurs) ; la
plupart des « comportements de boss » émergent alors d'eux-mêmes. Seules les **priorités** que la
simulation ne capte pas (valeur d'un buff d'heure, timing d'Heurage, etc.) passent en override.

---

## 2. Émulateurs : implémentations de référence (NON officielles)

Les serveurs privés ont réimplémenté l'IA par observation. Utile comme patron d'implémentation, à ne pas
prendre comme vérité. Code téléchargé dans `.cache/monster-ai/`.

### 2.1 Stump (Dofus 2.x, C#) `[S14]`

`Server/Stump.Server.WorldServer/AI/Fights/` :

* **Boucle** (`Brain.Play`) : `SpellSelector.AnalysePossibilities()` → `ExecuteSpellCast()` (boucle :
  `FindFirstSpellCast()`, déplacement `MoveBefore` si nécessaire, lancers consécutifs jusqu'à
  `MaxConsecutiveCast`, **ré-analyse** si une cible bouge/meurt) → `ExecutePostMove()`.
* **Post-déplacement** : si le monstre a une attaque à distance avec `maxRange > 3` et `minRange < maxRange`
  → `StayInRange(min,max,LoS)` (case la plus proche de soi qui est dans l'anneau [min,max] d'un ennemi
  visible, avec LdV si un de ses sorts teste la LdV) ; sinon `MoveNearTo(nearestEnemy)` (case adjacente
  libre la plus proche). La fuite (`FleeAction` : maximiser la **somme des distances** aux ennemis, tirage
  aléatoire en cas d'égalité) existe mais est commentée.
* **Catégories de sorts** (`SpellIdentifier`, par effet) : `Summoning`, `Buff`, `Damages{Neutral,Fire,
  Air,Water,Earth}`, `Healing`, `Curse` (retraits, vols de stats, poussée/attirance, passe-tour, érosion…),
  `Teleport`. **Priorités** : Summoning 5 > Buff 4 > Damages 3 > Healing 2 > Curse 1.
* **Impact d'un lancer** (`ComputeSpellImpact`/`CumulEffects`) pour chaque cellule cible atteignable :
  - dégâts = `((base × (1 + (stat+%do)/100) + do) − réduction fixe) × (1 − rés%/100)` (min/max) ;
  - `random` → pondéré par la probabilité ; cible **invocation → impact ÷ 2** ;
  - effets sur alliés : dégâts × **−0,3** puis « amplifiés » ×2 (pénalité de tir ami) ;
  - **overkill** : si dégâts min > PV de la cible, l'impact est ramené à `max(PVmax/2, PV)` ;
  - buff = `+niveau du sort` (allié) / `−` (ennemi) ; curse = `+niveau` (ennemi), passe-tour = `2 × niveau
    cible` ; soin plafonné aux PV manquants ; vol de vie = soin sur soi plafonné.
  - Score = `Boost + Damage + Heal + Curse` ; un impact ≤ 0 est rejeté.
* **Tri** : par catégorie, `max(impact) × floor(PA / coût)` (efficacité = nombre de lancers possibles) ;
  à score égal, cellule de lancer la plus proche. Plusieurs sorts retenus par tour avec vérification de
  l'ordre (lancer d'abord le 2ᵉ si le 1ᵉʳ demande un déplacement et qu'il reste assez de PM).
* **Cerveaux spécifiques** : `[BrainIdentifier(monsterId)]` → classe dédiée (Tonneau, Synchro, Sac animé…)
  ou `InitBrain` (sort auto-lancé à l'apparition, table SQL) — exactement le patron « générique + overrides ».

### 2.2 Émulateur 1.29 type StarLoco (Java) `[S15]`

`src/fight/ia/IAHandler.java` : le template de monstre porte un **numéro d'IA** (`getIa()`), ~80 classes :
`1/27` basique (attaque, PM, attaque, PM), `5` bloqueuse (avancer vers l'ennemi, sans sort), `6/47` coffre
animé, `8` Surpuissante (invocation, buff, fuite), `9` « la Fourbe » (attaque puis fuite), `10/14` tonneau,
`15/30` buff soi puis attaque, `32` **archer** (attaque, PM loin de l'ennemi), `33` buff allié puis
attaque, `34` Glouto (attaque **tout le monde**), `37` branche soignante (soin allié), `39/72` corbac (en
ligne, fuite), `42` Gonflable, `46` Lapino, `52` avance + soin + buff allié + fuite, `53` Peki (invisible
après 3 attaques et fuite), `54` Bworkmage, `55-68` Dopeuls de classe, `79` boost l'invocateur et reste
près de lui, `81` soutien (soin allié > soin perso > buff allié > buff perso > attaque, reste près d'un
allié), `82` invocateur (invocation + boost invocation + attaque)…

* Classement des sorts (`AbstractNeedSpell`) : `BUFF`, `INVOCATION`, `HEAL`, `GLYPH`, `DEPLACEMENT`,
  `CAC` (portée max < 3), `HIGHEST` (portée max > 1).
* Ordre type (IA27) : buff soi → invoquer (loin de l'ennemi si possible) → soigner si PV < 70 % →
  se placer pour attaquer avec LdV → sort de mobilité → attaquer (zone si plus de cibles, sinon meilleur
  sort sur la cible la plus faible) → finir le déplacement autour de l'ennemi le plus proche.
* « Influence » d'un sort (`getInfl`) : retrait PA **4000/pt**, retrait PM **3000/pt**, retrait PO
  2500/pt, poussée 1000, désenvoûtement 5000, passe-tour 50 000, tue 60 000, dégâts élémentaires
  `(100 + stat) × jet moyen`, vol de vie `(200 + stat) × jet moyen`.
* Cible d'attaque : liste « plus bas PV d'abord » (`getLowHpEnnemyList`) — **mais stockée dans une
  `HashMap`, donc l'ordre est perdu** (bug) ; déplacement vers l'ennemi **le plus proche** (les
  invocations statiques en dernier recours).

### 2.3 Leçons retenues

| Point | Officiel | Stump | 1.29 | Notre choix |
|---|---|---|---|---|
| Choix de cible | %PV + rés + kill (R/§1.3) | max dégâts effectifs, overkill amorti | plus bas PV / plus proche | **dégâts effectifs plafonnés + bonus de kill pondéré par la menace** |
| Ordre des actions | non documenté | invoc > buff > dégâts > soin > malus | buff > invoc > soin > attaque | **émergent** (simulation), départage par priorités Stump |
| Profondeur | gloutonne (R25) | gloutonne + ré-analyse | séquence fixe | gloutonne + ré-analyse ; beam optionnel « smart » |
| Déplacement final | agressif/peureux/dévoué | StayInRange / MoveNearTo | « autour » de l'ennemi | terme de position par comportement (§8.6) |
| Aléa | prévisible `[S9][S10]` | aléa en égalité de fuite | — | déterministe, graine pour égalités, bruit optionnel |

---

## 3. Archétypes de comportement : définition et détection automatique

Les données ne donnent pas le comportement ; on l'infère des sorts (catégories issues de
`data/research/effect-semantics.json` : `kind/subkind`), puis on surcharge à la main si un guide
contredit. Statistiques sur les 894 monstres « graines » des donjons : 144 invocateurs, ~136 avec soin
allié (heuristique large), 16 sans aucun effet de dégâts, 10 avec `141 Tue la cible` sur eux-mêmes.

| Archétype (`behaviour`) | Détection (première règle vraie) | Règles de jeu |
|---|---|---|
| `static` | `canPlay=false`, ou PA=0 et PM=0 (ex. Auroraire 3833) | ne joue pas (le moteur applique ses déclencheurs) |
| `apathetic` | état `cantDealDamage` permanent / effet 2188=5 / aucun sort | se déplace pour ne pas gêner (ou ne fait rien) ; soins TE éventuels |
| `summoner` | sort `summon` (181, 180, 1189, 780 rez, 405, 1008) | invoquer en début de tour si slot libre (Stump : priorité 5), à distance de l'ennemi (1.29 `invocIfPossibleloin`) ; ne pas invoquer sur glyphe négative (R3) |
| `healer` (soutien) | effets `heal` (108, 1109, 2998-3002, 90…) au masque allié `a/g`, hors vol de vie et 786 | soigner l'allié qui maximise `min(soin, PV manquants) × urgence` ; seuil d'activation PV < 95 % (1.29 : 70 % pour soi) ; reste à portée de soin des alliés, loin des ennemis |
| `buffer` | buffs allié (`stat_buff`, `shield`, 1163 <100 sur allié) | buff l'allié qui va frapper/encaisser ; ne pas re-buffer un allié au `maxStack` (R21) |
| `kamikaze` | sort dont un effet `141 Tue` cible le lanceur (`C`) ou soin/explosion à la mort (`X`) | n'utilise le sort suicidaire que si `valeur(dégâts) > valeur(sa survie)` (≥ seuil, ex. 1,5 × ses PV restants en PV-équivalents) ; s'approche du groupe le plus dense |
| `blocker` | aucun sort de dégâts mais `canTackle` et tacle élevé (`boostTackle`) ; ou bloqueuse | se coller au plus grand nombre d'ennemis (R1, R23) |
| `fearful` (peureux/paniqué) | override (Dopeul, Dragonnet, Berger Porkass, Surpuissante…) ; heuristique : tous les sorts offensifs `minRange ≥ 2` et `maxRange ≥ 5` | agir puis s'éloigner (maximiser la distance pondérée à la menace) ; bascule R12/R13 |
| `kiter` (« archer ») | heuristique Stump : sort de dégâts avec `maxRange > 3` et `minRange < maxRange`, pas de sort CàC | se placer dans l'anneau [min, max] d'une cible avec LdV ; finir hors portée de CàC si possible |
| `aggressive` (défaut) | tout le reste | rejoindre la meilleure cible, taper, tacler plusieurs ennemis (R1) |
| `mad` (fou) | override (Chaferfu…) | tous les autres combattants sont des cibles (alliés compris — INCERTAIN) ; n'attaque pas les glyphes (2.3.1 `[S3]`) |
| `devoted` (dévoué) | invocations de soutien (override) | rester près de l'invocateur, éviter les ennemis (2.2.0) |
| `invisible` | sort `invisibility` (150) | attaquer puis se déplacer après s'être dévoilé (R16) |

Un monstre peut combiner des tags (ex. `summoner+healer`) : on garde un **comportement de déplacement**
(`aggressive|fearful|kiter|devoted|blocker|static|apathetic|mad`) et des **capacités** (summon, heal,
buff, kamikaze, invisible) qui ne font que changer des poids.

---

## 4. Thèmes transverses

### 4.1 Ciblage : « plus bas PV » vs « plus proche » vs « dégâts effectifs »

* Officiel (§1.3) : % de PV et résistances comptent ; préférence pour le kill ; n'utilise que les PA
  nécessaires au kill (puis peut « passer »).
* Notre score (§8.4) : `Σ min(dégâts effectifs, PV+bouclier)` + bonus de kill, ce qui reproduit :
  achever une cible faible > entamer une cible pleine ; cible à faible résistance > cible tank.
* Le « plus proche » sert uniquement :
  1. au déplacement quand aucun lancer n'est possible ce tour (rejoindre l'ennemi dont la **valeur
     d'attaque au prochain tour** est maximale, à défaut le plus proche — Stump/1.29) ;
  2. au départage à score égal (cellule de lancer la plus proche, Stump).
* Invocations : facteur `summonValue` (Stump 0,5 ; mais §1.3 dit qu'en 2.0 les monstres « *préfèrent
  taper l'invocation* » quand elle est tuable) → **le bonus de kill doit s'appliquer aux invocations**,
  seul le terme de dégâts « entamés » est divisé. Paramètre à calibrer (INCERTAIN).

### 4.2 Ligne de vue

* Seuls les sorts `castTestLos=true` testent la LdV (entre case de lancer et case cible ; les combattants
  bloquent, sauf le lanceur). Ex. Vortex : **Heuristique n'a pas de LdV** (`castTestLos=false`), Méjaire
  Envolupté et Buboxor Hoxor non plus.
* L'IA cherche une case de lancer dans sa zone de déplacement qui donne la LdV (Stump
  `GetCellToCastSpell`) ; règle R2 : accepter de **reculer** si la zone ne passe pas autrement.
* Après chaque action, la LdV est recalculée (R11 : la mort d'un combattant peut ouvrir une ligne).

### 4.3 Tacle et fuite

* Le moteur expose `escapeRatio` (`src/engine/move.ts`) ; l'IA doit intégrer la perte PA/PM **attendue**
  dans le coût d'un chemin et ne pas tenter un déplacement si la probabilité de sortie est faible (R4).
* Un monstre agressif qui tacle déjà 2 ennemis ne cherche pas à partir (R5).
* `canTackle=false` / état « Intacleur » (95) : ignorer le terme de tacle. « Intaclable » (96, heure 2 du
  Vortex) : ignorer le coût de fuite.

### 4.4 Glyphes, pièges, poussée

* Glyphes : terme de position (R3) = valeur des effets que la glyphe appliquera au monstre au début/fin de
  tour (soin si PV manquants > 0, dégâts négatifs…). Les monstres « fous » n'attaquent pas les glyphes.
* Pièges : le monstre ne voit pas les pièges invisibles des joueurs ; il évite les pièges **visibles**
  sans ennemi dessus (comportement du Double, R23) ; il ne pose pas de piège sur son propre chemin (R14).
* Poussée : simuler la collision (dégâts de poussée au poussé + à l'entité percutée, R6) ; préférer
  « dommages de poussée » à « éloignement » (§1.3).

### 4.5 Renvoi, réduction, invulnérabilité

* Renvoi de sorts / renvoi de dommages : la simulation les applique ; si le lanceur meurt dans la
  simulation → score `−∞` (R7) ; malus additionnel `reflectAversion` pour R8.
* Réductions/armures : ne pas attaquer si le gain simulé est nul ; tolérer **un** essai par combat si
  l'information est inconnue (« tester les réductions », §1.3 — optionnel, `probeReductions`).
* Invulnérable : la simulation donne 0 dégât ; mais si le sort retire un état (dispel, 951) → score > 0
  (R9). Les monstres invulnérables **jouent** normalement (ex. vague qui arrive en Œil de Vortex).

### 4.6 Invisibilité (modèle de croyance)

`belief(invisible) = ensemble des cases atteignables depuis la dernière position connue avec ses PM`.
Attaquer la case de probabilité maximale (zones de préférence) ; si l'attaque révèle une case vide, la
retirer (R17) ; si un allié du monstre révèle l'invisible par un sort monocible, tout le monde converge
(§1.3). Hors périmètre Vortex (aucun Sram requis) — implémenter en V2.

### 4.7 Aléa et déterminisme

* L'IA officielle est décrite comme **prévisible** (« *Leur comportement est prévisible et peu surprenant…
  pour peu qu'on le connaisse* » `[S9]`) ; l'aléa vient des jets (dégâts, CC, esquive PA/PM) et des
  égalités.
* Implémentation : décision **déterministe** sur l'espérance (`rollMode: 'average'`), égalités départagées
  par le RNG du combat (graine) ; option `noise` (softmax de température τ sur le top-3) pour les
  simulations Monte-Carlo de l'optimiseur (robustesse du stuff face à des IA légèrement différentes).
* L'exécution réelle tire les jets (`rollMode: 'random'`) puis **replanifie** (R10).

### 4.8 Coordination entre monstres

Aucune coordination officielle documentée : chaque monstre joue son tour, glouton, dans l'ordre
d'initiative. Les synergies existent par les **données** (ex. Harpille « Tirs optiques » double la
prochaine attaque reçue ; Buboxor « Feinterception » soigne le prochain qui tape la cible) et sont
captées si le score tient compte des buffs/débuffs posés sur la cible (§8.4, terme « prochain coup »).
Option non officielle `teamFocus` (tableau noir d'équipe) désactivée par défaut.

### 4.9 Donjons à vagues (dimensions divines) — ce que l'IA doit savoir

* 1 seule salle, **5 vagues** ; nombre de monstres par vague = nombre de personnages au début du combat
  (figé même si un personnage meurt) `[S16]` ; une vague arrive au bout de N tours **ou** dès que la
  précédente est entièrement tuée ; **la vague qui arrive est invulnérable 1 tour** `[S17]` ; elle
  apparaît sur les positions de départ des monstres de la vague 1 `[S16]`.
* Timing **INCERTAIN** (désaccord des guides) : JOL « *vagues tous les 5 tours, vague 2 au tour 6* »
  `[S16]` ; DPLN « *un tour de plus pour la première vague (la deuxième vague arrive tour 7)* » `[S17]` ;
  Tofus « *tous les 5 tours* » `[S18]`. Voir le dossier Vortex (scénario) pour la valeur retenue.
* IA : une vague invulnérable **joue** (elle peut taper) ; la valeur de « dégâts » infligés aux monstres
  invulnérables est 0 côté joueurs (l'IA de groupe doit le savoir, pas l'IA des monstres).

---

## 5. Tags DofusDB → IA générique

Les `tags` des monstres sont **calculés par DofusDB** (pas des données du jeu) : 55 valeurs. Mapping
inféré empiriquement (effet présent dans ≥ 97 % des monstres portant le tag et ≥ 2 occurrences) :

| Tag | Effets déclencheurs (effectId) | Sémantique IA | Terme de score / usage |
|---|---|---|---|
| `earth/fire/water/air/neutral` | dégâts 97/99/96/98/100, vols 92/94/91/93/95, % 85-89, `bestElem` 2828/2829 | élément(s) de frappe | rés. des cibles ⇒ choix de cible ; utile à l'IA de groupe (rés. à monter) |
| `multi` | plusieurs éléments dans un même sort (ex. Heuristique air+feu) | — | idem |
| `lifeSteal` | 91-95, 2828 | dégâts + soin de soi | `heal` plafonné aux PV manquants |
| `heal` | 108, 786, 1109, 2020, 2998-3000 | soin | terme `heal` (allié) |
| `poison` | dégâts avec `triggers=TB/TE` (durée) | dégâts différés | espérance sur la durée × décote 0,8/tour ; annulation au soin (Petit poison) |
| `erode` | 776 | érosion | `erosionValue` (réduit soins futurs) |
| `push` | 5, 1041, 414, 1103 | repousser / dommages de poussée | collision simulée (R6) |
| `pull` | 6, 1042 | attirer / avancer | position finale des cibles (agressif : ramener au CàC) |
| `tp` | 4, 8, 1023, 1099, 1104-1106 | téléportation / échange / symétrie | mobilité + repositionnement des cibles |
| `retPA` / `retPM` / `retPO` | 1079/168/84/440 ; 1080/77/169 ; 116/320 | contrôle | `apMpValue` × esquive attendue |
| `boostAP/MP/PO/Power/ElemDmg/CC/…` | 111, 128, 117, 138, 112, 115, 418… | buffs | `buffValue` (Δdégâts futurs) |
| `boostShield` | 1020, 1039, 1040 | bouclier | `shieldValue` = min(bouclier, dégâts entrants attendus) |
| `boostPushDmg` | 414 | +dommages de poussée | combo avec `push` |
| `malusRes` / `malusDmg` | 210-214, 417, 246 / 186, 145, 1172 | débuffs | Δdégâts (alliés futurs / ennemi) |
| `debuff` | 132, 1075 | désenvoûtement / réduction de durée | valeur = somme des buffs retirés de la cible |
| `summon` | 181, 780, 405, 1189 | invocation / rez | priorité d'invocation |
| `glyph` / `trap` | 401, 402, 1091, 1165 / 400 | zones persistantes | simuler 1 tour d'effet |
| `boostTackle/Dodge/EsqMP…` | 753, 752, 161… | buffs défensifs | faible poids |

**Limites** (importantes) : le tag n'est pas exhaustif (ex. 1163 « Dommages subis x% » de la Méjaire/Harpille
et l'état **Pacifiste** ne sont pas taggés ; les déclencheurs et conditions sont ignorés). ⇒ **Recalculer
nos propres capacités** à partir des effets (`effect-semantics.json`, fermeture transitive des sous-sorts
792/793/1160/2160/1017-1019) ; utiliser les tags DofusDB uniquement comme filtre/recherche dans l'UI.

---

## 6. Boss scriptés : patrons et traitement

| Patron | Encodage dans les données | Traitement moteur | Rôle de l'IA |
|---|---|---|---|
| Invulnérabilité conditionnelle | état 56 « Invulnérable » posé par sort de départ, retiré par 406/951 sur `EON/EOFF` ou condition | moteur | ignorer les dégâts sur cible invulnérable sauf retrait d'état (R9) |
| Phases par état | `950/951` + `statesCriterion` (HS=/HS!) + `EON#/EOFF#` + `TR#` | moteur | lire l'état pour choisir le jeu de sorts (automatique via `canCast`) |
| Phases par PV | masques `V#/v#` (`*V#` sur le lanceur) | moteur | rien (ou valoriser le passage de seuil côté joueurs) |
| Résurrection | 780 « Invoque le dernier allié mort » (souvent `TB`) | moteur | — |
| Vagues | scénario (`ScenarioHooks`) + invulnérabilité d'arrivée | scénario | — |
| Auras/glyphes de boss | 401/402/1091/1165 au départ ou en `TB` | moteur | terme de glyphe |
| Comportement scripté | 2188 (changement de profil) | moteur → `fighter.tags.aiBehaviour` | changer de profil |
| Priorités non capturées | — | — | **override** (`src/ai/overrides/<monsterId>.ts`) |

---

## 7. Œil de Vortex (donjon 87, carte 143393281)

Dossier complet des mécaniques (heures, Auroraire, corruption, glyphes) : voir le dossier Vortex rédigé en
parallèle (`docs/research/` — scénario) ; ici, uniquement ce qui sert à l'IA. Données : DofusDB
(`monsters/3833-3839`, `spells`, `spell-levels`, `spell-states`) ; dégâts « jet de base » (×(1+850/100) =
×9,5 avec 850 dans l'élément, avant résistances) ; tous les sorts de ces monstres n'ont **qu'un niveau**.

### 7.1 Fiches (grade max ; grades 1-6 = niv. 200→212, 6 000→6 600 PV)

| Monstre (id) | PV | PA/PM | Stats | Rés. % N/T/F/E/A | Faiblesse | Esq. PA/PM |
|---|---|---|---|---|---|---|
| Ikargn (3834) | 6 600 | 12/5 | 850 partout | 7/12/**−10**/28/43 | Feu | 0/0 |
| Méjaire (3836) | 6 600 | 12/4 | 850 | 12/**−10**/28/43/7 | Terre | 0/0 |
| Harpille (3837) | 6 600 | 12/5 | 850 | **−10**/28/43/7/12 | Neutre | 0/0 |
| Buboxor (3838) | 6 600 | 12/**6** | 850 | 28/43/7/12/**−10** | Air | 0/0 |
| Brabuzar (3839, grade 5 max) | 6 600 | 12/5 | 850 | 43/7/12/**−10**/28 | Eau | 0/0 |
| Vortex (3835, boss) | 22 000 (15 000→22 000) | **16/5** | 800 | 6/33/12/21/28 | Neutre (6 %) | 0/**20** |
| Auroraire (3833) | 5 500 | 0/0 | — | — | — | — |

Esquive PA/PM nulle sur les monstres de vague ⇒ le retrait PA/PM des joueurs (Enutrof, Xélor, Crâ) y est
maximal (les guides recommandent un Enutrof retrait PM `[S17]`).

### 7.2 Sorts (données DofusDB) et comportement observé

#### Ikargn — « brute de zone / attireur » (profil `aggressive`)

| Sort | PA | Portée | Limites | Effets (DofusDB) |
|---|---|---|---|---|
| Attraction ailée (5015) | 4 | 0 (sur soi) | relance 3, **initialCooldown 1** | zone cercle 3 autour de lui : **attire de 3**, −3 PM (1080, esquivable), état Pesanteur 1 t, vole 100 Agi 2 t ; **au tour suivant** (793, delay 1) : 80 Air en cercle 3 (5014) |
| Cercle de feu (5016) | 4 | 0 | 1×/tour (relance 1), CC 20 % | cercle 2 autour de lui : 61-80 Feu, vole 100 Int 2 t |
| Terre mythe (5017) | 4 | 1 (CàC) | 2×/tour, 1×/cible, CC 20 % | 51-70 Terre, −3 PA, vole 100 Force 1 t |

Observé : « *attire […] dans un rayon de 3 cases autour de lui, retire 3PM […] (ne peut pas être lancé tour
1)* », « *Cercle de feu […] zone cercle de rayon 2* » `[S17]` ; « *effectuant des dommages principalement en
zone autour de lui* » `[S16]` ; Tofus : l'explosion différée de l'attraction « *tape […] même ses alliés* »
`[S18]` (INCERTAIN : le masque `A` de 5014 vise les ennemis du lanceur).
**Plan type** (12 PA) : se placer pour avoir le max d'ennemis à ≤ 3 → Attraction ailée (les colle à lui)
→ Cercle de feu (rayon 2, touche tous les attirés) → Terre mythe sur la cible la plus rentable. Override :
ordre forcé `Attraction → Cercle → Terre mythe` quand Attraction est disponible et touche ≥ 1 ennemi
(la simulation gloutonne le trouve normalement, l'override garantit l'ordre).

#### Méjaire — « lanceuse en ligne + contrôle Pacifiste » (profil `kiter` à courte portée)

| Sort | PA | Portée | Limites | Effets |
|---|---|---|---|---|
| Rayonirique (5022) | 4 | 1-3 **en ligne**, LdV | 2×/tour, 1×/cible | 31-40 Eau + **état Pacifiste (218, `cantDealDamage`) 1 tour**, `dispellable=2` = **non désenvoûtable** (DofusDB, confirmé `[S17]`) |
| Plumière (5023) | 4 | 3-7 en ligne, LdV | 2×/tour, 1×/cible | 31-40 Terre + « Dommages subis ×150 % » au **prochain coup** (trigger `D`) |
| Envolupté (5024) | 4 | 8-10, **sans LdV**, case occupée | relance 3 | **échange de place avec un allié** + repousse de 2 les ennemis à ≤ 2 de la case d'arrivée |

Observé : « *Les Méjaires, notamment celles de la vague 3 sont très ennuyantes à cause de l'état Pacifiste,
essayez de vous mettre loin des monstres et enlevez leurs des PM* » `[S17]` ; Envolupté « *peut également
être utilisé comme « flèche de dispersion »* » `[S18]` / « *lui permet de se coop également avec ses alliés* »
`[S19]`.
**Règles IA** : valeur de Pacifiste = menace de la cible au prochain tour (≈ dégâts qu'elle aurait infligés) ;
la Méjaire cible donc le **meilleur DPS en ligne à ≤ 3**. Envolupté = « gap-closer » : utilisé quand aucun
ennemi n'est atteignable en ligne ≤ 7 ce tour et qu'un allié à 8-10 cases est proche d'ennemis (valeur =
gain de position + repousse). Plumière : préférer une cible qu'un allié frappera avant son tour (bonus
« prochain coup »). Position finale : en ligne avec le max d'ennemis à 3-7 (préparer le tour suivant).

#### Harpille — « tireuse diagonale/ligne + poison global » (profil `kiter`)

| Sort | PA | Portée | Limites | Effets |
|---|---|---|---|---|
| Tirs optiques (5018) | 4 | 1-5 **en diagonale**, LdV | 2×/tour, 1×/cible, CC 20 % | 31-40 Neutre + « Dommages subis ×200 % » au **prochain coup** puis se dissipe |
| Superfidie (5019) | 4 | 1-7 en ligne, LdV | **1×/tour**, CC 20 % | 31-40 Feu, **−4 PM** (1 t) ; le retrait est dissipé si la cible est déplacée (trigger `M`) |
| Petit poison (5021) | 4 | 0 (toute la carte) | relance 3, **globalCooldown 3** | poison 50 Eau en début de tour pendant 3 tours sur **tous les personnages** (`L`, hors invocations) ; un soin le retire (5020 trigger `H`) |

Observé : « *Petit poison […] ne peut pas être lancé avant le tour 4, relance de 3 tours* » `[S17]`
(⚠️ DofusDB ne montre pas d'`initialCooldown` mais un `globalCooldown 3` : INCERTAIN, le guide peut refléter
un délai serveur) ; « *La Harpille va tacler* » ; « *c'est le monstre qui frappe le moins* » `[S17]`.
**Règles IA** : Petit poison dès qu'il est lançable (valeur = 3 × poison × nb de personnages non soignables
ce tour, très élevée) ; Superfidie en priorité sur la cible dont les PM comptent le plus (CàC/placeurs) ;
Tirs optiques sur la cible qui sera frappée ensuite (bonus « prochain coup » ×2) ; finir en diagonale/ligne
d'au moins une cible.

#### Buboxor — « bagarreur de contact, voleur de PM » (profil `aggressive`)

| Sort | PA | Portée | Limites | Effets |
|---|---|---|---|---|
| Bouclier absorbant (5026) | 4 | 0 (soi) | relance 3, `maxStack 3` | buff : chaque **dommage reçu à distance** (`DR`, distance > 1) → +100 Puissance et +1 PM pendant 2 tours (cumul ≤ 3) |
| Feinterception (5027) | 4 | 1 (CàC) | 2×/tour, 1×/cible, CC 20 % | 51-70 vol de vie Air + buff 1 tour sur la cible : **celui qui la frappe est soigné de 50 % des dégâts** (786, trigger `D`) |
| Hoxor (5028) | 4 | 1-3 en ligne, **sans LdV** | 2×/tour, 1×/cible, CC 20 % | **vole 2 PM** (1 t) + 41-60 Eau |

Observé : « *Buborox : à longue distance ne fait rien* » `[S18]` ; « *dangereux s'il est proche de vous* » `[S16]`.
Désaccord sur la durée du bouclier : DPLN « 1 tour », Tofus « 2 tours », DofusDB `duration 2` → on retient 2.
**Règles IA** : si aucun ennemi n'est atteignable au CàC/ligne ≤ 3 ce tour → lancer Bouclier absorbant
(valeur = nb attendu de coups à distance reçus × (100 Puissance + 1 PM)) puis avancer (6 PM) ; Hoxor sert
à **voler des PM pour rejoindre** (le score doit valoriser les PM volés pour lui-même : déplacement
supplémentaire possible ce tour) ; Feinterception au contact (le soin des alliés qui frappent ensuite =
bonus « prochain coup »).

#### Brabuzar — « pousseur / téléporteur » (profil `aggressive`, combos de poussée)

| Sort | PA | Portée | Limites | Effets |
|---|---|---|---|---|
| Mise en situation (5030) | 4 | 1-3 en ligne, LdV | 2×/tour, 1×/cible | la cible lance 5029 (792 = `TargetExecuteSpell`) : **attire de 3 ses alliés** (`a` relatif à la cible) situés en étoile (lignes + diagonales, rayon 3) autour d'elle ; Brabuzar +200 dommages de poussée (2 t) ; **repousse la cible de 4**. ⚠️ JOL écrit « *les alliés du monstre* » `[S16]`, Tofus « *attirer les personnages* » `[S18]` : notre lecture des données suit Tofus |
| Décollage (5032) | 4 | 0 (tous les ennemis) | relance 3, **globalCooldown 1** | −300 rés. poussée sur tous les ennemis (1 t) ; pendant 1 tour, chaque dommage de poussée subi par un ennemi **soigne le Brabuzar de 15 % PV max** (5031, trigger `PD`) |
| Neutralisation (5033) | 4 | 1-3 en ligne, LdV | 2×/tour, 1×/cible, CC 20 % | **téléportation symétrique** de la cible par rapport au Brabuzar + 56-75 Neutre ; −3 PM si la cible subit des dommages de poussée ce tour (trigger `PD`) |

Observé : Décollage « *ne peut pas être lancé tour 1, relance de 3 tours* » `[S17]` (⚠️ DofusDB :
pas d'`initialCooldown` — INCERTAIN) ; « *Neutralisation […] risque de vous mettre en danger s'il vous
isole* » `[S16]` ; « *A faire attention si porté par un pandawa* » `[S19]` ; « *stabiliser le Pandawa au
début de chaque nouvelle vague pour éviter que le Brabuzar vous pousse* » `[S17]` ; « *ne pas sous-estimer
les résistances Neutre* » `[S17]`.
**Règles IA** : la simulation de poussée/collision est critique (R6). Combo naturel : Décollage (−300 rés.
poussée, soin sur poussée) → Mise en situation (regroupe puis pousse la cible de 4 → collisions) →
Neutralisation (symétrie : renvoyer la cible **loin de ses alliés / vers les monstres**). Valeur de
Neutralisation = dégâts + **isolement** (Δ distance de la cible à ses alliés soigneurs/protecteurs) + −3 PM
si poussée subie.

#### Vortex — boss en 2 phases (override dédié)

Sort de départ **5006 « Vortexiphan »** (lu dans les données) :
* au lancement : invoque l'**Auroraire** (3833) ; Vortex reçoit **Invulnérable (56)**, **Indéplaçable
  (97)**, **−100 PM permanent**, état **236 « Marginal »** (1 tour) ;
* à chacun de ses débuts de tour (`TB`) : 5003 (ressuscite le dernier allié mort — 780 « *avec 20 à 30 %
  de ses PV* » — et lui applique le passif de vague 5002 ; ⚠️ Tofus : « *ressuscité […] à la moitié de sa
  vitalité* » `[S18]`, on retient DofusDB, INCERTAIN ; le nombre de rez par tour est INCERTAIN, les guides
  décrivent la rez de tous les monstres tués ; 5003 pose aussi `−1 PM` permanent sur `a,A,U` — masque
  `U` non résolu, INCERTAIN) ; 5008 (re-pose « Marginal » 1 tour **tant qu'un allié `h,m,d` n'a pas
  l'état 6611 « monstre tué à la même heure »**, c.-à-d. tant qu'il reste un monstre non corrompu ; `m`
  exclut les invocations qui jouent comme l'Auroraire, cf. `[S13]`. ⚠️ Le scénario de vagues doit faire
  apparaître la vague suivante **avant** le début de tour du Vortex quand toute la vague présente est
  corrompue, sinon la phase 2 se déclencherait trop tôt — à valider avec le dossier Vortex) ;
  5060 « Action ! » (si **pas** Marginal : retour de tous aux positions de départ, mort des monstres
  corrompus, transfert des buffs d'heure au Vortex via 5009, Invulnérable + tour annulé 1 tour, puis fin
  des effets de 5006 → il récupère ses PM).

Donc : **phase 1 ⇔ le Vortex a l'état 236**, **phase 2 ⇔ il ne l'a plus**. Les guides décrivent la
transition : « *un tour complet doit se passer avec tous les mobs corrompus […] Vortex reste invulnérable et
ne joue pas son tour mais tous les monstres corrompus disparaissent et tout le monde retourne à sa position
de départ. Au prochain tour, Vortex perdra son état Invulnérable et jouera son tour* » `[S17]` (guidedofus
ajoute un tour « vulnérable mais passe encore son tour » `[S20]` — désaccord, INCERTAIN).

| Sort | PA | Portée | Limites | Condition | Effets |
|---|---|---|---|---|---|
| En temps et en heure (5062) | 1 | 1-63 | 1×/tour, **initialCooldown 1** | — | l'**Auroraire** lance 5061 : en **croix** (lignes, rayon 63) autour d'elle sur les ennemis : 500 Terre + 50 % des PV érodés + **20 % d'érosion 2 t** ; +10 PA sur `a,A,T` (INCERTAIN) |
| Heurage (5066) | 4 | 0 | relance 3, **initialCooldown 3** | les deux (masques `*E236` / `*e236` sur les sous-effets) | phase 1 : l'Auroraire (5065) donne à **tous les monstres de vague** (`g`, sauf le Vortex `f3835`) le buff de l'heure courante, permanent ; phase 2 : Vortex (5067) se **téléporte au contact de l'Auroraire** |
| Contamination zombie (5064) | 4 | 1-63, LdV | 2×/tour, 1×/cible | **HS=236** (phase 1) | sur un monstre en état Zombi (74) : **Insoignable (76) 1 t** aux ennemis à ≤ 2 de lui |
| Heuristique (5068) | 4 | 1-8 **en ligne, sans LdV** | **3×/tour**, 1×/cible, CC 20 % | **HS!236** (phase 2) | réduit les durées d'effets de 2 (désenvoûtement), **Pacifiste 1 t** (`dispellable=1` : désenvoûtable, confirmé `[S17]`), 41-50 Air + 41-50 Feu |
| Morfaille (5070) | 4 | 1-4, LdV | 3×/tour, 1×/cible, CC 20 % | **HS!236** | **ramène la cible à sa position précédente** ; 5069 immédiatement **et au tour suivant** (delay 1) : 41-50 Neutre + 41-50 Eau en cercle 2 autour de la cible, + Terre = 20 % des PV érodés du lanceur |

Observé (phase 2) : « *Si son sort « Heurage » est disponible, il l'utilisera au début de son tour pour se
téléporter sur l'Auroraire (il ne peut le faire qu'une fois tous les 3 tours)* » ; « *S'il ne l'utilise pas
le tour où les monstres sont corrompus, il l'utilisera forcément le tour où il devient vulnérable* » ;
« *ne jamais être à portée de son sort en ligne (8PO sans ligne de vue)* » ; « *peut mettre jusqu'à 2
personnages pacifistes par tour* » ; « *son seul sort dangereux est […] en ligne jusqu'à 8PO sans ligne
de vue et qui met Pacifiste* » `[S17]`. Gamosaurus : « *Tous les 3 tours il se téléportera au corps à
corps de l'auroraire au début de son tour* » `[S19]`. Tofus : « *Il peut se tp au contact de l'auroraire
chaque tour (mais ne le fait pas forcément)* » `[S18]` (contredit par `minCastInterval 3`). En phase 1,
Tofus : « *Quand Vortex résu un monstre, il donne des boosts à tous les monstres parmi : 4 PAs, 2 PMs,
400 stats, 150 résistances critiques* » — cohérent avec Heurage phase 1 lu dans les données ;
« *Quand Vortex commence avec l'Auroraire à son corps à corps, il lance un buff qui rend insoignable tous
les personnages situés à 2 PO des monstres en état Zombie* » `[S18]`.
⚠️ Le JOL (2016) décrit Heuristique « *De 1 à 2PO* » `[S16]` : obsolète (DofusDB : 1-8).

Budget PA du Vortex en phase 2 : 16 PA = Heurage (4, si dispo) + En temps et en heure (1) + 2 sorts à 4 PA
(11 PA) ; sans Heurage : 1 + 3 × 4 = 13 PA (3 Heuristique sur 3 cibles distinctes, ou mix Morfaille).

#### Auroraire (3833)

`static` : 0 PA / 0 PM, `canTackle=false`, invulnérable et indéplaçable (sort 4999). Aucune décision :
elle avance d'une heure au début du tour de chaque **personnage** (buff `TB` posé sur les ennemis `L`) et
quand un personnage marche dans la glyphe d'un monstre `[S17]`. L'IA des autres monstres doit simplement la
considérer comme un obstacle (bloque la LdV) et, pour le Vortex, comme le centre de « En temps et en heure »
et la destination d'Heurage.

#### Passif commun des monstres de vague (5002 « Glyphe téléporteur »)

À chaque début de tour d'un monstre de vague vivant : glyphe sur sa case (1165) et **repousse de 2 les
alliés invulnérables** en croix rayon 2 (sauf le Vortex) — d'où l'observation Gamosaurus « *Les monstres
jouant leurs tours repoussent les monstres invulnérables de 2 cases* » `[S19]`. À la mort : état « Mort
latente » + l'Auroraire lui pose l'état de l'heure courante (221-232). À la résurrection : buff de chaque
heure possédée ; s'il a l'état 234 « Même heure » (étoile) → **corrompu** : Invulnérable + Tour annulé
permanents + état 6611. ⇒ **Un monstre corrompu ne joue plus** (le moteur saute son tour) mais **tacle
toujours** `[S19]` et bloque la LdV.

### 7.3 Profils IA retenus pour l'Œil de Vortex

```ts
// src/ai/profiles/vortex.ts (proposition)
export const VORTEX_PROFILES: Record<number, MonsterAIProfile> = {
  3833: { behaviour: 'static' },                                     // Auroraire
  3834: { behaviour: 'aggressive',                                   // Ikargn
          openers: [{ spellId: 5015, minTargets: 1 }],              // Attraction en premier si utile
          castOrder: [5015, 5016, 5017] },
  3836: { behaviour: 'kiter', preferredRange: [1, 7],                // Méjaire
          stateValue: { 218: 'targetThreat' },                      // Pacifiste = menace évitée
          gapCloser: { spellId: 5024 } },
  3837: { behaviour: 'kiter', preferredRange: [1, 7],                // Harpille
          alwaysCastWhenReady: [5021] },                            // Petit poison
  3838: { behaviour: 'aggressive',                                   // Buboxor
          selfBuffWhenNoTarget: 5026, mpStealIsMobility: true },
  3839: { behaviour: 'aggressive', pushCombo: true },                // Brabuzar
  3835: { behaviour: 'kiter', preferredRange: [1, 8], hooks: vortexHooks }, // Vortex
}
```

---

## 8. Conception de l'IA pour le moteur TypeScript

### 8.1 Architecture

```
src/ai/
  index.ts               // registre: aiKey -> Controller ; fallback 'monster:generic'
  monster/
    brain.ts             // MonsterBrain implements Controller (boucle §8.2)
    candidates.ts        // génération (sort, case de lancer, case cible) + préfiltre analytique
    evaluate.ts          // simulation sur clone + fonction de score §8.4
    position.ts          // score de position par comportement §8.6
    threat.ts            // menace des ennemis (DPS attendu), danger map
    archetype.ts         // inférence du comportement §3 depuis les sorts
    profiles/            // profils déclaratifs par monsterId (Vortex, ...)
    overrides/           // hooks de boss (vortex.ts, ...)
```

Le contrôleur est choisi via `fighter.ai` (ex. `'monster:generic'`, `'monster:3835'`) ; le profil est
résolu par `monsterId` puis complété par l'inférence d'archétype ; `fighter.tags.aiBehaviour` (posé par
l'effet 2188 ou par la règle R12) **surcharge** le comportement courant.

```ts
export type Behaviour = 'aggressive' | 'fearful' | 'kiter' | 'devoted' | 'blocker'
  | 'mad' | 'apathetic' | 'static'

export interface MonsterAIProfile {
  behaviour: Behaviour
  capabilities?: Partial<Record<'summon' | 'heal' | 'buff' | 'kamikaze' | 'invisible', boolean>>
  weights?: Partial<ScoreWeights>
  preferredRange?: [number, number]           // kiter : anneau idéal
  castOrder?: number[]                         // départage (ordre souhaité)
  openers?: { spellId: number; minTargets?: number }[]
  alwaysCastWhenReady?: number[]               // sorts « gratuits » (poison global, buffs d'équipe)
  forbidSpells?: number[]
  stateValue?: Record<number, 'targetThreat' | number> // valeur des états posés (id -> règle)
  hooks?: MonsterHooks
}

export interface MonsterHooks {
  /** Actions imposées en début de tour (après les effets TB). Retourne [] pour ne rien imposer. */
  beforeTurn?(ctx: AIContext): Action[]
  /** Exclure des candidats (ex. ne pas lancer X si Y). */
  filterCast?(ctx: AIContext, c: CastCandidate): boolean
  /** Ajuster le score simulé d'un candidat. */
  scoreCast?(ctx: AIContext, c: CastCandidate, base: number): number
  /** Score additionnel d'une case de fin de tour. */
  endPosition?(ctx: AIContext, cell: number): number
}
```

### 8.2 Boucle de tour (fidèle : gloutonne + replanification)

```ts
playTurn(engine, fight, me) {
  // Les effets TB (poisons, glyphes, rez du Vortex...) sont déjà appliqués par engine.startTurn (R19).
  const ctx = buildContext(engine, fight, me)           // profil, comportement, menaces, cache
  if (ctx.behaviour === 'static' || ctx.behaviour === 'apathetic' && !ctx.canHeal) return finalMove(ctx)
  for (const a of ctx.profile.hooks?.beforeTurn?.(ctx) ?? []) perform(ctx, a)

  let offensive = false
  for (let guard = 0; guard < 12 && me.alive && !fight.ended; guard++) {
    const best = pickBestAction(ctx)                     // §8.3, score en PV-équivalents
    if (!best || best.score <= ctx.weights.minActionScore) break
    if (best.path) perform(ctx, { type: 'move', path: best.path })
    if (!me.alive || fight.ended) break
    if (best.cast) {
      const r = perform(ctx, { type: 'cast', spellId: best.cast.spellId, cell: best.cast.cell })
      offensive ||= best.offensive && r.ok
    }
    ctx.refresh()                                        // R10/R11/R18 : tout a pu changer
  }
  updateFearfulMode(ctx, offensive)                      // R12/R13
  finalMove(ctx)                                         // §8.6 avec les PM restants
}
```

`pickBestAction` :

```ts
function pickBestAction(ctx): Planned | null {
  const reach = reachWithTackleCost(ctx)                 // BFS sur PM, coût espéré PA/PM de tacle (R4/R5)
  const cands = generateCandidates(ctx, reach)           // §8.3
  const pre = cands.map(c => ({ c, h: quickEstimate(ctx, c) }))   // dégâts analytiques, pas de clone
                   .sort((a, b) => b.h - a.h).slice(0, ctx.topK)  // topK = 24 par défaut
  let best = null
  for (const { c } of pre) {
    const sim = ctx.engine.cloneFight(ctx.fight)           // record=false
    sim.options.rollMode = 'average'
    applyPlan(sim, c)                                      // move + cast (+ déclencheurs, morts, poussées)
    const s = scoreDelta(ctx, ctx.fight, sim, c)           // §8.4
           + positionDelta(ctx, c) * ctx.weights.positionDuringTurn
    const adj = ctx.profile.hooks?.scoreCast?.(ctx, c, s) ?? s
    if (!best || adj > best.score || adj === best.score && tieBreak(ctx, c, best)) best = { ...c, score: adj }
  }
  return best
}
```

`tieBreak` : (1) `castOrder` du profil, (2) priorités Stump (invocation > buff > dégâts > soin > malus),
(3) moins de PM dépensés, (4) RNG du combat (graine). Option `noise` : tirage softmax(τ) sur le top-3.

Mode **« smart »** (boss, IA de difficulté élevée, ou pour l'IA de groupe) : beam search de largeur 4 sur
des séquences de 2-4 actions avec le même `scoreDelta` cumulé, puis comparaison des fins de tour par
`positionScore` + `danger`. Non utilisé par défaut pour rester fidèle (R25).

### 8.3 Génération des candidats

Pour chaque sort connu `s` (au grade du monstre) avec `canCast` statique OK (PA, relance, `statesCriterion`,
`maxCastPerTurn`), pour chaque **case de lancer** `p ∈ reach` (y compris la case actuelle ; pour un monstre
à 0 PM uniquement la case actuelle — R24), pour chaque **case cible** `t` :

* `t` ∈ cases occupées par un combattant visible **et** cases de zone dont la zone d'effet touche ≥ 1
  combattant (pour les sorts de zone, énumérer les centres qui touchent au moins une cible — R2) ;
* sorts « sur soi » (`range = 0`) : `t = p` ; sorts à `needFreeCell` (invocation, téléportation) : cases
  libres à portée, limitées aux 8 meilleures par heuristique (distance à l'ennemi / à l'allié) ;
* rejet via `canCast(engine, fight, me, s, t, { fromCell: p })` (portée, ligne/diagonale, LdV,
  `needTakenCell`, `maxCastPerTarget`).

Préfiltre `quickEstimate` (sans clone) : somme des dégâts moyens des effets `damage`/`life_steal` sur les
cibles de la zone avec la formule DoMath simplifiée (stats, % do, rés. %, rés. fixes, efficacité de zone),
+ valeurs forfaitaires des retraits/états (§8.4), − pénalité de tir ami. Sert uniquement à trier.

### 8.4 Fonction de score (en PV-équivalents)

Évaluée sur la **différence** entre l'état avant et après simulation du plan :

```
score = Σ_{e ∈ ennemis}  wDmg · v(e) · min(ΔPV_e + Δbouclier_e, PV_e + bouclier_e)       // dégâts effectifs, overkill nul
      + Σ_{e tués}       wKill · (κ · PVmax_e + threat_e)                                  // bonus de kill (R/§1.3)
      + Σ_{e}            wAP · min(ΔPA_e, PA_e^tour+1) · apWorth_e                        // retraits PA (après esquive attendue)
      + Σ_{e}            wMP · min(ΔPM_e, PM_e^tour+1) · mpWorth_e                        // retraits PM
      + Σ_{états posés}  stateValue(état, cible, durée)                                    // Pacifiste, Insoignable, ...
      + Σ_{buffs/debuffs} buffValue(buff, porteur)                                         // Δ dégâts futurs
      + Σ_{a ∈ alliés}   wHeal · min(soin_a, PVmanquants_a) · (1 + urgence_a)
      − Σ_{a ∈ alliés}   wFF · ΔPV_a  − wAllyKill · [a tué]                               // tir ami (Stump ≈ 0,6)
      − ∞ · [lanceur tué par renvoi/déclencheur]                                          // R7
      − reflectAversion · renvoi_attendu                                                   // R8
      + nextHitBonus                                                                       // débuffs « prochain coup »
```

Remarques : les dommages de poussée et de collision (R6) sont déjà inclus dans `ΔPV` puisque le plan est
**simulé** ; les PA non utilisés n'interviennent qu'au départage (on ne force pas à « vider » les PA :
après un kill, un score < `minActionScore` termine le tour, conformément au §1.3).

Définitions :

* `v(e)` = 1 pour un personnage, `summonValue` (0,5 par défaut — INCERTAIN, cf. §4.1) pour une invocation,
  0 pour une invocation statique sans menace sauf si elle bloque un chemin vers une cible prioritaire.
* `threat_e` = dégâts attendus que `e` infligera à l'équipe du monstre à son prochain tour (pré-calculé au
  début de chaque tour avec le calculateur de dégâts sur ses sorts, plafonné par PA ; 0 si Pacifiste /
  « passe tour » / mort). Pour les joueurs : utiliser le meilleur « tour de dégâts » estimé par l'IA de
  groupe si disponible, sinon `Σ_sorts_par_PA × PA`.
* `apWorth_e = threat_e / PA_e` (valeur moyenne d'un PA) ; `mpWorth_e = α_mp · threat_e / max(1, PM_e)` avec
  `α_mp = 0,6` si `e` doit se déplacer pour frapper (aucun sort à portée de la position actuelle), sinon
  `0,15`. Esquive attendue : `P(retrait réussi)` selon la formule retrait/esquive du dossier règles.
* `stateValue` :
  - `cantDealDamage` (Pacifiste 218, Apathique) : `0,9 · threat_e` si l'état couvre le prochain tour de `e` ;
  - `invulnerable` sur allié : `min(dégâts entrants attendus, PV)` ; sur ennemi : `−` équivalent ;
  - `incurable` (76) sur ennemi : `0,5 · soins attendus de l'équipe ennemie sur lui` (≈ 10 % PVmax si un
    soigneur est présent, sinon ~0) ;
  - Pesanteur (7), Enraciné (6) : `0,3 · mpWorth_e · PM_e` (bloque les fuites par échange/TP) ;
  - `cantBePushed` sur soi : 0 sauf contre un groupe à placeurs (Pandawa, Sacrieur, Féca…) : 50 ;
  - états de phase/scénario (heures du Vortex…) : 0 (gérés par le moteur), sauf override.
* `buffValue` : simuler le **meilleur sort offensif** du porteur avec et sans le buff, `Δ × tours_restants ×
  0,7^k` (décote par tour), plafonné au nombre de lancers possibles ; buffs déclencheurs (Bouclier
  absorbant) : `Δ × E[nb de déclenchements]` (ex. nb d'ennemis ayant des sorts à distance qui l'atteignent).
  Respecter `maxStack` : un buff au plafond vaut 0 (R21).
* `nextHitBonus` : pour un débuff « prochain coup » (1163 ×150/×200 avec auto-dissipation, 786 soin sur
  l'attaquant) : `(mult − 1) · E[prochain coup allié sur cette cible avant son tour]` où l'espérance est
  la meilleure attaque d'un **allié du monstre qui joue avant la cible** (ordre de la timeline) × 0,5.
* `urgence_a = 1 − PV%_a` ; seuil : ignorer un soin si `PV%_a > 95 %` (1.29) ; soin de soi pour `healer`
  dès 70 %.
* Poids par défaut (`ScoreWeights`) — **à calibrer** sur des combats de référence :

| Poids | Défaut | Commentaire |
|---|---|---|
| `wDmg` | 1,0 | unité |
| `wKill` | 1,0 avec `κ = 0,5` | Stump : impact de kill ≈ `max(PVmax/2, PV)` |
| `wAP` / `wMP` | 0,8 / 0,8 | via `apWorth`/`mpWorth` (1.29 : 1 PA ≈ 40, 1 PM ≈ 30 jets moyens) |
| `wHeal` | 0,9 | |
| `wFF` / `wAllyKill` | 0,6 / 1,0·PVmax | Stump −0,3 ×2 |
| `summonValue` | 0,5 | INCERTAIN |
| `reflectAversion` | 0,2 · renvoi attendu | R8 |
| `minActionScore` | 1 | sous ce seuil, ne pas agir (permet de « passer » après un kill, §1.3) |
| `positionDuringTurn` | 0,25 | poids du terme de position sur les déplacements intermédiaires |

### 8.5 Choix de la case de lancer

À score de sort égal : (1) case qui laisse le **meilleur score de position** final (§8.6), (2) la plus
proche (Stump), (3) celle qui coûte le moins en tacle. Pour `kiter`, préférer la case la plus éloignée
de l'ennemi le plus menaçant parmi celles qui permettent le lancer (R2).

### 8.6 Déplacement de fin de tour (score de position)

Évalué sur les cases atteignables avec les PM restants (coût de tacle inclus, R4) :

```
pos(c) = glyph(c)                                        // R3 : valeur des glyphes pour ce monstre
       + behaviourTerm(c)
       − λ · danger(c)        // (fearful, kiter, smart) somme des threat_e des ennemis qui peuvent l'atteindre
```

| Comportement | `behaviourTerm(c)` |
|---|---|
| `aggressive` | `−20 · dist(c, cible focale)` + `40 · nbEnnemisAdjacents(c)` (R1) ; cible focale = argmax de la valeur d'attaque au prochain tour (à défaut l'ennemi le plus proche) |
| `kiter` | `−20 · |dist(c, cible) − portéeIdéale|` + `30 · [aligné/diagonale selon les sorts]` + `15 · [LdV]` − `25 · [au CàC d'un ennemi]` |
| `fearful` | après action offensive : `+15 · distMin(c, ennemis)` ; sinon comme `aggressive` (R12) |
| `devoted` | `−20 · dist(c, invocateur)` + `10 · distMin(c, ennemis)` |
| `blocker` | `60 · nbEnnemisAdjacents(c)` − `5 · dist(c, ennemi le plus proche)` |
| `mad` | comme `aggressive` en considérant tout le monde comme ennemi |
| `apathetic` | `+10 · distMin(c, ennemis)` |
| `static` | pas de déplacement |

`danger(c)` (danger map, mode smart / peureux) : pour chaque ennemi `e`, `threat_e` si `dist(c, e) ≤
PM_e + portéeMax_e` (et LdV approximative), × 0,5 si le monstre n'est pas la cible la plus rentable de `e`.

Ne pas bouger si le meilleur gain de position est < 5 PV-équivalents (évite les déplacements « nerveux » et
les tacles inutiles).

### 8.7 Overrides : exemple complet du Vortex

```ts
// src/ai/monster/overrides/vortex.ts
const MARGINAL = 236, ZOMBI = 74, AURORAIRE = 3833
const S = { EN_TEMPS: 5062, HEURAGE: 5066, CONTAM: 5064, HEURISTIQUE: 5068, MORFAILLE: 5070 }

export const vortexHooks: MonsterHooks = {
  beforeTurn(ctx) {
    const me = ctx.me, phase1 = ctx.hasState(me, MARGINAL)
    const aur = ctx.fighters.find(f => f.monsterId === AURORAIRE && f.alive)
    const acts: Action[] = []
    // Heurage dès qu'il est disponible (guides : « il l'utilisera au début de son tour ») :
    //  - phase 1 : buff d'heure permanent pour tous les monstres de vague (gain pur) ;
    //  - phase 2 : téléportation au contact de l'Auroraire.
    if (aur && ctx.canCastOn(S.HEURAGE, me.cell)) acts.push({ type: 'cast', spellId: S.HEURAGE, cell: me.cell })
    // En temps et en heure : ciblé sur l'Auroraire ; lancé si au moins un ennemi est aligné avec elle
    // (guides : lancé « automatiquement à chaque tour » ; INCERTAIN s'il est lancé sans cible).
    if (aur && ctx.enemiesAlignedWith(aur.cell).length > 0) acts.push({ type: 'cast', spellId: S.EN_TEMPS, cell: aur.cell })
    return acts
  },
  filterCast(ctx, c) {
    // Contamination zombie : uniquement sur un monstre Zombi ayant ≥ 1 personnage à ≤ 2 cases.
    if (c.spellId === S.CONTAM) {
      const z = ctx.fighterAt(c.cell)
      return !!z && ctx.hasState(z, ZOMBI) && ctx.enemiesWithin(c.cell, 2).length > 0
    }
    return true
  },
  scoreCast(ctx, c, base) {
    // Heuristique : valoriser Pacifiste sur les gros DPS + le désenvoûtement (-2 tours) des boucliers/buffs.
    if (c.spellId === S.HEURISTIQUE) {
      const t = ctx.fighterAt(c.cell)
      if (t) base += 0.9 * ctx.threat(t) + 0.5 * ctx.activeBuffValue(t)
    }
    // Morfaille : la répétition au tour suivant est déjà simulée (delay 1) si le moteur la joue ; sinon +100 %.
    return base
  },
  endPosition(ctx, cell) {
    // Phase 2 : maximiser le nombre de personnages alignés à ≤ 8 (Heuristique sans LdV) au prochain tour.
    if (ctx.hasState(ctx.me, MARGINAL)) return 0
    return 25 * ctx.enemies.filter(e => inLine(cell, e.cell) && distance(cell, e.cell) <= 8 + ctx.enemyMp(e)).length
  },
}
```

Pour les monstres de vague, les profils déclaratifs de §7.3 suffisent ; overrides éventuels :
* **Ikargn** `scoreCast` : si Attraction ailée est lançable et qu'au moins 2 ennemis sont à ≤ 3, bonus =
  valeur simulée du Cercle de feu qui suivra (la gloutonnerie ne voit pas que l'attraction **prépare** la
  zone : c'est le seul vrai besoin de lookahead de cette salle — ou activer le mode beam sur ce monstre).
* **Buboxor** `scoreCast` : Hoxor → `+ mpWorth(soi)` = valeur des PM volés pour atteindre le CàC ce tour.
* **Brabuzar** : mode beam (profondeur 3) pour trouver « Décollage → Mise en situation → Neutralisation ».

### 8.8 Interaction avec les IA de groupe et l'optimiseur

* L'IA de groupe (joueurs) peut **interroger** `MonsterBrain.predict(fight, monsterId)` pour anticiper le
  tour des monstres (mêmes fonctions, rollMode `average`) → planification « adversariale » à 1 coup.
* L'optimiseur Monte-Carlo joue N combats avec `noise ∈ {0, 0,1, 0,3}` pour mesurer la robustesse d'un
  stuff/composition face à des IA légèrement imprévisibles.

### 8.9 Performance

Ordre de grandeur par décision : |reach| ≤ ~60 cases (5-6 PM) × 3-5 sorts × ≤ 10 cibles ⇒ 900-3 000
candidats ; préfiltre analytique O(1) chacun, simulation sur clone pour `topK = 24` seulement ⇒
~24 clones/décision × ~3 décisions/tour. Budget visé : < 5 ms par tour de monstre en Node (le replay ne
doit jamais attendre l'IA). Mémoïser `reach` et la LdV par (case, version de l'état).

### 8.10 Tests de comportement (golden tests à écrire en CP4)

| # | Situation | Attendu |
|---|---|---|
| T1 | Buboxor à 10 cases de tout ennemi, pas de ligne | lance Bouclier absorbant puis avance de 6 PM vers l'ennemi focal |
| T2 | Méjaire, un Iop (gros DPS) et un Enutrof alignés à ≤ 3 | Rayonirique (Pacifiste) sur le Iop d'abord |
| T3 | Ikargn avec 3 ennemis à ≤ 3 cases, Attraction prête | Attraction ailée → Cercle de feu → Terre mythe |
| T4 | Harpille, Petit poison prêt | Petit poison lancé (même sans cible à portée) |
| T5 | Brabuzar, 2 personnages collés en ligne à ≤ 3 | Mise en situation sur l'avant → collision |
| T6 | Vortex phase 2, Heurage prêt | Heurage en premier, puis Heuristique sur ≤ 3 cibles distinctes alignées ≤ 8 |
| T7 | Vortex phase 1 | aucun déplacement ; En temps et en heure si un personnage est aligné avec l'Auroraire ; Contamination zombie seulement près d'un zombie entouré de personnages |
| T8 | Monstre peureux qui n'a rien pu faire | au tour suivant, se rapproche (R12) |
| T9 | Cible avec renvoi qui tuerait le monstre | ne l'attaque pas (R7) |
| T10 | Monstre corrompu (état 6611) | ne joue pas, tacle toujours |

---

## 9. Ce qui reste à confirmer (INCERTAIN) et comment

| Sujet | Hypothèse retenue | Comment vérifier |
|---|---|---|
| Énumération serveur des comportements (2188) | 1 agressif, 2 paniqué/peureux, 3 perturbé/fou ?, 5 apathique | autres sorts 2188 lors d'une prochaine extraction ; vidéos |
| Comportement par défaut de chaque monstre | inféré (§3) | guides monstre par monstre, vidéos de combat |
| Choix de cible exact (pondération %PV vs dégâts) | dégâts effectifs plafonnés + kill bonus | comparer replays et vidéos (VOD de Vortex) |
| `summonValue` | 0,5 | observation (les monstres tapent-ils les invocations tuables ?) |
| Vortex : nombre de rez par tour et PV de rez | « dernier mort », 20-30 % (DofusDB) vs moitié (Tofus) | VOD ; logs de combat |
| Vortex : En temps et en heure lancé même sans cible | lancé seulement si ≥ 1 ennemi aligné | VOD |
| Vortex : tour « vulnérable mais passif » avant la phase 2 | DPLN (non) vs guidedofus (oui) | VOD |
| Délais initiaux Petit poison / Décollage | DofusDB (pas d'initialCooldown) vs DPLN (tour 4 / pas tour 1) | VOD ; `globalCooldown` peut s'appliquer dès le début |
| Masques `T`, `U`, `W`, `K` | non résolus | serveur ; voir `zone-and-mask-grammar.json` |

---

## 10. Résumé des faits clés pour les ingénieurs

* L'IA officielle = 1 IA générique gloutonne + profils (agressif, peureux/paniqué, fou, dévoué, apathique) ;
  profils changeables en combat par l'effet 2188.
* Règles R1-R25 (§1.2) = cahier des charges / tests.
* Les mécaniques de boss sont dans les données (sort de départ, triggers, masques `*`, `E/e`, `F/f`, `V/v`,
  `statesCriterion`) → le moteur doit les exécuter ; corriger `targetMask.ts` (`*` = lanceur).
* Score en PV-équivalents (§8.4) ; position par comportement (§8.6) ; overrides déclaratifs (§7.3, §8.7).
* Vortex : phase lue sur l'état 236 « Marginal » ; Heurage dès que disponible (relance 3, `initialCooldown
  3` → vraisemblablement tours 4, 7, 10… du Vortex — INCERTAIN selon le décompte du moteur) ; Heuristique 1-8 en ligne **sans LdV**, 3×/tour, 1×/cible, Pacifiste ; Morfaille 1-4 LdV avec
  répétition au tour suivant ; En temps et en heure = croix depuis l'Auroraire, 1×/tour à partir du tour 2.

---

## 11. Sources

Officielles (notes de version relayées par JeuxOnLine, qui cite le forum officiel) :
* `[S1]` Forum officiel, « L'IA des invocations » — https://www.dofus.com/fr/forum/1103-discussions-generales/498147-ia-invocations (403 depuis cet environnement ; citation issue de l'extrait du moteur de recherche — INCERTAIN au mot près)
* `[S2]` Dofus 2.2.0 Frigost II (21/09/2010), section « Intelligence artificielle » — https://dofus.jeuxonline.info/actualite/28439/dofus-220-frigost-ii (source : forum.dofus.com t395696)
* `[S3]` Modifications 2.3.1 (25/01/2011) — https://dofus.jeuxonline.info/actualite/29805/modifications-apportees-231-25-01-11
* `[S4]` Modifications 2.3.5 — https://dofus.jeuxonline.info/actualite/31610/modifications-apportees-version-235
* `[S5]` Modifications 2.4.0 — https://dofus.jeuxonline.info/actualite/32814/modifications-apportees-version-240 (bêta : https://dofus.jeuxonline.info/actualite/32497/beta-patch-240)
* `[S6]` Modifications du 27/07/10 — https://dofus.jeuxonline.info/actualite/27823/modifications-27-07-10
* `[S7]` Modifications 2.2.1 (05/10/10) — https://dofus.jeuxonline.info/actualite/28611/modifications-apportees-version-221-05-10-10
* `[S8]` Modifications 2.11 — https://dofus.jeuxonline.info/actualite/39796/modifications-apportees-mise-jour-211
* `[S10]` Devblog « Équilibrage des Dopeuls d'invocation » — https://dofus.jeuxonline.info/actualite/37017/devblog-equilibrage-dopeuls-invocation
* `[S11]` Modifications du 25 mai 2010 — https://dofus.jeuxonline.info/actualite/27013/modifications-25-mai-2010

Communauté :
* `[S9]` Wiki JOL « Modifications de l'IA constatées entre les versions 1.29 et 2.0 » (2010) — https://forums.jeuxonline.info/showthread.php?t=1068908 ; annonce : https://dofus.jeuxonline.info/actualite/26658/donnez-avis-ia-20

Données et code :
* `[S12]` DofusDB (fichiers du jeu) — https://api.dofusdb.fr/monsters/3834 … /3839, /monsters/3833, /spells/<id>, /spell-levels, /spell-states ; extraction locale `data/dofusdb/monsters.json`, `data/dofusdb/monster-spells.json`, `data/dofusdb/spell-states.json` (sorts 31042-31049, 31519 pour l'effet 2188 ; sorts Vortex 4996-5070) ; catalogues `data/research/effect-semantics.json`, `data/research/zone-and-mask-grammar.json`
* `[S13]` Client Dofus 2 décompilé, `DamageUtil.as` (`verifySpellEffectMask`, `verifyEffectTrigger`) — https://github.com/Romain-P/d2gen/blob/master/scripts/com/ankamagames/dofus/logic/game/fight/miscs/DamageUtil.as (copie `.cache/monster-ai/DamageUtil_d2gen.as`)
* `[S14]` Émulateur Stump (Dofus 2.x) — https://github.com/Mixi59/Stump/tree/master/Server/Stump.Server.WorldServer/AI/Fights (copies `.cache/monster-ai/stump_*.cs`)
* `[S15]` Émulateur 1.29 type StarLoco — https://github.com/jguyet/server-1.43.7/tree/master/src/fight/ia (copies `.cache/monster-ai/starloco/`)

Guides Œil de Vortex :
* `[S16]` JeuxOnLine, « Œil de Vortex » (Kiwigae', 2016, m.à.j. 2019) — https://dofus.jeuxonline.info/article/13603/il-vortex
* `[S17]` Dofus pour les Noobs, « Œil de Vortex » (Arkaw, m.à.j. 24/08/2024) — https://www.dofuspourlesnoobs.com/oeil-de-vortex.html
* `[S18]` Tofus, « Oeil de Vortex » — https://www.tofus.fr/donjons/vortex
* `[S19]` Gamosaurus, « Tutoriel Dofus Donjon Vortex Autowin » (2021) — https://www.gamosaurus.com/jeux/dofus/tutoriel-dofus-donjon-vortex-autowin
* `[S20]` GuideDofus, « Œil de Vortex » — https://guidedofus.com/v2/oeil-de-vortex
* Next Stage (2025, reprise des mêmes informations) — https://www.next-stage.fr/2025/04/guide-dofus-strategies-vaincre-loeil-vortex-ses-succes.html
* Millenium, simplification des donjons haut niveau (2.42) — https://www.millenium.org/guide/273667.html
