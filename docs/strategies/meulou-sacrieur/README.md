# Tanière du Meulou : un Sacrieur Terre et 7 mules

Étude du 2026-10-19, puis un donjon complet joué à la main le même soir (§6). Le Sacrieur (Larry-Kind-jumploise, niveau
190) tue tous les monstres ; les 7 mules passent leurs tours.

| Étiquette | Origine |
|---|---|
| **[D]** | Données du jeu 3.7 (`.cache/data-3.7`) : sorts du Sacrieur, monstres et sorts du donjon. |
| **[C]** | Calcul DoMath (`src/damage`) avec les caractéristiques de l'écran du joueur (§2.1). |
| **[R]** | Raisonnement, à vérifier sur les combats. |
| **[J]** | Journaux des combats du 2026-10-19 (§6), lus par `npm run meulou:bilan`. |

Constantes et identifiants : [meulou.ts](../../../tools/meulou/meulou.ts).

## 0. En bref

1. **Donjon de niveau 100 contre un Sacrieur 190** : chaque monstre a 1 600 à 1 800 PV, le Meulou 5 500 à 7 300 [D]. Sans
   buff, une Entaille fait environ 550 à un monstre à 20 % de résistance Terre, et le Sacrieur en lance deux par tour [C].
2. **Le Meulou multiplie les Mulous** [D] :
   - Étripage (contact, vol Neutre 51-60) invoque un Mulou de 1 800 PV à la place de la cible qu'il tue. Les mules au contact
     du Meulou deviendront des Mulous ;
   - sa Milimeulou fait de même avec ses victimes (Mulanthropie) ;
   - il n'a droit qu'à 2 invocations à la fois. Ses invocations devraient mourir avec lui [R].
   - son passif, Fureur, divise par deux la première attaque qu'il reçoit à chaque tour [J] : il faut ouvrir sur lui avec
     un petit sort, puis frapper fort.
3. **Trois monstres gênent le Sacrieur plus qu'ils ne frappent** [D] :
   - **Croc Gland** : retire ses buffs (Désenvoûtement Canin, portée 9). 1 000 PV, le plus fragile ;
   - **Cocholou** : ses Dents Longues le font subir ×115 % de dommages, à 9 cases ;
   - **Mergranlou** : Chaperon donne +200 Puissance et +4 PA à un allié monstre, à 8 cases.
4. **Le Sacrieur s'enlise** : −23 en Fuite, −20 de plus sous le Froid de Mulou. Il doit se déplacer par ses sorts
   (Attirance, Transposition, Assaut, Ravage) plutôt qu'à pied [R].
5. **Ses vols de vie sont rognés** par les Esprits Vengeurs du Mulounoké (soins reçus ×70 %) et l'érosion de son Froid de
   Mulou (20 %) [D].
6. **Ses sorts de zone touchent aussi ses alliés**, donc les mules [D]. Les mules en vie servent de leurres [R].

## 1. Le donjon [D]

Donjon 15, sous-zone 213, entrée et sortie en 171706891. On entre en parlant au PNJ 3947, puis en répondant 2 fois la
première réponse ; on arrive dans la première salle, 155713536 (donnés par le joueur, 2026-10-19). Les salles d'après
DofusDB :

| Carte | Salle |
|---|---|
| 155713536 | Première salle |
| 155714560 | Deuxième salle |
| 155715584 | Troisième salle |
| 155716608 | Quatrième salle |
| 155716610 | Quatrième salle bis |
| 155717632 | Cinquième salle |
| 155718656 | Sixième salle |
| 155719680 | Sortie |

Ordre suivi le 2026-10-19 [J] : salle 1 (155713536), salle 2 (155714560), passage sans combat en 155715584 (porte 213),
salle 4 (155716608), salle 5 (155717632), salle du boss (155718656), sortie (155719680). Cartes notées au début des
combats : la salle elle-même, sauf en salle 2 (155714566) et chez le boss (155718662), soit la salle + 6.

### 1.1 Les monstres (grade 5)

