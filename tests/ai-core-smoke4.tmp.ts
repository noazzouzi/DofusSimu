import { randomScene } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
for (const seed of [1, 5]) {
  const { engine, fight, me } = randomScene(seed)
  const view = createView(engine, fight, me, 1234)
  const p = createPerception(view)
  const v0 = valueOf(view, fight, p)
  const cands = generateCasts(view, fight, me, { perception: p })
  const res: { key: string; d: number; prior: number; br: string }[] = []
  for (const c of cands) {
    const child = simClone(view, fight, 7)
    if (!applyMacro(engine, child, me.id, c)) continue
    const v = valueOf(view, child, p, { root: fight })
    const br: Record<string, number> = {}
    for (const k of Object.keys(v)) { const d = Math.round((v as any)[k] - (v0 as any)[k]); if (d) br[k] = d }
    res.push({ key: c.key + ' ' + engine.data.spell(c.cast!.spellId)?.name + ' ' + c.cat, d: v.total - v0.total, prior: c.prior, br: JSON.stringify(br) })
  }
  res.sort((a, b) => b.prior - a.prior)
  console.log('seed', seed, me.name)
  for (const r of res.slice(0, 12)) console.log(' P', r.key, Math.round(r.d), 'prior', Math.round(r.prior), r.br)
  res.sort((a, b) => b.d - a.d)
  for (const r of res.slice(0, 4)) console.log(' V', r.key, Math.round(r.d), 'prior', Math.round(r.prior), r.br)
}
