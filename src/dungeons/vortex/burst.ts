/**
 * Transition et burst de phase 2 de l'Œil de Vortex (docs/design/ai.md §12.9) — WP3b.
 *
 * À *Action !* tout le monde retourne à sa case de départ, les monstres meurent, le Vortex reçoit un bonus par heure
 * distincte (5009), reste invulnérable et passe un tour ; il joue ensuite avec 16 PA / 5 PM, Heurage (téléportation au
 * contact de l'Auroraire, relance 3), Heuristique (ligne 1-8 sans LdV) et Morfaille.
 *
 * `planBurst` (prévision analytique, pas de simulation) :
 *  1. Vortex prévu : avant *Action !*, clone portant les bonus des heures DISTINCTES posées (connues exactement :
 *     masques des monstres), V (×75 % subis) et XI (+30 % PV) appliqués analytiquement ; après, le Vortex réel.
 *     Case : case de départ (`vortexCell`) puis, si Heurage est prêt à son tour, contact de la future case de l'Auroraire.
 *  2. Créneaux : `vulnerableFrom` = premier créneau après le tour du Vortex qui suit la fin de son invulnérabilité
 *     (tour d'*Action !* + tour invulnérable) ; fenêtre de burst = créneaux joueurs jusqu'au tour suivant du Vortex
 *     (« le tuer avant qu'il ne joue »), plan B = fenêtre suivante ; `prepSlots` = créneaux joueurs avant.
 *  3. Dégâts par joueur : `dpt(i, V)`·ρ_i (ρ = 1 si sa case de départ est à portée — PM + portée — de la case prévue du
 *     Vortex, 0,6 sinon), variance DoMath ; `pKill = Φ((Σμ − PV)/σ)` (approximation normale, σ² = Σ var + (0,1·Σμ)²).
 *     Si `pKill < θ.burst.minCommit` : plan B sur deux fenêtres, intentions de contrôle.
 *  4. Intentions (source 'burst') : `burst(V)` par joueur de la fenêtre (prix = contribution marginale ΔpKill·vortexKill),
 *     `position` (cases sûres à portée de frappe) et `reserve` (sorts à relance de la rotation) pour les créneaux de
 *     préparation, `setup` pour les porteurs de buffs/débuffs, `control(V)` en plan B.
 *  5. Prix (phase `burst`) : `kill[V] = θ.vortex.vortexKill`, `hp[V].slope = 1 + min(4, φ(z)/σ·vortexKill)`.
 * `safeCells(round, index)` : cases hors des lignes de 8 du Vortex prévu (Heuristique, sans LdV) et hors de la croix
 * de l'Auroraire au créneau du Vortex.
 */
import { createDptTable, type DptTableImpl } from '../../ai/core/dpt'
import type { AIView, Intent, PriceTable, StrategyParams } from '../../ai/types'
import type { Stats } from '../../core/types'
import { cloneFighter } from '../../engine/engine'
import type { Buff, Fighter, FightState } from '../../engine/types'
import { CELL_COUNT, CELL_X, CELL_Y, distance } from '../../map/geometry'
import type { BurstPlan } from '../types'
import { normalCdf } from './abstract'
import { currentHour, forecastHours, isCorrupted, isWaveMonster, nextVortexSlot, onHourLine } from './clock'
import { HOUR_BONUS, HOUR_CELL, HOUR_COUNT, INVULNERABLE, MARGINAL, SPELL, type VortexParams } from './constants'
import { vortexState } from './params'
import { trackVortex } from './tracker'

/** Portée d'Heuristique (ligne, sans LdV). */
export const HEURISTIQUE_LINE = 8

export interface BurstOptions {
  theta: StrategyParams
  params: Pick<VortexParams, 'deadPlayerAdvancesClock' | 'vortexCell'>
  dpt?: DptTableImpl
}

/** Plan de burst enrichi (diagnostics et prix). */
export interface VortexBurstPlan extends BurstPlan {
  vortexId: number
  /** PV prévus du Vortex au burst et dégâts attendus de la fenêtre (μ, σ). */
  hp: number
  mean: number
  sigma: number
  /** P(kill) sur deux fenêtres (plan B). */
  pKill2: number
  /** Créneau du tour du Vortex qui clôt la première fenêtre de burst (undefined hors prévision). */
  windowEnd?: { round: number; index: number }
  /** Case prévue du Vortex au début de la fenêtre. */
  vortexCell: number
  /** Contribution de chaque joueur (μ·ρ). */
  contributions: Map<number, number>
  /** Prix de la phase (vide pendant la préparation : Vortex invulnérable). */
  prices: PriceTable
  /** Le premier créneau vulnérable est le créneau courant (décision clé `burst`). */
  vulnerableNow: boolean
}

