# Œil de Vortex — stuffs optimisés par personnage (équipe méta)

*Généré le 2026-10-05* — scénario `vortex`, IA `fast`, combats appariés (mêmes graines). Tous les combats de ce rapport tournent dans l'instantané figé `.cache/stuff/snap-1` (src/ et data/ai/ du tag `base-stuff-cp5`, e75cfd1, + l'optimiseur de stuff) : seuls les stuffs varient entre les bras.

**Objectif** : le meilleur stuff par personnage pour l'Œil de Vortex (équipe méta Crâ Feu / Enutrof Eau retrait PM / Iop Terre / Eniripsa Feu soin), avec tous les emplacements, la forgemagie réaliste (exos PA/PM/PO, transcendances dont « Ta Do Per So » = l'« exo 1 % dommages sorts »), les points de caractéristiques et les parchemins, puis la validation par combats appariés.

**Résultat** : les stuffs optimisés (presets `*_vortex`) font passer l'équipe de **2,5 à 4,3 monstres corrompus** et de **14,5 à 20,5 tours de survie** (n = 64, IC 95 % ± 0,5 et ± 0,9), première mort du tour 10,1 au tour 13,5 ; **toujours 0 victoire** — le stuff n'est pas le seul verrou (voir Limites). Tous les builds sont valides en jeu (`computeBuildStats` : conditions, panoplies, un seul exo PA/PM/PO, une prysmaradite, transcendances conformes, 995 points, parchemins 100).

## Résultats des combats (appariés, IC 95 %)

