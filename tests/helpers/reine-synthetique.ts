/**
 * Combats synthétiques de la Reine des Voleurs au format du journal AnkaBot (noms obfusqués du 2026-10-10), pour tester
 * l'apprentissage des scénarios sans les journaux réels (non versionnés) : 2 Crâs (Alpha, Beta), la Reine et un
 * Mâchassin ; chaque Crâ a sa Bonbombe au début de son tour, sort de la colonne, tire et revient.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Row } from '../../tools/reine-des-voleurs/planificateur/journal'

export const ALPHA = 900000000001
export const BETA = 900000000002
export const QUEEN_ID = -1
export const MACHASSIN_ID = -2
/** Mule (mode « 4 Crâs + mule ») : 5e personnage qui passe ses tours. */
export const MULE_ID = 900000000003

const carac = (id: number, v: number) => ({ gboz: id, gbpc: { gcuv: 0, gcuw: v } })
const fighter = (id: number, cell: number, team: 0 | 1, extra: { hp: number; name?: string; monster?: number }) => ({
  gcaw: id,
  gcax: { gblc: cell },
  gcay: {
    gcar: {
      gcac: { gdeq: [carac(0, extra.hp), carac(11, 0), carac(97, 0), carac(102, 0), carac(1, 12), carac(23, 6)] },
      gcad: { gdns: team },
      ...(extra.name ? { gcah: { gbyn: extra.name, gbyr: { gbxy: 9, gbyc: 200 } } } : { gcai: { gbzm: { gbyz: extra.monster ?? 3726, gbyx: 1, gbyy: 220 } } }),
    },
  },
})

/** Un tour de Crâ : bombe apparue en `bomb`, sortie vers `out`, tir sur `target` (dégâts), retour sur `home`. */
export interface CraTurn { who: number; home: number; bomb: number; bombId: number; out: number; target: number; targetCell: number; damage: number; kill?: boolean }

export interface FightSpec {
  queenCell: number
  machCell: number
  rounds: { cras: CraTurn[]; queenMove?: number[]; machMove?: number[]; deaths?: number[] }[]
  /** Sorts lancés au début du combat, avant le premier tour (passifs, modificateur de dimension). */
  debut?: { who: number; spell: number }[]
  /** Case d'une mule (« Mule ») qui passe ses tours, jusqu'à sa mort (`deaths` d'une manche). */
  mule?: number
  /** Fin de combat (jwh) ; sans elle, le journal s'arrête en plein combat. */
  end?: boolean
}

/** Lignes du combat (messages « m »), dans l'ordre du serveur. */
export function fightRows(spec: FightSpec): Omit<Row, 'at'>[] {
  const rows: Omit<Row, 'at'>[] = []
  const m = (n: string, d: unknown) => rows.push({ k: 'm', n, d })
  const act = (fwuv: number, fwuw: number, variant: Record<string, unknown>) => m('jsq', { fwuv, fwuw, ...variant })
  m('jvi', { fxjj: 1 })
  m('juo', {
    fxgj: [
      fighter(ALPHA, 354, 0, { hp: 4000, name: 'Alpha' }), fighter(BETA, 381, 0, { hp: 4000, name: 'Beta' }),
      fighter(QUEEN_ID, spec.queenCell, 1, { hp: 15000, monster: 3726 }), fighter(MACHASSIN_ID, spec.machCell, 1, { hp: 6600, monster: 3746 }),
      ...(spec.mule !== undefined ? [fighter(MULE_ID, spec.mule, 0, { hp: 3000, name: 'Mule' })] : []),
    ],
  })
  let muleDead = false
  for (const c of spec.debut ?? []) act(300, c.who, { fwuy: { fwqq: 0, fwqr: c.who, fwqt: 0, fwqu: { fwpu: c.spell, fwpt: 1 } } })
  spec.rounds.forEach((r, k) => {
    if (k > 0) m('jvi', { fxjj: k + 1 })
    for (const t of r.cras) {
      m('jvj', { fxjr: t.who })
      act(181, t.who, { fwvi: { fwnc: { fwmv: [{ fwmk: { fwjd: { fwie: 3725, fwif: 1 } }, fwml: { gdeq: [carac(0, 1)] }, fwmp: [{ gdns: 0, gdnt: { gcaw: t.bombId, gcax: { gblc: t.bomb } } }] }] } } })
      m('jnz', { fwab: [t.home, t.out], fwaf: t.who })
      act(129, t.who, { fwvj: { fwpj: t.who, fwpi: -1 } })
      m('jqh', { fwji: 0, fwjj: t.who })
      act(300, t.who, { fwuy: { fwqq: t.targetCell, fwqr: t.target, fwqt: 0, fwqu: { fwpu: 32437, fwpt: 1 } } })
      act(102, t.who, { fwvj: { fwpj: t.who, fwpi: -4 } })
      act(100, t.who, { fwwd: { fwsf: t.target, fwsg: t.damage, fwsa: 0, fwse: 3, fwsb: 0 } })
      if (t.kill) act(103, t.who, { fwuz: { fwrl: t.target } })
      m('jsy', {})
      m('jnz', { fwab: [t.out, t.home], fwaf: t.who })
      act(129, t.who, { fwvj: { fwpj: t.who, fwpi: -1 } })
      m('jup', { fxgo: t.who })
    }
    if (spec.mule !== undefined && !muleDead) {
      m('jvj', { fxjr: MULE_ID })
      m('jup', { fxgo: MULE_ID })
    }
    for (const id of r.deaths ?? []) {
      act(103, QUEEN_ID, { fwuz: { fwrl: id } })
      if (id === MULE_ID) muleDead = true
    }
    if (r.queenMove) {
      m('jvj', { fxjr: QUEEN_ID })
      m('jnz', { fwab: r.queenMove, fwaf: QUEEN_ID })
      m('jup', { fxgo: QUEEN_ID })
    }
    if (r.machMove) {
      m('jvj', { fxjr: MACHASSIN_ID })
      m('jnz', { fwab: r.machMove, fwaf: MACHASSIN_ID })
      m('jup', { fxgo: MACHASSIN_ID })
    }
  })
  if (spec.end) m('jwh', { fxmu: {} })
  return rows
}

