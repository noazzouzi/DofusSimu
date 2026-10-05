/**
 * Contexte d'un tour de monstre (docs/design/ai.md §11.2 `MonsterContext`) — WP1.
 *
 * Regroupe ce que le cerveau, le score, la position et les hooks lisent : vue honnête (§6.1 : positions crues, pièges
 * connus, jamais `fight.events` ni les dés futurs), profil et comportement résolus, poids, table DPT partagée du moteur,
 * ordre public des prochains tours, et des caches « par pas » (instantané de la racine, ordre, α des PM) invalidés par
 * `refresh()` après chaque action (R10, R11, R18 : tout a pu changer) ; menaces, portées d'attaque et focale sont
 * calculées une fois par tour (monster-ai.md §8.4 « pré-calculé au début de chaque tour »).
 *
 * Menace d'un ennemi (§11.4) : `threat_e` = DPT du joueur sur le monstre qui décide (approximation de « sur l'équipe
 * des monstres », voir `threatOf`), 0 s'il ne jouera pas son prochain tour ou s'il est sous un état « ne peut pas
 * infliger de dommages » couvrant ce tour. `apWorth = threat/PA`, `mpWorth = α·threat/max(1, PM)`, α = 0,15 s'il
 * frappe un monstre depuis sa case actuelle, 0,6 s'il doit se déplacer.
 */
import type { TeamId } from '../../core/types'
import type { Engine } from '../../engine/engine'
import { performAction } from '../../engine/runner'
import { canCast } from '../../engine/cast'
import { isStaticFighter } from '../../engine/targetMask'
import type { Action, AiNoteKind, Fighter, FightState } from '../../engine/types'
import { distance, inLine, isInCastRange } from '../../map/geometry'
import { castGeom, levelFor, LosOracle } from '../core/castCells'
import { buildOccupancy, cachedReach } from '../core/reach'
import { createDptTable, type DptTableImpl } from '../core/dpt'
import { createSpellProfileIndex, type SpellProfileIndexX, type SpellProfileX } from '../core/spellProfile'
import { flagAtNextTurn, hpEff, nextTurnApMp } from '../core/threat'
import { SlotOrder } from '../core/timeline'
import { believedCell, createView } from '../core/view'
import { harmlessEnterGlyph } from './position'
import type { AIConfig, AIView, MonsterSetting, ReachInfo } from '../types'
import type { ArchetypeInfo } from './archetype'
import { defaultWeights, resolveProfile } from './profiles'
import type { Behaviour, MonsterAIProfile, ScoreWeights } from './types'

/** Instantané de la racine d'un pas (valeurs « avant » du score, par id de combattant). */
export interface RootSnapshot {
  s: FightState
  hpEff: Float64Array
  apNext: Float64Array
  mpNext: Float64Array
  /** uids des buffs de chaque combattant (désenvoûtements, nouveaux buffs). */
  buffUids: (Set<number> | undefined)[]
  /** 1 : valeurs du combattant calculées (`MonsterContext.root`). */
  ready: Uint8Array
}

const ROOT_TMP = { ap: 0, mp: 0 }

export class MonsterContext {
  readonly view: AIView
  readonly team: TeamId
  readonly profile: MonsterAIProfile
  readonly archetype: ArchetypeInfo
  /** Comportement de base (profil, archétype ou effet 2188). */
  readonly baseBehaviour: Behaviour
  readonly w: ScoreWeights
  readonly dpt: DptTableImpl
  readonly profiles: SpellProfileIndexX
  /** Numéro du pas courant (0 = premier choix du tour). */
  step = 0
  /** Sorts lancés par le cerveau pendant ce tour (ids, dans l'ordre). */
  readonly casts: number[] = []
  /** Action offensive réussie ce tour (bascule R12). */
  offensive = false
  /** Une attaque simulée sur un ennemi n'a rien produit (invulnérable, résistances, renvoi) : condition R13. */
  sawBlocked = false
  private snap: RootSnapshot | undefined
  private orderMemo: SlotOrder | undefined
  /** Menaces des ennemis : calculées une fois par tour (monster-ai.md §8.4, « pré-calculé au début de chaque tour »). */
  private readonly threatMemo = new Map<number, number>()
  private readonly alphaMemo = new Map<number, number>()
  /** Portée d'attaque (PM + portée) par ennemi, pour le tour (recalculée si ses PM changent). */
  private readonly reachMemo = new Map<number, { mp: number; v: number }>()
  /** Focale du tour (recalculée si elle meurt). */
  private focalMemo: Fighter | null | undefined
  private healerMemo: boolean | undefined
  /** État « de marche » du pas (voir `walkState`) et état dont il est tiré. */
  private walkMemo: FightState | undefined
  private walkSrc: FightState | undefined

