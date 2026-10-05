/**
 * Fidélité, honnêteté et déterminisme de l'IA des monstres — compléments de la revue (docs/design/ai.md §11, §13.2,
 * §16.2, §16.5) sur la vraie carte de l'Œil de Vortex avec les vrais sorts :
 *  - glyphes « à l'entrée » sans effet sur le monstre traversées (src/engine/move.ts ne s'arrête que sur les pièges),
 *    glyphes nuisibles contournées ;
 *  - Envolupté (rapprochement de la Méjaire) : valeur de la case d'ARRIVÉE, autorisée quand l'ennemi aligné n'est pas
 *    réellement atteignable (ligne de vue) ;
 *  - poisons : un « dommages subis ×200 % » ne revalorise pas les poisons déjà programmés (pas de double compte) ;
 *  - R20 : espérance des coups critiques en 'average' = (1 − p)·normal + p·critique ;
 *  - honnêteté : la case réelle d'un invisible n'influence pas la décision ;
 *  - déterminisme : `record` on/off ⇒ même combat ; départages stables, tirés de la graine IA.
 */
import { describe, expect, it } from 'vitest'
import { stateHash } from '../src/ai/core/hash'
import { applyMacro, simClone } from '../src/ai/core/sim'
import { LAST_SEEN_TAG, STATE_INVISIBLE } from '../src/ai/core/view'
import { MonsterContext, scoreTransition, type MonsterCandidate } from '../src/ai/monster'
import { nearestAttackController } from '../src/dungeons/generic/controllers'
import { VORTEX_DEFAULT_PARAMS } from '../src/dungeons/vortex/constants'
import { createSmokeTeam } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { critProbability } from '../src/engine/cast'
import { createEngine } from '../src/engine'
import { runFight } from '../src/engine/runner'
import type { EffectData } from '../src/data/model'
import type { FightEvent, FightState, Glyph } from '../src/engine/types'
import { buildOccupancy } from '../src/ai/core/reach'
import { distance } from '../src/map/geometry'
import { GridSearch } from '../src/map/path'
import { zoneMembership } from '../src/map/zones'
import {
  addState, at, brain, BREEDS, BUBOXOR, casts, data, HARPILLE, IKARGN, MEJAIRE, monsterCfg, playTurn, scene, stateEffect, turnOf,
} from './ai-monster-helpers'

function effect(effectId: number, dice: number, mask: string): EffectData {
  return { ...stateEffect(0), effectId, diceNum: dice, diceSide: dice, value: 0, targetMask: mask, duration: 0 }
}

function enterGlyph(fight: FightState, sourceId: number, cell: number, effects: EffectData[]): Glyph {
  const g: Glyph = { uid: fight.nextUid++, sourceId, spellId: 0, cells: [cell], center: cell, remaining: 3, effects, trigger: 'enter', color: '#fff' }
  fight.glyphs.push(g)
  return g
}

function movePath(evs: FightEvent[], id: number): number[] {
  return evs.flatMap(e => (e.t === 'move' && e.fighter === id ? e.path : []))
}

describe('glyphes « à l’entrée » : traversées si sans effet sur le monstre', () => {
  // Ikargn sans PA : il marche vers le Crâ le long de la colonne x = 23 (même géométrie que le test du piège invisible).
  const run = (harmful: boolean) => {
    const s = scene({ players: [{ breed: BREEDS.cra, cell: at(23, -12) }], monsters: [{ id: IKARGN, cell: at(23, -7) }, { id: HARPILLE, cell: at(16, -3) }] })
    const [m, ally] = s.monsters
    const cell = at(23, -9)
    // Glyphe d'un allié qui ne vise que les personnages (comme la 1165 du Vortex), ou glyphe d'un personnage qui vise
    // ses ennemis (dégâts au monstre).
    if (harmful) enterGlyph(s.fight, s.players[0].id, cell, [effect(96, 300, 'A')])
    else enterGlyph(s.fight, ally.id, cell, [effect(96, 300, 'L')])
    turnOf(s.engine, s.fight, m)
    m.ap = 0
    const hp0 = m.hp
    const evs = playTurn(brain(), s, m)
    return { through: movePath(evs, m.id).includes(cell), hpLost: hp0 - m.hp, end: distance(m.cell, s.players[0].cell) }
  }

  it('glyphe alliée « personnages seulement » : chemin le plus court à travers, sans dégâts', () => {
    const r = run(false)
    expect(r.through).toBe(true)
    expect(r.hpLost).toBe(0)
    expect(r.end).toBe(1)
  })

  it('glyphe nuisible : contournée', () => {
    const r = run(true)
    expect(r.through).toBe(false)
    expect(r.hpLost).toBe(0)
  })
})

