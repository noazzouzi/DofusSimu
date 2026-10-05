/**
 * Scénario « Œil de Vortex » sur le moteur et les données RÉELS (docs/design/ai.md §12.1, §16.3) : mise en place,
 * sorts de départ (Vortexiphan → Auroraire, 5002), équipe qui commence, vagues (tours, composition, invulnérabilité,
 * cases bleues, vague anticipée), règles de résurrection, déverrouillage et *Action !*, fin de combat, résumé,
 * déterminisme, paramètres et variantes INCERTAINES, placement analytique.
 */
import { describe, expect, it } from 'vitest'
import { loadDataStore } from '../src/data/node'
import { getScenario, listScenarios, sampleVariant } from '../src/dungeons'
import { currentHour, deathHours, hourBit, isWaveMonster, lineCells, onHourLine } from '../src/dungeons/vortex/clock'
import {
  ARRIVAL_ROUNDS_ALT,
  AURORAIRE,
  BLUE_START_CELLS,
  BRABUZAR,
  BUBOXOR,
  HARPILLE,
  HOUR_CELL,
  IKARGN,
  MEJAIRE,
  RED_START_CELLS,
  VORTEX,
  VORTEX_DEFAULT_PARAMS,
  VORTEX_MAP_ID,
  VORTEX_UNCERTAIN,
} from '../src/dungeons/vortex/constants'
import { DEFAULT_VARIANT, resolveVortexParams, sampleVortexVariant, validateVortexParams, variantKey, vortexState } from '../src/dungeons/vortex/params'
import { estimateK, rankVortexPlacements } from '../src/dungeons/vortex/placement'
import { createSmokeTeam, playerDeathsBy, SMOKE_BREEDS, summarizeVortex, vortexScenario } from '../src/dungeons/vortex/scenario'
import { createVortexFight, vortexHooks } from '../src/dungeons/vortex/setup'
import { createEngine } from '../src/engine'
import { canCast, castSpell } from '../src/engine/cast'
import { castStartingSpell } from '../src/engine/effects/summons'
import { createMonsterFighter } from '../src/engine/factory'
import type { Engine } from '../src/engine/engine'
import type { Fighter, FightState } from '../src/engine/types'
import { fightDigest } from '../src/optimizer/runner'

const data = loadDataStore('data')

interface Setup {
  engine: Engine
  fight: FightState
  players: Fighter[]
}

function setup(o: { initiative?: number; params?: Record<string, unknown>; seed?: number; record?: boolean; n?: number } = {}): Setup {
  const engine = createEngine(data, vortexHooks)
  const players = createSmokeTeam(data, SMOKE_BREEDS.slice(0, o.n ?? 4), { initiative: o.initiative ?? 4000, hp: 1_000_000 })
  const fight = createVortexFight(engine, players, {
    params: { ...VORTEX_DEFAULT_PARAMS, ...(o.params as object) },
    seed: o.seed ?? 1,
    rollMode: 'random',
    record: o.record ?? false,
    rngRekey: 'perTurn',
  })
  return { engine, fight, players }
}

/** Joue (passivement) jusqu'au début du tour de `f` au tour de jeu `round` au moins. */
function turnOf(s: Setup, f: Fighter, round = 0): void {
  for (let i = 0; i < 3000; i++) {
    const cur = s.engine.current(s.fight)
    if (cur && cur.id === f.id && s.fight.round >= round && s.fight.round > 0) return
    if (cur && s.fight.round > 0 && cur.alive) s.engine.endTurn(s.fight, cur)
    if (!s.engine.nextTurn(s.fight)) break
  }
  throw new Error(`tour de ${f.name} (tour ${round}) jamais atteint`)
}

/** Joue passivement jusqu'au début du tour de jeu `round` (premier créneau joué). */
function toRound(s: Setup, round: number, onTurn?: (f: Fighter) => void): void {
  for (let i = 0; i < 5000 && !s.fight.ended; i++) {
    const cur = s.engine.current(s.fight)
    if (s.fight.round >= round && cur) return
    if (cur && s.fight.round > 0 && cur.alive) s.engine.endTurn(s.fight, cur)
    const f = s.engine.nextTurn(s.fight)
    if (!f) return
    onTurn?.(f)
  }
}

