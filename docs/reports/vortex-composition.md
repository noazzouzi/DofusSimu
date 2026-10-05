# Œil de Vortex — campagne de composition (quatre classes, stuffs et séquence de combat)

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
