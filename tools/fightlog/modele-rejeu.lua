--[[
  ReineRejeu.lua — SCÉNARIOS DES PLACEMENTS, donjon de la Reine des Voleurs, POUR TOUT LE GROUPE.
  AnkaBot PC, Dofus 3. FICHIER GÉNÉRÉ (modèle : tools/fightlog/modele-rejeu.lua) : par tools/fightlog/combat.ts
  (ReineCombat.lua) à partir de la bibliothèque des scénarios (data/reine/scenarios, apprise des combats joués :
  tools/reine-des-voleurs/scenarios), ou par tools/fightlog/scenario.ts (ReineRejeu.lua) à partir de combats joués à la
  main. Régénérer plutôt qu'éditer à la main.

  Ce qu'il fait :
    1. PLACEMENT (fightManagementPosition) : reconnaît le placement des monstres (cases de départ = signature du
       scénario), puis met CHAQUE Crâ sur SA case — d'abord par le paquet de placement (PLACEMENT.paquet, le procédé
       éprouvé dans IA_Rejeu6), sinon par fightAction:chooseCell. Vérifie la case obtenue et réessaie (un coéquipier
       peut occuper la case un instant ; deux Crâs qui veulent la case l'un de l'autre se débloquent en passant par une
       case libre).
    2. COMBAT (fightManagement, à chaque tour) : le scénario du placement connaît, pour le n-ième tour de chaque Crâ,
       des SITUATIONS (plateau au moment où il commence à jouer : coéquipiers, Bonbombes, monstres) et le meilleur tour
       joué depuis chacune dans les combats appris (déplacements et sorts exacts). Le script relève le plateau du jeu,
       cherche la situation qui correspond (règles plus bas, « correspondance ») et joue ce tour TOUT DE SUITE, sans
       serveur, par les méthodes d'AnkaBot (fightAction:moveToWardCell, canCastSpellOnCell, castSpellOnCell).
    3. Situation inconnue (SI_AUCUNE_BRANCHE), au-delà du scénario (APRES_LE_PLAN) ou placement inconnu (SANS_SCENARIO) :
       dans ReineCombat.lua, l'IA du serveur de plans joue CE tour (« avance ») ; le tour suivant, le scénario est de
       nouveau cherché. Le journal du combat (inclus dans ReineCombat.lua) l'enregistre : appris ensuite, ce tour
       devient une situation connue. Plus il y a de combats appris, moins le serveur est sollicité.
    4. Écart pendant un tour du scénario (sort refusé, déplacement arrêté, PM qui manquent pour rentrer) :
       SUITE_SI_ECART (par défaut le serveur joue la suite du tour) ; à la fin, retour sur la case de fin du tour.

  Correspondance plateau du jeu ↔ situation (identique à tools/reine-des-voleurs/scenarios/compilation.ts, matchPlan) :
  même case de départ ; au moins les PA et PM que le tour dépense ; mêmes coéquipiers sur les mêmes cases ; mêmes
  Bonbombes (celle du tour, qui apparaît au début du tour, peut ne pas être encore là) ; autant de monstres de chaque
  espèce, chacun sur sa case (un monstre invisible dans la situation n'est pas comparé) — sauf un monstre LOIN de tous
  les Crâs dans la situation (hors de portée de son prochain tour, pas visé par le tour), qui peut être ailleurs s'il y
  est loin aussi (TOLERANCE_LOIN au plus) ; sorts du tour disponibles (pas en relance). Plusieurs situations
  correspondent : la plus exacte, puis la meilleure.

  Installation (groupe AnkaBot : un chef, des mules) :
    - charger CE script sur le chef (Lowkey-Jealous) : AnkaBot le charge aussi sur les mules, chaque personnage
      exécute donc ce même fichier, pour LUI ;
    - configuration de combat de chaque compte : IA avancée « dans le même script » (fightManagement est ici, avec
      accès à developer pour le paquet de placement) ;
    - lancer le script dans la salle de la Reine ; engager le combat à la main (ou LANCER_LE_COMBAT = true).

  Identification : character:name() (le nom), avec repli sur l'identifiant de personnage (fightCharacter:getId()).
  Tour : compté par le script (n-ième appel de fightManagement depuis le placement) ; la manche d'AnkaBot
  (fightAction:getCurrentTurn(), qui prend parfois un tour d'avance) sert de second essai.

  Garde-fous repris d'IA_Rejeu6 : jamais de tostring sur un message Protobuf ; tout appel d'AnkaBot sous pcall ; un
  sort n'est demandé que s'il figure au scénario du personnage (il l'a lancé, il le possède : un sort non possédé fait
  lever dans canCastSpellOnCell une exception .NET que pcall ne rattrape pas — après un changement de variantes,
  recompiler avec --depuis) ; « code 0 » = LANÇABLE ; sous Acuité Absolue, canCastSpellOnCell répond LIGNE_DE_VUE à
  tort : on tente quand même.
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
-- Écart pendant un tour du scénario (sort refusé, déplacement arrêté, PM qui manquent pour les déplacements restants) :
-- "avance" (l'IA du serveur de plans joue la suite du tour, si le script l'inclut — ReineCombat.lua —, sinon comme
-- "continuer"), "continuer" (le reste du tour enregistré) ou "arreter" (plus rien, sauf le retour sur la case de fin).
SUITE_SI_ECART = "avance"
-- Tour au-delà du scénario, ou combat sans scénario reconnu : "avance" (IA du serveur de plans pour ce tour, si le
-- script l'inclut — ReineCombat.lua —, sinon le tour est passé), "passer" (ne rien faire) ou "ia" (IA basique d'AnkaBot
-- avec la configuration de sorts du compte, fightBasic:playTurn).
APRES_LE_PLAN = "avance"
SANS_SCENARIO = "avance"
-- Reine morte : "rejeu" (le scénario continue tant qu'il connaît la situation) ou "avance" (IA du serveur de plans pour
-- tout le reste du combat).
APRES_LA_REINE = "rejeu"
-- true : une fois l'IA du serveur engagée, elle joue tout le reste du combat (comportement d'avant les scénarios
-- appris) ; false : le scénario est de nouveau cherché à chaque tour.
AVANCE_COLLANT = false
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
-- chargé pendant un changement de carte (map:currentMapId() = 0) n'a pas de carte courante. Une carte du trajet (plus
-- bas) y fait son action au lieu d'attendre.
CARTES = { "137101312", "137101316" }
-- TRAJET dans le donjon (consigne du joueur, 2026-10-12), carte par carte : 137102336, porte de la case 66 ;
-- 137103360, dialogue avec le PNJ 2447 (une réponse) ; 136056074, dialogue avec le PNJ 2446 (deux réponses) ; salle de la
-- Reine (137101312), tatouage de Looth, et combat lancé par le chef (map:fight()).
TATOUAGE = 30486          -- Superbe tatouage temporaire de Looth
-- MODE « 4 CRÂS + MULE » (consigne du joueur, 2026-10-14) : un personnage du groupe absent de CRAS (écrit par la
-- génération : les Crâs du registre) est une mule, là pour l'expérience. Placée en MULE_CASE, elle passe ses tours : en
-- 424, la Bonbombe que le 4e Crâ pose en 409 à son 2e tour la tue (voulu). MULE_COLONNE = 435 : elle rejoint plutôt le
-- bout de la colonne (5 PM depuis 424), si elle a les PM pour y arriver en un tour. Avec une mule, 5 monstres par vague
-- et une Reine à 17 000 PV : aucun placement de 4 monstres ne correspond, les Crâs prennent ceux du placement par défaut
-- et l'IA du serveur joue (le serveur lit les PV réels).
MULE_CASE = 424
MULE_COLONNE = nil
DELAI_DIALOGUE = 1000     -- ms avant chaque réponse à un PNJ
-- SITUATIONS (branches). Monstres lointains admis ailleurs que sur leur case enregistrée (voir « correspondance » en
-- tête) ; 0 : plateau exact seulement.
TOLERANCE_LOIN = 2
-- Sorts du tour en relance (lancés à un autre moment que dans le combat appris) : la situation est écartée.
VERIFIER_RELANCES = true
-- Aucune situation connue ne correspond : "avance" (IA du serveur de plans pour ce tour ; serveur absent ou sans plan :
-- SI_SERVEUR_ABSENT), "proche" (la plus proche quand même, si elle n'a pas plus de TOLERANCE_PROCHE combattants
-- ailleurs : RISQUÉ, les bombes ne pardonnent pas), "main" (arrêter le script : le joueur finit le combat à la main),
-- "ia" (IA basique d'AnkaBot) ou "passer".
SI_AUCUNE_BRANCHE = "avance"
-- Serveur de plans absent (ou sans plan) pour une situation inconnue : "passer" (rester sur sa case), "proche" ou "ia".
SI_SERVEUR_ABSENT = "passer"
TOLERANCE_PROCHE = 2

-- <<SCENARIOS>>
-- Distance à partir de laquelle un monstre est loin d'un Crâ, par espèce (écrite avec les scénarios ; absente : aucune
-- tolérance).
LOIN = LOIN or {}

-- ───────────────────────────── état ─────────────────────────────

local actif = nil              -- scénario reconnu pour le combat en cours
local placementParDefaut = nil  -- cases de la formation par défaut du mode avancé (aucun scénario reconnu)
local monTour = 0              -- n-ième tour de CE personnage dans le combat en cours
local placeDemandee = nil      -- case demandée au placement
local journal, journalChemin = {}, nil
local acuiteManche = nil       -- manche où Acuité Absolue a été lancée
local debutTour = -1           -- case au début de mon tour : le combat y pose une marque (on s'arrête si on y passe)
local enAvance, modeAnnonce = false, false   -- IA du serveur engagée pour tout le combat (AVANCE_COLLANT) ; annoncée
local ACUITE_ABSOLUE = 32469
local BOMBE = 3725
local stats = { scenario = 0, serveur = 0, autre = 0 }   -- tours de ce combat : joués par le scénario, par le serveur

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
  for nom, x in pairs(CRAS or {}) do if x == id then return nom end end
  return nil
end

-- Crâ (dans CRAS, écrit par la génération) ou mule (tout autre personnage du groupe). Sans CRAS : tous des Crâs.
local function estCra(nom)
  if CRAS == nil or next(CRAS) == nil then return true end
  return nom ~= nil and CRAS[nom] ~= nil
end
local idsCras = nil
local function estCraId(id)
  if idsCras == nil then
    idsCras = {}
    for _, x in pairs(CRAS or {}) do if x and x ~= 0 then idsCras[x] = true end end
  end
  if next(idsCras) == nil then return true end
  return idsCras[id] == true
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
    -- (la mule n'est pas comptée : sa mort est voulue)
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

-- ───────────────────────────── scénario : reconnaissance ─────────────────────────────

-- Espèce du monstre de chaque case (case → identifiant, -1 = vide), d'après les entités du combat ; 0 : inconnue.
local function especesDesCases(defenders)
  local parId, parCase = {}, {}
  for _, e in ipairs(entites()) do
    local espece = e.CreatureGenericId or 0
    if espece ~= 0 then
      if e.Id ~= nil then parId[e.Id] = espece end
      if e.CellId ~= nil then parCase[e.CellId] = espece end
    end
  end
  local out, inconnues = {}, 0
  for cell, id in pairs(defenders or {}) do
    if id ~= -1 then
      out[cell] = parId[id] or parCase[cell] or 0
      if out[cell] == 0 then inconnues = inconnues + 1 end
    end
  end
  return out, inconnues
end

-- Le placement des monstres (case → identifiant, -1 = vide) correspond-il à la signature d'un scénario ? Chaque monstre
-- de la signature doit être sur sa case (même espèce : plusieurs placements occupent les mêmes cases avec des monstres
-- permutés), et aucun autre monstre ne doit être ailleurs. Espèce inconnue (entités pas encore données par AnkaBot) :
-- la case seule compte, le premier placement de ces cases est pris.
local function reconnaitre(defenders)
  local occupees, inconnues = especesDesCases(defenders)
  local n = 0
  for _ in pairs(occupees) do n = n + 1 end
  if inconnues > 0 then
    dire("⚠ [PLACEMENT] espèce inconnue pour " .. inconnues .. " monstre(s) : reconnaissance par les cases seules " ..
      "(placements aux mêmes cases confondus)", "erreur")
  end
  for _, s in ipairs(SCENARIOS) do
    local bons = 0
    for _, m in ipairs(s.monstres) do
      local e = occupees[m.cellule]
      if e ~= nil and (e == 0 or e == m.espece) then bons = bons + 1 end
    end
    if bons == #s.monstres and n == #s.monstres then
      dire("[PLACEMENT] " .. s.nom .. " : les " .. n .. " monstres sur leurs cases")
      return s
    end
  end
  local vus = {}
  for cell, e in pairs(occupees) do vus[#vus + 1] = tostring(e) .. "@" .. tostring(cell) end
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
  if MULE_CASE then cibles[MULE_CASE] = true end
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
    journal, journalChemin, monTour, acuiteManche = {}, nil, 0, nil
    enAvance, modeAnnonce, crasVus = false, false, 0
    stats = { scenario = 0, serveur = 0, autre = 0 }
    placementParDefaut = nil
    actif = reconnaitre(defenders)
    local nom = moi()
    if not estCra(nom) then
      if MULE_CASE then
        dire("[PLACEMENT] mule (" .. tostring(nom) .. ") → case " .. MULE_CASE, "succes")
        placer(MULE_CASE, challengers)
      end
      return
    end
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
    if cible == nil and nom then
      -- Crâ sans case dans ce scénario : sa case de la formation par défaut (les mêmes cases pour tous les placements).
      local f = IA_formationParDefaut and IA_formationParDefaut()
      cible = f and f.placement[nom]
    end
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

local NOMS_ESPECES = { [3725] = "Bonbombe", [3726] = "Reine", [3745] = "Bombe Illicale", [3746] = "Mâchassin", [3747] = "Terristocrate",
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

-- Joue une action ; rend true si elle a réussi (sinon : écart, voir SUITE_SI_ECART).
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
    return false
  end
  local cell, pourquoi = caseVisee(a)
  if cell == nil then
    dire("  ⚠ " .. n .. ". sort " .. a.sort .. " sauté : " .. pourquoi, "erreur")
    return false
  end
  local ok, code, force = lancer(a, cell)
  if ok then
    dire("  " .. n .. ". sort " .. a.sort .. " sur " .. cell .. (pourquoi ~= "case" and pourquoi ~= "soi" and (" (" .. pourquoi .. ")") or "") ..
      (force and (" — lancé malgré « " .. nomCode(code) .. " » d'AnkaBot (case de départ enregistrée)") or ""))
    return true
  end
  local raison = code == 0 and "autorisé mais non exécuté (désynchro ?)" or nomCode(code)
  dire("  ⚠ " .. n .. ". sort " .. a.sort .. " sur " .. cell .. " : " .. raison, "erreur")
  return false
end

local function mesPA()
  local x = -1
  pcall(function() x = fightCharacter:getAP() end)
  return x or -1
end
local function mesPM()
  local x = -1
  pcall(function() x = fightCharacter:getMP() end)
  return x or -1
end

-- ───────────────────────────── situations ─────────────────────────────

-- Coordonnées logiques des cases (boucle de MapPoint.init du client, comme src/map/geometry.ts) : distance de jeu =
-- Manhattan dans ce repère, la même que celle de la compilation des scénarios.
local CASE_X, CASE_Y = {}, {}
do
  local x0, y0, c = 0, 0, 0
  for _ = 1, 20 do
    for b = 0, 13 do CASE_X[c], CASE_Y[c], c = x0 + b, y0 + b, c + 1 end
    x0 = x0 + 1
    for b = 0, 13 do CASE_X[c], CASE_Y[c], c = x0 + b, y0 + b, c + 1 end
    y0 = y0 - 1
  end
end
local function distance(a, b)
  if CASE_X[a] == nil or CASE_X[b] == nil then return 0 end
  return math.abs(CASE_X[a] - CASE_X[b]) + math.abs(CASE_Y[a] - CASE_Y[b])
end

-- Combattants vivants autres que moi : { e = espèce (0 pour un joueur), id, c = case (-1 : invisible) }.
local function plateauDuJeu()
  local moiId = monId()
  local out = {}
  for _, x in ipairs(entites()) do
    if vivant(x) and x.Id ~= moiId then
      out[#out + 1] = { e = x.CreatureGenericId or 0, id = x.Id, c = x.CellId or -1 }
    end
  end
  return out
end

local function nomCra(id)
  for nom, x in pairs(actif and actif.ids or {}) do if x == id then return nom end end
  return "joueur " .. tostring(id)
end

local function decrirePlateau(p)
  local parts = {}
  for _, x in ipairs(p) do
    local qui = (x.e == 0) and nomCra(x.id) or nomEspece(x.e)
    parts[#parts + 1] = qui .. "@" .. ((x.c or -1) >= 0 and tostring(x.c) or "invisible")
  end
  table.sort(parts)
  return table.concat(parts, " · ")
end

local function indexDe(liste, v)
  for i, x in ipairs(liste) do if x == v then return i end end
  return nil
end

-- La situation `b` correspond-elle au plateau du jeu ? Rend (oui, monstres lointains déplacés, raison du refus).
-- Mêmes règles que matchPlan (tools/reine-des-voleurs/scenarios/compilation.ts).
local function correspond(b, jeu, ici, pa, pm)
  if ici ~= b.depart then return false, 0, "départ " .. tostring(ici) .. " au lieu de " .. tostring(b.depart) end
  if b.pa and pa >= 0 and pa < b.pa then return false, 0, pa .. " PA pour " .. b.pa end
  if b.pm and pm >= 0 and pm < b.pm then return false, 0, pm .. " PM pour " .. b.pm end
  -- Coéquipiers : les mêmes, sur les mêmes cases.
  local nRec, nJeu = 0, 0
  for _, r in ipairs(b.plateau or {}) do
    if r.e == 0 then
      nRec = nRec + 1
      local ok = false
      for _, x in ipairs(jeu) do if x.e == 0 and x.id == r.id and x.c == r.c then ok = true break end end
      if not ok then return false, 0, nomCra(r.id) .. " attendu en " .. r.c end
    end
  end
  for _, x in ipairs(jeu) do if x.e == 0 then nJeu = nJeu + 1 end end
  if nRec ~= nJeu then return false, 0, nJeu .. " Crâs pour " .. nRec end
  -- Bonbombes : les mêmes cases ; celle du tour (n) peut ne pas être encore apparue.
  local recB, vues = {}, {}
  for _, r in ipairs(b.plateau or {}) do if r.e == BOMBE then recB[r.c] = r end end
  for _, x in ipairs(jeu) do
    if x.e == BOMBE then
      if recB[x.c] == nil then return false, 0, "Bonbombe en " .. tostring(x.c) .. " inattendue" end
      vues[x.c] = true
    end
  end
  for c, r in pairs(recB) do
    if not r.n and not vues[c] then return false, 0, "Bonbombe attendue en " .. c end
  end
  -- Monstres : autant de chaque espèce ; chacun sur sa case, ou loin s'il était loin (l).
  local especes = {}
  for _, r in ipairs(b.plateau or {}) do if r.e ~= 0 and r.e ~= BOMBE then especes[r.e] = true end end
  for _, x in ipairs(jeu) do if x.e ~= 0 and x.e ~= BOMBE then especes[x.e] = true end end
  local cras = { ici, b.fin }
  for _, x in ipairs(jeu) do if x.e == 0 and (x.c or -1) >= 0 then cras[#cras + 1] = x.c end end
  local toleres = 0
  for e in pairs(especes) do
    local rec, reste = {}, {}
    for _, r in ipairs(b.plateau or {}) do if r.e == e then rec[#rec + 1] = r end end
    for _, x in ipairs(jeu) do if x.e == e then reste[#reste + 1] = x.c or -1 end end
    if #rec ~= #reste then return false, 0, #reste .. " " .. nomEspece(e) .. " pour " .. #rec end
    local manquants = {}
    for _, r in ipairs(rec) do
      if not r.inv then
        local k = indexDe(reste, r.c)
        if k then table.remove(reste, k) else manquants[#manquants + 1] = r end
      end
    end
    -- Invisible dans la situation : sa case n'est pas comparée (de préférence un monstre invisible en jeu, case -1).
    for _, r in ipairs(rec) do
      if r.inv then table.remove(reste, indexDe(reste, -1) or 1) end
    end
    for _, r in ipairs(manquants) do
      if not r.l or LOIN[e] == nil then return false, 0, nomEspece(e) .. " attendu en " .. (r.inv and "invisible" or tostring(r.c)) end
      local k = nil
      for i, c in ipairs(reste) do
        if c >= 0 then
          local loin = true
          for _, x in ipairs(cras) do if x >= 0 and distance(x, c) < LOIN[e] then loin = false break end end
          if loin then k = i break end
        end
      end
      if k == nil then return false, 0, nomEspece(e) .. " attendu loin (en " .. r.c .. ")" end
      table.remove(reste, k)
      toleres = toleres + 1
    end
  end
  if toleres > TOLERANCE_LOIN then return false, toleres, toleres .. " monstres lointains déplacés" end
  return true, toleres, nil
end

-- Sorts du tour disponibles ? (un sort en relance ou déjà lancé assez de fois : le tour ne se jouerait pas comme appris)
local function sortsDisponibles(b)
  if not VERIFIER_RELANCES then return true end
  local vus = {}
  for _, a in ipairs(b.actions or {}) do
    if a.type == "sort" and not vus[a.sort] then
      vus[a.sort] = true
      local code = -1
      pcall(function() code = fightAction:canCastSpellOnCell(a.depuis, a.sort, a.cellule) end)
      if code == 1 or code == 2 then return false, "sort " .. a.sort .. " : " .. nomCode(code) end
    end
  end
  return true
end

-- Situation à jouer parmi les candidates (la meilleure d'abord) : celle qui correspond avec le moins de monstres
-- lointains déplacés, à égalité la première. Rend (situation, déplacés, raisons des refus).
local function choisirBranche(candidates, jeu, ici, pa, pm)
  local meilleure, toleres = nil, nil
  local refus = {}
  for _, b in ipairs(candidates) do
    local ok, tol, pourquoi = correspond(b, jeu, ici, pa, pm)
    if ok and (meilleure == nil or tol < toleres) then
      local libre, quoi = sortsDisponibles(b)
      if libre then meilleure, toleres = b, tol
      elseif #refus < 3 then refus[#refus + 1] = quoi end
    elseif not ok and #refus < 3 then
      refus[#refus + 1] = pourquoi
    end
    if meilleure ~= nil and toleres == 0 then break end
  end
  return meilleure, toleres or 0, refus
end

-- Écarts « grossiers » d'une situation (combattants absents de leur case enregistrée) : repli "proche" et journal.
local function ecarts(branche, jeu)
  local out = {}
  for _, b in ipairs(branche.plateau or {}) do
    if not b.inv and not b.n then
      local trouve = false
      for _, x in ipairs(jeu) do
        local meme = (b.e == 0) and (x.id == b.id) or (b.e ~= 0 and x.e == b.e)
        if meme and x.c == b.c then trouve = true break end
      end
      if not trouve then out[#out + 1] = ((b.e == 0) and nomCra(b.id) or nomEspece(b.e)) .. " attendu en " .. b.c end
    end
  end
  return out
end

local function plusProche(candidates, jeu, ici)
  local meilleure, ecs = nil, nil
  for _, b in ipairs(candidates) do
    if b.depart == ici then
      local e = ecarts(b, jeu)
      if meilleure == nil or #e < #ecs then meilleure, ecs = b, e end
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

-- Retour sur la case de fin du tour (la colonne), si des PM le permettent.
local function retour(fin)
  if fin == nil or fin < 0 or maCase() == fin then return end
  if mesPM() <= 0 or not encoreMonTour() then
    dire("  ⚠ fin du tour hors de sa case " .. fin .. " (en " .. maCase() .. ", " .. mesPM() .. " PM)", "erreur")
    return
  end
  dire("  retour sur la case de fin " .. fin)
  allerEnEvitant(fin)
end

-- Tour joué par l'IA du serveur de plans (IA_tour, incluse dans ReineCombat.lua seulement). `repli` : appelé si le
-- serveur ne donne aucun plan (absent, ou rien trouvé).
local function modeAvance(pourquoi, repli, collant)
  if collant then enAvance = true end
  if collant and not modeAnnonce then
    modeAnnonce = true
    dire("[COMBAT] " .. pourquoi .. " — MODE AVANCÉ : l'IA du serveur de plans joue désormais les tours", "succes")
  else
    dire("[COMBAT] " .. pourquoi .. " — l'IA du serveur de plans joue ce tour")
  end
  stats.serveur = stats.serveur + 1
  journalEcrire()
  IA_tour(debutTour, repli)
end

-- Situation inconnue (ou scénario absent) : la consigne `mode` ("avance", "proche", "ia", "passer", "main").
local function sansSituation(mode, pourquoi, candidates, jeu, ici)
  local function proche()
    local b, ecs = plusProche(candidates or {}, jeu or {}, ici)
    if b and #ecs <= TOLERANCE_PROCHE then
      dire("  → situation la plus proche quand même (" .. #ecs .. " écart(s) : " .. table.concat(ecs, " ; ") .. ")", "erreur")
      return b
    end
    dire("[REJEU] aucune situation assez proche — tour passé")
    return nil
  end
  local function autre(m)
    if m == "proche" then return proche() end
    if m == "ia" then jouerIA(pourquoi) elseif m == "main" then
      dire("[REJEU] le script s'arrête : à vous de jouer", "erreur")
      journalEcrire()
      pcall(function() global:finishScript() end)
    else dire("[REJEU] " .. pourquoi .. " — tour passé") end
    stats.autre = stats.autre + 1
    return nil
  end
  if mode == "avance" then
    if IA_tour then
      local choix = nil
      modeAvance(pourquoi, function(raison)
        dire("⚠ [REJEU] pas de plan du serveur (" .. tostring(raison) .. ") : " .. SI_SERVEUR_ABSENT, "erreur")
        stats.serveur = stats.serveur - 1
        choix = autre(SI_SERVEUR_ABSENT)
      end, AVANCE_COLLANT)
      return choix
    end
    return autre(SI_SERVEUR_ABSENT)
  end
  return autre(mode)
end

-- Joue une situation du scénario ; un écart → SUITE_SI_ECART ; à la fin, retour sur la case de fin.
local function jouerBranche(tour, t0, nom)
  local ici = maCase()
  stats.scenario = stats.scenario + 1
  local appris = tour.combats and (", jouée dans " .. tour.combats .. " combat(s) appris dont " .. (tour.victoires or 0) .. " gagné(s)") or ""
  dire("== [" .. nom .. "] tour " .. monTour .. " (manche " .. tour.manche .. ") : " .. #tour.actions .. " action(s), situation de la source " ..
    tostring(tour.source) .. appris .. string.format(" — choisie en %.2f s", horloge() - t0) .. " ==")
  -- PM des déplacements à partir de l'action i (garde-fou : sortir sans pouvoir rentrer, c'est la mort par les bombes).
  local function pmRestants(i)
    local n = 0
    for k = i, #tour.actions do
      local a = tour.actions[k]
      if a.type == "deplacer" then n = n + math.max(0, #(a.chemin or {}) - 1) end
    end
    return n
  end
  for i, a in ipairs(tour.actions) do
    local pv = 1
    pcall(function() pv = fightCharacter:getLifePoints() end)
    if (pv or 0) <= 0 then
      dire("  ⛔ personnage mort — fin du tour", "erreur")
      return
    end
    -- Tour fini côté jeu (combat du 2026-10-10 à 21:23 : tours terminés 0,1 s après leur début, avant toute action) :
    -- continuer bloquait le script 20 à 28 s sur des actions vouées à l'échec, et le combat attendait ce personnage.
    if not encoreMonTour() then
      dire(string.format("  ⛔ tour terminé par le jeu avant l'action %d (%.2f s après le lancement de fightManagement) : on s'arrête",
        i, horloge() - t0), "erreur")
      return
    end
    local ok
    if a.type == "deplacer" and mesPM() >= 0 and mesPM() < pmRestants(i) then
      dire("  ⚠ " .. i .. ". " .. mesPM() .. " PM pour " .. pmRestants(i) .. " de déplacements restants : on ne sort pas", "erreur")
      ok = false
    else
      ok = jouerAction(a, i)
    end
    if not ok then
      local mode = SUITE_SI_ECART
      if mode == "avance" and not IA_tour then mode = "continuer" end
      if mode == "avance" then
        dire("  ↻ écart : l'IA du serveur de plans joue la suite du tour")
        stats.serveur = stats.serveur + 1
        journalEcrire()
        IA_tour(debutTour, function(raison)
          dire("  ⚠ pas de plan du serveur pour la suite (" .. tostring(raison) .. ")", "erreur")
          retour(tour.fin)
        end)
        return
      end
      if mode == "arreter" or a.type == "deplacer" then break end
    end
    if DELAI_ENTRE_ACTIONS > 0 then pcall(function() global:delay(DELAI_ENTRE_ACTIONS) end) end
  end
  retour(tour.fin)
  local fin = maCase()
  noter("  fin du tour en " .. fin .. (fin ~= tour.fin and (" (enregistré : " .. tour.fin .. ")") or " (comme enregistré)") ..
    string.format(" — %.1f s", horloge() - t0))
end

-- Tour de la mule : rien (AnkaBot passe son tour), sauf rejoindre MULE_COLONNE si elle a les PM pour y arriver.
local function tourDeMule()
  local ici = maCase()
  if MULE_COLONNE and ici ~= MULE_COLONNE then
    local chemin = nil
    pcall(function() chemin = versListe(fightAction:getShortestPath(ici, MULE_COLONNE, {})) end)
    if type(chemin) == "table" and #chemin > 0 and chemin[1] ~= ici then table.insert(chemin, 1, ici) end
    local pas = (type(chemin) == "table" and #chemin > 0) and (#chemin - 1) or 99
    if pas <= mesPM() then
      pcall(function() fightAction:moveToWardCell(MULE_COLONNE) end)
      dire("[MULE] " .. ici .. " → " .. maCase() .. " (colonne " .. MULE_COLONNE .. ")")
    else
      dire("[MULE] " .. pas .. " PM pour la colonne " .. MULE_COLONNE .. ", " .. mesPM() .. " disponibles : reste en " .. ici)
    end
  end
  dire("[MULE] tour passé")
end

local function jouerMonTour()
  local aMoi = true
  pcall(function() aMoi = fightCharacter:isItMyTurn() end)
  if not aMoi then
    -- isItMyTurn() encore faux au lancement de fightManagement : rendre la main tout de suite fait passer le tour à
    -- AnkaBot ; on attend qu'il devienne vrai, comme l'IA (ATTENTE_MON_TOUR). Noté : tours finis en 0,1 à 0,4 s le
    -- 2026-10-12 à 21:46, cause pas encore établie.
    local attendu, max = 0, ATTENTE_MON_TOUR or 1500
    while not aMoi and attendu < max do
      pcall(function() global:delay(50) end)
      attendu = attendu + 50
      pcall(function() aMoi = fightCharacter:isItMyTurn() end)
    end
    noter(string.format("[horloge %.3f] fightManagement lancé avec isItMyTurn() faux : %s après %d ms", horloge(),
      aMoi and "devenu vrai" or "toujours faux", attendu))
    if not aMoi then return end
  end
  if not estCra(moi()) then return tourDeMule() end
  local t0 = horloge()
  local perdu = combatPerdu()
  if perdu then return abandonner(perdu) end
  local nom = moi()
  local m = manche()
  monTour = monTour + 1
  -- Script chargé en plein combat : on se cale sur la manche d'AnkaBot (au mieux).
  if monTour == 1 and type(m) == "number" and m > 1 then monTour = m end
  if actif == nil and monTour == 1 then actif = reconnaitreEnCombat() end
  debutTour = maCase()

  noter("")
  -- Horloge : comparable aux « ms » du journal (début de tour jvj) pour savoir quand fightManagement a été lancé.
  noter("════ " .. tostring(nom) .. " — mon tour " .. monTour .. " (manche AnkaBot " .. tostring(m) .. "), case " .. debutTour ..
    ", " .. mesPA() .. " PA, " .. mesPM() .. " PM — jusqu'ici : " .. stats.scenario .. " tour(s) du scénario, " .. stats.serveur ..
    " du serveur" .. string.format(" ════ [horloge %.3f]", t0))
  if IA_tour and enAvance then return modeAvance("mode avancé", nil, true) end
  if IA_tour and APRES_LA_REINE == "avance" and reineEnVie() == false then return modeAvance("la Reine est morte", nil, true) end
  if actif == nil then return sansSituation(SANS_SCENARIO, "aucun scénario reconnu") end
  -- Situations du n-ième tour (compte du script), puis de la manche d'AnkaBot si elle diffère.
  local tours = actif.plans[nom or ""] or {}
  local candidates = {}
  for _, b in ipairs(tours[monTour] or {}) do candidates[#candidates + 1] = b end
  if type(m) == "number" and m ~= monTour then
    for _, b in ipairs(tours[m] or {}) do candidates[#candidates + 1] = b end
  end
  if #candidates == 0 then
    local tour = sansSituation(APRES_LE_PLAN, "tour " .. monTour .. " au-delà du scénario")
    if tour then return jouerBranche(tour, t0, nom) end
    return
  end
  local jeu = plateauDuJeu()
  noter("  plateau du jeu : " .. decrirePlateau(jeu))
  local tour, toleres, refus = choisirBranche(candidates, jeu, debutTour, mesPA(), mesPM())
  if tour == nil then
    dire("⚠ [" .. tostring(nom) .. "] tour " .. monTour .. " : situation inconnue (" .. #candidates .. " connues pour ce tour" ..
      (#refus > 0 and (" ; " .. table.concat(refus, " ; ")) or "") .. ")")
    tour = sansSituation(SI_AUCUNE_BRANCHE, "situation inconnue", candidates, jeu, debutTour)
    if tour == nil then return end
  elseif toleres > 0 then
    noter("  " .. toleres .. " monstre(s) lointain(s) ailleurs que dans la situation apprise (toléré)")
  end
  if type(m) == "number" and tour.manche ~= m then
    noter("  (manche apprise " .. tour.manche .. ", AnkaBot dit " .. m .. ")")
  end
  if debutTour ~= tour.depart then dire("  ⚠ départ en " .. debutTour .. " au lieu de " .. tour.depart, "erreur") end
  jouerBranche(tour, t0, nom)
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

-- Dialogue avec un PNJ : conversation (action 3), puis `reponses` fois la première réponse (npc:reply(-1) : un nombre
-- négatif est l'index de la réponse).
local function dialogue(pnj, reponses)
  return function()
    local ok, err = pcall(function()
      npc:npc(pnj, 3)
      for _ = 1, reponses do
        global:delay(DELAI_DIALOGUE)
        npc:reply(-1)
      end
    end)
    if ok then dire("[TRAJET] PNJ " .. pnj .. " : " .. reponses .. " réponse(s)")
    else dire("⛔ [TRAJET] PNJ " .. pnj .. " : " .. tostring(err), "erreur") end
  end
end

-- Salle de la Reine (version du joueur, 2026-10-13) : le tatouage de Looth à chaque passage, par chaque Crâ, puis le
-- chef lance le combat (map:fight()). PAS de map:forceFight() : il attend un combat en bloquant le script et restait en
-- attente pendant le combat ; les tours des Crâs finissaient alors au bout de 0,1 à 0,8 s, l'IA encore en train de
-- demander son plan (2026-10-12 à 21:46 et 22:01).
local function salleDeLaReine()
  global:inviteTeam()
  inventory:useItem(TATOUAGE)
  global:printSuccess("Tatouage utilisé")
  if global:isBoss() then
    map:fight()
  end
end

local TRAJET = {
  { map = "137102336", door = "66" },
  { map = "137103360", custom = dialogue(2447, 1) },
  { map = "136056074", custom = dialogue(2446, 2) },
  { map = "137101312", custom = salleDeLaReine },
}

function move()
  local carte = nil
  pcall(function() carte = map:currentMapId() end)
  local out, vues = {}, {}
  for _, e in ipairs(TRAJET) do
    vues[e.map] = true
    out[#out + 1] = e
  end
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
local situations = 0
for _, s in ipairs(SCENARIOS) do
  for _, tours in pairs(s.plans or {}) do
    for _, liste in pairs(tours) do situations = situations + #liste end
  end
end
dire("[REJEU] chargé : " .. #SCENARIOS .. " scénario(s) (" .. table.concat(noms, ", ") .. "), " .. situations ..
  " situation(s) connue(s), visée « " .. VISER .. " »")
