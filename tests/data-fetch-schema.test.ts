/**
 * Extraction DofusDB : lecture des schémas de grades 3.6 et 3.7 (scripts/lib/dofusdb-normalize.mjs), garde-fou des
 * résistances des boss et conversion des champs apparus en 3.7 (src/data/convert.ts).
 *
 * Fixtures : tests/fixtures/dofusdb-3.7/monster-<id>.json = extraits réduits de réponses DofusDB du 2026-10-08 (après
 * la mise à jour 3.7) : GET /monsters/<id> pour 3835, 1045, 3534 (boss) ; GET /monsters?id[$in][]=53&id[$in][]=3112
 * pour le Bwork Mage (esquive PA 3.6 non nulle, Sagesse non multiple de 100) et l'Explobombe (parts de l'invocateur).
 * L'extrait 3.6 (tests/fixtures/dofusdb-3.6/monsters-extract.json) vient de data/dofusdb/monsters.json (extraction du
 * 2026-10-04) : il n'existe plus de réponse brute 3.6 (cache non versionné), ses grades normalisés en tiennent lieu. Il
 * est figé pour que les comparaisons 3.6 / 3.7 survivent à une ré-extraction 3.7 de data/dofusdb. Le script complet
 * (branchement du module, écriture tout ou rien) est testé par tests/data-fetch-script.test.ts. Contexte :
 * docs/research/dofusdb-api.md §10.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  OPTIONAL_GRADE_FIELDS,
  RESISTANCE_FIELDS,
  SENTINEL_BOSS_IDS,
  apiGradeSchema,
  assertBossResistances,
  bossResistanceProblems,
  gameVersionInfo,
  normBonusCharacteristics,
  normGrade,
  summarizeGradeSchemas,
  unknownGradeKeys,
  type ApiMonsterGrade,
} from '../scripts/lib/dofusdb-normalize.mjs'
import { MONSTER_BONUS_STATS, convertMonsterGrade, convertSummonerShare } from '../src/data/convert'
import { loadDataStore } from '../src/data/node'
import type { RawMonsterGrade } from '../src/data/raw'

const data = loadDataStore()

interface Fixture37 {
  id: number
  name: { fr: string; en: string }
  isBoss: boolean
  grades: (ApiMonsterGrade & { grade: number; wisdom: number; paLostDodge: number; mpLostDodge: number })[]
}
const fixture = (id: number): Fixture37 =>
  JSON.parse(readFileSync(new URL(`./fixtures/dofusdb-3.7/monster-${id}.json`, import.meta.url), 'utf8'))
const FIXTURES = [3835, 1045, 3534, 53, 3112].map(fixture)
const [VORTEX, KIMBO, , BWORK_MAGE, EXPLOBOMBE] = FIXTURES

/** Données actuelles (2026-10-04 : schéma 3.6, tant que manifest.json → game.version vaut « 3.6 »). */
const monsters = data.rawFile('monsters.json')
const LIVE_IS_36 = data.rawFile('manifest.json').game?.version === '3.6'
/** Référence 3.6 figée : grades de monsters.json aux grades des fixtures 3.7. */
const EXTRACT_36: { id: number; grades: RawMonsterGrade[] }[] = JSON.parse(
  readFileSync(new URL('./fixtures/dofusdb-3.6/monsters-extract.json', import.meta.url), 'utf8'),
).monsters
const grade36 = (id: number, grade: number): RawMonsterGrade => EXTRACT_36.find(m => m.id === id)!.grades.find(g => g.grade === grade)!

/** Champs 3.7 non nuls attendus par fixture, sous leur nom normalisé. */
const NEW_FIELDS: Record<number, Partial<RawMonsterGrade>> = {
  3835: { tackleBlock: 20, tackleEvade: 20, initiativeBonus: 15000, maxSummon: 1 },
  1045: { pushDamageReduction: 9999, maxSummon: 1 },
  3534: { tackleBlock: 30, tackleEvade: 30, initiativeBonus: 5000, maxSummon: 7 },
  53: { maxSummon: 1 },
  3112: {},
}
/** Parts de l'invocateur (bonusCharacteristics) apparues en 3.7, sous leur nom normalisé. */
const NEW_BONUS: Record<number, Record<string, number>> = {
  3112: { damageBonus: 100, percentDamageBonus: 100, bonusNeutralDamage: 100 },
}

