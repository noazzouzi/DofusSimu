/**
 * Cœur du moteur de combat : création/clonage d'un combat, buffs & états, dégâts/soins, morts,
 * ordre de jeu et déroulement des tours.
 *
 * Le déplacement (move.ts), le lancement de sorts (cast.ts) et l'interprétation des effets
 * (effects/*) s'appuient sur les primitives exposées ici.
 */
import { addStats, emptyStats, type Element, type Stats, type TeamId } from '../core/types'
import type { DataStore } from '../data/store'
import type { MapData } from '../data/model'
import type {
  Buff,
  DamageKind,
  Fighter,
  FighterMetrics,
  FighterSnapshot,
  FightEvent,
  FightOptions,
  FightState,
  ScenarioHooks,
} from './types'

export interface FightSetup {
  map: MapData
  fighters: Fighter[]
  options?: Partial<FightOptions>
  scenarioId?: string
}

export const DEFAULT_OPTIONS: FightOptions = { seed: 1, rollMode: 'random', record: true, maxRounds: 60 }

/** Pourcentage d'érosion de base (part des dommages subis retirée des PV max). */
export const BASE_EROSION_PCT = 10

export class Engine {
  constructor(
    readonly data: DataStore,
    readonly scenario?: ScenarioHooks,
  ) {}

  // ───────────────────────────── création / clonage ─────────────────────────────

  createFight(setup: FightSetup): FightState {
    const options = { ...DEFAULT_OPTIONS, ...setup.options }
    const fight: FightState = {
      map: setup.map,
      fighters: [],
      timeline: [],
      turnIndex: -1,
      round: 0,
      glyphs: [],
      traps: [],
      rngState: options.seed | 0,
      nextUid: 1,
      events: [],
      options,
      ended: false,
      winner: null,
      metrics: {},
      scenarioState: {},
    }
    for (const f of setup.fighters) this.addFighter(fight, f)
    fight.timeline = this.buildTimeline(fight)
    this.emit(fight, {
      t: 'fightStart',
      mapId: setup.map.id,
      fighters: fight.fighters.map(snapshot),
      seed: options.seed,
      scenario: setup.scenarioId,
    })
    this.scenario?.onFightStart?.(fight)
    return fight
  }

  /** Copie profonde de l'état mutable (la carte et les données de sorts restent partagées). */
  cloneFight(fight: FightState, record = false): FightState {
    const c: FightState = {
      ...fight,
      fighters: fight.fighters.map(cloneFighter),
      timeline: fight.timeline.slice(),
      glyphs: fight.glyphs.map(g => ({ ...g, cells: g.cells })),
      traps: fight.traps.map(t => ({ ...t, cells: t.cells })),
      events: record ? fight.events.slice() : [],
      options: { ...fight.options, record },
      metrics: Object.fromEntries(Object.entries(fight.metrics).map(([k, v]) => [k, { ...v }])),
      scenarioState: structuredClone(fight.scenarioState),
    }
    return c
  }

  emit(fight: FightState, ev: FightEvent): void {
    if (fight.options.record) fight.events.push(ev)
  }

  log(fight: FightState, text: string, level: 'info' | 'ai' | 'warn' = 'info'): void {
    if (fight.options.record) fight.events.push({ t: 'log', text, level })
  }

  uid(fight: FightState): number {
    return fight.nextUid++
  }

  addFighter(fight: FightState, f: Fighter): Fighter {
    f.id = fight.fighters.length
    fight.fighters.push(f)
    this.recomputeStats(f)
    fight.metrics[f.id] = emptyMetrics()
    return f
  }

  // ───────────────────────────── requêtes ─────────────────────────────

  fighter(fight: FightState, id: number): Fighter {
    return fight.fighters[id]
  }

  fighterAt(fight: FightState, cell: number): Fighter | undefined {
    for (const f of fight.fighters) if (f.alive && f.cell === cell && f.carriedBy === undefined) return f
    return undefined
  }

  isCellFree(fight: FightState, cell: number): boolean {
    const c = fight.map.cells[cell]
    return !!c && c.walkable && !this.fighterAt(fight, cell)
  }

  alive(fight: FightState, team?: TeamId): Fighter[] {
    return fight.fighters.filter(f => f.alive && (team === undefined || f.team === team))
  }

  enemiesOf(fight: FightState, f: Fighter): Fighter[] {
    return fight.fighters.filter(o => o.alive && o.team !== f.team)
  }

