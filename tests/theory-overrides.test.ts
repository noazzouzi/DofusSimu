import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadBossOverrides } from '../src/theorycraft/node'
import { parseBossOverrides } from '../src/theorycraft/overrides'

const template = JSON.parse(readFileSync(new URL('../data/bosses/_template.json', import.meta.url), 'utf8'))
const minimal = { version: 1, monsterId: 3534 }
const err = (json: unknown): string => {
  try {
    parseBossOverrides(json, 'data/bosses/3534.json')
  } catch (e) {
    return (e as Error).message
  }
  return ''
}

describe('fiches manuelles : validation', () => {
  it('le modèle _template.json est valide et entièrement repris', () => {
    const o = parseBossOverrides(template, '_template.json')
    expect(o).toEqual(template)
    expect(o).not.toBe(template) // copie
  })

  it('accepte une fiche minimale', () => {
    expect(parseBossOverrides(minimal)).toEqual({ version: 1, monsterId: 3534 })
  })

  it('refuse les clés inconnues, en citant le fichier et le chemin', () => {
    expect(err({ ...minimal, resistances: [] })).toMatch(/^data\/bosses\/3534\.json : clé inconnue « resistances »/)
    expect(err({ ...minimal, phases: [{ id: 'a', name: 'A', states: [], weight: 1, poids: 2 }] })).toMatch(/clé inconnue « phases\[0\]\.poids »/)
    expect(err({ ...minimal, adds: [{ monsterId: 1, count: 1, weight: 0.5 }] })).toMatch(/« adds\[0\]\.weight »/)
  })

  it('vérifie les types et domaines avec des messages précis', () => {
    expect(err({ version: 2, monsterId: 3534 })).toMatch(/« version » : 1 \(version du schéma\) attendu \(reçu 2\)/)
    expect(err({ version: 1 })).toMatch(/« monsterId » : un entier ≥ 1 attendu \(reçu rien\)/)
    expect(err({ ...minimal, resPct: [1, 2, 3] })).toMatch(/« resPct » : 5 nombres \[Neutre, Terre, Feu, Eau, Air\] attendu/)
    expect(err({ ...minimal, resPct: [1, 2, 3, 4, 'x'] })).toMatch(/« resPct\[4\] » : un nombre attendu \(reçu "x"\)/)
    expect(err({ ...minimal, updatedAt: '07/10/2026' })).toMatch(/« updatedAt » : une date AAAA-MM-JJ attendu/)
    expect(err({ ...minimal, sources: [{ url: 'dofuswiki' }] })).toMatch(/« sources\[0\]\.url » : une URL http\(s\) attendu/)
    expect(err({ ...minimal, stats: { force: 10 } })).toMatch(/caractéristique inconnue « stats\.force »/)
    expect(err({ ...minimal, mechanics: [{ kind: 'immune', summary: 'x' }] })).toMatch(/« mechanics\[0\]\.kind » : un type de mécanique \(invulnerable, /)
    expect(err({ ...minimal, mechanics: [{ kind: 'other', summary: 'x', counters: ['cac'] }] })).toMatch(/« mechanics\[0\]\.counters\[0\] » : une utilité \(melee, range, /)
    expect(err({ ...minimal, excludeSpells: [1.5] })).toMatch(/« excludeSpells\[0\] » : un entier ≥ 1 attendu/)
    expect(err([])).toMatch(/« \(racine\) » : un objet attendu/)
  })

  it('contrôle la cohérence des phases et des listes de sorts', () => {
    const phase = { id: 'p', name: 'P', states: [], weight: 1 }
    expect(err({ ...minimal, phases: [phase, phase] })).toMatch(/« phases\[1\]\.id » : un id de phase unique attendu/)
    expect(err({ ...minimal, phases: [{ ...phase, weight: 0 }] })).toMatch(/au moins une phase de poids > 0/)
    expect(err({ ...minimal, phases: [{ ...phase, weight: -1 }] })).toMatch(/« phases\[0\]\.weight » : un nombre ≥ 0 attendu/)
    expect(err({ ...minimal, phases: [{ ...phase, vulnerable: 'cac' }] })).toMatch(/« phases\[0\]\.vulnerable » : true, false, "melee" ou "range"/)
    expect(err({ ...minimal, excludeSpells: [4010], positionalSpells: [4010] })).toMatch(/des sorts absents de excludeSpells/)
    expect(parseBossOverrides({ ...minimal, phases: [{ ...phase, resPct: null, vulnerable: 'melee' }] }).phases![0]).toEqual({
      ...phase,
      resPct: null,
      vulnerable: 'melee',
    })
  })
})

describe('fiches manuelles : lecture du dossier', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })
  const mk = (files: Record<string, string>): string => {
    dir = mkdtempSync(join(tmpdir(), 'bosses-'))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    return dir
  }

  it('data/bosses : README et modèle ignorés', () => {
    const m = loadBossOverrides()
    expect(m.has(3534)).toBe(false) // _template.json n'est pas chargé
  })

  it('charge <monsterId>.json, ignore « _* » et les autres extensions', () => {
    const d = mk({
      '3534.json': JSON.stringify({ ...minimal, resPct: [0, 0, 0, 0, 0] }),
      '_brouillon.json': '{ invalide',
      'README.md': '# notes',
    })
    const m = loadBossOverrides(d)
    expect([...m.keys()]).toEqual([3534])
    expect(m.get(3534)!.resPct).toEqual([0, 0, 0, 0, 0])
  })

  it('remonte les erreurs avec le nom du fichier', () => {
    expect(() => loadBossOverrides(mk({ '3534.json': '{ "version": 1, ' }))).toThrow(/3534\.json : JSON invalide/)
    expect(() => loadBossOverrides(mk({ '3534.json': JSON.stringify({ version: 1, monsterId: 3534, x: 1 }) }))).toThrow(
      /3534\.json : clé inconnue « x »/,
    )
    expect(() => loadBossOverrides(mk({ 'merkator.json': JSON.stringify(minimal) }))).toThrow(/merkator\.json : le fichier doit s'appeler 3534\.json/)
  })

  it('dossier absent : aucune fiche', () => {
    expect(loadBossOverrides('/chemin/inexistant/bosses').size).toBe(0)
  })
})
