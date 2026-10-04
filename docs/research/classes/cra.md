# Crâ — analyse complète pour DofusSimu (breed 9)

> Archer à distance. Données : API DofusDB (fichiers du jeu, mise à jour du 23/06/2026) — `https://api.dofusdb.fr/breeds/9`,
> `https://api.dofusdb.fr/spell-variants?breedId=9`, `spells`, `spell-levels`, `spell-states`, `monsters` (balises 8347, 8348).
> Cache brut : `.cache/classes/csps/`. Les rôles officiels (breedRoles) : **Dommages distance (10/10)**, **Entrave (8/10)**
> (« retire des PM, des PA, de la portée et repousse »), **Boost (8/10)** (« augmente critiques, dommages et portée »), Placement (5/10), Invocation (2/10).
> (Correspondance des `roleId` DofusDB déduite des descriptions : 1 Entrave, 2 Tank, 3 Protection (INCERTAIN), 4 Soin, 5 Dommages, 6 Placement, 7 Invocation, 8 Boost.)
> Coût des caractéristiques (statsPointsFor*) : Force/Intelligence/Chance/Agilité = 1 point de capital par point jusqu'à 100, puis 2, 3, 4 points aux paliers 100/200/300 ; Vitalité 1 pour 1 ; Sagesse 3 points pour 1.

## 1. Vue d'ensemble

- **Profil** : DPS distance (portées 6–12 modifiables), très bon en **zone Feu** (Flèche Explosive, Barrage, Détonante,
  Enflammées, Fulminante) et en **mono-cible Terre/Eau/Air** à rampe (Punitive, Expiation, Rédemption, Persécutrice).
- **Entrave** : retrait PM (Cinglante -2 PM, Paralysante -2 PM en carré, Boomerang -2 PM en ligne, Immobilisation vol 1 PM,
  Évasive -1 PM, Ralentissante -1 PM), retrait PA (Glacée -2 PA, Ralentissante -2 PA en cône, Paralysante -1 PA, Évasive -1 PA),
  retrait de portée (Détonante -3, Œil de Taupe -3), réduction de soins (Harcelante ×70 %, Expiation ×50 %), retrait de Puissance
  (Jugement -150), retrait de dommages fixes (Carreaux Destructeurs -60).
- **Soutien** : +Portée aux alliés (Tirs Éloignés), soin en % (Balise de Survie 7 %/tour, Flèches Amoureuses 8 % + partage),
  amplification des dégâts subis (Tir Perçant ×115 % sur la prochaine attaque + 25 % d'érosion ; Représailles ×110 % + Pesanteur),
  détection d'invisibles (Œil de Taupe, Sentinelle).
- **Mobilité** : Pas Chassé (téléport 1–2 cases en ligne, +1 PM au tour suivant), Flèche Vagabonde / Évasive / Enflammées
  (le lanceur recule), Tir de Repli (recule ou se rapproche d'un allié), Flèche Assaillante (se rapproche), Balise de Survie (échange).
- **Pas d'invocation offensive** : les deux balises sont des invocations utilitaires (comptent dans la limite d'invocations).

## 2. Mécaniques spécifiques à implémenter (moteur)

1. **Bonus de dégâts de base auto-cumulatifs (effet 293 `BOOST_SPELL_BASE_DMG`)** : de nombreux sorts se renforcent eux-mêmes.
   L'effet 293 (`diceNum` = id du sort, `value` = bonus) s'ajoute aux dégâts de base **min et max** du sort ciblé (avant les
   caractéristiques). Il est soumis au `maxStack` du sort (ex. Flèche Glacée cumul 1 → +8 non cumulable ; Immobilisation cumul 4 →
   jusqu'à +8 ; Œil pour Œil cumul 4 ; Rédemption cumul 6 → +36 ; Fulminante cumul 4 → +60). Les variantes « délai » (Punitive : +24
   au tour N+1, +32 au tour N+2 ; Expiation : +36 aux tours N+2 et N+4) sont des buffs avec `delay` puis `duration` 1.
2. **Sorts « à état » / sous-sorts** : la plupart des effets conditionnels sont modélisés par des **états silencieux**
   (ex. 6976 « Flèche Évasive (mêlée) », 7119 « Flèche Assaillante (mêlée) ») posés par un sous-sort en zone `Q1` autour de la
   cible (= le lanceur est-il au contact ?), puis lus via les masques `*E<état>` / `*e<état>` (condition sur le lanceur).
   Le moteur doit exécuter les sous-sorts **dans l'ordre des effets** et évaluer les masques au moment de l'application.
3. **Effets « info-bulle uniquement » (`forClientOnly = true`)** : l'effet affiché (ex. poussée de Flèche de Barrage, effets de la
   Balise Tactique) n'est PAS exécuté ; le vrai comportement est dans un sous-sort (souvent même nom, autre id).
4. **Poussée / dommages de poussée** : beaucoup de sorts Crâ repoussent (Recul 2, Barrage 1 en T, Dispersion 1–2 depuis le centre,
   Perforante 3, Carreaux 3, Enflammées 2, Éclatante 2, Assaillante 3, Évasive 2). Les dommages de poussée (formule DoMath) et les
   **déclencheurs « PD » (dommages de poussée subis)** sont exploités par Flèche Détonante (explosion anticipée) et Flèche Tyrannique
   (dégâts anticipés). `Tirs Puissants` donne +150 Dommages Poussée (effet 414).
5. **Recul du lanceur (1041) / avance (1042)** : le lanceur se déplace en ligne par rapport à la cible (bloqué par obstacles/entités ;
   pas de tacle). Implémenter comme une poussée appliquée au lanceur, sans dommages de collision (INCERTAIN : vérifier si un
   lanceur bloqué subit des dommages — à notre connaissance non).
6. **Balises (invocations statiques)** : `Balise Tactique` (monstre 8347, ne joue pas, 200 PV de base en `bonusCharacteristics`)
   et `Balise de Survie` (monstre 8348, **joue** — `canPlay=true`, résistances 10/15/20 % selon le grade). Le passif de la Balise
   Tactique est le sous-sort 32476 niv.1 : sur **dommages à distance ou poussée par un allié** → attire de 2 cases tout ce qui est
   en croix (taille 3, sans centre) autour d'elle ; sur **dommages de mêlée ou de poussée par un allié** → repousse de 2 cases
   (sans dommages) les entités adjacentes. Elle meurt au bout de 3 tours (effet 141 avec `delay` 3). La Balise de Survie soigne
   7 % des PV max des alliés **en ligne de vue** au début de son tour, échange de place avec le lanceur si celui-ci l'attaque en
   étant dans sa ligne de vue, et meurt au bout de 2 tours. Les deux balises peuvent être ciblées par Fulminante/Boomerang
   (rebonds) et reçoivent le bonus de Portée de Tirs Éloignés autour d'elles.
