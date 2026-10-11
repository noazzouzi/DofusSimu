// Comportement des monstres de la Reine des Voleurs pour la simulation d'un round.
//
// Reine (contrôleur propre, d'après les journaux du 2026-10-09 et du 2026-10-10 : 9 tours, aucun Crâ à sa portée) :
//  1. Brume dès qu'elle est disponible (relance initiale 3 : manche 4, puis tous les 3 tours) — 1 lancer observé ;
//  2. Mort en Sursis sur un Crâ si elle peut l'atteindre (case accessible avec ses PM, en ligne à 1-5, ligne de vue) :
//     sa vraie menace (marque de mort en 6 tours, échange de place) — jamais observé, supposé ;
//  3. sinon Mort en Sursis sur un allié (glissade puis échange : elle prend la case de l'allié), depuis la case qui
//     coûte le moins de PM — 2 lancers par tour aux manches 1, 2 et 6, 1 à la manche 3 ;
//  4. Coup critique sur un Crâ au contact s'il y en a un ;
//  5. avance de ses PM restants comme les monstres de vague (distance de chemin, axe le plus long d'abord) : elle va au
//     plus près (jusqu'à 4 cases de Java à la manche 4).
// Monstres de vague (d'après le combat réel du 2026-10-10, 36 tours mesurés par fidelite.ts) : tant qu'ils ne peuvent
// pas attaquer, ils avancent de tous leurs PM vers le Crâ le plus proche EN DISTANCE DE CHEMIN (cases praticables, les
// piliers contournés), à égalité en réduisant d'abord le plus grand écart de coordonnées (ils descendent la colonne en
// ligne droite) ; le Terristocrate se téléporte d'abord par Fumérus (case en ligne à 1-4 qui le rapproche le plus), la
// Magouille lance Avertissement sur elle-même (riposte), la Doublure échange sa place avec sa copie (Subtilité) et la
// copie avance. Quand une attaque est possible : cerveau générique du moteur (src/ai/monster). Relances initiales
// (Doublage, Brume : 3 tours) posées par l'instantané (etat.ts). Écarts : fidelite.ts, ia-monstres.ts.
import { defaultAIConfig } from '../../../src/ai/index'
import { createMonsterBrain } from '../../../src/ai/monster/brain'
import { canCast, castSpell } from '../../../src/engine/cast'
import type { Engine } from '../../../src/engine/engine'
import { move, pathTo, reachableCells } from '../../../src/engine/move'
import type { Controller } from '../../../src/engine/runner'
import type { Fighter, FightState } from '../../../src/engine/types'
import { CELL_X, CELL_Y, distance, neighborsOf } from '../../../src/map/geometry'
import { BOMB, QUEEN } from './etat'
import { DEATH_ROW } from './menaces'

const COUP_CRITIQUE = 4698
const BRUME = 4697

/** a < b dans l'ordre lexicographique. */
const lexLess = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}
const enemiesOf = (fight: FightState, me: Fighter) => fight.fighters.filter(f => f.alive && f.team !== me.team && f.monsterId !== BOMB)

function goTo(engine: Engine, fight: FightState, me: Fighter, cell: number): void {
  if (cell === me.cell) return
  const reach = reachableCells(fight, me, engine, me.mp)
  const path = pathTo(reach, me.cell, cell)
  if (path) move(fight, me, path, engine)
}

/**
 * Un lancer de Mort en Sursis : sur un Crâ s'il est atteignable, sinon sur un allié (elle prend sa case par
 * l'échange) ; à chaque fois depuis la case accessible qui coûte le moins de PM, puis la cible la plus proche. Observé :
 * 2 lancers sur des alliés aux manches 1, 2 et 6, même quand l'échange l'éloigne d'abord (manche 1).
 */
