# Scénarios des placements — Reine des Voleurs (4 Crâs)

But : ne plus attendre le serveur de plans à chaque tour. Pour chaque placement, le script de combat
(`tools/ankabot/ReineCombat.lua`) connaît un **scénario** : pour chaque tour de chaque Crâ, les situations déjà
rencontrées et, pour chacune, les actions exactes à jouer (déplacements et sorts). Une situation connue est jouée
**tout de suite** ; une situation inconnue est confiée au serveur de plans, et le combat, enregistré par le journal,
l'ajoute au scénario quand il est appris. Plus il y a de combats appris par placement, moins le serveur sert.

## Le cycle

1. **Placements** : les 12 placements du donjon sont déclarés dans `data/reine/placements.json` (voir plus bas). Un
   placement de monstres absent du registre serait ajouté tout seul au premier combat appris (« Auto 132-134-178-208 »,
   monstres seulement : les Crâs s'y placent comme au placement par défaut). Après une correction du registre
   (placement renommé, monstres corrigés), `npm run reine:scenarios -- reclasser` range chaque combat appris dans la
   bibliothèque de son placement (`--essai` : rien n'est écrit).
2. **Jouer** avec `ReineCombat.lua` et le serveur lancé (`lancer_serveur_reine.cmd`) ; le journal enregistre chaque
   combat (`data/fightlogs/<jour>/session-….jsonl`).
3. **Apprendre** les combats joués, puis régénérer le script :

   ```
   npm run reine:scenarios -- apprendre data/fightlogs            # toutes les sessions (une session relue ne double rien)
   npm run reine:scenarios -- tableau                             # combats gagnés/joués par placement et modificateur
   npm run reine:scenarios -- resume                              # ce qui est appris, couverture
   npm run reine:combat                                           # ReineCombat.lua avec les scénarios compilés
   npm run reine:algorithme                                       # ReineCombat.lua sans scénarios (l'IA joue tout)
   ```

**Nouveau départ (2026-10-12)** : les bibliothèques d'avant sont archivées dans `data/reine/archives/2026-10-12/`, et
seuls les combats commencés depuis le `"depuis"` du registre des placements sont appris (une session close avant n'est
pas relue). Campagne : beaucoup de combats joués par l'algorithme seul (`npm run reine:algorithme`, à régénérer ainsi
tant que la campagne dure), chacun appris avec son placement et son **modificateur de dimension**, jusqu'à couvrir les
combinaisons placement × modificateur (`tableau`). Les scénarios seront ensuite compilés par placement et modificateur.

## Modificateurs de dimension (`data/reine/modificateurs.json`)

Chaque combat a un modificateur, reconnu aux sorts lancés au début de la manche 1, avant le premier tour, par les Crâs
et/ou les monstres (Crâs +25 % dommages finaux et monstres +50 % vitalité ; monstres soignés de 50 % des dommages
infligés…). Les sorts lancés à chaque combat (`"communs"` : passifs des Crâs, Péché Mignon, Doublage) ne comptent pas.
Dix modificateurs relevés le 2026-10-12, nommés par leurs sorts (noms du jeu inconnus) ; un ensemble de sorts inconnu
en crée un « Auto <sorts> » à l'apprentissage : le renommer, ou, si c'est un nouveau passif des Crâs (équipement
changé), ajouter son sort aux `"communs"`. Une deuxième couche (sorts 23441, 23450, 23442), vue le 2026-10-11 de 14:37
à 16:11 en plus d'un autre modificateur, en crée un « Auto » combiné si elle revient. Le modificateur n'est connu
qu'après la phase de placement : il ne change que les tours, pas le placement des Crâs.

## Placements (`data/reine/placements.json`)

```json
{
  "nom": "Placement 3",
  "monstres": [
    { "espece": 3747, "cellule": 132, "nom": "Terristocrate" },
    { "espece": 3726, "cellule": 134, "nom": "Reine des Voleurs" },
    { "espece": 3746, "cellule": 178, "nom": "Mâchassin" },
    { "espece": 3748, "cellule": 208, "nom": "Doublure" }
  ],
  "cases": { "Java-Springboot": 327, "Lamouit": 354, "Lowkey-Jealous": 353, "Kemist-Skyler": 351 },
  "colonne": { "Java-Springboot": 327, "Lamouit": 354, "Lowkey-Jealous": 381, "Kemist-Skyler": 408 }
}
```

- `monstres` : espèce et case de chaque monstre au début du combat — la signature que le script reconnaît pendant la
  phase de placement. L'espèce compte autant que la case : plusieurs placements occupent les mêmes cases avec des
  monstres permutés (1, 3 et 6 ; 2 et 4 ; 5, 8 et 11 ; 7 et 9). Si AnkaBot ne donne pas encore l'espèce des monstres
  pendant le placement, le script le signale et retombe sur les cases seules (premier placement de ces cases) ;
- `cases` : case de placement de chaque Crâ ; `colonne` : sa case de fin de tour. Facultatives : un Crâ absent garde sa
  case du placement par défaut (`"defaut"`, Placement 3), qui sert aussi aux placements de monstres inconnus. Les Crâs
  se placent partout de la même façon : seul le Placement 3 les déclare, et l'apprentissage n'en écrit jamais (les cases
  de départ d'un combat appris sont celles où le jeu a mis les Crâs quand le placement a échoué).

## Bibliothèque (`data/reine/scenarios/<placement>.json`)

Versionnée (les journaux, volumineux, ne le sont pas). Pour chaque combat appris : session et rang du combat, heure,
issue (victoire, abandon, défaite, interrompu), manches, vague atteinte, Crâs morts. Pour chaque tour de Crâ joué, une
**branche** : Crâ, n-ième tour, plateau au moment où il commence à jouer (coéquipiers, Bonbombes — celle du tour
marquée « + » —, monstres), PA et PM dépensés, actions exactes ; une branche jouée dans plusieurs combats n'est écrite
qu'une fois, avec les combats où elle l'a été (dégâts du tour, Crâs morts dans la manche qui a suivi).

Extraction : chaque combat d'une session est fusionné à part depuis les journaux des 4 Crâs (`tools/fightlog/
fusion.ts` : pendant son tour, le journal du Crâ qui joue se tait, les autres l'enregistrent), reconstitué et vérifié
contre les synchronisations du serveur (`tools/fightlog/rejeu.ts`, combat refusé sinon), puis découpé en tours
(`tools/fightlog/scenario.ts`). Les combats d'autres donjons sont ignorés.

## Scénario optimal (`compilation.ts`)

Une **situation** = (Crâ, n-ième tour, case de départ, plateau). Pour chacune, le meilleur des tours qui y ont été joués :

1. le moins souvent suivi d'une mort de Crâ dans la manche (suivi d'une mort dans au moins la moitié des combats :
   écarté, la situation revient au serveur) ;
2. le plus souvent gagnant, taux lissé `(gagnés + 1) / (joués + 2)` (un seul combat gagné ne vaut pas 100 %) ;
3. le plus de dégâts en moyenne ; 4. le plus souvent joué, puis le plus récent.

Écartés aussi : les tours sans action (tour passé par AnkaBot) et ceux qui ne finissent pas sur la case de la colonne.
`npm run reine:combat -- --depuis 2026-10-12` ignore les combats plus anciens (variantes de sorts ou stuff changés :
un sort que le Crâ n'a plus fait planter AnkaBot) ; `--morts-max 0.3` rend le point 1 plus sévère.

## En combat : correspondance plateau ↔ situation

Au début de chaque tour, le script relève le plateau (`fightAction:getAllEntities()`) et cherche, parmi les situations
du n-ième tour de ce Crâ (puis de la manche d'AnkaBot si elle diffère), celle qui correspond — mêmes règles en Lua
(`modele-rejeu.lua`, `correspond`) et en TypeScript (`matchPlan`, utilisé par la couverture et les tests) :

- même case de départ ; au moins les PA et PM que le tour dépense ;
- mêmes coéquipiers sur les mêmes cases ; mêmes Bonbombes (celle du tour peut ne pas être encore apparue) ;
- autant de monstres de chaque espèce, chacun sur sa case (un monstre invisible dans la situation n'est pas comparé),
  sauf un monstre **loin** de tous les Crâs (au-delà de sa portée mesurée + 1 : Reine 17, Terristocrate 16, Magouille
  15, Mâchassin et Bourôliste 14, Doublure 13) et pas visé par le tour : il peut être ailleurs s'il y est loin aussi
  (2 au plus, `TOLERANCE_LOIN`) ;
- sorts du tour pas en relance (`canCastSpellOnCell` : RELANCE ou TROP_DE_LANCERS → situation écartée).

Plusieurs situations correspondent : la plus exacte, puis la meilleure. Aucune : le serveur de plans joue ce tour
(`SI_AUCUNE_BRANCHE = "avance"`), et le tour suivant le scénario est de nouveau cherché ; serveur absent :
`SI_SERVEUR_ABSENT` (`"passer"` : rester sur sa case). Pendant un tour du scénario, un écart (sort refusé, déplacement
arrêté, ou PM insuffisants pour les déplacements qui restent — sortir sans pouvoir rentrer, c'est la mort par les
bombes) fait jouer la suite du tour par le serveur (`SUITE_SI_ECART = "avance"`) ; à la fin, retour sur la case de fin.
Le journal du script (`rejeu_<personnage>_<date>.log`) dit pour chaque tour la situation jouée (combats appris,
victoires), ou pourquoi aucune ne correspondait, et le compte des tours joués par le scénario et par le serveur.

## Couverture

`npm run reine:scenarios -- resume [--detail]` rejoue chaque combat appris contre le scénario appris des **autres**
combats : un de ses tours est couvert si une situation correspond. La couverture estime la part des tours qu'un
nouveau combat jouera sans serveur, et les « manches jouées d'affilée » combien de manches s'enchaînent sans lui.

## Fichiers

- `placements.ts` : registre des placements (lecture, vérification, reconnaissance par espèce et case, placements
  « Auto »).
- `modificateurs.ts` : registre des modificateurs de dimension (reconnaissance aux sorts du début du combat).
- `bibliotheque.ts` : bibliothèque d'un placement (format compact, une branche par ligne), ajout d'un combat avec son
  placement (monstres) et son modificateur.
- `apprendre.ts` : sessions → combats fusionnés → scénarios → bibliothèques.
- `compilation.ts` : scénario optimal, correspondance (`matchPlan`), couverture.
- `index.ts` : commande `npm run reine:scenarios`.
- Script : `tools/fightlog/combat.ts` (génère `ReineCombat.lua`), `tools/fightlog/modele-rejeu.lua` (scénarios),
  `tools/fightlog/modele-ia.lua` (serveur de plans : `IA_tour(case de début, repli)`).
- Tests : `tests/reine-scenarios.test.ts` (combats synthétiques au format du journal), `tests/reine-scenarios-lua.test.ts`
  (le script Lua généré, exécuté avec une API AnkaBot simulée ; sauté sans interpréteur Lua), `tests/fightlog-fusion.test.ts`.

## Limites

- Le n-ième tour d'un Crâ sert de repère (avec la manche d'AnkaBot en second essai) : un tour où AnkaBot n'a pas
  lancé `fightManagement` décale le compte du script (le second essai rattrape un décalage d'un tour).
- Les PV, buffs et états ne sont pas comparés : une situation identique aux cases près, avec des PV différents, rejoue
  le même tour (un monstre déjà mort n'est plus sur le plateau, la situation ne correspond donc plus).
- Reine sous Brume : un tour de recherche appris rejoue la même suite, même si la Reine était ailleurs dans la brume
  (sorts visant la Reine suivis là où elle est visible, sinon sur sa case apprise).
- La qualité d'un tour se juge sur l'issue du combat et la manche qui suit : un tour moyen dans un combat gagné compte
  comme gagnant. Plus il y a de combats, plus le choix est sûr.
