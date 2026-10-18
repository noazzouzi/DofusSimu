/**
 * Reconstitution d'un combat réel depuis le journal AnkaBot (tools/fightlog/rejeu.ts), sur un petit flux synthétique au
 * format du journal (noms obfusqués du 2026-10-10) : synchronisation des combattants, manche, tour, déplacement, sort,
 * dégâts avec érosion, soins, poussée, invocation, mort, nouvelle vague ; l'état reconstitué doit égaler la
 * synchronisation suivante du serveur, et le replay se lire sans avertissement.
 */
import { describe, expect, it } from 'vitest'
import { parseReplay } from '../src/replay/validate'
import { rebuild } from '../tools/fightlog/rejeu'
import type { Row } from '../tools/reine-des-voleurs/planificateur/journal'

const carac = (id: number, v: number) => ({ gboz: id, gbpc: { gcuv: 0, gcuw: v } })
const fighter = (id: number, cell: number, team: 0 | 1, extra: { hp: number; loss?: number; erosion?: number; name?: string; monster?: number }) => ({
  gcaw: id,
  gcax: { gblc: cell },
  gcay: {
    gcar: {
      gcac: { gdeq: [carac(0, extra.hp), carac(11, 0), carac(97, extra.loss ?? 0), carac(102, extra.erosion ?? 0), carac(1, 12), carac(23, 6)] },
      gcad: { gdns: team },
      ...(extra.name ? { gcah: { gbyn: extra.name, gbyr: { gbxy: 9, gbyc: 200 } } } : { gcai: { gbzm: { gbyz: extra.monster ?? 3726, gbyx: 1, gbyy: 220 } } }),
    },
  },
})
let i = 0
const m = (n: string, d: unknown): Row => ({ k: 'm', i: ++i, n, d, at: '' })
const act = (fwuv: number, fwuw: number, variant: Record<string, unknown>) => m('jsq', { fwuv, fwuw, ...variant })

describe('reconstitution d’un combat réel (journal AnkaBot)', () => {
  it('rejoue les paquets et retrouve l’état de la synchronisation suivante du serveur', () => {
    const CRA = 900264689957
    const rows: Row[] = [
      m('jvi', { fxjj: 1 }),
      m('juo', { fxgj: [fighter(CRA, 354, 0, { hp: 3000, name: 'Lowkey-Jealous' }), fighter(-13, 133, 1, { hp: 15000 })] }),
      m('jvj', { fxjr: CRA }),
      m('jnz', { fwab: [354, 340, 326], fwaf: CRA }),
      act(300, CRA, { fwuy: { fwqq: 133, fwqr: -13, fwqt: 1, fwqu: { fwpu: 32437, fwpt: 1 } } }),
      act(97, CRA, { fwwd: { fwsf: -13, fwsg: 1000, fwsa: 100, fwse: 1, fwsb: 0 } }),
      act(5, CRA, { fwvb: { fwsr: -13, fwss: 133, fwst: 105 } }),
      act(181, CRA, { fwvi: { fwnc: { fwmv: [{ fwmk: { fwjd: { fwie: 3725, fwif: 1 } }, fwml: { gdeq: [carac(0, 100)] }, fwmp: [{ gdns: 0, gdnt: { gcaw: -18, gcax: { gblc: 312 } } }] }] } } }),
      m('jup', { fxgo: CRA }),
      m('jvj', { fxjr: -13 }),
      act(100, -13, { fwwd: { fwsf: CRA, fwsg: 500, fwsa: 50, fwse: 0, fwsb: 0 } }),
      act(3000, CRA, { fwwf: { fwsl: CRA, fwsn: 200 } }),
      act(103, -13, { fwuz: { fwrl: -18 } }),
      m('jup', { fxgo: -13 }),
      m('juq', { fxgs: 5, fxgt: 2, fxgu: 1 }),
      m('juo', { fxgj: [fighter(CRA, 326, 0, { hp: 3000, loss: -300, erosion: 50, name: 'Lowkey-Jealous' }), fighter(-13, 105, 1, { hp: 15000, loss: -1000, erosion: 100 }), fighter(-38, 160, 1, { hp: 5000, monster: 3749 })] }),
      m('jwh', { fxmu: { [CRA]: { fxdf: { fxac: 1000 } } } }),
    ]
    const res = rebuild(rows)
    expect(res.checks.sync.bad).toBe(0)
    expect(res.checks.sync.ok).toBe(12)
    expect(res.damageBy['Lowkey-Jealous']).toEqual({ rebuilt: 1000, server: 1000 })
    const kinds = res.replay.events.map(e => e.t)
    for (const t of ['fightStart', 'roundStart', 'turnStart', 'move', 'cast', 'damage', 'push', 'summon', 'heal', 'death', 'wave', 'fightEnd']) expect(kinds).toContain(t)
    expect(res.fighters.map(f => f.name)).toContain('Lowkey-Jealous')
    const replay = parseReplay(JSON.parse(JSON.stringify(res.replay)))
    expect(replay.warnings ?? []).toEqual([])
  })

  it('Reine cachée par le serveur, Crâ tué sans dégâts annoncés : aucun écart avec les synchronisations', () => {
    const CRA = 900264689957
    // Synchronisation qui cache la Reine elle-même : case −1, caractéristiques vides (combat du 2026-10-12 à 19:16).
    const cachee = { gcaw: -13, gcax: { gblc: -1 }, gcay: { gcar: { gcac: { gdeq: {} }, gcad: { gdns: 1 }, gcai: { gbzm: { gbyz: 3726, gbyx: 1, gbyy: 220 } } } } }
    const rows: Row[] = [
      m('jvi', { fxjj: 1 }),
      m('juo', { fxgj: [fighter(CRA, 354, 0, { hp: 3000, name: 'Lowkey-Jealous' }), fighter(-13, 133, 1, { hp: 15000 })] }),
      // La Reine devient invisible, le serveur la téléporte en −1 : elle se déplace ensuite sans être vue.
      m('jvj', { fxjr: -13 }),
      act(150, -13, { fwvk: { fwmb: 0, fwmc: -13 } }),
      act(4, -13, { fwvp: { fwob: -1, fwoc: -13 } }),
      m('jup', { fxgo: -13 }),
      m('juo', { fxgj: [fighter(CRA, 354, 0, { hp: 3000, name: 'Lowkey-Jealous' }), cachee] }),
      m('jvi', { fxjj: 2 }),
      // Crâ tué d'un coup par une Bonbombe : mort sans dégâts annoncés.
      m('jvj', { fxjr: -13 }),
      act(103, -13, { fwuz: { fwrl: CRA } }),
      m('jup', { fxgo: -13 }),
      m('juo', { fxgj: [fighter(CRA, 354, 0, { hp: 3000, loss: -3000, name: 'Lowkey-Jealous' }), fighter(-13, 274, 1, { hp: 15000 })] }),
    ]
    const res = rebuild(rows)
    expect(res.checks.mismatches).toEqual([])
    expect(res.checks.sync.ok).toBe(14)
  })
})