  constructor(
    readonly engine: Engine,
    public fight: FightState,
    readonly me: Fighter,
    readonly cfg: AIConfig,
    readonly setting: MonsterSetting,
  ) {
    this.team = me.team
    this.view = createView(engine, fight, me, cfg.seed)
    const r = resolveProfile(engine, me)
    this.profile = r.profile
    this.archetype = r.archetype
    this.baseBehaviour = r.behaviour
    this.w = r.profile.weights ? { ...defaultWeights(cfg.theta), ...r.profile.weights } : defaultWeights(cfg.theta)
    this.dpt = createDptTable(engine)
    this.profiles = createSpellProfileIndex(engine)
  }

  /** Comportement de déplacement effectif : un peureux en mode agressif (R12) se déplace comme un agressif. */
  get behaviour(): Behaviour {
    if (this.baseBehaviour === 'fearful' && this.me.tags.aiFearAggro === true) return 'aggressive'
    return this.baseBehaviour
  }

  /** Profils analytiques des sorts du monstre (ordre de `me.spells`). */
  spellProfiles(f: Fighter = this.me): readonly SpellProfileX[] {
    return this.profiles.ofFighter(f)
  }

  // ───────────────────────────── camps ─────────────────────────────

  /** `f` est-il une cible offensive ? (fou : tout le monde sauf lui — INCERTAIN, monster-ai.md §3). */
  isEnemy(f: Fighter): boolean {
    if (f.id === this.me.id) return false
    return this.baseBehaviour === 'mad' ? true : f.team !== this.team
  }

  isAlly(f: Fighter): boolean {
    return f.id !== this.me.id && f.team === this.team && this.baseBehaviour !== 'mad'
  }

  /** Ennemis visibles vivants (case crue ≥ 0) de l'état `s`. */
  enemies(s: FightState = this.fight): Fighter[] {
    const out: Fighter[] = []
    for (const f of s.fighters) {
      if (!f.alive || f.carriedBy !== undefined || !this.isEnemy(f)) continue
      if (believedCell(f, this.team) < 0) continue
      out.push(f)
    }
    return out
  }

  /** Alliés vivants placés (hors soi). */
  allies(s: FightState = this.fight): Fighter[] {
    const out: Fighter[] = []
    for (const f of s.fighters) if (f.alive && f.cell >= 0 && f.carriedBy === undefined && this.isAlly(f)) out.push(f)
    return out
  }

  /** v(e) : 1 pour un personnage, `summonValue` pour une invocation, 0 pour une invocation statique (§11.4). */
  damageValue(e: Fighter): number {
    if (isStaticFighter(e)) return 0
    return e.kind === 'summon' || e.summonerId !== undefined ? this.w.summonValue : 1
  }

  // ───────────────────────────── ordre, menace ─────────────────────────────

  /** Ordre public des prochains tours (combattant courant exclu), mis en cache par pas. */
  order(): SlotOrder {
    return (this.orderMemo ??= new SlotOrder(this.engine, this.fight))
  }

  /**
   * Menace d'un ennemi (voir l'en-tête), calculée une fois par tour (la table DPT met en cache les paires). Défenseur de
   * référence : le monstre qui décide (approximation de « DPT sur l'équipe des monstres » : le maximum sur toute
   * l'équipe coûtait un sac à dos par paire et par pas — ×10 sur une vague du Vortex — pour un écart de quelques % dû
   * aux résistances) ; un monstre statique ou sans PV utile prend le premier allié non statique.
   */
  threatOf(e: Fighter): number {
    const memo = this.threatMemo.get(e.id)
    if (memo !== undefined) return memo
    const order = this.order()
    let v = 0
    if (e.alive && !isStaticFighter(e) && !order.passes(e.id) && !flagAtNextTurn(this.engine, e, 'cantDealDamage', order)) {
      const d = this.referenceDefender()
      if (d) v = this.dpt.dpt(e, d)
    }
    this.threatMemo.set(e.id, v)
    return v
  }

  /** Défenseur de référence de la menace : soi, sinon le premier monstre allié non statique. */
  private referenceDefender(): Fighter | undefined {
    const me = this.fight.fighters[this.me.id] ?? this.me
    if (me.alive && !isStaticFighter(me)) return me
    return this.defenders()[0]
  }