const EMPTY_EFFECT_ZONE = { shape: 'P', size: 0, minSize: 0, decreaseStepPct: 0, maxDecreaseCount: 0, stopAtTarget: false }

/** Clone du Vortex portant les bonus de caractéristiques des heures du masque (prévision avant *Action !*). */
export function predictedVortex(v: Fighter, hoursMask: number): Fighter {
  const c = cloneFighter(v)
  const delta: Partial<Stats> = {}
  for (let h = 1; h <= HOUR_COUNT; h++) {
    if (!(hoursMask & (1 << (h - 1)))) continue
    const st = HOUR_BONUS[h]?.stats
    if (!st) continue
    for (const [k, val] of Object.entries(st)) (delta as Record<string, number>)[k] = ((delta as Record<string, number>)[k] ?? 0) + (val as number)
  }
  if (Object.keys(delta).length) {
    const buff: Buff = {
      uid: -1, sourceId: v.id, spellId: SPELL.VORTEXIPHAN_HOUR_BONUS, value: 0, remaining: -1, delay: 0, dispellable: false,
      effect: { effectId: 0, order: 0, diceNum: 0, diceSide: 0, value: 0, duration: -1, delay: 0, random: 0, group: 0, targetMask: '', targetId: 0, triggers: 'I', dispellable: 4, element: -1, zone: EMPTY_EFFECT_ZONE },
      statDelta: delta, label: 'heures (prévision)', kind: 'stat',
    }
    c.buffs = [...c.buffs, buff]
    c.stats = { ...c.stats }
    for (const [k, val] of Object.entries(delta)) (c.stats as unknown as Record<string, number>)[k] = ((c.stats as unknown as Record<string, number>)[k] ?? 0) + (val as number)
    c.rev = undefined
  }
  return c
}

/** Portée de frappe d'un joueur : PM + plus grande portée d'un sort de dégâts (PO comprise si modifiable). */
function strikeReach(dpt: DptTableImpl, f: Fighter): number {
  let r = 0
  for (const p of dpt.profiles.ofFighter(f)) {
    if (!p.damage.length) continue
    r = Math.max(r, p.maxRange + (p.level.rangeBoostable ? Math.max(0, f.stats.range) : 0))
  }
  return Math.max(0, Math.floor(f.stats.mp)) + r
}

/** Cases au contact (distance 1) d'une case. */
function around(cell: number): number[] {
  const out: number[] = []
  if (cell < 0) return out
  for (let c = 0; c < CELL_COUNT; c++) if (distance(c, cell) === 1) out.push(c)
  return out
}

/**
 * Cases sûres (1) au créneau d'un tour du Vortex : hors des lignes ≤ 8 d'une origine possible du Vortex et hors de la
 * croix de l'Auroraire à l'heure `hour` ; cases non marchables à 0.
 */
export function safeCellsFor(fight: FightState, origins: readonly number[], hour: number): Uint8Array {
  const out = new Uint8Array(CELL_COUNT)
  for (let c = 0; c < CELL_COUNT; c++) {
    if (!fight.map.cells[c]?.walkable) continue
    let safe = !(hour > 0 && onHourLine(hour, c))
    for (const o of origins) {
      if (!safe) break
      if (o < 0 || c === o) continue
      if ((CELL_X[c] === CELL_X[o] || CELL_Y[c] === CELL_Y[o]) && distance(c, o) <= HEURISTIQUE_LINE) safe = false
    }
    out[c] = safe ? 1 : 0
  }
  return out
}

const phiDensity = (z: number): number => {
  // φ(z) par différence de Φ (déterministe, sans exp).
  const h = 1e-3
  return (normalCdf(z + h) - normalCdf(z - h)) / (2 * h)
}

