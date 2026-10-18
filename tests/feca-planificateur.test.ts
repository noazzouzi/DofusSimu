/**
 * Planificateur du Féca contre les Krobes (tools/feca/planificateur.ts) sur l'arène du Roc des Salbatroces de la vidéo
 * de référence (carte 140517635, docs/strategies/krobes-feca/README.md), état reconstitué d'un journal synthétique au
 * format AnkaBot : le Féca reste à 6 cases ou plus des Bacterribs, ne déplace pas la Virustine, frappe les Krobes pour
 * tuer la Malamibe, se met au contact du Verminocule sous Barricade une fois les Bacterribs mortes. Et le recalage de
 * l'état du journal sur l'état visible envoyé par le script d'un personnage seul (etat.ts, appliquerEtatDirect).
 */
import { describe, expect, it } from 'vitest'
import { castSpell } from '../src/engine/cast'
import { move } from '../src/engine/move'
import { distance } from '../src/map/geometry'
import { zoneCells } from '../src/map/zones'
import { SORT } from '../tools/feca/feca'
import { ordreDesMules } from '../tools/feca/placement'
import { planTourFeca } from '../tools/feca/planificateur'
import { appliquerVariantes } from '../tools/feca/variantes'
import { threats } from '../tools/ventre-de-la-baleine/menaces'
import { data } from '../tools/reine-des-voleurs/planificateur/etat'
import type { Row } from '../tools/reine-des-voleurs/planificateur/journal'
import { appliquerEtatDirect, etatCombat, lireEtatDirect } from '../tools/ventre-de-la-baleine/etat'
import { moteurDuTour } from '../tools/ventre-de-la-baleine/moteur'

const CARTE = 140517635
const FECA = 900000000001
/** Sorts du Féca : une variante par paire, celles de la vidéo (Eau) et ses protections, au grade maximal. */
const SORTS = [12983, 12978, 13015, 12976, 13009, 12979, 12977, 12993, 12995, 13022, 12994, 12986, 13013, 13023, 12987,
  13025, 13027, 13011, 29045, 12991, 12988, 12982].map(spellId => ({ spellId, grade: data.spell(spellId)?.levels.length ?? 1 }))

/**
 * Sorts de Kaskyzo (combat du 2026-10-17) : la liste du jeu, qui ne donne que le sort de base de chaque paire, et ses
 * variantes équipées (Giboulée, Ataraxie, Escapade).
 */
const LISTE_DU_JEU = [12986, 12976, 12988, 12977, 12978, 12979, 13011, 12991, 12981, 12989, 13020, 12992, 12982, 12990,
  12987, 12993, 12985, 12983, 12994, 14434, 12984, 12995].map(spellId => ({ spellId, grade: data.spell(spellId)?.levels.length ?? 1 }))
const SORTS_KASKYZO = appliquerVariantes(LISTE_DU_JEU, ['Giboulée', 'Ataraxie', 'Escapade'])
/** Les mêmes, avec les variantes de la vidéo prises le 2026-10-17 : Verglas, Fortification, Regroupement. */
const SORTS_VERGLAS = appliquerVariantes(LISTE_DU_JEU, ['Giboulée', 'Ataraxie', 'Escapade', 'Verglas', 'Fortification', 'Regroupement'])
/** Et Stratus (variante de Nimbus), prise le 2026-10-17 au soir. */
const SORTS_STRATUS = appliquerVariantes(LISTE_DU_JEU, ['Giboulée', 'Ataraxie', 'Escapade', 'Verglas', 'Fortification', 'Regroupement', 'Stratus'])

const BAC1 = -1
const BAC2 = -2
const BAC3 = -3
const VERM1 = -4
const VERM2 = -5
const TAB1 = -6
const TAB2 = -7
const VIRUS = -8
const MALA = -9
const PAT = -10
const VERM3 = -11
const TAB3 = -12
const ESPECE: Record<number, number> = {
  [BAC1]: 3825, [BAC2]: 3825, [BAC3]: 3825, [VERM1]: 3824, [VERM2]: 3824, [VERM3]: 3824, [TAB1]: 3823, [TAB2]: 3823, [TAB3]: 3823,
  [VIRUS]: 3826, [MALA]: 3822, [PAT]: 3827,
}
/** Premier sort de la Restauration de chaque Krobe (compte à rebours posé au début du combat). */
const RESTAURATION: Record<number, number> = { 3825: 4948, 3824: 4942, 3823: 5179, 3826: 4953, 3827: 4959 }

