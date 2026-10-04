import { data } from './ai-core-helpers'
for (const [id, g] of [[29723, 3], [29723, 6], [21911, 5], [21911, 6]]) {
  const l = data.spellLevel(id, { grade: g })!
  console.log(id, g, data.spell(id)?.name)
  for (const e of l.effects) console.log('   ', e.effectId, `dice ${e.diceNum}-${e.diceSide} v${e.value} dur${e.duration} delay${e.delay} mask "${e.targetMask}" zone ${e.zone.shape}${e.zone.size} trig "${e.triggers}"${e.clientOnly ? ' client' : ''}`)
}