/** Plan de burst (voir l'en-tête) ; undefined hors combat du Vortex ou Vortex mort. */
export function planBurst(view: AIView, o: BurstOptions): VortexBurstPlan | undefined {
  const s = view.fight
  const vx = vortexState(s)
  if (!vx) return undefined
  const vortex = s.fighters[vx.vortexId]
  if (!vortex || !vortex.alive) return undefined
  const dpt = o.dpt ?? createDptTable(view.engine)
  const theta = o.theta
  const unlocked = vx.actionRound > 0
  const snap = trackVortex(s)
  // 1. Vortex prévu.
  const hoursMask = unlocked ? 0 : snap.hoursUsedMask
  const vPred = unlocked ? vortex : predictedVortex(vortex, hoursMask)
  const takenMult = !unlocked && hoursMask & (1 << 4) ? HOUR_BONUS[5]!.damageTakenMult!.vortex : 1
  const hp = unlocked ? vortex.hp + vortex.shield : Math.round(vortex.baseMaxHp * (1 + (hoursMask & (1 << 10) ? (HOUR_BONUS[11]!.vitalityPct ?? 0) / 100 : 0)))
  // 2. Créneaux.
  const turnsUntilAction = unlocked ? 0 : Math.max(1, actionTurnOf(s) - vx.vortexTurns)
  const rounds = turnsUntilAction + 4
  const slots = forecastHours(s, rounds, o.params).filter(sl => sl.index >= 0)
  let vulnIdx = 0
  const invulnerable = vortex.states.includes(INVULNERABLE) || vortex.states.includes(MARGINAL)
  if (!unlocked) {
    // Tour d'Action ! (n-ième prochain tour du Vortex), puis tour invulnérable : vulnérable après ce second tour.
    let v = 0
    for (let k = 0; k < turnsUntilAction + 1; k++) {
      v = nextVortexSlot(slots, v + 1)
      if (v < 0) break
    }
    vulnIdx = v < 0 ? slots.length : firstPlayerAfter(slots, v)
  } else if (invulnerable) {
    const v = nextVortexSlot(slots, 1)
    vulnIdx = v < 0 ? slots.length : firstPlayerAfter(slots, v)
  }
  const nextV = nextVortexSlot(slots, Math.max(1, vulnIdx))
  const windowEnd = nextV < 0 ? slots.length : nextV
  const nextV2 = nextV < 0 ? -1 : nextVortexSlot(slots, nextV + 1)
  const window2End = nextV2 < 0 ? slots.length : nextV2
  const players = s.fighters.filter(f => f.alive && f.team === view.team && f.kind === 'player' && f.summonerId === undefined)
  // Case prévue du Vortex au début de la fenêtre : il a joué juste avant (Heurage → contact de l'Auroraire).
  let vSlot: (typeof slots)[number] | undefined
  for (let i = Math.min(vulnIdx, slots.length) - 1; i >= 0 && !vSlot; i--) if (slots[i].isVortex) vSlot = slots[i]
  const heurageReady = (vortex.cooldowns[SPELL.HEURAGE] ?? 0) <= 1
  const startCell = unlocked ? vortex.cell : o.params.vortexCell
  const aurCell = vSlot ? HOUR_CELL[vSlot.hour] : -1
  const origins = heurageReady && aurCell > 0 ? around(aurCell).filter(c => s.map.cells[c]?.walkable) : [startCell]
  const vortexCell = origins.length ? origins.reduce((b, c) => (distance(c, startCell) < distance(b, startCell) ? c : b), origins[0]) : startCell
  // 3. Dégâts par joueur.
  // Avant Action ! : chacun sera ramené sur sa case de départ (`startCells`, dans l'ordre de l'équipe).
  const roster = s.fighters.filter(x => x.team === view.team && x.kind === 'player' && x.summonerId === undefined)
  const cellOf = (f: Fighter): number => (unlocked ? f.cell : (vx.startCells[roster.indexOf(f)] ?? f.cell))
  const contributions = new Map<number, number>()
  const variances = new Map<number, number>()
  for (const f of players) {
    const mu = dpt.dpt(f, vPred) * takenMult
    const rho = distance(cellOf(f), vortexCell) <= strikeReach(dpt, f) ? 1 : 0.6
    contributions.set(f.id, mu * rho)
    variances.set(f.id, dpt.dptVariance(f, vPred) * takenMult * takenMult * rho)
  }
  const inWindow = (from: number, to: number): number[] => {
    const ids: number[] = []
    for (let i = from; i < to && i < slots.length; i++) if (slots[i].isPlayer && contributions.has(slots[i].fighterId)) ids.push(slots[i].fighterId)
    return ids
  }
  const w1 = inWindow(vulnIdx, windowEnd)
  const w2 = inWindow(windowEnd + 1, window2End)
  const pk = (ids: readonly number[], skip = -1): { p: number; mean: number; sigma: number; z: number } => {
    let mean = 0
    let v = 0
    for (const id of ids) {
      if (id === skip) continue
      mean += contributions.get(id) ?? 0
      v += variances.get(id) ?? 0
    }
    const sigma = Math.sqrt(v + (0.1 * mean) ** 2) + 1
    const z = (mean - hp) / sigma
    return { p: normalCdf(z), mean, sigma, z }
  }
  const main = pk(w1)
  const both = pk([...w1, ...w2])
  const minCommit = theta.burst.minCommit
  const vortexKill = theta.vortex.vortexKill
  // 4. Intentions.
  const steps = new Map<number, Intent[]>()
  const addIntent = (it: Intent) => {
    let l = steps.get(it.owner)
    if (!l) steps.set(it.owner, (l = []))
    l.push(it)
  }
  const winOf = (i: number) => ({ fromRound: slots[i].round, fromIndex: slots[i].index, toRound: slots[i].round, toIndex: slots[i].index })
  for (let i = vulnIdx; i < windowEnd && i < slots.length; i++) {
    const id = slots[i].fighterId
    if (!contributions.has(id)) continue
    const marginal = Math.max(0, main.p - pk(w1, id).p)
    addIntent({
      id: `burst:${id}:${slots[i].round}.${slots[i].index}`, kind: 'burst', owner: id, window: winOf(i), target: vortex.id,
      params: { expected: Math.round(contributions.get(id)!) }, price: Math.round(Math.max(marginal, 0.05) * vortexKill),
      source: 'burst', explain: `Burst sur le Vortex (P(kill) ${(main.p * 100).toFixed(0)} %)`,
    })
  }
  const safe = safeCellsFor(s, origins, vSlot ? vSlot.hour : currentHour(s))
  const reserve: { fighterId: number; spellId: number }[] = []
  const prepSlots: { round: number; index: number }[] = []
  // Valeur d'un PV retiré au Vortex (fraction de kill) : ∂pKill/∂dégâts, au moins 1/PV (burst sur plusieurs tours).
  const zDensity = Math.max(phiDensity(main.z) / main.sigma, 1 / Math.max(1, hp))
  for (let i = 0; i < vulnIdx && i < slots.length; i++) {
    const sl = slots[i]
    if (!sl.isPlayer || !contributions.has(sl.fighterId)) continue
    prepSlots.push({ round: sl.round, index: sl.index })
    const f = s.fighters[sl.fighterId]
    // Cases sûres à portée de frappe de la case prévue du Vortex.
    const reach = strikeReach(dpt, f)
    const cells: number[] = []
    for (let c = 0; c < CELL_COUNT && cells.length < 24; c++) if (safe[c] && distance(c, vortexCell) <= reach && distance(c, vortexCell) >= 2) cells.push(c)
    const burstPrice = Math.round(Math.max(0, main.p - pk(w1, f.id).p) * vortexKill)
    if (cells.length && unlocked) {
      addIntent({ id: `pos:${f.id}:${sl.round}.${sl.index}`, kind: 'position', owner: f.id, window: winOf(i), cells, price: Math.round(0.3 * burstPrice + 100), source: 'burst', explain: 'Se placer hors des lignes du Vortex, à portée de burst' })
    }
    // Sorts à relance de la meilleure rotation : à garder pour la fenêtre.
    const rot = dpt.turn(f, vPred, f.stats.ap, 'next')
    for (const spellId of new Set(rot.casts)) {
      const ks = f.spells.find(x => x.spellId === spellId)
      if (!ks) continue
      const p = dpt.profiles.ofFighter(f)[f.spells.indexOf(ks)]
      if (!p || p.cooldown < 2) continue
      reserve.push({ fighterId: f.id, spellId })
      addIntent({ id: `reserve:${f.id}:${spellId}`, kind: 'reserve', owner: f.id, window: winOf(i), params: { spellId }, price: Math.round(Math.min(3000, dpt.perCast(f, f.spells.indexOf(ks), vPred).mean * zDensity * vortexKill)), source: 'burst', explain: `Garder le sort ${spellId} pour le burst` })
    }
    const profs = dpt.profiles.ofFighter(f)
    if (profs.some(p => p.allyBuff || p.enemyDebuff)) {
      addIntent({ id: `setup:${f.id}:${sl.round}.${sl.index}`, kind: 'setup', owner: f.id, window: winOf(i), target: vortex.id, price: Math.round(Math.min(3000, 0.1 * main.mean * zDensity * vortexKill)), source: 'burst', explain: 'Préparer le burst (buffs, débuffs)' })
    }
    if (main.p < minCommit && profs.some(p => p.mpRemoval > 0) && unlocked) {
      addIntent({ id: `control:${f.id}:${sl.round}.${sl.index}`, kind: 'control', owner: f.id, window: winOf(i), target: vortex.id, params: { mpMax: 2 }, price: 500, source: 'burst', explain: 'Plan B : retirer des PM au Vortex' })
    }
  }
  // 5. Prix.
  const prices: PriceTable = { kill: new Map(), hp: new Map(), clock: [0, 0, 0] }
  const vulnerableNow = unlocked && !invulnerable
  if (vulnerableNow) {
    prices.kill.set(vortex.id, new Float32Array(HOUR_COUNT + 1).fill(vortexKill))
    prices.hp.set(vortex.id, { slope: 1 + Math.min(4, (phiDensity(main.z) / main.sigma) * vortexKill) })
  }
  const vulnerableFrom = vulnIdx < slots.length ? { round: slots[vulnIdx].round, index: slots[vulnIdx].index } : { round: (slots[slots.length - 1]?.round ?? s.round) + 1, index: 0 }
  const safeCache = new Map<string, Uint8Array>()
  return {
    vortexId: vortex.id,
    vulnerableFrom,
    prepSlots,
    steps: [...steps.entries()].map(([fighterId, intents]) => ({ fighterId, intents })),
    reserve,
    safeCells(round: number, index: number): Uint8Array {
      const key = `${round}.${index}`
      let c = safeCache.get(key)
      if (c) return c
      // Prochain tour du Vortex à partir de ce créneau : sa case prévue et l'heure de l'Auroraire.
      const from = slots.findIndex(x => x.round > round || (x.round === round && x.index >= index))
      const v = from < 0 ? -1 : nextVortexSlot(slots, from)
      const hour = v >= 0 ? slots[v].hour : currentHour(s)
      const orig = heurageReady && v >= 0 ? around(HOUR_CELL[hour]).filter(x => s.map.cells[x]?.walkable) : [unlocked ? vortex.cell : startCell]
      safeCache.set(key, (c = safeCellsFor(s, orig, hour)))
      return c
    },
    pKill: main.p,
    hp,
    mean: main.mean,
    sigma: main.sigma,
    pKill2: both.p,
    windowEnd: windowEnd < slots.length ? { round: slots[windowEnd].round, index: slots[windowEnd].index } : undefined,
    vortexCell,
    contributions,
    prices,
    vulnerableNow: vulnerableNow && slots.length > 0 && vulnIdx === 0,
  }
}

