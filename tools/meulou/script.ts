// Génère les scripts AnkaBot de la Tanière du Meulou : le journal AnkaBot (tools/ankabot/journal-combats.lua) suivi du
// modèle de combat (tools/ventre-de-la-baleine/modele-baleine.lua) et du trajet (entrée, salles, porte, sortie, boucle) :
//  - tools/ankabot/MeulouCombat.lua : le Sacrieur placé et joué par le serveur de plans (tools/meulou/serveur.ts,
//    planificateur.ts) ; les mules placées par le serveur, tours passés ;
//  - tools/ankabot/MeulouMain.lua : combats d'étude, le Sacrieur joué à la main, les mules qui passent leurs tours sur
//    la case que le jeu leur donne.
// Tout est enregistré par le journal du Sacrieur. Écrit aussi le lanceur du serveur, tools/ankabot/lancer_serveur_meulou.cmd
// (port 8767), le même pour les deux scripts.
//
//   npx tsx tools/meulou/script.ts [--sacrieur Larry-Kind-jumploise] [--journal "Mule1,Mule2"] [--dossier tools/ankabot]
//
// --journal : personnages qui tiennent aussi un journal (défaut : le Sacrieur seul, comme FecaMain.lua).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HEAD_NOTE, loggerForPlay } from '../fightlog/ia'
import {
  CARTES_COMBAT, CARTES_MEULOU, ENTREE, nomCarte, PNJ_ENTREE, PNJ_SORTIE, PORTES, PORT_MEULOU, REPONSES_ENTREE, REPONSES_SORTIE, SACRIEUR, SORTIE,
} from './meulou'

const BY = 'tools/meulou/script.ts'

/**
 * Entrée du donjon, combats des salles et sortie, après le modèle (son `TRAJET = nil` est ainsi remplacé) : PNJ de
 * l'entrée pour chaque personnage ; dans chaque salle, le chef attend ses mules et lance le combat (map:fight(), comme
 * ReineCombat.lua) ; salle à porte : la porte ; salle de sortie : le PNJ, qui ramène à l'entrée (boucle). Mule perdue :
 * l'action de sa carte (PNJ, porte), sinon vers la carte du chef.
 */
