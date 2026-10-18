/**
 * Bilan d'un combat du Ventre de la Baleine (tools/ventre-de-la-baleine/bilan.ts), sur un combat synthétique au format du
 * journal AnkaBot (noms obfusqués du 2026-10-10) : Malamibe invoquée par le premier Krobe à jouer, renvoi des dégâts
 * d'un Krobe touché vers la Malamibe, Pataugerme touché dans les 4 éléments (Infection), Virustine poussée et Tabacille
 * réinitialisé par un soin (compte à rebours relancé), échange du Tabacille, mort de la Malamibe et d'un Krobe.
 */
import { describe, expect, it } from 'vitest'
import { baleineFights, bilanCombat, formatBilan } from '../tools/ventre-de-la-baleine/bilan'
import type { Row } from '../tools/reine-des-voleurs/planificateur/journal'

const ALPHA = 900000000001
const BETA = 900000000002
const PAT = -1
const VIR = -2
const TAB = -3
const MALA = -5

const carac = (id: number, v: number) => ({ gboz: id, gbpc: { gcuv: 0, gcuw: v } })
const fighter = (id: number, cell: number, team: 0 | 1, extra: { hp: number; name?: string; monster?: number }) => ({
  gcaw: id,
  gcax: { gblc: cell },
  gcay: {
    gcar: {
      gcac: { gdeq: [carac(0, extra.hp), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 12), carac(23, 6)] },
      gcad: { gdns: team },
      ...(extra.name ? { gcah: { gbyn: extra.name, gbyr: { gbxy: 9, gbyc: 200 } } } : { gcai: { gbzm: { gbyz: extra.monster, gbyx: 5, gbyy: 212 } } }),
    },
  },
})
let i = 0
const m = (n: string, d: unknown): Row => ({ k: 'm', i: ++i, n, d, at: '' })
const act = (fwuv: number, fwuw: number, variant: Record<string, unknown>) => m('jsq', { fwuv, fwuw, ...variant })
const cast = (who: number, spell: number, cell: number, target: number) => act(300, who, { fwuy: { fwqq: cell, fwqr: target, fwqt: 0, fwqu: { fwpu: spell, fwpt: 1 } } })
const dmg = (who: number, target: number, amount: number, element: number) => act(100, who, { fwwd: { fwsf: target, fwsg: amount, fwsa: 0, fwse: element, fwsb: 0 } })
/** Effet posé (juh) : effet du jeu, paramètre (état…), sort d'origine, lanceur, cible. */
const buff = (effect: number, param: number, spell: number, caster: number, target: number) =>
  m('juh', { fxet: { gdzl: { gdps: param, gdpt: { gcqz: 0, gcra: effect === 141 ? 4 : -1 }, gdpw: ++i, gdpx: 0, gdpz: caster, gdqb: 0, gdqf: 'I', gdqh: spell }, gdzm: effect, gdzn: target } })
const seq = (who: number, rows: Row[]) => [m('jqh', { fwji: 0, fwjj: who }), ...rows, m('jsy', {})]

