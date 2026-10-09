import { TARGETS, offLine, inLine } from './lib'
import { bestCycle } from './rotlib'
const t0 = Date.now()
for (const t of TARGETS) {
  for (const [nm, g] of [['ligne 5', inLine(5)], ['hors ligne 5', offLine(5)]] as const) {
    const r = bestCycle(t, g)
    console.log(`${t.name} ${nm} : ${Math.round(r.dpt)} (est ${Math.round(r.est)}) ${r.label} [${r.perTurn.map(Math.round).join(',')}]`)
  }
}
console.log((Date.now() - t0) / 1000, 's')