function trajetMeulou(GROUPE = 8): string {
  const salles = [
    ...CARTES_COMBAT.map(id => `  { map = "${id}", custom = combattreSalle },  -- ${nomCarte(id)}`),
    ...Object.entries(PORTES).map(([id, porte]) => `  { map = "${id}", door = "${porte}" },  -- ${nomCarte(Number(id))} : pas de combat, porte vers la salle suivante`),
    `  { map = "${SORTIE}", custom = sortirMeulou },  -- ${nomCarte(SORTIE)} : PNJ, retour à l'entrée`,
  ]
  return `
-- ─────────────────────────── entrée du donjon, combats des salles, sortie ───────────────────────────
-- (donnés par le joueur, 2026-10-19) Entrée en ${ENTREE} : PNJ ${PNJ_ENTREE}, puis ${REPONSES_ENTREE} fois la première réponse
-- (npc:reply(-1)) ; première salle : 155713536. Dans chaque salle, le chef attend ses mules (global:teamCheck), puis lance
-- le combat (map:fight(), comme ReineCombat.lua : le groupe de la salle, quelle que soit sa taille). Après une victoire,
-- le jeu emmène le groupe dans la salle suivante. Après le boss, salle ${SORTIE} : PNJ ${PNJ_SORTIE}, ${REPONSES_SORTIE} réponse,
-- retour à l'entrée, et le donjon recommence.
MEULOU_ENTREE = "${ENTREE}"
MEULOU_SORTIE = "${SORTIE}"
MEULOU_DELAI_DIALOGUE = 500   -- ms avant chaque réponse au PNJ
ANKABOT_TIMEOUT = 60          -- s avant qu'une mule qui n'a pas suivi son chef appelle mule_lost (60 : demandé par le joueur, 2026-10-19)

-- Chef du groupe (ou personnage seul) : lui seul lance les combats. Une mule a un chef (leaderAccountController).
local function meulouEstChef()
  local ok, chef = pcall(function() return global:isBoss() end)
  if ok and chef == true then return true end
  local ok2, leader = pcall(function() return global:leaderAccountController() end)
  return ok2 and leader == nil
end

local function meulouCarte()
  local c = "?"
  pcall(function() c = tostring(map:currentMapId()) end)
  return c
end

-- Dialogue avec un PNJ (action 3), puis « reponses » fois la première réponse ; le chef attend d'abord ses mules.
local function meulouDialogue(quoi, pnj, reponses)
  if meulouEstChef() then pcall(function() global:teamCheck() end) end
  local ok, err = pcall(function()
    npc:npc(pnj, 3)
    for _ = 1, reponses do
      global:delay(MEULOU_DELAI_DIALOGUE)
      npc:reply(-1)
    end
  end)
  if ok then global:printSuccess("[TRAJET] " .. quoi .. " : PNJ " .. pnj .. ", " .. reponses .. " réponse(s)")
  else global:printError("[TRAJET] " .. quoi .. ", PNJ " .. pnj .. " : " .. tostring(err)) end
  pcall(function() global:delay(2000) end)
end

-- Entrée : chaque personnage parle au PNJ.
function entrerMeulou() meulouDialogue("entrée du donjon", ${PNJ_ENTREE}, ${REPONSES_ENTREE}) end
-- Sortie (après le boss) : chaque personnage parle au PNJ, qui le ramène à l'entrée.
function sortirMeulou() meulouDialogue("sortie du donjon", ${PNJ_SORTIE}, ${REPONSES_SORTIE}) end

-- Salle : le chef attend ses mules, puis lance le combat ; les mules attendent (AnkaBot les fait rejoindre le combat).
-- (2026-10-19 à 20:23 : combat lancé 5 s après l'entrée avec une seule mule arrivée, global:teamCheck() n'ayant pas
-- attendu ; les monstres étaient 4 au lieu de 8. Le chef attend donc aussi que map:countPlayers() compte le groupe.)
MEULOU_GROUPE = ${GROUPE}            -- personnages du groupe (Sacrieur et mules)
MEULOU_ATTENTE_GROUPE_MS = 120000    -- au-delà, le combat est lancé quand même (plus que ANKABOT_TIMEOUT : une mule restée en arrière a le temps d'arriver)
local meulouSansCombat = {}
local function meulouAttendreGroupe(carte)
  local t0 = os.clock()
  local n = -1
  while (os.clock() - t0) * 1000 < MEULOU_ATTENTE_GROUPE_MS do
    pcall(function() n = map:countPlayers() end)
    -- (countPlayers compte-t-il le chef ? inconnu : le groupe moins un suffit, la valeur est affichée)
    if n >= MEULOU_GROUPE - 1 then return n end
    pcall(function() global:delay(1000) end)
  end
  global:printError("[TRAJET] " .. carte .. " : " .. tostring(n) .. " personnage(s) sur la carte après " ..
    math.floor(MEULOU_ATTENTE_GROUPE_MS / 1000) .. " s, combat lancé quand même")
  return n
end
function combattreSalle()
  local carte = meulouCarte()
  if meulouEstChef() then
    pcall(function() global:teamCheck() end)
    local n = meulouAttendreGroupe(carte)
    pcall(function() global:delay(500) end)
    local ok, lance = pcall(function() return map:fight() end)
    if ok and lance then
      meulouSansCombat[carte] = nil
      global:printSuccess("[TRAJET] combat lancé en " .. carte .. " (map:countPlayers() = " .. tostring(n) .. ")")
    elseif not meulouSansCombat[carte] then
      meulouSansCombat[carte] = true
      global:printMessage("[TRAJET] aucun combat lancé en " .. carte .. (ok and "" or (" : " .. tostring(lance))) ..
        " (nouvel essai toutes les 2 s)")
    end
  end
  pcall(function() global:delay(2000) end)
end

TRAJET = {
  { map = MEULOU_ENTREE, custom = entrerMeulou },
${salles.join('\n')}
}

-- Mule qui a perdu son chef (appelée par AnkaBot à chaque changement de carte, au bout de ANKABOT_TIMEOUT secondes) :
-- à l'entrée ou à la sortie, elle parle au PNJ ; dans une salle à porte, elle prend la porte ; ailleurs, vers la carte du
-- chef (map:moveToward).
function mule_lost(bossMapId)
  local ici = meulouCarte()
  if ici == MEULOU_ENTREE then return entrerMeulou() end
  if ici == MEULOU_SORTIE then return sortirMeulou() end
  for _, e in ipairs(TRAJET or {}) do
    if e.map == ici and e.door then
      local ok, err = pcall(function() map:door(tonumber(e.door)) end)
      if not ok then global:printError("[TRAJET] mule perdue, porte " .. e.door .. " : " .. tostring(err)) end
      return
    end
  end
  local ok, err = pcall(function() map:moveToward(bossMapId) end)
  if not ok then global:printError("[TRAJET] mule perdue, vers " .. tostring(bossMapId) .. " : " .. tostring(err)) end
end
`
}