  /** Monstres de l'équipe (soi compris) qu'un ennemi peut viser : vivants, placés, non statiques. */
  private defenders(): Fighter[] {
    const out: Fighter[] = []
    for (const f of this.fight.fighters) {
      if (!f.alive || f.cell < 0 || isStaticFighter(f)) continue
      if (f.id === this.me.id || (f.team === this.team && this.baseBehaviour !== 'mad')) out.push(f)
    }
    return out
  }

  /** α de `mpWorth` : 0,15 si `e` frappe un monstre depuis sa case actuelle, 0,6 s'il doit se déplacer. */
  alphaMp(e: Fighter): number {
    const memo = this.alphaMemo.get(e.id)
    if (memo !== undefined) return memo
    const a = this.hitsFromCell(e) ? 0.15 : 0.6
    this.alphaMemo.set(e.id, a)
    return a
  }

  /** `e` peut-il toucher un monstre (sort de dégâts, portée, ligne de vue) sans bouger ? */
  private hitsFromCell(e: Fighter): boolean {
    const cell = believedCell(e, this.team)
    if (cell < 0) return false
    const profiles = this.profiles.ofFighter(e)
    const defenders = this.defenders()
    let los: LosOracle | undefined
    for (let i = 0; i < e.spells.length; i++) {
      const p = profiles[i]
      if (!p.damage.length) continue
      const lvl = levelFor(e, e.spells[i])
      const g = castGeom(e, lvl)
      for (const d of defenders) {
        if (g.max === 0) {
          if (distance(cell, d.cell) <= Math.max(1, p.zoneRadius)) return true
          continue
        }
        if (!isInCastRange(cell, d.cell, g.min, g.max, g.line, g.diag)) continue
        if (!lvl.castTestLos || distance(cell, d.cell) <= 1) return true
        los ??= new LosOracle(this.fight, this.team, e.id)
        if (los.los(cell, d.cell)) return true
      }
    }
    return false
  }

  /** Portée d'attaque d'un ennemi au prochain tour : PM + portée max de ses sorts de dégâts (danger, §11.5). */
  attackReach(e: Fighter): number {
    const memo = this.reachMemo.get(e.id)
    if (memo !== undefined && memo.mp === e.stats.mp) return memo.v
    const order = this.order()
    const mp = nextTurnApMp(e, order).mp
    let range = -1
    const profiles = this.profiles.ofFighter(e)
    for (let i = 0; i < e.spells.length; i++) {
      const p = profiles[i]
      if (!p.damage.length) continue
      const g = castGeom(e, levelFor(e, e.spells[i]))
      const r = g.max === 0 ? Math.max(1, p.zoneRadius) : g.max
      if (r > range) range = r
    }
    const v = range < 0 ? -1 : Math.floor(mp) + range
    this.reachMemo.set(e.id, { mp: e.stats.mp, v })
    return v
  }

  /** Un ennemi peut-il soigner ses alliés (valeur d'Insoignable) ? */
  enemyHasHealer(): boolean {
    if (this.healerMemo !== undefined) return this.healerMemo
    let v = false
    for (const e of this.enemies()) {
      if (this.profiles.ofFighter(e).some(p => p.heals.some(h => h.sides.ally && !h.sides.selfOnly))) {
        v = true
        break
      }
    }
    return (this.healerMemo = v)
  }

  /** Meilleur lancer unique de `a` sur `d` (espérance calibrée). */
  bestSingle(a: Fighter, d: Fighter): number {
    return this.dpt.bestCast(a, d).mean * this.dpt.calibration(a)
  }

  /** Meilleur DPT de `holder` sur un ennemi de son camp (valeur des buffs). */
  bestDpt(holder: Fighter, s: FightState = this.fight): number {
    let best = 0
    for (const e of s.fighters) {
      if (!e.alive || e.cell < 0 || e.team === holder.team || isStaticFighter(e)) continue
      const v = this.dpt.dpt(holder, e)
      if (v > best) best = v
    }
    return best
  }

