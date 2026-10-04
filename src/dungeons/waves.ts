/**
 * Outils génériques des scénarios (docs/design/ai.md §12.1, mechanics.md §8 et §17) — WP3.
 *
 *  - Équipe qui commence et reconstruction de la timeline (`startingTeam`, `rebuildTimeline`) : règle « meilleur
 *    combattant » (moteur, Stump 2.62) ou « moyenne d'équipe » (Stump 2.71, défaut proposé par mechanics.md §8) —
 *    INCERTAIN, paramètre du scénario.
 *  - Arrivée de combattants en cours de combat (`spawnWave`, `insertNewcomers`) : position dans la timeline INCERTAINE ;
 *    retenu (mechanics.md §17) : insertion dans l'équipe des arrivants par initiative décroissante, l'ordre des
 *    combattants déjà présents restant figé (un arrivant passe juste avant le premier coéquipier d'initiative
 *    strictement inférieure, sinon après le dernier coéquipier et ses invocations).
 *  - Invulnérabilité d'arrivée (`addArrivalInvulnerability`, `expireArrivalInvulnerability`) : état Invulnérable (56)
 *    posé par un buff du scénario et retiré au début du tour de jeu `untilRound` (« invulnérable 1 tour » = pendant le
 *    tour de jeu de l'arrivée). Passer par l'état (et non par `canBeDamaged`) garde les règles des données qui le lisent
 *    (pas de glyphe sous un monstre invulnérable, poussée des alliés invulnérables par 5012, IA).
 *  - Choix de cases libres (`pickFreeCells`) : cases candidates dans l'ordre, puis cases marchables libres les plus
 *    proches (parcours en largeur depuis les candidates) si elles sont toutes prises.
 *
 * Aucune dépendance au Vortex : utilisé aussi par les scénarios génériques (src/dungeons/generic/*).
 */
import type { TeamId } from '../core/types'
import { castStartingSpell } from '../engine/effects/summons'
import { initiativeOf, snapshot, type Engine } from '../engine/engine'
import { createMonsterFighter } from '../engine/factory'
import type { EffectData } from '../data/model'
import type { Fighter, FightState } from '../engine/types'
import { CELL_COUNT, neighborsOf } from '../map/geometry'

export type StartingTeamRule = 'average' | 'best'

/** Racine d'un combattant : lui-même, ou son invocateur (récursivement) pour une invocation. */
export function rootOf(fight: FightState, f: Fighter): Fighter {
  let cur = f
  for (let guard = 0; cur.summonerId !== undefined && guard < 16; guard++) {
    const s = fight.fighters[cur.summonerId]
    if (!s) break
    cur = s
  }
  return cur
}

/** Initiative moyenne des racines vivantes d'une équipe (−1 si aucune). */
export function averageInitiative(fight: FightState, team: TeamId): number {
  let sum = 0
  let n = 0
  for (const f of fight.fighters) {
    if (!f.alive || f.team !== team || f.summonerId !== undefined) continue
    sum += initiativeOf(f)
    n++
  }
  return n ? sum / n : -1
}

/** Meilleure initiative des racines vivantes d'une équipe (−1 si aucune). */
export function bestInitiative(fight: FightState, team: TeamId): number {
  let best = -1
  for (const f of fight.fighters) if (f.alive && f.team === team && f.summonerId === undefined) best = Math.max(best, initiativeOf(f))
  return best
}

/**
 * Équipe qui commence (mechanics.md §8, INCERTAIN) : 'best' = meilleur combattant (règle actuelle du moteur,
 * `Engine.buildTimeline`, égalité au profit de l'équipe 0) ; 'average' = moyenne d'initiative de chaque équipe
 * (égalité au profit des challengers, l'équipe 0).
 */
export function startingTeam(fight: FightState, rule: StartingTeamRule): TeamId {
  const a = rule === 'average' ? averageInitiative(fight, 0) : bestInitiative(fight, 0)
  const b = rule === 'average' ? averageInitiative(fight, 1) : bestInitiative(fight, 1)
  return a >= b ? 0 : 1
}

const byInitiative = (a: Fighter, b: Fighter): number => initiativeOf(b) - initiativeOf(a) || a.id - b.id

/**
 * Reconstruit `fight.timeline` (début de combat) : chaque équipe triée par initiative décroissante, alternance en
 * commençant par `startingTeam(rule)`, invocations replacées juste après leur invocateur (ordre relatif conservé).
 * Le combattant courant (s'il existe) reste le combattant courant.
 */
