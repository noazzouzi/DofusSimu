/**
 * Tests de propriété du visualiseur de replays :
 *  - accès aléatoire / défilement arrière puis avant == lecture linéaire, pour CHAQUE index
 *    (démo + longs combats synthétiques couvrant tous les types d'événements) ;
 *  - chaque type d'événement produit une ligne de journal (pas de perte silencieuse) ;
 *  - le metteur en scène anime chaque événement visible et respecte le séquencement
 *    (pas de déplacements qui se chevauchent, projectile avant les dégâts, mort après le coup fatal).
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '../src/core/rng'
import type { FightEvent, FighterSnapshot } from '../src/engine/types'
import { createDemoReplay } from '../src/replay/demo'
import { formatInt } from '../src/replay/log'
import { ReplayTimeline, applyEventMut, cloneState, getFighter, initialState, reduce } from '../src/replay/reducer'
import { createStressReplay } from '../src/replay/stress'
import type { Replay, ViewState } from '../src/replay/types'
import { parseReplay, sanitizeEvent } from '../src/replay/validate'
import { POSITION_KINDS, type Anim } from '../web/src/render/anims'
import { Director, type DirectorUi } from '../web/src/render/director'
import type { StageRenderer } from '../web/src/render/renderer'
import { cellCenter } from '../web/src/render/view'

const ALL_TYPES: FightEvent['t'][] = [
  'fightStart', 'roundStart', 'turnStart', 'turnEnd', 'move', 'tackle', 'cast', 'damage', 'heal', 'shield', 'apmp',
  'buff', 'unbuff', 'state', 'push', 'teleport', 'summon', 'death', 'glyph', 'trap', 'wave', 'log', 'fightEnd',
]

/** Empreinte compacte d'un état (FNV-1a de sa sérialisation JSON). */
function digest(s: ViewState): string {
  const json = JSON.stringify(s)
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${json.length}:${(h >>> 0).toString(16)}`
}

/** Empreintes de référence : application séquentielle, un événement après l'autre. */
function linear(replay: Replay): string[] {
  const out: string[] = []
  let s = initialState(replay)
  out.push(digest(s))
  for (let i = 1; i < replay.events.length; i++) {
    s = applyEventMut(cloneState(s), replay.events[i], i, { meta: replay.meta })
    out.push(digest(s))
  }
  return out
}

const REPLAYS: [string, () => Replay][] = [
  ['démo', () => createDemoReplay()],
  ['stress (graine 7)', () => createStressReplay({ events: 2500, seed: 7 })],
  ['stress (graine 99)', () => createStressReplay({ events: 2500, seed: 99 })],
]

describe('réducteur : accès aléatoire == lecture linéaire (tous les index)', () => {
  for (const [name, make] of REPLAYS) {
    const replay = make()
    const ref = linear(replay)
    const n = replay.events.length

    it(`${name} : couvre tous les types d'événements`, () => {
      if (name === 'démo') return
      const kinds = new Set(replay.events.map(e => e.t))
      for (const t of ALL_TYPES) expect(kinds.has(t), t).toBe(true)
    })

    for (const interval of [1, 7, 64]) {
      it(`${name} (${n} év.), images clés /${interval} : saut depuis une position aléatoire vers chaque index`, () => {
        const tl = new ReplayTimeline(replay, { keyframeInterval: interval })
        const rng = new Rng(interval * 31 + n)
        for (let i = 0; i < n; i++) {
          tl.stateAt(rng.int(0, n - 1))
          expect(digest(tl.stateAt(i)), `index ${i}`).toBe(ref[i])
        }
      })

      it(`${name}, images clés /${interval} : défilement arrière complet puis avant complet`, () => {
        const tl = new ReplayTimeline(replay, { keyframeInterval: interval })
        tl.stateAt(n - 1)
        for (let i = n - 1; i >= 0; i--) expect(digest(tl.stateAt(i)), `arrière ${i}`).toBe(ref[i])
        for (let i = 0; i < n; i++) expect(digest(tl.stateAt(i)), `avant ${i}`).toBe(ref[i])
      })
    }

    it(`${name} : retour en arrière puis pas à pas (comme le lecteur), états précédents intacts`, () => {
      const tl = new ReplayTimeline(replay)
      const rng = new Rng(n)
      for (let k = 0; k < 300; k++) {
        const i = rng.int(0, n - 1)
        const kept = tl.stateAt(i)
        const keptDigest = digest(kept)
        for (let j = i + 1; j < Math.min(n, i + 6); j++) expect(digest(tl.stateAt(j))).toBe(ref[j])
        // L'état retourné plus tôt n'est pas modifié par les appels suivants (le lecteur le garde en « prev »).
        expect(digest(kept)).toBe(keptDigest)
        expect(keptDigest).toBe(ref[i])
      }
    })
  }

  it('reduce (pur) enchaîné == applyEventMut, et ne modifie jamais son entrée', () => {
    const replay = createDemoReplay()
    const ref = linear(replay)
    let s = initialState(replay)
    for (let i = 1; i < replay.events.length; i++) {
      const before = digest(s)
      const next = reduce(s, replay.events[i], i, { meta: replay.meta })
      expect(digest(s)).toBe(before)
      expect(digest(next)).toBe(ref[i])
      s = next
    }
  })

  it('l’état final de la chronologie == dernier état linéaire', () => {
    const replay = createStressReplay({ events: 1500, seed: 3 })
    const ref = linear(replay)
    const tl = new ReplayTimeline(replay)
    expect(digest(tl.finalState)).toBe(ref[ref.length - 1])
  })
})

