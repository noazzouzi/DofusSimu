import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Rng } from '../src/core/rng'
import { emptyStats, STAT_KEYS, type Stats } from '../src/core/types'
import { itemSetBonusesFor } from '../src/data/convert'
import type { BreedData, EquipmentSlot, ItemData, ItemSetData } from '../src/data/model'
import {
  allocateAll,
  applyItemEffect,
  baseActionPoints,
  baseLifePoints,
  baseProspecting,
  computeBuildStats,
  finalizeStats,
  fullScrolls,
  nakedBuild,
  rollEffect,
  type BuildDataSource,
  type CharacterBuild,
  type EquippedItem,
} from '../src/stats'

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T

// ───────────── mini-chargeur local des données DofusDB (le chargeur officiel src/data est en construction)

interface RawEffect {
  effectId: number
  diceNum: number
  diceSide: number
}
interface RawItem {
  id: number
  name: { fr: string }
  typeId: number
  slot: string
  level: number
  itemSetId: number | null
  criterions: string
  possibleEffects: RawEffect[]
  apCost?: number
  minRange?: number
  range?: number
  criticalHitProbability?: number
  criticalHitBonus?: number
  maxCastPerTurn?: number
  castInLine?: boolean
  castInDiagonal?: boolean
  castTestLos?: boolean
  twoHanded?: boolean
}
interface RawSet {
  id: number
  name: { fr: string }
  items: number[]
  bonusesByItemCount: Record<string, RawEffect[]>
}
interface RawBreed {
  id: number
  shortName: { fr: string }
  spellPairs: [number, number][]
  spellPairUnlockLevels: [number, number][]
  statsPointsForStrength: [number, number][]
  statsPointsForIntelligence: [number, number][]
  statsPointsForChance: [number, number][]
  statsPointsForAgility: [number, number][]
  statsPointsForVitality: [number, number][]
  statsPointsForWisdom: [number, number][]
}

const SLOT_ALIASES: Record<string, EquipmentSlot> = { trophy: 'dofus', prysmaradite: 'dofus', petsmount: 'pet', mount: 'pet' }
const range = (e: RawEffect) => ({ effectId: e.effectId, min: e.diceNum, max: e.diceSide || e.diceNum })

const ITEMS = new Map<number, ItemData>()
for (const r of readJson<RawItem[]>('../data/dofusdb/equipment.json')) {
  ITEMS.set(r.id, {
    id: r.id,
    name: r.name.fr,
    typeId: r.typeId,
    slot: SLOT_ALIASES[r.slot] ?? (r.slot as EquipmentSlot),
    level: r.level,
    setId: r.itemSetId ?? null,
    conditions: r.criterions ?? '',
    effects: r.possibleEffects.map(range),
    weapon:
      r.apCost === undefined
        ? undefined
        : {
            apCost: r.apCost,
            minRange: r.minRange ?? 1,
            range: r.range ?? 1,
            critChance: r.criticalHitProbability ?? 0,
            critBonus: r.criticalHitBonus ?? 0,
            maxCastPerTurn: r.maxCastPerTurn ?? 1,
            castInLine: !!r.castInLine,
            castInDiagonal: !!r.castInDiagonal,
            castTestLos: !!r.castTestLos,
            twoHanded: !!r.twoHanded,
          },
  })
}
const SETS = new Map<number, ItemSetData>()
for (const r of readJson<RawSet[]>('../data/dofusdb/item-sets.json')) {
  const bonuses: Record<number, ReturnType<typeof range>[]> = {}
  for (const [k, v] of Object.entries(r.bonusesByItemCount)) bonuses[Number(k)] = v.map(range)
  SETS.set(r.id, { id: r.id, name: r.name.fr, items: r.items, bonuses })
}
const RAW_BREEDS = readJson<{ breeds: RawBreed[] }>('../data/dofusdb/breeds.json').breeds
const BREEDS = new Map<number, BreedData>()
for (const b of RAW_BREEDS) {
  BREEDS.set(b.id, {
    id: b.id,
    name: b.shortName.fr,
    roles: [],
    spellPairs: b.spellPairs,
    spellPairUnlockLevels: b.spellPairUnlockLevels,
    statPointCosts: {
      strength: b.statsPointsForStrength,
      intelligence: b.statsPointsForIntelligence,
      chance: b.statsPointsForChance,
      agility: b.statsPointsForAgility,
      vitality: b.statsPointsForVitality,
      wisdom: b.statsPointsForWisdom,
    },
  })
}
const DATA: BuildDataSource = {
  item: id => ITEMS.get(id),
  itemSet: id => SETS.get(id),
  breed: id => BREEDS.get(id),
}

// Objets utilisés
const IOP = 8
const ENUTROF = 3
const HAREBOURG = { hat: 14076, ring: 14077, boots: 14078, set: 270 }
const OCRE = 7754
const TURQUOISE = 739
const GLACES = 7043
const VULBIS = 6980
const KOKULTE = 13673 // familier : 15 % CC, 40 Do Crit
const CIRE_MOMORE = { set: 507, weapon: 27510, hat: 27511, cloak: 27512, amulet: 27513, boots: 27514, ring: 27515 }
const OBSTRUCTEUR_MAJEUR = 16184 // trophée « Pk<3 », +32 Tacle
const PRYTEK = [21451, 21452] // prysmaradites
const BRACELET_MING = 11737 // anneau hors panoplie
const BALAI = 27645 // seule arme à deux mains des données
const SHIELD_BROUCE = 18693

const strengthBuild = (items: EquippedItem[], extra: Partial<CharacterBuild> = {}): CharacterBuild => ({
  name: 'Iop Terre',
  breedId: IOP,
  level: 200,
  characteristicPoints: { strength: 992, vitality: 3 },
  scrolls: fullScrolls(),
  items,
  ...extra,
})

// ───────────── données synthétiques pour les règles

function synthetic(items: Partial<ItemData>[], sets: ItemSetData[] = []): BuildDataSource {
  const map = new Map<number, ItemData>()
  items.forEach((p, i) => {
    const id = p.id ?? 1000 + i
    map.set(id, { name: `objet ${id}`, typeId: 1, slot: 'amulet', level: 1, setId: null, conditions: '', effects: [], ...p, id })
  })
  const setMap = new Map(sets.map(s => [s.id, s]))
  return { item: id => map.get(id), itemSet: id => setMap.get(id), breed: id => BREEDS.get(id) }
}

// ─────────────────────────────────────────────────────────────

