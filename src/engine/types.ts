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
  /** Nature du buff : modification de stats/état, déclencheur réactif, effet différé, autre. */
  kind?: 'stat' | 'trigger' | 'delayed' | 'special'
  /** Lancé en coup critique (hérité par les effets déclenchés). */
  crit?: boolean
  /** Nombre de déclenchements déjà effectués / maximum autorisé. */
  triggerCount?: number
  maxTriggers?: number
  /** Garde de réentrance pendant l'exécution du déclencheur. */
  firing?: boolean
  // ── Champs optionnels renseignés par effects/buffs (absents des autres buffs) ──
  /** Modificateur de sort accordé par ce buff (effets de catégorie 3 : 280-299, 314, 798, 2905/2906, 2935...). */
  spellMod?: SpellModEntry
  /** État neutralisé (sans être retiré) tant que ce buff est actif (effet 952). */
  disabledStateId?: number
  /** Tour annulé (effet 140) : le porteur passe automatiquement ses tours tant que ce buff est actif. */
  passTurn?: boolean
  /** Buff accordé par une glyphe-aura (uid de la marque) : retiré quand le porteur sort de l'aura (effects/marks.ts). */
  markUid?: number
  /**
   * Effet différé (`kind: 'delayed'`) : case ciblée par le lancer d'origine (port `HandleDelayedCast` :
   * `buff.TargetedCell`), transmise à l'exécution dans `EffectContext.originCell` (effects/core.ts).
   */
  targetCell?: number
  /**
   * Combattant au début du tour duquel la durée et le délai du buff sont décomptés, s'il diffère de la source
   * (`aliveSource` du client, BuffManager). Effets portés par une invocation (effects/core.ts `isSummonOwned`) : la
   * source est l'invocation (intercepteur, lanceur des masques), le décompte suit les tours de l'invocateur.
   */
  aliveSourceId?: number
}

/**
 * Modificateurs de sort (effets de catégorie 3), agrégés par `Engine.recomputeStats` dans `Fighter.spellMods`.
 * Clés additives : rangeMin/rangeMax (280/281, 294/295), apCost (285 −, 296 +), critChance (287), castsPerTurn (290),
 * castsPerTarget (291), baseDamage (293), damage (283), baseHeal (2935), heal (284), cooldown (286 −).
 * Clés « fixées » (la dernière gagne) : setRangeMin/setRangeMax (2906/2905), setCooldown (292), rangeBoostable (282),
 * noLos (289), noLine (288), needFreeCell (299 → 1 / 298 → 0), needTakenCell (314 → 1 / 297 → 0),
 * needVisibleEntity (798). Lecture : effects/buffs/spellMods.ts (`spellModifier`, `modifiedSpellLevel`).
 */
export type SpellModKey =
  | 'rangeMin'
  | 'rangeMax'
  | 'setRangeMin'
  | 'setRangeMax'
  | 'rangeBoostable'
  | 'apCost'
  | 'critChance'
  | 'castsPerTurn'
  | 'castsPerTarget'
  | 'baseDamage'
  | 'damage'
  | 'baseHeal'
  | 'heal'
  | 'cooldown'
  | 'setCooldown'
  | 'noLos'
  | 'noLine'
  | 'needFreeCell'
  | 'needTakenCell'
  | 'needVisibleEntity'

/** Modificateurs d'un sort (clés présentes seulement si un buff les fixe). */
export type SpellModifiers = Partial<Record<SpellModKey, number>>

