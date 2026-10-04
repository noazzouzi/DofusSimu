/**
 * Pool de workers générique (docs/design/ai.md §15.7) — WP4 : file centrale de tâches, chaque worker libre prend la
 * suivante (« vol de travail » par tirage : un worker lent ne bloque personne), résultats rendus dans l'ordre
 * d'achèvement par `run()` (l'agrégation les range par graine : résultats indépendants du nombre de workers).
 *
 * Le transport est abstrait (`Endpoint`) : `node.ts` (node:worker_threads), `web.ts` (Web Workers) ; `createLocalPool`
 * exécute les tâches dans le fil courant (tests, CLI `--workers 0`, référence de déterminisme).
 *
 * Plusieurs `run()` peuvent être en cours simultanément (lots appariés, préchargement des graines) : ils partagent la
 * file. `cancel(taskId)` retire une tâche en attente (une tâche en cours se termine, son résultat est ignoré).
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
}

interface Entry {
  task: WorkerTask
  sink: Sink
  cancelled: boolean
}

function deliver(sink: Sink, result: WorkerResult | Error): void {
  sink.pending--
  if (result instanceof Error) {
    sink.error ??= result
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

/** Itérable asynchrone lisant un `Sink`. */
function iterate(sink: Sink): AsyncIterable<WorkerResult> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<WorkerResult>>((resolve, reject) => {
          if (sink.error) return reject(sink.error)
          if (sink.buffer.length) return resolve({ value: sink.buffer.shift()!, done: false })
          if (sink.pending <= 0) return resolve({ value: undefined, done: true })
          sink.waiter = { resolve, reject }
        }),
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
      const sink: Sink = { pending: tasks.length, buffer: [] }
      if (closed) sink.error = new Error('Pool fermé')
      else if (slots.every(s => s.dead)) sink.error = new Error('Aucun worker disponible')
      else {
        for (const task of tasks) queue.push({ task, sink, cancelled: false })
        pump()
      }
      return iterate(sink)
    },
    cancel(taskId: number): void {
      for (const e of queue) {
        if (e.task.taskId === taskId && !e.cancelled) {
          e.cancelled = true
          deliver(e.sink, Object.assign(new Error(`Tâche ${taskId} annulée`), { cancelled: true }))
        }
      }
      for (const s of slots) {
        if (s.busy && s.busy.task.taskId === taskId && !s.busy.cancelled) {
          s.busy.cancelled = true
          deliver(s.busy.sink, Object.assign(new Error(`Tâche ${taskId} annulée`), { cancelled: true }))
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

/** Pool « local » : tâches exécutées dans le fil courant, une à une (size = 1). */
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
            if (cancelled.has(task.taskId)) continue
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
