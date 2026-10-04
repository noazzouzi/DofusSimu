/**
 * Pool de workers générique (docs/design/ai.md §15.7) — WP4 : file centrale de tâches, chaque worker libre prend la
 * suivante (« vol de travail » par tirage : un worker lent ne bloque personne), résultats rendus dans l'ordre
 * d'achèvement par `run()` (l'agrégation les range par graine : résultats indépendants du nombre de workers).
 *
 * Le transport est abstrait (`Endpoint`) : `node.ts` (node:worker_threads), `web.ts` (Web Workers) ; `createLocalPool`
 * exécute les tâches dans le fil courant (tests, CLI `--workers 0`, référence de déterminisme).
 *
 * Plusieurs `run()` peuvent être en cours simultanément (lots appariés, préchargement des graines) : ils partagent la
 * file. `cancel(taskId)` retire une tâche en attente (une tâche en cours se termine, son résultat est ignoré) ; la
 * lecture du `run()` concerné échoue alors avec une erreur `cancelled: true` (même comportement pour le pool local).
 * Un `run()` en échec (tâche en erreur) ou abandonné par son lecteur (`break` dans `for await`) retire de la file ses
 * tâches restantes : aucun calcul n'est gaspillé pour un résultat que personne ne lira.
 */
import type { DataStore } from '../../data/store'
import type { WorkerPool, WorkerResult, WorkerTask } from '../types'
import { executeTask, type FromWorker, type InitMessage, type ToWorker } from './protocol'

/** Transport vers un worker. */
export interface Endpoint {
  post(msg: ToWorker): void
  onMessage(cb: (msg: FromWorker) => void): void
  onError(cb: (err: Error) => void): void
  terminate(): Promise<unknown> | void
}

export interface PoolStats {
  /** Tâches terminées (succès ou erreur) par worker. */
  tasksByWorker: number[]
  /** Millisecondes de calcul cumulées par worker (mesure, hors résultats). */
  busyMsByWorker: number[]
  /** Durée de chargement des données par worker (ms). */
  initMs: number[]
}

/** Pool avec annulation et statistiques (au-delà du contrat gelé `WorkerPool`). */
export interface ManagedPool extends WorkerPool {
  cancel(taskId: number): void
  stats(): PoolStats
}

interface Sink {
  pending: number
  buffer: WorkerResult[]
  error?: Error
  waiter?: { resolve: (r: IteratorResult<WorkerResult>) => void; reject: (e: Error) => void }
  /** Tâches de ce `run()` (abandon : retirées de la file). */
  entries: Entry[]
  /** Lecture terminée ou abandonnée : plus aucun résultat n'est attendu. */
  closed?: boolean
}

/** Erreur d'annulation (`cancelled: true`). */
function cancelledError(taskId: number): Error {
  return Object.assign(new Error(`Tâche ${taskId} annulée`), { cancelled: true })
}

/** Retire de la file les tâches non commencées d'un `run()` (échec ou lecture abandonnée). */
function dropRemaining(sink: Sink): void {
  for (const e of sink.entries) e.cancelled = true
}

interface Entry {
  task: WorkerTask
  sink: Sink
  cancelled: boolean
}

function deliver(sink: Sink, result: WorkerResult | Error): void {
  sink.pending--
  if (result instanceof Error) {
    if (!sink.error) {
      sink.error = result
      dropRemaining(sink) // le lot a échoué : ses autres tâches ne servent plus
    }
  } else {
    sink.buffer.push(result)
  }
  const w = sink.waiter
  if (!w) return
  if (sink.error) {
    sink.waiter = undefined
    w.reject(sink.error)
  } else if (sink.buffer.length) {
    sink.waiter = undefined
    w.resolve({ value: sink.buffer.shift()!, done: false })
  } else if (sink.pending <= 0) {
    sink.waiter = undefined
    w.resolve({ value: undefined, done: true })
  }
}

/** Itérable asynchrone lisant un `Sink` ; `return()` (sortie anticipée d'un `for await`) abandonne le reste du lot. */
function iterate(sink: Sink): AsyncIterable<WorkerResult> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<WorkerResult>>((resolve, reject) => {
          if (sink.error) return reject(sink.error)
          if (sink.buffer.length) return resolve({ value: sink.buffer.shift()!, done: false })
          if (sink.pending <= 0 || sink.closed) return resolve({ value: undefined, done: true })
          sink.waiter = { resolve, reject }
        }),
      return: () => {
        sink.closed = true
        dropRemaining(sink)
        return Promise.resolve({ value: undefined, done: true })
      },
    }),
  }
}

interface Slot {
  ep: Endpoint
  ready: boolean
  dead: boolean
  busy?: Entry
  started: number
}

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : 0)

