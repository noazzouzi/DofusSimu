# Planificateur de tour — Reine des Voleurs (4 Crâs)

Cherche, pour le Crâ qui commence son tour, la suite **déplacement → sorts → repli** qui fait le plus de dégâts
**sans prendre de risque** :

- aucun monstre ne peut toucher la case finale à son prochain tour (pire cas : tous ses sorts offensifs, PA et PM
  pleins, toutes les cases qu'il peut atteindre ; la Reine peut en plus prendre la place d'un combattant par Mort en
  Sursis puis repartir avec ses PM restants, comme en jeu) ;
- aucun Crâ ne meurt dans l'explosion des bombes à la fin de ce tour, et le Crâ actif ne meurt pas d'ici son prochain
  tour (apparitions, explosions, passage au bleu et réactions en chaîne simulés) ;
- les autres Crâs que le tour exposerait à une explosion plus tardive sont signalés (⚠) et classés après.

Les sorts sont joués par le **vrai moteur** du simulateur (portée, ligne de vue, PA, limites de lancers, poussées,
jet moyen avec critique pondéré), sur la carte du combat.

## Dans le simulateur web (section « Reine »)

`npm run dev`, puis l'onglet **Reine** (`http://localhost:5173/#reine`) — serveur de développement seulement, comme la
section Boss (API `web/plugins/reine.ts`).

- **État** : *Direct* (début du dernier tour de Crâ enregistré par le journal : pendant un combat réel, laisser tourner
  `node scripts/fightlog-server.mjs` et le script AnkaBot, puis « Charger »), un tour du dernier combat du journal, ou
  *Nouveau combat* (placement du 2026-10-09 à ajuster avant un combat).
- **Édition** : cliquer une entité (carte ou liste) puis une case libre pour la déplacer ; × retire une bombe ; « Crâ qui
  joue » change le Crâ actif. La bombe de la manche du Crâ qui joue est replacée selon la règle d'apparition.
- **Zones de danger** (cases accessibles au Crâ qui joue) : vert sûre, orange touchable par un monstre, rouge mort par
  bombe (ou explosion de fin de tour qui tue un allié). Le survol d'une case dit qui peut la toucher et d'où.
- **Calculer les meilleurs tours** : tours sûrs (puis non sûrs pour comparaison) ; « Voir sur la carte » trace le
  chemin (pointillés), la case de tir, les sorts numérotés et la case de fin ; « Animer » rejoue le tour dans la section
  Combats (avec l'explosion des bombes de fin de tour).
- **Meilleur round (4 Crâs)** (≈ 15 à 30 s) : les tours des 4 Crâs cherchés ensemble, dans l'ordre d'initiative, les
  monstres jouant entre deux Crâs (`monstres.ts`) ; « Voir sur la carte » montre chaque tour dans l'état où le Crâ le
  joue, « Animer le round complet » rejoue la manche (monstres, bombes, tour suivant de la Reine compris).
- **Optimiser le placement** (≈ 1 min) : pour les positions des monstres de l'état chargé (placer les monstres comme en
  jeu, ou état *Direct* pendant la phase de placement), les cases rouges des 4 Crâs et le meilleur round qui va avec (la
  Reine joue la première). La carte donne le potentiel de chaque case rouge ; « Appliquer ce placement » le charge.

## En ligne de commande

Depuis la racine du dépôt :

```
npx tsx tools/reine-des-voleurs/planificateur/index.ts --manche 2 --joueur Java
npx tsx tools/reine-des-voleurs/planificateur/index.ts --etat mon-etat.json
npx tsx tools/reine-des-voleurs/planificateur/comparaison.ts     # joué / meilleur tour sûr, sur le combat du 2026-10-09
npx tsx tools/reine-des-voleurs/planificateur/etalonnage.ts      # dégâts du moteur / dégâts réels
npx tsx tools/reine-des-voleurs/planificateur/meilleur-round.ts --manche 1   # meilleur round de l'équipe (ou --nouveau)
npx tsx tools/reine-des-voleurs/planificateur/meilleur-round.ts --nouveau --placement   # meilleur placement des Crâs
npx tsx tools/reine-des-voleurs/planificateur/rejouer.ts --manche 2          # manche réelle, monstres simulés
npx tsx tools/reine-des-voleurs/planificateur/ia-monstres.ts                 # IA des monstres / tours réels
```

