/**
 * Grammaires des conditions de sorts :
 *  1. `statesCriterion` (spell-level) : condition d'états du LANCEUR pour pouvoir lancer le sort ;
 *  2. `triggers` (effet) : déclencheurs d'un effet (instantané « I » ou buff réactif).
 *
 * Références : docs/research/effects.md §6, docs/research/mechanics.md §4.3, data/research/zone-and-mask-grammar.json
 * (#/statesCriterion, #/triggers), port D3 `HaxeBuff.ShouldBeTriggeredOnTarget/OnCaster/OnTargetDamage`.
 *
 * ── statesCriterion ──
 *   expr := and ('|' and)* ; and := atom ('&' atom)* ; atom := '(' expr ')' | terme
 *   terme := 'HS=' id (le lanceur a l'état) | 'HS!' id (ne l'a pas) | 'E' id / 'e' id (forme historique du module)
 * Opérateurs observés dans TOUTES les données (classes, monstres, objets : 197 chaînes) : HS=, HS!, &, |, ( ).
 * Précédence : & avant | (les mélanges observés sont toujours parenthésés). Un terme inconnu est conservé
 * (`unknown`) et évalué à VRAI (permissif) ; une chaîne mal formée est signalée dans `errors`.
 *
 * ── triggers ──
 *   liste séparée par '|' (OU). 'I' = instantané. Codes sans préfixe C : événement SUBI par le porteur ; codes
 *   « causés » (CC, CI, CD…, K…) : événement CAUSÉ par le porteur. Préfixe X (XD, XPD…) : vaut aussi si
 *   l'événement tue le porteur. Codes paramétrés : EON#, EOFF#, EACT# (état), TR# (seuil du sort #),
 *   EK:<masque> (une entité correspondant au masque meurt), EC:<op><n>:<masque> (nombre d'entités).
 */
import type { StatesClause } from '../data/model'
import type { Fighter } from './types'

// ═════════════════════════════ statesCriterion ═════════════════════════════

export type CriterionNode =
  | { kind: 'true' }
  | { kind: 'state'; stateId: number; has: boolean }
  | { kind: 'and'; items: CriterionNode[] }
  | { kind: 'or'; items: CriterionNode[] }
  | { kind: 'unknown'; raw: string }

export interface ParsedCriterion {
  raw: string
  root: CriterionNode
  /** Termes non reconnus (évalués à vrai). */
  unknown: string[]
  /** Erreurs de syntaxe (parenthèse manquante, opérateur isolé...). */
  errors: string[]
  /** Évaluateur compilé sur la liste des états du lanceur (sans allocation). */
  test: (states: readonly number[]) => boolean
}

const TRUE_NODE: CriterionNode = { kind: 'true' }
const criterionCache = new Map<string, ParsedCriterion>()

/** Analyse (avec cache) une condition d'états `statesCriterion`. */
export function parseStatesCriterion(criterion: string | null | undefined): ParsedCriterion {
  const raw = criterion ?? ''
  let p = criterionCache.get(raw)
  if (!p) {
    p = buildCriterion(raw)
    criterionCache.set(raw, p)
  }
  return p
}

