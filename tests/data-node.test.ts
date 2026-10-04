import { describe, expect, it } from 'vitest'
import { Rng } from '../src/core/rng'
import { parseZone, MONSTER_BONUS_STATS } from '../src/data/convert'
import { statesConditionMet } from '../src/data/criteria'
import { loadDataStore, NodeDataStore } from '../src/data/node'
import { cellToPoint, distance, pointToCell } from '../src/map/geometry'
import { KNOWN_SHAPES, parseZoneString, zoneCells, zoneEfficiency } from '../src/map/zones'

// Un seul store partagé (chargement paresseux) ; le test de performance utilise une instance neuve.
const data = loadDataStore()

describe('chargement', () => {
  it('lève une erreur explicite si le dossier de données est absent', () => {
    expect(() => loadDataStore('/chemin/inexistant')).toThrow(/introuvables/)
  })

  it('donne accès aux fichiers bruts typés (analysés une seule fois)', () => {
    const manifest = data.rawFile('manifest.json')
    expect(manifest.counts.classSpells).toBe(836)
    expect(data.rawFile('manifest.json')).toBe(manifest)
    expect(() => data.rawFile('nope.json' as never)).toThrow(/manquant/)
  })

  it('énumère les ids de chaque catégorie', () => {
    expect(data.ids('breed')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20])
    expect(data.ids('item')).toHaveLength(3826)
    expect(data.ids('itemSet')).toHaveLength(521)
    expect(data.ids('monster')).toHaveLength(5135)
    expect(data.ids('state')).toHaveLength(6375)
    expect(data.ids('spell').length).toBeGreaterThan(6700)
    expect(data.ids('map')).toContain(143393281)
    expect(data.ids('map')).not.toContain(Number.NaN)
  })

  it('le mode eager pré-indexe sans erreur', () => {
    const eager = loadDataStore('data', { eager: true })
    expect(eager).toBeInstanceOf(NodeDataStore)
    expect(eager.spell(13115)?.name).toBe('Couperet')
  })
})

