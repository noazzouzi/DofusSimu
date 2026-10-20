// Génère tools/ankabot/FecaCombat.lua : le journal AnkaBot (tools/ankabot/journal-combats.lua) suivi de l'IA des combats
// contre les Krobes (modèle tools/ventre-de-la-baleine/modele-baleine.lua), réglée pour un Féca seul au Roc des
// Salbatroces : silence du journal pendant son seul tour, état visible envoyé avec chaque demande de plan. Le serveur
// (tools/feca/serveur.ts) choisit le planificateur du Féca (tools/feca/planificateur.ts). Écrit aussi son lanceur,
// tools/ankabot/lancer_serveur_feca.cmd.
//
//   npx tsx tools/feca/script.ts [--sans-plan passer|ia|main] [--sortie tools/ankabot/FecaCombat.lua]
//   npx tsx tools/feca/script.ts --journal-muet   (tools/ankabot/FecaCombatMuet.lua : essai D, journal muet en combat)
//   npx tsx tools/feca/script.ts --main Kaskyzo   (tools/ankabot/FecaMain.lua : Kaskyzo joué à la main, les autres comme
//   d'habitude)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HEAD_NOTE, loggerForPlay } from '../fightlog/ia'
import { JOUEURS, PORT_FECA, TUEUSES } from './feca'

const BY = 'tools/feca/script.ts'

/** Cartes du Roc des Salbatroces (sous-zone 834, DofusDB) : les 5 arènes de combat (0,0) et les cartes de la zone. */
export const CARTES_SALBATROCES = [
  140513539, 140514563, 140515587, 140516611, 140517635,
  140509185, 140509187, 140509441, 140509443, 140510209, 140510465, 140510467, 140510469, 140511489, 140641537,
]

/**
 * Trajet jusqu'au Roc des Salbatroces et circuit de combats (donnés par le joueur, 2026-10-18), après le modèle (ses
 * `TRAJET = nil` et `CIRCUIT = nil` sont ainsi remplacés) : cartes jusqu'à 54176040, d'où chaque personnage passe au Roc
 * par l'élément interactif 538666, puis circuit de combats en boucle, les combats lancés par AnkaBot (fight = true, qui
 * applique MIN_MONSTERS et MAX_MONSTERS) ; mule perdue : l'action du TRAJET pour sa carte, sinon vers la carte du chef
 * (mule_lost).
 */
const TRAJET_ROC = `
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
MIN_MONSTERS = 4
MAX_MONSTERS = 5

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
`

/** Remplace la ligne de réglage `nom = …` du modèle (erreur si elle n'y est pas). */
function regler(model: string, nom: string, valeur: string): string {
  const re = new RegExp(`^${nom} = .*$`, 'm')
  if (!re.test(model)) throw new Error(`réglage ${nom} absent du modèle`)
  return model.replace(re, `${nom} = ${valeur}`)
}

