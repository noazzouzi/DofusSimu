import { randomScene } from './ai-core-helpers'
import { createView, createPerception, quickEstimate, generateCasts, simClone, applyMacro, valueOf } from '../src/ai/core'
import { zoneMembership } from '../src/map/zones'
const { engine, fight, me } = randomScene(9)
const view = createView(engine, fight, me, 1234)
const p = createPerception(view)
const cands = generateCasts(view, fight, me, { perception: p })
const c = cands.find(x => x.cast!.spellId === 12738)!
const si = me.spells.findIndex(s => s.spellId === 12738)
const prof = p.dpt.profiles.ofFighter(me)[si]
console.log(c, prof.zone?.shape, prof.zoneRadius, prof.damage.map(l => [l.effectId, l.family, l.min, l.sides]))
const inZ = zoneMembership(prof.zone!, c.cast!.cell, c.cast!.cell)
for (const f of fight.fighters) if (f.alive && inZ(f.id === me.id ? c.cast!.cell : f.cell)) console.log(' in zone', f.name, f.team, 'percast', p.dpt.perCast(me, si, f), 'hp', f.hp)
console.log('quick', quickEstimate(view, fight, me, c, p))
const child = simClone(view, fight, 7); applyMacro(engine, child, me.id, c)
for (const f of child.fighters) { const f0 = fight.fighters[f.id]; if (f0.hp !== f.hp) console.log('   real', f.name, f0.hp - f.hp) }
console.log(prof.stats.map(s => [s.effectId, s.stat, s.sign, s.value, s.mask, JSON.stringify(s.sides)]), prof.removals.length, prof.heals.length, prof.shields.length, prof.summonLines)
console.log(p.potential.potential(me.id), p.potential.potential(fight.fighters.find(f => f.name === 'Pandawa1')!.id))
const l = engine.data.spellLevel(14087, { grade: 1 })!; console.log(JSON.stringify(l.effects.map(e => [e.effectId, e.diceNum, e.diceSide, e.value, e.duration, e.targetMask, e.triggers, e.zone.shape + e.zone.size])))
