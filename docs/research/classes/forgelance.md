# Forgelance — analyse complète pour DofusSimu (breed 20)

> « Champion immortel ». Données : API DofusDB (fichiers du jeu Dofus 3, version **3.6.12.16**, `https://api.dofusdb.fr/version`)
> — `https://api.dofusdb.fr/breeds/20`, `spell-variants?breedId=20`, `spells`, `spell-levels`, `spell-states`, `monsters/7139`
> (Lance Immortelle) et sorts cachés des types 2377 (« Sort initial Forgelance » : Armé, Désarmé, Garde, Reprise de Volée,
> Rappel de la Lance, L'Héritage du Forgelance), 2378/2857 (Lance Immortelle, Étendard), 3587/3588 (Holmgang, Éclipse),
> 3908–3912 (sous-sorts par élément), 2753/4262 (infobulles). Cache brut : `.cache/classes/hof/` (décodage : `cdump_20.txt`).
> Rôles officiels (`breedRoles`, /10) : **Dégâts 10** (« utilise sa Lance pour occasionner des dommages en zone, à distance comme
> en mêlée »), **Placement 8**, **Protection 6** (« applique des boucliers et soigne ses alliés ; augmente les Résistances
> poussée et critique »), Entrave 3, Amélioration 3, Soins 2, Tank 2, Invocation 1. Complexité officielle 3/5.

Fichier compagnon pour le moteur : `data/research/class-mechanics/forgelance.json` — `spells[]` (propriétés de lancer au grade max du niveau 200, `grades[]`, `effectsSummary` lisible, `damageLines[]` = lignes de dommages/vols/soins/boucliers réellement exécutées avec min/max normaux et critiques, zone, masque et chemin de sous-sorts `via`), `mechanics[]`, `variantChoices`, `rotations[]`, `synergies[]`, `summons[]`, `states[]`, `openQuestions[]`.

## 0. Règles moteur communes

Voir `docs/research/classes/roublard.md` §0 et `docs/research/effects.md`. Particularités du Forgelance :

- **Sorts « double chemin »** : la plupart des sorts contiennent (a) des effets « affichage » neutralisés par un masque
  impossible `F50000` (monstre inexistant) ou `forClientOnly`, et (b) trois sous-sorts réels conditionnés à l'état du lanceur :
  `2960` sur la case visée si **Armé** (3360), `2960` sur la case visée si **Reprise de Volée** (3589), `1160` sur la **Lance**
  (`F7139`) si **Désarmé** (3361) et pas en Reprise de Volée. Le moteur ne doit exécuter que (b).
- **Modificateurs de sorts** (effets sur le lanceur, durée infinie) : **2905** portée max fixée, **2906** portée min fixée,
  **314** case occupée requise, **299** case libre requise, **289** ligne de vue désactivée. Ils changent les conditions de
  lancer selon Armé/Désarmé (§2.1).
- **141** « Tue la cible » utilisé pour **rappeler** la Lance (la Lance se tue elle-même : sous-sort 30712, masque `*F7139`).
- **265** « −X dommages reçus » (Ydra, Étreinte de Valkyr) = armure : X × (1 + niveau/20) par coup (cf. `formulas.md` §12) ;
  au niveau 200 : Ydra 2 → **22** par ennemi touché (cumul 8), Étreinte de Valkyr 9 → **99**.
- **1031** « Termine le tour » (Holmgang) ; **1036** « −N tours de relance » (Croissant de Mani sur Éclipse) ;
  **2018** « Dissipe les glyphes ».

## 1. Vue d'ensemble

- **Profil** : combattant **multi-élémentaire de zone** (mêlée et mi-distance) dont tout le gameplay tourne autour de sa
  **Lance Immortelle** : il commence le combat **Armé** ; « lancer » la Lance (sorts d'invocation) le rend **Désarmé** et pose sur
  le terrain une invocation statique qui porte un **glyphe-aura Étendard** (alliés au contact : dommages subis ×90 %). La
  plupart des sorts de zone se lancent **sur la Lance** quand il est Désarmé (elle devient le centre des zones), puis la Lance
  est **rappelée** (sorts de rappel, mort de la Lance, ou Reprise de Volée) ⇒ **Armé** à nouveau et **+30 Puissance** (3 tours).
- **Défense intégrée** : **Garde** (×85 % dommages subis pendant les tours ennemis quand il finit son tour Armé), Parade
  (×25 % en mêlée + riposte), Holmgang (×65 % à distance + glyphe d'attraction), Ydra (armure 22 par ennemi touché).
- **Protection de groupe** : Phalange (bouclier 300 % du niveau en cercle 2 + 100 rés. poussée), Oriflamme (300 % + 60 rés.
  critiques), Éclipse (200 % puis Croissant de Mani 400 %), Étendard (×90 % autour de la Lance), Étreinte de Valkyr (armure 99),
  soins Chevalerie (7 % + 2 PM en cercle 2), Galanterie, Renommée.
- **Placement** (8/10) : attirances vers un centre (Effondrement, Moulin Rouge, Elding, Trident de la Mer), poussées (Estoc
  Brûlant, Volée d'Airain, Dégagement, Épieu Sismique, Javeline de Myr, Charge Héroïque), symétries (Soulèvement, Moulin à
  Vent), échanges (Maelstrom), téléportations (Kyrja, Vajra, Fente, Balestra), Indéplaçable (Poinçon).
- **Point clé pour le simulateur** : modéliser l'**état de la Lance** (absente/posée, position), les états Armé/Désarmé/Reprise
  de Volée et les modificateurs de portée qui en découlent ; l'IA doit planifier des séquences « lancer la Lance → sorts
  centrés sur la Lance → rappel » sur 1–2 tours.

## 2. Mécaniques de classe (à implémenter)

### 2.1 Armé / Désarmé (sort initial « L'Héritage du Forgelance » 24387)

Au début du combat, 24387 pose sur le Forgelance l'état « Armé trigger » (3590) et lance **Armé** (23385). Puis :

| Événement | Effet |
|---|---|
| Une Lance Immortelle apparaît | son sort initial (23262) **retire** « Armé trigger » des personnages alliés ⇒ déclencheur `EOFF3590` ⇒ **Désarmé** (23286) |
| La Lance meurt (rappel 30712, Reprise de Volée, ou tuée par l'ennemi) | 23279 (déclencheur mort) **repose** « Armé trigger » ⇒ `EON3590` ⇒ **Armé** (23385) **et** « Reprise de Volée » (30736) : **+30 Puissance 3 tours** |
| Fin du tour du Forgelance (et immédiatement au début) | **Garde** (24390) si Armé, sans Reprise de Volée, sans Parade ni Holmgang : état 6033 + **dommages subis ×85 %** ; retiré au début de son tour |

- **Armé** (3360) : Épilogue exige une case libre (portée min 1) ; Jormun limité à la portée 0 (sur soi). Les sorts
  conditionnés `HS=3360|HS=3589` sont lançables.
- **Désarmé** (3361) : tant qu'il n'est **pas** en Reprise de Volée, le modificateur 24591 s'applique : les sorts « sur la Lance »
  (Effondrement, Pluie d'Airain, Moulin Rouge, Moulin à Vent, Muspel, Ydra, Prélude au Fer, Crépuscule, Terre du Milieu,
  Dégagement, Fer Rouge, Noa, Phalange, Épilogue) passent en **portée 1–63, case occupée requise** (on cible la Lance, sans
  ligne de vue pour Noa et Épilogue) et leur zone est centrée sur la Lance. Les sorts `HS=3360|HS=3589` (Trident, Maelstrom,
  Estoc, Octave, Volée d'Airain, Soulèvement, Lance du Lac, Épieu, Lance-pierre, Javelot-foudre, Lance à Incendie, Javeline de
  Myr, Balestra, Lance-cyclone, Elding) sont **interdits**.
- Muspel est le seul sort qui **exige** d'être Désarmé (`HS=3361`).

### 2.2 Lance Immortelle (monstre 7139) et Étendard

- Invocation **statique** (0 PA/0 PM), ne compte pas dans la limite d'invocations (`useSummonSlot = false`), insensible à la
  poussée (`canBePushed = false`), état **Intacleur** (95 : ne tacle pas) sauf Poinçon ; vitalité de base 10,
  `bonusCharacteristics.lifePoints = 70` (≈ 70 % des PV du Forgelance — INCERTAIN), grade 2 (Poinçon) : +100 % vitalité.
- **Étendard** (24391, glyphe-aura carré 1 = 8 cases autour de la Lance) : les alliés (hors Lance) subissent **×90 %** de
  dommages ; les personnages alliés et invocations y reçoivent l'état **Reprise de Volée** (3589). Reposé si dissipé (24402).
- **Une seule Lance** : les sorts qui la relancent rappellent d'abord l'ancienne (Oriflamme, Poinçon) ou passent par Reprise de
  Volée (§2.3).

### 2.3 Reprise de Volée (état 3589)

- Le Forgelance **dans le glyphe de sa Lance** (au contact, diagonales comprises) est en Reprise de Volée : le modificateur
  Désarmé est levé (déclencheurs `EON/EOFF3589` de 23286) et les sorts « Armé » redeviennent lançables.
- Lancer un sort qui contient 24395 en Reprise de Volée **tue la Lance d'abord** (récupération) ⇒ Armé, +30 Puissance,
  puis le sort s'applique normalement autour du Forgelance (chemin `2960 si *E3589`). Les sorts d'invocation relancent alors
  immédiatement la Lance ailleurs.

### 2.4 Sorts selon leur relation à la Lance

| Catégorie | Sorts |
|---|---|
| **Invoquent la Lance** (case libre visée) | Lance-cyclone, Lance du Lac, Lance-pierre, Javelot-foudre, Lance à Incendie (si la case est/devient libre), Javeline de Myr (idem, après poussée), Elding, Fer Rouge (Armé), Épilogue (Armé), Oriflamme et Poinçon (rappel + invocation), Disque de Sigel (Éclipse, tour suivant) |
| **Centrés sur la Lance si Désarmé** (sans rappel) | Effondrement, Pluie d'Airain, Moulin Rouge, Moulin à Vent, Prélude au Fer, Crépuscule, Terre du Milieu, Fer Rouge, Noa, Phalange |
| **Centrés sur la Lance puis rappel** | Muspel, Ydra, Dégagement, Jormun (ligne jusqu'à la Lance ou cercles autour du lanceur et de la Lance), Épilogue (Désarmé) |
| **Rappellent la Lance** | Parade, Holmgang, Éclipse, Charge Héroïque, Talon d'Argile, Fente, Kyrja, Vajra, Chevalerie (si Désarmé), Galanterie/Renommée (si la Lance est ciblée), Oriflamme, Poinçon |

### 2.5 Éclipse (états 3735/6994) et Disque de Sigel / Croissant de Mani

- Éclipse : rappelle la Lance, **Désarme** immédiatement, état **Éclipse** (3735, 1 tour) qui **interdit la plupart des sorts**
  (`HS!3735`) jusqu'à la fin du tour ⇒ à lancer en **dernier**. Bouclier 200 % du niveau aux alliés en cercle 3 autour du
  lanceur (2 tours), **−6 PO à tout le monde** (alliés compris, 1 tour).
- Au **tour suivant** (délai 1) sur la case visée : si le Forgelance s'y trouve ⇒ **Croissant de Mani** (Armé, Pesanteur en
  cercle 3, bouclier 400 % du niveau aux alliés en cercle 3, Éclipse −2 tours de relance) ; sinon ⇒ **Disque de Sigel**
  (dommages du meilleur élément **67–76**, CC 80–91, en cercle 3, et invocation de la Lance si la case est libre ; Armé sinon).

### 2.6 Points d'attention moteur

- Évaluer `HS=3360|HS=3589` / `HS!3735` / `HS!7` au moment du lancer ; Pesanteur (7) bloque Maelstrom, Balestra, Fente,
  Kyrja, Vajra.
- « Dommages de zone non dégressifs » : Effondrement, Lance-pierre, Soulèvement, Épieu, Pluie d'Airain, Moulin Rouge, Ydra,
  Fente, Noa, Jormun (`damageDecreaseStepPercent` à 0).
- Jormun : chaque ennemi n'est touché qu'une fois (état 3931).


## 3. Fiches détaillées des 44 sorts (22 paires de variantes)

Légende : valeurs au **grade maximal accessible au niveau 200** (données DofusDB = fichiers du jeu v3.6.12.16, enregistrements du 23/06/2026). « CC » = coup critique. `[id]` = identifiant d’effet (ActionId) pour le moteur. Les sous-sorts (effets « lance le sort X ») sont développés en retrait. Les effets marqués *info-bulle uniquement* (`forClientOnly`) décrivent un comportement exécuté côté serveur par l’invocation/le passif : ils ne doivent pas être appliqués tels quels.

### 3.0 Tableau récapitulatif (grade max au niveau 200)

| Paire | Sort (id) | Base/Var. | Niv. | PA | PO | Ligne/LdV | Relance | Lancers | CC | Dégâts/soins principaux (normal) | Rôle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Effondrement (23736) | base | 1 | 3 | 0–3 | /sans LdV | — | 1/t | 15% | 20–22 Terre | dégâts-zone, placement, regroupement |
| 1 | Lance-cyclone (23729) | var. | 100 | 3 | 2–6 | L/sans LdV | — | 1/t | 15% | 31–33 Air | dégâts-zone, mobilité, invocation-lance |
| 2 | Trident de la Mer (23393) | base | 1 | 3 | 1–8+ | L/LdV | — | 2/t | 10% | 21–24 Eau | dégâts-zone, placement |
| 2 | Maelstrom (23747) | var. | 95 | 4 | 0–4 | /sans LdV | — | 2/t | 15% | 32–36 Feu | dégâts-zone, placement |
| 3 | Estoc Brûlant (23754) | base | 1 | 3 | 1–3 | L/LdV | — | 2/t | 10% | 28–32 Feu | dégâts-zone, placement |
| 3 | Octave (23391) | var. | 105 | 2 | 1–3 | L/sans LdV | — | 2/t | 5% | 16–18 Eau | dégâts-mono, mobilité |
| 4 | Volée d'Airain (23741) | base | 1 | 3 | 1–7+ | L/LdV | — | 2/t | 10% | 22–25 Air | dégâts-zone, placement |
| 4 | Soulèvement (23731) | var. | 110 | 3 | 1–1 | /LdV | — | 2/t | 10% | 29–33 Terre | dégâts-zone, placement |
| 5 | Épilogue (23801) | base | 5 | 1 | 1–8 | /LdV | — | 1/t | 0% | — | invocation-lance, rappel |
| 5 | Parade (23386) | var. | 115 | 2 | 0–0 | /sans LdV | 2 | — | 0% | 26–30 meilleur élt | tank, riposte |
| 6 | Charge Héroïque (23824) | base | 10 | 3 | 1–5 | L/LdV | 2 | — | 20% | 29–33 meilleur élt | dégâts-mono, mobilité, rappel |
| 6 | Galanterie (23314) | var. | 120 | 2 | 1–3 | /LdV | — | 1/t | 25% | — | soin, placement |
| 7 | Lance du Lac (23432) | base | 15 | 3 | 1–4+ | /LdV | — | 2/t | 10% | 22–25 Eau | dégâts-zone, invocation-lance |
| 7 | Épieu Sismique (23720) | var. | 125 | 3 | 1–1 | L/LdV | — | 2/t | 10% | 26–29 Terre | dégâts-zone, placement |
| 8 | Lance-pierre (23719) | base | 20 | 3 | 1–5 | /sans LdV | — | 2/t | 10% | 25–28 Terre | dégâts-zone, invocation-lance |
| 8 | Javelot-foudre (23392) | var. | 130 | 3 | 1–5+ | L/sans LdV | — | 2/t 1/c | 10% | 28–32 Eau | dégâts-zone, invocation-lance |
| 9 | Phalange (23330) | base | 25 | 3 | 0–0 | /sans LdV | 3 | — | 0% | — | bouclier, protection |
| 9 | Oriflamme (23828) | var. | 135 | 3 | 1–2 | /sans LdV | 3 | — | 0% | — | bouclier, protection, invocation-lance |
| 10 | Lance à Incendie (23263) | base | 30 | 3 | 0–8 | /LdV | — | 3/t 2/c | 10% | 18–21 Feu | dégâts-zone, rampe, invocation-lance |
| 10 | Pluie d'Airain (24219) | var. | 140 | 2 | 0–2 | /sans LdV | — | 1/t | 10% | 19–21 Air | dégâts-zone, debuff |
| 11 | Javeline de Myr (23734) | base | 35 | 3 | 1–6+ | /LdV | — | 2/t | 10% | 26–30 Air | dégâts-mono, placement, invocation-lance |
| 11 | Moulin Rouge (23755) | var. | 145 | 3 | 0–2 | /sans LdV | — | 1/t | 15% | 24–28 Feu | dégâts-zone, regroupement |
| 12 | Balestra (23434) | base | 40 | 3 | 1–5 | L/sans LdV | — | 1/t | 15% | 28–31 Eau | dégâts-zone, mobilité |
| 12 | Moulin à Vent (23742) | var. | 150 | 3 | 0–2 | /sans LdV | — | 1/t | 15% | 29–33 Air | dégâts-zone, placement |
| 13 | Talon d'Argile (23726) | base | 45 | 2 | 1–4 | /LdV | — | 2/t | 5% | 14–16 Terre | dégâts-mono, rappel, mobilité |
| 13 | Fente (23753) | var. | 155 | 2 | 1–1 | D/sans LdV | — | 1/t | 10% | 12–14 Feu | dégâts-zone, rappel, mobilité |
| 14 | Kyrja (23823) | base | 50 | 3 | 2–5 | L/sans LdV | 3 | — | 25% | 28–32 vol meilleur élt | vol-de-vie, mobilité, rappel |
| 14 | Vajra (23829) | var. | 160 | 4 | 2–4 | /sans LdV | 3 | — | 25% | 39–44 vol meilleur élt | vol-de-vie, mobilité, rappel |
| 15 | Muspel (23750) | base | 55 | 4 | 1–63 | /sans LdV | 2 | — | 25% | 28–32 Feu | dégâts-zone, burst, rappel |
| 15 | Ydra (23723) | var. | 165 | 4 | 0–0 | /sans LdV | 2 | — | 25% | 44–50 Terre | dégâts-zone, tank, rappel |
| 16 | Prélude au Fer (23841) | base | 60 | 2 | 0–2 | /sans LdV | 2 | — | 0% | — | buff, désenvoûtement |
| 16 | Crépuscule (23842) | var. | 170 | 3 | 0–2 | /sans LdV | 2 | — | 0% | — | érosion, retrait-PO, debuff |
| 17 | Terre du Milieu (23738) | base | 65 | 3 | 0–0 | /sans LdV | — | 1/t | 15% | 30–34 Terre | dégâts-zone, buff |
| 17 | Dégagement (23743) | var. | 175 | 4 | 0–0 | /sans LdV | — | 1/t | 20% | 29–32 Air | dégâts-zone, placement, rappel |
| 18 | Chevalerie (23826) | base | 70 | 2 | 0–0 | /sans LdV | 3 | — | 0% | — | soin, buff, rappel |
| 18 | Renommée (23319) | var. | 180 | 2 | 0–6+ | /sans LdV | — | 1/t | 0% | — | soin, placement |
| 19 | Jormun (23268) | base | 75 | 3 | 0–9+ | L/sans LdV | — | 1/t | 15% | 30–34 Eau, 26–30 Eau | dégâts-zone, rappel |
| 19 | Fer Rouge (23756) | var. | 185 | 3 | 0–5 | /sans LdV | — | 1/t | 15% | 30–34 Feu | dégâts-zone, debuff |
| 20 | Poinçon (23401) | base | 80 | 2 | 0–4 | /LdV | 3 | — | 0% | — | entrave, invocation-lance, lock |
| 20 | Étreinte de Valkyr (23838) | var. | 190 | 2 | 0–6 | /sans LdV | 3 | — | 0% | — | protection, érosion |
| 21 | Noa (23735) | base | 85 | 4 | 0–6 | /LdV | 2 | — | 25% | 23–26 Air, 26–29 Air | dégâts-zone, combo-poussée |
| 21 | Elding (23396) | var. | 195 | 4 | 1–6+ | L/sans LdV | 2 | — | 25% | 36–40 Eau | dégâts-zone, regroupement, invocation-lance |
| 22 | Éclipse (23834) | base | 90 | 5 | 0–10+ | /sans LdV | 4 | — | 25% | — | bouclier, dégâts-zone, retrait-PO |
| 22 | Holmgang (23846) | var. | 200 | 4 | 0–0 | /sans LdV | 4 | — | 0% | — | tank, dégâts-zone, lock |


### Paire 1 — Effondrement / Lance-cyclone

#### Effondrement (`23736`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Terre aux ennemis et attire les cibles jusqu'au centre en zone. Les dommages de zone ne sont pas dégressifs. N'affecte pas le lanceur.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g3) : **3 PA** · portée 0–3 (non modifiable) · sans ligne de vue · CC 15% · 1×/tour · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 1) : 3 PA, po 0–3, 13–15 Terre ; g2 (niv. 67) : 3 PA, po 0–3, 16–18 Terre ; g3 (niv. 133) : 3 PA, po 0–3, 20–22 Terre
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–3 PO, sans LdV, 1/tour, CC 15 % ; interdit en Éclipse
  - Étoile 2 (8 directions) : dommages Terre 20–22 (CC 24–26) non dégressifs aux ennemis
  - Attire vers le centre toutes les entités de la zone sauf le lanceur (1, 2 ou 4 cases selon la position) 
  - Désarmé : se lance sur la Lance (zone centrée sur elle), sans rappel
- Effets décodés (données brutes DofusDB) :
  - **20 à 22 dommages Terre (CC : 24 à 26)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone étoile taille 2  `[97]`
  - **Attire la cible de 3 case(s)** → tous sauf le lanceur dans la zone ; zone étoile taille 2, *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Effondrement » (30711, niv. 3)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 30711 « Effondrement » niv.3 :
      - **20 à 22 dommages Terre (CC : 24 à 26)** → ennemis dans la zone ; zone étoile taille 2  `[97]`
      - **Attire la cible de 1 case(s)** → tous sauf le lanceur dans la zone ; zone croix sans centre taille 1  `[6]`
      - **Attire la cible de 1 case(s)** → tous sauf le lanceur dans la zone ; zone croix diagonale (taille min) taille 1  `[6]`
      - **Attire la cible de 2 case(s)** → tous sauf le lanceur dans la zone ; zone croix sans centre taille 2 (min 2)  `[6]`
      - **Attire la cible de 4 case(s)** → tous sauf le lanceur dans la zone ; zone croix diagonale (taille min) taille 2 (min 2)  `[6]`
  - **le lanceur lance sur la case ciblée le sous-sort « Effondrement » (30711, niv. 3)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 30711 niv.3 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Effondrement » (30711, niv. 3)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 30711 niv.3 déjà détaillé plus haut)
- **Analyse / rôle tactique** : Regroupe les monstres autour d'un point (ou de la Lance) avant les zones (Lance-pierre, Terre du Milieu, Ydra). Sort de base clé du regroupement.
- *Notes moteur* : Chemin réel 30711 niv. 3 ; attirances par anneau : Q1 1 case, #1 1 case, Q2(min 2) 2 cases, #2(min 2) 4 cases.

#### Lance-cyclone (`23729`) — variante (obtenu niv. 100)

> Invoque la Lance, rapproche le lanceur vers elle, occasionne des dommages Air aux ennemis et repousse les cibles en zone.

- Caractéristiques (g2) : **3 PA** · portée 2–6 (non modifiable) · en ligne uniquement · sans ligne de vue · case libre requise · CC 15% · 1×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 100) : 3 PA, po 2–5, 25–27 Air ; g2 (niv. 167) : 3 PA, po 2–6, 31–33 Air
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 2–6 PO en ligne, sans LdV, case libre, 1/tour, CC 15 % ; exige Armé ou Reprise de Volée
  - Invoque la Lance sur la case visée (→ Désarmé) puis le lanceur avance de 4 cases vers elle
  - Dommages Air 31–33 (CC 37–40) aux ennemis sur la ligne entre le lanceur et la case visée, puis les repousse de 3
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
  - **Le lanceur avance de 4 case(s) vers la cible** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1042]`
  - **le lanceur lance le sous-sort « Lance-Cyclone » (23744, niv. 3)** → lanceur  `[1160]`
    - ↳ sous-sort 23744 « Lance-Cyclone » niv.3 :
      - **Le lanceur avance de 4 case(s) vers la cible** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; zone tout le terrain (vivants)  `[1042]`
  - **31 à 33 dommages Air (CC : 37 à 40)** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[98]`
  - **le lanceur lance le sous-sort « Lance-Cyclone » (23744, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[1160]`
    - ↳ sous-sort 23744 « Lance-Cyclone » niv.1 :
      - **Applique l'état « Lance-Cyclone » (3474)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Lance-Cyclone » (23744, niv. 2)** → lanceur  `[1160]`
    - ↳ sous-sort 23744 « Lance-Cyclone » niv.2 :
      - **Retire l'état « Lance-Cyclone » (3474)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Lance-Cyclone » (3474) ; zone tout le terrain (vivants)  `[951]`
      - **Repousse la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Lance-Cyclone » (3474) ; zone tout le terrain (vivants)  `[5]`
  - **Repousse la cible de 3 case(s)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
- **Analyse / rôle tactique** : Engagement : lance la Lance loin, fonce vers elle en frappant tout l'alignement.
- *Notes moteur* : Ligne l1,63 stopAtTarget calculée depuis la position de départ ; état 3474 marque les entités touchées pour la poussée.


### Paire 2 — Trident de la Mer / Maelstrom

#### Trident de la Mer (`23393`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Eau aux ennemis et attire les cibles vers la case ciblée en zone.

- Caractéristiques (g3) : **3 PA** · portée 1–8 (modifiable) · en ligne uniquement · ligne de vue requise · CC 10% · 2×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 13–15 Eau ; g2 (niv. 66) : 3 PA, po 1–7, 17–19 Eau ; g3 (niv. 132) : 3 PA, po 1–8, 21–24 Eau
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–8 PO modifiable en ligne, LdV, 2/tour ; exige Armé ou Reprise de Volée
  - Fourche 1 : dommages Eau 21–24 (CC 25–29) aux ennemis
  - Attire les entités touchées vers la case visée (2 ou 4 cases)
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Applique l'état « Trident de la Mer (attirance diagonale) » (3743)** → tous (alliés+ennemis) dans la zone ; zone fourche taille 1, 1 tour(s)  `[950]`
  - **21 à 24 dommages Eau (CC : 25 à 29)** → ennemis dans la zone ; zone fourche taille 1  `[96]`
  - **le lanceur lance sur la case ciblée le sous-sort « Trident de la Mer » (24739, niv. 1)** → lanceur  `[2960]`
    - ↳ sous-sort 24739 « Trident de la Mer » niv.1 :
      - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Trident de la Mer (attirance diagonale) » (3743) ; zone ligne taille 2  `[6]`
      - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Trident de la Mer (attirance diagonale) » (3743) ; zone croix diagonale taille 1 (min 1)  `[6]`
      - **Attire la cible de 4 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Trident de la Mer (attirance diagonale) » (3743) ; zone croix diagonale taille 2 (min 2)  `[6]`
      - **Retire l'état « Trident de la Mer (attirance diagonale) » (3743)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Trident de la Mer (attirance diagonale) » (3743) ; zone tout le terrain (vivants)  `[951]`
  - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone fourche taille 1, *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
- **Analyse / rôle tactique** : Zone Eau à longue portée qui resserre les cibles.
- *Notes moteur* : Sous-sort 24739 (attirances conditionnées à l'état 3743).

#### Maelstrom (`23747`) — variante (obtenu niv. 95)

> Échange de position avec la cible et occasionne des dommages Feu aux ennemis en zone.

- Caractéristiques (g2) : **4 PA** · portée 0–4 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 15% · 2×/tour · condition : (lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)) ET lanceur n’a pas l’état « Pesanteur » (7)
- Grades : g1 (niv. 95) : 4 PA, po 0–4, 26–29 Feu ; g2 (niv. 162) : 4 PA, po 0–4, 32–36 Feu
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 0–4 PO, sans LdV, case occupée, 2/tour, CC 15 % ; Armé/Reprise, pas Pesanteur
  - Échange de position avec la cible (alliée hors lanceur ou ennemie)
  - Cercle 2 : dommages Feu 32–36 (CC 38–43) aux ennemis
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Échange de positions (lanceur ↔ cible)** → cible (hors lanceur)  `[8]`
  - **32 à 36 dommages Feu (CC : 38 à 43)** → ennemis dans la zone ; zone cercle taille 2  `[99]`
- **Analyse / rôle tactique** : Transposition + zone Feu (sauvetage d'allié ou mise en position du boss).
- *Notes moteur* : Zone calculée au début (instantané) autour de la case visée.


### Paire 3 — Estoc Brûlant / Octave

#### Estoc Brûlant (`23754`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Feu aux ennemis et repousse les cibles depuis le lanceur en zone.

- Caractéristiques (g3) : **3 PA** · portée 1–3 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 10% · 2×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 1) : 3 PA, po 1–3, 17–19 Feu ; g2 (niv. 68) : 3 PA, po 1–3, 22–25 Feu ; g3 (niv. 134) : 3 PA, po 1–3, 28–32 Feu
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–3 PO en ligne, LdV, 2/tour ; Armé/Reprise
  - Cône 2 : dommages Feu 28–32 (CC 34–38) aux ennemis
  - Repousse de 3 cases (depuis le lanceur) les entités touchées
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **28 à 32 dommages Feu (CC : 34 à 38)** → ennemis dans la zone ; zone cône taille 2  `[99]`
  - **Applique l'état « Estoc Brûlant » (6032)** → tous (alliés+ennemis) dans la zone ; zone cône taille 2, 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Estoc Brûlant » (29796, niv. 2)** → lanceur ; zone cône taille 2  `[1160]`
    - ↳ sous-sort 29796 « Estoc Brûlant » niv.2 :
      - **Repousse la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Estoc Brûlant » (6032) ; zone tout le terrain (vivants)  `[5]`
      - **Retire l'état « Estoc Brûlant » (6032)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Estoc Brûlant » (6032) ; zone tout le terrain  `[951]`
  - **Repousse la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone ; zone cône taille 2, *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
- **Analyse / rôle tactique** : Zone Feu de mêlée qui dégage un passage.
- *Notes moteur* : État 6032 + sous-sort 29796.

#### Octave (`23391`) — variante (obtenu niv. 105)

> Éloigne le lanceur de la cible et occasionne des dommages Eau aux ennemis.

- Caractéristiques (g2) : **2 PA** · portée 1–3 (non modifiable) · en ligne uniquement · sans ligne de vue · CC 5% · 2×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 105) : 2 PA, po 1–3, 13–15 Eau ; g2 (niv. 172) : 2 PA, po 1–3, 16–18 Eau
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–3 PO en ligne, sans LdV, 2/tour, CC 5 % ; Armé/Reprise
  - Le lanceur recule de 2 cases
  - Dommages Eau 16–18 (CC 19–22) aux ennemis
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Le lanceur recule de 2 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie)  `[1041]`
  - **16 à 18 dommages Eau (CC : 19 à 22)** → cible ennemie  `[96]`
- **Analyse / rôle tactique** : Filler à 2 PA qui désengage.


### Paire 4 — Volée d'Airain / Soulèvement

#### Volée d'Airain (`23741`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Air aux ennemis et repousse les cibles en zone.

- Caractéristiques (g3) : **3 PA** · portée 1–7 (modifiable) · en ligne uniquement · ligne de vue requise · CC 10% · 2×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 1) : 3 PA, po 1–5, 14–16 Air ; g2 (niv. 69) : 3 PA, po 1–6, 18–20 Air ; g3 (niv. 136) : 3 PA, po 1–7, 22–25 Air
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–7 PO modifiable en ligne, LdV, 2/tour ; Armé/Reprise
  - Demi-cercle 1 (3 cases) : dommages Air 22–25 (CC 26–30) aux ennemis
  - Repousse de 2 cases les entités touchées
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **22 à 25 dommages Air (CC : 26 à 30)** → ennemis dans la zone ; zone demi-cercle taille 1  `[98]`
  - **le lanceur lance le sous-sort « Volée d'Airain » (24575, niv. 1)** → tous (alliés+ennemis) dans la zone ; zone demi-cercle taille 1  `[1160]`
    - ↳ sous-sort 24575 « Volée d'Airain » niv.1 :
      - **Repousse la cible de 2 case(s)** → cible (alliée ou ennemie)  `[5]`
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone demi-cercle taille 1, *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
- **Analyse / rôle tactique** : Sort Air de base à distance.

#### Soulèvement (`23731`) — variante (obtenu niv. 110)

> Téléporte les cibles symétriquement par rapport au lanceur et occasionne des dommages Terre aux ennemis en zone. Les dommages de zone ne sont pas dégressifs.

- Caractéristiques (g2) : **3 PA** · portée 1–1 (non modifiable) · ligne de vue requise · CC 10% · 2×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 110) : 3 PA, po 1–1, 23–27 Terre ; g2 (niv. 177) : 3 PA, po 1–1, 29–33 Terre
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1 PO, LdV, 2/tour ; Armé/Reprise
  - Barre perpendiculaire 1 (3 cases) : téléporte les cibles symétriquement par rapport au lanceur
  - Dommages Terre 29–33 (CC 35–40) non dégressifs aux ennemis
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Téléportation symétrique par rapport au lanceur** → tous (alliés+ennemis) dans la zone ; zone ligne perpendiculaire (barre en T) taille 1  `[1105]`
  - **29 à 33 dommages Terre (CC : 35 à 40)** → ennemis dans la zone ; zone ligne perpendiculaire (barre en T) taille 1  `[97]`
- **Analyse / rôle tactique** : Fait passer derrière soi jusqu'à 3 ennemis/alliés adjacents (retournement de ligne).
- *Notes moteur* : 1105 sur la zone T1.


### Paire 5 — Épilogue / Parade

#### Épilogue (`23801`) — sort de base (obtenu niv. 5)

> Invoque ou rappelle la Lance.  La ligne de vue du sort est désactivée si le lanceur est Désarmé.

- Caractéristiques (g3) : **1 PA** · portée 1–8 (non modifiable) · ligne de vue requise · CC 0% · 1×/tour · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 5) : 1 PA, po 1–6 ; g2 (niv. 72) : 1 PA, po 1–7 ; g3 (niv. 139) : 1 PA, po 1–8
- **Résumé des effets (lecture humaine)** :
  - 1 PA, 1–8 PO, LdV (désactivée si Désarmé), 1/tour ; pas en Éclipse
  - Armé : invoque la Lance sur la case visée (case libre requise) → Désarmé
  - Désarmé : cibler la Lance la rappelle (→ Armé, +30 Puissance)
  - Reprise de Volée : récupère puis relance la Lance
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone — si lanceur a l'état « Reprise de Volée » (3589) ; zone cercle taille 0  `[181]`
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone — si lanceur a l'état « Armé » (3360) ; zone cercle taille 0  `[181]`
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
- **Analyse / rôle tactique** : Interrupteur à 1 PA : place la Lance au centre d'un paquet ou la récupère depuis n'importe où (sans ligne de vue). Quasi indispensable.
- *Notes moteur* : Chemins conditionnés *E3360 / *E3589 / F7139+*E3361.

#### Parade (`23386`) — variante (obtenu niv. 115)

> Rappelle immédiatement la Lance et de nouveau à la fin du tour du lanceur en remplaçant la Garde par la Parade : • Rend le lanceur Indéplaçable. • Réduit les dommages subis en mêlée. • Occasionne des dommages dans son meilleur élément et repousse son attaquant s'il subit des dommages en mêlée.  La Parade est retirée après la première attaque subie en mêlée. Les effets d'interception et de partage de dommages sont incompatibles avec le sort.

- Caractéristiques (g2) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 2 t. · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 115) : 2 PA, po 0–0, 21–24 meilleur élt ; g2 (niv. 182) : 2 PA, po 0–0, 26–30 meilleur élt
- **Résumé des effets (lecture humaine)** :
  - 2 PA, sur soi, relance 2 ; pas en Éclipse
  - Rappelle la Lance (et à nouveau en fin de tour)
  - Jusqu'au début du prochain tour, remplace la Garde par la Parade : Indéplaçable ; dommages de mêlée subis ×25 % ; à la 1re attaque de mêlée subie : riposte de 26–30 dommages du meilleur élément et repousse l'attaquant de 3, puis la Parade disparaît
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **Applique l'état « Parade » (6992)** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Parade » (24462, niv. 3)** → lanceur  `[1160]`
    - ↳ sous-sort 24462 « Parade » niv.3 :
      - **Applique l'état « Parade » (3378)** → lanceur ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Parade » (24462, niv. 2)** → lanceur ; actif 1 tour(s), déclencheur : fin de tour du porteur, non désenvoûtable  `[1160]`
    - ↳ sous-sort 24462 « Parade » niv.2 :
      - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
        - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
      - **la cible lance (sur elle-même) le sous-sort « Garde » (24390, niv. 2)** → lanceur  `[792]`
        - ↳ sous-sort 24390 niv.2 : Garde : ×85 % dommages subis jusqu'au début du tour suivant (si Armé, hors Parade/Holmgang/Reprise de Volée).
      - **Applique l'état « Parade » (6992)** → lanceur — si cible n'a PAS l'état « Sacrifice » (583) ; 1 tour(s)  `[950]`
      - **Applique l'état « Indéplaçable » (97)** → lanceur — si cible n'a PAS l'état « Sacrifice » (583) ; 1 tour(s)  `[950]`
      - **Dommages subis x25%** → lanceur — si cible n'a PAS l'état « Sacrifice » (583) ; actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case)  `[1163]`
      - **le lanceur lance le sous-sort « Parade » (23387, niv. 2)** → lanceur — si cible n'a PAS l'état « Sacrifice » (583) ; actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case)  `[1160]`
        - ↳ sous-sort 23387 « Parade » niv.2 :
          - **le lanceur lance le sous-sort « Parade » (23387, niv. 4)** → alliés hors lanceur, ennemis, l'entité qui a déclenché l'effet (attaquant)  `[1160]`
            - ↳ sous-sort 23387 « Parade » niv.4 :
              - **Retire les effets du sort « Parade » (23386)** → lanceur  `[406]`
              - **Retire les effets du sort « Parade » (24462)** → lanceur  `[406]`
              - **26 à 30 dommages du meilleur élément** → cible (hors lanceur)  `[2822]`
              - **Repousse la cible de 3 case(s)** → cible (hors lanceur)  `[5]`
              - **Retire les effets du sort « Garde » (24390)** → lanceur  `[406]`
      - **Retire les effets du sort « Parade » (23386)** → lanceur — si cible n'a PAS l'état « Sacrifice » (583) ; actif 1 tour(s), déclencheur : quand l'état « Sacrifice » (583) est appliqué OU début de tour du porteur  `[406]`
      - **Retire les effets du sort « Garde » (24390)** → lanceur — si cible n'a PAS l'état « Sacrifice » (583) ; actif 1 tour(s), déclencheur : quand l'état « Sacrifice » (583) est appliqué  `[406]`
      - **Retire les effets du sort « Parade » (24462)** → lanceur — si cible n'a PAS l'état « Sacrifice » (583) ; actif 1 tour(s), déclencheur : quand l'état « Sacrifice » (583) est appliqué OU début de tour du porteur  `[406]`
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **Applique l'état « Indéplaçable » (97)** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Dommages subis x25%** → lanceur ; actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1163]`
  - **26 à 30 dommages du meilleur élément** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[2822]`
  - **Repousse la cible de 3 case(s)** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
- **Analyse / rôle tactique** : Défense anti-mêlée majeure (−75 % sur le premier coup de mêlée) à lancer en fin de tour au contact du boss.
- *Notes moteur* : Sous-sorts 24462/23387 ; incompatible avec Sacrifice (état 583).


### Paire 6 — Charge Héroïque / Galanterie

#### Charge Héroïque (`23824`) — sort de base (obtenu niv. 10)

> Rappelle la Lance, rapproche le lanceur vers la cible et occasionne des dommages dans son meilleur élément aux ennemis. Repousse également la cible si le lanceur termine à son contact.  La poussée est plus importante selon la distance entre le lanceur et la cible.

- Caractéristiques (g3) : **3 PA** · portée 1–5 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 20% · relance 2 t. · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 10) : 3 PA, po 1–3, 17–20 meilleur élt ; g2 (niv. 77) : 3 PA, po 1–4, 23–27 meilleur élt ; g3 (niv. 144) : 3 PA, po 1–5, 29–33 meilleur élt
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–5 PO en ligne, LdV, relance 2, CC 20 % ; pas en Éclipse
  - Rappelle la Lance ; le lanceur avance de 4 cases vers la cible
  - Dommages du meilleur élément 29–33 (CC 35–40) aux ennemis
  - S'il termine au contact : repousse la cible d'autant de cases que la distance initiale (1 à 5)
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **Applique l'état « Charge Héroïque » (3494)** → cible (alliée ou ennemie) ; durée infinie  `[950]`
  - **le lanceur lance le sous-sort « Charge Héroïque » (24505, niv. 1)** → lanceur  `[1160]`
    - ↳ sous-sort 24505 « Charge Héroïque » niv.1 :
      - **le lanceur lance le sous-sort « Charge Héroïque » (24505, niv. 2)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ; zone anneau taille 1  `[1160]`
        - ↳ sous-sort 24505 « Charge Héroïque » niv.2 :
          - **Applique l'état « Charge Héroïque 1 » (3612)** → lanceur ; durée infinie, non désenvoûtable  `[950]`
      - **le lanceur lance le sous-sort « Charge Héroïque » (24505, niv. 3)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ; zone anneau taille 2  `[1160]`
        - ↳ sous-sort 24505 « Charge Héroïque » niv.3 :
          - **Applique l'état « Charge Héroïque 2 » (3613)** → lanceur ; durée infinie, non désenvoûtable  `[950]`
      - **le lanceur lance le sous-sort « Charge Héroïque » (24505, niv. 4)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ; zone anneau taille 3  `[1160]`
        - ↳ sous-sort 24505 « Charge Héroïque » niv.4 :
          - **Applique l'état « Charge Héroïque 3 » (3614)** → lanceur ; durée infinie, non désenvoûtable  `[950]`
      - **le lanceur lance le sous-sort « Charge Héroïque » (24505, niv. 5)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ; zone anneau taille 4  `[1160]`
        - ↳ sous-sort 24505 « Charge Héroïque » niv.5 :
          - **Applique l'état « Charge Héroïque 4 » (3615)** → lanceur ; durée infinie, non désenvoûtable  `[950]`
      - **le lanceur lance le sous-sort « Charge Héroïque » (24505, niv. 6)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ; zone cercle illimitée (63) (min 5)  `[1160]`
        - ↳ sous-sort 24505 « Charge Héroïque » niv.6 :
          - **Applique l'état « Charge Héroïque 5 » (3616)** → lanceur ; durée infinie, non désenvoûtable  `[950]`
  - **Le lanceur avance de 4 case(s) vers la cible** → cible (alliée ou ennemie)  `[1042]`
  - **29 à 33 dommages du meilleur élément (CC : 35 à 40)** → cible ennemie  `[2822]`
  - **Repousse la cible de 1 case(s)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
  - **Repousse la cible de 5 case(s)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
  - **la cible lance (sur elle-même) le sous-sort « Charge Héroïque » (23825, niv. 1) (CC : 23825)** → lanceur  `[792]`
    - ↳ sous-sort 23825 « Charge Héroïque » niv.1 :
      - **Repousse la cible de 1 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ET si lanceur a l'état « Charge Héroïque 1 » (3612) ; zone croix sans centre taille 1  `[5]`
      - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ET si lanceur a l'état « Charge Héroïque 2 » (3613) ; zone croix sans centre taille 1  `[5]`
      - **Repousse la cible de 3 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ET si lanceur a l'état « Charge Héroïque 3 » (3614) ; zone croix sans centre taille 1  `[5]`
      - **Repousse la cible de 4 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ET si lanceur a l'état « Charge Héroïque 4 » (3615) ; zone croix sans centre taille 1  `[5]`
      - **Repousse la cible de 5 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Charge Héroïque » (3494) ET si lanceur a l'état « Charge Héroïque 5 » (3616) ; zone croix sans centre taille 1  `[5]`
      - **Retire l'état « Charge Héroïque » (3494)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[951]`
      - **Retire les effets du sort « Charge Héroïque » (24505)** → lanceur  `[406]`
- **Analyse / rôle tactique** : Engagement + rappel + grosse poussée (dommages de poussée).
- *Notes moteur* : États 3612–3616 mesurent la distance initiale (anneaux 1–4, ≥5) ; poussée via 23825.

#### Galanterie (`23314`) — variante (obtenu niv. 120)

> Éloigne le lanceur de la cible, attire la cible et soigne le lanceur et l'allié ciblé.  Rappelle également la Lance si elle est ciblée.

- Caractéristiques (g2) : **2 PA** · portée 1–3 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 25% · 1×/tour
- Grades : g1 (niv. 120) : 2 PA, po 1–3 ; g2 (niv. 187) : 2 PA, po 1–3
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–3 PO, LdV, case occupée, 1/tour, CC 25 %
  - Le lanceur recule de 2 cases et attire la cible de 3
  - Soigne le lanceur de 7 % PV max (CC 9 %) et l'allié ciblé de 7 % (CC 9 %)
  - Rappelle la Lance si elle est ciblée
- Effets décodés (données brutes DofusDB) :
  - **Le lanceur recule de 2 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie)  `[1041]`
  - **Attire la cible de 3 case(s)** → cible (alliée ou ennemie)  `[6]`
  - **Soin : 7% des PV max (CC : 9)** → lanceur  `[1109]`
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **Soin : 7% des PV max (CC : 9)** → cible alliée  `[1109]`
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
- **Analyse / rôle tactique** : Rapatrie un allié en danger en le soignant.


### Paire 7 — Lance du Lac / Épieu Sismique

#### Lance du Lac (`23432`) — sort de base (obtenu niv. 15)

> Occasionne des dommages Eau aux ennemis en zone et invoque la Lance.

- Caractéristiques (g3) : **3 PA** · portée 1–4 (modifiable) · ligne de vue requise · case libre requise · CC 10% · 2×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 15) : 3 PA, po 1–4, 13–15 Eau ; g2 (niv. 82) : 3 PA, po 1–4, 17–20 Eau ; g3 (niv. 149) : 3 PA, po 1–4, 22–25 Eau
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–4 PO modifiable, LdV, case libre, 2/tour ; Armé/Reprise
  - Cercle 2 (hors centre) : dommages Eau 22–25 (CC 26–30) aux ennemis
  - Invoque la Lance au centre (→ Désarmé)
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **22 à 25 dommages Eau (CC : 26 à 30)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[96]`
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
- **Analyse / rôle tactique** : Lance la Lance au milieu d'un paquet en le frappant.

#### Épieu Sismique (`23720`) — variante (obtenu niv. 125)

> Occasionne des dommages Terre aux ennemis et repousse les cibles depuis la case ciblée en zone. Les dommages de zone ne sont pas dégressifs.

- Caractéristiques (g2) : **3 PA** · portée 1–1 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 10% · 2×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 125) : 3 PA, po 1–1, 21–24 Terre ; g2 (niv. 192) : 3 PA, po 1–1, 26–29 Terre
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1 PO en ligne, LdV, 2/tour ; Armé/Reprise
  - Rectangle devant le lanceur : dommages Terre 26–29 (CC 31–36) non dégressifs aux ennemis
  - Repousse de 2 cases depuis la case visée les entités de la zone
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **26 à 29 dommages Terre (CC : 31 à 36)** → ennemis dans la zone ; zone rectangle taille 1 (min 3)  `[97]`
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone rectangle taille 1 (min 3)  `[5]`
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0, *info-bulle uniquement (comportement réel géré côté serveur)*  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
- **Analyse / rôle tactique** : Zone Terre de mêlée.
- *Notes moteur* : Zone R1,3 (rectangle orienté, dimensions INCERTAINES : ≈ 3 de large) ; l'invocation de la Lance affichée est forClientOnly (pas d'invocation réelle).


### Paire 8 — Lance-pierre / Javelot-foudre

#### Lance-pierre (`23719`) — sort de base (obtenu niv. 20)

> Occasionne des dommages Terre aux ennemis en zone et invoque la Lance. Les dommages de zone ne sont pas dégressifs.

- Caractéristiques (g3) : **3 PA** · portée 1–5 (non modifiable) · sans ligne de vue · case libre requise · CC 10% · 2×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 20) : 3 PA, po 1–3, 15–17 Terre ; g2 (niv. 87) : 3 PA, po 1–4, 19–21 Terre ; g3 (niv. 154) : 3 PA, po 1–5, 25–28 Terre
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–5 PO, sans LdV, case libre, 2/tour ; Armé/Reprise
  - Cercle 3 (hors centre) : dommages Terre 25–28 (CC 30–34) non dégressifs aux ennemis
  - Invoque la Lance au centre
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **25 à 28 dommages Terre (CC : 30 à 34)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[97]`
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
- **Analyse / rôle tactique** : Grande zone Terre (cercle 3) sans ligne de vue — excellent ouvreur.

