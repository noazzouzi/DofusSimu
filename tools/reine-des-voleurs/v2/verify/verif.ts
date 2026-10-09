import { run, ORDERS, type Variant, type Timing, type Chain, type Plan, type TargetOrder } from './sim.ts'
import { FA, FC, FB, OLD } from './plans.ts'

const VARIANTS: Variant[] = ['A', 'B', 'C', 'D', 'E', 'E2']
const TIMINGS: Timing[] = ['TS', 'MT']
const CHAINS: Chain[] = ['dfs', 'bfs', 'imm']
const TORD: TargetOrder[] = ['near', 'far', 'id', 'idrev']

function ordName(p: Plan, o: number[]) { return o.map((s) => p.start[s]).join('→') }

function table(plan: Plan, variants: Variant[], extraTargetOrders = false) {
  console.log(`\n=== ${plan.name} : départ ${plan.start.join('/')} → ${plan.home.join('/')}${plan.alt ? ` (alt ${plan.alt.join('/')})` : ''}`)
  for (const v of variants) for (const t of TIMINGS) {
    const cells: string[] = []
    const failSets: Record<string, string[]> = {}
    for (const ch of CHAINS) {
      for (const to of extraTargetOrders ? TORD : (['near'] as TargetOrder[])) {
        let ok = 0, beyond = 0, pf = 0, fb = 0
        const okOrders: string[] = []
        for (const ord of ORDERS) {
          const r = run({ plan, variant: v, timing: t, chain: ch, order: ord, targetOrder: to })
          beyond += r.beyond; fb += r.fallback
          if (r.pathFail.length) pf++
          if (r.deaths.length === 0 && r.pathFail.length === 0) { ok++; okOrders.push(ordName(plan, ord)) }
        }
        cells.push(`${ch}${extraTargetOrders ? '/' + to : ''}=${ok}/24${beyond ? ` au-delà=${beyond}` : ''}${pf ? ` cheminKO=${pf}` : ''}`)
        if (ok > 0 && ok < 24) failSets[`${ch}/${to}`] = okOrders
      }
    }
    console.log(`  ${v} ${t}: ${cells.join('  ')}`)
    for (const [k, os] of Object.entries(failSets)) if (k.startsWith('dfs/near') || k.startsWith('bfs/near')) console.log(`     ordres OK (${k}): ${os.join(' | ')}`)
  }
}

// Contrôle : ancienne formation sous l'ancienne règle NE (README : 24/24 TS ; 12/24 MT) et sous les nouvelles (0/24)
table(OLD, ['NEold', 'A', 'C'])
table(FA, VARIANTS, true)
table(FC, VARIANTS, true)
table(FB, VARIANTS, true)
