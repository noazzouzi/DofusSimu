/**
 * Paramètres de stratégie θ (docs/design/ai.md annexe A, §15.3) : type `ThetaJson` (miroir exact de
 * `data/ai/theta-default.json`, vérifié à la compilation dans les deux sens) et chargeur `loadTheta`.
 *
 * Unité : PVe (PV-équivalent) sauf mention contraire. Sections et propriétaires (§18.1) :
 *   value / tactical / tactics / team → WP2 ; threat / monster → WP1 ; planner / vortex / burst → WP3.
 * Les monstres (section `monster`) ne sont JAMAIS réglés par la boucle externe (§11.1, §15.3).
 */
import thetaDefaultJson from '../../data/ai/theta-default.json'
import { fnv1a32 } from '../core/hash'

/** Poids de la fonction de valeur V(s) (§7). */
export interface ThetaValue {
  /** v_e d'un monstre (dégâts). */
  monsterDamage: number
  /** v_e d'une invocation ennemie. */
  summonDamage: number
  /** κ : part des PV max d'un ennemi tué. */
  killKappa: number
  /** τ : tours de menace évités par un kill (au-delà du prochain tour). */
  killTau: number
  /** Poids du bouclier allié dans allyLife. */
  allyShield: number
  /** ω des invocations alliées. */
  summonLife: number
  /** w_er : PV max perdus (érosion). */
  erosion: number
  /** Multiplicateur du DPT perdu à la mort d'un allié (2·dpt_a). */
  deathPotMult: number
  /** w_inc : dégâts attendus avant le prochain tour. */
  incoming: number
  /** w_inc d'un tank. */
  incomingTank: number
  /** Poids des poisons programmés (pendingDot). */
  dot: number
  /** Décroissance par tour des DoT (0,8^k). */
  dotDecay: number
  /** w_ctl : terme de contrôle (guide, retiré si l'ablation ne le justifie pas). */
  control: number
  /** w_pot si l'allié joue avant l'ennemi le plus menaçant. */
  potBefore: number
  /** w_pot sinon. */
  potAfter: number
  /** w_cont : valeur analytique des PA/PM restants (feuilles non terminales). */
  continuation: number
  /** Coût de relance (× valeur moyenne du sort). */
  cdCost: number
  /** Pénalité par PA inutilisé en fin de tour. */
  unusedAp: number
  /** Borne |position| des termes de rôle. */
  positionCap: number
  /** Gain minimal d'un plan sur « ne rien lancer » (hors obligatoires). */
  minGain: number
  /** Gain minimal d'un déplacement de fin de tour. */
  endMoveMinGain: number
  /** U_role : coût additionnel de la mort d'un porteur de rôle clé. */
  roleUtility: { healer: number; mpLock: number; apLock: number; placer: number }
}

/** Modèle de menace (§6.5). */
export interface ThetaThreat {
  /** τ du softmax de ciblage = tauFrac · max s_a. */
  tauFrac: number
  /** Part de zone sur un allié non ciblé. */
  zoneFactor: number
  /** ω_e si un allié joue entre maintenant et l'ennemi. */
  laterEnemyWeight: number
  /** hit si seul un sort plus faible est lançable. */
  hitWeak: number
  /** hit si l'allié n'est atteignable qu'au tour d'après. */
  hitNextTurn: number
  /** Valeur d'un Pacifiste (× potentiel de la cible). */
  pacifistFactor: number
  /** σ de deathRisk = deathSigmaFrac · inc + 1. */
  deathSigmaFrac: number
}

export interface ThetaModeBudget {
  width: number
  topK: number
  depth: number
  rollouts: number
  nodes: number
}

