// Simulation d'un round contre la Reine des Voleurs, tour par tour, dans l'ordre du journal.
//  - Crâs : actions imposées (celles du journal, ou un tour planifié), jouées par le moteur (cibles suivies) ;
//  - monstres : contrôleurs de monstres.ts (Reine d'après le journal, monstres de vague) ;
//  - Bonbombes : apparition au début du tour de chaque Crâ (règle validée) ; explosion juste après le tour suivant de
//    leur poseur, réaction en chaîne et bombes bleues (modèle bombes.ts validé sur le combat du 2026-10-09) — la
//    mécanique propre du moteur (explosion un tour trop tôt) n'est pas utilisée ;
//  - règles du combat mesurées sur le combat réel (regles.ts) : réduction de la Reine par bombe vivante, dommages
//    partagés à parts égales entre la Doublure et sa copie, dommages des explosions aux monstres alignés.
// `RoundSim` se clone à tout moment (recherche du meilleur round, equipe.ts) ; le résultat est un replay (section
// « Combats » du simulateur web) et le résumé de chaque tour. Commande : rejouer.ts.
import { castSpell } from '../../../src/engine/cast'
import type { Engine } from '../../../src/engine/engine'
import { move } from '../../../src/engine/move'
import { summonMonster } from '../../../src/engine/effects/summons'
import type { Fighter, FightState } from '../../../src/engine/types'
import type { Replay } from '../../../src/replay/types'
import { simulateHorizon, spawnCell, type BombWorld } from './bombes'
import { BOMB, DEFAULT_SPELLS, buildFight, data, type EntitySnap, type Snapshot } from './etat'
import { snapshotAt, type Row, type TurnStep } from './journal'
import { monsterControllers } from './monstres'
import { applyCastRules, applyNova, applyStateRules, shareTwinDamage, twinHp } from './regles'

/** Sorts du journal qui ne sont pas des lancers du joueur (Péché Mignon, sorts déclenchés). */
export const NOT_PLAYER_CASTS = new Set([4693, 4692, 4691, 5952, 32558, 32998])

export interface TurnSummary {
  round: number
  gameId: number
  name: string
  actions: string[]
  endCell: number
  alive: boolean
}

export interface RoundResult {
  replay: Replay
  turns: TurnSummary[]
  /** Morts pendant la simulation (noms). */
  deaths: string[]
}

export interface RoundOptions {
  /** Actions imposées d'un Crâ (identifiant de jeu) à une manche ; absent : le Crâ passe son tour. */
  craSteps?: (round: number, gameId: number) => TurnStep[] | undefined
  /** Nombre de tours de jeu simulés (défaut : un tour complet de l'ordre de jeu). */
  turns?: number
  seed?: number
  title?: string
}

/** Pas d'un tour de Crâ : déplacement, ou lancer (cible = identifiant de jeu, suivie si elle a bougé). */
export type Step = { kind: 'move'; path: number[] } | { kind: 'cast'; spell: number; cell: number; target?: number }

interface BombMeta { owner: number; born: number; blue: boolean }

const spellName = (id: number) => data.spell(id)?.name ?? `sort ${id}`

/** Round en cours de simulation : état du moteur et tout ce que le moteur ne connaît pas (bombes, identifiants). */
export class RoundSim {
  turns: TurnSummary[] = []
  /** Tour courant commencé (début de tour fait, actions à jouer). */
  private begun = false
  private turnStartEvent = 0
  private readonly ctl: ReturnType<typeof monsterControllers>

  private constructor(
    readonly engine: Engine,
    readonly base: Snapshot,
    public fight: FightState,
    public bombs: Map<number, BombMeta>,
    public gid: Map<number, number>,
    public byGid: Map<number, number>,
    public nextGameId: number,
    public round: number,
    public idx: number,
    readonly order: number[],
    readonly groups: number[][],
    /** Le 1er tour est celui de l'instantané d'un Crâ : sa bombe de la manche y est déjà. */
    private skipSpawn: boolean,
    readonly seed: number,
  ) {
    this.ctl = monsterControllers(seed)
  }

