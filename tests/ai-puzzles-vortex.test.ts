/**
 * Puzzles tactiques de l'Œil de Vortex (docs/design/ai.md §16.4) — WP2, avec le VRAI modèle du scénario (WP3,
 * `createVortexAIModel` : planificateur d'heures, prix, indices) sur la vraie salle, l'équipe méta des guides (presets et
 * stuffs réels de WP4) et le vrai moteur (horloge, étoiles, glyphes, résurrections). Le combat est avancé jusqu'au tour
 * voulu sans actions (les monstres passent), puis la scène est ajustée (cases, PV) comme dans les puzzles génériques.
 * Chaque puzzle vérifie l'effet du plan choisi en le rejouant sur un clone (jets moyens, et jets extrêmes quand le
 * puzzle porte sur l'aléa).
 *
 *  P4  monstre neuf tuable à V, kill à VI mieux payé      → pré-dégâts jusqu'à la bande de PV, pas de kill
 *  P5  monstre étoilé tuable par le tueur prévu            → il l'achève dans sa fenêtre (corruption)
 *  P6  contrat de corruption à une heure près, glyphe à 2 PM → chemin par la glyphe (+1 heure) PUIS kill sous étoile ;
 *      ablation : sans la tactique `glyphClock`, corruption manquée et plan moins bien évalué
 *  P7  fin de tour juste avant le créneau du Vortex        → l'allié ne finit pas sur la croix de l'Auroraire prévue
 *  P12 Vortex vulnérable, kill d'équipe possible avant son tour (alliés placés à portée, PV = 35 % de leur potentiel)
 *      → la séquence des alliés le tue avant qu'il ne joue, à au moins deux
 *  P14 cible interdite (kill à −3000) à 10 % PV, zone du Crâ → la cible survit ; la voisine (kill payé) est frappée
 *      (dans les deux modes depuis la ligne de kill de `fast`, tuning-log tour 2)
 *  P16 corruption : 2 sorts sûrs contre 1 sort incertain   → les 2 sorts sûrs (le plan tue même en jets minimaux)
 *  P17 monstre étoilé à deux lancers, à 4 cases            → corrompu dans sa fenêtre (ligne de kill en `fast` ; prix
 *      de l'étoile positif en `standard` : la référence « sans tuer m » du `SearchPricer` exclut les morts improbables)
 *  P18 monstre neuf à 900 PV à 3 cases, kill bien payé à l'heure courante                → marqué (sans indice « kill
 *      payé » hors contrat : essai KH retiré à la vérification du tour 2)
 *
 * Prix : P4, P5 (fast), P7 et P12 utilisent les prix publiés par le modèle. Là où le puzzle suppose une décision
 * stratégique donnée (contrat de corruption de P5 et P16 en `standard`, contrat « glyphe puis kill » de P6, interdiction
 * de P14), le modèle est enveloppé : ses prix sont ceux de l'`HeuristicPricer` (P5, P16 en standard — le
 * `SearchPricer` peut préférer un autre tueur) ou le contrat est imposé par-dessus ses prix (P6, P14). Le choix du
 * contrat relève du planificateur (WP3, tests PL*) ; le puzzle vérifie que la couche tactique (WP2) l'exécute.
 */
