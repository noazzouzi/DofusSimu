/**
 * Conditions d'équipement des objets (`criterions` DofusDB, ex. "CA>299&CS>299", "CP<12|CM<6", "Pk<3").
 *
 * Grammaire (docs/research/equipment.md §6) : expression booléenne avec `&` (ET), `|` (OU) et parenthèses ;
 * atome = `<code sur 2 caractères><opérateur><valeur>`, l'opérateur étant le 3ᵉ caractère (parse client D2) :
 * `>` `<` (comparaisons STRICTES), `=`, `!` (différent), `~` (égal souple) ; opérateurs rares (`#`, `s`, `e`, …) non
 * interprétés. `&` est prioritaire sur `|` (les données mettent toujours des parenthèses quand ils sont mélangés).
 *
 * Sémantique retenue (§6.3, politique « état final ») : les caractéristiques comparées sont les totaux BRUTS du stuff
 * complet (avant plafonds 12 PA / 6 PM, objet évalué inclus). Codes non statistiques :
 *  - `PZ` (abonné), quêtes `Q*`, métiers `PJ`/`Pj`, succès `Oa` : vrais par défaut (profil joueur) ;
 *  - `PG` (classe), `PL` (niveau) évalués ; `PS` (sexe), `Ps`/`Pa` (alignement) évalués si le profil les fournit ;
 *  - `BI`, `PX`, `PN`, `Pm`, `Sc`, `SG`, `Sd`, `OS`, `PO`, `PK`, `PE` : faux (objets d'événement, nominatifs,
 *    inutilisables…) ;
 *  - code inconnu : vrai, signalé dans `unknown`.
 *
 * Les expressions sont analysées une seule fois (cache par chaîne).
 */
import type { Stats } from '../core/types'
import type { PrimaryStat, PrimaryStatRecord } from './characteristicPoints'

export interface CriterionAtom {
  kind: 'atom'
  /** Texte source de l'atome (ex. "CA>299"). */
  text: string
  code: string
  op: string
  value: string
  /** Valeur numérique (NaN si non numérique, ex. "PX=A", "PJ>2,40"). */
  num: number
}

export interface CriterionGroup {
  kind: 'and' | 'or'
  children: CriterionNode[]
}

export type CriterionNode = CriterionAtom | CriterionGroup | { kind: 'true' }

/** Profil du joueur pour les conditions non statistiques. */
export interface ConditionProfile {
  /** Sexe (0 = masculin, 1 = féminin) pour `PS` ; absent ⇒ condition vraie. */
  sex?: number
  /** Alignement (1 Bonta, 2 Brâkmar) pour `Ps` ; absent ⇒ vrai. */
  alignment?: number
  /** Niveau d'alignement pour `Pa` ; absent ⇒ vrai. */
  alignmentLevel?: number
  /** Abonné (`PZ`) — défaut vrai. */
  subscriber?: boolean
  /** Quêtes, métiers et succès accomplis (`Q*`, `PJ`, `Pj`, `Oa`) — défaut vrai. */
  progression?: boolean
}

/** État évalué par les conditions : totaux bruts du stuff (avant plafonds, sans stats dérivées). */
export interface CriterionContext {
  /** Sommes brutes : base + parchemins + objets + panoplies + exos ; PA/PM incluent la base 6-7/3. */
  raw: Stats
  /** Valeurs de base (points investis). */
  base: PrimaryStatRecord
  /** Valeurs additionnelles (parchemins). */
  additional: PrimaryStatRecord
  level: number
  breedId: number
  /** Nombre de bonus de panoplie actifs (`Pk`) = Σ max(0, n − 1). */
  setBonusCount: number
  profile?: ConditionProfile
}

const TRUE_NODE: CriterionNode = { kind: 'true' }

// ───────────────────────────── analyse ─────────────────────────────

const cache = new Map<string, CriterionNode>()

/** Analyse (avec cache) une chaîne de conditions. Une chaîne vide donne un nœud toujours vrai. */
export function parseCriterion(expr: string): CriterionNode {
  let node = cache.get(expr)
  if (!node) {
    node = new Parser(expr).parse()
    cache.set(expr, node)
  }
  return node
}

