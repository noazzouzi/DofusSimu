# DofusSimu

Simulateur de combats et d'équipements pour **Dofus** : données du jeu (équipements, panoplies, exos,
classes et sorts, monstres, donjons et cartes), calcul de dégâts exact (formules DoMath), moteur de combat
tour par tour avec **replays animés**, IA des monstres et IA de groupe (4 personnages), optimiseurs de
**stuff** et de **composition d'équipe** par simulation massive.

Démo cible : **Œil de Vortex** (donjon de dimension Xélorium, niveau 200, combat de vagues + boss Vortex).

## Démarrage

```bash
npm install
npm run dev          # interface web (visualiseur) sur http://localhost:5173
npm test             # tests unitaires
npm run fetch:data   # (re)télécharge les données du jeu depuis l'API DofusDB
```

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
| `src/optimizer` | Optimiseur de stuff (avec exos), de composition d'équipe, Monte-Carlo |
| `web/` | Interface : visualiseur de combats animés, constructeur d'équipe, calculateur |

Voir [`docs/ROADMAP.md`](docs/ROADMAP.md) pour l'avancement par checkpoint.

## Sources et licences

- **Données issues de DofusDB. Utilisation soumise à la LPNC-IA 1.0.** ([api.dofusdb.fr](https://api.dofusdb.fr/)) —
  usage non commercial ; utilisation autorisée par DofusDB pour ce projet selon le propriétaire du dépôt.
- Fichiers du jeu distribués par Ankama (via l'outil open source [doduda](https://github.com/dofusdude/doduda)) pour le recoupement.
- Formules de combat : [DoMath](https://domath.fr) et code client décompilé (références détaillées dans `docs/research/formulas.md`).
- Dofus est une marque d'Ankama Games ; projet non officiel, non commercial, à but d'analyse.
