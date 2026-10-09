// Bibliothèque commune de la mission « DÉGÂTS » (Reine des Voleurs, 4 Crâs identiques) — lecture seule sur le dépôt.
//  - CRA : caractéristiques RÉELLES données par le joueur (le lien Dofusbook renvoie 403 Cloudflare : stats seules).
//  - calcSpell : calculateur analytique (même logique que `degats`, src/cli/theory.ts spellDamageReport) — lignes
//    immédiates sans condition, critique pondéré, jets entiers exacts (meanPrepared).
//  - Banc moteur : un Crâ et un monstre réel sur une carte ouverte, mode de jet 'average' (critique pondéré), le monstre
//    ne joue pas ; on lance un PLAN de sorts tour par tour (cycle), positions rétablies après chaque lancer (poussées,
//    reculs), dégâts comptés sur la fenêtre « tour du Crâ → début de son tour suivant » (poisons, effets différés,
//    rampes 293 comprises). Le moteur vérifie PA, PO (bonus/malus de PO des buffs compris), ligne, LdV, lancers par
//    tour / par cible, relances.
import { loadDataStore } from '../../../../src/data/node'
import { createEngine } from '../../../../src/engine/index'
import { createMonsterFighter, createPlayerFighter } from '../../../../src/engine/factory'
import { castSpell } from '../../../../src/engine/cast'
import { pointToCell } from '../../../../src/map/geometry'
import { emptyStats, type Stats, type Element } from '../../../../src/core/types'
import { critChance } from '../../../../src/damage/crit'
import { expectedDamage, type DamageInput } from '../../../../src/damage/damage'
import { createSpellProfileIndex } from '../../../../src/ai/core/spellProfile'
import { resolveElement } from '../../../../src/engine/effects/damage/pipeline'
import { compileTargetMask, matchesTargetMask } from '../../../../src/engine/targetMask'
import { theoryEngine } from '../../../../src/theorycraft/fighters'
import type { MapData } from '../../../../src/data/model'
import type { Fighter, FightState } from '../../../../src/engine/types'

export const data = loadDataStore('data')
export const PAIRS = data.breed(9)!.spellPairs
export const ALL_SPELLS = PAIRS.flat()
export const nameOf = (id: number) => data.spell(id)?.name ?? `Sort ${id}`
export const lvlOf = (id: number) => data.spellLevel(id, { playerLevel: 200 })!

/** Caractéristiques du Crâ (point 2 du joueur). « Dommages Neutre 56 … Air 45 » = dommages fixes PAR ÉLÉMENT tels
 *  qu'affichés (dommages génériques supposés déjà inclus : `damage` = 0). Critique 79 = caractéristique (%CC d'un sort =
 *  CC de base du sort + 79, plafond 100). */
export const CRA: Stats = {
  ...emptyStats(),
  ap: 12, mp: 5, range: 4, summons: 4, initiative: 2690, wisdom: 171,
  strength: 579, intelligence: 728, chance: 290, agility: 519, power: 169,
  critical: 79, criticalDamage: 95, pushDamage: 14,
  neutralDamage: 56, earthDamage: 67, fireDamage: 84, waterDamage: 38, airDamage: 45,
  spellDamagePct: 10, rangedDamagePct: 6,
  earthRes: 13, fireRes: 23, waterRes: 6, airRes: 2,
  neutralResPct: 9, earthResPct: 16, fireResPct: 16, waterResPct: 28, airResPct: 47,
  rangedResPct: -12, meleeResPct: -6,
  tackleBlock: 34, tackleEvade: 23, apReduction: 19, mpReduction: 17, apParry: 17, mpParry: 3,
}
export const CRA_HP = 3342

export interface TargetSpec { id: number; name: string; grade: number; short: string }
/** Reine grade 1 (4 joueurs : grade = joueurs − 3, README §1.2 « INCERTAIN ») ; monstres de vague grade 5 = niveau 212. */
export const TARGETS: TargetSpec[] = [
  { id: 3726, name: 'Reine', grade: 1, short: 'Reine' },
  { id: 3746, name: 'Mâchassin', grade: 5, short: 'Mâch.' },
  { id: 3747, name: 'Terristocrate', grade: 5, short: 'Terri.' },
  { id: 3748, name: 'Doublure', grade: 5, short: 'Doubl.' },
  { id: 3749, name: 'Bourôliste', grade: 5, short: 'Bourô.' },
  { id: 3750, name: 'Magouille', grade: 5, short: 'Magou.' },
]
export const EL_FR = ['Neutre', 'Terre', 'Feu', 'Eau', 'Air']
export const fmt = (x: number, d = 0) => x.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d })
export const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
export const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)

