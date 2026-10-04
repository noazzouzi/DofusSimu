import { data } from './ai-core-helpers'
for (const id of [12738, 29723]) {
  const l = data.spellLevel(id, { playerLevel: 200 }) ?? data.spellLevel(id, {})!
  console.log(id, data.spell(id)?.name, l.apCost, l.range, l.needFreeCell, JSON.stringify(l.effects.map(e => [e.effectId, e.diceNum, e.diceSide, e.value, e.duration, e.targetMask, e.triggers, e.zone.shape + e.zone.size, e.clientOnly])))
}
