// Fidélité du moteur sur un combat réel. Chaque tour du journal AnkaBot (reconstitution exacte de tools/fightlog/rejeu.ts)
// est rejoué dans le moteur, action par action : déplacements et lancers VOLONTAIRES imposés (Crâs et monstres), le reste
// (sorts déclenchés, poussées, dégâts, morts) laissé au moteur puis comparé au combat réel. Après chaque action, le moteur
// est recalé sur le réel (cases, PV, PA/PM, vivants, invocations, pièges) : un écart ne fausse pas les suivants. Les
// effets durables (buffs, états, relances) restent ceux du moteur.
//
// Mesures : déplacements (case d'arrivée), lancers (acceptés par le moteur, dégâts par cible dans la fourchette des jets
// avec le même coup critique que le réel, cases après poussées, morts), apparition des bombes, explosions (bombes.ts :
// bombes détruites, passages au bleu, soins, morts, dégâts aux monstres), IA des monstres (case de fin de tour, sorts).
//
//   npx tsx tools/reine-des-voleurs/planificateur/fidelite.ts [--fichier <journal.jsonl>] [--perso <nom>] [--detail]
//                                                             [--chemins] [--json <sortie.json>]
// --detail : chaque écart ; --chemins : chemins réels et prévus des monstres.
import { writeFileSync } from 'node:fs'
import { emptyStats, type Stats } from '../../../src/core/types'
import { canCast, castSpell } from '../../../src/engine/cast'
import type { Engine } from '../../../src/engine/engine'
import { summonMonster } from '../../../src/engine/effects/summons'
import { createMonsterFighter, createPlayerFighter } from '../../../src/engine/factory'
import { createEngine } from '../../../src/engine/index'
import { move } from '../../../src/engine/move'
import type { FightEvent, Fighter, FightState } from '../../../src/engine/types'
import { CELL_X, CELL_Y, distance } from '../../../src/map/geometry'
import { loadStream, rebuild, type Fighter as RealFighter, type Rebuild } from '../../fightlog/rejeu'
import { spellListOf, type Row } from './journal'
import { simulateHorizon, spawnCell, type BombWorld } from './bombes'
import { BOMB, DEFAULT_SPELLS, GRADES, MAP_ID, QUEEN, UNSENT_CRA_STATS, data, monsterCooldowns } from './etat'
import { DEATH_ROW } from './menaces'
import { reachableCells } from '../../../src/engine/move'
import type { FormationState, PlayedTurn } from './formation'
import { monsterControllers } from './monstres'
import { applyCastRules, applyNova, applyStateRules, reineScenario, shareTwinDamage, twinHp } from './regles'
import { BRUME, brumeCells, learn, type Hidden } from './brume'
import { createSpellProfileIndex } from '../../../src/ai/core/spellProfile'

// ───────────────────────────── caractéristiques réelles ─────────────────────────────

/** Caractéristique du jeu (characteristics.json) → caractéristique du moteur. */
const CARAC: [number, keyof Stats, (v: number) => number][] = [
  [1, 'ap', v => v], [23, 'mp', v => v], [19, 'range', v => v], [26, 'summons', v => v],
  [10, 'strength', v => v], [11, 'vitality', v => v], [13, 'chance', v => v], [14, 'agility', v => v],
  [15, 'intelligence', v => v], [18, 'critical', v => v], [25, 'power', v => v], [16, 'damage', v => v],
  [84, 'pushDamage', v => v], [86, 'criticalDamage', v => v], [49, 'heals', v => v],
  [88, 'earthDamage', v => v], [89, 'fireDamage', v => v], [90, 'waterDamage', v => v], [91, 'airDamage', v => v],
  [92, 'neutralDamage', v => v],
  [37, 'neutralResPct', v => v], [33, 'earthResPct', v => v], [35, 'waterResPct', v => v], [36, 'airResPct', v => v],
  [34, 'fireResPct', v => v],
  [58, 'neutralRes', v => v], [54, 'earthRes', v => v], [56, 'waterRes', v => v], [57, 'airRes', v => v], [55, 'fireRes', v => v],
  [85, 'pushRes', v => v], [87, 'criticalRes', v => v], [27, 'apParry', v => v], [28, 'mpParry', v => v],
  [79, 'tackleBlock', v => v], [78, 'tackleEvade', v => v], [50, 'reflect', v => v],
  // Multiplicateurs en % (100 = neutre).
  [107, 'finalDamagePct', v => v - 100], [120, 'rangedDamagePct', v => v - 100], [121, 'rangedResPct', v => 100 - v],
  [122, 'weaponDamagePct', v => v - 100], [123, 'spellDamagePct', v => v - 100], [124, 'meleeResPct', v => 100 - v],
  [125, 'meleeDamagePct', v => v - 100], [141, 'spellResPct', v => 100 - v], [142, 'weaponResPct', v => 100 - v],
]

/** Caractéristiques du moteur d'après la synchronisation du serveur (première vue du combattant). */
export function statsFromCarac(c: Map<number, number>): Stats {
  const s = emptyStats()
  for (const [id, key, f] of CARAC) if (c.has(id)) (s[key] as number) = f(c.get(id)!)
  return s
}

const maxHpFromCarac = (c: Map<number, number>) => (c.get(0) ?? 0) + (c.get(11) ?? 0) - (c.get(102) ?? 0)

// ───────────────────────────── combat réel : état courant ─────────────────────────────

/** État du combat réel, mis à jour événement par événement (identifiants de la reconstitution). */
class Truth {
  cell = new Map<number, number>()
  hp = new Map<number, number>()
  max = new Map<number, number>()
  ap = new Map<number, number>()
  mp = new Map<number, number>()
  /**
   * PA / PM au début du dernier tour de chaque combattant : leur maximum pour le tour. Les caractéristiques PA (1) et
   * PM (23) du serveur sont les points RESTANTS (elles baissent à chaque lancer et déplacement).
   */
  turnAp = new Map<number, number>()
  turnMp = new Map<number, number>()
  alive = new Set<number>()
  invisible = new Set<number>()
  blue = new Set<number>()
  /** Pièges / glyphes posés (uid → cases, sort). */
  marks = new Map<number, { cells: number[]; spellId: number }>()
  /** Combattants apparus (invocations, vagues), dans l'ordre. */
  born: number[] = []
  /** Caractéristiques courantes (synchronisations et changements jtk du serveur). */
  carac = new Map<number, Map<number, number>>()
  private caracNext = 0

  constructor(readonly res: Rebuild) {
    for (const [id, c] of res.initialCarac) this.carac.set(id, new Map(c))
  }

