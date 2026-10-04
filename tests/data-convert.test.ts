import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EFFECT_DEFAULTS,
  POINT_ZONE,
  convertBreed,
  convertEffect,
  convertItem,
  convertItemEffect,
  convertItemSet,
  convertMap,
  convertMonster,
  convertMonsterGrade,
  convertSpell,
  convertSpellLevel,
  convertState,
  convertSummonerShare,
  expandEffectDefaults,
  internZoneSpec,
  itemSetBonusesFor,
  parseRawZone,
  parseZone,
  slotForTypeId,
  textFr,
} from '../src/data/convert'
import type { RawEquipment, RawMapFile, RawMonster, RawSpell, RawSpellEffect, RawSpellLevel } from '../src/data/raw'

const effect = (over: Partial<RawSpellEffect> = {}): RawSpellEffect => ({
  effectId: 99,
  effectUid: 1,
  order: 0,
  diceNum: 17,
  diceSide: 19,
  value: 0,
  duration: 0,
  delay: 0,
  random: 0,
  group: 0,
  targetMask: 'a,A',
  triggers: 'I',
  dispellable: 1,
  zone: 'L3,0,10,4',
  ...over,
})

const level = (over: Partial<RawSpellLevel> = {}): RawSpellLevel => ({
  id: 41301,
  spellId: 13115,
  grade: 1,
  apCost: 3,
  minRange: 1,
  range: 4,
  rangeCanBeBoosted: true,
  castInLine: true,
  castInDiagonal: false,
  castTestLos: true,
  needFreeCell: false,
  needTakenCell: false,
  needFreeTrapCell: false,
  criticalHitProbability: 10,
  maxStack: 1,
  maxCastPerTurn: 2,
  maxCastPerTarget: 0,
  minCastInterval: 0,
  initialCooldown: 0,
  globalCooldown: 0,
  minPlayerLevel: 1,
  statesCriterion: '',
  effects: [effect()],
  criticalEffect: [],
  ...over,
})

