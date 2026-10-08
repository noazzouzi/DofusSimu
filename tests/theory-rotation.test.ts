/**
 * Theorycraft — combattants hors combat (src/theorycraft/fighters.ts) et DPT soutenu (src/theorycraft/rotation.ts,
 * docs/design/theorycraft.md §1.5) : soutenu ≤ rafale, relances tenues d'un tour à l'autre (un sort à relance n'est pas
 * lancé à chaque tour), déterminisme, combattants passés intacts, cohérence avec le proxy de stuff, modules purs.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import type { Fighter } from '../src/engine/types'
import { createProxyContext } from '../src/optimizer/stuff/proxy'
import { BASE_PRESETS, getPreset, presetMember } from '../src/optimizer/team/presets'
import { computeBuildStats } from '../src/stats/build'
import { assertDistinct, bossFighter, playerFighterFromMember, playerFighterFromStats, theoryDptTable, withStates } from '../src/theorycraft/fighters'
import { sustainedDamage } from '../src/theorycraft/rotation'
import { initialStance } from '../src/theorycraft/stances'

const data = loadDataStore()
const table = theoryDptTable(data)

const HAREBOURG = 3416
/** Boss « neutre » : Comte Harebourg grade 1, résistances élémentaires à 0. */
const NEUTRAL = { neutralResPct: 0, earthResPct: 0, fireResPct: 0, waterResPct: 0, airResPct: 0 }

function playerOf(presetId: string): Fighter {
  const p = getPreset(presetId)
  const a = playerFighterFromMember(data, presetMember(p, data))
  // Posture de début de combat (masque Zobal, Armé…), que le moteur ne pose pas hors combat.
  return withStates(a, initialStance(p.breedId, a.spells.map(s => s.spellId)).states)
}

/** Instantané de tout ce qu'une simulation pourrait modifier sur un combattant. */
function snapshot(f: Fighter): string {
  return JSON.stringify({ cd: f.cooldowns, ct: f.castsThisTurn, co: f.castsOnTarget, st: f.states, s: f.stats, b: f.baseStats, hp: f.hp, ap: f.ap, mp: f.mp, rev: f.rev, id: f.id, team: f.team })
}

describe('combattants hors combat', () => {
  it('ids et équipes distincts ; boss aux caractéristiques et états imposés', () => {
    const a = playerOf('cra_feu_zone')
    const d = bossFighter(data, HAREBOURG, { grade: 1, stats: { fireResPct: 40 }, states: [56] })
    expect([a.id, a.team]).toEqual([0, 0])
    expect([d.id, d.team]).toEqual([1, 1])
    expect(d.stats.fireResPct).toBe(40)
    expect(d.states).toEqual([56])
    expect(() => assertDistinct(a, { ...d, id: a.id })).toThrow(/ids identiques/)
    expect(() => assertDistinct(a, { ...d, team: a.team })).toThrow(/même équipe/)
    expect(() => sustainedDamage(table, a, { ...d, id: a.id })).toThrow(/ids identiques/)
  })

  it('même DPT qu\'un tour du proxy de stuff (mêmes combattants, mêmes caches)', () => {
    for (const id of ['cra_feu_zone', 'iop_terre_burst', 'sacrieur_tank']) {
      const p = getPreset(id)
      const m = presetMember(p, data)
      const r = computeBuildStats(m.build, data)
      const ctx = createProxyContext(data, { breedId: p.breedId, level: 200, variants: p.variants, role: p.role, presetId: p.id, element: p.element }, r, {
        targets: [{ monsterId: HAREBOURG, weight: 1, grade: 1, stats: { earthResPct: 25 } }],
        strictTargets: true,
      })
      const a = playerFighterFromMember(data, m)
      const b = playerFighterFromStats(data, { breedId: p.breedId, level: 200, variants: p.variants, presetId: p.id }, r.stats, r.maxHp)
      const d = bossFighter(data, HAREBOURG, { grade: 1, stats: { earthResPct: 25 } })
      const want = ctx.dptAgainst(r.stats, r.maxHp, 0) / ctx.calibration
      expect(table.turn(a, d, a.stats.ap, 'next').mean).toBeCloseTo(want, 6)
      expect(table.turn(b, d, b.stats.ap, 'next').mean).toBeCloseTo(want, 6)
    }
  })
})

