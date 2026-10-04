import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
const engine = engineFor()
let p_anchors = 0
let H = 0, M = 0, n = 0, changedTotal = 0
for (let seed = 1; seed <= 20; seed++) {
  const sc = randomScene(seed, { engine })
  const view = createView(engine, sc.fight, sc.me, 1234)
  const p = createPerception(view)
  const cands = generateCasts(view, sc.fight, sc.me, { perception: p })
  const kids = []
  for (const c of cands) { const k = simClone(view, sc.fight, 7); if (applyMacro(engine, k, sc.me.id, c)) kids.push(k) }
  p.frame.hits = 0; p.frame.misses = 0
  for (const k of kids) {
    valueOf(view, k, p, { root: sc.fight }); n++
    changedTotal += (p.frame as any).diff.reduce((a: number, b: number) => a + b, 0)
  }
  H += p.frame.hits; M += p.frame.misses; p_anchors += p.frame.anchors
}
console.log('anchors', (p_anchors), 'frame hits', H, 'misses', M, 'per V', (H / n).toFixed(1), (M / n).toFixed(1), 'changed fighters/V', (changedTotal / n).toFixed(2))