Équipe méta `cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu` (IA `fast`, mêmes variantes de sorts) ; seuls les stuffs (objets, forgemagie, points) changent. Graines `campaignSeeds(21, 32)` (m21) et `campaignSeeds(22, 32)` (m22), appariées bras à bras. Chaque cellule : moyenne du bras (différence appariée avec la ligne de référence au-dessus ± demi-largeur de l'IC 95 %, 1,96·σ/√n). Victoires : IC de Wilson. « Corrompus T7/T12/T17 » : monstres corrompus à la fin des tours 7, 12, 17 (19 à corrompre pour déverrouiller le Vortex).

| Bras | n | Victoires | Corrompus T7 | T12 | T17 | Fin | Tours survécus | 1re mort | Dégâts subis | Dégâts infligés |
|---|---|---|---|---|---|---|---|---|---|---|
| *Référence : stuffs des presets (n = 64, graines m21 + m22)* | 64 | 0/64 | 1.42 | 2.33 | 2.47 | 2.48 | 14.45 | 10.05 | 32501 | 53169 |
| **Recommandé — équilibré (`*_vortex`)** | 64 | 0/64 [0–6 %] | 1.69 (+0.27 ± 0.29) | 3.16 (+0.83 ± 0.27) | 4.17 (+1.70 ± 0.43) | 4.33 (+1.84 ± 0.47) | 20.52 (+6.06 ± 0.86) | 13.52 (+3.47 ± 1.05) | 46276 (+13776 ± 1935) | 82647 (+29478 ± 4727) |
| **Offensif, Dofus à passif gardés (`*_vortex_off`)** | 64 | 0/64 [0–6 %] | 2.00 (+0.58 ± 0.28) | 3.22 (+0.89 ± 0.24) | 4.33 (+1.86 ± 0.38) | 4.45 (+1.97 ± 0.41) | 18.33 (+3.88 ± 0.78) | 12.50 (+2.45 ± 0.72) | 40092 (+7591 ± 1718) | 80023 (+26854 ± 4902) |
| **Offensif, Dofus libres (proxy R2)** | 64 | 0/64 [0–6 %] | 2.16 (+0.73 ± 0.22) | 3.27 (+0.94 ± 0.29) | 4.27 (+1.80 ± 0.43) | 4.44 (+1.95 ± 0.47) | 18.06 (+3.61 ± 0.88) | 12.50 (+2.45 ± 0.84) | 39558 (+7057 ± 1726) | 79989 (+26819 ± 5309) |
| *Offensif `*_vortex_off` (n = 64), référence de la ligne suivante* | 64 | 0/64 | 2.00 | 3.22 | 4.33 | 4.45 | 18.33 | 12.50 | 40092 | 80023 |
| **Équilibré vs offensif (`*_vortex` − `*_vortex_off`)** | 64 | 0/64 [0–6 %] | 1.69 (−0.31 ± 0.32) | 3.16 (−0.06 ± 0.24) | 4.17 (−0.16 ± 0.45) | 4.33 (−0.13 ± 0.49) | 20.52 (+2.19 ± 0.81) | 13.52 (+1.02 ± 1.04) | 46276 (+6185 ± 2390) | 82647 (+2624 ± 4870) |
| *Référence : stuffs des presets (n = 32, graines m21)* | 32 | 0/32 | 1.41 | 2.31 | 2.44 | 2.44 | 14.06 | 9.56 | 31925 | 52256 |
| **Défensif (`*_vortex_def`, proxy R2)** | 32 | 0/32 [0–11 %] | 0.91 (−0.50 ± 0.37) | 2.31 (+0.00 ± 0.38) | 2.75 (+0.31 ± 0.48) | 2.97 (+0.53 ± 0.52) | 22.47 (+8.41 ± 0.95) | 18.28 (+8.72 ± 0.97) | 53083 (+21158 ± 2710) | 89206 (+36950 ± 6895) |
| **Crâ seul en `vortex_cra_feu`** | 32 | 0/32 [0–11 %] | 1.31 (−0.09 ± 0.44) | 2.47 (+0.16 ± 0.39) | 2.56 (+0.13 ± 0.46) | 2.56 (+0.13 ± 0.46) | 14.69 (+0.63 ± 1.04) | 9.72 (+0.16 ± 1.23) | 31799 (−126 ± 2431) | 53001 (+745 ± 6463) |
| **Enutrof seul en `vortex_enutrof_eau`** | 32 | 0/32 [0–11 %] | 1.75 (+0.34 ± 0.45) | 2.91 (+0.59 ± 0.35) | 3.38 (+0.94 ± 0.53) | 3.38 (+0.94 ± 0.53) | 15.97 (+1.91 ± 0.97) | 10.69 (+1.13 ± 0.97) | 33129 (+1204 ± 2011) | 62780 (+10524 ± 5642) |
| **Iop seul en `vortex_iop_terre`** | 32 | 0/32 [0–11 %] | 1.50 (+0.09 ± 0.36) | 2.63 (+0.31 ± 0.42) | 2.84 (+0.41 ± 0.56) | 2.84 (+0.41 ± 0.56) | 14.47 (+0.41 ± 1.21) | 10.22 (+0.66 ± 1.10) | 30080 (−1845 ± 2375) | 54798 (+2542 ± 7408) |
| **Eniripsa seul en `vortex_eniripsa_feu`** | 32 | 0/32 [0–11 %] | 1.09 (−0.31 ± 0.40) | 2.41 (+0.09 ± 0.37) | 2.75 (+0.31 ± 0.44) | 2.78 (+0.34 ± 0.45) | 17.94 (+3.88 ± 1.11) | 9.94 (+0.38 ± 1.03) | 44588 (+12664 ± 2960) | 59414 (+7158 ± 6564) |
| **Exploration — v1 défensif (proxy R1)** | 32 | 0/32 [0–11 %] | 1.09 (−0.31 ± 0.37) | 2.44 (+0.13 ± 0.34) | 2.91 (+0.47 ± 0.41) | 3.16 (+0.72 ± 0.48) | 22.34 (+8.28 ± 1.07) | 18.78 (+9.22 ± 0.99) | 54210 (+22285 ± 2570) | 84664 (+32408 ± 7292) |
| **Exploration — v1 offensif (proxy R1)** | 32 | 0/32 [0–11 %] | 2.13 (+0.72 ± 0.35) | 3.13 (+0.81 ± 0.38) | 3.84 (+1.41 ± 0.60) | 3.88 (+1.44 ± 0.61) | 16.72 (+2.66 ± 1.04) | 10.44 (+0.88 ± 1.20) | 39049 (+7124 ± 2541) | 71422 (+19166 ± 6308) |
| **Exploration — v2 équilibré (proxy R2, poussée)** | 32 | 0/32 [0–11 %] | 1.44 (+0.03 ± 0.38) | 2.81 (+0.50 ± 0.33) | 3.63 (+1.19 ± 0.40) | 3.72 (+1.28 ± 0.45) | 20.19 (+6.13 ± 0.94) | 13.31 (+3.75 ± 1.10) | 46547 (+14623 ± 2356) | 79999 (+27743 ± 7232) |
| **Exploration — v2 équilibré, Dofus à passif gardés** | 32 | 0/32 [0–11 %] | 1.66 (+0.25 ± 0.48) | 2.81 (+0.50 ± 0.39) | 3.72 (+1.28 ± 0.59) | 3.84 (+1.41 ± 0.63) | 19.34 (+5.28 ± 0.98) | 13.81 (+4.25 ± 1.32) | 46496 (+14571 ± 2266) | 73491 (+21235 ± 6339) |
| **Exploration — v2 défensif, Dofus à passif gardés** | 32 | 0/32 [0–11 %] | 0.84 (−0.56 ± 0.40) | 2.28 (−0.03 ± 0.43) | 2.72 (+0.28 ± 0.57) | 2.75 (+0.31 ± 0.59) | 20.41 (+6.34 ± 1.04) | 17.34 (+7.78 ± 1.11) | 53832 (+21908 ± 2682) | 73239 (+20983 ± 6979) |
| **Exploration — mix1 : Crâ/Iop équilibré + Enutrof/Eniripsa défensif (R1)** | 32 | 0/32 [0–11 %] | 1.13 (−0.28 ± 0.39) | 2.59 (+0.28 ± 0.41) | 3.22 (+0.78 ± 0.61) | 3.50 (+1.06 ± 0.75) | 21.59 (+7.53 ± 1.15) | 12.84 (+3.28 ± 1.22) | 49757 (+17832 ± 2501) | 80823 (+28567 ± 8701) |
| **Exploration — mix2 : Crâ/Iop offensif + Enutrof/Eniripsa défensif (R1)** | 32 | 0/32 [0–11 %] | 1.13 (−0.28 ± 0.41) | 2.13 (−0.19 ± 0.41) | 2.56 (+0.13 ± 0.53) | 2.59 (+0.16 ± 0.52) | 20.53 (+6.47 ± 0.98) | 10.47 (+0.91 ± 1.12) | 44017 (+12092 ± 2529) | 66385 (+14129 ± 6046) |
| **Exploration — mix3 : Crâ/Iop offensif (R2) + Enutrof/Eniripsa équilibré (R1)** | 32 | 0/32 [0–11 %] | 1.78 (+0.38 ± 0.42) | 3.03 (+0.72 ± 0.45) | 3.72 (+1.28 ± 0.62) | 3.84 (+1.41 ± 0.68) | 19.31 (+5.25 ± 1.16) | 12.19 (+2.63 ± 1.35) | 44080 (+12155 ± 2656) | 76102 (+23846 ± 7336) |

Dégâts subis par combat (moyenne) selon la source et l'élément :

| Bras | Harpille | Brabuzar (dont poussée) | Buboxor | Méjaire | Ikargn | Vortex | Neutre | Terre | Feu | Eau | Air | Poussée | Poison |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Référence | 15148 | 5138 (1886) | 4932 | 3493 | 2701 | 609 | 7563 | 2739 | 6575 | 10183 | 3281 | 2159 | 6227 |
| Équilibré `*_vortex` | 16259 | 13813 (7073) | 5604 | 4273 | 4240 | 981 | 11427 | 3923 | 8533 | 10410 | 4210 | 7774 | 6006 |
| Offensif `*_vortex_off` | 17315 | 8980 (2510) | 5443 | 3953 | 2788 | 809 | 12678 | 3205 | 7979 | 9326 | 4000 | 2903 | 5159 |
| Défensif `*_vortex_def` (m21) | 13671 | 17867 (10966) | 6260 | 5473 | 7454 | 1248 | 10749 | 5481 | 8165 | 11425 | 5377 | 11887 | 6448 |
| Référence (m21) | 15215 | 4953 (1727) | 4785 | 3286 | 2497 | 709 | 7626 | 2676 | 6552 | 9882 | 3225 | 1964 | 6165 |

Mort de chaque personnage (tour moyen ; Crâ / Enutrof / Iop / Eniripsa) : Référence 11.9 / 13.9 / 12.3 / 11.8 ; Équilibré `*_vortex` 16.1 / 19.3 / 14.9 / 19.6 ; Offensif `*_vortex_off` 14.6 / 16.5 / 14.5 / 16.9 ; Défensif `*_vortex_def` (m21) 19.3 / 21.1 / 20.7 / 21.4 ; Référence (m21) 11.8 / 13.6 / 11.7 / 11.5.

**Lecture.** Les trois profils battent nettement la référence sur toutes les mesures, sans aucune victoire (0/64 partout, le Vortex n'est vulnérable qu'après la corruption des 19 monstres) :

- **Équilibré (recommandé)** : +1,8 monstre corrompu (2,5 → 4,3), **+6,1 tours de survie** (14,5 → 20,5), première mort +3,5 tours ; à corruption égale avec l'offensif (−0,13 ± 0,49), il survit **2,2 tours de plus** (± 0,8) — or la victoire exige de tenir jusqu'au ~26ᵉ tour du Vortex.
- **Offensif** : corrompt plus tôt (+0,6 à +0,7 au tour 7) mais meurt plus vite ; garder les Dofus à passif (Abyssal, Vulbis, Turquoise, Ocre) ou laisser l'optimiseur les remplacer par des Dofus à caractéristiques ne change rien de mesurable (−0,02 ± 0,54 corrompu).
- **Défensif** : première mort au tour 18,3 (au lieu de 9,6), 22,5 tours survécus, mais seulement +0,5 corrompu : les personnages vivent mais ne tuent plus assez « à la bonne heure ».
- **Par personnage** (un seul membre change, m21) : le stuff de l'**Enutrof** apporte le plus de corruption (+0,94 ± 0,53) et +1,9 tour, celui de l'**Eniripsa** le plus de survie (+3,9 ± 1,1 tours) ; Crâ (+0,13) et Iop (+0,41) seuls ne bougent presque rien — l'équipe tombe avec son maillon le plus fragile, d'où l'intérêt de changer les quatre stuffs ensemble (somme des effets isolés ≈ effet conjoint : +1,8 corrompu, +6,8 tours).
- **Mélanger les profils** (DPS équilibrés/offensifs + soutiens défensifs, mix1/mix2) **dégrade** la corruption (−0,8 corrompu) : l'Eniripsa et l'Enutrof doivent garder leurs dégâts.
- Le profil équilibré du proxy R2 (avec poussée) ne fait pas mieux que celui du proxy R1 (−0,6 ± 0,7 corrompu, n.s.) malgré −45 % de dégâts de poussée : le gain de Ré Pou a été payé en PV/dommages ailleurs.

## Équipe à utiliser

```
cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,eniripsa_soin_vortex
```

Équivalent explicite (même build) : `cra_feu_zone@vortex_cra_feu,enutrof_retrait_pm_eau@vortex_enutrof_eau,iop_terre_burst@vortex_iop_terre,eniripsa_soin_feu@vortex_eniripsa_feu` — un preset dérivé (`extends`) garde l'identité de son preset de base pour l'IA (variantes, rotation `scripted`, calibration DPT) et prend le stuff ET les points du stuff.

Variantes : offensif `cra_feu_vortex_off,enutrof_retrait_pm_vortex_off,iop_terre_vortex_off,eniripsa_soin_vortex_off` ; défensif `cra_feu_vortex_def,enutrof_retrait_pm_vortex_def,iop_terre_vortex_def,eniripsa_soin_vortex_def`.

Exemple : `npx tsx src/cli/simulate.ts batch vortex --team cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,eniripsa_soin_vortex --ai fast --runs 32 --json`.

## Builds retenus

### Crâ — `cra_feu_vortex` (stuff `vortex_cra_feu`, base `cra_feu_zone`)

Ossature du stuff méta conservée (Séculaire 3 + Cycloïde 3) ; l'optimiseur change la cape (Dame du Hasard), l'arme (Épée Diablotine, simple porte-caractéristiques : le Crâ ne frappe qu'aux sorts), un anneau (Ceste de Guerre) et les Dofus sans valeur mesurable pour le proxy (Abyssal, Dolmanax, Turquoise) au profit d'Aprybou (+40 résistances fixes), Dofus Pourpre (+80 Pui) et du trophée Impétueux (+6 % Do distance) ; **6 transcendances Rata Vi** (+600 Vi) et exo PO sur l'amulette (5 → 6 PO). 3 603 → **4 803 PV** ; DPT +14 %, EHP +47 % au proxy. En combat (n = 64) le Crâ meurt au tour 16,1 au lieu de 11,9.

| Emplacement | Objet | Niv. | Panoplie | Forgemagie (exos / transcendance) | Lignes clés (jet max) |
|---|---|---|---|---|---|
| Amulette | Amulette Séculaire | 200 | Panoplie Séculaire | exo +1 PO | +300 Vi, +80 Int, +25 Agi, +40 Sa, +1 PA, +12 Do Feu, +12 Do Air, +20 PP, +8 % Ré Neutre, +8 % Ré Feu |
| Anneau | Anneau du Cycloïde | 200 | Panoplie du Cycloïde | exo +1 PA | +300 Vi, +40 Fo, +40 Int, +40 Agi, +10 Do Neutre, +10 Do Terre, +10 Do Feu, +10 Do Air, +300 Ini, +8 % Ré Eau |
| Anneau | Ceste de Guerre | 200 | Panoplie de Guerre | exo +1 PM | +350 Vi, +60 Int, +30 Sa, +4 % CC, +10 Do Feu, -10 Soins, +7 % Ré Terre, +7 % Ré Air, +15 Do Cri |
| Ceinture | Ceinture Séculaire | 200 | Panoplie Séculaire | transcendance Rata Vi (+100 Vi) | +350 Vi, +80 Int, +40 Agi, +50 Sa, +7 % CC, +1 PO, +10 Do Feu, +10 Soins, +300 Ini, +10 % Ré Air |
| Bottes | Bottes du Cycloïde | 200 | Panoplie du Cycloïde | transcendance Rata Vi (+100 Vi) | +350 Vi, +50 Fo, +50 Int, +50 Agi, +50 Sa, +5 % CC, +1 PM, +1 PO, +10 Do Neutre, +10 Do Terre |
| Coiffe | Coiffe Séculaire | 200 | Panoplie Séculaire | transcendance Rata Vi (+100 Vi) | +300 Vi, +100 Int, +40 Agi, +40 Sa, +1 Invo, +10 Do Feu, +10 Do Air, +12 Soins, +15 PP, +7 % Ré Terre |
| Cape | Cape de la Dame du Hasard | 200 | Panoplie de la Dame du Hasard | transcendance Rata Vi (+100 Vi) | +350 Vi, +70 Int, +70 Cha, +40 Sa, +6 % CC, +1 PO, +10 Do Feu, +10 Do Eau, +15 PP, +7 % Ré Terre |
| Bouclier | Bouclier du Cycloïde | 200 | Panoplie du Cycloïde | transcendance Rata Vi (+100 Vi) | +250 Vi, +60 Fo, +60 Int, +60 Agi, +40 Sa, +6 % CC, +8 % Ré Terre, +6 % Ré Feu, +4 % Ré Air, +10 Tacle |
| Arme | Épée Diablotine | 200 | — | transcendance Rata Vi (+100 Vi) | +350 Vi, +60 Int, +30 Sa, +30 Pui, +5 % CC, +1 Invo, +15 Do Feu, +15 Soins, +7 % Ré Neutre, +7 % Ré Feu |
| Familier/Monture | Bisouglours | 20 | — | — | +120 Int, +20 Do Feu |
| Dofus/Trophée/Prysma | Impétueux | 150 | — | — | +6 % Do Distance, -6 % Ré Distance |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus Vulbis | 180 | — | — | +1 PM, sort passif |
| Dofus/Trophée/Prysma | Dofus des Glaces | 180 | — | — | +25 Do Neutre, +25 Do Terre, +25 Do Feu, +25 Do Eau, +25 Do Air |
| Dofus/Trophée/Prysma | Dofus Pourpre | 110 | — | — | +80 Pui, sort passif |
| Dofus/Trophée/Prysma | Dofus Ocre | 160 | — | — | +1 PA, sort passif |

**Points de caractéristiques** (995/995 points dépensés) : base Vitalité 3, Intelligence 398 ; parchemins +100 dans les six caractéristiques. Panoplies : Panoplie Séculaire (3 objets), Panoplie du Cycloïde (3 objets).

**Caractéristiques finales** : 12 PA / 6 PM / 6 PO, **4803 PV**, Vitalité 3753, Sagesse 420, Force 280, Intelligence 1308, Chance 170, Agilité 440 ; résistances 15/29/21/22/31 % (N/T/F/E/A), fixes 40/55/40/40/55, Ré Pou 0, Ré Cri 15, % Ré mêlée/distance 0/-6 ; Puissance 110, Dommages 0, Do élém. 55/55/152/35/97, % Do sorts 0, % Do distance/mêlée 6/0, % Do finaux 0, 53 % CC, Do Cri 77, Soins 57, Ret PA/PM 42/55, Esq PA/PM 42/42, Tacle/Fuite 70/79, Initiative 1798.

**Proxy** (DPT / EHP / UTIL, logJ) — départ → retenu :

| Cible du proxy | Départ (stuff du preset) | Retenu |
|---|---|---|
| R2 équilibré | 2450 / 4293 / 0 (7.921) | 2794 / 6209 / 0 (8.175) |
| R2 défensif | 2450 / 4293 / 0 (8.033) | 2794 / 6209 / 0 (8.335) |
| R2 offensif | 2450 / 4293 / 0 (7.837) | 2794 / 6209 / 0 (8.055) |
| R1 (sans poussée) | 2450 / 4477 / 0 (7.934) | 2794 / 6596 / 0 (8.193) |

Front de Pareto du profil retenu (DPT / EHP / UTIL ; PV, Ré Pou, points) : 2794/6596/0 (4803 PV, 0 Ré Pou, preset) ; 2757/6780/0 (4853 PV, 0 Ré Pou, preset) ; 2896/6010/0 (4803 PV, 0 Ré Pou, preset) ; 2850/6236/0 (4803 PV, 0 Ré Pou, start) ; 2731/6883/0 (4803 PV, 0 Ré Pou, start) ; 2959/5681/0 (4803 PV, 0 Ré Pou, start).

### Enutrof — `enutrof_retrait_pm_vortex` (stuff `vortex_enutrof_eau`, base `enutrof_retrait_pm_eau`)

Le stuff « retrait » des presets sacrifiait les dommages : l'optimiseur passe à Voldelor (3) + Gouffre (3), **200 Chance de base + 695 Vitalité** (au lieu de tout en Chance), **5 transcendances Rata Ret Pme** (+4 Ret PM chacune, 152 Ret PM au total), Volkorne Doré et Turquoise (+1 PA, +30 Ret PM), trophée Entraveur majeur (+24 Ret PM), Dofus Ivoire (+4 % résistances), Argenté Scintillant (+300 Vi), Glaces, Vulbis et Aprybou. 4 253 → **5 745 PV**, résistances 36/18/38/54/21 % ; au proxy DPT +80 %, EHP +50 %, retrait PM espéré +28 %. En combat l'Enutrof inflige 2,3× plus (19 200 contre 8 200 par combat, m21) et meurt au tour 19,3 au lieu de 13,9 (n = 64).

| Emplacement | Objet | Niv. | Panoplie | Forgemagie (exos / transcendance) | Lignes clés (jet max) |
|---|---|---|---|---|---|
| Amulette | Amulette Voldelor | 200 | Panoplie de Voldelor | transcendance Rata Ret Pme (+4 Ret PM) | +300 Vi, +70 Cha, +70 Agi, +40 Sa, +1 PA, +12 Do Eau, +12 Do Air, +15 PP, +10 % Ré Feu, +10 % Ré Eau |
| Anneau | Bracelet du Piloztère | 200 | Panoplie du Piloztère | exo +1 PA | +300 Vi, +50 Pui, +4 % CC, +2 PO, +10 Do Neutre, +10 Do Terre, +10 Do Eau, +10 % Ré Neutre |
| Anneau | Alliance Gloursonne | 198 | Panoplie Gloursonne | exo +1 PM | +250 Vi, +60 Cha, +60 Agi, +40 Sa, +1 PO, +12 Do Eau, +12 Do Air, +10 PP, +400 Ini, +7 % Ré Neutre |
| Ceinture | Ceinture Voldelor | 200 | Panoplie de Voldelor | transcendance Rata Ret Pme (+4 Ret PM) | +300 Vi, +70 Cha, +70 Agi, +50 Sa, +1 PO, +15 Do Eau, +15 Do Air, +15 PP, +10 % Ré Feu, +10 % Ré Eau |
| Bottes | Bottes Voldelor | 200 | Panoplie de Voldelor | transcendance Rata Ret Pme (+4 Ret PM) | +350 Vi, +70 Cha, +70 Agi, +40 Sa, +10 % CC, +1 PM, +12 Do Eau, +12 Do Air, +7 Fuite, +20 Ré Pou |
| Coiffe | Visage de Mureine | 200 | Panoplie du Gouffre | exo +1 PO | +500 Vi, +80 Cha, +50 Sa, +5 % CC, +1 Invo, +20 Do Eau, +20 PP, -300 Ini, +10 % Ré Eau, +7 % Ré Air |
| Cape | Dorsale de Willorque | 200 | Panoplie du Gouffre | transcendance Rata Ret Pme (+4 Ret PM) | +500 Vi, +100 Cha, +50 Sa, +6 % CC, +10 Do Eau, +12 Soins, +15 PP, -300 Ini, +7 % Ré Terre, +10 % Ré Eau |
| Bouclier | Jadis | 200 | — | transcendance Rata Ret Pme (+4 Ret PM) | +250 Vi, +40 Sa, +15 % Ré Neutre, +15 Tacle, +15 Esq PA, +15 Esq PM, +50 Ré Cri, +50 Ré Pou, +7 % Ré Mêlée, +5 % Ré Distance |
| Arme | Lancepince d'Exécrabe | 200 | Panoplie du Gouffre | transcendance Rata Do Eau (+6 Do Eau) | +500 Vi, +90 Cha, +50 Sa, +5 % CC, +12 Do Eau, +15 PP, -300 Ini, +7 % Ré Feu, +10 % Ré Eau, +10 Tacle |
| Familier/Monture | Volkorne Doré et Turquoise | 60 | — | — | +200 Vi, +1 PA, +30 Ret PM |
| Dofus/Trophée/Prysma | Dofus des Glaces | 180 | — | — | +25 Do Neutre, +25 Do Terre, +25 Do Feu, +25 Do Eau, +25 Do Air |
| Dofus/Trophée/Prysma | Entraveur majeur | 150 | — | — | +24 Ret PM, -24 Esq PA |
| Dofus/Trophée/Prysma | Dofus Ivoire | 180 | — | — | +4 % Ré Neutre, +4 % Ré Terre, +4 % Ré Feu, +4 % Ré Eau, +4 % Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus Argenté Scintillant | 180 | — | — | +300 Vi, sort passif |
| Dofus/Trophée/Prysma | Dofus Vulbis | 180 | — | — | +1 PM, sort passif |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |

**Points de caractéristiques** (995/995 points dépensés) : base Vitalité 695, Chance 200 ; parchemins +100 dans les six caractéristiques. Panoplies : Panoplie de Voldelor (3 objets), Panoplie du Gouffre (3 objets).

**Caractéristiques finales** : 12 PA / 6 PM / 6 PO, **5745 PV**, Vitalité 4695, Sagesse 460, Force 100, Intelligence 100, Chance 940, Agilité 410 ; résistances 36/18/38/54/21 % (N/T/F/E/A), fixes 40/40/40/40/40, Ré Pou 70, Ré Cri 50, % Ré mêlée/distance 7/5 ; Puissance 50, Dommages 0, Do élém. 35/35/25/134/76, % Do sorts 0, % Do distance/mêlée 0/0, % Do finaux 0, 47 % CC, Do Cri 85, Soins 12, Ret PA/PM 66/152, Esq PA/PM 27/37, Tacle/Fuite 106/62, Initiative 50.

**Proxy** (DPT / EHP / UTIL, logJ) — départ → retenu :

| Cible du proxy | Départ (stuff du preset) | Retenu |
|---|---|---|
| R2 équilibré | 978 / 6683 / 0.726 (6.134) | 1760 / 11122 / 0.93 (6.626) |
| R2 défensif | 978 / 6683 / 0.726 (6.519) | 1760 / 11122 / 0.93 (6.995) |
| R2 offensif | 978 / 6683 / 0.726 (5.846) | 1760 / 11122 / 0.93 (6.349) |
| R1 (sans poussée) | 978 / 7438 / 0.726 (6.177) | 1760 / 11182 / 0.93 (6.628) |

Front de Pareto du profil retenu (DPT / EHP / UTIL ; PV, Ré Pou, points) : 1760/11182/0.93 (5745 PV, 70 Ré Pou, cap200) ; 1812/10890/0.93 (5595 PV, 70 Ré Pou, cap250) ; 1865/10598/0.93 (5445 PV, 70 Ré Pou, cap300) ; 1969/9835/0.93 (5053 PV, 70 Ré Pou, preset) ; 2052/9467/0.93 (5053 PV, 70 Ré Pou, start) ; 1890/9829/0.942 (5050 PV, 70 Ré Pou, wisdom100).

### Iop — `iop_terre_vortex` (stuff `vortex_iop_terre`, base `iop_terre_burst`)

Iop au contact : la PO n'est plus payée (6 → 2 PO) au profit des coups critiques — Bonimenteur (3 : Talisman Songe, Sangle Ouare, Cape Ovri), Cycloïde (3), Torkélonia (2 : Corne + Baguette, condition Agi > 299 et Fo > 299 remplie), **4 transcendances Pata Do Cri** (+32 Do Cri) et 2 Rata Vi, montilier Sakochère (+1 PA, +50 Do Cri), trophée Arcaniste (+6 % Do sorts), Dofus Turquoise, Pourpre, Glaces, Dolmanax et Aprybou. **81 % CC**, 4 203 PV, résistances fixes 40-75 ; DPT +11 %, EHP +17 % au proxy. Le maillon faible reste l'Iop (premier mort, tour 14,9 au lieu de 12,3, n = 64).

| Emplacement | Objet | Niv. | Panoplie | Forgemagie (exos / transcendance) | Lignes clés (jet max) |
|---|---|---|---|---|---|
| Amulette | Talisman Songe | 200 | Panoplie du Bonimenteur | transcendance Rata Vi (+100 Vi) | +300 Vi, +60 Fo, +60 Int, +60 Cha, +40 Sa, +1 PA, +15 Do Neutre, +15 Do Terre, +15 Do Feu, +15 Do Eau |
| Anneau | Bague de Corruption | 200 | Panoplie de Corruption | exo +1 PM | +250 Vi, +60 Fo, +20 Sa, +7 % CC, +12 Do Neutre, +12 Do Terre, +10 % Ré Eau, -5 Esq PA, +10 Do Cri |
| Anneau | Anneau du Cycloïde | 200 | Panoplie du Cycloïde | transcendance Pata Do Cri (+8 Do Cri) | +300 Vi, +40 Fo, +40 Int, +40 Agi, +10 Do Neutre, +10 Do Terre, +10 Do Feu, +10 Do Air, +300 Ini, +8 % Ré Eau |
| Ceinture | Sangle Ouare | 200 | Panoplie du Bonimenteur | transcendance Rata Vi (+100 Vi) | +300 Vi, +40 Cha, +30 Sa, +40 Pui, +1 PM, +2 Invo, +15 PP, -400 Ini, +10 % Ré Eau, +10 % Ré Air |
| Bottes | Bottes du Cycloïde | 200 | Panoplie du Cycloïde | transcendance Pata Do Cri (+8 Do Cri) | +350 Vi, +50 Fo, +50 Int, +50 Agi, +50 Sa, +5 % CC, +1 PM, +1 PO, +10 Do Neutre, +10 Do Terre |
| Coiffe | Corne de Torkélonia | 200 | Panoplie de Torkélonia | transcendance Pata Do Cri (+8 Do Cri) | +350 Vi, +70 Fo, +50 Agi, +35 Sa, +5 % CC, +12 Do Terre, +12 Do Air, +20 PP, +10 % Ré Neutre, +10 % Ré Terre |
| Cape | Cape Ovri | 200 | Panoplie du Bonimenteur | exo +1 PA | +400 Vi, +60 Fo, +60 Cha, +50 Sa, +5 % CC, +16 Do Neutre, +16 Do Terre, +16 Do Eau, +400 Ini, +10 % Ré Neutre |
| Bouclier | Bouclier du Cycloïde | 200 | Panoplie du Cycloïde | transcendance Pata Do Cri (+8 Do Cri) | +250 Vi, +60 Fo, +60 Int, +60 Agi, +40 Sa, +6 % CC, +8 % Ré Terre, +6 % Ré Feu, +4 % Ré Air, +10 Tacle |
| Arme | Baguette de Torkélonia | 200 | Panoplie de Torkélonia | — | +350 Vi, +60 Fo, +60 Agi, +40 Sa, +30 Pui, +6 % CC, +1 Invo, +20 Do Terre, +20 Do Air, +25 PP — condition `CA>299&CS>299` |
| Familier/Monture | Sakochère | 60 | — | — | +1 PA, +50 Do Cri |
| Dofus/Trophée/Prysma | Dofus Turquoise | 160 | — | — | +10 % CC, sort passif |
| Dofus/Trophée/Prysma | Dolmanax | 100 | — | — | +70 Fo, +70 Int, +70 Cha, +70 Agi |
| Dofus/Trophée/Prysma | Dofus Pourpre | 110 | — | — | +80 Pui, sort passif |
| Dofus/Trophée/Prysma | Arcaniste | 150 | — | — | +6 % Do Sorts, -6 % Ré Distance, -6 % Ré Mêlée |
| Dofus/Trophée/Prysma | Dofus des Glaces | 180 | — | — | +25 Do Neutre, +25 Do Terre, +25 Do Feu, +25 Do Eau, +25 Do Air |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |

**Points de caractéristiques** (995/995 points dépensés) : base Vitalité 3, Force 398 ; parchemins +100 dans les six caractéristiques. Panoplies : Panoplie du Bonimenteur (3 objets), Panoplie du Cycloïde (3 objets), Panoplie de Torkélonia (2 objets).

**Caractéristiques finales** : 12 PA / 6 PM / 2 PO, **4203 PV**, Vitalité 3153, Sagesse 405, Force 1138, Intelligence 510, Chance 330, Agilité 500 ; résistances 20/18/16/38/32 % (N/T/F/E/A), fixes 40/70/75/55/40, Ré Pou 0, Ré Cri 0, % Ré mêlée/distance -6/-6 ; Puissance 200, Dommages 0, Do élém. 98/130/86/56/87, % Do sorts 6, % Do distance/mêlée 0/0, % Do finaux 0, 81 % CC, Do Cri 174, Soins 0, Ret PA/PM 40/40, Esq PA/PM 35/37, Tacle/Fuite 91/50, Initiative 1778.

**Proxy** (DPT / EHP / UTIL, logJ) — départ → retenu :

| Cible du proxy | Départ (stuff du preset) | Retenu |
|---|---|---|
| R2 équilibré | 2754 / 5125 / 0 (8.107) | 3061 / 5759 / 0 (8.216) |
| R2 défensif | 2754 / 5125 / 0 (8.231) | 3061 / 5759 / 0 (8.343) |
| R2 offensif | 2754 / 5125 / 0 (8.014) | 3061 / 5759 / 0 (8.121) |
| R1 (sans poussée) | 2754 / 5337 / 0 (8.119) | 3061 / 6263 / 0 (8.241) |

Front de Pareto du profil retenu (DPT / EHP / UTIL ; PV, Ré Pou, points) : 3061/6263/0 (4203 PV, 0 Ré Pou, preset) ; 3001/6561/0 (4403 PV, 0 Ré Pou, preset) ; 2941/6847/0 (4595 PV, 0 Ré Pou, cap300) ; 2919/6943/0 (4403 PV, 0 Ré Pou, preset) ; 2881/7145/0 (4795 PV, 0 Ré Pou, cap300) ; 2970/6633/0 (4203 PV, 0 Ré Pou, preset).

### Eniripsa — `eniripsa_soin_vortex` (stuff `vortex_eniripsa_feu`, base `eniripsa_soin_feu`)

Soigneur : le proxy (exposants 0,2/0,5/1) accepte −13 % de DPT pour ×2,5 d'EHP — Pnose (3), Vénérable Endormi (2), Panoplistik (2), **300 Int + 395 Vi de base**, **6 transcendances Rata Vi**, Dofus Ivoire, Argenté Scintillant, Ocre, Vulbis, Dolmanax, Aprybou, Volkorne Saphir et Orchidée (+1 PA, +8 % Ré Eau). 3 603 → **5 745 PV**, résistances 40/33/33/51/14 %, Soins 140. En combat l'Eniripsa tient jusqu'au tour 19,6 au lieu de 11,8 (n = 64) et soigne 3× plus (43 700 contre 14 300 par combat, m21).

| Emplacement | Objet | Niv. | Panoplie | Forgemagie (exos / transcendance) | Lignes clés (jet max) |
|---|---|---|---|---|---|
| Amulette | Talisman Igans | 200 | Panoplie Pnose | transcendance Rata Vi (+100 Vi) | +350 Vi, +60 Int, +60 Cha, +50 Sa, +4 % CC, +1 PA, +1 PO, +20 Do Feu, +20 Do Eau, +7 % Ré Neutre |
| Anneau | Malédiction du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | exo +1 PA | +300 Vi, +100 Int, +20 Sa, +3 % CC, +10 PP, -300 Ini, +7 % Ré Feu, +7 % Ré Eau, +10 Ret PA, +15 Ré Pou |
| Anneau | Baguistik | 200 | Panoplistik | exo +1 PM | +300 Vi, +40 Fo, +40 Int, +40 Sa, +4 % CC, +1 PO, +7 Do Neutre, +7 Do Terre, +7 Do Feu, +10 Soins |
| Ceinture | Ceintrigue | 200 | Panoplie Pnose | transcendance Rata Vi (+100 Vi) | +350 Vi, +60 Int, +60 Cha, +40 Sa, +4 % CC, +1 PO, +20 Do Feu, +20 Do Eau, +15 Soins, +10 % Ré Air |
| Bottes | Bottes Owesli | 200 | Panoplie Pnose | transcendance Rata Vi (+100 Vi) | +400 Vi, +50 Int, +50 Cha, +40 Sa, +1 PM, +1 PO, +20 Do Feu, +20 Do Eau, +7 % Ré Neutre, +7 % Ré Terre |
| Coiffe | Masquegel | 200 | Panoplie Martegel | transcendance Rata Vi (+100 Vi) | +400 Vi, +80 Int, +80 Agi, +40 Sa, -10 % CC, +1 Invo, +15 Do Feu, +15 Do Air, +10 % Ré Neutre, +10 % Ré Eau |
| Cape | Manteau du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transcendance Rata Vi (+100 Vi) | +400 Vi, +100 Int, +50 Sa, +7 % CC, +1 Invo, +10 Do Feu, +15 Soins, +15 PP, -200 Ini, +5 % Ré Terre |
| Bouclier | Bouclistik | 200 | Panoplistik | transcendance Rata Vi (+100 Vi) | +250 Vi, +40 Sa, +50 Pui, +1 PO, +20 PP, +5 % Ré Neutre, +15 Tacle, +40 Do Pou, +7 % Ré Mêlée |
| Arme | Marteau Possédé | 200 | — | — | +400 Vi, +50 Int, +60 Sa, +50 Pui, +3 % CC, +1 Invo, +12 Do Feu, +20 Soins, +10 PP, -300 Ini |
| Familier/Monture | Volkorne Saphir et Orchidée | 60 | — | — | +70 Int, +1 PA, +8 % Ré Eau |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus Ocre | 160 | — | — | +1 PA, sort passif |
| Dofus/Trophée/Prysma | Dofus Ivoire | 180 | — | — | +4 % Ré Neutre, +4 % Ré Terre, +4 % Ré Feu, +4 % Ré Eau, +4 % Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dolmanax | 100 | — | — | +70 Fo, +70 Int, +70 Cha, +70 Agi |
| Dofus/Trophée/Prysma | Dofus Vulbis | 180 | — | — | +1 PM, sort passif |
| Dofus/Trophée/Prysma | Dofus Argenté Scintillant | 180 | — | — | +300 Vi, sort passif |

**Points de caractéristiques** (995/995 points dépensés) : base Vitalité 395, Intelligence 300 ; parchemins +100 dans les six caractéristiques. Panoplies : Panoplie Pnose (3 objets), Panoplie du Vénérable Endormi (2 objets), Panoplistik (2 objets).

**Caractéristiques finales** : 12 PA / 6 PM / 6 PO, **5745 PV**, Vitalité 4695, Sagesse 520, Force 310, Intelligence 1220, Chance 380, Agilité 250 ; résistances 40/33/33/51/14 % (N/T/F/E/A), fixes 40/40/40/40/40, Ré Pou 45, Ré Cri 75, % Ré mêlée/distance 7/0 ; Puissance 100, Dommages 0, Do élém. 17/23/120/60/15, % Do sorts 0, % Do distance/mêlée 0/0, % Do finaux 0, 15 % CC, Do Cri 0, Soins 140, Ret PA/PM 62/52, Esq PA/PM 62/52, Tacle/Fuite 34/54, Initiative 360.

**Proxy** (DPT / EHP / UTIL, logJ) — départ → retenu :

| Cible du proxy | Départ (stuff du preset) | Retenu |
|---|---|---|
| R2 équilibré | 2004 / 4293 / 1.39 (6.523) | 1735 / 10571 / 1.455 (7.023) |
| R2 défensif | 2004 / 4293 / 1.39 (7.055) | 1735 / 10571 / 1.455 (7.757) |
| R2 offensif | 2004 / 4293 / 1.39 (6.409) | 1735 / 10571 / 1.455 (6.752) |
| R1 (sans poussée) | 2004 / 4477 / 1.39 (6.544) | 1735 / 11113 / 1.455 (7.048) |

Front de Pareto du profil retenu (DPT / EHP / UTIL ; PV, Ré Pou, points) : 1735/11113/1.455 (5745 PV, 45 Ré Pou, cap300) ; 1833/10354/1.51 (5353 PV, 45 Ré Pou, preset) ; 1769/10520/1.505 (5645 PV, 45 Ré Pou, cap300) ; 1684/11403/1.428 (5895 PV, 45 Ré Pou, cap250) ; 1871/9790/1.56 (5253 PV, 45 Ré Pou, preset) ; 1763/10741/1.472 (5553 PV, 45 Ré Pou, start).

### Variante offensive (`*_vortex_off`, stuffs `vortex_*_off`)

Proxy R2 offensif (a + 0,15, b − 0,15), Dofus à sort passif du stuff de départ imposés (`fixed`). Corrompt le plus tôt (2,0 au tour 7) mais survit 2,2 tours de moins que l'équilibré.

`cra_feu_vortex_off,enutrof_retrait_pm_vortex_off,iop_terre_vortex_off,eniripsa_soin_vortex_off`

| Personnage | Objets (forgemagie) | Points (base) | PV | PA/PM/PO | % Rés N/T/F/E/A | Rés fixes | Ré Pou | % CC | Stat principale |
|---|---|---|---|---|---|---|---|---|---|
| Crâ | Amulette d'Otomaï [T. Pata Do Cri (+8 Do Cri)], Anneau de Padgref [exo +1 PM], Ceste de Guerre [exo +1 PO], Ceinture Séculaire [T. Ta Do Per Di (+1 % Do Distance)], Solerets de Guerre [T. Ta Do Per Di (+1 % Do Distance)], Coiffe Séculaire [exo +1 PA], Cape de la Dame du Hasard [T. Ta Do Per Di (+1 % Do Distance)], Fiole d'Otomaï [T. Pata Do Cri (+8 Do Cri)], Épée d'Otomaï [T. Pata Do Cri (+8 Do Cri)], Sakochère, Dofus Abyssal, Dofus Vulbis, Dofus Turquoise, Dofus Ocre, Arcaniste, Impétueux | Vitalité 3, Intelligence 398 | 4003 | 12/6/6 | 14/21/14/36/17 | 20/10/0/20/25 | 0 | 64 | Intelligence 1358 |
| Enutrof | Amulette Voldelor [exo +1 PO], Ceste gelé du Chevalier de Glace [exo +1 PA], Alliance Gloursonne [exo +1 PM], Ceinture Voldelor [T. Rata Vi (+100 Vi)], Bottes Voldelor [T. Rata Vi (+100 Vi)], Dora de Servitude [T. Ta Do Per So (+1 % Do Sorts)], Manteau de Servitude [T. Rata Vi (+100 Vi)], Pavois frigorifié du Chevalier de Glace [T. Rata Vi (+100 Vi)], Lancepince d'Exécrabe [T. Ta Do Per So (+1 % Do Sorts)], Volkorne Turquoise et Indigo, Dofus Cawotte, Dofus Ocre, Dofus Vulbis, Dofus Turquoise, Dofus Abyssal, Aprybou | Vitalité 3, Chance 398 | 4803 | 12/6/6 | 22/25/44/53/10 | 40/40/40/40/40 | 140 | 42 | Chance 1308 |
| Iop | Amulette de Wulan [T. Ta Do Per So (+1 % Do Sorts)], Anneau du Cycloïde [exo +1 PM], Bague de Corruption [T. Pata Do Cri (+8 Do Cri)], Ceinturonce de Corruption [exo +1 PA], Bottes du Cycloïde [T. Pata Do Cri (+8 Do Cri)], Corne de Torkélonia [T. Pata Do Cri (+8 Do Cri)], Carapace de Torkélonia [T. Pata Do Cri (+8 Do Cri)], Bouclier du Cycloïde [T. Pata Do Cri (+8 Do Cri)], Baguette de Torkélonia, Kokulte, Dofus Abyssal, Dofus Ocre, Dofus Vulbis, Dofus Turquoise, Dofus Sylvestre, Arcaniste | Vitalité 3, Force 398 | 4003 | 12/6/6 | 20/25/16/25/31 | 0/30/0/15/0 | 0 | 95 | Force 1148 |
| Eniripsa | Amulette Séculaire [exo +1 PO], Malédiction du Vénérable Endormi [exo +1 PA], Baguistik [exo +1 PM], Ceinture Séculaire [T. Rata Ine (+20 Int)], Bottistik [T. Rata Ine (+20 Int)], Coiffe Séculaire [T. Rata Vi (+100 Vi)], Manteau du Vénérable Endormi [T. Rata Vi (+100 Vi)], Bouclier de Solar [T. Rata Ine (+20 Int)], Arc du Vénérable Endormi [T. Rata Ine (+20 Int)], Bisouglours, Dofus Abyssal, Dofus Vulbis, Dofus Turquoise, Dofus Ocre, Aprybou, Dolmanax | Vitalité 3, Intelligence 398 | 4703 | 12/6/6 | 15/36/27/33/20 | 40/40/40/40/55 | 155 | 47 | Intelligence 1548 |

### Variante défensive (`*_vortex_def`, stuffs `vortex_*_def`)

Proxy R2 défensif (a − 0,2, b + 0,2, poussée modélisée) : 6 000-6 300 PV et 140-195 Ré Pou par personnage ; première mort au tour 18,3 mais moins de corruptions. À utiliser si l'IA progresse en corruption (tour 3 de réglage) et que la survie redevient le facteur limitant.

`cra_feu_vortex_def,enutrof_retrait_pm_vortex_def,iop_terre_vortex_def,eniripsa_soin_vortex_def`

| Personnage | Objets (forgemagie) | Points (base) | PV | PA/PM/PO | % Rés N/T/F/E/A | Rés fixes | Ré Pou | % CC | Stat principale |
|---|---|---|---|---|---|---|---|---|---|
| Crâ | Talisman Igans [T. Rata Vi (+100 Vi)], Malédiction du Vénérable Endormi [exo +1 PA], Anneau Tique [exo +1 PM], Ceintrigue [T. Rata Vi (+100 Vi)], Bottes Owesli [T. Rata Vi (+100 Vi)], Dorabysses [T. Rata Vi (+100 Vi)], Manteau du Vénérable Endormi [T. Rata Vi (+100 Vi)], Bouclier du Stalak [T. Rata Vi (+100 Vi)], Arc du Karkanik, Volkorne Doré et Orchidée, Dofus Ivoire, Aprybou, Dofus Vulbis, Dofus des Glaces, Dofus Argenté Scintillant, Dofus Ocre | Vitalité 395, Intelligence 300 | 6045 | 12/6/6 | 30/23/48/46/34 | 40/40/40/40/40 | 165 | 25 | Intelligence 1020 |
| Enutrof | Collier de Gargandyas, Bague Trithon [exo +1 PA], Ceste gelé du Chevalier de Glace [exo +1 PM], Ceinture de Léthaline [T. Rata Vi (+100 Vi)], Bottes de Léthaline [T. Rata Vi (+100 Vi)], Dora de Servitude [T. Pata Ré Pou (+12 Ré Pou)], Cape de Léthaline [T. Rata Vi (+100 Vi)], Jadis [T. Rata Vi (+100 Vi)], Lancepince d'Exécrabe [T. Pata Ré Pou (+12 Ré Pou)], Volkorne Doré et Turquoise, Aprybou, Dofus Argenté Scintillant, Dofus Vulbis, Dofus Ivoire, Entraveur majeur, Prudent | Vitalité 695, Chance 200 | 6295 | 12/6/6 | 41/26/23/49/16 | 58/58/58/58/58 | 144 | 37 | Chance 500 |
| Iop | Talisman Songe [T. Rata Vi (+100 Vi)], Anneau du Comte Harebourg [exo +1 PA], Bague de Corruption [T. Rata Vi (+100 Vi)], Sangle Ouare [T. Rata Vi (+100 Vi)], Bottes du Comte Harebourg [T. Rata Vi (+100 Vi)], Cornes du Vénérable Endormi [exo +1 PM], Cape Ovri [T. Rata Vi (+100 Vi)], Jadis [T. Rata Vi (+100 Vi)], Arc du Vénérable Endormi, Volkorne Doré et Pourpre, Dofus Ocre, Dofus Argenté Scintillant, Dolmanax, Aprybou, Dofus Pourpre, Dofus Ivoire | Vitalité 395, Force 300 | 6245 | 12/6/2 | 32/14/22/49/30 | 70/40/75/40/40 | 170 | 48 | Force 1210 |
| Eniripsa | Amulette Séculaire [exo +1 PO], Anneau Rifique [exo +1 PA], Malédiction du Vénérable Endormi [exo +1 PM], Ceinture de Léthaline [T. Rata Vi (+100 Vi)], Bottes de Léthaline [T. Rata Vi (+100 Vi)], Coiffe Séculaire [T. Rata Vi (+100 Vi)], Cape de Léthaline [T. Rata Vi (+100 Vi)], Jadis [T. Rata Vi (+100 Vi)], Arc du Vénérable Endormi [T. Ta Ré Per Eau (+2 % Ré Eau)], Volkorne Saphir et Doré, Aprybou, Dofus Ocre, Dolmanax, Dofus Ivoire, Dofus Argenté Scintillant, Dofus Forgelave | Vitalité 695, Intelligence 200 | 6195 | 12/6/6 | 49/30/31/47/16 | 58/58/58/58/73 | 195 | 44 | Intelligence 850 |

## Ce que couvre l'optimiseur (audit) et corrections

| Point demandé | Couvert ? | Détail (src/optimizer/stuff) |
|---|---|---|
| Tous les emplacements | oui | 16 positions : amulette, 2 anneaux, ceinture, bottes, coiffe, cape, bouclier, arme, familier/montilier/monture (types 18, 121, 331-333 : un seul emplacement), 6 Dofus/trophées/prysmaradites (`pools.ts`, `STUFF_POSITIONS`). Équipements niv. 180-200, Dofus/trophées/familiers/montures tous niveaux ≤ 200. |
| Conditions d'objets | oui | `computeBuildStats` sur chaque build (le chemin rapide ré-évalue les conditions après forgemagie) ; règles : niveau, un objet par emplacement, jamais deux fois le même Dofus/trophée ni deux anneaux identiques d'une panoplie, **une seule prysmaradite**, bouclier compatible avec toute arme (règle « deux mains » supprimée en 2.41, equipment.md §2.3), conditions `Pk<3` des trophées de 3ᵉ génération, plafonds 2897. |
| Bonus de panoplie | oui | paliers appliqués par `computeBuildStats` ; blocs de panoplie posés/retirés en bloc par le recuit (« la dominance ne voit pas les bonus »). |
| Exos PA / PM / PO | oui | profil `thlOptimized` (equipment.md §11.3) : au plus UN exo PA, UN PM, UN PO par personnage (devblog 2.3.4), une seule ligne de forgemagie par objet, hôte = anneau/amulette/ceinture/bottes/coiffe/cape sans ligne de la caractéristique, posé seulement s'il est utile (plafonds 12/6/6). |
| « Exo 1 % dommages sorts » et transcendances | oui | c'est la rune de transcendance **Ta Do Per So** (+1 % Do sorts, niv. 200) : les 81 runes Ta/Pata/Rata sont proposées (une par objet, objet sans exo ni over, niveau de rune ≤ niveau de l'objet, poids de ligne ≤ 101), au plus 6 par stuff ; le choix (Rata Vi +100, Ta Do Per So, Rata stat +20, Rata Do élém. +6, Ta Ré Per élém. +2 %, Pata Ré Pou +12…) suit les poids marginaux du proxy. |
| Points de caractéristiques | oui | 995 points au niveau 200, coûts par paliers (`allocateAll`) ; répartitions candidates : tout dans l'élément, 300/250/200 dans l'élément + Vitalité, 100 Sagesse (retrait), tank (`points.ts`). |
| Parchemins | oui | +100 dans les six caractéristiques (personnage « parchoté »). |
| Overs, exos « au puits » (Do, Pui, Ré %), bonbons | non (volontaire) | coût et réussite non réalistes pour un stuff de référence (equipment.md §11.2-11.3, §10) ; le profil retenu est « jets parfaits + exos PA/PM/PO + transcendances ». |

**Problèmes trouvés et corrigés** (tests : `tests/opt-stuff-vortex.test.ts`) :

1. **Dégâts reçus pondérés par le mauvais mix** (corrigé au 1er passage, `vortex.ts`) : l'EHP utilisait le mix des CIBLES, où le Vortex (invulnérable et presque passif en phase 1) pesait 33 % des dégâts reçus prévus ⇒ l'optimiseur achetait des résistances Air/Feu contre le Vortex au lieu de l'Eau (poison des Harpilles). Nouveau : mix d'**exposition mesuré en combat** (`ProxyOptions.incoming`, `VORTEX_INCOMING_MIX`), recalibré une 2ᵉ fois sur les combats des stuffs optimisés.
2. **Dommages de poussée absents du proxy** : dans les combats des stuffs optimisés, les collisions des Brabuzars sont le **premier poste de dégâts subis** (18 % au profil équilibré, 30 % au profil défensif ; 7 800-16 000 par combat). Tous les monstres sont niveau 212 sans Dommages Poussée ⇒ dégâts ∝ 138 − Ré Pou : 100 de Résistance Poussée en retire 72 %. Nouveau modèle `ProxyOptions.incomingPush` (`VORTEX_PUSH`) : la Ré Pou (Dofus Forgelave, boucliers, Jadis, transcendance Pata Ré Pou…) est enfin valorisée.
3. **Transcendances choisies aux poids du stuff de DÉPART** : l'arbitrage « Rata Vi +100 » / « Ta Do Per So » / « Rata Int +20 » dépend du build final (rendements décroissants de la Vitalité, résistances plafonnées à 50 %). Nouveau : re-planification de la forgemagie aux poids locaux de chaque candidat re-noté (`ProxyContext.statWeightsAt`, `StuffSearchOptions.replanForge`).
4. **Sorts passifs des Dofus** : l'en-tête du proxy affirmait qu'ils ne sont pas simulés ; ils SONT lancés par le moteur (`installEquipmentPassives` : Ocre +1 PA, Vulbis +10 % Do finaux, Turquoise, Abyssal…), mais valent 0 pour le proxy. Nouveau : objets imposés/interdits (`StuffSearchOptions.fixed` / `exclude`) pour garder les Dofus à passif du stuff de départ ; mesuré en combats (bras « Dofus gardés »).
5. **Choix du stuff par membre** : `--team preset@stuff` existait déjà (`parseTeam`) mais n'était pas documenté ; ajouts : stuffs « build complet » portant leurs **points** (`StuffTemplate.points`) et leurs classes (`breeds`), **presets dérivés** (`extends` : `cra_feu_vortex` ≡ `cra_feu_zone@vortex_cra_feu`, même identité pour l'IA), exclus des candidats de composition (`BASE_PRESETS`) ; aide de la CLI.
6. Répartitions de points 250/200 dans l'élément ajoutées (compromis de survie).

