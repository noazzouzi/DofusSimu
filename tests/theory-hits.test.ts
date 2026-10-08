/**
 * Theorycraft — coups au contact ou à distance et table DPT du theorycraft (src/theorycraft/hits.ts) : règle du jeu (un
 * coup est de mêlée dès que la cible est adjacente, quelle que soit la portée du sort), choix du coup par la cible
 * (Merkator « −50 % à distance », Père Ver vulnérable en mêlée seule), style du personnage à égalité, table de l'IA
 * inchangée, décomposition d'un lancer (part immédiate, poisons : cumul du niveau qui porte l'effet), conventions de la
 * fiche du boss pour les sorts d'un monstre (Klime : poison compté une fois par tour de durée).
 */
import { describe, expect, it } from 'vitest'
import { castDamage, createDptTable } from '../src/ai/core/dpt'
import { loadDataStore } from '../src/data/node'
import { getPreset, presetMember } from '../src/optimizer/team/presets'
import { proxyEngine } from '../src/optimizer/stuff/targetFighter'
import { bossProfile } from '../src/theorycraft/bossProfile'
import { bossFighter, playerFighterFromMember, theoryDptTable, withStates } from '../src/theorycraft/fighters'
import { CONTACT_TAG, possibleHits } from '../src/theorycraft/hits'
import { sustainedDamage } from '../src/theorycraft/rotation'
import type { Fighter } from '../src/engine/types'

const data = loadDataStore()
const table = theoryDptTable(data)
const MERKATOR = 3534
const PERE_VER = 4726
const HAREBOURG = 3416
const KLIME = 3384

const FLECHE_VAGABONDE = 32455
const FLECHE_TYRANNIQUE = 32448
const FLECHE_DEVORANTE = 32446
const COLERE_DE_IOP = 13124

function player(presetId: string, contact = false): Fighter {
  const a = playerFighterFromMember(data, presetMember(getPreset(presetId), data))
  if (!contact) return a
  const c = withStates(a, a.states)
  c.tags[CONTACT_TAG] = true
  return c
}
const indexOf = (a: Fighter, spellId: number) => a.spells.findIndex(s => s.spellId === spellId)
const profileOf = (a: Fighter, spellId: number) => table.profiles.ofFighter(a)[indexOf(a, spellId)]

/** Boss de la fiche, phase principale (caractéristiques effectives, « mêlée seule » posée comme target.ts). */
function bossOf(monsterId: number, extra: Record<string, number> = {}): Fighter {
  const p = bossProfile(data, monsterId)
  const ph = p.phases.find(x => x.vulnerable !== false) ?? p.phases[0]
  const stats = { ...p.stats, ...(ph.vulnerable === 'melee' ? { rangedResPct: 100 } : {}), ...extra }
  return bossFighter(data, monsterId, { grade: p.grade, stats, states: ph.states })
}

describe('coups possibles (règle du jeu)', () => {
  it('PO 1 à N : contact et distance ; PO min ≥ 2 : distance seule ; PO 1 : contact seul ; PO 0 à N : les deux', () => {
    const cra = player('cra_feu_zone')
    expect(possibleHits(profileOf(player('cra_terre_mono'), FLECHE_VAGABONDE))).toEqual({ melee: true, range: true })
    expect(possibleHits(profileOf(cra, FLECHE_TYRANNIQUE))).toEqual({ melee: false, range: true })
    expect(possibleHits(profileOf(cra, FLECHE_DEVORANTE))).toEqual({ melee: true, range: true })
    expect(possibleHits(profileOf(player('iop_terre_burst'), COLERE_DE_IOP))).toEqual({ melee: true, range: false })
  })
})