describe('normalisation des grades DofusDB (schémas 3.6 et 3.7)', () => {
  it('3.7 (fixtures) : mêmes clés que monsters.json, mêmes valeurs sauf l’esquive PA, + champs 3.7 non nuls', () => {
    for (const f of FIXTURES) {
      for (const raw of f.grades) {
        expect(apiGradeSchema(raw)).toBe('3.7')
        expect(unknownGradeKeys(raw), `${f.id} g${raw.grade}`).toEqual([])
        const g = normGrade(raw) as unknown as Record<string, unknown>
        const old = grade36(f.id, raw.grade) as unknown as Record<string, unknown>
        // Toutes les clés historiques sont là (les 5 résistances surtout), avec les mêmes valeurs…
        for (const k of Object.keys(old)) {
          if (k === 'paDodge' || k === 'bonusCharacteristics') continue
          expect(g[k], `${f.id} g${raw.grade} ${k}`).toEqual(old[k])
        }
        // … sauf l'esquive PA, baissée par la 3.7 (0 → −24 / −21, 10 → 4 / 3) ; les champs en plus sont exactement les
        // champs 3.7, et les parts de l'invocateur celles de la 3.6 plus les parts apparues en 3.7.
        expect(g.paDodge).toBe(raw.paLostDodge)
        const extra = Object.fromEntries(Object.keys(g).filter(k => !(k in old)).map(k => [k, g[k]]))
        expect(extra, `${f.id} g${raw.grade}`).toEqual(NEW_FIELDS[f.id])
        expect(g.bonusCharacteristics, `${f.id} g${raw.grade}`).toEqual(
          old.bonusCharacteristics || NEW_BONUS[f.id] ? { ...(old.bonusCharacteristics as object), ...NEW_BONUS[f.id] } : undefined,
        )
      }
    }
    expect(normGrade(VORTEX.grades[1])).toMatchObject({ grade: 5, lifePoints: 22000, neutralResistance: 6, earthResistance: 33, fireResistance: 12, waterResistance: 21, airResistance: 28, paDodge: -24, pmDodge: 20, gradeXp: 3800000, bonusRange: 0 })
  })

  it('paLostDodge = même grandeur que paDodge (bonus ajouté à Sagesse/10) ; esquive PA finale 3.7 = ⌈0,7 × finale 3.6⌉', () => {
    // Esquive PA finale du moteur = ⌊Sagesse/10⌋ + bonus (engine/factory.ts). En entiers, ⌈0,7 × x⌉ = x − ⌊3x/10⌋
    // (pas de flottant : 0,7 × 80 vaut 56,000…01 en JS), soit paLostDodge = paDodge − ⌊0,3 × (paDodge + ⌊Sagesse/10⌋)⌋.
    const rows: [number, number, number, number][] = []
    for (const f of FIXTURES) {
      for (const raw of f.grades) {
        const old = grade36(f.id, raw.grade)
        const wis10 = Math.floor(raw.wisdom / 10)
        const final36 = wis10 + old.paDodge!
        const final37 = wis10 + raw.paLostDodge
        expect(final37, `${f.id} g${raw.grade}`).toBe(final36 - Math.floor((3 * final36) / 10))
        expect(raw.paLostDodge, `${f.id} g${raw.grade}`).toBe(old.paDodge! - Math.floor((3 * final36) / 10))
        expect(raw.mpLostDodge, `${f.id} g${raw.grade}`).toBe(old.pmDodge)
        rows.push([f.id, raw.grade, final36, final37])
      }
    }
    // Cas couverts : paDodge 3.6 nul (boss) et non nul (Bwork Mage : 10, Sagesse 112 / 126 / 140). Le grade 3 du Bwork
    // Mage (22 → 16) départage le plafond de l'arrondi (round(15,4) = 15) ; le grade 5 donne paLostDodge 3, pas 4.
    expect(rows).toEqual([
      [3835, 1, 80, 56], [3835, 5, 80, 56], [1045, 5, 80, 56], [3534, 5, 70, 49],
      [53, 1, 21, 15], [53, 3, 22, 16], [53, 5, 24, 17], [3112, 1, 0, 0],
    ])
  })

  it('extrait 3.6 figé = grades de data/dofusdb/monsters.json (tant que les données sont en 3.6)', () => {
    expect(EXTRACT_36.map(m => m.id)).toEqual(FIXTURES.map(f => f.id).sort((a, b) => a - b))
    for (const f of FIXTURES) expect(EXTRACT_36.find(m => m.id === f.id)!.grades.map(g => g.grade)).toEqual(f.grades.map(g => g.grade))
  })

  it.runIf(LIVE_IS_36)('… et cet extrait est identique aux données actuelles (3.6)', () => {
    for (const m of EXTRACT_36) for (const g of m.grades) expect(monsters.find(x => x.id === m.id)!.grades.find(x => x.grade === g.grade)).toEqual(g)
  })

  it('données actuelles (data/dofusdb/monsters.json) : renormaliser chaque grade le rend octet pour octet', () => {
    let n = 0
    for (const m of monsters) {
      for (const g of m.grades) {
        if (JSON.stringify(normGrade(g as unknown as ApiMonsterGrade)) !== JSON.stringify(g)) throw new Error(`grade modifié : ${m.id} g${g.grade}`)
        n++
      }
    }
    expect(n).toBeGreaterThan(20000)
  })

  it('3.6 brut (clés en plus, parts nulles, ordre quelconque) → grade de monsters.json', () => {
    const g = grade36(3835, 5)
    const raw = { bonusCharacteristics: { lifePoints: 0, strength: 0, tackleBlock: 0, aPRemoval: 0 }, monsterId: 3835, hiddenLevel: 0, ...g }
    expect(apiGradeSchema(raw)).toBe('3.6')
    expect(unknownGradeKeys(raw)).toEqual([])
    expect(JSON.stringify(normGrade(raw))).toBe(JSON.stringify(g))
  })

  it('les deux noms présents : le nom normalisé (3.6) l’emporte, grades comme parts de l’invocateur', () => {
    const g = normGrade({ grade: 1, level: 1, lifePoints: 1, actionPoints: 1, movementPoints: 1, paDodge: 3, paLostDodge: -7, reductionFire: 9, fireResistance: 4 })
    expect(g.paDodge).toBe(3)
    expect(g.fireResistance).toBe(4)
    expect(normBonusCharacteristics({ reductionFire: 50, fireResistance: 100 })).toEqual({ fireResistance: 100 })
  })

  it('bonusCharacteristics 3.7 : clés renommées comme en 3.6, valeurs nulles et points d’honneur retirés', () => {
    expect(normBonusCharacteristics(VORTEX.grades[0].bonusCharacteristics)).toBeUndefined()
    expect(
      normBonusCharacteristics({ lifePoints: 90, reductionEarth: 100, earthDamageBonus: 100, tackleBonus: 50, tackleEvade: 50, rangeBonus: 1, paLostDodge: 0, reductionAirFlat: 100, honoursPoints: 5 }),
    ).toEqual({ lifePoints: 90, earthResistance: 100, bonusEarthDamage: 100, tackleBlock: 50, tackleEvade: 50, bonusRange: 1, airResistanceFlat: 100 })
  })

  it('un renommage inconnu est signalé (clés inconnues, schéma « inconnu »)', () => {
    const renamed: ApiMonsterGrade = { grade: 1, level: 1, resistNeutral: 5, resistEarth: 5, bonusCharacteristics: { strength: 0, mysteryBonus: 0 } }
    expect(apiGradeSchema(renamed)).toBe('inconnu')
    expect(unknownGradeKeys(renamed)).toEqual(['resistNeutral', 'resistEarth', 'bonusCharacteristics.mysteryBonus'])
    expect(summarizeGradeSchemas([{ grades: VORTEX.grades }, { grades: [renamed] }])).toEqual({
      gradeSchemas: { '3.7': 2, inconnu: 1 },
      unknownKeys: { resistNeutral: 1, resistEarth: 1, 'bonusCharacteristics.mysteryBonus': 1 },
    })
  })
})

