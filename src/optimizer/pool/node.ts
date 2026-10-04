/**
 * Pool de workers Node (`node:worker_threads`, docs/design/ai.md §15.7) — WP4.
 *
 * `createNodePool(size)` lance `size` workers (défaut : min(4, cœurs disponibles)) qui chargent chacun les données une
 * fois (`loadDataStore(dataDir)`) puis exécutent les `WorkerTask` (pool.ts). En développement (sources .ts, sous tsx
 * ou vitest) l'entrée est `bootstrap.mjs` qui enregistre tsx dans le worker puis importe `worker.ts` ; une fois compilé
 * en JavaScript, `worker.js` est lancé directement.
 *
 * `preload` : modules (URL `file:` ou chemins absolus) importés par chaque worker avant la première tâche — par exemple
 * un module de test qui enregistre un scénario (`registerScenario`) : le registre est propre à chaque fil.
 */
import { availableParallelism } from 'node:os'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { FromWorker } from './protocol'
import { createPool, type Endpoint, type ManagedPool } from './pool'

export interface NodePoolOptions {
  /** Dossier des données (défaut 'data'). */
  dataDir?: string
  /** Modules importés par chaque worker avant la première tâche (URL `file:` ou chemins absolus). */
  preload?: string[]
}

/** Nombre de workers par défaut : min(4, cœurs disponibles). */
export function defaultPoolSize(): number {
  return Math.max(1, Math.min(4, availableParallelism()))
}

const toUrl = (m: string): string => (isAbsolute(m) ? pathToFileURL(m).href : m)

function spawnWorker(): Worker {
  const self = import.meta.url
  if (/\.ts$/.test(new URL(self).pathname)) {
    const entry = new URL('./worker.ts', self).href
    return new Worker(new URL('./bootstrap.mjs', self), { workerData: { entry } })
  }
  return new Worker(new URL('./worker.js', self))
}

/** Pool de `size` workers Node (voir l'en-tête). */
export function createNodePool(size = defaultPoolSize(), opts: NodePoolOptions = {}): ManagedPool {
  const spawn = (): Endpoint => {
    const w = spawnWorker()
    return {
      post: msg => w.postMessage(msg),
      onMessage: cb => void w.on('message', (m: FromWorker) => cb(m)),
      onError: cb => {
        w.on('error', err => cb(err instanceof Error ? err : new Error(String(err))))
        w.on('exit', code => {
          if (code !== 0) cb(new Error(`Worker arrêté (code ${code})`))
        })
      },
      terminate: () => w.terminate(),
    }
  }
  return createPool(size, spawn, { type: 'init', dataDir: opts.dataDir, preload: opts.preload?.map(toUrl) })
}
