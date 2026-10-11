// Recherche du meilleur tour d'un Crâ : se placer sur une case de tir, lancer une suite de sorts (jouée par le vrai
// moteur, jet moyen), puis se replier avec les PM restants sur une case où :
//  - aucun monstre ne peut le toucher à son prochain tour (menaces.ts, pire cas, échanges de la Reine compris) ;
//  - aucune bombe rouge ne le tue d'ici son prochain tour, et aucun Crâ ne meurt à la fin de ce tour (bombes.ts).
// Les tours sûrs sont classés par dégâts pondérés ; les meilleurs tours non sûrs sont donnés à titre de comparaison.
import { canCast, castSpell } from '../../../src/engine/cast'
import { move, pathTo, reachableCells } from '../../../src/engine/move'
import { createSpellProfileIndex } from '../../../src/ai/core/spellProfile'
import type { Fighter, FightState, KnownSpell } from '../../../src/engine/types'
import { distance, neighborsOf } from '../../../src/map/geometry'
import { simulateHorizon, type BombWorld } from './bombes'
import { BOMB, buildFight, type BuiltFight, type Snapshot } from './etat'
import { applyCastRules, applyStateRules, shareTwinDamage, twinHp } from './regles'
import { threatsOn, type Threat } from './menaces'

export type PlanStep = { kind: 'move'; path: number[] } | { kind: 'cast'; spell: number; cell: number }

export interface PlannedTurn {
  steps: PlanStep[]
  shootCell: number
  endCell: number
  /** Dégâts par cible (identifiant de jeu), et cibles tuées. */
  damage: Map<number, number>
  killed: number[]
  total: number
  score: number
  apUsed: number
  mpUsed: number
  threats: Threat[]
  /** Morts par bombe qui rendent le tour non sûr : un Crâ à la fin de ce tour, ou le Crâ actif d'ici son prochain tour. */
  bombDeaths: { id: number; round: number; turnOf: number; atActiveEnd: boolean }[]
  /** Autres Crâs tués plus tard par une bombe si personne ne bouge (évitable par eux, mais à surveiller). */
  laterDeaths: { id: number; round: number; turnOf: number; atActiveEnd: boolean }[]
  safe: boolean
}

export interface PlanOptions {
  /** Largeur du faisceau sur les lancers offensifs. */
  beam?: number
  /** Nombre maximal de lancers offensifs. */
  maxCasts?: number
  /** Poids des dégâts par identifiant de jeu de la cible (défaut 1). */
  weights?: Record<number, number>
  /** Bonus de score quand une cible meurt, en part de ses PV max. */
  killBonus?: number
  /** Nombre de tours rendus. */
  top?: number
}

interface Node {
  fight: FightState
  steps: PlanStep[]
  score: number
  damage: Map<number, number>
  killed: number[]
  sig: string
}

