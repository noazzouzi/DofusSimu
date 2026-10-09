import { run, ORDERS, type Variant, type Timing, type Chain } from './sim.ts'
import { FA, FC, FB } from './plans.ts'
const ok = (r: ReturnType<typeof run>) => r.deaths.length === 0 && r.pathFail.length === 0
for (const plan of [FA, FC, FB]) for (const v of ['A', 'B', 'C', 'D', 'E'] as Variant[]) for (const t of ['TS', 'MT'] as Timing[]) {
  const out: string[] = []
  for (const lm of [99, 8, 6]) for (const ch of ['imm', 'bfs'] as Chain[]) {
    let n = 0
    for (const ord of ORDERS) if (ok(run({ plan, variant: v, timing: t, chain: ch, targetOrder: 'nearcw', order: ord, lineMax: lm }))) n++
    out.push(`ligne≤${lm}/${ch}=${n}`)
  }
  console.log(`${plan.name} ${v} ${t}: ${out.join(' ')}`)
}
