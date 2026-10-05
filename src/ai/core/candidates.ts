/**
 * Génération générique des candidats et préfiltre `quick` (docs/design/ai.md §8.1, §11.3) — WP1, partagé par les
 * joueurs (WP2) et les monstres.
 *
 * Règles du §8.1 implémentées ici (celles qui relèvent du socle) :
 *  C1 filtre statique avant toute géométrie (PA, relance, lancers par tour, états du lanceur, preventsSpellCast, sort
 *     `unsupported` si `unsupportedSpells = 'skip'`, sorts réservés) ;
 *  C2 sorts à cible entité : cases occupées dont l'occupant est accepté par le masque d'au moins un effet ; un ennemi
 *     invulnérable n'est retenu que si le sort retire un état ou déplace (R9) ;
 *  C3 sorts de zone : centres dont la zone touche ≥ 1 cible utile, les 6 meilleurs par poids rapide (cibles
 *     pondérées, tir ami soustrait) ;
 *  C4 sorts à case libre (invocation, téléportation, glyphe, piège) : ≤ 8 cases (les plus proches des ennemis, plus 2
 *     éloignées pour les téléportations du lanceur) ;
 *  C5 sorts sur soi : case actuelle (et cases atteintes si la zone autour du lanceur touche un ennemi) ;
 *  C6 portée inverse (anneau précalculé) ∩ `reach` ;
 *  C7 ≤ 3 cases de lancer par (sort, cible), triées par (PA perdus au tacle, PM dépensés, `cellIncoming`) ; la case
 *     actuelle est toujours gardée si elle est valide ;
 *  C8 dominance : même sort, même cible, même classe de danger de la case finale ⇒ la moins coûteuse en PM.
 * C9-C12 (rejets après simulation, mouvements seuls, profondeur) relèvent de la recherche (WP2).
 *
 * `quickEstimate` (sans clone) : dégâts analytiques plafonnés × v_e + P(kill)·valeur, retraits × apWorth/mpWorth,
 * Pacifiste, poussées, soins plafonnés, boucliers utiles, buffs (Δpotentiel approché), tir ami. Sert seulement à TRIER.
 */
import type { TeamId } from '../../core/types'
import { expectedApMpRemoved } from '../../damage/apmp'
import { heal as healFormula } from '../../damage/heal'
import type { ScenarioAIModel } from '../../dungeons/types'
import { matchesTargetMask } from '../../engine/targetMask'
import type { Engine } from '../../engine/engine'
import { createMonsterFighter } from '../../engine/factory'
import type { Fighter, FightState, KnownSpell } from '../../engine/types'
import { CELL_COUNT, cellInDirection, distance } from '../../map/geometry'
import { pullDirection, pushDirection } from '../../engine/effects/movement/drag'
import { availableSummonSlots, summonSlotCost } from '../../engine/effects/summons'
import { compileZone, zoneEfficiency, zoneMembership } from '../../map/zones'
import type { ZoneSpec } from '../../data/model'
import type { AIView, Blackboard, MacroAction, Perception, ReachInfo } from '../types'
import { castCellsFor, castFailureStatic, castGeom, castGeometryOk, inverseRange, LosOracle, levelFor } from './castCells'
import { calibrationOf, createDptTable, type DptTableImpl } from './dpt'
import { killProbability, killValueNow } from './kill'
import type { PerceptionX } from './perception'
import { damageWeightOf, type ValueWeights } from './potential'
import { apSpent, buildOccupancy, cachedReach, mpSpent, reachPath } from './reach'
import { createSpellProfileIndex, zoneRadius, type SpellProfileX } from './spellProfile'
import { hpEff } from './threat'
import { believedCell } from './view'

export interface GenerateOptions {
  perception?: Perception
  /** Accessibilité précalculée de `me` sur `s`. */
  reach?: ReachInfo
  /** Cases de lancer gardées par (sort, cible) — C7 (défaut 3). */
  maxCastCells?: number
  /** Centres de zone gardés par sort — C3 (défaut 6). */
  maxZoneCenters?: number
  /** Cases libres gardées par sort — C4 (défaut 8). */
  maxFreeCells?: number
  /** 'skip' (défaut) : sorts `unsupported` exclus (C1). */
  unsupportedSpells?: 'skip' | 'allow'
  /** Sorts réservés (intentions `reserve`) exclus. */
  reserved?: ReadonlySet<number>
  /** Calculer `prior` avec `quickEstimate` (défaut : vrai si une perception est fournie). */
  withPrior?: boolean
  scenario?: ScenarioAIModel
  bb?: Blackboard
}