describe('DPT soutenu (rotation tour par tour)', () => {
  const boss = bossFighter(data, HAREBOURG, { grade: 1, stats: NEUTRAL })

  it('soutenu ≤ rafale, chaque tour ≤ rafale, premier tour = rafale (49 presets de base)', () => {
    let below = 0
    for (const p of BASE_PRESETS) {
      const s = sustainedDamage(table, playerOf(p.id), boss)
      expect(s.perTurn).toHaveLength(6)
      expect(s.casts).toHaveLength(6)
      expect(s.perTurn[0]).toBeCloseTo(s.burst, 9)
      for (const x of s.perTurn) expect(x).toBeLessThanOrEqual(s.burst + 1e-9)
      expect(s.mean).toBeLessThanOrEqual(s.burst + 1e-9)
      expect(s.mean).toBeCloseTo(s.perTurn.reduce((a, b) => a + b, 0) / 6, 9)
      if (s.mean < s.burst - 1) below++
    }
    // Les relances coûtent quelque chose à plusieurs presets (Forgelance, Eniripsa, Sram, Zobal…).
    expect(below).toBeGreaterThanOrEqual(5)
  })

  it('un sort à relance n\'est pas relancé avant la fin de sa relance (moteur : décompte au début du tour)', () => {
    let checked = 0
    for (const p of BASE_PRESETS) {
      const a = playerOf(p.id)
      const profiles = table.profiles.ofFighter(a)
      const cooldownOf = (spellId: number) => {
        const pr = profiles[a.spells.findIndex(s => s.spellId === spellId)]
        return Math.max(pr.cooldown, pr.level.globalCooldown)
      }
      const s = sustainedDamage(table, a, boss, { turns: 8 })
      s.casts.forEach((list, t) => {
        for (const spellId of new Set(list)) {
          const cd = cooldownOf(spellId)
          if (cd < 2) continue
          checked++
          // Lancé au tour t : indisponible aux tours t+1 … t+cd−1.
          for (let u = t + 1; u < Math.min(s.casts.length, t + cd); u++) expect(s.casts[u]).not.toContain(spellId)
        }
      })
    }
    expect(checked).toBeGreaterThan(10)
    // Exemple : Forgelance (Armé) — les sorts à relance de la rafale ne sont pas relancés au tour suivant ; soutenu < rafale.
    const forge = playerOf('forgelance_zone_terre')
    const s = sustainedDamage(table, forge, boss)
    const withCd = s.casts[0].filter(id => table.profiles.ofFighter(forge)[forge.spells.findIndex(x => x.spellId === id)].cooldown >= 2)
    expect(withCd.length).toBeGreaterThan(0)
    for (const id of withCd) expect(s.casts[1]).not.toContain(id)
    expect(s.mean).toBeLessThan(s.burst)
  })

  it('relances initiales (option) : un sort à relance initiale n\'est pas lancé aux premiers tours', () => {
    let checked = 0
    for (const p of BASE_PRESETS) {
      const a = playerOf(p.id)
      const s = sustainedDamage(table, a, boss, { initialCooldowns: true })
      for (const ks of a.spells) {
        const n = ks.level.initialCooldown
        if (n <= 0) continue
        checked++
        for (let t = 0; t < n; t++) expect(s.casts[t]).not.toContain(ks.spellId)
      }
      expect(s.perTurn[0]).toBeLessThanOrEqual(s.burst + 1e-9)
    }
    expect(checked).toBeGreaterThan(20)
    // Exemple isolé : Forgelance Armé réduit au seul sort Elding (relance 2, relance initiale 1).
    const forge = playerOf('forgelance_eau_air_support')
    const elding = forge.spells.find(ks => ks.spellId === 23396)!
    expect([elding.level.initialCooldown, elding.level.minCastInterval]).toEqual([1, 2])
    // Nouvelle révision (withStates) : les caches DPT sont indexés par révision, et les sorts ont changé.
    const solo = withStates({ ...forge, spells: [elding] }, forge.states)
    const cruise = sustainedDamage(table, solo, boss, { turns: 4 })
    const start = sustainedDamage(table, solo, boss, { turns: 4, initialCooldowns: true })
    expect(cruise.casts).toEqual([[23396], [], [23396], []])
    expect(start.casts).toEqual([[], [23396], [], [23396]])
    expect(start.burst).toBe(cruise.burst)
    expect(start.mean).toBeCloseTo(cruise.mean, 9)
  })

  it('déterministe et sans effet sur les combattants passés', () => {
    const a = playerOf('eniripsa_soin_feu')
    const d = bossFighter(data, HAREBOURG, { grade: 1, stats: NEUTRAL })
    const sa = snapshot(a)
    const sd = snapshot(d)
    const r1 = sustainedDamage(table, a, d, { turns: 7 })
    const r2 = sustainedDamage(table, a, d, { turns: 7 })
    // Une autre table (caches vides) donne les mêmes nombres.
    const r3 = sustainedDamage(theoryDptTable(loadDataStore()), playerOf('eniripsa_soin_feu'), bossFighter(data, HAREBOURG, { grade: 1, stats: NEUTRAL }), { turns: 7 })
    expect(r2).toEqual(r1)
    expect(r3).toEqual(r1)
    expect(snapshot(a)).toBe(sa)
    expect(snapshot(d)).toBe(sd)
    expect(a.cooldowns).toEqual({})
    // Le résultat n'est pas partagé avec les caches du sac à dos.
    r1.casts[0].push(-1)
    expect(sustainedDamage(table, a, d, { turns: 7 }).casts[0]).not.toContain(-1)
  })

  it('PA imposés : moins de PA, moins de dégâts', () => {
    const a = playerOf('iop_terre_burst')
    expect(sustainedDamage(table, a, boss, { ap: 6 }).mean).toBeLessThan(sustainedDamage(table, a, boss).mean)
  })
})

describe('modules du theorycraft purs', () => {
  it('fighters, rotation, stances : ni `node:`, ni src/dungeons, ni le proxy (défaut du Vortex)', () => {
    let n = 0
    for (const f of ['fighters', 'rotation', 'stances']) {
      const src = readFileSync(`src/theorycraft/${f}.ts`, 'utf8')
      const imports = [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])
      n += imports.length
      for (const spec of imports) {
        expect(spec.startsWith('node:')).toBe(false)
        expect(spec).not.toMatch(/dungeons|optimizer\/stuff\/(proxy|vortex)$/)
      }
    }
    expect(n).toBeGreaterThan(5)
  })
})