  /** Changements de caractéristiques survenus avant l'événement `k`. */
  caracBefore(k: number): void {
    const log = this.res.caracLog
    while (this.caracNext < log.length && log[this.caracNext].ev <= k) {
      const x = log[this.caracNext++]
      const c = this.carac.get(x.fighter) ?? new Map<number, number>()
      for (const [id, v] of x.values) {
        // PV de base (0) et vitalité (11) : PV et PV max suivent (sort 6722 à l'arrivée d'une vague : −1650 vitalité).
        if ((id === 0 || id === 11) && c.has(id) && this.hp.has(x.fighter)) {
          const d = v - c.get(id)!
          this.hp.set(x.fighter, this.hp.get(x.fighter)! + d)
          this.max.set(x.fighter, (this.max.get(x.fighter) ?? 0) + d)
        }
        c.set(id, v)
      }
      this.carac.set(x.fighter, c)
    }
  }

  apply(e: FightEvent): void {
    switch (e.t) {
      case 'fightStart':
        for (const f of e.fighters) this.add(f.id, f.cell, f.hp, f.maxHp)
        break
      case 'move':
        this.cell.set(e.fighter, e.path[e.path.length - 1])
        break
      case 'push':
      case 'teleport':
        this.cell.set(e.target, e.to)
        break
      case 'damage':
        this.hp.set(e.target, (this.hp.get(e.target) ?? 0) - e.amount)
        if (e.erosion) this.max.set(e.target, (this.max.get(e.target) ?? 0) - e.erosion)
        break
      case 'heal':
        this.hp.set(e.target, Math.min(this.max.get(e.target) ?? Infinity, (this.hp.get(e.target) ?? 0) + e.amount))
        break
      case 'death':
        this.alive.delete(e.target)
        break
      case 'summon':
        this.add(e.fighter.id, e.fighter.cell, e.fighter.hp, e.fighter.maxHp)
        this.born.push(e.fighter.id)
        break
      case 'wave':
        for (const f of e.fighters) {
          this.add(f.id, f.cell, f.hp, f.maxHp)
          this.born.push(f.id)
        }
        break
      case 'state':
        if (e.name === 'Invisible') (e.added ? this.invisible.add(e.target) : this.invisible.delete(e.target))
        if (e.name === 'Bleue') this.blue.add(e.target)
        break
      case 'glyph':
        if (e.added) this.marks.set(e.glyph.uid, { cells: e.glyph.cells, spellId: e.glyph.spellId })
        else this.marks.delete(e.glyph.uid)
        break
      case 'turnStart':
        this.ap.set(e.fighter, e.ap)
        this.mp.set(e.fighter, e.mp)
        this.turnAp.set(e.fighter, e.ap)
        this.turnMp.set(e.fighter, e.mp)
        break
      case 'apmp':
        this.ap.set(e.target, (this.ap.get(e.target) ?? 0) + e.ap)
        this.mp.set(e.target, (this.mp.get(e.target) ?? 0) + e.mp)
        break
    }
  }

  private add(id: number, cell: number, hp: number, max: number): void {
    this.cell.set(id, cell)
    this.hp.set(id, hp)
    this.max.set(id, max)
    this.alive.add(id)
  }

  fighter(id: number): RealFighter {
    return this.res.fighters[id]
  }
}

// ───────────────────────────── moteur recalé sur le réel ─────────────────────────────

class Sim {
  readonly engine: Engine
  fight: FightState
  /** Identifiant de la reconstitution → identifiant du moteur (et inverse). */
  readonly eid = new Map<number, number>()
  readonly rid = new Map<number, number>()
  /** Pièges du réel recopiés dans le moteur (uid du réel → uid du moteur). */
  private readonly marks = new Map<number, number>()

  constructor(readonly truth: Truth, spellsOf: Map<number, number[]>, readonly overrides: Record<string, Partial<Stats>> = {},
    gradesOf = new Map<number, Map<number, number>>()) {
    this.engine = createEngine(data, reineScenario)
    const start = truth.res.replay.events[0] as Extract<FightEvent, { t: 'fightStart' }>
    const fighters: Fighter[] = []
    const ids: number[] = []
    for (const s of start.fighters) {
      const real = truth.fighter(s.id)
      const carac = truth.res.initialCarac.get(s.id) ?? new Map()
      let f: Fighter
      if (real.kind === 'player') {
        f = createPlayerFighter(data, { name: real.name, breedId: real.breedId ?? 9, level: real.level, stats: this.statsOf(s.id, carac),
          maxHp: maxHpFromCarac(carac) || s.maxHp, spellIds: spellsOf.get(s.id) ?? DEFAULT_SPELLS, team: 0, cell: s.cell })
        // Grades du jeu (liste de sorts du personnage), quand on les a.
        const grades = gradesOf.get(s.id)
        if (grades) f.spells = f.spells.map(sp => {
          const g = grades.get(sp.spellId)
          const lvl = g !== undefined ? data.spellLevel(sp.spellId, { grade: g }) : undefined
          return lvl ? { ...sp, level: lvl } : sp
        })
      } else {
        const id = real.monsterId ?? BOMB
        f = createMonsterFighter(data, { monsterId: id, grade: real.grade ?? GRADES[id] ?? 5, team: real.team, cell: s.cell })
        f.name = real.name
        if (carac.size) f.baseStats = f.stats = this.statsOf(s.id, carac)
      }
      fighters.push(f)
      ids.push(s.id)
    }
    // Relances initiales des sorts (initialCooldowns) : Acuité Absolue n'est pas disponible à la manche 1 (2026-10-11, le
    // planificateur la proposait au premier tour : refusée « RELANCE » pour 3 Crâs sur 4). Monstres : recalées ci-dessous.
    this.fight = this.engine.createFight({ map: data.map(MAP_ID)!, fighters, options: { seed: 1, rollMode: 'min', record: true, maxRounds: 999, initialCooldowns: true } })
    this.fight.fighters.forEach((f, i) => {
      this.link(ids[i], f.id)
      if (f.kind === 'monster' && f.monsterId !== undefined) f.cooldowns = monsterCooldowns(f.monsterId, 1)
    })
  }

  /** Caractéristiques du serveur, plus celles qu'il n'envoie pas (dommages critiques, poussée…) données à part. */
  statsOf(r: number, c: Map<number, number>): Stats {
    const s = statsFromCarac(c)
    if (this.truth.turnAp.has(r)) s.ap = this.truth.turnAp.get(r)!
    if (this.truth.turnMp.has(r)) s.mp = this.truth.turnMp.get(r)!
    const real = this.truth.fighter(r)
    if (real.kind === 'player') for (const k in UNSENT_CRA_STATS) if (!c.has(k === 'criticalDamage' ? 86 : -1)) (s[k as keyof Stats] as number) += UNSENT_CRA_STATS[k as keyof Stats] ?? 0
    const o = this.overrides[real.name]
    if (o) for (const k in o) (s[k as keyof Stats] as number) += o[k as keyof Stats] ?? 0
    return s
  }

  private link(r: number, e: number): void {
    this.eid.set(r, e)
    this.rid.set(e, r)
  }

