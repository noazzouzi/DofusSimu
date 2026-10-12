# Scénarios des placements — Reine des Voleurs (4 Crâs)

But : ne plus attendre le serveur de plans à chaque tour. Pour chaque placement, le script de combat
(`tools/ankabot/ReineCombat.lua`) connaît un **scénario** : pour chaque tour de chaque Crâ, les situations déjà
rencontrées et, pour chacune, les actions exactes à jouer (déplacements et sorts). Une situation connue est jouée
**tout de suite** ; une situation inconnue est confiée au serveur de plans, et le combat, enregistré par le journal,
l'ajoute au scénario quand il est appris. Plus il y a de combats appris par placement, moins le serveur sert.

## Le cycle

1. **Déclarer les placements** dans `data/reine/placements.json` (voir plus bas). Un placement de monstres inconnu est
   aussi ajouté tout seul au premier combat appris (« Auto 132-134-178-208 ») : il suffit de le renommer.
2. **Jouer** quelques combats par placement avec `ReineCombat.lua` et le serveur lancé (`lancer_serveur_reine.cmd`) :
   au début, le serveur joue presque tout ; le journal enregistre chaque combat (`data/fightlogs/<jour>/session-….jsonl`).
3. **Apprendre** les combats joués, puis régénérer le script :

   ```
   npm run reine:scenarios -- apprendre data/fightlogs            # toutes les sessions (une session relue ne double rien)
   npm run reine:scenarios -- resume                              # ce qui est appris, couverture
   npm run reine:combat                                           # ReineCombat.lua avec les scénarios compilés
   ```

4. Recommencer : la couverture monte, le serveur est de moins en moins sollicité.

Première fois : `apprendre data/fightlogs` sur tous les journaux déjà enregistrés (combats joués à la main et par l'IA
depuis le 2026-10-10) donne d'emblée des scénarios aux Placements 2 et 3. Les deux combats joués à la main de
l'ancien `ReineCombat.lua` (session-21-27-31 et session-00-27-27, jusqu'à la mort de la Reine) ont été repris dans la
bibliothèque ; une fois leurs sessions apprises depuis les journaux, on peut retirer la copie :
`npm run reine:scenarios -- oublier "2026-10-10/session-21-27-31.jsonl (ReineCombat"` (de même pour l'autre).

## Placements (`data/reine/placements.json`)

```json
{
  "nom": "Placement 4",
  "monstres": [
    { "espece": 3726, "cellule": 133, "nom": "Reine des Voleurs" },
    { "espece": 3746, "cellule": 135, "nom": "Mâchassin" },
    { "espece": 3747, "cellule": 178, "nom": "Terristocrate" },
    { "espece": 3748, "cellule": 208, "nom": "Doublure" }
  ],
  "cases": { "Java-Springboot": 327, "Lamouit": 354, "Lowkey-Jealous": 353, "Kemist-Skyler": 351 },
  "colonne": { "Java-Springboot": 327, "Lamouit": 354, "Lowkey-Jealous": 381, "Kemist-Skyler": 408 }
}
```

- `monstres` : cases des monstres au début du combat — la signature que le script reconnaît pendant la phase de
  placement (seules les cases comptent, comme en jeu ; deux placements ne peuvent pas avoir les mêmes cases) ;
- `cases` : case de placement de chaque Crâ ; `colonne` : sa case de fin de tour. Facultatives : sans elles, celles du
  placement par défaut (`"defaut"`, Placement 3), qui sert aussi aux placements de monstres inconnus.

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

- `placements.ts` : registre des placements (lecture, vérification, reconnaissance, placements « Auto »).
- `bibliotheque.ts` : bibliothèque d'un placement (format compact, une branche par ligne), ajout d'un combat.
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
