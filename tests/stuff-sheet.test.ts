/**
 * Fiches de stuff (src/stats/sheet.ts, src/optimizer/team/sheets.ts, `teamStuffs` / `stuffCatalog` de teamfile.ts) :
 * section « Stuffs » du visualiseur et méta des replays.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { memberSheet } from '../src/optimizer/team/sheets'
import { stuffCatalog, teamStuffs, TEAMS_DIR } from '../src/optimizer/team/teamfile'
import { compositionFromTeamFile, parseTeamFile, resolveComposition } from '../src/optimizer/team/userteam'
import { computeBuildStats } from '../src/stats/build'
import { buildStuffSheet, effectLine, SLOT_ORDER } from '../src/stats/sheet'

const data = loadDataStore()
const vortex = teamStuffs(data, join(TEAMS_DIR, 'vortex.json'))

describe('fiches de l’équipe du Vortex (data/teams/vortex.json)', () => {
  it('une fiche par membre, avec le build que la CLI fait combattre', () => {
    expect(vortex.error).toBeUndefined()
    expect(vortex.scenarioName).toBe('Œil de Vortex')
    expect(vortex.file).toBe('data/teams/vortex.json')
    expect(vortex.members.map(m => m.presetId)).toEqual(['eniripsa_soin_vortex', 'enutrof_retrait_pm_vortex', 'cra_terre_mono_vortex', 'cra_terre_mono_vortex_def'])
    const { options } = resolveComposition(compositionFromTeamFile(parseTeamFile({ version: 1, scenario: 'vortex', members: vortex.members.map(m => ({ class: m.className, preset: m.presetId })) })), data, 'vortex')
    for (const [i, sheet] of vortex.members.entries()) {
      const r = computeBuildStats(options[i].member.build, data)
      expect(sheet.valid).toBe(true)
      expect(sheet.hp).toBe(r.maxHp)
      expect(sheet.items).toHaveLength(16)
      for (const p of sheet.primary) expect(p.base + p.scrolls + p.equipment).toBe(p.total)
      expect(sheet.primary.map(p => p.total)).toEqual(['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility'].map(k => r.stats[k as 'vitality']))
      expect(sheet.sets.map(s => [s.setId, s.count, s.tier]).sort()).toEqual(r.sets.map(s => [s.setId, s.count, s.tier]).sort())
      expect(sheet.spells).toHaveLength(22)
      expect(sheet.stuffLabel).toMatch(/Vortex/)
    }
  })

  it('objets dans l’ordre des emplacements, jets max et plages du jeu, forgemagie typée', () => {
    const cra = vortex.members[2]
    const ranks = cra.items.map(it => SLOT_ORDER.indexOf(it.slot))
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    const bow = cra.items.find(it => it.slot === 'weapon')!
    expect(bow.name).toBe('Arc du Vénérable Endormi')
    expect(bow.weapon).toMatchObject({ apCost: 5, minRange: 4, range: 8 })
    expect(bow.effects[0]).toMatchObject({ kind: 'weapon', text: '49 à 55 dommages Terre' })
    expect(bow.effects.find(l => l.stat === 'vitality')).toMatchObject({ value: 450, text: '450 Vitalité', range: '401 à 450' })
    expect(bow.effects.find(l => l.stat === 'initiative')).toMatchObject({ value: -200, text: '-200 Initiative', malus: true })
    expect(bow.effects.find(l => l.stat === 'earthResPct')?.text).toBe('7% Résistance Terre')
    expect(bow.forgemagie).toEqual([{ stat: 'spellDamagePct', label: '1% Dommages aux sorts', value: 1, kind: 'transcendence' }])
    const kinds = new Set(cra.items.flatMap(it => it.forgemagie.map(f => f.kind)))
    expect(kinds).toEqual(new Set(['exo', 'transcendence']))
  })

  it('le stuff défensif du 2ᵉ Crâ a plus de PV que le stuff équilibré', () => {
    expect(vortex.members[3].hp).toBeGreaterThan(vortex.members[2].hp)
  })
})

describe('lignes d’effets', () => {
  it('sort passif, plafond, effets masqués', () => {
    expect(effectLine({ effectId: 1175, min: 0, max: 0 }, data)).toBeDefined()
    const dofus = vortex.members[0].items.find(it => it.name === 'Dofus Ocre')!
    expect(dofus.effects.some(l => l.kind === 'passive' && l.text.startsWith('Sort : '))).toBe(true)
    expect(effectLine({ effectId: 2897, min: 1, max: 11 }, data)?.text).toBe('PA max. 11')
    expect(effectLine({ effectId: 983, min: 0, max: 0 }, data)).toBeUndefined()
    expect(effectLine({ effectId: 108, min: 15, max: 18 }, data)).toMatchObject({ kind: 'heal', text: '15 à 18 soins Feu' })
  })

  it('jet imposé (`rolls`) et build sans objet', () => {
    const naked = buildStuffSheet({ name: 'Nu', breedId: 9, level: 200, characteristicPoints: {}, scrolls: {}, items: [] }, data, { name: 'Nu' })
    expect(naked.items).toEqual([])
    expect(naked.className).toBe('Crâ')
    const amulet = buildStuffSheet({ name: 'A', breedId: 9, level: 200, characteristicPoints: {}, scrolls: {}, items: [{ itemId: 14080, rolls: { 125: 260 } }] }, data, { name: 'A' })
    expect(amulet.items[0].effects.find(l => l.stat === 'vitality')).toMatchObject({ value: 260, text: '260 Vitalité', range: '251 à 300' })
  })
})

describe('fiches des replays et catalogue', () => {
  it('sans option (replays) : preset dérivé retrouvé par son stuff', () => {
    const comp = compositionFromTeamFile(parseTeamFile({ version: 1, scenario: 'vortex', members: [{ class: 'cra', preset: 'cra_terre_mono_vortex_def' }] }))
    const { team } = resolveComposition(comp, data, 'vortex')
    expect(team[0].presetId).toBe('cra_terre_mono') // MemberSpec : preset de base
    const sheet = memberSheet(team[0], data)
    expect(sheet.presetId).toBe('cra_terre_mono_vortex_def')
    expect(sheet.stuffLabel).toMatch(/défensif/)
  })

  it('un fichier d’équipe illisible ne casse pas le catalogue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dofussimu-stuffs-'))
    writeFileSync(join(dir, 'casse.json'), '{ pas du json')
    writeFileSync(join(dir, 'vortex.json'), JSON.stringify({ version: 1, scenario: 'vortex', members: [{ class: 'iop' }] }))
    const cat = stuffCatalog(data, dir)
    expect(cat.teams.map(t => t.scenario)).toEqual(['casse', 'vortex'])
    expect(cat.teams[0].error).toMatch(/JSON invalide/)
    expect(cat.teams[0].members).toEqual([])
    expect(cat.teams[1].members[0].className).toBe('Iop')
    expect(JSON.parse(JSON.stringify(cat))).toEqual(cat)
  })
})
