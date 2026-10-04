import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EquipmentSlot, ItemData } from '../src/data/model'
import { IGNORED_STAT_EFFECT_IDS, itemEffectStat } from '../src/stats/effects'
import {
  checkItemForgemagie,
  exoCostTier,
  FORGEABLE_STATS,
  forgeKind,
  isForgeable,
  itemForgeCostTier,
  lineWeight,
  listExoOptions,
  maxLineValue,
  RUNE_WEIGHT_PER_POINT,
  runeWeightPerPoint,
  TRANSCENDENCE_RUNES,
} from '../src/stats/forgemagie'

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T

// ── mini-chargeur local des équipements DofusDB (le chargeur officiel est src/data, en construction)
interface RawItem {
  id: number
  name: { fr: string }
  typeId: number
  slot: string
  level: number
  itemSetId: number | null
  criterions: string
  possibleEffects: { effectId: number; diceNum: number; diceSide: number }[]
}
const SLOT_ALIASES: Record<string, EquipmentSlot> = { trophy: 'dofus', prysmaradite: 'dofus', petsmount: 'pet', mount: 'pet' }
const items = new Map<number, ItemData>()
for (const r of readJson<RawItem[]>('../data/dofusdb/equipment.json')) {
  items.set(r.id, {
    id: r.id,
    name: r.name.fr,
    typeId: r.typeId,
    slot: SLOT_ALIASES[r.slot] ?? (r.slot as EquipmentSlot),
    level: r.level,
    setId: r.itemSetId ?? null,
    conditions: r.criterions ?? '',
    effects: r.possibleEffects.map(e => ({ effectId: e.effectId, min: e.diceNum, max: e.diceSide || e.diceNum })),
  })
}
const item = (id: number): ItemData => {
  const i = items.get(id)
  if (!i) throw new Error(`objet ${id} absent`)
  return i
}
/** Jets max de toutes les lignes d'un objet. */
const maxRolls = (i: ItemData): number[] => i.effects.map(e => Math.max(e.min, e.max))

const HAT_HAREBOURG = 14076 // Vita 451-500, Fo 71-100, Sa 41-60, PO 1, … malus de rés. %
const RING_HAREBOURG = 14077
const AMULET_COEUR = 19244 // +1 PA naturel
const DOFUS_OCRE = 7754
const WEAPON = 8098 // Lame Usicke, niv. 200
const SHIELD = 18670

interface FmJson {
  runeWeights: Record<string, { stat: string; weightPerPoint: number; overmaxLineCapPoints: number; forgeable: boolean }>
  transcendanceRunes: { itemId: number; name: string; tier: string; level: number; effectId: number; value: number }[]
  exoOptions: { id: string; effectId?: number; effectIds?: number[]; value?: number; valueRange?: [number, number]; costTier?: number }[]
  rules: { overmax: { lineWeightCap: number; examples: Record<string, number> } }
}
const fm = readJson<FmJson>('../data/research/forgemagie.json')

