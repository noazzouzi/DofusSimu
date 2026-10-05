/**
 * Campagne de composition du Vortex (docs/reports/vortex-composition.md) : stuffs Vortex construits par
 * l'optimiseur pour les classes candidates, ajoutés comme presets dérivés (`<preset>_vortex[_def]`, stuff
 * `vortex_<preset>[_def]`). Vérifie que chaque build est valide en jeu (conditions, 995 points + parchemins, un seul
 * exo PA/PM/PO, une ligne de forgemagie par objet, au plus 6 transcendances, une seule prysmaradite, Dofus/trophées
 * uniques) et qu'un preset dérivé garde l'identité IA de son preset de base.
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { computeBuildStats, ITEM_TYPE_PRYSMARADITE } from '../src/stats/build'
import { BASE_PRESETS, getPreset, parseTeam, presetMember, PRESETS, STUFFS } from '../src/optimizer/team/presets'

const DATA = loadDataStore('data')
const COMPO = PRESETS.filter(p => p.extends && p.source?.includes('vortex-composition.md'))

describe('presets de la campagne de composition (vortex-composition.md)', () => {
  it('existent, dérivent d\'un preset de base et ne sont pas candidats de composition', () => {
    expect(COMPO.length).toBeGreaterThanOrEqual(20)
    for (const p of COMPO) {
      expect(p.stuff, p.id).toBe(`vortex_${p.extends}${p.id.endsWith('_def') ? '_def' : ''}`)
      expect(p.id.startsWith(`${p.extends}_vortex`), p.id).toBe(true)
      expect(BASE_PRESETS.some(b => b.id === p.id), p.id).toBe(false)
      const base = getPreset(p.extends!)
      expect(p.breedId).toBe(base.breedId)
      expect(p.role).toBe(base.role)
      expect(p.variants).toEqual(base.variants)
    }
  })

  it('builds valides en jeu : 995 / 995 points, parchemins, conditions, forgemagie réaliste', () => {
    for (const p of COMPO) {
      const m = presetMember(p, DATA)
      const r = computeBuildStats(m.build, DATA)
      expect(r.valid, `${p.id} : ${r.warnings.join(' | ')}`).toBe(true)
      expect(r.points, p.id).toEqual({ available: 995, spent: 995, remaining: 0 })
      expect(Object.values(m.build.scrolls).every(v => v === 100), p.id).toBe(true)
      expect(r.stats.ap, p.id).toBeLessThanOrEqual(12)
      expect(r.stats.mp, p.id).toBeLessThanOrEqual(6)
      const tpl = STUFFS[p.stuff]
      expect(tpl.breeds, p.id).toContain(p.breedId)
      const exo: Record<string, number> = {}
      let transc = 0
      let prysma = 0
      const dofus = new Set<number>()
      for (const it of tpl.items) {
        const item = DATA.item(it.itemId)!
        const lines = it.exos ?? []
        expect(lines.length, `${p.id} ${item.name}`).toBeLessThanOrEqual(1)
        for (const l of lines) {
          if (l.kind === 'transcendence') { transc++; continue }
          expect(['ap', 'mp', 'range'], `${p.id} ${item.name}`).toContain(l.stat)
          exo[l.stat] = (exo[l.stat] ?? 0) + 1
          const native = item.effects.some(e => e.effectId === { ap: 111, mp: 128, range: 117 }[l.stat as 'ap' | 'mp' | 'range'])
          expect(native, `${p.id} : exo ${l.stat} sur ${item.name}, qui a déjà la ligne`).toBe(false)
        }
        if (item.slot === 'dofus') {
          expect(dofus.has(item.id), `${p.id} : ${item.name} en double`).toBe(false)
          dofus.add(item.id)
          if (item.typeId === ITEM_TYPE_PRYSMARADITE) prysma++
        }
      }
      for (const [k, n] of Object.entries(exo)) expect(n, `${p.id} exo ${k}`).toBe(1)
      expect(transc, p.id).toBeLessThanOrEqual(6)
      expect(prysma, p.id).toBeLessThanOrEqual(1)
    }
  })

  it('une équipe mêlant presets de la campagne de stuffs et de composition se résout (même IA que les presets de base)', () => {
    const team = parseTeam('cra_feu_vortex,enutrof_retrait_pm_vortex,osamodas_invocations_vortex,eniripsa_soin_vortex', DATA)
    expect(team.map(m => m.presetId)).toEqual(['cra_feu_zone', 'enutrof_retrait_pm_eau', 'osamodas_invocations', 'eniripsa_soin_feu'])
  })
})
