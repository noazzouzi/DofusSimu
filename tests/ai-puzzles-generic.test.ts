/**
 * Puzzles tactiques sur combats génériques (docs/design/ai.md §16.4) — WP2 : vraie carte (Cour du Bouftou Royal),
 * vrais sorts de classes (stuff THL simulé), vrais monstres de l'Œil de Vortex, `GenericModel`. Chaque puzzle affirme
 * que le plan choisi en `standard` CONTIENT l'action clé (ou en produit l'effet, vérifié en rejouant le plan sur un
 * clone en jets moyens). Un dernier test mesure le taux de réussite en `fast` (objectif du design : ≥ 60 %).
 *
 *  P1  Buboxor à 8 cases du Crâ, Enutrof 12 PA                → retrait de PM suffisant (il n'atteint plus le Crâ)
 *  P2  Ikargn à 2 cases de l'Eniripsa, Attraction prête        → l'Eniripsa finit hors du rayon 3
 *  P3  Crâ Feu, 3 monstres groupés                            → Balise Tactique PUIS Flèche Explosive
 *  P8  3 alliés blessés sous Petit poison                     → soins qui retirent le poison des 3
 *  P9  kill réservé à 8 PA, 12 PA disponibles                 → la cible meurt (les 4 PA libres ne gâchent pas le kill)
 *  P10 Pandawa, Ikargn isolé, 2 monstres groupés, Iop ensuite → porter l'Ikargn et le jeter dans le paquet
 *  P11 Méjaire alignée à 3 cases du Iop                       → le Iop quitte la ligne avant la fin de son tour
 *  P13 tank au contact de 2 monstres de mêlée                 → il reste au contact (tacle) au lieu de fuir
 *  P15 couloir unique vers le Crâ (fragile), Osamodas         → invocation sur la case d'étranglement
 *
 * Ablations (§16.4, « la tactique désactivée fait perdre de la valeur ») : `stateChain` sur P3 (fast ; en standard le
 * faisceau retrouve seul la séquence) ; `carryThrow` sur P10 (standard : sans elle, plus de portage et un plan qui vaut
 * moins). `glyphClock` : P6 (tests/ai-puzzles-vortex.test.ts). Sur P1 (`mpLock`), P8 (`healCleanse`) et P15
 * (`bodyBlock`), la recherche générique trouve le même plan avec ou sans la tactique : leurs ablations (et celles de
 * `groupForZone`, `burstSetup`) sont mesurées sur des combats complets appariés (tests/ai-team-ablation.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { createPerception, createView, nextTurnApMp, type PerceptionX } from '../src/ai/core'
import { castSubSpell } from '../src/engine/effects/core'
import type { Fighter } from '../src/engine/types'
import { distance, inLine } from '../src/map/geometry'
import type { AIMode } from '../src/ai/types'
import { BREEDS } from './ai-core-helpers'
import { at, castsOf, decide, finalCell, foe, hero, playOnClone, scene, sober, type Scene } from './ai-puzzles-helpers'

const OSAMODAS = 2

/** Les puzzles : scène + vérification (renvoie un message d'échec, '' si réussi). */
interface Puzzle {
  id: string
  build(): Scene
  check(sc: Scene, mode: AIMode): string
}

/** PM du prochain tour d'un combattant dans un état (buffs/retraits encore actifs). */
function nextMp(sc: Scene, s: ReturnType<typeof playOnClone>, f: Fighter): number {
  const view = createView(sc.engine, s, s.fighters[sc.me.id], 1)
  const p = createPerception(view) as PerceptionX
  return nextTurnApMp(s.fighters[f.id], p.threat.order).mp
}

