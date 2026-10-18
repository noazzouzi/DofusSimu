# Ventre de la Baleine : mécaniques et stratégie pour 4 Crâs (salles 1 et 2)

Donjon 84, boss Protozorreur, niveau 200. Mise à jour du 2026-10-14 après le **premier combat réel** : victoire en
7 manches, 3 Crâs morts (§6). Le combat est relu avec `npm run baleine:bilan` (§5). La salle 2 se joue avec
l'algorithme : script AnkaBot et serveur de plans (§7, §8).

| Étiquette | Origine |
|---|---|
| **[J]** | Journal du combat du 2026-10-14 (`data/fightlogs/2026-10-14/session-12-04-36.jsonl`). |
| **[D]** | Données du jeu 3.7 (`.cache/data-3.7`), y compris les descriptions des sorts de départ des monstres. |
| **[E]** | Fiche https://www.dofuspourlesnoobs.com/ventre-de-la-baleine.html, consultée le 2026-10-14. |
| **[M]** | Mesuré avec `tools/ventre-de-la-baleine/menaces.ts` sur la carte du combat. |
| **[R]** | Raisonnement, à vérifier en jeu. |
| **[U]** | Règle confirmée en jeu par l'utilisateur. |

## 0. En bref (salle 1)

- **Carte du combat : 140771332**, et non 140771328 (la carte de la salle) [D][J].
- **Monstres : 2 Tabacilles, 1 Pataugerme, 1 Virustine.** Leur placement varie : 2 placements vus (§3.2).
- **Les Krobes sont invulnérables.** Chacun meurt seul **3 manches après le lancement ou la dernière relance de son
  compte à rebours, au même moment de la manche** [J]. Lancé avant le premier tour, il meurt au début de la manche 4.
- **La Malamibe** a 1 PV plus 2 000 par Crâ vivant. Frapper un Krobe équivaut à un coup normal sur elle. Elle tue
  l'équipe 2 tours après son invocation [D].
  - Elle n'a jamais été un problème : 9 Malamibes, chacune morte dans la manche de son invocation ou la suivante (tuée, ou avec son invocateur).
  - L'équipe a infligé 38 000 dégâts en 7 manches [J].
- **Ce qui coûte des Crâs** [J] :
  - **la manche 1** : les monstres jouent les premiers, au contact ; 5 800 dégâts dont 4 900 sur Kemist et Lowkey, les
    deux derniers à jouer ;
  - **les échanges des Tabacilles** : 11 en 3 manches, dont 2 sur la Virustine, qui relancent son compte à rebours.
- **Objectif : tout tuer au début de la manche 4.**
  1. **Aucun soin** : le compte à rebours des Tabacilles ne repart alors jamais.
  2. **Pesanteur sur la Virustine** (Représailles) en manches 2 et 3, avant le premier Tabacille. Sinon un Tabacille
     l'échange et elle repart pour 3 manches.
  3. **Pataugerme touché en Feu, Eau, Air et Terre aux manches 1, 2 et 3.** Il joue le premier, donc son compte à
     rebours repart forcément à son premier tour.
  4. **Flèche du Jugement sur tous les monstres.** Ses −150 Puissance se cumulent : à −300, un monstre ne fait plus que
     ≈ 55 % de ses dégâts.

## 1. Mécaniques

