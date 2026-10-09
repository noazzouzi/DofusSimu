/**
 * Theorycraft — combattants hors combat (src/theorycraft/fighters.ts) et DPT soutenu (src/theorycraft/rotation.ts,
 * docs/design/theorycraft.md §1.5) : soutenu ≤ rafale, relances tenues d'un tour à l'autre (un sort à relance n'est pas
 * lancé à chaque tour), régime établi (relances amorties, indépendant de l'horizon), poisons suivis d'un tour à l'autre
 * (cumul, recouvrement des relances : rejeu dans le moteur), déterminisme, combattants passés intacts, cohérence avec le
 * proxy de stuff, modules purs (graphe transitif des imports d'exécution).
 */
import { describe, expect, it } from 'vitest'
import { placeForCast } from '../src/ai/core/calibrate'
import { loadDataStore } from '../src/data/node'
import { createEngine } from '../src/engine'
import { castSpell } from '../src/engine/cast'
import { createMonsterFighter } from '../src/engine/factory'
import type { Fighter } from '../src/engine/types'
import { CELL_COUNT, distance } from '../src/map/geometry'
import { applyTargetOverrides } from '../src/optimizer/stuff/targetFighter'
import { bossProfile } from '../src/theorycraft/bossProfile'
import { createProxyContext } from '../src/optimizer/stuff/proxy'
import { BASE_PRESETS, getPreset, presetMember } from '../src/optimizer/team/presets'
import { computeBuildStats } from '../src/stats/build'
import { assertDistinct, bossFighter, playerFighterFromMember, playerFighterFromStats, theoryDptTable, withStates } from '../src/theorycraft/fighters'
import { sustainedDamage } from '../src/theorycraft/rotation'
import { initialStance } from '../src/theorycraft/stances'
import { runtimeImportClosure, runtimeImports } from './import-graph-helpers'

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
    // Régime établi : un lancer tous les deux tours, quel que soit le départ.
    for (const s of [cruise, start]) {
      expect(s.period).toBe(2)
      expect(s.steady).toBeCloseTo(cruise.burst / 2, 9)
    }
  })

  it('régime établi : indépendant de l\'horizon, périodique, ≤ rafale ; la moyenne sur 6 tours penche vers la rafale', () => {
    let biased = 0
    for (const p of BASE_PRESETS) {
      const a = playerOf(p.id)
      const s6 = sustainedDamage(table, a, boss)
      const s60 = sustainedDamage(table, a, boss, { turns: 60 })
      expect([s6.steady, s6.period]).toEqual([s60.steady, s60.period])
      expect(s6.period).toBeGreaterThanOrEqual(1)
      expect(s6.period).toBeLessThanOrEqual(10)
      expect(s6.steady).toBeLessThanOrEqual(s6.burst + 1e-9)
      // Fin d'un long horizon : rotation périodique de période `period`, de moyenne `steady`.
      const k = s60.period
      const tail = s60.perTurn.slice(60 - k)
      tail.forEach((x, i) => expect(x).toBeCloseTo(s60.perTurn[60 - 2 * k + i], 9))
      expect(tail.reduce((x, y) => x + y, 0) / k).toBeCloseTo(s6.steady, 9)
      // Sur 6 tours, chaque sort à relance part dès le tour 1 : la moyenne ne passe pas sous le régime établi de plus
      // d'un arrondi (mesuré : jusqu'à +2,05 % au-dessus, Pandawa Saoul et Sram poisons).
      if (s6.mean > s6.steady * 1.01) biased++
    }
    expect(biased).toBeGreaterThanOrEqual(2)
    const saoul = sustainedDamage(table, playerOf('pandawa_saoul'), boss)
    expect(saoul.mean).toBeGreaterThan(saoul.steady * 1.015)
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

/**
 * Rejeu dans le MOTEUR d'une rotation (une liste de lancers par tour, répétée) contre le boss aux caractéristiques
 * imposées `stats` (protocole de l'audit : boss immortel et passif, lanceur à la case libre la plus proche, placement de
 * `placeForCast`, jets moyens) : dégâts par tour sur une fenêtre après `warm` tours de chauffe.
 */
function engineReplay(a: Fighter, monsterId: number, stats: Record<string, number>, cycle: readonly number[][], warm = 10, window = 20): number {
  const engine = createEngine(data)
  const map = data.map(143393281)!
  const me0 = { ...a, states: [], cell: -1, cooldowns: {}, castsThisTurn: {}, castsOnTarget: {} }
  const boss0 = createMonsterFighter(data, { monsterId, grade: 1, cell: 300, team: 1 })
  applyTargetOverrides(boss0, { stats })
  const fight = engine.createFight({ map, fighters: [me0, boss0], options: { seed: 1, rollMode: 'average', record: false, maxRounds: 999 } })
  const [me, boss] = fight.fighters
  boss.maxHp = boss.baseMaxHp = boss.hp = 100_000_000
  boss.tags.cannotPlay = true
  let best = -1
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!fight.map.cells[c]?.walkable || c === boss.cell) continue
    if (best < 0 || distance(c, boss.cell) < distance(best, boss.cell)) best = c
  }
  me.cell = best
  const hp: number[] = []
  for (let t = 0; t <= warm + window; t++) {
    let f = engine.nextTurn(fight)
    for (let g = 0; f && f.id !== me.id && g < 8; g++) {
      engine.endTurn(fight, f)
      f = engine.nextTurn(fight)
    }
    hp.push(boss.hp)
    for (const id of cycle[t % cycle.length]) castSpell(engine, fight, me, id, placeForCast(engine, fight, me, id, boss.cell))
    engine.endTurn(fight, me)
  }
  return (hp[warm] - hp[warm + window]) / window
}

