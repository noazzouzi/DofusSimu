# Œil de Vortex — campagne de composition (quatre classes, stuffs et séquence de combat)

> **Campagne interrompue le 2026-10-05 à la demande de l'utilisateur.** La composition d'un donjon est désormais
> choisie par l'utilisateur (pour l'Œil de Vortex : 1 Eniripsa, 1 Enutrof, 2 Crâs) ; le simulateur optimise les builds
> (élément, stuff, exos, variantes de sorts) et la stratégie de CETTE composition. Les mesures ci-dessous (criblage à
> 32 graines, début du halving) restent valables comme exploration : elles ne sont pas un classement définitif.


*Rapport en cours de rédaction (campagne du 2026-10-05) — les tableaux sont complétés au fil des mesures.*

## Protocole

- **Code figé** : tous les combats tournent dans `.cache/compo/tree` = `git archive base-compo` (src/, data/ai/) + le
  `data/ai/presets.json` vivant (on n'y fait qu'AJOUTER des stuffs et des presets dérivés) ; l'IA (θ, `src/ai`,
  `src/dungeons`, `src/engine`) est celle du tag `base-compo` pour toutes les équipes.
- IA `fast`, variante `default`, mêmes graines pour toutes les équipes (`campaignSeeds(masterSeed, 32)`) : criblage sur
  `masterSeed` 51 (32 graines), puis halving successif sur 52 (64), 53-54 (128) et 55-58 (256).