| Statut | Fait | Origine |
|---|---|---|
| SÛR | Les Krobes sont **invulnérables**. Au début de son tour, un Krobe **invoque une Malamibe s'il n'y en a aucune en vie**. | [D][J] |
| SÛR | **Malamibe** : 0 PA, 0 PM, **1 PV + 2 000 par personnage vivant** (8 001 à 4 Crâs). Elle perd 2 000 PV quand un Crâ meurt. Elle subit ×50 % des dégâts qui la visent, et 200 % des dégâts initiaux de tout coup porté à un Krobe. Elle **meurt avec le Krobe qui l'a invoquée**. Elle tue l'équipe 2 tours après son invocation : jamais observé. | [D][J] |
| SÛR | **Compte à rebours** : le Krobe meurt 3 manches (6 pour le boss) après le lancement ou la dernière relance, au même moment de la manche. Le bilan affiche la mort attendue ; elle était juste pour les 4 Krobes. | [J] |
| SÛR | **Tabacille** : relancé si un personnage est soigné. Il gagne +150 Puissance à chaque début de tour. | [D][J] |
| SÛR | **Virustine** : relancée si elle est attirée, poussée, **échangée (y compris par un Tabacille)**, portée, ou visée par un retrait de PM même esquivé. **Un retrait de PA ne la relance pas** (Flèche Glacée esquivée sans effet). Elle a **7 PM**. | [D][J] |
| SÛR | **Pataugerme** : relancé au début de son tour s'il n'a pas reçu les 4 éléments depuis son tour précédent. Chaque élément reçu ajoute une ligne à sa Brûlure d'estomac du tour suivant. | [D][J] |
| SÛR | **Flèche du Jugement** : −150 Puissance pendant 2 tours, cumulable entre Crâs. Sur le Pataugerme à −300, Attaque souterraine passe de 551 à 290-310, et la Brûlure de 169-190 à 96 par ligne. Les Tabacilles ont été tenus à +150 au lieu de grimper. | [J] |
| SÛR | Autres Krobes, pour les salles suivantes. **Verminocule** : un personnage à son contact au début de son tour. **Bacterrib** : aucun personnage à 5 cases ou moins au début de son tour. **Protozorreur** : 6 tours d'Infection, en entrant dans un glyphe violet au moins tous les 2 tours. | [D][E] |
| INCERTAIN | **Vol de vie** : relance-t-il les Tabacilles ? Pas testé, puisqu'aucun vol de vie n'a été lancé tant qu'ils vivaient. La fiche dit que non. | [E] |
| SÛR | Moment où la Malamibe tue l'équipe : au 3e tour du joueur qui suit son invocation, si elle vit encore. Il faut donc la tuer avant la fin de son 2e tour. Règle confirmée en jeu par l'utilisateur le 2026-10-17. | [U] |
| INCERTAIN | Durée réelle de la Pesanteur de Représailles : jusqu'au tour suivant du lanceur ? | [D][R] |

## 2. Monstres de la salle 1 : IA observée

Dégâts relevés sur nos Crâs (≈ 3 700 PV), Puissance des monstres comprise [J].

| Monstre | PA / PM | Dégâts observés | IA observée |
|---|---|---|---|
| **Pataugerme** | 12 / 5 | **Brûlure d'estomac** (1-4 cases, cercle de 2) : 169-190 par Crâ sans élément, ≈ 350 avec 3, 430-540 avec 4 (96 par ligne à −300 Puissance). **Attaque souterraine** (1-3, −3 PM) : 250-550, deux fois sur deux Crâs différents. | **Premier à jouer** : meilleure initiative de tout le combat. Il vise une case vide pour prendre le plus de Crâs dans sa zone : les 4 en manche 1. Il s'approche à 1-3 cases. |
| **Virustine** | 12 / 7 | **Contamination** (contact) : 280-560. **Boulet Viral** (ligne 1-3, sans ligne de vue) selon **ses** PM restants : 1 038 avec 6 PM, 414 avec 4, 134 avec 1. Jusqu'à 1 450 par tour. | Fonce sur le Crâ le plus proche, Boulet puis Contamination. Ne frappe pas quand aucun Crâ n'est à sa portée (2 tours sans sort). |
| **Tabacille** ×2 | 12 / 4 | **Échange subtil** : 180-710, plus fort sur les blessés. **Remontée gastrique** (diagonale 1-2) : 410-590. | **Échange ses alliés comme relais** (Virustine ×2, Malamibes ×2) pour s'aligner sur un Crâ et l'échanger ensuite : 11 échanges en 3 manches. Ce sont eux qui ont tué Lowkey et Kemist. |
| **Malamibe** | 0 / 0 | — | Ne joue pas. |

