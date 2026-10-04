// Amorce d'un worker Node en développement (sources TypeScript) : enregistre le chargeur tsx DANS le worker (les
// options `--import tsx` de `execArgv` ne s'appliquent pas aux workers sous Node 22), puis importe l'entrée réelle
// (`workerData.entry`, URL de src/optimizer/pool/worker.ts). En production (JavaScript compilé), node.ts lance
// directement worker.js sans cette amorce.
import { workerData } from 'node:worker_threads'
import { register } from 'tsx/esm/api'

register()
await import(workerData.entry)
