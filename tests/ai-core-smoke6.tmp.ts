import { randomScene } from './ai-core-helpers'
import { createView, createPerception, simClone, applyMacro, generateCasts, nextTurnApMp } from '../src/ai/core'
const { engine, fight, me } = randomScene(1)
const view = createView(engine, fight, me, 1234)
const p = createPerception(view)
const cands = generateCasts(view, fight, me, { perception: p })
const c = cands.find(x => x.key === '13141:521:507')!
const child = simClone(view, fight, 7)
applyMacro(engine, child, me.id, c)
const v2 = createView(engine, child, child.fighters[me.id], 1234)
const p2 = createPerception(v2)
const mej = child.fighters.find(f => f.name === 'Méjaire')!
console.log('mej stats mp', mej.stats.mp, 'mp', mej.mp, 'buffs', mej.buffs.map(b => [b.effect.effectId, b.remaining, b.sourceId, JSON.stringify(b.statDelta)]), 'next', nextTurnApMp(mej, p2.threat.order))
for (const row of p2.threat.enemies) console.log(row.e.name, 'active', row.active, 'mp', row.mp, 'threat', Math.round(row.threat))
for (const row of p.threat.enemies) console.log('root', row.e.name, 'active', row.active, 'mp', row.mp, 'threat', Math.round(row.threat))