/** Corrompt `m` par le vrai chemin : étoile (234) puis mort ; la résurrection du Vortex la corrompt (5002). */
function markForCorruption(s: Setup, m: Fighter): void {
  const e = data.spellLevel(4996, { grade: 1 })!.effects.find(x => x.effectId === 950 && x.value === 234)!
  if (!m.states.includes(234)) {
    s.engine.addBuff(s.fight, m, { sourceId: m.id, spellId: 4996, effect: e, value: 234, remaining: -1, delay: 0, dispellable: false, stateId: 234, kind: 'stat', label: 'Même heure' })
  }
  s.engine.kill(s.fight, m, s.players[0])
}

const vortexOf = (s: Setup) => s.fight.fighters[vortexState(s.fight)!.vortexId]

describe('registre', () => {
  it('vortex, skirmish et dummy sont enregistrés ; getScenario rejette un id inconnu', () => {
    expect(listScenarios()).toEqual(expect.arrayContaining(['vortex', 'skirmish', 'dummy']))
    expect(getScenario('vortex')).toBe(vortexScenario)
    expect(() => getScenario('nope')).toThrow(/inconnu/)
  })

  it('le moteur doit porter les hooks du Vortex', () => {
    const engine = createEngine(data)
    expect(() => createVortexFight(engine, createSmokeTeam(data), { params: VORTEX_DEFAULT_PARAMS, seed: 1, rollMode: 'random', record: false, rngRekey: 'none' })).toThrow(/hooks/)
  })
})

describe('mise en place (createFight)', () => {
  it('carte, cases rouges, vague 1 = Vortex (rang 1 à 4 joueurs) + 3 monstres au grade 5 sur les cases bleues, sorts de départ réussis', () => {
    const { fight, players } = setup({ record: true })
    expect(fight.map.id).toBe(VORTEX_MAP_ID)
    for (const p of players) expect(RED_START_CELLS).toContain(p.cell)
    expect(new Set(players.map(p => p.cell)).size).toBe(4)
    const vx = vortexState(fight)!
    expect(vx.startingSpellFailures).toEqual([])
    const monsters = fight.fighters.filter(f => f.team === 1 && f.summonerId === undefined)
    expect(monsters.map(m => m.monsterId).sort()).toEqual([VORTEX, IKARGN, MEJAIRE, HARPILLE].sort())
    for (const m of monsters) {
      expect(BLUE_START_CELLS).toContain(m.cell)
      expect(m.grade).toBe(m.monsterId === VORTEX ? 1 : 5)
      expect(m.wave).toBe(1)
    }
    const vortex = vortexOf({ fight } as Setup)
    expect(vortex.cell).toBe(VORTEX_DEFAULT_PARAMS.vortexCell)
    expect(vortex.maxHp).toBe(15000) // rang 1 (4 personnages) : docs/research/vortex-audit.md §3
    // Vortexiphan (5006) : Auroraire en 255 (heure XII), Vortex invulnérable, indéplaçable, Marginal, −100 PM.
    const aur = fight.fighters.find(f => f.monsterId === AURORAIRE)!
    expect(aur.cell).toBe(255)
    expect(aur.summonerId).toBe(vortex.id)
    expect(vx.auroraireId).toBe(aur.id)
    expect(currentHour(fight)).toBe(12)
    expect(vortex.states).toEqual(expect.arrayContaining([56, 97, 236]))
    expect(vortex.stats.mp).toBeLessThanOrEqual(0)
    // 4999 : déclencheur TB → 4996 sur chaque personnage.
    for (const p of players) expect(p.buffs.some(b => b.spellId === 4999 && b.triggers === 'TB')).toBe(true)
    // 5002 : mort (X → 5001) et début de tour (TB → 5012) sur chaque monstre de vague.
    for (const m of monsters.filter(isWaveMonster)) {
      expect(m.buffs.filter(b => b.kind === 'trigger').map(b => `${b.triggers}:${b.effect.diceNum}`).sort()).toEqual(['TB:5012', 'X:5001'])
    }
    // *Action !* est géré par le scénario : le déclencheur différé de 5060 est retiré.
    expect(vortex.buffs.some(b => b.kind === 'delayed' && b.effect.diceNum === 5060)).toBe(false)
    expect(fight.unknownEffects ?? 0).toBe(0)
    expect(fight.events[0].t).toBe('fightStart')
    expect(fight.events.some(e => e.t === 'wave' && e.index === 1)).toBe(true)
  })

  it('N = taille de l’équipe : 3 personnages ⇒ Vortex + 2 monstres, vagues de 3', () => {
    const s = setup({ n: 3 })
    const vx = vortexState(s.fight)!
    expect(vx.players).toBe(3)
    expect(s.fight.fighters.filter(isWaveMonster)).toHaveLength(2)
    toRound(s, 7)
    expect(s.fight.fighters.filter(f => isWaveMonster(f) && f.wave === 2)).toHaveLength(3)
  })

  it('placement fourni respecté ; placement invalide rejeté', () => {
    const engine = createEngine(data, vortexHooks)
    const team = createSmokeTeam(data)
    const fight = createVortexFight(engine, team, { params: VORTEX_DEFAULT_PARAMS, seed: 1, rollMode: 'random', record: false, rngRekey: 'none', placement: [424, 438, 441, 443] })
    expect(team.map(f => f.cell)).toEqual([424, 438, 441, 443])
    expect(fight.timeline.length).toBeGreaterThan(0)
    expect(() => createVortexFight(engine, createSmokeTeam(data), { params: VORTEX_DEFAULT_PARAMS, seed: 1, rollMode: 'random', record: false, rngRekey: 'none', placement: [424, 424, 441, 443] })).toThrow(/deux fois/)
    expect(() => createVortexFight(engine, createSmokeTeam(data), { params: VORTEX_DEFAULT_PARAMS, seed: 1, rollMode: 'random', record: false, rngRekey: 'none', placement: [270, 438, 441, 443] })).toThrow()
  })
})