  alliesOf(fight: FightState, f: Fighter, includeSelf = false): Fighter[] {
    return fight.fighters.filter(o => o.alive && o.team === f.team && (includeSelf || o.id !== f.id))
  }

  current(fight: FightState): Fighter | undefined {
    const id = fight.timeline[fight.turnIndex]
    return id === undefined ? undefined : fight.fighters[id]
  }

  hasState(f: Fighter, stateId: number): boolean {
    return f.states.includes(stateId)
  }

  /** Vrai si un des états du combattant porte le drapeau demandé (invulnérable, indéplaçable...). */
  stateFlag(f: Fighter, flag: keyof NonNullable<ReturnType<DataStore['state']>>): boolean {
    for (const s of f.states) {
      const st = this.data.state(s)
      if (st && st[flag]) return true
    }
    return false
  }

  // ───────────────────────────── caractéristiques & buffs ─────────────────────────────

  recomputeStats(f: Fighter): void {
    const s: Stats = addStats(emptyStats(), f.baseStats)
    const states: number[] = []
    for (const b of f.buffs) {
      if (b.delay > 0) continue
      if (b.statDelta) addStats(s, b.statDelta)
      if (b.stateId !== undefined && !states.includes(b.stateId)) states.push(b.stateId)
    }
    f.stats = s
    f.states = states
  }

  addBuff(fight: FightState, target: Fighter, buff: Omit<Buff, 'uid'>): Buff {
    const b: Buff = { ...buff, uid: this.uid(fight) }
    const hadStates = new Set(target.states)
    target.buffs.push(b)
    const before = target.stats
    this.recomputeStats(target)
    this.applyPoolDelta(fight, target, before)
    this.emit(fight, {
      t: 'buff',
      target: target.id,
      source: b.sourceId,
      spellId: b.spellId,
      label: b.label,
      duration: b.remaining,
      uid: b.uid,
    })
    this.emitStateChanges(fight, target, hadStates)
    return b
  }

  removeBuff(fight: FightState, target: Fighter, uid: number): void {
    const i = target.buffs.findIndex(b => b.uid === uid)
    if (i < 0) return
    const hadStates = new Set(target.states)
    target.buffs.splice(i, 1)
    const before = target.stats
    this.recomputeStats(target)
    this.applyPoolDelta(fight, target, before)
    this.emit(fight, { t: 'unbuff', target: target.id, uid })
    this.emitStateChanges(fight, target, hadStates)
  }

  /** Désenvoûtement : retire les buffs désenvoûtables (optionnellement seulement ceux d'un lanceur). */
  dispel(fight: FightState, target: Fighter, sourceId?: number): void {
    for (const b of target.buffs.slice()) {
      if (b.dispellable && (sourceId === undefined || b.sourceId === sourceId)) this.removeBuff(fight, target, b.uid)
    }
  }

  /**
   * Quand un buff modifie PA/PM pendant le tour, les points courants suivent la variation
   * (ex. retrait de PA en cours de tour, bonus de PM).
   */
  private applyPoolDelta(fight: FightState, f: Fighter, before: Stats): void {
    const dAp = f.stats.ap - before.ap
    const dMp = f.stats.mp - before.mp
    if (!dAp && !dMp) return
    f.ap = Math.max(0, f.ap + dAp)
    f.mp = Math.max(0, f.mp + dMp)
    this.emit(fight, { t: 'apmp', target: f.id, ap: f.ap, mp: f.mp, reason: 'buff' })
  }

  private emitStateChanges(fight: FightState, f: Fighter, had: Set<number>): void {
    if (!fight.options.record) return
    const now = new Set(f.states)
    for (const s of now) if (!had.has(s)) this.emit(fight, { t: 'state', target: f.id, stateId: s, name: this.data.state(s)?.name ?? `État ${s}`, added: true })
    for (const s of had) if (!now.has(s)) this.emit(fight, { t: 'state', target: f.id, stateId: s, name: this.data.state(s)?.name ?? `État ${s}`, added: false })
  }

  // ───────────────────────────── PV : dégâts, soins, boucliers ─────────────────────────────

