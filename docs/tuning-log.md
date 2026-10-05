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
   portée de kill (espérance ≥ PV) — la ligne de kill marque aussi un monstre neuf achevable.
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