## Cible Vortex du proxy

Le proxy note un stuff par J = DPT^a · EHP^b · (1 + c·UTIL) (proxy.ts) ; pour le Vortex (`vortexProxyOptions`, src/optimizer/stuff/vortex.ts) :

- **DPT** contre le mix des cibles des 5 vagues (Ikargn 3, Méjaire 4, Harpille 4, Buboxor 3, Brabuzar 5, Vortex 0,3 × 19), sorts et calibration du preset.
- **EHP** contre le mix des monstres qui FRAPPENT, poids d'exposition = dégâts subis mesurés / dégâts par tour prévus (somme sur les 4 personnages). Itération 1 (stuffs des presets, 32 combats) : Harpille 4, Méjaire 1,84, Brabuzar 1,77, Buboxor 1,70, Ikargn 0,70, Vortex 0,17. Itération 2 (stuffs optimisés, l'équipe survit ≈ 20 tours) : Harpille 4, Méjaire 1,91, **Brabuzar 3,16**, Buboxor 1,69, Ikargn 1,01, Vortex 0,19 (en vigueur).
- **Poussée** : 0,171 × dégâts reçus sans défense, × (138 − Ré Pou)/138 (itération 1 : 0,047).
- **UTIL** : retrait PM espéré (Enutrof), soins par tour (Eniripsa).
- **Profils** : équilibré = exposants du rôle (Crâ/Iop 0,7/0,3 ; Enutrof 0,3/0,4/1 ; Eniripsa 0,2/0,5/1) ; défensif = a − 0,2, b + 0,2 ; offensif = a + 0,15, b − 0,15. PO visée 6 pour les personnages à distance (Iop : règle de sa rotation).
- Recherche : 30 000 itérations de recuit après montée par coordonnées depuis le stuff du preset, les stuffs méta et un stuff glouton ; re-notation exacte des 50 meilleurs, forgemagie re-planifiée, 7 répartitions de points ; front de Pareto (DPT, EHP, UTIL) de 8 builds.