export function buildFecaScript(root = process.cwd(), opts: { sansPlan?: string; main?: string[]; journalMuet?: boolean } = {}): string {
  const joueursLua = `{ ${JOUEURS.map(n => `["${n}"] = true`).join(', ')} }`
  let model = readFileSync(join(root, 'tools', 'ventre-de-la-baleine', 'modele-baleine.lua'), 'utf8')
  if (opts.sansPlan) {
    if (!['passer', 'ia', 'main'].includes(opts.sansPlan)) throw new Error(`--sans-plan ${opts.sansPlan} : passer, ia ou main`)
    model = regler(model, 'SANS_PLAN', `"${opts.sansPlan}"`)
  }
  model = regler(model, 'ENVOYER_ETAT', 'true')
  model = regler(model, 'NOM_IA', '"Féca contre les Krobes (Roc des Salbatroces)"')
  model = regler(model, 'PREFIXE_JOURNAL', '"ia_feca_"')
  model = regler(model, 'LANCEUR', '"tools/ankabot/lancer_serveur_feca.cmd"')
  // Mules (2026-10-17 : Féca et 5 mules) : tout personnage du groupe absent de JOUEURS, placé en appât, tours passés.
  model = regler(model, 'JOUEURS', joueursLua)
  // (2026-10-17 à 23:01 : mules à l'écart des monstres, jamais touchées : elles vont à eux)
  model = regler(model, 'MULES_AVANCENT', 'true')
  // Tueuses (Kyanna-Lee) : placées avec les mules, qu'elles tuent à leur 1er tour, puis vont mourir chez les monstres.
  model = regler(model, 'TUEUSES', `{ ${TUEUSES.map(n => `["${n}"] = true`).join(', ')} }`)
  // Plan demandé tout de suite, sans attendre le journal (ATTENTE_PLAN 0 : le serveur planifie dès la 1re demande, sur
  // le journal reçu et l'état visible que le script envoie) ; réponse attendue par courtes demandes, 100 ms entre deux.
  model = regler(model, 'ATTENTE_PLAN', '0')
  model = regler(model, 'SONDE_LONGUE_MS', '300')
  // (calcul jusqu'à 8 s et plus avec 4 mules et Kyanna-Lee comme cibles : 2026-10-17 à 23:59, plan arrivé trop tard, tour
  // 1 du Féca perdu ; le jeu accorde 42 s par tour)
  model = regler(model, 'SONDE_MAX_MS', '15000')
  // Nouveau plan après une action refusée : tout de suite aussi (3 s d'attente du journal avant, 2026-10-18 ; l'état
  // visible envoyé avec chaque demande suffit au serveur).
  model = regler(model, 'ATTENTE_SUITE', '0')
  // Tour jamais vérifié (essai du joueur, 2026-10-18 : tours sautés quand AnkaBot lance fightManagement avant mon tour ;
  // une session sans isItMyTurn() pour voir si ça vient de lui).
  model = regler(model, 'VERIFIER_MON_TOUR', 'false')
  // Combat à vagues pour AnkaBot, comme la Reine (2026-10-18, comparaison avec ReineCombat.lua, qui n'a pas de tours
  // fermés) : de nouveaux monstres arrivent en cours de combat (une Malamibe à chaque invocation), et les tours fermés
  // suivent justement le tour d'une Malamibe ; sans ce réglage, AnkaBot peut croire le combat fini.
  model = regler(model, 'IS_WAVE_FIGHT', 'true')
  // (plan rapide, PLAN_RAPIDE : essayé le 2026-10-18 de 02:40 à 03:15 contre les tours fermés, sans effet ; leur cause
  // était le mode de combat rapide d'AnkaBot, 0 tour fermé sur 22 en mode Safe. Retiré : son premier pas, moins bon, a
  // gâché le tour 2 de 03:15 — Bergerie, puis Transhumance refusée sous sa Pesanteur.)
  // Joués à la main (idée du joueur, 2026-10-18 : des combats joués à la main, enregistrés, comparés aux plans du serveur).
  const main = opts.main ?? []
  if (main.length) model = regler(model, 'A_LA_MAIN', `{ ${main.map(n => `["${n}"] = true`).join(', ')} }`)
  const cartes = CARTES_SALBATROCES.map(c => `"${c}"`)
  model = model.replace(/^CARTES = \{[^}]*\}/m, `CARTES = { ${cartes.slice(0, 8).join(', ')},\n  ${cartes.slice(8).join(', ')} }`)
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const nomFichier = main.length ? 'FecaMain.lua' : opts.journalMuet ? 'FecaCombatMuet.lua' : 'FecaCombat.lua'
  // (noté au début du journal de chaque combat : savoir quel script a tourné, 2026-10-18)
  model = regler(model, 'SCRIPT_GENERE', `"${nomFichier} généré le ${stamp} UTC"`)
  const head =`-- ${nomFichier} — généré le ${stamp} par ${BY} : journal AnkaBot (journal-combats.lua) + IA des combats contre les\n` +
    `-- Krobes (modele-baleine.lua, plus bas), réglée pour un Féca seul. Ne pas éditer : régénérer (npm run feca:script).\n` +
    (main.length ? `-- Joués à la main : ${main.join(', ')} (ni placés ni joués par le script ; plan du serveur noté pour comparer).\n` : '') +
    (opts.journalMuet ? `-- Journal muet (essai D) : aucune requête HTTP depuis un message reçu pendant les combats, silence autour du tour.\n` : '') + HEAD_NOTE
  // Essai D (2026-10-18, demandé par le joueur) : tours du Féca fermés en mode de combat rapide juste après un tour ennemi
  // instantané (Malamibe, Virustine qui ne fait rien), avant même le lancement du script. Seul le journal tourne alors :
  // ici il ne fait plus aucune requête HTTP depuis un message reçu pendant un combat (lot envoyé par le script au début de
  // son tour, JOURNAL_FLUSH_NOW, et à la fin du combat) et se tait, messages mis en file, du début du tour de celui qui
  // précède le personnage jusqu'à la fin du sien (comme la Reine). Tours encore fermés : le journal n'y est pour rien.
  const journal = opts.journalMuet
    ? `-- Journal muet (essai D) : ni requête HTTP depuis un message reçu en combat, ni traitement autour de son tour (file).\n` +
      `QUIET_AROUND_MY_TURN = true\nQUIET_QUEUE = true\nDEFER_SENDS_IN_FIGHT = true\n`
    : `-- Féca : le journal enregistre et envoie tout, normalement (ni silence autour du tour, ni report des envois ; le script\n` +
      `-- envoie ce qu'il a au début de son tour, sans attendre le reste).\n` +
      `QUIET_AROUND_MY_TURN = false\n`
  const tuning = journal +
    `-- Journal du Féca et de Kyanna-Lee seulement : les mules (AnkaBot leur charge aussi ce script) n'envoient rien.\n` +
    `JOURNAL_PERSONNAGES = ${joueursLua}\n\n`
  // (journal, schémas, plans et placement : tous sur le port du Féca)
  return (head + loggerForPlay(root, BY) + tuning + model + TRAJET_ROC).replaceAll('127.0.0.1:8765', `127.0.0.1:${PORT_FECA}`)
}

