import { run, ORDERS, type Chain, type TargetOrder } from './sim.ts'
import { FA, FC } from './plans.ts'
for (const plan of [FA, FC]) for (const [ch, to] of [['imm', 'nearcw'], ['dfs', 'near'], ['bfs', 'near']] as [Chain, TargetOrder][]) {
  const bad: string[] = []
  for (const ord of ORDERS) { const r = run({ plan, variant: 'A', timing: 'TS', chain: ch, targetOrder: to, order: ord, blueColors: false }); if (r.deaths.length) bad.push(`${ord.map((s) => plan.start[s]).join('→')} (m${r.deaths[0].round})`) }
  console.log(`${plan.name} A/TS, bleue ne colore pas, ${ch}/${to}: ${24 - bad.length}/24 ; échecs: ${bad.join(' | ')}`)
}
