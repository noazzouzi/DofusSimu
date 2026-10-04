/**
 * Suivi des monstres de l'Œil de Vortex (docs/design/ai.md §12.3) — WP3.
 *
 * Le tracker OBSERVE le moteur (états, vie, `scenarioState.vortex`) ; seul le planificateur PRÉVOIT. Lecture honnête :
 * uniquement l'information publique (états affichés, PV, cases, tags du scénario), jamais `fight.events`.
 *
 * Statuts (`MonsterTrack.status`) :
 *  - `pending`      : monstre d'une vague future (id négatif −(10·vague + rang), composition N = `players`) ;
 *  - `invulnerable` : vivant, invulnérable d'arrivée (`tags.arrivalInvulnerableUntil` > tour courant) ;
 *  - `alive`        : vivant, non corrompu ;
 *  - `dead`         : mort non corrompu (sera ressuscité au début du tour du Vortex, sauf après *Action !*) ;
 *  - `corrupt`      : état 6611 (vivant jusqu'à *Action !*, puis mort).
 * `hours` = masque des heures de mort (états 221..232, lisibles sur un mort) ; `star` = « Même heure » (234).
 *
 * `VortexTracker.observe` incrémente `version` à chaque événement symbolique (mort, résurrection, vague, heure,
 * étoile, corruption) : clé de cache du `HeuristicPricer` (§9.6).
 */
import { fnv1a32, mix32 } from '../../core/hash'
import type { Fighter, FightState } from '../../engine/types'
import type { MonsterTrack } from '../types'
import { arrivalInvulnerableUntil } from '../waves'
import { currentHour, deathHours, hasStar, hourCount, isCorrupted, isWaveMonster, isZombie } from './clock'
import { LATENT_DEATH, VORTEX, WAVE_COUNT, waveComposition } from './constants'
import { vortexState } from './params'

/** Suivi enrichi (les champs de `MonsterTrack` + diagnostics du tracker). */
export interface VortexMonsterTrack extends MonsterTrack {
  name: string
  /** Case actuelle (−1 si mort ou à venir). */
  cell: number
  /** État Zombi (74) : ressuscité au moins une fois. */
  zombie: boolean
  /** « Mort latente » (233) encore visible. */
  latentDeath: boolean
  /** Tour de jeu à partir duquel l'invulnérabilité d'arrivée tombe (0 = aucune). */
  invulnerableUntil: number
  /** Nombre d'heures de mort distinctes. */
  hourCount: number
}

export interface VortexSnapshot {
  round: number
  /** Heure courante (0 sans Auroraire). */
  hour: number
  tracks: VortexMonsterTrack[]
  /** Monstres apparus (vagues arrivées), corrompus, en attente. */
  spawned: number
  corrupted: number
  pending: number
  /** Total des monstres de vague du combat (5 vagues, N monstres sauf le Vortex). */
  total: number
  /** Union des heures de mort des monstres (bonus hérités par le Vortex à *Action !*). */
  hoursUsedMask: number
  vortexId: number
  vortexHp: number
  vortexMaxHp: number
  /** *Action !* a eu lieu. */
  unlocked: boolean
  /** Empreinte des faits symboliques (statuts, heures, étoiles, heure courante, vagues). */
  signature: number
}

export interface TrackOptions {
  /** Menace propre d'un monstre (PVe/tour, `Perception.threat.threatOf`) ; défaut 0. */
  threatOf?: (m: Fighter) => number
}

/** Statut d'un monstre de vague présent. */
export function statusOf(fight: FightState, m: Fighter): MonsterTrack['status'] {
  if (isCorrupted(m)) return 'corrupt'
  if (!m.alive) return 'dead'
  if (arrivalInvulnerableUntil(m) > fight.round) return 'invulnerable'
  return 'alive'
}

const STATUS_CODE: Record<MonsterTrack['status'], number> = { pending: 1, invulnerable: 2, alive: 3, dead: 4, corrupt: 5 }