class Parser {
  private pos = 0
  constructor(private readonly src: string) {}

  parse(): CriterionNode {
    this.skipSpaces()
    if (this.pos >= this.src.length) return TRUE_NODE
    const node = this.parseOr()
    this.skipSpaces()
    if (this.pos < this.src.length) throw new Error(`Condition invalide « ${this.src} » (position ${this.pos})`)
    return node
  }

  private skipSpaces(): void {
    while (this.pos < this.src.length && this.src[this.pos] === ' ') this.pos++
  }

  private parseOr(): CriterionNode {
    const children = [this.parseAnd()]
    this.skipSpaces()
    while (this.src[this.pos] === '|') {
      this.pos++
      children.push(this.parseAnd())
      this.skipSpaces()
    }
    return children.length === 1 ? children[0] : { kind: 'or', children }
  }

  private parseAnd(): CriterionNode {
    const children = [this.parseFactor()]
    this.skipSpaces()
    while (this.src[this.pos] === '&') {
      this.pos++
      children.push(this.parseFactor())
      this.skipSpaces()
    }
    return children.length === 1 ? children[0] : { kind: 'and', children }
  }

  private parseFactor(): CriterionNode {
    this.skipSpaces()
    if (this.src[this.pos] === '(') {
      this.pos++
      const inner = this.parseOr()
      this.skipSpaces()
      if (this.src[this.pos] !== ')') throw new Error(`Parenthèse manquante dans « ${this.src} »`)
      this.pos++
      return inner
    }
    const start = this.pos
    while (this.pos < this.src.length && !'&|()'.includes(this.src[this.pos])) this.pos++
    const text = this.src.slice(start, this.pos).trim()
    if (text.length < 3) throw new Error(`Atome de condition invalide « ${text} » dans « ${this.src} »`)
    const value = text.slice(3)
    return { kind: 'atom', text, code: text.slice(0, 2), op: text[2], value, num: value === '' ? NaN : Number(value) }
  }
}

// ───────────────────────────── évaluation ─────────────────────────────

/** Codes de caractéristiques primaires (2ᵉ lettre majuscule = total, minuscule = base ; `c?` minuscule = parchemins). */
const PRIMARY_CODES: Readonly<Record<string, PrimaryStat>> = {
  A: 'agility',
  C: 'chance',
  I: 'intelligence',
  S: 'strength',
  V: 'vitality',
  W: 'wisdom',
}

/** Codes toujours faux (objets d'événement, nominatifs, inutilisables, temporaires). */
const ALWAYS_FALSE: ReadonlySet<string> = new Set(['BI', 'PX', 'PN', 'Pm', 'Sc', 'SG', 'Sd', 'OS', 'PO', 'PK', 'PE'])
/** Codes de progression du joueur (quêtes, métiers, succès). */
const PROGRESSION: ReadonlySet<string> = new Set(['Qa', 'Qf', 'Qc', 'Qo', 'PJ', 'Pj', 'Oa'])

function compare(actual: number, op: string, expected: number): boolean | undefined {
  switch (op) {
    case '>':
      return actual > expected
    case '<':
      return actual < expected
    case '=':
    case '~':
      return actual === expected
    case '!':
      return actual !== expected
    default:
      return undefined
  }
}

/**
 * Valeur numérique d'un code de caractéristique pour le contexte, ou `undefined` si le code n'est pas
 * une caractéristique/un attribut numérique évaluable.
 */