describe('équipe qui commence (startingTeamRule, INCERTAIN)', () => {
  it('« moyenne » : joueurs à 4000 ⇒ ils commencent, le Vortex joue après le 4e (k = 4) ; Auroraire après le Vortex', () => {
    const { fight } = setup({ initiative: 4000 })
    const names = fight.timeline.map(id => fight.fighters[id])
    expect(names[0].kind).toBe('player')
    const vi = names.findIndex(f => f.monsterId === VORTEX)
    expect(names.slice(0, vi).filter(f => f.kind === 'player')).toHaveLength(4)
    expect(names[vi + 1].monsterId).toBe(AURORAIRE)
  })

  it('« moyenne » contre « meilleur » : un seul joueur rapide ne suffit pas en moyenne', () => {
    const mk = (rule: 'average' | 'best') => {
      const engine = createEngine(data, vortexHooks)
      const team = createSmokeTeam(data, SMOKE_BREEDS, { initiative: 1000 })
      team[0].baseStats.initiative = 5000
      team[0].stats.initiative = 5000
      return createVortexFight(engine, team, { params: { ...VORTEX_DEFAULT_PARAMS, startingTeamRule: rule }, seed: 1, rollMode: 'random', record: false, rngRekey: 'none' })
    }
    const avg = mk('average')
    const best = mk('best')
    expect(avg.fighters[avg.timeline[0]].team).toBe(1)
    expect(best.fighters[best.timeline[0]].team).toBe(0)
  })

  it('estimateK suit la même règle', () => {
    const team = createSmokeTeam(data)
    expect(estimateK(team, { startingTeamRule: 'average', players: 4 })).toBe(4)
    const slow = createSmokeTeam(data, SMOKE_BREEDS, { initiative: 1000 })
    expect(estimateK(slow, { startingTeamRule: 'average', players: 4 })).toBe(3)
  })
})