const carac = (id: number, v: number) => ({ gboz: id, gbpc: { gcuv: 0, gcuw: v } })
/** Féca Eau : 4 962 PV, 12 PA, 5 PM, 30 % de résistances ; Krobes : 1 000 PV ; Malamibe : 2 001 PV. */
const STATS_FECA = [carac(0, 4962), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 12), carac(23, 5), carac(19, 2),
  carac(13, 1100), carac(25, 150), carac(90, 80), carac(18, 40), carac(86, 60), carac(33, 30), carac(34, 30), carac(35, 30),
  carac(36, 30), carac(37, 30)]
/** Tueuse (TUEUSES, tools/feca/feca.ts) : un personnage nommé Kyanna-Lee, 300 PV comme les mules. */
const KYANNA = FECA + 9
/** Mule (tout autre personnage que le Féca) : 300 PV. */
const STATS_MULE = [carac(0, 300), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 6), carac(23, 3)]
const fighter = (id: number, cell: number) => ({
  gcaw: id,
  gcax: { gblc: cell },
  gcay: {
    gcar: {
      // (Krobes : esquive PA 49 et PM 70, relevées en jeu le 2026-10-17)
      gcac: { gdeq: id === FECA ? STATS_FECA : id > 0 ? STATS_MULE : [carac(0, ESPECE[id] === 3822 ? 2001 : 1000), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 12), carac(23, 5), carac(27, 49), carac(28, 70)] },
      gcad: { gdns: id > 0 ? 0 : 1 },
      ...(id > 0 ? { gcah: { gbyn: id === FECA ? 'Feca' : id === KYANNA ? 'Kyanna-Lee' : `Mule${id - FECA}`, gbyr: { gbxy: 1, gbyc: 200 } } } : { gcai: { gbzm: { gbyz: ESPECE[id], gbyx: 5, gbyy: 212 } } }),
    },
  },
})
let i = 0
const m = (n: string, d: unknown): Row => ({ k: 'm', i: ++i, n, d, at: '' })
const compteARebours = (id: number) =>
  m('juh', { fxet: { gdzl: { gdps: 0, gdpt: { gcqz: 0, gcra: 4 }, gdpw: ++i, gdpx: 0, gdpz: id, gdqb: 0, gdqf: 'I', gdqh: RESTAURATION[ESPECE[id]] }, gdzm: 141, gdzn: id } })

const debut = (cases: Record<number, number>, ordre: number[]): Row[] => {
  const ids = Object.keys(cases).map(Number)
  return [
    m('jvi', { fxjj: 1 }),
    m('jvu', { fxlo: ordre.map(g => ({ fxkv: { fxld: g } })) }),
    m('juo', { fxgj: ids.map(id => fighter(id, cases[id])) }),
    ...ids.filter(id => id < 0 && RESTAURATION[ESPECE[id]]).map(compteARebours),
  ]
}

function planDe(cases: Record<number, number>, opts: { carte?: number; sorts?: typeof SORTS } = {}) {
  const ordre = [FECA, ...Object.keys(cases).map(Number).filter(id => id < 0)]
  const st = etatCombat([...debut(cases, ordre), m('jvj', { fxjr: FECA })], { mapId: opts.carte ?? CARTE })
  expect(st.res.fighters[st.current!]?.breedId).toBe(1)
  const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: opts.sorts ?? SORTS } })
  const res = planTourFeca(st, mo)
  expect(res.plans.length).toBeGreaterThan(0)
  return { plan: res.plans[0], mo, st }
}
const idDe = (r: ReturnType<typeof planDe>, gameId: number) => r.st.res.fighters.find(f => f.gameId === gameId)!.id

/** Rejoue un plan dans le moteur : case finale de chaque monstre (id du journal → case). */
function rejouer({ plan, mo }: ReturnType<typeof planDe>): Map<number, number> {
  const s = mo.engine.cloneFight(mo.fight)
  const me = s.fighters[mo.me]
  for (const x of plan.steps) {
    if (x.kind === 'move') move(s, me, x.path, mo.engine)
    else castSpell(mo.engine, s, me, x.spell, x.cell)
  }
  return new Map(s.fighters.map(f => [mo.rid.get(f.id)!, f.cell]))
}
const lancers = (plan: ReturnType<typeof planDe>['plan'], spell: number) => plan.steps.filter(x => x.kind === 'cast' && x.spell === spell).length