const PUZZLES: Puzzle[] = [
  {
    id: 'P1',
    build: () => scene({ fighters: [hero(BREEDS.enutrof, 'Enu', 25, -9), hero(BREEDS.cra, 'Cra', 16, -8), foe(3838, 'Bubo', 20, -4)], order: ['Enu', 'Bubo', 'Cra'] }),
    check(sc, mode) {
      const d = decide(sc, mode)
      const bubo = sc.get('Bubo')
      const s = playOnClone(sc, d.plan.actions)
      // Hoxor (portée 1-3 en ligne) : il faut au Buboxor dist − 3 PM pour frapper le Crâ.
      const need = distance(bubo.cell, sc.get('Cra').cell) - 3
      const mp = nextMp(sc, s, bubo)
      return mp < need ? '' : `PM du Buboxor au prochain tour ${mp.toFixed(2)} ≥ ${need} (plan ${d.plan.actions.map(a => a.key).join(' | ')})`
    },
  },
  {
    id: 'P2',
    build: () => scene({ fighters: [hero(BREEDS.eniripsa, 'Eni', 20, -6), foe(3834, 'Ika', 20, -8), hero(BREEDS.iop, 'Iop', 23, 0)], order: ['Eni', 'Ika', 'Iop'] }),
    check(sc, mode) {
      const d = decide(sc, mode)
      const dist = distance(finalCell(d.plan.actions, sc.me.cell), sc.get('Ika').cell)
      return dist > 3 ? '' : `Eniripsa finit à ${dist} cases de l'Ikargn`
    },
  },
  {
    id: 'P3',
    build: () => {
      const v: (0 | 1)[] = new Array(22).fill(0)
      v[4] = 1 // Balise Tactique (variante de la paire 5)
      return scene({ fighters: [hero(BREEDS.cra, 'Cra', 18, -10, {}, v), foe(3838, 'Bubo', 21, -4), foe(3836, 'Mej', 21, -3), foe(3837, 'Harp', 22, -4)], order: ['Cra', 'Bubo', 'Mej', 'Harp'] })
    },
    check(sc, mode) {
      const d = decide(sc, mode)
      const ids = castsOf(d.plan.actions).map(c => c.spellId)
      const b = ids.indexOf(32467)
      const e = ids.indexOf(32445)
      return b >= 0 && e > b ? '' : `lancers ${ids.join(',')} (Balise 32467 puis Explosive 32445 attendus)`
    },
  },
  {
    id: 'P8',
    build: () => scene({
      fighters: [hero(BREEDS.eniripsa, 'Eni', 20, -6), hero(BREEDS.iop, 'Iop', 21, -7), hero(BREEDS.cra, 'Cra', 19, -7), foe(3837, 'Harp', 20, 2)],
      order: ['Eni', 'Harp', 'Iop', 'Cra'],
      setup: (e, f, get) => {
        castSubSpell(e, f, get('Harp'), 5021, 1, get('Harp').cell, false, 0) // Petit poison sur tous les personnages
        for (const n of ['Eni', 'Iop', 'Cra']) get(n).hp -= 1200 // les ticks déjà subis : un soin peut les purger
      },
    }),
    check(sc, mode) {
      const before = sc.fight.fighters.filter(f => f.buffs.some(b => b.spellId === 5021)).length
      if (before !== 3) return `mise en place : ${before} empoisonnés`
      const d = decide(sc, mode)
      const s = playOnClone(sc, d.plan.actions)
      const after = s.fighters.filter(f => f.alive && f.buffs.some(b => b.spellId === 5021)).map(f => f.name)
      return after.length === 0 ? '' : `encore empoisonnés : ${after.join(', ')}`
    },
  },
  {
    id: 'P9',
    build: () => scene({
      fighters: [hero(BREEDS.iop, 'Iop', 20, -7), foe(3838, 'Bubo', 20, -5), foe(3836, 'Mej', 22, -6), hero(BREEDS.cra, 'Cra', 17, -10)],
      order: ['Iop', 'Bubo', 'Mej', 'Cra'],
      setup: (e, f, get) => {
        // PV du Buboxor = 85 % des dégâts attendus d'un tour du Iop à 8 PA : le kill coûte ≈ 8 PA sur 12.
        const iop = get('Iop')
        const p = createPerception(createView(e, f, iop, 1)) as PerceptionX
        const bubo = get('Bubo')
        bubo.hp = Math.round(0.85 * p.dpt.turn(iop, bubo, 8, 'now').mean * p.dpt.calibration(iop))
      },
    }),
    check(sc, mode) {
      const d = decide(sc, mode)
      const s = playOnClone(sc, d.plan.actions)
      return s.fighters[sc.get('Bubo').id].alive ? `Buboxor survit (${s.fighters[sc.get('Bubo').id].hp} PV)` : ''
    },
  },
  {
    id: 'P10',
    build: () => scene({
      fighters: [hero(BREEDS.pandawa, 'Pan', 18, -6), foe(3834, 'Ika', 18, -7), foe(3838, 'Bubo', 21, -4), foe(3836, 'Mej', 21, -3), hero(BREEDS.iop, 'Iop', 20, -9)],
      order: ['Pan', 'Iop', 'Ika', 'Bubo', 'Mej'],
      setup: (e, f, get) => sober(e, f, get('Pan')),
    }),
    check(sc, mode) {
      const d = decide(sc, mode)
      const s = playOnClone(sc, d.plan.actions)
      const ika = s.fighters[sc.get('Ika').id]
      const group = [sc.get('Bubo'), sc.get('Mej')].map(f => s.fighters[f.id])
      const near = group.filter(g => g.alive && distance(g.cell, ika.cell) <= 2).length
      const carried = castsOf(d.plan.actions).some(c => c.cell === sc.get('Ika').cell && (c.spellId === 12787 || c.spellId === 12810))
      return carried && near >= 1 ? '' : `portage ${carried}, Ikargn à ≤ 2 cases de ${near} monstre(s) (plan ${d.plan.actions.map(a => a.key).join(' | ')})`
    },
  },
  {
    id: 'P11',
    build: () => scene({ fighters: [hero(BREEDS.iop, 'Iop', 20, -6), foe(3836, 'Mej', 20, -3), hero(BREEDS.cra, 'Cra', 17, -9)], order: ['Iop', 'Mej', 'Cra'] }),
    check(sc, mode) {
      const d = decide(sc, mode)
      const s = playOnClone(sc, d.plan.actions)
      const iop = s.fighters[sc.me.id]
      const mej = s.fighters[sc.get('Mej').id]
      if (!mej.alive) return ''
      return !inLine(iop.cell, mej.cell) || distance(iop.cell, mej.cell) > 7 ? '' : `Iop encore aligné (${distance(iop.cell, mej.cell)} cases)`
    },
  },
  {
    id: 'P13',
    build: () => {
      const sac = hero(BREEDS.sacrieur, 'Sac', 20, -6)
      sac.role = 'tank'
      return scene({ fighters: [sac, foe(3838, 'Bubo', 20, -5), foe(3834, 'Ika', 21, -6), hero(BREEDS.cra, 'Cra', 17, -10), hero(BREEDS.eniripsa, 'Eni', 22, -10)], order: ['Sac', 'Bubo', 'Ika', 'Cra', 'Eni'] })
    },
    check(sc, mode) {
      const d = decide(sc, mode)
      const f = finalCell(d.plan.actions, sc.me.cell)
      const adj = [sc.get('Bubo'), sc.get('Ika')].filter(m => distance(m.cell, f) === 1).length
      return adj >= 1 ? '' : `le tank quitte le contact (case ${f})`
    },
  },
  {
    id: 'P15',
    build: () => {
      // Mur de blocs statiques sur y = −5 (les obstacles de la carte complètent la ligne) : seule brèche (20, −5).
      const walls = [14, 15, 16, 17, 19, 22, 23, 24, 25, 26].map((x, i) => {
        const w = foe(3833, `Mur${i}`, x, -5)
        w.tags.static = true
        return w
      })
      return scene({
        fighters: [hero(OSAMODAS, 'Osa', 23, -8), hero(BREEDS.cra, 'Cra', 20, -8), foe(3838, 'Bubo', 20, -1), ...walls],
        order: ['Osa', 'Bubo', 'Cra'],
        setup: (_e, _f, get) => {
          get('Cra').hp = 600 // le Buboxor le tuerait par la brèche
        },
      })
    },
    check(sc, mode) {
      const d = decide(sc, mode)
      const s = playOnClone(sc, d.plan.actions)
      const plug = [at(20, -5), at(20, -4), at(20, -6)]
      const blocker = s.fighters.find(f => f.alive && f.team === sc.me.team && plug.includes(f.cell))
      const summoned = s.fighters.length > sc.fight.fighters.length
      return blocker && summoned ? '' : `brèche libre (invocation ${summoned}) — plan ${d.plan.actions.map(a => a.key).join(' | ')}`
    },
  },
]

