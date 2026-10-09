// Échantillon aléatoire de formations STATIQUES (départ = case tenue, aucun déplacement) dans la région ≤ 5 PM des
// cases rouges : survie sur 30 manches, lecture C/D/E au tour suivant. Cherche un contre-exemple à « C/suivant : 0 ».
import { run, ORDERS, RED, WALK, type Variant, type Plan } from './sim.ts'
import { neighborsOf } from '../../../../src/map/geometry.ts'
const dist = new Map<number, number>()
const q: number[] = []
for (const r of RED) { dist.set(r, 0); q.push(r) }
while (q.length) { const c = q.shift()!; const d = dist.get(c)!; if (d >= 5) continue; for (const n of neighborsOf(c)) if (WALK[n] && !dist.has(n)) { dist.set(n, d + 1); q.push(n) } }
const region = [...dist.keys()].sort((a, b) => a - b)
console.log('région ≤ 5 PM :', region.length, 'cases')
let seed = 12345
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const N = +(process.argv[2] ?? 100000)
for (const v of ['C', 'D', 'E', 'A'] as Variant[]) {
  let surv1 = 0, surv24 = 0
  const ex: string[] = []
  seed = 12345
  for (let i = 0; i < N; i++) {
    const set = new Set<number>()
    while (set.size < 4) set.add(region[Math.floor(rnd() * region.length)])
    const home = [...set]
    const plan: Plan = { name: 's', start: home, home }
    const r = run({ plan, variant: v, timing: 'TS', chain: 'imm', targetOrder: 'nearcw', order: [0, 1, 2, 3], stopOnDeath: true })
    if (r.deaths.length) continue
    surv1++
    if (ORDERS.every((o) => !run({ plan, variant: v, timing: 'TS', chain: 'imm', targetOrder: 'nearcw', order: o, stopOnDeath: true }).deaths.length && !run({ plan, variant: v, timing: 'TS', chain: 'bfs', order: o, stopOnDeath: true }).deaths.length)) { surv24++; if (ex.length < 3) ex.push(home.join('/')) }
  }
  console.log(`${v}/suivant : ${N} ensembles tirés ; survivent à l'ordre 0 : ${surv1} ; aux 24 ordres (imm+bfs) : ${surv24} (${(100 * surv24 / N).toFixed(2)} %) ${ex.join(' ')}`)
}