describe('zones', () => {
  it('parse la zone compacte Dofus 3 (forme, param1, param2, dégressivité)', () => {
    const z = parseZone('L3,0,10,4')
    expect(z).toMatchObject({ shape: 'L', size: 3, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false })
    expect(parseZone('C2,1,0,0')).toMatchObject({ shape: 'C', size: 2, minSize: 1, decreaseStepPct: 0, maxDecreaseCount: 0 })
    // formes à caractère spécial
    expect(parseZone('-2,0,10,4')).toMatchObject({ shape: '-', size: 2 })
    expect(parseZone('#2,2,10,4')).toMatchObject({ shape: '#', size: 2, minSize: 2 })
    expect(parseZone('l1,63,10,4', 's')).toMatchObject({ shape: 'l', size: 1, minSize: 63, stopAtTarget: true })
    // paramètres absents : défauts du client (1, 0, 10, 4)
    expect(parseZone('P')).toMatchObject({ shape: 'P', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4 })
    expect(parseZone('C2,,0')).toMatchObject({ shape: 'C', size: 2, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 4 })
  })

  it('décode les drapeaux c/s/d/v et les cellules explicites', () => {
    const z = parseZone('C1,0,10,4', 'cv')
    expect(z.includeCarried).toBe(true)
    expect(z.onlyIfInSight).toBe(true)
    expect(z.forcedDirection).toBe(false)
    expect(z.stopAtTarget).toBe(false)
    expect(parseZone('L2,0,10,4', 'd').forcedDirection).toBe(true)
    const list = parseZone(';1,0,10,4', '', [27, 41])
    expect(list.shape).toBe(';')
    expect(list.cells).toEqual([27, 41])
    expect(parseZone(';1,0,10,4', '', [27])).not.toBe(list)
  })

  it('interne les zones identiques (objets partagés et immuables)', () => {
    expect(parseZone('P1,0,10,4', 'c')).toBe(parseZone('P1,0,10,4', 'c'))
    expect(parseZone('P1,0,10,4', 'c')).not.toBe(parseZone('P1,0,10,4'))
    expect(Object.isFrozen(parseZone('X1,0,10,4'))).toBe(true)
    expect(parseZone(undefined)).toBe(POINT_ZONE)
    expect(POINT_ZONE.shape).toBe('P')
  })

  it('parse les zones d’armes au format texte Dofus 2', () => {
    expect(parseRawZone('P')).toMatchObject({ shape: 'P', size: 1, minSize: 0 })
    expect(parseRawZone('T1,10,1')).toMatchObject({ shape: 'T', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 1 })
    expect(parseRawZone('X1,0,10,1')).toMatchObject({ shape: 'X', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 1 })
    expect(parseRawZone('V1,10,2')).toMatchObject({ shape: 'V', size: 1, decreaseStepPct: 10, maxDecreaseCount: 2 })
    expect(parseRawZone('U1,10,1')).toMatchObject({ shape: 'U', size: 1, decreaseStepPct: 10, maxDecreaseCount: 1 })
    expect(parseRawZone('L3,10,3')).toMatchObject({ shape: 'L', size: 3, decreaseStepPct: 10, maxDecreaseCount: 3 })
    // défauts Dofus 3 (10 % × 4) si la dégressivité est omise ; taille min. pour C
    expect(parseRawZone('C2,1')).toMatchObject({ shape: 'C', size: 2, minSize: 1, decreaseStepPct: 10, maxDecreaseCount: 4 })
    expect(parseRawZone(undefined)).toBe(POINT_ZONE)
    expect(parseRawZone('  ')).toBe(POINT_ZONE)
  })

  it('zones d’armes : lecture identique à OTOMAI SpellZone.FromRawZone', () => {
    // taille par défaut 1 pour toutes les formes (DefaultRadius)
    expect(parseRawZone('X')).toMatchObject({ shape: 'X', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4 })
    // p3 = nombre max de paliers pour toutes les formes (écrase p2 pour les formes sans taille min.)
    expect(parseRawZone('T1,10,1,3')).toMatchObject({ shape: 'T', size: 1, decreaseStepPct: 10, maxDecreaseCount: 3 })
    expect(parseRawZone('X1,0,25,2')).toMatchObject({ shape: 'X', size: 1, minSize: 0, decreaseStepPct: 25, maxDecreaseCount: 2 })
    // paramètres vides ignorés (décalage des suivants)
    expect(parseRawZone('C2,,1')).toMatchObject({ shape: 'C', size: 2, minSize: 1, decreaseStepPct: 10, maxDecreaseCount: 4 })
    // p4 = stopAtTarget ; `l` garde l'ordre des données (size = distance min., minSize = longueur)
    expect(parseRawZone('l1,63,0,0,1')).toMatchObject({ shape: 'l', size: 1, minSize: 63, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: true })
    expect(parseRawZone('L3,10,3,4,0').stopAtTarget).toBe(false)
    // liste de cellules
    const list = parseRawZone(';27,41')
    expect(list).toMatchObject({ shape: ';', cells: [27, 41] })
    expect(Object.isFrozen(list.cells)).toBe(true)
    expect(parseRawZone('T1,10,1')).toBe(parseRawZone('T1,10,1'))
  })

  it('internZoneSpec : zone relue depuis JSON -> objet partagé et gelé', () => {
    const z = parseZone('C2,1,10,4', 'cv')
    expect(internZoneSpec(z)).toBe(z) // déjà interné
    const copy = JSON.parse(JSON.stringify(z))
    const a = internZoneSpec(copy)
    expect(a).not.toBe(copy)
    expect(a).toEqual(z)
    expect(Object.isFrozen(a)).toBe(true)
    expect(internZoneSpec(JSON.parse(JSON.stringify(z)))).toBe(a)
    // paramètres ou drapeaux différents : objets différents
    expect(internZoneSpec({ ...copy, onlyIfInSight: false })).not.toBe(a)
    expect(internZoneSpec({ ...copy, size: 3 })).not.toBe(a)
    const cells = internZoneSpec({ shape: ';', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false, cells: [3, 4] })
    expect(cells.cells).toEqual([3, 4])
    expect(internZoneSpec({ shape: ';', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false, cells: [3, 5] })).not.toBe(cells)
    // drapeaux optionnels absents = faux
    expect(internZoneSpec({ shape: 'P', size: 1, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false })).toMatchObject({
      includeCarried: false,
      onlyIfInSight: false,
      forcedDirection: false,
    })
  })
})

