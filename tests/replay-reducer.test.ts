import { describe, expect, it } from 'vitest'
import { Element } from '../src/core/types'
import type { FightEvent, FighterSnapshot } from '../src/engine/types'
import { distance } from '../src/map/geometry'
import { createDemoMap, createDemoReplay } from '../src/replay/demo'
import { formatInt } from '../src/replay/log'
import { ReplayTimeline, applyEventMut, cloneState, getFighter, initialState, reduce } from '../src/replay/reducer'
import type { Replay, ViewState } from '../src/replay/types'
import { ReplayError, parseReplay } from '../src/replay/validate'

const norm = (s: string) => s.replace(/ /g, ' ')

const snap = (id: number, team: 0 | 1, name: string, cell: number, extra: Partial<FighterSnapshot> = {}): FighterSnapshot => ({
  id,
  team,
  kind: team === 0 ? 'player' : 'monster',
  name,
  level: 200,
  hp: 1000,
  maxHp: 1000,
  ap: 10,
  mp: 5,
  cell,
  ...extra,
})

/** Mini-combat écrit à la main pour vérifier la sémantique de chaque événement. */
function miniReplay(): Replay {
  const events: FightEvent[] = [
    { t: 'fightStart', mapId: 1, seed: 7, fighters: [snap(0, 0, 'Iop', 300), snap(1, 1, 'Ikargn', 302), snap(2, 1, 'Buboxor', 330, { role: 'boss' })] },
    { t: 'roundStart', round: 1 }, // 1
    { t: 'turnStart', fighter: 0, ap: 12, mp: 6 }, // 2
    { t: 'move', fighter: 0, path: [300, 301], mpUsed: 1 }, // 3
    { t: 'cast', fighter: 0, spellId: 10, spellName: 'Épée Divine', cell: 302, crit: true, apCost: 4, zone: [302], element: Element.Air }, // 4
    { t: 'apmp', target: 0, ap: 8, mp: 5, reason: 'cast' }, // 5
    { t: 'damage', source: 0, target: 1, amount: 1234 - 1000 + 900, element: Element.Air, kind: 'direct', crit: true, erosion: 113 }, // 6 (1134 > hp : borné)
    { t: 'shield', source: 0, target: 0, amount: 300 }, // 7
    { t: 'buff', target: 2, source: 0, spellId: 11, label: '-2 PA', duration: 2, uid: 50 }, // 8
    { t: 'apmp', target: 2, ap: 8, mp: 5, reason: 'retrait' }, // 9
    { t: 'state', target: 2, stateId: 99, name: 'Invulnérable', added: true }, // 10
    { t: 'glyph', glyph: { uid: 70, cells: [310, 311], color: '#f00', spellId: 12 }, added: true }, // 11
    { t: 'turnEnd', fighter: 0 }, // 12
    { t: 'turnStart', fighter: 2, ap: 8, mp: 5 }, // 13
    { t: 'cast', fighter: 2, spellId: 20, spellName: 'Crachat', cell: 301, crit: false, apCost: 4, zone: [301], element: Element.Neutral }, // 14
    { t: 'damage', source: 2, target: 0, amount: 100, element: Element.Neutral, kind: 'direct', shieldAbsorbed: 300, erosion: 10 }, // 15
    { t: 'heal', source: 2, target: 2, amount: 5000 }, // 16 (borné aux PV max)
    { t: 'push', target: 0, from: 301, to: 299 }, // 17
    { t: 'teleport', target: 2, from: 330, to: 331 }, // 18
    { t: 'summon', summoner: 2, fighter: snap(3, 1, 'Bulle', 332, { kind: 'summon', summonerId: 2 }) }, // 19
    { t: 'turnEnd', fighter: 2 }, // 20
    { t: 'roundStart', round: 2 }, // 21
    { t: 'unbuff', target: 2, uid: 999 }, // 22 (uid inconnu : ignoré)
    { t: 'turnStart', fighter: 0, ap: 12, mp: 6 }, // 23 (buff -2 PA : 2 -> 1 tour)
    { t: 'tackle', fighter: 0, apLost: 2, mpLost: 3 }, // 24
    { t: 'death', target: 2, killer: 0 }, // 25 (glyphe de Buboxor ? non : posée par Iop -> reste)
    { t: 'wave', index: 2, total: 3, fighters: [snap(4, 1, 'Harpille', 400)] }, // 26
    { t: 'state', target: 2, stateId: 99, name: 'Invulnérable', added: false }, // 27
    { t: 'log', text: 'Message libre', level: 'ai' }, // 28
    { t: 'fightEnd', winner: 0, rounds: 2, reason: 'Test' }, // 29
  ]
  return { events, meta: { title: 'mini' } }
}

