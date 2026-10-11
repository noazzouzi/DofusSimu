// Génère tools/ankabot/ReineCombat.lua, le script de combat de la Reine des Voleurs, sur le modèle du rejeu de Fraktale
// (FraktaleRejeu6 / IA_Rejeu6) :
//   - jusqu'à la mort de la Reine : rejeu du scénario du placement reconnu (combats joués à la main et enregistrés,
//     scenario.ts ; une branche par plateau connu au début du tour) — modele-rejeu.lua ;
//   - ensuite, ou au-delà du combat enregistré, ou sans scénario reconnu : MODE AVANCÉ, l'IA du serveur de plans
//     (modele-ia.lua, tools/reine-des-voleurs/planificateur/serveur.ts) joue nos tours.
// Le journal AnkaBot est inclus, réglé pour un script qui joue (ia.ts, loggerForPlay) : le serveur reconstitue le combat
// depuis son début pour le mode avancé.
//
//   npx tsx tools/fightlog/combat.ts [--source "Placement 2=data/fightlogs/2026-10-10/session-21-27-31.jsonl"]…
//                                    [--colonne "Placement 2=Java-Springboot:327,…"] [--sortie tools/ankabot/ReineCombat.lua]
//
// Chaque combat source s'arrête à la mort de la Reine (mode avancé ensuite). Plusieurs --source de même nom : branches
// du même placement (scenario.ts). Colonne de chaque Crâ en mode avancé (il y
// revient en fin de tour) : --colonne, sinon FORMATION_PLACEMENT_2 pour « Placement 2 », sinon la case où il finit le plus
// souvent ses tours enregistrés. Sans --source : Placement 2 et Placement 3 enregistrés.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { colonnesFromArgs, iaPart, loggerForPlay, writeServerLauncher, type FormationDef } from './ia'
import { colonneOf, describeScenarios, extractScenario, mergeScenarios, rejeuPart, type Merged, type Step } from './scenario'

const BY = 'tools/fightlog/combat.ts'

export function buildCombatScript(scenarios: Merged[], formations: FormationDef[], root = process.cwd()): string {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const head = `-- ReineCombat.lua — généré le ${stamp} par ${BY}. Ne pas éditer : régénérer.\n` +
    `-- Script de combat de la Reine des Voleurs, à charger sur le chef (AnkaBot le charge sur les mules) :\n` +
    `--   1. journal AnkaBot (journal-combats.lua), réglé pour un script qui joue ;\n` +
    `--   2. IA du serveur de plans (modele-ia.lua) : le MODE AVANCÉ ;\n` +
    `--   3. rejeu des scénarios (modele-rejeu.lua) : placement, puis tours enregistrés jusqu'à la mort de la Reine, mode\n` +
    `--      avancé ensuite (ou au-delà du combat enregistré, ou sans scénario reconnu).\n` +
    `-- Avant de le charger : lancer le serveur (lancer_serveur_reine.cmd, à côté) pour le journal et le mode avancé.\n` +
    `-- PAS de DEVELOPER_MULTI_THREADING : essayé le 2026-10-10, il fait tourner deux fils dans la même machine Lua.\n\n`
  return head + loggerForPlay(root, BY) +
    '-- ═════════════════════════════ MODE AVANCÉ : IA DU SERVEUR DE PLANS ═════════════════════════════\n' +
    iaPart(formations, root).trimEnd() + '\n\n' +
    '-- ═════════════════════════════ REJEU (jusqu\'à la mort de la Reine) ═════════════════════════════\n' +
    '-- Dans une fonction : ses variables locales restent les siennes (limite de 200 par fonction pour le fichier). Le « ; »\n' +
    '-- de tête : sans lui, Lua lirait « end)() (function() … » comme un seul appel.\n' +
    ';(function()\n' + rejeuPart(scenarios, root, BY).trimEnd() + '\nend)()\n'
}

