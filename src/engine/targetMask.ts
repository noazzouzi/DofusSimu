/**
 * Masques de cibles des effets (targetMask DofusDB), ex. "a,A", "C", "g,A", "a,A,*E123", "a,P,F3112,F3113".
 *
 * Référence : port C# du code Haxe D3 (`SpellManager.IsSelectedByMask / IsIncludedByMask / PassMaskExclusion`,
 * `TargetManagement.GetTargets / GetOutOfAreaTarget`, .cache/domath/haxe/), docs/research/effects.md §5,
 * data/research/zone-and-mask-grammar.json#/targetMask.
 *
 * Jetons séparés par ',' :
 *  - INCLUSION (la cible doit vérifier au moins un jeton) — minuscule = allié du lanceur, majuscule = ennemi :
 *    a (alliés, lanceur compris s'il est dans la zone) · g (alliés sauf le lanceur) · A (ennemis) ·
 *    c (le lanceur s'il est dans la zone) · C (le lanceur, même hors zone) · h/H (joueurs non invoqués) ·
 *    l/L (joueurs non invoqués ou compagnons) · d/D (compagnons) · m/M (monstres non invoqués non statiques) ·
 *    i/I (invocations non statiques) · j/J (invocations) · s/S (invocations statiques) ·
 *    x (INCERTAIN : « case », effets d'invocation — ne sélectionne aucune entité).
 *    Le lanceur n'est inclus QUE par c, C ou a (jamais par g ni par une lettre de type).
 *  - CONDITIONS (toutes requises, ET) sur la cible, ou sur le LANCEUR si préfixées par '*' :
 *    E#/e# a / n'a pas l'état # · F#/f# est / n'est pas le monstre # · B#/b# est / n'est pas un joueur de classe # ·
 *    Z#/z# compagnon de type # · P/p « famille » du lanceur (lui, ses invocations, son invocateur, les invocations
 *    du même invocateur) / négation · K entité portée par le lanceur · O/o entité déclenchante · T téléfraguée ce
 *    tour · W téléportée sur une case invalide ce tour · U/u vient d'apparaître (u = U dans le port) ·
 *    V#/v# PV < #% / PV ≥ #% · R/r sort lancé / non lancé à travers un portail · Q/q nombre max d'invocations
 *    atteint / non atteint · PB/pb a / n'a pas de bouclier (INCERTAIN) · PR/pr INCERTAIN (rappel `custom`).
 *    Les jetons B#, F#, Z# d'une même famille forment un groupe OU (F3112,F3113 = l'un ou l'autre).
 *  - '*' + lettre d'inclusion (*h, *i, *m, *d, *j, *l, *s) : le LANCEUR est de ce type, ex. « C,*h,e3536 »
 *    (Potion Magique : le lanceur est un joueur non invoqué) — INCERTAIN ; écart assumé : le port évalue *h comme
 *    toujours vrai, gère *l et rejette les autres lettres (l'effet ne s'appliquerait jamais).
 *  - Jetons reconnus mais sans effet, comme dans le port : Sce, Atq, Def (INCERTAIN, sorts de monstres hors Vortex).
 * Masque vide : toutes les entités de la zone.
 *
 * Cibles hors zone (à ajouter par le moteur, cf. `CompiledMask.addsCaster/addsTriggering/addsCarried`) :
 * C ajoute le lanceur, O l'entité déclenchante, K l'entité portée par le lanceur.
 *
 * Performances : masques compilés une fois (cache par chaîne), évaluation sans allocation.
 */
import type { Fighter } from './types'

