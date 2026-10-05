/**
 * Stuffs du Vortex (docs/reports/vortex-stuffs.md) — cible de proxy Vortex (mix des monstres qui frappent mesuré,
 * dommages de poussée), re-planification de la forgemagie aux poids locaux, objets imposés/interdits de la recherche,
 * presets dérivés (`extends`) et stuffs « build complet » (points propres au stuff).
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { computeBuildStats } from '../src/stats/build'
import { createProxyContext } from '../src/optimizer/stuff/proxy'
import { hasPassive } from '../src/optimizer/stuff/pools'
import { optimizeStuff } from '../src/optimizer/stuff/search'
import { VORTEX_INCOMING_MIX, VORTEX_INCOMING_MIX_R1, VORTEX_PUSH, vortexProxyOptions } from '../src/optimizer/stuff/vortex'
import {
  BASE_PRESETS,
  getPreset,
  parseTeam,
  presetBuild,
  presetMember,
  PRESETS,
  resolvePresetExtends,
  STUFFS,
  stuffPoints,
  type Preset,
} from '../src/optimizer/team/presets'

const DATA = loadDataStore('data')

function contextOf(presetId: string, proxyOpts = vortexProxyOptions(getPreset(presetId).role)) {
  const p = getPreset(presetId)
  const m = presetMember(p, DATA)
  const r = computeBuildStats(m.build, DATA)
  const ctx = createProxyContext(DATA, { breedId: p.breedId, level: 200, variants: p.variants, role: p.role, presetId: p.id, element: p.element }, r, proxyOpts)
  return { p, m, r, ctx }
}

describe('cible Vortex du proxy', () => {
  it('mix des monstres qui frappent distinct du mix des cibles ; itération 2 : Brabuzar plus exposé', () => {
    const { ctx } = contextOf('cra_feu_zone')
    expect(ctx.incTargets.map(f => f.monsterId)).toEqual(VORTEX_INCOMING_MIX.map(t => t.monsterId))
    expect(ctx.targets).not.toBe(ctx.incTargets)
    const w = (mix: typeof VORTEX_INCOMING_MIX, id: number) => mix.find(t => t.monsterId === id)!.weight
    expect(w(VORTEX_INCOMING_MIX, 3839)).toBeGreaterThan(w(VORTEX_INCOMING_MIX_R1, 3839))
    // Le Vortex (invulnérable en phase 1) pèse peu dans les dégâts reçus.
    expect(w(VORTEX_INCOMING_MIX, 3835)).toBeLessThan(0.5)
  })

  it('profils : défensif = plus d\'EHP, offensif = plus de DPT ; PO visée 6 sauf au contact', () => {
    const bal = vortexProxyOptions('killer')
    const def = vortexProxyOptions('killer', { profile: 'defensive' })
    const off = vortexProxyOptions('killer', { profile: 'offensive' })
    expect(def.exponents!.b!).toBeGreaterThan(bal.exponents!.b!)
    expect(off.exponents!.a!).toBeGreaterThan(bal.exponents!.a!)
    expect(bal.rangeNeed).toBe(6)
    expect(vortexProxyOptions('killer', { melee: true }).rangeNeed).toBeUndefined()
    expect(bal.incomingPush).toEqual(VORTEX_PUSH)
    expect(vortexProxyOptions('killer', { noPush: true }).incomingPush).toBeUndefined()
  })

  it('poussée : la Résistance Poussée réduit les dégâts reçus (∝ bonus − RePou) et augmente l\'EHP', () => {
    const { r, ctx } = contextOf('iop_terre_burst')
    const s0 = { ...r.stats, pushRes: 0 }
    const s100 = { ...r.stats, pushRes: 100 }
    const sBig = { ...r.stats, pushRes: 500 }
    const e0 = ctx.exact(s0, r.maxHp)
    const e100 = ctx.exact(s100, r.maxHp)
    expect(e100.incoming).toBeLessThan(e0.incoming)
    expect(e100.ehp).toBeGreaterThan(e0.ehp)
    const inc0 = (e0.ehp * e0.incoming) / r.maxHp / (1 + VORTEX_PUSH.share)
    const push0 = ctx.pushIncoming(s0, inc0)
    expect(push0).toBeCloseTo(VORTEX_PUSH.share * inc0, 6)
    expect(ctx.pushIncoming(s100, inc0)).toBeCloseTo((push0 * (VORTEX_PUSH.bonus - 100)) / VORTEX_PUSH.bonus, 6)
    expect(ctx.pushIncoming(sBig, inc0)).toBe(0)
    // Forme fermée : même effet ; sans modèle de poussée, la RePou ne vaut rien.
    expect(ctx.surrogate(s100, r.maxHp).ehp).toBeGreaterThan(ctx.surrogate(s0, r.maxHp).ehp)
    expect(ctx.statWeights().pushRes ?? 0).toBeGreaterThan(0)
    const { ctx: noPush } = contextOf('iop_terre_burst', vortexProxyOptions('killer', { noPush: true, melee: true }))
    expect(noPush.statWeights().pushRes ?? 0).toBe(0)
  })

  it('incomingByElement : somme ≈ dégâts reçus élémentaires de la forme fermée', () => {
    const { r, ctx } = contextOf('eniripsa_soin_feu', vortexProxyOptions('healer', { noPush: true }))
    const { byElement, constant } = ctx.incomingByElement(r.stats)
    const total = byElement.reduce((a, b) => a + b, 0) + constant
    expect(byElement.every(x => x >= 0)).toBe(true)
    expect(Math.abs(total - ctx.surrogate(r.stats, r.maxHp).incoming) / total).toBeLessThan(1e-6)
  })

  it('statWeightsAt : identique à statWeights au build de référence ; la Vitalité vaut moins quand les PV montent', () => {
    const { r, ctx } = contextOf('cra_feu_zone')
    expect(ctx.statWeightsAt(r.stats, r.maxHp)).toEqual(ctx.statWeights())
    const tanky = { ...r.stats, vitality: r.stats.vitality + 2000 }
    expect(ctx.statWeightsAt(tanky, r.maxHp + 2000).vitality!).toBeLessThan(ctx.statWeights().vitality!)
  })
})

describe('recherche : objets imposés / interdits, forgemagie re-planifiée', () => {
  const p = getPreset('cra_feu_zone')
  const m = presetMember(p, DATA)
  const passiveDofus = m.build.items.map(i => DATA.item(i.itemId)!).filter(it => it.slot === 'dofus' && hasPassive(it)).map(it => it.id)
  const proxy = vortexProxyOptions(p.role)

  it('les Dofus à passif imposés restent dans tous les builds rendus ; les objets interdits n\'y sont jamais', () => {
    expect(passiveDofus.length).toBeGreaterThanOrEqual(3)
    const banned = m.build.items.map(i => i.itemId).filter(id => DATA.item(id)!.slot === 'amulet')
    const r = optimizeStuff(DATA, m, { iterations: 600, sweeps: 2, topExact: 12, proxy, fixed: passiveDofus, exclude: banned, diversity: 4 })
    for (const c of [r.best, ...r.front]) {
      if (c.key === 'start') continue
      const ids = c.build.items.map(i => i.itemId)
      for (const id of passiveDofus) expect(ids, `${c.key}`).toContain(id)
      for (const id of banned) expect(ids).not.toContain(id)
      expect(computeBuildStats(c.build, DATA).valid).toBe(true)
    }
  })

  it('objet imposé inconnu ou sans place : erreur explicite', () => {
    expect(() => optimizeStuff(DATA, m, { iterations: 0, sweeps: 1, proxy, fixed: [999999999] })).toThrow(/inconnu/)
    const rings = DATA.itemsBySlot('ring', { minLevel: 190, maxLevel: 200 }).slice(0, 3).map(i => i.id)
    expect(() => optimizeStuff(DATA, m, { iterations: 0, sweeps: 1, proxy, fixed: rings })).toThrow(/plus de place/)
  })

  it('re-planification : le meilleur build n\'est jamais moins bon qu\'avec la forgemagie du recuit seule', () => {
    const opts = { iterations: 800, sweeps: 2, topExact: 12, proxy, seed: 3 }
    const a = optimizeStuff(DATA, m, { ...opts, replanForge: false })
    const b = optimizeStuff(DATA, m, opts)
    expect(b.best.score.logJ).toBeGreaterThanOrEqual(a.best.score.logJ - 1e-9)
    expect(computeBuildStats(b.best.build, DATA).valid).toBe(true)
    // Déterminisme.
    const c = optimizeStuff(DATA, m, opts)
    expect(c.best.key).toBe(b.best.key)
    expect(c.best.score.logJ).toBe(b.best.score.logJ)
  })
})

describe('presets dérivés (extends) et stuffs « build complet »', () => {
  it('un preset dérivé hérite de sa base (copies), erreurs explicites', () => {
    const base = getPreset('cra_feu_zone')
    const raw = [base, { id: 'cra_test', extends: 'cra_feu_zone', stuff: 'feu', label: 'test' } as Partial<Preset>]
    const [b, d] = resolvePresetExtends(raw)
    expect(b).toBe(base)
    expect(d.breedId).toBe(base.breedId)
    expect(d.variants).toEqual(base.variants)
    expect(d.variants).not.toBe(base.variants)
    expect(d.rotation).toEqual(base.rotation)
    expect(d.stuff).toBe('feu')
    expect(() => resolvePresetExtends([{ id: 'x', extends: 'nope' } as Partial<Preset>])).toThrow(/inconnue/)
    expect(() => resolvePresetExtends([base, { id: 'y', extends: 'cra_feu_zone', breedId: 8 } as Partial<Preset>])).toThrow(/classe différente/)
    expect(() => resolvePresetExtends([base, { id: 'y', extends: 'cra_feu_zone' } as Partial<Preset>, { id: 'z', extends: 'y' } as Partial<Preset>])).toThrow(/elle-même dérivée/)
  })

  it('presets dérivés du fichier : alias base@stuff (identifiant IA de la base), exclus des candidats de composition', () => {
    const derived = PRESETS.filter(p => p.extends)
    for (const d of derived) {
      expect(BASE_PRESETS).not.toContain(d)
      const base = getPreset(d.extends!)
      const m = presetMember(d, DATA)
      expect(m.presetId).toBe(base.id)
      expect(m.variants).toEqual(base.variants)
      const alias = parseTeam(`${base.id}@${d.stuff}`, DATA)[0]
      expect(alias.build).toEqual(m.build)
      const r = computeBuildStats(m.build, DATA)
      expect(r.valid, `${d.id} : ${r.warnings.join(' | ')}`).toBe(true)
      expect(r.issues.filter(i => i.severity === 'error')).toEqual([])
      expect(r.points.remaining).toBeGreaterThanOrEqual(0)
      expect(r.stats.ap).toBe(12)
      expect(r.stats.mp).toBe(6)
    }
  })

  it('un stuff qui porte ses points les impose (sinon points du preset)', () => {
    const withPoints = Object.entries(STUFFS).filter(([, s]) => s.points)
    for (const [id, s] of withPoints) {
      const preset = BASE_PRESETS.find(p => !s.breeds || s.breeds.includes(p.breedId))!
      expect(stuffPoints(preset, id)).toEqual(s.points)
      const b = presetBuild(preset, DATA, { stuff: id })
      expect(Object.values(b.characteristicPoints).reduce((a, x) => a + (x ?? 0), 0)).toBeGreaterThan(900)
    }
    const cra = getPreset('cra_feu_zone')
    expect(stuffPoints(cra, 'feu')).toEqual(cra.points)
  })
})

describe('vérification adverse des stuffs Vortex (docs/reports/vortex-stuffs.md § Vérification)', () => {
  const RECOMMENDED = 'cra_feu_vortex,enutrof_retrait_pm_vortex,iop_terre_vortex,eniripsa_soin_vortex'

  it('équipe recommandée : 4 membres de l\'équipe méta, PV / PA / PM / PO du rapport, identité IA des presets de base', () => {
    const team = parseTeam(RECOMMENDED, DATA)
    expect(team.map(m => m.presetId)).toEqual(['cra_feu_zone', 'enutrof_retrait_pm_eau', 'iop_terre_burst', 'eniripsa_soin_feu'])
    const got = team.map(m => {
      const r = computeBuildStats(m.build, DATA)
      expect(r.valid, `${m.name} : ${r.warnings.join(' | ')}`).toBe(true)
      expect(r.points).toEqual({ available: 995, spent: 995, remaining: 0 })
      return [r.maxHp, r.stats.ap, r.stats.mp, r.stats.range]
    })
    expect(got).toEqual([
      [4803, 12, 6, 6],
      [5745, 12, 6, 6],
      [4203, 12, 6, 2],
      [5745, 12, 6, 6],
    ])
  })

  it('stuffs vortex_* : classe du stuff = classe du preset dérivé, une ligne de forgemagie par objet, exo jamais sur une ligne native', () => {
    // Les 12 presets de la campagne de stuffs (la campagne de composition en ajoute d'autres : tests/opt-compo-vortex.test.ts).
    const derived = PRESETS.filter(p => p.extends && p.stuff.startsWith('vortex_') && p.source?.includes('vortex-stuffs.md'))
    expect(derived.length).toBe(12)
    for (const d of derived) {
      const tpl = STUFFS[d.stuff]
      expect(tpl.breeds, d.id).toContain(d.breedId)
      const once: Record<string, number> = {}
      for (const it of tpl.items) {
        const lines = it.exos ?? []
        expect(lines.length, `${d.id} ${it.itemId}`).toBeLessThanOrEqual(1)
        for (const l of lines) {
          if (l.kind === 'transcendence') continue
          expect(['ap', 'mp', 'range'], `${d.id} ${it.itemId}`).toContain(l.stat)
          once[l.stat] = (once[l.stat] ?? 0) + 1
          const item = DATA.item(it.itemId)!
          const native = item.effects.some(e => e.effectId === { ap: 111, mp: 128, range: 117 }[l.stat as 'ap' | 'mp' | 'range'])
          expect(native, `${d.id} : exo ${l.stat} sur ${item.name}, qui a déjà la ligne`).toBe(false)
        }
      }
      for (const [k, n] of Object.entries(once)) expect(n, `${d.id} exo ${k}`).toBe(1)
    }
  })
})