#### Javelot-foudre (`23392`) — variante (obtenu niv. 130)

> Invoque la Lance et occasionne des dommages Eau aux ennemis en zone. Rebondit également sur l'ennemi le plus proche n'étant pas dans la zone d'effet dans un cercle de taille 2 si la case est occupée.

- Caractéristiques (g2) : **3 PA** · portée 1–5 (modifiable) · en ligne uniquement · sans ligne de vue · CC 10% · 2×/tour · 1×/cible · 3×/tour « global » (maxGlobalCastPerTurn, sens INCERTAIN) · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 130) : 3 PA, po 1–5, 23–26 Eau ; g2 (niv. 197) : 3 PA, po 1–5, 28–32 Eau
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–5 PO modifiable en ligne, sans LdV, 2/tour, 1/cible (3 globaux) ; Armé/Reprise
  - Dommages Eau 28–32 (CC 35–39) aux ennemis sur la ligne jusqu'à la case visée ; invoque la Lance si la case est libre
  - Si la case visée est occupée par un ennemi : rebondit sur l'ennemi le plus proche (cercle 2) non touché, puis de proche en proche (chaîne)
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Javelot-foudre » (25449, niv. 7)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 25449 niv.7 : marque « Javelot-Foudre (ciblé) » (3943) sur le lanceur si la case visée contient un ennemi (autorise les rebonds).
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
  - **28 à 32 dommages Eau (CC : 35 à 39)** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[96]`
  - **Applique l'état « Javelot-Foudre (ligne) » (3942)** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63), 1 tour(s)  `[950]`
  - **la cible lance sur la case ciblée le sous-sort « Javelot-foudre » (25449, niv. 3)** → lanceur  `[2794]`
    - ↳ sous-sort 25449 niv.3 : rebond : depuis la cible, frappe l'ennemi le plus proche (cercle 2, limité à 1) non encore touché — 28–32 Eau (CC 35–39) — puis rebondit de nouveau depuis lui (chaîne jusqu'à épuisement des ennemis).
  - **la cible lance (sur elle-même) le sous-sort « Javelot-foudre » (25449, niv. 8)** → lanceur  `[792]`
    - ↳ sous-sort 25449 niv.8 : nettoyage des états et effets du Javelot-foudre en fin de lancer.
- **Analyse / rôle tactique** : Excellent contre des monstres espacés de ≤ 2 cases (chaîne illimitée).
- *Notes moteur* : États 3942 (déjà touché) et 3943 (ciblé) ; 2160 limite chaque rebond à une cible.


### Paire 9 — Phalange / Oriflamme

#### Phalange (`23330`) — sort de base (obtenu niv. 25)

> Applique un bouclier sur les alliés et augmente leurs Résistances Poussée en zone.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g3) : **3 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t. · cumul max 1 · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 25) : 3 PA, po 0–0 ; g2 (niv. 92) : 3 PA, po 0–0 ; g3 (niv. 159) : 3 PA, po 0–0
- **Résumé des effets (lecture humaine)** :
  - 3 PA, sur soi (Armé) ou sur la Lance (Désarmé), relance 3
  - Cercle 2 : bouclier 300 % du niveau (600 au niveau 200, 2 tours) et +100 Résistances Poussée aux alliés
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Phalange » (24806, niv. 3)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 24806 « Phalange » niv.3 :
      - **Retire les effets du sort « Phalange » (24806)** → lanceur (s’il est dans la zone) ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[406]`
      - **Retire les effets du sort « Phalange » (24806)** → alliés (hors lanceur) dans la zone ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[406]`
      - **Bouclier : 400% du niveau** → lanceur (s’il est dans la zone) ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1020]`
      - **Bouclier : 300% du niveau** → alliés dans la zone ; zone cercle taille 2, 2 tour(s)  `[1020]`
      - **100 Résistances Poussée** → alliés dans la zone ; zone cercle taille 2, 2 tour(s)  `[416]`
  - **le lanceur lance sur la case ciblée le sous-sort « Phalange » (24806, niv. 3)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 24806 niv.3 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Phalange » (24806, niv. 3)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 24806 niv.3 déjà détaillé plus haut)
  - **Bouclier : 300% du niveau** → alliés dans la zone ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1020]`
  - **100 Résistances Poussée** → alliés dans la zone ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[416]`
