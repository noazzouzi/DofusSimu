import { it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { cellAt, fight, newEngine, player, turnOf, next } from './effects-buffs-helpers'
it('smoke', () => {
  const engine = newEngine()
  const iop = player({ name: 'Iop', breedId: 8, spellIds: [13118, 13120, 13141], cell: cellAt(5, 0), stats: { initiative: 1000 } })
  const ally = player({ name: 'Allié', breedId: 9, spellIds: [], cell: cellAt(7, 0), stats: { initiative: 500 } })
  const foe = player({ name: 'Ennemi', breedId: 3, spellIds: [], team: 1, cell: cellAt(6, 0), stats: { initiative: 10 } })
  const fs = fight(engine, [iop, ally, foe])
  turnOf(engine, fs, iop)
  console.log(fs.timeline, engine.current(fs)?.name)
  console.log(castSpell(engine, fs, iop, 13118, ally.cell))
  console.log(ally.stats.power, ally.stats.pushDamage, ally.buffs.map(b => [b.label, b.remaining]))
  console.log(castSpell(engine, fs, iop, 13120, iop.cell), iop.hp, iop.maxHp, iop.buffs.map(b => [b.label, b.remaining, b.effect.effectId]))
  console.log(castSpell(engine, fs, iop, 13141, foe.cell), foe.stats.mp, foe.states, foe.buffs.map(b => [b.label, b.remaining]))
  for (let i = 0; i < 4; i++) { const f = next(engine, fs); console.log('turn', f?.name, 'ally power', ally.stats.power, ally.buffs.length, 'foe mp', foe.mp, foe.stats.mp) }
  console.log(fs.events.filter(e => e.t === 'log' || e.t === 'buff').slice(0, 20))
})