7. **Modificateurs de sorts temporaires (280/281/289/115)** : Tirs Éloignés (+3 PO min, +6 PO max sur TOUS les sorts offensifs Crâ
   et l'arme pour le tour, effet retiré en fin de tour) et Acuité Absolue (+3 PO min, **ligne de vue désactivée** (289) sur
   l'arme/les sorts, +15 % CC, 1 tour). ⚠ Dans les données, l'effet 289 d'Acuité ne vise que `diceNum = 0` (« Coup de poing » =
   l'arme) alors que la description annonce tous les sorts : **INCERTAIN**, suivre la description (tous les sorts) par défaut.
8. **Partage de dommages (1061)** : Flèches Amoureuses lie deux alliés (état 7010) qui se partagent les dommages subis et gagnent
   +100 Puissance (2 tours) ; le lien est retiré en fin de tour du Crâ (sous-sort 32619 niv.2, déclencheur TE).
9. **Rebonds** : Flèche Fulminante rebondit (sous-sort 2160 « limitation globale ») sur l'ennemi le plus proche dans un cercle de
   2 cases non encore touché (états 3551/570), +15 dégâts de base par cible touchée (cumul max 4). Flèche Boomerang relie la
   cible initiale, la nouvelle cible et (fin de tour) le lanceur s'ils sont **alignés** (ligne `l` depuis le lanceur).
10. **Sentinelle** : posture 2 tours (+20 % dommages distance, +10 PO, révèle les invisibles en LdV) dont les bonus diminuent
    de 2 % et 1 PO **par PM utilisé** (déclencheur `CCMPARR`, INCERTAIN). Cumul max 10 sur les malus.
11. **Rampe Rédemption** : passif (sous-sort 32462 niv.1) qui ajoute +6 dégâts de base (cumul 6) à chaque retrait de PA/PM réussi
    par le lanceur (déclencheurs `CAPAS|CMPAS`), remis à zéro à l'utilisation (effet 1406). INCERTAIN : comment le passif est
    posé (probablement en début de combat quand le sort est équipé).
12. **Dégâts sur les cibles avec bouclier** : masques `pb` / `PB` (INCERTAIN : interprétés « sans / avec bouclier ») — Flèche
    d'Abolition double ses dégâts (9–11 → 18–22) et Flèche Perforante passe de 38–42 à 44–48 contre une cible ayant du bouclier.


## 3. Fiches détaillées des 44 sorts (22 paires de variantes)

Légende : valeurs au **grade maximal accessible au niveau 200** (données DofusDB/fichiers du jeu, juin 2026). « CC » = coup critique. `[id]` = identifiant d’effet (ActionId) pour le moteur. Les sous-sorts (effets « lance le sort X ») sont développés en retrait. Les effets marqués *info-bulle uniquement* (`forClientOnly`) décrivent un comportement exécuté côté serveur par l’invocation/le passif : ils ne doivent pas être appliqués tels quels.

### 3.0 Tableau récapitulatif (grade max au niveau 200)

| Paire | Sort (id) | Base/Var. | Niv. | PA | PO | Ligne/LdV | Relance | Lancers | CC | Dégâts/soins principaux (normal) | Rôle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Flèche Glacée (32435) | base | 1 | 3 | 1–7+ | /LdV | — | 3/t 2/c | 10% | 21–24 Eau | damage, single-target, ap-removal |
| 1 | Flèche Harcelante (32708) | var. | 100 | 3 | 1–10 | /sans LdV | — | 3/t 1/c | 10% | 17–19 Air | damage, poison, heal-reduction |
| 2 | Flèche de Barrage (32443) | base | 1 | 3 | 1–7+ | L/LdV | — | 2/t | 10% | 24–27 Feu | damage, aoe, push |
| 2 | Carreaux Destructeurs (32459) | var. | 105 | 4 | 1–3 | L/LdV | — | 2/t | 15% | 38–42 Terre | damage, aoe, push |
| 3 | Flèche Vagabonde (32455) | base | 1 | 3 | 1–8+ | LD/LdV | — | 2/t | 10% | 27–30 Terre | damage, single-target, escape |
| 3 | Flèche Évasive (32531) | var. | 110 | 3 | 1–7+ | /LdV | — | 2/t 1/c | 10% | 26–29 Eau | damage, ap-removal, mp-removal |
| 4 | Flèche de Recul (32426) | base | 1 | 3 | 1–6+ | /LdV | — | 3/t 2/c | 10% | 25–28 Air | damage, single-target, push |
| 4 | Flèche Éclatante (32449) | var. | 95 | 3 | 3–7+ | /LdV | — | 1/t | 15% | 22–25 vol Feu | damage, aoe, lifesteal |
| 5 | Pas Chassé (32464) | base | 5 | 2 | 1–2 | L/LdV | 2 | — | 0% | — | mobility, escape |
| 5 | Balise Tactique (32467) | var. | 115 | 1 | 1–8+ | /LdV | 2 | — | 0% | — | summon, placement, buff |
| 6 | Tirs Éloignés (32465) | base | 10 | 1 | 0–0 | /sans LdV | 2 | — | 0% | — | buff, range |
| 6 | Tir Perçant (32471) | var. | 120 | 1 | 1–6+ | /LdV | — | 2/t 1/c | 0% | — | debuff, damage-amp, erosion |
| 7 | Flèche Détonante (32444) | base | 15 | 2 | 1–6+ | /LdV | — | 3/t 2/c | 5% | 14–17 Feu | damage, aoe, range-removal |
| 7 | Flèche Ralentissante (32439) | var. | 125 | 4 | 1–6+ | L/LdV | — | 1/t | 20% | 32–34 Eau | damage, aoe, ap-removal |
| 8 | Flèche d'Abolition (32453) | base | 20 | 2 | 3–7+ | /LdV | — | 3/t | 5% | 9–11 vol Terre, 18–22 vol Terre | damage, lifesteal, aoe |
| 8 | Flèche Persécutrice (32433) | var. | 130 | 4 | 3–9+ | /LdV | — | 2/t 1/c | 15% | 34–38 vol Air, 34–38 Air | damage, lifesteal, delayed |
| 9 | Flèche Cinglante (32427) | base | 25 | 2 | 1–7+ | /LdV | — | 3/t 2/c | 5% | 15–18 Air | damage, mp-removal, single-target |
| 9 | Flèche Assaillante (32458) | var. | 135 | 3 | 1–7 | /LdV | — | 2/t | 10% | 23–26 Terre | damage, buff, push |
| 10 | Flèche d'Immobilisation (32436) | base | 30 | 2 | 1–7+ | /LdV | — | 4/t 2/c | 5% | 11–13 Eau | damage, mp-removal, ramp |
| 10 | Flèche Tyrannique (32448) | var. | 140 | 4 | 2–8+ | /LdV | — | 2/t | 15% | 28–32 Feu, 20–22 Feu | damage, poison, single-target |
| 11 | Tirs Puissants (32466) | base | 35 | 1 | 0–0 | /sans LdV | 2 | — | 5% | — | buff, self-buff |
| 11 | Flèches Amoureuses (32618) | var. | 145 | 3 | 0–8+ | LD/LdV | — | 2/t 1/c | 10% | — | heal, support, damage-share |
| 12 | Flèche de Dispersion (32428) | base | 40 | 3 | 2–6+ | /LdV | — | 1/t | 15% | 21–24 Air | damage, aoe, push |
| 12 | Flèches Enflammées (32447) | var. | 150 | 4 | 1–7 | L/LdV | — | 2/t | 15% | 34–38 Feu | damage, aoe, push |
| 13 | Flèche Explosive (32445) | base | 45 | 4 | 4–7+ | /LdV | — | 1/t | 20% | 30–34 Feu | damage, aoe |
| 13 | Flèche Massacrante (32457) | var. | 155 | 4 | 2–7+ | L/LdV | — | 2/t | 15% | 25–29 Terre | damage, aoe, ramp |
| 14 | Œil de Taupe (32437) | base | 50 | 3 | 3–6+ | /LdV | — | 1/t | 15% | 19–22 vol Eau | damage, aoe, lifesteal |
| 14 | Pluie de Flèches (32431) | var. | 160 | 3 | 0–6+ | /LdV | — | 1/t | 15% | 21–23 Air | damage, aoe, dodge-reduction |
| 15 | Œil pour Œil (32454) | base | 55 | 3 | 0–5+ | /LdV | — | 1/t | 15% | 27–30 vol Terre | damage, aoe, lifesteal |
| 15 | Flèche Paralysante (32441) | var. | 165 | 4 | 3–6+ | /LdV | — | 1/t | 20% | 30–34 Eau | damage, aoe, ap-removal |
| 16 | Balise de Survie (32474) | base | 60 | 2 | 1–4 | /LdV | 3 | — | 0% | — | summon, heal, support |
| 16 | Représailles (32472) | var. | 170 | 3 | 3–6+ | /LdV | 3 | — | 25% | — | damage, aoe, damage-amp |
| 17 | Tir de Repli (32470) | base | 65 | 1 | 2–8+ | LD/LdV | — | 3/t 2/c | 0% | — | mobility, buff, escape |
| 17 | Vendetta (32473) | var. | 175 | 2 | 1–6+ | /sans LdV | — | 1/t | 0% | — | trap, damage, pull |
| 18 | Flèche Punitive (32456) | base | 70 | 4 | 4–10+ | /LdV | — | 1/t | 20% | 30–34 Terre | damage, single-target, erosion |
| 18 | Flèche du Jugement (32460) | var. | 180 | 4 | 3–9+ | /LdV | — | 2/t 1/c | 20% | 25–27 Terre | damage, single-target, debuff |
| 19 | Flèche d'Expiation (32438) | base | 75 | 4 | 6–12+ | /LdV | 2 | — | 25% | 35–37 Eau | damage, single-target, heal-reduction |
| 19 | Flèche de Rédemption (32442) | var. | 185 | 4 | 4–9+ | /LdV | — | 2/t | 15% | 26–29 vol Eau | damage, lifesteal, ramp |
| 20 | Flèche Perforante (32429) | base | 80 | 4 | 3–9+ | L/LdV | — | 1/t | 20% | 38–42 Air, 44–48 Air | damage, aoe, push |
| 20 | Flèche Boomerang (32432) | var. | 190 | 3 | 0–7+ | /LdV | — | 2/t 1/c | 10% | 26–29 Air, 26–29 vol Air | damage, mp-removal, lifesteal |
| 21 | Flèche Dévorante (32446) | base | 85 | 3 | 0–6+ | /LdV | — | 2/t | 10% | 11–13 vol Feu, 23–27 vol Feu, 34–38 vol Feu, 34–38 Feu | damage, lifesteal, ramp |
| 21 | Flèche Fulminante (32450) | var. | 195 | 4 | 1–6+ | /LdV | — | 1/t | 20% | 26–29 Feu | damage, aoe, bounce |
| 22 | Acuité Absolue (32469) | base | 90 | 2 | 0–0 | /sans LdV | 4 | — | 0% | — | buff, crit, no-los |
| 22 | Sentinelle (32475) | var. | 200 | 2 | 0–0 | /sans LdV | 5 | — | 0% | — | buff, range, detection |


### Paire 1 — Flèche Glacée / Flèche Harcelante

#### Flèche Glacée (`32435`) — sort de base (obtenu niv. 1)

> Retire des PA et occasionne des dommages Eau. Les dommages du sort sont augmentés après son utilisation.

- Caractéristiques (g3) : **3 PA** · portée 1–7 (modifiable) · ligne de vue requise · cible requise (case occupée) · CC 10% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–5, 12–14 Eau ; g2 (niv. 67) : 3 PA, po 1–6, 16–19 Eau ; g3 (niv. 133) : 3 PA, po 1–7, 21–24 Eau
- Effets :
  - **Retire 2 PA (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1079]`
  - **21 à 24 dommages Eau (CC : 25 à 29)** → cible (alliée ou ennemie)  `[96]`
  - **Flèche Glacée : +8 dégâts de base** → lanceur ; 3 tour(s)  `[293]`
- **Analyse / rôle tactique** : Sort Eau de base (3 PA, 3×/tour, 2×/cible) : -2 PA esquivable puis 21–24 Eau ; chaque lancer donne +8 dégâts de base au sort pendant 3 tours (cumul 1 : bonus non cumulable mais rafraîchi). Excellent retrait de PA à distance sur une cible dangereuse avant son tour ; à spammer 2× par cible (2e lancer à 29–32).

#### Flèche Harcelante (`32708`) — variante (obtenu niv. 100)

> Réduit les soins reçus par la cible et lui applique un poison Air de début de tour.

- Caractéristiques (g2) : **3 PA** · portée 1–10 (non modifiable) · sans ligne de vue · CC 10% · 3×/tour · 1×/cible · cumul max 1
- Grades : g1 (niv. 100) : 3 PA, po 1–8, 13–15 Air ; g2 (niv. 167) : 3 PA, po 1–10, 17–19 Air
- Effets :
  - **Soins reçus x70%** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : quand la cible est soignée  `[1159]`
  - **17 à 19 dommages Air (CC : 20 à 23)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : début de tour du porteur  `[98]`
- **Analyse / rôle tactique** : Variante Air sans ligne de vue (portée 10 non modifiable) : pose un poison Air 17–19 au début des 2 prochains tours de la cible (déclencheur TB, 2 tours) et réduit ses soins reçus à ×70 % (1 tour). 1×/cible, 3×/tour : idéal contre les soigneurs/boss régénérants et pour toucher derrière les obstacles.


### Paire 2 — Flèche de Barrage / Carreaux Destructeurs

#### Flèche de Barrage (`32443`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Feu aux ennemis et repousse les cibles en zone.

- Caractéristiques (g3) : **3 PA** · portée 1–7 (modifiable) · en ligne uniquement · ligne de vue requise · CC 10% · 2×/tour
- Grades : g1 (niv. 1) : 3 PA, po 1–5, 14–16 Feu ; g2 (niv. 68) : 3 PA, po 1–6, 19–21 Feu ; g3 (niv. 134) : 3 PA, po 1–7, 24–27 Feu
- Effets :
  - **24 à 27 dommages Feu (CC : 29 à 32)** → ennemis dans la zone ; zone ligne perpendiculaire (barre en T) taille 2  `[99]`
  - **le lanceur lance le sous-sort « Flèche de Barrage » (32463, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone ligne perpendiculaire (barre en T) taille 2  `[1160]`
    - ↳ sous-sort 32463 « Flèche de Barrage » niv.1 :
      - **Repousse la cible de 1 case(s)** → cible (alliée ou ennemie)  `[5]`
  - **Repousse la cible de 1 case(s)** → tous (alliés+ennemis) dans la zone ; zone ligne perpendiculaire (barre en T) taille 2, *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
- **Analyse / rôle tactique** : Feu 3 PA en ligne, zone barre perpendiculaire de 2 (5 cases) : 24–27 Feu aux ennemis et repousse de 1 case toutes les cibles de la zone (alliés compris). 2×/tour. Bon nettoyage de lignes d'ennemis et déclencheur de dommages de poussée (Détonante/Tyrannique).

#### Carreaux Destructeurs (`32459`) — variante (obtenu niv. 105)

> Occasionne des dommages Terre et retire des dommages aux ennemis et repousse les cibles en zone. Les dommages de zone ne sont pas dégressifs.

- Caractéristiques (g2) : **4 PA** · portée 1–3 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 15% · 2×/tour · cumul max 1
- Grades : g1 (niv. 105) : 4 PA, po 1–3, 31–34 Terre ; g2 (niv. 172) : 4 PA, po 1–3, 38–42 Terre
- Effets :
  - **38 à 42 dommages Terre (CC : 46 à 50)** → ennemis dans la zone ; zone fourche taille 2  `[97]`
  - **-60 Dommages** → ennemis dans la zone ; zone fourche taille 2, 1 tour(s)  `[145]`
  - **Repousse la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone ; zone fourche taille 2  `[5]`
- **Analyse / rôle tactique** : Variante Terre de mêlée-courte portée (1–3 en ligne) : 38–42 Terre non dégressifs en fourche, -60 dommages fixes aux ennemis (1 tour) et repousse de 3 cases. Pour un Crâ Terre qui se fait coller ; retire beaucoup de dégâts à un groupe au contact.


### Paire 3 — Flèche Vagabonde / Flèche Évasive

#### Flèche Vagabonde (`32455`) — sort de base (obtenu niv. 1)

> Éloigne le lanceur de la cible et occasionne des dommages Terre aux ennemis.

- Caractéristiques (g3) : **3 PA** · portée 1–8 (modifiable) · en ligne ou diagonale · ligne de vue requise · cible requise (case occupée) · CC 10% · 2×/tour
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 16–18 Terre ; g2 (niv. 69) : 3 PA, po 1–7, 21–23 Terre ; g3 (niv. 136) : 3 PA, po 1–8, 27–30 Terre
- Effets :
  - **Le lanceur recule de 3 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie)  `[1041]`
  - **27 à 30 dommages Terre (CC : 32 à 36)** → cible ennemie  `[97]`
- **Analyse / rôle tactique** : Terre 3 PA en ligne/diagonale, 27–30 Terre, le Crâ recule de 3 cases (s'éloigne de la cible). Outil d'évasion gratuit (pas de tacle). 2×/tour.

#### Flèche Évasive (`32531`) — variante (obtenu niv. 110)

> Applique des effets selon la position du lanceur par rapport à la cible et occasionne des dommages Eau aux ennemis : • Éloigne le lanceur de la cible et retire des PM aux ennemis s'il est en mêlée. • Repousse la cible et retire des PA aux ennemis si le lanceur est à distance.

- Caractéristiques (g2) : **3 PA** · portée 1–7 (modifiable) · ligne de vue requise · CC 10% · 2×/tour · 1×/cible
- Grades : g1 (niv. 110) : 3 PA, po 1–5, 21–23 Eau ; g2 (niv. 177) : 3 PA, po 1–7, 26–29 Eau
- Effets :
  - **Le lanceur recule de 2 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1041]`
  - **Retire 1 PM (esquivable)** → cible ennemie ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1080]`
  - **Repousse la cible de 2 case(s)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
  - **Retire 1 PA (esquivable)** → cible ennemie ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1079]`
  - **le lanceur lance le sous-sort « Flèche Évasive » (32655, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 32655 « Flèche Évasive » niv.1 :
      - **Applique l'état « Flèche Évasive (mêlée) » (6976)** → lanceur (s’il est dans la zone) ; zone croix sans centre taille 1, 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Flèche Évasive » (32655, niv. 2)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 32655 « Flèche Évasive » niv.2 :
      - **Le lanceur recule de 2 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie) — si lanceur a l'état « Flèche Évasive (mêlée) » (6976)  `[1041]`
      - **Retire 1 PM (esquivable)** → cible ennemie — si lanceur a l'état « Flèche Évasive (mêlée) » (6976) ; 1 tour(s), non désenvoûtable  `[1080]`
      - **Repousse la cible de 2 case(s)** → cible (alliée ou ennemie) — si lanceur n'a PAS l'état « Flèche Évasive (mêlée) » (6976)  `[5]`
      - **Retire 1 PA (esquivable)** → cible ennemie — si lanceur n'a PAS l'état « Flèche Évasive (mêlée) » (6976) ; 1 tour(s), non désenvoûtable  `[1079]`
      - **Retire l'état « Flèche Évasive (mêlée) » (6976)** → lanceur  `[951]`
  - **26 à 29 dommages Eau (CC : 31 à 35)** → cible ennemie  `[96]`
- **Analyse / rôle tactique** : Variante Eau 3 PA : si le Crâ est au contact → il recule de 2 et retire 1 PM ; à distance → repousse la cible de 2 et retire 1 PA. 26–29 Eau. Très bon outil d'entrave/kite polyvalent (1×/cible).
- *Notes moteur* : Les effets affichés sont `forClientOnly` ; la logique réelle est dans le sous-sort 32655 (états 6976).


### Paire 4 — Flèche de Recul / Flèche Éclatante

#### Flèche de Recul (`32426`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Air aux ennemis et repousse la cible.

