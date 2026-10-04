# Osamodas (classe 2) — analyse complète pour le simulateur

> Données : API DofusDB (`/breeds/2`, `/spell-variants?breedId=2`, `/spells`, `/spell-levels`, `/spell-states`, `/monsters`),
> fichiers du jeu Dofus 3 mis à jour le 2026-06-23, extraits le 2026-10-04 — version **post-refonte Osamodas 3.1
> (« Osavora », juillet 2025)**. Valeurs = grade le plus élevé utilisable au niveau 200. Fichier machine :
> [`data/research/class-mechanics/osamodas.json`](../../../data/research/class-mechanics/osamodas.json).

**Identité** : « Invocateur de créatures » (complexité 4/4). Rôles officiels (`breedRoles`, /12) : Invocation 12
(« invoque des créatures pour combattre à ses côtés »), Boost 6 (« augmente PA, PM et Puissance de ses alliés »),
Soin 5 (« soigne ses alliés et augmente les soins reçus »), puis dommages 4, placement 4, entrave 3, protection 3, tank 2.

**Résumé tactique** : depuis la refonte 3.1, l'Osamodas dispose d'une **jauge de points d'invocation (PI)** : chaque
créature coûte 1, 2 ou 3 PI (Tofu/Bouftou/Crapipou/Dragoune = 1 ; Ventritofu/Bouflourd/Crapipaud/Dragonnet = 2 ;
Craquolosse/Scarafoudre/Crocoléreux/Sulfénix = 3 ; Gobgob Glouton 1, Gobgob Facétieux 3). Les créatures héritent d'un
pourcentage des caractéristiques de l'Osamodas (50 % / 75 % / 100 % selon leur coût). Chaque voie élémentaire (Air =
Tofus/Scarafoudre, Terre = Bouftous/Craquolosse, Eau = Crapauds/Crocoléreux, Feu = Dragounes/Sulfénix) a ses créatures,
ses sorts « vol de vie / soin + buff » et des sorts de fouet (meilleur élément) qui placent et boostent les invocations.

## Sommaire

- Tableau des 22 paires · Efficacité brute · Mécaniques spécifiques · Détail de tous les sorts · Invocations · Rôle en groupe PvM (variantes, rotations, synergies) · Points incertains · Sources

## Tableau des 22 paires de sorts (variantes)

Chaque ligne est une paire de variantes : à un instant donné, un personnage n'équipe qu'**un seul** sort de chaque paire (choix hors combat). Le niveau indiqué est celui du déblocage du grade 1.

| # | Variante A | PA | Variante B | PA | Notes |
|---|---|---|---|---|---|
| 1 | Cri du Corbac (31110, niv. 1) | 2 | Crocs du Mulou (31113, niv. 95) | 4 | Cri du Corbac (2 PA, vol/soin Air + 1 PM à l'allié et au lanceur) en soutien ; Crocs du Mulou (4 PA, croix, +5 % dommages mêlée) en voie Terre offensive. |
| 2 | Pics du Prespic (31111, niv. 1) | 2 | Déplumage (31137, niv. 100) | 4 | Pics du Prespic (+10 % CC) en soutien ; Déplumage (−60 rés. poussée) avec un groupe de placeurs. |
| 3 | Dents du Piranya (31135, niv. 1) | 3 | Cœur Sauvage (31140, niv. 105) | 4 | Dents du Piranya : soin/vol de zone + 20 Dommages, cœur du soutien Eau ; Cœur Sauvage (+15 % soins reçus) si un Eniripsa soigne. |
| 4 | Cri de l'Ours (31132, niv. 1) | 3 | Bave du Crapaud (31139, niv. 110) | 4 | Cri de l'Ours (+150 Puissance au contact) pour booster ; Bave du Crapaud (−40 Dommages en carré) contre un paquet de frappeurs. |
| 5 | Fouet (31114, niv. 5) | 2 | Cravache (31136, niv. 115) | 2 | Fouet (relance les créatures +1 PM, repousse) ; Cravache pour regrouper. |
| 6 | Tofu (31115, niv. 10) | 3 | Griffes du Chtigre (31134, niv. 120) | 3 | Tofu (1 PI, 8 PM, mobile) presque toujours ; Griffes du Chtigre (×75 % soins reçus) contre des monstres qui se soignent. |
| 7 | Bouftou (31116, niv. 15) | 3 | Serres du Vautour (31133, niv. 125) | 3 | Bouftou (1 PI, tacle) ; Serres du Vautour si le groupe a besoin de soin sur attaque. |
| 8 | Crapipou (31117, niv. 20) | 3 | Toison d'Or (31138, niv. 130) | 3 | Toison d'Or (bouclier 300 PV en cercle 2 + dégâts) en soutien ; Crapipou pour la voie Eau invocatrice. |
| 9 | Dragoune (31118, niv. 25) | 3 | Morsure du Serpent (31112, niv. 135) | 3 | Dragoune en voie Feu ; Morsure du Serpent (×104 % dommages subis + poison) pour un focus boss. |
| 10 | Cortège Sauvage (31119, niv. 30) | 2 | Pacte Bestial (31141, niv. 140) | 2 | Cortège Sauvage pour l'armée/burst ; Pacte Bestial pour un Osamodas DPS. |
| 11 | Piqûre Motivante (31120, niv. 35) | 2 | Communion Animale (31142, niv. 145) | 3 | Piqûre Motivante (+1 PA +1 PM 3 tours, +2/+2 sur invocation) est indispensable ; Communion Animale partage les dommages avec les créatures. |
| 12 | Saute-granouille (31121, niv. 40) | 3 | Tornade de Plumes (31143, niv. 150) | 4 | Saute-granouille (téléportation symétrique) ; Tornade de Plumes (téléportation + repousse de zone). |
| 13 | Souffle Draconique (31122, niv. 45) | 3 | Frappe du Craqueleur (31144, niv. 155) | 4 | Frappe du Craqueleur (cercle 3 + attire) regroupe les ennemis ; Souffle Draconique pour se dégager. |
| 14 | Charge Bestiale (31123, niv. 50) | 3 | Chant du Phénix (31145, niv. 160) | 4 | Chant du Phénix (soin + dommages en cercle 2) en soutien ; Charge Bestiale pour la mobilité Terre. |
| 15 | Aéropique (31124, niv. 55) | 3 | Tourbillon (31146, niv. 165) | 4 | Tourbillon (repositionne les alliés) ; Aéropique pour la mobilité Air. |
| 16 | Discipline (31125, niv. 60) | 2 | Martinet (31147, niv. 170) | 3 | Martinet (toutes les créatures attaquent) ; Discipline (−2 PM, attire 4) en entrave. |
| 17 | Laisse Spirituelle (31152, niv. 65) | 2 | Relais Spirituel (31130, niv. 175) | 2 | Laisse Spirituelle (placement unique) ; Relais Spirituel pour l'armée. |
| 18 | Ventritofu (31126, niv. 70) | 4 | Craquolosse (31149, niv. 180) | 5 | Craquolosse (3 PI, tank Terre −3 PM, +8 % rés.) ; Ventritofu (2 PI) mobile. |
| 19 | Bouflourd (31127, niv. 75) | 4 | Crocoléreux (31150, niv. 185) | 5 | Crocoléreux (3 PI : armure, −CC, ×80 % soins reçus) ; Bouflourd (2 PI, ×90 % dommages subis en zone). |
| 20 | Crapipaud (31128, niv. 80) | 4 | Sulfénix (31151, niv. 190) | 5 | Sulfénix (3 PI, soin et téléportation) ; Crapipaud (2 PI, poisons Eau). |
| 21 | Dragonnet (31129, niv. 85) | 4 | Scarafoudre (31148, niv. 195) | 5 | Scarafoudre (3 PI, boucliers) ; Dragonnet (2 PI, +125 Puissance aux alliés). |
| 22 | Esprit Glouton (31131, niv. 90) | 3 | Esprit Facétieux (31153, niv. 200) | 3 | Gobgob Glouton (interception, dommages selon PV) ; Gobgob Facétieux (copie de créature, désenvoûtement −1 tour). |

## Efficacité brute des sorts de dommages (grade niveau 200, avant caractéristiques)

Moyenne des dommages de base de la première ligne de dommages directs divisée par le coût en PA (indicatif ; ne tient compte ni des zones, ni des effets secondaires, ni des sous-sorts). `+` = portée modifiable. Lancers/tour `∞` = pas de limite autre que les PA/relance.

| Sort | Paire | Élément | PA | Base | Base CC | Moy./PA | PO | Lancers/tour | Relance | Zone |
|---|---|---|---|---|---|---|---|---|---|---|
| Crocs du Mulou | 1B | Terre | 4 | 39–43 | 45–50 | 10.2 | 0–5 | 1 | 0 | croix de taille 1 |
| Cœur Sauvage | 3B | Feu | 4 | 39–43 | 45–50 | 10.2 | 0–7 | 1 | 0 | croix diagonale de taille 1 |
| Discipline | 16A | meilleur élément | 2 | 19–22 | 23–26 | 10.2 | 1–5 | 2 | 0 | case ciblée |
| Déplumage | 2B | Air | 4 | 37–40 | 41–45 | 9.6 | 0–6+ | 1 | 0 | croix de taille 1 |
| Bave du Crapaud | 4B | Eau | 4 | 37–40 | 42–46 | 9.6 | 0–4 | 1 | 0 | carré de taille 1 |
| Saute-granouille | 12A | Eau | 3 | 26–30 | 31–35 | 9.3 | 1–2 | 2 | 0 | case ciblée |
| Griffes du Chtigre | 6B | Feu | 3 | 26–29 | 31–35 | 9.2 | 1–5 | 2 | 0 | case ciblée |
| Charge Bestiale | 14A | Terre | 3 | 26–29 | 31–35 | 9.2 | 1–5 | 2 | 0 | case ciblée |
| Tornade de Plumes | 12B | Air | 4 | 34–38 | 41–46 | 9.0 | 1–3 | 1 | 0 | cercle de taille 2 (à partir de 1) |
| Toison d'Or | 8B | Terre | 3 | 24–27 | 29–32 | 8.5 | 0–0 | 2 | 0 | cercle de taille 2 (à partir de 1) |
| Aéropique | 15A | Air | 3 | 24–27 | 29–32 | 8.5 | 1–5 | 2 | 0 | case ciblée |
| Frappe du Craqueleur | 13B | Terre | 4 | 31–35 | 37–42 | 8.2 | 1–3 | 2 | 0 | cercle de taille 3 |
| Tourbillon | 15B | Eau | 4 | 31–35 | 37–42 | 8.2 | 0–3 | 2 | 0 | cercle de taille 2 |
| Cri de l'Ours | 4A | Terre | 3 | 23–26 | 28–31 | 8.2 | 0–1 | 2 | 0 | carré de taille 1 |
| Souffle Draconique | 13A | Feu | 3 | 23–26 | 28–31 | 8.2 | 1–7 | 2 | 0 | cône de taille 1 |
| Fouet | 5A | meilleur élément | 2 | 15–17 | 18–21 | 8.0 | 1–5 | 3 | 0 | case ciblée |
| Chant du Phénix | 14B | Feu | 4 | 30–34 | 36–41 | 8.0 | 0–5 | 1 | 0 | cercle de taille 2 |
| Serres du Vautour | 7B | Air | 3 | 22–25 | 26–30 | 7.8 | 1–7+ | 2 | 0 | fourche de taille 1 |
| Pics du Prespic | 2A | Feu | 2 | 14–17 | 19–22 | 7.8 | 0–5+ | 3 | 0 | case ciblée |
| Martinet | 16B | meilleur élément | 3 | 21–24 | 25–29 | 7.5 | 0–5 | 1 | 2 | case ciblée |
| Cri du Corbac | 1A | Air | 2 | 13–16 | 18–21 | 7.2 | 0–7+ | 3 | 0 | case ciblée |
| Dents du Piranya | 3A | Eau | 3 | 19–22 | 24–28 | 6.8 | 0–5 | 2 | 0 | croix de taille 1 |
| Morsure du Serpent | 9B | Eau | 3 | 19–21 | 22–24 | 6.7 | 1–5 | 2 | 0 | case ciblée (poison début de tour ×2) |
| Cravache | 5B | meilleur élément | 2 | 11–13 | 14–16 | 6.0 | 1–5 | 2 | 0 | croix de taille 1 |

Vérification croisée avec les gabarits de dégâts de DoMath (`.cache/domath/spell-templates.json`) : **13 sorts identiques**, 10 écart(s), 0 absent(s) de DoMath.
Écarts (les données DofusDB 2026 font foi ; DoMath semble ne pas être à jour sur ces sorts) :
- Cri du Corbac (DofusDB 13–16 / CC 18–21 ; DoMath « Cri du Corbac » 23–26 / CC 28–31)
- Crocs du Mulou (DofusDB 39–43 / CC 45–50 ; DoMath « Crocs du Mulou » 29–31 / CC 35–37)
- Pics du Prespic (DofusDB 14–17 / CC 19–22 ; DoMath « Pics du Prespic » 24–27 / CC 29–32)
- Déplumage (DofusDB 37–40 / CC 41–45 ; DoMath « Déplumage » 26–29 / CC 31–35)
- Dents du Piranya (DofusDB 19–22 / CC 24–28 ; DoMath « Dents du Piranya » 25–28 / CC 30–34)
- Cœur Sauvage (DofusDB 39–43 / CC 45–50 ; DoMath « Cœur Sauvage » 29–33 / CC 35–40)
- Bave du Crapaud (DofusDB 37–40 / CC 42–46 ; DoMath « Marécage » 27–30 / CC 32–36)
- Fouet (DofusDB 15–17 / CC 18–21 ; DoMath « Fouet » 17–19 / CC 20–23)
- Cravache (DofusDB 11–13 / CC 14–16 ; DoMath « Cravache » 13–15 / CC 16–18)
- Tornade de Plumes (DofusDB 34–38 / CC 41–46 ; DoMath « Tornade de Plumes » 30–34 / CC 41–46)

## Mécaniques spécifiques à implémenter

### 1. Points d'invocation (PI) et coût des créatures
- La caractéristique « Invocations » (stat 26, effet 182) compte désormais des **points** : chaque monstre a un champ
  `summonCost` (1, 2 ou 3) et `useSummonSlot = true`. Une invocation n'est possible que si `PI utilisés + coût ≤ PI max`.
- PI max : limité à **6 via équipement/forgemagie** (source breakflip, refonte 3.1) ; augmentable en combat :
  Cortège Sauvage +3 PI (2 tours), Gobmutation +1/+2/+3 PI pendant 1 tour (le temps de recréer la créature copiée).
  Valeur de base d'un personnage : 1 (règle générale Dofus ; INCERTAIN pour l'Osamodas 3.1).
- Relances : créatures à 1 PI = 3 PA, relance 1 ; à 2 PI = 4 PA, relance 2 ; à 3 PI = 5 PA, relance 3 ; Gobgobs = 3 PA,
  relance fixée à 2 tours **à la mort** du Gobgob (une seule instance tant qu'il vit : critère `HS!6323` / `HS!6322`).
- Toutes les créatures se posent au contact ou à 2 cases (PO 1–2), sur une case libre, avec ligne de vue.

### 2. Caractéristiques héritées
- `bonusCharacteristics` des monstres 8070–8083 = **pourcentage des caractéristiques de l'invocateur** : 50 % (créatures
  à 1 PI), 75 % (2 PI, Gobgob Glouton/Facétieux), 100 % (3 PI). Caractéristiques concernées : PV, Sagesse, la
  caractéristique de l'élément (Agilité pour Tofus/Scarafoudre, Force pour Bouftous/Craquolosse, Chance pour Crapauds/
  Crocoléreux, Intelligence pour Dragounes/Sulfénix), Fuite ou Tacle, et les Dommages fixes de l'élément.
  Source : breakflip (« 1 PI : 50 % des stats du joueur, 2 PI : 75 %, 3 PI : 100 % ») — cohérent avec les données.
  Les résistances, PA (4) et PM (2 à 8) viennent du grade du monstre (voir tableau des invocations).