function deathRowStep(engine: Engine, fight: FightState, me: Fighter): boolean {
  const ms = me.spells.find(s => s.spellId === DEATH_ROW)
  if (!ms) return false
  const reach = reachableCells(fight, me, engine, me.mp)
  let best: { cell: number; target: Fighter; key: number[] } | null = null
  for (const t of fight.fighters) {
    if (!t.alive || t.id === me.id || t.monsterId === BOMB) continue
    const enemy = t.team !== me.team
    for (const [cell, cost] of reach.cost) {
      if (distance(cell, t.cell) > 5) continue
      if (canCast(engine, fight, me, ms, t.cell, { fromCell: cell }) !== null) continue
      const key = [enemy ? 0 : 1, cost, distance(me.cell, t.cell), t.id]
      if (!best || lexLess(key, best.key)) best = { cell, target: t, key }
    }
  }
  if (!best) return false
  goTo(engine, fight, me, best.cell)
  if (me.cell !== best.cell) return false
  return castSpell(engine, fight, me, DEATH_ROW, best.target.cell).ok
}

export const reineController: Controller = {
  playTurn(engine: Engine, fight: FightState, me: Fighter): void {
    if ((me.cooldowns[BRUME] ?? 0) <= 0 && me.spells.some(s => s.spellId === BRUME)) castSpell(engine, fight, me, BRUME, me.cell)
    for (let k = 0; k < 2 && me.alive && !fight.ended; k++) if (!deathRowStep(engine, fight, me)) break
    // Coup critique sur un Crâ au contact (depuis une case accessible).
    const cc = me.spells.find(s => s.spellId === COUP_CRITIQUE)
    if (cc) {
      for (let k = 0; k < 2 && me.alive && !fight.ended; k++) {
        const reach = reachableCells(fight, me, engine, me.mp)
        let done = false
        for (const e of enemiesOf(fight, me)) {
          for (const [cell] of reach.cost) {
            if (distance(cell, e.cell) !== 1 || canCast(engine, fight, me, cc, e.cell, { fromCell: cell }) !== null) continue
            goTo(engine, fight, me, cell)
            if (me.cell === cell && castSpell(engine, fight, me, COUP_CRITIQUE, e.cell).ok) done = true
            break
          }
          if (done) break
        }
        if (!done) break
      }
    }
    if (me.alive && me.mp > 0 && !fight.ended) approach(engine, fight, me)
  },
}

const DOUBLURE = 3748
const SUBTILITE = 4862

/** Un sort offensif du monstre peut-il toucher un ennemi depuis une case accessible ce tour-ci ? */
function canAttackThisTurn(engine: Engine, fight: FightState, me: Fighter): boolean {
  const reach = reachableCells(fight, me, engine, me.mp)
  for (const sp of me.spells) {
    if (sp.spellId === SUBTILITE || (me.cooldowns[sp.spellId] ?? 0) > 0) continue
    if (!sp.level.effects.some(e => (e.effectId >= 91 && e.effectId <= 100) || e.effectId === 1014 || e.effectId === 181)) continue
    for (const e of enemiesOf(fight, me)) {
      for (const [cell] of reach.cost) {
        if (distance(cell, e.cell) > sp.level.range + 3) continue
        if (canCast(engine, fight, me, sp, e.cell, { fromCell: cell }) === null) return true
      }
    }
  }
  return false
}

/** Distances de chemin (cases praticables, combattants ignorés) depuis une case : celles de l'IA du jeu. */
function pathDistances(fight: FightState, from: number): Map<number, number> {
  const d = new Map([[from, 0]])
  const q = [from]
  for (let k = 0; k < q.length; k++) {
    const c = q[k]
    for (const n of neighborsOf(c)) {
      if (d.has(n) || !fight.map.cells[n]?.walkable) continue
      d.set(n, d.get(c)! + 1)
      q.push(n)
    }
  }
  return d
}

/**
 * Clé d'une case pour un monstre qui s'approche : distance de chemin au Crâ le plus proche, puis plus grand écart de
 * coordonnées avec lui (avancer d'abord sur l'axe le plus long), puis PM dépensés.
 */
function approachKeyFn(fight: FightState, me: Fighter): (cell: number, cost: number) => number[] {
  const targets = enemiesOf(fight, me).map(e => ({ e, d: pathDistances(fight, e.cell) }))
  return (cell, cost) => {
    let best = [99, 99]
    for (const t of targets) {
      const k = [t.d.get(cell) ?? 99, Math.max(Math.abs(CELL_X[cell] - CELL_X[t.e.cell]), Math.abs(CELL_Y[cell] - CELL_Y[t.e.cell]))]
      if (lexLess(k, best)) best = k
    }
    return [...best, cost]
  }
}

