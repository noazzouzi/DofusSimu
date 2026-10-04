import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseBundleArgs, runBundleCli } from '../src/data/bundle-cli'
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  MemoryDataStore,
  createBundle,
  emptyBundle,
  mergeBundles,
  type DataBundle,
} from '../src/data/memory'
import { statesOfCondition } from '../src/data/criteria'
import { loadDataStore } from '../src/data/node'
import { effectSpellRef, effectStateRef, effectSummonRef, targetMaskStates, triggerStates } from '../src/data/refs'

const source = loadDataStore()

const VORTEX_MONSTERS = [3833, 3834, 3835, 3836, 3837, 3838, 3839]
const VORTEX_MAP = 143393281

/** Lot d'un combat Vortex avec un Iop équipé d'un Bâton, de l'Amulette Séculaire et du Dofus Pourpre. */
const fightBundle = createBundle(source, {
  monsterIds: VORTEX_MONSTERS,
  mapIds: [VORTEX_MAP],
  breedIds: [8],
  itemIds: [140, 14080, 694],
})

describe('createBundle', () => {
  it('produit un lot au format runtime, trié par id', () => {
    expect(fightBundle.format).toBe(BUNDLE_FORMAT)
    expect(fightBundle.version).toBe(BUNDLE_VERSION)
    for (const list of [fightBundle.spells, fightBundle.monsters, fightBundle.states, fightBundle.items, fightBundle.itemSets]) {
      const ids = list.map(x => x.id)
      expect(ids).toEqual([...ids].sort((a, b) => a - b))
      expect(new Set(ids).size).toBe(ids.length)
    }
    expect(fightBundle.maps.map(m => m.id)).toEqual([VORTEX_MAP])
    expect(fightBundle.breeds.map(b => b.id)).toEqual([8])
    expect(fightBundle.items.map(i => i.id)).toEqual([140, 694, 14080])
  })

  it('inclut la fermeture : sorts de classe, sorts de monstres, sorts de départ, invocations, états, panoplies', () => {
    const spells = new Set(fightBundle.spells.map(s => s.id))
    for (const id of source.breed(8)!.spellPairs.flat()) expect(spells.has(id)).toBe(true)
    for (const id of [5068, 5070, 5062, 5066, 5064, 5015, 5016, 5017]) expect(spells.has(id)).toBe(true)
    for (const id of [5006, 4999, 5002]) expect(spells.has(id)).toBe(true) // Vortexiphan, Heure du temps, Glyphe téléporteur
    expect(spells.has(8395)).toBe(true) // sort passif du Dofus Pourpre
    const states = new Set(fightBundle.states.map(s => s.id))
    for (const id of [56, 97, 236]) expect(states.has(id)).toBe(true) // Invulnérable, Indéplaçable, Marginal
    for (const id of [221, 232, 234]) expect(states.has(id)).toBe(true) // heures I, XII, « Même heure »
    expect(fightBundle.itemSets.map(s => s.id)).toContain(271)
    const monsters = new Set(fightBundle.monsters.map(m => m.id))
    for (const id of VORTEX_MONSTERS) expect(monsters.has(id)).toBe(true)
  })

  it('la fermeture est complète : toute référence connue de la source est dans le lot', () => {
    const spells = new Set(fightBundle.spells.map(s => s.id))
    const monsters = new Set(fightBundle.monsters.map(m => m.id))
    for (const s of fightBundle.spells)
      for (const l of s.levels)
        for (const e of [...l.effects, ...l.criticalEffects]) {
          const ref = effectSpellRef(e)
          if (ref && source.spell(ref.spellId)) expect(spells.has(ref.spellId), `${s.id} -> sort ${ref.spellId}`).toBe(true)
          const summon = effectSummonRef(e)
          if (summon && source.monster(summon.monsterId)) expect(monsters.has(summon.monsterId), `${s.id} -> monstre ${summon.monsterId}`).toBe(true)
        }
    for (const m of fightBundle.monsters) {
      for (const id of m.spells) if (source.spell(id)) expect(spells.has(id)).toBe(true)
      for (const g of m.grades) if (g.startingSpell) expect(spells.has(g.startingSpell.spellId)).toBe(true)
    }
  })

  it('la fermeture inclut tous les états cités (950-952, masques, déclencheurs EON/EOFF/EACT/EK, conditions)', () => {
    const states = new Set(fightBundle.states.map(s => s.id))
    const cited = new Set<number>()
    for (const s of fightBundle.spells)
      for (const l of s.levels) {
        for (const st of statesOfCondition(l.statesCondition)) cited.add(st)
        for (const e of [...l.effects, ...l.criticalEffects]) {
          const st = effectStateRef(e)
          if (st !== undefined) cited.add(st)
          for (const x of targetMaskStates(e.targetMask)) cited.add(x)
          for (const x of triggerStates(e.triggers)) cited.add(x)
        }
      }
    let checked = 0
    for (const id of cited)
      if (source.state(id)) {
        expect(states.has(id), `état ${id}`).toBe(true)
        checked++
      }
    expect(checked).toBeGreaterThan(30)
    // Sadida : l'état 5423 n'est cité que par un déclencheur (EON/EOFF) du sort 13549
    expect(source.state(5423)).toBeDefined()
    const sadida = createBundle(source, { breedIds: [10] })
    const triggers = sadida.spells.find(s => s.id === 13549)!.levels.flatMap(l => [...l.effects, ...l.criticalEffects].flatMap(e => triggerStates(e.triggers)))
    expect(triggers).toContain(5423)
    expect(sadida.states.map(s => s.id)).toContain(5423)
  })

  it('reste compact (une fraction des données complètes)', () => {
    const size = JSON.stringify(fightBundle).length
    expect(size).toBeLessThan(6_000_000)
    expect(fightBundle.spells.length).toBeLessThan(source.ids('spell').length / 5)
  })

  it('sans fermeture : uniquement les ids demandés ; ids inconnus ignorés', () => {
    const b = createBundle(source, {
      spellIds: [13115, -1, 999999999],
      monsterIds: [3835],
      stateIds: [236],
      itemSetIds: [107],
      mapIds: [VORTEX_MAP, 1],
      breedIds: [8, 19],
      itemIds: [14080],
      closure: false,
    })
    expect(b.spells.map(s => s.id)).toEqual([13115])
    expect(b.monsters.map(m => m.id)).toEqual([3835])
    expect(b.states.map(s => s.id)).toEqual([236])
    expect(b.itemSets.map(s => s.id)).toEqual([107])
    expect(b.maps.map(m => m.id)).toEqual([VORTEX_MAP])
    expect(b.breeds.map(x => x.id)).toEqual([8])
    expect(b.items.map(x => x.id)).toEqual([14080])
  })

  it('les sorts des bonus de panoplie sont suivis (Vampyre maudit, effet 722)', () => {
    const b = createBundle(source, { itemSetIds: [466] })
    const ids = b.spells.map(s => s.id)
    for (const id of [8166, 8167, 8168, 8169, 8170, 10913]) expect(ids).toContain(id)
  })
})

