import { randomScene, engineFor } from './ai-core-helpers'
import { createView, castCellsFor, levelFor, LosOracle, computeReach, castGeometryOk, castGeom } from '../src/ai/core'
import { canCast } from '../src/engine/cast'
import { distance } from '../src/map/geometry'
const engine = engineFor()
const { fight, me } = randomScene(27, { engine })
const view = createView(engine, fight, me, 7)
const ks = me.spells.find(s => s.spellId === 12750)!
const lvl = levelFor(me, ks)
const reach = computeReach(view, fight, me)
const los = new LosOracle(fight, 0, me.id)
console.log('walkable 361', fight.map.cells[361]?.walkable, 'dist 485-361', distance(485, 361), 'reach 432', reach.mpLeft[432], reach.apLeft[432])
console.log('castCellsFor', castCellsFor(fight, me, ks, lvl, 361, reach, los, 50, []))
console.log('geomOk from 432', castGeometryOk(fight, me, ks, lvl, castGeom(me, lvl), 432, 361, los), 'canCast fromCell', canCast(engine, fight, me, ks, 361, { fromCell: 432 }))
import { compileZone, zoneMembership } from '../src/map/zones'
import { createSpellProfileIndex } from '../src/ai/core'
const prof = createSpellProfileIndex(engine).ofFighter(me)[me.spells.indexOf(ks)]
const z = compileZone(prof.zone!)
console.log('zone', z.shape, 'orientation', z.orientation, 'radius', z.radius)
for (const from of [485, 432]) console.log('from', from, 'contains 360', zoneMembership(prof.zone!, 361, from)(360))
import { generateCasts, createPerception } from '../src/ai/core'
const pp = createPerception(view)
console.log('6', generateCasts(view, fight, me, { perception: pp }).filter(c => c.cast!.spellId === 12750).map(c => `${c.key}/${Math.round(c.prior)}`).join(' '))
console.log('20', generateCasts(view, fight, me, { perception: pp, maxZoneCenters: 20 }).filter(c => c.cast!.spellId === 12750).map(c => `${c.key}/${Math.round(c.prior)}`).join(' '))
import { inverseRange } from '../src/ai/core'
const around = inverseRange({ min: 0, max: 1, line: false, diag: false }, 360)
console.log('around 360', Array.from(around).join(','), 'walk', Array.from(around).map(c => fight.map.cells[c]?.walkable ? 1 : 0).join(''))
console.log('harpille', fight.fighters.find(f => f.name === 'Harpille')!.cell, 'visible cells', view.visible().map(f => `${f.name}@${f.cell}`).join(' '))