describe('stats/forgemagie — tables recopiées de forgemagie.json', () => {
  it('poids par point, lignes forgeables et plafonds d\'over', () => {
    expect(fm.rules.overmax.lineWeightCap).toBe(101)
    let n = 0
    for (const [id, rw] of Object.entries(fm.runeWeights)) {
      const stat = itemEffectStat(Number(id))
      if (!stat) {
        // Pods, réductions physique/magique, puissance des glyphes : pas de clé Stats (ignorés à dessein).
        expect(IGNORED_STAT_EFFECT_IDS.has(Number(id)), `${id} ${rw.stat}`).toBe(true)
        continue
      }
      expect(runeWeightPerPoint(stat), `${id} ${stat}`).toBe(rw.weightPerPoint)
      expect(FORGEABLE_STATS.has(stat), `${id} forgeable`).toBe(rw.forgeable)
      if (rw.forgeable) expect(maxLineValue(stat, 0), `${id} over`).toBe(rw.overmaxLineCapPoints)
      n++
    }
    expect(n).toBe(Object.keys(RUNE_WEIGHT_PER_POINT).length)
  })

  it('exemples d\'over de la doc (ligne ≤ 101 de poids)', () => {
    const ex = fm.rules.overmax.examples
    expect(maxLineValue('vitality')).toBe(ex.vitality)
    expect(maxLineValue('strength')).toBe(ex.strength)
    expect(maxLineValue('wisdom')).toBe(ex.wisdom)
    expect(maxLineValue('critical')).toBe(ex.criticalHit)
    expect(maxLineValue('power')).toBe(ex.power)
    expect(maxLineValue('earthDamage')).toBe(ex.elementalDamage)
    expect(maxLineValue('fireResPct')).toBe(ex.resPercent)
    expect(maxLineValue('initiative')).toBe(1010)
    expect(maxLineValue('ap')).toBe(1)
    // Jet max naturel déjà au-delà de 101 de poids : pas d'over.
    expect(maxLineValue('wisdom', 60)).toBe(60)
    expect(maxLineValue('range', 2)).toBe(2)
    expect(maxLineValue('strength', 100)).toBe(101)
    // Caractéristique sans rune : pas d'over.
    expect(maxLineValue('spellResPct', 3)).toBe(3)
    expect(maxLineValue('lifePoints', 0)).toBe(0)
    expect(lineWeight('vitality', 500)).toBe(100)
    expect(lineWeight('ap', 1)).toBe(100)
    expect(lineWeight('lifePoints', 1)).toBe(Infinity)
  })

  it('runes de transcendance (hors Pods)', () => {
    const json = fm.transcendanceRunes.filter(r => itemEffectStat(r.effectId))
    expect(TRANSCENDENCE_RUNES).toHaveLength(json.length)
    for (const r of json) {
      const mine = TRANSCENDENCE_RUNES.find(t => t.itemId === r.itemId)
      expect(mine, r.name).toBeDefined()
      expect(mine).toMatchObject({ name: r.name, tier: r.tier, level: r.level, value: r.value, stat: itemEffectStat(r.effectId) })
    }
  })

  it('options d\'exo : paliers de coût et plages de valeurs du JSON', () => {
    const ring = item(RING_HAREBOURG)
    const opts = listExoOptions(ring, { overs: false, transcendence: false })
    for (const o of fm.exoOptions) {
      if (!o.costTier || o.id.startsWith('transcendance')) continue
      const ids = o.effectIds ?? (o.effectId !== undefined ? [o.effectId] : [])
      for (const effectId of ids) {
        const stat = itemEffectStat(effectId)!
        const mine = opts.find(x => x.stat === stat)
        // L'anneau Harebourg n'a aucune des lignes du catalogue : toutes les options doivent être proposées.
        expect(mine, `${o.id} (${stat})`).toBeDefined()
        expect(mine!.costTier).toBe(o.costTier)
        expect(mine!.value).toBe(o.valueRange ? o.valueRange[1] : o.value)
        if (o.valueRange) expect(mine!.minValue).toBe(o.valueRange[0])
      }
    }
  })
})

