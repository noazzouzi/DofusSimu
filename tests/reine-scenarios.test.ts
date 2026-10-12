/**
 * Scénarios des placements de la Reine des Voleurs (tools/reine-des-voleurs/scenarios) : combats d'une session
 * extraits des journaux fusionnés, appris dans la bibliothèque de leur placement, compilés en scénario optimal (meilleur
 * tour par situation), correspondance plateau du jeu ↔ situation, couverture ; sur des combats synthétiques au format
 * du journal AnkaBot (les journaux réels ne sont pas versionnés).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { distance } from '../src/map/geometry'
import { luaScenarios, type TurnPlan } from '../tools/fightlog/scenario'
import { fightsOfFile, learn } from '../tools/reine-des-voleurs/scenarios/apprendre'
import { addFight, decodeEntry, emptyLibrary, encodeEntry, loadLibrary, type Library } from '../tools/reine-des-voleurs/scenarios/bibliotheque'
import { boardOf, chooseBranch, compilePlacement, coverage, LOIN, markFar, matchPlan } from '../tools/reine-des-voleurs/scenarios/compilation'
import { loadRegistry, recognize, saveRegistry, signature, type Registry } from '../tools/reine-des-voleurs/scenarios/placements'
import { ALPHA, BETA, typicalFight, writeSession } from './helpers/reine-synthetique'

const tmp = mkdtempSync(join(tmpdir(), 'reine-scenarios-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function freshRoot(name: string): string {
  const root = join(tmp, name)
  mkdirSync(join(root, 'data', 'reine'), { recursive: true })
  return root
}

describe('extraction des combats d’une session', () => {
  const logs = join(tmp, 'extraction')
  // Journal d'Alpha muet pendant ses tours (script qui joue), celui de Beta complet ; deux combats dans la session.
  const file = writeSession(logs, 'session-10-00-00', [typicalFight(), typicalFight({ queen2: 175, win: false })], { quiet: ['Alpha'] })
  const fights = fightsOfFile(file)

  it('chaque combat de la session, fusionné et reconstitué, avec son issue', () => {
    expect(fights.map(f => f.id)).toEqual(['2026-10-12/session-10-00-00.jsonl#1', '2026-10-12/session-10-00-00.jsonl#2'])
    expect(fights[0].scenario!.issue).toEqual({ fin: 'victoire', manches: 3, vagues: 1, morts: [] })
    expect(fights[1].scenario!.issue!.fin).toBe('abandon')
    expect(fights[0].scenario!.monstres.map(m => [m.espece, m.cellule])).toEqual([[3726, 133], [3746, 135]])
    expect(fights[0].scenario!.cases).toEqual({ Alpha: 354, Beta: 381 })
  })

  it('tours de Crâ : plateau quand il commence à jouer (bombe du tour comprise), PA/PM dépensés, actions exactes', () => {
    const alpha = fights[0].scenario!.plans.Alpha
    expect(alpha.map(t => t.manche)).toEqual([1, 2, 3])
    const t2 = alpha[1]
    expect(t2).toMatchObject({ manche: 2, depart: 354, fin: 354, pa: 4, pm: 2, degats: 3000, morts: [] })
    expect(t2.plateau.map(encodeEntry)).toEqual(['c' + BETA + '@381', '3725@312+', '3725@326', '3725@353', '3726@161', '3746@135'])
    expect(t2.actions).toMatchObject([
      { type: 'deplacer', chemin: [354, 340] },
      { type: 'sort', sort: 32437, cellule: 161, depuis: 340, cible: 'ennemi', espece: 3726 },
      { type: 'deplacer', chemin: [340, 354] },
    ])
    // Tour d'Alpha pris dans le journal de Beta (celui d'Alpha s'est tu) : rien ne manque.
    expect(alpha[2].degats).toBe(9000)
  })

  it('Crâ mort dans la manche qui suit un tour : noté sur ce tour', () => {
    const f = writeSession(join(tmp, 'morts'), 'session-12-00-00', [typicalFight({ death: true })])
    const sc = fightsOfFile(f)[0].scenario!
    expect(sc.issue!.morts).toEqual([{ nom: 'Beta', manche: 2 }])
    // Morts entre le début du tour et le tour suivant du même Crâ (Beta est mort après son tour de la manche 2).
    expect(sc.plans.Alpha[1].morts).toEqual(['Beta'])
    expect(sc.plans.Beta[1].morts).toEqual(['Beta'])
    expect(sc.plans.Alpha[0].morts).toEqual([])
  })
})

describe('apprentissage et bibliothèque', () => {
  it('placement inconnu ajouté au registre, combats rangés, une session relue ne double rien', () => {
    const root = freshRoot('apprendre')
    const logs = join(root, 'data', 'fightlogs')
    writeSession(logs, 'session-10-00-00', [typicalFight(), typicalFight({ queen2: 175, win: false })], { quiet: ['Alpha'] })
    const r1 = learn([logs], { root })
    expect(r1.appris).toBe(2)
    expect(r1.nouveaux).toEqual(['Auto 133-135'])
    const reg = loadRegistry(root)
    expect(reg.personnages).toEqual({ Alpha: ALPHA, Beta: BETA })
    const p = recognize(reg, [{ cellule: 135 }, { cellule: 133 }])!
    expect(p).toMatchObject({ nom: 'Auto 133-135', auto: true, cases: { Alpha: 354, Beta: 381 }, colonne: { Alpha: 354, Beta: 381 } })
    const lib1 = loadLibrary(p.nom, root)
    expect(lib1.combats).toHaveLength(2)
    const occ1 = lib1.branches.reduce((n, b) => n + b.joue.length, 0)
    expect(occ1).toBe(9)
    // Même premier tour d'Alpha dans les deux combats : une seule branche, jouée deux fois.
    expect(lib1.branches.find(b => b.perso === 'Alpha' && b.tour === 1)!.joue).toHaveLength(2)

    const r2 = learn([logs], { root })
    expect(r2.nouveaux).toEqual([])
    const lib2 = loadLibrary(p.nom, root)
    expect(lib2.combats).toHaveLength(2)
    expect(lib2.branches.reduce((n, b) => n + b.joue.length, 0)).toBe(occ1)
  })

  it('placement déclaré : reconnu par les cases des monstres, quel que soit leur ordre', () => {
    const root = freshRoot('declare')
    const reg: Registry = { version: 1, carte: 137101316, defaut: 'Placement A', personnages: {}, placements: [
      { nom: 'Placement A', monstres: [{ espece: 3746, cellule: 135 }, { espece: 3726, cellule: 133 }], cases: { Alpha: 354, Beta: 381 }, colonne: { Alpha: 354, Beta: 381 } },
    ] }
    saveRegistry(reg, root)
    writeSession(join(root, 'logs'), 'session-10-00-00', [typicalFight()])
    const r = learn([join(root, 'logs')], { root })
    expect(r.nouveaux).toEqual([])
    expect(r.lignes.join('\n')).toContain('Placement A — victoire')
    expect(loadLibrary('Placement A', root).combats).toHaveLength(1)
    expect(signature(reg.placements[0].monstres)).toBe('133-135')
  })

  it('jetons du plateau : aller-retour', () => {
    for (const t of ['c900000000001@354', '3725@326+', '3748@193~', '3726@-1']) expect(encodeEntry(decodeEntry(t))).toBe(t)
  })
})

// Bibliothèque d'un placement à partir de combats synthétiques (sans registre sur disque).
function libraryOf(fights: { spec: ReturnType<typeof typicalFight>; at?: string }[]): { reg: Registry; lib: Library } {
  const reg: Registry = { version: 1, carte: 137101316, personnages: { Alpha: ALPHA, Beta: BETA }, placements: [
    { nom: 'P', monstres: [{ espece: 3726, cellule: 133 }, { espece: 3746, cellule: 135 }], cases: { Alpha: 354, Beta: 381 }, colonne: { Alpha: 354, Beta: 381 } },
  ] }
  const lib = emptyLibrary('P')
  fights.forEach((f, k) => {
    const file = writeSession(join(tmp, `lib-${Math.random().toString(36).slice(2)}`), 'session-10-00-00', [f.spec])
    const sc = fightsOfFile(file)[0].scenario!
    sc.debut = f.at ?? `2026-10-12T1${k}:00:00`
    addFight(lib, `combat-${k + 1}`, sc)
  })
  return { reg, lib }
}

describe('compilation du scénario optimal', () => {
  it('une branche par situation : la plus souvent gagnante (taux lissé), puis la plus efficace', () => {
    const { reg, lib } = libraryOf([
      { spec: typicalFight() },                          // Alpha sort en 340, victoire
      { spec: typicalFight({ win: false }) },            // Alpha sort en 340, abandon
      { spec: typicalFight({ alphaOut: 368 }) },         // Alpha sort en 368, victoire
      { spec: typicalFight({ alphaOut: 368 }) },         // Alpha sort en 368, victoire
    ])
    const c = compilePlacement(reg, reg.placements[0], lib)
    const t1 = c.plans.Alpha[0]
    expect(t1).toHaveLength(1)
    expect(t1[0].plan.actions[0]).toMatchObject({ type: 'deplacer', cellule: 368 })
    expect(t1[0]).toMatchObject({ combats: 2, victoires: 2 })
    expect(c.stats.ecartees['moins bon qu’un autre tour de la même situation']).toBeGreaterThan(0)
  })

  it('écarte les tours suivis de morts de Crâs, les tours vides et ceux qui finissent hors de la colonne', () => {
    const { reg, lib } = libraryOf([{ spec: typicalFight({ death: true }) }])
    const c = compilePlacement(reg, reg.placements[0], lib)
    // Manche 2 : Beta meurt ; les tours d'Alpha et de Beta de la manche 2 sont écartés.
    expect(c.plans.Alpha[1] ?? []).toHaveLength(0)
    expect(c.plans.Beta[1] ?? []).toHaveLength(0)
    expect(c.stats.ecartees['suivi de morts de Crâs']).toBe(2)
    const moved = { ...reg.placements[0], colonne: { Alpha: 340, Beta: 381 } }
    const off = compilePlacement({ ...reg, placements: [moved] }, moved, lib)
    expect(off.stats.ecartees['fin hors de la colonne']).toBe(3)
    expect(off.plans.Alpha).toBeUndefined()
    // Tour passé (aucune action) : écarté, la situation revient au serveur.
    lib.branches.find(b => b.perso === 'Beta' && b.tour === 1)!.actions = []
    expect(compilePlacement(reg, reg.placements[0], lib).stats.ecartees['tour sans action']).toBe(1)
  })

  it('--depuis : les combats plus anciens sont ignorés', () => {
    const { reg, lib } = libraryOf([{ spec: typicalFight(), at: '2026-10-10T10:00:00' }, { spec: typicalFight({ alphaOut: 368 }), at: '2026-10-12T10:00:00' }])
    const c = compilePlacement(reg, reg.placements[0], lib, { depuis: '2026-10-11' })
    expect(c.stats.combats).toBe(1)
    expect(c.plans.Alpha[0][0].plan.actions[0]).toMatchObject({ cellule: 368 })
  })
})

describe('correspondance plateau du jeu ↔ situation', () => {
  const { reg, lib } = libraryOf([{ spec: typicalFight() }])
  const c = compilePlacement(reg, reg.placements[0], lib)
  const plan: TurnPlan = c.plans.Alpha[1][0].plan
  const base = boardOf(plan)
  const farCell = [...Array(560).keys()].find(x => x !== 135 && [354, 381, 340].every(y => distance(x, y) >= LOIN[3746]))!

  it('le Mâchassin, loin et pas visé par le tour d’Alpha, est marqué « loin » ; la Reine visée ne l’est pas', () => {
    expect(markFar(plan).find(e => e.espece === 3746)?.loin).toBe(true)
    expect(markFar(plan).find(e => e.espece === 3726)?.loin).toBeUndefined()
  })

  it('plateau exact ; Bonbombe du tour pas encore apparue', () => {
    expect(matchPlan(plan, base)).toEqual({ ok: true, tolerated: 0 })
    const noNewBomb = { ...base, entries: base.entries.filter(e => !(e.e === 3725 && e.c === 312)) }
    expect(matchPlan(plan, noNewBomb).ok).toBe(true)
    const noOldBomb = { ...base, entries: base.entries.filter(e => !(e.e === 3725 && e.c === 326)) }
    expect(matchPlan(plan, noOldBomb)).toMatchObject({ ok: false, reason: 'Bonbombe attendue en 326' })
  })

  it('monstre lointain ailleurs (loin aussi) toléré ; plus près, ou la Reine ailleurs : refusé', () => {
    const moved = (e: number, c2: number) => ({ ...base, entries: base.entries.map(x => (x.e === e ? { ...x, c: c2 } : x)) })
    expect(matchPlan(plan, moved(3746, farCell))).toEqual({ ok: true, tolerated: 1 })
    expect(matchPlan(plan, moved(3746, farCell), 0).ok).toBe(false)
    expect(matchPlan(plan, moved(3746, 352)).ok).toBe(false)
    expect(matchPlan(plan, moved(3726, 175)).ok).toBe(false)
  })

  it('coéquipier déplacé, monstre en plus ou en moins, départ, PM insuffisants : refusé', () => {
    expect(matchPlan(plan, { ...base, entries: base.entries.map(x => (x.e === 0 ? { ...x, c: 380 } : x)) }).ok).toBe(false)
    expect(matchPlan(plan, { ...base, entries: base.entries.filter(x => x.e !== 3746) }).ok).toBe(false)
    expect(matchPlan(plan, { ...base, entries: [...base.entries, { e: 3747, c: 20 }] }).ok).toBe(false)
    expect(matchPlan(plan, { ...base, moi: 340 }).ok).toBe(false)
    expect(matchPlan(plan, { ...base, pa: 12, pm: 1 })).toMatchObject({ ok: false, reason: '1 PM pour 2' })
    expect(matchPlan(plan, { ...base, pa: 12, pm: 6 }).ok).toBe(true)
  })

  it('monstre invisible dans la situation : sa case n’est pas comparée', () => {
    const inv: TurnPlan = { ...plan, plateau: plan.plateau.map(e => (e.espece === 3726 ? { ...e, invisible: true } : e)) }
    expect(matchPlan(inv, { ...base, entries: base.entries.map(x => (x.e === 3726 ? { ...x, c: -1 } : x)) }).ok).toBe(true)
    expect(matchPlan(inv, base).ok).toBe(true)
  })

  it('choix : la situation exacte avant celle qui tolère un monstre lointain', () => {
    const shifted: TurnPlan = { ...plan, plateau: plan.plateau.map(e => (e.espece === 3746 ? { ...e, cellule: farCell } : e)) }
    const res = chooseBranch([{ source: 9, plan: shifted }, { source: 1, plan }], base)
    expect(res.branch!.source).toBe(1)
  })
})

describe('couverture', () => {
  it('chaque combat rejoué contre le scénario appris des autres', () => {
    const { reg, lib } = libraryOf([{ spec: typicalFight() }, { spec: typicalFight() }, { spec: typicalFight({ queen2: 175 }) }])
    const cov = coverage(reg, reg.placements[0], lib)
    expect(cov.tours).toBe(15)
    // Combats 1 et 2 identiques : couverts l'un par l'autre ; combat 3 : manche 1 seulement (Reine ailleurs ensuite).
    expect(cov.parCombat.map(x => [x.couverts, x.manches])).toEqual([[5, 3], [5, 3], [2, 1]])
  })
})

describe('scénarios en Lua', () => {
  it('champs de la situation : PA/PM, bombe du tour, monstres lointains, statistiques', () => {
    const { reg, lib } = libraryOf([{ spec: typicalFight() }])
    const c = compilePlacement(reg, reg.placements[0], lib)
    const lua = luaScenarios([c], { loin: LOIN })
    expect(lua).toContain('LOIN = { [3726] = 17')
    expect(lua).toContain('S.plans["Alpha"][2] = {')
    expect(lua).toMatch(/pa = 4, pm = 2, combats = 1, victoires = 1/)
    expect(lua).toContain('{ e = 3725, c = 312, n = true }')
    expect(lua).toContain('{ e = 3746, c = 135, l = true }')
    expect(lua).toContain('colonne = {')
    writeFileSync(join(tmp, 'scenarios.lua'), lua)
    expect(readFileSync(join(tmp, 'scenarios.lua'), 'utf8')).toContain('SCENARIOS[#SCENARIOS + 1] = S')
  })
})
