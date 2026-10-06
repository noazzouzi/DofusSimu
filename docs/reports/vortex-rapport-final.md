# Œil de Vortex — rapport final de la démo

*Équipe choisie par l'utilisateur : 1 Eniripsa, 1 Enutrof, 2 Crâs. Règles du patch 2.42, IA de groupe `fast`, code
final du dépôt (commit `00efef6`, après les cinq tours de réglage de l'IA). Rapport du 2026-10-06.*

> **Demande** : « déterminer le meilleur groupe (ici choisi par l'utilisateur), leurs stuffs et sorts / déroulement du
> combat » pour l'Œil de Vortex.
>
> **Décision de l'utilisateur (2026-10-05)** : « Pour faciliter le boulot au simulateur et l'IA, je préfère que ce soit
> l'utilisateur qui détermine les classes/personnages pour un donjon. Du coup pour Vortex, je préfère une compo
> 1 eniripsa 1 enutrof 2 Cras. » Les classes sont donc une donnée d'entrée. Le simulateur a optimisé le reste : le
> build de chaque personnage (élément, stuff, exos et transcendances, points, 22 variantes de sorts) et la stratégie
> de combat (IA).

## 1. Résumé

### 1.1 La réponse

**Le groupe** est celui de l'utilisateur, épinglé dans `data/teams/vortex.json` (l'équipe par défaut de toutes les
commandes) :

```
eniripsa_soin_vortex,enutrof_retrait_pm_vortex,cra_terre_mono_vortex,cra_terre_mono_vortex_def
```

| Personnage | Preset | Stuff | Rôle, élément | PV | PA / PM / PO | Points (995) |
|---|---|---|---|---|---|---|
| Eniripsa | `eniripsa_soin_vortex` | `vortex_eniripsa_feu` | soigneur, Feu | 5 745 | 12 / 6 / 6 | Vitalité 395, Intelligence 600 |
| Enutrof | `enutrof_retrait_pm_vortex` | `vortex_enutrof_eau` | retrait de PM, Eau | 5 745 | 12 / 6 / 6 | Vitalité 695, Chance 300 |
| Crâ A | `cra_terre_mono_vortex` | `vortex_cra_terre_mono` (équilibré) | tueur mono-cible, Terre | 4 803 | 12 / 6 / 6 | Vitalité 3, Force 992 |
| Crâ B | `cra_terre_mono_vortex_def` | `vortex_cra_terre_mono_def` (défensif) | tueur mono-cible, Terre | 6 395 | 12 / 6 / 6 | Vitalité 695, Force 300 |

- **Les deux Crâs sont Terre.** C'est le levier principal de cette composition : toutes les paires de Crâs avec un
  Crâ Terre corrompent 8,3 à 10,1 monstres, celles sans Crâ Terre 6,0 à 7,5 (criblage, 32 graines). Deux Crâs Terre
  battent un Crâ Feu + un Crâ Terre (≈ +0,6 corrompu sur 256 graines inédites). Le stuff défensif du Crâ B retarde le
  premier mort de 2,0 ± 1,0 tour sans perte de corruption. L'ancien défaut (Crâ Feu + Crâ Air) gagnait 1,2 % des
  combats (docs/reports/vortex-equipe-utilisateur.md).
- **L'Eniripsa soin Feu et l'Enutrof retrait de PM Eau** gardent leurs builds Vortex : chaque alternative mesurée
  (Eniripsa Air ou défensive, Enutrof soutien ou PA/PO) perd 1,8 à 3,4 monstres corrompus.
- **Taux de victoire du code final** : **31 / 512 = 6,1 %** (IC 95 % de Wilson **4,3 – 8,5 %**), IA `fast`, 512 graines
  inédites (vérification du tour 5). Ce rapport ajoute 256 graines inédites : 11 / 256 = 4,3 %
  [2,4 – 7,5 %], écart non significatif (z = 1,0). **Sur les 768 combats : 42 / 768 = 5,5 % [4,1 – 7,3 %].**
- **Le plan de combat** : tuer chaque monstre une première fois à une heure « bon marché » (il est **marqué** de cette
  heure), puis le retuer trois tours plus tard, quand l'horloge revient sur cette heure et qu'il porte l'étoile : il est
  alors **corrompu** pour de bon. Les deux Crâs font l'essentiel des dégâts et des kills, l'Enutrof retire les PM des
  monstres (et immobilise tout le terrain avec *Retraite Anticipée*), l'Eniripsa soigne 65 000 PV par combat. Quand les
  19 monstres sont corrompus, *Action !* rend le Vortex vulnérable et l'équipe l'achève 6 à 12 tours plus tard (7,8 en
  moyenne sur les 11 victoires de ce rapport ; 4 à 19 tours, 9,2 en moyenne, sur les 42 victoires des 768 combats).
- **Ce qui fait perdre** : la corruption des vagues 3 à 5 est trop lente (2,0 / 0,8 / 0,3 monstre corrompu sur 4) et
  le *Pacifiste* des Méjaires paralyse 26-30 % des tours de joueur à partir du tour 13 ; 69 % des combats finissent en
  « vague non corrompue au déverrouillage », puis en mort de toute l'équipe.

### 1.2 Mesures du code final

IA `fast`, variante de règles `default`, équipe épinglée (ordre du fichier : Eniripsa, Enutrof, Crâ A, Crâ B).
Graines `campaignSeeds(masterSeed, 32)` jamais jouées auparavant ; « 1er mort » = tour de fin du combat si personne ne
meurt ; corrompus : compteur officiel du scénario.

| Mesure | Vérification du tour 5 (512 combats, `masterSeed` 201-216) | Ce rapport (256 combats, `masterSeed` 301-308) | Ensemble (768) |
|---|---|---|---|
| **Victoires** (IC 95 % Wilson) | **31 / 512 = 6,1 % [4,3 – 8,5]** | 11 / 256 = 4,3 % [2,4 – 7,5] | **42 / 768 = 5,5 % [4,1 – 7,3]** |
| Monstres corrompus (sur 19) | 9,86 | 9,73 ± 0,44 | 9,82 |
| Corrompus à la fin des tours 13 / 19 / 25 | 4,89 / 6,95 / 8,56 | 4,86 / 6,91 / 8,51 | 4,88 / 6,94 / 8,55 |
| Tours survécus | 31,58 | 31,29 | 31,48 |
| Premier mort (tour) | 23,25 | 23,05 | 23,19 |
| Morts par combat | 3,76 | 3,79 | 3,77 |
| Combats à 19 / 19 (*Action !*), dont gagnés | 40, dont 31 | 17, dont 11 (*Action !* au tour 41,9, 3,06 survivants) | 57, dont 42 |
| Victoires sans aucun mort ; tour moyen de la victoire | 12 ; 49,5 | 7 ; 46,2 (*Action !* au tour 38,4, Vortex tué 7,8 tours plus tard) | 19 ; 48,6 |
| Tours de joueur commencés sous *Pacifiste* (tours ≥ 13) : part de tous les tours ; moyenne des parts par combat | 25 % ; 27 % | 26 % ; 28 % | 25 % ; 27 % |

Un combat `fast` coûte 27,3 s de calcul (un cœur). Les victoires dépendent beaucoup de la graine : un même combat
rejoué avec une IA légèrement différente diverge presque complètement (corrélation ≈ 0,1-0,2 entre deux variantes sur
la même graine, docs/tuning-log.md, tour 5). Avec 768 combats, le taux de victoire est connu à ± 1,6 point près.

### 1.3 Ce qui a été vérifié, et comment

1. **Règles** : audit de fidélité contre le jeu réel (docs/research/vortex-audit.md) ; le modèle suit le patch 2.42
   (vagues aux tours 1, 7, 13, 19 et 25, ressuscités à 20-30 % des PV et −1 PM, Vortex à 15 000 PV à 4 joueurs).
2. **Builds** : stuffs produits par l'optimiseur (`optimizeStuff`, cible « mix des vagues du Vortex »), puis validité en
   jeu recalculée indépendamment à partir des données DofusDB brutes : un objet par emplacement, conditions, paliers de
   panoplie, au plus un exo PA, un exo PM et un exo PO, transcendances réelles, 995 points selon les paliers de classe,
   parchemins 100 (docs/reports/vortex-equipe-utilisateur.md, Vérification (a)). Les tableaux du § 2 sont recalculés
   par `computeBuildStats` sur le code final : identiques à ceux de la campagne.
3. **Choix des builds** : criblage sur 32 graines, *successive halving* jusqu'à 256 graines appariées, puis
   vérification par un second agent sur 256 graines inédites (classement confirmé).
4. **IA** : cinq tours de réglage, chacun vérifié par un agent indépendant sur des graines inédites ; au tour 5, le seul
   changement gardé (ZREZ2) augmente la corruption de +0,46 ± 0,41 sur 512 graines inédites (+0,44 ± 0,32 sur 896),
   sans perte de survie (docs/tuning-log.md, « Vérification (tour 5) »).
5. **Tests** : `npx tsc --noEmit` vert ; `npx vitest run tests/ai-* tests/vortex-*` : 335 réussis, 1 ignoré (combats de
   contrôle de l'équipe de référence, puzzles du Vortex).
6. **Ce rapport** : 256 combats inédits sur un arbre figé `git archive 00efef6` ; la graine 3290233078 y donne la même
   empreinte d'événements que chez le vérificateur et que la CLI du dépôt (1635433083), et la commande `batch` de la
   CLI rejoue le bloc `masterSeed` 301 à l'identique (32 combats, 1 victoire, 31,59 tours). Toutes les statistiques du
   § 3 qui ne sont pas attribuées au vérificateur viennent de ces 256 combats.

## 2. Les quatre personnages

Règles communes aux quatre builds : niveau 200, 995 points de caractéristiques, parchemins +100 dans les six
caractéristiques, 16 emplacements (dont 6 Dofus / trophées / prysmaradites, une prysmaradite au plus), forgemagie
« jets parfaits + au plus un exo PA, un exo PM, un exo PO + au plus 6 transcendances » (voir § 5.2). Les 22 choix de
variantes sont ceux des presets de base (aucune bascule mesurée ne fait mieux). Les fréquences d'emploi des sorts
viennent des 256 combats de ce rapport (IA `fast`) : « lancers par combat » compte tout le combat, phase 2 comprise.

Lecture des tableaux de stuff : « transc. » = transcendance (rune et valeur ajoutée) ; les lignes sont les jets
maximaux de l'objet ; Do = dommages ; Ré = résistance ; Ret / Esq = retrait / esquive ; PP = prospection.

### 2.1 Eniripsa — soin Feu (`eniripsa_soin_vortex`, stuff `vortex_eniripsa_feu`)

**Rôle en combat** : soigneur principal et troisième source de dégâts. Il soigne 65 000 PV par combat (plus
17 000 PV de boucliers, surtout ceux du Lapino de *Mot d'Amitié*), purge le poison des Harpilles par ses soins, frappe
en zone Feu avec ses mots de soin (*Mot Tapageur*, *Mot Distrayant*, *Mot Turbulent* soignent les alliés ET frappent
les ennemis de la zone) et fait ≈ 2 corruptions par combat. C'est l'un des deux personnages les plus pacifiés (28 % de
ses tours à partir du tour 13) : il se tient au milieu de l'équipe, souvent dans les lignes des Méjaires.

| Emplacement | Objet | Niv. | Panoplie | Forgemagie | Lignes de l'objet (jets max) |
|---|---|---|---|---|---|
| Amulette | Talisman Igans | 200 | Panoplie Pnose | transc. Rata Vi (+100 Vi) | +350 Vi, +60 Int, +60 Cha, +50 Sa, +4 % CC, +1 PA, +1 PO, +20 Do Feu, +20 Do Eau, +7 % Ré Neutre, +7 % Ré Terre |
| Anneau | Malédiction du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | exo +1 PA | +300 Vi, +100 Int, +20 Sa, +3 % CC, +10 PP, -300 Ini, +7 % Ré Feu, +7 % Ré Eau, +10 Ret PA, +15 Ré Pou |
| Anneau | Baguistik | 200 | Panoplistik | exo +1 PM | +300 Vi, +40 Fo, +40 Int, +40 Sa, +4 % CC, +1 PO, +7 Do Neutre, +7 Do Terre, +7 Do Feu, +10 Soins, +7 % Ré Eau, +30 Ré Cri |
| Ceinture | Ceintrigue | 200 | Panoplie Pnose | transc. Rata Vi (+100 Vi) | +350 Vi, +60 Int, +60 Cha, +40 Sa, +4 % CC, +1 PO, +20 Do Feu, +20 Do Eau, +15 Soins, +10 % Ré Air, +20 Do Pou |
| Bottes | Bottes Owesli | 200 | Panoplie Pnose | transc. Rata Vi (+100 Vi) | +400 Vi, +50 Int, +50 Cha, +40 Sa, +1 PM, +1 PO, +20 Do Feu, +20 Do Eau, +7 % Ré Neutre, +7 % Ré Terre, +20 Do Pou |
| Coiffe | Masquegel | 200 | Panoplie Martegel | transc. Rata Vi (+100 Vi) | +400 Vi, +80 Int, +80 Agi, +40 Sa, -10 % CC, +1 Invo, +15 Do Feu, +15 Do Air, +10 % Ré Neutre, +10 % Ré Eau, +10 Fuite, +10 Esq PA |
| Cape | Manteau du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transc. Rata Vi (+100 Vi) | +400 Vi, +100 Int, +50 Sa, +7 % CC, +1 Invo, +10 Do Feu, +15 Soins, +15 PP, -200 Ini, +5 % Ré Terre, +5 % Ré Feu, +5 % Ré Eau, +12 Fuite, +30 Ré Pou |
| Bouclier | Bouclistik | 200 | Panoplistik | transc. Rata Vi (+100 Vi) | +250 Vi, +40 Sa, +50 Pui, +1 PO, +20 PP, +5 % Ré Neutre, +15 Tacle, +40 Do Pou, +7 % Ré Mêlée |
| Arme | Marteau Possédé | 200 | — | — | +400 Vi, +50 Int, +60 Sa, +50 Pui, +3 % CC, +1 Invo, +12 Do Feu, +20 Soins, +10 PP, -300 Ini, +7 % Ré Neutre, +7 % Ré Feu, +7 Fuite, -6 Tacle, +15 Ré Cri |
| Familier/Monture | Volkorne Saphir et Orchidée | 60 | — | — | +70 Int, +1 PA, +8 % Ré Eau |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus Ocre | 160 | — | — | +1 PA, sort passif |
| Dofus/Trophée/Prysma | Dofus Ivoire | 180 | — | — | +4 % Ré Neutre, +4 % Ré Terre, +4 % Ré Feu, +4 % Ré Eau, +4 % Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dolmanax | 100 | — | — | +70 Fo, +70 Int, +70 Cha, +70 Agi |
| Dofus/Trophée/Prysma | Dofus Vulbis | 180 | — | — | +1 PM, sort passif |
| Dofus/Trophée/Prysma | Dofus Argenté Scintillant | 180 | — | — | +300 Vi, sort passif |

- **Forgemagie** : Exos : **+1 PA** (Malédiction du Vénérable Endormi), **+1 PM** (Baguistik) ; transcendances (6) : Rata Vi (+100 Vi) ×6 (Talisman Igans, Ceintrigue, Bottes Owesli, Masquegel, Manteau du Vénérable Endormi, Bouclistik).
- **Points et parchemins** : 995 / 995 points : Vitalité 395 + Intelligence 600 (caractéristiques de base Vitalité 395, Intelligence 300) ; parchemins +100 dans les six caractéristiques ; panoplies Pnose 3, Vénérable Endormi 2, Panoplistik 2 ; build valide (`computeBuildStats`) : oui.

**Caractéristiques finales**

| PV | PA / PM / PO | Résistances % (N / T / F / E / A) | Rés. fixes | Ré Pou / Ré Cri | Puissance | Dommages élém. (N / T / F / E / A) | % Do sorts / distance | CC / Do Cri | Soins | Ret PA / PM | Tacle / Fuite | Initiative |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **5745** | 12 / 6 / 6 | 40 / 33 / 33 / 51 / 14 | 40 / 40 / 40 / 40 / 40 | 45 / 75 | 100 | 17 / 23 / 120 / 60 / 15 | 0 / 0 | 15 % / 0 | 140 | 62 / 52 | 34 / 54 | 360 |

Caractéristiques principales : Vitalité 4695, Sagesse 520, Force 310, Intelligence 1220, Chance 380, Agilité 250.

**22 variantes (sort actif / variante écartée)** : 1. **Mot Espiègle** / Mot Malicieux ; 2. **Mot Tapageur** / Cri Assourdissant ; 3. **Mot Vampirique** / Sanglots ; 4. **Onguent Ancestral** / Juron ; 5. **Mot d'Amitié** / Mot Alchimique ; 6. **Mot Stimulant** / Mot de Déclin ; 7. **Scalpel** / Mot de Frayeur ; 8. **Vacarme** / Lamentations ; 9. **Mot Turbulent** / Mot Furieux ; 10. **Mot Galvanisant** / Mot Vivifiant ; 11. **Mot Farceur** / Mot Défendu ; 12. **Peinture de Guerre** / Mot Secret ; 13. **Mot de Jouvence** / Mot Déprimant ; 14. **Cri de Guerre** / Mot Rituel ; 15. **Mot Interdit** / Mot Exsangue ; 16. **Mot Accablant** / Mot Décourageant ; 17. **Mot Distrayant** / Chapardage ; 18. **Bosquet Enchanté** / Mot Fleuri ; 19. **Fontaine de Jouvence** / Mot d'Envol ; 20. **Chœur Strident** / Pinceau Tribal ; 21. **Cryothérapie** / Murmure ; 22. **Mot de Reconstitution** / Mot de Solidarité.

**Sorts employés (mesurés)**

107,2 lancers et 343 PA dépensés par combat en moyenne (256 combats).

| Sort | Lancers par combat | Combats où il est lancé | Part des PA du personnage |
|---|---|---|---|
| Mot Tapageur | 15,4 | 100 % | 13,5 % |
| Mot Galvanisant | 14,9 | 100 % | 8,7 % |
| Mot Distrayant | 13,6 | 100 % | 15,9 % |
| Mot Turbulent | 12,5 | 100 % | 14,5 % |
| Vacarme | 9,1 | 100 % | 8,0 % |
| Fontaine de Jouvence | 7,6 | 100 % | 6,6 % |
| Mot d'Amitié | 6,5 | 100 % | 5,6 % |
| Chœur Strident | 3,8 | 100 % | 5,6 % |
| Peinture de Guerre | 3,7 | 98 % | 2,2 % |
| Bosquet Enchanté | 3,4 | 97 % | 4,0 % |
| Mot de Jouvence | 3,2 | 95 % | 1,9 % |
| Cryothérapie | 3,0 | 93 % | 2,6 % |
| Mot de Reconstitution | 2,9 | 100 % | 4,2 % |
| Scalpel | 2,1 | 90 % | 2,5 % |
| Mot Stimulant | 2,0 | 86 % | 1,2 % |
| Mot Espiègle | 1,8 | 100 % | 1,5 % |
| Cri de Guerre | 0,8 | 57 % | 0,9 % |
| Mot Accablant | 0,5 | 40 % | 0,3 % |
| Mot Interdit | 0,1 | 11 % | 0,2 % |
| Mot Vampirique | 0,1 | 9 % | 0,1 % |
| Onguent Ancestral | 0,1 | 7 % | 0,1 % |
| Mot Farceur | 0,0 | 2 % | 0,0 % |

Invocations (lancers par combat) : Lapino → Bisou Magique 99,4, Lapino → Prévention 87,1.

Sorts clés : *Mot Tapageur*, *Mot Distrayant* et *Mot Turbulent* (soin + dégâts Feu en zone, 44 % de ses PA), *Mot
Galvanisant* (Puissance + bouclier sur un allié, 15 lancers par combat), *Vacarme*, *Fontaine de Jouvence* (glyphe de
soin, rend l'Eniripsa intaclable), *Mot d'Amitié* (Lapino, qui lance ≈ 100 *Bisou Magique* et 87 *Prévention* par
combat), *Mot de Reconstitution* (soin total, ≈ 3 par combat, en urgence). *Mot Interdit*, *Mot Vampirique*, *Onguent
Ancestral* et *Mot Farceur* ne servent presque jamais.

### 2.2 Enutrof — retrait de PM Eau (`enutrof_retrait_pm_vortex`, stuff `vortex_enutrof_eau`)

**Rôle en combat** : contrôle et tueur d'appoint. Il retire ≈ 89 PM par combat (*Tamisage* en zone, *Pelle
Aurifère*, *Pelle des Anciens*, *Maladresse*) et immobilise tout le terrain avec *Retraite Anticipée* (≈ 37
immobilisations de monstres par combat pour 3,2 lancers), ce qui tient les Brabuzars, Buboxors et Ikargns loin de
l'équipe. Il fait 30 600 dégâts aux vagues, 7 kills et 2,5 corruptions par combat, et soigne 6 100 PV (*Clef de Bras*
sur un allié empoisonné). C'est le personnage le moins pacifié (22 %) et celui qui a le meilleur Ret PM (152).

| Emplacement | Objet | Niv. | Panoplie | Forgemagie | Lignes de l'objet (jets max) |
|---|---|---|---|---|---|
| Amulette | Amulette Voldelor | 200 | Panoplie de Voldelor | transc. Rata Ret Pme (+4 Ret PM) | +300 Vi, +70 Cha, +70 Agi, +40 Sa, +1 PA, +12 Do Eau, +12 Do Air, +15 PP, +10 % Ré Feu, +10 % Ré Eau, +7 Fuite, -7 Esq PM, +15 Do Cri |
| Anneau | Bracelet du Piloztère | 200 | Panoplie du Piloztère | exo +1 PA | +300 Vi, +50 Pui, +4 % CC, +2 PO, +10 Do Neutre, +10 Do Terre, +10 Do Eau, +10 % Ré Neutre |
| Anneau | Alliance Gloursonne | 198 | Panoplie Gloursonne | exo +1 PM | +250 Vi, +60 Cha, +60 Agi, +40 Sa, +1 PO, +12 Do Eau, +12 Do Air, +10 PP, +400 Ini, +7 % Ré Neutre, +7 % Ré Terre, +7 % Ré Feu, +5 Tacle |
| Ceinture | Ceinture Voldelor | 200 | Panoplie de Voldelor | transc. Rata Ret Pme (+4 Ret PM) | +300 Vi, +70 Cha, +70 Agi, +50 Sa, +1 PO, +15 Do Eau, +15 Do Air, +15 PP, +10 % Ré Feu, +10 % Ré Eau, +7 Fuite, -7 Esq PM, +15 Do Cri |
| Bottes | Bottes Voldelor | 200 | Panoplie de Voldelor | transc. Rata Ret Pme (+4 Ret PM) | +350 Vi, +70 Cha, +70 Agi, +40 Sa, +10 % CC, +1 PM, +12 Do Eau, +12 Do Air, +7 Fuite, +20 Ré Pou |
| Coiffe | Visage de Mureine | 200 | Panoplie du Gouffre | exo +1 PO | +500 Vi, +80 Cha, +50 Sa, +5 % CC, +1 Invo, +20 Do Eau, +20 PP, -300 Ini, +10 % Ré Eau, +7 % Ré Air, +15 Tacle, -15 Fuite, +10 Do Cri |
| Cape | Dorsale de Willorque | 200 | Panoplie du Gouffre | transc. Rata Ret Pme (+4 Ret PM) | +500 Vi, +100 Cha, +50 Sa, +6 % CC, +10 Do Eau, +12 Soins, +15 PP, -300 Ini, +7 % Ré Terre, +10 % Ré Eau, +10 Tacle, -10 Esq PM, +25 Do Cri |
| Bouclier | Jadis | 200 | — | transc. Rata Ret Pme (+4 Ret PM) | +250 Vi, +40 Sa, +15 % Ré Neutre, +15 Tacle, +15 Esq PA, +15 Esq PM, +50 Ré Cri, +50 Ré Pou, +7 % Ré Mêlée, +5 % Ré Distance |
| Arme | Lancepince d'Exécrabe | 200 | Panoplie du Gouffre | transc. Rata Do Eau (+6 Do Eau) | +500 Vi, +90 Cha, +50 Sa, +5 % CC, +12 Do Eau, +15 PP, -300 Ini, +7 % Ré Feu, +10 % Ré Eau, +10 Tacle, +12 Ret PM, -10 Esq PA, +20 Do Cri |
| Familier/Monture | Volkorne Doré et Turquoise | 60 | — | — | +200 Vi, +1 PA, +30 Ret PM |
| Dofus/Trophée/Prysma | Dofus des Glaces | 180 | — | — | +25 Do Neutre, +25 Do Terre, +25 Do Feu, +25 Do Eau, +25 Do Air |
| Dofus/Trophée/Prysma | Entraveur majeur | 150 | — | — | +24 Ret PM, -24 Esq PA |
| Dofus/Trophée/Prysma | Dofus Ivoire | 180 | — | — | +4 % Ré Neutre, +4 % Ré Terre, +4 % Ré Feu, +4 % Ré Eau, +4 % Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus Argenté Scintillant | 180 | — | — | +300 Vi, sort passif |
| Dofus/Trophée/Prysma | Dofus Vulbis | 180 | — | — | +1 PM, sort passif |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |

- **Forgemagie** : Exos : **+1 PA** (Bracelet du Piloztère), **+1 PM** (Alliance Gloursonne), **+1 PO** (Visage de Mureine) ; transcendances (6) : Rata Ret Pme (+4 Ret PM) ×5 (Amulette Voldelor, Ceinture Voldelor, Bottes Voldelor, Dorsale de Willorque, Jadis) ; Rata Do Eau (+6 Do Eau) ×1 (Lancepince d'Exécrabe).
- **Points et parchemins** : 995 / 995 points : Vitalité 695 + Chance 300 (caractéristiques de base Vitalité 695, Chance 200) ; parchemins +100 dans les six caractéristiques ; panoplies Voldelor 3, Gouffre 3 ; build valide (`computeBuildStats`) : oui.

**Caractéristiques finales**

| PV | PA / PM / PO | Résistances % (N / T / F / E / A) | Rés. fixes | Ré Pou / Ré Cri | Puissance | Dommages élém. (N / T / F / E / A) | % Do sorts / distance | CC / Do Cri | Soins | Ret PA / PM | Tacle / Fuite | Initiative |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **5745** | 12 / 6 / 6 | 36 / 18 / 38 / 54 / 21 | 40 / 40 / 40 / 40 / 40 | 70 / 50 | 50 | 35 / 35 / 25 / 134 / 76 | 0 / 0 | 47 % / 85 | 12 | 66 / 152 | 106 / 62 | 50 |

Caractéristiques principales : Vitalité 4695, Sagesse 460, Force 100, Intelligence 100, Chance 940, Agilité 410.

**22 variantes (sort actif / variante écartée)** : 1. **Lancer de Pièces** / Monnaie Sonnante ; 2. **Orpaillage** / Force de l'Âge ; 3. **Roulage de Pelle** / Éboulement ; 4. **Opportunité** / Coup de Grisou ; 5. **Musette Animée** / Sac Animé ; 6. **Ruée vers l'Or** / Déambulation ; 7. **Boîte à Outils** / Boîte de Pandore ; 8. **Remblai** / Feu de Mine ; 9. **Clef de Bras** / Clef du Trésor ; 10. **Obsolescence** / Abattement ; 11. **Pelle Animée** / Bêche Animée ; 12. **Avarice** / Décadence ; 13. **Pelle Aurifère** / Tourbière ; 14. **Maladresse** / Âge d'Or ; 15. **Pelle Fantomatique** / Dernier Recours ; 16. **Banqueroute** / Lancer de Pelle ; 17. **Bêche des Anciens** / Souterrain ; 18. **Pelle des Anciens** / Gisement ; 19. **Tamisage** / Péremption ; 20. **Corruption** / Tunnel de Fortune ; 21. **Retraite Anticipée** / Pelle de Fortune ; 22. **Coffre Animé** / Malle Animée.

**Sorts employés (mesurés)**

98,6 lancers et 292 PA dépensés par combat en moyenne (256 combats).

| Sort | Lancers par combat | Combats où il est lancé | Part des PA du personnage |
|---|---|---|---|
| Tamisage | 12,4 | 100 % | 12,7 % |
| Pelle des Anciens | 12,0 | 100 % | 16,5 % |
| Clef de Bras | 11,2 | 100 % | 7,7 % |
| Obsolescence | 10,7 | 100 % | 11,0 % |
| Pelle Aurifère | 7,4 | 100 % | 10,2 % |
| Maladresse | 7,4 | 100 % | 2,5 % |
| Lancer de Pièces | 6,0 | 99 % | 4,1 % |
| Bêche des Anciens | 5,5 | 100 % | 7,5 % |
| Retraite Anticipée | 3,2 | 100 % | 4,4 % |
| Ruée vers l'Or | 3,2 | 99 % | 2,2 % |
| Corruption | 3,1 | 99 % | 5,3 % |
| Boîte à Outils | 2,6 | 95 % | 1,8 % |
| Remblai | 2,2 | 85 % | 2,2 % |
| Orpaillage | 2,1 | 93 % | 2,8 % |
| Coffre Animé | 1,8 | 100 % | 1,9 % |
| Pelle Animée | 1,7 | 100 % | 1,2 % |
| Pelle Fantomatique | 1,6 | 75 % | 1,6 % |
| Avarice | 1,4 | 80 % | 1,4 % |
| Roulage de Pelle | 1,4 | 58 % | 1,4 % |
| Opportunité | 0,8 | 53 % | 0,6 % |
| Banqueroute | 0,5 | 41 % | 0,7 % |
| Musette Animée | 0,2 | 19 % | 0,1 % |

Invocations (lancers par combat) : Coffre Animé → Prospection 7,0, Pelle Animée → Déblayage 6,7.

Sorts clés : *Tamisage* (dégâts Eau + retrait de PM en zone, 12 lancers par combat), *Pelle des Anciens* (dégâts,
retrait de PM, poussée), *Obsolescence* (retire l'esquive PM avant les retraits), *Pelle Aurifère*, *Maladresse*
(1 PA, retrait de PM jusqu'à 12 PO), *Clef de Bras* (sur un allié : soin qui purge le poison), *Retraite Anticipée*
(immobilisation générale), *Corruption* (≈ 3 par combat : rend un monstre Pacifiste et Invulnérable, ou soigne un
allié) et *Boîte à Outils* (+PA / +PM à un allié, au prix du Pacifiste). *Musette Animée* ne sert presque jamais.

### 2.3 Crâ A — Terre mono-cible, stuff équilibré (`cra_terre_mono_vortex`, stuff `vortex_cra_terre_mono`)

**Rôle en combat** : premier tueur. Il fait 43 500 dégâts aux vagues, 9,7 kills et **3,0 corruptions par combat**
(le plus de l'équipe). Avec 4 803 PV, c'est aussi le premier à mourir (tour 23,7 en moyenne quand il meurt).

| Emplacement | Objet | Niv. | Panoplie | Forgemagie | Lignes de l'objet (jets max) |
|---|---|---|---|---|---|
| Amulette | Talisman Songe | 200 | Panoplie du Bonimenteur | exo +1 PO | +300 Vi, +60 Fo, +60 Int, +60 Cha, +40 Sa, +1 PA, +15 Do Neutre, +15 Do Terre, +15 Do Feu, +15 Do Eau, +15 PP, +8 % Ré Air, +15 Ré Feu, +10 Tacle, +15 Do Cri |
| Anneau | Anneau du Comte Harebourg | 200 | Panoplie du Comte Harebourg | exo +1 PA | +350 Vi, +50 Fo, +50 Sa, +7 % CC, +15 Do Neutre, +15 Do Terre, -500 Ini, +25 Ré Cri |
| Anneau | Baguistik | 200 | Panoplistik | exo +1 PM | +300 Vi, +40 Fo, +40 Int, +40 Sa, +4 % CC, +1 PO, +7 Do Neutre, +7 Do Terre, +7 Do Feu, +10 Soins, +7 % Ré Eau, +30 Ré Cri |
| Ceinture | Sangle Ouare | 200 | Panoplie du Bonimenteur | transc. Ta Do Per So (+1 % Do Sorts) | +300 Vi, +40 Cha, +30 Sa, +40 Pui, +1 PM, +2 Invo, +15 PP, -400 Ini, +10 % Ré Eau, +10 % Ré Air, +15 Tacle, -8 Esq PM, +25 Do Cri, +25 Do Pou |
| Bottes | Bottes du Comte Harebourg | 200 | Panoplie du Comte Harebourg | transc. Ta Do Per So (+1 % Do Sorts) | +400 Vi, +80 Fo, +50 Sa, +1 PM, +20 Do Neutre, +20 Do Terre, +30 Ré Neutre, +15 Tacle, -10 Esq PM, +30 Ré Pou |
| Coiffe | Cornes du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transc. Ta Do Per So (+1 % Do Sorts) | +450 Vi, +100 Fo, +50 Sa, +6 % CC, +1 Invo, +8 Soins, +15 PP, -300 Ini, +5 % Ré Feu, +5 % Ré Eau, +5 % Ré Air, +12 Fuite, +10 Ret PM, +30 Ré Pou |
| Cape | Cape Ovri | 200 | Panoplie du Bonimenteur | transc. Ta Do Per So (+1 % Do Sorts) | +400 Vi, +60 Fo, +60 Cha, +50 Sa, +5 % CC, +16 Do Neutre, +16 Do Terre, +16 Do Eau, +400 Ini, +10 % Ré Neutre, +20 Ré Feu, -15 Tacle |
| Bouclier | Bouclistik | 200 | Panoplistik | transc. Ta Do Per So (+1 % Do Sorts) | +250 Vi, +40 Sa, +50 Pui, +1 PO, +20 PP, +5 % Ré Neutre, +15 Tacle, +40 Do Pou, +7 % Ré Mêlée |
| Arme | Arc du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transc. Ta Do Per So (+1 % Do Sorts) | +450 Vi, +100 Fo, +50 Sa, +8 % CC, +1 PO, +10 Do Terre, +10 Soins, +15 PP, -200 Ini, +7 % Ré Terre, +7 % Ré Eau, +15 Fuite, +30 Ré Pou |
| Familier/Monture | Volkorne Amande et Pourpre | 60 | — | — | +70 Fo, +1 PA, +70 Ré Pou |
| Dofus/Trophée/Prysma | Dofus Ocre | 160 | — | — | +1 PA, sort passif |
| Dofus/Trophée/Prysma | Impétueux | 150 | — | — | +6 % Do Distance, -6 % Ré Distance |
| Dofus/Trophée/Prysma | Dofus des Glaces | 180 | — | — | +25 Do Neutre, +25 Do Terre, +25 Do Feu, +25 Do Eau, +25 Do Air |
| Dofus/Trophée/Prysma | Prysmenvout | 200 | — | — | +80 Pui, -1000 Ini, sort passif |
| Dofus/Trophée/Prysma | Dofus Pourpre | 110 | — | — | +80 Pui, sort passif |
| Dofus/Trophée/Prysma | Dolmanax | 100 | — | — | +70 Fo, +70 Int, +70 Cha, +70 Agi |

- **Forgemagie** : Exos : **+1 PO** (Talisman Songe), **+1 PA** (Anneau du Comte Harebourg), **+1 PM** (Baguistik) ; transcendances (6) : Ta Do Per So (+1 % Do Sorts) ×6 (Sangle Ouare, Bottes du Comte Harebourg, Cornes du Vénérable Endormi, Cape Ovri, Bouclistik, Arc du Vénérable Endormi).
- **Points et parchemins** : 995 / 995 points : Vitalité 3 + Force 992 (caractéristiques de base Vitalité 3, Force 398) ; parchemins +100 dans les six caractéristiques ; panoplies Bonimenteur 3, Comte Harebourg 2, Panoplistik 2, Vénérable Endormi 2 ; build valide (`computeBuildStats`) : oui.

**Caractéristiques finales**

| PV | PA / PM / PO | Résistances % (N / T / F / E / A) | Rés. fixes | Ré Pou / Ré Cri | Puissance | Dommages élém. (N / T / F / E / A) | % Do sorts / distance | CC / Do Cri | Soins | Ret PA / PM | Tacle / Fuite | Initiative |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **4803** | 12 / 6 / 6 | 18 / 20 / 18 / 42 / 26 | 30 / 0 / 35 / 0 / 0 | 190 / 110 | 300 | 108 / 124 / 79 / 56 / 25 | 6 / 6 | 45 % / 40 | 68 | 54 / 64 | 87 / 44 | 298 |

Caractéristiques principales : Vitalité 3753, Sagesse 540, Force 1328, Intelligence 470, Chance 330, Agilité 170.

**22 variantes (sort actif / variante écartée)** : 1. **Flèche de Recul** / Flèche Éclatante ; 2. **Flèche Glacée** / Flèche Harcelante ; 3. **Flèche Vagabonde** / Flèche Évasive ; 4. **Carreaux Destructeurs** / Flèche de Barrage ; 5. **Pas Chassé** / Balise Tactique ; 6. **Tir Perçant** / Tirs Éloignés ; 7. **Flèche Détonante** / Flèche Ralentissante ; 8. **Flèche d'Abolition** / Flèche Persécutrice ; 9. **Flèche Assaillante** / Flèche Cinglante ; 10. **Flèche d'Immobilisation** / Flèche Tyrannique ; 11. **Tirs Puissants** / Flèches Amoureuses ; 12. **Flèche de Dispersion** / Flèches Enflammées ; 13. **Flèche Massacrante** / Flèche Explosive ; 14. **Œil de Taupe** / Pluie de Flèches ; 15. **Œil pour Œil** / Flèche Paralysante ; 16. **Représailles** / Balise de Survie ; 17. **Tir de Repli** / Vendetta ; 18. **Flèche Punitive** / Flèche du Jugement ; 19. **Flèche d'Expiation** / Flèche de Rédemption ; 20. **Flèche Perforante** / Flèche Boomerang ; 21. **Flèche Dévorante** / Flèche Fulminante ; 22. **Sentinelle** / Acuité Absolue.

**Sorts employés (mesurés)**

92,7 lancers et 248 PA dépensés par combat en moyenne (256 combats).

| Sort | Lancers par combat | Combats où il est lancé | Part des PA du personnage |
|---|---|---|---|
| Carreaux Destructeurs | 12,5 | 100 % | 20,1 % |
| Œil pour Œil | 11,6 | 100 % | 14,1 % |
| Flèche Punitive | 9,8 | 100 % | 15,8 % |
| Tir Perçant | 8,6 | 100 % | 3,4 % |
| Tirs Puissants | 7,5 | 100 % | 3,0 % |
| Flèche Dévorante | 5,2 | 98 % | 6,3 % |
| Flèche Vagabonde | 5,0 | 99 % | 6,0 % |
| Tir de Repli | 4,7 | 99 % | 1,9 % |
| Flèche d'Abolition | 4,1 | 96 % | 3,3 % |
| Flèche Assaillante | 3,8 | 97 % | 4,5 % |
| Pas Chassé | 3,1 | 98 % | 2,5 % |
| Sentinelle | 2,8 | 100 % | 2,2 % |
| Flèche d'Immobilisation | 2,5 | 75 % | 2,0 % |
| Flèche de Dispersion | 2,2 | 89 % | 2,7 % |
| Œil de Taupe | 2,0 | 86 % | 2,4 % |
| Flèche de Recul | 2,0 | 81 % | 2,4 % |
| Flèche Massacrante | 1,5 | 71 % | 2,5 % |
| Représailles | 1,2 | 72 % | 1,4 % |
| Flèche Glacée | 1,1 | 64 % | 1,3 % |
| Flèche Détonante | 0,7 | 46 % | 0,6 % |
| Flèche Perforante | 0,7 | 50 % | 1,1 % |
| Flèche d'Expiation | 0,2 | 19 % | 0,4 % |

### 2.4 Crâ B — Terre mono-cible, stuff défensif (`cra_terre_mono_vortex_def`, stuff `vortex_cra_terre_mono_def`)

**Rôle en combat** : second tueur et « tank » des Crâs. Mêmes neuf équipements que le Crâ A (de l'amulette à l'arc),
mais 695 points en Vitalité, des transcendances de Vitalité et de résistance à la poussée à la place des transcendances
de dommages, une autre monture et des Dofus défensifs (Ivoire, Argenté Scintillant, Aprybou au lieu d'Impétueux,
Prysmenvout et Dolmanax) : 6 395 PV. Il fait
41 400 dégâts, 8,9 kills et 2,3 corruptions par combat, encaisse le plus (14 000 dégâts par combat) et meurt le plus
tard (tour 28,0 quand il meurt).

| Emplacement | Objet | Niv. | Panoplie | Forgemagie | Lignes de l'objet (jets max) |
|---|---|---|---|---|---|
| Amulette | Talisman Songe | 200 | Panoplie du Bonimenteur | exo +1 PO | +300 Vi, +60 Fo, +60 Int, +60 Cha, +40 Sa, +1 PA, +15 Do Neutre, +15 Do Terre, +15 Do Feu, +15 Do Eau, +15 PP, +8 % Ré Air, +15 Ré Feu, +10 Tacle, +15 Do Cri |
| Anneau | Anneau du Comte Harebourg | 200 | Panoplie du Comte Harebourg | exo +1 PA | +350 Vi, +50 Fo, +50 Sa, +7 % CC, +15 Do Neutre, +15 Do Terre, -500 Ini, +25 Ré Cri |
| Anneau | Baguistik | 200 | Panoplistik | exo +1 PM | +300 Vi, +40 Fo, +40 Int, +40 Sa, +4 % CC, +1 PO, +7 Do Neutre, +7 Do Terre, +7 Do Feu, +10 Soins, +7 % Ré Eau, +30 Ré Cri |
| Ceinture | Sangle Ouare | 200 | Panoplie du Bonimenteur | transc. Rata Vi (+100 Vi) | +300 Vi, +40 Cha, +30 Sa, +40 Pui, +1 PM, +2 Invo, +15 PP, -400 Ini, +10 % Ré Eau, +10 % Ré Air, +15 Tacle, -8 Esq PM, +25 Do Cri, +25 Do Pou |
| Bottes | Bottes du Comte Harebourg | 200 | Panoplie du Comte Harebourg | transc. Rata Vi (+100 Vi) | +400 Vi, +80 Fo, +50 Sa, +1 PM, +20 Do Neutre, +20 Do Terre, +30 Ré Neutre, +15 Tacle, -10 Esq PM, +30 Ré Pou |
| Coiffe | Cornes du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transc. Pata Ré Pou (+12 Ré Pou) | +450 Vi, +100 Fo, +50 Sa, +6 % CC, +1 Invo, +8 Soins, +15 PP, -300 Ini, +5 % Ré Feu, +5 % Ré Eau, +5 % Ré Air, +12 Fuite, +10 Ret PM, +30 Ré Pou |
| Cape | Cape Ovri | 200 | Panoplie du Bonimenteur | transc. Rata Vi (+100 Vi) | +400 Vi, +60 Fo, +60 Cha, +50 Sa, +5 % CC, +16 Do Neutre, +16 Do Terre, +16 Do Eau, +400 Ini, +10 % Ré Neutre, +20 Ré Feu, -15 Tacle |
| Bouclier | Bouclistik | 200 | Panoplistik | transc. Rata Vi (+100 Vi) | +250 Vi, +40 Sa, +50 Pui, +1 PO, +20 PP, +5 % Ré Neutre, +15 Tacle, +40 Do Pou, +7 % Ré Mêlée |
| Arme | Arc du Vénérable Endormi | 200 | Panoplie du Vénérable Endormi | transc. Pata Ré Pou (+12 Ré Pou) | +450 Vi, +100 Fo, +50 Sa, +8 % CC, +1 PO, +10 Do Terre, +10 Soins, +15 PP, -200 Ini, +7 % Ré Terre, +7 % Ré Eau, +15 Fuite, +30 Ré Pou |
| Familier/Monture | Volkorne Doré et Pourpre | 60 | — | — | +200 Vi, +70 Fo, +1 PA |
| Dofus/Trophée/Prysma | Dofus Ocre | 160 | — | — | +1 PA, sort passif |
| Dofus/Trophée/Prysma | Dofus Ivoire | 180 | — | — | +4 % Ré Neutre, +4 % Ré Terre, +4 % Ré Feu, +4 % Ré Eau, +4 % Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus Argenté Scintillant | 180 | — | — | +300 Vi, sort passif |
| Dofus/Trophée/Prysma | Aprybou | 200 | — | — | -1000 Ini, +40 Ré Neutre, +40 Ré Terre, +40 Ré Feu, +40 Ré Eau, +40 Ré Air, sort passif |
| Dofus/Trophée/Prysma | Dofus des Glaces | 180 | — | — | +25 Do Neutre, +25 Do Terre, +25 Do Feu, +25 Do Eau, +25 Do Air |
| Dofus/Trophée/Prysma | Dofus Pourpre | 110 | — | — | +80 Pui, sort passif |

- **Forgemagie** : Exos : **+1 PO** (Talisman Songe), **+1 PA** (Anneau du Comte Harebourg), **+1 PM** (Baguistik) ; transcendances (6) : Rata Vi (+100 Vi) ×4 (Sangle Ouare, Bottes du Comte Harebourg, Cape Ovri, Bouclistik) ; Pata Ré Pou (+12 Ré Pou) ×2 (Cornes du Vénérable Endormi, Arc du Vénérable Endormi).
- **Points et parchemins** : 995 / 995 points : Vitalité 695 + Force 300 (caractéristiques de base Vitalité 695, Force 200) ; parchemins +100 dans les six caractéristiques ; panoplies Bonimenteur 3, Comte Harebourg 2, Panoplistik 2, Vénérable Endormi 2 ; build valide (`computeBuildStats`) : oui.

**Caractéristiques finales**

| PV | PA / PM / PO | Résistances % (N / T / F / E / A) | Rés. fixes | Ré Pou / Ré Cri | Puissance | Dommages élém. (N / T / F / E / A) | % Do sorts / distance | CC / Do Cri | Soins | Ret PA / PM | Tacle / Fuite | Initiative |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **6395** | 12 / 6 / 6 | 22 / 24 / 22 / 46 / 30 | 70 / 40 / 75 / 40 / 40 | 144 / 110 | 220 | 108 / 124 / 79 / 56 / 25 | 0 / 0 | 45 % / 40 | 68 | 54 / 64 | 80 / 37 | -180 |

Caractéristiques principales : Vitalité 5345, Sagesse 540, Force 1060, Intelligence 400, Chance 260, Agilité 100.

**22 variantes (sort actif / variante écartée)** : identiques au Crâ A.

**Sorts employés (mesurés)**

112,4 lancers et 295 PA dépensés par combat en moyenne (256 combats).

| Sort | Lancers par combat | Combats où il est lancé | Part des PA du personnage |
|---|---|---|---|
| Carreaux Destructeurs | 16,5 | 100 % | 22,3 % |
| Œil pour Œil | 14,2 | 100 % | 14,5 % |
| Tir Perçant | 11,0 | 100 % | 3,7 % |
| Flèche Punitive | 10,1 | 100 % | 13,7 % |
| Tirs Puissants | 9,6 | 100 % | 3,3 % |
| Tir de Repli | 6,7 | 100 % | 2,3 % |
| Flèche Dévorante | 6,3 | 99 % | 6,4 % |
| Flèche d'Abolition | 4,8 | 98 % | 3,3 % |
| Flèche Assaillante | 4,3 | 97 % | 4,4 % |
| Flèche Vagabonde | 4,1 | 96 % | 4,2 % |
| Flèche d'Immobilisation | 4,1 | 89 % | 2,8 % |
| Pas Chassé | 3,8 | 98 % | 2,6 % |
| Sentinelle | 3,4 | 100 % | 2,3 % |
| Œil de Taupe | 2,9 | 93 % | 2,9 % |
| Flèche de Recul | 2,3 | 85 % | 2,3 % |
| Flèche de Dispersion | 2,2 | 88 % | 2,3 % |
| Représailles | 1,9 | 88 % | 1,9 % |
| Flèche Massacrante | 1,7 | 78 % | 2,4 % |
| Flèche Détonante | 0,9 | 58 % | 0,6 % |
| Flèche Perforante | 0,7 | 50 % | 1,0 % |
| Flèche Glacée | 0,7 | 46 % | 0,7 % |
| Flèche d'Expiation | 0,2 | 15 % | 0,2 % |

Sorts clés des deux Crâs : *Carreaux Destructeurs* (Terre en zone, 1-3 PO, retire des dommages et repousse ; 20-22 %
de leurs PA), *Œil pour Œil* (vol de vie Terre en zone, plus fort après des attaques subies), *Flèche Punitive*
(Terre, 4-10 PO, érosion, dommages croissants), *Tir Perçant* et *Tirs Puissants* (1 PA : érosion, dommages subis et
Puissance avant la frappe), *Flèche Dévorante*, *Flèche Vagabonde*, *Flèche d'Abolition*, *Flèche Assaillante* ;
*Tir de Repli*, *Pas Chassé* et *Sentinelle* servent au placement et à la portée. *Flèche d'Expiation*, *Flèche
Perforante*, *Flèche Détonante* et *Flèche Glacée* servent peu ; leurs alternatives (Rédemption Eau, Boomerang,
Ralentissante Eau, Harcelante Air) ne sont pas dans l'élément du Crâ, et les bascules mesurées (Jugement, Balise de
Survie, Acuité Absolue, Boomerang, Paralysante, Tirs Éloignés, Balise Tactique) ne font pas mieux.

### 2.5 Pourquoi ces builds (rappel des campagnes)

| Décision | Mesure (graines appariées) | Source |
|---|---|---|
| Deux Crâs Terre plutôt que Feu + Terre | +0,64 ± 0,60 corrompu, premier mort +1,6 ± 1,0 tour (256 graines inédites) | vortex-equipe-utilisateur.md, Vérification |
| Crâ B en stuff défensif | corruption égale (−0,04 ± 0,60 contre deux Crâs Terre équilibrés), premier mort +2,0 ± 1,0 tour | idem |
| Contre l'ancien défaut Crâ Feu + Crâ Air | +1,80 ± 0,52 corrompu ; 10 / 256 victoires contre 3 / 256 | idem |
| Eniripsa soin Feu, Enutrof retrait PM Eau | chaque alternative : −1,8 à −3,4 corrompus (32 graines) | vortex-equipe-utilisateur.md, Criblage |
| Variantes de sorts des presets | 8 bascules du Crâ Terre : aucune meilleure (Jugement neutre sur un Crâ, −1,0 sur les deux) | idem, Variantes |
| Stuffs : profils équilibré / défensif / offensif | proxy DPT / EHP de l'optimiseur, puis combats appariés | vortex-stuffs.md, vortex-equipe-utilisateur.md |

## 3. Déroulement du combat

### 3.1 Les règles qui dictent la stratégie

- **Vagues** : vague 1 = Vortex + Ikargn, Méjaire, Harpille ; puis 4 monstres aux tours 7, 13, 19 et 25 (19 monstres à
  corrompre). Les vagues 2 à 5 sont invulnérables pendant leur tour d'arrivée.
- **Horloge** : l'Auroraire avance d'une heure au début du tour de chaque personnage, et d'une heure de plus chaque fois
  qu'un personnage entre dans le glyphe d'un monstre. À 4 joueurs, chaque personnage retrouve la même heure tous les
  3 tours (sans glyphe : Eniripsa I / V / IX, Crâ A II / VI / X, Enutrof III / VII / XI, Crâ B IV / VIII / XII).
- **Mort, marque, corruption** : un monstre tué prend l'état de l'heure courante, puis ressuscite au tour du Vortex
  (zombie, 20-30 % de ses PV, −1 PM) avec le bonus de cette heure. Quand l'horloge revient sur une heure où il est mort,
  il porte l'étoile (« Même heure ») : tué à ce moment, il est **corrompu** (invulnérable, passe ses tours). Le bonus
  de chaque heure utilisée est aussi donné au Vortex en phase 2 (V : dégâts subis ×75 % ; XI : +30 % PV ; I :
  critiques…).
- **Déverrouillage** : pas avant le 26ᵉ tour du Vortex. Quand les 19 monstres sont corrompus, *Action !* : tout le monde
  revient à sa case de départ, les monstres meurent, le Vortex (15 000 PV, plus ses bonus d'heures) devient vulnérable
  au tour suivant et frappe fort (*Heuristique* : Pacifiste en ligne jusqu'à 8 PO sans ligne de vue).
- **Dangers** : *En temps et en heure* (dégâts Terre aux personnages en ligne avec l'Auroraire au tour du Vortex),
  *Pacifiste* des Méjaires (le personnage ne peut plus infliger de dommages tant qu'il porte l'état ; non désenvoûtable), poussées et
  *Neutralisation* des Brabuzars, poison des Harpilles.

### 3.2 Ce que fait l'IA de groupe

L'IA `fast` joue chaque tour de personnage en trois étages (docs/design/ai.md) :

1. **Le planificateur d'heures** (`HourPlanner`) prévoit l'horloge sur les créneaux à venir et cherche « qui tue quoi à
   quelle heure » : **marquer** un monstre à une heure bon marché (il ressuscitera avec ce bonus), puis le
   **corrompre** quand le même créneau revient. Ses plans sont visibles dans les replays (notes `aiNote`, par exemple
   « Plan : #3 marque #6 à IV (tour 1, 65 %) ; glyphe +1 au tour 2 » : le combattant n° 3, le Crâ B, doit tuer la
   Méjaire (n° 6) à IV, avec 65 % de chances). Il évite les heures chères : sur les 256 combats, les corruptions ont
   lieu surtout à XII, X, VI, II et IV, et presque jamais à V (68 en tout) ni à XI (38), les deux heures qui renforcent
   le plus le Vortex.
2. **Les prix** : le plan devient une table de prix (valeur d'un kill de chaque monstre à chaque heure, valeur des PV
   retirés, valeur d'un décalage de l'horloge par une glyphe) ; depuis le tour 5, un re-kill de zombie qui ne lui
   retire aucun tour est débité de ses PV de résurrection (ZREZ2).
3. **La recherche de tour** (faisceau de largeur 3, 120 nœuds) choisit la suite d'actions qui maximise la valeur
   d'équipe : dégâts, kills au bon prix, menace subie au prochain tour des monstres, retraits de PM, soins, placement
   hors des lignes de l'Auroraire et des Méjaires. Des **tactiques** proposent des coups composés : enchaînement
   (buff puis frappe : *Tir Perçant* + *Tirs Puissants* avant *Flèche Punitive*), regroupement pour la zone, soin qui
   purge le poison, verrou de PM, préparation du burst, glyphe d'horloge.

L'équipe désigne aussi une **cible prioritaire** (note « Cible prioritaire de l'équipe ») et annonce ses **contrôles**
(« Contrôler X : PM ≤ n pour qu'il n'atteigne personne »). Les tableaux ci-dessous comptent ces notes.

### 3.3 Vague par vague (256 combats inédits)

Moyennes par combat ; une phase ne compte que les combats qui l'atteignent (colonne « Combats »). « Corruptions dans
la phase » = kills sous l'étoile ; « Corruptions cumulées » = total depuis le début (le compteur officiel, entre
parenthèses, compte une corruption au tour du Vortex qui suit le kill). « Glyphes d'horloge » = heures ajoutées par des
glyphes de monstres. « Morts » = personnages morts dans la phase.

| Phase | Combats | Kills (joueurs) | Corruptions dans la phase | Corruptions cumulées (compteur officiel en fin de phase) | Glyphes d'horloge | Tours pacifiés | Morts | Cible prioritaire de l'équipe (notes par combat) | Contrôle de PM visé (notes par combat) | Tactiques proposées (notes par combat) |
|---|---|---|---|---|---|---|---|---|---|---|
| Vague 1 (tours 1-6) | 256 | 6,7 | 2,10 | 2,10 (1,61) | 1,5 | 6 % | 0,00 | Méjaire 4,7, Ikargn 4,4, Harpille 1,9 | Méjaire 6,6, Harpille 2,2, Ikargn 0,6 | enchaînement (état / buff puis frappe) 3,6, préparation du burst 2,4, soin qui purge le poison 1,9 |
| Vague 2 (tours 7-12) | 256 | 7,7 | 1,96 | 4,06 (3,90) | 1,6 | 2 % | 0,02 | Harpille 5,5, Buboxor 4,1, Brabuzar 1,2 | Harpille 4,4, Buboxor 4,3, Brabuzar 3,2 | enchaînement (état / buff puis frappe) 2,7, préparation du burst 2,0, regroupement pour la zone 1,6 |
| Vague 3 (tours 13-18) | 256 | 6,3 | 2,53 | 6,59 (6,50) | 1,4 | 26 % | 0,11 | Méjaire 9,8, Harpille 3,3, Buboxor 2,1 | Méjaire 9,0, Brabuzar 4,1, Harpille 4,1 | enchaînement (état / buff puis frappe) 3,8, préparation du burst 2,1, regroupement pour la zone 1,4 |
| Vague 4 (tours 19-24) | 256 | 5,2 | 1,70 | 8,29 (8,22) | 1,3 | 30 % | 1,01 | Méjaire 7,5, Ikargn 4,0, Harpille 0,9 | Brabuzar 10,0, Méjaire 9,8, Harpille 2,8 | enchaînement (état / buff puis frappe) 3,6, regroupement pour la zone 1,3, glyphe d'horloge 1,3 |
| Vague 5 (tour 25 → *Action !*) | 242 | 4,4 | 1,60 | 10,05 (9,98) | 0,8 | 17 % | 2,81 | Ikargn 3,3, Méjaire 2,9, Buboxor 1,3 | Buboxor 10,9, Brabuzar 9,3, Méjaire 6,2 | enchaînement (état / buff puis frappe) 2,7, regroupement pour la zone 1,1, glyphe d'horloge 0,8 |
| Phase 2 (après *Action !*) | 17 | 0,0 | 0,00 | — | 0,0 | 39 % | 0,06 | Vortex 0,4 | Vortex 5,2 | préparation du burst 4,1, enchaînement (état / buff puis frappe) 3,4, verrou de PM 0,4 |

Par personnage (dégâts aux monstres de vague, kills / corruptions, part des tours pacifiés et trois sorts les plus
lancés) :

| Phase | Eniripsa | Enutrof | Crâ A (équilibré) | Crâ B (défensif) |
|---|---|---|---|---|
| Vague 1 (tours 1-6) | 3 477 dég., 0,7 kills / 0,29 corr., soins 3 227 ; pacifié 7 % ; Mot Galvanisant 3,9, Mot d'Amitié 2,4, Mot Turbulent 2,3 | 4 407 dég., 0,9 kills / 0,42 corr., −11,0 PM, 1,2 immob. ; pacifié 2 % ; Clef de Bras 4,3, Obsolescence 2,1, Pelle des Anciens 2,0 | 9 681 dég., 2,5 kills / 0,68 corr. ; pacifié 5 % ; Œil pour Œil 3,1, Carreaux Destructeurs 2,2, Flèche Punitive 2,0 | 7 732 dég., 2,6 kills / 0,70 corr. ; pacifié 10 % ; Œil pour Œil 3,1, Flèche Punitive 2,7, Tir Perçant 2,5 |
| Vague 2 (tours 7-12) | 5 791 dég., 1,1 kills / 0,42 corr., soins 11 676 ; pacifié 3 % ; Mot Tapageur 3,3, Mot Galvanisant 3,2, Mot Distrayant 3,0 | 7 793 dég., 2,1 kills / 0,46 corr., −16,8 PM, 4,1 immob. ; pacifié 1 % ; Pelle des Anciens 3,3, Obsolescence 2,8, Tamisage 2,5 | 11 747 dég., 2,4 kills / 0,64 corr. ; pacifié 3 % ; Carreaux Destructeurs 4,2, Œil pour Œil 2,4, Flèche Punitive 2,3 | 9 991 dég., 2,1 kills / 0,44 corr. ; pacifié 2 % ; Carreaux Destructeurs 4,6, Œil pour Œil 2,5, Tirs Puissants 2,4 |
| Vague 3 (tours 13-18) | 4 227 dég., 1,1 kills / 0,55 corr., soins 15 226 ; pacifié 27 % ; Mot Tapageur 3,4, Mot Galvanisant 3,2, Mot Distrayant 3,1 | 6 185 dég., 1,6 kills / 0,73 corr., −22,2 PM, 10,5 immob. ; pacifié 19 % ; Tamisage 2,8, Pelle des Anciens 2,8, Obsolescence 2,2 | 9 678 dég., 2,1 kills / 0,81 corr. ; pacifié 25 % ; Œil pour Œil 2,8, Carreaux Destructeurs 2,6, Flèche Punitive 2,5 | 8 448 dég., 1,6 kills / 0,43 corr. ; pacifié 32 % ; Carreaux Destructeurs 3,9, Œil pour Œil 2,9, Tir Perçant 2,5 |
| Vague 4 (tours 19-24) | 5 632 dég., 0,8 kills / 0,36 corr., soins 20 891 ; pacifié 33 % ; Mot Tapageur 4,4, Mot Distrayant 3,3, Mot Turbulent 2,6 | 6 565 dég., 1,3 kills / 0,46 corr., −22,0 PM, 13,1 immob. ; pacifié 29 % ; Tamisage 3,0, Pelle des Anciens 2,2, Clef de Bras 2,1 | 8 005 dég., 1,6 kills / 0,50 corr. ; pacifié 26 % ; Carreaux Destructeurs 2,2, Œil pour Œil 2,2, Flèche Punitive 1,9 | 8 402 dég., 1,4 kills / 0,38 corr. ; pacifié 32 % ; Carreaux Destructeurs 3,4, Œil pour Œil 3,0, Tir Perçant 2,1 |
| Vague 5 (tour 25 → *Action !*) | 6 020 dég., 0,9 kills / 0,37 corr., soins 13 159 ; pacifié 20 % ; Mot Tapageur 3,3, Mot Distrayant 2,8, Mot Turbulent 2,4 | 5 944 dég., 1,2 kills / 0,42 corr., −16,9 PM, 8,9 immob. ; pacifié 16 % ; Tamisage 2,3, Pelle des Anciens 1,6, Obsolescence 1,5 | 4 677 dég., 1,2 kills / 0,42 corr. ; pacifié 10 % ; Carreaux Destructeurs 1,2, Œil pour Œil 1,1, Flèche Punitive 1,1 | 7 223 dég., 1,1 kills / 0,38 corr. ; pacifié 19 % ; Carreaux Destructeurs 3,0, Œil pour Œil 2,5, Tir Perçant 1,7 |
| Phase 2 (après *Action !*) | 3 093 dég. au Vortex, soins 26 766 ; pacifié 51 % ; Vacarme 4,5, Mot Turbulent 4,3, Mot Tapageur 4,2 | 3 499 dég. au Vortex, −10,1 PM, 0,3 immob. ; pacifié 21 % ; Pelle des Anciens 2,5, Obsolescence 2,4, Lancer de Pièces 2,4 | 2 539 dég. au Vortex ; pacifié 36 % ; Tir de Repli 1,8, Flèche Dévorante 1,5, Flèche Punitive 1,4 | 4 396 dég. au Vortex ; pacifié 38 % ; Tir Perçant 3,8, Œil pour Œil 3,4, Flèche Dévorante 3,3 |

**Tours 1-6 — vague 1 (Ikargn, Méjaire, Harpille ; Vortex invulnérable).** L'équipe vise d'abord la **Méjaire** et
l'**Ikargn** (≈ 4,5 notes de cible prioritaire chacun par combat). La Méjaire est verrouillée en PM dès le tour 1
(6,6 notes de contrôle par combat) pour la tenir hors de portée de son *Pacifiste* (1-3 PO en ligne). Les deux Crâs
ouvrent à *Œil pour Œil*, *Carreaux Destructeurs* et *Flèche Punitive*, préparés par *Tir Perçant* et *Tirs
Puissants*. L'Eniripsa distribue *Mot Galvanisant* et pose son Lapino (*Mot d'Amitié*). Chaque monstre est tué 2 à 3
fois (6,7 kills) : une première fois pour le marquer, puis sous l'étoile 3 tours plus tard. **2,1 des 3 monstres sont
corrompus à la fin du tour 6, et la vague 1 est entièrement corrompue au tour 12 dans 99,2 % des combats (254 / 256 ;
255 / 256 en fin de combat).**

**Tours 7-12 — vague 2 (Harpille ×2, Buboxor, Brabuzar).** Elle est invulnérable pendant son tour d'arrivée. Focus sur les
**Harpilles** (5,5 notes) puis le Buboxor ; les contrôles de PM se répartissent entre Harpilles, Buboxor et Brabuzar.
Le poison des Harpilles fait de l'Eniripsa un soigneur à plein temps (11 700 PV soignés dans la phase, tactique « soin
qui purge le poison ») ; l'Enutrof l'aide avec *Clef de Bras*. La phase sert surtout au marquage de la vague 2 :
1,1 monstre de la vague 2 corrompu au tour 12, **3,4 au tour 18** ; la vague 2 est entièrement corrompue dans 70 % des
combats.

**Tours 13-18 — vague 3 (Méjaire ×2, Harpille, Brabuzar).** C'est le tournant. Les deux Méjaires concentrent le focus
(9,8 notes) et les contrôles (9,0), mais **26 % des tours de joueur commencent sous *Pacifiste*** (32 % pour le Crâ B,
27 % pour l'Eniripsa) : un tueur pacifié ne peut pas corrompre le monstre qu'il avait marqué, et sa fenêtre d'étoile
est perdue jusqu'au cycle suivant. L'équipe termine surtout la vague 2 ; la vague 3 n'a que 0,2 monstre corrompu au
tour 18.

**Tours 19-24 — vague 4 (Brabuzar ×2, Méjaire, Ikargn).** 30 % des tours pacifiés ; les Brabuzars poussent et
*Neutralisent* (ils sont la première source de dégâts subis, voir § 3.5) ; ils deviennent la première cible des
contrôles (10 notes) et l'Enutrof multiplie les *Retraite Anticipée* (13 immobilisations dans la phase). Le premier
mort arrive vers le tour 23 (1,0 mort par combat dans la phase). Fin du tour 24 : 8,3 corruptions en moyenne, vague 3 à
1,6 / 4, vague 4 à 0,1 / 4.

**Tour 25 → *Action !* — vague 5 (Buboxor ×2, Brabuzar, Ikargn).** Dans les défaites, l'équipe s'effondre (2,9 morts
dans la phase) et le Vortex atteint son 26ᵉ tour avec des monstres non corrompus. Dans les victoires, au contraire,
c'est la phase la plus productive : **19 kills et 8,3 corruptions** en ≈ 13 tours, l'Enutrof immobilise le terrain
(33 immobilisations, 38 PM retirés) et l'Eniripsa soigne 35 000 PV ; *Action !* arrive au tour 38 en moyenne.

**Phase 2 (après *Action !*).** Le Vortex reçoit le bonus de chaque heure distincte utilisée (10,5 heures dans les
victoires), reste invulnérable un tour, puis devient vulnérable. Le planificateur de burst affiche P(kill) dans ses
notes (« Burst : P(kill) 0 % (μ 7556 / 15000 PV), vulnérable au tour 38 ») ; dans les victoires, les quatre
personnages frappent le Vortex (3 200 à 4 800 dégâts chacun) pendant que l'Eniripsa soigne 22 000 PV. *Heuristique*
pacifie 31-39 % des tours de joueur ; le Vortex meurt en 7,8 tours en moyenne après *Action !*. 11 des 17 combats
arrivés à *Action !* sont gagnés ; les 6 autres atteignent tous la limite de 60 tours (aucun « burst raté »).

### 3.4 Corruption de chaque vague (cumul des monstres corrompus de la vague)

| Vague (arrivée) | fin du tour 6 | 12 | 18 | 24 | 30 | 36 | fin du combat | vague entièrement corrompue | tour moyen de la corruption |
|---|---|---|---|---|---|---|---|---|---|
| Vague 1 : Ikargn, Méjaire, Harpille (tour 1) | 2,10 | 2,99 | 3,00 | 3,00 | 3,00 | 3,00 | **3,00 / 3** | 99,6 % | 6,2 |
| Vague 2 : Harpille ×2, Buboxor, Brabuzar (tour 7) | · | 1,07 | 3,38 | 3,61 | 3,62 | 3,62 | **3,62 / 4** | 70 % | 14,1 |
| Vague 3 : Méjaire ×2, Harpille, Brabuzar (tour 13) | · | · | 0,21 | 1,63 | 1,97 | 1,99 | **2,00 / 4** | 27 % | 21,9 |
| Vague 4 : Brabuzar ×2, Méjaire, Ikargn (tour 19) | · | · | · | 0,06 | 0,70 | 0,82 | **0,84 / 4** | 10 % | 28,0 |
| Vague 5 : Buboxor ×2, Brabuzar, Ikargn (tour 25) | · | · | · | · | 0,04 | 0,24 | **0,34 / 4** | 7 % | 35,8 |

La corruption suit les vagues avec un retard croissant : une corruption de la vague 1 tombe en moyenne au tour 6,2,
de la vague 2 au tour 14,1 (7 tours après son arrivée), de la vague 3 au tour 21,9 (9 tours après). Quand la vague est
entièrement corrompue, sa dernière corruption arrive en moyenne au tour 7,4 pour la vague 1, 9,8 tours après
l'arrivée pour la vague 2 (6 à 18 ; 70 % des combats) et 11,9 tours après pour la vague 3 (7 à 28 ; 27 % des combats) ;
les vagues 4 et 5 ne le sont que dans 10 % et 7 % des combats. Toutes les victoires ont corrompu les 19 monstres (c'est
la condition d'*Action !*).

### 3.5 Qui fait quoi (sur le combat entier)

| Personnage | Dégâts aux monstres de vague (dont invocations) | Dégâts au Vortex | Kills | Corruptions (kills sous l'étoile) | Soins aux alliés (+ boucliers) | PM retirés / immobilisations | Dégâts subis (dont poussées) | Tours pacifiés (tours ≥ 13) | Mort avant la fin (tour moyen) |
|---|---|---|---|---|---|---|---|---|---|
| Eniripsa | 24 816 (0) | 205 | 4,5 | 1,97 | 65 238 (+17 382) | 1,0 / 0,0 | 13 389 (3 726) | 28 % | 94 % (27,4) |
| Enutrof | 30 569 (4 352) | 232 | 7,0 | 2,47 | 6 148 (+0) | 88,6 / 37,3 | 10 749 (3 066) | 22 % | 96 % (26,7) |
| Crâ A (équilibré) | 43 533 (0) | 169 | 9,7 | 3,04 | 1 664 (+0) | 1,0 / 0,0 | 12 862 (1 375) | 23 % | 96 % (23,7) |
| Crâ B (défensif) | 41 402 (0) | 292 | 8,9 | 2,31 | 2 681 (+0) | 1,5 / 0,0 | 13 993 (2 721) | 29 % | 93 % (28,0) |

Corruptions par combat : Crâ A 3,0, Enutrof 2,5, Crâ B 2,3, Eniripsa 2,0. Elles sont réparties entre les quatre
personnages, parce que le même créneau revient 3 tours plus tard : la corruption revient à celui qui joue à l'heure du
marquage, quel que soit son rôle.

**Dégâts subis par source** (moyenne par combat, les quatre personnages) :

| Source | Dégâts subis par combat (4 personnages) | Détail |
|---|---|---|
| Brabuzar | 17 509 | dont 9 569 de poussées / collisions |
| Harpille | 11 057 | dont 5 566 de poison |
| Ikargn | 7 684 |  |
| Buboxor | 7 190 |  |
| Méjaire | 4 242 | dont 494 de poussées |
| Auroraire (*En temps et en heure*) | 1 594 |  |
| Vortex (phase 2 surtout) | 715 |  |
| Alliés (poussées, Pesanteur…) | 998 |  |

### 3.6 Où les combats se séparent : victoires contre défaites

| Phase | Victoires (11) : kills / corruptions / corrompus cumulés / pacifiés / morts | Défaites (245) : kills / corruptions / corrompus cumulés / pacifiés / morts |
|---|---|---|
| Vague 1 (tours 1-6) | 6,5 / 2,27 / 2,27 / 6 % / 0,00 | 6,7 / 2,09 / 2,09 / 6 % / 0,00 |
| Vague 2 (tours 7-12) | 7,9 / 2,09 / 4,36 / 2 % / 0,00 | 7,7 / 1,96 / 4,05 / 2 % / 0,02 |
| Vague 3 (tours 13-18) | 9,4 / 2,91 / 7,27 / 14 % / 0,00 | 6,2 / 2,51 / 6,56 / 26 % / 0,11 |
| Vague 4 (tours 19-24) | 10,0 / 3,45 / 10,73 / 16 % / 0,00 | 5,0 / 1,62 / 8,18 / 31 % / 1,05 |
| Vague 5 (tour 25 → *Action !*) | 19,2 / 8,27 / 19,00 / 3 % / 0,36 | 3,7 / 1,28 / 9,62 / 19 % / 2,93 (n = 231) |
| Phase 2 (après *Action !*) | 0,0 / 0,00 / — / 31 % / 0,09 | 0,0 / 0,00 / — / 56 % / 0,00 (n = 6) |

Les victoires ne se distinguent pas avant le tour 13 (mêmes kills, mêmes corruptions). Elles se séparent pendant les
vagues 3 et 4 : **deux fois moins de tours pacifiés** (14-16 % contre 26-31 %), **deux fois plus de kills** et de
corruptions (vague 4 : 10,0 kills et 3,5 corruptions contre 5,0 et 1,6), aucun mort avant le tour 25. Le *Pacifiste*
des Méjaires et la survie à la vague 4 décident du combat.

### 3.7 Combat gagnant n° 1 — graine 3290233078 (replay publié)

`npx tsx src/cli/simulate.ts fight vortex --ai fast --seed 3290233078` : **victoire au tour 42, aucun mort, 19 / 19
corrompus au tour 36, *Action !* au tour 37**, 10 heures distinctes (empreinte 1635433083). Replay animé :
`web/public/replays/vortex-equipe-utilisateur-victoire-s3290233078.json` (en tête de `index.json`). Résumé tour par
tour, tiré des événements et des notes `aiNote` du replay (heure = heure de l'horloge au moment du kill ; ★ = kill sous
l'étoile, donc corruption) :

| Tours | Vague | Ce qui se passe | Corruptions (cumul) |
|---|---|---|---|
| 1-6 | 1 : Ikargn, Méjaire, Harpille | Plan du tour 1 : « le Crâ B marque la Méjaire à IV ». La Méjaire est verrouillée en PM (3 contrôles au tour 1). Marquages : Crâ A tue l'Ikargn à VI (t. 2) ; Crâ B tue la Méjaire et la Harpille à XII (t. 3), puis l'Ikargn ressuscité à IV (t. 4) ; Crâ A retue la Méjaire à VI (t. 5). **T. 6 : le Crâ B corrompt la Harpille à XII★**, trois tours après l'avoir marquée à XII. | 1 |
| 7-12 | 2 : Harpille ×2, Buboxor, Brabuzar | T. 7 : Crâ B corrompt l'Ikargn à IV★ (marqué à IV au tour 4) ; t. 8 : Crâ A corrompt la Méjaire à VI★ : **vague 1 terminée au tour 8**. Tours 10-12 : 9 kills de marquage de la vague 2 (Eniripsa le Brabuzar à I ; Crâ A une Harpille et le Buboxor à II, l'autre Harpille à VI ; Enutrof le Brabuzar et le Buboxor ressuscités à VII ; Crâ B les deux Harpilles à VIII, le Buboxor à XII). | 3 |
| 13-18 | 3 : Méjaire ×2, Harpille, Brabuzar | T. 13 : Eniripsa corrompt le Brabuzar à I★ ; t. 14 : **Crâ B corrompt les deux Harpilles à VIII★** (marquées au tour 11) ; t. 14-17 : Crâ A puis Eniripsa pacifiés ; focus sur les Méjaires (14 notes dans la vague) ; t. 18 : Enutrof corrompt le Buboxor à XII★ : vague 2 terminée. | 7 |
| 19-24 | 4 : Brabuzar ×2, Méjaire, Ikargn | T. 19-22 : corruption de la vague 3 (Crâ A Méjaire à III★ et Brabuzar à VII★ ; Eniripsa l'autre Méjaire à II★ ; Crâ A la Harpille à III★) : **vague 3 terminée au tour 22**. En parallèle, marquage de la vague 4 (Enutrof les deux Brabuzars à XII et IV, Eniripsa l'Ikargn à VI, Crâ A un Brabuzar et la Méjaire à VII, Crâ B la Méjaire à I). | 11 |
| 25-36 | 5 : Buboxor ×2, Brabuzar, Ikargn | T. 26 : triple corruption de la vague 4 (Eniripsa Ikargn à VI★, Crâ A Méjaire à VII★, Crâ B Brabuzar à IX★) ; t. 29 : Eniripsa le dernier Brabuzar à VII★. Vague 5 : Crâ A Brabuzar à XII★ (t. 30), Eniripsa Ikargn à VIII★ (t. 32), Crâ B Buboxor à VII★ (t. 34), **Crâ A le dernier Buboxor à I★ (t. 36) : 19 / 19**. | 19 |
| 37-42 | *Action !* puis phase 2 | T. 37 : *Action !* (téléportation, les 19 monstres meurent, le Vortex reçoit les bonus de 10 heures). T. 38 : Vortex vulnérable, l'équipe se place. Vortex à 15 000 PV au début du tour 39, 12 256 au tour 40, 7 490 au tour 41 (« P(kill) 29 % »), 1 136 au tour 42 : l'Eniripsa l'achève. | — |

Bilan du combat : Crâ A 72 600 dégâts aux vagues, 22 kills, 7 corruptions ; Crâ B 62 200 dégâts, 18 kills,
6 corruptions ; Eniripsa 37 900 dégâts, 10 kills, 5 corruptions, 73 300 PV soignés ; Enutrof 35 000 dégâts, 10 kills,
1 corruption, 106 PM retirés et 67 immobilisations. Dégâts au Vortex : 4 200 / 4 100 / 3 300 / 3 500 (Eniripsa /
Crâ A / Crâ B / Enutrof). 9 tours pacifiés sur 165.

### 3.8 Combat gagnant n° 2 — graine 860249307 (256 graines de ce rapport)

`npx tsx src/cli/simulate.ts fight vortex --ai fast --seed 860249307` : victoire au tour 42, aucun mort, *Action !* au
tour 35. Vague 1 corrompue dès le tour 6 (Crâ A Ikargn à VI★ au tour 5, Eniripsa Harpille à X★ et Enutrof Méjaire à
XII★ au tour 6). Au tour 18, quatre corruptions dans le même tour (Eniripsa Brabuzar à II★, Crâ A Méjaire et Harpille
à III★, Crâ B Méjaire à V★). Vague 5 réglée en 9 tours (Crâ A Buboxor à V★ au tour 29, Enutrof Brabuzar à VI★ au
tour 32 et Ikargn à XI★ au tour 33, Crâ A Buboxor à II★ au tour 34). L'heure XI utilisée donne au Vortex +30 % de PV
(19 500 PV) : la phase 2 dure 7 tours. Crâ A 19 kills et 8 corruptions, Enutrof 18 kills et 5 corruptions (138 PM
retirés, 48 immobilisations), Eniripsa 66 000 PV soignés.

### 3.9 Modes d'échec restants

Classement automatique de chaque combat (`vortexFailReason`) :

| Issue | Ce rapport (256, `masterSeed` 301-308) | Vérificateur (512, `masterSeed` 201-216) | Ensemble (768) |
|---|---|---|---|
| **Victoire** | 11 (4,3 %) | 31 (6,1 %) | 42 (5,5 %) |
| vague non corrompue au déverrouillage | 183 (71,5 %) | 349 (68,2 %) | 532 (69,3 %) |
| submersion | 44 (17,2 %) | 82 (16,0 %) | 126 (16,4 %) |
| mort sur la croix de l’Auroraire | 10 (3,9 %) | 24 (4,7 %) | 34 (4,4 %) |
| limite de tours | 7 (2,7 %) | 12 (2,3 %) | 19 (2,5 %) |
| burst raté | 0 (0,0 %) | 2 (0,4 %) | 2 (0,3 %) |
| défaite | 1 (0,4 %) | 12 (2,3 %) | 13 (1,7 %) |

1. **Vague non corrompue au déverrouillage (≈ 69 %)** : l'équipe finit par mourir, et le Vortex avait atteint son
   26ᵉ tour avec des monstres non corrompus. Cause directe : la corruption des vagues 3 à 5 (2,0 / 0,8 / 0,3 sur 4 en
   fin de combat). Causes mesurées : le *Pacifiste* (26-30 % des tours de joueur à partir du tour 13 ; non
   désenvoûtable ; aucune correction de l'IA essayée aux tours 4 et 5 ne le réduit de façon mesurable), les morts à
   partir de la vague 4, les fenêtres d'étoile perdues quand le tueur prévu est pacifié ou mort.
2. **Submersion (≈ 16 %)** : plus de 8 monstres non corrompus vivants quand l'équipe meurt avant le 26ᵉ tour du
   Vortex ; la première source de
   dégâts est le Brabuzar (17 500 par combat, dont 9 600 de poussées / collisions), puis la Harpille (11 000, dont
   5 600 de poison).
3. **Mort sur la croix de l'Auroraire (≈ 4 %)** : premier mort tué par *En temps et en heure*.
4. **Limite de 60 tours (≈ 2-3 %)** : presque toujours après un *Action !* tardif (6 des 7 cas de ce rapport, *Action !*
   aux tours 45 à 54), sans finir le Vortex. La limite est une règle
   du simulateur (`maxRounds`) ; les guides ne citent que le succès « Trio » (moins de 80 tours). L'analyste « survie »
   du tour 5 estime qu'une limite à 80 tours ajouterait ≈ 1,6 point de victoires (non mesuré).
5. **Fin de partie** : les combats à 19 / 19 arrivent tard (*Action !* au tour 42 en moyenne, 3 survivants) ; un quart
   d'entre eux ne sont pas gagnés (15 sur 57).

Leviers restants (docs/tuning-log.md, pistes du tour 6) : appliquer aussi le débit ZREZ2 au potentiel
(`killValueFor`) ; « sauver » une fenêtre d'étoile par la glyphe du joueur précédent quand le tueur prévu est pacifié ;
juger chaque changement sur ≥ 512 graines.

## 4. Reproduire

Toutes les commandes partent de la racine du dépôt (Node ≥ 22, `npm install`). Sans `--team`, l'équipe est celle de
`data/teams/vortex.json`. `npm run sim -- <commande>` équivaut à `npx tsx src/cli/simulate.ts <commande>`.

```bash
# Le combat gagnant publié, rejoué sans toucher au dépôt (replay et index.json écrits dans runs/replays/) :
npx tsx src/cli/simulate.ts fight vortex --ai fast --seed 3290233078 --replay-dir runs/replays
# Même combat sans écrire de replay, résumé JSON (eventsHash 1635433083) :
npx tsx src/cli/simulate.ts fight vortex --ai fast --seed 3290233078 --replay none --json
# Second combat gagnant de ce rapport :
npx tsx src/cli/simulate.ts fight vortex --ai fast --seed 860249307 --replay none
# Équipe explicite (équivalente au fichier d'équipe) :
npx tsx src/cli/simulate.ts fight vortex --team eniripsa_soin_vortex,enutrof_retrait_pm_vortex,cra_terre_mono_vortex,cra_terre_mono_vortex_def --ai fast --seed 3290233078 --replay none

# Monte-Carlo : un bloc de 32 graines = campaignSeeds(masterSeed, 32) ; masterSeed 301 à 308 = ce rapport,
# 201 à 216 = le vérificateur. Sortie : victoires avec IC de Wilson, tours, causes d'échec.
npx tsx src/cli/simulate.ts batch vortex --ai fast --runs 32 --master-seed 301 --workers 4
npx tsx src/cli/simulate.ts batch vortex --ai fast --runs 512 --master-seed 1000 --workers 4   # nouvel échantillon (≈ 1 h)

# Builds : options de chaque membre et combats prévus, puis recherche complète (≈ 2 h à 4 workers)
npx tsx src/cli/simulate.ts optimize vortex --dry-run
npx tsx src/cli/simulate.ts optimize vortex --budget normal --workers 4    # --save-team pour réécrire data/teams/vortex.json
npx tsx src/cli/simulate.ts presets --class cra                             # presets, stuffs, PA / PM / PV calculés
```

**Replays animés** : `npm run dev` lance le visualiseur (Vite) ; il lit `web/public/replays/index.json`, dont la
première entrée est le combat gagnant de ce rapport (« Œil de Vortex — équipe de l'utilisateur (Eniripsa, Enutrof,
2 Crâs Terre) : VICTOIRE au tour 42… »). Les notes `aiNote` (plans d'heures, cibles prioritaires, contrôles,
tactiques) accompagnent chaque tour. `npm run build:single` produit une page HTML autonome.

**Mesures de ce rapport** (hors dépôt, `.cache/tuning/r5/final/`) : `tree/` = `git archive 00efef6` (src, data) ;
`run.mts` (un combat par graine, événements et notes `aiNote` décodés par phase) ; `batch.sh F 301,…,308 32`
(4 processus, reprise) ; `agg.cjs` (agrégats) ; `tl2.cjs` (chronologie d'un replay) ; `members.ts` + `mkreport.cjs`
(tableaux de build et de ce rapport) ; résultats bruts `out/F/*.jsonl`, replays des 11 victoires `rep/F/`.

## 5. Limites et incertitudes

### 5.1 Règles du donjon

- **Patch** : le modèle suit les données DofusDB 3.6 et les règles du patch 2.42. La **mise à jour 3.7** (en ligne le
  6 octobre 2026) change le Vortex : il ne ressuscite plus les monstres corrompus et reçoit les bonus d'heures à la
  mort du monstre. Non modélisé (paramètre `patch` recommandé par l'audit) ; DPLN annonce « quasiment aucun impact »,
  mais les corrompus ne tiendront plus de cases ni de lignes de vue.
- **Règles INCERTAINES** (`VORTEX_UNCERTAIN`, `src/dungeons/vortex/constants.ts`). Tous les combats de ce rapport
  utilisent la valeur par défaut (variante `default`) : équipe qui commence selon l'initiative moyenne (sinon « le
  meilleur combattant », 50 %) ; vague 1 non invulnérable (80 %) ; pas d'apparition anticipée d'une vague nettoyée
  (90 %) ; tous les morts ressuscités à chaque tour du Vortex (90 %) ; un personnage mort ne fait pas avancer
  l'horloge (80 %) ; déverrouillage au 26ᵉ tour du Vortex (90 %, sinon 27ᵉ) ; un tour du Vortex entre la dernière
  corruption et *Action !* (60 %, sinon aucun) ; glyphe déclenchée en y entrant (90 %, sinon en fin de tour). Le taux
  robuste (`batch --robust`, une variante tirée par graine) n'a pas été mesuré pour cette équipe.
- **Autres écarts connus** (audit) : cases de l'Auroraire (géométrie de l'horloge probablement décalée de 3 lignes,
  correctif `syncAuroraireCell`) ; délai initial du *Petit poison* et du *Décollage* non appliqué ; dégâts de base
  d'*En temps et en heure* et case de départ du Vortex non documentés ; composition des vagues et ordre d'initiative
  déduits ; pas de modificateur de dimension (en jeu, un modificateur est toujours actif) ; limite de 60 tours propre
  au simulateur.

### 5.2 Hypothèses de build et de forgemagie

- **Jets parfaits** : chaque objet porte ses jets maximaux ; ni le coût de la forgemagie ni la disponibilité des objets
  ne sont pris en compte (Dofus Ocre, Pourpre, Argenté Scintillant, Dolmanax, prysmaradites, Volkornes…).
- **Exos** : au plus un exo PA, un PM et un PO par personnage, jamais sur un objet qui porte déjà la ligne ; ils
  servent à atteindre 12 PA / 6 PM / 6 PO (objectif fixé, pas optimisé).
- **Transcendances** : au plus 6 par stuff, une par objet, choisies parmi les runes réelles (Rata Vi, Ta Do Per So,
  Rata Ret Pme, Pata Ré Pou, Rata Do Eau…) ; aucune autre forgemagie au-delà des jets maximaux.
- **Points** : 995 points répartis entre Vitalité et la caractéristique de l'élément (paliers de classe), parchemins
  100 partout.
- **Optimiseur** : les stuffs sont choisis par recuit sur un proxy (DPT, PV effectifs, utilité) contre le mix des
  monstres du Vortex, puis départagés en combats ; le proxy n'est pas le combat, et un stuff optimisé n'est
  reproductible qu'avec le `data/ai/presets.json` de sa campagne (pools de départ).
- **Variantes** : seules des bascules des Crâs ont été mesurées ; les 22 variantes de l'Eniripsa et de l'Enutrof sont
  celles de leurs presets, non ré-optimisées pour cette composition.

### 5.3 IA

- **Mode `fast`** : faisceau de largeur 3, 120 nœuds par tour, prix heuristiques ; c'est le mode de toutes les mesures.
  Le mode `standard` (60-110 s par combat) n'a été joué que sur 5 graines au tour 5 (aucune erreur, 0 victoire) : son
  taux de victoire n'est pas connu.
- **IA des monstres** fidèle aux règles officielles et fixe (jamais réglée pour faire gagner les joueurs) ; ses choix
  restent une modélisation.
- **θ global** : un seul jeu de poids pour toutes les équipes (et pour le `pacifistFactor` des monstres) ; le tour 5 a
  montré qu'un réglage peut gagner en corruption sans gain de victoires mesurable. De vraies équipes comparables
  gagnent ce donjon facilement (audit) : l'écart avec ≈ 6 % de victoires vient surtout de l'IA (gestion du
  *Pacifiste*, placement, fin de partie), pas des builds.

### 5.4 Mesure

- 768 combats inédits donnent le taux de victoire à ± 1,6 point (IC 95 % 4,1 – 7,3 %) ; deux échantillons de
  256 graines peuvent différer de 2 points par simple hasard (4,3 % ici contre 6,1 % chez le vérificateur, z = 1,0).
- Les fréquences d'emploi des sorts et la chronologie par vague sont des moyennes sur 256 combats `fast` ; elles
  décrivent ce que fait cette IA, pas un optimum de jeu.
- Les classes n'ont pas été comparées à d'autres compositions : c'est le choix de l'utilisateur (l'ancienne équipe de
  référence Crâ / Enutrof / Iop / Eniripsa faisait moins bien : 0 victoire sur 88 graines communes).

## 6. Fichiers

- `docs/reports/vortex-rapport-final.json` : les mesures de ce rapport (taux de victoire, phases, vagues, sorts,
  totaux par personnage, causes d'échec, graines gagnantes), les builds complets des quatre personnages, les commandes.
- `web/public/replays/vortex-equipe-utilisateur-victoire-s3290233078.json` : le combat gagnant publié (notes `aiNote`
  comprises), en tête de `web/public/replays/index.json`.
- Rapports précédents : `docs/reports/vortex-equipe-utilisateur.md` (builds de cette équipe et leur vérification),
  `docs/reports/vortex-stuffs.md` (méthode des stuffs Vortex), `docs/tuning-log.md` (tours 1-5 de l'IA et leurs
  vérifications), `docs/research/vortex.md` et `docs/research/vortex-audit.md` (règles).
- `.cache/tuning/r5/final/` (hors dépôt) : harnais, résultats bruts et replays de ce rapport.

## 7. Vérification (vérificateur adverse, 2026-10-06)

**Verdict** : le rapport est confirmé sur le fond. Les chiffres principaux (taux de victoire, IC, corrompus, tours,
causes d'échec), les quatre builds et le replay publié sont exacts et reproductibles. Corrigés : 20 nombres arrondis
deux fois (19 lignes) et 7 passages de texte (liste ci-dessous). Aucun changement de `src/`, `data/` ni de l'index des replays.

**Ce qui a été vérifié**

1. **Données brutes.** Un script indépendant (pas `agg.cjs`) a recalculé les mesures depuis
   `.cache/tuning/r5/final/out/F/*.jsonl` : 256 lignes, 256 graines distinctes. Aucune de ces graines ne figure parmi
   les 2 239 graines des 1 207 fichiers `.jsonl` de `.cache/`, ni parmi les 512 du vérificateur. Les tableaux suivants
   sont identiques : § 1.2 (colonnes « Ce rapport » et « Ensemble »), § 3.3 à 3.6 (phases, vagues, personnages, dégâts
   subis par source, victoires contre défaites), § 3.9 (causes d'échec) et les 88 lignes des tableaux de sorts (aux
   arrondis près, voir correction 1). La colonne du vérificateur a été recalculée depuis
   `.cache/tuning/r5/verify/out/after` (512 lignes) : 31 / 512, 9,86, 4,89 / 6,95 / 8,56, 31,58, 23,25, 3,76, 40 combats
   à *Action !* dont 31 gagnés, 12 victoires sans mort, causes 349 / 82 / 24 / 12 / 12 / 2. Les IC de Wilson
   (4,3 – 8,5 ; 2,4 – 7,5 ; 4,1 – 7,3) et z = 1,01 sont exacts.
2. **Reproductibilité par la CLI.** La commande `batch vortex --ai fast --runs 32 --master-seed 306 --workers 4` porte
   sur un bloc que le rédacteur n'avait pas contrôlé. Ses 32 combats sont identiques aux lignes du harnais, graine par
   graine : empreinte, victoire, tours, cause d'échec et corrompus par tour. Bilan du bloc : 1 victoire, 31,09 tours.
   L'arbre `tree/` est identique à `src/` et `data/` de `00efef6`.
3. **Builds.** Les quatre builds ont été recalculés à partir de `data/ai/presets.json` (presets dérivés, stuffs,
   règles de points) et des fichiers DofusDB bruts (`equipment.json`, `item-sets.json`, `effects.json`,
   `breeds.json`). Les caractéristiques finales viennent de `computeBuildStats` appliqué à un build assemblé
   indépendamment. Tout est identique, 0 écart sur les quatre personnages : objets, niveaux, panoplies, exos et
   transcendances, valeurs des lignes, nombres d'objets par panoplie, points (paliers 1 / 2 / 3 / 4 par tranche de 100),
   tableaux de caractéristiques et caractéristiques principales, 22 variantes (celles des presets de base). Chaque build
   est valide : 995 / 995 points, aucune anomalie, 12 PA / 6 PM / 6 PO, une prysmaradite, au plus un exo de chaque type.
4. **Replay et chronologies.**
   - **Graine 3290233078.** La commande `fight vortex --ai fast --seed 3290233078` donne une victoire au tour 42, sans
     mort, empreinte 1635433083. Le résultat est le même avec le fichier d'équipe et avec `--team` explicite.
   - **Replay régénéré** (`--replay-dir` hors du dépôt). Ses 19 118 événements et sa carte sont identiques au fichier
     publié ; seuls le titre et `createdAt` diffèrent.
   - **Visualiseur.** `parseReplay` et le réducteur de `src/replay` acceptent les 4 entrées de `index.json`, sans
     événement rejeté. Dans le replay publié, le Vortex finit à 0 PV.
   - **Chronologie du § 3.7.** Elle a été relue dans les événements : kills, heures, corruptions, tours pacifiés,
     notes de plan et de contrôle, PV du Vortex (15 000 / 12 256 / 7 490 / 1 136) et bilan par personnage. Tout
     concorde.
   - **Graine 860249307 (§ 3.8).** Victoire au tour 42, sans mort, empreinte 3820919414 (identique au harnais),
     11 heures, Vortex à 19 500 PV, phase 2 de 7 tours. La chronologie concorde.
5. **Commandes et tests.** Les commandes du § 4 ont été lancées et fonctionnent :
   - `fight` avec `--replay-dir`, avec `--replay none --json` et avec `--team` ;
   - `batch` ;
   - `optimize --dry-run`, qui annonce ≈ 2,2 h à 4 workers ;
   - `presets --class cra`.

   `npx tsc --noEmit` est vert, et `npx vitest run tests/ai-* tests/vortex-*` donne 335 tests réussis et 1 ignoré.
6. **Règles, IA et sources citées.** Les énoncés suivants concordent avec le code et les données :
   - probabilités de `VORTEX_UNCERTAIN` (§ 5.1) ;
   - composition des vagues (événements `wave`) ;
   - mode `fast` : largeur 3, 120 nœuds ;
   - définitions de `vortexFailReason` ;
   - coûts et portées des sorts cités ;
   - origine des immobilisations : toutes viennent de *Retraite Anticipée*.

   Les chiffres repris de `vortex-equipe-utilisateur.md` et de `docs/tuning-log.md` (§ 1.1, 2.5, 5.3, 5.4) concordent
   aussi, à un signe près (correction 7).

**Corrections apportées**

1. **Doubles arrondis.** 20 nombres, sur 19 lignes, étaient arrondis deux fois (à 2 décimales, puis à 1). Ils se trouvaient dans les
   tableaux « Sorts employés » et dans les trois premiers éléments des tableaux par phase. Exemples : *Vacarme*
   9,2 → 9,1 ; *Carreaux Destructeurs* du Crâ B 16,4 → 16,5 ; *Mot Galvanisant* en vague 1 4,0 → 3,9 ; cible
   prioritaire en phase 2 0,3 → 0,4. Ces tableaux ont été régénérés par `mkreport.cjs` à partir d'agrégats non
   arrondis. Les valeurs du JSON, à 2 décimales, étaient justes.
2. **§ 1.2, *Pacifiste*.** Le « 27 % » du vérificateur est une moyenne des parts par combat. Le « 26 % » de ce rapport
   est une part de tous les tours. Les deux définitions sont maintenant données dans les trois colonnes.
3. **§ 1.1.** Le Vortex est achevé 6 à 12 tours après *Action !* dans ce rapport, et non 5 à 12. Sur les 768 combats,
   l'écart va de 4 à 19 tours.
4. **§ 3.3 et 3.4.** La vague 1 est entièrement corrompue au tour 12 dans 99,2 % des combats (254 / 256), et non
   99,6 %. Le chiffre de 99,6 % est celui de la fin du combat ; il remplace « 100 % » dans le tableau du § 3.4.
5. **§ 3.4, paragraphe.** Le texte mêlait le tour moyen des corruptions et le délai jusqu'à la corruption complète
   d'une vague. Par exemple, la vague 3 n'est pas réglée en ≈ 9 tours : il en faut 11,9 quand elle l'est. Le paragraphe
   a été réécrit.
6. **§ 3.3, phase 2.** Les 6 combats arrivés à *Action !* sans victoire atteignent tous la limite de 60 tours. Aucun ne
   s'arrête par la mort de l'équipe.
7. **§ 2.5.** Le Crâ B défensif compté contre deux Crâs Terre équilibrés donne −0,04 ± 0,60 corrompu. Le +0,04 du texte
   était l'écart vu de l'autre bras.
8. **§ 3.9.** La définition de la submersion est complétée : l'équipe meurt avant le 26ᵉ tour du Vortex.

**Chiffres finaux (inchangés)**

| Échantillon | Victoires (IC 95 % Wilson) |
|---|---|
| Vérification du tour 5 (titre) | 31 / 512 = 6,1 % [4,3 – 8,5 %] |
| Ce rapport | 11 / 256 = 4,3 % [2,4 – 7,5 %] |
| Ensemble | 42 / 768 = 5,5 % [4,1 – 7,3 %] |

Sur les 256 combats de ce rapport : 9,73 corrompus sur 19 (9,82 sur les 768), 31,3 tours survécus, premier mort au
tour 23,1, 17 combats à *Action !* dont 11 gagnés.
