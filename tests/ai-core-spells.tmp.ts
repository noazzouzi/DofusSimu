import { data } from './ai-core-helpers'
import { createSpellProfileIndex } from '../src/ai/core'
import { createEngine } from '../src/engine'
const engine = createEngine(data)
const idx = createSpellProfileIndex(engine)
for (const id of (process.argv[2] ?? '13141,13142,25863,12826,12781,13118').split(',').map(Number)) {
  const l = data.spellLevel(id, { playerLevel: 200 }) ?? data.spellLevel(id, {})!
  console.log(id, data.spell(id)?.name, 'ap', l.apCost, 'range', l.minRange, l.range, 'free', l.needFreeCell, 'crit', l.critChance)
  for (const e of l.effects) console.log('   ', e.effectId, `dice ${e.diceNum}-${e.diceSide} v${e.value} dur${e.duration} delay${e.delay} mask "${e.targetMask}" zone ${e.zone.shape}${e.zone.size} trig "${e.triggers}" rnd${e.random} grp${e.group}${e.clientOnly ? ' client' : ''}`)
  const p = idx.of(l)
  console.log('   profile cat', p.cat, 'dmg lines', p.damage.length, 'shield', p.shield, 'heal', p.heal, 'states', JSON.stringify(p.states.map(s => [s.stateId, s.on, s.duration])), 'cov', p.analyticCoverage.toFixed(2), 'unsupported', p.unsupported, 'zoneR', p.zoneRadius)
  for (const st of p.states) { const sd = data.state(st.stateId); console.log('     state', st.stateId, sd?.name, JSON.stringify(Object.fromEntries(Object.entries(sd ?? {}).filter(([k, v]) => v === true)))) }
}
