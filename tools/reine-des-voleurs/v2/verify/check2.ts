import { run, ORDERS, WALK, type Variant, type Timing, type Plan } from './sim.ts'
import { FA, FC, FB } from './plans.ts'
import { neighborsOf } from '../../../../src/map/geometry.ts'
const ok = (r: ReturnType<typeof run>) => r.deaths.length === 0 && r.pathFail.length === 0
const fd = (plan: Plan, v: Variant, t: Timing, cells: number[]) => {
  const order = cells.map((c) => plan.start.indexOf(c))
  const r = run({ plan, variant: v, timing: t, chain: 'imm', targetOrder: 'nearcw', order })
  const d = r.deaths[0]
  return d ? `1re mort J${order.indexOf(d.slot) + 1}@${plan.home[d.slot]}? (case réelle: voir trace) manche ${d.round} par ${d.by} ; chemins KO: ${r.pathFail.join(';')}` : 'aucune mort'
}
console.log('F-A A/même 365→378→437→451 :', fd(FA, 'A', 'MT', [365, 378, 437, 451]))
for (const v of ['C', 'D', 'E'] as Variant[]) for (const t of ['TS', 'MT'] as Timing[]) console.log(`F-B ${v}/${t} 340→367→365→437 :`, fd(FB, v, t, [340, 367, 365, 437]))
// décalage avec la sémantique du chercheur
for (const [plan, v, t] of [[FA, 'A', 'TS'], [FA, 'C', 'TS'], [FC, 'A', 'TS'], [FC, 'C', 'TS'], [FB, 'A', 'TS']] as [Plan, Variant, Timing][]) {
  const base = ORDERS.filter((ord) => ok(run({ plan, variant: v, timing: t, chain: 'imm', targetOrder: 'nearcw', order: ord })))
  for (const pick of ['first8', 'all24']) {
    const os = pick === 'first8' ? base.slice(0, 8) : base
    let tot = 0, bad = 0
    for (const ord of os) for (let slot = 0; slot < 4; slot++) for (let rd = 3; rd <= 5; rd++) for (const bs of [0, 1, 2, 3]) {
      const useAlt = plan.useAlt ? plan.useAlt(v, t) : false
      const played = ord.indexOf(slot) < ord.indexOf(bs)
      const eff = played ? rd : rd - 1
      const cur = useAlt && eff >= 2 && eff % 2 === 0 ? plan.alt![slot] : plan.home[slot]
      for (const n of neighborsOf(cur)) {
        if (!WALK[n]) continue
        const r = run({ plan, variant: v, timing: t, chain: 'imm', targetOrder: 'nearcw', order: ord, displace: { slot, round: rd, beforeSlot: bs, to: n }, trace: true })
        if (!r.log.some((l) => l.includes('décalage'))) continue
        tot++; if (!ok(r)) bad++
      }
    }
    console.log(`  décalage ${plan.name} ${v} ${t} (${pick}, imm/nearcw) : ${bad}/${tot} = ${(100 * bad / tot).toFixed(0)} %`)
  }
}
