import { it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import '../src/engine/effects/buffs'
import '../src/engine/effects/castspell'
import { castSubSpell } from '../src/engine/effects/core'
import { installDamageHooks } from '../src/engine/effects/damage'
import { installMarks } from '../src/engine/effects/marks'
import '../src/engine/effects/misc'
import '../src/engine/effects/summons'
import { cellAt, fight, giveState, newEngine, player, events } from './effects-movement-helpers'

const all = () => newEngine(e => { installDamageHooks(e); installMarks(e) })
it('Comète', () => {
  for (const ex of [11, 15]) {
    const engine = all()
    const h = player({ name: 'Hupper', breedId: 17, spellIds: [13726], cell: cellAt(10, 0) })
    const enemy = player({ name: 'Ennemi', breedId: 8, team: 1, cell: cellAt(ex, 0) })
    const fs = fight(engine, [h, enemy])
    const r = castSpell(engine, fs, h, 13726, enemy.cell)
    console.log('comete enemy at', ex, r, 'hupper ->', h.cell, { recul3: cellAt(7, 0), contact: cellAt(ex - 1, 0) }, events(fs, 'push').map(e => JSON.stringify(e)), events(fs, 'teleport').map(e => JSON.stringify(e)))
  }
})
it('Balestra', () => {
  const engine = all()
  const c = player({ name: 'Cra?', breedId: 20, spellIds: [23434], cell: cellAt(10, 0), stats: { initiative: 9999 } })
  const enemy = player({ name: 'En', breedId: 8, team: 1, cell: cellAt(14, 0) })
  const fs = fight(engine, [c, enemy])
  giveState(engine, fs, c, 3360)
  console.log('balestra', castSubSpell(engine, fs, c, 23434, 1, enemy.cell, false, 0), 'caster', c.cell, { tp: cellAt(13, 0), mirror: cellAt(15, 0), pushed: cellAt(17, 0) })
  console.log(events(fs, 'push').concat(events(fs, 'teleport') as never).map(e => JSON.stringify(e)).join('\n'))
})