function buildCriterion(raw: string): ParsedCriterion {
  const unknown: string[] = []
  const errors: string[] = []
  const src = raw.replace(/\s+/g, '')
  let pos = 0

  const parseOr = (): CriterionNode => {
    const items = [parseAnd()]
    while (src[pos] === '|') {
      pos++
      items.push(parseAnd())
    }
    return items.length === 1 ? items[0] : { kind: 'or', items }
  }
  const parseAnd = (): CriterionNode => {
    const items = [parseAtom()]
    while (src[pos] === '&') {
      pos++
      items.push(parseAtom())
    }
    return items.length === 1 ? items[0] : { kind: 'and', items }
  }
  const parseAtom = (): CriterionNode => {
    if (src[pos] === '(') {
      pos++
      const inner = parseOr()
      if (src[pos] === ')') pos++
      else errors.push(`parenthèse fermante manquante à la position ${pos}`)
      return inner
    }
    const start = pos
    while (pos < src.length && src[pos] !== '&' && src[pos] !== '|' && src[pos] !== '(' && src[pos] !== ')') pos++
    const term = src.slice(start, pos)
    if (!term) {
      errors.push(`terme vide à la position ${start}`)
      return TRUE_NODE
    }
    const m = /^HS([=!])(\d+)$/.exec(term) ?? /^([Ee])(\d+)$/.exec(term)
    if (m) return { kind: 'state', stateId: Number(m[2]), has: m[1] === '=' || m[1] === 'E' }
    unknown.push(term)
    return { kind: 'unknown', raw: term }
  }

  let root: CriterionNode = TRUE_NODE
  if (src) {
    root = parseOr()
    if (pos < src.length) errors.push(`caractères inattendus « ${src.slice(pos)} »`)
  }
  return { raw, root, unknown, errors, test: compileNode(root) }
}

type StatesTest = (states: readonly number[]) => boolean

function compileNode(n: CriterionNode): StatesTest {
  switch (n.kind) {
    case 'true':
    case 'unknown':
      return () => true
    case 'state': {
      const { stateId, has } = n
      return has ? s => s.includes(stateId) : s => !s.includes(stateId)
    }
    case 'and': {
      const fs = n.items.map(compileNode)
      return s => {
        for (const f of fs) if (!f(s)) return false
        return true
      }
    }
    case 'or': {
      const fs = n.items.map(compileNode)
      return s => {
        for (const f of fs) if (f(s)) return true
        return false
      }
    }
  }
}

/** Évalue un nœud de condition avec une fonction d'appartenance d'état. */
export function evaluateCriterion(node: CriterionNode, hasState: (stateId: number) => boolean): boolean {
  switch (node.kind) {
    case 'true':
    case 'unknown':
      return true
    case 'state':
      return hasState(node.stateId) === node.has
    case 'and':
      return node.items.every(i => evaluateCriterion(i, hasState))
    case 'or':
      return node.items.some(i => evaluateCriterion(i, hasState))
  }
}

/**
 * Vérifie la condition d'états du lanceur (`statesCriterion`, ex. "HS!7", "(HS=3360|HS=3589)&HS!7").
 * Chaîne vide → vrai. Analyse mise en cache : coût d'un appel = évaluation seule.
 */
export function checkStatesCriterion(criterion: string, f: Fighter): boolean {
  if (!criterion) return true
  return parseStatesCriterion(criterion).test(f.states)
}

/**
 * Forme normale disjonctive (`StatesClause[]` du modèle de données, même sémantique que
 * `statesConditionMet` de src/data/criteria.ts) : vraie si au moins une clause a tous ses états `has` et aucun de
 * ses états `not`. Condition vide → `undefined` (toujours vraie) ; clauses contradictoires retirées, donc `[]`
 * signifie « jamais satisfaite ». Les termes inconnus sont ignorés (vrais).
 */
export function criterionToClauses(criterion: string): StatesClause[] | undefined {
  const p = parseStatesCriterion(criterion)
  if (p.root.kind === 'true') return undefined
  return toDnf(p.root).filter(c => !c.has.some(s => c.not.includes(s)))
}

function toDnf(n: CriterionNode): StatesClause[] {
  switch (n.kind) {
    case 'true':
    case 'unknown':
      return [{ has: [], not: [] }]
    case 'state':
      return [n.has ? { has: [n.stateId], not: [] } : { has: [], not: [n.stateId] }]
    case 'or':
      return n.items.flatMap(toDnf)
    case 'and': {
      let acc: StatesClause[] = [{ has: [], not: [] }]
      for (const item of n.items) {
        const next: StatesClause[] = []
        for (const a of acc)
          for (const b of toDnf(item)) next.push({ has: unique([...a.has, ...b.has]), not: unique([...a.not, ...b.not]) })
        acc = next
      }
      return acc
    }
  }
}

