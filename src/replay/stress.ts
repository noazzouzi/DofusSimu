/**
 * Replay de STRESS synthétique : un très long combat (vagues de monstres sans fin) produit par le
 * metteur en scène de la démo (`DemoDirector`), donc cohérent (chemins adjacents, cellules libres,
 * PV/PA/PM valides), et qui utilise TOUS les types d'événements.
 *
 * Usages : tests de propriété du réducteur (accès aléatoire == lecture linéaire), mesure des
 * performances du visualiseur (`?stress=20000` dans l'URL) et banc d'essai des animations.
 */
import { Rng } from '../core/rng'
import { Element } from '../core/types'
import type { FighterSnapshot } from '../engine/types'
import { distance } from '../map/geometry'
import { DemoDirector, createDemoMap, type SpellDef } from './demo'
import type { Replay } from './types'

export interface StressOptions {
  /** Nombre d'événements visé (le combat se termine dès qu'il est atteint). */
  events?: number
  seed?: number
}

const SPELLS: SpellDef[] = [
  { id: 8001, name: 'Frappe Terre', ap: 3, element: Element.Earth },
  { id: 8002, name: 'Brasier', ap: 4, element: Element.Fire, shape: 'C', size: 1 },
  { id: 8003, name: 'Déferlante', ap: 4, element: Element.Water, shape: 'X', size: 2 },
  { id: 8004, name: 'Bourrasque', ap: 3, element: Element.Air },
  { id: 8005, name: 'Coup Neutre', ap: 2, element: Element.Neutral },
  { id: 8006, name: 'Séisme', ap: 5, element: Element.Earth, shape: 'C', size: 2 },
]
const SUPPORT = {
  heal: { id: 8101, name: 'Soin', ap: 3, element: Element.Water } as SpellDef,
  shield: { id: 8102, name: 'Bouclier', ap: 2 } as SpellDef,
  buff: { id: 8103, name: 'Galvanisation', ap: 2 } as SpellDef,
  debuff: { id: 8104, name: 'Entrave', ap: 3, element: Element.Air } as SpellDef,
  push: { id: 8105, name: 'Répulsion', ap: 2, element: Element.Neutral } as SpellDef,
  tp: { id: 8106, name: 'Transposition', ap: 2 } as SpellDef,
  glyph: { id: 8107, name: 'Glyphe Ardente', ap: 3, element: Element.Fire, shape: 'C', size: 1 } as SpellDef,
  summon: { id: 8108, name: 'Invocation', ap: 3 } as SpellDef,
  trap: { id: 8109, name: 'Piège Sournois', ap: 3, element: Element.Fire, shape: 'X', size: 1 } as SpellDef,
}
const STATES = [
  { id: 9950, name: 'Pesanteur' },
  { id: 9951, name: 'Enraciné' },
  { id: 9952, name: 'Affaibli' },
]
const MONSTERS = ['Kralamoure', 'Craqueleur', 'Bouftou', 'Tofu', 'Larve', 'Chafer', 'Wabbit', 'Gelée']
const PLAYERS: [string, number][] = [
  ['Iop', 8],
  ['Crâ', 9],
  ['Eniripsa', 7],
  ['Enutrof', 3],
]

