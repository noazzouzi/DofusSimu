/**
 * Modèle d'horloge de l'Œil de Vortex (docs/design/ai.md §12.2 ; vortex.md §5-§7) — WP3. Fonctions PURES de l'état
 * (aucune écriture), qui ne lisent que l'information publique (timeline, états, buffs visibles).
 *
 * Règles reproduites (et vérifiées contre le moteur réel par tests/vortex-clock.test.ts, « T-clock ») :
 *  - +1 heure au DÉBUT du tour de chaque personnage vivant (déclencheur TB de 4999 → 4996) : l'heure d'un créneau
 *    joueur est donc celle qui vient d'arriver ;
 *  - +1 par glyphe de monstre déclenchée (immédiat, au milieu du créneau : effet sur les créneaux SUIVANTS) ;
 *  - joueur mort : rien (défaut) ; variante `deadPlayerAdvancesClock` : un tic au créneau du mort, ancré sur l'ordre
 *    canonique des racines (`slotOrder`) — le hook du scénario applique EXACTEMENT la même règle (`pendingDeadTicks`) :
 *    au début du tour d'un combattant de position canonique p, tic pour chaque personnage mort de position < p qui n'a
 *    pas encore fait avancer l'horloge ce tour-ci ; à la fin du tour de jeu, tic pour les morts restants ;
 *  - l'étoile (234) est posée quand l'horloge ARRIVE sur une heure de mort d'un monstre vivant non corrompu et retirée
 *    au décalage suivant : la fenêtre d'une heure h va du créneau où h arrive au créneau où l'heure change (`starWindows`).
 *
 * Créneaux renvoyés par `forecastHours` : le créneau COURANT d'abord (index 0, heure actuelle de l'Auroraire), puis les
 * créneaux à venir dans l'ordre réel du moteur (morts sautés ; monstres de vague morts supposés ressuscités au tour du
 * Vortex ; vagues futures et invocations futures inconnues : absentes). Un tic d'horloge d'un personnage mort
 * (variante) est un créneau VIRTUEL : `index` −1, `fighterId` = le mort, `isPlayer` vrai — personne n'y joue.
 */
import type { Fighter, FightState } from '../../engine/types'
import { CELL_COUNT, CELL_X, CELL_Y } from '../../map/geometry'
import type { ClockSlot } from '../types'
import {
  AURORAIRE,
  CORRUPTED,
  HOUR_CELL,
  HOUR_COUNT,
  HOUR_STATE_BASE,
  LATENT_DEATH,
  MARGINAL,
  nextHour,
  SAME_HOUR,
  SPELL,
  VORTEX,
  WAVE_MONSTER_IDS,
  ZOMBI,
  type VortexParams,
} from './constants'
import { vortexState } from './params'

export { AURORAIRE, CORRUPTED, HOUR_CELL, HOUR_STATE_BASE, LATENT_DEATH, MARGINAL, SAME_HOUR, VORTEX, ZOMBI }

/** Masque de toutes les heures (12 bits). */
export const ALL_HOURS_MASK = (1 << HOUR_COUNT) - 1

// ───────────────────────────── lecture de l'état ─────────────────────────────

/** Heure (1..12) portée par un combattant (premier état 221..232), 0 sinon. */
export function hourOf(f: Fighter): number {
  for (const s of f.states) if (s > HOUR_STATE_BASE && s <= HOUR_STATE_BASE + HOUR_COUNT) return s - HOUR_STATE_BASE
  return 0
}

/** L'Auroraire du combat (vivante), via l'état du scénario si disponible. */
export function auroraireOf(s: FightState): Fighter | undefined {
  const id = vortexState(s)?.auroraireId
  if (id !== undefined && id >= 0) {
    const f = s.fighters[id]
    if (f && f.alive && f.monsterId === AURORAIRE) return f
  }
  for (const f of s.fighters) if (f.alive && f.monsterId === AURORAIRE) return f
  return undefined
}

/** Heure courante de l'horloge (état 221..232 de l'Auroraire), 0 sans Auroraire. */
export function currentHour(s: FightState): number {
  const a = auroraireOf(s)
  return a ? hourOf(a) : 0
}