describe('classes et sorts', () => {
  it('Iop : 22 paires, 44 sorts de classe', () => {
    const iop = data.breed(8)!
    expect(iop.name).toBe('Iop')
    expect(iop.spellPairs).toHaveLength(22)
    const ids = iop.spellPairs.flat()
    expect(new Set(ids).size).toBe(44)
    for (const id of ids) {
      const s = data.spell(id)!
      expect(s.breedId).toBe(8)
      expect(s.levels.length).toBeGreaterThan(0)
    }
    expect(iop.spellPairs[0]).toEqual([13106, 13139]) // Pression / Fracture
    expect(data.spell(13106)).toMatchObject({ pairIndex: 0, variant: 0 })
    expect(data.spell(13139)).toMatchObject({ pairIndex: 0, variant: 1 })
    expect(iop.roles).toEqual(['Dégâts', 'Amélioration', 'Placement'])
    expect(iop.roleScores?.['Dégâts']).toBe(12)
    expect(iop.statPointCosts?.strength).toEqual([[0, 1], [100, 2], [200, 3], [300, 4]])
    expect(iop.statPointCosts?.wisdom).toEqual([[0, 3]])
  })

  it('19 classes et 836 sorts de classe', () => {
    expect(data.listBreeds()).toHaveLength(19)
    expect(data.listBreeds()).toBe(data.listBreeds())
    let classSpells = 0
    for (const id of data.ids('spell')) if (data.spell(id)!.breedId !== undefined) classSpells++
    expect(classSpells).toBe(836)
    for (const b of data.listBreeds()) expect(b.spellPairs).toHaveLength(22)
  })

  it('spellLevel : grade le plus élevé utilisable au niveau du joueur', () => {
    // Couperet : grades 1 (niv. 1), 2 (niv. 68), 3 (niv. 134)
    expect(data.spellLevel(13115, { playerLevel: 200 })?.grade).toBe(3)
    expect(data.spellLevel(13115, { playerLevel: 134 })?.grade).toBe(3)
    expect(data.spellLevel(13115, { playerLevel: 133 })?.grade).toBe(2)
    expect(data.spellLevel(13115, { playerLevel: 68 })?.grade).toBe(2)
    expect(data.spellLevel(13115, { playerLevel: 67 })?.grade).toBe(1)
    expect(data.spellLevel(13115, { playerLevel: 0 })).toBeUndefined()
    // grade précis, borné par les grades existants
    expect(data.spellLevel(13115, { grade: 2 })?.grade).toBe(2)
    expect(data.spellLevel(13115, { grade: 9 })?.grade).toBe(3)
    expect(data.spellLevel(13115, { grade: 0 })).toBeUndefined()
    expect(data.spellLevel(13115, {})?.grade).toBe(3)
    expect(data.spellLevel(13115, { grade: 3, playerLevel: 100 })?.grade).toBe(2)
    expect(data.spellLevel(-1, { playerLevel: 200 })).toBeUndefined()
    // Au niveau 200 : pour chaque sort Iop, le grade renvoyé est le plus haut grade débloqué
    for (const id of data.breed(8)!.spellPairs.flat()) {
      const s = data.spell(id)!
      const lvl = data.spellLevel(id, { playerLevel: 200 })!
      const expected = s.levels.filter(l => l.minPlayerLevel <= 200).at(-1)!
      expect(lvl).toBe(expected)
      expect(lvl.grade).toBe(s.levels.at(-1)!.grade)
    }
  })

  it('Couperet (13115) grade 3 : dommages Feu 28-32 en ligne L3 dégressive, -3 PM 1 tour', () => {
    const s = data.spell(13115)!
    expect(s).toMatchObject({ name: 'Couperet', nameEn: 'Chopper', typeId: 8, iconId: 11855, breedId: 8 })
    expect(s.levels.map(l => l.grade)).toEqual([1, 2, 3])
    const l = data.spellLevel(13115, { grade: 3 })!
    expect(l).toMatchObject({
      spellId: 13115,
      grade: 3,
      levelId: 78999,
      apCost: 3,
      minRange: 1,
      range: 6,
      rangeBoostable: true,
      castInLine: true,
      castInDiagonal: false,
      castTestLos: true,
      critChance: 10,
      maxCastPerTurn: 2,
      minPlayerLevel: 134,
      statesCriterion: '',
    })
    expect(l.statesCondition).toBeUndefined()
    const [dmg, mp] = l.effects
    expect(dmg).toMatchObject({ effectId: 99, element: 2, diceNum: 28, diceSide: 32, targetMask: 'a,A', triggers: 'I', dispellable: 1 })
    expect(dmg.zone).toMatchObject({ shape: 'L', size: 3, minSize: 0, decreaseStepPct: 10, maxDecreaseCount: 4, stopAtTarget: false })
    expect(mp).toMatchObject({ effectId: 1080, diceNum: 3, duration: 1, element: -1, dispellable: 3 })
    expect(mp.zone).toBe(dmg.zone) // zone internée
    expect(l.criticalEffects.map(e => [e.effectId, e.diceNum, e.diceSide])).toEqual([
      [99, 34, 38],
      [1080, 3, 0],
    ])
  })

  it('breedSpells : déblocage selon spellPairUnlockLevels (exception Crâ incluse) et choix de variantes', () => {
    for (const b of data.listBreeds()) {
      b.spellPairs.forEach((pair, i) => {
        for (const v of [0, 1] as const) {
          const unlock = b.spellPairUnlockLevels![i][v]
          expect(data.spellLevel(pair[v], { playerLevel: unlock })).toBeDefined()
          if (unlock > 1) expect(data.spellLevel(pair[v], { playerLevel: unlock - 1 })).toBeUndefined()
        }
      })
    }
    // Crâ : variantes 1 des paires 2 et 3 inversées (110 puis 105)
    expect(data.breed(9)!.spellPairUnlockLevels!.slice(2, 4)).toEqual([[1, 110], [1, 105]])
    expect(data.breedSpells(8, 200)).toHaveLength(44)
    expect(data.breedSpells(8, 1)).toHaveLength(4)
    expect(data.breedSpells(8, 100).length).toBe(22 + 2) // 22 variantes 0 + variantes 1 des paires 0 et 1
    const lvl1 = data.breedSpells(8, 1)
    expect(lvl1.map(s => s.spellId)).toEqual([13106, 14676, 13115, 13110])
    expect(lvl1.every(s => s.variant === 0 && s.level.grade === 1)).toBe(true)
    const choice = data.breedSpells(8, 200, [1, 0, 1])
    expect(choice).toHaveLength(3 + 19 * 2) // paires 0..2 imposées (une variante), 19 paires libres (deux variantes)
    expect(choice.filter(s => s.pairIndex === 0).map(s => s.spellId)).toEqual([13139])
    expect(choice.filter(s => s.pairIndex === 1).map(s => s.spellId)).toEqual([14676])
    expect(choice.filter(s => s.pairIndex === 3).map(s => s.spellId)).toEqual([13110, 13117])
    expect(data.breedSpells(8, 200, Array(22).fill(1)).every(s => s.variant === 1)).toBe(true)
    expect(data.breedSpells(19, 200)).toEqual([])
  })

  it('spellLevelById : niveaux de départ et portail Eliotrope (1181)', () => {
    expect(data.spellLevelById(22886)).toMatchObject({ spellId: 5006, grade: 1, levelId: 22886 })
    expect(data.spellLevelById(83735)).toMatchObject({ spellId: 5006, grade: 4 })
    expect(data.spellLevelById(44338)?.spellId).toBe(14573)
    expect(data.spellLevelById(78999)).toBe(data.spellLevel(13115, { grade: 3 }))
    expect(data.spellLevelById(1)).toBeUndefined()
  })

  it('toutes les conditions d’états des données sont compilées (Vortex : Marginal 236)', () => {
    let count = 0
    for (const id of data.ids('spell'))
      for (const l of data.spell(id)!.levels) {
        if (!l.statesCriterion) continue
        count++
        expect(l.statesCondition, `${id}:${l.grade} ${l.statesCriterion}`).toBeDefined()
        expect(l.statesCriterion).not.toMatch(/HS/)
      }
    expect(count).toBeGreaterThan(1000)
    const heuristique = data.spellLevel(5068, { grade: 1 })!
    const contamination = data.spellLevel(5064, { grade: 1 })!
    expect(heuristique.statesCriterion).toBe('e236')
    expect(statesConditionMet(heuristique.statesCondition, [236])).toBe(false)
    expect(statesConditionMet(contamination.statesCondition, [236])).toBe(true)
  })

  it('effets : défauts réhydratés, déclencheurs, zones spéciales', () => {
    // Petit poison (Harpille) : 50 Eau au début de tour pendant 3 tours, sur toute la carte
    const poison = data.spellLevel(5021, { grade: 1 })!.effects.find(e => e.effectId === 96)!
    expect(poison.triggers).toBe('TB')
    expect(poison.triggerDuration).toBe(3)
    expect(poison.element).toBe(3)
    expect(poison.zone.shape).toBe('a')
    // Pression : érosion 776 puis dommages Terre, zone point avec includeCarried
    const pression = data.spellLevel(13106, { grade: 1 })!
    expect(pression.effects.map(e => e.effectId)).toEqual([776, 97])
    expect(pression.effects[1].zone).toBe(parseZone('P1,0,10,4', 'c'))
    expect(pression.effects[1].zone.includeCarried).toBe(true)
    // Les effets sont triés par order dans tous les sorts
    for (const id of data.ids('spell').slice(0, 2000))
      for (const l of data.spell(id)!.levels)
        for (const list of [l.effects, l.criticalEffects])
          for (let i = 1; i < list.length; i++) expect(list[i].order).toBeGreaterThanOrEqual(list[i - 1].order)
  })

  it('zones : compatibles avec src/map/zones (formes connues, même lecture que parseZoneString)', () => {
    const seen = new Set<string>()
    for (const id of data.ids('spell'))
      for (const l of data.spell(id)!.levels)
        for (const e of [...l.effects, ...l.criticalEffects]) {
          expect(KNOWN_SHAPES, `forme « ${e.zone.shape} » (sort ${id})`).toContain(e.zone.shape)
          seen.add(e.zone.shape)
        }
    expect(seen.size).toBeGreaterThan(20)
    // Chaque effet de chaque fichier : même lecture que src/map/zones parseZoneString (parseur dupliqué)
    let compared = 0
    const mismatches: string[] = []
    for (const file of ['class-spells.json', 'monster-spells.json', 'item-spells.json'] as const) {
      const raw = data.rawFile(file)
      const lists = 'linkedSpells' in raw ? [raw.spells, raw.linkedSpells] : [raw.spells]
      for (const list of lists)
        for (const s of list) {
          const conv = data.spell(s.id)!
          for (const rl of s.levels) {
            const l = conv.levels.find(x => x.levelId === rl.id)!
            const pairs: [typeof rl.effects, typeof l.effects][] = [
              [rl.effects, l.effects],
              [rl.criticalEffect, l.criticalEffects],
            ]
            for (const [rawList, list] of pairs)
              rawList.forEach((re, i) => {
                // effets triés par order (déjà triés dans les données : même index)
                const e = list[i]
                const z = e.zone
                const ref = parseZoneString(re.zone ?? '', re.zoneFlags, re.zoneCells)
                const same =
                  e.uid === re.effectUid &&
                  z.shape === ref.shape &&
                  z.size === ref.size &&
                  z.minSize === ref.minSize &&
                  z.decreaseStepPct === ref.decreaseStepPct &&
                  z.maxDecreaseCount === ref.maxDecreaseCount &&
                  z.stopAtTarget === ref.stopAtTarget &&
                  !!z.includeCarried === !!ref.includeCarried &&
                  !!z.onlyIfInSight === !!ref.onlyIfInSight &&
                  !!z.forcedDirection === !!ref.forcedDirection &&
                  (z.cells ?? []).join() === (ref.cells ?? []).join()
                if (!same) mismatches.push(`${s.id}:${rl.grade} ${re.zone}|${re.zoneFlags ?? ''}`)
                compared++
              })
          }
        }
    }
    expect(compared).toBeGreaterThan(50_000)
    expect(mismatches.slice(0, 10)).toEqual([])
    const z = data.spellLevel(13115, { grade: 3 })!.effects[0].zone
    const ref = parseZoneString('L3,0,10,4')
    for (const k of ['shape', 'size', 'minSize', 'decreaseStepPct', 'maxDecreaseCount', 'stopAtTarget'] as const) expect(z[k]).toBe(ref[k])
    // Couperet lancé en ligne : case d'impact + 3 cases derrière, dégressif de 10 % par case
    const p = cellToPoint(300)
    const caster = 300
    const center = pointToCell(p.x + 2, p.y) // deux cases plus loin sur un axe de la grille
    const cells = zoneCells(z, center, caster)
    expect(cells).toHaveLength(4)
    expect(cells.map(c => distance(center, c)).sort()).toEqual([0, 1, 2, 3])
    expect(zoneEfficiency(z, center, cells.find(c => distance(center, c) === 1)!, caster)).toBeCloseTo(0.9)
  })

  it('sorts d’objets et sorts de monstres fusionnés', () => {
    expect(data.spell(8395)).toBeDefined() // Dofus Pourpre
    expect(data.spell(5006)?.name).toBe('Vortexiphan')
    expect(data.spell(4999)?.name).toBe('Heure du temps')
    expect(data.spell(-1)).toBeUndefined()
    expect(data.spell(13115)).toBe(data.spell(13115)) // cache
  })

  it('états', () => {
    expect(data.state(56)).toMatchObject({ name: 'Invulnérable', invulnerable: true, cantBeMoved: false })
    expect(data.state(97)?.cantBeMoved).toBe(true)
    expect(data.state(236)).toMatchObject({ name: 'Marginal', isSilent: true })
    expect(data.state(999999)).toBeUndefined()
  })
})