describe('table DPT du theorycraft', () => {
  it('le coup retenu est celui que la cible subit le mieux : mêlée contre Merkator (−50 % à distance), jamais à distance contre le Père Ver', () => {
    const cra = player('cra_terre_mono')
    const i = indexOf(cra, FLECHE_VAGABONDE)
    const p = profileOf(cra, FLECHE_VAGABONDE)
    const merk = bossOf(MERKATOR)
    expect(merk.stats.rangedResPct).toBe(50)
    expect(table.hitOf(cra, i, merk)).toBe(true)
    const melee = castDamage(cra, merk, p, false, 1, true).mean
    expect(table.perCast(cra, i, merk).mean).toBeCloseTo(melee, 9)
    expect(melee).toBeGreaterThan(1.5 * castDamage(cra, merk, p, false, 1, false).mean)
    // Père Ver (invulnérable à distance) : Flèche Vagabonde frappe au contact ; Flèche Tyrannique (PO 2 à 8) vaut 0.
    const ver = bossOf(PERE_VER)
    expect(ver.stats.rangedResPct).toBe(100)
    expect(table.hitOf(cra, i, ver)).toBe(true)
    expect(table.perCast(cra, i, ver).mean).toBeGreaterThan(100)
    const fire = player('cra_feu_zone')
    expect(table.perCast(fire, indexOf(fire, FLECHE_TYRANNIQUE), ver).mean).toBe(0)
  })

  it('Crâ contre le Père Ver : DPT soutenu > 0 (0 avec la règle de l\'IA « portée max ≤ 1 », gardée pour le Vortex)', () => {
    const cra = player('cra_terre_mono')
    const ver = bossOf(PERE_VER)
    expect(sustainedDamage(table, cra, ver).steady).toBeGreaterThan(1000)
    // Table de l'IA (moteur distinct, mêmes données) : règle inchangée, le Crâ ne touche pas le Père Ver.
    const ia = createDptTable(proxyEngine(loadDataStore()))
    expect(ia.turn(cra, ver, cra.stats.ap, 'next').mean).toBe(0)
  })

  it('à égalité de la cible (Comte Harebourg) : style du personnage — au contact ⇒ mêlée (ses % mêlée comptent), sinon distance', () => {
    const hare = bossOf(HAREBOURG)
    const far = player('sacrieur_sacrifice')
    const near = player('sacrieur_sacrifice', true)
    const dual: number[] = []
    far.spells.forEach((s, i) => {
      const p = table.profiles.ofFighter(far)[i]
      if (!p.damage.length) return
      const h = possibleHits(p)
      if (!(h.melee && h.range)) return
      dual.push(i)
      expect(table.hitOf(far, i, hare), s.name).toBe(false)
      expect(table.hitOf(near, i, hare), s.name).toBe(true)
    })
    expect(dual.length).toBeGreaterThan(3)
    // Les % dommages du lanceur suivent le coup (ils ne le choisissent pas) : +20 % mêlée profitent au personnage joué
    // au contact seulement, sur un sort lançable au contact et à distance.
    const boosted = (f: Fighter) => {
      const g = withStates({ ...f, stats: { ...f.stats, meleeDamagePct: f.stats.meleeDamagePct + 20 } }, f.states)
      return table.perCast(g, dual[0], hare).mean / table.perCast(f, dual[0], hare).mean
    }
    expect(boosted(near)).toBeGreaterThan(1.1)
    expect(boosted(far)).toBeCloseTo(1, 9)
  })

  it('lancer décomposé : part immédiate + poison (Flèche Tyrannique : 2 échéances, cumul 1 du sous-sort qui le porte)', () => {
    const cra = player('cra_feu_zone')
    const i = indexOf(cra, FLECHE_TYRANNIQUE)
    const hare = bossOf(HAREBOURG)
    const sp = table.split(cra, i, hare)
    expect(sp.dots).toHaveLength(1)
    expect(sp.dots[0]).toMatchObject({ turns: 2, stack: 1 })
    // Échéance sans critique (le moteur ne fait pas critiquer les poisons) : sous la part critique pondérée.
    expect(sp.dots[0].tick).toBeGreaterThan(0)
    // Heuristique du sac à dos retrouvée : immédiat + échéance × min(2, 2) × 0,8 (au critique près de l'échéance).
    expect(sp.immediate + sp.dots[0].tick * 1.6).toBeLessThan(table.perCast(cra, i, hare).mean)
    expect(sp.immediate + sp.dots[0].tick * 1.6).toBeGreaterThan(0.9 * table.perCast(cra, i, hare).mean)
    // Sort sans poison : lancer entier en part immédiate.
    const j = indexOf(cra, FLECHE_DEVORANTE)
    expect(table.split(cra, j, hare)).toEqual({ immediate: table.perCast(cra, j, hare).mean, dots: [] })
  })

  it('sorts d\'un MONSTRE : conventions de la fiche (Klime : Cuir moustache, poison de 3 tours compté 3 fois, comme la fiche)', () => {
    const p = bossProfile(data, KLIME)
    const klime = bossFighter(data, KLIME, { grade: p.grade, stats: p.stats })
    const iop = player('iop_soutien')
    const k = klime.spells.findIndex(s => s.name === 'Cuir moustache')
    const fiche = p.spells.find(s => s.name === 'Cuir moustache')!
    const ficheDamage = fiche.damageByElement.reduce((s, v) => s + v, 0) + fiche.otherDamage
    const zero = withStates({ ...iop, stats: { ...iop.stats, fireResPct: 0, fireRes: 0, criticalRes: 0, spellResPct: 0, meleeResPct: 0, rangedResPct: 0 } }, iop.states)
    expect(table.perCast(klime, k, zero).mean).toBeCloseTo(ficheDamage, 6)
    // Table de l'IA : heuristique du sac à dos (× min(durée, 2) × 0,8).
    const ia = createDptTable(proxyEngine(loadDataStore()))
    expect(ia.perCast(klime, k, zero).mean).toBeLessThan(0.6 * ficheDamage)
  })
})
