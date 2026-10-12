// Génère tools/ankabot/ReineCombat.lua, le script de combat de la Reine des Voleurs, sur le modèle du rejeu de Fraktale
// (FraktaleRejeu6 / IA_Rejeu6) :
//   - SCÉNARIOS DES PLACEMENTS (modele-rejeu.lua) : pour chaque placement du registre (data/reine/placements.json), le
//     scénario optimal compilé de sa bibliothèque (data/reine/scenarios, combats appris : tools/reine-des-voleurs/
//     scenarios) ; chaque tour d'une situation connue est joué tout de suite, sans serveur ;
//   - situation inconnue (ou écart pendant un tour) : l'IA du serveur de plans (modele-ia.lua,
//     tools/reine-des-voleurs/planificateur/serveur.ts) joue ce tour, et le journal l'enregistre pour la suite.
// Le journal AnkaBot est inclus, réglé pour un script qui joue (ia.ts, loggerForPlay) : le serveur reconstitue le combat
// depuis son début, et les combats joués s'apprennent ensuite (npm run reine:scenarios -- apprendre).
//
//   npx tsx tools/fightlog/combat.ts [--depuis 2026-10-12] [--morts-max 0.5] [--sortie tools/ankabot/ReineCombat.lua]
//
// --depuis : combats appris avant cette date ignorés (sorts ou stuff changés depuis) ; --morts-max : taux de morts de Crâs
// dans la manche qui suit à partir duquel un tour appris est écarté (compilation.ts).
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadLibrary } from '../reine-des-voleurs/scenarios/bibliotheque'
import { compilePlacement, LOIN, type CompiledPlacement, type CompileOptions } from '../reine-des-voleurs/scenarios/compilation'
import { loadRegistry, type Registry } from '../reine-des-voleurs/scenarios/placements'
import { formationsOfRegistry, iaPart, loggerForPlay, writeServerLauncher, type FormationDef } from './ia'
import { rejeuPart, type Merged, type Step } from './scenario'

const BY = 'tools/fightlog/combat.ts'

export function buildCombatScript(scenarios: Merged[], formations: FormationDef[], root = process.cwd(), opts: { defaut?: string; loin?: Record<number, number> } = {}): string {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const head = `-- ReineCombat.lua — généré le ${stamp} par ${BY}. Ne pas éditer : régénérer.\n` +
    `-- Script de combat de la Reine des Voleurs, à charger sur le chef (AnkaBot le charge sur les mules) :\n` +
    `--   1. journal AnkaBot (journal-combats.lua), réglé pour un script qui joue ;\n` +
    `--   2. IA du serveur de plans (modele-ia.lua) : le MODE AVANCÉ, pour les situations que le scénario ne connaît pas ;\n` +
    `--   3. scénarios des placements (modele-rejeu.lua) : placement, puis chaque tour d'une situation connue joué tout de\n` +
    `--      suite, sans serveur ; situation inconnue : l'IA du serveur joue ce tour.\n` +
    `-- Avant de le charger : lancer le serveur (lancer_serveur_reine.cmd, à côté) pour le journal et le mode avancé.\n` +
    `-- PAS de DEVELOPER_MULTI_THREADING : essayé le 2026-10-10, il fait tourner deux fils dans la même machine Lua.\n\n`
  return head + loggerForPlay(root, BY) +
    '-- ═════════════════════════════ MODE AVANCÉ : IA DU SERVEUR DE PLANS ═════════════════════════════\n' +
    iaPart(formations, root, opts.defaut).trimEnd() + '\n\n' +
    '-- ═════════════════════════════ SCÉNARIOS DES PLACEMENTS ═════════════════════════════\n' +
    '-- Dans une fonction : ses variables locales restent les siennes (limite de 200 par fonction pour le fichier). Le « ; »\n' +
    '-- de tête : sans lui, Lua lirait « end)() (function() … » comme un seul appel.\n' +
    ';(function()\n' + rejeuPart(scenarios, root, BY, { loin: opts.loin }).trimEnd() + '\nend)()\n'
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

/** Scénarios compilés de tous les placements du registre, et leurs formations. */
export function compileAll(root = process.cwd(), opts: CompileOptions = {}): { reg: Registry; scenarios: CompiledPlacement[]; formations: FormationDef[] } {
  const reg = loadRegistry(root)
  const scenarios = reg.placements.map(p => compilePlacement(reg, p, loadLibrary(p.nom, root), opts))
  return { reg, scenarios, formations: formationsOfRegistry(reg) }
}

/** Résumé d'un scénario compilé (console). */
export function describeCompiled(s: CompiledPlacement): string {
  const st = s.stats
  const ec = Object.entries(st.ecartees).map(([k, v]) => `${v} ${k}`).join(', ')
  return `${s.nom} : ${st.combats} combat(s) appris (${st.victoires} gagné(s)), ${st.branches} situation(s) dans le scénario` +
    (ec ? ` ; tours écartés : ${ec}` : '')
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fightlog/combat.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const { reg, scenarios, formations } = compileAll(process.cwd(), { depuis: arg('--depuis'), mortsMax: arg('--morts-max') ? Number(arg('--morts-max')) : undefined })
  const retouches = retoucher(scenarios)
  const out = arg('--sortie') ?? join(process.cwd(), 'tools', 'ankabot', 'ReineCombat.lua')
  writeFileSync(out, buildCombatScript(scenarios, formations, process.cwd(), { defaut: reg.defaut, loin: LOIN }), 'utf8')
  for (const s of scenarios) console.log(describeCompiled(s))
  for (const l of retouches) console.log(l)
  for (const f of formations) console.log(`${f.nom} : placement ${JSON.stringify(f.placement)}, colonne ${JSON.stringify(f.colonne)}`)
  console.log(`Placement des monstres inconnu : formation « ${reg.defaut ?? '(aucune)'} », tours joués par le serveur, combat à apprendre ensuite.`)
  console.log(`Écrit : ${writeServerLauncher(dirname(out), 'ReineCombat.lua', BY)}`)
  console.log(`Écrit : ${out}`)
}
