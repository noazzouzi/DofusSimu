# Féca contre les Krobes : sorts utiles, sorts interdits, stratégies

Analyse du 2026-10-17. Les Krobes (Bacterrib, Verminocule, Virustine, Tabacille, Pataugerme et la Malamibe) se
retrouvent dans le Ventre de la Baleine et au Roc des Salbatroces.

| Étiquette | Origine |
|---|---|
| **[D]** | Données du jeu 3.7 (`.cache/data-3.7`) : 44 sorts du Féca, sorts et descriptions officielles des Krobes. |
| **[V]** | Vidéo https://youtu.be/R9j7ee4MGjA, 4 combats : Féca Oméga 580 et 7 mules, Roc des Salbatroces. Combat 1 (arène 140517635) relu image par image ; combats 2 à 4 relus sur le journal de combat. |
| **[B]** | [Ventre de la Baleine](../ventre-de-la-baleine/README.md), combats des 4 Crâs. |
| **[R]** | Raisonnement, à tester en jeu. |

## 0. En bref

1. **Frapper les Krobes, jamais la Malamibe.**
   - Elle prend 200 % des dégâts initiaux de chaque coup porté à un Krobe, contre 50 % de ceux qui la visent [B].
   - Un sort de zone qui touche 2 Krobes la touche 2 fois. Exemple : Stratus en coup critique sur 2 Verminocules, −584 ×2 [V].
2. **Les retraits de PO ne servent à rien :** tous les sorts des Krobes ont une portée fixe [D].
3. **Les retraits de PA ne servent qu'avec beaucoup de Retrait PA.**
   - Chaque attaque de Krobe coûte 4 PA sur 12 : −1 PA en supprime une sur trois, −5 PA deux sur trois. Aucun Krobe n'est relancé par un retrait de PA [D][B].
   - En jeu, les Krobes ont 49 d'esquive PA et 70 d'esquive PM, et non −24 comme dans les données de base.
   - Avec 9 en Retrait PA (Kaskyzo), Terre Battue ne retire en moyenne que 0,3 PA sur 3, et Somnolence 0,2 sur 2.
4. **Tant qu'une Bacterrib vit :**
   - rester à 6 cases ou plus d'elle ;
   - ne poser aucune invocation à 5 cases ou moins d'elle (Lanterne du Berger, boucliers) : la condition parle de « combattant allié » [D] ;
   - ne pas compter sur les protections d'un tour du Féca : elles perdent 1 tour à chaque tour de Bacterrib (§1).
5. **Ne jamais déplacer la Virustine ni viser ses PM.** Exception : une poussée bloquée (contre un obstacle ou une entité) lui retire 1 PM pour tout le combat, sans la relancer [D][V].
6. **Aucun soin tant qu'un Tabacille vit.** Le Féca n'a aucun soin dans ses sorts. Il faut surveiller ceux de l'équipement (§5).
7. **Verminocule :** il faut un combattant allié à son contact au début de son tour. Le Féca s'y met sous Barricade, une fois les Bacterribs mortes.

## 1. Les Krobes : texte du jeu [D]

Communs à tous les Krobes :
- Ils sont **Invulnérables** et renvoient les dommages initiaux des attaques vers la Malamibe.
- Au début de son tour, un Krobe invoque une **Malamibe** s'il n'y en a aucune en vie (Dislocation).
- La Malamibe **tue tous les alliés 2 tours après son invocation**.
- La Malamibe a 1 PV, plus 2 000 par personnage vivant, et meurt avec son invocateur [B].
- Chaque Krobe se tue de lui-même **3 tours** après le lancement ou la dernière relance de son compte à rebours.

| Krobe | Compte à rebours relancé si… | Autre effet | Attaques (valeurs de base) |
|---|---|---|---|
| **Bacterrib** (5 PM) | un combattant allié est à **5 cases ou moins** au début de son tour | Au début de son tour, **réduit de 1 tour la durée des effets des alliés à 6 cases ou plus**. C'est la ligne « −1 sur la durée des effets » du journal [V]. | Sécrétion : Air 61-70, PO 6-10, −1 PO et −1 PM. Danse répulsive : Terre 71-80, PO 6-10 en ligne, repousse de 2. |
| **Verminocule** (5 PM) | **aucun** combattant allié à son contact au début de son tour | Condition tenue = état **Infection** pendant 1 tour. | Gonflement : Eau 61-70, en étoile de 3 autour de lui, attire de 3. Jet d'acide : Neutre 131-150, au contact. |
| **Virustine** (7 PM) | elle est attirée, poussée, transposée, portée, ou subit une **tentative** de retrait de PM | Chaque dommage de poussée lui retire 1 PM non esquivable, cumulable, **sans relance**. Ce malus disparaît à la relance. | Boulet Viral : Air selon ses PM restants, PO 1-3 en ligne. Contamination : Feu 81-100 au contact, 20 % d'érosion. |
| **Tabacille** (4 PM) | un combattant allié est **soigné** | +150 Puissance à chaque début de tour, retirés à la relance. | Échange subtil : échange de positions, puis Neutre de 26 à 90 selon les PV manquants, PO 1-4 en ligne. Remontée gastrique : Eau de 31 à 90, PO 1-2, −1 tour aux effets de la cible. |
| **Pataugerme** | il n'a pas reçu les 4 éléments depuis son tour précédent [B] | — | Voir [B] §2. |

Dans le journal (client allemand) [V] :
- les quatre « Restauration » (éloignée, de proximité, mobile, curative) sont ces comptes à rebours ;
- une relance s'affiche en deux lignes : « n'est plus affecté par le sort … », puis « lance … ».

## 2. Les sorts du Féca face aux Krobes [D]

Zones : G1 = carré 3×3, C3 = cercle de 3, X1 = croix de 1, L2 = ligne de 2, T = ligne perpendiculaire, * = étoile.
Dégâts : valeurs de base, avant les caractéristiques. Les chiffres [V] sont ceux reçus par la Malamibe dans la vidéo.

### 2.1 Dégâts sans déplacer la cible : sûrs sur tous les Krobes

| Sort | PA, PO | Zone | Effet | Usage contre les Krobes |
|---|---|---|---|---|
| **Stratus** | 4, 0-6 | G1 | Eau 31-34, −3 PO | **Le meilleur** : 1 fois par tour, touche tous les Krobes groupés. [V] −558 à −584 par Krobe en coup critique. |
| **Verglas** | 3, 0-8 | G1 | Eau 31-35, puis un glyphe 2 tours | [V] −491 à −654 par Krobe. Glyphe à redéclencher avec Transhumance ou Mise en Garde (§2.3). |
| **Nimbus** | 3, 0-6 | X1 | Eau 23-25, −Chance, −Tacle | 2 fois par tour. |
| **Bulle** | 2, 1-8 | cible | Eau 17-19, −3 PO | [V] −418 et −453. Peu de PA. |
| **Escapade** | 3, 1-6 | cible | Eau 27-29, le **Féca** recule de 2 | Sûr : c'est le Féca qui bouge. Il gagne aussi de la distance face aux Bacterribs. |
| Retour du Bâton, Langueur | 3, 1-4 / 1-7 | cible | Terre / Feu | Autres éléments, utiles pour le Pataugerme. |
| Typhon | 3, 1-4 en ligne | L2 | Air, −Agilité, −Dommages | |
| Somnolence, Tétanie | 3 / 4 | croix diagonale / cible | Terre, −2 / −3 PA | Dégâts et défense (§2.4). |
| Pâturage, Refuge, Vigie | 3 | X1 / C2 / C2 | Air / Terre / Feu, puis glyphe | Une seule glyphe élémentaire par tour. |
| **Défiance** | 2, 0-7 | croix autour de l'allié ciblé | Glyphe de fin de tour : Terre, Feu, Eau **et** Air (21-22 chacun) | Les 4 éléments d'un coup pour le Pataugerme. **Sur la Malamibe : 860 dommages** d'un seul déclenchement, par une Tabacille qui a fini son tour dedans (2026-10-17). Relance tous les 2 tours. |

### 2.2 Interdits sur la Virustine : déplacement ou retrait de PM

| Effet | Sorts |
|---|---|
| Repousse | Giboulée (4 cases), Bourrasque (1), Silbo (1, depuis le centre de la zone) |
| Attire | Frisson (2), Houlette (3), Torpeur (2), Sonnailles (2, zone), Regroupement (2, cercle de 3 autour du Féca) |
| Échange | Manœuvre |
| Retire des PM | Atonie (zone), Léthargie, **Terre Brûlée** (son glyphe retire 3 PM aux ennemis présents ou entrant) |

Exceptions et autres usages :
- **Poussée bloquée :** Giboulée sur une Virustine collée à un obstacle dans l'axe de la poussée lui retire 1 PM sans la relancer [D][V, 1:28]. Son Boulet Viral dépend de ses PM restants, il perd donc en force. Si elle bouge d'une seule case, elle est relancée.
- **Sur une Bacterrib**, ces sorts sont utiles : Giboulée l'éloigne de 4 cases du Féca ou d'un allié. Le déplacement ne relance pas la Bacterrib, seule la distance compte.