describe('stats/build — personnage nu', () => {
  it('niveau 200, chacune des 19 classes : 7 PA, 3 PM, 1 invocation, 1 050 PV, prospection 100 (Enutrof 120)', () => {
    expect(BREEDS.size).toBe(19)
    for (const breed of BREEDS.values()) {
      const r = computeBuildStats(nakedBuild(breed.id, 200), DATA)
      expect(r.valid, breed.name).toBe(true)
      expect(r.warnings).toEqual([])
      expect(r.stats.ap).toBe(7)
      expect(r.stats.mp).toBe(3)
      expect(r.stats.range).toBe(0)
      expect(r.stats.summons).toBe(1)
      expect(r.maxHp).toBe(1050)
      expect(r.stats.prospecting).toBe(breed.id === ENUTROF ? 120 : 100)
      expect(r.stats.initiative).toBe(0)
      expect(r.stats.critical).toBe(0)
      expect(r.stats.tackleBlock).toBe(0)
      expect(r.points).toEqual({ available: 995, spent: 0, remaining: 995 })
      const others = { ...r.stats, ap: 0, mp: 0, summons: 0, prospecting: 0 }
      expect(others).toEqual(emptyStats())
    }
  })

  it('PA de base 6 avant le niveau 100, PV = 55 + 5·(niv − 1), niveaux Oméga sans gain', () => {
    expect(baseActionPoints(99)).toBe(6)
    expect(baseActionPoints(100)).toBe(7)
    expect(baseLifePoints(1)).toBe(55)
    expect(baseLifePoints(200)).toBe(1050)
    expect(baseProspecting(ENUTROF)).toBe(120)
    expect(baseProspecting(IOP)).toBe(100)
    expect(computeBuildStats(nakedBuild(IOP, 99), DATA).stats.ap).toBe(6)
    expect(computeBuildStats(nakedBuild(IOP, 1), DATA).maxHp).toBe(55)
    const omega = computeBuildStats(nakedBuild(IOP, 250), DATA)
    expect(omega.maxHp).toBe(1050)
    expect(omega.points.available).toBe(995)
  })

  it('tout en Vitalité + parchemins : 1 050 + 995 + 100 PV, dérivées des parchemins', () => {
    const r = computeBuildStats({ ...nakedBuild(IOP), characteristicPoints: { vitality: 995 }, scrolls: fullScrolls() }, DATA)
    expect(r.maxHp).toBe(2145)
    expect(r.stats.vitality).toBe(1095)
    expect(r.stats.initiative).toBe(400) // 4 × 100 de parchemins
    expect(r.stats.prospecting).toBe(110)
    expect(r.stats.tackleBlock).toBe(10)
    expect(r.stats.tackleEvade).toBe(10)
    expect(r.stats.apParry).toBe(10)
    expect(r.stats.mpReduction).toBe(10)
    expect(r.additional).toEqual(fullScrolls())
    expect(r.base.vitality).toBe(995)
    expect(r.points.remaining).toBe(0)
    expect(r.valid).toBe(true)
  })
})

describe('stats/build — build complet calculé à la main (panoplie du Comte Harebourg)', () => {
  // Iop niv. 200, 398 Force (992 pts) + 3 Vitalité, parchemins 100 partout, jets max.
  // Coiffe/Anneau/Bottes Harebourg (panoplie 270, palier 3) + Dofus Ocre, Turquoise et des Glaces.
  const items: EquippedItem[] = [
    { slot: 'hat', itemId: HAREBOURG.hat },
    { slot: 'ring', itemId: HAREBOURG.ring },
    { slot: 'boots', itemId: HAREBOURG.boots },
    { slot: 'dofus', itemId: OCRE },
    { slot: 'dofus', itemId: TURQUOISE },
    { slot: 'dofus', itemId: GLACES },
  ]
  const r = computeBuildStats(strengthBuild(items), DATA)
  const s = r.stats

  it('build valide, panoplie au palier 3, sorts passifs', () => {
    expect(r.valid).toBe(true)
    expect(r.warnings).toEqual([])
    expect(r.sets).toEqual([{ setId: HAREBOURG.set, count: 3, tier: 3 }])
    expect(r.setBonusCount).toBe(2)
    expect(r.passiveSpells).toEqual([8394, 5952]) // Jaune Ocre, Bleu Turquoise
    expect(r.points).toEqual({ available: 995, spent: 995, remaining: 0 })
  })

  it('caractéristiques primaires', () => {
    expect(s.strength).toBe(398 + 100 + 100 + 50 + 80 + 60) // base + parchemin + coiffe + anneau + bottes + panoplie
    expect(s.vitality).toBe(3 + 100 + 500 + 350 + 400 + 300)
    expect(r.maxHp).toBe(1050 + 1653)
    expect(s.wisdom).toBe(100 + 60 + 50 + 50)
    expect(s.intelligence).toBe(100)
    expect(s.chance).toBe(100)
    expect(s.agility).toBe(100)
    expect(r.base.strength).toBe(398)
  })

  it('PA / PM / PO / invocations / critique', () => {
    expect(s.ap).toBe(7 + 1 + 1) // base + panoplie 3 + Ocre
    expect(s.mp).toBe(3 + 1) // bottes
    expect(s.range).toBe(1 + 1) // coiffe + panoplie
    expect(s.summons).toBe(1)
    expect(s.critical).toBe(7 + 10) // anneau + Turquoise
  })

  it('dommages et résistances (malus de la coiffe compensés par la panoplie)', () => {
    expect(s.neutralDamage).toBe(20 + 15 + 20 + 25)
    expect(s.earthDamage).toBe(20 + 15 + 20 + 25)
    expect(s.fireDamage).toBe(25)
    expect(s.waterDamage).toBe(25)
    expect(s.airDamage).toBe(25)
    for (const k of ['neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct'] as const) expect(s[k]).toBe(-5 + 5)
    expect(s.criticalRes).toBe(25 + 25)
    expect(s.pushRes).toBe(30 + 30)
    expect(s.neutralRes).toBe(30)
  })

  it('stats dérivées', () => {
    expect(s.tackleBlock).toBe(20 + 15 + 15 + 10) // coiffe + bottes + panoplie + ⌊100 Agi / 10⌋
    expect(s.tackleEvade).toBe(10)
    expect(s.apReduction).toBe(8 + 26) // coiffe + ⌊260 Sa / 10⌋
    expect(s.mpReduction).toBe(26)
    expect(s.apParry).toBe(26)
    expect(s.mpParry).toBe(-10 + 15 + 26) // malus des bottes + panoplie + sagesse
    expect(s.initiative).toBe(-500 + 500 + 788 + 100 + 100 + 100) // anneau + panoplie + 4 caractéristiques
    expect(s.prospecting).toBe(100 + 10 + 30)
    expect(r.raw.initiative).toBe(0)
    expect(r.raw.tackleBlock).toBe(50)
  })

  it('panoplie au palier 2 (coiffe + anneau)', () => {
    const r2 = computeBuildStats(strengthBuild(items.filter(i => i.itemId !== HAREBOURG.boots)), DATA)
    expect(r2.sets).toEqual([{ setId: HAREBOURG.set, count: 2, tier: 2 }])
    expect(r2.stats.ap).toBe(7 + 1) // pas de PA de panoplie à 2 objets
    expect(r2.stats.strength).toBe(398 + 100 + 100 + 50 + 60)
    expect(r2.stats.earthResPct).toBe(-5 + 3)
    expect(r2.stats.mpParry).toBe(r2.stats.apParry) // pas de malus des bottes ni d'esquive PM de panoplie
    expect(r2.setBonusCount).toBe(1)
  })

  it('politiques de jet : min, moyenne, meilleur', () => {
    const min = computeBuildStats(strengthBuild(items), DATA, { rollPolicy: 'min' }).stats
    expect(min.strength).toBe(398 + 100 + 71 + 31 + 61 + 60)
    expect(min.earthResPct).toBe(-4 + 5)
    expect(min.range).toBe(2) // ligne fixe
    const mean = computeBuildStats(strengthBuild(items), DATA, { rollPolicy: 'mean' }).stats
    expect(mean.strength).toBe(398 + 100 + 85 + 40 + 70 + 60) // ⌊(71+100)/2⌋, ⌊(31+50)/2⌋, ⌊(61+80)/2⌋
    const best = computeBuildStats(strengthBuild(items), DATA, { rollPolicy: 'best' }).stats
    expect(best.strength).toBe(788)
    expect(best.earthResPct).toBe(-4 + 5) // malus au minimum
    expect(best.initiative).toBe(-401 + 500 + 788 + 300)
  })

  it('jets choisis par effet (montant positif, signe porté par l\'effet)', () => {
    const custom = items.map(i => (i.itemId === HAREBOURG.hat ? { ...i, rolls: { 118: 80, 215: 4, 125: 460 } } : i))
    const rc = computeBuildStats(strengthBuild(custom), DATA)
    expect(rc.valid).toBe(true)
    expect(rc.stats.strength).toBe(788 - 20)
    expect(rc.stats.earthResPct).toBe(-4 + 5)
    expect(rc.stats.vitality).toBe(1653 - 40)
    const ghost = items.map(i => (i.itemId === HAREBOURG.hat ? { ...i, rolls: { 111: 1 } } : i))
    const rg = computeBuildStats(strengthBuild(ghost), DATA)
    expect(rg.issues.map(i => i.code)).toEqual(['rolls'])
    expect(rg.valid).toBe(true)
  })

  it('option d\'affichage : % de résistance plafonnés', () => {
    const build = strengthBuild([{ itemId: 1 }])
    const data = synthetic([{ id: 1, effects: [{ effectId: 210, min: 70, max: 70 }] }])
    expect(computeBuildStats(build, data).stats.earthResPct).toBe(70)
    expect(computeBuildStats(build, data, { capResistances: true }).stats.earthResPct).toBe(50)
    expect(computeBuildStats(build, data, { capResistances: true, caps: { resPct: 40 } }).stats.earthResPct).toBe(40)
  })
})

