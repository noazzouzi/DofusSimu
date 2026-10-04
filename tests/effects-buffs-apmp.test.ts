/**
 * Famille « buffs » — PA/PM : retraits esquivables (1079/1080) avec statistiques d'esquive (jets seedés comparés à la
 * distribution exacte de src/damage/apmp.ts), espérance en mode 'average', vols (77), retraits non esquivables (169),
 * « Rembourse » (120), déclencheurs MPA / CMPA / CMPAS et métriques — sorts réels Enutrof, Xélor, Crâ, Iop, Buboxor.
 */
import { describe, expect, it } from 'vitest'
import { apMpRemovalDistribution, expectedApMpRemoved } from '../src/damage/apmp'
import { castSpell } from '../src/engine/cast'
import { apply, cellAt, data, effect, fight, monster, newEngine, player, turnOf } from './effects-buffs-helpers'

const MALADRESSE = 13337 // Enutrof : −2 PM esquivables (1080), 1 PA, PO 1-12
const ABATTEMENT = 13365 // Enutrof : −2 PA esquivables (1079) + dommages Air
const IMMOBILISATION = 32436 // Crâ : vole 1 PM (77) + dommages Eau + 293 sur soi
const EMPRISE = 13141 // Iop : −100 PM non esquivables (169) + Invulnérable
const HOXOR = 5028 // Buboxor : vole 2 PM (77)
const HORLOGE = 13256 // Xélor : −2 PA esquivables (1079) + dommages Terre
const INJECTION = 12940 // Sram : −1 PM esquivable (1080) pendant 3 tours, cumul 2 + poison

function setup(opts: { removal?: number; dodge?: number; rollMode?: 'random' | 'average'; seed?: number } = {}) {
  const engine = newEngine()
  const enu = player({
    name: 'Enutrof',
    breedId: 3,
    spellIds: [MALADRESSE, ABATTEMENT],
    cell: cellAt(5, 0),
    stats: { initiative: 1000, mpReduction: opts.removal ?? 40, apReduction: opts.removal ?? 40 },
  })
  const foe = player({
    name: 'Cible',
    breedId: 8,
    spellIds: [],
    team: 1,
    cell: cellAt(9, 0),
    stats: { initiative: 10, mpParry: opts.dodge ?? 60, apParry: opts.dodge ?? 60 },
  })
  const fs = fight(engine, [enu, foe], { rollMode: opts.rollMode ?? 'random', seed: opts.seed ?? 1 })
  turnOf(engine, fs, enu)
  return { engine, fs, enu, foe }
}