## Limites

- **Aucune victoire** : l'équipe méta, même stuffée pour le Vortex, meurt entière vers le tour 20-22 alors que le Vortex n'est vulnérable qu'après la corruption des 19 monstres (et pas avant son ~26ᵉ tour). Le stuff repousse nettement les morts et accélère les corruptions, mais l'IA (tour 3 en cours) reste le premier levier.
- n = 32 à 64 combats par bras : les écarts entre profils voisins (équilibré R1/R2, Dofus gardés ou non) restent dans le bruit (± 0,5 corrompu) ; seuls les écarts « stuff optimisé vs référence » et « équilibré vs offensif sur la survie » sont nets.
- Les combats ont tourné dans l'instantané `snap-1` (IA de `base-stuff-cp5`) : avec l'IA du tour 3, refaire la comparaison appariée (`batch vortex --team …` avec les presets `*_vortex`).
- Passifs des Dofus non modélisés par le proxy (mesurés seulement en combat) ; Dofus Argenté Scintillant / Ivoire : effets lancés par le moteur s'ils sont implémentés (non vérifié un par un).
- Hypothèses de forgemagie : 6 transcendances par stuff au plus (nombre maximal non documenté), transcendances aussi sur l'arme et le bouclier ; montures niveau 200 et familiers niveau 100.
- Le mix d'exposition dépend des stuffs (point fixe) : deux itérations seulement.