describe('vagues', () => {
  it('tours 1/7/13/19/25 (défaut, 2.42), composition JOL, cases bleues, invulnérables le tour d’arrivée', () => {
    const s = setup()
    const seen: number[] = []
    toRound(s, 26, f => {
      if (isWaveMonster(f) && f.wave === 2 && !seen.includes(s.fight.round)) seen.push(s.fight.round)
    })
    const vx = vortexState(s.fight)!
    expect(vx.waveRounds).toEqual([1, 7, 13, 19, 25])
    expect(vx.wavesSpawned).toBe(5)
    const byWave = (w: number) => s.fight.fighters.filter(f => isWaveMonster(f) && f.wave === w).map(f => f.monsterId).sort()
    expect(byWave(2)).toEqual([HARPILLE, HARPILLE, BUBOXOR, BRABUZAR].sort())
    expect(byWave(3)).toEqual([MEJAIRE, MEJAIRE, HARPILLE, BRABUZAR].sort())
    expect(byWave(4)).toEqual([BRABUZAR, BRABUZAR, MEJAIRE, IKARGN].sort())
    expect(byWave(5)).toEqual([BUBOXOR, BUBOXOR, BRABUZAR, IKARGN].sort())
    // La vague 2 joue pour la 1re fois au tour 7 (invulnérable) puis au tour 8.
    expect(seen[0]).toBe(7)
    expect(s.fight.unknownEffects ?? 0).toBe(0)
  })

  it('invulnérabilité d’arrivée : état 56 pendant le tour d’arrivée, pas de glyphe, retirée au tour suivant', () => {
    const s = setup()
    toRound(s, 7)
    const w2 = s.fight.fighters.filter(f => isWaveMonster(f) && f.wave === 2)
    expect(w2).toHaveLength(4)
    for (const m of w2) {
      expect(m.states).toContain(56)
      expect(BLUE_START_CELLS.concat(m.cell)).toContain(m.cell)
    }
    // Leur premier tour (tour 7) : invulnérables ⇒ aucune glyphe posée par eux (5012, masque *e56).
    toRound(s, 8)
    expect(s.fight.glyphs.filter(g => w2.some(m => m.id === g.sourceId))).toHaveLength(0)
    for (const m of w2) expect(m.states).not.toContain(56)
    // Tour 8 : vulnérables, ils posent leur glyphe en début de tour.
    turnOf(s, w2[w2.length - 1], 8)
    expect(s.fight.glyphs.some(g => g.sourceId === w2[0].id)).toBe(true)
  })

  it('variante JOL : tours 1/6/11/16/21', () => {
    const s = setup({ params: { arrivalRounds: [...ARRIVAL_ROUNDS_ALT] } })
    toRound(s, 22)
    expect(vortexState(s.fight)!.waveRounds).toEqual([1, 6, 11, 16, 21])
  })

  it('vague anticipée (earlySpawnIfCleared) : vague 1 corrompue ⇒ vague 2 au tour suivant', () => {
    const s = setup({ params: { earlySpawnIfCleared: true } })
    const [p1] = s.players
    turnOf(s, p1, 1)
    for (const m of s.fight.fighters.filter(isWaveMonster)) markForCorruption(s, m)
    toRound(s, 2)
    const vx = vortexState(s.fight)!
    expect(s.fight.fighters.filter(isWaveMonster).filter(m => m.wave === 1).every(m => m.states.includes(6611))).toBe(true)
    expect(vx.waveRounds).toEqual([1, 2])
    // Défaut (désactivé) : pas d'arrivée anticipée.
    const d = setup()
    turnOf(d, d.players[0], 1)
    for (const m of d.fight.fighters.filter(isWaveMonster)) markForCorruption(d, m)
    toRound(d, 3)
    expect(vortexState(d.fight)!.waveRounds).toEqual([1])
  })
})