/** Premier créneau joueur après le créneau i (repli : i + 1). */
function firstPlayerAfter(slots: readonly { isPlayer: boolean }[], i: number): number {
  for (let j = i + 1; j < slots.length; j++) if (slots[j].isPlayer) return j
  return Math.min(slots.length, i + 1)
}

/** Tour du Vortex prévu pour *Action !* (même règle que `vortexPhase`, scenario.ts / setup.ts). */
export function actionTurnOf(s: FightState): number {
  const vx = vortexState(s)
  if (!vx) return 0
  if (vx.actionRound > 0) return vx.vortexTurns
  const monsters = s.fighters.filter(isWaveMonster)
  const allCorrupt = monsters.length > 0 && monsters.every(isCorrupted)
  const since = allCorrupt ? vx.allCorruptSince || vx.vortexTurns + 1 : vx.vortexTurns + 1
  return Math.max(vx.unlockVortexTurn, since + vx.actionDelay)
}

/** Résumé texte d'un plan de burst (aiNote). */
export function describeBurst(b: VortexBurstPlan): string {
  return `Burst : P(kill) ${(b.pKill * 100).toFixed(0)} % (μ ${Math.round(b.mean)} / ${b.hp} PV, deux fenêtres ${(b.pKill2 * 100).toFixed(0)} %), vulnérable au tour ${b.vulnerableFrom.round}`
}