describe('stats/build — vecteur de validation de la doc (equipment.md §12.2, stuff Terre Gamosaurus)', () => {
  const ids = [21235, 19246, 18693, 21229, KOKULTE, 19244, 13115, 22205, 13114, 19245, 18043, OCRE, VULBIS, GLACES, TURQUOISE, 29134]
  const points = allocateAll(BREEDS.get(IOP), 200, 'strength', { rest: null }).points

  it('82 % CC, 415 Sagesse, 1 258 Force, 11 PA / 5 PM, 4 PO ; Baguette de Torkélonia refusée (CA>299)', () => {
    const r = computeBuildStats(strengthBuild(ids.map(itemId => ({ itemId })), { characteristicPoints: points }), DATA)
    expect(r.stats.critical).toBe(82)
    expect(r.stats.wisdom).toBe(415)
    expect(r.stats.strength).toBe(1258)
    expect(r.stats.ap).toBe(11)
    expect(r.stats.mp).toBe(5)
    expect(r.stats.range).toBe(4)
    expect(r.stats.agility).toBe(250)
    expect(r.valid).toBe(false)
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toMatchObject({ code: 'condition', itemId: 21229, severity: 'error' })
    expect(r.warnings[0]).toContain('CA>299 (Agilité = 250)')
    expect(r.passiveSpells).toEqual([6828, 8394, 8396, 5952])
    expect(r.sets.map(s => [s.setId, s.count, s.tier])).toEqual([
      [472, 2, 2],
      [445, 3, 3],
      [240, 3, 3],
      [477, 1, 0],
    ])
    expect(r.setBonusCount).toBe(5)
  })

  it('avec le Dofus Sylvestre non lié (29136) : 6 PO', () => {
    const r = computeBuildStats(
      strengthBuild(ids.map(itemId => ({ itemId: itemId === 29134 ? 29136 : itemId })), { characteristicPoints: points }),
      DATA,
    )
    expect(r.stats.range).toBe(6)
  })

  it('exo PA + exo PM + exo 50 Agilité : 12/6 et conditions remplies', () => {
    const items: EquippedItem[] = ids.map(itemId => {
      if (itemId === 13115) return { itemId, exos: [{ stat: 'ap', value: 1 }] } // Anneau de Brouce
      if (itemId === 19246) return { itemId, exos: [{ stat: 'mp', value: 1 }] } // Cape du Cœur Saignant
      if (itemId === 13114) return { itemId, exos: [{ stat: 'agility', value: 50 }] } // Ceinture de Brouce
      return { itemId }
    })
    const r = computeBuildStats(strengthBuild(items, { characteristicPoints: points }), DATA)
    expect(r.stats.ap).toBe(12)
    expect(r.stats.mp).toBe(6)
    expect(r.stats.agility).toBe(300)
    expect(r.valid).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('exo PA sur un objet qui a déjà 1 PA : refusé', () => {
    const items: EquippedItem[] = ids.map(itemId => (itemId === 19244 ? { itemId, exos: [{ stat: 'ap', value: 1 }] } : { itemId }))
    const r = computeBuildStats(strengthBuild(items, { characteristicPoints: points }), DATA)
    expect(r.issues.some(i => i.code === 'forgemagie' && i.itemId === 19244)).toBe(true)
  })
})

describe('stats/build — second vecteur de la doc (equipment.md §12.3, stuff Eau Gamosaurus)', () => {
  it('1 458 Chance, 51 % CC, 6 PO, 4 100 PV, 11 PA / 5 PM ; panoplies Danathor et Sinistrofu au palier 3', () => {
    const ids = [13120, 30690, 13122, 14085, 14086, 14087, 18017, 11950, 19985, 24035, 18043, 29136, VULBIS, GLACES, TURQUOISE, OCRE]
    const points = allocateAll(BREEDS.get(IOP), 200, 'chance', { rest: null }).points
    const r = computeBuildStats(strengthBuild(ids.map(itemId => ({ itemId })), { characteristicPoints: points }), DATA)
    expect(r.valid).toBe(true)
    expect(r.warnings).toEqual([])
    expect(r.stats.chance).toBe(1458)
    expect(r.stats.critical).toBe(51)
    expect(r.stats.range).toBe(6)
    expect(r.maxHp).toBe(4100)
    expect(r.stats.ap).toBe(11)
    expect(r.stats.mp).toBe(5)
    expect(r.sets.filter(s => s.tier > 0).map(s => [s.count, s.tier])).toEqual([
      [3, 3],
      [3, 3],
    ])
  })
})

describe('stats/build — exos, plafonds et plafonds spéciaux', () => {
  it('un seul exo PA compté par personnage', () => {
    const r = computeBuildStats(
      strengthBuild([
        { itemId: HAREBOURG.hat, exos: [{ stat: 'ap', value: 1 }] },
        { itemId: HAREBOURG.ring, exos: [{ stat: 'ap', value: 1 }, { stat: 'mp', value: 1 }] },
        { itemId: HAREBOURG.boots, exos: [{ stat: 'range', value: 1 }] }, // pas de PO sur les bottes
      ]),
      DATA,
    )
    expect(r.stats.ap).toBe(7 + 1 + 1) // panoplie + un seul exo
    expect(r.stats.mp).toBe(3 + 1 + 1)
    expect(r.stats.range).toBe(2 + 1)
    expect(r.issues.filter(i => i.code === 'exoLimit')).toHaveLength(1)
    expect(r.valid).toBe(true)
  })

  it('exos invocation cumulables, transcendances', () => {
    const r = computeBuildStats(
      strengthBuild([
        { itemId: HAREBOURG.hat, exos: [{ stat: 'summons', value: 1 }] },
        { itemId: HAREBOURG.ring, exos: [{ stat: 'summons', value: 1 }] },
        { itemId: HAREBOURG.boots, exos: [{ stat: 'spellDamagePct', value: 1, kind: 'transcendence' }] },
      ]),
      DATA,
    )
    expect(r.stats.summons).toBe(3)
    expect(r.stats.spellDamagePct).toBe(1)
    expect(r.valid).toBe(true)
  })

  it('exo sur un Dofus refusé', () => {
    const r = computeBuildStats(strengthBuild([{ itemId: OCRE, exos: [{ stat: 'mp', value: 1 }] }]), DATA)
    expect(r.valid).toBe(false)
    expect(r.issues[0].code).toBe('forgemagie')
  })

  it('plafonds 12 PA / 6 PM, surplus signalé, plafonds paramétrables', () => {
    const data = synthetic([
      { id: 1, effects: [{ effectId: 111, min: 6, max: 6 }, { effectId: 128, min: 4, max: 4 }, { effectId: 117, min: 8, max: 8 }] },
    ])
    const build = strengthBuild([{ itemId: 1 }])
    const r = computeBuildStats(build, data)
    expect(r.raw.ap).toBe(13)
    expect(r.stats.ap).toBe(12)
    expect(r.stats.mp).toBe(6)
    expect(r.stats.range).toBe(6)
    expect(r.wasted).toEqual({ ap: 1, mp: 1, range: 2 })
    expect(r.issues.filter(i => i.code === 'cap')).toHaveLength(3)
    expect(r.valid).toBe(true)
    const r9 = computeBuildStats(build, data, { caps: { range: 9 } })
    expect(r9.stats.range).toBe(8)
    expect(r9.wasted.range).toBeUndefined()
  })

  it('Malédiction de Cire Momore : plafonds « max. » (effet 2897) de PM / invocations', () => {
    const three = computeBuildStats(
      strengthBuild([{ itemId: CIRE_MOMORE.hat }, { itemId: CIRE_MOMORE.cloak }, { itemId: CIRE_MOMORE.boots }]),
      DATA,
    )
    expect(three.sets[0]).toEqual({ setId: CIRE_MOMORE.set, count: 3, tier: 3 })
    expect(three.raw.mp).toBe(4)
    expect(three.stats.mp).toBe(3) // PM max. 3
    expect(three.wasted.mp).toBe(1)
    expect(three.stats.summons).toBe(2) // 1 + cape, sous le plafond de 3
    expect(three.stats.ap).toBe(8)
    const six = computeBuildStats(
      strengthBuild(Object.entries(CIRE_MOMORE).filter(([k]) => k !== 'set').map(([, itemId]) => ({ itemId }))),
      DATA,
    )
    expect(six.sets[0].tier).toBe(6)
    expect(six.stats.mp).toBe(2)
    expect(six.stats.summons).toBe(2)
    expect(six.stats.range).toBe(0)
    expect(six.stats.ap).toBe(7 + 1 + 2) // amulette + panoplie 6
  })

  it('familier au prorata de son niveau', () => {
    const full = computeBuildStats(strengthBuild([{ itemId: KOKULTE }]), DATA).stats
    expect(full.critical).toBe(15)
    expect(full.criticalDamage).toBe(40)
    const half = computeBuildStats(strengthBuild([{ itemId: KOKULTE, petLevel: 50 }]), DATA).stats
    expect(half.critical).toBe(8) // round(15 × 50 %) (loi linéaire supposée, INCERTAIN)
    expect(half.criticalDamage).toBe(20)
  })

  it('finalizeStats réutilisable (recalcul des dérivées)', () => {
    const raw = emptyStats()
    raw.agility = 455
    raw.wisdom = 99
    raw.ap = 14
    raw.vitality = 3000
    raw.tackleEvade = 5
    const { stats, maxHp, wasted } = finalizeStats(raw, { level: 200, breedId: IOP, statCaps: { ap: 11, vitality: 2500 } })
    expect(stats.ap).toBe(11)
    expect(wasted.ap).toBe(3)
    expect(stats.vitality).toBe(2500)
    expect(maxHp).toBe(3550)
    expect(stats.tackleEvade).toBe(50)
    expect(stats.apParry).toBe(9)
    expect(stats.initiative).toBe(455)
    expect(raw.ap).toBe(14) // l'entrée n'est pas modifiée
  })

  it('rollEffect', () => {
    const line = { effectId: 118, min: 71, max: 100 }
    expect(rollEffect(line)).toBe(100)
    expect(rollEffect(line, 'min')).toBe(71)
    expect(rollEffect(line, 'mean')).toBe(85)
    expect(rollEffect({ effectId: 215, min: 4, max: 5 }, 'best')).toBe(4)
    expect(rollEffect({ effectId: 117, min: 1, max: 1 }, 'max')).toBe(1)
    expect(rollEffect({ effectId: 117, min: 1, max: 0 }, 'max')).toBe(1) // ancienne convention diceSide = 0
  })
})

describe('stats/build — règles d\'emplacement', () => {
  const codes = (r: ReturnType<typeof computeBuildStats>) => r.issues.filter(i => i.severity === 'error').map(i => i.code)

  it('trois anneaux, anneau de panoplie en double, anneau hors panoplie en double', () => {
    expect(
      codes(computeBuildStats(strengthBuild([{ itemId: BRACELET_MING }, { itemId: BRACELET_MING }, { itemId: HAREBOURG.ring }]), DATA)),
    ).toEqual(['slot'])
    expect(codes(computeBuildStats(strengthBuild([{ itemId: HAREBOURG.ring }, { itemId: HAREBOURG.ring }]), DATA))).toEqual([
      'duplicate',
    ])
    const ok = computeBuildStats(strengthBuild([{ itemId: BRACELET_MING }, { itemId: BRACELET_MING }]), DATA)
    expect(ok.valid).toBe(true)
    // Deux anneaux identiques de panoplie : comptés une seule fois pour la panoplie.
    const dup = computeBuildStats(strengthBuild([{ itemId: HAREBOURG.ring }, { itemId: HAREBOURG.ring }]), DATA)
    expect(dup.sets).toEqual([{ setId: HAREBOURG.set, count: 1, tier: 0 }])
  })

  it('Dofus : pas de doublon, 6 emplacements, une seule prysmaradite', () => {
    expect(codes(computeBuildStats(strengthBuild([{ itemId: OCRE }, { itemId: OCRE }]), DATA))).toEqual(['duplicate'])
    const seven = [OCRE, TURQUOISE, GLACES, VULBIS, 18043, 29136, 694].map(itemId => ({ itemId }))
    expect(codes(computeBuildStats(strengthBuild(seven), DATA))).toEqual(['slot'])
    expect(computeBuildStats(strengthBuild(seven.slice(0, 6)), DATA).valid).toBe(true)
    expect(codes(computeBuildStats(strengthBuild(PRYTEK.map(itemId => ({ itemId }))), DATA))).toEqual(['slot'])
    expect(computeBuildStats(strengthBuild([{ itemId: PRYTEK[0] }, { itemId: OCRE }]), DATA).valid).toBe(true)
  })

  it('arme à deux mains et bouclier : autorisé (règle supprimée en 2.41), interdit en option', () => {
    // Le Balai rudimentaire (quête, condition de carte « Pm ») est la seule arme à deux mains des données.
    const items = [{ itemId: BALAI }, { itemId: SHIELD_BROUCE }]
    expect(computeBuildStats(strengthBuild(items), DATA, { checkConditions: false }).valid).toBe(true)
    const strict = computeBuildStats(strengthBuild(items), DATA, { checkConditions: false, twoHandedBlocksShield: true })
    expect(codes(strict)).toEqual(['twoHanded'])
    expect(computeBuildStats(strengthBuild([{ itemId: 21229 }, { itemId: SHIELD_BROUCE }]), DATA).issues.map(i => i.code)).toEqual([
      'condition', // Baguette de Torkélonia sans 300 Agi
    ])
  })

  it('emplacement incohérent, niveau requis, objet inconnu, emplacement non équipable', () => {
    expect(codes(computeBuildStats(strengthBuild([{ slot: 'amulet', itemId: HAREBOURG.hat }]), DATA))).toEqual(['slot'])
    expect(
      codes(computeBuildStats(strengthBuild([{ itemId: HAREBOURG.hat }], { level: 199, characteristicPoints: {} }), DATA)),
    ).toEqual(['itemLevel'])
    expect(codes(computeBuildStats(strengthBuild([{ itemId: 999999 }]), DATA))).toEqual(['item'])
    expect(codes(computeBuildStats(strengthBuild([{ itemId: 1 }]), synthetic([{ id: 1, slot: 'other' }])))).toEqual(['slot'])
    // Plusieurs objets du même emplacement unique.
    const data = synthetic([{ id: 1, slot: 'pet' }, { id: 2, slot: 'pet' }])
    expect(codes(computeBuildStats(strengthBuild([{ itemId: 1 }, { itemId: 2 }]), data))).toEqual(['slot'])
  })
})

describe('stats/build — conditions d\'objets sur l\'état final', () => {
  it('trophée « Pk<3 » : accepté à 2 bonus de panoplie, refusé à 3', () => {
    const one = computeBuildStats(
      strengthBuild([{ itemId: HAREBOURG.hat }, { itemId: HAREBOURG.ring }, { itemId: HAREBOURG.boots }, { itemId: OBSTRUCTEUR_MAJEUR }]),
      DATA,
    )
    expect(one.setBonusCount).toBe(2)
    expect(one.valid).toBe(true)
    expect(one.stats.tackleBlock).toBe(60 + 32)
    const two = computeBuildStats(
      strengthBuild([
        { itemId: HAREBOURG.hat },
        { itemId: HAREBOURG.ring },
        { itemId: HAREBOURG.boots },
        { itemId: 19246 }, // Cape du Cœur Saignant
        { itemId: 19244 }, // Amulette du Cœur Saignant
        { itemId: OBSTRUCTEUR_MAJEUR },
      ]),
      DATA,
    )
    expect(two.setBonusCount).toBe(3)
    expect(two.valid).toBe(false)
    expect(two.warnings[0]).toContain('Pk<3 (bonus de panoplie = 3)')
  })

  it('« CP<12|CM<6 » évalué sur les PA/PM bruts, objet inclus', () => {
    const data = synthetic([
      { id: 1, slot: 'hat', conditions: 'CP<12|CM<6', effects: [{ effectId: 111, min: 1, max: 1 }] },
      { id: 2, slot: 'amulet', effects: [{ effectId: 111, min: 3, max: 3 }] },
      { id: 3, slot: 'boots', effects: [{ effectId: 128, min: 3, max: 3 }] },
      { id: 4, slot: 'belt', effects: [{ effectId: 111, min: 2, max: 2 }] },
    ])
    expect(computeBuildStats(strengthBuild([{ itemId: 1 }, { itemId: 2 }, { itemId: 3 }]), data).valid).toBe(true) // 11 PA
    const r = computeBuildStats(strengthBuild([{ itemId: 1 }, { itemId: 2 }, { itemId: 3 }, { itemId: 4 }]), data)
    expect(r.raw.ap).toBe(13)
    expect(r.stats.ap).toBe(12)
    expect(r.valid).toBe(false)
    expect(r.issues.find(i => i.code === 'condition')?.itemId).toBe(1)
    expect(computeBuildStats(strengthBuild([{ itemId: 1 }, { itemId: 2 }, { itemId: 4 }]), data).valid).toBe(true) // 6 PM non atteints
    expect(
      computeBuildStats(strengthBuild([{ itemId: 1 }, { itemId: 2 }, { itemId: 3 }, { itemId: 4 }]), data, { checkConditions: false }).valid,
    ).toBe(true)
  })

  it('conditions de classe, de sexe et de niveau ; conditions illisibles ou inconnues', () => {
    const data = synthetic([
      { id: 1, conditions: 'PG=3' },
      { id: 2, slot: 'hat', conditions: 'PS=1' },
      { id: 3, slot: 'belt', conditions: 'PL<6' },
      { id: 4, slot: 'boots', conditions: 'CA>(' },
      { id: 5, slot: 'cloak', conditions: 'Zz>1' },
    ])
    expect(computeBuildStats(strengthBuild([{ itemId: 1 }]), data).valid).toBe(false)
    expect(computeBuildStats({ ...strengthBuild([{ itemId: 1 }]), breedId: ENUTROF }, data).valid).toBe(true)
    expect(computeBuildStats(strengthBuild([{ itemId: 2 }]), data).valid).toBe(true)
    expect(computeBuildStats(strengthBuild([{ itemId: 2 }], { sex: 0 }), data).valid).toBe(false)
    expect(computeBuildStats(strengthBuild([{ itemId: 2 }], { sex: 0 }), data, { conditionProfile: { sex: 1 } }).valid).toBe(false)
    expect(computeBuildStats(strengthBuild([{ itemId: 2 }]), data, { conditionProfile: { sex: 1 } }).valid).toBe(true)
    expect(computeBuildStats(strengthBuild([{ itemId: 3 }]), data).valid).toBe(false)
    const unreadable = computeBuildStats(strengthBuild([{ itemId: 4 }, { itemId: 5 }]), data)
    expect(unreadable.valid).toBe(true)
    expect(unreadable.issues.map(i => [i.code, i.severity])).toEqual([
      ['condition', 'warning'],
      ['condition', 'warning'],
    ])
    expect(unreadable.warnings[1]).toContain('Zz>1')
  })
})

describe('stats/build — points, parchemins, variantes de sorts, panoplies', () => {
  it('points dépassés, points invalides, points perdus', () => {
    const over = computeBuildStats({ ...nakedBuild(IOP), characteristicPoints: { strength: 995, vitality: 10 } }, DATA)
    expect(over.issues.map(i => [i.code, i.severity])).toEqual([
      ['points', 'error'], // 1005 > 995
      ['points', 'warning'], // 3 points perdus en Force
    ])
    expect(over.stats.strength).toBe(398)
    expect(over.points.remaining).toBe(-10)
    const bad = computeBuildStats({ ...nakedBuild(IOP), characteristicPoints: { agility: -5, chance: 2.5 } }, DATA)
    expect(bad.valid).toBe(false)
    expect(bad.issues.filter(i => i.code === 'points' && i.severity === 'error')).toHaveLength(2)
    // Points non finis (build JSON mal formé) : erreur, aucune boucle infinie, stats finies.
    const nan = computeBuildStats({ ...nakedBuild(IOP), characteristicPoints: { agility: NaN, strength: Infinity } }, DATA)
    expect(nan.issues.filter(i => i.code === 'points' && i.severity === 'error')).toHaveLength(2)
    expect(nan.stats.agility).toBe(0)
    expect(nan.stats.strength).toBe(0)
    expect(nan.points.spent).toBe(0)
  })

  it('parchemins plafonnés à 100', () => {
    const r = computeBuildStats({ ...nakedBuild(IOP), scrolls: { chance: 150, wisdom: -1 } }, DATA)
    const frac = computeBuildStats({ ...nakedBuild(IOP), scrolls: { agility: 12.5, strength: NaN } }, DATA)
    expect(frac.issues.map(i => [i.code, i.severity])).toEqual([
      ['scroll', 'error'],
      ['scroll', 'error'],
    ])
    expect(frac.stats.agility).toBe(0)
    expect(r.stats.chance).toBe(100)
    expect(r.additional.chance).toBe(100)
    expect(r.issues.map(i => [i.code, i.severity])).toEqual([
      ['scroll', 'error'],
      ['scroll', 'warning'],
    ])
  })

  it('niveau et classe invalides', () => {
    expect(computeBuildStats(nakedBuild(IOP, 0), DATA).issues.map(i => i.code)).toEqual(['level'])
    const unknown = computeBuildStats({ ...nakedBuild(99), characteristicPoints: { strength: 300 } }, DATA)
    expect(unknown.issues.map(i => [i.code, i.severity])).toEqual([['breed', 'warning']])
    expect(unknown.stats.strength).toBe(200) // paliers par défaut
  })

  it('variantes de sorts : 22 choix 0/1 débloqués au niveau du personnage', () => {
    const ok = computeBuildStats({ ...nakedBuild(IOP), spellVariants: new Array<0 | 1>(22).fill(1) }, DATA)
    expect(ok.warnings).toEqual([])
    const short = computeBuildStats({ ...nakedBuild(IOP), spellVariants: [0, 1] }, DATA)
    expect(short.issues.map(i => i.code)).toEqual(['spellVariants'])
    const bad = computeBuildStats({ ...nakedBuild(IOP), spellVariants: [...new Array<0 | 1>(21).fill(0), 2 as 0] }, DATA)
    expect(bad.issues.map(i => i.code)).toEqual(['spellVariants'])
    const low = computeBuildStats({ ...nakedBuild(IOP, 120), spellVariants: new Array<0 | 1>(22).fill(1) }, DATA)
    const unlock = BREEDS.get(IOP)!.spellPairUnlockLevels!
    const locked = unlock.filter(([, b]) => b > 120).length
    expect(locked).toBeGreaterThan(0)
    expect(low.issues.filter(i => i.code === 'spellVariants')).toHaveLength(locked)
  })

  it('panoplie inconnue, bonus pour 1 objet, objets au-delà du dernier palier', () => {
    const set: ItemSetData = {
      id: 9,
      name: 'test',
      items: [1, 2, 3],
      bonuses: {
        1: [{ effectId: 118, min: 5, max: 5 }],
        2: [{ effectId: 118, min: 20, max: 20 }, { effectId: 2897, min: 1, max: 8 }],
      },
    }
    const data = synthetic(
      [
        { id: 1, slot: 'hat', setId: 9 },
        { id: 2, slot: 'boots', setId: 9 },
        { id: 3, slot: 'belt', setId: 9 },
        { id: 4, slot: 'cloak', setId: 77 },
        { id: 5, slot: 'amulet', setId: 77 },
      ],
      [set],
    )
    const b = (ids: number[]) => computeBuildStats({ ...nakedBuild(IOP), items: ids.map(itemId => ({ itemId })) }, data)
    expect(b([1]).stats.strength).toBe(5)
    expect(b([1, 2]).stats.strength).toBe(20) // paliers non cumulatifs
    expect(b([1, 2, 3]).stats.strength).toBe(20) // palier 2 = dernier palier
    expect(b([1, 2, 3]).sets[0]).toEqual({ setId: 9, count: 3, tier: 2 })
    expect(b([1, 2, 3]).stats.ap).toBe(7) // plafond 2897 « PA max. 8 » sans effet
    const missing = b([4, 5])
    expect(missing.issues.map(i => [i.code, i.severity])).toEqual([['item', 'warning']])
    expect(missing.setBonusCount).toBe(1)
  })
})

describe('stats/build — chemin rapide (contributions pré-calculées) et chemin détaillé', () => {
  it('donnent les mêmes caractéristiques pour chaque politique de jet', () => {
    const ids = [21235, 19246, 18693, 21229, KOKULTE, 19244, 13115, 22205, 13114, 19245, 18043, OCRE, VULBIS, GLACES, TURQUOISE, 29136]
    for (const rollPolicy of ['max', 'min', 'mean', 'best'] as const) {
      const fast = computeBuildStats(strengthBuild(ids.map(itemId => ({ itemId }))), DATA, { rollPolicy })
      // `rolls: {}` force le chemin détaillé (ligne par ligne) sans changer les jets.
      const slow = computeBuildStats(strengthBuild(ids.map(itemId => ({ itemId, rolls: {} }))), DATA, { rollPolicy })
      expect(slow.stats, rollPolicy).toEqual(fast.stats)
      expect(slow.raw).toEqual(fast.raw)
      expect(slow.maxHp).toBe(fast.maxHp)
      expect(slow.passiveSpells).toEqual(fast.passiveSpells)
      expect(slow.issues).toEqual(fast.issues)
    }
  })

  it('appels successifs indépendants (accumulateur réutilisé)', () => {
    const a = computeBuildStats(strengthBuild([{ itemId: HAREBOURG.hat }]), DATA)
    computeBuildStats(strengthBuild([{ itemId: GLACES }, { itemId: OCRE }]), DATA)
    const b = computeBuildStats(strengthBuild([{ itemId: HAREBOURG.hat }]), DATA)
    expect(b.stats).toEqual(a.stats)
    expect(b.raw).not.toBe(a.raw)
  })
})

describe('stats/build — intégration avec le DataStore officiel (src/data/node.ts)', () => {
  it('mêmes résultats qu\'avec le chargeur local (vecteur Terre §12.2)', async () => {
    const { loadDataStore } = await import('../src/data/node')
    const store: BuildDataSource = loadDataStore()
    const ids = [21235, 19246, 18693, 21229, KOKULTE, 19244, 13115, 22205, 13114, 19245, 18043, OCRE, VULBIS, GLACES, TURQUOISE, 29136]
    const build = strengthBuild(ids.map(itemId => ({ itemId })))
    const official = computeBuildStats(build, store)
    const local = computeBuildStats(build, DATA)
    expect(official.stats).toEqual(local.stats)
    expect(official.maxHp).toBe(local.maxHp)
    expect(official.issues.map(i => i.code)).toEqual(local.issues.map(i => i.code))
    expect(official.stats.range).toBe(6)
    expect(store.breed(IOP)?.statPointCosts?.strength).toEqual([[0, 1], [100, 2], [200, 3], [300, 4]])
  })
})

describe('stats/build — régressions (revue adverse)', () => {
  it("un `kind: 'over'` déclaré sur une ligne absente ne contourne pas la limite d'un exo PA par personnage", () => {
    const r = computeBuildStats(
      strengthBuild([
        { itemId: HAREBOURG.ring, exos: [{ stat: 'ap', value: 1, kind: 'over' }] },
        { itemId: HAREBOURG.boots, exos: [{ stat: 'ap', value: 1, kind: 'over' }] },
        { itemId: HAREBOURG.hat, exos: [{ stat: 'ap', value: 1, kind: 'over' }] },
      ]),
      DATA,
    )
    expect(r.raw.ap).toBe(7 + 1 + 1) // base + panoplie 3 + UN seul exo
    expect(r.issues.filter(i => i.code === 'exoLimit')).toHaveLength(2)
    expect(r.warnings.filter(w => w.includes('exo PA ignoré'))).toHaveLength(2)
  })

  it('jets invalides (NaN, négatif, non entier) : erreur, jet de la politique retenu, stats finies', () => {
    for (const bad of [NaN, -3, 80.5, Infinity]) {
      const r = computeBuildStats(strengthBuild([{ itemId: HAREBOURG.hat, rolls: { 118: bad } }]), DATA)
      expect(r.valid, String(bad)).toBe(false)
      expect(r.issues.some(i => i.code === 'rolls' && i.severity === 'error')).toBe(true)
      expect(r.stats.strength).toBe(398 + 100 + 100) // jet max (politique par défaut)
      for (const k of STAT_KEYS) expect(Number.isFinite(r.stats[k]), k).toBe(true)
    }
  })

  it('niveau de familier invalide : erreur et bonus pleins ; sur un objet non familier : ignoré', () => {
    for (const bad of [NaN, -1, 101, 50.5]) {
      const r = computeBuildStats(strengthBuild([{ itemId: KOKULTE, petLevel: bad }]), DATA)
      expect(r.issues.map(i => [i.code, i.severity]), String(bad)).toEqual([['petLevel', 'error']])
      expect(r.stats.critical).toBe(15)
    }
    const zero = computeBuildStats(strengthBuild([{ itemId: KOKULTE, petLevel: 0 }]), DATA)
    expect(zero.valid).toBe(true)
    expect(zero.stats.critical).toBe(0)
    const notPet = computeBuildStats(strengthBuild([{ itemId: HAREBOURG.hat, petLevel: 10 }]), DATA)
    expect(notPet.issues.map(i => [i.code, i.severity])).toEqual([['petLevel', 'warning']])
    expect(notPet.stats.strength).toBe(398 + 100 + 100)
  })

  it('exos invalides (non entiers, clé inconnue) : refusés et jamais sommés', () => {
    const r = computeBuildStats(
      strengthBuild([
        { itemId: HAREBOURG.ring, exos: [{ stat: 'ap', value: 0.5 }] },
        { itemId: HAREBOURG.boots, exos: [{ stat: 'nimporte' as never, value: 3 }, { stat: 'agility', value: NaN }] },
      ]),
      DATA,
    )
    expect(r.valid).toBe(false)
    expect(r.raw.ap).toBe(7)
    expect(r.raw.agility).toBe(100)
    expect(Object.keys(r.stats).sort()).toEqual([...STAT_KEYS].sort())
    for (const k of STAT_KEYS) expect(Number.isFinite(r.stats[k]), k).toBe(true)
  })

  it('stats dérivées : arrondi inférieur ⌊x/10⌋ (DofusDB Math.floor), y compris pour un total négatif', () => {
    // Malus d'Agilité (154), de Sagesse (156) et de Chance (152) sans base : totaux négatifs.
    const data = synthetic([
      {
        id: 1,
        effects: [
          { effectId: 154, min: 25, max: 25 },
          { effectId: 156, min: 1, max: 1 },
          { effectId: 152, min: 5, max: 5 },
        ],
      },
    ])
    const r = computeBuildStats({ ...nakedBuild(IOP), items: [{ itemId: 1 }] }, data)
    expect(r.stats.agility).toBe(-25)
    expect(r.stats.tackleBlock).toBe(-3) // ⌊−2,5⌋ (la troncature donnerait −2)
    expect(r.stats.tackleEvade).toBe(-3)
    expect(r.stats.apParry).toBe(-1) // ⌊−0,1⌋
    expect(r.stats.mpReduction).toBe(-1)
    expect(r.stats.prospecting).toBe(99) // 100 + ⌊−0,5⌋
    expect(r.stats.initiative).toBe(-30)
  })
})

// ───────────── implémentation de référence indépendante (algorithme DofusDB de equipment.md §13, écrit littéralement)

/** Valeur de base obtenue avec `p` points (formule de coût de la doc, recherche linéaire). */
function refBase(stat: 'vitality' | 'wisdom' | 'element', p: number): number {
  if (stat === 'vitality') return p
  if (stat === 'wisdom') return Math.floor(p / 3)
  const cost = (x: number) => (x <= 100 ? x : x <= 200 ? 100 + 2 * (x - 100) : x <= 300 ? 300 + 3 * (x - 200) : 600 + 4 * (x - 300))
  let x = 0
  while (cost(x + 1) <= p) x++
  return x
}

const REF_CAP_CHARACTERISTICS: Record<number, 'ap' | 'mp' | 'range' | 'summons'> = { 1: 'ap', 23: 'mp', 19: 'range', 26: 'summons' }

function referenceStats(build: CharacterBuild, policy: 'max' | 'min'): { stats: Stats; maxHp: number } {
  const d = emptyStats()
  const pts = build.characteristicPoints
  d.vitality += refBase('vitality', pts.vitality ?? 0)
  d.wisdom += refBase('wisdom', pts.wisdom ?? 0)
  for (const k of ['strength', 'intelligence', 'chance', 'agility'] as const) d[k] += refBase('element', pts[k] ?? 0)
  for (const [k, v] of Object.entries(build.scrolls)) d[k as keyof Stats] += Math.min(100, v)
  const caps: Partial<Record<'ap' | 'mp' | 'range' | 'summons', number>> = {}
  const cap = (e: { min: number; max: number }) => {
    const k = REF_CAP_CHARACTERISTICS[e.min]
    if (k) caps[k] = Math.min(caps[k] ?? Infinity, e.max)
  }
  const setCount = new Map<number, Set<number>>()
  for (const eq of build.items) {
    const item = ITEMS.get(eq.itemId)!
    for (const e of item.effects) {
      if (e.effectId === 2897) cap(e)
      else applyItemEffect(d, e.effectId, policy === 'max' ? Math.max(e.min, e.max) : e.min)
    }
    if (item.setId !== null) setCount.set(item.setId, (setCount.get(item.setId) ?? new Set()).add(item.id))
  }
  for (const [setId, ids] of setCount) {
    const set = SETS.get(setId)
    if (!set) continue
    for (const e of itemSetBonusesFor(set, ids.size)) {
      if (e.effectId === 2897) cap(e)
      else applyItemEffect(d, e.effectId, Math.max(e.min, e.max))
    }
  }
  const s = { ...d }
  s.ap = Math.min(7 + d.ap, caps.ap ?? Infinity, 12)
  s.mp = Math.min(3 + d.mp, caps.mp ?? Infinity, 6)
  s.range = Math.min(d.range, caps.range ?? Infinity, 6)
  s.summons = Math.min(1 + d.summons, caps.summons ?? Infinity, 6)
  s.initiative = d.initiative + d.agility + d.chance + d.intelligence + d.strength
  s.prospecting = 100 + Math.floor(d.chance / 10) + d.prospecting
  s.tackleBlock = Math.floor(d.agility / 10) + d.tackleBlock
  s.tackleEvade = Math.floor(d.agility / 10) + d.tackleEvade
  for (const k of ['apParry', 'mpParry', 'apReduction', 'mpReduction'] as const) s[k] = Math.floor(d.wisdom / 10) + d[k]
  return { stats: s, maxHp: 55 + 5 * 199 + d.vitality }
}

describe('stats/build — comparaison exhaustive avec une implémentation de référence', () => {
  const naked = computeBuildStats(nakedBuild(IOP), DATA, { checkConditions: false }).raw

  it('chaque équipement des données, seul : contribution = Σ lignes signées ; chemins rapide et détaillé identiques', () => {
    let n = 0
    for (const item of ITEMS.values()) {
      for (const rollPolicy of ['max', 'min'] as const) {
        const build = { ...nakedBuild(IOP), items: [{ itemId: item.id }] }
        const fast = computeBuildStats(build, DATA, { rollPolicy, checkConditions: false })
        const expected = { ...naked }
        for (const e of item.effects) {
          if (e.effectId !== 2897) applyItemEffect(expected, e.effectId, rollPolicy === 'max' ? Math.max(e.min, e.max) : e.min)
        }
        // Une panoplie à 1 objet peut donner un bonus (palier « 1 »).
        const set = item.setId !== null ? SETS.get(item.setId) : undefined
        if (set) for (const e of itemSetBonusesFor(set, 1)) if (e.effectId !== 2897) applyItemEffect(expected, e.effectId, Math.max(e.min, e.max))
        expect(fast.raw, `${item.name} (${item.id}) ${rollPolicy}`).toEqual(expected)
        const slow = computeBuildStats({ ...build, items: [{ itemId: item.id, rolls: {} }] }, DATA, { rollPolicy, checkConditions: false })
        expect(slow.raw).toEqual(fast.raw)
        expect(slow.passiveSpells).toEqual(fast.passiveSpells)
        n++
      }
    }
    expect(n).toBe(2 * ITEMS.size)
  })

  it('chaque panoplie des données, de 1 à n objets : bonus du palier non cumulatif (src/data itemSetBonusesFor)', () => {
    let n = 0
    for (const set of SETS.values()) {
      const ids = set.items.filter(id => ITEMS.get(id)?.setId === set.id)
      for (let k = 1; k <= ids.length; k++) {
        const chosen = ids.slice(0, k)
        const r = computeBuildStats({ ...nakedBuild(IOP), items: chosen.map(itemId => ({ itemId })) }, DATA, { checkConditions: false })
        const expected = { ...naked }
        for (const id of chosen) for (const e of ITEMS.get(id)!.effects) if (e.effectId !== 2897) applyItemEffect(expected, e.effectId, Math.max(e.min, e.max))
        for (const e of itemSetBonusesFor(set, k)) if (e.effectId !== 2897) applyItemEffect(expected, e.effectId, Math.max(e.min, e.max))
        expect(r.raw, `${set.name} (${set.id}) × ${k}`).toEqual(expected)
        expect(r.setBonusCount).toBe(k - 1)
        n++
      }
    }
    expect(n).toBeGreaterThan(1500)
  })

  it('500 stuffs aléatoires (panoplies + objets niv. ≥ 150 + familier/monture, jets max et min) : stats finales et PV identiques', () => {
    const rng = new Rng(20261004)
    const pick = <T>(a: readonly T[]): T => a[rng.int(0, a.length - 1)]
    const bySlot = new Map<EquipmentSlot, ItemData[]>()
    for (const it of ITEMS.values()) {
      // Familiers/montures : niv. 20-60 dans les données, pas de filtre de niveau.
      if ((it.level < 150 && it.slot !== 'pet') || it.slot === 'other') continue
      const list = bySlot.get(it.slot) ?? []
      list.push(it)
      bySlot.set(it.slot, list)
    }
    const highSets = [...SETS.values()].filter(s => s.items.some(id => (ITEMS.get(id)?.level ?? 0) >= 150))
    const singleSlots: EquipmentSlot[] = ['amulet', 'belt', 'boots', 'hat', 'cloak', 'shield', 'weapon', 'pet']
    let capped = 0
    for (let t = 0; t < 500; t++) {
      const items: EquippedItem[] = []
      const used = new Map<EquipmentSlot, number>()
      const add = (it: ItemData) => {
        const cap = it.slot === 'ring' ? 2 : it.slot === 'dofus' ? 6 : 1
        if ((used.get(it.slot) ?? 0) >= cap || items.some(e => e.itemId === it.id && it.slot === 'dofus')) return
        used.set(it.slot, (used.get(it.slot) ?? 0) + 1)
        items.push({ itemId: it.id })
      }
      // 0 à 3 panoplies (complètes ou partielles), puis complément aléatoire.
      for (let k = rng.int(0, 3); k > 0; k--) {
        const set = pick(highSets)
        for (const id of set.items) if (ITEMS.has(id) && rng.chance(0.8)) add(ITEMS.get(id)!)
      }
      for (const slot of singleSlots) if (rng.chance(0.85)) add(pick(bySlot.get(slot)!))
      for (let k = 0; k < 2; k++) add(pick(bySlot.get('ring')!))
      for (let k = 0; k < 6; k++) add(pick(bySlot.get('dofus')!))
      const policy = t % 2 === 0 ? 'max' : 'min'
      const build = strengthBuild(items, { characteristicPoints: { strength: 600, vitality: 395 } })
      const r = computeBuildStats(build, DATA, { rollPolicy: policy, checkConditions: false })
      const ref = referenceStats(build, policy)
      expect(r.stats, `stuff ${t} : ${items.map(i => i.itemId).join(',')}`).toEqual(ref.stats)
      expect(r.maxHp).toBe(ref.maxHp)
      if (r.raw.ap > 12 || r.raw.mp > 6 || r.raw.range > 6) capped++
    }
    expect(capped).toBeGreaterThan(20) // les plafonds sont réellement exercés
  })
})

describe('stats/build — performance', () => {
  it('agrège un stuff complet de 16 objets rapidement', () => {
    const ids = [21235, 19246, 18693, 21229, KOKULTE, 19244, 13115, 22205, 13114, 19245, 18043, OCRE, VULBIS, GLACES, TURQUOISE, 29136]
    const build = strengthBuild(ids.map(itemId => ({ itemId })))
    const n = 20000
    const t0 = performance.now()
    let acc = 0
    for (let i = 0; i < n; i++) acc += computeBuildStats(build, DATA).stats.strength
    const perBuild = (performance.now() - t0) / n
    expect(acc).toBe(n * 1258)
    expect(perBuild).toBeLessThan(0.25) // ms
  })
})