describe('mort, heure de mort, résurrection', () => {
  it('heure de mort marquée sur le mort, résurrection au tour du Vortex (Zombi, bonus de l’heure)', () => {
    const s = setup({ seed: 3 })
    const [p1] = s.players
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    turnOf(s, p1, 1)
    const crit = ika.stats.critical
    s.engine.kill(s.fight, ika, p1)
    expect(deathHours(ika)).toBe(hourBit(1))
    turnOf(s, vortexOf(s), 1)
    expect(ika.alive).toBe(true)
    expect(ika.states).toContain(74)
    expect(ika.stats.critical).toBe(crit + 10) // heure I : +10 % critique (5002)
    expect(ika.hp).toBeGreaterThanOrEqual(Math.floor(ika.maxHp * 0.2))
    expect(ika.hp).toBeLessThanOrEqual(Math.floor(ika.maxHp * 0.3))
    // rezMinusOneMp = vrai (défaut, 2.42 : « 1 PM en moins ») : 5 → 4 PM.
    expect(ika.stats.mp).toBe(4)
  })

  // Défaut du moteur diagnostiqué (rapport WP3a) : la chaîne des données 5002 (X) → 5001 → 5000 ne pose pas l'état
  // d'heure sur le mourant. Le ciblage est correct (`fromDeath` propagé jusqu'au 5000 de l'Auroraire), mais `addState`
  // (src/engine/effects/buffs/states.ts) refuse toute cible `!alive` : l'état 233 de 5001 (masque C) n'est jamais posé,
  // puis le masque `a,E233,*E22h` de 5000 écarte le mourant. Le scénario pose l'état en repli (`markDeathHour`). Ce test
  // échouera (et devra être retiré) le jour où le moteur sera corrigé.
  it('diagnostic moteur : les données seules (sans le repli du scénario) marquent l’heure de mort', () => {
    const engine = createEngine(data) // aucun hook de scénario : seules les données agissent
    const team = createSmokeTeam(data)
    team.forEach((f, i) => (f.cell = [424, 438, 441, 443][i]))
    const mons = [[VORTEX, 272], [IKARGN, 270], [MEJAIRE, 274], [HARPILLE, 268]].map(([monsterId, cell]) =>
      createMonsterFighter(data, { monsterId, grade: 5, team: 1, cell }),
    )
    const fight = engine.createFight({ map: data.map(VORTEX_MAP_ID)!, fighters: [...team, ...mons], options: { seed: 1, rollMode: 'random', record: false, maxRounds: 60 } })
    for (const m of mons) castStartingSpell(engine, fight, m)
    const first = engine.nextTurn(fight)!
    expect(first.kind).toBe('player')
    expect(currentHour(fight)).toBe(1)
    engine.kill(fight, mons[1], first)
    expect(deathHours(mons[1])).toBe(hourBit(1))
  })

  // Cause racine du défaut ci-dessus, isolée : 5001 (lancé par le mourant via le déclencheur X de 5002) cible bien le
  // mourant, mais l'effet 950 (état 233 « Mort latente ») n'est pas posé (`addState` : `!t.alive`). Attendu : un
  // événement `state` 233 ajouté sur le mourant avant son retrait à la mort (233 est désenvoûtable, 2).
  it('diagnostic moteur : 5001 effet 950 pose l’état 233 sur le mourant (déclencheur X)', () => {
    const engine = createEngine(data)
    const team = createSmokeTeam(data)
    team.forEach((f, i) => (f.cell = [424, 438, 441, 443][i]))
    const ika = createMonsterFighter(data, { monsterId: IKARGN, grade: 5, team: 1, cell: 270 })
    const fight = engine.createFight({ map: data.map(VORTEX_MAP_ID)!, fighters: [...team, ika], options: { seed: 1, rollMode: 'random', record: true, maxRounds: 60 } })
    castStartingSpell(engine, fight, ika)
    const first = engine.nextTurn(fight)!
    const n0 = fight.events.length
    engine.kill(fight, ika, first)
    const added = fight.events.slice(n0).some(e => e.t === 'state' && e.target === ika.id && e.stateId === 233 && e.added)
    expect(added).toBe(true)
  })

  it('variante rezHpPct [50, 50] et rezMinusOneMp', () => {
    const s = setup({ params: { rezHpPct: [50, 50], rezMinusOneMp: true }, seed: 9 })
    const [p1] = s.players
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    turnOf(s, p1, 1)
    s.engine.kill(s.fight, ika, p1)
    turnOf(s, vortexOf(s), 1)
    expect(ika.hp).toBe(Math.floor(ika.maxHp * 0.5))
    expect(ika.stats.mp).toBe(4)
  })

  it('variante rezAllPerTurn = false : un seul mort ressuscité par tour du Vortex', () => {
    const s = setup({ params: { rezAllPerTurn: false }, seed: 2 })
    const [p1] = s.players
    turnOf(s, p1, 1)
    const wave = s.fight.fighters.filter(isWaveMonster)
    for (const m of wave) s.engine.kill(s.fight, m, p1)
    turnOf(s, vortexOf(s), 1)
    expect(wave.filter(m => m.alive)).toHaveLength(1)
    turnOf(s, vortexOf(s), 2)
    expect(wave.filter(m => m.alive)).toHaveLength(2)
    // Défaut : tous ressuscités.
    const d = setup({ seed: 2 })
    turnOf(d, d.players[0], 1)
    const w = d.fight.fighters.filter(isWaveMonster)
    for (const m of w) d.engine.kill(d.fight, m, d.players[0])
    turnOf(d, vortexOf(d), 1)
    expect(w.every(m => m.alive)).toBe(true)
  })
})

/** Joue le combat en corrompant chaque monstre de vague dès son arrivée (sauf `keep`), jusqu'au tour `round`. */
function corruptAll(s: Setup, round: number, keep?: (m: Fighter) => boolean): void {
  toRound(s, round, f => {
    if (f.kind !== 'player') return
    for (const m of s.fight.fighters) {
      if (!isWaveMonster(m) || !m.alive || m.states.includes(6611) || m.states.includes(56)) continue
      if (keep?.(m)) continue
      markForCorruption(s, m)
    }
  })
}