  f(r: number): Fighter | undefined {
    const e = this.eid.get(r)
    return e === undefined ? undefined : this.fight.fighters[e]
  }

  /** Recale le moteur sur le réel : apparitions, morts, cases, PV, PA/PM, pièges. */
  sync(): void {
    const t = this.truth
    const fight = this.fight
    // Invocations du moteur sans équivalent connu : reliées à une apparition réelle de même monstre sur la même case.
    for (const f of fight.fighters) {
      if (this.rid.has(f.id) || !f.alive) continue
      const r = t.born.find(x => !this.eid.has(x) && t.alive.has(x) && t.fighter(x).monsterId === f.monsterId && t.cell.get(x) === f.cell)
      if (r !== undefined) this.link(r, f.id)
      else {
        f.alive = false
        f.hp = 0
      }
    }
    for (const r of t.born) {
      if (this.eid.has(r) || !t.alive.has(r)) continue
      const real = t.fighter(r)
      const mid = real.monsterId ?? BOMB
      const owner = real.summonerId !== undefined ? this.f(this.truth.res.fighters.findIndex(x => x.gameId === real.summonerId)) : undefined
      let f: Fighter | undefined
      if (real.kind === 'summon' && owner) f = summonMonster(this.engine, fight, owner, mid, real.grade ?? GRADES[mid] ?? 1, t.cell.get(r)!, { noStartingSpell: true })
      if (!f) {
        const m = createMonsterFighter(data, { monsterId: mid, grade: real.grade ?? GRADES[mid] ?? 5, team: real.team, cell: t.cell.get(r)! })
        m.name = real.name
        f = this.engine.spawn(fight, m)
        f.cooldowns = monsterCooldowns(mid, fight.round)
        // Monstre de vague : invulnérable jusqu'à la fin de son premier tour (regles.ts).
        if (real.kind === 'monster') f.tags.arrivalShield = true
      }
      this.link(r, f.id)
    }
    for (const [r, e] of this.eid) {
      const f = fight.fighters[e]
      if (!f) continue
      if (!t.alive.has(r)) {
        f.alive = false
        continue
      }
      f.alive = true
      f.cell = t.cell.get(r)!
      f.maxHp = Math.max(1, t.max.get(r) ?? f.maxHp)
      f.hp = Math.max(1, Math.min(f.maxHp, t.hp.get(r) ?? f.hp))
      // Caractéristiques du serveur (buffs compris) : la base du moteur en est déduite, ses propres buffs gardés (durées,
      // états, modificateurs de sorts) sans être comptés deux fois.
      const c = t.carac.get(r)
      if (c?.size) {
        const real = this.statsOf(r, c)
        for (const b of f.buffs) {
          if (b.delay > 0 || !b.statDelta) continue
          for (const k in b.statDelta) (real[k as keyof Stats] as number) -= b.statDelta[k as keyof Stats] ?? 0
        }
        f.baseStats = real
        this.engine.recomputeStats(f)
      }
      if (t.ap.has(r)) f.ap = t.ap.get(r)!
      if (t.mp.has(r)) f.mp = t.mp.get(r)!
    }
    // Pièges et glyphes du réel (« Jeu Dangereux » : marque sous la case de début de tour) : arrêtent les déplacements.
    for (const [uid, m] of t.marks) {
      if (this.marks.has(uid)) continue
      const u = this.engine.uid(fight)
      fight.traps = [...fight.traps, { uid: u, sourceId: 0, spellId: m.spellId, center: m.cells[0], cells: m.cells, effects: [], visible: true, color: '#c84' }]
      this.marks.set(uid, u)
    }
    for (const [uid, u] of [...this.marks]) {
      if (t.marks.has(uid)) continue
      fight.traps = fight.traps.filter(x => x.uid !== u)
      this.marks.delete(uid)
    }
    fight.ended = false
    fight.winner = null
  }
}

// ───────────────────────────── mesures ─────────────────────────────

interface Tally { ok: number; total: number; notes: string[] }
const tally = (): Tally => ({ ok: 0, total: 0, notes: [] })
const NOTES_MAX = 400

export interface FidelityReport {
  file: string
  rounds: number
  moves: Tally
  castsAccepted: Tally
  damage: Tally & { real: number; low: number; high: number }
  pushes: Tally
  deaths: Tally
  turnStart: Tally
  bombSpawn: Tally
  bombPhase: Tally
  /** Dommages des explosions aux monstres (regles.ts, sur les explosions prévues par bombes.ts). */
  nova: Tally
  bombDamage: { explosions: number; hits: { target: string; amount: number; bombs: number }[] }
  monsterAi: Tally
  /** IA des monstres : distance entre la case de fin prévue et la case réelle, par monstre. */
  aiDistance: { monster: string; d: number }[]
  /** Tours de la Reine : pouvait-elle lancer Mort en Sursis sur un Crâ (case accessible, en ligne, ligne de vue) ? */
  queenDeathRow: { round: number; could: string[]; did: boolean }[]
  byRound: Record<number, { ok: number; total: number }>
  /** Dégâts de chaque lancer volontaire, par cible : réel et fourchette du moteur. */
  hits: { round: number; caster: string; spell: number; crit: boolean; target: string; monsterId?: number; real: number; lo: number; hi: number; kill: boolean; bombs: number; final: number }[]
}

function note(t: Tally, ok: boolean, text: string): void {
  t.total++
  if (ok) t.ok++
  else if (t.notes.length < NOTES_MAX) t.notes.push(text)
}

/** Dégâts par cible (identifiant de la reconstitution) dans une liste d'événements du moteur. */
function engineDamage(sim: Sim, evs: FightEvent[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const e of evs) {
    if (e.t !== 'damage' || e.amount <= 0) continue
    const r = sim.rid.get(e.target)
    if (r !== undefined) out.set(r, (out.get(r) ?? 0) + e.amount)
  }
  return out
}

/** PV de chaque combattant du moteur (0 s'il est mort). */
const hpOf = (fight: FightState) => new Map(fight.fighters.map(f => [f.id, f.alive ? f.hp : 0]))

/** PV perdus par cible (identifiant de la reconstitution) entre deux relevés, lanceur excepté (vol de vie). */
function hpLoss(sim: Sim, before: Map<number, number>, after: FightState, caster: number): Map<number, number> {
  const out = new Map<number, number>()
  for (const f of after.fighters) {
    if (f.id === caster) continue
    const r = sim.rid.get(f.id)
    const lost = (before.get(f.id) ?? 0) - (f.alive ? f.hp : 0)
    if (r !== undefined && lost > 0) out.set(r, lost)
  }
  return out
}

const inLine = (a: number, b: number) => a !== b && (CELL_X[a] === CELL_X[b] || CELL_Y[a] === CELL_Y[b]) && distance(a, b) <= 10

