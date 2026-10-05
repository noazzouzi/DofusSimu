# Roadmap — checkpoints

Chaque checkpoint est commité et poussé dans un état utilisable.

- [x] **CP0 — Squelette** : TypeScript/Vite/Vitest, géométrie de la grille Dofus (560 cellules), page web minimale.
- [x] **CP1 — Données & recherche** : extraction DofusDB (19 classes × 44 sorts, 3 826 équipements, 521 panoplies,
      5 135 monstres, 187 donjons, 759 cartes de salles), formules DoMath + vecteurs de test, règles de combat,
      catalogue des 212 effets, grammaires zones/masques/déclencheurs, dossier Vortex, IA des monstres,
      équipements/forgemagie, analyse des 19 classes (`docs/research/`).
- [x] **CP2 — Calculateur** : agrégation stuff → caractéristiques (panoplies, exos, conditions), calcul de dégâts
      DoMath exact (0 écart sur 300 000 entrées aléatoires), LdV exacte du client, zones/masques/critères complets.
      *(La page web « calculateur » viendra avec l'interface d'équipe.)*
- [x] **CP3 — Moteur de combat + replays animés** : état de combat, PA/PM, ligne de vue, déplacements & tacle,
      4 familles d'effets (212 effectId), déclencheurs, invocations, glyphes/pièges ; 856 sorts testés sans
      exception (`docs/engine-coverage.md`) ; visualiseur animé (démo synthétique — les vrais combats arrivent au CP4).
- [~] **CP4 — IA & Vortex** : IA des monstres (profils officiels + Vortex en 2 phases), IA de groupe (commandant,
      recherche de tour fast/standard/deep, rollouts, 8 tactiques créatives), scénario Vortex (vagues, horloge de
      l'Auroraire, corruption) et planificateur d'heures ; premier combat complet joué et animé
      (`web/public/replays/`). **En cours** : réglage itératif pour gagner le Vortex, performances.
- [~] **CP5 — Optimiseurs** (implémentés, campagnes à relancer avec l'IA réglée) : stuff optimal par rôle/combat (exos inclus), composition d'équipe par simulation
      massive (Monte-Carlo), rapport Vortex : meilleure équipe, stuffs, sorts, déroulé du combat.
