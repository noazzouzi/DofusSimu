/**
 * Conformité de l'IA des monstres aux règles officielles (docs/design/ai.md §11.8, docs/research/monster-ai.md §1.2) :
 * une ligne par règle M-R, sur la vraie carte de l'Œil de Vortex avec les vrais sorts. Les numéros R renvoient au
 * tableau R1-R25 du dossier de recherche.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  inferArchetype, MonsterContext, registerMonsterProfile, resolveProfile, scoreTransition, VORTEX_PROFILES, type MonsterCandidate,
} from '../src/ai/monster'
import { applyMacro, simClone } from '../src/ai/core/sim'
import { createMonsterFighter } from '../src/engine/factory'
import type { EffectData } from '../src/data/model'
import type { Fighter, FightState, Glyph } from '../src/engine/types'
import { distance } from '../src/map/geometry'
import {
  addStat, addState, at, AURORAIRE, brain, BRABUZAR, BREEDS, BUBOXOR, casts, data, HARPILLE, IKARGN, MEJAIRE, monsterCfg, playTurn,
  scene, stateEffect, THL, turnOf, VORTEX,
} from './ai-monster-helpers'

afterEach(() => {
  // Profils explicites restaurés (tests qui en remplacent un).
  for (const [id, p] of Object.entries(VORTEX_PROFILES)) registerMonsterProfile(Number(id), p)
})

/** Met les PA du monstre à 0 pour n'observer que son déplacement de fin de tour. */
function noAp(m: Fighter): void {
  m.ap = 0
}

function adjacentTo(cell: number, fs: Fighter[]): number {
  return fs.filter(f => f.alive && distance(cell, f.cell) === 1).length
}

function effect(effectId: number, dice: number, mask: string): EffectData {
  return { ...stateEffect(0), effectId, diceNum: dice, diceSide: dice, value: 0, targetMask: mask, duration: 0 }
}

function glyph(fight: FightState, sourceId: number, cells: number[], effects: EffectData[]): Glyph {
  const g: Glyph = { uid: fight.nextUid++, sourceId, spellId: 0, cells, center: cells[0], remaining: 3, effects, trigger: 'turnStart', color: '#fff' }
  fight.glyphs.push(g)
  return g
}

describe('archétypes et profils (§11.6)', () => {
  it('profils explicites du Vortex et archétypes inférés', () => {
    const s = scene({ monsters: [{ id: IKARGN, cell: at(20, -8) }, { id: MEJAIRE, cell: at(22, -8) }, { id: HARPILLE, cell: at(24, -8) }, { id: BUBOXOR, cell: at(26, -8) }, { id: BRABUZAR, cell: at(21, -3) }, { id: VORTEX, cell: at(24, -3) }] })
    const [ik, mej, har, bub, bra, vx] = s.monsters
    expect(resolveProfile(s.engine, ik).behaviour).toBe('aggressive')
    expect(resolveProfile(s.engine, mej).behaviour).toBe('kiter')
    expect(resolveProfile(s.engine, har).behaviour).toBe('kiter')
    expect(resolveProfile(s.engine, bub).behaviour).toBe('aggressive')
    expect(resolveProfile(s.engine, bra).behaviour).toBe('aggressive')
    expect(resolveProfile(s.engine, vx).behaviour).toBe('kiter')
    // Inférence (sans profil) cohérente avec les profils écrits à la main.
    expect(inferArchetype(s.engine, ik).archetype).toBe('aggressive')
    expect(inferArchetype(s.engine, mej).archetype).toBe('kiter')
    expect(inferArchetype(s.engine, har).archetype).toBe('kiter')
    expect(inferArchetype(s.engine, bub).archetype).toBe('aggressive')
    expect(inferArchetype(s.engine, bra).archetype).toBe('aggressive')
    expect(inferArchetype(s.engine, vx).archetype).toBe('kiter')
    // Auroraire : 0 PA / 0 PM ⇒ statique.
    const aur = createMonsterFighter(data, { monsterId: AURORAIRE, grade: 5, team: 1, cell: at(16, -3) })
    expect(inferArchetype(s.engine, aur).archetype).toBe('static')
    expect(resolveProfile(s.engine, aur).behaviour).toBe('static')
    // Effet 2188 : le tag surcharge le comportement (1 agressif, 2 peureux, 5 apathique).
    mej.tags.aiBehaviour = 5
    expect(resolveProfile(s.engine, mej).behaviour).toBe('apathetic')
    mej.tags.aiBehaviour = 2
    expect(resolveProfile(s.engine, mej)).toMatchObject({ behaviour: 'fearful', source: 'tag' })
  })

  it('archétypes sur des monstres hors Vortex (invocateur, soigneur, bloqueur, peureux, kamikaze)', () => {
    const s = scene({ monsters: [] })
    const arch = (id: number) => inferArchetype(s.engine, createMonsterFighter(data, { monsterId: id, grade: 3, team: 1, cell: -1 }))
    expect(arch(121)).toMatchObject({ archetype: 'summoner' }) // Minotoror
    expect(arch(260)).toMatchObject({ archetype: 'healer', behaviour: 'support' }) // Branche Soignante
    expect(arch(233)).toMatchObject({ archetype: 'blocker', behaviour: 'blocker' }) // Troollaraj
    expect(arch(3379)).toMatchObject({ archetype: 'fearful', behaviour: 'fearful' }) // Harrogant
    expect(arch(2941).capabilities.kamikaze).toBe(true) // Gobus
    expect(arch(121).capabilities.summon).toBe(true)
  })
})