/** Remplace la ligne de réglage `nom = …` du modèle (erreur si elle n'y est pas). */
function regler(model: string, nom: string, valeur: string): string {
  const re = new RegExp(`^${nom} = .*$`, 'm')
  if (!re.test(model)) throw new Error(`réglage ${nom} absent du modèle`)
  return model.replace(re, `${nom} = ${valeur}`)
}

const table = (noms: string[]) => `{ ${noms.map(n => `["${n}"] = true`).join(', ')} }`

export type ModeMeulou = 'combat' | 'main'

export function buildMeulou(root = process.cwd(), opts: { mode?: ModeMeulou; sacrieur?: string; journal?: string[] } = {}): string {
  const mode = opts.mode ?? 'combat'
  const sacri = opts.sacrieur ?? SACRIEUR
  const journaux = [...new Set([sacri, ...(opts.journal ?? [])])]
  const nomFichier = mode === 'main' ? 'MeulouMain.lua' : 'MeulouCombat.lua'
  let model = readFileSync(join(root, 'tools', 'ventre-de-la-baleine', 'modele-baleine.lua'), 'utf8')
  model = regler(model, 'NOM_IA', mode === 'main' ? '"Tanière du Meulou (Sacrieur à la main, mules qui passent)"' : '"Tanière du Meulou (Sacrieur, serveur de plans)"')
  model = regler(model, 'PREFIXE_JOURNAL', '"ia_meulou_"')
  model = regler(model, 'LANCEUR', '"tools/ankabot/lancer_serveur_meulou.cmd"')
  // Le Sacrieur seul joue ; tout autre personnage du groupe est une mule (tours passés), quelle qu'elle soit.
  model = regler(model, 'JOUEURS', table([sacri]))
  model = regler(model, 'MULES_AVANCENT', 'false')
  if (mode === 'main') {
    // Joué à la main : le script ne le place pas, ne joue pas ses tours et garde la main jusqu'à leur fin (AnkaBot les
    // finirait à son retour) ; aucun plan demandé. Mules : sur la case que le jeu leur donne.
    model = regler(model, 'A_LA_MAIN', table([sacri]))
    model = regler(model, 'A_LA_MAIN_PLAN', 'false')
    model = regler(model, 'PLACEMENT_MULES', 'false')
    // (isItMyTurn() lu : c'est lui qui dit quand le tour joué à la main est fini)
    model = regler(model, 'VERIFIER_MON_TOUR', 'true')
  } else {
    // Joué par le serveur, comme le Féca seul (tools/feca/script.ts) : l'état visible part avec chaque demande de plan
    // (le journal du Sacrieur ne reçoit rien pendant son propre tour), plan demandé tout de suite, réponse attendue par
    // sondes courtes ; nouveau plan tout de suite après une action refusée.
    model = regler(model, 'ENVOYER_ETAT', 'true')
    model = regler(model, 'PLACEMENT_MULES', 'true')
    model = regler(model, 'ATTENTE_PLAN', '0')
    model = regler(model, 'SONDE_LONGUE_MS', '300')
    model = regler(model, 'SONDE_MAX_MS', '15000')
    model = regler(model, 'ATTENTE_SUITE', '0')
    // (comme le Féca : isItMyTurn() peut être faux au début de son tour, bug signalé à AnkaBot, qui passait le tour)
    model = regler(model, 'VERIFIER_MON_TOUR', 'false')
    // (invocations en cours de combat : Milimeulou, Mulous ; comme la Reine et le Féca)
    model = regler(model, 'IS_WAVE_FIGHT', 'true')
  }
  const cartes = CARTES_MEULOU.map(c => `"${c}"`)
  model = model.replace(/^CARTES = \{[^}]*\}/m, `CARTES = { ${cartes.slice(0, 8).join(', ')},\n  ${cartes.slice(8).join(', ')} }`)
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  model = regler(model, 'SCRIPT_GENERE', `"${nomFichier} généré le ${stamp} UTC"`)
  const head = `-- ${nomFichier} — généré le ${stamp} par ${BY} : journal AnkaBot (journal-combats.lua) + modèle de combat\n` +
    `-- (modele-baleine.lua, plus bas) + trajet de la Tanière du Meulou. Ne pas éditer : régénérer (npm run meulou:script).\n` +
    (mode === 'main'
      ? `-- Joué à la main : ${sacri}. Mules (les autres personnages du groupe) : tours passés, case du jeu gardée.\n`
      : `-- ${sacri} placé et joué par le serveur de plans (tools/ankabot/lancer_serveur_meulou.cmd). Mules : placées par le serveur, tours passés.\n`) +
    HEAD_NOTE
  const tuning = `-- Journal normal (ni silence autour du tour, ni report des envois), comme le Féca.\n` +
    `QUIET_AROUND_MY_TURN = false\n` +
    `-- Journal tenu par : ${journaux.join(', ')} (les mules n'envoient rien).\n` +
    `JOURNAL_PERSONNAGES = ${table(journaux)}\n\n`
  return (head + loggerForPlay(root, BY) + tuning + model + trajetMeulou()).replaceAll('127.0.0.1:8765', `127.0.0.1:${PORT_MEULOU}`)
}

