// Planificateur de tour du Sacrieur Terre dans la Tanière du Meulou (seul, avec des mules qui passent leurs tours).
// Même recherche que le Féca (tools/feca/planificateur.ts) : une case de tir, un faisceau de sorts joués par le vrai
// moteur (portée, ligne de vue, PA, limites, déplacements, jets moyens), une case de fin. Stratégie :
// docs/strategies/meulou-sacrieur/README.md §3, tirée du donjon joué à la main le 2026-10-19 (§6).
//
// Un tour vaut par la vitesse à laquelle il vide la salle, sans mettre le Sacrieur en danger :
//  + PV retirés aux monstres (plafonnés à leurs PV ; Meulou un peu plus) et monstres tués (selon leurs dommages par
//    tour, Mergranlou et Cocholou en plus : soins, +200 Puissance, dommages subis ×115 %) ;
//  ± PV du Sacrieur gagnés (vol de vie) ou perdus (Entaille, Transfusion…), comptés selon ce qu'il lui reste : peu à
//    PV pleins, beaucoup sous la moitié (Entaille au lieu de Bain de Sang tant qu'il a de la marge) ;
//  + Mutilation lancée une fois par combat, tôt ;
//  + Couronne d'Épines : bouclier, et renvoi des coups de contact aux ennemis à son contact, selon les monstres de
//    contact qui le frapperont à leur tour ;
//  + case de fin : ennemis au contact (Bain de Sang au tour suivant) ou à portée d'Attirance et de Ravage ;
//  − monstres qui pourront le frapper sur sa case de fin, comptés selon ses PV (peu à PV pleins).
// Sorts écartés : ceux des autres éléments (Agilité 270, Intelligence 125, Chance 0), Hostilité (éloigne les monstres
// de Bain de Sang), Berserk, Libation, Sacrifice, Épée Vorace (tuée au 1er tour le 2026-10-19).
import { canCast, castSpell } from '../../src/engine/cast'
import { move, reachableCells } from '../../src/engine/move'
import type { Fighter, FightState, KnownSpell } from '../../src/engine/types'
import { distance, inLine, neighborsOf } from '../../src/map/geometry'
import type { FStep } from '../reine-des-voleurs/planificateur/formation'
import type { EtatCombat } from '../ventre-de-la-baleine/etat'
import { threats as threatMap, type Placed } from '../ventre-de-la-baleine/menaces'
import type { Moteur } from '../ventre-de-la-baleine/moteur'
import type { BaleinePlan, PlanOptions } from '../ventre-de-la-baleine/planificateur'
import { AU_CONTACT, COCHOLOU, DANGER_SACRI, MERGRANLOU, MEULOU, SORT, souffranceDe, SOUFFRANCE } from './meulou'

export type SacriPlan = BaleinePlan

/** Sorts que le planificateur peut lancer (les autres sorts équipés sont écartés, voir l'en-tête). */
export const SORTS_PERMIS = new Set<number>([
  SORT.entaille, SORT.punition, SORT.ravage, SORT.decimation, SORT.supplice, SORT.bainDeSang, SORT.afflux,
  SORT.transfusion, SORT.mutilation, SORT.couronneEpines, SORT.attirance, SORT.transposition, SORT.assaut,
])

