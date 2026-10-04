/**
 * Protocole des workers de l'optimiseur (docs/design/ai.md §15.7) — WP4 : messages JSON compacts (clonage structuré),
 * identiques pour `node:worker_threads` et les Web Workers.
 *
 *   principal → worker : `init` (une fois : dossier de données en Node, lot `MemoryDataStore` dans le navigateur,
 *                        modules à précharger — ex. scénarios enregistrés par un test), puis `task`, `close`.
 *   worker → principal : `ready` (données chargées), `result` (résumés d'une tâche, dans l'ordre de ses graines),
 *                        `error` (tâche en échec ; le worker reste utilisable).
 *
 * Chaque worker charge les données UNE fois et garde ses caches (cartes, profils de sorts, données converties) entre
 * les tâches ; il crée un `Engine` par combat (≈ 3 µs). Les résultats ne dépendent que de (spec, graine) : le pool
 * peut les renvoyer dans n'importe quel ordre, l'agrégation (src/optimizer/montecarlo.ts) les range par graine.
 */
import type { DataBundle } from '../../data/memory'
import type { DataStore } from '../../data/store'
import { runTask } from '../runner'
import type { WorkerResult, WorkerTask } from '../types'

export interface InitMessage {
  type: 'init'
  /** Node : dossier des données (défaut 'data', cherché aussi depuis la racine du dépôt). */
  dataDir?: string
  /** Navigateur : lot de données (src/data/memory.ts `createBundle`). */
  bundle?: DataBundle
  /** Modules importés avant la première tâche (URL/chemins absolus) : enregistrement de scénarios, etc. */
  preload?: string[]
}

export type ToWorker = InitMessage | { type: 'task'; task: WorkerTask } | { type: 'close' }

export type FromWorker =
  | { type: 'ready'; ms: number }
  | { type: 'result'; result: WorkerResult; ms: number }
  | { type: 'error'; taskId: number; message: string; stack?: string }

/** Exécute une tâche (toutes ses graines). */
export function executeTask(data: DataStore, task: WorkerTask): WorkerResult {
  return { taskId: task.taskId, summaries: runTask(data, task) }
}

/** Horloge pour les mesures (hors simulation : n'influence aucun résultat). */
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0)

/**
 * Gestionnaire de messages côté worker, commun à Node et au navigateur. `load` construit le `DataStore` à partir du
 * message `init` (après les préchargements) ; `post` envoie une réponse ; `exit` termine le worker (`close`).
 */
export function createWorkerHandler(
  post: (msg: FromWorker) => void,
  load: (init: InitMessage) => Promise<DataStore> | DataStore,
  exit: () => void = () => {},
): (msg: ToWorker) => Promise<void> {
  let data: Promise<DataStore> | undefined
  // Les messages sont traités un à un, dans l'ordre de réception (une étape en échec n'arrête pas la chaîne).
  let chain: Promise<void> = Promise.resolve()
  const then = (step: () => Promise<void> | void): Promise<void> => (chain = chain.catch(() => {}).then(step))
  return msg => {
    if (msg.type === 'init') {
      const t0 = now()
      return then(async () => {
        data = Promise.resolve().then(() => load(msg))
        try {
          await data
          post({ type: 'ready', ms: now() - t0 })
        } catch (e) {
          const err = e as Error
          post({ type: 'error', taskId: -1, message: `Initialisation du worker : ${err?.message ?? String(e)}`, stack: err?.stack })
        }
      })
    }
    if (msg.type === 'close') return then(() => exit())
    const task = msg.task
    return then(async () => {
      try {
        if (!data) throw new Error('Worker non initialisé (message « init » manquant)')
        const store = await data
        const t0 = now()
        const result = executeTask(store, task)
        post({ type: 'result', result, ms: now() - t0 })
      } catch (e) {
        const err = e as Error
        post({ type: 'error', taskId: task.taskId, message: err?.message ?? String(e), stack: err?.stack })
      }
    })
  }
}
