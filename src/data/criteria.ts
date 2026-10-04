/**
 * Conditions d'états des sorts (`spell-levels.statesCriterion`) : condition sur les états du LANCEUR.
 *
 * Grammaire DofusDB (docs/research/dofusdb-api.md §2.4, zone-and-mask-grammar.json#/statesCriterion) :
 *   expr := term ('|' term)* ; term := factor ('&' factor)* ; factor := atome | '(' expr ')'
 *   atome := 'HS=' id (le lanceur a l'état) | 'HS!' id (le lanceur n'a pas l'état)
 * `&` est prioritaire sur `|` (aucune donnée ne mélange les deux sans parenthèses). La forme runtime
 * documentée dans SpellLevelData (`E123&e456`) est aussi acceptée.
 *
 * La condition est compilée une fois (au chargement) en forme normale disjonctive (`StatesClause[]`) pour
 * être évaluée sans allocation pendant les simulations.
 */
import type { StatesClause } from './model'

/** Réécrit `HS=x` -> `Ex` et `HS!x` -> `ex` (format runtime de SpellLevelData.statesCriterion). */
export function normalizeStatesCriterion(raw: string): string {
  if (!raw) return ''
  return raw.replace(/\s+/g, '').replace(/HS([=!])(\d+)/g, (_, op: string, id: string) => (op === '=' ? 'E' : 'e') + id)
}

type Token = '(' | ')' | '&' | '|' | { has: boolean; state: number }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  const re = /(HS[=!]|[Ee])(\d+)|([()&|])/y
  let pos = 0
  while (pos < src.length) {
    if (/\s/.test(src[pos])) {
      pos++
      continue
    }
    re.lastIndex = pos
    const m = re.exec(src)
    if (!m) throw new Error(`Condition d'états invalide : "${src}" (position ${pos})`)
    if (m[3]) out.push(m[3] as '(' | ')' | '&' | '|')
    else out.push({ has: m[1] === 'HS=' || m[1] === 'E', state: Number(m[2]) })
    pos = re.lastIndex
  }
  return out
}

/** Produit ET de deux formes disjonctives (clauses contradictoires supprimées). */
function and(a: StatesClause[], b: StatesClause[]): StatesClause[] {
  const out: StatesClause[] = []
  for (const x of a)
    for (const y of b) {
      const has = union(x.has, y.has)
      const not = union(x.not, y.not)
      if (has.some(s => not.includes(s))) continue
      out.push({ has, not })
    }
  return out
}

function union(a: number[], b: number[]): number[] {
  const out = a.slice()
  for (const v of b) if (!out.includes(v)) out.push(v)
  return out
}

/**
 * Compile une condition d'états en forme disjonctive.
 * Retourne `undefined` si la condition est vide (toujours satisfaite) ; un tableau vide signifie
 * « jamais satisfaite » (toutes les clauses sont contradictoires). Lève une erreur si la syntaxe est invalide.
 */
export function parseStatesCriterion(criterion: string): StatesClause[] | undefined {
  if (!criterion || !criterion.trim()) return undefined
  const tokens = tokenize(criterion)
  let i = 0
  const fail = (): never => {
    throw new Error(`Condition d'états invalide : "${criterion}"`)
  }
  const factor = (): StatesClause[] => {
    const t = tokens[i++]
    if (t === '(') {
      const e = expr()
      if (tokens[i++] !== ')') fail()
      return e
    }
    if (t === undefined || typeof t === 'string') return fail()
    return [t.has ? { has: [t.state], not: [] } : { has: [], not: [t.state] }]
  }
  const term = (): StatesClause[] => {
    let acc = factor()
    while (tokens[i] === '&') {
      i++
      acc = and(acc, factor())
    }
    return acc
  }
  const expr = (): StatesClause[] => {
    const acc = term()
    while (tokens[i] === '|') {
      i++
      acc.push(...term())
    }
    return acc
  }
  const result = expr()
  if (i !== tokens.length) fail()
  return result
}

/** Évalue une condition compilée sur les états d'un combattant (`undefined` = toujours vraie). */
export function statesConditionMet(condition: readonly StatesClause[] | undefined, states: readonly number[]): boolean {
  if (!condition) return true
  for (let c = 0; c < condition.length; c++) {
    const clause = condition[c]
    let ok = true
    for (let k = 0; ok && k < clause.has.length; k++) if (!states.includes(clause.has[k])) ok = false
    for (let k = 0; ok && k < clause.not.length; k++) if (states.includes(clause.not[k])) ok = false
    if (ok) return true
  }
  return false
}

/** États cités par une condition compilée (pour la fermeture des lots de données). */
export function statesOfCondition(condition: readonly StatesClause[] | undefined): number[] {
  const out: number[] = []
  if (condition)
    for (const c of condition) for (const s of [...c.has, ...c.not]) if (!out.includes(s)) out.push(s)
  return out
}
