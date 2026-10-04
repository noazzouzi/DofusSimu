import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro, quickEstimate } from '../src/ai/core'
import { zoneMembership, zoneEfficiency } from '../src/map/zones'
const engine = engineFor()
const { fight, me } = randomScene(89, { engine })
const view = createView(engine, fight, me, 1234)
const p = createPerception(view)
const c = generateCasts(view, fight, me, { perception: p }).find(x => x.key === '25863:357:357')!
const si = me.spells.findIndex(x => x.spellId === 25863)
const prof = p.profiles.ofFighter(me)[si]
console.log('zone', prof.zone, 'radius', prof.zoneRadius, 'lines', prof.damage.map(l => [l.effectId, l.min, l.max, l.zone.shape + l.zone.size, l.mask, l.sub, l.p]))
const inZone = zoneMembership(prof.zone!, 357, 357)
for (const f of fight.fighters) {
  if (f.team === me.team) continue
  const eff = inZone(f.cell) ? zoneEfficiency(prof.zone!, 357, f.cell, 357) : 0
  console.log(f.name, f.cell, 'inZone', inZone(f.cell), 'eff', eff.toFixed(2), 'perCast', Math.round(p.dpt.perCast(me, si, f).mean), 'hp', f.hp)
}
const k = simClone(view, fight, 7); applyMacro(engine, k, me.id, c)
for (const f of k.fighters) if (f.team !== me.team) console.log('after', f.name, f.cell, 'hp', f.hp)
console.log('quick', quickEstimate(view, fight, me, c, p))