  static fromSnapshot(snap: Snapshot, seed = 1): RoundSim {
    const b = buildFight(snap)
    const bombs = new Map<number, BombMeta>()
    for (const e of snap.entities) if (e.kind === 'bomb') bombs.set(b.byGameId.get(e.gameId)!.id, { owner: e.owner!, born: e.born!, blue: !!e.blue })
    const gid = new Map(b.gameIdOf)
    const byGid = new Map([...b.byGameId].map(([g, f]) => [g, f.id]))
    const order = snap.order.map(g => byGid.get(g)).filter((x): x is number => x !== undefined)
    const fight = b.fight
    fight.timeline = []
    for (const id of order) {
      fight.timeline.push(id)
      for (const [bid, m] of bombs) if (byGid.get(m.owner) === id) fight.timeline.push(bid)
    }
    const groups: number[][] = []
    for (const e of snap.entities) {
      if (e.linkedTo === undefined) continue
      const a = byGid.get(e.linkedTo)
      const c = byGid.get(e.gameId)
      if (a !== undefined && c !== undefined) groups.push([a, c])
    }
    fight.round = snap.round
    fight.events.push({ t: 'roundStart', round: snap.round })
    const active = byGid.get(snap.active)!
    const first = snap.entities.find(e => e.gameId === snap.active)
    return new RoundSim(b.engine, snap, fight, bombs, gid, byGid, Math.min(-17, ...snap.entities.map(e => e.gameId)) - 1, snap.round, Math.max(0, order.indexOf(active)), order, groups, first?.kind === 'cra', seed)
  }

  clone(): RoundSim {
    const c = new RoundSim(this.engine, this.base, this.engine.cloneFight(this.fight, true), new Map([...this.bombs].map(([k, v]) => [k, { ...v }])), new Map(this.gid), new Map(this.byGid), this.nextGameId, this.round, this.idx, this.order, this.groups, this.skipSpawn, this.seed)
    c.turns = this.turns.slice()
    c.begun = this.begun
    c.turnStartEvent = this.turnStartEvent
    return c
  }

  current(): Fighter | undefined {
    return this.fight.fighters[this.order[this.idx]]
  }

  nameOf(f: Fighter): string {
    const g = this.gid.get(f.id)
    return this.base.entities.find(e => e.gameId === g)?.name ?? f.name
  }

  /** Le tour courant est commencé (début de tour fait). */
  get started(): boolean {
    return this.begun
  }

  /**
   * Crâs avec qui `cra` peut échanger sa case de placement avant de commencer son tour : manche 1, Crâs qui n'ont pas
   * encore joué, intacts (PV pleins, ni état ni effet) comme lui. Les Crâs ont les mêmes caractéristiques : échanger leurs
   * cases revient à choisir un autre placement (placement.ts).
   */
  swappable(cra: Fighter): Fighter[] {
    const intact = (f: Fighter) => f.alive && f.kind === 'player' && f.hp === f.maxHp && !f.states.length && !f.buffs.length
    if (this.round !== 1 || this.begun || !intact(cra)) return []
    return this.order.slice(this.idx + 1).map(id => this.fight.fighters[id]).filter(intact)
  }

  /** Échange les cases de deux Crâs intacts avant leur tour (cases de départ du replay comprises). */
  swapCells(a: Fighter, b: Fighter): void {
    ;[a.cell, b.cell] = [b.cell, a.cell]
    const ev = this.fight.events[0]
    if (ev?.t === 'fightStart') {
      const cell = new Map([[a.id, a.cell], [b.id, b.cell]])
      this.fight.events[0] = { ...ev, fighters: ev.fighters.map(f => (cell.has(f.id) ? { ...f, cell: cell.get(f.id)! } : f)) }
    }
  }

  /** Cases de départ des combattants (événement de début de combat), par identifiant moteur. */
  startCells(): Map<number, number> {
    const ev = this.fight.events[0]
    return new Map(ev?.t === 'fightStart' ? ev.fighters.map(f => [f.id, f.cell]) : [])
  }

  // ───────────────────────────── déroulement ─────────────────────────────

  /** Début du tour courant : décomptes du moteur, puis bombe du Crâ (Péché Mignon). */
  beginTurn(): void {
    const f = this.current()
    if (!f || this.begun) return
    this.fight.turnIndex = Math.max(0, this.fight.timeline.indexOf(f.id))
    this.turnStartEvent = this.fight.events.length
    this.engine.startTurn(this.fight, f)
    if (f.kind === 'player') {
      if (!this.skipSpawn) this.spawnBomb(f)
    }
    this.skipSpawn = false
    this.begun = true
  }