- **Analyse / rôle tactique** : Bouclier de groupe autour de soi ou de la Lance.
- *Notes moteur* : Sous-sort 24806 niv. 3 (les lignes 400 % pour le lanceur sont forClientOnly).

#### Oriflamme (`23828`) — variante (obtenu niv. 135)

> Rappelle et invoque la Lance, applique un bouclier sur les alliés et augmente leurs Résistances Critiques en zone.

- Caractéristiques (g1) : **3 PA** · portée 1–2 (non modifiable) · sans ligne de vue · case libre requise · CC 0% · relance 3 t. · cumul max 1 · condition : lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–2 PO, sans LdV, case libre, relance 3
  - Rappelle puis invoque la Lance sur la case visée
  - Cercle 2 autour de la Lance : bouclier 300 % du niveau et +60 Résistances Critiques aux alliés (2 tours)
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible alliée ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
  - **Bouclier : 300% du niveau** → alliés dans la zone ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1020]`
  - **60 Résistances Critiques** → alliés dans la zone ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[420]`
  - **la cible lance sur la case ciblée le sous-sort « Oriflamme » (24811, niv. 1)** → lanceur  `[2794]`
    - ↳ sous-sort 24811 « Oriflamme » niv.1 :
      - **Bouclier : 300% du niveau** → alliés dans la zone ; zone cercle taille 2, 2 tour(s)  `[1020]`
      - **60 Résistances Critiques** → alliés dans la zone ; zone cercle taille 2, 2 tour(s)  `[420]`
