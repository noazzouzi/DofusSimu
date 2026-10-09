// Mesures d'utilité au moteur (Crâ réel) : Balise Tactique (Puissance par ennemi), Sentinelle, Représailles
// (×110 %, Pesanteur, dégâts % PV érodés), Tir Perçant, retraits de PM (espérance contre chaque monstre), vols de vie.
import { writeFileSync } from 'node:fs'
import { createEngine } from '/home/user/DofusSimu/src/engine/index'
import { createMonsterFighter, createPlayerFighter } from '/home/user/DofusSimu/src/engine/factory'
import { castSpell } from '/home/user/DofusSimu/src/engine/cast'
import { pointToCell } from '/home/user/DofusSimu/src/map/geometry'
import { expectedApMpRemoved } from '/home/user/DofusSimu/src/damage/apmp'
import type { MapData } from '/home/user/DofusSimu/src/data/model'
import type { Fighter, FightState } from '/home/user/DofusSimu/src/engine/types'
import { ALL_SPELLS, CRA, CRA_HP, TARGETS, data, fmt, nameOf, bench, inLine } from './lib'

const out: string[] = []
const log = (s = '') => { out.push(s); console.log(s) }
const openMap = (): MapData => ({ id: 0, cells: Array.from({ length: 560 }, (_, id) => ({ id, walkable: true, los: true, placement: 0 as const })) }) as unknown as MapData
function setup(nEnemies: number) {
  const engine = createEngine(data)
  const cra = createPlayerFighter(data, { name: 'Crâ', breedId: 9, level: 200, stats: { ...CRA }, maxHp: CRA_HP, spellIds: ALL_SPELLS, team: 0, cell: pointToCell(16, -5) })
  cra.baseStats.initiative = cra.stats.initiative = 9999
  const cra2 = createPlayerFighter(data, { name: 'Crâ2', breedId: 9, level: 200, stats: { ...CRA }, maxHp: CRA_HP, spellIds: ALL_SPELLS, team: 0, cell: pointToCell(18, -5) })
  cra2.baseStats.initiative = cra2.stats.initiative = 9000
  const mons: Fighter[] = []
  for (let i = 0; i < nEnemies; i++) {
    const t = TARGETS[1 + (i % 5)]
    const m = createMonsterFighter(data, { monsterId: t.id, grade: t.grade, team: 1, cell: pointToCell(14 + 2 * i, 0) })
    m.baseStats.initiative = m.stats.initiative = 1
    mons.push(m)
  }
  const fight = engine.createFight({ map: openMap(), fighters: [cra, cra2, ...mons], options: { seed: 1, rollMode: 'average', record: true, maxRounds: 999 } as never })
  for (const f of fight.fighters) if (f.team === 1) { f.hp = f.maxHp = f.baseMaxHp = 10_000_000 }
  return { engine, fight, c: fight.fighters[0], c2: fight.fighters[1], mons: fight.fighters.filter(f => f.team === 1) }
}
function toTurnOf(engine: ReturnType<typeof createEngine>, fight: FightState, f: Fighter) {
  for (let i = 0; i < 50; i++) {
    const cur = engine.current(fight)
    if (cur && fight.round > 0 && cur.alive) engine.endTurn(fight, cur)
    const nx = engine.nextTurn(fight)
    if (!nx || nx.id === f.id) return
  }
}

// 1. Balise Tactique : Puissance gagnée selon le nombre d'ennemis présents
log('== Balise Tactique (1 PA, relance 2) : Puissance du Crâ après la pose, selon le nombre d\'ennemis sur la carte')
for (const n of [1, 2, 3, 4, 5]) {
  const { engine, fight, c } = setup(n)
  toTurnOf(engine, fight, c)
  const p0 = c.stats.power
  const r = castSpell(engine, fight, c, 32467, pointToCell(16, -9))
  const p1 = c.stats.power
  toTurnOf(engine, fight, c)
  const p2 = c.stats.power
  toTurnOf(engine, fight, c)
  const p3 = c.stats.power
  log(`  ${n} ennemi(s) : pose ${r.ok ? 'OK' : r.failure} ; Puissance ${p0} → ${p1} (+${p1 - p0}) ; tour suivant ${p2} ; tour +2 ${p3} ; invocations alliées : ${fight.fighters.filter(f => f.team === 0 && f.kind !== 'player').map(f => f.name).join(', ') || '—'}`)
}

// 2. Sentinelle : % dommages distance et PO
log('\n== Sentinelle (2 PA, relance 5, 1 lancer/tour pour l\'équipe selon les données)')
{
  const { engine, fight, c } = setup(1)
  toTurnOf(engine, fight, c)
  const before = { d: c.stats.rangedDamagePct, r: c.stats.range }
  const r = castSpell(engine, fight, c, 32475, c.cell)
  log(`  pose ${r.ok ? 'OK' : r.failure} : %dist ${before.d} → ${c.stats.rangedDamagePct}, PO ${before.r} → ${c.stats.range}`)
  toTurnOf(engine, fight, c)
  log(`  tour suivant : %dist ${c.stats.rangedDamagePct}, PO ${c.stats.range}`)
  toTurnOf(engine, fight, c)
  log(`  tour +2 : %dist ${c.stats.rangedDamagePct}, PO ${c.stats.range}`)
  log('  Malus « −2 % dommages distance et −1 PO par PM utilisé » (effets 2805/116 déclenchés) : le moteur n\'émet pas l\'événement « PM utilisé » (README §3 ch. 2) → appliqué à la main.')
}