  /** Actions du tour courant : pas imposés (Crâ), sinon contrôleur de monstre. */
  act(steps?: readonly Step[]): void {
    const f = this.current()
    if (!f || !this.begun || !f.alive || this.fight.ended) return
    const { engine, fight } = this
    if (f.kind === 'player') {
      for (const s of steps ?? []) {
        if (!f.alive || fight.ended) break
        applyStateRules(engine, fight)
        const twins = twinHp(fight)
        if (s.kind === 'move') move(fight, f, s.path[0] === f.cell ? s.path : [f.cell, ...s.path.slice(1)], engine)
        else if (!NOT_PLAYER_CASTS.has(s.spell)) {
          // Cible suivie : si l'entité visée a bougé, le sort part sur sa nouvelle case.
          const tid = s.target !== undefined ? this.byGid.get(s.target) : undefined
          const target = tid !== undefined ? fight.fighters[tid] : undefined
          const cell = target && target.alive && target.id !== f.id ? target.cell : s.cell
          if (!castSpell(engine, fight, f, s.spell, cell).ok && cell !== s.cell) castSpell(engine, fight, f, s.spell, s.cell)
          applyCastRules(engine, fight, f, s.spell)
        }
        shareTwinDamage(engine, fight, twins)
      }
    } else {
      applyStateRules(engine, fight)
      const twins = twinHp(fight)
      this.ctl(f).playTurn(engine, fight, f)
      shareTwinDamage(engine, fight, twins)
    }
  }

  /** Fin du tour courant : fin du moteur, explosions des bombes du Crâ, résumé, combattant suivant. */
  finishTurn(): TurnSummary | undefined {
    const f = this.current()
    if (!f || !this.begun) return undefined
    const { engine, fight } = this
    if (f.alive) engine.endTurn(fight, f)
    else fight.events.push({ t: 'turnEnd', fighter: f.id })
    const actions: string[] = []
    for (const e of fight.events.slice(this.turnStartEvent)) {
      if (e.t === 'move' && e.fighter === f.id) actions.push(`→${e.path.at(-1)}`)
      if (e.t === 'cast' && e.fighter === f.id) {
        const occ = fight.fighters.find(x => x.alive && x.cell === e.cell && x.id !== f.id)
        actions.push(`${spellName(e.spellId)}@${e.cell}${occ ? ` (${this.nameOf(occ)})` : ''}`)
      }
    }
    if (f.kind === 'player') this.explodeAfter(f)
    const t: TurnSummary = { round: this.round, gameId: this.gid.get(f.id)!, name: this.nameOf(f), actions, endCell: f.cell, alive: f.alive }
    this.turns.push(t)
    this.begun = false
    this.idx++
    if (this.idx >= this.order.length) {
      this.idx = 0
      this.round++
      fight.round = this.round
      fight.events.push({ t: 'roundStart', round: this.round })
    }
    return t
  }

  /**
   * Joue les tours des monstres (et saute les morts) jusqu'au prochain tour de Crâ, commencé si `begin` (prêt pour
   * `snapshot()` / `act()`). `maxTurns` borne le nombre de tours parcourus.
   */
  advanceToCra(maxTurns = this.order.length, begin = true): void {
    for (let n = 0; n < maxTurns && !this.fight.ended; n++) {
      const f = this.current()
      if (!f || !f.alive) {
        this.begun = false
        this.idx++
        if (this.idx >= this.order.length) {
          this.idx = 0
          this.round++
          this.fight.round = this.round
          this.fight.events.push({ t: 'roundStart', round: this.round })
        }
        continue
      }
      if (f.kind === 'player') {
        if (begin) this.beginTurn()
        return
      }
      this.beginTurn()
      this.act()
      this.finishTurn()
    }
  }

  /** État courant comme instantané au début du tour du Crâ courant (planificateur d'un tour). */
  snapshot(): Snapshot {
    const entities: EntitySnap[] = []
    for (const f of this.fight.fighters) {
      if (!f.alive) continue
      const g = this.gid.get(f.id)!
      const e0 = this.base.entities.find(e => e.gameId === g)
      const bm = this.bombs.get(f.id)
      if (bm) entities.push({ name: f.name, kind: 'bomb', gameId: g, monsterId: BOMB, cell: f.cell, owner: bm.owner, born: bm.born, blue: bm.blue })
      else if (f.kind === 'player') entities.push({ name: this.nameOf(f), kind: 'cra', gameId: g, cell: f.cell, hp: f.hp, maxHp: f.maxHp, ap: f.ap, mp: f.mp, spells: e0?.spells ?? DEFAULT_SPELLS, cooldowns: { ...f.cooldowns } })
      else entities.push({ name: this.nameOf(f), kind: 'monster', gameId: g, monsterId: f.monsterId, cell: f.cell, hp: f.hp, maxHp: f.maxHp, linkedTo: e0?.linkedTo, cooldowns: { ...f.cooldowns } })
    }
    const cur = this.current()
    return { mapId: this.base.mapId, round: this.round, active: cur ? this.gid.get(cur.id)! : this.base.active, order: this.base.order, entities, source: `simulation, manche ${this.round}` }
  }

  replay(title: string): Replay {
    return { events: this.fight.events, map: this.fight.map, meta: { title, description: this.base.source ?? '' } }
  }