## 3. Stratégie salle 1

### 3.1 Avant le combat

- **Représailles** à la place de Balise de Survie au moins sur **Java et Lamouit**, qui jouent avant les Tabacilles. Le
  sort pose Pesanteur pendant 1 tour en croix autour de la cible (3 PA, 0-11 cases, recharge 3), **1 lancer par manche
  pour toute l'équipe** [D]. Le 2026-10-14, aucun Crâ ne l'avait : tous avaient encore Balise de Survie [J].
- Journal (§5).

### 3.2 Placement

| Placement des monstres | Pataugerme | Virustine | Tabacilles |
|---|---|---|---|
| **P1** (combat du 2026-10-14) | 384 | 242 | 297, 341 |
| Capture du 2026-10-14 | 297 | 341 | 286, 242 |

- En P1, **toutes les cases rouges sont à portée des quatre monstres** au tour 1 [M]. Le placement ne peut donc pas
  éviter la manche 1. Il peut seulement :
  - éviter le contact (tacle) : en P1, 284 et 312 touchent un Tabacille ;
  - **répartir les cases selon l'ordre de jeu**. Java joue avant la Virustine. Java et Lamouit jouent avant les
    Tabacilles. Lowkey et Kemist jouent après presque tous les monstres.
- **Règle** : les cases les moins exposées vont aux Crâs qui jouent en dernier ; les plus exposées, à ceux qui en
  partent avant les monstres.
  - **P1** :
    - **Kemist en 385** et **Lowkey en 372** : 385 n'est à portée d'aucun Tabacille, 372 d'un seul ;
    - **Java et Lamouit en 356 et 329** : ces deux cases sont à portée des deux Tabacilles et de la Contamination.
  - Le 2026-10-14, c'était l'inverse. Kemist (329) et Lowkey (356) ont pris 2 900 et 2 000 dégâts en manche 1, presque
    tout avant leur premier tour.

### 3.3 Déroulé (objectif : début de la manche 4)

Ordre de jeu observé en P1 : Pataugerme, Java, Virustine, Lamouit, Tabacille, Lowkey, Tabacille, Kemist. La Malamibe
joue juste après son invocateur.

**Manches 1, 2 et 3**

- **Java**, juste après le Pataugerme, le touche en **Terre, Air et Eau** : Flèche du Jugement (4 PA), Flèche
  Cinglante (2 PA), Flèche Glacée (3 PA), et Tirs Puissants avec le PA restant.
  - **Manche 2** : Représailles sur la Virustine à la place de Tirs Puissants (12 PA).
- **Lamouit**, avant le premier Tabacille, le touche en **Feu** (Flèche Fulminante, Tyrannique ou Explosive), puis
  lance Flèche du Jugement sur la Virustine ou un Tabacille.
  - **Manche 3** : Représailles sur la Virustine.
  - Si un Tabacille est collé à la Virustine, viser une case qui couvre les deux : Pesanteur se pose en croix.
- **Lowkey et Kemist** : Flèche du Jugement sur les Tabacilles et la Virustine (−150 Puissance chacune), puis des
  dégâts sur un Krobe pour tuer la Malamibe.
- **Tout le monde** :
  - pas de vol de vie tant qu'un Tabacille vit (non testé) ;
  - pas de Flèche de Dispersion près des alliés : en manche 1, elle a déplacé Lamouit, Lowkey et Kemist ;
  - finir son tour hors des lignes d'un Tabacille (4 cases), ou derrière un obstacle ;
  - repousser un Tabacille aligné avec la Virustine (Flèche de Recul : seulement sur le Tabacille).
- **Contrôle** : le bilan montre, manche par manche, les éléments reçus par le Pataugerme. S'il en manque un, il
  vivra une manche de plus.
- **Si la Virustine est échangée malgré tout** :
  - en manche 1, elle meurt pendant la manche 4, après avoir joué une fois de plus ;
  - en manche 2 ou 3, elle prend 1 ou 2 manches de plus : continuer à tuer les Malamibes et à la tenir à −300
    Puissance.

