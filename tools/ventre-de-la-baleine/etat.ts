// État exact d'un combat du Ventre de la Baleine au moment présent, tiré du journal AnkaBot (fusionné ou d'un seul
// personnage) : cases, PV, caractéristiques (Puissance comprise), ordre de jeu, tour en cours et ce qui y a déjà été
// joué, relances des sorts des Crâs, et ce que les mécaniques du donjon exigent — compte à rebours de chaque Krobe,
// éléments reçus par le Pataugerme depuis son dernier tour, Malamibe en vie et ses tours joués.
// Sert au planificateur (planificateur.ts) et au serveur de plans (calcul.ts).
import { loadStream, MSG, rebuild, type Rebuild } from '../fightlog/rejeu'
import { Truth } from '../reine-des-voleurs/planificateur/fidelite'
import { data } from '../reine-des-voleurs/planificateur/etat'
import type { Row } from '../reine-des-voleurs/planificateur/journal'
import {
  ELEMENT_STATES, ETAT, KILL_EFFECT, KROBES, MALAMIBE, STATE_ADD, baseKrobe, isKrobe,
} from './donjon'

export interface KrobeEtat {
  id: number
  base: number
  /** Dernier lancement ou relance du compte à rebours : manche, et combattant dont c'était le tour (undefined : avant le premier tour). */
  lastReset?: { round: number; during?: number }
  /** Pataugerme : éléments reçus depuis la fin de son dernier tour (états 479-482, durée 1). */
  elements: Set<string>
  /** Infection en cours (Pataugerme, Verminocule : condition remplie pour ce tour). */
  infected: boolean
}

export interface CastFait {
  spellId: number
  cell: number
  /** Combattant sur la case visée au moment du lancer (identifiant de la reconstitution). */
  target?: number
}

export interface EtatCombat {
  res: Rebuild
  truth: Truth
  mapId: number
  round: number
  /** Ordre de jeu (identifiants de la reconstitution), d'après la dernière liste des tours du serveur, sinon les tours vus. */
  order: number[]
  /** Dernière liste des tours du serveur (combattants connus de la reconstitution), s'il y en a une. */
  turnList?: number[]
  /** Combattant dont le tour est en cours (undefined entre deux tours). */
  current?: number
  /** Lancers volontaires et déplacements déjà faits pendant le tour en cours. */
  turnCasts: CastFait[]
  turnMoved: number
  /**
   * Caractéristiques du combattant actif reçues depuis le début de son tour (ex. 19, la portée : le −3 PO de Tirs
   * Puissants, posé au début du tour qui suit le lancer, n'est peut-être pas encore arrivé au serveur).
   */
  turnCaracs: Set<number>
  /** Manche du dernier lancer de chaque sort, par Crâ (relances). */
  lastCast: Map<number, Map<number, number>>
  /** Manches de tous les lancers de chaque sort, par Crâ (effets différés au tour suivant : Tirs Puissants). */
  castRounds: Map<number, Map<number, number[]>>
  krobes: Map<number, KrobeEtat>
  malamibe?: { id: number; summonRound: number; turnsPlayed: number }
  /** Pesanteur (état 7) : cible → lanceur et manche de la pose (dure jusqu'au tour suivant du lanceur). */
  pesanteur: Map<number, { caster?: number; round: number }>
}

/** Ordre de jeu de la dernière liste des tours (jvu) d'avant `upTo` : identifiants de jeu. */
function turnListGameIds(rows: Row[], upTo: number): number[] | undefined {
  for (let i = Math.min(upTo, rows.length) - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.k !== 'm' || r.n !== MSG.turnList) continue
    const list: any[] = Array.isArray(r.d?.fxlo) ? r.d.fxlo : []
    const ids = list.map(x => x?.fxkv?.fxld).filter((x): x is number => typeof x === 'number')
    if (ids.length) return ids
  }
  return undefined
}

/**
 * État du combat `which` (−1 : le dernier) d'un flux, à la fin des lignes connues. `mapId` : carte du combat (le journal
 * d'un script qui joue n'a pas de photos d'AnkaBot ; la carte vient alors du script).
 */
