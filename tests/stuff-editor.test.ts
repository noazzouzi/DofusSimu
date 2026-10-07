/**
 * Éditeur d'équipe de la section « Stuffs » (src/optimizer/team/editor.ts, `saveTeamDraft` de teamfile.ts) et import
 * des liens RoxxSolver (src/optimizer/team/roxx.ts). Les écritures se font dans un dossier temporaire.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { draftTeamFile, editorMeta, itemCatalog, previewTeam, teamFileFromDraft, teamFileName } from '../src/optimizer/team/editor'
import { decodeRoxxBuild, roxxBuildParam, roxxImport } from '../src/optimizer/team/roxx'
import { loadTeamFile, saveTeamDraft, TEAMS_DIR, teamStuffs } from '../src/optimizer/team/teamfile'
import type { DraftMember } from '../src/stats/sheet'

const data = loadDataStore()
const vortex = teamStuffs(data, join(TEAMS_DIR, 'vortex.json'))
/** Lien partagé par l'utilisateur (Crâ, 2026-10-06). */
const ROXX =
  'https://roxxsolver.com/solver?build=AQGbyAL__04SSQw1SU4QNUpOETdSN1F9eTSZVfR29RuDAuN29wK2Ax5LHvGQZAUB_wEpAAgBLgABAS4AAQEuAAEBCQABAQgAAQEuAAEBKQAIASkACA&config=AQEDtg0AAwIEVgQVBgwA9AEMAAcGAPQBBgALyAAPAP9_BQmH7MP-Ifr0_WoHJv8BARsIAAEgAQABIAEAASABAAEHAQABBgEAASABAAEbCAABGwgA'

const tmpTeams = () => mkdtempSync(join(tmpdir(), 'dofussimu-teams-'))

describe('brouillons et aperçu', () => {
  it('brouillons de l’équipe du Vortex : presets seuls (aucun build personnalisé dans le fichier)', () => {
    expect(vortex.fileName).toBe('vortex.json')
    expect(vortex.drafts.map(d => [d.breedId, d.preset, d.build])).toEqual([
      [7, 'eniripsa_soin_vortex', undefined],
      [3, 'enutrof_retrait_pm_vortex', undefined],
      [9, 'cra_terre_mono_vortex', undefined],
      [9, 'cra_terre_mono_vortex_def', undefined],
    ])
  })

  it('l’aperçu d’un brouillon inchangé redonne les fiches de l’équipe, avec builds et forgemagie possible', () => {
    const p = previewTeam(data, 'vortex', vortex.drafts)
    expect(p.error).toBeUndefined()
    expect(p.members.map(m => m.sheet)).toEqual(vortex.members)
    expect(p.members[2].build.items).toHaveLength(16)
    const anyItem = p.members[2].build.items[0].itemId
    expect(p.members[2].forge[anyItem]?.length).toBeGreaterThan(0)
  })

  it('build personnalisé : un objet changé change la fiche ; classe sans preset : preset par défaut du scénario', () => {
    const p0 = previewTeam(data, 'vortex', vortex.drafts)
    const build = structuredClone(p0.members[2].build)
    build.items = build.items.filter(it => data.item(it.itemId)?.slot !== 'weapon')
    const drafts: DraftMember[] = [...vortex.drafts.slice(0, 2), { ...vortex.drafts[2], build }, { breedId: 8 }]
    const p = previewTeam(data, 'vortex', drafts)
    expect(p.error).toBeUndefined()
    expect(p.members[2].sheet.items).toHaveLength(15)
    expect(p.members[2].sheet.stuffLabel).toBeUndefined() // stuff personnalisé
    expect(p.members[3].sheet.className).toBe('Iop')
    expect(p.members[3].preset).toMatch(/^iop_/)
  })

  it('équipe invalide : erreur lisible, pas d’exception', () => {
    expect(previewTeam(data, 'vortex', [{ breedId: 9, preset: 'iop_terre_burst' }]).error).toMatch(/preset Iop, pas Crâ/)
    expect(previewTeam(data, 'vortex', Array.from({ length: 9 }, () => ({ breedId: 9 }))).error).toMatch(/8 au plus/)
  })
})