/** Poids de la note. */
export const W = {
  /** Par PV retiré à un monstre ; ×`boss` sur le Meulou (il se soigne : 2 000 par Rage, la moitié de ses Étripages). */
  degats: 1, boss: 1.15,
  /** Monstre tué : `tue` + `tueDanger` × ses dommages par tour (DANGER_SACRI) + bonus par espèce. */
  tue: 400, tueDanger: 3,
  tueBonus: { [MERGRANLOU]: 300, [COCHOLOU]: 300, [MEULOU]: 2500 } as Record<number, number>,
  /** Salle vidée pendant ce tour. */
  victoire: 5000,
  /** PV du Sacrieur gagnés ou perdus pendant ce tour : × `pv` × poids selon sa part de PV (`poidsPV`). */
  pv: 1,
  /**
   * Mutilation, une fois par combat, s'il reste au moins `mutilationPV` PV de monstres : +150 Puissance (+12 % de ses
   * dommages) pour toute la suite, donc `mutilation` × les PV de monstres restants, au plus `mutilationMax`.
   */
  mutilation: 0.12, mutilationMax: 1800, mutilationPV: 4000,
  /**
   * Couronne d'Épines : bouclier (10 % des PV max) × poids des PV ; renvoi × dommages de contact attendus × ennemis au
   * contact, au plus `couronneMax` (2026-10-19, salle 5 : environ 1 300 renvoyés par 2 Muloubards, 3 monstres au contact).
   */
  couronneBouclier: 1, couronneRenvoi: 0.5, couronneMax: 1500,
  /**
   * Case de fin : par ennemi au contact ; par ennemi en ligne à portée d'Attirance (2-10 cases, 14 en Souffrance 6) ; sans
   * ennemi au contact, par case qui le sépare du plus proche (2026-10-19 : 3 tours à marcher vers le dernier Cocholou).
   */
  contact: 120, enLigne: 40, approche: 25,
  /** Dommages attendus des monstres qui touchent la case de fin, × poids des PV. */
  menace: 0.5,
  /**
   * Fureur du Meulou (sort 305, passif) : chaque coup qu'il reçoit lui donne +30 Puissance pendant 3 tours (Étripage plus
   * fort) ; par coup porté au Meulou pendant ce tour.
   */
  fureur: 50,
  /** Marche entre deux sorts : cases essayées par nœud du faisceau (près des ennemis, en ligne pour Ravage et Attirance). */
  marches: 4,
}

/**
 * Fureur du Meulou (sort 305 des données 3.7, son passif : sort de départ 1521 absent de DofusDB) : au début du tour de
 * chaque ennemi, sa première attaque sur le Meulou est divisée par deux (Dommages subis ×50 %, retiré au premier coup).
 * Vu le 2026-10-19 : Supplice et Décimation, premiers sorts du tour, à 0,5-0,56 fois le calcul ; les Bains de Sang
 * suivants, entiers. Le moteur ne lance pas ce passif : le planificateur retire la moitié du premier coup.
 */
export const FUREUR_PREMIER_COUP = 0.5

/**
 * Poids d'un PV du Sacrieur selon sa part de PV : 0,2 à 75 % et plus (le vol de vie le remonte vite, 14 000 PV soignés
 * au boss le 2026-10-19), 0,8 à 50 %, 4 à 0.
 */
export function poidsPV(part: number): number {
  if (part >= 0.75) return 0.2
  if (part >= 0.5) return 0.2 + ((0.75 - part) / 0.25) * 0.6
  return 0.8 + ((0.5 - Math.max(0, part)) / 0.5) * 3.2
}

interface Node {
  fight: FightState
  steps: FStep[]
  score: number
  parts: Record<string, number>
  notes: string[]
  sig: string
}

