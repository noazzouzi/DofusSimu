/**
 * Pool de Web Workers (navigateur, docs/design/ai.md §15.7) — WP4 : mêmes messages que les workers Node
 * (protocol.ts) ; chaque worker reçoit le lot de données (`DataBundle`, src/data/memory.ts `createBundle`) dans le
 * message `init` et construit son `MemoryDataStore`. Modes conseillés : `scripted` / `fast` / `standard` (la démo joue
 * le `standard` en arrière-plan ; le visualiseur lit le replay une fois prêt), annulation par `cancel(taskId)`.
 *
 * L'URL du worker suit la convention Vite (`new Worker(new URL('./webWorker.ts', import.meta.url), { type: 'module' })`) :
 * le module est empaqueté à la construction. Rien ici n'importe de module Node.
 */
import type { DataBundle } from '../../data/memory'
import type { FromWorker } from './protocol'
import { createPool, type Endpoint, type ManagedPool } from './pool'

/** Nombre de workers par défaut : cœurs logiques − 1 (au moins 1). */
export function defaultBrowserPoolSize(): number {
  const n = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 2 : 2
  return Math.max(1, n - 1)
}

/** Pool de `size` Web Workers sur le lot `bundle`. */
export function createBrowserPool(size = defaultBrowserPoolSize(), bundle: DataBundle): ManagedPool {
  const spawn = (): Endpoint => {
    const w = new Worker(new URL('./webWorker.ts', import.meta.url), { type: 'module' })
    return {
      post: msg => w.postMessage(msg),
      onMessage: cb => w.addEventListener('message', (e: MessageEvent<FromWorker>) => cb(e.data)),
      onError: cb => w.addEventListener('error', (e: ErrorEvent) => cb(new Error(e.message || 'Erreur de Web Worker'))),
      terminate: () => w.terminate(),
    }
  }
  return createPool(size, spawn, { type: 'init', bundle })
}