### 3.4 Sorts sur la Virustine

| À ne pas lancer sur elle, ni sur une zone qui la contient | Sûrs |
|---|---|
| Flèche de Recul, Flèche Cinglante, Flèche Perforante, Flèche d'Immobilisation, Flèche Ralentissante, Flèche de Barrage, Flèche Assaillante, Flèche Évasive, Balise Tactique à proximité. Flèche de Dispersion repousse tout ce qui est **autour** de la case visée, sauf la cible : centrée sur la Virustine, elle ne la déplace pas, mais elle repousse nos Crâs [J]. | Flèche Glacée (le −PA ne la relance pas [J]), Flèche du Jugement, Flèche Tyrannique, Flèche Fulminante, Flèche Explosive (attention aux alliés), Flèche Massacrante, Représailles. **Flèche Vagabonde et Tir de Repli** : leur recul (effet 1041) déplace le Crâ qui les lance, pas la cible [D]. Avec vol de vie : Dévorante, Abolition, Œil pour Œil, Œil de Taupe, Rédemption. |

## 4. À vérifier aux prochains combats

1. **Vol de vie et Tabacilles** : un seul vol de vie sur un Tabacille en manche 2 suffit. Le bilan dira si son compte à
   rebours repart.
2. **Pesanteur de Représailles** : couvre-t-elle les deux Tabacilles de la manche ? Le bilan montre les échanges.
3. **Placements** : P1 revient-il ? Quel est le cycle ? À tenir dans un registre, comme pour la Reine
   (data/reine/placements.json), quand on en aura vu plusieurs.
4. **Ordre de jeu** : le Pataugerme joue-t-il toujours en premier ? Sur la première capture, le Crâ jouait avant lui.

## 5. Journaux des combats

On joue à la main ; le journal enregistre tout.

1. Lancer le récepteur : `tools\ankabot\lancer_journal.cmd`, ou `node scripts/fightlog-server.mjs`. Laisser la fenêtre
   ouverte.
2. Dans AnkaBot :
   - redémarrer (aucun `ReineCombat.lua` ne doit rester chargé) ;
   - charger `tools/ankabot/journal-combats.lua` sur le chef, **sans le lancer** ;
   - attendre « [journal] … prêt » pour les 4 Crâs.
3. Jouer le combat.
4. Lire le combat :
   - `node scripts/fightlog-check.mjs` vérifie le journal ;
   - `npm run baleine:bilan` affiche le bilan du dernier combat contre des Krobes, journaux des 4 Crâs fusionnés.
     Options : `--tous` pour toute la session, `--json` pour un bilan structuré, `--perso <nom>` pour un seul journal
     (avec `BaleineCombat.lua`, il lui manque les tours de son personnage).
   - Contenu du bilan :
     - **Malamibes** et **Krobes** : compte à rebours, cause de chaque relance, mort attendue et mort réelle ;
     - **éléments** reçus par le Pataugerme ;
     - **Virustine** : déplacements, retraits de PM tentés, esquives ;
     - **soins**, en séparant le vol de vie ;
     - **IA** des monstres tour par tour, Puissance comprise ;
     - **dégâts**.
5. Préparer un placement : `npm run baleine:menaces -- --monstres Pataugerme:384,Virustine:242,Tabacille:297,Tabacille:341 --cras 356,329,372,385`
   affiche les cases que chaque monstre peut toucher à son prochain tour et les meilleures cases de tir.

## 6. Combats joués

| Date | Placement | Manches | Résultat | Crâs morts | Ce qui a coûté |
|---|---|---|---|---|---|
| 2026-10-14 12:04 | P1 | 7 | victoire | Lowkey M2, Kemist M3, Lamouit M6 | Kemist et Lowkey (cases les plus exposées, derniers à jouer) : 4 900 dégâts en manche 1. Virustine échangée par un Tabacille en M2 et M3 : morte en M6 au lieu de M4. Pataugerme : il manquait l'Eau en M1, rien en M2 et M3, donc 4 éléments à partir de M4 seulement et mort en M7 au lieu de M4. |

