/**
 * Overrides de l'Œil de Vortex (docs/design/ai.md §11.7 ; docs/research/monster-ai.md §7.2, §8.7) — WP1.
 *
 * Les mécaniques du donjon sont dans les données et exécutées par le moteur (Vortexiphan 5006, Glyphe téléporteur 5002,
 * Heurage 5065/5067, *En temps et en heure* 5061…) ; ces hooks ne reproduisent que les PRIORITÉS que la simulation
 * gloutonne ne capte pas :
 *
 * Vortex (3835) — phase 1 ⇔ état 236 « Marginal » (−100 PM : immobile), phase 2 ⇔ plus de Marginal :
 *  - `beforeTurn` : Heurage (5066) dès qu'il est lançable (phase 1 : l'Auroraire donne l'heure courante à tous les
 *    monstres de vague ; phase 2 : téléportation au contact de l'Auroraire) ; *En temps et en heure* (5062), ciblé sur
 *    l'Auroraire, si au moins un ennemi est aligné avec elle (INCERTAIN : lancé même sans cible ?) ;
 *  - `filterCast` : Contamination zombie (5064) seulement sur un Zombi (74) ayant ≥ 1 personnage à ≤ 2 cases ;
 *    *En temps et en heure* seulement sur l'Auroraire ; Heurage seulement en début de tour ;
 *  - `extraCandidates` : Contamination zombie sur chaque Zombi entouré (le générateur générique ne vise pas un allié
 *    pour un sort sans soin ni buff direct) ;
 *  - `scoreCast` : Heuristique (5068) + 0,5 × valeur des buffs désenvoûtés (le Pacifiste, 0,9·menace, est déjà dans le
 *    score générique : pas de double compte) ;
 *  - `endPosition` (phase 2) : +25 × personnages alignés à ≤ 8 + leurs PM (Heuristique : ligne 1-8 sans LdV) ;
 *  - `threatOrigins` (menace vue par les joueurs) : en phase 2, cases voisines de la FUTURE case de l'Auroraire si
 *    Heurage sera prêt à son prochain tour (`vortexThreatOrigins`).
 * Ikargn (3834) — `scoreCast` : Attraction ailée qui regroupe ≥ 2 ennemis reçoit la valeur simulée du Cercle de feu
 *   qui suivra (seul vrai besoin d'anticipation de la salle ; l'ouverture forcée du profil garantit l'ordre).
 * Brabuzar (3839) — `scoreCast` : Neutralisation + isolement (Δ distance de la cible à ses alliés, symétrie simulée).
 */
import { AURORAIRE, HOUR_CELL, MARGINAL, nextHour, SPELL, STATE, ZOMBI } from '../../../dungeons/vortex/constants'
import type { Engine } from '../../../engine/engine'
import type { Action, Fighter, FightState } from '../../../engine/types'
import { distance, inLine, neighborsOf } from '../../../map/geometry'
import { SlotOrder } from '../../core/timeline'
import { believedCell } from '../../core/view'
import type { MacroAction } from '../../types'
import type { MonsterContext } from '../context'
import { followUpScore } from '../score'
import type { MonsterCandidate, MonsterHooks } from '../types'

/** L'Auroraire vivante du combat (invocation-horloge du Vortex). */
export function auroraireOf(s: FightState): Fighter | undefined {
  for (const f of s.fighters) if (f.alive && f.monsterId === AURORAIRE && f.cell >= 0) return f
  return undefined
}

/** Phase 1 du Vortex : état 236 « Marginal ». */
export function vortexPhase1(v: Fighter): boolean {
  return v.states.includes(MARGINAL)
}

/** Heure courante (1..12) lue sur l'Auroraire (états 221..232), 0 si inconnue. */
function hourOf(aur: Fighter): number {
  for (const s of aur.states) if (s > STATE.HOUR_STATE_BASE && s <= STATE.HOUR_STATE_BASE + 12) return s - STATE.HOUR_STATE_BASE
  return 0
}

/**
 * Cases d'où le Vortex frappera à son prochain tour en plus de son accessibilité (§11.7 `threatOrigins`) : en phase 2,
 * si Heurage sera prêt (relance ≤ 1), cases voisines de la case qu'occupera l'Auroraire à ce moment (heure courante +
 * nombre de tours de personnages avant le prochain tour du Vortex ; glyphes non prévues). Vide sinon.
 */
export function vortexThreatOrigins(engine: Engine, s: FightState, vortex: Fighter): number[] {
  if (!vortex.alive || vortexPhase1(vortex)) return []
  if ((vortex.cooldowns[SPELL.HEURAGE] ?? 0) > 1) return []
  const aur = auroraireOf(s)
  if (!aur) return []
  let h = hourOf(aur)
  if (h > 0) {
    const order = new SlotOrder(engine, s)
    const r = order.rank(vortex.id)
    let k = 0
    for (let i = 0; i < r && i < order.count; i++) {
      const sl = order.slots[i]
      if (sl.isPlayer && !sl.isSummon) k++
    }
    h = nextHour(h, k)
  }
  const cell = h > 0 ? HOUR_CELL[h] : aur.cell
  return neighborsOf(cell).filter(c => s.map.cells[c]?.walkable)
}

/** Un personnage (non invoqué) ennemi est-il à ≤ r cases de `cell` ? */
function charactersWithin(ctx: MonsterContext, cell: number, r: number): number {
  let n = 0
  for (const e of ctx.enemies()) if (e.kind === 'player' && distance(believedCell(e, ctx.team), cell) <= r) n++
  return n
}