Version JSON : [vortex-stuffs.json](vortex-stuffs.json).

## Vérification (vérificateur adverse, 2026-10-05)

**Verdict** : les 12 builds sont valides en jeu, les tableaux du rapport correspondent exactement aux données brutes, `presets.json` ne fait qu'**ajouter** des entrées, et le gain principal se **reproduit sur des graines inédites** (n = 64, appariées), y compris avec l'IA du tour 3 en cours. Toujours **0 victoire**. Équipe recommandée inchangée : `cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,eniripsa_soin_vortex`.

### Instantanés utilisés

| Instantané | Contenu | Combats |
|---|---|---|
| `.cache/stuff/snap-v1` | `src/` et `data/ai/` du tag `base-stuff-cp5` (e75cfd1) + `src/optimizer/{stuff,team}` et `src/cli/simulate.ts` du dépôt + `data/ai/presets.json` du dépôt (vérifié : ajouts seulement). Même IA que `snap-1`. | référence, équilibré, offensif (m41 + m42), défensif (m41), alias `@` (8 graines m41) |
| `.cache/stuff/snap-v2` | copie de l'arbre de travail à 11:29Z : HEAD 984037e + modifications NON validées du tour 3 de réglage (`src/ai/tactical/rollout.ts`, `src/ai/tactical/turnSearch.ts`, `data/ai/theta-default.json`) — IA du tour 3 **en cours**, pas sa version finale | référence, équilibré (m41) |

