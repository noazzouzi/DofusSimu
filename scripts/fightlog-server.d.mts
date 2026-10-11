// Types du récepteur du journal (fightlog-server.mjs), pour le serveur de plans en TypeScript.
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

export interface ReceiverOptions {
  port?: number
  logsDir?: string
  /** Chaque lot reçu : la ligne de lot écrite dans le fichier et les lignes analysées. */
  onBatch?: (batch: { header: any; lines: any[] }) => void
  /** Routes supplémentaires : rend vrai si la requête est traitée. */
  route?: (req: IncomingMessage, res: ServerResponse) => boolean
  banner?: string[]
  quiet?: boolean
}

export function startReceiver(opts?: ReceiverOptions): { server: Server; file: string; stats: Record<string, unknown> }
export function characterOf(url: string): string