describe('planificateur du Féca, Roc des Salbatroces (arène 140517635)', () => {
  // Placement de la vidéo (0:12), Féca au milieu des monstres du bas : 3 Bacterribs, 2 Verminocules, 2 Tabacilles, Virustine.
  const VIDEO = { [FECA]: 358, [BAC1]: 65, [VERM1]: 92, [TAB1]: 93, [VIRUS]: 274, [BAC2]: 122, [VERM2]: 151, [TAB2]: 107, [BAC3]: 302 }

  it('manche 1 : finit à 6 cases ou plus des Bacterribs, sans déplacer la Virustine', () => {
    const r = planDe(VIDEO)
    for (const b of [65, 122, 302]) expect(distance(r.plan.endCell, b)).toBeGreaterThan(5)
    expect(rejouer(r).get(idDe(r, VIRUS))).toBe(274)
  }, 120_000)

  it('frappe les Krobes pour la Malamibe', () => {
    const { plan } = planDe({ ...VIDEO, [FECA]: 429, [MALA]: 94 })
    expect(plan.parts.malamibe).toBeGreaterThan(500)
  }, 120_000)

  it('phase de fuite (Ventre de la Baleine, salle 2, combat perdu du 2026-10-17) : hors d’atteinte, Verminocule ignoré', () => {
    // Premier tour du combat : le Féca était allé à portée des deux Bacterribs pour s'approcher du Verminocule.
    const cases = { [FECA]: 346, [BAC1]: 282, [BAC2]: 324, [PAT]: 366, [VERM1]: 409 }
    const { plan } = planDe(cases, { carte: 140772356, sorts: SORTS_KASKYZO })
    expect(plan.notes[0]).toBe('phase de fuite')
    const t = threats(data.map(140772356)!, [{ monsterId: 3825, cell: 282 }, { monsterId: 3825, cell: 324 }, { monsterId: 3827, cell: 366 }, { monsterId: 3824, cell: 409 }], [])
    expect([...(t.sources.get(plan.endCell) ?? [])]).toEqual([])
  }, 120_000)

  it('Krobe condamné (compte à rebours qui expire à son tour) : ignoré, phase de tank (combat gagné du 2026-10-17, manche 5)', () => {
    // Pataugerme relancé à son tour de la manche 2, sans relance ensuite : il meurt à son tour de la manche 5, avant de
    // jouer. Le Féca (qui joue le premier) reste au contact du Verminocule et se protège (en jeu : 12 PA pour tuer la
    // Malamibe du Pataugerme, morte avec lui, puis fuite en 258 ; Verminocule relancé, mort en manche 8).
    const cases = { [FECA]: 374, [PAT]: 373, [VERM1]: 388 }
    const ordre = [FECA, PAT, VERM1]
    const relance = (id: number, sort: number) =>
      m('juh', { fxet: { gdzl: { gdps: 0, gdpt: { gcqz: 0, gcra: 4 }, gdpw: ++i, gdpx: 0, gdpz: id, gdqb: 0, gdqf: 'I', gdqh: sort }, gdzm: 141, gdzn: id } })
    // (Verminocule relancé à son tour de la manche 4 : personne à son contact)
    const rows = [...debut(cases, ordre), m('jvi', { fxjj: 2 }), m('jvj', { fxjr: PAT }), relance(PAT, 4959), m('jup', { fxgo: PAT }),
      m('jvi', { fxjj: 3 }), m('jvi', { fxjj: 4 }), m('jvj', { fxjr: VERM1 }), relance(VERM1, 4942), m('jup', { fxgo: VERM1 }),
      m('jvi', { fxjj: 5 }), m('jvj', { fxjr: FECA })]
    const st = etatCombat(rows, { mapId: 140772356 })
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: SORTS_KASKYZO } })
    const plan = planTourFeca(st, mo).plans[0]
    expect(plan.notes[0]).toBe('phase de tank')
    expect(plan.notes[1]).toMatch(/^condamnés : Pataugerme/)
    expect(distance(plan.endCell, 388)).toBe(1)
    expect(plan.notes.some(n => n.startsWith('protections'))).toBe(true)
  }, 120_000)

  it('Krobe encore en vie après sa mort attendue (relance que le journal n’a pas vue) : pas condamné', () => {
    // 2026-10-17, 13:26 : Tabacille lancée en manche 1, relancée en manche 3 par le soin de « Le Singe et la Lune »
    // (pendant le tour du Féca, journal muet) ; crue condamnée dès la manche 4, Malamibe laissée en vie, Féca tué.
    const cases = { [FECA]: 212, [TAB1]: 332, [VERM1]: 346 }
    const rows = [...debut(cases, [FECA, VERM1, TAB1]), ...[2, 3, 4, 5, 6].map(r => m('jvi', { fxjj: r })), m('jvj', { fxjr: FECA })]
    const st = etatCombat(rows, { mapId: 140515587 })
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: SORTS_KASKYZO } })
    const plan = planTourFeca(st, mo).plans[0]
    expect(plan.notes[0]).toBe('phase de fuite')
    expect(plan.notes.some(n => n.startsWith('condamnés') && n.includes('Tabacille'))).toBe(false)
  }, 120_000)

  it('encerclé (salle annexe, manche 5 du 2026-10-17) : se dégage au lieu de rester au contact des trois', () => {
    // En jeu : Ataraxie, Silbo, fin en 370 au contact des trois (−2 024 PV à la manche suivante).
    const cases = { [FECA]: 399, [VERM1]: 412, [VERM2]: 384, [PAT]: 385 }
    const relance = (id: number, sort: number) =>
      m('juh', { fxet: { gdzl: { gdps: 0, gdpt: { gcqz: 0, gcra: 4 }, gdpw: ++i, gdpx: 0, gdpz: id, gdqb: 0, gdqf: 'I', gdqh: sort }, gdzm: 141, gdzn: id } })
    const tour = (id: number, sort: number) => [m('jvj', { fxjr: id }), relance(id, sort), m('jup', { fxgo: id })]
    const rows = [...debut(cases, [FECA, PAT, VERM1, VERM2]), m('jvi', { fxjj: 2 }), m('jvi', { fxjj: 3 }), m('jvi', { fxjj: 4 }),
      ...tour(PAT, 4959), ...tour(VERM1, 4942), ...tour(VERM2, 4942), m('jvi', { fxjj: 5 }), m('jvj', { fxjr: FECA })]
    const st = etatCombat(rows, { mapId: 140773380 })
    // Protections lancées aux manches 2 à 4 : en relance.
    st.lastCast.set(st.current!, new Map([[SORT.barricade, 2], [SORT.bastion, 2], [SORT.rempart, 3], [SORT.bouclierFeca, 3], [SORT.defiance, 4]]))
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: SORTS_KASKYZO } })
    // (PV du Féca en jeu à ce tour : 2 868 sur 3 999)
    Object.assign(mo.fight.fighters[mo.me], { hp: 2868, maxHp: 3999, baseMaxHp: 3999 })
    const plan = planTourFeca(st, mo).plans[0]
    expect(plan.notes[0]).toBe('phase de fuite')
    const t = threats(data.map(140773380)!, [{ monsterId: 3824, cell: 412 }, { monsterId: 3824, cell: 384 }, { monsterId: 3827, cell: 385 }], [])
    expect(t.sources.get(plan.endCell)?.size ?? 0).toBeLessThan(3)
  }, 120_000)

  /**
   * Phase de tank, manche 6 : Féca (qui joue le premier) au contact du Verminocule (relancé en manche 5), Barricade en
   * relance ; Malamibe invoquée par le Verminocule en manche `invoquee`, après le tour du Féca.
   */
  function malamibeAuTour(invoquee: number, pv: number, sorts = SORTS_KASKYZO) {
    const cases = { [FECA]: 329, [VERM1]: 316, [MALA]: 275 }
    const relance = m('juh', { fxet: { gdzl: { gdps: 0, gdpt: { gcqz: 0, gcra: 4 }, gdpw: ++i, gdpx: 0, gdpz: VERM1, gdqb: 0, gdqf: 'I', gdqh: 4942 }, gdzm: 141, gdzn: VERM1 } })
    const rows = [...debut(cases, [FECA, VERM1, MALA]), ...[2, 3, 4].map(r => m('jvi', { fxjj: r })),
      m('jvi', { fxjj: 5 }), m('jvj', { fxjr: VERM1 }), relance, m('jup', { fxgo: VERM1 }), m('jvi', { fxjj: 6 }), m('jvj', { fxjr: FECA })]
    const st = etatCombat(rows, { mapId: 140772356 })
    const mala = st.res.fighters.find(f => f.gameId === MALA)!.id
    st.malamibe = { id: mala, summonRound: invoquee, turnsPlayed: 0 }
    // (Barricade lancée en manche 4 : encore en relance)
    st.lastCast.set(st.current!, new Map([[SORT.barricade, 4]]))
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: sorts } })
    mo.fight.fighters[mo.eid.get(mala)!].hp = pv
    return planTourFeca(st, mo).plans[0]
  }

  it('Malamibe à son 1er tour : dommages qui laissent de quoi la finir au tour suivant, et protections', () => {
    const plan = malamibeAuTour(5, 2001)
    expect(plan.notes.find(n => n.startsWith('Malamibe 1er tour'))).toBeDefined()
    expect(plan.notes.some(n => n.startsWith('protections'))).toBe(true)
    expect(distance(plan.endCell, 316)).toBe(1)
  }, 120_000)

  it('phase de tank : Défiance sous le Féca, son glyphe frappe le Verminocule à son contact (pour la Malamibe)', () => {
    // 2026-10-17, combat perdu à 12:19 : glyphe de Défiance déclenché par la Tabacille en fin de tour, 860 dommages
    // reportés sur la Malamibe (Terre, Feu, Eau et Air), pour 2 PA.
    const plan = malamibeAuTour(5, 2001)
    expect(lancers(plan, SORT.defiance)).toBe(1)
    expect(plan.notes.some(n => n.startsWith('glyphe de Défiance'))).toBe(true)
  }, 120_000)

  it('Malamibe à son 2e tour : elle doit mourir (sinon le Féca est tué au 3e)', () => {
    const plan = malamibeAuTour(4, 857)
    expect(plan.notes.find(n => n.startsWith('Malamibe à tuer'))).toBeDefined()
    // tuée avec la marge (1,25 × ses PV : les dommages prévus dépassent souvent les vrais de quelques %) : 3 × la marge +
    // le bonus de mort, sans pénalité
    expect(plan.parts.malamibe).toBe(Math.round(3 * 1.25 * 857 + 1500))
  }, 120_000)

  it('Tabacille à portée de Remontée gastrique (relais compris) : pas de protections d’un tour gaspillées', () => {
    // Combat perdu du 2026-10-17 (12:19), manche 1 : Rempart, Bastion, Barricade, Bouclier Féca, Ataraxie, Défiance, fin
    // en 326 ; la Tabacille (à 9 cases) s'échange avec la Bacterrib puis la Virustine, sa Remontée gastrique retire les
    // protections, Virustine et Bacterrib frappent ensuite (−904 PV).
    const cases = { [FECA]: 342, [VERM1]: 357, [TAB1]: 401, [VIRUS]: 370, [BAC1]: 413 }
    const st = etatCombat([...debut(cases, [FECA, VERM1, TAB1, VIRUS, BAC1]), m('jvj', { fxjr: FECA })], { mapId: 140513539 })
    // (Transhumance en relance : pas de repli hors de portée de la Tabacille)
    st.lastCast.set(st.current!, new Map([[SORT.transhumance, 1]]))
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: SORTS_KASKYZO } })
    const plan = planTourFeca(st, mo).plans[0]
    // (Bouclier Féca tient un retrait : il protège encore de la Virustine, qui joue entre la Tabacille et la Bacterrib)
    for (const sort of [SORT.bastion, SORT.rempart]) expect(lancers(plan, sort)).toBe(0)
    expect(plan.notes.some(n => /Bouclier Féca.*Tabacille/.test(n))).toBe(false)
  }, 120_000)

  it('Échange subtil des Tabacilles : prévu, et la Pesanteur d’Ataraxie le bloque', () => {
    // Combat perdu du 2026-10-17 (17:43) : deux échanges dès la manche 1 ramènent le Féca au milieu des monstres (−839 PV,
    // puis −2 723 en manche 2). Journaux du jour : aucun échange sur 11 tours de Tabacille sous Ataraxie (comme la vidéo).
    // Ici, sans PM ni Transhumance : la Tabacille, alignée à 3 cases, l'échangerait au contact du Verminocule.
    const cases = { [FECA]: 346, [TAB1]: 302, [VERM1]: 288 }
    const plan = (sorts: typeof SORTS) => {
      const st = etatCombat([...debut(cases, [FECA, TAB1, VERM1]), m('jvj', { fxjr: FECA })], { mapId: 140513539 })
      st.lastCast.set(st.current!, new Map([[SORT.transhumance, 1]]))
      const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 0, spells: { Feca: sorts } })
      return planTourFeca(st, mo).plans[0]
    }
    const avec = plan(SORTS_VERGLAS)
    expect(lancers(avec, SORT.ataraxie)).toBe(1)
    expect(avec.notes).toContain('sous Pesanteur : pas d’échange des Tabacilles')
    const sans = plan(SORTS_VERGLAS.filter(x => x.spellId !== SORT.ataraxie))
    expect(sans.notes.some(n => n.startsWith('échangé par une Tabacille'))).toBe(true)
  }, 120_000)

  it('Gonflement : l’attirance du Féca au contact du Verminocule est prévue, sauf sous Inébranlable (Bergerie)', () => {
    // Combat perdu du 2026-10-17 (13:42), manche 4 : fin en 489, à portée d'un seul Verminocule ; son Gonflement l'a attiré
    // en 460, à portée des deux autres et de la Virustine (−1 678 PV). Bergerie (Inébranlable) empêche l'attirance.
    const cases = { [FECA]: 460, [VERM1]: 445, [VERM3]: 374, [VIRUS]: 346, [VERM2]: 387 }
    // (manche 2 : les Krobes, lancés en manche 1, ne sont pas condamnés)
    const rows = [...debut(cases, [FECA, VERM1, VERM3, VIRUS, VERM2]), m('jvi', { fxjj: 2 }), m('jvj', { fxjr: FECA })]
    const st = etatCombat(rows, { mapId: 140516611 })
    // (Barricade lancée en manche 1, Transhumance en relance : pas de repli lointain)
    st.lastCast.set(st.current!, new Map([[SORT.barricade, 1], [SORT.transhumance, 2]]))
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: SORTS_KASKYZO } })
    const plan = planTourFeca(st, mo).plans[0]
    const t = threats(data.map(140516611)!, [445, 374, 387].map(cell => ({ monsterId: 3824, cell })).concat([{ monsterId: 3826, cell: 346 }]), [])
    const pullers = [...(t.sources.get(plan.endCell) ?? [])].filter(c => [445, 374, 387].includes(c) && distance(c, plan.endCell) > 1)
    if (pullers.length) expect(plan.notes.some(n => n.startsWith('attiré') || n.startsWith('Inébranlable'))).toBe(true)
  }, 120_000)

  it('Lanterne du Berger (Verglas, variante de Vallée) posée au contact du Verminocule : un leurre', () => {
    // Vidéo de référence, combats 2 et 3 : le Verminocule et une Tabacille frappent la Lanterne au lieu du Féca.
    const plan = malamibeAuTour(5, 2001, SORTS_VERGLAS)
    expect(lancers(plan, 13023)).toBeGreaterThan(0)
    expect(plan.notes.some(n => n.startsWith('Lanterne du Berger : leurre'))).toBe(true)
  }, 120_000)

  it('regroupement des Verminocules (Regroupement, variante de Léthargie) : rassemblés, chaque coup de zone compte trois fois', () => {
    // Vidéo de référence, combat 4 (7:22) : Regroupement sur les 3 Verminocules, puis Stratus les frappe tous (3 × 602).
    const cases = { [FECA]: 358, [VERM1]: 328, [VERM2]: 388, [VERM3]: 302, [MALA]: 275 }
    const rows = [...debut(cases, [FECA, VERM1, VERM2, VERM3, MALA]), m('jvi', { fxjj: 2 }), m('jvj', { fxjr: FECA })]
    const st = etatCombat(rows, { mapId: CARTE })
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: SORTS_VERGLAS } })
    const plan = planTourFeca(st, mo).plans[0]
    expect(lancers(plan, 13008)).toBe(1)
  }, 120_000)

  it('sort refusé pour un état (« sort@*@* ») : écarté sur toutes les cases', () => {
    // 2026-10-18 à 03:15 : Transhumance refusée (ÉTAT_REQUIS, Pesanteur) trois fois de suite, sur trois cases voisines.
    const cases = { [FECA]: 383, [VERM1]: 327, [VERM2]: 341, [MALA]: 275 }
    const { plan, st, mo } = planDe(cases)
    const first = plan.steps.find(x => x.kind === 'cast')
    expect(first).toBeDefined()
    const spell = (first as { spell: number }).spell
    const again = planTourFeca(st, mo, { forbid: new Set([`${spell}@*@*`]) }).plans[0]
    expect(lancers(again, spell)).toBe(0)
  }, 120_000)

  it('Bacterribs mortes : au contact du Verminocule, sous Barricade', () => {
    // Fin de la vidéo (1:51) : deux Verminocules groupés, Féca à 3 cases.
    const { plan } = planDe({ [FECA]: 383, [VERM1]: 327, [VERM2]: 341, [MALA]: 275 })
    expect(Math.min(distance(plan.endCell, 327), distance(plan.endCell, 341))).toBe(1)
    expect(lancers(plan, SORT.barricade)).toBe(1)
  }, 120_000)
})

