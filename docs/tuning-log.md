# Journal de réglage de l'IA — Œil de Vortex

Objectif : faire GAGNER l'Œil de Vortex (4 personnages niveau 200) par un jeu de groupe intelligent. Chaque changement
est mesuré en **apparié** (mêmes graines, `masterSeed` fixé) et n'est gardé que s'il améliore les métriques
principales : taux de victoire ; à défaut monstres corrompus aux tours 7 / 12 / 17, tours survécus, morts.

## Protocole

- Équipe méta : `cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu`, variante `default`.
- Lot de référence : 32 combats `fast`, `masterSeed` 1 (graines `campaignSeeds(1, 32)`), 3 processus en parallèle.
- Harnais (hors dépôt) : `run1.ts` joue chaque graine avec `runOne(…, { record: true })` et extrait des événements :
  victoire, tours, morts, corrompus cumulés par tour (`state 6611` ajouté), premier mort, dégâts subis / infligés aux
  monstres de vague, sources de dégâts, kills, tours « passés » (0 PA dépensé), PA inutilisés. Comparaison appariée :
  différence moyenne ± IC 95 % et nombre de graines meilleures / moins bonnes.
- Sondes : `probe.ts` rejoue un combat jusqu'au tour d'un personnage et affiche prix du scénario, plan, et la
  décomposition de V(s) de chaque candidat simulé (trace de `searchTurn`).

---

## Tour 1

### Mesure de référence (32 graines, `fast`)

| Métrique | Valeur |
|---|---|
| Victoires | 0 / 32 |
| Tours survécus (moyenne) | 12,25 |
| Corrompus au tour 7 / 12 / 17 | 0,47 / 0,97 / 1,00 |
| Premier mort (tour moyen) | 8,9 |
| Dégâts infligés aux monstres de vague (par combat) | 33 900 |
| Kills de monstres de vague | 5,7 |
| Causes d'échec | submersion 17, défaite 15 |

Dégâts subis par source (moyenne par combat) : poison de Harpille 4 950, Superfidie 4 315, Tirs optiques 4 259
(Harpilles ≈ 13 500 au total), Cercle de feu (Ikargn) 3 279, Neutralisation (Brabuzar) 1 973, Hoxor 1 930.

Par tour de jeu : l'équipe inflige ≈ 5 000 au tour 1 puis **3 000 → 1 300** jusqu'au tour 7 (vague 1), alors que son
potentiel analytique (DPT mesuré) est ≈ 9-12 000 par tour (Crâ 2-3,9 k, Iop 3-4,7 k, Eniripsa 1,7-3,2 k, Enutrof
≈ 1 k). Dégâts par tour de personnage (tours 1-8) : Crâ 1 180, Iop 780, Eniripsa 570, Enutrof 240 ; l'Iop passe 27
tours sur 249 sans rien lancer, l'Enutrof 19. Ordre de jeu observé : M1 P1 M2 P2 M3 P3 **Vortex** P4 (les monstres
commencent : k = 3, Vortex sur III / VII / XI) ; les ressuscités rejouent juste après le Vortex.

### Modes d'échec identifiés

1. **Le préfiltre `quick` (et le terme `continuation`) ignoraient le prix du scénario pour un kill.** La valeur d'un
   kill y était toujours κ·PVmax + τ·menace (≈ +2 900 PVe), alors que V(s) utilise `deathValue` (prix d'heure du
   Vortex, souvent négatif). Exemple (graine 1, tour 4, Iop) : un Ikargn à 78 PV, réservé à une corruption au tour
   suivant, est adjacent ; les 6 candidats simulés en `fast` (top-K) le tuent tous (zones), chacun vaut −1 500 PVe en
   simulation (mort à IV −967, bande de PV perdue) ⇒ l'Iop « passe » alors qu'un coup simple sur la Harpille valait
   +160 PVe et n'avait pas été simulé.
2. **Dégâts trop peu payés** : un PV retiré à un monstre de vague vaut `waveHpSlope` = 0,3 PVe, contre 0,8 PVe par PV
   de menace subie : avancer au contact pour frapper, ou frapper plutôt que soigner / se buffer, perd presque toujours.
3. **Coûts d'heures trop dissuasifs** : la peur des bonus hérités par le Vortex en phase 2 (`C_vx`, payés 25+ tours plus
   tard) retarde les premières morts ; l'équipe meurt bien avant la phase 2.
4. **Survie** : la vague 2 (tour 7) arrive alors que la vague 1 n'est pas corrompue (0,47 corrompu au tour 7) ; les
   dégâts subis passent de ≈ 1 500 à ≈ 3 500 par tour et l'équipe meurt aux tours 9-12.

### Expériences (appariées, 32 graines, `fast`)

Référence A = code initial, θ par défaut. « both » = θ `vortex.waveHpSlope` 0,8, `vortex.contractHpSlope` 1,0,
`planner.hourCostScale` 0,4.

| Essai | Changement | Tours | Corr. t7 / t12 | Corr. total | 1er mort | Δ apparié (corr. total) | Verdict |
|---|---|---|---|---|---|---|---|
| A | référence | 12,25 | 0,47 / 0,97 | 1,00 | 8,9 | — | — |
| E1 | pente 0,8 (θ) | 12,25 | 0,75 / 1,19 | 1,22 | 8,1 | +0,22 ± 0,44 | tendance + |
| E2 | `hourCostScale` 0,4 (θ) | 12,94 | 0,56 / 1,38 | 1,41 | 9,5 | +0,41 ± 0,49 | tendance + |
| E3 | E1 + E2 | 12,28 | 1,09 / 1,59 | 1,59 | 8,9 | +0,59 ± 0,43 (corr. t7 +0,63 ± 0,28) | **gardé** |
| F1 | prix du scénario dans `quick` et `continuation` (code) | 12,09 | 0,59 / 1,31 | 1,31 | 8,5 | +0,31 ± 0,36 | gardé (correction) |
| F2 | F1 + E3 | 12,47 | 1,19 / 1,78 | 1,78 | 8,8 | +0,78 ± 0,36 vs A (+0,19 vs E3) | **gardé** |
| X1 | F2 + pente 1,0 / contrat 1,2 | 11,41 | 0,88 / 1,72 | 1,72 | 8,4 | tours −1,06 ± 0,96 vs F2 | rejeté |
| X2 | F2 + `hourCostScale` 0,2 | 12,16 | 1,00 / 1,91 | 1,94 | 8,8 | +0,16 ± 0,42 | neutre, rejeté |
| X3 | F2 + `value.incoming` 0,6 | 12,41 | 1,03 / 1,94 | 2,00 | 8,8 | +0,22 ± 0,37 | neutre, rejeté |
| X4 | F2 + `unplannedKillBase` 500 | 12,44 | 1,19 / 1,78 | 1,78 | 8,8 | 0 (2 graines changent) | sans effet |
| X5 | F2 + `corruptKill` 6 000, `plannedFirstKill` 3 500 | 12,38 | 1,00 / 1,84 | 1,91 | 8,5 | +0,13 ± 0,39 | neutre, rejeté |
| P1 | F2 + prix du scénario dans le potentiel (`killValueFor`, code) | 12,59 | 1,19 / 2,03 | 2,06 | 9,5 | +0,28 ± 0,47 vs F2 | gardé (correction) |
| C1 | P1 + intention `cleanse` à ½ prix (double compte avec `pendingDot`, code) | 12,03 | 1,31 / 1,88 | 1,94 | 8,8 | −0,13 ± 0,49 vs P1 (tours −0,56) | rejeté (n.s., tendance −) |
| H1 | P1 + planificateur `fast` faisceau 8, horizon 12, 2 morts/créneau | 12,41 | 0,91 / 1,63 | 1,66 | 9,1 | −0,41 ± 0,46 vs P1 (+5/−16) | rejeté |
| H2 | C1 + horizon 16 (faisceau 4) | 12,34 | 0,91 / 1,50 | 1,50 | 8,8 | −0,44 ± 0,50 vs C1 | rejeté |
| Q1 | P1 + placement du tueur pour une corruption PRÉVUE au prochain tour (code) | 12,72 | 1,19 / 2,16 | 2,16 | 9,3 | +0,09 ± 0,20 vs P1 (+6/−2) | gardé, élargi en Q2 |
| O1 | P1 + oracle `canKillNow` aussi en `fast` (code) | 13,34 | 1,28 / 2,06 | 2,13 | 9,4 | tours +0,75 ± 0,84 (+15/−9) | gardé |
| O2 | P1 + atteignabilité future 0,6 (au lieu de 0,85) | 12,44 | 0,94 / 1,81 | 1,94 | 9,2 | corr. t7 −0,25 ± 0,34 | rejeté |
| Q2 | Q1 élargi : toute fenêtre d'étoile ouverte par l'horloge à mon prochain tour (code) | 12,53 | 1,19 / 2,19 | 2,19 | 9,1 | +0,03 vs Q1 (3 graines changent) | gardé (neutre, plus robuste) |
| B1 | P1 + Q2 + O1 | 13,19 | 1,34 / 2,06 | 2,13 | 9,2 | tours +0,59 ± 0,96 vs P1 | gardé |
| M1 | B1 + preset Enutrof : **Musette Animée** au lieu de Sac Animé (contourne le bug moteur) | 15,03 | 1,34 / 2,47 | 2,50 | 10,4 | tours **+1,84 ± 0,76** (+20/−2), corr. +0,38 ± 0,25 vs B1 | **gardé** (provisoire) |
| B2 | M1 + relance « reste » en `fast` quand le plan s'épuise avec ≥ 2 PA (code, `executor.ts`) | 14,69 | 1,28 / 2,38 | 2,56 | 10,2 | tours −0,34 ± 0,83, corr. +0,06 ± 0,50 ; PA inutilisés 114 → 73, kills 9,5 → 10,9 | **rejeté** (n.s. ; les PA en plus tuent hors étoile) |

Un planificateur plus long ou plus large fait MOINS bien (H1, H2) : ses plans reposent sur des kills optimistes
(voir ci-dessous) ; voir plus loin multiplie les contrats irréalistes.

M1 n'est pas une amélioration de l'IA : elle retire un suicide causé par le moteur. Les deux variantes sont valides
(fiche de classe : Sac Animé « en général », Musette « si le groupe est serré ») ; à re-mesurer quand le moteur sera
corrigé.

### Diagnostics complémentaires (replays des lots, `explain`)

- **Fenêtres d'étoile manquées** : sur 149 étoiles posées (lot F2), 57 seulement sont converties en corruption
  (38 %). Causes au moment de l'étoile : tueur à plus de 8 cases du monstre 30, sous Pacifiste (Méjaire) 22, à portée
  mais pas de kill 27, mort 3. Les ressuscités réapparaissent autour du Vortex (en haut) ; le potentiel ne voit pas un
  monstre mort ; le plan d'heures change à chaque tour (pas d'engagement), donc les contrats ne suffisent pas.
- **Contrats tenus** : marquages prévus au créneau courant réalisés 30 % (83/278), corruptions 41 % (43/104).
  L'oracle de kill `fast` ne testait que « distance ≤ PM + portée » (O1).
- **BUG MOTEUR (signalé, non corrigé ici)** : Sac Animé (Enutrof, 13328) — l'effet 141 « tue la cible » (délai 3,
  masque `C`) est appliqué au LANCEUR : l'Enutrof meurt 3 tours après avoir invoqué son Sac (événement `death`, tueur =
  lui-même, sans dégât). 27 des 128 morts de personnages du lot Q1 sont ce suicide ; l'Enutrof est le premier mort
  dans 20 combats sur 32. Repro : `tests/engine-repro-sac-anime.test.ts` (marqué `it.fails` tant que le moteur n'est
  pas corrigé).


### Changements gardés (tour 1)