function unique(xs: number[]): number[] {
  return [...new Set(xs)]
}

/** Évalue une condition en forme normale disjonctive (`undefined` → vraie ; `[]` → jamais satisfaite). */
export function checkStatesClauses(clauses: readonly StatesClause[] | undefined, states: readonly number[]): boolean {
  if (!clauses) return true
  for (const c of clauses) {
    let ok = true
    for (let k = 0; ok && k < c.has.length; k++) if (!states.includes(c.has[k])) ok = false
    for (let k = 0; ok && k < c.not.length; k++) if (states.includes(c.not[k])) ok = false
    if (ok) return true
  }
  return false
}

// ═════════════════════════════ triggers ═════════════════════════════

/** Famille d'événement d'un déclencheur. */
export type TriggerEventKind =
  | 'instant'
  // subis par le porteur
  | 'turnStart' | 'turnEnd'
  | 'damage' | 'pushDamage'
  | 'pushed' | 'pulled' | 'moved' | 'swapped' | 'teleported' | 'portalCrossed'
  | 'apLoss' | 'mpLoss' | 'rangeLoss'
  | 'healed' | 'lifeChanged' | 'lifePointsUpdate' | 'shieldHit'
  | 'death' | 'dispelled'
  | 'stateGained' | 'stateLost' | 'stateActivated'
  | 'threshold' | 'invisibleOn' | 'invisibleOff'
  | 'entityDied' | 'entityCount'
  | 'tackled' | 'spellReflected'
  // causés par le porteur
  | 'kill' | 'criticalHit' | 'summon' | 'giveHeal' | 'giveShield' | 'dealDamage' | 'dispel'
  | 'apRemovalAttempt' | 'mpRemovalAttempt' | 'apRemovalSuccess' | 'mpRemovalSuccess'
  | 'causePushDamage' | 'moveEntity' | 'entityPortal' | 'spellThroughPortal' | 'damageThroughPortal'
  | 'mpUsed' | 'apUsed' | 'tackle'

export interface TriggerDescriptor {
  /** Jeton brut (ex. 'XDM', 'EON98', 'EK:a,F2992'). */
  raw: string
  /** Code de base, sans préfixe X ni paramètre (ex. 'DM', 'EON', 'EK', 'TR', 'KHE'). */
  code: string
  event: TriggerEventKind
  /** 'bearer' : événement subi par le porteur ; 'caster' : événement causé par le porteur (codes C…, K…). */
  side: 'bearer' | 'caster'
  /** Préfixe X : déclenche aussi si l'événement tue le porteur. */
  lethal: boolean
  /** Élément des dommages (0 neutre, 1 terre, 2 feu, 3 eau, 4 air). */
  element?: number
  /** Camp de l'auteur (dommages subis) ou de la victime (dommages causés / mise à mort) relativement au porteur. */
  relation?: 'ally' | 'enemy'
  /** Portée : mêlée (distance ≤ 1) ou distance. */
  range?: 'melee' | 'ranged'
  /** Origine des dommages : sort, arme, glyphe, piège, invocation, début/fin de tour (poisons). */
  source?: 'spell' | 'weapon' | 'glyph' | 'trap' | 'summon' | 'turnStart' | 'turnEnd'
  /** Seulement sur coup critique. */
  critical?: boolean
  /** Type de la victime (K<type><camp>) : joueur, monstre, invocation. */
  victimType?: 'human' | 'monster' | 'summon'
  stateId?: number
  spellId?: number
  /** EK / EC : masque des entités comptées. */
  mask?: string
  /** EC : comparaison du nombre d'entités. */
  compare?: { op: '=' | '>' | '<' | '!'; value: number }
  /** Effet appliqué une fois par PM utilisé (CCMPARR...). */
  perMp?: boolean
  /** Sens non confirmé (meilleure estimation). */
  uncertain?: boolean
  /** Libellé français. */
  label: string
}