describe('effets et sorts', () => {
  it('réhydrate les champs par défaut des effets', () => {
    const full = expandEffectDefaults(effect({ effectElement: 2 }))
    expect(full.effectElement).toBe(2)
    expect(full.targetId).toBe(0)
    expect(full.visibleInTooltip).toBe(true)
    expect(full.forClientOnly).toBe(false)
    expect(expandEffectDefaults(effect()).effectElement).toBe(-1)
  })

  it('convertit un effet (élément, zone, durée de déclencheur, uid, client)', () => {
    const e = convertEffect(effect({ effectElement: 2, effectUid: 209315 }))
    expect(e).toMatchObject({ effectId: 99, diceNum: 17, diceSide: 19, element: 2, targetMask: 'a,A', triggers: 'I', uid: 209315 })
    expect(e.zone).toBe(parseZone('L3,0,10,4'))
    expect(e.triggerDuration).toBe(0)
    expect(e.clientOnly).toBe(false)
    const poison = convertEffect(effect({ effectId: 96, triggers: 'TB', effectTriggerDuration: 3, forClientOnly: true }))
    expect(poison.element).toBe(-1)
    expect(poison.triggerDuration).toBe(3)
    expect(poison.clientOnly).toBe(true)
    // défauts d'un autre fichier
    expect(convertEffect(effect(), { ...DEFAULT_EFFECT_DEFAULTS, effectElement: 4 }).element).toBe(4)
    // zone absente : point ; ancienne zone texte Dofus 2 seulement à défaut de zone compacte
    expect(convertEffect(effect({ zone: undefined })).zone).toBe(POINT_ZONE)
    expect(convertEffect(effect({ zone: undefined, rawZone: 'X1,0,10,1' })).zone).toBe(parseRawZone('X1,0,10,1'))
    expect(convertEffect(effect({ rawZone: 'X1,0,10,1' })).zone).toBe(parseZone('L3,0,10,4'))
  })

  it('convertit un grade de sort (critiques, condition d’états compilée, champs additionnels)', () => {
    const l = convertSpellLevel(
      level({
        statesCriterion: '(HS=3360|HS=3589)&HS!7',
        effects: [effect({ order: 1, effectId: 1080 }), effect({ order: 0 })],
        criticalEffect: [effect({ order: 2, diceNum: 20, diceSide: 23 })],
        needVisibleEntity: true,
        maxGlobalCastPerTurn: 2,
      }),
    )
    expect(l.levelId).toBe(41301)
    expect(l.critChance).toBe(10)
    expect(l.rangeBoostable).toBe(true)
    expect(l.effects.map(e => e.effectId)).toEqual([99, 1080]) // trié par order
    expect(l.criticalEffects).toHaveLength(1)
    expect(l.statesCriterion).toBe('(E3360|E3589)&e7')
    expect(l.statesCondition).toEqual([
      { has: [3360], not: [7] },
      { has: [3589], not: [7] },
    ])
    expect(l.needVisibleEntity).toBe(true)
    expect(l.needCellWithoutPortal).toBe(false)
    expect(l.maxGlobalCastPerTurn).toBe(2)
    expect(l.maxGlobalCastPerTarget).toBe(0)
    expect(convertSpellLevel(level()).statesCondition).toBeUndefined()
    expect(convertSpellLevel(level({ statesCriterion: 'XYZ' })).statesCondition).toBeUndefined()
  })

  it('convertit un sort (grades triés, noms, champs de classe)', () => {
    const raw: RawSpell & { breedId: number; pairIndex: number; variant: 0 } = {
      id: 13115,
      name: { fr: 'Couperet', en: 'Chopper' },
      description: { fr: 'Dommages Feu', en: null },
      typeId: 8,
      iconId: 11855,
      spellLevels: [3, 1, 2],
      levels: [level({ id: 3, grade: 3, minPlayerLevel: 134 }), level({ id: 1, grade: 1 }), level({ id: 2, grade: 2, minPlayerLevel: 68 })],
      breedId: 8,
      pairIndex: 2,
      variant: 0,
      canAlwaysTriggerSpells: true,
    }
    const s = convertSpell(raw)
    expect(s.levels.map(l => l.grade)).toEqual([1, 2, 3])
    expect(s).toMatchObject({ id: 13115, name: 'Couperet', nameEn: 'Chopper', description: 'Dommages Feu', breedId: 8, pairIndex: 2, variant: 0, typeId: 8, iconId: 11855 })
    expect(s.canAlwaysTriggerSpells).toBe(true)
    expect(s.bypassSummoningLimit).toBeUndefined()
    const anon = convertSpell({ id: 5, name: null, typeId: 0, spellLevels: [], levels: [] })
    expect(anon.name).toBe('Sort 5')
    expect(anon.breedId).toBeUndefined()
  })

  it('convertit un état (drapeaux absents = false)', () => {
    const st = convertState({ id: 236, name: { fr: 'Marginal', en: 'Marginal' }, isSilent: true, effectsIds: [16] })
    expect(st).toMatchObject({ id: 236, name: 'Marginal', nameEn: 'Marginal', isSilent: true, effectsIds: [16], invulnerable: false })
    const inv = convertState({ id: 56, name: { fr: 'Invulnérable', en: 'Invulnerable' }, invulnerable: true })
    expect(inv.invulnerable).toBe(true)
    expect(inv.cantBeMoved).toBe(false)
    expect(inv.isSilent).toBeUndefined()
    expect(textFr(null)).toBe('')
    expect(textFr({ fr: null, en: 'x' })).toBe('x')
  })
})