/**
 * Session du journal : les combats donnés, enregistrés par les journaux d'Alpha et Beta (lots nommés, horloge « ms »).
 * `quiet` : Crâs dont le journal ne contient pas leurs propres tours (script occupé à jouer : QUIET_AROUND_MY_TURN). À
 * deux journaux, l'un des deux doit être complet : sinon rien ne dit dans quel ordre les deux Crâs ont joué.
 */
export function writeSession(dir: string, name: string, fights: FightSpec[], opts: { quiet?: string[]; day?: string } = {}): string {
  const day = opts.day ?? '2026-10-12'
  mkdirSync(join(dir, day), { recursive: true })
  const lines: string[] = []
  for (const [who, id] of [['Alpha', ALPHA], ['Beta', BETA]] as const) {
    lines.push(JSON.stringify({ k: 'b', at: `${day}T10:00:00.000Z`, c: who, in: who.toLowerCase() }))
    let i = 0
    let ms = 1000
    fights.forEach((f, k) => {
      ms = 1000 + k * 600000
      let skip = false
      for (const r of fightRows(f)) {
        if (r.n === 'jvj') skip = !!opts.quiet?.includes(who) && r.d.fxjr === id
        if (r.n === 'jup') {
          if (skip) {
            skip = false
            continue
          }
        }
        if (skip) continue
        lines.push(JSON.stringify({ ...r, i: ++i, ms: ms++ }))
      }
    })
  }
  const file = join(dir, day, `${name}.jsonl`)
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}

/** Tours d'un combat type : Alpha tire sur la Reine, Beta sur le Mâchassin ; `queen2` : case de la Reine à la manche 2. */
export function typicalFight(opts: { queen2?: number; win?: boolean; machCell?: number; alphaOut?: number; death?: boolean } = {}): FightSpec {
  const q2 = opts.queen2 ?? 161
  const alpha = (bomb: number, bombId: number, queenCell: number, extra: Partial<CraTurn> = {}): CraTurn => ({ who: ALPHA, home: 354, bomb, bombId, out: opts.alphaOut ?? 340, target: QUEEN_ID, targetCell: queenCell, damage: 3000, ...extra })
  const beta = (bomb: number, bombId: number, machCell: number, extra: Partial<CraTurn> = {}): CraTurn => ({ who: BETA, home: 381, bomb, bombId, out: 367, target: MACHASSIN_ID, targetCell: machCell, damage: 3300, ...extra })
  const mach = opts.machCell ?? 135
  return {
    queenCell: 133,
    machCell: mach,
    rounds: [
      { cras: [alpha(326, -10, 133), beta(353, -11, mach)], queenMove: [133, q2] },
      { cras: [alpha(312, -12, q2), beta(339, -13, mach, { kill: opts.win !== false })], ...(opts.death ? { deaths: [BETA] } : {}) },
      ...(opts.win !== false ? [{ cras: [alpha(298, -14, q2, { damage: 9000, kill: true })] }] : []),
    ],
    end: true,
  }
}
