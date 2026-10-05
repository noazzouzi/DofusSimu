/**
 * Planificateur d'heures de l'Œil de Vortex (docs/design/ai.md §12.4-§12.7, §16.3) — WP3b.
 *
 *  - T-hours : coûts d'heures MESURÉS sur une vraie équipe (presets réels, données réelles) et table de repli ;
 *  - puzzles PL1-PL6 du planificateur (états abstraits → plan attendu ; monstres réels, coûts de repli du §12.4) ;
 *  - prix : kill > 0 pour un contrat à l'heure prévue, < 0 pour la même mort à V/XI ; clock[1] > 0 quand seule une
 *    glyphe rend une étoile accessible ;
 *  - oracle de kill (calibration en ligne), prévision sans un joueur mort, déterminisme.
 * PL7 (tout corrompu → phase `waiting`) et le modèle complet sur le vrai combat : tests/vortex-planner-model.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { loadTheta } from '../src/ai/theta'
import { loadDataStore } from '../src/data/node'
import type { ClockSlot } from '../src/dungeons/types'
import type { AbsMonster, AbsState } from '../src/dungeons/vortex/abstract'
import { BRABUZAR, BUBOXOR, C_VX_FALLBACK, HARPILLE, IKARGN, MEJAIRE, nextHour, VORTEX, VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { fallbackHourCosts, HourCostModel, measureHourCosts, teamTurnDamage } from '../src/dungeons/vortex/hourCost'
import {
  actionKey,
  KillOracle,
  planHours,
  plannerConfig,
  pKillOf,
  slotsWithoutPlayer,
  type PlannerContext,
  type PlanResult,
} from '../src/dungeons/vortex/planner'
import { heuristicPrices, reKillWindow, searchPrices } from '../src/dungeons/vortex/pricer'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { createEngine } from '../src/engine'
import { createDptTable } from '../src/ai/core/dpt'
import { createMonsterFighter } from '../src/engine/factory'
import { buildTeam } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'
import type { AIMode } from '../src/ai/types'

const data = loadDataStore('data')
const theta = loadTheta()

// ───────────────────────────── outils des puzzles ─────────────────────────────

/** Joueurs P1..P4 (ids 0..3), monstres (ids 10+), Vortex (id 4) : P1 M P2 M P3 M P4 V, k = 4. */
const P1 = 0
const P2 = 1
const P3 = 2
const P4 = 3
const V = 4

/**
 * Créneaux synthétiques (même règle que `forecastHours` : +1 heure au début du tour de chaque personnage vivant) à partir
 * du tour `fromRound`, l'horloge étant sur `hourBefore` avant le premier créneau ; `monsters` intercalés après P1..P3.
 */
function cycleSlots(fromRound: number, rounds: number, hourBefore: number, monsters: readonly number[] = [10, 11, 12]): ClockSlot[] {
  const out: ClockSlot[] = []
  let h = hourBefore
  for (let r = fromRound; r < fromRound + rounds; r++) {
    const tl: [number, boolean][] = [[P1, true], [monsters[0], false], [P2, true], [monsters[1], false], [P3, true], [monsters[2], false], [P4, true], [V, false]]
    tl.forEach(([id, pl], index) => {
      if (pl) h = nextHour(h, 1)
      out.push({ round: r, index, fighterId: id, isPlayer: pl, isVortex: id === V, hour: h })
    })
  }
  return out
}

const HP = 6600

function mon(id: number, monsterId: number, o: Partial<AbsMonster> = {}): AbsMonster {
  return { id, monsterId, wave: 1, status: 'alive', hp: HP, maxHp: HP, hours: 0, star: false, corruptOnWake: false, threat: 900, baseMaxHp: HP, ...o }
}

const bit = (h: number) => 1 << (h - 1)

function rootOf(slots: ClockSlot[], monsters: AbsMonster[]): AbsState {
  let used = 0
  for (const m of monsters) used |= m.hours
  return { slotIdx: 0, hour: slots[0].hour, glyphShift: 0, round: slots[0].round, vortexTurns: 0, monsters, hoursUsed: used, score: 0, trace: null }
}

