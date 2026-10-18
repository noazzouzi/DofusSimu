// Combat du moteur au tour d'un Crâ, d'après l'état exact du journal (etat.ts) : les Crâs avec leurs caractéristiques
// réelles (synchronisations du serveur), leurs sorts et grades, leurs relances et lancers déjà faits ce tour ; les
// monstres avec leurs caractéristiques réelles (Puissance comprise) et leurs PA/PM pleins. Les sorts de départ des
// Krobes ne sont PAS lancés : sans invulnérabilité, les dommages que le moteur leur calcule sont les « dommages
// initiaux » que la Malamibe reçoit (×200 % puis ×50 %, donc à l'identique).
import type { Stats } from '../../src/core/types'
import { castSpell } from '../../src/engine/cast'
import type { Engine } from '../../src/engine/engine'
import { createMonsterFighter, createPlayerFighter } from '../../src/engine/factory'
import { createEngine } from '../../src/engine/index'
import type { Fighter, FightState, ScenarioHooks } from '../../src/engine/types'
import { statsFromCarac } from '../reine-des-voleurs/planificateur/fidelite'
import { DEFAULT_SPELLS, UNSENT_CRA_STATS, data } from '../reine-des-voleurs/planificateur/etat'
import { applyCastRules } from '../reine-des-voleurs/planificateur/regles'
import { isKrobe } from './donjon'
import { cooldownsOf, type EtatCombat } from './etat'

/** Le moteur ne décide pas de la fin du combat (les Krobes ne meurent que de leur compte à rebours). */
export const baleineScenario: ScenarioHooks = { id: 'ventre-de-la-baleine', checkEnd: () => null }

/** Sorts de soutien du tour, à rejouer dans le moteur pour leurs effets sur les sorts (portée, ligne de vue). */
const SELF_BUFFS = new Set([32466, 32465, 32469, 32475])
/** PV donnés aux Krobes dans le moteur (invulnérables en jeu). */
export const KROBE_HP = 10_000_000
const TIRS_PUISSANTS = 32466
/** Caractéristique « Portée » du jeu. */
const PORTEE = 19

export interface Moteur {
  engine: Engine
  fight: FightState
  /** Identifiant de la reconstitution → identifiant du moteur, et inverse. */
  eid: Map<number, number>
  rid: Map<number, number>
  /** Crâ actif (identifiant du moteur). */
  me: number
}

export interface MoteurOptions {
  /** PA, PM et case du Crâ actif, donnés par le script (plus sûrs que le journal pendant son propre tour). */
  ap?: number
  mp?: number
  cell?: number
  /** Sorts de chaque Crâ (par nom) : liste du jeu, variantes et grades compris. */
  spells?: Record<string, { spellId: number; grade: number }[]>
  /** Cases occupées par des entités que le journal ne connaît pas (invocations d'un personnage seul) : infranchissables. */
  obstacles?: number[]
}

const CRA = 9

/** Caractéristiques réelles d'un personnage (et, pour un Crâ, celles que le serveur n'envoie pas). */
function playerStats(c: Map<number, number>, breedId = CRA): Stats {
  const s = statsFromCarac(c)
  if (breedId === CRA) for (const k in UNSENT_CRA_STATS) if (!c.has(86)) (s[k as keyof Stats] as number) += UNSENT_CRA_STATS[k as keyof Stats] ?? 0
  return s
}