describe('déverrouillage et Action ! (5060)', () => {
  // Déverrouillage après la corruption de la vague 5 (arrivée au tour 25) : seul le délai de déverrouillage borne Action !.
  for (const [unlock, delay] of [[28, 1], [29, 0]] as const) {
    it(`tout corrompu tôt : Action ! au tour ${unlock} du Vortex (unlockVortexTurn = ${unlock}, actionDelay = ${delay})`, () => {
      const s = setup({ params: { unlockVortexTurn: unlock, actionDelay: delay }, seed: 5 })
      corruptAll(s, unlock + 2)
      const vx = vortexState(s.fight)!
      expect(vx.actionRound).toBe(unlock)
      const vortex = vortexOf(s)
      // Données d'Action ! : monstres tués, Vortexiphan retiré (16 PA / 5 PM), personnages ramenés à leur case.
      expect(s.fight.fighters.filter(isWaveMonster).every(m => !m.alive)).toBe(true)
      expect(vortex.buffs.some(b => b.spellId === 5006)).toBe(false)
      expect(vortex.stats.ap).toBeGreaterThanOrEqual(16)
      expect(vortex.stats.mp).toBeGreaterThanOrEqual(5)
      expect(s.fight.ended).toBe(false)
    })
  }

  it('Marginal tant qu’un monstre n’est pas corrompu (5008) : pas d’Action ! au tour 26', () => {
    const s = setup({ seed: 6 })
    let kept = -1
    corruptAll(s, 28, m => {
      if (kept < 0 && m.wave === 5) kept = m.id
      return m.id === kept
    })
    const vx = vortexState(s.fight)!
    expect(vx.actionRound).toBe(0)
    expect(vortexOf(s).states).toContain(236)
  })

  it('dernière corruption après le déverrouillage : Action ! actionDelay tour(s) du Vortex plus tard', () => {
    for (const delay of [1, 0]) {
      const s = setup({ params: { actionDelay: delay }, seed: 8 })
      let kept = -1
      corruptAll(s, 28, m => {
        if (kept < 0 && m.wave === 5) kept = m.id
        return m.id === kept
      })
      // Tour 28 : on corrompt le dernier ; il est corrompu au début du tour 28 du Vortex (résurrection).
      markForCorruption(s, s.fight.fighters[kept])
      toRound(s, 31)
      expect(vortexState(s.fight)!.actionRound).toBe(28 + delay)
    }
  })

  it('défaut : Action ! au tour 27 du Vortex, borné par la vague 5 (arrivée au tour 25, invulnérable, corrompue au tour 26 du Vortex)', () => {
    const s = setup({ seed: 5 })
    corruptAll(s, 28)
    expect(vortexState(s.fight)!.actionRound).toBe(27)
  })

  it('après Action ! : le Vortex passe son tour, puis devient vulnérable et joue', () => {
    const s = setup({ seed: 5 })
    corruptAll(s, 27)
    toRound(s, 28)
    const vortex = vortexOf(s)
    expect(vortexState(s.fight)!.actionRound).toBe(27)
    // Tour 28 avant son créneau : encore invulnérable (56, 1 tour) ; à son créneau du tour 28, il joue.
    expect(vortex.states).toContain(56)
    turnOf(s, vortex, 28)
    expect(vortex.states).not.toContain(56)
    expect(vortex.states).not.toContain(236)
  })
})

describe('fin de combat et résumé', () => {
  it('victoire à la mort du Vortex', () => {
    const s = setup()
    turnOf(s, s.players[0], 1)
    s.engine.kill(s.fight, vortexOf(s), s.players[0])
    expect(s.fight.ended).toBe(true)
    expect(s.fight.winner).toBe(0)
    expect(s.fight.endReason).toMatch(/Vortex/)
    const sum = summarizeVortex(s.fight)
    expect(sum.win).toBe(true)
    expect(sum.progress).toBe(1)
  })

  it('défaite quand tous les personnages sont morts ; résumé et progression', () => {
    const s = setup()
    turnOf(s, s.players[0], 2)
    const ika = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    markForCorruption(s, ika)
    turnOf(s, s.players[0], 3)
    for (const p of s.players) s.engine.kill(s.fight, p, vortexOf(s))
    expect(s.fight.ended).toBe(true)
    expect(s.fight.winner).toBe(1)
    const sum = summarizeVortex(s.fight)
    expect(sum.win).toBe(false)
    expect(sum.failReason).toBe('défaite')
    expect(sum.corruptedByRound.length).toBe(3)
    expect(sum.corruptedByRound[2]).toBe(1)
    // 1 corrompu sur 19 monstres de vague : 0,45/19 ; aucun vivant ; Vortex intact.
    expect(sum.progress).toBeCloseTo(0.45 / 19, 6)
    expect(sum.hoursUsed).toBe(1)
    expect(sum.extra?.totalMonsters).toBe(19)
  })
})