describe('retrait de PM esquivable (1080, Maladresse)', () => {
  it('les jets seedés suivent la distribution exacte de l’esquive (R 40 / E 60, 6 PM, −2)', () => {
    const { engine, fs, enu, foe } = setup()
    const N = 4000
    const hist = [0, 0, 0]
    let total = 0
    for (let i = 0; i < N; i++) {
      const c = engine.cloneFight(fs)
      c.rngState = (i * 2654435761) | 0
      const caster = c.fighters[enu.id]
      const target = c.fighters[foe.id]
      expect(castSpell(engine, c, caster, MALADRESSE, target.cell).ok).toBe(true)
      const removed = 6 - target.stats.mp
      hist[removed]++
      total += removed
      expect(c.metrics[caster.id].mpRemoved).toBe(removed)
    }
    const dist = apMpRemovalDistribution(40, 60, 6, 6, 2)
    for (let k = 0; k <= 2; k++) expect(hist[k] / N).toBeCloseTo(dist[k], 1)
    expect(total / N).toBeCloseTo(expectedApMpRemoved(40, 60, 6, 6, 2), 1)
    // P(1er point) = 6/6 × 40/60 / 2 = 1/3 : la probabilité « aucun retrait » est ≈ (2/3)².
    expect(hist[0] / N).toBeGreaterThan(0.4)
  })

  it("mode 'average' : le débuff vaut exactement l'espérance (non entière) et la métrique aussi", () => {
    const { engine, fs, enu, foe } = setup({ rollMode: 'average' })
    expect(castSpell(engine, fs, enu, MALADRESSE, foe.cell).ok).toBe(true)
    const expected = expectedApMpRemoved(40, 60, 6, 6, 2)
    expect(6 - foe.stats.mp).toBeCloseTo(expected, 10)
    expect(fs.metrics[enu.id].mpRemoved).toBeCloseTo(expected, 10)
  })

  it('retrait sur la cible qui joue : ses PM courants baissent immédiatement, puis le débuff expire', () => {
    const { engine, fs, enu, foe } = setup({ removal: 5000, dodge: 1 })
    turnOf(engine, fs, foe) // la cible joue (castSpell ne vérifie pas le tour du lanceur)
    expect(foe.mp).toBe(6)
    castSpell(engine, fs, enu, MALADRESSE, foe.cell)
    const lost = 6 - foe.stats.mp
    expect(lost).toBeGreaterThan(0)
    expect(foe.mp).toBe(6 - lost)
    turnOf(engine, fs, enu) // début du tour du lanceur : fin du débuff (durée 1)
    expect(foe.stats.mp).toBe(6)
    expect(foe.buffs.some(b => b.effect.effectId === 1080)).toBe(false)
  })

  it('déclencheurs : MPA sur la cible, CMPA (tentative) et CMPAS (réussite) sur le lanceur', () => {
    const { engine, fs, enu, foe } = setup({ removal: 5000, dodge: 1 })
    // Buffs déclencheurs synthétiques posés par le noyau : état 74 (Zombi) au porteur sur l'événement.
    apply(engine, fs, foe, foe, [effect(950, { triggers: 'MPA', value: 74, duration: 1, triggerDuration: 2, targetMask: 'a' })])
    apply(engine, fs, enu, enu, [effect(950, { triggers: 'CMPA', value: 74, duration: 1, triggerDuration: 2, targetMask: 'a' })])
    apply(engine, fs, enu, enu, [effect(950, { triggers: 'CMPAS', value: 76, duration: 1, triggerDuration: 2, targetMask: 'a' })])
    expect(foe.states).not.toContain(74)
    castSpell(engine, fs, enu, MALADRESSE, foe.cell)
    expect(foe.states).toContain(74)
    expect(enu.states).toContain(74)
    expect(enu.states).toContain(76) // ≥ 1 PM retiré à 90 % par point : réussite quasi certaine avec la graine 1
  })

  it("un état « insensible aux pertes de PM » (effet d'état 30) annule le retrait", () => {
    const { engine, fs, enu, foe } = setup({ removal: 5000, dodge: 1 })
    // Recherche d'un état réel portant l'effet d'état 30 (InvulnerableToLostMp).
    let immune = 0
    for (let id = 1; id < 8000 && !immune; id++) if (data().state(id)?.effectsIds?.includes(30)) immune = id
    expect(immune).toBeGreaterThan(0)
    apply(engine, fs, foe, foe, [effect(950, { value: immune, duration: 2, targetMask: 'a' })])
    castSpell(engine, fs, enu, MALADRESSE, foe.cell)
    expect(foe.stats.mp).toBe(6)
    expect(fs.metrics[enu.id].mpRemoved).toBe(0)
  })
})

describe('retrait de PA esquivable (1079, Abattement)', () => {
  it('retire des PA pour la durée (débuff dispellable 3 : insensible au désenvoûtement normal)', () => {
    const { engine, fs, enu, foe } = setup({ removal: 5000, dodge: 1, seed: 3 })
    castSpell(engine, fs, enu, ABATTEMENT, foe.cell)
    const debuff = foe.buffs.find(b => b.effect.effectId === 1079)!
    expect(debuff).toBeDefined()
    expect(debuff.value).toBe(foe.stats.ap - 12)
    expect(debuff.dispellable).toBe(false) // dispellable 3 dans les données
    apply(engine, fs, enu, foe, [effect(132)])
    expect(foe.buffs.includes(debuff)).toBe(true)
    expect(fs.metrics[enu.id].apRemoved).toBe(-debuff.value)
  })
})