  deaths(): string[] {
    return (this.fight.deaths ?? []).map(d => this.fight.fighters[d.fighter]).filter(f => f && !this.bombs.has(f.id)).map(f => this.nameOf(f))
  }

  // ───────────────────────────── bombes et PV partagés ─────────────────────────────

  private world(): BombWorld {
    const s = this.fight
    const w: BombWorld = { walk: c => !!s.map.cells[c]?.walkable, players: [], bombs: [], monsters: new Set(), order: [] }
    for (const f of s.fighters) {
      if (!f.alive) continue
      const m = this.bombs.get(f.id)
      if (m) w.bombs.push({ id: this.gid.get(f.id)!, owner: m.owner, cell: f.cell, born: m.born, blue: m.blue, alive: true })
      else if (f.kind === 'player') w.players.push({ id: this.gid.get(f.id)!, cell: f.cell, alive: true })
      else w.monsters.add(f.cell)
    }
    return w
  }

  private spawnBomb(cra: Fighter): void {
    const cell = spawnCell(this.world(), cra.cell)
    if (cell < 0) return
    const f = summonMonster(this.engine, this.fight, cra, BOMB, 1, cell, { noStartingSpell: true })
    if (!f) return
    const g = this.nextGameId--
    this.gid.set(f.id, g)
    this.byGid.set(g, f.id)
    f.name = `Bombe ${this.nameOf(cra)}`
    // Nom affiché par le replay : celui de l'événement d'invocation.
    for (let i = this.fight.events.length - 1; i >= 0; i--) {
      const e = this.fight.events[i]
      if (e.t === 'summon' && e.fighter.id === f.id) {
        e.fighter = { ...e.fighter, name: f.name }
        break
      }
    }
    this.bombs.set(f.id, { owner: this.gid.get(cra.id)!, born: this.round, blue: false })
  }

  private explodeAfter(cra: Fighter): void {
    const g = this.gid.get(cra.id)!
    const h = simulateHorizon({ ...this.world(), order: [g] }, g, this.round)
    for (const e of h.events) {
      const id = this.byGid.get(e.who)
      const f = id !== undefined ? this.fight.fighters[id] : undefined
      if (!f) continue
      if (e.kind === 'explode' && f.alive) {
        this.engine.log(this.fight, `${f.name} explose (${this.bombs.get(f.id)?.blue ? 'bleue' : 'rouge'})`)
        // Dommages aux monstres alignés (1000 Feu moins résistances, regles.ts), puis la bombe disparaît.
        applyNova(this.engine, this.fight, f.cell)
        this.engine.kill(this.fight, f)
      } else if (e.kind === 'blue') {
        const m = this.bombs.get(f.id)
        if (m) m.blue = true
        this.engine.log(this.fight, `${f.name} devient bleue`)
      } else if (e.kind === 'death' && f.alive) {
        this.engine.log(this.fight, `${this.nameOf(f)} est tué par l'explosion d'une bombe`)
        this.engine.kill(this.fight, f)
      } else if (e.kind === 'heal' && f.alive) {
        f.hp = f.maxHp
        this.engine.log(this.fight, `${this.nameOf(f)} est soigné par une bombe bleue`)
      }
    }
  }
}

/**
 * Simule `opts.turns` tours (défaut : un tour complet de l'ordre de jeu) à partir du début du tour de `snap.active` ;
 * les Crâs jouent `opts.craSteps`.
 */
export function simulateRound(snap: Snapshot, opts: RoundOptions = {}): RoundResult {
  const sim = RoundSim.fromSnapshot(snap, opts.seed ?? 1)
  const total = opts.turns ?? sim.order.length
  for (let n = 0; n < total && !sim.fight.ended; n++) {
    const f = sim.current()
    if (!f || !f.alive) {
      sim.advanceToCra(1)
      continue
    }
    sim.beginTurn()
    sim.act(f.kind === 'player' ? opts.craSteps?.(sim.round, sim.gid.get(f.id)!) : undefined)
    sim.finishTurn()
  }
  return { replay: sim.replay(opts.title ?? 'Reine des Voleurs — round simulé'), turns: sim.turns, deaths: sim.deaths() }
}

/** Actions d'un Crâ à une manche, relevées dans le journal. */
export function journalSteps(rows: Row[], names: Record<number, string>): (round: number, gameId: number) => TurnStep[] | undefined {
  const cache = new Map<string, TurnStep[] | undefined>()
  return (round, gameId) => {
    const k = `${round}:${gameId}`
    if (!cache.has(k)) {
      try {
        cache.set(k, snapshotAt(rows, round, gameId, names).actual.steps)
      } catch {
        cache.set(k, undefined)
      }
    }
    return cache.get(k)
  }
}
