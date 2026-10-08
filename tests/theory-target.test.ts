/**
 * Cible du proxy construite depuis une fiche de boss (src/theorycraft/target.ts) : options explicites (`strictTargets`),
 * réduction à distance de Merkator, invulnérabilité à distance du Père Ver, phases de Solar dans les dégâts reçus.
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { bossProfile } from '../src/theorycraft/bossProfile'
import { bossProxyOptions } from '../src/theorycraft/target'
import { createProxyContext } from '../src/optimizer/stuff/proxy'
import { getPreset, presetMember } from '../src/optimizer/team/presets'
import { computeBuildStats } from '../src/stats/build'

const data = loadDataStore()
const MERKATOR = 3534
const PERE_VER = 4726
const SOLAR = 5100

function dptOf(presetId: string, monsterId: number): number {
  const preset = getPreset(presetId)
  const member = presetMember(preset, data)
  const { stats, maxHp } = computeBuildStats(member.build, data)
  const { options } = bossProxyOptions(bossProfile(data, monsterId), { role: preset.role })
  const ctx = createProxyContext(data, { breedId: member.build.breedId, level: member.build.level, variants: member.build.spellVariants ?? [], role: preset.role, presetId: preset.id, element: preset.element }, { stats, maxHp }, options)
  return ctx.exact(stats, maxHp).dpt
}

describe('bossProxyOptions', () => {
  it('options explicites : cibles = phases attaquables, strictTargets, grade du profil', () => {
    const p = bossProfile(data, MERKATOR)
    const { options } = bossProxyOptions(p, { role: 'killer' })
    expect(options.strictTargets).toBe(true)
    expect(options.grade).toBe(p.grade)
    expect(options.targets!.length).toBeGreaterThan(0)
    for (const t of options.targets!) {
      expect(t.monsterId).toBe(MERKATOR)
      expect(t.stats?.rangedResPct).toBe(50)
    }
    expect(options.rangeNeed).toBe(6)
    expect(bossProxyOptions(p, { role: 'killer', melee: true }).options.rangeNeed).toBe(0)
  })

  it('Père Ver (invulnérable à distance) : aucune phase ne laisse passer les dégâts à distance', () => {
    const { options } = bossProxyOptions(bossProfile(data, PERE_VER), { role: 'killer' })
    for (const t of options.targets!) expect(t.stats?.rangedResPct).toBe(100)
  })

  it('Solar : les phases qui frappent portent leurs états dans les dégâts reçus', () => {
    const { options } = bossProxyOptions(bossProfile(data, SOLAR), { role: 'killer' })
    expect(options.incoming!.some(t => (t.states?.length ?? 0) > 0)).toBe(true)
  })

  it('le proxy suit la cible : un Crâ à distance perd ses dégâts contre le Père Ver, un Iop au contact les garde', () => {
    const craVer = dptOf('cra_terre_mono', PERE_VER)
    const craMerk = dptOf('cra_terre_mono', MERKATOR)
    const iopVer = dptOf('iop_terre_burst', PERE_VER)
    expect(iopVer).toBeGreaterThan(craVer)
    expect(craMerk).toBeGreaterThan(craVer)
  })
})
