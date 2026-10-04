import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro, PotentialModelImpl, ThreatModelImpl, DptTableImpl } from '../src/ai/core'
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
const T: Record<string, number> = {}
const C: Record<string, number> = {}
function wrap(proto: any, name: string, label: string) {
  const orig = proto[name]
  proto[name] = function (...args: any[]) { const t = performance.now(); try { return orig.apply(this, args) } finally { T[label] = (T[label] ?? 0) + performance.now() - t; C[label] = (C[label] ?? 0) + 1 } }
}
wrap(PotentialModelImpl.prototype, 'build', 'pot.build')
wrap(PotentialModelImpl.prototype, 'hpOne', 'pot.hpOne')
wrap(PotentialModelImpl.prototype, 'geoOne', 'pot.geoOne')
wrap(PotentialModelImpl.prototype, 'enemyThreat', 'pot.enemyThreat')
wrap(ThreatModelImpl.prototype, 'build', 'thr.build')
wrap(ThreatModelImpl.prototype, 'hpRow', 'thr.hpRow')
wrap(ThreatModelImpl.prototype, 'geoRow', 'thr.geoRow')
wrap(DptTableImpl.prototype, 'dpt', 'dpt.dpt')
wrap(DptTableImpl.prototype, 'bestCast', 'dpt.bestCast')
wrap(DptTableImpl.prototype, 'turn', 'dpt.turn')
const clones = scenes.map(sc => sc.kids.map(k => engine.cloneFight(k, false)))
const t0 = performance.now(); let n = 0
scenes.forEach((sc, i) => { for (const c of clones[i]) { valueOf(sc.view, c, sc.p, { root: sc.fight }); n++ } })
const tot = performance.now() - t0
console.log('V', (tot / n * 1000).toFixed(1), 'µs (instrumented)', n)
for (const k of Object.keys(T)) console.log(k.padEnd(18), (T[k] / n * 1000).toFixed(1), 'µs/V', (C[k] / n).toFixed(1), 'calls/V')
