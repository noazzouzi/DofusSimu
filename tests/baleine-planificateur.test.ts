/**
 * Planificateur du Ventre de la Baleine (tools/ventre-de-la-baleine/planificateur.ts) sur la salle 2 (carte 140772356 :
 * Pataugerme, deux Bacterribs, Verminocule), état reconstitué d'un journal synthétique au format AnkaBot (noms obfusqués
 * du 2026-10-10) : un Crâ s'éloigne des Bacterribs, garde le Verminocule quand il est le dernier à pouvoir le faire ou
 * s'en rapproche s'il est hors d'atteinte, met ses Flèches du Jugement sur les monstres qui frappent, et touche le
 * Pataugerme dans plusieurs éléments. Moteur (moteur.ts) : le −3 PO de Tirs Puissants au tour qui suit le lancer.
 */
import { describe, expect, it } from 'vitest'
import { distance } from '../src/map/geometry'
import { data } from '../tools/reine-des-voleurs/planificateur/etat'
import type { Row } from '../tools/reine-des-voleurs/planificateur/journal'
import { etatCombat } from '../tools/ventre-de-la-baleine/etat'
import { threats } from '../tools/ventre-de-la-baleine/menaces'
import { moteurDuTour } from '../tools/ventre-de-la-baleine/moteur'
import { planTourBaleine } from '../tools/ventre-de-la-baleine/planificateur'

const CARTE = 140772356
/** Sorts d'un Crâ du groupe (Lowkey-Jealous, liste du jeu du 2026-10-13). */
const SORTS = [
  [32426, 3], [32435, 3], [32437, 3], [32442, 1], [32454, 3], [32443, 3], [32455, 3], [32448, 1], [32474, 3], [32465, 3],
  [32470, 3], [32429, 2], [32469, 2], [32457, 1], [32446, 2], [32460, 1], [32467, 2], [32453, 3], [32439, 2], [32427, 3],
  [32466, 3], [32428, 3],
].map(([spellId, grade]) => ({ spellId, grade }))
const JUGEMENT = 32460
const TIRS_PUISSANTS = 32466

const ALPHA = 900000000001
const BETA = 900000000002
const GAMMA = 900000000003
const DELTA = 900000000004
const NOMS: Record<number, string> = { [ALPHA]: 'Alpha', [BETA]: 'Beta', [GAMMA]: 'Gamma', [DELTA]: 'Delta' }
const PAT = -1
const BAC1 = -2
const BAC2 = -3
const VERM = -4
const VERM2 = -5
const ESPECE: Record<number, number> = { [PAT]: 3827, [BAC1]: 3825, [BAC2]: 3825, [VERM]: 3824, [VERM2]: 3824 }
/** Premier sort de la Restauration de chaque Krobe (compte à rebours posé au début du combat). */
const RESTAURATION: Record<number, number> = { 3827: 4959, 3825: 4948, 3824: 4942 }

const carac = (id: number, v: number) => ({ gboz: id, gbpc: { gcuv: 0, gcuw: v } })
/** Crâs : 3 700 PV, 12 PA, 6 PM, +6 PO (19). */
const fighter = (id: number, cell: number) => ({
  gcaw: id,
  gcax: { gblc: cell },
  gcay: {
    gcar: {
      gcac: { gdeq: [carac(0, 3700), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 12), carac(23, 6), ...(id > 0 ? [carac(19, 6)] : [])] },
      gcad: { gdns: id > 0 ? 0 : 1 },
      ...(id > 0 ? { gcah: { gbyn: NOMS[id], gbyr: { gbxy: 9, gbyc: 200 } } } : { gcai: { gbzm: { gbyz: ESPECE[id], gbyx: 5, gbyy: 212 } } }),
    },
  },
})
let i = 0
const m = (n: string, d: unknown): Row => ({ k: 'm', i: ++i, n, d, at: '' })
const compteARebours = (id: number) =>
  m('juh', { fxet: { gdzl: { gdps: 0, gdpt: { gcqz: 0, gcra: 4 }, gdpw: ++i, gdpx: 0, gdpz: id, gdqb: 0, gdqf: 'I', gdqh: RESTAURATION[ESPECE[id]] }, gdzm: 141, gdzn: id } })
