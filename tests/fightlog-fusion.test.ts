/**
 * Fusion des journaux d'un groupe (tools/fightlog/fusion.ts) : le tour d'un personnage est pris dans le journal d'un
 * autre (le script d'un Crâ qui joue ne reçoit plus ses messages).
 */
import { describe, expect, it } from 'vitest'
import { mergeStreams } from '../tools/fightlog/fusion'
import type { Row } from '../tools/reine-des-voleurs/planificateur/journal'

const m = (n: string, d: any): Row => ({ k: 'm', n, d, at: '' })
const sync = m('juo', { fxgj: [{ gcaw: 1, gcay: { gcar: { gcah: { gbyn: 'A' } } } }, { gcaw: 2, gcay: { gcar: { gcah: { gbyn: 'B' } } } }] })

function stream(name: string, skipOwn: boolean): Row[] {
  const rows: Row[] = [m('jvi', { fxjj: 1 }), sync]
  for (const [id, who] of [[1, 'A'], [2, 'B'], [1, 'A']] as const) {
    rows.push(m('jvj', { fxjr: id }))
    // Le journal de celui qui joue perd ses propres messages (script occupé).
    if (!(skipOwn && who === name)) rows.push(m('jnz', { fwaf: id, fwab: [10 * id, 10 * id + 1] }))
    rows.push(m('jup', { fxgo: id }))
  }
  return rows
}