describe('classes', () => {
  it('rôles mis en avant dans l’ordre, notes, paires et coûts des points', () => {
    const b = convertBreed(
      {
        id: 8,
        shortName: { fr: 'Iop', en: 'Iop' },
        roles: [
          { roleId: 5, value: 12, order: 1 },
          { roleId: 1, value: 2, order: -1 },
          { roleId: 8, value: 8, order: 2 },
        ],
        statsPointsForStrength: [[0, 1], [100, 2]],
        statsPointsForIntelligence: [[0, 1]],
        statsPointsForChance: [[0, 1]],
        statsPointsForAgility: [[0, 1]],
        statsPointsForVitality: [[0, 1]],
        statsPointsForWisdom: [[0, 3]],
        breedSpellsId: [13106, 14676],
        spellPairs: [[13106, 13139], [14676, null]],
        spellVariantIds: [179, null],
        spellPairUnlockLevels: [[1, 95], [1, 100]],
      },
      [
        { id: 1, name: { fr: 'Entrave', en: 'Debuffer' } },
        { id: 5, name: { fr: 'Dégâts', en: 'Damage Dealer' } },
        { id: 8, name: { fr: 'Amélioration', en: 'Buffer' } },
      ],
    )
    expect(b.roles).toEqual(['Dégâts', 'Amélioration'])
    expect(b.roleScores).toEqual({ Entrave: 2, Dégâts: 12, Amélioration: 8 })
    expect(b.spellPairs).toEqual([[13106, 13139], [14676, -1]])
    expect(b.statPointCosts?.strength).toEqual([[0, 1], [100, 2]])
    expect(b.statPointCosts?.wisdom).toEqual([[0, 3]])
    expect(b.spellPairUnlockLevels).toEqual([[1, 95], [1, 100]])
  })
})