- **Analyse / rôle tactique** : Bouclier de groupe + repositionnement de la Lance (Étendard ×90 %).


### Paire 10 — Lance à Incendie / Pluie d'Airain

#### Lance à Incendie (`23263`) — sort de base (obtenu niv. 30)

> Occasionne des dommages Feu aux ennemis en zone. Invoque la Lance si la case est ou devient libre.  Les dommages du sort sont augmentés après chaque lancer.

- Caractéristiques (g3) : **3 PA** · portée 0–8 (non modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible · cumul max 4 · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 30) : 3 PA, po 0–6, 11–13 Feu ; g2 (niv. 97) : 3 PA, po 0–7, 14–17 Feu ; g3 (niv. 164) : 3 PA, po 0–8, 18–21 Feu
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–8 PO, LdV, 3/tour, 2/cible, CC 10 % ; Armé/Reprise
  - Croix 1 : dommages Feu 18–21 (CC 22–26) aux ennemis
  - +5 dégâts de base au sort par lancer (3 tours, cumul 4 ⇒ +20)
  - Invoque la Lance si la case est (ou devient) libre
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **18 à 21 dommages Feu (CC : 22 à 26)** → ennemis dans la zone ; zone croix taille 1  `[99]`
  - **Lance à Incendie : +5 dégâts de base** → lanceur ; 3 tour(s)  `[293]`
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
- **Analyse / rôle tactique** : Rampe Feu à 8 PO (3 lancers/tour).
- *Notes moteur* : 293 +5 (maxStack 4).

#### Pluie d'Airain (`24219`) — variante (obtenu niv. 140)

> Occasionne des dommages Air aux ennemis et réduit leurs Résistances Poussée en zone. Les dommages de zone ne sont pas dégressifs.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g1) : **2 PA** · portée 0–2 (non modifiable) · sans ligne de vue · CC 10% · 1×/tour · cumul max 2 · condition : lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–2 PO, sans LdV, 1/tour, CC 10 % ; pas en Éclipse
  - Carré 2 (5×5) : dommages Air 19–21 (CC 23–25) non dégressifs et −40 Résistances Poussée (2 tours, cumul 2) aux ennemis
  - Désarmé : centré sur la Lance
- Effets décodés (données brutes DofusDB) :
  - **19 à 21 dommages Air (CC : 23 à 25)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone carré taille 2  `[98]`
  - **-40 Résistances Poussée** → ennemis dans la zone ; zone carré taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[417]`
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Pluie d'Airain » (30714, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 30714 « Pluie d'Airain » niv.1 :
      - **19 à 21 dommages Air (CC : 23 à 25)** → ennemis dans la zone ; zone carré taille 2  `[98]`
      - **le lanceur lance le sous-sort « Pluie d'Airain » (30714, niv. 2)** → ennemis dans la zone ; zone carré taille 2  `[1160]`
        - ↳ sous-sort 30714 « Pluie d'Airain » niv.2 :
          - **-40 Résistances Poussée** → cible ennemie ; 2 tour(s)  `[417]`
  - **le lanceur lance sur la case ciblée le sous-sort « Pluie d'Airain » (30714, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 30714 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Pluie d'Airain » (30714, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 30714 niv.1 déjà détaillé plus haut)
- **Analyse / rôle tactique** : Grande zone Air à 2 PA + préparation des dommages de poussée.
- *Notes moteur* : 30714.


### Paire 11 — Javeline de Myr / Moulin Rouge

#### Javeline de Myr (`23734`) — sort de base (obtenu niv. 35)

> Occasionne des dommages Air aux ennemis et repousse la cible. Invoque la Lance si la case est ou devient libre.

- Caractéristiques (g3) : **3 PA** · portée 1–6 (modifiable) · ligne de vue requise · CC 10% · 2×/tour · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- Grades : g1 (niv. 35) : 3 PA, po 1–4, 16–18 Air ; g2 (niv. 102) : 3 PA, po 1–5, 21–24 Air ; g3 (niv. 169) : 3 PA, po 1–6, 26–30 Air
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–6 PO modifiable, LdV, 2/tour ; Armé/Reprise
  - Dommages Air 26–30 (CC 31–36) puis repousse la cible de 2 cases
  - Invoque la Lance sur la case si elle est (ou devient) libre
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **26 à 30 dommages Air (CC : 31 à 36)** → cible ennemie  `[98]`
  - **Repousse la cible de 2 case(s)** → cible (alliée ou ennemie)  `[5]`
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
- **Analyse / rôle tactique** : Pose la Lance à la place de l'ennemi repoussé (la Lance s'interpose).

#### Moulin Rouge (`23755`) — variante (obtenu niv. 145)

> Occasionne des dommages Feu aux ennemis et attire les cibles jusqu'au centre en zone. Les dommages de zone ne sont pas dégressifs. N'affecte pas le lanceur.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g1) : **3 PA** · portée 0–2 (non modifiable) · sans ligne de vue · CC 15% · 1×/tour · condition : lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–2 PO, sans LdV, 1/tour, CC 15 % ; pas en Éclipse
  - Croix 2 + anneau 3 : dommages Feu 24–28 (CC 29–34) non dégressifs aux ennemis
  - Attire vers le centre les entités de la zone (sauf le lanceur)
  - Désarmé : centré sur la Lance
- Effets décodés (données brutes DofusDB) :
  - **24 à 28 dommages Feu (CC : 29 à 34)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone croix taille 2  `[99]`
  - **24 à 28 dommages Feu (CC : 29 à 34)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone anneau taille 3  `[99]`
  - **Attire la cible de 3 case(s)** → tous sauf le lanceur dans la zone ; zone croix taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **Attire la cible de 6 case(s)** → tous sauf le lanceur dans la zone ; zone anneau taille 3, *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Moulin Rouge » (30746, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 30746 « Moulin Rouge » niv.1 :
      - **24 à 28 dommages Feu (CC : 29 à 34)** → ennemis dans la zone ; zone croix taille 2  `[99]`
      - **24 à 28 dommages Feu (CC : 29 à 34)** → ennemis dans la zone ; zone anneau taille 3  `[99]`
      - **Attire la cible de 1 case(s)** → tous sauf le lanceur dans la zone ; zone croix sans centre taille 1 (min 1)  `[6]`
      - **Attire la cible de 2 case(s)** → tous sauf le lanceur dans la zone ; zone croix sans centre taille 2 (min 2)  `[6]`
      - **Attire la cible de 3 case(s)** → tous sauf le lanceur dans la zone ; zone anneau taille 3  `[6]`
  - **le lanceur lance sur la case ciblée le sous-sort « Moulin Rouge » (30746, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 30746 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Moulin Rouge » (30746, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 30746 niv.1 déjà détaillé plus haut)
- **Analyse / rôle tactique** : Grand regroupement Feu (rayon 3).
- *Notes moteur* : 30746.


### Paire 12 — Balestra / Moulin à Vent

#### Balestra (`23434`) — sort de base (obtenu niv. 40)

> Téléporte le lanceur jusqu'à la cible, le téléporte symétriquement et l'éloigne par rapport à cette dernière et occasionne des dommages Eau aux ennemis en zone.  La téléportation symétrique et le recul sont appliqués uniquement si le lanceur est téléporté au contact de la cible.

- Caractéristiques (g3) : **3 PA** · portée 1–5 (non modifiable) · en ligne uniquement · sans ligne de vue · cible requise (case occupée) · CC 15% · 1×/tour · condition : (lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)) ET lanceur n’a pas l’état « Pesanteur » (7)
- Grades : g1 (niv. 40) : 3 PA, po 1–3, 18–20 Eau ; g2 (niv. 107) : 3 PA, po 1–4, 23–25 Eau ; g3 (niv. 174) : 3 PA, po 1–5, 28–31 Eau
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–5 PO en ligne, sans LdV, case occupée, 1/tour, CC 15 % ; Armé/Reprise, pas Pesanteur
  - Téléporte le lanceur jusqu'à la cible ; s'il arrive au contact : symétrie par rapport à elle puis recul de 2
  - Dommages Eau 28–31 (CC 34–37) aux ennemis sur la ligne
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Applique l'état « Balestra » (3681)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **Téléporte le lanceur sur la case ciblée** → lanceur ; zone ligne depuis le lanceur taille 1 (min 63)  `[4]`
  - **Téléportation symétrique** → lanceur ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1106]`
  - **Le lanceur recule de 2 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1041]`
  - **la cible lance (sur elle-même) le sous-sort « Balestra » (24822, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 24822 « Balestra » niv.1 :
      - **le lanceur lance le sous-sort « Balestra » (24822, niv. 2)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Balestra » (3681) ; zone croix sans centre taille 1  `[1160]`
        - ↳ sous-sort 24822 « Balestra » niv.2 :
          - **Téléportation symétrique par rapport à la cible** → lanceur  `[1104]`
          - **le lanceur lance le sous-sort « Balestra » (24822, niv. 3)** → cible (alliée ou ennemie) — si cible a l'état « Balestra » (3681)  `[1160]`
            - ↳ sous-sort 24822 « Balestra » niv.3 :
              - **Le lanceur recule de 2 case(s) (s’éloigne de la cible)** → cible (alliée ou ennemie)  `[1041]`
          - **Retire l'état « Balestra » (3681)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain (vivants)  `[951]`
  - **28 à 31 dommages Eau (CC : 34 à 37)** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[96]`