describe('stats/forgemagie — options réalistes par objet', () => {
  it('coiffe Harebourg niv. 200 : exo PA/PM, pas d\'exo PO (ligne existante), overs et transcendances', () => {
    const hat = item(HAT_HAREBOURG)
    const opts = listExoOptions(hat)
    const ids = opts.map(o => o.id)
    expect(ids).toContain('exoPA')
    expect(ids).toContain('exoPM')
    expect(ids).not.toContain('exoPO') // PO 1 déjà présente (51 de poids : pas d'over à 2)
    expect(ids).not.toContain('over:range')
    expect(ids).not.toContain('exoResPercent:earth') // ligne malus présente
    const pa = opts.find(o => o.id === 'exoPA')!
    expect(pa).toMatchObject({ kind: 'exo', stat: 'ap', value: 1, costTier: 5, oncePerCharacter: true, weight: 100 })
    expect(pa.exo).toEqual({ stat: 'ap', value: 1, kind: 'exo' })
    expect(opts.find(o => o.id === 'over:strength')).toMatchObject({ value: 1, costTier: 1, kind: 'over' })
    expect(opts.find(o => o.id === 'over:vitality')).toMatchObject({ value: 5 })
    expect(ids).not.toContain('over:wisdom') // 60 Sagesse = 180 de poids
    const so = opts.find(o => o.id === 'transcendence:20613')!
    expect(so).toMatchObject({ kind: 'transcendence', stat: 'spellDamagePct', value: 1, costTier: 4, oncePerCharacter: false })
    // Ligne existante déjà au plafond (Vitalité 500, plafond 505 ; Force 100, plafond 101) : aucune transcendance
    // ne passe (Ta Vi +50 ⇒ 550 > 505), même la plus faible — l'option serait refusée par checkItemForgemagie.
    expect(opts.filter(o => o.kind === 'transcendence' && o.stat === 'vitality')).toEqual([])
    expect(opts.filter(o => o.kind === 'transcendence' && o.stat === 'strength')).toEqual([])
    // Anneau Harebourg (Vitalité 350) : meilleur palier qui tient sous 505 = Rata Vi +100 (450), un seul par stat.
    const ringOpts = listExoOptions(item(RING_HAREBOURG))
    expect(ringOpts.filter(o => o.kind === 'transcendence' && o.stat === 'vitality').map(o => o.value)).toEqual([100])
    // Force 50 : Rata Fo +20 ⇒ 70 ≤ 101.
    expect(ringOpts.filter(o => o.kind === 'transcendence' && o.stat === 'strength').map(o => o.value)).toEqual([20])
  })

  it('chaque option proposée, seule sur un objet au jet parfait, est acceptée par checkItemForgemagie (tous les objets)', () => {
    // Propriété : listExoOptions ne propose que des lignes réalisables (cohérence avec le contrôle, plafond de 101 de
    // poids inclus pour les transcendances qui s'ajoutent à une ligne existante).
    let n = 0
    for (const it of items.values()) {
      if (!isForgeable(it)) continue
      const rolls = maxRolls(it)
      for (const o of listExoOptions(it, { anySlot: true })) {
        expect(checkItemForgemagie(it, rolls, [o.exo]), `${it.name} (${it.id}) ${o.id}`).toEqual([])
        expect(o.weight).toBe(lineWeight(o.stat, o.value))
        expect(o.value).toBeGreaterThanOrEqual(o.minValue)
        n++
      }
    }
    expect(n).toBeGreaterThan(50000)
  })

  it('transcendance plafonnée : palier inférieur retenu quand le meilleur dépasse 101 de poids', () => {
    // Objet synthétique niv. 200 : Puissance 40 (poids 80) ⇒ marge 10 : Rata Pui +12 refusée, Pata Pui +9 retenue.
    const synthetic: ItemData = {
      id: 1, name: 'test', typeId: 1, slot: 'amulet', level: 200, setId: null, conditions: '',
      effects: [{ effectId: 138, min: 31, max: 40 }],
    }
    const trans = listExoOptions(synthetic).filter(o => o.kind === 'transcendence' && o.stat === 'power')
    expect(trans.map(o => o.value)).toEqual([9])
    expect(checkItemForgemagie(synthetic, [40], [{ stat: 'power', value: 12, kind: 'transcendence' }])).toHaveLength(1)
    expect(checkItemForgemagie(synthetic, [40], [{ stat: 'power', value: 9, kind: 'transcendence' }])).toEqual([])
  })

  it('filtre de coût, emplacements typiques et objets non forgeables', () => {
    const hat = item(HAT_HAREBOURG)
    expect(listExoOptions(hat, { maxCostTier: 2 }).every(o => o.costTier <= 2)).toBe(true)
    expect(listExoOptions(hat, { maxCostTier: 0 })).toEqual([])
    expect(listExoOptions(item(DOFUS_OCRE))).toEqual([])
    expect(isForgeable(item(DOFUS_OCRE))).toBe(false)
    const weaponIds = listExoOptions(item(WEAPON)).map(o => o.id)
    expect(weaponIds).not.toContain('exoPA')
    expect(weaponIds).toContain('exoDamage')
    expect(listExoOptions(item(WEAPON), { anySlot: true }).map(o => o.id)).toContain('exoPA')
    expect(listExoOptions(item(SHIELD)).map(o => o.id)).not.toContain('exoPM')
    // Amulette avec 1 PA naturel : ni exo ni over PA.
    const amuIds = listExoOptions(item(AMULET_COEUR)).map(o => o.id)
    expect(amuIds).not.toContain('exoPA')
    expect(amuIds).not.toContain('over:ap')
  })

  it('niveau de l\'objet et runes de transcendance', () => {
    const low = [...items.values()].find(i => i.slot === 'ring' && i.level === 130)!
    const opts = listExoOptions(low)
    const trans = opts.filter(o => o.kind === 'transcendence')
    expect(trans.length).toBeGreaterThan(0)
    for (const o of trans) {
      const rune = TRANSCENDENCE_RUNES.find(r => `transcendence:${r.itemId}` === o.id)!
      expect(rune.level).toBeLessThanOrEqual(130)
    }
    expect(trans.find(o => o.stat === 'strength')?.value).toBe(15) // Pata (126), pas Rata (148)
    expect(trans.find(o => o.stat === 'spellDamagePct')).toBeUndefined()
  })
})