describe('fichier d’équipe écrit', () => {
  it('en-tête conservé, note datée, `optimized` retiré dès que les membres changent', () => {
    const original = loadTeamFile(join(TEAMS_DIR, 'vortex.json')).file
    const same = teamFileFromDraft({ ...original, optimized: { report: 'x' } }, 'vortex', vortex.drafts, '2026-10-06')
    expect(same.members).toEqual(original.members)
    expect(same.notes).toEqual(original.notes)
    expect(same.optimized).toEqual({ report: 'x' })
    expect(same.description).toBe(original.description)
    const drafts: DraftMember[] = [...vortex.drafts.slice(0, 3), { breedId: 8, name: 'Iop' }]
    const changed = teamFileFromDraft({ ...original, optimized: { report: 'x' } }, 'vortex', drafts, '2026-10-07')
    expect(changed.optimized).toBeUndefined()
    expect(changed.decidedAt).toBe('2026-10-07')
    expect(changed.description).toMatch(/Eniripsa, Enutrof, Crâ, Iop/)
    expect((changed.notes as string[]).at(-1)).toMatch(/^Modifié dans l'interface .* le 2026-10-07 : Eniripsa, Enutrof, Crâ, Iop \(composition changée\)\.$/)
    expect(changed.members[3]).toEqual({ class: 'iop', name: 'Iop' })
  })

  it('stuff nommé écrit en `preset@stuff`, build personnalisé écrit en entier', () => {
    const f = draftTeamFile('vortex', [
      { breedId: 9, preset: 'cra_terre_mono', stuff: 'vortex_cra_terre_mono_def' },
      { breedId: 9, preset: 'cra_feu_vortex', build: { items: [{ itemId: 14080 }], characteristicPoints: { intelligence: 995 } }, fixed: true },
    ])
    expect(f.members[0]).toEqual({ class: 'cra', preset: 'cra_terre_mono@vortex_cra_terre_mono_def' })
    expect(f.members[1]).toMatchObject({ preset: 'cra_feu_vortex', fixed: true, build: { items: [{ itemId: 14080 }] } })
  })

  it('saveTeamDraft : écrit, relit les mêmes fiches, refuse d’écraser sans `overwrite` et un autre scénario', () => {
    const dir = tmpTeams()
    const drafts: DraftMember[] = [...vortex.drafts.slice(0, 3), { breedId: 8 }]
    const team = saveTeamDraft(data, 'Vortex Iop', 'vortex', drafts, { overwrite: false, dir, date: '2026-10-06' })
    expect(team.fileName).toBe('vortex-iop.json')
    expect(team.error).toBeUndefined()
    expect(team.members.map(m => m.className)).toEqual(['Eniripsa', 'Enutrof', 'Crâ', 'Iop'])
    const written = JSON.parse(readFileSync(join(dir, 'vortex-iop.json'), 'utf8'))
    expect(written.chosenBy).toBe('utilisateur')
    expect(written.notes).toEqual(["Créé dans l'interface (section Stuffs) le 2026-10-06 : Eniripsa, Enutrof, Crâ, Iop."])
    const copy = saveTeamDraft(data, 'copie', 'vortex', vortex.drafts, { overwrite: false, dir, date: '2026-10-06', from: 'data/teams/vortex.json' })
    expect(copy.notes.at(-1)).toBe("Créé dans l'interface (section Stuffs) le 2026-10-06 à partir de data/teams/vortex.json : Eniripsa, Enutrof, Crâ, Crâ.")
    expect(() => saveTeamDraft(data, 'vortex-iop', 'vortex', drafts, { overwrite: false, dir })).toThrow(/existe déjà/)
    writeFileSync(join(dir, 'autre.json'), JSON.stringify({ version: 1, scenario: 'skirmish', members: ['iop'] }))
    expect(() => saveTeamDraft(data, 'autre', 'vortex', drafts, { overwrite: true, dir })).toThrow(/scénario « skirmish »/)
  })

  it('noms de fichiers sûrs', () => {
    expect(teamFileName('Vortex — équipe Feu !')).toBe('vortex-equipe-feu.json')
    expect(teamFileName('vortex.json')).toBe('vortex.json')
    expect(() => teamFileName('../..')).toThrow()
  })
})

describe('données de l’éditeur', () => {
  it('classes, presets du scénario en tête, catalogue d’objets par emplacement', () => {
    const meta = editorMeta('vortex')
    expect(meta.classes).toHaveLength(19)
    expect(meta.presets[0].scenario).toBe(true)
    expect(meta.roles.find(r => r.id === 'healer')?.label).toBe('Soigneur')
    const items = itemCatalog(data)
    expect(items.length).toBeGreaterThan(3000)
    const amulet = items.find(it => it.id === 14080)!
    expect(amulet).toMatchObject({ slot: 'amulet', name: 'Amulette Séculaire', level: 200, setName: 'Panoplie Séculaire' })
    expect(amulet.lines).toContain('300 Vitalité')
  })
})

describe('import RoxxSolver', () => {
  it('décode le lien de l’utilisateur', () => {
    const r = decodeRoxxBuild(ROXX)
    expect(r).toMatchObject({ version: 1, level: 200, roxxClass: 8, breedId: 9, weaponElement: 0, hasScrolls: false, name: '' })
    expect(r.items).toEqual([19986, 18700, 13641, 19984, 13642, 19985, 14162, 14161, 32121, 13465, 22004, 30453, 7043, 739, 30455, 694])
    expect(r.points).toEqual({ strength: 300, intelligence: 495, chance: 100, agility: 100 })
    expect(r.forge.map(f => f.map(l => `${l.stat}:${l.value}`).join())).toEqual([
      'criticalDamage:8', 'rangedDamagePct:1', 'rangedDamagePct:1', 'rangedDamagePct:1', 'mp:1', 'ap:1', 'rangedDamagePct:1', 'criticalDamage:8', 'criticalDamage:8',
      '', '', '', '', '', '', '',
    ])
  })

  it('build importé : transcendances reconnues, exos PA/PM, build valide de 995 points', () => {
    const imp = roxxImport(ROXX, data)
    expect(imp.breedId).toBe(9)
    expect(imp.warnings).toEqual(['Le lien ne contient pas de parchemins : 0 partout (à vérifier).'])
    const byId = new Map(imp.build.items.map(it => [it.itemId, it.exos]))
    expect(byId.get(19986)).toEqual([{ stat: 'criticalDamage', value: 8, kind: 'transcendence' }]) // Arc Volkorne, niv. 200
    expect(byId.get(18700)).toEqual([{ stat: 'rangedDamagePct', value: 1 }]) // Quatre-feuilles niv. 193 < rune niv. 200 : exo
    expect(byId.get(19985)).toEqual([{ stat: 'ap', value: 1 }])
    const p = previewTeam(data, 'vortex', [{ breedId: 9, preset: 'cra_terre_mono_vortex', build: imp.build }])
    expect(p.error).toBeUndefined()
    expect(p.members[0].sheet.valid).toBe(true)
    expect(p.members[0].sheet.points).toEqual({ available: 995, spent: 995, remaining: 0 })
  })

  it('paramètre seul ou lien ; liens invalides refusés avec un message clair', () => {
    const param = roxxBuildParam(ROXX)
    expect(decodeRoxxBuild(param).breedId).toBe(9)
    expect(decodeRoxxBuild(`build=${param}`).breedId).toBe(9)
    expect(() => roxxBuildParam('https://example.com/?build=AQ')).toThrow(/roxxsolver\.com/)
    expect(() => roxxBuildParam('https://roxxsolver.com/solver?config=AQ')).toThrow(/build/)
    expect(() => decodeRoxxBuild('Ag')).toThrow(/version/)
    expect(() => decodeRoxxBuild('AQIA')).toThrow(/tronqué/)
  })
})