export function planTurn(snap: Snapshot, opts: PlanOptions = {}): { plans: PlannedTurn[]; unsafe: PlannedTurn[]; built: BuiltFight; evaluated: number } {
  const beamWidth = opts.beam ?? 8
  const maxCasts = opts.maxCasts ?? 5
  const killBonus = opts.killBonus ?? 0.5
  const b = buildFight(snap)
  const { engine } = b
  // Règles du combat (regles.ts) : réduction de la Reine par bombe vivante.
  applyStateRules(engine, b.fight)
  const found = b.byGameId.get(snap.active)
  if (!found) throw new Error(`Crâ actif ${snap.active} absent de l'instantané`)
  const me: Fighter = found
  const profiles = createSpellProfileIndex(engine)
  const isBombF = (f: Fighter) => f.monsterId === BOMB
  const enemies = (s: FightState) => s.fighters.filter(f => f.alive && f.team !== me.team)
  const weight = (f: Fighter) => opts.weights?.[b.gameIdOf.get(f.id)!] ?? 1

  // Sorts « buffs » (aucun dégât sur ennemi, lançables sur soi) : essayés en tête de tour, par sous-ensembles.
  const buffs = me.spells.filter(sp => !profiles.of(sp.level).damage.some(l => l.sides.enemy) && sp.level.range === 0)
  const attacks = me.spells.filter(sp => !buffs.includes(sp))
  // Sorts qui déplacent leur cible (Flèche de Recul, Dispersion…) : servent aussi à éloigner les bombes.
  const movers = me.spells.filter(sp => profiles.of(sp.level).moves.some(l => !l.onCaster))
  const bombSig = (s: FightState) => s.fighters.filter(f => f.alive && isBombF(f)).map(f => f.cell).join(',')
  const deathCache = new Map<string, number>()
  /** Alliés (hors Crâ actif) tués par les explosions de la fin de ce tour, le Crâ actif restant où il est. */
  function allyDeathsAtEnd(s: FightState): number {
    const key = `${s.fighters[me.id].cell}|${bombSig(s)}`
    let n = deathCache.get(key)
    if (n === undefined) {
      const h = simulateHorizon({ ...bombWorld(b, s, snap), order: [snap.active] }, snap.active, snap.round)
      n = h.deaths.filter(d => d.atActiveEnd && d.id !== snap.active).length
      deathCache.set(key, n)
    }
    return n
  }

  const baseHp = new Map(b.fight.fighters.map(f => [f.id, f.hp]))
  // Doublure et sa copie : chaque dommage est partagé à parts égales entre les deux (regles.ts) ; leurs pertes
  // s'additionnent donc pour la note (réserve commune de PV).
  function evaluate(s: FightState, steps: PlanStep[]): Node {
    const damage = new Map<number, number>()
    const killed: number[] = []
    let score = 0
    for (const f of s.fighters) {
      const before = baseHp.get(f.id) ?? f.maxHp
      const lost = Math.max(0, before - Math.max(0, f.hp))
      if (!lost || isBombF(f)) continue
      const gid = b.gameIdOf.get(f.id)!
      if (f.team !== me.team) {
        damage.set(gid, lost)
        score += weight(f) * Math.min(lost, before)
        if (!f.alive || f.hp <= 0) {
          killed.push(gid)
          score += killBonus * f.maxHp * weight(f)
        }
      } else score -= 3 * lost
    }
    const casts = steps.filter(x => x.kind === 'cast').map(x => (x as { spell: number; cell: number }).spell + '@' + (x as { cell: number }).cell).sort().join(',')
    const meNow = s.fighters[me.id]
    return { fight: s, steps, score, damage, killed, sig: `${meNow.cell}|${meNow.ap}|${casts}` }
  }

  function targetsFor(s: FightState, sp: KnownSpell, from: number): number[] {
    const p = profiles.of(sp.level)
    const cells = new Set<number>()
    for (const e of enemies(s)) {
      cells.add(e.cell)
      if (p.zoneRadius > 0 || p.needFreeCell) for (const n of neighborsOf(e.cell)) cells.add(n)
    }
    // Bombes : seulement pour les sorts qui déplacent (les éloigner peut rendre un repli sûr).
    if (p.moves.length) for (const f of s.fighters) if (f.alive && isBombF(f)) cells.add(f.cell)
    const max = sp.level.range + (sp.level.rangeBoostable ? Math.max(0, s.fighters[me.id].stats.range) : 0) + 12
    return [...cells].filter(c => c >= 0 && distance(from, c) <= max)
  }

  function cast(n: Node, sp: KnownSpell, cell: number): Node | null {
    const meN = n.fight.fighters[me.id]
    if (canCast(engine, n.fight, meN, sp, cell) !== null) return null
    const s = engine.cloneFight(n.fight)
    const twins = twinHp(s)
    const r = castSpell(engine, s, s.fighters[me.id], sp.spellId, cell)
    if (!r.ok || !s.fighters[me.id].alive) return null
    applyCastRules(engine, s, s.fighters[me.id], sp.spellId)
    shareTwinDamage(engine, s, twins)
    return evaluate(s, [...n.steps, { kind: 'cast', spell: sp.spellId, cell }])
  }

  const reach0 = reachableCells(b.fight, me, engine, me.mp)
  const candidates: Node[] = []
  let evaluated = 0
  for (const [shoot] of reach0.cost) {
    const s0 = engine.cloneFight(b.fight)
    const m0 = s0.fighters[me.id]
    const path = pathTo(reach0, me.cell, shoot)!
    if (path.length > 1) move(s0, m0, path, engine)
    if (m0.cell !== shoot) continue
    const root = evaluate(s0, path.length > 1 ? [{ kind: 'move', path }] : [])
    // racines : tous les sous-ensembles de buffs
    let roots: Node[] = [root]
    for (const bf of buffs) {
      const more: Node[] = []
      for (const r of roots) {
        const x = cast(r, bf, r.fight.fighters[me.id].cell)
        if (x) more.push(x)
      }
      roots = roots.concat(more)
    }
    // Déblayage : si l'explosion de fin de tour tue un allié, 1 ou 2 lancers qui déplacent des bombes et l'évitent.
    if (allyDeathsAtEnd(roots[0].fight) > 0) {
      let layer = roots
      for (let k = 0; k < 2; k++) {
        const fixes: Node[] = []
        for (const r of layer) {
          const from = r.fight.fighters[me.id].cell
          const before = allyDeathsAtEnd(r.fight)
          for (const sp of movers) {
            for (const f of r.fight.fighters) {
              if (!f.alive || !isBombF(f) || distance(from, f.cell) > 20) continue
              const x = cast(r, sp, f.cell)
              if (!x) continue
              x.sig += `|${bombSig(x.fight)}`
              if (allyDeathsAtEnd(x.fight) < before) fixes.push(x)
            }
          }
        }
        if (!fixes.length) break
        fixes.sort((x, y) => allyDeathsAtEnd(x.fight) - allyDeathsAtEnd(y.fight) || y.score - x.score)
        layer = fixes.slice(0, beamWidth)
        roots = roots.concat(layer)
        if (layer.some(x => allyDeathsAtEnd(x.fight) === 0)) break
      }
    }
    let beam = roots
    const seen = new Set(beam.map(x => x.sig))
    candidates.push(...beam)
    for (let depth = 0; depth < maxCasts; depth++) {
      const next: Node[] = []
      for (const n of beam) {
        const from = n.fight.fighters[me.id].cell
        for (const sp of attacks) {
          for (const cell of targetsFor(n.fight, sp, from)) {
            const x = cast(n, sp, cell)
            evaluated++
            if (!x || seen.has(x.sig) || x.score <= n.score - 1e-9) continue
            seen.add(x.sig)
            next.push(x)
          }
        }
      }
      if (!next.length) break
      next.sort((x, y) => y.score - x.score)
      beam = next.slice(0, beamWidth)
      candidates.push(...beam)
    }
  }

  // Repli : pour les meilleurs nœuds, toutes les cases accessibles avec les PM restants.
  candidates.sort((x, y) => y.score - x.score)
  // Présélection : d'abord les branches qui ne tuent aucun allié en fin de tour (souvent moins de dégâts : PA passés
  // à pousser des bombes), puis les plus fortes.
  const unique = dedupe(candidates)
  const clean = unique.filter(n => allyDeathsAtEnd(n.fight) === 0).slice(0, 45)
  const pool = [...clean, ...unique.filter(n => !clean.includes(n)).slice(0, 15)]
  const threatCache = new Map<string, Threat[]>()
  const plans: PlannedTurn[] = []
  for (const n of pool) {
    const meN = n.fight.fighters[me.id]
    const reach = reachableCells(n.fight, meN, engine, meN.mp)
    const shoot = meN.cell
    for (const [end] of reach.cost) {
      const s = engine.cloneFight(n.fight)
      const m = s.fighters[me.id]
      const path = pathTo(reach, shoot, end)!
      if (path.length > 1) move(s, m, path, engine)
      if (m.cell !== end) continue
      const posSig = s.fighters.filter(f => f.alive && f.id !== me.id).map(f => `${f.id}:${f.cell}`).join(',')
      const key = `${end}|${posSig}`
      let threats = threatCache.get(key)
      if (!threats) threatCache.set(key, (threats = threatsOn(engine, s, m, end)))
      const horizon = simulateHorizon(bombWorld(b, s, snap), snap.active, snap.round)
      const steps = path.length > 1 ? [...n.steps, { kind: 'move' as const, path }] : n.steps
      const bombDeaths = horizon.deaths.filter(d => d.atActiveEnd || d.id === snap.active)
      // (une mort pendant le tour même de la victime est évitable par elle : pas signalée)
      const laterDeaths = horizon.deaths.filter(d => !d.atActiveEnd && d.id !== snap.active && d.turnOf !== d.id)
      plans.push({
        steps,
        shootCell: shoot,
        endCell: end,
        damage: n.damage,
        killed: n.killed,
        total: [...n.damage.values()].reduce((a, x) => a + x, 0),
        score: n.score,
        apUsed: me.ap - m.ap,
        mpUsed: me.mp - m.mp,
        threats,
        bombDeaths,
        laterDeaths,
        safe: threats.length === 0 && bombDeaths.length === 0,
      })
    }
  }
  const byScore = (x: PlannedTurn, y: PlannedTurn) => y.score - x.score || x.mpUsed - y.mpUsed
  const top = opts.top ?? 5
  // Tours sûrs : d'abord ceux qui n'exposent aucun autre Crâ à une explosion plus tardive, puis par score.
  const safe = plans.filter(p => p.safe).sort((x, y) => x.laterDeaths.length - y.laterDeaths.length || byScore(x, y))
  const unsafe = plans.filter(p => !p.safe).sort((x, y) => x.bombDeaths.length - y.bombDeaths.length || x.threats.length - y.threats.length || byScore(x, y))
  return { plans: distinctPlans(safe).slice(0, top), unsafe: distinctPlans(unsafe).slice(0, top), built: b, evaluated }
}