export function etatCombat(rows: Row[], opts: { which?: number; mapId?: number } = {}): EtatCombat {
  const res = rebuild(rows, { which: opts.which ?? -1, mapId: opts.mapId })
  const truth = new Truth(res)
  const krobes = new Map<number, KrobeEtat>()
  for (const f of res.fighters) if (f.kind !== 'player' && isKrobe(f.monsterId)) krobes.set(f.id, { id: f.id, base: baseKrobe(f.monsterId!), elements: new Set(), infected: false })
  const buffsAt = new Map<number, Rebuild['buffs']>()
  for (const b of res.buffs) {
    const l = buffsAt.get(b.ev)
    if (l) l.push(b)
    else buffsAt.set(b.ev, [b])
  }
  let round = 0
  let current: number | undefined
  let turnCasts: CastFait[] = []
  let turnMoved = 0
  let turnStartEv = -1
  const lastCast = new Map<number, Map<number, number>>()
  const castRounds = new Map<number, Map<number, number[]>>()
  const seenOrder: number[] = []
  let malamibe: EtatCombat['malamibe']
  const pesanteur = new Map<number, { caster?: number; round: number }>()
  const ev = res.replay.events
  for (let i = 0; i < ev.length; i++) {
    truth.caracBefore(i)
    const e = ev[i]
    truth.apply(e)
    switch (e.t) {
      case 'roundStart':
        round = e.round
        break
      case 'turnStart': {
        current = e.fighter
        turnCasts = []
        turnMoved = 0
        turnStartEv = i
        if (!seenOrder.includes(e.fighter)) seenOrder.push(e.fighter)
        if (malamibe && e.fighter === malamibe.id) malamibe.turnsPlayed++
        // Pesanteur posée par ce combattant : elle prend fin à son tour suivant.
        for (const [t, p] of [...pesanteur]) if (p.caster === e.fighter && p.round < round) pesanteur.delete(t)
        break
      }
      case 'turnEnd': {
        const k = krobes.get(e.fighter)
        if (k) {
          // États « élément reçu » et Infection (durée 1, posés par le Krobe sur lui-même) : finis avec son tour.
          k.elements.clear()
          k.infected = false
        }
        current = undefined
        break
      }
      case 'move':
        if (e.fighter === current) turnMoved += e.path.length - 1
        break
      case 'cast':
        if (e.fighter === current && res.voluntary.has(i)) {
          const target = res.fighters.find(f => truth.alive.has(f.id) && truth.cell.get(f.id) === e.cell)?.id
          turnCasts.push({ spellId: e.spellId, cell: e.cell, target })
          let m = lastCast.get(e.fighter)
          if (!m) lastCast.set(e.fighter, (m = new Map()))
          m.set(e.spellId, round)
          let rs = castRounds.get(e.fighter)
          if (!rs) castRounds.set(e.fighter, (rs = new Map()))
          const l = rs.get(e.spellId) ?? []
          if (l.at(-1) !== round) rs.set(e.spellId, [...l, round])
        }
        break
      case 'summon':
        if (e.fighter.monsterId === MALAMIBE) malamibe = { id: e.fighter.id, summonRound: round, turnsPlayed: 0 }
        break
      case 'death':
        if (malamibe && e.target === malamibe.id) malamibe = undefined
        break
      default:
        break
    }
    for (const b of buffsAt.get(i) ?? []) {
      const k = krobes.get(b.target)
      if (b.effectId === STATE_ADD && b.param === ETAT.pesanteur) pesanteur.set(b.target, { caster: b.caster, round })
      if (!k) continue
      if (b.effectId === KILL_EFFECT && (KROBES[res.fighters[k.id].monsterId!]?.restauration ?? []).includes(b.spellId)) k.lastReset = { round, during: current }
      else if (b.effectId === STATE_ADD && b.param === ETAT.infection) k.infected = true
      else if (b.effectId === STATE_ADD && ELEMENT_STATES[b.param]) k.elements.add(ELEMENT_STATES[b.param])
    }
  }
  truth.caracBefore(ev.length)
  const turnCaracs = new Set<number>()
  if (current !== undefined) for (const x of res.caracLog) if (x.fighter === current && x.ev > turnStartEv) for (const [id] of x.values) turnCaracs.add(id)
  // Ordre de jeu : la dernière liste des tours du serveur (Malamibe comprise dès qu'elle est invoquée).
  const byGame = new Map(res.fighters.map(f => [f.gameId, f.id]))
  const listed = turnListGameIds(rows, rows.length)?.map(g => byGame.get(g)).filter((x): x is number => x !== undefined)
  const order = listed && listed.length >= seenOrder.length ? listed : seenOrder
  return { res, truth, mapId: res.mapId, round, order, turnList: listed, current, turnCasts, turnMoved, turnCaracs, lastCast, castRounds, krobes, malamibe, pesanteur }
}