import { describe, expect, it } from 'vitest'
import { defaultAIConfig, loadTheta, type AIMode } from '../src/ai'
import { createMonsterBrain } from '../src/ai/monster/brain'
import { createPerception, createView, type PerceptionX } from '../src/ai/core'
import { createTeamController } from '../src/ai/team/controller'
import type { Blackboard } from '../src/ai/types'
import { IKARGN, STATE, VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'

const CORRUPTED_STATE = STATE.CORRUPTED
import {
  currentHour, deathHours, forecastHours, hasStar, isWaveMonster, lineCells, nextVortexSlot,
} from '../src/dungeons/vortex/clock'
import { createPhase2Fight } from '../src/dungeons/vortex/micro'
import { createVortexAIModel, type VortexAIModel } from '../src/dungeons/vortex/model'
import { patchVortexState, vortexState } from '../src/dungeons/vortex/params'
import { vortexVulnerableAt } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import type { CandidateHint, ScenarioAIModel } from '../src/dungeons/types'
import { createEngine, type Engine } from '../src/engine'
import type { Fighter, FightState } from '../src/engine/types'
import { distance, neighborsOf } from '../src/map/geometry'
import { buildTeam } from '../src/optimizer/runner'
import { parseTeam } from '../src/optimizer/team/presets'
import { applyMacro } from '../src/ai/core'
import type { MacroAction } from '../src/ai/types'
import { data, yieldToEventLoop } from './ai-core-helpers'
import { castsOf, decide, finalCell, type Scene } from './ai-puzzles-helpers'

const THETA = loadTheta()
/** Équipe méta des guides : ordre de jeu (graine 5) Ikargn > Crâ > Méjaire > Eniripsa > Harpille > Enutrof > Vortex > Auroraire > Iop. */
const META = 'cra_feu_zone,enutrof_retrait_pm_eau,iop_terre_burst,eniripsa_soin_feu'
const MODES: AIMode[] = ['fast', 'standard']

interface VxScene {
  engine: Engine
  fight: FightState
  cra: Fighter
  enu: Fighter
  iop: Fighter
  eni: Fighter
  ika: Fighter
  /** Avance (sans actions) jusqu'au tour de `f` au tour de jeu `round`. */
  turnOf(f: Fighter, round: number): void
  /** Scène des aides de puzzles (combattant courant `me`). */
  as(me: Fighter): Scene
  free(c: number): boolean
  /** Cases libres à distance exacte `d` de `c` (ordre des cases). */
  ring(c: number, d: number): number[]
}

function vortexScene(seed = 5): VxScene {
  const engine = createEngine(data, vortexHooks)
  const players = buildTeam(data, parseTeam(META, data))
  const fight = createVortexFight(engine, players, { params: VORTEX_DEFAULT_PARAMS, seed, rollMode: 'random', record: false, rngRekey: 'perTurn' })
  const [cra, enu, iop, eni] = players
  const ika = fight.fighters.find(f => f.monsterId === IKARGN)!
  const free = (c: number): boolean =>
    c >= 0 && !!fight.map.cells[c]?.walkable && !fight.fighters.some(f => f.alive && f.cell === c && f.carriedBy === undefined)
  return {
    engine, fight, cra, enu, iop, eni, ika, free,
    turnOf(f, round) {
      for (let i = 0; i < 4000; i++) {
        const cur = engine.current(fight)
        if (cur && cur.id === f.id && fight.round >= round && fight.round > 0) return
        if (cur && fight.round > 0 && cur.alive) engine.endTurn(fight, cur)
        if (!engine.nextTurn(fight)) break
      }
      throw new Error(`tour ${round} de ${f.name} jamais atteint`)
    },
    as(me) {
      return { engine, fight, me, get: (name: string) => fight.fighters.find(x => x.name === name)! }
    },
    ring(c, d) {
      const out: number[] = []
      for (let i = 0; i < fight.map.cells.length; i++) if (distance(i, c) === d && free(i)) out.push(i)
      return out
    },
  }
}

/** Rejoue un plan sur un clone (jets `rollMode`). */
function play(sc: VxScene, me: Fighter, actions: readonly MacroAction[], rollMode: 'average' | 'min' | 'max'): FightState {
  const s = sc.engine.cloneFight(sc.fight, false)
  s.options.rollMode = rollMode
  for (const m of actions) {
    if (s.ended || !applyMacro(sc.engine, s, me.id, m)) break
  }
  return s
}

function vortexModel(theta = THETA): VortexAIModel {
  return createVortexAIModel(VORTEX_DEFAULT_PARAMS, theta)
}

/**
 * θ des coûts d'heures à l'échelle 1 (design) : P4 suppose qu'une PREMIÈRE mort à V coûte. Avec le θ par défaut
 * (`planner.hourCostScale` 0,4 depuis le réglage du tour 1, docs/tuning-log.md), un marquage planifié est payé à
 * toutes les heures et la prémisse du puzzle ne tient plus ; le puzzle vérifie la réponse TACTIQUE à un prix négatif.
 */
const DESIGN_HOUR_COSTS = loadTheta({ planner: { hourCostScale: 1 } })

/** Modèle du Vortex dont les prix sont ceux de l'`HeuristicPricer` quel que soit le mode (contrats du plan glouton). */
function heuristicPricing(base: VortexAIModel): ScenarioAIModel {
  const m = Object.create(base) as VortexAIModel
  m.update = (view, bb, p) => base.update(view, bb, p, 'fast')
  return m
}

/** Modèle du Vortex avec un contrat imposé par-dessus ses prix (`edit`) et des indices supplémentaires. */
function withContract(base: VortexAIModel, edit: (bb: Blackboard) => void, hints: CandidateHint[] = []): ScenarioAIModel {
  const m = Object.create(base) as VortexAIModel
  m.update = (view, bb, p, mode) => {
    base.update(view, bb, p, mode)
    edit(bb)
  }
  if (hints.length) m.hints = (view, me, bb) => [...base.hints(view, me, bb).filter(h => h.kind !== 'kill'), ...hints]
  return m
}

/** Monstre placé au contact de `me` (case libre voisine), PV fixés. */
function bring(sc: VxScene, m: Fighter, me: Fighter, hp: number): void {
  const c = neighborsOf(me.cell).find(sc.free)
  if (c === undefined) throw new Error('aucune case libre au contact')
  m.cell = c
  m.hp = hp
}

describe('puzzles du Vortex (modèle WP3 réel)', () => {
  for (const mode of MODES) {
    it(`P4 (${mode}) : monstre neuf tuable à V, kill plus tard mieux payé — pré-dégâts, pas de kill`, () => {
      const sc = vortexScene()
      sc.turnOf(sc.cra, 2)
      const hour = currentHour(sc.fight)
      expect(hour).toBe(5)
      const target = sc.fight.fighters.find(f => isWaveMonster(f) && f.alive && deathHours(f) === 0 && f.monsterId !== IKARGN)!
      bring(sc, target, sc.cra, 2500)
      const d = decide(sc.as(sc.cra), mode, { scenario: vortexModel(DESIGN_HOUR_COSTS), seed: 5 })
      const row = d.ctx.bb.prices.kill.get(target.id)!
      // Hypothèses du puzzle (prix du modèle) : tuer à V coûte, tuer à VI rapporte.
      expect(row[hour]).toBeLessThan(0)
      expect(row[hour + 1]).toBeGreaterThan(0)
      for (const rm of ['average', 'max'] as const) {
        const s = play(sc, sc.cra, d.plan.actions, rm)
        expect(s.fighters[target.id].alive, `${rm} : ${d.plan.actions.map(a => a.key).join(' | ')}`).toBe(true)
      }
      // Pré-dégâts jusqu'à la bande de PV publiée (si elle est sous les PV actuels).
      const band = d.ctx.bb.prices.hp.get(target.id)
      if (band?.bandMax !== undefined && band.bandBonus && band.bandMax < 2500) {
        expect(play(sc, sc.cra, d.plan.actions, 'average').fighters[target.id].hp).toBeLessThanOrEqual(band.bandMax)
      }
    }, 120_000)

    it(`P5 (${mode}) : monstre étoilé tuable par le tueur prévu — corrompu dans sa fenêtre`, () => {
      const sc = vortexScene()
      sc.turnOf(sc.cra, 1)
      sc.engine.kill(sc.fight, sc.ika, sc.cra) // mort à I : étoile au prochain I (tour 4 du Crâ)
      sc.turnOf(sc.cra, 4)
      expect(currentHour(sc.fight)).toBe(1)
      expect(sc.ika.alive && hasStar(sc.ika)).toBe(true)
      bring(sc, sc.ika, sc.cra, 700)
      const model = vortexModel()
      const d = decide(sc.as(sc.cra), mode, { scenario: mode === 'fast' ? model : heuristicPricing(model), seed: 5 })
      expect(d.ctx.bb.prices.kill.get(sc.ika.id)![0]).toBeGreaterThan(0)
      const s = play(sc, sc.cra, d.plan.actions, 'average')
      const ika = s.fighters[sc.ika.id]
      expect(ika.alive, d.plan.actions.map(a => a.key).join(' | ')).toBe(false)
      expect(hasStar(ika)).toBe(true) // mort sous l'étoile = corruption à la résurrection
    }, 120_000)

    it(`P17 (${mode}) : monstre étoilé à deux lancers, à distance — corrompu (pas de kill remis à plus tard)`, () => {
      const sc = vortexScene()
      sc.turnOf(sc.cra, 1)
      sc.engine.kill(sc.fight, sc.ika, sc.cra) // mort à I : étoile au prochain I (tour 4 du Crâ)
      sc.turnOf(sc.cra, 4)
      expect(sc.ika.alive && hasStar(sc.ika)).toBe(true)
      // À 4 cases du Crâ, PV au-delà d'un seul lancer : il faut enchaîner deux tirs dans la fenêtre de l'étoile. En `fast`
      // (largeur 1), le terme `continuation` créditait déjà le kill encore faisable : le faisceau glouton jouait d'abord
      // d'autres coups puis n'avait plus les PA (tuning-log, tour 2 : ligne de kill).
      sc.ika.cell = sc.ring(sc.cra.cell, 4)[0]
      sc.ika.hp = 1500
      const d = decide(sc.as(sc.cra), mode, { scenario: vortexModel(), seed: 5 })
      const keys = d.plan.actions.map(a => a.key).join(' | ')
      // Prix de l'étoile positif dans les deux pricers (le `SearchPricer` le mettait à −3 000 : il comparait la
      // corruption au meurtre « supposé réalisé » d'un monstre neuf à 6 600 PV), d'où l'indice `kill`.
      expect(d.ctx.bb.prices.kill.get(sc.ika.id)![0], keys).toBeGreaterThan(0)
      expect(d.ctx.hints?.some(h => h.kind === 'kill' && h.targetId === sc.ika.id), keys).toBe(true)
      const s = play(sc, sc.cra, d.plan.actions, 'average')
      const ika = s.fighters[sc.ika.id]
      expect(ika.alive, keys).toBe(false)
      expect(hasStar(ika), keys).toBe(true)
      expect(castsOf(d.plan.actions).length, keys).toBeGreaterThanOrEqual(2)
    }, 120_000)

    it(`P18 (${mode}) : monstre neuf à portée de kill, bien payé à l'heure courante — marqué`, () => {
      const sc = vortexScene()
      sc.turnOf(sc.cra, 3)
      const hour = currentHour(sc.fight)
      const target = sc.fight.fighters.find(f => isWaveMonster(f) && f.alive && deathHours(f) === 0 && f.monsterId !== IKARGN)!
      target.cell = sc.ring(sc.cra.cell, 3)[0]
      target.hp = 900
      const d = decide(sc.as(sc.cra), mode, { scenario: vortexModel(), seed: 5 })
      const keys = d.plan.actions.map(a => a.key).join(' | ')
      const price = d.ctx.bb.prices.kill.get(target.id)![hour]
      console.info(`[P18 ${mode}] heure ${hour}, prix ${price} ; indices ${JSON.stringify(d.ctx.hints?.filter(h => h.kind === 'kill'))} ; plan ${keys}`)
      // Prémisse : le kill à l'heure courante est bien payé. L'indice `kill` hors contrat (essai KH) n'est plus exigé : il
      // a été retiré à la vérification du tour 2 (négatif sur 64 graines inédites) ; le kill se fait sans lui.
      expect(price).toBeGreaterThanOrEqual(1000)
      const s = play(sc, sc.cra, d.plan.actions, 'average')
      expect(s.fighters[target.id].alive, keys).toBe(false)
    }, 120_000)

    // Tour 4 du réglage : depuis la règle 2.42 « ressuscités à −1 PM », le faisceau `fast` (largeur 3) écartait la
    // séquence « glyphe puis kill » (et le plafond θ.tactics.maxPerNode ne laissait que « kill puis glyphe ») ; la ligne
    // de kill PAR UNE GLYPHE (`glyphKillLine`, turnSearch.ts) la retrouve.
    it(`P6 (${mode}) : contrat de corruption à une heure près — glyphe (+1 heure) puis kill sous étoile`, () => {
      const sc = vortexScene()
      sc.turnOf(sc.cra, 1)
      sc.engine.kill(sc.fight, sc.ika, sc.cra) // heure de mort I
      sc.turnOf(sc.iop, 3) // XII : l'étoile de l'Ikargn n'apparaît qu'à I
      expect(currentHour(sc.fight)).toBe(12)
      expect(sc.ika.alive && !hasStar(sc.ika)).toBe(true)
      // Glyphe d'un autre monstre de vague, son poseur écarté de 2 cases, l'Ikargn (fragile) au contact du poseur ;
      // le Iop à 2 cases de la glyphe et à plus de 2 cases de l'Ikargn.
      const g = sc.fight.glyphs.find(x => x.castSpellId === 5011 && x.sourceId !== sc.ika.id && sc.fight.fighters[x.sourceId]?.alive)!
      const owner = sc.fight.fighters[g.sourceId]
      const offGlyph = (c: number) => !sc.fight.glyphs.some(x => x.cells.includes(c))
      owner.cell = sc.ring(g.center, 2).filter(offGlyph)[0]
      sc.ika.cell = sc.ring(owner.cell, 1).filter(offGlyph)[0]
      sc.ika.hp = 300
      sc.iop.cell = sc.ring(g.center, 2).filter(c => offGlyph(c) && distance(c, sc.ika.cell) > 2)[0]
      const ika = sc.ika.id
      const model = withContract(vortexModel(), bb => {
        bb.prices.clock = [0, 1500, -2000]
        const row = bb.prices.kill.get(ika)
        if (row) {
          row[0] = 4000
          row[12] = -3000
        }
      }, [{ kind: 'kill', targetId: ika, weight: 4000 }])
      const d = decide(sc.as(sc.iop), mode, { scenario: model, seed: 5 })
      expect(d.ctx.hints?.some(h => h.kind === 'glyph')).toBe(true)
      const s = play(sc, sc.iop, d.plan.actions, 'average')
      const keys = d.plan.actions.map(a => a.key).join(' | ')
      expect(currentHour(s), keys).toBe(1)
      expect(s.fighters[ika].alive, keys).toBe(false)
      expect(hasStar(s.fighters[ika]), keys).toBe(true)
      expect(d.plan.actions.some(a => a.tactic === 'glyphClock'), keys).toBe(true)
      // Ablation (§16.4) : sans `glyphClock`, la corruption est manquée et le plan vaut moins.
      const off = decide(sc.as(sc.iop), mode, { scenario: model, seed: 5, disabledTactics: new Set(['glyphClock']) })
      const s2 = play(sc, sc.iop, off.plan.actions, 'average')
      console.info(`[P6 ${mode}] glyphClock : avec ${d.plan.value.toFixed(0)} (${keys}) ; sans ${off.plan.value.toFixed(0)} (${off.plan.actions.map(a => a.key).join(' | ')}) ; corrompu sans : ${!s2.fighters[ika].alive && hasStar(s2.fighters[ika])}`)
      expect(off.plan.value).toBeLessThan(d.plan.value)
      expect(!s2.fighters[ika].alive && hasStar(s2.fighters[ika])).toBe(false)
    }, 120_000)

    it(`P7 (${mode}) : dernier allié avant le Vortex — ne finit pas sur la croix prévue de l'Auroraire`, () => {
      const sc = vortexScene()
      sc.turnOf(sc.enu, 2)
      expect(vortexState(sc.fight)!.vortexTurns).toBeGreaterThanOrEqual(1)
      const slots = forecastHours(sc.fight, 2, VORTEX_DEFAULT_PARAMS)
      const vi = nextVortexSlot(slots, 1)
      expect(vi).toBeGreaterThan(0)
      expect(slots.slice(1, vi).some(x => x.fighterId === sc.enu.id)).toBe(false)
      const line = new Set(lineCells(slots[vi].hour))
      const start = [...line].find(c => sc.free(c) && distance(c, sc.enu.cell) < 8)!
      sc.enu.cell = start
      const d = decide(sc.as(sc.enu), mode, { scenario: vortexModel(), seed: 5 })
      expect(d.ctx.hints?.some(h => h.kind === 'avoidCells')).toBe(true)
      const end = finalCell(d.plan.actions, start)
      expect(line.has(end), `${d.plan.actions.map(a => a.key).join(' | ')} → ${end}`).toBe(false)
    }, 120_000)

    it(`P14 (${mode}) : cible interdite à 10 % PV près d'une cible payée — la zone l'épargne`, () => {
      const sc = vortexScene()
      sc.turnOf(sc.cra, 2)
      const hour = currentHour(sc.fight)
      const waves = sc.fight.fighters.filter(f => isWaveMonster(f) && f.alive && !f.states.includes(56))
      const target = sc.ika
      const other = waves.find(m => m !== target)!
      target.cell = sc.ring(sc.cra.cell, 4)[0]
      target.hp = Math.round(0.1 * target.maxHp)
      other.cell = sc.ring(target.cell, 1).find(c => distance(c, sc.cra.cell) >= 4)!
      other.hp = 400
      const model = withContract(vortexModel(), bb => {
        bb.prices.kill.get(target.id)![hour] = -3000
        bb.prices.kill.get(other.id)![hour] = 2500
      }, [{ kind: 'kill', targetId: other.id, weight: 2500 }])
      const d = decide(sc.as(sc.cra), mode, { scenario: model, seed: 5 })
      const keys = d.plan.actions.map(a => a.key).join(' | ')
      for (const rm of ['average', 'max'] as const) {
        const s = play(sc, sc.cra, d.plan.actions, rm)
        expect(s.fighters[target.id].alive, `${rm} : ${keys}`).toBe(true)
        // Les deux modes : en `fast` (glouton, largeur 1), la ligne de kill (indice `kill` du contrat) enchaîne les deux
        // lancers du kill payé — avant elle, il ouvrait par une Balise Tactique et ne le voyait pas (tuning-log, tour 2).
        expect(s.fighters[other.id].hp, `${rm} : ${keys}`).toBeLessThan(400)
      }
    }, 120_000)
  }

  // Tour 4 du réglage : combat bloqué 30 tours à 18 / 19 corrompus (graine 2750401650) — le dernier zombie n'avait qu'une
  // heure de mort, vue par un seul personnage qui ne l'achevait jamais ; ses alliés ne le tuaient pas à une autre heure
  // (coût d'heure du planificateur).
  it('P19 (fast) : fin de partie — dernier zombie tué à une heure NOUVELLE (plus de fenêtres d\'étoile)', () => {
    const sc = vortexScene()
    sc.turnOf(sc.cra, 1)
    sc.engine.kill(sc.fight, sc.ika, sc.cra) // heure de mort I
    sc.turnOf(sc.cra, 2)
    const hour = currentHour(sc.fight)
    expect(hour).toBe(5)
    expect(sc.ika.alive && deathHours(sc.ika) === 1).toBe(true)
    // Fin de partie simulée : toutes les vagues arrivées, les autres monstres de vague corrompus.
    const vx = vortexState(sc.fight)!
    patchVortexState(sc.fight, { wavesSpawned: vx.arrivalRounds.length })
    for (const f of sc.fight.fighters) if (isWaveMonster(f) && f.id !== sc.ika.id && !f.states.includes(CORRUPTED_STATE)) f.states.push(CORRUPTED_STATE)
    bring(sc, sc.ika, sc.cra, 500)
    const model = vortexModel()
    const d = decide(sc.as(sc.cra), 'fast', { scenario: model, seed: 5 })
    const keys = d.plan.actions.map(a => a.key).join(' | ')
    expect(d.ctx.hints?.some(h => h.kind === 'kill' && h.targetId === sc.ika.id), keys).toBe(true)
    const s = play(sc, sc.cra, d.plan.actions, 'average')
    const ika = s.fighters[sc.ika.id]
    expect(ika.alive, keys).toBe(false)
    expect(deathHours(ika) & (1 << (hour - 1))).not.toBe(0) // nouvelle heure V : nouvelles fenêtres d'étoile
  }, 120_000)

  it('P16 (standard) : corruption — deux sorts sûrs plutôt qu\'un sort qui ne tue que sur coup critique', () => {
    const sc = vortexScene()
    sc.turnOf(sc.cra, 1)
    sc.engine.kill(sc.fight, sc.ika, sc.cra)
    sc.turnOf(sc.cra, 4)
    expect(hasStar(sc.ika)).toBe(true)
    // Crâ à 5 PA, quatre sorts : Flèches Enflammées (4 PA) et Flèche Tyrannique (4 PA) ne tuent 800 PV que sur
    // critique (≈ 73 % et 44 % ici) ; Flèche Détonante (2 PA) + Flèche Éclatante (3 PA) tuent à coup sûr.
    sc.cra.spells = sc.cra.spells.filter(sp => [32447, 32448, 32444, 32449].includes(sp.spellId))
    sc.cra.ap = 5
    sc.ika.cell = sc.ring(sc.cra.cell, 3)[0]
    sc.ika.hp = 800
    const d = decide(sc.as(sc.cra), 'standard', { scenario: heuristicPricing(vortexModel()), seed: 5 })
    const keys = d.plan.actions.map(a => a.key).join(' | ')
    const spells = castsOf(d.plan.actions).map(c => c.spellId)
    expect(spells, keys).toEqual(expect.arrayContaining([32444, 32449]))
    const s = play(sc, sc.cra, d.plan.actions, 'min')
    expect(s.fighters[sc.ika.id].alive, keys).toBe(false)
    expect(hasStar(s.fighters[sc.ika.id])).toBe(true)
  }, 120_000)

  for (const mode of MODES) it(`P12 (${mode}) : Vortex vulnérable, kill d'équipe possible avant son tour — la séquence des alliés le tue`, async () => {
    const engine = createEngine(data, vortexHooks)
    const players = buildTeam(data, parseTeam(META, data))
    const fight = createPhase2Fight(engine, players, {
      params: { ...VORTEX_DEFAULT_PARAMS, phase2Hours: [2, 7, 10] }, seed: 3, rollMode: 'random', record: false, rngRekey: 'perTurn',
    })
    const vortex = fight.fighters[vortexState(fight)!.vortexId]
    const cfg = defaultAIConfig(mode, 3)
    const tc = createTeamController(cfg, vortexModel())
    const monsters = createMonsterBrain(cfg, 'play')
    let armed = false
    const hitters = new Set<number>()
    let vortexPlayed = false
    for (let t = 0; t < 80 && !fight.ended; t++) {
      const f = engine.nextTurn(fight)
      if (!f) break
      if (armed && f.id === vortex.id) {
        vortexPlayed = true
        break
      }
      if (!armed && f.team === 0 && vortexVulnerableAt(fight, vortex, 0)) {
        // Mise en scène : les alliés qui jouent avant le Vortex sont placés à 3-6 cases de lui (le kill d'équipe est
        // possible) ; PV du Vortex = 35 % de leur potentiel (DPT calibré) : il faut au moins deux contributeurs.
        const p = createPerception(createView(engine, fight, f, 1)) as PerceptionX
        const before = players.filter(a => a.alive && (a.id === f.id || p.threat.order.before(a.id, vortex.id)))
        const taken = new Set<number>()
        for (const a of before) {
          let cell = -1
          for (let d = 3; d <= 6 && cell < 0; d++) {
            for (let c = 0; c < fight.map.cells.length && cell < 0; c++) {
              if (distance(c, vortex.cell) !== d || taken.has(c) || !fight.map.cells[c]?.walkable) continue
              if (fight.fighters.some(x => x.alive && x.cell === c)) continue
              if (fight.glyphs.some(g => g.cells.includes(c)) || fight.traps.some(t => t.cells.includes(c))) continue
              cell = c
            }
          }
          if (cell >= 0) {
            a.cell = cell
            taken.add(cell)
          }
        }
        let pot = 0
        let best = 0
        for (const a of before) {
          const x = p.dpt.dpt(a, vortex) * p.dpt.calibration(a)
          pot += x
          best = Math.max(best, x)
        }
        vortex.hp = Math.max(1, Math.round(Math.max(0.35 * pot, 1.1 * best)))
        armed = true
      }
      const hp0 = vortex.hp
      if (f.team === 0) tc.playTurn(engine, fight, f)
      else if (f.alive && f.stats.ap > 0) monsters.playTurn(engine, fight, f)
      if (armed && f.team === 0 && vortex.hp < hp0) hitters.add(f.id)
      if (!fight.ended && f.alive) engine.endTurn(fight, f)
      await yieldToEventLoop()
    }
    expect(armed).toBe(true)
    expect(vortex.alive).toBe(false)
    expect(vortexPlayed).toBe(false)
    expect(hitters.size).toBeGreaterThanOrEqual(2)
  }, 300_000)
})
