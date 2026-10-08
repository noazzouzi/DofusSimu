/**
 * Cible du proxy construite depuis une fiche de boss (src/theorycraft/target.ts) : options explicites (`strictTargets`),
 * réduction à distance de Merkator, invulnérabilité à distance du Père Ver (coups au contact seulement), phases de Solar
 * dans les dégâts reçus, règle commune « au contact » (`playsMelee`), retrait sans valeur (utilité du rôle annulée),
 * sorts exclus d'une fiche manuelle et boss « à mi-vie » dans les dégâts reçus, cohérence avec le pic de la fiche.
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { bossProfile } from '../src/theorycraft/bossProfile'
import { parseBossOverrides } from '../src/theorycraft/overrides'
import { bossProxyOptions, incomingCoherence, meleeOnlyBoss, playsMelee, refHpOf } from '../src/theorycraft/target'
import { createProxyContext } from '../src/optimizer/stuff/proxy'
import { getPreset, presetMember } from '../src/optimizer/team/presets'
import { computeBuildStats } from '../src/stats/build'
import type { BossProfile } from '../src/theorycraft/types'

const data = loadDataStore()
const MERKATOR = 3534
const PERE_VER = 4726
const SOLAR = 5100
const HAREBOURG = 3416
const KLIME = 3384
const TAL_KASHA = 4744

function contextOf(presetId: string, profile: BossProfile, opts: { melee?: boolean } = {}) {
  const preset = getPreset(presetId)
  const member = presetMember(preset, data)
  const built = computeBuildStats(member.build, data)
  const target = bossProxyOptions(profile, { role: preset.role, ...opts })
  const ctx = createProxyContext(data, { breedId: member.build.breedId, level: member.build.level, variants: member.build.spellVariants ?? [], role: preset.role, presetId: preset.id, element: preset.element }, built, target.options)
  return { ctx, target, built }
}

function dptOf(presetId: string, monsterId: number): number {
  const { ctx, built } = contextOf(presetId, bossProfile(data, monsterId))
  return ctx.exact(built.stats, built.maxHp).dpt
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
    expect(options.theoryTable).toBe(true)
    expect(options.contact).toBeUndefined()
    const melee = bossProxyOptions(p, { role: 'killer', melee: true }).options
    expect(melee.rangeNeed).toBe(0)
    expect(melee.contact).toBe(true)
  })

  it('Père Ver (invulnérable à distance) : aucune phase ne laisse passer les dégâts à distance', () => {
    const { options } = bossProxyOptions(bossProfile(data, PERE_VER), { role: 'killer' })
    for (const t of options.targets!) expect(t.stats?.rangedResPct).toBe(100)
  })

  it('Solar : les phases qui frappent portent leurs états dans les dégâts reçus', () => {
    const { options } = bossProxyOptions(bossProfile(data, SOLAR), { role: 'killer' })
    expect(options.incoming!.some(t => (t.states?.length ?? 0) > 0)).toBe(true)
  })

  it('le proxy suit la cible : contre le Père Ver (mêlée seule), le Crâ ne garde que ses coups au contact', () => {
    // Flèche Tyrannique (PO 2 à 8) n'y compte plus ; ses flèches de PO 1 à N (règle du jeu, hits.ts) frappent au contact.
    const craVer = dptOf('cra_feu_zone', PERE_VER)
    const craHare = dptOf('cra_feu_zone', HAREBOURG)
    expect(craVer).toBeGreaterThan(0.5 * craHare)
    expect(craVer).toBeLessThan(craHare)
    expect(dptOf('iop_terre_burst', PERE_VER)).toBeGreaterThan(craVer)
  })

  it('« au contact » : règle unique de classes et stuff (boss attaquable seulement au contact, ou preset de mêlée)', () => {
    const ver = bossProfile(data, PERE_VER)
    const merk = bossProfile(data, MERKATOR)
    expect(meleeOnlyBoss(ver)).toBe(true)
    expect(meleeOnlyBoss(merk)).toBe(false)
    // Preset à distance contre un boss attaquable seulement au contact : au contact (Forgelance zone contre le Père Ver).
    expect(playsMelee(ver, 'forgelance_zone_terre')).toBe(true)
    expect(playsMelee(merk, 'forgelance_zone_terre')).toBe(false)
    // Preset de mêlée contre un boss attaquable à distance : au contact (Iop Terre, Ouginak, Pandawa Saoul contre Merkator).
    for (const id of ['iop_terre_burst', 'ouginak_eau_air', 'pandawa_saoul', 'sacrieur_sacrifice']) expect(playsMelee(merk, id), id).toBe(true)
    // Choix explicite prioritaire.
    expect(playsMelee(ver, 'forgelance_zone_terre', false)).toBe(false)
  })

  it('classe de contact : à égalité de la cible, ses sorts lançables au contact comptent en mêlée — % mêlée valorisés, pas % distance', () => {
    // Comte Harebourg : aucune asymétrie mêlée/distance. Sacrieur joué au contact (preset de mêlée).
    const hare = bossProfile(data, HAREBOURG)
    const { ctx } = contextOf('sacrieur_sacrifice', hare, { melee: playsMelee(hare, 'sacrieur_sacrifice') })
    const w = ctx.statWeights()
    expect(w.meleeDamagePct!).toBeGreaterThan(0)
    expect(w.meleeDamagePct!).toBeGreaterThan(w.rangedDamagePct ?? 0)
    // Le même personnage joué à distance valorise ses % distance.
    const { ctx: far } = contextOf('sacrieur_sacrifice', hare, { melee: false })
    expect(far.statWeights().rangedDamagePct!).toBeGreaterThan(far.statWeights().meleeDamagePct ?? 0)
  })

  it('retrait sans valeur contre ce boss : utilité du rôle annulée (c = 0) et avertissement — puni (Merkator) ou réserve absente (Père Ver)', () => {
    for (const [id, why] of [[MERKATOR, /punit le retrait de PM/], [PERE_VER, /n'a pas de PM/]] as const) {
      const t = bossProxyOptions(bossProfile(data, id), { role: 'mpLock' })
      expect(t.options.exponents!.c).toBe(0)
      expect(t.warnings.join(' ')).toMatch(why)
      expect(t.warnings.join(' ')).toMatch(/utilité du rôle ignorée/)
    }
    // Comte Harebourg (5 PM, retrait non puni) : utilité gardée, aucun avertissement ; retrait PA non concerné.
    const hare = bossProxyOptions(bossProfile(data, HAREBOURG), { role: 'mpLock' })
    expect(hare.options.exponents!.c).toBeGreaterThan(0)
    expect(hare.warnings).toEqual([])
    expect(bossProxyOptions(bossProfile(data, MERKATOR), { role: 'apLock' }).options.exponents!.c).toBeGreaterThan(0)
    // Dans le proxy : utilité du rôle 0.
    const { ctx, built } = contextOf('enutrof_retrait_pm_eau', bossProfile(data, PERE_VER))
    expect(ctx.exact(built.stats, built.maxHp).util).toBe(0)
  })

  it('dégâts reçus : sorts exclus d\'une fiche manuelle retirés des monstres qui frappent (comme le pic de la fiche)', () => {
    const plain = bossProfile(data, MERKATOR)
    const ov = parseBossOverrides({ version: 1, monsterId: MERKATOR, excludeSpells: [4010] })
    const fiche = bossProfile(data, MERKATOR, { overrides: ov })
    expect(fiche.phases[0].peakPerTurn).toBeLessThan(plain.phases[0].peakPerTurn)
    const a = contextOf('iop_soutien', plain)
    const b = contextOf('iop_soutien', fiche)
    expect(b.target.options.incoming![0].excludeSpells).toEqual([4010])
    const inc = (x: typeof a) => x.ctx.incomingByElement(x.built.stats).byElement
    expect(inc(b)).not.toEqual(inc(a))
    expect(b.ctx.exact(b.built.stats, b.built.maxHp).incoming).toBeLessThan(a.ctx.exact(a.built.stats, a.built.maxHp).incoming)
    // Cohérence : tour reçu sans défense = pic de la fiche, avec et sans la fiche.
    for (const x of [[plain, a], [fiche, b]] as const) {
      const c = incomingCoherence(x[0], x[1].target, x[1].ctx.incomingUndefended(refHpOf(x[0])))!
      expect(c.ratio).toBeCloseTo(1, 2)
    }
  })

  it('dégâts reçus cohérents avec la fiche : boss « à mi-vie », poisons comptés comme elle (Klime) ; écart chiffré sinon (Tal Kasha)', () => {
    // Klime : Moustacheron frappe en % des PV MANQUANTS du boss (0 à pleine vie), Cuir moustache est un poison de 3 tours.
    const klime = bossProfile(data, KLIME)
    const k = contextOf('iop_soutien', klime)
    expect(k.target.options.incoming!.every(t => t.hpShare === 0.5)).toBe(true)
    const ck = incomingCoherence(klime, k.target, k.ctx.incomingUndefended(refHpOf(klime)))!
    expect(ck.fiche).toBeCloseTo(klime.phases[0].peakPerTurn, 6)
    expect(Math.abs(ck.ratio - 1)).toBeLessThan(0.03)
    expect(ck.warning).toBeUndefined()
    // Tal Kasha : la moitié de ses sorts frappe par un sous-sort que le profil de sort du proxy ne suit pas — signalé.
    const tal = bossProfile(data, TAL_KASHA)
    const t = contextOf('iop_soutien', tal)
    const ct = incomingCoherence(tal, t.target, t.ctx.incomingUndefended(refHpOf(tal)))!
    expect(ct.ratio).toBeLessThan(0.8)
    expect(ct.warning).toMatch(/Dégâts reçus : le proxy de stuff .* sans défense, contre .* au pic de la fiche du boss \(×0,\d\d/)
  })
})