Salle 2, jouée par l'algorithme (§8). Les Crâs ont commencé les 3 combats à **51 % de leurs PV** (≈ 1 880 sur 3 700).
Ordre de jeu : Pataugerme, Java, Bacterrib, Lamouit, Bacterrib, Lowkey, Verminocule, Kemist.

| Date | Monstres | Manches | Résultat | Crâs morts | Ce qui a coûté |
|---|---|---|---|---|---|
| 2026-10-14 15:29 | Bacterribs 309, 351 ; Pataugerme 395 ; Verminocule 353 | 3 | défaite | Kemist M2, Lamouit M2, Lowkey M3, Java M3 | Bacterribs : 1 900 à 3 000 dégâts par manche, pour 7 500 PV d'équipe. |
| 2026-10-14 15:31 | Bacterribs 351, 395 ; Pataugerme 309 ; Verminocule 353 | 5 | défaite | Lowkey M3, Java M3, Lamouit M5, Kemist M5 | Pataugerme et Bacterribs morts en M4 comme prévu. Verminocule jamais gardé avant M4 : il a survécu et achevé Lamouit et Kemist. |
| 2026-10-14 15:34 | Bacterribs 309, 324 ; Pataugerme 366 ; Verminocule 409 | 5 | défaite | Java M2, Lamouit M2, Lowkey M4, Kemist M5 | Même déroulé. En plus, les tours de Lowkey en M2, M3 et M4 ont été passés par AnkaBot en 10 à 110 ms. |
| 2026-10-14 16:10 | Bacterribs 310, 353 ; Pataugerme 351 ; Verminocule 395 | 6 | **victoire** (PV pleins, algorithme corrigé) | Lowkey M2, Lamouit M3, Kemist M4 | Voir ci-dessous. |
| 2026-10-14 16:45 | **Salle annexe** (§9) : Verminocules 187, 189 ; Virustine 245 ; Pataugerme 241 | 3 | défaite | Java M1, Lamouit M2, Lowkey M3, Kemist M3 | Carte du combat (140773380) absente : ni placement ni plan, tous les tours passés ; la Malamibe a tué l'équipe en M3. |
| 2026-10-14 17:01 | **Salle annexe** : Verminocules 245, 303 ; Virustine 189 ; Pataugerme 187 | 4 | défaite | Lamouit M2, Kemist M3, Lowkey M3, Java M4 | Joué par l'algorithme. Pataugerme et Virustine morts en M4 comme prévu, un Verminocule gardé en M1 et M2. Mais 4 000 à 5 000 dégâts par manche ; tour de Lowkey en M2 passé par AnkaBot. |

Dans les 3 combats, l'algorithme a tenu les conditions des Bacterribs (jamais relancées), le Pataugerme (Infection à
chaque manche) et les Malamibes (toutes tuées à temps). Il a échoué sur deux points :
- **la défense** : 19 Flèches du Jugement sur le Verminocule, qui ne frappait pas encore, et 7 seulement sur les
  Bacterribs ;
- **le Verminocule** : à 7-14 cases, hors d'atteinte, aucun Crâ ne s'en est approché avant la manche 4.

Écarts d'exécution relevés, corrigés depuis (§8) :
- Flèche d'Immobilisation esquivée : 4 fins de tour à une case de la case prévue. Le plan comptait le PM volé.
- Tirs Puissants : son −3 PO joue au tour suivant. 5 sorts refusés au début de ce tour-là.
- Tir de Repli en diagonale : refusé par la vérification d'AnkaBot (« PAS_EN_LIGNE »).

Non corrigé : les 3 tours de Lowkey passés en 10 à 110 ms (combat de 15:34) ne viennent pas du script, qui attendait
encore son plan. AnkaBot a déjà fait de même avec la Reine ; la cause n'apparaît pas dans les journaux.