- Implémentation proposée : `stat_invoc = floor(stat_invocateur × pct / 100)` pour chaque clé de `bonusCharacteristics`
  (lifePoints → PV max ; bonusXDamage → dommages fixes élémentaires). Puissance, critique, dommages génériques : non
  hérités (INCERTAIN).

### 3. Contrôle des invocations
- Créatures « **maîtrisables** » (Tofu…Sulfénix) : jouées par l'IA par défaut, contrôlables par le joueur avec le sort
  commun « Maîtrise des Invocations » (depuis 2.58). Pour le simulateur : l'IA de groupe les contrôle directement.
- Gobgobs « **contrôlables** » : toujours joués par le joueur.
- Les invocations jouent **juste après leur invocateur** dans la timeline (règle générale), à partir du tour suivant leur apparition
  si elles sont invoquées pendant le tour de l'Osamodas (règle générale Dofus ; à confirmer par le moteur).
- Tofu, Ventritofu et Gobgob Facétieux portent en permanence **Intacleur** (95, ne tacle pas) et **Intaclable** (96).

### 4. Sorts « vol de vie / soin + buff » (paires 1 à 4, variantes A)
Cri du Corbac (Air, +1 PM), Pics du Prespic (Feu, +10 % CC), Dents du Piranya (Eau, zone croix, +20 Dommages),
Cri de l'Ours (Terre, carré au contact, +150 Puissance) : sur un **ennemi** → vol de vie de l'élément ; sur un **allié**
→ soin du même montant (l'Osamodas ne peut pas se soigner lui-même avec, masque `g`) ; le **buff** (2 tours) s'applique au
lanceur **et** à l'allié ciblé (ou aux alliés de la zone). Ce sont les sorts de soutien principaux de l'Osamodas soigneur.

### 5. Sorts de fouet (meilleur élément)
Fouet, Cravache, Discipline, Martinet infligent des dommages dans le **meilleur élément** du lanceur : élément dont la
caractéristique principale est la plus élevée (Force pour Terre et Neutre, Intelligence Feu, Chance Eau, Agilité Air ;
égalité départagée par les dommages fixes ; Terre par défaut) — implémentation DoMath `GetBestElement`.
- **Fouet** : repousse 2 la cible ; +1 PM (1 tour) si c'est une invocation alliée (relancer une créature vers l'ennemi).
- **Cravache** : attire en croix vers la case ciblée ; si la case centrale est occupée, téléporte symétriquement les cibles.
- **Discipline** : −2 PM esquivables + attire 4.
- **Martinet** : attire de 2 toutes les invocations du lanceur vers la cible, puis **chaque créature Osamodas à portée et
  en ligne de vue de la cible lance automatiquement son attaque** (Bisou Béco, Saute-bouftou, Croassement, Dracorage,
  Ventripoussée, Charge du Bouflourd, Crapobatie, Souffle du Dragon, Scarafusée, Fronde Rocheuse, Crocs Coléreux,
  Sulfuria) avec **−50 % dommages et soins finaux** pendant l'exécution. Relance 2 ; énorme burst gratuit en PA.

### 6. Cortège Sauvage et Pacte Bestial (paire 10)
- **Cortège Sauvage** (2 PA, relance 5, relance initiale 1) : +3 PI pendant 2 tours et −1 PA sur tous les sorts
  d'invocation Osamodas (créatures 1 PI à 2 PA, 3 PI à 4 PA…) ; en contrepartie **toutes les créatures Osamodas meurent au
  début des deux tours suivants** de l'Osamodas (sous-sort 32555 g1 avec délais 1 et 2). Usage : tour de burst où l'on
  invoque 4–6 créatures qui jouent une fois (Martinet/attaques), puis disparaissent.
- **Pacte Bestial** (2 PA, relance 2) : état Bestial 3 tours, +2 PA ; **sacrifie toutes les créatures Osamodas présentes
  et futures** (pas les Gobgobs) ; chaque sacrifice donne +3/+6/+9 % dommages et soins finaux (selon coût 1/2/3 PI) et
  transfère 30 % des PV de la créature à l'Osamodas. La durée est prolongée à chaque invocation Osamodas (déclencheur
  `CI` = « le porteur invoque ») ; à la fin, les relances des sorts d'invocation sont remises à 0. Transforme l'Osamodas
  en DPS autonome : invoquer = s'auto-buffer.

### 7. Laisse Spirituelle et Relais Spirituel (paire 17)
- **Laisse Spirituelle** : la cible (allié ou ennemi) « suit » l'Osamodas (effet 2184) immédiatement puis à chaque fois
  qu'il dépense des PM (déclencheur `CMPARR`), pour le tour en cours ; sur lui-même : toutes ses invocations le suivent.
  L'état est retiré si le lanceur ou la cible est déplacé (poussée, téléportation, portail, porté). Outil de placement
  unique : traîner un ennemi dans un piège/glyphe ou ramener ses créatures.
- **Relais Spirituel** : échange de position avec une de ses invocations et la marque « Relais » ; les prochains lancers
  échangent l'invocation relais et la suivante ciblée (si toutes deux à ≤ 5 cases du lanceur).