interface PuzzleOptions {
  /** Dégâts par tour de chaque joueur sur un monstre (créneau courant : ×1, futur : ×0,85). */
  E: Record<number, number>
  /** Joueurs sans contrat de kill (mpLock à faible DPT). */
  noContract?: number[]
  glyphsNow?: number
  costs?: HourCostModel
}

function ctxOf(slots: ClockSlot[], o: PuzzleOptions): PlannerContext {
  const players = new Set(slots.filter(s => s.isPlayer && s.index >= 0).map(s => s.fighterId)).size
  return {
    slots,
    costs: o.costs ?? fallbackHourCosts(),
    players,
    expected: (i, p, m) => (o.E[p] ?? 0) * (m.hours & bit(5) ? 0.7 : 1) * (i === 0 ? 1 : 0.85),
    canContract: p => !(o.noContract ?? []).includes(p),
    glyphsNow: o.glyphsNow ?? 0,
    glyphBonusNow: 0,
  }
}

const marks = (r: PlanResult) => r.plan.contracts.filter(c => c.kind === 'mark')
const corruptions = (r: PlanResult) => r.plan.contracts.filter(c => c.kind === 'corrupt')
const before = (a: { round: number; index: number }, b: { round: number; index: number }) => a.round < b.round || (a.round === b.round && a.index < b.index)

// ───────────────────────────── T-hours ─────────────────────────────

