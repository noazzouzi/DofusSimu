import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
import type { MacroAction, CandidateCat } from '../src/ai/types'
const N = Number(process.argv[2] ?? 60)
const engine = engineFor()
const Q: Record<CandidateCat, number> = { damage: 5, control: 2, placement: 2, heal: 1, buff: 1, summon: 1, mark: 1, utility: 1 }
const group: Record<CandidateCat, string> = { damage: 'damage', control: 'control', placement: 'placement', heal: 'hb', buff: 'hb', summon: 'sm', mark: 'sm', utility: 'utility' }
const GQ: Record<string, number> = { damage: 5, control: 2, placement: 2, hb: 1, sm: 1, utility: 1 }
function select(c: MacroAction[], K: number): Set<MacroAction> {
  const sorted = [...c].sort((a, b) => b.prior - a.prior || (a.key < b.key ? -1 : 1))
  const used: Record<string, number> = {}
  const out = new Set<MacroAction>()
  for (const m of sorted) { const g = group[m.cat]; if ((used[g] ?? 0) < GQ[g] && out.size < K) { out.add(m); used[g] = (used[g] ?? 0) + 1 } }
  for (const m of sorted) { if (out.size >= K) break; out.add(m) }
  return out
}
let inQ = 0, in12 = 0, total = 0
const misses: string[] = []
for (let seed = 1; seed <= N; seed++) {
  const { fight, me } = randomScene(seed, { engine })
  const view = createView(engine, fight, me, 1234)
  const p = createPerception(view)
  const v0 = valueOf(view, fight, p).total
  const cands = generateCasts(view, fight, me, { perception: p })
  if (!cands.length) continue
  const vals = cands.map(c => { const k = simClone(view, fight, 7); return applyMacro(engine, k, me.id, c) ? valueOf(view, k, p, { root: fight }).total - v0 : -Infinity })
  const best = Math.max(...vals)
  if (best <= 0) continue
  total++
  const order = cands.map((c, i) => i).sort((a, b) => cands[b].prior - cands[a].prior || a - b)
  const rank = Math.min(...order.map((i, r) => (vals[i] >= best - 1 ? r : 1e9)))
  if (rank < 12) in12++
  const sel = select(cands, 12)
  const ok = cands.some((c, i) => vals[i] >= best - 1 && sel.has(c))
  if (ok) inQ++
  else { const bi = vals.indexOf(best); const bs = Math.max(...cands.map((c, i) => sel.has(c) ? vals[i] : -Infinity)); misses.push(`seed ${seed} ${me.name} best ${cands[bi].key} ${engine.data.spell(cands[bi].cast!.spellId)?.name} ${cands[bi].cat} v=${Math.round(best)} prior=${Math.round(cands[bi].prior)} rank=${rank} regret=${Math.round(best - bs)} (${(100 * (best - bs) / best).toFixed(1)}%)`) }
}
console.log('nodes', total, 'top12', (in12 / total).toFixed(3), 'quota12', (inQ / total).toFixed(3))
for (const m of misses) console.log(m)