type QuickWeights = ValueWeights & { incoming: number; control?: number; potBefore?: number; potAfter?: number; continuation?: number }
const DEFAULT_WEIGHTS: QuickWeights = { monsterDamage: 1, summonDamage: 0.5, killKappa: 0.3, killTau: 1, incoming: 0.8 }

function weightsOf(p?: Perception): QuickWeights {
  return (p as PerceptionX | undefined)?.theta?.value ?? DEFAULT_WEIGHTS
}

/** Combattants visibles (case crue par l'équipe) : [fighter, case]. */
function visibleFighters(s: FightState, team: TeamId): { f: Fighter; cell: number }[] {
  const out: { f: Fighter; cell: number }[] = []
  for (const f of s.fighters) {
    if (!f.alive || f.carriedBy !== undefined) continue
    const c = believedCell(f, team)
    if (c >= 0) out.push({ f, cell: c })
  }
  return out
}

/** Le sort a-t-il un effet (non visuel) dont le masque accepte `t` (lanceur `me`) ? */
function someEffectAccepts(p: SpellProfileX, me: Fighter, t: Fighter): boolean {
  for (const e of p.level.effects) {
    if (e.clientOnly) continue
    if (matchesTargetMask(e.targetMask, me, t)) return true
  }
  return false
}

/** Cible « utile » pour un sort : ennemi si le sort agit sur les ennemis, allié pour soin/buff, soi pour les buffs. */
function usefulTarget(p: SpellProfileX, me: Fighter, t: Fighter): number {
  const enemy = t.team !== me.team
  if (enemy) {
    if (p.damage.length || p.apRemoval || p.mpRemoval || p.enemyDebuff || p.moves.length || p.states.length || p.received.length) return 1
    return 0
  }
  if (t.id === me.id) return p.selfBuff || p.heals.length || p.shields.length || p.moves.length ? 1 : 0
  if (p.heals.length || p.shields.length || p.allyBuff || p.moves.length || p.removesStates) return 1
  return p.damage.length ? -1 : 0
}

/**
 * Candidats génériques de `me` sur `s` (déplacement optionnel puis lancer), règles C1-C8. Clé déterministe
 * « spellId:cell:caseDeLancer ».
 */