/** Contexte optionnel d'évaluation (informations qui ne sont pas dans `Fighter`). */
export interface MaskContext {
  /** Entité déclenchante (masques O / o) : attaquant d'un buff déclenché, etc. */
  triggering?: Fighter
  /** Le sort est lancé à travers un portail (R / r). */
  usingPortal?: boolean
  /** L'entité vient d'apparaître (invocation créée par le sort en cours) — masques U / u. */
  isAppearing?: (f: Fighter) => boolean
  /** Téléfraguée ce tour (T). Défaut : tag `telefragged` du combattant. */
  wasTelefragged?: (f: Fighter) => boolean
  /** Téléportée sur une case invalide ce tour (W). Défaut : tag `teleportedInvalid`. */
  wasTeleportedInvalid?: (f: Fighter) => boolean
  /** Nombre d'invocations actuelles de l'entité (Q / q). Défaut : 0. */
  summonCount?: (f: Fighter) => number
  /** PV « en attente » (PV après les effets déjà calculés du sort), pour V / v. Défaut : `hp`. */
  pendingHp?: (f: Fighter) => number
  /** Conditions INCERTAINES (PR / pr) : renvoie la valeur de la condition majuscule. Défaut : faux. */
  custom?: (code: string, f: Fighter) => boolean
}

const NO_CONTEXT: MaskContext = {}

// Lettres d'inclusion (bits).
const INC = {
  a: 1 << 0,
  g: 1 << 1,
  A: 1 << 2,
  c: 1 << 3,
  C: 1 << 4,
  h: 1 << 5,
  H: 1 << 6,
  l: 1 << 7,
  L: 1 << 8,
  d: 1 << 9,
  D: 1 << 10,
  m: 1 << 11,
  M: 1 << 12,
  i: 1 << 13,
  I: 1 << 14,
  j: 1 << 15,
  J: 1 << 16,
  s: 1 << 17,
  S: 1 << 18,
  x: 1 << 19,
} as const
type IncLetter = keyof typeof INC
const ALLY_TYPED = INC.h | INC.l | INC.d | INC.m | INC.i | INC.j | INC.s
const ENEMY_TYPED = INC.H | INC.L | INC.D | INC.M | INC.I | INC.J | INC.S

/** Codes de condition (après le '*' éventuel). */
export type MaskConditionCode =
  | 'E' | 'e' | 'F' | 'f' | 'B' | 'b' | 'Z' | 'z' | 'P' | 'p' | 'K' | 'O' | 'o' | 'T' | 'W' | 'U' | 'u'
  | 'V' | 'v' | 'R' | 'r' | 'Q' | 'q' | 'PB' | 'pb' | 'PR' | 'pr'
  /** '*' + lettre d'inclusion : type du lanceur. */
  | 'type'

export interface MaskCondition {
  code: MaskConditionCode
  /** Paramètre numérique (id d'état, de monstre, de classe, % de PV) ; 0 si absent. */
  value: number
  /** Porte sur le lanceur (préfixe '*'). */
  onCaster: boolean
  /** Lettre d'inclusion pour `type`. */
  letter?: string
  /** Groupe OU (familles B / F / Z) : index de groupe, −1 sinon. */
  group: number
  /** Premier membre de son groupe OU dans sa liste (le groupe y est évalué en entier). */
  groupHead?: boolean
  raw: string
}

export interface CompiledMask {
  raw: string
  /** Masque vide : toutes les entités de la zone. */
  empty: boolean
  /** Bits d'inclusion (cf. INC). */
  inclusion: number
  inclusionLetters: string[]
  /** Conditions sur le lanceur ('*'), puis sur la cible ; groupes OU regroupés. */
  casterConditions: MaskCondition[]
  targetConditions: MaskCondition[]
  /** Nombre de groupes OU (B/F/Z) parmi les conditions. */
  groupCount: number
  /** Le lanceur est ajouté comme cible même hors zone (C). */
  addsCaster: boolean
  /** L'entité déclenchante est ajoutée même hors zone (O). */
  addsTriggering: boolean
  /** L'entité portée par le lanceur est ajoutée (K). */
  addsCarried: boolean
  /**
   * Cibles à recalculer au moment de l'effet et non au lancer : jetons U, u, T, W (effects.md §2.1). Le port teste
   * aussi « V » / « v » par égalité exacte de jeton : les jetons réels V50, *v50... ne déclenchent donc PAS de
   * recalcul (INCERTAIN pour le jeu, vérification du 2026-10-04).
   */
  lateTargeting: boolean
  /** Jetons reconnus mais sans effet (Sce, Atq, Def). */
  ignored: string[]
  /** Jetons de sens INCERTAIN (x, u, PB, pb, PR, pr, Sce, Atq, Def, '*' + lettre d'inclusion hors h/l). */
  uncertain: string[]
  /** Jetons non reconnus (ignorés, comme dans le port). */
  unknown: string[]
}