### 8. Gobgobs (paire 22)
- **Gobgob Glouton** (1 PI, contrôlable) : Gobgobage = dommages Neutre égaux à 25 % de ses PV actuels (s'il a ≥ 50 % PV)
  ou 25 % de ses PV manquants (s'il a < 50 %) ; sur une **créature Osamodas alliée**, la tue pour gagner +50 % Vitalité
  et −1 PM (permanent, cumulable 4 fois). Gobédience : intercepte les dommages d'un allié (1 tour) ou d'une invocation
  (2 tours). Goberration : crée des illusions et termine son tour (monstre 3 dans les données — INCERTAIN).
- **Gobgob Facétieux** (3 PI) : Gobstitution (échange), Gobjection (réduit de 1 la durée des effets d'une cible —
  désenvoûtement partiel), Gobmutation (se sacrifie pour **copier** une créature Osamodas alliée : la créature recrée une
  copie d'elle-même à la place du Gobgob, avec +1/2/3 PI temporaires).

### 9. Autres points moteur
- `Téléportation symétrique` (1104/1105/1106) : par rapport à la cible, au lanceur ou au point d'impact.
- Saute-granouille, Tornade de Plumes, Bécompresseur, Crapobatie, Scarafusée, Danse Flammes, Gobstitution sont interdits
  sous Pesanteur (`HS!7`).
- Les créatures « poison » (Crapoison, Crapogive, Morsure du Serpent) utilisent des buffs à déclenchement `TB`/`TE`
  (début/fin de tour de la cible) de durée `effectTriggerDuration`.
- Bouclier (effet 1020) : Toison d'Or = 150 % du niveau du lanceur (300 PV de bouclier au niv. 200, 1 tour) ;
  Scarapace = 100 % du niveau (200, 2 tours).

## Détail de tous les sorts (grade utilisable au niveau 200)

Légende : « Effets (infobulle) » = ce que le joueur lit en jeu (valeurs de base, `CC` = coup critique). « Mécanique réelle » = effets réellement exécutés (`forClientOnly = false`), avec les sous-sorts cachés développés une seule fois par document. Les effets d'infobulle marqués côté données `forClientOnly = true` **ne doivent pas être exécutés** par le moteur : ils ne servent qu'à l'affichage, la logique passe par les sous-sorts.

### Paire 1 : Cri du Corbac / Crocs du Mulou

> Choix : Cri du Corbac (2 PA, vol/soin Air + 1 PM à l'allié et au lanceur) en soutien ; Crocs du Mulou (4 PA, croix, +5 % dommages mêlée) en voie Terre offensive.

#### 1A. Cri du Corbac (id 31110)

- **2 PA** · PO 0–7 (modifiable) · LdV requise · 3/tour, 2/cible · CC 5 % · élément(s) : Air
- Grades : g1 niv.1 dmg 8–10 PO0-5 ; g2 niv.66 dmg 11–13 PO0-6 ; g3 niv.132 dmg 13–16 (grade utilisé : 3).
- Description du jeu : « Vole de la vie aux ennemis ou soigne les alliés dans l'élément Air. Augmente également les PM du lanceur et de l'allié ciblé. Les soins n'affectent pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 13 à 16 vol Air (CC : 18 à 21 vol Air) — cibles : ennemis
  - 13 à 16 soins Air (CC : 18 à 21 soins Air) — cibles : alliés (hors lanceur)
  - 1 PM — cibles : alliés (hors lanceur), lanceur ; 2 tour(s)
- **Rôle tactique** : 2 PA, 0–7 PO : vole 13–16 Air à un ennemi ou soigne d'autant un allié (pas le lanceur), et donne +1 PM 2 tours au lanceur et à l'allié ciblé. 3/tour : jusqu'à +3 PM répartis.
- Tags : `heal`, `steal`, `buff_mp`, `air`

#### 1B. Crocs du Mulou (id 31113)

- **4 PA** · PO 0–5 (non modifiable) · LdV requise · 1/tour · CC 20 % · élément(s) : Terre
- Grades : g1 niv.95 dmg 36–38 PO0-4 ; g2 niv.162 dmg 39–43 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Terre aux ennemis et augmente les dommages en mêlée du lanceur et des alliés en zone. »
- Effets (infobulle, valeurs de base) :
  - 39 à 43 dommages Terre (CC : 45 à 50 dommages Terre) — cibles : ennemis ; zone : croix de taille 1
  - 5% Dommages mêlée — cibles : alliés (hors lanceur), lanceur ; zone : croix de taille 1 ; 2 tour(s)
- **Rôle tactique** : 4 PA : 39–43 Terre en croix aux ennemis, +5 % dommages mêlée (2 tours) au lanceur et alliés de la zone. Sort offensif Terre de l'Osamodas.
- Tags : `damage`, `buff`, `aoe`, `earth`

### Paire 2 : Pics du Prespic / Déplumage

> Choix : Pics du Prespic (+10 % CC) en soutien ; Déplumage (−60 rés. poussée) avec un groupe de placeurs.

#### 2A. Pics du Prespic (id 31111)

- **2 PA** · PO 0–5 (modifiable) · LdV requise · 3/tour, 2/cible · CC 5 % · élément(s) : Feu
- Grades : g1 niv.1 dmg 8–10 PO0-3 ; g2 niv.67 dmg 11–13 PO0-4 ; g3 niv.133 dmg 14–17 (grade utilisé : 3).
- Description du jeu : « Vole de la vie aux ennemis ou soigne les alliés dans l'élément Feu. Augmente également les Critiques du lanceur et de l'allié ciblé. Les soins n'affectent pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 14 à 17 vol Feu (CC : 19 à 22 vol Feu) — cibles : ennemis
  - 14 à 17 soins Feu (CC : 19 à 22 soins Feu) — cibles : alliés (hors lanceur)
  - 10% Critique — cibles : alliés (hors lanceur), lanceur ; 2 tour(s)
- **Rôle tactique** : 2 PA : vol/soin Feu 14–17 et +10 % critiques (2 tours) au lanceur et à l'allié ciblé.
- Tags : `heal`, `steal`, `buff_crit`, `fire`

#### 2B. Déplumage (id 31137)

- **4 PA** · PO 0–6 (modifiable) · LdV requise · 1/tour · CC 20 % · élément(s) : Air
- Grades : g1 niv.100 dmg 33–35 PO0-5 ; g2 niv.167 dmg 37–40 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Air et réduit les Résistances Poussée des ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - 37 à 40 dommages Air (CC : 41 à 45 dommages Air) — cibles : ennemis ; zone : croix de taille 1
  - -60 Résistances Poussée — cibles : ennemis ; zone : croix de taille 1 ; 2 tour(s)
- **Rôle tactique** : 4 PA, croix : 37–40 Air et −60 résistance poussée (2 tours) : prépare les dommages de poussée des alliés (Fouet, Aéropique, Iop/Pandawa).
- Tags : `damage`, `debuff`, `aoe`, `air`

### Paire 3 : Dents du Piranya / Cœur Sauvage

> Choix : Dents du Piranya : soin/vol de zone + 20 Dommages, cœur du soutien Eau ; Cœur Sauvage (+15 % soins reçus) si un Eniripsa soigne.

#### 3A. Dents du Piranya (id 31135)

- **3 PA** · PO 0–5 (non modifiable) · LdV requise · 2/tour · CC 10 % · élément(s) : Eau
- Grades : g1 niv.1 dmg 11–13 PO0-3 ; g2 niv.68 dmg 15–17 PO0-4 ; g3 niv.134 dmg 19–22 (grade utilisé : 3).
- Description du jeu : « Soigne les alliés et vole de la vie dans l'élément Eau aux ennemis en zone. Augmente également les Dommages du lanceur et des alliés ciblés. Les soins n'affectent pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 19 à 22 soins Eau (CC : 24 à 28 soins Eau) — cibles : alliés (hors lanceur) ; zone : croix de taille 1
  - 19 à 22 vol Eau (CC : 24 à 28 vol Eau) — cibles : ennemis ; zone : croix de taille 1
  - 20 Dommages — cibles : alliés (hors lanceur), lanceur ; zone : croix de taille 1 ; 2 tour(s)
- **Rôle tactique** : 3 PA, croix 1 : soigne 19–22 Eau les alliés (hors lanceur) et vole 19–22 aux ennemis de la zone, +20 Dommages 2 tours au lanceur et aux alliés touchés. Le meilleur sort de soutien de la classe en groupe serré.
- Tags : `heal`, `steal`, `buff_damage`, `aoe`, `water`

#### 3B. Cœur Sauvage (id 31140)

- **4 PA** · PO 0–7 (non modifiable) · LdV requise · 1/tour · CC 20 % · élément(s) : Feu
- Grades : g1 niv.105 dmg 33–37 PO0-6 ; g2 niv.172 dmg 39–43 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Feu aux ennemis et augmente les soins reçus du lanceur et des alliés en zone. »
- Effets (infobulle, valeurs de base) :
  - 39 à 43 dommages Feu (CC : 45 à 50 dommages Feu) — cibles : ennemis ; zone : croix diagonale de taille 1
  - Soins reçus x115% — cibles : alliés (hors lanceur), lanceur ; zone : croix diagonale de taille 1 ; 2 tour(s) ; déclenchement : quand le porteur est soigné (buff 2 t.)
- **Rôle tactique** : 4 PA : 39–43 Feu en croix diagonale aux ennemis + soins reçus ×115 % (2 tours) aux alliés et au lanceur de la zone.
- Tags : `damage`, `buff_heal`, `aoe`, `fire`

### Paire 4 : Cri de l'Ours / Bave du Crapaud

> Choix : Cri de l'Ours (+150 Puissance au contact) pour booster ; Bave du Crapaud (−40 Dommages en carré) contre un paquet de frappeurs.

#### 4A. Cri de l'Ours (id 31132)

- **3 PA** · PO 0–1 (non modifiable) · en ligne, en diagonale, LdV requise · 2/tour · CC 10 % · élément(s) : Terre
- Grades : g1 niv.1 dmg 14–16 ; g2 niv.69 dmg 18–20 ; g3 niv.136 dmg 23–26 (grade utilisé : 3).
- Description du jeu : « Soigne les alliés et vole de la vie dans l'élément Terre aux ennemis en zone. Augmente également la Puissance du lanceur et des alliés ciblés. Les soins n'affectent pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 23 à 26 soins Terre (CC : 28 à 31 soins Terre) — cibles : alliés (hors lanceur) ; zone : carré de taille 1
  - 23 à 26 vol Terre (CC : 28 à 31 vol Terre) — cibles : ennemis ; zone : carré de taille 1
  - 150 Puissance — cibles : alliés (hors lanceur), lanceur ; zone : carré de taille 1 ; 2 tour(s)
- **Rôle tactique** : 3 PA, PO 0–1 (au contact, carré 1) : soin/vol Terre 23–26 et +150 Puissance (2 tours) aux alliés touchés et au lanceur. Énorme boost pour un DPS de mêlée.
- Tags : `heal`, `steal`, `buff_power`, `aoe`, `earth`

#### 4B. Bave du Crapaud (id 31139)

- **4 PA** · PO 0–4 (non modifiable) · LdV requise · 1/tour · CC 20 % · élément(s) : Eau
- Grades : g1 niv.110 dmg 32–34 ; g2 niv.177 dmg 37–40 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Eau et retire des Dommages aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - 37 à 40 dommages Eau (CC : 42 à 46 dommages Eau) — cibles : ennemis ; zone : carré de taille 1
  - -40 Dommages — cibles : ennemis ; zone : carré de taille 1 ; 2 tour(s)
- **Rôle tactique** : 4 PA, carré 1 : 37–40 Eau et −40 Dommages (2 tours) aux ennemis : réduction de dégâts d'un paquet.
- Tags : `damage`, `debuff`, `aoe`, `water`

### Paire 5 : Fouet / Cravache

> Choix : Fouet (relance les créatures +1 PM, repousse) ; Cravache pour regrouper.

#### 5A. Fouet (id 31114)

- **2 PA** · PO 1–5 (non modifiable) · LdV requise · 3/tour, 1/cible · CC 5 % · élément(s) : meilleur élément
- Grades : g1 niv.5 dmg 8–10 PO1-3 ; g2 niv.72 dmg 11–13 PO1-4 ; g3 niv.139 dmg 15–17 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages dans le meilleur élément du lanceur aux ennemis et repousse la cible. Augmente également les PM de la cible si c'est une invocation alliée. »
- Effets (infobulle, valeurs de base) :
  - 15 à 17 dommages du meilleur élément (CC : 18 à 21 dommages du meilleur élément) — cibles : ennemis
  - Repousse de 2 cases
  - 1 PM — cibles : invocations alliées non statiques ; 1 tour(s)
- **Rôle tactique** : 2 PA, meilleur élément 15–17, repousse 2 ; sur une créature alliée : +1 PM (1 tour) — sert à repositionner/relancer une créature.
- Tags : `damage`, `placement`, `summon_support`

#### 5B. Cravache (id 31136)

- **2 PA** · PO 1–5 (non modifiable) · LdV requise · 2/tour · CC 5 % · élément(s) : meilleur élément
- Grades : g1 niv.115 dmg 9–11 PO1-4 ; g2 niv.182 dmg 11–13 (grade utilisé : 2).
- Description du jeu : « Attire les cibles vers le centre et occasionne des dommages dans le meilleur élément du lanceur aux ennemis en zone. Téléporte les cibles symétriquement par rapport au centre si la case centrale est occupée. N'affecte pas directement le lanceur. »
- Effets (infobulle, valeurs de base) :
  - Attire de 1 case — cibles : alliés (hors lanceur), ennemis ; zone : croix sans centre de taille 1 (à partir de 1)
  - Téléportation symétrique — cibles : alliés (hors lanceur), ennemis ; zone : croix de taille 1
  - 11 à 13 dommages du meilleur élément (CC : 14 à 16 dommages du meilleur élément) — cibles : ennemis ; zone : croix de taille 1
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - Attire de 1 case — cibles : alliés (hors lanceur), ennemis ; zone : croix sans centre de taille 1 (à partir de 1)
  - le lanceur lance le sort «Cravache» (31193, grade 1)
    - *Sous-sort «Cravache» (id 31193, grade 1)*
      - Téléportation symétrique — cibles : alliés (hors lanceur), ennemis ; zone : croix sans centre de taille 1
  - 11 à 13 dommages du meilleur élément (CC : 14 à 16 dommages du meilleur élément) — cibles : ennemis ; zone : croix de taille 1
- **Rôle tactique** : 2 PA : attire les 4 voisins de la case ciblée d'1 case vers elle (ou les téléporte symétriquement si la case est occupée) puis 11–13 dans le meilleur élément en croix. Regroupe pour les zones alliées.
- Tags : `damage`, `placement`, `aoe`

### Paire 6 : Tofu / Griffes du Chtigre

> Choix : Tofu (1 PI, 8 PM, mobile) presque toujours ; Griffes du Chtigre (×75 % soins reçus) contre des monstres qui se soignent.

#### 6A. Tofu (id 31115)

- **3 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 1 t. · CC 0 %
- Grades : g1 niv.10 ; g2 niv.77 ; g3 niv.144 (grade utilisé : 3).
- Description du jeu : « Invoque un Tofu maîtrisable qui peut occasionner des dommages Air, soigner, retirer du Tacle et repousser. »
- Effets (infobulle, valeurs de base) :
  - invoque «Tofu» (8070, grade 3)
- **Rôle tactique** : Invoque un Tofu (1 PI, 4 PA, 8 PM, intaclable, ne tacle pas) : vole/soigne en Air, retire 40 Tacle, repousse. Éclaireur et soutien mobile.
- Tags : `summon`, `air`, `mobility`

#### 6B. Griffes du Chtigre (id 31134)

- **3 PA** · PO 1–5 (non modifiable) · LdV requise · 2/tour · CC 10 % · élément(s) : Feu
- Grades : g1 niv.120 dmg 21–23 PO1-4 ; g2 niv.187 dmg 26–29 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Feu et réduit les soins reçus par la cible. »
- Effets (infobulle, valeurs de base) :
  - 26 à 29 dommages Feu (CC : 31 à 35 dommages Feu)
  - Soins reçus x75% — déclenchement : quand le porteur est soigné (buff 1 t.)
- **Rôle tactique** : 3 PA : 26–29 Feu et soins reçus ×75 % (1 tour) sur la cible : anti-soin contre un boss ou des soigneurs ennemis.
- Tags : `damage`, `anti_heal`, `fire`

### Paire 7 : Bouftou / Serres du Vautour

> Choix : Bouftou (1 PI, tacle) ; Serres du Vautour si le groupe a besoin de soin sur attaque.

#### 7A. Bouftou (id 31116)

- **3 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 1 t. · CC 0 %
- Grades : g1 niv.15 ; g2 niv.82 ; g3 niv.149 (grade utilisé : 3).
- Description du jeu : « Invoque un Bouftou maîtrisable qui peut occasionner des dommages Terre, soigner, retirer de la Fuite et se téléporter. »
- Effets (infobulle, valeurs de base) :
  - invoque «Bouftou» (8072, grade 3)
- **Rôle tactique** : Invoque un Bouftou (1 PI, tacle, −40 Fuite à l'attaque, vol/soin Terre, téléportation symétrique) : bloqueur bon marché.
- Tags : `summon`, `tank`, `earth`

#### 7B. Serres du Vautour (id 31133)

- **3 PA** · PO 1–7 (modifiable) · en ligne, LdV requise · 2/tour · CC 10 % · élément(s) : Air
- Grades : g1 niv.125 dmg 18–20 PO1-6 ; g2 niv.192 dmg 22–25 (grade utilisé : 2).
- Description du jeu : « Occasionne des dommages Air aux ennemis et soigne leurs attaquants en zone. »
- Effets (infobulle, valeurs de base) :
  - 22 à 25 dommages Air (CC : 26 à 30 dommages Air) — cibles : ennemis ; zone : fourche de taille 1
  - soigne l'attaquant de 15% des dommages subis — cibles : ennemis ; zone : fourche de taille 1 ; déclenchement : quand le porteur subit des dommages (buff 1 t.)
- **Rôle tactique** : 3 PA en ligne (fourche) : 22–25 Air aux ennemis touchés ; pendant 1 tour, quiconque les attaque est soigné de 15 % des dommages infligés.
- Tags : `damage`, `heal_on_attack`, `aoe`, `air`

### Paire 8 : Crapipou / Toison d'Or

> Choix : Toison d'Or (bouclier 300 PV en cercle 2 + dégâts) en soutien ; Crapipou pour la voie Eau invocatrice.

#### 8A. Crapipou (id 31117)

- **3 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 1 t. · CC 0 %
- Grades : g1 niv.20 ; g2 niv.87 ; g3 niv.154 (grade utilisé : 3).
- Description du jeu : « Invoque un Crapipou maîtrisable qui peut occasionner des dommages et appliquer un poison Eau, soigner, augmenter ou retirer de la Portée et s'éloigner. »
- Effets (infobulle, valeurs de base) :
  - invoque «Crapipou» (8074, grade 3)
- **Rôle tactique** : Invoque un Crapipou (1 PI) : poison Eau, −2 PO, vol/soin Eau, +2 PO alliés.
- Tags : `summon`, `poison`, `water`

#### 8B. Toison d'Or (id 31138)

- **3 PA** · PO 0–0 (non modifiable) · sans LdV · 2/tour · CC 15 % · élément(s) : Terre
- Grades : g1 niv.130 dmg 22–24 ; g2 niv.197 dmg 24–27 (grade utilisé : 2).
- Description du jeu : « Applique un bouclier sur les alliés et occasionne des dommages Terre aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - bouclier de 150% du niveau du lanceur — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2 ; 1 tour(s)
  - 24 à 27 dommages Terre (CC : 29 à 32 dommages Terre) — cibles : ennemis ; zone : cercle de taille 2 (à partir de 1)
- **Rôle tactique** : 3 PA, autour du lanceur : bouclier de 150 % du niveau (300 au niv. 200) 1 tour aux alliés en cercle 2 et 24–27 Terre aux ennemis du même cercle (hors case centrale). 2/tour = jusqu'à 600 de bouclier.
- Tags : `shield`, `damage`, `aoe`, `earth`

### Paire 9 : Dragoune / Morsure du Serpent

> Choix : Dragoune en voie Feu ; Morsure du Serpent (×104 % dommages subis + poison) pour un focus boss.

#### 9A. Dragoune (id 31118)

- **3 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 1 t. · CC 0 %
- Grades : g1 niv.25 ; g2 niv.92 ; g3 niv.159 (grade utilisé : 3).
- Description du jeu : « Invoque une Dragoune maîtrisable qui peut occasionner des dommages Feu, soigner, retirer de la Puissance et échanger de positions. »
- Effets (infobulle, valeurs de base) :
  - invoque «Dragoune» (8076, grade 3)
- **Rôle tactique** : Invoque une Dragoune (1 PI) : −100 Puissance à l'attaque, échange de place, vol/soin Feu.
- Tags : `summon`, `fire`

#### 9B. Morsure du Serpent (id 31112)

- **3 PA** · PO 1–5 (non modifiable) · LdV requise · 2/tour · CC 10 % · élément(s) : Eau
- Grades : g1 niv.135 (grade utilisé : 1).
- Description du jeu : « Augmente les dommages subis par la cible et lui applique un poison Eau de début de tour. »
- Effets (infobulle, valeurs de base) :
  - Dommages subis x104% — déclenchement : quand le porteur subit des dommages (buff 2 t.)
  - 19 à 21 dommages Eau (CC : 22 à 24 dommages Eau) — déclenchement : début de tour du porteur (buff 2 t.)
- **Rôle tactique** : 3 PA : dommages subis ×104 % (2 tours) et poison Eau 19–21 au début des 2 prochains tours de la cible. Focus boss.
- Tags : `debuff`, `poison`, `water`

### Paire 10 : Cortège Sauvage / Pacte Bestial

> Choix : Cortège Sauvage pour l'armée/burst ; Pacte Bestial pour un Osamodas DPS.

#### 10A. Cortège Sauvage (id 31119)

- **2 PA** · PO 0–0 (non modifiable) · sans LdV · relance 5 t., relance initiale 1 t. · CC 0 %
- Grades : g1 niv.30 PA3 ; g2 niv.97 ; g3 niv.164 (grade utilisé : 3).
- Description du jeu : « Augmente les Invocations du lanceur et réduit le coût en PA des sorts d'invocation Osamodas. Toutes les invocations Osamodas meurent au début du tour du lanceur tant qu'il est sous les effets du sort. »
- Effets (infobulle, valeurs de base) :
  - 3 Invocations — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
  - Tue la cible — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - Change l'apparence — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
  - Change l'apparence — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
  - 3 Invocations — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
  - la cible lance le sort «Cortège Sauvage» (32555, grade 2) — cibles : lanceur
    - *Sous-sort «Cortège Sauvage» (id 32555, grade 2)*
      - «Tofu» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Bouftou» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Crapipou» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Dragoune» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Ventritofu» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Bouflourd» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Crapipaud» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Dragonnet» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Craquolosse» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Crocoléreux» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Sulfénix» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Scarafoudre» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Esprit Glouton» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
      - «Esprit Facétieux» : -1 PA — cibles : lanceur ; 2 tour(s) ; désenvoûtement fort uniquement
  - la cible lance le sort «Cortège Sauvage» (32555, grade 1) — cibles : lanceur ; effet différé de 1 tour(s)
    - *Sous-sort «Cortège Sauvage» (id 32555, grade 1)*
      - Tue la cible — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est l'un de: «Tofu» (8070), «Ventritofu» (8071), «Bouftou» (8072), «Bouflourd» (8073), «Crapipou» (8074), «Crapipaud» (8075), «Dragoune» (8076), «Dragonnet» (8077), «Craquolosse» (8078), «Scarafoudre» (8079), «Crocoléreux» (8080), «Sulfénix» (8081), «Gobgob Glouton» (8082), «Gobgob Facétieux» (8083) ; zone : toute la carte
  - la cible lance le sort «Cortège Sauvage» (32555, grade 3) — cibles : lanceur ; effet différé de 2 tour(s)
    - *Sous-sort «Cortège Sauvage» (id 32555, grade 3)*
      - la cible lance le sort «Cortège Sauvage» (32555, grade 1) — cibles : lanceur
        - (sous-sort «Cortège Sauvage» 32555 g1 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA (relance 5) : +3 PI et −1 PA sur les sorts d'invocation pendant 2 tours ; les créatures Osamodas meurent au début des 2 tours suivants du lanceur. Tour de burst.
- Tags : `summon_buff`, `burst`

#### 10B. Pacte Bestial (id 31141)

- **2 PA** · PO 0–0 (non modifiable) · sans LdV · relance 2 t., relance initiale 1 t. · CC 0 %
- Grades : g1 niv.140 (grade utilisé : 1).
- Description du jeu : « Applique l'état Bestial sur le lanceur : • Augmente ses PA. • Sacrifie toutes ses présentes et futures invocations Osamodas pour augmenter ses dommages et soins finaux. • Transfère une partie de la vie des invocations sacrifiées vers le lanceur. • Les effets sont plus importants selon le coût en PI de l'invocation. Les Gobgobs ne sont pas affectés par le sort. La durée de l'état et du bonus PA est prolongée si le lanceur invoque une créature Osamodas. Le temps de relance des sorts d'invocation Osamodas est réinitialisé et les effets du sort sont retirés à la perte de l'état ou si le sort est relancé. »
- Effets (infobulle, valeurs de base) :
  - applique l'état «Bestial» (6295) — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
  - 2 PA — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
  - 3% Dommages finaux — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
  - 3% Soins finaux — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
  - 6% Dommages finaux — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
  - 6% Soins finaux — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
  - 9% Dommages finaux — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
  - 9% Soins finaux — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
  - Transfère 30% des PV — cibles : lanceur
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - la cible lance le sort «Pacte Bestial» (32557, grade 1) — cibles : lanceur ; si la cible n'a pas l'état «Bestial» (6295)
    - *Sous-sort «Pacte Bestial» (id 32557, grade 1)*
      - applique l'état «Bestial» (6295) — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
      - Change l'apparence — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
      - Change l'apparence — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
      - la cible lance le sort «Pacte Bestial» (32557, grade 2) — cibles : lanceur
        - *Sous-sort «Pacte Bestial» (id 32557, grade 2)*
          - 2 PA — cibles : lanceur ; 3 tour(s) ; désenvoûtement fort uniquement
          - la cible lance le sort «Pacte Bestial» (32557, grade 3) — cibles : lanceur ; déclenchement : quand le porteur invoque une créature (CI, sens déduit) (buff 3 t.) ; désenvoûtement fort uniquement
            - *Sous-sort «Pacte Bestial» (id 32557, grade 3)*
              - le lanceur lance le sort «Pacte Bestial» (32557, grade 4) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible vient d'apparaître (invocation posée par ce sort) ; zone : toute la carte
          - la cible lance le sort «Pacte Bestial» (32557, grade 9) — cibles : lanceur ; effet différé de 3 tour(s)
            - *Sous-sort «Pacte Bestial» (id 32557, grade 9)*
              - retire les effets du sort «Pacte Bestial» (32557) — cibles : lanceur
              - «Tofu» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Bouftou» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Crapipou» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Dragoune» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Ventritofu» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Bouflourd» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Crapipaud» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Dragonnet» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Craquolosse» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Crocoléreux» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Sulfénix» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Scarafoudre» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Esprit Glouton» : relance fixée à 0 tour(s) — cibles : lanceur
              - «Esprit Facétieux» : relance fixée à 0 tour(s) — cibles : lanceur
      - la cible lance le sort «Pacte Bestial» (32557, grade 8) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est l'un de: «Tofu» (8070), «Ventritofu» (8071), «Bouftou» (8072), «Bouflourd» (8073), «Crapipou» (8074), «Crapipaud» (8075), «Dragoune» (8076), «Dragonnet» (8077), «Craquolosse» (8078), «Scarafoudre» (8079), «Crocoléreux» (8080), «Sulfénix» (8081)
        - *Sous-sort «Pacte Bestial» (id 32557, grade 8)*
          - Transfère 30% des PV — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
  - le lanceur lance le sort «Pacte Bestial» (32557, grade 4) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est l'un de: «Tofu» (8070), «Ventritofu» (8071), «Bouftou» (8072), «Bouflourd» (8073), «Crapipou» (8074), «Crapipaud» (8075), «Dragoune» (8076), «Dragonnet» (8077), «Craquolosse» (8078), «Scarafoudre» (8079), «Crocoléreux» (8080), «Sulfénix» (8081) ; zone : toute la carte
    - (sous-sort «Pacte Bestial» 32557 g4 déjà détaillé plus haut)
  - la cible lance le sort «Pacte Bestial» (32557, grade 9) — cibles : lanceur ; si la cible a l'état «Bestial» (6295)
    - (sous-sort «Pacte Bestial» 32557 g9 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA (relance 2) : état Bestial 3 tours, +2 PA ; chaque créature Osamodas présente ou future est sacrifiée (+3/6/9 % dommages et soins finaux selon son coût, 30 % de ses PV transférés). Transforme l'Osamodas en DPS.
- Tags : `self_buff`, `damage_buff`, `heal_buff`

### Paire 11 : Piqûre Motivante / Communion Animale

> Choix : Piqûre Motivante (+1 PA +1 PM 3 tours, +2/+2 sur invocation) est indispensable ; Communion Animale partage les dommages avec les créatures.

#### 11A. Piqûre Motivante (id 31120)

- **2 PA** · PO 0–5 (non modifiable) · LdV requise · relance 2 t. · CC 0 %
- Grades : g1 niv.35 PO0-3 ; g2 niv.102 PO0-4 ; g3 niv.169 (grade utilisé : 3).
- Description du jeu : « Augmente les PA et les PM de la cible. Les effets sont plus importants sur les invocations. »
- Effets (infobulle, valeurs de base) :
  - 1 PA — cibles : joueurs/compagnons alliés, joueurs/compagnons ennemis, monstres alliés, monstres ennemis, lanceur ; 3 tour(s)
  - 1 PM — cibles : joueurs/compagnons alliés, joueurs/compagnons ennemis, monstres alliés, monstres ennemis, lanceur ; 3 tour(s)
  - 2 PA — cibles : invocations alliées, invocations ennemies ; 3 tour(s)
  - 2 PM — cibles : invocations alliées, invocations ennemies ; 3 tour(s)
- **Rôle tactique** : 2 PA (relance 2) : +1 PA et +1 PM pendant 3 tours à un personnage (ou à soi), +2 PA +2 PM à une invocation (aussi ennemie : attention au masque). Indispensable pour un DPS allié.
- Tags : `buff_ap`, `buff_mp`

#### 11B. Communion Animale (id 31142)

- **3 PA** · PO 0–5 (non modifiable) · LdV requise · relance 3 t. · CC 0 %
- Grades : g1 niv.145 (grade utilisé : 1).
- Description du jeu : « Partage les dommages entre le lanceur et une invocation alliée. Sur le lanceur : partage les dommages entre toutes ses invocations. »
- Effets (infobulle, valeurs de base) :
  - Partage les dommages — cibles : lanceur, invocations alliées ; déclenchement : quand le porteur subit des dommages (buff 1 t.)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Communion Animale» (32554, grade 1) — cibles : invocations alliées
    - *Sous-sort «Communion Animale» (id 32554, grade 1)*
      - Partage les dommages — cibles : lanceur, invocations alliées ; déclenchement : quand le porteur subit des dommages (buff 1 t.)
      - applique l'état «Sacrifice» (583) — cibles : lanceur, invocations alliées ; 1 tour(s)
  - le lanceur lance le sort «Communion Animale» (32554, grade 2) — cibles : lanceur
    - *Sous-sort «Communion Animale» (id 32554, grade 2)*
      - Partage les dommages — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; déclenchement : quand le porteur subit des dommages (buff 1 t.)
      - applique l'état «Sacrifice» (583) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; 1 tour(s)
- **Rôle tactique** : 3 PA : partage les dommages entre l'Osamodas et une créature (1 tour), ou entre toutes ses créatures s'il se cible.
- Tags : `protection`, `damage_share`

### Paire 12 : Saute-granouille / Tornade de Plumes

> Choix : Saute-granouille (téléportation symétrique) ; Tornade de Plumes (téléportation + repousse de zone).

#### 12A. Saute-granouille (id 31121)

- **3 PA** · PO 1–2 (non modifiable) · LdV requise, cible requise (case occupée) · 2/tour · CC 10 % · élément(s) : Eau · critère d'état `HS!7`
- Grades : g1 niv.40 dmg 16–18 ; g2 niv.107 dmg 21–23 ; g3 niv.174 dmg 26–30 (grade utilisé : 3).
- Description du jeu : « Téléporte le lanceur symétriquement par rapport à la cible et occasionne des dommages Eau aux ennemis. Téléporte également la cible symétriquement par rapport au lanceur si c'est une invocation. »
- Effets (infobulle, valeurs de base) :
  - Téléportation symétrique par rapport à la cible
  - 26 à 30 dommages Eau (CC : 31 à 35 dommages Eau) — cibles : ennemis
  - Téléportation symétrique par rapport au lanceur — cibles : invocations alliées, invocations ennemies
- **Rôle tactique** : 3 PA, PO 1–2 : téléporte le lanceur symétriquement par rapport à la cible + 26–30 Eau ; si la cible est une invocation elle est aussi téléportée symétriquement (échange de côté).
- Tags : `damage`, `mobility`, `water`

#### 12B. Tornade de Plumes (id 31143)

- **4 PA** · PO 1–3 (non modifiable) · sans LdV, case libre requise · 1/tour · CC 20 % · élément(s) : Air · critère d'état `HS!7`
- Grades : g1 niv.150 (grade utilisé : 1).
- Description du jeu : « Téléporte le lanceur sur la case ciblée, occasionne des dommages Air aux ennemis et repousse les cibles depuis le centre en zone. »
- Effets (infobulle, valeurs de base) :
  - Téléporte sur la case ciblée
  - 34 à 38 dommages Air (CC : 41 à 46 dommages Air) — cibles : ennemis ; zone : cercle de taille 2 (à partir de 1)
  - Repousse de 2 cases — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 2 (à partir de 1)
- **Rôle tactique** : 4 PA : téléportation sur une case libre à 1–3, 34–38 Air en cercle 2 autour et repousse de 2. Sortie de tacle + dégâts de zone.
- Tags : `damage`, `mobility`, `placement`, `aoe`, `air`

### Paire 13 : Souffle Draconique / Frappe du Craqueleur

> Choix : Frappe du Craqueleur (cercle 3 + attire) regroupe les ennemis ; Souffle Draconique pour se dégager.

#### 13A. Souffle Draconique (id 31122)

- **3 PA** · PO 1–7 (non modifiable) · en ligne, LdV requise · 2/tour · CC 10 % · élément(s) : Feu
- Grades : g1 niv.45 dmg 14–16 PO1-5 ; g2 niv.112 dmg 19–22 PO1-6 ; g3 niv.179 dmg 23–26 (grade utilisé : 3).
- Description du jeu : « Éloigne le lanceur des cibles, occasionne des dommages Feu aux ennemis et repousse les cibles en zone. »
- Effets (infobulle, valeurs de base) :
  - Recule de 1 case — zone : cône de taille 1
  - 23 à 26 dommages Feu (CC : 28 à 31 dommages Feu) — cibles : ennemis ; zone : cône de taille 1
  - Repousse de 2 cases — zone : cône de taille 1
- **Rôle tactique** : 3 PA en ligne : le lanceur recule de 1, 23–26 Feu en cône et repousse 2 : se dégager d'un contact.
- Tags : `damage`, `placement`, `aoe`, `fire`

#### 13B. Frappe du Craqueleur (id 31144)

- **4 PA** · PO 1–3 (non modifiable) · LdV requise · 2/tour · CC 15 % · élément(s) : Terre
- Grades : g1 niv.155 (grade utilisé : 1).
- Description du jeu : « Occasionne des dommages Terre et attire les cibles jusqu'au centre en zone. N'affecte pas le lanceur. »
- Effets (infobulle, valeurs de base) :
  - 31 à 35 dommages Terre (CC : 37 à 42 dommages Terre) — cibles : ennemis ; zone : cercle de taille 3
  - Attire de 2 cases — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 3
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - 31 à 35 dommages Terre (CC : 37 à 42 dommages Terre) — cibles : ennemis ; zone : cercle de taille 3
  - Attire de 1 case — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 1 (à partir de 1)
  - Attire de 2 cases — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 2 (à partir de 2)
  - Attire de 2 cases — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 3 (à partir de 3)
- **Rôle tactique** : 4 PA, PO 1–3 : 31–35 Terre en cercle 3 puis attire tout vers le centre (anneaux 1/2/3). Regroupe un paquet d'ennemis.
- Tags : `damage`, `placement`, `aoe`, `earth`

### Paire 14 : Charge Bestiale / Chant du Phénix

> Choix : Chant du Phénix (soin + dommages en cercle 2) en soutien ; Charge Bestiale pour la mobilité Terre.

#### 14A. Charge Bestiale (id 31123)

- **3 PA** · PO 1–5 (non modifiable) · en ligne, LdV requise, cible requise (case occupée) · 2/tour · CC 10 % · élément(s) : Terre
- Grades : g1 niv.50 dmg 16–18 ; g2 niv.117 dmg 22–25 ; g3 niv.184 dmg 26–29 (grade utilisé : 3).
- Description du jeu : « Rapproche le lanceur vers la cible et occasionne des dommages Terre aux ennemis. Attire également les invocations jusqu'au centre en zone autour de la cible. »
- Effets (infobulle, valeurs de base) :
  - Avance de 4 cases
  - 26 à 29 dommages Terre (CC : 31 à 35 dommages Terre) — cibles : ennemis
  - Attire de 4 cases — cibles : invocations alliées, invocations ennemies ; zone : croix sans centre de taille 4 (à partir de 4)
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - Avance de 4 cases
  - 26 à 29 dommages Terre (CC : 31 à 35 dommages Terre) — cibles : ennemis
  - Attire de 1 case — cibles : invocations alliées, invocations ennemies ; zone : croix sans centre de taille 1 (à partir de 1)
  - Attire de 2 cases — cibles : invocations alliées, invocations ennemies ; zone : croix sans centre de taille 2 (à partir de 2)
  - Attire de 3 cases — cibles : invocations alliées, invocations ennemies ; zone : croix sans centre de taille 3 (à partir de 3)
  - Attire de 4 cases — cibles : invocations alliées, invocations ennemies ; zone : croix sans centre de taille 4 (à partir de 4)
- **Rôle tactique** : 3 PA en ligne (cible requise) : avance de 4 vers la cible, 26–29 Terre et attire les invocations en croix autour d'elle. Ramène ses créatures au front.
- Tags : `damage`, `mobility`, `summon_support`, `earth`

#### 14B. Chant du Phénix (id 31145)

- **4 PA** · PO 0–5 (non modifiable) · LdV requise · 1/tour · CC 20 % · élément(s) : Feu
- Grades : g1 niv.160 (grade utilisé : 1).
- Description du jeu : « Soigne les alliés, occasionne des dommages Feu aux ennemis et repousse les cibles depuis le centre en zone. »
- Effets (infobulle, valeurs de base) :
  - 30 à 34 soins Feu (CC : 36 à 41 soins Feu) — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2
  - 30 à 34 dommages Feu (CC : 36 à 41 dommages Feu) — cibles : ennemis ; zone : cercle de taille 2
  - Repousse de 2 cases — zone : cercle de taille 2 (à partir de 1)
- **Rôle tactique** : 4 PA, cercle 2 : soigne 30–34 Feu les alliés (lanceur compris), inflige 30–34 Feu aux ennemis et repousse tout ce qui est autour du centre. Soin de zone principal.
- Tags : `heal`, `damage`, `aoe`, `fire`

### Paire 15 : Aéropique / Tourbillon

> Choix : Tourbillon (repositionne les alliés) ; Aéropique pour la mobilité Air.

#### 15A. Aéropique (id 31124)

- **3 PA** · PO 1–5 (non modifiable) · en ligne, LdV requise · 2/tour · CC 10 % · élément(s) : Air
- Grades : g1 niv.55 dmg 16–18 PO1-3 ; g2 niv.122 dmg 21–24 PO1-4 ; g3 niv.189 dmg 24–27 (grade utilisé : 3).
- Description du jeu : « Rapproche le lanceur vers la cible, occasionne des dommages Air aux ennemis et repousse la cible. Repousse également les entités au contact de la cible si cette dernière est une invocation. »
- Effets (infobulle, valeurs de base) :
  - Avance de 4 cases
  - 24 à 27 dommages Air (CC : 29 à 32 dommages Air) — cibles : ennemis
  - Repousse de 3 cases
  - Repousse de 3 cases — zone : croix sans centre de taille 1
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - Avance de 4 cases
  - 24 à 27 dommages Air (CC : 29 à 32 dommages Air) — cibles : ennemis
  - Repousse de 3 cases
  - le lanceur lance le sort «Aéropique» (31436, grade 2) — cibles : invocations alliées, invocations ennemies
    - *Sous-sort «Aéropique» (id 31436, grade 2)*
      - Repousse de 3 cases — zone : croix sans centre de taille 1 ; 2 tour(s)
- **Rôle tactique** : 3 PA en ligne : avance de 4, 24–27 Air, repousse la cible de 3 ; si la cible est une invocation, repousse aussi ses voisins (créature-bélier).
- Tags : `damage`, `mobility`, `placement`, `air`

#### 15B. Tourbillon (id 31146)

- **4 PA** · PO 0–3 (non modifiable) · LdV requise · 2/tour · CC 15 % · élément(s) : Eau
- Grades : g1 niv.165 (grade utilisé : 1).
- Description du jeu : « Téléporte les alliés symétriquement par rapport au centre et occasionne des dommages Eau aux ennemis en zone. »
- Effets (infobulle, valeurs de base) :
  - Téléportation symétrique — cibles : alliés (lanceur inclus) ; zone : cercle de taille 2
  - 31 à 35 dommages Eau (CC : 37 à 42 dommages Eau) — cibles : ennemis ; zone : cercle de taille 2
- **Rôle tactique** : 4 PA, cercle 2 : téléporte symétriquement les alliés de la zone par rapport au centre et 31–35 Eau aux ennemis. Repositionne le groupe.
- Tags : `placement`, `damage`, `aoe`, `water`

### Paire 16 : Discipline / Martinet

> Choix : Martinet (toutes les créatures attaquent) ; Discipline (−2 PM, attire 4) en entrave.

#### 16A. Discipline (id 31125)

- **2 PA** · PO 1–5 (non modifiable) · LdV requise · 2/tour, 1/cible · CC 10 % · élément(s) : meilleur élément
- Grades : g1 niv.60 dmg 14–16 ; g2 niv.127 dmg 17–20 ; g3 niv.194 dmg 19–22 (grade utilisé : 3).
- Description du jeu : « Occasionne des dommages dans le meilleur élément du lanceur et retire des PM aux ennemis, et attire la cible. »
- Effets (infobulle, valeurs de base) :
  - 19 à 22 dommages du meilleur élément (CC : 23 à 26 dommages du meilleur élément) — cibles : ennemis
  - -2 PM (esquivable) — cibles : ennemis ; 1 tour(s) ; désenvoûtement fort uniquement
  - Attire de 4 cases
- **Rôle tactique** : 2 PA : 19–22 meilleur élément, −2 PM esquivables, attire de 4 (2/tour, 1/cible).
- Tags : `damage`, `mp_removal`, `placement`

#### 16B. Martinet (id 31147)

- **3 PA** · PO 0–5 (non modifiable) · LdV requise, cible requise (case occupée) · relance 2 t. · CC 15 % · élément(s) : Air, Eau, Feu, Terre, meilleur élément
- Grades : g1 niv.170 (grade utilisé : 1).
- Description du jeu : « Attire toutes les invocations du lanceur vers la cible et occasionne des dommages dans le meilleur élément du lanceur aux ennemis. Les invocations Osamodas attaquent également si elles sont à portée et en ligne de vue de la cible. Les dommages et soins des invocations sont réduits de 50% pendant l'utilisation du sort. • Tofu : Bisou Béco • Bouftou : Saute-bouftou • Crapipou : Croassement • Dragoune : Dracorage • Ventritofu : Ventripoussée • Bouflourd : Charge du Bouflourd • Crapipaud : Crapobatie • Dragonnet : Souffle du Dragon • Scarafoudre : Scarafusée • Craquolosse : Fronde Rocheuse • Crocoléreux : Crocs Coléreux • Sulfénix : Sulfuria »
- Effets (infobulle, valeurs de base) :
  - Attire de 2 cases — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; zone : cercle de taille 63 (à partir de 1)
  - 21 à 24 dommages du meilleur élément (CC : 25 à 29 dommages du meilleur élément) — cibles : ennemis
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - applique l'état «Martinet» (6390) — 1 tour(s) ; indésenvoûtable
  - Attire de 2 cases — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; zone : cercle de taille 63 (à partir de 1)
  - 21 à 24 dommages du meilleur élément (CC : 25 à 29 dommages du meilleur élément) — cibles : ennemis
  - la cible lance le sort «Martinet» (31440, grade 1) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
    - *Sous-sort «Martinet» (id 31440, grade 1)*
      - -50% Dommages finaux — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
      - -50% Soins finaux — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
      - la cible lance le sort «Martinet» (31440, grade 2) — cibles : lanceur
        - *Sous-sort «Martinet» (id 31440, grade 2)*
          - applique l'état «Martinet (ligne de vue)» (6393) — cibles : tous ; si la cible a l'état «Martinet» (6390) ; zone : cercle de taille 63 (à partir de 1), seulement si en ligne de vue ; 1 tour(s) ; indésenvoûtable
          - la cible lance le sort «Martinet» (31440, grade 3) — cibles : lanceur
            - *Sous-sort «Martinet» (id 31440, grade 3)*
              - le lanceur lance le sort «Bisou Béco» (31156, grade 3) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Tofu» (8070) ; zone : croix sans centre de taille 4
              - le lanceur lance le sort «Saute-bouftou» (31159, grade 3) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Bouftou» (8072) ; si le lanceur n'a pas l'état «Pesanteur» (7) ; zone : croix sans centre de taille 2
              - le lanceur lance le sort «Croassement» (31164, grade 3) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Crapipou» (8074) ; zone : cercle de taille 5 (à partir de 1)
              - le lanceur lance le sort «Dracorage» (31168, grade 3) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Dragoune» (8076) ; si le lanceur n'a pas l'état «Pesanteur» (7) ; zone : cercle de taille 2 (à partir de 1)
              - le lanceur lance le sort «Ventripoussée» (31157, grade 2) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Ventritofu» (8071) ; zone : croix sans centre de taille 4
              - le lanceur lance le sort «Charge du Bouflourd» (31161, grade 2) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Bouflourd» (8073) ; zone : croix sans centre de taille 5
              - le lanceur lance le sort «Crapobatie» (31165, grade 2) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Crapipaud» (8075) ; si le lanceur n'a pas l'état «Pesanteur» (7) ; zone : cercle de taille 2 (à partir de 1)
              - le lanceur lance le sort «Souffle du Dragon» (31169, grade 2) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Dragonnet» (8077) ; zone : croix sans centre de taille 6
              - le lanceur lance le sort «Scarafusée» (31179, grade 1) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si le lanceur est le monstre «Scarafoudre» (8079) ; si le lanceur n'a pas l'état «Pesanteur» (7) ; zone : croix sans centre de taille 6
              - le lanceur lance le sort «Fronde Rocheuse» (31174, grade 1) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Craquolosse» (8078) ; zone : cercle de taille 5 (à partir de 1)
              - le lanceur lance le sort «Crocs Coléreux» (31180, grade 1) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Crocoléreux» (8080) ; zone : cercle de taille 2 (à partir de 1)
              - le lanceur lance le sort «Sulfuria» (31183, grade 1) — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «Martinet» (6390) ; si la cible a l'état «Martinet (ligne de vue)» (6393) ; si le lanceur est le monstre «Sulfénix» (8081) ; zone : cercle de taille 5 (à partir de 1)
          - retire l'état «Martinet (ligne de vue)» (6393) — cibles : tous ; si la cible a l'état «Martinet» (6390) ; zone : cercle de taille 63 (à partir de 1), seulement si en ligne de vue
      - retire les effets du sort «Martinet» (31440) — cibles : lanceur
  - retire l'état «Martinet» (6390) — 1 tour(s) ; indésenvoûtable
- **Rôle tactique** : 3 PA (relance 2, cible requise) : attire toutes les créatures de 2 vers la cible, 21–24 meilleur élément, puis chaque créature à portée et en vue lance son attaque (−50 %).
- Tags : `damage`, `burst`, `summon_support`

### Paire 17 : Laisse Spirituelle / Relais Spirituel

> Choix : Laisse Spirituelle (placement unique) ; Relais Spirituel pour l'armée.

#### 17A. Laisse Spirituelle (id 31152)

- **2 PA** · PO 0–5 (non modifiable) · en ligne, LdV requise · relance 2 t. · CC 0 %
- Grades : g1 niv.65 PO0-3 ; g2 niv.131 PO0-4 ; g3 niv.198 (grade utilisé : 3).
- Description du jeu : « Applique l'état En laisse sur la cible pour le tour en cours : • Suit le lanceur immédiatement et lorsqu'il utilise ses PM. Sur le lanceur : applique l'état sur toutes ses invocations. L'état est retiré si le lanceur ou la cible sont déplacés. »
- Effets (infobulle, valeurs de base) :
  - applique l'état «En Laisse» (6290) — cibles : alliés (hors lanceur), ennemis ; 1 tour(s) ; indésenvoûtable
  - Suit le lanceur — cibles : alliés (hors lanceur), ennemis ; déclenchement : quand le lanceur de l'effet dépense des PM (CMPARR, sens déduit) (buff 1 t.) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Laisse Spirituelle» (31194, grade 1) — cibles : alliés (hors lanceur), ennemis
    - *Sous-sort «Laisse Spirituelle» (id 31194, grade 1)*
      - le lanceur lance le sort «Laisse Spirituelle» (31194, grade 6) — cibles : lanceur ; déclenchement : quand le porteur est déplacé / quand le porteur est téléporté / quand le porteur gagne l'état «Porté» (8) / quand le porteur perd l'état «Porté» (8) / quand le porteur passe un portail / fin de tour du porteur (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Laisse Spirituelle» (id 31194, grade 6)*
          - retire l'état «En Laisse» (6290) — cibles : tous ; si la cible a l'état «En Laisse» (6290) ; zone : toute la carte
          - retire les effets du sort «Laisse Spirituelle» (31194) — cibles : tous ; si la cible a l'état «En Laisse» (6290) ; zone : toute la carte
      - le lanceur lance le sort «Laisse Spirituelle» (31194, grade 5) — cibles : alliés (hors lanceur), ennemis ; déclenchement : quand le porteur est déplacé / quand le porteur est téléporté / quand le porteur gagne l'état «Porté» (8) / quand le porteur perd l'état «Porté» (8) / quand le porteur passe un portail (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Laisse Spirituelle» (id 31194, grade 5)*
          - retire l'état «En Laisse» (6290) — cibles : tous ; si la cible a l'état «En Laisse» (6290)
          - retire les effets du sort «Laisse Spirituelle» (31194) — cibles : tous ; si la cible a l'état «En Laisse» (6290)
      - applique l'état «En Laisse» (6290) — cibles : alliés (hors lanceur), ennemis ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Laisse Spirituelle» (31194, grade 2) — cibles : lanceur ; déclenchement : immédiat / quand le lanceur de l'effet dépense des PM (CMPARR, sens déduit) (buff 1 t.) ; indésenvoûtable
        - *Sous-sort «Laisse Spirituelle» (id 31194, grade 2)*
          - Suit le lanceur — cibles : alliés (hors lanceur), ennemis ; si la cible a l'état «En Laisse» (6290) ; zone : toute la carte
  - le lanceur lance le sort «Laisse Spirituelle» (31194, grade 3) — cibles : lanceur
    - *Sous-sort «Laisse Spirituelle» (id 31194, grade 3)*
      - le lanceur lance le sort «Laisse Spirituelle» (31194, grade 6) — cibles : lanceur ; déclenchement : quand le porteur est déplacé / quand le porteur est téléporté / quand le porteur gagne l'état «Porté» (8) / quand le porteur perd l'état «Porté» (8) / quand le porteur passe un portail / fin de tour du porteur (buff 1 t.) ; indésenvoûtable
        - (sous-sort «Laisse Spirituelle» 31194 g6 déjà détaillé plus haut)
      - le lanceur lance le sort «Laisse Spirituelle» (31194, grade 4) — cibles : invocations alliées non statiques ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
        - *Sous-sort «Laisse Spirituelle» (id 31194, grade 4)*
          - le lanceur lance le sort «Laisse Spirituelle» (31194, grade 5) — cibles : invocations alliées non statiques ; si la cible est le lanceur ou une de ses invocations ; déclenchement : quand le porteur est déplacé / quand le porteur est téléporté / quand le porteur gagne l'état «Porté» (8) / quand le porteur perd l'état «Porté» (8) / quand le porteur passe un portail (buff 1 t.) ; indésenvoûtable
            - (sous-sort «Laisse Spirituelle» 31194 g5 déjà détaillé plus haut)
          - applique l'état «En Laisse» (6290) — cibles : invocations alliées non statiques ; si la cible est le lanceur ou une de ses invocations ; 1 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Laisse Spirituelle» (31194, grade 2) — cibles : lanceur ; déclenchement : immédiat / quand le lanceur de l'effet dépense des PM (CMPARR, sens déduit) (buff 1 t.) ; indésenvoûtable
        - (sous-sort «Laisse Spirituelle» 31194 g2 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA en ligne : la cible suit l'Osamodas à chaque PM dépensé ce tour (sur soi : toutes ses invocations). Permet de traîner un ennemi ou d'emmener ses créatures.
- Tags : `placement`, `control`

#### 17B. Relais Spirituel (id 31130)

- **2 PA** · PO 0–5 (non modifiable) · LdV requise · 2/tour · CC 0 %
- Grades : g1 niv.175 (grade utilisé : 1).
- Description du jeu : « Échange de position avec une invocation du lanceur et lui applique l'état Relais : • Les prochains échanges se feront entre l'invocation dans l'état et la prochaine invocation ciblée. Les échanges ne s'appliquent que si les invocations sont à 5 cases ou moins du lanceur. »
- Effets (infobulle, valeurs de base) :
  - Échange de positions — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations
  - applique l'état «Relais» (6291) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; 2 tour(s) ; indésenvoûtable
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - le lanceur lance le sort «Relais Spirituel» (31195, grade 1) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si le lanceur a l'état «Relais Spirituel (Osamodas)» (6292)
    - *Sous-sort «Relais Spirituel» (id 31195, grade 1)*
      - le lanceur lance le sort «Relais Spirituel» (31196, grade 1) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais» (6291)
        - *Sous-sort «Relais Spirituel» (id 31196, grade 1)*
          - applique l'état «Relais Spirituel (Osamodas)» (6292) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
          - «Relais Spirituel» : +1 Portée minimale — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
      - retire les effets du sort «Relais Spirituel» (31195) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais» (6291)
      - Échange de positions — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations
      - le lanceur lance le sort «Relais Spirituel» (31195, grade 2) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; si la cible n'a pas l'état «Relais» (6291) ; déclenchement : à la mort du porteur (buff 2 t.) ; indésenvoûtable
        - *Sous-sort «Relais Spirituel» (id 31195, grade 2)*
          - le lanceur lance le sort «Relais Spirituel» (31196, grade 1) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais» (6291)
            - (sous-sort «Relais Spirituel» 31196 g1 déjà détaillé plus haut)
      - le lanceur lance le sort «Relais Spirituel» (31195, grade 2) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; si la cible n'a pas l'état «Relais» (6291) ; effet différé de 2 tour(s)
        - (sous-sort «Relais Spirituel» 31195 g2 déjà détaillé plus haut)
      - applique l'état «Relais» (6291) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; si la cible n'a pas l'état «Relais» (6291) ; 2 tour(s) ; indésenvoûtable
      - le lanceur lance le sort «Relais Spirituel» (31196, grade 2) — cibles : lanceur ; si la cible a l'état «Relais Spirituel (Osamodas)» (6292)
        - *Sous-sort «Relais Spirituel» (id 31196, grade 2)*
          - retire les effets du sort «Relais Spirituel» (31196) — cibles : lanceur
  - le lanceur lance le sort «Relais Spirituel» (31195, grade 3) — cibles : lanceur, invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si le lanceur n'a pas l'état «Relais Spirituel (Osamodas)» (6292) ; si la cible n'a pas l'état «Relais» (6291)
    - *Sous-sort «Relais Spirituel» (id 31195, grade 3)*
      - applique l'état «Relais Spirituel (cible)» (6294) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; 1 tour(s) ; indésenvoûtable
      - la cible lance le sort «Relais Spirituel» (31195, grade 4) — cibles : lanceur
        - *Sous-sort «Relais Spirituel» (id 31195, grade 4)*
          - applique l'état «Relais Spirituel (portée)» (6293) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais» (6291) ; zone : cercle de taille 5 ; 1 tour(s) ; indésenvoûtable
          - applique l'état «Relais Spirituel (portée)» (6293) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais Spirituel (cible)» (6294) ; zone : cercle de taille 5 ; 1 tour(s) ; indésenvoûtable
      - la cible lance le sort «Relais Spirituel» (31195, grade 5) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais» (6291) ; zone : toute la carte
        - *Sous-sort «Relais Spirituel» (id 31195, grade 5)*
          - Échange de positions — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais Spirituel (portée)» (6293) ; si le lanceur a l'état «Relais Spirituel (portée)» (6293) ; zone : toute la carte
          - retire les effets du sort «Relais Spirituel» (31195) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais Spirituel (portée)» (6293) ; si le lanceur n'a pas l'état «Relais Spirituel (portée)» (6293) ; zone : toute la carte
      - la cible lance le sort «Relais Spirituel» (31195, grade 6) — cibles : lanceur
        - *Sous-sort «Relais Spirituel» (id 31195, grade 6)*
          - le lanceur lance le sort «Relais Spirituel» (31195, grade 7) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais Spirituel (portée)» (6293) ; si la cible n'a pas l'état «Relais» (6291) ; zone : toute la carte
            - *Sous-sort «Relais Spirituel» (id 31195, grade 7)*
              - retire les effets du sort «Relais Spirituel» (31195) — cibles : alliés (lanceur inclus) ; si la cible est le lanceur ou une de ses invocations ; si la cible a l'état «Relais Spirituel (portée)» (6293) ; zone : toute la carte
              - le lanceur lance le sort «Relais Spirituel» (31195, grade 2) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; déclenchement : à la mort du porteur (buff 2 t.) ; indésenvoûtable
                - (sous-sort «Relais Spirituel» 31195 g2 déjà détaillé plus haut)
              - le lanceur lance le sort «Relais Spirituel» (31195, grade 2) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; effet différé de 2 tour(s)
                - (sous-sort «Relais Spirituel» 31195 g2 déjà détaillé plus haut)
              - applique l'état «Relais» (6291) — cibles : alliés (hors lanceur) ; si la cible est le lanceur ou une de ses invocations ; 2 tour(s) ; indésenvoûtable
              - le lanceur lance le sort «Relais Spirituel» (31196, grade 1) — cibles : lanceur ; si la cible a l'état «Relais Spirituel (portée)» (6293) ; si la cible n'a pas l'état «Relais» (6291)
                - (sous-sort «Relais Spirituel» 31196 g1 déjà détaillé plus haut)
  - le lanceur lance le sort «Relais Spirituel» (31195, grade 1) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si le lanceur n'a pas l'état «Relais Spirituel (Osamodas)» (6292) ; si la cible a l'état «Relais» (6291)
    - (sous-sort «Relais Spirituel» 31195 g1 déjà détaillé plus haut)
- **Rôle tactique** : 2 PA : échange avec une de ses invocations puis échanges en chaîne via l'état Relais (≤ 5 cases).
- Tags : `mobility`, `summon_support`

### Paire 18 : Ventritofu / Craquolosse

> Choix : Craquolosse (3 PI, tank Terre −3 PM, +8 % rés.) ; Ventritofu (2 PI) mobile.

#### 18A. Ventritofu (id 31126)

- **4 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 2 t. · CC 0 %
- Grades : g1 niv.70 ; g2 niv.137 (grade utilisé : 2).
- Description du jeu : « Invoque un Ventritofu maîtrisable qui peut occasionner des dommages Air, augmenter la Fuite, se téléporter, téléporter symétriquement des entités, repousser et se rapprocher. »
- Effets (infobulle, valeurs de base) :
  - invoque «Ventritofu» (8071, grade 2)
- **Rôle tactique** : Invoque un Ventritofu (2 PI, 4 PA 6 PM) : téléportation + rotation symétrique en carré, +40 Fuite, ruée + repousse.
- Tags : `summon`, `mobility`, `air`

#### 18B. Craquolosse (id 31149)

- **5 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 3 t. · CC 0 %
- Grades : g1 niv.180 (grade utilisé : 1).
- Description du jeu : « Invoque un Craquolosse maîtrisable qui peut occasionner des dommages Terre, attirer, retirer des PM et augmenter les résistances. »
- Effets (infobulle, valeurs de base) :
  - invoque «Craquolosse» (8078, grade 2)
- **Rôle tactique** : Invoque un Craquolosse (3 PI, 2 PM, 40 % rés. Terre/Neutre) : −3 PM esquivables à distance, +8 % résistances aux alliés en croix, attire en cercle 2.
- Tags : `summon`, `tank`, `mp_removal`, `earth`

### Paire 19 : Bouflourd / Crocoléreux

> Choix : Crocoléreux (3 PI : armure, −CC, ×80 % soins reçus) ; Bouflourd (2 PI, ×90 % dommages subis en zone).

#### 19A. Bouflourd (id 31127)

- **4 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 2 t. · CC 0 %
- Grades : g1 niv.75 ; g2 niv.142 (grade utilisé : 2).
- Description du jeu : « Invoque un Bouflourd maîtrisable qui peut occasionner des dommages Terre, réduire les dommages subis, se rapprocher et attirer. »
- Effets (infobulle, valeurs de base) :
  - invoque «Bouflourd» (8073, grade 2)
- **Rôle tactique** : Invoque un Bouflourd (2 PI) : Pacage = dommages subis ×90 % aux alliés autour de lui, vol Terre et attire ; Charge.
- Tags : `summon`, `tank`, `protection`, `earth`

#### 19B. Crocoléreux (id 31150)

- **5 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 3 t. · CC 0 %
- Grades : g1 niv.185 (grade utilisé : 1).
- Description du jeu : « Invoque un Crocoléreux maîtrisable qui peut occasionner des dommages Eau, retirer des Critiques et réduire les soins et les dommages reçus. »
- Effets (infobulle, valeurs de base) :
  - invoque «Crocoléreux» (8080, grade 2)
- **Rôle tactique** : Invoque un Crocoléreux (3 PI) : −15 % CC, soins reçus ×80 % aux ennemis, armure fixe (valeur 7 ×(niv/20+1)) aux alliés en cercle 2.
- Tags : `summon`, `debuff`, `protection`, `water`

### Paire 20 : Crapipaud / Sulfénix

> Choix : Sulfénix (3 PI, soin et téléportation) ; Crapipaud (2 PI, poisons Eau).

#### 20A. Crapipaud (id 31128)

- **4 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 2 t. · CC 0 %
- Grades : g1 niv.80 ; g2 niv.147 (grade utilisé : 2).
- Description du jeu : « Invoque un Crapipaud maîtrisable qui peut occasionner des dommages et appliquer un poison Eau, augmenter les PM, repousser et se téléporter symétriquement. »
- Effets (infobulle, valeurs de base) :
  - invoque «Crapipaud» (8075, grade 2)
- **Rôle tactique** : Invoque un Crapipaud (2 PI) : poison Eau de fin de tour en cercle 2 + repousse, téléportation symétrique +1 PM aux alliés.
- Tags : `summon`, `poison`, `water`

#### 20B. Sulfénix (id 31151)

- **5 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 3 t. · CC 0 %
- Grades : g1 niv.190 (grade utilisé : 1).
- Description du jeu : « Invoque un Sulfénix maîtrisable qui peut occasionner des dommages Feu, soigner et se téléporter. »
- Effets (infobulle, valeurs de base) :
  - invoque «Sulfénix» (8081, grade 2)
- **Rôle tactique** : Invoque un Sulfénix (3 PI, 5 PM) : dégâts/soins Feu, Renaissance (soin et téléportation au tour suivant), Danse Flammes.
- Tags : `summon`, `heal`, `fire`

### Paire 21 : Dragonnet / Scarafoudre

> Choix : Scarafoudre (3 PI, boucliers) ; Dragonnet (2 PI, +125 Puissance aux alliés).

#### 21A. Dragonnet (id 31129)

- **4 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 2 t. · CC 0 %
- Grades : g1 niv.85 ; g2 niv.152 (grade utilisé : 2).
- Description du jeu : « Invoque un Dragonnet maîtrisable qui peut occasionner des dommages Feu, augmenter la Puissance et repousser. »
- Effets (infobulle, valeurs de base) :
  - invoque «Dragonnet» (8077, grade 2)
- **Rôle tactique** : Invoque un Dragonnet (2 PI) : +125 Puissance pour lui (Embrasement) ou pour les alliés dans son cône (Souffle du Dragon).
- Tags : `summon`, `buff_power`, `fire`

#### 21B. Scarafoudre (id 31148)

- **5 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance 3 t. · CC 0 %
- Grades : g1 niv.195 (grade utilisé : 1).
- Description du jeu : « Invoque un Scarafoudre maîtrisable qui peut occasionner des dommages Air, se téléporter, retirer des chances de Critique et appliquer du bouclier. »
- Effets (infobulle, valeurs de base) :
  - invoque «Scarafoudre» (8079, grade 2)
- **Rôle tactique** : Invoque un Scarafoudre (3 PI) : boucliers 100 % du niveau en carré 1 (Scarapace), −25 % CC, téléportation vers une cible.
- Tags : `summon`, `shield`, `air`

### Paire 22 : Esprit Glouton / Esprit Facétieux

> Choix : Gobgob Glouton (interception, dommages selon PV) ; Gobgob Facétieux (copie de créature, désenvoûtement −1 tour).

#### 22A. Esprit Glouton (id 31131)

- **3 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · aucune limite · CC 0 % · critère d'état `HS!6323`
- Grades : g1 niv.90 ; g2 niv.157 (grade utilisé : 2).
- Description du jeu : « Invoque un Gobgob Glouton contrôlable qui peut occasionner des dommages Neutre selon sa vie, tuer des invocations alliés pour augmenter sa Vitalité et ses PM, intercepter les dommages d'un allié et se téléporter en créant des illusions. Le temps de relance est fixé à la mort du Gobgob. »
- Effets (infobulle, valeurs de base) :
  - invoque «Gobgob Glouton» (8082, grade 2) [effet 1011: invocation statique]
  - «Esprit Glouton» : relance fixée à 2 tour(s) — cibles : lanceur
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Gobgob Glouton» (8082, grade 2) [effet 1011: invocation statique]
- **Rôle tactique** : Invoque le Gobgob Glouton (contrôlable, 1 PI) : intercepte les dégâts d'un allié, frappe en Neutre selon ses PV, peut dévorer une créature pour grossir.
- Tags : `summon`, `interception`, `damage`, `neutral`

#### 22B. Esprit Facétieux (id 31153)

- **3 PA** · PO 1–2 (non modifiable) · LdV requise, case libre requise · relance initiale 1 t. · CC 0 % · critère d'état `HS!6322`
- Grades : g1 niv.200 (grade utilisé : 1).
- Description du jeu : « Invoque un Gobgob Facétieux contrôlable qui peut échanger de positions, réduire la durée des effets et se sacrifier pour copier une invocation Osamodas. Le temps de relance est fixé à la mort du Gobgob. »
- Effets (infobulle, valeurs de base) :
  - invoque «Gobgob Facétieux» (8083, grade 1) [effet 1011: invocation statique]
  - «Esprit Facétieux» : relance fixée à 2 tour(s) — cibles : lanceur
- Mécanique réelle (effets exécutés par le serveur, sous-sorts développés) :
  - invoque «Gobgob Facétieux» (8083, grade 1) [effet 1011: invocation statique]
- **Rôle tactique** : Invoque le Gobgob Facétieux (contrôlable, 3 PI) : échange, −1 tour aux effets d'une cible, se sacrifie pour dupliquer une créature.
- Tags : `summon`, `utility`, `dispel`

## Invocations de la classe

Toutes les créatures Osamodas utilisent un emplacement d'invocation et coûtent `summonCost` points. Le grade invoqué au
niveau 200 est le plus haut (Tofu/Bouftou/Crapipou/Dragoune g3, créatures à 2 PI g2, à 3 PI g1/g2 selon le sort).
« Bonus hérités » = pourcentage des caractéristiques de l'Osamodas (voir mécanique 2). Les sorts listés sont ceux que
la créature peut lancer (IA ou contrôle via Maîtrise des Invocations).

#### Tofu (monstre 8070)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 3 (invoqué par les sorts de la classe) : PA 4, PM 8, PV de base 0, rés. % Terre 10 / Feu 0 / Eau 10 / Air 20 / Neutre 10, bonus hérités de l'invocateur (en %) {'lifePoints': 50, 'wisdom': 50, 'agility': 50, 'tackleEvade': 50, 'bonusAirDamage': 50}
- Variation par grade : g1 PA4/PM6, g2 PA4/PM7, g3 PA4/PM8
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort passif lancé à l'apparition (spell-level 84115, sort 31971 «Tofu») :
  - applique l'état «Intacleur» (95) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - applique l'état «Intaclable» (96) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
- Sort «Béco-béco» (id 31154) : 2 PA, PO 1–2, LdV, CC 5 %
  - 21 à 23 dommages Air (CC : 25 à 28 dommages Air)
  - -40 Tacle — 2 tour(s)
- Sort «Bisou Béco» (id 31156) : 2 PA, PO 1–4, en ligne, LdV, CC 10 %
  - Recule de 1 case
  - 22 à 25 vol Air (CC : 26 à 30 vol Air) — cibles : ennemis
  - 22 à 25 soins Air (CC : 26 à 30 soins Air) — cibles : alliés (lanceur inclus)
  - Repousse de 2 cases

#### Ventritofu (monstre 8071)

- Utilise un emplacement d'invocation : oui (coût 2 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 2 (invoqué par les sorts de la classe) : PA 4, PM 6, PV de base 0, rés. % Terre 20 / Feu 10 / Eau 20 / Air 30 / Neutre 20, bonus hérités de l'invocateur (en %) {'lifePoints': 75, 'wisdom': 75, 'agility': 75, 'tackleEvade': 75, 'bonusAirDamage': 75}
- Variation par grade : g1 PA4/PM5, g2 PA4/PM6
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort passif lancé à l'apparition (spell-level 84116, sort 31972 «Ventritofu») :
  - applique l'état «Intacleur» (95) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - applique l'état «Intaclable» (96) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
- Sort «Bécompresseur» (id 31155) : 2 PA, PO 1–2, sans LdV, 1/tour, critère `HS!7`, CC 10 %
  - Téléporte sur la case ciblée — cibles : lanceur
  - Téléportation symétrique — zone : carré de taille 1
  - 22 à 25 vol Air (CC : 26 à 30 vol Air) — cibles : ennemis ; zone : carré de taille 1
  - 40 Fuite — cibles : lanceur, alliés (lanceur inclus) ; zone : carré de taille 1 ; 1 tour(s)
- Sort «Ventripoussée» (id 31157) : 2 PA, PO 1–4, en ligne, LdV, CC 5 %
  - Avance de 3 cases
  - 21 à 23 dommages Air (CC : 25 à 28 dommages Air) — cibles : ennemis
  - Repousse de 2 cases

#### Bouftou (monstre 8072)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 3 (invoqué par les sorts de la classe) : PA 4, PM 4, PV de base 0, rés. % Terre 20 / Feu 10 / Eau 10 / Air 0 / Neutre 20, bonus hérités de l'invocateur (en %) {'lifePoints': 50, 'strength': 50, 'wisdom': 50, 'tackleBlock': 50, 'bonusEarthDamage': 50}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Bouffe-tout» (id 31158) : 2 PA, PO 1–2, LdV, CC 5 %
  - Avance de 1 case
  - 20 à 22 dommages Terre (CC : 24 à 26 dommages Terre) — cibles : ennemis
  - -40 Fuite — cibles : ennemis ; 2 tour(s)
- Sort «Saute-bouftou» (id 31159) : 2 PA, PO 1–2, en ligne, LdV, critère `HS!7`, CC 10 %
  - Téléportation symétrique par rapport à la cible
  - 24 à 27 vol Terre (CC : 29 à 32 vol Terre) — cibles : ennemis
  - 24 à 27 soins Terre (CC : 29 à 32 soins Terre) — cibles : alliés (lanceur inclus)

#### Bouflourd (monstre 8073)

- Utilise un emplacement d'invocation : oui (coût 2 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 2 (invoqué par les sorts de la classe) : PA 4, PM 3, PV de base 0, rés. % Terre 30 / Feu 20 / Eau 20 / Air 10 / Neutre 30, bonus hérités de l'invocateur (en %) {'lifePoints': 75, 'strength': 75, 'wisdom': 75, 'tackleBlock': 75, 'bonusEarthDamage': 75}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Pacage» (id 31160) : 2 PA, PO 0–0, sans LdV, 1/tour, CC 10 %
  - Dommages subis x90% — cibles : lanceur, alliés (lanceur inclus) ; zone : cercle de taille 3 (à partir de 1) ; déclenchement : quand le porteur subit des dommages (buff 1 t.)
  - 24 à 27 vol Terre (CC : 29 à 32 vol Terre) — cibles : ennemis ; zone : cercle de taille 3 (à partir de 1)
  - Attire de 2 cases — zone : cercle de taille 3 (à partir de 1)
- Sort «Charge du Bouflourd» (id 31161) : 2 PA, PO 1–5, en ligne, LdV, CC 5 %
  - Avance de 4 cases
  - 20 à 22 dommages Terre (CC : 24 à 26 dommages Terre) — cibles : ennemis

#### Crapipou (monstre 8074)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 3 (invoqué par les sorts de la classe) : PA 4, PM 5, PV de base 0, rés. % Terre 0 / Feu 10 / Eau 20 / Air 10 / Neutre 10, bonus hérités de l'invocateur (en %) {'lifePoints': 50, 'wisdom': 50, 'chance': 50, 'tackleEvade': 50, 'bonusWaterDamage': 50}
- Variation par grade : g1 PA4/PM3, g2 PA4/PM4, g3 PA4/PM5
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Crapoison» (id 31162) : 2 PA, PO 1–4, LdV, CC 5 %
  - -2 Portée — 1 tour(s)
  - 18 à 20 dommages Eau (CC : 22 à 24 dommages Eau) — déclenchement : début de tour du porteur (buff 1 t.)
- Sort «Croassement» (id 31164) : 2 PA, PO 0–5, LdV, CC 10 %
  - Recule de 2 cases — cibles : ennemis
  - 23 à 26 vol Eau (CC : 28 à 31 vol Eau) — cibles : ennemis
  - 23 à 26 soins Eau (CC : 28 à 31 soins Eau) — cibles : alliés (hors lanceur)
  - 2 Portée — cibles : alliés (lanceur inclus) ; 2 tour(s)

#### Crapipaud (monstre 8075)

- Utilise un emplacement d'invocation : oui (coût 2 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 2 (invoqué par les sorts de la classe) : PA 4, PM 4, PV de base 0, rés. % Terre 10 / Feu 20 / Eau 30 / Air 20 / Neutre 20, bonus hérités de l'invocateur (en %) {'lifePoints': 75, 'wisdom': 75, 'chance': 75, 'tackleEvade': 75, 'bonusWaterDamage': 75}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Crapogive» (id 31163) : 2 PA, PO 0–4, LdV, 1/tour, CC 10 %
  - 23 à 26 dommages Eau (CC : 28 à 31 dommages Eau) — cibles : ennemis ; zone : cercle de taille 2
  - 23 à 26 dommages Eau (CC : 28 à 31 dommages Eau) — cibles : ennemis ; zone : cercle de taille 2 ; déclenchement : fin de tour du porteur (buff 1 t.)
  - Repousse de 2 cases — zone : cercle de taille 2 (à partir de 1)
- Sort «Crapobatie» (id 31165) : 2 PA, PO 1–2, LdV, critère `HS!7`, CC 5 %
  - Téléporte sur la case ciblée — cibles : alliés (hors lanceur), ennemis ; si le lanceur n'a pas l'état «Pesanteur» (7)
  - le lanceur lance le sort «Crapobatie» (32167, grade 1) — cibles : alliés (hors lanceur), ennemis
    - *Sous-sort «Crapobatie» (id 32167, grade 1)*
      - Téléportation symétrique par rapport à la cible — cibles : lanceur
  - 21 à 24 vol Eau (CC : 25 à 29 vol Eau) — cibles : ennemis ; zone : croix de taille 1
  - 1 PM — cibles : lanceur, alliés (lanceur inclus) ; zone : croix de taille 1 ; 1 tour(s)

#### Dragoune (monstre 8076)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 3 (invoqué par les sorts de la classe) : PA 4, PM 4, PV de base 0, rés. % Terre 10 / Feu 20 / Eau 0 / Air 10 / Neutre 10, bonus hérités de l'invocateur (en %) {'lifePoints': 50, 'wisdom': 50, 'intelligence': 50, 'tackleBlock': 50, 'bonusFireDamage': 50}
- Variation par grade : g1 PA4/PM3, g2 PA4/PM4, g3 PA4/PM4
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Dracoflammes» (id 31166) : 2 PA, PO 1–5, LdV, CC 5 %
  - 19 à 21 dommages Feu (CC : 23 à 25 dommages Feu)
  - -100 Puissance — 2 tour(s)
- Sort «Dracorage» (id 31168) : 2 PA, PO 1–2, LdV, critère `HS!7`, CC 10 %
  - Échange de positions
  - 25 à 28 vol Feu (CC : 30 à 34 vol Feu) — cibles : ennemis
  - 25 à 28 soins Feu (CC : 30 à 34 soins Feu) — cibles : alliés (lanceur inclus)

#### Dragonnet (monstre 8077)

- Utilise un emplacement d'invocation : oui (coût 2 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 2 (invoqué par les sorts de la classe) : PA 4, PM 4, PV de base 0, rés. % Terre 20 / Feu 30 / Eau 10 / Air 20 / Neutre 20, bonus hérités de l'invocateur (en %) {'lifePoints': 75, 'wisdom': 75, 'intelligence': 75, 'tackleBlock': 75, 'bonusFireDamage': 75}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Embrasement» (id 31167) : 2 PA, PO 0–4, LdV, CC 5 %
  - 21 à 24 dommages Feu (CC : 25 à 29 dommages Feu) — cibles : alliés (hors lanceur), ennemis
  - 125 Puissance — cibles : lanceur ; 2 tour(s)
- Sort «Souffle du Dragon» (id 31169) : 2 PA, PO 1–6, en ligne, LdV, 1/tour, CC 10 %
  - 25 à 28 vol Feu (CC : 30 à 34 vol Feu) — cibles : ennemis ; zone : cône de taille 1
  - 125 Puissance — cibles : alliés (lanceur inclus) ; zone : cône de taille 1 ; 2 tour(s)
  - Repousse de 1 case — zone : cône de taille 1

#### Craquolosse (monstre 8078)

- Utilise un emplacement d'invocation : oui (coût 3 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Le sort demande le grade [2] mais le monstre n'a que 1 grade(s) : on retient le grade 1 (INCERTAIN — le serveur borne probablement au grade maximal).
- Grade 1 (invoqué par les sorts de la classe) : PA 4, PM 2, PV de base 0, rés. % Terre 40 / Feu 30 / Eau 30 / Air 20 / Neutre 40, bonus hérités de l'invocateur (en %) {'lifePoints': 100, 'strength': 100, 'wisdom': 100, 'tackleBlock': 100, 'bonusEarthDamage': 100}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Fronde Rocheuse» (id 31174) : 2 PA, PO 1–5, LdV, CC 5 %
  - 18 à 20 dommages Terre (CC : 22 à 24 dommages Terre)
  - -3 PM (esquivable) — 1 tour(s) ; désenvoûtement fort uniquement
- Sort «Cœur de Pierre» (id 31175) : 2 PA, PO 1–1, sans LdV, 2/tour, CC 5 %
  - 26 à 29 dommages Terre (CC : 31 à 35 dommages Terre) — cibles : ennemis ; zone : croix de taille 1
  - 8% Résistance — cibles : lanceur, alliés (lanceur inclus) ; zone : croix de taille 1 ; 2 tour(s)
- Sort «Écrasement Colossal» (id 32198) : 2 PA, PO 1–1, sans LdV, 1/tour, CC 10 %
  - 29 à 32 dommages Terre (CC : 34 à 38 dommages Terre) — cibles : ennemis ; zone : cercle de taille 2
  - Attire de 1 case — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 1 (à partir de 1)
  - Attire de 2 cases — cibles : alliés (hors lanceur), ennemis ; zone : cercle de taille 2 (à partir de 2)

#### Scarafoudre (monstre 8079)

- Utilise un emplacement d'invocation : oui (coût 3 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Le sort demande le grade [2] mais le monstre n'a que 1 grade(s) : on retient le grade 1 (INCERTAIN — le serveur borne probablement au grade maximal).
- Grade 1 (invoqué par les sorts de la classe) : PA 4, PM 4, PV de base 0, rés. % Terre 30 / Feu 20 / Eau 30 / Air 40 / Neutre 30, bonus hérités de l'invocateur (en %) {'lifePoints': 100, 'wisdom': 100, 'agility': 100, 'tackleBlock': 100, 'bonusAirDamage': 100}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Scarapace» (id 31178) : 2 PA, PO 0–0, sans LdV, 1/tour, CC 10 %
  - bouclier de 100% du niveau du lanceur — cibles : lanceur, alliés (hors lanceur) ; zone : carré de taille 1 ; 2 tour(s)
  - 25 à 28 dommages Air (CC : 30 à 34 dommages Air) — cibles : ennemis ; zone : carré de taille 1
- Sort «Scarafusée» (id 31179) : 2 PA, PO 1–6, en ligne, sans LdV, critère `HS!7`, CC 5 %
  - Téléporte sur la case ciblée — zone : ligne depuis le lanceur de 1 case(s) (p2=63), s'arrête à la 1re cible
  - 21 à 23 dommages Air (CC : 25 à 28 dommages Air) — cibles : ennemis ; zone : ligne depuis le lanceur de 1 case(s) (p2=63), s'arrête à la 1re cible
  - -25% Critique — cibles : ennemis ; zone : ligne depuis le lanceur de 1 case(s) (p2=63), s'arrête à la 1re cible ; 2 tour(s)
- Sort «Scaratonnerre» (id 32222) : 2 PA, PO 0–5, LdV, 1/tour, CC 10 %
  - le lanceur lance le sort «Scaratonnerre» (32223, grade 1) — cibles : ennemis ; zone : croix de taille 1
    - *Sous-sort «Scaratonnerre» (id 32223, grade 1)*
      - 20 Fuite — cibles : lanceur ; 1 tour(s)
  - 24 à 27 dommages Air (CC : 28 à 31 dommages Air) — cibles : ennemis ; zone : croix de taille 1

#### Crocoléreux (monstre 8080)

- Utilise un emplacement d'invocation : oui (coût 3 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Le sort demande le grade [2] mais le monstre n'a que 1 grade(s) : on retient le grade 1 (INCERTAIN — le serveur borne probablement au grade maximal).
- Grade 1 (invoqué par les sorts de la classe) : PA 4, PM 3, PV de base 0, rés. % Terre 20 / Feu 30 / Eau 40 / Air 40 / Neutre 30, bonus hérités de l'invocateur (en %) {'lifePoints': 100, 'wisdom': 100, 'chance': 100, 'tackleBlock': 100, 'bonusWaterDamage': 100}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Crocs Coléreux» (id 31180) : 2 PA, PO 1–2, LdV, 2/tour, CC 5 %
  - 20 à 22 dommages Eau (CC : 24 à 26 dommages Eau) — cibles : ennemis ; zone : croix de taille 1
  - -15% Critique — cibles : ennemis ; zone : croix de taille 1 ; 1 tour(s)
- Sort «Crocolère» (id 32225) : 2 PA, PO 1–3, LdV, CC 10 %
  - 26 à 29 dommages Eau (CC : 30 à 33 dommages Eau)
  - Soins reçus x80% — déclenchement : quand le porteur est soigné (buff 1 t.)
- Sort «Trombe Bourbeuse» (id 31182) : 2 PA, PO 0–0, sans LdV, 1/tour, CC 10 %
  - armure: réduit les dommages subis (effet 265, d1=0 d2=0 valeur=7) — cibles : lanceur, alliés (lanceur inclus) ; zone : cercle de taille 2 (à partir de 1) ; déclenchement : quand le porteur subit des dommages (buff 1 t.)
  - 23 à 26 dommages Eau (CC : 28 à 31 dommages Eau) — cibles : ennemis ; zone : cercle de taille 2 (à partir de 1)

#### Sulfénix (monstre 8081)

- Utilise un emplacement d'invocation : oui (coût 3 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Le sort demande le grade [2] mais le monstre n'a que 1 grade(s) : on retient le grade 1 (INCERTAIN — le serveur borne probablement au grade maximal).
- Grade 1 (invoqué par les sorts de la classe) : PA 4, PM 5, PV de base 0, rés. % Terre 30 / Feu 40 / Eau 20 / Air 30 / Neutre 30, bonus hérités de l'invocateur (en %) {'lifePoints': 100, 'wisdom': 100, 'intelligence': 100, 'tackleEvade': 100, 'tackleBlock': 100, 'bonusFireDamage': 100}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort «Sulfuria» (id 31183) : 2 PA, PO 0–5, LdV, CC 5 %
  - 19 à 21 dommages Feu (CC : 23 à 25 dommages Feu) — cibles : alliés (hors lanceur), ennemis
  - 20 Soins — cibles : lanceur ; 1 tour(s)
- Sort «Renaissance» (id 31184) : 2 PA, PO 0–0, sans LdV, 1/tour, CC 10 %
  - 24 à 27 dommages Feu (CC : 29 à 32 dommages Feu) — cibles : ennemis ; zone : cercle de taille 2 (à partir de 1)
  - la cible lance sur la case le sort «Renaissance» (31185, grade 1) (CC : la cible lance sur la case le sort «Renaissance» (31185, grade 2)) — cibles : lanceur ; effet différé de 1 tour(s)
    - *Sous-sort «Renaissance» (id 31185, grade 1)*
      - 24 à 27 soins Feu — cibles : lanceur
      - Téléporte ou échange de positions — cibles : tous ; si la cible n'a pas l'état «Pesanteur» (7)
  - pose un glyphe-aura «Renaissance» (31185, grade 1) — cibles : lanceur ; si la cible est le monstre «monstre#50000» (50000) ; 1 tour(s)
    - (sous-sort «Renaissance» 31185 g1 déjà détaillé plus haut)
- Sort «Danse Flammes» (id 32211) : 2 PA, PO 2–5, en ligne, sans LdV, 1/tour, critère `HS!7`, CC 10 %
  - Téléporte sur la case ciblée
  - 22 à 24 soins Feu (CC : 26 à 29 soins Feu) — cibles : alliés (lanceur inclus) ; zone : ligne depuis le lanceur de 1 case(s) (p2=63), s'arrête à la 1re cible
  - 22 à 24 dommages Feu (CC : 26 à 29 dommages Feu) — cibles : ennemis ; zone : ligne depuis le lanceur de 1 case(s) (p2=63), s'arrête à la 1re cible

#### Gobgob Glouton (monstre 8082)

- Utilise un emplacement d'invocation : oui (coût 1 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 2 (invoqué par les sorts de la classe) : PA 4, PM 6, PV de base 0, rés. % Terre 20 / Feu 20 / Eau 20 / Air 20 / Neutre 20, bonus hérités de l'invocateur (en %) {'lifePoints': 75, 'wisdom': 75, 'tackleBlock': 75}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort passif lancé à l'apparition (spell-level 82646, sort 31320 «Esprit Glouton») :
  - applique l'état «Esprit Glouton» (6323) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; durée infinie ; indésenvoûtable
  - la cible lance le sort «Esprit Glouton» (31320, grade 2) — cibles : lanceur ; déclenchement : à la mort du porteur (buff 63 t.) ; désenvoûtement fort uniquement
    - *Sous-sort «Esprit Glouton» (id 31320, grade 2)*
      - «Esprit Glouton» : relance fixée à 2 tour(s) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
- Sort «Gobgobage» (id 31172) : 2 PA, PO 0–6, en ligne, LdV, 3/tour, CC 5 %
  - Dommages Neutre : 25% PV manquants du lanceur (CC : Dommages Neutre : 30% PV manquants du lanceur) — cibles : ennemis ; si le lanceur a moins de 50% PV
  - Dommages Neutre : 25% PV manquants du lanceur (CC : Dommages Neutre : 30% PV manquants du lanceur) — cibles : alliés (lanceur inclus) ; si la cible n'est ni le lanceur ni une de ses invocations ; si le lanceur a moins de 50% PV
  - Dommages Neutre : 25% PV manquants du lanceur (CC : Dommages Neutre : 30% PV manquants du lanceur) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur a moins de 50% PV
  - Dommages Neutre : 25% PV du lanceur (CC : Dommages Neutre : 30% PV du lanceur) — cibles : ennemis ; si le lanceur a au moins 50% PV
  - Dommages Neutre : 25% PV du lanceur (CC : Dommages Neutre : 30% PV du lanceur) — cibles : alliés (lanceur inclus) ; si la cible n'est ni le lanceur ni une de ses invocations ; si le lanceur a au moins 50% PV
  - Dommages Neutre : 25% PV du lanceur (CC : Dommages Neutre : 30% PV du lanceur) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur a au moins 50% PV
  - le lanceur lance le sort «Gobgobage» (31377, grade 2) — cibles : lanceur, invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est l'un de: «Tofu» (8070), «Ventritofu» (8071), «Bouftou» (8072), «Bouflourd» (8073), «Crapipou» (8074), «Crapipaud» (8075), «Dragoune» (8076), «Dragonnet» (8077), «Craquolosse» (8078), «Scarafoudre» (8079), «Crocoléreux» (8080), «Sulfénix» (8081), «Gobgob Glouton» (8082), «Gobgob Facétieux» (8083)
    - *Sous-sort «Gobgobage» (id 31377, grade 2)*
      - Tue la cible — cibles : lanceur, invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est l'un de: «Tofu» (8070), «Ventritofu» (8071), «Bouftou» (8072), «Bouflourd» (8073), «Crapipou» (8074), «Crapipaud» (8075), «Dragoune» (8076), «Dragonnet» (8077), «Craquolosse» (8078), «Scarafoudre» (8079), «Crocoléreux» (8080), «Sulfénix» (8081), «Gobgob Glouton» (8082), «Gobgob Facétieux» (8083)
      - Taille : +10% — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
      - 50% Vitalité — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
      - -1 PM (non esquivable) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
- Sort «Gobédience» (id 31173) : 2 PA, PO 1–4, LdV, relance 3, CC 0 %
  - applique l'état «Sacrifice» (583) — cibles : personnages alliés, monstres alliés, compagnons alliés ; 1 tour(s)
  - Intercepte les dommages — cibles : personnages alliés, monstres alliés, compagnons alliés ; déclenchement : quand le porteur subit des dommages (buff 1 t.)
  - applique l'état «Sacrifice» (583) — cibles : invocations alliées ; 2 tour(s)
  - Intercepte les dommages — cibles : invocations alliées ; déclenchement : quand le porteur subit des dommages (buff 2 t.)
- Sort «Goberration» (id 31442) : 2 PA, PO 1–4, sans LdV, relance 2, critère `HS!7`, CC 0 %
  - invoque «monstre#3» (3, grade 0)
  - Termine le tour — cibles : lanceur

#### Gobgob Facétieux (monstre 8083)

- Utilise un emplacement d'invocation : oui (coût 3 point(s) d'invocation) · joue son tour : oui · tacle : oui · poussable : oui
- Grade 1 (invoqué par les sorts de la classe) : PA 4, PM 6, PV de base 0, rés. % Terre 20 / Feu 20 / Eau 20 / Air 20 / Neutre 20, bonus hérités de l'invocateur (en %) {'lifePoints': 75, 'wisdom': 75, 'tackleEvade': 75}
- characRatios (donnée brute, sémantique INCERTAINE) : `[]`
- Sort passif lancé à l'apparition (spell-level 82645, sort 31319 «Esprit Facétieux») :
  - applique l'état «Esprit Facétieux» (6322) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte ; durée infinie ; indésenvoûtable
  - la cible lance le sort «Esprit Facétieux» (31319, grade 2) — cibles : lanceur ; déclenchement : à la mort du porteur (buff 63 t.) ; désenvoûtement fort uniquement
    - *Sous-sort «Esprit Facétieux» (id 31319, grade 2)*
      - «Esprit Facétieux» : relance fixée à 2 tour(s) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; zone : toute la carte
  - applique l'état «Intacleur» (95) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
  - applique l'état «Intaclable» (96) — cibles : lanceur ; durée infinie ; désenvoûtement fort uniquement
- Sort «Gobstitution» (id 31170) : 2 PA, PO 1–4, LdV, critère `HS!7`, CC 0 %
  - Échange de positions
- Sort «Gobjection» (id 31171) : 2 PA, PO 0–4, LdV, 2/tour, CC 0 %
  - Durée des effets : -1
- Sort «Gobmutation» (id 31441) : 3 PA, PO 1–4, LdV, 1/tour, critère `HS!8`, CC 0 %
  - la cible lance le sort «Gobmutation» (31378, grade 1) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est l'un de: «Tofu» (8070), «Ventritofu» (8071), «Bouftou» (8072), «Bouflourd» (8073), «Crapipou» (8074), «Crapipaud» (8075), «Dragoune» (8076), «Dragonnet» (8077), «Craquolosse» (8078), «Scarafoudre» (8079), «Crocoléreux» (8080), «Sulfénix» (8081)
    - *Sous-sort «Gobmutation» (id 31378, grade 1)*
      - la cible lance le sort «Gobmutation» (31378, grade 2) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Tofu» (8070) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 2)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 14) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 14)*
              - 1 Invocation — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Tofu» (8070, grade 3) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 3) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Bouftou» (8072) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 3)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 15) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 15)*
              - 1 Invocation — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Bouftou» (8072, grade 3) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 4) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Crapipou» (8074) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 4)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 16) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 16)*
              - 1 Invocation — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Crapipou» (8074, grade 3) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 5) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Dragoune» (8076) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 5)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 17) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 17)*
              - 1 Invocation — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Dragoune» (8076, grade 3) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 6) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Ventritofu» (8071) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 6)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 18) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 18)*
              - 2 Invocations — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Ventritofu» (8071, grade 2) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 7) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Bouflourd» (8073) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 7)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 19) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 19)*
              - 2 Invocations — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Bouflourd» (8073, grade 2) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 8) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Crapipaud» (8075) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 8)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 20) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 20)*
              - 2 Invocations — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Crapipaud» (8075, grade 2) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 9) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Dragonnet» (8077) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 9)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 21) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 21)*
              - 2 Invocations — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Dragonnet» (8077, grade 2) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 10) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Scarafoudre» (8079) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 10)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 22) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 22)*
              - 3 Invocations — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Scarafoudre» (8079, grade 1) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 11) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Craquolosse» (8078) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 11)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 23) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 23)*
              - 3 Invocations — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Craquolosse» (8078, grade 1) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 12) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Crocoléreux» (8080) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 12)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 24) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 24)*
              - 3 Invocations — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Crocoléreux» (8080, grade 1) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur
      - la cible lance le sort «Gobmutation» (31378, grade 13) — cibles : personnages alliés ; si la cible est le lanceur ou une de ses invocations ; si le lanceur est le monstre «Sulfénix» (8081) ; zone : toute la carte
        - *Sous-sort «Gobmutation» (id 31378, grade 13)*
          - le lanceur lance le sort «Gobmutation» (31378, grade 25) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083) ; zone : toute la carte
            - *Sous-sort «Gobmutation» (id 31378, grade 25)*
              - 3 Invocations — cibles : lanceur ; 1 tour(s) ; indésenvoûtable
              - invoque «Sulfénix» (8081, grade 1) — cibles : invocations alliées ; si la cible est le lanceur ou une de ses invocations ; si la cible est le monstre «Gobgob Facétieux» (8083)
              - retire les effets du sort «Gobmutation» (31378) — cibles : lanceur