export function generateCasts(view: AIView, s: FightState, me: Fighter, opts: GenerateOptions = {}): MacroAction[] {
  const out: MacroAction[] = []
  if (!me.alive) return out
  const engine = view.engine
  const team = view.team
  const p = opts.perception as PerceptionX | undefined
  const profiles = (p?.profiles ?? createSpellProfileIndex(engine)).ofFighter(me)
  const occ = buildOccupancy(s, team)
  const meCell = believedCell(me, team)
  if (meCell < 0) return out
  const reach = opts.reach ?? cachedReach(engine, s, me, team, me.mp, me.ap, occ)
  const los = new LosOracle(s, team, me.id, occ)
  const maxCells = opts.maxCastCells ?? 3
  const maxCenters = opts.maxZoneCenters ?? 6
  const maxFree = opts.maxFreeCells ?? 8
  const skipUnsupported = (opts.unsupportedSpells ?? 'skip') === 'skip'
  const withPrior = opts.withPrior ?? !!p
  const fighters = visibleFighters(s, team)
  const cells: number[] = []
  const threat = p?.threat
  if (p && withPrior) p.sync(s)

  const emit = (ks: KnownSpell, prof: SpellProfileX, target: number, from: number): void => {
    const path = from === meCell ? undefined : reachPath(reach, meCell, from) ?? undefined
    if (from !== meCell && !path) return
    const m: MacroAction = { cast: { spellId: ks.spellId, cell: target }, cat: prof.cat, prior: 0, key: `${ks.spellId}:${target}:${from}` }
    if (path) m.path = path
    if (withPrior && p) m.prior = quickEstimate(view, s, me, m, p, { scenario: opts.scenario, bb: opts.bb })
    out.push(m)
  }

  /** C6/C7/C8 : cases de lancer d'un (sort, cible). */
  const castFrom = (ks: KnownSpell, prof: SpellProfileX, target: number): void => {
    const lvl = levelFor(me, ks)
    castCellsFor(s, me, ks, lvl, target, reach, los, Math.max(12, maxCells * 4), cells)
    if (!cells.length) return
    const ranked = cells.slice()
    ranked.sort((a, b) => {
      if (a === meCell) return -1
      if (b === meCell) return 1
      return apSpent(reach, a) - apSpent(reach, b) || mpSpent(reach, a) - mpSpent(reach, b) || a - b
    })
    const classes = new Set<number>()
    let kept = 0
    for (const c of ranked) {
      if (kept >= maxCells) break
      // C8 : classe de danger de la case finale (quartiles de PV effectifs menacés).
      let cls = 0
      if (threat) {
        const inc = threat.cellIncoming(me, c)
        cls = Math.min(4, Math.floor((4 * inc) / Math.max(1, hpEff(me))))
      }
      const key = cls * 4 + Math.min(3, apSpent(reach, c))
      if (classes.has(key) && c !== meCell) continue
      classes.add(key)
      emit(ks, prof, target, c)
      kept++
    }
  }

  for (let i = 0; i < me.spells.length; i++) {
    const ks = me.spells[i]
    const prof = profiles[i]
    if (skipUnsupported && prof.unsupported) continue
    if (opts.reserved?.has(ks.spellId)) continue
    const lvl = levelFor(me, ks)
    if (castFailureStatic(engine, me, ks, lvl, me.ap) !== null) continue
    const g = castGeom(me, lvl)

    // C5 : sorts sur soi (portée 0).
    if (g.max === 0) {
      const centers: { c: number; w: number }[] = []
      if (reach.apLeft[meCell] >= lvl.apCost) centers.push({ c: meCell, w: 1e9 })
      if (prof.zoneRadius > 0 && prof.zone) {
        for (let k = 0; k < reach.count; k++) {
          const c = reach.cells[k]
          if (c === meCell || reach.apLeft[c] < lvl.apCost) continue
          const w = zoneWeight(prof, me, c, c, fighters, i, p)
          if (w > 0) centers.push({ c, w })
        }
      }
      centers.sort((a, b) => b.w - a.w || a.c - b.c)
      for (const { c } of centers.slice(0, maxCenters)) {
        if (castGeometryOk(s, me, ks, lvl, g, c, c, los)) emit(ks, prof, c, c)
      }
      continue
    }

    // C4 : case libre nécessaire (invocation, téléportation, glyphe, piège).
    if (lvl.needFreeCell) {
      const enemyCells: number[] = []
      for (const x of fighters) if (x.f.team !== me.team) enemyCells.push(x.cell)
      // Cases libres à portée de marche + lancer, classées par distance à l'ennemi le plus proche puis par id (tri
      // par paquets de distance : linéaire).
      const bound = g.max + Math.floor(me.mp)
      const walk = walkableOf(s)
      const ring = inverseRange({ min: 0, max: bound, line: false, diag: false }, meCell)
      const buckets: number[][] = []
      for (let k = 0; k < ring.length; k++) {
        const c = ring[k]
        if (occ[c] >= 0 || !walk[c]) continue
        let d = 99
        for (let e = 0; e < enemyCells.length; e++) {
          const de = distance(c, enemyCells[e])
          if (de < d) d = de
        }
        ;(buckets[d] ??= []).push(c)
      }
      const cand: number[] = []
      for (const b of buckets) if (b) for (const c of b.sort((x, y) => x - y)) cand.push(c)
      const selfMove = prof.moves.some(mv => mv.onCaster)
      const order = selfMove ? [...cand.slice(0, maxFree), ...cand.slice(-2).reverse()] : cand
      let kept = 0
      const seen = new Set<number>()
      for (const c of order) {
        if (kept >= maxFree + (selfMove ? 2 : 0)) break
        if (seen.has(c)) continue
        seen.add(c)
        castCellsFor(s, me, ks, lvl, c, reach, los, 1, cells)
        if (!cells.length) continue
        emit(ks, prof, c, cells[0])
        kept++
      }
      continue
    }

    // C2 : sorts monocibles (zone ponctuelle) sur entités.
    if (prof.zoneRadius === 0) {
      for (const { f, cell } of fighters) {
        if (usefulTarget(prof, me, f) <= 0) continue
        if (!someEffectAccepts(prof, me, f)) continue
        if (f.team !== me.team && engine.stateFlag(f, 'invulnerable') && !prof.removesStates && !prof.moves.length) continue
        castFrom(ks, prof, cell)
      }
      continue
    }

    // C3 : sorts de zone — centres qui touchent au moins une cible utile. Zone orientée (ligne, cône, demi-cercle…) :
    // l'orientation dépend de la case de lancer, les couples (centre, case de lancer) sont donc évalués ensemble.
    const r = prof.zoneRadius
    const zc = prof.zone ? compileZone(prof.zone) : null
    const directional = !!zc && (zc.orientation !== 0 || zc.shape === 'l')
    const useful = fighters.filter(x => usefulTarget(prof, me, x.f) > 0)
    // Centres candidats (ordre d'insertion déterministe) ; marqueur par case réutilisé entre les sorts.
    const centerList = CENTER_LIST
    centerList.length = 0
    const walk = walkableOf(s)
    // Zones diagonales (« + », carrés…) : une case à r diagonales est à 2r pas ; l'appartenance est vérifiée ensuite.
    // Grandes zones (« toute la carte », lignes de 63) : centres limités à 8 pas de la cible (au-delà, aucun centre
    // n'apporte de cible de plus et l'énumération coûtait ~600 centres par cible).
    const span = Math.min(2 * r, 8)
    for (const { cell } of useful) {
      const around = inverseRange({ min: 0, max: span, line: false, diag: false }, cell)
      for (let k = 0; k < around.length; k++) {
        const c = around[k]
        if (CENTER_SEEN[c] || !walk[c]) continue
        if (!directional && !zoneMembership(prof.zone!, c, meCell)(cell)) continue
        CENTER_SEEN[c] = 1
        centerList.push(c)
      }
    }
    // Options : (centre, case de lancer, poids ; cibles utiles touchées calculées à la demande). Zone non orientée :
    // la case de lancer est choisie ensuite par `castFrom` (C7/C8).
    const options: { c: number; from: number; w: number; touched: number[] | null }[] = []
    for (const c of centerList) {
      CENTER_SEEN[c] = 0
      if (!directional) {
        const w0 = zoneWeight(prof, me, c, meCell, fighters, i, p)
        if (w0 > 0) options.push({ c, from: -1, w: w0, touched: null })
        continue
      }
      castCellsFor(s, me, ks, lvl, c, reach, los, Math.max(12, maxCells * 4), cells)
      for (const from of cells) {
        const w = zoneWeight(prof, me, c, from, fighters, i, p)
        if (w > 0) options.push({ c, from, w, touched: null })
      }
    }
    const touchedOf = (o: { c: number; from: number; touched: number[] | null }): number[] => {
      if (!o.touched) {
        const inZone = zoneMembership(prof.zone!, o.c, o.from < 0 ? meCell : o.from)
        o.touched = []
        for (const x of useful) if ((o.from < 0 || x.f.id !== me.id) && inZone(x.cell)) o.touched.push(x.f.id)
      }
      return o.touched
    }
    options.sort((a, b) => b.w - a.w || a.c - b.c || a.from - b.from)
    // Couverture d'abord : chaque cible utile touchée par au moins une option retenue, puis complément par poids.
    const covered = new Set<number>()
    const chosen = new Set<number>()
    let kept = 0
    for (let pass = 0; pass < 2 && kept < maxCenters; pass++) {
      for (let oi = 0; oi < options.length && kept < maxCenters; oi++) {
        const o = options[oi]
        if (chosen.has(oi)) continue
        if (pass === 0 && !touchedOf(o).some(id => !covered.has(id))) continue
        const before = out.length
        if (o.from < 0) castFrom(ks, prof, o.c)
        else emit(ks, prof, o.c, o.from)
        if (out.length > before) {
          chosen.add(oi)
          kept++
          for (const id of touchedOf(o)) covered.add(id)
        }
      }
    }
  }
  return out
}

