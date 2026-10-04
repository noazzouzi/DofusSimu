/**
 * Contrats du moteur de combat : état d'un combat, combattants, buffs, événements (replay) et actions.
 *
 * Principes :
 *  - L'état est un objet de données pur (clonable par `cloneFight`) pour que l'IA puisse simuler
 *    des milliers de variantes de tour.
 *  - Toute modification observable produit un `FightEvent` : la liste d'événements EST le replay animé.
 *  - Les données statiques (sorts, carte) sont référencées par id via le `DataStore`, jamais copiées.
 */
import type { Element, Stats, TeamId } from '../core/types'
import type { EffectData, MapData, SpellLevelData } from '../data/model'

export type FighterKind = 'player' | 'monster' | 'summon'

/** Sort connu par un combattant, au grade utilisé dans ce combat. */
export interface KnownSpell {
  spellId: number
  level: SpellLevelData
  /** Sort d'arme (attaque au corps-à-corps avec l'arme équipée). */
  isWeapon?: boolean
  name: string
}

/** Un buff/débuff actif sur un combattant. */
export interface Buff {
  uid: number
  sourceId: number
  spellId: number
  effect: EffectData
  /** Valeur résolue (jet effectué) du buff, ex. +2 PA, -150 puissance. */
  value: number
  /** Tours restants (-1 = permanent / jusqu'à désenvoûtement). */
  remaining: number
  /** Effet différé : nombre de tours avant activation. */
  delay: number
  dispellable: boolean
  /** Modifications de caractéristiques apportées tant que le buff est actif. */
  statDelta?: Partial<Stats>
  /** État accordé par ce buff (id spell-state). */
  stateId?: number
  /** Déclencheurs de l'effet (buff réactif) — chaîne DofusDB, ex. "DA" (dommages subis). */
  triggers?: string
  /** Libellé lisible pour l'interface. */
  label: string
}

export interface Fighter {
  id: number
  team: TeamId
  kind: FighterKind
  name: string
  /** Classe (joueurs) */
  breedId?: number
  /** Monstre / invocation */
  monsterId?: number
  grade?: number
  level: number
  /** Caractéristiques permanentes (stuff + base, ou grade de monstre). */
  baseStats: Stats
  /** Caractéristiques effectives = baseStats + somme des statDelta des buffs. */
  stats: Stats
  hp: number
  /** PV max courants (réduits par l'érosion). */
  maxHp: number
  /** PV max de début de combat. */
  baseMaxHp: number
  shield: number
  /** PA / PM restants pour le tour en cours. */
  ap: number
  mp: number
  cell: number
  alive: boolean
  states: number[]
  buffs: Buff[]
  spells: KnownSpell[]
  /** spellId -> tours restants avant de pouvoir relancer. */
  cooldowns: Record<number, number>
  /** spellId -> nombre de lancers ce tour. */
  castsThisTurn: Record<number, number>
  /** `${spellId}:${targetId}` -> nombre de lancers ce tour sur cette cible. */
  castsOnTarget: Record<string, number>
  summonerId?: number
  /** Clé de l'IA à utiliser (registre src/ai). */
  ai: string
  /** Rôle tactique attribué (IA de groupe) : 'dps', 'retrait', 'soin', 'placeur', 'tank', ... */
  role?: string
  /** Entité porteuse / portée (Pandawa). */
  carrying?: number
  carriedBy?: number
  /** Direction d'orientation (0..7) — utile pour certains effets / l'affichage. */
  direction: number
  /** Numéro de vague (scénarios de donjons à vagues). */
  wave?: number
  /** Marqueurs libres pour scénarios/IA (ex. 'invulnerableUntilRound'). */
  tags: Record<string, number | string | boolean>
}

export interface Glyph {
  uid: number
  sourceId: number
  spellId: number
  cells: number[]
  center: number
  remaining: number
  /** Effets appliqués aux entités dans la glyphe (début de tour, entrée, fin de tour). */
  effects: EffectData[]
  trigger: 'turnStart' | 'turnEnd' | 'enter' | 'aura'
  color: string
}

export interface Trap {
  uid: number
  sourceId: number
  spellId: number
  center: number
  cells: number[]
  effects: EffectData[]
  visible: boolean
  color: string
}

/** Instantané minimal d'un combattant (début de combat / invocation / vague) pour le replay. */
export interface FighterSnapshot {
  id: number
  team: TeamId
  kind: FighterKind
  name: string
  breedId?: number
  monsterId?: number
  level: number
  hp: number
  maxHp: number
  ap: number
  mp: number
  cell: number
  summonerId?: number
  role?: string
}

export type DamageKind = 'direct' | 'indirect' | 'push' | 'poison' | 'trap' | 'glyph' | 'reflect' | 'steal'