export function craFighter(stats: Stats = CRA, spellIds: number[] = ALL_SPELLS): Fighter {
  const f = createPlayerFighter(data, { name: 'Crâ', breedId: 9, level: 200, stats: { ...stats }, maxHp: CRA_HP, spellIds, team: 0 })
  f.id = 0
  return f
}
export function monsterFighter(t: TargetSpec): Fighter {
  const f = createMonsterFighter(data, { monsterId: t.id, grade: t.grade, team: 1 })
  f.id = 1
  return f
}

// ───────────────────────── calculateur analytique (1er lancer, lignes immédiates) ─────────────────────────
export interface CalcLine { element: number; family: string; expected: number; condition?: string; delayed: number; dotTurns: number; sub: boolean; p: number; min: number; max: number }
export interface CalcResult { immediate: number; lines: CalcLine[]; critPct: number }
const PROFILES = createSpellProfileIndex(theoryEngine(data))
function selects(mask: string, a: Fighter, d: Fighter) {
  const m = compileTargetMask(mask)
  return m.empty || (m.inclusionLetters.length > 0 && matchesTargetMask(m.inclusionLetters.join(','), a, d))
}
const INCL = /^\*?[aAcCghHlLdDmMiIjJsSx]$/
const condOf = (masks: string[]) => masks.flatMap(m => m.split(',').map(t => t.trim()).filter(t => t && !INCL.test(t))).join(',') || undefined
export function calcSpell(spellId: number, t: TargetSpec, opts: { melee?: boolean; stats?: Stats } = {}): CalcResult {
  const stats = opts.stats ?? CRA
  const lv = lvlOf(spellId)
  const prof = PROFILES.of(lv)
  const caster = craFighter(stats)
  const target = monsterFighter(t)
  const defender = target.stats
  const critPct = lv.criticalEffects.length ? critChance(lv.critChance, stats.critical) : 0
  const lines: CalcLine[] = []
  for (const line of prof.damage) {
    if (!line.sides.enemy || !selects(line.mask, caster, target)) continue
    if (line.gates?.some(g => !selects(g, caster, target))) continue
    const el = resolveElement(line.element, stats)
    let expected = 0
    if ((line.family === 'boosted' || line.family === 'mp') && el >= 0) {
      const normal: DamageInput = { attacker: stats, defender, element: el as Element, crit: false, isWeapon: false, isMelee: !!opts.melee, defenderIsPlayer: false, allResPct: defender.allResPct ?? 0 }
      expected = expectedDamage(normal, { ...normal, crit: true }, { min: line.min, max: line.max, critMin: line.critMin, critMax: line.critMax }, critPct)
    } else continue
    lines.push({ element: el, family: line.family, expected, condition: condOf([line.mask, ...(line.gates ?? [])]), delayed: line.delayed, dotTurns: line.dotTurns, sub: line.sub, p: line.p, min: line.min, max: line.max })
  }
  const immediate = lines.filter(l => !l.condition && !l.delayed && !l.dotTurns).reduce((s, l) => s + l.p * l.expected, 0)
  return { immediate, lines, critPct }
}

// ───────────────────────────────────────── banc moteur ─────────────────────────────────────────
const openMap = (): MapData => ({ id: 0, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }) as unknown as MapData
/** Une étape d'un tour : sort lancé sur la cible (défaut) ou sur soi. */
export interface Step { spell: number; on?: 'target' | 'self' }
export type TurnPlan = Step[]
export interface Geom { dx: number; dy: number }
export const inLine = (d: number): Geom => ({ dx: 0, dy: d })
/** Hors ligne et hors diagonale (d ≥ 3) : décalage d'une colonne. */
export const offLine = (d: number): Geom => ({ dx: 1, dy: d - 1 })

export interface BenchResult {
  perTurn: number[]
  /** Dégâts moyens par tour sur les tours mesurés (après échauffement). */
  mean: number
  /** Lancers réussis par sort (sur les tours mesurés) et refus (raison). */
  casts: Map<number, number>
  refused: Map<string, number>
  apLeft: number[]
}

function untilTurnOf(engine: ReturnType<typeof createEngine>, fight: FightState, f: Fighter) {
  for (let i = 0; i < 50; i++) {
    const cur = engine.current(fight)
    if (cur && fight.round > 0 && cur.alive) engine.endTurn(fight, cur)
    const nx = engine.nextTurn(fight)
    if (!nx || nx.id === f.id) return
  }
}

