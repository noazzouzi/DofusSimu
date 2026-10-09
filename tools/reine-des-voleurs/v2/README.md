# Reine des Voleurs — v2 (règle d'apparition confirmée)

Scripts et sorties qui fondent la stratégie [`docs/strategies/reine-des-voleurs/strategie-4-cras.md`](../../../docs/strategies/reine-des-voleurs/strategie-4-cras.md)
(formation **F-A**, 2026-10-09). Ils remplacent l'instantané `v2-en-cours/`.

Règle d'apparition des Bonbombes donnée par le joueur : **en haut** du personnage, sinon **en haut à droite**. Comme « en
haut » peut se lire à 1 ou 2 cases visuelles (N2 ou N4) et le repli de plusieurs façons, la recherche couvre 10 lectures
(5 règles × 2 moments d'explosion), les 24 ordres de jeu des Crâs et 2 ordres de réaction en chaîne.

Exécution : `npx tsx tools/reine-des-voleurs/v2/<dossier>/<script>.ts` **depuis la racine du dépôt** (les chemins de
données sont relatifs à la racine). Chaque `<script>.ts` a sa sortie dans `<script>.txt` quand elle est conservée.
Ces dossiers ne font pas partie du `tsconfig` : ce sont des scripts d'étude, pas du code de l'application.

| Dossier | Contenu |
|---|---|
| `search/` | Modèle des bombes v2 (`modele2.ts`, `fastsim.ts`) et recherche exhaustive des formations (11,36 M d'ensembles statiques, puis transitions et alternances). Fiches finales dans `fin/` : **`F3.txt` = F-A** (retenue), `F1.txt` = F-C, `F2.txt` = F-B (les numéros de fichier ne suivent pas les lettres). Robustesse des candidates dans `rob/`. |
| `verify/` | Second simulateur écrit indépendamment (`sim.ts`) et contrôles croisés (`verif.txt`, `extra.txt`, `geo-check.txt`). |
| `damage/` | Dégâts de chaque sort du Crâ (deux variantes) avec les caractéristiques réelles, contre chaque monstre des vagues et la Reine ; rotations par tour ; utilitaires (Pesanteur via Représailles, Flèche de Recul, balises). Synthèse : `tableau-final.txt`, `resume-sorts.txt`. |
| `review/` | Relecture adverse (`r1` à `r11`) : géométrie, robustesse, Représailles, dégâts reçus, cases de secours, bombe chassée. |
| `strategy/` | Mesures propres au document (`mesures*.ts`, `tour1.ts`, `ldv-bleues.ts`, `bleues-union.ts`) et schéma (`schema-formation.mjs` → SVG, `render.cjs` → PNG). |

Non conservés (trop volumineux, régénérables) : sorties brutes de la recherche statique (`stat5-*.txt`,
`classe1*.json`, `detail-*.json`, `trans2-*.txt`, `reste-pm5.json`) et `damage/rotations.json`.