/** Masque 12 bits des heures de mort d'un monstre (bit h−1 ; lisible sur un mort : états en « désenvoûtement fort »). */
export function deathHours(m: Fighter): number {
  let mask = 0
  for (const s of m.states) if (s > HOUR_STATE_BASE && s <= HOUR_STATE_BASE + HOUR_COUNT) mask |= 1 << (s - HOUR_STATE_BASE - 1)
  return mask
}

export const hourBit = (h: number): number => (h >= 1 && h <= HOUR_COUNT ? 1 << (h - 1) : 0)
export const maskHas = (mask: number, h: number): boolean => (mask & hourBit(h)) !== 0

/** Heures (1..12) d'un masque, croissantes. */
export function hoursOfMask(mask: number): number[] {
  const out: number[] = []
  for (let h = 1; h <= HOUR_COUNT; h++) if (mask & (1 << (h - 1))) out.push(h)
  return out
}

/** Nombre d'heures d'un masque. */
export function hourCount(mask: number): number {
  let n = 0
  for (let m = mask & ALL_HOURS_MASK; m; m &= m - 1) n++
  return n
}

/** Monstre de vague (porteur du mécanisme 5002), hors Vortex et Auroraire. */
export function isWaveMonster(f: Fighter): boolean {
  return f.team === 1 && f.summonerId === undefined && f.monsterId !== undefined && WAVE_MONSTER_IDS.includes(f.monsterId)
}

export const isCorrupted = (f: Fighter): boolean => f.states.includes(CORRUPTED)
export const hasStar = (f: Fighter): boolean => f.states.includes(SAME_HOUR)
export const isZombie = (f: Fighter): boolean => f.states.includes(ZOMBI)

/**
 * Le début de tour de `f` fait-il avancer l'horloge ? Personnage (racine) porteur du déclencheur TB de *Heure du temps*
 * (4999 → 4996, posé par l'Auroraire sur les personnages au début du combat). Sans Auroraire : jamais.
 */
export function advancesClock(f: Fighter): boolean {
  if (f.kind !== 'player' || f.summonerId !== undefined) return false
  for (const b of f.buffs) if (b.spellId === SPELL.HEURE_DU_TEMPS && b.triggers !== undefined && b.triggers.includes('TB')) return true
  return false
}

/** Personnage (racine) : créneau qui ferait avancer l'horloge s'il était vivant (variante des morts). */
export const isClockPlayer = (f: Fighter): boolean => f.kind === 'player' && f.summonerId === undefined

// ───────────────────────────── tics des personnages morts (variante) ─────────────────────────────

/**
 * Personnages morts dont le créneau canonique (position dans `order`) est strictement avant `beforePos` et qui n'ont
 * pas encore fait avancer l'horloge pendant le tour de jeu `round` (`ticks[id] < round`), dans l'ordre canonique.
 * `beforePos` = `Infinity` à la fin du tour de jeu. Règle commune au hook du scénario et à `forecastHours`.
 */
export function pendingDeadTicks(
  s: FightState,
  order: readonly number[],
  ticks: readonly number[],
  round: number,
  beforePos: number,
  isDead: (f: Fighter) => boolean = f => !f.alive,
): number[] {
  const out: number[] = []
  for (let p = 0; p < order.length && p < beforePos; p++) {
    const f = s.fighters[order[p]]
    if (!f || !isClockPlayer(f) || !isDead(f)) continue
    if ((ticks[f.id] ?? 0) < round) out.push(f.id)
  }
  return out
}

/** Position canonique de la racine de `f` dans `order` (−1 si absente). */
export function canonicalPos(s: FightState, order: readonly number[], f: Fighter): number {
  let r = f
  for (let g = 0; r.summonerId !== undefined && g < 16; g++) r = s.fighters[r.summonerId] ?? r
  return order.indexOf(r.id)
}

/** Racines de la timeline, dans l'ordre (ordre canonique par défaut sans état de scénario). */
function rootsOf(s: FightState): number[] {
  return s.timeline.filter(id => s.fighters[id]?.summonerId === undefined)
}

// ───────────────────────────── prévision ─────────────────────────────