  /**
   * Applique des dommages DÉJÀ calculés (après résistances) à une cible : invulnérabilités,
   * bouclier, érosion, mort. Retourne les PV effectivement retirés.
   */
  applyDamage(
    fight: FightState,
    source: Fighter | undefined,
    target: Fighter,
    amount: number,
    element: Element | -1,
    kind: DamageKind,
    opts: { crit?: boolean; melee?: boolean } = {},
  ): number {
    if (!target.alive || amount <= 0) return 0
    if (this.scenario?.canBeDamaged && !this.scenario.canBeDamaged(fight, target, source)) {
      this.log(fight, `${target.name} est invulnérable.`)
      return 0
    }
    if (this.stateFlag(target, 'invulnerable')) return 0
    if (opts.melee === true && this.stateFlag(target, 'invulnerableMelee')) return 0
    if (opts.melee === false && this.stateFlag(target, 'invulnerableRange')) return 0
    amount = Math.floor(amount)
    let absorbed = 0
    if (target.shield > 0) {
      absorbed = Math.min(target.shield, amount)
      target.shield -= absorbed
      amount -= absorbed
    }
    const lost = Math.min(target.hp, amount)
    target.hp -= lost
    const erosionPct = BASE_EROSION_PCT + (target.tags.erosionBonus as number | undefined ?? 0)
    const erosion = Math.floor((lost * erosionPct) / 100)
    if (erosion > 0) {
      target.maxHp = Math.max(1, target.maxHp - erosion)
      target.hp = Math.min(target.hp, target.maxHp)
    }
    this.emit(fight, {
      t: 'damage',
      source: source?.id ?? -1,
      target: target.id,
      amount: lost,
      element,
      kind,
      shieldAbsorbed: absorbed || undefined,
      erosion: erosion || undefined,
      crit: opts.crit,
    })
    if (source) fight.metrics[source.id].damageDealt += lost
    fight.metrics[target.id].damageTaken += lost
    if (target.hp <= 0) this.kill(fight, target, source)
    return lost
  }

  heal(fight: FightState, source: Fighter | undefined, target: Fighter, amount: number): number {
    if (!target.alive || amount <= 0) return 0
    if (this.stateFlag(target, 'incurable')) return 0
    const healed = Math.min(Math.floor(amount), target.maxHp - target.hp)
    if (healed <= 0) return 0
    target.hp += healed
    this.emit(fight, { t: 'heal', source: source?.id ?? -1, target: target.id, amount: healed })
    if (source) fight.metrics[source.id].healingDone += healed
    return healed
  }

  addShield(fight: FightState, source: Fighter | undefined, target: Fighter, amount: number): void {
    if (!target.alive || amount <= 0) return
    target.shield += Math.floor(amount)
    this.emit(fight, { t: 'shield', source: source?.id ?? -1, target: target.id, amount: Math.floor(amount) })
  }

  kill(fight: FightState, target: Fighter, killer?: Fighter): void {
    if (!target.alive) return
    target.alive = false
    target.hp = 0
    if (target.carrying !== undefined) {
      const carried = fight.fighters[target.carrying]
      carried.carriedBy = undefined
      carried.cell = target.cell
      target.carrying = undefined
    }
    if (target.carriedBy !== undefined) {
      fight.fighters[target.carriedBy].carrying = undefined
      target.carriedBy = undefined
    }
    this.emit(fight, { t: 'death', target: target.id, killer: killer?.id })
    if (killer && killer.team !== target.team) fight.metrics[killer.id].kills++
    target.cell = -1
    // Les invocations meurent avec leur invocateur.
    for (const f of fight.fighters) if (f.alive && f.summonerId === target.id) this.kill(fight, f, killer)
    // Les glyphes/pièges de la cible disparaissent.
    fight.glyphs = fight.glyphs.filter(g => g.sourceId !== target.id)
    fight.traps = fight.traps.filter(t => t.sourceId !== target.id)
    this.scenario?.onDeath?.(fight, target)
    this.checkEnd(fight)
  }

  // ───────────────────────────── ordre de jeu ─────────────────────────────

  /**
   * Timeline Dofus : chaque équipe est triée par initiative décroissante, puis les équipes alternent,
   * en commençant par celle qui possède le combattant à la plus haute initiative.
   * Les invocations jouent juste après leur invocateur.
   */
  buildTimeline(fight: FightState): number[] {
    const roots = fight.fighters.filter(f => f.alive && f.summonerId === undefined)
    const byTeam = (team: TeamId) =>
      roots.filter(f => f.team === team).sort((a, b) => initiativeOf(b) - initiativeOf(a) || a.id - b.id)
    const t0 = byTeam(0)
    const t1 = byTeam(1)
    const first = (t0[0] ? initiativeOf(t0[0]) : -1) >= (t1[0] ? initiativeOf(t1[0]) : -1) ? [t0, t1] : [t1, t0]
    const order: number[] = []
    for (let i = 0; i < Math.max(t0.length, t1.length); i++) {
      if (first[0][i]) order.push(first[0][i].id)
      if (first[1][i]) order.push(first[1][i].id)
    }
    // Invocations déjà présentes (ex. au début du combat) : insérées après leur invocateur.
    for (const s of fight.fighters.filter(f => f.alive && f.summonerId !== undefined)) this.insertSummon(order, fight, s)
    return order
  }