/** Instantané des monstres de vague (présents puis à venir). */
export function trackVortex(fight: FightState, o: TrackOptions = {}): VortexSnapshot {
  const vx = vortexState(fight)
  const hour = currentHour(fight)
  const tracks: VortexMonsterTrack[] = []
  let hoursUsedMask = 0
  let corrupted = 0
  for (const m of fight.fighters) {
    if (!isWaveMonster(m)) continue
    const hours = deathHours(m)
    hoursUsedMask |= hours
    const status = statusOf(fight, m)
    if (status === 'corrupt') corrupted++
    tracks.push({
      fighterId: m.id,
      monsterId: m.monsterId!,
      wave: m.wave ?? 0,
      status,
      hp: m.alive ? m.hp : 0,
      maxHp: m.maxHp,
      hours,
      star: hasStar(m),
      threat: m.alive && status !== 'corrupt' ? (o.threatOf?.(m) ?? 0) : 0,
      name: m.name,
      cell: m.alive ? m.cell : -1,
      zombie: isZombie(m),
      latentDeath: m.states.includes(LATENT_DEATH),
      invulnerableUntil: arrivalInvulnerableUntil(m),
      hourCount: hourCount(hours),
    })
  }
  const spawned = tracks.length
  let pending = 0
  const players = vx?.players ?? 4
  const comp = waveComposition(players)
  const wavesSpawned = vx?.wavesSpawned ?? WAVE_COUNT
  let total = 0
  comp.forEach((wave, w) => {
    const mons = wave.filter(id => id !== VORTEX)
    total += mons.length
    if (w < wavesSpawned) return
    mons.forEach((monsterId, i) => {
      pending++
      tracks.push({
        fighterId: -(10 * (w + 1) + i),
        monsterId,
        wave: w + 1,
        status: 'pending',
        hp: 0,
        maxHp: 0,
        hours: 0,
        star: false,
        arrivesRound: vx?.arrivalRounds[w],
        threat: 0,
        name: '',
        cell: -1,
        zombie: false,
        latentDeath: false,
        invulnerableUntil: 0,
        hourCount: 0,
      })
    })
  })
  const vortex = vx ? fight.fighters[vx.vortexId] : undefined
  let sig = mix32(hour, wavesSpawned)
  for (const t of tracks) sig = mix32(mix32(sig, t.fighterId), (STATUS_CODE[t.status] << 16) ^ (t.hours << 1) ^ (t.star ? 1 : 0))
  sig = mix32(sig, vx?.actionRound ?? 0)
  return {
    round: fight.round,
    hour,
    tracks,
    spawned,
    corrupted,
    pending,
    total,
    hoursUsedMask,
    vortexId: vx?.vortexId ?? -1,
    vortexHp: vortex?.alive ? vortex.hp : 0,
    vortexMaxHp: vortex?.maxHp ?? 0,
    unlocked: (vx?.actionRound ?? 0) > 0,
    signature: sig >>> 0,
  }
}

/**
 * Tracker avec mémoire : `version` change à chaque événement symbolique (empreinte différente). Données pures
 * (`snapshot()` / `restore()` pour le rembobinage).
 */
export class VortexTracker {
  version = 0
  last?: VortexSnapshot
  private sig = -1

  observe(fight: FightState, o: TrackOptions = {}): VortexSnapshot {
    const snap = trackVortex(fight, o)
    if (snap.signature !== this.sig) {
      this.sig = snap.signature
      this.version++
    }
    this.last = snap
    return snap
  }

  snapshot(): { version: number; sig: number } {
    return { version: this.version, sig: this.sig }
  }

  restore(s: { version: number; sig: number }): void {
    this.version = s.version
    this.sig = s.sig
    this.last = undefined
  }
}

/** Résumé texte d'un suivi (journaux, `aiNote`). */
export function describeTrack(t: VortexMonsterTrack): string {
  const hours = t.hours ? `heures ${t.hours.toString(2)}` : 'aucune heure'
  return `${t.name || `#${t.fighterId}`} [v${t.wave}] ${t.status}${t.star ? ' ★' : ''} ${t.hp}/${t.maxHp} PV, ${hours}`
}

/** Empreinte texte stable d'un instantané (tests de déterminisme). */
export function snapshotDigest(s: VortexSnapshot): number {
  return fnv1a32(JSON.stringify(s.tracks.map(t => [t.fighterId, t.status, t.hp, t.hours, t.star])))
}
