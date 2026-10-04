/**
 * Couverture des grammaires sur les données réelles : chaque masque de cible, condition d'états, déclencheur et
 * zone des sorts de classe (et sorts liés) et des sorts des monstres de l'Œil de Vortex (fermeture transitive :
 * sous-sorts, glyphes, invocations) doit être analysé sans jeton inconnu. Le reste du corpus (tous les monstres
 * de donjon, sorts d'objets) est aussi vérifié et résumé.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseStatesCriterion, parseTriggers } from '../src/engine/criteria'
import { compileTargetMask } from '../src/engine/targetMask'
import { CELL_COUNT, pointToCell } from '../src/map/geometry'
import { KNOWN_SHAPES, compileZone, parseZoneString, zoneCells } from '../src/map/zones'

interface RawEffect {
  effectId: number
  diceNum: number
  diceSide: number
  value: number
  targetMask?: string
  triggers?: string
  zone?: string
  zoneFlags?: string
  zoneCells?: number[]
}
interface RawLevel {
  statesCriterion?: string
  effects?: RawEffect[]
  criticalEffect?: RawEffect[]
}
interface RawSpell {
  id: number
  levels?: RawLevel[]
}

const load = <T,>(file: string): T => JSON.parse(readFileSync(new URL(`../data/dofusdb/${file}`, import.meta.url), 'utf8')) as T
const classData = load<{ spells: RawSpell[]; linkedSpells: RawSpell[] }>('class-spells.json')
const monsterData = load<{ spells: RawSpell[] }>('monster-spells.json')
const itemData = load<{ spells: RawSpell[] }>('item-spells.json')
const monsters = load<{ id: number; spells?: number[] }[]>('monsters.json')
const manifest = load<{ spellRefEffects: { diceNumIsSpell: number[]; valueIsSpell: number[]; summonDiceNumIsMonster: number[] } }>('manifest.json')
const vortexDungeon = JSON.parse(readFileSync(new URL('../data/dungeons/vortex.json', import.meta.url), 'utf8')) as {
  internalSpells: { id: number }[]
}

/** Monstres de l'Œil de Vortex (data/dungeons/vortex.json) : Auroraire, 6 monstres de vague, Sicogne (glyphe). */
const VORTEX_MONSTERS = [3833, 3834, 3835, 3836, 3837, 3838, 3839, 3851]

function vortexSpells(): RawSpell[] {
  const byId = new Map(monsterData.spells.map(s => [s.id, s]))
  const monsterSpells = new Map(monsters.map(m => [m.id, m.spells ?? []]))
  const spellRef = new Set(manifest.spellRefEffects.diceNumIsSpell)
  const valueRef = new Set(manifest.spellRefEffects.valueIsSpell)
  const summonRef = new Set(manifest.spellRefEffects.summonDiceNumIsMonster)
  const seen = new Set<number>()
  const seenMonsters = new Set<number>()
  const queue: number[] = []
  const addMonster = (id: number) => {
    if (seenMonsters.has(id)) return
    seenMonsters.add(id)
    queue.push(...(monsterSpells.get(id) ?? []))
  }
  VORTEX_MONSTERS.forEach(addMonster)
  // Sorts internes du scénario (horloge, glyphes, heures...) lancés par des états / le serveur (vortex.json).
  for (const s of vortexDungeon.internalSpells) queue.push(s.id)
  while (queue.length) {
    const id = queue.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const s = byId.get(id)
    if (!s) continue
    for (const lv of s.levels ?? [])
      for (const e of [...(lv.effects ?? []), ...(lv.criticalEffect ?? [])]) {
        if (spellRef.has(e.effectId) && e.diceNum > 0) queue.push(e.diceNum)
        if (valueRef.has(e.effectId) && e.value > 0) queue.push(e.value)
        if (summonRef.has(e.effectId) && e.diceNum > 0) addMonster(e.diceNum)
      }
  }
  return [...seen].map(id => byId.get(id)).filter((s): s is RawSpell => !!s)
}

interface Coverage {
  spells: number
  masks: Set<string>
  criteria: Set<string>
  triggers: Set<string>
  zones: Set<string>
  unknownMasks: Map<string, number>
  unknownCriteria: Map<string, number>
  unknownTriggers: Map<string, number>
  unknownZones: Map<string, number>
  uncertain: Map<string, number>
}

function bump(m: Map<string, number>, k: string) {
  m.set(k, (m.get(k) ?? 0) + 1)
}