describe('M-R1 / M-R23 — se placer au contact de plusieurs ennemis', () => {
  it('agressif : finit adjacent aux deux personnages (R1)', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(22, -3) }, { breed: BREEDS.cra, cell: at(22, -1) }], monsters: [{ id: IKARGN, cell: at(25, -2) }] })
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    noAp(m)
    playTurn(brain(), s, m)
    expect(adjacentTo(m.cell, s.players)).toBe(2)
  })

  it('bloqueur : même placement (R23), profil remplacé', () => {
    registerMonsterProfile(BUBOXOR, { behaviour: 'blocker' })
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(22, -3) }, { breed: BREEDS.cra, cell: at(22, -1) }], monsters: [{ id: BUBOXOR, cell: at(26, -2) }] })
    const m = s.monsters[0]
    expect(resolveProfile(s.engine, m).behaviour).toBe('blocker')
    turnOf(s.engine, s.fight, m)
    noAp(m)
    playTurn(brain(), s, m)
    expect(adjacentTo(m.cell, s.players)).toBe(2)
  })
})

describe('M-R3 — glyphes : finir sur les positives, jamais sur les négatives', () => {
  it('évite une glyphe de dégâts posée sur la meilleure case', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(22, -3) }, { breed: BREEDS.cra, cell: at(22, -1) }], monsters: [{ id: IKARGN, cell: at(25, -2) }] })
    const m = s.monsters[0]
    const bad = at(22, -2)
    glyph(s.fight, s.players[0].id, [bad], [effect(96, 300, 'A')])
    turnOf(s.engine, s.fight, m)
    noAp(m)
    playTurn(brain(), s, m)
    expect(m.cell).not.toBe(bad)
    expect(adjacentTo(m.cell, s.players)).toBeGreaterThanOrEqual(1)
  })

  it('rejoint une glyphe de soin seulement s’il est blessé', () => {
    const run = (hpFrac: number) => {
      const s = scene({ players: [{ breed: BREEDS.iop, cell: at(15, -12) }], monsters: [{ id: IKARGN, cell: at(25, -4) }, { id: MEJAIRE, cell: at(27, -7) }] })
      const [m, ally] = s.monsters
      const good = at(27, -3)
      glyph(s.fight, ally.id, [good], [effect(108, 400, 'a')])
      turnOf(s.engine, s.fight, m)
      m.hp = Math.round(m.maxHp * hpFrac)
      noAp(m)
      playTurn(brain(), s, m)
      return m.cell === good
    }
    expect(run(0.3)).toBe(true)
    expect(run(1)).toBe(false)
  })
})

describe('M-R4 / M-R5 — tacle : ne pas fuir un tacle sans gain', () => {
  it('un agressif qui tacle deux ennemis reste en place', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(22, -3) }, { breed: BREEDS.cra, cell: at(22, -1) }], monsters: [{ id: IKARGN, cell: at(22, -2) }] })
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    noAp(m)
    const evs = playTurn(brain(), s, m)
    expect(evs.some(e => e.t === 'move')).toBe(false)
    expect(m.cell).toBe(at(22, -2))
  })
})

