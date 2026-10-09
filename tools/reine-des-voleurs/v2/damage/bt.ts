import { loadDataStore } from '../../../../src/data/node'
const data = loadDataStore('data')
for (const g of [1, 8, 9]) { const l = data.spellLevel(32476, { grade: g }); console.log(g, l?.maxStack, l?.maxCastPerTurn, l?.maxCastPerTarget, JSON.stringify(l?.effects.map(e => [e.effectId, e.diceNum, e.value, e.duration]))) }
const l = data.spellLevel(32467, { playerLevel: 200 })!; console.log('32467', l.grade, l.maxStack)
for (const g of [1, 2]) { const x = data.spellLevel(32467, { grade: g })!; console.log('32467 g' + g, JSON.stringify(x.effects.map(e => [e.effectId, e.diceNum, e.diceSide, e.zone.shape + e.zone.size + '/' + e.zone.minSize, e.targetMask]))) }