describe('MemoryDataStore', () => {
  // Lot sérialisé puis relu : c'est ce que le navigateur recevra.
  const roundTrip = JSON.parse(JSON.stringify(fightBundle)) as DataBundle
  const mem = new MemoryDataStore(roundTrip)

  it('restitue les mêmes données que le store Node après sérialisation JSON', () => {
    expect(mem.spell(13115)).toEqual(source.spell(13115))
    expect(mem.monster(3835)).toEqual(source.monster(3835))
    expect(mem.map(VORTEX_MAP)).toEqual(source.map(VORTEX_MAP))
    expect(mem.breed(8)).toEqual(source.breed(8))
    expect(mem.item(140)).toEqual(source.item(140))
    expect(mem.itemSet(271)).toEqual(source.itemSet(271))
    expect(mem.state(236)).toEqual(source.state(236))
  })

  it('mêmes requêtes que le store Node (spellLevel, breedSpells, monsterSpells, spellLevelById)', () => {
    for (const pl of [1, 50, 134, 200]) expect(mem.spellLevel(13115, { playerLevel: pl })).toEqual(source.spellLevel(13115, { playerLevel: pl }))
    expect(mem.spellLevel(13115, { grade: 9 })?.grade).toBe(3)
    const ids = (list: { spellId: number }[]) => list.map(s => s.spellId)
    expect(ids(mem.breedSpells(8, 200))).toEqual(ids(source.breedSpells(8, 200)))
    expect(ids(mem.breedSpells(8, 100, [1, 1]))).toEqual(ids(source.breedSpells(8, 100, [1, 1])))
    for (const id of VORTEX_MONSTERS)
      for (const g of source.monster(id)!.grades) expect(mem.monsterSpells(id, g.grade)).toEqual(source.monsterSpells(id, g.grade))
    expect(mem.spellLevelById(22886)).toEqual(source.spellLevelById(22886))
    expect(mem.spellLevelById(1)).toBeUndefined()
    expect(mem.listBreeds().map(b => b.id)).toEqual([8])
    expect(mem.itemsBySlot('weapon').map(i => i.id)).toEqual([140])
    expect(mem.itemsBySlot('weapon', { minLevel: 10 })).toEqual([])
    expect(mem.ids('map')).toEqual([VORTEX_MAP])
    expect(mem.ids('item')).toEqual([140, 694, 14080])
  })

  it('données absentes du lot : undefined', () => {
    expect(mem.spell(1)).toBeUndefined()
    expect(mem.monster(1)).toBeUndefined()
    expect(mem.map(1)).toBeUndefined()
    expect(mem.item(1)).toBeUndefined()
    expect(mem.itemSet(1)).toBeUndefined()
    expect(mem.state(-1)).toBeUndefined()
    expect(mem.breed(1)).toBeUndefined()
    expect(new MemoryDataStore().spellLevel(13115, {})).toBeUndefined()
  })

  it('add / toBundle / mergeBundles', () => {
    const store = new MemoryDataStore(emptyBundle())
    expect(store.toBundle()).toEqual(emptyBundle())
    store.add({ spells: [source.spell(13115)!], items: [source.item(140)!] })
    expect(store.itemsBySlot('weapon')).toHaveLength(1)
    store.add({ items: [source.item(14080)!], breeds: [source.breed(8)!] })
    expect(store.itemsBySlot('amulet')).toHaveLength(1) // index invalidé
    expect(store.listBreeds()).toHaveLength(1)
    store.add({ breeds: [source.breed(9)!] })
    expect(store.listBreeds().map(b => b.id)).toEqual([8, 9])
    const merged = mergeBundles(createBundle(source, { spellIds: [13115], closure: false }), { spells: [source.spell(13106)!] }, { maps: [source.map(VORTEX_MAP)!] })
    expect(merged.spells.map(s => s.id)).toEqual([13106, 13115])
    expect(merged.maps).toHaveLength(1)
  })

  it('zones ré-internées après relecture JSON (objets partagés, gelés, identiques en valeur)', () => {
    const couperet = mem.spellLevel(13115, { grade: 3 })!
    const [dmg, mp] = couperet.effects
    expect(Object.isFrozen(dmg.zone)).toBe(true)
    expect(mp.zone).toBe(dmg.zone) // même zone L3 partagée, comme dans le store Node
    expect(dmg.zone).toEqual(source.spellLevel(13115, { grade: 3 })!.effects[0].zone)
    const distinct = new Set(roundTrip.spells.flatMap(s => s.levels.flatMap(l => [...l.effects, ...l.criticalEffects].map(e => e.zone))))
    const effects = roundTrip.spells.reduce((n, s) => n + s.levels.reduce((k, l) => k + l.effects.length + l.criticalEffects.length, 0), 0)
    expect(distinct.size).toBeLessThan(effects / 10)
    expect(Object.isFrozen(mem.item(140)!.weaponZone)).toBe(true)
    expect(mem.item(140)!.weaponZone).toEqual(source.item(140)!.weaponZone)
    // objets du store Node (zones déjà internées) : inchangés
    const s = source.spell(13115)!
    const before = s.levels[2].effects[0].zone
    new MemoryDataStore({ spells: [s] })
    expect(s.levels[2].effects[0].zone).toBe(before)
  })

  it('remplacer un sort retire ses anciens niveaux de l’index spellLevelById', () => {
    const store = new MemoryDataStore({ spells: [source.spell(13115)!] })
    expect(store.spellLevelById(78999)?.grade).toBe(3)
    const trimmed = { ...source.spell(13115)!, levels: source.spell(13115)!.levels.slice(0, 2) }
    store.add({ spells: [trimmed] })
    expect(store.spellLevelById(78999)).toBeUndefined()
    expect(store.spellLevel(13115, {})?.grade).toBe(2)
    expect(store.spellLevelById(trimmed.levels[0].levelId!)).toBe(trimmed.levels[0])
  })

  it('refuse un lot d’un autre format ou d’une version future', () => {
    expect(() => new MemoryDataStore({ format: 'autre' as typeof BUNDLE_FORMAT })).toThrow(/Format/)
    expect(() => new MemoryDataStore({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION + 1 })).toThrow(/Version/)
    // version 1 : PV / caractéristiques des invocations fusionnés avec bonusCharacteristics -> à régénérer
    expect(() => new MemoryDataStore({ format: BUNDLE_FORMAT, version: 1 })).toThrow(/régénérer/)
  })
})