  /** Insère une invocation dans la timeline juste après son invocateur (et ses invocations précédentes). */
  insertSummon(order: number[], fight: FightState, summon: Fighter): void {
    if (order.includes(summon.id)) return
    let idx = order.indexOf(summon.summonerId!)
    if (idx < 0) {
      order.push(summon.id)
      return
    }
    while (idx + 1 < order.length && fight.fighters[order[idx + 1]]?.summonerId === summon.summonerId) idx++
    order.splice(idx + 1, 0, summon.id)
  }

  /** Ajoute un combattant en cours de combat (invocation, vague de monstres...). */
  spawn(fight: FightState, f: Fighter, opts: { afterId?: number } = {}): Fighter {
    this.addFighter(fight, f)
    if (f.summonerId !== undefined) {
      this.insertSummon(fight.timeline, fight, f)
    } else if (opts.afterId !== undefined && fight.timeline.includes(opts.afterId)) {
      fight.timeline.splice(fight.timeline.indexOf(opts.afterId) + 1, 0, f.id)
    } else {
      fight.timeline.push(f.id)
    }
    // Garder l'index du tour courant cohérent si on insère avant lui.
    const cur = fight.timeline.indexOf(fight.timeline[fight.turnIndex])
    if (cur >= 0) fight.turnIndex = cur
    return f
  }

  // ───────────────────────────── tours ─────────────────────────────

  /** Passe au combattant suivant vivant et démarre son tour. Retourne le combattant actif, ou undefined si fin. */
  nextTurn(fight: FightState): Fighter | undefined {
    if (fight.ended) return undefined
    for (let guard = 0; guard < fight.timeline.length * 2 + 2; guard++) {
      fight.turnIndex++
      if (fight.turnIndex >= fight.timeline.length || fight.round === 0) {
        if (fight.turnIndex >= fight.timeline.length) fight.turnIndex = 0
        fight.round++
        if (fight.round > fight.options.maxRounds) {
          this.endFight(fight, null, 'Limite de tours atteinte')
          return undefined
        }
        this.emit(fight, { t: 'roundStart', round: fight.round })
        this.scenario?.onRoundStart?.(fight)
        if (fight.ended) return undefined
        // Retirer les morts de la timeline au début de chaque tour de jeu.
        const curId = fight.timeline[fight.turnIndex]
        fight.timeline = fight.timeline.filter(id => fight.fighters[id].alive || id === curId)
        fight.turnIndex = Math.max(0, fight.timeline.indexOf(curId))
      }
      const f = fight.fighters[fight.timeline[fight.turnIndex]]
      if (!f || !f.alive) continue
      if (f.tags.skipTurns && (f.tags.skipTurns as number) > 0) {
        f.tags.skipTurns = (f.tags.skipTurns as number) - 1
        continue
      }
      this.startTurn(fight, f)
      if (fight.ended) return undefined
      if (!f.alive) continue
      return f
    }
    return undefined
  }

  startTurn(fight: FightState, f: Fighter): void {
    // Durées des effets lancés par ce combattant : décrémentées au début de son tour.
    this.decrementCastedBuffs(fight, f)
    for (const k in f.cooldowns) if (f.cooldowns[k] > 0) f.cooldowns[k]--
    f.castsThisTurn = {}
    f.castsOnTarget = {}
    this.recomputeStats(f)
    f.ap = Math.max(0, f.stats.ap)
    f.mp = Math.max(0, f.stats.mp)
    fight.metrics[f.id].turnsPlayed++
    this.emit(fight, { t: 'turnStart', fighter: f.id, ap: f.ap, mp: f.mp })
    this.scenario?.onTurnStart?.(fight, f)
    this.hooks.onTurnStart?.(fight, f)
  }