const IGNORED_TOKENS = new Set(['Sce', 'Atq', 'Def'])
const CONDITION_LETTERS = 'EeFfBbZzPpKOoTWUuVvRrQq'
const OR_FAMILIES = 'BFZ'
const LATE_CODES = new Set(['U', 'u', 'T', 'W'])

const cache = new Map<string, CompiledMask>()

/** Dernier masque compilé (appels consécutifs sur le même masque : une cible après l'autre, sans recherche). */
let lastMask: string | null = null
let lastCompiled: CompiledMask | undefined

/** Compile un masque (résultat partagé et mis en cache : ne pas le modifier). */
export function compileTargetMask(mask: string): CompiledMask {
  if (mask === lastMask) return lastCompiled!
  let m = cache.get(mask)
  if (!m) {
    m = buildMask(mask)
    cache.set(mask, m)
  }
  lastMask = mask
  lastCompiled = m
  return m
}

/** Alias historique. */
export const parseTargetMask = compileTargetMask

function buildMask(mask: string): CompiledMask {
  const m: CompiledMask = {
    raw: mask,
    empty: true,
    inclusion: 0,
    inclusionLetters: [],
    casterConditions: [],
    targetConditions: [],
    groupCount: 0,
    addsCaster: false,
    addsTriggering: false,
    addsCarried: false,
    lateTargeting: false,
    ignored: [],
    uncertain: [],
    unknown: [],
  }
  const groups = new Map<string, number>()
  for (const raw of mask.split(',')) {
    const tok = raw.trim()
    if (!tok) continue
    m.empty = false
    if (IGNORED_TOKENS.has(tok)) {
      m.ignored.push(tok)
      m.uncertain.push(tok)
      continue
    }
    const onCaster = tok[0] === '*'
    const body = onCaster ? tok.slice(1) : tok
    if (!body) {
      m.unknown.push(tok)
      continue
    }
    // Inclusion (jeton d'une seule lettre, sans '*').
    if (!onCaster && body.length === 1 && body in INC) {
      m.inclusion |= INC[body as IncLetter]
      m.inclusionLetters.push(body)
      if (body === 'C') m.addsCaster = true
      if (body === 'x') m.uncertain.push(tok)
      continue
    }
    // '*' + lettre d'inclusion : type du lanceur.
    if (onCaster && body.length === 1 && body in INC && !CONDITION_LETTERS.includes(body)) {
      m.casterConditions.push({ code: 'type', value: 0, onCaster, letter: body, group: -1, raw: tok })
      m.uncertain.push(tok)
      continue
    }
    const cond = parseCondition(body, onCaster, tok)
    if (!cond) {
      m.unknown.push(tok)
      continue
    }
    if (OR_FAMILIES.includes(cond.code)) {
      const key = (onCaster ? '*' : '') + cond.code
      let g = groups.get(key)
      if (g === undefined) {
        g = groups.size
        groups.set(key, g)
      }
      cond.group = g
    }
    if (cond.code === 'u' || cond.code === 'PB' || cond.code === 'pb' || cond.code === 'PR' || cond.code === 'pr') m.uncertain.push(tok)
    if (!onCaster) {
      if (cond.code === 'O') m.addsTriggering = true
      if (cond.code === 'K') m.addsCarried = true
    }
    if (!onCaster && (LATE_CODES.has(cond.code) || ((cond.code === 'V' || cond.code === 'v') && body.length === 1))) m.lateTargeting = true
    ;(onCaster ? m.casterConditions : m.targetConditions).push(cond)
  }
  m.groupCount = groups.size
  for (const list of [m.casterConditions, m.targetConditions])
    for (let i = 0; i < list.length; i++) {
      const g = list[i].group
      if (g >= 0 && !list.slice(0, i).some(c => c.group === g)) list[i].groupHead = true
    }
  return m
}