describe('M-R7 / M-R8 — renvoi de dommages', () => {
  it('préfère la cible sans renvoi à cible égale (R8)', () => {
    const s = scene({ players: [{ breed: BREEDS.sacrieur, cell: at(23, -9) }, { breed: BREEDS.sacrieur, cell: at(23, -7) }], monsters: [{ id: BUBOXOR, cell: at(23, -8) }] })
    const [a, b] = s.players
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    a.baseStats = { ...a.baseStats, reflect: 150 }
    s.engine.recomputeStats(a)
    const d = brain().decide(s.engine, s.fight, m)
    expect(d?.cand.cast?.cell).toBe(b.cell)
  })
})

/** Vortex « phase 2 » sur moteur nu (sans Vortexiphan) : pas de Marginal. */
function vortexScene(players: { breed: number; cell: number }[], vortexCell: number) {
  const s = scene({ players, monsters: [{ id: VORTEX, cell: vortexCell }] })
  return { ...s, v: s.monsters[0] }
}

describe('M-R9 — attaquer un invulnérable si cela retire un état', () => {
  it('Heuristique (réduction des durées) retire l’invulnérabilité d’un personnage aligné', () => {
    const s = vortexScene([{ breed: BREEDS.iop, cell: at(24, -3) }], at(20, -3))
    const [p] = s.players
    turnOf(s.engine, s.fight, s.v)
    addState(s.engine, s.fight, p, 56, 1)
    expect(s.engine.stateFlag(p, 'invulnerable')).toBe(true)
    const evs = playTurn(brain(), s, s.v)
    expect(casts(evs).some(c => c.spellId === 5068 && c.cell === p.cell)).toBe(true)
    expect(s.engine.stateFlag(p, 'invulnerable')).toBe(false)
  })

  it('aucun sort sans retrait d’état n’est lancé sur un invulnérable', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -9) }], monsters: [{ id: BUBOXOR, cell: at(23, -8) }] })
    const [p] = s.players
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    addState(s.engine, s.fight, p, 56, -1, { dispellable: false })
    const evs = playTurn(brain(), s, m)
    expect(casts(evs).filter(c => c.cell === p.cell)).toEqual([])
  })
})

describe('M-R10 / M-R11 / M-R18 — replanification après chaque action', () => {
  it('après un kill, la cible suivante est un autre ennemi (R11)', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -9), hp: 30 }, { breed: BREEDS.cra, cell: at(23, -5) }], monsters: [{ id: BUBOXOR, cell: at(23, -8) }] })
    const [weak, other] = s.players
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    const weakCell = weak.cell
    const evs = playTurn(brain(), s, m)
    const death = evs.findIndex(e => e.t === 'death' && e.target === weak.id)
    expect(death).toBeGreaterThanOrEqual(0)
    const after = casts(evs.slice(death))
    expect(after.filter(c => c.cell === weakCell)).toEqual([])
    void other
  })

  it('un kill prévu raté (jets minimaux) : il continue de frapper la même cible (R10)', () => {
    const make = (rollMode: 'min' | 'average') => scene({ players: [{ breed: BREEDS.iop, cell: at(23, -9) }], monsters: [{ id: BUBOXOR, cell: at(23, -8) }], rollMode })
    // Dégâts d'une Feinterception en jets minimaux et en moyenne sur la cible.
    const probe = (rollMode: 'min' | 'average'): number => {
      const s = make(rollMode)
      turnOf(s.engine, s.fight, s.monsters[0])
      const hp0 = s.players[0].hp
      const c = s.engine.cloneFight(s.fight, false)
      c.options.rollMode = rollMode
      applyMacro(s.engine, c, s.monsters[0].id, { cast: { spellId: 5027, cell: s.players[0].cell }, cat: 'damage', prior: 0, key: 'x' })
      return hp0 - c.fighters[s.players[0].id].hp
    }
    const dMin = probe('min')
    const dAvg = probe('average')
    expect(dAvg).toBeGreaterThan(dMin)
    const s = make('min')
    const [p] = s.players
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    p.hp = Math.floor((dMin + dAvg) / 2)
    const cell = p.cell
    const evs = playTurn(brain(), s, m)
    expect(casts(evs).filter(c => c.cell === cell).length).toBeGreaterThanOrEqual(2)
  })
})

