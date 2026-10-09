import { TARGETS, offLine, bench } from './lib'
import { teamBench } from './teambench'
const t = TARGETS[1]
for (const plan of [[{ spell: 32438 }], [{ spell: 32466, on: 'self' as const }, { spell: 32438 }], [{ spell: 32444 }, { spell: 32438 }]]) {
  const one = bench([plan, plan], t, offLine(7), { turns: 6, warm: 0 })
  const team = teamBench(() => plan, t, false, { d: 7, rounds: 6, warm: 0 })
  console.log(plan.map(p => p.spell).join('+'), 'seul refus', JSON.stringify([...one.refused]), '| équipe refus', JSON.stringify([...team.refused]))
}
