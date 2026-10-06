# Œil de Vortex — équipe choisie par l'utilisateur : 1 Eniripsa, 1 Enutrof, 2 Crâs

*Campagne du 2026-10-05 — rapport en cours de rédaction : les tableaux sont complétés au fil des mesures.*

> **Décision de l'utilisateur (2026-10-05)** : « Pour faciliter le boulot au simulateur et l'IA, je préfère que ce soit
> l'utilisateur qui détermine les classes/personnages pour un donjon. Du coup pour Vortex, je préfère une compo
> 1 eniripsa 1 enutrof 2 Cras. » La composition (les classes) est donc une **donnée d'entrée** ; le simulateur optimise
> tout le reste pour cette composition : le build de chaque personnage (preset élément/rôle, stuff avec exos et
> transcendances, points de caractéristiques, choix des 22 variantes de sorts) et la stratégie de combat (IA). La
> recherche automatique de composition (docs/reports/vortex-composition.md) ne fait plus partie du flux par défaut.

## Protocole

- **Code figé** : tous les combats tournent dans `.cache/userteam/tree` = `git archive base-userteam` (src/, data/ai/)
  + le `data/ai/presets.json` vivant (on n'y fait qu'AJOUTER des stuffs et des presets dérivés) : l'IA, le moteur et le
  scénario sont ceux du tag `base-userteam` pour tous les bras, quel que soit le travail concurrent sur `src/`.
- IA `fast`, variante de scénario `default`, mêmes graines pour tous les bras (`campaignSeeds(masterSeed, 32)`) :
  criblage sur `masterSeed` 51 (32 graines), puis halving successif sur 52 (64), 53-54 (128) et 55-58 (256) — les mêmes
  graines que la campagne de composition, dont les combats de la référence R (Crâ / Enutrof / Iop déf. / Eniripsa) et du
  bras « Iop → 2ᵉ Crâ Feu » sont repris tels quels (code identique : `git diff base-compo base-userteam -- src` est vide ;
  empreinte des événements vérifiée identique sur la graine 362788747).
- Harnais `.cache/userteam/` (hors dépôt) : `run.mts` (un combat par graine : victoire, tours survécus, corrompus cumulés
  par tour et par vague, premier mort, morts par personnage, dégâts subis par source et par personnage, poussées subies,
  part des tours commencés sous *Pacifiste* aux tours ≥ 13, dégâts infligés par personnage — invocations comprises —,
  soins, sorts lancés ; option `--var` pour changer des variantes de sorts d'un membre comme `applyToggle` de
  `src/optimizer/variants.ts`), `worker.sh` / `queue.sh` (3 processus, unités de 8 graines, reprise après redémarrage),
  `ana.cjs` (différences appariées ± IC 95 %, IC de Wilson des victoires), `seq.cjs` (séquence observée par vague à
  partir d'un replay), `opt.ts` / `mkspec.ts` / `addpresets.cjs` (stuffs Vortex : même méthode que
  docs/reports/vortex-stuffs.md, ajouts seulement dans `data/ai/presets.json`).