describe('poisons suivis d\'un tour à l\'autre (cumul, recouvrement), rejeu dans le moteur', () => {
  const hare = bossProfile(data, HAREBOURG)
  const target = bossFighter(data, HAREBOURG, { grade: 1, stats: hare.stats })

  it('Flèche Tyrannique seule (cumul 1), deux lancers par tour : une échéance par tour, exactement les dégâts du moteur', () => {
    // Heuristique du sac à dos : 1,6 échéance critique pondérée PAR LANCER (3,2 par tour) ; moteur : l'instance est
    // rafraîchie, une échéance par tour, sans critique.
    const cra = playerOf('cra_feu_zone')
    const solo = withStates({ ...cra, spells: cra.spells.filter(s => s.spellId === 32448) }, cra.states)
    const s = sustainedDamage(table, solo, target)
    expect(s.casts.at(-1)).toEqual([32448, 32448])
    const sp = table.split(solo, 0, target)
    expect(s.steady).toBeCloseTo(2 * sp.immediate + sp.dots[0].tick, 6)
    expect(s.steady).toBeLessThan(0.7 * 2 * table.perCast(solo, 0, target).mean)
    expect(s.steadyBySpell).toEqual([{ spellId: 32448, casts: 2, damage: s.steady }])
    const engine = engineReplay(solo, HAREBOURG, hare.stats as unknown as Record<string, number>, [[32448, 32448]])
    expect(Math.abs(engine / s.steady - 1)).toBeLessThan(0.01)
  })

  it('Crâ Feu contre le Comte Harebourg : rotation établie choisie sur les échéances AJOUTÉES (Tyrannique une fois par tour), proche du moteur', () => {
    const cra = playerOf('cra_feu_zone')
    const s = sustainedDamage(table, cra, target)
    const cycle = s.casts.slice(-s.period)
    expect(cycle.flat().filter(id => id === 32448)).toHaveLength(s.period)
    // Rejeu : régime établi à 15 % du moteur (avant : +58 %, Tyrannique lancée deux fois par tour et ses poisons
    // cumulés). Écart résiduel connu : Flèche Dévorante (paliers et effet différé retiré par la relance, non modélisés).
    const engine = engineReplay(cra, HAREBOURG, hare.stats as unknown as Record<string, number>, cycle)
    expect(Math.abs(s.steady / engine - 1)).toBeLessThan(0.15)
    // Le moteur confirme le choix : l'ancienne rotation (Dévorante + 2 × Tyrannique) inflige moins.
    expect(engineReplay(cra, HAREBOURG, hare.stats as unknown as Record<string, number>, [[32446, 32448, 32448]])).toBeLessThan(0.9 * engine)
    // Détail par sort : la somme redonne le régime établi.
    expect(s.steadyBySpell.reduce((x, y) => x + y.damage, 0)).toBeCloseTo(s.steady, 6)
  })
})

describe('modules du theorycraft purs', () => {
  it('fighters, rotation, stances : ni paquet ni `node:`, ni src/dungeons, ni le proxy ou le Vortex, même indirectement', () => {
    const c = runtimeImportClosure(['fighters', 'rotation', 'stances'].map(f => `src/theorycraft/${f}.ts`))
    // Le dépôt n'a aucune dépendance d'exécution (package.json) : tout spécificateur externe serait un module Node ou
    // un outil de développement.
    expect(c.external).toEqual([])
    expect(c.files.filter(f => /^src\/dungeons\/|^src\/optimizer\/stuff\/(proxy|vortex)\.ts$/.test(f))).toEqual([])
    expect(c.files).toContain('src/optimizer/stuff/targetFighter.ts')
    expect(c.files.length).toBeGreaterThan(20)
  })

  it('graphe des imports : suit les imports indirects, ignore les imports de type', () => {
    // proxy.ts tire le mix du Vortex (dummy.ts) par un import direct, et ses dépendances par des imports indirects.
    const proxy = runtimeImportClosure(['src/optimizer/stuff/proxy.ts']).files
    expect(proxy).toContain('src/dungeons/generic/dummy.ts')
    expect(proxy).toContain('src/dungeons/vortex/placement.ts')
    const src = [
      "import type { A } from './a'",
      "import { type B, type C } from './b'",
      "export type { D } from './d'",
      "import { E, type F } from './e'",
      "export { G } from './g'",
      "export * from './h'",
      "import './i'",
      "import * as J from './j'",
      "const k = await import('./k')",
      "const l = require('node:fs')",
    ].join('\n')
    expect(runtimeImports(src)).toEqual(['./e', './g', './h', './i', './j', './k', 'node:fs'])
  })
})
