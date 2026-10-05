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