- **Analyse / rôle tactique** : Traverse la ligne ennemie (passe derrière la cible).
- *Notes moteur* : État 3681 ; sous-sort 24822.

#### Moulin à Vent (`23742`) — variante (obtenu niv. 150)

> Téléporte les cibles symétriquement par rapport au centre et occasionne des dommages Air aux ennemis en zone. N'affecte pas directement le lanceur.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g1) : **3 PA** · portée 0–2 (non modifiable) · sans ligne de vue · CC 15% · 1×/tour · condition : lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–2 PO, sans LdV, 1/tour, CC 15 % ; pas en Éclipse
  - Cercle 2 (hors centre) : téléportation symétrique par rapport au centre (alliés hors lanceur et ennemis)
  - Dommages Air 29–33 (CC 35–40) aux ennemis
  - Désarmé : centré sur la Lance
- Effets décodés (données brutes DofusDB) :
  - **Téléportation symétrique** → tous sauf le lanceur dans la zone ; zone cercle taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1106]`
  - **29 à 33 dommages Air (CC : 35 à 40)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone cercle taille 2 (min 1)  `[98]`
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Moulin à Vent » (30716, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 30716 « Moulin à Vent » niv.1 :
      - **Téléportation symétrique** → tous sauf le lanceur dans la zone ; zone cercle taille 2 (min 1)  `[1106]`
      - **29 à 33 dommages Air (CC : 35 à 40)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[98]`
  - **le lanceur lance sur la case ciblée le sous-sort « Moulin à Vent » (30716, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 30716 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Moulin à Vent » (30716, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 30716 niv.1 déjà détaillé plus haut)
- **Analyse / rôle tactique** : Réorganisation de zone autour de soi/de la Lance.
- *Notes moteur* : 30716.


### Paire 13 — Talon d'Argile / Fente

#### Talon d'Argile (`23726`) — sort de base (obtenu niv. 45)

> Rappelle la Lance, rapproche le lanceur vers la cible et occasionne des dommages Terre aux ennemis.

- Caractéristiques (g3) : **2 PA** · portée 1–4 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 5% · 2×/tour · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 45) : 2 PA, po 1–4, 8–10 Terre ; g2 (niv. 112) : 2 PA, po 1–4, 11–13 Terre ; g3 (niv. 179) : 2 PA, po 1–4, 14–16 Terre
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–4 PO, LdV, case occupée, 2/tour, CC 5 % ; pas en Éclipse
  - Rappelle la Lance ; le lanceur avance de 3 cases vers la cible
  - Dommages Terre 14–16 (CC 17–19) aux ennemis
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Le lanceur avance de 3 case(s) vers la cible** → cible (alliée ou ennemie)  `[1042]`
  - **14 à 16 dommages Terre (CC : 17 à 19)** → cible ennemie  `[97]`
- **Analyse / rôle tactique** : Rappel bon marché (2 PA) + rapprochement.

#### Fente (`23753`) — variante (obtenu niv. 155)

> Rappelle la Lance, téléporte le lanceur sur la case ciblée ou symétriquement par rapport à la cible et occasionne des dommages Feu aux ennemis en zone. Les dommages de zone ne sont pas dégressifs.

- Caractéristiques (g1) : **2 PA** · portée 1–1 (non modifiable) · en diagonale uniquement · sans ligne de vue · CC 10% · 1×/tour · condition : lanceur n’a pas l’état « Pesanteur » (7) ET lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1 PO en diagonale, sans LdV, 1/tour, CC 10 % ; pas Pesanteur ni Éclipse
  - Rappelle la Lance ; téléporte le lanceur sur la case visée (si libre) ou symétriquement par rapport à la cible
  - Croix 1 : dommages Feu 12–14 (CC 15–18) non dégressifs
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Téléporte le lanceur sur la case ciblée** → cible (alliée ou ennemie)  `[4]`
  - **Téléportation symétrique par rapport à la cible** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1104]`
  - **le lanceur lance le sous-sort « Fente » (30745, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 30745 « Fente » niv.1 :
      - **Téléportation symétrique par rapport à la cible** → cible (alliée ou ennemie)  `[1104]`
  - **12 à 14 dommages Feu (CC : 15 à 18)** → ennemis dans la zone ; zone croix taille 1  `[99]`
- **Analyse / rôle tactique** : Petit déplacement + rappel à 2 PA.


### Paire 14 — Kyrja / Vajra

#### Kyrja (`23823`) — sort de base (obtenu niv. 50)

> Rappelle la Lance, téléporte le lanceur sur la case ciblée, vole de la vie dans le meilleur élément du lanceur aux ennemis et réduit leurs dommages finaux en zone.

- Caractéristiques (g3) : **3 PA** · portée 2–5 (non modifiable) · en ligne uniquement · sans ligne de vue · case libre requise · CC 25% · relance 3 t. · condition : lanceur n’a pas l’état « Pesanteur » (7) ET lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 50) : 3 PA, po 2–3, 18–20 vol meilleur élt ; g2 (niv. 117) : 3 PA, po 2–4, 24–27 vol meilleur élt ; g3 (niv. 184) : 3 PA, po 2–5, 28–32 vol meilleur élt
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 2–5 PO en ligne, sans LdV, case libre, relance 3, CC 25 % ; pas Pesanteur ni Éclipse
  - Rappelle la Lance ; téléporte le lanceur sur la case visée
  - Ennemis sur la ligne traversée : vol de vie du meilleur élément 28–32 (CC 34–38) et −10 % dommages finaux (1 tour)
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **Téléporte le lanceur sur la case ciblée** → cible (alliée ou ennemie)  `[4]`
  - **28 à 32 vol du meilleur élément (CC : 34 à 38)** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[2828]`
  - **-10% Dommages finaux** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63), 1 tour(s)  `[1172]`
- **Analyse / rôle tactique** : Saut offensif + réduction des dégâts des ennemis traversés.
- *Notes moteur* : 2828 (vol meilleur élément) ; ligne l1,63.

#### Vajra (`23829`) — variante (obtenu niv. 160)

> Rappelle la Lance, téléporte le lanceur sur la case ciblée et vole de la Fuite et de la vie dans le meilleur élément du lanceur aux ennemis en zone.

- Caractéristiques (g1) : **4 PA** · portée 2–4 (non modifiable) · sans ligne de vue · case libre requise · CC 25% · relance 3 t. · cumul max 1 · condition : lanceur n’a pas l’état « Pesanteur » (7) ET lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 2–4 PO, sans LdV, case libre, relance 3, CC 25 % ; pas Pesanteur ni Éclipse
  - Rappelle la Lance ; téléporte le lanceur sur la case visée
  - Cercle 2 (hors centre) : vol de vie du meilleur élément 39–44 (CC 47–53) ; vole 20 Fuite à chaque ennemi (1 tour)
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **Téléporte le lanceur sur la case ciblée** → cible (alliée ou ennemie)  `[4]`
  - **le lanceur lance le sous-sort « Vajra » (24403, niv. 1)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[1160]`
    - ↳ sous-sort 24403 « Vajra » niv.1 :
      - **-20 Fuite** → cible ennemie ; 1 tour(s)  `[754]`
      - **20 Fuite** → lanceur ; 1 tour(s)  `[752]`
  - **-20 Fuite** → ennemis dans la zone ; zone cercle taille 2 (min 1), 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[754]`
  - **20 Fuite** → ennemis dans la zone ; zone cercle taille 2 (min 1), 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[752]`
  - **39 à 44 vol du meilleur élément (CC : 47 à 53)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[2828]`
- **Analyse / rôle tactique** : Atterrissage au milieu d'un paquet : gros vol de vie de zone.
- *Notes moteur* : Sous-sort 24403 (−20 Fuite ennemi, +20 lanceur par ennemi).


### Paire 15 — Muspel / Ydra

#### Muspel (`23750`) — sort de base (obtenu niv. 55)

> Augmente les dommages du sort pour chaque ennemi dans la zone d'effet et leur occasionne des dommages Feu en zone.  Le sort ne peut se lancer que sur la Lance et la rappelle si le lanceur est Désarmé.

- Caractéristiques (g3) : **4 PA** · portée 1–63 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 25% · relance 2 t. (1er lancer possible au tour 2) · 1×/tour « global » (maxGlobalCastPerTurn, sens INCERTAIN) · cumul max 4 · condition : lanceur a l’état « Désarmé » (3361) ET lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 55) : 4 PA, po 1–63, 18–21 Feu ; g2 (niv. 122) : 4 PA, po 1–63, 24–28 Feu ; g3 (niv. 189) : 4 PA, po 1–63, 28–32 Feu
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 1–63 PO (sur la Lance), sans LdV, relance 2 (1er lancer au tour 2), 1 global/tour, CC 25 % ; exige Désarmé
  - +12 dégâts de base par ennemi en cercle 3 autour de la Lance (cumul 4 ⇒ +48)
  - Cercle 3 (hors centre) : dommages Feu 28–32 (CC 34–38) aux ennemis
  - Rappelle la Lance
- Effets décodés (données brutes DofusDB) :
  - **Muspel : +12 dégâts de base** → lanceur ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
  - **28 à 32 dommages Feu (CC : 34 à 38)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone cercle taille 3 (min 1)  `[99]`
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **le lanceur lance le sous-sort « Muspel » (30747, niv. 5)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139)  `[1160]`
    - ↳ sous-sort 30747 « Muspel » niv.5 :
      - **le lanceur lance le sous-sort « Muspel » (30747, niv. 6)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[1160]`
        - ↳ sous-sort 30747 « Muspel » niv.6 :
          - **Muspel : +12 dégâts de base** → lanceur ; 1 tour(s)  `[293]`
      - **28 à 32 dommages Feu (CC : 34 à 38)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[99]`
      - **Retire les effets du sort « Muspel » (30747)** → lanceur  `[406]`
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
- **Analyse / rôle tactique** : Explosion Feu autour de la Lance : 4 ennemis ⇒ 76–80 de base chacun. Fin de séquence idéale.
- *Notes moteur* : 30747 niv. 5–6 ; 293 posé avant les dommages puis dissipé.

#### Ydra (`23723`) — variante (obtenu niv. 165)

> Réduit les dommages reçus par le lanceur pour chaque ennemi dans la zone d'effet et leur occasionne des dommages Terre en zone. Les dommages de zone ne sont pas dégressifs.  Le sort ne peut se lancer que sur la Lance et la rappelle si le lanceur est Désarmé.

- Caractéristiques (g1) : **4 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 25% · relance 2 t. · 1×/tour « global » (maxGlobalCastPerTurn, sens INCERTAIN) · cumul max 8 · condition : lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 4 PA, sur soi (Armé) ou sur la Lance (Désarmé), relance 2, 1 global/tour, CC 25 %
  - Étoile 2 : dommages Terre 44–50 (CC 53–60) non dégressifs aux ennemis
  - Par ennemi touché : le lanceur gagne 2 × (1 + niveau/20) = 22 de réduction des dommages reçus (1 tour, cumul 8)
  - Rappelle la Lance si Désarmé
- Effets décodés (données brutes DofusDB) :
  - **-0 dommages reçus** → lanceur ; actif 1 tour(s), déclencheur : quand la cible subit des dommages, *info-bulle uniquement (comportement réel géré côté serveur)*  `[265]`
  - **44 à 50 dommages Terre (CC : 53 à 60)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone étoile taille 2  `[97]`
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Ydra » (30721, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 30721 « Ydra » niv.1 :
      - **le lanceur lance le sous-sort « Ydra » (30721, niv. 2)** → ennemis dans la zone ; zone étoile taille 2  `[1160]`
        - ↳ sous-sort 30721 « Ydra » niv.2 :
          - **-0 dommages reçus** → lanceur ; actif 1 tour(s), déclencheur : quand la cible subit des dommages  `[265]`
      - **44 à 50 dommages Terre (CC : 53 à 60)** → ennemis dans la zone ; zone étoile taille 2  `[97]`
  - **le lanceur lance sur la case ciblée le sous-sort « Ydra » (30721, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 30721 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Ydra » (30721, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 30721 niv.1 déjà détaillé plus haut)
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
- **Analyse / rôle tactique** : Gros dégâts Terre + armure : au cœur de 4 ennemis, −88 par coup reçu jusqu'au prochain tour.
- *Notes moteur* : 265 valeur 2 (armure) ; 30721 niv. 2 par ennemi (maxStack 8).


### Paire 16 — Prélude au Fer / Crépuscule

#### Prélude au Fer (`23841`) — sort de base (obtenu niv. 60)

> Réduit la durée des effets sur les ennemis et augmente la Puissance des alliés en zone.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g3) : **2 PA** · portée 0–2 (non modifiable) · sans ligne de vue · CC 0% · relance 2 t. · cumul max 1 · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 60) : 2 PA, po 0–2 ; g2 (niv. 127) : 2 PA, po 0–2 ; g3 (niv. 194) : 2 PA, po 0–2
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–2 PO, sans LdV, relance 2 ; pas en Éclipse
  - Cercle 2 : durée des effets −1 sur les ennemis ; +200 Puissance aux alliés (2 tours)
  - Désarmé : centré sur la Lance
- Effets décodés (données brutes DofusDB) :
  - **Durée des effets : -1** → ennemis dans la zone — si lanceur a l'état « Armé » (3360) ; zone cercle taille 2, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1075]`
  - **+200 Puissance** → alliés dans la zone — si lanceur a l'état « Armé » (3360) ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Prélude au Fer » (24446, niv. 3)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 24446 « Prélude au Fer » niv.3 :
      - **Durée des effets : -1** → ennemis dans la zone ; zone cercle taille 2  `[1075]`
      - **+200 Puissance** → alliés dans la zone ; zone cercle taille 2, 2 tour(s)  `[138]`
  - **le lanceur lance sur la case ciblée le sous-sort « Prélude au Fer » (24446, niv. 3)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 24446 niv.3 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Prélude au Fer » (24446, niv. 3)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 24446 niv.3 déjà détaillé plus haut)