  /**
   * Espérance du prochain coup porté sur `e` par un allié du monstre qui joue avant `e` (bonus « prochain coup »,
   * §11.4) : meilleur lancer unique ; le lanceur compte aussi s'il lui reste `apLeft` PA pour un autre sort de dégâts.
   */
  nextAllyHit(e: Fighter, s: FightState, apLeft: number, exceptSpell = -1): number {
    const order = this.order()
    let best = 0
    for (const a of s.fighters) {
      if (!a.alive || a.cell < 0 || a.id === this.me.id || !this.isAlly(a) || isStaticFighter(a)) continue
      if (!order.before(a.id, e.id) || order.passes(a.id)) continue
      const v = this.bestSingle(a, e)
      if (v > best) best = v
    }
    if (apLeft > 0) {
      const me = s.fighters[this.me.id] ?? this.me
      const profiles = this.profiles.ofFighter(me)
      for (let i = 0; i < me.spells.length; i++) {
        const p = profiles[i]
        if (!p.damage.length || me.spells[i].spellId === exceptSpell) continue
        if (levelFor(me, me.spells[i]).apCost > apLeft) continue
        const v = this.dpt.perCast(me, i, e).mean * this.dpt.calibration(me)
        if (v > best) best = v
      }
    }
    return best
  }

  /**
   * Cible focale : ennemi de plus grande valeur d'attaque au prochain tour (dégâts plafonnés + bonus de kill, décotée
   * selon la distance), sinon le plus proche ; départage : plus proche puis plus petit id.
   */
  focal(): Fighter | undefined {
    if (this.focalMemo !== undefined) {
      const f = this.focalMemo ? this.fight.fighters[this.focalMemo.id] : undefined
      if (this.focalMemo === null || (f && f.alive)) return f ?? undefined
    }
    const me = this.me
    const enemies = this.enemies()
    const w = this.w
    const mpNow = Math.max(0, Math.floor(me.mp))
    const mpNext = Math.max(0, Math.floor(me.stats.mp))
    let range = 1
    for (let i = 0; i < me.spells.length; i++) {
      const p = this.spellProfiles()[i]
      if (!p.damage.length) continue
      const g = castGeom(me, levelFor(me, me.spells[i]))
      range = Math.max(range, g.max === 0 ? Math.max(1, p.zoneRadius) : g.max)
    }
    let best: Fighter | null = null
    let bestV = -1
    let bestD = 1e9
    for (const e of enemies) {
      const cell = believedCell(e, this.team)
      const d = distance(me.cell, cell)
      const v = this.damageValue(e)
      const dmg = this.dpt.dpt(me, e)
      const he = hpEff(e)
      let val = w.wDmg * v * Math.min(dmg, he) + (dmg >= he && dmg > 0 ? w.wKill * (w.kappa * e.maxHp + this.threatOf(e)) : 0)
      const horizon = mpNow + mpNext + range
      if (d > horizon) val *= Math.pow(0.5, (d - horizon) / Math.max(1, mpNext))
      if (val > bestV + 1e-9 || (Math.abs(val - bestV) <= 1e-9 && (d < bestD || (d === bestD && best !== null && e.id < best.id)))) {
        best = e
        bestV = val
        bestD = d
      }
    }
    this.focalMemo = best
    return best ?? undefined
  }

  // ───────────────────────────── instantané de la racine ─────────────────────────────

  /**
   * Instantané de la racine du pas (voir `RootSnapshot`) : les valeurs d'un combattant sont calculées à la demande
   * (`root(id)`), seulement pour ceux qu'un candidat a modifiés.
   */
  snapshot(): RootSnapshot {
    if (this.snap && this.snap.s === this.fight) return this.snap
    const n = this.fight.fighters.length
    return (this.snap = {
      s: this.fight,
      hpEff: new Float64Array(n),
      apNext: new Float64Array(n),
      mpNext: new Float64Array(n),
      buffUids: new Array(n),
      ready: new Uint8Array(n),
    })
  }

  /** Instantané de la racine avec les valeurs du combattant `id` calculées. */
  root(id: number): RootSnapshot {
    const snap = this.snapshot()
    if (snap.ready[id]) return snap
    snap.ready[id] = 1
    const f = snap.s.fighters[id]
    if (!f || !f.alive) return snap
    snap.hpEff[id] = hpEff(f)
    nextTurnApMp(f, this.order(), ROOT_TMP)
    snap.apNext[id] = ROOT_TMP.ap
    snap.mpNext[id] = ROOT_TMP.mp
    if (f.buffs.length) snap.buffUids[id] = new Set(f.buffs.map(b => b.uid))
    return snap
  }

