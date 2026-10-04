import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
const N = Number(process.argv[2] ?? 40)
const engine = engineFor()
const scenes = []
for (let seed = 1; seed <= N; seed++) scenes.push(randomScene(seed, { engine }))
for (let pass = 0; pass < 3; pass++) {
  let tGen = 0, tNode = 0, tVal = 0, nNodes = 0, nGen = 0, tClone = 0, tVal0 = 0
  for (const { fight, me } of scenes) {
    const view = createView(engine, fight, me, 1234)
    let t = performance.now()
    const p = createPerception(view)
    valueOf(view, fight, p).total
    tVal0 += performance.now() - t
    t = performance.now()
    const cands = generateCasts(view, fight, me, { perception: p })
    tGen += performance.now() - t; nGen++
    const kids = []
    t = performance.now()
    for (const c of cands) { const k = simClone(view, fight, 7); if (applyMacro(engine, k, me.id, c)) kids.push(k) }
    tNode += performance.now() - t; nNodes += cands.length
    t = performance.now()
    for (const c of cands) engine.cloneFight(fight, false)
    tClone += performance.now() - t
    t = performance.now()
    for (const k of kids) valueOf(view, k, p, { root: fight })
    tVal += performance.now() - t
  }
  console.log(`pass ${pass}: gen ${(tGen / nGen * 1000).toFixed(0)} µs/gen (${(nNodes/nGen).toFixed(0)} cands) ; node ${(tNode / nNodes * 1000).toFixed(1)} µs ; clone ${(tClone/nNodes*1000).toFixed(1)} µs ; V ${(tVal / nNodes * 1000).toFixed(1)} µs ; perception+V0 ${(tVal0/N).toFixed(2)} ms`)
}
