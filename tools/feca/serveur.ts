// Serveur de plans du Féca contre les Krobes : le récepteur du journal AnkaBot et les routes POST /plan et /placement,
// appelées par tools/ankabot/FecaCombat.lua. Même fil de calcul que le Ventre de la Baleine
// (tools/ventre-de-la-baleine/calcul.ts), qui prend le planificateur du Féca (planificateur.ts) pour un Féca.
//
//   npx tsx tools/feca/serveur.ts      (ou tools/ankabot/lancer_serveur_feca.cmd)
//
// Port 8766 (PORT_FECA, feca.ts), pas celui de la Reine et de la Baleine (8765) : les deux serveurs peuvent tourner
// ensemble. Variables : FIGHTLOG_PORT (défaut 8766), FIGHTLOG_DIR, FECA_FILS (fils de calcul, défaut 4).
import { startPlanServer } from '../reine-des-voleurs/planificateur/serveur'
import { JOUEURS, PORT_FECA, TUEUSES } from './feca'

export function startFecaServer(opts: { port?: number; logsDir?: string; quiet?: boolean } = {}) {
  const threads = Math.max(1, Number(process.env.FECA_FILS ?? 4) || 1)
  return startPlanServer({
    ...opts,
    port: opts.port ?? Number(process.env.FIGHTLOG_PORT ?? PORT_FECA),
    worker: new URL('../ventre-de-la-baleine/calcul.ts', import.meta.url),
    threads,
    // (personnages joués : les autres sont des mules ; journaux complets, chacun pris seul, le plus récent)
    workerData: { joueurs: JOUEURS, tueuses: TUEUSES },
    banner: [
      'Serveur de plans du Féca contre les Krobes : POST /plan et /placement (tools/ankabot/FecaCombat.lua).',
      `Calcul sur ${threads} fil(s) (FECA_FILS). Laisser cette fenêtre ouverte pendant les combats. Ctrl+C pour arrêter.`,
    ],
  })
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('feca/serveur.ts')) startFecaServer()
