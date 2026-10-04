import { randomScene, data } from './ai-core-helpers'
import { createView, createPerception, valueOf, generateCasts, simClone, applyMacro, computeReach, stateHash, canKillNow } from '../src/ai/core'
const t0 = performance.now()
for (let seed = 1; seed <= 5; seed++) {
  const { engine, fight, me } = randomScene(seed)
  const view = createView(engine, fight, me, 1234)
  const p = createPerception(view)
  const v = valueOf(view, fight, p)
  const cands = generateCasts(view, fight, me, { perception: p })
  console.log('seed', seed, me.name, 'mp', me.mp, 'ap', me.ap, 'V', Math.round(v.total), JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(x)]))))
  console.log(' cands', cands.length, cands.slice(0, 6).map(c => `${c.key}/${c.cat}/${Math.round(c.prior)}`).join(' '))
  for (const a of p.threat.allies) console.log('  ally', a.name, 'inc', Math.round(p.threat.incoming(a.id)), 'risk', p.threat.deathRisk(a.id).toFixed(2), 'pot', Math.round(p.potential.potential(a.id)))
  for (const row of p.threat.enemies) console.log('  enemy', row.e.name, row.active, 'threat', Math.round(row.threat), 'target', row.target >= 0 ? p.threat.allies[row.target].name : '-')
  let best = -Infinity, bestKey = ''
  for (const c of cands) {
    const child = simClone(view, fight, 7)
    if (!applyMacro(engine, child, me.id, c)) { console.log('  FAIL', c.key); continue }
    const vc = valueOf(view, child, p, { root: fight }).total - valueOf(view, fight, p).total
    if (vc > best) { best = vc; bestKey = c.key }
  }
  console.log('  best', bestKey, Math.round(best))
  const enemies = fight.fighters.filter(f => f.team !== me.team && f.alive)
  console.log('  kill', enemies.map(e => canKillNow(view, me, e, p).p.toFixed(2)).join(','))
}
console.log('ms', performance.now() - t0)
