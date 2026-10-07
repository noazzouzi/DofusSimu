--[[
  Journal de combats pour DofusSimu — AnkaBot PC (Dofus 3), connexion en mode MITM (Dofus ouvert, tu joues toi-même).

  Ce script s'abonne à TOUS les noms de messages possibles (obfusqués : 3 ou 4 lettres, plus une liste de noms en
  clair), convertit chaque message reçu en JSON (Lua pur : AnkaBot PC ne documente aucun sérialiseur) et ajoute, en
  combat, des « photos » lisibles de l'état du combat (cases, PV, PA, PM, bouclier, résistances, états de chaque
  entité). Tout est envoyé par HTTP au récepteur local de DofusSimu, qui l'écrit dans data/fightlogs/ :

      node scripts/fightlog-server.mjs      (dans le dossier DofusSimu, à lancer AVANT de charger ce script)

  Méthodes AnkaBot utilisées (toutes documentées sur doc.ankabot.dev, version PC) :
    developer:registerMessage, developer:isMessageRegistred, developer:typeOf, developer:postRequest,
    character:isInFight, fightAction:getAllEntities, fightAction:getCurrentTurn, map:currentMapId,
    global:printMessage, global:printSuccess, global:printError.

  Utilisation :
    1. Lancer le récepteur (node scripts/fightlog-server.mjs).
    2. Connecter le personnage dans AnkaBot, passer en MITM (bouton MITM), charger ce script.
       L'abonnement se fait au chargement (messagesRegistering) et reste actif même script arrêté (doc AnkaBot) :
       inutile de le lancer.
    3. Jouer normalement. La console affiche le nombre de messages journalisés et les erreurs d'envoi.

  Première utilisation : laisser DIAGNOSTIC = true. La console montre les premiers noms de messages reçus, leur type
  et un extrait de leur contenu : cela vérifie que la conversion en JSON voit bien les champs des messages.
--]]

-- ───────────────────────────── réglages ─────────────────────────────

LOG_URL = "http://127.0.0.1:8765/log"     -- récepteur local (node scripts/fightlog-server.mjs)
ALPHABET = "abcdefghijklmnopqrstuvwxyz"   -- lettres des noms obfusqués
NAME_LENGTHS = { 3, 4 }                   -- longueurs des noms obfusqués écoutés (3 : 17 576 noms, 4 : 456 976 noms)
FLUSH_EVERY = 200                         -- lignes accumulées avant un envoi au récepteur
SNAPSHOT_EVERY = 15                       -- en combat : une photo de l'état tous les N messages (et à chaque tour)
MAX_DEPTH = 10                            -- profondeur maximale de conversion d'un message
MAX_LINE = 200000                         -- taille maximale d'une ligne JSON (au-delà : tronquée et marquée)
MAX_BUFFER = 50000                        -- lignes gardées si le récepteur est injoignable (les plus anciennes sont perdues)
DIAGNOSTIC = true                         -- affiche les premiers messages reçus et un extrait de leur contenu
DIAGNOSTIC_NAMES = 40                     -- nombre de noms différents affichés en diagnostic

-- Noms de messages en clair à écouter en plus (protocole Dofus 2 : en Dofus 3 la plupart sont obfusqués, un nom absent
-- est simplement ignoré). Compléter librement.
EXTRA_MESSAGES = {
  "GameFightStartingMessage", "GameFightStartMessage", "GameFightEndMessage", "GameFightJoinMessage",
  "GameFightPlacementPossiblePositionsMessage", "GameFightShowFighterMessage", "GameFightSynchronizeMessage",
  "GameFightTurnStartMessage", "GameFightTurnEndMessage", "GameFightTurnListMessage", "GameFightNewRoundMessage",
  "GameFightNewWaveMessage", "GameActionFightSpellCastMessage", "GameActionFightLifePointsLostMessage",
  "GameActionFightLifeAndShieldPointsLostMessage", "GameActionFightLifePointsGainMessage",
  "GameActionFightPointsVariationMessage", "GameActionFightDeathMessage", "GameActionFightSlideMessage",
  "GameActionFightTeleportOnSameMapMessage", "GameActionFightExchangePositionsMessage",
  "GameActionFightDispellableEffectMessage", "GameActionFightSummonMessage", "GameActionFightMarkCellsMessage",
  "GameActionFightUnmarkCellsMessage", "GameMapMovementMessage", "SequenceStartMessage", "SequenceEndMessage",
  "CurrentMapMessage", "MapComplementaryInformationsDataMessage", "ChatServerMessage",
}