describe('puzzles tactiques génériques (standard)', () => {
  for (const p of PUZZLES) {
    it(`${p.id} (standard)`, () => {
      const sc = p.build()
      expect(p.check(sc, 'standard')).toBe('')
    }, 120_000)
  }
})

describe('ablations des tactiques (§16.4)', () => {
  const byId = (id: string): Puzzle => PUZZLES.find(p => p.id === id)!
  it('P3 sans stateChain (fast) : le plan trouvé vaut moins ; en standard, le faisceau le retrouve seul (pas moins)', () => {
    const on = decide(byId('P3').build(), 'fast')
    const off = decide(byId('P3').build(), 'fast', { disabledTactics: new Set(['stateChain']) })
    expect(on.plan.actions.some(a => a.tactic === 'stateChain')).toBe(true)
    expect(off.plan.value).toBeLessThan(on.plan.value)
    // Largeur 6 : la Balise Tactique (puissance +40 par ennemi en vue) puis l'Explosive est trouvée sans la tactique.
    const onS = decide(byId('P3').build(), 'standard')
    const offS = decide(byId('P3').build(), 'standard', { disabledTactics: new Set(['stateChain']) })
    expect(offS.plan.value).toBeLessThanOrEqual(onS.plan.value + 1e-6)
  }, 120_000)

  it('P10 sans carryThrow (standard) : plus de portage de l\'Ikargn, et le plan vaut moins', () => {
    const p = byId('P10')
    const sc = p.build()
    expect(p.check(sc, 'standard')).toBe('')
    const on = decide(p.build(), 'standard')
    const off = decide(p.build(), 'standard', { disabledTactics: new Set(['carryThrow']) })
    const ika = sc.get('Ika').cell
    expect(castsOf(off.plan.actions).some(c => c.cell === ika && (c.spellId === 12787 || c.spellId === 12810))).toBe(false)
    expect(off.plan.value).toBeLessThan(on.plan.value)
  }, 120_000)
})

describe('puzzles tactiques génériques (fast) : taux de réussite suivi', () => {
  it('fast ≥ 60 % des puzzles (objectif §16.4)', () => {
    const fails: string[] = []
    for (const p of PUZZLES) {
      const msg = p.check(p.build(), 'fast')
      if (msg) fails.push(`${p.id}: ${msg}`)
    }
    const rate = 1 - fails.length / PUZZLES.length
    if (fails.length) console.info(`[puzzles fast] réussite ${(100 * rate).toFixed(0)} % ; échecs : ${fails.join(' ; ')}`)
    expect(rate).toBeGreaterThanOrEqual(0.6)
  }, 300_000)
})