export interface ParsedTriggers {
  raw: string
  /** Effet instantané (aucun déclencheur, ou 'I'). */
  instant: boolean
  triggers: TriggerDescriptor[]
  /** Jetons non reconnus. */
  unknown: string[]
}

type Base = Omit<TriggerDescriptor, 'raw' | 'code' | 'lethal'>
const E = { N: 0, E: 1, F: 2, W: 3, A: 4 } as const

/** Table des codes simples (sans paramètre ni préfixe X). */
const TRIGGER_TABLE: Record<string, Base> = {
  I: { event: 'instant', side: 'bearer', label: 'instantané' },
  TB: { event: 'turnStart', side: 'bearer', label: 'début du tour du porteur' },
  TE: { event: 'turnEnd', side: 'bearer', label: 'fin du tour du porteur' },
  // Dommages subis
  D: { event: 'damage', side: 'bearer', label: 'dommages subis (hors poussée)' },
  DN: { event: 'damage', side: 'bearer', element: E.N, label: 'dommages Neutre subis' },
  DE: { event: 'damage', side: 'bearer', element: E.E, label: 'dommages Terre subis' },
  DF: { event: 'damage', side: 'bearer', element: E.F, label: 'dommages Feu subis' },
  DW: { event: 'damage', side: 'bearer', element: E.W, label: 'dommages Eau subis' },
  DA: { event: 'damage', side: 'bearer', element: E.A, label: 'dommages Air subis' },
  DBA: { event: 'damage', side: 'bearer', relation: 'ally', label: "dommages subis d'un allié" },
  DBE: { event: 'damage', side: 'bearer', relation: 'enemy', label: "dommages subis d'un ennemi" },
  DCCBA: { event: 'damage', side: 'bearer', relation: 'ally', critical: true, label: "dommages critiques subis d'un allié" },
  DCCBE: { event: 'damage', side: 'bearer', relation: 'enemy', critical: true, label: "dommages critiques subis d'un ennemi" },
  DM: { event: 'damage', side: 'bearer', range: 'melee', label: 'dommages subis en mêlée' },
  DR: { event: 'damage', side: 'bearer', range: 'ranged', label: 'dommages subis à distance' },
  DS: { event: 'damage', side: 'bearer', source: 'spell', label: 'dommages de sort subis (hors déclenchement)' },
  DCAC: { event: 'damage', side: 'bearer', source: 'weapon', label: "dommages d'arme subis" },
  DC: { event: 'damage', side: 'bearer', source: 'weapon', label: "dommages d'arme subis (Dofus 2)" },
  DG: { event: 'damage', side: 'bearer', source: 'glyph', label: 'dommages de glyphe subis' },
  DT: { event: 'damage', side: 'bearer', source: 'trap', label: 'dommages de piège subis' },
  DI: { event: 'damage', side: 'bearer', source: 'summon', label: "dommages subis d'une invocation" },
  DTB: { event: 'damage', side: 'bearer', source: 'turnStart', label: 'dommages subis en début de tour (poison)' },
  DTE: { event: 'damage', side: 'bearer', source: 'turnEnd', label: 'dommages subis en fin de tour (poison)' },
  DV: { event: 'damage', side: 'bearer', uncertain: true, label: 'dommages « de vie » subis (INCERTAIN)' },
  PD: { event: 'pushDamage', side: 'bearer', label: 'dommages de poussée subis' },
  PMD: { event: 'pushDamage', side: 'bearer', range: 'melee', label: 'dommages de poussée subis (poussée au contact)' },
  PPD: { event: 'pushDamage', side: 'bearer', label: 'dommages de poussée subis (variante)' },
  // Déplacements subis
  P: { event: 'pushed', side: 'bearer', label: 'poussé' },
  MA: { event: 'pulled', side: 'bearer', label: 'attiré' },
  M: { event: 'moved', side: 'bearer', label: 'déplacé (poussé, attiré, échangé, téléporté)' },
  MS: { event: 'swapped', side: 'bearer', label: 'échange de position' },
  TP: { event: 'teleported', side: 'bearer', label: 'téléporté' },
  PT: { event: 'portalCrossed', side: 'bearer', label: 'traverse un portail' },
  // Pertes
  APA: { event: 'apLoss', side: 'bearer', label: 'perd des PA' },
  MPA: { event: 'mpLoss', side: 'bearer', label: 'perd des PM (ou tentative de retrait)' },
  R: { event: 'rangeLoss', side: 'bearer', label: 'perd de la portée' },
  // Vie
  H: { event: 'healed', side: 'bearer', label: 'soigné (hors vol de vie)' },
  V: { event: 'lifeChanged', side: 'bearer', label: 'PV affectés' },
  VA: { event: 'lifeChanged', side: 'bearer', label: 'PV actuels modifiés' },
  VM: { event: 'lifeChanged', side: 'bearer', label: 'PV max modifiés' },
  VE: { event: 'lifeChanged', side: 'bearer', label: 'PV érodés modifiés' },
  LPU: { event: 'lifePointsUpdate', side: 'bearer', label: 'mise à jour des PV (vitalité)' },
  S: { event: 'shieldHit', side: 'bearer', label: 'bouclier touché' },
  X: { event: 'death', side: 'bearer', label: 'mort du porteur' },
  DIS: { event: 'dispelled', side: 'bearer', label: 'désenvoûté' },
  ION: { event: 'invisibleOn', side: 'bearer', label: 'devient invisible' },
  IOFF: { event: 'invisibleOff', side: 'bearer', label: 'redevient visible' },
  OEION: { event: 'invisibleOn', side: 'bearer', uncertain: true, label: "fin d'effet : devient invisible (INCERTAIN)" },
  OEIOFF: { event: 'invisibleOff', side: 'bearer', uncertain: true, label: "fin d'effet : redevient visible (INCERTAIN)" },
  T: { event: 'tackled', side: 'bearer', uncertain: true, label: 'taclé (INCERTAIN)' },
  SREF: { event: 'spellReflected', side: 'bearer', uncertain: true, label: 'sort renvoyé (INCERTAIN)' },
  // Causés par le porteur
  K: { event: 'kill', side: 'caster', label: 'le porteur tue' },
  KWW: { event: 'kill', side: 'caster', source: 'weapon', label: 'le porteur tue avec une arme' },
  KWS: { event: 'kill', side: 'caster', source: 'spell', label: 'le porteur tue avec un sort' },
  CC: { event: 'criticalHit', side: 'caster', label: 'le porteur fait un coup critique' },
  CI: { event: 'summon', side: 'caster', label: 'le porteur invoque' },
  CH: { event: 'giveHeal', side: 'caster', label: 'le porteur soigne' },
  CS: { event: 'giveShield', side: 'caster', label: 'le porteur donne un bouclier' },
  CD: { event: 'dealDamage', side: 'caster', label: 'le porteur occasionne des dommages' },
  CDN: { event: 'dealDamage', side: 'caster', element: E.N, label: 'le porteur occasionne des dommages Neutre' },
  CDE: { event: 'dealDamage', side: 'caster', element: E.E, label: 'le porteur occasionne des dommages Terre' },
  CDF: { event: 'dealDamage', side: 'caster', element: E.F, label: 'le porteur occasionne des dommages Feu' },
  CDW: { event: 'dealDamage', side: 'caster', element: E.W, label: 'le porteur occasionne des dommages Eau' },
  CDA: { event: 'dealDamage', side: 'caster', element: E.A, label: 'le porteur occasionne des dommages Air' },
  CDBA: { event: 'dealDamage', side: 'caster', relation: 'ally', label: 'le porteur occasionne des dommages à un allié' },
  CDBE: { event: 'dealDamage', side: 'caster', relation: 'enemy', label: 'le porteur occasionne des dommages à un ennemi' },
  CDCCBA: { event: 'dealDamage', side: 'caster', relation: 'ally', critical: true, label: 'le porteur occasionne des dommages critiques à un allié' },
  CDCCBE: { event: 'dealDamage', side: 'caster', relation: 'enemy', critical: true, label: 'le porteur occasionne des dommages critiques à un ennemi' },
  CDM: { event: 'dealDamage', side: 'caster', range: 'melee', label: 'le porteur occasionne des dommages en mêlée' },
  CDR: { event: 'dealDamage', side: 'caster', range: 'ranged', label: 'le porteur occasionne des dommages à distance' },
  CDCAC: { event: 'dealDamage', side: 'caster', source: 'weapon', label: 'le porteur occasionne des dommages avec une arme' },
  CDS: { event: 'dealDamage', side: 'caster', source: 'spell', label: 'le porteur occasionne des dommages avec un sort' },
  CDG: { event: 'dealDamage', side: 'caster', source: 'glyph', label: 'le porteur occasionne des dommages via un glyphe' },
  CDT: { event: 'dealDamage', side: 'caster', source: 'trap', label: 'le porteur occasionne des dommages via un piège' },
  CDIS: { event: 'dispel', side: 'caster', label: 'le porteur désenvoûte' },
  CAPA: { event: 'apRemovalAttempt', side: 'caster', label: 'le porteur tente un retrait de PA' },
  CMPA: { event: 'mpRemovalAttempt', side: 'caster', label: 'le porteur tente un retrait de PM' },
  CAPAS: { event: 'apRemovalSuccess', side: 'caster', label: 'le porteur réussit un retrait de PA' },
  CMPAS: { event: 'mpRemovalSuccess', side: 'caster', label: 'le porteur réussit un retrait de PM' },
  CPD: { event: 'causePushDamage', side: 'caster', label: 'le porteur occasionne des dommages de poussée' },
  PO: { event: 'moveEntity', side: 'caster', label: 'le porteur déplace une entité' },
  CPT: { event: 'entityPortal', side: 'caster', uncertain: true, label: 'une entité traverse un portail du porteur (INCERTAIN)' },
  PST: { event: 'spellThroughPortal', side: 'caster', label: 'sort lancé à travers un portail' },
  PDT: { event: 'damageThroughPortal', side: 'caster', label: 'dommages à travers un portail' },
  CION: { event: 'invisibleOn', side: 'caster', label: 'le porteur devient invisible' },
  CIOFF: { event: 'invisibleOff', side: 'caster', label: 'le porteur redevient visible' },
  CCMPARR: { event: 'mpUsed', side: 'caster', perMp: true, label: 'pour chaque PM utilisé par le porteur' },
  CMPARR: { event: 'mpUsed', side: 'caster', perMp: true, uncertain: true, label: 'pour chaque PM utilisé par le lanceur du buff (INCERTAIN)' },
  CMPDEP: { event: 'mpUsed', side: 'caster', uncertain: true, label: 'le porteur dépense des PM (INCERTAIN)' },
  CCMPDEP: { event: 'mpUsed', side: 'caster', perMp: true, uncertain: true, label: 'pour chaque PM dépensé par le porteur (INCERTAIN)' },
  CAP: { event: 'apUsed', side: 'caster', uncertain: true, label: 'le porteur utilise des PA (INCERTAIN)' },
  CT: { event: 'tackle', side: 'caster', uncertain: true, label: 'le porteur tacle (INCERTAIN)' },
}

