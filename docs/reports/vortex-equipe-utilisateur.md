# Œil de Vortex — équipe choisie par l'utilisateur : 1 Eniripsa, 1 Enutrof, 2 Crâs

*Campagne du 2026-10-05/06 — combats `fast` appariés dans un arbre figé (`base-userteam`) ; 3 processus.*

> **Décision de l'utilisateur (2026-10-05)** : « Pour faciliter le boulot au simulateur et l'IA, je préfère que ce soit
> l'utilisateur qui détermine les classes/personnages pour un donjon. Du coup pour Vortex, je préfère une compo
> 1 eniripsa 1 enutrof 2 Cras. » La composition (les classes) est donc une **donnée d'entrée** ; le simulateur optimise
> tout le reste pour cette composition : le build de chaque personnage (preset élément/rôle, stuff avec exos et
> transcendances, points de caractéristiques, choix des 22 variantes de sorts) et la stratégie de combat (IA). La
> recherche automatique de composition (docs/reports/vortex-composition.md) ne fait plus partie du flux par défaut.

## Résumé

- **Équipe recommandée** (1 Eniripsa, 1 Enutrof, 2 Crâs **Terre**, l'un en stuff équilibré, l'autre en stuff défensif) :

  ```
  cra_terre_mono_vortex,enutrof_retrait_pm_vortex,cra_terre_mono_vortex_def,eniripsa_soin_vortex
  ```

  = Crâ Terre mono-cible (`cra_terre_mono@vortex_cra_terre_mono`), Enutrof retrait PM Eau (`vortex_enutrof_eau`),
  Crâ Terre mono-cible défensif (`cra_terre_mono@vortex_cra_terre_mono_def`), Eniripsa soin Feu
  (`vortex_eniripsa_feu`) ; variantes de sorts des presets de base (aucune bascule mesurée ne fait mieux).
- **Taux de victoire** (IA `fast`, 256 graines, `masterSeed` 51-58) : **15 / 256 = 5,9 % [IC 95 % Wilson 3,6 % – 9,4 %]**,
  9,65 monstres corrompus sur 19 en moyenne, 31,3 tours survécus, premier mort au tour 22,8 ; 7 des 15 victoires sans
  aucun mort. Variante à deux Crâs Terre équilibrés (`cra_terre_mono_vortex` ×2) : 12 / 256 = 4,7 % [2,7 % – 8,0 %],
  même corruption (−0,11 ± 0,60 pour la recommandée), mais premier mort plus tôt (−1,54 ± 0,96 tour, significatif).
- **Le levier de cette composition est l'élément Terre des Crâs** : deux Crâs Feu (la paire « naturelle », proche de
  l'équipe méta) corrompent **2,9 monstres de moins** qu'un Crâ Feu + un Crâ Terre (6,84 contre 9,78, ± 1,65, n = 32)
  et ne gagnent jamais ; toutes les paires qui contiennent un Crâ Terre font 8,3 à 10,1 corrompus, toutes celles qui
  n'en ont pas 6,0 à 7,5 (n = 32). La Terre est l'élément faible des **Méjaires** (−14 %, auteurs du *Pacifiste*) et presque
  neutre sur les Brabuzars (3 %) ; les deux Crâs Terre infligent chacun 11 000 à 13 800 dégâts par combat aux Méjaires
  (voir la Vérification : la paire Terre fait aussi plus de dégâts aux Harpilles).
- **Comparaison avec l'équipe de référence hors composition** R (Crâ Feu / Enutrof / Iop Terre déf. / Eniripsa, la
  meilleure équipe des campagnes précédentes) sur les 88 graines communes : la composition de l'utilisateur, bien
  construite, fait **mieux** que R : +2,30 ± 1,11 corrompus, +3,8 ± 2,1 tours, 7 victoires contre 0.
- **Eniripsa et Enutrof** : leurs builds Vortex existants (`eniripsa_soin_vortex`, `enutrof_retrait_pm_vortex`) restent
  les meilleurs ; chaque alternative mesurée (Eniripsa Air boost ou défensif, Enutrof soutien, PA/PO DPS ou défensif)
  perd 1,8 à 3,4 corrompus.
- **Ce qui bloque encore** : la corruption des vagues 3 à 5 (1,9 / 0,8 / 0,4 monstre corrompu sur 4 par vague) —
  72 % des défaites (174 / 241) sont des « vagues non corrompues au déverrouillage » ; voir la dernière section.

## Protocole

- **Code figé** : tous les combats tournent dans `.cache/userteam/tree` = `git archive base-userteam` (src/, data/ai/)
  + le `data/ai/presets.json` vivant (on n'y fait qu'AJOUTER des stuffs et des presets dérivés) : l'IA, le moteur et le
  scénario sont ceux du tag `base-userteam` pour tous les bras, quel que soit le travail concurrent sur `src/`.
- IA `fast`, variante de scénario `default`, mêmes graines pour tous les bras (`campaignSeeds(masterSeed, 32)`) :
  criblage sur `masterSeed` 51 (32 graines), puis halving successif sur 52 (64), 53-54 (128) et 55-58 (256) — les mêmes
  graines que la campagne de composition, dont les combats de la référence R (Crâ / Enutrof / Iop déf. / Eniripsa,
  `masterSeed` 51-53, 88 graines) et du bras « Iop → 2ᵉ Crâ Feu » (= Crâ Feu + Crâ Feu, `masterSeed` 51) sont repris
  tels quels (code identique : `git diff base-compo base-userteam -- src` est vide ; empreinte des événements vérifiée
  identique sur la graine 362788747).
- Harnais `.cache/userteam/` (hors dépôt) : `run.mts` (un combat par graine : victoire, tours survécus, corrompus cumulés
  par tour et par vague, premier mort, morts par personnage, dégâts subis par source et par personnage, poussées subies,
  part des tours commencés sous *Pacifiste* aux tours ≥ 13, dégâts infligés par personnage — invocations comprises — et
  par type de monstre, soins, sorts lancés ; option `--var` pour changer des variantes de sorts d'un membre comme
  `applyToggle` de `src/optimizer/variants.ts`), `worker.sh` / `queue.sh` (3 processus, unités de 8 graines, reprise
  après redémarrage), `ana.cjs` (différences appariées ± IC 95 %, IC de Wilson des victoires), `seq.cjs` / `seqagg.cjs`
  (séquence observée par vague à partir des replays et des notes `aiNote`), `opt.ts` / `mkspec.ts` / `addpresets.cjs`
  (stuffs Vortex : même méthode que docs/reports/vortex-stuffs.md, ajouts seulement dans `data/ai/presets.json`),
  `members.ts` + `mkbuilds.cjs` (tables de build).
- Ordre des membres dans toutes les équipes : **Crâ A, Enutrof, Crâ B, Eniripsa** (les places de R : le Crâ B prend la
  place de l'Iop).
- Lecture des tableaux : chaque cellule donne la moyenne du bras, puis entre parenthèses la différence APPARIÉE avec la
  référence du tableau (mêmes graines) ± la demi-largeur de l'IC 95 % (1,96·σ/√n). Victoires : IC de Wilson.
  « Corr. » = monstres corrompus cumulés à la fin du tour 13, du tour 19 et du combat (19 à corrompre) ; « 1er mort » =
  tour du premier mort (tour de fin du combat si personne ne meurt) ; « Pacifiste » = part des tours de personnage
  commencés sous *Pacifiste* aux tours ≥ 13 ; poussées, dégâts infligés aux monstres de vague et dégâts subis :
  moyennes par combat.
- Volume : ≈ 1 570 combats `fast` nouveaux (≈ 20-30 s chacun) + 120 repris de la campagne de composition, et une dizaine
  de combats de vérification (replays, CLI).

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

Référence appariée : **Crâ Feu + Crâ Terre** (meilleur bras au moment du criblage). Enutrof `enutrof_retrait_pm_vortex` et
Eniripsa `eniripsa_soin_vortex` sauf mention.

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Crâ Terre + Crâ Terre | 32 | 2 / 32 [1,7 % – 20,1 %] | 5,19 (+0,56 ± 0,35) | 7,34 (+0,56 ± 0,57) | 10,09 (+0,31 ± 1,95) | 30,94 (−0,31 ± 3,99) | 21,63 (+0,41 ± 2,83) | 25,4 % | 8 722 | 146 567 | 52 499 |
| Crâ Feu + Crâ Terre (déf.) | 32 | 2 / 32 [1,7 % – 20,1 %] | 4,84 (+0,22 ± 0,46) | 6,88 (+0,09 ± 0,49) | 10,06 (+0,28 ± 2,13) | 32,22 (+0,97 ± 4,39) | 22,47 (+1,25 ± 2,77) | 26,0 % | 11 407 | 150 194 | 52 973 |
| Crâ Feu + Crâ Terre | 32 | 3 / 32 [3,2 % – 24,2 %] | 4,63 | 6,78 | 9,78 | 31,25 | 21,22 | 29,1 % | 9 388 | 143 932 | 52 211 |
| Crâ Air entrave + Crâ Terre | 32 | 2 / 32 [1,7 % – 20,1 %] | 4,50 (−0,13 ± 0,40) | 6,72 (−0,06 ± 0,44) | 9,22 (−0,56 ± 2,08) | 29,97 (−1,28 ± 4,34) | 21,25 (+0,03 ± 2,66) | 26,3 % | 10 410 | 136 706 | 52 268 |
| **Crâ Terre + Crâ Terre (déf.)** — recommandée | 32 | 2 / 32 [1,7 % – 20,1 %] | 4,81 (+0,19 ± 0,47) | 6,88 (+0,09 ± 0,49) | 9,19 (−0,59 ± 1,71) | 30,16 (−1,09 ± 3,28) | 22,97 (+1,75 ± 2,79) | 30,2 % | 9 836 | 137 169 | 50 129 |
| Crâ Feu + Crâ Terre (off.) | 32 | 3 / 32 [3,2 % – 24,2 %] | 4,66 (+0,03 ± 0,47) | 6,63 (−0,16 ± 0,68) | 8,88 (−0,91 ± 2,41) | 29,44 (−1,81 ± 4,94) | 18,56 (−2,66 ± 3,29) | 27,7 % | 8 974 | 133 495 | 48 635 |
| Crâ Terre (déf.) + Crâ Terre (déf.) | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,81 (+0,19 ± 0,47) | 6,72 (−0,06 ± 0,41) | 8,81 (−0,97 ± 1,47) | 31,34 (+0,09 ± 4,09) | 24,91 (+3,69 ± 2,27) | 27,7 % | 11 636 | 143 075 | 53 993 |
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

Lecture :

- **Deux Crâs identiques ou différents ?** Ce n'est pas la question qui compte : c'est la présence d'un Crâ **Terre**.
  Deux Crâs Feu (6,84 corrompus, 0 victoire), Feu + Air (7,09) et deux Crâs Air (7,53) sont tous 2,3 à 2,9 corrompus
  sous Feu + Terre ; deux Crâs Terre (10,09, et +0,56 ± 0,35 corrompu dès le tour 13) font au moins aussi bien que Feu +
  Terre (9,78) ; Air + Terre (9,22) un peu moins.
- **Profils de stuff du 2ᵉ Crâ** : avec un Crâ Terre, le stuff défensif sur l'un des deux Crâs vit plus longtemps (premier
  mort +1,3 à +1,8 tour) sans perte de corruption mesurable ; offensif (Feu ou Terre) ou défensif sur le Crâ Feu, moins
  bien ; les deux Crâs Terre en défensif retardent le premier mort (+3,7 ± 2,3) mais corrompent moins (−1,0).
- **Eniripsa et Enutrof** : toutes les alternatives perdent (−1,8 à −3,4 corrompus) ; l'Eniripsa défensif perd ses dégâts sans
  gagner de survie (−2,8 ± 1,7 corrompus, premier mort −2,5), l'Enutrof soutien ou PA/PO perd le retrait de PM et les
  dégâts de l'Enutrof Eau.
- Bras abandonnés après le criblage : tous ceux sans Crâ Terre ; Feu (off./déf.) + Terre, Terre off., Air + Terre ;
  les alternatives d'Eniripsa et d'Enutrof.

## Variantes de sorts des Crâs

Les 22 paires de chaque Crâ sont celles du preset de base (`cra_terre_mono` : jeu « Terre mono » de la fiche de classe
§5). Bascules essayées — une paire à la fois, sur le Crâ Terre B de la paire Terre + Terre (même équipe, mêmes graines,
option `--var` du harnais = `applyToggle` de `src/optimizer/variants.ts`) — choisies parmi les options que la fiche
de classe propose pour le Vortex : portée et ligne de vue (Acuité Absolue sans ligne de vue, Tirs Éloignés), retrait de
PM (Boomerang −PM en ligne), retrait de PA/PM de zone (Paralysante), retrait de Puissance (Jugement −150 Puissance,
Terre), balises (Tactique : attire / repousse ; Survie : soin de 7 % des PV en ligne de vue). Sorts du Crâ Terre jamais
ou presque jamais lancés dans la paire Terre + Terre (lancers par combat, Crâ A / Crâ B, n = 32) : Flèche d'Expiation
0,06 / 0,13, Perforante 0,31 / 0,66, Détonante 0,66 / 0,72, Glacée 0,72 / 0,84 — leurs alternatives (Rédemption Eau, Boomerang Air, Harcelante Air, Ralentissante
Eau) ne sont pas dans l'élément du personnage, sauf l'effet de retrait de PM de Boomerang, essayé.