describe('réducteur de replay — sémantique des événements', () => {
  const tl = new ReplayTimeline(miniReplay(), { keyframeInterval: 4 })
  const at = (i: number) => tl.stateAt(i)
  const f = (s: ViewState, id: number) => getFighter(s, id)!

  it('état initial depuis fightStart', () => {
    const s = at(0)
    expect(s.fighters.map(x => x.name)).toEqual(['Iop', 'Ikargn', 'Buboxor'])
    expect(f(s, 2).boss).toBe(true)
    expect(f(s, 1).boss).toBe(false)
    expect(s.round).toBe(0)
    expect(s.current).toBeNull()
  })

  it('tour, déplacement, lancer (PA), apmp absolu', () => {
    expect(at(2).current).toBe(0)
    expect(f(at(2), 0).ap).toBe(12)
    expect(f(at(3), 0).cell).toBe(301)
    expect(f(at(3), 0).mp).toBe(5)
    expect(f(at(4), 0).ap).toBe(8)
    expect(at(4).lastCast?.targetId).toBe(1)
    expect(f(at(5), 0).ap).toBe(8)
  })

  it('dommages : PV bornés à 0, érosion des PV max ; bouclier absorbé', () => {
    const s6 = at(6)
    expect(f(s6, 1).hp).toBe(0)
    expect(f(s6, 1).maxHp).toBe(887)
    expect(f(s6, 0).metrics.damageDealt).toBe(1134)
    expect(f(at(7), 0).shield).toBe(300)
    const s15 = at(15)
    expect(f(s15, 0).shield).toBe(0)
    expect(f(s15, 0).hp).toBe(900)
    expect(f(s15, 0).maxHp).toBe(990)
    expect(f(at(16), 2).hp).toBe(1000) // soin borné
  })

  it('buffs, états, retraits et durées décrémentées au tour du lanceur', () => {
    const s9 = at(9)
    expect(f(s9, 2).buffs).toEqual([{ uid: 50, sourceId: 0, spellId: 11, label: '-2 PA', remaining: 2 }])
    expect(f(s9, 2).ap).toBe(8)
    expect(f(s9, 0).metrics.apRemoved).toBe(2)
    expect(f(at(10), 2).states).toEqual([{ id: 99, name: 'Invulnérable' }])
    expect(f(at(22), 2).buffs.length).toBe(1)
    expect(f(at(23), 2).buffs[0].remaining).toBe(1)
    expect(f(at(27), 2).states).toEqual([])
  })

  it('poussée, téléportation, tacle', () => {
    expect(f(at(17), 0).cell).toBe(299)
    expect(f(at(18), 2).cell).toBe(331)
    const s24 = at(24)
    expect(f(s24, 0).ap).toBe(10)
    expect(f(s24, 0).mp).toBe(3)
  })

  it('invocation, glyphes, mort, vague et fin de combat', () => {
    expect(at(18).fighters.length).toBe(3)
    expect(f(at(19), 3).summonerId).toBe(2)
    expect(f(at(19), 3).spawnedAt).toBe(19)
    expect(at(11).glyphs.map(g => g.uid)).toEqual([70])
    expect(at(11).glyphs[0].sourceId).toBe(0)
    const s25 = at(25)
    expect(f(s25, 2).alive).toBe(false)
    expect(f(s25, 2).diedAt).toBe(25)
    expect(f(s25, 0).metrics.kills).toBe(1)
    expect(s25.glyphs.length).toBe(1) // la glyphe appartient au Iop
    const s26 = at(26)
    expect(s26.wave).toEqual({ index: 2, total: 3 })
    expect(f(s26, 4).wave).toBe(2)
    expect(at(29).ended).toEqual({ winner: 0, rounds: 2, reason: 'Test' })
    expect(at(29).turnActive).toBe(false)
  })

  it('les glyphes d’un combattant mort disparaissent', () => {
    const r = miniReplay()
    r.events.splice(25, 0, { t: 'cast', fighter: 2, spellId: 21, spellName: 'Flaque', cell: 320, crit: false, apCost: 0, zone: [320] }, {
      t: 'glyph',
      glyph: { uid: 71, cells: [320], color: '#0f0', spellId: 21 },
      added: true,
    })
    const t2 = new ReplayTimeline(r)
    const before = t2.stateAt(26)
    expect(before.glyphs.map(g => g.uid)).toEqual([70, 71])
    expect(t2.stateAt(27).glyphs.map(g => g.uid)).toEqual([70])
  })

  it('reduce est pur', () => {
    const s0 = initialState(miniReplay())
    const copy = JSON.stringify(s0)
    const ev = miniReplay().events[2]
    const s1 = reduce(s0, ev, 2)
    expect(JSON.stringify(s0)).toBe(copy)
    expect(s1).not.toBe(s0)
    expect(s1.current).toBe(0)
  })

  it('marqueurs, navigation par tour et ordre de jeu', () => {
    expect(tl.roundStarts).toEqual([
      { index: 1, round: 1 },
      { index: 21, round: 2 },
    ])
    expect(tl.turnStarts).toEqual([2, 13, 23])
    expect(tl.nextTurnIndex(2)).toBe(13)
    expect(tl.prevTurnIndex(13)).toBe(2)
    expect(tl.prevTurnIndex(2)).toBe(-1)
    expect(tl.nextTurnIndex(23)).toBe(-1)
    expect(tl.roundAt(22)).toBe(2)
    expect(tl.markers.map(m => m.kind)).toEqual(['round', 'round', 'death', 'wave', 'end'])
    // Iop puis Buboxor ont joué ; Ikargn (mort avant de jouer) et les arrivées sont ajoutés ensuite.
    expect(tl.order.slice(0, 2)).toEqual([0, 2])
    expect(new Set(tl.order)).toEqual(new Set([0, 1, 2, 3, 4]))
    expect(tl.order.indexOf(3)).toBe(tl.order.indexOf(2) + 1) // invocation après son invocateur
    expect(tl.turnOrder(at(5))).not.toContain(4)
  })
})