describe('délais de relance initiaux (initialCooldown, ignoré par le moteur)', () => {
  it('En temps et en heure (1) : pas au 1er tour du Vortex ; Heurage (3) : pas avant son 4e tour', () => {
    const s = setup({ seed: 2 })
    const vortex = vortexOf(s)
    const aur = s.fight.fighters.find(f => f.monsterId === AURORAIRE)!
    const spell = (id: number) => vortex.spells.find(x => x.spellId === id)!
    const seen: Record<number, (string | null)[]> = { 5062: [], 5066: [] }
    for (let turn = 1; turn <= 5; turn++) {
      turnOf(s, vortex, turn)
      seen[5062].push(canCast(s.engine, s.fight, vortex, spell(5062), aur.cell))
      seen[5066].push(canCast(s.engine, s.fight, vortex, spell(5066), vortex.cell))
      s.engine.endTurn(s.fight, vortex)
    }
    expect(seen[5062]).toEqual(['cooldown', null, null, null, null])
    expect(seen[5066]).toEqual(['cooldown', 'cooldown', 'cooldown', null, null])
  })

  it('arrivants : délais posés à l’arrivée (Ikargn de la vague 4 : Attraction ailée 5015, délai 1)', () => {
    const s = setup({ seed: 2 })
    // Vague 1 (début de combat) : l'Ikargn ne peut pas lancer Attraction ailée à son 1er tour.
    const ika1 = s.fight.fighters.find(f => f.monsterId === IKARGN)!
    expect(ika1.cooldowns[5015]).toBe(2)
    toRound(s, 19)
    const ika4 = s.fight.fighters.find(f => isWaveMonster(f) && f.wave === 4 && f.monsterId === IKARGN)!
    expect(ika4.cooldowns[5015]).toBe(2)
    turnOf(s, ika4, 19)
    expect(canCast(s.engine, s.fight, ika4, ika4.spells.find(x => x.spellId === 5015)!, s.players[0].cell)).toBe('cooldown')
  })
})

describe('En temps et en heure (5062 → 5061 lancé par l’Auroraire)', () => {
  it('frappe la croix de l’heure courante (500 Terre de base + 50 % de l’érosion), pas les cases hors ligne ; défaite classée « croix »', () => {
    const s = setup({ seed: 4 })
    const vortex = vortexOf(s)
    turnOf(s, vortex, 2)
    const aur = s.fight.fighters.find(f => f.monsterId === AURORAIRE)!
    const h = currentHour(s.fight)
    const line = Array.from(lineCells(h)).filter(c => s.engine.isCellFree(s.fight, c))
    const [p1, p2, p3, p4] = s.players
    p1.cell = line[0]
    p2.cell = line[line.length - 1]
    for (const p of [p3, p4]) expect(onHourLine(h, p.cell)).toBe(false)
    const hp0 = s.players.map(p => p.hp)
    expect(castSpell(s.engine, s.fight, vortex, 5062, aur.cell).ok).toBe(true)
    const lost = s.players.map((p, i) => hp0[i] - p.hp)
    // 500 Terre (20 % de résistance Terre des personnages de fumée) = 400, puis Terre = 50 % des PV érodés (+20 %).
    expect(lost[0]).toBeGreaterThanOrEqual(400)
    expect(lost[1]).toBe(lost[0])
    expect(lost[2]).toBe(0)
    expect(lost[3]).toBe(0)
    expect(p1.buffs.some(b => b.spellId === 5061)).toBe(true)
    // Le tour suivant du Vortex : les quatre personnages sur la croix, à 1 PV ⇒ tués par l'Auroraire.
    s.engine.endTurn(s.fight, vortex)
    turnOf(s, vortex, 3)
    const h3 = currentHour(s.fight)
    // XII (k = 4) : case de l'heure NON marchable (212) — l'Auroraire y est posée par le scénario et reste ciblable.
    expect(h3).toBe(12)
    expect(aur.cell).toBe(HOUR_CELL[12])
    expect(s.fight.map.cells[aur.cell].walkable).toBe(false)
    const free = Array.from(lineCells(h3)).filter(c => s.engine.isCellFree(s.fight, c))
    s.players.forEach((p, i) => {
      p.cell = free[i]
      p.hp = 1
    })
    expect(castSpell(s.engine, s.fight, vortex, 5062, aur.cell).ok).toBe(true)
    expect(s.fight.ended).toBe(true)
    expect(s.fight.winner).toBe(1)
    const sum = summarizeVortex(s.fight)
    expect(sum.failReason).toBe('mort sur la croix de l’Auroraire')
    expect(sum.extra?.playerDeathsByAuroraire).toBe(4)
    expect(playerDeathsBy(s.fight, AURORAIRE)).toBe(4)
  })
})