export function planTourSacri(st: EtatCombat, mo: Moteur, opts: PlanOptions = {}): { plans: SacriPlan[]; evaluated: number; ms: number } {
  const t0 = Date.now()
  const { engine } = mo
  const base = engine.cloneFight(mo.fight)
  base.options.rollMode = 'average'
  base.options.forcedCrit = undefined
  const me0 = base.fighters[mo.me]
  const myRid = mo.rid.get(me0.id)!
  const enemies = (s: FightState) => s.fighters.filter(f => f.alive && f.team !== me0.team && f.cell >= 0)
  const players = (s: FightState) => s.fighters.filter(f => f.alive && f.kind === 'player' && f.cell >= 0)
  const baseEnemies = enemies(base)
  const baseHp = new Map(base.fighters.map(f => [f.id, f.alive ? f.hp : 0]))
  const hp0 = me0.hp
  const resteEnnemis = baseEnemies.reduce((s, f) => s + f.hp, 0)
  const danger = (f: Fighter) => DANGER_SACRI[f.monsterId ?? 0] ?? 150
  // PV érodés (Punition : 35 % de ses PV érodés en dommages Neutre) : PV max sans érosion = PV de base + vitalité (le
  // moteur, qui part des PV max du journal, n'en voit aucun). 2026-10-19 : PV max de 3 949 à 3 190 en salle 1.
  {
    const c = st.truth.carac.get(myRid)
    const full = c ? (c.get(0) ?? 0) + (c.get(11) ?? 0) : 0
    if (full > me0.maxHp) me0.baseMaxHp = full
  }
  // Poids de ses PV : par rapport à ses PV max sans érosion, le danger venant de ses PV restants (2026-10-19 : 1 446 PV
  // sur 2 541 PV max érodés au boss, soit 57 %, mais 37 % de ses 3 949 PV).
  const pvRef = Math.max(me0.maxHp, me0.baseMaxHp ?? 0, 1)
  const wPv = poidsPV(hp0 / pvRef)
  // Fureur du Meulou : premier coup du tour divisé par deux, s'il n'a pas encore été frappé pendant ce tour.
  const meulou = baseEnemies.find(f => f.monsterId === MEULOU)
  const fureurLibre = !!meulou && st.turnCasts.length === 0
  // Mutilation : une fois par combat (relancée, elle retire ses effets : +150 Puissance perdus contre un bouclier).
  const mutilee = st.lastCast.get(myRid)?.has(SORT.mutilation) ?? false
  let evaluated = 0

  // ── Note des sorts lancés (sans la case de fin) ──
  function castTerms(s: FightState, steps: FStep[]): { score: number; parts: Record<string, number> } {
    let degats = 0
    let tues = 0
    let morts = 0
    // (Meulou : premier coup du tour divisé par deux en jeu, coups comptés pour sa Fureur)
    let premier = 0
    let coupsMeulou = 0
    let surMeulou = 0
    if (meulou) for (const e of s.events) {
      if (e.t !== 'damage' || e.target !== meulou.id || e.amount <= 0) continue
      if (!coupsMeulou && fureurLibre) premier = e.amount * FUREUR_PREMIER_COUP
      coupsMeulou++
      surMeulou += e.amount
    }
    for (const f of baseEnemies) {
      const before = baseHp.get(f.id) ?? 0
      const now = s.fighters[f.id]
      const lost = before - (now?.alive ? now.hp : 0) - (f === meulou ? premier : 0)
      if (lost > 0) degats += Math.min(lost, before) * W.degats * (f.monsterId === MEULOU ? W.boss : 1)
      // (Meulou tué par le moteur : mort en jeu seulement si les coups couvrent aussi la moitié du premier)
      const mort = now && !now.alive && (f !== meulou || surMeulou - premier >= before)
      if (mort) {
        morts++
        tues += W.tue + W.tueDanger * danger(f) + (W.tueBonus[f.monsterId ?? 0] ?? 0)
      }
    }
    const me = s.fighters[me0.id]
    const pv = W.pv * wPv * ((me.alive ? me.hp : 0) - hp0)
    const casts = steps.filter(x => x.kind === 'cast') as { spell: number }[]
    const mutilation = !mutilee && resteEnnemis >= W.mutilationPV && casts.some(x => x.spell === SORT.mutilation)
      ? Math.min(W.mutilationMax, W.mutilation * resteEnnemis) : 0
    const victoire = morts === baseEnemies.length && baseEnemies.length > 0 ? W.victoire : 0
    const fureur = -W.fureur * coupsMeulou
    const parts = { degats: Math.round(degats), tues: Math.round(tues), pv: Math.round(pv), mutilation: Math.round(mutilation), victoire, fureur }
    return { score: degats + tues + pv + mutilation + victoire + fureur, parts }
  }

  // Monstres qui peuvent toucher une case à leur prochain tour (zones de menaces, mises en cache par positions).
  const threatCache = new Map<string, ReturnType<typeof threatMap>>()
  function threatsFor(s: FightState): ReturnType<typeof threatMap> {
    const placed: Placed[] = enemies(s).filter(f => f.monsterId).map(f => ({ monsterId: f.monsterId!, cell: f.cell }))
    const others = players(s).filter(f => f.id !== me0.id).map(f => f.cell)
    const key = placed.map(p => `${p.monsterId}@${p.cell}`).join(',') + '|' + others.join(',')
    let t = threatCache.get(key)
    if (!t) threatCache.set(key, (t = threatMap(s.map, placed, others)))
    return t
  }

  // ── Note de la case de fin ──
  function endTerms(s: FightState, end: number, steps: FStep[]): { score: number; parts: Record<string, number> } {
    const foes = enemies(s)
    if (!foes.length) return { score: 0, parts: {} }
    const t = threatsFor(s)
    const sources = t.sources.get(end) ?? new Set<number>()
    const hitters = foes.filter(f => sources.has(f.cell))
    const me = s.fighters[me0.id]
    const part = me.hp / Math.max(1, me.maxHp)
    const w = poidsPV(me.hp / pvRef)
    // (Souffrance du Sacrieur sur sa case de fin : dommages subis réduits, de ×0,99 à ×0,70)
    const lvl = souffranceDe(part)
    const subis = lvl ? SOUFFRANCE[lvl - 1].subis : 1
    const attendu = hitters.reduce((x, f) => x + danger(f), 0) * subis
    const menace = -W.menace * w * attendu
    const adjacents = foes.filter(f => distance(f.cell, end) === 1)
    const contact = W.contact * adjacents.length
    const attirance = lvl >= 6 ? 14 : 10
    const enLigne = W.enLigne * foes.filter(f => {
      const d = distance(f.cell, end)
      return d >= 2 && d <= attirance && inLine(f.cell, end)
    }).length
    const approche = adjacents.length ? 0 : -W.approche * Math.max(0, Math.min(...foes.map(f => distance(f.cell, end))) - 1)
    let couronne = 0
    if (steps.some(x => x.kind === 'cast' && x.spell === SORT.couronneEpines)) {
      // Renvoi : chaque coup de contact est renvoyé à tous les ennemis au contact au moment du coup (Riffes : 774 renvoyés
      // sur 3 monstres le 2026-10-19). Ennemis au contact : ceux d'à présent et les monstres de contact qui viendront.
      const melee = hitters.filter(f => AU_CONTACT.has(f.monsterId ?? 0))
      const auContact = Math.min(6, new Set([...adjacents, ...melee]).size)
      const renvoi = Math.min(W.couronneMax, W.couronneRenvoi * melee.reduce((x, f) => x + danger(f), 0) * auContact)
      const bouclier = W.couronneBouclier * w * 0.1 * me.maxHp
      couronne = renvoi + bouclier
    }
    const parts = { menace: Math.round(menace), contact, enLigne, approche, couronne: Math.round(couronne) }
    return { score: menace + contact + enLigne + approche + couronne, parts }
  }

  const sigOf = (s: FightState, steps: FStep[]) => {
    const m = s.fighters[me0.id]
    const hps = s.fighters.filter(f => f.team !== me0.team).map(f => (f.alive ? `${f.cell}:${Math.round(f.hp)}` : 'x')).join(',')
    const casts = steps.filter(x => x.kind === 'cast').map(x => (x as { spell: number }).spell).sort().join(',')
    return `${m.cell}|${m.ap}|${m.mp}|${Math.round(m.hp)}|${hps}|${casts}`
  }

  function node(s: FightState, steps: FStep[], notes: string[]): Node {
    const c = castTerms(s, steps)
    return { fight: s, steps, score: c.score, parts: c.parts, notes, sig: sigOf(s, steps) }
  }

  function cast(n: Node, sp: KnownSpell, cell: number): Node | null {
    const m = n.fight.fighters[me0.id]
    if (opts.forbid?.has(`${sp.spellId}@${cell}@${m.cell}`) || opts.forbid?.has(`${sp.spellId}@${cell}@*`) || opts.forbid?.has(`${sp.spellId}@*@*`)) return null
    if (sp.spellId === SORT.mutilation && mutilee) return null
    if (canCast(engine, n.fight, m, sp, cell) !== null) return null
    const s = engine.cloneFightForSim(n.fight, true)
    const target = s.fighters.find(f => f.alive && f.cell === cell)
    evaluated++
    if (!castSpell(engine, s, s.fighters[me0.id], sp.spellId, cell).ok || !s.fighters[me0.id].alive) return null
    if (s.fighters[me0.id].mp > m.mp) s.fighters[me0.id].mp = m.mp
    const tg = target ? mo.rid.get(target.id) : undefined
    return node(s, [...n.steps, { kind: 'cast', spell: sp.spellId, cell, target: tg }], n.notes)
  }

  function walk(n: Node, to: number): Node | null {
    const s = engine.cloneFightForSim(n.fight, true)
    const m = s.fighters[me0.id]
    if (m.cell === to) return n
    const r = reachableCells(s, m, engine, m.mp)
    if (!r.cost.has(to)) return null
    const path = [to]
    while (path[0] !== m.cell) {
      const p = r.prev.get(path[0])
      if (p === undefined) return null
      path.unshift(p)
    }
    move(s, m, path, engine)
    if (m.cell !== to) return null
    return node(s, [...n.steps, { kind: 'move', path }], n.notes)
  }

  const usable = me0.spells.filter(sp => SORTS_PERMIS.has(sp.spellId))
  if (!usable.length) return { plans: [], evaluated, ms: Date.now() - t0 }

  /** Cases cibles d'un sort : soi (portée 0), les ennemis et, pour les zones, leurs voisines et celles du Sacrieur. */
  function targetsFor(s: FightState, sp: KnownSpell, from: number): number[] {
    if (sp.level.range === 0) return [from]
    const cells = new Set<number>()
    if (sp.level.minRange === 0) cells.add(from)
    const zone = sp.level.effects.some(e => e.zone && (e.zone.shape !== 'P' || e.zone.size > 1))
    for (const e of enemies(s)) {
      cells.add(e.cell)
      if (zone) for (const c of neighborsOf(e.cell)) cells.add(c)
    }
    if (zone && sp.level.minRange <= 1) for (const c of neighborsOf(from)) cells.add(c)
    const max = sp.level.range + (sp.level.rangeBoostable ? Math.max(0, s.fighters[me0.id].stats.range) : 0) + 4
    return [...cells].filter(c => c >= 0 && distance(from, c) <= max)
  }

  // ── 1. Cases de tir, classées par le meilleur lancer qu'elles permettent ──
  const root = node(base, [], [])
  function bestFrom(cell: number): number {
    const s = engine.cloneFightForSim(base)
    s.fighters[me0.id].cell = cell
    const probe: Node = { ...root, fight: s }
    let best = 0
    for (const sp of usable) {
      for (const c of targetsFor(s, sp, cell)) {
        const x = cast(probe, sp, c)
        if (x) best = Math.max(best, x.score - root.score)
      }
    }
    return best
  }
  const reach0 = reachableCells(base, me0, engine, me0.mp)
  const scored: { cell: number; v: number }[] = []
  for (const [cell, cost] of reach0.cost) scored.push({ cell, v: bestFrom(cell) - 5 * cost })
  scored.sort((a, b) => b.v - a.v)
  const keep = scored.slice(0, opts.shootCells ?? 6).map(x => x.cell)
  if (!keep.includes(me0.cell)) keep.push(me0.cell)
  // (et les cases en ligne d'un ennemi lointain : Attirance ne fait pas de dommages, bestFrom ne la classe pas)
  for (const c of walkTargets(root)) if (!keep.includes(c)) keep.push(c)
  const partition = opts.partition && opts.partition.count > 1 ? opts.partition : undefined
  const kept = partition ? keep.filter((_, i) => i % partition.count === partition.index) : keep
  const frontier: Node[] = []
  for (const c of kept) {
    const x = c === me0.cell ? root : walk(root, c)
    if (x) frontier.push(x)
  }

  /**
   * Cases où marcher entre deux sorts : au contact du plus d'ennemis (Bain de Sang, Supplice, Entaille), ou en ligne à
   * 2-6 cases d'un ennemi (Ravage, Attirance). Le 2026-10-19, le joueur marchait d'une case pour aligner un Ravage.
   */
  function walkTargets(n: Node): number[] {
    const s = n.fight
    const m = s.fighters[me0.id]
    if (m.mp <= 0) return []
    const foes = enemies(s)
    const r = reachableCells(s, m, engine, m.mp)
    const attirance = souffranceDe(m.hp / Math.max(1, m.maxHp)) >= 6 ? 14 : 10
    const out: { cell: number; v: number }[] = []
    for (const [cell, cost] of r.cost) {
      if (cell === m.cell) continue
      let v = 0
      for (const f of foes) {
        const d = distance(cell, f.cell)
        if (d === 1) v += 3
        else if (d <= attirance && inLine(cell, f.cell)) v += 1
      }
      if (v > 0) out.push({ cell, v: v - 0.1 * cost })
    }
    out.sort((a, b) => b.v - a.v)
    return out.slice(0, W.marches).map(x => x.cell)
  }

  // ── 2. Faisceau de lancers ──
  const beamWidth = opts.beam ?? 24
  const maxCasts = opts.maxCasts ?? 6
  const minCost = Math.min(...usable.map(sp => sp.level.apCost))
  const pool: Node[] = [...frontier]
  const seen = new Set(frontier.map(x => x.sig))
  let beam = frontier
  for (let depth = 0; depth < maxCasts; depth++) {
    const nextNodes: Node[] = []
    for (const n of beam) {
      // (marche puis sort, à partir du 1er sort : une marche seule ne vaut rien tant qu'un sort ne suit pas)
      const starts: Node[] = [n]
      if (depth > 0 && n.steps.at(-1)?.kind === 'cast') for (const c of walkTargets(n)) {
        const w = walk(n, c)
        if (w) starts.push(w)
      }
      for (const st0 of starts) {
        const from = st0.fight.fighters[me0.id].cell
        for (const sp of usable) {
          for (const cell of targetsFor(st0.fight, sp, from)) {
            const x = cast(st0, sp, cell)
            if (!x || seen.has(x.sig)) continue
            seen.add(x.sig)
            nextNodes.push(x)
          }
        }
      }
    }
    if (!nextNodes.length) break
    nextNodes.sort((a, b) => b.score - a.score)
    pool.push(...nextNodes.slice(0, 3 * beamWidth))
    // (Couronne d'Épines ne vaut qu'à la case de fin : ses nœuds sont gardés en plus, sinon les dommages les chassent)
    pool.push(...nextNodes.slice(3 * beamWidth).filter(x => x.steps.some(y => y.kind === 'cast' && y.spell === SORT.couronneEpines)).slice(0, beamWidth))
    beam = diverse(nextNodes.filter(x => x.fight.fighters[me0.id].ap >= minCost), beamWidth)
    if (!beam.length) break
  }

  function diverse(nodes: Node[], width: number): Node[] {
    const out: Node[] = []
    const keys = new Set<string>()
    for (const n of nodes) {
      if (out.length >= 2 * width) break
      const spells = n.steps.filter(x => x.kind === 'cast').map(x => (x as { spell: number }).spell).sort().join(',')
      const k = `${n.fight.fighters[me0.id].cell}|${spells}`
      if (keys.has(k)) continue
      keys.add(k)
      out.push(n)
    }
    for (const n of nodes) {
      if (out.length >= width) break
      if (!out.includes(n)) out.push(n)
    }
    return out
  }

  // ── 3. Case de fin, atteinte avec les PM qui restent ──
  const finishers = opts.finishers ?? 30
  const byScore = [...pool].sort((a, b) => b.score - a.score).slice(0, finishers)
  const withCrown = pool.filter(n => !byScore.includes(n) && n.steps.some(x => x.kind === 'cast' && x.spell === SORT.couronneEpines))
    .sort((a, b) => b.score - a.score).slice(0, Math.ceil(finishers / 3))
  const plans: SacriPlan[] = []
  const done = new Set<string>()
  for (const n of [...byScore, ...withCrown]) {
    const s = n.fight
    const m = s.fighters[me0.id]
    const r = reachableCells(s, m, engine, Math.max(0, m.mp))
    let best: { node: Node; end: ReturnType<typeof endTerms>; total: number } | null = null
    for (const cell of r.cost.keys()) {
      const w = cell === m.cell ? n : walk(n, cell)
      if (!w) continue
      const end = endTerms(w.fight, w.fight.fighters[me0.id].cell, w.steps)
      const total = w.score + end.score - 0.5 * (w.steps.length - n.steps.length)
      if (!best || total > best.total) best = { node: w, end, total }
    }
    if (!best) continue
    const key = best.node.steps.map(x => (x.kind === 'move' ? `>${x.path.at(-1)}` : `${x.spell}@${x.cell}`)).join(' ')
    if (done.has(key)) continue
    done.add(key)
    const left = enemies(best.node.fight)
    plans.push({
      steps: best.node.steps, endCell: best.node.fight.fighters[me0.id].cell, score: Math.round(best.total),
      parts: { ...best.node.parts, ...best.end.parts },
      notes: [
        `PV ${Math.round(hp0)}/${me0.maxHp} (poids ${wPv.toFixed(2)}) → ${Math.round(best.node.fight.fighters[me0.id].hp)}`,
        `${left.length} monstre(s) restant(s), ${Math.round(left.reduce((x, f) => x + f.hp, 0))} PV`,
        ...best.node.notes,
      ],
    })
  }
  plans.sort((a, b) => b.score - a.score)
  return { plans: plans.slice(0, 3), evaluated, ms: Date.now() - t0 }
}
