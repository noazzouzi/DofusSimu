import { randomScene } from './ai-core-helpers'
import { createView, createPerception, levelFor, castGeom, nextTurnStaticOk } from '../src/ai/core'
import { isInCastRange } from '../src/map/geometry'
const { engine, fight, me } = randomScene(1)
const view = createView(engine, fight, me, 1234)
const p = createPerception(view)
const cell = 506
const ai = p.threat.allyIdx(me.id)
for (const row of p.threat.enemies) {
  const bi = row.best[ai]
  const e = row.e
  const ks = e.spells[bi]
  const lvl = levelFor(e, ks)
  const g = castGeom(e, lvl)
  const reach = row.reachLo!
  let inRange = 0
  for (let k = 0; k < reach.count; k++) { const c = reach.cells[k]; if (isInCastRange(c, cell, g.min, g.max, g.line, g.diag)) inRange++ }
  console.log(e.name, 'best', ks.spellId, engine.data.spell(ks.spellId)?.name, 'static', nextTurnStaticOk(engine, e, ks, lvl, row.ap), 'geom', JSON.stringify(g), 'reach', reach.count, 'inRange', inRange, 'los', lvl.castTestLos, 'cost', lvl.apCost)
}
import { hasLineOfSight } from '../src/map/los'
import { buildOccupancy } from '../src/ai/core'
{
  const row = p.threat.enemies[0]
  const reach = row.reachLo!
  const e = row.e
  const occ = buildOccupancy(fight, view.team)
  for (let k = 0; k < reach.count; k++) {
    const c = reach.cells[k]
    if (!isInCastRange(c, cell, 1, 3, true, false)) continue
    const los = hasLineOfSight(c, cell, x => { const mc = fight.map.cells[x]; if (!mc || !mc.los) return true; const id = occ[x]; return id >= 0 && id !== e.id && id !== me.id }, x => !fight.map.cells[x]?.los)
    console.log('cell', c, 'ap', reach.apLeft[c], 'mpLeft', reach.mpLeft[c], 'los', los, 'meCell', me.cell)
  }
}