| Monstre | Niveau, PV | PA, PM | Résistances N / T / F / E / A (%) | Sorts |
|---|---|---|---|---|
| **Meulou** (boss, 232) | 100, 5 500 (g1) à 7 300 (g5) | 10, 7 | 20 / **30** / −5 / 40 / 40 | Étripage, Rage Reconstituante, Invocation de Milimeulou ; 2 invocations au plus |
| Mulou (102) | 100, 1 800 | 10, 6 | 30 / **−10** / 25 / 10 / −5 | Cri du Mulou, Césarienne, Soin Accéléré |
| Muloubard (4866) | 100, 1 800 | 10, 5 | 15 / 20 / 30 / −10 / −5 | Riffes, Métalour, Baïkeur |
| Cocholou (4867) | 100, 1 800 | 12, 4 | −5 / 20 / 15 / 5 / 15 | Dents Longues, Faim de Mulou, Grand Méchant |
| Mulounoké (4868) | 100, 1 800 | 10, 5 | 20 / **−10** / 0 / 25 / 15 | Ruée Bestiale, Esprits Vengeurs, Froid de Mulou |
| Mergranlou (4869) | 100, 1 800 | 9, 4 | −25 / **30** / 15 / 10 / 20 | Mergran, Peur du Mulou, Chaperon |
| Croc Gland (299) | 70, 1 000 | 7, 5 | 25 / −5 / −5 / 5 / 35 | Déchirement Intestinal, Ablation Testiculaire, Désenvoûtement Canin |
| Milimeulou (4870, invocation) | 100, 890 | 9, 5 | 0 partout | Grigriffes, Mulanthropie |

Les grades des monstres de groupe se lisent dans les journaux [J]. Le boss est grade 5 à 8 personnages si la règle des
autres donjons tient (grade = joueurs − 3).

### 1.2 Leurs sorts

| Monstre | Sort | PA, portée | Effet |
|---|---|---|---|
| Meulou | **Étripage** | 3, contact, 1 par cible | Vol Neutre 51-60. **Cible tuée → Mulou grade 5 invoqué à sa place.** |
| | **Rage Reconstituante** | 5, sur lui | Sous 80 % de PV : soin de 400, +20 Tacle, +2 PM pendant 2 tours. Relance 6, pas au 1er tour. |
| | Invocation de Milimeulou | 4, contact | Relance 8. |
| | **Fureur** (passif, sort 305) | — | Au début du tour de chaque ennemi, sa **première attaque sur le Meulou est divisée par deux** ; chaque coup reçu donne +30 Puissance au Meulou pendant 3 tours. Absent de sa fiche (sort de départ 1521, introuvable) : lu dans le journal du 2026-10-19 [J]. |
| Milimeulou | Grigriffes | 4, contact | Terre 21-30, −20 Fuite. |
| | Mulanthropie | 5, contact | Relance 2. Sa victime tuée est remplacée par un Mulou. |
| Mulou | Cri du Mulou | 2, sur lui | Neutre 41-50 en cercle de 5 (cibles « J » des données : lesquelles, à voir en jeu). Relance 3. |
| | Césarienne | 3, contact | Terre 41-50, Pesanteur. |
| | Soin Accéléré | 5, sur lui | Soin 17-24 en fin de tour. Relance 6. |
| Muloubard | Riffes | 3, contact | Vol Eau 31-40 et −20 % PV pendant 2 tours ; à la fin du tour de la cible, −20 % PV à ses voisins. |
| | Métalour | 3, contact | Terre 17-20 ; la cible gagne 2 PA pendant 2 tours, et subit en fin de tour 2 dommages Terre par PA dépensé. |
| | Baïkeur | 4, sur lui | Inébranlable, +2 PM quand il perd des PA, soins reçus ×50 %. Relance 4. |
| Cocholou | **Dents Longues** | 4, 1-9 | Air 21-30. **Dommages subis par la cible ×115 %.** |
| | Faim de Mulou | 4, 1-8 | Eau 21-30 en cercle de 2, −2 PM. 1 fois par tour. |
| | Grand Méchant | 3, sur lui | Dommages subis ×85 %, gagne des dommages quand on le frappe. Relance 4. |
| Mulounoké | Ruée Bestiale | 3, 2-6 en ligne | Avance de 5 cases, Air 21-30. |
| | Esprits Vengeurs | 4, contact | Feu 21-30 en ligne perpendiculaire, soins reçus ×70 %. |
| | Froid de Mulou | 4, croix autour de lui | 20 % d'érosion, −20 Tacle, −20 Fuite, −2 PO pendant 2 tours. Relance 2. |
| Mergranlou | Mergran | 4, 1-10 | Feu 21-30, −20 Retrait PA et PM. |
| | Peur du Mulou | 4, croix autour de lui | −30 Tacle, repousse de 1. |
| | **Chaperon** | 4, 1-8, allié | Soin Feu 21-30, **+200 Puissance, +4 PA**, −20 Fuite et −10 % de résistances pendant 2 tours. |
| Croc Gland | **Désenvoûtement Canin** | 4, 0-9 | **Retire les envoûtements** (buffs) de la cible. Relance 4. |
| | Déchirement Intestinal | 1, contact | Neutre 9-12, −2 PA. |
| | Ablation Testiculaire | 5, contact | Vol Air 21-30. |

