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
-- Pause après un sort (ms) : aucune, AnkaBot attend lui-même le résultat du lancer (consigne du joueur, 2026-10-11).
-- canCastSpellOnCell peut alors juger sur l'état d'avant (2026-10-10 : quatre « TROP_LOIN » de suite juste après Tirs
-- Éloignés) : ces refus-là sont revérifiés après DELAI_AVANT_FORCAGE puis forcés (FORCER_SI_ENREGISTRE).
DELAI_APRES_SORT = 0
DELAI_AVANT_FORCAGE = 350
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

-- <<SCENARIOS>>

-- ───────────────────────────── état ─────────────────────────────

local actif = nil              -- scénario reconnu pour le combat en cours
local placementParDefaut = nil  -- cases de la formation par défaut du mode avancé (aucun scénario reconnu)
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
  dire("[PLACEMENT] aucun scénario enregistré pour ces monstres (" .. table.concat(vus, ", ") .. ") : mode avancé (SANS_SCENARIO)")
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
  for _, c in pairs((actif and actif.cases) or placementParDefaut or {}) do cibles[c] = true end
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
    placementParDefaut = nil
    actif = reconnaitre(defenders)
    local nom = moi()
    if actif == nil then
      -- Pas de scénario : la formation par défaut du mode avancé (consigne du joueur, 2026-10-11 : le même placement
      -- des Crâs pour tous les placements de monstres) ; le combat se joue en mode avancé (SANS_SCENARIO).
      local f = IA_formationParDefaut and IA_formationParDefaut()
      local cible = f and nom and f.placement[nom]
      if cible == nil then return end
      placementParDefaut = f.placement
      dire("[PLACEMENT] formation par défaut « " .. f.nom .. " » — " .. tostring(nom) .. " → case " .. cible, "succes")
      placer(cible, challengers)
      return
    end
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