describe('M-R14 — pas de piège sur son propre chemin (candidats générés ET variantes de case)', () => {
  // Mâchassin (3746, kiter) : Piège à Le Ours (4765) = dégâts sur la cible + piège en croix de rayon 2 centré sur elle.
  const trapCandidates = (mp: number) => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(17, -7) }], monsters: [{ id: 3746, cell: at(14, -7) }] })
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    m.mp = mp
    const top = brain('reference').decideTop(s.engine, s.fight, m, 64)
    const zone = m.spells.find(x => x.spellId === 4765)!.level.effects.find(e => e.effectId === 400)!.zone
    const occ = buildOccupancy(s.fight, m.team)
    const goal = s.players[0].cell
    const g = new GridSearch()
    return top.filter(d => d.cand.cast?.spellId === 4765).map(d => {
      const inZone = zoneMembership(zone, d.cand.cast!.cell, d.cand.from)
      g.run(d.cand.from, x => x === goal || (!!s.fight.map.cells[x]?.walkable && (occ[x] < 0 || occ[x] === m.id)), undefined, goal)
      const path = g.pathTo(goal) ?? []
      const mpLeft = mp - (d.cand.path ? d.cand.path.length - 1 : 0)
      return inZone(d.cand.from) || path.slice(1, -1).slice(0, mpLeft).some(c => inZone(c))
    })
  }

  it('avec des PM : aucun piège simulé ne couvre sa case ni le début de son chemin vers la focale', () => {
    expect(trapCandidates(4).filter(blocks => blocks)).toEqual([])
  })

  it('sans PM : le même piège est un candidat légitime', () => {
    const c = trapCandidates(0)
    expect(c.length).toBeGreaterThan(0)
    expect(c.filter(blocks => blocks)).toEqual([])
  })
})

describe('Méjaire — Envolupté (gapCloser)', () => {
  it('sans PM : l’échange est évalué à la case d’arrivée (rapprochement vers les personnages)', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -7) }], monsters: [{ id: MEJAIRE, cell: at(13, -9) }, { id: IKARGN, cell: at(21, -9) }] })
    const [mej, ik] = s.monsters
    turnOf(s.engine, s.fight, mej)
    mej.mp = 0
    const ikCell = ik.cell
    const d0 = distance(mej.cell, s.players[0].cell)
    const evs = playTurn(brain(), s, mej)
    expect(casts(evs)[0]).toMatchObject({ spellId: 5024, cell: ikCell })
    expect(distance(mej.cell, s.players[0].cell)).toBeLessThan(d0)
  })

  it('ennemi aligné à ≤ 7 mais hors ligne de vue (allié entre eux) : rapprochement autorisé', () => {
    // Iop aligné à 5 cases mais caché par le Buboxor : ni Rayonirique (1-3) ni Plumière (3-7, ligne de vue) ne portent ;
    // l'Ikargn, à 9 cases, est en ligne avec le Iop à 4 cases (portée idéale), ligne de vue dégagée.
    const s = scene({
      players: [{ breed: BREEDS.iop, cell: at(18, -7) }],
      monsters: [{ id: MEJAIRE, cell: at(13, -7) }, { id: BUBOXOR, cell: at(15, -7) }, { id: IKARGN, cell: at(22, -7) }],
    })
    const [mej, , ik] = s.monsters
    turnOf(s.engine, s.fight, mej)
    mej.mp = 0
    const ikCell = ik.cell
    const evs = playTurn(brain(), s, mej)
    expect(casts(evs)[0]).toMatchObject({ spellId: 5024, cell: ikCell })
    expect(mej.cell).toBe(ikCell)
  })
})