Les deux bras d'une comparaison tournent toujours dans le même instantané ; seules les équipes changent. Graines `campaignSeeds(41, 32)` (m41) et `campaignSeeds(42, 32)` (m42), disjointes de m21/m22. IA `fast`. Les bras sont construits par **chaînes d'équipe** via `parseTeam` (`*_vortex`, `*_vortex_off`, `*_vortex_def`), donc par les presets eux-mêmes, et non par des builds injectés. Données brutes : `.cache/stuff/out/snap-v1/`, `.cache/stuff/out/snap-v2/` ; scripts : `.cache/stuff/verif/`.

### (b) Nouvelle mesure appariée (graines inédites)

Chaque cellule donne la moyenne du bras, puis entre parenthèses la différence appariée avec la référence ± la demi-largeur de l'IC 95 %.

| Bras | n | Victoires | Corrompus T7 | T12 | T17 | Fin | Tours survécus | 1re mort |
|---|---|---|---|---|---|---|---|---|
| *Référence snap-v1 (m41 + m42)* | 64 | 0/64 | 1.23 | 2.27 | 2.36 | 2.36 | 14.03 | 9.66 |
| **Équilibré `*_vortex`** | 64 | 0/64 [0–6 %] | 1.66 (+0.42 ± 0.26) | 2.94 (+0.67 ± 0.31) | 4.03 (+1.67 ± 0.42) | **4.33 (+1.97 ± 0.48)** | **20.53 (+6.50 ± 0.77)** | 13.81 (+4.16 ± 0.81) |
| Offensif `*_vortex_off` | 64 | 0/64 [0–6 %] | 1.97 (+0.73 ± 0.30) | 3.25 (+0.98 ± 0.29) | 4.16 (+1.80 ± 0.45) | 4.23 (+1.88 ± 0.48) | 17.52 (+3.48 ± 0.89) | 12.52 (+2.86 ± 0.83) |
| Équilibré − offensif | 64 | 0/64 | (−0.31 ± 0.26) | (−0.31 ± 0.22) | (−0.13 ± 0.44) | (+0.09 ± 0.52) | **(+3.02 ± 0.78)** | (+1.30 ± 0.97) |
| Équilibré, m41 seul | 32 | 0/32 | (+0.34 ± 0.40) | (+0.63 ± 0.50) | (+1.66 ± 0.66) | (+2.03 ± 0.79) | (+6.69 ± 1.18) | (+4.09 ± 1.13) |
| Équilibré, m42 seul | 32 | 0/32 | (+0.50 ± 0.35) | (+0.72 ± 0.40) | (+1.69 ± 0.53) | (+1.91 ± 0.55) | (+6.31 ± 1.01) | (+4.22 ± 1.19) |
| Défensif `*_vortex_def` (m41) | 32 | 0/32 [0–11 %] | 0.84 (−0.41 ± 0.42) | 2.22 (−0.03 ± 0.41) | 2.69 (+0.34 ± 0.45) | 2.88 (+0.53 ± 0.54) | 22.41 (+8.34 ± 0.95) | 19.00 (+9.22 ± 0.86) |
| *Référence snap-v2 (IA du tour 3 en cours, m41)* | 32 | 0/32 | 1.75 | 2.66 | 3.09 | 3.09 | 15.34 | 10.31 |
| **snap-v2 : équilibré `*_vortex`** | 32 | 0/32 [0–11 %] | 2.22 (+0.47 ± 0.29) | 3.50 (+0.84 ± 0.38) | 5.09 (+2.00 ± 0.70) | **5.66 (+2.56 ± 0.87)** | 22.91 (+7.56 ± 1.29) | 15.28 (+4.97 ± 1.54) |