export interface MeasureOptions {
  perso?: string
  /** Caractéristiques ajoutées à celles du serveur, par nom de combattant (ex. dommages critiques des Crâs). */
  overrides?: Record<string, Partial<Stats>>
  /** Écrit les chemins réels et prévus de chaque tour de monstre (mise au point de l'IA). */
  paths?: boolean
  /**
   * Appelé au début de chaque tour de Crâ (bombe de la manche posée, effets de début de tour passés) avec l'état exact
   * du combat (clone du moteur recalé sur le réel) et ce que le Crâ a réellement joué : planificateur sur états réels.
   */
  onCraTurn?: (state: FormationState, played: PlayedTurn) => void
  /**
   * Appelé à la fin si le dernier tour du journal est celui d'un Crâ, pas encore fini (combat en direct) : état exact à
   * ce moment (sa bombe posée, ses actions déjà jouées comprises). Serveur de plans.
   */
  onCurrentTurn?: (state: FormationState, played: PlayedTurn) => void
  /** Sans mesures (ni fourchettes de dégâts, ni IA des monstres, ni explosions) : recalage seul, pour le serveur. */
  fast?: boolean
  /**
   * Sorts de chaque Crâ (par nom), d'après sa liste du jeu (journal.ts, spellListOf : variantes équipées comprises) ;
   * pour un journal lu dans un fichier, celle de son personnage est prise d'office. Sans liste : sorts lancés pendant le
   * combat + DEFAULT_SPELLS (des variantes qu'il n'a peut-être pas : 2026-10-10, Flèche d'Immobilisation pour Lowkey,
   * qui a Flèche Tyrannique).
   */
  spellLists?: Record<string, { spellId: number; grade: number }[]>
}