### 2.3 Les glyphes

- **Glyphes de début de tour** (Vallée, Prairie, Terre Battue, Terre Brûlée) : 2 tours. Ils frappent chaque ennemi qui commence son tour dedans.
  - Vallée et Terre Battue font un cercle de 3 : un coup par Krobe à son tour, donc autant de coups sur la Malamibe.
- **Glyphes de Verglas, Pâturage, Refuge et Vigie** : dégâts immédiats en zone, puis un glyphe qui ne frappe que si le Féca le **déclenche** avec Transhumance ou Mise en Garde.
  - Quand le journal dit qu'un Krobe « déclenche le Verglas de Tayro », il ne se passe rien [V].
- **Une seule glyphe élémentaire par tour.**
- **La Lanterne du Berger :** ces sorts l'invoquent si la case ciblée est **libre**. Viser un Krobe n'en invoque pas.
  - Elle est un combattant allié : à 5 cases ou moins d'une Bacterrib, elle la relancerait [R].

### 2.4 Retraits de PA : la défense

Les Krobes jouent 3 attaques à 4 PA. Les rabaisser à 8-11 PA en supprime une [D]. Mais en jeu, ils ont 49 d'esquive PA : avec 9 en Retrait PA (Kaskyzo), à peine 10 % des PA visés sont retirés. Ces sorts ne valent que pour un Féca orienté Retrait PA.

| Sort | PA, PO | Effet |
|---|---|---|
| **Terre Battue** | 3, 0-5 | Glyphe en cercle de 3 pendant 2 tours : −3 PA aux ennemis présents ou entrant. Tout un groupe de Krobes passe à 2 attaques. Relance tous les 3 tours. |
| Somnolence | 3, 0-6 | −2 PA en croix diagonale, 1 fois par tour. |
| Tétanie | 4, 1-2 | −3 PA sur la cible. |

### 2.5 Distance et contact

| Sort | PA, PO | Effet |
|---|---|---|
| **Transhumance** | 3, 1-6 | Téléporte le Féca. Déclenche aussi ses glyphes à l'arrivée. Relance tous les 3 tours. |
| Renfort | 2, 2-6 en ligne | Téléporte le Féca jusqu'à un allié. |
| Escapade | 3, 1-6 | Le Féca recule de 2 cases. |
| Excursion | 2, 0-6 | Glyphe qui échange un allié avec le Féca. |
| Giboulée, Bourrasque, Silbo | — | Éloignent une Bacterrib (§2.2). |

### 2.6 Protections

**Attention :** deux Krobes retirent 1 tour à tous les effets du Féca, donc ses protections d'un tour, avant que les Krobes suivants frappent :
- **la Bacterrib,** au début de son tour, quand il est à 6 cases ou plus d'elle ;
- **la Tabacille,** avec Remontée gastrique. Elle l'atteint de loin : elle marche, s'échange avec ses alliés (deux fois par tour) pour s'approcher, et lance à 2 ou 4 cases en diagonale (480 lancers relevés, 1 à 2 dans les données du jeu).

| Sort | PA, PO | Effet | Contre les Krobes |
|---|---|---|---|
| **Barricade** | 2, 0-7 | Invulnérable en mêlée 1 tour. Relance tous les 4 tours. | **Contre le Verminocule au contact.** [V] : en manche 6, sous Barricade au contact des 2 Verminocules, Tayro ne perd aucun PV. Au tour suivant, sans Barricade, il perd 1 157 entre son bouclier et ses PV. **Tombe au premier retrait.** |
| Bastion | 2, 0-7 | Invulnérable à distance 1 tour | Contre Sécrétion, Danse répulsive et Boulet Viral. Avec Barricade : 0 dommage, même en critique, tant qu'aucun retrait n'a eu lieu. **Tombe au premier retrait.** |
| **Défiance** | 2, 0-7 | +15 Tacle par ennemi au contact, +30 % de résistance en mêlée, glyphe 4 éléments | Au contact du Verminocule. Son glyphe frappe aussi les Krobes qui finissent leur tour dedans, au profit de la Malamibe (§2.3). |
| Bouclier Féca | 2, 0-5 | Dommages subis ×70 % | Relance tous les 3 tours. **Tient un retrait**, pas deux. |
| Fortification, Rempart, Refuge | 2-3 | Réduisent les dommages subis (Refuge : ×85 %) | |
| Ataraxie | 2, 0-5 | Pesanteur et ×25 % sur la première attaque, **alliés seulement** | Retirée à la première attaque subie, **jamais par un retrait** : premier coup à ×0,06-0,24 (13 coups mesurés). |
| Trêve | 3 | Glyphe en cercle de 2 : les entités deviennent Pacifistes | Les Krobes dedans ne peuvent plus attaquer [R]. Relance tous les 5 tours. Touche aussi les alliés. |
| Égide | 3, 0-4 | Bouclier qui intercepte les dommages des alliés dans sa zone | |

### 2.7 Empêcher les échanges des Tabacilles

L'échange d'un Tabacille relance la Virustine [B]. Dans la vidéo, cela arrive à 0:39 et décale sa mort à la fin de la manche 4 [V]. La Pesanteur l'empêche [B] :
- **Barrière** (3 PA, PO 0-6, relance tous les 3 tours) : Pesanteur sur un **ennemi** pendant 1 tour. Elle pose aussi un glyphe autour de lui qui le frappe dans les 4 éléments s'il le traverse.
- **Bergerie** (3 PA, PO 0-3, pas au premier tour) : glyphe carré de 5×5 qui donne Pesanteur et Inébranlable à toutes les entités qui s'y trouvent.

## 3. La vidéo, expliquée par ces règles [V]

Tayro : Féca Oméga 580, 4 962 PV, 12 PA, 5 PM, sorts surtout Eau.

| Manche | Ce qu'il fait | Pourquoi |
|---|---|---|
| M1 | Tayro et sa mule Lycris frappent les autres mules ; les monstres achèvent les dernières. Les 7 mules meurent avant la fin de la manche. | La Malamibe passe de 16 001 à 2 001 PV. |
| M1-M3 | Tayro reste à 6 cases ou plus des Bacterribs, ne se soigne pas et ne déplace pas la Virustine. Sa Giboulée en M4 est bloquée. | Les Tabacilles et la Bacterrib Ω6 meurent au début de M4. Les Bacterribs Ω12 et Ω9 (relancées en M1 par les mules proches) et la Virustine (échangée en M1) meurent pendant M4. |
| M2-M8 | Il tue chaque Malamibe en un tour, à environ 2 000 dégâts sur elle par tour avec 12 ou 13 PA. | Aucune n'atteint ses 2 tours. |
| M4-M5 | Personne n'est au contact des Verminocules. | Ils sont relancés à chaque tour. |
| M6-M8 | Barricade, puis contact. | Plus de relance (état Infection) : ils meurent à leur tour en M8, 3 manches après la relance de M5. |