Toutes les affirmations principales se confirment, dans les IC du rapport :

- Le profil équilibré donne **+1.97 corrompu** (rapport : +1.84) et **+6.5 tours** (rapport : +6.06), soit 2.4 → 4.3 corrompus et 14.0 → 20.5 tours.
- Il survit plus longtemps que l'offensif (**+3.0 ± 0.8 tours**, rapport : +2.2) à corruption finale égale.
- L'offensif corrompt plus tôt : il a 0.3 corrompu d'avance aux tours 7 et 12, écart significatif ici.
- Le défensif retarde fortement la première mort (+9.2 tours) mais corrompt à peine plus (+0.5).
- Avec l'IA du tour 3 en cours, le gain du stuff équilibré tient et augmente même un peu (+2.6 corrompus, +7.6 tours ; meilleur combat : 9 corrompus, 27 tours sous snap-v1).

Autres contrôles :

- Part de la poussée dans les dégâts subis : 17.8 % (rapport : 18 %).
- Tour moyen de mort Crâ / Enutrof / Iop / Eniripsa : 11.2 / 13.5 / 12.0 / 11.6 → 15.8 / 19.6 / 15.0 / 19.8.
- Dégâts de l'Enutrof : 7 958 → 20 290 par combat. Soins de l'Eniripsa : 14 961 → 41 652. Ces deux mesures sont cohérentes avec le rapport.
- L'alias explicite `cra_feu_zone@vortex_cra_feu,…` donne des combats **identiques** au bit près à `cra_feu_vortex,…` (8/8 empreintes d'événements égales).
- La CLI (`simulate.ts presets`, puis `batch vortex --team cra_feu_vortex,… --ai fast --runs 2 --master-seed 41`) liste les 12 presets dérivés comme valides et rejoue les mêmes combats que le harnais (22.5 tours en moyenne sur les deux premières graines m41, comme le harnais).