export function rebuildTimeline(engine: Engine, fight: FightState, rule: StartingTeamRule): void {
  const current = fight.turnIndex >= 0 ? fight.timeline[fight.turnIndex] : undefined
  const roots = fight.fighters.filter(f => f.alive && f.summonerId === undefined)
  const t0 = roots.filter(f => f.team === 0).sort(byInitiative)
  const t1 = roots.filter(f => f.team === 1).sort(byInitiative)
  const [first, second] = startingTeam(fight, rule) === 0 ? [t0, t1] : [t1, t0]
  const order: number[] = []
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) order.push(first[i].id)
    if (second[i]) order.push(second[i].id)
  }
  const summons = fight.timeline.map(id => fight.fighters[id]).filter(f => f && f.alive && f.summonerId !== undefined)
  for (const f of fight.fighters) if (f.alive && f.summonerId !== undefined && !summons.includes(f)) summons.push(f)
  // `insertSummon` place après l'invocateur ET ses invocations déjà insérées : l'ordre relatif est conservé.
  for (const s of summons) engine.insertSummon(order, fight, s)
  fight.timeline = order
  if (current !== undefined) fight.turnIndex = Math.max(0, order.indexOf(current))
}

/**
 * Insère des combattants (racines, déjà ajoutés à `fight.fighters`) dans la timeline sans changer l'ordre des présents :
 * chaque arrivant passe juste avant le premier coéquipier (racine) d'initiative strictement inférieure, sinon après le
 * dernier coéquipier de la timeline et ses invocations ; à défaut de coéquipier, en fin de timeline. Les arrivants
 * de même initiative gardent leur ordre. `turnIndex` suit le combattant courant.
 */
export function insertNewcomers(fight: FightState, newcomers: readonly Fighter[]): void {
  const current = fight.turnIndex >= 0 ? fight.timeline[fight.turnIndex] : undefined
  const tl = fight.timeline.slice()
  for (const n of newcomers) {
    if (tl.includes(n.id)) continue
    const init = initiativeOf(n)
    let at = -1
    let lastMate = -1
    for (let i = 0; i < tl.length; i++) {
      const f = fight.fighters[tl[i]]
      if (!f || f.team !== n.team) continue
      lastMate = i
      if (f.summonerId === undefined && initiativeOf(f) < init) {
        at = i
        break
      }
    }
    if (at < 0) {
      if (lastMate < 0) at = tl.length
      else {
        at = lastMate + 1
        // Après les invocations de ce dernier coéquipier (elles le suivent dans la timeline).
        while (at < tl.length && fight.fighters[tl[at]]?.summonerId !== undefined && fight.fighters[tl[at]].team === n.team) at++
      }
    }
    tl.splice(at, 0, n.id)
  }
  fight.timeline = tl
  if (current !== undefined) fight.turnIndex = Math.max(0, tl.indexOf(current))
}

/**
 * Jusqu'à `count` cases libres et marchables : d'abord les candidates dans l'ordre, puis les cases libres les plus
 * proches des candidates (parcours en largeur sur les cases marchables). `exclude` : cases interdites en plus.
 */
export function pickFreeCells(
  engine: Engine,
  fight: FightState,
  candidates: readonly number[],
  count: number,
  exclude: ReadonlySet<number> = new Set(),
): number[] {
  const out: number[] = []
  const taken = new Set<number>(exclude)
  const ok = (c: number) => c >= 0 && c < CELL_COUNT && !taken.has(c) && engine.isCellFree(fight, c)
  for (const c of candidates) {
    if (out.length >= count) return out
    if (ok(c)) {
      out.push(c)
      taken.add(c)
    }
  }
  if (out.length >= count) return out
  // Repli : parcours en largeur depuis toutes les candidates (ordre déterministe : file FIFO, voisins dans l'ordre).
  const seen = new Uint8Array(CELL_COUNT)
  const queue: number[] = []
  for (const c of candidates) {
    if (c >= 0 && c < CELL_COUNT && !seen[c]) {
      seen[c] = 1
      queue.push(c)
    }
  }
  for (let qi = 0; qi < queue.length && out.length < count; qi++) {
    const c = queue[qi]
    if (ok(c)) {
      out.push(c)
      taken.add(c)
    }
    for (const nb of neighborsOf(c)) {
      if (nb < 0 || seen[nb]) continue
      seen[nb] = 1
      if (fight.map.cells[nb]?.walkable) queue.push(nb)
    }
  }
  return out
}

// ───────────────────────────── invulnérabilité d'arrivée ─────────────────────────────

/** Libellé du buff d'invulnérabilité d'arrivée (replay). */
export const ARRIVAL_INVULNERABLE_LABEL = 'Invulnérable (arrivée de vague)'
const INVULNERABLE_STATE = 56

const ARRIVAL_EFFECT: EffectData = {
  effectId: 950,
  order: 0,
  diceNum: 0,
  diceSide: 0,
  value: INVULNERABLE_STATE,
  duration: -1,
  delay: 0,
  random: 0,
  group: 0,
  targetMask: 'C',
  targetId: 0,
  triggers: 'I',
  // 4 = jamais désenvoûtable ; le scénario retire le buff lui-même.
  dispellable: 4,
  element: -1,
  zone: { shape: 'P', size: 1, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false },
}

/**
 * Pose l'invulnérabilité d'arrivée sur `f` jusqu'au début du tour de jeu `untilRound` (exclu) : état 56 par un buff du
 * scénario (`spellId` 0) ; `tags.arrivalInvulnerableUntil` / `tags.arrivalInvulnerableUid` (lisibles par l'IA : vue
 * honnête, information publique dans le jeu).
 */