  endTurn(fight: FightState, f: Fighter): void {
    this.hooks.onTurnEnd?.(fight, f)
    this.scenario?.onTurnEnd?.(fight, f)
    this.emit(fight, { t: 'turnEnd', fighter: f.id })
  }

  /**
   * Points d'extension installés par les modules d'effets (poisons, glyphes, déclencheurs...).
   * Gardés hors de FightState pour que l'état reste clonable.
   */
  hooks: {
    onTurnStart?: (fight: FightState, f: Fighter) => void
    onTurnEnd?: (fight: FightState, f: Fighter) => void
    /** Entrée d'un combattant sur une cellule (pièges, glyphes d'entrée). */
    onEnterCell?: (fight: FightState, f: Fighter, cell: number) => void
    /** Après des dommages subis (déclencheurs de buffs réactifs). */
    onDamaged?: (fight: FightState, target: Fighter, source: Fighter | undefined, amount: number) => void
  } = {}

  private decrementCastedBuffs(fight: FightState, caster: Fighter): void {
    for (const target of fight.fighters) {
      if (!target.alive) continue
      for (const b of target.buffs.slice()) {
        if (b.sourceId !== caster.id) continue
        if (b.delay > 0) {
          b.delay--
          if (b.delay === 0) this.recomputeStats(target)
          continue
        }
        if (b.remaining < 0) continue
        b.remaining--
        if (b.remaining <= 0) this.removeBuff(fight, target, b.uid)
      }
    }
    for (const g of fight.glyphs.slice()) {
      if (g.sourceId !== caster.id || g.remaining < 0) continue
      g.remaining--
      if (g.remaining <= 0) {
        fight.glyphs = fight.glyphs.filter(x => x.uid !== g.uid)
        this.emit(fight, { t: 'glyph', glyph: { uid: g.uid, cells: g.cells, color: g.color, spellId: g.spellId }, added: false })
      }
    }
  }

  // ───────────────────────────── fin de combat ─────────────────────────────

  checkEnd(fight: FightState): void {
    if (fight.ended) return
    const scenarioResult = this.scenario?.checkEnd?.(fight)
    if (scenarioResult !== undefined) {
      if (scenarioResult !== null || fight.ended) this.endFight(fight, scenarioResult, 'Scénario')
      return
    }
    const teamAlive = (team: TeamId) => fight.fighters.some(f => f.alive && f.team === team && f.kind !== 'summon')
    if (!teamAlive(0)) this.endFight(fight, 1, 'Tous les personnages sont morts')
    else if (!teamAlive(1)) this.endFight(fight, 0, 'Tous les monstres sont morts')
  }

  endFight(fight: FightState, winner: TeamId | null, reason: string): void {
    if (fight.ended) return
    fight.ended = true
    fight.winner = winner
    fight.endReason = reason
    this.emit(fight, { t: 'fightEnd', winner, rounds: fight.round, reason })
  }
}

// ───────────────────────────── utilitaires ─────────────────────────────

export function initiativeOf(f: Fighter): number {
  // Initiative effective : initiative × PV courants / PV max (règle Dofus).
  const base = f.stats.initiative + f.stats.strength + f.stats.intelligence + f.stats.chance + f.stats.agility
  return f.maxHp > 0 ? (base * f.hp) / f.maxHp : base
}

export function emptyMetrics(): FighterMetrics {
  return { damageDealt: 0, damageTaken: 0, healingDone: 0, apRemoved: 0, mpRemoved: 0, kills: 0, turnsPlayed: 0 }
}

export function snapshot(f: Fighter): FighterSnapshot {
  return {
    id: f.id,
    team: f.team,
    kind: f.kind,
    name: f.name,
    breedId: f.breedId,
    monsterId: f.monsterId,
    level: f.level,
    hp: f.hp,
    maxHp: f.maxHp,
    ap: f.stats.ap,
    mp: f.stats.mp,
    cell: f.cell,
    summonerId: f.summonerId,
    role: f.role,
  }
}

export function cloneFighter(f: Fighter): Fighter {
  return {
    ...f,
    baseStats: f.baseStats, // immuable pendant le combat
    stats: { ...f.stats },
    states: f.states.slice(),
    buffs: f.buffs.map(b => ({ ...b })),
    spells: f.spells,
    cooldowns: { ...f.cooldowns },
    castsThisTurn: { ...f.castsThisTurn },
    castsOnTarget: { ...f.castsOnTarget },
    tags: { ...f.tags },
  }
}