describe('accès aléatoire (images clés)', () => {
  const replay = createDemoReplay()

  it('stateAt(i) en accès aléatoire == application séquentielle, quel que soit l’intervalle', () => {
    const seq: string[] = []
    let s = initialState(replay)
    seq.push(JSON.stringify(s))
    for (let i = 1; i < replay.events.length; i++) {
      s = applyEventMut(cloneState(s), replay.events[i], i, { meta: replay.meta })
      seq.push(JSON.stringify(s))
    }
    for (const interval of [1, 5, 64]) {
      const tl = new ReplayTimeline(replay, { keyframeInterval: interval })
      // Ordre pseudo-aléatoire : avant, arrière, sauts.
      const order = [...Array(replay.events.length).keys()].sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101))
      for (const i of order) expect(JSON.stringify(tl.stateAt(i))).toBe(seq[i])
      for (let i = replay.events.length - 1; i >= 0; i -= 3) expect(JSON.stringify(tl.stateAt(i))).toBe(seq[i])
    }
  })

  it('un état retourné n’est pas modifié par les appels suivants', () => {
    const tl = new ReplayTimeline(replay, { keyframeInterval: 16 })
    const s10 = tl.stateAt(10)
    const frozen = JSON.stringify(s10)
    tl.stateAt(11)
    tl.stateAt(200)
    tl.stateAt(3)
    expect(JSON.stringify(s10)).toBe(frozen)
  })

  it('bornes : index négatif ou trop grand', () => {
    const tl = new ReplayTimeline(replay)
    expect(tl.stateAt(-5).index).toBe(0)
    expect(tl.stateAt(1e9).index).toBe(replay.events.length - 1)
  })
})

describe('journal en français', () => {
  const tl = new ReplayTimeline(createDemoReplay())
  const texts = tl.log.map(l => norm(l.text))

  it('fusionne un lancer et son unique effet sur la cible', () => {
    expect(texts).toContain('Iop lance Épée Divine sur Ikargn : -1 234 PV (Air, critique)')
  })

  it('détaille les sorts de zone, retraits, invocations, vagues et la fin', () => {
    expect(texts.some(t => /^Crâ lance Flèche Explosive sur Méjaire \(coup critique\)$/.test(t))).toBe(true)
    expect(texts.some(t => /^Harpille : -\d+ PV \(Feu, critique\)$/.test(t))).toBe(true)
    expect(texts).toContain('Ikargn : -3 PM (1 tour)')
    expect(texts).toContain('Enutrof invoque Sac Animé')
    expect(texts).toContain('Vague 2/2 : Ikargn et Harpille entrent en combat')
    expect(texts.some(t => t.startsWith('Au tour d’Iop'))).toBe(true)
    expect(texts.some(t => /absorbés par le bouclier/.test(t))).toBe(true)
    expect(texts.at(-1)).toMatch(/^Victoire des personnages en 5 tours/)
  })

  it('logCount est croissant et cohérent avec les index', () => {
    let prev = 0
    for (let i = 0; i < tl.length; i++) {
      const n = tl.logCount(i)
      expect(n).toBeGreaterThanOrEqual(prev)
      for (const l of tl.log.slice(prev, n)) expect(l.index).toBeLessThanOrEqual(i)
      prev = n
    }
    expect(prev).toBe(tl.log.length)
  })

  it('formatInt utilise l’espace fine insécable', () => {
    expect(formatInt(1234567)).toBe('1 234 567')
    expect(formatInt(-950)).toBe('-950')
  })
})

