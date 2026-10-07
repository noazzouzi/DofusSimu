/**
 * Types du visualiseur de replays : format d'un fichier replay et état visuel « logique »
 * calculé par le réducteur (src/replay/reducer.ts) après chaque événement.
 *
 * Un replay ne contient que des `FightEvent` (contrat du moteur, src/engine/types.ts) :
 * le visualiseur ne dépend d'aucune autre donnée du moteur.
 */
import type { TeamId } from '../core/types'
import type { MapData } from '../data/model'
import type { FightEvent, FighterKind } from '../engine/types'
import type { StuffSheet } from '../stats/sheet'

/** Membre de l'équipe décrit dans les métadonnées (composition, rôle, stuff résumé). */
export interface ReplayTeamMember {
  name: string
  /** Classe en clair (ex. « Iop »). */
  breed?: string
  breedId?: number
  /** Rôle tactique (ex. « DPS », « retrait PM », « soin »). */
  role?: string
  /** Résumé du build / stuff (ex. « Air/Terre, 12 PA 6 PM, 2 400 puissance »). */
  build?: string
  notes?: string
  /** Id du combattant correspondant dans le combat. */
  fighterId?: number
  /** Fiche de stuff complète (section « Stuffs » du visualiseur) ; absente des replays antérieurs. */
  sheet?: StuffSheet
}

/** Informations complémentaires sur un combattant (affichées dans le panneau de détails). */
export interface ReplayFighterInfo {
  /** Marque le combattant comme boss (sinon : rôle « boss » du snapshot). */
  boss?: boolean
  /** Caractéristiques résumées : libellé FR -> valeur (ex. { Puissance: 1200, 'Rés. Air': '32 %' }). */
  stats?: Record<string, number | string>
  /** Sorts connus (noms). */
  spells?: string[]
  /** Équipements (noms, exos éventuels). */
  equipment?: string[]
  notes?: string
}

export interface ReplayMeta {
  title?: string
  description?: string
  team?: ReplayTeamMember[]
  seed?: number
  /** Nom lisible du scénario (ex. « Œil de Vortex »). */
  scenario?: string
  /** Outil ayant produit le replay (ex. « démo », « dofussimu-cli 0.3 »). */
  generator?: string
  createdAt?: string
  /** Détails par id de combattant (clé = id en texte). */
  fighters?: Record<string, ReplayFighterInfo>
}

/**
 * Fichier replay. `events[0]` doit être l'événement `fightStart` (snapshots des combattants).
 * `map` est facultative : à défaut, le visualiseur affiche une carte entièrement marchable.
 */
export interface Replay {
  version?: number
  events: FightEvent[]
  map?: MapData
  meta?: ReplayMeta
  /** Avertissements de `parseReplay` (événements invalides ignorés...) ; non sérialisé. */
  warnings?: string[]
}

// ───────────────────────────── état visuel ─────────────────────────────

export interface BuffView {
  uid: number
  sourceId: number
  spellId: number
  label: string
  /** Tours restants (-1 = permanent). Décrémenté au début du tour du lanceur, comme le moteur. */
  remaining: number
}

export interface StateView {
  id: number
  name: string
}

export interface FighterMetricsView {
  damageDealt: number
  damageTaken: number
  healingDone: number
  shieldGiven: number
  apRemoved: number
  mpRemoved: number
  kills: number
  turnsPlayed: number
}

export interface FighterView {
  id: number
  team: TeamId
  kind: FighterKind
  name: string
  breedId?: number
  monsterId?: number
  level: number
  summonerId?: number
  role?: string
  boss: boolean
  hp: number
  maxHp: number
  /** PV max d'apparition (l'écart avec `maxHp` est l'érosion). */
  baseMaxHp: number
  shield: number
  ap: number
  mp: number
  /** PA / PM de début de tour (ou du snapshot avant le premier tour). */
  apMax: number
  mpMax: number
  cell: number
  alive: boolean
  states: StateView[]
  buffs: BuffView[]
  /** Numéro de vague d'apparition (scénarios à vagues). */
  wave?: number
  /** Index de l'événement d'apparition (0 = début du combat). */
  spawnedAt: number
  diedAt?: number
  killer?: number
  metrics: FighterMetricsView
}

export interface OverlayView {
  kind: 'glyph' | 'trap'
  uid: number
  cells: number[]
  color: string
  spellId: number
  /** Lanceur supposé (dernier lanceur de sort au moment de la pose). */
  sourceId?: number
}

export interface CastView {
  index: number
  fighter: number
  spellId: number
  spellName: string
  cell: number
  zone: number[]
  element?: number
  crit: boolean
  /** Combattant présent sur la cellule ciblée au moment du lancer. */
  targetId?: number
}

export interface FightResultView {
  winner: TeamId | null
  rounds: number
  reason: string
}

/** État visuel après application des événements 0..index. */
export interface ViewState {
  index: number
  mapId: number
  seed: number
  scenario?: string
  round: number
  /** Combattant dont c'est le tour (reste défini jusqu'au tour suivant). */
  current: number | null
  /** Vrai entre `turnStart` et `turnEnd`. */
  turnActive: boolean
  /** Index de l'événement `turnStart` du tour en cours (-1 avant le premier tour). */
  turnAt: number
  /** Combattants dans l'ordre d'apparition (morts compris). */
  fighters: FighterView[]
  glyphs: OverlayView[]
  traps: OverlayView[]
  wave: { index: number; total: number } | null
  lastCast: CastView | null
  ended: FightResultView | null
}

// ───────────────────────────── journal ─────────────────────────────

export type LogTone =
  | 'start'
  | 'round'
  | 'turn'
  | 'action'
  | 'move'
  | 'damage'
  | 'heal'
  | 'shield'
  | 'ap'
  | 'mp'
  | 'buff'
  | 'state'
  | 'push'
  | 'death'
  | 'summon'
  | 'wave'
  | 'overlay'
  | 'info'
  | 'ai'
  | 'warn'
  | 'end'

/** Fragment de texte enrichi : nom de combattant (couleur d'équipe), sort, valeur... */
export interface LogSeg {
  text: string
  /** Combattant nommé par ce fragment. */
  fighter?: number
  team?: TeamId
  /** Style du fragment. */
  style?: 'spell' | 'damage' | 'heal' | 'shield' | 'ap' | 'mp' | 'crit' | 'muted' | 'strong'
  /** Élément (0..4) pour teinter une valeur de dégâts. */
  element?: number
}

export interface LogEntry {
  /** Index de l'événement qui produit la ligne. */
  index: number
  tone: LogTone
  /** 0 = action principale, 1 = conséquence (indentée). */
  depth: 0 | 1
  segs: LogSeg[]
  /** Texte brut (concaténation des fragments). */
  text: string
  /** Combattant principal concerné (pour filtrer / sélectionner). */
  fighter?: number
}