/** Lancer volontaire (séquence du lanceur) d'un sort sur une case. */
const lancer = (who: number, spell: number, cell: number) => [
  m('jqh', { fwji: 0, fwjj: who }),
  m('jsq', { fwuv: 300, fwuw: who, fwuy: { fwqq: cell, fwqr: who, fwqt: 0, fwqu: { fwpu: spell, fwpt: 1 } } }),
  m('jsy', {}),
]

interface Situation {
  cases: Record<number, number>
  /** Ordre de jeu (identifiants), le Crâ actif en premier. */
  ordre: number[]
  /** Carte du combat (défaut : salle 2). */
  carte?: number
}

const debut = (s: Situation): Row[] => {
  const ids = Object.keys(s.cases).map(Number)
  return [
    m('jvi', { fxjj: 1 }),
    m('jvu', { fxlo: s.ordre.map(g => ({ fxkv: { fxld: g } })) }),
    m('juo', { fxgj: ids.map(id => fighter(id, s.cases[id])) }),
    ...ids.filter(id => id < 0).map(compteARebours),
  ]
}
const sorts = () => Object.fromEntries(Object.values(NOMS).map(n => [n, SORTS]))

function planDe(s: Situation) {
  const st = etatCombat([...debut(s), m('jvj', { fxjr: s.ordre[0] })], { mapId: s.carte ?? CARTE })
  expect(st.res.fighters[st.current!]?.name).toBe(NOMS[s.ordre[0]])
  const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 6, spells: sorts() })
  const res = planTourBaleine(st, mo)
  expect(res.plans.length).toBeGreaterThan(0)
  return res.plans[0]
}
const lancersDe = (plan: ReturnType<typeof planDe>, spell: number) =>
  plan.steps.flatMap(x => (x.kind === 'cast' && x.spell === spell ? [x.cell] : []))