**Combats 2 à 4 de la vidéo** (2:00 à 7:36, jeu en allemand ; lus sur le journal de combat à l'écran, 2 images par seconde) :

| Combat | Krobes | PV de Tayro | Déroulé |
|---|---|---|---|
| 2 (2:08-3:31) | 4 Bacterribs, 2 Virustines, Verminocule | 4 962 → 4 290 au plus bas → 4 644 | M1 : Escapade ×4, Ataraxie, fuite. Les mules prennent les coups des Bacterribs. M2-M4 : Malamibe tuée chaque tour (Bulle + Verglas ; Transhumance, Escapade ×4, Verglas ; Verglas, Stratus) ; les coups (−95 à −317) tombent sur ses boucliers (900 en M3). M5-M7 : contact du Verminocule, Barricade puis Bouclier Féca + Fortification. |
| 3 (3:43-5:36) | 4 Tabacilles, 2 Verminocules | 4 919 → 4 636 | **Contact du Verminocule dès M1** (Barricade, Ataraxie) : il meurt en M4. Les Tabacilles ne le frappent jamais (Pesanteur : pas d'échange) ; ils frappent les mules puis la Lanterne du Berger. |
| 4 (5:46-7:36) | Bacterrib, 2 Virustines, 2 Tabacilles, 3 Verminocules | 4 962 jusqu'à M5 → 2 472 au plus bas → 3 154 | M1 : il achève ses mules (arme, Bulle ×4). M2-M6 : Malamibe tuée chaque tour (Giboulée ×3-4, Verglas, Stratus). M7-M9 : les 3 Verminocules, groupés par **Regroupement**, puis Stratus qui les frappe tous (3 × 602 sur la Malamibe) ; Barricade, puis Bouclier Féca + Fortification ; ≈ −1 300 en une manche. |

**Ce qu'il fait autrement que le script :**
- **Les 7 mules prennent les coups de la manche 1** (et baissent la Malamibe de 16 001 à 2 001 PV). Seul, le Féca reçoit tout dès la manche 1.
- **Il tue la Malamibe dans le tour, à chaque fois** (≈ 2 000 dommages : 3 ou 4 sorts de zone, beaucoup de coups critiques, souvent 13 PA). Il ne la laisse jamais à son 2e tour.
- **En fuite, il ne lance que Ataraxie** (Pesanteur contre les Tabacilles). Ses boucliers d'objets (Prytek : 200, 400 puis 700 ; +200 à chaque protection) absorbent le reste. Barricade, Bouclier Féca et Fortification attendent la phase de tank.
- **Verglas à presque chaque tour** (3 PA, sans relance) : dommages Eau en zone, glyphe de Fuite, et **Lanterne du Berger** sur case libre. Verminocule et Tabacilles ont frappé la Lanterne (−302, −315) au lieu de lui.
- **Fortification** (« réduit les dommages de 176 » par coup, lu dans le journal) plutôt que Rempart.
- **Regroupement en fin de combat** : les Verminocules groupés, chaque sort de zone compte 3 fois pour la Malamibe.
- **Jamais Défiance, Bastion, Bergerie ni Rempart.**
- Variantes vues : Stratus, Verglas, Fortification, Regroupement, Giboulée, Escapade, Ataraxie, Barricade, Bouclier Féca, Bulle, Transhumance (Kaskyzo : Nimbus, Vallée, Rempart, Léthargie au lieu des quatre premières).

**Pistes pour aller plus vite [R] :**
- **Contact des Verminocules dès M4 :** les Bacterribs meurent au début de leur tour de M4, avant les Verminocules. Les Verminocules mourraient alors en M6 au lieu de M8.
  - Risque : si une Bacterrib vérifie la distance avant de mourir, elle repart. L'ordre exact est à vérifier.
- **Terre Battue sur les Krobes groupés en M1-M3 :** une attaque de moins par Krobe.
- **Pavois sur un Verminocule** (2 PA, PO 0-6 en ligne) : des boucliers à son contact. S'ils comptent comme combattants alliés, la condition est tenue sans aller en mêlée.

## 4. Script AnkaBot du Féca

Le Féca joue seul au Roc des Salbatroces. Un serveur de plans calcule chaque tour, et le script AnkaBot l'exécute.

### 4.1 Mise en route

1. Générer le script :
   - lancer `npm run feca:script` ;
   - il produit `tools/ankabot/FecaCombat.lua` et son lanceur `tools/ankabot/lancer_serveur_feca.cmd`.
2. Démarrer le serveur :
   - double-cliquer sur `lancer_serveur_feca.cmd`, ou lancer `npm run feca:serveur` ;
   - laisser la fenêtre ouverte pendant les combats ;
   - il écoute le port 8766 : il peut tourner en même temps que le serveur de la Reine ou de la Baleine (8765).
3. Déclarer les variantes de sorts équipées dans `data/fightlogs/variantes.json` :
   - format : `{ "Kaskyzo": ["Giboulée", "Ataraxie", "Escapade"] }` (noms ou identifiants) ;
   - pourquoi : la liste du jeu ne donne que le sort de base de chaque paire, et AnkaBot ne sait pas lire les variantes ;
   - le fichier est relu à chaque tour, sans redémarrer le serveur.
4. Dans AnkaBot :
   - charger `FecaCombat.lua` sur le Féca ;
   - choisir la configuration de combat « IA avancée dans le même script ».
5. Engager le combat soi-même. Le script place le Féca, puis joue tous ses tours.

### 4.2 Ce que fait le script à chaque tour

**Le script envoie au serveur :**
- la case, les PA et les PM du Féca ;
- l'état visible du combat : case, PV, PA et PM de chaque entité ;
- les sorts qu'il a lancés depuis le début du combat.

Ces envois sont nécessaires parce que son journal se tait pendant son tour (`QUIET_FROM_MY_TURN`), et qu'aucun autre personnage n'en tient un. Le serveur recale donc l'état du journal sur cet état visible.

**Le serveur calcule le plan** avec [planificateur.ts](../../../tools/feca/planificateur.ts), en deux phases tirées de la vidéo de référence :
- **fuite,** tant qu'un Krobe autre que les Verminocules vit : rester hors d'atteinte, pour qu'ils meurent tous au début de la manche 4. Le Verminocule est ignoré : sa relance ne coûte qu'un délai ;
- **tank,** quand il ne reste que des Verminocules : à leur contact, Barricade d'abord, puis Bouclier Féca, Défiance, Ataraxie…

Règles communes aux deux phases :
- **Malamibe :** elle doit mourir avant la fin du 2e tour du Féca qui suit son invocation. S'il la laisse vivre à son 3e tour, elle le tue d'un coup (règle confirmée en jeu par l'utilisateur).
  - **1er tour :** des dommages qui lui laissent au plus ce que le Féca pourra finir au 2e tour (80 % de ses meilleurs dommages par tour) ; le reste des PA va aux protections.
  - **2e tour :** la tuer est obligatoire.
- **Krobe condamné** (compte à rebours qui expire à son prochain tour) : ignoré. La Malamibe qu'il a invoquée meurt avec lui.
- **PV du Féca :** chaque PV perdu compte 1,5 point. Les dommages attendus de chaque Krobe sont ceux mesurés sur le Féca (`DANGER_FECA`, [feca.ts](../../../tools/feca/feca.ts)) : environ 440 par attaque, 820 au plus. Les Crâs en prenaient 2 à 3 fois plus.
- **Coup d'après (phase de fuite) :** les monstres qui chargent (Verminocule, Pataugerme, Virustine, Tabacille) sont projetés vers la case de fin du Féca. Le planificateur compte les dommages qu'il ne pourra pas éviter au tour suivant, à pied ou par Transhumance. Une case qui l'enferme est pénalisée.
- **Transhumance pour fuir :** ses arrivées visent les cases que le moins de monstres peuvent toucher.
- **Réserve des protections :** une protection à longue relance (Barricade, Bastion, Bouclier Féca, Rempart, Défiance) n'est lancée que si elle évite plus de dommages ce tour-ci qu'au suivant.
- **Retraits :** chaque Bacterrib à 6 cases ou plus et chaque Tabacille à portée de Remontée gastrique ôtent un tour aux effets du Féca. Une protection ne compte que contre les Krobes qui jouent avant son retrait. Ataraxie ne compte que sur la première attaque du premier Krobe qui frappe.
- **Glyphe de Défiance :** ses dommages sur les Krobes attendus dedans en fin de tour (Verminocule au contact, Virustine qui peut venir au contact) comptent pour la Malamibe.
- **Gonflement :** un Verminocule qui atteint le Féca sans être à son contact l'attire à son contact ; les monstres suivants frappent depuis cette case. Bergerie (Inébranlable) l'en empêche.
- **Échange subtil :** une Tabacille qui peut s'aligner à 1-4 cases du Féca (à pied, ou après un échange avec un de ses alliés) l'échange : il se retrouve sur sa case, et les monstres suivants frappent de là. La Pesanteur l'en empêche (Ataraxie ; Bergerie s'il finit dans son glyphe). Journaux du 2026-10-17 : 27 échanges sur 156 tours de Tabacille sans Pesanteur, aucun sur 11 sous Ataraxie, comme dans la vidéo.
- **Manche 1 comme la vidéo (consigne du joueur, 2026-10-17 à 23:10)** : Kyanna-Lee est **tueuse** (`TUEUSES`, [feca.ts](../../../tools/feca/feca.ts)). Placée avec les mules, elle les tue à son 1er tour (sorts de zone ; ses dommages viennent de ses vraies caractéristiques, donc de ses sorts Eau si elle est équipée Eau), puis finit au plus près des Krobes pour y mourir. Le Féca entame ses PV à son 1er tour (jusqu'à lui en laisser un quart), sans la tuer tant qu'une mule vit ; sans mule, elle compte comme une mule. Les mules avancent vers les Krobes. But : à la fin de la manche 1, seul le Féca reste, Malamibe à 2 001 PV.
- **Kyanna-Lee (Crâ 199), joueuse** (consigne du joueur, 2026-10-17) : jouée par le serveur du Féca avec le planificateur des Crâs de la Baleine ([planificateur.ts](../../../tools/ventre-de-la-baleine/planificateur.ts)). Elle frappe les Krobes, et chaque coup compte double sur la Malamibe ; elle achève aussi les mules quand ça réduit la Malamibe. Elle ne déplace aucune Virustine (toutes, plus seulement la première), ne soigne pas tant qu'une Tabacille vit, et ne tire jamais sur le Féca. Deux journaux (Féca et Crâ) : le serveur prend le plus récent tel quel, sans fusion (`workerData.joueurs`).
- **Mules** (tout personnage du groupe absent de `JOUEURS`, [feca.ts](../../../tools/feca/feca.ts) ; AnkaBot leur charge le script du chef) :
  - placement : en appât, groupées sur les cases que les Krobes frappent dès leur premier tour, hors de la case du Féca ([placement.ts](../../../tools/feca/placement.ts)). Le Féca seul ne tue pas à temps des mules de 1 000 à 2 000 PV : ce sont les monstres qui doivent les tuer en manche 1. Vidéo : mules à 2-5 cases des monstres, toutes mortes vers 0:35 ; 2026-10-17 à 20:07, mules groupées près du Féca, à 11-12 cases des 3 monstres, jamais touchées, équipe tuée par la Malamibe (12 001 PV) en manche 3 ;
  - tours passés, pas de journal (le serveur ne garde que celui du Féca) ;
  - vivantes, chacune ajoute 2 000 PV à la Malamibe : une mule tuée compte comme 2 000 dommages sur elle (800 points au 1er tour, avant son invocation). Vivantes, elles prennent aussi leur part des coups des Krobes ;
  - une mule au contact d'un Verminocule tient sa condition ; une mule à 5 cases ou moins d'une Bacterrib la relance (pénalité) ;
  - à chacun de leurs tours, elles avancent vers le Krobe le plus proche pour s'y faire tuer (`MULES_AVANCENT`). 2026-10-17 à 23:01 : les deux tours du Féca joués (1 939 puis 3 646 sur la Malamibe), Kyanna-Lee 1 070, mais 4 mules à l'écart des monstres jamais touchées : Malamibe à 12 001 PV, environ 5 350 de trop, équipe tuée en manche 3.
- **Lanterne du Berger, leurre [R] :** posée par Verglas sur une case libre, elle prend le premier Krobe qui peut la frapper et n'en est pas plus loin que du Féca. Ce Krobe ne garde qu'un tiers de ses coups pour le Féca, et ne l'attire pas. Vu deux fois sur deux dans la vidéo, jamais encore dans les combats de Kaskyzo : à vérifier sur les prochains journaux (note « Lanterne du Berger : leurre pour … »).
- **Regroupement :** il attire de 2 cases tout ce qui est à 1-3 cases du Féca ; ses dommages, et ceux des sorts de zone qui suivent, comptent pour chaque Krobe touché. Interdit s'il déplace une Virustine ; une Bacterrib attirée à 5 cases ou moins est pénalisée.
- **Pataugerme :** ses 4 éléments valent peu (250 par élément). Sa relance ne coûte qu'une manche ; le Féca ne s'expose pas pour la lui éviter.

Il renvoie ensuite des déplacements et des sorts. Le script les exécute, et redemande un plan (2 fois au plus) quand un sort est refusé ou qu'un déplacement s'arrête en route.

**Le placement** est choisi comme pour la Baleine : la case la moins exposée, à 6 cases ou plus des Bacterribs.

**Traces laissées :**
- `data/fightlogs/<date>/session-*.jsonl` : le journal ;
- `data/fightlogs/<date>/plans-*.jsonl` : chaque plan, avec sa note détaillée ;
- `ia_feca_<personnage>_<date>.log`, à côté du script : ce que le script a fait.

### 4.3 Améliorer le script

Ce qu'on peut régler :
- **[planificateur.ts](../../../tools/feca/planificateur.ts), `W` :** les poids de la note (Malamibe, PA retirés, menaces, Bacterribs, contact du Verminocule…) ;
- **[feca.ts](../../../tools/feca/feca.ts), `PROTECTIONS` :** l'effet de chaque protection ;
- **[feca.ts](../../../tools/feca/feca.ts), `MELEE` :** la part des dégâts de chaque Krobe portée au contact ;
- **`DANGER`** ([planificateur des Crâs](../../../tools/ventre-de-la-baleine/planificateur.ts)) : les dommages d'un Krobe par tour, mesurés sur les Crâs de la Baleine. Ils sont à remesurer sur le Féca.

Méthode, après une série de combats :
1. Rejouer les plans avec le planificateur actuel : `npm run feca:rejouer -- --plans data/fightlogs/<date>/plans-<heure>.jsonl`. Chaque plan enregistré garde l'état que le script avait envoyé.
2. Chaque cas raté devient une situation de [tests/feca-planificateur.test.ts](../../../tests/feca-planificateur.test.ts) avant correction.

**Combat du 2026-10-17 (perdu, Ventre de la Baleine salle 2, Kaskyzo) :**
- **Manche 1 :** le Féca est allé au contact du Verminocule, à portée des deux Bacterribs.
- **Manche 2 :** Sécrétion lui avait retiré 2 PM. Toutes ses cases atteignables étaient alors menacées par les 4 monstres. Il est mort en manche 4.
- **Corrections :**
  - phase de fuite : rejoué, le tour 1 finit hors d'atteinte (case 360) ;
  - variantes déclarées : Torpeur, planifiée à la place d'Escapade, avait bloqué le script ;
  - lancers transmis avec leur cible : Bulle avait été refusée, déjà lancée 2 fois sur la même cible ;
  - manche d'AnkaBot prise en compte : le journal avait une manche de retard.
- **Particularité de la salle 2 :** le Pataugerme exige les 4 éléments à chaque manche, donc il faut l'approcher. Fuir et le toucher se contredisent ; le Roc des Salbatroces n'a pas ce problème.

**Combat du 2026-10-17 à 02:20 (gagné en 8 manches, même salle) :**
- **Manche 1 :** le Féca reste hors d'atteinte.
- **Manches 3 et 4 :** il donne au Pataugerme ses 4 éléments (Somnolence et Retour du Bâton pour la Terre). Le Pataugerme, relancé en manche 2, meurt en manche 5.
- **Bacterribs :** jamais relancées, elles meurent au début de la manche 4.
- **Malamibe :** tuée à chaque tour.
- **Fin :** contact du Verminocule à partir de la manche 6 ; il meurt en manche 8.
- **Corrigé ensuite :**
  - **seul, le journal est pris tel quel :** la fusion perdait le début de chaque manche. Chaque plan attendait 3 à 6 s avant d'être calculé malgré tout (« journal en retard ») ;
  - **les Krobes condamnés sont ignorés :** leur compte à rebours expire à leur prochain tour, et la Malamibe qu'ils ont invoquée meurt avec eux. Rejouée, la manche 5 passe en phase de tank : contact du Verminocule et protections, au lieu de 12 PA pour tuer la Malamibe d'un Pataugerme condamné. Le Verminocule serait mort en manche 7.

**Combats du 2026-10-17 à 02:38 et 02:42 :**
- **Salle annexe (2 Verminocules, Virustine, Pataugerme) : gagné en 16 manches, PV pleins au départ.**
  - **Manche 4 :** le Féca est allé donner ses 4 éléments au Pataugerme.
  - **Manche 5 :** encerclé par les deux Verminocules et le Pataugerme, toutes ses protections en relance, il a perdu 2 024 PV.
  - **Manches 6 à 16 :** avec 542 PV, il n'a plus osé rester au contact du Verminocule, relancé encore et encore.
  - **La salle est trop petite (139 cases) pour fuir :** dès la manche 4, toutes les cases atteignables étaient à portée des trois monstres.
- **Salle 4 (Bacterrib, Virustine, 2 Pataugermes) : perdu en manche 3, mi-PV au départ.**
  - Le tour de la manche 2 n'a pas été joué : AnkaBot a lancé le script alors que `isItMyTurn()` restait faux pendant 1,5 s.
  - Dès la manche 3, la Malamibe était donc à son 2e tour : il fallait la tuer, à découvert.
- **Corrigé ensuite :**
  - dommages mesurés sur le Féca ;
  - coup d'après et Transhumance pour fuir : rejouée, la manche 5 se dégage en 312 puis 241, au lieu de rester au contact des trois ;
  - réserve des protections ;
  - éléments du Pataugerme moins prioritaires ;
  - attente du début de tour portée à 10 s dans le script (`ATTENTE_MON_TOUR`).

**Combats du 2026-10-17 de 02:56 à 03:02 :**
- **Salle 4 (Bacterrib, Virustine, 2 Pataugermes) : perdu en manche 5.**
  - Manches 1 à 3 : bien jouées, toutes les protections en manche 3, −360 PV seulement.
  - À partir de la manche 4, il ne reste que les deux Pataugermes. Le Féca a donné ses 4 éléments à l'un d'eux. La Brûlure d'estomac de celui-ci est alors passée à 5 lignes (444, puis 664 dommages), plus l'Attaque souterraine (554 et 593, −3 PM).
  - Résultat : −1 573 PV pendant la manche 4, puis la mort.
- **Pataugerme en solo : un piège.** Pour qu'il meure, il faut lui donner ses 4 éléments à chaque manche pendant 3 manches, et chaque élément ajoute une ligne de 60 à 200 dommages à sa Brûlure suivante. Avec deux Pataugermes, il faudrait encaisser de l'ordre de 8 000 dommages pour environ 4 300 PV. La salle 4 ne paraît pas faisable en solo avec ce Féca.
- **Corrigé :** éléments suivis pour chaque Pataugerme, et chaque élément donné coûte sa ligne de Brûlure (`BRULURE_PAR_ELEMENT`, 130 dommages).
- **Roc des Salbatroces, juste après, avec la moitié des PV :**
  - Virustine et 2 Tabacilles : 5 manches, sans perdre un PV ;
  - Virustine et Verminocule : gagné en 8 manches, −116 PV.
  - 2 Tabacilles, Virustine, Bacterrib et Verminocule : perdu en manche 6. Le Féca n'a reçu que 80 dommages : il est mort d'un coup, tué par la Malamibe (992 PV à tuer ; deux Nimbus prévus à ≈ 1 000, 4 PA inutilisés).
  - 2 Virustines : perdu en manche 3, de la même façon (715 PV à tuer, une seule Giboulée).
- **Corrigé ensuite :**
  - **marge pour tuer la Malamibe :** les dommages prévus (jets moyens) dépassent les vrais de 1 à 9 %. Elle ne compte comme sûrement tuée qu'au-delà de 1,25 × ses PV. Rejoués, les deux tours mortels prévoient 1 280 dommages pour 992 PV, et 1 367 pour 715 ;
  - **ordre de jeu du personnage seul :** c'est la liste des tours envoyée par le jeu qui fait foi. Elle était écartée dès qu'un monstre mourait, et le Féca, absent de l'ordre, n'était gardien d'aucun Verminocule ;
  - **contact compté pendant la recherche** (phase de tank) : la Transhumance au contact d'un Verminocule n'est plus écartée ;
  - **toutes les Virustines protégées :** seule la première l'était.

**Combats du 2026-10-17 au matin (Roc des Salbatroces, environ la moitié des PV à chaque départ) :**
- **Bacterrib et 2 Virustines :** aucune relance, ils meurent au début de la manche 4.
- **Verminocule et Virustine :** gagné en 8 manches.
- **7 monstres (2 Tabacilles, 2 Verminocules, Bacterrib, 2 Virustines) : perdu en manche 2, 2 542 PV au départ.**
  - En manche 1, un Tabacille a échangé le Féca au milieu du groupe, alors que la case 316 était hors de toute portée calculée : il peut d'abord s'échanger avec un allié pour s'aligner.
  - En manche 2, le Féca a pris environ 2 500 dommages en un seul tour de monstres, dont Contamination 557 et Boulet Viral 908 par une même Virustine.
- **Corrigé ensuite :**
  - **Pesanteur contre les Tabacilles :** sous Pesanteur (Ataraxie sur soi, Bergerie), le Féca ne peut pas être échangé. Rejouée, la manche 1 lance Ataraxie avant d'aller en 316 ;
  - **dégâts de la Virustine :** relevés à 1 100 par tour.
**Série du 2026-10-17 vers midi (Roc des Salbatroces, 4 gagnés sur 5) :**

| Groupe | PV au départ → à la fin |
|---|---|
| Tabacille, Verminocule, Bacterrib | 2 580 → 2 580 |
| 2 Verminocules, 2 Bacterribs, Virustine | 4 960 → 2 868 |
| 2 Verminocules, 2 Bacterribs | 3 306 → 939 |
| 2 Tabacilles | 2 541 → 2 541 |
| 2 Tabacilles, **3 Bacterribs** | 2 635 → mort en manche 3 (−821 en manche 1, −1 654 en manche 2) |

- **Les Bacterribs font presque tous les dégâts :** 400 à 700 par Bacterrib et par manche, à 6-10 cases, jusqu'à leur mort en manche 4.
- **Les protections ne servent à rien contre elles :** chaque Bacterrib retire, au début de son tour, 1 tour à tous les effets du Féca quand il est à 6 cases ou plus d'elle.
- **S'approcher à 5 cases ou moins ne vaut pas mieux :** le compte à rebours de la Bacterrib repart pour 3 manches.
- **Seule parade :** finir hors de leur ligne de vue (Sécrétion) et hors de leurs lignes (Danse répulsive). Le modèle de menaces en tient déjà compte, quand une telle case existe.

- **À faire hors de l'algorithme :** partir PV pleins et éviter les gros groupes, surtout avec 3 Bacterribs ou plus. AnkaBot régénère avant les combats qu'il lance lui-même (seuil de vie de son interface) et sait filtrer les groupes (`MAX_MONSTERS`, `AMOUNT_MONSTERS`).

**Série du 2026-10-17 de 12:11 à 12:20 (Roc des Salbatroces, une Bacterrib au plus, 4 gagnés sur 5) :**

| Groupe | PV au départ → à la fin |
|---|---|
| Tabacille, Bacterrib, Verminocule, Virustine | 3 436 → 3 418 |
| Tabacille, Verminocule | 3 566 → 3 447 |
| 2 Tabacilles, Virustine, Bacterrib | 3 528 → 3 528 |
| Tabacille, Bacterrib, 2 Virustines | 3 575 → 1 538 (−1 275 en manche 1) |
| Tabacille, Bacterrib, Verminocule, Virustine | 2 499 → mort en manche 4 (−904, −725, −372, −498) |

- **Même groupe, 0 ou 2 500 PV perdus :** tout dépend de la carte de placement. Quand les cases du Féca sont mêlées à celles des monstres (carte 140513539), Virustine et Bacterrib frappent dès la manche 1.
- **Protections perdues en manche 1, deux fois :** Rempart, Bastion, Barricade, Bouclier Féca, Ataraxie et Défiance lancés, puis retirés avant les coups :
  - combat 4 : par la Bacterrib, au début de son tour (déjà connu du planificateur) ;
  - combat 5 : par la Remontée gastrique de la Tabacille, arrivée de 9 cases après deux échanges avec la Bacterrib puis la Virustine.
  - Le planificateur les lançait quand même : rien ne lui coûtait de les gaspiller.
- **Corrigé :**
  - **Tabacille :** comptée comme la Bacterrib. Ses protections d'un tour ne protègent plus le Féca de la Tabacille ni des Krobes qui jouent après elle, quand elle peut l'atteindre (`PORTEE_REMONTEE`, `PORTEE_ECHANGE`, `ECHANGES_PAR_TOUR`, [feca.ts](../../../tools/feca/feca.ts)) ;
  - **réserve des protections :** elle ne compte plus les dommages évités par une protection qui sera retirée. Rejouée, la manche 1 du combat 5 ne lance que Barricade (contre le Verminocule, qui joue avant la Tabacille) et garde le reste ; celle du combat 4 ne lance qu'Ataraxie.
- **Le combat perdu est surtout parti à mi-PV :** 2 499 PV, et ~2 000 perdus en 3 manches sans pouvoir fuir. Avec les PV pleins, il passait.

**Mesure des protections (218 coups reçus par Kaskyzo le 2026-10-17, rapportés à leur valeur habituelle) :**

| Protection | Intacte | Après un retrait |
|---|---|---|
| Barricade + Bastion | 0 dommage (6 coups, dont un critique) | ×1 : retirées (journal : « effets retirés », +2 PM, +200 Puissance) |
| Ataraxie, première attaque | ×0,06 à ×0,24 | pareil : pas retirée |
| Rempart + Bouclier Féca | ×0,51 | ×0,44 à ×0,51 : toujours là |
| Rempart seul | ×0,5 | ×0,9 : retiré [R] |

- **Où partent les PV (toute la journée) :** Verminocule 7 470 (phase de tank), Bacterrib 8 100, Pataugerme 7 270 (Baleine), Virustine 4 600, Tabacille 1 500. Le bouclier du Féca a absorbé 17 466 dommages de plus.
- **Sorts lancés (134 tours) :** Nimbus 73, Giboulée 50, Ataraxie 43, Bulle 40, Escapade 38, Rempart 33, Barricade 29, Bouclier Féca 24, **Défiance 17** (6 en fuite, 11 en tank), Bastion 16, Silbo 16, Transhumance 12.
- **Corrigé :** durées des protections ci-dessus (`PROTECTIONS`, [feca.ts](../../../tools/feca/feca.ts)), Ataraxie sur la première attaque, glyphe de Défiance compté pour la Malamibe. Rejoué, Défiance passe de 9 à 11 lancers sur la session de 09:54.
- **Corrigé aussi :** les nœuds qui déplacent le Féca par un sort (Transhumance, Escapade) sont toujours notés à la case de fin. La Transhumance qui dégage la salle annexe encerclée était chassée par les sorts qui donnent ses éléments au Pataugerme.
- **Piste, variante non équipée :** **Refuge** (à la place de Terre Battue, dont les retraits de PA échouent sur les Krobes, esquive PA 49) : glyphe-aura ×85 % pendant 2 tours, 3 PA, **sans relance**, et des dommages Terre en zone. À vérifier : un retrait enlève-t-il l'effet d'un glyphe-aura ?

**Combats du 2026-10-17 de 13:02 à 13:30 (Roc des Salbatroces) :**
- **13:02 à 13:11 : 5 combats, gagnés,** dont 2 Tabacilles + Verminocule, 3 Verminocules + Virustine + 2 Tabacilles, 2 Bacterribs + Verminocule. Défiance posé en phase de tank.
- **À partir de 13:18, l'objet « Le Singe et la Lune » est porté.** Il soigne le Féca de 10 % de sa vie au début de ses tours 3, 6, 9… (+496 PV en manche 3, +476 en manche 6). Or tout soin relance les Tabacilles, et le journal, muet pendant le tour du Féca, ne voit ni le soin ni la relance.
  - **Une Tabacille qui joue après le Féca ne meurt plus :** relancée en manche 3, elle mourrait en manche 6, mais le soin de la manche 6 passe avant son tour. Avec cet objet, ces combats ne peuvent pas être gagnés.
  - **13:26 et 13:29, Tabacille + Verminocule, perdus :** le planificateur croyait la Tabacille condamnée depuis la manche 4. En manches 6 à 8, il n'a plus rien joué, et la Malamibe qu'elle avait invoquée a tué le Féca.
- **13:18, 2 Virustines + Bacterrib + Tabacille, perdu en manche 3 sans un coup reçu :** le tour 3 du Féca n'a pas été joué (0,5 s entre le début de la manche et le tour de la Bacterrib, aucun plan demandé, rien dans `ia_feca_*.log`). La Malamibe, invoquée en manche 1 et entamée de 1 192 PV en manche 2, a tué le Féca au début du tour de son invocatrice en manche 3.
- **Corrigé :**
  - **Krobe encore vivant après sa mort attendue :** il a été relancé sans que le journal le voie ; il n'est plus condamné ;
  - **« Le Singe et la Lune » reconnu** (son sort 6149 au début du combat) : les Tabacilles repartent à chaque soin, et une note le signale.
- **À faire hors de l'algorithme :** retirer « Le Singe et la Lune » contre les Krobes.

**Combat du 2026-10-17 à 14:25 (2 Tabacilles, 3 Verminocules, 2 Virustines), perdu en manche 3 :** 4 833 PV au départ. Manche 1 bien jouée (Barricade, Bastion, Bouclier Féca, Ataraxie ; aucun coup reçu). Tour 2 sauté (`isItMyTurn()` faux 10 s), donc aucune protection : −1 925 PV (Virustine 799, deux Verminocules 658 et 468). Tour 3 sans plan demandé ; le Féca tué par la Malamibe invoquée en manche 1, au début du tour de la Virustine. Voir §4.4, tours sautés.

**Variantes de Kaskyzo à partir du 2026-10-17 après-midi**, celles de la vidéo : Verglas (au lieu de Vallée), Fortification (au lieu de Rempart), Regroupement (au lieu de Léthargie), en plus de Giboulée, Ataraxie et Escapade (`data/fightlogs/variantes.json`). Rejouées sur la session de 09:54 : Verglas dans 30 tours sur 58, Lanterne leurre dans 8, Fortification dans 8.

**Combat du 2026-10-17 à 13:41 (Roc des Salbatroces, 3 Verminocules, 2 Virustines, 2 Tabacilles), perdu en manche 8 :** objet de soin retiré, 3 110/4 960 PV au départ.

| Manche | PV perdus | Ce qui s'est passé |
|---|---|---|
| 1 à 3 | −563 | Malamibes tuées à temps. |
| 4 | **−1 678** | Fin en 489, à portée d'un seul Verminocule. Son Gonflement **attire** le Féca en 460, à portée des deux autres Verminocules et d'une Virustine. Le plan attendait ≈ 550. |
| 5 | 0 | Barricade, Bastion, Bouclier Féca, Ataraxie, Défiance : tout évité. |
| 6 | −604 | Virustine (Contamination 500). |
| 7-8 | mort | Il ne reste que les 3 Verminocules, mais avec 265 PV, impossible de les tenir au contact 3 manches. |

- **L'attirance du Gonflement n'était pas modélisée.** Mesure sur la journée : à 3-4 cases d'un Verminocule (en ligne ou en diagonale), le Féca est souvent attiré à son contact.
- **La Pesanteur n'empêche pas l'attirance :** données du jeu, l'état 7 empêche seulement les échanges ; le Féca a été attiré 3 fois sur 10 sous Ataraxie. **Inébranlable** (état 157, « ne peut pas être poussé »), que donne Bergerie, l'empêche.
- **Corrigé :**
  - **coups attendus dans l'ordre des tours :** un Verminocule qui atteint le Féca sans être à son contact l'attire, et les monstres suivants frappent depuis la nouvelle case. Sous Inébranlable, pas d'attirance ;
  - **Bergerie essayée :** ses nœuds, comme ceux des protections, sont gardés pendant la recherche et notés à la case de fin. Avant, elle n'était jamais évaluée. Rejouée, la manche 4 lance Rempart, Giboulée et Bergerie, et finit Inébranlable en 489 : un seul Verminocule frappe (≈ 650 au lieu de 1 678).
- **PV au départ :** 3 110. Avec les PV pleins, il restait ≈ 2 100 PV en manche 7 pour tenir les Verminocules.

### 4.4 Limites de la première version

**Version simplifiée (2026-10-17, 23:40, avec l'utilisateur) :** au lancement de `fightManagement`, `isItMyTurn()` faux → main rendue ; sinon le journal envoie ce qu'il a (sans attendre les messages que l'AnkaBot retient), le plan est demandé aussitôt (le serveur planifie dès la 1re demande, `ATTENTE_PLAN` 0, sur le journal reçu et l'état visible), la réponse est attendue par courtes demandes espacées de 100 ms, puis les actions sont jouées. Le journal enregistre et envoie normalement (plus de silence autour du tour, de report des envois, de file d'attente). Retirés : attentes autour de `isItMyTurn()`, main gardée jusqu'au tour suivant, pause après un déplacement final, messages remis de force (`suspendScriptUntil`), main rendue d'après le journal. Malamibe invoquée juste avant le tour et absente du journal : ajoutée depuis l'état visible, comme invoquée dans la manche (corrigé à 23:55 : tenue d'abord pour à tuer d'urgence, le Féca frappait les Krobes au 1er tour). **Manche 1 avec mules (23:55, consigne du joueur) :** placement — Féca au plus loin des monstres à exposition égale, mules au plus près, Kyanna-Lee à 3-6 cases du groupe (portée d'Œil de Taupe) ; Féca — tant que des mules vivent, les Krobes ne comptent qu'à 10 % (sauf Malamibe à tuer dans le tour), chaque PV retiré à une mule compte plein, plus de pénalité d'échéance (rejeu de 23:43 : Barricade, Giboulée et trois Bulles sur les mules, au lieu de Verglas, Stratus et Bulle sur les Krobes) ; Kyanna-Lee — sorts Eau seulement (Œil de Taupe, Flèche Glacée, d'Expiation, d'Immobilisation). **2026-10-18, 00:20 :** dommages du Féca sur les alliés comptés pour Bulle seulement (en jeu, Silbo 14 à 33 par mule, Giboulée 59 à 132 ; le moteur en prévoyait 3 à 6 fois plus) ; Krobes de nouveau comptés pleinement avec des mules en vie (ces dommages restent acquis sur la Malamibe et Bulle ne se lance que 3 fois par tour : combat de 00:14 perdu d'environ 170 PV, deux Silbo inutiles au 1er tour ; rejeu : Stratus à la place, 1 110 de plus sur la Malamibe). Plan attendu jusqu'à 15 s (`SONDE_MAX_MS`) : 4,5 à 8,2 s au 1er tour avec les mules. **Coup d'arme (2026-10-18 ; vidéo, combat 4 : « arme, Bulle ×4 ») :** sort 0 d'AnkaBot, au contact d'une mule ou de Kyanna-Lee seulement. Mesuré sur 3 essais (00:38 à 00:42) : accepté par AnkaBot et enregistré par le journal comme un lancer ; **5 PA** (avec 4, le dernier sort du plan refusé faute de PA) ; par cible, Eau 355 à 493 puis deux lignes Air de 81 à 114 (≈ 700 sur une mule, 1,5 à 1,75 fois une Bulle) ; zone : la cible et ses voisines, sans baisse (mule derrière la cible −699), jamais le Féca. Modèle (`ARME`) : Eau 30-36 en croix de 1. Corrigé avec : un autre sort que Bulle ou l'arme qui achève une mule dans le moteur est écarté (sa mort ne serait pas réelle ; Langueur prévue pour finir deux mules). **Combats à la main (2026-10-18, idée du joueur) :** `tools/ankabot/FecaMain.lua` (`npm run feca:main`) laisse le placement et les tours de Kaskyzo au joueur (main gardée jusqu'au début du combat puis jusqu'à la fin de chaque tour, sinon AnkaBot le mettrait prêt ou finirait son tour), note le plan que le serveur aurait joué (`ia_feca_Kaskyzo_*.log`, `plans-*.jsonl`) ; Kyanna-Lee et les mules jouent comme d'habitude. **Tours sautés : lancement anticipé ? (2026-10-18, 01:51 ; nuancé à 02:12, voir après).** Heures de réception par le serveur (champ `at` des lots) : à 23:51:21.861 UTC, le journal du Féca reçoit encore en direct le tour de la Virustine (Contamination sur Scodar-Jasonny) ; `fightManagement` du Féca est lancé juste après (24235.554, isItMyTurn() vrai, manche 2), le journal se tait 1,7 s (messages retenus), puis livre la fin du tour de la Virustine, le tour de la Malamibe et, 13 ms avant le retour du script, le vrai début de tour du Féca, fini 4 ms plus tard. Même schéma à 01:40 (Pitou tuée par la Virustine au début de la manche 2). `playTurnAfter` à 1 000 ms n'y change rien (lancé 180 ms après le début du tour de la Virustine). Parade : `ATTENTE_VRAI_TOUR_MS` (8 s) — isItMyTurn() faux avant la première action : on attend le vrai tour au lieu de rendre la main, puis le plan est redemandé. **02:01 et 02:12 :** même perte avec cette parade, puis sans aucun appel à isItMyTurn() (`VERIFIER_MON_TOUR = false`) : le script, encore en attente de son plan, s'arrête sans écrire une ligne de plus, et le tour du Féca est fermé. Mais l'état visible envoyé au lancement de 02:12 montre le Féca déjà déplacé par le 2e Échange subtil de la Tabacille : AnkaBot était en avance sur le journal, le lancement n'était donc peut-être pas anticipé. Ni le silence du journal (16:52 à 23:40 : 6 tours sautés sur 39 après la Malamibe, contre 9 sur 68 sans), ni isItMyTurn(), ni les réglages d'AnkaBot (identiques à ceux de la Reine) n'expliquent l'écart avec la Reine, qui joue ses tours appris tout de suite. **Essai (02:40) :** plan rapide (`PLAN_RAPIDE` du script, `PLAN_RAPIDE` de tools/feca/feca.ts) : premier pas joué aussitôt, plan complet pour la suite. Sans effet (02:40 à 02:43 : 3 tours 2 fermés, deux fois par le jeu avant même le lancement du script, 4 ms et 0,44 s après l'ouverture avec `playTurnAfter` à 1 000 ms). **Cause : le mode de combat rapide d'AnkaBot.** En mode Safe (`SpeedFightType` 0), de 02:55 à 03:15 : 9 combats, 8 gagnés, **0 tour fermé sur 22 tours du Féca joués juste après la Malamibe** (contre environ 1 sur 8 en mode rapide). Plan rapide retiré. **Essai B (12:24 à 12:38) :** mode rapide, `skipTurnAfter` 1 000 ms, `playTurnAfter` 1 000 ms — 4 combats, 1 tour fermé sur 25 (manche 2 du combat de 12:31 : ouvert 18 ms, script lancé 1,2 s après l'ouverture), juste après une Virustine qui n'a rien fait (sa Malamibe était morte) : un tour ennemi instantané, comme celui de la Malamibe. `skipTurnAfter` n'est donc pas la cause. Bilan des sessions : `npm run feca:tours` (tools/feca/tours.ts). **Essai D (12:57 à 13:00) :** mode rapide, délais à 0, journal muet (`FecaCombatMuet.lua` : aucune requête HTTP depuis un message reçu en combat, silence et file autour du tour) — tour 2 du combat de 12:59 fermé juste après la Malamibe, même signature (script lancé au début du tour de la Virustine invocatrice, coupé, tour du Féca fermé), Malamibe à 1 919 PV, combat perdu. Le journal n'y est donc pour rien. **Bilan des essais :** mode rapide, journal normal, environ 1 tour fermé sur 8 juste après la Malamibe ; rapide + `skipTurnAfter` 1 000 : 1 sur 25 ; rapide + journal muet : 1 sur 4 ; mode Safe : 0 sur 54. Cause : le mode de combat rapide d'AnkaBot ; aucune partie de notre code n'est nécessaire au défaut. **Vraie cause (trouvée par le joueur, 2026-10-18 au soir) : le mode MITM d'AnkaBot ouvert pendant les combats** (bug connu d'AnkaBot) ; les sessions sans tours fermés étaient celles où il était fermé. Le joueur ne l'ouvre plus pendant le script ; ensuite, 27 combats, 19 gagnés, 1 tour douteux sur 73. Les entrées ci-dessous retracent les essais de la journée ; plusieurs de leurs conclusions reposaient sur des heures de messages faussées par l'AnkaBot.

- **Le moteur repart des seules positions et PV à chaque tour.**
  - Il ne connaît ni les glyphes posés aux tours précédents ni les effets en cours sur le Féca.
  - Il ne compte donc pas les dégâts des glyphes de début de tour sur les Krobes (Vallée, Terre Battue), ni le redéclenchement d'anciens glyphes par Transhumance.
- **Les invocations ne tiennent pas la condition du Verminocule :** la Lanterne du Berger et les boucliers du Pavois ne comptent pas comme contact (§5).
- **Risque de tours passés.**
  - Le journal reste actif pendant le tour du monstre qui précède le Féca.
  - Le 2026-10-10, un journal occupé au moment du changement de tour avait fait passer des tours.
  - À surveiller dans `ia_feca_*.log`.
- **Tours sautés, 3 fois le 2026-10-17** (Baleine salle 4 en manche 2 ; Roc des Salbatroces à 13:18 en manche 3 ; à 14:25 en manches 2 et 3). Côté jeu, le tour du Féca dure moins d'une demi-seconde. Côté script, soit `fightManagement` n'est pas lancé, soit il l'est alors que `isItMyTurn()` reste faux pendant 10 s. Deux fois sur trois, la Malamibe était à son 1er tour et a tué le Féca. Depuis 14:36, le script écrit son journal dès le début de `fightManagement`, et note le tour et l'entité qu'AnkaBot croit voir jouer (`fightAction:getCurrentTurn()`, `fightSlave:name()`) quand `isItMyTurn()` est faux.
  - **14:38, 4e cas, même schéma :** Malamibe invoquée en manche 1 après le Féca, tour 3 du Féca fini en 0,48 s sans lancer le script, Malamibe (205 PV restants) qui tue au tour de son invocatrice. Or AnkaBot attend 1 à 2,5 s avant de lancer le script (`playTurnAfterMin/Max` de la configuration de Kaskyzo) : ce n'est pas lui qui a fini ce tour normalement.
  - **Depuis 14:55, le journal note chaque tour du Féca** (événement `myTurn` : durée accordée par le jeu, champ `fxjq` du début de tour, et durée réelle), sans rien envoyer pendant le tour.
  - **15:07, 5e cas (6 monstres), mesuré :** le jeu accorde 42 s au Féca (`wait` 420) à chaque tour ; tour 1 : 9,3 s ; tours 2 et 3 : **0 s**. AnkaBot lance `fightManagement` 1 à 2,5 s après le début du tour, alors qu'une Virustine joue déjà. Ce tour est donc fini par une demande (ni le délai d'AnkaBot ni le temps de jeu), d'où elle vient reste à trouver. L'attente de 10 s du script occupait ensuite AnkaBot jusqu'au tour 3, sauté lui aussi. **Corrigé :** le script rend la main après 2,5 s quand AnkaBot dit qu'une autre entité joue (`ATTENTE_AUTRE_ENTITE`). Le journal garde aussi les noms des messages reçus pendant chaque tour du Féca (`names` de l'événement `myTurn`).
  - **15:20, 6e cas (2 Virustines) :** tour 2 fini pendant l'attente du plan (0,9 s), tour 3 en 0,1 s. Le journal du Féca montre seulement les messages habituels de début de tour avant la fin.
  - **Comparaison avec la Reine, qui a eu le même symptôme (2026-10-10 et 12) :** trois causes y ont été trouvées et corrigées :
    - un journal occupé au changement de tour : son journal se tait dès le tour du combattant qui la précède (`QUIET_FROM_MY_TURN = false`) ;
    - de longues requêtes pendant le tour : le serveur répond par sondes ;
    - un `move()` bloqué pendant le combat : `map:fight()` plutôt que `map:forceFight()`.
    Le Féca ne différait que sur la première : son journal ne se taisait qu'à son propre tour, et envoyait au serveur (requête HTTP bloquante) à chaque début de manche, début de tour et lancer (`URGENT_MESSAGES` : `jvi`, `jvj`, `jsq`), donc juste avant son tour, puisqu'il joue souvent en premier.
  - **Corrigé (`DEFER_SENDS_NEAR_MY_TURN`, Féca seulement) :** du début du tour du combattant qui le précède jusqu'à la fin du sien, le journal enregistre sans rien envoyer ; le lot part au début de `fightManagement` (`JOURNAL_FLUSH_NOW`), avant la demande de plan. Le tour qui précède reste journalisé (Malamibe, relances).
  - **15:58 et 15:59, 7e et 8e cas, avec le report actif :** tours 2 finis en 0,1 et 0,76 s, tours 3 en 0 et 0,1 s. Horloges du journal et du script alignées (même `os.clock`) : manche 2 à 15 659,266, tour du Féca fini à 15 659,37, `fightManagement` lancé par AnkaBot à 15 660,373. AnkaBot allait jouer, c'est une demande reçue juste après le début du tour qui l'a terminé. Deux mécanismes :
    1. **Premier tour sauté, au début de la manche 2 (ou 3) :** le Féca joue en premier, et l'envoi « urgent » du début de manche (`jvi`) tombait sur le début de son tour. Le report ne couvrait pas la manche 1 → 2, car le prédécesseur du Féca n'y est pas encore connu (personne ne joue avant lui en manche 1).
    2. **Sauts en cascade :** le script, lancé trop tard, rendait la main pendant le tour d'un monstre ; la demande de fin de tour qu'AnkaBot envoie alors s'appliquait au tour suivant du Féca.
  - **Corrigé :**
    - `DEFER_SENDS_IN_FIGHT` (Féca) : le journal n'envoie rien de lui-même pendant tout le combat, ni au début de la manche 1 ; le lot part au début de chaque tour du Féca et à la fin du combat (`jwh`) ;
    - `ATTENTE_TOUR_SUIVANT` (90 s, Féca) : lancé alors qu'une autre entité joue, le script garde la main jusqu'au tour suivant du Féca et le joue dans le même appel. 5 des 8 combats perdus sur des tours sautés avaient 2 tours sautés d'affilée. (Retiré après le 10e cas, voir plus bas.)
  - **16:13, 9e cas, avec le report et l'attente du tour suivant actifs :** tour 3 fini en 0,1 s alors que le journal n'envoyait rien et que le script avait rendu la main normalement au tour 2. Aucune ligne « fightManagement lancé » pour ce tour (écrite pourtant dès le début de la fonction) : AnkaBot passe le tour quand `fightManagement` se termine, et il s'est terminé **sans que notre code s'exécute**. Cause retenue : le script occupé par le journal quand AnkaBot veut l'appeler. Fin du tour du dernier monstre, début de manche et début du tour du Féca arrivent presque ensemble, et le journal traitait encore les premiers (conversion JSON, appels à l'API d'AnkaBot). C'est une course, donc aléatoire. La Reine ne la perd pas : son journal se tait dès le tour du combattant qui la précède.
  - **Corrigé (Féca, 16:30) :**
    - silence dès le tour du prédécesseur, comme la Reine (`QUIET_FROM_MY_TURN = false`), ce prédécesseur étant connu dès la manche 1 par l'ordre de jeu (`jvu`) ;
    - messages du silence **mis en file** (`QUIET_QUEUE`) et traités au début de `fightManagement` ou au premier message après le silence. Rien n'est perdu, et le serveur voit maintenant aussi les tours du Féca (mort d'une Malamibe, relance d'une Tabacille par un soin).
  - `LogsActivate` mis à `true` dans la configuration de Kaskyzo à 16:20, mais AnkaBot a réécrit le fichier à 16:23 (`false`) : à activer depuis l'interface d'AnkaBot.
  - **16:27, 10e cas (6 monstres), avec la file du journal active :**
    - tour 2 ouvert et fermé par le jeu dans la même milliseconde (`jvj` puis `jup` à 17 669,450), séquence de début de tour vide : script inactif, journal silencieux. Rien de notre code n'a pu envoyer cette fin de tour.
    - tour 3 passé par AnkaBot au bout de 1,2 s : `ATTENTE_TOUR_SUIVANT` gardait encore `fightManagement` du tour 2, AnkaBot a donc appliqué son `skipTurnAfter`. **Retiré** (`ATTENTE_TOUR_SUIVANT = 0`).
    - Point commun des 7 tours sautés avec les réglages actuels : tous suivent un tour du Féca **fini par un déplacement** (6 tours sur 60 finis par un déplacement, dont 1 par Transhumance), aucun après un tour fini par un sort (0 sur 36). Hypothèse : une demande de fin de tour en double, liée au dernier déplacement, que le serveur applique au tour suivant. **Essai :** pause de 1,5 s après un déplacement final avant de rendre la main (`DELAI_APRES_DEPLACEMENT_FINAL`, `SORTS_QUI_DEPLACENT`). Pour trancher, il faut voir les messages envoyés par le client : logs d'AnkaBot ou son Sniffer.
  - **Correction (2026-10-17, 17:10) : l'heure des messages du journal est celle de leur remise au script, pas de leur arrivée.** AnkaBot ne remet aucun message au script pendant `fightManagement` ; ils arrivent tous d'un coup à son retour. Un début et une fin de tour « dans la même milliseconde » (10e cas) ne prouvent donc rien, et la durée `seconds` de l'événement `myTurn` non plus.
  - **16:53 à 17:03, 8 combats, 7 gagnés.** Réglages de combat d'AnkaBot passés en mode rapide entre 16:51 et 16:53 (`SpeedFightType` 2, `playTurnAfter` et `skipTurnAfter` à 0) : `fightManagement` part dès le début du tour, avant que le script ait reçu la fin du tour du dernier monstre. Le serveur attend alors ce journal en vain : plan en 4,2 s (médiane, contre 0,8 s avant), journal à jour pour 13 plans sur 44 (contre tous). Au 1er tour d'un combat, il n'y a parfois pas de plan du tout (« pas de tour de Kaskyzo en cours dans le journal », tour perdu).
  - **Adapté au mode rapide (17:30) :** au début de `fightManagement`, le script laisse AnkaBot remettre au journal les messages retenus (`developer:suspendScriptUntil`, qui exécute les fonctions abonnées pendant l'attente : `JOURNAL_POMPE`, `POMPE_MS` = 500 ms au plus, jusqu'à son propre début de tour), puis demande le plan. Il attend ensuite 0,8 s au plus le journal (`ATTENTE_PLAN`, 2,5 s avant), avec des sondes de 0,3 s (`SONDE_LONGUE_MS`, 1 s avant ; la Reine avait des tours clos pendant de longues requêtes, 2026-10-10). Le journal de l'IA note `journal : N message(s) remis par AnkaBot en X ms` : 0 message, c'est que `suspendScriptUntil` ne les remet pas non plus.
  - **11e et 12e cas :** `isItMyTurn()` vrai au lancement, puis tour du Féca fini pendant les 4 s d'attente du plan, sans aucune action. Les deux suivaient un tour fini par un déplacement, malgré la pause de 1,5 s (2 sur 20 ; 0 sur 17 après un sort). Au 12e (17:03), la Malamibe invoquée en manche 3 avait encore 111 PV : le tour 4 lui avait fait 1 890 dommages (2 295 possibles), le coup final était prévu au tour 5, perdu ; Féca tué.
  - **Bilan des tours sautés ce jour-là :** 3 fois sur 4, la Malamibe était à son 2e tour et a tué le Féca ; 2 fois, le Féca aurait pu la tuer dès son 1er tour (≈ 2 800 dommages possibles pour 2 001 PV).
- **Cause des tours clos trouvée (2026-10-17, 22:25) :** la pompe du journal remet les messages en direct, leurs heures sont donc fiables. Aux combats de 21:50 et 22:20, l'ordre était Krobe → sa Malamibe → Féca. AnkaBot a lancé `fightManagement` du Féca **au début du tour de la Malamibe** (9 831,060 ; 11 600,617), et le vrai tour du Féca, commencé 60 à 115 ms plus tard, a été clos 0 à 8 ms après son début. AnkaBot passe un tour qui commence pendant un `fightManagement` en cours (essai `ATTENTE_TOUR_SUIVANT` de 16:27 : au bout de 1,2 s, `skipTurnAfter` ; en mode rapide : tout de suite). Sur la journée : 5 tours vides sur 25 quand la Malamibe joue juste avant le Féca, 3 sur 72 après un monstre (dont un plan vide voulu et un tour éclair d'une Virustine morte). **Parade :** au lancement, sans aucune attente, main rendue tout de suite si le journal montre le tour d'une autre entité en cours (`JOURNAL_TOUR_EN_COURS`) ou si `isItMyTurn()` est faux (`RENDRE_SI_PAS_MON_TOUR`). Premier essai (22:45) avec 30 ms de pompe avant le contrôle : l'attente a duré environ 700 ms, le vrai tour du Féca (lancé pendant le tour du premier monstre de la manche) était déjà passé ; la Malamibe, à 1 853 PV, a tué l'équipe. **Retiré à 23:20 :** au lancement, AnkaBot n'a pas encore remis au journal les derniers messages ; le journal montrait encore le tour du monstre précédent alors que c'était bien le tour du personnage. Kyanna-Lee a rendu la main à ses tours 1 à 3 (aucune mule tuée), le Féca à son tour 5, combat perdu. Le journal ne dit pas de façon fiable, au lancement, à qui est le tour. Piste restante : un délai avant le lancement (`playTurnAfter` d'AnkaBot, 1 s au moins), pour que le vrai tour ait commencé quand le script part.
- **Les mules ne sont pas gérées.**

## 5. À vérifier en jeu

1. **Invocations et conditions :** la Lanterne du Berger et les boucliers (Barricade, Pavois, Égide) comptent-ils comme combattants alliés ? Pour la Bacterrib (relance à 5 cases) comme pour le Verminocule (contact).
2. **Barricade et Gonflement :** Barricade bloque-t-elle Gonflement, qui frappe en zone autour du Verminocule ? La manche 6 de la vidéo le laisse penser.
3. **Défiance :** compte-t-elle pour 4 coups sur la Malamibe ?
4. **Esquive PA des Krobes Oméga :** −24 dans les données des grades de base.
5. **Les +352 et +353 PV de Tayro** [V, 1:41 et 2:00], vus après la mort des Tabacilles. Leur source est inconnue (équipement ?). Un tel soin relancerait un Tabacille vivant.
6. **Début du tour d'une Bacterrib :** sa mort passe-t-elle avant le contrôle de distance ?
7. **Soin nul à PV pleins :** « Le Singe et la Lune » relance-t-il les Tabacilles quand le Féca n'a perdu aucun PV ?
8. **Tours sautés :** combien de fois AnkaBot ne lance-t-il pas `fightManagement` ? Deux fois le 2026-10-17 : Baleine salle 4 en manche 2, Roc des Salbatroces en manche 3. Une Malamibe laissée à son 1er tour devient alors mortelle.