const VICTIM_TYPES: Record<string, TriggerDescriptor['victimType']> = { H: 'human', M: 'monster', I: 'summon' }
const triggersCache = new Map<string, ParsedTriggers>()

/** Analyse (avec cache) une chaîne de déclencheurs `triggers` (ex. "D|XD", "EON98", "I"). */
export function parseTriggers(triggers: string | null | undefined): ParsedTriggers {
  const raw = triggers ?? ''
  let p = triggersCache.get(raw)
  if (!p) {
    const list: TriggerDescriptor[] = []
    const unknown: string[] = []
    for (const part of raw.split('|')) {
      const tok = part.trim()
      if (!tok) continue
      const d = parseTrigger(tok)
      if (d) list.push(d)
      else unknown.push(tok)
    }
    const instant = !list.length || list.every(t => t.event === 'instant')
    p = { raw, instant, triggers: list, unknown }
    triggersCache.set(raw, p)
  }
  return p
}

/** Analyse un seul code de déclencheur ; null si inconnu. */
export function parseTrigger(token: string): TriggerDescriptor | null {
  const tok = token.trim()
  if (!tok) return null
  const simple = TRIGGER_TABLE[tok]
  if (simple) return { raw: tok, code: tok, lethal: false, ...simple }
  // Préfixe X : même déclencheur, valable aussi si l'événement tue le porteur.
  if (tok.length > 1 && tok[0] === 'X') {
    const inner = parseTrigger(tok.slice(1))
    if (inner && inner.event !== 'instant' && !inner.lethal) return { ...inner, raw: tok, lethal: true }
  }
  let m: RegExpExecArray | null
  if ((m = /^(EON|EOFF|EACT)(\d+)$/.exec(tok))) {
    const event = m[1] === 'EON' ? 'stateGained' : m[1] === 'EOFF' ? 'stateLost' : 'stateActivated'
    const label = m[1] === 'EON' ? `gagne l'état ${m[2]}` : m[1] === 'EOFF' ? `perd l'état ${m[2]}` : `état ${m[2]} activé (INCERTAIN)`
    return { raw: tok, code: m[1], lethal: false, event, side: 'bearer', stateId: Number(m[2]), label, ...(m[1] === 'EACT' ? { uncertain: true } : {}) }
  }
  if ((m = /^TR(\d*)$/.exec(tok))) {
    return {
      raw: tok,
      code: 'TR',
      lethal: false,
      event: 'threshold',
      side: 'bearer',
      ...(m[1] ? { spellId: Number(m[1]) } : {}),
      label: m[1] ? `seuil de PV du buff du sort ${m[1]} atteint` : 'seuil de PV atteint',
    }
  }
  if ((m = /^K([HMI])([EA])$/.exec(tok))) {
    return {
      raw: tok,
      code: tok,
      lethal: false,
      event: 'kill',
      side: 'caster',
      victimType: VICTIM_TYPES[m[1]],
      relation: m[2] === 'E' ? 'enemy' : 'ally',
      uncertain: true,
      label: `mise à mort d'un ${m[1] === 'H' ? 'joueur' : m[1] === 'M' ? 'monstre' : 'invocation'} ${m[2] === 'E' ? 'ennemi' : 'allié'} (INCERTAIN)`,
    }
  }
  if ((m = /^EK:(.+)$/.exec(tok))) {
    return { raw: tok, code: 'EK', lethal: false, event: 'entityDied', side: 'bearer', mask: m[1], uncertain: true, label: `une entité « ${m[1]} » meurt (INCERTAIN)` }
  }
  if ((m = /^EC:([=><!])(\d+):(.+)$/.exec(tok))) {
    return {
      raw: tok,
      code: 'EC',
      lethal: false,
      event: 'entityCount',
      side: 'bearer',
      compare: { op: m[1] as '=' | '>' | '<' | '!', value: Number(m[2]) },
      mask: m[3],
      uncertain: true,
      label: `nombre d'entités « ${m[3]} » ${m[1]} ${m[2]} (INCERTAIN)`,
    }
  }
  return null
}

/** L'effet est-il instantané (déclencheurs absents ou 'I') ? */
export function isInstantTriggers(triggers: string | null | undefined): boolean {
  return parseTriggers(triggers).instant
}