  /**
   * État « de marche » du pas pour l'accessibilité du monstre : le combat courant dont les glyphes « à l'entrée » SANS
   * effet sur lui (masques : glyphes 1165 des monstres du Vortex qui ne visent que les personnages, glyphes alliées
   * d'un adversaire…) sont retirées. `move` (src/engine/move.ts) ne s'arrête que sur les pièges : une telle glyphe se
   * traverse librement, alors que l'accessibilité du socle contourne toute glyphe « à l'entrée » (case-événement).
   * Objet superficiel (mêmes combattants, carte, pièges) : seulement LU (accessibilité, chemins), jamais simulé.
   */
  walkState(): FightState {
    if (this.walkMemo && this.walkSrc === this.fight) return this.walkMemo
    const s = this.fight
    this.walkSrc = s
    let keep: typeof s.glyphs | undefined
    for (let i = 0; i < s.glyphs.length; i++) {
      const g = s.glyphs[i]
      if (!harmlessEnterGlyph(s, g, this.me)) {
        if (keep) keep.push(g)
        continue
      }
      keep ??= s.glyphs.slice(0, i)
    }
    return (this.walkMemo = keep ? { ...s, glyphs: keep } : s)
  }

  /** Accessibilité du monstre (PM et PA courants) sur l'état de marche — résultat partagé du cache du socle (lecture seule). */
  reach(): ReachInfo {
    return cachedReach(this.engine, this.walkState(), this.me, this.team, this.me.mp, this.me.ap, buildOccupancy(this.fight, this.team))
  }

  // ───────────────────────────── actions ─────────────────────────────

  /** Joue une action sur le combat (succès), puis invalide les caches. */
  perform(a: Action): boolean {
    if (this.fight.ended || !this.me.alive) return false
    const r = performAction(this.engine, this.fight, this.me, a)
    if (r.ok && a.type === 'cast') this.casts.push(a.spellId)
    this.refresh()
    return r.ok
  }

  /** Invalide les caches « par pas » (après chaque action réelle). */
  refresh(): void {
    this.step++
    this.clearCaches()
  }

  /** Caches « par pas » (menaces, portées et focale restent ceux du tour). */
  private clearCaches(): void {
    this.snap = undefined
    this.orderMemo = undefined
    this.alphaMemo.clear()
    this.healerMemo = undefined
    this.walkMemo = this.walkSrc = undefined
  }

  /**
   * Évalue `fn` avec l'état `s` (un clone) pour racine, sans compter de pas ni toucher au combat : suite d'un lancer
   * (overrides, anticipation). Les caches de la vraie racine sont restaurés ensuite.
   */
  withRoot<T>(s: FightState, fn: () => T): T {
    const saved = { fight: this.fight, snap: this.snap, order: this.orderMemo, alpha: new Map(this.alphaMemo), healer: this.healerMemo }
    this.fight = s
    this.clearCaches()
    try {
      return fn()
    } finally {
      this.fight = saved.fight
      this.snap = saved.snap
      this.orderMemo = saved.order
      this.healerMemo = saved.healer
      this.alphaMemo.clear()
      for (const [k, v] of saved.alpha) this.alphaMemo.set(k, v)
    }
  }

  /** Annotation de l'IA pour le replay (E3), seulement si `cfg.explain` et combat enregistré. */
  note(kind: AiNoteKind, text: string, cells?: number[], targets?: number[]): void {
    if (!this.cfg.explain || !this.fight.options.record) return
    this.engine.emit(this.fight, { t: 'aiNote', fighter: this.me.id, kind, text, cells, targets })
  }

  // ───────────────────────────── aides des hooks ─────────────────────────────

  hasState(f: Fighter, stateId: number): boolean {
    return f.states.includes(stateId)
  }

  /** Combattant vivant sur une case (positions crues). */
  fighterAt(cell: number, s: FightState = this.fight): Fighter | undefined {
    for (const f of s.fighters) if (f.alive && f.carriedBy === undefined && believedCell(f, this.team) === cell) return f
    return undefined
  }

  /** Ennemis alignés (même x ou même y) avec `cell`. */
  enemiesAlignedWith(cell: number, s: FightState = this.fight): Fighter[] {
    return this.enemies(s).filter(e => {
      const c = believedCell(e, this.team)
      return c !== cell && inLine(c, cell)
    })
  }

  /** Ennemis à distance ≤ r de `cell`. */
  enemiesWithin(cell: number, r: number, s: FightState = this.fight): Fighter[] {
    return this.enemies(s).filter(e => distance(believedCell(e, this.team), cell) <= r)
  }

  /** Le sort `spellId` est-il lançable maintenant sur `cell` (depuis la case actuelle) ? */
  canCastOn(spellId: number, cell: number): boolean {
    const ks = this.me.spells.find(s => s.spellId === spellId)
    return !!ks && canCast(this.engine, this.fight, this.me, ks, cell) === null
  }
}