describe('objets et panoplies', () => {
  it('emplacement selon typeId', () => {
    expect(slotForTypeId(1)).toBe('amulet')
    expect(slotForTypeId(9)).toBe('ring')
    expect(slotForTypeId(10)).toBe('belt')
    expect(slotForTypeId(11)).toBe('boots')
    expect(slotForTypeId(16)).toBe('hat')
    expect(slotForTypeId(17)).toBe('cloak')
    expect(slotForTypeId(82)).toBe('shield')
    for (const t of [2, 3, 4, 5, 6, 7, 8, 19, 20, 21, 22, 114, 271]) expect(slotForTypeId(t)).toBe('weapon')
    for (const t of [23, 151, 217]) expect(slotForTypeId(t)).toBe('dofus')
    for (const t of [18, 121, 331, 332, 333]) expect(slotForTypeId(t)).toBe('pet')
    expect(slotForTypeId(311)).toBe('other')
    expect(slotForTypeId(999)).toBe('other')
  })

  it('plage d’un effet d’objet : fixe, jet, paramètre value', () => {
    expect(convertItemEffect({ effectId: 111, diceNum: 1, diceSide: 0, value: 0 })).toEqual({ effectId: 111, min: 1, max: 1 })
    expect(convertItemEffect({ effectId: 125, diceNum: 251, diceSide: 300, value: 0 })).toEqual({ effectId: 125, min: 251, max: 300 })
    expect(convertItemEffect({ effectId: 281, diceNum: 13139, diceSide: 0, value: 2 })).toEqual({ effectId: 281, min: 13139, max: 13139, value: 2 })
    expect(convertItemEffect({ effectId: 1175, diceNum: 8395, diceSide: 1, value: 0 })).toEqual({ effectId: 1175, min: 8395, max: 1 })
  })

  it('convertit une arme (profil, zone) et un objet simple', () => {
    const staff: RawEquipment = {
      id: 140,
      name: { fr: 'Bâton de Boisaille', en: 'Twiggy Staff' },
      typeId: 4,
      level: 9,
      itemSetId: null,
      criterions: '',
      possibleEffects: [{ effectId: 100, diceNum: 7, diceSide: 11, value: 0, baseEffectId: 14 }],
      apCost: 4,
      minRange: 1,
      range: 2,
      castInLine: true,
      castInDiagonal: false,
      castTestLos: true,
      criticalHitProbability: 30,
      criticalHitBonus: 7,
      maxCastPerTurn: 1,
      twoHanded: false,
      weaponZone: 'T1,10,1',
    }
    const it = convertItem(staff, 'Bâton')
    expect(it).toMatchObject({ id: 140, slot: 'weapon', typeName: 'Bâton', setId: null, level: 9 })
    expect(it.weapon).toEqual({
      apCost: 4,
      minRange: 1,
      range: 2,
      critChance: 30,
      critBonus: 7,
      maxCastPerTurn: 1,
      castInLine: true,
      castInDiagonal: false,
      castTestLos: true,
      twoHanded: false,
    })
    expect(it.weaponZone).toBe(parseRawZone('T1,10,1'))
    const amu = convertItem({ id: 1, name: { fr: 'A', en: 'A' }, typeId: 1, level: 200, itemSetId: 271, criterions: 'CP<12', possibleEffects: [], isLegendary: true })
    expect(amu).toMatchObject({ slot: 'amulet', setId: 271, conditions: 'CP<12', isLegendary: true })
    expect(amu.weapon).toBeUndefined()
    expect(amu.weaponZone).toBeUndefined()
  })

  it('bonus de panoplie par nombre d’objets (paliers totaux, non cumulés)', () => {
    const set = convertItemSet({
      id: 107,
      name: { fr: 'Panoplie Tue-Mouche', en: null },
      level: 192,
      items: [9133, 9142],
      bonusesByItemCount: {
        '2': [{ effectId: 117, diceNum: 1, diceSide: 0, value: 0 }],
        '4': [{ effectId: 111, diceNum: 1, diceSide: 0, value: 0 }, { effectId: 117, diceNum: 1, diceSide: 0, value: 0 }],
      },
    })
    expect(set.bonuses[2]).toEqual([{ effectId: 117, min: 1, max: 1 }])
    expect(itemSetBonusesFor(set, 1)).toEqual([])
    expect(itemSetBonusesFor(set, 2)).toBe(set.bonuses[2])
    expect(itemSetBonusesFor(set, 3)).toBe(set.bonuses[2])
    expect(itemSetBonusesFor(set, 4)).toBe(set.bonuses[4])
    expect(itemSetBonusesFor(set, 9)).toBe(set.bonuses[4])
  })
})