- Harnais `.cache/compo/` (hors dépôt) : `run.mts` (un combat par graine : victoire, tours survécus, corrompus cumulés aux
  tours 7/13/19/25 et par vague, premier mort, dégâts subis par source et par personnage, poussées subies, part des tours
  commencés sous *Pacifiste* aux tours ≥ 13, dégâts infligés par personnage — invocations comprises —, soins), `worker.sh`
  / `queue.sh` (3 processus, unités de 8 graines, reprise après redémarrage), `ana.cjs` (différences appariées ± IC 95 %,
  IC de Wilson des victoires), `seq.cjs` (séquence observée par vague à partir d'un replay).
- Référence **R** = `cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex_def,eniripsa_soin_vortex`.

## Candidats et pourquoi

Leviers mesurés au tour 4 (docs/tuning-log.md) : (1) *Pacifiste* des Méjaires (*Rayonirique*, 1-3 PO en ligne, état 218
`désenv.=2` : **non désenvoûtable** — aucun désenvoûtement d'allié ne le retire, le levier « dispel » n'existe donc pas) :
borne +3,1 corrompus ; (2) poussées / collisions du Brabuzar (≈ 9 000 par combat) et *Neutralisation* : borne +5,3 tours ;
(3) puissance de l'équipe (≈ +25 % de dégâts et −20 % de dégâts subis pour gagner un combat sur quatre) ; (4) Harpilles
résistantes au Feu (43 %) ; (5) retrait de PM sur les Méjaires.

Dans le moteur, *Pacifiste* (`cantDealDamage`) annule TOUT dommage dont le lanceur est pacifié : sorts, poisons, glyphes,
pièges et collisions (`computeAndApplyDamage`, `applySplashDamage`, `movement/common.ts`). Seules les **invocations**
(créatures, tourelles, poupées, bombes — la bombe est le lanceur de sa propre explosion, `special.ts` effet 1009) frappent
quand leur maître est pacifié. Les boucliers (Féca, Zobal, Steamer) absorbent aussi les dommages de poussée
(`Engine.applyDamage`).

Couverture moteur (docs/engine-coverage.md) : 786 / 856 sorts de classe lancés en bac à sable, **0 effet sans
interprète, 0 exception** ; les 70 non lancés le sont faute d'état préalable (porter du Pandawa, masques du Zobal, Lance
du Forgelance, formes de l'Ouginak) ou de portée, pas faute d'interprète. Tous les presets ci-dessous existent
(`data/ai/presets.json`) ; leur stuff Vortex est construit à la section suivante.

| Emplacement remplacé | Candidat (preset de base) | Leviers visés | Sorts clés (variantes du preset) |
|---|---|---|---|
| Iop (mêlée, 37-45 % de ses tours pacifié, premier mort) | Osamodas invocateur (`osamodas_invocations`) | Pacifiste (créatures), dégâts Eau | Tofu, Bouftou, Craquolosse, Dragoune, Cortège Sauvage, Martinet |
| | Steamer artillerie (`steamer_artillerie`) | Pacifiste (tourelles), placement, Terre | Harponneuse, Foreuse, Tactirelle, Marée, Blindage (indéplaçable) |
| | Roublard artificier (`roublard_artificier`) | Pacifiste (bombes), zone Feu/Air/Eau, murs | Explobombe, Tornabombe, Bombe à Eau, Détonateur, Kaboom |
| | Sadida Terre (`sadida_terre`) | poupées, Terre (Harpilles), guide « Sadida Force » | Force de la Nature, La Folle, La Gonflable, Arbre |
| | Huppermage quadra (`huppermage_quadra`) | distance (hors des lignes 1-3), multi-élément contre les Harpilles | Lance-flamme, Éther, Onde Sismique, Stalagmite, Runification |
| | Éliotrope (`eliotrope_passeur`) | distance, Air, portails (guide JOL n° 2) | Portail, Sermon, Raillerie (−PM), Cabale, Coalition |
| | Xélor zone (`xelor_zone_feu_air`) | distance, zone | Rayon Obscur, Réfraction, Synchro, Pendule |
| | Ecaflip (`ecaflip_feu_hybride`) | burst + soin, distance moyenne | Langue Râpeuse, Topkaj, Blakjak, Château de Cartes |
| | Forgelance zone (`forgelance_zone_terre`) | zone non dégressive Terre, placement | Lance-pierre, Effondrement, Terre du Milieu, Poinçon |
| | Sram pièges (`sram_terre_pieges`) | burst Terre, pièges (sans LdV), invisibilité | Piège Mortel, Perfidie, Chausse-trappe, Attaque Mortelle |
| | Ouginak Terre (`ouginak_terre_feu`, stuff défensif) | burst mêlée + survie (Rage ×0,81, Proie) | Proie, Molosse, Cubitus, Tétanisation (−3 PM) |
| | Iop zone (`iop_multi_zone`) | Iop à distance moyenne (Épées) | Épée Céleste, Épée Divine, Tumulte |
| | Pandawa placement (`pandawa_placement`) | porter, Saoul ×0,85, guide | Karcham, Varappe, Pandikulation, Fermentation |
| | 2ᵉ Crâ Feu (`cra_feu_vortex`) | le membre le plus rentable de R (moins pacifié, 1er en dégâts) | — |
| Enutrof (retrait PM, 2ᵉ en dégâts) | Pandawa placement (`pandawa_placement`) | **équipe guide Pandawa/Crâ/Eniripsa/Iop** (premier essai gagnant, vortex-audit §6) | idem |
| | Sram utilitaire (`sram_utilitaire`) | −4 PM de zone (Piège d'Immobilisation), Brume | Piège d'Immobilisation, Brume, Manigance, Double |
| | Sadida infection (`sadida_infection`) | retrait PM de masse (Infection), arbres (LdV) | Arbre, Contagion, Buisson Ardent, Sève Paralysante |
| | Roublard contrôleur (`roublard_controleur`) | −PA/−PM de zone, bombes | Mitraille, Tornabombe Résiliente, Bombe à Eau Résiliente |
| | Féca entrave (`feca_entrave_zone`) | −3 PM en glyphe, boucliers | Terre Brûlée, Prairie, Bastion |
| | Crâ Air entrave (`cra_air_entrave`) | −PM à distance, Air | Flèche Cinglante, Paralysante, Pluie de Flèches |
| | Xélor retrait PA (`xelor_retrait_pa`) | −PA massif | Ralentissement, Horloge, Pétrification, Flou Temporel |
| Eniripsa (soin) | Osamodas soin (`osamodas_soutien_soin`) | soin + créatures + boosts | Dents du Piranya, Toison d'Or, Cri de l'Ours, Piqûre Motivante |
| | Steamer soutien (`steamer_soutien`) | soin + boucliers (absorbent les collisions), Gardienne | Secourisme, Gardienne, Bathyscaphe, Évolution |
| | Sadida soin (`sadida_soin`) | soin de zone (le poison des Harpilles part au premier soin) | Ronce Apaisante, Mangrove, Larme |
| | Féca protecteur (`feca_protecteur`) | boucliers ×0,70, armures, invulnérabilités | Bouclier Féca, Rempart, Bastion, Barricade, Bulle |
| | Zobal rempart (`zobal_rempart`) | boucliers de groupe (Plastron 1 200 PV par allié) | Plastron, Cavalcade, Masques |
| Crâ | Huppermage quadra | multi-élément | idem |
| Guides (2 membres) | Roublard + Pandawa + Crâ + Iop (JOL n° 1) ; Sadida + Pandawa + Crâ + Eniripsa (Hardi) ; Pandawa + Sram + Crâ + Iop (Hardi) | | |

## Stuffs Vortex des candidats

Même méthode que la campagne de stuffs (docs/reports/vortex-stuffs.md) : `optimizeStuff` (src/optimizer/stuff), cible
`vortexProxyOptions` (src/optimizer/stuff/vortex.ts : mix des cibles des 5 vagues, mix d'EXPOSITION mesuré des monstres
qui frappent — itération 2 —, modèle des collisions du Brabuzar `VORTEX_PUSH`, PO visée 6 à distance), profil
**équilibré** pour tous, **défensif** pour la mêlée exposée (Ouginak, comme l'Iop de R), 30 000 itérations de recuit,
forgemagie « jets parfaits + un exo PA/PM/PO + 6 transcendances au plus », 995 points + parchemins 100, répartitions de
points candidates (`points.ts`). Pilote : `.cache/compo/opt.ts` (copie de `.cache/stuff/optv2.ts`), sorties
`.cache/compo/opt/*.json` ; ajout dans `data/ai/presets.json` par `.cache/compo/mkspec.ts` + `addpresets.cjs` (ajouts
seulement, contrôle que les entrées existantes restent identiques). Chaque stuff `vortex_<preset>[_def]` est servi par un
preset dérivé `<preset>_vortex[_def]` (`extends` : même identité IA que le preset de base, stuff et points du stuff).
Tous les builds sont valides (`computeBuildStats` : conditions, panoplies, un seul exo PA/PM/PO, une prysmaradite,
995 / 995 points) — test `tests/opt-compo-vortex.test.ts`.

| Preset dérivé (stuff) | Profil | Proxy DPT / EHP / UTIL : départ → retenu | PV | PA/PM/PO | % Rés N/T/F/E/A | Ré Pou | Points investis (/995) | Panoplies |
|---|---|---|---|---|---|---|---|---|
| `pandawa_placement_vortex` (`vortex_pandawa_placement`) | équilibré | 287 / 5338 / 0.55 → 1338 / 12001 / 1.21 | 4103 → **5545** | 12/6/6 | 26/29/36/46/24 | 170 | Vi 695, Cha 300 | Panoplistik(3), Panoplie du Roi Joueur(3), Panoplie du Bonimenteur(2) |
| `roublard_artificier_vortex` (`vortex_roublard_artificier`) | équilibré | 2154 / 4293 / 0.00 → 2725 / 6330 / 0.00 | 3603 → **4403** | 12/6/6 | 14/21/14/38/27 | 100 | Vi 3, Int 992 | Panoplie d'Otomaï(3), Panoplie de Guerre(2), Panoplie Séculaire(2) |
| `osamodas_invocations_vortex` (`vortex_osamodas_invocations`) | équilibré | 2249 / 5338 / 0.33 → 2015 / 11186 / 1.67 | 4103 → **5353** | 12/6/6 | 32/0/17/47/17 | 130 | Vi 3, Cha 992 | Panoplie du Piloztère(3), Panoplie de la Fosse(2) |
| `steamer_artillerie_vortex` (`vortex_steamer_artillerie`) | équilibré | 2464 / 5125 / 0.67 → 1871 / 12490 / 1.67 | 4153 → **5245** | 12/6/6 | 39/11/36/50/19 | 150 | Vi 695, Fo 300 | Panoplie du Piloztère(2), Panoplie du Bonimenteur(2), Panoplie du Vénérable Endormi(2) |
| `huppermage_quadra_vortex` (`vortex_huppermage_quadra`) | équilibré | 2186 / 4293 / 0.00 → 2724 / 6330 / 0.00 | 3603 → **4403** | 12/6/6 | 14/21/14/38/27 | 100 | Vi 3, Int 992 | Panoplie d'Otomaï(3), Panoplie de Guerre(2), Panoplie Séculaire(2) |
| `ouginak_terre_feu_vortex_def` (`vortex_ouginak_terre_feu_def`) | défensif | 2443 / 5125 / 0.00 → 2051 / 13815 / 0.00 | 4153 → **6145** | 12/6/2 | 32/14/22/49/30 | 170 | Vi 395, Fo 600 | Panoplie du Bonimenteur(3), Panoplie du Comte Harebourg(2), Panoplie du Vénérable Endormi(2) |
| `sram_terre_pieges_vortex` (`vortex_sram_terre_pieges`) | équilibré | 1972 / 5125 / 0.00 → 2164 / 7628 / 0.00 | 4153 → **4803** | 12/6/6 | 23/17/30/43/26 | 120 | Vi 3, Fo 992 | Panoplie du Bonimenteur(3), Panoplie du Comte Harebourg(2), Panoplie du Vénérable Endormi(2) |
| `xelor_zone_feu_air_vortex` (`vortex_xelor_zone_feu_air`) | équilibré | 2398 / 4293 / 0.00 → 2986 / 6543 / 0.00 | 3603 → **4403** | 12/6/6 | 14/21/14/38/27 | 100 | Vi 3, Int 992 | Panoplie d'Otomaï(3), Panoplie de Guerre(2), Panoplie Séculaire(2) |
| `eliotrope_passeur_vortex` (`vortex_eliotrope_passeur`) | équilibré | 1966 / 5587 / 0.00 → 2127 / 8863 / 0.00 | 4153 → **4353** | 12/6/6 | 32/14/46/44/4 | 140 | Vi 3, Agi 992 | Panoplie de Voldelor(2), Panoplie du Valet Veinard(2), Panoplie des Armutins(2) |
| `osamodas_soutien_soin_vortex` (`vortex_osamodas_soutien_soin`) | équilibré | 2248 / 5338 / 0.69 → 1520 / 12036 / 1.19 | 4103 → **5645** | 12/6/6 | 41/22/22/47/22 | 150 | Vi 395, Cha 600 | Panoplie Ventouse(3), Panoplie de Léthaline Sigisbul(2), Panoplie du Gouffre(3) |
| `steamer_soutien_vortex` (`vortex_steamer_soutien`) | équilibré | 2378 / 5125 / 2.41 → 1589 / 14162 / 2.44 | 4153 → **6045** | 12/6/6 | 43/35/26/51/9 | 180 | Vi 695, Fo 300 | Panoplistik(2), Panoplie de Corruption(2), Harpinoplie(2), Panoplie du Vénérable Endormi(2) |
| `sadida_soin_vortex` (`vortex_sadida_soin`) | équilibré | 2336 / 5338 / 1.70 → 2030 / 10299 / 1.98 | 4103 → **4903** | 12/6/6 | 48/26/24/50/17 | 170 | Vi 3, Cha 992 | Panoplie Pnose(3), Panoplie de Servitude(2) |
| `feca_protecteur_vortex` (`vortex_feca_protecteur`) | équilibré | 1078 / 8693 / 1.06 → 830 / 16979 / 2.00 | 5445 → **6745** | 12/6/3 | 33/31/51/51/39 | 200 | Vi 995 | Panoplie des Abysses(3), Grithriloplie(2), Harpinoplie(2) |
| `zobal_rempart_vortex` (`vortex_zobal_rempart`) | équilibré | 0 / 8693 / 1.06 → 0 / 18533 / 2.16 | 5445 → **6745** | 12/6/4 | 36/28/44/51/39 | 150 | Vi 995 | Grithriloplie(2), Harpinoplie(2), Panoplie d'Aermyne(2) |
| `sram_utilitaire_vortex` (`vortex_sram_utilitaire`) | équilibré | 1015 / 6683 / 0.00 → 1686 / 15061 / 0.00 | 4253 → **6295** | 12/6/6 | 43/11/51/51/14 | 170 | Vi 695, Agi 300 | Panoplie de Voldelor(2), Panoplie des Abîmes(3) |
| `sadida_infection_vortex` (`vortex_sadida_infection`) | équilibré | 1949 / 5587 / 0.57 → 1411 / 13144 / 0.91 | 4153 → **5695** | 12/6/6 | 26/45/50/50/8 | 160 | Vi 545, Agi 450 | Panoplie du Valet Veinard(2), Panoplie Submergée(2) |
| `roublard_controleur_vortex` (`vortex_roublard_controleur`) | équilibré | 1007 / 6683 / 0.37 → 1636 / 12837 / 0.62 | 4253 → **5995** | 12/6/6 | 32/13/33/50/17 | 170 | Vi 695, Cha 300 | Panoplie de Voldelor(3), Panoplie du Gouffre(2) |
| `feca_entrave_zone_vortex` (`vortex_feca_entrave_zone`) | équilibré | 947 / 6683 / 0.24 → 1601 / 12126 / 0.48 | 4253 → **5945** | 12/6/6 | 31/31/26/50/33 | 140 | Vi 545, Fo 450 | Panoplie du Cœur Saignant(3), Panoplie des Chocomanciens(2), Panoplie du Vénérable Endormi(2) |
| `cra_air_entrave_vortex` (`vortex_cra_air_entrave`) | équilibré | 3146 / 5587 / 0.44 → 2033 / 13164 / 0.89 | 4153 → **5745** | 12/6/6 | 26/35/50/50/8 | 165 | Vi 695, Agi 300 | Panoplie du Valet Veinard(2), Panoplie du Wukang(3) |
| `xelor_retrait_pa_vortex` (`vortex_xelor_retrait_pa`) | équilibré | 809 / 6683 / 0.19 → 1223 / 14193 / 0.36 | 4253 → **5995** | 12/6/6 | 51/25/32/51/15 | 200 | Vi 695, Fo 300 | Panoplie du Cœur Vaillant(3), Panoplie des Tréfonds(2), Panoplie de Bethel(2) |
| `ecaflip_feu_hybride_vortex` (`vortex_ecaflip_feu_hybride`) | équilibré | 2237 / 4293 / 0.00 → 2773 / 6553 / 0.00 | 3603 → **4803** | 12/6/6 | 14/21/14/38/27 | 100 | Vi 3, Int 992 | Panoplie d'Otomaï(3), Panoplie de Guerre(2), Panoplie Séculaire(2) |
| `forgelance_zone_terre_vortex` (`vortex_forgelance_zone_terre`) | équilibré | 1622 / 5125 / 0.00 → 1794 / 7503 / 0.00 | 4153 → **4603** | 12/6/6 | 17/36/32/35/25 | 160 | Vi 3, Fo 992 | Panoplie Volcanique(2), Panoplie du Roi Joueur(3), Panoplie de Corruption(2) |
| `sadida_terre_vortex` (`vortex_sadida_terre`) | équilibré | 2274 / 5125 / 0.00 → 2484 / 7857 / 0.00 | 4153 → **4503** | 12/6/6 | 15/34/22/36/22 | 130 | Vi 3, Fo 992 | Panoplie du Cœur Saignant(3), Panoplie de Corruption(2), Panoplistik(2), Panoplie du Vénérable Endormi(2) |
| `iop_multi_zone_vortex` (`vortex_iop_multi_zone`) | équilibré | 1953 / 4293 / 0.00 → 2468 / 6330 / 0.00 | 3603 → **4403** | 12/6/6 | 14/21/14/38/27 | 100 | Vi 3, Int 992 | Panoplie d'Otomaï(3), Panoplie de Guerre(2), Panoplie Séculaire(2) |

## Criblage (`masterSeed` 51, 32 graines, appariées avec R)

Chaque cellule : moyenne de l'équipe, puis entre parenthèses la différence APPARIÉE avec R (mêmes graines) ± la
demi-largeur de l'IC 95 % (1,96·σ/√n). Victoires : IC de Wilson. « Corr. » = monstres corrompus cumulés (19 à corrompre) ;
« Pacifiste » = part des tours de personnage commencés sous *Pacifiste* aux tours ≥ 13 ; poussées, dégâts infligés aux
monstres de vague et dégâts subis : moyennes par combat. Tri par différence de corrompus au total.

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Iop → Éliotrope | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,63 (+0,44 ± 0,45) | 6,47 (+0,34 ± 0,49) | 8,00 (+0,06 ± 1,10) | 28,19 (−0,75 ± 2,26) | 20,75 (−0,28 ± 2,11) | 29,3 % | 11 606 | 127 761 | 51 316 |
| **R** (Crâ / Enutrof / Iop déf. / Eniripsa) | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,19 | 6,13 | 7,94 | 28,94 | 21,03 | 30,5 % | 11 188 | 132 859 | 54 535 |
| Iop → Osamodas invocateur | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,53 (+0,34 ± 0,54) | 6,56 (+0,44 ± 0,65) | 7,78 (−0,16 ± 1,38) | 28,41 (−0,53 ± 2,54) | 21,31 (+0,28 ± 2,05) | 31,6 % | 10 660 | 136 038 | 49 612 |
| Eniripsa → Osamodas soin | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,47 (+0,28 ± 0,46) | 6,38 (+0,25 ± 0,71) | 7,66 (−0,28 ± 1,59) | 26,25 (−2,69 ± 2,83) | 19,78 (−1,25 ± 2,27) | 31,0 % | 7 456 | 121 412 | 44 467 |
| Iop → Huppermage quadra | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,41 (+0,22 ± 0,47) | 6,28 (+0,16 ± 0,59) | 7,59 (−0,34 ± 1,39) | 26,47 (−2,47 ± 2,67) | 18,38 (−2,66 ± 2,49) | 29,3 % | 9 644 | 121 814 | 47 850 |
| Eniripsa → Steamer soutien | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,00 (−0,19 ± 0,36) | 6,00 (−0,13 ± 0,52) | 7,44 (−0,50 ± 1,10) | 26,66 (−2,28 ± 2,70) | 19,41 (−1,63 ± 2,28) | 29,0 % | 7 430 | 126 559 | 45 257 |
| Iop → Steamer artillerie | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,22 (+0,03 ± 0,50) | 6,13 (+0,00 ± 0,62) | 7,44 (−0,50 ± 1,15) | 28,09 (−0,84 ± 2,65) | 20,66 (−0,38 ± 1,98) | 32,7 % | 10 996 | 136 256 | 46 953 |
| Iop → Sadida Terre | 32 | 1 / 32 [0,6 % – 15,7 %] | 3,75 (−0,44 ± 0,47) | 5,84 (−0,28 ± 0,67) | 7,34 (−0,59 ± 1,80) | 27,16 (−1,78 ± 3,25) | 21,28 (+0,25 ± 5,75) | 26,0 % | 9 682 | 124 665 | 48 577 |
| R, Eniripsa en stuff défensif | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,09 (−0,09 ± 0,38) | 5,94 (−0,19 ± 0,59) | 7,25 (−0,69 ± 1,17) | 28,44 (−0,50 ± 2,28) | 21,31 (+0,28 ± 1,88) | 33,7 % | 10 592 | 124 913 | 52 800 |
| Crâ → Huppermage quadra | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,25 (+0,06 ± 0,57) | 5,72 (−0,41 ± 0,68) | 7,00 (−0,94 ± 1,38) | 27,69 (−1,25 ± 3,15) | 19,25 (−1,78 ± 3,10) | 34,9 % | 10 780 | 118 997 | 51 805 |
| Enutrof → Crâ Air entrave | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,06 (−0,13 ± 0,50) | 5,66 (−0,47 ± 0,54) | 7,00 (−0,94 ± 1,19) | 25,72 (−3,22 ± 2,36) | 17,34 (−3,69 ± 2,19) | 32,9 % | 9 568 | 113 741 | 53 736 |
| Enutrof → Sram utilitaire | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,09 (−0,09 ± 0,42) | 5,66 (−0,47 ± 0,74) | 6,94 (−1,00 ± 1,62) | 26,25 (−2,69 ± 3,68) | 18,09 (−2,94 ± 2,57) | 37,8 % | 10 376 | 108 648 | 57 220 |
| Eniripsa → Zobal rempart | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,31 (+0,13 ± 0,45) | 6,00 (−0,13 ± 0,71) | 6,94 (−1,00 ± 1,41) | 25,69 (−3,25 ± 2,52) | 19,53 (−1,50 ± 2,20) | 38,4 % | 6 800 | 106 985 | 35 605 |
| R, Crâ en stuff défensif | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,06 (−0,13 ± 0,43) | 6,03 (−0,09 ± 0,67) | 6,91 (−1,03 ± 1,25) | 27,22 (−1,72 ± 2,66) | 22,78 (+1,75 ± 2,04) | 37,6 % | 13 191 | 120 355 | 54 693 |
| Iop → 2ᵉ Crâ Feu | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,16 (−0,03 ± 0,46) | 5,94 (−0,19 ± 0,68) | 6,84 (−1,09 ± 1,42) | 25,75 (−3,19 ± 2,77) | 17,69 (−3,34 ± 2,29) | 30,5 % | 8 916 | 116 511 | 50 182 |
| Iop Terre → Iop zone (Feu) | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,47 (+0,28 ± 0,46) | 6,00 (−0,13 ± 0,61) | 6,81 (−1,13 ± 1,27) | 26,78 (−2,16 ± 2,75) | 18,31 (−2,72 ± 2,50) | 36,0 % | 8 305 | 113 684 | 49 240 |
| Eniripsa → Sadida soin | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,13 (−0,06 ± 0,41) | 6,00 (−0,13 ± 0,58) | 6,75 (−1,19 ± 1,26) | 24,69 (−4,25 ± 2,71) | 18,25 (−2,78 ± 1,85) | 29,5 % | 8 431 | 113 291 | 50 300 |
| Iop → Ecaflip | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,41 (+0,22 ± 0,40) | 5,91 (−0,22 ± 0,68) | 6,75 (−1,19 ± 1,24) | 27,03 (−1,91 ± 2,62) | 18,69 (−2,34 ± 2,41) | 28,8 % | 9 963 | 120 134 | 50 104 |
| Enutrof → Féca entrave | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,03 (−0,16 ± 0,43) | 5,63 (−0,50 ± 0,54) | 6,56 (−1,38 ± 1,36) | 25,28 (−3,66 ± 2,64) | 18,63 (−2,41 ± 2,28) | 37,1 % | 9 899 | 115 620 | 53 493 |
| Enutrof → Sadida infection | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,94 (−0,25 ± 0,46) | 5,50 (−0,63 ± 0,67) | 6,03 (−1,91 ± 1,41) | 24,44 (−4,50 ± 2,62) | 17,25 (−3,78 ± 2,40) | 29,3 % | 11 321 | 105 170 | 52 819 |
| Iop → Xélor zone | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,03 (−0,16 ± 0,39) | 5,44 (−0,69 ± 0,73) | 6,00 (−1,94 ± 1,25) | 25,44 (−3,50 ± 2,36) | 15,06 (−5,97 ± 2,26) | 34,9 % | 8 134 | 106 896 | 47 643 |
| Iop → Sram pièges | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,03 (−0,16 ± 0,51) | 5,34 (−0,78 ± 0,65) | 5,75 (−2,19 ± 1,16) | 24,41 (−4,53 ± 2,34) | 16,00 (−5,03 ± 2,07) | 33,5 % | 9 465 | 104 530 | 48 870 |
| Iop → Roublard artificier | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,91 (−0,28 ± 0,44) | 5,19 (−0,94 ± 0,68) | 5,69 (−2,25 ± 1,18) | 24,91 (−4,03 ± 2,55) | 15,88 (−5,16 ± 1,98) | 33,9 % | 8 640 | 102 385 | 50 741 |
| Enutrof → Xélor retrait PA | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,09 (−0,09 ± 0,45) | 5,28 (−0,84 ± 0,66) | 5,63 (−2,31 ± 1,35) | 23,41 (−5,53 ± 2,51) | 16,75 (−4,28 ± 2,27) | 42,0 % | 7 195 | 95 944 | 53 305 |
| Iop → Ouginak Terre (déf.) | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,69 (−0,50 ± 0,48) | 4,91 (−1,22 ± 0,72) | 5,63 (−2,31 ± 1,36) | 26,47 (−2,47 ± 2,76) | 20,03 (−1,00 ± 2,22) | 33,6 % | 10 545 | 116 083 | 49 213 |
| R, Enutrof en stuff défensif | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,47 (−0,72 ± 0,44) | 4,91 (−1,22 ± 0,54) | 5,38 (−2,56 ± 1,26) | 26,03 (−2,91 ± 2,65) | 17,63 (−3,41 ± 2,35) | 34,6 % | 11 602 | 113 978 | 56 417 |
| Eniripsa → Féca protecteur | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,19 (+0,00 ± 0,54) | 5,19 (−0,94 ± 0,68) | 5,25 (−2,69 ± 1,23) | 20,59 (−8,34 ± 2,56) | 14,97 (−6,06 ± 1,78) | 38,1 % | 4 812 | 83 789 | 37 642 |
| Iop → Pandawa placement | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,63 (−0,56 ± 0,51) | 4,81 (−1,31 ± 0,73) | 5,09 (−2,84 ± 1,28) | 24,28 (−4,66 ± 2,40) | 16,72 (−4,31 ± 2,06) | 38,6 % | 9 725 | 96 245 | 50 987 |
| Enutrof → Roublard contrôleur | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,66 (−0,53 ± 0,46) | 4,56 (−1,56 ± 0,54) | 4,97 (−2,97 ± 1,07) | 23,09 (−5,84 ± 2,39) | 15,78 (−5,25 ± 1,64) | 42,8 % | 6 901 | 94 198 | 53 236 |
| Guide Hardi : Sadida Terre / Pandawa / Crâ / Eniripsa | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,78 (−0,41 ± 0,46) | 4,53 (−1,59 ± 0,58) | 4,81 (−3,13 ± 1,28) | 21,75 (−7,19 ± 2,72) | 14,78 (−6,25 ± 1,99) | 37,8 % | 5 978 | 85 517 | 46 305 |
| Iop → Forgelance zone | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,00 (−1,19 ± 0,50) | 4,00 (−2,13 ± 0,81) | 4,19 (−3,75 ± 1,38) | 22,81 (−6,13 ± 2,96) | 14,66 (−6,38 ± 2,25) | 34,6 % | 7 217 | 86 176 | 45 974 |
| Enutrof → Pandawa (équipe guide Pandawa/Crâ/Eni/Iop) | 32 | 0 / 32 [0,0 % – 10,7 %] | 3,34 (−0,84 ± 0,58) | 4,00 (−2,13 ± 0,78) | 4,16 (−3,78 ± 1,43) | 21,13 (−7,81 ± 2,92) | 13,44 (−7,59 ± 2,33) | 43,7 % | 7 244 | 76 090 | 52 831 |
| Guide Hardi : Pandawa / Sram / Crâ / Iop | 32 | 0 / 32 [0,0 % – 10,7 %] | 2,75 (−1,44 ± 0,56) | 2,78 (−3,34 ± 0,70) | 2,78 (−5,16 ± 1,33) | 13,63 (−15,31 ± 2,66) | 9,13 (−11,91 ± 1,80) | 25,2 % | 1 398 | 52 663 | 30 591 |
| Guide JOL : Roublard / Pandawa / Crâ / Iop | 32 | 0 / 32 [0,0 % – 10,7 %] | 2,75 (−1,44 ± 0,49) | 2,78 (−3,34 ± 0,63) | 2,78 (−5,16 ± 1,22) | 13,47 (−15,47 ± 2,44) | 8,25 (−12,78 ± 2,02) | 33,8 % | 1 579 | 52 144 | 30 292 |

### Lecture du criblage

- **Aucun remplacement ne bat R** au-delà du bruit (IC ≈ ± 1,1-1,6 corrompu sur 32 graines). Les meilleurs (Iop →
  Éliotrope, Iop → Osamodas invocateur, Eniripsa → Osamodas soin, Iop → Huppermage, Iop → Steamer) sont à ± 0,5
  corrompu de R et perdent tous du temps de survie (−0,5 à −2,7 tours).
- **L'Enutrof est irremplaçable** : chaque entraveur de rechange perd 0,9 à 3,8 corrompus et 2,7 à 7,8 tours (Sram
  utilitaire −1,0, Crâ Air −0,9, Féca −1,4, Sadida infection −1,9, Xélor −2,3, Roublard −3,0, Pandawa −3,8). Il est le
  2ᵉ en dégâts de R (32 000 par combat, objets animés compris), soigne 5 800 et retire les PM.
- **Les équipes des guides s'effondrent** avec l'IA actuelle (Pandawa / Crâ / Eniripsa / Iop : −3,8 corrompus, −7,8 tours ;
  sans Enutrof NI soigneur — Roublard / Pandawa / Crâ / Iop, Pandawa / Sram / Crâ / Iop — : 2,8 corrompus, 13,5 tours) :
  l'IA ne sait pas jouer le porter du Pandawa (8 000 de dégâts par combat) ni les bombes du Roublard (*Explobombe* jamais
  lancée, 0,5 *Détonation* par combat, 17 000 de dégâts). Ce sont des limites de l'IA, pas des classes.
- **Soigneur** : l'Eniripsa reste le meilleur ; Osamodas soin et Steamer soutien corrompent autant mais vivent 2,3 à
  2,7 tours de moins ; Féca et Zobal (boucliers) font chuter les dégâts de l'équipe (84 000-107 000 contre 133 000).
- **Pacifiste** : la part des tours pacifiés bouge peu avec la composition (29-44 % aux tours ≥ 13). Remplacer l'Iop
  (42 % de ses tours pacifié) par un personnage à distance réduit la part de ce membre (Sadida Terre 17 %, Éliotrope,
  Huppermage ≈ 25-30 %) mais pas celle des autres, et les invocations (Osamodas, Steamer) ne compensent pas.
- **Stuffs par membre** : seul l'Iop gagne au stuff défensif (tour 4) ; Crâ, Eniripsa ou Enutrof défensifs font moins bien
  (−0,7 à −2,6 corrompus).

### Combinaisons à deux et trois membres (criblage, `masterSeed` 51)

Les remplacements isolés les plus prometteurs étaient des **invocateurs** (Osamodas invocateur à la place de l'Iop,
Osamodas soin ou Steamer soutien à la place de l'Eniripsa, Steamer artillerie) : neutres seuls, ils ont été combinés
(même protocole, mêmes graines).

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Steamer artillerie / Enutrof / Osamodas invocateur / Steamer soutien** | 32 | 3 / 32 [3,2 % – 24,2 %] | 4,91 (+0,72 ± 0,41) | 7,16 (+1,03 ± 0,62) | 11,44 (+3,50 ± 1,84) | 33,25 (+4,31 ± 3,65) | 27,56 (+6,53 ± 5,13) | 22,0 % | 8 536 | 167 631 | 40 311 |
| Crâ → Steamer artillerie, Iop → Osamodas invocateur | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,84 (+0,66 ± 0,50) | 6,94 (+0,81 ± 0,59) | 9,69 (+1,75 ± 1,59) | 32,31 (+3,38 ± 3,55) | 26,22 (+5,19 ± 3,15) | 29,7 % | 13 875 | 162 521 | 50 326 |
| Crâ → Steamer artillerie, Iop → Osamodas invocateur, Eniripsa → Osamodas soin | 32 | 1 / 32 [0,6 % – 15,7 %] | 5,19 (+1,00 ± 0,51) | 6,81 (+0,69 ± 0,67) | 9,59 (+1,66 ± 1,48) | 30,16 (+1,22 ± 3,11) | 25,59 (+4,56 ± 5,56) | 29,7 % | 8 258 | 147 868 | 39 457 |
| **Iop → Osamodas invocateur, Eniripsa → Steamer soutien** | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,66 (+0,47 ± 0,47) | 6,84 (+0,72 ± 0,59) | 9,25 (+1,31 ± 1,60) | 29,22 (+0,28 ± 3,09) | 20,50 (−0,53 ± 2,14) | 25,3 % | 8 523 | 148 151 | 43 447 |
| Iop → Osamodas invocateur, Eniripsa → Osamodas soin | 32 | 0 / 32 [0,0 % – 10,7 %] | 5,03 (+0,84 ± 0,51) | 7,13 (+1,00 ± 0,54) | 8,63 (+0,69 ± 1,48) | 27,94 (−1,00 ± 2,82) | 21,44 (+0,41 ± 2,06) | 27,8 % | 9 354 | 134 143 | 41 604 |
| Iop → Steamer artillerie, Eniripsa → Steamer soutien | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,47 (+0,28 ± 0,53) | 6,44 (+0,31 ± 0,67) | 8,00 (+0,06 ± 1,41) | 27,38 (−1,56 ± 2,81) | 19,59 (−1,44 ± 2,48) | 26,7 % | 7 252 | 135 895 | 40 306 |
| **R** (Crâ / Enutrof / Iop déf. / Eniripsa) | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,19 | 6,13 | 7,94 | 28,94 | 21,03 | 30,5 % | 11 188 | 132 859 | 54 535 |
| Iop → Éliotrope, Eniripsa → Osamodas soin | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,63 (+0,44 ± 0,47) | 6,63 (+0,50 ± 0,61) | 7,75 (−0,19 ± 1,35) | 26,50 (−2,44 ± 2,72) | 19,50 (−1,53 ± 1,69) | 29,3 % | 7 459 | 116 961 | 41 044 |
| Iop → Sadida Terre, Eniripsa → Osamodas soin | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,34 (+0,16 ± 0,56) | 6,34 (+0,22 ± 0,81) | 7,50 (−0,44 ± 1,76) | 25,13 (−3,81 ± 3,47) | 18,09 (−2,94 ± 2,53) | 27,2 % | 6 491 | 119 880 | 40 337 |
| Iop → Steamer artillerie, Eniripsa → Osamodas soin | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,06 (−0,13 ± 0,53) | 6,22 (+0,09 ± 0,69) | 7,06 (−0,88 ± 1,49) | 25,78 (−3,16 ± 2,86) | 19,00 (−2,03 ± 2,42) | 32,5 % | 6 852 | 122 634 | 38 078 |
| Iop → Sadida Terre (déf.) | 32 | 0 / 32 [0,0 % – 10,7 %] | 4,03 (−0,16 ± 0,47) | 5,81 (−0,31 ± 0,55) | 7,00 (−0,94 ± 1,11) | 26,75 (−2,19 ± 2,52) | 19,38 (−1,66 ± 2,07) | 27,2 % | 11 816 | 124 733 | 50 767 |

### Pourquoi les équipes d'invocateurs gagnent (lecture des combats)

Les remplacements isolés étaient neutres, mais **empiler les invocateurs** (Osamodas invocateur, Steamer artillerie,
Steamer soutien, Osamodas soin) change la nature du combat :

- **Les invocations encaissent à la place des personnages.** Dans la victoire `Y_STEOSASTE` graine 456089576 (tour 47,
  aucun mort), les invocations alliées (Harponneuse, Foreuse, Gardienne, Bathyscaphe, Crocoléreux, objets animés de
  l'Enutrof) absorbent **143 000** dégâts, contre ≈ 40 000 pour les quatre personnages ; les dégâts subis par les
  personnages tombent de 54 500 (R) à 40 000 par combat, les collisions du Brabuzar de 11 200 à 8 500, et la première
  mort recule de 5 à 9 tours.
- **Elles héritent du stuff Vortex de leur invocateur** (DofusDB `bonusCharacteristics`, appliqué par
  `createMonsterFighter`, `summonerShare`) : les tourelles du Steamer reçoivent **180 % des PV** de l'invocateur et 100 %
  de ses caractéristiques et dommages (Harponneuse / Gardienne / Bathyscaphe : 10 881 PV avec les 6 045 PV du Steamer
  soutien), les créatures de l'Osamodas 100 % des PV, de la Chance et des dommages Eau (Crocoléreux : 5 353 PV).
- **Leurs dégâts ignorent le *Pacifiste* de leur maître** : 13 000 à 17 500 dégâts par combat viennent des créatures de
  l'Osamodas ; la part des tours pacifiés des personnages tombe de 31 % (R) à 20-26 %.
- **Elles occupent le terrain** : murs de corps (créatures, tourelles), cibles pour les Méjaires et les Brabuzars.

**Fidélité** : la part des caractéristiques de l'invocateur vient des données (`bonusCharacteristics`) mais sa base
exacte (PV max de début de combat, buffs compris ou non) est marquée INCERTAINE dans `src/engine/factory.ts` ; l'IA des
invocations est celle de l'équipe (`src/ai/team/summons.ts`). Le gain mesuré dépend de ces deux points.

## Halving successif

### Étape 2 — 64 graines (`masterSeed` 51 + 52)

Les 6 meilleures équipes du criblage (plus R) ; même lecture que le tableau précédent.

| Équipe | n | Victoires [IC 95 % Wilson] | Corr. t13 | Corr. t19 | Corr. total | Tours survécus | 1er mort | Pacifiste (t ≥ 13) | Poussées subies | Dégâts infligés (vagues) | Dégâts subis |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Iop → Éliotrope | 64 | 0 / 64 [0,0 % – 5,7 %] | 4,53 (+0,31 ± 0,31) | 6,48 (+0,44 ± 0,40) | 7,80 (+0,31 ± 0,69) | 27,58 (−0,63 ± 1,31) | 20,44 (−0,63 ± 1,38) | 29,0 % | 10 792 | 124 030 | 49 612 |
| Iop → Osamodas invocateur | 64 | 0 / 64 [0,0 % – 5,7 %] | 4,47 (+0,25 ± 0,32) | 6,52 (+0,47 ± 0,44) | 7,78 (+0,30 ± 0,87) | 28,17 (−0,03 ± 1,53) | 21,52 (+0,45 ± 1,42) | 31,7 % | 11 411 | 135 878 | 50 124 |
| **R** (Crâ / Enutrof / Iop déf. / Eniripsa) | 64 | 0 / 64 [0,0 % – 5,7 %] | 4,22 | 6,05 | 7,48 | 28,20 | 21,06 | 32,3 % | 10 727 | 127 644 | 53 326 |
| Iop → Huppermage quadra | 64 | 0 / 64 [0,0 % – 5,7 %] | 4,27 (+0,05 ± 0,30) | 6,16 (+0,11 ± 0,41) | 7,48 (+0,00 ± 0,86) | 26,86 (−1,34 ± 1,62) | 18,23 (−2,83 ± 1,70) | 29,5 % | 9 997 | 121 451 | 48 031 |
| Eniripsa → Osamodas soin | 64 | 0 / 64 [0,0 % – 5,7 %] | 4,44 (+0,22 ± 0,34) | 6,38 (+0,33 ± 0,45) | 7,34 (−0,14 ± 0,87) | 25,66 (−2,55 ± 1,56) | 18,97 (−2,09 ± 1,46) | 30,6 % | 7 486 | 116 411 | 44 441 |
| Iop → Steamer artillerie | 64 | 0 / 64 [0,0 % – 5,7 %] | 4,16 (−0,06 ± 0,33) | 5,97 (−0,08 ± 0,44) | 7,22 (−0,27 ± 0,76) | 27,64 (−0,56 ± 1,50) | 20,41 (−0,66 ± 1,40) | 31,8 % | 11 407 | 131 981 | 47 279 |
| Iop → Sadida Terre | 64 | 1 / 64 [0,3 % – 8,3 %] | 3,91 (−0,31 ± 0,31) | 5,70 (−0,34 ± 0,45) | 6,81 (−0,67 ± 1,00) | 26,58 (−1,63 ± 1,81) | 19,58 (−1,48 ± 3,00) | 26,9 % | 9 691 | 120 003 | 49 255 |