describe('planificateur du Ventre de la Baleine, salle 2', () => {
  it('quitte la zone de 5 cases des Bacterribs', () => {
    // Alpha à 5 cases de la Bacterrib 409, dernier Crâ avant le Pataugerme ; Gamma garde déjà le Verminocule (il ne
    // rejoue pas avant lui).
    const cases = { [ALPHA]: 342, [BETA]: 300, [GAMMA]: 338, [DELTA]: 272, [PAT]: 324, [BAC1]: 189, [BAC2]: 409, [VERM]: 352 }
    const plan = planDe({ cases, ordre: [ALPHA, PAT, BAC1, BETA, BAC2, VERM, GAMMA, DELTA] })
    expect(distance(plan.endCell, 409)).toBeGreaterThan(5)
    expect(distance(plan.endCell, 189)).toBeGreaterThan(5)
    // Dernier Crâ avant le Pataugerme : les 4 éléments, ou rien (un élément seul renforce sa Brûlure).
    expect(plan.parts.elements).toBe(7500)
  }, 60_000)

  it('garde le Verminocule quand aucun autre Crâ ne peut y aller avant son tour', () => {
    // Le Verminocule joue juste après Alpha ; personne à son contact.
    const cases = { [ALPHA]: 327, [BETA]: 300, [GAMMA]: 272, [DELTA]: 384, [PAT]: 324, [BAC1]: 189, [BAC2]: 470, [VERM]: 352 }
    const plan = planDe({ cases, ordre: [ALPHA, VERM, PAT, BAC1, BETA, BAC2, GAMMA, DELTA] })
    expect(distance(plan.endCell, 352)).toBe(1)
  }, 60_000)

  it('gardien du Verminocule hors d’atteinte : il s’en rapproche sans finir à sa portée', () => {
    // Alpha joue juste avant le Verminocule, à 14 cases : impossible d'aller au contact ce tour-ci.
    const cases = { [ALPHA]: 300, [BETA]: 272, [GAMMA]: 327, [DELTA]: 329, [BAC1]: 189, [BAC2]: 470, [VERM]: 495 }
    const plan = planDe({ cases, ordre: [ALPHA, VERM, BAC1, BETA, BAC2, GAMMA, DELTA] })
    expect(distance(300, 495)).toBe(14)
    // (plus près, sans sacrifier les Flèches du Jugement sur les Bacterribs, qui frappent dès ce tour)
    expect(distance(plan.endCell, 495)).toBeLessThan(14)
    expect(distance(plan.endCell, 189)).toBeGreaterThan(5)
    expect(distance(plan.endCell, 470)).toBeGreaterThan(5)
    // … sans finir à portée du Verminocule (Gonflement l'attirerait et le frapperait sans que la condition soit tenue).
    const t = threats(data.map(CARTE)!, [{ monsterId: 3824, cell: 495 }, { monsterId: 3825, cell: 189 }, { monsterId: 3825, cell: 470 }], [272, 327, 329])
    expect([...(t.sources.get(plan.endCell) ?? [])]).not.toContain(495)
  }, 60_000)

  it('Flèche du Jugement sur les Bacterribs, pas sur un Verminocule qui ne touche encore personne', () => {
    // Les Bacterribs touchent les 4 Crâs ; le Verminocule (495), à 12 cases ou plus de chacun, aucun.
    const cases = { [ALPHA]: 300, [BETA]: 272, [GAMMA]: 327, [DELTA]: 329, [BAC1]: 189, [BAC2]: 470, [VERM]: 495 }
    const plan = planDe({ cases, ordre: [ALPHA, BAC1, BETA, BAC2, VERM, GAMMA, DELTA] })
    const cibles = lancersDe(plan, JUGEMENT)
    expect(cibles.length).toBeGreaterThan(0)
    for (const c of cibles) expect([189, 470]).toContain(c)
  }, 60_000)

  it('deux Verminocules (salle annexe) : chacun son gardien', () => {
    // Alpha joue juste avant le premier (287, à sa portée), Beta juste avant le second (160, loin d'Alpha).
    const cases = { [ALPHA]: 326, [BETA]: 384, [GAMMA]: 411, [DELTA]: 357, [VERM]: 287, [VERM2]: 160 }
    const plan = planDe({ cases, ordre: [ALPHA, VERM, BETA, VERM2, GAMMA, DELTA], carte: 140773380 })
    expect(distance(plan.endCell, 287)).toBe(1)
  }, 60_000)

  it('touche le Pataugerme dans plusieurs éléments', () => {
    const cases = { [ALPHA]: 300, [BETA]: 272, [GAMMA]: 338, [DELTA]: 384, [PAT]: 324, [BAC1]: 189, [BAC2]: 470, [VERM]: 352 }
    const plan = planDe({ cases, ordre: [ALPHA, BETA, GAMMA, PAT, BAC1, BAC2, VERM, DELTA] })
    expect(plan.parts.elements).toBeGreaterThanOrEqual(2 * 1500)
  }, 60_000)
})

describe('moteur du tour : Tirs Puissants', () => {
  const s: Situation = { cases: { [ALPHA]: 300, [BETA]: 272, [BAC1]: 189, [VERM]: 495 }, ordre: [ALPHA, BETA, BAC1, VERM] }
  /** Manche 1 : Alpha lance (ou non) Tirs Puissants ; manche 2 : début de son tour, et lignes reçues ensuite. */
  const portee = (tirs: boolean, apres: Row[] = []) => {
    const rows = [
      ...debut(s),
      m('jvj', { fxjr: ALPHA }),
      ...(tirs ? lancer(ALPHA, TIRS_PUISSANTS, 300) : []),
      m('jup', { fxgo: ALPHA }),
      m('jvi', { fxjj: 2 }),
      m('jvj', { fxjr: ALPHA }),
      ...apres,
    ]
    const st = etatCombat(rows, { mapId: CARTE })
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 6, spells: sorts() })
    return mo.fight.fighters[mo.me].stats.range
  }

  it('−3 PO au tour suivant tant que la portée du serveur n’est pas arrivée', () => {
    expect(portee(false)).toBe(6)
    expect(portee(true)).toBe(3)
    // Portée réduite reçue après le début du tour (jtk, caractéristique 19) : pas de second −3.
    expect(portee(true, [m('jtk', { fwzp: ALPHA, fwzo: { gdeq: [carac(19, 3)] } })])).toBe(3)
  })
})

