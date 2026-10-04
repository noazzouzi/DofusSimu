import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro, quickEstimate } from '../src/ai/core'
const engine = engineFor()
const seed = Number(process.argv[2] ?? 1)
const key = process.argv[3] ?? '13141:521:507'
const { fight, me } = randomScene(seed, { engine })
const view = createView(engine, fight, me, 1234)
const p = createPerception(view)
const cands = generateCasts(view, fight, me, { perception: p })
const c = cands.find(x => x.key === key)!
console.log('me', me.name, me.cell, 'mp', me.mp, 'cand', c.key, 'path', c.path)
for (const f of fight.fighters) console.log('  ', f.id, f.name, f.team, 'cell', f.cell, 'hp', f.hp, 'threat', Math.round(p.threat.threatOf(f)), 'inc', Math.round(p.threat.incoming(f.id)), 'pot', Math.round(p.potential.potential(f.id)), 'hitsFromStart', p.threat.rowOf(f)?.hitsFromStart)
const dest = c.path ? c.path[c.path.length - 1] : me.cell
console.log('cellIncomingTeamDelta(dest)', Math.round(p.threat.cellIncomingTeamDelta(me, dest)), 'cellIncoming', Math.round(p.threat.cellIncoming(me, dest)), 'inc now', Math.round(p.threat.incoming(me.id)))
console.log('quick', Math.round(quickEstimate(view, fight, me, c, p)))
const noMove = { ...c, path: undefined }
const k = simClone(view, fight, 7); applyMacro(engine, k, me.id, c)
const v0 = valueOf(view, fight, p); const v1 = valueOf(view, k, p, { root: fight })
console.log('V delta', Math.round(v1.total - v0.total))
for (const f of k.fighters) console.log('  after', f.id, f.name, 'cell', f.cell, 'mp', f.mp, 'states', f.states.join(','), 'inc', Math.round(p.threat.incoming(f.id)))
// juste le déplacement
if (c.path) { const k2 = simClone(view, fight, 7); applyMacro(engine, k2, me.id, { cat: 'placement', prior: 0, key: 'mv', path: c.path }); console.log('move only V', Math.round(valueOf(view, k2, p, { root: fight }).total - v0.total)) }