/** Marqueurs des centres de zone (C3), remis à zéro après chaque sort. */
const CENTER_SEEN = new Uint8Array(CELL_COUNT)
const CENTER_LIST: number[] = []
/** Cases marchables d'une carte (1 = marchable), calculées une fois par carte. */
const WALKABLE = new WeakMap<object, Uint8Array>()
function walkableOf(s: FightState): Uint8Array {
  let w = WALKABLE.get(s.map)
  if (!w) {
    w = new Uint8Array(CELL_COUNT)
    for (let c = 0; c < CELL_COUNT; c++) w[c] = s.map.cells[c]?.walkable ? 1 : 0
    WALKABLE.set(s.map, w)
  }
  return w
}

/** Poids rapide d'un centre de zone : cibles utiles touchées (dégâts par lancer si disponibles), tir ami soustrait. */
function zoneWeight(prof: SpellProfileX, me: Fighter, center: number, casterCell: number, fighters: { f: Fighter; cell: number }[],
                    spellIndex: number, p?: PerceptionX): number {
  if (!prof.zone) return 0
  const inZone = zoneMembership(prof.zone, center, casterCell)
  let w = 0
  for (const { f, cell } of fighters) {
    if (!inZone(cell)) continue
    const u = usefulTarget(prof, me, f)
    if (u === 0) continue
    const eff = zoneEfficiency(prof.zone, center, cell, casterCell)
    const dmg = p && prof.damage.length ? p.dpt.perCast(me, spellIndex, f).mean : 100
    w += u > 0 ? eff * Math.max(1, dmg) : -0.6 * eff * Math.max(1, dmg)
  }
  return w
}

// ───────────────────────────── préfiltre ─────────────────────────────

const ELEMENT_STATS = new Set(['strength', 'intelligence', 'chance', 'agility'])
const RES_STATS = new Set(['neutralResPct', 'earthResPct', 'fireResPct', 'waterResPct', 'airResPct', 'allResPct', 'meleeResPct', 'rangedResPct', 'spellResPct'])

