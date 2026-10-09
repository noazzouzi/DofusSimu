import { loadDataStore } from '/home/user/DofusSimu/src/data/node'
import { readFileSync } from 'node:fs'
const data = loadDataStore('/home/user/DofusSimu/data')
const raw = JSON.parse(readFileSync('/home/user/DofusSimu/data/dofusdb/effects.json', 'utf8')) as { id: number; description?: { fr?: string } }[]
const DESC = new Map(raw.map(e => [e.id, (e.description?.fr ?? '').replace(/#\d|\{[^}]*\}|<[^>]*>/g, '').replace(/\s+/g, ' ').trim()]))
for (const [id, g] of [[32476, 6], [32476, 7], [32476, 8]] as const) {
  const lv = data.spellLevel(id, { grade: g }); if (!lv) { console.log(`${id} g${g} absent`); continue }
  console.log(`sort ${id} « ${data.spell(id)?.name} » g${g}`)
  for (const e of lv.effects) if (!e.clientOnly) console.log(`  ${e.effectId} ${DESC.get(e.effectId)} [${e.diceNum}-${e.diceSide} v${e.value}] zone ${e.zone.shape}${e.zone.size} masque «${e.targetMask}» dur ${e.duration} décl ${e.triggers}`)
}
