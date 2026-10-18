-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
--  IA DU VENTRE DE LA BALEINE (serveur de plans). Partie ajoutée au journal ci-dessus par
--  tools/ventre-de-la-baleine/script.ts (modèle : tools/ventre-de-la-baleine/modele-baleine.lua, adapté de
--  tools/fightlog/modele-ia.lua, la Reine) ; FICHIER GÉNÉRÉ : régénérer plutôt qu'éditer.
--
--  Pour chaque Crâ du groupe (chargé sur le chef, AnkaBot le charge aussi sur les mules) :
--    - le JOURNAL ci-dessus envoie tous les messages du combat au serveur : c'est ce qui lui donne l'état exact ;
--    - PLACEMENT (fightManagementPosition) : envoie au serveur la position des monstres et nos cases de placement
--      (POST /placement) et se met sur la case qu'il répond (paquet de placement, sinon fightAction:chooseCell) ;
--    - COMBAT (fightManagement, à chaque tour) : demande son tour au serveur (POST /plan : sa case, ses PA, ses PM, la
--      carte), puis l'exécute — déplacements, sorts, case de fin — par les méthodes d'AnkaBot. Un écart (sort refusé,
--      déplacement arrêté en route) : nouveau plan demandé depuis l'état atteint (REPLANIFIER fois au plus). Serveur
--      absent ou sans plan : SANS_PLAN.
--
--  Avant le combat : lancer le serveur (tools/ankabot/lancer_serveur_baleine.cmd, ou
--    npx tsx tools/ventre-de-la-baleine/serveur.ts) et le laisser ouvert ; il remplace scripts/fightlog-server.mjs.
--  Configuration de combat de chaque compte : IA avancée « dans le même script ».
--  Il faut les QUATRE journaux : pendant son propre tour, le script d'un Crâ est occupé et ne journalise pas.
--
--  Même modèle pour le Féca seul du Roc des Salbatroces (tools/feca/script.ts : ENVOYER_ETAT = true, réglages
--  ci-dessous remplacés) : aucun autre journal ne couvre son tour, il envoie l'état visible avec chaque demande de plan.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- Paramètre AnkaBot : pas un combat à vagues (les Krobes ne meurent qu'à la fin de leur compte à rebours).
IS_WAVE_FIGHT = false
PLAN_URL = "http://127.0.0.1:8765/plan"            -- serveur de plans (même port que le récepteur du journal)
PLACEMENT_URL = "http://127.0.0.1:8765/placement"  -- case de placement de chaque Crâ
-- Serveur absent, ou aucun plan : "passer" (ne rien faire), "ia" (IA basique d'AnkaBot, fightBasic:playTurn : attention,
-- elle peut soigner ou pousser la Virustine) ou "main" (arrêter le script : le joueur finit le combat à la main).
SANS_PLAN = "passer"
REPLANIFIER = 2           -- nouveaux plans demandés au plus dans un même tour, après un écart (0 : aucun)
ATTENTE_PLAN = 6000       -- attente du plan au début du tour (ms : le temps que les journaux des autres Crâs arrivent)
ATTENTE_SUITE = 3000      -- suite du tour, après un écart
SONDE_MS = 100            -- pause entre deux sondes
SONDE_LONGUE_MS = 1000    -- le serveur garde chaque sonde jusqu'à ce délai et répond dès que le plan est prêt
SONDE_MAX_MS = 8000       -- après l'attente : temps laissé au calcul du plan « quand même »
-- (2026-10-17, retirés le soir : attentes autour de isItMyTurn(), main gardée jusqu'au tour suivant, pause après un
-- déplacement final, messages remis de force au journal, main rendue d'après le journal — aucun n'a fait ses preuves,
-- plusieurs ont fait perdre des tours. Début de tour : isItMyTurn() faux → main rendue, sinon on joue.)
-- Personnages qui jouent (nom → true) ; nil : tous. Les autres personnages du groupe (AnkaBot charge le script sur les
-- mules) sont des mules : case de placement demandée au serveur (groupées, pour que le Féca les tue d'un sort de zone),
-- tours passés.
JOUEURS = nil
-- Mules : à chacun de leurs tours, vers le Krobe le plus proche, pour s'y faire tuer (false : elles restent en place).
MULES_AVANCENT = false
-- Tueuses (nom → true) : jouées par le serveur, mais placées avec les mules (elles les tuent, puis vont mourir).
TUEUSES = nil
-- Joués à la main (nom → true) : le script ne place pas ces personnages et ne joue pas leurs tours. Il garde la main
-- jusqu'au début du combat, puis jusqu'à la fin de chacun de leurs tours (AnkaBot les mettrait prêts, ou finirait le tour,
-- à son retour) ; il note le plan que le serveur aurait joué (A_LA_MAIN_PLAN), et le journal enregistre tout.
A_LA_MAIN = nil
A_LA_MAIN_PLAN = true
A_LA_MAIN_MAX_MS = 120000 -- main gardée au plus ce délai, au placement comme à chaque tour
A_LA_MAIN_FIN_MS = 1500   -- isItMyTurn() faux pendant ce délai de suite : tour fini (il clignote parfois quelques centaines de ms)
-- false : isItMyTurn() n'est jamais appelé, le tour est tenu pour le mien du lancement de fightManagement jusqu'à la fin du
-- plan (essai du joueur, 2026-10-18 : tours sautés quand AnkaBot lance fightManagement avant mon tour).
VERIFIER_MON_TOUR = true
-- Plan rapide (nom → true) : le premier plan du tour est demandé « rapide » au serveur (quelques centaines de ms), son
-- premier pas est joué aussitôt, puis le plan complet donne la suite du tour (essai du joueur, 2026-10-18 : tours du Féca
-- fermés 0,7 à 2,3 s après leur début, pendant l'attente du plan ; la Reine joue ses tours appris tout de suite).
PLAN_RAPIDE = nil
CONFIRMER_FIN_MS = 500   -- isItMyTurn() devenu faux : re-vérifié pendant ce délai avant de rendre la main
-- isItMyTurn() devenu faux avant la première action : fightManagement lancé avant mon vrai tour (2026-10-18 à 01:40 et
-- 01:51, pendant le tour de la Virustine qui joue avant la Malamibe et le Féca). Rendre la main faisait finir par AnkaBot
-- mon vrai tour, commencé entre-temps : on attend qu'il commence (au plus ce délai), puis le plan est redemandé.
ATTENTE_VRAI_TOUR_MS = 8000
-- Placement : paquet de demande de placement (noms obfusqués, à relever après une rotation d'Ankama), sinon
-- fightAction:chooseCell.
PLACEMENT = { paquet = true, nom = "jxu", case = "fwkr", combattant = "fwku", essais = 8, attente = 700 }
-- Placement : délai avant la demande au serveur (ms), le temps que les monstres soient connus d'AnkaBot.
ATTENTE_PLACEMENT = 600
LANCER_LE_COMBAT = false  -- engager le combat soi-même (map:fight()) quand le script est lancé dans la salle
-- Cartes où le script attend (move) : salles du donjon et cartes de leurs combats (relevées en jeu).
CARTES = { "140771328", "140771332", "140772352", "140772356", "140773376", "140773380", "140774400", "140774404",
  "140775424", "140775428", "140776448" }
-- Trajet (move, comme modele-rejeu.lua de la Reine) : entrées jouées avant les cartes d'attente, ex. { map = "…", path =
-- "left" } ou { map = "…", custom = fonction } ; nil : aucun. Le script du Féca y met le trajet jusqu'au Roc.
TRAJET = nil
-- Circuit (move) : liste ordonnée parcourue en boucle, une même carte pouvant y revenir avec une autre action (comme les
-- scripts circulaires de Road Creator, de Pharwell) ; prioritaire sur TRAJET et CARTES pour ses cartes ; nil : aucun.
CIRCUIT = nil
DELAI_APRES_SORT = 0
DELAI_AVANT_FORCAGE = 350
-- Sort refusé par canCastSpellOnCell alors que le Crâ est sur la case prévue par le plan : revérifié puis lancé quand
-- même (portée, ligne de vue : AnkaBot juge parfois sur un état en retard ; Tirs Puissants : −3 PO minimale non comptée ;
-- en ligne / en diagonale : Tir de Repli, lançable en ligne OU en diagonale, refusé en diagonale par AnkaBot le
-- 2026-10-14). Si le jeu refuse vraiment, le sort n'est pas lancé et un nouveau plan est demandé.
FORCER_SI_PREVU = true
-- TROP_LOIN, TROP_PRÈS, PAS_EN_LIGNE, LIGNE_DE_VUE, PAS_EN_DIAGONALE, HORS_PORTÉE
CODES_FORCABLES = { [5] = true, [6] = true, [7] = true, [8] = true, [14] = true, [16] = true }
ATTENTE_POSITION = 600    -- ms laissées à AnkaBot pour mettre la case à jour après un déplacement
JOURNAL_FICHIER = true    -- journal par personnage et par combat, à côté du script (ia_<personnage>_<date>.log)
-- Personnage seul : chaque demande de plan envoie l'état visible du combat (entités : case, PV, PA, PM, espèce) et les
-- sorts lancés depuis le début du combat (le journal se tait pendant son tour, et aucun autre ne le couvre).
ENVOYER_ETAT = false
NOM_IA = "Ventre de la Baleine"
SCRIPT_GENERE = nil  -- fichier et date de génération du script : noté au début du journal de chaque combat
-- Tours passés : messages lus (noms obfusqués du 2026-10-09, comme tools/reine-des-voleurs/planificateur/journal.ts) —
-- action de combat (jsq : auteur fwuw, sort lancé fwuy, son identifiant en fwuy.fwqu.fwpu) et déplacement (jnz :
-- combattant fwaf). Début et fin de tour : TURN_START et TURN_END du journal.
PASSE_TOUR = { action = "jsq", auteur = "fwuw", sort = "fwuy", lancer = "fwqu", sortId = "fwpu", mouvement = "jnz", qui = "fwaf" }
PREFIXE_JOURNAL = "ia_baleine_"
LANCEUR = "tools/ankabot/lancer_serveur_baleine.cmd"

(function()
  local monTour = 0
  local journal, journalChemin = {}, nil
  local acuiteManche = nil
  local debutTour = -1
  local refusTour = {}
  local enCours, mancheTour = nil, nil
  -- Sorts lancés depuis le début du combat (« sort:tour:case:cible », tour : 1 au premier tour du personnage, +1 à chaque
  -- manche ; cible : identifiant de jeu de l'entité visée, 0 pour une case), envoyés avec l'état visible (ENVOYER_ETAT).
  local lances, tourCombat = {}, 0
  local ACUITE_ABSOLUE = 32469
  local CODES = {
    [0] = "LANÇABLE", [1] = "TROP_DE_LANCERS", [2] = "RELANCE", [3] = "PAS_ASSEZ_DE_PA",
    [4] = "TROP_DE_LANCERS_SUR_CASE", [5] = "TROP_LOIN", [6] = "TROP_PRÈS", [7] = "PAS_EN_LIGNE",
    [8] = "LIGNE_DE_VUE", [9] = "TROP_D_INVOCATIONS", [10] = "CASE_DOIT_ÊTRE_LIBRE", [11] = "CASE_DOIT_ÊTRE_OCCUPÉE",
    [12] = "ÉTAT_REQUIS", [13] = "ÉTAT_INTERDIT", [14] = "PAS_EN_DIAGONALE", [15] = "INCONNU", [16] = "HORS_PORTÉE",
  }
  local function nomCode(c) return CODES[c] or ("code " .. tostring(c)) end
  local NOMS_ESPECES = { [3822] = "Malamibe", [3823] = "Tabacille", [3824] = "Verminocule", [3825] = "Bacterrib",
    [3826] = "Virustine", [3827] = "Pataugerme", [3828] = "Protozorreur", [5212] = "Nécrobacterrib",
    [5213] = "Nécrotabacille", [5214] = "Nécroverminocule", [5215] = "Nécrovirustine" }
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
      local fichier = PREFIXE_JOURNAL .. nom .. "_" .. tostring(quand or "combat") .. ".log"
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
  local function carte()
    local m = nil
    pcall(function() m = map:currentMapId() end)
    return m
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

  -- Tours passés (2026-10-18) : tour du personnage fini sans sort ni déplacement de sa part, noté dans son journal et
  -- affiché dans AnkaBot (global:printMessage), avec le combattant qui a joué juste avant lui (espèce, sorts lancés,
  -- déplacement) : le tour fermé par AnkaBot suit presque toujours un tour ennemi instantané (Malamibe, Virustine qui ne
  -- fait rien). Vu par le journal (JOURNAL_ON_MESSAGE) à l'arrivée de chaque message.
  local tourEnCours, tourPrecedent = nil, nil
  local function champ(m, k)
    local v = nil
    pcall(function() v = m[k] end)
    return v
  end
  local function nomCombattant(id)
    local txt = string.format("%.0f", tonumber(id) or 0)
    for _, e in ipairs(entites()) do
      if e.Id == id then
        local esp = e.CreatureGenericId or 0
        return (esp ~= 0 and nomEspece(esp) or "allié") .. " " .. txt
      end
    end
    return "combattant " .. txt
  end
  JOURNAL_ON_MESSAGE = function(name, message)
    if name == TURN_START then
      tourPrecedent = tourEnCours
      tourEnCours = { id = champ(message, TURN_START_FIELD), sorts = 0, ids = {}, deplace = false, manche = manche() }
    elseif tourEnCours == nil then
      return
    elseif name == PASSE_TOUR.action then
      local s = champ(message, PASSE_TOUR.sort)
      if s ~= nil and champ(message, PASSE_TOUR.auteur) == tourEnCours.id then
        tourEnCours.sorts = tourEnCours.sorts + 1
        local l = champ(s, PASSE_TOUR.lancer)
        local sid = l ~= nil and champ(l, PASSE_TOUR.sortId) or nil
        if sid ~= nil and #tourEnCours.ids < 8 then tourEnCours.ids[#tourEnCours.ids + 1] = string.format("%.0f", sid) end
      end
    elseif name == PASSE_TOUR.mouvement then
      if champ(message, PASSE_TOUR.qui) == tourEnCours.id then tourEnCours.deplace = true end
    elseif name == TURN_END then
      local moiId = nil
      pcall(function() moiId = character:id() end)
      local id = champ(message, TURN_END_FIELD)
      if moiId ~= nil and id == moiId and tourEnCours.id == moiId and tourEnCours.sorts == 0 and not tourEnCours.deplace then
        local p = tourPrecedent
        local avant = p == nil and "inconnu" or (nomCombattant(p.id) .. " (" .. (p.sorts > 0 and (p.sorts .. " sort(s) : " ..
          table.concat(p.ids, ", ")) or "aucun sort") .. " ; " .. (p.deplace and "déplacé" or "pas de déplacement") .. ")")
        local texte = "[TOUR PASSÉ] " .. tostring(moi()) .. ", manche " .. tostring(tourEnCours.manche) ..
          " : tour fini sans sort ni déplacement ; a joué juste avant : " .. avant
        noter(texte)
        pcall(function() global:printMessage(texte) end)
        journalEcrire()
      end
    end
  end

  local dernierVrai = nil
  local function lireMonTour()
    if not VERIFIER_MON_TOUR then return true end
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
  local function pause(ms)
    if ms and ms > 0 then pcall(function() global:delay(ms) end) end
  end
  local function urlDe(base, nom)
    return base .. "?c=" .. (nom:gsub("[^%w%-_]", function(ch) return string.format("%%%02X", ch:byte()) end))
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

  -- `cibles` : cases données à tous les Crâs (case → true) ; le détour ne passe pas par l'une d'elles.
  local function placer(cible, challengers, cibles)
    cibles = cibles or {}
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
          if id == -1 and not cibles[cell] and cell ~= ici and cell ~= cible then
            vers = cell
            break
          end
        end
      end
      local par = demanderCase(vers)
      noter("[PLACEMENT] demande " .. essai .. " : " .. tostring(ici) .. " → " .. vers .. " (" .. par .. ")")
      pause(PLACEMENT.attente)
    end
    local fin = caseDuPlacement()
    if fin == cible then
      dire("[PLACEMENT] en place sur " .. cible, "succes")
      return true
    end
    dire("⛔ [PLACEMENT] case " .. cible .. " NON obtenue (je suis en " .. tostring(fin) .. ")", "erreur")
    return false
  end

  -- Monstres (espèce@case) et nos cases de placement, envoyés au serveur ; il répond « case <la mienne> <celles des
  -- 4 Crâs> ».
  local function estMule(nom)
    return JOUEURS ~= nil and nom ~= nil and not JOUEURS[nom]
  end
  -- Placée avec les mules : une mule, ou une tueuse.
  local function placeeAvecLesMules(nom)
    return estMule(nom) or (TUEUSES ~= nil and nom ~= nil and TUEUSES[nom] == true)
  end
  local function aLaMain(nom)
    return A_LA_MAIN ~= nil and nom ~= nil and A_LA_MAIN[nom] == true
  end

  -- Placement à la main : main gardée jusqu'au début du combat, vu au changement de fightAction:getCurrentTurn() ou à mon
  -- premier tour (aucune méthode d'AnkaBot ne dit si le placement est fini).
  local function placementALaMain(nom)
    local t0 = maintenant()
    local m0 = manche()
    dire("[MAIN] " .. nom .. " : place-toi puis mets-toi prêt (le script attend le début du combat)", "succes")
    local pourquoi = "délai"
    while (maintenant() - t0) * 1000 < A_LA_MAIN_MAX_MS do
      pause(250)
      -- (VERIFIER_MON_TOUR = false : isItMyTurn() jamais appelé, même ici)
      local ok, v = false, nil
      if VERIFIER_MON_TOUR then ok, v = pcall(function() return fightCharacter:isItMyTurn() end) end
      if ok and v == true then pourquoi = "mon tour" break end
      if manche() ~= m0 then pourquoi = "manche" break end
    end
    noter(string.format("[PLACEMENT] à la main : case %s ; début vu (%s) après %d ms, manche AnkaBot %s → %s", tostring(maCase()),
      pourquoi, math.floor((maintenant() - t0) * 1000), tostring(m0), tostring(manche())))
  end

  local function demanderPlacement(nom, challengers, defenders)
    local parId, parCase = {}, {}
    for _, e in ipairs(entites()) do
      local espece = e.CreatureGenericId or 0
      if espece ~= 0 then
        if e.Id ~= nil then parId[e.Id] = espece end
        if e.CellId ~= nil then parCase[e.CellId] = espece end
      end
    end
    local monstres = {}
    for cell, id in pairs(defenders or {}) do
      if id ~= -1 then
        local espece = parId[id] or parCase[cell] or 0
        monstres[#monstres + 1] = tostring(espece) .. "@" .. tostring(cell)
      end
    end
    local cases = {}
    for cell, _ in pairs(challengers or {}) do cases[#cases + 1] = tostring(cell) end
    table.sort(monstres)
    table.sort(cases)
    local corps = "carte=" .. tostring(carte()) .. "\nmonstres=" .. table.concat(monstres, ";") .. "\ncases=" .. table.concat(cases, ",") ..
      (placeeAvecLesMules(nom) and "\nmule=1" or "")
    local ok, rep = pcall(function() return developer:postRequest(urlDe(PLACEMENT_URL, nom), corps, { "Content-Type" }, { "text/plain" }) end)
    if not ok or type(rep) ~= "string" or rep == "" then return nil, "serveur injoignable (" .. PLACEMENT_URL .. ")", corps end
    local c, toutes = rep:match("^case%s+(%d+)%s*([%d,]*)")
    if c then
      local cibles = {}
      for x in (toutes or ""):gmatch("%d+") do cibles[tonumber(x)] = true end
      return tonumber(c), nil, corps, cibles
    end
    return nil, rep:sub(1, 120), corps
  end

  function fightManagementPosition(challengers, defenders)
    local ok, err = pcall(function()
      journal, journalChemin, monTour, acuiteManche = {}, nil, 0, nil
      if SCRIPT_GENERE then noter("[SCRIPT] " .. SCRIPT_GENERE) end
      lances, mancheTour, tourCombat = {}, nil, 0
      local nom = moi()
      if nom == nil then return end
      if aLaMain(nom) then return placementALaMain(nom) end
      -- (mule : après le Féca, dont la case est gardée)
      pause(ATTENTE_PLACEMENT + (placeeAvecLesMules(nom) and 1500 or 0))
      local cible, raison, corps, cibles = demanderPlacement(nom, challengers, defenders)
      noter("[PLACEMENT] demande : " .. tostring(corps))
      if cible == nil then
        dire("⛔ [PLACEMENT] pas de case du serveur (" .. tostring(raison) .. ") : place-toi à la main", "erreur")
        return
      end
      dire("[PLACEMENT] " .. (estMule(nom) and "mule " or placeeAvecLesMules(nom) and "tueuse " or "") .. nom .. " → case " .. cible .. " (serveur)", "succes")
      placer(cible, challengers, cibles)
    end)
    if not ok then dire("⛔ [PLACEMENT] erreur : " .. tostring(err), "erreur") end
    journalEcrire()
  end

  -- ─────────────────────────── actions ───────────────────────────

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
      -- (allié visé introuvable : mort, une mule tuée par le sort d'avant ; 2026-10-18 à 12:37, Bulle lancée sur la case vide
      -- de Kimera-Pitou, 2 PA perdus pour la Malamibe : sort non lancé, plan redemandé)
      return nil, "allié introuvable (mort ?) : sort non lancé"
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
            return e.CellId, qui .. " suivi : " .. a.cellule .. " → " .. e.CellId
          end
        end
      end
      for _, e in ipairs(visibles) do if e.CellId == a.cellule then return a.cellule, "case" end end
      return a.cellule, qui .. " introuvable : case prévue"
    end
    return a.cellule, "case"
  end

  local function verifier(sort, cell)
    local code = -1
    pcall(function() code = fightAction:canCastSpellOnCell(maCase(), sort, cell) end)
    return code
  end

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

  local function allerVers(cible)
    local chemin = nil
    pcall(function() chemin = versListe(fightAction:getShortestPath(maCase(), cible, {})) end)
    if type(chemin) == "table" and #chemin > 0 then
      if chemin[1] ~= maCase() then table.insert(chemin, 1, maCase()) end
      if caseParCase(chemin, cible) then return true end
    end
    if maCase() ~= cible then pcall(function() fightAction:moveToWardCell(cible) end) end
    return surCase(cible)
  end

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

  local function deplacer(a)
    local avant = maCase()
    if avant == a.cellule then return true, "déjà en place" end
    local prise, qui = casePrise(a.chemin)
    if prise then
      local nomQui = (qui.CreatureGenericId or 0) > 0 and nomEspece(qui.CreatureGenericId) or tostring(qui.Id)
      return false, "case " .. prise .. " du chemin prise (" .. nomQui .. ") : pas de détour"
    end
    if a.chemin == nil or a.chemin[1] ~= avant then
      local ok = allerVers(a.cellule)
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
    if cell == nil then
      refusTour[#refusTour + 1] = a.sort .. "@" .. a.cellule .. "@*"
      dire("  ⚠ " .. n .. ". sort " .. a.sort .. " sur " .. a.cellule .. " : " .. pourquoi, "erreur")
      return false
    end
    enCours = a.sort .. "@" .. a.cellule .. "@" .. maCase()
    local ok, code, force = lancer(a, cell)
    enCours = nil
    if ok then
      lances[#lances + 1] = tostring(a.sort) .. ":" .. tostring(tourCombat) .. ":" .. tostring(cell) .. ":" ..
        string.format("%.0f", tonumber(a.id) or 0)
      dire("  " .. n .. ". sort " .. a.sort .. " sur " .. cell .. (pourquoi ~= "case" and pourquoi ~= "soi" and (" (" .. pourquoi .. ")") or "") ..
        (force and (" — lancé malgré « " .. nomCode(code) .. " » d'AnkaBot") or ""))
      return true
    end
    -- (refus pour un état, ÉTAT_REQUIS ou ÉTAT_INTERDIT : le sort est écarté pour tout le tour, sur toutes les cases ;
    -- 2026-10-18 à 03:15, Transhumance refusée trois fois sous la Pesanteur de Bergerie, tour 2 perdu)
    if code == 12 or code == 13 then refusTour[#refusTour + 1] = a.sort .. "@*@*"
    else refusTour[#refusTour + 1] = a.sort .. "@" .. a.cellule .. "@" .. (code == 0 and "*" or maCase()) end
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

  -- État visible (ENVOYER_ETAT) : « id:case:PV:PV max:PA:PM:espèce » par entité, puis les sorts lancés et mon tour.
  local function nombre(x) return string.format("%.0f", tonumber(x) or -1) end
  local function etatVisible()
    local l = {}
    for _, e in ipairs(entites()) do
      if e.Id ~= nil then
        l[#l + 1] = table.concat({ nombre(e.Id), nombre(e.CellId), nombre(e.LifePoints or 0), nombre(e.MaxLifePoints or 0),
          nombre(e.AP), nombre(e.MP), nombre(e.CreatureGenericId or 0) }, ":")
      end
    end
    return "\nentites=" .. table.concat(l, ";") .. "\nlances=" .. table.concat(lances, ";") .. "\ntour=" .. tostring(tourCombat)
  end

  local function demanderPlan(nom, attente, sonde, derniere, rapide)
    local corps = "case=" .. maCase() .. "\npa=" .. mesPA() .. "\npm=" .. mesPM() .. "\ncarte=" .. tostring(carte()) ..
      "\nattente=" .. tostring(attente) .. "\nmanche=" .. tostring(manche()) .. "\nrefus=" .. table.concat(refusTour, ";") ..
      (sonde and ("\nsonde=1\nlongue=" .. tostring(SONDE_LONGUE_MS)) or "") .. (derniere and "\nderniere=1" or "") ..
      (rapide and "\nrapide=1" or "") ..
      (ENVOYER_ETAT and etatVisible() or "")
    local ok, rep = pcall(function() return developer:postRequest(urlDe(PLAN_URL, nom), corps, { "Content-Type" }, { "text/plain" }) end)
    if not ok or type(rep) ~= "string" or rep == "" then
      return nil, "serveur de plans injoignable (" .. PLAN_URL .. ") — lancer " .. LANCEUR
    end
    local plan = { actions = {}, entete = nil }
    for l in rep:gmatch("[^\r\n]+") do
      local w = mots(l)
      if w[1] == "attendre" then return nil, l:sub(10), true
      elseif w[1] == "aucun" then return nil, l:sub(7)
      elseif w[1] == "plan" then plan.entete = { note = tonumber(w[2]), malamibe = tonumber(w[3]), fin = tonumber(w[5]), ms = tonumber(w[6]), desynchro = w[7] == "desynchro" }
      elseif w[1] == "deplacer" then
        local chemin = nombres(w[2])
        plan.actions[#plan.actions + 1] = { type = "deplacer", chemin = chemin, etapes = nombres(w[3]), cellule = chemin[#chemin] }
      elseif w[1] == "sort" then
        local espece, id = tonumber(w[5]), tonumber(w[6])
        plan.actions[#plan.actions + 1] = { type = "sort", sort = tonumber(w[2]), cellule = tonumber(w[3]), cible = w[4],
          espece = (espece and espece ~= 0) and espece or nil, id = (id and id ~= 0) and id or nil, depuis = tonumber(w[7]) }
      end
    end
    if plan.entete == nil then return nil, "réponse du serveur illisible : " .. rep:sub(1, 120) end
    return plan, nil
  end

  local function obtenirPlan(nom, attenteMax, rapide)
    local t0 = maintenant()
    local sondes = 0
    while true do
      local ecoule = math.floor((maintenant() - t0) * 1000)
      if ecoule > attenteMax + SONDE_MAX_MS then return nil, "pas de plan après " .. ecoule .. " ms", sondes, ecoule end
      sondes = sondes + 1
      local plan, raison, attendre = demanderPlan(nom, 0, true, ecoule >= attenteMax, rapide)
      ecoule = math.floor((maintenant() - t0) * 1000)
      if not attendre then return plan, raison, sondes, ecoule end
      if not encoreMonTour() then return nil, "fin de tour", sondes, ecoule end
      pause(SONDE_MS)
      if not encoreMonTour() then return nil, "fin de tour", sondes, math.floor((maintenant() - t0) * 1000) end
    end
  end

  local function attendreMonTour(ms)
    local t0 = maintenant()
    while (maintenant() - t0) * 1000 < ms do
      pause(100)
      if lireMonTour() then return true, math.floor((maintenant() - t0) * 1000) end
    end
    return false, ms
  end

  -- Plan du début du tour : si isItMyTurn() devient faux avant toute action (ATTENTE_VRAI_TOUR_MS), attendre le vrai tour
  -- et redemander le plan sur l'état de ce moment-là (l'état visible d'AnkaBot est à jour, le journal non).
  local function planDuDebut(nom, rapide)
    local plan, raison, sondes, attendu = obtenirPlan(nom, ATTENTE_PLAN, rapide)
    if encoreMonTour() then return plan, raison, sondes, attendu end
    local vrai, ms = attendreMonTour(ATTENTE_VRAI_TOUR_MS)
    if not vrai then return plan, raison, sondes, attendu end
    dire(string.format("⚠ [IA] fightManagement lancé avant mon tour (isItMyTurn() faux, vrai %d ms plus tard) : plan redemandé", ms), "erreur")
    debutTour, refusTour = maCase(), {}
    if JOURNAL_FLUSH_NOW then pcall(JOURNAL_FLUSH_NOW) end
    return obtenirPlan(nom, ATTENTE_PLAN, rapide)
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

  local function jouerMonTour()
    local t0 = maintenant()
    noter("")
    noter(string.format("[%.3f] fightManagement lancé (manche AnkaBot %s, case %s, %s PA)%s", t0, tostring(manche()),
      tostring(maCase()), tostring(mesPA()), VERIFIER_MON_TOUR and "" or " — isItMyTurn() non vérifié"))
    -- Pas mon tour (AnkaBot lance aussi fightManagement au tour des invocations contrôlables) : rien à jouer, tout de suite.
    if not lireMonTour() then
      noter("  isItMyTurn() faux : main rendue")
      journalEcrire()
      return
    end
    -- (écrit tout de suite : un tour coupé avant sa fin, par la mort ou la fin du combat, laissait le journal sans trace)
    journalEcrire()
    -- Journal : ce qu'il a reçu part maintenant (requête bloquante : le serveur l'a en main au retour). Sans attente : il
    -- manque au plus les derniers messages, que l'état visible envoyé avec la demande de plan couvre (cases, PV, PA, PM).
    if JOURNAL_FLUSH_NOW then pcall(JOURNAL_FLUSH_NOW) end
    local nom = moi()
    if nom == nil then return sansPlan("personnage inconnu") end
    monTour = monTour + 1
    local m = manche()
    if mancheTour ~= nil and m == mancheTour then
      if enCours then
        dire("⚠ [IA] fightManagement relancé dans le même tour : l'appel précédent s'est arrêté sur le sort " .. enCours ..
          " (écarté pour ce tour)", "erreur")
        refusTour[#refusTour + 1] = enCours
      end
    else
      -- (manche qui recule : nouveau combat sans phase de placement vue)
      if mancheTour ~= nil and m ~= nil and m < mancheTour then lances, tourCombat = {}, 0 end
      mancheTour = m
      debutTour = maCase()
      refusTour = {}
      tourCombat = tourCombat + 1
    end
    enCours = nil
    noter("════ " .. nom .. " — mon tour " .. monTour .. " (manche AnkaBot " .. tostring(manche()) .. "), case " .. debutTour ..
      ", " .. mesPA() .. " PA, " .. mesPM() .. " PM ════")
    local essai, ecarts = 0, 0
    local rapideCeTour = PLAN_RAPIDE ~= nil and PLAN_RAPIDE[nom] == true
    while mesPA() > 0 or mesPM() > 0 do
      local plan, raison, sondes, attendu
      local rapide = rapideCeTour and essai == 0
      if essai == 0 then plan, raison, sondes, attendu = planDuDebut(nom, rapide)
      -- (suite d'un plan rapide : plan complet tout de suite, sans attendre le journal)
      elseif rapideCeTour and essai == 1 then plan, raison, sondes, attendu = obtenirPlan(nom, ATTENTE_PLAN)
      else plan, raison, sondes, attendu = obtenirPlan(nom, ATTENTE_SUITE) end
      if not encoreMonTour() then
        dire(string.format("⛔ [IA] tour terminé pendant l'attente du plan (%d ms, %d sonde(s)) : rien à jouer", attendu, sondes), "erreur")
        return
      end
      if plan == nil then
        sansPlan(raison)
        break
      end
      local e = plan.entete
      local resume = {}
      for _, a in ipairs(plan.actions) do resume[#resume + 1] = decrire(a) end
      dire("== [" .. nom .. "] " .. (rapide and "plan rapide (1er pas seulement)" or essai > 0 and "nouveau plan" or "plan") .. " (note " .. tostring(e.note) .. ", Malamibe " ..
        tostring(e.malamibe) .. ", fin en " .. tostring(e.fin) .. ", serveur " .. tostring(e.ms) .. " ms, " .. sondes .. " sonde(s)" ..
        (e.desynchro and ", journal en retard" or "") .. ") — " .. (#resume > 0 and table.concat(resume, ", ") or "rien"))
      essai = essai + 1
      local ecart = false
      for i, a in ipairs(plan.actions) do
        if rapide and i > 1 then break end
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
      -- (plan rapide joué sans écart : plan complet pour la suite du tour)
      if not ecart and not rapide then break end
      if ecart then
        ecarts = ecarts + 1
        if ecarts > REPLANIFIER then
          dire("  ⛔ écarts répétés : fin du tour", "erreur")
          break
        end
      end
      if not encoreMonTour() then
        dire("  ⛔ tour terminé : pas de nouveau plan", "erreur")
        return
      end
    end
    noter("  fin du tour en " .. maCase() .. string.format(" — fightManagement : %d ms", math.floor((maintenant() - t0) * 1000)))
  end

  -- Mule (MULES_AVANCENT) : vers le Krobe le plus proche, pour s'y faire tuer (chaque mule en vie ajoute 2 000 PV à la
  -- Malamibe) ; une Bacterrib compte 3 cases de plus (une mule à 5 cases ou moins la relance tant qu'elle vit). 2026-10-17
  -- à 23:01 : 4 mules à l'écart des monstres, jamais touchées, Malamibe à 12 001 PV, équipe tuée en manche 3.
  local KROBES_ESPECES = { [3823] = true, [3824] = true, [3825] = true, [3826] = true, [3827] = true, [5212] = true, [5213] = true, [5214] = true, [5215] = true }
  local BACTERRIBS = { [3825] = true, [5212] = true }
  local function avancerMule()
    local ici = maCase()
    local cible, cout = nil, nil
    for _, e in ipairs(entites()) do
      local esp = e.CreatureGenericId or 0
      if KROBES_ESPECES[esp] and vivant(e) and (e.CellId or -1) >= 0 then
        local d = nil
        pcall(function() d = fightAction:getDistance(ici, e.CellId) end)
        if type(d) == "number" then
          local c = d + (BACTERRIBS[esp] and 3 or 0)
          if cible == nil or c < cout then cible, cout = e, c end
        end
      end
    end
    if cible == nil then return nil end
    pcall(function() fightAction:moveToWardCell(cible.CellId) end)
    return string.format("avance %s → %s (vers %s en %s), ", tostring(ici), tostring(maCase()), nomEspece(cible.CreatureGenericId), tostring(cible.CellId))
  end

  -- Tour joué à la main (A_LA_MAIN) : rien n'est joué ; le plan que le serveur aurait joué est noté (fichier du
  -- personnage, plans-*.jsonl du serveur, pour comparer), puis la main est gardée jusqu'à la fin du tour.
  local function jouerALaMain()
    local t0 = maintenant()
    local nom = moi() or "?"
    noter("")
    noter(string.format("[%.3f] fightManagement lancé (manche AnkaBot %s, case %s, %s PA) : tour joué à la main", t0,
      tostring(manche()), tostring(maCase()), tostring(mesPA())))
    if not lireMonTour() then
      noter("  isItMyTurn() faux : main rendue")
      return
    end
    journalEcrire()
    if JOURNAL_FLUSH_NOW then pcall(JOURNAL_FLUSH_NOW) end
    monTour = monTour + 1
    local m = manche()
    if mancheTour == nil or m ~= mancheTour then
      if mancheTour ~= nil and m ~= nil and m < mancheTour then lances, tourCombat = {}, 0 end
      mancheTour, debutTour, refusTour = m, maCase(), {}
      tourCombat = tourCombat + 1
    end
    noter("════ " .. nom .. " — mon tour " .. monTour .. " (manche AnkaBot " .. tostring(m) .. "), case " .. maCase() .. ", " ..
      mesPA() .. " PA, " .. mesPM() .. " PM : à la main ════")
    dire("[MAIN] " .. nom .. " : à toi de jouer (le script attend la fin du tour)", "succes")
    if A_LA_MAIN_PLAN then
      local plan, raison, _, attendu = obtenirPlan(nom, ATTENTE_PLAN)
      if plan ~= nil then
        local resume = {}
        for _, a in ipairs(plan.actions) do resume[#resume + 1] = decrire(a) end
        noter("  plan du serveur, non joué (note " .. tostring(plan.entete.note) .. ", " .. tostring(attendu) .. " ms) — " ..
          (#resume > 0 and table.concat(resume, ", ") or "rien"))
      else
        noter("  pas de plan du serveur : " .. tostring(raison))
      end
      journalEcrire()
    end
    local faux = 0
    while faux < A_LA_MAIN_FIN_MS and (maintenant() - t0) * 1000 < A_LA_MAIN_MAX_MS do
      pause(200)
      if lireMonTour() then faux = 0 else faux = faux + 200 end
    end
    noter(string.format("  fin du tour à la main en %s — fightManagement : %d ms", tostring(maCase()),
      math.floor((maintenant() - t0) * 1000)))
  end

  function fightManagement()
    if aLaMain(moi()) then
      local ok, err = pcall(jouerALaMain)
      if not ok then dire("⛔ [MAIN] erreur : " .. tostring(err), "erreur") end
      journalEcrire()
      return
    end
    if estMule(moi()) then
      -- (mule : rien d'autre à jouer, AnkaBot passe le tour au retour)
      local avance = MULES_AVANCENT and avancerMule() or nil
      noter("[MULE] " .. tostring(moi()) .. " : " .. (avance or "") .. "tour passé (case " .. tostring(maCase()) .. ")")
      journalEcrire()
      return
    end
    local ok, err = pcall(jouerMonTour)
    if not ok then dire("⛔ [IA] erreur : " .. tostring(err), "erreur") end
    journalEcrire()
  end

  -- ─────────────────────────── hors combat ───────────────────────────

  local function attendre()
    if LANCER_LE_COMBAT then pcall(function() map:fight() end) end
    pcall(function() global:delay(2000) end)
  end

  -- Étape suivante du circuit sur cette carte : sa première entrée pas encore faite, celles d'avant marquées faites (l'ordre
  -- de la liste est ainsi suivi) ; fin de liste : tout est remis à zéro et la recherche reprend au début (boucle).
  local etape = nil
  local function prochaineEtape(carte)
    for _ = 1, 2 do
      for _, e in ipairs(CIRCUIT) do
        if e.map == carte and not e.fait then
          e.fait = true
          return e
        end
        e.fait = true
      end
      for _, e in ipairs(CIRCUIT) do e.fait = false end
    end
    return nil
  end

  function move()
    local actuelle = nil
    pcall(function() actuelle = map:currentMapId() end)
    local carte = tostring(actuelle)
    if CIRCUIT ~= nil then
      local dedans = false
      for _, e in ipairs(CIRCUIT) do if e.map == carte then dedans = true break end end
      if dedans then
        -- (après un combat sur la carte de l'étape en cours : la même étape, pas la suivante de cette carte)
        local apres = false
        pcall(function() apres = global:afterFight() end)
        if not (apres and etape ~= nil and etape.map == carte) then etape = prochaineEtape(carte) end
        if etape ~= nil then return { etape } end
      end
    end
    local out, vues = {}, {}
    -- (trajet d'abord : ses cartes ne sont pas des cartes d'attente, même si elles sont dans CARTES)
    for _, e in ipairs(TRAJET or {}) do
      vues[e.map] = true
      out[#out + 1] = e
    end
    local function ajouter(m)
      if m and m ~= "0" and m ~= "nil" and not vues[m] then
        vues[m] = true
        out[#out + 1] = { map = m, custom = attendre }
      end
    end
    ajouter(tostring(actuelle))
    for _, m in ipairs(CARTES) do ajouter(m) end
    return out
  end

  dire("[IA] " .. NOM_IA .. " chargé : placement et tours demandés à " .. PLAN_URL)
end)()