/** Meilleure case d'arrivée en s'approchant (et sa clé), depuis la case actuelle avec les PM restants. */
function bestApproach(engine: Engine, fight: FightState, me: Fighter): { cell: number; key: number[] } {
  const keyOf = approachKeyFn(fight, me)
  let best = me.cell
  let bestKey = keyOf(me.cell, 0)
  if (me.mp <= 0) return { cell: best, key: bestKey }
  const reach = reachableCells(fight, me, engine, me.mp)
  for (const [cell, cost] of reach.cost) {
    const key = keyOf(cell, cost)
    if (lexLess(key, bestKey)) {
      best = cell
      bestKey = key
    }
  }
  return { cell: best, key: bestKey }
}

/** Avance de tous ses PM vers le Crâ le plus proche (fins de tour observées des monstres de vague). */
function approach(engine: Engine, fight: FightState, me: Fighter): void {
  goTo(engine, fight, me, bestApproach(engine, fight, me).cell)
}

const TERRISTOCRATE = 3747
const FUMERUS = 4774
const MAGOUILLE = 3750
const AVERTISSEMENT = 4784

/** Terristocrate : Fumérus (téléportation en ligne à 1-4) sur la case d'où il s'approchera le plus, s'il y gagne. */
function fumerus(engine: Engine, fight: FightState, me: Fighter): void {
  const sp = me.spells.find(s => s.spellId === FUMERUS)
  if (!sp || (me.cooldowns[FUMERUS] ?? 0) > 0) return
  const stay = bestApproach(engine, fight, me).key
  let best: { cell: number; key: number[] } | null = null
  for (let c = 0; c < fight.map.cells.length; c++) {
    const d = distance(me.cell, c)
    if (d < 1 || d > 4 || canCast(engine, fight, me, sp, c) !== null) continue
    const from = me.cell
    me.cell = c
    const k = bestApproach(engine, fight, me).key
    me.cell = from
    if (!best || lexLess(k, best.key)) best = { cell: c, key: k }
  }
  if (best && lexLess(best.key, stay)) castSpell(engine, fight, me, FUMERUS, best.cell)
}

/**
 * Monstres de vague (d'après le journal : ils avancent de tous leurs PM vers le Crâ le plus proche tant qu'ils ne peuvent
 * pas attaquer ; la Doublure échange d'abord sa place avec sa jumelle par Subtilité). Quand une attaque est possible, le
 * tour est confié au cerveau générique du moteur (choix de la cible et du sort).
 */
function waveController(brain: Controller): Controller {
  return {
    playTurn(engine: Engine, fight: FightState, me: Fighter): void {
      if (me.monsterId === DOUBLURE) {
        // L'original (invocateur de sa copie) échange sa place avec elle ; la copie avance.
        const twin = fight.fighters.find(f => f.alive && f.monsterId === DOUBLURE && f.summonerId === me.id)
        const sub = me.spells.find(s => s.spellId === SUBTILITE)
        if (twin && sub && canCast(engine, fight, me, sub, twin.cell) === null) castSpell(engine, fight, me, SUBTILITE, twin.cell)
      }
      if (me.monsterId === MAGOUILLE && (me.cooldowns[AVERTISSEMENT] ?? 0) <= 0) castSpell(engine, fight, me, AVERTISSEMENT, me.cell)
      if (me.monsterId === TERRISTOCRATE) fumerus(engine, fight, me)
      if (fight.ended || !me.alive) return
      if (canAttackThisTurn(engine, fight, me)) brain.playTurn(engine, fight, me)
      else approach(engine, fight, me)
    },
  }
}

/** Contrôleurs des monstres de ce combat : la Reine (règles observées), les monstres de vague (règles + cerveau). */
export function monsterControllers(seed = 1): (f: Fighter) => Controller {
  const brain = createMonsterBrain(defaultAIConfig('fast', seed), 'play')
  const wave = waveController(brain)
  return f => (f.monsterId === QUEEN ? reineController : wave)
}
