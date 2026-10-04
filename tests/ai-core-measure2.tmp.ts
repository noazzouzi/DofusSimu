import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
const N = Number(process.argv[2] ?? 40)
const MODE = process.argv[3] ?? 'V'
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
let bestPass = Infinity
for (let pass = 0; pass < Number(process.env.PASSES ?? 7); pass++) {
  const t0 = performance.now(); let n = 0
  for (const sc of scenes) {
    if (MODE === 'V') {
      // nouveaux clones (états inédits, mêmes positions)
      for (const k of sc.kids) { const c = engine.cloneFight(k, false); valueOf(sc.view, c, sc.p, { root: sc.fight }); n++ }
    } else if (MODE === 'node') {
      for (const c of sc.cands) { const k = simClone(sc.view, sc.fight, 7); applyMacro(engine, k, sc.me.id, c); n++ }
    } else {
      generateCasts(sc.view, sc.fight, sc.me, { perception: sc.p }); n++
    }
  }
  bestPass = Math.min(bestPass, (performance.now() - t0) / n * 1000)
}
console.log(MODE, bestPass.toFixed(1), 'µs (min des passes)')