describe('monstres', () => {
  it('caractéristiques propres du grade ; bonusCharacteristics = part (%) de l’invocateur, non fusionnée', () => {
    const g = convertMonsterGrade({
      grade: 2,
      level: 50,
      lifePoints: 0,
      actionPoints: 6,
      movementPoints: 3,
      vitality: 10,
      strength: 100,
      earthResistance: 10,
      paDodge: 5,
      pmDodge: 7,
      damageReflect: 12,
      bonusRange: 1,
      bonusCharacteristics: { lifePoints: 30, strength: 50, earthResistance: 5, tackleBlock: 20, bonusFireDamage: 15, aPRemoval: 4, unknownKey: 99, agility: 0 },
    })
    expect(g.lifePoints).toBe(0) // les 30 % de PV de l'invocateur ne sont pas des PV fixes
    expect(g.ap).toBe(6)
    expect(g.mp).toBe(3)
    expect(g.stats).toEqual({ ap: 6, mp: 3, vitality: 10, strength: 100, earthResPct: 10, apParry: 5, mpParry: 7, reflect: 12, range: 1 })
    expect(g.summonerShare).toEqual({
      lifePct: 30,
      stats: { strength: 50, earthResPct: 5, tackleBlock: 20, fireDamage: 15, apReduction: 4 },
    })
    expect(g.startingSpellLevelId).toBeUndefined()
  })

  it('summonerShare : absente sans bonus utile, PV seuls ou caractéristiques seules', () => {
    const base = { grade: 1, level: 1, lifePoints: 0, actionPoints: 0, movementPoints: 0 }
    expect(convertSummonerShare(undefined)).toBeUndefined()
    expect(convertSummonerShare({})).toBeUndefined()
    expect(convertSummonerShare({ lifePoints: 0, unknownKey: 5 })).toBeUndefined()
    expect(convertMonsterGrade(base).summonerShare).toBeUndefined()
    expect(convertMonsterGrade({ ...base, bonusCharacteristics: {} }).summonerShare).toBeUndefined()
    expect(convertSummonerShare({ lifePoints: 60 })).toEqual({ lifePct: 60, stats: {} })
    expect(convertSummonerShare({ tackleEvade: 200, tackleBlock: 200 })).toEqual({ lifePct: 0, stats: { tackleEvade: 200, tackleBlock: 200 } })
    // 100 % des résistances de l'invocateur (et non 100 % de résistance : l'invocation serait immunisée)
    const res = convertMonsterGrade({ ...base, neutralResistance: 15, bonusCharacteristics: { neutralResistance: 100 } })
    expect(res.stats.neutralResPct).toBe(15)
    expect(res.summonerShare?.stats.neutralResPct).toBe(100)
  })

  it('conserve les paramètres bruts de mise à l’échelle (characRatios, scaleGradeRef)', () => {
    const raw: RawMonster = {
      id: 2,
      name: null,
      race: 1,
      isBoss: false,
      isMiniBoss: false,
      canPlay: true,
      canTackle: true,
      canBePushed: true,
      canSwitchPos: true,
      useSummonSlot: false,
      spells: [],
      spellGrades: [],
      grades: [],
      characRatios: [[0, 1.1], [10, 0.929735]],
      scaleGradeRef: 6,
    }
    const m = convertMonster(raw)
    expect(m.characRatios).toEqual([[0, 1.1], [10, 0.929735]])
    expect(m.characRatios).not.toBe(raw.characRatios)
    expect(m.scaleGradeRef).toBe(6)
    expect(m.name).toBe('Monstre 2')
    const bare = convertMonster({ ...raw, characRatios: undefined, scaleGradeRef: undefined })
    expect('characRatios' in bare).toBe(false)
    expect('scaleGradeRef' in bare).toBe(false)
  })

  it('résout le sort de départ (id de spell-level) et filtre les sorts invalides', () => {
    const raw: RawMonster = {
      id: 1,
      name: { fr: 'Test', en: null },
      race: 132,
      isBoss: true,
      isMiniBoss: false,
      canPlay: true,
      canTackle: true,
      canBePushed: false,
      canSwitchPos: true,
      useSummonSlot: true,
      spells: [5068, -1, 5070],
      spellGrades: [[1, 2], [1, 1], [0, 3]],
      grades: [
        { grade: 2, level: 10, lifePoints: 200, actionPoints: 6, movementPoints: 3, startingSpellId: 99999 },
        { grade: 1, level: 5, lifePoints: 100, actionPoints: 6, movementPoints: 3, startingSpellId: 22886 },
      ],
    }
    const m = convertMonster(raw, id => (id === 22886 ? { spellId: 5006, grade: 1 } : undefined))
    expect(m.spells).toEqual([5068, 5070])
    expect(m.spellGrades).toEqual([[1, 2], [0, 3]])
    expect(m.grades.map(g => g.grade)).toEqual([1, 2])
    expect(m.grades[0].startingSpell).toEqual({ spellId: 5006, grade: 1 })
    expect(m.grades[1].startingSpellLevelId).toBe(99999)
    expect(m.grades[1].startingSpell).toBeUndefined()
    expect(m).toMatchObject({ raceId: 132, isBoss: true, canBePushed: false, tags: [], useBombSlot: false, summonCost: 0 })
  })
})