/** Recherche tactique par mode (§8.3). */
export interface ThetaTactical {
  fast: ThetaModeBudget
  standard: ThetaModeBudget & { keyBoost: number; maxKeys: number }
  deep: ThetaModeBudget & { mcts: number; maxKeys: number }
  /** β : pessimisme des rollouts. */
  beta: number
  /** Écart de PV (fraction des dégâts prévus) qui déclenche une replanification. */
  replanHpDev: number
  maxReplans: number
  /** Emplacement de diversité : valeur ≥ best − marge·|best − root|. */
  diversityMargin: number
  /** Bande du split léthal (fraction des PV max). */
  lethalBand: number
}

/** Tactiques proposeuses v1 (§10). */
export interface ThetaTactics {
  prior: {
    stateChain: number
    mpLock: number
    carryThrow: number
    glyphClock: number
    healCleanse: number
    bodyBlock: number
    groupForZone: number
    burstSetup: number
  }
  /** Exploration ε sur l'ordre des candidats (réglage, mode fast). */
  epsilon: number
  /** Plafond de séquences tactiques par nœud. */
  maxPerNode: number
}

/** Coordination d'équipe (§9). */
export interface ThetaTeam {
  emergencyDeathProb: number
  protectDeathProb: number
  maxIntentsPerAlly: number
  /** Seuil de remplacement d'un plan engagé (score_new > score_old·(1 + commit)). */
  commit: number
  reservedCellPenalty: number
  coherenceBonus: number
  /** Pas de contrat de kill sous cette fraction du DPT moyen (mpLock/apLock). */
  killerMinDptFrac: number
}

/** HourPlanner (§12.5) — valeurs du mode standard ; largeur/horizon des autres modes dérivés par WP3. */
export interface ThetaPlanner {
  beamWidth: number
  horizonPlayerSlots: number
  rootDiversity: number
  maxKillsPerSlot: number
  wExposure: number
  corruptBonus: number
  failCost: number
  glyphCost: number
  unreachableHourCost: number
  maxAliveFactor: number
  overloadCost: number
  hourCostScale: number
  /** Poids de ΔEHP dans C_mon (§12.4). */
  lambdaEhp: number
  /** Poids de ΔEHP dans C_vx (§12.4). */
  lambdaBurst: number
  /** Disponibilité d'une glyphe pour un créneau futur. */
  glyphAvailability: number
  /** α de la calibration en ligne de l'oracle de kill (§12.6). */
  oracleAlpha: number
}

/** Prix heuristiques du Vortex (§12.7). */
export interface ThetaVortex {
  corruptKill: number
  plannedFirstKill: number
  unplannedKillBase: number
  waveHpSlope: number
  contractHpSlope: number
  floorSigma: number
  shiftDetour: number
  swapCell: number
  vortexKill: number
  killMin: number
  killMax: number
  /** Indice (top-8) du placement initial retenu (§12.10). */
  placementIndex: number
}

/** Burst de phase 2 (§12.9). */
export interface ThetaBurst {
  minCommit: number
  beam: number
  phase2VortexTurns: number
}

/** IA des monstres (§11) — fixe, jamais réglée pour gagner. */
export interface ThetaMonster {
  topK: number
  predictTopK: number
  referenceTopK: number
  noiseTau: number
  minActionScore: number
  wDmg: number
  wKill: number
  kappa: number
  wAP: number
  wMP: number
  wHeal: number
  wFF: number
  summonValue: number
  reflectAversion: number
  positionDuringTurn: number
}

/** θ complet (miroir de data/ai/theta-default.json). */
export interface ThetaJson {
  value: ThetaValue
  threat: ThetaThreat
  tactical: ThetaTactical
  tactics: ThetaTactics
  team: ThetaTeam
  planner: ThetaPlanner
  vortex: ThetaVortex
  burst: ThetaBurst
  monster: ThetaMonster
}

// Garde de compilation : `ThetaJson` et le JSON ont exactement la même forme (ajout/retrait d'une clé d'un seul côté
// ⇒ erreur de type). Toute modification passe par les deux fichiers (revue des responsables de lot).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const THETA_SHAPE_MATCHES_JSON: Same<ThetaJson, typeof thetaDefaultJson> = true
void THETA_SHAPE_MATCHES_JSON

