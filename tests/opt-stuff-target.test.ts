/**
 * Cible explicite du proxy de stuff (docs/design/theorycraft.md §1.4, §4 bis) : caractéristiques imposées et états des
 * cibles (`ProxyTarget.stats`/`states`), `strictTargets`, cohérence exact / forme fermée avec surcharges, profils
 * d'exposants partagés (`applyProfile`), graines de la recherche (`seedFilter`, `theorySeedFilter`) et départ invalide
 * sous le niveau 200 (jamais rendu comme meilleur build, ni joué ni retenu par la validation par combats).
 */
import { describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai'
import { Rng } from '../src/core/rng'
import { loadDataStore } from '../src/data/node'
import { VORTEX_TARGET_MIX } from '../src/dungeons/generic/dummy'
import { createLocalPool } from '../src/optimizer/pool/pool'
import { buildPools, STUFF_POSITIONS } from '../src/optimizer/stuff/pools'
import { applyProfile, EXPONENT_PROFILES } from '../src/optimizer/stuff/profiles'
import { applyTargetOverrides, createProxyContext, ROLE_EXPONENTS, type ProxyOptions, type ProxyTarget } from '../src/optimizer/stuff/proxy'
import { optimizeStuff, theorySeedFilter } from '../src/optimizer/stuff/search'
import { validateStuffs } from '../src/optimizer/stuff/validate'
import type { FightSpec } from '../src/optimizer/types'
import { vortexProxyOptions } from '../src/optimizer/stuff/vortex'
import { getPreset, presetMember, STUFFS } from '../src/optimizer/team/presets'
import { createMonsterFighter } from '../src/engine/factory'
import { ROLE_IDS } from '../src/ai/types'
import { computeBuildStats, type CharacterBuild } from '../src/stats/build'

const data = loadDataStore()

const HAREBOURG = 3416
const SOLAR = 5100
const BOUFTOU_ROYAL = 147

function contextOf(presetId: string, opts: ProxyOptions) {
  const p = getPreset(presetId)
  const m = presetMember(p, data)
  const r = computeBuildStats(m.build, data)
  const ctx = createProxyContext(data, { breedId: p.breedId, level: 200, variants: p.variants, role: p.role, presetId: p.id, element: p.element }, r, opts)
  return { p, m, r, ctx }
}

/** Pearson. */
function corr(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / a.length
  const mb = b.reduce((x, y) => x + y, 0) / b.length
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  return sab / Math.sqrt(saa * sbb)
}

describe('cible explicite du proxy : caractéristiques imposées', () => {
  it('surcharges vides = cible de fabrique (nombres identiques, aucune révision posée)', () => {
    const plain = contextOf('cra_feu_zone', { targets: [{ monsterId: HAREBOURG, weight: 1, grade: 1 }] })
    const empty = contextOf('cra_feu_zone', { targets: [{ monsterId: HAREBOURG, weight: 1, grade: 1, stats: {}, states: [] }] })
    expect(empty.ctx.targets[0].rev).toBeUndefined()
    expect(empty.ctx.exact(empty.r.stats, empty.r.maxHp)).toEqual(plain.ctx.exact(plain.r.stats, plain.r.maxHp))
    expect(empty.ctx.surrogate(empty.r.stats, empty.r.maxHp)).toEqual(plain.ctx.surrogate(plain.r.stats, plain.r.maxHp))
  })

  it('rangedResPct 50 : un sort à distance perd la moitié de ses dégâts (exact et forme fermée) ; la mêlée est intacte', () => {
    const base = contextOf('cra_feu_zone', { targets: [{ monsterId: HAREBOURG, weight: 1, grade: 1 }] })
    const ranged = contextOf('cra_feu_zone', { targets: [{ monsterId: HAREBOURG, weight: 1, grade: 1, stats: { rangedResPct: 50 } }] })
    const melee = contextOf('cra_feu_zone', { targets: [{ monsterId: HAREBOURG, weight: 1, grade: 1, stats: { meleeResPct: 50 } }] })
    // Cibles réelle, qui frappe et synthétique : même valeur imposée.
    expect(ranged.ctx.targets[0].stats.rangedResPct).toBe(50)
    expect(ranged.ctx.incTargets[0].stats.rangedResPct).toBe(50)
    expect(ranged.ctx.mixTarget.stats.rangedResPct).toBe(50)
    // Un lancer de Flèche Tyrannique (PO 1-8, à distance) : × 0,5 aux arrondis près.
    const a = ranged.ctx.fighter
    const i = a.spells.findIndex(s => s.spellId === 32448)
    expect(i).toBeGreaterThanOrEqual(0)
    const full = base.ctx.dptTable.perCast(base.ctx.fighter, i, base.ctx.targets[0]).mean
    const half = ranged.ctx.dptTable.perCast(a, i, ranged.ctx.targets[0]).mean
    expect(full).toBeGreaterThan(0)
    expect(half / full).toBeGreaterThan(0.49)
    expect(half / full).toBeLessThan(0.51)
    // Crâ : tous ses sorts sont à distance ⇒ DPT du proxy ≈ moitié (exact ET forme fermée) ; la Ré mêlée ne change rien.
    const s0 = base.ctx.exact(base.r.stats, base.r.maxHp)
    const s1 = ranged.ctx.exact(ranged.r.stats, ranged.r.maxHp)
    expect(s1.dpt / s0.dpt).toBeGreaterThan(0.49)
    expect(s1.dpt / s0.dpt).toBeLessThan(0.51)
    const f0 = base.ctx.surrogate(base.r.stats, base.r.maxHp)
    const f1 = ranged.ctx.surrogate(ranged.r.stats, ranged.r.maxHp)
    expect(f1.dpt / f0.dpt).toBeGreaterThan(0.49)
    expect(f1.dpt / f0.dpt).toBeLessThan(0.51)
    expect(melee.ctx.exact(melee.r.stats, melee.r.maxHp).dpt).toBe(s0.dpt)
  })

  it('dérivées recalculées : Agilité → tacle/fuite/initiative, Sagesse → esquives et retraits ; dérivée imposée respectée', () => {
    const f = createMonsterFighter(data, { monsterId: HAREBOURG, grade: 1 })
    const before = { ...f.stats }
    applyTargetOverrides(f, { stats: { agility: before.agility + 100, wisdom: before.wisdom + 50, apParry: 7 } })
    expect(f.stats.agility).toBe(before.agility + 100)
    expect(f.stats.tackleBlock).toBe(before.tackleBlock + 10)
    expect(f.stats.tackleEvade).toBe(before.tackleEvade + 10)
    expect(f.stats.initiative).toBe(before.initiative + 100)
    expect(f.stats.mpParry).toBe(before.mpParry + 5)
    expect(f.stats.apReduction).toBe(before.apReduction + 5)
    expect(f.stats.apParry).toBe(7)
    expect(f.baseStats.mpParry).toBe(f.stats.mpParry)
    expect(f.rev).toBeDefined()
  })
})

describe('cible explicite du proxy : états et phases', () => {
  it('Solar (tous ses sorts exigent un état de phase) : dégâts reçus nuls sans état, > 0 avec un état de phase', () => {
    const none = contextOf('iop_terre_burst', { targets: [{ monsterId: SOLAR, weight: 1, grade: 1 }] })
    const s0 = none.ctx.exact(none.r.stats, none.r.maxHp)
    expect(s0.incoming).toBe(0)
    expect(s0.ehp).toBe(20 * none.r.maxHp)
    for (const state of [575, 576, 577, 578]) {
      const phase = contextOf('iop_terre_burst', { targets: [{ monsterId: SOLAR, weight: 1, grade: 1, states: [state] }] })
      expect(phase.ctx.targets[0].states).toEqual([state])
      const e = phase.ctx.exact(phase.r.stats, phase.r.maxHp)
      const s = phase.ctx.surrogate(phase.r.stats, phase.r.maxHp)
      expect(e.incoming).toBeGreaterThan(500)
      expect(s.incoming / e.incoming).toBeGreaterThan(0.95)
      expect(s.incoming / e.incoming).toBeLessThan(1.05)
      expect(e.ehp).toBeLessThan(20 * phase.r.maxHp)
    }
  })

  it('états imposés au mix des monstres qui frappent (`incoming`) distinct des cibles', () => {
    const { r, ctx } = contextOf('iop_terre_burst', {
      targets: [{ monsterId: SOLAR, weight: 1, grade: 1 }],
      incoming: [{ monsterId: SOLAR, weight: 1, grade: 1, states: [576] }],
    })
    expect(ctx.targets[0].states).toEqual([])
    expect(ctx.incTargets[0].states).toEqual([576])
    expect(ctx.exact(r.stats, r.maxHp).incoming).toBeGreaterThan(500)
  })
})

describe('strictTargets et défaut du Vortex', () => {
  it('sans `targets` : mix du Vortex (défaut historique) ; avec `strictTargets` : erreur explicite', () => {
    const { ctx } = contextOf('cra_feu_zone', {})
    expect(ctx.targets.map(f => f.monsterId)).toEqual(VORTEX_TARGET_MIX.map(t => t.monsterId))
    expect(() => contextOf('cra_feu_zone', { strictTargets: true })).toThrow(/strictTargets/)
    expect(() => contextOf('cra_feu_zone', { strictTargets: true, targets: [] })).toThrow(/cibles absentes/)
    expect(contextOf('cra_feu_zone', { strictTargets: true, targets: [{ monsterId: HAREBOURG, weight: 1 }] }).ctx.targets).toHaveLength(1)
  })
})

describe('forme fermée ≈ exact avec surcharges', () => {
  it('corrélation de logJ ≥ 0,95 sur des stuffs aléatoires (boss en phase, résistances et Ré distance imposées)', () => {
    const cases: [string, ProxyTarget][] = [
      ['cra_feu_zone', { monsterId: SOLAR, weight: 1, grade: 1, states: [576], stats: { fireResPct: 35, rangedResPct: 20 } }],
      ['iop_terre_burst', { monsterId: HAREBOURG, weight: 1, grade: 1, stats: { earthResPct: 10, meleeResPct: 15, finalDamagePct: 20 } }],
    ]
    for (const [presetId, target] of cases) {
      const { m, ctx } = contextOf(presetId, { targets: [target], strictTargets: true })
      const pools = buildPools(data, ctx, { reference: m.build, perSlot: 20 })
      const rng = new Rng(7)
      const sur: number[] = []
      const ex: number[] = []
      for (let k = 0; k < 2000 && sur.length < 60; k++) {
        const items: number[] = []
        let prysm = false
        for (const slot of STUFF_POSITIONS) {
          const list = pools.bySlot[slot]
          const it = list[rng.int(0, list.length - 1)]?.item
          if (!it || items.includes(it.id) || (it.typeId === 217 && prysm)) continue
          if (it.typeId === 217) prysm = true
          items.push(it.id)
        }
        const build: CharacterBuild = { ...m.build, items: items.map(itemId => ({ itemId })) }
        const r = computeBuildStats(build, data)
        if (!r.valid) continue
        sur.push(ctx.surrogate(r.stats, r.maxHp).logJ)
        ex.push(ctx.exact(r.stats, r.maxHp).logJ)
      }
      expect(sur.length).toBeGreaterThanOrEqual(40)
      expect(corr(sur, ex)).toBeGreaterThanOrEqual(0.95)
    }
  })
})

describe('profils d\'exposants partagés', () => {
  it('applyProfile = ancien calcul de vortexProxyOptions (a ± décalage, b ∓, plancher 0,05, c intact)', () => {
    for (const role of ROLE_IDS) {
      const e = ROLE_EXPONENTS[role]
      for (const profile of EXPONENT_PROFILES) {
        const da = profile === 'defensive' ? -0.2 : profile === 'offensive' ? 0.15 : 0
        const want = { a: Math.max(0.05, e.a + da), b: Math.max(0.05, e.b - da), c: e.c }
        expect(applyProfile(e, profile)).toEqual(want)
        expect(vortexProxyOptions(role, { profile }).exponents).toEqual(want)
      }
    }
    expect(() => applyProfile(ROLE_EXPONENTS.killer, 'brutal' as never)).toThrow(/Profil d'exposants inconnu/)
  })
})

describe('graines de la recherche et départ invalide', () => {
  it('theorySeedFilter : stuffs `vortex_*` exclus ; sous le niveau des objets, plus aucun stuff méta', () => {
    const at200 = theorySeedFilter({ level: 200 })
    const kept = Object.keys(STUFFS).filter(id => at200(id, STUFFS[id], data))
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.some(id => id.startsWith('vortex_'))).toBe(false)
    expect(kept.sort()).toEqual(Object.keys(STUFFS).filter(id => !id.startsWith('vortex_')).sort())
    const at150 = theorySeedFilter({ level: 150 })
    expect(Object.keys(STUFFS).filter(id => at150(id, STUFFS[id], data))).toEqual([])
    // Étiquettes de scénario réglables : sans étiquette, les stuffs `vortex_*` de niveau 200 sont gardés.
    const any = theorySeedFilter({ level: 200, scenarioTags: [] })
    expect(Object.keys(STUFFS).filter(id => any(id, STUFFS[id], data))).toHaveLength(Object.keys(STUFFS).length)
  })

  it('seedFilter : appelé pour chaque stuff méta, dans l\'ordre des identifiants', () => {
    const seen: string[] = []
    const m = presetMember(getPreset('iop_terre_burst'), data, { level: 60 })
    optimizeStuff(data, m, {
      iterations: 0,
      points: false,
      proxy: { targets: [{ monsterId: BOUFTOU_ROYAL, weight: 1, grade: 1 }], strictTargets: true },
      seedFilter: id => {
        seen.push(id)
        return false
      },
    })
    expect(seen).toEqual(Object.keys(STUFFS).sort())
  })

  it('niveau 60 contre le Bouftou Royal : départ (stuff de niveau 200) invalide ⇒ meilleur build = candidat valide', () => {
    const m = presetMember(getPreset('iop_terre_burst'), data, { level: 60 })
    const maxLevel = (b: CharacterBuild) => Math.max(0, ...b.items.map(i => data.item(i.itemId)!.level))
    const proxy = { targets: [{ monsterId: BOUFTOU_ROYAL, weight: 1, grade: 1 }], strictTargets: true }
    for (const opts of [{}, { seedFilter: theorySeedFilter({ level: 60 }) }]) {
      const r = optimizeStuff(data, m, { iterations: 0, proxy, ...opts })
      expect(r.startValid).toBe(false)
      expect(r.best).not.toBe(r.start)
      expect(computeBuildStats(r.best.build, data).valid).toBe(true)
      expect(maxLevel(r.best.build)).toBeLessThanOrEqual(60)
      // Le départ invalide se note mieux (objets de niveau 200) : c'était le bogue.
      expect(r.start.score.logJ).toBeGreaterThan(r.best.score.logJ)
      for (const c of r.front) expect(computeBuildStats(c.build, data).valid).toBe(true)
    }
  })

  it('validation par combats : un départ invalide n\'est ni joué (le moteur le refuse) ni retenu', async () => {
    const m = presetMember(getPreset('iop_terre_burst'), data, { level: 60 })
    const r = optimizeStuff(data, m, { iterations: 0, proxy: { targets: [{ monsterId: BOUFTOU_ROYAL, weight: 1, grade: 1 }], strictTargets: true }, seedFilter: theorySeedFilter({ level: 60 }) })
    expect(r.startValid).toBe(false)
    const cands = r.front.filter(c => c.key !== 'start')
    expect(cands.length).toBeGreaterThan(1)
    // Petit combat de contrôle réel (1 graine, fil courant) : la référence de la validation est le membre de l'équipe.
    const spec: FightSpec = { scenarioId: 'control:143393281:3834', team: [m], mode: 'scripted', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
    const pool = createLocalPool(data)
    try {
      // Sans l'option : le départ est joué en premier et le moteur refuse le build (runner.ts, `buildTeam`).
      await expect(validateStuffs(spec, 0, cands, pool, { seeds: 1, kinds: ['full'] })).rejects.toThrow(/Build invalide/)
      const v = await validateStuffs(spec, 0, cands, pool, { seeds: 1, kinds: ['full'], startValid: r.startValid })
      expect(v.startIncluded).toBe(false)
      expect(v.builds).toEqual(cands.map(c => c.build))
      expect(v.objectives).toHaveLength(cands.length)
      for (const b of v.builds) expect(computeBuildStats(b, data).valid).toBe(true)
      // Référence = premier candidat (le meilleur du proxy) ; le build retenu est un candidat.
      expect(cands[0]).toBe(r.best)
      expect(v.paired[0].diff).toBe(0)
      expect(v.chosen).toBeGreaterThanOrEqual(0)
      expect(v.chosen).toBeLessThan(cands.length)
      for (let i = 1; i < v.builds.length; i++) if (v.paired[i].diff > 0) expect(v.objectives[v.chosen]).toBeGreaterThanOrEqual(v.objectives[i])
      await expect(validateStuffs(spec, 0, [], pool, { seeds: 1, kinds: ['full'], startValid: false })).rejects.toThrow(/aucun candidat valide/)
    } finally {
      await pool.close()
    }
  })
})