-- ───────────────────────────── état ─────────────────────────────

local buffer = {}
local seq = 0
local fightIndex = 0
local wasInFight = false
local lastTurn = -1
local sinceSnapshot = 0
local sent, dropped, failures = 0, 0, 0
local seenNames, seenCount = {}, 0

-- ───────────────────────────── JSON (Lua pur) ─────────────────────────────

local function jsonString(s)
  s = tostring(s)
  s = s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    if c == '\n' then return '\\n' end
    if c == '\r' then return '\\r' end
    if c == '\t' then return '\\t' end
    return string.format('\\u%04x', c:byte())
  end)
  return '"' .. s .. '"'
end

local function jsonNumber(v)
  if v ~= v or v == math.huge or v == -math.huge then return 'null' end
  if math.floor(v) == v and math.abs(v) < 9007199254740992 then return string.format('%.0f', v) end
  return string.format('%.17g', v)
end

-- Paires (clé, valeur) d'une table ou d'un objet (nil si l'objet ne se parcourt pas).
local function entries(v)
  local ok, res = pcall(function()
    local out = {}
    for k, x in pairs(v) do out[#out + 1] = { k, x } end
    return out
  end)
  if ok then return res end
  return nil
end

local function isArray(list)
  if #list == 0 then return false end
  for i, kv in ipairs(list) do
    if kv[1] ~= i then return false end
  end
  return true
end

local function typeName(v)
  local ok, t = pcall(function() return developer:typeOf(v) end)
  if ok and t ~= nil then return tostring(t) end
  return type(v)
end

-- Écrit `v` en JSON dans `out` (table de morceaux) ; `budget` = taille restante, renvoie la nouvelle taille restante.
local function encode(v, depth, out, budget, seen)
  if budget <= 0 then return budget end
  local t = type(v)
  local piece
  if v == nil then piece = 'null'
  elseif t == 'boolean' then piece = tostring(v)
  elseif t == 'number' then piece = jsonNumber(v)
  elseif t == 'string' then piece = jsonString(v)
  elseif t == 'function' or t == 'thread' then piece = 'null'
  elseif depth > MAX_DEPTH then piece = '{"$depth":true}'
  elseif seen[v] then piece = '{"$cycle":true}'
  else
    local list = entries(v)
    if list == nil then
      -- Objet qui ne se parcourt pas : son type et sa représentation texte.
      piece = '{"$type":' .. jsonString(typeName(v)) .. ',"$str":' .. jsonString(tostring(v)) .. '}'
    else
      seen[v] = true
      if isArray(list) then
        out[#out + 1] = '['
        budget = budget - 1
        for i, kv in ipairs(list) do
          if i > 1 then out[#out + 1] = ',' budget = budget - 1 end
          budget = encode(kv[2], depth + 1, out, budget, seen)
          if budget <= 0 then break end
        end
        out[#out + 1] = ']'
      else
        out[#out + 1] = '{'
        budget = budget - 1
        local first = true
        if t ~= 'table' then
          out[#out + 1] = '"$type":' .. jsonString(typeName(v))
          first = false
        end
        for _, kv in ipairs(list) do
          if not first then out[#out + 1] = ',' budget = budget - 1 end
          first = false
          local key = jsonString(kv[1])
          out[#out + 1] = key .. ':'
          budget = budget - #key - 1
          budget = encode(kv[2], depth + 1, out, budget, seen)
          if budget <= 0 then break end
        end
        out[#out + 1] = '}'
      end
      seen[v] = nil
      return budget - 1
    end
  end
  out[#out + 1] = piece
  return budget - #piece
end

local function toJson(v)
  local out = {}
  local left = encode(v, 0, out, MAX_LINE, {})
  if left <= 0 then return '{"$truncated":true}' end
  return table.concat(out)
end

-- ───────────────────────────── envoi au récepteur ─────────────────────────────

local function flush()
  if #buffer == 0 then return end
  local body = table.concat(buffer, "\n")
  local ok, res = pcall(function()
    return developer:postRequest(LOG_URL, body, { "Content-Type" }, { "text/plain; charset=utf-8" })
  end)
  -- Le récepteur répond « ok <lignes> » : toute autre réponse (erreur de connexion renvoyée en texte…) est un échec.
  if ok and type(res) == "string" and res:sub(1, 2) == "ok" then
    sent = sent + #buffer
    buffer = {}
  else
    failures = failures + 1
    if failures == 1 or failures % 50 == 0 then
      global:printError("[journal] récepteur injoignable (" .. LOG_URL .. ", node scripts/fightlog-server.mjs) : " .. tostring(res))
    end
    -- Garder les lignes pour le prochain envoi, dans la limite de MAX_BUFFER (les plus anciennes sont perdues).
    if #buffer > MAX_BUFFER then
      local excess = #buffer - MAX_BUFFER
      local kept = {}
      for i = excess + 1, #buffer do kept[#kept + 1] = buffer[i] end
      buffer = kept
      dropped = dropped + excess
    end
  end
end

local function push(line)
  buffer[#buffer + 1] = line
  if #buffer >= FLUSH_EVERY then flush() end
end

-- ───────────────────────────── photos de l'état du combat ─────────────────────────────

local function get(obj, key)
  local ok, v = pcall(function() return obj[key] end)
  if ok then return v end
  return nil
end

local STAT_KEYS = {
  "shieldPoints", "actionPoints", "movementPoints", "summoner", "summoned",
  "neutralElementResistPercent", "earthElementResistPercent", "waterElementResistPercent", "airElementResistPercent",
  "fireElementResistPercent", "neutralElementReduction", "earthElementReduction", "waterElementReduction",
  "airElementReduction", "fireElementReduction", "criticalDamageFixedResist", "pushDamageFixedResist",
  "dodgePALostProbability", "dodgePMLostProbability", "tackleBlock", "tackleEvade", "fixedDamageReflection",
  "invisibilityState", "meleeDamageReceivedPercent", "rangedDamageReceivedPercent", "weaponDamageReceivedPercent",
  "spellDamageReceivedPercent",
}
local ENTITY_KEYS = { "Id", "CellId", "Team", "AP", "MP", "LifePoints", "MaxLifePoints", "Level", "CreatureGenericId" }

local function entityJson(e)
  local parts = {}
  for _, k in ipairs(ENTITY_KEYS) do parts[#parts + 1] = jsonString(k) .. ':' .. toJson(get(e, k)) end
  -- Liste d'états : conversion générique (table Lua ou liste parcourable), sans supposer sa forme.
  parts[#parts + 1] = '"States":' .. toJson(get(e, "States"))
  local stats = get(e, "Stats")
  if stats ~= nil then
    local sp = {}
    for _, k in ipairs(STAT_KEYS) do sp[#sp + 1] = jsonString(k) .. ':' .. toJson(get(stats, k)) end
    parts[#parts + 1] = '"Stats":{' .. table.concat(sp, ',') .. '}'
  end
  return '{' .. table.concat(parts, ',') .. '}'
end

local function snapshot(reason)
  local ok, err = pcall(function()
    local entities = fightAction:getAllEntities()
    local list = {}
    for _, e in ipairs(entities) do list[#list + 1] = entityJson(e) end
    seq = seq + 1
    push('{"k":"s","i":' .. seq .. ',"f":' .. fightIndex .. ',"r":' .. jsonString(reason) ..
      ',"turn":' .. toJson(fightAction:getCurrentTurn()) .. ',"map":' .. toJson(map:currentMapId()) ..
      ',"e":[' .. table.concat(list, ',') .. ']}')
  end)
  if not ok and DIAGNOSTIC then global:printError("[journal] photo impossible : " .. tostring(err)) end
end

local function event(name)
  seq = seq + 1
  local mapId = nil
  pcall(function() mapId = map:currentMapId() end)
  push('{"k":"e","i":' .. seq .. ',"f":' .. fightIndex .. ',"ev":' .. jsonString(name) .. ',"map":' .. toJson(mapId) .. '}')
end

-- Début / fin de combat et photos régulières (appelé à chaque message).
local function watchFight()
  local inFight = false
  pcall(function() inFight = character:isInFight() == true end)
  if inFight and not wasInFight then
    fightIndex = fightIndex + 1
    lastTurn = -1
    sinceSnapshot = 0
    event("fightStart")
    snapshot("start")
    global:printSuccess("[journal] combat n°" .. fightIndex .. " : enregistrement")
  elseif not inFight and wasInFight then
    event("fightEnd")
    flush()
    global:printSuccess("[journal] combat n°" .. fightIndex .. " terminé — " .. sent .. " lignes envoyées" ..
      (dropped > 0 and (", " .. dropped .. " perdues") or ""))
  end
  wasInFight = inFight
  if inFight then
    sinceSnapshot = sinceSnapshot + 1
    local turn = -1
    pcall(function() turn = fightAction:getCurrentTurn() end)
    if turn ~= lastTurn then
      lastTurn = turn
      sinceSnapshot = 0
      snapshot("turn")
    elseif sinceSnapshot >= SNAPSHOT_EVERY then
      sinceSnapshot = 0
      snapshot("periodic")
    end
  end
end

-- ───────────────────────────── messages ─────────────────────────────

local function onMessage(name, message)
  local ok, err = pcall(function()
    watchFight()
    seq = seq + 1
    local tname = typeName(message)
    local data = toJson(message)
    push('{"k":"m","i":' .. seq .. ',"f":' .. fightIndex .. ',"n":' .. jsonString(name) ..
      ',"t":' .. jsonString(tname) .. ',"d":' .. data .. '}')
    if DIAGNOSTIC and not seenNames[name] and seenCount < DIAGNOSTIC_NAMES then
      seenNames[name] = true
      seenCount = seenCount + 1
      global:printMessage("[journal] " .. name .. " (type " .. tname .. ") : " .. data:sub(1, 240))
    end
  end)
  if not ok then global:printError("[journal] erreur sur " .. tostring(name) .. " : " .. tostring(err)) end
end

-- Une fonction par nom (la fonction appelée par AnkaBot reçoit le message seul, pas son nom).
local function handlerFor(name)
  return function(message) onMessage(name, message) end
end

local registered = 0

local function listen(name)
  local ok = pcall(function() developer:registerMessage(name, handlerFor(name)) end)
  if ok then registered = registered + 1 end
end

local function eachName(len, prefix)
  if #prefix == len then
    listen(prefix)
    return
  end
  for i = 1, #ALPHABET do eachName(len, prefix .. ALPHABET:sub(i, i)) end
end

function messagesRegistering()
  for _, name in ipairs(EXTRA_MESSAGES) do listen(name) end
  for _, len in ipairs(NAME_LENGTHS) do eachName(len, "") end
  local check = "jqy"
  local okCheck, isReg = pcall(function() return developer:isMessageRegistred(check) end)
  global:printSuccess("[journal] " .. registered .. " noms de messages écoutés" ..
    (okCheck and (" (" .. check .. " enregistré : " .. tostring(isReg) .. ")") or "") .. " → " .. LOG_URL)
  event("loggerStart")
  flush()
end

function move()
end