export const vortexHooks: MonsterHooks = {
  beforeTurn(ctx: MonsterContext): Action[] {
    const me = ctx.me
    const aur = auroraireOf(ctx.fight)
    if (!aur) return []
    const acts: Action[] = []
    // Heurage dès qu'il est disponible (« il l'utilisera au début de son tour ») : buff d'heure (phase 1) ou
    // téléportation au contact de l'Auroraire (phase 2).
    if (ctx.canCastOn(SPELL.HEURAGE, me.cell)) acts.push({ type: 'cast', spellId: SPELL.HEURAGE, cell: me.cell })
    // En temps et en heure : croix de l'Auroraire, seulement si un ennemi y est aligné.
    if (ctx.enemiesAlignedWith(aur.cell).length > 0) acts.push({ type: 'cast', spellId: SPELL.EN_TEMPS_ET_EN_HEURE, cell: aur.cell })
    return acts
  },

  extraCandidates(ctx: MonsterContext): MacroAction[] {
    const me = ctx.me
    if (!vortexPhase1(me)) return []
    const out: MacroAction[] = []
    for (const z of ctx.allies()) {
      if (!z.states.includes(ZOMBI) || charactersWithin(ctx, z.cell, 2) === 0) continue
      if (!ctx.canCastOn(SPELL.CONTAMINATION_ZOMBIE, z.cell)) continue
      out.push({ cast: { spellId: SPELL.CONTAMINATION_ZOMBIE, cell: z.cell }, cat: 'control', prior: 0, key: `${SPELL.CONTAMINATION_ZOMBIE}:${z.cell}:${me.cell}` })
    }
    return out
  },

  filterCast(ctx: MonsterContext, c: MonsterCandidate): boolean {
    const spellId = c.cast?.spellId
    if (spellId === SPELL.HEURAGE) return false
    if (spellId === SPELL.EN_TEMPS_ET_EN_HEURE) {
      const aur = auroraireOf(ctx.fight)
      return !!aur && c.cast!.cell === aur.cell
    }
    if (spellId === SPELL.CONTAMINATION_ZOMBIE) {
      const z = ctx.fighterAt(c.cast!.cell)
      return !!z && z.states.includes(ZOMBI) && charactersWithin(ctx, c.cast!.cell, 2) > 0
    }
    return true
  },

  scoreCast(ctx: MonsterContext, c: MonsterCandidate, base: number, sim: FightState): number {
    if (c.cast?.spellId !== SPELL.HEURISTIQUE) return base
    const t0 = ctx.fighterAt(c.cast.cell)
    if (!t0 || !ctx.isEnemy(t0)) return base
    const t1 = sim.fighters[t0.id]
    if (!t1 || !t1.alive) return base
    const now = new Set(t1.buffs.map(b => b.uid))
    let n = 0
    for (const b of t0.buffs) if (!now.has(b.uid) && b.dispellable && (b.statDelta || b.stateId !== undefined || b.spellMod)) n++
    return base + 0.5 * Math.min(0.5, 0.1 * n) * ctx.threatOf(t0)
  },

  endPosition(ctx: MonsterContext, cell: number, s: FightState): number {
    const me = s.fighters[ctx.me.id] ?? ctx.me
    if (vortexPhase1(me)) return 0
    let n = 0
    for (const e of ctx.enemies(s)) {
      if (e.kind !== 'player') continue
      const ec = believedCell(e, ctx.team)
      if (ec !== cell && inLine(cell, ec) && distance(cell, ec) <= 8 + Math.max(0, Math.floor(e.stats.mp))) n++
    }
    return 25 * n
  },

  threatOrigins: vortexThreatOrigins,
}

export const ikargnHooks: MonsterHooks = {
  scoreCast(ctx: MonsterContext, c: MonsterCandidate, base: number, sim: FightState): number {
    if (c.cast?.spellId !== SPELL.ATTRACTION_AILEE) return base
    const me = sim.fighters[ctx.me.id]
    if (!me) return base
    // Ennemis regroupés dans le cercle 2 du Cercle de feu après l'attraction.
    let grouped = 0
    for (const e of ctx.enemies(sim)) if (distance(believedCell(e, ctx.team), me.cell) <= 2) grouped++
    if (grouped < 2) return base
    return base + followUpScore(ctx, sim, SPELL.CERCLE_DE_FEU)
  },
}

export const brabuzarHooks: MonsterHooks = {
  scoreCast(ctx: MonsterContext, c: MonsterCandidate, base: number, sim: FightState): number {
    if (c.cast?.spellId !== SPELL.NEUTRALISATION) return base
    const t0 = ctx.fighterAt(c.cast.cell)
    if (!t0 || !ctx.isEnemy(t0)) return base
    const t1 = sim.fighters[t0.id]
    if (!t1 || !t1.alive || t1.cell < 0) return base
    // Positions vues par le camp du monstre (invisibles adverses sur leur dernière case connue).
    const iso = (s: FightState, t: Fighter): number => {
      const tc = believedCell(t, ctx.team)
      let d = 99
      for (const a of s.fighters) {
        if (!a.alive || a.id === t.id || a.team !== t.team) continue
        const ac = believedCell(a, ctx.team)
        if (ac >= 0) d = Math.min(d, distance(ac, tc))
      }
      return d === 99 || tc < 0 ? 0 : d
    }
    const delta = iso(sim, t1) - iso(ctx.fight, t0)
    return base + 15 * Math.max(0, Math.min(8, delta))
  },
}