- Ordre des membres dans toutes les équipes : **Crâ A, Enutrof, Crâ B, Eniripsa** (les places de R : le Crâ B prend la
  place de l'Iop).

## Candidats

**Résistances des monstres de vague** (`data/dungeons/vortex.json`, % N/T/F/E/A ; nombre à corrompre à 4 joueurs) :
Ikargn 3/8/**−14**/24/39 (×3), Méjaire 8/**−14**/24/39/3 (×4), Harpille **−14**/24/39/3/8 (×4), Buboxor 24/39/3/8/**−14**
(×3), Brabuzar 39/3/8/**−14**/24 (×5). Moyennes pondérées : Feu 13,6 %, Air 12,6 %, Terre 10,3 %, Eau 10,2 % ; la
**Terre** est l'élément faible des **Méjaires** (auteurs du *Pacifiste*, 1-3 PO en ligne) et presque neutre sur les
Brabuzars (3 %) ; le Feu est le pire élément contre les Harpilles (39 %).

**Builds candidats par classe** (presets existants + presets créés par cette campagne ; tous valides : conditions,
panoplies, un seul exo PA/PM/PO, une prysmaradite au plus, 995 / 995 points, parchemins 100 — `computeBuildStats`) :

- **Crâ** (fiche de classe docs/research/classes/cra.md §4-5 : trois jeux de variantes recommandés) : Feu zone
  (`cra_feu_zone`, stuffs Vortex équilibré / offensif / défensif de la campagne de stuffs), Air entrave PM
  (`cra_air_entrave`, stuff Vortex équilibré de la campagne de composition, **défensif créé ici**), Terre mono-cible
  (`cra_terre_mono`, **stuffs Vortex équilibré, offensif et défensif créés ici**). Pas d'autre jeu de variantes Crâ dans
  la fiche (l'Eau n'y est qu'un élément d'appoint : Glacée, Évasive, Paralysante, Expiation) ; les autres options de la
  fiche (portée, sans ligne de vue, retrait de PM, balises) sont mesurées comme **bascules de variantes** (section
  suivante) sur la meilleure paire.
- **Eniripsa** : soin Feu (`eniripsa_soin_feu`, stuffs Vortex équilibré / défensif) ; Air boost (`eniripsa_air_boost`,
  **stuff Vortex équilibré créé ici**). L'Eniripsa entrave (Moqueries, retrait PA) n'a pas été retenu : sans soin
  principal, l'équipe perd son seul soigneur.
- **Enutrof** : retrait PM Eau (`enutrof_retrait_pm_eau`, stuffs Vortex équilibré / défensif) ; soutien
  (`enutrof_soutien`) et PA/PO + DPS Air (`enutrof_pa_po_dps`), **stuffs Vortex équilibrés créés ici**.

Stuffs créés (même méthode que docs/reports/vortex-stuffs.md : `optimizeStuff` de `src/optimizer/stuff`, cible
`vortexProxyOptions` — mix des cibles des 5 vagues, exposition mesurée, collisions du Brabuzar, PO visée 6 —, profils
équilibré / défensif / offensif, 30 000 itérations de recuit, forgemagie « jets parfaits + un exo PA/PM/PO +
6 transcendances au plus », points candidats de `points.ts` ; pilote `.cache/userteam/opt.ts`, sorties
`.cache/userteam/opt/*.json`) — proxy DPT / EHP / UTIL, départ (stuff du preset) → retenu :

| Stuff (preset dérivé) | Profil | Proxy départ → retenu | PV départ → retenu |
|---|---|---|---|
| `vortex_cra_terre_mono` (`cra_terre_mono_vortex`) | équilibré | 2451 / 5125 / 0 → 2640 / 8349 / 0 | 4153 → 4803 |
| `vortex_cra_terre_mono_off` (`cra_terre_mono_vortex_off`) | offensif | 2451 / 5125 / 0 → 2984 / 4732 / 0 | 4153 → 4103 |
| `vortex_cra_terre_mono_def` (`cra_terre_mono_vortex_def`) | défensif | 2451 / 5125 / 0 → 2004 / 13426 / 0 | 4153 → 6395 |
| `vortex_cra_air_entrave_def` (`cra_air_entrave_vortex_def`) | défensif | 3146 / 5587 / 0,44 → 1573 / 16207 / 0,88 | 4153 → 6445 |
| `vortex_eniripsa_air_boost` (`eniripsa_air_boost_vortex`) | équilibré | 2186 / 5587 / 1,13 → 1760 / 13139 / 1,13 | 4153 → 5603 |
| `vortex_enutrof_soutien` (`enutrof_soutien_vortex`) | équilibré | 2093 / 5338 / 0,29 → 1575 / 14030 / 0,39 | 4103 → 6095 |
| `vortex_enutrof_pa_po_dps` (`enutrof_pa_po_dps_vortex`) | équilibré | 2063 / 5587 / 0,16 → 1373 / 13784 / 0,43 | 4153 → 5995 |

Remarque : relancé avec les pools actuels (qui contiennent les objets des stuffs ajoutés depuis), l'optimiseur ne
redonne pas exactement les stuffs des campagnes précédentes (`cra_terre_mono` équilibré : logJ 8,224 contre 8,180 dans
la campagne de composition ; `cra_feu_zone` équilibré : 8,242 contre 8,175 pour `vortex_cra_feu`) : les pools de
départ dépendent des stuffs présents dans `data/ai/presets.json`. Les écarts de proxy de cet ordre ne se sont jamais
traduits en écart mesurable en combat (docs/reports/vortex-stuffs.md) ; les stuffs existants ont été gardés.

Tous les candidats (preset dérivé, stuff, base, PV, PA/PM/PO, % résistances N/T/F/E/A, Ré Pou, Ret PM, points,
panoplies, validité) :

| Preset | Stuff (origine) | Base | PV | PA/PM/PO | % Rés. | Ré Pou | Ret PM | Points | Panoplies | Valide |
|---|---|---|---|---|---|---|---|---|---|---|
| `cra_feu_vortex` | `vortex_cra_feu` (campagne de stuffs) | cra_feu_zone | 4803 | 12/6/6 | 15/29/21/22/31 | 0 | 55 | Vi 3, Int 992 | Panoplie Séculaire (3), Panoplie du Cycloïde (3) | oui |
| `cra_feu_vortex_off` | `vortex_cra_feu_off` (campagne de stuffs) | cra_feu_zone | 4003 | 12/6/6 | 14/21/14/36/17 | 0 | 70 | Vi 3, Int 992 | Panoplie d'Otomaï (3), Panoplie de Guerre (2), Panoplie Séculaire (2) | oui |
| `cra_feu_vortex_def` | `vortex_cra_feu_def` (campagne de stuffs) | cra_feu_zone | 6045 | 12/6/6 | 30/23/48/46/34 | 165 | 46 | Vi 395, Int 600 | Panoplie Pnose (3), Panoplie du Vénérable Endormi (2), Panoplie des Abysses (2), Panoplie des Armutins (2) | oui |
| `cra_air_entrave_vortex` | `vortex_cra_air_entrave` (campagne de composition) | cra_air_entrave | 5745 | 12/6/6 | 26/35/50/50/8 | 165 | 150 | Vi 695, Agi 300 | Panoplie du Valet Veinard (2), Panoplie du Wukang (3) | oui |
| `cra_air_entrave_vortex_def` | `vortex_cra_air_entrave_def` (cette campagne) | cra_air_entrave | 6445 | 12/6/6 | 45/38/50/52/24 | 200 | 142 | Vi 695, Agi 300 | Panoplie des Abysses (3), Panoplie de Kongoku (2) | oui |
| `cra_terre_mono_vortex` | `vortex_cra_terre_mono` (cette campagne) | cra_terre_mono | 4803 | 12/6/6 | 18/20/18/42/26 | 190 | 64 | Vi 3, Fo 992 | Panoplie du Bonimenteur (3), Panoplie du Comte Harebourg (2), Panoplistik (2), Panoplie du Vénérable Endormi (2) | oui |
| `cra_terre_mono_vortex_off` | `vortex_cra_terre_mono_off` (cette campagne) | cra_terre_mono | 4103 | 12/6/6 | 20/25/26/18/24 | 0 | 57 | Vi 3, Fo 992 | Panoplie du Cycloïde (3), Panoplie de Corruption (2), Panoplie de Torkélonia (3) | oui |
| `cra_terre_mono_vortex_def` | `vortex_cra_terre_mono_def` (cette campagne) | cra_terre_mono | 6395 | 12/6/6 | 22/24/22/46/30 | 144 | 64 | Vi 695, Fo 300 | Panoplie du Bonimenteur (3), Panoplie du Comte Harebourg (2), Panoplistik (2), Panoplie du Vénérable Endormi (2) | oui |
| `eniripsa_soin_vortex` | `vortex_eniripsa_feu` (campagne de stuffs) | eniripsa_soin_feu | 5745 | 12/6/6 | 40/33/33/51/14 | 45 | 52 | Vi 395, Int 600 | Panoplie Pnose (3), Panoplie du Vénérable Endormi (2), Panoplistik (2) | oui |
| `eniripsa_soin_vortex_def` | `vortex_eniripsa_feu_def` (campagne de stuffs) | eniripsa_soin_feu | 6195 | 12/6/6 | 49/30/31/47/16 | 195 | 72 | Vi 695, Int 300 | Panoplie Séculaire (2), Panoplie du Vénérable Endormi (2), Panoplie de Léthaline Sigisbul (3) | oui |
| `eniripsa_air_boost_vortex` | `vortex_eniripsa_air_boost` (cette campagne) | eniripsa_air_boost | 5603 | 12/6/6 | 43/28/31/48/14 | 170 | 47 | Vi 3, Agi 992 | Panoplie de R'lyugluglu (2), Panoplie des Abîmes (3) | oui |
| `enutrof_retrait_pm_vortex` | `vortex_enutrof_eau` (campagne de stuffs) | enutrof_retrait_pm_eau | 5745 | 12/6/6 | 36/18/38/54/21 | 70 | 152 | Vi 695, Cha 300 | Panoplie de Voldelor (3), Panoplie du Gouffre (3) | oui |
| `enutrof_retrait_pm_vortex_def` | `vortex_enutrof_eau_def` (campagne de stuffs) | enutrof_retrait_pm_eau | 6295 | 12/6/6 | 41/26/23/49/16 | 144 | 142 | Vi 695, Cha 300 | Panoplie de Léthaline Sigisbul (3) | oui |
| `enutrof_soutien_vortex` | `vortex_enutrof_soutien` (cette campagne) | enutrof_soutien | 6095 | 12/6/6 | 48/26/24/50/17 | 170 | 51 | Vi 695, Cha 300 | Panoplie Pnose (3), Panoplie de Servitude (2) | oui |
| `enutrof_pa_po_dps_vortex` | `vortex_enutrof_pa_po_dps` (cette campagne) | enutrof_pa_po_dps | 5995 | 12/6/6 | 41/20/52/46/14 | 140 | 70 | Vi 695, Agi 300 | Panoplie de Voldelor (3), Panoplie du Valet Veinard (2) | oui |

## Criblage (`masterSeed` 51, 32 graines)

Référence appariée : **Crâ Feu + Crâ Terre** (meilleur bras du criblage). Chaque cellule : moyenne du bras, puis entre parenthèses la différence APPARIÉE avec la référence (mêmes graines) ± demi-largeur de l'IC 95 % (1,96·σ/√n). Victoires : IC de Wilson. Enutrof `enutrof_retrait_pm_vortex` et Eniripsa `eniripsa_soin_vortex` sauf mention.

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Crâ Terre + Crâ Terre | 32 | 2 / 32 [1,7 % – 20,1 %] | 5,19 (+0,56 ± 0,35) | 7,34 (+0,56 ± 0,57) | 10,09 (+0,31 ± 1,95) | 30,94 (−0,31 ± 3,99) | 21,63 (+0,41 ± 2,83) | 25,4 % | 8 722 | 146 567 | 52 499 |
| Crâ Feu + Crâ Terre (déf.) | 32 | 2 / 32 [1,7 % – 20,1 %] | 4,84 (+0,22 ± 0,46) | 6,88 (+0,09 ± 0,49) | 10,06 (+0,28 ± 2,13) | 32,22 (+0,97 ± 4,39) | 22,47 (+1,25 ± 2,77) | 26,0 % | 11 407 | 150 194 | 52 973 |
| **Crâ Feu + Crâ Terre** | 32 | 3 / 32 [3,2 % – 24,2 %] | 4,63 | 6,78 | 9,78 | 31,25 | 21,22 | 29,1 % | 9 388 | 143 932 | 52 211 |
| Crâ Air entrave + Crâ Terre | 32 | 2 / 32 [1,7 % – 20,1 %] | 4,50 (−0,13 ± 0,40) | 6,72 (−0,06 ± 0,44) | 9,22 (−0,56 ± 2,08) | 29,97 (−1,28 ± 4,34) | 21,25 (+0,03 ± 2,66) | 26,3 % | 10 410 | 136 706 | 52 268 |
| Crâ Terre + Crâ Terre (déf.) | 32 | 2 / 32 [1,7 % – 20,1 %] | 4,81 (+0,19 ± 0,47) | 6,88 (+0,09 ± 0,49) | 9,19 (−0,59 ± 1,71) | 30,16 (−1,09 ± 3,28) | 22,97 (+1,75 ± 2,79) | 30,2 % | 9 836 | 137 169 | 50 129 |
| Crâ Feu + Crâ Terre (off.) | 32 | 3 / 32 [3,2 % – 24,2 %] | 4,66 (+0,03 ± 0,47) | 6,63 (−0,16 ± 0,68) | 8,88 (−0,91 ± 2,41) | 29,44 (−1,81 ± 4,94) | 18,56 (−2,66 ± 3,29) | 27,7 % | 8 974 | 133 495 | 48 635 |
| Crâ Feu (déf.) + Crâ Terre | 32 | 1 / 32 [0,6 % – 15,7 %] | 4,69 (+0,06 ± 0,48) | 6,47 (−0,31 ± 0,53) | 8,66 (−1,13 ± 1,69) | 29,13 (−2,13 ± 3,42) | 20,91 (−0,31 ± 2,68) | 29,8 % | 10 825 | 131 641 | 51 178 |
| Crâ Feu (off.) + Crâ Terre | 32 | 1 / 32 [0,6 % – 15,7 %] | 4,81 (+0,19 ± 0,49) | 6,50 (−0,28 ± 0,50) | 8,31 (−1,47 ± 1,68) | 28,25 (−3,00 ± 3,28) | 19,16 (−2,06 ± 2,70) | 31,8 % | 9 418 | 131 232 | 48 504 |
| Feu + Terre, Eniripsa Air boost | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,94 (+0,31 ± 0,44) | 6,78 (+0,00 ± 0,44) | 7,97 (−1,81 ± 1,66) | 26,84 (−4,41 ± 3,49) | 19,88 (−1,34 ± 2,79) | 30,6 % | 9 292 | 122 354 | 49 186 |
| *R — référence hors composition* (Crâ Feu / Enutrof / Iop Terre déf. / Eniripsa) | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,19 (−0,44 ± 0,43) | 6,13 (−0,66 ± 0,60) | 7,94 (−1,84 ± 2,05) | 28,94 (−2,31 ± 4,32) | 21,03 (−0,19 ± 3,08) | 30,5 % | 11 188 | 132 859 | 54 535 |
| Feu + Terre, Enutrof retrait PM déf. | 32 | 1 / 32 [0,6 % – 15,7 %] | 4,25 (−0,38 ± 0,35) | 6,28 (−0,50 ± 0,58) | 7,75 (−2,03 ± 1,95) | 28,31 (−2,94 ± 3,98) | 19,66 (−1,56 ± 2,93) | 26,8 % | 10 074 | 132 447 | 51 550 |
| Crâ Air entrave + Crâ Air entrave | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,91 (−0,72 ± 0,34) | 6,25 (−0,53 ± 0,52) | 7,53 (−2,25 ± 1,75) | 27,69 (−3,56 ± 3,59) | 22,03 (+0,81 ± 2,69) | 27,3 % | 13 472 | 122 977 | 50 126 |
| Crâ Feu + Crâ Air entrave | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,25 (−0,38 ± 0,42) | 6,03 (−0,75 ± 0,42) | 7,09 (−2,69 ± 1,65) | 27,06 (−4,19 ± 3,68) | 19,19 (−2,03 ± 2,89) | 29,4 % | 12 440 | 119 140 | 51 314 |
| Feu + Terre, Eniripsa soin déf. | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,44 (−0,19 ± 0,52) | 6,06 (−0,72 ± 0,53) | 7,00 (−2,78 ± 1,74) | 27,44 (−3,81 ± 3,50) | 18,75 (−2,47 ± 2,96) | 34,7 % | 10 026 | 123 105 | 49 539 |
| Crâ Feu + Crâ Feu | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,16 (−0,47 ± 0,47) | 5,94 (−0,84 ± 0,50) | 6,84 (−2,94 ± 1,65) | 25,75 (−5,50 ± 3,46) | 17,69 (−3,53 ± 2,33) | 30,5 % | 8 916 | 116 511 | 50 182 |
| Crâ Feu + Crâ Feu (déf.) | 32 | 1 / 32 [0,6 % – 15,7 %] | 4,19 (−0,44 ± 0,38) | 5,63 (−1,16 ± 0,62) | 6,72 (−3,06 ± 1,50) | 26,84 (−4,41 ± 3,01) | 19,00 (−2,22 ± 2,74) | 35,3 % | 11 098 | 118 611 | 50 935 |
| Feu + Terre, Enutrof PA/PO + DPS (Air) | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,34 (−0,28 ± 0,49) | 5,94 (−0,84 ± 0,60) | 6,63 (−3,16 ± 1,72) | 25,66 (−5,59 ± 3,49) | 17,72 (−3,50 ± 2,52) | 37,1 % | 10 081 | 113 623 | 54 763 |
| Crâ Feu + Crâ Feu, Eniripsa déf. | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,00 (−0,63 ± 0,43) | 5,59 (−1,19 ± 0,50) | 6,38 (−3,41 ± 1,67) | 26,38 (−4,88 ± 3,56) | 17,81 (−3,41 ± 2,87) | 31,8 % | 8 459 | 116 944 | 49 640 |
| Feu + Terre, Enutrof soutien | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,06 (−0,56 ± 0,33) | 5,50 (−1,28 ± 0,59) | 6,38 (−3,41 ± 1,62) | 25,63 (−5,63 ± 3,49) | 17,22 (−4,00 ± 2,62) | 36,4 % | 7 489 | 106 800 | 49 482 |
| Crâ Feu (off.) + Crâ Feu | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,09 (−0,53 ± 0,55) | 5,56 (−1,22 ± 0,74) | 6,00 (−3,78 ± 1,75) | 24,44 (−6,81 ± 3,51) | 14,53 (−6,69 ± 2,99) | 36,2 % | 8 716 | 101 857 | 47 458 |


## Variantes de sorts des Crâs

(à compléter)

## Halving

(à compléter)

## Équipe recommandée

(à compléter)

## Séquence de combat observée

(à compléter)

## Ce qui bloque encore

(à compléter)
