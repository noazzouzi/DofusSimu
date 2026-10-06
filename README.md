# DofusSimu

Simulateur de combats et d'équipements pour **Dofus** : données du jeu (équipements, panoplies, exos,
classes et sorts, monstres, donjons et cartes), calcul de dégâts exact (formules DoMath), moteur de combat
tour par tour avec **replays animés**, IA des monstres et IA de groupe (4 personnages), optimiseurs des **builds**
(stuff, exos, points, variantes de sorts) et de la stratégie par simulation massive, pour une composition d'équipe
**choisie par l'utilisateur**.

Démo cible : **Œil de Vortex** (donjon de dimension Xélorium, niveau 200, combat de vagues + boss Vortex).

## Démarrage

```bash
npm install
npm run dev          # interface web (visualiseur) sur http://localhost:5173
npm test             # tests unitaires
npm run fetch:data   # (re)télécharge les données du jeu depuis l'API DofusDB
```

## Utilisation

### Composition de l'utilisateur

**La composition d'équipe (les classes) d'un donjon est choisie par l'utilisateur** ; le simulateur optimise tout le
reste pour cette composition : build de chaque personnage (preset élément/rôle, stuff avec exos et transcendances,
points de caractéristiques, variantes des 22 paires de sorts) et stratégie de combat (θ de l'IA). La recherche
automatique de composition (commande `team`) reste disponible, mais seulement sur demande.

La composition d'un donjon est dans `data/teams/<scénario>.json` ; c'est l'équipe par défaut des commandes quand
`--team` est absent. Pour l'Œil de Vortex (`data/teams/vortex.json`, décision du 2026-10-05) : **1 Eniripsa,
1 Enutrof, 2 Crâs**.

```json
{
  "version": 1,
  "scenario": "vortex",
  "chosenBy": "utilisateur",
  "decidedAt": "2026-10-05",
  "members": [
    { "class": "eniripsa" },
    { "class": "enutrof" },
    { "class": "cra" },
    { "class": "cra" }
  ],
  "notes": "texte libre (ou liste de lignes)"
}
```

| Champ d'un membre | Rôle |
|---|---|
| `class` (obligatoire) | classe : nom (`cra`, `Crâ`), alias (`eni`, `enu`) ou identifiant (`9`) ; un membre peut aussi s'écrire `"cra"` |
| `name` | nom affiché (défaut : la classe, « Crâ 2 » pour le second Crâ) |
| `preset` | build par défaut : id de preset (`cra_feu_vortex`), `preset@stuff` ou `classe:qualificatif` (`cra:air`) |
| `stuff` | stuff de `data/ai/presets.json` (`vortex_cra_feu_def`, `unstuffed`…) |
| `role` | rôle imposé à l'IA (`killer`, `zoneDps`, `mpLock`, `healer`…) |
| `variants` | 22 choix 0/1 des paires de sorts |
| `build` | build complet (objets avec forgemagie, points, parchemins) ou chemin d'un fichier écrit par `stuff --out` (relatif au fichier d'équipe) |
| `candidates` | presets que `optimize` essaie pour ce membre (défaut : automatiques) |
| `fixed` | `true` : `optimize` ne change pas le build de ce membre |

Sans `preset`, un membre prend la **version du scénario** des presets de sa classe (presets dérivés
`<preset>_vortex[_def|_off]`, dont le stuff a été construit par l'optimiseur pour ce donjon) ; le k-ième membre d'une
même classe prend le k-ième build : au Vortex, Eniripsa `eniripsa_soin_vortex`, Enutrof `enutrof_retrait_pm_vortex`,
Crâ `cra_feu_vortex` et second Crâ `cra_air_entrave_vortex`. `optimize --save-team` écrit les builds retenus dans le
fichier (sans les imposer : une nouvelle optimisation repart de ces builds).

Équipe d'une commande : `--team` (builds exacts), `--classes eniripsa,enutrof,cra,cra` (classes seules, doublons
permis, aussi `eni,enu,cra*2` ou `7,3,9,9`) ou `--team-file <fichier>` — trois options **exclusives** (en donner deux
est une erreur) ; sans aucune, `data/teams/<scénario>.json` (`--teams-dir` pour un autre dossier), sinon l'équipe
d'exemple historique. Un build épinglé par un membre (`preset`) n'est pas repris par défaut pour un autre membre de la
même classe : celui-ci prend le build suivant de la liste.

`optimize --save-team` écrit dans le fichier de la composition (ou `--save-team <fichier>`) ; un fichier existant qui
contient une **autre** composition n'est jamais remplacé (erreur avant le premier combat). `--theta <fichier>` donne le
θ de départ de toutes les commandes ; `optimize --tune-theta` (`--theta-paths a,b` pour restreindre) règle θ, dans la
limite de `--max-fights`.

### Commandes

`npm run sim -- <commande> [options]` (`npm run sim -- help` pour toutes les options). Exemples pour l'équipe du
Vortex :

