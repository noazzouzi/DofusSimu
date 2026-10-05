/**
 * Aides des puzzles tactiques (docs/design/ai.md §16.4, tests/ai-puzzles-*.test.ts) — WP2 : scènes construites sur de
 * vraies cartes (repère logique x, y), vrais sorts de classes, vrais monstres ; ordre de jeu imposé (le premier de
 * `order` joue maintenant) ; décision du `TeamController` sans exécution (`decide`) ou exécution dans un clone.
 */
import { defaultAIConfig, type AIMode } from '../src/ai'
import { createTeamController, type Decision, type TeamOptions } from '../src/ai/team/controller'
import type { ScenarioAIModel } from '../src/dungeons/types'
import { createEngine, type Engine } from '../src/engine'
import { castSubSpell } from '../src/engine/effects/core'
import type { Fighter, FightState } from '../src/engine/types'
import { isValidPoint, pointToCell } from '../src/map/geometry'
import { applyMacro } from '../src/ai/core'
import { toActions, type MacroAction } from '../src/ai/types'
import { data, mapOf, monster, player, THL } from './ai-core-helpers'

export { data, monster, player, THL }

/** « Cour du Bouftou Royal », 1re salle : grande zone ouverte (x ≈ 13-26, y ≈ −12..4) avec quelques obstacles. */
export const OPEN_MAP = 121373185

/** Case d'une position logique (x, y) ; erreur si invalide ou non marchable sur `mapId`. */
export function at(x: number, y: number, mapId = OPEN_MAP): number {
  if (!isValidPoint(x, y)) throw new Error(`point (${x}, ${y}) hors carte`)
  const c = pointToCell(x, y)
  const mc = mapOf(mapId).cells[c]
  if (!mc || !mc.walkable) throw new Error(`case (${x}, ${y}) = ${c} non marchable sur ${mapId}`)
  return c
}

export interface Scene {
  engine: Engine
  fight: FightState
  me: Fighter
  /** Combattant par nom (dans le combat). */
  get(name: string): Fighter
}

export interface SceneSpec {
  mapId?: number
  fighters: Fighter[]
  /** Ordre de jeu (noms) ; le premier joue maintenant. Les absents sont ajoutés ensuite (ordre de création). */
  order: string[]
  seed?: number
  /** Préparation du combat avant le premier tour (états, poisons…). */
  setup?: (engine: Engine, fight: FightState, get: (name: string) => Fighter) => void
  engine?: Engine
}

/** Combat démarré au tour du premier combattant de `order` (round 1). */
export function scene(spec: SceneSpec): Scene {
  const engine = spec.engine ?? createEngine(data)
  const fight = engine.createFight({
    map: mapOf(spec.mapId ?? OPEN_MAP),
    fighters: spec.fighters,
    options: { seed: spec.seed ?? 7, rollMode: 'random', record: false, maxRounds: 60, rngRekey: 'perTurn' },
  })
  const get = (name: string): Fighter => {
    const f = fight.fighters.find(x => x.name === name)
    if (!f) throw new Error(`combattant « ${name} » introuvable`)
    return f
  }
  const ids = spec.order.map(n => get(n).id)
  for (const f of fight.fighters) if (!ids.includes(f.id)) ids.push(f.id)
  fight.timeline = ids
  spec.setup?.(engine, fight, get)
  const me = engine.nextTurn(fight)!
  if (me.id !== ids[0]) throw new Error(`le tour commence par ${me.name}, attendu ${spec.order[0]}`)
  return { engine, fight, me, get }
}

/** Pose la posture Sobre du Pandawa (état 3531, sort 24037 : posture par défaut du jeu, non posée par le moteur). */
export function sober(engine: Engine, fight: FightState, f: Fighter): void {
  castSubSpell(engine, fight, f, 24037, 1, f.cell, false, 0)
}

/** Décision du `TeamController` pour le combattant courant (aucune action exécutée). */
export function decide(sc: Scene, mode: AIMode, opts: TeamOptions & { scenario?: ScenarioAIModel; seed?: number } = {}): Decision {
  const cfg = defaultAIConfig(mode, opts.seed ?? 11)
  const tc = createTeamController(cfg, opts.scenario, opts)
  const d = tc.decide(sc.engine, sc.fight, sc.me)
  if (!d) throw new Error('aucune décision')
  return d
}

/** Lancers d'un plan (séquences aplaties), dans l'ordre. */
export function castsOf(actions: readonly MacroAction[]): { spellId: number; cell: number }[] {
  const out: { spellId: number; cell: number }[] = []
  for (const m of actions) for (const a of toActions(m)) if (a.type === 'cast') out.push({ spellId: a.spellId, cell: a.cell })
  return out
}

/** Case finale du combattant après un plan (dernier déplacement), `start` sinon. */
export function finalCell(actions: readonly MacroAction[], start: number): number {
  let c = start
  for (const m of actions) for (const a of toActions(m)) if (a.type === 'move') c = a.path[a.path.length - 1]
  return c
}

/** Joue le plan dans un clone du combat (jets moyens) et renvoie l'état obtenu. */
export function playOnClone(sc: Scene, actions: readonly MacroAction[]): FightState {
  const s = sc.engine.cloneFight(sc.fight, false)
  s.options.rollMode = 'average'
  for (const m of actions) {
    if (s.ended) break
    if (!applyMacro(sc.engine, s, sc.me.id, m)) break
  }
  return s
}

/** Noms des sorts d'un combattant (diagnostics). */
export function spellsOf(f: Fighter): Map<number, string> {
  return new Map(f.spells.map(s => [s.spellId, s.name]))
}

/** Joueur THL nommé. */
export function hero(breed: number, name: string, x: number, y: number, extra: Partial<typeof THL> = {}, variants?: (0 | 1)[], mapId = OPEN_MAP): Fighter {
  return player(breed, { cell: at(x, y, mapId), extra: { ...THL, ...extra }, name, variants })
}

/** Monstre nommé. */
export function foe(monsterId: number, name: string, x: number, y: number, grade = 5, mapId = OPEN_MAP): Fighter {
  const m = monster(monsterId, at(x, y, mapId), grade)
  m.name = name
  return m
}