**Victoire de 16:10**, Java seul survivant. Exécution sans écart. Pataugerme et Bacterribs morts en M4 comme prévu, mais
le Verminocule a survécu jusqu'en M6 (relancé en M1, M2 et M3). Les Jugements ont tenu les Bacterribs à −300 en M2
(900 dégâts par tour au lieu de 1 600). Ce qui a rendu le combat serré :
- **Lowkey, gardien, s'est approché à 8 cases du Verminocule en M1** sans pouvoir aller à son contact. Gonflement l'a
  attiré au contact, puis Jet d'acide : −1 484, condition non tenue. En M2, attiré près du Pataugerme (−1 128) et à
  3 PM (Attaque souterraine), il est mort au tour du Verminocule.
- **Java a éloigné le Verminocule de Lowkey en M2** (Flèche de Dispersion centrée sur Lowkey) : la condition, qui
  aurait été tenue, ne l'a pas été.
- **Lamouit, visé par les deux Bacterribs pendant 3 manches** (3 805 dégâts), est mort en M3.

Corrigé depuis (§8) :
- le gardien ne finit plus à portée du Verminocule sans être à son contact ;
- éloigner le Verminocule d'un Crâ à son contact est pénalisé ;
- les coups du Verminocule comptent en entier sur le Crâ qu'il atteint ;
- les PV du Crâ ne comptent plus les soins fictifs du vol de vie sur les Krobes ;
- la condition d'une Bacterrib passe vraiment avant le contact du Verminocule ;
- la recherche est plus large (Représailles, ajouté à la place de Balise de Survie, avait réduit le tour de Java de
  moitié).

## 7. Salle 2

- **Carte du combat : 140772356** (salle 140772352) [D][J]. 170 cases praticables, 10 cases de placement par
  équipe [D].
- **Monstres : Pataugerme, 2 Bacterribs, Verminocule** (capture du 2026-10-14). Ni Tabacille ni Virustine : soins et
  poussées sont permis.
- **Conditions à tenir à chaque manche** [D][E] :
  1. **Bacterribs : aucun Crâ à 5 cases ou moins au début de leur tour.** Chaque Crâ finit son tour à 6 cases ou plus
     des deux, ou les repousse (Flèche de Recul, Perforante, Assaillante, de Barrage).
  2. **Verminocule : un Crâ à son contact au début de son tour.** Le « gardien » est le dernier Crâ à jouer avant lui. Il
     faut que ses cases de contact soient à 6 cases ou plus des Bacterribs : sinon, repousser la Bacterrib ou le
     Verminocule.
  3. **Pataugerme : Feu, Eau, Air et Terre entre deux de ses tours**, comme en salle 1. Un Crâ seul peut les donner
     avec 12 PA : Flèche du Jugement, Glacée, Dévorante et Cinglante.