describe('bundle-cli', () => {
  it('analyse les listes d’ids et les options', () => {
    const o = parseBundleArgs(['--monsters', '3833, 3835', '--maps', '143393281', '--breeds', '8', '--no-closure', '--pretty'])
    expect(o.request).toEqual({ closure: false, monsterIds: [3833, 3835], mapIds: [143393281], breedIds: [8] })
    expect(o).toMatchObject({ dataDir: 'data', pretty: true, out: undefined })
    expect(parseBundleArgs([]).request).toEqual({ closure: true })
    expect(() => parseBundleArgs(['--spells', '12,abc'])).toThrow(/invalide/)
    expect(() => parseBundleArgs(['--inconnu'])).toThrow()
  })

  it('écrit un lot JSON relisible par MemoryDataStore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dofussimu-bundle-'))
    try {
      const out = join(dir, 'vortex.json')
      const { bundle } = runBundleCli(['--monsters', '3835', '--maps', String(VORTEX_MAP), '--out', out])
      const mem = new MemoryDataStore(JSON.parse(readFileSync(out, 'utf8')))
      expect(mem.monster(3835)?.name).toBe('Vortex')
      expect(mem.spell(5006)?.name).toBe('Vortexiphan')
      expect(mem.ids('spell')).toEqual(bundle.spells.map(s => s.id))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