describe('monstres', () => {
  it('Vortex (3835) : grades, caractéristiques, résistances, sort de départ', () => {
    const v = data.monster(3835)!
    expect(v).toMatchObject({ name: 'Vortex', isBoss: true, raceId: 132, spells: [5068, 5070, 5062, 5066, 5064] })
    expect(v.grades.map(g => g.grade)).toEqual([1, 2, 3, 4, 5, 6])
    expect(v.grades.map(g => g.lifePoints)).toEqual([15000, 17000, 18000, 20000, 22000, 22000])
    for (const g of v.grades) {
      expect(g).toMatchObject({ level: 220, ap: 16, mp: 5 })
      expect(g.stats).toMatchObject({
        ap: 16,
        mp: 5,
        strength: 800,
        intelligence: 800,
        chance: 800,
        agility: 800,
        wisdom: 800,
        neutralResPct: 6,
        earthResPct: 33,
        fireResPct: 12,
        waterResPct: 21,
        airResPct: 28,
        mpParry: 20,
      })
      expect(g.stats.apParry).toBeUndefined()
    }
    expect(v.grades[0].startingSpellLevelId).toBe(22886)
    expect(v.grades[0].startingSpell).toEqual({ spellId: 5006, grade: 1 })
    expect(v.grades[5].startingSpell).toEqual({ spellId: 5006, grade: 4 })
    expect(data.monster(3835)).toBe(v) // cache
  })

  it('monsterSpells : niveaux de sort par grade via spellGrades', () => {
    const lvls = data.monsterSpells(3835, 1)
    expect(lvls.map(l => l.spellId)).toEqual([5068, 5070, 5062, 5066, 5064])
    expect(lvls.every(l => l.grade === 1)).toBe(true)
    expect(data.monsterSpells(3835, 7)).toEqual([])
    expect(data.monsterSpells(-5, 1)).toEqual([])
    // Monstres de vague : Ikargn (3834) — stats +50 et résistances +1 par grade
    const ik = data.monster(3834)!
    expect(ik.grades[0]).toMatchObject({ level: 200, lifePoints: 6000, ap: 12, mp: 5 })
    expect(ik.grades[4]).toMatchObject({ level: 212, lifePoints: 6600 })
    expect(ik.grades[4].stats).toMatchObject({ strength: 850, neutralResPct: 7, earthResPct: 12, fireResPct: -10, waterResPct: 28, airResPct: 43 })
    expect(ik.grades[0].startingSpell).toEqual({ spellId: 5002, grade: 1 })
    expect(data.monsterSpells(3834, 5).map(l => l.spellId)).toEqual([5015, 5016, 5017])
    // Auroraire (3833) : sort de départ 4999
    expect(data.monster(3833)!.grades[5].startingSpell).toEqual({ spellId: 4999, grade: 2 })
  })

  it('spellGrades = 0 exclut le sort ; grade de sort absent borné au grade existant', () => {
    let checked = 0
    for (const id of data.ids('monster').slice(0, 1500)) {
      const m = data.monster(id)!
      expect(m.spellGrades).toHaveLength(m.spells.length)
      expect(m.spells.every(s => s > 0)).toBe(true)
      for (const g of m.grades) {
        const expected = m.spells.filter((s, i) => (m.spellGrades![i][g.grade - 1] ?? 0) > 0 && data.spell(s))
        expect(data.monsterSpells(id, g.grade).map(l => l.spellId)).toEqual(expected)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(5000)
  })

  it('bonusCharacteristics : toutes les clés observées sont prises en charge (invocations)', () => {
    for (const m of data.rawFile('monsters.json'))
      for (const g of m.grades)
        for (const k of Object.keys(g.bonusCharacteristics ?? {})) expect(k === 'lifePoints' || k in MONSTER_BONUS_STATS, k).toBe(true)
  })

  it('bonusCharacteristics = part (%) des caractéristiques de l’invocateur, jamais ajoutée au grade', () => {
    // Explobombe (Roublard) : 90 % des PV, 100 % des caractéristiques et dommages élémentaires de l'invocateur
    const bomb = data.monster(3112)!.grades[0]
    expect(bomb.lifePoints).toBe(0)
    expect(bomb.stats.strength).toBeUndefined()
    expect(bomb.stats.earthDamage).toBeUndefined()
    expect(bomb.summonerShare).toEqual({
      lifePct: 90,
      stats: { strength: 100, wisdom: 100, chance: 100, agility: 100, intelligence: 100, earthDamage: 100, fireDamage: 100, waterDamage: 100, airDamage: 100 },
    })
    // Harponneuse (tourelle Steamer) : 180 % des PV et 100 % du tacle
    expect(data.monster(5836)!.grades[0].summonerShare).toMatchObject({ lifePct: 180, stats: { tackleBlock: 100 } })
    // Arbre (Sadida) : 60 % des PV aux grades 1-3, 30 % aux grades 4-6
    expect(data.monster(5894)!.grades.map(g => g.summonerShare?.lifePct)).toEqual([60, 60, 60, 30, 30, 30])
    // Arakne : PV de base 0, 30 % des PV de l'invocateur
    expect(data.monster(246)!.grades[0]).toMatchObject({ lifePoints: 0, summonerShare: { lifePct: 30, stats: {} } })
    // Monstre sans bonus (Vortex) : pas de summonerShare
    expect(data.monster(3835)!.grades.every(g => g.summonerShare === undefined)).toBe(true)
    // Sur toutes les données : PV et caractéristiques du grade = valeurs brutes propres du grade
    let withShare = 0
    for (const raw of data.rawFile('monsters.json')) {
      const m = data.monster(raw.id)!
      raw.grades.forEach(rg => {
        const g = m.grades.find(x => x.grade === rg.grade)!
        expect(g.lifePoints).toBe(rg.lifePoints)
        expect(g.stats.strength ?? 0).toBe(rg.strength ?? 0)
        expect(g.stats.neutralResPct ?? 0).toBe(rg.neutralResistance ?? 0)
        expect(g.stats.tackleBlock).toBeUndefined() // n'existe que dans bonusCharacteristics
        if (g.summonerShare) withShare++
      })
    }
    expect(withShare).toBeGreaterThan(400)
  })

  it('characRatios / scaleGradeRef conservés (Ikargn)', () => {
    const ik = data.monster(3834)!
    expect(ik.scaleGradeRef).toBe(6)
    expect(ik.characRatios?.[0]).toEqual([0, 1.1])
    expect(ik.characRatios?.find(([c]) => c === 23)).toEqual([23, 1])
  })

  it('tables startingSpellLevels des fichiers de sorts = spellLevelById ; sorts de départ des grades résolus', () => {
    const tables = [data.rawFile('class-spells.json').startingSpellLevels, data.rawFile('monster-spells.json').startingSpellLevels]
    let n = 0
    for (const t of tables)
      for (const [levelId, spellId] of Object.entries(t)) {
        const lvl = data.spellLevelById(Number(levelId))
        expect(lvl?.spellId, `niveau ${levelId}`).toBe(spellId)
        expect(lvl?.levelId).toBe(Number(levelId))
        n++
      }
    expect(n).toBeGreaterThan(400)
    // tout sort de départ résolu pointe vers un grade existant du bon sort
    for (const id of [3833, 3834, 3835, 3836, 3837, 3838, 3839, 3112, 5894])
      for (const g of data.monster(id)!.grades)
        if (g.startingSpell) expect(data.spellLevelById(g.startingSpellLevelId!)).toBe(data.spellLevel(g.startingSpell.spellId, { grade: g.startingSpell.grade }))
  })
})

describe('cartes', () => {
  it('salle du Vortex (143393281) : 560 cases, 222 marchables, 12 rouges, 10 bleues', () => {
    const m = data.map(143393281)!
    expect(m.name).toBe('Œil de Vortex - Salle des heures perdues')
    expect(m.approximate).toBe(false)
    expect(m.cells).toHaveLength(560)
    m.cells.forEach((c, i) => expect(c.id).toBe(i))
    expect(m.cells.filter(c => c.walkable)).toHaveLength(222)
    expect(m.cells.filter(c => !c.los)).toHaveLength(76)
    expect(m.cells.filter(c => c.placement === 1)).toHaveLength(12)
    expect(m.cells.filter(c => c.placement === 2)).toHaveLength(10)
    expect(m.redCells).toEqual([424, 427, 430, 438, 440, 441, 443, 453, 455, 457, 482, 484])
    expect(m.blueCells).toEqual([268, 269, 270, 271, 272, 273, 274, 275, 276, 277])
    expect(m.dungeonIds).toEqual([87])
    expect((m.annotations?.clockPositions as Record<string, number>)['12']).toBe(255)
    expect(data.map(143393281)).toBe(m) // cache
  })

  it('carte inconnue ou id invalide : undefined', () => {
    expect(data.map(1)).toBeUndefined()
    expect(data.map(-1)).toBeUndefined()
    expect(data.map(1.5)).toBeUndefined()
  })
})

describe('objets et panoplies', () => {
  it('emplacements de tous les équipements', () => {
    const counts: Record<string, number> = {}
    for (const id of data.ids('item')) {
      const slot = data.item(id)!.slot
      counts[slot] = (counts[slot] ?? 0) + 1
    }
    expect(counts).toEqual({
      weapon: 769,
      amulet: 334,
      ring: 391,
      belt: 362,
      boots: 373,
      hat: 382,
      cloak: 311,
      shield: 129,
      dofus: 34 + 261 + 25,
      pet: 122 + 25 + 308,
    })
    // cohérent avec l'emplacement brut écrit par le script
    const map: Record<string, string> = { trophy: 'dofus', prysmaradite: 'dofus', petsmount: 'pet', mount: 'pet' }
    for (const raw of data.rawFile('equipment.json')) expect(data.item(raw.id)!.slot).toBe(map[raw.slot!] ?? raw.slot)
  })

  it('armes : profil et zone', () => {
    const staff = data.item(140)!
    expect(staff).toMatchObject({ name: 'Bâton de Boisaille', slot: 'weapon', typeName: 'Bâton' })
    expect(staff.weapon).toMatchObject({ apCost: 4, range: 2, critChance: 30, critBonus: 7 })
    expect(staff.weaponZone).toMatchObject({ shape: 'T', size: 1, decreaseStepPct: 10, maxDecreaseCount: 1 })
    let weapons = 0
    for (const it of data.itemsBySlot('weapon')) {
      expect(it.weapon).toBeDefined()
      expect(it.weaponZone).toBeDefined()
      weapons++
    }
    expect(weapons).toBe(769)
    expect(data.itemsBySlot('weapon').filter(w => w.typeId === 271).every(w => w.weaponZone!.shape === 'L')).toBe(true)
  })

  it('effets d’objets : jets, valeurs fixes, sorts passifs', () => {
    const amu = data.item(14080)! // Amulette Séculaire
    expect(amu).toMatchObject({ slot: 'amulet', level: 200, setId: 271 })
    expect(amu.effects.find(e => e.effectId === 125)).toEqual({ effectId: 125, min: 251, max: 300 })
    expect(amu.effects.find(e => e.effectId === 111)).toEqual({ effectId: 111, min: 1, max: 1 })
    expect(data.item(694)!.effects.find(e => e.effectId === 1175)).toEqual({ effectId: 1175, min: 8395, max: 1 })
    expect(data.item(19482)!.effects.find(e => e.effectId === 722)).toEqual({ effectId: 722, min: 0, max: 1, value: 2056 })
  })

  it('itemsBySlot : tri par niveau et filtre de niveaux', () => {
    const all = data.itemsBySlot('amulet')
    expect(all).toHaveLength(334)
    for (let i = 1; i < all.length; i++) expect(all[i].level).toBeGreaterThanOrEqual(all[i - 1].level)
    const thl = data.itemsBySlot('amulet', { minLevel: 190, maxLevel: 200 })
    expect(thl).toHaveLength(all.filter(a => a.level >= 190 && a.level <= 200).length)
    expect(thl.every(a => a.level >= 190 && a.level <= 200)).toBe(true)
    expect(data.itemsBySlot('amulet', { maxLevel: 0 })).toEqual([])
    expect(data.itemsBySlot('ring', { minLevel: 200 }).every(r => r.level === 200)).toBe(true)
    expect(data.itemsBySlot('other')).toEqual([])
    expect(data.itemsBySlot('amulet')).toBe(all)
  })

  it('panoplie Tue-Mouche (107) : paliers de bonus totaux', () => {
    const set = data.itemSet(107)!
    expect(set).toMatchObject({ name: 'Panoplie Tue-Mouche', level: 192, items: [9133, 9142, 9143, 9463] })
    expect(Object.keys(set.bonuses)).toEqual(['2', '3', '4'])
    const sum = (n: number, effectId: number) => set.bonuses[n].find(e => e.effectId === effectId)?.min
    expect(sum(2, 126)).toBe(40) // Intelligence
    expect(sum(2, 111)).toBeUndefined() // pas de PA à 2 objets
    expect(sum(3, 111)).toBe(1)
    expect(sum(4, 182)).toBe(2) // Invocations
    expect(sum(4, 126)).toBe(50)
    // les objets de la panoplie y renvoient
    for (const id of set.items) expect(data.item(id)?.setId).toBe(107)
    // Panoplie du Vampyre maudit : sorts donnés par les bonus (722, value = sort)
    const vamp = data.itemSet(466)!
    expect(vamp.bonuses[1].find(e => e.effectId === 722)).toMatchObject({ value: 8166 })
    expect(vamp.bonuses[6].find(e => e.effectId === 722)).toMatchObject({ value: 10913 })
  })
})

describe('performances', () => {
  it('loadDataStore + 1000 recherches aléatoires < 2 s', () => {
    const t0 = performance.now()
    const store = loadDataStore()
    const ids = {
      spell: store.ids('spell'),
      monster: store.ids('monster'),
      item: store.ids('item'),
      state: store.ids('state'),
      map: store.ids('map'),
    }
    const rng = new Rng(42)
    const pick = (list: number[]) => list[rng.int(0, list.length - 1)]
    let found = 0
    for (let i = 0; i < 1000; i++) {
      switch (i % 6) {
        case 0:
          found += store.spell(pick(ids.spell)) ? 1 : 0
          break
        case 1:
          found += store.spellLevel(pick(ids.spell), { playerLevel: rng.int(1, 200) }) ? 1 : 0
          break
        case 2:
          found += store.monster(pick(ids.monster)) ? 1 : 0
          break
        case 3:
          found += store.item(pick(ids.item)) ? 1 : 0
          break
        case 4:
          found += store.state(pick(ids.state)) ? 1 : 0
          break
        case 5:
          found += store.map(pick(ids.map)) ? 1 : 0
          break
      }
    }
    const elapsed = performance.now() - t0
    expect(found).toBeGreaterThan(900)
    expect(elapsed).toBeLessThan(2000)
  })

  it('spellLevel en boucle chaude (données en cache) : ≥ 1 M appels/s', () => {
    const ids = data.breed(8)!.spellPairs.flat()
    for (const id of ids) data.spell(id)
    const sel = { playerLevel: 200 }
    const t0 = performance.now()
    let n = 0
    for (let i = 0; i < 1_000_000; i++) if (data.spellLevel(ids[i % ids.length], sel)) n++
    const elapsed = performance.now() - t0
    expect(n).toBe(1_000_000)
    expect(elapsed).toBeLessThan(1000)
  })
})