- **IA et dégâts observés** (4 combats du 2026-10-14, §6) [J] :

  | Monstre | IA | Dégâts par tour |
  |---|---|---|
  | **Bacterrib** ×2 | 5 PM par tour. Finit à 6-12 cases du Crâ le plus proche. **Sécrétion** (Air, de 6 à 10 cases, 2 fois) et **Danse répulsive** (Terre, en ligne jusqu'à 10 cases, repousse la cible). | **1 100 à 1 600** à Puissance 0, sur 2 ou 3 Crâs ; ≈ 800 à −150. Les tueurs des manches 1 à 3 : 7 morts sur 15 (4 combats). |
  | **Verminocule** | Avance de 5 PM vers le Crâ le plus proche. **Gonflement** (Eau, en étoile de 3 cases autour de lui) **attire** de 3 cases les Crâs touchés, puis **Jet d'acide** (Neutre, au contact, 2 fois) [D][J]. Il atteint donc un Crâ jusqu'à 8 cases. | 0 tant qu'il n'atteint personne ; puis **800 à 1 500** sur le Crâ attiré. 7 morts sur 15 (4 combats). |
  | **Pataugerme** | Comme en salle 1, mais loin des Crâs : souvent sans sort. | 0 à 600. |

- **Données du jeu** [D] : les conditions parlent de « combattant allié », pas seulement de personnage. Une **balise**
  de Crâ compterait donc peut-être : au contact du Verminocule, elle tiendrait sa condition ; à 5 cases ou moins d'une
  Bacterrib, elle la relancerait. À tester. La Bacterrib réduit aussi de 1 tour la durée des effets des Crâs à 6 cases
  ou plus d'elle, au début de son tour.

## 8. Algorithme : script AnkaBot et serveur de plans

Comme pour la Reine, chaque tour est calculé par un serveur à partir de l'état exact du combat. Les 4 journaux sont
fusionnés, et le tour est simulé par le moteur.

1. **Lancer le serveur** et laisser la fenêtre ouverte : double-clic sur `tools\ankabot\lancer_serveur_baleine.cmd`,
   ou `npm run baleine:serveur`.
   - Il remplace `lancer_journal.cmd`, à ne pas lancer en même temps : même port 8765 et mêmes fichiers
     `data/fightlogs/<date>/session-….jsonl`.
   - Il écrit aussi `plans-….jsonl`, avec chaque plan calculé.
2. **Dans AnkaBot** :
   - redémarrer, pour qu'aucun autre script ne reste chargé ;
   - charger `tools/ankabot/BaleineCombat.lua` sur le chef ; AnkaBot le charge sur les mules ;
   - configuration de combat de chaque compte : IA avancée « dans le même script » ;
   - attendre « [journal] … prêt » pour les 4 Crâs, et « [IA] Ventre de la Baleine chargé ».
3. **Engager le combat.**
   - **Placement** : chaque Crâ envoie au serveur la position des monstres et nos cases de placement. Le serveur
     répartit les 4 Crâs : moins de monstres à portée pour ceux qui jouent tard, pas de contact, 6 cases ou plus des
     Bacterribs, Crâs écartés à cause de la Brûlure d'estomac. Chaque Crâ se met sur sa case.
   - **Chaque tour** : le Crâ demande son plan, puis lance ses sorts et se déplace. En cas d'écart (sort refusé,
     déplacement arrêté), il redemande la suite.
   - **Sans plan** (serveur absent, journal en retard) : le Crâ passe son tour. Avec
     `npm run baleine:script -- --sans-plan main`, le script s'arrête à la place, et on finit le combat à la main.
4. **Suivre** :
   - la fenêtre du serveur affiche une ligne par plan : sorts, case de fin, note détaillée et alertes (Bacterrib trop
     proche, Verminocule sans gardien, mort possible) ;
   - chaque Crâ écrit son journal à côté du script : `ia_baleine_<personnage>_<date>.log` ;
   - après le combat, `npm run baleine:bilan` relit le combat comme en §5.

**Ce que le serveur cherche à chaque tour** (`tools/ventre-de-la-baleine/planificateur.ts`). Il essaie les sorts de
soutien, puis les meilleures cases de tir, puis jusqu'à 5 sorts joués par le moteur. Il choisit enfin la case de fin.

