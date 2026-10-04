/**
 * Couverture du moteur : lance chaque sort des 19 classes (niveau 200) et des monstres de l'Œil de Vortex dans un bac
 * à sable (carte ouverte, alliés et ennemis autour du lanceur) et relève : sort lançable, exception, effets sans
 * interprète. Résultat : docs/engine-coverage.md + .cache/engine-coverage.json.
 *
 * Usage : npx tsx scripts/coverage-effects.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { emptyStats } from '../src/core/types'
import type { MapData } from '../src/data/model'
import { loadDataStore } from '../src/data/node'
import { canCast, castSpell } from '../src/engine/cast'
import { unknownEffects } from '../src/engine/effects/registry'
import { createEngine } from '../src/engine/index'
import { createMonsterFighter, createPlayerFighter } from '../src/engine/factory'
import type { Fighter, FightState, KnownSpell } from '../src/engine/types'
import { cellInDirection } from '../src/map/geometry'

const data = loadDataStore('data')
const openMap: MapData = {
  id: 0,
  name: 'Bac à sable',
  cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })),
}
const CENTER = 300

function playerStats() {
  const s = emptyStats()
  Object.assign(s, { ap: 12, mp: 6, range: 2, summons: 4, strength: 800, intelligence: 800, chance: 800, agility: 800, wisdom: 200, critical: 30, initiative: 3400, power: 100, damage: 50 })
  return s
}

interface Row {
  owner: string
  spellId: number
  name: string
  castable: boolean
  failure?: string
  error?: string
  unknown: number[]
  events: number
}

function sandbox(casterFactory: () => Fighter): { engine: ReturnType<typeof createEngine>; fight: FightState; caster: Fighter } {
  const engine = createEngine(data)
  const caster = casterFactory()
  caster.cell = CENTER
  const ally = createPlayerFighter(data, { name: 'Allié', breedId: 7, level: 200, stats: playerStats(), maxHp: 5000, team: caster.team })
  ally.cell = cellInDirection(CENTER, 1, 2)
  const enemyTeam = caster.team === 0 ? 1 : 0
  const enemies = [1, 3, 5].map((d, i) => {
    const e = createMonsterFighter(data, { monsterId: 3834, grade: 5, team: enemyTeam })
    e.cell = cellInDirection(CENTER, [3, 5, 7][i], d)
    return e
  })
  const fight = engine.createFight({ map: openMap, fighters: [caster, ally, ...enemies], options: { seed: 7, rollMode: 'random', record: true, maxRounds: 10 } })
  fight.round = 1
  fight.turnIndex = fight.timeline.indexOf(caster.id)
  caster.ap = 30
  caster.mp = 10
  return { engine, fight, caster: fight.fighters[caster.id] }
}

function tryCast(owner: string, spell: KnownSpell, casterFactory: () => Fighter): Row {
  const row: Row = { owner, spellId: spell.spellId, name: spell.name, castable: false, unknown: [], events: 0 }
  const before = new Map(unknownEffects())
  try {
    const { engine, fight, caster } = sandbox(casterFactory)
    const known = caster.spells.find(s => s.spellId === spell.spellId) ?? spell
    if (!caster.spells.includes(known)) caster.spells.push(known)
    // Cellules candidates : ennemis, allié, soi, puis cellules libres proches.
    const candidates = [
      ...fight.fighters.filter(f => f.team !== caster.team).map(f => f.cell),
      ...fight.fighters.filter(f => f.team === caster.team && f.id !== caster.id).map(f => f.cell),
      caster.cell,
    ]
    for (let c = 0; c < 560; c++) if (!candidates.includes(c)) candidates.push(c)
    let lastFailure: string | null = null
    for (const cell of candidates) {
      const f = canCast(engine, fight, caster, known, cell)
      if (f) {
        lastFailure ??= f
        continue
      }
      const before = fight.events.length
      const res = castSpell(engine, fight, caster, spell.spellId, cell)
      row.castable = res.ok
      if (!res.ok) row.failure = res.failure
      row.events = fight.events.length - before
      break
    }
    if (!row.castable && !row.failure) row.failure = lastFailure ?? 'noCell'
  } catch (e) {
    row.error = (e as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(e)
  }
  for (const [id, n] of unknownEffects()) if ((before.get(id) ?? 0) < n) row.unknown.push(id)
  return row
}

const rows: Row[] = []
for (const breed of (data as unknown as { listBreeds(): { id: number; name: string }[] }).listBreeds()) {
  const proto = createPlayerFighter(data, { name: breed.name, breedId: breed.id, level: 200, stats: playerStats(), maxHp: 5000 })
  for (const spell of proto.spells) {
    rows.push(
      tryCast(breed.name, spell, () =>
        createPlayerFighter(data, { name: breed.name, breedId: breed.id, level: 200, stats: playerStats(), maxHp: 5000 }),
      ),
    )
  }
}
for (const monsterId of [3833, 3834, 3835, 3836, 3837, 3838, 3839]) {
  const proto = createMonsterFighter(data, { monsterId, grade: 5, team: 1 })
  for (const spell of proto.spells) rows.push(tryCast(proto.name, spell, () => createMonsterFighter(data, { monsterId, grade: 5, team: 1 })))
}

const total = rows.length
const castable = rows.filter(r => r.castable).length
const errors = rows.filter(r => r.error)
const withUnknown = rows.filter(r => r.unknown.length)
const notCastable = rows.filter(r => !r.castable && !r.error)
const unknownIds = new Map<number, number>()
for (const r of rows) for (const id of r.unknown) unknownIds.set(id, (unknownIds.get(id) ?? 0) + 1)
const failureCounts = new Map<string, number>()
for (const r of notCastable) failureCounts.set(r.failure ?? '?', (failureCounts.get(r.failure ?? '?') ?? 0) + 1)

const md = [
  '# Couverture du moteur (sorts de classe niveau 200 + Œil de Vortex)',
  '',
  `Généré par \`npx tsx scripts/coverage-effects.ts\` (bac à sable : carte ouverte, 1 allié, 3 ennemis).`,
  '',
  `- Sorts testés : **${total}**`,
  `- Lancés avec succès : **${castable}** (${((castable / total) * 100).toFixed(1)} %)`,
  `- Exceptions : **${errors.length}**`,
  `- Sorts ayant rencontré un effet sans interprète : **${withUnknown.length}**`,
  `- Non lancés (aucune cellule valide dans le bac à sable) : ${notCastable.length} — ${[...failureCounts].map(([k, v]) => `${k} ${v}`).join(', ')}`,
  '',
  '## Effets sans interprète',
  '',
  unknownIds.size ? '| effectId | sorts concernés |\n|---|---|\n' + [...unknownIds].sort((a, b) => b[1] - a[1]).map(([id, n]) => `| ${id} | ${n} |`).join('\n') : 'Aucun.',
  '',
  '## Exceptions',
  '',
  errors.length ? errors.map(r => `- ${r.owner} — ${r.name} (${r.spellId}) : \`${r.error}\``).join('\n') : 'Aucune.',
  '',
  '## Sorts non lancés dans le bac à sable',
  '',
  notCastable.length ? notCastable.map(r => `- ${r.owner} — ${r.name} (${r.spellId}) : ${r.failure}`).join('\n') : 'Aucun.',
  '',
]
mkdirSync('.cache', { recursive: true })
writeFileSync('.cache/engine-coverage.json', JSON.stringify(rows, null, 1))
writeFileSync('docs/engine-coverage.md', md.join('\n'))
console.log(`total=${total} castable=${castable} errors=${errors.length} withUnknown=${withUnknown.length} notCastable=${notCastable.length}`)
console.log('unknown ids:', [...unknownIds].map(([k, v]) => `${k}x${v}`).join(' '))
console.log('failures:', [...failureCounts].map(([k, v]) => `${k}:${v}`).join(' '))