describe('vols de PM (77)', () => {
  it('Flèche d’Immobilisation : le Crâ gagne pour le tour les PM effectivement retirés', () => {
    const engine = newEngine()
    const cra = player({ name: 'Crâ', breedId: 9, spellIds: [IMMOBILISATION], cell: cellAt(5, 0), stats: { initiative: 1000, mpReduction: 5000 } })
    const foe = player({ name: 'Cible', breedId: 8, spellIds: [], team: 1, cell: cellAt(8, 0), stats: { mpParry: 1 } })
    const fs = fight(engine, [cra, foe], { seed: 5 })
    turnOf(engine, fs, cra)
    expect(castSpell(engine, fs, cra, IMMOBILISATION, foe.cell).ok).toBe(true)
    const lost = 6 - foe.stats.mp
    expect(cra.stats.mp).toBe(6 + lost)
    expect(cra.mp).toBe(6 + lost) // gain utilisable tout de suite
    if (lost > 0) expect(cra.buffs.some(b => b.effect.effectId === 77 && b.value === lost)).toBe(true)
    turnOf(engine, fs, cra) // durée 1 : le gain disparaît au tour suivant du Crâ
    expect(cra.stats.mp).toBe(6)
    expect(cra.mp).toBe(6)
  })

  it("Hoxor (Buboxor, Œil de Vortex) en mode 'average' : vol = espérance du retrait", () => {
    const engine = newEngine()
    const bub = monster(3838, cellAt(5, 0), { initiative: 100000 })
    const foe = player({ name: 'Cible', breedId: 8, spellIds: [], team: 0, cell: cellAt(7, 0), stats: { mpParry: 30 } })
    const fs = fight(engine, [bub, foe], { rollMode: 'average' })
    turnOf(engine, fs, bub)
    expect(castSpell(engine, fs, bub, HOXOR, foe.cell).ok).toBe(true)
    const expected = expectedApMpRemoved(bub.stats.mpReduction, 30, 6, 6, 2)
    expect(6 - foe.stats.mp).toBeCloseTo(expected, 10)
    expect(bub.stats.mp - bub.baseStats.mp).toBeCloseTo(expected, 10)
  })
})

describe('retraits non esquivables (169) et Rembourse (120)', () => {
  it('Emprise (Iop) : −100 PM (immobilisation) sur 1 tour, sans PM « rendus » en trop à la fin', () => {
    const engine = newEngine()
    const iop = player({ name: 'Iop', breedId: 8, spellIds: [EMPRISE], cell: cellAt(5, 0), stats: { initiative: 1000 } })
    const foe = player({ name: 'Cible', breedId: 3, spellIds: [], team: 1, cell: cellAt(6, 0) })
    const fs = fight(engine, [iop, foe])
    turnOf(engine, fs, iop)
    expect(castSpell(engine, fs, iop, EMPRISE, foe.cell).ok).toBe(true)
    expect(foe.stats.mp).toBe(-94)
    expect(fs.metrics[iop.id].mpRemoved).toBe(6) // effet réel borné aux PM disponibles
    turnOf(engine, fs, foe)
    expect(foe.mp).toBe(0)
    // Désenvoûtement fort en plein tour : la fin du malus rend 6 PM, pas 100.
    const debuff = foe.buffs.find(b => b.effect.effectId === 169)!
    engine.removeBuff(fs, foe, debuff.uid)
    expect(foe.mp).toBe(6)
  })

  it('120 « Rembourse X PA » : PA rendus immédiatement, sans buff', () => {
    const engine = newEngine()
    const a = player({ breedId: 12, spellIds: [], cell: cellAt(5, 0), stats: { initiative: 1000 } })
    const b = player({ breedId: 3, spellIds: [], team: 1, cell: cellAt(9, 0) })
    const fs = fight(engine, [a, b])
    turnOf(engine, fs, a)
    a.ap = 3
    apply(engine, fs, a, a, [effect(120, { diceNum: 2, targetMask: 'C' })])
    expect(a.ap).toBe(5)
    expect(a.buffs.length).toBe(0)
  })
})