/** Modificateur porté par un buff : sort visé (0 = tous les sorts du porteur, INCERTAIN), clé, valeur signée. */
export interface SpellModEntry {
  spellId: number
  key: SpellModKey
  value: number
  /** Valeur fixée (remplace) plutôt qu'additive. */
  set?: boolean
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
  /**
   * Caractéristiques effectives = baseStats + somme des statDelta des buffs. Objet REMPLACÉ par
   * `Engine.recomputeStats`, jamais modifié en place : partagé entre clones de combat (`Engine.cloneFight`).
   */
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
  /** États actifs : tableau REMPLACÉ par `Engine.recomputeStats`, jamais modifié en place (partagé entre clones). */
  states: number[]
  /**
   * Buffs actifs. Tableau ET objets partagés entre clones de combat (`Engine.cloneFight`) en copie-sur-écriture : le
   * moteur les rend privés (`ownBuffs`, src/engine/cow.ts) avant toute modification. Hors du moteur : lecture libre,
   * jamais de modification en place (remplacer le tableau).
   */
  buffs: Buff[]
  spells: KnownSpell[]
  /**
   * spellId -> tours restants avant de pouvoir relancer. Comme `castsThisTurn` et `castsOnTarget` : objet partagé
   * entre clones de combat (`Engine.cloneFight`), REMPLACÉ à chaque écriture (`setRecord`, src/engine/cow.ts), jamais
   * modifié en place une fois le combat cloné.
   */
  cooldowns: Record<number, number>
  /** spellId -> nombre de lancers ce tour (objet remplacé à chaque écriture, cf. `cooldowns`). */
  castsThisTurn: Record<number, number>
  /** `${spellId}:${targetId}` -> nombre de lancers ce tour sur cette cible (objet remplacé, cf. `cooldowns`). */
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
  /**
   * Modificateurs de sorts actifs (spellId -> modificateurs ; clé 0 = tous les sorts), recalculés depuis les buffs
   * par `Engine.recomputeStats` (objet remplacé, jamais modifié en place : partageable entre clones). Absent sans buff.
   */
  spellMods?: Record<number, SpellModifiers>
  /** États neutralisés par un buff 952 (toujours présents dans `states`, mais sans leurs drapeaux). */
  disabledStates?: number[]
  /**
   * (E4, docs/design/ai.md §3.3) Révision : valeur neuve, unique dans le processus (src/engine/rev.ts `bumpRev`),
   * posée par `Engine.recomputeStats` et à chaque changement de case (marche, poussée, téléportation, portage, mort,
   * résurrection). Clé de cache de l'IA (DPT, menace) : `(id, rev)` égaux garantissent mêmes caractéristiques,
   * buffs/états et case, y compris entre clones frères. Valeur opaque (dépend de l'historique du processus) : jamais
   * dans une décision ni un hash d'état. Absente = combattant jamais recalculé.
   */
  rev?: number
  /** Sorts passifs conférés par l'équipement (effet 1175 : Dofus, objets légendaires), lancés au début du combat. */
  passiveSpells?: number[]
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
  // ── Champs optionnels renseignés par effects/marks.ts (absents des glyphes créés ailleurs) ──
  /** Nature de la marque : glyphe (défaut), rune Huppermage (inerte, déclenchée par 2023), portail Eliotrope. */
  markType?: 'glyph' | 'rune' | 'portal'
  /** Sort lancé par la marque (diceNum de l'effet de pose) et son grade ; `spellId` reste le sort qui a posé la marque. */
  castSpellId?: number
  castGrade?: number
  /** Pose en coup critique : le sort de la marque utilise ses effets critiques (flag hérité). */
  crit?: boolean
  /** Équipe du poseur (portails, visibilité). */
  team?: TeamId
  /** Glyphe-aura : combattants déjà affectés (une seule application tant qu'ils restent dans la zone). */
  triggered?: number[]
  /** Portail : paramètres de bonus (diceNum = % par case, value = bonus de base) et désactivation. */
  portalBonusPerCell?: number
  portalBaseBonus?: number
  /** Portail désactivé jusqu'au début du prochain tour de ce combattant (effet 1183). */
  disabledUntil?: number
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
  // ── Champs optionnels renseignés par effects/marks.ts ──
  castSpellId?: number
  castGrade?: number
  crit?: boolean
  team?: TeamId
}

/** Mort enregistrée (ordre chronologique) — résurrections (780/1034 : « dernier allié mort »). */
export interface DeathRecord {
  fighter: number
  /** Case occupée au moment de la mort. */
  cell: number
  round: number
  killer?: number
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
  | AiNoteEvent
  | { t: 'fightEnd'; winner: TeamId | null; rounds: number; reason: string }

/** Nature d'une annotation de l'IA (E3) : plan stratégique, intention, tactique, cible focale, coup « créatif ». */
export type AiNoteKind = 'plan' | 'intent' | 'tactic' | 'focus' | 'creative'

/**
 * (E3, docs/design/ai.md §3.3) Annotation de l'IA pour le replay : bulle de pensée sur `fighter`, avec cases
 * (flèches / zones d'intention) et cibles facultatives. Purement descriptive : n'entre pas dans le hash des événements.
 */
export interface AiNoteEvent {
  t: 'aiNote'
  fighter: number
  kind: AiNoteKind
  text: string
  cells?: number[]
  targets?: number[]
}

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
  /** Appliquer les relances initiales (initialCooldown) des sorts à l'entrée en combat (défaut : non). */
  initialCooldowns?: boolean
  /**
   * (E1, docs/design/ai.md §3.3, §13.1) Re-semis des dés. 'none' (défaut, absent) : un seul flux depuis `seed`.
   * 'perTurn' : `startTurn` pose `rngState = mix32(mix32(seed, round), fighterId)` (src/core/hash.ts), de sorte qu'une
   * décision différente à un tour ne décale pas les dés des tours suivants (nombres aléatoires communs, rembobinage).
   */
  rngRekey?: 'none' | 'perTurn'
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
  /**
   * (E2, docs/design/ai.md §3.3) Copie de `fight.scenarioState` utilisée par `Engine.cloneFight` à la place de
   * `structuredClone` (5-20 µs par clone). Doit renvoyer un objet indépendant pour tout ce que les hooks modifient.
   */
  cloneState?(s: Record<string, unknown>): Record<string, unknown>
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
  /**
   * Morts dans l'ordre chronologique (renseigné par Engine.kill). Tableau remplacé (copie) à chaque ajout et jamais
   * modifié en place : un clone de combat (`cloneFight`, copie superficielle) peut donc le partager sans risque.
   */
  deaths?: DeathRecord[]
  /**
   * (E5, docs/design/ai.md §3.3) Nombre d'effets (non purement visuels) rencontrés SANS interprète pendant ce combat
   * (effects/core.ts `runEffect`). > 0 ⇒ résultat « faible confiance ». Absent = 0. Copié par `cloneFight`.
   */
  unknownEffects?: number
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