| Critère | Effet sur la note |
|---|---|
| Malamibe | Dégâts portés aux Krobes, plafonnés à ses PV, avec un bonus si elle meurt. Après ses 2 tours, la tuer passe avant tout. |
| Pataugerme | Éléments qui lui manquent. Le dernier Crâ avant lui doit compléter les 4, sinon il ne lui en donne aucun : chaque élément renforce sa Brûlure. |
| Flèche du Jugement | Dégâts évités sur les 2 tours de l'effet. Compte pleinement sur un monstre qui peut toucher un Crâ à son prochain tour, au tiers sur un monstre encore hors d'atteinte. |
| Bacterribs | Forte pénalité si le Crâ finit à 5 cases ou moins. Bonus s'il en éloigne un autre Crâ, par exemple en repoussant une Bacterrib loin du gardien. |
| Verminocule | Un gardien : le dernier Crâ à jouer avant lui. Hors d'atteinte, il s'en rapproche, mais sans finir à portée du Verminocule s'il n'est pas à son contact. À portée, il finit à son contact. Un autre Crâ y va si le gardien ne peut pas. Éloigner le Verminocule d'un Crâ à son contact est pénalisé. La condition d'une Bacterrib passe avant. |
| Case de fin | Dégâts attendus des monstres (mesurés en jeu), pesant davantage quand le Crâ est blessé, avec une alerte « mort possible ». Chaque monstre compte pour sa part, ses coups se répartissant entre les Crâs à sa portée ; le Verminocule compte en entier. PV du Crâ : ceux du début du tour, sans le vol de vie. Contact d'un monstre (tacle) et Crâs groupés sont aussi pénalisés. |
| Exécution | PM volés par Flèche d'Immobilisation jamais comptés (souvent esquivés). Tirs Puissants : −3 PO au tour suivant tant que le serveur n'a pas envoyé la nouvelle portée. Tir de Repli en diagonale lancé même si AnkaBot le refuse. |
| Salle 1 | Interdits : déplacer la Virustine, viser ses PM, soigner tant qu'un Tabacille vit. Pesanteur sur la Virustine. |

**Vérifier l'algorithme sur un combat enregistré** : `npm run baleine:rejouer -- --fichier data/fightlogs/…/session-….jsonl`
affiche, pour chaque tour de Crâ, le plan proposé et ce qui a été joué. Options : `--manche`, `--joueur`.

**Régénérer le script** (après une modification du journal ou de `tools/ventre-de-la-baleine/modele-baleine.lua`) :
`npm run baleine:script`. La commande écrit `tools/ankabot/BaleineCombat.lua` et `lancer_serveur_baleine.cmd`.

## 9. Salle annexe

- **Carte du combat : 140773380** (salle 140773376), 139 cases praticables : la plus petite [D][J]. Monstres placés
  tout près de nos cases.
- **Monstres : 2 Verminocules, Virustine, Pataugerme** (combat du 2026-10-14 à 16:45). Ordre de jeu : Pataugerme,
  Java, Virustine, Lamouit, Verminocule, Lowkey, Verminocule, Kemist.
- **Deux Verminocules : deux gardiens**, le dernier Crâ avant chacun (Lamouit et Lowkey dans cet ordre). La Virustine
  interdit de pousser ou de retirer des PM près d'elle (§3.4).
- **Dégâts relevés** [J], sans que les Crâs jouent : Virustine 1 568 et 2 536 par tour (Boulet Viral jusqu'à 1 373),
  Verminocules 1 372 à 1 624, Pataugerme ≈ 1 500 ; Java mort dès la M1.
- **Combat de 17:01**, joué par l'algorithme [J] :
  - 4 000 à 5 000 dégâts par manche, pour 14 700 PV d'équipe, malgré les Flèches du Jugement (Virustine et
    Verminocule à −300 en M2 : 1 293 et 1 017 dégâts au lieu de 2 000 à 2 500).
  - Le gardien paie cher : Lamouit, au contact du premier Verminocule en M1, a aussi été attiré par le second
    (−2 678 en M1) et il est mort en M2.
  - Pistes : la Balise de Survie plutôt que Représailles, inutile sans Tabacille (soin de 7 % des PV max de
    l'équipe). Et une balise au contact d'un Verminocule (« combattant allié », §7), à tester.
- Le serveur **télécharge maintenant depuis DofusDB toute carte de combat qu'il ne connaît pas** (quelques secondes, au
  placement ou au premier plan). Cartes déjà téléchargées : 140774404 et 140775428, supposées être celles des salles 3
  et 4 (numéro de la salle + 4, comme pour les salles 1, 2 et annexe) ; 140776452 n'existe pas, la carte du combat de
  la salle du cœur reste inconnue.
