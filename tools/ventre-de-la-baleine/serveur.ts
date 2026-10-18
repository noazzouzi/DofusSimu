// Serveur de plans du Ventre de la Baleine : le récepteur du journal AnkaBot (même port, mêmes fichiers data/fightlogs)
// et les routes POST /plan (tour d'un Crâ) et POST /placement (sa case de placement), appelées par
// tools/ankabot/BaleineCombat.lua. Même serveur que celui de la Reine (tools/reine-des-voleurs/planificateur/serveur.ts),
// avec le fil de calcul de la Baleine (calcul.ts).
//
//   npx tsx tools/ventre-de-la-baleine/serveur.ts      (ou tools/ankabot/lancer_serveur_baleine.cmd)
//
// Variables : FIGHTLOG_PORT, FIGHTLOG_DIR, BALEINE_FILS (fils de calcul, défaut 4), BALEINE_ATTENTE_MS, BALEINE_CHEF.
import { startPlanServer } from '../reine-des-voleurs/planificateur/serveur'

export function startBaleineServer(opts: { port?: number; logsDir?: string; quiet?: boolean } = {}) {
  const threads = Math.max(1, Number(process.env.BALEINE_FILS ?? 4) || 1)
  return startPlanServer({
    ...opts,
    worker: new URL('./calcul.ts', import.meta.url),
    threads,
    banner: [
      'Serveur de plans du Ventre de la Baleine : POST /plan et /placement (tools/ankabot/BaleineCombat.lua, à charger sur le chef).',
      `Calcul sur ${threads} fil(s) (BALEINE_FILS). Laisser cette fenêtre ouverte pendant les combats. Ctrl+C pour arrêter.`,
    ],
  })
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('ventre-de-la-baleine/serveur.ts')) startBaleineServer()