function baleineRows(): Row[] {
  return [
    m('jvi', { fxjj: 1 }),
    m('juo', { fxgj: [
      fighter(ALPHA, 385, 0, { hp: 3700, name: 'Alpha' }), fighter(BETA, 372, 0, { hp: 3700, name: 'Beta' }),
      fighter(PAT, 297, 1, { hp: 1000, monster: 3827 }), fighter(VIR, 341, 1, { hp: 1000, monster: 3826 }), fighter(TAB, 286, 1, { hp: 1000, monster: 3823 }),
    ] }),
    // Sorts de départ (avant le premier tour) : compte à rebours de chaque Restauration (Tabacille : sort et sous-sort).
    buff(141, 0, 4959, PAT, PAT), buff(141, 0, 4953, VIR, VIR), buff(141, 0, 5179, TAB, TAB), buff(141, 0, 4938, TAB, TAB),
    // Alpha : le Pataugerme dans les 4 éléments avant son tour (pas encore de Malamibe).
    m('jvj', { fxjr: ALPHA }),
    m('jnz', { fwab: [385, 344], fwaf: ALPHA }),
    ...seq(ALPHA, [cast(ALPHA, 32435, 297, PAT), dmg(ALPHA, PAT, 0, 3), buff(950, 480, 4957, PAT, PAT)]),
    ...seq(ALPHA, [cast(ALPHA, 32427, 297, PAT), dmg(ALPHA, PAT, 0, 4), buff(950, 481, 4957, PAT, PAT)]),
    ...seq(ALPHA, [cast(ALPHA, 32446, 297, PAT), dmg(ALPHA, PAT, 0, 2), buff(950, 479, 4957, PAT, PAT)]),
    // Flèche d'Abolition : vol de vie (Alpha +100), qui ne réinitialise pas le Tabacille.
    ...seq(ALPHA, [cast(ALPHA, 32453, 297, PAT), dmg(ALPHA, PAT, 0, 1), act(108, ALPHA, { fwwf: { fwsl: ALPHA, fwsn: 100 } }), buff(950, 482, 4957, PAT, PAT), buff(950, 215, 4957, PAT, PAT)]),
    m('jup', { fxgo: ALPHA }),
    // Pataugerme : invoque la Malamibe (2000 PV par personnage), Brûlure d'estomac sur Beta.
    m('jvj', { fxjr: PAT }),
    act(181, PAT, { fwvi: { fwnc: { fwmv: [{ fwmk: { fwjd: { fwie: 3822, fwif: 1 } }, fwml: { gdeq: [carac(0, 1000)] }, fwmp: [{ gdns: 1, gdnt: { gcaw: MALA, gcax: { gblc: 298 } } }] }] } } }),
    m('jtk', { fwzp: MALA, fwzo: { gdeq: [carac(11, 4000)] } }),
    ...seq(PAT, [cast(PAT, 4961, 372, BETA), dmg(PAT, BETA, 900, 0)]),
    m('jup', { fxgo: PAT }),
    m('jvj', { fxjr: MALA }),
    m('jup', { fxgo: MALA }),
    // Beta : pousse la Virustine (réinitialisée), touche le Tabacille (renvoi vers la Malamibe), soigne Alpha (Balise de
    // Survie : le Tabacille est réinitialisé).
    m('jvj', { fxjr: BETA }),
    ...seq(BETA, [cast(BETA, 32426, 341, VIR), act(5, BETA, { fwvb: { fwsr: VIR, fwss: 341, fwst: 327 } }), buff(141, 0, 4953, VIR, VIR)]),
    ...seq(BETA, [cast(BETA, 32460, 286, TAB), dmg(BETA, TAB, 0, 1), dmg(TAB, MALA, 500, 1)]),
    ...seq(BETA, [cast(BETA, 32474, 370, BETA), act(108, BETA, { fwwf: { fwsl: ALPHA, fwsn: 200 } }), buff(141, 0, 4938, TAB, TAB)]),
    m('jup', { fxgo: BETA }),
    m('jvj', { fxjr: VIR }),
    m('jup', { fxgo: VIR }),
    // Tabacille : Échange subtil avec Alpha (344, en ligne à 4 cases), dégâts Neutre.
    m('jvj', { fxjr: TAB }),
    ...seq(TAB, [cast(TAB, 4939, 344, ALPHA), act(8, TAB, { fwva: { fwog: ALPHA, fwoh: 344, fwoi: 286 } }), dmg(TAB, ALPHA, 300, 0)]),
    m('jup', { fxgo: TAB }),
    // Manche 2 : Alpha tue la Malamibe.
    m('jvi', { fxjj: 2 }),
    m('jvj', { fxjr: ALPHA }),
    ...seq(ALPHA, [cast(ALPHA, 32446, 298, MALA), dmg(ALPHA, MALA, 5000, 2), act(103, ALPHA, { fwuz: { fwrl: MALA } })]),
    m('jup', { fxgo: ALPHA }),
    // Manche 3 : le Tabacille meurt de son compte à rebours.
    m('jvi', { fxjj: 3 }),
    m('jvj', { fxjr: TAB }),
    act(103, TAB, { fwuz: { fwrl: TAB } }),
    m('jup', { fxgo: TAB }),
  ]
}

