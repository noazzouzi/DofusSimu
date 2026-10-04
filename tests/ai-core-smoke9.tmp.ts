import { randomScene } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
const N = Number(process.argv[2] ?? 60)
let in12 = 0, in6 = 0, total = 0
const t0 = performance.now()
let nCand = 0
const misses: string[] = []
for (let seed = 1; seed <= N; seed++) {
  const { engine, fight, me } = randomScene(seed)
  const view = createView(engine, fight, me, 1234)
  const p = createPerception(view)
  const v0 = valueOf(view, fight, p).total
  const cands = generateCasts(view, fight, me, { perception: p })
  if (!cands.length) continue
  nCand += cands.length
  let best = -Infinity, bestI = -1
  const vals: number[] = []
  cands.forEach((c, i) => {
    const child = simClone(view, fight, 7)
    const ok = applyMacro(engine, child, me.id, c)
    const v = ok ? valueOf(view, child, p, { root: fight }).total - v0 : -Infinity
    vals.push(v)
    if (v > best) { best = v; bestI = i }
  })
  if (best <= 0) continue
  const order = cands.map((c, i) => i).sort((a, b) => cands[b].prior - cands[a].prior || a - b)
  // meilleur ex æquo : une valeur à 1 PVe près suffit
  const rank = Math.min(...order.map((i, r) => (vals[i] >= best - 1 ? r : 1e9)))
  total++
  if (rank < 12) in12++
  if (rank < 6) in6++
  if (rank >= 12) misses.push(`seed ${seed} ${me.name} best ${cands[bestI].key} ${engine.data.spell(cands[bestI].cast!.spellId)?.name} v=${Math.round(best)} prior=${Math.round(cands[bestI].prior)} rank=${rank} top=${cands[order[0]].key}/${Math.round(cands[order[0]].prior)}/v=${Math.round(vals[order[0]])}`)
}
console.log('nodes', total, 'top12', (in12 / total).toFixed(3), 'top6', (in6 / total).toFixed(3), 'avg cands', (nCand / N).toFixed(0), 'ms', Math.round(performance.now() - t0))
for (const m of misses.slice(0, 20)) console.log(m)