**Au contact :** Meulou, Milimeulou, Mulou, Muloubard, Mulounoké (après sa Ruée) et Croc Gland. **À distance :** Cocholou
et Mergranlou.

## 2. Le Sacrieur

### 2.1 Caractéristiques (écran du joueur, 2026-10-19)

- 3 949 PV, 12 PA, 5 PM, 0 PO, 4 invocations.
- Force 1 048, Intelligence 125, Agilité 270, Chance 0, Sagesse 187, Puissance 80.
- Critique 42 %, +10 dommages critiques.
- Dommages par élément : Neutre 58, Terre 88, Feu 28, Eau 19, Air 56.
- Tacle 10, **Fuite −23**, Retrait PA et PM 18, Esquive PA 25 et PM 18, Initiative 1 868.
- Résistances N / T / F / E / A : 8 / 24 / 19 / 35 / 10 fixes, 10 / 20 / 15 / 0 / 0 %.

### 2.2 La Souffrance [D]

Son état de Souffrance dépend de ses PV restants, par tranche de 10 % :

| PV restants | < 100 % | < 90 % | < 80 % | < 70 % | < 60 % | **< 50 %** | < 40 % | < 30 % | < 20 % | < 10 % |
|---|---|---|---|---|---|---|---|---|---|---|
| Souffrance | 1 | 2 | 3 | 4 | 5 | **6** | 7 | 8 | 9 | 10 |
| Dommages subis | ×99 % | ×97 % | ×95 % | ×91 % | ×86 % | ×81 % | ×77 % | ×74 % | ×72 % | ×70 % |
| Dommages finaux | +1 % | +3 % | +5 % | +9 % | +14 % | +19 % | +23 % | +26 % | +28 % | +30 % |

**Souffrance 6 et plus** (sous 50 % de PV) renforce trois de ses sorts équipés :
- Attirance : +4 PO, et 13 cases au lieu de 9 ;
- Transposition : +4 PO ;
- Couronne d'Épines : +5 % de bouclier par ennemi dans sa zone.

Plusieurs sorts lui retirent des PV : Entaille et Mutilation −10 %, Libation −30 %, Berserk −70 %.
Reste à vérifier en jeu [J] :
- s'il perd 10 % de ses PV restants ou de ses PV max ;
- si ces PV perdus comptent comme érodés pour Punition.

### 2.3 Sorts Terre [D][C]

Dommages en jeu calculés avec ses caractéristiques, sans buff, au contact. Le calcul n'est pas encore vérifié en jeu.

| Sort | PA, portée | Zone, effet | Dommages (rés. 0 %) | Critique | Espérance à rés. 20 % |
|---|---|---|---|---|---|
| **Entaille** (var. Hécatombe) | 4, contact ; 2 par tour | Terre 47-51 ; **−10 % PV au lanceur** | 665-714 | 785-847 | 619 (155 par PA) |
| **Décimation** (var. Hémorragie) | 3, 0-1 en ligne ; 2 par tour | Terre 29-32 en croix diagonale (la case et ses 4 diagonales) ; dommages subis ×103 % | 444-480 | 527-564 | 407 (136 par PA) |
| **Ravage** | 3, 1-6 en ligne ; 2 par tour | Avance de 5 cases, Terre 28-32 | 431-480 | 515-564 | 402 (134 par PA) |
| Supplice | 3, contact ; 3 par tour, 2 par cible | Vol Terre 22-26 | 358-407 | 429-478 | 338 (113 par PA) |
| Afflux (var. Condensation) | 2, sur lui ; 2 par tour | Attire de 2 vers lui en croix de 3, Terre 12-15 | 235-272 | 294-331 | 225 (112 par PA) |
| **Bain de Sang** | 4, sur lui ; 2 par tour | Vol Terre 27-31 sur les 8 cases autour de lui, +15 Tacle par entité touchée | 419-468 | 490-552 | 396 (99 par PA) |
| Punition | 4, contact ; relance 3 | Meilleur élément (Terre) 31-35, plus Neutre 35 % de ses PV érodés | 468-517 + érodés | 552-613 + érodés | 442 + érodés |

Avec ses buffs, en espérance à résistance 20 % :

| Buffs | Puissance, bonus | Entaille | Décimation |
|---|---|---|---|
| Aucun | 80 | 619 | 407 |
| Mutilation | 230 | 685 | 448 |
| Mutilation, Souffrance 6 (PV < 50 %) | 230, +19 % finaux | 815 | 533 |
| Mutilation, Berserk depuis PV pleins (Souffrance 7) | 230, +23 % finaux, +10 % aux sorts | 926 | 605 |