Référence appariée : **Crâ Terre + Crâ Terre** (variantes du preset).

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Terre + Terre ; Crâ Terre B : Flèche du Jugement au lieu de Punitive (paire 18) | 32 | 3 / 32 [3,2 % – 24,2 %] | 5,06 (−0,13 ± 0,48) | 7,28 (−0,06 ± 0,53) | 10,41 (+0,31 ± 1,84) | 33,31 (+2,38 ± 4,63) | 21,94 (+0,31 ± 2,68) | 26,5 % | 8 950 | 149 045 | 51 101 |
| **Crâ Terre + Crâ Terre** | 32 | 2 / 32 [1,7 % – 20,1 %] | 5,19 | 7,34 | 10,09 | 30,94 | 21,63 | 25,4 % | 8 722 | 146 567 | 52 499 |
| Terre + Terre ; Crâ Terre B : Balise de Survie au lieu de Représailles (paire 16) | 32 | 0 / 32 [0,0 % – 10,7 %] | 5,09 (−0,09 ± 0,48) | 7,00 (−0,34 ± 0,53) | 9,94 (−0,16 ± 1,75) | 30,38 (−0,56 ± 4,05) | 22,13 (+0,50 ± 2,52) | 24,7 % | 10 110 | 146 240 | 51 884 |
| Terre + Terre ; Crâ Terre B : Acuité Absolue au lieu de Sentinelle (paire 22) | 32 | 1 / 32 [0,6 % – 15,7 %] | 4,91 (−0,28 ± 0,42) | 7,03 (−0,31 ± 0,73) | 9,31 (−0,78 ± 2,05) | 29,31 (−1,63 ± 3,86) | 21,09 (−0,53 ± 2,81) | 27,0 % | 8 762 | 136 719 | 48 895 |
| Terre + Terre ; Crâ Terre B : Flèche Boomerang au lieu de Perforante (paire 20) | 32 | 1 / 32 [0,6 % – 15,7 %] | 5,06 (−0,13 ± 0,50) | 7,00 (−0,34 ± 0,57) | 9,13 (−0,97 ± 1,87) | 29,00 (−1,94 ± 3,63) | 20,38 (−1,25 ± 2,21) | 27,7 % | 8 620 | 139 846 | 47 917 |
| Terre + Terre ; Crâ Terre B : Flèche Paralysante au lieu d'Œil pour Œil (paire 15) | 32 | 3 / 32 [3,2 % – 24,2 %] | 4,53 (−0,66 ± 0,42) | 6,66 (−0,69 ± 0,63) | 8,84 (−1,25 ± 1,72) | 29,00 (−1,94 ± 3,26) | 20,69 (−0,94 ± 3,46) | 30,0 % | 8 632 | 129 649 | 50 527 |
| Terre + Terre ; Crâ Terre B : Tirs Éloignés au lieu de Tir Perçant (paire 6) | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,91 (−0,28 ± 0,44) | 6,88 (−0,47 ± 0,56) | 8,56 (−1,53 ± 1,62) | 27,97 (−2,97 ± 3,40) | 20,13 (−1,50 ± 2,47) | 29,5 % | 10 200 | 131 606 | 50 235 |
| Terre + Terre ; Crâ Terre B : Balise Tactique au lieu de Pas Chassé (paire 5) | 32 | 0 / 32 [0,0 % – 10,7 %] | 5,13 (−0,06 ± 0,43) | 6,88 (−0,47 ± 0,67) | 8,28 (−1,81 ± 1,49) | 28,19 (−2,75 ± 2,90) | 18,88 (−2,75 ± 2,60) | 28,3 % | 10 069 | 132 577 | 49 447 |

Lecture : aucune bascule n'améliore la paire de façon significative à 32 graines ; Balise Tactique (−1,8 corrompu),
Tirs Éloignés (−1,5), Paralysante (−1,3, −0,66 ± 0,42 au tour 13) sont nettement moins bonnes ; Boomerang et Acuité
Absolue ne sont presque pas lancées par l'IA (la variante est perdue). Seule **Flèche du Jugement** (2 lancers par
tour, −150 Puissance à la cible) est neutre à légèrement positive (+0,31 ± 1,84 corrompu, +2,4 tours, 3 victoires
contre 2) : elle est re-mesurée sur 64 graines (`masterSeed` 51-52), sur un puis sur les deux Crâs :

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Crâ Terre + Crâ Terre | 64 | 6 / 64 [4,4 % – 19,0 %] | 5,05 | 7,16 | 10,13 | 30,64 | 21,98 | 24,1 % | 8 441 | 145 155 | 51 074 |
| Terre + Terre ; Crâ Terre B : Flèche du Jugement au lieu de Punitive (paire 18) | 64 | 6 / 64 [4,4 % – 19,0 %] | 4,89 (−0,16 ± 0,36) | 7,02 (−0,14 ± 0,39) | 9,89 (−0,23 ± 1,26) | 31,58 (+0,94 ± 2,98) | 21,69 (−0,30 ± 1,99) | 28,0 % | 9 461 | 147 132 | 50 361 |
| Terre + Terre ; les deux Crâs : Flèche du Jugement au lieu de Punitive (paire 18) | 64 | 2 / 64 [0,9 % – 10,7 %] | 4,84 (−0,20 ± 0,34) | 6,77 (−0,39 ± 0,41) | 9,09 (−1,03 ± 1,36) | 29,17 (−1,47 ± 2,62) | 20,77 (−1,22 ± 1,89) | 30,3 % | 10 205 | 140 888 | 48 256 |

Sur 64 graines, Jugement est neutre sur un Crâ (−0,23 ± 1,26 corrompu, même nombre de victoires) et négatif sur les
deux (−1,03 ± 1,36, 2 victoires contre 6) : **les 22 variantes des presets de base sont gardées** pour les deux Crâs.

## Halving

### 64 graines (`masterSeed` 51-52), référence Crâ Feu + Crâ Terre

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Crâ Terre + Crâ Terre | 64 | 6 / 64 [4,4 % – 19,0 %] | 5,05 (+0,30 ± 0,28) | 7,16 (+0,44 ± 0,41) | 10,13 (+0,98 ± 1,27) | 30,64 (+0,95 ± 2,53) | 21,98 (+1,05 ± 2,01) | 24,1 % | 8 441 | 145 155 | 51 074 |
| **Crâ Terre + Crâ Terre (déf.)** — recommandée | 64 | 5 / 64 [3,4 % – 17,0 %] | 4,89 (+0,14 ± 0,31) | 6,98 (+0,27 ± 0,36) | 9,95 (+0,81 ± 1,24) | 32,11 (+2,42 ± 2,50) | 22,94 (+2,00 ± 1,77) | 29,1 % | 9 943 | 144 758 | 50 740 |
| Crâ Feu + Crâ Terre (déf.) | 64 | 2 / 64 [0,9 % – 10,7 %] | 4,67 (−0,08 ± 0,29) | 6,78 (+0,06 ± 0,31) | 9,53 (+0,39 ± 1,22) | 31,22 (+1,53 ± 2,49) | 22,02 (+1,08 ± 1,76) | 27,0 % | 11 516 | 145 253 | 53 760 |
| Crâ Feu + Crâ Terre | 64 | 4 / 64 [2,5 % – 15,0 %] | 4,75 | 6,72 | 9,14 | 29,69 | 20,94 | 29,6 % | 9 266 | 137 934 | 50 830 |
| Crâ Air entrave + Crâ Terre | 64 | 3 / 64 [1,6 % – 12,9 %] | 4,45 (−0,30 ± 0,29) | 6,72 (+0,00 ± 0,32) | 8,89 (−0,25 ± 1,27) | 29,28 (−0,41 ± 2,47) | 20,81 (−0,13 ± 2,10) | 28,0 % | 10 785 | 133 418 | 52 592 |

### 128 graines (`masterSeed` 51-54), référence Crâ Feu + Crâ Terre

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Crâ Terre + Crâ Terre | 128 | 8 / 128 [3,2 % – 11,8 %] | 5,02 (+0,20 ± 0,23) | 7,09 (+0,41 ± 0,28) | 9,81 (+1,13 ± 0,86) | 30,58 (+1,64 ± 1,71) | 21,58 (+0,97 ± 1,29) | 26,1 % | 8 844 | 144 081 | 51 187 |
| **Crâ Terre + Crâ Terre (déf.)** — recommandée | 128 | 9 / 128 [3,7 % – 12,8 %] | 4,87 (+0,04 ± 0,24) | 6,91 (+0,23 ± 0,30) | 9,77 (+1,09 ± 0,87) | 31,69 (+2,75 ± 1,65) | 22,62 (+2,01 ± 1,30) | 29,5 % | 10 269 | 142 802 | 50 625 |
| Crâ Feu + Crâ Terre | 128 | 6 / 128 [2,2 % – 9,8 %] | 4,83 | 6,68 | 8,69 | 28,94 | 20,61 | 30,0 % | 9 073 | 132 493 | 49 627 |

Les deux paires Terre + Terre dépassent Feu + Terre de façon significative (+1,1 ± 0,9 corrompu ; +0,4 ± 0,3 au
tour 19) ; Feu + Terre est abandonnée.

### 256 graines (`masterSeed` 51-58), référence Crâ Terre + Crâ Terre

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Crâ Terre + Crâ Terre | 256 | 12 / 256 [2,7 % – 8,0 %] | 5,00 | 7,06 | 9,76 | 30,32 | 21,27 | 25,4 % | 9 153 | 144 464 | 50 635 |
| **Crâ Terre + Crâ Terre (déf.)** — recommandée | 256 | 15 / 256 [3,6 % – 9,4 %] | 4,84 (−0,16 ± 0,16) | 6,88 (−0,18 ± 0,19) | 9,65 (−0,11 ± 0,60) | 31,29 (+0,97 ± 1,22) | 22,81 (+1,54 ± 0,96) | 28,7 % | 10 960 | 143 813 | 51 420 |

Victoires discordantes (même graine) : 10 graines gagnées par Terre + Terre seulement, 13 par la recommandée seulement,
2 par les deux — les victoires dépendent beaucoup de la graine (trajectoires chaotiques) ; la différence de victoires
n'est pas significative. Corruption égale ; la recommandée **vit plus longtemps** (premier mort +1,54 ± 0,96 tour,
significatif ; tours survécus +0,97 ± 1,22) : c'est elle qui est retenue.

### Comparaison avec l'équipe de référence hors composition (R, 88 graines communes, `masterSeed` 51-53)

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Crâ Terre + Crâ Terre | 96 | 8 / 96 [4,3 % – 15,6 %] | 5,01 (+0,74 ± 0,29) | 7,16 (+1,00 ± 0,39) | 10,11 (+2,35 ± 1,03) | 30,98 (+2,40 ± 2,05) | 22,10 (+0,74 ± 1,59) | 24,7 % | 8 764 | 146 729 | 51 231 |
| **Crâ Terre + Crâ Terre (déf.)** — recommandée | 96 | 7 / 96 [3,6 % – 14,3 %] | 4,80 (+0,58 ± 0,30) | 6,91 (+0,85 ± 0,34) | 9,73 (+2,30 ± 1,11) | 31,54 (+3,83 ± 2,11) | 22,46 (+1,67 ± 1,56) | 29,3 % | 10 254 | 142 356 | 50 337 |
| Crâ Feu + Crâ Terre | 96 | 6 / 96 [2,9 % – 13,0 %] | 4,82 (+0,48 ± 0,26) | 6,78 (+0,63 ± 0,33) | 9,00 (+1,48 ± 0,95) | 29,50 (+1,61 ± 1,86) | 20,86 (−0,23 ± 1,44) | 29,5 % | 9 357 | 135 923 | 50 422 |
| *R — référence hors composition* (Crâ Feu / Enutrof / Iop Terre déf. / Eniripsa) | 88 | 0 / 88 [0,0 % – 4,2 %] | 4,26 | 6,09 | 7,56 | 28,05 | 21,06 | 32,4 % | 11 054 | 127 631 | 53 330 |

(Les bras de cette campagne ont 96 graines sur ces `masterSeed` ; les différences appariées portent sur les 88 graines
où R a été joué dans la campagne de composition.)

## Équipe recommandée

```
cra_terre_mono_vortex,enutrof_retrait_pm_vortex,cra_terre_mono_vortex_def,eniripsa_soin_vortex
```

Commande (reproduit la victoire de référence, voir plus bas) :

```
npx tsx src/cli/simulate.ts fight vortex --team cra_terre_mono_vortex,enutrof_retrait_pm_vortex,cra_terre_mono_vortex_def,eniripsa_soin_vortex --ai fast --seed 963351236 --json
```