- Caractéristiques (g3) : **3 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible
- Grades : g1 (niv. 1) : 3 PA, po 1–4, 15–17 Air ; g2 (niv. 66) : 3 PA, po 1–5, 20–22 Air ; g3 (niv. 132) : 3 PA, po 1–6, 25–28 Air
- Effets :
  - **25 à 28 dommages Air (CC : 30 à 34)** → cible ennemie  `[98]`
  - **Repousse la cible de 2 case(s)** → cible (alliée ou ennemie)  `[5]`
- **Analyse / rôle tactique** : Air 3 PA (3×/tour, 2×/cible) : 25–28 Air + repousse de 2. Bon ratio dégâts/PA en Air, déclenche des dommages de poussée contre un obstacle.

#### Flèche Éclatante (`32449`) — variante (obtenu niv. 95)

> Vole de la vie dans l'élément Feu aux ennemis et repousse les cibles depuis le centre en zone.

- Caractéristiques (g2) : **3 PA** · portée 3–7 (modifiable) · ligne de vue requise · CC 15% · 1×/tour
- Grades : g1 (niv. 95) : 3 PA, po 3–5, 18–20 vol Feu ; g2 (niv. 162) : 3 PA, po 3–7, 22–25 vol Feu
- Effets :
  - **22 à 25 vol Feu (CC : 26 à 30)** → ennemis dans la zone ; zone croix diagonale taille 1  `[94]`
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix diagonale (taille min) taille 1  `[5]`
- **Analyse / rôle tactique** : Variante Feu en vol de vie (po 3–7) : 22–25 vol Feu en croix diagonale (taille 1) et repousse de 2 depuis le centre. 1×/tour. Soin personnel + dispersion des ennemis qui entourent un allié.


### Paire 5 — Pas Chassé / Balise Tactique

#### Pas Chassé (`32464`) — sort de base (obtenu niv. 5)

> Téléporte le lanceur sur la case ciblée. Augmente les PM du lanceur au tour suivant.

- Caractéristiques (g3) : **2 PA** · portée 1–2 (non modifiable) · en ligne uniquement · ligne de vue requise · case libre requise · CC 0% · relance 2 t. · condition : lanceur n’a pas l’état « Pesanteur » (7)
- Grades : g1 (niv. 5) : 2 PA, po 1–1 ; g2 (niv. 72) : 2 PA, po 1–1 ; g3 (niv. 139) : 2 PA, po 1–2
- Effets :
  - **Téléporte le lanceur sur la case ciblée** → cible (alliée ou ennemie)  `[4]`
  - **1 PM** → lanceur ; 1 tour(s), délai 1 t.  `[128]`
- **Analyse / rôle tactique** : Téléportation 2 PA sur une case libre à 1–2 cases en ligne (relance 2), +1 PM au tour suivant. Interdit sous Pesanteur (état 7). Sert à sortir d'un tacle (téléport = pas de jet de tacle).

#### Balise Tactique (`32467`) — variante (obtenu niv. 115)

> Invoque une Balise statique qui peut appliquer des effets en zone autour d'elle selon ce qu'elle subit : • Elle attire les cibles si un allié lui occasionne des dommages à distance ou la pousse. • Elle pousse les cibles si un allié lui occasionne des dommages en mêlée ou de poussée.  La balise est détruite 3 tours après son invocation.  Augmente également la Puissance du lanceur pour chaque ennemi dans la ligne de vue de la case ciblée.

- Caractéristiques (g2) : **1 PA** · portée 1–8 (modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 2 t. · cumul max 5
- Grades : g1 (niv. 115) : 1 PA, po 1–6 ; g2 (niv. 182) : 1 PA, po 1–8
- Effets :
  - **Invoque « Balise Tactique » (monstre 8347, grade 2)** → cible (alliée ou ennemie)  `[181]`
  - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 3, *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **Repousse de 2 case(s) sans dommages de poussée** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 1, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1103]`
  - **Tue la cible** → alliés (dont lanceur si dans la zone), invocations du lanceur, U (INCERTAIN) ; délai 3 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[141]`
  - **+40 Puissance** → lanceur ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **le lanceur lance le sous-sort « Balise Tactique » (32476, niv. 9)** → ennemis dans la zone ; zone cercle illimitée (63) (min 1), si en LdV du centre  `[1160]`
    - ↳ sous-sort 32476 « Balise Tactique » niv.9 :
      - **+40 Puissance** → lanceur ; 2 tour(s)  `[138]`
- **Analyse / rôle tactique** : Variante 1 PA (relance 2, po 1–8) : invoque une Balise Tactique statique 3 tours ; le Crâ gagne +40 Puissance (2 tours) par ennemi en ligne de vue de la case ciblée. Les alliés qui frappent la balise à distance (ou la poussent) attirent de 2 cases tout ce qui est en croix autour ; en mêlée/poussée, elle repousse les adjacents. Outil de regroupement avant un sort de zone (Explosive) et gros buff de Puissance en début de combat.
- *Notes moteur* : Effets de la balise = passif sous-sort 32476 niv.1 (forClientOnly dans le sort). Le buff +40/ennemi est le sous-sort 32476 niv.9 lancé sur chaque ennemi (zone C63, masque A) — INCERTAIN : contrainte de LdV portée par le serveur.


### Paire 6 — Tirs Éloignés / Tir Perçant

#### Tirs Éloignés (`32465`) — sort de base (obtenu niv. 10)

> Augmente les portées minimale et maximale de tous les sorts offensifs Crâ du lanceur. Augmente également la Portée des alliés (hors Crâs) en zone autour du lanceur et de ses Balises.

- Caractéristiques (g3) : **1 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 2 t. · cumul max 1
- Grades : g1 (niv. 10) : 1 PA, po 0–0 ; g2 (niv. 77) : 1 PA, po 0–0 ; g3 (niv. 144) : 1 PA, po 0–0
- Effets :
  - **Coup de poing : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[280]`
  - **Coup de poing : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[281]`
  - **Flèche Vagabonde : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Vagabonde : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche de Barrage : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche de Barrage : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Glacée : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Glacée : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche de Recul : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche de Recul : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Détonante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Détonante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche d'Abolition : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche d'Abolition : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Cinglante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Cinglante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche d'Immobilisation : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche d'Immobilisation : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche de Dispersion : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche de Dispersion : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Explosive : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Explosive : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Œil de Taupe : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Œil de Taupe : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Œil pour Œil : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Œil pour Œil : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Punitive : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Punitive : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche d'Expiation : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche d'Expiation : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Perforante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Perforante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Dévorante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Dévorante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Évasive : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Évasive : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Carreaux Destructeurs : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Carreaux Destructeurs : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Harcelante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Harcelante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Éclatante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Éclatante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Ralentissante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Ralentissante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Persécutrice : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Persécutrice : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Assaillante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Assaillante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Tyrannique : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Tyrannique : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèches Enflammées : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèches Enflammées : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Massacrante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Massacrante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Pluie de Flèches : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Pluie de Flèches : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Paralysante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Paralysante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Représailles : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Représailles : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Vendetta : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Vendetta : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche du Jugement : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche du Jugement : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche de Rédemption : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche de Rédemption : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Boomerang : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Boomerang : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Flèche Fulminante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Fulminante : +6 Portée maximale** → lanceur ; 1 tour(s), non désenvoûtable  `[281]`
  - **Retire les effets du sort « Tirs Éloignés » (32465)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur, non désenvoûtable  `[406]`
  - **le lanceur lance le sous-sort « Tirs Éloignés » (32558, niv. 2)** → lanceur ; zone tout le terrain (vivants)  `[1160]`
    - ↳ sous-sort 32558 « Tirs Éloignés » niv.2 :
      - **3 Portée** → alliés (hors lanceur) dans la zone — si cible n'est pas de la classe 9 (INCERTAIN) ; zone cercle taille 2 (min 1), 1 tour(s)  `[117]`
  - **le lanceur lance le sous-sort « Tirs Éloignés » (32558, niv. 2)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est l’un des monstres : « Balise de Survie » (8348) / « Balise Tactique » (8347) ; zone tout le terrain (vivants)  `[1160]`
    - ↳ (sous-sort 32558 niv.2 déjà détaillé plus haut)
  - **3 Portée** → alliés (hors lanceur) dans la zone — si cible n'est pas de la classe 9 (INCERTAIN) ; zone cercle taille 2 (min 1), 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[117]`
- **Analyse / rôle tactique** : 1 PA, relance 2 : +3 PO min et +6 PO max à tous les sorts offensifs Crâ et à l'arme jusqu'à la fin du tour ; +3 PO (1 tour) aux alliés non-Crâ dans un cercle de 2 autour du Crâ et de ses balises. Indispensable pour frapper de très loin, mais la PO minimale +3 empêche de toucher au contact.

#### Tir Perçant (`32471`) — variante (obtenu niv. 120)

> Érode la cible et augmente les dommages qu'elle subit jusqu'à la prochaine attaque.

- Caractéristiques (g2) : **1 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 0% · 2×/tour · 1×/cible · cumul max 1
- Grades : g1 (niv. 120) : 1 PA, po 1–4 ; g2 (niv. 187) : 1 PA, po 1–6
- Effets :
  - **25% Érosion** → cible (alliée ou ennemie) ; 2 tour(s)  `[776]`
  - **Dommages subis x115%** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : quand la cible subit des dommages  `[1163]`
  - **Retire les effets du sort « Tir Perçant » (32471)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : quand la cible subit des dommages  `[406]`
- **Analyse / rôle tactique** : Variante 1 PA (2×/tour, 1×/cible) : 25 % d'érosion (2 tours) et ×115 % dommages subis jusqu'à la prochaine attaque reçue (le buff se retire au premier dommage). À placer juste avant la plus grosse frappe du groupe sur la cible (boss).


### Paire 7 — Flèche Détonante / Flèche Ralentissante

#### Flèche Détonante (`32444`) — sort de base (obtenu niv. 15)

> Retire de la Portée, occasionne des dommages Feu et applique l'état Flèche Détonante sur la cible : • Applique les effets sans l'état sur les ennemis en zone autour de la cible à la fin de son tour.  Les effets peuvent être déclenchés prématurément si la cible subit des dommages de poussée.

- Caractéristiques (g3) : **2 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 5% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 15) : 2 PA, po 1–4, 9–11 Feu ; g2 (niv. 82) : 2 PA, po 1–5, 11–14 Feu ; g3 (niv. 149) : 2 PA, po 1–6, 14–17 Feu
- Effets :
  - **-3 Portée** → cible (alliée ou ennemie) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[116]`
  - **le lanceur lance le sous-sort « Flèche Détonante » (32451, niv. 12)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 32451 « Flèche Détonante » niv.12 :
      - **-3 Portée** → cible (alliée ou ennemie) ; 1 tour(s)  `[116]`
  - **14 à 17 dommages Feu (CC : 18 à 21)** → cible (alliée ou ennemie)  `[99]`
  - **Applique l'état « Flèche Détonante » (656)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Flèche Détonante » (32451, niv. 9)** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : fin de tour du porteur OU dommages de poussée subis OU dommages de poussée subis (variante X, INCERTAIN)  `[1160]`
    - ↳ sous-sort 32451 « Flèche Détonante » niv.9 :
      - **le lanceur lance le sous-sort « Flèche Détonante » (32451, niv. 10)** → cible (alliée ou ennemie)  `[1160]`
        - ↳ sous-sort 32451 « Flèche Détonante » niv.10 :
          - **Retire les effets du sort « Flèche Détonante » (32444)** → cible (alliée ou ennemie)  `[406]`
          - **le lanceur lance le sous-sort « Flèche Détonante » (32451, niv. 11)** → cible ennemie ; non désenvoûtable  `[1160]`
            - ↳ sous-sort 32451 « Flèche Détonante » niv.11 :
              - **-3 Portée** → ennemis dans la zone ; zone cercle taille 2 (min 1), 1 tour(s)  `[116]`
          - **14 à 17 dommages Feu (CC : 18 à 21)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[99]`
  - **-3 Portée** → ennemis dans la zone ; zone cercle taille 2 (min 1), 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[116]`
  - **14 à 17 dommages Feu (CC : 18 à 21)** → ennemis dans la zone ; zone cercle taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[99]`