describe('poisons et « dommages subis » (pas de double compte)', () => {
  function harpilleScene() {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(22, -9) }, { breed: BREEDS.cra, cell: at(26, -1) }], monsters: [{ id: HARPILLE, cell: at(20, -11) }] })
    const h = s.monsters[0]
    turnOf(s.engine, s.fight, h)
    return { ...s, h }
  }
  const score = (s: ReturnType<typeof harpilleScene>, spellId: number, cell: number) => {
    const ctx = new MonsterContext(s.engine, s.fight, s.h, monsterCfg(1), 'play')
    const cand: MonsterCandidate = { cast: { spellId, cell }, cat: 'damage', prior: 0, key: 'k', spellIndex: s.h.spells.findIndex(x => x.spellId === spellId), from: s.h.cell }
    const sim = simClone(ctx.view, s.fight, 1)
    expect(applyMacro(s.engine, sim, s.h.id, cand)).not.toBeNull()
    return scoreTransition(ctx, sim, cand)
  }

  it('Petit poison : valeur des poisons NOUVEAUX', () => {
    const s = harpilleScene()
    expect(score(s, 5021, s.h.cell).dot).toBeGreaterThan(0)
  })

  it('Tirs optiques sur une cible déjà empoisonnée : aucun terme de poison', () => {
    const s = harpilleScene()
    const iop = s.players[0]
    expect(applyMacro(s.engine, s.fight, s.h.id, { cast: { spellId: 5021, cell: s.h.cell }, cat: 'damage', prior: 0, key: 'p' })).not.toBeNull()
    expect(iop.buffs.some(b => b.spellId === 5021 || /TB/.test(b.triggers ?? ''))).toBe(true)
    s.h.ap = 12
    const p = score(s, 5018, iop.cell)
    expect(p.damage).toBeGreaterThan(0)
    expect(p.dot).toBe(0)
  })
})

describe('M-R20 — critiques en espérance (rollMode average)', () => {
  it('dégâts simulés = (1 − p)·normal + p·critique (interpolation linéaire en p)', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -9) }], monsters: [{ id: BUBOXOR, cell: at(23, -8) }] })
    const m = s.monsters[0]
    const p0 = s.players[0]
    turnOf(s.engine, s.fight, m)
    const ks = m.spells.find(x => x.spellId === 5027)!
    expect(ks.level.criticalEffects.length).toBeGreaterThan(0)
    const dmg = (critical: number): { d: number; p: number } => {
      const c = s.engine.cloneFight(s.fight, false)
      c.options.rollMode = 'average'
      const me = c.fighters[m.id]
      me.stats.critical = critical
      const p = critProbability(me, ks.level)
      const hp0 = c.fighters[p0.id].hp
      expect(applyMacro(s.engine, c, m.id, { cast: { spellId: 5027, cell: p0.cell }, cat: 'damage', prior: 0, key: 'f' })).not.toBeNull()
      return { d: hp0 - c.fighters[p0.id].hp, p }
    }
    const lo = dmg(-1000)
    const hi = dmg(1000)
    const mid = dmg(m.stats.critical + 20)
    expect(hi.p).toBeGreaterThan(lo.p)
    expect(mid.p).toBeGreaterThan(lo.p)
    expect(mid.p).toBeLessThan(hi.p)
    expect(hi.d).toBeGreaterThan(lo.d)
    const expected = lo.d + ((mid.p - lo.p) / (hi.p - lo.p)) * (hi.d - lo.d)
    expect(Math.abs(mid.d - expected)).toBeLessThanOrEqual(Math.max(2, 0.02 * expected))
  })
})