- **Analyse / rôle tactique** : Buff offensif de groupe majeur (+200 Puissance) + désenvoûtement partiel des ennemis.
- *Notes moteur* : 24446 niv. 3.

#### Crépuscule (`23842`) — variante (obtenu niv. 170)

> Érode et retire de la Portée aux ennemis en zone.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g1) : **3 PA** · portée 0–2 (non modifiable) · sans ligne de vue · CC 0% · relance 2 t. (1er lancer possible au tour 2) · cumul max 1 · condition : lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–2 PO, sans LdV, relance 2 (1er lancer au tour 2) ; pas en Éclipse
  - Cercle 2 : 20 % d'érosion et −3 PO aux ennemis (2 tours)
  - Désarmé : centré sur la Lance
- Effets décodés (données brutes DofusDB) :
  - **20% Érosion** → ennemis dans la zone — si lanceur a l'état « Armé » (3360) ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[776]`
  - **-3 Portée** → ennemis dans la zone — si lanceur a l'état « Armé » (3360) ; zone cercle taille 2, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[116]`
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Crépuscule » (24449, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 24449 « Crépuscule » niv.1 :
      - **20% Érosion** → ennemis dans la zone ; zone cercle taille 2, 2 tour(s)  `[776]`
      - **-3 Portée** → ennemis dans la zone ; zone cercle taille 2, 2 tour(s)  `[116]`
  - **le lanceur lance sur la case ciblée le sous-sort « Crépuscule » (24449, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 24449 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Crépuscule » (24449, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 24449 niv.1 déjà détaillé plus haut)
- **Analyse / rôle tactique** : Érosion de zone + réduction de portée (anti-distance).
- *Notes moteur* : 24449.


### Paire 17 — Terre du Milieu / Dégagement

#### Terre du Milieu (`23738`) — sort de base (obtenu niv. 65)

> Augmente la Puissance du lanceur pour chaque ennemi dans la zone d'effet et leur occasionne des dommages Terre en zone.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g3) : **3 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 15% · 1×/tour · cumul max 4 · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 65) : 3 PA, po 0–0, 22–25 Terre ; g2 (niv. 131) : 3 PA, po 0–0, 27–30 Terre ; g3 (niv. 198) : 3 PA, po 0–0, 30–34 Terre
- **Résumé des effets (lecture humaine)** :
  - 3 PA, sur soi (ou la Lance si Désarmé), 1/tour, CC 15 % ; pas en Éclipse
  - Carré 1 (8 cases autour) : dommages Terre 30–34 (CC 36–41) aux ennemis
  - +50 Puissance au lanceur par ennemi touché (2 tours, cumul 4)
- Effets décodés (données brutes DofusDB) :
  - **+50 Puissance** → lanceur ; zone carré taille 1, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **30 à 34 dommages Terre (CC : 36 à 41)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone carré taille 1  `[97]`
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Terre du Milieu » (30713, niv. 5)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 30713 « Terre du Milieu » niv.5 :
      - **le lanceur lance le sous-sort « Terre du Milieu » (30713, niv. 6)** → ennemis dans la zone ; zone carré taille 1  `[1160]`
        - ↳ sous-sort 30713 « Terre du Milieu » niv.6 :
          - **+50 Puissance** → lanceur ; 2 tour(s)  `[138]`
      - **30 à 34 dommages Terre (CC : 36 à 41)** → ennemis dans la zone ; zone carré taille 1  `[97]`
  - **le lanceur lance sur la case ciblée le sous-sort « Terre du Milieu » (30713, niv. 5)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 30713 niv.5 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Terre du Milieu » (30713, niv. 5)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 30713 niv.5 déjà détaillé plus haut)
- **Analyse / rôle tactique** : Zone Terre autour de soi/de la Lance qui booste le Forgelance (jusqu'à +200 Puissance).
- *Notes moteur* : 30713 niv. 5–6.

#### Dégagement (`23743`) — variante (obtenu niv. 175)

> Occasionne des dommages Air aux ennemis et repousse les cibles depuis le centre en zone. N'affecte pas le lanceur.  Le sort ne peut se lancer que sur la Lance et la rappelle si le lanceur est Désarmé.

- Caractéristiques (g1) : **4 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 20% · 1×/tour · condition : lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 4 PA, sur soi (ou la Lance si Désarmé), 1/tour, CC 20 % ; pas en Éclipse
  - Cercle 2 (hors centre) : dommages Air 29–32 (CC 35–38) aux ennemis ; repousse de 4 cases depuis le centre
  - Rappelle la Lance si Désarmé
- Effets décodés (données brutes DofusDB) :
  - **29 à 32 dommages Air (CC : 35 à 38)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone cercle taille 2 (min 1)  `[98]`
  - **Repousse la cible de 4 case(s)** → tous sauf le lanceur dans la zone ; zone cercle taille 2 (min 1), *info-bulle uniquement (comportement réel géré côté serveur)*  `[5]`
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Dégagement » (30715, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 30715 « Dégagement » niv.1 :
      - **29 à 32 dommages Air (CC : 35 à 38)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[98]`
      - **Repousse la cible de 4 case(s)** → tous sauf le lanceur dans la zone ; zone cercle taille 2 (min 1)  `[5]`
  - **le lanceur lance sur la case ciblée le sous-sort « Dégagement » (30715, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 30715 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Dégagement » (30715, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 30715 niv.1 déjà détaillé plus haut)
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
- **Analyse / rôle tactique** : Dégagement de zone + rappel.
- *Notes moteur* : 30715.


### Paire 18 — Chevalerie / Renommée

#### Chevalerie (`23826`) — sort de base (obtenu niv. 70)

> Soigne et augmente les PM des alliés en zone.   Rappelle également la Lance si le lanceur est Désarmé.

- Caractéristiques (g2) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t.
- Grades : g1 (niv. 70) : 2 PA, po 0–0 ; g2 (niv. 137) : 2 PA, po 0–0
- **Résumé des effets (lecture humaine)** :
  - 2 PA, sur soi, relance 3
  - Cercle 2 : soin 7 % PV max et +2 PM (1 tour, non désenvoûtable) aux alliés
  - Rappelle la Lance si Désarmé (hors Éclipse)
- Effets décodés (données brutes DofusDB) :
  - **Soin : 7% des PV max** → alliés dans la zone ; zone cercle taille 2  `[1109]`
  - **2 PM** → alliés dans la zone ; zone cercle taille 2, 1 tour(s), non désenvoûtable  `[128]`
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Éclipse » (3735) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
- **Analyse / rôle tactique** : Soin de zone + mobilité du groupe.

#### Renommée (`23319`) — variante (obtenu niv. 180)

> Attire la cible et soigne le lanceur et l'allié ciblé. Attire la cible vers la Lance si le lanceur est Désarmé.  Rappelle également la Lance si elle est ciblée.

- Caractéristiques (g1) : **2 PA** · portée 0–6 (modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · 1×/tour · condition : lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–6 PO modifiable, sans LdV, case occupée, 1/tour ; pas en Éclipse
  - Armé : attire la cible de 2 cases ; Désarmé : l'attire de 2 cases vers la Lance
  - Soigne le lanceur de 7 % et l'allié ciblé de 7 %
  - Rappelle la Lance si elle est ciblée
- Effets décodés (données brutes DofusDB) :
  - **la cible lance sur la case ciblée le sous-sort « Renommée » (24508, niv. 1)** → lanceur  `[2794]`
    - ↳ sous-sort 24508 « Renommée » niv.1 :
      - **Applique l'état « Renommée » (3617)** → cible (alliée ou ennemie) — si lanceur a l'état « Désarmé » (3361) ; 1 tour(s), non désenvoûtable  `[950]`
      - **le lanceur lance le sous-sort « Renommée » (24508, niv. 2)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[1160]`
        - ↳ sous-sort 24508 « Renommée » niv.2 :
          - **Attire la cible de 2 case(s)** → cible (alliée ou ennemie)  `[6]`
      - **le lanceur lance le sous-sort « Renommée » (24508, niv. 3)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[1160]`
        - ↳ sous-sort 24508 « Renommée » niv.3 :
          - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Renommée » (3617) ; zone tout le terrain (vivants)  `[6]`
          - **Retire l'état « Renommée » (3617)** → tous (alliés+ennemis) dans la zone — si cible a l'état « Renommée » (3617) ; zone tout le terrain (vivants)  `[951]`
  - **Attire la cible de 2 case(s)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **Soin : 7% des PV max** → lanceur  `[1109]`
  - **Soin : 7% des PV max** → allié ciblé (hors lanceur)  `[1109]`
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
- **Analyse / rôle tactique** : Soin + déplacement d'un allié (ou d'un ennemi vers la Lance).
- *Notes moteur* : État 3617 ; sous-sort 24508.


### Paire 19 — Jormun / Fer Rouge

#### Jormun (`23268`) — sort de base (obtenu niv. 75)

> Occasionne des dommages Eau aux ennemis en zone jusqu'à la Lance.  Sur le lanceur : occasionne des dommages Eau plus faibles aux ennemis en zone autour du lanceur et de la Lance. Les dommages de zone ne sont pas dégressifs et ne sont appliqués qu'une seule fois par lancer.  Rappelle également la Lance.

- Caractéristiques (g2) : **3 PA** · portée 0–9 (modifiable) · en ligne uniquement · sans ligne de vue · CC 15% · 1×/tour · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 75) : 3 PA, po 0–8, 24–27 Eau, 21–24 Eau ; g2 (niv. 142) : 3 PA, po 0–9, 30–34 Eau, 26–30 Eau
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–9 PO modifiable en ligne, sans LdV, 1/tour, CC 15 % ; pas en Éclipse
  - Sur la Lance : dommages Eau 30–34 (CC 36–41) aux ennemis sur la ligne jusqu'à la Lance
  - Sur soi : 26–30 Eau (CC 31–36) aux ennemis en cercle 2 autour du lanceur **et** de la Lance (une fois par ennemi)
  - Rappelle la Lance ; Armé : portée 0 (sur soi uniquement)
- Effets décodés (données brutes DofusDB) :
  - **30 à 34 dommages Eau (CC : 36 à 41)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone ligne depuis le lanceur taille 1 (min 63)  `[96]`
  - **26 à 30 dommages Eau (CC : 31 à 36)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone cercle taille 2 (min 1)  `[96]`
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **le lanceur lance le sous-sort « Jormun » (30717, niv. 2)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139)  `[1160]`
    - ↳ sous-sort 30717 « Jormun » niv.2 :
      - **30 à 34 dommages Eau (CC : 36 à 41)** → ennemis dans la zone ; zone ligne depuis le lanceur taille 1 (min 63)  `[96]`
  - **le lanceur lance le sous-sort « Jormun » (30717, niv. 4)** → lanceur (s’il est dans la zone)  `[1160]`
    - ↳ sous-sort 30717 « Jormun » niv.4 :
      - **26 à 30 dommages Eau (CC : 31 à 36)** → ennemis dans la zone — si cible n'a PAS l'état « Jormun (cercle) » (3931) ; zone cercle taille 2 (min 1)  `[96]`
      - **Applique l'état « Jormun (cercle) » (3931)** → ennemis dans la zone — si cible n'a PAS l'état « Jormun (cercle) » (3931) ; zone cercle taille 2 (min 1), 1 tour(s), non désenvoûtable  `[950]`
      - **Applique l'état « Jormun (cercle) » (3931)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si cible n'a PAS l'état « Jormun (cercle) » (3931) ; zone tout le terrain (vivants), 1 tour(s), non désenvoûtable  `[950]`
      - **le lanceur lance le sous-sort « Jormun » (30717, niv. 4)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si cible n'a PAS l'état « Jormun (cercle) » (3931) ; zone tout le terrain (vivants)  `[1160]`
        - ↳ (sous-sort 30717 niv.4 déjà détaillé plus haut)
  - **la cible lance sur le lanceur (source) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; zone tout le terrain (vivants)  `[1017]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **Retire l'état « Jormun (cercle) » (3931)** → tous (alliés+ennemis) dans la zone ; zone tout le terrain  `[951]`
- **Analyse / rôle tactique** : Rappel offensif : balaie la ligne vers la Lance ou deux cercles.
- *Notes moteur* : État 3931 « Jormun (cercle) » pour l'unicité ; 30717 niv. 2/4.

#### Fer Rouge (`23756`) — variante (obtenu niv. 185)

> Occasionne des dommages Feu aux ennemis et augmente les dommages qu'ils subissent en zone. Invoque la Lance si la case est ou devient libre.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g1) : **3 PA** · portée 0–5 (non modifiable) · sans ligne de vue · CC 15% · 1×/tour · cumul max 1 · condition : lanceur n’a pas l’état « Éclipse » (3735)
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–5 PO, sans LdV, 1/tour, CC 15 % ; pas en Éclipse
  - Carré 1 : dommages Feu 30–34 (CC 36–41) et dommages subis ×107 % (2 tours) aux ennemis
  - Armé : invoque la Lance si la case est (ou devient) libre ; Désarmé : centré sur la Lance
- Effets décodés (données brutes DofusDB) :
  - **30 à 34 dommages Feu (CC : 36 à 41)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone carré taille 1  `[99]`
  - **Dommages subis x107%** → ennemis dans la zone ; zone carré taille 1, actif 2 tour(s), déclencheur : quand la cible subit des dommages, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1163]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Fer Rouge » (30748, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 30748 « Fer Rouge » niv.1 :
      - **30 à 34 dommages Feu (CC : 36 à 41)** → ennemis dans la zone ; zone carré taille 1  `[99]`
      - **Dommages subis x107%** → ennemis dans la zone ; zone carré taille 1, actif 2 tour(s), déclencheur : quand la cible subit des dommages  `[1163]`
      - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone — si lanceur a l'état « Armé » (3360) ; zone cercle taille 0  `[181]`
  - **le lanceur lance sur la case ciblée le sous-sort « Fer Rouge » (30748, niv. 1)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 30748 niv.1 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Fer Rouge » (30748, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 30748 niv.1 déjà détaillé plus haut)
- **Analyse / rôle tactique** : Amplification de groupe (+7 %) sur un paquet.
- *Notes moteur* : 30748.


### Paire 20 — Poinçon / Étreinte de Valkyr

#### Poinçon (`23401`) — sort de base (obtenu niv. 80)

> Rappelle et invoque la Lance dans l'état Poinçon : • Permet à la Lance de tacler. • Augmente son Tacle et sa Vitalité. • Rend la Lance et les cibles à son contact Indéplaçables. Les effets sont retirés à la destruction de la Lance.  Sur le lanceur : rend uniquement les cibles Indéplaçables en zone.

- Caractéristiques (g2) : **2 PA** · portée 0–4 (non modifiable) · ligne de vue requise · CC 0% · relance 3 t. · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 80) : 2 PA, po 0–3 ; g2 (niv. 147) : 2 PA, po 0–4
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–4 PO, LdV, relance 3 ; pas en Éclipse
  - Rappelle puis invoque la Lance (grade 2) sur la case : la Lance peut tacler, +100 Tacle, +100 % Vitalité (1 tour)
  - La Lance et les entités en croix 1 autour d'elle deviennent Indéplaçables (1 tour)
  - Sur le lanceur : rend seulement les entités autour de lui Indéplaçables
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **Invoque « Lance Immortelle » (monstre 7139, grade 2)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
  - **Applique l'état « Poinçon » (6023)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **100 Tacle** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[753]`
  - **100% Vitalité** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[2844]`
  - **Applique l'état « Indéplaçable » (97)** → ennemis dans la zone ; zone croix taille 1, 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **le lanceur lance le sous-sort « Poinçon » (23402, niv. 1)** → lanceur (s’il est dans la zone)  `[1160]`
    - ↳ sous-sort 23402 « Poinçon » niv.1 :
      - **Applique l'état « Poinçon » (6023)** → lanceur — si lanceur est le monstre « Lance Immortelle » (7139) ; 1 tour(s)  `[950]`
      - **100 Tacle** → lanceur — si lanceur est le monstre « Lance Immortelle » (7139) ; 1 tour(s)  `[753]`
      - **100% Vitalité** → lanceur — si lanceur est le monstre « Lance Immortelle » (7139) ; 1 tour(s)  `[1078]`
      - **Applique l'état « Indéplaçable » (97)** → tous (alliés+ennemis) dans la zone ; zone croix taille 1, 1 tour(s)  `[950]`
      - **Désactive l'état « Intacleur » (95)** → lanceur — si lanceur est le monstre « Lance Immortelle » (7139) ; 1 tour(s), non désenvoûtable  `[952]`
- **Analyse / rôle tactique** : Verrouille un boss (Indéplaçable + tacle 100) et protège contre les déplacements.
- *Notes moteur* : Désactive l'état Intacleur (95) de la Lance.

#### Étreinte de Valkyr (`23838`) — variante (obtenu niv. 190)

> Réduit les dommages reçus par l'allié ciblé et lui applique l'état Étreinte de Valkyr : • Érode les attaquants ennemis de la cible.

- Caractéristiques (g1) : **2 PA** · portée 0–6 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t. · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–6 PO, sans LdV, relance 3
  - Allié : −99 dommages par coup reçu (armure 9 × 11, 1 tour) et état Étreinte de Valkyr
  - Les ennemis qui l'attaquent subissent 10 % d'érosion (1 tour)
- Effets décodés (données brutes DofusDB) :
  - **-0 dommages reçus** → cible alliée ; actif 1 tour(s), déclencheur : quand la cible subit des dommages  `[265]`
  - **Applique l'état « Étreinte de Valkyr » (3680)** → cible alliée ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Étreinte de Valkyr » (23857, niv. 1)** → cible alliée ; actif 1 tour(s), déclencheur : dommages subis d'un ennemi  `[1160]`
    - ↳ sous-sort 23857 « Étreinte de Valkyr » niv.1 :
      - **10% Érosion** → ennemis, l'entité qui a déclenché l'effet (attaquant) ; 1 tour(s), non désenvoûtable  `[776]`
  - **10% Érosion** → ennemis, l'entité qui a déclenché l'effet (attaquant) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[776]`
  - **la cible lance sur la case ciblée le sous-sort « Étreinte de Valkyr » (25491, niv. 1)** → lanceur  `[2794]`
    - ↳ sous-sort 25491 « Étreinte de Valkyr » niv.1 :
      - **la cible lance sur la case ciblée le sous-sort « Étreinte de Valkyr » (25491, niv. 2)** → personnages joueurs ennemis ; zone tout le terrain  `[2794]`
        - ↳ sous-sort 25491 « Étreinte de Valkyr » niv.2 :
          - **Applique l'état « Étreinte de Valkyr » (4001)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[950]`
  - **Retire les effets du sort « Étreinte de Valkyr » (25491)** → cible alliée ; actif 1 tour(s), déclencheur : quand l'état « Étreinte de Valkyr » (3680) est retiré, non désenvoûtable  `[406]`
  - **Retire les effets du sort « Étreinte de Valkyr » (23838)** → cible alliée ; actif 1 tour(s), déclencheur : quand l'état « Étreinte de Valkyr » (3680) est retiré, non désenvoûtable  `[406]`
- **Analyse / rôle tactique** : Protection forte d'un allié ciblé par des coups multiples.
- *Notes moteur* : 265 valeur 9 ; sous-sort 23857 sur l'attaquant (déclencheur DBE).


### Paire 21 — Noa / Elding

#### Noa (`23735`) — sort de base (obtenu niv. 85)

> Occasionne des dommages Air aux ennemis et leur applique l'état Noa en zone : • Occasionne des dommages Air et retire l'état si la cible subit des dommages de poussée. Les dommages de zone ne sont pas dégressifs.  Le sort ne peut se lancer que sur la Lance si le lanceur est Désarmé.

- Caractéristiques (g2) : **4 PA** · portée 0–6 (non modifiable) · ligne de vue requise · CC 25% · relance 2 t. · 1×/tour « global » (maxGlobalCastPerTurn, sens INCERTAIN) · cumul max 1 · condition : lanceur n’a pas l’état « Éclipse » (3735)
- Grades : g1 (niv. 85) : 4 PA, po 0–6, 19–21 Air, 21–23 Air ; g2 (niv. 152) : 4 PA, po 0–6, 23–26 Air, 26–29 Air
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 0–6 PO, LdV (désactivée si Désarmé), relance 2, 1 global/tour, CC 25 % ; pas en Éclipse
  - Carré 1 : dommages Air 23–26 (CC 26–29) non dégressifs + état Noa (2 tours) aux ennemis
  - Noa : si la cible subit des dommages de poussée, elle reçoit 28–31 Air (CC 31–35) et perd l'état
  - Désarmé : centré sur la Lance
- Effets décodés (données brutes DofusDB) :
  - **23 à 26 dommages Air (CC : 28 à 31)** → ennemis dans la zone — si cible est le monstre « monstre#50000 » (50000) ; zone carré taille 1  `[98]`
  - **Applique l'état « Noa » (6990)** → ennemis dans la zone ; zone carré taille 1, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **26 à 29 dommages Air (CC : 31 à 35)** → cible ennemie ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[98]`
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **le lanceur lance sur la case ciblée le sous-sort « Noa » (24959, niv. 4)** → cible (alliée ou ennemie) — si lanceur a l'état « Armé » (3360)  `[2960]`
    - ↳ sous-sort 24959 « Noa » niv.4 :
      - **23 à 26 dommages Air (CC : 26 à 29)** → ennemis dans la zone ; zone carré taille 1  `[98]`
      - **Applique l'état « Noa » (6990)** → ennemis dans la zone ; zone carré taille 1, 2 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Noa » (24959, niv. 5)** → ennemis dans la zone ; zone carré taille 1, actif 2 tour(s), déclencheur : dommages de poussée subis OU dommages de poussée subis (variante X, INCERTAIN)  `[1160]`
        - ↳ sous-sort 24959 « Noa » niv.5 :
          - **le lanceur lance le sous-sort « Noa » (24959, niv. 6)** → cible (alliée ou ennemie)  `[1160]`
            - ↳ sous-sort 24959 « Noa » niv.6 :
              - **Retire les effets du sort « Noa » (24959)** → cible (alliée ou ennemie)  `[406]`
              - **28 à 31 dommages Air (CC : 31 à 35)** → cible ennemie  `[98]`
  - **le lanceur lance sur la case ciblée le sous-sort « Noa » (24959, niv. 4)** → cible (alliée ou ennemie) — si lanceur a l'état « Reprise de Volée » (3589)  `[2960]`
    - ↳ (sous-sort 24959 niv.4 déjà détaillé plus haut)
  - **le lanceur lance le sous-sort « Noa » (24959, niv. 4)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ET si lanceur n'a PAS l'état « Reprise de Volée » (3589)  `[1160]`
    - ↳ (sous-sort 24959 niv.4 déjà détaillé plus haut)
- **Analyse / rôle tactique** : Bombe à retardement déclenchée par les poussées (Estoc, Volée, Dégagement, Charge Héroïque, alliés).
- *Notes moteur* : Déclencheur PD/XPD (dommages de poussée) sur 24959 niv. 5.

#### Elding (`23396`) — variante (obtenu niv. 195)

> Invoque la Lance, attire les cibles vers le centre et occasionne des dommages Eau aux ennemis en zone. N'affecte pas le lanceur.

- Caractéristiques (g1) : **4 PA** · portée 1–6 (modifiable) · en ligne uniquement · sans ligne de vue · case libre requise · CC 25% · relance 2 t. (1er lancer possible au tour 2) · 1×/tour « global » (maxGlobalCastPerTurn, sens INCERTAIN) · condition : lanceur a l’état « Armé » (3360) OU lanceur a l’état « Reprise de Volée » (3589)
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 1–6 PO modifiable en ligne, sans LdV, case libre, relance 2 (1er lancer au tour 2), 1 global/tour, CC 25 % ; Armé/Reprise
  - Invoque la Lance sur la case visée
  - Cercle 3 (hors centre) : attire de 2 cases vers le centre (alliés hors lanceur et ennemis) puis dommages Eau 36–40 (CC 43–48)
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Reprise de Volée » (24395, niv. 1)** → lanceur — si lanceur a l'état « Reprise de Volée » (3589)  `[792]`
    - ↳ sous-sort 24395 niv.1 : Reprise de Volée : si le lanceur est en Reprise de Volée (dans le glyphe de sa Lance), la Lance est tuée = récupérée → Armé + 30 Puissance (§2.3).
  - **Invoque « Lance Immortelle » (monstre 7139, grade 1)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 0  `[181]`
  - **le lanceur lance le sous-sort « Invoque la Lance Immortelle » (24627, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 24627 niv.1 : infobulle « Invoque la Lance Immortelle » (aucun effet direct).
  - **Attire la cible de 2 case(s)** → tous sauf le lanceur dans la zone ; zone cercle taille 3 (min 1)  `[6]`
  - **36 à 40 dommages Eau (CC : 43 à 48)** → ennemis dans la zone ; zone cercle taille 3 (min 1)  `[96]`
- **Analyse / rôle tactique** : Regroupement autour de la Lance + grosse zone Eau.


### Paire 22 — Éclipse / Holmgang

#### Éclipse (`23834`) — sort de base (obtenu niv. 90)

> Rappelle la Lance, applique un bouclier sur le lanceur et ses alliés en zone autour de lui et retire de la Portée à tout le monde.  Désarme immédiatement le lanceur pour appliquer des effets sur la case ciblée au tour suivant : • Lance le sort Croissant de Mani si la case est occupée par le lanceur. • Sinon, lance le sort Disque de Sigel.

- Caractéristiques (g2) : **5 PA** · portée 0–10 (modifiable) · sans ligne de vue · CC 25% · relance 4 t. · 1×/tour « global » (maxGlobalCastPerTurn, sens INCERTAIN) · cumul max 1 · condition : lanceur n’a pas l’état « Parade » (3378)
- Grades : g1 (niv. 90) : 5 PA, po 0–8 ; g2 (niv. 157) : 5 PA, po 0–10
- **Résumé des effets (lecture humaine)** :
  - 5 PA, 0–10 PO modifiable, sans LdV, relance 4, 1 global/tour, CC 25 % ; pas en Parade
  - Rappelle la Lance, puis Désarme immédiatement le lanceur ; état Éclipse (la plupart des sorts deviennent interdits jusqu'à la fin du tour)
  - Bouclier 200 % du niveau aux alliés en cercle 3 autour du lanceur (2 tours) ; −6 PO à toutes les entités (1 tour)
  - Au tour suivant sur la case visée : Croissant de Mani si le lanceur s'y trouve (Armé, Pesanteur cercle 3, bouclier 400 % aux alliés cercle 3, Éclipse −2 relance), sinon Disque de Sigel (67–76 du meilleur élément en cercle 3, CC 80–91, invoque la Lance)
- Effets décodés (données brutes DofusDB) :
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **la cible lance sur la case ciblée le sous-sort « Éclipse » (24464, niv. 2)** → lanceur  `[2794]`
    - ↳ sous-sort 24464 « Éclipse » niv.2 :
      - **la cible lance sur la case ciblée le sous-sort « Éclipse » (23835, niv. 2)** → lanceur ; délai 1 t.  `[2794]`
        - ↳ sous-sort 23835 « Éclipse » niv.2 :
          - **la cible lance (sur elle-même) le sous-sort « Croissant de Mani » (23837, niv. 1)** → lanceur (s’il est dans la zone)  `[792]`
            - ↳ sous-sort 23837 « Croissant de Mani » niv.1 :
              - **le lanceur lance le sous-sort « Armé » (23385, niv. 1)** → lanceur  `[1160]`
                - ↳ sous-sort 23385 niv.1 : Armé : état 3360 ; retire Désarmé ; Épilogue portée min 1 + case libre requise ; Jormun portée max 0 (§2.1).
              - **Applique l'état « Pesanteur » (7)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 3, 1 tour(s)  `[950]`
              - **Applique l'état « Croissant de Mani » (3587)** → lanceur ; 1 tour(s)  `[950]`
              - **Bouclier : 400% du niveau** → alliés dans la zone ; zone cercle taille 3, 1 tour(s)  `[1020]`
              - **Éclipse : -2  de relance** → lanceur  `[1036]`
          - **la cible lance sur la case ciblée le sous-sort « Disque de Sigel » (23836, niv. 4)** → lanceur  `[2794]`
            - ↳ sous-sort 23836 niv.4 : Disque de Sigel : dommages du meilleur élément 67–76 (CC 80–91) en cercle 3 + invocation de la Lance si la case est libre (sinon le lanceur redevient Armé) — §2.5.
          - **Retire l'état « Croissant de Mani » (3587)** → lanceur  `[951]`
      - **le lanceur lance le sous-sort « Désarmé » (23286, niv. 1)** → lanceur  `[1160]`
        - ↳ sous-sort 23286 niv.1 : Désarmé : état 3361 ; hors Reprise de Volée, les sorts « sur la Lance » ne visent que la Lance (portée 1–63, case occupée) (§2.1).
  - **le lanceur lance le sous-sort « Éclipse » (24584, niv. 2)** → lanceur  `[1160]`
    - ↳ sous-sort 24584 « Éclipse » niv.2 :
      - **Applique l'état « Éclipse » (3735)** → lanceur ; 1 tour(s)  `[950]`
      - **Applique l'état « Éclipse » (6994)** → lanceur ; 1 tour(s)  `[950]`
      - **Bouclier : 200% du niveau** → alliés dans la zone ; zone cercle taille 3, 2 tour(s)  `[1020]`
      - **-6 Portée** → tous (alliés+ennemis) dans la zone ; zone cercle illimitée (63), 1 tour(s)  `[116]`
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **Applique l'état « Éclipse » (6994)** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **Bouclier : 200% du niveau** → alliés dans la zone ; zone cercle taille 3, 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1020]`
  - **-6 Portée** → cible (alliée ou ennemie) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[116]`
  - **le lanceur lance le sous-sort « Croissant de Mani » (25481, niv. 1)** → cible (alliée ou ennemie) ; délai 1 t., *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25481 niv.1 : aucun effet de jeu (marqueur)
  - **le lanceur lance le sous-sort « Disque de Sigel » (25480, niv. 1)** → cible (alliée ou ennemie) ; délai 1 t., *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25480 niv.1 : aucun effet de jeu (marqueur)
- **Analyse / rôle tactique** : Sort de fin de tour : protège le groupe (400 de bouclier), retire 6 PO à tous (anti-distance), et prépare une frappe de zone ou un bouclier massif au tour suivant.
- *Notes moteur* : Sous-sorts 24584 (immédiat), 24464 → 23835 (délai 1) → 23837 ou 23836.

#### Holmgang (`23846`) — variante (obtenu niv. 200)

> Rappelle la Lance et remplace la Garde par le Holmgang : • Rend le lanceur Indéplaçable. • Réduit les dommages subis à distance. • Pose un glyphe-aura qui attire les ennemis qui le traversent ou qui en sortent et leur occasionne des dommages dans le meilleur élément d'attaque du lanceur (une fois par ennemi par tour).  Termine le tour en cours du lanceur.

- Caractéristiques (g1) : **4 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 4 t. · relance globale 2 t. · condition : lanceur n’a pas l’état « Éclipse » (3735) ET lanceur n’a pas l’état « Porté » (8)
- **Résumé des effets (lecture humaine)** :
  - 4 PA, sur soi, relance 4 ; pas en Éclipse ni porté ; **termine le tour**
  - Rappelle la Lance ; Indéplaçable ; dommages à distance subis ×65 % (1 tour)
  - Glyphe-aura cercle 2 (2 tours) : tout ennemi qui le traverse, y entre ou en sort est attiré de 2 cases vers le lanceur et subit 34–38 du meilleur élément (une fois par ennemi par tour)
  - Effets retirés si le lanceur est déplacé
- Effets décodés (données brutes DofusDB) :
  - **Applique l'état « Holmgang (caster glyphe) » (5746)** → lanceur ; 1 tour(s)  `[950]`
  - **la cible lance (sur elle-même) le sous-sort « Rappel de la Lance » (30712, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ET si lanceur a l'état « Désarmé » (3361) ; zone tout le terrain (vivants)  `[792]`
    - ↳ sous-sort 30712 niv.1 : Rappel de la Lance : la Lance se tue (141) → le Forgelance redevient Armé (+30 Puissance 3 t.).
  - **le lanceur lance le sous-sort « Rappelle la Lance Immortelle » (25460, niv. 1)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Lance Immortelle » (7139) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25460 niv.1 : infobulle « Rappelle la Lance Immortelle » (aucun effet direct).
  - **Applique l'état « Holmgang » (3498)** → lanceur ; 1 tour(s)  `[950]`
  - **Applique l'état « Indéplaçable » (97)** → lanceur ; 1 tour(s)  `[950]`
  - **Dommages subis x65%** → lanceur ; actif 1 tour(s), déclencheur : dommages à distance subis (>1 case)  `[1163]`
  - **Applique l'état « Holmgang (cast) » (5742)** → lanceur ; 1 tour(s)  `[950]`
  - **Pose un glyphe-aura « Holmgang » (30131, niv. 1)** → ennemis dans la zone ; zone cercle taille 2, 2 tour(s)  `[1091]`
    - ↳ sous-sort 30131 « Holmgang » niv.1 :
      - **Applique l'état « Holmgang (glyphe) » (5736)** → ennemis dans la zone — si lanceur a l'état « Holmgang (cast) » (5742) ET si cible n'a PAS l'état « Porté » (8) ; zone cercle taille 2 (min 1), 1 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Holmgang » (30131, niv. 2)** → cible ennemie — si lanceur a l'état « Holmgang (cast) » (5742) ET si cible n'a PAS l'état « Porté » (8)  `[1160]`
        - ↳ sous-sort 30131 « Holmgang » niv.2 :
          - **Applique l'état « Holmgang (initialement dans la zone) » (5744)** → cible ennemie — si cible n'a PAS l'état « Porté » (8) ; 1 tour(s)  `[950]`
          - **le lanceur lance le sous-sort « Holmgang » (30131, niv. 3)** → cible ennemie ; actif 1 tour(s), déclencheur : quand l'état « Holmgang (glyphe) » (5736) est retiré  `[1160]`
            - ↳ sous-sort 30131 « Holmgang » niv.3 :
              - **le lanceur lance le sous-sort « Holmgang » (24853, niv. 1)** → cible ennemie — si cible a l'état « Holmgang (initialement dans la zone) » (5744) ET si cible n'a PAS l'état « Porté » (8) ET si lanceur a l'état « Holmgang (caster glyphe) » (5746)  `[1160]`
          - **Retire les effets du sort « Holmgang » (30131)** → cible ennemie ; actif 1 tour(s), déclencheur : quand l'état « Porté » (8) est appliqué  `[406]`
      - **Applique l'état « Holmgang (portée) » (5743)** → ennemis dans la zone — si cible a l'état « Porté » (8) ; zone cercle taille 2 (min 1), 1 tour(s)  `[950]`
  - **Pose un glyphe-aura « Holmgang » (23847, niv. 1)** → ennemis dans la zone ; zone cercle taille 2, 1 tour(s)  `[1091]`
    - ↳ sous-sort 23847 « Holmgang » niv.1 :
      - **le lanceur lance le sous-sort « Holmgang » (23847, niv. 2)** → cible ennemie — si cible n'a PAS l'état « Holmgang » (3611) ET si lanceur n'a PAS l'état « Holmgang (cast) » (5742)  `[1160]`
        - ↳ sous-sort 23847 « Holmgang » niv.2 :
          - **Applique l'état « Holmgang » (3611)** → cible ennemie — si cible n'a PAS l'état « Holmgang » (3611) ET si lanceur n'a PAS l'état « Holmgang (cast) » (5742) ; 1 tour(s)  `[950]`
      - **Attire la cible de 2 case(s)** → ennemis dans la zone — si cible n'a PAS l'état « Holmgang » (3611) ET si lanceur n'a PAS l'état « Holmgang (cast) » (5742) ET si cible n'a PAS l'état « Holmgang (portée) » (5743) ; zone cercle taille 2 (min 1)  `[6]`
      - **34 à 38 dommages du meilleur élément** → ennemis dans la zone — si cible n'a PAS l'état « Holmgang » (3611) ET si lanceur n'a PAS l'état « Holmgang (cast) » (5742) ; zone cercle taille 2 (min 1)  `[2822]`
      - **Retire l'état « Holmgang (portée) » (5743)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[951]`
  - **Change l'apparence** → lanceur ; durée infinie  `[335]`
  - **la cible lance (sur elle-même) le sous-sort « Holmgang » (24854, niv. 1)** → lanceur ; délai 1 t.  `[792]`
    - ↳ sous-sort 24854 « Holmgang » niv.1 :
      - **Retire les effets du sort « Holmgang » (23846)** → lanceur ; non désenvoûtable  `[406]`
      - **Retire les effets du sort « Holmgang » (30131)** → lanceur ; non désenvoûtable  `[406]`
      - **Retire les effets du sort « Holmgang » (30131)** → ennemis dans la zone ; zone tout le terrain, non désenvoûtable  `[406]`
      - **Dissipe les glyphes** → lanceur  `[2018]`
  - **le lanceur lance le sous-sort « Holmgang » (24854, niv. 2)** → lanceur ; actif 1 tour(s), déclencheur : téléportation (INCERTAIN) OU quand la cible est déplacée  `[1160]`
    - ↳ sous-sort 24854 « Holmgang » niv.2 :
      - **Retire les effets du sort « Holmgang » (23846)** → lanceur  `[406]`
      - **Dissipe les glyphes** → lanceur  `[2018]`
      - **Retire les effets du sort « Holmgang » (30131)** → lanceur ; non désenvoûtable  `[406]`
      - **Retire les effets du sort « Holmgang » (30131)** → ennemis dans la zone ; zone tout le terrain  `[406]`
  - **Retire l'état « Holmgang (cast) » (5742)** → lanceur  `[951]`
  - **la cible lance (sur elle-même) le sous-sort « Garde » (24390, niv. 2)** → lanceur  `[792]`
    - ↳ sous-sort 24390 niv.2 : Garde : ×85 % dommages subis jusqu'au début du tour suivant (si Armé, hors Parade/Holmgang/Reprise de Volée).
  - **Termine le tour** → lanceur  `[1031]`
- **Analyse / rôle tactique** : Posture défensive anti-distance qui punit les ennemis qui bougent autour du Forgelance.
- *Notes moteur* : Glyphes 23847/30131 ; états 3498, 3611, 5736, 5742–5746 ; 1031 termine le tour.


## 4. Rôles en groupe PvM 4 joueurs (niveau 200)

| Rôle | Pertinence | Éléments | Sorts clés |
|---|---|---|---|
| **DPS de zone** | ★★★★ | Terre-Feu (meilleur), Eau-Air, multi | Lance-pierre, Effondrement, Ydra, Muspel, Moulin Rouge, Terre du Milieu, Elding, Javelot-foudre, Éclipse/Disque |
| **Placement / regroupement** | ★★★★ | - | Effondrement, Moulin Rouge, Elding, Trident, Estoc, Volée, Soulèvement, Maelstrom, Poinçon |
| **Protection de groupe** | ★★★ | - | Phalange, Oriflamme, Éclipse, Étendard, Étreinte de Valkyr, Prélude au Fer |
| Tank secondaire | ★★ | - | Garde, Parade, Holmgang, Ydra |
| Soin | ★ | - | Chevalerie, Galanterie, Renommée |
| Entrave | ★ | - | Poinçon (lock), Crépuscule (−3 PO), Éclipse (−6 PO) |

**Placement type** : mi-distance (Lance lancée à 2–8 cases au centre des monstres), lui-même à 1–3 cases de la Lance pour
pouvoir enchaîner Reprise de Volée ; en défense, finir le tour Armé (Garde) ou au contact de la Lance (Étendard ×90 %).

## 5. Choix des variantes (« spell sets »)

Voir `variantChoices` du JSON (deux sets complets). Arbitrages : Épilogue (interrupteur 1 PA) > Parade sauf rôle tank ;
Phalange (600 de bouclier sans déplacer la Lance) vs Oriflamme (repositionne la Lance) ; Ydra (Terre, armure) vs Muspel (Feu,
burst, exige Désarmé) ; Prélude au Fer (+200 Puissance) vs Crépuscule (érosion/−3 PO) ; Éclipse (bouclier + frappe différée)
vs Holmgang (tank anti-distance qui termine le tour).

## 6. Rotations types (12 PA / 6 PM)

Principe IA : (1) choisir la case de la Lance qui maximise le nombre d'ennemis à portée des zones
centrées sur elle (étoile 2, carré 1, cercle 2–3) après regroupement ; (2) enchaîner les sorts « sur la Lance » sans rappel,
puis un sort de rappel (Ydra/Muspel/Dégagement/Jormun) ; (3) décider en fin de tour entre rester Désarmé (Étendard pour les
alliés au contact de la Lance) ou se réarmer (Garde ×85 % + 30 Puissance).

### Rotations détaillées

**Séquence Lance — tour 1 (Armé → Désarmé), 12 PA**

1. Lance-pierre (3 PA) au centre du paquet : 25–28 Terre cercle 3, la Lance apparaît (Désarmé)
2. Effondrement (3 PA) sur la Lance : attire les monstres vers elle, 20–22 Terre
3. Terre du Milieu (3 PA) sur la Lance : 30–34 Terre carré 1, +50 Puissance par ennemi
4. Pluie d'Airain (2 PA) ou Prélude au Fer (2 PA) sur la Lance
5. Épilogue (1 PA) non lancé : garder la Lance pour le tour 2 (Étendard ×90 % pour les alliés au contact)

> Fin de tour Désarmé ⇒ pas de Garde. Alternative défensive : Épilogue (1 PA) pour rappeler la Lance ⇒ Armé (+30 Puissance) ⇒ Garde ×85 % pendant le tour ennemi.


**Séquence Lance — tour 2 (explosion + rappel), 12 PA**

1. Fer Rouge (3 PA) sur la Lance : ×107 % aux ennemis du carré 1
2. Ydra (4 PA) sur la Lance : 44–50 Terre étoile 2, armure 22/ennemi, rappel ⇒ Armé (+30 Puissance)
3. Lance-pierre (3 PA) : relance la Lance (Armé après le rappel d'Ydra) au centre du paquet → Désarmé
4. Pluie d'Airain (2 PA) sur la nouvelle Lance : −40 rés. poussée (prépare Estoc/Volée/Noa)

> Muspel (Feu, 4 PA, +12 par ennemi) remplace Ydra dans un build Feu (exige Désarmé). Vérifier `1 lancer global/tour` pour Ydra/Muspel/Noa/Elding.


**Tour de protection, 12 PA**

1. Phalange (3 PA) : 600 de bouclier aux alliés en cercle 2
2. Prélude au Fer (2 PA) : +200 Puissance aux alliés
3. Chevalerie (2 PA) : soin 7 % + 2 PM
4. Éclipse (5 PA) en dernier : 400 de bouclier aux alliés cercle 3, −6 PO à tous ; Disque de Sigel/Croissant de Mani au tour suivant

> Éclipse bloque les sorts suivants (état 3735) : toujours la lancer en fin de tour.


## 7. Forces et faiblesses

**Forces**

- Dégâts de zone très élevés et non dégressifs, à distance et en mêlée (officiel : Dégâts 10/10).
- Placement/regroupement de premier ordre autour de la Lance.
- Protection de groupe (boucliers 300–400 % du niveau, ×90 % autour de la Lance, armure 99).
- Bonne survie personnelle (Garde ×85 %, Parade, Holmgang, Ydra, vols de vie Kyrja/Vajra).
- Multi-élément facile (sorts « meilleur élément » : Charge Héroïque, Kyrja, Vajra, Parade, Holmgang, Disque de Sigel).

**Faiblesses**

- Dépendance à l'état de la Lance : Désarmé loin de sa Lance, la moitié du kit est interdite.
- Pas de Garde quand la Lance est posée en fin de tour (choix dégâts vs défense chaque tour).
- Peu de retrait PA/PM (entrave 3/10) et soins faibles.
- La Lance peut être tuée par l'ennemi (re-armement forcé) ; Éclipse bloque le reste du tour ; plusieurs sorts à 1 lancer global/tour.

## 8. Synergies avec les autres classes

| Avec | Pourquoi |
|---|---|
| DPS de zone alliés (Crâ, Huppermage, Roublard, Sadida) | Le Forgelance regroupe les monstres autour de sa Lance (Effondrement, Moulin Rouge, Elding) : cibles parfaites pour les zones alliées ; Prélude au Fer (+200 Puissance) et Fer Rouge (×107 %) amplifient. |
| Pandawa / Steamer / Iop (poussées) | Noa explose sur les dommages de poussée ; Pluie d'Airain (−40 rés. poussée) augmente les dommages de poussée alliés. |
| Tanks de mêlée (Sacrieur, Ouginak, Iop) | Étendard ×90 % autour de la Lance, Phalange/Oriflamme/Éclipse et Étreinte de Valkyr protègent la ligne de front ; Chevalerie donne +2 PM. |
| Entraveurs (Enutrof, Xélor, Sram) | Poinçon (Indéplaçable + tacle de la Lance) et Éclipse (−6 PO, Pesanteur via Croissant de Mani) complètent les retraits PA/PM. |
| Eniripsa / Féca | Le Forgelance protège mais soigne peu (7 %) : un vrai soigneur reste utile en donjon long. |

## 9. Questions ouvertes (INCERTAIN)

- PV exacts de la Lance Immortelle (bonusCharacteristics 70 % ?) et sa résistance.
- Cumul de « Reprise de Volée » (+30 Puissance, 3 tours) lors de rappels successifs (maxStack −1 : cumul illimité ?).
- Dimensions exactes de la zone rectangle R1,3 d'Épieu Sismique.
- Ordre précis invocation/attirance/dommages d'Elding et de Lance-cyclone (attirance avant dommages d'après l'ordre des effets).
- Javelot-foudre : nombre maximal de rebonds (aucune limite visible hormis les états).

## 10. Sources

- DofusDB (fichiers du jeu) : https://api.dofusdb.fr/breeds/20, https://api.dofusdb.fr/spell-variants?breedId=20,
  https://api.dofusdb.fr/spells, https://api.dofusdb.fr/spell-levels, https://api.dofusdb.fr/spell-states,
  https://api.dofusdb.fr/monsters/7139, https://api.dofusdb.fr/spell-types (2377, 2378, 2753, 2857, 3587, 3588, 3907–3912, 4262),
  https://api.dofusdb.fr/version (3.6.12.16).
- Présentation du gameplay (Armé/Désarmé, Lance) : https://www.gamosaurus.com/?p=151091 , https://www.gamosaurus.com/?p=150965
- Refonte 2.67 : https://www.gamosaurus.com/jeux/dofus/dofus-2-67-refonte-forgelance-equilibrages-de-classe-nerf-ou-up

