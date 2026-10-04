import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro, quickEstimate } from '../src/ai/core'
const engine = engineFor()
const seed = Number(process.argv[2] ?? 5)
const key = process.argv[3]
const { fight, me } = randomScene(seed, { engine })
let view = createView(engine, fight, me, 1234)
let p = createPerception(view)
const v0 = valueOf(view, fight, p).total
let cands = generateCasts(view, fight, me, { perception: p })
const vals = cands.map(m => { const c = simClone(view, fight, 7); return applyMacro(engine, c, me.id, m) ? valueOf(view, c, p, { root: fight }).total - v0 : -Infinity })
const best = cands[vals.indexOf(Math.max(...vals))]
let s = fight
let meX = me
if (!cands.some(c => c.key === key)) {
  console.log('root best', best.key)
  s = simClone(view, fight, 7); applyMacro(engine, s, me.id, best)
  meX = s.fighters[me.id]
  view = createView(engine, s, meX, 1234)
  p = createPerception(view); p.sync(s)
  cands = generateCasts(view, s, meX, { perception: p })
}
const c = cands.find(x => x.key === key)!
const V0 = valueOf(view, s, p)
const k = simClone(view, s, 7); applyMacro(engine, k, meX.id, c)
const V1 = valueOf(view, k, p, { root: s })
console.log('cand', c.key, 'prior', Math.round(c.prior), 'V', Math.round(V1.total - V0.total), JSON.stringify(Object.fromEntries(Object.entries(V1).map(([kk, x]) => [kk, Math.round(x - (V0 as any)[kk])]).filter(([kk, x]) => x !== 0 && kk !== 'total'))))
p.sync(s)
for (const f of s.fighters) console.log('  ', f.id, f.name, f.team, 'cell', f.cell, '->', k.fighters[f.id].cell, 'hp', f.hp, '->', k.fighters[f.id].hp, 'inc', Math.round(p.threat.incoming(f.id)))
const from = c.path ? c.path[c.path.length - 1] : meX.cell
console.log('me->cell delta', Math.round(p.threat.cellIncomingTeamDelta(meX, c.cast!.cell)))
const ally = s.fighters.find(f => f.cell === c.cast!.cell)
if (ally) console.log('ally->from delta', Math.round(p.threat.cellIncomingTeamDelta(ally, from)), ally.name)
console.log('quick', quickEstimate(view, s, meX, c, p))
const T = p.threat as any
console.log('threat.s === s', T.s === s, 'allyIdx', T.allyIdx(meX.id), 'allies', T.allies.map((f: any) => f.id))
for (const cell of [416, 445, 431, 459]) console.log('cell', cell, 'own', Math.round(p.threat.cellIncoming(meX, cell)), 'delta', Math.round(p.threat.cellIncomingTeamDelta(meX, cell)))
