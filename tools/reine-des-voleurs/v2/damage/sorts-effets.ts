// Sorts du Crâ (22 paires, grade disponible au niveau 200) : TOUS les effets (y compris sous-sorts), avec masque, zone,
// durée, déclencheur. Sert à repérer : Pesanteur (état 7), poussées/attirances (alliés ?), zones qui touchent les
// alliés (masques a/g), retraits PA/PM, soins, buffs. Lecture seule sur le dépôt.
import { readFileSync } from 'node:fs'
import { loadDataStore } from '../../../../src/data/node'
const data = loadDataStore('data')
const raw = JSON.parse(readFileSync('data/dofusdb/effects.json', 'utf8')) as { id: number; description?: { fr?: string } }[]
const DESC = new Map(raw.map(e => [e.id, (e.description?.fr ?? '').replace(/#\d|\{[^}]*\}|<[^>]*>/g, '').replace(/\s+/g, ' ').trim()]))
const SUB = new Set([1160, 792, 2160, 2794, 2795, 1018, 793, 1019, 2017])
const breed = data.breed(9)!
const zone = (e: { zone: { shape: string; size: number; minSize: number } }) => `${e.zone.shape}${e.zone.size}${e.zone.minSize ? '/' + e.zone.minSize : ''}`
function dump(spellId: number, grade: number | undefined, depth: number, seen: Set<string>, out: string[]) {
  const lv = grade ? data.spellLevel(spellId, { grade }) : data.spellLevel(spellId, { playerLevel: 200 })
  if (!lv) return
  const pad = '      ' + '  '.repeat(depth)
  for (const [crit, list] of [[false, lv.effects], [true, lv.criticalEffects]] as const) {
    if (crit && depth > 0) continue
    if (crit) { out.push(`${pad}(critique : ${list.length} effets, mêmes types)`); continue }
    for (const e of list) {
      if (e.clientOnly) continue
      const d = DESC.get(e.effectId) ?? '?'
      const st = e.effectId === 950 || e.effectId === 951 || e.effectId === 952 ? ` état ${e.value || e.diceSide || e.diceNum} « ${data.state(e.value || e.diceSide || e.diceNum)?.name ?? '?'} »` : ''
      out.push(`${pad}${e.effectId} ${d} [${e.diceNum}-${e.diceSide} v${e.value}]${st} zone ${zone(e)} masque «${e.targetMask}» dur ${e.duration}${e.delay ? ' délai ' + e.delay : ''}${e.triggers !== 'I' ? ' décl ' + e.triggers : ''}${e.random ? ' p' + e.random + '%' : ''}${e.element >= 0 ? ' élt ' + e.element : ''}`)
      if (SUB.has(e.effectId) && depth < 2) {
        const k = `${e.diceNum}:${e.diceSide}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push(`${pad}  ↳ sous-sort ${e.diceNum} « ${data.spell(e.diceNum)?.name ?? '?'} » grade ${e.diceSide || 1}`)
        dump(e.diceNum, e.diceSide || 1, depth + 1, seen, out)
      }
    }
  }
}
breed.spellPairs.forEach(([a, b], i) => {
  for (const id of [a, b]) {
    const lv = data.spellLevel(id, { playerLevel: 200 })!
    const sp = data.spell(id)!
    const grades = sp.levels.map(l => `${l.grade}:${l.minPlayerLevel}`).join(' ')
    const glob = [lv.maxGlobalCastPerTurn ? `global ${lv.maxGlobalCastPerTurn}/tour` : '', lv.maxGlobalCastPerTarget ? `global ${lv.maxGlobalCastPerTarget}/cible` : ''].filter(Boolean).join(' ')
    console.log(`P${i + 1} ${id === a ? 'base ' : 'var. '} ${sp.name} (${id}) grade ${lv.grade} [grades:niv ${grades}] ${lv.apCost} PA PO ${lv.minRange}-${lv.range}${lv.rangeBoostable ? '+' : ''} ${lv.castInLine ? 'en ligne ' : ''}${lv.castInDiagonal ? 'en diagonale ' : ''}${lv.castTestLos ? 'LdV' : 'sans LdV'} ${lv.maxCastPerTurn || '∞'}/tour ${lv.maxCastPerTarget || '∞'}/cible relance ${lv.minCastInterval} rel.init ${lv.initialCooldown} cumul ${lv.maxStack} CC ${lv.critChance}% ${glob}${lv.needFreeCell ? ' case libre' : ''}${lv.needTakenCell ? ' case occupée' : ''}${lv.statesCriterion ? ' critère ' + lv.statesCriterion : ''}`)
    const out: string[] = []
    dump(id, undefined, 0, new Set(), out)
    for (const l of out) console.log(l)
  }
})
