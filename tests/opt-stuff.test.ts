/**
 * WP4b — optimiseur de stuff (docs/design/ai.md §15.4) sur données réelles (data/dofusdb, presets réels) :
 * fidélité de la forme fermée du proxy, viviers, forgemagie (exos utiles uniquement, un seul PA/PM/PO), points,
 * recherche (amélioration du proxy, validité des builds, déterminisme).
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '../src/core/rng'
import { loadDataStore } from '../src/data/node'
import { computeBuildStats, type CharacterBuild } from '../src/stats/build'
import { allocateAll } from '../src/stats/characteristicPoints'
import { detExp, detLog, detPow, normal01, roundSig } from '../src/optimizer/stuff/detmath'
import { canHostExo, ForgePlanner, planForgemagie } from '../src/optimizer/stuff/exos'
import { pointsOptions } from '../src/optimizer/stuff/points'
import { buildPools, itemStatDelta, STUFF_POSITIONS, STUFF_SLOTS } from '../src/optimizer/stuff/pools'
import { createProxyContext, ROLE_EXPONENTS } from '../src/optimizer/stuff/proxy'
import { evaluateStuff, optimizeStuff } from '../src/optimizer/stuff/search'
import { STAT_ORDER } from '../src/stats/fastStats'
import { getPreset, presetMember, STUFFS } from '../src/optimizer/team/presets'

const DATA = loadDataStore('data')

function contextOf(presetId: string) {
  const p = getPreset(presetId)
  const m = presetMember(p, DATA)
  const r = computeBuildStats(m.build, DATA)
  const ctx = createProxyContext(DATA, { breedId: p.breedId, level: 200, variants: p.variants, role: p.role, presetId: p.id, element: p.element }, r)
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

describe('mathématiques déterministes', () => {
  it('detLog / detPow / roundSig / normal01', () => {
    for (const x of [1e-9, 0.3, 1, 2, Math.E, 10, 12345.678, 1e12]) expect(Math.abs(detLog(x) - Math.log(x))).toBeLessThan(1e-12 * Math.max(1, Math.abs(Math.log(x))))
    expect(detLog(0)).toBe(-Infinity)
    expect(Number.isNaN(detLog(-1))).toBe(true)
    expect(Math.abs(detPow(2, 10) - 1024)).toBeLessThan(1e-9)
    expect(Math.abs(detExp(detLog(7.5)) - 7.5)).toBeLessThan(1e-12)
    expect(roundSig(0.123456, 4)).toBe(0.1235)
    expect(roundSig(1234567, 3)).toBe(1230000)
    expect(roundSig(-0.30000000000000004, 4)).toBe(-0.3)
    const rng = new Rng(5)
    const xs = Array.from({ length: 4000 }, () => normal01(rng))
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length
    expect(Math.abs(m)).toBeLessThan(0.06)
    expect(Math.abs(v - 1)).toBeLessThan(0.08)
  })
})

describe('proxy J (DPT^a · EHP^b · (1 + c·UTIL) × pénalités)', () => {
  it('exposants par rôle conformes au design', () => {
    expect(ROLE_EXPONENTS.killer).toEqual({ a: 0.7, b: 0.3, c: 0 })
    expect(ROLE_EXPONENTS.tank).toEqual({ a: 0.2, b: 0.8, c: 0.2 })
    expect(ROLE_EXPONENTS.mpLock).toEqual({ a: 0.3, b: 0.4, c: 1 })
    expect(ROLE_EXPONENTS.healer).toEqual({ a: 0.2, b: 0.5, c: 1 })
  })

  it('forme fermée ≈ évaluation exacte (DptTable) : corrélation ≥ 0,95 sur 60 stuffs aléatoires réels', () => {
    for (const id of ['cra_feu_zone', 'enutrof_retrait_pm_eau']) {
      const { m, ctx } = contextOf(id)
      const pools = buildPools(DATA, ctx, { reference: m.build, perSlot: 20 })
      const rng = new Rng(42)
      const sur: number[] = []
      const ex: number[] = []
      for (let k = 0; k < 2000 && sur.length < 60; k++) {
        // Stuff aléatoire : un objet par position, au plus une prysmaradite, pas de doublon.
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
        const r = computeBuildStats(build, DATA)
        if (!r.valid) continue
        sur.push(ctx.surrogate(r.stats, r.maxHp).logJ)
        ex.push(ctx.exact(r.stats, r.maxHp).logJ)
      }
      expect(sur.length).toBeGreaterThanOrEqual(40)
      expect(corr(sur, ex)).toBeGreaterThan(0.95)
      // Écart absolu moyen faible (forme fermée sans troncatures, rotations figées).
      const mae = sur.reduce((a, s, i) => a + Math.abs(s - ex[i]), 0) / sur.length
      expect(mae).toBeLessThan(0.05)
    }
  })

  it('monotonie : plus de caractéristique principale ⇒ DPT ↑ ; plus de résistances ⇒ EHP ↑ ; PA sous 12 ⇒ pénalité', () => {
    const { r, ctx } = contextOf('cra_feu_zone')
    const base = ctx.surrogate(r.stats, r.maxHp)
    const more = ctx.surrogate({ ...r.stats, intelligence: r.stats.intelligence + 200 }, r.maxHp)
    expect(more.dpt).toBeGreaterThan(base.dpt)
    const tough = ctx.surrogate({ ...r.stats, earthResPct: r.stats.earthResPct + 20, fireResPct: r.stats.fireResPct + 20, waterResPct: r.stats.waterResPct + 20, airResPct: r.stats.airResPct + 20, neutralResPct: r.stats.neutralResPct + 20 }, r.maxHp)
    expect(tough.ehp).toBeGreaterThan(base.ehp)
    const lowAp = ctx.surrogate({ ...r.stats, ap: 10 }, r.maxHp)
    expect(lowAp.penalty).toBeCloseTo(0.85 * 0.85, 10)
    expect(lowAp.logJ).toBeLessThan(base.logJ)
  })

  it('UTIL : retrait PM du mpLock et soins du healer sont positifs et croissent avec leurs caractéristiques', () => {
    const enu = contextOf('enutrof_retrait_pm_eau')
    // À 4 PA (peu de tentatives), le retrait espéré croît avec la caractéristique Retrait PM.
    const u0 = enu.ctx.utility({ ...enu.r.stats, ap: 4, mpReduction: 0 })
    const u1 = enu.ctx.utility({ ...enu.r.stats, ap: 4, mpReduction: 200 })
    expect(u0).toBeGreaterThan(0)
    expect(u1).toBeGreaterThan(u0)
    expect(enu.ctx.utility(enu.r.stats)).toBeLessThanOrEqual(1)
    const eni = contextOf('eniripsa_soin_feu')
    expect(eni.ctx.healPerTurn(eni.r.stats)).toBeGreaterThan(0)
    expect(eni.ctx.healPerTurn({ ...eni.r.stats, intelligence: eni.r.stats.intelligence + 300 })).toBeGreaterThan(eni.ctx.healPerTurn(eni.r.stats))
  })
})

describe('viviers et forgemagie', () => {
  it('viviers : niveaux, emplacements, objets de départ inclus, panoplies, passifs signalés', () => {
    const { m, ctx } = contextOf('iop_terre_burst')
    const pools = buildPools(DATA, ctx, { reference: m.build, include: m.build.items.map(i => i.itemId) })
    for (const slot of STUFF_SLOTS) {
      expect(pools.bySlot[slot].length).toBeGreaterThan(0)
      for (const p of pools.bySlot[slot]) {
        expect(p.item.slot).toBe(slot)
        expect(p.item.level).toBeLessThanOrEqual(200)
        if (slot !== 'dofus' && slot !== 'pet' && !m.build.items.some(i => i.itemId === p.item.id)) expect(p.item.level).toBeGreaterThanOrEqual(180)
      }
    }
    for (const it of m.build.items) {
      const item = DATA.item(it.itemId)!
      expect(pools.bySlot[item.slot].some(p => p.item.id === it.itemId)).toBe(true)
    }
    expect(pools.setBlocks.length).toBeGreaterThan(0)
    for (const b of pools.setBlocks) expect(b.items.length).toBeGreaterThanOrEqual(2)
    // Dofus Ocre (passif 1175) : signalé, non exclu par défaut ; exclu par la politique 'exclude'.
    const ocre = pools.bySlot.dofus.find(p => p.item.id === 7754)
    expect(ocre?.passive).toBe(true)
    const strict = buildPools(DATA, ctx, { reference: m.build, passivePolicy: 'exclude' })
    expect(strict.bySlot.dofus.every(p => !p.passive || m.build.items.some(i => i.itemId === p.item.id))).toBe(true)
    expect(itemStatDelta(DATA.item(7754)!).ap).toBe(1)
  })

  it('exos : utiles seulement (PA < 12, PM < 6, PO si elle compte), un seul de chaque, hôtes typiques sans la ligne', () => {
    const items = STUFFS.terre.items.map(i => DATA.item(i.itemId)!)
    const weights = { range: 0.01, spellDamagePct: 0.01, vitality: 0.0001, strength: 0.001 }
    const lowStats = { ...computeBuildStats({ name: 'x', breedId: 8, level: 200, characteristicPoints: {}, scrolls: {}, items: [] }, DATA).stats, ap: 11, mp: 5, range: 4 }
    const plan = planForgemagie(items, lowStats, { profile: 'thlOptimized', weights })
    expect(Object.keys(plan.exos).sort()).toEqual(['ap', 'mp', 'range'])
    for (const [stat, pos] of Object.entries(plan.exos)) expect(canHostExo(items[pos!], stat as 'ap')).toBe(true)
    expect(new Set(Object.values(plan.exos)).size).toBe(3)
    expect(plan.transcendences.length).toBeLessThanOrEqual(6)
    for (const t of plan.transcendences) expect(Object.values(plan.exos)).not.toContain(t.position)
    // Plafonds atteints : aucun exo inutile.
    const capped = planForgemagie(items, { ...lowStats, ap: 12, mp: 6, range: 6 }, { profile: 'thlOptimized', weights })
    expect(Object.keys(capped.exos)).toEqual([])
    // thlStandard : un seul exo (PA d'abord).
    const std = new ForgePlanner({ profile: 'thlStandard', weights }).plan(items, lowStats)
    expect(Object.keys(std.exos)).toEqual(['ap'])
    expect(std.transcendences.length).toBe(0)
    expect(planForgemagie(items, lowStats, { profile: 'none', weights }).lines.every(l => !l.length)).toBe(true)
  })

  it('points : répartitions candidates valides (≤ 995 points), variantes de rôle', () => {
    const breed = DATA.breed(3)
    const opts = pointsOptions(breed, 200, 'chance', 'mpLock', allocateAll(breed, 200, 'chance').points)
    expect(opts.map(o => o.id)).toContain('wisdom100')
    for (const o of opts) {
      const r = computeBuildStats({ name: 'x', breedId: 3, level: 200, characteristicPoints: o.points, scrolls: {}, items: [] }, DATA)
      expect(r.issues.filter(i => i.code === 'points' && i.severity === 'error')).toEqual([])
    }
    const tank = pointsOptions(DATA.breed(11), 200, 'strength', 'tank')
    expect(tank.map(o => o.id)).toEqual(expect.arrayContaining(['all', 'cap300', 'cap100', 'vitality']))
  })
})

describe('recherche de stuff', () => {
  it('améliore le proxy exact du stuff du preset, builds valides, forgemagie conforme, déterministe', () => {
    for (const id of ['cra_feu_zone', 'eniripsa_soin_feu']) {
      const m = presetMember(getPreset(id), DATA)
      const r = optimizeStuff(DATA, m, { iterations: 600, seed: 7, perSlot: 16, dofusPool: 14, topExact: 20 })
      expect(r.best.score.logJ).toBeGreaterThan(r.start.score.logJ)
      const stats = computeBuildStats(r.best.build, DATA)
      expect(stats.valid).toBe(true)
      expect(stats.stats.ap).toBeLessThanOrEqual(12)
      expect(stats.stats.mp).toBeLessThanOrEqual(6)
      // Un seul exo PA/PM/PO compté, transcendances ≤ 6, une ligne de forgemagie par objet.
      const exos = r.best.build.items.flatMap(i => i.exos ?? [])
      for (const s of ['ap', 'mp', 'range']) expect(exos.filter(e => e.stat === s && e.kind !== 'transcendence').length).toBeLessThanOrEqual(1)
      expect(exos.filter(e => e.kind === 'transcendence').length).toBeLessThanOrEqual(6)
      expect(r.best.build.items.every(i => (i.exos?.length ?? 0) <= 1)).toBe(true)
      expect(stats.issues.filter(i => i.code === 'exoLimit')).toEqual([])
      // Front diversifié (≤ 5), meilleur en tête, tous valides.
      expect(r.front.length).toBeGreaterThan(0)
      expect(r.front.length).toBeLessThanOrEqual(5)
      for (const c of r.front) expect(computeBuildStats(c.build, DATA).valid).toBe(true)
      // Le score exact rapporté est bien celui du build rendu.
      const again = createProxyContext(DATA, { breedId: m.breedId, level: 200, variants: m.variants, role: r.role, presetId: m.presetId, element: r.element }, computeBuildStats(m.build, DATA))
      expect(again.exact(stats.stats, stats.maxHp).logJ).toBeCloseTo(r.best.score.logJ, 9)
      // Déterminisme (même graine ⇒ même build).
      const r2 = optimizeStuff(DATA, m, { iterations: 600, seed: 7, perSlot: 16, dofusPool: 14, topExact: 20 })
      expect(JSON.stringify(r2.best.build)).toBe(JSON.stringify(r.best.build))
    }
  }, 120_000)

  it('chemin rapide de la forgemagie = computeBuildStats (plafonds 2897 de panoplie compris) ; exo inutile non posé', () => {
    // Malédiction de Cire Momore (6 objets) : « PM/PO/invocations max 2 » porté par le BONUS de panoplie (aucun objet
    // n'a de ligne 2897). Régression : le chemin rapide ignorait ce plafond (6 PM crus au lieu de 2).
    const { p, m } = contextOf('sacrieur_tank')
    const cire = [27513, 27515, 27514, 27511, 27512, 27510].map(id => DATA.item(id)!)
    expect(cire.every(it => it.setId === 507)).toBe(true)
    const kept: { itemId: number }[] = []
    const replaced = new Set<string>()
    for (const eq of m.build.items) {
      const slot = DATA.item(eq.itemId)!.slot
      if (cire.some(c => c.slot === slot) && !replaced.has(slot)) {
        replaced.add(slot)
        continue
      }
      kept.push({ itemId: eq.itemId })
    }
    const build: CharacterBuild = { ...m.build, items: [...kept, ...cire.map(c => ({ itemId: c.id }))] }
    const ref = computeBuildStats(m.build, DATA)
    const ctx = createProxyContext(DATA, { breedId: p.breedId, level: 200, variants: p.variants, role: p.role, presetId: p.id, element: p.element }, ref)
    const e = evaluateStuff(DATA, ctx, build)
    expect(e.logJ).toBeGreaterThan(-Infinity)
    const full = computeBuildStats(e.build, DATA)
    expect(full.valid).toBe(true)
    expect(full.sets.find(x => x.setId === 507)?.tier).toBe(6)
    expect(full.stats.mp).toBeLessThanOrEqual(2)
    expect(e.stats!.mp).toBe(full.stats.mp)
    expect(e.stats!.range).toBe(full.stats.range)
    expect(e.maxHp).toBe(full.maxHp)
    // PM au-delà du plafond effectif : pas d'exo PM (il serait perdu).
    if (full.wasted.mp) expect(e.build.items.flatMap(i => i.exos ?? []).some(x => x.stat === 'mp' && x.kind !== 'transcendence')).toBe(false)
    expect(e.logJ).toBeCloseTo(ctx.surrogate(full.stats, full.maxHp).logJ, 9)

    // Propriété : stuffs aléatoires réels (viviers) — caractéristiques du chemin rapide = computeBuildStats du build forgé.
    const pools = buildPools(DATA, ctx, { reference: m.build, perSlot: 20, include: cire.map(c => c.id) })
    const rng = new Rng(9)
    let checked = 0
    for (let k = 0; k < 400 && checked < 40; k++) {
      const items: number[] = []
      for (const slot of STUFF_POSITIONS) {
        const list = pools.bySlot[slot]
        const it = list[rng.int(0, list.length - 1)]?.item
        if (it && !items.includes(it.id)) items.push(it.id)
      }
      const r = evaluateStuff(DATA, ctx, { ...m.build, items: items.map(itemId => ({ itemId })) })
      if (r.logJ === -Infinity) continue
      const f = computeBuildStats(r.build, DATA)
      expect(f.valid).toBe(true)
      for (const key of STAT_ORDER) expect(r.stats![key]).toBe(f.stats[key])
      expect(r.maxHp).toBe(f.maxHp)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(20)
  }, 120_000)

  it('scores rendus = proxy exact des caractéristiques de computeBuildStats (tank, toutes répartitions de points)', () => {
    const m = presetMember(getPreset('sacrieur_tank'), DATA)
    const r = optimizeStuff(DATA, m, { iterations: 800, seed: 1, perSlot: 16, dofusPool: 14, topExact: 20, diversity: 8 })
    const ctx = createProxyContext(DATA, { breedId: m.breedId, level: 200, variants: m.variants, role: r.role, presetId: m.presetId, element: r.element }, computeBuildStats(m.build, DATA))
    for (const c of [r.best, ...r.front]) {
      const f = computeBuildStats(c.build, DATA)
      expect(f.valid).toBe(true)
      expect(c.score.mp).toBe(f.stats.mp)
      expect(c.score.ap).toBe(f.stats.ap)
      expect(c.score.logJ).toBeCloseTo(ctx.exact(f.stats, f.maxHp).logJ, 9)
      expect(c.surrogate.logJ).toBeCloseTo(ctx.surrogate(f.stats, f.maxHp).logJ, 9)
    }
  }, 120_000)

  it('part d’un personnage nu : le stuff trouvé est nettement meilleur (DPT et EHP)', () => {
    const p = getPreset('iop_terre_burst')
    const naked = presetMember(p, DATA, { stuff: 'unstuffed' })
    const r = optimizeStuff(DATA, naked, { iterations: 300, seed: 3, perSlot: 12, dofusPool: 10, topExact: 10, points: false })
    expect(r.best.score.dpt).toBeGreaterThan(1.5 * r.start.score.dpt)
    expect(r.best.score.ehp).toBeGreaterThan(r.start.score.ehp)
    expect(r.best.build.items.length).toBeGreaterThanOrEqual(12)
  }, 120_000)
})