describe('M-R12 / M-R13 — peureux', () => {
  it('ne bascule pas agressif quand sa seule cible est intouchable (R13)', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -10) }], monsters: [{ id: MEJAIRE, cell: at(23, -8) }] })
    const m = s.monsters[0]
    m.tags.aiBehaviour = 2
    turnOf(s.engine, s.fight, m)
    addState(s.engine, s.fight, s.players[0], 56, -1, { dispellable: false })
    playTurn(brain(), s, m)
    expect(m.tags.aiFearAggro).toBeUndefined()
  })

  it('après une attaque, le peureux s’éloigne', () => {
    const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -10) }], monsters: [{ id: MEJAIRE, cell: at(23, -8) }] })
    const m = s.monsters[0]
    m.tags.aiBehaviour = 2
    turnOf(s.engine, s.fight, m)
    const d0 = distance(m.cell, s.players[0].cell)
    const evs = playTurn(brain(), s, m)
    expect(casts(evs).length).toBeGreaterThan(0)
    expect(distance(m.cell, s.players[0].cell)).toBeGreaterThan(d0)
    expect(m.tags.aiFearAggro).toBeUndefined()
  })
})

describe('M-R14 — pas de piège sur son propre chemin', () => {
  it('le Mâchassin ne déclenche jamais ses propres pièges', () => {
    let trapsLaid = 0
    for (const [pc, mc] of [[at(23, -9), at(23, -4)], [at(14, -8), at(20, -3)], [at(25, -2), at(17, -11)], [at(22, -12), at(22, -6)]]) {
      const s = scene({ players: [{ breed: BREEDS.iop, cell: pc }, { breed: BREEDS.cra, cell: at(26, -7) }], monsters: [{ id: 3746, cell: mc }] })
      const m = s.monsters[0]
      const b = brain()
      for (let r = 1; r <= 3; r++) {
        turnOf(s.engine, s.fight, m, r)
        const evs = playTurn(b, s, m)
        trapsLaid += evs.filter(e => e.t === 'trap' && e.added).length
        // Un piège retiré pendant son tour = piège déclenché par son déplacement.
        expect(evs.some(e => e.t === 'trap' && !e.added)).toBe(false)
      }
    }
    expect(trapsLaid).toBeGreaterThan(0)
  })
})

describe('M-R19 — le tour est planifié après les effets de début de tour', () => {
  it('un +4 PA actif au début du tour est dépensé', () => {
    const s = scene({
      players: [{ breed: BREEDS.iop, cell: at(23, -11) }, { breed: BREEDS.cra, cell: at(26, -8) }, { breed: BREEDS.enutrof, cell: at(20, -8) }],
      monsters: [{ id: IKARGN, cell: at(23, -8) }],
    })
    const m = s.monsters[0]
    addStat(s.engine, s.fight, m, 'ap', 4, 3)
    turnOf(s.engine, s.fight, m)
    expect(m.ap).toBe(16)
    const evs = playTurn(brain(), s, m)
    const spent = evs.filter(e => e.t === 'cast' && e.fighter === m.id).reduce((a, e) => a + (e.t === 'cast' ? e.apCost : 0), 0)
    expect(spent).toBeGreaterThan(12)
  })
})

