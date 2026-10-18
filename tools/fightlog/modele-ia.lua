-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
--  IA DE LA REINE DES VOLEURS (serveur de plans). Partie ajoutée au journal ci-dessus par tools/fightlog/ia.ts
--  (modèle : tools/fightlog/modele-ia.lua) ; FICHIER GÉNÉRÉ : régénérer plutôt qu'éditer.
--
--  Ce qu'il fait, pour chaque Crâ du groupe (chargé sur le chef, AnkaBot le charge aussi sur les mules) :
--    - le JOURNAL ci-dessus enregistre tous les messages du combat et les envoie au serveur (comme
--      journal-combats.lua) : c'est ce qui lui donne l'état exact du combat ;
--    - PLACEMENT (fightManagementPosition) : reconnaît la formation par les cases de départ des monstres et met le Crâ
--      sur SA case de placement (paquet de placement, sinon fightAction:chooseCell) ;
--    - COMBAT (fightManagement, à chaque tour) : demande son tour au serveur (POST /plan : sa case, ses PA, ses PM et la
--      colonne de la formation), puis l'exécute — sortie de la colonne, sorts, retour sur sa case — par les méthodes
--      d'AnkaBot. Un écart (sort refusé, déplacement arrêté en route) : nouveau plan demandé depuis l'état atteint
--      (REPLANIFIER fois au plus). Reine sous Brume : le plan s'arrête après la Flèche Perforante qui la cherche
--      (ligne « suite ») et la suite du tour est redemandée (SUITES fois au plus). Serveur absent ou sans plan : SANS_PLAN.
--
--  Avant le combat : lancer le serveur (tools/ankabot/lancer_serveur_reine.cmd, ou
--    npx tsx tools/reine-des-voleurs/planificateur/serveur.ts) et le laisser ouvert ; il remplace
--  scripts/fightlog-server.mjs (même port, mêmes fichiers de journal).
--  Configuration de combat de chaque compte : IA avancée « dans le même script ».
--
--  Le serveur prend chaque tour dans le journal d'un Crâ qui ne joue pas : pendant son propre tour (et pendant la
--  demande de son plan), le script d'un Crâ est occupé et AnkaBot ne lui transmet plus les messages (« un seul fil
--  d'exécution à la fois »). Il faut donc les QUATRE journaux.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- Paramètre AnkaBot : combat à vagues (de nouveaux monstres arrivent ; sinon AnkaBot peut croire le combat fini).
IS_WAVE_FIGHT = true
PLAN_URL = "http://127.0.0.1:8765/plan"   -- serveur de plans (même port que le récepteur du journal)
-- Serveur absent, ou aucun plan : "passer" (ne rien faire), "ia" (IA basique d'AnkaBot, fightBasic:playTurn) ou "main"
-- (arrêter le script : le joueur finit le combat à la main).
SANS_PLAN = "passer"
REPLANIFIER = 2           -- nouveaux plans demandés au plus dans un même tour, après un écart (0 : aucun)
SUITES = 2                -- plans de suite demandés au plus dans un même tour, quand le serveur le dit (Reine sous Brume)
-- Attente maximale du serveur (ms) avant qu'il planifie quand même (il répond dès que le journal a rattrapé le Crâ).
-- Combat du 2026-10-10 à 14:49 : les journaux avaient 2 à 4 s de retard pendant les rafales de messages ; avec 2,5 s,
-- trois tours sans plan (« aucun ») et un plan sur un état périmé (bombe absente : chemin bouché, détour d'AnkaBot).
ATTENTE_PLAN = 6000       -- début du tour (le temps que les journaux des autres Crâs arrivent)
ATTENTE_SUITE = 3000      -- suite du tour, après un écart
-- Attente par sondes : demandes courtes (le serveur répond « attendre » tant que le journal n'a pas rattrapé le Crâ),
-- espacées de SONDE_MS, au lieu d'une longue requête bloquante (2026-10-10 à 15:08 : dès la manche 2, chaque tour clos
-- environ 0,45 s après le lancement de fightManagement, pendant l'attente du plan).
SONDE_MS = 100       -- (200 jusqu'au 2026-10-11 : plan récupéré 50 ms plus tôt en moyenne ; le serveur répond aux sondes en 1 ms)
SONDE_LONGUE_MS = 1000  -- le serveur garde chaque sonde jusqu'à ce délai et répond dès que le plan est prêt (2026-10-11)
SONDE_MAX_MS = 8000       -- après l'attente : temps laissé au calcul du plan « quand même »
-- fightManagement lancé alors que isItMyTurn() est encore faux : attendre (ms) qu'il devienne vrai avant d'abandonner.
ATTENTE_MON_TOUR = 1500
-- isItMyTurn() devenu faux : re-vérifié pendant CONFIRMER_FIN_MS avant de rendre la main (rendre la main fait passer le
-- tour ; 2026-10-11 à 14:24, tours finis 0,2 à 0,6 s après leur début pendant l'attente du plan). S'il redevient vrai,
-- le tour continue et le journal de l'IA le note.
CONFIRMER_FIN_MS = 500
-- Placement : paquet de demande de placement (noms obfusqués, à relever après une rotation d'Ankama), sinon
-- fightAction:chooseCell (le repli suffit : constaté le 2026-10-10).
PLACEMENT = { paquet = true, nom = "jxu", case = "fwkr", combattant = "fwku", essais = 8, attente = 700 }
LANCER_LE_COMBAT = false  -- engager le combat soi-même (map:fight()) quand le script est lancé dans la salle
-- Cartes où le script attend (move) : la salle de la Reine et la carte du combat, en plus de la carte courante — un script
-- chargé pendant un changement de carte (2026-10-10 à 17:47 : map:currentMapId() = 0) n'a pas de carte courante.
CARTES = { "137101312", "137101316" }
-- Pause après un sort (ms) : aucune, AnkaBot attend lui-même le résultat du lancer (consigne du joueur, 2026-10-11 ;
-- 350 ms auparavant, environ 1,5 s par tour).
DELAI_APRES_SORT = 0
-- Sort refusé par AnkaBot alors que le plan le donne lançable d'ici : délai avant de revérifier puis de le forcer (ms).
DELAI_AVANT_FORCAGE = 350
-- Sort refusé par canCastSpellOnCell alors que le Crâ est sur la case prévue par le plan : on attend un peu, on
-- revérifie, puis on le lance quand même (le serveur du jeu tranche ; un refus ne coûte rien) — refus de portée et de
-- ligne de vue seulement (AnkaBot juge parfois sur un état en retard). TROP_PRÈS aussi : au tour qui suit Tirs
-- Puissants, le serveur du jeu ôte 3 de portée minimale à chaque sort (effet 295, combat du 2026-10-10 à 14:49 :
-- Flèche de Dispersion 2 → 0, Flèche Perforante 3 → 1), ce qu'AnkaBot ne compte pas.
FORCER_SI_PREVU = true
CODES_FORCABLES = { [5] = true, [6] = true, [8] = true, [16] = true }   -- TROP_LOIN, TROP_PRÈS, LIGNE_DE_VUE, HORS_PORTÉE
ATTENTE_POSITION = 600    -- ms laissées à AnkaBot pour mettre la case à jour après un déplacement
JOURNAL_FICHIER = true    -- journal par personnage et par combat, à côté du script (ia_<personnage>_<date>.log)
-- Abandon du combat, au début du tour de chaque Crâ (consigne du joueur, 2026-10-11) : UNIQUEMENT quand un Crâ est mort.
-- La Reine au contact ne suffit plus (combat de 15:56 gagné après ses Mort en Sursis dans la colonne en manche 5).
ABANDON_SI_CRA_MORT = true
-- … seulement avant cette manche (consigne du joueur, 2026-10-11 : à partir de la manche 10, un Crâ mort ne fait plus
-- abandonner, on continue à trois). nil : à toute manche.
ABANDON_AVANT_MANCHE = 10
ABANDON_SI_REINE_AU_CONTACT = false
-- AnkaBot PC n'a pas character:giveUpFight() : message « quitter le combat » du jeu, sans champ, envoyé par le script
-- (developer:createMessageFromJson(ABANDON_PAQUET, "{}") ; nom donné par le joueur le 2026-10-11, obfusqué : à relever de
-- nouveau dans D3ProtocolSniffer après une rotation d'Ankama). nil : abandon à faire à la main.
ABANDON_PAQUET = "kjx"
-- Monstres placés autrement que dans les formations connues : placement et colonne de cette formation (consigne du
-- joueur, 2026-10-11 : le même placement des Crâs pour tous les placements de monstres). nil : pas de placement.
FORMATION_PAR_DEFAUT = "Placement 3"
-- Challenges (challengeManagement, appelé par AnkaBot avant « prêt »), d'après le script Challenge.lua du développeur
-- d'AnkaBot pour Dofus 3 (messages « …Request », champs avec majuscule). false : fonction absente, AnkaBot ne l'appelle
-- pas. (2026-10-11 : les noms Dofus 2 de la documentation, « …Message », faisaient planter l'application.)
CHALLENGES_ACTIFS = true
-- Type de bonus : 0 = XP, 1 = DROP (consigne du joueur, 2026-10-11 : toujours DROP).
CHALLENGE_BONUS = 1
-- Challenges à choisir, par ordre de priorité (consigne du joueur, 2026-10-11) : noms du jeu (fightChallenge:challengeName)
-- ou identifiants. Choix manuel slot par slot parmi les deux proposés : le premier de la liste, à défaut celui au plus
-- fort bonus DROP. Liste vide : challenges aléatoires (choisis par le jeu).
CHALLENGES_PRIORITE = { "Misanthrope", "Survivant", "Prudent", "De la même lignée", "En ligne de mire", "Partage",
  "Intouchable", "Nomade", "Pas vu pas pris" }
-- Identifiants de chaque nom (un par variante de donjon ou de niveau ; données du jeu, DofusDB 3.7 — ceux d'AnkaBot,
-- https://www.ankabot.dev/Identifiants/DofusPC/Challenges.txt) : reconnus même si le nom n'est pas lisible.
CHALLENGES_IDS = {
  ["Misanthrope"] = { 39, 119, 127, 131, 141, 156, 191, 262, 319, 338, 426, 776 },
  ["Survivant"] = { 33, 753, 756, 759, 762, 765, 768, 771, 774, 777, 780, 2098 },
  ["Prudent"] = { 40, 121, 135, 148, 150, 152, 154, 159, 258, 259, 357, 360, 361, 387, 445, 448, 454, 519, 773, 869 },
  ["De la même lignée"] = { 964 },
  ["En ligne de mire"] = { 969, 2084 },
  ["Partage"] = { 44 },
  ["Intouchable"] = { 17, 209 },
  ["Nomade"] = { 8, 129, 133, 171, 227, 247, 260, 261, 281, 349, 449, 593, 2083 },
  ["Pas vu pas pris"] = { 968 },
}
-- Messages (noms Dofus 3 du script du développeur d'AnkaBot).
CHALLENGE_MESSAGES = { bonus = "ChallengeBonusChoiceRequest", mode = "ChallengeModSelectRequest", pret = "ChallengeReadyRequest",
  proposition = "ChallengeProposalEvent", selection = "ChallengeSelectionRequest", validation = "ChallengeValidateRequest" }
-- Délai du chef avant « Choisir les challenges » (ChallengeReadyRequest), en ms : depuis Dofus 3.6, une mule qui envoie
-- son choix de bonus APRÈS le chef est déconnectée (message du développeur d'AnkaBot) ; ce délai laisse passer les mules.
CHALLENGE_DELAI_CHEF = { 1000, 2000 }

-- <<FORMATIONS>>

(function()
  local actif = nil              -- formation reconnue pour le combat en cours
  local monTour = 0
  local journal, journalChemin = {}, nil
  local acuiteManche = nil
  local debutTour = -1           -- case au début de mon tour : le combat y pose une marque (« Jeu Dangereux »)
  local refusTour = {}           -- sorts refusés pendant ce tour (« sort@case@depuis ») : le serveur ne les replanifie pas
  -- Lancer en cours (« sort@case@depuis ») et manche du tour : si fightManagement s'interrompt pendant un lancer (sort que
  -- le personnage n'a pas : 2026-10-10, Lowkey et Flèche d'Immobilisation), AnkaBot le relance dans le même tour ; ce
  -- lancer est alors écarté au lieu d'être retenté en boucle.
  local enCours, mancheTour = nil, nil
  local ACUITE_ABSOLUE = 32469
  local CODES = {
    [0] = "LANÇABLE", [1] = "TROP_DE_LANCERS", [2] = "RELANCE", [3] = "PAS_ASSEZ_DE_PA",
    [4] = "TROP_DE_LANCERS_SUR_CASE", [5] = "TROP_LOIN", [6] = "TROP_PRÈS", [7] = "PAS_EN_LIGNE",
    [8] = "LIGNE_DE_VUE", [9] = "TROP_D_INVOCATIONS", [10] = "CASE_DOIT_ÊTRE_LIBRE", [11] = "CASE_DOIT_ÊTRE_OCCUPÉE",
    [12] = "ÉTAT_REQUIS", [13] = "ÉTAT_INTERDIT", [14] = "PAS_EN_DIAGONALE", [15] = "INCONNU", [16] = "HORS_PORTÉE",
  }
  local function nomCode(c) return CODES[c] or ("code " .. tostring(c)) end
  local NOMS_ESPECES = { [3725] = "Bonbombe", [3726] = "Reine", [3746] = "Mâchassin", [3747] = "Terristocrate",
    [3748] = "Doublure", [3749] = "Bourôliste", [3750] = "Magouille" }
  local function nomEspece(e) return NOMS_ESPECES[e] or ("espèce " .. tostring(e)) end

  -- ─────────────────────────── journal ───────────────────────────

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
      local fichier = "ia_" .. nom .. "_" .. tostring(quand or "combat") .. ".log"
      journalChemin = (type(dossier) == "string" and dossier ~= "") and (dossier:gsub("[\\/]$", "") .. "\\" .. fichier) or fichier
    end
    pcall(function()
      local f = io.open(journalChemin, "w")
      if f == nil then return end
      f:write(table.concat(journal, "\n"), "\n")
      f:close()
    end)
  end

  -- ─────────────────────────── lecture du combat ───────────────────────────

  local function maCase()
    local c = -1
    pcall(function() c = fightCharacter:getCellId() end)
    return c
  end
  local function mesPA()
    local x = -1
    pcall(function() x = fightCharacter:getAP() end)
    return x
  end
  local function mesPM()
    local x = -1
    pcall(function() x = fightCharacter:getMP() end)
    return x
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
  -- Identifiants des Crâs (CRAS, écrit par la génération de ReineCombat.lua) : la mule n'est pas comptée.
  local idsCras = nil
  local function estCraId(id)
    if idsCras == nil then
      idsCras = {}
      for _, x in pairs(CRAS or {}) do if x and x ~= 0 then idsCras[x] = true end end
    end
    if next(idsCras) == nil then return true end
    return idsCras[id] == true
  end
  local function combatPerdu()
    local cras, reine = {}, nil
    for _, e in ipairs(entites()) do
      local espece = e.CreatureGenericId or 0
      if e.Team ~= true and espece == 0 and vivant(e) and estCraId(e.Id) then cras[#cras + 1] = e.CellId end
      if espece == 3726 and vivant(e) then reine = e.CellId end
    end
    if #cras > crasVus then crasVus = #cras end
    if ABANDON_SI_CRA_MORT and #cras > 0 and #cras < crasVus then
      local m = tonumber(manche())
      if ABANDON_AVANT_MANCHE == nil or m == nil or m < ABANDON_AVANT_MANCHE then
        return (crasVus - #cras) .. " Crâ(s) mort(s) sur " .. crasVus
      end
      noter("[COMBAT] " .. (crasVus - #cras) .. " Crâ(s) mort(s), manche " .. m .. " : pas d'abandon (à partir de la manche " .. ABANDON_AVANT_MANCHE .. ")")
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
    if ABANDON_PAQUET and pcall(function() developer:sendMessage(developer:createMessageFromJson(ABANDON_PAQUET, "{}")) end) then
      dire("[COMBAT] abandon envoyé (paquet « " .. ABANDON_PAQUET .. " »)")
      return
    end
    if pcall(function() character:giveUpFight() end) then return end
    if pcall(function() fightAction:giveUpFight() end) then return end
    dire("⛔ [COMBAT] le script ne sait pas abandonner (ABANDON_PAQUET à relever, giveUpFight absent) : abandonne à la main", "erreur")
  end

  -- Encore mon tour ? (2026-10-10 : des tours finis pendant l'attente du plan, et le script qui continuait.)
  local dernierVrai = nil   -- heure (os.clock) du dernier isItMyTurn() vrai
  local function lireMonTour()
    local ok, v = pcall(function() return fightCharacter:isItMyTurn() end)
    local oui = (not ok) or v == true
    if oui then pcall(function() dernierVrai = os.clock() end) end
    return oui
  end
  local function encoreMonTour()
    if lireMonTour() then return true end
    local attendu = 0
    while attendu < CONFIRMER_FIN_MS do
      pcall(function() global:delay(50) end)
      attendu = attendu + 50
      if lireMonTour() then
        dire(string.format("⚠ [IA] isItMyTurn() faux pendant %d ms puis de nouveau vrai : le tour continue", attendu), "erreur")
        return true
      end
    end
    return false
  end
  local function maintenant()
    local t = 0
    pcall(function() t = os.clock() end)
    return t
  end
  local function monId()
    local id = nil
    pcall(function() id = character:id() end)
    if id == nil then pcall(function() id = fightCharacter:getId() end) end
    return id
  end

  -- ─────────────────────────── formation ───────────────────────────

  -- Formation par défaut (FORMATION_PAR_DEFAUT, sinon la première) : placement de monstres inconnu.
  local function formationParDefaut()
    if FORMATION_PAR_DEFAUT == nil then return nil end
    for _, f in ipairs(FORMATIONS) do if f.nom == FORMATION_PAR_DEFAUT then return f end end
    return FORMATIONS[1]
  end

  -- Formation dont la signature (espèce et case de départ des monstres) correspond au placement des monstres
  -- (case → id) ; sinon la formation par défaut. Espèce inconnue (entités pas encore données) : la case seule compte.
  local function reconnaitre(defenders)
    local parId, parCase = {}, {}
    for _, e in ipairs(entites()) do
      local espece = e.CreatureGenericId or 0
      if espece ~= 0 then
        if e.Id ~= nil then parId[e.Id] = espece end
        if e.CellId ~= nil then parCase[e.CellId] = espece end
      end
    end
    local occupees, n = {}, 0
    for cell, id in pairs(defenders or {}) do
      if id ~= -1 then occupees[cell] = parId[id] or parCase[cell] or 0 n = n + 1 end
    end
    for _, s in ipairs(FORMATIONS) do
      local bons = 0
      for _, m in ipairs(s.monstres) do
        local e = occupees[m.cellule]
        if e ~= nil and (e == 0 or e == m.espece) then bons = bons + 1 end
      end
      if bons == #s.monstres and n == #s.monstres then return s end
    end
    local vus = {}
    for cell, e in pairs(occupees) do vus[#vus + 1] = tostring(e) .. "@" .. tostring(cell) end
    table.sort(vus)
    local defaut = formationParDefaut()
    if defaut then
      dire("[PLACEMENT] monstres en " .. table.concat(vus, ", ") .. " : placement inconnu, formation par défaut « " .. defaut.nom .. " »")
      return defaut
    end
    dire("⛔ [PLACEMENT] aucune formation connue pour ces monstres (" .. table.concat(vus, ", ") .. ")", "erreur")
    return nil
  end

  -- Script chargé en plein combat : la formation dont un Crâ occupe sa case de la colonne (ou de placement).
  local function reconnaitreEnCombat()
    local nom = moi()
    local ici = maCase()
    for _, s in ipairs(FORMATIONS) do
      if nom and (s.colonne[nom] == ici or s.placement[nom] == ici) then return s end
    end
    return formationParDefaut() or FORMATIONS[1]
  end

  -- ─────────────────────────── placement ───────────────────────────

  local function caseDuPlacement()
    local c = maCase()
    if c ~= nil and c >= 0 then return c end
    local id = monId()
    for _, e in ipairs(entites()) do if e.Id == id then return e.CellId end end
    return -1
  end

  local paquetVerifie = nil
  local function paquetPlacement()
    if not PLACEMENT.paquet then return false end
    if paquetVerifie ~= nil then return paquetVerifie end
    local ok = pcall(function()
      local m = developer:createMessage(PLACEMENT.nom)
      local _ = m[PLACEMENT.case]
      local _2 = m[PLACEMENT.combattant]
    end)
    paquetVerifie = ok
    if not ok then dire("[PLACEMENT] paquet « " .. PLACEMENT.nom .. " » introuvable : repli fightAction:chooseCell") end
    return ok
  end

  local function demanderCase(cell)
    if paquetPlacement() then
      local ok = pcall(function()
        local m = developer:createMessage(PLACEMENT.nom)
        m[PLACEMENT.case] = cell
        m[PLACEMENT.combattant] = monId()
        developer:sendMessage(m)
      end)
      if ok then return "paquet" end
    end
    pcall(function() fightAction:chooseCell(cell) end)
    return "chooseCell"
  end

  local function placer(cible, challengers)
    local cibles = {}
    if actif then for _, c in pairs(actif.placement) do cibles[c] = true end end
    for essai = 1, PLACEMENT.essais do
      local ici = caseDuPlacement()
      if ici == cible then
        dire("[PLACEMENT] en place sur " .. cible, "succes")
        return true
      end
      local vers = cible
      -- Case encore prise par un coéquipier après deux essais : passer UNE fois par une case libre qu'aucun Crâ ne vise.
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
    dire("⛔ [PLACEMENT] case " .. cible .. " NON obtenue (je suis en " .. tostring(fin) .. ")", "erreur")
    return false
  end

  function fightManagementPosition(challengers, defenders)
    local ok, err = pcall(function()
      journal, journalChemin, monTour, acuiteManche, crasVus = {}, nil, 0, nil, 0
      actif = reconnaitre(defenders)
      if actif == nil then return end
      local nom = moi()
      local cible = nom and actif.placement[nom]
      dire("[PLACEMENT] formation « " .. actif.nom .. " » — " .. tostring(nom) .. " → case " .. tostring(cible) ..
        " (colonne : " .. tostring(nom and actif.colonne[nom]) .. ")", "succes")
      if cible ~= nil then placer(cible, challengers) end
    end)
    if not ok then dire("⛔ [PLACEMENT] erreur : " .. tostring(err), "erreur") end
    journalEcrire()
  end

  -- ─────────────────────────── actions ───────────────────────────

  -- Case où lancer le sort : la cible prévue suivie là où elle est (le plan est calculé au début du tour ; une poussée
  -- peut différer un peu du prévu). Sort sur une case vide : la case prévue.
  local function caseVisee(a)
    if a.cible == "soi" then return maCase(), "soi" end
    if a.cible == "case" then return a.cellule, "case" end
    if a.cible == "allie" and a.id then
      for _, e in ipairs(entites()) do
        if e.Id == a.id and vivant(e) and (e.CellId or -1) >= 0 then
          if e.CellId == a.cellule then return a.cellule, "case" end
          return e.CellId, "allié déplacé : " .. a.cellule .. " → " .. e.CellId
        end
      end
      return a.cellule, "allié introuvable : case prévue"
    end
    if a.espece then
      local qui = nomEspece(a.espece)
      local visibles = {}
      for _, e in ipairs(entites()) do
        if e.CreatureGenericId == a.espece and vivant(e) and (e.CellId or -1) >= 0 then visibles[#visibles + 1] = e end
      end
      if a.id then
        for _, e in ipairs(visibles) do
          if e.Id == a.id then
            if e.CellId == a.cellule then return a.cellule, "case" end
            return e.CellId, qui .. " suivie : " .. a.cellule .. " → " .. e.CellId
          end
        end
      end
      for _, e in ipairs(visibles) do if e.CellId == a.cellule then return a.cellule, "case" end end
      return a.cellule, qui .. " introuvable : case prévue"
    end
    return a.cellule, "case"
  end

  local function pause(ms)
    if ms and ms > 0 then pcall(function() global:delay(ms) end) end
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
    elseif code ~= 0 and FORCER_SI_PREVU and CODES_FORCABLES[code] and a.depuis == maCase() then
      pause(DELAI_AVANT_FORCAGE)
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

  local function rang(chemin, c)
    for i, x in ipairs(chemin or {}) do if x == c then return i end end
    return nil
  end

  local function surCase(c)
    local t = 0
    while maCase() ~= c do
      if t >= ATTENTE_POSITION then return false end
      pause(50)
      t = t + 50
    end
    return true
  end

  local function caseParCase(chemin, jusqua)
    local i, fin = rang(chemin, maCase()), rang(chemin, jusqua)
    if i == nil or fin == nil or fin <= i then return maCase() == jusqua end
    for k = i + 1, fin do
      pcall(function() fightAction:moveToWardCell(chemin[k]) end)
      if not surCase(chemin[k]) then return false end
    end
    return true
  end

  local function versListe(p)
    if type(p) == "table" then return p end
    local out = {}
    pcall(function()
      for k = 0, p.Count - 1 do out[#out + 1] = p[k] end
    end)
    return out
  end

  -- Hors du chemin prévu : plus court chemin d'AnkaBot qui évite la marque de ma case de début de tour.
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

  -- Première case du chemin prise par un autre combattant (bombe apparue, monstre déplacé), ou nil : AnkaBot ferait un
  -- détour qui mange les PM (2026-10-10, Lamouit manche 2 : 354 → 357 au lieu de 342, sans PM).
  local function casePrise(chemin)
    local prises = {}
    for _, e in ipairs(entites()) do
      if vivant(e) and (e.CellId or -1) >= 0 and e.CellId ~= maCase() then prises[e.CellId] = e end
    end
    for i = 2, #(chemin or {}) do
      local e = prises[chemin[i]]
      if e then return chemin[i], e end
    end
    return nil
  end

  -- Déplacement : le chemin du plan (il évite les marques), coin par coin, avec repli case par case.
  local function deplacer(a)
    local avant = maCase()
    if avant == a.cellule then return true, "déjà en place" end
    local prise, qui = casePrise(a.chemin)
    if prise then
      local nomQui = (qui.CreatureGenericId or 0) > 0 and nomEspece(qui.CreatureGenericId) or tostring(qui.Id)
      return false, "case " .. prise .. " du chemin prise (" .. nomQui .. ") : pas de détour"
    end
    if a.chemin == nil or a.chemin[1] ~= avant then
      local ok = allerEnEvitant(a.cellule)
      return ok, "hors du chemin prévu (départ " .. avant .. ") : plus court chemin d'AnkaBot"
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

  -- Joue une action ; rend false sur un écart (le reste du plan ne vaut plus : on en redemande un).
  local function jouerAction(a, n)
    if a.type == "deplacer" then
      local avant = maCase()
      local ok, note = deplacer(a)
      local apres = maCase()
      if ok then
        dire("  " .. n .. ". déplacement " .. avant .. " → " .. apres .. (note and (" (" .. note .. ")") or ""))
        return true
      end
      dire("  ⚠ " .. n .. ". déplacement vers " .. a.cellule .. " : parti de " .. avant .. ", arrivé en " .. apres ..
        " (PM restants " .. mesPM() .. (note and ("; " .. note) or "") .. ")", "erreur")
      return false
    end
    local cell, pourquoi = caseVisee(a)
    -- Clé du plan (sa case, pas celle où la cible a été suivie) : le serveur écarte « sort@case du plan@depuis ».
    enCours = a.sort .. "@" .. a.cellule .. "@" .. maCase()
    local ok, code, force = lancer(a, cell)
    enCours = nil
    if ok then
      dire("  " .. n .. ". sort " .. a.sort .. " sur " .. cell .. (pourquoi ~= "case" and pourquoi ~= "soi" and (" (" .. pourquoi .. ")") or "") ..
        (force and (" — lancé malgré « " .. nomCode(code) .. " » d'AnkaBot") or ""))
      return true
    end
    -- Autorisé par AnkaBot mais refusé par le jeu : écarté sur cette case depuis n'importe où (« * ») pour le reste du
    -- tour (combat du 2026-10-11 à 13:13 : la seconde Flèche Explosive de Kemist reproposée depuis 3 cases, 3 refus,
    -- tour fini avec 6 PA) ; sinon depuis cette case seulement (portée, ligne de vue : une autre case peut convenir).
    refusTour[#refusTour + 1] = a.sort .. "@" .. a.cellule .. "@" .. (code == 0 and "*" or maCase())
    local raison = code == 0 and "autorisé mais non exécuté" or nomCode(code)
    dire("  ⚠ " .. n .. ". sort " .. a.sort .. " sur " .. cell .. " : " .. raison, "erreur")
    return false
  end

  local function jouerIA(pourquoi)
    dire("[IA] " .. pourquoi .. " — IA basique d'AnkaBot (configuration de sorts du compte)")
    if not pcall(function() fightBasic:playTurn(2) end) then dire("⛔ fightBasic:playTurn a échoué", "erreur") end
  end

  -- ─────────────────────────── plan du serveur ───────────────────────────

  local function mots(l)
    local t = {}
    for w in l:gmatch("%S+") do t[#t + 1] = w end
    return t
  end
  local function nombres(s)
    local t = {}
    for x in (s or ""):gmatch("[^,]+") do t[#t + 1] = tonumber(x) end
    return t
  end

  -- Demande le plan du tour au serveur. Rend (plan, nil) ou (nil, raison) ; plan = { actions, entete }.
  local function demanderPlan(nom, attente, sonde, derniere)
    local col = {}
    for n, c in pairs(actif and actif.colonne or {}) do col[#col + 1] = n .. "=" .. c end
    local corps = "case=" .. maCase() .. "\npa=" .. mesPA() .. "\npm=" .. mesPM() .. "\ncolonne=" .. table.concat(col, ";") ..
      "\nattente=" .. tostring(attente) .. "\nmanche=" .. tostring(manche()) .. "\nrefus=" .. table.concat(refusTour, ";") ..
      (sonde and ("\nsonde=1\nlongue=" .. tostring(SONDE_LONGUE_MS)) or "") .. (derniere and "\nderniere=1" or "")
    local url = PLAN_URL .. "?c=" .. (nom:gsub("[^%w%-_]", function(ch) return string.format("%%%02X", ch:byte()) end))
    local ok, rep = pcall(function() return developer:postRequest(url, corps, { "Content-Type" }, { "text/plain" }) end)
    if not ok or type(rep) ~= "string" or rep == "" then
      return nil, "serveur de plans injoignable (" .. PLAN_URL .. ") — lancer tools/ankabot/lancer_serveur_reine.cmd (il remplace scripts/fightlog-server.mjs)"
    end
    local plan = { actions = {}, entete = nil }
    for l in rep:gmatch("[^\r\n]+") do
      local w = mots(l)
      if w[1] == "attendre" then return nil, l:sub(10), true
      elseif w[1] == "aucun" then return nil, l:sub(7)
      elseif w[1] == "plan" then plan.entete = { note = tonumber(w[2]), degats = tonumber(w[3]), explosions = tonumber(w[4]), fin = tonumber(w[5]), ms = tonumber(w[6]), desynchro = w[7] == "desynchro" }
      elseif w[1] == "deplacer" then
        local chemin = nombres(w[2])
        plan.actions[#plan.actions + 1] = { type = "deplacer", chemin = chemin, etapes = nombres(w[3]), cellule = chemin[#chemin] }
      elseif w[1] == "suite" then
        plan.suite = table.concat(w, " ", 2)
      elseif w[1] == "sort" then
        local espece, id = tonumber(w[5]), tonumber(w[6])
        plan.actions[#plan.actions + 1] = { type = "sort", sort = tonumber(w[2]), cellule = tonumber(w[3]), cible = w[4],
          espece = (espece and espece ~= 0) and espece or nil, id = (id and id ~= 0) and id or nil, depuis = tonumber(w[7]) }
      end
    end
    if plan.entete == nil then return nil, "réponse du serveur illisible : " .. rep:sub(1, 120) end
    return plan, nil
  end

  -- Plan du tour par sondes : chaque demande reçoit tout de suite « attendre » ou le plan (calcul du serveur en
  -- arrière-plan) ; après `attenteMax` ms, demandes « dernière » (plan même si le journal est en retard), au plus
  -- SONDE_MAX_MS en tout. Rend (plan, raison, sondes, ms) ; plan nil et raison "fin de tour" si le tour a fini entre-temps.
  local function obtenirPlan(nom, attenteMax)
    local t0 = maintenant()
    local sondes = 0
    while true do
      local ecoule = math.floor((maintenant() - t0) * 1000)
      if ecoule > attenteMax + SONDE_MAX_MS then return nil, "pas de plan après " .. ecoule .. " ms", sondes, ecoule end
      sondes = sondes + 1
      local plan, raison, attendre = demanderPlan(nom, 0, true, ecoule >= attenteMax)
      ecoule = math.floor((maintenant() - t0) * 1000)
      if not attendre then return plan, raison, sondes, ecoule end
      if not encoreMonTour() then return nil, "fin de tour", sondes, ecoule end
      pause(SONDE_MS)
      if not encoreMonTour() then return nil, "fin de tour", sondes, math.floor((maintenant() - t0) * 1000) end
    end
  end

  local function decrire(a)
    if a.type == "deplacer" then return "→" .. a.cellule end
    return a.sort .. "@" .. a.cellule .. (a.espece and ("(" .. nomEspece(a.espece) .. ")") or "")
  end

  local function sansPlan(raison)
    dire("⚠ [IA] pas de plan : " .. tostring(raison), "erreur")
    if SANS_PLAN == "ia" then jouerIA("pas de plan")
    elseif SANS_PLAN == "main" then
      dire("[IA] le script s'arrête : à vous de jouer", "erreur")
      journalEcrire()
      pcall(function() global:finishScript() end)
    end
  end

  -- `debut` : case du début du tour (le tour a déjà commencé : suite d'un tour du scénario, ReineCombat.lua) ; `repli` :
  -- appelé au lieu de SANS_PLAN quand le serveur ne donne aucun plan pour le début de ce tour.
  local function jouerMonTour(debut, repli)
    -- Chaque appel est noté, avec l'heure du script : un tour passé sans cette ligne est un tour où AnkaBot n'a pas
    -- lancé fightManagement (combat du 2026-10-10 à 13:10 : 14 tours sur 52).
    local t0 = maintenant()
    noter("")
    noter(string.format("[%.3f] fightManagement lancé (manche AnkaBot %s, case %s, %s PA)", t0, tostring(manche()),
      tostring(maCase()), tostring(mesPA())))
    if not lireMonTour() then
      local attendu = 0
      while not lireMonTour() and attendu < ATTENTE_MON_TOUR do
        pause(50)
        attendu = attendu + 50
      end
      if not encoreMonTour() then
        dire("⛔ [IA] fightManagement lancé mais isItMyTurn() reste faux (" .. attendu .. " ms) : rien à jouer", "erreur")
        return
      end
      dire("[IA] isItMyTurn() devenu vrai après " .. attendu .. " ms")
    end
    local perdu = combatPerdu()
    if perdu then return abandonner(perdu) end
    local nom = moi()
    if nom == nil then return sansPlan("personnage inconnu") end
    monTour = monTour + 1
    if actif == nil then actif = reconnaitreEnCombat() end
    local m = manche()
    if mancheTour ~= nil and m == mancheTour then
      -- Relancé dans le même tour : l'appel précédent s'est interrompu (case de début et refus gardés).
      if enCours then
        dire("⚠ [IA] fightManagement relancé dans le même tour : l'appel précédent s'est arrêté sur le sort " .. enCours ..
          " (écarté pour ce tour)", "erreur")
        refusTour[#refusTour + 1] = enCours
      end
    else
      mancheTour = m
      debutTour = debut or maCase()
      refusTour = {}
    end
    enCours = nil
    noter("════ " .. nom .. " — mon tour " .. monTour .. " (manche AnkaBot " .. tostring(manche()) .. "), case " .. debutTour ..
      ", " .. mesPA() .. " PA, " .. mesPM() .. " PM ════")
    local essai, ecarts, suites = 0, 0, 0
    -- Sans PA, plus rien à lancer : pas de plan, seulement le retour sur la colonne, plus bas (combat du 2026-10-11 à
    -- 23:48 : fightManagement relancé par AnkaBot après le dernier sort de Lamouit, 11 s d'attente d'un plan à 0 PA, deux
    -- fois, le journal ne rattrapant pas ses actions).
    if mesPA() <= 0 then dire("[IA] plus de PA : retour sur la colonne sans plan") end
    while mesPA() > 0 do
      local plan, raison, sondes, attendu = obtenirPlan(nom, essai == 0 and ATTENTE_PLAN or ATTENTE_SUITE)
      if not encoreMonTour() then
        dire(string.format("⛔ [IA] tour terminé pendant l'attente du plan (%d ms après la demande, %d ms après le lancement de " ..
          "fightManagement, %d sonde(s) ; isItMyTurn() vrai pour la dernière fois %d ms après le lancement) : rien à jouer",
          attendu, math.floor((maintenant() - t0) * 1000), sondes, math.floor(((dernierVrai or t0) - t0) * 1000)), "erreur")
        return
      end
      if plan == nil then
        if essai == 0 and repli then return repli(raison) end
        -- (pas de return : le retour sur la colonne, plus bas, se fait quand même)
        sansPlan(raison)
        break
      end
      local e = plan.entete
      local resume = {}
      for _, a in ipairs(plan.actions) do resume[#resume + 1] = decrire(a) end
      dire("== [" .. nom .. "] " .. (essai > 0 and "nouveau plan" or "plan") .. " : " .. tostring(e.degats) .. " dégâts" ..
        ((e.explosions or 0) > 0 and (" + " .. e.explosions .. " explosions") or "") .. ", fin en " .. tostring(e.fin) ..
        " (serveur " .. tostring(e.ms) .. " ms, attendu " .. attendu .. " ms, " .. sondes .. " sonde(s)" .. (e.desynchro and ", journal en retard" or "") .. ") — " ..
        table.concat(resume, ", ") .. (plan.suite and " — puis suite du plan (" .. plan.suite .. ")" or ""))
      essai = essai + 1
      local ecart = false
      for i, a in ipairs(plan.actions) do
        local pv = 1
        pcall(function() pv = fightCharacter:getLifePoints() end)
        if (pv or 0) <= 0 then
          dire("  ⛔ personnage mort — fin du tour", "erreur")
          return
        end
        if not encoreMonTour() then
          dire("  ⛔ tour terminé avant l'action " .. i .. " : arrêt", "erreur")
          return
        end
        if not jouerAction(a, i) then
          ecart = true
          break
        end
      end
      if ecart then
        ecarts = ecarts + 1
        if ecarts > REPLANIFIER then
          dire("  ⛔ écarts répétés : fin du tour", "erreur")
          break
        end
      elseif plan.suite and suites < SUITES then
        -- Reine sous Brume : le tir qui la cherche est parti ; le serveur sait maintenant où elle est.
        suites = suites + 1
        dire("  ↻ suite du plan demandée (" .. plan.suite .. ")")
      else
        break
      end
      if not encoreMonTour() then
        dire("  ⛔ tour terminé : pas de nouveau plan", "erreur")
        return
      end
    end
    -- Toujours finir sur sa case de la colonne (règle de la formation), si des PM le permettent.
    local col = actif and actif.colonne[nom]
    if col and maCase() ~= col and mesPM() > 0 and encoreMonTour() then
      dire("  retour sur la colonne (" .. col .. ")")
      allerEnEvitant(col)
    end
    noter("  fin du tour en " .. maCase() .. (col and maCase() ~= col and (" ⚠ hors colonne (" .. col .. ")") or "") ..
      string.format(" — fightManagement : %d ms", math.floor((maintenant() - t0) * 1000)))
  end

  local function tourIA(debut, repli)
    local ok, err = pcall(jouerMonTour, debut, repli)
    if not ok then dire("⛔ [IA] erreur : " .. tostring(err), "erreur") end
    journalEcrire()
  end

  function fightManagement() tourIA() end

  -- Pour le script de combat (ReineCombat.lua, tools/fightlog/combat.ts) : le rejeu y garde fightManagement et appelle
  -- ce tour quand le scénario ne connaît pas la situation, ou pour finir un tour du scénario après un écart
  -- (IA_tour(case du début du tour, repli)) ; il donne aussi la formation reconnue au placement (colonne de chaque Crâ),
  -- que l'IA ne peut plus reconnaître en plein combat.
  IA_tour = tourIA
  IA_formation = function(nom)
    for _, f in ipairs(FORMATIONS) do
      if f.nom == nom then
        actif = f
        crasVus = 0   -- nouveau combat (ReineCombat : le placement est fait par le rejeu)
        return true
      end
    end
    return false
  end
  -- (ReineCombat : placement de monstres sans scénario enregistré) formation par défaut pour le mode avancé.
  IA_formationParDefaut = function()
    local f = formationParDefaut()
    if f then
      actif = f
      crasVus = 0
    end
    return f
  end

  -- ─────────────────────────── challenges ───────────────────────────

  local function envoyerMessage(nom, champs)
    local ok, err = pcall(function()
      local m = developer:createMessage(nom)
      for k, v in pairs(champs or {}) do m[k] = v end
      developer:sendMessage(m)
    end)
    if not ok then dire("⚠ [CHALLENGE] message « " .. tostring(nom) .. " » impossible : " .. tostring(err), "erreur") end
    return ok
  end
  local function nomChallenge(id)
    local n = nil
    pcall(function() n = fightChallenge:challengeName(id) end)
    return tostring(n or id)
  end
  local function attenteAleatoire(a, b)
    pcall(function() global:delay(global:random(a, b)) end)
  end

  -- Avant « prêt » (AnkaBot) : bonus DROP (CHALLENGE_BONUS) pour chaque personnage ; le chef choisit ensuite le mode des
  -- challenges (aléatoire, ou manuel d'après CHALLENGES_PRIORITE), comme le script Challenge.lua du développeur d'AnkaBot.
  if CHALLENGES_ACTIFS then function challengeManagement(challengeCount, isMule)
    local ok, err = pcall(function()
      local M = CHALLENGE_MESSAGES
      local bonus = CHALLENGE_BONUS == 1 and "DROP" or "XP"
      envoyerMessage(M.bonus, { ChallengeBonus = CHALLENGE_BONUS })
      if isMule then
        dire("[CHALLENGE] bonus " .. bonus .. " (mule)", "succes")
        return
      end
      local manuel = #CHALLENGES_PRIORITE > 0
      envoyerMessage(M.mode, { ChallengeMod = manuel and 0 or 1 })
      dire("[CHALLENGE] bonus " .. bonus .. ", challenges " .. (manuel and "choisis (priorités)" or "aléatoires"), "succes")
      if not manuel then return end
      -- (les mules doivent avoir choisi leur bonus avant : voir CHALLENGE_DELAI_CHEF)
      attenteAleatoire(CHALLENGE_DELAI_CHEF[1], CHALLENGE_DELAI_CHEF[2])
      envoyerMessage(M.pret, { ChallengeMod = 0 })
      for i = 1, (challengeCount or 0) do
        local recu = false
        pcall(function() recu = developer:suspendScriptUntil(M.proposition, "", false, 5000, true, 50) end)
        if not recu then
          dire("⚠ [CHALLENGE] aucune proposition reçue pour le slot " .. i, "erreur")
          return
        end
        local props = {}
        pcall(function()
          for index, c in ipairs(fightChallenge:getLastChallengeProposalMessage().ChallengeProposals) do
            if index > 2 then break end
            props[#props + 1] = { id = c.ChallengeId, xp = c.XpBonus, drop = c.DropBonus }
          end
        end)
        if #props == 0 then
          dire("⚠ [CHALLENGE] propositions illisibles pour le slot " .. i, "erreur")
          return
        end
        local choix = nil
        -- (entrée de la liste : identifiant, ou nom — comparé au nom du jeu et aux identifiants de CHALLENGES_IDS)
        local function correspond(entree, c)
          if type(entree) == "number" then return c.id == entree end
          if string.lower(nomChallenge(c.id)) == string.lower(entree) then return true end
          for _, id in ipairs(CHALLENGES_IDS[entree] or {}) do if id == c.id then return true end end
          return false
        end
        for _, entree in ipairs(CHALLENGES_PRIORITE) do
          for _, c in ipairs(props) do if correspond(entree, c) then choix = c break end end
          if choix then break end
        end
        if choix == nil then
          choix = props[1]
          for _, c in ipairs(props) do if (c.drop or 0) > (choix.drop or 0) then choix = c end end
        end
        local liste = {}
        for _, c in ipairs(props) do liste[#liste + 1] = nomChallenge(c.id) .. " (DROP " .. tostring(c.drop) .. " %)" end
        attenteAleatoire(500, 1000)
        envoyerMessage(M.selection, { ChallengeId = choix.id })
        attenteAleatoire(500, 1000)
        envoyerMessage(M.validation, { ChallengeId = choix.id })
        dire("[CHALLENGE] slot " .. i .. " : " .. nomChallenge(choix.id) .. " — proposés : " .. table.concat(liste, ", "), "succes")
      end
      attenteAleatoire(1000, 2000)
    end)
    if not ok then dire("⛔ [CHALLENGE] erreur : " .. tostring(err), "erreur") end
  end end

  -- ─────────────────────────── hors combat ───────────────────────────

  local function attendre()
    if LANCER_LE_COMBAT then pcall(function() map:fight() end) end
    pcall(function() global:delay(2000) end)
  end

  function move()
    local carte = nil
    pcall(function() carte = map:currentMapId() end)
    local out, vues = {}, {}
    local function ajouter(m)
      if m and m ~= "0" and m ~= "nil" and not vues[m] then
        vues[m] = true
        out[#out + 1] = { map = m, custom = attendre }
      end
    end
    ajouter(tostring(carte))
    for _, m in ipairs(CARTES) do ajouter(m) end
    return out
  end

  local noms = {}
  for _, s in ipairs(FORMATIONS) do noms[#noms + 1] = s.nom end
  dire("[IA] Reine des Voleurs chargée : " .. #FORMATIONS .. " formation(s) (" .. table.concat(noms, ", ") .. "), plans de " .. PLAN_URL)
end)()
