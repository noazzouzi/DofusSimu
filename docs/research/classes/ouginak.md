# Ouginak — analyse complète pour DofusSimu (breed 18)

> « Barbare ». Données : API DofusDB (fichiers du jeu Dofus 3, version **3.6.12.16**, `https://api.dofusdb.fr/version`) —
> `https://api.dofusdb.fr/breeds/18`, `spell-variants?breedId=18`, `spells`, `spell-levels`, `spell-states`, `monsters/5865`
> (Roquet) et sorts cachés des types 622 (« Déclenchés Ouginak »), 2570 (« Forme Bestiale Ouginak »), 2568/2274 (infobulles),
> 2412/2577 (Roquet, « Déclenchés Roquet »), 2001 (« Sorts initiaux Ouginak »). Cache brut : `.cache/classes/hof/`
> (décodage intégral : `cdump_18.txt`).
> Rôles officiels (`breedRoles`, /10) : **Dégâts 9** (« occasionne d'importants dommages à courte portée »), **Tank 7**
> (« exploite sa Rage pour mieux encaisser les attaques »), **Entrave 5** (« retire des PM et de la fuite et augmente son
> tacle »), Amélioration 4, Soins 4, Protection 3, Placement 3, Invocation 2. Complexité officielle 2/5.

Fichier compagnon pour le moteur : `data/research/class-mechanics/ouginak.json` — `spells[]` (propriétés de lancer au grade max du niveau 200, `grades[]`, `effectsSummary` lisible, `damageLines[]` = lignes de dommages/vols/soins/boucliers réellement exécutées avec min/max normaux et critiques, zone, masque et chemin de sous-sorts `via`), `mechanics[]`, `variantChoices`, `rotations[]`, `synergies[]`, `summons[]`, `states[]`, `openQuestions[]`.

## 0. Règles moteur communes

Voir `docs/research/classes/roublard.md` §0 et `docs/research/effects.md`. La chaîne de Rage de l'Ouginak est une **preuve
supplémentaire** de la règle « cibles et conditions évaluées sur l'instantané pris au début du lancer » : le sous-sort
13745 niv. 1 contient « pose Rage si ni Rage Ouginak ni Forme Bestiale », puis « pose Raage si Rage », puis « Bestialité si
Raage » ; évalué séquentiellement, un seul gain de Rage ferait passer directement en Forme Bestiale.

Spécificités : **2905/2906** « portée max/min fixée à N » pour un sort (Forme Bestiale) ; **1045** « relance fixée à 0 »
(Proie achevée) ; **1036** « −N tour de relance » (Appel de la Meute sur Lance-roquet) ; **786** soin des attaquants
(% des dommages infligés à la Proie) ; **2803** % résistance mêlée ; **1163** dommages subis ×N % ; déclencheur **DBE**
= dommages subis d'un ennemi (de la cible) ; **X** = à la mort.

## 1. Vue d'ensemble

- **Profil** : combattant de **mêlée/courte portée** (1–4 PO pour l'essentiel) très résistant, qui monte en **Rage** en frappant
  (3 paliers : Rage → Raage → **Forme Bestiale**), désigne une **Proie** (ses attaquants se soignent de 25 % des dommages
  infligés) et dispose d'un **Roquet** qui attaque la Proie à chaque fois que l'Ouginak inflige des dommages avec ses sorts.
- Les 4 voies élémentaires sont complètes : **Terre** (Molosse, Muselière, Amarok, Cerbère, Humérus, Dogue), **Feu** (Traque,
  Rabattage, Aboi, Chasse, Tétanisation, Mâchoire), **Eau** (Os à Moelle, Cubitus, Calcanéus, Radius, Tibia, Vertèbre),
  **Air** (Charogne, Carcasse, Dépeçage, Battue, Limier, Dépouille).
- **Tank** : Rage ×0,9 puis ×0,81 sur les dommages subis (permanent tant que le palier est tenu), Molosse ×0,9 (1 tour),
  Amarok +10 % rés. mêlée, Cerbère (bouclier 150 % du niveau), Pelage Protecteur (2 × 240 % du niveau), Férocité, soins
  Apaisement 15 %/Caninos 7 %, auto-soin de la Proie (25 % des dommages infligés).
- **Entrave** : Rabattage (vole 2 PM à la Proie), Tétanisation (−3 PM), Panique (−2 PM, −40 Fuite à la Proie), Dogue (−30 Fuite),
  Cubitus (+1 PM perso), Calcanéus/Convergence/Limier (attirances), Acharnement (Pesanteur), érosion (Charogne 10 %,
  Gangrène 30 %, Appel de la Meute 10 %).
- **Utilitaire de groupe** : Aboiement (+2 PM, Inébranlable), Poursuite (glyphe +2 PM), Battue (+150 Puissance en zone),
  Rogne (+80 Puissance, +40 dommages de poussée, +20 tacle), Mâchoire (+30 esquive PM en zone), Gibier (+7 % dommages subis
  par la Proie), Acharnement (×115 % sur la Proie), Appel de la Meute (rassemble les alliés).
- **Point clé pour le simulateur** : modéliser la machine à états de la Rage (§2.1), les bonus conditionnels « si la cible est
  la Proie » (§2.4), l'attaque réactive du Roquet (§2.3) et les contraintes de la Forme Bestiale (portées fixées à 2, sorts
  défensifs interdits).

## 2. Mécaniques de classe (à implémenter)

### 2.1 Rage (états 513 « Rage », 514 « Raage », 515 « Rage Ouginak », 517 « Forme Bestiale »)

Machine à états portée par le lanceur (aucun passif nécessaire : le sort initial 21986 est vide).

| Palier | États | Effet passif |
|---|---|---|
| 0 | — | — |
| I « Rage » | 513 + 515 | **dommages subis ×90 %** (sous-sort 13776, déclencheur D, 63 tours, non désenvoûtable) |
| II « Raage » | 514 + 515 | ×90 % de Rage **et** ×90 % de Raage (13777) ⇒ **×81 %** |
| III **Forme Bestiale** | 517 (2 tours) | les deux ×90 % sont **retirés** ; Intaclable (96) ; Affaibli (42 : pas d'arme) ; **+2 PM** ; **+20 % dommages finaux** ; portée max fixée à **2** pour Molosse, Dépeçage, Carcasse, Rabattage, Dogue, Charogne, Chasse, Radius, Battue, Mâchoire, Muselière, Amarok, Tétanisation, Os à Moelle, Vertèbre, Humérus ; Apaisement et Affection limités au lanceur (portée 0) ; sorts défensifs interdits (`HS!517` : Pelage Protecteur, Férocité, Nouvelle Lune) |

- **+1 Rage** (13745 niv. 1) : 0 → I ; I → II ; II → III (Forme Bestiale **immédiate**, puis fin programmée : 13747 avec un
  délai d'1 tour pose un déclencheur « fin de tour » qui retire Bestialité et Rage ⇒ la Forme Bestiale couvre la fin du tour
  courant **et tout le tour suivant** de l'Ouginak, et retombe à 0 Rage).
  - « nécessite une cible » (24128 : l'état 3549 n'est posé que si une entité occupe la case ciblée) : Molosse, Dépeçage,
    Charogne, Radius, Gangrène, Tétanisation ; **toujours** (sans cible) : Mâchoire, Tibia, Humérus, Rogne, Acharnement ;
    **réactif** : Pelage Protecteur (dommages de poussée subis par l'allié protégé), Aboiement (dommages de mêlée subis).
  - Un sort ne donne qu'**un** palier (snapshot), même s'il touche plusieurs cibles.
- **−1 Rage** (13745 niv. 2) : II → I (retire le second ×90 %) ; I → 0. Sorts : Arcanin (+100 Puissance), Caninos (soin 7 %),
  Apaisement, Affection, Flair. Arcanin/Caninos exigent la Rage (`HS=515`), Flair aussi (`HS=515&HS!7`).
- **Sortie anticipée** de la Forme Bestiale : Apaisement / Affection lancés sous Forme Bestiale (13782).
- **Nouvelle Lune** (13745 niv. 3) : Forme Bestiale immédiate quel que soit le palier (relance 3).
- Cerbère inflige plus de coups selon le palier (§3).

### 2.2 Proie (état 516)

- Proie / Gibier : 1 PA, 1–6 PO, sans ligne de vue, relance 1. Une seule Proie : le lancer retire d'abord les effets
  Proie/Gibier de l'ancienne Proie (23979). État **infini**.
- **Proie** : toute entité qui inflige des dommages à la Proie est **soignée de 25 %** des dommages infligés (786, déclencheur D) —
  alliés de l'Ouginak compris (et en théorie les alliés de la Proie qui la frapperaient).
- **Gibier** : la Proie subit **×107 %** des dommages venant de ses ennemis (déclencheur DBE).
- **Mort de la Proie** : la relance de Proie/Gibier est remise à 0 (1045 via déclencheur X) ⇒ re-désigner immédiatement.

### 2.3 Roquet (monstre 5865) et Accrocs

- **Lance-roquet** (3 PA, 1–3 PO, case libre, relance 4 ; Appel de la Meute −1 relance) invoque un Roquet grade 3
  (6 PA, 4 PM, 15 % rés. partout, 300 Force / 150 Agilité / 250 Sagesse ; `bonusCharacteristics.lifePoints` 90 =
  90 % des PV de l'Ouginak — INCERTAIN). Sort du Roquet : **Accrocs** (13752 niv. 3 : 3 PA, 1 PO, vol de vie Neutre 24–26,
  71–73 contre les invocations).
- **Accrocs réactif** (23981) : presque tous les sorts offensifs de l'Ouginak lancent 23981 sur la cible touchée ; chaque Roquet
  de l'Ouginak (i) **avance d'1 case** vers la Proie, puis (ii) si la Proie est dans le carré de 1 autour de lui, lui **vole
  12–13 PV Neutre** (30–31 sur une invocation), selon le rang du Roquet (états 3510–3512) — « dommages réduits de moitié en
  dehors de son tour ». Les sorts de zone (Mâchoire, Amarok, Cerbère, Battue, Tibia) ne déclenchent Accrocs **qu'une fois**
  par lancer (2160 = limitation globale).
- Acharnement (sur la Proie) téléporte les Roquets au contact de la Proie.

### 2.4 Bonus « si la cible est la Proie »

| Sort | Bonus sur la Proie |
|---|---|
| Traque | le lanceur avance de 5 cases vers la Proie avant les dommages |
| Chasse | le lanceur avance de 3 cases avant les dommages (puis repousse de 4) |
| Os à Moelle / Carcasse | +6 dégâts de base au sort par lancer (3 tours, cumul 4 ⇒ +24) |
| Muselière | +22 dégâts de base par ennemi au contact du lanceur (croix 1, avant les dommages) |
| Dépouille | +20 dégâts de base par allié au contact de la cible |
| Cubitus | +1 PM au lanceur (1 tour) |
| Calcanéus | attirance 3 au lieu de 1 |
| Rabattage | vole 2 PM avant les dommages |
| Aboi | −60 Résistances Poussée (2 tours) |
| Dogue | −30 Fuite (2 tours) |
| Panique | −2 PM et −40 Fuite (1 tour) |
| Vertèbre | poison non désenvoûtable + Accrocs à chaque tick |
| Limier | attire de 2 vers la Proie les entités en croix 3 avant les dommages |
| Poursuite | le glyphe (+2 PM aux alliés) est reposé sous la Proie au début de son tour |
| Acharnement | dommages subis ×115 % (1 tour) + Roquets téléportés au contact |
| Appel de la Meute | 10 % d'érosion + attire tous les alliés de 4 vers la Proie |
| Flair | téléportation au contact de la Proie |

### 2.5 Points d'attention moteur

- Les sorts « Le sort n'est pas soumis aux contraintes de lancer sous Forme Bestiale » (Traque, Cubitus, Calcanéus, Limier)
  ne reçoivent simplement pas d'effet 2905 : leur portée reste normale.
- Plusieurs dommages ont un masque `a,A` (frappent aussi un allié ciblé) ; les attirances/poussées de Convergence/Pistage
  diffèrent selon allié/ennemi.
- Proie : effet 786 « soigne l'attaquant » = soin de 25 % des dommages **finaux** infligés (après résistances).


## 3. Fiches détaillées des 44 sorts (22 paires de variantes)

Légende : valeurs au **grade maximal accessible au niveau 200** (données DofusDB = fichiers du jeu v3.6.12.16, enregistrements du 23/06/2026). « CC » = coup critique. `[id]` = identifiant d’effet (ActionId) pour le moteur. Les sous-sorts (effets « lance le sort X ») sont développés en retrait. Les effets marqués *info-bulle uniquement* (`forClientOnly`) décrivent un comportement exécuté côté serveur par l’invocation/le passif : ils ne doivent pas être appliqués tels quels.

### 3.0 Tableau récapitulatif (grade max au niveau 200)

| Paire | Sort (id) | Base/Var. | Niv. | PA | PO | Ligne/LdV | Relance | Lancers | CC | Dégâts/soins principaux (normal) | Rôle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Molosse (13756) | base | 1 | 3 | 1–2 | /LdV | — | 3/t 2/c | 20% | 31–34 Terre | dégâts-mono, tank, rage |
| 1 | Mâchoire (13787) | var. | 95 | 3 | 0–6 | /LdV | — | 2/t | 20% | 28–31 Feu | dégâts-zone, buff, rage |
| 2 | Traque (13755) | base | 1 | 3 | 1–6 | L/LdV | — | 2/t | 10% | 31–35 Feu | dégâts-mono, mobilité |
| 2 | Dépeçage (13804) | var. | 110 | 4 | 1–4 | L/LdV | — | 2/t | 25% | 40–45 Air | dégâts-mono, anti-soin, rage |
| 3 | Charogne (13766) | base | 1 | 3 | 1–4 | /LdV | — | 3/t 2/c | 20% | 29–32 Air | dégâts-mono, érosion, rage |
| 3 | Radius (13799) | var. | 105 | 3 | 1–2 | /LdV | — | 2/t | 20% | 32–36 Eau | dégâts-mono, placement, rage |
| 4 | Os à Moelle (13762) | base | 1 | 3 | 1–8 | /LdV | — | 3/t 2/c | 10% | 21–24 Eau | dégâts-mono, rampe |
| 4 | Muselière (13793) | var. | 100 | 5 | 1–2 | /LdV | — | 1/t | 25% | 37–41 Terre | dégâts-mono, burst |
| 5 | Proie (13748) | base | 5 | 1 | 1–6 | /sans LdV | 1 | — | 0% | — | soin, marquage |
| 5 | Gibier (13786) | var. | 115 | 1 | 1–6 | /sans LdV | 1 | — | 0% | — | debuff, marquage |
| 6 | Convergence (13770) | base | 10 | 2 | 1–6 | L/LdV | — | 2/t | 0% | — | placement, mobilité |
| 6 | Pistage (13806) | var. | 120 | 2 | 1–2 | L/LdV | — | 2/t | 0% | — | placement, mobilité |
| 7 | Lance-roquet (13774) | base | 15 | 3 | 1–3 | /LdV | 4 | — | 0% | — | invocation, dégâts-mono |
| 7 | Gangrène (13792) | var. | 125 | 3 | 1–3 | /LdV | — | 1/t | 0% | — | érosion, rage |
| 8 | Amarok (13802) | base | 20 | 3 | 0–3 | /LdV | — | 2/t | 10% | 28–31 Terre | dégâts-zone, protection |
| 8 | Cerbère (13758) | var. | 130 | 4 | 1–2 | L/LdV | — | 1/t | 5% | 15–18 Terre, 21–25 Terre, 13–14 Terre | dégâts-zone, tank |
| 9 | Cubitus (13760) | base | 25 | 2 | 1–10 | /LdV | — | 4/t 2/c | 5% | 16–18 vol Eau | vol-de-vie, mobilité |
| 9 | Calcanéus (13788) | var. | 135 | 2 | 1–12 | L/LdV | — | 4/t 2/c | 5% | 19–21 vol Eau | vol-de-vie, placement |
| 10 | Arcanin (13771) | base | 30 | 1 | 0–0 | /sans LdV | — | 1/t | 0% | — | buff, rage-contrôle |
| 10 | Caninos (13797) | var. | 140 | 1 | 0–0 | /sans LdV | — | 1/t | 0% | — | soin, rage-contrôle |
| 11 | Rabattage (13754) | base | 35 | 3 | 1–4 | /LdV | — | 3/t 2/c | 10% | 29–31 vol Feu | vol-de-vie, retrait-PM |
| 11 | Aboi (13790) | var. | 145 | 2 | 1–2 | /LdV | — | 4/t 2/c | 5% | 20–22 vol Feu | vol-de-vie, debuff |
| 12 | Carcasse (13768) | base | 40 | 2 | 1–8 | /LdV | — | 4/t 2/c | 5% | 9–11 Air | dégâts-mono, rampe |
| 12 | Battue (13796) | var. | 150 | 3 | 0–6 | /LdV | — | 2/t | 10% | 27–30 Air | dégâts-zone, buff |
| 13 | Pelage Protecteur (13772) | base | 45 | 3 | 0–3 | /LdV | 3 | — | 0% | — | bouclier, protection |
| 13 | Férocité (13798) | var. | 155 | 2 | 0–3 | L/LdV | 3 | — | 0% | — | bouclier, protection |
| 14 | Chasse (13795) | base | 50 | 4 | 1–4 | /LdV | — | 3/t 2/c | 15% | 39–44 Feu | dégâts-mono, placement |
| 14 | Vertèbre (13800) | var. | 160 | 4 | 1–6 | /LdV | — | 2/t 1/c | 15% | 32–36 Eau | dégâts-mono, poison |
| 15 | Tibia (13763) | base | 55 | 4 | 0–0 | /sans LdV | — | 2/t | 25% | 40–45 Eau | dégâts-zone, placement, rage |
| 15 | Humérus (13794) | var. | 165 | 4 | 1–1 | /LdV | — | 2/t | 25% | 41–46 Terre | dégâts-mono, mobilité, rage |
| 16 | Apaisement (13769) | base | 60 | 3 | 0–4 | /LdV | 2 | — | 0% | — | soin, rage-contrôle |
| 16 | Affection (13791) | var. | 170 | 3 | 1–4 | /sans LdV | 2 | — | 0% | — | soin, placement |
| 17 | Dogue (13757) | base | 65 | 2 | 1–2 | /LdV | — | 4/t 2/c | 5% | 17–19 vol Terre | vol-de-vie, entrave |
| 17 | Dépouille (13789) | var. | 175 | 5 | 1–2 | /LdV | — | 1/t | 25% | 35–39 Air | dégâts-mono, burst |
| 18 | Panique (13781) | base | 70 | 2 | 0–6 | /sans LdV | — | 1/t | 0% | — | placement, retrait-PM |
| 18 | Poursuite (13801) | var. | 180 | 2 | 0–6 | L/LdV | 2 | — | 0% | — | buff, mobilité |
| 19 | Aboiement (13773) | base | 75 | 2 | 0–4 | /LdV | 2 | — | 0% | — | buff, mobilité, protection |
| 19 | Rogne (13803) | var. | 185 | 2 | 0–3 | /sans LdV | 3 | — | 0% | — | buff, rage |
| 20 | Limier (13765) | base | 80 | 3 | 1–3 | /LdV | — | 3/t 2/c | 10% | 28–31 Air | dégâts-mono, placement |
| 20 | Tétanisation (13753) | var. | 190 | 4 | 1–4 | /LdV | — | 2/t | 25% | 41–46 Feu | dégâts-mono, retrait-PM, rage |
| 21 | Flair (13749) | base | 85 | 3 | 1–63 | /sans LdV | 2 | — | 0% | — | mobilité |
| 21 | Acharnement (13805) | var. | 195 | 2 | 1–5 | L/LdV | 2 | — | 0% | — | debuff, rage |
| 22 | Appel de la Meute (14357) | base | 90 | 2 | 0–6 | /LdV | 2 | — | 0% | — | placement, utilitaire |
| 22 | Nouvelle Lune (14321) | var. | 200 | 2 | 0–0 | /sans LdV | 3 | — | 0% | — | burst, désenvoûtement |


### Paire 1 — Molosse / Mâchoire

#### Molosse (`13756`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Terre aux ennemis et réduit les dommages subis par le lanceur.  Augmente la Rage (nécessite une cible).

- Caractéristiques (g3) : **3 PA** · portée 1–2 (non modifiable) · ligne de vue requise · CC 20% · 3×/tour · 2×/cible · cumul max 1
- Grades : g1 (niv. 1) : 3 PA, po 1–2, 18–20 Terre ; g2 (niv. 66) : 3 PA, po 1–2, 24–27 Terre ; g3 (niv. 132) : 3 PA, po 1–2, 31–34 Terre
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–2 PO, LdV, 3/tour, 2/cible, CC 20 %
  - Dommages Terre 31–34 (CC 37–41) aux ennemis
  - Lanceur : dommages subis ×90 % pendant 1 tour (non cumulable)
  - +1 Rage (nécessite une cible) ; déclenche Accrocs
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (24128, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 24128 niv.1 : pose « Cible Ouginak » (3549) sur le lanceur seulement si une entité occupe la case ciblée (condition « nécessite une cible »).
  - **31 à 34 dommages Terre (CC : 37 à 41)** → cible ennemie  `[97]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **Dommages subis x90%** → lanceur ; actif 1 tour(s), déclencheur : quand la cible subit des dommages  `[1163]`
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (24128, niv. 2)** → lanceur  `[792]`
    - ↳ sous-sort 24128 niv.2 : si le lanceur porte « Cible Ouginak » : +1 Rage (13745 niv. 1, §2.1), puis retire 3549.
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Sort de base Terre au contact : dégâts + réduction de 10 % jusqu'au prochain tour. Premier palier de Rage idéal en ouverture.
- *Notes moteur* : 1163 ×90 % (déclencheur D, 1 tour, maxStack 1) sur le lanceur, en plus des ×90 % de Rage.

#### Mâchoire (`13787`) — variante (obtenu niv. 95)

> Augmente l'Esquive PM du lanceur et des alliés, retire de l'Esquive PM et occasionne des dommages Feu aux ennemis en zone.  Augmente la Rage.

- Caractéristiques (g2) : **3 PA** · portée 0–6 (non modifiable) · ligne de vue requise · CC 20% · 2×/tour · cumul max 1
- Grades : g1 (niv. 95) : 3 PA, po 0–5, 23–25 Feu ; g2 (niv. 162) : 3 PA, po 0–6, 28–31 Feu
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–6 PO, LdV, 2/tour, CC 20 %
  - Cercle 2 : dommages Feu 28–31 (CC 34–37) et −30 Esquive PM (2 tours) aux ennemis
  - Lanceur et alliés du cercle : +30 Esquive PM (2 tours)
  - +1 Rage (toujours) ; Accrocs une fois
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (24128, niv. 1)** → lanceur  `[1160]`
    - ↳ sous-sort 24128 niv.1 : pose « Cible Ouginak » (3549) sur le lanceur seulement si une entité occupe la case ciblée (condition « nécessite une cible »).
  - **30 Esquive PM** → lanceur, alliés (dont lanceur si dans la zone) ; zone cercle taille 2, 2 tour(s)  `[161]`
  - **-30 Esquive PM** → ennemis dans la zone ; zone cercle taille 2, 2 tour(s)  `[163]`
  - **28 à 31 dommages Feu (CC : 34 à 37)** → ennemis dans la zone ; zone cercle taille 2  `[99]`
  - **le lanceur lance (limitation globale) le sous-sort « Accrocs » (23981, niv. 1)** → ennemis dans la zone ; zone cercle taille 2  `[2160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (24128, niv. 2)** → lanceur  `[792]`
    - ↳ sous-sort 24128 niv.2 : si le lanceur porte « Cible Ouginak » : +1 Rage (13745 niv. 1, §2.1), puis retire 3549.
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Zone Feu à distance moyenne qui protège aussi le groupe contre les retraits de PM.
- *Notes moteur* : 24128 niv. 1 visé sur le lanceur (pas de condition de cible).


### Paire 2 — Traque / Dépeçage

#### Traque (`13755`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Feu. Rapproche le lanceur vers la cible avant d'appliquer les effets si c'est la Proie.  Le sort n'est pas soumis aux contraintes de lancer sous Forme Bestiale.

- Caractéristiques (g3) : **3 PA** · portée 1–6 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 10% · 2×/tour
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 19–21 Feu ; g2 (niv. 69) : 3 PA, po 1–6, 25–28 Feu ; g3 (niv. 136) : 3 PA, po 1–6, 31–35 Feu
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–6 PO en ligne, LdV, 2/tour
  - Si la cible est la Proie : le lanceur avance de 5 cases vers elle avant les dommages
  - Dommages Feu 31–35 (CC 37–42)
  - Accrocs ; non soumis aux contraintes de Forme Bestiale (portée normale)
- Effets décodés (données brutes DofusDB) :
  - **Le lanceur avance de 5 case(s) vers la cible** → cible ennemie — si cible a l'état « Proie » (516)  `[1042]`
  - **31 à 35 dommages Feu (CC : 37 à 42)** → cible (alliée ou ennemie)  `[99]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
- **Analyse / rôle tactique** : Engagement sur la Proie (avance 5) — utilisable en Forme Bestiale à 6 PO.
- *Notes moteur* : Pas de Rage.

#### Dépeçage (`13804`) — variante (obtenu niv. 110)

> Réduit les soins reçus par la cible et occasionne des dommages Air.  Augmente la Rage (nécessite une cible).

- Caractéristiques (g2) : **4 PA** · portée 1–4 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 25% · 2×/tour · cumul max 1
- Grades : g1 (niv. 110) : 4 PA, po 1–4, 34–38 Air ; g2 (niv. 177) : 4 PA, po 1–4, 40–45 Air
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 1–4 PO en ligne, LdV, 2/tour, CC 25 %
  - Dommages Air 40–45 (CC 48–54)
  - Soins reçus ×50 % pour la cible (déclencheur, 1 tour)
  - +1 Rage (nécessite une cible) ; Accrocs
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (24128, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 24128 niv.1 : pose « Cible Ouginak » (3549) sur le lanceur seulement si une entité occupe la case ciblée (condition « nécessite une cible »).
  - **Soins reçus x50%** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : quand la cible est soignée  `[1159]`
  - **40 à 45 dommages Air (CC : 48 à 54)** → cible (alliée ou ennemie)  `[98]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (24128, niv. 2)** → lanceur  `[792]`
    - ↳ sous-sort 24128 niv.2 : si le lanceur porte « Cible Ouginak » : +1 Rage (13745 niv. 1, §2.1), puis retire 3549.
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Gros sort Air mono + anti-soin (×50 %) : à prendre contre des boss qui se soignent.
- *Notes moteur* : 1159 ×50 % (déclencheur H).


### Paire 3 — Charogne / Radius

#### Charogne (`13766`) — sort de base (obtenu niv. 1)

> Érode la cible et occasionne des dommages Air.  Augmente la Rage (nécessite une cible).

- Caractéristiques (g3) : **3 PA** · portée 1–4 (non modifiable) · ligne de vue requise · CC 20% · 3×/tour · 2×/cible · cumul max 2
- Grades : g1 (niv. 1) : 3 PA, po 1–4, 18–20 Air ; g2 (niv. 68) : 3 PA, po 1–4, 25–27 Air ; g3 (niv. 134) : 3 PA, po 1–4, 29–32 Air
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–4 PO, LdV, 3/tour, 2/cible, CC 20 %
  - Dommages Air 29–32 (CC 35–38)
  - 10 % d'érosion (2 tours, cumul 2)
  - +1 Rage (nécessite une cible) ; Accrocs
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (24128, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 24128 niv.1 : pose « Cible Ouginak » (3549) sur le lanceur seulement si une entité occupe la case ciblée (condition « nécessite une cible »).
  - **10% Érosion** → cible (alliée ou ennemie) ; 2 tour(s)  `[776]`
  - **29 à 32 dommages Air (CC : 35 à 38)** → cible (alliée ou ennemie)  `[98]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (24128, niv. 2)** → lanceur  `[792]`
    - ↳ sous-sort 24128 niv.2 : si le lanceur porte « Cible Ouginak » : +1 Rage (13745 niv. 1, §2.1), puis retire 3549.
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Sort Air de base à 4 PO avec érosion.
- *Notes moteur* : 776 érosion 10 %, maxStack 2.

#### Radius (`13799`) — variante (obtenu niv. 105)

> Échange de position avec la cible et occasionne des dommages Eau aux ennemis.  Augmente la Rage (nécessite une cible).

- Caractéristiques (g2) : **3 PA** · portée 1–2 (non modifiable) · ligne de vue requise · CC 20% · 2×/tour
- Grades : g1 (niv. 105) : 3 PA, po 1–2, 26–29 Eau ; g2 (niv. 172) : 3 PA, po 1–2, 32–36 Eau
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–2 PO, LdV, 2/tour, CC 20 %
  - Échange de position avec la cible (alliée ou ennemie)
  - Dommages Eau 32–36 (CC 38–43) aux ennemis
  - +1 Rage (nécessite une cible) ; Accrocs
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (24128, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 24128 niv.1 : pose « Cible Ouginak » (3549) sur le lanceur seulement si une entité occupe la case ciblée (condition « nécessite une cible »).
  - **Échange de positions (lanceur ↔ cible)** → cible (alliée ou ennemie)  `[8]`
  - **32 à 36 dommages Eau (CC : 38 à 43)** → cible ennemie  `[96]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (24128, niv. 2)** → lanceur  `[792]`
    - ↳ sous-sort 24128 niv.2 : si le lanceur porte « Cible Ouginak » : +1 Rage (13745 niv. 1, §2.1), puis retire 3549.
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Transposition au contact : sauver un allié taclé ou repositionner un ennemi.
- *Notes moteur* : Effet 8 avant les dommages.


### Paire 4 — Os à Moelle / Muselière

#### Os à Moelle (`13762`) — sort de base (obtenu niv. 1)

> Occasionne des dommages Eau. Les dommages du sort sont augmentés après chaque lancer si la cible est la Proie.

- Caractéristiques (g3) : **3 PA** · portée 1–8 (non modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible · cumul max 4
- Grades : g1 (niv. 1) : 3 PA, po 1–6, 12–14 Eau ; g2 (niv. 67) : 3 PA, po 1–7, 16–19 Eau ; g3 (niv. 133) : 3 PA, po 1–8, 21–24 Eau
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–8 PO, LdV, 3/tour, 2/cible, CC 10 %
  - Dommages Eau 21–24 (CC 25–29)
  - Si la cible est la Proie : +6 dégâts de base au sort pour 3 tours (cumul 4 ⇒ +24)
  - Accrocs
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Os à Moelle » (13761, niv. 1)** → cible ennemie — si cible a l'état « Proie » (516)  `[1160]`
    - ↳ sous-sort 13761 « Os à Moelle » niv.1 :
      - **Applique l'état « Os à Moelle » (3513)** → lanceur ; 1 tour(s)  `[950]`
  - **21 à 24 dommages Eau (CC : 25 à 29)** → cible (alliée ou ennemie)  `[96]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **la cible lance (sur elle-même) le sous-sort « Os à Moelle » (13761, niv. 4)** → lanceur  `[792]`
    - ↳ sous-sort 13761 « Os à Moelle » niv.4 :
      - **Os à Moelle : +6 dégâts de base** → lanceur — si lanceur a l'état « Os à Moelle » (3513) ; 3 tour(s)  `[293]`
      - **Retire l'état « Os à Moelle » (3513)** → lanceur — si lanceur a l'état « Os à Moelle » (3513)  `[951]`
  - **Os à Moelle : +6 dégâts de base** → lanceur ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
- **Analyse / rôle tactique** : Seul sort à longue portée (1–8) : sort à rampe sur la Proie, 3 lancers/tour (2 par cible).
- *Notes moteur* : État 3513 posé si Proie ; le sous-sort 13761 niv. 4 ajoute le 293 après les dommages.

#### Muselière (`13793`) — variante (obtenu niv. 100)

> Occasionne des dommages Terre. Augmente les dommages du sort pour chaque ennemi au contact du lanceur avant d'appliquer les effets si la cible est la Proie.

- Caractéristiques (g2) : **5 PA** · portée 1–2 (non modifiable) · ligne de vue requise · CC 25% · 1×/tour
- Grades : g1 (niv. 100) : 5 PA, po 1–2, 30–33 Terre ; g2 (niv. 167) : 5 PA, po 1–2, 37–41 Terre
- **Résumé des effets (lecture humaine)** :
  - 5 PA, 1–2 PO, LdV, 1/tour, CC 25 %
  - Si la cible est la Proie : +22 dégâts de base par ennemi au contact du lanceur (croix 1) avant les dommages
  - Dommages Terre 37–41 (CC 44–49)
  - Accrocs
- Effets décodés (données brutes DofusDB) :
  - **18544** → cible ennemie — si cible a l'état « Proie » (516)  `[1019]`
  - **Muselière : +22 dégâts de base** → lanceur ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
  - **37 à 41 dommages Terre (CC : 44 à 49)** → cible (alliée ou ennemie)  `[97]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **Retire les effets du sort « Muselière » (18544)** → lanceur  `[406]`
- **Analyse / rôle tactique** : Burst Terre au cœur de la mêlée : entouré de 3 ennemis, 37–41 + 66 de base sur la Proie.
- *Notes moteur* : Sous-sort 18544 (1019 : le lanceur sur lui-même, zone Q1) : 293 +22 par ennemi, 1 tour, puis dispel après les dommages.


### Paire 5 — Proie / Gibier

#### Proie (`13748`) — sort de base (obtenu niv. 5)

> Applique l'état Proie sur l'ennemi ciblé. Les entités qui attaquent la cible sont soignées d'une partie des dommages occasionnés.  Fixe le temps de relance du sort à 0 si la Proie est achevée.

- Caractéristiques (g3) : **1 PA** · portée 1–6 (non modifiable) · sans ligne de vue · CC 0% · relance 1 t. · cumul max 1
- Grades : g1 (niv. 5) : 1 PA, po 1–6 ; g2 (niv. 72) : 1 PA, po 1–6 ; g3 (niv. 139) : 1 PA, po 1–6
- **Résumé des effets (lecture humaine)** :
  - 1 PA, 1–6 PO, sans LdV, relance 1
  - Pose l'état Proie (516, infini) sur l'ennemi ; retire l'ancienne Proie
  - Toute entité qui attaque la Proie est soignée de 25 % des dommages infligés
  - Relance remise à 0 si la Proie meurt
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Proie » (23979, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 23979 niv.1 : retire les effets de Proie et de Gibier de l'ancienne Proie (une seule Proie à la fois).
  - **Applique l'état « Proie » (516)** → cible ennemie ; durée infinie  `[950]`
  - **Soigne l'attaquant de 25% des dommages qu'il inflige à la cible** → cible ennemie ; actif 63 tour(s), déclencheur : quand la cible subit des dommages  `[786]`
  - **le lanceur lance le sous-sort « Proie » (13785, niv. 1)** → cible ennemie ; actif 63 tour(s), déclencheur : à la mort (INCERTAIN)  `[1160]`
    - ↳ sous-sort 13785 niv.1 : à la mort de la Proie : relance de Proie fixée à 0.
- **Analyse / rôle tactique** : Marqueur central : active les bonus « Proie » de la moitié des sorts et soigne tout le groupe qui frappe la cible (énorme en PvM).
- *Notes moteur* : 786 (25 %) déclencheur D, 63 tours ; 13785 sur déclencheur X (mort).

#### Gibier (`13786`) — variante (obtenu niv. 115)

> Applique l'état Proie sur l'ennemi ciblé et augmente les dommages qu'il subit.  Fixe le temps de relance du sort à 0 si la Proie est achevée.

- Caractéristiques (g2) : **1 PA** · portée 1–6 (non modifiable) · sans ligne de vue · CC 0% · relance 1 t. · cumul max 1
- Grades : g1 (niv. 115) : 1 PA, po 1–5 ; g2 (niv. 182) : 1 PA, po 1–6
- **Résumé des effets (lecture humaine)** :
  - 1 PA, 1–6 PO, sans LdV, relance 1
  - Pose l'état Proie
  - La Proie subit ×107 % des dommages de ses ennemis
  - Relance remise à 0 si la Proie meurt
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Proie » (23979, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 23979 niv.1 : retire les effets de Proie et de Gibier de l'ancienne Proie (une seule Proie à la fois).
  - **Applique l'état « Proie » (516)** → cible ennemie ; durée infinie  `[950]`
  - **Dommages subis x107%** → cible ennemie ; actif 63 tour(s), déclencheur : dommages subis d'un ennemi  `[1163]`
  - **le lanceur lance le sous-sort « Gibier » (30763, niv. 1)** → cible ennemie ; actif 63 tour(s), déclencheur : à la mort (INCERTAIN)  `[1160]`
    - ↳ sous-sort 30763 niv.1 : à la mort de la Proie : relance de Gibier fixée à 0.
- **Analyse / rôle tactique** : Variante offensive : +7 % de dommages pour tout le groupe sur la cible, mais perd le soin de 25 %.
- *Notes moteur* : 1163 ×107 % déclencheur DBE.


### Paire 6 — Convergence / Pistage

#### Convergence (`13770`) — sort de base (obtenu niv. 10)

> Rapproche le lanceur vers l'allié ciblé ou attire l'ennemi ciblé.

- Caractéristiques (g3) : **2 PA** · portée 1–6 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 0% · 2×/tour
- Grades : g1 (niv. 10) : 2 PA, po 1–4 ; g2 (niv. 77) : 2 PA, po 1–5 ; g3 (niv. 144) : 2 PA, po 1–6
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–6 PO en ligne, LdV, 2/tour
  - Allié ciblé : le lanceur avance de 5 cases vers lui
  - Ennemi ciblé : l'attire de 5 cases
- Effets décodés (données brutes DofusDB) :
  - **Le lanceur avance de 5 case(s) vers la cible** → cible alliée  `[1042]`
  - **Attire la cible de 5 case(s)** → cible ennemie  `[6]`
- **Analyse / rôle tactique** : Attirance longue (5) pour ramener une cible au corps à corps, ou déplacement vers un allié.

#### Pistage (`13806`) — variante (obtenu niv. 120)

> Repousse la cible et rapproche le lanceur vers elle.

- Caractéristiques (g2) : **2 PA** · portée 1–2 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 0% · 2×/tour
- Grades : g1 (niv. 120) : 2 PA, po 1–2 ; g2 (niv. 187) : 2 PA, po 1–2
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–2 PO en ligne, LdV, 2/tour
  - Repousse la cible de 2 cases puis le lanceur avance de 3 cases vers elle
- Effets décodés (données brutes DofusDB) :
  - **Repousse la cible de 2 case(s)** → cible (alliée ou ennemie)  `[5]`
  - **Le lanceur avance de 3 case(s) vers la cible** → cible (alliée ou ennemie)  `[1042]`
- **Analyse / rôle tactique** : Poussée qui reste au contact (dommages de poussée + maintien du tacle).


### Paire 7 — Lance-roquet / Gangrène

#### Lance-roquet (`13774`) — sort de base (obtenu niv. 15)

> Invoque un Roquet maîtrisable qui peut voler de la vie dans l'élément Neutre.  Lorsque le lanceur occasionne des dommages avec ses sorts Ouginak, le Roquet se rapproche vers la Proie et l'attaque s'il est à portée. Les dommages sont réduits de moitié en-dehors de son tour de jeu.

- Caractéristiques (g3) : **3 PA** · portée 1–3 (non modifiable) · ligne de vue requise · case libre requise · CC 0% · relance 4 t.
- Grades : g1 (niv. 15) : 3 PA, po 1–3 ; g2 (niv. 82) : 3 PA, po 1–3 ; g3 (niv. 149) : 3 PA, po 1–3
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–3 PO, LdV, case libre, relance 4
  - Invoque un Roquet (grade 3) : 6 PA, 4 PM, sort Accrocs (vol Neutre 24–26 au contact)
  - Le Roquet se rapproche de la Proie et l'attaque à chaque fois que l'Ouginak inflige des dommages avec ses sorts (12–13, moitié hors de son tour)
- Effets décodés (données brutes DofusDB) :
  - **Invoque « Roquet » (monstre 5865, grade 3)** → cible (alliée ou ennemie)  `[181]`
  - **Applique l'état « Roquet Rang 3 » (3512)** → alliés (dont lanceur si dans la zone), U (INCERTAIN) — si cible est le monstre « Roquet » (5865) ; durée infinie, non désenvoûtable  `[950]`
- **Analyse / rôle tactique** : Dégâts additionnels réguliers sur la Proie + bloqueur de mêlée. Invoquer au tour 1.
- *Notes moteur* : Voir §2.3. État 3512 « Roquet Rang 3 » posé sur le Roquet.

#### Gangrène (`13792`) — variante (obtenu niv. 125)

> Érode l'ennemi ciblé.  Augmente la Rage (nécessite une cible).

- Caractéristiques (g2) : **3 PA** · portée 1–3 (non modifiable) · ligne de vue requise · CC 0% · 1×/tour · cumul max 1
- Grades : g1 (niv. 125) : 3 PA, po 1–3 ; g2 (niv. 192) : 3 PA, po 1–3
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–3 PO, LdV, 1/tour
  - 30 % d'érosion à l'ennemi (2 tours)
  - +1 Rage (nécessite une cible)
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (24128, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 24128 niv.1 : pose « Cible Ouginak » (3549) sur le lanceur seulement si une entité occupe la case ciblée (condition « nécessite une cible »).
  - **30% Érosion** → cible ennemie ; 2 tour(s)  `[776]`
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (24128, niv. 2)** → lanceur  `[792]`
    - ↳ sous-sort 24128 niv.2 : si le lanceur porte « Cible Ouginak » : +1 Rage (13745 niv. 1, §2.1), puis retire 3549.
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Érosion forte (30 %) : utile en PvP et contre des boss très soignés ; en PvM, moins rentable que Lance-roquet.


### Paire 8 — Amarok / Cerbère

#### Amarok (`13802`) — sort de base (obtenu niv. 20)

> Augmente les résistances en mêlée du lanceur et des alliés et occasionne des dommages Terre aux ennemis en zone. Les dommages de zone ne sont pas dégressifs.

- Caractéristiques (g3) : **3 PA** · portée 0–3 (non modifiable) · ligne de vue requise · CC 10% · 2×/tour · cumul max 1
- Grades : g1 (niv. 20) : 3 PA, po 0–3, 18–20 Terre ; g2 (niv. 87) : 3 PA, po 0–3, 23–25 Terre ; g3 (niv. 154) : 3 PA, po 0–3, 28–31 Terre
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–3 PO, LdV, 2/tour
  - Croix 1 : dommages Terre 28–31 (CC 34–37) non dégressifs aux ennemis
  - Lanceur et alliés de la croix : +10 % résistance mêlée (1 tour)
  - Accrocs une fois
- Effets décodés (données brutes DofusDB) :
  - **10% Résistance mêlée** → lanceur, alliés (dont lanceur si dans la zone) ; zone croix taille 1, 1 tour(s)  `[2803]`
  - **28 à 31 dommages Terre (CC : 34 à 37)** → ennemis dans la zone ; zone croix taille 1  `[97]`
  - **le lanceur lance (limitation globale) le sous-sort « Accrocs » (23981, niv. 1)** → ennemis dans la zone ; zone croix taille 1  `[2160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
- **Analyse / rôle tactique** : Petite zone Terre qui protège les alliés au contact (mêlée).
- *Notes moteur* : 2803 % rés. mêlée.

#### Cerbère (`13758`) — variante (obtenu niv. 130)

> Applique un bouclier sur le lanceur et occasionne des dommages Terre aux ennemis en zone. Les dommages du sort sont plus importants selon la Rage du lanceur et le bouclier n'est pas appliqué sous Forme Bestiale.

- Caractéristiques (g2) : **4 PA** · portée 1–2 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 5% · 1×/tour · cumul max 1
- Grades : g1 (niv. 130) : 4 PA, po 1–2, 13–16 Terre, 19–22 Terre, 11–12 Terre ; g2 (niv. 197) : 4 PA, po 1–2, 15–18 Terre, 21–25 Terre, 13–14 Terre
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 1–2 PO en ligne, LdV, 1/tour, CC 5 %
  - Bouclier 150 % du niveau au lanceur (1 tour), sauf en Forme Bestiale
  - Demi-cercle 1 : sans Rage 15–18 Terre ; Rage 21–25 ; Raage 2 × 15–18 ; Forme Bestiale 3 × 13–14 (CC 19–23 / 26–30 / 2×19–22 / 3×15–16)
  - Accrocs une fois
- Effets décodés (données brutes DofusDB) :
  - **Bouclier : 150% du niveau** → lanceur — si lanceur n'a PAS l'état « Forme Bestiale » (517) ; 1 tour(s)  `[1020]`
  - **le lanceur lance le sous-sort « Aucune Rage : » (25720, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25720 niv.1 : infobulle (aucun effet de jeu).
  - **15 à 18 dommages Terre (CC : 19 à 23)** → ennemis dans la zone — si lanceur n'a PAS l'état « Rage » (513) ET si lanceur n'a PAS l'état « Raage » (514) ET si lanceur n'a PAS l'état « Forme Bestiale » (517) ; zone demi-cercle taille 1  `[97]`
  - **le lanceur lance le sous-sort « Rage : » (25721, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25721 niv.1 : infobulle (aucun effet de jeu).
  - **21 à 25 dommages Terre (CC : 26 à 30)** → ennemis dans la zone — si lanceur a l'état « Rage » (513) ; zone demi-cercle taille 1  `[97]`
  - **le lanceur lance le sous-sort « Raage : » (25722, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25722 niv.1 : infobulle (aucun effet de jeu).
  - **15 à 18 dommages Terre (CC : 19 à 22)** → ennemis dans la zone — si lanceur a l'état « Raage » (514) ; zone demi-cercle taille 1  `[97]`
  - **15 à 18 dommages Terre (CC : 19 à 22)** → ennemis dans la zone — si lanceur a l'état « Raage » (514) ; zone demi-cercle taille 1  `[97]`
  - **le lanceur lance le sous-sort « Forme Bestiale : » (25723, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25723 niv.1 : infobulle (aucun effet de jeu).
  - **13 à 14 dommages Terre (CC : 15 à 16)** → ennemis dans la zone — si lanceur a l'état « Forme Bestiale » (517) ; zone demi-cercle taille 1  `[97]`
  - **13 à 14 dommages Terre (CC : 15 à 16)** → ennemis dans la zone — si lanceur a l'état « Forme Bestiale » (517) ; zone demi-cercle taille 1  `[97]`
  - **13 à 14 dommages Terre (CC : 15 à 16)** → ennemis dans la zone — si lanceur a l'état « Forme Bestiale » (517) ; zone demi-cercle taille 1  `[97]`
  - **le lanceur lance (limitation globale) le sous-sort « Accrocs » (23981, niv. 1)** → ennemis dans la zone ; zone demi-cercle taille 1  `[2160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
- **Analyse / rôle tactique** : Dégâts qui croissent avec la Rage (≈ ×2,5 en Forme Bestiale) + bouclier de 300 PV au niveau 200 hors Forme Bestiale.
- *Notes moteur* : Lignes conditionnées par *E513/*E514/*E517/*e… sur le lanceur.


### Paire 9 — Cubitus / Calcanéus

#### Cubitus (`13760`) — sort de base (obtenu niv. 25)

> Vole de la vie dans l'élément Eau. Donne 1 PM au lanceur si la cible est la Proie.  Le sort n'est pas soumis aux contraintes de lancer sous Forme Bestiale.

- Caractéristiques (g3) : **2 PA** · portée 1–10 (non modifiable) · ligne de vue requise · CC 5% · 4×/tour · 2×/cible
- Grades : g1 (niv. 25) : 2 PA, po 1–8, 10–12 vol Eau ; g2 (niv. 92) : 2 PA, po 1–9, 14–16 vol Eau ; g3 (niv. 159) : 2 PA, po 1–10, 16–18 vol Eau
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–10 PO, LdV, 4/tour, 2/cible, CC 5 %
  - Vol de vie Eau 16–18 (CC 19–22)
  - Si la cible est la Proie : +1 PM au lanceur (1 tour)
  - Accrocs ; non soumis aux contraintes de Forme Bestiale
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Cubitus » (13759, niv. 1)** → cible ennemie — si cible a l'état « Proie » (516)  `[1160]`
    - ↳ sous-sort 13759 « Cubitus » niv.1 :
      - **Applique l'état « Cubitus » (3515)** → lanceur ; 1 tour(s), non désenvoûtable  `[950]`
  - **16 à 18 vol Eau (CC : 19 à 22)** → cible (alliée ou ennemie)  `[91]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **le lanceur lance le sous-sort « Cubitus » (13759, niv. 2) (CC : 13759)** → lanceur  `[1160]`
    - ↳ sous-sort 13759 « Cubitus » niv.2 :
      - **1 PM** → lanceur — si lanceur a l'état « Cubitus » (3515) ; 1 tour(s)  `[128]`
      - **Retire l'état « Cubitus » (3515)** → lanceur — si lanceur a l'état « Cubitus » (3515)  `[951]`
  - **1 PM** → lanceur ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[128]`
- **Analyse / rôle tactique** : Filler à 2 PA longue portée (même en Forme Bestiale) ; +1 PM par lancer sur la Proie (jusqu'à +2 PM, 2/cible).
- *Notes moteur* : État 3515 puis 128 +1 PM.

#### Calcanéus (`13788`) — variante (obtenu niv. 135)

> Vole de la vie dans l'élément Eau aux ennemis et attire la cible. L'attirance est plus importante sur la Proie.  Le sort n'est pas soumis aux contraintes de lancer sous Forme Bestiale.

- Caractéristiques (g1) : **2 PA** · portée 1–12 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 5% · 4×/tour · 2×/cible
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–12 PO en ligne, LdV, 4/tour, 2/cible, CC 5 %
  - Vol de vie Eau 19–21 (CC 23–25) aux ennemis
  - Attire la cible de 1 case (3 si c'est la Proie) ; attire aussi un allié ciblé de 1
  - Accrocs ; non soumis aux contraintes de Forme Bestiale
- Effets décodés (données brutes DofusDB) :
  - **19 à 21 vol Eau (CC : 23 à 25)** → cible ennemie  `[91]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **Attire la cible de 1 case(s)** → cible alliée  `[6]`
  - **Attire la cible de 1 case(s)** → cible ennemie — si cible n'a PAS l'état « Proie » (516)  `[6]`
  - **Attire la cible de 3 case(s)** → cible ennemie — si cible a l'état « Proie » (516)  `[6]`
- **Analyse / rôle tactique** : Attirance à très longue portée (12) pour ramener la Proie au contact.


### Paire 10 — Arcanin / Caninos

#### Arcanin (`13771`) — sort de base (obtenu niv. 30)

> Augmente la Puissance du lanceur.  Nécessite et diminue la Rage.

- Caractéristiques (g3) : **1 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · 1×/tour · cumul max 2 · condition : lanceur a l’état « Rage Ouginak » (515)
- Grades : g1 (niv. 30) : 1 PA, po 0–0 ; g2 (niv. 97) : 1 PA, po 0–0 ; g3 (niv. 164) : 1 PA, po 0–0
- **Résumé des effets (lecture humaine)** :
  - 1 PA, sur soi, 1/tour ; nécessite la Rage (HS=515)
  - +100 Puissance (3 tours, cumul 2)
  - −1 palier de Rage
- Effets décodés (données brutes DofusDB) :
  - **+100 Puissance** → lanceur ; 3 tour(s)  `[138]`
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (13745, niv. 2)** → lanceur  `[1160]`
    - ↳ sous-sort 13745 niv.2 : −1 Rage : Raage → Rage (retire le second ×90 %) ; Rage → aucune (retire 513/515 et le ×90 %).
  - **le lanceur lance le sous-sort « - 1 Rage » (23978, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23978 niv.1 : infobulle « −1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Convertit un palier de Rage en +100 Puissance (permet de retarder la Forme Bestiale ou de garder Rage I).
- *Notes moteur* : 13745 niv. 2.

#### Caninos (`13797`) — variante (obtenu niv. 140)

> Soigne le lanceur.  Nécessite et diminue la Rage.

- Caractéristiques (g1) : **1 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · 1×/tour · condition : lanceur a l’état « Rage Ouginak » (515)
- **Résumé des effets (lecture humaine)** :
  - 1 PA, sur soi, 1/tour ; nécessite la Rage
  - Soin 7 % PV max du lanceur
  - −1 palier de Rage
- Effets décodés (données brutes DofusDB) :
  - **Soin : 7% des PV max** → lanceur  `[1109]`
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (13745, niv. 2)** → lanceur  `[1160]`
    - ↳ sous-sort 13745 niv.2 : −1 Rage : Raage → Rage (retire le second ×90 %) ; Rage → aucune (retire 513/515 et le ×90 %).
  - **le lanceur lance le sous-sort « - 1 Rage » (23978, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23978 niv.1 : infobulle « −1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Auto-soin bon marché, contrepartie : perte d'un palier (donc de 10 % de réduction).


### Paire 11 — Rabattage / Aboi

#### Rabattage (`13754`) — sort de base (obtenu niv. 35)

> Vole de la vie dans l'élément Feu. Vole des PM avant d'appliquer les effets si la cible est la Proie.

- Caractéristiques (g3) : **3 PA** · portée 1–4 (non modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible · cumul max 2
- Grades : g1 (niv. 35) : 3 PA, po 1–4, 18–20 vol Feu ; g2 (niv. 102) : 3 PA, po 1–4, 23–25 vol Feu ; g3 (niv. 169) : 3 PA, po 1–4, 29–31 vol Feu
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–4 PO, LdV, 3/tour, 2/cible, CC 10 %
  - Si la cible est la Proie : vole 2 PM (esquivable) avant les dommages
  - Vol de vie Feu 29–31 (CC 35–37)
  - Accrocs
- Effets décodés (données brutes DofusDB) :
  - **Vole 2 PM (esquivable)** → cible ennemie — si cible a l'état « Proie » (516) ; 1 tour(s), non désenvoûtable  `[77]`
  - **29 à 31 vol Feu (CC : 35 à 37)** → cible (alliée ou ennemie)  `[94]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
- **Analyse / rôle tactique** : Entrave PM sur la Proie + vol de vie ; 2 lancers sur la Proie = −4 PM / +4 PM.
- *Notes moteur* : 77 vol de PM (esquivable).

#### Aboi (`13790`) — variante (obtenu niv. 145)

> Vole de la vie dans l'élément Feu. Réduit les Résistances Poussée si la cible est la Proie.

- Caractéristiques (g1) : **2 PA** · portée 1–2 (non modifiable) · ligne de vue requise · CC 5% · 4×/tour · 2×/cible · cumul max 2
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–2 PO, LdV, 4/tour, 2/cible, CC 5 %
  - Vol de vie Feu 20–22 (CC 24–26)
  - Si la cible est la Proie : −60 Résistances Poussée (2 tours, cumul 2)
  - Accrocs
- Effets décodés (données brutes DofusDB) :
  - **20 à 22 vol Feu (CC : 24 à 26)** → cible (alliée ou ennemie)  `[94]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **-60 Résistances Poussée** → cible ennemie — si cible a l'état « Proie » (516) ; 2 tour(s)  `[417]`
- **Analyse / rôle tactique** : Prépare les dommages de poussée (Chasse pousse de 4, Tibia de 2, Pistage).


### Paire 12 — Carcasse / Battue

#### Carcasse (`13768`) — sort de base (obtenu niv. 40)

> Occasionne des dommages Air. Les dommages du sort sont augmentés après chaque lancer si la cible est la Proie.

- Caractéristiques (g3) : **2 PA** · portée 1–8 (non modifiable) · ligne de vue requise · CC 5% · 4×/tour · 2×/cible · cumul max 4
- Grades : g1 (niv. 40) : 2 PA, po 1–6, 5–7 Air ; g2 (niv. 107) : 2 PA, po 1–7, 7–9 Air ; g3 (niv. 174) : 2 PA, po 1–8, 9–11 Air
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–8 PO, LdV, 4/tour, 2/cible, CC 5 %
  - Dommages Air 9–11 (CC 12–14)
  - Si la cible est la Proie : +6 dégâts de base au sort (3 tours, cumul 4)
  - Accrocs
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Carcasse » (13767, niv. 1)** → cible ennemie — si cible a l'état « Proie » (516)  `[1160]`
    - ↳ sous-sort 13767 « Carcasse » niv.1 :
      - **Applique l'état « Carcasse » (3514)** → lanceur ; 1 tour(s)  `[950]`
  - **9 à 11 dommages Air (CC : 12 à 14)** → cible (alliée ou ennemie)  `[98]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **la cible lance (sur elle-même) le sous-sort « Carcasse » (13767, niv. 4)** → lanceur  `[792]`
    - ↳ sous-sort 13767 « Carcasse » niv.4 :
      - **Carcasse : +6 dégâts de base** → lanceur — si lanceur a l'état « Carcasse » (3514) ; 3 tour(s)  `[293]`
      - **Retire l'état « Carcasse » (3514)** → lanceur — si lanceur a l'état « Carcasse » (3514)  `[951]`
  - **Carcasse : +6 dégâts de base** → lanceur ; 3 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
- **Analyse / rôle tactique** : Rampe Air à 2 PA : 4 lancers/tour (2 par cible) ; montée rapide (+24) sur la Proie.
- *Notes moteur* : État 3514.

#### Battue (`13796`) — variante (obtenu niv. 150)

> Occasionne des dommages Air aux ennemis et augmente la Puissance du lanceur et des alliés en zone.

- Caractéristiques (g1) : **3 PA** · portée 0–6 (non modifiable) · ligne de vue requise · CC 10% · 2×/tour · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–6 PO, LdV, 2/tour, CC 10 %
  - Cercle 2 : dommages Air 27–30 (CC 32–36) aux ennemis
  - Lanceur et alliés du cercle : +150 Puissance (2 tours, non cumulable)
  - Accrocs une fois
- Effets décodés (données brutes DofusDB) :
  - **27 à 30 dommages Air (CC : 32 à 36)** → ennemis dans la zone ; zone cercle taille 2  `[98]`
  - **le lanceur lance (limitation globale) le sous-sort « Accrocs » (23981, niv. 1)** → ennemis dans la zone ; zone cercle taille 2  `[2160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **+150 Puissance** → lanceur, alliés (dont lanceur si dans la zone) ; zone cercle taille 2, 2 tour(s)  `[138]`
- **Analyse / rôle tactique** : Buff de groupe (+150 Puissance) au milieu de la mêlée + zone Air.


### Paire 13 — Pelage Protecteur / Férocité

#### Pelage Protecteur (`13772`) — sort de base (obtenu niv. 45)

> Applique 2 boucliers et l'état Pelage Protecteur sur l'allié ciblé : • Retire le second bouclier et l'état et augmente la Rage si la cible subit des dommages de poussée.  Ne peut pas être utilisé sous Forme Bestiale.

- Caractéristiques (g3) : **3 PA** · portée 0–3 (non modifiable) · ligne de vue requise · CC 0% · relance 3 t. · condition : lanceur n’a pas l’état « Forme Bestiale » (517)
- Grades : g1 (niv. 45) : 3 PA, po 0–3 ; g2 (niv. 112) : 3 PA, po 0–3 ; g3 (niv. 179) : 3 PA, po 0–3
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–3 PO, LdV, relance 3 ; interdit en Forme Bestiale
  - Allié (ou soi) : 2 boucliers de 240 % du niveau (2 × 480 au niveau 200, 2 tours) et état Pelage Protecteur
  - Si l'allié subit des dommages de poussée : le second bouclier et l'état sont retirés, et l'Ouginak gagne 1 Rage
- Effets décodés (données brutes DofusDB) :
  - **Bouclier : 240% du niveau** → cible alliée ; 2 tour(s)  `[1020]`
  - **Bouclier : 240% du niveau** → cible alliée ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1020]`
  - **le lanceur lance le sous-sort « Pelage Protecteur » (23986, niv. 3)** → cible alliée  `[1160]`
    - ↳ sous-sort 23986 « Pelage Protecteur » niv.3 :
      - **Bouclier : 240% du niveau** → cible alliée ; 2 tour(s)  `[1020]`
  - **Applique l'état « Pelage Protecteur » (4144)** → cible alliée ; 2 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (13745, niv. 1)** → cible alliée ; actif 2 tour(s), déclencheur : dommages de poussée subis  `[1160]`
    - ↳ sous-sort 13745 niv.1 : +1 Rage : 0 → Rage (513 + 515, dommages subis ×90 %) ; Rage → Raage (514, second ×90 %) ; Raage → Forme Bestiale (2 tours, §2.1).
  - **Retire les effets du sort « Pelage Protecteur » (13772)** → cible alliée ; actif 2 tour(s), déclencheur : dommages de poussée subis  `[406]`
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : dommages de poussée subis, *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Bouclier massif (≈ 960 points) sur le tank ou un allié fragile.
- *Notes moteur* : Second bouclier via 23986 ; déclencheur PD (dommages de poussée).

#### Férocité (`13798`) — variante (obtenu niv. 155)

> Applique l'état Férocité sur l'allié ciblé : • Applique un bouclier sur le lanceur et la cible si cette dernière est attirée, poussée, transposée, téléportée ou subit une tentative de retrait de PM. • Applique un bouclier supplémentaire si la cible est le lanceur.  Ne peut pas être utilisé sous Forme Bestiale.

- Caractéristiques (g1) : **2 PA** · portée 0–3 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 0% · relance 3 t. · relance globale 3 t. · cumul max 1 · condition : lanceur n’a pas l’état « Forme Bestiale » (517)
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–3 PO en ligne, LdV, relance 3 ; interdit en Forme Bestiale
  - État Férocité (2 tours) sur l'allié : s'il est attiré, poussé, transposé, téléporté ou subit une tentative de retrait de PM, il reçoit un bouclier de 240 % du niveau, et le lanceur aussi (+120 % supplémentaire si la cible est le lanceur) — 1 fois par tour
- Effets décodés (données brutes DofusDB) :
  - **Applique l'état « Férocité » (4153)** → cible alliée ; 2 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Férocité » (13815, niv. 1)** → cible alliée ; actif 2 tour(s), déclencheur : MPA OU quand la cible est déplacée OU téléportation (INCERTAIN)  `[1160]`
    - ↳ sous-sort 13815 « Férocité » niv.1 :
      - **le lanceur lance le sous-sort « Férocité » (13815, niv. 2)** → cible alliée — si cible n'a PAS l'état « Férocité I » (3570)  `[1160]`
        - ↳ sous-sort 13815 « Férocité » niv.2 :
          - **le lanceur lance le sous-sort « Férocité » (24202, niv. 1)** → cible alliée  `[1160]`
            - ↳ sous-sort 24202 « Férocité » niv.1 :
              - **Applique l'état « Férocité I » (3570)** → cible alliée ; 1 tour(s), non désenvoûtable  `[950]`
          - **Bouclier : 240% du niveau** → lanceur, alliés (dont lanceur si dans la zone) ; 1 tour(s)  `[1020]`
          - **Bouclier : 120% du niveau** → lanceur (s’il est dans la zone) ; 1 tour(s)  `[1020]`
  - **le lanceur lance le sous-sort « Férocité » (24202, niv. 2)** → cible alliée ; délai 1 t., non désenvoûtable  `[1160]`
    - ↳ sous-sort 24202 « Férocité » niv.2 :
      - **Retire les effets du sort « Férocité » (24202)** → alliés dans la zone ; zone tout le terrain, non désenvoûtable  `[406]`
      - **Retire les effets du sort « Férocité » (24202)** → alliés dans la zone ; zone tout le terrain, délai 1 t., non désenvoûtable  `[406]`
  - **Bouclier : 240% du niveau** → cible alliée ; 1 tour(s), actif 2 tour(s), déclencheur : MPA OU quand la cible est déplacée OU téléportation (INCERTAIN), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1020]`
  - **Bouclier : 120% du niveau** → lanceur (s’il est dans la zone) ; 1 tour(s), actif 2 tour(s), déclencheur : MPA OU quand la cible est déplacée OU téléportation (INCERTAIN), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1020]`
- **Analyse / rôle tactique** : Protection réactive contre les boss qui déplacent/retirent des PM.
- *Notes moteur* : Déclencheurs MPA|M|TP ; état 3570 « Férocité I » limite à 1 déclenchement par tour.


### Paire 14 — Chasse / Vertèbre

#### Chasse (`13795`) — sort de base (obtenu niv. 50)

> Occasionne des dommages Feu aux ennemis et repousse la cible. Rapproche le lanceur vers la cible avant d'appliquer les effets si c'est la Proie.

- Caractéristiques (g3) : **4 PA** · portée 1–4 (non modifiable) · ligne de vue requise · CC 15% · 3×/tour · 2×/cible
- Grades : g1 (niv. 50) : 4 PA, po 1–4, 25–28 Feu ; g2 (niv. 117) : 4 PA, po 1–4, 33–37 Feu ; g3 (niv. 184) : 4 PA, po 1–4, 39–44 Feu
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 1–4 PO, LdV, 3/tour, 2/cible, CC 15 %
  - Si Proie : le lanceur avance de 3 cases avant les dommages
  - Dommages Feu 39–44 (CC 47–53) aux ennemis
  - Repousse la cible de 4 cases ; Accrocs
- Effets décodés (données brutes DofusDB) :
  - **Le lanceur avance de 3 case(s) vers la cible** → cible ennemie — si cible a l'état « Proie » (516)  `[1042]`
  - **39 à 44 dommages Feu (CC : 47 à 53)** → cible ennemie  `[99]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **Repousse la cible de 4 case(s)** → cible (alliée ou ennemie)  `[5]`
- **Analyse / rôle tactique** : Gros sort Feu avec poussée 4 (dommages de poussée importants contre un obstacle, surtout après Aboi −60 rés. poussée).
- *Notes moteur* : 1042 (si Proie) → dommages → poussée.

#### Vertèbre (`13800`) — variante (obtenu niv. 160)

> Applique un poison Eau de début de tour sur l'ennemi ciblé. Le poison ne peut pas être désenvoûté s'il est appliqué sur la Proie.

- Caractéristiques (g1) : **4 PA** · portée 1–6 (non modifiable) · ligne de vue requise · CC 15% · 2×/tour · 1×/cible · cumul max 2
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 1–6 PO, LdV, 2/tour, 1/cible, cumul 2, CC 15 %
  - Poison Eau : 32–36 (CC 38–43) au début de chacun des 2 prochains tours de la cible
  - Sur la Proie : poison non désenvoûtable et Accrocs à chaque tick
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Vertèbre » (14730, niv. 1)** → cible ennemie — si cible n'a PAS l'état « Proie » (516)  `[1160]`
    - ↳ sous-sort 14730 « Vertèbre » niv.1 :
      - **32 à 36 dommages Eau (CC : 38 à 43)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : début de tour du porteur  `[96]`
  - **le lanceur lance le sous-sort « Vertèbre » (14730, niv. 2)** → cible ennemie — si cible a l'état « Proie » (516)  `[1160]`
    - ↳ sous-sort 14730 « Vertèbre » niv.2 :
      - **32 à 36 dommages Eau (CC : 38 à 43)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : début de tour du porteur  `[96]`
      - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie) ; actif 2 tour(s), déclencheur : début de tour du porteur  `[1160]`
        - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **32 à 36 dommages Eau (CC : 38 à 43)** → cible ennemie — si cible n'a PAS l'état « Proie » (516) ; actif 2 tour(s), déclencheur : début de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[96]`
  - **32 à 36 dommages Eau (CC : 38 à 43)** → cible ennemie — si cible n'a PAS l'état « Proie » (516) ; actif 2 tour(s), déclencheur : début de tour du porteur, *info-bulle uniquement (comportement réel géré côté serveur)*  `[96]`
- **Analyse / rôle tactique** : Dégâts différés (≈ 68 de base sur 2 tours) qui ignorent la portée/le tacle au moment du tick.
- *Notes moteur* : Sous-sort 14730 niv. 1 (non-Proie) / niv. 2 (Proie, non désenvoûtable) ; déclencheur TB 2 tours.


### Paire 15 — Tibia / Humérus

#### Tibia (`13763`) — sort de base (obtenu niv. 55)

> Occasionne des dommages Eau aux ennemis et repousse les cibles en zone. Les dommages de zone ne sont pas dégressifs.  Augmente la Rage.

- Caractéristiques (g3) : **4 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 25% · 2×/tour
- Grades : g1 (niv. 55) : 4 PA, po 0–0, 25–28 Eau ; g2 (niv. 122) : 4 PA, po 0–0, 32–36 Eau ; g3 (niv. 189) : 4 PA, po 0–0, 40–45 Eau
- **Résumé des effets (lecture humaine)** :
  - 4 PA, sur soi, cercle 2 (hors lanceur), 2/tour, CC 25 %
  - Dommages Eau 40–45 (CC 48–54) non dégressifs aux ennemis
  - Repousse de 2 cases les entités du cercle
  - +1 Rage (toujours) ; Accrocs une fois si un ennemi est touché
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance (limitation globale) le sous-sort « Tibia » (13778, niv. 1)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[2160]`
    - ↳ sous-sort 13778 « Tibia » niv.1 :
      - **Applique l'état « Tibia » (535)** → lanceur ; 1 tour(s), non désenvoûtable  `[950]`
  - **40 à 45 dommages Eau (CC : 48 à 54)** → ennemis dans la zone ; zone cercle taille 2 (min 1)  `[96]`
  - **le lanceur lance le sous-sort « Tibia » (13778, niv. 2)** → lanceur  `[1160]`
    - ↳ sous-sort 13778 « Tibia » niv.2 :
      - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → lanceur — si lanceur a l'état « Tibia » (535)  `[1160]`
        - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
      - **Retire l'état « Tibia » (535)** → lanceur  `[951]`
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 2 (min 1), non désenvoûtable  `[5]`
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (13745, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 13745 niv.1 : +1 Rage : 0 → Rage (513 + 515, dommages subis ×90 %) ; Rage → Raage (514, second ×90 %) ; Raage → Forme Bestiale (2 tours, §2.1).
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Meilleure zone de l'Ouginak au contact : frappe tous les ennemis autour puis les éjecte.
- *Notes moteur* : Accrocs conditionné à l'état 535 « Tibia » (posé si un ennemi est touché).

#### Humérus (`13794`) — variante (obtenu niv. 165)

> Téléporte le lanceur symétriquement par rapport à la cible et occasionne des dommages Terre aux ennemis.  Augmente la Rage (nécessite une cible).

- Caractéristiques (g1) : **4 PA** · portée 1–1 (non modifiable) · ligne de vue requise · cible requise (case occupée) · CC 25% · 2×/tour
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 1 PO, LdV, case occupée, 2/tour, CC 25 %
  - Téléporte le lanceur symétriquement par rapport à la cible
  - Dommages Terre 41–46 (CC 49–55) aux ennemis
  - +1 Rage ; Accrocs
- Effets décodés (données brutes DofusDB) :
  - **Téléportation symétrique par rapport à la cible** → cible (alliée ou ennemie)  `[1104]`
  - **41 à 46 dommages Terre (CC : 49 à 55)** → cible ennemie  `[97]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible ennemie  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (13745, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 13745 niv.1 : +1 Rage : 0 → Rage (513 + 515, dommages subis ×90 %) ; Rage → Raage (514, second ×90 %) ; Raage → Forme Bestiale (2 tours, §2.1).
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Gros sort Terre + passage de l'autre côté de la cible (désengagement du tacle).
- *Notes moteur* : 1104.


### Paire 16 — Apaisement / Affection

#### Apaisement (`13769`) — sort de base (obtenu niv. 60)

> Soigne l'allié ciblé. Nécessite et diminue la Rage.  Retire également les effets de la Forme Bestiale.

- Caractéristiques (g3) : **3 PA** · portée 0–4 (non modifiable) · ligne de vue requise · CC 0% · relance 2 t. · condition : lanceur a l’état « Rage Ouginak » (515) OU lanceur a l’état « Forme Bestiale » (517)
- Grades : g1 (niv. 60) : 3 PA, po 0–4 ; g2 (niv. 127) : 3 PA, po 0–4 ; g3 (niv. 194) : 3 PA, po 0–4
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 0–4 PO, LdV, relance 2 ; nécessite Rage ou Forme Bestiale
  - Soin 15 % PV max de l'allié ciblé
  - −1 palier de Rage, ou fin de la Forme Bestiale (portée 0 sous Forme Bestiale)
- Effets décodés (données brutes DofusDB) :
  - **Soin : 15% des PV max** → cible alliée  `[1109]`
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (13745, niv. 2)** → lanceur — si lanceur n'a PAS l'état « Forme Bestiale » (517)  `[1160]`
    - ↳ sous-sort 13745 niv.2 : −1 Rage : Raage → Rage (retire le second ×90 %) ; Rage → aucune (retire 513/515 et le ×90 %).
  - **le lanceur lance le sous-sort « Bestialité Ouginak » (13782, niv. 1)** → lanceur — si lanceur a l'état « Forme Bestiale » (517)  `[1160]`
    - ↳ sous-sort 13782 niv.1 : retire la Forme Bestiale et les effets de Rage (sorts 13746, 13745, 13747).
  - **le lanceur lance le sous-sort « - 1 Rage » (23978, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23978 niv.1 : infobulle « −1 Rage » (aucun effet de jeu).
  - **le lanceur lance le sous-sort « Retire la Forme Bestiale » (25711, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25711 niv.1 : infobulle (aucun effet de jeu).
- **Analyse / rôle tactique** : Soin conséquent d'un allié ; sert aussi à sortir de la Forme Bestiale en se soignant.
- *Notes moteur* : 13745 niv. 2 si pas en Forme Bestiale, sinon 13782.

#### Affection (`13791`) — variante (obtenu niv. 170)

> Soigne le lanceur et l'allié ciblé et échange de position avec ce dernier. Nécessite et diminue la Rage.  Retire également les effets de la Forme Bestiale.

- Caractéristiques (g1) : **3 PA** · portée 1–4 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · relance 2 t. · condition : (lanceur a l’état « Rage Ouginak » (515) ET lanceur n’a pas l’état « Pesanteur » (7)) OU lanceur a l’état « Forme Bestiale » (517)
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–4 PO, sans LdV, case occupée, relance 2 ; nécessite (Rage et pas Pesanteur) ou Forme Bestiale
  - Allié : soigne le lanceur et l'allié de 7 % PV max et échange leurs positions, −1 Rage
  - Sous Forme Bestiale : soin 7 % du lanceur seulement et fin de la Forme Bestiale
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Affection » (13816, niv. 1)** → allié ciblé (hors lanceur) — si lanceur n'a PAS l'état « Forme Bestiale » (517)  `[1160]`
    - ↳ sous-sort 13816 « Affection » niv.1 :
      - **Soin : 7% des PV max** → lanceur  `[1109]`
      - **Soin : 7% des PV max** → cible alliée  `[1109]`
      - **Échange de positions (lanceur ↔ cible)** → cible alliée  `[8]`
      - **le lanceur lance le sous-sort « La Rage d'Ouginak » (13745, niv. 2)** → lanceur  `[1160]`
        - ↳ sous-sort 13745 niv.2 : −1 Rage : Raage → Rage (retire le second ×90 %) ; Rage → aucune (retire 513/515 et le ×90 %).
  - **Soin : 7% des PV max** → lanceur — si lanceur a l'état « Forme Bestiale » (517)  `[1109]`
  - **Échange de positions (lanceur ↔ cible)** → cible alliée ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[8]`
  - **le lanceur lance le sous-sort « - 1 Rage » (23978, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23978 niv.1 : infobulle « −1 Rage » (aucun effet de jeu).
  - **le lanceur lance le sous-sort « Bestialité Ouginak » (13782, niv. 1)** → lanceur — si lanceur a l'état « Forme Bestiale » (517)  `[1160]`
    - ↳ sous-sort 13782 niv.1 : retire la Forme Bestiale et les effets de Rage (sorts 13746, 13745, 13747).
  - **le lanceur lance le sous-sort « Retire la Forme Bestiale » (25711, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25711 niv.1 : infobulle (aucun effet de jeu).
- **Analyse / rôle tactique** : Sauvetage d'un allié en danger (échange de place) avec soin.


### Paire 17 — Dogue / Dépouille

#### Dogue (`13757`) — sort de base (obtenu niv. 65)

> Vole de la vie dans l'élément Terre. Retire de la Fuite si la cible est la Proie.

- Caractéristiques (g3) : **2 PA** · portée 1–2 (non modifiable) · ligne de vue requise · CC 5% · 4×/tour · 2×/cible · cumul max 2
- Grades : g1 (niv. 65) : 2 PA, po 1–2, 10–12 vol Terre ; g2 (niv. 131) : 2 PA, po 1–2, 13–15 vol Terre ; g3 (niv. 198) : 2 PA, po 1–2, 17–19 vol Terre
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–2 PO, LdV, 4/tour, 2/cible, CC 5 %
  - Vol de vie Terre 17–19 (CC 20–23)
  - Si Proie : −30 Fuite (2 tours, cumul 2)
  - Accrocs
- Effets décodés (données brutes DofusDB) :
  - **17 à 19 vol Terre (CC : 20 à 23)** → cible (alliée ou ennemie)  `[92]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **-30 Fuite** → cible ennemie — si cible a l'état « Proie » (516) ; 2 tour(s)  `[754]`
- **Analyse / rôle tactique** : Filler à 2 PA au contact ; −60 Fuite sur la Proie en 2 lancers (empêche la fuite du tacle).

#### Dépouille (`13789`) — variante (obtenu niv. 175)

> Occasionne des dommages Air. Augmente les dommages du sort pour chaque allié au contact de la cible avant d'appliquer les effets si c'est la Proie.

- Caractéristiques (g1) : **5 PA** · portée 1–2 (non modifiable) · ligne de vue requise · CC 25% · 1×/tour · 2×/tour « global » (maxGlobalCastPerTurn, sens INCERTAIN)
- **Résumé des effets (lecture humaine)** :
  - 5 PA, 1–2 PO, LdV, 1/tour (2 globaux), CC 25 %
  - Si Proie : +20 dégâts de base par allié au contact de la cible
  - Dommages Air 35–39 (CC 42–47)
  - Accrocs
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Dépouille » (13808, niv. 3)** → cible ennemie — si cible a l'état « Proie » (516)  `[1160]`
    - ↳ sous-sort 13808 « Dépouille » niv.3 :
      - **le lanceur lance le sous-sort « Dépouille » (13808, niv. 4)** → alliés dans la zone ; zone croix sans centre taille 1  `[1160]`
        - ↳ sous-sort 13808 « Dépouille » niv.4 :
          - **Dépouille : +20 dégâts de base** → lanceur ; 1 tour(s)  `[293]`
  - **Dépouille : +20 dégâts de base** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[293]`
  - **35 à 39 dommages Air (CC : 42 à 47)** → cible (alliée ou ennemie)  `[98]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **Retire les effets du sort « Dépouille » (13808)** → lanceur  `[406]`
- **Analyse / rôle tactique** : Burst Air quand plusieurs alliés (et le Roquet) entourent la Proie.
- *Notes moteur* : Sous-sort 13808 niv. 3→4 (zone Q1 autour de la cible, alliés).


### Paire 18 — Panique / Poursuite

#### Panique (`13781`) — sort de base (obtenu niv. 70)

> Repousse les cibles depuis le centre en zone autour de la cible. Retire également des PM et de la Fuite à la Proie si elle est touchée.

- Caractéristiques (g2) : **2 PA** · portée 0–6 (non modifiable) · sans ligne de vue · cible requise (case occupée) · CC 0% · 1×/tour · cumul max 1
- Grades : g1 (niv. 70) : 2 PA, po 0–5 ; g2 (niv. 137) : 2 PA, po 0–6
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–6 PO, sans LdV, case occupée, 1/tour
  - Repousse de 2 cases les entités du cercle 3 autour de la cible (depuis le centre)
  - Proie dans la zone : −2 PM (esquivable) et −40 Fuite (1 tour)
- Effets décodés (données brutes DofusDB) :
  - **Repousse la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone cercle taille 3 (min 1)  `[5]`
  - **Retire 2 PM (esquivable)** → ennemis dans la zone — si cible a l'état « Proie » (516) ; zone cercle taille 3, 1 tour(s), non désenvoûtable  `[1080]`
  - **-40 Fuite** → ennemis dans la zone — si cible a l'état « Proie » (516) ; zone cercle taille 3, 1 tour(s)  `[754]`
- **Analyse / rôle tactique** : Dégage un allié encerclé, ou repousse les monstres d'un paquet ; entrave de la Proie.
- *Notes moteur* : Zone C3 min 1.

#### Poursuite (`13801`) — variante (obtenu niv. 180)

> Pose un glyphe qui augmente les PM des alliés.  Applique également l'état Poursuite sur la Proie si elle est sur la case ciblée : • Pose de nouveau le glyphe sous la cible au début de son tour. Cet effet est appliqué uniquement si la cible est toujours la Proie.

- Caractéristiques (g1) : **2 PA** · portée 0–6 (non modifiable) · en ligne uniquement · ligne de vue requise · CC 0% · relance 2 t. · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–6 PO en ligne, LdV, relance 2
  - Glyphe (1 tour) qui donne +2 PM aux alliés qui s'y trouvent
  - Si la Proie est sur la case ciblée : état Poursuite, le glyphe est reposé sous elle au début de son tour (si elle est toujours la Proie)
- Effets décodés (données brutes DofusDB) :
  - **Pose un glyphe-aura « Poursuite » (13812, niv. 1)** → cible (alliée ou ennemie) ; 1 tour(s)  `[1091]`
    - ↳ sous-sort 13812 « Poursuite » niv.1 :
      - **le lanceur lance le sous-sort « Poursuite » (13812, niv. 2)** → cible alliée  `[1160]`
        - ↳ sous-sort 13812 « Poursuite » niv.2 :
          - **2 PM** → cible alliée ; 1 tour(s)  `[128]`
      - **2 PM** → cible alliée ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[128]`
  - **Pose un glyphe (immédiat) « Poursuite » (13812, niv. 4)** → cible (alliée ou ennemie) ; 1 tour(s)  `[1165]`
    - ↳ sous-sort 13812 niv.4 : aucun effet de jeu (marqueur)
  - **Pose un glyphe (immédiat) « Poursuite » (13812, niv. 1)** → cible (alliée ou ennemie) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1165]`
    - ↳ (sous-sort 13812 niv.1 déjà détaillé plus haut)
  - **Applique l'état « Poursuite » (4155)** → cible ennemie — si cible a l'état « Proie » (516) ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « Poursuite » (13812, niv. 3)** → cible ennemie — si cible a l'état « Proie » (516) ; actif 1 tour(s), déclencheur : début de tour du porteur  `[1160]`
    - ↳ sous-sort 13812 « Poursuite » niv.3 :
      - **Pose un glyphe-aura « Poursuite » (13812, niv. 1)** → cible (alliée ou ennemie) ; 1 tour(s)  `[1091]`
        - ↳ (sous-sort 13812 niv.1 déjà détaillé plus haut)
      - **Pose un glyphe (immédiat) « Poursuite » (13812, niv. 4)** → cible (alliée ou ennemie) ; 1 tour(s)  `[1165]`
        - ↳ (sous-sort 13812 niv.4 déjà détaillé plus haut)
      - **Retire l'état « Poursuite » (4155)** → cible (alliée ou ennemie)  `[951]`
- **Analyse / rôle tactique** : Donne +2 PM aux alliés qui collent la Proie (le glyphe la suit).
- *Notes moteur* : Glyphe-aura 1091 + glyphe immédiat 1165 ; sous-sort 13812 niv. 3 au début du tour de la Proie.


### Paire 19 — Aboiement / Rogne

#### Aboiement (`13773`) — sort de base (obtenu niv. 75)

> Augmente les PM de la cible, la rend Inébranlable et lui applique l'état Aboiement : • Retire les états et augmente la Rage si la cible subit des dommages en mêlée.

- Caractéristiques (g2) : **2 PA** · portée 0–4 (non modifiable) · ligne de vue requise · CC 0% · relance 2 t.
- Grades : g1 (niv. 75) : 2 PA, po 0–3 ; g2 (niv. 142) : 2 PA, po 0–4
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–4 PO, LdV, relance 2
  - Cible : +2 PM (1 tour), Inébranlable (1 tour) et état Aboiement
  - Si la cible subit des dommages en mêlée : retire ces états et l'Ouginak gagne 1 Rage
- Effets décodés (données brutes DofusDB) :
  - **2 PM** → cible (alliée ou ennemie) ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[128]`
  - **le lanceur lance le sous-sort « Aboiement » (23987, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23987 « Aboiement » niv.1 :
      - **2 PM** → cible (alliée ou ennemie) ; 1 tour(s)  `[128]`
  - **Applique l'état « Inébranlable » (157)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **Applique l'état « Aboiement » (4145)** → cible (alliée ou ennemie) ; 1 tour(s)  `[950]`
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (13745, niv. 1)** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case)  `[1160]`
    - ↳ sous-sort 13745 niv.1 : +1 Rage : 0 → Rage (513 + 515, dommages subis ×90 %) ; Rage → Raage (514, second ×90 %) ; Raage → Forme Bestiale (2 tours, §2.1).
  - **Retire les effets du sort « Aboiement » (13773)** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case)  `[406]`
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; actif 1 tour(s), déclencheur : dommages de mêlée subis (≤1 case), *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : +2 PM et immunité à la poussée/attirance pour un allié (ou soi) ; la Rage gagnée compense.
- *Notes moteur* : Déclencheur DM ; 406 retire les effets à la 1re attaque de mêlée.

#### Rogne (`13803`) — variante (obtenu niv. 185)

> Augmente la Puissance, les Dommages Poussée et le Tacle de l'allié ciblé et lui applique l'état Rogne : • Augmente ces mêmes caractéristiques sur le lanceur si la cible subit des dommages (cumulable 5 fois).  Augmente la Rage.

- Caractéristiques (g1) : **2 PA** · portée 0–3 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t. · relance globale -1 t. · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–3 PO, sans LdV, relance 3
  - Allié : +80 Puissance, +40 Dommages Poussée, +20 Tacle (2 tours), état Rogne
  - Chaque fois que l'allié subit des dommages : le lanceur gagne +30 Puissance, +20 Dommages Poussée, +10 Tacle (2 tours, cumul 5)
  - +1 Rage
- Effets décodés (données brutes DofusDB) :
  - **+80 Puissance** → cible alliée ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **40 Dommages Poussée** → cible alliée ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[414]`
  - **20 Tacle** → cible alliée ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[753]`
  - **Applique l'état « Rogne » (4146)** → cible alliée ; 2 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[950]`
  - **+30 Puissance** → cible alliée ; 2 tour(s), actif 2 tour(s), déclencheur : quand la cible subit des dommages, *info-bulle uniquement (comportement réel géré côté serveur)*  `[138]`
  - **20 Dommages Poussée** → cible alliée ; 2 tour(s), actif 2 tour(s), déclencheur : quand la cible subit des dommages, *info-bulle uniquement (comportement réel géré côté serveur)*  `[414]`
  - **10 Tacle** → cible alliée ; 2 tour(s), actif 2 tour(s), déclencheur : quand la cible subit des dommages, *info-bulle uniquement (comportement réel géré côté serveur)*  `[753]`
  - **le lanceur lance le sous-sort « Rogne » (30794, niv. 1)** → cible alliée  `[1160]`
    - ↳ sous-sort 30794 « Rogne » niv.1 :
      - **+80 Puissance** → cible alliée ; 2 tour(s)  `[138]`
      - **40 Dommages Poussée** → cible alliée ; 2 tour(s)  `[414]`
      - **20 Tacle** → cible alliée ; 2 tour(s)  `[753]`
      - **Applique l'état « Rogne » (4146)** → cible alliée ; 2 tour(s)  `[950]`
      - **le lanceur lance le sous-sort « Rogne » (30794, niv. 2)** → cible alliée ; actif 2 tour(s), déclencheur : quand la cible subit des dommages  `[1160]`
        - ↳ sous-sort 30794 « Rogne » niv.2 :
          - **+30 Puissance** → lanceur ; 2 tour(s)  `[138]`
          - **20 Dommages Poussée** → lanceur ; 2 tour(s)  `[414]`
          - **10 Tacle** → lanceur ; 2 tour(s)  `[753]`
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (13745, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 13745 niv.1 : +1 Rage : 0 → Rage (513 + 515, dommages subis ×90 %) ; Rage → Raage (514, second ×90 %) ; Raage → Forme Bestiale (2 tours, §2.1).
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Buff offensif sur le tank allié (ou soi) qui renvoie des bonus à l'Ouginak quand la cible encaisse.
- *Notes moteur* : 30794 niv. 2 (déclencheur D) ; maxStack 5 (INCERTAIN : pas de limite visible dans le sous-sort).


### Paire 20 — Limier / Tétanisation

#### Limier (`13765`) — sort de base (obtenu niv. 80)

> Occasionne des dommages Air. Attire les entités vers la cible en zone avant d'appliquer les effets si c'est la Proie.  Le sort n'est pas soumis aux contraintes de lancer sous Forme Bestiale.

- Caractéristiques (g2) : **3 PA** · portée 1–3 (non modifiable) · ligne de vue requise · CC 10% · 3×/tour · 2×/cible
- Grades : g1 (niv. 80) : 3 PA, po 1–3, 23–25 Air ; g2 (niv. 147) : 3 PA, po 1–3, 28–31 Air
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–3 PO, LdV, 3/tour, 2/cible, CC 10 %
  - Si Proie : attire de 2 cases vers elle les entités en croix 3 (sans centre) avant les dommages
  - Dommages Air 28–31 (CC 34–37)
  - Accrocs ; non soumis aux contraintes de Forme Bestiale
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Limier » (13764, niv. 1)** → cible ennemie — si cible a l'état « Proie » (516)  `[1160]`
    - ↳ sous-sort 13764 « Limier » niv.1 :
      - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 3 (min 1)  `[6]`
  - **Attire la cible de 2 case(s)** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 3, *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **28 à 31 dommages Air (CC : 34 à 37)** → cible (alliée ou ennemie)  `[98]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
- **Analyse / rôle tactique** : Regroupe les alliés/ennemis autour de la Proie (pour Dépouille, Tibia, Muselière).

#### Tétanisation (`13753`) — variante (obtenu niv. 190)

> Occasionne des dommages Feu et retire des PM.  Augmente la Rage (nécessite une cible).

- Caractéristiques (g1) : **4 PA** · portée 1–4 (non modifiable) · ligne de vue requise · CC 25% · 2×/tour · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 4 PA, 1–4 PO, LdV, 2/tour, CC 25 %
  - Dommages Feu 41–46 (CC 49–55)
  - Retire 3 PM (esquivable, 1 tour, non désenvoûtable)
  - +1 Rage (nécessite une cible) ; Accrocs
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (24128, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 24128 niv.1 : pose « Cible Ouginak » (3549) sur le lanceur seulement si une entité occupe la case ciblée (condition « nécessite une cible »).
  - **41 à 46 dommages Feu (CC : 49 à 55)** → cible (alliée ou ennemie)  `[99]`
  - **le lanceur lance le sous-sort « Accrocs » (23981, niv. 1)** → cible (alliée ou ennemie)  `[1160]`
    - ↳ sous-sort 23981 niv.1 : Accrocs : chaque Roquet de l'Ouginak avance d'1 case vers la Proie puis, s'il est au contact (carré 1), lui vole 12–13 PV Neutre (30–31 sur une invocation) — §2.3.
  - **Retire 3 PM (esquivable)** → cible (alliée ou ennemie) ; 1 tour(s), non désenvoûtable  `[1080]`
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (24128, niv. 2)** → lanceur  `[792]`
    - ↳ sous-sort 24128 niv.2 : si le lanceur porte « Cible Ouginak » : +1 Rage (13745 niv. 1, §2.1), puis retire 3549.
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Meilleur sort d'entrave PM de la classe (−3 PM) avec de gros dommages.


### Paire 21 — Flair / Acharnement

#### Flair (`13749`) — sort de base (obtenu niv. 85)

> Téléporte le lanceur sur la première case disponible au contact de la Proie.  Si la Proie est dans la zone d'effet : téléporte le lanceur sur la case ciblée.  Nécessite et diminue la Rage.

- Caractéristiques (g2) : **3 PA** · portée 1–63 (non modifiable) · sans ligne de vue · CC 0% · relance 2 t. · condition : lanceur a l’état « Rage Ouginak » (515) ET lanceur n’a pas l’état « Pesanteur » (7)
- Grades : g1 (niv. 85) : 3 PA, po 1–63 ; g2 (niv. 152) : 3 PA, po 1–63
- **Résumé des effets (lecture humaine)** :
  - 3 PA, 1–63 PO, sans LdV, relance 2 ; nécessite la Rage et pas Pesanteur
  - Téléporte le lanceur sur la première case libre au contact de la Proie ; si la Proie est dans la croix 1 de la case ciblée, téléporte sur la case ciblée
  - −1 palier de Rage
- Effets décodés (données brutes DofusDB) :
  - **le lanceur lance le sous-sort « Flair » (13779, niv. 1)** → ennemis dans la zone — si cible a l'état « Proie » (516) ; zone croix sans centre taille 1  `[1160]`
    - ↳ sous-sort 13779 « Flair » niv.1 :
      - **Applique l'état « Flair » (496)** → lanceur ; 1 tour(s)  `[950]`
  - **la cible lance sur la case ciblée le sous-sort « Flair » (13779, niv. 2)** → lanceur  `[2794]`
    - ↳ sous-sort 13779 « Flair » niv.2 :
      - **Téléporte le lanceur sur la case ciblée** → cible (alliée ou ennemie) — si lanceur a l'état « Flair » (496)  `[4]`
      - **le lanceur lance le sous-sort « La Rage d'Ouginak » (13745, niv. 2)** → lanceur — si lanceur a l'état « Flair » (496)  `[1160]`
        - ↳ sous-sort 13745 niv.2 : −1 Rage : Raage → Rage (retire le second ×90 %) ; Rage → aucune (retire 513/515 et le ×90 %).
  - **le lanceur lance le sous-sort « Flair » (13779, niv. 3)** → ennemis dans la zone — si cible a l'état « Proie » (516) ; zone tout le terrain (vivants)  `[1160]`
    - ↳ sous-sort 13779 « Flair » niv.3 :
      - **Téléporte le lanceur sur la case ciblée** → tous (alliés+ennemis) dans la zone — si lanceur n'a PAS l'état « Flair » (496) ; zone croix sans centre taille 1  `[4]`
      - **le lanceur lance le sous-sort « La Rage d'Ouginak » (13745, niv. 2)** → lanceur — si lanceur n'a PAS l'état « Flair » (496)  `[1160]`
        - ↳ sous-sort 13745 niv.2 : −1 Rage : Raage → Rage (retire le second ×90 %) ; Rage → aucune (retire 513/515 et le ×90 %).
  - **Retire l'état « Flair » (496)** → lanceur  `[951]`
  - **Téléporte le lanceur sur la case ciblée** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[4]`
  - **le lanceur lance le sous-sort « - 1 Rage » (23978, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23978 niv.1 : infobulle « −1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Engagement à portée illimitée sur la Proie.
- *Notes moteur* : État 496 « Flair » ; sous-sorts 13779 niv. 1–3.

#### Acharnement (`13805`) — variante (obtenu niv. 195)

> Applique l'état Pesanteur sur l'ennemi ciblé. Si l'ennemi est la Proie : • Augmente également les dommages subis par la cible. • Téléporte les Roquets du lanceur à son contact.  Augmente la Rage (nécessite une cible).

- Caractéristiques (g1) : **2 PA** · portée 1–5 (non modifiable) · en ligne uniquement · ligne de vue requise · cible requise (case occupée) · CC 0% · relance 2 t. · cumul max 1
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 1–5 PO en ligne, LdV, case occupée, relance 2
  - Ennemi : Pesanteur (1 tour)
  - Si Proie : dommages subis ×115 % (1 tour) et Roquets téléportés à son contact
  - +1 Rage
- Effets décodés (données brutes DofusDB) :
  - **Applique l'état « Pesanteur » (7)** → cible ennemie ; 1 tour(s)  `[950]`
  - **Dommages subis x115%** → cible ennemie — si cible a l'état « Proie » (516) ; actif 1 tour(s), déclencheur : quand la cible subit des dommages  `[1163]`
  - **le lanceur lance le sous-sort « Acharnement » (25712, niv. 1)** → cible ennemie — si cible a l'état « Proie » (516)  `[1160]`
    - ↳ sous-sort 25712 « Acharnement » niv.1 :
      - **la cible lance (sur elle-même) le sous-sort « Acharnement » (25712, niv. 2)** → alliés (dont lanceur si dans la zone), invocations du lanceur — si cible est le monstre « Roquet » (5865) ; zone cercle illimitée (63) (min 2)  `[792]`
        - ↳ sous-sort 25712 « Acharnement » niv.2 :
          - **le lanceur lance le sous-sort « Acharnement » (25712, niv. 3)** → ennemis dans la zone — si cible a l'état « Proie » (516) ; zone tout le terrain (vivants)  `[1160]`
            - ↳ sous-sort 25712 « Acharnement » niv.3 :
              - **Téléporte le lanceur sur la case ciblée** → tous (alliés+ennemis) dans la zone ; zone croix sans centre taille 1  `[4]`
  - **la cible lance (sur elle-même) le sous-sort « La Rage d'Ouginak » (13745, niv. 1)** → lanceur  `[792]`
    - ↳ sous-sort 13745 niv.1 : +1 Rage : 0 → Rage (513 + 515, dommages subis ×90 %) ; Rage → Raage (514, second ×90 %) ; Raage → Forme Bestiale (2 tours, §2.1).
  - **Téléporte le lanceur sur la case ciblée** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[4]`
  - **le lanceur lance le sous-sort « +1 Rage » (23977, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 23977 niv.1 : infobulle « +1 Rage » (aucun effet de jeu).
- **Analyse / rôle tactique** : Amplification de groupe (+15 %) sur la Proie + empêche ses téléportations/échanges.
- *Notes moteur* : 1163 ×115 % déclencheur D, 1 tour ; 25712.


### Paire 22 — Appel de la Meute / Nouvelle Lune

#### Appel de la Meute (`14357`) — sort de base (obtenu niv. 90)

> Réduit le temps de relance du sort Lance-roquet du lanceur. • Si la cible est le lanceur : attire tous les alliés vers la cible. • Si la cible est la Proie : érode la cible et attire tous les alliés vers elle. L'attirance est plus importante si la cible est la Proie.

- Caractéristiques (g2) : **2 PA** · portée 0–6 (non modifiable) · ligne de vue requise · CC 0% · relance 2 t. · cumul max 1
- Grades : g1 (niv. 90) : 2 PA, po 0–5 ; g2 (niv. 157) : 2 PA, po 0–6
- **Résumé des effets (lecture humaine)** :
  - 2 PA, 0–6 PO, LdV, relance 2
  - Lance-roquet : −1 tour de relance
  - Sur soi : attire tous les alliés de 2 cases vers le lanceur
  - Sur la Proie : 10 % d'érosion (1 tour) et attire tous les alliés de 4 cases vers elle
- Effets décodés (données brutes DofusDB) :
  - **Lance-roquet : -1  de relance** → lanceur  `[1036]`
  - **le lanceur lance le sous-sort « Appel de la Meute » (14358, niv. 1)** → lanceur (s’il est dans la zone)  `[1160]`
    - ↳ sous-sort 14358 « Appel de la Meute » niv.1 :
      - **Attire la cible de 2 case(s)** → alliés dans la zone ; zone cercle illimitée (63) (min 1)  `[6]`
  - **le lanceur lance le sous-sort « Appel de la Meute » (14358, niv. 2)** → cible ennemie — si cible a l'état « Proie » (516)  `[1160]`
    - ↳ sous-sort 14358 « Appel de la Meute » niv.2 :
      - **10% Érosion** → cible ennemie — si cible a l'état « Proie » (516) ; 1 tour(s)  `[776]`
      - **Attire la cible de 4 case(s)** → alliés dans la zone ; zone cercle illimitée (63) (min 1)  `[6]`
  - **Attire la cible de 2 case(s)** → alliés dans la zone ; zone cercle illimitée (63), *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
  - **10% Érosion** → cible ennemie ; 1 tour(s), *info-bulle uniquement (comportement réel géré côté serveur)*  `[776]`
  - **Attire la cible de 4 case(s)** → alliés dans la zone ; zone cercle illimitée (63), *info-bulle uniquement (comportement réel géré côté serveur)*  `[6]`
- **Analyse / rôle tactique** : Rassemble le groupe (autour de soi ou au contact de la Proie) — peut aussi désorganiser les alliés : l'IA doit évaluer chaque allié.
- *Notes moteur* : Attirances en cercle 63 (min 1) sur les alliés.

#### Nouvelle Lune (`14321`) — variante (obtenu niv. 200)

> Réduit la durée des effets sur le lanceur et le transforme en Bête.  Ne peut pas être utilisé sous Forme Bestiale.

- Caractéristiques (g1) : **2 PA** · portée 0–0 (non modifiable) · sans ligne de vue · CC 0% · relance 3 t. · condition : lanceur n’a pas l’état « Forme Bestiale » (517)
- **Résumé des effets (lecture humaine)** :
  - 2 PA, sur soi, relance 3 ; interdit en Forme Bestiale
  - Durée des effets −2 sur le lanceur (désenvoûtement partiel)
  - Passe immédiatement en Forme Bestiale (2 tours) et remet la Rage à 0
- Effets décodés (données brutes DofusDB) :
  - **Durée des effets : -2** → lanceur  `[1075]`
  - **le lanceur lance le sous-sort « La Rage d'Ouginak » (13745, niv. 3)** → lanceur  `[1160]`
    - ↳ sous-sort 13745 niv.3 : Forme Bestiale immédiate (13746 + fin différée 13747) et retrait de tous les états/effets de Rage.
  - **le lanceur lance le sous-sort « Applique la Forme Bestiale » (25713, niv. 1)** → cible (alliée ou ennemie) ; *info-bulle uniquement (comportement réel géré côté serveur)*  `[1160]`
    - ↳ sous-sort 25713 niv.1 : infobulle (aucun effet de jeu).
- **Analyse / rôle tactique** : Forme Bestiale à la demande (+2 PM, +20 % dommages finaux) et purge des malus (érosion, retraits).
- *Notes moteur* : 13745 niv. 3.


## 4. Rôles en groupe PvM 4 joueurs (niveau 200)

| Rôle | Pertinence | Éléments | Sorts clés |
|---|---|---|---|
| **DPS mêlée** | ★★★★ | Terre-Feu, Eau-Air, ou mono | Muselière, Dépouille, Tétanisation, Humérus, Chasse, Tibia, Dépeçage |
| **Tank / bruiser** | ★★★ | - | Rage (×0,81), Molosse, Cerbère, Pelage Protecteur, Proie (auto-soin) |
| **Entrave PM / anti-fuite** | ★★★ | - | Tétanisation, Rabattage, Panique, Dogue, Calcanéus |
| **Soutien** | ★★ | - | Proie, Gibier, Acharnement, Battue, Aboiement, Poursuite, Apaisement |
| Placement | ★ | - | Convergence, Pistage, Radius, Panique, Appel de la Meute |
| Soin | ★ | - | Apaisement 15 %, Proie (indirect) |

**Placement type** : au contact du boss/de la Proie, entouré si possible (Muselière), le Roquet de l'autre côté de la cible ;
ne jamais rester à plus de 4 cases (aucun sort offensif au-delà, sauf Os à Moelle 8 PO, Cubitus 10, Calcanéus 12, Carcasse 8).

## 5. Choix des variantes (« spell sets »)

Voir `variantChoices` (deux sets complets : Terre-Feu bruiser, Eau-Air). Arbitrages notables :
Proie (soin 25 %) > Gibier (+7 %) sauf groupe avec un soigneur fort ; Lance-roquet > Gangrène en PvM ; Cerbère > Amarok
pour un Terre ; Pelage Protecteur > Férocité ; Tétanisation (−3 PM) > Limier ; Acharnement (×115 %) > Flair sauf besoin
d'engagement ; Appel de la Meute > Nouvelle Lune sauf build axé Forme Bestiale.

## 6. Rotations types (12 PA / 6 PM)

Principe : planifier la Rage pour que la **Forme Bestiale tombe au début d'un tour offensif**
(elle couvre ce tour et le suivant) et rester en **Raage** pendant les tours ennemis (×0,81). Arcanin (−1 Rage, +100
Puissance) permet de « stocker » le palier.

### Rotations détaillées

**Tour 1 (installation, 12 PA)**

1. Proie (1 PA) sur le boss
2. Lance-roquet (3 PA) au contact du boss
3. Molosse (3 PA) : Rage I + ×0,9 (1 t.)
4. Charogne (3 PA) : 10 % d'érosion, Raage
5. Cubitus (2 PA) : +1 PM sur la Proie

> Termine en Raage (×0,81 dommages subis, ×0,729 avec Molosse) pendant le tour ennemi. Seuls certains sorts montent la Rage (Molosse, Charogne, Dépeçage, Radius, Mâchoire, Gangrène, Tétanisation, Tibia, Humérus, Rogne, Acharnement) ; Rabattage, Cubitus, Muselière, Dépouille, Chasse, Os à Moelle n'y touchent pas : l'IA les utilise pour frapper sans déclencher la Forme Bestiale trop tôt.


**Tour 2 (Forme Bestiale, 12 PA, 8 PM)**

1. Tétanisation (4 PA) : −3 PM, 3e palier ⇒ Forme Bestiale (+2 PM, +20 % dommages finaux)
2. Muselière (5 PA) : +22 par ennemi adjacent
3. Os à Moelle / Cubitus (2–3 PA) selon les PA restants

> La Forme Bestiale dure aussi tout le tour 3 : y placer les plus gros sorts (Dépouille, Humérus, Chasse). En Forme Bestiale : Pelage Protecteur, Férocité, Arcanin, Caninos, Flair, Nouvelle Lune indisponibles.


**Tour défensif (12 PA)**

1. Pelage Protecteur (3 PA) sur un allié ciblé
2. Cerbère (4 PA) : bouclier 300 + dégâts
3. Molosse (3 PA)
4. Arcanin (1 PA) pour rester en Rage I (+100 Puissance) + Proie (1 PA)

> Arcanin redescend d'un palier : à utiliser pour éviter d'entrer en Forme Bestiale (et perdre les ×0,9) au mauvais moment.


## 7. Forces et faiblesses

**Forces**

- Très gros dégâts mono-cible à courte portée, dans les 4 éléments.
- Excellente survie : ×0,81 dommages subis en Raage, boucliers, vols de vie, soin de 25 % via Proie.
- Soutien de groupe simple et puissant (Proie, Gibier, Battue, Aboiement, Poursuite).
- Entrave PM et anti-fuite (Tétanisation, Rabattage, Panique, Dogue) ; Roquet comme bloqueur.
- Complexité officielle faible (2/5) : IA plus simple que l'Huppermage.

**Faiblesses**

- Portée courte (1–4) et encore réduite en Forme Bestiale (2) ; vulnérable au kite/au retrait de PM.
- La Forme Bestiale supprime les réductions de Rage : fenêtre de vulnérabilité de 2 tours.
- Dépend de la Proie (une seule cible) : moins efficace contre des vagues nombreuses.
- Peu de dégâts de zone à distance (Mâchoire, Battue).

## 8. Synergies avec les autres classes

| Avec | Pourquoi |
|---|---|
| Tout DPS du groupe | Proie : chaque allié qui frappe la cible se soigne de 25 % de ses dommages (soin de groupe gratuit) ; Gibier/Acharnement amplifient (×107 %, ×115 %). |
| Eniripsa / Féca / Forgelance | L'Ouginak encaisse à la place des fragiles ; un soigneur/protecteur prolonge sa ligne de front (il n'a pas de soin de groupe fort). |
| Pandawa / Forgelance / Huppermage (placement) | Regrouper les ennemis au contact de l'Ouginak démultiplie Muselière (+22 par ennemi adjacent), Tibia et Amarok ; Aboi (−60 rés. poussée) prépare les dommages de poussée alliés. |
| Sram / Iop (mêlée) | Dépouille (+20 base par allié au contact de la Proie) et Battue/Rogne (+150/+80 Puissance) récompensent une mêlée groupée. |
| Enutrof / Xélor / Huppermage (entrave) | Retraits PM/PA complémentaires ; l'Ouginak empêche la fuite (tacle, −Fuite). |

## 9. Questions ouvertes (INCERTAIN)

- Proie : les alliés de la Proie (monstres) qui la frapperaient seraient-ils aussi soignés ? (masque de l'effet 786 = A sur la Proie, l'attaquant quelconque — probablement oui).
- Rogne : cumul réel du bonus réactif (description « cumulable 5 fois », aucune limite visible dans 30794).
- PV exacts du Roquet (bonusCharacteristics 90 % ?) et mise à l'échelle des caractéristiques (characRatios).
- Ordre exact entre la fin de la Forme Bestiale (déclencheur fin de tour) et les autres effets de fin de tour.

## 10. Sources

- DofusDB (fichiers du jeu) : https://api.dofusdb.fr/breeds/18, https://api.dofusdb.fr/spell-variants?breedId=18,
  https://api.dofusdb.fr/spells, https://api.dofusdb.fr/spell-levels, https://api.dofusdb.fr/spell-states,
  https://api.dofusdb.fr/monsters/5865, https://api.dofusdb.fr/spell-types (622, 2001, 2412, 2568, 2570, 2577),
  https://api.dofusdb.fr/version (3.6.12.16).
- Refonte 2.68 (portées en Forme Bestiale, contrôle de la Rage) : https://www.gamosaurus.com/?p=179126
- Présentation des mécaniques Rage/Proie : https://www.millenium.org/guide/281167.html , https://dofus.jeuxonline.info/article/14181

