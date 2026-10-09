// Banc moteur À 4 CRÂS contre une cible : chaque Crâ joue son propre cycle de tours (plans), à 5 cases de la cible
// (4 cases distinctes : en ligne N/S/E/O, ou hors ligne), dans l'ordre Crâ 1..4 puis le monstre (qui ne joue pas).
// Option `repr` : à chaque tour de jeu, UN Crâ (à tour de rôle) commence par Représailles sur la cible (3 PA) — l'état
// partagé (×110 %, Pesanteur, paliers de Dévorante, Tir Perçant) est alors celui du moteur. Mesure : dégâts par tour de
// jeu sur la cible (toutes sources), tours 5 à N.
import { createEngine } from '../../../../src/engine/index'
import { createMonsterFighter, createPlayerFighter } from '../../../../src/engine/factory'
import { castSpell } from '../../../../src/engine/cast'
import { pointToCell } from '../../../../src/map/geometry'
import type { MapData } from '../../../../src/data/model'
import type { Fighter, FightState } from '../../../../src/engine/types'
import { ALL_SPELLS, CRA, CRA_HP, data, nameOf, type TargetSpec, type TurnPlan } from './lib'
import { withExtra, type Extra } from './rotlib'

const openMap = (): MapData => ({ id: 0, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }) as unknown as MapData
export interface TeamResult { perRound: number[]; mean: number; refused: Map<string, number>; byCra: number[] }

export function teamBench(planFor: (cra: number, round: number) => TurnPlan, t: TargetSpec, aligned: boolean, opts: { d?: number; rounds?: number; warm?: number; mpUsed?: number; extra?: Extra; apOf?: (cra: number, round: number) => number } = {}): TeamResult {
  const d = opts.d ?? 5
  const rounds = opts.rounds ?? 12
  const warm = opts.warm ?? 4
  const engine = createEngine(data)
  const tc = { x: 16, y: 0 }
  const spots = aligned
    ? [[0, -d], [0, d], [-d, 0], [d, 0]]
    : [[1, -(d - 1)], [-1, d - 1], [-(d - 1), -1], [d - 1, 1]]
  const cras = spots.map(([dx, dy], k) => {
    const f = createPlayerFighter(data, { name: `Crâ${k + 1}`, breedId: 9, level: 200, stats: withExtra(CRA, opts.extra), maxHp: CRA_HP, spellIds: ALL_SPELLS, team: 0, cell: pointToCell(tc.x + dx, tc.y + dy) })
    f.baseStats.initiative = f.stats.initiative = 9000 - k
    return f
  })
  const m0 = createMonsterFighter(data, { monsterId: t.id, grade: t.grade, team: 1, cell: pointToCell(tc.x, tc.y) })
  m0.baseStats.initiative = m0.stats.initiative = 99999 // le monstre joue en premier : un tour de jeu = monstre puis Crâs 1..4
  const fight = engine.createFight({ map: openMap(), fighters: [...cras, m0], options: { seed: 1, rollMode: 'average', record: true, maxRounds: 999 } as never })
  const C = fight.fighters.filter(f => f.team === 0)
  const m = fight.fighters.find(f => f.team === 1)!
  m.hp = m.maxHp = m.baseMaxHp = 50_000_000
  const home = C.map(c => c.cell), mHome = m.cell
  const refused = new Map<string, number>()
  const perRound: number[] = []
  const byCra = [0, 0, 0, 0]
  const next = (): Fighter | undefined => {
    const cur = engine.current(fight)
    if (cur && fight.round > 0 && cur.alive) engine.endTurn(fight, cur)
    return engine.nextTurn(fight)
  }
  let f = next()
  for (let r = 1; r <= rounds; r++) {
    const n0 = fight.events.length
    // tour du monstre (il ne fait rien), puis les 4 Crâs
    while (f && f.team === 1) f = next()
    for (let guard = 0; guard < 8 && f && f.team === 0; guard++) {
      const k = C.indexOf(f)
      if (opts.apOf) f.ap = opts.apOf(k, r)
      f.mp = CRA.mp - (opts.mpUsed ?? 0)
      const plan: TurnPlan = planFor(k, r).slice()
      for (const st of plan) {
        const res = castSpell(engine, fight, f, st.spell, st.on === 'self' ? f.cell : m.cell)
        C.forEach((c, j) => { if (c.cell !== home[j]) c.cell = home[j] })
        if (m.cell !== mHome) m.cell = mHome
        if (!res.ok && r > warm) refused.set(`Crâ${k + 1} ${nameOf(st.spell)}:${res.failure}`, (refused.get(`Crâ${k + 1} ${nameOf(st.spell)}:${res.failure}`) ?? 0) + 1)
      }
      f = next()
    }
    let dmg = 0
    for (const e of fight.events.slice(n0) as { t: string; target?: number; source?: number; amount?: number }[])
      if (e.t === 'damage' && e.target === m.id) {
        dmg += e.amount ?? 0
        if (r > warm) { const k = C.findIndex(c => c.id === e.source); if (k >= 0) byCra[k] += (e.amount ?? 0) / (rounds - warm) }
      }
    if (r > warm) perRound.push(dmg)
  }
  void ({} as FightState)
  return { perRound, mean: perRound.reduce((s, x) => s + x, 0) / perRound.length, refused, byCra }
}
