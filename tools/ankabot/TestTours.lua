-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
--  TEST DES TOURS PASSÉS — AnkaBot passe-t-il le tour tout seul quand fightManagement attend sans agir ?
--
--  Constat (Reine des Voleurs, 2026-10-11 à 14:24) : à partir de la manche 3, le tour de chaque Crâ se termine
--  0,4 à 0,6 s après son début pendant que le script attend son plan (fightManagement encore en cours ; le tour
--  du Crâ suivant commence avant même son retour). Le jeu laisse 43 s par tour.
--
--  Ce script ne fait QUE attendre, de quatre façons différentes (une par tour, en boucle), et note quand
--  isItMyTurn() devient faux :
--    delai      : global:delay par pas de 50 ms, isItMyTurn() vérifié à chaque pas ;
--    delai_long : un seul global:delay de 5 s, isItMyTurn() vérifié après ;
--    requete    : comme le script de la Reine — requête HTTP (developer:postRequest) puis global:delay(200 ms) ;
--    occupe     : boucle de calcul sans jamais rendre la main (3 s), isItMyTurn() vérifié tous les 50 ms.
--  Après TOURS_DE_TEST tours de test, il laisse jouer l'IA basique d'AnkaBot (APRES = "ia") pour finir le combat.
--  Pas de journal des combats, pas de serveur de plans : seulement AnkaBot.
--
--  Utilisation :
--    1. Configuration de combat de chaque compte : IA avancée « dans le même script » (comme pour la Reine).
--    2. Charger ce script sur le chef (AnkaBot le charge aussi sur les mules), se placer sur une carte avec des
--       monstres TRÈS faibles (8 tours sans attaquer : ils ne doivent tuer personne) ; le script les attaque.
--    3. Facultatif, pour le mode « requete » : lancer_serveur_reine.cmd (sinon la requête échoue tout de suite,
--       le test reste valable mais moins proche du vrai).
--    4. Après le combat : fichiers test_tours_<personnage>_<date>.log à côté du script (un par personnage).
--  Lecture : « ⛔ COUPÉ après X ms » = le tour a fini alors que le script attendait encore.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- Comme les scripts de la Reine (combat à vagues). Si le combat ne se termine pas normalement : false.
IS_WAVE_FIGHT = true

ATTENTE_MS = 5000          -- durée de l'attente à chaque tour de test
OCCUPE_MAX_MS = 3000       -- mode « occupe » : durée de la boucle sans rendre la main
PAS_MS = 50                -- pas de vérification de isItMyTurn()
SONDE_MS = 200             -- mode « requete » : pause entre deux requêtes (comme SONDE_MS de la Reine)
MODES = { "delai", "delai_long", "requete", "occupe" }
TOURS_DE_TEST = 8          -- tours de test par personnage, puis APRES
APRES = "ia"               -- "ia" : IA basique d'AnkaBot (fightBasic:playTurn) ; "passer" : rendre la main tout de suite
URL_TEST = "http://127.0.0.1:8765/test-tour"
ATTENTE_MON_TOUR = 1500    -- fightManagement lancé alors que isItMyTurn() est faux : attente maximale

local journal = {}
local cheminJournal = nil
local dernierAppel = nil   -- manche AnkaBot du dernier appel de fightManagement
local appelsCetteManche = 0
local toursTestes = 0

local function maintenant()
  local t = 0
  pcall(function() t = os.clock() end)
  return t
end

local function moi()
  local n = nil
  pcall(function() n = character:name() end)
  return (type(n) == "string" and n ~= "") and n or "inconnu"
end

local function ecrire()
  if cheminJournal == nil then
    local dossier, quand = nil, nil
    pcall(function() dossier = global:getCurrentScriptDirectory() end)
    pcall(function() quand = os.date("%Y%m%d-%H%M%S") end)
    local fichier = "test_tours_" .. moi():gsub("[^%w%-]", "_") .. "_" .. tostring(quand or math.floor(os.time())) .. ".log"
    cheminJournal = (type(dossier) == "string" and dossier ~= "") and (dossier:gsub("[\\/]$", "") .. "\\" .. fichier) or fichier
  end
  pcall(function()
    local f = io.open(cheminJournal, "w")
    if f == nil then return end
    f:write(table.concat(journal, "\n"), "\n")
    f:close()
  end)
end