describe('garde-fou de fin d’extraction et version du jeu', () => {
  const boss = (grades: object[], isBoss = true) => ({ id: 3835, name: { fr: 'Vortex', en: 'Vortex' }, isBoss, grades })
  const normalized = FIXTURES.map(f => ({ ...f, grades: f.grades.map(normGrade) }))

  it('données actuelles et fixtures 3.7 normalisées : chaque grade de boss a ses 5 résistances', () => {
    expect(bossResistanceProblems(monsters)).toEqual([])
    expect(monsters.filter(m => m.isBoss).length).toBeGreaterThan(200)
    expect(SENTINEL_BOSS_IDS).toEqual([3835])
    expect(() => assertBossResistances(normalized)).not.toThrow()
  })

  it('échec explicite, en français, si un boss perd ses résistances (champs renommés une nouvelle fois)', () => {
    // Ce que produisait l'ancienne normalisation sur le schéma 3.7 : grade sans aucune clé de résistance.
    const lost = normGrade({ grade: 1, level: 220, lifePoints: 15000, actionPoints: 16, movementPoints: 5, resistNeutral: 6, resistEarth: 33 })
    expect(RESISTANCE_FIELDS.some(k => k in lost)).toBe(false)
    expect(() => assertBossResistances([boss([lost])])).toThrow(/Extraction DofusDB refusée : 1 problème\(s\) sur les boss \(grades sans leurs 5 résistances en %/)
    expect(() => assertBossResistances([boss([lost])])).toThrow(/Vortex \(3835\), grade 1 : neutralResistance, earthResistance, fireResistance, waterResistance, airResistance manquante/)
    // Une seule résistance manquante suffit ; un non-boss n'est pas concerné ; un boss sans grade est signalé.
    const { airResistance: _air, ...partial } = normGrade(VORTEX.grades[0])
    expect(bossResistanceProblems([boss([partial])])).toEqual(['Vortex (3835), grade 1 : airResistance manquante(s)'])
    expect(() => assertBossResistances([...normalized, { id: 53, name: { fr: 'Bwork Mage' }, isBoss: false, grades: [lost] }])).not.toThrow()
    expect(bossResistanceProblems([boss([])])).toEqual(['Vortex (3835) : aucun grade'])
    // Liste tronquée au-delà de maxShown.
    expect(() => assertBossResistances([boss([lost, lost, lost])], { maxShown: 2 })).toThrow(/… et 1 autre\(s\)/)
  })

  it('échec si le champ isBoss disparaît ou si le boss témoin (Vortex) manque : le contrôle ne passe pas à vide', () => {
    // isBoss renommé (ex. « boss ») : plus aucun boss à contrôler, ce qui ne doit pas passer pour un succès.
    const renamed = normalized.map(({ isBoss, ...m }) => ({ ...m, boss: isBoss }))
    expect(bossResistanceProblems(renamed)).toEqual([
      'aucun monstre isBoss parmi 5 (champ isBoss renommé ?)',
      'Vortex (3835) : boss témoin plus marqué isBoss (champ renommé ?)',
    ])
    expect(() => assertBossResistances(renamed)).toThrow(/Extraction DofusDB refusée : 2 problème\(s\)[\s\S]*boss témoin plus marqué isBoss/)
    // Vortex absent (les autres boss sont sains) ; témoins désactivables pour un extrait partiel.
    const withoutVortex = normalized.filter(m => m.id !== 3835)
    expect(bossResistanceProblems(withoutVortex)).toEqual(["boss témoin 3835 absent de l'extraction"])
    expect(bossResistanceProblems(withoutVortex, { requiredBossIds: [] })).toEqual([])
    expect(bossResistanceProblems([], { requiredBossIds: [] })).toEqual(['aucun monstre isBoss parmi 0 (champ isBoss renommé ?)'])
  })

  it('version du jeu : option --game-version, sinon déduite du schéma des grades', () => {
    expect(gameVersionInfo({ '3.7': 26970 })).toMatchObject({ version: '3.7' })
    expect(gameVersionInfo({ '3.6': 26970 })).toMatchObject({ version: '3.6' })
    expect(gameVersionInfo({ '3.6': 1, '3.7': 2 }).version).toBe('inconnue')
    expect(gameVersionInfo({ '3.7': 1 }, '3.7.1')).toEqual({ version: '3.7.1', source: 'option --game-version' })
    expect(gameVersionInfo({ '3.7': 1 }, true).version).toBe('3.7') // « --game-version » sans valeur : ignorée
    expect(data.rawFile('manifest.json').game?.version).toMatch(/^3\.\d/)
  })
})

describe('conversion des champs 3.7 en caractéristiques (src/data/convert.ts)', () => {
  it('Vortex 3.7 : résistances % inchangées, esquive PA −24, tacle, fuite et initiative', () => {
    const g = convertMonsterGrade(normGrade(VORTEX.grades[1]))
    expect(g.stats).toEqual({
      ...convertMonsterGrade(grade36(3835, 5)).stats,
      apParry: -24,
      tackleBlock: 20,
      tackleEvade: 20,
      initiative: 15000,
    })
    expect(g.lifePoints).toBe(22000)
    expect(g.stats.summons).toBeUndefined() // maxSummon conservé dans le brut, non converti
  })

  it('Kimbo 3.7 : résistance poussée 9999 → pushRes', () => {
    const g = convertMonsterGrade(normGrade(KIMBO.grades[0]))
    expect(g.stats.pushRes).toBe(9999)
    expect(g.stats.neutralResPct).toBe(400)
  })

  it('résistances fixes, critique et bonus offensifs ; percentDamageBonus → Puissance ; maxSummon non converti', () => {
    const raw: ApiMonsterGrade = {
      ...VORTEX.grades[0],
      reductionNeutralFlat: 1, reductionEarthFlat: 2, reductionFireFlat: 3, reductionWaterFlat: 4, reductionAirFlat: 5,
      criticalDamageReduction: 6, pushDamageReduction: 7, damageBonus: 8, earthDamageBonus: 9, criticalHitBonus: 10,
      criticalDamageBonus: 11, pushDamageBonus: 12, healBonus: 13, trapDamageBonus: 14, trapDamageBonusPercent: 15,
      apAttack: 16, mpAttack: 17, percentDamageBonus: 18, maxSummon: 3, honoursPoints: 99,
    }
    const g = normGrade(raw)
    expect(Object.keys(g).filter(k => (OPTIONAL_GRADE_FIELDS as readonly string[]).includes(k))).toEqual([
      'neutralResistanceFlat', 'earthResistanceFlat', 'fireResistanceFlat', 'waterResistanceFlat', 'airResistanceFlat',
      'criticalDamageReduction', 'pushDamageReduction', 'tackleBlock', 'tackleEvade', 'initiativeBonus', 'damageBonus',
      'percentDamageBonus', 'bonusEarthDamage', 'criticalHitBonus', 'criticalDamageBonus', 'pushDamageBonus', 'healBonus',
      'trapDamageBonus', 'trapDamageBonusPercent', 'apAttack', 'mpAttack', 'maxSummon',
    ])
    expect(g).not.toHaveProperty('honoursPoints')
    expect(convertMonsterGrade(g).stats).toMatchObject({
      neutralRes: 1, earthRes: 2, fireRes: 3, waterRes: 4, airRes: 5, criticalRes: 6, pushRes: 7, damage: 8,
      earthDamage: 9, critical: 10, criticalDamage: 11, pushDamage: 12, heals: 13, trapDamage: 14, trapPower: 15,
      apReduction: 16, mpReduction: 17, power: 18,
    })
    expect(convertMonsterGrade(g).stats.summons).toBeUndefined()
  })

  it('parts de l’invocateur 3.7 (bonusCharacteristics renommées) → summonerShare', () => {
    const b = normBonusCharacteristics({ lifePoints: 90, strength: 100, earthDamageBonus: 100, reductionFire: 50, reductionFireFlat: 50, criticalDamageReduction: 100, tackleBonus: 200 })
    expect(convertSummonerShare(b)).toEqual({
      lifePct: 90,
      stats: { strength: 100, earthDamage: 100, fireResPct: 50, fireRes: 50, criticalRes: 100, tackleBlock: 200 },
    })
  })

  it('fixtures 3.7 : toute part de l’invocateur non nulle est prise en charge (Explobombe : dommages, Puissance, neutre)', () => {
    // Même contrôle que data-node « toutes les clés observées sont prises en charge », sur les réponses 3.7 : une clé
    // conservée par la normalisation mais absente de MONSTER_BONUS_STATS serait écartée en silence par
    // convertSummonerShare.
    for (const f of FIXTURES)
      for (const raw of f.grades)
        for (const k of Object.keys(normGrade(raw).bonusCharacteristics ?? {}))
          expect(k === 'lifePoints' || k in MONSTER_BONUS_STATS, `${f.id} g${raw.grade} ${k}`).toBe(true)
    // Explobombe : en 3.7, la bombe hérite aussi des dommages fixes, de la Puissance et des dommages neutres du Roublard.
    const share37 = convertMonsterGrade(normGrade(EXPLOBOMBE.grades[0])).summonerShare
    const share36 = convertMonsterGrade(grade36(3112, 1)).summonerShare!
    expect(share37).toEqual({ lifePct: 90, stats: { ...share36.stats, damage: 100, power: 100, neutralDamage: 100 } })
    expect(share36.lifePct).toBe(90)
  })

  it.runIf(LIVE_IS_36)('données actuelles (3.6) : conversion inchangée sur un échantillon (valeurs relevées avant la modification)', () => {
    // Relevé sur le commit 1fc0aa7 (avant lecture des champs 3.7) ; l'empreinte des 5 135 monstres convertis est
    // aussi identique avant/après (vérifié hors tests). Sans objet (ignoré) après une ré-extraction 3.7.
    const stats = (id: number, grade: number) => data.monster(id)!.grades.find(g => g.grade === grade)!
    expect(stats(3835, 5).stats).toEqual({ ap: 16, mp: 5, wisdom: 800, strength: 800, intelligence: 800, chance: 800, agility: 800, neutralResPct: 6, earthResPct: 33, fireResPct: 12, waterResPct: 21, airResPct: 28, mpParry: 20 })
    expect(stats(1045, 5).stats).toEqual({ ap: 10, mp: 7, wisdom: 800, strength: 800, intelligence: 800, chance: 9999, agility: 800, neutralResPct: 400, earthResPct: 400, fireResPct: 400, waterResPct: 400, airResPct: 400 })
    expect(stats(3534, 5).stats).toEqual({ ap: 20, mp: 6, wisdom: 700, strength: 700, intelligence: 700, chance: 700, agility: 700, neutralResPct: 14, earthResPct: 27, fireResPct: 16, waterResPct: 22, airResPct: 12, mpParry: 30 })
    const bomb = stats(3112, 1)
    expect(bomb.stats).toEqual({ vitality: 10, neutralResPct: 10, earthResPct: 10, fireResPct: 30, waterResPct: 10, airResPct: 10 })
    expect(bomb.summonerShare).toEqual({ lifePct: 90, stats: { strength: 100, wisdom: 100, chance: 100, agility: 100, intelligence: 100, earthDamage: 100, fireDamage: 100, waterDamage: 100, airDamage: 100 } })
    // Aucun grade actuel ne porte de champ 3.7.
    const with37 = monsters.filter(m => m.grades.some(g => OPTIONAL_GRADE_FIELDS.some(k => k in g)))
    expect(with37.map(m => m.id)).toEqual([])
  })
})