// 3. Représailles : Pesanteur, ×110 %, dégâts % PV érodés
log('\n== Représailles (3 PA, PO 3-6+4, relance 3, 1 lancer/tour pour l\'équipe)')
for (const t of [TARGETS[0], TARGETS[2]]) {
  const g = inLine(5)
  const base = bench([[{ spell: 32460 }]], t, g, { turns: 4, warm: 0 })
  const withR = bench([[{ spell: 32472 }, { spell: 32460 }], [{ spell: 32460 }], [{ spell: 32460 }], [{ spell: 32460 }]], t, g, { turns: 4, warm: 0 })
  log(`  ${t.name} : Flèche du Jugement seule ${base.perTurn.map(x => fmt(x)).join(' / ')} ; après Représailles au tour 1 : ${withR.perTurn.map(x => fmt(x)).join(' / ')} (tour 1 = Jugement + dégâts propres de Représailles)`)
}
{
  // dégâts propres : 20 % des PV érodés (érosion de base du moteur) après une série de coups
  const t = TARGETS[0]
  const plan = [[{ spell: 32460 }, { spell: 32432 }, { spell: 32427 }, { spell: 32427 }], [{ spell: 32460 }, { spell: 32432 }, { spell: 32427 }, { spell: 32427 }], [{ spell: 32472 }]]
  const r = bench(plan, t, inLine(5), { turns: 3, warm: 0 })
  log(`  Reine : 2 tours de frappe (${fmt(r.perTurn[0] + r.perTurn[1])} dégâts) puis Représailles seule : ${fmt(r.perTurn[2])} dégâts (20 % des PV érodés, Neutre)`)
}
{
  const { engine, fight, c, mons } = setup(2)
  toTurnOf(engine, fight, c)
  const r = castSpell(engine, fight, c, 32472, mons[0].cell)
  log(`  Pesanteur : lancer ${r.ok ? 'OK' : r.failure} ; états cible ${JSON.stringify(mons[0].states)} ; voisin à 2 cases ${JSON.stringify(mons[1].states)}`)
  for (let k = 1; k <= 3; k++) { toTurnOf(engine, fight, c); log(`  début du tour +${k} du Crâ : états cible ${JSON.stringify(mons[0].states)}, buffs 1163 ${mons[0].buffs.filter(b => (b as { effectId?: number }).effectId === 1163).length}`) }
}

// 4. Retraits de PM : espérance par lancer contre chaque monstre
log('\n== Retrait de PM (Crâ : Retrait PM 17 ; plancher 10 % par point, formule src/damage/apmp.ts)')
const RET: [number, string, number][] = [[32427, 'Flèche Cinglante −2 PM', 2], [32436, 'Flèche d\'Immobilisation vol 1 PM', 1], [32441, 'Flèche Paralysante −2 PM', 2], [32439, 'Flèche Ralentissante −1 PM', 1], [32432, 'Flèche Boomerang −2 PM', 2]]
for (const t of TARGETS) {
  const m = createMonsterFighter(data, { monsterId: t.id, grade: t.grade, team: 1 })
  const dodge = m.stats.mpParry, mp = m.stats.mp
  log(`  ${t.name} (PM ${mp}, esquive PM ${dodge}) : ${RET.map(([, n, k]) => `${n} → ${expectedApMpRemoved(CRA.mpReduction, dodge, mp, mp, k).toFixed(2)}`).join(' ; ')}`)
}

// 5. Vols de vie : soins rendus au Crâ par tour dans des rotations types (moteur)
log('\n== Vols de vie (soin du lanceur, moteur) : soin moyen par lancer contre la Reine et le Bourôliste')
for (const s of [32449, 32453, 32433, 32437, 32454, 32442, 32432, 32446]) {
  const res: string[] = []
  for (const t of [TARGETS[0], TARGETS[4]]) {
    const engine = createEngine(data)
    const cra = createPlayerFighter(data, { name: 'Crâ', breedId: 9, level: 200, stats: { ...CRA }, maxHp: CRA_HP, spellIds: ALL_SPELLS, team: 0, cell: pointToCell(16, -5) })
    const m = createMonsterFighter(data, { monsterId: t.id, grade: t.grade, team: 1, cell: pointToCell(16, 0) })
    const fight = engine.createFight({ map: openMap(), fighters: [cra, m], options: { seed: 1, rollMode: 'average', record: true, maxRounds: 99 } as never })
    const c = fight.fighters[0], mm = fight.fighters[1]
    mm.hp = mm.maxHp = 10_000_000
    toTurnOf(engine, fight, c)
    c.hp = 100
    const n0 = fight.events.length
    const r = castSpell(engine, fight, c, s, mm.cell)
    let heal = 0, dmg = 0
    for (const e of fight.events.slice(n0) as { t: string; target?: number; amount?: number }[]) { if (e.t === 'heal' && e.target === c.id) heal += e.amount ?? 0; if (e.t === 'damage' && e.target === mm.id) dmg += e.amount ?? 0 }
    res.push(`${t.name} ${r.ok ? `${fmt(dmg)} dégâts → soin ${fmt(heal)}` : r.failure}`)
  }
  log(`  ${nameOf(s)} : ${res.join(' ; ')}`)
}
writeFileSync(new URL('./utilitaires.txt', import.meta.url), out.join('\n') + '\n')