/** Pool sur `size` transports créés par `spawn` et initialisés par `init`. */
export function createPool(size: number, spawn: (index: number) => Endpoint, init: InitMessage): ManagedPool {
  const n = Math.max(1, Math.floor(size))
  const queue: Entry[] = []
  const stats: PoolStats = { tasksByWorker: new Array(n).fill(0), busyMsByWorker: new Array(n).fill(0), initMs: new Array(n).fill(0) }
  let closed = false

  const failAll = (err: Error) => {
    while (queue.length) {
      const e = queue.shift()!
      if (!e.cancelled) deliver(e.sink, err)
    }
  }

  const slots: Slot[] = []
  const pump = () => {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]
      if (!s.ready || s.dead || s.busy) continue
      let e = queue.shift()
      while (e && e.cancelled) e = queue.shift()
      if (!e) return
      s.busy = e
      s.started = clock()
      s.ep.post({ type: 'task', task: e.task })
    }
  }

  const onDead = (i: number, err: Error) => {
    const s = slots[i]
    if (s.dead) return
    s.dead = true
    if (s.busy) {
      const e = s.busy
      s.busy = undefined
      if (!e.cancelled) deliver(e.sink, err)
    }
    if (slots.every(x => x.dead)) failAll(new Error(`Tous les workers sont arrêtés : ${err.message}`))
  }

  for (let i = 0; i < n; i++) {
    const ep = spawn(i)
    const slot: Slot = { ep, ready: false, dead: false, started: 0 }
    slots.push(slot)
    ep.onMessage(msg => {
      if (msg.type === 'ready') {
        slot.ready = true
        stats.initMs[i] = msg.ms
        pump()
        return
      }
      if (msg.type === 'error' && msg.taskId === -1) {
        onDead(i, new Error(msg.message))
        return
      }
      const e = slot.busy
      if (!e || (msg.type === 'result' ? msg.result.taskId : msg.taskId) !== e.task.taskId) return
      slot.busy = undefined
      stats.tasksByWorker[i]++
      stats.busyMsByWorker[i] += clock() - slot.started
      if (!e.cancelled) {
        if (msg.type === 'result') deliver(e.sink, msg.result)
        else deliver(e.sink, Object.assign(new Error(`Tâche ${msg.taskId} : ${msg.message}`), { stack: msg.stack }))
      }
      pump()
    })
    ep.onError(err => onDead(i, err))
    ep.post(init)
  }

  return {
    size: n,
    run(tasks: WorkerTask[]): AsyncIterable<WorkerResult> {
      const sink: Sink = { pending: tasks.length, buffer: [], entries: [] }
      if (closed) sink.error = new Error('Pool fermé')
      else if (slots.every(s => s.dead)) sink.error = new Error('Aucun worker disponible')
      else {
        for (const task of tasks) {
          const e: Entry = { task, sink, cancelled: false }
          sink.entries.push(e)
          queue.push(e)
        }
        pump()
      }
      return iterate(sink)
    },
    cancel(taskId: number): void {
      for (const e of queue) {
        if (e.task.taskId === taskId && !e.cancelled) {
          e.cancelled = true
          deliver(e.sink, cancelledError(taskId))
        }
      }
      for (const s of slots) {
        if (s.busy && s.busy.task.taskId === taskId && !s.busy.cancelled) {
          s.busy.cancelled = true
          deliver(s.busy.sink, cancelledError(taskId))
        }
      }
    },
    stats: () => ({ tasksByWorker: stats.tasksByWorker.slice(), busyMsByWorker: stats.busyMsByWorker.slice(), initMs: stats.initMs.slice() }),
    async close(): Promise<void> {
      if (closed) return
      closed = true
      failAll(new Error('Pool fermé'))
      await Promise.all(
        slots.map(async s => {
          if (!s.dead) {
            try {
              s.ep.post({ type: 'close' })
            } catch {
              /* transport déjà fermé */
            }
          }
          s.dead = true
          await s.ep.terminate()
        }),
      )
    },
  }
}

/**
 * Pool « local » : tâches exécutées dans le fil courant, une à une (size = 1). Même sémantique d'annulation que le
 * pool de workers : la lecture d'un `run()` dont une tâche est annulée échoue (`cancelled: true`).
 */
export function createLocalPool(data: DataStore): ManagedPool {
  const cancelled = new Set<number>()
  let closed = false
  let done = 0
  let busy = 0
  return {
    size: 1,
    run(tasks: WorkerTask[]): AsyncIterable<WorkerResult> {
      const list = tasks.slice()
      return {
        async *[Symbol.asyncIterator]() {
          for (const task of list) {
            if (closed) throw new Error('Pool fermé')
            await Promise.resolve() // rend la main entre deux tâches (annulation, autres lots)
            if (cancelled.has(task.taskId)) throw cancelledError(task.taskId)
            const t0 = clock()
            const r = executeTask(data, task)
            busy += clock() - t0
            done++
            yield r
          }
        },
      }
    },
    cancel: taskId => void cancelled.add(taskId),
    stats: () => ({ tasksByWorker: [done], busyMsByWorker: [busy], initMs: [0] }),
    close: async () => {
      closed = true
    },
  }
}