export function moteurDuTour(st: EtatCombat, active: number, opts: MoteurOptions = {}): Moteur {
  const engine = createEngine(data, baleineScenario)
  const t = st.truth
  const fighters: Fighter[] = []
  const ids: number[] = []
  for (const real of st.res.fighters) {
    if (!t.alive.has(real.id)) continue
    const cell = real.id === active && opts.cell !== undefined ? opts.cell : t.cell.get(real.id) ?? -1
    if (cell < 0) continue
    const carac = t.carac.get(real.id) ?? new Map<number, number>()
    const maxHp = Math.max(1, t.max.get(real.id) ?? 1)
    let f: Fighter
    if (real.kind === 'player') {
      const list = opts.spells?.[real.name]
      const s = playerStats(carac, real.breedId)
      // PA / PM : ceux du début de son dernier tour (les caractéristiques 1 et 23 du serveur sont les points restants).
      s.ap = t.turnAp.get(real.id) ?? s.ap
      s.mp = t.turnMp.get(real.id) ?? s.mp
      f = createPlayerFighter(data, { name: real.name, breedId: real.breedId ?? 9, level: real.level, stats: s, maxHp,
        spellIds: list?.map(x => x.spellId) ?? DEFAULT_SPELLS, team: real.team, cell })
      if (list) {
        const grades = new Map(list.map(x => [x.spellId, x.grade]))
        f.spells = f.spells.map(sp => {
          const lvl = data.spellLevel(sp.spellId, { grade: grades.get(sp.spellId) ?? 1 })
          return lvl ? { ...sp, level: lvl } : sp
        })
      }
    } else {
      const mid = real.monsterId ?? 0
      f = createMonsterFighter(data, { monsterId: mid, grade: real.grade ?? 5, team: real.team, cell })
      f.name = real.name
      if (carac.size) {
        const full = { ap: f.stats.ap, mp: f.stats.mp }
        const s = statsFromCarac(carac)
        // PA / PM pleins (le serveur envoie les points restants).
        s.ap = Math.max(full.ap, t.turnAp.get(real.id) ?? 0)
        s.mp = Math.max(full.mp, t.turnMp.get(real.id) ?? 0)
        f.baseStats = s
        f.stats = { ...s }
      }
    }
    fighters.push(f)
    ids.push(real.id)
  }
  const known = data.map(st.mapId)
  if (!known) throw new Error(`Carte ${st.mapId} absente de data/maps`)
  const blocked = new Set(opts.obstacles ?? [])
  const map = blocked.size ? { ...known, cells: known.cells.map(c => (blocked.has(c.id) ? { ...c, walkable: false } : c)) } : known
  const fight = engine.createFight({ map, fighters, options: { seed: 1, rollMode: 'average', record: true, maxRounds: 999 } })
  fight.round = Math.max(1, st.round)
  const eid = new Map<number, number>()
  const rid = new Map<number, number>()
  fight.fighters.forEach((f, i) => {
    eid.set(ids[i], f.id)
    rid.set(f.id, ids[i])
    // PV max du journal (la Malamibe a 1 PV dans les données, +2 000 de vitalité par personnage en combat).
    const max = t.max.get(ids[i])
    if (max !== undefined && max > 0) f.maxHp = f.baseMaxHp = max
    f.hp = Math.max(1, Math.min(f.maxHp, t.hp.get(ids[i]) ?? f.hp))
    // Krobes : invulnérables en jeu, ils ne meurent que de leur compte à rebours. Dans le moteur, des PV sans fond : les
    // dommages calculés restent ceux que reçoit la Malamibe, et le Krobe reste sur la carte (menaces, lignes de vue).
    if (isKrobe(f.monsterId)) f.hp = f.maxHp = f.baseMaxHp = KROBE_HP
    const real = st.res.fighters[ids[i]]
    if (real.summonerId !== undefined) {
      const owner = st.res.fighters.find(x => x.gameId === real.summonerId)
      const o = owner ? eid.get(owner.id) : undefined
      if (o !== undefined) f.summonerId = o
    }
  })
  const me = eid.get(active)
  if (me === undefined) throw new Error(`Crâ actif absent du combat (${st.res.fighters[active]?.name ?? active})`)
  const m = fight.fighters[me]
  // Sorts de soutien déjà lancés ce tour : rejoués pour leurs effets sur les sorts ; leurs bonus de caractéristiques,
  // déjà dans celles du serveur, sont retirés de la base (comme fidelite.ts).
  const real = playerStats(t.carac.get(active) ?? new Map(), st.res.fighters[active]?.breedId)
  for (const c of st.current === active ? st.turnCasts : []) {
    if (!SELF_BUFFS.has(c.spellId)) continue
    m.ap = 99
    if (castSpell(engine, fight, m, c.spellId, m.cell).ok) applyCastRules(engine, fight, m, c.spellId)
  }
  for (const b of m.buffs) {
    if (b.delay > 0 || !b.statDelta) continue
    for (const k in b.statDelta) (real[k as keyof Stats] as number) -= b.statDelta[k as keyof Stats] ?? 0
  }
  real.ap = t.turnAp.get(active) ?? real.ap
  real.mp = t.turnMp.get(active) ?? real.mp
  // Tirs Puissants lancé à son tour précédent : son −3 PO joue au début de ce tour-ci (regles.ts). Le serveur envoie la
  // portée réduite juste après le début du tour ; si le journal ne l'a pas encore, on la déduit (2026-10-14 : 5 sorts
  // refusés au début du tour qui suivait un Tirs Puissants, plan fait avec l'ancienne portée).
  if (st.current === active && st.castRounds.get(active)?.get(TIRS_PUISSANTS)?.includes(st.round - 1) && !st.turnCaracs.has(PORTEE)) real.range -= 3
  m.baseStats = real
  engine.recomputeStats(m)
  // PA / PM restants, relances et lancers déjà faits ce tour.
  m.ap = opts.ap ?? t.ap.get(active) ?? m.stats.ap
  m.mp = opts.mp ?? t.mp.get(active) ?? m.stats.mp
  m.cooldowns = cooldownsOf(st, active, m.spells.map(sp => ({ spellId: sp.spellId, grade: sp.level.grade })))
  const perTurn: Record<number, number> = {}
  const onTarget: Record<string, number> = {}
  for (const c of st.current === active ? st.turnCasts : []) {
    perTurn[c.spellId] = (perTurn[c.spellId] ?? 0) + 1
    const tg = c.target !== undefined ? eid.get(c.target) : undefined
    if (tg !== undefined) onTarget[`${c.spellId}:${tg}`] = (onTarget[`${c.spellId}:${tg}`] ?? 0) + 1
  }
  m.castsThisTurn = perTurn
  m.castsOnTarget = onTarget
  fight.events.length = 0
  return { engine, fight, eid, rid, me }
}