/**
 * Joue `cycle` (plans de tours, répétés) pendant `turns` tours ; mesure à partir du tour `warm + 1`.
 * `apOverride` : PA imposés au début de chaque tour (mesure d'un sort seul : 99). `targetStates` : états posés sur la
 * cible au début de chaque tour (ex. Pesanteur). `onTurnStart` : crochet (buffs externes, autres Crâs…).
 */
export function bench(cycle: TurnPlan[], t: TargetSpec, geom: Geom, opts: { stats?: Stats; turns?: number; warm?: number; apOverride?: number; spellIds?: number[]; onTurnStart?: (fight: FightState, c: Fighter, m: Fighter, turn: number) => void } = {}): BenchResult {
  const turns = opts.turns ?? 10
  const warm = opts.warm ?? 4
  const engine = createEngine(data)
  const casterCell = pointToCell(16, -geom.dy)
  const tx = 16 + geom.dx
  const targetCell = pointToCell(tx, 0)
  const caster = createPlayerFighter(data, { name: 'Crâ', breedId: 9, level: 200, stats: { ...(opts.stats ?? CRA) }, maxHp: CRA_HP, spellIds: opts.spellIds ?? ALL_SPELLS, team: 0, cell: casterCell })
  caster.baseStats.initiative = caster.stats.initiative = 9999
  const dummy = createMonsterFighter(data, { monsterId: t.id, grade: t.grade, team: 1, cell: targetCell })
  dummy.baseStats.initiative = dummy.stats.initiative = 1
  const fight = engine.createFight({ map: openMap(), fighters: [caster, dummy], options: { seed: 1, rollMode: 'average', record: true, maxRounds: 999 } as never })
  const c = fight.fighters.find(f => f.team === 0)!
  const m = fight.fighters.find(f => f.team === 1)!
  m.hp = m.maxHp = m.baseMaxHp = 50_000_000
  const cCell = c.cell, mCell = m.cell
  const casts = new Map<number, number>()
  const refused = new Map<string, number>()
  const perTurn: number[] = []
  const apLeft: number[] = []
  untilTurnOf(engine, fight, c)
  for (let turn = 1; turn <= turns; turn++) {
    const n0 = fight.events.length
    if (opts.apOverride !== undefined) c.ap = opts.apOverride
    opts.onTurnStart?.(fight, c, m, turn)
    const plan = cycle[(turn - 1) % cycle.length]
    for (const st of plan) {
      const cell = st.on === 'self' ? c.cell : m.cell
      const r = castSpell(engine, fight, c, st.spell, cell)
      if (c.cell !== cCell) c.cell = cCell
      if (m.cell !== mCell) m.cell = mCell
      if (turn > warm) {
        if (r.ok) casts.set(st.spell, (casts.get(st.spell) ?? 0) + 1)
        else refused.set(`${nameOf(st.spell)}:${r.failure}`, (refused.get(`${nameOf(st.spell)}:${r.failure}`) ?? 0) + 1)
      }
    }
    if (turn > warm) apLeft.push(c.ap)
    untilTurnOf(engine, fight, c)
    let dmg = 0
    for (const e of fight.events.slice(n0) as { t: string; target?: number; source?: number; amount?: number }[]) if (e.t === 'damage' && e.target === m.id) dmg += e.amount ?? 0
    if (turn > warm) perTurn.push(dmg)
  }
  const n = perTurn.length
  for (const [k, v] of casts) casts.set(k, v / n)
  for (const [k, v] of refused) refused.set(k, v / n)
  return { perTurn, mean: perTurn.reduce((s, x) => s + x, 0) / n, casts, refused, apLeft }
}

/** Sort offensif (lignes de dégâts directes ou en sous-sort) : candidats des rotations. */
const DAMAGE_IDS = new Set([91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 2822, 1016, 1092])
export function isOffensive(id: number): boolean {
  const lv = lvlOf(id)
  return lv.effects.some(e => DAMAGE_IDS.has(e.effectId)) || [32444, 32450, 32448, 32708, 32473].includes(id)
}
/** Portée effective (min, max) d'un sort avec `range` de PO bonus (boostable seulement). */
export function spellRange(id: number, range = CRA.range): [number, number] {
  const lv = lvlOf(id)
  return [lv.minRange, Math.max(lv.minRange, lv.range + (lv.rangeBoostable ? range : 0))]
}
