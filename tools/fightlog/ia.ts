// Génère tools/ankabot/ReineIA.lua : le journal AnkaBot (tools/ankabot/journal-combats.lua) suivi de l'IA de la Reine
// des Voleurs (modèle tools/fightlog/modele-ia.lua), qui demande chaque tour au serveur de plans
// (tools/reine-des-voleurs/planificateur/serveur.ts) et l'exécute.
//
//   npx tsx tools/fightlog/ia.ts [--formation "Placement 2=data/fightlogs/2026-10-10/session-21-27-31.jsonl"]…
//                                [--colonne "Placement 2=Java-Springboot:327,Lamouit:354,…"] [--sortie tools/ankabot/ReineIA.lua]
//
// Une formation : la signature du placement (cases de départ des monstres), la case de placement et la case de la
// colonne de chaque Crâ. Défaut : les placements du registre (data/reine/placements.json) ; --formation : lues dans un
// combat enregistré (colonne : --colonne, sinon FORMATION_PLACEMENT_2 de formation.ts pour « Placement 2 »).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FORMATION_PLACEMENT_2 } from '../reine-des-voleurs/planificateur/formation'
import { PROTO } from '../reine-des-voleurs/planificateur/journal'
import { MSG } from './rejeu'
import { casesOf, colonneOf, loadRegistry, type Registry } from '../reine-des-voleurs/scenarios/placements'
import { colonneOf as colonneOfMerged, extractScenario, mergeScenarios } from './scenario'

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export interface FormationDef {
  nom: string
  monstres: { espece: number; cellule: number; nom: string }[]
  placement: Record<string, number>
  colonne: Record<string, number>
}

export function luaFormations(list: FormationDef[]): string {
  const out = ['FORMATIONS = {']
  for (const f of list) {
    out.push('  {')
    out.push(`    nom = ${q(f.nom)},`)
    out.push('    -- Monstres au début du combat (espèce, case) : la signature du placement.')
    out.push('    monstres = {')
    for (const m of f.monstres) out.push(`      { espece = ${m.espece}, cellule = ${m.cellule} },  -- ${m.nom}`)
    out.push('    },')
    out.push('    -- Case de placement de chaque Crâ (phase de placement).')
    out.push('    placement = {')
    for (const [n, c] of Object.entries(f.placement)) out.push(`      [${q(n)}] = ${c},`)
    out.push('    },')
    out.push('    -- Case de la colonne de chaque Crâ : il y revient à la fin de chaque tour.')
    out.push('    colonne = {')
    for (const [n, c] of Object.entries(f.colonne)) out.push(`      [${q(n)}] = ${c},`)
    out.push('    },')
    out.push('  },')
  }
  out.push('}')
  return out.join('\n')
}

/** Messages dont le serveur de plans a besoin (reconstitution rejeu.ts, sorts du personnage, modificateurs privés). */
export const SERVER_MESSAGES = [...new Set([...Object.values(MSG), ...PROTO.privateMods, PROTO.spellList])].sort()

const HEAD_NOTE = `-- PAS de DEVELOPER_MULTI_THREADING : essayé le 2026-10-10, il fait tourner deux fils dans la même machine Lua\n` +
  `-- (erreurs « attempt to index a function value » sur des variables locales, 3 journaux sur 4 arrêtés).\n\n`

/**
 * Le journal AnkaBot suivi de ses réglages pour un script qui joue (après les siens) : le script doit être libre quand
 * AnkaBot lance fightManagement.
 */
export function loggerForPlay(root = process.cwd(), by = 'tools/fightlog/ia.ts'): string {
  const logger = readFileSync(join(root, 'tools', 'ankabot', 'journal-combats.lua'), 'utf8')
  const tuning = `-- Réglages du journal pour un script qui joue (${by}) : script libre quand AnkaBot lance fightManagement.\n` +
    `-- Silence autour de son tour, pas de photos en combat (le serveur de plans ne s'en sert pas).\n` +
    `QUIET_AROUND_MY_TURN = true\nFIGHT_SNAPSHOTS = false\n` +
    `-- false : journal coupé (test des tours passés ; le serveur de plans, donc le mode avancé, n'a alors plus de données).\n` +
    `ENABLED = true\n` +
    `-- Listes bornées : le serveur n'en lit pas de plus de 53 éléments ; à 20 000, un message de 1 Mo (isr, relu dans\n` +
    `-- l'historique au chargement) a bloqué les scripts des mules 12 minutes (2026-10-10 à 17:47).\n` +
    `MAX_ITEMS = 200\n` +
    `-- Historique relu (messages reçus avant le chargement) : la liste des sorts du personnage seulement (variantes).\n` +
    `HISTORY_NAMES = { hkh = true }\n` +
    `-- Messages écoutés : ceux du serveur de plans seulement (${SERVER_MESSAGES.length}, au lieu des 17 588 noms possibles).\n` +
    `ONLY_NAMES = { ${SERVER_MESSAGES.map(n => `${n} = true`).join(', ')} }\n\n`
  return logger.trimEnd() + '\n\n' + tuning
}