describe('coûts des heures (§12.4, T-hours)', () => {
  const engine = createEngine(data, vortexHooks)
  const meta = buildTeam(data, parseTeam('cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu', data))
  createVortexFight(engine, meta, { params: VORTEX_DEFAULT_PARAMS, seed: 1, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  const measured = measureHourCosts(engine, { params: VORTEX_DEFAULT_PARAMS, theta, team: meta })

  it('table de repli : valeurs du §12.4, élément absent, placeur, échelle', () => {
    const f = fallbackHourCosts()
    expect(f.source).toBe('fallback')
    expect(f.cVx(5)).toBe(4000)
    expect(f.cVx(11)).toBe(5000)
    expect(f.cVx(7)).toBe(0)
    expect(f.cMon(IKARGN, 8)).toBe(1200)
    expect(f.cMon(IKARGN, 10)).toBe(50)
    expect(fallbackHourCosts({ hasPlacer: true }).cMon(IKARGN, 10)).toBe(300)
    // Ikargn sans sort Eau : VI (+400 Chance) au coût réduit.
    expect(fallbackHourCosts({ elementsOf: () => new Set([1, 2]) }).cMon(IKARGN, 6)).toBe(100)
    expect(fallbackHourCosts({ scale: 2 }).cVx(4)).toBe(2000)
    // Coût d'une mort : zombie + Vortex seulement si l'heure est nouvelle.
    expect(f.markCost(IKARGN, 5, 0)).toBe(600 + 4000)
    expect(f.markCost(IKARGN, 5, bit(5))).toBe(600)
    // T-hours sur la table de repli : V et XI les plus chères pour le Vortex, VII la moins chère, II et X sous 300.
    const byCost = f.hoursByVortexCost()
    expect(byCost.slice(-2).sort()).toEqual([11, 5].sort())
    expect(byCost[0]).toBe(7)
    expect(f.cVx(2)).toBeLessThan(300)
    expect(f.cVx(10)).toBeLessThan(300)
  })

  it('T-hours mesuré (équipe méta réelle) : V et XI parmi les 3 plus chères pour le Vortex, II et X sous 300', () => {
    expect(measured.source).toBe('measured')
    const top3 = measured.hoursByVortexCost().slice(-3)
    expect(top3).toContain(5)
    expect(top3).toContain(11)
    for (const h of [2, 10]) {
      expect(measured.cVx(h)).toBeLessThan(300)
      for (const id of [IKARGN, MEJAIRE, HARPILLE, BUBOXOR, BRABUZAR]) expect(measured.cMon(id, h)).toBeLessThan(300)
    }
    // V : ×75 % de dommages subis sur 22 000 PV (λ_burst 0,5) ≈ 3 667 PVe ; XI : +30 % de PV ≈ 3 300.
    expect(measured.cVx(5)).toBeCloseTo(0.5 * 22000 * (1 / 0.75 - 1), 0)
    expect(measured.cVx(11)).toBeCloseTo(0.5 * 0.3 * 22000, 0)
    for (let h = 1; h <= 12; h++) {
      expect(measured.cVx(h)).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(measured.cVx(h))).toBe(true)
    }
  })

  it('VII (+150 résistances critiques) : coût MESURÉ croissant avec le taux de critique de l’équipe (écart au §12.4)', () => {
    // La table de repli met VII à 0 ; mesuré par le DPT réel (résistance critique déduite de chaque ligne critique),
    // VII coûte d'autant plus que l'équipe frappe en critique : équipe « fumée » (15 % CC) < équipe méta (57-82 % CC).
    const e2 = createEngine(data, vortexHooks)
    const smoke = createSmokeTeam(data)
    createVortexFight(e2, smoke, { params: VORTEX_DEFAULT_PARAMS, seed: 1, rollMode: 'random', record: false, rngRekey: 'perTurn' })
    const low = measureHourCosts(e2, { params: VORTEX_DEFAULT_PARAMS, theta, team: smoke })
    expect(low.cVx(7)).toBeGreaterThan(0)
    expect(measured.cVx(7)).toBeGreaterThan(low.cVx(7))
  })

  it('VIII (+4 PA) : le Vortex lance un sort de plus sur une autre cible (dégâts répartis sur l’équipe)', () => {
    const dpt = createDptTable(engine)
    const v = createMonsterFighter(data, { monsterId: VORTEX, grade: 5, team: 1 })
    engine.recomputeStats(v)
    const base = teamTurnDamage(dpt, v, meta)
    expect(base).toBeGreaterThan(0)
    expect(teamTurnDamage(dpt, v, meta, v.stats.ap + 4)).toBeGreaterThan(base)
    expect(measured.cVx(8)).toBeGreaterThan(0)
  })

  it('déterministe : deux mesures identiques ; sans joueur vivant : repli', () => {
    const again = measureHourCosts(engine, { params: VORTEX_DEFAULT_PARAMS, theta, team: meta })
    expect(Array.from(again.vx)).toEqual(Array.from(measured.vx))
    expect(Array.from(again.mon.get(HARPILLE)!)).toEqual(Array.from(measured.mon.get(HARPILLE)!))
    expect(measureHourCosts(engine, { params: VORTEX_DEFAULT_PARAMS, theta, team: [] }).source).toBe('fallback')
  })
})

// ───────────────────────────── puzzles PL1-PL6 ─────────────────────────────

describe('puzzles du planificateur (§16.3)', () => {
  it('PL1 — vague 1, 4 joueurs, k = 4, rien de marqué : marquages à VII/X/II, aucun à V/VIII/XI', () => {
    const slots = cycleSlots(1, 9, 12)
    const root = rootOf(slots, [mon(10, IKARGN), mon(11, MEJAIRE), mon(12, HARPILLE)])
    const ctx = ctxOf(slots, { E: { [P1]: 3000, [P2]: 9000, [P3]: 9000, [P4]: 5000 }, noContract: [P1] })
    for (const mode of ['standard', 'deep'] as AIMode[]) {
      const r = planHours(root, ctx, plannerConfig(mode, theta))
      const hours = new Set(marks(r).map(c => c.hour))
      for (const bad of [5, 8, 11]) expect(hours.has(bad), `${mode} : marquage à ${bad}`).toBe(false)
      expect([2, 7, 10].filter(h => hours.has(h)).length, `${mode} : ${[...hours]}`).toBeGreaterThanOrEqual(2)
      // Personne ne compte sur P1 (mpLock sans contrat).
      expect(r.plan.contracts.every(c => c.killer !== P1)).toBe(true)
    }
    // Avec un horizon assez long (deep), le plan va jusqu'aux corruptions sous l'étoile.
    const deep = planHours(root, ctx, plannerConfig('deep', theta))
    expect(corruptions(deep).length).toBeGreaterThan(0)
    for (const c of corruptions(deep)) expect(marks(deep).some(m => m.m === c.m && m.hour === c.hour && before(m, c))).toBe(true)
  })

  it('PL2 — Méjaire marquée VII, Crâ (seul à voir VII) mort, deadPlayerAdvancesClock : glyphe au tour de P1 ⇒ P2 corrompt', () => {
    // Tour 2 : P1 voit V, P2 VI, P3 (mort, tic virtuel) VII, P4 VIII.
    const slots = slotsWithoutPlayer(cycleSlots(2, 6, 4), P3, true)
    expect(slots.filter(s => s.round === 2).map(s => `${s.fighterId}:${s.index}:${s.hour}`)).toContain(`${P3}:-1:7`)
    const mej = mon(11, MEJAIRE, { hours: bit(7), hp: 1650, threat: 700 })
    const root = rootOf(slots, [mon(10, IKARGN, { hours: bit(10), hp: 1650 }), mej, mon(12, HARPILLE, { hours: bit(2), hp: 1650 })])
    const ctx = ctxOf(slots, { E: { [P1]: 9000, [P2]: 9000, [P4]: 5000 }, glyphsNow: 1 })
    const cfg = plannerConfig('standard', theta)
    const r = planHours(root, ctx, cfg)
    const first = r.plan.steps[0]
    expect(first.fighterId).toBe(P1)
    expect(r.plan.glyphs.some(g => g.round === 2 && g.index === first.index)).toBe(true)
    const c = corruptions(r).find(x => x.m === 11)
    expect(c).toMatchObject({ killer: P2, hour: 7, round: 2 })
    // Prix : seule la glyphe rend l'étoile accessible ⇒ clock[1] > 0.
    const replan = (a: Parameters<typeof actionKey>[0]) => planHours(root, ctx, cfg, { forceRoot: a, beamWidth: 4, horizonPlayerSlots: 8 })
    const prices = searchPrices({ result: r, root, ctx, cfg, theta, me: P1, replan })
    expect(prices.clock[1]).toBeGreaterThan(0)
    // Sans glyphe atteignable, la même mort n'est pas planifiée.
    const noGlyph = planHours(root, { ...ctx, glyphsNow: 0, slots: slots.slice() }, { ...cfg, glyphAvailability: 0, failCost: 5000 })
    expect(noGlyph.plan.contracts.some(x => x.m === 11 && x.kind === 'corrupt' && x.round === 2)).toBe(false)
  })

  it('PL3 — même situation, règle par défaut : P4 voit VII sans glyphe ; paliers de PV posés pour P4', () => {
    // Le mort ne fait plus avancer l'horloge : P1 V, P2 VI, P4 VII.
    const slots = slotsWithoutPlayer(cycleSlots(2, 6, 4), P3, false)
    expect(slots.find(s => s.round === 2 && s.fighterId === P4)!.hour).toBe(7)
    const mej = mon(11, MEJAIRE, { hours: bit(7), hp: Math.round(0.9 * HP), threat: 700 })
    const root = rootOf(slots, [mon(10, IKARGN, { hours: bit(10), hp: 1650 }), mej, mon(12, HARPILLE, { hours: bit(2), hp: 1650 })])
    const ctx = ctxOf(slots, { E: { [P1]: 3500, [P2]: 3500, [P4]: 3000 } })
    const r = planHours(root, ctx, plannerConfig('standard', theta))
    const c = corruptions(r).find(x => x.m === 11)
    expect(c).toMatchObject({ killer: P4, hour: 7, round: 2 })
    expect(r.plan.glyphs.filter(g => g.round === 2)).toHaveLength(0)
    // P4 ne tue pas seul 5 940 PV : pré-dégâts de P1/P2 et palier pour P4.
    expect(r.plan.steps.some(s => s.round === 2 && (s.fighterId === P1 || s.fighterId === P2) && s.action.t === 'damage' && s.action.m === 11)).toBe(true)
    const band = r.plan.bands.find(b => b.m === 11 && b.beforeKiller === P4)
    expect(band).toBeDefined()
    expect(band!.hpMax).toBeLessThanOrEqual(Math.floor(0.8 * 3000 * 0.85) + 1)
    // Prix pour P1 : pente « contrat » et bande avant le créneau de P4.
    const prices = heuristicPrices({ result: r, root, ctx, cfg: plannerConfig('standard', theta), theta, me: P1 })
    const hp = prices.hp.get(11)!
    expect(hp.slope).toBe(theta.vortex.contractHpSlope)
    expect(hp.bandMax).toBe(band!.hpMax)
    expect(hp.bandBonus).toBeGreaterThan(0)
  })

  it('PL4 — 8 monstres vivants, vagues chevauchées : corruptions avant nouveaux marquages, submersion active', () => {
    // Tour 6 : P1 IX, P2 X, P3 XI, P4 XII. Marqués : IX (étoile maintenant), X, XII, I ; neufs : 4 ; vague à venir : 4.
    const slots = cycleSlots(6, 6, 8, [10, 11, 12])
    const marked = [
      mon(10, IKARGN, { hours: bit(9), hp: 1650, star: true }),
      mon(11, MEJAIRE, { hours: bit(10), hp: 1650 }),
      mon(12, HARPILLE, { hours: bit(12), hp: 1650 }),
      mon(13, BUBOXOR, { hours: bit(1), hp: 1650 }),
    ]
    const fresh = [mon(20, HARPILLE, { wave: 2 }), mon(21, HARPILLE, { wave: 2 }), mon(22, BUBOXOR, { wave: 2 }), mon(23, BRABUZAR, { wave: 2 })]
    const pending = [IKARGN, MEJAIRE, MEJAIRE, BRABUZAR].map((id, k) => mon(-(30 + k), id, { status: 'pending', wave: 3, hp: 0, arrivesRound: 7 }))
    const root = rootOf(slots, [...marked, ...fresh, ...pending])
    const ctx = ctxOf(slots, { E: { [P1]: 9000, [P2]: 9000, [P3]: 9000, [P4]: 9000 } })
    const cfg = plannerConfig('standard', theta)
    const r = planHours(root, ctx, cfg)
    const firstCorrupt = corruptions(r)[0]
    expect(firstCorrupt).toBeDefined()
    expect(firstCorrupt).toMatchObject({ m: 10, killer: P1, hour: 9, round: 6 })
    // Les marqués à étoile proche sont corrompus avant tout nouveau marquage d'un monstre neuf.
    const firstFreshMark = marks(r).find(c => fresh.some(f => f.id === c.m))
    if (firstFreshMark) expect(before(firstCorrupt, firstFreshMark)).toBe(true)
    expect(corruptions(r).filter(c => c.round === 6).length).toBeGreaterThanOrEqual(2)
    // Submersion : 8 vivants + 4 arrivants > 2N ⇒ coût actif (score plus bas qu'avec overloadCost = 0).
    const free = planHours(root, ctx, { ...cfg, overloadCost: 0 })
    expect(r.best).toBeLessThan(free.best)
  })

  it('PL5 — heures inoffensives indisponibles (rôles) : marque à IX plutôt qu’à V/XI', () => {
    // Tueurs : P1 (I, V, IX) et P4 (IV, VIII, XII) ; P2 et P3 (II/VI/X, III/VII/XI) sans contrat.
    const slots = cycleSlots(1, 9, 12)
    const root = rootOf(slots, [mon(10, IKARGN), mon(11, MEJAIRE), mon(12, HARPILLE)])
    const ctx = ctxOf(slots, { E: { [P1]: 9000, [P2]: 2000, [P3]: 2000, [P4]: 9000 }, noContract: [P2, P3] })
    const r = planHours(root, ctx, plannerConfig('standard', theta))
    const hours = marks(r).map(c => c.hour)
    expect(hours).toContain(9)
    for (const bad of [5, 11, 8]) expect(hours).not.toContain(bad)
    expect(r.plan.contracts.every(c => c.killer === P1 || c.killer === P4)).toBe(true)
  })

  it('PL6 — zombie à 1 600 PV, étoile au créneau de P3, P1 surpuissant : prix négatif pour P1 maintenant, contrat P3', () => {
    // Tour 4 : P1 I, P2 II, P3 III ; la Méjaire porte III (étoile à l'arrivée de III, créneau de P3).
    const slots = cycleSlots(4, 6, 12)
    const mej = mon(11, MEJAIRE, { hours: bit(3), hp: 1600, threat: 700 })
    const root = rootOf(slots, [mon(10, IKARGN, { hours: bit(7), hp: 1650 }), mej, mon(12, HARPILLE, { hours: bit(10), hp: 1650 })])
    const ctx = ctxOf(slots, { E: { [P1]: 12000, [P2]: 4000, [P3]: 4000, [P4]: 4000 } })
    const cfg = plannerConfig('standard', theta)
    const r = planHours(root, ctx, cfg)
    expect(corruptions(r).find(c => c.m === 11)).toMatchObject({ killer: P3, hour: 3, round: 4 })
    expect(r.plan.steps[0].action.t === 'kill' && r.plan.steps[0].action.m.includes(11)).toBe(false)
    const replan = (a: Parameters<typeof actionKey>[0]) => planHours(root, ctx, cfg, { forceRoot: a, beamWidth: 4, horizonPlayerSlots: 8 })
    const search = searchPrices({ result: r, root, ctx: { ...ctx, pKillNow: () => 1 }, cfg, theta, me: P1, replan })
    const heur = heuristicPrices({ result: r, root, ctx, cfg, theta, me: P1 })
    expect(search.kill.get(11)![1]).toBeLessThan(0)
    expect(heur.kill.get(11)![1]).toBeLessThan(0)
    // Mort sous l'étoile (corruption) : prix maximal.
    expect(heur.kill.get(11)![0]).toBeGreaterThanOrEqual(theta.vortex.corruptKill)
    expect(r.plan.forbid.some(f => f.m === 11)).toBe(true)
  })
})

// ───────────────────────────── prix (§16.3) ─────────────────────────────

describe('prix (§12.7, §16.3)', () => {
  const E = { [P1]: 9000, [P2]: 9000, [P3]: 9000, [P4]: 9000 }
  /** Prix d'une mort maintenant d'un monstre neuf tuable par le joueur du premier créneau, à l'heure de ce créneau. */
  function priceNow(fromRound: number, hourBefore: number, mode: 'heuristic' | 'search'): { price: number; hour: number } {
    const slots = cycleSlots(fromRound, 7, hourBefore)
    const root = rootOf(slots, [mon(10, IKARGN), mon(11, MEJAIRE, { hours: bit(2), hp: 1650 }), mon(12, HARPILLE, { hours: bit(10), hp: 1650 })])
    const ctx = ctxOf(slots, { E })
    const cfg = plannerConfig('standard', theta)
    const r = planHours(root, ctx, cfg)
    const me = slots[0].fighterId
    const replan = (a: Parameters<typeof actionKey>[0]) => planHours(root, ctx, cfg, { forceRoot: a, beamWidth: 4, horizonPlayerSlots: 8 })
    const prices = mode === 'heuristic'
      ? heuristicPrices({ result: r, root, ctx, cfg, theta, me })
      : searchPrices({ result: r, root, ctx: { ...ctx, pKillNow: () => 0.95 }, cfg, theta, me, replan })
    return { price: prices.kill.get(10)![slots[0].hour], hour: slots[0].hour }
  }

  it('kill > 0 pour un contrat à l’heure prévue (VII), < 0 pour la même mort à V ou XI', () => {
    for (const mode of ['heuristic', 'search'] as const) {
      // Tour 2 (P1 V) ; décalage pour que le joueur courant voie VII / V / XI.
      const at7 = priceNow(2, 6, mode)
      const at5 = priceNow(2, 4, mode)
      const at11 = priceNow(3, 10, mode)
      expect([at7.hour, at5.hour, at11.hour]).toEqual([7, 5, 11])
      expect(at7.price, `${mode} VII`).toBeGreaterThan(0)
      expect(at5.price, `${mode} V`).toBeLessThan(0)
      expect(at11.price, `${mode} XI`).toBeLessThan(0)
    }
  })

  it('bornes [killMin ; killMax], fenêtre de re-kill, cases d’échange forcé', () => {
    const slots = cycleSlots(1, 8, 12)
    const root = rootOf(slots, [mon(10, IKARGN)])
    const ctx = ctxOf(slots, { E })
    const r = planHours(root, ctx, plannerConfig('fast', theta))
    const prices = heuristicPrices({ result: r, root, ctx, cfg: plannerConfig('fast', theta), theta, me: P1 })
    for (const v of prices.kill.get(10)!.subarray(1)) {
      expect(v).toBeGreaterThanOrEqual(theta.vortex.killMin)
      expect(v).toBeLessThanOrEqual(theta.vortex.killMax)
    }
    // P1 revoit I trois tours plus tard : fenêtre de re-kill ; sans tueur autorisé, non.
    expect(reKillWindow(ctx, plannerConfig('fast', theta), root.monsters[0], bit(1))).toBe(true)
    expect(reKillWindow({ ...ctx, canContract: () => false }, plannerConfig('fast', theta), root.monsters[0], bit(1))).toBe(false)
    // L'horloge arrive sur IV puis VII avant le prochain tour de P1 : 292 et 484 pénalisées.
    expect(prices.cell?.[292]).toBe(-theta.vortex.swapCell)
    expect(prices.cell?.[484]).toBe(-theta.vortex.swapCell)
  })
})

// ───────────────────────────── oracle, outils, déterminisme ─────────────────────────────

describe('oracle de kill (§12.6) et outils', () => {
  it('pKill = Φ((E − PV)/(0,15·E)) ; E ×0,85 pour un créneau futur, ×0,7 sous V, 0 hors de portée maintenant', () => {
    expect(pKillOf(1000, 1000)).toBeCloseTo(0.5, 3)
    expect(pKillOf(1150, 1000)).toBeGreaterThan(0.8)
    expect(pKillOf(0, 10)).toBe(0)
    expect(pKillOf(10, 0)).toBe(1)
    const o = new KillOracle(0.2, 0.85)
    const m = mon(10, IKARGN)
    o.setDpt(P1, { id: 10 }, 4000, 0)
    o.setDpt(P1, { monsterId: MEJAIRE }, 3000)
    o.nowPlayer = P1
    o.now.set(10, { reach: true, p: 0.4 })
    expect(o.expected(0, P1, m)).toBe(4000)
    expect(o.expected(3, P1, m)).toBeCloseTo(3400)
    expect(o.expected(3, P1, { ...m, hours: bit(5) })).toBeCloseTo(3400 * 0.7)
    expect(o.expected(3, P1, mon(-31, MEJAIRE, { status: 'pending' }))).toBeCloseTo(2550)
    o.now.set(10, { reach: false, p: 0 })
    expect(o.expected(0, P1, m)).toBe(0)
    expect(o.pKillNow(m, HP)).toBe(0)
    expect(o.pKillNow(m, 100)).toBeUndefined()
  })

  it('calibration en ligne : moyenne mobile du rapport réalisé / prévu, bornée ; tour sans dégâts ignoré', () => {
    const o = new KillOracle(0.2)
    o.expect(P1, 2000, 0, 3)
    o.observe(() => ({ dealt: 1000, turns: 4 }))
    expect(o.calib.get(P1)).toBeCloseTo(0.8 * 1 + 0.2 * 0.5)
    o.expect(P1, 1000, 1000, 4)
    o.observe(() => ({ dealt: 1000, turns: 5 }))
    expect(o.calib.get(P1)).toBeCloseTo(0.9)
    o.expect(P1, 1000, 1000, 5)
    o.observe(() => ({ dealt: 9000, turns: 6 }))
    expect(o.calib.get(P1)).toBeCloseTo(0.8 * 0.9 + 0.2 * 1.3)
    const snap = o.snapshot()
    const o2 = new KillOracle(0.2)
    o2.restore(snap)
    expect(o2.calib.get(P1)).toBe(o.calib.get(P1))
  })

  it('prévision sans un joueur mort : créneaux retirés (heures décalées) ou tics virtuels', () => {
    const slots = cycleSlots(1, 2, 12)
    const without = slotsWithoutPlayer(slots, P2, false)
    expect(without.filter(s => s.fighterId === P2)).toHaveLength(0)
    expect(without.find(s => s.fighterId === P3 && s.round === 1)!.hour).toBe(2)
    const ticks = slotsWithoutPlayer(slots, P2, true)
    expect(ticks.filter(s => s.fighterId === P2).every(s => s.index === -1)).toBe(true)
    expect(ticks.find(s => s.fighterId === P3 && s.round === 1)!.hour).toBe(3)
  })

  it('déterminisme et contrat du plan : même entrée ⇒ même plan ; contrats, alternatives, scores racine', () => {
    const slots = cycleSlots(1, 9, 12)
    const root = rootOf(slots, [mon(10, IKARGN), mon(11, MEJAIRE, { hours: bit(3), hp: 2000 }), mon(12, HARPILLE)])
    const ctx = ctxOf(slots, { E: { [P1]: 4000, [P2]: 9000, [P3]: 9000, [P4]: 5000 }, glyphsNow: 1 })
    const cfg = plannerConfig('standard', theta)
    const a = planHours(root, ctx, cfg, { version: 3 })
    const b = planHours(root, ctx, cfg, { version: 3 })
    expect(JSON.stringify(a.plan.steps)).toBe(JSON.stringify(b.plan.steps))
    expect([...a.rootScores]).toEqual([...b.rootScores])
    expect(a.plan.version).toBe(3)
    expect(a.plan.rootScores.has('none')).toBe(true)
    expect(a.plan.alternatives.length).toBeGreaterThan(0)
    expect(a.plan.etaAllCorrupted).toBeGreaterThanOrEqual(1)
    for (const c of a.plan.contracts) {
      expect(c.pKill).toBeGreaterThanOrEqual(0)
      expect(c.pKill).toBeLessThanOrEqual(1)
      expect([P1, P2, P3, P4]).toContain(c.killer)
    }
    // Le pas racine est celui du joueur du créneau courant ; les heures des pas suivent l'horloge.
    expect(a.plan.steps[0]).toMatchObject({ round: 1, index: 0, fighterId: P1 })
    // Racine imposée (relances du SearchPricer).
    const forced = planHours(root, ctx, cfg, { forceRoot: { t: 'glyph', count: 1 } })
    expect(forced.plan.steps[0].action).toEqual({ t: 'glyph', count: 1 })
    expect(forced.rootScores.size).toBe(1)
  })

  it('mode : faisceau, horizon, morts par créneau dérivés de θ.planner (fast < standard < deep)', () => {
    const f = plannerConfig('fast', theta)
    const s = plannerConfig('standard', theta)
    const d = plannerConfig('deep', theta)
    expect([f.beamWidth, s.beamWidth, d.beamWidth]).toEqual([4, 16, 48])
    expect([f.horizonPlayerSlots, s.horizonPlayerSlots, d.horizonPlayerSlots]).toEqual([8, 12, 20])
    expect([f.maxKillsPerSlot, s.maxKillsPerSlot]).toEqual([1, 2])
    expect(plannerConfig('standard', loadTheta({ planner: { beamWidth: 32 } })).beamWidth).toBe(32)
    expect(C_VX_FALLBACK[7]).toBe(0)
  })
})