function analyse(spells: RawSpell[]): Coverage {
  const cov: Coverage = {
    spells: spells.length,
    masks: new Set(),
    criteria: new Set(),
    triggers: new Set(),
    zones: new Set(),
    unknownMasks: new Map(),
    unknownCriteria: new Map(),
    unknownTriggers: new Map(),
    unknownZones: new Map(),
    uncertain: new Map(),
  }
  for (const s of spells)
    for (const lv of s.levels ?? []) {
      if (lv.statesCriterion) {
        cov.criteria.add(lv.statesCriterion)
        const c = parseStatesCriterion(lv.statesCriterion)
        for (const u of [...c.unknown, ...c.errors]) bump(cov.unknownCriteria, `${lv.statesCriterion} : ${u}`)
      }
      for (const e of [...(lv.effects ?? []), ...(lv.criticalEffect ?? [])]) {
        const mask = e.targetMask ?? ''
        cov.masks.add(mask)
        const m = compileTargetMask(mask)
        for (const u of m.unknown) bump(cov.unknownMasks, u)
        for (const u of m.uncertain) bump(cov.uncertain, `masque ${u}`)
        const trig = e.triggers ?? ''
        cov.triggers.add(trig)
        const t = parseTriggers(trig)
        for (const u of t.unknown) bump(cov.unknownTriggers, u)
        for (const d of t.triggers) if (d.uncertain) bump(cov.uncertain, `déclencheur ${d.code}`)
        if (e.zone) {
          const key = `${e.zone}|${e.zoneFlags ?? ''}`
          cov.zones.add(key)
          const shape = e.zone[0]
          const zone = parseZoneString(e.zone, e.zoneFlags ?? '', e.zoneCells)
          const numbersOk = [zone.size, zone.minSize, zone.decreaseStepPct, zone.maxDecreaseCount].every(Number.isFinite)
          if (!KNOWN_SHAPES.includes(shape) || compileZone(zone).shape !== shape || !numbersOk) bump(cov.unknownZones, e.zone)
        }
      }
    }
  return cov
}

const summary = (name: string, c: Coverage) =>
  `${name} : ${c.spells} sorts, ${c.masks.size} masques, ${c.criteria.size} conditions, ${c.triggers.size} déclencheurs, ` +
  `${c.zones.size} zones ; inconnus : masques ${JSON.stringify([...c.unknownMasks])}, conditions ${JSON.stringify([...c.unknownCriteria])}, ` +
  `déclencheurs ${JSON.stringify([...c.unknownTriggers])}, zones ${JSON.stringify([...c.unknownZones])} ; INCERTAINS : ${JSON.stringify([...c.uncertain])}`

function expectNoUnknown(c: Coverage) {
  expect([...c.unknownMasks]).toEqual([])
  expect([...c.unknownCriteria]).toEqual([])
  expect([...c.unknownTriggers]).toEqual([])
  expect([...c.unknownZones]).toEqual([])
}

describe('couverture des grammaires sur les données', () => {
  it('sorts de classe (19 classes × 44) et sorts liés : aucun jeton inconnu', () => {
    const cov = analyse([...classData.spells, ...classData.linkedSpells])
    console.info(summary('classes', cov))
    expect(classData.spells.length).toBe(836)
    expect(cov.masks.size).toBeGreaterThan(500)
    expect(cov.criteria.size).toBeGreaterThan(40)
    expectNoUnknown(cov)
  })

  it('sorts des monstres de l’Œil de Vortex (fermeture transitive) : aucun jeton inconnu', () => {
    const spells = vortexSpells()
    const ids = new Set(spells.map(s => s.id))
    // Sorts documentés (vortex.md) : monstres de vague, boss, horloge, glyphes et sous-sorts.
    for (const id of [5015, 5016, 5017, 5018, 5019, 5021, 5022, 5023, 5024, 5026, 5027, 5028, 5030, 5032, 5033, 5062, 5064, 5066, 5068, 5070])
      expect(ids.has(id), `sort ${id}`).toBe(true)
    const cov = analyse(spells)
    console.info(summary('Vortex', cov))
    expect(cov.criteria.has('HS!236')).toBe(true)
    expect(cov.criteria.has('HS=236')).toBe(true)
    expectNoUnknown(cov)
  })

  it('reste du corpus (tous les monstres de donjon, sorts d’objets) : aucun jeton inconnu', () => {
    const mon = analyse(monsterData.spells)
    const items = analyse(itemData.spells)
    console.info(summary('monstres (tous donjons)', mon))
    console.info(summary('objets', items))
    expectNoUnknown(mon)
    expectNoUnknown(items)
  })

  it('chaque zone distincte (classes + Vortex) se calcule sans erreur au centre et en bord de carte', () => {
    const zones = new Map<string, RawEffect>()
    for (const s of [...classData.spells, ...classData.linkedSpells, ...vortexSpells()])
      for (const lv of s.levels ?? [])
        for (const e of lv.effects ?? []) if (e.zone) zones.set(`${e.zone}|${e.zoneFlags ?? ''}|${e.zoneCells ?? ''}`, e)
    const center = pointToCell(17, -4)
    const caster = pointToCell(14, -4)
    const empty: string[] = []
    for (const [k, e] of zones) {
      const zone = parseZoneString(e.zone!, e.zoneFlags ?? '', e.zone![0] === ';' ? e.zoneCells : undefined)
      const cells = zoneCells(zone, center, caster)
      expect(cells.every(c => c >= 0 && c < CELL_COUNT)).toBe(true)
      if (!cells.length) empty.push(k)
      expect(zoneCells(zone, 0, 14).every(c => c >= 0 && c < CELL_COUNT)).toBe(true)
      if (e.zone![0] === ';') expect(cells).toEqual(e.zoneCells)
    }
    // Seules les lignes « l » de longueur nulle (param2 = 0, ex. l1,0 / l2,0) sont vides, comme dans le port.
    console.info(`zones vides : ${empty.join(' ')}`)
    for (const k of empty) expect(k).toMatch(/^l\d+,0,/)
  })
})