describe('fusion des journaux', () => {
  it('chaque tour vient du journal d’un personnage qui ne le joue pas', () => {
    const res = mergeStreams([{ name: 'A', rows: stream('A', true) }, { name: 'B', rows: stream('B', true) }], ['A'])
    const moves = res.rows.filter(r => r.n === 'jnz').map(r => r.d.fwaf)
    expect(moves).toEqual([1, 2, 1])
    // Tours de A pris chez B, tour de B pris chez A.
    expect(res.sources).toEqual({ B: 2, A: 1 })
  })

  it('silence autour de son tour : chaque journal manque des tours, la fusion les a tous, dans l’ordre', () => {
    // 4 personnages (1 à 4) et un monstre (-1) entre 2 et 3, 2 manches ; chacun se tait pendant son tour et celui du
    // combattant qui le précède (QUIET_AROUND_MY_TURN).
    const order = [1, 2, -1, 3, 4, 1, 2, -1, 3, 4]
    const names = 'ABCD'
    const sync4 = m('juo', { fxgj: [1, 2, 3, 4].map(id => ({ gcaw: id, gcay: { gcar: { gcah: { gbyn: names[id - 1] } } } })) })
    const silent = (who: number) => {
      const k0 = order.indexOf(who)
      const before = order[(k0 + order.length / 2 - 1) % (order.length / 2)]
      const rows: Row[] = [m('jvi', { fxjj: 1 }), sync4]
      order.forEach((id, k) => {
        if (k === order.length / 2) rows.push(m('jvi', { fxjj: 2 }))
        if (id === who || id === before) return
        rows.push(m('jvj', { fxjr: id }), m('jnz', { fwaf: id, fwab: [k, k + 1] }), m('jup', { fxgo: id }))
      })
      return rows
    }
    const res = mergeStreams([1, 2, 3, 4].map(who => ({ name: names[who - 1], rows: silent(who) })), ['A'])
    expect(res.rows.filter(r => r.n === 'jnz').map(r => r.d.fwab[0])).toEqual(order.map((_, k) => k))
  })

  it('journal sans le début du combat en cours : laissé de côté, pas son combat précédent', () => {
    // Combat 1 (long) à 0 s, combat 2 à 400 s ; le journal C n'a pas vu la manche 1 du combat 2 (combat de 18:32).
    const t = (ms: number, r: Row): Row => ({ ...r, ms })
    const fight = (ms: number, turns: number, tag: number): Row[] => {
      const rows: Row[] = [t(ms, m('jvi', { fxjj: 1 })), t(ms, sync)]
      for (let k = 0; k < turns; k++) {
        const id = k % 2 === 0 ? 1 : 2
        rows.push(t(ms + k, m('jvj', { fxjr: id })), t(ms + k, m('jnz', { fwaf: id, fwab: [tag, k] })), t(ms + k, m('jup', { fxgo: id })))
      }
      return rows
    }
    const lagging = [...fight(0, 8, 1), ...fight(400000, 2, 2).slice(2)]
    const res = mergeStreams([
      { name: 'A', rows: [...fight(0, 8, 1), ...fight(400000, 2, 2)] },
      { name: 'B', rows: [...fight(0, 8, 1), ...fight(400000, 2, 2)] },
      { name: 'C', rows: lagging },
    ], ['C'])
    expect(res.rows.filter(r => r.n === 'jnz').map(r => r.d.fwab[0])).toEqual([2, 2])
  })

  it('début de manche et fin de combat reçus après un silence : remis à leur place', () => {
    // 4 Crâs (1 à 4) et un monstre (-1), 2 manches. Chaque journal se tait du début du tour du combattant qui précède
    // son personnage jusqu'à la fin du tour de celui-ci : celui de 1 manque le début de la manche 2 (son tour ouvre la
    // manche, le monstre le précède) ; personne ne le lui dit, la fusion doit déduire la manche.
    const order = [1, 2, 3, 4, -1]
    const names = 'ABCD'
    const sync3 = m('juo', { fxgj: [1, 2, 3, 4].map(id => ({ gcaw: id, gcay: { gcar: { gcah: { gbyn: names[id - 1] } } } })) })
    const all: { turn?: [number, number]; row: Row }[] = [{ row: m('jvi', { fxjj: 1 }) }, { row: sync3 }]
    for (const round of [1, 2]) {
      if (round === 2) all.push({ row: m('jvi', { fxjj: 2 }) })
      for (const id of order) {
        const t: [number, number] = [round, id]
        all.push({ turn: t, row: m('jvj', { fxjr: id }) }, { turn: t, row: m('jnz', { fwaf: id, fwab: [round * 100 + id, 0] }) }, { turn: t, row: m('jup', { fxgo: id }) })
      }
    }
    all.push({ row: m('jwh', { fxmu: {} }) })
    const stream = (who: number): Row[] => {
      const prev = order[(order.indexOf(who) + order.length - 1) % order.length]
      const out: Row[] = []
      let quiet = false
      for (const x of all) {
        // (silence sans fin après le tour du monstre de la manche 2 pour 1 : il attend un tour qui ne vient pas)
        if (x.row.n === 'jvj' && x.turn && (x.turn[1] === who || x.turn[1] === prev)) quiet = true
        if (!quiet) out.push(x.row)
        if (x.row.n === 'jup' && x.turn?.[1] === who) quiet = false
      }
      return out
    }
    expect(stream(1).filter(r => r.n === 'jvi')).toHaveLength(1)
    const res = mergeStreams([1, 2, 3, 4].map(who => ({ name: names[who - 1], rows: stream(who) })), ['A'])
    const seq = res.rows.filter(r => r.n === 'jvi' || r.n === 'jvj' || r.n === 'jwh').map(r => (r.n === 'jvi' ? `manche ${r.d.fxjj}` : r.n === 'jwh' ? 'fin' : r.d.fxjr))
    expect(seq).toEqual(['manche 1', 1, 2, 3, 4, -1, 'manche 2', 1, 2, 3, 4, -1, 'fin'])
    expect(res.rows.filter(r => r.n === 'jnz').map(r => r.d.fwab[0])).toEqual([101, 102, 103, 104, 99, 201, 202, 203, 204, 199])
  })

  it('début de tour en double dans un journal (deux instances du script) : un seul tour, manche inchangée', () => {
    const rows = stream('A', false)
    const k = rows.findIndex(r => r.n === 'jvj' && r.d.fxjr === 2)
    rows.splice(k + 1, 0, m('jvj', { fxjr: 2 }))
    const res = mergeStreams([{ name: 'A', rows }])
    expect(res.rows.filter(r => r.n === 'jnz').map(r => r.d.fwaf)).toEqual([1, 2, 1])
    // (le flux de test n'a pas de début de manche 2 : déduit quand 1 rejoue, pas au doublon de 2)
    expect(res.rows.filter(r => r.n === 'jvi' || r.n === 'jvj').map(r => (r.n === 'jvi' ? `manche ${r.d.fxjj}` : r.d.fxjr))).toEqual(['manche 1', 1, 2, 2, 'manche 2', 1])
  })

  it('un seul journal : utilisé tel quel', () => {
    const res = mergeStreams([{ name: 'A', rows: stream('A', false) }])
    expect(res.rows.filter(r => r.n === 'jnz')).toHaveLength(3)
    // Journal complet avec un début de manche suivi d'une vague (juq, synchronisation) et une fin : lignes inchangées.
    const rows = [m('jvi', { fxjj: 1 }), sync, m('jvj', { fxjr: 1 }), m('jup', { fxgo: 1 }), m('jvj', { fxjr: 2 }), m('jup', { fxgo: 2 }),
      m('jvi', { fxjj: 2 }), m('juq', { fxgt: 2 }), m('juo', { fxgj: [] }), m('jvj', { fxjr: 1 }), m('jup', { fxgo: 1 }), m('jwh', {})]
    expect(mergeStreams([{ name: 'A', rows }]).rows).toEqual(rows)
  })
})