describe('mules du Féca (2026-10-17 : Féca et 5 mules)', () => {
  it('1er tour : il tue les mules à la Bulle et à l’arme, les seuls de ses coups qui les touchent vraiment (2 000 PV de moins chacune pour la Malamibe)', () => {
    // Trois mules de 300 PV à 4 cases du Féca ; Krobes loin. (Les autres sorts ne comptent pas sur les alliés : en jeu,
    // Silbo 14 à 33 par mule, Giboulée 59 à 132, 2026-10-18.)
    const cases = { [FECA]: 358, [FECA + 1]: 287, [FECA + 2]: 288, [FECA + 3]: 316, [VERM1]: 92, [BAC1]: 65 }
    const { plan } = planDe(cases, { sorts: SORTS_STRATUS })
    expect(lancers(plan, SORT.bulle) + lancers(plan, 0)).toBeGreaterThanOrEqual(2)
    expect(plan.parts.mules).toBeGreaterThanOrEqual(2 * 800)
    expect(plan.parts.friendly).toBe(0)
  }, 120_000)

  it('coup d’arme (spellId 0, mesuré le 2026-10-18) : deux mules alignées tuées d’un coup, sans toucher le Féca', () => {
    // 2026-10-18 à 00:41 : arme sur Kimera-Meruem (case 344, morte), Kimera-Pitou derrière elle (358) −699. Ici le Féca en
    // 358, deux mules en 344 et 329 ; Krobes loin. Le moteur ne connaît pas le sort 0 : niveau construit sur Bulle.
    const cases = { [FECA]: 358, [FECA + 1]: 344, [FECA + 2]: 329, [VERM1]: 92, [BAC1]: 65 }
    const { plan } = planDe(cases, { sorts: SORTS_STRATUS })
    expect(plan.steps.some(x => x.kind === 'cast' && x.spell === 0)).toBe(true)
    expect(plan.parts.mules).toBeGreaterThanOrEqual(2 * 800)
    expect(plan.parts.friendly).toBe(0)
  }, 120_000)

  it('tueuse (Kyanna-Lee) : le Féca entame ses PV sans la tuer tant qu’une mule vit', () => {
    // Consigne du joueur (2026-10-17) : au 1er tour, le Féca frappe Kyanna-Lee pour qu'elle meure vite chez les monstres,
    // après avoir tué les mules à son tour. Ici, Kyanna-Lee (1 500 PV) et une mule à côté d'elle, à 4 cases du Féca.
    const cases = { [FECA]: 358, [KYANNA]: 301, [FECA + 1]: 287, [VERM1]: 92, [BAC1]: 65 }
    const st = etatCombat([...debut(cases, [FECA, KYANNA, FECA + 1, VERM1, BAC1]), m('jvj', { fxjr: FECA })], { mapId: CARTE })
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: SORTS_STRATUS } })
    for (const f of mo.fight.fighters) if (f.name === 'Kyanna-Lee') Object.assign(f, { hp: 1500, maxHp: 1500, baseMaxHp: 1500 })
    const plan = planTourFeca(st, mo).plans[0]
    expect(plan.parts.tueuse).toBeGreaterThan(0)
    expect(plan.parts.friendly).toBe(0)
  }, 120_000)

  it('placement : mules en appât, groupées au plus près des monstres, hors de la case du Féca', () => {
    // Combat perdu du 2026-10-17 à 20:07 : Tabacille 415, Verminocule 403, Virustine 457 ; Féca en 174 ; mules groupées
    // à côté de lui (187, 188, 201, 214, 229), à 11-12 cases des monstres, jamais touchées.
    const cells = [174, 187, 188, 201, 214, 217, 229, 232, 245, 258, 259, 272]
    const mons = [{ monsterId: 3823, cell: 415 }, { monsterId: 3824, cell: 403 }, { monsterId: 3826, cell: 457 }]
    const r = ordreDesMules(data.map(140515587)!, mons, cells, [174])
    expect(r.ordre).not.toContain(174)
    const near = (c: number) => Math.min(...mons.map(m => distance(m.cell, c)))
    const premieres = r.ordre.slice(0, 5)
    const moyenne = premieres.reduce((s, c) => s + near(c), 0) / premieres.length
    expect(moyenne).toBeLessThan(11)
    const zone = new Set(zoneCells({ shape: 'G', size: 1 } as Parameters<typeof zoneCells>[0], r.centre, r.centre))
    for (const c of r.ordre.slice(0, r.couvertes)) expect(zone.has(c)).toBe(true)
  })
})