describe('stats/forgemagie — contrôle d\'un objet forgemagé', () => {
  const hat = item(HAT_HAREBOURG)
  const ring = item(RING_HAREBOURG)
  const amulet = item(AMULET_COEUR)

  it('exos valides', () => {
    expect(checkItemForgemagie(ring, maxRolls(ring), [{ stat: 'ap', value: 1 }])).toEqual([])
    expect(checkItemForgemagie(ring, maxRolls(ring), [{ stat: 'agility', value: 50 }, { stat: 'damage', value: 5 }])).toEqual([])
    expect(checkItemForgemagie(hat, maxRolls(hat), [{ stat: 'strength', value: 1 }])).toEqual([]) // over 101
    expect(checkItemForgemagie(hat, maxRolls(hat), undefined)).toEqual([])
    expect(checkItemForgemagie(hat, maxRolls(hat), [])).toEqual([])
  })

  it('plafond de poids : over trop fort, exo sur une ligne pleine', () => {
    expect(checkItemForgemagie(hat, maxRolls(hat), [{ stat: 'strength', value: 2 }])).toHaveLength(1)
    expect(checkItemForgemagie(amulet, maxRolls(amulet), [{ stat: 'ap', value: 1 }])).toHaveLength(1)
    expect(checkItemForgemagie(hat, maxRolls(hat), [{ stat: 'range', value: 1 }])).toHaveLength(1)
    expect(checkItemForgemagie(ring, maxRolls(ring), [{ stat: 'agility', value: 102 }])).toHaveLength(1)
    // Over via les jets : 101 Force OK, 102 refusé ; jet au-dessous du min autorisé.
    const rolls = maxRolls(hat)
    const iStr = hat.effects.findIndex(e => e.effectId === 118)
    rolls[iStr] = 101
    expect(checkItemForgemagie(hat, rolls, undefined)).toEqual([])
    rolls[iStr] = 102
    expect(checkItemForgemagie(hat, rolls, undefined)).toHaveLength(1)
    rolls[iStr] = 10
    expect(checkItemForgemagie(hat, rolls, undefined)).toEqual([])
    rolls[iStr] = -1
    expect(checkItemForgemagie(hat, rolls, undefined)).toHaveLength(1)
    // Sagesse 60 (180 de poids) : aucun over possible.
    const iWis = hat.effects.findIndex(e => e.effectId === 124)
    const r2 = maxRolls(hat)
    r2[iWis] = 61
    expect(checkItemForgemagie(hat, r2, undefined)).toHaveLength(1)
  })

  it('transcendances', () => {
    const so = { stat: 'spellDamagePct' as const, value: 1, kind: 'transcendence' as const }
    expect(checkItemForgemagie(hat, maxRolls(hat), [so])).toEqual([])
    // Transcendance qui crée un over sur une ligne existante : plafond de 101 de poids (Vitalité 505).
    const rataVi = { stat: 'vitality' as const, value: 100, kind: 'transcendence' as const }
    expect(checkItemForgemagie(hat, maxRolls(hat), [rataVi])).toHaveLength(1) // 500 + 100 > 505
    expect(checkItemForgemagie(ring, maxRolls(ring), [rataVi])).toEqual([]) // 350 + 100 ≤ 505
    expect(checkItemForgemagie(hat, maxRolls(hat), [so, { stat: 'ap', value: 1 }]).length).toBeGreaterThan(0)
    expect(checkItemForgemagie(hat, maxRolls(hat), [so, { stat: 'power', value: 12, kind: 'transcendence' }])).toHaveLength(1)
    expect(checkItemForgemagie(hat, maxRolls(hat), [{ stat: 'spellDamagePct', value: 2, kind: 'transcendence' }])).toHaveLength(1)
    const rolls = maxRolls(hat)
    rolls[hat.effects.findIndex(e => e.effectId === 118)] = 101 // over par les jets
    expect(checkItemForgemagie(hat, rolls, [so])).toHaveLength(1)
    const low = [...items.values()].find(i => i.slot === 'hat' && i.level === 150)!
    expect(checkItemForgemagie(low, maxRolls(low), [so])).toHaveLength(1) // rune niv. 200
  })

  it('objets non forgeables, caractéristiques sans rune, valeurs invalides', () => {
    const ocre = item(DOFUS_OCRE)
    expect(checkItemForgemagie(ocre, maxRolls(ocre), [{ stat: 'mp', value: 1 }]).length).toBeGreaterThan(0)
    expect(checkItemForgemagie(ring, maxRolls(ring), [{ stat: 'spellResPct', value: 1 }]).length).toBeGreaterThan(0)
    expect(checkItemForgemagie(ring, maxRolls(ring), [{ stat: 'power', value: 0 }]).length).toBeGreaterThan(0)
    // Valeurs non entières ou non finies (exos et jets).
    expect(checkItemForgemagie(ring, maxRolls(ring), [{ stat: 'ap', value: 0.5 }]).length).toBeGreaterThan(0)
    expect(checkItemForgemagie(ring, maxRolls(ring), [{ stat: 'power', value: NaN }]).length).toBeGreaterThan(0)
    const rolls = maxRolls(ring)
    rolls[0] = NaN
    expect(checkItemForgemagie(ring, rolls, undefined).length).toBeGreaterThan(0)
    rolls[0] = 340.5
    expect(checkItemForgemagie(ring, rolls, undefined).length).toBeGreaterThan(0)
  })

  it('type de ligne et paliers de coût', () => {
    expect(forgeKind(hat, { stat: 'strength', value: 1 })).toBe('over')
    expect(forgeKind(hat, { stat: 'ap', value: 1 })).toBe('exo')
    expect(forgeKind(hat, { stat: 'earthResPct', value: 3 })).toBe('exo') // seule une ligne malus existe
    expect(forgeKind(hat, { stat: 'vitality', value: 50, kind: 'transcendence' })).toBe('transcendence')
    // exo / over toujours déduits de l'objet : un `kind` déclaré incohérent est ignoré.
    expect(forgeKind(hat, { stat: 'ap', value: 1, kind: 'over' })).toBe('exo')
    expect(forgeKind(hat, { stat: 'strength', value: 1, kind: 'exo' })).toBe('over')
    expect(exoCostTier(hat, { stat: 'ap', value: 1, kind: 'over' })).toBe(5)
    expect(exoCostTier(hat, { stat: 'ap', value: 1 })).toBe(5)
    expect(exoCostTier(hat, { stat: 'mp', value: 1 })).toBe(5)
    expect(exoCostTier(ring, { stat: 'range', value: 1 })).toBe(4)
    expect(exoCostTier(ring, { stat: 'summons', value: 1 })).toBe(3)
    expect(exoCostTier(ring, { stat: 'agility', value: 20 })).toBe(2)
    expect(exoCostTier(hat, { stat: 'strength', value: 1 })).toBe(1)
    expect(exoCostTier(hat, { stat: 'spellDamagePct', value: 1, kind: 'transcendence' })).toBe(4)
    expect(exoCostTier(hat, { stat: 'power', value: 12, kind: 'transcendence' })).toBe(3)
    expect(itemForgeCostTier(hat, undefined)).toBe(0)
    expect(itemForgeCostTier(hat, [{ stat: 'strength', value: 1 }, { stat: 'mp', value: 1 }])).toBe(5)
  })
})