Équivalent explicite : `cra_terre_mono@vortex_cra_terre_mono,enutrof_retrait_pm_eau@vortex_enutrof_eau,cra_terre_mono@vortex_cra_terre_mono_def,eniripsa_soin_feu@vortex_eniripsa_feu`.
Les quatre presets dérivés existent dans `data/ai/presets.json` (les deux `cra_terre_mono_vortex*` ajoutés par cette
campagne) ; un preset dérivé garde l'identité de son preset de base pour l'IA (variantes, calibration DPT).

**Taux de victoire : 15 / 256 = 5,9 % [IC 95 % Wilson 3,6 % – 9,4 %]** (IA `fast`, `masterSeed` 51-58). 19 combats sur 256
atteignent 19 / 19 corrompus : 15 victoires (dont 7 sans aucun mort, victoire au tour 46,4 en moyenne) et 4 combats où
l'équipe (2-3 morts) n'achève pas le Vortex avant la limite de 60 tours. Répartition des corrompus en fin de combat :
≤ 6 : 35 combats ; 7-9 : 115 ; 10-12 : 68 ; 13-16 : 17 ; ≥ 17 : 21.

### Par personnage et par source de dégâts

| Équipe (n) | Membre | Dégâts infligés (dont invocations) | Soins | Dégâts subis (dont poussées) | Tour de mort (fin du combat si vivant) | Pacifiste (t ≥ 13) |
|---|---|---|---|---|---|---|
| Crâ Terre + Crâ Terre (256) | Crâ A | 46 560 (0) | 1 538 | 12 766 (1 179) | 24,0 | 19 % |
| Crâ Terre + Crâ Terre (256) | Enutrof | 30 137 (3 597) | 5 148 | 11 434 (3 048) | 27,7 | 21 % |
| Crâ Terre + Crâ Terre (256) | Crâ B | 39 935 (0) | 1 809 | 12 859 (1 247) | 24,2 | 22 % |
| Crâ Terre + Crâ Terre (256) | Eniripsa | 26 840 (0) | 21 833 | 13 575 (3 679) | 29,1 | 27 % |
| Crâ Terre + Crâ Terre (déf.) (256) | Crâ A | 44 850 (0) | 1 772 | 12 968 (1 375) | 24,6 | 23 % |
| Crâ Terre + Crâ Terre (déf.) (256) | Enutrof | 31 063 (4 804) | 1 890 | 10 832 (3 165) | 27,5 | 23 % |
| Crâ Terre + Crâ Terre (déf.) (256) | Crâ B | 42 266 (0) | 2 706 | 14 019 (2 735) | 29,3 | 30 % |
| Crâ Terre + Crâ Terre (déf.) (256) | Eniripsa | 24 460 (0) | 23 319 | 13 600 (3 685) | 28,9 | 29 % |
| Crâ Feu + Crâ Terre (128) | Crâ A | 48 396 (0) | 2 529 | 13 521 (1 689) | 23,8 | 18 % |
| Crâ Feu + Crâ Terre (128) | Enutrof | 26 648 (3 510) | 5 291 | 10 515 (2 643) | 26,5 | 28 % |
| Crâ Feu + Crâ Terre (128) | Crâ B | 35 572 (0) | 1 677 | 12 931 (1 258) | 23,3 | 29 % |
| Crâ Feu + Crâ Terre (128) | Eniripsa | 20 787 (0) | 19 641 | 12 661 (3 483) | 27,4 | 35 % |
| Crâ Feu + Crâ Feu (64) | Crâ A | 36 764 (0) | 2 200 | 11 968 (1 356) | 18,9 | 18 % |
| Crâ Feu + Crâ Feu (64) | Enutrof | 24 810 (3 521) | 5 042 | 10 882 (2 531) | 24,2 | 32 % |
| Crâ Feu + Crâ Feu (64) | Crâ B | 35 492 (0) | 2 642 | 13 731 (1 443) | 20,2 | 22 % |
| Crâ Feu + Crâ Feu (64) | Eniripsa | 15 599 (0) | 18 748 | 13 138 (3 616) | 24,0 | 46 % |

| Équipe (n) | Brabuzar (dont poussées / Neutralisation) | Harpille (dont poison) | Ikargn | Buboxor | Méjaire | Auroraire | Vortex |
|---|---|---|---|---|---|---|---|
| Crâ Terre + Crâ Terre (256) | 16 963 (8 147 / 8 816) | 12 088 (4 600) | 7 182 | 7 590 | 3 655 | 1 465 | 763 |
| Crâ Terre + Crâ Terre (déf.) (256) | 17 799 (9 575 / 8 224) | 11 331 (5 529) | 7 544 | 7 056 | 4 464 | 1 393 | 756 |
| Crâ Feu + Crâ Terre (128) | 16 006 (8 049 / 7 957) | 14 611 (6 061) | 6 233 | 5 426 | 4 300 | 1 341 | 630 |
| Crâ Feu + Crâ Feu (64) | 16 011 (8 172 / 7 840) | 17 697 (7 131) | 5 053 | 4 617 | 4 578 | 964 | 0 |

### Builds (stuff, forgemagie, points, caractéristiques, 22 variantes de sorts)


### Crâ — `cra_terre_mono_vortex` (stuff `vortex_cra_terre_mono`, preset de base `cra_terre_mono`, rôle killer, élément Terre)

| Emplacement | Objet | Niv. | Panoplie | Forgemagie (exo / transcendance) | Lignes (jet max) |
|---|---|---|---|---|---|
| Amulette | Talisman Songe | 200 | Panoplie du Bonimenteur | exo +1 PO | +300 Vi, +60 Fo, +60 Int, +60 Cha, +40 Sa, +1 PA, +15 Do Neutre, +15 Do Terre, +15 Do Feu, +15 Do Eau, +15 PP, +8 % Ré Air, +15 Ré Feu, +10 Tacle, +15 Do Cri |
| Anneau | Anneau du Comte Harebourg | 200 | Panoplie du Comte Harebourg | exo +1 PA | +350 Vi, +50 Fo, +50 Sa, +7 % CC, +15 Do Neutre, +15 Do Terre, -500 Ini, +25 Ré Cri |
| Anneau | Baguistik | 200 | Panoplistik | exo +1 PM | +300 Vi, +40 Fo, +40 Int, +40 Sa, +4 % CC, +1 PO, +7 Do Neutre, +7 Do Terre, +7 Do Feu, +10 Soins, +7 % Ré Eau, +30 Ré Cri |
| Ceinture | Sangle Ouare | 200 | Panoplie du Bonimenteur | transcendance Ta Do Per So (+1 % Do Sorts) | +300 Vi, +40 Cha, +30 Sa, +40 Pui, +1 PM, +2 Invo, +15 PP, -400 Ini, +10 % Ré Eau, +10 % Ré Air, +15 Tacle, -8 Esq PM, +25 Do Cri, +25 Do Pou |
| Bottes | Bottes du Comte Harebourg | 200 | Panoplie du Comte Harebourg | transcendance Ta Do Per So (+1 % Do Sorts) | +400 Vi, +80 Fo, +50 Sa, +1 PM, +20 Do Neutre, +20 Do Terre, +30 Ré Neutre, +15 Tacle, -10 Esq PM, +30 Ré Pou |
| Coiffe | Cornes du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transcendance Ta Do Per So (+1 % Do Sorts) | +450 Vi, +100 Fo, +50 Sa, +6 % CC, +1 Invo, +8 Soins, +15 PP, -300 Ini, +5 % Ré Feu, +5 % Ré Eau, +5 % Ré Air, +12 Fuite, +10 Ret PM, +30 Ré Pou |
| Cape | Cape Ovri | 200 | Panoplie du Bonimenteur | transcendance Ta Do Per So (+1 % Do Sorts) | +400 Vi, +60 Fo, +60 Cha, +50 Sa, +5 % CC, +16 Do Neutre, +16 Do Terre, +16 Do Eau, +400 Ini, +10 % Ré Neutre, +20 Ré Feu, -15 Tacle |
| Bouclier | Bouclistik | 200 | Panoplistik | transcendance Ta Do Per So (+1 % Do Sorts) | +250 Vi, +40 Sa, +50 Pui, +1 PO, +20 PP, +5 % Ré Neutre, +15 Tacle, +40 Do Pou, +7 % Ré Mêlée |
| Arme | Arc du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transcendance Ta Do Per So (+1 % Do Sorts) | +450 Vi, +100 Fo, +50 Sa, +8 % CC, +1 PO, +10 Do Terre, +10 Soins, +15 PP, -200 Ini, +7 % Ré Terre, +7 % Ré Eau, +15 Fuite, +30 Ré Pou |
| Familier/Monture | Volkorne Amande et Pourpre | 60 | — | — | +70 Fo, +1 PA, +70 Ré Pou |
| Dofus/Trophée/Prysma | Dofus Ocre | 160 | — | — | +1 PA, sort passif |
| Dofus/Trophée/Prysma | Impétueux | 150 | — | — | +6 % Do Distance, -6 % Ré Distance |
| Dofus/Trophée/Prysma | Dofus des Glaces | 180 | — | — | +25 Do Neutre, +25 Do Terre, +25 Do Feu, +25 Do Eau, +25 Do Air |
| Dofus/Trophée/Prysma | Prysmenvout | 200 | — | — | +80 Pui, -1000 Ini, sort passif |
| Dofus/Trophée/Prysma | Dofus Pourpre | 110 | — | — | +80 Pui, sort passif |
| Dofus/Trophée/Prysma | Dolmanax | 100 | — | — | +70 Fo, +70 Int, +70 Cha, +70 Agi |

**Points** : 995 / 995 points investis (Vitalité 3, Force 992) → base Vitalité 3, Force 398 ; parchemins +100 dans les six caractéristiques. **Panoplies** : Panoplie du Bonimenteur (3 objets), Panoplie du Comte Harebourg (2 objets), Panoplistik (2 objets), Panoplie du Vénérable Endormi (2 objets). **Build valide** : oui.

**Caractéristiques finales** : 12 PA / 6 PM / 6 PO, **4803 PV**, Vitalité 3753, Sagesse 540, Force 1328, Intelligence 470, Chance 330, Agilité 170 ; résistances 18/20/18/42/26 % (N/T/F/E/A), fixes 30/0/35/0/0, Ré Pou 190, Ré Cri 110, % Ré mêlée/distance 7/-6 ; Puissance 300, Dommages 0, Do élém. 108/124/79/56/25, % Do sorts 6, % Do finaux 0, % Do distance/mêlée 6/0, 45 % CC, Do Cri 40, Soins 68, Ret PA/PM 54/64, Esq PA/PM 54/36, Tacle/Fuite 87/44, Initiative 298.

**Variantes de sorts (22 paires, sort actif / variante écartée)** : 1. **Flèche de Recul** / Flèche Éclatante ; 2. **Flèche Glacée** / Flèche Harcelante ; 3. **Flèche Vagabonde** / Flèche Évasive ; 4. **Carreaux Destructeurs** / Flèche de Barrage ; 5. **Pas Chassé** / Balise Tactique ; 6. **Tir Perçant** / Tirs Éloignés ; 7. **Flèche Détonante** / Flèche Ralentissante ; 8. **Flèche d'Abolition** / Flèche Persécutrice ; 9. **Flèche Assaillante** / Flèche Cinglante ; 10. **Flèche d'Immobilisation** / Flèche Tyrannique ; 11. **Tirs Puissants** / Flèches Amoureuses ; 12. **Flèche de Dispersion** / Flèches Enflammées ; 13. **Flèche Massacrante** / Flèche Explosive ; 14. **Œil de Taupe** / Pluie de Flèches ; 15. **Œil pour Œil** / Flèche Paralysante ; 16. **Représailles** / Balise de Survie ; 17. **Tir de Repli** / Vendetta ; 18. **Flèche Punitive** / Flèche du Jugement ; 19. **Flèche d'Expiation** / Flèche de Rédemption ; 20. **Flèche Perforante** / Flèche Boomerang ; 21. **Flèche Dévorante** / Flèche Fulminante ; 22. **Sentinelle** / Acuité Absolue.