describe('replay de démonstration', () => {
  const replay = createDemoReplay()
  const map = createDemoMap()
  const tl = new ReplayTimeline(replay)

  it('commence par fightStart et finit par fightEnd (victoire)', () => {
    expect(replay.events[0].t).toBe('fightStart')
    const last = replay.events.at(-1)!
    expect(last.t).toBe('fightEnd')
    expect(last.t === 'fightEnd' && last.winner).toBe(0)
    const kinds = new Set(replay.events.map(e => e.t))
    for (const k of ['move', 'cast', 'damage', 'heal', 'shield', 'apmp', 'buff', 'unbuff', 'state', 'push', 'teleport', 'summon', 'death', 'glyph', 'wave', 'tackle', 'log'])
      expect(kinds.has(k as FightEvent['t'])).toBe(true)
    expect(replay.events.some(e => e.t === 'damage' && e.crit)).toBe(true)
  })

  it('reste cohérent : chemins adjacents et marchables, cellules libres, PV/PA/PM valides', () => {
    for (let i = 1; i < replay.events.length; i++) {
      const ev = replay.events[i]
      const before = tl.stateAt(i - 1)
      if (ev.t === 'move') {
        expect(ev.path[0]).toBe(getFighter(before, ev.fighter)!.cell)
        for (let k = 1; k < ev.path.length; k++) {
          expect(distance(ev.path[k - 1], ev.path[k])).toBe(1)
          expect(map.cells[ev.path[k]].walkable).toBe(true)
        }
      }
      if (ev.t === 'teleport' || ev.t === 'push') expect(map.cells[ev.to].walkable).toBe(true)
      const s = tl.stateAt(i)
      const cells = new Set<number>()
      for (const f of s.fighters) {
        expect(f.hp).toBeGreaterThanOrEqual(0)
        expect(f.hp).toBeLessThanOrEqual(f.maxHp)
        expect(f.ap).toBeGreaterThanOrEqual(0)
        expect(f.mp).toBeGreaterThanOrEqual(0)
        if (!f.alive) continue
        expect(map.cells[f.cell].walkable).toBe(true)
        expect(cells.has(f.cell)).toBe(false)
        cells.add(f.cell)
      }
    }
  })

  it('la carte a des trous, des piliers et des cellules de placement', () => {
    expect(map.cells.length).toBe(560)
    expect(map.cells.some(c => !c.walkable && !c.los)).toBe(true)
    expect(map.cells.some(c => c.placement === 1)).toBe(true)
    expect(map.cells.some(c => c.placement === 2)).toBe(true)
    const fs = replay.events[0].t === 'fightStart' ? replay.events[0].fighters : []
    for (const f of fs.filter(x => x.team === 0)) expect(map.cells[f.cell].placement).toBe(1)
  })

  it('survit à un aller-retour JSON via parseReplay', () => {
    const back = parseReplay(JSON.stringify(replay))
    expect(back.events.length).toBe(replay.events.length)
    expect(back.map?.cells.length).toBe(560)
    expect(back.meta?.title).toBe(replay.meta?.title)
  })
})

describe('parseReplay', () => {
  it('accepte un tableau d’événements', () => {
    const r = parseReplay(miniReplay().events)
    expect(r.events.length).toBe(30)
    expect(r.map).toBeUndefined()
  })
  it('rejette les fichiers invalides avec un message en français', () => {
    expect(() => parseReplay({ foo: 1 })).toThrow(ReplayError)
    expect(() => parseReplay('{pas du json')).toThrow(/JSON invalide/)
    expect(() => parseReplay({ events: [{ t: 'roundStart', round: 1 }] })).toThrow(/fightStart/)
  })
})