function parseCondition(body: string, onCaster: boolean, raw: string): MaskCondition | null {
  if (body === 'PB' || body === 'pb' || body === 'PR' || body === 'pr') return { code: body, value: 0, onCaster, group: -1, raw }
  const letter = body[0]
  if (!CONDITION_LETTERS.includes(letter)) return null
  const rest = body.slice(1)
  if (rest && !/^-?\d+$/.test(rest)) return null
  return { code: letter as MaskConditionCode, value: rest ? parseInt(rest, 10) : 0, onCaster, group: -1, raw }
}

// ───────────────────────────── nature des combattants ─────────────────────────────

/** Le combattant est une invocation (ou a un invocateur). */
export function isSummoned(f: Fighter): boolean {
  return f.kind === 'summon' || f.summonerId !== undefined
}

/**
 * Invocation statique (ne joue pas : bombes, arbres, balises...) — tag `static` du combattant, ou tag
 * `canPlay: false` (drapeau `canPlay` du monstre, comme le client D2 : `!Monster.canPlay`).
 */
export function isStaticFighter(f: Fighter): boolean {
  return f.tags.static === true || f.tags.canPlay === false
}

/** Compagnon (sidekick) — non modélisé par le moteur, tag `sidekick`. */
export function isSidekick(f: Fighter): boolean {
  return f.tags.sidekick === true
}

/**
 * Type « humain » du port (PlayerType.Human) : personnage joueur, ou invocation copie de joueur (double)
 * c.-à-d. invocation avec une classe et sans id de monstre.
 */
export function isHumanType(f: Fighter): boolean {
  if (isSidekick(f)) return false
  if (f.kind === 'player') return true
  return f.kind === 'summon' && f.breedId !== undefined && f.monsterId === undefined
}

/** Le lanceur, ses invocations, son invocateur et les invocations du même invocateur (masque P). */
export function isFamily(caster: Fighter, target: Fighter): boolean {
  if (target.id === caster.id) return true
  if (target.summonerId !== undefined && target.summonerId === caster.id) return true
  if (target.summonerId !== undefined && caster.summonerId !== undefined && target.summonerId === caster.summonerId) return true
  return caster.summonerId !== undefined && caster.summonerId === target.id
}

/** Lettre d'inclusion de TYPE (h, i, m...) vérifiée par `f`, `ally` indiquant le camp relatif au lanceur. */
function typeMatches(letter: string, f: Fighter, ally: boolean): boolean {
  const lower = letter.toLowerCase()
  if ((letter === lower) !== ally) return false
  const summon = isSummoned(f)
  const human = isHumanType(f)
  const sidekick = isSidekick(f)
  switch (lower) {
    case 'a':
    case 'g':
      return true
    case 'h':
      return human && !summon
    case 'l':
      return (human && !summon) || sidekick
    case 'd':
      return sidekick
    case 'm':
      return !human && !sidekick && !summon && !isStaticFighter(f)
    case 'i':
      return !sidekick && summon && !isStaticFighter(f)
    case 'j':
      return !sidekick && summon
    case 's':
      return !sidekick && summon && isStaticFighter(f)
    default:
      return false
  }
}

/** Étape d'inclusion (`IsIncludedByMask`). */
function included(m: CompiledMask, caster: Fighter, target: Fighter): boolean {
  if (target.id === caster.id) return (m.inclusion & (INC.c | INC.C | INC.a)) !== 0
  const ally = target.team === caster.team
  const inc = m.inclusion
  if (ally) {
    if (inc & (INC.a | INC.g)) return true
    if (!(inc & ALLY_TYPED)) return false
  } else {
    if (inc & INC.A) return true
    if (!(inc & ENEMY_TYPED)) return false
  }
  for (const l of m.inclusionLetters) if (typeMatches(l, target, ally)) return true
  return false
}

function hpPercent(f: Fighter, ctx: MaskContext): number {
  const hp = ctx.pendingHp ? ctx.pendingHp(f) : f.hp
  return f.maxHp > 0 ? (hp / f.maxHp) * 100 : 0
}