/** Génère un long combat déterministe d'environ `events` événements. */
export function createStressReplay(opts: StressOptions = {}): Replay {
  const target = Math.max(200, Math.floor(opts.events ?? 20000))
  const seed = opts.seed ?? 1234
  const rng = new Rng(seed)
  const map = createDemoMap()
  const d = new DemoDirector(map)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng.next() * list.length)]
  const placement = (team: 1 | 2) => map.cells.filter(c => c.placement === team).map(c => c.id)

  const players = PLAYERS.map(([name, breedId], k) =>
    d.add({ team: 0, kind: 'player', name, breedId, level: 200, hp: 60000, ap: 12, mp: 6, cell: placement(1)[k * 2] ?? placement(1)[k] }),
  )
  const monsterCells = placement(2)
  const first = [0, 1, 2].map(k =>
    d.add({ team: 1, kind: 'monster', name: MONSTERS[k], monsterId: 7000 + k, level: 180, hp: 2600, ap: 9, mp: 4, cell: monsterCells[k * 2] ?? monsterCells[k] }),
  )
  const totalWaves = Math.max(2, Math.round(target / 900))
  let wave = 1
  const summons = new Map<number, number>()

  const alive = (team: 0 | 1) => [...d.actors.values()].filter(a => a.alive && a.snap.team === team)
  const freeNear = (cell: number) => {
    try {
      return d.freeCellNear(cell, 1)
    } catch {
      return -1
    }
  }

  d.onDeath = () => {
    if (d.ended) return
    if (!alive(0).some(a => a.snap.kind !== 'summon')) {
      d.end(1, 'Tous les personnages sont morts')
      return
    }
    if (alive(1).some(a => a.snap.kind !== 'summon')) return
    if (d.events.length >= target - 50) {
      d.end(0, 'Tous les monstres sont morts')
      return
    }
    wave++
    const n = 2 + Math.floor(rng.next() * 3)
    const list: Omit<FighterSnapshot, 'id' | 'maxHp'>[] = []
    const taken = new Set<number>()
    for (let k = 0; k < n; k++) {
      const free = monsterCells.filter(c => !taken.has(c) && d.isFree(c))
      const cell = free.length ? pick(free) : freeNear(pick(monsterCells))
      if (cell < 0) break
      taken.add(cell)
      list.push({ team: 1, kind: 'monster', name: pick(MONSTERS), monsterId: 7000 + k, level: 180, hp: 1800 + Math.floor(rng.next() * 2400), ap: 9, mp: 4, cell })
    }
    d.log(`Vague ${wave} : ${list.length} monstres`, 'warn')
    d.wave(Math.min(wave, totalWaves), Math.max(wave, totalWaves), list)
  }

  const nearestEnemy = (id: number): number | undefined => {
    const me = d.actor(id)
    let best: number | undefined
    let bestD = Infinity
    for (const a of d.actors.values()) {
      if (!a.alive || a.snap.team === me.snap.team) continue
      const dd = distance(me.cell, a.cell)
      if (dd < bestD) ((bestD = dd), (best = a.snap.id))
    }
    return best
  }

  const attack = (id: number, spell: SpellDef, targetId: number) => {
    const crit = rng.chance(0.2)
    const hit = d.castOn(id, spell, targetId, crit)
    for (const t of hit) {
      const victim = d.actor(t)
      if (victim.snap.team === d.actor(id).snap.team) continue
      const base = d.actor(id).snap.team === 0 ? 500 : 180
      d.hit(id, t, base + Math.floor(rng.next() * base), spell.element ?? -1, { crit })
      if (d.ended) return
    }
  }

  const playTurn = (id: number) => () => {
    const me = d.actor(id)
    if (rng.chance(0.08)) d.log(`IA : ${me.snap.name} évalue ${1 + Math.floor(rng.next() * 40)} options.`, 'ai')
    if (me.mp > 0 && rng.chance(0.03)) d.tackle(id, Math.min(me.ap, 1), 1)
    const foe = nearestEnemy(id)
    if (foe === undefined) return
    if (me.mp > 0 && rng.chance(0.85)) d.approach(id, foe, me.snap.team === 0 && id % 2 ? 4 : 1, 1 + Math.floor(rng.next() * me.mp))
    for (const uid of d.trapsAt(d.actor(id).cell)) {
      const info = d.trapInfo(uid)
      if (!info || d.actor(info.source).snap.team === me.snap.team) continue
      d.removeTrap(uid)
      d.hit(info.source, id, 250, Element.Fire, { kind: 'trap' })
      if (d.ended || !d.actor(id).alive) return
    }
    for (let k = 0; k < 4 && !d.ended && d.actor(id).alive; k++) {
      const a = d.actor(id)
      const enemy = nearestEnemy(id)
      if (enemy === undefined) return
      const r = rng.next()
      const allies = [...d.actors.values()].filter(o => o.alive && o.snap.team === a.snap.team)
      if (r < 0.08 && a.ap >= SUPPORT.heal.ap) {
        const ally = pick(allies)
        d.castOn(id, SUPPORT.heal, ally.snap.id)
        d.heal(id, ally.snap.id, 300 + Math.floor(rng.next() * 900))
      } else if (r < 0.13 && a.ap >= SUPPORT.shield.ap) {
        const ally = pick(allies)
        d.castOn(id, SUPPORT.shield, ally.snap.id)
        d.shield(id, ally.snap.id, 200 + Math.floor(rng.next() * 400))
      } else if (r < 0.19 && a.ap >= SUPPORT.buff.ap) {
        const ally = pick(allies)
        d.castOn(id, SUPPORT.buff, ally.snap.id)
        const st = rng.chance(0.4) ? pick(STATES) : undefined
        d.buff(id, ally.snap.id, SUPPORT.buff.id, rng.chance(0.5) ? '+1 PM' : '+150 Puissance', 1 + Math.floor(rng.next() * 3), {
          mp: rng.chance(0.5) ? 1 : 0,
          state: st,
        })
      } else if (r < 0.27 && a.ap >= SUPPORT.debuff.ap) {
        d.castOn(id, SUPPORT.debuff, enemy)
        d.hit(id, enemy, 150 + Math.floor(rng.next() * 200), Element.Air)
        if (d.actor(enemy).alive) {
          const ap = rng.chance(0.5)
          d.buff(id, enemy, SUPPORT.debuff.id, ap ? '-2 PA' : '-2 PM', 1, ap ? { ap: -2 } : { mp: -2 })
        }
      } else if (r < 0.32 && a.ap >= SUPPORT.push.ap && distance(a.cell, d.actor(enemy).cell) <= 2) {
        d.castOn(id, SUPPORT.push, enemy)
        d.push(id, enemy, 1 + Math.floor(rng.next() * 3), 60)
      } else if (r < 0.35 && a.ap >= SUPPORT.tp.ap) {
        const to = freeNear(d.actor(enemy).cell)
        if (to >= 0) {
          d.cast(id, SUPPORT.tp, to)
          d.teleport(id, to)
        }
      } else if (r < 0.38 && a.ap >= SUPPORT.glyph.ap) {
        const center = d.actor(enemy).cell
        d.cast(id, SUPPORT.glyph, center)
        const cells = d.zone(SUPPORT.glyph, center)
        d.glyph(id, SUPPORT.glyph.id, cells, a.snap.team === 0 ? '#e2541f' : '#8f63e6', 2, (b, f) => {
          if (b.actor(f).snap.team !== b.actor(id).snap.team) b.hit(id, f, 120, Element.Fire, { kind: 'glyph' })
        })
      } else if (r < 0.42 && a.ap >= SUPPORT.trap.ap) {
        // Piège posé sur une case libre près de l'ennemi ; déclenché s'il y marche (voir déplacement).
        const cell = freeNear(d.actor(enemy).cell)
        if (cell >= 0) {
          d.cast(id, SUPPORT.trap, cell)
          d.trap(id, SUPPORT.trap.id, d.zone(SUPPORT.trap, cell), '#c9971a', 3)
        }
      } else if (r < 0.45 && a.ap >= SUPPORT.summon.ap && a.snap.kind !== 'summon' && !(summons.has(id) && d.alive(summons.get(id)!))) {
        const cell = freeNear(a.cell)
        if (cell >= 0) {
          d.cast(id, SUPPORT.summon, cell)
          const s = d.summon(id, { team: a.snap.team, kind: 'summon', name: a.snap.team === 0 ? 'Sac Animé' : 'Larve Invoquée', level: 100, hp: 900, ap: 6, mp: 3, cell })
          summons.set(id, s)
        }
      } else {
        const spell = pick(SPELLS.filter(s => s.ap <= a.ap))
        if (!spell) return
        attack(id, spell, enemy)
      }
      if (d.actor(id).ap < 2) return
    }
  }

  d.start([players[0], first[0], players[1], first[1], players[2], first[2], players[3]], 'Stress — combat sans fin')
  d.wave(1, totalWaves, [])
  while (!d.ended && d.events.length < target) {
    d.playRound(id => playTurn(id))
    if (d.round > 5000) break
  }
  if (!d.ended) d.end(0, 'Limite de test atteinte')
  return {
    version: 1,
    events: d.events,
    map,
    meta: {
      title: `Stress — ${d.events.length} événements`,
      description: 'Replay synthétique très long (vagues sans fin) pour mesurer les performances du visualiseur.',
      generator: 'stress',
      seed,
      scenario: 'Stress',
    },
  }
}
