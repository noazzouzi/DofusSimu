import { randomScene } from './ai-core-helpers'
import { createView, createPerception } from '../src/ai/core'
const { engine, fight, me } = randomScene(1)
const view = createView(engine, fight, me, 1234)
const p = createPerception(view)
const t: any = p.threat
const row = p.threat.enemies[0]
console.log(row.e.name, 'dpt12', p.dpt.dpt(row.e, me, 12), 'dpt4', p.dpt.dpt(row.e, me, 4), 'ap', row.ap)
console.log(t.cellEvalRaw(me, 506, t.allyIdx(me.id)))
