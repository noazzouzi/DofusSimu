import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
const engine = engineFor()
const seed = Number(process.argv[2] ?? 94)
const spell = Number(process.argv[3] ?? 12826)
const { fight, me } = randomScene(seed, { engine })
const view = createView(engine, fight, me, 1234)
const p = createPerception(view)
const v0 = valueOf(view, fight, p)
const cands = generateCasts(view, fight, me, { perception: p }).filter(c => c.cast?.spellId === spell)
console.log(me.name, 'cell', me.cell, 'enemies', fight.fighters.filter(f => f.team !== me.team).map(f => `${f.name}@${f.cell} thr=${Math.round(p.threat.threatOf(f))} tgt=${p.threat.predictedTarget(f)}`).join(' '))
console.log('allies', fight.fighters.filter(f => f.team === me.team).map(f => `${f.name}@${f.cell} inc=${Math.round(p.threat.incoming(f.id))}`).join(' '))
for (const c of cands) {
  const k = simClone(view, fight, 7); applyMacro(engine, k, me.id, c)
  const v = valueOf(view, k, p, { root: fight })
  const d = Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, Math.round(x - (v0 as any)[kk])]).filter(([kk, x]) => x !== 0 && kk !== 'total'))
  const summon = k.fighters[k.fighters.length - 1]
  console.log(c.key.padEnd(14), 'prior', Math.round(c.prior), 'V', Math.round(v.total - v0.total), JSON.stringify(d), 'decoy', Math.round(p.threat.decoyDelta(c.cast!.cell, summon.maxHp)), 'summonHp', summon.maxHp)
}