export function measure(source: string | Row[], opts: MeasureOptions = {}): FidelityReport {
  const perso = opts.perso
  const file = typeof source === 'string' ? source : '(journal en mémoire)'
  const stream = typeof source === 'string' ? loadStream(source, perso) : undefined
  const rows = stream ? stream.rows : (source as Row[])
  const spellLists = { ...(opts.spellLists ?? {}) }
  if (stream && !spellLists[stream.character]) {
    const own = spellListOf(stream.rows)
    if (own) spellLists[stream.character] = own
  }
  const res = rebuild(rows)
  const ev = res.replay.events
  const F = res.fighters
  const nameOf = (r: number) => F[r]?.name.replace('Reine des Voleurs', 'Reine') ?? String(r)
  const spellName = (id: number) => data.spell(id)?.name ?? `sort ${id}`
  const isBombR = (r: number) => F[r]?.monsterId === BOMB

  // Sorts des Crâs : leur liste du jeu si on l'a (variantes équipées), sinon la liste par défaut ; plus ceux qu'ils ont
  // lancés volontairement.
  const spellsOf = new Map<number, number[]>()
  const gradesOf = new Map<number, Map<number, number>>()
  F.forEach((f, r) => {
    const list = f.kind === 'player' ? spellLists[f.name] : undefined
    if (!list) return
    spellsOf.set(r, list.map(x => x.spellId))
    gradesOf.set(r, new Map(list.map(x => [x.spellId, x.grade])))
  })
  for (const i of res.voluntary) {
    const e = ev[i] as Extract<FightEvent, { t: 'cast' }>
    if (F[e.fighter].kind !== 'player') continue
    const l = spellsOf.get(e.fighter) ?? [...DEFAULT_SPELLS]
    if (!l.includes(e.spellId)) l.push(e.spellId)
    spellsOf.set(e.fighter, l)
  }

  const truth = new Truth(res)
  truth.apply(ev[0])
  const sim = new Sim(truth, spellsOf, opts.overrides, gradesOf)
  // Ordre de jeu (identifiants de jeu, bombes exclues), complété à l'arrivée des vagues : chaque nouveau venu prend place
  // après le combattant qui a joué juste avant lui.
  const order: number[] = []
  let lastTurn: number | undefined
  // Crâs dans l'ordre de jeu (identifiants de jeu), relevé sur la manche 1.
  const players: number[] = []
  for (const e of ev) {
    if (e.t === 'roundStart' && e.round > 1) break
    if (e.t === 'turnStart' && F[e.fighter].kind === 'player' && !players.includes(F[e.fighter].gameId)) players.push(F[e.fighter].gameId)
  }
  const ctl = monsterControllers(1)
  const report: FidelityReport = {
    file, rounds: res.rounds, moves: tally(), castsAccepted: tally(), damage: { ...tally(), real: 0, low: 0, high: 0 },
    pushes: tally(), deaths: tally(), turnStart: tally(), bombSpawn: tally(), bombPhase: tally(), nova: tally(),
    bombDamage: { explosions: 0, hits: [] }, monsterAi: tally(), aiDistance: [], queenDeathRow: [], byRound: {}, hits: [],
  }
  let round = 0
  const roundTally = (ok: boolean) => {
    const r = (report.byRound[round] ??= { ok: 0, total: 0 })
    r.total++
    if (ok) r.ok++
  }

  // ── Reine sous Brume : cases possibles (brume.ts), réduites par les lancers des Crâs ──
  const hidden = new Map<number, Hidden>()
  let brumeAt: { r: number; cell: number } | null = null
  /**
   * Brumes encore posées (glyphe du sort Brume : identifiant → case du milieu). La Reine qui y redevient invisible sans
   * relancer la Brume s'y cache comme la première fois, au milieu ou sur une case du haut (combat du 2026-10-11 à
   * 12:49, manche 5 : entrée visible en 163, invisible, réapparue au milieu, 204 ; les tirs sur 163 ont tous manqué).
   */
  const brumeZones = new Map<number, number>()
  /** Lancer d'un Crâ en cours (ses effets suivent) : qui il a blessé parmi les invisibles. */
  let probe: { caster: number; spell: number; from: number; target: number; hit: Set<number> } | null = null
  let profiles: ReturnType<typeof createSpellProfileIndex> | null = null
  const settle = () => {
    if (!probe) return
    const p = probe
    probe = null
    const level = sim.f(p.caster)?.spells.find(sp => sp.spellId === p.spell)?.level
    if (!level || p.from === undefined) return
    const prof = (profiles ??= createSpellProfileIndex(sim.engine)).of(level)
    for (const [r, h] of hidden) {
      const blocked = (c: number) => !sim.fight.map.cells[c]?.walkable || [...truth.alive].some(y => y !== r && truth.cell.get(y) === c)
      hidden.set(r, learn(h, prof, p.from, p.target, p.hit.has(r), true, blocked))
    }
  }
  const track = (e: FightEvent, k: number) => {
    if (probe && (res.voluntary.has(k) || e.t === 'move' || e.t === 'turnEnd' || e.t === 'turnStart')) settle()
    if (e.t === 'glyph') {
      if (e.added && e.glyph.spellId === BRUME && e.glyph.cells.length) brumeZones.set(e.glyph.uid, e.glyph.cells[0])
      else if (!e.added) brumeZones.delete(e.glyph.uid)
    }
    if (e.t === 'cast' && e.spellId === BRUME && F[e.fighter]?.monsterId === QUEEN) brumeAt = { r: e.fighter, cell: e.cell }
    else if (e.t === 'state' && e.name === 'Invisible') {
      const walk = (c: number) => !!sim.fight.map.cells[c]?.walkable
      if (!e.added) hidden.delete(e.target)
      else if (brumeAt?.r === e.target) {
        hidden.set(e.target, { center: brumeAt.cell, cells: brumeCells(brumeAt.cell, walk) })
        brumeAt = null
      } else if (F[e.target]?.monsterId === QUEEN && brumeZones.size) {
        // Retour dans une Brume déjà posée : celle dont le milieu est le plus proche de sa dernière case vue.
        const last = truth.cell.get(e.target) ?? -1
        const center = [...brumeZones.values()].reduce((a, c) => (last >= 0 && distance(c, last) < distance(a, last) ? c : a))
        hidden.set(e.target, { center, cells: brumeCells(center, walk) })
      }
    } else if ((e.t === 'push' || e.t === 'teleport') && hidden.has(e.target) && e.to >= 0) {
      hidden.set(e.target, { ...hidden.get(e.target)!, cells: [e.to], exact: true })
    } else if (e.t === 'damage' && probe && hidden.has(e.target)) probe.hit.add(e.target)
    if (e.t === 'cast' && hidden.size && res.voluntary.has(k) && F[e.fighter]?.kind === 'player') {
      probe = { caster: e.fighter, spell: e.spellId, from: truth.cell.get(e.fighter)!, target: e.cell, hit: new Set() }
    }
  }

  /** Applique au réel les événements [from, to). */
  const advance = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      const e = ev[k]
      track(e, k)
      truth.caracBefore(k)
      if (e.t === 'roundStart') {
        round = e.round
        sim.fight.round = e.round
      }
      truth.apply(e)
    }
  }

  let i = 1
  while (i < ev.length) {
    const e = ev[i]
    if (e.t !== 'turnStart') {
      advance(i, i + 1)
      i++
      continue
    }
    const r = e.fighter
    let end = i + 1
    while (end < ev.length && !(ev[end].t === 'turnEnd' && (ev[end] as { fighter: number }).fighter === r) && ev[end].t !== 'turnStart') end++
    // Fin du tour : son événement turnEnd (consommé), sinon le début du tour suivant (non consommé).
    const after = ev[end]?.t === 'turnEnd' ? end + 1 : end
    const real = F[r]
    const who = `M${round} ${nameOf(r)}`
    if (!isBombR(r)) {
      if (!order.includes(real.gameId)) order.splice(lastTurn === undefined ? order.length : order.indexOf(lastTurn) + 1, 0, real.gameId)
      lastTurn = real.gameId
    }
    if (!truth.alive.has(r) || isBombR(r)) {
      // Tour d'une bombe : ses explosions sont mesurées à la fin du tour de son poseur. Tour d'un mort : rien.
      advance(i, after)
      i = after
      continue
    }
    // Étapes volontaires du tour.
    const steps: number[] = []
    for (let k = i + 1; k < end; k++) {
      const x = ev[k]
      if ((x.t === 'move' && x.fighter === r) || res.voluntary.has(k)) steps.push(k)
    }

    // ── Début du tour ──
    sim.sync()
    applyStateRules(sim.engine, sim.fight)
    const ef = sim.f(r)
    if (!ef) {
      advance(i, after)
      i = after
      continue
    }
    const startEv = sim.fight.events.length
    sim.fight.turnIndex = Math.max(0, sim.fight.timeline.indexOf(ef.id))
    sim.engine.startTurn(sim.fight, ef)
    const firstStep = steps[0] ?? end
    // Apparition de la bombe du Crâ (Péché Mignon) : règle du moteur sur l'état réel juste avant.
    if (real.kind === 'player') {
      const k = ev.slice(i, firstStep).findIndex(x => x.t === 'summon' && x.fighter.monsterId === BOMB)
      if (k >= 0) {
        advance(i, i + k)
        const world = bombWorldOf(truth)
        const predicted = spawnCell(world, truth.cell.get(r)!)
        const got = (ev[i + k] as Extract<FightEvent, { t: 'summon' }>).fighter.cell
        note(report.bombSpawn, predicted === got, `${who} : bombe prévue en ${predicted}, apparue en ${got}`)
        advance(i + k, firstStep)
      } else advance(i, firstStep)
    } else advance(i, firstStep)
    // Effets de début de tour (poisons…) : PV perdus par le combattant.
    {
      const realLoss = (sumDamage(ev.slice(i, firstStep), r))
      const engLoss = engineDamage(sim, sim.fight.events.slice(startEv)).get(r) ?? 0
      if (realLoss || engLoss) note(report.turnStart, Math.abs(realLoss - engLoss) <= Math.max(5, realLoss * 0.1), `${who} : début de tour, PV perdus réel ${realLoss}, moteur ${engLoss}`)
    }
    sim.sync()

    // ── État exact pour le planificateur (formation.ts) ──
    /**
     * État du combat (clone du moteur recalé) et tour joué jusqu'ici. Le serveur envoie les caractéristiques de début de
     * tour (fin des buffs de la manche passée : PO de Tirs Puissants) un peu après le début du tour, parfois après le
     * premier déplacement : celles qui arrivent entre `lateFrom` et `lateTo` sont appliquées (hors PA, PM et PV).
     */
    const stateNow = (lateFrom: number, lateTo: number): [FormationState, PlayedTurn] => {
      applyStateRules(sim.engine, sim.fight)
      // Dernier lancer : ses effets sont déjà au journal (le serveur attend la synchronisation des PA).
      settle()
      const fight = sim.engine.cloneFight(sim.fight, true)
      // Reine sous Brume : posée sur sa case si elle est connue, au milieu de la brume sinon, hors de la carte si perdue.
      let hiddenNow: FormationState['hidden']
      for (const [r2, h] of hidden) {
        const e2 = sim.eid.get(r2)
        const f = e2 !== undefined ? fight.fighters[e2] : undefined
        if (!f?.alive) continue
        const want = h.cells.length === 1 ? h.cells[0] : h.cells.length ? h.center : -1
        if (want < 0 || !fight.fighters.some(o => o.alive && o.id !== f.id && o.cell === want)) f.cell = want
        hiddenNow = { gid: F[r2].gameId, center: h.center, cells: [...h.cells] }
      }
      const late = res.caracLog.filter(x => x.fighter === r && x.ev >= lateFrom && x.ev < lateTo)
      if (late.length) {
        const c = new Map(truth.carac.get(r) ?? [])
        for (const x of late) for (const [id, v] of x.values) if (![0, 1, 11, 23, 96, 97, 102].includes(id)) c.set(id, v)
        const f2 = fight.fighters[ef.id]
        const realStats = sim.statsOf(r, c)
        for (const b of f2.buffs) {
          if (b.delay > 0 || !b.statDelta) continue
          for (const k in b.statDelta) (realStats[k as keyof Stats] as number) -= b.statDelta[k as keyof Stats] ?? 0
        }
        f2.baseStats = realStats
        sim.engine.recomputeStats(f2)
      }
      const gameIdOf = new Map([...sim.rid].map(([e2, r2]) => [e2, F[r2].gameId]))
      const bombs = new Map<number, { owner: number; born: number; blue: boolean }>()
      for (const [e2, r2] of sim.rid) {
        if (!isBombR(r2) || !truth.alive.has(r2)) continue
        bombs.set(e2, { owner: F[r2].summonerId ?? 0, born: bornRound(truth, r2), blue: truth.blue.has(r2) })
      }
      const played: PlayedTurn = { round, name: real.name, gameId: real.gameId, steps: [], damage: 0, endCell: cellAfter(ev, i, end, r, truth.cell.get(r)!) }
      for (const k of steps) {
        const x = ev[k]
        if (x.t === 'move') played.steps.push({ kind: 'move', path: x.path })
        else if (x.t === 'cast') {
          const t = [...truth.alive].find(y => truth.cell.get(y) === x.cell)
          played.steps.push({ kind: 'cast', spell: x.spellId, cell: x.cell, target: t !== undefined ? F[t].gameId : undefined })
        }
      }
      for (const y of ev.slice(firstStep, end)) if (y.t === 'damage' && y.amount > 0 && F[y.target].team === 1 && !isBombR(y.target)) played.damage += y.amount
      return [{ engine: sim.engine, fight, active: ef.id, round, gameIdOf, bombs, players, anchors: new Map(), order: [...order], hidden: hiddenNow }, played]
    }
    if (real.kind === 'player' && opts.onCraTurn) {
      const firstCast = steps.find(k => ev[k].t === 'cast') ?? end
      opts.onCraTurn(...stateNow(firstStep, firstCast))
    }

    // ── IA des monstres : tour prévu sur un clone, comparé au tour réel ──
    if (real.monsterId === QUEEN && !opts.fast) {
      const q = sim.fight.fighters[ef.id]
      const ms = q.spells.find(sp => sp.spellId === DEATH_ROW)
      const could: string[] = []
      if (ms && q.cell >= 0) {
        const reach = reachableCells(sim.fight, q, sim.engine, q.mp)
        for (const p of sim.fight.fighters) {
          if (!p.alive || p.kind !== 'player') continue
          for (const [cell] of reach.cost) {
            if (distance(cell, p.cell) <= 5 && canCast(sim.engine, sim.fight, q, ms, p.cell, { fromCell: cell }) === null) {
              could.push(`${p.name}@${p.cell} depuis ${cell}`)
              break
            }
          }
        }
      }
      const did = steps.some(k => {
        const x = ev[k]
        return x.t === 'cast' && x.spellId === DEATH_ROW && [...truth.alive].some(y => F[y].kind === 'player' && truth.cell.get(y) === x.cell)
      })
      report.queenDeathRow.push({ round, could, did })
    }
    if (real.kind !== 'player' && !opts.fast) {
      const c = sim.engine.cloneFight(sim.fight, true)
      const before = c.events.length
      try {
        ctl(c.fighters[ef.id]).playTurn(sim.engine, c, c.fighters[ef.id])
      } catch {
        // contrôleur en échec : compté comme écart
      }
      const predCasts = c.events.slice(before).filter(x => x.t === 'cast' && x.fighter === ef.id).map(x => (x as { spellId: number }).spellId)
      const realCasts = steps.filter(k => ev[k].t === 'cast').map(k => (ev[k] as { spellId: number }).spellId)
      const realEnd = cellAfter(ev, i, end, r, truth.cell.get(r)!)
      const predEnd = c.fighters[ef.id].cell
      const ok = predEnd === realEnd && predCasts.join() === realCasts.join()
      const dist = predEnd >= 0 && realEnd >= 0 ? distance(predEnd, realEnd) : 99
      if (opts.paths) {
        const rp = ev.slice(i, end).filter(y => y.t === 'move' && y.fighter === r).map(y => (y as { path: number[] }).path.join('-'))
        const pp = c.events.slice(before).filter(y => y.t === 'move' && y.fighter === ef.id).map(y => (y as { path: number[] }).path.join('-'))
        const cras = [...truth.alive].filter(x => F[x].kind === 'player').map(x => truth.cell.get(x))
        console.log(`IA ${who} (${ef.mp} PM) : réel ${rp.join(' | ') || '—'} ; prévu ${pp.join(' | ') || '—'} ; Crâs ${cras.join(',')}`)
      }
      report.aiDistance.push({ monster: data.monster(real.monsterId ?? 0)?.name ?? real.name, d: dist })
      note(report.monsterAi, ok, `${who} : prévu fin en ${predEnd} [${predCasts.map(spellName).join(', ')}], réel fin en ${realEnd} [${realCasts.map(spellName).join(', ')}] — ${dist} case(s) d'écart`)
      roundTally(ok)
    }

    // ── Étapes ──
    for (let s = 0; s < steps.length; s++) {
      const k = steps[s]
      const next = steps[s + 1] ?? end
      const x = ev[k]
      sim.sync()
      applyStateRules(sim.engine, sim.fight)
      const me = sim.f(r)!
      if (x.t === 'move') {
        const before = sim.fight.events.length
        move(sim.fight, me, x.path, sim.engine)
        const got = me.cell
        const want = x.path[x.path.length - 1]
        const tackle = sim.fight.events.slice(before).find(y => y.t === 'tackle')
        note(report.moves, got === want, `${who} : déplacement ${x.path.join('→')}, moteur arrêté en ${got}${tackle ? ' (tacle)' : ''}`)
        roundTally(got === want)
        advance(k, next)
        continue
      }
      if (x.t !== 'cast' || x.cell < 0) {
        advance(k, next)
        continue
      }
      const spell = me.spells.find(sp => sp.spellId === x.spellId)
      const failure = spell ? canCast(sim.engine, sim.fight, me, spell, x.cell) : 'unknownSpell'
      const target = [...truth.alive].find(t => truth.cell.get(t) === x.cell)
      const label = `${who} : ${spellName(x.spellId)} sur ${x.cell}${target !== undefined ? ` (${nameOf(target)})` : ''}${x.crit ? ' CC' : ''}`
      note(report.castsAccepted, !failure, `${label} refusé par le moteur (${failure})`)
      roundTally(!failure)
      if (failure) {
        advance(k, next)
        continue
      }
      // Fourchette des jets (même critique que le réel) sur deux clones, puis lancer sur le combat principal.
      if (opts.fast) {
        sim.fight.options.forcedCrit = x.crit
        const twins = twinHp(sim.fight)
        castSpell(sim.engine, sim.fight, me, x.spellId, x.cell)
        applyCastRules(sim.engine, sim.fight, me, x.spellId)
        shareTwinDamage(sim.engine, sim.fight, twins)
        sim.fight.options.forcedCrit = undefined
        advance(k, next)
        continue
      }
      const hpBefore = hpOf(sim.fight)
      const ranges = (['min', 'max'] as const).map(mode => {
        const c = sim.engine.cloneFight(sim.fight, true)
        c.options.rollMode = mode
        c.options.forcedCrit = x.crit
        const b = c.events.length
        const twins = twinHp(c)
        castSpell(sim.engine, c, c.fighters[me.id], x.spellId, x.cell)
        applyCastRules(sim.engine, c, c.fighters[me.id], x.spellId)
        shareTwinDamage(sim.engine, c, twins)
        return { fight: c, evs: c.events.slice(b) }
      })
      sim.fight.options.forcedCrit = x.crit
      const twins = twinHp(sim.fight)
      castSpell(sim.engine, sim.fight, me, x.spellId, x.cell)
      applyCastRules(sim.engine, sim.fight, me, x.spellId)
      shareTwinDamage(sim.engine, sim.fight, twins)
      sim.fight.options.forcedCrit = undefined
      const lo = hpLoss(sim, hpBefore, ranges[0].fight, me.id)
      const hi = hpLoss(sim, hpBefore, ranges[1].fight, me.id)
      const realEvs = ev.slice(k, next)
      const realDmg = new Map<number, number>()
      for (const y of realEvs) if (y.t === 'damage' && y.amount > 0) realDmg.set(y.target, (realDmg.get(y.target) ?? 0) + y.amount)
      for (const t of new Set([...realDmg.keys(), ...lo.keys(), ...hi.keys()])) {
        const rv = realDmg.get(t) ?? 0
        const a = lo.get(t) ?? 0
        const b = hi.get(t) ?? 0
        const ok = rv >= Math.min(a, b) - 1 && rv <= Math.max(a, b) + 1
        report.damage.real += rv
        report.damage.low += Math.min(a, b)
        report.damage.high += Math.max(a, b)
        note(report.damage, ok, `${label} → ${nameOf(t)} : réel ${rv}, moteur ${Math.min(a, b)}–${Math.max(a, b)}`)
        report.hits.push({ round, caster: real.name, spell: x.spellId, crit: x.crit, target: nameOf(t), monsterId: F[t]?.monsterId, real: rv, lo: Math.min(a, b), hi: Math.max(a, b),
          kill: realEvs.some(y => y.t === 'death' && y.target === t), bombs: [...truth.alive].filter(isBombR).length, final: me.stats.finalDamagePct })
      }
      // Cases après l'action (poussées, échanges, téléportations) et morts.
      advance(k, next)
      const c = ranges[0].fight
      for (const [rr, e2] of sim.eid) {
        const cf = c.fighters[e2]
        if (!cf || isBombR(rr)) continue
        const realAlive = truth.alive.has(rr)
        const realCell = truth.cell.get(rr)
        const moved = realEvs.some(y => (y.t === 'push' || y.t === 'teleport') && y.target === rr) ||
          ranges[0].evs.some(y => (y.t === 'push' || y.t === 'teleport') && y.target === e2)
        if (moved && realAlive && cf.alive) note(report.pushes, cf.cell === realCell, `${label} : ${nameOf(rr)} réel en ${realCell}, moteur en ${cf.cell}`)
        const died = realEvs.some(y => y.t === 'death' && y.target === rr)
        const engDied = (hpBefore.get(e2) ?? 0) > 0 && !cf.alive
        if (died || engDied) note(report.deaths, died === engDied, `${label} : ${nameOf(rr)} ${died ? 'mort' : 'vivant'} dans le réel, ${engDied ? 'mort' : 'vivant'} dans le moteur`)
      }
    }
    sim.sync()
    // Dernier tour du journal, pas encore fini : celui d'un Crâ en train de jouer (combat en direct).
    if (end >= ev.length) {
      if (real.kind === 'player' && opts.onCurrentTurn) opts.onCurrentTurn(...stateNow(firstStep, end))
      break
    }
    sim.engine.endTurn(sim.fight, sim.f(r)!)
    // ── Explosions après le tour d'un Crâ : modèle bombes.ts sur l'état réel, comparé aux tours des bombes ──
    advance(end, after)
    if (real.kind === 'player' && !opts.fast) {
      const world = bombWorldOf(truth)
      const gid = (x: number) => F[x].gameId
      const h = simulateHorizon({ ...world, order: [gid(r)] }, gid(r), round)
      // Réel : jusqu'au début du tour du prochain combattant qui n'est pas une bombe.
      let j = after
      while (j < ev.length && !(ev[j].t === 'turnStart' && !isBombR((ev[j] as { fighter: number }).fighter))) j++
      const win = ev.slice(after, j)
      const realBombDeaths = new Set(win.filter(y => y.t === 'death' && isBombR(y.target)).map(y => F[(y as { target: number }).target].gameId))
      const blueBefore = new Set([...truth.blue].map(x => F[x].gameId))
      const realBlue = new Set(win.filter(y => y.t === 'state' && y.name === 'Bleue').map(y => F[(y as { target: number }).target].gameId)
        .filter(g => !blueBefore.has(g) && !realBombDeaths.has(g)))
      const realHeals = new Set(win.filter(y => y.t === 'heal' && F[y.target].kind === 'player').map(y => F[(y as { target: number }).target].gameId))
      const realDeaths = new Set(win.filter(y => y.t === 'death' && F[y.target].kind === 'player').map(y => F[(y as { target: number }).target].gameId))
      const predBombs = new Set(h.events.filter(y => y.kind === 'explode').map(y => y.who))
      const predBlue = new Set(h.events.filter(y => y.kind === 'blue').map(y => y.who).filter(g => !blueBefore.has(g) && !predBombs.has(g)))
      const predHeals = new Set(h.heals.map(y => y.id))
      const predDeaths = new Set(h.deaths.map(y => y.id))
      const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every(x => b.has(x))
      if (realBombDeaths.size || predBombs.size) {
        const ok = same(realBombDeaths, predBombs) && same(realBlue, predBlue) && same(realDeaths, predDeaths)
        const fmt = (s: Set<number>) => [...s].map(g => truth.cell.get(F.findIndex(z => z.gameId === g)) ?? g).join(',') || '—'
        note(report.bombPhase, ok, `${who} : bombes détruites réel [${fmt(realBombDeaths)}] / prévu [${fmt(predBombs)}] ; bleues réel [${fmt(realBlue)}] / prévu [${fmt(predBlue)}] ; morts réel ${realDeaths.size} / prévu ${predDeaths.size} ; soins réel ${realHeals.size} / prévu ${predHeals.size}`)
        roundTally(ok)
      }
      // Dégâts des explosions aux monstres : par monstre touché, nombre de bombes alignées qui ont explosé.
      const exploded = win.filter(y => y.t === 'cast' && y.spellName === 'Nova').map(y => (y as { cell: number }).cell)
      report.bombDamage.explosions += exploded.length
      const dm = new Map<number, number>()
      for (const y of win) if (y.t === 'damage' && y.amount > 0 && F[y.target].team === 1 && !isBombR(y.target)) dm.set(y.target, (dm.get(y.target) ?? 0) + y.amount)
      for (const [t, amount] of dm) {
        const cell = truth.cell.get(t) ?? -1
        report.bombDamage.hits.push({ target: `${who} → ${nameOf(t)}@${cell}`, amount, bombs: exploded.filter(c => inLine(c, cell)).length })
      }
      // Prévision : explosions de bombes.ts, dommages de regles.ts, sur le moteur recalé à la fin du tour du Crâ.
      sim.sync()
      applyStateRules(sim.engine, sim.fight)
      const c = sim.engine.cloneFight(sim.fight, true)
      const before = hpOf(c)
      const byGid = new Map(F.map(f => [f.gameId, f.id]))
      for (const y of h.events) {
        if (y.kind !== 'explode') continue
        const b = sim.f(byGid.get(y.who) ?? -1)
        applyNova(sim.engine, c, b ? b.cell : y.cell)
      }
      const pred = hpLoss(sim, before, c, -1)
      for (const t of new Set([...dm.keys(), ...[...pred.keys()].filter(x => F[x].team === 1 && !isBombR(x))])) {
        const rv = dm.get(t) ?? 0
        const pv = pred.get(t) ?? 0
        const died = win.some(y => y.t === 'death' && y.target === t)
        const ok = Math.abs(rv - pv) <= Math.max(10, rv * 0.03) || (died && pv >= rv)
        note(report.nova, ok, `${who} : explosions → ${nameOf(t)}@${truth.cell.get(t)} réel ${rv}, prévu ${pv}`)
      }
    }
    i = after
  }
  return report
}