/** Surcharge partielle profonde de θ (tableaux et nombres remplacés en bloc). */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] }
export type ThetaOverrides = DeepPartial<ThetaJson>

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function deepCopy<T>(v: T): T {
  if (Array.isArray(v)) return v.map(deepCopy) as T
  if (isObject(v)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v)) out[k] = deepCopy(v[k])
    return out as T
  }
  return v
}

function mergeInto(target: Record<string, unknown>, patch: Record<string, unknown>, path: string): void {
  for (const k of Object.keys(patch)) {
    const p = patch[k]
    if (p === undefined) continue
    const here = path ? `${path}.${k}` : k
    if (!(k in target)) throw new Error(`θ : clé inconnue « ${here} »`)
    const cur = target[k]
    if (isObject(cur)) {
      if (!isObject(p)) throw new Error(`θ : « ${here} » attend un objet`)
      mergeInto(cur, p, here)
    } else {
      if (typeof cur !== typeof p || Array.isArray(cur) !== Array.isArray(p)) throw new Error(`θ : type invalide pour « ${here} »`)
      if (typeof p === 'number' && !Number.isFinite(p)) throw new Error(`θ : valeur non finie pour « ${here} »`)
      target[k] = deepCopy(p)
    }
  }
}

/** θ par défaut (copie neuve, modifiable). */
export function defaultTheta(): ThetaJson {
  return deepCopy(thetaDefaultJson as ThetaJson)
}

/**
 * Charge θ : copie profonde des valeurs par défaut puis fusion profonde de chaque surcharge, dans l'ordre (les objets
 * sont fusionnés, nombres/booléens/tableaux remplacés). Une clé inconnue ou un type incompatible lève une erreur
 * (fautes de frappe des campagnes de réglage). Le résultat ne partage rien avec le JSON ni avec les surcharges.
 */
export function loadTheta(...overrides: (ThetaOverrides | undefined)[]): ThetaJson {
  const theta = defaultTheta()
  for (const o of overrides) if (o) mergeInto(theta as unknown as Record<string, unknown>, o as Record<string, unknown>, '')
  return theta
}

/** Paramètres numériques de θ à plat, par chemin pointé (`value.incoming` → 0.8), dans l'ordre du JSON. */
export function flattenTheta(theta: ThetaJson): Record<string, number> {
  const out: Record<string, number> = {}
  const walk = (o: Record<string, unknown>, path: string) => {
    for (const k of Object.keys(o)) {
      const v = o[k]
      const here = path ? `${path}.${k}` : k
      if (isObject(v)) walk(v, here)
      else if (typeof v === 'number') out[here] = v
    }
  }
  walk(theta as unknown as Record<string, unknown>, '')
  return out
}

/** Applique des valeurs par chemin pointé (réglage L2) à une copie de `base` ; chemin inconnu ⇒ erreur. */
export function thetaWithPaths(base: ThetaJson, values: Readonly<Record<string, number>>): ThetaJson {
  const theta = deepCopy(base)
  for (const path of Object.keys(values)) {
    const keys = path.split('.')
    let o = theta as unknown as Record<string, unknown>
    for (let i = 0; i < keys.length - 1; i++) {
      const next = o[keys[i]]
      if (!isObject(next)) throw new Error(`θ : chemin inconnu « ${path} »`)
      o = next
    }
    const last = keys[keys.length - 1]
    if (typeof o[last] !== 'number') throw new Error(`θ : chemin inconnu ou non numérique « ${path} »`)
    o[last] = values[path]
  }
  return theta
}

/** Empreinte stable de θ (clés de cache des campagnes, §15.2). */
export function thetaHash(theta: ThetaJson): number {
  const flat = flattenTheta(theta)
  return fnv1a32(Object.keys(flat).map(k => `${k}=${flat[k]}`).join(';'))
}
