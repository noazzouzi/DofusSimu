// Balises du Crâ (8347 Balise Tactique, 8348 Balise de Survie) et Vendetta (piège 32478) : sorts, effets.
import { loadDataStore } from '../../../../src/data/node'
import { readFileSync } from 'node:fs'
const data = loadDataStore('data')
const raw = JSON.parse(readFileSync('data/dofusdb/effects.json', 'utf8')) as { id: number; description?: { fr?: string } }[]
const DESC = new Map(raw.map(e => [e.id, (e.description?.fr ?? '').replace(/#\d|\{[^}]*\}|<[^>]*>/g, '').replace(/\s+/g, ' ').trim()]))
const show = (id: number, grade: number, depth = 0, seen = new Set<string>()) => {
  const lv = data.spellLevel(id, { grade }); if (!lv) { console.log(' '.repeat(depth * 2) + `(sort ${id} g${grade} absent)`); return }
  console.log(' '.repeat(depth * 2) + `sort ${id} « ${data.spell(id)?.name} » g${grade} ${lv.apCost} PA PO ${lv.minRange}-${lv.range} relance ${lv.minCastInterval}`)
  for (const e of lv.effects) {
    if (e.clientOnly) continue
    const st = [950, 951].includes(e.effectId) ? ` état ${e.value} « ${data.state(e.value)?.name} »` : ''
    console.log(' '.repeat(depth * 2 + 2) + `${e.effectId} ${DESC.get(e.effectId)} [${e.diceNum}-${e.diceSide} v${e.value}]${st} zone ${e.zone.shape}${e.zone.size}${e.zone.minSize ? '/' + e.zone.minSize : ''} masque «${e.targetMask}» dur ${e.duration} décl ${e.triggers}${e.delay ? ' délai ' + e.delay : ''}`)
    if ([1160, 792, 2160, 2794, 2795, 1018, 793, 1017, 1019].includes(e.effectId) && depth < 3) {
      const k = `${e.diceNum}:${e.diceSide}`; if (seen.has(k)) continue; seen.add(k); show(e.diceNum, e.diceSide || 1, depth + 2, seen)
    }
  }
}
for (const mid of [8347, 8348]) {
  const m = data.monster(mid)!
  console.log(`\n${m.name} (${mid}) grades ${m.grades.map(g => `${g.grade}:PV${g.lifePoints}`).join(' ')} départ ${JSON.stringify(m.grades.map(g => g.startingSpell))}`)
  m.spells.forEach((s, i) => { const g = m.spellGrades?.[i]?.[2] || 1; show(s, g) })
  const g3 = m.grades[2] ?? m.grades[0]
  if (g3.startingSpell) { console.log('  sort de départ :'); show(g3.startingSpell.spellId, g3.startingSpell.grade, 1) }
}
console.log('\nVendetta (piège) :'); show(32478, 1)
console.log('\nBalise Tactique (32476 g9) :'); show(32476, 9)
for (const s of [7, 583, 6979, 3551, 573]) { const st = data.state(s) as unknown as Record<string, unknown>; console.log(`état ${s}`, JSON.stringify(st)) }