/** Évalue une condition sur `who` (la cible, ou le lanceur pour '*'). */
function conditionHolds(c: MaskCondition, caster: Fighter, who: Fighter, ctx: MaskContext): boolean {
  switch (c.code) {
    case 'E':
      return who.states.includes(c.value)
    case 'e':
      return !who.states.includes(c.value)
    case 'F':
      return !isHumanType(who) && who.monsterId === c.value
    case 'f':
      return isHumanType(who) || who.monsterId !== c.value
    case 'B':
      return isHumanType(who) && who.breedId === c.value
    case 'b':
      return !isHumanType(who) || who.breedId !== c.value
    case 'Z':
      return isSidekick(who) && who.monsterId === c.value
    case 'z':
      return !isSidekick(who) || who.monsterId !== c.value
    case 'P':
      return isFamily(caster, who)
    case 'p':
      return !isFamily(caster, who)
    case 'K':
      return who.carriedBy !== undefined && who.carriedBy === caster.id
    case 'O':
    case 'o':
      return !!ctx.triggering && who.id === ctx.triggering.id
    case 'T':
      return ctx.wasTelefragged ? ctx.wasTelefragged(who) : who.tags.telefragged === true
    case 'W':
      return ctx.wasTeleportedInvalid ? ctx.wasTeleportedInvalid(who) : who.tags.teleportedInvalid === true
    case 'U':
    case 'u':
      return !!ctx.isAppearing && ctx.isAppearing(who)
    case 'V':
      return hpPercent(who, ctx) < c.value
    case 'v':
      return hpPercent(who, ctx) >= c.value
    case 'R':
      return !!ctx.usingPortal
    case 'r':
      return !ctx.usingPortal
    case 'Q':
      return (ctx.summonCount ? ctx.summonCount(who) : 0) >= who.stats.summons
    case 'q':
      return (ctx.summonCount ? ctx.summonCount(who) : 0) < who.stats.summons
    case 'PB':
      return who.shield > 0
    case 'pb':
      return who.shield <= 0
    case 'PR':
      return !!ctx.custom && ctx.custom('PR', who)
    case 'pr':
      return !ctx.custom || !ctx.custom('PR', who)
    case 'type':
      return typeMatches(c.letter!, who, true)
  }
}

/**
 * Toutes les conditions de la liste (ET), sauf les groupes OU (B# / F# / Z# de même famille) : au moins un membre
 * vrai par groupe. Sans état partagé : les rappels de `ctx` peuvent réévaluer d'autres masques (réentrance sûre).
 */
function conditionsHold(list: readonly MaskCondition[], caster: Fighter, who: Fighter, ctx: MaskContext): boolean {
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c.group < 0) {
      if (!conditionHolds(c, caster, who, ctx)) return false
    } else if (c.groupHead) {
      let any = false
      for (let j = i; j < list.length && !any; j++) if (list[j].group === c.group && conditionHolds(list[j], caster, who, ctx)) any = true
      if (!any) return false
    }
  }
  return true
}

/** Conditions portant sur le lanceur ('*') : si elles échouent, l'effet est retiré du sort (aucune cible). */
export function casterPassesMask(mask: string, caster: Fighter, ctx: MaskContext = NO_CONTEXT): boolean {
  const m = compileTargetMask(mask)
  return conditionsHold(m.casterConditions, caster, caster, ctx)
}

/**
 * La cible est-elle sélectionnée par le masque ? (conditions du lanceur, inclusion, conditions de la cible)
 * La présence dans la zone est vérifiée par l'appelant ; pour C / O / K, l'appelant ajoute aussi les cibles
 * hors zone (voir `CompiledMask.addsCaster` / `addsTriggering` / `addsCarried`).
 */
export function matchesTargetMask(mask: string, caster: Fighter, target: Fighter, ctx: MaskContext = NO_CONTEXT): boolean {
  return matchesCompiledMask(compileTargetMask(mask), caster, target, ctx)
}

/** `matchesTargetMask` sur un masque déjà compilé (`compileTargetMask`). */
export function matchesCompiledMask(m: CompiledMask, caster: Fighter, target: Fighter, ctx: MaskContext = NO_CONTEXT): boolean {
  if (m.empty) return true
  if (m.casterConditions.length && !conditionsHold(m.casterConditions, caster, caster, ctx)) return false
  if (!included(m, caster, target)) return false
  return conditionsHold(m.targetConditions, caster, target, ctx)
}
