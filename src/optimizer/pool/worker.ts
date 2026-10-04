/**
 * Entrée d'un worker Node (`node:worker_threads`) de l'optimiseur (docs/design/ai.md §15.7) — WP4.
 *
 * Lancé par `createNodePool` (node.ts), directement (JavaScript compilé) ou via `bootstrap.mjs` (sources TypeScript,
 * chargeur tsx). Charge les données une fois (`loadDataStore`, après les modules `preload` du message `init`), puis
 * exécute les tâches une à une (protocol.ts).
 */
import { parentPort } from 'node:worker_threads'
import { loadDataStore } from '../../data/node'
import { createWorkerHandler, type FromWorker, type ToWorker } from './protocol'

const port = parentPort
if (!port) throw new Error('src/optimizer/pool/worker.ts doit être lancé dans un worker_thread')

const handler = createWorkerHandler(
  (msg: FromWorker) => port.postMessage(msg),
  async init => {
    for (const m of init.preload ?? []) await import(m)
    return loadDataStore(init.dataDir ?? 'data')
  },
  () => port.close(),
)
port.on('message', (msg: ToWorker) => void handler(msg))
