import { randomScene, engineFor } from './ai-core-helpers'
import { createDptTable, phi } from '../src/ai/core'
import { damageDigest, stateSig, mobilityDigest } from '../src/ai/core/hash'
const engine = engineFor()
const { fight } = randomScene(3, { engine })
const dpt = createDptTable(engine)
const fs = fight.fighters
const a = fs[0], e = fs[4]
dpt.dpt(a, e)
let t = performance.now(); let x = 0
for (let i = 0; i < 1e6; i++) x += dpt.dpt(a, e)
console.log('dpt', ((performance.now() - t)).toFixed(3), 'ns/call(×1e-3 ms)')
t = performance.now()
for (let i = 0; i < 1e6; i++) x += dpt.bestCast(a, e).mean
console.log('bestCast', ((performance.now() - t)).toFixed(3))
t = performance.now()
for (let i = 0; i < 1e6; i++) x += damageDigest(a)
console.log('damageDigest', ((performance.now() - t)).toFixed(3))
t = performance.now()
for (let i = 0; i < 1e5; i++) x += stateSig(fight)
console.log('stateSig ×1e5', ((performance.now() - t)).toFixed(3))
t = performance.now()
for (let i = 0; i < 1e6; i++) x += phi(i * 1e-6)
console.log('phi', ((performance.now() - t)).toFixed(3))
t = performance.now()
for (let i = 0; i < 1e5; i++) { a.rev = undefined; x += damageDigest(a) }
console.log('computeDamageDigest ×1e5', ((performance.now() - t)).toFixed(3))
t = performance.now()
for (let i = 0; i < 1e5; i++) { a.rev = undefined; x += mobilityDigest(a) }
console.log('computeMobilityDigest ×1e5', ((performance.now() - t)).toFixed(3))
console.log(x > 0, Object.keys(a.cooldowns).length, a.spells.length)
