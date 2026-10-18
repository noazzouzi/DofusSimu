-- ReineCombat.lua — généré le 2026-10-14 09:49 par tools/fightlog/combat.ts. Ne pas éditer : régénérer.
-- Script de combat de la Reine des Voleurs, à charger sur le chef (AnkaBot le charge sur les mules) :
--   1. journal AnkaBot (journal-combats.lua), réglé pour un script qui joue ;
--   2. IA du serveur de plans (modele-ia.lua) : le MODE AVANCÉ, pour les situations que le scénario ne connaît pas ;
--   3. scénarios des placements (modele-rejeu.lua) : placement, puis chaque tour d'une situation connue joué tout de
--      suite, sans serveur ; situation inconnue : l'IA du serveur joue ce tour.
-- Avant de le charger : lancer le serveur (lancer_serveur_reine.cmd, à côté) pour le journal et le mode avancé.
-- PAS de DEVELOPER_MULTI_THREADING : essayé le 2026-10-10, il fait tourner deux fils dans la même machine Lua.

--[[
  Journal de combats pour DofusSimu — AnkaBot PC (Dofus 3). Version 2026-10-10b.

  But : enregistrer TOUT ce que le serveur envoie aux personnages (combat compris : déplacements, sorts lancés, cibles,
  cases, dégâts, soins, PA/PM, poussées, échanges, invocations, effets, états, tours, manches…) pour pouvoir rejouer un
  combat pas à pas. Le script s'abonne à tous les noms de messages possibles (obfusqués : 3 lettres de a à z, plus une
  liste de noms en clair), convertit chaque message reçu en JSON et l'envoie par HTTP au récepteur local de DofusSimu,
  qui l'écrit dans data/fightlogs/ :

      node scripts/fightlog-server.mjs      (dans le dossier DofusSimu, à lancer AVANT de charger ce script et à
                                             laisser tourner pendant tout le jeu ; bilan : node scripts/fightlog-check.mjs)

  Groupe AnkaBot : charger le script sur le chef seulement, AnkaBot le charge aussi sur les mules. Chaque personnage a
  donc sa propre instance, qui envoie sous son nom (character:name()) : le récepteur sépare les journaux (chacun voit
  aussi ses informations privées : sorts, modificateurs). Si le récepteur ne répond pas, les lignes vont dans un
  fichier de secours à côté du script (journal-combats_<personnage>_<instance>.jsonl).

  Règle d'or (doc AnkaBot, « Exécution en parallèle ») : un seul fil d'exécution entre dans le script à la fois. Un
  message qui arrive pendant que le script est occupé ailleurs (chargement) est perdu, et une fonction abonnée lente
  retarde tous les messages suivants du compte. Le script ne fait donc jamais de long travail d'un coup :
    - travail de fond (recherche des champs d'un type inconnu, historique d'avant le chargement) par petites tranches
      à chaque message reçu : WORK_FIGHT_MS en combat, WORK_IDLE_MS hors combat ;
    - un message dont un type n'est pas encore connu est écrit avec {"$pending":<type>} à la place de ce type, gardé en
      mémoire, puis réécrit en entier dans une ligne « p » dès que ses types sont trouvés.
  (Version du 2026-10-10 : l'historique relu d'un bloc au premier message a bloqué les personnages plus de 15 minutes,
  et rien n'a été enregistré.)

  Lignes envoyées (une par ligne JSON ; « ms » = horloge du script en millisecondes, os.clock, voir plus bas) :
    {"k":"m","i":<n°>,"ms":…,"f":<combat, 0 hors combat>,"n":<message>,"d":<contenu>}  message reçu
    {"k":"h","i":…,"ms":…,"n":<message>,"j":<rang>,"of":<total>,"d":…}       message reçu AVANT le chargement du script
                                    (developer:historicalMessage : connexion, caractéristiques, sorts, équipement…)
    {"k":"p","i":…,"ms":…,"of":<n° de la ligne complétée>,"src":"m"|"h","n":<message>,"d":…}
                                    contenu complet d'une ligne m ou h écrite avec des {"$pending":…}
    {"k":"s","i":…,"ms":…,"f":…,"r":<raison>,"turn":…,"map":…,"e":[…]}       photo de l'état du combat (AnkaBot)
    {"k":"e","i":…,"ms":…,"f":…,"ev":<événement>,…}                          chargement, combats, historique, mesures
    {"k":"x","i":…,"ms":…,"n":<message>,"err":<texte>}                       message perdu ou incomplet (erreur)
    {"k":"c","i":…,"ms":…,"why":…,"n":{<message>:<reçus>…},…}                compteurs (pour vérifier qu'il ne manque rien)
    {"k":"t","t":<clé>,"f":[<champs>]}                                       champs d'un type découvert (ou, pour une
                                                                             clé « k:… », sa nature)
  Les numéros « i » d'une instance se suivent sans trou : un trou signale des lignes perdues.

  Lecture des messages Dofus 3 (constaté en jeu) : ce sont des objets Protobuf .NET
  (Com.Ankama.Dofus.Server.Game.Protocol.Obfuscated.<nom>), pas des tables Lua.
    - pairs échoue, et tostring() plante dans Google.Protobuf (NullReferenceException dans get_Descriptor) : une
      exception .NET que pcall ne rattrape pas. Le script n'appelle donc JAMAIS tostring sur un message.
    - developer:typeOf ne renvoie pas de nom de type pour ces objets.
    - L'accès par nom marche (message.fwab) ; un nom absent lève une erreur Lua, rattrapée par pcall, mais coûteuse :
      les essais de noms ne se font qu'en travail de fond (ou par la réflexion .NET si AnkaBot la permet).
  Les champs ont des noms de 4 lettres numérotés dans l'ordre des types (hms → fofl…, jnz → fwab…, puis g…), presque
  consécutifs pour un même type. Champs d'un type : réflexion .NET (GetType():GetProperties(), essayée une fois par
  session), sinon liste mémorisée (data/fightlogs/schemas.json, servie par le récepteur), sinon recherche en partant
  d'un point estimé puis autour du premier champ trouvé. Un type est désigné par le nom du message (« m:jnz ») ou par
  le champ qui le contient (« f:fxet ») ; sa nature (message, liste, dictionnaire, octets, Any) est aussi mémorisée
  (« k:<clé> »). Une liste mémorisée est revérifiée par son premier champ (rotation des noms par Ankama).
  Les champs Protobuf « Any » (TypeUrl + octets) sont décodés par le parseur du type nommé (createMessage(nom).Parser) ;
  si cela échoue, leurs octets sont gardés en base64.

  Texte JSON : parcouru octet par octet (string.byte), pas par motif : sous MoonSharp, les motifs ne voient que l'octet
  de poids faible des caractères au-delà de U+00FF (« ’ », U+2019, passerait pour le contrôle 0x19).
  Horloge : os.clock de MoonSharp (secondes depuis le démarrage de l'interpréteur) ; « loggerStart » donne aussi
  os.time (heure Unix) pour la recaler ; le récepteur horodate chaque lot à la réception.

  Rechargement du script : l'ancienne instance peut rester abonnée (2026-10-09 : 4 instances en parallèle pour un même
  personnage, AnkaBot répartissant les messages entre elles). Chaque instance a un identifiant (paramètre &i= des
  envois, repris par le récepteur) et la console signale une autre instance (mémoire globale d'AnkaBot). Pour n'en
  garder qu'une : redémarrer AnkaBot avant de recharger le script.

  Méthodes AnkaBot utilisées (doc.ankabot.dev, version PC) : developer:registerMessage, developer:unRegisterMessage,
  developer:isMessageRegistred, developer:historicalMessage, developer:typeOf, developer:createMessage,
  developer:postRequest, developer:getRequest, developer:addInGlobalMemory, developer:editInGlobalMemory,
  developer:getInGlobalMemory, global:isBoss, global:getCurrentScriptDirectory, character:isInFight, character:name,
  character:id, character:level, character:breed, character:server, fightAction:getAllEntities,
  fightAction:getCurrentTurn, map:currentMapId, global:printMessage, global:printSuccess, global:printError.

  Utilisation :
    1. Lancer le récepteur (node scripts/fightlog-server.mjs) et le laisser tourner.
    2. Redémarrer AnkaBot si le script avait déjà été chargé (anciennes instances), puis charger ce script sur le chef
       du groupe, SANS le lancer : l'abonnement se fait au chargement (messagesRegistering) et reste actif script
       arrêté. Attendre « [journal] … prêt » pour chaque personnage (quelques secondes ; les messages reçus pendant le
       chargement sont perdus, l'historique en rattrape une partie).
    3. Jouer normalement.
    4. Après le combat : node scripts/fightlog-check.mjs (bilan : combats, lignes perdues, erreurs, contenus en
       attente).

  DIAGNOSTIC = true affiche les premiers messages reçus et chaque type découvert (nombre de champs, essais, durée).
--]]

-- ───────────────────────────── réglages ─────────────────────────────

LOGGER_VERSION = "2026-10-10b"
LOG_URL = "http://127.0.0.1:8765/log"         -- récepteur local (node scripts/fightlog-server.mjs)
SCHEMA_URL = "http://127.0.0.1:8765/schemas"  -- champs des types déjà découverts, servis par le récepteur
HTTP_RETRY_SECONDS = 60                   -- récepteur injoignable : nouvel essai après N s (fichier de secours entre-temps)
FALLBACK_FILE = true                      -- fichier de secours à côté du script si le récepteur ne répond pas
ALPHABET = "abcdefghijklmnopqrstuvwxyz"       -- lettres des noms obfusqués
-- Longueurs des noms de messages écoutés. Les messages Dofus 3 ont 3 lettres (jqy, hpm, jnz, kpy : 17 576 noms) ; les
-- noms de 4 lettres sont ceux des champs (fwab, fxsc). Ajouter 4 = 456 976 abonnements de plus, ~20 s de chargement.
NAME_LENGTHS = { 3 }
-- Noms écoutés seulement (table nom → true) ; nil : tous les noms de NAME_LENGTHS lettres, plus EXTRA_MESSAGES. Le
-- script de combat (ReineCombat.lua) n'écoute que ceux dont le serveur de plans a besoin : avec les 17 588 abonnements,
-- des tours ont été passés (2026-10-10) ; le rejeu seul, sans journal, a joué chaque tour.
ONLY_NAMES = nil
UNREGISTER_FIRST = false                  -- se désabonner de chaque nom avant de s'y abonner (double le chargement)
FIELD_PREFIXES = { "e", "f", "g" }        -- premières lettres possibles des champs, DANS L'ORDRE (numérotation croissante)
FIELD_GAP = 200                           -- autour du premier champ trouvé : arrêt après N noms absents d'affilée
NESTED_BACK = 3000                        -- un type imbriqué est cherché à partir de N noms avant les champs du parent
REFLECTION = true                         -- essayer la réflexion .NET pour lire les champs d'un type
-- Travail de fond par message reçu (recherche de champs, historique, contenus en attente), en millisecondes.
WORK_FIGHT_MS = 25
WORK_IDLE_MS = 150
HISTORY = true                            -- relire les messages reçus avant le chargement (developer:historicalMessage)
HISTORY_MAX = 100                         -- messages d'historique gardés au plus par nom (les plus récents)
HISTORY_IN_FIGHT = false                  -- relire aussi l'historique pendant les combats
HISTORY_SLOW_MS = 1500                    -- un appel plus long arrête la relecture de l'historique (protection)
HISTORY_NAMES = nil                       -- noms relus seulement (table nom → true) ; nil : tous
PENDING_MAX = 3000                        -- messages en attente de leurs types gardés au plus
MAX_ITEMS = 20000                         -- éléments convertis au plus par liste
MAX_DEPTH = 40                            -- profondeur maximale de conversion d'un message
MAX_LINE = 2000000                        -- taille maximale d'une ligne JSON (au-delà : tronquée et marquée)
MAX_BUFFER = 100000                       -- lignes gardées en mémoire si ni le récepteur ni le fichier ne marchent
FLUSH_EVERY = 25                          -- lignes accumulées avant un envoi au récepteur
FLUSH_SECONDS = 1                         -- envoi au plus tard N secondes après le précédent (à l'arrivée d'un message)
COUNTS_EVERY = 3000                       -- une ligne de compteurs tous les N messages (et à chaque fin de combat)
SNAPSHOT_EVERY = 15                       -- en combat : une photo de l'état tous les N messages (et à chaque tour)
FLUSH_AFTER_FIGHT = 30                    -- envoi forcé N messages après la fin d'un combat (résultats, XP, butin)
INSTANCE_CHECK_EVERY = 500                -- vérifier tous les N messages qu'aucune autre instance n'a pris le relais
-- Combats : character:isInFight() n'est pas fiable en Dofus 3 (le 2026-10-09, 1 898 actions de combat sur 2 345 sont
-- arrivées alors qu'il valait faux). Un combat est donc en cours si AnkaBot le dit OU si un message de combat
-- (FIGHT_MESSAGES) est arrivé depuis moins de FIGHT_END_SECONDS ; un message de manche 1 (ROUND_MESSAGE.ROUND_FIELD = 1)
-- après une autre manche 1 commence un nouveau combat (combats enchaînés). Tout est enregistré dans tous les cas :
-- seuls le numéro de combat « f », les photos d'état, les compteurs de fin et le rythme du travail de fond en dépendent.
FIGHT_END_SECONDS = 90
-- Noms obfusqués du 2026-10-09 (tools/reine-des-voleurs/planificateur/journal.ts, PROTO ; à relever après une rotation
-- des noms par Ankama) : jvj début de tour, jup fin de tour, jvi nouvelle manche (fxjj = numéro), jsq action de combat.
URGENT_MESSAGES = { jvj = true, jvi = true, jsq = true }    -- envoyés aussitôt (section « Reine » en direct)
FIGHT_MESSAGES = { jvj = true, jup = true, jvi = true, jsq = true }  -- preuves qu'un combat est en cours
ROUND_MESSAGE, ROUND_FIELD = "jvi", "fxjj"
SNAPSHOT_MESSAGES = { jvj = true }                         -- photo de l'état juste après ces messages
FIGHT_SNAPSHOTS = true                    -- photos de l'état en combat (à chaque tour, tous les SNAPSHOT_EVERY messages)
-- Silence autour de son propre tour (script d'IA, ReineIA.lua) : du début du tour du combattant qui joue juste avant ce
-- personnage jusqu'à la fin de son tour, le journal ne convertit ni n'envoie rien (il compte seulement : « quiet »).
-- Combat du 2026-10-10 à 13:10 : aux tours passés, fightManagement n'a pas été lancé, et le journal du joueur traitait
-- alors sans arrêt la rafale de messages du changement de tour (un message toutes les 1 à 5 ms pendant 0,3 à 1 s) ; le
-- script reste ainsi libre pour fightManagement. Les journaux des autres personnages couvrent ces tours.
QUIET_AROUND_MY_TURN = false
QUIET_MAX_SECONDS = 120                   -- silence levé au plus tard N secondes après son début (sécurité)
TURN_START, TURN_START_FIELD = "jvj", "fxjr"   -- début de tour : identifiant du combattant
TURN_END, TURN_END_FIELD = "jup", "fxgo"       -- fin de tour : identifiant du combattant
FIGHT_END_MESSAGE = "jwh"                      -- fin du combat (le silence s'arrête là, comme à la manche 1)
-- false : journal coupé, aucun message écouté (test : un script qui joue passe-t-il encore des tours sans le journal ?).
ENABLED = true
DIAGNOSTIC = true                         -- affiche les premiers messages reçus et les types découverts
DIAGNOSTIC_NAMES = 30                     -- nombre de noms de messages différents affichés en diagnostic
DIAGNOSTIC_TYPES = 40                     -- nombre de types découverts affichés en diagnostic

-- Noms de messages en clair à écouter en plus (protocole Dofus 2 : en Dofus 3 la plupart sont obfusqués, un nom absent
-- est simplement ignoré).
EXTRA_MESSAGES = {
  "GameFightStartingMessage", "GameFightStartMessage", "GameFightEndMessage", "GameFightJoinMessage",
  "GameFightTurnStartMessage", "GameFightTurnEndMessage", "GameFightNewRoundMessage", "GameActionFightSpellCastMessage",
  "GameActionFightLifePointsLostMessage", "GameActionFightDeathMessage", "GameMapMovementMessage", "ChatServerMessage",
}

-- Propriétés essayées sur les entités de fightAction:getAllEntities() quand ce sont des objets .NET (une entité table
-- Lua est écrite entière).
ENTITY_KEYS = { "Id", "CellId", "Team", "AP", "MP", "LifePoints", "MaxLifePoints", "Level", "CreatureGenericId", "States",
  "Stats" }

-- ───────────────────────────── état ─────────────────────────────

local buffer = {}
local seq = 0
local fightIndex = 0
local wasInFight = false
local lastFightSignal = nil                -- horloge du dernier signe de combat (AnkaBot ou message de combat)
local roundOneSeen = false                 -- manche 1 déjà vue dans le combat en cours
local lastTurn = -1
local sinceSnapshot = 0
local untilTailFlush = 0
local sent, dropped, failures, errors, saved = 0, 0, 0, 0, 0
local lastFlushTime = 0
local httpDownSince = nil                  -- heure du dernier échec d'envoi (le récepteur est alors laissé tranquille)
local fallback, fallbackPath, fallbackTried = nil, nil, false
local seenNames, seenCount = {}, 0
local counts, received, sinceCounts = {}, 0, 0
local instance, postUrl = nil, nil
local schemas, verified, kinds = {}, {}, {}  -- par clé (m:<message>, f:<champ>, a:<type>) : champs, vérifiés, nature
local discovered = 0
local parsers = {}                           -- parseur Protobuf par nom de type (décodage des Any), false si impossible
-- Opérations qui peuvent lever une exception .NET (hors de portée de pcall) : `danger` est posé avant, retiré après.
-- S'il est encore posé au message suivant, l'opération a planté : elle est désactivée (disabled[danger]).
local danger, disabled = nil, {}
local workUntil = 0                          -- fin du travail de fond permis pour le message en cours (horloge)
local scans, scanOrder = {}, {}              -- recherches de champs en cours (par clé), dans l'ordre d'arrivée
local pendingMsgs = {}                       -- lignes m/h en attente de leurs types : { i, k, n, obj }
local resolvedSince = false                  -- un type a été trouvé depuis le dernier essai des lignes en attente
local reflection = REFLECTION and "untested" or "off"
local historyState = HISTORY and "on" or "off"   -- on → done (file vide) / stopped (trop lent ou planté)
local historyQueue, historyQueued, historyPos = {}, {}, 1
local hstats = { calls = 0, ms = 0, max = 0, names = 0, kept = 0, started = false }
local perfDone = false
local otherInstance = false
-- Garde : un message traité pendant un autre (deux fils dans le script, DEVELOPER_MULTI_THREADING — à ne pas utiliser :
-- le 2026-10-10 il a corrompu la machine Lua) est compté (« parallel » des compteurs) et ignoré.
local inMessage, parallel = false, 0
-- Silence autour de son tour (QUIET_AROUND_MY_TURN) : identifiant du personnage, combattant qui joue juste avant lui,
-- dernier combattant à avoir commencé son tour, début du silence (horloge), messages comptés sans être écrits.
local myFighterId, prevOfMe, lastStarter, quietSince, quietCount, myTurnOn = nil, nil, nil, nil, 0, false
local entityKeys = nil

-- ───────────────────────────── JSON (Lua pur, compatible MoonSharp) ─────────────────────────────

local ESCAPES = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t', ['\b'] = '\\b',
  ['\f'] = '\\f' }

-- Chaîne JSON, octet par octet (voir l'en-tête : sous MoonSharp, string.byte rend 63 pour un caractère au-delà de
-- U+00FF, jamais échappé ; le motif ne sert que de filtre rapide).
local function jsonString(s)
  s = tostring(s)
  if not s:find('[%c"\\]') then return '"' .. s .. '"' end
  local parts, from, n = {}, 1, #s
  for i = 1, n do
    local b = s:byte(i)
    if b < 32 or b == 34 or b == 92 or b == 127 then
      if i > from then parts[#parts + 1] = s:sub(from, i - 1) end
      parts[#parts + 1] = ESCAPES[string.char(b)] or string.format('\\u%04x', b)
      from = i + 1
    end
  end
  if from <= n then parts[#parts + 1] = s:sub(from, n) end
  return '"' .. table.concat(parts) .. '"'
end

local INF = 1 / 0                            -- sous MoonSharp, math.huge n'est pas l'infini

local function jsonNumber(v)
  if v ~= v or v == INF or v == -INF then return 'null' end
  if math.floor(v) == v and math.abs(v) < 9007199254740992 then return string.format('%.0f', v) end
  return string.format('%.17g', v)
end

local function jsonNames(names)
  local parts = {}
  for i, name in ipairs(names) do parts[i] = jsonString(name) end
  return '[' .. table.concat(parts, ',') .. ']'
end

-- Paires (clé, valeur) d'une table Lua (nil si elle ne se parcourt pas).
local function entries(v)
  local ok, res = pcall(function()
    local out = {}
    for k, x in pairs(v) do out[#out + 1] = { k, x } end
    return out
  end)
  if ok then return res end
  return nil
end

-- Liste Lua (clés entières 1..n) : l'ordre de pairs n'est pas garanti, les paires sont donc triées par clé.
local function isArray(list)
  if #list == 0 then return false end
  for _, kv in ipairs(list) do
    local k = kv[1]
    if type(k) ~= 'number' or k < 1 or k > #list or math.floor(k) ~= k then return false end
  end
  table.sort(list, function(a, b) return a[1] < b[1] end)
  return true
end

-- ───────────────────────────── horloge ─────────────────────────────

local function clock()
  local ok, t = pcall(os.clock)
  if ok and type(t) == 'number' then return t end
  return 0
end

local function nowMs() return math.floor(clock() * 1000 + 0.5) end

local function unixTime()
  local ok, t = pcall(os.time)
  if ok and type(t) == 'number' then return t end
  return nil
end

-- Début d'une ligne numérotée : {"k":<k>,"i":<n°>,"ms":<horloge>
local function head(k)
  seq = seq + 1
  return '{"k":"' .. k .. '","i":' .. seq .. ',"ms":' .. nowMs()
end

-- Identifiant de cette instance du script (unique : heure, horloge et adresse d'une table propre à cet état Lua).
local INSTANCE_ID = string.format("%d-%d-%s", math.floor(unixTime() or 0), math.floor(clock() * 1000) % 1000000,
  tostring({}):match("(%x+)$") or "0")

-- ───────────────────────────── envoi : récepteur, sinon fichier de secours ─────────────────────────────

local function instanceName()
  if instance == nil then
    local ok, n = pcall(function() return character:name() end)
    instance = (ok and type(n) == 'string' and n ~= '') and n or "?"
    postUrl = LOG_URL .. "?c=" .. (instance:gsub("[^%w%-_]", function(c) return string.format("%%%02X", c:byte()) end)) ..
      "&i=" .. INSTANCE_ID
  end
  return instance
end

-- Fichier de secours (ouvert une fois en écriture : MoonSharp refuse le mode « a »), vidé à chaque lot.
local function writeFallback(lines)
  if not FALLBACK_FILE then return false end
  if fallback == nil and not fallbackTried then
    fallbackTried = true
    local dir = nil
    pcall(function() dir = global:getCurrentScriptDirectory() end)
    local file = "journal-combats_" .. instanceName():gsub("[^%w%-_]", "_") .. "_" .. INSTANCE_ID .. ".jsonl"
    local path = (type(dir) == "string" and dir ~= "") and (dir:gsub("[\\/]$", "") .. "\\" .. file) or file
    local ok, f = pcall(io.open, path, "w")
    if ok and f ~= nil then
      fallback, fallbackPath = f, path
      global:printError("[journal] récepteur injoignable : lignes écrites dans " .. path)
    else
      global:printError("[journal] récepteur injoignable et fichier de secours impossible (" .. path .. ")")
    end
  end
  if fallback == nil then return false end
  local headLine = '{"k":"b","at":null,"local":true,"n":' .. #lines .. ',"c":' .. jsonString(instanceName()) ..
    ',"in":' .. jsonString(INSTANCE_ID) .. ',"unix":' .. jsonNumber(unixTime() or 0) .. '}'
  return (pcall(function()
    fallback:write(headLine, "\n", table.concat(lines, "\n"), "\n")
    fallback:flush()
  end))
end

local function flush()
  if #buffer == 0 then return end
  instanceName()
  local now = unixTime() or 0
  local ok, res = false, nil
  if httpDownSince == nil or now - httpDownSince >= HTTP_RETRY_SECONDS then
    -- Type sans paramètre : AnkaBot construit un MediaTypeHeaderValue, qui refuse « text/plain; charset=utf-8 ».
    local body = table.concat(buffer, "\n")
    ok, res = pcall(function()
      return developer:postRequest(postUrl, body, { "Content-Type" }, { "text/plain" })
    end)
    -- Le récepteur répond « ok <lignes> » : toute autre réponse (erreur de connexion renvoyée en texte…) est un échec.
    ok = ok and type(res) == "string" and res:sub(1, 2) == "ok"
  end
  if ok then
    if httpDownSince ~= nil then global:printSuccess("[journal] récepteur de nouveau joignable") end
    httpDownSince = nil
    sent = sent + #buffer
    lastFlushTime = now
    buffer = {}
    return
  end
  if res ~= nil then
    failures = failures + 1
    httpDownSince = now
    if failures == 1 or failures % 50 == 0 then
      global:printError("[journal] envoi au récepteur impossible (" .. LOG_URL .. ", node scripts/fightlog-server.mjs) : " ..
        tostring(res))
    end
  end
  lastFlushTime = now
  if writeFallback(buffer) then
    saved = saved + #buffer
    buffer = {}
  elseif #buffer > MAX_BUFFER then
    -- Ni récepteur ni fichier : les plus anciennes lignes sont perdues (trou dans les numéros « i », compteur
    -- « dropped » des lignes de compteurs).
    local excess = #buffer - MAX_BUFFER
    local kept = {}
    for i = excess + 1, #buffer do kept[#kept + 1] = buffer[i] end
    buffer = kept
    dropped = dropped + excess
  end
end

-- Envoi : tous les FLUSH_EVERY lignes, ou dès qu'une ligne urgente arrive, ou FLUSH_SECONDS après le dernier envoi.
local function push(line, urgent)
  buffer[#buffer + 1] = line
  if #buffer >= FLUSH_EVERY or urgent then
    flush()
    return
  end
  local t = unixTime()
  if t and t - lastFlushTime >= FLUSH_SECONDS then flush() end
end

-- Message perdu ou incomplet : écrit dans le journal (et en console, pour les premiers).
local function report(name, err)
  errors = errors + 1
  push(head("x") .. ',"f":' .. fightIndex .. ',"n":' .. jsonString(name) .. ',"err":' .. jsonString(err) .. '}')
  if errors <= 20 or errors % 100 == 0 then
    global:printError("[journal] " .. tostring(name) .. " : " .. tostring(err) .. " (" .. errors .. " erreur(s))")
  end
end

local function event(name, extra)
  local mapId = nil
  pcall(function() mapId = map:currentMapId() end)
  push(head("e") .. ',"f":' .. fightIndex .. ',"ev":' .. jsonString(name) .. ',"map":' ..
    (type(mapId) == "number" and jsonNumber(mapId) or 'null') .. (extra or '') .. '}')
end

-- Types découverts lors des sessions précédentes (lignes « <clé>\t<champ>,<champ>… » du récepteur) ; « k:<clé> » :
-- nature de la clé.
local function loadSchemas()
  local ok, res = pcall(function() return developer:getRequest(SCHEMA_URL) end)
  if not ok or type(res) ~= "string" then return 0 end
  local n = 0
  for line in res:gmatch("[^\r\n]+") do
    local key, list = line:match("^([^\t]+)\t([%w_,]*)$")
    if key then
      local fields = {}
      for name in list:gmatch("[^,]+") do fields[#fields + 1] = name end
      local kindKey = key:match("^k:(.+)$")
      if kindKey then kinds[kindKey] = fields[1] else
        schemas[key] = fields
        n = n + 1
      end
    end
  end
  return n
end

-- ───────────────────────────── objets .NET ─────────────────────────────

local function getField(o, k) return o[k] end
local function has(o, k) return (pcall(getField, o, k)) end

-- Espace des noms de champs : <préfixe><3 lettres>, numérotés de 0 à SPACE - 1 dans l'ordre de FIELD_PREFIXES.
local LETTERS, LETTER_INDEX, PREFIX_INDEX = {}, {}, {}
for i = 1, #ALPHABET do
  LETTERS[i] = ALPHABET:sub(i, i)
  LETTER_INDEX[LETTERS[i]] = i - 1
end
for i, p in ipairs(FIELD_PREFIXES) do PREFIX_INDEX[p] = i - 1 end
local N = #LETTERS
local BLOCK = N * N * N
local SPACE = #FIELD_PREFIXES * BLOCK

local function fieldName(i)
  local r = i % BLOCK
  return FIELD_PREFIXES[math.floor(i / BLOCK) + 1] .. LETTERS[math.floor(r / (N * N)) + 1] ..
    LETTERS[math.floor(r / N) % N + 1] .. LETTERS[r % N + 1]
end

local function fieldIndex(name)
  if type(name) ~= 'string' or #name ~= 4 then return nil end
  local p, a, b, c = PREFIX_INDEX[name:sub(1, 1)], LETTER_INDEX[name:sub(2, 2)], LETTER_INDEX[name:sub(3, 3)],
    LETTER_INDEX[name:sub(4, 4)]
  if not (p and a and b and c) then return nil end
  return p * BLOCK + a * N * N + b * N + c
end

-- Nature d'un objet .NET (developer:typeOf ne la donne pas), mémorisée par clé (et envoyée au récepteur : aucun essai
-- aux sessions suivantes). Ordre des essais : le moins d'échecs pour les plus fréquents (messages, listes).
local function kindOf(v, key)
  local k = key and kinds[key]
  if k then return k end
  if has(v, "Count") then k = has(v, "Keys") and "map" or "list"
  elseif has(v, "TypeUrl") then k = "any"
  elseif has(v, "ToBase64") then k = "bytes"   -- avant Length : ByteString a aussi Length et un indexeur
  elseif has(v, "CalculateSize") then k = "message"
  elseif has(v, "Length") then k = "list"
  else k = "other" end
  if key then
    kinds[key] = k
    push('{"k":"t","t":' .. jsonString("k:" .. key) .. ',"f":[' .. jsonString(k) .. ']}')
  end
  return k
end

-- Éléments d'une collection .NET, du rang `from` (base 1) à la fin, MAX_ITEMS au plus (nil si elle ne se parcourt pas).
-- Liste : Count (ou Length) et indexeur (base 0). Sinon boucle for-in de MoonSharp, puis énumérateur. L'indexeur d'un
-- dictionnaire prend une clé : jamais essayé (KeyNotFound .NET). Renvoie éléments, nombre lu, nombre total, rang du
-- premier lu.
local function collectionItems(v, indexed, from)
  local items, count = {}, 0
  if indexed then
    local okc, n = pcall(getField, v, "Count")
    if not (okc and type(n) == 'number') then okc, n = pcall(getField, v, "Length") end
    if okc and type(n) == 'number' then
      local first = math.max(1, from or 1)
      local ok = true
      for i = first - 1, math.min(n, first - 1 + MAX_ITEMS) - 1 do
        local oki, x = pcall(getField, v, i)
        if not oki then ok = false break end
        count = count + 1
        items[count] = x
      end
      if ok then return items, count, n, first end
      items, count = {}, 0
    end
  end
  local started = false
  local okFor = pcall(function()
    for x in v do
      started = true
      count = count + 1
      items[count] = x
      if count >= MAX_ITEMS then break end
    end
  end)
  -- Itération commencée puis interrompue : pas de second parcours (éléments en double).
  if okFor or started then return items, count, count, 1 end
  items, count = {}, 0
  local okEn, en = pcall(function() return v:GetEnumerator() end)
  if okEn and en ~= nil then
    while count < MAX_ITEMS do
      local okm, more = pcall(function() return en:MoveNext() end)
      if not okm or not more then break end
      local okx, x = pcall(getField, en, "Current")
      count = count + 1
      if okx then items[count] = x end
    end
    return items, count, count, 1
  end
  return nil, 0, 0, 1
end

-- Champs d'un objet par la réflexion .NET (nil si AnkaBot ne la permet pas : essayée une fois par session). Propriété
-- C# « Fwab » → nom Lua « fwab » (MoonSharp donne les deux) ; Parser et Descriptor (statiques) écartés.
local REFLECTION_SKIP = { Parser = true, Descriptor = true }
local function reflectFields(v)
  if reflection ~= "untested" and reflection ~= "ok" then return nil end
  if disabled.reflection then reflection = "no" return nil end
  danger = "reflection"
  local okT, t = pcall(function() return v:GetType() end)
  local okP, props = false, nil
  if okT and t ~= nil then okP, props = pcall(function() return t:GetProperties() end) end
  local names = nil
  if okP and props ~= nil then
    local items, count = collectionItems(props, true)
    if items ~= nil then
      names = {}
      for i = 1, count do
        local okN, n = pcall(getField, items[i], "Name")
        if okN and type(n) == "string" and not REFLECTION_SKIP[n] then
          local lower = n:sub(1, 1):lower() .. n:sub(2)
          if has(v, lower) then names[#names + 1] = lower elseif has(v, n) then names[#names + 1] = n end
        end
      end
    end
  end
  danger = nil
  if reflection == "untested" then
    reflection = names and "ok" or "no"
    event("reflection", ',"ok":' .. tostring(names ~= nil) .. (names and (',"sample":' .. jsonNames(names)) or ''))
    if DIAGNOSTIC then global:printMessage("[journal] réflexion .NET : " .. (names and "disponible" or "indisponible")) end
  end
  return names
end

-- Point de départ pour un type nommé (message ou Any) : les noms de types et de champs suivent le même ordre, la
-- recherche part donc des champs du type connu le plus proche avant lui (ou un peu avant celui d'après).
local function namedHint(name)
  local below, belowIdx, above, aboveIdx
  for key, fields in pairs(schemas) do
    local t = key:match("^[ma]:(.+)$")
    local i = fields[1] and fieldIndex(fields[1])
    if t and i then
      if t < name and (below == nil or t > below) then below, belowIdx = t, i end
      if t > name and (above == nil or t < above) then above, aboveIdx = t, i end
    end
  end
  if belowIdx then return belowIdx end
  if aboveIdx then return aboveIdx - NESTED_BACK end
  return fieldIndex("f" .. ALPHABET:sub(1, 3)) or 0
end

-- Recherche des champs d'une clé, par tranches (reprise au message suivant) : premier nom existant à partir du point de
-- départ (tour complet de l'espace), puis noms voisins des deux côtés tant qu'il y en a (moins de FIELD_GAP absents
-- d'affilée). Renvoie vrai quand elle est finie (st.fields).
local function newScan(key, v, hint)
  local st = { key = key, obj = v, hint = math.floor(hint or 0) % SPACE, step = 0, phase = "first", probes = 0,
    started = clock() }
  scans[key] = st
  scanOrder[#scanOrder + 1] = key
  return st
end

local function scanStep(st)
  local v = st.obj
  while clock() < workUntil do
    if st.phase == "first" then
      if st.step >= SPACE then
        st.fields = {}
        return true
      end
      local i = (st.hint + st.step) % SPACE
      st.step = st.step + 1
      st.probes = st.probes + 1
      if has(v, fieldName(i)) then
        st.first, st.found, st.phase, st.dir, st.i, st.misses = i, { i }, "around", -1, i - 1, 0
      end
    elseif st.i < 0 or st.i >= SPACE or st.misses >= FIELD_GAP then
      if st.dir == -1 then
        st.dir, st.i, st.misses = 1, st.first + 1, 0
      else
        table.sort(st.found)
        local names = {}
        for k, i in ipairs(st.found) do names[k] = fieldName(i) end
        st.fields = names
        return true
      end
    else
      st.probes = st.probes + 1
      if has(v, fieldName(st.i)) then
        st.found[#st.found + 1] = st.i
        st.misses = 0
      else
        st.misses = st.misses + 1
      end
      st.i = st.i + st.dir
    end
  end
  return false
end

local function remember(key, fields, how, probes, seconds)
  schemas[key], verified[key] = fields, true
  push('{"k":"t","t":' .. jsonString(key) .. ',"f":' .. jsonNames(fields) .. '}')
  discovered = discovered + 1
  resolvedSince = true
  if DIAGNOSTIC and discovered <= DIAGNOSTIC_TYPES then
    global:printMessage(string.format("[journal] type %s : %d champ(s)%s (%s%s)", key, #fields,
      #fields > 0 and (" " .. fields[1] .. "…" .. fields[#fields]) or "", how,
      probes and string.format(", %d essais en %.1f s", probes, seconds or 0) or ""))
  end
end

local function finishScan(st)
  scans[st.key] = nil
  for k, key in ipairs(scanOrder) do
    if key == st.key then
      table.remove(scanOrder, k)
      break
    end
  end
  remember(st.key, st.fields, "recherche", st.probes, clock() - st.started)
end

-- Noms des champs d'un message : liste connue (revérifiée par son premier champ), réflexion, sinon recherche par
-- tranches. nil : pas encore connus (la recherche continue en travail de fond).
local function fieldsOf(v, key, hint)
  local fields = schemas[key]
  if fields then
    if verified[key] then return fields end
    if #fields == 0 or has(v, fields[1]) then
      verified[key] = true
      return fields
    end
    schemas[key] = nil   -- noms renouvelés par Ankama : nouvelle recherche
  end
  local r = reflectFields(v)
  if r then
    remember(key, r, "réflexion")
    return r
  end
  local st = scans[key]
  if st == nil then
    local named = key:match("^[ma]:(.+)$")
    st = newScan(key, v, named and namedHint(named) or hint)
  else
    st.obj = v
  end
  if scanStep(st) then
    finishScan(st)
    return st.fields
  end
  return nil
end

local function base64(bytes)
  local ok, s = pcall(function() return bytes:ToBase64() end)
  if ok and type(s) == 'string' then return s end
  return nil
end

-- Contenu d'un Any décodé par le parseur Protobuf de son type (nil si impossible ; désactivé après un plantage .NET).
local function unpackAny(typeShort, bytes)
  if disabled.unpack then return nil end
  local parser = parsers[typeShort]
  danger = "unpack"
  if parser == nil then
    local ok, proto = pcall(function() return developer:createMessage(typeShort) end)
    local okp, p = false, nil
    if ok and proto ~= nil then okp, p = pcall(getField, proto, "Parser") end
    parser = (okp and p ~= nil) and p or false
    parsers[typeShort] = parser
  end
  local inner = nil
  if parser then
    local ok, x = pcall(function() return parser:ParseFrom(bytes) end)
    if ok then inner = x end
  end
  danger = nil
  return inner
end

-- Écrit `v` en JSON dans `out` (table de morceaux) ; `budget` = taille restante, renvoie la nouvelle taille restante.
-- `key` désigne le type de `v` (voir l'en-tête), `hint` le point de départ de la recherche de ses champs.
-- Messages : {<champ>: <valeur>…} ; listes : [...] ; dictionnaires : [[clé, valeur]…] ;
-- Any : {"$any": <TypeUrl>, "$v": <contenu décodé>} ou {"$any": <TypeUrl>, "$b64": <octets>}.
-- Marques : $pending (type pas encore connu, ligne « p » plus tard), $depth (trop profond), $more (liste coupée),
-- $collection (illisible), $other / $nokey (objet inconnu).
local encodePending = false

local function encode(v, depth, out, budget, seen, key, hint)
  if budget <= 0 then return budget end
  local t = type(v)
  local piece
  if v == nil then piece = 'null'
  elseif t == 'boolean' then piece = tostring(v)
  elseif t == 'number' then piece = jsonNumber(v)
  elseif t == 'string' then piece = jsonString(v)
  elseif t == 'function' or t == 'thread' then piece = 'null'
  elseif depth > MAX_DEPTH then piece = '{"$depth":true}'
  elseif t == 'table' then
    if seen[v] then
      piece = '{"$cycle":true}'
    else
      local list = entries(v) or {}
      seen[v] = true
      if isArray(list) then
        out[#out + 1] = '['
        budget = budget - 1
        for i, kv in ipairs(list) do
          if i > 1 then out[#out + 1] = ',' budget = budget - 1 end
          budget = encode(kv[2], depth + 1, out, budget, seen, key and (key .. "[]"), hint)
          if budget <= 0 then break end
        end
        out[#out + 1] = ']'
      else
        out[#out + 1] = '{'
        budget = budget - 1
        for i, kv in ipairs(list) do
          if i > 1 then out[#out + 1] = ',' budget = budget - 1 end
          local k = jsonString(kv[1])
          out[#out + 1] = k .. ':'
          budget = budget - #k - 1
          budget = encode(kv[2], depth + 1, out, budget, seen, key and (key .. "." .. tostring(kv[1])), hint)
          if budget <= 0 then break end
        end
        out[#out + 1] = '}'
      end
      seen[v] = nil
      return budget - 1
    end
  elseif key == nil then
    piece = '{"$nokey":true}'
  else
    -- userdata : objet .NET. Jamais de tostring sur un message (voir l'en-tête).
    local kind = kindOf(v, key)
    if kind == 'message' then
      local fields = fieldsOf(v, key, hint)
      if fields == nil then
        encodePending = true
        piece = '{"$pending":' .. jsonString(key) .. '}'
      else
        local childHint = fields[1] and fieldIndex(fields[1]) and (fieldIndex(fields[1]) - NESTED_BACK) or hint
        out[#out + 1] = '{'
        budget = budget - 1
        for i, f in ipairs(fields) do
          local ok, x = pcall(getField, v, f)
          if not ok then x = nil end
          local k = (i > 1 and ',' or '') .. jsonString(f) .. ':'
          out[#out + 1] = k
          budget = encode(x, depth + 1, out, budget - #k, seen, "f:" .. f, childHint)
          if budget <= 0 then break end
        end
        out[#out + 1] = '}'
        return budget - 1
      end
    elseif kind == 'list' or kind == 'map' then
      local items, count, total = collectionItems(v, kind == 'list')
      if items ~= nil then
        out[#out + 1] = '['
        budget = budget - 1
        for i = 1, count do
          if i > 1 then out[#out + 1] = ',' budget = budget - 1 end
          if kind == 'map' then
            local okk, k = pcall(getField, items[i], "Key")
            local okv, x = pcall(getField, items[i], "Value")
            out[#out + 1] = '['
            budget = encode(okk and k or nil, depth + 1, out, budget - 1, seen, key .. "<>", hint)
            out[#out + 1] = ','
            budget = encode(okv and x or nil, depth + 1, out, budget - 1, seen, key .. "{}", hint)
            out[#out + 1] = ']'
            budget = budget - 1
          else
            budget = encode(items[i], depth + 1, out, budget, seen, key .. "[]", hint)
          end
          if budget <= 0 then break end
        end
        if total > count then out[#out + 1] = ',{"$more":' .. (total - count) .. '}' end
        out[#out + 1] = ']'
        return budget - 1
      end
      piece = '{"$collection":true}'
    elseif kind == 'bytes' then
      local s = base64(v)
      piece = '{"$b64":' .. (s and jsonString(s) or 'null') .. '}'
    elseif kind == 'any' then
      local okU, url = pcall(getField, v, "TypeUrl")
      local okB, bytes = pcall(getField, v, "Value")
      url = (okU and type(url) == 'string') and url or ""
      local typeShort = url:match("([^/%.]+)$")
      local inner = (typeShort and okB and bytes ~= nil) and unpackAny(typeShort, bytes) or nil
      local h = '{"$any":' .. jsonString(url)
      if inner ~= nil then
        out[#out + 1] = h .. ',"$v":'
        budget = encode(inner, depth + 1, out, budget - #h - 6, seen, "a:" .. typeShort, nil)
        out[#out + 1] = '}'
        return budget - 1
      end
      local s = okB and bytes ~= nil and base64(bytes) or nil
      piece = h .. ',"$b64":' .. (s and jsonString(s) or 'null') .. '}'
    elseif not disabled["tostring " .. key] then
      -- Autre objet (énumération…) : son texte, sauf si tostring a déjà planté pour cette clé.
      danger = "tostring " .. key
      local ok, s = pcall(tostring, v)
      danger = nil
      piece = '{"$str":' .. (ok and jsonString(s) or 'null') .. '}'
    else
      piece = '{"$other":true}'
    end
  end
  out[#out + 1] = piece
  return budget - #piece
end

-- JSON de `v` et vrai s'il contient des {"$pending":…}.
local function toJson(v, key)
  encodePending = false
  local out = {}
  local left = encode(v, 0, out, MAX_LINE, {}, key, nil)
  if left <= 0 then return '{"$truncated":true}', false end
  return table.concat(out), encodePending
end

-- Garde une ligne m/h en attente de ses types (ligne « p » quand ils sont trouvés).
local function keepPending(i, k, name, obj)
  if #pendingMsgs >= PENDING_MAX then
    report(name, "trop de messages en attente de leurs types (PENDING_MAX) : ligne " .. i .. " restera incomplète")
    return
  end
  pendingMsgs[#pendingMsgs + 1] = { i = i, k = k, n = name, obj = obj }
end

-- ───────────────────────────── compteurs ─────────────────────────────

-- Compteurs de la session : messages reçus par nom, lignes envoyées / perdues, erreurs, travail de fond.
local function writeCounts(why)
  local parts = {}
  for name, n in pairs(counts) do parts[#parts + 1] = jsonString(name) .. ':' .. n end
  table.sort(parts)
  push(head("c") .. ',"f":' .. fightIndex .. ',"why":' .. jsonString(why) .. ',"received":' .. received ..
    ',"sent":' .. sent .. ',"saved":' .. saved .. ',"dropped":' .. dropped .. ',"errors":' .. errors .. ',"parallel":' .. parallel .. ',"quiet":' .. quietCount ..
    ',"types":' .. discovered .. ',"pending":' .. #pendingMsgs .. ',"scans":' .. #scanOrder ..
    ',"history":' .. jsonString(historyState) .. ',"n":{' .. table.concat(parts, ',') .. '}}')
  sinceCounts = 0
end

-- ───────────────────────────── photos de l'état du combat ─────────────────────────────

local function get(obj, key)
  local ok, v = pcall(getField, obj, key)
  if ok then return v end
  return nil
end

local function entityJson(e)
  -- Table Lua : écrite telle quelle (toutes ses clés). Objet .NET : propriétés existantes parmi ENTITY_KEYS.
  if type(e) == 'table' then return (toJson(e, "entity")) end
  if entityKeys == nil then
    entityKeys = {}
    for _, k in ipairs(ENTITY_KEYS) do if has(e, k) then entityKeys[#entityKeys + 1] = k end end
    event("entityKeys", ',"keys":' .. jsonNames(entityKeys))
  end
  local parts = {}
  for _, k in ipairs(entityKeys) do parts[#parts + 1] = jsonString(k) .. ':' .. (toJson(get(e, k), "entity." .. k)) end
  return '{' .. table.concat(parts, ',') .. '}'
end

local function snapshot(reason)
  local ok, err = pcall(function()
    local entities, count = fightAction:getAllEntities(), 0
    if type(entities) ~= 'table' then entities, count = collectionItems(entities, true) end
    if type(entities) == 'table' and count == 0 then count = #entities end
    local list = {}
    for i = 1, count do list[#list + 1] = entityJson(entities[i]) end
    local turn, mapId = nil, nil
    pcall(function() turn = fightAction:getCurrentTurn() end)
    pcall(function() mapId = map:currentMapId() end)
    push(head("s") .. ',"f":' .. fightIndex .. ',"r":' .. jsonString(reason) .. ',"turn":' ..
      (type(turn) == "number" and jsonNumber(turn) or 'null') .. ',"map":' ..
      (type(mapId) == "number" and jsonNumber(mapId) or 'null') .. ',"e":[' .. table.concat(list, ',') .. ']}')
  end)
  if not ok then report("snapshot", tostring(err)) end
end

-- ───────────────────────────── combats ─────────────────────────────

local function startFight(why)
  fightIndex = fightIndex + 1
  wasInFight = true
  roundOneSeen = false
  lastTurn = -1
  pcall(function() lastTurn = fightAction:getCurrentTurn() end)
  sinceSnapshot = 0
  event("fightStart", ',"why":' .. jsonString(why))
  snapshot("start")
  flush()
  global:printSuccess("[journal] combat n°" .. fightIndex .. " (" .. why .. ")")
end

local function endFight(why)
  wasInFight = false
  event("fightEnd", ',"why":' .. jsonString(why))
  writeCounts("fightEnd")
  flush()
  untilTailFlush = FLUSH_AFTER_FIGHT
  global:printSuccess("[journal] combat n°" .. fightIndex .. " terminé (" .. why .. ") — " .. received ..
    " messages reçus, " .. (sent + saved) .. " lignes écrites" .. (dropped > 0 and (", " .. dropped .. " perdues") or "") ..
    (errors > 0 and (", " .. errors .. " erreur(s)") or "") ..
    (#pendingMsgs > 0 and (", " .. #pendingMsgs .. " en attente de leurs types") or ""))
end

-- Début / fin de combat et photos régulières (appelé à chaque message, avant son enregistrement).
local function watchFight(name, message)
  local now = clock()
  local inFight = false
  pcall(function() inFight = character:isInFight() == true end)
  local roundOne = false
  if name == ROUND_MESSAGE then
    local ok, r = pcall(getField, message, ROUND_FIELD)
    roundOne = ok and r == 1
  end
  if inFight or FIGHT_MESSAGES[name] then lastFightSignal = now end
  if roundOne and wasInFight and roundOneSeen then
    endFight("nouvelle manche 1")
    startFight("manche 1")
  elseif not wasInFight and (inFight or FIGHT_MESSAGES[name]) then
    startFight(inFight and "AnkaBot" or ("message " .. name))
  elseif wasInFight and lastFightSignal and now - lastFightSignal >= FIGHT_END_SECONDS then
    endFight(FIGHT_END_SECONDS .. " s sans signe de combat")
  end
  if roundOne then roundOneSeen = true end
  if wasInFight then
    sinceSnapshot = sinceSnapshot + 1
    local turn = -1
    pcall(function() turn = fightAction:getCurrentTurn() end)
    if turn ~= lastTurn then
      lastTurn = turn
      sinceSnapshot = 0
      if FIGHT_SNAPSHOTS then snapshot("turn") end
    elseif sinceSnapshot >= SNAPSHOT_EVERY then
      sinceSnapshot = 0
      if FIGHT_SNAPSHOTS then snapshot("periodic") end
    end
  end
end

-- ───────────────────────────── noms de messages ─────────────────────────────

-- Appelle fn(nom) pour chaque nom en clair de EXTRA_MESSAGES puis chaque nom obfusqué (NAME_LENGTHS).
local function eachName(fn)
  if ONLY_NAMES then
    local names = {}
    for name in pairs(ONLY_NAMES) do names[#names + 1] = name end
    table.sort(names)
    for _, name in ipairs(names) do fn(name) end
    return
  end
  for _, name in ipairs(EXTRA_MESSAGES) do fn(name) end
  local function rec(len, prefix)
    if #prefix == len then
      fn(prefix)
      return
    end
    for i = 1, #ALPHABET do rec(len, prefix .. ALPHABET:sub(i, i)) end
  end
  for _, len in ipairs(NAME_LENGTHS) do rec(len, "") end
end

-- ───────────────────────────── historique d'avant le chargement ─────────────────────────────

-- Noms à relire : ceux des messages déjà connus (schemas.json : connexion, caractéristiques, sorts…), puis chaque nom
-- reçu pour la première fois pendant la session. Jamais les 17 576 noms d'un coup (trop lent : voir l'en-tête).
local function queueHistory(name)
  if historyState == "off" or historyState == "stopped" or historyQueued[name] then return end
  if HISTORY_NAMES and not HISTORY_NAMES[name] then return end
  historyQueued[name] = true
  historyQueue[#historyQueue + 1] = name
  if historyState == "done" then historyState = "on" end
end

local function writeHistory(name, list)
  local arr, count, total, first
  if type(list) == 'table' then
    total = #list
    first = math.max(1, total - HISTORY_MAX + 1)
    arr, count = {}, 0
    for j = first, total do
      count = count + 1
      arr[count] = list[j]
    end
  else
    local okc, n = pcall(getField, list, "Count")
    if not (okc and type(n) == 'number') then okc, n = pcall(getField, list, "Length") end
    local from = (okc and type(n) == 'number') and math.max(1, n - HISTORY_MAX + 1) or nil
    arr, count, total, first = collectionItems(list, true, from)
    if arr and count > HISTORY_MAX then
      local cut = {}
      for j = count - HISTORY_MAX + 1, count do cut[#cut + 1] = arr[j] end
      first, arr, count = first + count - HISTORY_MAX, cut, HISTORY_MAX
    end
  end
  if not arr or count == 0 then return end
  hstats.names = hstats.names + 1
  for j = 1, count do
    local okj, data, pend = pcall(toJson, arr[j], "m:" .. name)
    if okj then
      local h = head("h")
      local i = seq
      push(h .. ',"n":' .. jsonString(name) .. ',"j":' .. (first + j - 2) .. ',"of":' .. total .. ',"d":' .. data .. '}')
      if pend then keepPending(i, "h", name, arr[j]) end
      hstats.kept = hstats.kept + 1
    else
      report(name, "historique : " .. tostring(data))
    end
  end
end

-- Une tranche de relecture : des noms de la file tant que le travail de fond le permet (au moins un hors combat).
local function historyStep()
  if historyState ~= "on" or (wasInFight and not HISTORY_IN_FIGHT) then return end
  if not hstats.started then
    hstats.started = true
    local names = {}
    for key in pairs(schemas) do
      local n = key:match("^m:(.+)$")
      if n then names[#names + 1] = n end
    end
    table.sort(names)
    for _, n in ipairs(names) do queueHistory(n) end
  end
  local did = 0
  while historyPos <= #historyQueue and (did == 0 or clock() < workUntil) do
    local name = historyQueue[historyPos]
    historyPos = historyPos + 1
    did = did + 1
    local t0 = clock()
    danger = "history"
    local ok, list = pcall(function() return developer:historicalMessage(name) end)
    danger = nil
    local ms = (clock() - t0) * 1000
    hstats.calls = hstats.calls + 1
    hstats.ms = hstats.ms + ms
    if ms > hstats.max then hstats.max = ms end
    if ms > HISTORY_SLOW_MS then
      historyState = "stopped"
      event("historyStopped", ',"name":' .. jsonString(name) .. ',"ms":' .. jsonNumber(math.floor(ms)))
      global:printError(string.format("[journal] historique arrêté : developer:historicalMessage(%s) a pris %.1f s", name, ms / 1000))
      return
    end
    if ok and list ~= nil then writeHistory(name, list) end
  end
  if historyPos > #historyQueue and historyState == "on" then
    historyState = "done"
    event("history", ',"calls":' .. hstats.calls .. ',"names":' .. hstats.names .. ',"kept":' .. hstats.kept ..
      ',"totalMs":' .. jsonNumber(math.floor(hstats.ms)) .. ',"maxMs":' .. jsonNumber(math.floor(hstats.max)))
    if DIAGNOSTIC then
      global:printMessage(string.format("[journal] historique relu : %d message(s) de %d nom(s) (%d appels, %.1f s)",
        hstats.kept, hstats.names, hstats.calls, hstats.ms / 1000))
    end
  end
end

-- ───────────────────────────── travail de fond ─────────────────────────────

-- Lignes en attente : réécrites (ligne « p ») dès que tous leurs types sont connus.
local function retryPending()
  if not resolvedSince or #pendingMsgs == 0 then return end
  resolvedSince = false
  local kept = {}
  for idx, e in ipairs(pendingMsgs) do
    if clock() >= workUntil then
      for j = idx, #pendingMsgs do kept[#kept + 1] = pendingMsgs[j] end
      resolvedSince = true   -- à reprendre au message suivant
      break
    end
    local ok, data, pend = pcall(toJson, e.obj, "m:" .. e.n)
    if not ok then
      report(e.n, "complétion de la ligne " .. e.i .. " : " .. tostring(data))
    elseif pend then
      kept[#kept + 1] = e
    else
      push(head("p") .. ',"of":' .. e.i .. ',"src":"' .. e.k .. '","n":' .. jsonString(e.n) .. ',"d":' .. data .. '}')
    end
  end
  pendingMsgs = kept
end

-- Recherches de champs en cours (la plus ancienne d'abord), lignes en attente, historique.
local function backgroundWork()
  while clock() < workUntil and #scanOrder > 0 do
    local st = scans[scanOrder[1]]
    if st == nil then table.remove(scanOrder, 1)
    elseif scanStep(st) then finishScan(st) end
  end
  retryPending()
  historyStep()
end

-- Mesures, au premier message : coût d'un nom de champ absent (erreur Lua) et d'un nom présent.
local function measure(message)
  perfDone = true
  local t0 = clock()
  for k = 1, 20 do has(message, "zzz" .. LETTERS[k]) end
  local fail = (clock() - t0) * 1000 / 20
  event("perf", ',"failedProbeMs":' .. jsonNumber(fail))
  if fail > 2 then
    global:printError(string.format("[journal] essais de noms lents (%.1f ms) : les types inconnus seront trouvés peu à peu", fail))
  end
end

-- ───────────────────────────── instances ─────────────────────────────

local function memoryKey() return "journal-combats:" .. instanceName() end

-- Inscrit cette instance comme la plus récente du personnage (mémoire globale d'AnkaBot).
local function claimInstance()
  local key = memoryKey()
  local ok = pcall(function() developer:editInGlobalMemory(key, INSTANCE_ID) end)
  local okGet, v = pcall(function() return developer:getInGlobalMemory(key) end)
  if not (ok and okGet and v == INSTANCE_ID) then pcall(function() developer:addInGlobalMemory(key, INSTANCE_ID) end) end
end

-- Une instance plus récente du journal tourne-t-elle pour ce personnage ? (signalé une fois, l'enregistrement continue :
-- AnkaBot peut encore confier des messages à cette instance-ci)
local function checkInstance()
  if otherInstance then return end
  local ok, v = pcall(function() return developer:getInGlobalMemory(memoryKey()) end)
  if ok and type(v) == "string" and v ~= INSTANCE_ID then
    otherInstance = true
    event("otherInstance", ',"newer":' .. jsonString(v) .. ',"me":' .. jsonString(INSTANCE_ID))
    global:printError("[journal] une autre instance du journal tourne pour " .. instanceName() .. " (" .. v ..
      ") : les messages sont répartis entre elles. Redémarrer AnkaBot pour n'en garder qu'une.")
  end
end

-- ───────────────────────────── messages ─────────────────────────────

-- Silence autour de son tour : tenu à jour sur les débuts et fins de tour ; vrai si le message est à ignorer.
local function quietFor(name, message)
  -- Fin du combat, ou manche 1 d'un nouveau combat : le silence s'arrête (combat abandonné ou perdu pendant mon tour,
  -- 2026-10-12 à 21:48 : le journal manquait sinon la fin de ce combat et le début du suivant ; le serveur de plans,
  -- qui fusionnait alors deux combats, ne trouvait plus aucun tour, et les tours étaient passés).
  if name == FIGHT_END_MESSAGE or name == ROUND_MESSAGE then
    local nouveau = name == FIGHT_END_MESSAGE
    if not nouveau then
      local r = nil
      pcall(function() r = message[ROUND_FIELD] end)
      nouveau = r == 1
    end
    if nouveau then
      myTurnOn, quietSince, prevOfMe, lastStarter = false, nil, nil, nil
      return false
    end
  end
  if name == TURN_START or name == TURN_END then
    if myFighterId == nil then pcall(function() myFighterId = character:id() end) end
    local id = nil
    pcall(function() id = message[name == TURN_START and TURN_START_FIELD or TURN_END_FIELD] end)
    if name == TURN_START and id ~= nil then
      if id == myFighterId then
        prevOfMe = lastStarter
        myTurnOn = true
        quietSince = quietSince or clock()
      elseif myTurnOn then
        myTurnOn, quietSince = false, nil      -- mon tour est fini (fin de tour non reçue)
      elseif prevOfMe ~= nil and id == prevOfMe and quietSince == nil then
        -- (pas d'envoi ici : une requête bloquante juste avant son tour ; le reste part à la fin du silence)
        quietSince = clock()
      end
      lastStarter = id
    elseif name == TURN_END and id ~= nil and id == myFighterId and quietSince ~= nil then
      quietCount = quietCount + 1
      myTurnOn, quietSince = false, nil
      return true
    end
  end
  if quietSince ~= nil and clock() - quietSince > QUIET_MAX_SECONDS then myTurnOn, quietSince = false, nil end
  if quietSince ~= nil then
    quietCount = quietCount + 1
    return true
  end
  return false
end

local function onMessage(name, message)
  if inMessage then
    parallel = parallel + 1
    return
  end
  if QUIET_AROUND_MY_TURN and quietFor(name, message) then
    received = received + 1
    counts[name] = (counts[name] or 0) + 1
    return
  end
  inMessage = true
  workUntil = clock() + (wasInFight and WORK_FIGHT_MS or WORK_IDLE_MS) / 1000
  if danger ~= nil then
    disabled[danger] = true
    report(name, "« " .. danger .. " » a planté (exception .NET) : désactivé pour la suite")
    if danger == "history" then historyState = "stopped" end
    if danger == "reflection" then reflection = "no" end
    danger = nil
  end
  received = received + 1
  counts[name] = (counts[name] or 0) + 1
  if received == 1 or received % INSTANCE_CHECK_EVERY == 0 then checkInstance() end
  local first = counts[name] == 1
  local ok, err = pcall(function()
    if not perfDone then measure(message) end
    watchFight(name, message)
    local data, pend = toJson(message, "m:" .. name)
    local h = head("m")
    local i = seq
    push(h .. ',"f":' .. (wasInFight and fightIndex or 0) .. ',"n":' .. jsonString(name) .. ',"d":' .. data .. '}',
      URGENT_MESSAGES[name] == true)
    if pend then keepPending(i, "m", name, message) end
    if data == '{"$truncated":true}' then report(name, "message tronqué (plus de " .. MAX_LINE .. " caractères)") end
    if wasInFight and FIGHT_SNAPSHOTS and SNAPSHOT_MESSAGES[name] then
      sinceSnapshot = 0
      snapshot("after " .. name)
    end
    if untilTailFlush > 0 then
      untilTailFlush = untilTailFlush - 1
      if untilTailFlush == 0 then flush() end
    end
    sinceCounts = sinceCounts + 1
    if sinceCounts >= COUNTS_EVERY then writeCounts("periodic") end
    if DIAGNOSTIC and first and seenCount < DIAGNOSTIC_NAMES then
      seenCount = seenCount + 1
      global:printMessage("[journal] " .. name .. " : " .. data:sub(1, 200))
    end
    if first then queueHistory(name) end
  end)
  if not ok then report(name, tostring(err)) end
  local okW, errW = pcall(backgroundWork)
  if not okW then report("travail de fond", tostring(errW)) end
  inMessage = false
end

-- Une fonction par nom (la fonction appelée par AnkaBot reçoit le message seul, pas son nom).
local function handlerFor(name)
  return function(message) onMessage(name, message) end
end

local registered = 0

function messagesRegistering()
  if ENABLED == false then
    global:printMessage("[journal] coupé (ENABLED = false) : aucun message écouté")
    return
  end
  local start = clock()
  local known = loadSchemas()
  eachName(function(name)
    if UNREGISTER_FIRST then pcall(function() developer:unRegisterMessage(name) end) end
    if pcall(function() developer:registerMessage(name, handlerFor(name)) end) then registered = registered + 1 end
  end)
  claimInstance()
  local info = {}
  local function add(k, f)
    local ok, v = pcall(f)
    if ok and (type(v) == "number" or type(v) == "string" or type(v) == "boolean") then
      info[#info + 1] = jsonString(k) .. ':' .. (type(v) == "number" and jsonNumber(v) or type(v) == "string" and
        jsonString(v) or tostring(v))
    end
  end
  add("id", function() return character:id() end)
  add("level", function() return character:level() end)
  add("breed", function() return character:breed() end)
  add("server", function() return character:server() end)
  add("boss", function() return global:isBoss() end)
  add("inFight", function() return character:isInFight() end)
  local seconds = clock() - start
  event("loggerStart", ',"c":' .. jsonString(instanceName()) .. ',"version":' .. jsonString(LOGGER_VERSION) ..
    ',"instance":' .. jsonString(INSTANCE_ID) .. ',"unix":' .. jsonNumber(unixTime() or 0) .. ',"clock":' ..
    jsonNumber(clock()) .. ',"registered":' .. registered .. ',"knownTypes":' .. known .. ',"registerSeconds":' ..
    jsonNumber(seconds) .. ',"character":{' .. table.concat(info, ',') .. '}')
  flush()
  global:printSuccess(string.format("[journal] %s prêt : %d noms écoutés en %.1f s, %d types déjà connus → %s",
    instanceName(), registered, seconds, known, (httpDownSince and fallbackPath) or LOG_URL))
end

function move()
end

-- Réglages du journal pour un script qui joue (tools/fightlog/combat.ts) : script libre quand AnkaBot lance fightManagement.
-- Silence autour de son tour, pas de photos en combat (le serveur de plans ne s'en sert pas).
QUIET_AROUND_MY_TURN = true
FIGHT_SNAPSHOTS = false
-- false : journal coupé (test des tours passés ; le serveur de plans, donc le mode avancé, n'a alors plus de données).
ENABLED = true
-- Listes bornées : le serveur n'en lit pas de plus de 53 éléments ; à 20 000, un message de 1 Mo (isr, relu dans
-- l'historique au chargement) a bloqué les scripts des mules 12 minutes (2026-10-10 à 17:47).
MAX_ITEMS = 200
-- Historique relu (messages reçus avant le chargement) : la liste des sorts du personnage seulement (variantes).
HISTORY_NAMES = { hkh = true }
-- Messages écoutés : ceux du serveur de plans seulement (17, au lieu des 17 588 noms possibles).
ONLY_NAMES = { hkg = true, hkh = true, hkk = true, jnz = true, jqh = true, jsq = true, jsy = true, jtk = true, juh = true, juo = true, jup = true, juq = true, jvi = true, jvj = true, jvu = true, jwh = true, jwi = true }

-- Les Crâs (data/reine/placements.json : cases du placement par défaut) et leur identifiant de jeu : tout autre
-- personnage du groupe est une mule (mode « 4 Crâs + mule » : placée en MULE_CASE, passe ses tours).
CRAS = { ["Java-Springboot"] = 900265148709, ["Lamouit"] = 900264624421, ["Lowkey-Jealous"] = 900264689957, ["Kemist-Skyler"] = 900266590501 }

-- ═════════════════════════════ MODE AVANCÉ : IA DU SERVEUR DE PLANS ═════════════════════════════
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

FORMATIONS = {
  {
    nom = "Placement 1",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3726, cellule = 132 },  -- Reine des Voleurs
      { espece = 3746, cellule = 134 },  -- Mâchassin
      { espece = 3747, cellule = 178 },  -- Terristocrate
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 2",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3726, cellule = 133 },  -- Reine des Voleurs
      { espece = 3746, cellule = 135 },  -- Mâchassin
      { espece = 3747, cellule = 178 },  -- Terristocrate
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 3",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 132 },  -- Terristocrate
      { espece = 3726, cellule = 134 },  -- Reine des Voleurs
      { espece = 3746, cellule = 178 },  -- Mâchassin
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 4",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 133 },  -- Terristocrate
      { espece = 3726, cellule = 135 },  -- Reine des Voleurs
      { espece = 3746, cellule = 178 },  -- Mâchassin
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 5",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 133 },  -- Terristocrate
      { espece = 3726, cellule = 163 },  -- Reine des Voleurs
      { espece = 3746, cellule = 207 },  -- Mâchassin
      { espece = 3748, cellule = 264 },  -- Doublure
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 6",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 132 },  -- Terristocrate
      { espece = 3746, cellule = 134 },  -- Mâchassin
      { espece = 3726, cellule = 178 },  -- Reine des Voleurs
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 7",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 132 },  -- Doublure
      { espece = 3747, cellule = 134 },  -- Terristocrate
      { espece = 3726, cellule = 192 },  -- Reine des Voleurs
      { espece = 3746, cellule = 208 },  -- Mâchassin
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 8",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 133 },  -- Terristocrate
      { espece = 3746, cellule = 163 },  -- Mâchassin
      { espece = 3726, cellule = 207 },  -- Reine des Voleurs
      { espece = 3748, cellule = 264 },  -- Doublure
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 9",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 132 },  -- Doublure
      { espece = 3747, cellule = 134 },  -- Terristocrate
      { espece = 3746, cellule = 192 },  -- Mâchassin
      { espece = 3726, cellule = 208 },  -- Reine des Voleurs
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 10",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 132 },  -- Doublure
      { espece = 3747, cellule = 134 },  -- Terristocrate
      { espece = 3746, cellule = 192 },  -- Mâchassin
      { espece = 3726, cellule = 236 },  -- Reine des Voleurs
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 11",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 133 },  -- Doublure
      { espece = 3747, cellule = 163 },  -- Terristocrate
      { espece = 3746, cellule = 207 },  -- Mâchassin
      { espece = 3726, cellule = 264 },  -- Reine des Voleurs
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
  {
    nom = "Placement 12",
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 134 },  -- Doublure
      { espece = 3747, cellule = 192 },  -- Terristocrate
      { espece = 3746, cellule = 236 },  -- Mâchassin
      { espece = 3726, cellule = 292 },  -- Reine des Voleurs
    },
    -- Case de placement de chaque Crâ (phase de placement).
    placement = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
  },
}
-- Placement par défaut du registre (data/reine/placements.json).
FORMATION_PAR_DEFAUT = "Placement 3"

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

-- ═════════════════════════════ SCÉNARIOS DES PLACEMENTS ═════════════════════════════
-- Dans une fonction : ses variables locales restent les siennes (limite de 200 par fonction pour le fichier). Le « ; »
-- de tête : sans lui, Lua lirait « end)() (function() … » comme un seul appel.
;(function()
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

-- Scénarios générés le 2026-10-14 09:49:37 par tools/fightlog/combat.ts (Placement 1 : 5 combat(s) ; Placement 2 : 6 combat(s) ; Placement 3 : 5 combat(s) ; Placement 4 : 5 combat(s) ; Placement 5 : 4 combat(s) ; Placement 6 : 9 combat(s) ; Placement 7 : 4 combat(s) ; Placement 8 : 7 combat(s) ; Placement 9 : 5 combat(s) ; Placement 10 : 7 combat(s) ; Placement 11 : 4 combat(s) ; Placement 12 : 4 combat(s)).
-- Distance (en cases) à partir de laquelle un monstre est loin d'un Crâ, par espèce : hors de portée de son prochain
-- tour (tools/reine-des-voleurs/scenarios/compilation.ts, LOIN).
LOIN = { [3726] = 17, [3746] = 14, [3747] = 16, [3748] = 13, [3749] = 14, [3750] = 15 }
local SCENARIOS = {}
do
  local S = {
    nom = "Placement 1",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-21-25-58.jsonl#10 (2026-10-12 22:01) — defaite, 8 manches, vague 2",
      [2] = "2026-10-12/session-21-25-58.jsonl#11 (2026-10-12 22:03) — victoire, 15 manches, vague 5",
      [3] = "2026-10-13/session-15-11-47.jsonl#17 (2026-10-13 17:53) — victoire, 15 manches, vague 5",
      [4] = "2026-10-13/session-21-20-26.jsonl#7 (2026-10-13 22:04) — victoire, 16 manches, vague 5",
      [5] = "2026-10-13/session-21-20-26.jsonl#22 (2026-10-13 23:46) — victoire, 14 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3726, cellule = 132 },  -- Reine des Voleurs
      { espece = 3746, cellule = 134 },  -- Mâchassin
      { espece = 3747, cellule = 178 },  -- Terristocrate
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 2",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-21-25-58.jsonl#12 (2026-10-12 22:11) — victoire, 16 manches, vague 5",
      [2] = "2026-10-13/session-15-11-47.jsonl#18 (2026-10-13 18:02) — defaite, 12 manches, vague 3",
      [3] = "2026-10-13/session-15-11-47.jsonl#19 (2026-10-13 18:08) — defaite, 15 manches, vague 3",
      [4] = "2026-10-13/session-15-11-47.jsonl#20 (2026-10-13 18:16) — victoire, 18 manches, vague 5",
      [5] = "2026-10-13/session-21-20-26.jsonl#8 (2026-10-13 22:15) — victoire, 15 manches, vague 5",
      [6] = "2026-10-13/session-21-20-26.jsonl#23 (2026-10-13 23:50) — victoire, 16 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3726, cellule = 133 },  -- Reine des Voleurs
      { espece = 3746, cellule = 135 },  -- Mâchassin
      { espece = 3747, cellule = 178 },  -- Terristocrate
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 3",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-13/session-15-11-47.jsonl#1 (2026-10-13 15:12) — defaite, 9 manches, vague 3",
      [2] = "2026-10-13/session-15-11-47.jsonl#2 (2026-10-13 15:17) — victoire, 15 manches, vague 5",
      [3] = "2026-10-13/session-15-11-47.jsonl#21 (2026-10-13 18:27) — victoire, 18 manches, vague 5",
      [4] = "2026-10-13/session-21-20-26.jsonl#9 (2026-10-13 22:26) — victoire, 15 manches, vague 5",
      [5] = "2026-10-13/session-21-20-26.jsonl#24 (2026-10-13 23:56) — victoire, 16 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 132 },  -- Terristocrate
      { espece = 3726, cellule = 134 },  -- Reine des Voleurs
      { espece = 3746, cellule = 178 },  -- Mâchassin
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 4",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-13/session-15-11-47.jsonl#3 (2026-10-13 15:26) — victoire, 17 manches, vague 5",
      [2] = "2026-10-13/session-15-11-47.jsonl#22 (2026-10-13 18:37) — victoire, 19 manches, vague 5",
      [3] = "2026-10-13/session-21-20-26.jsonl#10 (2026-10-13 22:36) — defaite, 8 manches, vague 2",
      [4] = "2026-10-13/session-21-20-26.jsonl#11 (2026-10-13 22:41) — victoire, 17 manches, vague 5",
      [5] = "2026-10-13/session-21-20-26.jsonl#25 (2026-10-14 00:02) — victoire, 14 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 133 },  -- Terristocrate
      { espece = 3726, cellule = 135 },  -- Reine des Voleurs
      { espece = 3746, cellule = 178 },  -- Mâchassin
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 5",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-20-59-35.jsonl#1 (2026-10-12 21:07) — victoire, 15 manches, vague 5",
      [2] = "2026-10-13/session-15-11-47.jsonl#4 (2026-10-13 15:38) — victoire, 15 manches, vague 5",
      [3] = "2026-10-13/session-15-11-47.jsonl#23 (2026-10-13 18:48) — victoire, 19 manches, vague 5",
      [4] = "2026-10-13/session-21-20-26.jsonl#12 (2026-10-13 22:51) — victoire, 15 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 133 },  -- Terristocrate
      { espece = 3726, cellule = 163 },  -- Reine des Voleurs
      { espece = 3746, cellule = 207 },  -- Mâchassin
      { espece = 3748, cellule = 264 },  -- Doublure
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 6",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-20-59-35.jsonl#2 (2026-10-12 21:14) — defaite, 8 manches, vague 3",
      [2] = "2026-10-12/session-20-59-35.jsonl#3 (2026-10-12 21:16) — victoire, 17 manches, vague 5",
      [3] = "2026-10-13/session-15-11-47.jsonl#5 (2026-10-13 15:47) — defaite, 19 manches, vague 5",
      [4] = "2026-10-13/session-15-11-47.jsonl#6 (2026-10-13 15:58) — defaite, 21 manches, vague 5",
      [5] = "2026-10-13/session-15-11-47.jsonl#7 (2026-10-13 16:09) — victoire, 16 manches, vague 5",
      [6] = "2026-10-13/session-15-11-47.jsonl#24 (2026-10-13 18:59) — defaite, 7 manches, vague 2",
      [7] = "2026-10-13/session-15-11-47.jsonl#25 (2026-10-13 19:02) — victoire, 21 manches, vague 5",
      [8] = "2026-10-13/session-21-20-26.jsonl#13 (2026-10-13 23:01) — defaite, 8 manches, vague 2",
      [9] = "2026-10-13/session-21-20-26.jsonl#14 (2026-10-13 23:06) — victoire, 15 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 132 },  -- Terristocrate
      { espece = 3746, cellule = 134 },  -- Mâchassin
      { espece = 3726, cellule = 178 },  -- Reine des Voleurs
      { espece = 3748, cellule = 208 },  -- Doublure
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 7",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-21-25-58.jsonl#1 (2026-10-12 21:26) — victoire, 16 manches, vague 5",
      [2] = "2026-10-13/session-15-11-47.jsonl#8 (2026-10-13 16:20) — victoire, 18 manches, vague 5",
      [3] = "2026-10-13/session-15-11-47.jsonl#26 (2026-10-13 19:15) — victoire, 19 manches, vague 5",
      [4] = "2026-10-13/session-21-20-26.jsonl#15 (2026-10-13 23:14) — victoire, 16 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 132 },  -- Doublure
      { espece = 3747, cellule = 134 },  -- Terristocrate
      { espece = 3726, cellule = 192 },  -- Reine des Voleurs
      { espece = 3746, cellule = 208 },  -- Mâchassin
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 8",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-21-25-58.jsonl#2 (2026-10-12 21:30) — victoire, 15 manches, vague 5",
      [2] = "2026-10-13/session-15-11-47.jsonl#9 (2026-10-13 16:30) — defaite, 15 manches, vague 3",
      [3] = "2026-10-13/session-15-11-47.jsonl#10 (2026-10-13 16:37) — defaite, 23 manches, vague 5",
      [4] = "2026-10-13/session-15-11-47.jsonl#11 (2026-10-13 16:49) — victoire, 23 manches, vague 5",
      [5] = "2026-10-13/session-21-20-26.jsonl#1 (2026-10-13 21:20) — victoire, 15 manches, vague 5",
      [6] = "2026-10-13/session-21-20-26.jsonl#16 (2026-10-13 23:20) — defaite, 4 manches, vague 1",
      [7] = "2026-10-13/session-21-20-26.jsonl#17 (2026-10-13 23:21) — victoire, 19 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3747, cellule = 133 },  -- Terristocrate
      { espece = 3746, cellule = 163 },  -- Mâchassin
      { espece = 3726, cellule = 207 },  -- Reine des Voleurs
      { espece = 3748, cellule = 264 },  -- Doublure
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 9",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-21-25-58.jsonl#3 (2026-10-12 21:35) — victoire, 15 manches, vague 5",
      [2] = "2026-10-13/session-15-11-47.jsonl#12 (2026-10-13 17:01) — defaite, 16 manches, vague 4",
      [3] = "2026-10-13/session-15-11-47.jsonl#13 (2026-10-13 17:09) — victoire, 20 manches, vague 5",
      [4] = "2026-10-13/session-21-20-26.jsonl#2 (2026-10-13 21:26) — victoire, 15 manches, vague 5",
      [5] = "2026-10-13/session-21-20-26.jsonl#18 (2026-10-13 23:27) — victoire, 16 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 132 },  -- Doublure
      { espece = 3747, cellule = 134 },  -- Terristocrate
      { espece = 3746, cellule = 192 },  -- Mâchassin
      { espece = 3726, cellule = 208 },  -- Reine des Voleurs
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 10",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-21-25-58.jsonl#5 (2026-10-12 21:43) — defaite, 15 manches, vague 4",
      [2] = "2026-10-12/session-21-25-58.jsonl#6 (2026-10-12 21:46) — defaite, 18 manches, vague 4",
      [3] = "2026-10-12/session-21-25-58.jsonl#7 (2026-10-12 21:49) — victoire, 13 manches, vague 5",
      [4] = "2026-10-13/session-15-11-47.jsonl#14 (2026-10-13 17:20) — victoire, 17 manches, vague 5",
      [5] = "2026-10-13/session-21-20-26.jsonl#3 (2026-10-13 21:31) — defaite, 6 manches, vague 2",
      [6] = "2026-10-13/session-21-20-26.jsonl#4 (2026-10-13 21:35) — victoire, 13 manches, vague 5",
      [7] = "2026-10-13/session-21-20-26.jsonl#19 (2026-10-13 23:32) — victoire, 15 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 132 },  -- Doublure
      { espece = 3747, cellule = 134 },  -- Terristocrate
      { espece = 3746, cellule = 192 },  -- Mâchassin
      { espece = 3726, cellule = 236 },  -- Reine des Voleurs
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 11",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-21-25-58.jsonl#8 (2026-10-12 21:53) — victoire, 14 manches, vague 5",
      [2] = "2026-10-13/session-15-11-47.jsonl#15 (2026-10-13 17:31) — victoire, 14 manches, vague 5",
      [3] = "2026-10-13/session-21-20-26.jsonl#5 (2026-10-13 21:44) — victoire, 14 manches, vague 5",
      [4] = "2026-10-13/session-21-20-26.jsonl#20 (2026-10-13 23:36) — victoire, 15 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 133 },  -- Doublure
      { espece = 3747, cellule = 163 },  -- Terristocrate
      { espece = 3746, cellule = 207 },  -- Mâchassin
      { espece = 3726, cellule = 264 },  -- Reine des Voleurs
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
do
  local S = {
    nom = "Placement 12",
    -- Combats appris dont viennent les situations (n° de source).
    sources = {
      [1] = "2026-10-12/session-21-25-58.jsonl#9 (2026-10-12 21:57) — victoire, 15 manches, vague 5",
      [2] = "2026-10-13/session-15-11-47.jsonl#16 (2026-10-13 17:41) — victoire, 16 manches, vague 5",
      [3] = "2026-10-13/session-21-20-26.jsonl#6 (2026-10-13 21:54) — victoire, 14 manches, vague 5",
      [4] = "2026-10-13/session-21-20-26.jsonl#21 (2026-10-13 23:41) — victoire, 14 manches, vague 5",
    },
    carte = 137101316,
    -- Monstres au début du combat (espèce, case) : la signature du placement.
    monstres = {
      { espece = 3748, cellule = 134 },  -- Doublure
      { espece = 3747, cellule = 192 },  -- Terristocrate
      { espece = 3746, cellule = 236 },  -- Mâchassin
      { espece = 3726, cellule = 292 },  -- Reine des Voleurs
    },
    -- Case de placement de chaque Crâ, et son identifiant de personnage.
    cases = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 353,
      ["Kemist-Skyler"] = 351,
    },
    -- Case de la colonne de chaque Crâ (il y revient à la fin de chaque tour).
    colonne = {
      ["Java-Springboot"] = 327,
      ["Lamouit"] = 354,
      ["Lowkey-Jealous"] = 381,
      ["Kemist-Skyler"] = 408,
    },
    ids = {
      ["Java-Springboot"] = 900265148709,
      ["Lamouit"] = 900264624421,
      ["Lowkey-Jealous"] = 900264689957,
      ["Kemist-Skyler"] = 900266590501,
    },
    plans = {},
  }
  -- Tours de chaque Crâ (n-ième tour du Crâ = plans[nom][n]) : les situations connues, la meilleure d'abord, chacune avec
  -- le plateau relevé quand le Crâ a commencé à jouer (e = espèce, ou id pour un Crâ ; c = case ; inv = invisible ; n =
  -- Bonbombe du tour, qui peut ne pas être encore là ; l = monstre loin, toléré ailleurs s'il y est loin aussi), les PA
  -- et PM que le tour dépense et ses actions. Le script joue la situation qui correspond au plateau du jeu.
  SCENARIOS[#SCENARIOS + 1] = S
end
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
  inventory:useItem(30486)
  inventory:useItem(34360)
  global:printSuccess("Tatouage utilisé")
  if global:isBoss() then
    global:delay(500)
    map:fight()
  end
end

function entrerdonjon()
  inventory:useItem(30486)
  inventory:useItem(34360)
  global:printSuccess("Tatouage utilisé")
  npc:npc(2446, 3)
  npc:reply(-1)
  npc:reply(-1)
end

local TRAJET = {
  { map = "137102336", door = "66" },
  { map = "137103360", custom = dialogue(2447, 1) },
  { map = "136056074", custom = entrerdonjon },
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
end)()
