import { run, type Variant, type Timing, type Chain } from './sim.ts'
import { FA, FC, FB } from './plans.ts'
const [pn, v, t, ch, ordS, nr] = process.argv.slice(2)
const plan = { FA, FC, FB }[pn as 'FA']
const order = ordS.split(',').map((c) => plan.start.indexOf(+c))
const r = run({ plan, variant: v as Variant, timing: t as Timing, chain: (ch ?? 'dfs') as Chain, order, trace: true, rounds: +(nr ?? 6) })
console.log(r.log.join('\n'))
console.log('morts:', JSON.stringify(r.deaths), 'chemin:', r.pathFail.join(';'), 'soins:', JSON.stringify(r.heals))
