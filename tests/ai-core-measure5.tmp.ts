import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
import { stateSig } from '../src/ai/core/hash'
import { geoFrame } from '../src/ai/core/threat'
const N = 40
const engine = engineFor()
const scenes = []
for (let seed = 1; seed <= N; seed++) {
  const sc = randomScene(seed, { engine })
  const view = createView(engine, sc.fight, sc.me, 1234)
  const p = createPerception(view)
  const cands = generateCasts(view, sc.fight, sc.me, { perception: p })
  const kids = []
  for (const c of cands) { const k = simClone(view, sc.fight, 7); if (applyMacro(engine, k, sc.me.id, c)) kids.push(k) }
  for (const k of kids) valueOf(view, k, p, { root: sc.fight })
  scenes.push({ ...sc, view, p, cands, kids })
}
for (let rep = 0; rep < 3; rep++) {
  const clones = scenes.map(sc => sc.kids.map(k => engine.cloneFight(k, false)))
  let tSig = 0, tGeo = 0, tPot = 0, tThr = 0, tRest = 0, n = 0
  scenes.forEach((sc, i) => {
    for (const c of clones[i]) {
      let t = performance.now(); const sig = stateSig(c); tSig += performance.now() - t
      t = performance.now(); geoFrame(engine, c, sc.view.team, sig); tGeo += performance.now() - t
      t = performance.now(); sc.p.potential.sync(c); tPot += performance.now() - t
      t = performance.now(); sc.p.threat.sync(c); tThr += performance.now() - t
      t = performance.now(); valueOf(sc.view, c, sc.p, { root: sc.fight }); tRest += performance.now() - t
      n++
    }
  })
  const f = (x: number) => (x / n * 1000).toFixed(1)
  console.log(`sig ${f(tSig)} geoFrame ${f(tGeo)} pot ${f(tPot)} thr ${f(tThr)} valueRest ${f(tRest)} µs`)
}