describe('M-R21 — buff au plafond : valeur nulle', () => {
  it('un 4e Bouclier absorbant (cumul 3) ne rapporte rien', () => {
    const s = scene({ players: [{ breed: BREEDS.cra, cell: at(23, -3) }], monsters: [{ id: BUBOXOR, cell: at(23, -8) }] })
    const m = s.monsters[0]
    turnOf(s.engine, s.fight, m)
    const cfg = monsterCfg(1)
    const value = (): number => {
      const ctx = new MonsterContext(s.engine, s.fight, m, cfg, 'play')
      const cand: MonsterCandidate = { cast: { spellId: 5026, cell: m.cell }, cat: 'buff', prior: 0, key: 'b', spellIndex: m.spells.findIndex(x => x.spellId === 5026), from: m.cell }
      const sim = simClone(ctx.view, s.fight, 1)
      expect(applyMacro(s.engine, sim, m.id, cand)).not.toBeNull()
      return scoreTransition(ctx, sim, cand).buffs
    }
    expect(value()).toBeGreaterThan(0)
    for (let i = 0; i < 3; i++) {
      m.cooldowns[5026] = 0
      m.ap = 12
      applyMacro(s.engine, s.fight, m.id, { cast: { spellId: 5026, cell: m.cell }, cat: 'buff', prior: 0, key: 'b' })
    }
    m.cooldowns[5026] = 0
    m.ap = 12
    expect(Math.abs(value())).toBeLessThan(1e-6)
  })
})

describe('M-R25 — budget fixe', () => {
  it('≤ 12 actions par tour ; simulations d’un pas ≤ topK + obligatoires', () => {
    const b = brain()
    const s = scene({
      players: [{ breed: BREEDS.iop, cell: at(23, -10) }, { breed: BREEDS.cra, cell: at(25, -6) }, { breed: BREEDS.enutrof, cell: at(20, -11) }],
      monsters: [{ id: IKARGN, cell: at(23, -7) }, { id: HARPILLE, cell: at(26, -9) }, { id: BRABUZAR, cell: at(21, -8) }],
    })
    for (const m of s.monsters) {
      turnOf(s.engine, s.fight, m)
      const d = b.decide(s.engine, s.fight, m)
      if (d) expect(d.simulated).toBeLessThanOrEqual(b.topK + d.mandatory)
      const evs = playTurn(b, s, m)
      expect(evs.filter(e => (e.t === 'cast' || e.t === 'move') && e.fighter === m.id).length).toBeLessThanOrEqual(13)
    }
  })
})


describe('kamikaze (capacité, monster-ai.md §3) et anticipation (`lookahead`, désactivée par défaut)', () => {
  it('Gobus : Gobstruction (croix, se tue) seulement si elle rapporte plus que 1,5 × ses PV', () => {
    const run = (players: { cell: number; hp: number; fireRes?: number }[]) => {
      const s = scene({ players: players.map(p => ({ breed: BREEDS.cra, cell: p.cell, hp: p.hp, extra: { ...THL, fireResPct: p.fireRes ?? 30 } })), monsters: [{ id: 2941, cell: at(24, -6) }] })
      const m = s.monsters[0]
      expect(inferArchetype(s.engine, m).capabilities.kamikaze).toBe(true)
      turnOf(s.engine, s.fight, m)
      const evs = playTurn(brain(), s, m)
      return { exploded: casts(evs).some(c => c.spellId === 2409), alive: m.alive }
    }
    // Trois personnages à l'agonie dans la croix : l'explosion les tue tous.
    // (le combat se termine sur la mort des trois personnages, avant l'effet « tue le lanceur »)
    const a = run([{ cell: at(24, -10), hp: 60 }, { cell: at(27, -6), hp: 60 }, { cell: at(24, -2), hp: 60 }])
    expect(a.exploded).toBe(true)
    // Un seul personnage en pleine forme et résistant au feu : pas de suicide.
    const b = run([{ cell: at(24, -10), hp: 20000, fireRes: 50 }])
    expect(b.exploded).toBe(false)
    expect(b.alive).toBe(true)
  })

  it('anticipation d’un pas activée par profil (Décollage du Brabuzar) : tour valide et déterministe', () => {
    registerMonsterProfile(BRABUZAR, { ...VORTEX_PROFILES[BRABUZAR], lookahead: [5032] })
    const play = () => {
      const s = scene({ players: [{ breed: BREEDS.iop, cell: at(23, -9) }, { breed: BREEDS.cra, cell: at(23, -10) }], monsters: [{ id: BRABUZAR, cell: at(23, -7) }] })
      const m = s.monsters[0]
      turnOf(s.engine, s.fight, m)
      return casts(playTurn(brain(), s, m)).map(c => `${c.spellId}@${c.cell}`)
    }
    const a = play()
    expect(a.length).toBeGreaterThan(0)
    expect(play()).toEqual(a)
  })
})