/**
 * Retouches à la main des scénarios enregistrés, gardées d'une génération à l'autre (ReineCombat.lua est réécrit) : une
 * action insérée dans le n-ième tour d'un Crâ, à la position donnée (0 : en premier), dans toutes ses branches. Après un
 * déplacement inséré, les sorts qui suivent partent de la case atteinte. À revoir si la source du placement change.
 */
export interface Retouche { placement: string; perso: string; tour: number; position: number; action: Step; pourquoi: string }

// Placement 3 réenregistré (01:33, 02:05, 02:27) : Kemist y passe déjà par 337 au premier tour (retouche du 2026-10-11
// à 01:00, retirée).
export const RETOUCHES: Retouche[] = []

export function retoucher(scenarios: Merged[], retouches: Retouche[] = RETOUCHES): string[] {
  const notes: string[] = []
  for (const r of retouches) {
    const branches = scenarios.find(s => s.nom === r.placement)?.plans[r.perso]?.[r.tour - 1]
    if (!branches?.length) {
      notes.push(`retouche ignorée (tour absent) : ${r.placement}, ${r.perso}, tour ${r.tour}`)
      continue
    }
    for (const b of branches) {
      const actions = b.plan.actions
      actions.splice(r.position, 0, { ...r.action })
      if (r.action.type === 'deplacer') {
        for (let i = r.position + 1; i < actions.length && actions[i].type === 'sort'; i++) actions[i] = { ...actions[i], depuis: r.action.cellule } as Step
      }
    }
    notes.push(`retouche : ${r.placement}, ${r.perso}, tour ${r.tour}, action ${r.position + 1} = ${r.action.type === 'deplacer' ? `déplacement vers ${r.action.cellule}` : `sort ${r.action.sort} sur ${r.action.cellule}`} (${r.pourquoi})`)
  }
  return notes
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fightlog/combat.ts')) {
  const all = (k: string) => process.argv.flatMap((a, i) => (a === k ? [process.argv[i + 1]] : []))
  const sources = all('--source')
  // Placement 2 réenregistré le 2026-10-10 à 23:27 (Reine morte en manche 4) ; avant : session-21-01-52, session-08-29-54.
  // Placement 3 réenregistré le 2026-10-11 à 02:27 (Reine morte en manche 6) ; avant : session-00-05-05, session-23-33-44,
  // session-22-39-34, session-22-13-16.
  if (!sources.length) {
    sources.push('Placement 2=data/fightlogs/2026-10-10/session-21-27-31.jsonl')
    sources.push('Placement 3=data/fightlogs/2026-10-11/session-00-27-27.jsonl')
  }
  const colonnes = colonnesFromArgs(all('--colonne'))
  const scenarios = mergeScenarios(sources.map(s => {
    const [nom, ...file] = s.split('=')
    return extractScenario(nom, file.join('='), undefined, { untilQueenDeath: true })
  }))
  const formations: FormationDef[] = scenarios.map(s => ({ nom: s.nom, monstres: s.monstres, placement: s.cases, colonne: colonnes.get(s.nom) ?? colonneOf(s) }))
  const retouches = retoucher(scenarios)
  const outIdx = process.argv.indexOf('--sortie')
  const out = outIdx > 0 ? process.argv[outIdx + 1] : join(process.cwd(), 'tools', 'ankabot', 'ReineCombat.lua')
  writeFileSync(out, buildCombatScript(scenarios, formations), 'utf8')
  for (const l of describeScenarios(scenarios)) console.log(l)
  for (const l of retouches) console.log(l)
  for (const f of formations) console.log(`${f.nom} : colonne du mode avancé ${JSON.stringify(f.colonne)}${colonnes.has(f.nom) ? '' : ' (cases de fin de tour enregistrées)'}`)
  console.log(`Écrit : ${writeServerLauncher(dirname(out), 'ReineCombat.lua', BY)}`)
  console.log(`Écrit : ${out}`)
}
