// Génère tools/ankabot/BaleineCombat.lua : le journal AnkaBot (tools/ankabot/journal-combats.lua) suivi de l'IA du Ventre
// de la Baleine (modèle tools/ventre-de-la-baleine/modele-baleine.lua), qui demande placement et tours au serveur de
// plans (tools/ventre-de-la-baleine/serveur.ts) et les exécute ; et son lanceur, tools/ankabot/lancer_serveur_baleine.cmd.
//
//   npx tsx tools/ventre-de-la-baleine/script.ts [--sans-plan passer|ia|main] [--sortie tools/ankabot/BaleineCombat.lua]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HEAD_NOTE, loggerForPlay } from '../fightlog/ia'

const BY = 'tools/ventre-de-la-baleine/script.ts'

export function buildBaleineScript(root = process.cwd(), opts: { sansPlan?: string } = {}): string {
  let model = readFileSync(join(root, 'tools', 'ventre-de-la-baleine', 'modele-baleine.lua'), 'utf8')
  if (opts.sansPlan) {
    if (!['passer', 'ia', 'main'].includes(opts.sansPlan)) throw new Error(`--sans-plan ${opts.sansPlan} : passer, ia ou main`)
    model = model.replace(/^SANS_PLAN = "[a-z]+"/m, `SANS_PLAN = "${opts.sansPlan}"`)
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const head = `-- BaleineCombat.lua — généré le ${stamp} par ${BY} : journal AnkaBot (journal-combats.lua) + IA du Ventre de la\n` +
    `-- Baleine (modele-baleine.lua, plus bas). Ne pas éditer : régénérer (npm run baleine:script).\n` + HEAD_NOTE
  return head + loggerForPlay(root, BY) + model
}

/** Lanceur du serveur, à côté du script (copiable avec lui dans le dossier de scripts d'AnkaBot) : chemin du projet en dur. */
export function writeBaleineLauncher(dir: string): string {
  const cmd = join(dir, 'lancer_serveur_baleine.cmd')
  writeFileSync(cmd, [
    '@echo off',
    'rem Serveur de plans du Ventre de la Baleine (et recepteur du journal AnkaBot) pour BaleineCombat.lua.',
    `rem FICHIER GENERE par ${BY} (chemin du projet ci-dessous).`,
    'rem A lancer AVANT de charger BaleineCombat.lua ; laisser la fenetre ouverte pendant les combats (Ctrl+C : arret).',
    `cd /d "${process.cwd()}"`,
    'call npx tsx tools/ventre-de-la-baleine/serveur.ts',
    'pause',
    '',
  ].join('\r\n'), 'utf8')
  return cmd
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('ventre-de-la-baleine/script.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const out = arg('--sortie') ?? join(process.cwd(), 'tools', 'ankabot', 'BaleineCombat.lua')
  writeFileSync(out, buildBaleineScript(process.cwd(), { sansPlan: arg('--sans-plan') }), 'utf8')
  console.log(`Écrit : ${out}`)
  console.log(`Écrit : ${writeBaleineLauncher(dirname(out))}`)
}