Un tour type sans buff : 2 Entailles + 1 Décimation (11 PA), soit environ 1 650 sur un monstre à 20 %. C'est presque un
monstre de 1 800 PV par tour [C]. Contre le Meulou (Terre 30 %) : environ 1 450 par tour, plus que les 400 PV de sa Rage
Reconstituante (une fois tous les 6 tours).

### 2.4 Sorts Neutre selon ses PV [D]

| Sort | PA | Zone | Effet |
|---|---|---|---|
| **Transfusion** | 2, 1 par tour | Cercle de 3 autour de lui | Neutre à 10 % de ses PV restants (≈ 395 à PV pleins, avant résistances) ; transfère 10 % de ses PV aux alliés de la zone. |

Ces dommages suivent ses PV : ils baissent quand la Souffrance monte. Reste à vérifier [J] s'ils profitent de la Force et
des dommages Neutre.

### 2.5 Sorts des autres éléments [D]

Avec Agilité 270, Intelligence 125 et Chance 0, leurs dommages sont faibles. Ils servent surtout pour leurs effets :

| Sort | PA, portée | Effet utile |
|---|---|---|
| Absorption | 3, 1-6 | Vol Feu 20-24 ; **−150 Puissance à la cible** pendant 1 tour : contre le Chaperon (+200) du Mergranlou. |
| Désolation | 4, 1-4 en ligne | Vol Air 26-30 et **−3 PM** en demi-cercle. |
| Hostilité | 2, 1-6 | Feu 15-18, repousse de 2. |
| Stase | 3, 1-5 sans ligne de vue | Vol Eau 20-24, −20 % Critique. |
| Dissolution | 4, 0-5 | Vol Eau 25-29 en croix, −30 Fuite. |

### 2.6 Buffs, protection, soin [D]

| Sort | PA, relance | Effet |
|---|---|---|
| **Mutilation** | 2, 1 par tour | +150 Puissance, puis −10 % PV à chaque début de tour tant qu'elle dure. Relancée : retire ses effets et pose un bouclier de 5 %, 15 % ou 25 % de ses PV max selon le nombre de tours tenus (Coagulation). |
| **Berserk** | 2, relance 2 | −70 % PV, Intaclable, +10 % dommages aux sorts, soins reçus ×30 %. Prend fin quand il remonte à 50 % de ses PV. |
| **Couronne d'Épines** | 2, relance 3 | Bouclier de 10 % de ses PV max, Pesanteur en croix autour de lui, renvoie aux ennemis à son contact 100 % des dommages de mêlée qu'il subit, pendant 1 tour. |
| Libation | 2, relance 3 | −30 % PV, durée de ses effets −1 (retire ses malus d'un tour). En fin de tour, soin de 1 à 30 % de ses PV max selon sa Souffrance. |
| Sacrifice | 2, relance 4 | Intercepte les dommages des alliés en cercle de 2 : inutile avec des mules. |
| Épée Vorace | 3, 1-3 en ligne, relance 4 | Invoque une Épée Vorace (vol Neutre), qui prend la Souffrance du Sacrieur. |

Le Désenvoûtement Canin du Croc Gland retire les buffs du Sacrieur : Mutilation, Couronne d'Épines
[D, à vérifier pour la Souffrance].

### 2.7 Déplacements [D]

| Sort | PA, portée | Effet |
|---|---|---|
| **Attirance** | 2, 2-10 en ligne (+4 en Souffrance 6+) | Attire la cible de 9 cases (13 en Souffrance 6+) : il amène un monstre à distance au contact. |
| **Transposition** | 3, 1-9 sans ligne de vue (+4), relance 3 | Échange de position. |
| Ravage | 3, 1-6 en ligne | Avance de 5 cases vers la cible. |
| Assaut | 2, 1-2 | Échange de position, Air 14-17. |

### 2.8 Sorts équipés (écran des sorts du joueur, 2026-10-19)

**Trois variantes : Décimation, Afflux, Entaille.** Tous les autres sorts sont ceux de base de leur paire : Absorption,
Supplice, Stase, Attirance, Mutilation, Épée Vorace, Ravage, Assaut, Transposition, Hostilité, Couronne d'Épines,
Transfusion, Dissolution, Désolation, Sacrifice, Bain de Sang, Libation, Berserk, Punition. Rituel de Jashin et Folie
Sanguinaire demandent les niveaux 195 et 200.

AnkaBot ne lit pas les variantes équipées : elles sont déclarées dans `data/fightlogs/variantes.json`, comme pour
Kaskyzo. À mettre à jour si le joueur en change.

## 3. Stratégie proposée [J][R]

Tirée du donjon joué à la main (§6), et mise en œuvre par le planificateur (§4.3). La stratégie du joueur gagne sans risque, mais perd du temps à deux endroits : les
monstres à distance chassés à pied, et le Meulou frappé au Bain de Sang pendant 12 tours. Le planificateur devra la
garder là où elle marche et la corriger là où elle traîne.

**Ce qui marche, à garder :**
- **Bain de Sang ×2 au milieu des monstres de contact.** Ce sont les deux tiers des dégâts du Sacrieur, et son vol de vie
  le soigne d'environ la moitié des dégâts qu'il fait : 2 000 à 2 400 de dégâts par lancer contre 3 ou 4 monstres adjacents.
- **Mutilation et Couronne d'Épines au 1er tour**, puis attendre que les monstres de contact viennent à lui.
- **Décimation quand 2 ou 3 monstres sont dans sa croix diagonale** : jusqu'à 2 160 en un lancer.

**Ce qui traîne, à corriger :**
1. **Ne plus chasser à pied les Cocholous et les Mergranlous.** Ils restent à 4-9 cases, et le Sacrieur n'a que 5 PM.
   - Fins de combat : 3 à 4 tours sur ces deux monstres en salles 1 et 4 ; 7 manches sur deux Cocholous après la mort
     du Meulou.
   - Correction : Attirance (2 PA, 2-10 en ligne, attire de 9) et Ravage (3 PA, 1-6 en ligne, avance de 5) dès les
     premiers tours, pour les amener là où Bain de Sang les touche avec les autres. Attirance n'a servi qu'une fois.
2. **Tuer le Meulou avant sa deuxième Rage Reconstituante.**
   - Ses soins : 2 000 PV par Rage, en manches 6 et 12, et environ 220 par tour avec Étripage, soit 6 400 PV de plus en
     tout. Il a fallu 12 tours de Sacrieur, à environ 1 100-1 200 par tour (Supplice + 2 Bains).
   - Pour le tuer avant la manche 12, il faut environ 1 800 par tour. Leviers :
     - Entaille, 1,6 fois Bain de Sang sur une seule cible, mais −10 % des PV actuels et pas de vol de vie : à doser ;
     - Couronne d'Épines toutes les 3 manches au contact du Meulou : elle renvoie son Étripage (−420 au Meulou en
       manche 6) ;
     - Décimation et Bain de Sang quand d'autres monstres sont aussi au contact.
   - Berserk (+10 % aux sorts, Souffrance 7 et plus) est à garder pour la fin, s'il reste peu de PV au Meulou. Il
     divise les soins reçus par trois, donc le vol de vie aussi.