function sumDamage(evs: FightEvent[], target: number): number {
  let s = 0
  for (const e of evs) if (e.t === 'damage' && e.target === target && e.amount > 0) s += e.amount
  return s
}

/** Case d'un combattant à la fin de [from, to) (dernier déplacement, poussée ou téléportation). */
function cellAfter(ev: FightEvent[], from: number, to: number, r: number, start: number): number {
  let c = start
  for (let k = from; k < to; k++) {
    const e = ev[k]
    if (e.t === 'move' && e.fighter === r) c = e.path[e.path.length - 1]
    else if ((e.t === 'push' || e.t === 'teleport') && e.target === r) c = e.to
  }
  return c
}

/** Monde des bombes (bombes.ts) d'après l'état réel : identifiants de jeu, comme le journal. */
function bombWorldOf(t: Truth): BombWorld {
  const F = t.res.fighters
  const map = data.map(MAP_ID)!
  const w: BombWorld = { walk: c => !!map.cells[c]?.walkable, players: [], bombs: [], monsters: new Set(), order: [] }
  for (const r of t.alive) {
    const f = F[r]
    const cell = t.cell.get(r)!
    if (f.monsterId === BOMB) {
      const owner = f.summonerId ?? 0
      w.bombs.push({ id: f.gameId, owner, cell, born: bornRound(t, r), blue: t.blue.has(r), alive: true })
    } else if (f.kind === 'player') w.players.push({ id: f.gameId, cell, alive: true })
    else w.monsters.add(cell)
  }
  return w
}