- **Analyse / rôle tactique** : Feu 2 PA (3×/tour, 2×/cible) : -3 PO et 14–17 Feu sur la cible + état « Flèche Détonante » ; à la fin du tour de la cible (ou dès qu'elle subit des dommages de poussée), explosion : -3 PO et 14–17 Feu aux ennemis en cercle 2 autour d'elle. Très bon ratio Feu/PA en groupe compact ; combo poussée → explosion immédiate.
- *Notes moteur* : Explosion = sous-sort 32451 niv.9 (déclencheurs TE|PD|XPD) puis niv.10/11 ; retire les effets du sort après explosion.

#### Flèche Ralentissante (`32439`) — variante (obtenu niv. 125)

> Retire des PA et des PM et occasionne des dommages Eau en zone.

- Caractéristiques (g2) : **4 PA** · portée 1–6 (modifiable) · en ligne uniquement · ligne de vue requise · CC 20% · 1×/tour · cumul max 1
- Grades : g1 (niv. 125) : 4 PA, po 1–4, 28–30 Eau ; g2 (niv. 192) : 4 PA, po 1–6, 32–34 Eau
- Effets :
  - **Retire 2 PA (esquivable)** → tous (alliés+ennemis) dans la zone ; zone cône taille 2, 1 tour(s), non désenvoûtable  `[1079]`
  - **Retire 1 PM (esquivable)** → tous (alliés+ennemis) dans la zone ; zone cône taille 2, 1 tour(s), non désenvoûtable  `[1080]`
  - **32 à 34 dommages Eau (CC : 38 à 41)** → tous (alliés+ennemis) dans la zone ; zone cône taille 2  `[96]`
- **Analyse / rôle tactique** : Variante Eau 4 PA en ligne, cône de 2 : -2 PA, -1 PM (esquivables) et 32–34 Eau. 1×/tour, CC 20 %. Entrave de zone sur un groupe aligné.


### Paire 8 — Flèche d'Abolition / Flèche Persécutrice

#### Flèche d'Abolition (`32453`) — sort de base (obtenu niv. 20)

> Vole de la vie dans l'élément Terre. Les dommages sont plus importants sur les cibles ayant du bouclier.  La taille de la zone est augmentée après chaque lancer pour le tour en cours.

- Caractéristiques (g3) : **2 PA** · portée 3–7 (modifiable) · ligne de vue requise · CC 5% · 3×/tour · cumul max 2
- Grades : g1 (niv. 20) : 2 PA, po 3–5, 5–7 vol Terre, 11–14 vol Terre ; g2 (niv. 87) : 2 PA, po 3–6, 7–9 vol Terre, 14–18 vol Terre ; g3 (niv. 154) : 2 PA, po 3–7, 9–11 vol Terre, 18–22 vol Terre
- Effets :
  - **9 à 11 vol Terre (CC : 12 à 14)** → cible (alliée ou ennemie) — si cible n'a PAS de bouclier (INCERTAIN: masque pb) ET si lanceur n'a PAS l'état « Flèche d'Abolition I » (7120) ET si lanceur n'a PAS l'état « Flèche d'Abolition II » (7121)  `[92]`
  - **9 à 11 vol Terre (CC : 12 à 14)** → tous (alliés+ennemis) dans la zone — si cible n'a PAS de bouclier (INCERTAIN: masque pb) ET si lanceur a l'état « Flèche d'Abolition I » (7120) ; zone croix taille 1  `[92]`
  - **9 à 11 vol Terre (CC : 12 à 14)** → tous (alliés+ennemis) dans la zone — si cible n'a PAS de bouclier (INCERTAIN: masque pb) ET si lanceur a l'état « Flèche d'Abolition II » (7121) ; zone cercle taille 2  `[92]`
  - **18 à 22 vol Terre (CC : 23 à 27)** → cible (alliée ou ennemie) — si cible a du bouclier (INCERTAIN: masque PB) ET si lanceur n'a PAS l'état « Flèche d'Abolition I » (7120) ET si lanceur n'a PAS l'état « Flèche d'Abolition II » (7121)  `[92]`
  - **18 à 22 vol Terre (CC : 23 à 27)** → tous (alliés+ennemis) dans la zone — si cible a du bouclier (INCERTAIN: masque PB) ET si lanceur a l'état « Flèche d'Abolition I » (7120) ; zone croix taille 1  `[92]`
  - **18 à 22 vol Terre (CC : 23 à 27)** → tous (alliés+ennemis) dans la zone — si cible a du bouclier (INCERTAIN: masque PB) ET si lanceur a l'état « Flèche d'Abolition II » (7121) ; zone cercle taille 2  `[92]`
  - **Applique l'état « Flèche d'Abolition I » (7120)** → lanceur — si lanceur n'a PAS l'état « Flèche d'Abolition I » (7120) ET si lanceur n'a PAS l'état « Flèche d'Abolition II » (7121) ; 1 tour(s)  `[950]`
  - **Retire l'état « Flèche d'Abolition I » (7120)** → lanceur — si lanceur a l'état « Flèche d'Abolition I » (7120)  `[951]`
  - **Applique l'état « Flèche d'Abolition II » (7121)** → lanceur — si lanceur a l'état « Flèche d'Abolition I » (7120) ; 1 tour(s)  `[950]`
  - **Retire les effets du sort « Flèche d'Abolition » (32453)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur  `[406]`
- **Analyse / rôle tactique** : Terre 2 PA (po 3–7, 3×/tour) : vol Terre 9–11 (18–22 sur cible avec bouclier) ; la zone grandit à chaque lancer du tour (cible → croix 1 → cercle 2). Bon spam Terre pas cher, excellent contre les monstres qui se boucliérisent.
- *Notes moteur* : États 7120/7121 sur le lanceur (compteur), retirés en fin de tour (406 TE).

#### Flèche Persécutrice (`32433`) — variante (obtenu niv. 130)

> Vole de la vie dans l'élément Air. Occasionne des dommages Air au tour suivant si la cible n'est pas dans la ligne de vue du lanceur.

- Caractéristiques (g2) : **4 PA** · portée 3–9 (modifiable) · ligne de vue requise · CC 15% · 2×/tour · 1×/cible · cumul max 1
- Grades : g1 (niv. 130) : 4 PA, po 3–7, 30–34 vol Air, 30–34 Air ; g2 (niv. 197) : 4 PA, po 3–9, 34–38 vol Air, 34–38 Air
- Effets :
  - **le lanceur lance le sous-sort « Flèche Persécutrice » (32615, niv. 1)** → cible (alliée ou ennemie) ; délai 1 t.  `[1160]`
    - ↳ sous-sort 32615 « Flèche Persécutrice » niv.1 :
      - **Applique l'état « Flèche Persécutrice (ligne de vue) » (6978)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
      - **la cible lance (sur elle-même) le sous-sort « Flèche Persécutrice » (32615, niv. 2)** → lanceur  `[792]`
        - ↳ sous-sort 32615 « Flèche Persécutrice » niv.2 :
          - **Retire les effets du sort « Flèche Persécutrice » (32433)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Persécutrice (ligne de vue) » (6978) ; zone cercle illimitée (63), si en LdV du centre  `[406]`
      - **Retire l'état « Flèche Persécutrice (ligne de vue) » (6978)** → cible (alliée ou ennemie)  `[951]`
  - **34 à 38 vol Air (CC : 41 à 46)** → cible (alliée ou ennemie)  `[93]`
  - **34 à 38 dommages Air (CC : 41 à 46)** → cible (alliée ou ennemie) ; délai 1 t.  `[98]`
- **Analyse / rôle tactique** : Variante Air 4 PA (po 3–9, 2×/tour, 1×/cible) : vol Air 34–38, puis au tour suivant 34–38 Air supplémentaires **si la cible n'est pas en ligne de vue** du Crâ. Gros mono-cible : tirer puis se cacher derrière un obstacle.
- *Notes moteur* : Au tour suivant : sous-sort 32615 (état 6978 puis retrait des effets si la cible est en LdV du Crâ, zone C63 onlyAffectIfInSightLine).


### Paire 9 — Flèche Cinglante / Flèche Assaillante

#### Flèche Cinglante (`32427`) — sort de base (obtenu niv. 25)

> Retire des PM et occasionne des dommages Air.

- Caractéristiques (g3) : **2 PA** · portée 1–7 (modifiable) · ligne de vue requise · CC 5% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 25) : 2 PA, po 1–5, 9–11 Air ; g2 (niv. 92) : 2 PA, po 1–6, 12–14 Air ; g3 (niv. 159) : 2 PA, po 1–7, 15–18 Air
- Effets :
  - **Retire 2 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s)  `[1080]`
  - **15 à 18 dommages Air (CC : 19 à 23)** → cible (alliée ou ennemie)  `[98]`
- **Analyse / rôle tactique** : Air 2 PA (3×/tour, 2×/cible) : -2 PM esquivables + 15–18 Air. LE sort de retrait PM du Crâ : 2 lancers = -4 PM sur une cible (avant esquive).

#### Flèche Assaillante (`32458`) — variante (obtenu niv. 135)

> Applique des effets selon la position du lanceur par rapport à la cible, occasionne des dommages Terre aux ennemis et augmente la Puissance du lanceur : • Repousse la cible si le lanceur est en mêlée. • Rapproche le lanceur vers la cible s'il est à distance.

- Caractéristiques (g1) : **3 PA** · portée 1–7 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 10% · 2×/tour · cumul max 1
- Effets :
  - **Repousse la cible de 3 case(s)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
  - **Le lanceur avance de 3 case(s) vers la cible** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1042]`
  - **le lanceur lance le sous-sort « Flèche Assaillante » (32781, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 32781 « Flèche Assaillante » niv.1 :
      - **Applique l'état « Flèche Assaillante (mêlée) » (7119)** → lanceur (s’il est dans la zone) ; zone croix sans centre taille 1, 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Flèche Assaillante » (32781, niv. 2)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 32781 « Flèche Assaillante » niv.2 :
      - **Repousse la cible de 3 case(s)** → cible (alliée ou ennemie) — si lanceur a l'état « Flèche Assaillante (mêlée) » (7119)  `[5]`
      - **Le lanceur avance de 3 case(s) vers la cible** → cible (alliée ou ennemie) — si lanceur n'a PAS l'état « Flèche Assaillante (mêlée) » (7119)  `[1042]`
      - **Retire l'état « Flèche Assaillante (mêlée) » (7119)** → lanceur  `[951]`
  - **23 à 26 dommages Terre (CC : 28 à 31)** → cible ennemie  `[97]`
  - **+150 Puissance** → lanceur ; 1 tour(s)  `[138]`
- **Analyse / rôle tactique** : Variante Terre 3 PA (2×/tour) : 23–26 Terre + **+150 Puissance pour le tour** ; au contact repousse la cible de 3, à distance le Crâ avance de 3 vers elle. À lancer en premier dans le tour pour booster tous les sorts suivants (multi-éléments).
- *Notes moteur* : Logique dans sous-sort 32781 (état 7119 = lanceur au contact).


### Paire 10 — Flèche d'Immobilisation / Flèche Tyrannique

#### Flèche d'Immobilisation (`32436`) — sort de base (obtenu niv. 30)

> Vole des PM et occasionne des dommages Eau Les dommages du sort sont augmentés après chaque lancer.

- Caractéristiques (g3) : **2 PA** · portée 1–7 (modifiable) · ligne de vue requise · cible requise (case occupée) · CC 5% · 4×/tour · 2×/cible · cumul max 4
- Grades : g1 (niv. 30) : 2 PA, po 1–5, 7–9 Eau ; g2 (niv. 97) : 2 PA, po 1–6, 9–11 Eau ; g3 (niv. 164) : 2 PA, po 1–7, 11–13 Eau
- Effets :
  - **Vole 1 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[77]`
  - **11 à 13 dommages Eau (CC : 14 à 16)** → cible (alliée ou ennemie)  `[96]`
  - **Flèche d'Immobilisation : +2 dégâts de base** → lanceur ; 3 tour(s)  `[293]`
- **Analyse / rôle tactique** : Eau 2 PA (4×/tour, 2×/cible) : vole 1 PM (esquivable) + 11–13 Eau, +2 dégâts de base par lancer (cumul 4, 3 tours). Entrave PM + spam bon marché en Eau.

#### Flèche Tyrannique (`32448`) — variante (obtenu niv. 140)

> Occasionne des dommages et applique un poison Feu de fin de tour sur la cible. Le poison est renouvelé si la cible est déplacée sous les effets du sort.  Occasionne prématurément des dommages Feu et retire les effets du sort si la cible subit des dommages de poussée.