describe('bilan d’un combat du Ventre de la Baleine', () => {
  const rows = baleineRows()
  const b = bilanCombat(rows, -1)
  const krobe = (n: string) => b.krobes.find(k => k.name.startsWith(n))!

  it('reconnaît le combat et ses monstres', () => {
    expect(baleineFights(rows)).toEqual([0])
    expect(b.placement.monsters).toEqual(['Pataugerme 297', 'Tabacille 286', 'Virustine 341'])
    expect(b.order).toEqual(['Alpha', 'Pataugerme -1', 'Malamibe -5', 'Beta', 'Virustine -2', 'Tabacille -3'])
  })

  it('suit la Malamibe : invocation, PV, renvoi et coups directs, mort', () => {
    expect(b.malamibes).toHaveLength(1)
    const mala = b.malamibes[0]
    expect(mala).toMatchObject({ summoner: 'Pataugerme -1', round: 1, maxHp: 5000, turnsPlayed: 1, diedRound: 2, killer: 'Alpha' })
    expect(mala.damage).toEqual({ renvoi: 500, direct: 5000 })
    expect(b.damageByPlayer).toEqual({ Beta: { renvoi: 500, direct: 0 }, Alpha: { renvoi: 0, direct: 5000 } })
  })

  it('suit les comptes à rebours et leurs causes', () => {
    const pat = krobe('Pataugerme')
    expect(pat.infections).toEqual([1])
    expect(pat.elementStates[1].sort()).toEqual(['Air', 'Eau', 'Feu', 'Terre'])
    expect(pat.elementHits[1].sort()).toEqual(['Air', 'Eau', 'Feu', 'Terre'])
    expect(pat.countdowns.map(c => c.cause)).toEqual(['début du combat'])
    const vir = krobe('Virustine')
    expect(vir.countdowns.map(c => c.cause)).toEqual(['début du combat', 'réinitialisé : déplacée 341→327 pendant le tour de Beta'])
    const tab = krobe('Tabacille')
    expect(tab.countdowns.map(c => c.cause)).toEqual(['début du combat', 'réinitialisé : soin de Alpha (+200, Balise de Survie)'])
    expect(tab.diedRound).toBe(3)
    expect(b.heals).toEqual([
      { round: 1, during: 'tour de Alpha', target: 'Alpha', amount: 100, spell: "Flèche d'Abolition", volDeVie: true },
      { round: 1, during: 'tour de Beta', target: 'Alpha', amount: 200, spell: 'Balise de Survie' },
    ])
  })

  it('décrit les tours des monstres et les dégâts reçus', () => {
    const tabTurn = b.turns.find(t => t.name === 'Tabacille -3' && t.round === 1)!
    expect(tabTurn.casts.map(c => c.spell)).toEqual(['Échange subtil'])
    expect(tabTurn.casts[0]).toMatchObject({ cible: 'Alpha', distance: 4, axe: 'ligne' })
    expect(tabTurn.endCell).toBe(344)
    expect(b.damageTaken).toEqual({ Beta: { Pataugerme: 900 }, Alpha: { Tabacille: 300 } })
    const text = formatBilan(b)
    expect(text).toContain('Malamibe -5 : invoquée M1 par Pataugerme -1, 5000 PV max')
    expect(text).toContain('Virustine -2 (341)')
  })

  it('explique les relances des Bacterribs et du Verminocule (salle 2)', () => {
    const BAC = -6
    const VER = -7
    const rows: Row[] = [
      m('jvi', { fxjj: 1 }),
      m('juo', { fxgj: [
        fighter(ALPHA, 300, 0, { hp: 3700, name: 'Alpha' }), fighter(BETA, 272, 0, { hp: 3700, name: 'Beta' }),
        fighter(BAC, 327, 1, { hp: 1000, monster: 3825 }), fighter(VER, 352, 1, { hp: 1000, monster: 3824 }),
      ] }),
      buff(141, 0, 4948, BAC, BAC), buff(141, 0, 4942, VER, VER),
      m('jvj', { fxjr: ALPHA }),
      m('jup', { fxgo: ALPHA }),
      // Alpha (2 cases) et Beta (4 cases) trop près de la Bacterrib ; personne au contact du Verminocule.
      m('jvj', { fxjr: BAC }),
      buff(141, 0, 4948, BAC, BAC),
      m('jup', { fxgo: BAC }),
      m('jvj', { fxjr: VER }),
      buff(141, 0, 4942, VER, VER),
      m('jup', { fxgo: VER }),
    ]
    const b2 = bilanCombat(rows, -1)
    const causes = (n: string) => b2.krobes.find(k => k.name.startsWith(n))!.countdowns.map(c => c.cause)
    expect(causes('Bacterrib')).toEqual(['début du combat', 'réinitialisé : Alpha à 2 cases, Beta à 4 cases'])
    expect(causes('Verminocule')).toEqual(['début du combat', 'réinitialisé : aucun Crâ à son contact (le plus proche : Alpha à 8 cases)'])
  })
})