describe('journal : aucun événement perdu en silence', () => {
  const replays = [createDemoReplay(), createStressReplay({ events: 3000, seed: 11 })]

  it('chaque événement visible produit une ligne (ou est fusionné dans la ligne du lancer)', () => {
    for (const replay of replays) {
      const tl = new ReplayTimeline(replay)
      const byIndex = new Map<number, string[]>()
      for (const l of tl.log) byIndex.set(l.index, [...(byIndex.get(l.index) ?? []), l.text])
      let lastCastLine = ''
      for (let i = 0; i < replay.events.length; i++) {
        const ev = replay.events[i]
        const lines = byIndex.get(i) ?? []
        const before = i > 0 ? tl.stateAt(i - 1) : null
        if (ev.t === 'cast') lastCastLine = lines.join(' ')
        switch (ev.t) {
          case 'damage':
          case 'heal':
          case 'shield':
            // Ligne propre, ou fusion « X lance S sur Y : -1 234 PV ».
            if (!lines.length) {
              const amount = ev.t === 'damage' && ev.amount === 0 && ev.shieldAbsorbed ? ev.shieldAbsorbed : ev.amount
              expect(lastCastLine, `${ev.t} #${i}`).toContain(formatInt(amount))
            }
            break
          case 'apmp': {
            if (ev.reason === 'cast' || ev.reason === 'move') break
            const prevEv = replay.events[i - 1]
            if ((prevEv?.t === 'buff' || prevEv?.t === 'unbuff') && prevEv.target === ev.target) break
            const f = before && getFighter(before, ev.target)
            if (f && (f.ap !== ev.ap || f.mp !== ev.mp)) expect(lines.length, `apmp #${i}`).toBeGreaterThan(0)
            break
          }
          case 'unbuff': {
            const known = before && getFighter(before, ev.target)?.buffs.some(b => b.uid === ev.uid)
            if (known) expect(lines.length, `unbuff #${i}`).toBeGreaterThan(0)
            break
          }
          case 'turnEnd':
            break // ligne « passe son tour » seulement si le tour est vide (testé plus bas)
          default:
            expect(lines.length, `${ev.t} #${i}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('un tour sans action est annoncé « passe son tour »', () => {
    const snap = (id: number, team: 0 | 1, name: string, cell: number): FighterSnapshot => ({ id, team, kind: team ? 'monster' : 'player', name, level: 1, hp: 10, maxHp: 10, ap: 6, mp: 3, cell })
    const tl = new ReplayTimeline({
      events: [
        { t: 'fightStart', mapId: 0, seed: 0, fighters: [snap(0, 0, 'Iop', 100), snap(1, 1, 'Tofu', 120)] },
        { t: 'roundStart', round: 1 },
        { t: 'turnStart', fighter: 0, ap: 6, mp: 3 },
        { t: 'log', text: 'rien à faire', level: 'ai' },
        { t: 'turnEnd', fighter: 0 },
        { t: 'turnStart', fighter: 1, ap: 6, mp: 3 },
        { t: 'move', fighter: 1, path: [120, 106], mpUsed: 1 },
        { t: 'turnEnd', fighter: 1 },
        { t: 'fightEnd', winner: null, rounds: 1, reason: 'test' },
      ],
    })
    const texts = tl.log.map(l => l.text)
    expect(texts).toContain('Iop passe son tour')
    expect(texts.some(t => t.startsWith('Tofu passe'))).toBe(false)
  })
})

describe('validation : événements malformés ignorés au lieu de corrompre l’état', () => {
  it('normalise les champs et compte les événements rejetés', () => {
    const r = parseReplay({
      events: [
        { t: 'fightStart', mapId: 1, seed: 1, fighters: [{ id: 0, team: 0, name: 'Iop', cell: 300, hp: 100, maxHp: 100 }, { id: 1, team: 1, cell: 310, hp: 50 }] },
        { t: 'damage', source: 0, target: 1 }, // sans montant : rejeté
        { t: 'damage', source: 0, target: 1, amount: 20, element: 9, kind: 'bizarre' },
        { t: 'move', fighter: 0, path: ['a'] }, // chemin invalide : rejeté
        { t: 'inconnu' },
        { t: 'fightEnd', winner: 0, rounds: 1, reason: 'ok' },
      ],
    })
    expect(r.events.map(e => e.t)).toEqual(['fightStart', 'damage', 'fightEnd'])
    expect(r.warnings?.[0]).toMatch(/3 événements invalides ignorés/)
    const dmg = r.events[1]
    expect(dmg.t === 'damage' && dmg.element).toBe(-1)
    expect(dmg.t === 'damage' && dmg.kind).toBe('direct')
    const tl = new ReplayTimeline(r)
    expect(getFighter(tl.stateAt(1), 1)!.hp).toBe(30)
    expect(getFighter(tl.stateAt(1), 1)!.name).toBe('#1')
  })

  it('tous les événements des replays générés passent la validation sans changement', () => {
    for (const replay of [createDemoReplay(), createStressReplay({ events: 2000, seed: 5 })]) {
      for (const ev of replay.events) {
        const clean = sanitizeEvent(JSON.parse(JSON.stringify(ev)))
        expect(clean).not.toBeNull()
        expect(JSON.parse(JSON.stringify(clean))).toEqual(JSON.parse(JSON.stringify(ev)))
      }
    }
  })
})

// ───────────────────────────── metteur en scène (sans canvas) ─────────────────────────────

interface Recorded {
  i: number
  t: number
  anims: Anim[]
  ui: string[]
  hold: number
}

/** Rejoue un replay dans le metteur en scène avec un faux moteur de rendu ; enregistre tout. */
function direct(replay: Replay): Recorded[] {
  let anims: Anim[] = []
  let ui: string[] = []
  const fake = {
    pal: {
      accent: '#c0601b', gold: '#c9971a', ap: '#2f7fdc', mp: '#2f9e58', heal: '#2f9e47', shield: '#8f63e6',
      team0: '#2b84c6', team1: '#cf4430', elements: ['#8a8072', '#9b6a37', '#e2541f', '#2d82d2', '#34a853'],
    },
    view: { k: 0.8, zoom: 1, visW: 1200, visH: 700 },
    add: (a: Anim) => anims.push(a),
    focus: () => {},
    holdFocus: () => {},
    releaseCamera: () => {},
  } as unknown as StageRenderer
  const uiRec: DirectorUi = {
    turnBanner: f => ui.push(`turn:${f.id}`),
    bigBanner: text => ui.push(`big:${text}`),
    infoStrip: text => ui.push(`strip:${text}`),
  }
  const director = new Director(fake, uiRec)
  const tl = new ReplayTimeline(replay)
  const out: Recorded[] = []
  let t = 0
  for (let i = 1; i < tl.length; i++) {
    anims = []
    ui = []
    const hold = director.apply(tl.events, i, tl.stateAt(i - 1), tl.stateAt(i), t)
    out.push({ i, t, anims, ui, hold })
    t += hold
  }
  return out
}

describe('metteur en scène : animations et séquencement', () => {
  for (const [name, make] of [
    ['démo', () => createDemoReplay()],
    ['stress', () => createStressReplay({ events: 4000, seed: 21 })],
  ] as [string, () => Replay][]) {
    const replay = make()
    const rec = direct(replay)
    const tl = new ReplayTimeline(replay)

    it(`${name} : durées finies et chaque événement visible est animé`, () => {
      for (const r of rec) {
        const ev = replay.events[r.i]
        expect(Number.isFinite(r.hold) && r.hold >= 0, `hold #${r.i}`).toBe(true)
        const visible = r.anims.length + r.ui.length > 0
        switch (ev.t) {
          case 'apmp':
          case 'turnEnd':
          case 'fightStart':
          case 'fightEnd': // écran de résultat (DOM) géré par l'application
            break
          case 'unbuff': {
            const f = getFighter(tl.stateAt(r.i - 1), ev.target)
            if (f?.alive && f.buffs.some(b => b.uid === ev.uid)) expect(visible, `unbuff #${r.i}`).toBe(true)
            break
          }
          case 'move':
            if (ev.path.length > 1) expect(visible, `move #${r.i}`).toBe(true)
            break
          default:
            expect(visible, `${ev.t} #${r.i}`).toBe(true)
        }
      }
    })

    it(`${name} : les déplacements d'un même jeton ne se chevauchent jamais et partent de sa case`, () => {
      const spans = new Map<number, { from: number; to: number; i: number }[]>()
      for (const r of rec) {
        for (const a of r.anims) {
          if (!a.kind || !POSITION_KINDS.has(a.kind) || a.fighter === undefined) continue
          const list = spans.get(a.fighter) ?? []
          list.push({ from: a.t0, to: a.t0 + a.dur, i: r.i })
          spans.set(a.fighter, list)
        }
        const ev = replay.events[r.i]
        if (ev.t === 'move') {
          // L'animation part de la case d'avant et finit sur la case de l'état suivant.
          expect(ev.path[0]).toBe(getFighter(tl.stateAt(r.i - 1), ev.fighter)!.cell)
          expect(ev.path.at(-1)).toBe(getFighter(tl.stateAt(r.i), ev.fighter)!.cell)
          const anim = r.anims.find(a => a.kind === 'move')
          if (ev.path.length > 1) expect(r.hold).toBeGreaterThanOrEqual(anim!.dur)
        }
      }
      for (const [id, list] of spans) {
        list.sort((a, b) => a.from - b.from)
        for (let k = 1; k < list.length; k++) expect(list[k].from, `jeton ${id}, événements #${list[k - 1].i} et #${list[k].i}`).toBeGreaterThanOrEqual(list[k - 1].to)
      }
    })

    it(`${name} : le projectile arrive avant les dégâts / soins qu'il provoque`, () => {
      let landing = -Infinity
      for (const r of rec) {
        const ev = replay.events[r.i]
        if (ev.t === 'cast') {
          const p = r.anims.find(a => a.kind === 'projectile')
          landing = p ? p.t0 + p.dur : -Infinity
        } else if (ev.t === 'move' || ev.t === 'turnStart' || ev.t === 'turnEnd') landing = -Infinity
        if (ev.t === 'damage' || ev.t === 'heal' || ev.t === 'shield') expect(r.t, `#${r.i}`).toBeGreaterThanOrEqual(landing)
      }
    })

    it(`${name} : la mort est jouée après le coup fatal (barre de vie vidée)`, () => {
      for (let k = 1; k < rec.length; k++) {
        const ev = replay.events[rec[k].i]
        const prevEv = replay.events[rec[k - 1].i]
        if (ev.t !== 'death' || prevEv.t !== 'damage' || prevEv.target !== ev.target) continue
        expect(rec[k].t - rec[k - 1].t, `mort #${rec[k].i}`).toBeGreaterThanOrEqual(300)
        expect(rec[k].anims.some(a => a.kind === 'death')).toBe(true)
      }
    })

    it(`${name} : les textes flottants simultanés de combattants voisins ne se superposent pas`, () => {
      const texts: { t: number; x: number; y: number; slot: number; span: number; i: number }[] = []
      for (const r of rec) {
        const s = tl.stateAt(r.i)
        for (const a of r.anims) {
          if (a.kind !== 'text') continue
          const f = getFighter(s, a.target)
          if (!f) continue
          const c = cellCenter(f.cell)
          texts.push({ t: a.t0, x: c.x, y: c.y, slot: a.slot ?? 0, span: a.span ?? 1, i: r.i })
        }
      }
      expect(texts.length).toBeGreaterThan(10)
      let checked = 0
      for (let a = 0; a < texts.length; a++) {
        for (let b = a + 1; b < texts.length && texts[b].t - texts[a].t < 150; b++) {
          const A = texts[a]
          const B = texts[b]
          // Même voisinage écran (k = 0,8 dans le faux rendu) : emplacements disjoints.
          if (Math.abs(A.x - B.x) * 0.8 >= 76 || Math.abs(A.y - B.y) * 0.8 >= 44) continue
          if (A.slot >= 7.5 || B.slot >= 7.5) continue
          checked++
          // Bandes verticales absolues (unités carte) : [ancre − (emplacement + hauteur), ancre − emplacement].
          const unit = 19 / 0.8
          const aTop = A.y - (A.slot + A.span) * unit
          const aBottom = A.y - A.slot * unit
          const bTop = B.y - (B.slot + B.span) * unit
          const bBottom = B.y - B.slot * unit
          const disjoint = aBottom <= bTop + 0.01 || bBottom <= aTop + 0.01
          expect(disjoint, `textes des événements #${A.i} et #${B.i}`).toBe(true)
        }
      }
      expect(checked).toBeGreaterThan(0)
    })
  }
})