/** Combattants qui jouent après `from` et avant son tour suivant, dans l'ordre (vivants seulement). */
export function upcoming(st: EtatCombat, from: number): number[] {
  const k = st.order.indexOf(from)
  if (k < 0) return []
  const out: number[] = []
  for (let j = 1; j < st.order.length; j++) {
    const id = st.order[(k + j) % st.order.length]
    if (st.truth.alive.has(id)) out.push(id)
  }
  return out
}

/** Relances restantes des sorts d'un Crâ au début de son tour de la manche `round` (dernier lancer et relance initiale). */
export function cooldownsOf(st: EtatCombat, fighter: number, spells: { spellId: number; grade?: number }[], round = st.round): Record<number, number> {
  const out: Record<number, number> = {}
  const last = st.lastCast.get(fighter)
  for (const sp of spells) {
    const lvl = sp.grade !== undefined ? data.spellLevel(sp.spellId, { grade: sp.grade }) : data.spell(sp.spellId)?.levels.at(-1)
    if (!lvl) continue
    const r = last?.get(sp.spellId)
    let rem = 0
    if (r !== undefined) {
      // Lancé pendant le tour en cours : relance à partir de la fin du tour (castsThisTurn compte le reste).
      if (r === round && st.current === fighter) rem = lvl.minCastInterval
      else rem = Math.max(0, r + lvl.minCastInterval - round)
    } else if (lvl.initialCooldown > 0) rem = Math.max(0, lvl.initialCooldown - (round - 1))
    if (rem > 0) out[sp.spellId] = rem
  }
  return out
}

/** Entité vue par le script au moment de la demande (fightAction:getAllEntities). */
export interface EntiteVisible {
  gameId: number
  cell: number
  hp: number
  maxHp: number
  ap: number
  mp: number
  espece: number
}

/**
 * État envoyé par le script d'un personnage seul (ENVOYER_ETAT, tools/feca/script.ts) : son journal se tait pendant son
 * tour et aucun autre ne le couvre. `lances` : ses sorts lancés depuis le début du combat, avec le numéro de son tour
 * (1 au premier), la case visée et l'entité visée (identifiant de jeu, 0 : une case) ; `tour` : son tour en cours ;
 * `manche` : la manche d'AnkaBot (le journal peut ne pas avoir reçu le début de la manche).
 */
export interface EtatDirect {
  entites: EntiteVisible[]
  lances: { spellId: number; tour: number; cell?: number; cible?: number }[]
  tour: number
  manche?: number
}

/** Champs « entites », « lances », « tour » et « manche » d'une demande de plan (sans « entites » : undefined). */
export function lireEtatDirect(q: Record<string, string>): EtatDirect | undefined {
  if (q.entites === undefined) return undefined
  const entites = q.entites.split(';').filter(Boolean).map(x => x.split(':').map(Number))
    .filter(a => a.length >= 7 && a.every(n => !isNaN(n)))
    .map(([gameId, cell, hp, maxHp, ap, mp, espece]) => ({ gameId, cell, hp, maxHp, ap, mp, espece }))
  const lances = (q.lances ?? '').split(';').filter(Boolean).map(x => x.split(':').map(Number))
    .filter(([s, t]) => s > 0 && t > 0)
    .map(([spellId, tour, cell, cible]) => ({ spellId, tour, cell: cell >= 0 ? cell : undefined, cible: cible ? cible : undefined }))
  const manche = Number(q.manche)
  return { entites, lances, tour: Math.max(1, Number(q.tour) || 1), manche: manche > 0 ? manche : undefined }
}

/**
 * Recale l'état du journal sur l'état visible, au début (ou pendant) le tour du personnage `me` : cases, PV et morts
 * (ce qui s'est passé pendant ses tours précédents, que son journal n'a pas vu : Malamibe tuée, monstres poussés),
 * tour en cours, relances de ses sorts. Rend les cases des entités vivantes inconnues du journal (invocations de ses
 * tours, la Lanterne du Berger) : obstacles pour le moteur.
 */