export interface ForecastOptions {
  /** Plafond de créneaux renvoyés (défaut : illimité). */
  maxSlots?: number
}

/**
 * Heures pendant chaque créneau à venir, du créneau courant jusqu'à la fin du tour de jeu `round + rounds − 1`
 * (`round` = tour courant, 1 avant le début du combat). `glyphs.get(i)` = +k heures déclenchées pendant le créneau `i`
 * (index dans le tableau renvoyé) : elles s'appliquent aux créneaux suivants. Tableau vide sans Auroraire.
 */
export function forecastHours(
  s: FightState,
  rounds: number,
  p: Pick<VortexParams, 'deadPlayerAdvancesClock'>,
  glyphs?: ReadonlyMap<number, number>,
  opts: ForecastOptions = {},
): ClockSlot[] {
  const slots: ClockSlot[] = []
  const aur = auroraireOf(s)
  if (!aur || s.ended || rounds <= 0) return slots
  const vx = vortexState(s)
  const tl = s.timeline
  const order = vx?.slotOrder?.length ? vx.slotOrder : rootsOf(s)
  const ticks = (vx?.clockTicks ?? []).slice()
  const deadVariant = p.deadPlayerAdvancesClock
  const maxSlots = opts.maxSlots ?? Infinity
  let hour = hourOf(aur)
  const startRound = Math.max(1, s.round)
  const endRound = startRound + rounds - 1
  let round = startRound
  let idx = -1
  const push = (slot: ClockSlot) => {
    slots.push(slot)
    const k = glyphs?.get(slots.length - 1)
    if (k) hour = nextHour(hour, k)
  }
  // Créneau courant.
  if (s.round > 0 && s.turnIndex >= 0 && s.turnIndex < tl.length) {
    idx = s.turnIndex
    const cur = s.fighters[tl[idx]]
    if (cur) push({ round, index: idx, fighterId: cur.id, isPlayer: isClockPlayer(cur), isVortex: cur.monsterId === VORTEX, hour })
  }
  // Index du Vortex dans le tour courant : un monstre de vague mort APRÈS lui sera ressuscité avant son créneau.
  const vortexIdx = tl.findIndex(id => s.fighters[id]?.monsterId === VORTEX && s.fighters[id].alive)
  const curIdx = idx
  for (let guard = 0; slots.length < maxSlots && guard < (tl.length + order.length + 2) * (rounds + 2); guard++) {
    idx++
    if (idx >= tl.length) {
      if (deadVariant) {
        for (const id of pendingDeadTicks(s, order, ticks, round, Infinity)) {
          ticks[id] = round
          hour = nextHour(hour, 1)
          push({ round, index: -1, fighterId: id, isPlayer: true, isVortex: false, hour })
        }
      }
      round++
      idx = 0
      if (round > endRound) break
    }
    const f = s.fighters[tl[idx]]
    if (!f) continue
    let starts: boolean
    if (f.alive) starts = !(round === startRound && ((f.tags.skipTurns as number | undefined) ?? 0) > 0)
    else if (isWaveMonster(f)) starts = round > startRound || (vortexIdx >= 0 && curIdx < vortexIdx && idx > vortexIdx)
    else starts = false
    if (!starts) continue
    if (deadVariant) {
      const pos = canonicalPos(s, order, f)
      for (const id of pendingDeadTicks(s, order, ticks, round, pos < 0 ? 0 : pos)) {
        ticks[id] = round
        hour = nextHour(hour, 1)
        push({ round, index: -1, fighterId: id, isPlayer: true, isVortex: false, hour })
      }
    }
    if (f.alive && advancesClock(f)) {
      hour = nextHour(hour, 1)
      ticks[f.id] = round
    }
    push({ round, index: idx, fighterId: f.id, isPlayer: isClockPlayer(f), isVortex: f.monsterId === VORTEX, hour })
  }
  return slots
}

/**
 * Fenêtres d'étoile : suites maximales de créneaux consécutifs dont l'heure est dans `hoursMask` (`to` exclu). Une
 * fenêtre commence au créneau où l'horloge ARRIVE sur `hour` (ou au créneau courant si elle y est déjà) et couvre le
 * tour du joueur, de ses invocations et des monstres intercalés jusqu'au prochain changement d'heure.
 */
