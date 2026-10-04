# Roadmap — checkpoints

Chaque checkpoint est commité et poussé dans un état utilisable.

- [x] **CP0 — Squelette** : TypeScript/Vite/Vitest, géométrie de la grille Dofus (560 cellules), page web minimale.
- [x] **CP1 — Données & recherche** : extraction DofusDB (19 classes × 44 sorts, 3 826 équipements, 521 panoplies,
      5 135 monstres, 187 donjons, 759 cartes de salles), formules DoMath + vecteurs de test, règles de combat,
      catalogue des 212 effets, grammaires zones/masques/déclencheurs, dossier Vortex, IA des monstres,
      équipements/forgemagie, analyse des 19 classes (`docs/research/`).
- [ ] **CP2 — Calculateur** : agrégation stuff → caractéristiques (panoplies, exos), calcul de dégâts exact
      validé par des vecteurs de test DoMath, page « calculateur ».
- [ ] **CP3 — Moteur de combat + replays animés** : état de combat, PA/PM, ligne de vue, déplacements & tacle,
      interprétation des effets de sorts, tours/initiative, journal d'événements rejoué en animation.
- [ ] **CP4 — IA & Vortex** : IA des monstres (génériques + Vortex), IA de groupe (recherche de tour), scénario de
      vagues de l'Œil de Vortex jouable et animé.
- [ ] **CP5 — Optimiseurs** : stuff optimal par rôle/combat (exos inclus), composition d'équipe par simulation
      massive (Monte-Carlo), rapport Vortex : meilleure équipe, stuffs, sorts, déroulé du combat.
