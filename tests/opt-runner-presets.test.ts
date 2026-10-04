/**
 * WP4a — presets des 19 classes niveau 200 (docs/design/ai.md §15.6) : variantes, rotations `scripted` et stuffs de
 * départ construits avec de VRAIS objets (data/dofusdb/equipment.json) et validés par src/stats `computeBuildStats`
 * (conditions d'objets, plafonds, exos, points de caractéristiques, parchemins).
 */
import { describe, expect, it } from 'vitest'
import { ROLE_IDS } from '../src/ai/types'
import { loadDataStore } from '../src/data/node'
import { computeBuildStats } from '../src/stats/build'
import {
  PRESETS,
  STUFFS,
  breedIdOf,
  defaultPresetOf,
  parseTeam,
  presetBuild,
  presetsOf,
  resolvePreset,
  validatePreset,
} from '../src/optimizer/team/presets'

const DATA = loadDataStore('data')

describe('presets : couverture et cohérence avec les données', () => {
  it('19 classes, ≥ 2 presets par classe (Eliotrope : 1 set documenté), identifiants uniques', () => {
    const breeds = DATA.listBreeds().map(b => b.id)
    expect(breeds).toHaveLength(19)
    for (const id of breeds) expect(presetsOf(id).length, `classe ${id}`).toBeGreaterThanOrEqual(id === 16 ? 1 : 2)
    expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length)
    expect(PRESETS.length).toBeGreaterThanOrEqual(45)
    for (const p of PRESETS) {
      expect(ROLE_IDS).toContain(p.role)
      if (p.secondaryRole) expect(ROLE_IDS).toContain(p.secondaryRole)
      expect(STUFFS[p.stuff], p.id).toBeDefined()
      expect(DATA.breed(p.breedId)?.name).toBe(p.className)
    }
  })

  it('variantes : 22 choix 0/1, tous débloqués au niveau 200 ; rotation = sorts connus du preset', () => {
    for (const p of PRESETS) {
      const breed = DATA.breed(p.breedId)!
      expect(p.variants, p.id).toHaveLength(22)
      expect(p.variants.every(v => v === 0 || v === 1)).toBe(true)
      const known = new Set(breed.spellPairs.map((pair, i) => pair[p.variants[i]]))
      for (const [i, v] of p.variants.entries()) {
        const unlock = breed.spellPairUnlockLevels?.[i]?.[v]
        if (unlock !== undefined) expect(unlock, `${p.id} paire ${i}`).toBeLessThanOrEqual(200)
        expect(DATA.spellLevel(breed.spellPairs[i][v], { playerLevel: 200 }), `${p.id} paire ${i}`).toBeDefined()
      }
      for (const step of p.rotation) {
        expect(known.has(step.spell), `${p.id} : ${step.spell}`).toBe(true)
        expect(['enemy', 'self', 'ally', 'zone', 'auto']).toContain(step.target)
        if (step.repeat !== undefined) expect(step.repeat).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('stuffs : objets réels de niveau ≤ 200, un objet par emplacement (anneaux et Dofus : capacités respectées)', () => {
    for (const [id, s] of Object.entries(STUFFS)) {
      expect(s.items.length, id).toBeGreaterThanOrEqual(15)
      for (const it of s.items) {
        const item = DATA.item(it.itemId)
        expect(item, `${id} : objet ${it.itemId}`).toBeDefined()
        expect(item!.level).toBeLessThanOrEqual(200)
      }
    }
  })
})

describe('presets : builds valides (computeBuildStats)', () => {
  it('chaque preset avec son stuff : valide (conditions, exos, plafonds), 11-12 PA, 6 PM, PV et élément cohérents', () => {
    for (const p of PRESETS) {
      const r = validatePreset(p, DATA)
      expect(r.valid, `${p.id} : ${r.warnings.join(' | ')}`).toBe(true)
      expect(r.issues.filter(i => i.code === 'condition'), p.id).toEqual([])
      expect(r.points.remaining, p.id).toBeGreaterThanOrEqual(0)
      expect(r.stats.ap, p.id).toBeGreaterThanOrEqual(11)
      expect(r.stats.ap, p.id).toBeLessThanOrEqual(12)
      expect(r.stats.mp, p.id).toBe(6)
      expect(r.stats.range, p.id).toBeGreaterThanOrEqual(3)
      expect(r.maxHp, p.id).toBeGreaterThan(3500)
      const primary = r.stats[p.points.primary as 'strength']
      expect(primary, p.id).toBeGreaterThan(p.stuff === 'tank' ? 300 : 500)
      if (p.stuff === 'tank') expect(r.maxHp, p.id).toBeGreaterThan(5000)
    }
  })

  it('référence « unstuffed » (points + parchemins, aucun objet) et « naked »', () => {
    for (const p of PRESETS) {
      const u = validatePreset(p, DATA, 'unstuffed')
      expect(u.valid, p.id).toBe(true)
      expect(u.stats.ap).toBe(7)
      expect(u.stats.mp).toBe(3)
      expect(u.points.spent).toBeGreaterThan(900)
      const n = computeBuildStats(presetBuild(p, DATA, { stuff: 'naked' }), DATA)
      expect(n.valid).toBe(true)
      expect(n.points.spent).toBe(0)
      expect(n.maxHp).toBe(1050)
    }
  })

  it('un stuff d\'un autre élément reste valide pour toutes les classes (conditions non liées à la classe)', () => {
    for (const s of Object.keys(STUFFS)) {
      for (const breedId of [3, 8, 9, 12]) {
        const r = validatePreset(defaultPresetOf(breedId), DATA, s)
        expect(r.valid, `${breedId} + ${s} : ${r.warnings.join(' | ')}`).toBe(true)
      }
    }
  })
})

describe('équipes en texte (CLI)', () => {
  it('résolution classe:rôle|élément|mot, stuff après @, noms uniques', () => {
    expect(breedIdOf('Crâ')).toBe(9)
    expect(breedIdOf('xelor')).toBe(5)
    expect(breedIdOf('ENI')).toBe(7)
    expect(resolvePreset('iop').id).toBe('iop_terre_burst')
    expect(resolvePreset('iop:zoneDps').id).toBe('iop_multi_zone')
    expect(resolvePreset('cra:feu').id).toBe('cra_feu_zone')
    expect(resolvePreset('enutrof:mpLock').id).toBe('enutrof_retrait_pm_eau')
    expect(resolvePreset('pandawa:placer').id).toBe('pandawa_placement')
    expect(resolvePreset('xelor_retrait_pa').id).toBe('xelor_retrait_pa')
    expect(() => resolvePreset('iop:healer')).toThrow(/Aucun preset/)
    expect(() => resolvePreset('mineur')).toThrow(/Classe inconnue/)
    const team = parseTeam('iop:killer, iop:zoneDps@unstuffed ,cra:killer,enutrof', DATA)
    expect(team.map(m => m.name)).toEqual(['Iop', 'Iop 2', 'Crâ', 'Enutrof'])
    expect(team[1].build.items).toEqual([])
    expect(team[2].role).toBe('killer')
    expect(team[2].presetId).toBe('cra_terre_mono')
    expect(team[0].variants).toEqual(resolvePreset('iop').variants)
    // Les builds ne partagent rien avec le JSON (modifiables par l'optimiseur de stuff).
    team[0].build.items[0].itemId = 1
    expect(STUFFS[resolvePreset('iop').stuff].items[0].itemId).not.toBe(1)
  })
})
