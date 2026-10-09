# Reine des Voleurs — v2 (INSTANTANÉ, TRAVAIL EN COURS)

Instantané du 2026-10-09 d'une recherche encore en cours. Rien ici n'est vérifié : ne pas s'en servir en jeu.

Contexte : le joueur a confirmé en jeu la règle d'apparition des Bonbombes : **en haut** (« la 2e case », a priori
deux cases plus haut), sinon **en haut à droite**. La formation de `docs/strategies/reine-des-voleurs/README.md`
supposait une apparition nord-est en ligne : elle n'est **plus valable**.

- `search/` : recherche d'une nouvelle formation avec la règle confirmée. Variantes couvertes : distance 2 ou 4 ;
  repli nord-est ; 2 moments d'explosion ; 24 ordres de jeu. Scripts et sorties partielles.
- `damage/` : dégâts de chaque sort du Crâ (les deux variantes) avec les caractéristiques réelles du joueur, contre
  chaque monstre de vague et la Reine. Rotations par tour et utilitaires (Pesanteur, Flèche de Recul, balises).

Une vérification indépendante des formations, la stratégie complète et la relecture « joueur » viendront ensuite.
Les scripts peuvent contenir des chemins absolus de la session d'origine.