describe('statistiques d’esquive : Xélor (cible en train de jouer) et Sram (débuff 3 tours)', () => {
  it('Horloge (Xélor) sur une cible qui a déjà dépensé 6 PA sur 12 : dénominateur = PA max', () => {
    const engine = newEngine()
    const xel = player({ name: 'Xélor', breedId: 5, spellIds: [HORLOGE], cell: cellAt(5, 0), stats: { initiative: 1000, apReduction: 100, critical: -1000 } })
    const foe = player({ name: 'Cible', breedId: 8, spellIds: [], team: 1, cell: cellAt(8, 0), stats: { apParry: 50 } })
    const fs = fight(engine, [xel, foe], { record: false })
    turnOf(engine, fs, foe)
    foe.ap = 6 // la cible joue et a dépensé 6 PA
    const N = 4000
    const hist = [0, 0, 0]
    for (let i = 0; i < N; i++) {
      const c = engine.cloneFight(fs)
      c.rngState = (i * 2246822519 + 7) | 0
      expect(castSpell(engine, c, c.fighters[xel.id], HORLOGE, foe.cell).ok).toBe(true)
      const t = c.fighters[foe.id]
      const removed = 12 - t.stats.ap
      expect(t.ap).toBe(6 - removed)
      hist[removed]++
    }
    const dist = apMpRemovalDistribution(100, 50, 6, 12, 2)
    for (let k = 0; k <= 2; k++) expect(hist[k] / N).toBeCloseTo(dist[k], 1)
    // Comparaison : avec le total (12/12) au lieu des PA restants, P(0) serait bien plus faible.
    expect(dist[0]).toBeGreaterThan(apMpRemovalDistribution(100, 50, 12, 12, 2)[0] + 0.1)
  })

  it('Injection Toxique (Sram) : −1 PM esquivable 3 tours, cumul 2 (3ᵉ lancer : le plus ancien saute)', () => {
    const engine = newEngine()
    const sram = player({ name: 'Sram', breedId: 4, spellIds: [INJECTION], cell: cellAt(5, 0), stats: { initiative: 1000, mpReduction: 30, critical: -1000, ap: 50 } })
    const foe = player({ name: 'Cible', breedId: 8, spellIds: [], team: 1, cell: cellAt(8, 0), stats: { mpParry: 30 } })
    const fs = fight(engine, [sram, foe], { record: false })
    turnOf(engine, fs, sram)
    const N = 4000
    let total = 0
    for (let i = 0; i < N; i++) {
      const c = engine.cloneFight(fs)
      c.rngState = (i * 1597334677 + 11) | 0
      castSpell(engine, c, c.fighters[sram.id], INJECTION, foe.cell)
      total += 6 - c.fighters[foe.id].stats.mp
    }
    expect(total / N).toBeCloseTo(expectedApMpRemoved(30, 30, 6, 6, 1), 1) // = 0,5
    // Cumul : en mode espérance, 3 lancers (relance ignorée) ⇒ 2 débuffs au plus.
    const avg = engine.cloneFight(fs)
    avg.options.rollMode = 'average'
    const s = avg.fighters[sram.id]
    const t = avg.fighters[foe.id]
    for (let k = 0; k < 3; k++) {
      s.cooldowns = {}
      expect(castSpell(engine, avg, s, INJECTION, t.cell).ok).toBe(true)
    }
    const debuffs = t.buffs.filter(b => b.effect.effectId === 1080)
    expect(debuffs).toHaveLength(2)
    expect(debuffs.every(b => b.remaining === 3)).toBe(true)
  })
})