export function starWindows(slots: readonly ClockSlot[], hoursMask: number): { from: number; to: number; hour: number }[] {
  const out: { from: number; to: number; hour: number }[] = []
  let i = 0
  while (i < slots.length) {
    const h = slots[i].hour
    let j = i + 1
    while (j < slots.length && slots[j].hour === h) j++
    if (maskHas(hoursMask, h)) out.push({ from: i, to: j, hour: h })
    i = j
  }
  return out
}

/**
 * Fenêtres d'étoile d'un monstre précis : heures de mort de `m` ; la fenêtre en cours au créneau 0 n'est retenue que
 * si `m` porte déjà l'étoile (l'étoile n'est posée qu'à l'ARRIVÉE de l'heure, sur un monstre vivant) ; un monstre
 * corrompu n'a plus de fenêtre. Fenêtres futures : supposent `m` vivant à l'arrivée de l'heure.
 */
export function monsterStarWindows(slots: readonly ClockSlot[], m: Fighter): { from: number; to: number; hour: number }[] {
  if (isCorrupted(m)) return []
  const mask = deathHours(m)
  return starWindows(slots, mask).filter(w => w.from > 0 || (m.alive && hasStar(m)))
}

/** Créneau du prochain tour du Vortex dans une prévision (−1 si absent). */
export function nextVortexSlot(slots: readonly ClockSlot[], from = 0): number {
  for (let i = from; i < slots.length; i++) if (slots[i].isVortex) return i
  return -1
}

/** Heures auxquelles le personnage `fighterId` commence ses prochains tours (créneaux réels uniquement). */
export function hoursSeenBy(slots: readonly ClockSlot[], fighterId: number): number[] {
  const out: number[] = []
  for (const sl of slots) if (sl.fighterId === fighterId && sl.index >= 0) out.push(sl.hour)
  return out
}

/** Nombre de créneaux joueurs (réels et virtuels) avant le premier créneau du Vortex d'un tour de jeu : le « k » du §12.2. */
export function playerSlotsBeforeVortex(slots: readonly ClockSlot[], round: number): number {
  let k = 0
  for (const sl of slots) {
    if (sl.round !== round) continue
    if (sl.isVortex) return k
    if (sl.isPlayer) k++
  }
  return k
}

/**
 * Auto-contrôle (§12.2) : l'heure lue maintenant correspond-elle à celle prévue pour ce créneau par une prévision
 * antérieure ? Renvoie undefined si le créneau courant n'apparaît pas dans la prévision.
 */
export function checkForecast(prev: readonly ClockSlot[], s: FightState): boolean | undefined {
  const cur = s.fighters[s.timeline[s.turnIndex]]
  if (!cur) return undefined
  const sl = prev.find(x => x.round === s.round && x.index === s.turnIndex && x.fighterId === cur.id)
  return sl ? sl.hour === currentHour(s) : undefined
}

// ───────────────────────────── géométrie de l'horloge ─────────────────────────────

const LINE_CACHE: (Int16Array | undefined)[] = []

/** Cases en ligne (même x ou même y, `MapPoint`) avec la case de l'heure `hour` (case de l'Auroraire exclue). */
export function lineCells(hour: number): Int16Array {
  const cached = LINE_CACHE[hour]
  if (cached) return cached
  const center = HOUR_CELL[hour]
  const out: number[] = []
  if (center !== undefined && center > 0) {
    const cx = CELL_X[center]
    const cy = CELL_Y[center]
    for (let c = 0; c < CELL_COUNT; c++) if (c !== center && (CELL_X[c] === cx || CELL_Y[c] === cy)) out.push(c)
  }
  const arr = Int16Array.from(out)
  LINE_CACHE[hour] = arr
  return arr
}

/** La case `cell` est-elle sur la croix de l'heure `hour` ? */
export function onHourLine(hour: number, cell: number): boolean {
  const center = HOUR_CELL[hour]
  if (!center || cell < 0 || cell === center) return false
  return CELL_X[cell] === CELL_X[center] || CELL_Y[cell] === CELL_Y[center]
}