/** Valeur approchée (Δ potentiel / Δ menace) d'un buff `+value stat` sur l'allié `f` (potentiel `pot`, incoming `inc`). */
function buffValue(stat: string, value: number, f: Fighter, pot: number, inc: number): number {
  const st = f.stats as unknown as Record<string, number>
  if (stat === 'ap') return (pot / Math.max(1, f.stats.ap)) * value
  if (stat === 'mp') return 0.1 * pot * Math.min(value, 3)
  if (stat === 'power' || stat === 'spellPower') return (pot * value) / (100 + Math.max(0, f.stats.power) + 800)
  if (ELEMENT_STATS.has(stat)) return (0.5 * pot * value) / (100 + Math.max(0, st[stat] ?? 0) + Math.max(0, f.stats.power))
  if (stat === 'damage' || stat.endsWith('Damage')) return stat === 'criticalDamage' ? 0.3 * value : 3 * value
  if (stat === 'finalDamagePct' || stat === 'spellDamagePct' || stat === 'meleeDamagePct' || stat === 'rangedDamagePct') return (pot * value) / 100
  if (RES_STATS.has(stat)) return (0.5 * inc * value) / 100
  if (stat === 'range') return 0.05 * pot
  return 0.02 * pot
}

/**
 * Case d'arrivée d'une entité en `pos` poussée (ou attirée) de `cells` cases par un sort lancé depuis `from` sur
 * `target` : direction du moteur (`pushDirection`), arrêt avant une case non marchable ou occupée (vue de l'équipe ;
 * le lanceur sur `from`). Les collisions ne sont pas valorisées ici (la simulation les voit).
 */
function displacedCell(s: FightState, team: TeamId, casterId: number, from: number, target: number, pos: number, push: boolean,
                       cells: number): number {
  const dir = push ? pushDirection(from, target, pos) : pullDirection(from, target, pos)
  if (dir < 0) return pos
  let cur = pos
  for (let k = 0; k < cells; k++) {
    const next = cellInDirection(cur, dir)
    if (next < 0 || !s.map.cells[next]?.walkable) break
    if (next === from) break
    let busy = false
    for (const o of s.fighters) {
      if (!o.alive || o.carriedBy !== undefined || o.id === casterId) continue
      if (believedCell(o, team) === next) {
        busy = true
        break
      }
    }
    if (busy) break
    cur = next
  }
  return cur
}

/** Invocation « gabarit » (caractéristiques avec la part de l'invocateur) par (invocateur, monstre, grade). */
const SUMMON_TEMPLATES = new WeakMap<Fighter['stats'], Map<number, Fighter | null>>()
function summonTemplate(engine: Engine, me: Fighter, monsterId: number, grade: number): Fighter | null {
  if (!(monsterId > 0)) return null
  let byMe = SUMMON_TEMPLATES.get(me.stats)
  if (!byMe) SUMMON_TEMPLATES.set(me.stats, (byMe = new Map()))
  const k = monsterId * 64 + grade
  let t = byMe.get(k)
  if (t === undefined) {
    try {
      t = engine.data.monster(monsterId)
        ? createMonsterFighter(engine.data, { monsterId, grade, team: me.team, cell: -1, summonerId: me.id, summoner: me })
        : null
      if (t) t.id = 30000 + (k % 2000)
    } catch {
      t = null
    }
    byMe.set(k, t)
  }
  return t
}

/**
 * Potentiel approché d'une invocation posée sur `cell` (§6.6, sans accessibilité exacte) : meilleur ennemi à distance
 * ≤ PM + portée de ses sorts à dégâts, [min(DPT, PV effectifs)·v_e].
 */
function summonPotential(dpt: DptTableImpl, t: Fighter, cell: number, s: FightState, team: TeamId, w: ValueWeights,
                         scenario?: ScenarioAIModel, bb?: Blackboard): number {
  const profiles = dpt.profiles.ofFighter(t)
  let range = -1
  for (const p of profiles) if (p.damage.length && p.maxRange > range) range = p.maxRange
  if (range < 0) return 0
  const reachD = Math.max(0, t.stats.mp) + Math.max(1, range)
  let best = 0
  for (const e of s.fighters) {
    if (!e.alive || e.team === team || e.carriedBy !== undefined) continue
    const ec = believedCell(e, team)
    if (ec < 0 || distance(ec, cell) > reachD) continue
    const v = damageWeightOf(e, w, scenario, bb)
    if (v <= 0) continue
    const val = Math.min(dpt.dpt(t, e), hpEff(e)) * v
    if (val > best) best = val
  }
  return best
}