3. **Sorts jamais lancés, à essayer par le planificateur :**
   - Afflux (2 PA) : attire de 2 cases les monstres à 2-3 cases, ensuite touchés par Bain de Sang ;
   - Transfusion (2 PA) : Neutre à 10 % de ses PV, en cercle de 3 autour de lui.
4. **Salle du boss : le Meulou a eu un Mulou de 1 800 PV** en tuant une mule au 1er tour. Placer les mules hors de sa
   portée (il joue le premier, 7 PM) éviterait ce Mulou.

**Ce qui ne sert à rien :**
- Les mules ne servent pas de leurres : niveau 5 à 18, 93 à 203 PV, toutes mortes en manche 1 ou 2.
- L'Épée Vorace : tuée au 1er tour (salle 2).
- Punition : le Sacrieur n'a jamais de PV érodés (PV max restés à 3 949).

## 4. Scripts AnkaBot et serveur de plans

Deux scripts, un seul serveur :

| Script | Sacrieur | Mules |
|---|---|---|
| **`MeulouCombat.lua`** | placé et joué par le serveur de plans (§4.3) | placées par le serveur, tours passés |
| `MeulouMain.lua` | joué à la main (combats d'étude, comme le 2026-10-19) | case du jeu, tours passés |

Les mules n'ont rien à déclarer : tout personnage du groupe autre que le Sacrieur en est une, quels que soient sa classe,
son niveau et son nombre.

### 4.1 Mise en route

1. Générer les scripts, si ce n'est pas déjà fait :
   - lancer `npm run meulou:script` ;
   - il produit `tools/ankabot/MeulouCombat.lua`, `tools/ankabot/MeulouMain.lua` et leur lanceur
     `tools/ankabot/lancer_serveur_meulou.cmd`.
2. Démarrer le serveur :
   - double-cliquer sur `lancer_serveur_meulou.cmd`, ou lancer `npm run meulou:serveur` ;
   - laisser la fenêtre ouverte pendant les combats ;
   - il écoute le port 8767, et peut tourner en même temps que les serveurs de la Reine (8765) et du Féca (8766) ;
   - après une modification du planificateur, le relancer : il ne la prend qu'à son démarrage.
3. Variantes de sorts équipées : `data/fightlogs/variantes.json` (Décimation, Afflux, Entaille ; relu à chaque tour).
4. Dans AnkaBot :
   - redémarrer AnkaBot si un autre script était chargé, sinon d'anciennes instances du journal restent abonnées ;
   - charger `MeulouCombat.lua` (ou `MeulouMain.lua`) sur le chef du groupe. AnkaBot le charge aussi sur les mules ;
   - choisir la configuration de combat « IA avancée dans le même script » ;
   - attendre « [journal] … prêt » pour Larry-Kind-jumploise ;
   - ne pas ouvrir le mode MITM pendant les combats : il fait fermer des tours (vu au Roc des Salbatroces).
5. Lancer le script avec le groupe à l'entrée du donjon (carte 171706891), chaque personnage avec sa clef.

### 4.2 Trajet (les deux scripts)

- **Entrée :** chaque personnage parle au PNJ 3947, puis répond 2 fois la première réponse ; le groupe arrive dans la
  première salle (155713536).
- **Salles :** le chef attend ses mules (`global:teamCheck`, puis `map:countPlayers()`, 2 minutes au plus), puis lance
  le combat (`map:fight()`), quelle que soit la taille du groupe de monstres.
  - Après une victoire, le jeu emmène le groupe dans la salle suivante, où le script lance le combat suivant.
  - Cartes de combat : celles des salles et leurs variantes « + 6 » (`CARTES_COMBAT`, [meulou.ts](../../../tools/meulou/meulou.ts)).
- **Passage 155715584 :** pas de combat, porte de la case 213 (`map:door(213)`).
- **Sortie (155719680) :** chaque personnage parle au PNJ 3947, 1 fois la première réponse. Le groupe revient à
  l'entrée, et le donjon recommence.
- **Mule restée en arrière :** au bout de 60 s (ANKABOT_TIMEOUT), elle fait l'action de sa carte (PNJ, porte).
- Le script ne remonte pas les PV du Sacrieur entre deux salles.

`MeulouMain.lua`, en combat : placer le Sacrieur, le mettre prêt, puis jouer chacun de ses tours. Le script garde la
main jusqu'à la fin du tour, 2 minutes au plus.

### 4.3 Le planificateur

Code : [planificateur.ts](../../../tools/meulou/planificateur.ts). Même recherche que le Féca :
1. une case de tir ;
2. un faisceau de sorts joués par le vrai moteur (portée, ligne de vue, PA, limites, déplacements, jets moyens), avec
   des marches entre deux sorts (vers le contact d'ennemis, ou pour aligner un Ravage ou une Attirance) ;
3. une case de fin.

Calcul sur 4 fils, environ 0,2 s par plan sur un fil (49 tours du 2026-10-19 rejoués).

**Sorts lancés :** Entaille, Punition, Ravage, Décimation, Supplice, Bain de Sang, Afflux, Transfusion, Mutilation,
Couronne d'Épines, Attirance, Transposition, Assaut. Les autres sorts équipés sont écartés : ceux des autres éléments,
Hostilité (elle éloigne les monstres), Berserk, Libation, Sacrifice, Épée Vorace.

**Note d'un tour** (poids `W` du planificateur) :
- **Dégâts :** + les PV retirés aux monstres, plafonnés à leurs PV ; ×1,15 sur le Meulou, qui se soigne.
- **Monstres tués :** + 400 + 3 fois leurs dommages par tour (`DANGER_SACRI`, mesurés) ; +300 pour un Mergranlou ou un
  Cocholou, +2 500 pour le Meulou ; +5 000 si la salle est vidée.
- **PV du Sacrieur :** ± les PV gagnés (vol de vie) ou perdus (Entaille, Transfusion), pondérés selon ses PV restants
  rapportés à ses PV max sans érosion : 0,2 à 75 % et plus, 0,8 à 50 %, 4 à 0. À PV pleins, Entaille passe donc
  devant Bain de Sang ; sous la moitié, le vol de vie l'emporte.
- **Mutilation :** une fois par combat, tant qu'il reste au moins 4 000 PV de monstres. Elle vaut 12 % de ces PV, au
  plus 1 800.
- **Couronne d'Épines :** son bouclier, plus le renvoi des coups de contact attendus à tous les ennemis à son contact,
  au plus 1 500.
- **Case de fin :**
  - + par ennemi au contact ;
  - + par ennemi en ligne à portée d'Attirance ;
  - − par case qui le sépare du plus proche, s'il n'est au contact de personne ;
  - − les dommages des monstres qui pourront le frapper, pondérés par ses PV.
- **Fureur du Meulou :**
  - la première attaque du tour sur lui compte pour moitié ;
  - −50 par coup qu'il reçoit, chaque coup lui donnant +30 Puissance.
  - Exemple : un sort bon marché d'abord (Assaut, Transfusion), puis les gros coups.

**Placement** ([placement.ts](../../../tools/meulou/placement.ts)) :
- **Le Sacrieur :** au contact du plus de monstres possible, sinon en ligne à portée d'un Ravage, au plus près.
- **Les mules :**
  - salle du boss : le plus loin possible du Meulou ;
  - ailleurs : au plus près du Sacrieur [R].

**Ce que le moteur ne sait pas, et ce qui le remplace :**
- **Souffrance :** les dommages finaux qu'elle donne sont dans les caractéristiques que le serveur du jeu envoie au début
  du tour (caractéristique 107). La réduction des dommages subis est appliquée par le planificateur aux menaces.
- **PV érodés :** le planificateur rend au Sacrieur ses PV max sans érosion, pour Punition. En salle 1, ses PV max
  sont passés de 3 949 à 3 190 ; au boss, de 3 949 à 2 067.
- **Fureur du Meulou :** son passif n'est pas lancé par le moteur. Le planificateur compte la demi-attaque à part.

**Régler sur les combats joués :**
- `npm run meulou:rejouer` : chaque tour du Sacrieur d'un journal, avec le plan d'aujourd'hui et ce qui a été joué ;
  `--combat n`, `--manche m` ;
- `npm run meulou:bilan` : bilan des combats.

**Traces laissées :**
- `data/fightlogs/<date>/session-*.jsonl` : le journal ;
- `data/fightlogs/<date>/plans-*.jsonl` : chaque plan, avec sa note ;
- `tools/ankabot/ia_meulou_<personnage>_<date>.log` : ce que le script a fait.

## 5. Suite

À vérifier sur les premiers combats joués par le serveur :
- **Transfusion :** le planificateur la lance souvent (Neutre à 10 % de ses PV, en cercle de 3), mais elle n'a jamais
  été mesurée en jeu. Si ses dommages déçoivent, il faudra la recaler ou l'écarter.
- **Couronne d'Épines :** comparer le renvoi prévu au renvoi réel.
- **Le Meulou :** ses invocations meurent-elles avec lui ? Les mules placées loin de lui évitent-elles le Mulou ?
- **Les tours :** aucun tour fermé, et des plans arrivés à temps (lignes « plan » de `ia_meulou_*.log`).

## 6. Combats joués à la main le 2026-10-19 [J]

Un donjon complet, de 20:23 à 20:43 : 5 combats gagnés, plus un combat abandonné au départ. Journal :
`data/fightlogs/2026-10-19/session-18-22-41.jsonl` ; bilan complet : `npm run meulou:bilan` (`--court` sans la
chronologie).

### 6.1 Les combats

| Salle | Monstres (8, grade) | Manches | Dégâts du Sacrieur | Dégâts reçus | Vol de vie | PV au plus bas |
|---|---|---|---|---|---|---|
| 1 (155713536) | 2 Mulous, 2 Mergranlous, 2 Cocholous, 2 Mulounokés, g1 | 7 | 13 033 | 3 307 | 4 762 | 1 616 (parti à 2 133) |
| 2 (155714566) | 2 Mulous, 2 Mergranlous, 2 Mulounokés, 2 Muloubards, g2 | 6 | 13 832 | 1 489 | 3 524 | 3 408 |
| 4 (155716608) | 2 Mulous, 2 Mergranlous, 2 Cocholous, 2 Mulounokés, g3 | 8 | 13 981 | 2 727 | 3 808 | 2 857 |
| 5 (155717632) | 2 Mulous, 2 Mergranlous, 2 Cocholous, 2 Muloubards, g4 | 6 | 14 566 | 1 705 | 2 990 | 3 059 |
| Boss (155718662) | Meulou, 2 Cocholous, 2 Mulounokés, 3 Muloubards, g5 | **22** | 30 170 | 11 714 | 14 035 | 1 874 |

- **Le grade monte d'une salle à l'autre** (1 à 5), pas avec le nombre de personnages.
- **La taille du groupe suit le nombre de personnages** : 4 monstres dans le combat lancé avec une seule mule arrivée
  (abandonné), 8 avec le groupe complet.
- Le Sacrieur part à PV pleins à chaque salle, sauf la première.
- Croc Gland : jamais vu.

### 6.2 La stratégie du joueur

- **Placement :** au contact du groupe ou à 2-4 cases. (Combats 2 à 5 : le script a rendu la main au bout de 0,26 s,
  il n'est pas sûr que le Sacrieur ait été placé à la main ; corrigé le soir même.)
- **1er tour :** Mutilation et Couronne d'Épines, puis Bain de Sang s'il est au contact, sinon Ravage vers le groupe. Une
  fois l'Épée Vorace (salle 2).
- **Tours suivants :** il reste sur place, au milieu des monstres de contact. 2 Bains de Sang par tour, plus Supplice
  ou Décimation ; Ravage pour atteindre un monstre isolé.
- **Fin de combat :** il marche vers les Cocholous et les Mergranlous restants.
- **Boss :** il nettoie d'abord les monstres de contact (manches 2 à 5), puis reste 11 tours sur la même case, au
  contact du Meulou : Supplice + 2 Bains par tour. Le Meulou meurt en manche 15, les deux Cocholous en manches 17 et 22.
- **Sorts lancés :**
  - Bain de Sang : 68 fois, 72 % de coups critiques, environ 470 par cible touchée ;
  - Supplice : 30 fois ;
  - Décimation : 10 fois ;
  - Ravage : 11 fois ;
  - Couronne d'Épines : 7 fois ;
  - Mutilation : 1 fois par combat ;
  - Attirance : 1 fois ;
  - jamais lancés : Entaille, Punition, Berserk, Transfusion, Afflux.

### 6.3 L'IA des monstres

| Monstre | Ce qu'il fait |
|---|---|
| **Cocholou** | Il joue souvent le premier. Il vise d'abord les mules qu'il peut tuer (Dents Longues à 9 cases, Faim de Mulou en zone, jusqu'à 6 mules touchées d'un coup), puis le Sacrieur. Il reste à 4-9 cases, recule quand on approche, et lance Grand Méchant sur lui. Il fait le plus de dégâts au Sacrieur dans les salles 1 et 4 : 200 à 500 par tour. |
| **Mergranlou** | Mergran sur les mules puis sur le Sacrieur, à 10 cases au plus. Chaperon (soin de 100 à 180, +200 Puissance) sur ses alliés, presque à chaque tour. Peur du Mulou repousse le Sacrieur d'une case quand il est au contact. Il reste à distance. |
| **Mulounoké** | Ruée Bestiale sur ses alliés pour se déplacer (2 à 3 bonds par tour), puis sur le Sacrieur ; Esprits Vengeurs au contact ; Froid de Mulou. |
| **Muloubard** | Il marche au contact. Baïkeur au 1er tour, puis Riffes et Métalour. Ses coups, renvoyés par la Couronne d'Épines, touchent tous les monstres au contact du Sacrieur (Riffes : jusqu'à 774 renvoyés). |
| **Mulou** | Il marche au contact. Césarienne (100 à 280), Cri du Mulou, Soin Accéléré sous la moitié de ses PV. |
| **Meulou** | Il joue le premier : 7 PM, Invocation de Milimeulou et 2 Étripages sur les mules au 1er tour. La première mule tuée devient un Mulou ; la seconde non (2 invocations au plus : Milimeulou et Mulou). Ensuite, il colle le Sacrieur : un Étripage par tour (1 par cible), 380 à 540, qui le soigne de la moitié. Rage Reconstituante en manches 6 et 12 : +2 000 PV chaque fois. Seconde Milimeulou en manche 9. |
| **Milimeulou** | Grigriffes et Mulanthropie au contact. Aucune victime remplacée par un Mulou : la limite de 2 invocations était atteinte. |

### 6.4 Dégâts du Sacrieur, mesurés

- **Bain de Sang :** 400 à 520 sur les monstres à 20-30 % de résistance Terre, 600 à 840 sur les Mulous et les
  Mulounokés (−10 %).
- **Supplice :** 580 à 770 en coup critique sur ces derniers.
- Ordre de grandeur conforme au calcul du §2.3 avec Mutilation et un peu de Souffrance.
- **Sur le Meulou, la première attaque de chaque tour ne fait que la moitié** (passif Fureur, §1.2) :
  - Supplice et Décimation lancés en premier : 0,5 à 0,56 fois le calcul ;
  - les Bains de Sang suivants : entiers.
- Sur les autres monstres, le moteur calcule juste : 0,92 à 1,15 fois les coups réels (Supplice, Décimation, Bain de
  Sang).
- Le sort 26026, déclenché à chaque coup du Sacrieur, n'est pas dans les données : sans effet visible.