function dedupe(nodes: Node[]): Node[] {
  const seen = new Set<string>()
  return nodes.filter(n => (seen.has(n.sig) ? false : (seen.add(n.sig), true)))
}

/** Un seul tour par (suite de sorts) : garde la meilleure case de repli pour chaque suite. */
function distinctPlans(plans: PlannedTurn[]): PlannedTurn[] {
  const seen = new Set<string>()
  const out: PlannedTurn[] = []
  for (const p of plans) {
    const k = p.steps.filter(s => s.kind === 'cast').map(s => (s as { spell: number; cell: number }).spell + '@' + (s as { cell: number }).cell).join(',') + '|' + p.shootCell
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

/** Monde des bombes à partir d'un état du moteur (positions après le tour) et des métadonnées de l'instantané. */
export function bombWorld(b: BuiltFight, s: FightState, snap: Snapshot): BombWorld {
  const meta = new Map(snap.entities.map(e => [e.gameId, e]))
  const world: BombWorld = { walk: c => !!s.map.cells[c]?.walkable, players: [], bombs: [], monsters: new Set(), order: snap.order }
  for (const f of s.fighters) {
    if (!f.alive) continue
    const gid = b.gameIdOf.get(f.id)!
    const e = meta.get(gid)
    if (e?.kind === 'bomb') world.bombs.push({ id: gid, owner: e.owner!, cell: f.cell, born: e.born!, blue: !!e.blue, alive: true })
    else if (e?.kind === 'cra') world.players.push({ id: gid, cell: f.cell, alive: true })
    else world.monsters.add(f.cell)
  }
  return world
}