/** Sort lancé par une macro (premier lancer) et sa case de lancer. */
function castOf(m: MacroAction, meCell: number): { spellId: number; cell: number; from: number } | null {
  if (m.cast) return { spellId: m.cast.spellId, cell: m.cast.cell, from: m.path && m.path.length ? m.path[m.path.length - 1] : meCell }
  return null
}

/**
 * Estimation analytique (PVe) d'une macro-action, sans clone (§8.1). Séquences : somme des étapes (cases de lancer
 * successives). Sert seulement à TRIER (test T-prefilter).
 */
export function quickEstimate(view: AIView, s: FightState, me: Fighter, m: MacroAction, perception: Perception,
                              opts: { bb?: Blackboard; scenario?: ScenarioAIModel } = {}): number {
  if (m.seq && m.seq.length) {
    let v = m.cast || m.path ? quickEstimate(view, s, me, { ...m, seq: undefined }, perception, opts) : 0
    for (const x of m.seq) v += quickEstimate(view, s, me, x, perception, opts)
    return v
  }
  const meCell = believedCell(me, view.team)
  const c = castOf(m, meCell)
  if (!c) return 0
  const p = perception as PerceptionX
  const dpt: DptTableImpl = p.dpt ?? createDptTable(view.engine)
  const si = me.spells.findIndex(x => x.spellId === c.spellId)
  if (si < 0) return 0
  const prof = dpt.profiles.ofFighter(me)[si]
  const w = weightsOf(p)
  const scenario = opts.scenario ?? p.scenario
  const bb = opts.bb ?? p.bb
  const threat = p.threat
  const potential = p.potential
  const calib = calibrationOf(me)
  // Zone des dégâts : zone principale, ou zone « couronne » pour un sort qui ne touche pas sa case d'impact (case libre
  // exigée : Propulsion, Vajra — la zone principale y est ponctuelle et vide).
  const zone = prof.aim === 'ring' && prof.ringZone ? prof.ringZone : prof.zone
  const inZone = zone && zoneRadius(zone) > 0 ? zoneMembership(zone, c.cell, c.from) : null
  // w_pot de V : 0,35 si l'allié joue avant l'ennemi le plus menaçant, 0,15 sinon.
  let topThreatId = -1
  let topThreat = 0
  for (const row of threat.enemies) {
    if (row.active && row.threat > topThreat) {
      topThreat = row.threat
      topThreatId = row.e.id
    }
  }
  const potWeight = (f: Fighter): number =>
    topThreatId < 0 || threat.order.before(f.id, topThreatId) ? (w.potBefore ?? 0.35) : (w.potAfter ?? 0.15)
  // Appartenance d'une cible à la zone d'UNE ligne (zone et masque propres à la ligne, centre = case ciblée) : 0 si
  // non touchée, sinon l'efficacité de zone.
  const zm = new Map<ZoneSpec, (cell: number) => boolean>()
  const lineEff = (zone: ZoneSpec, mask: string, f: Fighter, cell: number): number => {
    let mem = zm.get(zone)
    if (!mem) zm.set(zone, (mem = zoneMembership(zone, c.cell, c.from)))
    if (!mem(cell) || !matchesTargetMask(mask, me, f)) return 0
    return zoneEfficiency(zone, c.cell, cell, c.from)
  }
  // Case finale du lanceur : case de lancer (chemin) puis téléportation éventuelle.
  let dest = c.from
  if (prof.moves.some(mv => mv.onCaster && (mv.kind === 'teleport' || mv.kind === 'swap' || mv.kind === 'symmetric'))) dest = c.cell
  let value = 0
  for (const f of s.fighters) {
    if (!f.alive || f.carriedBy !== undefined) continue
    const cell = f.id === me.id ? c.from : believedCell(f, view.team)
    if (cell < 0) continue
    const enemy = f.team !== me.team
    const he = hpEff(f)
    // Dégâts : zone principale du sort (masques appliqués ligne par ligne par `perCast`).
    if (prof.damage.length && (inZone ? inZone(cell) : cell === c.cell)) {
      const eff = inZone ? zoneEfficiency(zone!, c.cell, cell, c.from) : 1
      const cd = dpt.perCast(me, si, f)
      // Placement de la cible : case d'impact (lignes qui touchent le centre) ou reste de la zone.
      const atCenter = cell === c.cell
      const mean = (atCenter ? cd.centerMean : cd.ringMean) ?? cd.mean
      const variance = (atCenter ? cd.centerVar : cd.ringVar) ?? cd.variance
      const dmg = mean * eff * calib
      if (dmg > 0) {
        if (enemy) {
          const v = damageWeightOf(f, w, scenario, bb)
          // Même valeur de kill que V : prix du scénario (heure et étoile courantes), sinon κ·PVmax + τ·menace.
          const killValue = killValueNow(s, f, w, () => potential.enemyThreat(f), scenario, bb)
          value += Math.min(dmg, he) * v + killProbability(dmg, variance * eff * eff, f.hp + f.shield) * killValue
        } else {
          value -= 0.6 * Math.min(dmg, he) + (dmg >= f.hp + f.shield ? f.baseMaxHp : 0)
        }
      }
    }
    if (enemy) {
      const th = threat.threatOf(f)
      // Retraits de PA/PM qui couvrent le prochain tour de l'ennemi : Δ incoming recalculé par le modèle de menace
      // (PM restants ⇒ cases de lancer, PA restants ⇒ DPT, cible prédite) + terme de contrôle, comme V.
      let dAp = 0
      let dMp = 0
      for (const r of prof.removals) {
        if (r.delay > 0 || r.duration < 1 || !lineEff(r.zone, r.mask, f, cell)) continue
        const pool = r.pool
        const pts = Math.max(0, f.stats[pool] - (pool === 'ap' ? dAp : dMp))
        const removed = r.dodgeable
          ? expectedApMpRemoved(pool === 'ap' ? me.stats.apReduction : me.stats.mpReduction, pool === 'ap' ? f.stats.apParry : f.stats.mpParry, pts, pts, Math.round(r.value))
          : Math.min(pts, r.value)
        if (pool === 'ap') dAp += removed
        else dMp += removed
      }
      if (dAp > 0 || dMp > 0) {
        value -= w.incoming * threat.removalDelta(f, dAp, dMp, me.id, dest)
        const row = threat.rowOf(f)
        const alpha = row && row.hitsFromStart ? 0.15 : 0.6
        value += (w.control ?? 0.15) * (dAp * (th / Math.max(1, f.stats.ap)) + dMp * ((alpha * th) / Math.max(1, f.stats.mp)))
      }
      let pacified = false
      for (const st of prof.states) {
        if (st.remove || !lineEff(st.zone, st.mask, f, cell)) continue
        const data = view.engine.data.state(st.stateId)
        if (data?.cantDealDamage && st.duration >= 1 && !pacified) {
          // Pacifiste couvrant le prochain tour : sa part de l'incoming disparaît (comme dans V).
          pacified = true
          value += w.incoming * threat.contribution(f)
        } else if (data?.cantBeMoved || data?.cantSwitchPosition) value += 0.05 * th
        else value += 0.02 * th
      }
      // Poussée / attirance / échange : Δ incoming avec l'ennemi sur sa case d'arrivée (recalcul local de la menace).
      let moved = false
      for (const mv of prof.moves) {
        if (moved || !lineEff(mv.zone, mv.mask, f, cell)) continue
        let dest = -1
        if (mv.kind === 'push' || mv.kind === 'pull') dest = displacedCell(s, view.team, me.id, c.from, c.cell, cell, mv.kind === 'push', mv.cells)
        else if (mv.kind === 'swap' && mv.onCaster && cell === c.cell) dest = c.from
        if (dest >= 0 && dest !== cell) {
          moved = true
          value -= w.incoming * threat.movedDelta(f, dest)
        }
      }
      for (const rl of prof.received) if (rl.pct > 100 && lineEff(rl.zone, rl.mask, f, cell)) value += ((rl.pct - 100) / 100) * 0.5 * th
      if (prof.removesStates && cell === c.cell && view.engine.stateFlag(f, 'invulnerable')) value += 0.3 * f.maxHp
      continue
    }
    // Alliés (soi compris).
    const pot = potential.potential(f.id)
    const inc = threat.incoming(f.id)
    // Même pondération que V : Δpotentiel × w_pot (selon que l'allié joue avant l'ennemi le plus menaçant).
    const wPot = potWeight(f)
    // Retraits subis : potentiel perdu (PA : proportionnel ; PM : la moitié au plus, la cible peut déjà être à portée).
    for (const r of prof.removals) {
      if (r.duration < 1 || (r.delay > 0 && !(f.id === me.id && r.delay <= 1)) || !lineEff(r.zone, r.mask, f, cell)) continue
      const pts = Math.max(0, f.stats[r.pool])
      const frac = Math.min(1, Math.min(pts, r.value) / Math.max(1, pts))
      value -= wPot * pot * (r.pool === 'ap' ? frac : 0.5 * frac)
    }
    const missing = f.maxHp - f.hp
    if (missing > 0) {
      for (const h of prof.heals) {
        const eff = lineEff(h.zone, h.mask, f, cell)
        if (!eff) continue
        const base = (h.min + h.max) / 2
        const amount = h.kind === 'pctMax' ? (base * f.maxHp) / 100 : h.kind === 'fixed' ? base : healFormula(base, me.stats, { element: h.element >= 0 ? (h.element as 0) : undefined })
        value += 0.9 * Math.min(amount * h.p * eff, missing) * (1 + (1 - f.hp / Math.max(1, f.maxHp)))
      }
    }
    for (const sh of prof.shields) {
      const eff = lineEff(sh.zone, sh.mask, f, cell)
      if (!eff) continue
      const amount = sh.kind === 'pctLevel' ? (sh.value * me.level) / 100 : sh.kind === 'pctMaxHp' ? (sh.value * me.maxHp) / 100 : sh.value
      // Même poids que V (allyLife : 0,8·bouclier).
      value += 0.8 * amount * eff * (f.kind === 'summon' ? 0.4 : 1)
    }
    for (const st of prof.stats) {
      if (st.sign < 0 || !lineEff(st.zone, st.mask, f, cell)) continue
      if (st.stat === 'vitality') {
        // PV gagnés (allyLife) : vitalité ⇒ PV et PV max ; 1078/1033 en % des PV max de début de combat.
        const hp = st.pctBaseLife ? (st.value * f.baseMaxHp) / 100 : st.value
        value += hp * (f.kind === 'summon' ? 0.4 : 1)
        continue
      }
      value += wPot * buffValue(st.stat, st.value, f, pot, inc)
      // PA/PM gagnés tout de suite par le lanceur : suite du tour (terme continuation de V).
      if (f.id === me.id && (st.stat === 'ap' || st.stat === 'mp')) {
        const per = pot / Math.max(1, st.stat === 'ap' ? f.stats.ap : 3 * f.stats.mp)
        value += (w.continuation ?? 0.8) * per * Math.min(st.value, st.stat === 'ap' ? 6 : 3)
      }
    }
    // Allié échangé (portage, Transposition) : il finit sur la case de lancer.
    if (f.id !== me.id && cell === c.cell && prof.moves.some(mv => mv.kind === 'swap' && mv.onCaster && matchesTargetMask(mv.mask, me, f))) {
      value -= w.incoming * threat.cellIncomingTeamDelta(f, c.from)
    }
  }
  // Déplacement du lanceur — Δ des dégâts attendus sur l'équipe.
  if (dest !== meCell && dest >= 0 && dest < CELL_COUNT) value -= w.incoming * threat.cellIncomingTeamDelta(me, dest)
  const occupied = s.fighters.some(f => f.alive && f.carriedBy === undefined && (f.id === me.id ? c.from : believedCell(f, view.team)) === c.cell)
  let summonedOnce = false
  if (prof.summonLines.length && !occupied) {
    // Même valeur que V : PV de l'invocation × ω (0,4) + menace détournée (leurre : `decoyDelta`, π recalculé).
    const bypass = view.engine.data.spell(c.spellId)?.bypassSummoningLimit === true
    let slots = me.kind === 'player' && !bypass ? availableSummonSlots(s, me) : Infinity
    for (const sl of prof.summonLines) {
      if (sl.revive) {
        const dead = s.fighters.some(f => !f.alive && f.team === me.team && f.kind === 'player')
        if (dead) value += 0.5 * me.baseMaxHp
        continue
      }
      // Limite d'invocations (comme le moteur, summons.ts) : plus de place ⇒ le sort n'invoque rien.
      const md = view.engine.data.monster(sl.monsterId)
      const cost = md ? summonSlotCost(md) : 0
      if (cost > 0 && slots < cost) continue
      slots -= cost
      const tmpl = summonTemplate(view.engine, me, sl.monsterId, sl.grade)
      const hp = tmpl ? tmpl.maxHp : 0.3 * me.baseMaxHp
      value += 0.4 * hp - w.incoming * threat.decoyDelta(c.cell, hp, tmpl?.stats.tackleBlock ?? 0)
      // Potentiel de l'invocation (elle joue juste après : w_pot « avant »), ennemis à portée de marche + sort.
      if (tmpl) value += (w.potBefore ?? 0.35) * summonPotential(dpt, tmpl, c.cell, s, view.team, w, scenario, bb)
      // L'invocation joue juste après son invocateur : les ennemis suivants passent à ω = 0,8 (comme dans V).
      if (!summonedOnce) value += w.incoming * threat.allyInsertedGain()
      summonedOnce = true
    }
  }
  if (prof.glyph || prof.trap) value += 100
  if (bb) {
    for (const it of bb.intents) {
      if (it.owner !== me.id || it.target === undefined) continue
      const t = s.fighters[it.target]
      if (!t || !t.alive) continue
      const tc = believedCell(t, view.team)
      const hit = inZone ? inZone(tc) : tc === c.cell
      if (hit && ((it.kind === 'control' && m.cat === 'control') || it.kind === 'burst' || it.kind === 'protect' || it.kind === 'cleanse')) value += 0.5 * it.price
    }
  }
  return value
}
