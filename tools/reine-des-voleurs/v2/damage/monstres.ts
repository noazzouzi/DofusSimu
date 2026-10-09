// Fiches des 6 monstres du combat (tous les grades) : niveau, PV, PA/PM, résistances, esquives, sort de départ, sorts.
import { loadDataStore } from '../../../../src/data/node'
import { createMonsterFighter } from '../../../../src/engine/factory'
const data = loadDataStore('data')
const IDS = [3726, 3746, 3747, 3748, 3749, 3750]
for (const id of IDS) {
  const m = data.monster(id)!
  console.log(`\n${m.name} (${id}) boss=${m.isBoss} poussable=${m.canBePushed} échange=${m.canSwitchPos} tags=${m.tags.join(',')}`)
  for (const g of m.grades) {
    const s = g.stats as Record<string, number>
    const f = createMonsterFighter(data, { monsterId: id, grade: g.grade, team: 1 })
    const st = f.stats as unknown as Record<string, number>
    const res = ['neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct'].map(k => st[k] ?? 0).join('/')
    const fixed = ['neutralRes', 'earthRes', 'fireRes', 'waterRes', 'airRes'].map(k => st[k] ?? 0).join('/')
    const other = ['rangedResPct', 'meleeResPct', 'spellResPct', 'allResPct', 'finalDamageReceivedPct'].map(k => `${k}=${st[k] ?? 0}`).join(' ')
    console.log(`  g${g.grade} niv ${g.level} PV ${f.maxHp} PA ${g.ap} PM ${g.mp} Ré% N/T/F/E/A ${res} fixes ${fixed} ${other} esqPA ${st.apDodge ?? st.dodgeAp ?? '?'} esqPM ${st.mpDodge ?? st.dodgeMp ?? '?'} départ ${g.startingSpell ? `${data.spell(g.startingSpell.spellId)?.name} (${g.startingSpell.spellId} g${g.startingSpell.grade})` : '—'} états ${JSON.stringify(f.states)}`)
    if (g.grade === m.grades.length) console.log(`    stats brutes g${g.grade} : ${JSON.stringify(s)}`)
  }
  console.log(`  sorts : ${m.spells.map(x => `${data.spell(x)?.name} (${x})`).join(', ')}`)
}