### (a) Validité en jeu (recalcul indépendant)

Le script `.cache/stuff/verif/validate-indep.mts` recalcule chaque build à partir des **données brutes** seulement (`data/dofusdb/equipment.json`, `item-sets.json`, `breeds.json`, `data/research/characteristics-map.json`, `forgemagie.json`), sans passer par `src/stats`. Il contrôle, sur les 12 stuffs :

- **Emplacements et niveaux** : 1 objet par emplacement, 2 anneaux, 6 Dofus/trophées/prysmaradites, 1 familier/montilier/monture ; tous les objets sont de niveau ≤ 200.
- **Unicité** : aucun Dofus ou trophée en double, pas deux anneaux identiques d'une même panoplie, au plus **1 prysmaradite** (Aprybou ; les deux builds offensifs Crâ et Iop n'en ont aucune).
- **Panoplies** : palier appliqué au nombre réel d'objets. `Pk` vaut de 2 à 5, mais aucun objet des builds ne porte de condition `Pk`.
- **Conditions** : la seule condition est `CA>299&CS>299` (Baguette de Torkélonia, Iop équilibré et offensif). Elle est vraie sur l'état final : Agilité 500 et Force 1 138 dans le build recommandé.
- **Forgemagie** :
  - au plus 1 ligne par objet ;
  - exos limités à PA, PM et PO, **un seul de chaque par personnage**, jamais sur un objet qui porte déjà la ligne ;
  - chaque exo est **nécessaire** : sans lui, le build tombe à 11 PA, 5 PM ou 5 PO ;
  - chaque transcendance correspond à une rune réelle (Rata Vi, Rata Ret Pme, Pata Do Cri, Rata Do Eau, Ta Do Per So, Ta Do Per Di, Rata Ine, Pata Ré Pou, Ta Ré Per Eau), de niveau ≤ celui de l'objet ;
  - poids de ligne ≤ 101 (maximum atteint : 100, ex. Bottes Owesli 400 → 500 Vi, Corne de Torkélonia 12 → 20 Do Cri) ;
  - 6 transcendances par stuff.
- **Points** : coûts par paliers des données `breeds`, 995/995 points dépensés (398 ; 300 + 395 Vi ; 200 + 695 Vi), parchemins +100.

**Comparaison avec `computeBuildStats`** : 40 caractéristiques (PA, PM, PO, Ret PA/PM compris) plus les PV, sans **aucun écart** sur les 12 builds (ex. 4 803 / 5 745 / 4 203 / 5 745 PV, 12/6/6, 12/6/6, 12/6/2, 12/6/6).

Les builds mesurés en combat (`armsAll.json`/`arms1.json` : bal, v2offk, v2def, base) sont **identiques** aux presets : objets, forgemagie, points, parchemins, variantes, identifiant IA.

Hypothèses de forgemagie non vérifiables dans les sources publiques (l'article next-stage ne dit que « ni over ni exo ») :

- **transcendance sur arme et bouclier** : 6 lignes dans l'équipe recommandée. Sans elles, le Crâ perd 200 Vi, l'Enutrof 4 Ret PM et 6 Do Eau, l'Iop 8 Do Cri et l'Eniripsa 100 Vi ;
- au plus 6 transcendances par stuff ;
- montures niveau 200 et familiers niveau 100.

### (c) Tableaux du rapport et (d) presets

- **(c)** Les 17 lignes du tableau principal, recalculées indépendamment depuis `.cache/stuff/out/snap-1/*.jsonl` (`verif/agg.cjs`), sont **exactes** au centième, IC compris. Les paires sont complètes : 32 ou 64 graines communes, sans doublon. Les tableaux des dégâts subis par source et élément et les tours de mort par personnage sont exacts (aucun personnage survivant, donc pas de biais d'exclusion). Les affirmations du texte sont exactes :
  - Dofus à passif gardés ou libres : −0.02 ± 0.54 ;
  - R2 équilibré contre R1 : −0.63 ± 0.68 ;
  - somme des effets isolés : +1.82 corrompu et +6.83 tours, contre un effet conjoint de +1.91 et +6.66 sur m21 ;
  - dégâts de l'Enutrof 19 202 contre 8 200, soins de l'Eniripsa 43 725 contre 14 344.

  Deux précisions :
  - « Mélanger les profils : −0.8 corrompu » vaut pour mix1 contre équilibré (−0.84 ± 0.81, à la limite) ; mix2 contre offensif v1 donne −1.28 ± 0.65.
  - Les « 18 % / 30 % » de poussée sont mesurés sur l'équilibré et sur le défensif **v1** (bras d'exploration). Le preset `*_vortex_def` (v2) est à 22 %.
- **(d)** `git diff base-stuff-cp5 -- data/ai/presets.json` : comparaison au niveau JSON. Les stuffs et presets existants sont **identiques**, dans le même ordre. Il y a 12 stuffs `vortex_*` et 12 presets dérivés ajoutés. La seule ligne « − » du diff textuel est la virgule ajoutée après `zobal_psychopathe`.

### (e) Tests et corrections

- `npx tsc --noEmit` passe sans erreur.
- `npx vitest run tests/opt-* tests/stats-* tests/data-*` (2 workers) : **25 fichiers, 286 tests verts**, aucun test en échec, sur deux passages. vitest sort néanmoins avec le code 1, car il remonte une erreur de harnais (`[vitest-worker]: Timeout calling "onTaskUpdate"`, RPC sans réponse pendant plus de 60 s). Les fichiers isolés montrent la cause : des tests de combat synchrones longs, sur une machine chargée (charge 7-8 sur 4 cœurs, partagée avec le tour 3) :
  - `opt-pool.test.ts`, test « IA `fast` sur l'Œil de Vortex … 4 workers = pool local » : 117 s seul, l'erreur se reproduit ;
  - `opt-runner-ladder.test.ts`, test « scripted ≤ fast » : 58 s.

  Ces fichiers ne sont pas modifiés par la campagne de stuffs et n'utilisent pas les presets dérivés.
- Ajouts dans `tests/opt-stuff-vortex.test.ts`, bloc « vérification adverse » :
  - l'équipe recommandée garde l'identité IA de l'équipe méta, des builds valides à 995/995 points, et les PV/PA/PM/PO du rapport ;
  - pour les 12 stuffs `vortex_*` : classe du stuff = classe du preset dérivé, 1 ligne de forgemagie par objet, un seul exo PA, PM et PO, jamais d'exo sur une ligne native.
- Correction dans ce rapport : la ligne « Conditions d'objets » de l'audit citait une règle « arme à deux mains sans bouclier ». Cette règle n'existe plus depuis la 2.41 et l'optimiseur ne l'applique pas (`twoHandedBlocksShield` vaut faux par défaut). Le texte est corrigé, ainsi que `report-config.json`.
- Revue de code sans défaut bloquant :
  - `presetsOf`/`resolvePreset` incluent les presets dérivés, placés après les presets de base : les résolutions `classe:rôle` sont inchangées et les toggles « doctrine » de `variants.ts` aussi (mêmes variantes, dédupliquées) ;
  - la clé de cache des combats inclut le build ;
  - en revanche `teamId` (halving) confond une équipe de base et son équivalent dérivé. C'est sans effet aujourd'hui, car les presets dérivés sont exclus des candidats de composition (`BASE_PRESETS`).
  - Le champ `breeds` d'un stuff est purement informatif : `iop_terre_burst@vortex_cra_feu` est accepté.
