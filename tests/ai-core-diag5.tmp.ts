import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
const engine = engineFor()
const seed = Number(process.argv[2] ?? 9)
const spell = Number(process.argv[3] ?? 12744)
const { fight, me } = randomScene(seed, { engine })
const view = createView(engine, fight, me, 1234)
const p = createPerception(view)
const v0 = valueOf(view, fight, p)
const cands = generateCasts(view, fight, me, { perception: p }).filter(c => c.cast?.spellId === spell)
console.log('allyInsertedGain', Math.round(p.threat.allyInsertedGain()))
for (const c of cands) {
  const k = simClone(view, fight, 7); applyMacro(engine, k, me.id, c)
  const v = valueOf(view, k, p, { root: fight })
  const d = Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, Math.round(x - (v0 as any)[kk])]).filter(([kk, x]) => x !== 0 && kk !== 'total'))
  const summon = k.fighters[k.fighters.length - 1]
  const from = c.path ? c.path[c.path.length - 1] : me.cell
  // V « incoming » décomposé : par allié
  const incs = k.fighters.filter(f => f.team === me.team && f.alive).map(f => `${f.id}:${Math.round(p.threat.incoming(f.id))}`).join(' ')
  p.sync(fight)
  console.log(c.key.padEnd(14), 'prior', Math.round(c.prior), 'V', Math.round(v.total - v0.total), JSON.stringify(d), 'decoy', Math.round(p.threat.decoyDelta(c.cast!.cell, summon.maxHp, summon.stats.tackleBlock)), 'move', Math.round(from !== me.cell ? p.threat.cellIncomingTeamDelta(me, from) : 0), 'pot(summon)', Math.round(p.potential.potential(summon.id)), '| inc après', incs)
}
console.log('inc avant', fight.fighters.filter(f => f.team === me.team && f.alive).map(f => `${f.id}:${Math.round(p.threat.incoming(f.id))}`).join(' '))