/** Manche d'apparition d'une bombe (événement d'invocation du replay). */
function bornRound(t: Truth, r: number): number {
  let round = 0
  for (const e of t.res.replay.events) {
    if (e.t === 'roundStart') round = e.round
    if (e.t === 'summon' && e.fighter.id === r) return round
  }
  return 0
}

// ───────────────────────────── commande ─────────────────────────────

function pct(t: { ok: number; total: number }): string {
  return t.total ? `${t.ok}/${t.total} (${Math.round((100 * t.ok) / t.total)} %)` : '—'
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('planificateur/fidelite.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i >= 0 ? process.argv[i + 1] : undefined
  }
  const file = arg('--fichier') ?? 'data/fightlogs/2026-10-10/session-08-29-54.jsonl'
  const t0 = Date.now()
  const r = measure(file, { perso: arg('--perso'), paths: process.argv.includes('--chemins') })
  const detail = process.argv.includes('--detail')
  console.log(`Fidélité du moteur — ${file} (${r.rounds} manches, ${((Date.now() - t0) / 1000).toFixed(1)} s)\n`)
  const lines: [string, Tally][] = [
    ['Déplacements (case d\'arrivée)', r.moves], ['Lancers acceptés par le moteur', r.castsAccepted],
    ['Dégâts par cible dans la fourchette', r.damage], ['Cases après poussée / échange', r.pushes], ['Morts', r.deaths],
    ['Début de tour (poisons…)', r.turnStart], ['Apparition des bombes', r.bombSpawn], ['Explosions (bombes.ts)', r.bombPhase],
    ['Dommages des explosions aux monstres', r.nova],
    ['IA des monstres (fin de tour et sorts)', r.monsterAi],
  ]
  for (const [k, t] of lines) console.log(`  ${k.padEnd(40)} ${pct(t)}`)
  console.log(`  Dégâts réels ${r.damage.real}, moteur ${r.damage.low}–${r.damage.high}`)
  const byM = new Map<string, number[]>()
  for (const a of r.aiDistance) byM.set(a.monster, [...(byM.get(a.monster) ?? []), a.d])
  const med = (l: number[]) => l.slice().sort((a, b) => a - b)[Math.floor(l.length / 2)]
  console.log(`  IA des monstres, écart prévu/réel de la case de fin (médiane, tours) : ${[...byM].map(([k, l]) => `${k} ${med(l)} (${l.length})`).join(' · ')}`)
  console.log(`  Explosions de bombes : ${r.bombDamage.explosions} ; dégâts aux monstres : ${r.bombDamage.hits.map(h => `${h.amount} (${h.bombs} alignée(s))`).join(', ') || '—'}`)
  console.log(`  Par manche : ${Object.entries(r.byRound).map(([k, v]) => `M${k} ${Math.round((100 * v.ok) / v.total)} %`).join(' · ')}`)
  if (detail) {
    for (const [k, t] of lines) {
      if (!t.notes.length) continue
      console.log(`\n${k} — écarts :`)
      for (const n of t.notes) console.log(`  ${n}`)
    }
    console.log('\nDégâts des explosions aux monstres :')
    for (const h of r.bombDamage.hits) console.log(`  ${h.target} : ${h.amount} (${h.bombs} bombe(s) alignée(s) explosée(s))`)
  }
  const out = arg('--json')
  if (out) writeFileSync(out, JSON.stringify(r, null, 2))
}
