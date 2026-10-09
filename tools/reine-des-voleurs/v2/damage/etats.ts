// États posés par les sorts du Crâ (tous sous-sorts compris) : drapeaux qui comptent pour la formation.
import { loadDataStore } from '../../../../src/data/node'
const data = loadDataStore('data')
const SUB = new Set([1160, 792, 2160, 2794, 2795, 1018, 793, 1017, 1019])
const found = new Map<number, Set<string>>()
const walk = (id: number, grade: number | undefined, root: string, depth: number, seen: Set<string>) => {
  const lv = grade ? data.spellLevel(id, { grade }) : data.spellLevel(id, { playerLevel: 200 }); if (!lv) return
  for (const e of [...lv.effects, ...lv.criticalEffects]) {
    if (e.effectId === 950) { const s = found.get(e.value) ?? new Set(); s.add(`${root} (masque ${e.targetMask}, zone ${e.zone.shape}${e.zone.size})`); found.set(e.value, s) }
    if (SUB.has(e.effectId) && depth < 4) { const k = `${e.diceNum}:${e.diceSide}`; if (!seen.has(k)) { seen.add(k); walk(e.diceNum, e.diceSide || 1, root, depth + 1, seen) } }
  }
}
for (const [a, b] of data.breed(9)!.spellPairs) for (const id of [a, b]) walk(id, undefined, data.spell(id)!.name, 0, new Set())
for (const [st, who] of found) {
  const s = data.state(st) as unknown as Record<string, unknown>
  const flags = Object.entries(s).filter(([k, v]) => v === true && !['isSilent', 'displayTurnRemaining'].includes(k)).map(([k]) => k)
  console.log(`état ${st} « ${s.name} » ${flags.length ? '[' + flags.join(', ') + ']' : ''} ← ${[...who].join(' ; ')}`)
}