Rotation de référence du preset (mode `scripted`, indicative ; l'IA `fast` choisit librement parmi les sorts actifs) : Tir Perçant → Tirs Puissants → Flèche Punitive → Flèche Massacrante → Flèche d'Abolition.

### Enutrof — `enutrof_retrait_pm_vortex` (stuff `vortex_enutrof_eau`, preset de base `enutrof_retrait_pm_eau`, rôle mpLock, élément Eau)

| Emplacement | Objet | Niv. | Panoplie | Forgemagie (exo / transcendance) | Lignes (jet max) |
|---|---|---|---|---|---|
| Amulette | Amulette Voldelor | 200 | Panoplie de Voldelor | transcendance Rata Ret Pme (+4 Ret PM) | +300 Vi, +70 Cha, +70 Agi, +40 Sa, +1 PA, +12 Do Eau, +12 Do Air, +15 PP, +10 % Ré Feu, +10 % Ré Eau, +7 Fuite, -7 Esq PM, +15 Do Cri |
| Anneau | Bracelet du Piloztère | 200 | Panoplie du Piloztère | exo +1 PA | +300 Vi, +50 Pui, +4 % CC, +2 PO, +10 Do Neutre, +10 Do Terre, +10 Do Eau, +10 % Ré Neutre |
| Anneau | Alliance Gloursonne | 198 | Panoplie Gloursonne | exo +1 PM | +250 Vi, +60 Cha, +60 Agi, +40 Sa, +1 PO, +12 Do Eau, +12 Do Air, +10 PP, +400 Ini, +7 % Ré Neutre, +7 % Ré Terre, +7 % Ré Feu, +5 Tacle |
| Ceinture | Ceinture Voldelor | 200 | Panoplie de Voldelor | transcendance Rata Ret Pme (+4 Ret PM) | +300 Vi, +70 Cha, +70 Agi, +50 Sa, +1 PO, +15 Do Eau, +15 Do Air, +15 PP, +10 % Ré Feu, +10 % Ré Eau, +7 Fuite, -7 Esq PM, +15 Do Cri |
| Bottes | Bottes Voldelor | 200 | Panoplie de Voldelor | transcendance Rata Ret Pme (+4 Ret PM) | +350 Vi, +70 Cha, +70 Agi, +40 Sa, +10 % CC, +1 PM, +12 Do Eau, +12 Do Air, +7 Fuite, +20 Ré Pou |
| Coiffe | Visage de Mureine | 200 | Panoplie du Gouffre | exo +1 PO | +500 Vi, +80 Cha, +50 Sa, +5 % CC, +1 Invo, +20 Do Eau, +20 PP, -300 Ini, +10 % Ré Eau, +7 % Ré Air, +15 Tacle, -15 Fuite, +10 Do Cri |
| Cape | Dorsale de Willorque | 200 | Panoplie du Gouffre | transcendance Rata Ret Pme (+4 Ret PM) | +500 Vi, +100 Cha, +50 Sa, +6 % CC, +10 Do Eau, +12 Soins, +15 PP, -300 Ini, +7 % Ré Terre, +10 % Ré Eau, +10 Tacle, -10 Esq PM, +25 Do Cri |
| Bouclier | Jadis | 200 | — | transcendance Rata Ret Pme (+4 Ret PM) | +250 Vi, +40 Sa, +15 % Ré Neutre, +15 Tacle, +15 Esq PA, +15 Esq PM, +50 Ré Cri, +50 Ré Pou, +7 % Ré Mêlée, +5 % Ré Distance |
| Arme | Lancepince d'Exécrabe | 200 | Panoplie du Gouffre | transcendance Rata Do Eau (+6 Do Eau) | +500 Vi, +90 Cha, +50 Sa, +5 % CC, +12 Do Eau, +15 PP, -300 Ini, +7 % Ré Feu, +10 % Ré Eau, +10 Tacle, +12 Ret PM, -10 Esq PA, +20 Do Cri |
| Familier/Monture | Volkorne Doré et Turquoise | 60 | — | — | +200 Vi, +1 PA, +30 Ret PM |
| Dofus/Trophée/Prysma | Dofus des Glaces | 180 | — | — | +25 Do Neutre, +25 Do Terre, +25 Do Feu, +25 Do Eau, +25 Do Air |
| Dofus/Trophée/Prysma | Entraveur majeur | 150 | — | — | +24 Ret PM, -24 Esq PA |
| Dofus/Trophée/Prysma | Dofus Ivoire | 180 | — | — | +4 % Ré Neutre, +4 % Ré Terre, +4 % Ré Feu, +4 % Ré Eau, +4 % Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus Argenté Scintillant | 180 | — | — | +300 Vi, sort passif |
| Dofus/Trophée/Prysma | Dofus Vulbis | 180 | — | — | +1 PM, sort passif |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |

**Points** : 995 / 995 points investis (Vitalité 695, Chance 300) → base Vitalité 695, Chance 200 ; parchemins +100 dans les six caractéristiques. **Panoplies** : Panoplie de Voldelor (3 objets), Panoplie du Gouffre (3 objets). **Build valide** : oui.

**Caractéristiques finales** : 12 PA / 6 PM / 6 PO, **5745 PV**, Vitalité 4695, Sagesse 460, Force 100, Intelligence 100, Chance 940, Agilité 410 ; résistances 36/18/38/54/21 % (N/T/F/E/A), fixes 40/40/40/40/40, Ré Pou 70, Ré Cri 50, % Ré mêlée/distance 7/5 ; Puissance 50, Dommages 0, Do élém. 35/35/25/134/76, % Do sorts 0, % Do finaux 0, % Do distance/mêlée 0/0, 47 % CC, Do Cri 85, Soins 12, Ret PA/PM 66/152, Esq PA/PM 27/37, Tacle/Fuite 106/62, Initiative 50.

**Variantes de sorts (22 paires, sort actif / variante écartée)** : 1. **Lancer de Pièces** / Monnaie Sonnante ; 2. **Orpaillage** / Force de l'Âge ; 3. **Roulage de Pelle** / Éboulement ; 4. **Opportunité** / Coup de Grisou ; 5. **Musette Animée** / Sac Animé ; 6. **Ruée vers l'Or** / Déambulation ; 7. **Boîte à Outils** / Boîte de Pandore ; 8. **Remblai** / Feu de Mine ; 9. **Clef de Bras** / Clef du Trésor ; 10. **Obsolescence** / Abattement ; 11. **Pelle Animée** / Bêche Animée ; 12. **Avarice** / Décadence ; 13. **Pelle Aurifère** / Tourbière ; 14. **Maladresse** / Âge d'Or ; 15. **Pelle Fantomatique** / Dernier Recours ; 16. **Banqueroute** / Lancer de Pelle ; 17. **Bêche des Anciens** / Souterrain ; 18. **Pelle des Anciens** / Gisement ; 19. **Tamisage** / Péremption ; 20. **Corruption** / Tunnel de Fortune ; 21. **Retraite Anticipée** / Pelle de Fortune ; 22. **Coffre Animé** / Malle Animée.

Rotation de référence du preset (mode `scripted`, indicative ; l'IA `fast` choisit librement parmi les sorts actifs) : Obsolescence → Pelle Aurifère → Maladresse → Maladresse ×4 → Tamisage → Clef de Bras.

### Crâ — `cra_terre_mono_vortex_def` (stuff `vortex_cra_terre_mono_def`, preset de base `cra_terre_mono`, rôle killer, élément Terre)

| Emplacement | Objet | Niv. | Panoplie | Forgemagie (exo / transcendance) | Lignes (jet max) |
|---|---|---|---|---|---|
| Amulette | Talisman Songe | 200 | Panoplie du Bonimenteur | exo +1 PO | +300 Vi, +60 Fo, +60 Int, +60 Cha, +40 Sa, +1 PA, +15 Do Neutre, +15 Do Terre, +15 Do Feu, +15 Do Eau, +15 PP, +8 % Ré Air, +15 Ré Feu, +10 Tacle, +15 Do Cri |
| Anneau | Anneau du Comte Harebourg | 200 | Panoplie du Comte Harebourg | exo +1 PA | +350 Vi, +50 Fo, +50 Sa, +7 % CC, +15 Do Neutre, +15 Do Terre, -500 Ini, +25 Ré Cri |
| Anneau | Baguistik | 200 | Panoplistik | exo +1 PM | +300 Vi, +40 Fo, +40 Int, +40 Sa, +4 % CC, +1 PO, +7 Do Neutre, +7 Do Terre, +7 Do Feu, +10 Soins, +7 % Ré Eau, +30 Ré Cri |
| Ceinture | Sangle Ouare | 200 | Panoplie du Bonimenteur | transcendance Rata Vi (+100 Vi) | +300 Vi, +40 Cha, +30 Sa, +40 Pui, +1 PM, +2 Invo, +15 PP, -400 Ini, +10 % Ré Eau, +10 % Ré Air, +15 Tacle, -8 Esq PM, +25 Do Cri, +25 Do Pou |
| Bottes | Bottes du Comte Harebourg | 200 | Panoplie du Comte Harebourg | transcendance Rata Vi (+100 Vi) | +400 Vi, +80 Fo, +50 Sa, +1 PM, +20 Do Neutre, +20 Do Terre, +30 Ré Neutre, +15 Tacle, -10 Esq PM, +30 Ré Pou |
| Coiffe | Cornes du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transcendance Pata Ré Pou (+12 Ré Pou) | +450 Vi, +100 Fo, +50 Sa, +6 % CC, +1 Invo, +8 Soins, +15 PP, -300 Ini, +5 % Ré Feu, +5 % Ré Eau, +5 % Ré Air, +12 Fuite, +10 Ret PM, +30 Ré Pou |
| Cape | Cape Ovri | 200 | Panoplie du Bonimenteur | transcendance Rata Vi (+100 Vi) | +400 Vi, +60 Fo, +60 Cha, +50 Sa, +5 % CC, +16 Do Neutre, +16 Do Terre, +16 Do Eau, +400 Ini, +10 % Ré Neutre, +20 Ré Feu, -15 Tacle |
| Bouclier | Bouclistik | 200 | Panoplistik | transcendance Rata Vi (+100 Vi) | +250 Vi, +40 Sa, +50 Pui, +1 PO, +20 PP, +5 % Ré Neutre, +15 Tacle, +40 Do Pou, +7 % Ré Mêlée |
| Arme | Arc du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transcendance Pata Ré Pou (+12 Ré Pou) | +450 Vi, +100 Fo, +50 Sa, +8 % CC, +1 PO, +10 Do Terre, +10 Soins, +15 PP, -200 Ini, +7 % Ré Terre, +7 % Ré Eau, +15 Fuite, +30 Ré Pou |
| Familier/Monture | Volkorne Doré et Pourpre | 60 | — | — | +200 Vi, +70 Fo, +1 PA |
| Dofus/Trophée/Prysma | Dofus Ocre | 160 | — | — | +1 PA, sort passif |
| Dofus/Trophée/Prysma | Dofus Ivoire | 180 | — | — | +4 % Ré Neutre, +4 % Ré Terre, +4 % Ré Feu, +4 % Ré Eau, +4 % Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus Argenté Scintillant | 180 | — | — | +300 Vi, sort passif |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus des Glaces | 180 | — | — | +25 Do Neutre, +25 Do Terre, +25 Do Feu, +25 Do Eau, +25 Do Air |
| Dofus/Trophée/Prysma | Dofus Pourpre | 110 | — | — | +80 Pui, sort passif |

**Points** : 995 / 995 points investis (Vitalité 695, Force 300) → base Vitalité 695, Force 200 ; parchemins +100 dans les six caractéristiques. **Panoplies** : Panoplie du Bonimenteur (3 objets), Panoplie du Comte Harebourg (2 objets), Panoplistik (2 objets), Panoplie du Vénérable Endormi (2 objets). **Build valide** : oui.

**Caractéristiques finales** : 12 PA / 6 PM / 6 PO, **6395 PV**, Vitalité 5345, Sagesse 540, Force 1060, Intelligence 400, Chance 260, Agilité 100 ; résistances 22/24/22/46/30 % (N/T/F/E/A), fixes 70/40/75/40/40, Ré Pou 144, Ré Cri 110, % Ré mêlée/distance 7/0 ; Puissance 220, Dommages 0, Do élém. 108/124/79/56/25, % Do sorts 0, % Do finaux 0, % Do distance/mêlée 0/0, 45 % CC, Do Cri 40, Soins 68, Ret PA/PM 54/64, Esq PA/PM 54/36, Tacle/Fuite 80/37, Initiative -180.

**Variantes de sorts (22 paires, sort actif / variante écartée)** : 1. **Flèche de Recul** / Flèche Éclatante ; 2. **Flèche Glacée** / Flèche Harcelante ; 3. **Flèche Vagabonde** / Flèche Évasive ; 4. **Carreaux Destructeurs** / Flèche de Barrage ; 5. **Pas Chassé** / Balise Tactique ; 6. **Tir Perçant** / Tirs Éloignés ; 7. **Flèche Détonante** / Flèche Ralentissante ; 8. **Flèche d'Abolition** / Flèche Persécutrice ; 9. **Flèche Assaillante** / Flèche Cinglante ; 10. **Flèche d'Immobilisation** / Flèche Tyrannique ; 11. **Tirs Puissants** / Flèches Amoureuses ; 12. **Flèche de Dispersion** / Flèches Enflammées ; 13. **Flèche Massacrante** / Flèche Explosive ; 14. **Œil de Taupe** / Pluie de Flèches ; 15. **Œil pour Œil** / Flèche Paralysante ; 16. **Représailles** / Balise de Survie ; 17. **Tir de Repli** / Vendetta ; 18. **Flèche Punitive** / Flèche du Jugement ; 19. **Flèche d'Expiation** / Flèche de Rédemption ; 20. **Flèche Perforante** / Flèche Boomerang ; 21. **Flèche Dévorante** / Flèche Fulminante ; 22. **Sentinelle** / Acuité Absolue.

Rotation de référence du preset (mode `scripted`, indicative ; l'IA `fast` choisit librement parmi les sorts actifs) : Tir Perçant → Tirs Puissants → Flèche Punitive → Flèche Massacrante → Flèche d'Abolition.

### Eniripsa — `eniripsa_soin_vortex` (stuff `vortex_eniripsa_feu`, preset de base `eniripsa_soin_feu`, rôle healer, élément Feu)

| Emplacement | Objet | Niv. | Panoplie | Forgemagie (exo / transcendance) | Lignes (jet max) |
|---|---|---|---|---|---|
| Amulette | Talisman Igans | 200 | Panoplie Pnose | transcendance Rata Vi (+100 Vi) | +350 Vi, +60 Int, +60 Cha, +50 Sa, +4 % CC, +1 PA, +1 PO, +20 Do Feu, +20 Do Eau, +7 % Ré Neutre, +7 % Ré Terre |
| Anneau | Malédiction du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | exo +1 PA | +300 Vi, +100 Int, +20 Sa, +3 % CC, +10 PP, -300 Ini, +7 % Ré Feu, +7 % Ré Eau, +10 Ret PA, +15 Ré Pou |
| Anneau | Baguistik | 200 | Panoplistik | exo +1 PM | +300 Vi, +40 Fo, +40 Int, +40 Sa, +4 % CC, +1 PO, +7 Do Neutre, +7 Do Terre, +7 Do Feu, +10 Soins, +7 % Ré Eau, +30 Ré Cri |
| Ceinture | Ceintrigue | 200 | Panoplie Pnose | transcendance Rata Vi (+100 Vi) | +350 Vi, +60 Int, +60 Cha, +40 Sa, +4 % CC, +1 PO, +20 Do Feu, +20 Do Eau, +15 Soins, +10 % Ré Air, +20 Do Pou |
| Bottes | Bottes Owesli | 200 | Panoplie Pnose | transcendance Rata Vi (+100 Vi) | +400 Vi, +50 Int, +50 Cha, +40 Sa, +1 PM, +1 PO, +20 Do Feu, +20 Do Eau, +7 % Ré Neutre, +7 % Ré Terre, +20 Do Pou |
| Coiffe | Masquegel | 200 | Panoplie Martegel | transcendance Rata Vi (+100 Vi) | +400 Vi, +80 Int, +80 Agi, +40 Sa, -10 % CC, +1 Invo, +15 Do Feu, +15 Do Air, +10 % Ré Neutre, +10 % Ré Eau, +10 Fuite, +10 Esq PA |
| Cape | Manteau du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transcendance Rata Vi (+100 Vi) | +400 Vi, +100 Int, +50 Sa, +7 % CC, +1 Invo, +10 Do Feu, +15 Soins, +15 PP, -200 Ini, +5 % Ré Terre, +5 % Ré Feu, +5 % Ré Eau, +12 Fuite, +30 Ré Pou |
| Bouclier | Bouclistik | 200 | Panoplistik | transcendance Rata Vi (+100 Vi) | +250 Vi, +40 Sa, +50 Pui, +1 PO, +20 PP, +5 % Ré Neutre, +15 Tacle, +40 Do Pou, +7 % Ré Mêlée |
| Arme | Marteau Possédé | 200 | — | — | +400 Vi, +50 Int, +60 Sa, +50 Pui, +3 % CC, +1 Invo, +12 Do Feu, +20 Soins, +10 PP, -300 Ini, +7 % Ré Neutre, +7 % Ré Feu, +7 Fuite, -6 Tacle, +15 Ré Cri |
| Familier/Monture | Volkorne Saphir et Orchidée | 60 | — | — | +70 Int, +1 PA, +8 % Ré Eau |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus Ocre | 160 | — | — | +1 PA, sort passif |
| Dofus/Trophée/Prysma | Dofus Ivoire | 180 | — | — | +4 % Ré Neutre, +4 % Ré Terre, +4 % Ré Feu, +4 % Ré Eau, +4 % Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dolmanax | 100 | — | — | +70 Fo, +70 Int, +70 Cha, +70 Agi |
| Dofus/Trophée/Prysma | Dofus Vulbis | 180 | — | — | +1 PM, sort passif |
| Dofus/Trophée/Prysma | Dofus Argenté Scintillant | 180 | — | — | +300 Vi, sort passif |

**Points** : 995 / 995 points investis (Vitalité 395, Intelligence 600) → base Vitalité 395, Intelligence 300 ; parchemins +100 dans les six caractéristiques. **Panoplies** : Panoplie Pnose (3 objets), Panoplie du Vénérable Endormi (2 objets), Panoplistik (2 objets). **Build valide** : oui.

**Caractéristiques finales** : 12 PA / 6 PM / 6 PO, **5745 PV**, Vitalité 4695, Sagesse 520, Force 310, Intelligence 1220, Chance 380, Agilité 250 ; résistances 40/33/33/51/14 % (N/T/F/E/A), fixes 40/40/40/40/40, Ré Pou 45, Ré Cri 75, % Ré mêlée/distance 7/0 ; Puissance 100, Dommages 0, Do élém. 17/23/120/60/15, % Do sorts 0, % Do finaux 0, % Do distance/mêlée 0/0, 15 % CC, Do Cri 0, Soins 140, Ret PA/PM 62/52, Esq PA/PM 62/52, Tacle/Fuite 34/54, Initiative 360.

**Variantes de sorts (22 paires, sort actif / variante écartée)** : 1. **Mot Espiègle** / Mot Malicieux ; 2. **Mot Tapageur** / Cri Assourdissant ; 3. **Mot Vampirique** / Sanglots ; 4. **Onguent Ancestral** / Juron ; 5. **Mot d'Amitié** / Mot Alchimique ; 6. **Mot Stimulant** / Mot de Déclin ; 7. **Scalpel** / Mot de Frayeur ; 8. **Vacarme** / Lamentations ; 9. **Mot Turbulent** / Mot Furieux ; 10. **Mot Galvanisant** / Mot Vivifiant ; 11. **Mot Farceur** / Mot Défendu ; 12. **Peinture de Guerre** / Mot Secret ; 13. **Mot de Jouvence** / Mot Déprimant ; 14. **Cri de Guerre** / Mot Rituel ; 15. **Mot Interdit** / Mot Exsangue ; 16. **Mot Accablant** / Mot Décourageant ; 17. **Mot Distrayant** / Chapardage ; 18. **Bosquet Enchanté** / Mot Fleuri ; 19. **Fontaine de Jouvence** / Mot d'Envol ; 20. **Chœur Strident** / Pinceau Tribal ; 21. **Cryothérapie** / Murmure ; 22. **Mot de Reconstitution** / Mot de Solidarité.

Rotation de référence du preset (mode `scripted`, indicative ; l'IA `fast` choisit librement parmi les sorts actifs) : Mot Stimulant → Mot Turbulent → Mot Tapageur → Mot de Jouvence → Fontaine de Jouvence → Vacarme.

## Séquence de combat observée

Moyennes par phase sur 8 replays de l'équipe recommandée (`.cache/userteam/rep/U_TTd/`, graines de `masterSeed` 51
et 55-58) : 4 victoires (963351236, 3473059625, 1502081690, 3173349455) et 4 défaites (362788747, 84626808, 36416385,
3993426454) ; « cible prioritaire » et « contrôle PM » = notes `aiNote` de l'IA d'équipe (`focus` « Cible prioritaire de
l'équipe », `intent` « Contrôler X : PM ≤ … ») par combat ; sorts = les plus lancés dans la phase (lancers par combat) ; « dégâts » = dégâts aux monstres de vague (ceux faits au
Vortex en phase 2 ne sont pas comptés) ; « kills » = morts de monstres, ressuscités compris.

**Victoires (4 combats)**

| Phase | Kills | Corrompus | Cible prioritaire de l'équipe (notes `focus` / combat) | Contrôle PM visé | Crâ A : dégâts / kills / sorts | Crâ B (déf.) : dégâts / kills / sorts | Enutrof : dégâts / kills / sorts | Eniripsa : soins / dégâts / pacifié |
|---|---|---|---|---|---|---|---|---|
| Vague 1 (tours 1-6) | 7,5 | 1,5 | Méjaire ×4,5, Ikargn ×4,3, Harpille ×1,3 | Méjaire ×4,3, Harpille ×2,5, Ikargn ×0,3 | 9227 / 3 / Œil pour Œil ×4,0, Tir Perçant ×1,8, Carreaux Destructeurs ×1,5 | 7763 / 2 / Flèche Punitive ×3,3, Œil pour Œil ×3,0, Tirs Puissants ×2,8 | 4838 / 1,8 / Clef de Bras ×4,3, Obsolescence ×3,3, Pelle Aurifère ×2,0 | 2118 / 4427 / 0,5 sur 6 tours |
| Vague 2 (tours 7-12) | 9,25 | 2,75 | Harpille ×3,0, Buboxor ×2,5, Brabuzar ×1,3 | Harpille ×3,5, Buboxor ×2,3, Brabuzar ×1,8 | 13326 / 2,5 / Carreaux Destructeurs ×3,8, Œil pour Œil ×3,5, Flèche Punitive ×2,0 | 11038 / 2,3 / Carreaux Destructeurs ×5,3, Flèche Punitive ×2,5, Tirs Puissants ×2,3 | 7123 / 2,5 / Obsolescence ×3,3, Pelle des Anciens ×2,5, Bêche des Anciens ×2,3 | 12095 / 5074 / 0,8 sur 6 tours |
| Vague 3 (tours 13-18) | 10,5 | 2,75 | Méjaire ×7,0, Harpille ×1,0, Brabuzar ×0,5 | Méjaire ×3,8, Harpille ×2,8, Brabuzar ×2,5 | 12929 / 2,8 / Œil pour Œil ×4,3, Carreaux Destructeurs ×3,8, Tir de Repli ×2,5 | 11622 / 3 / Carreaux Destructeurs ×4,0, Flèche Punitive ×3,5, Tirs Puissants ×2,3 | 6359 / 2,3 / Obsolescence ×2,5, Pelle des Anciens ×2,0, Tamisage ×2,0 | 16440 / 4725 / 1,3 sur 6 tours |
| Vague 4 (tours 19-24) | 10,75 | 3,5 | Méjaire ×5,8, Ikargn ×3,8, Harpille ×1,3 | Brabuzar ×5,5, Méjaire ×2,5, Harpille ×0,8 | 12979 / 2,3 / Flèche Punitive ×4,0, Flèche Vagabonde ×3,0, Œil pour Œil ×2,3 | 11300 / 3,3 / Flèche Punitive ×2,8, Tirs Puissants ×2,5, Œil pour Œil ×2,5 | 9117 / 3,8 / Obsolescence ×4,0, Pelle des Anciens ×3,8, Tamisage ×3,0 | 21874 / 5140 / 1,8 sur 6 tours |
| Vague 5 (tours 25 → Action !) | 19,25 | 8,5 | Ikargn ×5,5, Buboxor ×2,5, Méjaire ×2,0 | Buboxor ×6,8, Brabuzar ×6,0, Ikargn ×1,8 | 20907 / 6,5 / Flèche Punitive ×6,3, Tir Perçant ×5,0, Flèche Dévorante ×4,3 | 14132 / 4,3 / Carreaux Destructeurs ×4,8, Flèche Dévorante ×4,3, Tirs Puissants ×4,0 | 13952 / 4,8 / Clef de Bras ×6,8, Tamisage ×4,0, Pelle des Anciens ×3,5 | 34158 / 12656 / 0,8 sur 11,5 tours |
| Phase 2 (après Action !) | 21 | 0 | Vortex ×0,5 | Vortex ×1,0 | 0 / 1 / Tir de Repli ×4,8, Flèche de Recul ×3,3, Flèche Dévorante ×2,5 | 0 / 0,5 / Tir Perçant ×3,5, Flèche Dévorante ×2,8, Œil pour Œil ×2,0 | 0 / 0,5 / Pelle des Anciens ×4,8, Tamisage ×3,8, Lancer de Pièces ×2,3 | 26513 / 0 / 3,8 sur 7,5 tours |

**Défaites (4 combats)**

| Phase | Kills | Corrompus | Cible prioritaire de l'équipe (notes `focus` / combat) | Contrôle PM visé | Crâ A : dégâts / kills / sorts | Crâ B (déf.) : dégâts / kills / sorts | Enutrof : dégâts / kills / sorts | Eniripsa : soins / dégâts / pacifié |
|---|---|---|---|---|---|---|---|---|
| Vague 1 (tours 1-6) | 7,75 | 1,25 | Méjaire ×3,8, Ikargn ×3,5, Harpille ×2,3 | Méjaire ×5,5, Harpille ×2,0, Ikargn ×0,8 | 10626 / 2,5 / Œil pour Œil ×2,8, Carreaux Destructeurs ×2,5, Tir Perçant ×2,3 | 7055 / 2,8 / Œil pour Œil ×3,0, Tirs Puissants ×2,5, Flèche Punitive ×2,5 | 3766 / 1,3 / Clef de Bras ×3,5, Pelle des Anciens ×2,3, Pelle Aurifère ×2,3 | 1487 / 4454 / 0,3 sur 6 tours |
| Vague 2 (tours 7-12) | 7,75 | 2,25 | Harpille ×4,0, Buboxor ×1,5, Brabuzar ×0,5 | Buboxor ×2,5, Harpille ×2,5, Brabuzar ×2,3 | 11597 / 2 / Carreaux Destructeurs ×5,5, Œil pour Œil ×2,8, Flèche Punitive ×1,8 | 10119 / 3,3 / Carreaux Destructeurs ×3,8, Œil pour Œil ×3,3, Tir Perçant ×3,3 | 8736 / 1,5 / Pelle des Anciens ×3,8, ~Déblayage ×3,5, Tamisage ×3,0 | 13010 / 4573 / 0 sur 6 tours |
| Vague 3 (tours 13-18) | 9,75 | 3,5 | Méjaire ×6,8, Buboxor ×1,8, Harpille ×1,0 | Méjaire ×5,3, Brabuzar ×2,5, Harpille ×2,3 | 13186 / 2,5 / Carreaux Destructeurs ×4,8, Flèche Punitive ×3,3, Œil pour Œil ×2,5 | 12709 / 5 / Carreaux Destructeurs ×4,5, Œil pour Œil ×3,8, Tir Perçant ×1,8 | 5803 / 0,8 / Pelle des Anciens ×3,3, Pelle Aurifère ×2,3, Tamisage ×2,3 | 15066 / 4760 / 1,3 sur 6 tours |
| Vague 4 (tours 19-24) | 8,25 | 2 | Méjaire ×4,3, Ikargn ×2,0, Harpille ×0,8 | Brabuzar ×6,3, Méjaire ×4,3, Ikargn ×2,5 | 11055 / 3 / Œil pour Œil ×3,3, Flèche Punitive ×2,8, Carreaux Destructeurs ×1,8 | 9361 / 2,8 / Carreaux Destructeurs ×4,0, Œil pour Œil ×3,3, Tir Perçant ×2,0 | 6568 / 2 / Tamisage ×2,8, Obsolescence ×2,3, ~Prospection ×1,5 | 19863 / 5608 / 2,3 sur 6 tours |
| Vague 5 (tours 25 → Action !) | 7,25 | 2,75 | Ikargn ×3,0, Méjaire ×1,8, Harpille ×1,0 | Buboxor ×6,5, Harpille ×4,5, Brabuzar ×4,0 | 12902 / 3,5 / Flèche Punitive ×5,0, Œil pour Œil ×3,0, Tir Perçant ×2,5 | 11838 / 2,3 / Œil pour Œil ×5,7, Carreaux Destructeurs ×4,0, Tir Perçant ×4,0 | 9913 / 2 / Pelle des Anciens ×4,0, Obsolescence ×3,0, Lancer de Pièces ×3,0 | 22966 / 7961 / 1,8 sur 8,8 tours |

Ce que l'on voit :

1. **Vague 1 (tours 1-6 : Vortex, Ikargn, Méjaire, Harpille)** : l'équipe vise d'abord la Méjaire (focus et contrôle de
   PM), puis l'Ikargn ; les deux Crâs Terre ouvrent à *Œil pour Œil* / *Carreaux Destructeurs* / *Flèche Punitive*
   avec *Tir Perçant* + *Tirs Puissants* ; l'Enutrof verrouille les PM (*Clef de Bras*, *Obsolescence*, *Maladresse*).
   ≈ 7,5 kills, 1,3-1,5 corrompu (le premier cycle d'heures).
2. **Vague 2 (tours 7-12 : Harpille ×2, Buboxor, Brabuzar)** : focus Harpilles puis Buboxor ; le Crâ A y encaisse 3 000 à 4 000 dégâts
   (poison et *Superfidie* des Harpilles) et l'Eniripsa y soigne 12 000 à 13 000 PV. Les victoires corrompent 2,75 monstres ici contre 2,25 dans les défaites.
3. **Vague 3 (tours 13-18 : Méjaire ×2, Harpille, Brabuzar)** : focus Méjaires (7 notes par combat) ; les Crâs Terre y
   font 11 600 à 13 200 dégâts chacun. Le *Pacifiste* commence à toucher l'Eniripsa et l'Enutrof.
4. **Vague 4 (tours 19-24 : Brabuzar ×2, Méjaire, Ikargn)** : **c'est là que les combats se séparent** — victoires :
   3,5 corrompus dans la vague, aucun mort ; défaites : 2,0 corrompus, premiers morts (poussées et *Neutralisation* des
   Brabuzars, Méjaire), Eniripsa pacifiée 2,3 tours sur 6.
5. **Vague 5 (tours 25 → *Action !*, Buboxor ×2, Brabuzar, Ikargn)** : victoires : 19 kills et 8,5 corruptions en
   ≈ 11 tours, les quatre personnages vivants ; défaites : 2,75 corruptions, morts en chaîne.
6. **Phase 2 (après *Action !*)** : Vortex tué en ≈ 7 tours ; les Crâs et l'Eniripsa sont pacifiés (*Heuristique* du
   Vortex) 2 à 4 tours sur 7 ; l'Enutrof (rarement pacifié) et les soins de l'Eniripsa portent la fin.

**Combat de référence — graine 963351236, victoire au tour 42, aucun mort** (19 / 19 corrompus au tour 34 ; corrompus
cumulés par tour : 0, 0, 0, 0, 1, 1, 2, 3, 3, 3, 3, 4, 4, 6, 6, 7, 7, 7, 8, 8, 9, 9, 10, 11, 11, 11, 11, 12, 14, 15, 15,
15, 17, 19) :

```

## Vague 1 (tours 1-6) — 7 kills, 1 corrompus
  cible prioritaire : Méjaire ×7, Ikargn ×5, Harpille ×1 ; contrôle (PM) : Méjaire ×7, Harpille ×3 ; tactiques : enchaînement (état / buff puis frappe) ×2, préparation du burst ×2, soin qui purge le poison ×1, glyphe d'horloge ×1
- Crâ: 6 tours (0 pacifié), dégâts vagues 9805, kills 3 (dont 1 corruptions), soins 180, subis 452
    sorts : Œil pour Œil ×4, Flèche Dévorante ×2, Carreaux Destructeurs ×2, Flèche Punitive ×2, Flèche Vagabonde ×1, Tirs Puissants ×1, Pas Chassé ×1
    tour type : ↦4 → Flèche Vagabonde → Flèche Dévorante → Œil pour Œil → Flèche Dévorante (1×) | ↦5 → Carreaux Destructeurs → Tirs Puissants → Carreaux Destructeurs → Œil pour Œil (1×)
- Enutrof: 6 tours (0 pacifié), dégâts vagues 4286, kills 1 (dont 0 corruptions), soins 1296, subis 412
    sorts : Clef de Bras ×5, Pelle Aurifère ×4, Maladresse ×3, Pelle des Anciens ×2, Obsolescence ×2, Pelle Fantomatique ×2, Remblai ×2
    tour type : ↦1 → Pelle Aurifère → ↦2 → Tamisage → Clef de Bras → Clef de Bras → Maladresse (1×) | Pelle Aurifère → Pelle Aurifère → Pelle des Anciens → ↦4 (1×)
- Crâ 2: 6 tours (1 pacifié), dégâts vagues 6338, kills 1 (dont 0 corruptions), soins 0, subis 617
    sorts : Flèche Punitive ×4, Tirs Puissants ×3, Œil pour Œil ×3, Tir Perçant ×3, Carreaux Destructeurs ×2, Tir de Repli ×2, Flèche Assaillante ×1
    tour type : Flèche Assaillante → Tirs Puissants → Œil pour Œil → ↦5 → Flèche Punitive (1×) | ↦1 → Œil pour Œil (1×)
- Eniripsa: 6 tours (0 pacifié), dégâts vagues 5481, kills 2 (dont 0 corruptions), soins 2710, subis 270
    sorts : ~Prévention ×10, Mot Galvanisant ×5, Mot Turbulent ×3, Mot Distrayant ×3, ~Bisou Magique ×3, Chœur Strident ×2, Fontaine de Jouvence ×2
    tour type : ↦3 → Mot Espiègle → ↦2 → Chœur Strident → ↦1 → Mot Turbulent (1×) | ↦5 → Fontaine de Jouvence → ↦1 → Mot d'Amitié → Mot Galvanisant → Cryothérapie (1×)

## Vague 2 (tours 7-12) — 10 kills, 3 corrompus
  cible prioritaire : Buboxor ×3, Harpille ×3, Brabuzar ×1 ; contrôle (PM) : Brabuzar ×3, Buboxor ×3, Harpille ×2 ; tactiques : regroupement pour la zone ×2, glyphe d'horloge ×2, soin qui purge le poison ×1, enchaînement (état / buff puis frappe) ×1
- Crâ: 6 tours (0 pacifié), dégâts vagues 15342, kills 4 (dont 2 corruptions), soins 257, subis 4126
    sorts : Œil pour Œil ×4, Flèche Punitive ×4, Tirs Puissants ×3, Carreaux Destructeurs ×3, Flèche Dévorante ×3, Flèche d'Immobilisation ×2, Tir Perçant ×2
    tour type : ↦2 → Œil pour Œil → ↦1 → Flèche d'Immobilisation → Tir Perçant → Flèche Punitive → ↦1 → Tir de Repli → Tirs Puissants (1×) | Œil pour Œil → Carreaux Destructeurs → Flèche Punitive → Flèche Assaillante (1×)
- Enutrof: 6 tours (0 pacifié), dégâts vagues 8606, kills 2 (dont 0 corruptions), soins 1148, subis 182
    sorts : Obsolescence ×4, Tamisage ×4, ~Prospection ×3, Bêche des Anciens ×2, Pelle Aurifère ×2, Lancer de Pièces ×2, Pelle des Anciens ×2
    tour type : ↦4 → Bêche des Anciens → Retraite Anticipée → Bêche des Anciens (1×) | Pelle Aurifère → Obsolescence → Obsolescence → Lancer de Pièces (1×)
- Crâ 2: 6 tours (0 pacifié), dégâts vagues 10571, kills 3 (dont 0 corruptions), soins 438, subis 660
    sorts : Œil de Taupe ×3, Œil pour Œil ×3, Flèche Punitive ×3, Tir de Repli ×2, Flèche de Recul ×2, Tirs Puissants ×2, Carreaux Destructeurs ×2
    tour type : Tir de Repli → Tir de Repli → Flèche de Recul → Œil de Taupe → Flèche de Dispersion → Tir Perçant (1×) | Œil pour Œil → ↦6 → Flèche Massacrante → Tirs Puissants → Flèche Punitive (1×)
- Eniripsa: 6 tours (2 pacifié), dégâts vagues 3723, kills 1 (dont 1 corruptions), soins 11046, subis 690
    sorts : ~Prévention ×29, ~Bisou Magique ×18, Mot Tapageur ×5, Mot Galvanisant ×3, Mot d'Amitié ×3, Vacarme ×3, Mot Distrayant ×2
    tour type : Mot Galvanisant → Mot de Reconstitution → Mot de Jouvence → Mot d'Amitié (1×) | Mot Tapageur → Peinture de Guerre → Mot Distrayant → Mot Galvanisant → Mot Stimulant (1×)

## Vague 3 (tours 13-18) — 10 kills, 3 corrompus
  cible prioritaire : Méjaire ×8 ; contrôle (PM) : Méjaire ×4, Brabuzar ×2, Harpille ×2, Buboxor ×1 ; tactiques : enchaînement (état / buff puis frappe) ×5, regroupement pour la zone ×3, glyphe d'horloge ×1, préparation du burst ×1
- Crâ: 6 tours (1 pacifié), dégâts vagues 10372, kills 2 (dont 0 corruptions), soins 56, subis 2004
    sorts : Carreaux Destructeurs ×5, Œil pour Œil ×4, Tir de Repli ×2, Flèche Vagabonde ×2, Pas Chassé ×2, Flèche Punitive ×2, Flèche Assaillante ×1
    tour type : Flèche Assaillante → ↦5 → Tir de Repli → Carreaux Destructeurs → Flèche Vagabonde (1×) | ↦3 → Carreaux Destructeurs → Pas Chassé → Flèche de Dispersion → Œil pour Œil (1×)
- Enutrof: 6 tours (1 pacifié), dégâts vagues 6616, kills 3 (dont 1 corruptions), soins 513, subis 1572
    sorts : Pelle Aurifère ×3, ~Prospection ×3, Obsolescence ×3, Remblai ×2, Pelle Fantomatique ×2, Ruée vers l'Or ×2, Pelle des Anciens ×2
    tour type : ↦1 → Remblai → Avarice → Remblai → ↦1 → Pelle Fantomatique (1×) | ↦1 → Bêche des Anciens → Ruée vers l'Or → ↦7 → Pelle Aurifère → ↦2 (1×)
- Crâ 2: 6 tours (1 pacifié), dégâts vagues 10039, kills 2 (dont 1 corruptions), soins 338, subis 1169
    sorts : Œil pour Œil ×4, Flèche Punitive ×4, Flèche Vagabonde ×3, Tirs Puissants ×3, Flèche de Dispersion ×2, Carreaux Destructeurs ×2, Tir de Repli ×2
    tour type : ↦2 → Flèche de Dispersion → ↦1 → Carreaux Destructeurs → Carreaux Destructeurs → ↦1 (1×) | ↦1 → Flèche Vagabonde → Tirs Puissants → ↦2 → Œil pour Œil → Flèche Vagabonde → ↦2 → Flèche d'Abolition → ↦1 (1×)
- Eniripsa: 6 tours (1 pacifié), dégâts vagues 5278, kills 3 (dont 1 corruptions), soins 18287, subis 631
    sorts : ~Bisou Magique ×46, ~Prévention ×20, Mot Galvanisant ×4, Mot Distrayant ×4, Mot Turbulent ×3, Peinture de Guerre ×3, Vacarme ×2
    tour type : Cri de Guerre → Scalpel → ↦3 → Mot Tapageur → ↦1 → Mot Galvanisant (1×) | ↦1 → Bosquet Enchanté → ↦1 → Chœur Strident → Vacarme (1×)

## Vague 4 (tours 19-24) — 12 kills, 4 corrompus
  cible prioritaire : Méjaire ×5, Ikargn ×4 ; contrôle (PM) : Brabuzar ×4, Harpille ×1 ; tactiques : enchaînement (état / buff puis frappe) ×7, préparation du burst ×3, regroupement pour la zone ×2, verrou de PM ×2
- Crâ: 6 tours (0 pacifié), dégâts vagues 19781, kills 5 (dont 2 corruptions), soins 205, subis 1285
    sorts : Flèche Punitive ×5, Tir Perçant ×4, Œil pour Œil ×3, Carreaux Destructeurs ×3, Tir de Repli ×3, Flèche Vagabonde ×3, Tirs Puissants ×2
    tour type : ↦6 → Tir Perçant → Tirs Puissants → Flèche Punitive → Œil pour Œil → ↦1 → Flèche Assaillante (1×) | ↦4 → Œil pour Œil → Tir Perçant → Flèche Punitive → ↦2 → Carreaux Destructeurs (1×)
- Enutrof: 6 tours (0 pacifié), dégâts vagues 10386, kills 3 (dont 1 corruptions), soins 3945, subis 3919
    sorts : Obsolescence ×5, Pelle des Anciens ×4, Clef de Bras ×3, Tamisage ×2, Lancer de Pièces ×2, ~Déblayage ×2, Boîte à Outils ×1
    tour type : Boîte à Outils → Remblai → ↦1 → Pelle Aurifère → Obsolescence (1×) | ↦6 → Pelle des Anciens → Clef de Bras → Obsolescence → Obsolescence (1×)
- Crâ 2: 6 tours (0 pacifié), dégâts vagues 9950, kills 4 (dont 1 corruptions), soins 265, subis 666
    sorts : Flèche Punitive ×5, Flèche Assaillante ×4, Tir Perçant ×3, Flèche d'Abolition ×3, Tirs Puissants ×3, Pas Chassé ×2, Œil pour Œil ×2
    tour type : ↦3 → Tir Perçant → Flèche Punitive → Pas Chassé → Œil pour Œil → Flèche d'Abolition (1×) | Tirs Puissants → ↦7 → Carreaux Destructeurs → Flèche Punitive → Œil pour Œil (1×)
- Eniripsa: 6 tours (3 pacifié), dégâts vagues 1945, kills 0 (dont 0 corruptions), soins 21720, subis 2029
    sorts : ~Bisou Magique ×49, ~Prévention ×22, Mot Tapageur ×4, Vacarme ×4, Mot Galvanisant ×3, Mot de Reconstitution ×1, Mot d'Amitié ×1
    tour type : ↦1 → Mot Tapageur → Mot Galvanisant → ↦1 (1×) | ↦2 → Mot Galvanisant → ↦5 → Mot de Reconstitution → Mot d'Amitié → Fontaine de Jouvence (1×)

## Vague 5 (tours 25-34) — 17 kills, 8 corrompus
  cible prioritaire : Buboxor ×4, Ikargn ×3, Méjaire ×2, Brabuzar ×1 ; contrôle (PM) : Buboxor ×9, Brabuzar ×9, Méjaire ×2, Ikargn ×1 ; tactiques : enchaînement (état / buff puis frappe) ×6, préparation du burst ×4, verrou de PM ×2, glyphe d'horloge ×1
- Crâ: 10 tours (0 pacifié), dégâts vagues 27309, kills 7 (dont 3 corruptions), soins 1026, subis 4110
    sorts : Flèche Punitive ×6, Œil pour Œil ×6, Tirs Puissants ×4, Flèche Dévorante ×4, Carreaux Destructeurs ×4, Tir Perçant ×3, Flèche de Recul ×3
    tour type : Tir de Repli → Représailles → Tirs Puissants → Flèche Punitive → Œil pour Œil (1×) | ↦2 → Flèche Punitive → Sentinelle → Œil pour Œil → Flèche Dévorante (1×)
- Enutrof: 10 tours (1 pacifié), dégâts vagues 7199, kills 1 (dont 1 corruptions), soins 6347, subis 5142
    sorts : Clef de Bras ×8, Pelle des Anciens ×5, ~Déblayage ×3, Tamisage ×3, Lancer de Pièces ×3, Remblai ×3, Obsolescence ×2
    tour type : Clef de Bras → Clef de Bras → Obsolescence → Pelle des Anciens (1×) | ↦3 → Tamisage → Pelle des Anciens → Obsolescence → Lancer de Pièces (1×)
- Crâ 2: 10 tours (0 pacifié), dégâts vagues 13026, kills 5 (dont 2 corruptions), soins 460, subis 513
    sorts : Flèche Dévorante ×5, Œil pour Œil ×5, Tir Perçant ×4, Tir de Repli ×3, Tirs Puissants ×3, Carreaux Destructeurs ×3, Flèche Punitive ×3
    tour type : Sentinelle → ↦6 → Pas Chassé → Tir de Repli → Tir de Repli → Flèche Dévorante (1×) | ↦5 → Œil pour Œil → Tirs Puissants → Œil de Taupe → ↦2 → Carreaux Destructeurs → Tir Perçant (1×)
- Eniripsa: 10 tours (1 pacifié), dégâts vagues 12909, kills 4 (dont 2 corruptions), soins 28216, subis 7456
    sorts : ~Bisou Magique ×54, ~Prévention ×24, Mot Galvanisant ×7, Mot Distrayant ×6, Mot Tapageur ×5, Mot Turbulent ×4, Fontaine de Jouvence ×3
    tour type : Fontaine de Jouvence → Mot Galvanisant → Bosquet Enchanté → Mot Distrayant (1×) | Mot Tapageur → Mot de Reconstitution → ↦3 → Mot Distrayant (1×)

## Phase 2 (tours 35+) — 21 kills, 0 corrompus
  cible prioritaire : Vortex ×1 ; contrôle (PM) : Vortex ×2 ; tactiques : enchaînement (état / buff puis frappe) ×4, préparation du burst ×1
- Crâ: 8 tours (3 pacifié), dégâts vagues 0, Vortex 4124, kills 2 (dont 0 corruptions), soins 0, subis 2735
    sorts : Tir de Repli ×5, Flèche de Recul ×4, Flèche Vagabonde ×4, Flèche Dévorante ×3, Pas Chassé ×2, Tirs Puissants ×2, Œil pour Œil ×2
    tour type : ↦1 → Flèche de Recul → ↦1 → Flèche de Recul (1×) | Flèche de Recul → Flèche de Recul → ↦5 (1×)
- Enutrof: 7 tours (0 pacifié), dégâts vagues 0, Vortex 5437, kills 0 (dont 0 corruptions), soins 2253, subis 1477
    sorts : Tamisage ×5, Pelle des Anciens ×5, Lancer de Pièces ×4, Clef de Bras ×3, Corruption ×2, Obsolescence ×2, ~Déblayage ×2
    tour type : Corruption → Clef de Bras → Clef de Bras → Tamisage → ↦1 (1×) | Tamisage → Boîte à Outils → Pelle des Anciens → ↦4 → Clef de Bras (1×)
- Crâ 2: 7 tours (1 pacifié), dégâts vagues 0, Vortex 4136, kills 0 (dont 0 corruptions), soins 127, subis 894
    sorts : Flèche Dévorante ×6, Tir Perçant ×4, Œil pour Œil ×3, Flèche de Recul ×2, Flèche Vagabonde ×2, Pas Chassé ×2, Représailles ×2
    tour type : ↦3 → Flèche de Recul → Flèche de Recul → Flèche de Dispersion → Œil de Taupe (1×) | ↦2 → Œil pour Œil → ↦4 → Flèche Vagabonde → Flèche Dévorante → Flèche Dévorante (1×)
- Eniripsa: 8 tours (3 pacifié), dégâts vagues 0, Vortex 1303, kills 0 (dont 0 corruptions), soins 15169, subis 1445
    sorts : ~Prévention ×30, ~Bisou Magique ×28, Mot Galvanisant ×5, Cryothérapie ×5, Mot Turbulent ×5, Vacarme ×3, Mot Tapageur ×3
    tour type : Mot Galvanisant → Cryothérapie → Cryothérapie → Mot Stimulant → Mot de Jouvence (1×) | Chœur Strident → Mot Turbulent → Vacarme (1×)
```

## Replay gagnant

- Graine **963351236** (`masterSeed` 55), équipe recommandée, IA `fast`, variante `default` : **victoire au tour 42,
  aucun mort**, empreinte des événements (harnais) e70f388764d2.
- Commande : `npx tsx src/cli/simulate.ts fight vortex --team cra_terre_mono_vortex,enutrof_retrait_pm_vortex,cra_terre_mono_vortex_def,eniripsa_soin_vortex --ai fast --seed 963351236 --json`
  — vérifiée avec la CLI du dépôt (commit 2952f45) : même combat, événements hors `aiNote` identiques à ceux du
  harnais, 42 tours, 0 mort (`eventsHash` 458909491).
- Fichiers : `.cache/userteam/best-replay-s963351236.json` (harnais, notes `aiNote` comprises) et
  `.cache/userteam/best-replay-cli-s963351236.json` (écrit par la CLI) ; 7 autres replays dans
  `.cache/userteam/rep/U_TTd/`.
- Autres victoires de l'équipe recommandée (graine@tour) : 3473059625@42, 1502081690@44, 3173349455@44 (sans mort),
  434200999@45, 1392886868@45, 2002010388@45, 3993783129@46, 2016508266@46, 2705237477@47, 3274161014@48,
  1954115303@48, 3043959174@51, 1520599237@51, 3895678086@52.

## Ce qui bloque encore (pour CETTE composition)

1. **La corruption des vagues 3 à 5** : 9,65 corrompus sur 19 en moyenne (par vague : 3,00 / 3,63 / 1,86 / 0,80 / 0,36
   sur 4) ; 174 défaites sur 241 sont des « vagues non corrompues au déverrouillage » (le Vortex atteint son tour de
   déverrouillage avec des monstres non corrompus) et 49 des « submersions ». Il faut tuer chaque monstre à une heure
   encore libre ; dès la vague 3, l'équipe tue mais trop tard ou à des heures déjà prises.
2. **Le *Pacifiste* des Méjaires** frappe surtout les soutiens : Eniripsa 29 %, Crâ B (déf.) 30 %, Enutrof 23 %,
   Crâ A 23 % des tours commencés sous *Pacifiste* aux tours ≥ 13. Le Crâ Terre le réduit (deux Crâs Feu : Eniripsa
   pacifiée 46 % de ses tours, n = 64) mais ne le supprime pas ; l'état n'est pas désenvoûtable et seules les
   invocations frappent sous *Pacifiste* (les Crâs n'ont que des balises, qui ne frappent pas : la Balise Tactique a
   coûté −1,8 corrompu).
3. **Les Brabuzars** : 17 800 dégâts subis par combat (9 600 de poussées / collisions, 8 200 de *Neutralisation*) —
   première source de dégâts ; puis les Harpilles (11 300, dont 5 500 de poison).
4. **La fin de partie** : 4 combats sur 256 atteignent 19 / 19 sans tuer le Vortex avant la limite de 60 tours (2-3
   morts) ; les victoires arrivent tard (tour 46 en moyenne).
5. **La puissance brute** : aucun levier de build restant n'est mesurable à 256 graines (profils de stuff, variantes de
   sorts, alternatives d'Eniripsa / d'Enutrof) ; d'après le tour 4 (docs/tuning-log.md), il manque ≈ +25 % de dégâts
   et −20 % de dégâts subis pour gagner un combat sur quatre. Les marges restantes sont dans l'IA (gelée pendant cette
   phase) : plan d'équipe pour tuer les Méjaires fraîches de la vague 3, placement hors des lignes 1-3 des Méjaires,
   gestion des poussées des Brabuzars, fin de partie après 19 / 19.

## Notes pour le produit et l'optimiseur

- **Builds par défaut des deux Crâs** (`data/teams/vortex.json`, commit 2952f45) : « Crâ 1 cra_feu_vortex, Crâ 2
  cra_air_entrave_vortex (deux Crâs = deux builds distincts par défaut) ». Mesuré ici (`masterSeed` 51, n = 32) : Feu +
  Air = 7,09 corrompus, 0 / 32, soit −2,7 ± 1,7 sous Feu + Terre, −3,0 ± 1,5 sous Terre + Terre et −2,1 ± 1,5 sous
  la paire recommandée ; deux builds IDENTIQUES (Terre + Terre)
  sont parmi les meilleurs. La règle « deux builds distincts » n'est pas un bon défaut ; le défaut mesuré est
  `cra_terre_mono_vortex,enutrof_retrait_pm_vortex,cra_terre_mono_vortex_def,eniripsa_soin_vortex`.
- **Reproductibilité des stuffs** : relancé avec la même graine et les mêmes options, `optimizeStuff` ne redonne pas le
  stuff d'une campagne précédente, parce que ses pools de départ incluent les stuffs déjà présents dans
  `data/ai/presets.json` (qui grossit à chaque campagne). Ce n'est pas faux, mais un stuff publié n'est reproductible
  qu'avec le `presets.json` de sa campagne.
- **`fight` écrit dans `web/public/replays/`** (fichier + `index.json`) par défaut : un essai de reproduction modifie le
  dépôt (effet de bord annulé ici à la main).

## Fichiers

- `data/ai/presets.json` (ajouts seulement) : stuffs `vortex_cra_terre_mono`, `vortex_cra_terre_mono_off`,
  `vortex_cra_terre_mono_def`, `vortex_cra_air_entrave_def`, `vortex_eniripsa_air_boost`, `vortex_enutrof_soutien`,
  `vortex_enutrof_pa_po_dps` et leurs presets dérivés `*_vortex[_off|_def]`.
- `docs/reports/vortex-equipe-utilisateur.json` : toutes les mesures de ce rapport (par bras : victoires, IC, corrompus
  par tour et par vague, tours, premier mort, Pacifiste, dégâts par source, par personnage et par cible, causes
  d'échec, graines gagnantes), builds de l'équipe recommandée, séquence par vague.
- `.cache/userteam/` (hors dépôt) : harnais, résultats bruts (`out/<bras>/ms<masterSeed>.c<k>.jsonl`), sorties de
  l'optimiseur (`opt/`), replays (`rep/`, `best-replay-*.json`), séquences (`seq/`).

## Vérification (vérificateur adverse, 2026-10-06)

*Section en cours de rédaction : la mesure (b) sur graines fraîches tourne (`.cache/verify-userteam/`) ; (a), (c) et (d)
sont terminés.*

### (a) Validité en jeu des 7 stuffs ajoutés et diff de `presets.json`

Recalcul indépendant (`.cache/verify-userteam/valid/validate-indep.mts`, copie étendue du validateur de
docs/reports/vortex-stuffs.md) à partir des données brutes seules (`data/dofusdb/equipment.json`, `item-sets.json`,
`breeds.json`, `data/research/characteristics-map.json`, `forgemagie.json`), puis comparaison avec `computeBuildStats` :
**les 7 stuffs ajoutés sont valides, ainsi que les 8 autres stuffs Vortex du tableau « Candidats »** (dont
`vortex_enutrof_eau` et `vortex_eniripsa_feu` de l'équipe recommandée), sans aucun écart de caractéristique avec
`computeBuildStats`.

- Emplacements : 1 objet par emplacement, 2 anneaux différents, 6 Dofus / trophées / prysmaradites, 1 familier ou
  monture ; tous les objets de niveau ≤ 200 ; aucun Dofus ni trophée en double ; exactement 1 prysmaradite par stuff ;
  pas deux trophées de la même famille (Impétueux + Arcaniste dans `vortex_cra_terre_mono_off`).
- Conditions : la seule est `CA>299&CS>299` (Baguette de Torkélonia, `vortex_cra_terre_mono_off`) : vraie sur l'état
  final (Agilité 500, Force 1 168) et aussi sans les lignes de la baguette elle-même (Agilité 440, Force 1 108).
- Panoplies : palier appliqué au nombre réel d'objets ; elles correspondent toutes au tableau « Candidats ».
- Forgemagie : au plus 1 ligne par objet (jamais exo + transcendance sur le même objet) ; exos limités à PA, PM, PO,
  **un seul de chaque par personnage**, jamais sur un objet qui porte déjà la ligne (positive ou négative), et chacun
  nécessaire (sans lui : 11 PA, 5 PM ou 5 PO ; pas d'exo PO quand le stuff a déjà 6 PO) ; chaque transcendance est une
  rune réelle (Ta Do Per So, Rata Vi, Pata Ré Pou, Pata Do Cri, Rata So, Ta Ré Per Eau), de niveau ≤ celui de l'objet,
  densité de ligne ≤ 100 ; 6 transcendances par stuff ; aucune forgemagie sur un Dofus, trophée, familier ou monture.
- Points : 995 / 995 dépensés selon les paliers de `breeds.json` (Force/Agilité 398 = 992 points + 3 Vi ; 200 = 300 points
  + 695 Vi) ; parchemins +100 dans les six caractéristiques.
- Valeurs : PV, PA/PM/PO, % résistances, Ré Pou, Ret PM, points et panoplies du tableau « Candidats » identiques au
  recalcul pour les 15 lignes ; les 7 stuffs sont exactement les meilleurs stuffs des sorties de l'optimiseur
  (`.cache/userteam/opt/*.json`, mêmes objets, mêmes points) et le tableau des proxys (départ → retenu) y correspond.
- `git diff base-userteam -- data/ai/presets.json` : **ajouts seulement**. Comparaison sémantique : les 48 stuffs et
  91 presets du tag sont identiques et dans le même ordre (la seule ligne « supprimée » du diff textuel est la ligne de
  `steamer_soutien_vortex_off`, réécrite avec une virgule finale) ; 7 stuffs et 7 presets dérivés ajoutés, sans doublon
  d'identifiant ; chaque preset dérivé `extends` un preset de base existant de la même classe et du même élément que
  son stuff. `simulate.ts presets` les liste tous « OK », 12 PA / 6 PM / 6 PO.

### (c) Tableaux du rapport contre les données brutes

Recalcul indépendant (`.cache/verify-userteam/check/tables.py`, sans `ana.cjs`) à partir de
`.cache/userteam/out/*/*.jsonl` : **les 7 tableaux de mesures (criblage, variantes, Jugement 64, halving 64 / 128 / 256,
comparaison avec R) concordent cellule par cellule** (495 cellules : n, victoires et IC de Wilson, corrompus t13 / t19 /
total, tours, premier mort, différences appariées ± IC, Pacifiste, poussées, dégâts infligés et subis). Les 46 lignes
correspondantes de `docs/reports/vortex-equipe-utilisateur.json` concordent aussi. Vérifiés également
(`check/claims.py`) : 15 victoires / 256 dont 7 sans mort, tour de victoire moyen 46,4, 19 combats à 19 / 19 (15
victoires + 4 limites de tours avec 2-3 morts), répartition des corrompus (35 / 115 / 68 / 17 / 21), causes d'échec
(174 « vagues non corrompues », 49 submersions), corrompus par vague (3,00 / 3,63 / 1,86 / 0,80 / 0,36), liste des 15
graines gagnantes, tableaux par personnage et par source de dégâts (Brabuzar 17 799 dont 9 575 poussées / 8 224
*Neutralisation* ; Harpille 11 331 dont 5 529 poison), victoires discordantes Terre + Terre / recommandée (10 / 13 / 2),
7 victoires contre 0 face à R sur les 88 graines communes, volume (1 600 combats hors R, dont 32 repris). Les 8
bascules de variantes changent bien la paire annoncée (bit du preset `cra_terre_mono` inversé sur le bon membre), et les
tableaux de builds de l'équipe recommandée listent exactement les objets et la forgemagie des stuffs.

Seule imprécision trouvée : « les deux Crâs Terre infligent chacun 10 000 à 13 000 dégâts par combat aux Méjaires » —
les données donnent 11 063 à 13 754 (Terre + Terre et recommandée, 224 combats avec ce détail) ; corrigé dans le
résumé.

### (d) Tests

`npx tsc --noEmit` : propre. `npx vitest run tests/opt-* tests/stats-* tests/data-*` : **28 fichiers, 313 tests, tous
verts** (8 min 17 s, 1 processus) ; l'arbre de travail est inchangé après les tests.

### (b) Nouvelle mesure sur graines fraîches

**Protocole.** Arbre figé `.cache/verify-userteam/tree` = `git archive HEAD` (2952f45 : `src/`, `data/` complets) ;
`src/ai`, `src/engine`, `src/dungeons` et `data/ai/presets.json` y sont identiques à l'arbre de la campagne (diff vide).
Harnais indépendant `.cache/verify-userteam/run.mts` : `runOne` du dépôt (`record: false`), mesures lues uniquement dans
`FightSummary` (victoire, tours, `firstDeathRound`, `corruptedByRound`) et dans le résumé officiel du scénario
(`extra.corrupted`, égal au dernier `corruptedByRound` dans 100 % des combats) — sans le décodage d'événements de
`.cache/userteam/run.mts`. IA `fast`, variante `default`, θ par défaut, ordre des membres de la campagne (Crâ A,
Enutrof, Crâ B, Eniripsa). Graines `campaignSeeds(81..88, 32)` = 256 graines **jamais jouées** (intersection vide avec
toutes les graines de `.cache/userteam` et `.cache/compo`, et aucune n'apparaît dans `docs/` ni `.cache/`). Mêmes
graines pour tous les bras (appariement), 3 processus. Contrôle : la graine 963351236 rejouée par ce harnais donne la
même victoire au tour 42 sans mort, même `eventsHash` (458909491) que la CLI.

Différences appariées avec la recommandée ± demi-largeur de l'IC 95 % ; « 1er mort » = tour de fin si personne ne meurt.

| Bras | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Victoires discordantes (bras / réf., McNemar) |
|---|---|---|---|---|---|---|---|---|
| **Crâ Terre + Crâ Terre (déf.)** — recommandée | 256 | 10 / 256 = 3,9 % [2,1 – 7,0 %] | 4,79 | 6,77 | 9,38 | 30,81 | 22,88 | — |
| Crâ Terre + Crâ Terre | 256 | 10 / 256 = 3,9 % [2,1 – 7,0 %] | 4,95 (+0,16 ± 0,16) | 6,96 (+0,19 ± 0,18) | 9,42 (+0,04 ± 0,60) | 30,15 (−0,66 ± 1,18) | 20,89 (−1,99 ± 0,95) | 10 / 10 (p = 1,00) |
| Crâ Feu + Crâ Terre (déf.) | 256 | 10 / 256 = 3,9 % [2,1 – 7,0 %] | 4,54 (−0,25 ± 0,16) | 6,51 (−0,26 ± 0,18) | 8,75 (−0,64 ± 0,60) | 29,80 (−1,01 ± 1,16) | 21,28 (−1,60 ± 1,00) | 10 / 10 (p = 1,00) |

Lecture :

- **Taux de victoire vérifié de l'équipe recommandée : 10 / 256 = 3,9 % [IC 95 % Wilson 2,1 % – 7,0 %]** (6 des 10
  victoires sans mort). Le 5,9 % [3,6 – 9,4 %] du rapport est mesuré sur les graines qui ont servi à choisir l'équipe
  (biais de sélection entre deux bras à égalité) ; l'écart 15 / 256 contre 10 / 256 n'est pas significatif (z = 1,03,
  p = 0,31) et les moyennes concordent (corrompus 9,38 contre 9,65, tours 30,8 contre 31,3, premier mort 22,9 contre
  22,8). Toutes graines confondues (512) : 25 / 512 = 4,9 % [3,3 – 7,1 %].
- **Les trois bras gagnent exactement autant** (10 / 256 chacun ; victoires discordantes 10 / 10) : aucune
  différence de victoires n'est mesurable entre eux à 256 graines.
- **Terre + Terre (déf.) contre Terre + Terre** : corruption finale identique (+0,04 ± 0,60), comme dans le rapport
  (−0,11 ± 0,60) ; Terre + Terre corrompt un peu plus tôt (+0,16 ± 0,16 au tour 13, +0,19 ± 0,18 au tour 19, à la limite
  de la significativité, même signe que dans le rapport) ; la recommandée **retarde le premier mort de 1,99 ± 0,95
  tour** (rapport : +1,54 ± 0,96) — l'argument de départage du rapport se confirme, sur les deux moitiés des graines
  (+1,55 ± 1,42 sur 81-84, +2,43 ± 1,27 sur 85-88).
- **Crâ Feu + Crâ Terre (déf.)**, la paire écartée au halving 64 alors qu'elle devançait la référence Feu + Terre
  (+0,39 ± 1,22, voir plus bas) : **−0,64 ± 0,60 corrompu** et premier mort −1,60 ± 1,00 face à la recommandée (−0,67
  ± 0,57 face à Terre + Terre) ; l'écart est net sur la première moitié des graines (−1,16 ± 0,85) et nul sur la seconde
  (−0,11 ± 0,83). Deux Crâs Terre restent donc devant un Crâ Feu + un Crâ Terre, mais de ≈ 0,6 corrompu, pas de 1,1
  comme Terre + Terre contre Feu + Terre (équilibré) dans le rapport.