export function criterionValue(code: string, ctx: CriterionContext): number | undefined {
  const raw = ctx.raw
  if (code.length === 2 && (code[0] === 'C' || code[0] === 'c')) {
    const primary = PRIMARY_CODES[code[1].toUpperCase()]
    if (primary) {
      if (code[0] === 'c') return ctx.additional[primary]
      return code[1] === code[1].toUpperCase() ? raw[primary] : ctx.base[primary]
    }
    switch (code) {
      case 'CP':
        return raw.ap
      case 'CM':
        return raw.mp
      // Tacle / Fuite totaux = ⌊Agilité/10⌋ + bonus (arrondi inférieur, comme finalizeStats).
      case 'CT':
        return Math.floor(raw.agility / 10) + raw.tackleBlock
      case 'Ct':
        return Math.floor(raw.agility / 10) + raw.tackleEvade
    }
    return undefined
  }
  switch (code) {
    case 'Pk':
      return ctx.setBonusCount
    case 'PL':
      return ctx.level
    case 'PG':
      return ctx.breedId
  }
  return undefined
}

function evalAtom(atom: CriterionAtom, ctx: CriterionContext, unknown?: Set<string>): boolean {
  const { code, op } = atom
  if (ALWAYS_FALSE.has(code)) return false
  const profile = ctx.profile
  if (PROGRESSION.has(code)) return profile?.progression ?? true
  let actual: number | undefined
  switch (code) {
    case 'PZ':
      actual = (profile?.subscriber ?? true) ? 1 : 0
      break
    case 'PS':
      actual = profile?.sex
      if (actual === undefined) return true
      break
    case 'Ps':
      actual = profile?.alignment
      if (actual === undefined) return true
      break
    case 'Pa':
      actual = profile?.alignmentLevel
      if (actual === undefined) return true
      break
    default:
      actual = criterionValue(code, ctx)
  }
  if (actual === undefined || Number.isNaN(atom.num)) {
    unknown?.add(atom.text)
    return true
  }
  const result = compare(actual, op, atom.num)
  if (result === undefined) {
    unknown?.add(atom.text)
    return true
  }
  return result
}

function evalNode(node: CriterionNode, ctx: CriterionContext, unknown?: Set<string>): boolean {
  switch (node.kind) {
    case 'true':
      return true
    case 'atom':
      return evalAtom(node, ctx, unknown)
    case 'and':
      for (const c of node.children) if (!evalNode(c, ctx, unknown)) return false
      return true
    case 'or':
      for (const c of node.children) if (evalNode(c, ctx, unknown)) return true
      return false
  }
}

/**
 * Évalue une condition d'objet. Les atomes non interprétables (code ou opérateur inconnu) sont considérés
 * comme vrais et ajoutés à `unknown` s'il est fourni.
 */
export function evaluateCriterion(expr: string | CriterionNode, ctx: CriterionContext, unknown?: Set<string>): boolean {
  return evalNode(typeof expr === 'string' ? parseCriterion(expr) : expr, ctx, unknown)
}

/** Liste des atomes d'une condition (ordre d'apparition). */
export function criterionAtoms(expr: string | CriterionNode): CriterionAtom[] {
  const out: CriterionAtom[] = []
  const walk = (n: CriterionNode): void => {
    if (n.kind === 'atom') out.push(n)
    else if (n.kind !== 'true') n.children.forEach(walk)
  }
  walk(typeof expr === 'string' ? parseCriterion(expr) : expr)
  return out
}

const CODE_NAMES_FR: Readonly<Record<string, string>> = {
  CA: 'Agilité',
  CC: 'Chance',
  CI: 'Intelligence',
  CS: 'Force',
  CV: 'Vitalité',
  CW: 'Sagesse',
  CP: 'PA',
  CM: 'PM',
  CT: 'Tacle',
  Ct: 'Fuite',
  Pk: 'bonus de panoplie',
  PL: 'niveau',
  PG: 'classe',
}

/** Explication lisible des atomes faux d'une condition (ex. "CA>299 (Agilité = 250)"). */
export function explainCriterion(expr: string | CriterionNode, ctx: CriterionContext): string[] {
  const out: string[] = []
  for (const atom of criterionAtoms(expr)) {
    if (evalAtom(atom, ctx)) continue
    const actual = criterionValue(atom.code, ctx)
    const name = CODE_NAMES_FR[atom.code]
    out.push(actual !== undefined && name ? `${atom.text} (${name} = ${actual})` : atom.text)
  }
  return out
}