/** Lanceur du serveur, à côté du script (copiable avec lui dans le dossier de scripts d'AnkaBot) : chemin du projet en dur. */
export function writeFecaLauncher(dir: string): string {
  const cmd = join(dir, 'lancer_serveur_feca.cmd')
  writeFileSync(cmd, [
    '@echo off',
    'rem Serveur de plans du Feca contre les Krobes (et recepteur du journal AnkaBot) pour FecaCombat.lua.',
    `rem FICHIER GENERE par ${BY} (chemin du projet ci-dessous).`,
    'rem A lancer AVANT de charger FecaCombat.lua ; laisser la fenetre ouverte pendant les combats (Ctrl+C : arret).',
    `cd /d "${process.cwd()}"`,
    `set FIGHTLOG_PORT=${PORT_FECA}`,
    'call npx tsx tools/feca/serveur.ts',
    'pause',
    '',
  ].join('\r\n'), 'utf8')
  return cmd
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('feca/script.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const main = arg('--main')?.split(',').map(n => n.trim()).filter(Boolean)
  const journalMuet = process.argv.includes('--journal-muet')
  const out = arg('--sortie') ?? join(process.cwd(), 'tools', 'ankabot', main?.length ? 'FecaMain.lua' : journalMuet ? 'FecaCombatMuet.lua' : 'FecaCombat.lua')
  writeFileSync(out, buildFecaScript(process.cwd(), { sansPlan: arg('--sans-plan'), main, journalMuet }), 'utf8')
  console.log(`Écrit : ${out}`)
  console.log(`Écrit : ${writeFecaLauncher(dirname(out))}`)
}
