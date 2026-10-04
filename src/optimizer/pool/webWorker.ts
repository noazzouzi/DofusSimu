/**
 * Entrée d'un Web Worker de l'optimiseur (navigateur, docs/design/ai.md §15.7) — WP4 : construit un `MemoryDataStore`
 * à partir du lot reçu dans `init`, puis exécute les tâches (protocol.ts). Lancé par `createBrowserPool` (web.ts).
 */
import { MemoryDataStore } from '../../data/memory'
import { createWorkerHandler, type FromWorker, type ToWorker } from './protocol'

interface WorkerScope {
  postMessage(msg: unknown): void
  addEventListener(type: 'message', cb: (e: MessageEvent<ToWorker>) => void): void
  close(): void
}

const scope = globalThis as unknown as WorkerScope
const handler = createWorkerHandler(
  (msg: FromWorker) => scope.postMessage(msg),
  init => {
    if (!init.bundle) throw new Error('Web Worker : lot de données (bundle) manquant dans « init »')
    return new MemoryDataStore(init.bundle)
  },
  () => scope.close(),
)
scope.addEventListener('message', e => void handler(e.data))
