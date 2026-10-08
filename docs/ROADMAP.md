# Roadmap — checkpoints

Chaque checkpoint est commité et poussé dans un état utilisable.

- [x] **CP0 — Squelette** : TypeScript/Vite/Vitest, géométrie de la grille Dofus (560 cellules), page web minimale.
- [x] **CP1 — Données & recherche** : extraction DofusDB (19 classes × 44 sorts, 3 826 équipements, 521 panoplies,
      5 135 monstres, 187 donjons, 759 cartes de salles), formules DoMath + vecteurs de test, règles de combat,
      catalogue des 212 effets, grammaires zones/masques/déclencheurs, dossier Vortex, IA des monstres,
      équipements/forgemagie, analyse des 19 classes (`docs/research/`).
- [x] **CP2 — Calculateur** : agrégation stuff → caractéristiques (panoplies, exos, conditions), calcul de dégâts
      selon DoMath (mode `domath` identique à une transcription TypeScript de la fonction de dégâts `Rg` de DoMath sur
      ≈ 45 000 tirages aléatoires, et aux 43 vecteurs `domath-damage` produits par le vrai bundle DoMath —
      `tests/damage-properties.test.ts`, `tests/damage-vectors.test.ts` ; validé contre DoMath, pas contre le jeu),
      LdV exacte du client, zones/masques/critères complets.
      *(La page web « calculateur » viendra avec l'interface d'équipe.)*
- [x] **CP3 — Moteur de combat + replays animés** : état de combat, PA/PM, ligne de vue, déplacements & tacle,
      4 familles d'effets (212 effectId), déclencheurs, invocations, glyphes/pièges ; 856 sorts testés sans
      exception (`docs/engine-coverage.md`) ; visualiseur animé (démo synthétique — les vrais combats arrivent au CP4).
- [x] **CP4 — IA & Vortex** : IA des monstres (profils officiels + Vortex en 2 phases), IA de groupe (commandant,
      recherche de tour fast/standard/deep, rollouts, 8 tactiques créatives), scénario Vortex (vagues, horloge de
      l'Auroraire, corruption) et planificateur d'heures ; combats complets joués et animés (`web/public/replays/`).
      Réglage itératif (`docs/tuning-log.md`, 3 tours mesurés en apparié + vérifications adverses) : ligne de mise à
      mort, recherche fast de largeur 3 ; moteur ≈ 2,5× plus rapide (copie-sur-écriture, caches vérifiés bit à bit).
      Audit de fidélité du Vortex (`docs/research/vortex-audit.md`) : règles corrigées selon la 2.42 (vagues tous les
      6 tours, ressuscités −1 PM, boss de rang 1 à 4 ; plus de limite de tours à 60). Réglage sur l'équipe de
      l'utilisateur (tour 5). **Le simulateur gagne le Vortex** : 6,4 % de victoires [IC 95 % 4,9 – 8,3 %] sur 768
      combats inédits en IA `fast` (replays gagnants dans le visualiseur). Pistes : vagues 3-5 trop lentes à corrompre,
      Pacifiste (25-28 % des tours), phase 2 longue.
- [x] **CP5 — Optimiseurs** : **la composition d'équipe est une ENTRÉE de l'utilisateur** (décision du 2026-10-05 :
      « je préfère que ce soit l'utilisateur qui détermine les classes/personnages pour un donjon » ; Vortex =
      1 Eniripsa, 1 Enutrof, 2 Crâs, `data/teams/vortex.json`) ; **l'optimisation porte sur les builds et la
      stratégie** de cette composition : preset élément/rôle de chaque personnage, stuff optimal (exos,
      transcendances, points ; proxy calibré sur les dégâts réellement subis — `docs/reports/vortex-stuffs.md` :
      +2 corrompus, +6,5 tours survécus), variantes de sorts, θ de l'IA. Livré : fichiers d'équipe par donjon
      (équipe par défaut des commandes), `--classes`, commandes `optimize` (criblage membre par membre + successive
      halving appariés, validation, rapport Markdown/JSON, meilleur replay, `--save-team`), `stuff`, `report`, `tune`,
      `rewind` ; la recherche automatique de composition (`team`, `src/optimizer/team/halving.ts`) reste disponible
      en opt-in seulement (campagne interrompue : `docs/reports/vortex-composition.md`). **Livrés** : builds de
      l'équipe Eniripsa/Enutrof/2 Crâs Terre (`docs/reports/vortex-equipe-utilisateur.md`) et rapport final Vortex
      (`docs/reports/vortex-rapport-final.md` : stuffs, sorts, déroulé vague par vague, replay gagnant ; 49 / 768 =
      6,4 % de victoires vérifiées en IA `fast`, limite de tours retirée).
- [x] **CP6 — Theorycraft contre un boss** (2026-10-07/08 ; usage personnel, PvM, un joueur) : réponses
      **déterministes**, sans combat d'IA, à « quel stuff est le plus intéressant contre ce boss ? » et « quelles
      classes sont les plus intéressantes contre ce boss ? », pour les 137 boss de donjon (162 avec les Expéditions).
      Guide : `docs/theorycraft.md` ; conception et état du code : `docs/design/theorycraft.md`. **Livré** :
      index et recherche des boss (grade = joueurs − 3) ; fiche du boss (sort de départ appliqué, profil offensif par
      phase, mécaniques, avertissements et hypothèses ; 162 fiches en ≈ 0,13 s) ; fiches manuelles
      `data/bosses/<id>.json` (schéma validé, règles de sources) ; cible explicite du proxy de stuff (plus de repli
      silencieux sur le mix du Vortex) ; DPT soutenu en régime établi et postures de classe ; utilités chiffrées ;
      classement des 49 presets sur 5 axes sans note globale et composition à règles écrites (≈ 0,5-0,8 s) ; meilleur
      stuff (optimiseur sans graines `vortex_*`, top distinct, stuffs génériques, lien RoxxSolver, classement en DPT
      soutenu pour les classes à posture, équivalences des caractéristiques ; ≈ 2,5-5 s) ; CLI `bosses`, `boss`,
      `boss … classes|stuff`, `degats` (calculateur d'un sort pour vérifier en jeu) ; page web `#boss` (serveur de
      dev) ; extraction DofusDB prête pour le schéma 3.7 (garde-fous, écriture tout ou rien). **Limites** : calcul et
      non combat (ni positions, ni invocations, glyphes, pièges, rampes ; dégâts du boss en borne haute) ; stuffs
      génériques de 12/2024 et presets écrits à la main ; aucune fiche manuelle rédigée (seulement le modèle) ;
      `classes --optimize` aveugle aux postures (Zobal Psychopathe 1 852 → 538 de DPT soutenu contre le Père Ver) ;
      données 3.6 du 2026-10-04 alors que la 3.7 est sortie le 2026-10-06 (ré-extraction : décision de
      l'utilisateur, elle change les valeurs de référence du Vortex) ; aucune vérification en jeu faite. **Suites
      possibles** : fiches manuelles des boss visés (sources citées) ; relevés en jeu avec `degats` ; passage à la 3.7 ;
      classement soutenu (postures) dans `classes --optimize` ; étalonnage contre le boss lui-même (mini-combat) ;
      invocations, glyphes, pièges et rampes ; adds de la salle depuis les cartes ; quelques combats simulés de
      contrôle par boss pour confronter les classements.