Options de `index.ts` : `--journal a.jsonl,b.jsonl` (défaut : journal du 2026-10-09), `--top 5`, `--faisceau 8`,
`--lancers 5`, `--json etat.json` (écrit l'instantané utilisé, modifiable puis rejouable avec `--etat`).

L'état du combat vient du journal AnkaBot (`tools/ankabot/journal-combats.lua`, `scripts/fightlog-server.mjs`) :
positions, PV et érosion, bombes (poseur, manche, couleur), ordre de jeu, relances des sorts. Après un combat,
`node scripts/fightlog-check.mjs` vérifie le journal (lignes perdues, erreurs, données tronquées, instances du script).

**Données du jeu :** celles de la version en jeu (3.7), dans `.cache/data-3.7` (non versionné). Pour les recréer :
`node scripts/fetch-dofusdb.mjs --out=.cache/data-3.7/dofusdb` puis copier `data/maps/137101316.json` dans
`.cache/data-3.7/maps/`. Le reste du dépôt reste en 3.6 (`data/dofusdb`) : y passer la 3.7 fait échouer 71 tests.
Autre dossier possible : variable d'environnement `REINE_DATA`.

## Ce qui a été vérifié sur le combat réel du 2026-10-09

| Point | Résultat |
|---|---|
| Carte du combat | 137101316 (et non 137101312) : toutes les cases occupées pendant le combat y sont praticables |
| Apparition des bombes | règle du moteur (`comparePositions`) : 5 apparitions sur 5 |
| Explosion, chaîne, bleu | la chaîne de la manche 2 est reproduite : 5 bombes, aucune mort, bombe −21 passée au bleu, apparitions suivantes en 412, 426, 481 (`tests/reine-bombes.test.ts`) |
| Dégâts du moteur | 70 à 130 % des dégâts réels par tour quand le lancer est accepté (`etalonnage.ts`) |
| Portées | données 3.7 nécessaires (Flèche Dévorante 0–8, Tirs Éloignés +3/+6 par sort) ; Kemist (manche 1) a tiré 2 à 5 cases plus loin que le moteur ne l'autorise : bonus d'équipement par sort, envoyés en début de combat, non décodés dans ce journal |

## Fidélité du moteur sur le combat réel du 2026-10-10

`npx tsx tools/reine-des-voleurs/planificateur/fidelite.ts [--detail] [--chemins]` rejoue chaque tour du journal
(reconstitution exacte de `tools/fightlog/rejeu.ts`) dans le moteur, action par action : déplacements et lancers
volontaires imposés, le reste calculé par le moteur et comparé au réel ; le moteur est recalé sur le réel après chaque
action (cases, PV, PA/PM, caractéristiques du serveur, invocations, pièges). Test : `tests/reine-fidelite.test.ts`.

| Mesure (13 manches, 3 s) | Résultat |
|---|---|
| Déplacements (case d'arrivée, pièges de « Jeu Dangereux » compris) | 166/166 |
| Lancers acceptés par le moteur | 202/202 (après correction du moteur : modificateurs de sort « tous les sorts » et propres à un sort additionnés) |
| Dégâts par cible dans la fourchette des jets (même coup critique que le réel) | 166/190 (87 %) ; total réel 86 558, moteur 84 723–89 292 |
| Cases après poussée / échange | 55/56 |
| Apparition des bombes, explosions (détruites, bleues, morts), dommages des explosions aux monstres | 50/50, 17/17, 7/7 |
| IA des monstres (case de fin et sorts exacts) | 24/42 ; écart médian de la case de fin : 0 (Doublure, Terristocrate, Mâchassin, Bourôliste), 2 (Reine), 4 (Magouille) |
| Début de tour (ripostes Avertissement) | 7/21 : qui reçoit la riposte (zone, durée du buff de la Magouille) reste approximatif |

Ce que la mesure a appris (appliqué par `regles.ts`, `monstres.ts`, `etat.ts`) :
- caractéristiques réelles de chaque combattant dans les synchronisations du serveur (`initialCarac`, `caracLog`) ; PA et
  PM y sont les points RESTANTS (Flèche du Jugement dépend des PM restants) ; dommages critiques non envoyés : 185 pour
  les 4 Crâs (`UNSENT_CRA_STATS`, ajusté sur leurs coups critiques) ; Bleu Turquoise : +1 % de dommages finaux par sort ;
- Reine : ×0,9 de dommages subis par Bonbombe vivante ; Doublure et copie : chaque dommage partagé à parts égales ;
  explosion : 1000 Feu (« Dommages » 999 de la bombe) moins résistances aux monstres alignés, Reine exceptée ; bombes
  invulnérables ;
- vagues : −25 % de vitalité (sort 6722) et invulnérables jusqu'à la fin de leur premier tour ;
- IA : distance de chemin, axe le plus long d'abord ; Fumérus, Avertissement, Subtilité ; Reine au plus près, Brume dès
  que possible, Mort en Sursis sur l'allié le moins coûteux en PM.
- poussées des zones en ligne perpendiculaire (« T », Flèche de Barrage) : toutes les cibles dans le sens du lancer, pas à
  l'écart du centre de la zone (`src/engine/effects/movement.ts`, 2026-10-11) — direction juste pour 480 poussées réelles
  sur 480 dans les journaux des 10 et 11 octobre (35 fausses avant, toutes de Flèche de Barrage : 3 Crâs tués par une
  bombe poussée sur la colonne).

## Planificateur « formation en colonne » (`formation.ts`)

La tactique du combat réel du 2026-10-10 : chaque Crâ a sa case dans une colonne (Placement 2 : 327 – 354 – 381 – 408),
sort tirer et y revient à la fin de CHAQUE tour ; les bombes restent sur la colonne voisine, jamais alignées avec eux.

```
npx tsx tools/reine-des-voleurs/planificateur/formation.ts [--manche 3] [--joueur Lamouit] [--top 3]
```

Sur chaque tour de Crâ du journal, à partir de l'état EXACT du combat (moteur recalé de `fidelite.ts`), il cherche :
1. depuis la case de la colonne : sorts de soutien (Tirs Puissants, Tirs Éloignés, Acuité Absolue) et au plus une
   poussée de bombe (Recul sur sa bombe alignée, Dispersion pour dégager un axe de tir) ;
2. une case de tir (classées par le meilleur lancer possible) d'où le retour reste possible, chemins qui évitent les
   marques de « Jeu Dangereux » (elles arrêtent le pas) ; éventuellement une seconde case de tir ;
3. les sorts offensifs (faisceau sur le vrai moteur, jets moyens et critique pondéré) ;
4. le retour sur la case de la colonne.

Note : dégâts (poids par monstre : Terristocrate, Magouille d'abord) et morts ; dégâts des explosions de la fin du tour
aux monstres alignés (pousser un monstre sur la colonne des bombes) ; éloignement des monstres (la Reine surtout) ;
menaces de leur prochain tour sur les 4 Crâs, Mort en Sursis prévue par le contrôleur de la Reine en tête (pire cas de
`menaces.ts` : poids léger) ; Crâs tués par les bombes ; ripostes Avertissement reçues. Les termes qui ne dépendent que
des positions sont calculés pendant la recherche (en cache) : une poussée qui écarte la Reine passe devant un coup.
Tirs sur nos Crâs (zone autour d'un monstre collé à un Crâ) : 3 points par PV perdu, et Crâ tué, ou gardant moins de
0,8 fois ce qu'il a perdu, compté mort (−1 000 000) ; combat de 11:54 (2026-10-11), Œil pour Œil et Œil de Taupe sur le
Bourôliste collé à Java et Lamouit, puis Œil pour Œil de Kemist qui tue Java : un Crâ mort ne comptait plus pour la
Bombe Illicale posée près de lui. Bombe Illicale du Terristocrate (relance prête) pouvant atteindre un Crâ à son
prochain tour : 20 000 par Terristocrate (+1 000 par Crâ de plus à sa portée ; ×0,4 par Crâ qui joue avant lui), au lieu
du poids léger des autres menaces. Les menaces sont cherchées sans les Bonbombes qui explosent d'ici la fin de la manche
(13:19, manche 2 : une bombe vouée à exploser cachait la Mort en Sursis de la Reine sur Java).
Combats du 2026-10-11 de 17:59 à 19:25 (8 victoires sur 10) : Terristocrate achevé par les explosions de la fin du tour
compté comme tué tout de suite pour la Bombe Illicale (18:11, Java mort à 1 case de la bombe) ; Attentat du
Terristocrate (zone de 4 cases autour de lui) compté dans les menaces ; serveur : manche dans la signature d'une
demande (plan de la manche d'avant servi à Lowkey), PA/PM du script pris après 800 ms quand seuls eux diffèrent du
journal (38 plans sur 582 attendaient 6 s) ; fusion des journaux alignée sur l'heure du dernier début de combat (18:32 :
journal de Lamouit sans la manche 1, combat perdu sur un état périmé).

Vitesse (serveur) : plusieurs fils de calcul (REINE_FILS, 6 par défaut), chacun cherchant sa part des cases de tir
(option `partition` de `planFormationTurn`, faisceau 2 × sa part), le meilleur plan gardé ; recherche réelle 0,66 s au
lieu de 1,16 s sur le combat de 17:59 rejoué (8 fils se gênent : 0,91 s). Chaque fil oublie les combats passés au début
d'un nouveau (`keepCurrentFights` : fusion 40 ms au lieu de 161 ms en fin de session de 2 h) ; une demande en sondes
attend dans les fils que le journal soit prêt, le calcul part aussitôt ; le script sonde toutes les 100 ms.

Vitesse (calcul, 2026-10-12) : mêmes plans, deux fois plus vite (37 tours réels des combats du 2026-10-11 rejoués d'un
seul fil : 96 s → 48 s, plans et notes identiques sur les 37). Clones légers (`cloneFightForSim` : caractéristiques et
états partagés, jamais modifiés en place — vérifié en les gelant sur ces 37 tours et les tests du planificateur) ;
menaces : Crâs hors d'atteinte d'un monstre écartés d'avance (PM + Fumérus ou échange de la Reine + plus longue portée
ou zone), échanges de la Reine sans Crâ à portée sautés, cases atteintes calculées une fois pour les deux recherches du
Terristocrate ; distances de retour sur la colonne mises en cache ; moteur : prédicats de ligne de vue de `canCast` et
cases occupées de `reachableCells` préparés une fois par appel.

Sur les 50 tours de Crâ du combat réel (≈ 2 s par tour), le tour proposé note au moins autant que le tour joué 49 fois
(le dernier : Kemist manche 1, 3230 contre 3589, quatre tirs de zone sur une case vide) ; rejoués dans le même modèle,
les tours joués retrouvent leurs dégâts réels (Kemist manche 8 : 1655 pour 1645). `replay` (option) note un tour imposé
comme les plans. Faisceau diversifié : la meilleure ligne de chaque (case de tir, suite de sorts) est gardée.

Appris en chemin : le « −3 Portée » de Tirs Puissants ne joue qu'au tour SUIVANT du lanceur (`regles.ts`) ; le serveur
envoie les caractéristiques de début de tour (fin des buffs) un peu après le début du tour, parfois après le premier
déplacement — l'état du début de tour les attend jusqu'au premier sort (`fidelite.ts`) ; dans le moteur, un
modificateur « tous les sorts » (−3 Portée minimale de Tirs Puissants) et un modificateur propre au sort (+1 pour
Flèche Perforante) s'additionnent désormais (`src/engine/effects/buffs/spellMods.ts`). Une menace pèse ×0,4 par Crâ
qui joue encore entre ce Crâ et le monstre (les suivants peuvent l'écarter).

## En combat : `ReineCombat.lua` (scénarios des placements, serveur pour les situations inconnues)

Sur le modèle du rejeu de Fraktale : `tools/ankabot/ReineCombat.lua` (généré par `npm run reine:combat`,
`tools/fightlog/combat.ts`) réunit trois parties :

1. le journal AnkaBot, réglé pour un script qui joue : il n'écoute que les 17 messages dont le serveur a besoin
   (`ONLY_NAMES`, au lieu des 17 588 noms possibles), se tait autour du tour de son personnage, ne relit dans
   l'historique que la liste des sorts (variantes équipées) et borne les listes à 200 éléments ;
2. les scénarios des placements (`modele-rejeu.lua`, depuis le 2026-10-12) : placement selon le registre
   (`data/reine/placements.json`, signature des monstres), puis, à chaque tour, la situation du scénario appris qui
   correspond au plateau (`data/reine/scenarios`, combats appris des journaux) jouée tout de suite, sans serveur —
   voir [`../scenarios/README.md`](../scenarios/README.md) ;
3. le mode avancé (`modele-ia.lua`) : situation inconnue, placement inconnu, ou écart pendant un tour du scénario :
   l'IA du serveur de plans joue ce tour (ou sa suite : `IA_tour(case de début, repli)`), avec la colonne du
   placement (`IA_formation`) ; le tour suivant, le scénario est de nouveau cherché.

Pourquoi : avec `ReineRejeu.lua` seul (sans journal), `fightManagement` a été lancé à chaque tour des 4 Crâs (combat
du 2026-10-10 à 12:46, manches 1 à 9) ; avec `ReineIA.lua` (journal abonné à tous les noms), des tours ont été passés.

Ajouter un placement : le déclarer dans `data/reine/placements.json` (ou le laisser créer par l'apprentissage), jouer
des combats avec `ReineCombat.lua`, puis `npm run reine:scenarios -- apprendre data/fightlogs` et `npm run
reine:combat`. Avant le combat : `lancer_serveur_reine.cmd` (journal et mode avancé), puis charger `ReineCombat.lua`
sur le chef. Serveur absent : les situations connues sont jouées quand même, les autres tours sont passés
(`SI_SERVEUR_ABSENT`).

Fusion des journaux (`tools/fightlog/fusion.ts`, aussi pour le serveur de plans) : un début de manche ou une fin de
combat reçus par un journal juste après son silence (tour de son personnage et celui d'avant) sont remis à leur place,
une manche manquée pendant un silence est déduite (un combattant ne joue qu'une fois par manche), et chaque tour est pris
de préférence dans un journal qui a aussi vu le tour suivant ; `fightsOf` donne chaque combat d'une session.

## Mode avancé seul : serveur de plans et `ReineIA.lua`

1. Lancer le serveur et laisser la fenêtre ouverte : double-clic sur `tools/ankabot/lancer_serveur_reine.cmd` (ou
   `npm run reine:serveur`). Il REMPLACE `node scripts/fightlog-server.mjs` : même port (8765), mêmes fichiers
   `data/fightlogs/<date>/session-….jsonl`, plus `plans-….jsonl` (chaque plan calculé).
2. Charger `tools/ankabot/ReineIA.lua` sur le chef du groupe (AnkaBot le charge sur les mules) ; configuration de
   combat de chaque compte : IA avancée « dans le même script ». Le script contient le journal (journal-combats.lua) :
   attendre « [journal] … prêt » pour chaque personnage.
3. Engager le combat. Au placement, chaque Crâ va sur sa case de la formation reconnue ; à chaque tour, il demande son
   plan au serveur (POST /plan : sa case, ses PA/PM, la colonne), l'exécute, et redemande la suite après un écart
   (sort refusé, déplacement arrêté). Journal par personnage à côté du script : `ia_<personnage>_<date>.log` ; dans la
   fenêtre du serveur, une ligne par plan (dégâts prévus, explosions, durée, journaux utilisés).

Le serveur reconstitue l'état exact du tour en cours à partir des 4 journaux fusionnés tour par tour
(`tools/fightlog/fusion.ts`) : pendant son tour (et pendant sa demande de plan), le script d'un Crâ est occupé et ne
reçoit plus ses messages, les 3 autres les reçoivent. Il attend (4 s au plus) que le journal ait rattrapé le Crâ (sa
bombe posée, sa case, ses PA / PM) ; sinon il planifie quand même et le signale (« journal en retard »). Environ 1 s
de reconstitution et 1 s de recherche par plan. Serveur absent ou sans plan : `SANS_PLAN` du script ("passer", "ia"
pour l'IA basique d'AnkaBot, "main" pour arrêter le script).

**Reine sous Brume** (`brume.ts`) : invisible, sa case n'est plus envoyée. Règle du joueur : elle est sur la case du
milieu de la brume ou sur une case du haut ; les journaux du 2026-10-10 la placent 3 fois sur 4 sur la ligne +y (vers le
haut de l'écran), à 1, 2 ou 3 cases du milieu (exception : 202 → 176, à côté de la ligne). La reconstitution garde ses
cases possibles (le milieu + ces 3 cases) et les réduit à chaque lancer d'un Crâ : touchée, elle était dans la zone
(puis poussée) ; pas touchée, elle n'y était pas ; une poussée ou une téléportation envoyée avec sa case la donne
exactement. Tant qu'il reste plusieurs cases, le plan est un tour de recherche : sorts de soutien, case d'où une Flèche
Perforante sur le milieu (lancée d'en dessous) couvre ses cases possibles, ce tir, puis la ligne `suite` : le script
redemande la suite du tour (`SUITES` fois au plus). La Flèche Perforante repousse de 3 : la Reine finit sur la plus haute
case de la brume (elle était au milieu, toujours invisible : sa case est connue) ou hors de la brume (visible). Une seule
case possible : la Reine est posée dessus et visée comme une case (« Reine introuvable : case prévue » dans le journal du
script). Combat du matin, manche 4 : le tour de recherche proposé pour Java (→342, Flèche Perforante sur 301) est celui
qu'il avait joué, et qui l'avait trouvée. Tests : `tests/reine-brume.test.ts`.

**Tours passés (2026-10-10).** Combat de 13:10 : 14 tours de Crâ sur 52 finis en 0,2 à 0,5 s sans que `fightManagement`
ait été lancé (aucune ligne dans `ia_<personnage>_….log`), avec les mêmes messages du jeu que les tours joués ; à ces
moments, le journal du joueur traitait sans arrêt la rafale du changement de tour (un message toutes les 1 à 5 ms, une
photo de l'état tous les 15 messages). D'où, dans `ReineIA.lua` : le journal se tait du début du tour du combattant qui
précède le personnage jusqu'à la fin du tour de celui-ci (`QUIET_AROUND_MY_TURN`, les 3 autres journaux couvrent ces
tours), sans photos en combat (`FIGHT_SNAPSHOTS = false`), et chaque appel de `fightManagement` est noté avec l'heure
(`isItMyTurn()` encore faux : jusqu'à 1,5 s d'attente). `DEVELOPER_MULTI_THREADING` a été essayé puis retiré : deux fils
dans la même machine Lua (erreurs « attempt to index a function value » sur des variables locales, 3 journaux sur 4
arrêtés, combats de 16:22 à 16:30).

Régénérer le script (après une modification du journal, du modèle `tools/fightlog/modele-ia.lua` ou des formations) :
`npm run reine:ia` (`tools/fightlog/ia.ts` : `--formation "Nom=<combat enregistré>.jsonl"`, `--colonne
"Nom=Crâ:case,…"`). Tests : `tests/fightlog-fusion.test.ts`, `tests/reine-serveur.test.ts`.

## Distances de sécurité (mesurées)

Plus longue attaque de chaque monstre sur un Crâ, en cases depuis sa case de début de tour : 159 attaques relevées dans
34 combats (2026-10-10 et 2026-10-11), comparées aux données du jeu (PM, portée des sorts, téléportations). Un Crâ à
une case de plus est hors de portée au prochain tour du monstre (`SAFE`, `formation.ts` ; menaces au pire cas,
`menaces.ts`, Fumérus du Terristocrate compris depuis le 2026-10-11).

| Monstre | PM | Attaque la plus longue | Théorique | Observé | Sûr à |
|---|---|---|---|---|---|
| Reine | 6 | Mort en Sursis (1–5 en ligne, 2 par tour, échange de place) puis Coup critique au contact | dépend des combattants avec qui elle échange | 15 | 16 |
| Terristocrate | 4 | Fumérus (téléportation 1–4 en ligne) + Bombe Illicale (1–6) | 14 (10 si Fumérus en relance) | 14 | 15 |
| Magouille | 5 | Crâmes (4–8, 2 par tour) ; Crânéantissement (3–7) | 13 | 13 | 14 |
| Mâchassin | 4 | Piège à Le Ours (1–8) ; Sans se mouiller (4–10 en ligne) | 12 ; 14 en ligne | 12 | 13 |
| Bourôliste | 5 | Vers la lumière (2–7 en ligne, attire) puis Coupable au contact | 12 | 11 | 13 |
| Doublure | 3 | aucune attaque sur un Crâ relevée | — | — | — |

## Limites

- Tour d'un Crâ seul : entre deux tours, les autres combattants sont supposés immobiles (bombes et menaces). Le meilleur
  round fait jouer les monstres (`monstres.ts`) : comportement mesuré sur le combat du 2026-10-10 (ci-dessus), la Reine
  n'ayant jamais eu de Crâ à sa portée (ce qu'elle fait alors est supposé).
- Note du meilleur round : PV ôtés aux monstres (+ ½ PV max par mort) − 20 000 par Crâ mort − 2 × PV perdus par les
  Crâs − 4 000 par Crâ marqué par Mort en Sursis, sur l'état atteint au début du tour suivant du premier Crâ.
- Menaces au pire cas : un monstre est compté menaçant s'il *peut* lancer un sort offensif sur la case, même si son IA
  ne le ferait pas. Brume : seule la recherche de la Reine juste après sa Brume est modélisée (`brume.ts`), pas
  l'invisibilité reprise dans la brume à son tour (elle s'y déplace sans être vue) ; la Bombe Illicale du Terristocrate
  n'est pas modélisée.
- Caractéristiques des Crâs du planificateur : encore le profil commun `CRA_STATS` (les caractéristiques réelles de chaque
  Crâ ne sont lues que par la mesure de fidélité, d'après le nouveau journal).
- Dégâts différés (poisons) non comptés ; bonus de PO d'équipement par sort inconnus (voir ci-dessus).
- Sorts disponibles : ceux lancés pendant le combat du 2026-10-09 (`DEFAULT_SPELLS`, `etat.ts`).
- Le dictionnaire du protocole (`PROTO`, `journal.ts`) change quand Ankama renouvelle les noms obfusqués.

## Fichiers

- `etat.ts` : instantané du combat et combat du moteur correspondant (caractéristiques des Crâs, grades, données).
- `journal.ts` : lecture des journaux AnkaBot, instantané au début du tour d'un Crâ, ce qu'il a réellement joué.
- `bombes.ts` : apparitions, explosions et réactions en chaîne jusqu'au prochain tour du Crâ.
- `menaces.ts` : ce que chaque monstre peut toucher à son prochain tour.
- `recherche.ts` : la recherche (buffs, déblayage des bombes, faisceau de sorts, repli).
- `monstres.ts` : comportement des monstres (Reine, vague) ; `round.ts` : simulation clonable d'une manche (`RoundSim`) ;
  `equipe.ts` : meilleur round de l'équipe (faisceau sur les suites de tours des Crâs) ; `placement.ts` : meilleur
  placement (potentiel des cases rouges, puis meilleur round des meilleurs ensembles de 4 cases, cases réparties entre
  les Crâs pendant la recherche).
- `regles.ts` : règles du combat mesurées sur le combat réel (Reine, Doublure, explosions, vagues, ripostes, Tirs
  Puissants, scénario du moteur) ; `fidelite.ts` : mesure de fidélité du moteur sur un journal, et état exact de chaque
  tour de Crâ (`onCraTurn`) ; `formation.ts` : planificateur de tour « formation en colonne » (tests
  `tests/reine-formation.test.ts`) ; `brume.ts` : cases possibles de la Reine sous Brume.
- `index.ts`, `comparaison.ts`, `etalonnage.ts` : commandes.
- `web.ts` : fonctions de la section web (journal, direct, nouveau combat, dangers, tours, replays) ; page
  `web/src/reine.ts`, API `web/plugins/reine.ts`, tests `tests/web-reine.test.ts` et `tests/reine-bombes.test.ts`.
