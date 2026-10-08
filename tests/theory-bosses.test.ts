import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { bossGradeFor, listBosses, normalize, resolveBoss, searchBosses } from '../src/theorycraft/bosses'
import { isExpeditionDungeon, nodeDungeonSource } from '../src/theorycraft/node'

const data = loadDataStore()
const src = nodeDungeonSource(data)
const bosses = listBosses(data, src)
const all = listBosses(data, src, { includeExpeditions: true })

describe('index des boss', () => {
  it('137 boss par dungeons.json[].bosses, Expéditions exclues par défaut', () => {
    expect(bosses).toHaveLength(137)
    expect(bosses.every(b => b.source === 'bosses' && !b.isExpedition)).toBe(true)
    expect(bosses.flatMap(b => b.dungeons).some(d => d.isExpedition)).toBe(false)
    expect(new Set(bosses.map(b => b.monsterId)).size).toBe(137)
  })

  it('162 boss avec les Expéditions (25 propres, par repli sur isBoss)', () => {
    expect(all).toHaveLength(162)
    const own = all.filter(b => b.isExpedition)
    expect(own).toHaveLength(25)
    expect(own.every(b => b.source === 'isBoss' && b.dungeons.every(d => d.isExpedition))).toBe(true)
  })

  it('règle « Expédition » : 60 donjons, nom « Expédition… » ⇔ difficulté 0, aucun avec bosses[]', () => {
    const raw = data.rawFile('dungeons.json')
    const exp = raw.filter(isExpeditionDungeon)
    expect(exp).toHaveLength(60)
    expect(exp.every(d => d.difficulty === 0 && d.name?.fr?.startsWith('Expédition') && d.bosses.length === 0)).toBe(true)
    expect(raw.filter(d => !isExpeditionDungeon(d)).some(d => d.difficulty === 0)).toBe(false)
  })

  it('fusionne un boss présent dans plusieurs donjons', () => {
    // Servitude : Fers de la Tyrannie (118) et Tempête de l'Eliocalypse (121).
    expect(bosses.find(b => b.monsterId === 5955)!.dungeons.map(d => d.id)).toEqual([118, 121])
    // Minotoror : donjon classique (4) puis deux Expéditions, seulement si elles sont incluses.
    const classic = bosses.find(b => b.monsterId === 121)!
    const merged = all.find(b => b.monsterId === 121)!
    expect(classic.dungeons.map(d => d.id)).toEqual([4])
    expect(merged.dungeons.map(d => d.id)).toEqual([4, 167, 205])
    expect(merged.dungeons[0].isExpedition).toBe(false) // donjon classique en premier
    expect(merged.isExpedition).toBe(false)
  })

  it('renseigne niveau du boss, nombre de grades et donjon (Vortex)', () => {
    const v = bosses.find(b => b.monsterId === 3835)!
    expect(v).toMatchObject({ name: 'Vortex', bossLevel: 220, gradeCount: 6 })
    expect(v.dungeons[0]).toMatchObject({ id: 87, level: 200, isExpedition: false })
  })
})

describe('recherche', () => {
  it('normalise : minuscules, sans accents, ligatures, ponctuation', () => {
    expect(normalize('Père Ver')).toBe('pere ver')
    expect(normalize("L'Œil de Vortex")).toBe('l oeil de vortex')
    expect(normalize('  Aquadôme   de Merkator ! ')).toBe('aquadome de merkator')
  })

  it('cherche par nom de boss ou de donjon, un nombre étant un id de monstre', () => {
    expect(searchBosses(bosses, 'vortex')[0].monsterId).toBe(3835)
    expect(searchBosses(bosses, 'aquadome').map(b => b.monsterId)).toEqual([3534])
    expect(searchBosses(bosses, '3534').map(b => b.name)).toEqual(['Merkator'])
    expect(searchBosses(bosses, '99999999')).toEqual([])
    expect(searchBosses(bosses, '')).toHaveLength(137)
  })

  it('trie par pertinence : nom exact, puis préfixe, puis mot, puis donjon', () => {
    const r = searchBosses(all, 'blop')
    expect(r.length).toBeGreaterThanOrEqual(5)
    expect(r.slice(0, 5).every(b => normalize(b.name).startsWith('blop'))).toBe(true)
  })

  it('résout un id, un nom exact (accents et casse indifférents) ou un résultat unique', () => {
    expect(resolveBoss(bosses, 'vortex').monsterId).toBe(3835)
    expect(resolveBoss(bosses, 'merkator').monsterId).toBe(3534)
    expect(resolveBoss(bosses, 'MERKATOR').monsterId).toBe(3534)
    expect(resolveBoss(bosses, 'pere VER').monsterId).toBe(4726)
    expect(resolveBoss(bosses, 'Père Ver').monsterId).toBe(4726)
    expect(resolveBoss(bosses, ' 3534 ').monsterId).toBe(3534)
    expect(resolveBoss(bosses, 'aquadôme').monsterId).toBe(3534)
  })

  it('ambigu ⇒ erreur française listant au plus 8 candidats « nom (id, donjon) »', () => {
    let msg = ''
    try {
      resolveBoss(bosses, 'blop')
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/ambigu/)
    expect(msg).toMatch(/Blop Coco Royal \(\d+, [^)]+\)/)
    expect(msg.match(/\(\d+, /g)!.length).toBeLessThanOrEqual(8)
    expect(() => resolveBoss(bosses, 'zzzz introuvable')).toThrow(/Aucun boss/)
    expect(() => resolveBoss(bosses, '7925')).toThrow(/Aucun boss d'id 7925/) // Minotoror d'Expédition, exclu par défaut
    expect(resolveBoss(all, '7925').isExpedition).toBe(true)
  })
})

describe('grade selon le nombre de joueurs', () => {
  it('joueurs − 3, borné à 1..5 (docs/research/vortex-audit.md §1.3)', () => {
    expect(bossGradeFor(4, 5)).toBe(1)
    expect(bossGradeFor(8, 5)).toBe(5)
    expect(bossGradeFor(1, 5)).toBe(1)
    expect(bossGradeFor(6, 5)).toBe(3)
    expect(bossGradeFor(9, 6)).toBe(5)
  })

  it('borné par le nombre de grades du monstre, jamais au-delà de 5', () => {
    expect(bossGradeFor(8, 3)).toBe(3)
    expect(bossGradeFor(8, 1)).toBe(1)
    expect(bossGradeFor(8, 10)).toBe(5)
    expect(() => bossGradeFor(Number.NaN, 5)).toThrow(RangeError)
  })
})