## L'Osamodas en groupe PvM (niveau 200, 4 personnages)

### Rôles possibles
1. **Soutien soigneur/booster** (le plus demandé en groupe) : Cri du Corbac (+1 PM), Pics du Prespic (+10 % CC), Dents
   du Piranya (+20 Dommages, soin de zone), Cri de l'Ours (+150 Puissance, soin au contact), Piqûre Motivante (+1 PA/+1 PM
   pendant 3 tours sur un allié, +2/+2 sur une invocation), Cœur Sauvage (+15 % soins reçus), Toison d'Or (bouclier
   300 PV de zone), Chant du Phénix (soin de zone).
2. **Invocateur « armée »** : remplit le terrain de créatures (6 PI) qui bloquent les couloirs, tanquent, retirent PM
   (Fronde Rocheuse −3 PM, Discipline) et attaquent ; Martinet pour faire attaquer toutes les créatures d'un coup.
3. **DPS autonome « Pacte Bestial »** : invoque puis sacrifie pour cumuler jusqu'à +x % dommages finaux et +2 PA.
4. **Placeur** : Cravache, Fouet, Discipline, Charge Bestiale, Aéropique, Tourbillon, Laisse Spirituelle, Relais.

### Voie conseillée
- **Eau** (Crapipou/Crapipaud/Crocoléreux, Dents du Piranya soin de zone, Bave du Crapaud −40 dommages, Tourbillon) ou
  **Terre** (Bouftou/Bouflourd/Craquolosse tanks à tacle, Fronde Rocheuse −3 PM, Cri de l'Ours +150 Puissance) en PvM de
  groupe. Feu = soin (Chant du Phénix, Sulfénix) ; Air = mobilité/PM.
- Stats : Vitalité (les créatures héritent des PV), élément principal, Sagesse secondaire, **Invocations (PI) 6**,
  PA 11–12 / PM 5–6, Soins si rôle soigneur, Dommages élémentaires (hérités par les créatures).

### Choix de variantes par rôle
| Paire | Soutien/soin | Armée d'invocations | Pacte Bestial (DPS) |
|---|---|---|---|
| 1 Cri du Corbac / Crocs du Mulou | A | A | B |
| 2 Pics du Prespic / Déplumage | A | A | B |
| 3 Dents du Piranya / Cœur Sauvage | A (ou B pour +15 % soins) | A | B |
| 4 Cri de l'Ours / Bave du Crapaud | A | B | A |
| 5 Fouet / Cravache | A | A | B |
| 6 Tofu / Griffes du Chtigre | A | A | A |
| 7 Bouftou / Serres du Vautour | A | A | A |
| 8 Crapipou / Toison d'Or | B (bouclier) | A | A |
| 9 Dragoune / Morsure du Serpent | A | A | B |
| 10 Cortège Sauvage / Pacte Bestial | A | A | B |
| 11 Piqûre Motivante / Communion Animale | A | A | A |
| 12 Saute-granouille / Tornade de Plumes | A | A | B |
| 13 Souffle Draconique / Frappe du Craqueleur | B | B | B |
| 14 Charge Bestiale / Chant du Phénix | B (soin) | A | B |
| 15 Aéropique / Tourbillon | B | A | A |
| 16 Discipline / Martinet | A | B (burst) | B |
| 17 Laisse Spirituelle / Relais Spirituel | A | B | A |
| 18 Ventritofu / Craquolosse | B (−3 PM, rés.) | B | B |
| 19 Bouflourd / Crocoléreux | A (réduction ×90 %) | B | B |
| 20 Crapipaud / Sulfénix | B (soin) | B | B |
| 21 Dragonnet / Scarafoudre | A (+125 Puissance) | B | B |
| 22 Esprit Glouton / Esprit Facétieux | A (interception) | B | A |

### Rotations types (12 PA / 6 PM, 6 PI)
- **Tour 1 (installation)** : Piqûre Motivante sur le DPS principal (2) → Craquolosse au contact des ennemis (5) →
  Bouftou (3) → Cri du Corbac sur un allié (2, +1 PM à lui et à l'Osamodas). Créatures = 4 PI.
- **Tour 2 (soutien)** : Dents du Piranya sur le groupe (3, soin + 20 Dommages) → Toison d'Or si alliés en cercle 2 (3,
  bouclier 300) → Cri de l'Ours sur l'allié au contact (3, +150 Puissance) → Fouet sur une créature pour lui donner +1 PM (2)
  + 1 PA restant.
- **Tour de burst (Cortège)** : Cortège Sauvage (2, +3 PI, −1 PA) → 3–4 créatures (2–4 PA chacune) → Martinet (3) : toutes
  les créatures attaquent la cible à −50 %. Les créatures meurent au début des deux tours suivants.
- **Pacte Bestial** : Pacte (2, +2 PA) → invoquer une créature à 3 PI (5 PA, sacrifiée : +9 % DF/soins, +30 % de ses PV)
  → sorts de dégâts (Crocs du Mulou 4, Cœur Sauvage 4…).

### Forces / faiblesses
Forces : multiplie les corps sur le terrain (blocage, tacle, interception), soins + gros buffs (PA, PM, Puissance,
Dommages, CC) pour un DPS allié, placement très riche, flexible (4 voies + Gobgobs).
Faiblesses : très complexe à piloter (IA des créatures), créatures fragiles face aux dégâts de zone, PI limités (6),
dégâts directs de l'Osamodas modestes hors Pacte Bestial, soins non applicables à lui-même (sauf vols de vie).

### Synergies
- **Iop / Sram / Crâ / Ouginak** : Piqûre Motivante (+1 PA/+1 PM 3 tours), Cri de l'Ours (+150 Puissance), Pics du Prespic
  (+10 % CC), Dents du Piranya (+20 Dommages) sur le DPS principal ; Laisse Spirituelle pour le replacer.
- **Féca** : créatures + boucliers Féca forment des murs ; Étoile du Berger non transmise aux invocations statiques mais
  bien aux créatures (masques `g`, sauf boucliers Féca).
- **Enutrof** : Boîte à Outils (+3 PA/+3 PM) sur une créature 3 PI ; ennemis immobilisés + créatures qui tapent.
- **Sram** : Laisse Spirituelle / Cravache / Fouet pour amener les ennemis dans les pièges.
- **Eniripsa** : double soin ; l'Osamodas peut alors se concentrer sur les buffs.

## Points incertains (INCERTAIN)

- Valeur de base de la jauge d'invocation (1 PI ?) et plafond exact (6 PI via équipement selon breakflip).
- Héritage des caractéristiques : bonusCharacteristics interprété comme % des stats de l'invocateur (cohérent avec la source 50/75/100 %).
- Déclencheurs CMPARR / CI : sémantique déduite des descriptions (dépense de PM du lanceur / invocation par le porteur).
- Goberration invoque un « monstre 3 » non résolu dans l'API (illusions).
- Moment exact où une créature invoquée joue son premier tour.
- Boucliers lancés par une créature (Scarapace, 100 % du niveau du lanceur) : niveau pris en compte = celui de la créature (grade niv. 1) ou de l'Osamodas ?
- Piqûre Motivante peut cibler des ennemis (masques L, M, J) : l'IA ne doit jamais la lancer sur un ennemi.

## Sources
- Données de jeu : https://api.dofusdb.fr/breeds/2, https://api.dofusdb.fr/spell-variants?breedId=2, `/spells`,
  `/spell-levels`, `/spell-states`, `/monsters` (monstres 8070–8083), consultées le 2026-10-04.
- Refonte 3.1 (jauge de points d'invocation, coûts 1/2/3 PI, héritage 50/75/100 % des caractéristiques) :
  https://www.breakflip.com/guides/6574.html ; annonce Osavora : https://www.gamosaurus.com/?p=240355
- Maîtrise des Invocations (contrôle des invocations) : https://dofus.jeuxonline.info/actualite/58754/dofus-258-equilibrage-classes-controle-invocations ,
  https://www.gamosaurus.com/?p=50619
- Meilleur élément : code DoMath/Bubble `HaxeFighter.GetBestElement` (cache `.cache/domath/haxe`), https://domath.fr
- Noms des actions : https://github.com/PyDofus/pydofus3 (`ActionId.py`).