describe('état visible d’un personnage seul (appliquerEtatDirect)', () => {
  it('Malamibe absente du journal (invoquée au tour d’avant) : ajoutée depuis l’état visible, comme cible, à son 1er tour', () => {
    const cases = { [FECA]: 358, [VERM1]: 92 }
    const st = etatCombat([...debut(cases, [FECA, VERM1]), m('jvj', { fxjr: FECA })], { mapId: CARTE })
    const d = lireEtatDirect({ entites: `${FECA}:358:4962:4962:12:5:0;${VERM1}:92:1000:1000:12:5:3824;-50:93:12001:12001:0:0:3822`, lances: '', tour: '1' })!
    appliquerEtatDirect(st, st.current!, d)
    const mala = st.res.fighters.find(f => f.monsterId === 3822)
    expect(mala).toBeDefined()
    expect(st.truth.alive.has(mala!.id)).toBe(true)
    expect(st.truth.hp.get(mala!.id)).toBe(12001)
    const mo = moteurDuTour(st, st.current!, { ap: 12, mp: 5, spells: { Feca: SORTS_STRATUS } })
    // (invoquée dans cette manche, pas encore à tuer : 2026-10-17 à 23:43, tenue pour à tuer, le Féca a frappé les Krobes)
    expect(planTourFeca(st, mo).plans[0].notes.some(n => n.startsWith('Malamibe 1er tour'))).toBe(true)
  }, 120_000)

  it('recale cases, PV, morts, tour en cours et relances sur l’état envoyé par le script', () => {
    const cases = { [FECA]: 358, [BAC1]: 65, [VIRUS]: 274, [MALA]: 94 }
    const ordre = [FECA, BAC1, VIRUS, MALA]
    // Manche 3 : le journal a vu la fin du tour du dernier monstre, pas le début du tour du Féca (silence).
    const rows = [...debut(cases, ordre), m('jvi', { fxjj: 2 }), m('jvi', { fxjj: 3 })]
    const st = etatCombat(rows, { mapId: CARTE })
    const feca = st.res.fighters.find(f => f.kind === 'player')!.id
    const id = (g: number) => st.res.fighters.find(f => f.gameId === g)!.id
    const d = lireEtatDirect({
      // Féca en 429 ; Bacterrib poussée en 79 ; Virustine à 640 PV ; Malamibe absente (tuée à son tour précédent) ;
      // une Lanterne du Berger inconnue du journal en 300.
      entites: `${FECA}:429:4500:4962:12:5:0;${BAC1}:79:1000:1000:12:5:3825;${VIRUS}:274:640:1000:12:7:3826;-77:300:500:500:0:0:5903`,
      // Stratus au 1er tour, Barricade au 2e, Bulle au tour en cours (3e).
      lances: `${SORT.stratus}:1;${SORT.barricade}:2;${SORT.bulle}:3`,
      tour: '3',
    })!
    const { obstacles } = appliquerEtatDirect(st, feca, d)
    expect(st.current).toBe(feca)
    expect(st.truth.cell.get(feca)).toBe(429)
    expect(st.truth.cell.get(id(BAC1))).toBe(79)
    expect(st.truth.hp.get(id(VIRUS))).toBe(640)
    expect(st.truth.alive.has(id(MALA))).toBe(false)
    expect(obstacles).toEqual([300])
    expect(st.round).toBe(3)
    expect(st.lastCast.get(feca)?.get(SORT.stratus)).toBe(1)
    expect(st.lastCast.get(feca)?.get(SORT.barricade)).toBe(2)
    expect(st.turnCasts.map(c => c.spellId)).toEqual([SORT.bulle])
    // Barricade (relance 4) lancée en manche 2 : encore 3 tours ; Lanterne en 300 : infranchissable pour le moteur.
    const mo = moteurDuTour(st, feca, { ap: 10, mp: 5, spells: { Feca: SORTS }, obstacles })
    expect(mo.fight.fighters[mo.me].cooldowns[SORT.barricade]).toBe(3)
    expect(mo.fight.map.cells[300].walkable).toBe(false)
  })

  it('manche d’AnkaBot en avance sur le journal, lancers par cible (Bulle : 2 fois par cible)', () => {
    const cases = { [FECA]: 358, [VIRUS]: 274 }
    const st = etatCombat([...debut(cases, [FECA, VIRUS]), m('jvi', { fxjj: 2 })], { mapId: CARTE })
    const feca = st.res.fighters.find(f => f.kind === 'player')!.id
    const virus = st.res.fighters.find(f => f.gameId === VIRUS)!.id
    // Manche 3 pour AnkaBot (le journal n'a pas reçu son début) ; Bulle lancée deux fois sur la Virustine ce tour-ci.
    const d = lireEtatDirect({
      entites: `${FECA}:358:4962:4962:8:5:0;${VIRUS}:274:1000:1000:12:7:3826`,
      lances: `${SORT.bulle}:2:274:${VIRUS};${SORT.bulle}:2:274:${VIRUS}`,
      tour: '2',
      manche: '3',
    })!
    appliquerEtatDirect(st, feca, d)
    expect(st.round).toBe(3)
    expect(st.lastCast.get(feca)?.get(SORT.bulle)).toBe(3)
    const mo = moteurDuTour(st, feca, { ap: 8, mp: 5, spells: { Feca: SORTS } })
    expect(mo.fight.fighters[mo.me].castsOnTarget[`${SORT.bulle}:${mo.eid.get(virus)}`]).toBe(2)
  })
})

describe('variantes équipées', () => {
  it('la liste du jeu (sorts de base) prend les variantes déclarées', () => {
    const ids = SORTS_KASKYZO.map(s => s.spellId)
    for (const v of [13022, 13027, 29045]) expect(ids).toContain(v) // Giboulée, Ataraxie, Escapade
    for (const b of [12989, 13020, 14434]) expect(ids).not.toContain(b) // Frisson, Renfort, Torpeur
    expect(ids).toHaveLength(22)
  })
})
