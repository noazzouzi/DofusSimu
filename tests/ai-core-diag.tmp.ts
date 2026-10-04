import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
const engine = engineFor()
const seeds = (process.argv[2] ?? '1,10,85,89,94').split(',').map(Number)
for (const seed of seeds) {
  const { fight, me } = randomScene(seed, { engine })
  const view = createView(engine, fight, me, 1234)
  const p = createPerception(view)
  const v0 = valueOf(view, fight, p)
  const cands = generateCasts(view, fight, me, { perception: p })
  const rows = cands.map(c => {
    const k = simClone(view, fight, 7)
    const ok = applyMacro(engine, k, me.id, c)
    const v = ok ? valueOf(view, k, p, { root: fight }) : null
    const d: Record<string, number> = {}
    if (v) for (const key of Object.keys(v)) d[key] = Math.round((v as any)[key] - (v0 as any)[key])
    return { c, v: v ? v.total - v0.total : -Infinity, d }
  })
  rows.sort((a, b) => b.v - a.v)
  const byPrior = [...rows].sort((a, b) => b.c.prior - a.c.prior)
  console.log(`seed ${seed} ${me.name}`)
  const show = (r: typeof rows[0]) => `  ${r.c.key.padEnd(16)} ${(engine.data.spell(r.c.cast!.spellId)?.name ?? '').padEnd(22)} ${r.c.cat.padEnd(9)} v=${Math.round(r.v)} prior=${Math.round(r.c.prior)} rankP=${byPrior.indexOf(r)} ${JSON.stringify(Object.fromEntries(Object.entries(r.d).filter(([k, x]) => x !== 0 && k !== 'total')))}`
  for (const r of rows.slice(0, 4)) console.log(show(r))
  console.log('  -- top prior')
  for (const r of byPrior.slice(0, 3)) console.log(show(r))
}
