// Serveur de plans du Sacrieur de la Tanière du Meulou : le récepteur du journal AnkaBot et les routes POST /plan et
// /placement, appelées par tools/ankabot/MeulouCombat.lua (et le journal de MeulouMain.lua). Même fil de calcul que le
// Ventre de la Baleine et le Féca (tools/ventre-de-la-baleine/calcul.ts), qui prend le planificateur du Sacrieur
// (planificateur.ts) et le placement du Meulou (placement.ts).
//
//   npx tsx tools/meulou/serveur.ts      (ou tools/ankabot/lancer_serveur_meulou.cmd)
//
// Port 8767 (PORT_MEULOU, meulou.ts) : ni celui de la Reine et de la Baleine (8765), ni celui du Féca (8766), les
// serveurs peuvent tourner ensemble. Variables : FIGHTLOG_PORT (défaut 8767), FIGHTLOG_DIR, MEULOU_FILS (fils de
// calcul, défaut 4). Un planificateur modifié n'est pris qu'au redémarrage du serveur.
import { startPlanServer } from '../reine-des-voleurs/planificateur/serveur'
import { PORT_MEULOU, SACRIEUR } from './meulou'

export function startMeulouServer(opts: { port?: number; logsDir?: string; quiet?: boolean } = {}) {
  const threads = Math.max(1, Number(process.env.MEULOU_FILS ?? 4) || 1)
  return startPlanServer({
    ...opts,
    port: opts.port ?? Number(process.env.FIGHTLOG_PORT ?? PORT_MEULOU),
    worker: new URL('../ventre-de-la-baleine/calcul.ts', import.meta.url),
    threads,
    // (le Sacrieur seul joue ; les autres personnages du groupe sont des mules, quelles qu'elles soient)
    workerData: { joueurs: [SACRIEUR], tueuses: [], donjon: 'meulou' },
    banner: [
      'Serveur de plans du Sacrieur, Tanière du Meulou : POST /plan et /placement (tools/ankabot/MeulouCombat.lua).',
      `Calcul sur ${threads} fil(s) (MEULOU_FILS). Laisser cette fenêtre ouverte pendant les combats. Ctrl+C pour arrêter.`,
    ],
  })
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('meulou/serveur.ts')) startMeulouServer()