describe('Crâ du serveur du Féca (Roc des Salbatroces, avec des mules)', () => {
  it('mules (opts.joueurs) : il achève une mule entamée, 2 000 PV de moins pour la Malamibe, sans pénalité de tir allié', () => {
    // Alpha (Crâ joué) et Beta (mule à 150 PV, à 4 cases) ; Malamibe en vie (pas encore à son 2e tour), Verminocule loin.
    const MALA = -6
    ESPECE[MALA] = 3822
    const cases = { [ALPHA]: 342, [BETA]: 286, [VERM]: 189, [MALA]: 409 }
    const st = etatCombat([...debut({ cases, ordre: [ALPHA, BETA, VERM, MALA] }), m('jvj', { fxjr: ALPHA })], { mapId: CARTE })
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 6, spells: sorts() })
    for (const f of mo.fight.fighters) {
      if (f.name === 'Beta') f.hp = 150
      if (f.monsterId === 3822) Object.assign(f, { hp: 6001, maxHp: 6001, baseMaxHp: 6001 })
    }
    const plan = planTourBaleine(st, mo, { joueurs: ['Alpha'] }).plans[0]
    // (Beta visée : sans opts.joueurs, un tir sur un allié est pénalisé, sa mort interdite)
    expect(plan.steps.some(x => x.kind === 'cast' && x.cell === 286)).toBe(true)
    expect(plan.parts.malamibe).toBeGreaterThanOrEqual(2000)
    expect(plan.parts.friendly).toBe(0)
  }, 120_000)
})

describe('Crâ tueuse (serveur du Féca : tue les mules, puis va mourir chez les monstres)', () => {
  it('frappe les mules groupées, et finit plus près des Krobes', () => {
    // Alpha (tueuse) en 342, trois mules de 1 500 PV groupées autour de 300 ; Malamibe en vie, Verminocule en 189.
    const MALA = -6
    ESPECE[MALA] = 3822
    const cases = { [ALPHA]: 342, [BETA]: 286, [GAMMA]: 300, [DELTA]: 314, [VERM]: 189, [MALA]: 409 }
    const st = etatCombat([...debut({ cases, ordre: [ALPHA, BETA, GAMMA, DELTA, VERM, MALA] }), m('jvj', { fxjr: ALPHA })], { mapId: CARTE })
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 6, spells: sorts() })
    for (const f of mo.fight.fighters) {
      if (['Beta', 'Gamma', 'Delta'].includes(f.name)) f.hp = 1500
      if (f.monsterId === 3822) Object.assign(f, { hp: 10001, maxHp: 10001, baseMaxHp: 10001 })
    }
    const plan = planTourBaleine(st, mo, { joueurs: ['Alpha'], tueuse: true, elements: [3] }).plans[0]
    expect(plan.parts.mules).toBeGreaterThan(500)
    expect(distance(plan.endCell, 189)).toBeLessThanOrEqual(distance(342, 189))
    // (sorts d'attaque Eau seulement : Kyanna-Lee, équipée Eau)
    for (const x of plan.steps) {
      if (x.kind !== 'cast') continue
      const l = data.spell(x.spell)!.levels.at(-1)!
      if (l.range === 0) continue
      const els = new Set(l.effects.map(e => (e as { element?: number }).element).filter((e): e is number => e !== undefined && e >= 0 && e <= 4))
      expect([...els]).toEqual([3])
    }
  }, 120_000)
})