describe('cartes', () => {
  it('cases marchables, ligne de vue, placements rouge = 1 / bleu = 2', () => {
    const raw: RawMapFile = {
      mapId: 42,
      name: 'Test',
      cells: [
        { id: 0, walkable: true, los: true, red: true },
        { id: 1, walkable: true, los: true, blue: true },
        { id: 2, walkable: false, los: false },
        { id: 3, mov: 1, los: 1, nonWalkableDuringFight: 1 },
        { id: 4, mov: 1, los: 1 },
        { id: 5, walkable: true, los: true, red: true, blue: true },
      ],
      annotations: { note: 'x' },
    }
    const m = convertMap(raw)
    expect(m.id).toBe(42)
    expect(m.cells).toHaveLength(560)
    expect(m.cells[0]).toEqual({ id: 0, walkable: true, los: true, placement: 1 })
    expect(m.cells[1].placement).toBe(2)
    expect(m.cells[2]).toEqual({ id: 2, walkable: false, los: false, placement: 0 })
    expect(m.cells[3].walkable).toBe(false) // nonWalkableDuringFight
    expect(m.cells[4].walkable).toBe(true)
    expect(m.cells[5].placement).toBe(1)
    expect(m.redCells).toEqual([0, 5])
    expect(m.blueCells).toEqual([1, 5])
    // cases absentes : non marchables
    expect(m.cells[300]).toEqual({ id: 300, walkable: false, los: true, placement: 0 })
    expect(m.annotations).toEqual({ note: 'x' })
    expect(m.approximate).toBe(false)
  })
})