export type FightEvent =
  | { t: 'fightStart'; mapId: number; fighters: FighterSnapshot[]; seed: number; scenario?: string }
  | { t: 'roundStart'; round: number }
  | { t: 'turnStart'; fighter: number; ap: number; mp: number }
  | { t: 'turnEnd'; fighter: number }
  | { t: 'move'; fighter: number; path: number[]; mpUsed: number }
  | { t: 'tackle'; fighter: number; apLost: number; mpLost: number }
  | {
      t: 'cast'
      fighter: number
      spellId: number
      spellName: string
      cell: number
      crit: boolean
      apCost: number
      /** Cellules affectées (pour l'animation de zone). */
      zone: number[]
      element?: Element
    }
  | {
      t: 'damage'
      source: number
      target: number
      amount: number
      element: Element | -1
      kind: DamageKind
      shieldAbsorbed?: number
      erosion?: number
      crit?: boolean
    }
  | { t: 'heal'; source: number; target: number; amount: number }
  | { t: 'shield'; source: number; target: number; amount: number }
  | { t: 'apmp'; target: number; ap: number; mp: number; reason: string }
  | { t: 'buff'; target: number; source: number; spellId: number; label: string; duration: number; uid: number }
  | { t: 'unbuff'; target: number; uid: number }
  | { t: 'state'; target: number; stateId: number; name: string; added: boolean }
  | { t: 'push'; target: number; from: number; to: number; collisionWith?: number; collisionDamage?: number }
  | { t: 'teleport'; target: number; from: number; to: number }
  | { t: 'summon'; summoner: number; fighter: FighterSnapshot }
  | { t: 'death'; target: number; killer?: number }
  | { t: 'glyph'; glyph: { uid: number; cells: number[]; color: string; spellId: number }; added: boolean }
  | { t: 'trap'; trap: { uid: number; cells: number[]; color: string; spellId: number }; added: boolean }
  | { t: 'wave'; index: number; total: number; fighters: FighterSnapshot[] }
  | { t: 'log'; text: string; level?: 'info' | 'ai' | 'warn' }
  | { t: 'fightEnd'; winner: TeamId | null; rounds: number; reason: string }

/** Actions qu'une IA peut demander pendant son tour. */
export type Action =
  | { type: 'move'; path: number[] }
  | { type: 'cast'; spellId: number; cell: number }
  | { type: 'endTurn' }

/** Façon dont les jets aléatoires sont résolus (l'IA évalue en moyenne, le combat réel tire au sort). */
export type RollMode = 'random' | 'average' | 'min' | 'max'

export interface FightOptions {
  seed: number
  rollMode: RollMode
  /** Enregistrer les événements (replay) — désactivé pendant les simulations internes de l'IA. */
  record: boolean
  /** Nombre maximal de tours de jeu avant de déclarer un match nul. */
  maxRounds: number
}

/** Hooks de scénario (donjons à vagues, phases de boss, invulnérabilités...). */
export interface ScenarioHooks {
  id: string
  onFightStart?(fight: FightState): void
  onRoundStart?(fight: FightState): void
  onTurnStart?(fight: FightState, fighter: Fighter): void
  onTurnEnd?(fight: FightState, fighter: Fighter): void
  onDeath?(fight: FightState, fighter: Fighter): void
  /** Retourne l'équipe gagnante si le scénario impose une fin de combat, sinon undefined. */
  checkEnd?(fight: FightState): TeamId | null | undefined
  /** Peut interdire des dégâts (invulnérabilités scénarisées). */
  canBeDamaged?(fight: FightState, target: Fighter, source: Fighter | undefined): boolean
}

export interface FightState {
  map: MapData
  fighters: Fighter[]
  /** Ordre de jeu (ids) ; les invocations sont insérées après leur invocateur. */
  timeline: number[]
  /** Index dans `timeline` du combattant dont c'est le tour. */
  turnIndex: number
  round: number
  glyphs: Glyph[]
  traps: Trap[]
  rngState: number
  /** Compteur pour générer des uid uniques (buffs, glyphes, invocations). */
  nextUid: number
  events: FightEvent[]
  options: FightOptions
  ended: boolean
  winner: TeamId | null
  endReason?: string
  /** Statistiques de combat (dégâts infligés/subis par combattant...) pour les rapports. */
  metrics: Record<number, FighterMetrics>
  /** Données libres du scénario (ex. vague courante). */
  scenarioState: Record<string, unknown>
}

export interface FighterMetrics {
  damageDealt: number
  damageTaken: number
  healingDone: number
  apRemoved: number
  mpRemoved: number
  kills: number
  turnsPlayed: number
}