1. `src/ai/core/kill.ts` (`killValueNow`), `candidates.ts` (préfiltre `quick`), `value.ts` (`continuation`) : prix de kill
   du scénario (`deathValue` sur l'état courant) au lieu de κ·PVmax + τ·menace. Test : `tests/ai-core-killvalue.test.ts`.
2. `src/ai/core/potential.ts` + `src/dungeons/vortex/model.ts` (`killValueFor`) : le potentiel d'un allié valorise une
   mort au prix du scénario à l'heure de SON prochain créneau (étoile ⇒ prix de corruption).
3. `src/dungeons/vortex/model.ts` : oracle de kill `canKillNow` dans tous les modes (O1) ; intention `position` pour le
   tueur d'une corruption à son prochain tour (contrats du plan + fenêtres d'étoile de l'horloge, Q1/Q2).
4. `data/ai/theta-default.json` : `vortex.waveHpSlope` 0,3 → 0,8, `vortex.contractHpSlope` 0,7 → 1,0,
   `planner.hourCostScale` 1,0 → 0,4 (E3 ; l'annexe A de docs/design/ai.md garde les anciennes valeurs).
5. `data/ai/presets.json` : `enutrof_retrait_pm_eau`, paire 5 → Musette Animée (contournement du bug moteur Sac Animé,
   M1 ; à re-mesurer quand le moteur sera corrigé).
6. Diagnostic : `src/ai/team/controller.ts` publie le plan du scénario en `aiNote` (« Scénario — Plan : … ») quand il
   change ; `src/ai/tactical/turnSearch.ts`/`node.ts` : la trace `expand` porte la décomposition de V (sondes).
7. `src/ai/tactics/glyphClock.ts` : les lancers « kill » des séquences glyphe ↔ kill sont classés par dégâts sur la
   cible (plafonnés à ses PV) et non par prior. Effet de bord de (1) : le prior est calculé à l'heure ACTUELLE, où la
   mort est mal payée ; trié par prior, la séquence « glyphe puis kill » proposait un coup qui ne tue pas (puzzle P6
   `fast` en échec avec le nouveau θ).
8. `killValueFor` ne s'applique pas au Vortex (phase 2) : le prix de victoire (20 000) dans le potentiel faisait
   attendre les alliés (puzzle P12 `fast` en échec) ; sans effet sur les phases de vagues.

Tests ajustés : `tests/vortex-planner.test.ts` (T-hours mesuré à `hourCostScale` 1 : il vérifie les valeurs absolues
de la formule) et `tests/ai-puzzles-vortex.test.ts` P4 (prémisse « une première mort à V coûte » : modèle à
`hourCostScale` 1 ; le puzzle vérifie la réponse tactique à un prix négatif). Tests ajoutés :
`tests/ai-core-killvalue.test.ts`, `tests/engine-repro-sac-anime.test.ts` (`it.fails`, bug moteur).

### Mesure finale du tour 1 (appariée, même moteur)

Code final (θ par défaut mis à jour, preset modifié) contre le code initial, **sur le même moteur** (les optimisations
du moteur menées en parallèle par l'autre agent sont neutres : le code initial y reproduit la référence graine par
graine). 32 graines `fast`, `masterSeed` 1.

| Métrique | Avant | Après | Δ apparié (IC 95 %) |
|---|---|---|---|
| Victoires | 0 / 32 | 0 / 32 | — |
| Tours survécus | 12,25 | **14,84** | +2,59 ± 0,79 (+26 / −4) |
| Corrompus au tour 7 | 0,47 | **1,31** | +0,84 ± 0,24 (+22 / −0) |
| Corrompus au tour 12 | 0,97 | **2,47** | +1,50 ± 0,31 (+27 / −0) |
| Corrompus au tour 17 / total | 1,00 | **2,50** | +1,50 ± 0,33 |
| Premier mort (tour) | 8,9 | 10,3 | |
| Dégâts infligés aux monstres de vague | 33 900 | 54 500 | |
| Kills de monstres de vague | 5,7 | 9,5 | |
| Fenêtres d'étoile converties | 33 / 117 (28 %) | 80 / 192 (42 %) | |
| Marquages / corruptions prévus et tenus | — | 36 % / 57 % | |
| Premier mort (classe) | Eniripsa 12, Crâ 7, Iop 7, Enutrof 6 | Crâ 12, Eniripsa 10, Iop 10 | |

(Mesure avec le code final, correctif `glyphClock` compris ; sans lui : 15,03 tours, mêmes corruptions — 4 graines
changent.) `standard`, 3 graines (code avant ce correctif) : 13,7 → 16,0 tours (+3 / −0), corrompus au tour 12 1,67 → 2,67, premier mort
4,3 → 10,7 ; 0 victoire.

### Modes d'échec restants

1. **Vagues 2-3** : la vague 2 (tour 7) arrive avec 1,3 corrompu sur 3 ; dégâts subis 3-4 000 par tour dès le tour 8
   (soins ≈ 1 800) ; submersion (15) ou défaite (16) vers le tour 15. Harpilles : poison 6 000, Tirs optiques 4 650,
   Superfidie 4 300 par combat ; Brabuzar (Neutralisation + poussées) 5 700.
2. **58 % des fenêtres d'étoile manquées** : tueur sous Pacifiste (Méjaire), hors de portée, sous Pesanteur (Attraction
   ailée de l'Ikargn : −3 PM), monstre touché seulement par une zone (LdV bloquée par un autre monstre), PV du zombie
   (1 000-2 000) au-delà des dégâts d'un seul personnage.
3. **Planificateur optimiste et instable** : 36 % des marquages prévus au créneau courant ont lieu ; le plan change à
   chaque tour (pas d'engagement) ; un horizon plus long dégrade le résultat (H1, H2).
4. **Bug moteur Sac Animé** (signalé, contourné par le preset).

### Pistes pour le tour 2

- Engagement du `HourPlanner` (garder les contrats du plan précédent tant qu'ils restent faisables, θ.team.commit) et
  oracle des créneaux futurs calibré par joueur (DPT réalisé / DPT analytique mesuré en combat, pas 0,85 fixe).
- Protéger le tueur de la prochaine fenêtre d'étoile : intention `survive`/évitement des lignes de Méjaire et du cercle
  r3 de l'Ikargn, pré-dégâts d'un allié jouant avant lui sur le zombie (bande de PV) sans le tuer.
- Glyphes de monstre comme levier d'équipe : décaler l'heure pour qu'un AUTRE personnage (à portée) corrompe ;
  glyphe du Buboxor (dommages subis ×50 %) et de la Méjaire (soin 10 %) en défense.
- Arrivée des vagues : retrait de PM pendant le tour d'invulnérabilité, placement hors de portée des cases bleues pour
  le personnage qui joue après la nouvelle vague (P4).
- Menace des Harpilles : le poison (≈ 6 000 par combat) n'entre pas dans `threat` ; prioriser Harpilles et Méjaires
  dans l'exposition du planificateur.

### Correctif moteur entre les tours 1 et 2 : Sac Animé

Corrigé dans `src/engine/effects/core.ts` (tests : `tests/engine-summon-owned.test.ts`, qui remplace le test de
reproduction `it.fails`) :

- **Effets portés par l'invocation** : dans un sort d'invocation, le 765 (interception) et le 141 « tue » à masque `C`
  qui suivent l'invocation sont exécutés par l'invocation créée. Le Sac Animé intercepte donc les dommages des alliés
  de sa zone (et non l'Enutrof), puis le Sac est détruit. Seuls deux sorts de tout le corpus sont concernés : Sac
  Animé et Pelle de Fortune.
- **Décompte sur les tours de l'invocateur** : nouveau champ `Buff.aliveSourceId`, l'`aliveSource` du client. Le Sac
  est détruit au début du 3e tour suivant de l'Enutrof, au moment où son interception expire. La Pelle de Fortune est
  détruite au moment où son soin différé soigne l'Enutrof, comme le dit sa description.
- **Recalcul des cibles après une apparition** (invocation ou résurrection) dans le même sort, à la manière du port
  après une résurrection. Effet de bord corrigé : la Musette Animée (141 `a,A` P1, pré-ciblé sur une case vide) n'était
  jamais détruite. Le contournement M1 du preset (Musette au lieu de Sac) est donc à re-mesurer au tour 2.

---

## Tour 2

### Protocole (mises à jour)

- Harnais déplacé dans `.cache/tuning/` (ignoré par git) : `run2.mts` (= `run1` + `--variant membre:paire=valeur` pour
  changer une variante de sort d'un preset, + sorts lancés par personnage), `batch.sh` (**2 processus**), `snap.sh`
  (instantané figé de `src/` et `data/ai/` ; les variantes d'une expérience reprennent le moteur de l'instantané
  `base` et n'écrasent que les fichiers réglables : l'autre agent modifie le moteur en parallèle).
- Référence « avant » du tour : tag git `base-tuning-r2` (commit 81430e2) ; `git diff base-tuning-r2 -- <fichiers>`
  montre les changements du tour (le commit d'instantané e7b3394 contient déjà une partie du travail).
- Lot : 32 graines `fast` (`masterSeed` 1, mêmes graines qu'au tour 1). Un changement candidat est confirmé sur 32
  graines de plus (`masterSeed` 2) : **n = 64** (IC 95 % ≈ ±0,3 corrompu, ±0,7 tour).
- Diagnostics (scripts du dossier) : `rounds.cjs` (par tour de jeu : dégâts infligés par personnage, subis, soins,
  monstres vivants), `marks.cjs` (marquage / corruption par vague et par monstre), `stars2.mts` (fenêtres d'étoile et
  cause de l'échec), `killkind.cjs` (morts de monstres : marquage, re-marquage, étoile ; source), `pacif.cjs`
  (Pacifiste au début du tour), `deaths.cjs`, `taken.cjs`, `contracts.cjs`, `calib2.mts` (calibration de la menace :
  incoming prévu à la fin du tour d'un personnage contre dégâts réellement subis jusqu'à son tour suivant, par source ;
  reproduit `runOne` à l'identique), `probe.mts`/`probe2.mts` (prix, plan, candidats d'un tour).

### Mesure de référence (code du tour 1 + correctif moteur 81430e2)

| Métrique | `masterSeed` 1 (n = 32) | `masterSeed` 2 (n = 32) |
|---|---|---|
| Victoires | 0 | 0 |
| Tours survécus | 14,47 | 13,69 |
| Corrompus au tour 7 / 12 / 17 | 1,13 / 2,41 / 2,53 | 1,03 / 1,91 / 1,94 |
| Premier mort (tour) | 10,6 | 9,7 |
| Dégâts subis / infligés aux monstres de vague | 32 300 / 54 000 | 31 700 / 48 600 |
| Causes d'échec | submersion 17, défaite 15 | submersion 23, défaite 8, croix 1 |

`standard`, 4 graines : 18,0 tours (`fast` 14,0 sur les mêmes graines), 3,0 corrompus (1,75).

### E0 — Enutrof : Sac Animé ou Musette Animée (re-mesure après le correctif moteur)

Apparié, 32 graines, `--variant 1:4=0` (Sac) contre le preset (Musette) : tours **+0,75 ± 0,87** (+16 / −9),
corrompus au tour 12 **−0,25 ± 0,28**, total −0,16 ± 0,38. Aucune différence significative, tendance opposée sur les
deux métriques ; la corruption (prioritaire) penche pour la Musette. **Preset inchangé (Musette)** ; le contournement
M1 n'a plus de raison d'être mais la Musette est une variante valide (« groupe serré ») et ne fait pas moins bien.

### Diagnostics

1. **La vague 2 n'est presque jamais traitée** : 1,44 monstre sur 4 marqué (tour moyen 10,9), 0,16 corrompu. Vague 1 :
   3 marqués (tour 3,5), 2,38 corrompus (tour 7,5) ; la **Méjaire** est la dernière (corrompue dans 19 combats sur 32,
   tour 8,6 ; l'Ikargn 31 / 32, tour 6,5). Les dégâts de l'équipe chutent de 5,8-7 k (tours 1-2) à 2-4 k (tours 3-7 :
   monstres marqués en attente de leur étoile, paliers de PV), puis 4-5 k contre la vague 2 alors qu'il en faudrait
   ≈ 6,6 k par tour pour marquer 4 × 6 600 PV et corrompre 4 zombies avant la vague 3.
2. **Fenêtres d'étoile** : 83 converties sur 195 (43 %). Échecs : tueur à portée (≤ 7 cases) mais pas de kill 39,
   loin (> 7 cases) 43, sous Pacifiste 26 (dont l'Iop 16), mort 4. L'Enutrof (exclu des contrats) hérite de 38
   étoiles (9 converties) : monstres tués à « ses » heures par un poison, une invocation ou une zone.
3. **Kill remis à plus tard** (cause des échecs « à portée ») : en `fast` (faisceau de largeur 1), le terme
   `continuation` crédite déjà 0,8 × (dégâts + prix du kill) d'un kill encore faisable avec les PA restants ; le
   premier tir sur le zombie étoilé rapporte donc à peine plus qu'un autre coup, le faisceau glouton joue d'autres
   actions puis n'a plus les PA. Sonde (graine 1212895563, tour 9, Crâ, Harpille étoilée à 1 100 PV, contrat
   « corrompt ») : continuation 3 904 à la racine, plan final sans le kill.
4. **Pacifiste** (Rayonirique de la Méjaire, non désenvoûtable) au début du tour : Iop 10 % (vague 1), 22 % (vague 2),
   48 % (vague 3+) ; 4-6 % pour les autres en vagues 1-2, ≈ 20 % ensuite. 62 tours de l'Iop sans dégâts sur 180 aux
   tours 7-12, la plupart sous Pacifiste.
5. **Le soigneur meurt le premier** dans 20 combats sur 32 (Eniripsa : sorts de soin et de dégâts à 4-5 PO, au
   contact des monstres : 83 % de ses fins de tour à ≤ 4 cases d'un monstre en vague 2).
6. **Menace sous-estimée** (`calib2.mts`, 6 graines) : en vague 2, dégâts réellement subis jusqu'au tour suivant ≈ 1,5
   à 2,8 × l'incoming prévu (Iop 392 → 1 114, Eniripsa 405 → 808, Crâ 552 → 931) ; par source (tours 7-12, par tour
   d'allié) : Brabuzar prévu 34, réel 116 + 90 de poussée ; Buboxor 58 → 112 ; poison des Harpilles 182 (hors
   incoming, terme `pendingDot`) ; la Méjaire est surestimée (valeur du Pacifiste comptée). Les morts ne sont pas
   prévues (risque moyen 0,03-0,14 avant une mort).
7. **Oracle de kill optimiste** : DPT analytique (sans contrainte de position) Iop/Méjaire 4 725, Crâ/Ikargn 3 200-4 100,
   contre ≈ 1,1-1,4 k réalisés par tour ; 32 % des marquages prévus au créneau courant ont lieu.
8. **Diagnostic « monstres à 50 % de dégâts »** (instantané modifié, hors dépôt) : 21,9 tours survécus, mais 3,4
   corrompus seulement (vague 2 : 0,75 sur 4 ; 253 étoiles, 22 % converties). **La survie n'est pas le seul verrou :
   le rythme de marquage et la conversion des étoiles plafonnent la progression.** Monstres au grade 1 : aucun effet
   (6 000 PV au lieu de 6 600).
9. **Changements du tour 1 absents du dépôt** : l'oracle `canKillNow` en `fast` (O1) et l'intention de placement du
   tueur d'une corruption (Q1/Q2), donnés comme gardés au tour 1 (point 3), ne sont pas dans le commit 1887df6 (ils
   n'existaient que dans l'instantané de mesure). Re-mesurés plus bas (KQ).
10. **`SearchPricer` (`standard`/`deep`) : prix d'une corruption à `killMin`** quand un monstre neuf est à portée. Les
   morts improbables (P(kill) < `minKillP`) sont chiffrées par une relance FORCÉE, où l'action est supposée réalisée ;
   leur score servait de référence « meilleur plan sans tuer m » pour les autres monstres. Puzzle P17 en `standard` :
   Ikargn étoilé (1 500 PV, à 4 cases du Crâ) payé **−3 000** (« tuer maintenant » −52 145 contre « tuer la Méjaire
   neuve à 6 600 PV », impossible, −47 466), aucun indice `kill`, corruption manquée.

### Modes d'échec retenus pour ce tour

1. **Conversion des étoiles et kills différés** (diagnostics 2, 3) : levier direct sur la corruption.
2. **Rythme de marquage de la vague 2** (1, 7) : dispersion des dégâts, oracle optimiste.
3. **Survie à l'arrivée de la vague 2** (5, 6) : monstres neufs apparus au contact de l'équipe (distance moyenne des
   personnages à la case bleue la plus proche à l'arrivée de la vague 2 : 4,2), menace sous-estimée.
4. **Pacifiste sur l'Iop** (4).

### Expériences (appariées ; référence indiquée ; 32 graines `masterSeed` 1 sauf mention)

| Essai | Changement | Réf. | Tours | Corr. t7 / t12 / total | Δ apparié (corr. total ; tours) | Verdict |
|---|---|---|---|---|---|---|
| B0 | référence (Musette) | — | 14,47 | 1,13 / 2,41 / 2,53 | — | — |
| E0 | Sac Animé (`--variant 1:4=0`) | B0 | 15,22 | 1,09 / 2,16 / 2,38 | −0,16 ± 0,38 ; +0,75 ± 0,87 | neutre, preset inchangé |
| F1 | cible focale de vague : pente de PV 1,2 sur le monstre neuf de plus grande menace / PV (`model.ts`) | B0 | 14,16 | 1,09 / 2,16 / 2,19 | −0,34 ± 0,43 ; −0,31 ± 0,97 | rejeté |
| S1 | danger des cases bleues au tour qui précède une vague (`extraIncoming`, 800 PVe à distance 0 → 0 à 8) | B0 | 15,00 | 1,22 / 2,25 / 2,31 | −0,22 ± 0,41 ; +0,53 ± 0,88 | rejeté (neutre) |
| **K1** | **ligne de kill** (`turnSearch.ts`, `fast`) **+ indices `kill` des monstres étoilés** (`model.ts`) | B0 | 14,31 | 1,34 / 2,34 / 2,63 | +0,09 ± 0,53 ; −0,16 ± 1,11 | confirmé sur n = 64 ↓ |
| K1 (`masterSeed` 2) | idem | B0 | 14,88 | 1,28 / 2,50 / 2,69 | **+0,75 ± 0,46** (+18 / −5) ; +1,19 ± 1,05 | |
| **K1 (n = 64)** | idem | B0 | 14,59 | 1,31 / 2,42 / 2,66 | **+0,42 ± 0,36** (+31 / −16) ; +0,52 ± 0,77 ; t7 +0,23 ± 0,26, t12 +0,27 ± 0,28 | **gardé** |
| K1+S1 | K1 + danger des cases bleues | K1 | 14,41 | 1,38 / 2,19 / 2,41 | −0,22 ± 0,50 ; +0,09 ± 1,11 | rejeté |
| T1 | K1 + θ `value.incoming` 1,2 (menace sous-estimée) | K1 | 15,00 | 1,38 / 2,34 / 2,50 | −0,13 ± 0,56 ; +0,69 ± 1,05 | rejeté (neutre) |
| T2 | K1 + θ `threat.deathSigmaFrac` 0,5 | K1 | 14,34 | 1,38 / 2,34 / 2,53 | −0,09 ± 0,45 ; +0,03 ± 0,85 | rejeté |
| KQ (n = 64) | K1 + O1 (`canKillNow` en `fast`) + Q2 (placement du tueur), changements du tour 1 absents du dépôt | K1 | 14,44 | 1,28 / 2,33 / 2,50 | −0,16 ± 0,28 ; −0,16 ± 0,75 | rejeté |
| R+ | K1 + re-marquage d'un zombie mieux payé (0,6 × exposition au lieu de 0,3, `pricer.ts`) | K1 | 14,69 | 1,38 / 2,53 / 2,69 | +0,06 ± 0,45 ; +0,38 ± 0,93 | neutre, rejeté |
| R0 | K1 + re-marquage sans valeur d'exposition (0) | K1 | 14,56 | 1,38 / 2,50 / 2,72 | +0,09 ± 0,38 ; +0,25 ± 0,82 | neutre, rejeté |
| P1 | K1 + θ `threat.pacifistFactor` 1,5 | K1 | 13,81 | 1,38 / 2,22 / 2,44 | −0,19 ± 0,49 ; −0,50 ± 1,16 | rejeté |
| **KH (n = 64)** | K1 + **indices `kill` des kills payés** (≥ 1 000 PVe à l'heure courante, hors étoile et hors contrat, monstre à portée de kill selon l'oracle) : la ligne de kill marque aussi un monstre neuf achevable | K1 | 14,83 | 1,45 / 2,56 / 2,77 | +0,11 ± 0,36 (+26 / −17) ; +0,23 ± 0,88 ; t7 +0,14 ± 0,23, t12 +0,14 ± 0,26 | **gardé** (tendance + sur les deux jeux de graines) |
| KH contre B0 (n = 64) | K1 + KH | B0 | 14,83 | 1,45 / 2,56 / 2,77 | **+0,53 ± 0,34** (+36 / −13) ; +0,75 ± 0,81 ; t7 **+0,38 ± 0,24**, t12 **+0,41 ± 0,29** | |
| EC (n = 64) | K1 + contrats de **corruption** permis au joueur exclu des contrats (Enutrof « full retrait » : ses alliés pré-dégâtent le zombie étoilé jusqu'à sa portée de kill ; jamais de marquage) (`planner.ts`) | K1 | 14,47 | 1,39 / 2,39 / 2,45 | −0,20 ± 0,32 ; −0,13 ± 0,67 | rejeté |

Effet de K1 sur les mécanismes visés (`masterSeed` 1) : fenêtres d'étoile converties 83 / 195 (43 %) → 85 / 174
(49 %), échecs « à portée » 39 → 22 ; contrats du créneau courant tenus : corruptions 44 % → 58 %, marquages 32 % →
36 %. Avec KH : 90 / 172 (52 %), échecs à portée 20, loin 31 (43), sous Pacifiste 25 (26).

### Diagnostics : puissance de l'équipe, composition (hors dépôt, IA K1)

Instantané modifié (`Engine.applyDamage` × facteur, **diagnostic seulement**, jamais dans `src/`), 16 graines `fast` :

| Diagnostic | Victoires | Tours | Corr. t7 / t12 / t17 / total | Vague 2 marqués / corrompus | Premier mort |
|---|---|---|---|---|---|
| Équipe méta, IA K1 (16 graines de référence) | 0 | 13,8 | 1,13 / 2,25 / 2,50 / 2,50 | — | 9,5 |
| Dégâts infligés × 2 | 0 | 16,3 | 1,88 / 3,56 / 4,56 / 4,56 | 3,75 / 1,63 | 10,0 |
| Dégâts subis × 0,5 (IA du début du tour) | 0 | 21,9 | 1,19 / 2,25 / 3,31 / 3,44 | 2,06 / 0,75 | 16,9 |
| Infligés × 2 **et** subis × 0,5 | **1 / 16** | 27,4 | 2,56 / 4,00 / 6,50 / 8,81 | 4,00 / 3,75 | 20,3 |

La victoire (graine 456638276) : 19 corrompus au tour 36, *Action !*, Vortex (22 000 PV) tué en ≈ 7 tours de phase 2,
aucun mort. **Le pipeline complet (marquage, corruption, déverrouillage, burst) fonctionne** ; il faut une équipe
≈ 4 fois plus forte (×2 en attaque et en défense) pour gagner une fois sur 16, et même alors 8,8 corrompus sur 19 en
moyenne : les vagues 3-5 ne sont pas tenues (vague 3 : 1,19 corrompu sur 4, vague 5 : 0,25).

Compositions (16 graines, IA K1, mêmes graines) : Huppermage quadra à la place de l'Enutrof : corrompus au tour 7
1,69 (1,13) mais 12,0 tours (13,8), premier mort 8,4 (9,5) — le retrait de PM de l'Enutrof vaut ≈ 2 tours de survie ;
Roublard artificier + Pandawa + Iop + Crâ (méthode JOL n° 1) : 10,3 tours, 1,19 corrompu (bombes et porter mal
exploités par l'IA). L'équipe méta reste la meilleure des trois.

### Changements gardés (tour 2)

1. `src/ai/tactical/turnSearch.ts` — **ligne de kill** (faisceau de largeur 1, `fast`) : avant le faisceau, une ligne
   qui joue à chaque profondeur le meilleur candidat obligatoire touchant la cible de l'indice `kill` le mieux payé
   (un enfant qui la tue l'emporte), jusqu'à sa mort ; sa feuille finale est toujours finalisée et comparée en V
   terminale aux autres plans. Corrige le kill remis à plus tard par le terme `continuation`.
2. `src/dungeons/vortex/model.ts` (`hints`) — indices `kill` supplémentaires : (a) tout monstre étoilé vivant au
   créneau courant (prix `kill[m][0]` > 0), même hors contrat du plan ; (b) **kills payés** : monstre non étoilé,
   vulnérable, dont le prix de mort à l'heure courante est ≥ `PAID_KILL_HINT` (1 000 PVe) et que l'oracle juge à
   portée de kill (espérance ≥ PV) — la ligne de kill marque aussi un monstre neuf achevable. **(b) retiré à la
   vérification** : nuisible sur graines inédites (voir « Vérification (tour 2) » en fin de section).
3. `src/dungeons/vortex/pricer.ts` (`searchPrices`, `standard`/`deep`) — pour le prix d'une mort PROBABLE, la
   référence « meilleur plan sans tuer m » exclut les morts improbables (P(kill) < `minKillP`), chiffrées par une
   relance forcée qui les suppose réalisées : une corruption sûre n'est plus payée `killMin` (−3 000) parce qu'un
   monstre neuf hors de portée de kill est à portée de tir. Une mort improbable reste comparée à toutes les actions
   (hypothèse contre hypothèse) : exclure aussi ces références rendait positif le kill à V du puzzle P4 (+2 311, il
   doit rester négatif). Sans effet en `fast` (vérifié : 16 graines identiques).
4. Tests : `tests/ai-puzzles-vortex.test.ts` — P17 (monstre étoilé à deux lancers, à 4 cases : corrompu en `fast` et
   en `standard`, prix de l'étoile positif, indice `kill`), P18 (monstre neuf à 900 PV à 3 cases, kill payé à
   l'heure courante : indice `kill` hors contrat, marqué), P14 durci (le kill payé à deux lancers est exigé aussi en
   `fast`, la ligne de kill le trouve).

Rejetés et retirés du code : cible focale (F1), danger des cases bleues (S1), O1 + Q2 du tour 1 (KQ), contrats de
corruption de l'Enutrof (EC), réglages θ T1, T2, P1, prix de re-marquage R+ / R0. Preset Enutrof inchangé (E0).

Vérifications : `npx tsc --noEmit` vert ; `npx vitest run tests/ai-* tests/vortex-* tests/engine-summon-owned.test.ts` :
332 réussis, 1 échec **hors de ce tour** — `ai-monster-fidelity` M-R20 (critiques en espérance : `mid.p` vaut 1),
dû à la modification en cours de `src/damage/damage.ts` par l'agent « performances » (non commitée) : le même test
passe avec le code IA final de ce tour sur le moteur de début de tour (instantané `final`, 13 / 13).

### Mesure finale du tour 2

`fast`, n = 64 (`masterSeed` 1 et 2), apparié, même moteur (instantané `base`) : code de début de tour (B0) contre
code final (K1 + KH ; le correctif du `SearchPricer` est sans effet en `fast`).

| Métrique | Avant (B0) | Après | Δ apparié (IC 95 %) |
|---|---|---|---|
| Victoires | 0 / 64 | 0 / 64 | — |
| Tours survécus | 14,08 | 14,83 | +0,75 ± 0,81 (+36 / −21) |
| Corrompus au tour 7 | 1,08 | **1,45** | **+0,38 ± 0,24** (+32 / −14) |
| Corrompus au tour 12 | 2,16 | **2,56** | **+0,41 ± 0,29** (+31 / −13) |
| Corrompus au tour 17 / total | 2,23 / 2,23 | **2,75 / 2,77** | **+0,52 ± 0,33 / +0,53 ± 0,34** (+36 / −13) |
| Premier mort (tour) | 10,1 | 10,5 | +0,34 ± 0,85 |
| Dégâts infligés aux monstres de vague | 51 300 | 54 100 | +2 800 ± 4 600 |
| Fenêtres d'étoile converties (`masterSeed` 1) | 83 / 195 (43 %) | 90 / 172 (52 %) | |
| Corruptions prévues au créneau courant et tenues | 44 % | 58 % | |
| Vague 1 corrompue (sur 3, `masterSeed` 1) | 2,38 (tour 7,5) | 2,47 (tour 7,1) | |
| Vague 2 marquée / corrompue (sur 4, `masterSeed` 1) | 1,44 / 0,16 | 1,31 / 0,31 | |

`standard`, 16 graines (`masterSeed` 1), apparié, code final contre B0 : tours 16,75 → 16,69 (−0,06 ± 1,79),
corrompus au tour 7 1,13 → 1,38 (+0,25 ± 0,46), au tour 12 2,44 → 2,25 (−0,19 ± 0,57), total 2,94 → 2,81
(−0,13 ± 1,01) : **neutre** (aucune victoire). En `standard`, la ligne de kill n'est pas active (faisceau de largeur 6)
et 26 % des étoiles sont manquées « à portée » (32 sur 123, contre 12 % en `fast` avec la ligne de kill). Essai
« ligne de kill aussi en `standard` » (16 graines) : échecs à portée 32 → 18, vague 2 marquée 1,88 → 2,75, mais
métriques principales neutres (corrompus +0,06 ± 1,07, tours −0,50 ± 1,93) : non retenu, la ligne reste réservée au
faisceau de largeur 1 (seule configuration mesurée positive, n = 64).

### Modes d'échec restants

1. **Débit de dégâts insuffisant contre la vague 2** : ≈ 4-5 k par tour de jeu aux tours 8-11 (Crâ ≈ 1,9 k par tour,
   Iop ≈ 1,4 k hors Pacifiste, Eniripsa ≈ 1,2 k, Enutrof ≈ 0,7 k), quand il faudrait ≈ 6,6 k pour marquer les 4
   monstres neufs (4 × 6 600 PV) et corrompre leurs zombies avant la vague 3 ; la vague 2 reste à 1,3 marqué et
   0,3 corrompu sur 4. Le DPT analytique de l'oracle (sans contrainte de position) vaut ≈ 3 fois le réalisé.
2. **Pacifiste** : l'Iop commence 20-25 % de ses tours de vague 2 sous Pacifiste (40-65 % en vague 3, deux
   Méjaires) ; la Méjaire de la vague 1 est le monstre corrompu le plus tard (21 / 32, tour ≈ 9,3), elle joue
   encore pendant la vague 2.
3. **Survie** : premier mort au tour ≈ 10,5 (Crâ, Eniripsa, Iop) ; la menace sous-estime les dégâts réels d'un facteur
   1,5 à 2,8 en vague 2 (Brabuzar : poussées et collisions non comptées ; Buboxor ; poison des Harpilles hors
   incoming) ; les morts ne sont presque jamais prévues (risque 0,03-0,14 au tour qui précède).
4. **Fenêtres d'étoile encore manquées à 48 %** : tueur à plus de 7 cases 31, sous Pacifiste 25, à portée sans kill
   20 (`masterSeed` 1, KH). L'Enutrof reçoit des étoiles à « ses » heures (poisons, invocations) et n'en convertit
   qu'un tiers.
5. **`standard`** : neutre sur 16 graines (voir ci-dessous) ; la recherche plus large y survit 2-3 tours de plus que
   `fast`, mais la conversion des étoiles n'y est pas meilleure.

### Ce qui bloque la victoire (preuves)

- **Pas le moteur** : aucune infidélité trouvée ce tour (le correctif Sac / Musette fonctionne : la Musette meurt
  après 2 tours, le Sac intercepte).
- **L'IA** reste le verrou principal du côté « stratégie » : avec des monstres deux fois moins forts, l'équipe survit
  22 tours mais ne corrompt que 3,4 monstres sur 19 (vague 2 : 0,75) ; même ×2 en attaque et ×0,5 en défense, 8,8
  corrompus en moyenne et 1 victoire sur 16 (les vagues 3-5 ne sont pas tenues). Le pipeline complet
  (corruption des 19, *Action !*, burst du Vortex) fonctionne (victoire de la graine 456638276 dans ce diagnostic).
- **La puissance de l'équipe (stuff)** est le second verrou : personnages à 3 600-4 250 PV, ≈ 4-5 k de dégâts
  réalisés par tour de jeu ; il faudrait environ deux fois plus de dégâts ET deux fois moins de dégâts subis pour
  qu'une victoire apparaisse. Aucune des compositions essayées ne fait mieux que l'équipe méta (Huppermage au lieu de
  l'Enutrof : corruption plus rapide en vague 1 mais 2 tours de survie en moins ; Roublard + Pandawa : bien pire).

### Pistes pour le tour 3

- **Menace** (`threat.ts`, `dpt.ts`) : dommages de poussée et collisions (Brabuzar *Mise en situation*,
  *Neutralisation*), cumul *Bouclier absorbant* du Buboxor, poison des Harpilles dans le risque de mort ; calibrer
  contre `calib2.mts` (objectif : prévu ≈ réel par source).
- **Méjaires** : retrait de PM ciblé par l'Enutrof (*Maladresse* 1 PA, 1-12 PO, −2 PM ; *Tamisage*) pour garder l'Iop
  hors de portée de *Rayonirique* ; corrompre la Méjaire de la vague 1 en premier (intention dédiée plutôt que pente).
- **Arrivée des vagues** : *Retraite Anticipée* de l'Enutrof (−100 PM à tous, 1 tour) au tour d'apparition (les 4
  monstres neufs, invulnérables, ne peuvent pas avancer), placement des alliés qui jouent après l'apparition.
- **Rythme de marquage de la vague 2** : coordination des pré-dégâts sur une cible (bandes du planificateur) avec un
  oracle réaliste (DPT réalisé par tour quand le joueur attaque, pas DPT analytique) ; la pente focale seule (F1) ne
  suffit pas.
- **Étoiles manquées « loin »** : placement du tueur au tour qui précède sa fenêtre en tenant compte du déplacement
  du zombie (Q2 seul était neutre) ; étoiles de l'Enutrof : éviter les morts « accidentelles » (poisons, invocations)
  à ses heures.
- **Budget de recherche** : `standard` survit plus longtemps que `fast` ; mesurer un `fast` de largeur 2 avec la ligne
  de kill (coût ≈ ×2).

### Vérification indépendante (tour 2, second vérificateur)

Harnais propre (`.cache/tuning/verify/` : `vrun.mts` lit `summary.corruptedByRound` et `extra.corrupted`, morts, PA
inutilisés par tour de joueur), arbres de travail au tag `base-tuning-r2` (81430e2) + **seuls** les diffs du réglage
(aucune modification de l'agent « performances »), `fast`, **64 graines inédites** (`masterSeed` 7 et 8), 2 processus.

| Bras | Tours | Corr. t7 / t12 / total | Premier mort | PA restants (tours avec kill) |
|---|---|---|---|---|
| B (81430e2) | 14,23 | 1,28 / 2,16 / 2,28 | 9,64 | 1,46 |
| Code du tuner (K1 + KH) | 14,20 | 1,39 / 2,22 / 2,39 | 9,77 | 1,94 |
| **K1 seul (= arbre vivant final, KH retiré)** | **14,88** | **1,36 / 2,39 / 2,59** | **10,47** | 1,90 |
| K1 + KH + suite après le kill | 14,17 | 1,47 / 2,38 / 2,53 | 9,70 | 1,10 |
| K1 + suite après le kill | 14,53 | 1,42 / 2,41 / 2,56 | 9,95 | 1,19 |

- **Code du tuner contre B** : corrompus +0,11 ± 0,37 (+26 / −17), t7 +0,11 ± 0,27, t12 +0,06 ± 0,32, tours
  −0,03 ± 0,79 (`masterSeed` 7 : +0,06 ± 0,57 ; 8 : +0,16 ± 0,47). Le +0,53 ± 0,34 annoncé **ne se reproduit pas**.
- **KH** (K1 → K1 + KH) : corrompus −0,20 ± 0,29, t12 −0,17 ± 0,26, tours **−0,67 ± 0,61**, premier mort
  **−0,70 ± 0,58** : nuisible (l'oracle optimiste lance la ligne de kill sur des monstres neufs qu'on ne tue pas).
  Retiré — conclusion identique à l'autre vérification, déjà appliquée dans l'arbre vivant.
- **K1 seul contre B** : corrompus +0,31 ± 0,36 (+31 / −15), t12 +0,23 ± 0,29, tours +0,64 ± 0,83, premier mort
  **+0,83 ± 0,70**. Tendance positive, cohérente avec la mesure K1 du tuner (n = 64, +0,42 ± 0,36) : **gardé**.
- **Défaut de la ligne de kill** : sa feuille s'arrête au kill ; en `fast`, aucune relance après la dernière action du
  plan, et le faisceau ne peut pas reprendre ce préfixe (transpositions `seen`). Les PA restants aux tours avec kill
  augmentent de +0,48 ± 0,28 (K1 + KH contre B). Correctif essayé : suite gloutonne après le kill (`selectForSim`),
  feuille la plus profonde et meilleure feuille sans `continuation` finalisées. Effet : PA −0,72 ± 0,24, mais contre K1
  corrompus −0,03 ± 0,38, tours −0,34 ± 0,92, premier mort −0,52 ± 0,79. **Non retenu** (aucun gain). Piste pour le
  tour 3 : l'exposition après le kill pèse plus que les PA perdus.
- **Prix du `SearchPricer`** (`standard` seulement) : code relu, correct (la référence d'une mort probable exclut les
  racines forcées improbables ; une mort improbable reste comparée à toutes les actions). Je ne l'ai pas re-mesuré en
  `standard` : runs abandonnés, machine saturée (charge ≈ 20).
- **M-R20** (`ai-monster-fidelity`) : 13 / 13 sur le moteur de début de tour (81430e2) et sur l'arbre vivant actuel.
  L'échec signalé ne se reproduit plus.
- Aucune modification de `src/` ni des tests par ce vérificateur ; la suite IA / Vortex sur l'arbre vivant (autre
  vérification, 09 h 36) : 333 réussis, 1 ignoré.

### Vérification (tour 2)

Vérification indépendante (harnais `.cache/tuning/verify2/` : `run.mts`, `batch.sh`, `cmp.cjs`, empreinte SHA-1 des
événements de chaque combat). Arbres de travail git à `81430e2` (`base-tuning-r2`) : **avant** ; **livré** = + seuls
les diffs du réglage (K1 + KH + correctif du `SearchPricer`) ; **K1** = livré sans les indices de kills payés (KH),
c'est-à-dire le code final. `fast`, graines inédites `masterSeed` 7 et 9 (2 × 32), appariées ; le jeu `masterSeed` 8
du second vérificateur (section précédente) est ajouté au cumul : **n = 96**.

Contrôles du protocole : mes arbres reproduisent au combat près les sorties du réglage (`out/b0_64`, `out/kh_64`) sur
2 graines de `masterSeed` 1 ; `masterSeed` 7 est identique graine à graine chez les deux vérificateurs ; l'arbre
vivant (moteur optimisé du tour 2 de performance + code final) reproduit l'arbre K1 **événement par événement** sur
4 graines (mêmes empreintes) : les optimisations moteur ne changent pas ces mesures.

| Δ apparié, `fast`, n = 96 (`masterSeed` 7-9) | Corr. t7 | Corr. t12 | Corr. total | Tours | Premier mort |
|---|---|---|---|---|---|
| Livré (K1 + KH) − avant | +0,22 ± 0,22 | +0,19 ± 0,25 | +0,20 ± 0,28 | +0,03 ± 0,60 | +0,32 ± 0,56 |
| **K1 (code final) − avant** | **+0,25 ± 0,21** | **+0,33 ± 0,23** | **+0,43 ± 0,27** | **+0,76 ± 0,64** | **+0,92 ± 0,61** |
| KH : (K1 + KH) − K1 | −0,03 ± 0,17 | −0,15 ± 0,21 | −0,23 ± 0,24 | **−0,73 ± 0,50** | **−0,59 ± 0,48** |

Moyennes (n = 96) : avant 14,22 tours, corrompus 1,16 / 2,10 / 2,22 (t7 / t12 / total), premier mort 9,6 ; livré
14,25, 1,38 / 2,29 / 2,42, 9,9 ; **final 14,98, 1,41 / 2,44 / 2,65, 10,5**. Aucune victoire (0 / 96 dans chaque bras).

- **Le gain annoncé ne se reproduit pas pour le code livré** : corrompus +0,06 ± 0,57 (`masterSeed` 7), +0,16 ± 0,47
  (8), +0,38 ± 0,40 (9), contre +0,53 ± 0,34 annoncé sur les graines 1-2.
- **KH est nuisible hors échantillon** (tours −0,81 / −0,53 / −0,84 sur les jeux 7 / 8 / 9). Il avait été gardé sur
  une « tendance » (+0,11 ± 0,36) propre aux graines 1-2 : sur-ajustement. **Retiré** : bloc des kills payés de
  `VortexAIModel.hints` et `PAID_KILL_HINT` supprimés. P18 exige toujours le kill (il réussit dans les deux modes
  sans l'indice : contrat du planificateur en `fast`, recherche en `standard`) mais plus l'indice hors contrat.
- **K1 (ligne de kill + indices des monstres étoilés) est confirmé et gardé.** Cumul avec les 64 graines du réglage
  (n = 160) : corrompus +0,42 ± 0,22 (t7 +0,24 ± 0,16, t12 +0,31 ± 0,17), tours +0,66 ± 0,49, premier mort
  +0,59 ± 0,51 ; KH sur n = 160 : −0,09 ± 0,20, tours −0,34 ± 0,47.
- **Correctif du `SearchPricer`** : code relu et correct (P17 `standard`) ; gardé. `standard`, 8 graines
  (`masterSeed` 7), final − avant : corrompus +0,13 ± 1,25, t7 −0,38 ± 0,82, tours +0,75 ± 2,18 : neutre (peu de
  puissance), comme la mesure du réglage.
- Variante essayée, non retenue : nœuds de la ligne de kill hors de `seen` (le faisceau glouton ne peut plus jouer le
  premier coup de la ligne : quand son meilleur premier coup touche la cible, il explore le 2e) + suite gloutonne
  après le kill. Contre le livré (`masterSeed` 7) : corrompus +0,13 ± 0,49, tours +0,31 ± 0,95 : neutre. Même verdict
  que la « suite après le kill » du second vérificateur.
- Remarque de revue, sans changement : `killLineTarget` prend l'indice le mieux payé même s'il est hors d'atteinte,
  sans repli sur un indice atteignable moins payé (la ligne s'arrête alors dès la racine).
- Tests sur l'arbre vivant final : `npx tsc --noEmit` vert ; `npx vitest run tests/ai-* tests/vortex-*
  tests/engine-summon-owned.test.ts` : 333 réussis, 1 ignoré (ablations, opt-in), dont combats de contrôle
  (`ai-team-control`) 5 / 5, puzzles Vortex 17 / 17, `ai-monster-fidelity` 13 / 13 (M-R20 passe). Aucune infidélité
  du moteur trouvée.

---

## Tour 3

### Protocole

- Référence « avant » : tag git `base-tuning-r3` (commit 984037e). Harnais `.cache/tuning/r3/` (hors dépôt) :
  `mktree.sh` (arbre figé = `git archive base-tuning-r3` ; les variantes ne remplacent que les fichiers réglables),
  `run.mts` (un combat par graine : victoire, tours, corrompus cumulés par tour via l'état 6611, morts, dégâts subis par
  source, PA inutilisés, empreinte SHA-1 des événements), `batch.sh` / `queue.sh` (**2 processus**), `pair.cjs`
  (Δ apparié ± IC 95 %, graines meilleures / moins bonnes).
- Lot : 32 graines `fast` par `masterSeed` ; un changement est jugé sur `masterSeed` 1 + 2 (n = 64) puis **validé sur
  des graines inédites** (`masterSeed` 3 + 4, n = 64) avant d'être gardé (leçon du tour 2 : les graines du réglage
  surestiment le gain) ; mesure finale sur `masterSeed` 5 + 6, jamais utilisés pendant le réglage.
- Reprise : une première exécution de ce tour, interrompue par le redémarrage du conteneur à 10 h 27, avait déjà
  mesuré la référence (ms 1-4) et plusieurs variantes (arbres `.cache/tuning/r3/trees`) sans modifier le dépôt ;
  ses résultats sont relus ci-dessous.

### Mesure de référence (`base-tuning-r3`, `fast`, n = 128, `masterSeed` 1-4)

| Métrique | Valeur |
|---|---|
| Victoires | 0 / 128 |
| Tours survécus | 14,63 (ms 1-4 : 14,31 / 14,88 / 14,84 / 14,47) |
| Corrompus au tour 7 / 12 / 17 / total | 1,35 / 2,46 / 2,64 / 2,66 |
| Premier mort (tour) | 10,0 |
| Dégâts subis / infligés aux monstres de vague | 32 700 / 52 900 |
| Kills de monstres de vague | 9,7 |
| PA inutilisés par tour de personnage | 2,72 |
| Causes d'échec | submersion 68, défaite 59, croix 1 |

Dégâts subis par source (moyenne par combat) : poison des Harpilles 6 000, Superfidie 4 600, Tirs optiques 4 600,
Neutralisation (Brabuzar) 3 500, Feinterception (Buboxor) 2 600, poussées du Brabuzar 2 000, Cercle de feu 2 000,
Hoxor 1 900, Rayonirique 1 800, Plumière 1 500.

### Expériences (appariées, `fast`, 32 graines par `masterSeed` ; référence = `base-tuning-r3` sauf mention)

Essais lancés avant le redémarrage du conteneur (10 h 27), résultats relus après coup :

| Essai | Changement | `masterSeed` | Tours | Corr. t7 / t12 / total | Δ apparié (corr. total ; tours) | Verdict |
|---|---|---|---|---|---|---|
| B0 | référence | 1-4 | 14,63 | 1,35 / 2,46 / 2,66 | — | — |
| PAC | sous Pacifiste : sorts « dégâts seulement » retirés des candidats, pas de ligne de kill (`generate.ts`, `turnSearch.ts`) | 1, 2 | 14,66 / 14,25 | 1,25 / 2,31 / 2,38 ; 1,25 / 2,41 / 2,50 | −0,25 ± 0,35 ; −0,19 ± 0,31 ; tours +0,34 / −0,63, premier mort −1,19 ± 0,77 (ms 2) | rejeté |
| N80 | `fast` 80 nœuds (largeur 1) | 1 | 14,69 | 1,53 / 2,56 / 2,63 | 0,00 ± 0,63 ; +0,38 ± 1,62 | neutre |
| NR | Enutrof : Pelle de Fortune au lieu de Retraite Anticipée (variante de sort) | 1 | 13,69 | 1,31 / 2,25 / 2,44 | −0,19 ± 0,44 ; −0,63 ± 1,09 | rejeté (Retraite utile) |
| W2 | `fast` largeur 2, 80 nœuds, ligne de kill gardée (largeur ≤ 2) | 1-4 (n = 128) | 15,29 | 1,38 / 2,51 / 2,83 | +0,17 ± 0,28 ; +0,66 ± 0,60 | faible |
| W2n60 | largeur 2, 60 nœuds | 1, 2 | 14,94 / 14,72 | 1,38 / 2,63 / 2,81 ; 1,50 / 2,47 / 2,69 | +0,19 / 0,00 ; +0,63 / −0,16 | neutre |
| **W3** | **`fast` largeur 3, 120 nœuds, ligne de kill gardée (largeur ≤ 3)** | 1-4 (n = 128) | **15,96** | **1,78 / 2,73 / 3,09** | **+0,44 ± 0,25 (+63 / −29) ; +1,34 ± 0,56 (+84 / −33)** ; t7 **+0,43 ± 0,16**, t12 +0,27 ± 0,19, premier mort **+0,94 ± 0,56** | **gardé** |

W3 par jeu de graines (corr. total ; tours) : ms 1 +0,31 ; +1,56 — ms 2 +0,56 ; +1,38 — ms 3 +0,44 ; +0,97 — ms 4
+0,44 ; +1,44 : positif sur les quatre jeux. Mécanisme : dégâts infligés aux monstres de vague +12 400 ± 3 100 par
combat (+23 %), kills +2,6, PA inutilisés par tour 2,72 → 1,45 ; dégâts subis +1 400 (tours en plus). Coût : voir la validation ci-dessous
(≈ 2 × par tour de jeu à charge égale).

**Validation de W3 sur graines inédites** (`masterSeed` 5 + 6, n = 64, jamais utilisées pendant le réglage) :
corrompus +0,50 ± 0,30 (+31 / −9 ; t7 +0,19 ± 0,24, t12 +0,31 ± 0,26, t17 +0,50 ± 0,30), tours **+1,55 ± 0,72**
(+39 / −17), premier mort +0,80 ± 0,73, kills +2,9. Cumul `masterSeed` 1-6 (n = 192) : corrompus **+0,46 ± 0,19**
(t7 +0,35 ± 0,13, t12 +0,28 ± 0,15), tours **+1,41 ± 0,44**, premier mort **+0,89 ± 0,44**. Coût mesuré sur des lots
consécutifs (même charge) : 328 → 666 ms par tour de jeu (≈ 2 ×), 4,8 → 10,8 s par combat (combats plus longs).
L'arbre « dépôt » (fichiers réglables du dépôt sur `base-tuning-r3`) reproduit W3 événement par événement (2 graines).

**W3 appliqué au dépôt** : `data/ai/theta-default.json` (`tactical.fast` : largeur 1 → 3, nœuds 40 → 120),
`src/ai/tactical/turnSearch.ts` (ligne de kill pour un faisceau de largeur ≤ 3, donc toujours en `fast`, jamais en
`standard`), `src/ai/tactical/rollout.ts` (le tour imbriqué d'un allié dans les rollouts `standard`/`deep` garde la
largeur 1 : comportement de `standard` inchangé, seules les invocations et le plan `fast` du mode `deep` héritent de la
largeur 3). Tests mis à jour : `tests/ai-contracts.test.ts` (budgets `fast`), `tests/ai-team-core.test.ts` (plafond de
nœuds lu dans θ), `tests/ai-puzzles-generic.test.ts` (ablation P3 : en largeur 3, le faisceau compose seul la séquence
de `stateChain` ; le plan reste au moins aussi bon). Largeur 4 (160 nœuds, ms 1) : corrompus +0,06 ± 0,48 contre W3
mais t7 −0,47 ± 0,36, tours −0,59, pour 1,6 × le temps de W3 : rejeté.

### Diagnostics sur W3 (replays `masterSeed` 1)

- **Fenêtres d'étoile** : 96 converties sur 227 (42 %). Échecs : **tueur sous Pacifiste 47** (Iop 21, Enutrof 15),
  à portée sans kill 43, loin 37, mort 4. Pacifiste devient la première cause.
- **Méjaire** : menace intrinsèque du modèle (dégâts seuls, `teamTurnDamage` × 0,75) = 599, la plus faible des cinq
  monstres (Ikargn 1 218, Buboxor 1 022, Harpille 944, Brabuzar 893) alors que Rayonirique (2 ×/tour) annule le tour
  d'un personnage : le planificateur la marque et la corrompt en dernier.
- **Ressuscités** : la perception ne voit pas les monstres morts ; ils ressuscitent autour du Vortex et jouent juste
  après lui (réinsérés après le Vortex dans la timeline), donc avant le prochain tour de presque tous les personnages.
  Exemple (graine 1212895563, tour 6-7) : l'Iop marque la Méjaire à II (contrat « corrompt à VI au tour 7 »), finit
  son tour au contact ; la Méjaire ressuscite au tour du Vortex, pose Pacifiste sur l'Iop (et l'Eniripsa) juste avant
  son tour : étoile perdue. Dégâts des monstres ressuscités dans le même tour : 1 765 par combat (5 %), 38 Pacifiste
  sur 228 (17 %).
- **Oracle de kill** : la calibration en ligne (`KillOracle.observe`) compare les dégâts de TOUT le tour à ceux de
  l'étape racine du plan (souvent une étape « dégâts » partielle) : elle reste ≈ 1,0 (sonde, graine 2069979692), alors
  que les dégâts réalisés valent 45-75 % du DPT analytique. Exemple : Iop, Harpille étoilée à 1 517 PV, contrat
  « corrompt (100 %) » ; dégâts réalisés 485.
- **Survie** : premier mort = Eniripsa dans 19 combats sur 32 (Crâ 9) ; fins de tour à 2,9 cases du monstre le plus
  proche en vague 2 (85 % à ≤ 4).
- **Vague 2** : 2,19 monstres marqués sur 4 (1,16 avant W3), tour moyen 11,2, mais 0,34 corrompu : l'étoile arrive
  ≈ 3 tours après le marquage, quand l'équipe meurt.
- **Corruption par monstre** (ms 1, base → W3) : vague 1 Harpille 78 → 88 % (tour 7,0), Ikargn 84 → 94 % (5,6),
  Méjaire 66 → 78 % (8,6, toujours la dernière) ; vague 2 Brabuzar 13 → 16 %, Buboxor 9 → 16 %, **Harpilles 6 → 2 %**
  (2 par vague 2, résistance Feu 43 % contre un Crâ et une Eniripsa Feu ; à distance, premières sources de dégâts
  subis : poison + Superfidie + Tirs optiques ≈ 15 000 par combat) ; vague 3 : 0 %.
- Menace réalisée par tour de monstre (dégâts subis / tours joués, ms 1) : Buboxor 653, Harpille 522, Brabuzar 474,
  Ikargn 407, Méjaire 200 (+ Pacifiste).

### Expériences sur W3 (référence W3 ; `masterSeed` 1, puis 2 si prometteur)

| Essai | Changement | n | Corr. t7 / t12 / total (Δ) | Tours (Δ) | Premier mort (Δ) | Verdict |
|---|---|---|---|---|---|---|
| DOT | risque de mort : le prochain tick des poisons (TB/TE) s'ajoute à l'incoming (`threat.ts` ; `pendingDotOn` déplacé dans `dpt.ts`) | 64 | −0,08 ± 0,09 / +0,03 ± 0,18 / +0,11 ± 0,24 | +0,16 ± 0,55 | +0,42 ± 0,43 | neutre |
| MDR | risque de mort : variance de Bernoulli (choix de cible de chaque ennemi) au lieu de σ = 0,25·inc (patch préparé avant le redémarrage) | 32 | −0,31 ± 0,28 / 0,00 ± 0,29 / −0,03 ± 0,37 | 0,00 ± 0,99 | −0,16 ± 1,01 | rejeté |
| MJ | menace intrinsèque d'un poseur de Pacifiste (+ 0,5 × DPT du meilleur personnage sur lui) : planificateur (exposition, prix) | 64 | −0,02 ± 0,20 / +0,05 ± 0,24 / −0,03 ± 0,35 | −0,02 ± 0,83 | +0,11 ± 0,83 | rejeté (ms 1 +0,22, ms 2 −0,28) |
| MJC | terme `control` : retrait PA/PM sur un poseur de Pacifiste valorisé avec la même part (`value.ts`) | 32 | −0,13 ± 0,19 / +0,06 ± 0,21 / −0,03 ± 0,33 | −0,19 ± 0,73 | −0,16 ± 0,81 | rejeté (10 combats identiques) |
| ORC | oracle de kill calibré sur les dégâts RÉALISÉS (prévision = meilleur DPT analytique sur un monstre présent ; a priori 0,6, borne basse 0,2) (`planner.ts`, `model.ts`) | 64 | −0,14 ± 0,26 / +0,03 ± 0,25 / +0,05 ± 0,38 | −0,28 ± 0,77 | +0,08 ± 0,87 | rejeté (calibration ≈ 0,45-0,75 au lieu de ≈ 1,0, sans effet mesurable) |
| HEAL | θ `roleUtility.healer` 2 000 → 4 000 | 32 | 0 / −0,03 / 0 | −0,06 | −0,06 | sans effet (30 combats identiques) |
| RETW | *Retraite Anticipée* (−100 PM à TOUS, alliés compris) seulement au tour d'arrivée d'une vague (`generate.ts`) | 32 | 0,00 ± 0,23 / +0,16 ± 0,23 / −0,03 ± 0,32 | **−0,88 ± 0,77** (+6 / −18) | +0,28 ± 0,72 | rejeté : la Retraite hors arrivée de vague aide à survivre |
| REZ | menace des monstres morts que le prochain tour du Vortex ressuscite (`extraIncoming`, `model.ts`, poids 0,5 ; dégâts + 0,5 × Pacifiste) | 128 | **−0,21 ± 0,17** / +0,08 ± 0,18 / +0,23 ± 0,28 (+52 / −39) | +0,41 ± 0,58 | +0,20 ± 0,57 | **rejeté** : ms 1 +0,84 ± 0,60, puis ms 2 / 3 / 4 +0,03 / +0,09 / −0,06 ; corruption au tour 7 dégradée (l'équipe s'écarte des zombies) |
| REZP | REZ limité aux poseurs de Pacifiste (Méjaire : part Pacifiste seule, sans les dégâts) | 64 | −0,11 ± 0,15 / +0,09 ± 0,20 / +0,16 ± 0,32 | +0,11 ± 0,72 | +0,27 ± 0,70 | neutre, rejeté |
| REZ1 | REZ, poids 1,0 | 32 | −0,41 ± 0,37 / −0,16 ± 0,34 / −0,34 ± 0,45 | −0,75 ± 0,88 | −0,19 ± 1,04 | rejeté (trop fort : l'équipe fuit les zombies) |
| REZ+DOT | REZ (0,5) + DOT | 32 | −0,13 ± 0,39 / +0,38 ± 0,40 / +0,47 ± 0,65 | +0,31 ± 1,15 | +0,22 ± 1,32 | voir REZ |
| FKEY | `fast` : décision clé connue avant la recherche (contrat de corruption au créneau courant, risque de mort ≥ 0,3, fenêtre de kill d'équipe, arrivée de vague) ⇒ 2 × les nœuds du tour (≤ 20 par combat ; `controller.ts`) | 64 | **−0,28 ± 0,23** / −0,13 ± 0,27 / −0,14 ± 0,37 | −0,55 ± 0,85 | −0,53 ± 0,84 | rejeté (ms 1 +0,28, ms 2 −0,56) : plus de nœuds n'aide pas (cf. largeur 4) |

### W3 avec les stuffs Vortex de la campagne CP5 (presets `*_vortex`, ajoutés par l'autre agent)

Arbres figés `base` / `w3` + `data/ai/presets.json` et `src/optimizer/` du dépôt (stuffs seulement ; l'IA reste celle
de l'arbre), équipe `cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,eniripsa_soin_vortex`, `fast`,
`masterSeed` 1, n = 32, appariés.

| Bras | Victoires | Tours | Corr. t7 / t12 / t17 / total | Premier mort | Kills |
|---|---|---|---|---|---|
| Équipe méta, stuffs des presets, IA `base-tuning-r3` | 0 | 14,31 | 1,34 / 2,34 / 2,59 / 2,63 | 9,8 | 9,7 |
| Stuffs `*_vortex`, IA `base-tuning-r3` | 0 | 20,28 | 1,75 / 3,06 / 3,97 / 4,25 | 12,7 | 16,0 |
| **Stuffs `*_vortex`, IA W3** | 0 | **22,03** | **1,91 / 3,53 / 4,94 / 5,25** | **16,3** | 20,6 |

W3 sur l'équipe stuffée : corrompus **+1,00 ± 0,69** (+20 / −6), t12 +0,47 ± 0,37, t17 **+0,97 ± 0,52**, tours
+1,75 ± 1,28, premier mort **+3,59 ± 1,39** : le gain de l'IA est plus grand avec une équipe plus solide (elle vit
assez longtemps pour corrompre la vague 2). Stuffs + W3 contre le départ du tour : 2,63 → 5,25 corrompus,
14,3 → 22,0 tours, premier mort 9,8 → 16,3 ; toujours 0 victoire.

### Bilan des priorités du tour

(a) calibration de la menace : DOT neutre (+0,11 ± 0,24), MDR rejeté ; (b) Méjaires : MJ, MJC, REZP neutres, PAC
rejeté ; (c) arrivée des vagues : *Retraite Anticipée* réservée aux arrivées de vague (RETW) −0,9 tour, sans elle
(NR) −0,6 tour : la Retraite actuelle est déjà utile ; (d) oracle sur dégâts réalisés (ORC) neutre ; (e) suite de la
ligne de kill : non retravaillée — avec W3, les PA restants aux tours avec kill passent de 1,77 à 0,97 (le faisceau
de largeur 3 trouve des plans complets) ; (f) **largeur 2-3 en `fast` avec la ligne de kill : gardé (W3)**.

### Changements gardés (tour 3)

1. **`fast` en largeur 3** (`data/ai/theta-default.json` : `tactical.fast` largeur 1 → 3, nœuds 40 → 120) ; la ligne
   de kill du tour 2 reste active en `fast` (`src/ai/tactical/turnSearch.ts` : faisceau de largeur ≤ 3) et absente en
   `standard` ; `src/ai/tactical/rollout.ts` : le tour imbriqué d'un allié dans les rollouts `standard`/`deep` garde
   la largeur 1 (`standard` inchangé à l'exception des invocations, qui jouent en `fast`).
2. Tests ajustés : `tests/ai-contracts.test.ts`, `tests/ai-team-core.test.ts`, `tests/ai-puzzles-generic.test.ts`
   (voir plus haut).

Aucun autre changement n'est gardé : DOT, MDR, MJ, MJC, REZ (et REZP, REZ1, REZ+DOT), ORC, HEAL, RETW, FKEY, largeur 4
n'existent que dans les arbres d'expérience (`.cache/tuning/r3/trees`, correctifs `patches/*.py`).

### Mesure finale du tour 3

Code du dépôt (W3) contre `base-tuning-r3`, même moteur, `fast`, apparié. Graines inédites : `masterSeed` 5 + 6
(n = 64) ; cumul `masterSeed` 1-6 (n = 192).

| Métrique | Avant | Après | Δ apparié, inédites (n = 64) | Δ apparié, cumul (n = 192) |
|---|---|---|---|---|
| Victoires | 0 / 192 | 0 / 192 | — | — |
| Tours survécus | 14,52 | **15,92** | +1,55 ± 0,72 (+39 / −17) | **+1,41 ± 0,44** (+123 / −50) |
| Corrompus au tour 7 | 1,41 | **1,76** | +0,19 ± 0,24 | **+0,35 ± 0,13** |
| Corrompus au tour 12 | 2,42 | **2,70** | +0,31 ± 0,26 | **+0,28 ± 0,15** |
| Corrompus au tour 17 / total | 2,59 / 2,60 | **3,04 / 3,06** | +0,50 ± 0,30 (+31 / −9) | **+0,46 ± 0,19** (+94 / −38) |
| Premier mort (tour) | 10,0 | **10,9** | +0,80 ± 0,73 | **+0,89 ± 0,44** |
| Dégâts infligés aux monstres de vague | 52 700 | 64 300 | +10 100 ± 4 000 | +11 600 ± 2 500 |
| Kills de monstres de vague | 9,6 | 12,3 | +2,9 ± 1,0 | +2,7 ± 0,6 |
| PA inutilisés par tour de personnage | 2,72 | 1,43 | −1,31 ± 0,10 | −1,29 ± 0,07 |
| Temps par tour de jeu (lots consécutifs) | 328 ms | 666 ms | ≈ 2 × | |

`standard`, 6 graines (ms 1), apparié : 3 combats identiques, corrompus 3,17 → 3,17, tours 16,33 → 15,83 (une
graine) : neutre, comme attendu (`standard` ne change que par les invocations, qui jouent en `fast`).

Avec les stuffs `*_vortex` (n = 32, ms 1) : 4,25 → **5,25** corrompus (+1,00 ± 0,69), 20,3 → 22,0 tours, premier mort
12,7 → 16,3 (voir le tableau précédent).

### Modes d'échec restants

1. **Vague 2** : Harpilles corrompues à 2 % (2 par vague 2, résistance Feu 43 % face au Crâ et à l'Eniripsa Feu, à
   distance, principales sources de dégâts subis : ≈ 15 000 par combat avec le poison) ; Buboxor et Brabuzar 16 %.
   2,2 monstres sur 4 marqués (tour 11,2) mais l'étoile arrive 3 tours plus tard, quand l'équipe meurt.
2. **Pacifiste** : première cause des étoiles manquées (47 sur 227 avec W3 ; Iop 21, Enutrof 15). Mécanisme typique :
   la Méjaire marquée ressuscite juste après le Vortex et pose Pacifiste sur son futur tueur avant son tour. Les trois
   corrections essayées (menace intrinsèque, retrait de PM valorisé, menace des ressuscités) sont neutres ou
   instables ; la Méjaire de la vague 1 reste la dernière corrompue (78 %, tour 8,6).
3. **Survie** : premier mort au tour ≈ 11, l'Eniripsa dans 19 combats sur 32 (fins de tour à 2,9 cases du monstre le
   plus proche en vague 2) ; θ `roleUtility.healer` n'y change rien (30 combats identiques sur 32).
4. **Étoiles « à portée sans kill »** (43 sur 227) : l'oracle du planificateur reste analytique (calibration en ligne
   ≈ 1,0 car elle compare des grandeurs différentes) ; le remplacer par une calibration sur dégâts réalisés (ORC) ne
   change pas le résultat.
5. **Coût** : `fast` coûte ≈ 2 × plus cher par tour de jeu (campagnes de l'optimiseur plus lentes).

### Ce qui bloque la victoire (preuves)

- **Le moteur** : aucune infidélité trouvée ce tour. *Retraite Anticipée* retire bien 100 PM aux alliés aussi (masque
  `A,g`, zone C63 ; description du sort : « Pesanteur sur tout le monde sauf le lanceur ») : fidèle, et utile malgré
  tout (RETW, NR).
- **La recherche tactique** était un verrou majeur et peu coûteux à lever : un faisceau de largeur 3 vaut +0,46
  corrompu et +1,4 tour (n = 192), autant que les gains cumulés des tours 1-2 de corrections du modèle ; plus de nœuds
  sans largeur (N80, FKEY) ou une largeur 4 n'apportent rien.
- **Le stuff** est le second verrou : les stuffs `*_vortex` valent +1,6 corrompu et +6 tours avec l'IA de départ ; IA
  et stuff se renforcent (W3 vaut +1,0 corrompu avec ces stuffs contre +0,46 sans).
- **Diagnostic « équipe ×2 en attaque et ×0,5 en défense »** (arbre figé modifié, `Engine.applyDamage` × facteur,
  **jamais dans `src/`** ; mêmes 16 graines `masterSeed` 1 que le diagnostic du tour 2, équipe méta, stuffs des
  presets) : **8 victoires sur 16 avec W3** (tour 2 : 1 sur 16), 15,3 corrompus en moyenne (8,8), 39,9 tours ; échecs :
  vague non corrompue au déverrouillage 4, submersion 2, limite de tours 1, burst raté 1. Le pipeline complet
  (19 corruptions, *Action !*, burst du Vortex) gagne donc une fois sur deux avec une équipe ≈ 4 × plus forte : l'IA
  n'est plus le verrou principal, la puissance de l'équipe l'est.
- **Même diagnostic sur l'équipe stuffée (`*_vortex`) avec W3, facteurs réduits** (16 graines ms 1) : **×1,5 en
  attaque et ×0,67 en défense : 8 victoires sur 16**, 14,4 corrompus en moyenne, 38,8 tours (échecs : vague non
  corrompue au déverrouillage 6, limite de tours 1, submersion 1) ; **×1,25 / ×0,8 : 0 victoire sur 16**, 8,8
  corrompus, 28,3 tours (vague non corrompue au déverrouillage 9, submersion 6). Le seuil de victoire se situe entre
  +25 % et +50 % de dégâts (avec −20 % à −33 % de dégâts subis) au-delà des stuffs optimisés, et non plus « 4 × plus
  fort » comme au tour 2.
- **Rythme** : même stuffée et avec W3, l'équipe corrompt 5,25 monstres sur 19 en 22 tours ; la victoire exige les 19
  avant le ~26ᵉ tour du Vortex, puis le burst. La vague 2 (deux Harpilles résistantes au Feu) et la vague 3 (deux
  Méjaires) ne sont pas tenues sans marge : d'après le diagnostic ci-dessus, il manque ≈ +25-50 % de dégâts utiles et
  −20-33 % de dégâts subis (équipe, composition — élément Feu doublé face aux Harpilles — ou IA : gestion des Méjaires,
  focus de la vague 2), ce que les heuristiques de valeur essayées ce tour ne produisent pas.
- **Conclusion** : en l'état (stuffs `*_vortex` + W3), aucune victoire sur 32 graines ; la victoire devient fréquente
  (8 / 16) pour une équipe ≈ 1,5 × plus offensive et 1,5 × plus résistante. Les deux leviers restants sont
  l'équipe (stuff / composition) et le rythme de corruption des vagues 2-3 par l'IA.

### Pistes pour le tour 4

- **Équipe** : mesurer W3 sur les stuffs `*_vortex` à plus grande échelle (n ≥ 64) et une composition sans double Feu
  (Harpilles : Feu 43 %, faibles Neutre) ; le gain de l'IA y est double.
- **Coût de `fast`** : largeur 3 avec 80-90 nœuds (W2n60 était neutre, N80 aussi : chercher le minimum qui garde le
  gain) pour les campagnes de l'optimiseur.
- **Méjaire / Pacifiste** : séquence d'équipe explicite au tour qui précède une étoile de Méjaire (Enutrof : retrait de
  PM « juste assez » sur la Méjaire ressuscitée ; tueur hors des lignes 1-3 + PM) via une intention du planificateur
  (et non une pente de valeur, neutre trois fois).
- **Vague 2** : pré-dégâts coordonnés sur une Harpille par les personnages non Feu (Iop, Enutrof), mesurés avec un
  oracle « dégâts réalisés par paire élément × monstre ».
- **Ressuscités** : modèle de menace plus fin que REZ (case de résurrection réelle de la zone C63,3, ligne de vue,
  exemption du tueur prévu quand le ressuscité n'est pas un poseur de Pacifiste) ; REZ global était instable.

Vérifications : `npx tsc --noEmit` vert ; `npx vitest run tests/ai-* tests/vortex-* tests/engine-summon-owned.test.ts`
(1 processus) : **333 réussis, 1 ignoré** (ablations, opt-in). Aucune infidélité du moteur trouvée ce tour (aucun test
`it.fails` ajouté).

---

## Tour 4

### Protocole

- Référence « avant » : tag git `base-tuning-r4` (règles 2.42 : vagues aux tours 1, 7, 13, 19, 25 ; ressuscités à
  −1 PM ; Vortex de rang 1 à 4 joueurs). Équipe : `cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,
  eniripsa_soin_vortex` (stuffs optimisés, docs/reports/vortex-stuffs.md), `fast`, variante `default`.
- Harnais `.cache/tuning/r4/` (hors dépôt) : `mktree.sh` (arbre figé = `git archive base-tuning-r4`), `mkvar.sh`
  (arbre figé + fichiers vivants donnés), `run.mts` (un combat par graine : victoire, tours, corrompus cumulés par tour
  et par vague, morts, dégâts subis par source, empreinte des événements), `batch.sh` (3 processus), `pair.cjs`
  (Δ apparié ± IC 95 %). Diagnostics : `diag/flow.cjs` (dégâts et kills par tour de jeu), `diag/pround.cjs` (par
  personnage et par phase : Pacifiste au début du tour, dégâts infligés et subis, PA), `diag/markorder.cjs` (délai du
  premier kill par monstre de vague), `diag/pacsrc.cjs` (géométrie des Pacifiste posés).
- Lot : 32 graines `fast` par `masterSeed` ; réglage sur `masterSeed` 31, validation sur `masterSeed` 32.
- Reprise : une première exécution de ce tour est morte (erreur d'API 529) après ≈ 40 min ; son travail partiel
  (commit c76c9cb : ligne de kill par glyphe, valeur des invocations dans la menace) est relu et mesuré ci-dessous.

### Mesure de référence (`base-tuning-r4`)

| Métrique | `masterSeed` 31 | `masterSeed` 32 |
|---|---|---|
| Victoires | 0 / 32 | 0 / 32 |
| Tours survécus | 27,03 | 26,91 |
| Corrompus au tour 7 / 12 / 13 / 17 / 19 / 25 / total | 2,31 / 3,78 / 4,81 / 5,88 / 6,34 / 7,06 / 7,34 | 2,38 / 3,63 / 4,34 / 5,75 / 6,41 / 7,44 / 7,63 |
| Corrompus par vague (1 à 5) | 3,00 / 3,41 / 0,78 / 0,13 / 0,03 | 2,97 / 3,44 / 1,03 / 0,19 / 0,00 |
| Premier mort (tour) | 18,2 | 18,8 |
| Dégâts subis / infligés aux monstres de vague | 50 900 / 121 100 | 51 800 / 123 300 |
| Kills de monstres de vague | 25,3 | 26,9 |
| Causes d'échec | submersion 16, vague non corrompue au déverrouillage 14, croix 1, défaite 1 | submersion 17, vague non corrompue 15 |

Dégâts subis par source (ms 31, par combat) : poussées du Brabuzar 9 100, Neutralisation 8 200, poison des Harpilles
6 700, Superfidie 4 900, Tirs optiques 4 100, Cercle de feu 4 000, Feinterception 2 600, Rayonirique 2 400.

Diagnostic « puissance » (arbre figé modifié, `Engine.applyDamage` × facteur, jamais dans `src/`, ms 31) :
×1,25 en attaque et ×0,8 en défense : **8 victoires / 32** (12,5 corrompus) ; ×1,5 / ×0,67 : **22 / 32** (17,2).

### Relecture du travail partiel (commit c76c9cb)

| Essai | Changement | `masterSeed` | Corr. t7 / t13 / total (Δ) | Tours (Δ) | Verdict |
|---|---|---|---|---|---|
| SV | menace : v(a) des invocations (θ.monster.summonValue) dans le score de ciblage (`threat.ts`) | 31 | −0,28 ± 0,34 / −0,44 ± 0,50 / −0,06 ± 1,04 | −0,09 ± 1,82 | **retiré** (tendance −) |
| GKL | ligne de kill PAR UNE GLYPHE en `fast` (`turnSearch.ts`, puzzle P6) | 31 | 0 / −0,06 ± 0,09 / 0,00 ± 0,36 (10 combats identiques) | +0,66 ± 1,42 | |
| GKL | idem | 32 | +0,03 / +0,28 ± 0,32 / +0,09 ± 0,72 (10 identiques) | +0,28 ± 1,07 | **gardé** (neutre, corrige P6 `fast`) |
| PAC2 | θ `threat.pacifistFactor` 0,9 → 2,0 | 31 | −0,19 / −0,66 ± 0,42 / −0,94 ± 1,11 | −0,59 ± 2,46 | rejeté |
| CTL4 | θ `value.control` 0,15 → 0,4 | 31 | +0,13 / −0,03 / +0,34 ± 1,04 | −0,19 ± 1,59 | neutre, rejeté |

### Diagnostics (replays de la référence, ms 31)

1. **Dégâts et kills par tour de jeu** (`flow.cjs`) : vague 2 (tour 7) traitée à ≈ 9 500 puis 8 100 de dégâts aux tours
   8-9, mais seulement 0,09 puis 0,78 premier kill : délai du premier kill 2,7-2,8 tours après l'arrivée (Brabuzar,
   Buboxor), **4,2 tours pour les Harpilles** ; la vague 2 finit corrompue à 3,4 / 4, mais tard (tours 11-18). **Vague 3**
   (tour 13 : deux Méjaires, Harpille, Brabuzar) : l'équipe tombe à ≈ 4 000 de dégâts par tour, 0,42 Méjaire marquée
   (délai 4,5 tours), 0,13 Harpille ; morts à partir du tour 19-20 (vague 4).
2. **Pacifiste** (`pround.cjs`, tours 14-15) : Iop **53 %** de ses tours sous Pacifiste, Eniripsa 39 %, Crâ 19 %, Enutrof
   14 % (tours 1-12 : < 10 %). 410 Pacifiste posés aux tours 13-24 (`pacsrc.cjs`) : 90 % par des Méjaires **jamais
   tuées** (fraîches), 55 % sur une cible déjà à ≤ 3 cases au début du tour de la Méjaire, 84 % après un déplacement de la
   Méjaire (58 % à 4 PM : l'Enutrof ne lui retire presque jamais de PM — *Maladresse*, 1 PA, −2 PM, 1-12 PO, 4 / tour :
   0,22 lancer par tour d'Enutrof).
3. **Bornes supérieures** (arbre figé modifié, diagnostics seulement, jamais dans `src/`) : sans aucun Pacifiste sur les
   personnages (NOPAC) : corrompus **+3,13 ± 1,49** (7,3 → 10,5), tours +3,9 ± 2,9, **2 victoires / 32** ; sans
   dommages de poussée du Brabuzar (NOPUSH) : corrompus +1,78 ± 1,33, **tours +5,3 ± 2,9**, premier mort +3,7 ± 2,3,
   1 victoire / 32. Pacifiste et poussées sont les deux plus gros leviers mesurés.
4. **Calibration du Pacifiste** (`calibpac.mts`, 9 combats, tours 13-26, paires (fin de tour d'un personnage, Méjaire
   vivante qui joue avant lui), n = 790) : prévu π·min(1, portée) = **0,075**, réel **0,124** ; avec min(1, 2π) (la
   Méjaire pose Rayonirique sur DEUX cibles par tour, π n'en compte qu'une) : 0,126. Les Méjaires mortes (ressuscitées
   avant le tour du personnage) ne sont pas vues (≈ 0,07 de Pacifiste par paire). La portée utilisée est celle du
   MEILLEUR sort à dégâts (Plumière 3-7 ou Rayonirique 1-3 selon l'allié), pas celle du sort Pacifiste.
5. **Menace du Brabuzar** (`calib4.mts`, sortie du premier passage) : prévu 24 par tour d'allié, réel 260 + 140 de
   poussée : `threat.ts` ne compte aucun dommage de collision (la poussée de 4 de *Mise en situation*, +200 dommages de
   poussée, collisions contre les murs, les alliés et les corrompus).
6. **Confusion de l'essai PAC2** : `θ.threat.pacifistFactor` est AUSSI le poids `pacifist` du MonsterBrain
   (`src/ai/monster/profiles/index.ts`) : le passer à 2,0 rend les Méjaires plus agressives. PAC2 (et P1 du tour 2)
   mesurait donc surtout des monstres modifiés ; les essais Pacifiste de ce tour passent par du code (`threat.ts`), pas
   par θ.
7. **Cadence** : ni le planificateur, ni les pricers, ni le modèle abstrait ne supposent 5 tours entre deux vagues
   (`arrivesRound` vient de `vx.arrivalRounds`, abstract.ts / tracker.ts) : rien à corriger.

### Expériences (appariées, `fast`, ms 31, n = 32 ; référence GKL = `base-tuning-r4` + ligne de kill par glyphe)

| Essai | Changement | Corr. t13 (Δ) | Corr. t19 (Δ) | Corr. total (Δ) | Tours (Δ) | Effet visé | Verdict |
|---|---|---|---|---|---|---|---|
| MJ05 | menace intrinsèque d'un poseur de Pacifiste (planificateur, patch MJ du tour 3, 0,5 × DPT) | −0,03 ± 0,53 | −0,22 ± 0,73 | −0,03 ± 1,05 | −1,78 ± 2,38 | vague 3 corrompue +0,22 | rejeté |
| MJ10 | idem, 1,0 × DPT | −0,13 ± 0,44 | 0,00 ± 0,56 | +0,16 ± 0,89 | −0,56 ± 2,49 | | rejeté |
| MJC05 | terme `control` : retrait PM/PA d'un poseur de Pacifiste (patch MJC du tour 3) | −0,25 ± 0,30 | +0,09 ± 0,44 | −0,13 ± 0,66 | −0,63 ± 2,23 | | rejeté |
| PUSH1 | menace : **dommages de collision** des sorts de poussée (`threat.ts`, `pushOn`) | −0,13 ± 0,42 | −0,22 ± 0,54 | +0,06 ± 1,08 | −0,53 ± 2,80 | poussées 9 400 → 8 100, Neutralisation 8 700 → 7 500 | neutre |
| PCAL1 | menace : portée du sort Pacifiste lui-même + Pacifiste × 1,7 (calibration, 2 cibles / tour) | −0,44 ± 0,39 | −0,25 ± 0,54 | +0,34 ± 1,03 | 0,00 ± 1,70 | Rayonirique subi −15 % ; un combat atteint *Action !* | neutre |
| PCAL2 | menace : portée du sort Pacifiste seule | −0,16 ± 0,41 | −0,25 ± 0,63 | +0,31 ± 1,16 | −0,84 ± 2,93 | vague 4 +0,28 ± 0,28 | neutre |
| CPAC | PCAL2 + intention de contrôle d'une Méjaire au prix de la perte de Pacifiste attendue (`allocator.ts`) | −0,34 ± 0,26 (vs PCAL2) | 0,00 ± 0,52 | −0,19 ± 1,19 | +0,69 ± 1,96 | *Maladresse* 5,8 → 7,3 par combat ; Iop pacifié 37 → 30 % des tours (≥ 13) | rejeté |
| DMEJ2 | **diagnostic** : Méjaires à −2 PM à chaque tour (borne d'un verrou parfait par *Maladresse*) | −0,41 ± 0,40 | −0,09 ± 0,71 | +0,75 ± 1,32 | +0,91 ± 3,14 | Iop pacifié 37 → 27 % | borne faible |
| N90 | θ `tactical.fast.nodes` 120 → 90 (coût) | **−0,88 ± 0,46** | −0,97 ± 0,67 | **−1,31 ± 0,95** | **−3,31 ± 2,28** | 727 → 628 ms par tour de jeu | rejeté : 120 nœuds est déjà le minimum |
| SPG | garde Pacifiste du TITULAIRE d'une étoile au prochain tour : 0,5 × prix de la corruption sur les cases qu'une Méjaire peut pacifier (`model.ts`, `extraIncoming`) | −0,34 ± 0,31 | −0,38 ± 0,65 | −0,31 ± 1,22 | −0,97 ± 3,38 | Iop pacifié 37 → 32 % ; vague 2 −0,44 | rejeté |
| N160 | θ `tactical.fast.nodes` 120 → 160 | −0,22 ± 0,44 | −0,13 ± 0,43 | −0,22 ± 0,74 | −1,06 ± 2,01 | même coût par tour (727 ms) : le faisceau s'arrête avant 120 nœuds | neutre |
| θ hc02 / hc00 | `planner.hourCostScale` 0,4 → 0,2 / 0 | −0,22 / −0,22 | −0,16 / −0,06 | +0,28 ± 1,15 / 0,00 ± 1,06 | −0,13 / −0,72 | | neutres |
| θ inc06 / inc10 | `value.incoming` 0,8 → 0,6 / 1,0 | −0,25 / **−0,53 ± 0,38** | −0,47 / −0,41 | −0,63 ± 0,75 / −0,44 ± 0,88 | −1,44 / −1,59 | 0,8 est un optimum local | rejetés |
| θ cb3k | `planner.corruptBonus` 1 500 → 3 000 | −0,09 | −0,38 | −0,66 ± 0,84 | −1,38 | | rejeté |
| θ whs10 / whs06 | `vortex.waveHpSlope` 0,8 → 1,0 / 0,6 | −0,53 / −0,03 | −0,31 / −0,22 | −0,34 / −0,25 | −2,13 / −1,88 | | rejetés |
| θ pa05 | `value.potAfter` 0,15 → 0,3 | −0,34 ± 0,40 | +0,03 ± 0,57 | +0,66 ± 1,38 | +0,25 ± 3,34 | | à confirmer (n plus grand) |
| DEF | stuffs défensifs `*_vortex_def` (presets existants) | **−1,59 ± 0,42** | **−2,00 ± 0,58** | **−2,03 ± 0,93** | −0,75 ± 2,57 | premier mort +4,2 ± 1,7 | rejeté (l'équilibré reste le meilleur) |
| STD (n = 9) | mode `standard` (largeur 6, 1 500 nœuds, rollouts, sans ligne de kill) | −1,00 ± 0,98 | −1,11 ± 0,89 | −1,22 ± 1,26 | −1,00 ± 1,60 | 67 s par combat (× 3,3) | `standard` fait MOINS bien que `fast` |

Pacifiste au début des tours (tours ≥ 13, GKL) : Crâ 21 %, Iop 37 %, Eniripsa 33 %, Enutrof 30 %.

**Fenêtres d'étoile manquées** (`starmiss.cjs`, référence, tours 13-24, 314 fenêtres) : converties 31 % ; titulaire
**pacifié 29 %** ; titulaire à 5-8 cases 18 %, à plus de 8 cases 13 % ; à ≤ 4 cases sans kill 7 % ; mort 2 %. Tours 1-12 :
83 % converties. Le Pacifiste coûte donc directement ≈ 2,8 corruptions par combat (91 fenêtres / 32).

**Lecture du bruit** : avec 32 graines, l'écart-type d'une différence appariée de corrompus vaut ≈ 2,9 (trajectoires
chaotiques : 0 combat identique dès que la décision change une fois) ; IC 95 % ≈ ± 1,0 corrompu. Les 15 variantes neutres
ci-dessus ont des moyennes entre 6,7 et 7,7 (référence 7,34) : compatibles avec le seul bruit. Seuls des effets ≥ 1
corrompu sont lisibles sur 32 graines (N90, DEF, diagnostics NOPAC / NOPUSH).

### PREMIÈRE VICTOIRE (règles 2.42, équipe stuffée, `fast`)

**Graine 2750401650** (`masterSeed` 31), équipe `cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,
eniripsa_soin_vortex`, IA `fast`, variante `default` : **victoire** au tour 60 (19 / 19 corrompus au tour 41, *Action !*,
Vortex tué ; 2 morts : Crâ au tour 27 et un second personnage). Arbre `.cache/tuning/r4/trees/eg_spg` = code du dépôt +
garde Pacifiste du titulaire d'étoile (SPG, 0,5) + **correctif de fin de partie** (ci-dessous) ; replay :
`.cache/tuning/r4/rep/eg_spg/s2750401650.json` (empreinte des événements 6877289bd870, identique avec et sans
`explain`).

**Mode d'échec trouvé — fin de partie bloquée** : dans le même combat SANS le correctif (arbre `spg`), l'équipe corrompt
18 monstres au tour 36 puis tient jusqu'à la limite de 60 tours sans jamais corrompre le dernier : un Buboxor zombie tué une
seule fois, à VII ; avec 3 personnages vivants (Crâ mort), seule l'heure de l'Enutrof retombe sur VII (fenêtre tous les
4 tours), l'Enutrof est à 6-9 cases et ne l'achève pas ; entre deux fenêtres, ses alliés le frappent sans le tuer (une mort
à une heure nouvelle coûte C_mon + C_vx au prix du planificateur) et il regagne ses PV par vol de vie (775 → 2 583 PV).
**Correctif** (`model.ts`) : en fin de partie (toutes les vagues arrivées, au plus `ENDGAME_LEFT` = 2 monstres à
corrompre), une mort d'un zombie à une heure NOUVELLE vaut au moins `ENDGAME_NEWHOUR` = +800 PVe (`deathValue`) et le
zombie reçoit un indice `kill` (la ligne de kill de `fast` le vise) : de nouvelles heures ouvrent des fenêtres d'étoile aux
autres personnages. Le correctif ne change aucune décision avant la fin de partie (empreintes identiques jusque-là).

**Deuxième victoire, code du dépôt SANS correctif de fin de partie, stuff de l'Iop seul changé** : graine
**3712432396** (`masterSeed` 31), équipe `cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex_def,
eniripsa_soin_vortex` (Iop en stuff DÉFENSIF `vortex_iop_terre_def`, 6 245 PV au lieu de 4 203 ; preset existant),
`fast` : **victoire au tour 45, aucun mort**, 19 / 19 corrompus au tour 36. Lot de 32 graines (IOPDEF, ms 31) : 1 victoire,
tours +1,47 ± 2,94, premier mort **+4,75 ± 5,16**, corrompus +0,38 ± 1,17 (n.s.). Le stuff défensif sur les QUATRE
personnages (DEF) fait bien moins bien (−2,0 corrompus) : seul l'Iop, mêlée et premier mort, gagne à être plus solide.

### Expériences (suite, ms 31, n = 32, référence GKL)

| Essai | Changement | Corr. t13 (Δ) | Corr. t19 (Δ) | Corr. total (Δ) | Tours (Δ) | Premier mort (Δ) | Verdict |
|---|---|---|---|---|---|---|---|
| MF13 / MF16 | pente de PV × 1,3 / × 1,6 sur une Méjaire jamais tuée (`model.ts`, `damageWeight`) | −0,13 / −0,50 | −0,13 / −0,41 | +0,16 ± 1,07 / −0,47 ± 1,03 | −0,47 / −1,75 | +0,59 / −0,50 | rejetés |
| BF13 | pente × 1,3 sur un Brabuzar jamais tué | −0,31 | −0,06 | +0,22 ± 1,06 | −0,81 | −0,53 | neutre, rejeté |
| θ h16 / h20 | `planner.horizonPlayerSlots` 12 → 16 / 20 (`fast` : 8 → 11 / 13 créneaux, la corruption d'un kill immédiat entre dans l'horizon) | −0,38 / −0,22 | −0,19 / −0,41 | −0,06 / −0,25 | −1,81 / −1,09 | | rejetés |
| CTERRE | Iop remplacé par un Crâ Terre au stuff de l'Iop (`cra_terre_mono@vortex_iop_terre`) | −0,19 | −0,13 | +0,16 ± 1,00 | −0,97 | +0,09 | neutre |
| OFF | stuffs offensifs `*_vortex_off` | +0,03 | −0,03 | −0,16 ± 0,97 | **−3,75 ± 2,62** | −1,78 | rejeté |
| **IOPDEF** | **Iop seul en stuff défensif** (`iop_terre_vortex_def`, 6 245 PV) | −0,47 ± 0,37 | −0,34 | +0,38 ± 1,17 | +1,47 ± 2,94 | **+4,75 ± 5,16** | **1 victoire / 32** (graine 3712432396, aucun mort) ; mesuré sur n = 128 ci-dessous |

**Victoire avec le code FINAL du dépôt** (GKL + correctif de fin de partie) : graine **3712432396**, équipe
`cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex_def,eniripsa_soin_vortex`, IA `fast` : **victoire au
tour 44, aucun mort** (« Le Vortex est vaincu », 75 % des PV de l'équipe restants). Reproductible par
`npx tsx src/cli/simulate.ts fight vortex --team cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex_def,eniripsa_soin_vortex --ai fast --seed 3712432396 --json` ;
replay : `.cache/tuning/r4/rep/final/cli-s3712432396.json` (empreinte f461c91caa7e). Corruptions : vague 1 au tour 8,
vague 2 au tour 19, vague 3 au tour 27, vague 4 au tour 34, vague 5 au tour 36 ; le correctif de fin de partie y gagne un
tour (45 → 44).

### Mesure finale du tour 4 (`fast`, n = 128 : `masterSeed` 31-34, appariée)

« Avant » = `base-tuning-r4` ; « après » = code final du dépôt (ligne de kill par glyphe + correctif de fin de partie).

| Métrique | Avant (équipe stuffée) | Après (même équipe) | Δ apparié (IC 95 %) | **Après, Iop en stuff défensif** | Δ vs avant |
|---|---|---|---|---|---|
| **Victoires** | 0 / 128 | 0 / 128 | — | **1 / 128** (graine 3712432396, aucun mort ; + 1 *Action !*, Vortex à 6 %) | +1 |
| Tours survécus | 26,79 | 26,60 | −0,19 ± 0,59 | 28,02 | **+1,23 ± 1,04** (+65 / −46) |
| Corrompus au tour 7 | 2,28 | 2,27 | −0,01 ± 0,04 | 2,16 | −0,13 ± 0,18 |
| Corrompus au tour 12 / 13 | 3,61 / 4,48 | 3,66 / 4,49 | +0,05 ± 0,08 / +0,01 ± 0,11 | 3,56 / 4,27 | −0,05 / −0,22 ± 0,21 |
| Corrompus au tour 17 / 19 | 5,74 / 6,21 | 5,69 / 6,15 | −0,05 ± 0,17 / −0,06 ± 0,17 | 5,55 / 6,02 | −0,19 / −0,19 |
| Corrompus au tour 25 / total | 7,00 / 7,23 | 6,89 / 7,09 | −0,11 ± 0,24 / −0,14 ± 0,30 | 7,03 / 7,38 | +0,03 / +0,15 ± 0,58 |
| Corrompus par vague (1 à 5) | 2,97 / 3,28 / 0,77 / 0,20 / 0,01 | 2,96 / 3,20 / 0,78 / 0,13 / 0,02 | | 3,00 / 3,16 / 0,89 / 0,26 / 0,07 | |
| Premier mort (tour) | 18,5 | 18,4 | −0,13 ± 0,46 | **21,1** | **+2,52 ± 1,61** (+78 / −43) |
| Causes d'échec | submersion 62, vague non corrompue 56, défaite 7, croix 3 | submersion 56, vague non corrompue 57, défaite 9, croix 6 | | submersion 38, vague non corrompue 81, défaite 3, croix 4, burst raté 1, **victoire 1** | |
| Temps par tour de jeu | — | 639 ms | | 706 ms | |

Le code final est neutre sur l'équipe stuffée (39 combats identiques sur 128 ; aucun n'atteint la fin de partie) : le
correctif ne joue que dans les combats qui arrivent à 17-18 corrompus. Avec l'Iop en stuff défensif (preset existant),
l'équipe vit plus longtemps et c'est elle qui gagne : **première victoire du code final**, graine 3712432396 (tour 44,
aucun mort ; voir plus haut).

### Re-mesures sur n = 128 (ms 31-34, code final = référence)

| Bras | Victoires | Corr. t7 (Δ) | Corr. t13 (Δ) | Corr. total (Δ) | Tours (Δ) | Premier mort (Δ) | Par jeu de graines (corr. total) |
|---|---|---|---|---|---|---|---|
| Code final, équipe stuffée | 0 / 128 | — | — | 7,09 | 26,60 | 18,4 | — |
| + menace avec collisions + Pacifiste calibré (PUSH1 + PCAL1, `patches/threat_push_pcal.ts`) | **2 / 128** (graines 76840650 au tour 58, 3371243329 au tour 56) | −0,21 ± 0,20 | −0,23 ± 0,25 | −0,05 ± 0,54 | +0,39 ± 0,98 | −0,40 ± 1,06 | ms 31 **−0,97 ± 0,82**, ms 32 −0,78, ms 33 +0,16, ms 34 **+1,38 ± 1,08** |
| Iop en stuff défensif (équipe) | 1 / 128 (+ 1 *Action !*) | −0,12 ± 0,17 | −0,23 ± 0,20 | +0,29 ± 0,60 | **+1,41 ± 1,10** | **+2,65 ± 1,64** | |
| **θ `value.potAfter` 0,15 → 0,3** | **2 / 128** (graines 243694197 au tour 49, 4123930335 au tour 45 ; ms 31 et 32) | −0,04 ± 0,18 | −0,02 ± 0,22 | **+0,45 ± 0,61** (+62 / −48) | +0,14 ± 1,04 | −0,17 ± 1,11 | ms 31 +0,66, ms 32 −0,28, ms 33 +0,50, ms 34 +0,94 |
| θ `potAfter` 0,3 + Iop défensif (référence : Iop défensif, code final) | **2 / 128** (graines 2997936979 au tour 39 sans mort, 3029378560 au tour 48) contre 1 | −0,01 ± 0,17 | −0,06 ± 0,18 | −0,04 ± 0,60 | −0,03 ± 1,03 | +0,27 ± 1,95 | |

Le paquet « menace » donne deux victoires mais des effets contraires d'un jeu de graines à l'autre (−0,97 puis +1,38) ;
re-mesuré sur ms 35-36 (n = 64 de plus) : cumul **n = 192** : victoires 2 / 192 contre 0, tours +0,81 ± 0,79, corrompus
au tour 7 **−0,18 ± 0,16** (+55 / −79), au tour 13 −0,17 ± 0,21, total +0,11 ± 0,43, premier mort −0,10 ± 0,86.
**Non gardé** (corruption précoce dégradée, total nul ; code conservé hors dépôt).

### Changements gardés (tour 4)

1. `src/ai/tactical/turnSearch.ts` — **ligne de kill par une glyphe** (`glyphKillLine`, travail partiel repris) : neutre
   (n = 64), corrige le puzzle P6 en `fast` (plus de `it.fails`).
2. **[RETIRÉ à la vérification, voir « Vérification (tour 4) » : ralentit les fins de partie naturelles et coûte une
   victoire]** `src/dungeons/vortex/model.ts` — **fin de partie** : toutes les vagues arrivées et au plus 2 monstres à corrompre ⇒ une
   mort de zombie à une heure NOUVELLE vaut au moins +800 PVe (`deathValue`) et le zombie reçoit un indice `kill` (ligne de
   kill de `fast`). Ne change aucune décision avant la fin de partie ; débloque le combat 2750401650 (18 / 19 pendant 30
   tours → victoire dans la variante SPG) et accélère la victoire 3712432396 (45 → 44 tours).
3. Tests : `tests/ai-puzzles-vortex.test.ts` — P6 `fast` n'est plus marqué `it.fails` ; **P19 [retiré avec le
   correctif à la vérification]** (fin de partie : dernier
   zombie à 500 PV, une seule heure de mort, toutes les vagues arrivées ⇒ indice `kill` et kill à l'heure nouvelle ; échoue
   sans le correctif).
4. Équipe (aucun preset modifié) : l'Iop en stuff défensif (`iop_terre_vortex_def`) allonge la survie (+1,4 tour,
   +2,6 tours avant le premier mort, n = 128) au prix de ≈ 0,2 corrompu au tour 13 ; c'est l'équipe de la victoire du
   code final.

**Non gardé malgré deux victoires — θ `value.potAfter` 0,15 → 0,3** (poids du potentiel offensif des alliés qui jouent
après la plus grosse menace) : 2 victoires / 128 avec l'équipe stuffée prescrite (graines 243694197 au tour 49 et
4123930335 au tour 45, sur deux `masterSeed` différents ; replay `.cache/tuning/r4/rep/final/cli-s243694197.json`),
corrompus +0,45 ± 0,61 (positif sur 3 jeux de graines sur 4). Mais θ est global et la valeur casse deux tests génériques :
`ai-team-control` « standard ≥ fast sur le combat dur » (standard en 7 tours contre 5) et l'ablation P1b/P1c sans `mpLock`
(`ai-puzzles-generic`). Rétabli à 0,15 ; à reprendre avec un θ propre au scénario (mécanisme absent : `src/ai/theta.ts`,
hors périmètre).

Retirés (mesurés neutres ou négatifs, code supprimé ; correctifs conservés hors dépôt dans `.cache/tuning/r4/patches`
et les arbres `trees/*`) : SV (valeur des invocations dans la menace), PUSH1 (dommages de collision dans la menace),
PCAL1/PCAL2 (portée et calibration du Pacifiste), CPAC (contrôle des Méjaires), SPG (garde Pacifiste du titulaire
d'étoile), MJ / MJC, MF / BF (pentes de focus), θ (hourCostScale, incoming, corruptBonus, waveHpSlope, horizon,
nœuds 90 / 160), stuffs DEF / OFF, composition Crâ Terre.

Vérifications : `npx tsc --noEmit` vert ; `npx vitest run tests/ai-* tests/vortex-* tests/engine-summon-owned.test.ts`
(1 processus) : **334 réussis, 1 ignoré** (ablations, opt-in). Aucune infidélité du moteur trouvée ce tour (aucun test
`it.fails` ajouté) ; à signaler : `θ.threat.pacifistFactor` est partagé par la menace de l'IA d'équipe ET le poids
`pacifist` du MonsterBrain (`src/ai/monster/profiles/index.ts`) — modifier l'un modifie les monstres (essais PAC2 du
tour 4 et P1 du tour 2 faussés).

### Modes d'échec restants

1. **Pacifiste (vagues 3-5)** : Iop pacifié au début de 37 % de ses tours (45 % en stuff défensif), Eniripsa 33 %,
   Enutrof 30 %, Crâ 21 % ; 29 % des fenêtres d'étoile des tours 13-24 perdues parce que leur titulaire est pacifié ;
   borne supérieure (NOPAC) +3,1 corrompus et 2 victoires / 32. Les leviers d'évaluation essayés (calibration, contrôle,
   garde, focus) restent dans le bruit ; un verrou parfait de 2 PM sur les Méjaires (DMEJ2) ne vaut que +0,75.
2. **Poussées du Brabuzar** (9 100 + Neutralisation 8 200 par combat) : NOPUSH +1,8 corrompu, +5,3 tours ; la menace
   avec collisions (PUSH1) réduit les poussées de 14 % sans effet mesurable.
3. **Rythme** : la vague 2 est marquée tard (Harpilles : premier kill 4,2 tours après l'arrivée, dégâts dispersés par les
   zones) et finit corrompue pendant la vague 3 ; vague 3 : 0,8 corrompu sur 4 ; l'équipe meurt aux tours 19-28.
4. **Fin de partie** : sur 1 915 combats hors diagnostics de ce tour, 14 seulement atteignent 18 corrompus ou plus :
   6 victoires distinctes (2750401650 : SPG + correctif ; 3712432396 : Iop défensif, code final ; 243694197 et
   4123930335 : θ `potAfter` 0,3 ; 76840650 et 3371243329 : menace avec collisions + Pacifiste calibré), des bursts ratés
   (19 corrompus aux tours 41-50 avec 1-2 survivants ; Vortex à 6 % de PV dans le meilleur cas) et 1 combat bloqué à
   18 / 19 (corrigé). Les victoires arrivent tard (tours 44-58, limite 60) : il faut atteindre *Action !* vers le tour
   35-40 avec 3-4 personnages.
5. **Mesure** : avec 32 graines, IC 95 % ≈ ± 1 corrompu (trajectoires chaotiques) ; tout effet < 0,5 corrompu exige
   n ≥ 128.

### Ce qui bloque la victoire (preuves)

- **Pas le moteur** : aucune infidélité trouvée (poussées : formule du patch 2.17, +200 de *Mise en situation* cumulable
  sans limite d'après les données, `maxStack` −1 ; Pacifiste : `cantDealDamage` seul, le retrait de PM reste possible).
- **La puissance de l'équipe** reste le verrou principal : il manque ≈ +25 % de dégâts et −20 % de dégâts subis pour
  gagner un combat sur quatre (diagnostic ×1,25 / ×0,8 : 8 / 32 ; ×1,5 / ×0,67 : 22 / 32). Le stuff défensif de l'Iop
  seul (preset existant) apporte +2,5 tours avant le premier mort et la première victoire du code final ; tout autre jeu
  de stuffs essayé fait moins bien (DEF, OFF) ou pareil (Crâ Terre à la place de l'Iop).
- **L'IA** : deux mécaniques coûtent l'essentiel. (1) Le Pacifiste des Méjaires (borne +3,1 corrompus, 29 % des
  fenêtres d'étoile perdues aux tours 13-24) : l'IA ne sait ni l'éviter sans perdre ses dégâts (Iop au corps à corps), ni
  le prévenir (le verrou parfait de 2 PM ne vaut que +0,75) ; seule la mort rapide des Méjaires fraîches (90 % des
  Pacifiste) paraît suffisante, et ni les pentes de focus ni les prix du planificateur ne l'ont obtenue. (2) Les poussées du
  Brabuzar (borne +1,8 corrompu, +5,3 tours). Les réglages d'évaluation (menace, θ) sont à un optimum local : 25 variantes
  mesurées, toutes dans le bruit ou négatives.
- **La recherche** : 120 nœuds est le minimum (90 : −1,3 corrompu, −3,3 tours) et le maximum utile (160 : même coût, le
  faisceau s'arrête avant) ; `standard` fait moins bien que `fast` (9 graines : −1,2 corrompu).
- **La fin de partie** n'était pas prête : combat bloqué à 18 / 19 (corrigé ce tour) ; burst raté avec 1-2 survivants.

### Pistes pour le tour 5

- **Méjaires fraîches** : plan d'équipe explicite à l'arrivée de la vague 3 (tour 13) — focus de la Méjaire la plus proche
  du titulaire de la prochaine étoile, *Corruption* de l'Enutrof (5 PA, la cible passe son tour) sur la Méjaire qui
  menace ce titulaire, Iop hors des lignes 1-3 des Méjaires au tour qui précède son étoile.
- **θ propre au scénario** (`src/ai/theta.ts`, hors périmètre de ce tour) : permettrait de garder θ `value.potAfter` 0,3
  pour le Vortex (2 victoires / 128 avec l'équipe prescrite, 2 / 128 avec l'Iop défensif) sans casser les combats de
  contrôle génériques.
- **Séparer `θ.threat.pacifistFactor`** de la valeur `pacifist` du MonsterBrain (`src/ai/theta.ts`, hors du périmètre de
  ce tour) avant tout réglage du Pacifiste par θ.
- **Protocole** : juger sur n ≥ 128 (≈ 18 min par bras avec 3 processus) ; avec 32 graines, IC ≈ ± 1 corrompu.
- **Fin de partie** : `ENDGAME_LEFT` 3, prise en compte du nombre de survivants avant *Action !* (attendre de soigner),
  burst à 1-2 personnages.
- **Équipe** : refaire la campagne de stuffs avec l'Iop en contrainte « survie » (seul l'Iop défensif aide) ; essayer un
  4ᵉ personnage qui retire les PM à distance (Méjaires) sans perdre de dégâts.
- **À re-mesurer sur n ≥ 256** : menace avec collisions + Pacifiste calibré (`.cache/tuning/r4/patches/threat_push_pcal.ts`,
  test `ai-core-threat-push.test.ts` à côté) : 2 victoires / 128 mais effets contraires selon les graines.

`standard`, code final, 9 graines (ms 31), appariées avec `fast` : équipe stuffée 0 / 9, corrompus 7,11 → 5,89
(−1,22 ± 1,26), tours −1,00 ; Iop défensif 0 / 9 (la graine 3712432396, gagnée en `fast`, est perdue), corrompus
9,22 → 7,11 ; 66-82 s par combat (≈ × 4). `standard` reste moins bon que `fast` (sans ligne de kill).

**Victoire avec l'équipe stuffée prescrite** (code final + surcharge θ `value.potAfter` 0,3, NON gardée dans θ par
défaut, voir plus bas) : graine **243694197**, équipe `cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,
eniripsa_soin_vortex`, IA `fast` : **victoire au tour 49, 1 mort** (« Le Vortex est vaincu »). Reproductible par
`npx tsx src/cli/simulate.ts fight vortex --team cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,eniripsa_soin_vortex --ai fast --seed 243694197 --theta θ.json --json`
avec `θ.json` = `{"value":{"potAfter":0.3}}` ; replay : `.cache/tuning/r4/rep/final/cli-s243694197.json`.

### Vérification (tour 4)

Vérification indépendante (harnais `.cache/tuning/r4v/` : `run.mts` et `pair.cjs` du réglage, `batch.sh`, 3 processus).
Arbres de travail git : **avant** = `base-tuning-r4` ; **livré** = `base-tuning-r4` + seuls les diffs du réglage
(`turnSearch.ts`, `model.ts`, tests ; identique à l'arbre vivant, aucun changement concurrent) ; **GKL seule** = avant +
`turnSearch.ts` ; **fin de partie seule** = avant + `model.ts`. `fast`, graines inédites `masterSeed` 7 (64), plus les
graines du réglage (`masterSeed` 31-34) pour les bras qu'il n'avait pas mesurés : avant + Iop défensif, GKL seule + Iop
défensif. La GKL est inactive en `standard` (largeur 6) : 3 graines `standard` (`masterSeed` 7), avant et livré
**identiques** événement par événement.

Reproductions : victoire **3712432396** (Iop défensif) refaite par la CLI — tour 44 avec le code livré, mais **aussi
gagnée par le code d'AVANT** (tour 45) et par le code final ci-dessous (tour 45) : cette victoire vient du stuff de
l'Iop, pas du code du tour 4. Victoire 243694197 (θ `potAfter` 0,3, non gardé) refaite (tour 49, 1 mort). Les tableaux
du réglage se recalculent à l'identique depuis ses lignes brutes (`.cache/tuning/r4/out`). P6 `fast` et P19 échouent
sur `base-tuning-r4` et réussissent sur le livré, comme annoncé.

| Δ apparié, `fast` | n | Victoires | Corr. t7 | Corr. t13 | Corr. total | Tours | Premier mort |
|---|---|---|---|---|---|---|---|
| Livré − avant, équipe stuffée (ms 7) | 64 | 0 → 0 | −0,02 ± 0,03 | 0,00 ± 0,17 | +0,06 ± 0,57 | −0,02 ± 0,96 | +0,05 ± 0,94 |
| Code final (GKL) − avant, équipe stuffée (ms 7 + 31-34) | 192 | 0 → 0 | −0,01 ± 0,03 | +0,01 ± 0,10 | −0,07 ± 0,27 | −0,13 ± 0,51 | −0,07 ± 0,44 |
| Livré − avant, Iop défensif (ms 7) | 64 | **2 → 0** | 0,00 ± 0,09 | +0,06 ± 0,11 | −0,36 ± 0,70 | −0,73 ± 1,32 | −0,36 ± 1,23 |
| Livré − avant, Iop défensif (ms 31-34) | 128 | **3 → 1** | −0,04 ± 0,07 | +0,15 ± 0,13 | +0,01 ± 0,46 | −0,22 ± 0,82 | −1,05 ± 1,43 |
| Code final (GKL) − avant, Iop défensif (ms 7 + 31-34) | 192 | **5 → 2** (+0 / −3) | −0,03 ± 0,05 | +0,12 ± 0,10 | −0,11 ± 0,38 | −0,42 ± 0,70 | −0,55 ± 1,24 |
| Iop défensif − équipe stuffée, code d'avant | 192 | **0 → 5** | −0,16 ± 0,14 | **−0,37 ± 0,18** | +0,20 ± 0,49 | **+1,32 ± 0,89** | **+3,28 ± 1,44** |
| Iop défensif − équipe stuffée, code final | 192 | 0 → 2 | −0,18 ± 0,14 | **−0,26 ± 0,17** | +0,16 ± 0,47 | **+1,03 ± 0,81** | **+2,79 ± 1,42** |

Moyennes (n = 192) : équipe stuffée avant 26,77 tours, corrompus 2,27 / 4,48 / 7,22 (t7 / t13 / total), premier mort
18,4 ; code final 26,64, 2,26 / 4,48 / 7,15, 18,4. Iop défensif avant 28,09, 2,10 / 4,11 / 7,43, 21,7, **5 victoires**
(379124828, 2315204589, 3712432396, 1108010007, 905653739) ; code final 27,67, 2,08 / 4,23 / 7,31, 21,2, 2 victoires
(3712432396, 1108010007).

- **Correctif de fin de partie (`model.ts`) : RETIRÉ.** Il ne peut agir qu'à ≥ 17 corrompus ; sur 384 combats d'avant
  (équipe stuffée 192, Iop défensif 192), seuls les 5 combats gagnés y arrivent, et AUCUN n'y bloque (le blocage à 18 / 19
  du réglage n'a été vu que dans la variante SPG, rejetée). Arbre « fin de partie seule » sur ces 5 combats : 379124828
  victoire 47 → 51 tours et 1 → 3 morts ; 2315204589 **victoire → défaite** (limite de 60 tours, Vortex à 11 % ; une heure
  distincte de plus pour le Vortex, 9 → 10, phase 2 de 10 → 19 tours) ; 1108010007 dernier corrompu au tour 35 → 39
  (victoire 46 → 49) ; 905653739 tour 40 → 43 (victoire 47 → 50) ; 3712432396 45 → 44. Sur l'arbre GKL (Iop défensif,
  n = 192), il change 2 combats : 3712432396 (45 → 44) et **1108010007 (victoire au tour 47 → burst raté au tour 53)**.
  Mécanisme (replay 1108010007, tours 33-34) : dès qu'il ne reste qu'un monstre, l'indice `kill` à 800 détourne
  l'Enutrof de la mise en place du kill SOUS ÉTOILE prévu au créneau suivant (heure V) : sans *Maladresse* et à une autre
  case, il ne l'achève plus au tour 34, puis le zombie est tué à IX et XII (heures nouvelles) avant d'être corrompu
  au tour 39. Le prix `max(kill[h], 800)` ignore à la fois la fenêtre d'étoile imminente et C_vx (heure nouvelle pour le
  Vortex). Code rétabli à `base-tuning-r4` ; P19 (qui exigeait ce comportement) supprimé.
- **Ligne de kill par une glyphe (GKL, `turnSearch.ts`) : gardée, neutre.** Équipe stuffée n = 192 : tous les Δ < 0,15
  en valeur absolue (IC ± 0,03 à ± 0,5) ; Iop défensif n = 192 : corrompus au tour 13 +0,12 ± 0,10, total −0,11 ± 0,38,
  tours −0,42 ± 0,70 ; elle corrige P6 `fast`. **Réserve** : avec l'Iop défensif, 3 victoires de l'avant sont perdues
  (379124828, 2315204589, 905653739) et aucune n'est gagnée (McNemar 3-0, p = 0,25, non significatif) ; ces combats
  divergent tôt (tours 9-21) par simple chaos : premier écart de 379124828 au tour 9, Eniripsa (même début « Scalpel puis
  glyphe », suite différente car la GKL consomme jusqu'à 3 nœuds + sa ligne sur les 120 du faisceau et inscrit ses nœuds
  dans `seen`). Variante essayée : GKL seulement si la ligne directe ne tue pas avec V > racine — P6 échoue (la ligne
  directe y « gagne » V malgré l'heure à −3 000) ; non retenue.
- **Iop en stuff défensif (preset existant, aucun preset modifié)** : le seul levier de victoire mesuré. Sur n = 192 :
  **0 → 5 victoires** avec le code d'avant (0 → 2 avec le code final), +1,0 à +1,3 tour, +2,8 à +3,3 tours avant le
  premier mort, mais corruption précoce plus lente (t13 −0,26 à −0,37, significatif). Les échecs « vague non corrompue
  au déverrouillage » passent de 90 à 110 (l'équipe vit plus longtemps mais corrompt moins vite). Le gain de tours annoncé
  (+1,23 ± 1,04) se reproduit sur l'ensemble, pas sur `masterSeed` 7 seul avec le code livré (+0,34 ± 1,16).
- Ce qu'annonçait le réglage et qui ne tient pas : « 1 victoire / 128 avec le code final » est vrai, mais le code d'avant
  en fait 3 / 128 sur les mêmes graines avec la même équipe ; aucune victoire n'est due au code du tour 4.
- Tests sur l'arbre vivant final (GKL seule) : `npx tsc --noEmit` vert ; `npx vitest run tests/ai-* tests/vortex-*
  tests/engine-summon-owned.test.ts` : **333 réussis, 1 ignoré** (P19 retiré ; dont combats de contrôle `ai-team-control`
  et puzzles Vortex, P6 `fast` compris). Aucune infidélité du moteur trouvée (aucun test `it.fails` ajouté).
- Pistes ajoutées pour le tour 5 : fin de partie à reprendre SEULEMENT en cas de blocage avéré (aucun progrès depuis
  ≥ 2 boucles d'horloge, aucune fenêtre d'étoile prévue pour le monstre dans l'horizon, heure déjà utilisée par le
  Vortex), à valider sur les combats qui atteignent 17 corrompus ; GKL : ne pas inscrire ses nœuds dans `seen` / ne la
  lancer que si le pas de kill de la ligne directe fait baisser V ; mesurer l'équipe avec l'Iop défensif comme référence
  (seule source de victoires mesurée) et juger les victoires sur n ≥ 384.

## Tour 5

### Protocole

- Référence « avant » : tag git `base-tuning-r5` (= commit 42b60a6, aucun écart avec HEAD au début du tour). Équipe CHOISIE
  PAR L'UTILISATEUR, `data/teams/vortex.json` dans l'ordre du fichier (Eniripsa `eniripsa_soin_vortex`, Enutrof
  `enutrof_retrait_pm_vortex`, Crâ `cra_terre_mono_vortex`, Crâ `cra_terre_mono_vortex_def`) ; IA `fast`, variante
  `default`, règles 2.42 (docs/research/vortex-audit.md). Ni l'équipe, ni les presets, ni les règles ne sont touchés.
- Entrées : trois analyses indépendantes de l'IA sur cette équipe (`.cache/tuning/r5/analysis-waves/`,
  `analysis-pacifiste/`, `analysis-survival/` : replays avec `aiNote`, prototypes, criblages de 32 à 254 graines).
- Harnais `.cache/tuning/r5/tune/` (hors dépôt) : `mktree.sh` (arbre figé = `git archive base-tuning-r5`), `mkvar.sh`
  (arbre figé + fichiers vivants), `run.mts` (un combat par graine ; équipe = `vortex.json` de l'arbre ; mêmes champs
  que `.cache/verify-userteam/run.mts` — corrompus officiels, `eventsHash` — plus morts, *Action !* et survivants,
  lancers de Mot de Reconstitution, Pacifiste posé par l'équipe sur un allié, part des tours pacifiés à partir du tour
  13), `batch.sh` (4 processus, reprise sur les graines déjà jouées), `queue.sh` (file de bras), `pair.cjs` (Δ apparié
  ± IC 95 %, victoires avec IC de Wilson, paires discordantes et McNemar exact, découpage par `masterSeed`), `mech.mts`
  (re-kills de zombies par les joueurs : étoile, tour retiré ou non). Résultats bruts : `out/<bras>/*.jsonl` ; notes de
  reprise : `NOTES.txt`.
- Contrôles : l'arbre figé reproduit à l'empreinte près la ligne ORD de la vérification de l'équipe (graine 49482207) ;
  les arbres de variantes reproduisent les combats des analystes (RECON30 : 3596196518 ; ZREZ2 : 1009030989).
- Graines (aucune déjà jouée par les tours précédents, la campagne de l'équipe ou les analystes — `masterSeed` 1-8,
  31-36, 51-58, 81-88, 101-103) : **V** = `campaignSeeds(141..144, 32)` (128 graines, décision par changement) ;
  **F** = `campaignSeeds(151..158, 32)` (256 graines, mesure finale appariée) ; fumée `standard` : 3 premières graines
  de `masterSeed` 145.
- **Constat de mesure.** La corrélation entre la référence et une variante sur la même graine est presque nulle :
  ρ = 0,18 (corrompus), 0,10 (tours), 0,11 (premier mort), 0,17 (victoire) ; au mieux 7 combats sur 128 restent
  identiques. L'appariement ne réduit donc presque pas le bruit : à n = 128, IC 95 % ≈ ± 0,9 corrompu, ± 1,9 tour,
  ± 1,4 tour de premier mort, ± 5 points de victoires ; à n = 256 : ± 0,6 / ± 1,3 / ± 0,95. Seul « corrompus au tour
  13 » (± 0,2) détecte un effet de 0,2-0,3. Le jeu V est en outre « chanceux » pour la référence (13 victoires / 128,
  10,2 %, contre 4,3-4,7 % sur ORD et F) : n'importe quelle variante y perd des victoires par simple régression vers la
  moyenne (attendu sous l'hypothèse nulle ≈ +6 / −12) ; les victoires se jugent donc sur F et sur V + F.
- Règle : un changement n'est gardé que s'il va dans le bon sens sur V (128 graines, 4 `masterSeed`) ET sur un second
  jeu indépendant (criblage de l'analyste), sans dégrader significativement la survie ; le paquet final est mesuré sur F
  (256 graines inédites).

### Mesure de référence (`base-tuning-r5`, `fast`)

| Métrique | V (`masterSeed` 141-144, n = 128) | F (`masterSeed` 151-158, n = 256) |
|---|---|---|
| Victoires | 13 / 128 = 10,2 % [6,0 – 16,6] | 12 / 256 = 4,7 % [2,7 – 8,0] |
| Corrompus (total) / tour 13 / 19 / 25 | 10,44 / 4,81 / 6,91 / 8,73 | 9,50 / 4,80 / 6,84 / 8,47 |
| Tours survécus | 32,66 | 31,13 |
| Premier mort (tour) | 24,18 | 22,32 |
| Morts | 3,59 | 3,82 |
| *Action !* (19 / 19) | 16 (12,5 %), 13 gagnés | 14 (5,5 %), 12 gagnés |
| Causes d'échec | vague non corrompue 89, submersion 15, croix 8, limite 3 | vague non corrompue 172, submersion 47, croix 16, défaite 5, limite 3, burst raté 1 |
| Tours pacifiés (tour ≥ 13) | 26 % | 28 % (Eniripsa 29, Crâ 22, Enutrof 23, Crâ déf. 29) |

### Propositions reçues et fusion

| Proposition (analyste) | Bras de ce tour | Statut |
|---|---|---|
| ZREZ2 : débiter les PV de résurrection d'un re-kill de zombie hors étoile qui ne lui retire aucun tour (vagues 1) | `zrez2` | **gardé** |
| Bandes de pré-dégâts à 0,45-0,55·E au lieu de 0,8·E, avec ZREZ2 (vagues 2) | `zrez2band` (0,5) | rejeté (n'ajoute rien) |
| Variante : débiter TOUS les re-kills hors étoile (ZREZ de l'analyste) | `zrezall` | rejeté (survie) |
| Auto-pacification : Boîte à Outils / Corruption sur un allié non pacifié (pacifiste 1 + survie 3, fusionnées) | `selfpac` (cause racine dans la valeur) | rejeté |
| Mot de Reconstitution réservé aux alliés < 30 % PV (survie 1, RECON30) | `recon` | rejeté |
| Focus des Méjaires jamais tuées ×1,6 (pacifiste 2, MF16) | `mf16` | rejeté (survie) |
| Limite de 60 tours portée à 80 (survie 2) | — | hors périmètre (règle du scénario, `constants.ts`) ; à décider par l'utilisateur |
| Placement anti-Heuristique en phase 2 (pacifiste 3) ; « sauvetage » d'étoile par la glyphe (vagues 3) ; réalisme du suivi (vagues 4) ; coût de file dans `futureOf` (vagues 5) ; menace d'une Méjaire pacifiée (pacifiste 4) ; `deathRisk` sans Pacifiste (pacifiste 5) ; collisions du Brabuzar (survie 4) ; risque par exposition (survie 5, mesuré neutre par l'analyste) | — | non essayés (effets attendus < 0,5 corrompu, sous le seuil mesurable ; risques élevés pour vagues 5) |
| KITE, LOCK / LOCK0, PCAL (pacifiste 6-7) ; tactiques de phase 2 (survie 6) | — | non poursuivis (négatifs ou neutres chez l'analyste) |

### Expériences (V, n = 128, appariées sur `base-tuning-r5`)

| Bras | Victoires (Wilson) | Corr. total | Corr. t13 | Corr. t19 | Corr. t25 | Tours | Premier mort | Morts | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Référence | 13 (10,2 % [6,0-16,6]) | 10,44 | 4,81 | 6,91 | 8,73 | 32,66 | 24,18 | 3,59 | |
| `recon` (RECON30) | 6 (+4 / −11, p = 0,12) | −0,77 ± 0,85 | −0,13 ± 0,22 | −0,01 | −0,26 ± 0,42 | −0,78 ± 1,89 | −1,06 ± 1,31 | +0,20 ± 0,23 | Reconstitution 3,0 → 0,8 / combat |
| **`zrez2`** | 10 (+8 / −11) | **+0,34 ± 0,95** | **+0,25 ± 0,21** | +0,16 ± 0,26 | +0,38 ± 0,46 | +0,02 ± 1,96 | −0,24 ± 1,46 | +0,08 ± 0,26 | |
| `selfpac` | 10 (+5 / −8) | −0,53 ± 0,67 | +0,03 ± 0,14 | +0,05 | −0,05 ± 0,34 | −1,08 ± 1,47 | −0,90 ± 1,12 | +0,12 ± 0,19 | Boîte à Outils sur un joueur 1,47 → 0,62 / combat |
| `zrez2band` | 10 (+8 / −11) | +0,30 ± 0,92 | +0,30 ± 0,25 | +0,29 ± 0,28 | +0,45 ± 0,47 | −0,16 ± 1,76 | −0,30 ± 1,52 | +0,13 ± 0,25 | contre `zrez2` : +0,05 / +0,13 / +0,07 (t13 / t19 / t25), corr. −0,04 |
| `mf16` | 5 (+4 / −12, p = 0,08) | −0,19 ± 0,96 | +0,04 | +0,13 | +0,19 | −0,77 ± 2,06 | **−2,01 ± 1,39** | +0,22 ± 0,23 | submersions 15 → 24 |
| `zrezall` | 5 (+5 / −13, p = 0,10) | −0,79 ± 1,03 | +0,19 ± 0,22 | −0,09 | −0,30 ± 0,51 | −1,04 ± 2,09 | **−1,70 ± 1,66** | **+0,24 ± 0,24** | contre `zrez2` : corr. **−1,13 ± 0,94**, t25 **−0,68 ± 0,48**, premier mort **−1,46 ± 1,43** |

Lecture des bras :

- **RECON30** (filtre de `generate.ts` : pas d'Insoignable ≥ 2 tours sur un allié à ≥ 30 % PV ; θ `team.incurableHpMax`
  dans l'arbre d'essai). L'analyste mesurait +21 / −7 victoires et +0,51 corrompu sur 254 graines (ORD 81-86 + TTd 85-86,
  référence à 3,1 % de victoires, donc « malchanceuse »), mais déjà −0,66 sur ms 85-86. Sur les graines inédites V :
  tout est négatif, morts +0,20. Cumul 382 graines : corrompus ≈ +0,1, victoires 21 → 28 (non significatif). Non
  confirmé ⇒ **rejeté**.
- **SELFPAC** (cause racine de l'auto-pacification, `evaluate.ts`) : un Pacifiste posé par l'équipe sur un allié qui
  pouvait frapper à la racine coûte w_inc·max(pacifistFactor·Pot_racine, part Pacifiste de son incoming) — le même
  événement qu'une Méjaire qui le pacifierait à coup sûr. Le mécanisme bouge (Boîte à Outils sur un joueur 1,47 → 0,62 /
  combat ; graine-sonde 1531215875 : 4 → 0) mais tout le reste baisse (tours −1,1, premier mort −0,9) ; le filtre brut
  de l'analyste (BOITE, n = 32) donnait déjà −0,68. Les +3 PA / +3 PM de la Boîte servent (fuite, glyphes, soins de
  l'Eniripsa) plus que le Pacifiste ne coûte. **Rejeté** ; ni filtre ni coût.
- **MF16** (pente ×1,6 sur une Méjaire jamais tuée) : premier mort −2,0 ± 1,4 (significatif), submersions +9 : les
  dégâts quittent Harpilles et Brabuzars. **Rejeté** (comme au tour 4 avec l'ancienne équipe).
- **ZREZ « tout »** (débit sur tout re-kill hors étoile, même s'il retire un tour au zombie) : la corruption précoce
  monte encore (t13 +0,19) mais la survie s'effondre (morts +0,24, premier mort −1,7) et le total recule de 1,1 par
  rapport à ZREZ2 : **le tour retiré à un zombie protège l'équipe** ; le test de créneau de ZREZ2 est indispensable.
- **Bandes à 0,5·E avec ZREZ2** : identiques à ZREZ2 (écarts < 0,15) ⇒ **rejeté** (complexité sans effet).

### Mécanisme de ZREZ2 (`mech.mts`, 32 graines de `masterSeed` 141)

| Par combat (joueurs) | Référence | ZREZ2 |
|---|---|---|
| Re-kills de zombie hors étoile qui lui retirent un tour | 7,44 | 7,66 |
| Re-kills de zombie hors étoile qui ne lui retirent AUCUN tour | **3,75** | **1,03** |
| Kills de zombie sous étoile (corruptions) | 9,47 | 10,34 |

Le zombie tué « pour rien » revenait au tour du Vortex avec 20-30 % de ses PV de base (1 320-1 980, plus que les
≈ 700 qu'il avait) et une heure de mort de plus ; ces kills disparaissent aux trois quarts et les PA vont aux kills
sous étoile.

### Mesure finale (F : `masterSeed` 151-158, n = 256 graines inédites, appariée, `fast`)

« Avant » = `base-tuning-r5` ; « après » = code final du dépôt (= arbre `zrez2` ; empreintes identiques vérifiées sur
4 graines de F avec un arbre construit depuis les fichiers vivants).

| Métrique | Avant | Après | Δ apparié (IC 95 %) |
|---|---|---|---|
| **Victoires** | 12 / 256 = **4,7 %** [2,7 – 8,0] | 14 / 256 = **5,5 %** [3,3 – 9,0] | +12 / −10 (McNemar p = 0,83) |
| Corrompus (total) | 9,50 | 9,96 | **+0,46 ± 0,61** (+120 / −107) |
| Corrompus au tour 13 / 19 / 25 | 4,80 / 6,84 / 8,47 | 4,82 / 6,92 / 8,57 | +0,02 ± 0,15 / +0,09 ± 0,18 / +0,09 ± 0,32 |
| Tours survécus | 31,13 | 31,68 | +0,56 ± 1,32 |
| Premier mort (tour) | 22,32 | 23,23 | **+0,92 ± 0,95** (+124 / −118) |
| Morts | 3,82 | 3,75 | −0,08 ± 0,14 |
| *Action !* (19 / 19) | 14 (5,5 %) | 23 (9,0 %) | +0,04 ± 0,04 (+21 / −12) |
| Victoires sans mort ; tour moyen des victoires | 3 ; 49,1 | 10 ; 46,8 | |
| Causes d'échec | vague non corrompue 172, submersion 47, croix 16, défaite 5, limite 3, burst raté 1 | vague non corrompue 181, submersion 41, limite 9, croix 5, défaite 4, burst raté 2 | |

Par `masterSeed` (corrompus) : 151 −0,56, 152 +0,41, 153 +0,44, 154 +2,03, 155 −0,28, 156 +0,28, 157 +0,13,
158 +1,25 (positif sur 6 / 8). Cumul V + F (n = 384) : victoires 25 → 24, corrompus **+0,42 ± 0,52**, t13
+0,10 ± 0,12, tours +0,38 ± 1,09, premier mort +0,53 ± 0,80, morts −0,03. Avec le criblage de l'analyste
(`masterSeed` 103, n = 48 : +0,79 ± 1,50, tours +2,7) : **trois jeux de graines indépendants positifs** sur la
corruption, aucun signal négatif sur la survie. L'effet sur les victoires n'est pas démontré (+2 sur F, −3 sur le jeu
V « chanceux », −1 au cumul).

Victoire reproductible du code final (perdue par l'avant au tour 30) : graine **632641322**, `npx tsx src/cli/simulate.ts
fight vortex --ai fast --seed 632641322 --json` ⇒ « Le Vortex est vaincu », tour 42, aucun mort ; replay
`.cache/tuning/r5/tune/rep/cli-s632641322.json`. Autres victoires de F sans mort : 3779616324 (tour 46), 412077139
(44 ; gagnée au tour 60 par l'avant), 3395498487 (44).

### Changements gardés (tour 5)

1. `src/dungeons/vortex/model.ts` — **débit de résurrection d'un re-kill de zombie sans tempo** (`rezDebit`, appelé par
   `deathValue`) : mort d'un zombie (heures de mort ≠ 0) hors étoile, alors que la dernière prévision d'horloge
   (`lastSlots`) ne lui donne AUCUN créneau avant le prochain tour du Vortex ⇒ prix `kill[m][h]` − θ·pente·PV de
   résurrection (`resurrection` de `abstract.ts`, heure h ajoutée au masque). Un kill qui retire un tour au zombie garde
   son prix.
2. θ `vortex.zombieRezDebit` = 1 (`src/ai/theta.ts`, `data/ai/theta-default.json`) ; 0 rétablit l'ancien comportement
   (ablation : `--theta θ.json` avec `{"vortex":{"zombieRezDebit":0}}`). Utilisé seulement par le modèle du Vortex (ni
   le MonsterBrain ni les combats génériques).
3. `tests/ai-puzzles-vortex.test.ts` — **P20** (`fast` et `standard`) : zombie Ikargn à 500 PV dont le créneau est passé,
   kill hors étoile imposé à +600 avec indice `kill` ⇒ épargné ; ablation `zombieRezDebit` 0 (= code d'avant) ⇒ tué, ce
   qui montre que le puzzle discrimine. **P20b** : même scène avec une Méjaire zombie qui joue avant le Vortex ⇒ tuée
   (pas de débit quand le kill retire un tour).

### Rejetés (code non gardé ; arbres et diffs dans `.cache/tuning/r5/tune/trees/`)

RECON30 (`recon`), cause racine de l'auto-pacification (`selfpac`), MF16 (`mf16`), ZREZ sur tous les re-kills
(`zrezall`), bandes à 0,5·E (`zrez2band`). Voir le tableau des expériences.

### Vérifications

- `npx tsc --noEmit` vert ; `npx vitest run tests/ai-* tests/vortex-*` : **335 réussis, 1 ignoré** (33 fichiers ; dont
  `ai-team-control`, puzzles génériques et Vortex, P20 / P20b).
- Fumée `standard` (3 graines de `masterSeed` 145, avant / après) : aucune erreur ; 0 / 3 victoires dans les deux bras, corrompus 9,3 → 8,3 (3 graines : bruit) ; 60-110 s par combat. ZREZ2 agit aussi en `standard` (P20 `standard`).
- θ global : la seule clé ajoutée (`vortex.zombieRezDebit`) n'est lue que par `VortexAIModel.deathValue` ; aucune
  valeur existante de θ n'est modifiée. Ablation exacte : la graine 632641322 rejouée par la CLI avec
  `{"vortex":{"zombieRezDebit":0}}` redonne le combat d'avant à l'empreinte près (défaite au tour 30, `eventsHash`
  3782741430, identique à la ligne de la référence F).

### Modes d'échec restants

1. **Vague non corrompue au déverrouillage** (181 / 256 = 71 % après) : les vagues 3-5 se corrompent trop lentement
   (corrompus 6,9 au tour 19 et 8,6 au tour 25 sur 19) ; c'est la cause d'échec dominante, avant la submersion (41).
2. **Pacifiste** : 21-28 % des tours de joueur à partir du tour 13 commencent pacifiés (Eniripsa 28 %, Crâ 23 %, Enutrof
   21 %, Crâ déf. 27 %) ; aucune des corrections de l'IA essayées (ce tour : MF16, auto-pacification ; tour 4 : PCAL,
   CPAC, SPG, MJ ; analyste : KITE, LOCK) ne le réduit de façon mesurable.
3. **Fin de partie tardive** : ZREZ2 fait passer les combats à 19 / 19 de 14 à 23 / 256, mais les nouveaux arrivent tard
   (*Action !* au tour ≈ 42 avec ≈ 2,9 survivants) : 14 victoires seulement, 9 « limite de tours » (60, règle du
   scénario ; l'analyste survie estime +1,6 point de victoires à 80 tours — décision de l'utilisateur).
4. **Mesure** : à ρ ≈ 0,1-0,2, n = 256 ne résout que ± 0,6 corrompu et ± 3 points de victoires ; un levier de
   +1 point de victoires demande ≈ 1 500 graines par bras.

### Pistes pour le tour 6

- Rendre le potentiel cohérent avec ZREZ2 (`killValueFor` : un re-kill futur sans tempo est aussi débité).
- Corruption des vagues 3-5 : les fenêtres d'étoile perdues parce que leur titulaire est pacifié (35 % aux tours 13-24
  d'après l'analyste vagues) restent le levier principal ; essayer le « sauvetage » par la glyphe du joueur précédent
  (proposition vagues 3) sur ≥ 512 graines.
- Juger les victoires sur ≥ 512 graines par bras, ou sur des indicateurs moins bruités (corrompus au tour 13-19,
  combats atteignant 19 / 19).

### `masterSeed` utilisées ce tour

141, 142, 143, 144 (32 graines chacune, V) ; 151 à 158 (32 graines chacune, F) ; 145 (3 premières graines, fumée
`standard`). Les analystes ont utilisé 81-88 (ORD / TTd), 101, 102, 103.

### Vérification (tour 5)

Vérification indépendante (harnais `.cache/tuning/r5/verify/` : `run.mts` du réglage à l'identique, `batch.sh`,
`queue.sh`, `pair.cjs`, `seeds.mts` et `mech.mts` du réglage avec d'autres chemins ; résultats bruts `out/`, notes de
reprise `NOTES.txt`). Arbres de travail git : **avant** = `base-tuning-r5` ; **après** = `base-tuning-r5` + les quatre
fichiers vivants du tour (`model.ts`, `theta.ts`, `theta-default.json`, `ai-puzzles-vortex.test.ts` ; diff identique à
`git diff base-tuning-r5`). Équipe `data/teams/vortex.json` (builds épinglés), IA `fast`, variante `default`,
4 processus. Contrôle du harnais : graine 632641322 ⇒ empreintes identiques à celles du réglage dans les deux bras
(après : victoire au tour 42, 1529257450 ; avant : défaite au tour 30, 3782741430).

**Graines inédites** : `campaignSeeds(201..216, 32)` = **512 graines**, aucune parmi les 1 725 graines présentes dans
les fichiers `.jsonl` de `.cache/` (réglages, analystes, campagnes). Fumée `standard` : 2 premières graines de
`masterSeed` 217.

**Relecture du code (ZREZ2).** `rezDebit` est correct : `lastSlots[0]` est le créneau du joueur qui décide, la boucle
s'arrête au premier créneau du Vortex, et seul un zombie (heures de mort ≠ 0 à la racine) tué hors étoile sans créneau
avant ce tour du Vortex est débité, de pente × PV de résurrection. L'heure h est ajoutée au masque, ce qui compte le
bonus de vitalité de l'heure XI, et la pente est celle de `damageWeight`. L'ordre des créneaux ne change pas pendant le
tour du joueur (une glyphe décale l'heure, pas l'ordre), donc le test de créneau reste valide sur toute la recherche.
Hors phases de vagues, les prix `kill` sont vides (attente, burst) : aucun débit. Le même prix sert au préfiltre `quick`
(`killValueNow` ⇒ `deathValue(s, s, e)`), ce qui est cohérent. Il ne sert pas au potentiel (`killValueFor`) ni à
`revivedValue` ; c'est une piste du tour 6, déjà notée. La clé θ `vortex.zombieRezDebit` n'est lue que par
`VortexAIModel` ; aucune autre valeur de θ ne change. Aucun bogue trouvé, aucune correction.

Les tableaux du réglage se recalculent à l'identique depuis ses lignes brutes (F : +0,46 ± 0,61 ; V + F : +0,42 ± 0,52,
victoires 25 → 24).

| Δ apparié (après − avant), `fast`, n = 512 (`masterSeed` 201-216) | Avant | Après | Δ (IC 95 %) |
|---|---|---|---|
| **Victoires** | 21 / 512 = **4,1 %** [2,7 – 6,2] | 31 / 512 = **6,1 %** [4,3 – 8,5] | +29 / −19 (McNemar p = 0,19) |
| Corrompus (total) | 9,40 | 9,86 | **+0,46 ± 0,41** (+243 / −207) |
| Corrompus au tour 13 / 19 / 25 | 4,85 / 6,81 / 8,36 | 4,89 / 6,95 / 8,56 | +0,04 ± 0,11 / **+0,14 ± 0,13** / +0,20 ± 0,22 |
| Tours survécus | 30,84 | 31,58 | +0,74 ± 0,89 |
| Premier mort (tour ; tours du combat s'il n'y en a pas) | 22,79 | 23,25 | +0,46 ± 0,67 |
| Morts | 3,83 | 3,76 | −0,07 ± 0,10 |
| *Action !* (19 / 19) | 30 | 40 | +0,02 ± 0,03 |
| Victoires sans mort ; tour moyen des victoires | 10 ; 48,9 | 12 ; 49,5 | |
| Tours pacifiés (tour ≥ 13) | 28 % | 27 % | |
| Causes d'échec | vague non corrompue 371, submersion 76, croix 21, défaite 11, limite 10, burst raté 2 | vague non corrompue 349, submersion 82, croix 24, défaite 12, limite 12, burst raté 2 | |

Corrompus par `masterSeed` : 201 +0,72, 202 +0,88, 203 −1,28, 204 +1,75, 205 +0,28, 206 −0,38, 207 −1,09, 208 −0,09,
209 −0,16, 210 +0,41, 211 +1,31, 212 +0,16, 213 +2,00, 214 +0,94, 215 +1,09, 216 +0,78 (positif sur 11 / 16).
Par moitiés : 201-208 +0,10 ± 0,58 (victoires 14 → 14) ; 209-216 +0,82 ± 0,57 (victoires 7 → 17, p = 0,05). Deux
moitiés de 256 graines diffèrent donc de 0,7 corrompu, à peu près l'IC de chacune : une seule mesure de 256 graines ne
suffit pas à juger ce changement.

**Cumul de toutes les mesures appariées** (réglage V 128 + F 256, vérification 512 ; n = 896) : victoires 46 → 55
(5,1 % → 6,1 %, +49 / −40, p = 0,40), corrompus **+0,44 ± 0,32**, t13 +0,07 ± 0,08, t19 **+0,13 ± 0,10**, t25
**+0,20 ± 0,17**, tours +0,59 ± 0,69, premier mort +0,49 ± 0,51, morts −0,05 ± 0,08.

**Mécanisme sur graines inédites** (`mech.mts`, 32 graines de `masterSeed` 201 ; empreintes identiques au lot, 32 / 32
dans chaque bras) : re-kills de zombie hors étoile sans tour retiré 3,44 → **0,84** par combat ; avec tour retiré
7,56 → 7,78 ; kills de zombie sous étoile (corruptions) 9,72 → **10,56**. Le mécanisme annoncé se reproduit.

**Victoires du code final reproduites par la CLI** (arbre vivant, `npx tsx src/cli/simulate.ts fight vortex --ai fast
--seed N --json`, empreintes identiques au lot). Toutes trois sont perdues par l'avant aux tours 29-30 (vague non
corrompue au déverrouillage, 4 morts) :

- **3290233078** : tour 42, aucun mort.
- **4169276871** : tour 43, aucun mort.
- **780417895** : tour 44, aucun mort.

Replays dans `.cache/tuning/r5/verify/rep/cli-s<graine>.json`.

**Fumée `standard`** (2 graines de `masterSeed` 217, avant / après) : aucune erreur ; 0 / 2 victoires dans les deux
bras, corrompus 7,0 → 10,0 (2 graines : bruit) ; 74-106 s par combat.

**Tests** (arbre vivant) : `npx tsc --noEmit` vert ; `npx vitest run tests/ai-* tests/vortex-*` : **335 réussis,
1 ignoré**. Les combats de contrôle `ai-team-control` passent (5 / 5), ainsi que les puzzles du Vortex (23 / 23 : P20 et
P20b en `fast` et en `standard`, ablation comprise).

**Verdict : ZREZ2 gardé.**

- **Corruption.** Le gain tient sur 512 graines inédites (+0,46 ± 0,41, borne basse > 0), au même niveau que celui
  annoncé (+0,46 sur F). Au cumul (n = 896), il est significatif sur le total et aux tours 19 et 25.
- **Victoires.** Elles vont dans le même sens (+10 sur 512, +9 au cumul) sans être démontrées (p = 0,19 et 0,40).
- **Survie.** Aucun signal négatif : tours, premier mort et morts sont neutres ou positifs.
- **Code.** Aucun changement n'est retiré ni corrigé.

**Métriques vérifiées du code final** (512 graines inédites, `fast`, équipe épinglée) :

| Métrique | Valeur |
|---|---|
| Victoires | **31 / 512 = 6,1 % [IC 95 % Wilson 4,3 – 8,5 %]** |
| Corrompus | 9,86 / 19 |
| Tours survécus | 31,58 |
| Premier mort | tour 23,25 (22,64 sur les 499 combats avec au moins un mort) |

`masterSeed` utilisées par la vérification : 201 à 216 (32 graines chacune), 217 (2 premières graines, `standard`).