/**
 * L'IA du serveur de plans (modele-ia.lua), formations écrites. `defaut` : formation des placements de monstres
 * inconnus (FORMATION_PAR_DEFAUT ; défaut du modèle sinon).
 */
export function iaPart(formations: FormationDef[], root = process.cwd(), defaut?: string): string {
  const model = readFileSync(join(root, 'tools', 'fightlog', 'modele-ia.lua'), 'utf8')
  const mark = '-- <<FORMATIONS>>'
  if (!model.includes(mark)) throw new Error(`repère ${mark} absent du modèle`)
  const block = luaFormations(formations) + (defaut ? `\n-- Placement par défaut du registre (data/reine/placements.json).\nFORMATION_PAR_DEFAUT = ${q(defaut)}` : '')
  return model.replace(mark, block)
}

export function buildIaScript(formations: FormationDef[], root = process.cwd(), defaut?: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const head = `-- ReineIA.lua — généré le ${stamp} par tools/fightlog/ia.ts : journal AnkaBot (journal-combats.lua) + IA de la Reine des\n` +
    `-- Voleurs (modele-ia.lua, plus bas). Ne pas éditer : régénérer.\n` + HEAD_NOTE
  return head + loggerForPlay(root) + iaPart(formations, root, defaut)
}

/** Formations de tous les placements du registre (data/reine/placements.json). */
export function formationsOfRegistry(reg: Registry): FormationDef[] {
  return reg.placements.map(p => ({
    nom: p.nom,
    monstres: p.monstres.map(m => ({ espece: m.espece, cellule: m.cellule, nom: m.nom ?? `espèce ${m.espece}` })),
    placement: casesOf(reg, p),
    colonne: colonneOf(reg, p),
  }))
}

/** Colonnes connues par nom de formation ; --colonne "Nom=Crâ:case,…" en ajoute. */
export function colonnesFromArgs(args: string[]): Map<string, Record<string, number>> {
  const colonnes = new Map<string, Record<string, number>>([['Placement 2', FORMATION_PLACEMENT_2]])
  for (const c of args) {
    const [nom, rest] = c.split('=')
    colonnes.set(nom, Object.fromEntries(rest.split(',').map(x => x.split(':')).map(([n, v]) => [n, Number(v)])))
  }
  return colonnes
}

/** Lanceur du serveur, à côté du script (copiable avec lui dans le dossier de scripts d'AnkaBot) : chemin du projet en dur. */
export function writeServerLauncher(dir: string, script: string, by: string): string {
  const cmd = join(dir, 'lancer_serveur_reine.cmd')
  writeFileSync(cmd, [
    '@echo off',
    `rem Serveur de plans de la Reine des Voleurs (et recepteur du journal AnkaBot) pour ${script}.`,
    `rem FICHIER GENERE par ${by} (chemin du projet ci-dessous).`,
    `rem A lancer AVANT de charger ${script} ; laisser la fenetre ouverte pendant les combats (Ctrl+C : arret).`,
    `cd /d "${process.cwd()}"`,
    'call npx tsx tools/reine-des-voleurs/planificateur/serveur.ts',
    'pause',
    '',
  ].join('\r\n'), 'utf8')
  return cmd
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fightlog/ia.ts')) {
  const all = (k: string) => process.argv.flatMap((a, i) => (a === k ? [process.argv[i + 1]] : []))
  const sources = all('--formation')
  // Sans --formation : les placements du registre (data/reine/placements.json), comme ReineCombat.lua (combat.ts).
  const reg = loadRegistry()
  const colonnes = colonnesFromArgs(all('--colonne'))
  const formations: FormationDef[] = sources.length
    ? sources.map(s => {
        const [nom, ...file] = s.split('=')
        const sc = extractScenario(nom, file.join('='))
        // Colonne : --colonne, sinon celle de Placement 2 (connue), sinon la case où chaque Crâ finit le plus souvent ses tours.
        const colonne = colonnes.get(nom) ?? colonneOfMerged(mergeScenarios([sc])[0])
        return { nom, monstres: sc.monstres, placement: sc.cases, colonne }
      })
    : formationsOfRegistry(reg)
  const outIdx = process.argv.indexOf('--sortie')
  const out = outIdx > 0 ? process.argv[outIdx + 1] : join(process.cwd(), 'tools', 'ankabot', 'ReineIA.lua')
  writeFileSync(out, buildIaScript(formations, process.cwd(), sources.length ? undefined : reg.defaut), 'utf8')
  console.log(`Écrit : ${writeServerLauncher(dirname(out), 'ReineIA.lua', 'tools/fightlog/ia.ts')}`)
  for (const f of formations) console.log(`${f.nom} : ${f.monstres.length} monstres, placement ${JSON.stringify(f.placement)}, colonne ${JSON.stringify(f.colonne)}`)
  console.log(`Écrit : ${out}`)
}