export function appliquerEtatDirect(st: EtatCombat, me: number, d: EtatDirect): { obstacles: number[] } {
  const t = st.truth
  const byGame = new Map(st.res.fighters.map(f => [f.gameId, f.id]))
  const seen = new Set<number>()
  const obstacles: number[] = []
  for (const e of d.entites) {
    let id = byGame.get(e.gameId)
    // Malamibe que le journal n'a pas encore vue (invoquée au tour qui précède, messages pas encore reçus) : ajoutée, comme
    // cible, invoquée dans cette manche (2026-10-17 à 23:43 : tenue pour à tuer d'urgence dès le 1er tour, le Féca a frappé
    // les Krobes au lieu des mules).
    if (id === undefined && e.espece === MALAMIBE && e.hp > 0 && e.cell >= 0) {
      const team = st.res.fighters.find(f => f.kind !== 'player')?.team ?? 1
      id = st.res.fighters.length
      st.res.fighters.push({ gameId: e.gameId, id, name: 'Malamibe', team, kind: 'summon', monsterId: MALAMIBE, level: 1, cell: e.cell, alive: true, carac: new Map() })
      byGame.set(e.gameId, id)
      st.malamibe = { id, summonRound: Math.max(st.round, d.manche ?? 0), turnsPlayed: 0 }
    }
    if (id === undefined) {
      if (e.hp > 0 && e.cell >= 0) obstacles.push(e.cell)
      continue
    }
    seen.add(id)
    if (e.hp <= 0 || e.cell < 0) {
      t.alive.delete(id)
      continue
    }
    t.alive.add(id)
    t.cell.set(id, e.cell)
    t.hp.set(id, e.hp)
    if (e.maxHp > 0) t.max.set(id, e.maxHp)
  }
  // Vivants pour le journal, absents de l'état visible : morts pendant un tour du personnage.
  if (d.entites.length) for (const id of [...t.alive]) if (!seen.has(id)) t.alive.delete(id)
  if (st.malamibe && !t.alive.has(st.malamibe.id)) st.malamibe = undefined
  if (st.current !== me) {
    st.current = me
    st.turnMoved = 0
    st.turnCaracs = new Set()
  }
  // Ordre de jeu : la liste des tours du serveur. Les tours vus n'ont jamais ceux du personnage (journal en silence),
  // et la liste, raccourcie par les morts, était écartée au profit des tours vus (2026-10-17 : Féca absent de l'ordre,
  // gardien d'aucun Verminocule).
  if (st.turnList?.includes(me)) st.order = st.turnList
  else if (!st.order.includes(me)) st.order = [me, ...st.order]
  // Début de manche pas encore reçu par le journal (combat du 2026-10-17 : une manche de retard dès le 2e tour).
  if (d.manche !== undefined && d.manche > st.round) st.round = d.manche
  // Ses lancers : un tour par manche (personnage seul), donc la manche d'un lancer = manche en cours − tours d'écart.
  const last = new Map<number, number>()
  const rounds = new Map<number, number[]>()
  for (const l of d.lances) {
    const r = st.round - (d.tour - l.tour)
    if (r < 1) continue
    last.set(l.spellId, Math.max(last.get(l.spellId) ?? 0, r))
    const list = rounds.get(l.spellId) ?? []
    if (list.at(-1) !== r) list.push(r)
    rounds.set(l.spellId, list)
  }
  st.lastCast.set(me, last)
  st.castRounds.set(me, rounds)
  // Lancers du tour en cours, avec leur cible (limites de lancers par cible : Bulle, 2 fois par cible).
  st.turnCasts = d.lances.filter(l => l.tour === d.tour)
    .map(l => ({ spellId: l.spellId, cell: l.cell ?? -1, target: l.cible !== undefined ? byGame.get(l.cible) : undefined }))
  return { obstacles }
}

/** État du dernier combat d'un fichier de journal (flux du chef, ou d'un personnage). */
export function etatDuJournal(file: string, perso?: string, mapId?: number): EtatCombat {
  return etatCombat(loadStream(file, perso).rows, { mapId })
}
