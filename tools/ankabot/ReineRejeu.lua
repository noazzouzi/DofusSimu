--[[
  ReineRejeu.lua — REJEU D'UN COMBAT ENREGISTRÉ, donjon de la Reine des Voleurs, POUR TOUT LE GROUPE.
  AnkaBot PC, Dofus 3. FICHIER GÉNÉRÉ par tools/fightlog/scenario.ts (modèle : tools/fightlog/modele-rejeu.lua) :
  les scénarios ci-dessous viennent de combats joués à la main et enregistrés par tools/ankabot/journal-combats.lua,
  reconstitués paquet par paquet et vérifiés contre les synchronisations du serveur. Pour en ajouter un, régénérer
  plutôt qu'éditer à la main.

  Ce qu'il fait :
    1. PLACEMENT (fightManagementPosition) : reconnaît le placement des monstres (cases de départ = signature du
       scénario), puis met CHAQUE Crâ sur SA case enregistrée — d'abord par le paquet de placement (PLACEMENT.paquet,
       le procédé éprouvé dans IA_Rejeu6), sinon par fightAction:chooseCell. Vérifie la case obtenue et réessaie (un
       coéquipier peut occuper la case un instant ; deux Crâs qui veulent la case l'un de l'autre se débloquent en
       passant par une case libre).
    2. COMBAT (fightManagement, à chaque tour) : rejoue le n-ième tour enregistré du Crâ — déplacements et sorts dans
       l'ordre, par les méthodes d'AnkaBot (fightAction:moveToWardCell, canCastSpellOnCell, castSpellOnCell) — en
       comparant à chaque étape avec le combat enregistré (case de départ, case d'arrivée, refus de sort), et écrit
       tout dans un journal par personnage.
    3. BRANCHES : un même tour peut avoir plusieurs branches, une par combat enregistré où le plateau différait au
       début du tour (les monstres ne jouent pas toujours pareil : dégâts aléatoires, choix de l'IA). Au début de chaque
       tour, le script relève le plateau (monstres, bombes, coéquipiers ; un monstre invisible n'est pas comparé), le
       compare à celui de chaque branche, joue la branche qui correspond et note les écarts dans le journal.
       Aucune ne correspond : SI_AUCUNE_BRANCHE. Pour ajouter une branche : rejouer ce placement à la main avec le
       journal AnkaBot (tools/ankabot/journal-combats.lua), puis régénérer avec les deux combats sous le même nom :
         npx tsx tools/fightlog/scenario.ts --source "Placement 2=<combat 1>.jsonl" --source "Placement 2=<combat 2>.jsonl"
    4. Au-delà du plan (le combat enregistré s'arrête là), ou sans scénario reconnu : APRES_LE_PLAN / SANS_SCENARIO.
    5. MODE AVANCÉ (script de combat ReineCombat.lua, tools/fightlog/combat.ts, qui inclut aussi le journal et l'IA du
       serveur de plans) : le rejeu ne sert qu'à tuer la Reine. Dès qu'elle est morte (APRES_LA_REINE), au-delà du
       combat enregistré ou sans scénario reconnu, le tour est joué par l'IA du serveur (notre stratégie), plus par un
       rejeu. Dans ReineRejeu.lua seul (pas d'IA incluse), le rejeu continue après la mort de la Reine et « avance »
       revient à passer le tour.

  Installation (groupe AnkaBot : un chef, des mules) :
    - charger CE script sur le chef (Lowkey-Jealous) : AnkaBot le charge aussi sur les mules, chaque personnage
      exécute donc ce même fichier, pour LUI ;
    - configuration de combat de chaque compte : IA avancée « dans le même script » (fightManagement est ici, avec
      accès à developer pour le paquet de placement) ;
    - lancer le script dans la salle de la Reine ; engager le combat à la main (ou LANCER_LE_COMBAT = true).

  Identification : character:name() (le nom), avec repli sur l'identifiant de personnage (fightCharacter:getId()).
  Tour : compté par le script (n-ième appel de fightManagement depuis le placement) — fightAction:getCurrentTurn()
  prend parfois un tour d'avance (relevé le 2026-10-10 : manche 10 lue « 11 ») et ne sert que de contrôle.

  Garde-fous repris d'IA_Rejeu6 : jamais de tostring sur un message Protobuf ; tout appel d'AnkaBot sous pcall ; un
  sort n'est demandé que s'il figure au plan du personnage (il l'a lancé, il le possède : un sort non possédé fait
  lever dans canCastSpellOnCell une exception .NET que pcall ne rattrape pas) ; « code 0 » = LANÇABLE ; sous Acuité
  Absolue, canCastSpellOnCell répond LIGNE_DE_VUE à tort : on tente quand même.
--]]

-- ───────────────────────────── réglages ─────────────────────────────

-- Paramètre AnkaBot : la Reine des Voleurs est un combat À VAGUES (de nouveaux monstres arrivent en cours de combat) ;
-- sans lui, AnkaBot peut croire le combat fini quand la première vague tombe.
IS_WAVE_FIGHT = true

-- "cible" : un sort lancé sur un combattant dans le combat enregistré le suit là où il est maintenant (la Reine ne
--           revient pas toujours sur la même case) : monstre de même espèce resté sur la case enregistrée, sinon le même
--           monstre (son id ; pas pour les bombes, invocations renumérotées), sinon le plus proche de la case
--           enregistrée ; allié par son id. Un sort lancé sur une case VIDE (zone, poussée…) garde sa case.
-- "case"  : toujours la case enregistrée.
VISER = "cible"
-- Premier écart (sort refusé, déplacement raté) : true = le reste du tour est abandonné ; false = on continue.
STRICT = false
-- Tour au-delà du combat enregistré, ou combat sans scénario reconnu : "avance" (mode avancé : IA du serveur de plans,
-- si le script l'inclut — ReineCombat.lua —, sinon le tour est passé), "passer" (ne rien faire) ou "ia" (IA basique
-- d'AnkaBot avec la configuration de sorts du compte, fightBasic:playTurn).
APRES_LE_PLAN = "avance"
SANS_SCENARIO = "avance"
-- Reine morte : "avance" (mode avancé pour le reste du combat) ou "rejeu" (continuer le combat enregistré).
APRES_LA_REINE = "avance"
-- Abandon du combat, au début du tour de chaque Crâ (consignes du joueur, 2026-10-11) : un Crâ mort, ou la Reine au
-- contact d'un Crâ, et le combat est perdu ; inutile de continuer.
ABANDON_SI_CRA_MORT = true
ABANDON_SI_REINE_AU_CONTACT = true
-- AnkaBot PC n'a pas character:giveUpFight() (combat du 2026-10-11 à 11:23) : message « quitter le combat » du jeu
-- (GameContextQuitMessage, sans champ) envoyé par le script. Nom obfusqué À RELEVER dans D3ProtocolSniffer en
-- abandonnant un combat à la main (comme « jxu » pour le placement) ; nil : abandon à faire à la main.
ABANDON_PAQUET = nil
-- Placement : paquet de demande de placement (noms obfusqués : À RELEVER après une rotation d'Ankama, par exemple dans
-- le renifleur D3ProtocolSniffer d'AnkaBot en se plaçant à la main), sinon fightAction:chooseCell.
PLACEMENT = {
  paquet = true,          -- false : fightAction:chooseCell seulement
  nom = "jxu",            -- demande de placement (relevé dans IA_Rejeu6, août 2026)
  case = "fwkr",          -- champ : case visée
  combattant = "fwku",    -- champ : identifiant du combattant
  essais = 8,             -- demandes au plus
  attente = 700,          -- ms entre une demande et la vérification
}
-- Engager le combat soi-même (map:fight()) quand le script est lancé dans la salle ; false : à la main.
LANCER_LE_COMBAT = false
DELAI_ENTRE_ACTIONS = 0   -- ms entre deux actions d'un tour (0 : aucun)
-- Après un sort, laisser à AnkaBot le temps de recevoir ses effets (PA, portée de Tirs Éloignés…) avant de vérifier le
-- suivant : sans ça, canCastSpellOnCell juge avec l'état d'avant (2026-10-10 : quatre « TROP_LOIN » de suite juste
-- après Tirs Éloignés, depuis la case même d'où ils étaient partis dans le combat enregistré).
DELAI_APRES_SORT = 350    -- ms
-- Sort refusé par canCastSpellOnCell alors que le Crâ est sur la case d'où il l'a lancé dans le combat enregistré, sur
-- la même cible (case enregistrée ou monstre suivi) : on attend un peu, on revérifie, puis on le lance quand même (le
-- serveur tranche ; un refus ne coûte rien). Seulement pour les refus de portée et de ligne de vue.
-- TROP_PRÈS aussi : au tour qui suit Tirs Puissants, le serveur du jeu ôte 3 de portée minimale à chaque sort (effet
-- 295, 2026-10-10), ce qu'AnkaBot ne compte pas.
FORCER_SI_ENREGISTRE = true
CODES_FORCABLES = { [5] = true, [6] = true, [8] = true, [16] = true }   -- TROP_LOIN, TROP_PRÈS, LIGNE_DE_VUE, HORS_PORTÉE
-- La case d'AnkaBot se met parfois à jour juste après le retour de moveToWardCell (2026-10-10 : « bloqué en 381 avant
-- le coin 381 ») : on lui laisse jusqu'à ce délai avant de conclure qu'un déplacement s'est arrêté en route.
ATTENTE_POSITION = 600    -- ms
JOURNAL_FICHIER = true    -- journal par personnage et par combat, à côté du script (rejeu_<personnage>_<date>.log)
-- Cartes où le script attend (move) : la salle de la Reine et la carte du combat, en plus de la carte courante — un script
-- chargé pendant un changement de carte (map:currentMapId() = 0) n'a pas de carte courante.
CARTES = { "137101312", "137101316" }
-- BRANCHES. Un même tour peut avoir plusieurs branches : une par combat enregistré où le plateau (monstres, bombes,
-- coéquipiers) différait au début du tour — les monstres ne jouent pas toujours pareil (dégâts aléatoires, IA). Au
-- début de chaque tour, le script compare le plateau du jeu à celui de chaque branche et joue la plus proche.
TOLERANCE_PLATEAU = 0     -- écarts admis (combattant absent de sa case enregistrée) pour qu'une branche corresponde
-- Aucune branche ne correspond : "meilleure" (jouer la plus proche quand même), "main" (arrêter le script : le joueur
-- finit le combat à la main), "ia" (IA basique d'AnkaBot) ou "passer".
SI_AUCUNE_BRANCHE = "meilleure"

-- Scénarios générés le 2026-10-11 09:35:29 par tools/fightlog/scenario.ts (Placement 2 : 1 combat(s) ; Placement 3 : 1 combat(s)).
local SCENARIOS = {
  {
    nom = "Placement 2",
    -- Combats enregistrés dont viennent les branches (n° de source).
    sources = {
      [1] = "2026-10-10/session-21-27-31.jsonl (flux de Lowkey-Jealous) — 12 manches ; 234/234 vérifications justes contre les synchronisations du serveur",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3726, cellule = 133 },  -- Reine des Voleurs
      { espece = 3746, cellule = 135 },  -- Mâchassin
      { espece = 3747, cellule = 178 },  -- Terristocrate
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de départ de chaque Crâ (placement imposé), et son identifiant de personnage.
    cases = {
      ["Kemist-Skyler"] = 351,
      ["Lowkey-Jealous"] = 353,
      ["Lamouit"] = 354,
      ["Java-Springboot"] = 327,
    },
    ids = {
      ["Kemist-Skyler"] = 900266590501,
      ["Lowkey-Jealous"] = 900264689957,
      ["Lamouit"] = 900264624421,
      ["Java-Springboot"] = 900265148709,
    },
    -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : une ou plusieurs branches, chacune avec le plateau
    -- relevé au début du tour dans son combat (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible alors, case
    -- non comparée). Le script joue la branche dont le plateau correspond à celui du jeu.
    plans = {
      ["Kemist-Skyler"] = {
        [1] = {
          { source = 1, manche = 1, depart = 351, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 326 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3726, c = 234 }, { e = 3746, c = 203 }, { e = 3747, c = 204 }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 248 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@326 · Bonbombe@328 · Bonbombe@355 · Reine des Voleurs@234 · Mâchassin@203 · Terristocrate@204 · Doublure@193(invisible) · Doublure@248
            actions = {
              { type = "deplacer", cellule = 366, chemin = { 351, 366 }, etapes = { 366 } },
              { type = "sort", sort = 32466, cellule = 366, depuis = 366, cible = "soi" },  -- Tirs Puissants
              { type = "deplacer", cellule = 352, chemin = { 366, 352 }, etapes = { 352 } },
              { type = "sort", sort = 32454, cellule = 217, depuis = 352, cible = "case" },  -- Œil pour Œil
              { type = "sort", sort = 32453, cellule = 217, depuis = 352, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 217, depuis = 352, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32439, cellule = 231, depuis = 352, cible = "case" },  -- Flèche Ralentissante
              { type = "deplacer", cellule = 408, chemin = { 352, 366, 380, 394, 408 }, etapes = { 366, 380, 394, 408 } },
            } },
        },
        [2] = {
          { source = 1, manche = 2, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 324 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3725, c = 382 }, { e = 3726, c = 150 }, { e = 3746, c = 178 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@324 · Bonbombe@355 · Bonbombe@356 · Bonbombe@382 · Reine des Voleurs@150 · Mâchassin@178
            actions = {
              { type = "deplacer", cellule = 379, chemin = { 408, 394, 379 }, etapes = { 379 } },
              { type = "sort", sort = 32465, cellule = 379, depuis = 379, cible = "soi" },  -- Tirs Éloignés
              { type = "deplacer", cellule = 366, chemin = { 379, 366 }, etapes = { 366 } },
              { type = "sort", sort = 32437, cellule = 163, depuis = 366, cible = "case" },  -- Œil de Taupe
              { type = "sort", sort = 32445, cellule = 163, depuis = 366, cible = "case" },  -- Flèche Explosive
              { type = "sort", sort = 32445, cellule = 163, depuis = 366, cible = "case" },  -- Flèche Explosive
              { type = "deplacer", cellule = 408, chemin = { 366, 380, 394, 408 }, etapes = { 380, 394, 408 } },
            } },
        },
        [3] = {
          { source = 1, manche = 3, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3726, c = 190 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Reine des Voleurs@190
            actions = {
              { type = "deplacer", cellule = 379, chemin = { 408, 394, 379 }, etapes = { 379 } },
              { type = "sort", sort = 32466, cellule = 379, depuis = 379, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 190, depuis = 379, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "deplacer", cellule = 366, chemin = { 379, 366 }, etapes = { 366 } },
              { type = "sort", sort = 32446, cellule = 190, depuis = 366, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Dévorante → Reine des Voleurs
              { type = "sort", sort = 32429, cellule = 190, depuis = 366, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Perforante → Reine des Voleurs
              { type = "deplacer", cellule = 408, chemin = { 366, 380, 394, 408 }, etapes = { 380, 394, 408 } },
            } },
        },
        [4] = {
          { source = 1, manche = 4, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3725, c = 382 }, { e = 3748, c = 178 }, { e = 3748, c = 194 }, { e = 3748, c = 208, inv = true }, { e = 3748, c = 247 }, { e = 3749, c = 135 }, { e = 3750, c = 133 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@355 · Bonbombe@356 · Bonbombe@382 · Doublure@178 · Doublure@194 · Doublure@208(invisible) · Doublure@247 · Bourôliste@135 · Magouille@133
            actions = {
              { type = "sort", sort = 32469, cellule = 408, depuis = 408, cible = "soi" },  -- Acuité Absolue
              { type = "sort", sort = 32465, cellule = 408, depuis = 408, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32460, cellule = 247, depuis = 408, cible = "ennemi", espece = 3748, id = -37 },  -- Flèche du Jugement → Doublure
              { type = "deplacer", cellule = 423, chemin = { 408, 423 }, etapes = { 423 } },
              { type = "sort", sort = 32429, cellule = 247, depuis = 423, cible = "ennemi", espece = 3748, id = -37 },  -- Flèche Perforante → Doublure
              { type = "deplacer", cellule = 408, chemin = { 423, 408 }, etapes = { 408 } },
            } },
        },
        [5] = {
          { source = 1, manche = 5, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 382 }, { e = 3725, c = 383 }, { e = 3749, c = 204 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@382 · Bonbombe@383 · Bourôliste@204 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 394, chemin = { 408, 394 }, etapes = { 394 } },
              { type = "sort", sort = 32466, cellule = 394, depuis = 394, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 203, depuis = 394, cible = "ennemi", espece = 3750, id = -33 },  -- Flèche du Jugement → Magouille
              { type = "deplacer", cellule = 366, chemin = { 394, 380, 366 }, etapes = { 380, 366 } },
              { type = "sort", sort = 32453, cellule = 217, depuis = 366, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 217, depuis = 366, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 217, depuis = 366, cible = "case" },  -- Flèche d'Abolition
              { type = "deplacer", cellule = 408, chemin = { 366, 380, 394, 408 }, etapes = { 380, 394, 408 } },
            } },
        },
        [6] = {
          { source = 1, manche = 6, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 410 }, { e = 3747, c = 208 }, { e = 3747, c = 261 }, { e = 3748, c = 135, inv = true }, { e = 3748, c = 175 }, { e = 3750, c = 162 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@410 · Terristocrate@208 · Terristocrate@261 · Doublure@135(invisible) · Doublure@175 · Magouille@162
            actions = {
              { type = "deplacer", cellule = 379, chemin = { 408, 394, 379 }, etapes = { 379 } },
              { type = "sort", sort = 32465, cellule = 379, depuis = 379, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32460, cellule = 162, depuis = 379, cible = "ennemi", espece = 3750, id = -45 },  -- Flèche du Jugement → Magouille
              { type = "deplacer", cellule = 365, chemin = { 379, 365 }, etapes = { 365 } },
              { type = "sort", sort = 32453, cellule = 162, depuis = 365, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32460, cellule = 175, depuis = 365, cible = "ennemi", espece = 3748, id = -49 },  -- Flèche du Jugement → Doublure
              { type = "deplacer", cellule = 408, chemin = { 365, 379, 394, 408 }, etapes = { 408 } },
            } },
        },
        [7] = {
          { source = 1, manche = 7, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3747, c = 248 }, { e = 3747, c = 288 }, { e = 3748, c = 135 }, { e = 3748, c = 258 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@409 · Terristocrate@248 · Terristocrate@288 · Doublure@135 · Doublure@258
            actions = {
              { type = "deplacer", cellule = 379, chemin = { 408, 394, 379 }, etapes = { 379 } },
              { type = "sort", sort = 32466, cellule = 379, depuis = 379, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 258, depuis = 379, cible = "ennemi", espece = 3748, id = -49 },  -- Flèche du Jugement → Doublure
              { type = "sort", sort = 32454, cellule = 258, depuis = 379, cible = "case" },  -- Œil pour Œil
              { type = "sort", sort = 32453, cellule = 258, depuis = 379, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 258, depuis = 379, cible = "case" },  -- Flèche d'Abolition
              { type = "deplacer", cellule = 408, chemin = { 379, 394, 408 }, etapes = { 408 } },
            } },
        },
        [8] = {
          { source = 1, manche = 8, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 437 }, { e = 3746, c = 208 }, { e = 3747, c = 261 }, { e = 3750, c = 189 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@437 · Mâchassin@208 · Terristocrate@261 · Magouille@189 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 379, chemin = { 408, 394, 379 }, etapes = { 379 } },
              { type = "sort", sort = 32465, cellule = 379, depuis = 379, cible = "soi" },  -- Tirs Éloignés
              { type = "deplacer", cellule = 365, chemin = { 379, 365 }, etapes = { 365 } },
              { type = "sort", sort = 32454, cellule = 203, depuis = 365, cible = "ennemi", espece = 3750, id = -58 },  -- Œil pour Œil → Magouille
              { type = "sort", sort = 32453, cellule = 203, depuis = 365, cible = "ennemi", espece = 3750, id = -58 },  -- Flèche d'Abolition → Magouille
              { type = "sort", sort = 32453, cellule = 203, depuis = 365, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32429, cellule = 203, depuis = 365, cible = "case" },  -- Flèche Perforante
              { type = "deplacer", cellule = 408, chemin = { 365, 379, 394, 408 }, etapes = { 408 } },
            } },
        },
        [9] = {
          { source = 1, manche = 9, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3725, c = 382 }, { e = 3746, c = 263 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@355 · Bonbombe@356 · Bonbombe@382 · Mâchassin@263
            actions = {
              { type = "deplacer", cellule = 452, chemin = { 408, 423, 437, 452 }, etapes = { 452 } },
              { type = "sort", sort = 32466, cellule = 452, depuis = 452, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 263, depuis = 452, cible = "ennemi", espece = 3746, id = -61 },  -- Flèche du Jugement → Mâchassin
              { type = "sort", sort = 32437, cellule = 290, depuis = 452, cible = "case" },  -- Œil de Taupe
              { type = "sort", sort = 32429, cellule = 263, depuis = 452, cible = "ennemi", espece = 3746, id = -61 },  -- Flèche Perforante → Mâchassin
              { type = "deplacer", cellule = 408, chemin = { 452, 437, 423, 408 }, etapes = { 408 } },
            } },
        },
        [10] = {
          { source = 1, manche = 10, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 382 }, { e = 3725, c = 412 }, { e = 3746, c = 208 }, { e = 3749, c = 203 }, { e = 3749, c = 217 }, { e = 3750, c = 133 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@382 · Bonbombe@412 · Mâchassin@208 · Bourôliste@203 · Bourôliste@217 · Magouille@133
            actions = {
              { type = "deplacer", cellule = 379, chemin = { 408, 394, 379 }, etapes = { 379 } },
              { type = "sort", sort = 32465, cellule = 379, depuis = 379, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32446, cellule = 203, depuis = 379, cible = "ennemi", espece = 3749, id = -72 },  -- Flèche Dévorante → Bourôliste
              { type = "sort", sort = 32446, cellule = 217, depuis = 379, cible = "ennemi", espece = 3749, id = -73 },  -- Flèche Dévorante → Bourôliste
              { type = "sort", sort = 32453, cellule = 217, depuis = 379, cible = "ennemi", espece = 3749, id = -73 },  -- Flèche d'Abolition → Bourôliste
              { type = "sort", sort = 32443, cellule = 217, depuis = 379, cible = "ennemi", espece = 3749, id = -73 },  -- Flèche de Barrage → Bourôliste
              { type = "deplacer", cellule = 408, chemin = { 379, 394, 408 }, etapes = { 408 } },
            } },
        },
        [11] = {
          { source = 1, manche = 11, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 410 }, { e = 3746, c = 235 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@410 · Mâchassin@235 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 365, chemin = { 408, 394, 379, 365 }, etapes = { 365 } },
              { type = "sort", sort = 32446, cellule = 203, depuis = 365, cible = "ennemi", espece = 3750, id = -71 },  -- Flèche Dévorante → Magouille
              { type = "sort", sort = 32453, cellule = 203, depuis = 365, cible = "ennemi", espece = 3750, id = -71 },  -- Flèche d'Abolition → Magouille
              { type = "sort", sort = 32426, cellule = 203, depuis = 365, cible = "ennemi", espece = 3750, id = -71 },  -- Flèche de Recul → Magouille
              { type = "sort", sort = 32429, cellule = 176, depuis = 365, cible = "ennemi", espece = 3750, id = -71 },  -- Flèche Perforante → Magouille
              { type = "deplacer", cellule = 408, chemin = { 365, 379, 394, 408 }, etapes = { 408 } },
            } },
        },
      },
      ["Lowkey-Jealous"] = {
        [1] = {
          { source = 1, manche = 1, depart = 353, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900266590501, c = 351 }, { e = 0, id = 900264624421, c = 354 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3726, c = 234 }, { e = 3746, c = 149 }, { e = 3747, c = 204 }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 248 } },
            -- Java-Springboot@327 · Kemist-Skyler@351 · Lamouit@354 · Bonbombe@328 · Bonbombe@355 · Reine des Voleurs@234 · Mâchassin@149 · Terristocrate@204 · Doublure@193(invisible) · Doublure@248
            actions = {
              { type = "deplacer", cellule = 339, chemin = { 353, 339 }, etapes = { 339 } },
              { type = "sort", sort = 32466, cellule = 339, depuis = 339, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 204, depuis = 339, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche du Jugement → Terristocrate
              { type = "sort", sort = 32448, cellule = 204, depuis = 339, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche Tyrannique → Terristocrate
              { type = "sort", sort = 32437, cellule = 204, depuis = 339, cible = "ennemi", espece = 3747, id = -15 },  -- Œil de Taupe → Terristocrate
              { type = "deplacer", cellule = 381, chemin = { 339, 353, 367, 381 }, etapes = { 353, 367, 381 } },
            } },
        },
        [2] = {
          { source = 1, manche = 2, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 324 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3726, c = 150 }, { e = 3746, c = 136 }, { e = 3747, c = 178 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@324 · Bonbombe@355 · Bonbombe@356 · Reine des Voleurs@150 · Mâchassin@136 · Terristocrate@178
            actions = {
              { type = "deplacer", cellule = 352, chemin = { 381, 367, 352 }, etapes = { 352 } },
              { type = "sort", sort = 32465, cellule = 352, depuis = 352, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32437, cellule = 150, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Œil de Taupe → Reine des Voleurs
              { type = "sort", sort = 32453, cellule = 150, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche d'Abolition → Reine des Voleurs
              { type = "sort", sort = 32453, cellule = 150, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche d'Abolition → Reine des Voleurs
              { type = "sort", sort = 32453, cellule = 150, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche d'Abolition → Reine des Voleurs
              { type = "sort", sort = 32427, cellule = 150, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Cinglante → Reine des Voleurs
              { type = "deplacer", cellule = 381, chemin = { 352, 367, 381 }, etapes = { 381 } },
            } },
        },
        [3] = {
          { source = 1, manche = 3, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3726, c = 231 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Reine des Voleurs@231
            actions = {
              { type = "deplacer", cellule = 352, chemin = { 381, 367, 352 }, etapes = { 352 } },
              { type = "sort", sort = 32466, cellule = 352, depuis = 352, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 231, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32454, cellule = 231, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Œil pour Œil → Reine des Voleurs
              { type = "sort", sort = 32429, cellule = 231, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Perforante → Reine des Voleurs
              { type = "deplacer", cellule = 381, chemin = { 352, 367, 381 }, etapes = { 381 } },
            } },
        },
        [4] = {
          { source = 1, manche = 4, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3726, c = 163 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@355 · Bonbombe@356 · Reine des Voleurs@163
            actions = {
              { type = "deplacer", cellule = 339, chemin = { 381, 367, 353, 339 }, etapes = { 367, 353, 339 } },
              { type = "sort", sort = 32465, cellule = 339, depuis = 339, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32460, cellule = 163, depuis = 339, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32429, cellule = 177, depuis = 339, cible = "case" },  -- Flèche Perforante
              { type = "sort", sort = 32437, cellule = 163, depuis = 339, cible = "case" },  -- Œil de Taupe
              { type = "deplacer", cellule = 381, chemin = { 339, 353, 367, 381 }, etapes = { 353, 367, 381 } },
            } },
        },
        [5] = {
          { source = 1, manche = 5, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 383 }, { e = 3749, c = 204 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@383 · Bourôliste@204 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 352, chemin = { 381, 367, 352 }, etapes = { 352 } },
              { type = "sort", sort = 32466, cellule = 352, depuis = 352, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32457, cellule = 204, depuis = 352, cible = "ennemi", espece = 3749, id = -34 },  -- Flèche Massacrante → Bourôliste
              { type = "sort", sort = 32457, cellule = 204, depuis = 352, cible = "ennemi", espece = 3749, id = -34 },  -- Flèche Massacrante → Bourôliste
              { type = "sort", sort = 32454, cellule = 217, depuis = 352, cible = "case" },  -- Œil pour Œil
              { type = "deplacer", cellule = 381, chemin = { 352, 367, 381 }, etapes = { 381 } },
            } },
        },
        [6] = {
          { source = 1, manche = 6, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3747, c = 178 }, { e = 3747, c = 208 }, { e = 3748, c = 135, inv = true }, { e = 3748, c = 175 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@409 · Terristocrate@178 · Terristocrate@208 · Doublure@135(invisible) · Doublure@175 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 352, chemin = { 381, 367, 352 }, etapes = { 352 } },
              { type = "sort", sort = 32460, cellule = 203, depuis = 352, cible = "ennemi", espece = 3750, id = -45 },  -- Flèche du Jugement → Magouille
              { type = "deplacer", cellule = 338, chemin = { 352, 338 }, etapes = { 338 } },
              { type = "sort", sort = 32448, cellule = 203, depuis = 338, cible = "ennemi", espece = 3750, id = -45 },  -- Flèche Tyrannique → Magouille
              { type = "sort", sort = 32429, cellule = 203, depuis = 338, cible = "ennemi", espece = 3750, id = -45 },  -- Flèche Perforante → Magouille
              { type = "deplacer", cellule = 381, chemin = { 338, 352, 367, 381 }, etapes = { 381 } },
            } },
        },
        [7] = {
          { source = 1, manche = 7, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 409 }, { e = 3725, c = 410 }, { e = 3747, c = 234 }, { e = 3747, c = 248 }, { e = 3748, c = 135 }, { e = 3748, c = 258 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@409 · Bonbombe@410 · Terristocrate@234 · Terristocrate@248 · Doublure@135 · Doublure@258
            actions = {
              { type = "deplacer", cellule = 367, chemin = { 381, 367 }, etapes = { 367 } },
              { type = "sort", sort = 32460, cellule = 258, depuis = 367, cible = "ennemi", espece = 3748, id = -49 },  -- Flèche du Jugement → Doublure
              { type = "sort", sort = 32454, cellule = 258, depuis = 367, cible = "ennemi", espece = 3748, id = -49 },  -- Œil pour Œil → Doublure
              { type = "sort", sort = 32453, cellule = 258, depuis = 367, cible = "ennemi", espece = 3748, id = -49 },  -- Flèche d'Abolition → Doublure
              { type = "sort", sort = 32453, cellule = 258, depuis = 367, cible = "ennemi", espece = 3748, id = -49 },  -- Flèche d'Abolition → Doublure
              { type = "deplacer", cellule = 381, chemin = { 367, 381 }, etapes = { 381 } },
            } },
        },
        [8] = {
          { source = 1, manche = 8, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 437 }, { e = 3746, c = 208 }, { e = 3747, c = 178 }, { e = 3750, c = 189 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@437 · Mâchassin@208 · Terristocrate@178 · Magouille@189 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 352, chemin = { 381, 367, 352 }, etapes = { 352 } },
              { type = "sort", sort = 32466, cellule = 352, depuis = 352, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 203, depuis = 352, cible = "ennemi", espece = 3750, id = -58 },  -- Flèche du Jugement → Magouille
              { type = "deplacer", cellule = 338, chemin = { 352, 338 }, etapes = { 338 } },
              { type = "sort", sort = 32454, cellule = 203, depuis = 338, cible = "ennemi", espece = 3750, id = -58 },  -- Œil pour Œil → Magouille
              { type = "sort", sort = 32453, cellule = 203, depuis = 338, cible = "ennemi", espece = 3750, id = -58 },  -- Flèche d'Abolition → Magouille
              { type = "sort", sort = 32453, cellule = 203, depuis = 338, cible = "ennemi", espece = 3750, id = -58 },  -- Flèche d'Abolition → Magouille
              { type = "deplacer", cellule = 381, chemin = { 338, 352, 367, 381 }, etapes = { 381 } },
            } },
        },
        [9] = {
          { source = 1, manche = 9, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3746, c = 263 }, { e = 3747, c = 220 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@355 · Bonbombe@356 · Mâchassin@263 · Terristocrate@220
            actions = {
              { type = "sort", sort = 32469, cellule = 381, depuis = 381, cible = "soi" },  -- Acuité Absolue
              { type = "sort", sort = 32465, cellule = 381, depuis = 381, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32460, cellule = 220, depuis = 381, cible = "ennemi", espece = 3747, id = -60 },  -- Flèche du Jugement → Terristocrate
              { type = "deplacer", cellule = 396, chemin = { 381, 396 }, etapes = { 396 } },
              { type = "sort", sort = 32429, cellule = 220, depuis = 396, cible = "ennemi", espece = 3747, id = -60 },  -- Flèche Perforante → Terristocrate
              { type = "deplacer", cellule = 381, chemin = { 396, 381 }, etapes = { 381 } },
            } },
        },
        [10] = {
          { source = 1, manche = 10, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 412 }, { e = 3746, c = 208 }, { e = 3749, c = 178 }, { e = 3749, c = 203 }, { e = 3750, c = 133 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@412 · Mâchassin@208 · Bourôliste@178 · Bourôliste@203 · Magouille@133
            actions = {
              { type = "deplacer", cellule = 352, chemin = { 381, 367, 352 }, etapes = { 352 } },
              { type = "sort", sort = 32466, cellule = 352, depuis = 352, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 203, depuis = 352, cible = "ennemi", espece = 3749, id = -72 },  -- Flèche du Jugement → Bourôliste
              { type = "sort", sort = 32446, cellule = 203, depuis = 352, cible = "ennemi", espece = 3749, id = -72 },  -- Flèche Dévorante → Bourôliste
              { type = "sort", sort = 32453, cellule = 203, depuis = 352, cible = "ennemi", espece = 3749, id = -72 },  -- Flèche d'Abolition → Bourôliste
              { type = "sort", sort = 32453, cellule = 203, depuis = 352, cible = "ennemi", espece = 3749, id = -72 },  -- Flèche d'Abolition → Bourôliste
              { type = "deplacer", cellule = 381, chemin = { 352, 367, 381 }, etapes = { 381 } },
            } },
        },
        [11] = {
          { source = 1, manche = 11, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3746, c = 235 }, { e = 3749, c = 204 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@409 · Mâchassin@235 · Bourôliste@204 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 352, chemin = { 381, 367, 352 }, etapes = { 352 } },
              { type = "sort", sort = 32465, cellule = 352, depuis = 352, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32454, cellule = 217, depuis = 352, cible = "case" },  -- Œil pour Œil
              { type = "sort", sort = 32453, cellule = 217, depuis = 352, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 217, depuis = 352, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 217, depuis = 352, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32427, cellule = 203, depuis = 352, cible = "ennemi", espece = 3750, id = -71 },  -- Flèche Cinglante → Magouille
              { type = "deplacer", cellule = 381, chemin = { 352, 367, 381 }, etapes = { 381 } },
            } },
        },
      },
      ["Lamouit"] = {
        [1] = {
          { source = 1, manche = 1, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900266590501, c = 351 }, { e = 0, id = 900264689957, c = 353 }, { e = 3725, c = 328 }, { e = 3726, c = 234 }, { e = 3746, c = 149 }, { e = 3747, c = 178 }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 275 } },
            -- Java-Springboot@327 · Kemist-Skyler@351 · Lowkey-Jealous@353 · Bonbombe@328 · Reine des Voleurs@234 · Mâchassin@149 · Terristocrate@178 · Doublure@193(invisible) · Doublure@275
            actions = {
              { type = "deplacer", cellule = 383, chemin = { 354, 369, 383 }, etapes = { 383 } },
              { type = "sort", sort = 32466, cellule = 383, depuis = 383, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 275, depuis = 383, cible = "ennemi", espece = 3748, id = -17 },  -- Flèche du Jugement → Doublure
              { type = "sort", sort = 32426, cellule = 275, depuis = 383, cible = "ennemi", espece = 3748, id = -17 },  -- Flèche de Recul → Doublure
              { type = "sort", sort = 32453, cellule = 248, depuis = 383, cible = "ennemi", espece = 3748, id = -17 },  -- Flèche d'Abolition → Doublure
              { type = "sort", sort = 32453, cellule = 248, depuis = 383, cible = "ennemi", espece = 3748, id = -17 },  -- Flèche d'Abolition → Doublure
              { type = "deplacer", cellule = 354, chemin = { 383, 369, 354 }, etapes = { 354 } },
            } },
        },
        [2] = {
          { source = 1, manche = 2, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 324 }, { e = 3725, c = 356 }, { e = 3726, c = 190 }, { e = 3746, c = 177 }, { e = 3747, c = 163 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@324 · Bonbombe@356 · Reine des Voleurs@190 · Mâchassin@177 · Terristocrate@163
            actions = {
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "sort", sort = 32448, cellule = 190, depuis = 325, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Tyrannique → Reine des Voleurs
              { type = "deplacer", cellule = 312, chemin = { 325, 312 }, etapes = { 312 } },
              { type = "sort", sort = 32450, cellule = 190, depuis = 312, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Fulminante → Reine des Voleurs
              { type = "sort", sort = 32429, cellule = 190, depuis = 312, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Perforante → Reine des Voleurs
              { type = "deplacer", cellule = 354, chemin = { 312, 326, 340, 354 }, etapes = { 326, 340, 354 } },
            } },
        },
        [3] = {
          { source = 1, manche = 3, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3726, c = 231 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Reine des Voleurs@231
            actions = {
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "sort", sort = 32466, cellule = 325, depuis = 325, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 231, depuis = 325, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32454, cellule = 231, depuis = 325, cible = "ennemi", espece = 3726, id = -13 },  -- Œil pour Œil → Reine des Voleurs
              { type = "sort", sort = 32448, cellule = 231, depuis = 325, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Tyrannique → Reine des Voleurs
              { type = "deplacer", cellule = 354, chemin = { 325, 340, 354 }, etapes = { 354 } },
            } },
        },
        [4] = {
          { source = 1, manche = 4, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 356 }, { e = 3726, c = 163 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@356 · Reine des Voleurs@163
            actions = {
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "deplacer", cellule = 312, chemin = { 325, 312 }, etapes = { 312 } },
              { type = "sort", sort = 32460, cellule = 163, depuis = 312, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32445, cellule = 190, depuis = 312, cible = "case" },  -- Flèche Explosive
              { type = "sort", sort = 32445, cellule = 190, depuis = 312, cible = "case" },  -- Flèche Explosive
              { type = "deplacer", cellule = 354, chemin = { 312, 326, 340, 354 }, etapes = { 326, 340, 354 } },
            } },
        },
        [5] = {
          { source = 1, manche = 5, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3748, c = 163 }, { e = 3748, c = 178 }, { e = 3748, c = 207 }, { e = 3748, c = 208, inv = true }, { e = 3749, c = 135 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@409 · Doublure@163 · Doublure@178 · Doublure@207 · Doublure@208(invisible) · Bourôliste@135 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "sort", sort = 32466, cellule = 325, depuis = 325, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32453, cellule = 163, depuis = 325, cible = "ennemi", espece = 3748, id = -38 },  -- Flèche d'Abolition → Doublure
              { type = "sort", sort = 32453, cellule = 163, depuis = 325, cible = "ennemi", espece = 3748, id = -38 },  -- Flèche d'Abolition → Doublure
              { type = "sort", sort = 32453, cellule = 163, depuis = 325, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32460, cellule = 203, depuis = 325, cible = "ennemi", espece = 3750, id = -33 },  -- Flèche du Jugement → Magouille
              { type = "deplacer", cellule = 354, chemin = { 325, 340, 354 }, etapes = { 354 } },
            } },
        },
        [6] = {
          { source = 1, manche = 6, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 382 }, { e = 3725, c = 383 }, { e = 3725, c = 409 }, { e = 3747, c = 178 }, { e = 3747, c = 208 }, { e = 3748, c = 122 }, { e = 3748, c = 135, inv = true }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@382 · Bonbombe@383 · Bonbombe@409 · Terristocrate@178 · Terristocrate@208 · Doublure@122 · Doublure@135(invisible) · Magouille@203
            actions = {
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "sort", sort = 32460, cellule = 203, depuis = 325, cible = "ennemi", espece = 3750, id = -45 },  -- Flèche du Jugement → Magouille
              { type = "deplacer", cellule = 311, chemin = { 325, 311 }, etapes = { 311 } },
              { type = "sort", sort = 32448, cellule = 203, depuis = 311, cible = "ennemi", espece = 3750, id = -45 },  -- Flèche Tyrannique → Magouille
              { type = "sort", sort = 32453, cellule = 203, depuis = 311, cible = "ennemi", espece = 3750, id = -45 },  -- Flèche d'Abolition → Magouille
              { type = "sort", sort = 32453, cellule = 203, depuis = 311, cible = "ennemi", espece = 3750, id = -45 },  -- Flèche d'Abolition → Magouille
              { type = "deplacer", cellule = 354, chemin = { 311, 325, 340, 354 }, etapes = { 354 } },
            } },
        },
        [7] = {
          { source = 1, manche = 7, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 409 }, { e = 3725, c = 410 }, { e = 3747, c = 234 }, { e = 3747, c = 248 }, { e = 3748, c = 135 }, { e = 3748, c = 175 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@409 · Bonbombe@410 · Terristocrate@234 · Terristocrate@248 · Doublure@135 · Doublure@175
            actions = {
              { type = "deplacer", cellule = 383, chemin = { 354, 369, 383 }, etapes = { 383 } },
              { type = "sort", sort = 32466, cellule = 383, depuis = 383, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32454, cellule = 248, depuis = 383, cible = "ennemi", espece = 3747, id = -48 },  -- Œil pour Œil → Terristocrate
              { type = "sort", sort = 32453, cellule = 248, depuis = 383, cible = "ennemi", espece = 3747, id = -48 },  -- Flèche d'Abolition → Terristocrate
              { type = "sort", sort = 32453, cellule = 248, depuis = 383, cible = "ennemi", espece = 3747, id = -48 },  -- Flèche d'Abolition → Terristocrate
              { type = "sort", sort = 32450, cellule = 248, depuis = 383, cible = "ennemi", espece = 3747, id = -48 },  -- Flèche Fulminante → Terristocrate
              { type = "deplacer", cellule = 354, chemin = { 383, 369, 354 }, etapes = { 354 } },
            } },
        },
        [8] = {
          { source = 1, manche = 8, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 437 }, { e = 3746, c = 208 }, { e = 3747, c = 178 }, { e = 3750, c = 135 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@437 · Mâchassin@208 · Terristocrate@178 · Magouille@135 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "sort", sort = 32460, cellule = 203, depuis = 325, cible = "ennemi", espece = 3750, id = -58 },  -- Flèche du Jugement → Magouille
              { type = "deplacer", cellule = 311, chemin = { 325, 311 }, etapes = { 311 } },
              { type = "sort", sort = 32448, cellule = 203, depuis = 311, cible = "ennemi", espece = 3750, id = -58 },  -- Flèche Tyrannique → Magouille
              { type = "sort", sort = 32453, cellule = 203, depuis = 311, cible = "ennemi", espece = 3750, id = -58 },  -- Flèche d'Abolition → Magouille
              { type = "sort", sort = 32453, cellule = 203, depuis = 311, cible = "ennemi", espece = 3750, id = -58 },  -- Flèche d'Abolition → Magouille
              { type = "deplacer", cellule = 354, chemin = { 311, 325, 340, 354 }, etapes = { 354 } },
            } },
        },
        [9] = {
          { source = 1, manche = 9, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 356 }, { e = 3746, c = 263 }, { e = 3747, c = 220 }, { e = 3750, c = 149 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@356 · Mâchassin@263 · Terristocrate@220 · Magouille@149
            actions = {
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "sort", sort = 32466, cellule = 325, depuis = 325, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 149, depuis = 325, cible = "ennemi", espece = 3750, id = -59 },  -- Flèche du Jugement → Magouille
              { type = "deplacer", cellule = 311, chemin = { 325, 311 }, etapes = { 311 } },
              { type = "sort", sort = 32453, cellule = 149, depuis = 311, cible = "ennemi", espece = 3750, id = -59 },  -- Flèche d'Abolition → Magouille
              { type = "sort", sort = 32453, cellule = 149, depuis = 311, cible = "ennemi", espece = 3750, id = -59 },  -- Flèche d'Abolition → Magouille
              { type = "sort", sort = 32426, cellule = 149, depuis = 311, cible = "ennemi", espece = 3750, id = -59 },  -- Flèche de Recul → Magouille
              { type = "deplacer", cellule = 354, chemin = { 311, 325, 340, 354 }, etapes = { 354 } },
            } },
        },
        [10] = {
          { source = 1, manche = 10, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3746, c = 276 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@409 · Mâchassin@276
            actions = {
              { type = "sort", sort = 32426, cellule = 383, depuis = 354, cible = "bombe", espece = 3725, id = -70 },  -- Flèche de Recul → Bonbombe
              { type = "deplacer", cellule = 383, chemin = { 354, 369, 383 }, etapes = { 383 } },
              { type = "sort", sort = 32460, cellule = 276, depuis = 383, cible = "ennemi", espece = 3746, id = -61 },  -- Flèche du Jugement → Mâchassin
              { type = "sort", sort = 32453, cellule = 290, depuis = 383, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 290, depuis = 383, cible = "case" },  -- Flèche d'Abolition
              { type = "deplacer", cellule = 354, chemin = { 383, 369, 354 }, etapes = { 354 } },
            } },
        },
        [11] = {
          { source = 1, manche = 11, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3725, c = 412 }, { e = 3746, c = 262 }, { e = 3749, c = 204 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@382 · Bonbombe@409 · Bonbombe@412 · Mâchassin@262 · Bourôliste@204 · Magouille@203
            actions = {
              { type = "deplacer", cellule = 383, chemin = { 354, 369, 383 }, etapes = { 383 } },
              { type = "sort", sort = 32428, cellule = 262, depuis = 383, cible = "ennemi", espece = 3746, id = -74 },  -- Flèche de Dispersion → Mâchassin
              { type = "sort", sort = 32460, cellule = 262, depuis = 383, cible = "ennemi", espece = 3746, id = -74 },  -- Flèche du Jugement → Mâchassin
              { type = "sort", sort = 32453, cellule = 262, depuis = 383, cible = "ennemi", espece = 3746, id = -74 },  -- Flèche d'Abolition → Mâchassin
              { type = "sort", sort = 32426, cellule = 262, depuis = 383, cible = "ennemi", espece = 3746, id = -74 },  -- Flèche de Recul → Mâchassin
              { type = "deplacer", cellule = 354, chemin = { 383, 369, 354 }, etapes = { 354 } },
            } },
        },
        [12] = {
          { source = 1, manche = 12, depart = 354, fin = -1,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 409 }, { e = 3725, c = 410 }, { e = 3750, c = 203 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@409 · Bonbombe@410 · Magouille@203
            actions = {
            } },
        },
      },
      ["Java-Springboot"] = {
        [1] = {
          { source = 1, manche = 1, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900266590501, c = 351 }, { e = 0, id = 900264689957, c = 353 }, { e = 0, id = 900264624421, c = 354 }, { e = 3726, c = 234 }, { e = 3746, c = 149 }, { e = 3747, c = 178 }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 194 } },
            -- Kemist-Skyler@351 · Lowkey-Jealous@353 · Lamouit@354 · Reine des Voleurs@234 · Mâchassin@149 · Terristocrate@178 · Doublure@193(invisible) · Doublure@194
            actions = {
              { type = "sort", sort = 32466, cellule = 327, depuis = 327, cible = "soi" },  -- Tirs Puissants
              { type = "deplacer", cellule = 356, chemin = { 327, 342, 356 }, etapes = { 356 } },
              { type = "sort", sort = 32460, cellule = 194, depuis = 356, cible = "ennemi", espece = 3748, id = -17 },  -- Flèche du Jugement → Doublure
              { type = "sort", sort = 32460, cellule = 234, depuis = 356, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32454, cellule = 234, depuis = 356, cible = "ennemi", espece = 3726, id = -13 },  -- Œil pour Œil → Reine des Voleurs
              { type = "deplacer", cellule = 327, chemin = { 356, 342, 327 }, etapes = { 327 } },
            } },
        },
        [2] = {
          { source = 1, manche = 2, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 324 }, { e = 3725, c = 326 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3726, c = 258 }, { e = 3746, c = 217 }, { e = 3747, c = 204 }, { e = 3748, c = 193 }, { e = 3748, c = 234 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@324 · Bonbombe@326 · Bonbombe@328 · Bonbombe@355 · Reine des Voleurs@258 · Mâchassin@217 · Terristocrate@204 · Doublure@193 · Doublure@234
            actions = {
              { type = "deplacer", cellule = 298, chemin = { 327, 313, 298 }, etapes = { 298 } },
              { type = "sort", sort = 32426, cellule = 258, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Recul → Reine des Voleurs
              { type = "sort", sort = 32429, cellule = 231, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Perforante → Reine des Voleurs
              { type = "sort", sort = 32437, cellule = 190, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Œil de Taupe → Reine des Voleurs
              { type = "sort", sort = 32453, cellule = 190, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche d'Abolition → Reine des Voleurs
              { type = "deplacer", cellule = 327, chemin = { 298, 313, 327 }, etapes = { 327 } },
            } },
        },
        [3] = {
          { source = 1, manche = 3, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 356 }, { e = 3726, c = 231 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@356 · Reine des Voleurs@231
            actions = {
              { type = "deplacer", cellule = 298, chemin = { 327, 313, 298 }, etapes = { 298 } },
              { type = "sort", sort = 32466, cellule = 298, depuis = 298, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 231, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32454, cellule = 231, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Œil pour Œil → Reine des Voleurs
              { type = "sort", sort = 32453, cellule = 231, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche d'Abolition → Reine des Voleurs
              { type = "sort", sort = 32453, cellule = 231, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche d'Abolition → Reine des Voleurs
              { type = "deplacer", cellule = 327, chemin = { 298, 313, 327 }, etapes = { 327 } },
            } },
        },
        [4] = {
          { source = 1, manche = 4, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3726, c = 231, inv = true } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@409 · Reine des Voleurs@231(invisible)
            actions = {
              { type = "deplacer", cellule = 298, chemin = { 327, 313, 298 }, etapes = { 298 } },
              { type = "sort", sort = 32429, cellule = 231, depuis = 298, cible = "case" },  -- Flèche Perforante
              { type = "sort", sort = 32426, cellule = 190, depuis = 298, cible = "case" },  -- Flèche de Recul
              { type = "sort", sort = 32460, cellule = 163, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "deplacer", cellule = 327, chemin = { 298, 313, 327 }, etapes = { 327 } },
            } },
        },
        [5] = {
          { source = 1, manche = 5, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3748, c = 163 }, { e = 3748, c = 178 }, { e = 3748, c = 207 }, { e = 3748, c = 208, inv = true }, { e = 3749, c = 135 }, { e = 3750, c = 133 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@355 · Bonbombe@356 · Bonbombe@382 · Bonbombe@409 · Doublure@163 · Doublure@178 · Doublure@207 · Doublure@208(invisible) · Bourôliste@135 · Magouille@133
            actions = {
              { type = "deplacer", cellule = 298, chemin = { 327, 313, 298 }, etapes = { 298 } },
              { type = "sort", sort = 32466, cellule = 298, depuis = 298, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 163, depuis = 298, cible = "ennemi", espece = 3748, id = -38 },  -- Flèche du Jugement → Doublure
              { type = "sort", sort = 32454, cellule = 163, depuis = 298, cible = "ennemi", espece = 3748, id = -38 },  -- Œil pour Œil → Doublure
              { type = "sort", sort = 32453, cellule = 163, depuis = 298, cible = "ennemi", espece = 3748, id = -38 },  -- Flèche d'Abolition → Doublure
              { type = "sort", sort = 32453, cellule = 163, depuis = 298, cible = "ennemi", espece = 3748, id = -38 },  -- Flèche d'Abolition → Doublure
              { type = "deplacer", cellule = 327, chemin = { 298, 313, 327 }, etapes = { 327 } },
            } },
        },
        [6] = {
          { source = 1, manche = 6, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 382 }, { e = 3725, c = 383 }, { e = 3725, c = 409 }, { e = 3749, c = 204 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@382 · Bonbombe@383 · Bonbombe@409 · Bourôliste@204
            actions = {
              { type = "deplacer", cellule = 298, chemin = { 327, 313, 298 }, etapes = { 298 } },
              { type = "sort", sort = 32460, cellule = 204, depuis = 298, cible = "ennemi", espece = 3749, id = -34 },  -- Flèche du Jugement → Bourôliste
              { type = "sort", sort = 32454, cellule = 204, depuis = 298, cible = "case" },  -- Œil pour Œil
              { type = "sort", sort = 32453, cellule = 204, depuis = 298, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 204, depuis = 298, cible = "case" },  -- Flèche d'Abolition
              { type = "deplacer", cellule = 327, chemin = { 298, 313, 327 }, etapes = { 327 } },
            } },
        },
        [7] = {
          { source = 1, manche = 7, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 409 }, { e = 3725, c = 410 }, { e = 3747, c = 261 }, { e = 3747, c = 316 }, { e = 3748, c = 135, inv = true }, { e = 3748, c = 175 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@409 · Bonbombe@410 · Terristocrate@261 · Terristocrate@316 · Doublure@135(invisible) · Doublure@175
            actions = {
              { type = "deplacer", cellule = 356, chemin = { 327, 342, 356 }, etapes = { 356 } },
              { type = "sort", sort = 32426, cellule = 316, depuis = 356, cible = "ennemi", espece = 3747, id = -48 },  -- Flèche de Recul → Terristocrate
              { type = "sort", sort = 32426, cellule = 289, depuis = 356, cible = "ennemi", espece = 3747, id = -48 },  -- Flèche de Recul → Terristocrate
              { type = "sort", sort = 32426, cellule = 261, depuis = 356, cible = "ennemi", espece = 3747, id = -47 },  -- Flèche de Recul → Terristocrate
              { type = "sort", sort = 32443, cellule = 262, depuis = 356, cible = "ennemi", espece = 3747, id = -48 },  -- Flèche de Barrage → Terristocrate
              { type = "deplacer", cellule = 327, chemin = { 356, 342, 327 }, etapes = { 327 } },
            } },
        },
        [8] = {
          { source = 1, manche = 8, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 437 }, { e = 3747, c = 274 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@437 · Terristocrate@274
            actions = {
              { type = "deplacer", cellule = 356, chemin = { 327, 342, 356 }, etapes = { 356 } },
              { type = "sort", sort = 32466, cellule = 356, depuis = 356, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 274, depuis = 356, cible = "ennemi", espece = 3747, id = -48 },  -- Flèche du Jugement → Terristocrate
              { type = "sort", sort = 32454, cellule = 274, depuis = 356, cible = "ennemi", espece = 3747, id = -48 },  -- Œil pour Œil → Terristocrate
              { type = "sort", sort = 32453, cellule = 274, depuis = 356, cible = "ennemi", espece = 3747, id = -48 },  -- Flèche d'Abolition → Terristocrate
              { type = "sort", sort = 32453, cellule = 274, depuis = 356, cible = "case" },  -- Flèche d'Abolition
              { type = "deplacer", cellule = 327, chemin = { 356, 342, 327 }, etapes = { 327 } },
            } },
        },
        [9] = {
          { source = 1, manche = 9, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3746, c = 263 }, { e = 3747, c = 261 }, { e = 3750, c = 149 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@409 · Mâchassin@263 · Terristocrate@261 · Magouille@149
            actions = {
              { type = "sort", sort = 32469, cellule = 327, depuis = 327, cible = "soi" },  -- Acuité Absolue
              { type = "sort", sort = 32460, cellule = 261, depuis = 327, cible = "ennemi", espece = 3747, id = -60 },  -- Flèche du Jugement → Terristocrate
              { type = "deplacer", cellule = 342, chemin = { 327, 342 }, etapes = { 342 } },
              { type = "sort", sort = 32429, cellule = 261, depuis = 342, cible = "ennemi", espece = 3747, id = -60 },  -- Flèche Perforante → Terristocrate
              { type = "sort", sort = 32453, cellule = 220, depuis = 342, cible = "ennemi", espece = 3747, id = -60 },  -- Flèche d'Abolition → Terristocrate
              { type = "deplacer", cellule = 327, chemin = { 342, 327 }, etapes = { 327 } },
            } },
        },
        [10] = {
          { source = 1, manche = 10, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3746, c = 276 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@355 · Bonbombe@356 · Bonbombe@382 · Bonbombe@409 · Mâchassin@276
            actions = {
              { type = "sort", sort = 32426, cellule = 356, depuis = 327, cible = "bombe", espece = 3725, id = -65 },  -- Flèche de Recul → Bonbombe
              { type = "deplacer", cellule = 356, chemin = { 327, 342, 356 }, etapes = { 356 } },
              { type = "sort", sort = 32460, cellule = 276, depuis = 356, cible = "ennemi", espece = 3746, id = -61 },  -- Flèche du Jugement → Mâchassin
              { type = "sort", sort = 32428, cellule = 276, depuis = 356, cible = "ennemi", espece = 3746, id = -61 },  -- Flèche de Dispersion → Mâchassin
              { type = "sort", sort = 32427, cellule = 276, depuis = 356, cible = "ennemi", espece = 3746, id = -61 },  -- Flèche Cinglante → Mâchassin
              { type = "deplacer", cellule = 327, chemin = { 356, 342, 327 }, etapes = { 327 } },
            } },
        },
        [11] = {
          { source = 1, manche = 11, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3725, c = 412 }, { e = 3746, c = 262 }, { e = 3749, c = 204 }, { e = 3750, c = 133 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@382 · Bonbombe@409 · Bonbombe@412 · Mâchassin@262 · Bourôliste@204 · Magouille@133
            actions = {
              { type = "deplacer", cellule = 298, chemin = { 327, 313, 298 }, etapes = { 298 } },
              { type = "sort", sort = 32466, cellule = 298, depuis = 298, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 133, depuis = 298, cible = "ennemi", espece = 3750, id = -71 },  -- Flèche du Jugement → Magouille
              { type = "sort", sort = 32460, cellule = 204, depuis = 298, cible = "ennemi", espece = 3749, id = -73 },  -- Flèche du Jugement → Bourôliste
              { type = "sort", sort = 32446, cellule = 204, depuis = 298, cible = "ennemi", espece = 3749, id = -73 },  -- Flèche Dévorante → Bourôliste
              { type = "deplacer", cellule = 327, chemin = { 298, 313, 327 }, etapes = { 327 } },
            } },
        },
        [12] = {
          { source = 1, manche = 12, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 409 }, { e = 3725, c = 410 }, { e = 3746, c = 289 }, { e = 3750, c = 135 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@409 · Bonbombe@410 · Mâchassin@289 · Magouille@135
            actions = {
              { type = "deplacer", cellule = 356, chemin = { 327, 342, 356 }, etapes = { 356 } },
              { type = "sort", sort = 32428, cellule = 289, depuis = 356, cible = "ennemi", espece = 3746, id = -74 },  -- Flèche de Dispersion → Mâchassin
              { type = "sort", sort = 32427, cellule = 289, depuis = 356, cible = "ennemi", espece = 3746, id = -74 },  -- Flèche Cinglante → Mâchassin
              { type = "sort", sort = 32427, cellule = 289, depuis = 356, cible = "ennemi", espece = 3746, id = -74 },  -- Flèche Cinglante → Mâchassin
              { type = "sort", sort = 32426, cellule = 289, depuis = 356, cible = "case" },  -- Flèche de Recul
              { type = "sort", sort = 32453, cellule = 289, depuis = 356, cible = "case" },  -- Flèche d'Abolition
              { type = "deplacer", cellule = 327, chemin = { 356, 342, 327 }, etapes = { 327 } },
            } },
        },
      },
    },
  },
  {
    nom = "Placement 3",
    -- Combats enregistrés dont viennent les branches (n° de source).
    sources = {
      [1] = "2026-10-11/session-00-27-27.jsonl (flux de Lowkey-Jealous) — 8 manches ; 54/54 vérifications justes contre les synchronisations du serveur",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3726, cellule = 134 },  -- Reine des Voleurs
      { espece = 3746, cellule = 178 },  -- Mâchassin
      { espece = 3747, cellule = 132 },  -- Terristocrate
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de départ de chaque Crâ (placement imposé), et son identifiant de personnage.
    cases = {
      ["Kemist-Skyler"] = 351,
      ["Lowkey-Jealous"] = 353,
      ["Lamouit"] = 354,
      ["Java-Springboot"] = 327,
    },
    ids = {
      ["Kemist-Skyler"] = 900266590501,
      ["Lowkey-Jealous"] = 900264689957,
      ["Lamouit"] = 900264624421,
      ["Java-Springboot"] = 900265148709,
    },
    -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : une ou plusieurs branches, chacune avec le plateau
    -- relevé au début du tour dans son combat (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible alors, case
    -- non comparée). Le script joue la branche dont le plateau correspond à celui du jeu.
    plans = {
      ["Kemist-Skyler"] = {
        [1] = {
          { source = 1, manche = 1, depart = 351, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 326 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3726, c = 190 }, { e = 3746, c = 192 }, { e = 3747, c = 174 }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 262 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@326 · Bonbombe@328 · Bonbombe@355 · Reine des Voleurs@190 · Mâchassin@192 · Terristocrate@174 · Doublure@193(invisible) · Doublure@262
            actions = {
              { type = "deplacer", cellule = 337, chemin = { 351, 337 }, etapes = { 337 } },
              { type = "sort", sort = 32466, cellule = 337, depuis = 337, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 174, depuis = 337, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche du Jugement → Terristocrate
              { type = "sort", sort = 32453, cellule = 174, depuis = 337, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche d'Abolition → Terristocrate
              { type = "sort", sort = 32453, cellule = 174, depuis = 337, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche d'Abolition → Terristocrate
              { type = "sort", sort = 32446, cellule = 174, depuis = 337, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche Dévorante → Terristocrate
              { type = "deplacer", cellule = 408, chemin = { 337, 351, 366, 380, 394, 408 }, etapes = { 380, 394, 408 } },
            } },
        },
        [2] = {
          { source = 1, manche = 2, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 324 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3725, c = 382 }, { e = 3726, c = 120 }, { e = 3746, c = 247 }, { e = 3748, c = 193 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@324 · Bonbombe@355 · Bonbombe@356 · Bonbombe@382 · Reine des Voleurs@120 · Mâchassin@247 · Doublure@193
            actions = {
              { type = "sort", sort = 32465, cellule = 408, depuis = 408, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32469, cellule = 408, depuis = 408, cible = "soi" },  -- Acuité Absolue
              { type = "sort", sort = 32460, cellule = 247, depuis = 408, cible = "ennemi", espece = 3746, id = -14 },  -- Flèche du Jugement → Mâchassin
              { type = "deplacer", cellule = 423, chemin = { 408, 423 }, etapes = { 423 } },
              { type = "sort", sort = 32429, cellule = 247, depuis = 423, cible = "ennemi", espece = 3746, id = -14 },  -- Flèche Perforante → Mâchassin
              { type = "deplacer", cellule = 408, chemin = { 423, 408 }, etapes = { 408 } },
            } },
        },
        [3] = {
          { source = 1, manche = 3, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 328 }, { e = 3725, c = 382 }, { e = 3725, c = 384 }, { e = 3726, c = 235 }, { e = 3746, c = 192 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@328 · Bonbombe@382 · Bonbombe@384 · Reine des Voleurs@235 · Mâchassin@192
            actions = {
              { type = "deplacer", cellule = 424, chemin = { 408, 423, 437, 424 }, etapes = { 437, 424 } },
              { type = "sort", sort = 32466, cellule = 424, depuis = 424, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 235, depuis = 424, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32442, cellule = 235, depuis = 424, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Rédemption → Reine des Voleurs
              { type = "sort", sort = 32437, cellule = 262, depuis = 424, cible = "case" },  -- Œil de Taupe
              { type = "deplacer", cellule = 408, chemin = { 424, 437, 423, 408 }, etapes = { 437, 408 } },
            } },
        },
        [4] = {
          { source = 1, manche = 4, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 356 }, { e = 3725, c = 382 }, { e = 3726, c = 178, inv = true }, { e = 3746, c = 203 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@356 · Bonbombe@382 · Reine des Voleurs@178(invisible) · Mâchassin@203
            actions = {
              { type = "deplacer", cellule = 379, chemin = { 408, 394, 379 }, etapes = { 379 } },
              { type = "sort", sort = 32465, cellule = 379, depuis = 379, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32460, cellule = 203, depuis = 379, cible = "ennemi", espece = 3746, id = -14 },  -- Flèche du Jugement → Mâchassin
              { type = "sort", sort = 32427, cellule = 203, depuis = 379, cible = "ennemi", espece = 3746, id = -14 },  -- Flèche Cinglante → Mâchassin
              { type = "sort", sort = 32427, cellule = 203, depuis = 379, cible = "ennemi", espece = 3746, id = -14 },  -- Flèche Cinglante → Mâchassin
              { type = "sort", sort = 32428, cellule = 203, depuis = 379, cible = "ennemi", espece = 3746, id = -14 },  -- Flèche de Dispersion → Mâchassin
              { type = "deplacer", cellule = 408, chemin = { 379, 394, 408 }, etapes = { 408 } },
            } },
        },
        [5] = {
          { source = 1, manche = 5, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 410 }, { e = 3726, c = 108 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@410 · Reine des Voleurs@108
            actions = {
            } },
        },
        [6] = {
          { source = 1, manche = 6, depart = 408, fin = 408,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3748, c = 132, inv = true }, { e = 3748, c = 147 }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 194 }, { e = 3749, c = 162 }, { e = 3750, c = 163 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@409 · Doublure@132(invisible) · Doublure@147 · Doublure@193(invisible) · Doublure@194 · Bourôliste@162 · Magouille@163
            actions = {
              { type = "deplacer", cellule = 379, chemin = { 408, 394, 379 }, etapes = { 379 } },
              { type = "sort", sort = 32466, cellule = 379, depuis = 379, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32465, cellule = 379, depuis = 379, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32460, cellule = 163, depuis = 379, cible = "ennemi", espece = 3750, id = -38 },  -- Flèche du Jugement → Magouille
              { type = "sort", sort = 32446, cellule = 163, depuis = 379, cible = "ennemi", espece = 3750, id = -38 },  -- Flèche Dévorante → Magouille
              { type = "sort", sort = 32446, cellule = 162, depuis = 379, cible = "ennemi", espece = 3749, id = -39 },  -- Flèche Dévorante → Bourôliste
              { type = "deplacer", cellule = 408, chemin = { 379, 394, 408 }, etapes = { 408 } },
            } },
        },
        [7] = {
          { source = 1, manche = 7, depart = 408, fin = -1,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 437 }, { e = 3748, c = 132 }, { e = 3748, c = 193 }, { e = 3748, c = 229 }, { e = 3748, c = 275 } },
            -- Java-Springboot@327 · Lamouit@354 · Lowkey-Jealous@381 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@437 · Doublure@132 · Doublure@193 · Doublure@229 · Doublure@275
            actions = {
              { type = "deplacer", cellule = 365, chemin = { 408, 394, 379, 365 }, etapes = { 365 } },
              { type = "sort", sort = 32460, cellule = 229, depuis = 365, cible = "ennemi", espece = 3748, id = -42 },  -- Flèche du Jugement → Doublure
            } },
        },
      },
      ["Lowkey-Jealous"] = {
        [1] = {
          { source = 1, manche = 1, depart = 353, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900266590501, c = 351 }, { e = 0, id = 900264624421, c = 354 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3726, c = 190 }, { e = 3746, c = 192 }, { e = 3747, c = 174 }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 262 } },
            -- Java-Springboot@327 · Kemist-Skyler@351 · Lamouit@354 · Bonbombe@328 · Bonbombe@355 · Reine des Voleurs@190 · Mâchassin@192 · Terristocrate@174 · Doublure@193(invisible) · Doublure@262
            actions = {
              { type = "sort", sort = 32466, cellule = 353, depuis = 353, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 174, depuis = 353, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche du Jugement → Terristocrate
              { type = "sort", sort = 32446, cellule = 174, depuis = 353, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche Dévorante → Terristocrate
              { type = "sort", sort = 32448, cellule = 174, depuis = 353, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche Tyrannique → Terristocrate
              { type = "deplacer", cellule = 381, chemin = { 353, 367, 381 }, etapes = { 367, 381 } },
            } },
        },
        [2] = {
          { source = 1, manche = 2, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 324 }, { e = 3725, c = 355 }, { e = 3725, c = 356 }, { e = 3726, c = 120 }, { e = 3746, c = 192 }, { e = 3748, c = 193 }, { e = 3748, c = 329 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@324 · Bonbombe@355 · Bonbombe@356 · Reine des Voleurs@120 · Mâchassin@192 · Doublure@193 · Doublure@329
            actions = {
              { type = "sort", sort = 32469, cellule = 381, depuis = 381, cible = "soi" },  -- Acuité Absolue
              { type = "sort", sort = 32460, cellule = 329, depuis = 381, cible = "ennemi", espece = 3748, id = -17 },  -- Flèche du Jugement → Doublure
              { type = "sort", sort = 32453, cellule = 329, depuis = 381, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 329, depuis = 381, cible = "case" },  -- Flèche d'Abolition
              { type = "sort", sort = 32453, cellule = 329, depuis = 381, cible = "case" },  -- Flèche d'Abolition
            } },
        },
        [3] = {
          { source = 1, manche = 3, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 384 }, { e = 3726, c = 235 }, { e = 3746, c = 192 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@384 · Reine des Voleurs@235 · Mâchassin@192
            actions = {
              { type = "deplacer", cellule = 397, chemin = { 381, 396, 410, 397 }, etapes = { 410, 397 } },
              { type = "sort", sort = 32466, cellule = 397, depuis = 397, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 235, depuis = 397, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32448, cellule = 235, depuis = 397, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Tyrannique → Reine des Voleurs
              { type = "sort", sort = 32446, cellule = 235, depuis = 397, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Dévorante → Reine des Voleurs
              { type = "deplacer", cellule = 381, chemin = { 397, 410, 396, 381 }, etapes = { 410, 381 } },
            } },
        },
        [4] = {
          { source = 1, manche = 4, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 356 }, { e = 3726, c = 178, inv = true }, { e = 3746, c = 207, inv = true } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@356 · Reine des Voleurs@178(invisible) · Mâchassin@207(invisible)
            actions = {
            } },
        },
        [5] = {
          { source = 1, manche = 5, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3726, c = 122 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@382 · Bonbombe@409 · Reine des Voleurs@122
            actions = {
              { type = "deplacer", cellule = 352, chemin = { 381, 367, 352 }, etapes = { 352 } },
              { type = "sort", sort = 32466, cellule = 352, depuis = 352, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32465, cellule = 352, depuis = 352, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32460, cellule = 122, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32426, cellule = 122, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Recul → Reine des Voleurs
              { type = "sort", sort = 32426, cellule = 108, depuis = 352, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Recul → Reine des Voleurs
              { type = "deplacer", cellule = 381, chemin = { 352, 367, 381 }, etapes = { 381 } },
            } },
        },
        [6] = {
          { source = 1, manche = 6, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 409 }, { e = 3725, c = 410 }, { e = 3748, c = 119 }, { e = 3748, c = 132, inv = true }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 194 }, { e = 3749, c = 162 }, { e = 3750, c = 163 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@409 · Bonbombe@410 · Doublure@119 · Doublure@132(invisible) · Doublure@193(invisible) · Doublure@194 · Bourôliste@162 · Magouille@163
            actions = {
              { type = "deplacer", cellule = 352, chemin = { 381, 367, 352 }, etapes = { 352 } },
              { type = "deplacer", cellule = 381, chemin = { 352, 367, 381 }, etapes = { 381 } },
            } },
        },
        [7] = {
          { source = 1, manche = 7, depart = 381, fin = 381,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3725, c = 437 }, { e = 3748, c = 132 }, { e = 3748, c = 147 }, { e = 3748, c = 193 }, { e = 3748, c = 275 }, { e = 3749, c = 230 } },
            -- Java-Springboot@327 · Lamouit@354 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@355 · Bonbombe@437 · Doublure@132 · Doublure@147 · Doublure@193 · Doublure@275 · Bourôliste@230
            actions = {
              { type = "sort", sort = 32460, cellule = 230, depuis = 381, cible = "ennemi", espece = 3749, id = -39 },  -- Flèche du Jugement → Bourôliste
              { type = "deplacer", cellule = 338, chemin = { 381, 367, 352, 338 }, etapes = { 338 } },
              { type = "sort", sort = 32446, cellule = 230, depuis = 338, cible = "ennemi", espece = 3749, id = -39 },  -- Flèche Dévorante → Bourôliste
              { type = "sort", sort = 32446, cellule = 230, depuis = 338, cible = "case" },  -- Flèche Dévorante
              { type = "sort", sort = 32453, cellule = 243, depuis = 338, cible = "case" },  -- Flèche d'Abolition
              { type = "deplacer", cellule = 381, chemin = { 338, 352, 367, 381 }, etapes = { 381 } },
            } },
        },
      },
      ["Lamouit"] = {
        [1] = {
          { source = 1, manche = 1, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900266590501, c = 351 }, { e = 0, id = 900264689957, c = 353 }, { e = 3725, c = 328 }, { e = 3726, c = 190 }, { e = 3746, c = 192 }, { e = 3747, c = 132 }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 262 } },
            -- Java-Springboot@327 · Kemist-Skyler@351 · Lowkey-Jealous@353 · Bonbombe@328 · Reine des Voleurs@190 · Mâchassin@192 · Terristocrate@132 · Doublure@193(invisible) · Doublure@262
            actions = {
              { type = "sort", sort = 32466, cellule = 354, depuis = 354, cible = "soi" },  -- Tirs Puissants
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "sort", sort = 32460, cellule = 190, depuis = 325, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32460, cellule = 132, depuis = 325, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche du Jugement → Terristocrate
              { type = "deplacer", cellule = 311, chemin = { 325, 311 }, etapes = { 311 } },
              { type = "sort", sort = 32426, cellule = 132, depuis = 311, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche de Recul → Terristocrate
              { type = "deplacer", cellule = 354, chemin = { 311, 325, 340, 354 }, etapes = { 354 } },
            } },
        },
        [2] = {
          { source = 1, manche = 2, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 324 }, { e = 3725, c = 356 }, { e = 3726, c = 174 }, { e = 3746, c = 192 }, { e = 3748, c = 193 }, { e = 3748, c = 329 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@324 · Bonbombe@356 · Reine des Voleurs@174 · Mâchassin@192 · Doublure@193 · Doublure@329
            actions = {
              { type = "sort", sort = 32465, cellule = 354, depuis = 354, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32460, cellule = 174, depuis = 354, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "sort", sort = 32426, cellule = 174, depuis = 325, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Recul → Reine des Voleurs
              { type = "sort", sort = 32426, cellule = 147, depuis = 325, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Recul → Reine des Voleurs
              { type = "deplacer", cellule = 354, chemin = { 325, 340, 354 }, etapes = { 354 } },
            } },
        },
        [3] = {
          { source = 1, manche = 3, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3726, c = 235 }, { e = 3746, c = 192 }, { e = 3748, c = 247 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Reine des Voleurs@235 · Mâchassin@192 · Doublure@247
            actions = {
              { type = "sort", sort = 32428, cellule = 326, depuis = 354, cible = "case" },  -- Flèche de Dispersion
              { type = "deplacer", cellule = 383, chemin = { 354, 369, 383 }, etapes = { 383 } },
              { type = "sort", sort = 32426, cellule = 247, depuis = 383, cible = "ennemi", espece = 3748, id = -16 },  -- Flèche de Recul → Doublure
              { type = "sort", sort = 32460, cellule = 235, depuis = 383, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32453, cellule = 235, depuis = 383, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche d'Abolition → Reine des Voleurs
              { type = "deplacer", cellule = 354, chemin = { 383, 369, 354 }, etapes = { 354 } },
            } },
        },
        [4] = {
          { source = 1, manche = 4, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 356 }, { e = 3725, c = 384 }, { e = 3726, c = 178, inv = true }, { e = 3746, c = 207, inv = true } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@356 · Bonbombe@384 · Reine des Voleurs@178(invisible) · Mâchassin@207(invisible)
            actions = {
              { type = "sort", sort = 32466, cellule = 354, depuis = 354, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32465, cellule = 354, depuis = 354, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32469, cellule = 354, depuis = 354, cible = "soi" },  -- Acuité Absolue
              { type = "sort", sort = 32445, cellule = 178, depuis = 354, cible = "case" },  -- Flèche Explosive
              { type = "sort", sort = 32445, cellule = 178, depuis = 354, cible = "case" },  -- Flèche Explosive
            } },
        },
        [5] = {
          { source = 1, manche = 5, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3726, c = 162, inv = true } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@382 · Bonbombe@409 · Reine des Voleurs@162(invisible)
            actions = {
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "deplacer", cellule = 311, chemin = { 325, 311 }, etapes = { 311 } },
              { type = "sort", sort = 32460, cellule = 162, depuis = 311, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32442, cellule = 162, depuis = 311, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Rédemption → Reine des Voleurs
              { type = "sort", sort = 32429, cellule = 162, depuis = 311, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Perforante → Reine des Voleurs
              { type = "deplacer", cellule = 354, chemin = { 311, 325, 340, 354 }, etapes = { 354 } },
            } },
        },
        [6] = {
          { source = 1, manche = 6, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 409 }, { e = 3725, c = 410 }, { e = 3748, c = 119 }, { e = 3748, c = 132, inv = true }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 194 }, { e = 3749, c = 178 }, { e = 3750, c = 190 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@409 · Bonbombe@410 · Doublure@119 · Doublure@132(invisible) · Doublure@193(invisible) · Doublure@194 · Bourôliste@178 · Magouille@190
            actions = {
              { type = "deplacer", cellule = 325, chemin = { 354, 340, 325 }, etapes = { 325 } },
              { type = "sort", sort = 32466, cellule = 325, depuis = 325, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 190, depuis = 325, cible = "ennemi", espece = 3750, id = -38 },  -- Flèche du Jugement → Magouille
              { type = "sort", sort = 32448, cellule = 190, depuis = 325, cible = "ennemi", espece = 3750, id = -38 },  -- Flèche Tyrannique → Magouille
              { type = "sort", sort = 32426, cellule = 190, depuis = 325, cible = "ennemi", espece = 3750, id = -38 },  -- Flèche de Recul → Magouille
              { type = "deplacer", cellule = 354, chemin = { 325, 340, 354 }, etapes = { 354 } },
            } },
        },
        [7] = {
          { source = 1, manche = 7, depart = 354, fin = 354,
            plateau = { { e = 0, id = 900265148709, c = 327 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 437 }, { e = 3748, c = 132 }, { e = 3748, c = 147 }, { e = 3748, c = 193 }, { e = 3748, c = 275 }, { e = 3749, c = 162 } },
            -- Java-Springboot@327 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@437 · Doublure@132 · Doublure@147 · Doublure@193 · Doublure@275 · Bourôliste@162
            actions = {
              { type = "deplacer", cellule = 383, chemin = { 354, 369, 383 }, etapes = { 383 } },
              { type = "sort", sort = 32460, cellule = 275, depuis = 383, cible = "ennemi", espece = 3748, id = -43 },  -- Flèche du Jugement → Doublure
              { type = "deplacer", cellule = 370, chemin = { 383, 370 }, etapes = { 370 } },
              { type = "sort", sort = 32454, cellule = 275, depuis = 370, cible = "ennemi", espece = 3748, id = -43 },  -- Œil pour Œil → Doublure
              { type = "sort", sort = 32453, cellule = 275, depuis = 370, cible = "ennemi", espece = 3748, id = -43 },  -- Flèche d'Abolition → Doublure
              { type = "sort", sort = 32453, cellule = 275, depuis = 370, cible = "ennemi", espece = 3748, id = -43 },  -- Flèche d'Abolition → Doublure
              { type = "deplacer", cellule = 354, chemin = { 370, 383, 369, 354 }, etapes = { 383, 354 } },
            } },
        },
        [8] = {
          { source = 1, manche = 8, depart = 354, fin = -1,
            plateau = { { e = 0, id = 900264689957, c = 381 }, { e = 3748, c = 132 }, { e = 3748, c = 193 }, { e = 3748, c = 229 }, { e = 3748, c = 356 } },
            -- Lowkey-Jealous@381 · Doublure@132 · Doublure@193 · Doublure@229 · Doublure@356
            actions = {
            } },
        },
      },
      ["Java-Springboot"] = {
        [1] = {
          { source = 1, manche = 1, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900266590501, c = 351 }, { e = 0, id = 900264689957, c = 353 }, { e = 0, id = 900264624421, c = 354 }, { e = 3726, c = 190 }, { e = 3746, c = 192 }, { e = 3747, c = 132 }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 194 } },
            -- Kemist-Skyler@351 · Lowkey-Jealous@353 · Lamouit@354 · Reine des Voleurs@190 · Mâchassin@192 · Terristocrate@132 · Doublure@193(invisible) · Doublure@194
            actions = {
              { type = "sort", sort = 32466, cellule = 327, depuis = 327, cible = "soi" },  -- Tirs Puissants
              { type = "deplacer", cellule = 356, chemin = { 327, 342, 356 }, etapes = { 356 } },
              { type = "sort", sort = 32460, cellule = 194, depuis = 356, cible = "ennemi", espece = 3748, id = -17 },  -- Flèche du Jugement → Doublure
              { type = "sort", sort = 32446, cellule = 194, depuis = 356, cible = "ennemi", espece = 3748, id = -17 },  -- Flèche Dévorante → Doublure
              { type = "sort", sort = 32429, cellule = 194, depuis = 356, cible = "ennemi", espece = 3748, id = -17 },  -- Flèche Perforante → Doublure
              { type = "deplacer", cellule = 327, chemin = { 356, 342, 327 }, etapes = { 327 } },
            } },
        },
        [2] = {
          { source = 1, manche = 2, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 324 }, { e = 3725, c = 326 }, { e = 3725, c = 328 }, { e = 3725, c = 355 }, { e = 3726, c = 201 }, { e = 3746, c = 192 }, { e = 3747, c = 188 }, { e = 3748, c = 193 }, { e = 3748, c = 247 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@324 · Bonbombe@326 · Bonbombe@328 · Bonbombe@355 · Reine des Voleurs@201 · Mâchassin@192 · Terristocrate@188 · Doublure@193 · Doublure@247
            actions = {
              { type = "deplacer", cellule = 298, chemin = { 327, 313, 298 }, etapes = { 298 } },
              { type = "sort", sort = 32460, cellule = 188, depuis = 298, cible = "ennemi", espece = 3747, id = -15 },  -- Flèche du Jugement → Terristocrate
              { type = "sort", sort = 32460, cellule = 201, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32426, cellule = 201, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Recul → Reine des Voleurs
              { type = "deplacer", cellule = 327, chemin = { 298, 313, 327 }, etapes = { 327 } },
            } },
        },
        [3] = {
          { source = 1, manche = 3, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 356 }, { e = 3726, c = 262 }, { e = 3746, c = 192 }, { e = 3748, c = 207 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@356 · Reine des Voleurs@262 · Mâchassin@192 · Doublure@207
            actions = {
              { type = "sort", sort = 32426, cellule = 356, depuis = 327, cible = "bombe", espece = 3725, id = -22 },  -- Flèche de Recul → Bonbombe
              { type = "deplacer", cellule = 356, chemin = { 327, 342, 356 }, etapes = { 356 } },
              { type = "sort", sort = 32466, cellule = 356, depuis = 356, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 262, depuis = 356, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32426, cellule = 262, depuis = 356, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Recul → Reine des Voleurs
              { type = "deplacer", cellule = 327, chemin = { 356, 342, 327 }, etapes = { 327 } },
            } },
        },
        [4] = {
          { source = 1, manche = 4, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 328 }, { e = 3725, c = 382 }, { e = 3725, c = 384 }, { e = 3725, c = 409 }, { e = 3726, c = 178, inv = true }, { e = 3746, c = 207, inv = true } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@328 · Bonbombe@382 · Bonbombe@384 · Bonbombe@409 · Reine des Voleurs@178(invisible) · Mâchassin@207(invisible)
            actions = {
              { type = "sort", sort = 32469, cellule = 327, depuis = 327, cible = "soi" },  -- Acuité Absolue
              { type = "sort", sort = 32465, cellule = 327, depuis = 327, cible = "soi" },  -- Tirs Éloignés
              { type = "sort", sort = 32445, cellule = 178, depuis = 327, cible = "case" },  -- Flèche Explosive
              { type = "sort", sort = 32445, cellule = 178, depuis = 327, cible = "case" },  -- Flèche Explosive
            } },
        },
        [5] = {
          { source = 1, manche = 5, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 356 }, { e = 3725, c = 382 }, { e = 3725, c = 409 }, { e = 3726, c = 230 }, { e = 3746, c = 189 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@356 · Bonbombe@382 · Bonbombe@409 · Reine des Voleurs@230 · Mâchassin@189
            actions = {
              { type = "deplacer", cellule = 298, chemin = { 327, 313, 298 }, etapes = { 298 } },
              { type = "sort", sort = 32426, cellule = 230, depuis = 298, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Recul → Reine des Voleurs
              { type = "deplacer", cellule = 284, chemin = { 298, 284 }, etapes = { 284 } },
              { type = "sort", sort = 32428, cellule = 203, depuis = 284, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche de Dispersion → Reine des Voleurs
              { type = "sort", sort = 32429, cellule = 203, depuis = 284, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Perforante → Reine des Voleurs
              { type = "sort", sort = 32427, cellule = 162, depuis = 284, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Cinglante → Reine des Voleurs
              { type = "deplacer", cellule = 327, chemin = { 284, 298, 313, 327 }, etapes = { 327 } },
            } },
        },
        [6] = {
          { source = 1, manche = 6, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 409 }, { e = 3725, c = 410 }, { e = 3726, c = 248 }, { e = 3748, c = 119 }, { e = 3748, c = 132, inv = true }, { e = 3748, c = 193, inv = true }, { e = 3748, c = 194 }, { e = 3749, c = 178 }, { e = 3750, c = 121 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@409 · Bonbombe@410 · Reine des Voleurs@248 · Doublure@119 · Doublure@132(invisible) · Doublure@193(invisible) · Doublure@194 · Bourôliste@178 · Magouille@121
            actions = {
              { type = "deplacer", cellule = 356, chemin = { 327, 342, 356 }, etapes = { 356 } },
              { type = "sort", sort = 32466, cellule = 356, depuis = 356, cible = "soi" },  -- Tirs Puissants
              { type = "sort", sort = 32460, cellule = 248, depuis = 356, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche du Jugement → Reine des Voleurs
              { type = "sort", sort = 32427, cellule = 248, depuis = 356, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Cinglante → Reine des Voleurs
              { type = "sort", sort = 32427, cellule = 248, depuis = 356, cible = "ennemi", espece = 3726, id = -13 },  -- Flèche Cinglante → Reine des Voleurs
              { type = "sort", sort = 32453, cellule = 248, depuis = 356, cible = "case" },  -- Flèche d'Abolition
              { type = "deplacer", cellule = 327, chemin = { 356, 342, 327 }, etapes = { 327 } },
            } },
        },
        [7] = {
          { source = 1, manche = 7, depart = 327, fin = 327,
            plateau = { { e = 0, id = 900264624421, c = 354 }, { e = 0, id = 900264689957, c = 381 }, { e = 0, id = 900266590501, c = 408 }, { e = 3725, c = 437 }, { e = 3748, c = 132 }, { e = 3748, c = 147 }, { e = 3748, c = 193 }, { e = 3748, c = 275 }, { e = 3749, c = 162 }, { e = 3750, c = 163 } },
            -- Lamouit@354 · Lowkey-Jealous@381 · Kemist-Skyler@408 · Bonbombe@437 · Doublure@132 · Doublure@147 · Doublure@193 · Doublure@275 · Bourôliste@162 · Magouille@163
            actions = {
              { type = "deplacer", cellule = 298, chemin = { 327, 313, 298 }, etapes = { 298 } },
              { type = "sort", sort = 32460, cellule = 163, depuis = 298, cible = "ennemi", espece = 3750, id = -38 },  -- Flèche du Jugement → Magouille
              { type = "sort", sort = 32446, cellule = 162, depuis = 298, cible = "ennemi", espece = 3749, id = -39 },  -- Flèche Dévorante → Bourôliste
              { type = "sort", sort = 32446, cellule = 162, depuis = 298, cible = "ennemi", espece = 3749, id = -39 },  -- Flèche Dévorante → Bourôliste
              { type = "deplacer", cellule = 284, chemin = { 298, 284 }, etapes = { 284 } },
              { type = "sort", sort = 32453, cellule = 162, depuis = 284, cible = "ennemi", espece = 3749, id = -39 },  -- Flèche d'Abolition → Bourôliste
              { type = "deplacer", cellule = 327, chemin = { 284, 298, 313, 327 }, etapes = { 327 } },
            } },
        },
      },
    },
  },
}

-- ───────────────────────────── état ─────────────────────────────

local actif = nil              -- scénario reconnu pour le combat en cours
local monTour = 0              -- n-ième tour de CE personnage dans le combat en cours
local placeDemandee = nil      -- case demandée au placement
local journal, journalChemin = {}, nil
local acuiteManche = nil       -- manche où Acuité Absolue a été lancée
local debutTour = -1           -- case au début de mon tour : le combat y pose une marque (on s'arrête si on y passe)
local ligne = nil              -- source de la dernière branche jouée (à égalité, on reste sur la même ligne)
local enAvance, modeAnnonce = false, false   -- mode avancé engagé pour ce combat ; déjà annoncé dans la console
local ACUITE_ABSOLUE = 32469

local CODES = {
  [0] = "LANÇABLE", [1] = "TROP_DE_LANCERS", [2] = "RELANCE", [3] = "PAS_ASSEZ_DE_PA",
  [4] = "TROP_DE_LANCERS_SUR_CASE", [5] = "TROP_LOIN", [6] = "TROP_PRÈS", [7] = "PAS_EN_LIGNE",
  [8] = "LIGNE_DE_VUE", [9] = "TROP_D_INVOCATIONS", [10] = "CASE_DOIT_ÊTRE_LIBRE", [11] = "CASE_DOIT_ÊTRE_OCCUPÉE",
  [12] = "ÉTAT_REQUIS", [13] = "ÉTAT_INTERDIT", [14] = "PAS_EN_DIAGONALE", [15] = "INCONNU", [16] = "HORS_PORTÉE",
}
local function nomCode(c) return CODES[c] or ("code " .. tostring(c)) end

-- ───────────────────────────── journal ─────────────────────────────

local function noter(t) journal[#journal + 1] = tostring(t) end

local function dire(t, genre)
  noter(t)
  local ok = false
  if genre == "succes" then ok = pcall(function() global:printSuccess(t) end)
  elseif genre == "erreur" then ok = pcall(function() global:printError(t) end) end
  if not ok then pcall(function() global:printMessage(t) end) end
end

local function moi()
  local n = nil
  pcall(function() n = character:name() end)
  if type(n) == "string" and n ~= "" then return n end
  -- Repli : l'identifiant de personnage, retrouvé dans le scénario.
  local id = nil
  pcall(function() id = fightCharacter:getId() end)
  for _, s in ipairs(SCENARIOS) do
    for nom, x in pairs(s.ids or {}) do if x == id then return nom end end
  end
  return nil
end

local function journalEcrire()
  if not JOURNAL_FICHIER then return end
  if journalChemin == nil then
    local dossier = nil
    pcall(function() dossier = global:getCurrentScriptDirectory() end)
    local nom = (moi() or "inconnu"):gsub("[^%w%-]", "_")
    local quand = nil
    pcall(function() quand = os.date("%Y%m%d-%H%M%S") end)
    if type(quand) ~= "string" then pcall(function() quand = tostring(math.floor(os.time())) end) end
    local fichier = "rejeu_" .. nom .. "_" .. tostring(quand or "combat") .. ".log"
    journalChemin = (type(dossier) == "string" and dossier ~= "") and (dossier:gsub("[\\/]$", "") .. "\\" .. fichier) or fichier
  end
  pcall(function()
    local f = io.open(journalChemin, "w")
    if f == nil then return end
    f:write(table.concat(journal, "\n"), "\n")
    f:close()
  end)
end

-- ───────────────────────────── lecture du combat ─────────────────────────────

local function maCase()
  local c = -1
  pcall(function() c = fightCharacter:getCellId() end)
  return c
end

local function manche()
  local t = nil
  pcall(function() t = fightAction:getCurrentTurn() end)
  return t
end

local function entites()
  local out = {}
  pcall(function()
    local l = fightAction:getAllEntities()
    for _, e in ipairs(l or {}) do out[#out + 1] = e end
  end)
  return out
end

local function vivant(e) return (e.LifePoints or 0) > 0 end

-- Abandon (ABANDON_SI_CRA_MORT, ABANDON_SI_REINE_AU_CONTACT). Crâs : joueurs de notre équipe (Team faux, sans espèce
-- de monstre) ; le plus grand nombre vu vivant dans ce combat sert de référence (remis à zéro au placement).
local crasVus = 0
local function combatPerdu()
  local cras, reine = {}, nil
  for _, e in ipairs(entites()) do
    local espece = e.CreatureGenericId or 0
    if e.Team ~= true and espece == 0 and vivant(e) then cras[#cras + 1] = e.CellId end
    if espece == 3726 and vivant(e) then reine = e.CellId end
  end
  if #cras > crasVus then crasVus = #cras end
  if ABANDON_SI_CRA_MORT and #cras > 0 and #cras < crasVus then
    return (crasVus - #cras) .. " Crâ(s) mort(s) sur " .. crasVus
  end
  if ABANDON_SI_REINE_AU_CONTACT and reine ~= nil and reine >= 0 then
    for _, c in ipairs(cras) do
      local d = nil
      pcall(function() d = fightAction:getDistance(reine, c) end)
      if c >= 0 and d == 1 then return "la Reine (case " .. reine .. ") est au contact d'un Crâ (case " .. c .. ")" end
    end
  end
  return nil
end
local function abandonner(raison)
  dire("⛔ [COMBAT] " .. raison .. " : combat perdu — ABANDON", "erreur")
  journalEcrire()
  if ABANDON_PAQUET and pcall(function() developer:sendMessage(developer:createMessage(ABANDON_PAQUET)) end) then
    dire("[COMBAT] abandon envoyé (paquet « " .. ABANDON_PAQUET .. " »)")
    return
  end
  if pcall(function() character:giveUpFight() end) then return end
  if pcall(function() fightAction:giveUpFight() end) then return end
  dire("⛔ [COMBAT] le script ne sait pas abandonner (ABANDON_PAQUET à relever, giveUpFight absent) : abandonne à la main", "erreur")
end

-- ───────────────────────────── scénario : reconnaissance ─────────────────────────────

-- Le placement des monstres (case → identifiant, -1 = vide) correspond-il à la signature d'un scénario ? Toutes les
-- cases de la signature doivent porter un monstre, et aucun autre monstre ne doit être ailleurs.
local function reconnaitre(defenders)
  local occupees, n = {}, 0
  for cell, id in pairs(defenders or {}) do
    if id ~= -1 then occupees[cell] = true n = n + 1 end
  end
  for _, s in ipairs(SCENARIOS) do
    local bons = 0
    for _, m in ipairs(s.monstres) do if occupees[m.cellule] then bons = bons + 1 end end
    dire("[PLACEMENT] " .. s.nom .. " : " .. bons .. "/" .. #s.monstres .. " cases de monstres concordantes (" ..
      n .. " monstres en jeu)")
    if bons == #s.monstres and n == #s.monstres then return s end
  end
  local vus = {}
  for cell in pairs(occupees) do vus[#vus + 1] = tostring(cell) end
  table.sort(vus)
  dire("⛔ [PLACEMENT] aucun scénario ne correspond — monstres en " .. table.concat(vus, ", ") ..
    " : combat à enregistrer pour en faire un scénario de plus.", "erreur")
  return nil
end

-- Repli quand le placement n'a pas été vu (script chargé en plein combat) : monstres sur leurs cases de départ.
local function reconnaitreEnCombat()
  local defenders = {}
  for _, e in ipairs(entites()) do
    if e.Team == true and vivant(e) then defenders[e.CellId] = e.Id end
  end
  return reconnaitre(defenders)
end

-- ───────────────────────────── placement ─────────────────────────────

local function monId()
  local id = nil
  pcall(function() id = character:id() end)
  if id == nil then pcall(function() id = fightCharacter:getId() end) end
  return id
end

-- Ma case pendant le placement : AnkaBot (fightCharacter), sinon mon entité.
local function caseDuPlacement()
  local c = maCase()
  if c ~= nil and c >= 0 then return c end
  local id = monId()
  for _, e in ipairs(entites()) do if e.Id == id then return e.CellId end end
  return -1
end

local paquetVerifie = nil      -- nil : pas encore essayé · true / false
local function paquetPlacement()
  if not PLACEMENT.paquet then return false end
  if paquetVerifie ~= nil then return paquetVerifie end
  -- Le message existe-t-il, avec ces champs ? (lecture de champ sous pcall ; jamais de tostring sur un message)
  local ok = pcall(function()
    local m = developer:createMessage(PLACEMENT.nom)
    local _ = m[PLACEMENT.case]
    local _2 = m[PLACEMENT.combattant]
  end)
  paquetVerifie = ok
  if not ok then
    dire("⚠ [PLACEMENT] paquet « " .. PLACEMENT.nom .. " » (" .. PLACEMENT.case .. ", " .. PLACEMENT.combattant ..
      ") introuvable : noms renouvelés par Ankama ? À relever dans D3ProtocolSniffer. Repli : fightAction:chooseCell.", "erreur")
  end
  return ok
end

local function demanderCase(cell)
  if paquetPlacement() then
    local ok, err = pcall(function()
      local m = developer:createMessage(PLACEMENT.nom)
      m[PLACEMENT.case] = cell
      m[PLACEMENT.combattant] = monId()
      developer:sendMessage(m)
    end)
    if ok then return "paquet" end
    dire("⚠ [PLACEMENT] envoi du paquet impossible : " .. tostring(err))
  end
  pcall(function() fightAction:chooseCell(cell) end)
  return "chooseCell"
end

local function placer(cible, challengers)
  placeDemandee = cible
  local cibles = {}
  if actif then for _, c in pairs(actif.cases) do cibles[c] = true end end
  for essai = 1, PLACEMENT.essais do
    local ici = caseDuPlacement()
    if ici == cible then
      dire("[PLACEMENT] en place sur " .. cible .. (essai > 1 and (" (" .. (essai - 1) .. " demande(s))") or ""), "succes")
      return true
    end
    local vers = cible
    -- Case visée encore occupée par un coéquipier après deux essais : passer UNE fois par une case libre qu'aucun Crâ
    -- ne vise (deux Crâs qui veulent chacun la case de l'autre se bloqueraient sinon).
    if essai == 3 then
      for cell, id in pairs(challengers or {}) do
        if id == -1 and not cibles[cell] and cell ~= ici then
          vers = cell
          break
        end
      end
    end
    local par = demanderCase(vers)
    noter("[PLACEMENT] demande " .. essai .. " : " .. tostring(ici) .. " → " .. vers .. " (" .. par .. ")")
    pcall(function() global:delay(PLACEMENT.attente) end)
  end
  local fin = caseDuPlacement()
  if fin == cible then
    dire("[PLACEMENT] en place sur " .. cible, "succes")
    return true
  end
  dire("⛔ [PLACEMENT] case " .. cible .. " NON obtenue (je suis en " .. tostring(fin) ..
    ") : le rejeu de ce personnage partira d'ailleurs.", "erreur")
  return false
end

function fightManagementPosition(challengers, defenders)
  local ok, err = pcall(function()
    journal, journalChemin, monTour, acuiteManche, ligne = {}, nil, 0, nil, nil
    enAvance, modeAnnonce, crasVus = false, false, 0
    actif = reconnaitre(defenders)
    if actif == nil then return end
    local nom = moi()
    local cible = nom and actif.cases[nom]
    dire("[PLACEMENT] scénario « " .. actif.nom .. " » reconnu — " .. tostring(nom) .. " → case " .. tostring(cible), "succes")
    -- Mode avancé (ReineCombat.lua) : la formation de même nom pour l'IA (colonne de chaque Crâ).
    if IA_formation and not IA_formation(actif.nom) then
      dire("⚠ [PLACEMENT] pas de formation « " .. actif.nom .. " » pour le mode avancé : colonne par défaut du serveur", "erreur")
    end
    if cible == nil then
      dire("⛔ [PLACEMENT] " .. tostring(nom) .. " n'a pas de case dans ce scénario", "erreur")
      return
    end
    placer(cible, challengers)
  end)
  if not ok then dire("⛔ [PLACEMENT] erreur : " .. tostring(err), "erreur") end
  journalEcrire()
end

-- ───────────────────────────── combat : actions ─────────────────────────────

local NOMS_ESPECES = { [3725] = "Bonbombe", [3726] = "Reine", [3746] = "Mâchassin", [3747] = "Terristocrate",
  [3748] = "Doublure", [3749] = "Bourôliste", [3750] = "Magouille" }
local function nomEspece(e) return NOMS_ESPECES[e] or ("espèce " .. tostring(e)) end

-- Case où lancer le sort (voir VISER). Rend (case, explication) ; "case" quand c'est la case enregistrée.
local function caseVisee(a)
  if a.cible == "soi" then return maCase(), "soi" end
  if VISER == "case" or a.cible == "case" then return a.cellule, "case" end
  if a.cible == "allie" and a.id then
    for _, e in ipairs(entites()) do
      if e.Id == a.id and vivant(e) and (e.CellId or -1) >= 0 then
        if e.CellId == a.cellule then return a.cellule, "case" end
        return e.CellId, "allié déplacé : " .. a.cellule .. " → " .. e.CellId
      end
    end
    return a.cellule, "allié introuvable : case enregistrée"
  end
  if a.espece then
    local qui = nomEspece(a.espece)
    local visibles = {}   -- monstres de l'espèce, vivants et sur le plateau (case -1 : invisible)
    for _, e in ipairs(entites()) do
      if e.CreatureGenericId == a.espece and vivant(e) and (e.CellId or -1) >= 0 then visibles[#visibles + 1] = e end
    end
    for _, e in ipairs(visibles) do if e.CellId == a.cellule then return a.cellule, "case" end end
    if a.cible ~= "bombe" and a.id then
      for _, e in ipairs(visibles) do
        if e.Id == a.id then return e.CellId, qui .. " suivie : " .. a.cellule .. " → " .. e.CellId end
      end
    end
    local mieux, d = nil, nil
    for _, e in ipairs(visibles) do
      local x = 99
      pcall(function() x = fightAction:getDistance(e.CellId, a.cellule) end)
      if d == nil or x < d then mieux, d = e.CellId, x end
    end
    if mieux then return mieux, qui .. " suivie (la plus proche) : " .. a.cellule .. " → " .. mieux end
    return a.cellule, qui .. " introuvable (morte ou invisible) : case enregistrée"
  end
  return a.cellule, "case"
end

local function pause(ms)
  if ms and ms > 0 then pcall(function() global:delay(ms) end) end
end

-- Horloge du script en secondes (os.clock : celle du journal, dont les « ms » valent os.clock() × 1000).
local function horloge()
  local t = 0
  pcall(function() t = os.clock() end)
  return type(t) == "number" and t or 0
end

-- Le jeu me donne-t-il encore la main ? (faux seulement si AnkaBot le dit : une erreur de lecture ne coupe pas le tour)
local function encoreMonTour()
  local a = true
  pcall(function() a = fightCharacter:isItMyTurn() end)
  return a ~= false
end

local function verifier(sort, cell)
  local code = -1
  pcall(function() code = fightAction:canCastSpellOnCell(maCase(), sort, cell) end)
  return code
end

-- Lance un sort. Rend (lancé, code de canCastSpellOnCell, forcé).
local function lancer(a, cell)
  local code = verifier(a.sort, cell)
  local forcer = false
  if code == 8 and acuiteManche ~= nil and acuiteManche == manche() then
    forcer = true        -- Acuité Absolue : canCastSpellOnCell répond LIGNE_DE_VUE à tort
  elseif code ~= 0 and FORCER_SI_ENREGISTRE and CODES_FORCABLES[code] and a.depuis == maCase() then
    -- Même case de départ, même cible (case enregistrée ou monstre suivi) que dans le combat enregistré, où le sort est
    -- parti : AnkaBot juge peut-être sur un état en retard. On lui laisse un instant, puis on lance quand même.
    pause(DELAI_APRES_SORT)
    code = verifier(a.sort, cell)
    forcer = code ~= 0
  end
  if code ~= 0 and not forcer then return false, code, false end
  local ok = false
  pcall(function() ok = fightAction:castSpellOnCell(a.sort, cell) end)
  if ok and a.sort == ACUITE_ABSOLUE then acuiteManche = manche() end
  pause(DELAI_APRES_SORT)
  return ok == true, code, forcer
end

-- Position d'une case dans un chemin (nil si absente).
local function rang(chemin, c)
  for i, x in ipairs(chemin or {}) do if x == c then return i end end
  return nil
end

-- Suis-je sur la case c ? Laisse à AnkaBot jusqu'à ATTENTE_POSITION ms pour mettre ma case à jour après un déplacement.
local function surCase(c)
  local t = 0
  while maCase() ~= c do
    if t >= ATTENTE_POSITION then return false end
    pause(50)
    t = t + 50
  end
  return true
end

-- Avance case par case le long de `chemin`, de la case actuelle jusqu'à `jusqua` (cases voisines : chaque pas est un
-- plus court chemin unique). Rend vrai si `jusqua` est atteinte.
local function caseParCase(chemin, jusqua)
  local i, fin = rang(chemin, maCase()), rang(chemin, jusqua)
  if i == nil or fin == nil or fin <= i then return maCase() == jusqua end
  for k = i + 1, fin do
    pcall(function() fightAction:moveToWardCell(chemin[k]) end)
    if not surCase(chemin[k]) then return false end
  end
  return true
end

-- Liste Lua des cases d'un chemin rendu par AnkaBot (table, ou liste .NET : Count + indexeur).
local function versListe(p)
  if type(p) == "table" then return p end
  local out = {}
  pcall(function()
    for k = 0, p.Count - 1 do out[#out + 1] = p[k] end
  end)
  return out
end

-- Hors du chemin enregistré (le Crâ ne part pas de là où le chemin commençait) : plus court chemin d'AnkaBot qui
-- évite la marque posée sous ma case de début de tour (sauf si c'est la destination), suivi case par case.
local function allerEnEvitant(cible)
  local eviter = {}
  if debutTour >= 0 and debutTour ~= cible and debutTour ~= maCase() then eviter = { debutTour } end
  local chemin = nil
  pcall(function() chemin = versListe(fightAction:getShortestPath(maCase(), cible, eviter)) end)
  if type(chemin) == "table" and #chemin > 0 then
    if chemin[1] ~= maCase() then table.insert(chemin, 1, maCase()) end
    if caseParCase(chemin, cible) then return true end
  end
  if maCase() ~= cible then pcall(function() fightAction:moveToWardCell(cible) end) end
  return surCase(cible)
end

-- Déplacement : refait le chemin enregistré, coin par coin (lignes droites), avec repli case par case.
local function deplacer(a)
  local avant = maCase()
  if avant == a.cellule then return true, "déjà en place" end
  if a.chemin == nil or a.chemin[1] ~= avant then
    local ok = allerEnEvitant(a.cellule)
    return ok, "hors du chemin enregistré (départ " .. avant .. " au lieu de " .. tostring(a.chemin and a.chemin[1]) ..
      ") : plus court chemin en évitant la marque"
  end
  for _, coin in ipairs(a.etapes or { a.cellule }) do
    if maCase() ~= coin then
      pcall(function() fightAction:moveToWardCell(coin) end)
      if not surCase(coin) and not caseParCase(a.chemin, coin) then
        return false, "bloqué en " .. maCase() .. " avant le coin " .. coin
      end
    end
  end
  return maCase() == a.cellule, nil
end

-- Joue une action ; rend false si le tour doit s'arrêter (STRICT).
local function jouerAction(a, n)
  if a.type == "deplacer" then
    local avant = maCase()
    local ok, note = deplacer(a)
    local apres = maCase()
    if ok then
      dire("  " .. n .. ". déplacement " .. avant .. " → " .. apres .. (note and (" (" .. note .. ")") or ""))
      return true
    end
    local pm = -1
    pcall(function() pm = fightCharacter:getMP() end)
    dire("  ⚠ " .. n .. ". déplacement vers " .. a.cellule .. " : parti de " .. avant .. ", arrivé en " .. apres ..
      " (PM restants " .. pm .. ", chemin enregistré " .. table.concat(a.chemin or {}, "→") ..
      (note and ("; " .. note) or "") .. ")", "erreur")
    return not STRICT
  end
  local cell, pourquoi = caseVisee(a)
  if cell == nil then
    dire("  ⚠ " .. n .. ". sort " .. a.sort .. " sauté : " .. pourquoi, "erreur")
    return not STRICT
  end
  local ok, code, force = lancer(a, cell)
  if ok then
    dire("  " .. n .. ". sort " .. a.sort .. " sur " .. cell .. (pourquoi ~= "case" and pourquoi ~= "soi" and (" (" .. pourquoi .. ")") or "") ..
      (force and (" — lancé malgré « " .. nomCode(code) .. " » d'AnkaBot (case de départ enregistrée)") or ""))
    return true
  end
  local raison = code == 0 and "autorisé mais non exécuté (désynchro ?)" or nomCode(code)
  dire("  ⚠ " .. n .. ". sort " .. a.sort .. " sur " .. cell .. " : " .. raison, "erreur")
  return not STRICT
end

-- ───────────────────────────── branches ─────────────────────────────

-- Combattants vivants autres que moi : { e = espèce (0 pour un joueur), id, c = case }.
local function plateauDuJeu()
  local moiId = monId()
  local out = {}
  for _, x in ipairs(entites()) do
    if vivant(x) and x.Id ~= moiId then
      out[#out + 1] = { e = x.CreatureGenericId or 0, id = x.Id, c = x.CellId }
    end
  end
  return out
end

local function decrirePlateau(p)
  local parts = {}
  for _, x in ipairs(p) do
    local qui = (x.e == 0) and (function()
      for nom, id in pairs(actif and actif.ids or {}) do if id == x.id then return nom end end
      return "joueur " .. tostring(x.id)
    end)() or nomEspece(x.e)
    parts[#parts + 1] = qui .. "@" .. ((x.c or -1) >= 0 and tostring(x.c) or "invisible")
  end
  table.sort(parts)
  return table.concat(parts, " · ")
end

-- Écarts entre le plateau enregistré d'une branche et celui du jeu : chaque combattant enregistré (sauf invisible) doit
-- être sur sa case (un Crâ par son identifiant, un monstre par son espèce).
local function ecarts(branche, jeu)
  local out = {}
  local attendues = {}   -- espèce -> cases enregistrées (pour dire où est le monstre qui manque)
  for _, b in ipairs(branche.plateau or {}) do
    if b.e ~= 0 then
      attendues[b.e] = attendues[b.e] or {}
      attendues[b.e][b.c] = true
    end
  end
  for _, b in ipairs(branche.plateau or {}) do
    if not b.inv then
      local trouve, ailleurs = false, {}
      for _, x in ipairs(jeu) do
        local meme = (b.e == 0) and (x.id == b.id) or (b.e ~= 0 and x.e == b.e)
        if meme then
          if x.c == b.c then trouve = true break end
          -- Case inexpliquée : aucun monstre de cette espèce n'y était attendu.
          if b.e == 0 or not attendues[b.e][x.c] then ailleurs[#ailleurs + 1] = ((x.c or -1) >= 0 and tostring(x.c) or "invisible") end
        end
      end
      if not trouve then
        local qui = b.e == 0 and "coéquipier " .. tostring(b.id) or nomEspece(b.e)
        for nom, id in pairs(actif and actif.ids or {}) do if b.e == 0 and id == b.id then qui = nom end end
        out[#out + 1] = qui .. " attendu en " .. b.c .. (#ailleurs > 0 and (", vu en " .. table.concat(ailleurs, "/")) or ", absent")
      end
    end
  end
  return out
end

-- Branche à jouer : la moins éloignée du plateau du jeu (à égalité, celle de la même ligne que le tour précédent).
local function choisirBranche(branches, jeu)
  local meilleure, ecs = nil, nil
  for _, b in ipairs(branches) do
    local e = ecarts(b, jeu)
    if meilleure == nil or #e < #ecs or (#e == #ecs and b.source == ligne and meilleure.source ~= ligne) then
      meilleure, ecs = b, e
    end
  end
  return meilleure, ecs or {}
end

local function jouerIA(pourquoi)
  dire("[IA] " .. pourquoi .. " — IA basique d'AnkaBot (configuration de sorts du compte)")
  if not pcall(function() fightBasic:playTurn(2) end) then dire("⛔ fightBasic:playTurn a échoué", "erreur") end
end

-- ───────────────────────────── mode avancé ─────────────────────────────

local QUEEN = 3726

-- La Reine est-elle en vie ? true / false, ou nil si la liste des combattants est illisible. Sous Brume, elle reste dans
-- la liste (case -1, PV > 0 : 2026-10-10) ; morte, elle n'y est plus vivante.
local function reineEnVie()
  local liste = entites()
  if #liste == 0 then return nil end
  for _, x in ipairs(liste) do
    if x.CreatureGenericId == QUEEN and vivant(x) then return true end
  end
  return false
end

-- Tour joué par l'IA du serveur de plans (IA_tour, incluse dans ReineCombat.lua seulement). Une fois engagé, le mode
-- avancé le reste jusqu'à la fin du combat.
local function modeAvance(pourquoi)
  enAvance = true
  if not modeAnnonce then
    modeAnnonce = true
    dire("[COMBAT] " .. pourquoi .. " — MODE AVANCÉ : l'IA du serveur de plans joue désormais les tours", "succes")
  end
  journalEcrire()
  IA_tour()
end

local function jouerMonTour()
  local aMoi = true
  pcall(function() aMoi = fightCharacter:isItMyTurn() end)
  if not aMoi then return end
  local t0 = horloge()
  local perdu = combatPerdu()
  if perdu then return abandonner(perdu) end
  local nom = moi()
  local m = manche()
  monTour = monTour + 1
  -- Script chargé en plein combat : on se cale sur la manche d'AnkaBot (au mieux).
  if monTour == 1 and type(m) == "number" and m > 1 then monTour = m end
  if actif == nil and monTour == 1 then actif = reconnaitreEnCombat() end

  noter("")
  -- Horloge : comparable aux « ms » du journal (début de tour jvj) pour savoir quand fightManagement a été lancé.
  noter("════ " .. tostring(nom) .. " — mon tour " .. monTour .. " (manche AnkaBot " .. tostring(m) .. "), case " .. maCase() ..
    string.format(" ════ [horloge %.3f]", t0))
  if IA_tour and enAvance then return modeAvance("mode avancé") end
  if IA_tour and APRES_LA_REINE == "avance" and reineEnVie() == false then return modeAvance("la Reine est morte") end
  if actif == nil then
    if SANS_SCENARIO == "avance" and IA_tour then return modeAvance("aucun scénario reconnu") end
    if SANS_SCENARIO == "ia" then jouerIA("aucun scénario") else dire("[REJEU] aucun scénario reconnu — tour passé") end
    return
  end
  local plan = actif.plans[nom or ""]
  local branches = plan and plan[monTour]
  if branches == nil or #branches == 0 then
    if APRES_LE_PLAN == "avance" and IA_tour then return modeAvance("tour " .. monTour .. " au-delà du combat enregistré") end
    if APRES_LE_PLAN == "ia" then jouerIA("au-delà du combat enregistré")
    else dire("[REJEU] " .. tostring(nom) .. " : tour " .. monTour .. " au-delà du combat enregistré — tour passé") end
    return
  end
  local jeu = plateauDuJeu()
  noter("  plateau du jeu : " .. decrirePlateau(jeu))
  local tour, ecs = choisirBranche(branches, jeu)
  if #ecs > TOLERANCE_PLATEAU then
    dire("⚠ [" .. tostring(nom) .. "] tour " .. monTour .. " : aucune des " .. #branches .. " branche(s) ne correspond au plateau — " ..
      table.concat(ecs, " ; "), "erreur")
    if SI_AUCUNE_BRANCHE == "main" then
      dire("[REJEU] le script s'arrête : à vous de jouer (combat à enregistrer pour en faire une branche de plus)", "erreur")
      journalEcrire()
      pcall(function() global:finishScript() end)
      return
    elseif SI_AUCUNE_BRANCHE == "ia" then
      jouerIA("aucune branche ne correspond")
      return
    elseif SI_AUCUNE_BRANCHE == "passer" then
      dire("[REJEU] tour passé")
      return
    end
    dire("  → on joue quand même la branche la plus proche (source " .. tour.source .. ", " .. #ecs .. " écart(s))")
  elseif #branches > 1 then
    dire("  branche de la source " .. tour.source .. " (" .. #branches .. " connues pour ce tour)" ..
      (#ecs > 0 and (" — écarts tolérés : " .. table.concat(ecs, " ; ")) or ""))
  end
  ligne = tour.source
  if type(m) == "number" and tour.manche ~= m then
    noter("  (manche enregistrée " .. tour.manche .. ", AnkaBot dit " .. m .. " : on suit le compte des tours)")
  end
  local ici = maCase()
  debutTour = ici
  dire("== [" .. nom .. "] tour " .. monTour .. " (manche " .. tour.manche .. ") : " .. #tour.actions .. " action(s)" ..
    (ici ~= tour.depart and (" — ⚠ départ en " .. ici .. " au lieu de " .. tour.depart) or "") .. " ==")
  for i, a in ipairs(tour.actions) do
    local pv = 1
    pcall(function() pv = fightCharacter:getLifePoints() end)
    if (pv or 0) <= 0 then
      dire("  ⛔ personnage mort — fin du tour", "erreur")
      break
    end
    -- Tour fini côté jeu (combat du 2026-10-10 à 21:23 : tours terminés 0,1 s après leur début, avant toute action) :
    -- continuer bloquait le script 20 à 28 s sur des actions vouées à l'échec, et le combat attendait ce personnage.
    if not encoreMonTour() then
      dire(string.format("  ⛔ tour terminé par le jeu avant l'action %d (%.2f s après le lancement de fightManagement) : on s'arrête",
        i, horloge() - t0), "erreur")
      break
    end
    if not jouerAction(a, i) then
      dire("  ⛔ (STRICT) tour interrompu au premier écart", "erreur")
      break
    end
    if DELAI_ENTRE_ACTIONS > 0 then pcall(function() global:delay(DELAI_ENTRE_ACTIONS) end) end
  end
  local fin = maCase()
  noter("  fin du tour en " .. fin .. (fin ~= tour.fin and (" (enregistré : " .. tour.fin .. ")") or " (comme enregistré)") ..
    string.format(" — %.1f s", horloge() - t0))
end

function fightManagement()
  local ok, err = pcall(jouerMonTour)
  if not ok then dire("⛔ [REJEU] erreur : " .. tostring(err), "erreur") end
  journalEcrire()
end

-- ───────────────────────────── hors combat ─────────────────────────────

local function attendre()
  if LANCER_LE_COMBAT then
    dire("[REJEU] lancement du combat sur la carte")
    pcall(function() map:fight() end)
  end
  pcall(function() global:delay(2000) end)
end

function move()
  local carte = nil
  pcall(function() carte = map:currentMapId() end)
  local out, vues = {}, {}
  local function ajouter(c)
    if c and c ~= "0" and c ~= "nil" and not vues[c] then
      vues[c] = true
      out[#out + 1] = { map = c, custom = attendre }
    end
  end
  ajouter(tostring(carte))
  for _, c in ipairs(CARTES) do ajouter(c) end
  return out
end

local noms = {}
for _, s in ipairs(SCENARIOS) do noms[#noms + 1] = s.nom end
dire("[REJEU] chargé : " .. #SCENARIOS .. " scénario(s) (" .. table.concat(noms, ", ") .. "), visée « " .. VISER .. " »")
