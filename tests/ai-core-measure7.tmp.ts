import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
const engine = engineFor()
const scenes = []
for (let seed = 1; seed <= Number(process.argv[2] ?? 10); seed++) {
  const sc = randomScene(seed, { engine })
  const view = createView(engine, sc.fight, sc.me, 1234)
  const p = createPerception(view)
  const cands = generateCasts(view, sc.fight, sc.me, { perception: p })
  const kids = []
  for (const c of cands) { const k = simClone(view, sc.fight, 7); if (applyMacro(engine, k, sc.me.id, c)) kids.push(k) }
  scenes.push({ ...sc, view, p, cands, kids })
}
for (let pass = 0; pass < 3; pass++) {
  let tm = 0, th = 0, pm = 0, ph = 0
  for (const sc of scenes) {
    sc.p.threat.geoMisses = sc.p.threat.geoHits = sc.p.potential.geoMisses = sc.p.potential.geoHits = 0
    for (const k of sc.kids) valueOf(sc.view, engine.cloneFight(k, false), sc.p, { root: sc.fight })
    tm += sc.p.threat.geoMisses; th += sc.p.threat.geoHits; pm += sc.p.potential.geoMisses; ph += sc.p.potential.geoHits
  }
  console.log('pass', pass, 'threat geo miss/hit', tm, th, 'pot', pm, ph)
}
let reuse = 0, nV = 0
for (const sc of scenes) { reuse += (sc.p.threat as any).hpReuse; nV += sc.kids.length * 3 }
console.log('threat hp reuse', reuse, 'of', nV)
let ru = 0, bu = 0
for (const sc of scenes) { ru += (sc.p.threat as any).hpReuse; bu += (sc.p.threat as any).hpBuilt }
console.log('threat rows reuse', ru, 'built', bu)