describe('déterminisme', () => {
  it('même graine ⇒ même combat (record vrai ou faux)', () => {
    const run = (record: boolean) => {
      const s = setup({ seed: 42, record })
      corruptAll(s, 9)
      return fightDigest(s.fight)
    }
    expect(run(false)).toBe(run(false))
    expect(run(true)).toBe(run(false))
  })

  it('cloneFight copie l’état du scénario (E2) : le clone évolue sans toucher l’original', () => {
    const s = setup({ seed: 2 })
    turnOf(s, s.players[0], 2)
    const before = JSON.stringify(vortexState(s.fight))
    const c = s.engine.cloneFight(s.fight)
    for (let i = 0; i < 40; i++) {
      const cur = s.engine.current(c)
      if (cur && cur.alive) s.engine.endTurn(c, cur)
      s.engine.nextTurn(c)
    }
    expect(vortexState(c)!.vortexTurns).toBeGreaterThan(vortexState(s.fight)!.vortexTurns)
    expect(JSON.stringify(vortexState(s.fight))).toBe(before)
  })
})

describe('paramètres et variantes INCERTAINES', () => {
  it('défauts, validation et invariant des vagues', () => {
    expect(resolveVortexParams({})).toEqual({ ...VORTEX_DEFAULT_PARAMS, arrivalRounds: [...VORTEX_DEFAULT_PARAMS.arrivalRounds], rezHpPct: [...VORTEX_DEFAULT_PARAMS.rezHpPct] })
    expect(validateVortexParams(resolveVortexParams({}))).toEqual([])
    expect(() => resolveVortexParams({ arrivalRounds: [1, 7, 12, 17, 26] })).toThrow(/invariant/)
    expect(() => resolveVortexParams({ vortexCell: 424 })).toThrow(/vortexCell/)
    expect(() => resolveVortexParams({ monsterGrade: 9 })).toThrow(/monsterGrade/)
  })

  it('tirage des variantes : déterministe, fréquences proches des poids, clé lisible', () => {
    expect(sampleVortexVariant(123)).toEqual(sampleVortexVariant(123))
    const counts = new Map<string, number>()
    let defaults = 0
    const N = 4000
    for (let i = 0; i < N; i++) {
      const v = sampleVortexVariant(i)
      if (v.key === DEFAULT_VARIANT) defaults++
      for (const k of Object.keys(v.params)) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    for (const u of VORTEX_UNCERTAIN) {
      const expected = 1 - u.weights[0] / u.weights.reduce((a, b) => a + b, 0)
      expect(Math.abs((counts.get(u.key) ?? 0) / N - expected)).toBeLessThan(0.03)
    }
    expect(defaults).toBeGreaterThan(0)
    expect(variantKey({ startingTeamRule: 'best', actionDelay: 0 })).toBe('startingTeamRule=best|actionDelay=0')
    expect(sampleVariant(vortexScenario, 7)).toEqual(sampleVortexVariant(7))
  })

  it('la variante est rangée dans l’état du combat', () => {
    const s = setup({ params: { startingTeamRule: 'best' } })
    expect(vortexState(s.fight)!.variant).toBe('startingTeamRule=best')
  })

  it('glyphTrigger = turnEnd : glyphes des monstres converties', () => {
    const s = setup({ params: { glyphTrigger: 'turnEnd' } })
    toRound(s, 2)
    const g = s.fight.glyphs.filter(x => x.castSpellId === 5011)
    expect(g.length).toBeGreaterThan(0)
    expect(g.every(x => x.trigger === 'turnEnd')).toBe(true)
  })
})

describe('placement analytique (§12.10, bases)', () => {
  it('énumère 11 880 affectations, évite les croix IV/VIII/XII (k = 4) et la case 484', () => {
    const team = createSmokeTeam(data)
    const ranked = rankVortexPlacements(team, VORTEX_DEFAULT_PARAMS, { top: 8 })
    expect(ranked).toHaveLength(8)
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
    const best = ranked[0].cells
    expect(new Set(best).size).toBe(4)
    for (const c of best) {
      expect(RED_START_CELLS).toContain(c)
      expect([427, 440, 430, 484]).not.toContain(c)
    }
    expect(ranked[0].terms.clockLine).toBe(0)
  })

  it('k = 3 : évite les croix III/VII/XI', () => {
    const slow = createSmokeTeam(data, SMOKE_BREEDS, { initiative: 1000 })
    const best = rankVortexPlacements(slow, VORTEX_DEFAULT_PARAMS, { top: 1 })[0]
    expect(best.terms.clockLine).toBe(0)
    for (const c of best.cells) expect([430, 440, 443, 455, 457, 484]).not.toContain(c)
  })
})