export function addArrivalInvulnerability(engine: Engine, fight: FightState, f: Fighter, untilRound: number): void {
  if (!f.alive || untilRound <= fight.round) return
  const b = engine.addBuff(fight, f, {
    sourceId: f.id,
    spellId: 0,
    effect: ARRIVAL_EFFECT,
    value: INVULNERABLE_STATE,
    remaining: -1,
    delay: 0,
    dispellable: false,
    stateId: INVULNERABLE_STATE,
    kind: 'stat',
    label: ARRIVAL_INVULNERABLE_LABEL,
  })
  f.tags.arrivalInvulnerableUntil = untilRound
  f.tags.arrivalInvulnerableUid = b.uid
}

/** Retire les invulnérabilités d'arrivée échues (à appeler au début de chaque tour de jeu). */
export function expireArrivalInvulnerability(engine: Engine, fight: FightState): void {
  for (const f of fight.fighters) {
    const until = f.tags.arrivalInvulnerableUntil
    if (typeof until !== 'number' || until > fight.round) continue
    const uid = f.tags.arrivalInvulnerableUid
    if (typeof uid === 'number') engine.removeBuff(fight, f, uid)
    delete f.tags.arrivalInvulnerableUntil
    delete f.tags.arrivalInvulnerableUid
  }
}

/** Tour de jeu à partir duquel `f` n'est plus invulnérable d'arrivée (0 = pas d'invulnérabilité d'arrivée). */
export function arrivalInvulnerableUntil(f: Fighter): number {
  const v = f.tags.arrivalInvulnerableUntil
  return typeof v === 'number' ? v : 0
}

// ───────────────────────────── vagues ─────────────────────────────

export interface WaveMonsterSpec {
  monsterId: number
  grade: number
}

export interface SpawnWaveOptions {
  team?: TeamId
  /** Numéro de la vague (1..total) et nombre total de vagues (événement de replay `wave`). */
  wave: number
  total: number
  /** Cases candidates par ordre de préférence (cases libres seulement ; repli sur les plus proches). */
  cells: readonly number[]
  /** Invulnérables jusqu'au début de ce tour de jeu (exclu) ; absent ou ≤ tour courant = aucune invulnérabilité. */
  invulnerableUntilRound?: number
  /** Lancer le sort de départ des arrivants (défaut : vrai). */
  startingSpell?: boolean
}

export interface SpawnWaveResult {
  fighters: Fighter[]
  /** Monstres sans case libre (non ajoutés). */
  skipped: WaveMonsterSpec[]
  /** Arrivants dont le sort de départ existe mais n'a pas pu être lancé. */
  startingSpellFailures: number[]
}

/**
 * Fait apparaître une vague : création des monstres (grade demandé), cases libres, insertion dans la timeline
 * (`insertNewcomers`), événement de replay `wave` (avant tout autre événement des arrivants), invulnérabilité
 * d'arrivée, puis sorts de départ (données : 5002 pour les monstres du Vortex).
 */
export function spawnWave(engine: Engine, fight: FightState, specs: readonly WaveMonsterSpec[], o: SpawnWaveOptions): SpawnWaveResult {
  const team = o.team ?? 1
  const cells = pickFreeCells(engine, fight, o.cells, specs.length)
  const created: Fighter[] = []
  const skipped: WaveMonsterSpec[] = []
  specs.forEach((spec, i) => {
    const cell = cells[i]
    if (cell === undefined) {
      skipped.push(spec)
      return
    }
    const f = createMonsterFighter(engine.data, { monsterId: spec.monsterId, grade: spec.grade, team, cell })
    f.wave = o.wave
    f.tags.startCell = cell
    engine.addFighter(fight, f)
    created.push(f)
  })
  insertNewcomers(fight, created)
  engine.emit(fight, { t: 'wave', index: o.wave, total: o.total, fighters: created.map(snapshot) })
  if (skipped.length) engine.log(fight, `Vague ${o.wave} : ${skipped.length} monstre(s) sans case libre.`, 'warn')
  const failures: number[] = []
  for (const f of created) {
    if (o.invulnerableUntilRound !== undefined) addArrivalInvulnerability(engine, fight, f, o.invulnerableUntilRound)
    if (o.startingSpell !== false && !fight.ended && hasStartingSpell(engine, f) && !castStartingSpell(engine, fight, f)) failures.push(f.id)
  }
  return { fighters: created, skipped, startingSpellFailures: failures }
}

/** Le grade du monstre déclare-t-il un sort de départ ? */
export function hasStartingSpell(engine: Engine, f: Fighter): boolean {
  if (f.monsterId === undefined) return false
  const m = engine.data.monster(f.monsterId)
  const g = m?.grades.find(x => x.grade === f.grade) ?? m?.grades[m.grades.length - 1]
  return !!(g && (g.startingSpellLevelId || g.startingSpell))
}