- Caractéristiques (g1) : **4 PA** · portée 2–8 (modifiable) · ligne de vue requise · CC 15% · 2×/tour · cumul max 1
- Effets :
  - **28 à 32 dommages Feu (CC : 34 à 38)** → cible (alliée ou ennemie)  `[99]`
  - **20 à 22 dommages Feu (CC : 24 à 26)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : fin de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[99]`
  - **28 à 32 dommages Feu (CC : 34 à 38)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[99]`
  - **le lanceur lance le sous-sort « Flèche Tyrannique » (32488, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 32488 « Flèche Tyrannique » niv.1 :
      - **20 à 22 dommages Feu (CC : 24 à 26)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : fin de tour du porteur  `[99]`
      - **le lanceur lance le sous-sort « Flèche Tyrannique » (32488, niv. 1)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : quand la cible est déplacée OU téléportation (INCERTAIN) OU téléportation/portail (INCERTAIN) OU quand l'état « Porté » (8) est retiré  `[1160]`
        - ↳ (sous-sort 32488 niv.1 déjà détaillé plus haut)
      - **le lanceur lance le sous-sort « Flèche Tyrannique » (32488, niv. 2)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : dommages de poussée subis  `[1160]`
        - ↳ sous-sort 32488 « Flèche Tyrannique » niv.2 :
          - **le lanceur lance le sous-sort « Flèche Tyrannique » (32488, niv. 3)** → cible (alliée ou ennemie)  `[1160]`
            - ↳ sous-sort 32488 « Flèche Tyrannique » niv.3 :
              - **Retire les effets du sort « Flèche Tyrannique » (32488)** → cible (alliée ou ennemie)  `[406]`
              - **28 à 32 dommages Feu (CC : 34 à 38)** → cible (alliée ou ennemie)  `[99]`
- **Analyse / rôle tactique** : Variante Feu 4 PA (po 2–8, 2×/tour) : 28–32 Feu + poison Feu 20–22 à la fin du tour de la cible ; le poison est réappliqué si la cible est déplacée et, si elle subit des dommages de poussée, 28–32 Feu immédiats puis retrait du sort. Combo poussée (Recul/Barrage) = double frappe.
- *Notes moteur* : Sous-sort 32488 : niv.1 (poison TE + re-lancer sur M|TP|PT|EOFF8), niv.2/3 sur PD.


### Paire 11 — Tirs Puissants / Flèches Amoureuses

#### Tirs Puissants (`32466`) — sort de base (obtenu niv. 35)

> Sacrifie la Portée du lanceur pour augmenter sa Puissance, ses Dommages Poussée et ses Critiques.

- Caractéristiques (g3) : **1 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 5% · relance 2 t.
- Grades : g1 (niv. 35) : 1 PA, po 0–0 ; g2 (niv. 102) : 1 PA, po 0–0 ; g3 (niv. 169) : 1 PA, po 0–0
- Effets :
  - **-3 Portée** → lanceur ; 1 tour(s), non désenvoûtable  `[116]`
  - **+250 Puissance (CC : 300)** → lanceur ; 1 tour(s), non désenvoûtable  `[138]`
  - **150 Dommages Poussée (CC : 170)** → lanceur ; 1 tour(s), non désenvoûtable  `[414]`
  - **15% Critique (CC : 17)** → lanceur ; 1 tour(s), non désenvoûtable  `[115]`
- **Analyse / rôle tactique** : 1 PA, relance 2 : -3 PO, +250 Puissance (CC +300), +150 Dommages Poussée, +15 % CC pour le tour. LE buff de dégâts du Crâ ; combiné à Tirs Éloignés pour compenser la portée.

#### Flèches Amoureuses (`32618`) — variante (obtenu niv. 145)

> Soigne l'allié ciblé.  Partage également les dommages entre le combattant allié initial et un autre combattant allié en augmentant leur Puissance si le sort est lancé sur cet autre combattant.  Les soins n'affectent pas le lanceur.

- Caractéristiques (g1) : **3 PA** · portée 0–8 (modifiable) · en ligne ou diagonale · ligne de vue requise · cible requise (case occupée) · CC 10% · 2×/tour · 1×/cible · cumul max 1
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « Flèches Amoureuses » (32619, niv. 2)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur  `[792]`
    - ↳ sous-sort 32619 « Flèches Amoureuses » niv.2 :
      - **Retire l'état « Flèches Amoureuses » (7010)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèches Amoureuses » (7010) ; zone tout le terrain (vivants)  `[951]`
  - **Soin : 8% des PV max (CC : 10)** → allié ciblé (hors lanceur)  `[1109]`
  - **Partage les dommages** → lanceur (s'il est dans la zone), personnages joueurs alliés, monstres alliés (non invocations jouantes), compagnons alliés — si cible a l'état « Flèches Amoureuses » (7010) ; zone tout le terrain (vivants), actif 1 tour(s), déclencheur : quand la cible subit des dommages, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1061]`
  - **+100 Puissance** → lanceur (s'il est dans la zone), personnages joueurs alliés, monstres alliés (non invocations jouantes), compagnons alliés — si cible a l'état « Flèches Amoureuses » (7010) ; zone tout le terrain (vivants), 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **Applique l'état « Flèches Amoureuses » (7010)** → lanceur (s'il est dans la zone), personnages joueurs alliés, monstres alliés (non invocations jouantes), compagnons alliés ; 1 tour(s)  `[950]`
  - **le lanceur lance (limitation globale) le sous-sort « Flèches Amoureuses » (32619, niv. 1)** → lanceur (s'il est dans la zone), personnages joueurs alliés, monstres alliés (non invocations jouantes), compagnons alliés — si cible a l'état « Flèches Amoureuses » (7010) ; zone cercle illimitée (63) (min 1)  `[2160]`
    - ↳ sous-sort 32619 « Flèches Amoureuses » niv.1 :
      - **Partage les dommages** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèches Amoureuses » (7010) ; zone tout le terrain (vivants), actif 1 tour(s), déclencheur : quand la cible subit des dommages  `[1061]`
      - **Applique l'état « Sacrifice » (583)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèches Amoureuses » (7010) ; zone tout le terrain (vivants), 1 tour(s)  `[950]`
      - **+100 Puissance** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèches Amoureuses » (7010) ; zone tout le terrain (vivants), 2 tour(s)  `[138]`
      - **Retire l'état « Flèches Amoureuses » (7010)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèches Amoureuses » (7010) ; zone tout le terrain (vivants)  `[951]`
- **Analyse / rôle tactique** : Variante soin 3 PA (po 0–8 en ligne/diagonale, 2×/tour, 1×/cible) : soigne 8 % PV max l'allié (pas le lanceur) et lui pose l'état Flèches Amoureuses ; lancé ensuite sur un second allié, les deux se **partagent les dommages** et gagnent +100 Puissance (2 tours). Utile pour protéger un tank fragile ou répartir les dégâts d'un boss mono-cible.


### Paire 12 — Flèche de Dispersion / Flèches Enflammées

#### Flèche de Dispersion (`32428`) — sort de base (obtenu niv. 40)

> Occasionne des dommages Air aux ennemis et repousse les cibles depuis le centre en zone. La poussée est plus importante aux extrémités de la zone.

- Caractéristiques (g3) : **3 PA** · portée 2–6 (modifiable) · ligne de vue requise · CC 15% · 1×/tour
- Grades : g1 (niv. 40) : 3 PA, po 2–4, 13–15 Air ; g2 (niv. 107) : 3 PA, po 2–5, 17–19 Air ; g3 (niv. 174) : 3 PA, po 2–6, 21–24 Air
- Effets :
  - **21 à 24 dommages Air (CC : 25 à 29)** → ennemis dans la zone ; zone croix taille 2  `[98]`
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 2 (min 2)  `[5]`
  - **Repousse la cible de 1 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 1  `[5]`
- **Analyse / rôle tactique** : Air 3 PA (po 2–6, 1×/tour) : 21–24 Air en croix 2 aux ennemis, repousse depuis le centre (1 case au centre-adjacent, 2 aux extrémités). Dégagement d'un allié encerclé.

#### Flèches Enflammées (`32447`) — variante (obtenu niv. 150)

> Éloigne le lanceur des cibles, occasionne des dommages Feu aux ennemis et repousse les cibles en zone.

- Caractéristiques (g1) : **4 PA** · portée 1–7 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 15% · 2×/tour
- Effets :
  - **Le lanceur recule de 1 case(s) (s’éloigne de la cible)** → tous (alliés+ennemis) dans la zone ; zone ligne taille 4  `[1041]`
  - **34 à 38 dommages Feu (CC : 41 à 46)** → ennemis dans la zone ; zone ligne taille 4  `[99]`
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone ligne taille 4  `[5]`
- **Analyse / rôle tactique** : Variante Feu 4 PA en ligne (2×/tour) : 34–38 Feu en ligne de 4, repousse de 2 les cibles et le Crâ recule d'1 case. Fort sort de zone en couloir.


### Paire 13 — Flèche Explosive / Flèche Massacrante

#### Flèche Explosive (`32445`) — sort de base (obtenu niv. 45)

> Occasionne des dommages Feu en zone.

- Caractéristiques (g3) : **4 PA** · portée 4–7 (modifiable) · ligne de vue requise · CC 20% · 1×/tour
- Grades : g1 (niv. 45) : 4 PA, po 4–5, 19–21 Feu ; g2 (niv. 112) : 4 PA, po 4–6, 25–28 Feu ; g3 (niv. 179) : 4 PA, po 4–7, 30–34 Feu
- Effets :
  - **30 à 34 dommages Feu (CC : 36 à 41)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 3  `[99]`
- **Analyse / rôle tactique** : Feu 4 PA (po 4–7, 1×/tour, CC 20 %) : 30–34 Feu en cercle de 3 (**touche aussi les alliés et le lanceur**). Le sort de zone signature du Crâ Feu ; à combiner avec la Balise Tactique pour regrouper.

#### Flèche Massacrante (`32457`) — variante (obtenu niv. 155)

> Augmente les dommages du sort pour chaque entité dans la zone d'effet et occasionne des dommages Terre en zone.

- Caractéristiques (g1) : **4 PA** · portée 2–7 (modifiable) · en ligne uniquement · ligne de vue requise · CC 15% · 2×/tour
- Effets :
  - **Flèche Massacrante : +12 dégâts de base** → lanceur ; zone demi-cercle taille 1, *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
  - **le lanceur lance le sous-sort « Flèche Massacrante » (32461, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone demi-cercle taille 1  `[1160]`
    - ↳ sous-sort 32461 « Flèche Massacrante » niv.1 :
      - **Flèche Massacrante : +12 dégâts de base** → lanceur ; 1 tour(s)  `[293]`
  - **25 à 29 dommages Terre (CC : 30 à 35)** → tous (alliés+ennemis) dans la zone ; zone demi-cercle taille 1  `[97]`
  - **Retire les effets du sort « Flèche Massacrante » (32461)** → lanceur  `[406]`
- **Analyse / rôle tactique** : Variante Terre 4 PA (po 2–7 en ligne, 2×/tour) : 25–29 Terre en demi-cercle 1, +12 dégâts de base par entité présente dans la zone (alliés compris) pour ce lancer. Très fort sur un paquet de monstres collés.


### Paire 14 — Œil de Taupe / Pluie de Flèches

#### Œil de Taupe (`32437`) — sort de base (obtenu niv. 50)

> Dévoile les invisibles, retire de la Portée et vole de la vie dans l'élément Eau en zone.

- Caractéristiques (g3) : **3 PA** · portée 3–6 (modifiable) · ligne de vue requise · CC 15% · 1×/tour · cumul max 1
- Grades : g1 (niv. 50) : 3 PA, po 3–4, 12–14 vol Eau ; g2 (niv. 117) : 3 PA, po 3–5, 16–19 vol Eau ; g3 (niv. 184) : 3 PA, po 3–6, 19–22 vol Eau
- Effets :
  - **Dévoile les entités invisibles** → ennemis dans la zone ; zone cercle taille 2  `[202]`
  - **-3 Portée** → tous (alliés+ennemis) dans la zone ; zone cercle taille 2, 1 tour(s)  `[116]`
  - **19 à 22 vol Eau (CC : 23 à 26)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 2  `[91]`
- **Analyse / rôle tactique** : Eau 3 PA (po 3–6, 1×/tour) : révèle les invisibles en cercle 2, -3 PO (1 tour) et vol Eau 19–22 en zone (alliés compris). Anti-Sram/anti-invisibles et anti-distance.

#### Pluie de Flèches (`32431`) — variante (obtenu niv. 160)

> Retire de l'Esquive PM et occasionne des dommages Air en zone. N'affecte pas le lanceur.  Les effets sont relancés à partir de la case ciblée au tour suivant.

- Caractéristiques (g1) : **3 PA** · portée 0–6 (modifiable) · ligne de vue requise · CC 15% · 1×/tour · 2×/tour global (tous lanceurs) · cumul max 1
- Effets :
  - **-20 Esquive PM** → tous sauf le lanceur dans la zone ; zone cercle taille 3, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[163]`
  - **la cible lance sur la case ciblée le sous-sort « Pluie de Flèches » (32481, niv. 2)** → lanceur  `[2794]`
    - ↳ sous-sort 32481 « Pluie de Flèches » niv.2 :
      - **-20 Esquive PM** → tous sauf le lanceur dans la zone ; zone cercle taille 3, 1 tour(s)  `[163]`
  - **21 à 23 dommages Air (CC : 25 à 28)** → tous sauf le lanceur dans la zone ; zone cercle taille 3  `[98]`
  - **Pose un glyphe-aura « Pluie de Flèches » (32481, niv. 3)** → alliés dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone cercle taille 3, 1 tour(s)  `[1091]`
    - ↳ sous-sort 32481 niv.3 : aucun effet de jeu (marqueur)
  - **la cible lance sur la case ciblée le sous-sort « Pluie de Flèches » (32481, niv. 1)** → lanceur ; délai 1 t.  `[2794]`
    - ↳ sous-sort 32481 « Pluie de Flèches » niv.1 :
      - **la cible lance sur la case ciblée le sous-sort « Pluie de Flèches » (32481, niv. 2)** → lanceur  `[2794]`
        - ↳ (sous-sort 32481 niv.2 déjà détaillé plus haut)
      - **21 à 23 dommages Air (CC : 25 à 28)** → tous sauf le lanceur dans la zone ; zone cercle taille 3  `[98]`
- **Analyse / rôle tactique** : Variante Air 3 PA (po 0–6, 1×/tour, max 2×/tour pour tous les Crâ) : 21–23 Air et -20 Esquive PM en cercle 3 (n'affecte pas le lanceur), puis les effets se relancent sur la même case au tour suivant. Prépare un retrait PM de groupe (Enutrof/Sacrieur) en réduisant l'esquive PM.


### Paire 15 — Œil pour Œil / Flèche Paralysante

#### Œil pour Œil (`32454`) — sort de base (obtenu niv. 55)

> Vole de la vie dans l'élément Terre en zone. N'affecte pas le lanceur.  Les dommages du sort sont augmentés pour chaque attaque ennemie subie au tour précédent.

- Caractéristiques (g3) : **3 PA** · portée 0–5 (modifiable) · ligne de vue requise · CC 15% · 1×/tour · cumul max 4
- Grades : g1 (niv. 55) : 3 PA, po 0–3, 18–20 vol Terre ; g2 (niv. 122) : 3 PA, po 0–4, 24–26 vol Terre ; g3 (niv. 189) : 3 PA, po 0–5, 27–30 vol Terre
- Effets :
  - **27 à 30 vol Terre (CC : 32 à 36)** → tous sauf le lanceur dans la zone ; zone croix taille 1  `[92]`
  - **Œil pour Œil : +6 dégâts de base** → lanceur ; zone croix taille 1, 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
- **Analyse / rôle tactique** : Terre 3 PA (po 0–5, 1×/tour) : vol Terre 27–30 en croix 1 (pas le lanceur) ; +6 dégâts de base par attaque ennemie subie au tour précédent (cumul 4 → +24). Bon sort de survie quand on est focus.

#### Flèche Paralysante (`32441`) — variante (obtenu niv. 165)

> Retire des PA et des PM et occasionne des dommages Eau en zone.

- Caractéristiques (g1) : **4 PA** · portée 3–6 (modifiable) · ligne de vue requise · CC 20% · 1×/tour · cumul max 1
- Effets :
  - **Retire 1 PA (esquivable)** → tous (alliés+ennemis) dans la zone ; zone carré taille 1, 1 tour(s), non désenvoûtable  `[1079]`
  - **Retire 2 PM (esquivable)** → tous (alliés+ennemis) dans la zone ; zone carré taille 1, 1 tour(s), non désenvoûtable  `[1080]`
  - **30 à 34 dommages Eau (CC : 36 à 41)** → tous (alliés+ennemis) dans la zone ; zone carré taille 1  `[96]`
- **Analyse / rôle tactique** : Variante Eau 4 PA (po 3–6, 1×/tour, CC 20 %) : -1 PA, -2 PM et 30–34 Eau en carré 1 (9 cases, alliés compris). Meilleur retrait PM de zone du Crâ.


### Paire 16 — Balise de Survie / Représailles

#### Balise de Survie (`32474`) — sort de base (obtenu niv. 60)

> Invoque une Balise qui peut soigner tous les alliés dans sa ligne de vue au début de son tour. Elle peut également échanger de position avec le lanceur s'il l'attaque en étant dans sa ligne de vue.  La balise est détruite 2 tours après son invocation.

- Caractéristiques (g3) : **2 PA** · portée 1–4 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 3 t.
- Grades : g1 (niv. 60) : 2 PA, po 1–2 ; g2 (niv. 127) : 2 PA, po 1–3 ; g3 (niv. 194) : 2 PA, po 1–4
- Effets :
  - **Invoque « Balise de Survie » (monstre 8348, grade 3)** → cible (alliée ou ennemie)  `[181]`
  - **Soin : 7% des PV max** → alliés (hors lanceur) dans la zone ; zone cercle illimitée (63), si en LdV du centre, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1109]`
  - **Échange de positions (lanceur ↔ cible)** → personnages joueurs alliés, invocations du lanceur ; zone cercle illimitée (63), si en LdV du centre, *info-bulle uniquement (comportement réel géré côté serveur)*  `[8]`
  - **Tue la cible** → alliés (dont lanceur si dans la zone), invocations du lanceur, U (INCERTAIN) ; délai 2 t., non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[141]`
- **Analyse / rôle tactique** : 2 PA (po 1–4, relance 3) : Balise de Survie 2 tours qui soigne 7 % PV max à tous les alliés en ligne de vue au début de son tour, et échange de place avec le Crâ si celui-ci l'attaque en étant dans sa ligne de vue (escape).

#### Représailles (`32472`) — variante (obtenu niv. 170)

> Occasionne des dommages Neutre aux ennemis selon leur vie érodée en zone. Applique également l'état Pesanteur sur les cibles et augmente les dommages subis par les ennemis en zone.

- Caractéristiques (g1) : **3 PA** · portée 3–6 (modifiable) · ligne de vue requise · CC 25% · relance 3 t. · 1×/tour global (tous lanceurs) · cumul max 1
- Effets :
  - **Dommages Neutre : 20%  PV érodés de la cible (CC : 25)** → ennemis dans la zone ; zone croix taille 1  `[1092]`
  - **Applique l'état « Pesanteur » (7)** → tous (alliés+ennemis) dans la zone ; zone croix taille 1, 1 tour(s)  `[950]`
  - **Dommages subis x110%** → ennemis dans la zone ; zone croix taille 1, actif 2 tour(s), déclencheur : quand la cible subit des dommages  `[1163]`
- **Analyse / rôle tactique** : Variante Neutre 3 PA (po 3–6, relance 3, 1×/tour global) : dégâts Neutre = 20 % (CC 25 %) des PV **érodés** des ennemis en croix 1, Pesanteur (1 tour) et ×110 % dommages subis jusqu'au prochain coup. Finisher contre des cibles très érodées (Tir Perçant, Punitive).


### Paire 17 — Tir de Repli / Vendetta

#### Tir de Repli (`32470`) — sort de base (obtenu niv. 65)

> Éloigne le lanceur de l'ennemi ciblé ou rapproche le lanceur vers l'allié ciblé. Augmente également la Portée du lanceur.

- Caractéristiques (g3) : **1 PA** · portée 2–8 (modifiable) · en ligne ou diagonale · ligne de vue requise · cible requise (case occupée) · CC 0% · 3×/tour · 2×/cible
- Grades : g1 (niv. 65) : 1 PA, po 2–6 ; g2 (niv. 131) : 1 PA, po 2–7 ; g3 (niv. 198) : 1 PA, po 2–8
- Effets :
  - **Le lanceur recule de 2 case(s) (s’éloigne de la cible)** → cible ennemie  `[1041]`
  - **Le lanceur avance de 2 case(s) vers la cible** → cible alliée  `[1042]`
  - **2 Portée** → lanceur ; 1 tour(s)  `[117]`
- **Analyse / rôle tactique** : 1 PA (po 2–8 en ligne/diagonale, 3×/tour) : recule de 2 si cible ennemie, avance de 2 si cible alliée ; +2 PO (1 tour). Repositionnement très bon marché.

#### Vendetta (`32473`) — variante (obtenu niv. 175)

> Pose un piège mono-cellule qui occasionne des dommages dans le meilleur élément du lanceur aux ennemis et attire les entités vers son centre en zone.

- Caractéristiques (g1) : **2 PA** · portée 1–6 (modifiable) · sans ligne de vue · case libre requise · case sans piège requise · CC 0% · 1×/tour
- Effets :
  - **Pose un piège « Vendetta » (32478, niv. 1)** → cible (alliée ou ennemie)  `[400]`
    - ↳ sous-sort 32478 « Vendetta » niv.1 :
      - **16 à 18 dommages du meilleur élément** → ennemis dans la zone ; zone croix taille 3  `[2822]`
      - **Attire la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 3  `[6]`
- **Analyse / rôle tactique** : Variante 2 PA : piège mono-cellule (sans LdV, po 1–6) qui inflige 16–18 dégâts dans le meilleur élément du Crâ en croix 3 et attire de 3 vers son centre. Regroupe les ennemis qui marchent dessus.


### Paire 18 — Flèche Punitive / Flèche du Jugement

#### Flèche Punitive (`32456`) — sort de base (obtenu niv. 70)

> Érode la cible et occasionne des dommages Terre. Les dommages du sort sont augmentés pour les prochains lancers.

- Caractéristiques (g2) : **4 PA** · portée 4–10 (modifiable) · ligne de vue requise · CC 20% · 1×/tour · cumul max 1
- Grades : g1 (niv. 70) : 4 PA, po 4–8, 23–27 Terre ; g2 (niv. 137) : 4 PA, po 4–10, 30–34 Terre
- Effets :
  - **15% Érosion** → cible (alliée ou ennemie) ; 2 tour(s)  `[776]`
  - **30 à 34 dommages Terre (CC : 36 à 41)** → cible (alliée ou ennemie)  `[97]`
  - **Flèche Punitive : +24 dégâts de base** → lanceur ; 1 tour(s), délai 1 t.  `[293]`
  - **Flèche Punitive : +32 dégâts de base** → lanceur ; 1 tour(s), délai 2 t.  `[293]`
- **Analyse / rôle tactique** : Terre 4 PA (po 4–10, 1×/tour, CC 20 %) : 15 % d'érosion (2 tours) + 30–34 Terre ; +24 dégâts de base au tour suivant et +32 au tour d'après. À lancer tous les tours sur le boss (dégâts croissants : 30–34 → 54–58 → 62–66).

#### Flèche du Jugement (`32460`) — variante (obtenu niv. 180)

> Retire de la Puissance et occasionne des dommages Terre. La première attaque dépend des PM restants du lanceur.

- Caractéristiques (g1) : **4 PA** · portée 3–9 (modifiable) · ligne de vue requise · CC 20% · 2×/tour · 1×/cible · cumul max 2
- Effets :
  - **-150 Puissance** → cible (alliée ou ennemie) ; 2 tour(s)  `[186]`
  - **36 à 40 dommages Terre (% PM restants) (CC : 43 à 48)** → cible (alliée ou ennemie)  `[1016]`
  - **25 à 27 dommages Terre (CC : 30 à 32)** → cible (alliée ou ennemie)  `[97]`
- **Analyse / rôle tactique** : Variante Terre 4 PA (po 3–9, 2×/tour, 1×/cible) : -150 Puissance (2 tours), 36–40 Terre **proportionnels aux PM restants** du Crâ + 25–27 Terre. À lancer avant de se déplacer.
- *Notes moteur* : Effet 1016 : dommages × (PM restants / PM max) — INCERTAIN : vérifier la formule exacte (DoMath).


### Paire 19 — Flèche d'Expiation / Flèche de Rédemption

#### Flèche d'Expiation (`32438`) — sort de base (obtenu niv. 75)

> Réduit les soins reçus par la cible et occasionne des dommages Eau. Les dommages du sort sont augmentés pour les prochains lancers.

- Caractéristiques (g2) : **4 PA** · portée 6–12 (modifiable) · ligne de vue requise · CC 25% · relance 2 t.
- Grades : g1 (niv. 75) : 4 PA, po 6–10, 28–30 Eau ; g2 (niv. 142) : 4 PA, po 6–12, 35–37 Eau
- Effets :
  - **Soins reçus x50%** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : quand la cible est soignée  `[1159]`
  - **35 à 37 dommages Eau (CC : 42 à 44)** → cible (alliée ou ennemie)  `[96]`
  - **Flèche d'Expiation : +36 dégâts de base** → lanceur ; 1 tour(s), délai 2 t.  `[293]`
  - **Flèche d'Expiation : +36 dégâts de base** → lanceur ; 1 tour(s), délai 4 t.  `[293]`
- **Analyse / rôle tactique** : Eau 4 PA (po 6–12 !, relance 2, CC 25 %) : 35–37 Eau, soins reçus ×50 % (2 tours) et +36 dégâts de base aux tours N+2 et N+4 (donc 71–73 au prochain lancer). Sort de très longue portée anti-soin.

#### Flèche de Rédemption (`32442`) — variante (obtenu niv. 185)

> Vole de la vie dans l'élément Eau. Les dommages du sort sont augmentés pour chaque tentative de retrait de PA ou de PM réussie.  Les dommages sont réinitialisés après utilisation du sort.

- Caractéristiques (g1) : **4 PA** · portée 4–9 (modifiable) · ligne de vue requise · CC 15% · 2×/tour · cumul max 6
- Effets :
  - **26 à 29 vol Eau (CC : 31 à 35)** → cible (alliée ou ennemie)  `[91]`
  - **Flèche de Rédemption : +6 dégâts de base** → lanceur ; durée infinie, non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
  - **Retire les effets du rang 2 du sort « Flèche de Rédemption » (32462)** → lanceur  `[1406]`
- **Analyse / rôle tactique** : Variante Eau 4 PA (po 4–9, 2×/tour) : vol Eau 26–29 ; +6 dégâts de base à chaque retrait de PA/PM réussi par le Crâ (cumul 6 → +36), remis à zéro au lancer. Combo : Glacée/Cinglante/Paralysante puis Rédemption.


### Paire 20 — Flèche Perforante / Flèche Boomerang

#### Flèche Perforante (`32429`) — sort de base (obtenu niv. 80)

> Occasionne des dommages Air aux ennemis et repousse les cibles en zone. Les dommages de zone ne sont pas dégressifs et sont plus importants sur les cibles ayant du bouclier.

- Caractéristiques (g2) : **4 PA** · portée 3–9 (modifiable) · en ligne uniquement · ligne de vue requise · CC 20% · 1×/tour
- Grades : g1 (niv. 80) : 4 PA, po 3–7, 31–34 Air, 35–39 Air ; g2 (niv. 147) : 4 PA, po 3–9, 38–42 Air, 44–48 Air
- Effets :
  - **38 à 42 dommages Air (CC : 46 à 50)** → ennemis dans la zone — si cible n'a PAS de bouclier (INCERTAIN: masque pb) ; zone ligne taille 3  `[98]`
  - **44 à 48 dommages Air (CC : 53 à 58)** → ennemis dans la zone — si cible a du bouclier (INCERTAIN: masque PB) ; zone ligne taille 3  `[98]`
  - **Repousse la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone ; zone ligne taille 3  `[5]`
- **Analyse / rôle tactique** : Air 4 PA en ligne (po 3–9, 1×/tour, CC 20 %) : 38–42 Air non dégressifs en ligne de 3 (44–48 sur cible avec bouclier), repousse de 3. Gros sort Air de couloir.

#### Flèche Boomerang (`32432`) — variante (obtenu niv. 190)

> Retire des PM et occasionne des dommages Air. N'affecte pas le lanceur.  Retire des PM et vole de la vie à la cible initiale et aux ennemis entre elle et la nouvelle cible si elles sont alignées. Affecte également les Balises. Applique ces effets entre la dernière cible et le lanceur à la fin du tour de ce dernier s'il est aligné avec elle.

- Caractéristiques (g1) : **3 PA** · portée 0–7 (modifiable) · ligne de vue requise · cible requise (case occupée) · CC 10% · 2×/tour · 1×/cible · cumul max 1
- Effets :
  - **la cible lance (sur elle-même) le sous-sort « Flèche Boomerang » (32434, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 32434 « Flèche Boomerang » niv.1 :
      - **Applique l'état « Flèche Boomerang (masque) » (6979)** → ennemis dans la zone ; zone tout le terrain (vivants), 1 tour(s)  `[950]`
      - **Applique l'état « Flèche Boomerang (masque) » (6979)** → alliés dans la zone — si cible est l’un des monstres : « Balise de Survie » (8348) / « Balise Tactique » (8347) ; zone tout le terrain (vivants), 1 tour(s)  `[950]`
  - **la cible lance sur la case ciblée (limitation globale) le sous-sort « Flèche Boomerang » (32434, niv. 2)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Boomerang » (6975) ; zone croix sans centre illimitée (63)  `[2795]`
    - ↳ sous-sort 32434 « Flèche Boomerang » niv.2 :
      - **Applique l'état « Flèche Boomerang (cibles) » (7117)** → lanceur, alliés (dont lanceur si dans la zone), ennemis — si cible a l'état « Flèche Boomerang (masque) » (6979) ; zone ligne depuis le lanceur taille 0 (min 63), 1 tour(s)  `[950]`
      - **Applique l'état « Flèche Boomerang (nouvelle cible) » (7118)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **Retire 2 PM (esquivable)** → cible (hors lanceur) ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1080]`
  - **le lanceur lance le sous-sort « Flèche Boomerang » (32434, niv. 7)** → cible (hors lanceur)  `[1160]`
    - ↳ sous-sort 32434 « Flèche Boomerang » niv.7 :
      - **Retire 2 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1080]`
  - **26 à 29 dommages Air (CC : 31 à 35)** → cible (hors lanceur)  `[98]`
  - **le lanceur lance (limitation globale) le sous-sort « Flèche Boomerang » (32434, niv. 3)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Boomerang » (6975) ; zone croix sans centre illimitée (63)  `[2160]`
    - ↳ sous-sort 32434 « Flèche Boomerang » niv.3 :
      - **la cible lance (sur elle-même) le sous-sort « Flèche Boomerang » (32434, niv. 8)** → cible (alliée ou ennemie)  `[792]`
        - ↳ sous-sort 32434 « Flèche Boomerang » niv.8 :
          - **le lanceur lance (limitation globale) le sous-sort « Flèche Boomerang » (32434, niv. 9)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Boomerang (nouvelle cible) » (7118) ; zone croix sans centre illimitée (63)  `[2160]`
            - ↳ sous-sort 32434 niv.9 : aucun effet de jeu (marqueur)
      - **le lanceur lance le sous-sort « Flèche Boomerang » (32434, niv. 6)** → cible (alliée ou ennemie)  `[1160]`
        - ↳ sous-sort 32434 « Flèche Boomerang » niv.6 :
          - **Retire l'état « Flèche Boomerang (masque) » (6979)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[951]`
          - **Retire l'état « Flèche Boomerang » (6975)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[951]`
          - **Retire l'état « Flèche Boomerang (cibles) » (7117)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[951]`
          - **Retire l'état « Flèche Boomerang (nouvelle cible) » (7118)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[951]`
      - **Retire 2 PM (esquivable)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Boomerang (cibles) » (7117) ET si cible n'a PAS l'état « Flèche Boomerang (nouvelle cible) » (7118) ; zone croix illimitée (63), 1 tour(s), non désenvoûtable  `[1080]`
      - **26 à 29 vol Air (CC : 31 à 35)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Boomerang (cibles) » (7117) ET si cible n'a PAS l'état « Flèche Boomerang (nouvelle cible) » (7118) ; zone croix illimitée (63)  `[93]`
  - **la cible lance (sur elle-même) le sous-sort « Flèche Boomerang » (32434, niv. 6)** → lanceur  `[792]`
    - ↳ (sous-sort 32434 niv.6 déjà détaillé plus haut)
  - **Applique l'état « Flèche Boomerang » (6975)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **la cible lance (sur elle-même) le sous-sort « Flèche Boomerang » (32434, niv. 4)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur  `[792]`
    - ↳ sous-sort 32434 « Flèche Boomerang » niv.4 :
      - **Applique l'état « Flèche Boomerang (masque) » (6979)** → ennemis dans la zone ; zone tout le terrain (vivants), 1 tour(s)  `[950]`
      - **Applique l'état « Flèche Boomerang (masque) » (6979)** → alliés dans la zone — si cible est l’un des monstres : « Balise de Survie » (8348) / « Balise Tactique » (8347) ; zone tout le terrain (vivants), 1 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Flèche Boomerang » (32434, niv. 5)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Boomerang » (6975) ; zone croix sans centre illimitée (63)  `[1160]`
        - ↳ sous-sort 32434 « Flèche Boomerang » niv.5 :
          - **la cible lance sur le lanceur (source) le sous-sort « Flèche Boomerang » (32434, niv. 9)** → cible (alliée ou ennemie)  `[1017]`
            - ↳ (sous-sort 32434 niv.9 déjà détaillé plus haut)
          - **le lanceur lance le sous-sort « Flèche Boomerang » (32434, niv. 6)** → cible (alliée ou ennemie)  `[1160]`
            - ↳ (sous-sort 32434 niv.6 déjà détaillé plus haut)
          - **Retire 2 PM (esquivable)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Boomerang (masque) » (6979) ; zone ligne depuis le lanceur taille 1 (min 63), 1 tour(s), non désenvoûtable  `[1080]`
          - **26 à 29 vol Air (CC : 31 à 35)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Boomerang (masque) » (6979) ; zone ligne depuis le lanceur taille 1 (min 63)  `[93]`
  - **26 à 29 vol Air (CC : 31 à 35)** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[93]`
- **Analyse / rôle tactique** : Variante Air 3 PA (po 0–7, 2×/tour, 1×/cible) : -2 PM et 26–29 Air sur la cible ; si une cible précédente marquée est alignée avec la nouvelle, -2 PM et vol Air 26–29 à tous les ennemis entre elles ; en fin de tour, idem entre la dernière cible et le Crâ s'ils sont alignés. Touche aussi les balises. Retrait PM en ligne très fort si on aligne les ennemis.


### Paire 21 — Flèche Dévorante / Flèche Fulminante

#### Flèche Dévorante (`32446`) — sort de base (obtenu niv. 85)

> Vole de la vie dans l'élément Feu. N'affecte pas le lanceur. Le vol de vie est plus important après chaque lancer sur un même ennemi.  Occasionne également des dommages Feu à l'ennemi initial si le sort est lancé sur une autre cible, ou dans les prochains tours s'il n'est pas relancé. Les dommages sont plus importants selon le nombre de lancers effectués sur un même ennemi.

- Caractéristiques (g2) : **3 PA** · portée 0–6 (modifiable) · ligne de vue requise · cible requise (case occupée) · CC 10% · 2×/tour · 4×/tour global (tous lanceurs) · cumul max 3
- Grades : g1 (niv. 85) : 3 PA, po 0–4, 9–11 vol Feu, 19–22 vol Feu, 27–31 vol Feu, 27–31 Feu ; g2 (niv. 152) : 3 PA, po 0–6, 11–13 vol Feu, 23–27 vol Feu, 34–38 vol Feu, 34–38 Feu
- Effets :
  - **Retire les effets du sort « Flèche Dévorante » (32446)** → ennemis dans la zone ; zone cercle illimitée (63)  `[406]`
  - **Retire les effets du sort « Flèche Dévorante » (32446)** → cible ennemie — si cible n'a PAS l'état « Flèche Dévorante III » (662) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[406]`
  - **11 à 13 vol Feu (CC : 14 à 16)** → allié ciblé (hors lanceur)  `[94]`
  - **11 à 13 vol Feu (CC : 14 à 16)** → cible ennemie — si cible n'a PAS l'état « Flèche Dévorante I » (573) ET si cible n'a PAS l'état « Flèche Dévorante II » (574) ET si cible n'a PAS l'état « Flèche Dévorante III » (662)  `[94]`
  - **23 à 27 vol Feu (CC : 28 à 32)** → cible ennemie — si cible a l'état « Flèche Dévorante I » (573)  `[94]`
  - **34 à 38 vol Feu (CC : 41 à 46)** → cible ennemie — si cible a l'état « Flèche Dévorante II » (574)  `[94]`
  - **34 à 38 vol Feu (CC : 41 à 46)** → cible ennemie — si cible a l'état « Flèche Dévorante III » (662)  `[94]`
  - **le lanceur lance le sous-sort « Décharge : » (25934, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25934 niv.1 : aucun effet de jeu (marqueur)
  - **34 à 38 dommages Feu (CC : 41 à 46)** → cible ennemie — si cible n'a PAS l'état « Flèche Dévorante I » (573) ET si cible n'a PAS l'état « Flèche Dévorante II » (574) ET si cible n'a PAS l'état « Flèche Dévorante III » (662) ; délai 3 t.  `[99]`
  - **34 à 38 dommages Feu (CC : 41 à 46)** → ennemis dans la zone — si cible a l'état « Flèche Dévorante I » (573) ; zone cercle illimitée (63) (min 1)  `[99]`
  - **Applique l'état « Flèche Dévorante I » (573)** → cible ennemie — si cible n'a PAS l'état « Flèche Dévorante I » (573) ET si cible n'a PAS l'état « Flèche Dévorante II » (574) ET si cible n'a PAS l'état « Flèche Dévorante III » (662) ; 3 tour(s)  `[950]`
  - **52 à 56 dommages Feu (CC : 62 à 67)** → cible ennemie — si cible a l'état « Flèche Dévorante I » (573) ; délai 3 t.  `[99]`
  - **52 à 56 dommages Feu (CC : 62 à 67)** → ennemis dans la zone — si cible a l'état « Flèche Dévorante II » (574) ; zone cercle illimitée (63) (min 1)  `[99]`
  - **Applique l'état « Flèche Dévorante II » (574)** → cible ennemie — si cible a l'état « Flèche Dévorante I » (573) ; 3 tour(s)  `[950]`
  - **70 à 74 dommages Feu (CC : 84 à 89)** → cible ennemie — si cible a l'état « Flèche Dévorante II » (574) ; délai 3 t.  `[99]`
  - **70 à 74 dommages Feu (CC : 84 à 89)** → cible ennemie — si cible a l'état « Flèche Dévorante III » (662) ; délai 3 t.  `[99]`
  - **70 à 74 dommages Feu (CC : 84 à 89)** → ennemis dans la zone — si cible a l'état « Flèche Dévorante III » (662) ; zone cercle illimitée (63) (min 1)  `[99]`
  - **Applique l'état « Flèche Dévorante III » (662)** → cible ennemie — si cible a l'état « Flèche Dévorante II » (574) ; 3 tour(s)  `[950]`
  - **Applique l'état « Flèche Dévorante III » (662)** → cible ennemie — si cible a l'état « Flèche Dévorante III » (662) ; 3 tour(s)  `[950]`
- **Analyse / rôle tactique** : Feu 3 PA (po 0–6, 2×/tour, 4×/tour global) : vol Feu croissant sur un même ennemi (11–13 → 23–27 → 34–38, états I/II/III, 3 tours) ; si on change de cible ou qu'on ne relance pas, l'ennemi précédent subit une détonation Feu (34–38 / 52–56 / 70–74 selon le palier) — sinon au bout de 3 tours. Gros mono-cible Feu à entretenir chaque tour.

#### Flèche Fulminante (`32450`) — variante (obtenu niv. 195)

> Occasionne des dommages Feu. Rebondit sur l'ennemi le plus proche dans un cercle de taille 2. Peut également rebondir sur les Balises.  Les dommages du sort sont augmentés après chaque cible touchée.

- Caractéristiques (g1) : **4 PA** · portée 1–6 (modifiable) · ligne de vue requise · cible requise (case occupée) · CC 20% · 1×/tour · 1×/tour global (tous lanceurs) · cumul max 4
- Effets :
  - **26 à 29 dommages Feu (CC : 31 à 35)** → cible alliée — si cible est le monstre « monstre#50000 » (50000)  `[99]`
  - **la cible lance (sur elle-même) le sous-sort « Flèche Fulminante » (32452, niv. 2)** → lanceur  `[792]`
    - ↳ sous-sort 32452 « Flèche Fulminante » niv.2 :
      - **Applique l'état « Flèche Fulminante (cible) » (3551)** → ennemis dans la zone ; zone tout le terrain (vivants), 1 tour(s)  `[950]`
      - **Applique l'état « Flèche Fulminante (cible) » (3551)** → alliés dans la zone — si cible est l’un des monstres : « Balise de Survie » (8348) / « Balise Tactique » (8347) ; zone tout le terrain (vivants), 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Flèche Fulminante » (32452, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 32452 « Flèche Fulminante » niv.1 :
      - **26 à 29 dommages Feu (CC : 31 à 35)** → cible (alliée ou ennemie) — si cible a l'état « Flèche Fulminante (cible) » (3551) ET si cible n'a PAS l'état « Flèche Fulminante (touché) » (570)  `[99]`
      - **26 à 29 dommages Feu (CC : 31 à 35)** → cible alliée — si cible n'est pas « Balise de Survie » (8348) ET si cible n'est pas « Balise Tactique » (8347)  `[99]`
      - **Applique l'état « Flèche Fulminante (touché) » (570)** → cible (alliée ou ennemie) — si cible a l'état « Flèche Fulminante (cible) » (3551) ET si cible n'a PAS l'état « Flèche Fulminante (touché) » (570) ; 1 tour(s)  `[950]`
      - **Flèche Fulminante : +15 dégâts de base** → lanceur ; 1 tour(s)  `[293]`
      - **le lanceur lance (limitation globale) le sous-sort « Flèche Fulminante » (32452, niv. 1)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Flèche Fulminante (cible) » (3551) ET si cible n'a PAS l'état « Flèche Fulminante (touché) » (570) ; zone cercle taille 2 (min 1)  `[2160]`
        - ↳ (sous-sort 32452 niv.1 déjà détaillé plus haut)
  - **la cible lance (sur elle-même) le sous-sort « Flèche Fulminante » (32452, niv. 3)** → lanceur  `[792]`
    - ↳ sous-sort 32452 « Flèche Fulminante » niv.3 :
      - **Retire l'état « Flèche Fulminante (cible) » (3551)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain  `[951]`
      - **Retire l'état « Flèche Fulminante (touché) » (570)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain  `[951]`
      - **Retire les effets du sort « Flèche Fulminante » (32452)** → lanceur  `[406]`
  - **Flèche Fulminante : +15 dégâts de base** → lanceur ; non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
- **Analyse / rôle tactique** : Variante Feu 4 PA (po 1–6, 1×/tour, CC 20 %) : 26–29 Feu puis rebond sur l'ennemi le plus proche (cercle 2) non touché, +15 dégâts de base par cible touchée (cumul 4). Peut rebondir sur les balises. Fort sur des groupes espacés de 1–2 cases.


### Paire 22 — Acuité Absolue / Sentinelle

#### Acuité Absolue (`32469`) — sort de base (obtenu niv. 90)

> Augmente la portée minimale de tous les sorts offensifs Crâ du lanceur pour désactiver la ligne de vue sur tous ses sorts. Augmente également ses Critiques.

- Caractéristiques (g2) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 4 t. (1er lancer possible au tour 2)
- Grades : g1 (niv. 90) : 2 PA, po 0–0 ; g2 (niv. 157) : 2 PA, po 0–0
- Effets :
  - **Coup de poing : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable, *info-bulle uniquement (comportement réel géré côté serveur)*  `[280]`
  - **Flèche Vagabonde : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche de Barrage : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Glacée : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche de Recul : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Détonante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche d'Abolition : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Cinglante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche d'Immobilisation : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche de Dispersion : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Explosive : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Œil de Taupe : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Œil pour Œil : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Punitive : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche d'Expiation : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Perforante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Dévorante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Évasive : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Carreaux Destructeurs : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Harcelante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Éclatante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Ralentissante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Persécutrice : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Assaillante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Tyrannique : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèches Enflammées : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Massacrante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Pluie de Flèches : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Paralysante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Représailles : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Vendetta : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche du Jugement : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche de Rédemption : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Boomerang : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Flèche Fulminante : +3 Portée minimale** → lanceur ; 1 tour(s), non désenvoûtable  `[280]`
  - **Coup de poing : ligne de vue désactivée** → lanceur ; 1 tour(s), non désenvoûtable  `[289]`
  - **15% Critique** → lanceur ; 1 tour(s), non désenvoûtable  `[115]`
  - **Retire les effets du sort « Acuité Absolue » (32469)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur, non désenvoûtable  `[406]`
- **Analyse / rôle tactique** : 2 PA (relance 4, 1er lancer au tour 2) : +3 PO min, sorts sans ligne de vue, +15 % CC pour le tour. Permet de tirer par-dessus les obstacles (combo Persécutrice : frapper hors LdV).

#### Sentinelle (`32475`) — variante (obtenu niv. 200)

> Augmente les dommages à distance et la Portée du lanceur et dévoile tous les ennemis dans sa ligne de vue. Les effets sont réduits pour chaque PM utilisé.

- Caractéristiques (g1) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 5 t. (1er lancer possible au tour 2) · 1×/tour global (tous lanceurs) · cumul max 10
- Effets :
  - **Change l'apparence** → lanceur ; 2 tour(s)  `[335]`
  - **Change l'apparence** → lanceur ; 2 tour(s)  `[335]`
  - **20% Dommages distance** → lanceur ; 2 tour(s)  `[2804]`
  - **10 Portée** → lanceur ; 2 tour(s)  `[117]`
  - **Dévoile les entités invisibles** → ennemis dans la zone ; zone cercle illimitée (63), si en LdV du centre, *info-bulle uniquement (comportement réel géré côté serveur)*  `[202]`
  - **le lanceur lance le sous-sort « Sentinelle » (32479, niv. 1)** → ennemis dans la zone ; zone cercle illimitée (63), si en LdV du centre  `[1160]`
    - ↳ sous-sort 32479 « Sentinelle » niv.1 :
      - **Dévoile les entités invisibles** → cible ennemie  `[202]`
  - **-2% Dommages distance** → lanceur ; 2 tour(s), actif 2 tour(s), déclencheur : à chaque PM utilisé par le porteur (déduit de Sentinelle, INCERTAIN)  `[2805]`
  - **-1 Portée** → lanceur ; 2 tour(s), actif 2 tour(s), déclencheur : à chaque PM utilisé par le porteur (déduit de Sentinelle, INCERTAIN)  `[116]`
  - **Retire les effets du sort « Sentinelle » (32475)** → lanceur ; délai 2 t.  `[406]`
- **Analyse / rôle tactique** : Variante niveau 200, 2 PA (relance 5, 1er lancer au tour 2) : 2 tours de +20 % dommages distance, +10 PO, révèle les ennemis invisibles en LdV ; chaque PM utilisé réduit de 2 % et 1 PO. Posture de tourelle : ne plus bouger.


## 4. Rôles en groupe de 4 (PvM niveau 200)

| Rôle | Pertinence | Détails |
|---|---|---|
| DPS distance de zone (Feu) | ★★★★★ | Explosive (cercle 3), Barrage, Détonante, Enflammées, Fulminante ; Balise Tactique pour regrouper. |
| DPS mono-cible (Terre/Eau/Air) | ★★★★ | Punitive, Expiation, Persécutrice, Dévorante, avec Tir Perçant/Tirs Puissants. |
| Entrave (PM/PA/PO) | ★★★★ | Cinglante, Paralysante, Boomerang, Glacée, Ralentissante, Pluie de Flèches (-esquive PM). |
| Placement | ★★★ | Poussées nombreuses, Balise Tactique, Vendetta, Assaillante. |
| Soutien | ★★ | Tirs Éloignés (+PO alliés), Balise de Survie, Flèches Amoureuses, ×115 %/×110 % dégâts subis. |
| Tank / soin principal | ✗ | Pas de bouclier, soins faibles. |

**Placement idéal** : 6–9 cases du front, hors de portée de mêlée, avec une ligne de vue dégagée sur le paquet ennemi ; garder
2 PM + Pas Chassé/Tir de Repli pour se réajuster. Éviter d'être au centre d'une zone alliée (Explosive touche les alliés).

## 5. Choix de variantes recommandés

| Paire | Base | Variante | Feu zone | Air entrave | Terre mono |
|---|---|---|---|---|---|
| 1 | Flèche Glacée | Flèche Harcelante | Glacée (-2 PA) | Glacée | Glacée (Harcelante si soigneur adverse) |
| 2 | Flèche de Barrage | Carreaux Destructeurs | Barrage | Barrage | Carreaux |
| 3 | Flèche Vagabonde | Flèche Évasive | Évasive | Évasive | Vagabonde |
| 4 | Flèche de Recul | Flèche Éclatante | Éclatante | Recul | Recul |
| 5 | Pas Chassé | Balise Tactique | Balise Tactique | Pas Chassé | Pas Chassé |
| 6 | Tirs Éloignés | Tir Perçant | Tirs Éloignés (Tir Perçant contre un boss) | Tirs Éloignés | Tir Perçant |
| 7 | Flèche Détonante | Flèche Ralentissante | Détonante | Détonante | Détonante |
| 8 | Flèche d'Abolition | Flèche Persécutrice | Persécutrice | Persécutrice | Abolition |
| 9 | Flèche Cinglante | Flèche Assaillante | Assaillante (+150 Puissance) | Cinglante | Assaillante |
| 10 | Flèche d'Immobilisation | Flèche Tyrannique | Tyrannique | Immobilisation | Immobilisation |
| 11 | Tirs Puissants | Flèches Amoureuses | Tirs Puissants | Tirs Puissants | Tirs Puissants |
| 12 | Flèche de Dispersion | Flèches Enflammées | Enflammées | Dispersion | Dispersion |
| 13 | Flèche Explosive | Flèche Massacrante | Explosive | Explosive | Massacrante |
| 14 | Œil de Taupe | Pluie de Flèches | Pluie (ou Œil de Taupe vs invisibles) | Pluie de Flèches | Œil de Taupe |
| 15 | Œil pour Œil | Flèche Paralysante | Paralysante | Paralysante | Œil pour Œil |
| 16 | Balise de Survie | Représailles | Balise de Survie | Balise de Survie | Représailles |
| 17 | Tir de Repli | Vendetta | Tir de Repli | Tir de Repli | Tir de Repli |
| 18 | Flèche Punitive | Flèche du Jugement | Punitive | Punitive | Punitive |
| 19 | Flèche d'Expiation | Flèche de Rédemption | Expiation | Rédemption | Expiation |
| 20 | Flèche Perforante | Flèche Boomerang | Perforante | Boomerang | Perforante |
| 21 | Flèche Dévorante | Flèche Fulminante | Dévorante (mono) / Fulminante (paquet) | Dévorante | Dévorante |
| 22 | Acuité Absolue | Sentinelle | Sentinelle | Acuité Absolue | Sentinelle |

## 6. Rotations types (11–12 PA, 6 PM)

1. **Ouverture Feu (12 PA)** : Balise Tactique (1) sur le paquet → Tirs Puissants (1) → Flèche Explosive (4) → Flèche Détonante ×2 (4)
   → 2 PA restants : Tir de Repli (1) pour reculer. La balise donne +40 Puissance par ennemi en LdV (ex. 4 ennemis = +160).
2. **Tour standard Feu (11 PA)** : Tirs Puissants (1, relance 2) → Explosive (4) → Tyrannique (4) → Détonante (2).
   Variante sans Tirs Puissants : Explosive (4) + Barrage (3) + Détonante (2) + Détonante (2).
3. **Entrave PM (12 PA)** : Pluie de Flèches (3) → Paralysante (4) → Cinglante ×2 (4) → Tir de Repli (1).
4. **Boss mono-cible (12 PA)** : Tir Perçant (1) → Tirs Puissants (1) → Punitive (4) → Jugement (4, avant de bouger) → Abolition (2).
5. **Sentinelle (tourelle)** : tour N : Sentinelle (2) + 10 PA de sorts sans bouger ; tour N+1 : rester immobile pour garder +20 %.

## 7. Forces / faiblesses

- Forces : portée, zone Feu, entrave PM/PA, mobilité gratuite (téléport, recul, échange), buffs de dégâts subis.
- Faiblesses : fragilité au contact, dégâts de zone qui touchent les alliés, dépendance à la LdV, peu de soin.

## 8. Synergies

- **Enutrof / Sacrieur / Ouginak** : Pluie de Flèches (-20 Esquive PM) avant leurs retraits PM.
- **Iop / Pandawa / Sacrieur** : Tirs Éloignés (+3 PO aux alliés non-Crâ), Tir Perçant (×115 %) et Représailles (×110 %) avant leur burst.
- **Pandawa / Steamer / Roublard** : regroupement pour Explosive ; leurs poussées déclenchent Détonante/Tyrannique.
- **Féca / Eniripsa** : compensent la fragilité ; Flèches Amoureuses relie tank + allié.
- **Sram / Xélor / Sacrieur** : l'érosion alimente Représailles (20 % des PV érodés).

## 9. Questions ouvertes (INCERTAIN)

- Acuité Absolue : l'effet 289 ne vise que le sort 0 (arme) dans les données alors que la description parle de tous les sorts.
- Masques `pb`/`PB` (bouclier) et déclencheurs `CCMPARR`, préfixe `X` : sémantique déduite des descriptions.
- Effet 1016 (Jugement) : formule exacte des dégâts selon les PM restants.
- PV des balises (mise à l'échelle avec le niveau du Crâ).

## Sources

- DofusDB API : https://api.dofusdb.fr/breeds/9 , https://api.dofusdb.fr/spell-variants?breedId=9 , https://api.dofusdb.fr/spell-levels , https://api.dofusdb.fr/spell-states , https://api.dofusdb.fr/monsters/8347 , https://api.dofusdb.fr/monsters/8348
- Énumération ActionIds (client Dofus) : `.cache/classes/ref/ActionIds.ts` ; grammaire des masques/déclencheurs : client Dofus 2 décompilé `DamageUtil.verifySpellEffectMask/verifyEffectTrigger` (`.cache/domath/d2client/Romain-P_d2gen.DamageUtil.as`) ; formes de zones : `SpellZoneManager.as`.
- Guide (contexte, partiellement obsolète — cite d'anciens sorts) : https://www.next-stage.fr/2025/02/meilleur-build-cra-pvm-dofus-guide-complet-equipements-stuff-optimiser-votre-personnage.html

