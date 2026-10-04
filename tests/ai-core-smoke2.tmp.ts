import { randomScene } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
for (const seed of [1, 2, 5]) {
  const { engine, fight, me } = randomScene(seed)
  const view = createView(engine, fight, me, 1234)
  const p = createPerception(view)
  const v0 = valueOf(view, fight, p)
  const cands = generateCasts(view, fight, me, { perception: p })
  const res: { key: string; d: number; prior: number; br: Record<string, number> }[] = []
  for (const c of cands) {
    const child = simClone(view, fight, 7)
    if (!applyMacro(engine, child, me.id, c)) continue
    const v = valueOf(view, child, p, { root: fight })
    const br: Record<string, number> = {}
    for (const k of Object.keys(v)) br[k] = Math.round((v as any)[k] - (v0 as any)[k])
    res.push({ key: c.key + ' ' + engine.data.spell(c.cast!.spellId)?.name, d: v.total - v0.total, prior: c.prior, br })
  }
  res.sort((a, b) => b.d - a.d)
  console.log('seed', seed, me.name)
  for (const r of res.slice(0, 5)) console.log(' ', r.key, Math.round(r.d), 'prior', Math.round(r.prior), JSON.stringify(r.br))
  const byPrior = [...res].sort((a, b) => b.prior - a.prior)
  console.log(' rank of best in prior order:', byPrior.findIndex(r => r.key === res[0].key))
}