local function noter(t, genre)
  journal[#journal + 1] = t
  local ok = false
  if genre == "erreur" then ok = pcall(function() global:printError(t) end)
  elseif genre == "succes" then ok = pcall(function() global:printSuccess(t) end) end
  if not ok then pcall(function() global:printMessage(t) end) end
end

local function monTour()
  local ok, v = pcall(function() return fightCharacter:isItMyTurn() end)
  return ok and v == true
end

local function lire(f)
  local v = nil
  pcall(function() v = f() end)
  return tostring(v)
end

local function pause(ms)
  pcall(function() global:delay(ms) end)
end

local function ecoule(t0)
  return math.floor((maintenant() - t0) * 1000)
end

-- Chaque mode rend (ms écoulées quand isItMyTurn() est devenu faux, ou nil s'il est resté vrai), détail.
local TESTS = {}

function TESTS.delai(t0)
  while ecoule(t0) < ATTENTE_MS do
    pause(PAS_MS)
    if not monTour() then return ecoule(t0), "" end
  end
  return nil, ""
end

function TESTS.delai_long(t0)
  pause(ATTENTE_MS)
  if not monTour() then return ecoule(t0), " (vu après l'attente : moment exact inconnu)" end
  return nil, ""
end

function TESTS.requete(t0)
  local n, total, maxi, erreurs = 0, 0, 0, 0
  local function detail() return string.format(" (%d requête(s), %d ms en tout, %d ms au plus, %d échec(s))", n, total, maxi, erreurs) end
  while ecoule(t0) < ATTENTE_MS do
    local a = maintenant()
    local ok, rep = pcall(function() return developer:postRequest(URL_TEST, "test", { "Content-Type" }, { "text/plain" }) end)
    local d = ecoule(a)
    n, total, maxi = n + 1, total + d, math.max(maxi, d)
    if not ok or type(rep) ~= "string" then erreurs = erreurs + 1 end
    if not monTour() then return ecoule(t0), detail() end
    pause(SONDE_MS)
    if not monTour() then return ecoule(t0), detail() end
  end
  return nil, detail()
end

function TESTS.occupe(t0)
  local x, prochain = 0, PAS_MS
  while ecoule(t0) < OCCUPE_MAX_MS do
    for i = 1, 2000 do x = (x + i * 7) % 1000003 end
    if ecoule(t0) >= prochain then
      prochain = prochain + PAS_MS
      if not monTour() then return ecoule(t0), "" end
    end
  end
  return nil, " (main jamais rendue pendant " .. OCCUPE_MAX_MS .. " ms)"
end

local function finir()
  if APRES == "ia" then
    noter("  tours de test finis : IA basique d'AnkaBot (fightBasic:playTurn)")
    if not pcall(function() fightBasic:playTurn(2) end) then noter("  ⚠ fightBasic:playTurn a échoué : tour rendu à AnkaBot", "erreur") end
  else
    noter("  tours de test finis : main rendue à AnkaBot")
  end
end

function fightManagement()
  local t0 = maintenant()
  local manche = lire(function() return fightAction:getCurrentTurn() end)
  local relance = manche == dernierAppel
  appelsCetteManche = relance and appelsCetteManche + 1 or 1
  dernierAppel = manche
  noter("")
  noter(string.format("[%.3f] %s : fightManagement lancé (manche AnkaBot %s, %s PA, %s PM, case %s, isItMyTurn %s)%s",
    t0, moi(), manche, lire(function() return fightCharacter:getAP() end), lire(function() return fightCharacter:getMP() end),
    lire(function() return fightCharacter:getCellId() end), tostring(monTour()),
    relance and (" — ⚠ RELANCÉ dans la même manche (" .. appelsCetteManche .. "e appel)") or ""))
  if not monTour() then
    local attendu = 0
    while not monTour() and attendu < ATTENTE_MON_TOUR do
      pause(PAS_MS)
      attendu = attendu + PAS_MS
    end
    if not monTour() then
      noter("  isItMyTurn() resté faux " .. attendu .. " ms : rien fait", "erreur")
      ecrire()
      return
    end
    noter("  isItMyTurn() devenu vrai après " .. attendu .. " ms")
  end
  if not relance then toursTestes = toursTestes + 1 end
  if toursTestes > TOURS_DE_TEST then
    finir()
    ecrire()
    return
  end
  local mode = MODES[((toursTestes - 1) % #MODES) + 1]
  local tDebut = maintenant()
  local fini, detail = TESTS[mode](tDebut)
  if fini then
    noter(string.format("  ⛔ COUPÉ après %d ms — mode %s%s (tour de test %d)", fini, mode, detail, toursTestes), "erreur")
  else
    noter(string.format("  ✓ tour gardé %d ms — mode %s%s (tour de test %d) : main rendue, AnkaBot passe le tour",
      ecoule(tDebut), mode, detail, toursTestes), "succes")
  end
  ecrire()
end

function move()
  local carte = nil
  pcall(function() carte = map:currentMapId() end)
  return { { map = tostring(carte), forcefight = true } }
end

noter("[TEST] tours passés : " .. TOURS_DE_TEST .. " tours de test (" .. table.concat(MODES, ", ") .. "), attente " .. ATTENTE_MS .. " ms")