/** Lanceur du serveur, à côté des scripts : chemin du projet en dur. */
export function writeMeulouLauncher(dir: string): string {
  const cmd = join(dir, 'lancer_serveur_meulou.cmd')
  writeFileSync(cmd, [
    '@echo off',
    'rem Serveur de plans du Sacrieur (Taniere du Meulou) et recepteur du journal AnkaBot, pour MeulouCombat.lua et MeulouMain.lua.',
    `rem FICHIER GENERE par ${BY} (chemin du projet ci-dessous).`,
    'rem A lancer AVANT de charger le script ; laisser la fenetre ouverte pendant les combats (Ctrl+C : arret).',
    'rem Planificateur modifie : relancer ce serveur.',
    `cd /d "${process.cwd()}"`,
    `set FIGHTLOG_PORT=${PORT_MEULOU}`,
    'call npx tsx tools/meulou/serveur.ts',
    'pause',
    '',
  ].join('\r\n'), 'utf8')
  return cmd
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('meulou/script.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const journal = arg('--journal')?.split(',').map(n => n.trim()).filter(Boolean)
  const dir = arg('--dossier') ?? join(process.cwd(), 'tools', 'ankabot')
  for (const mode of ['combat', 'main'] as const) {
    const out = join(dir, mode === 'main' ? 'MeulouMain.lua' : 'MeulouCombat.lua')
    writeFileSync(out, buildMeulou(process.cwd(), { mode, sacrieur: arg('--sacrieur'), journal }), 'utf8')
    console.log(`Écrit : ${out}`)
  }
  console.log(`Écrit : ${writeMeulouLauncher(dir)}`)
}
