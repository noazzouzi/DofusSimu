import { randomScene, engineFor } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro } from '../src/ai/core'
const engine = engineFor()
const sc = randomScene(2, { engine })
const view = createView(engine, sc.fight, sc.me, 1234)
const p = createPerception(view)
const cands = generateCasts(view, sc.fight, sc.me, { perception: p })
let prev: any = null
let k = 0
for (const c of cands.slice(0, 30)) {
  const kid = simClone(view, sc.fight, 7); if (!applyMacro(engine, kid, sc.me.id, c)) continue
  valueOf(view, kid, p, { root: sc.fight })
  const fr = p.frame as any
  const allies = p.threat.allies.map(f => `${f.id}:${Math.round(f.hp)}/${f.shield}/${f.maxHp}/${f.stats.ap}/${fr.defKeyOf(f.id)}`).join(' ')
  const ens = p.threat.enemies.map(r => `${r.e.id}:${fr.keyOf(r.e.id)}:${fr.hpOf(r.e.id)}`).join(' ')
  const pots = p.threat.allies.map(f => Math.round(p.potential.potential(f.id))).join(',')
  console.log(c.key, '|', allies, '|', ens, '| pot', pots, '| reuse', p.threat.hpReuse, 'built', p.threat.hpBuilt)
}