```bash
npm run sim -- fight vortex --seed 3                  # un combat, replay animé dans web/public/replays/
npm run sim -- batch vortex --runs 128 --workers 3    # Monte-Carlo : victoires (IC de Wilson), tours, causes d'échec
npm run sim -- batch vortex --classes eni,enu,cra*2 --runs 64 --workers 3   # même composition, donnée en ligne

# Builds de la composition : presets de chaque classe (versions Vortex), stuffs optimisés pour les presets qui n'en ont
# pas, criblage membre par membre puis successive halving apparié (graines communes), validation sur graines neuves.
npm run sim -- optimize vortex --dry-run                                        # options et combats prévus, sans jouer
npm run sim -- optimize vortex --budget quick --workers 3                       # ≈ 450 combats (≈ 1 h 15 sur 3 workers)
npm run sim -- optimize vortex --budget normal --max-fights 900 --workers 3 --save-team
npm run sim -- optimize vortex --budget full --tune-theta --workers 3            # + variantes de sorts et réglage de θ (coûteux)
npm run sim -- optimize vortex --theta runs/theta-vortex.json --workers 3        # builds avec un θ déjà réglé (sans le régler)

npm run sim -- stuff vortex --member 4 --profile defensive --out data/teams/builds/cra2-def.json   # stuff d'un membre
npm run sim -- report docs/reports/vortex-builds-eniripsa-enutrof-cra-cra.json --out /tmp/rapport.md
npm run sim -- tune vortex --seeds 16 --generations 6 --out runs/theta-vortex.json   # θ seul (puis --theta)
npm run sim -- rewind vortex --seed 3                 # rembobinage d'une défaite (optimiste, démo)
npm run sim -- team vortex --top 200                  # recherche AUTOMATIQUE de composition (opt-in)
```

`optimize` écrit un rapport Markdown + JSON dans `docs/reports/<id>.{md,json}` (en-tête « composition choisie par
l'utilisateur », options essayées, tableaux de criblage et de halving : victoires, objectif, corrompus, tours, première
mort, différences APPARIÉES avec la référence ; validation ; stuffs, sorts, plan de combat) et le meilleur combat de la
validation dans `web/public/replays/`. Les combats joués sont mis en cache (`runs/optimize-<scénario>.jsonl`) : une
optimisation interrompue reprend sans rejouer. Coût : un combat `fast` au Vortex prend ≈ 20-40 s de CPU ; budgets
`quick` (≈ 450 combats au plus pour l'équipe du Vortex), `normal` (≈ 1 050), `full` (≈ 3 200, variantes comprises),
plafond `--max-fights` ; `--dry-run` affiche les options et le nombre de combats prévus. Les victoires sont
rares : un taux de victoire se juge sur 128-256 graines au moins ; le criblage compare corrompus, tours et première
mort sur graines communes.

## Architecture

| Dossier | Rôle |
|---|---|
| `data/dofusdb/` | Données du jeu normalisées (extraites de l'API DofusDB) |
| `data/maps/`, `data/dungeons/` | Cartes de combat (cellules, lignes de vue, placements) et scénarios de donjons |
| `docs/research/` | Recherche : formules (DoMath), règles de combat, effets de sorts, classes, Vortex, IA des monstres |
| `src/core` | Types partagés, RNG déterministe |
| `src/map` | Géométrie de carte, ligne de vue, pathfinding |
| `src/damage` | Formules de dégâts / soins / retraits / poussée |
| `src/stats` | Agrégation stuff → caractéristiques (panoplies, exos, parchemins) |
| `src/engine` | Moteur de combat (état, effets, tours, journal d'événements = replay) |
| `src/ai` | IA monstres (génériques + spécifiques boss) et IA joueurs/groupe (recherche) |
| `src/dungeons` | Scénarios (vagues, phases de boss) |
| `src/optimizer` | Monte-Carlo, optimiseur de stuff (exos, transcendances, points), variantes, θ, builds d'une composition donnée (`builds.ts`), recherche de composition (opt-in), rapports |
| `src/cli` | Ligne de commande (`npm run sim -- …`) : fight, batch, optimize, stuff, report, tune, rewind, team, bench, presets |
| `data/teams/` | Composition choisie par l'utilisateur pour chaque donjon (`vortex.json`) |
| `web/` | Interface : visualiseur de combats animés, constructeur d'équipe, calculateur |

Voir [`docs/ROADMAP.md`](docs/ROADMAP.md) pour l'avancement par checkpoint.

## Sources et licences

- **Données issues de DofusDB. Utilisation soumise à la LPNC-IA 1.0.** ([api.dofusdb.fr](https://api.dofusdb.fr/)) —
  usage non commercial ; utilisation autorisée par DofusDB pour ce projet selon le propriétaire du dépôt.
- Fichiers du jeu distribués par Ankama (via l'outil open source [doduda](https://github.com/dofusdude/doduda)) pour le recoupement.
- Formules de combat : [DoMath](https://domath.fr) et code client décompilé (références détaillées dans `docs/research/formulas.md`).
- Dofus est une marque d'Ankama Games ; projet non officiel, non commercial, à but d'analyse.