describe('honnêteté : invisibles', () => {
  it('la case réelle d’un invisible (dernière case connue identique) ne change pas la décision', () => {
    const run = (realCell: number) => {
      const s = scene({
        players: [{ breed: BREEDS.iop, cell: at(23, -10) }, { breed: BREEDS.sram, cell: realCell }],
        monsters: [{ id: BUBOXOR, cell: at(23, -7) }],
      })
      const [, sram] = s.players
      const m = s.monsters[0]
      turnOf(s.engine, s.fight, m)
      addState(s.engine, s.fight, sram, STATE_INVISIBLE)
      sram.tags[LAST_SEEN_TAG] = at(25, -6)
      const d = brain().decide(s.engine, s.fight, m)
      const evs = playTurn(brain(), s, m)
      return {
        key: d?.cand.key,
        score: d?.score,
        acts: evs.filter(e => (e.t === 'cast' || e.t === 'move') && e.fighter === m.id).map(e => JSON.stringify(e)),
      }
    }
    const a = run(at(17, -12))
    const b = run(at(26, -1))
    expect(a.key).toBeDefined()
    expect(b).toEqual(a)
  })

  it('ouverture de l’Ikargn : un invisible réellement dans le cercle (mais vu ailleurs) ne la déclenche pas', () => {
    const decide = (realCell: number) => {
      const s = scene({
        players: [{ breed: BREEDS.iop, cell: at(27, -3) }, { breed: BREEDS.sram, cell: realCell }],
        monsters: [{ id: IKARGN, cell: at(20, -8) }],
      })
      const [, sram] = s.players
      const m = s.monsters[0]
      turnOf(s.engine, s.fight, m)
      addState(s.engine, s.fight, sram, STATE_INVISIBLE)
      // Iop hors de portée de l'attraction (PM + 3) ; Sram vu pour la dernière fois loin, réellement au contact ou loin.
      sram.tags[LAST_SEEN_TAG] = at(13, -3)
      const d = brain().decide(s.engine, s.fight, m)
      return { key: d?.cand.key, score: d?.score, reason: d?.cand.reason, forced: d?.cand.forced }
    }
    const near = decide(at(21, -8))
    const far = decide(at(17, -12))
    expect(near).toEqual(far)
  })
})

describe('déterminisme', () => {
  const vortex = (record: boolean): FightState => {
    const engine = createEngine(data, vortexHooks)
    const team = createSmokeTeam(data, [8, 9, 3, 7], { hp: 30000 })
    const fight = createVortexFight(engine, team, { params: { ...VORTEX_DEFAULT_PARAMS, maxRounds: 6 }, seed: 21, rollMode: 'random', record, rngRekey: 'perTurn' })
    const players = nearestAttackController()
    const monsters = brain('play', 21, { explain: record })
    runFight(engine, fight, f => (f.team === 0 ? players : monsters))
    return fight
  }

  it('record on/off (et annotations explain) : même combat', () => {
    const a = vortex(true)
    const b = vortex(false)
    expect(a.events.some(e => e.t === 'aiNote')).toBe(true)
    expect(b.events.length).toBe(0)
    expect(stateHash(b)).toBe(stateHash(a))
    expect(b.rngState).toBe(a.rngState)
  })

  it('départage de deux cibles équivalentes : stable pour une graine, tiré de la graine IA (pas de l’ordre des combattants)', () => {
    const pick = (seed: number): number | undefined => {
      const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -9) }, { breed: BREEDS.iop, cell: at(23, -7) }], monsters: [{ id: BUBOXOR, cell: at(23, -8) }] })
      const m = s.monsters[0]
      turnOf(s.engine, s.fight, m)
      const b = brain('play', seed)
      const d1 = b.decide(s.engine, s.fight, m)
      const d2 = brain('play', seed).decide(s.engine, s.fight, m)
      expect(d2?.cand.key).toBe(d1?.cand.key)
      const t = d1?.cand.cast ? s.fight.fighters.find(f => f.alive && f.cell === d1.cand.cast!.cell) : undefined
      return t ? s.players.indexOf(s.fight.fighters[t.id]) : undefined
    }
    const seen = new Set<number | undefined>()
    for (let seed = 1; seed <= 16; seed++) seen.add(pick(seed))
    expect([...seen].sort()).toEqual([0, 1])
  })
})
