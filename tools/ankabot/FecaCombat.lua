-- FecaCombat.lua — généré le 2026-10-18 22:19 par tools/feca/script.ts : journal AnkaBot (journal-combats.lua) + IA des combats contre les
-- Krobes (modele-baleine.lua, plus bas), réglée pour un Féca seul. Ne pas éditer : régénérer (npm run feca:script).
-- PAS de DEVELOPER_MULTI_THREADING : essayé le 2026-10-10, il fait tourner deux fils dans la même machine Lua
-- (erreurs « attempt to index a function value » sur des variables locales, 3 journaux sur 4 arrêtés).

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
LOG_URL = "http://127.0.0.1:8766/log"         -- récepteur local (node scripts/fightlog-server.mjs)
SCHEMA_URL = "http://127.0.0.1:8766/schemas"  -- champs des types déjà découverts, servis par le récepteur
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
-- Silence seulement pendant son propre tour, pas pendant celui du combattant qui le précède : personnage seul (Féca du
-- Roc des Salbatroces, tools/feca/script.ts), aucun autre journal ne couvrirait ce tour (une Malamibe invoquée par le
-- dernier monstre serait perdue). Son script envoie alors lui-même l'état du combat avec chaque demande de plan.
QUIET_FROM_MY_TURN = false
-- Envois reportés autour de son tour : du début du tour du combattant qui le précède jusqu'à la fin du sien, le journal
-- enregistre sans rien envoyer (ni début de manche, ni début de tour, ni lancer « urgents ») ; son script envoie le lot
-- au début de fightManagement (JOURNAL_FLUSH_NOW). Personnage seul (Féca) : le journal suit le tour qui précède le sien
-- (Malamibe invoquée, relances), mais une requête HTTP au changement de tour occupe le script quand AnkaBot lance
-- fightManagement (2026-10-17 : 5 tours du Féca finis en 0 à 0,5 s ; 2026-10-10 : tours passés, journal occupé).
DEFER_SENDS_NEAR_MY_TURN = false
DEFER_MAX_SECONDS = 60                    -- report levé au plus tard N secondes après son début (sécurité)
-- Envois reportés pendant tout le combat : aucune requête HTTP depuis un message reçu (début de manche, début de tour,
-- lancer « urgents » compris) ; le lot part quand le script le demande (JOURNAL_FLUSH_NOW, au début de son tour), à la
-- fin du combat, ou au-delà de DEFER_MAX_LINES lignes. Féca seul : son prédécesseur est inconnu en manche 1, et le début
-- de la manche 2 (envoi « urgent ») tombait sur le début de son tour, passé en 0,1 s (2026-10-17, 15:58 et 15:59).
DEFER_SENDS_IN_FIGHT = false
DEFER_MAX_LINES = 3000
-- Messages du silence mis en file au lieu d'être perdus, traités ensuite : au début de fightManagement
-- (JOURNAL_FLUSH_NOW) ou au premier message après le silence. Pendant le silence, le journal ne fait que les ranger : le
-- script reste libre quand AnkaBot lance fightManagement. Féca seul : silence dès le tour qui précède le sien, comme la
-- Reine, sans perdre ce tour (Malamibe invoquée, relances) ni le sien (2026-10-17 : tours passés en 0,1 s sans que
-- fightManagement ait commencé ; le journal traitait la fin du tour du dernier monstre et le début de manche).
QUIET_QUEUE = false
QUIET_QUEUE_MAX = 3000
-- Ordre de jeu (liste des combattants, id en <entrée>.<id>) : le combattant qui précède le personnage, connu dès la
-- manche 1 (avant : seulement à partir de son 2e tour).
TURN_LIST_MESSAGE, TURN_LIST_FIELD, TURN_LIST_ENTRY, TURN_LIST_ID = "jvu", "fxlo", "fxkv", "fxld"
TURN_START, TURN_START_FIELD = "jvj", "fxjr"   -- début de tour : identifiant du combattant
TURN_END, TURN_END_FIELD = "jup", "fxgo"       -- fin de tour : identifiant du combattant
-- Fonction(nom, message) appelée à chaque message reçu, avant tout traitement du journal (script qui joue) ; nil : aucune.
JOURNAL_ON_MESSAGE = nil
TURN_WAIT_FIELD = "fxjq"                       -- début de tour : durée accordée par le jeu (dixièmes de seconde)
FIGHT_END_MESSAGE = "jwh"                      -- fin du combat (le silence s'arrête là, comme à la manche 1)
-- false : journal coupé, aucun message écouté (test : un script qui joue passe-t-il encore des tours sans le journal ?).
ENABLED = true
-- Personnages journalisés (nom → true) ; nil : tous. Les autres (mules du groupe, qui chargent le même script) n'écoutent
-- rien : le serveur du Féca ne garde que son journal.
JOURNAL_PERSONNAGES = nil
DIAGNOSTIC = true                        -- affiche les premiers messages reçus et les types découverts
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
-- Son dernier tour, gardé pendant le silence (aucun envoi) et écrit ensuite (événement « myTurn ») : début, durée
-- accordée par le jeu, fin. Sert aux tours sautés (2026-10-17 : tours du Féca finis en moins d'une demi-seconde).
local myTurnStart, myTurnWait, myTurnEnd = nil, nil, nil
local myTurnNames = {}                         -- messages reçus pendant ce tour (noms seulement, 40 au plus)
local deferSince = nil                         -- envois reportés depuis (DEFER_SENDS_NEAR_MY_TURN)
local listPrev = nil                           -- combattant qui le précède d'après l'ordre de jeu (TURN_LIST_MESSAGE)
local quietQueue = {}                          -- messages du silence en attente (QUIET_QUEUE) : { nom, message, ms }local entityKeys = nil

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
local function head(k, atMs)
  seq = seq + 1
  return '{"k":"' .. k .. '","i":' .. seq .. ',"ms":' .. (atMs or nowMs())
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

-- Envoi : tous les FLUSH_EVERY lignes, ou dès qu'une ligne urgente arrive, ou FLUSH_SECONDS après le dernier envoi
-- (rien pendant un report autour de son tour).
local function push(line, urgent)
  buffer[#buffer + 1] = line
  if DEFER_SENDS_IN_FIGHT and wasInFight and #buffer < DEFER_MAX_LINES then return end
  if deferSince ~= nil then
    if clock() - deferSince < DEFER_MAX_SECONDS then return end
    deferSince = nil
  end
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
  -- (DEFER_SENDS_IN_FIGHT : pas d'envoi au début de la manche 1, qui est aussi celui du premier tour)
  if not DEFER_SENDS_IN_FIGHT then flush() end
  global:printSuccess("[journal] combat n°" .. fightIndex .. " (" .. why .. ")")
end

local function endFight(why)
  wasInFight = false
  event("fightEnd", ',"why":' .. jsonString(why))
  writeCounts("fightEnd")
  if not (DEFER_SENDS_IN_FIGHT and why == "nouvelle manche 1") then flush() end
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
  if name == TURN_LIST_MESSAGE then
    if myFighterId == nil then pcall(function() myFighterId = character:id() end) end
    pcall(function()
      local items, n = collectionItems(getField(message, TURN_LIST_FIELD), true)
      if not items or myFighterId == nil then return end
      local ids = {}
      for j = 1, n do
        local okx, id = pcall(function() return getField(getField(items[j], TURN_LIST_ENTRY), TURN_LIST_ID) end)
        if okx and id ~= nil then ids[#ids + 1] = id end
      end
      for j = 1, #ids do
        if ids[j] == myFighterId and #ids > 1 then listPrev = ids[(j - 2) % #ids + 1] end
      end
      if listPrev ~= nil and not myTurnOn then prevOfMe = listPrev end
    end)
  end
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
      deferSince = nil
      return false
    end
  end
  if name == TURN_START or name == TURN_END then
    if myFighterId == nil then pcall(function() myFighterId = character:id() end) end
    local id = nil
    pcall(function() id = message[name == TURN_START and TURN_START_FIELD or TURN_END_FIELD] end)
    if name == TURN_START and id ~= nil then
      if id == myFighterId then
        prevOfMe = listPrev or lastStarter
        myTurnOn = true
        quietSince = quietSince or clock()
        myTurnStart, myTurnWait, myTurnEnd, myTurnNames = clock(), nil, nil, {}
        pcall(function() myTurnWait = message[TURN_WAIT_FIELD] end)
        if DEFER_SENDS_NEAR_MY_TURN then deferSince = deferSince or clock() end
      elseif myTurnOn then
        myTurnOn, quietSince = false, nil      -- mon tour est fini (fin de tour non reçue)
        myTurnEnd = myTurnEnd or clock()
        deferSince = nil
      elseif prevOfMe ~= nil and id == prevOfMe and quietSince == nil and not QUIET_FROM_MY_TURN then
        -- (pas d'envoi ici : une requête bloquante juste avant son tour ; le reste part à la fin du silence)
        quietSince = clock()
      end
      if DEFER_SENDS_NEAR_MY_TURN and prevOfMe ~= nil and id == prevOfMe and not myTurnOn then deferSince = deferSince or clock() end
      lastStarter = id
    elseif name == TURN_END and id ~= nil and id == myFighterId and quietSince ~= nil then
      myTurnEnd = clock()
      deferSince = nil
      quietCount = quietCount + 1
      myTurnOn, quietSince = false, nil
      return true
    end
  end
  if quietSince ~= nil and clock() - quietSince > QUIET_MAX_SECONDS then myTurnOn, quietSince = false, nil end
  if quietSince ~= nil then
    if myTurnStart ~= nil and myTurnEnd == nil and #myTurnNames < 40 then myTurnNames[#myTurnNames + 1] = name end
    quietCount = quietCount + 1
    return true
  end
  return false
end

local record

-- Messages du silence en attente, dans l'ordre d'arrivée, avec leur heure (QUIET_QUEUE).
local function drainQuiet()
  if #quietQueue == 0 then return end
  local q = quietQueue
  quietQueue = {}
  for _, it in ipairs(q) do record(it[1], it[2], it[3]) end
end

-- Envoi tout de suite, report compris (et file du silence traitée) : appelé par le script au début de son tour
-- (fightManagement), quand AnkaBot lui a donné la main.
JOURNAL_FLUSH_NOW = function()
  pcall(drainQuiet)
  pcall(flush)
end

local function onMessage(name, message)
  -- (script qui joue : il voit chaque message à son arrivée, silence compris — tours passés du Féca, 2026-10-18)
  if JOURNAL_ON_MESSAGE then pcall(JOURNAL_ON_MESSAGE, name, message) end
  -- (silence d'abord : un message du silence est mis en file même pendant le traitement de la file)
  if QUIET_AROUND_MY_TURN and quietFor(name, message) then
    if QUIET_QUEUE and #quietQueue < QUIET_QUEUE_MAX then
      quietQueue[#quietQueue + 1] = { name, message, nowMs() }
      return
    end
    received = received + 1
    counts[name] = (counts[name] or 0) + 1
    return
  end
  if inMessage then
    parallel = parallel + 1
    return
  end
  if #quietQueue > 0 then pcall(drainQuiet) end
  record(name, message)
end

-- Enregistrement d'un message (heure d'arrivée `atMs` s'il sort de la file du silence).
record = function(name, message, atMs)
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
    if myTurnStart ~= nil and myTurnEnd ~= nil then
      event("myTurn", ',"wait":' .. (type(myTurnWait) == "number" and jsonNumber(myTurnWait) or 'null') ..
        ',"seconds":' .. jsonNumber(math.floor((myTurnEnd - myTurnStart) * 1000 + 0.5) / 1000) ..
        ',"names":' .. jsonString(table.concat(myTurnNames, ",")))
      myTurnStart, myTurnWait, myTurnEnd = nil, nil, nil
    end
    if not perfDone then measure(message) end
    watchFight(name, message)
    local data, pend = toJson(message, "m:" .. name)
    local h = head("m", atMs)
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
  if deferSince == nil and not (DEFER_SENDS_IN_FIGHT and wasInFight) then
    local okW, errW = pcall(backgroundWork)
    if not okW then report("travail de fond", tostring(errW)) end
  end
  -- (combat fini : le lot reporté part tout de suite, plus de tour à protéger)
  if DEFER_SENDS_IN_FIGHT and name == FIGHT_END_MESSAGE then pcall(flush) end
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
  if JOURNAL_PERSONNAGES then
    local n = nil
    pcall(function() n = character:name() end)
    if type(n) == "string" and n ~= "" and not JOURNAL_PERSONNAGES[n] then
      global:printMessage("[journal] " .. n .. " absent de JOURNAL_PERSONNAGES (mule) : aucun message écouté")
      return
    end
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

-- Réglages du journal pour un script qui joue (tools/feca/script.ts) : script libre quand AnkaBot lance fightManagement.
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

-- Féca : le journal enregistre et envoie tout, normalement (ni silence autour du tour, ni report des envois ; le script
-- envoie ce qu'il a au début de son tour, sans attendre le reste).
QUIET_AROUND_MY_TURN = false
-- Journal du Féca et de Kyanna-Lee seulement : les mules (AnkaBot leur charge aussi ce script) n'envoient rien.
JOURNAL_PERSONNAGES = { ["Kaskyzo"] = true, ["Kyanna-Lee"] = true }

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
IS_WAVE_FIGHT = true
PLAN_URL = "http://127.0.0.1:8766/plan"            -- serveur de plans (même port que le récepteur du journal)
PLACEMENT_URL = "http://127.0.0.1:8766/placement"  -- case de placement de chaque Crâ
-- Serveur absent, ou aucun plan : "passer" (ne rien faire), "ia" (IA basique d'AnkaBot, fightBasic:playTurn : attention,
-- elle peut soigner ou pousser la Virustine) ou "main" (arrêter le script : le joueur finit le combat à la main).
SANS_PLAN = "passer"
REPLANIFIER = 2           -- nouveaux plans demandés au plus dans un même tour, après un écart (0 : aucun)
ATTENTE_PLAN = 0
ATTENTE_SUITE = 0
SONDE_MS = 100            -- pause entre deux sondes
SONDE_LONGUE_MS = 300
SONDE_MAX_MS = 15000
-- (2026-10-17, retirés le soir : attentes autour de isItMyTurn(), main gardée jusqu'au tour suivant, pause après un
-- déplacement final, messages remis de force au journal, main rendue d'après le journal — aucun n'a fait ses preuves,
-- plusieurs ont fait perdre des tours. Début de tour : isItMyTurn() faux → main rendue, sinon on joue.)
-- Personnages qui jouent (nom → true) ; nil : tous. Les autres personnages du groupe (AnkaBot charge le script sur les
-- mules) sont des mules : case de placement demandée au serveur (groupées, pour que le Féca les tue d'un sort de zone),
-- tours passés.
JOUEURS = { ["Kaskyzo"] = true, ["Kyanna-Lee"] = true }
-- Mules : à chacun de leurs tours, vers le Krobe le plus proche, pour s'y faire tuer (false : elles restent en place).
MULES_AVANCENT = true
-- Tueuses (nom → true) : jouées par le serveur, mais placées avec les mules (elles les tuent, puis vont mourir).
TUEUSES = { ["Kyanna-Lee"] = true }
-- Joués à la main (nom → true) : le script ne place pas ces personnages et ne joue pas leurs tours. Il garde la main
-- jusqu'au début du combat, puis jusqu'à la fin de chacun de leurs tours (AnkaBot les mettrait prêts, ou finirait le tour,
-- à son retour) ; il note le plan que le serveur aurait joué (A_LA_MAIN_PLAN), et le journal enregistre tout.
A_LA_MAIN = nil
A_LA_MAIN_PLAN = true
A_LA_MAIN_MAX_MS = 120000 -- main gardée au plus ce délai, au placement comme à chaque tour
A_LA_MAIN_FIN_MS = 1500   -- isItMyTurn() faux pendant ce délai de suite : tour fini (il clignote parfois quelques centaines de ms)
-- false : isItMyTurn() n'est jamais appelé, le tour est tenu pour le mien du lancement de fightManagement jusqu'à la fin du
-- plan (essai du joueur, 2026-10-18 : tours sautés quand AnkaBot lance fightManagement avant mon tour).
VERIFIER_MON_TOUR = false
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
CARTES = { "140513539", "140514563", "140515587", "140516611", "140517635", "140509185", "140509187", "140509441",
  "140509443", "140510209", "140510465", "140510467", "140510469", "140511489", "140641537" }
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
ENVOYER_ETAT = true
NOM_IA = "Féca contre les Krobes (Roc des Salbatroces)"
SCRIPT_GENERE = "FecaCombat.lua généré le 2026-10-18 22:19 UTC"
-- Tours passés : messages lus (noms obfusqués du 2026-10-09, comme tools/reine-des-voleurs/planificateur/journal.ts) —
-- action de combat (jsq : auteur fwuw, sort lancé fwuy, son identifiant en fwuy.fwqu.fwpu) et déplacement (jnz :
-- combattant fwaf). Début et fin de tour : TURN_START et TURN_END du journal.
PASSE_TOUR = { action = "jsq", auteur = "fwuw", sort = "fwuy", lancer = "fwqu", sortId = "fwpu", mouvement = "jnz", qui = "fwaf" }
PREFIXE_JOURNAL = "ia_feca_"
LANCEUR = "tools/ankabot/lancer_serveur_feca.cmd"

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

-- ─────────────────────────── trajet jusqu'au Roc des Salbatroces ───────────────────────────
-- (donné par le joueur, 2026-10-18) De 54176040, chaque personnage passe au Roc (élément 538666). Combats lancés par
-- fight = true : map:fight() dans un custom (comme ReineCombat.lua, essayé le 2026-10-18) attaque n'importe quel
-- groupe, sans MIN_MONSTERS ni MAX_MONSTERS (113 combats à 3 monstres et 27 à 6-7 en une soirée). (Tours du Féca fermés
-- de l'après-midi : causés par le mode MITM d'AnkaBot ouvert pendant les combats, trouvé par le joueur.)

-- Vers le Roc, pour tous les personnages : élément interactif 538666 de la carte 54176040 (trouvé par le joueur,
-- 2026-10-18). Ni map:moveToward(140510209) ni le voyage automatique rejoué (message jok) n'ont fait bouger le personnage.
function allerRoc()
  local ok, err = pcall(function() map:useById(538666, -1) end)
  if ok then global:printSuccess("[TRAJET] vers le Roc des Salbatroces (élément 538666)")
  else global:printError("[TRAJET] élément 538666 : " .. tostring(err)) end
end

TRAJET = {
  { map = "54172969", path = "left" },
  { map = "54173481", path = "left" },
  { map = "54173993", path = "left" },
  { map = "54174505", path = "left" },
  { map = "54175017", path = "left" },
  { map = "54175529", path = "left" },
  { map = "54176041", path = "bottom" },
  { map = "54176040", custom = allerRoc },
}

-- Mule qui a perdu son chef (appelée par AnkaBot à chaque changement de carte, au bout de ANKABOT_TIMEOUT secondes) :
-- sur une carte du TRAJET, son action (path : map:changeMap ; custom : la fonction, allerRoc en 54176040) ; ailleurs,
-- vers la carte du chef (map:moveToward). Demandé par le joueur le 2026-10-18.
function mule_lost(bossMapId)
  local ici = nil
  pcall(function() ici = tostring(map:currentMapId()) end)
  for _, e in ipairs(TRAJET or {}) do
    if e.map == ici then
      local ok, err = pcall(function()
        if e.custom then e.custom() elseif e.path then map:changeMap(e.path) end
      end)
      if not ok then global:printError("[TRAJET] mule perdue en " .. ici .. " : " .. tostring(err)) end
      return
    end
  end
  local ok, err = pcall(function() map:moveToward(bossMapId) end)
  if not ok then global:printError("[TRAJET] mule perdue, vers " .. tostring(bossMapId) .. " : " .. tostring(err)) end
end

-- Groupes attaqués (2026-10-18, 62 combats avec mules) : à 3 monstres, jamais toutes les mules tuées à la manche 1
-- (essayé, puis 4 de nouveau, choix du joueur : trois défaites de suite sur un même groupe de 3) ; à 6 et plus, les coups
-- tuent le Féca, qui part souvent à 50 % de ses PV. (Plus de limite par espèce, AMOUNT_MONSTERS : retirée par le joueur
-- le 2026-10-18, trop stricte, plus aucun groupe trouvé — ne pas la remettre.)
MIN_MONSTERS = 3
MAX_MONSTERS = 6

-- (mis par le joueur dans FecaCombat.lua le 2026-10-18 au soir)
ANKABOT_TIMEOUT = 10

-- Circuit de combats au Roc (donné par le joueur, 2026-10-18), parcouru en boucle : une carte qui revient prend l'action
-- de son passage suivant (140509441 : right, puis top, puis bottom). fight = true : AnkaBot attaque un groupe qui respecte
-- MIN_MONSTERS et MAX_MONSTERS, sinon suit le path de l'étape.
CIRCUIT = {
  { map = "140510209", fight = true, path = "left" },
  { map = "140509185", fight = true, path = "top" },
  { map = "140509441", fight = true, path = "right" },
  { map = "140510465", fight = true, path = "right" },
  { map = "140511489", fight = true, path = "left" },
  { map = "140510465", fight = true, path = "left" },
  { map = "140509441", fight = true, path = "top" },
  { map = "140509443", fight = true, path = "right" },
  { map = "140510467", fight = true, path = "top" },
  { map = "140510469", fight = true, path = "bottom" },
  { map = "140510467", fight = true, path = "left" },
  { map = "140509443", fight = true, path = "bottom" },
  { map = "140509441", fight = true, path = "bottom" },
  { map = "140509185", fight = true, path = "right" },
  { map = "140510209", fight = true, path = "left" },
}
