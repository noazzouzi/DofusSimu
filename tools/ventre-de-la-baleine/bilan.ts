// Bilan d'un combat du Ventre de la Baleine, depuis le journal AnkaBot (tools/ankabot/journal-combats.lua) : le combat est
// reconstitué paquet par paquet (tools/fightlog/rejeu.ts), puis lu sous l'angle des mécaniques du donjon :
//   - Malamibes : qui l'invoque et quand, PV, tours joués, dégâts reçus (renvoyés par les Krobes ou directs), mort ;
//   - Krobes : compte à rebours de leur Restauration (lancé, réinitialisé et pourquoi, mort), Infection, éléments reçus
//     par le Pataugerme, PM et déplacements subis par la Virustine, Puissance du Tabacille, soins reçus par l'équipe ;
//   - IA des monstres : à chaque tour, cases de départ et d'arrivée, distance au personnage le plus proche, sorts lancés
//     (cible, distance, alignement), dégâts infligés ;
//   - dégâts infligés (à la Malamibe) et reçus (par monstre) par personnage.
//
//   npx tsx tools/ventre-de-la-baleine/bilan.ts [--fichier data/fightlogs/…/session-….jsonl] [--perso Lowkey-Jealous]
//                                               [--combat -1 | --tous] [--json bilan.json]
// Défaut : dernier fichier de data/fightlogs, journaux des 4 personnages fusionnés tour par tour (comme le serveur de
// plans : avec BaleineCombat.lua, chaque journal se tait pendant le tour de son personnage), dernier combat contre des
// Krobes ; --tous : tous ; --combat n : n-ième combat contre des Krobes (0 = le premier, −1 = le dernier).
// --perso : le journal de ce personnage seul ; --combat n compte alors tous les combats de son flux, Krobes ou non.
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ELEMENT_NAMES_FR, type Element } from '../../src/core/types'
import { distance, inDiagonal, inLine } from '../../src/map/geometry'
import { fightsOf, mergeStreams } from '../fightlog/fusion'
import { MSG, loadStream, rebuild, type Rebuild } from '../fightlog/rejeu'
import { data } from '../reine-des-voleurs/planificateur/etat'
import { chainsOf, readJsonLines, type Row } from '../reine-des-voleurs/planificateur/journal'
import {
  BACTERRIB, ELEMENT_STATES, ETAT, KILL_EFFECT, KROBES, MALAMIBE, MP_MALUS_EFFECT, PATAUGERME, POWER_EFFECT, PROTOZORREUR,
  STATE_ADD, TABACILLE, VERMINOCULE, VIRUSTINE, VIRUSTINE_PUSH_MALUS, baseKrobe, isBaleineMonster, isKrobe, salleDeCarte,
} from './donjon'

export interface CastInfo {
  spellId: number
  spell: string
  from: number
  cell: number
  distance: number
  /** « ligne », « diagonale » ou vide. */
  axe: string
  /** Occupant de la case visée au moment du lancer (nom), ou « case vide ». */
  cible: string
  /** Effets qui ont suivi le lancer (dégâts, soins, poussées, échanges, morts…), en clair. */
  effets: string[]
}

export interface TurnInfo {
  round: number
  fighter: number
  name: string
  kind: 'player' | 'monster' | 'summon'
  monsterId?: number
  startCell: number
  endCell: number
  mpUsed: number
  /** PA et PM au début du tour (caractéristiques connues à ce moment). */
  ap: number
  mp: number
  /** Puissance du combattant à son premier sort (ou à la fin du tour) : +150 par tour du Tabacille, −150 par Flèche du Jugement. */
  power?: number
  /** Tour d'un combattant déjà mort (le serveur continue d'envoyer ses débuts et fins de tour). */
  dead?: boolean
  /** Adversaire le plus proche (Crâ pour un monstre, Krobe pour un Crâ) au début et à la fin du tour. */
  nearestStart?: { name: string; distance: number }
  nearestEnd?: { name: string; distance: number }
  casts: CastInfo[]
  /** Événements des mécaniques pendant ce tour (Malamibe, Infection, compte à rebours, morts…). */
  notes: string[]
  /** Dégâts infligés aux adversaires pendant ce tour (Crâ : à la Malamibe, renvois compris ; monstre : aux Crâs). */
  damageDealt: number
}

export interface MalamibeInfo {
  id: number
  name: string
  summoner?: string
  round: number
  /** PV max relevés (synchronisations et caractéristiques envoyées après l'invocation). */
  maxHp: number
  turnsPlayed: number
  diedRound?: number
  killer?: string
  /** Morte avec le Krobe qui l'a invoquée (mort de son compte à rebours). */
  withSummoner?: boolean
  damage: { renvoi: number; direct: number }
}

export interface KrobeInfo {
  id: number
  name: string
  monsterId: number
  startCell: number
  /** Compte à rebours lancé ou relancé (effet 141 de la Restauration) : manche, tour en cours, cause probable. */
  countdowns: { round: number; during?: string; cause: string }[]
  /** Manches où le Krobe a pris l'état Infection. */
  infections: number[]
  /** Pataugerme : états « élément reçu » pris, et éléments des dégâts reçus, par manche. */
  elementStates: Record<number, string[]>
  elementHits: Record<number, string[]>
  /** Tabacille, Protozorreur : Puissance gagnée (somme). */
  power: number
  /** Virustine : PM au début de chacun de ses tours, malus de PM (dommages de poussée), déplacements et retraits subis. */
  mpAtTurnStart: number[]
  mpMalus: number
  moved: string[]
  diedRound?: number
}

export interface Bilan {
  file?: string
  character?: string
  /** Titre du combat (journaux fusionnés : « Combat 2 sur 3 »). */
  label?: string
  fightIndex: number
  mapId: number
  /** Origine de `mapId` (rejeu.ts) : photos d'AnkaBot, option, ou carte par défaut (non relevée). */
  mapSource: Rebuild['mapSource']
  salle?: string
  rounds: number
  result: 'victoire' | 'défaite' | 'inconnu'
  placement: { players: string[]; monsters: string[] }
  /** PV des personnages au début du combat. */
  startHp: { name: string; hp: number; maxHp: number }[]
  order: string[]
  turns: TurnInfo[]
  malamibes: MalamibeInfo[]
  krobes: KrobeInfo[]
  /** Soins reçus par les personnages ; `volDeVie` : soin du lanceur par un sort de vol de vie (effets 91-95). */
  heals: { round: number; during?: string; target: string; amount: number; spell?: string; volDeVie?: boolean }[]
  /** Dégâts par personnage : à la Malamibe (renvoyés par un Krobe touché, ou directs). */
  damageByPlayer: Record<string, { renvoi: number; direct: number }>
  /** Dégâts reçus par personnage, par monstre. */
  damageTaken: Record<string, Record<string, number>>
  deaths: { round: number; name: string; killer?: string }[]
  checks: { syncOk: number; syncBad: number; unhandled: Record<string, number> }
}

const ELEMENT_LETTER: Record<number, string> = { 0: 'Neutre', 1: 'Terre', 2: 'Feu', 3: 'Eau', 4: 'Air', [-1]: 'poussée' }

/** Sort de vol de vie (effets 91 à 95) : son soin est celui du lanceur. */
const isLifesteal = (spellId: number) => !!data.spell(spellId)?.levels.some(l => l.effects.some(e => e.effectId >= 91 && e.effectId <= 95))

/** Bilan du combat `which` d'un flux (rangs comme `fightRange` : −1 = dernier). `mapId` : carte du combat, si connue. */
export function bilanCombat(rows: Row[], which = -1, meta: { file?: string; character?: string; label?: string; mapId?: number } = {}): Bilan {
  const { mapId, ...rest } = meta
  const res = rebuild(rows, { which, mapId })
  return bilanOf(res, which, rest)
}

/** Lecture d'une reconstitution (rejeu.ts) sous l'angle des mécaniques du Ventre de la Baleine. */
export function bilanOf(res: Rebuild, fightIndex = -1, meta: { file?: string; character?: string; label?: string } = {}): Bilan {
  const fighters = res.fighters
  const name = (id?: number) => (id === undefined ? '?' : fighters[id]?.name ?? String(id))
  const ev0 = res.replay.events[0]
  const cell = new Map<number, number>()
  const alive = new Map<number, boolean>()
  if (ev0?.t === 'fightStart') for (const f of ev0.fighters) {
    cell.set(f.id, f.cell)
    alive.set(f.id, true)
  }
  const isPlayer = (id: number) => fighters[id]?.kind === 'player'
  /** Crâs vivants du plus proche au plus loin d'un combattant (positions suivies jusqu'à l'événement en cours). */
  const playersNear = (id: number) => {
    const at = cell.get(id)
    if (at === undefined) return []
    return fighters.filter(f => f.kind === 'player' && alive.get(f.id) && cell.has(f.id))
      .map(f => ({ name: f.name, d: distance(cell.get(f.id)!, at) })).sort((a, b) => a.d - b.d)
  }
  const monsterOf = (id: number) => fighters[id]?.monsterId
  const isMalamibe = (id: number) => monsterOf(id) === MALAMIBE
  const krobes = new Map<number, KrobeInfo>()
  for (const f of fighters) if (f.kind !== 'player' && isKrobe(f.monsterId)) {
    krobes.set(f.id, { id: f.id, name: f.name, monsterId: f.monsterId!, startCell: cell.get(f.id) ?? f.cell, countdowns: [], infections: [],
      elementStates: {}, elementHits: {}, power: 0, mpAtTurnStart: [], mpMalus: 0, moved: [] })
  }
  const restauration = (k: KrobeInfo) => KROBES[k.monsterId]?.restauration ?? []

  const nearest = (from: number, wantPlayer: boolean): { name: string; distance: number } | undefined => {
    const c = cell.get(from)
    if (c === undefined || c < 0) return undefined
    let best: { name: string; distance: number } | undefined
    for (const f of fighters) {
      if (!alive.get(f.id) || f.id === from) continue
      if (wantPlayer ? f.kind !== 'player' : !isKrobe(f.monsterId)) continue
      const fc = cell.get(f.id)
      if (fc === undefined || fc < 0) continue
      const d = distance(c, fc)
      if (!best || d < best.distance) best = { name: f.name, distance: d }
    }
    return best
  }
  const occupant = (c: number) => {
    for (const [id, x] of cell) if (x === c && alive.get(id)) return id
    return undefined
  }

  // Effets posés et changements de caractéristiques, rangés par indice d'événement.
  const buffsAt = new Map<number, Rebuild['buffs']>()
  for (const b of res.buffs) {
    const l = buffsAt.get(b.ev)
    if (l) l.push(b)
    else buffsAt.set(b.ev, [b])
  }
  const caracAt = new Map<number, Rebuild['caracLog']>()
  for (const x of res.caracLog) {
    const l = caracAt.get(x.ev)
    if (l) l.push(x)
    else caracAt.set(x.ev, [x])
  }
  const dodgesAt = new Map<number, Rebuild['dodges']>()
  for (const x of res.dodges) {
    const l = dodgesAt.get(x.ev)
    if (l) l.push(x)
    else dodgesAt.set(x.ev, [x])
  }

  const turns: TurnInfo[] = []
  const malamibes = new Map<number, MalamibeInfo>()
  const heals: Bilan['heals'] = []
  const damageByPlayer: Bilan['damageByPlayer'] = {}
  const damageTaken: Bilan['damageTaken'] = {}
  const deaths: Bilan['deaths'] = []
  const order: string[] = []
  let round = 0
  let turn: TurnInfo | undefined
  let lastCast: CastInfo | undefined
  let freshAp: number | undefined
  let freshMp: number | undefined
  /** Dernières caractéristiques connues par combattant (PM restants : 23, Puissance : 25). */
  const lastCarac = new Map<number, Map<number, number>>()
  for (const [id, c] of res.initialCarac) lastCarac.set(id, new Map(c))
  const powerOf = (id: number) => lastCarac.get(id)?.get(25)
  /** Événements récents qui peuvent réinitialiser un Krobe (soins, déplacements de la Virustine), effacés à chaque tour. */
  let recentHeal: string | undefined
  const recentMove = new Map<number, string>()

  const note = (text: string) => {
    if (turn) turn.notes.push(text)
  }
  const effect = (text: string) => {
    if (lastCast && turn && turn.casts.includes(lastCast)) lastCast.effets.push(text)
    else note(text)
  }
  const during = () => (turn ? `tour de ${turn.name}` : undefined)

  const events = res.replay.events
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    // PA et PM du début de tour : le serveur les renvoie un peu après le début du tour (rejeu.ts n'a encore que les points
    // restants du tour précédent). On garde les premiers envoyés avant le premier déplacement ou sort du combattant.
    for (const x of caracAt.get(i) ?? []) {
      let c = lastCarac.get(x.fighter)
      if (!c) lastCarac.set(x.fighter, (c = new Map()))
      for (const [k, v] of x.values) {
        c.set(k, v)
        if (!turn || x.fighter !== turn.fighter || turn.mpUsed || turn.casts.length) continue
        if (k === 1 && freshAp === undefined) turn.ap = freshAp = v
        if (k === 23 && freshMp === undefined) turn.mp = freshMp = v
      }
    }
    switch (e.t) {
      case 'roundStart':
        round = e.round
        break
      case 'turnStart': {
        const f = fighters[e.fighter]
        lastCast = undefined
        recentHeal = undefined
        recentMove.clear()
        freshAp = freshMp = undefined
        turn = {
          round, fighter: e.fighter, name: f?.name ?? String(e.fighter), kind: f?.kind ?? 'monster', monsterId: f?.monsterId,
          startCell: cell.get(e.fighter) ?? -1, endCell: cell.get(e.fighter) ?? -1, mpUsed: 0, ap: e.ap, mp: e.mp,
          nearestStart: nearest(e.fighter, !isPlayer(e.fighter)), casts: [], notes: [], damageDealt: 0,
          ...(alive.get(e.fighter) === false ? { dead: true } : {}),
        }
        turns.push(turn)
        if (round === 1) order.push(turn.name)
        const m = malamibes.get(e.fighter)
        if (m) m.turnsPlayed++
        break
      }
      case 'turnEnd':
        if (turn && turn.fighter === e.fighter) {
          turn.endCell = cell.get(e.fighter) ?? -1
          turn.nearestEnd = nearest(e.fighter, !isPlayer(e.fighter))
          turn.mp = Math.max(turn.mp, turn.mpUsed)
          turn.power ??= powerOf(e.fighter)
          const k = krobes.get(e.fighter)
          if (k && !turn.dead && baseKrobe(k.monsterId) === VIRUSTINE) k.mpAtTurnStart.push(turn.mp)
        }
        turn = undefined
        lastCast = undefined
        break
      case 'move': {
        const to = e.path[e.path.length - 1]
        cell.set(e.fighter, to)
        if (turn && turn.fighter === e.fighter) turn.mpUsed += e.path.length - 1
        break
      }
      case 'cast': {
        const from = cell.get(e.fighter) ?? -1
        const target = occupant(e.cell)
        // Lancer volontaire (premier lancer d'une séquence du combattant dont c'est le tour) : nouvelle ligne. Les autres
        // (sorts déclenchés : renvoi vers la Malamibe, Restaurations…) rattachent leurs effets au lancer volontaire.
        if (res.voluntary.has(i) && turn && turn.fighter === e.fighter) {
          turn.power ??= powerOf(e.fighter)
          lastCast = {
            spellId: e.spellId, spell: e.spellName, from, cell: e.cell, distance: from >= 0 ? distance(from, e.cell) : -1,
            axe: from < 0 || from === e.cell ? '' : inLine(from, e.cell) ? 'ligne' : inDiagonal(from, e.cell) ? 'diagonale' : '',
            cible: target === undefined ? 'case vide' : target === e.fighter ? 'soi' : name(target), effets: [],
          }
          turn.casts.push(lastCast)
        }
        break
      }
      case 'damage': {
        const src = e.source
        const tgt = e.target
        const el = ELEMENT_LETTER[e.element] ?? String(e.element)
        if (isMalamibe(tgt)) {
          const m = malamibes.get(tgt)
          // Renvoi : dégâts portés par un Krobe (ou la Malamibe elle-même) après un coup sur un Krobe.
          const renvoi = !isPlayer(src)
          if (m) m.damage[renvoi ? 'renvoi' : 'direct'] += e.amount
          const by = isPlayer(src) ? name(src) : turn && isPlayer(turn.fighter) ? turn.name : undefined
          if (by) (damageByPlayer[by] ??= { renvoi: 0, direct: 0 })[renvoi ? 'renvoi' : 'direct'] += e.amount
          if (turn && isPlayer(turn.fighter)) turn.damageDealt += e.amount
          effect(`${name(tgt)} −${e.amount}${renvoi ? ' (renvoi)' : ''}`)
        } else if (isPlayer(tgt)) {
          if (!isPlayer(src)) {
            const who = fighters[src]?.kind === 'summon' || !fighters[src] ? name(src) : KROBES[monsterOf(src) ?? -1]?.nom ?? name(src)
            const per = (damageTaken[name(tgt)] ??= {})
            per[who] = (per[who] ?? 0) + e.amount
            if (turn && turn.fighter === src) turn.damageDealt += e.amount
          }
          effect(`${name(tgt)} −${e.amount} ${el}`)
        } else {
          const k = krobes.get(tgt)
          if (k && e.element !== -1) {
            const list = (k.elementHits[round] ??= [])
            const label = ELEMENT_NAMES_FR[e.element as Element]
            if (label && !list.includes(label)) list.push(label)
          }
          if (k && baseKrobe(k.monsterId) === VIRUSTINE && e.kind === 'push') note(`${k.name} : dommage de poussée (${e.amount})`)
          effect(`${name(tgt)} ${e.amount ? `−${e.amount} ` : ''}${el}`)
        }
        break
      }
      case 'heal':
        if (isPlayer(e.target)) {
          const vol = !!lastCast && turn?.fighter === e.target && isLifesteal(lastCast.spellId)
          heals.push({ round, during: during(), target: name(e.target), amount: e.amount, spell: lastCast?.spell, ...(vol ? { volDeVie: true } : {}) })
          recentHeal = `${vol ? 'vol de vie' : 'soin'} de ${name(e.target)} (+${e.amount}${lastCast ? `, ${lastCast.spell}` : ''})`
        }
        effect(`${name(e.target)} +${e.amount}`)
        break
      case 'apmp': {
        const k = krobes.get(e.target)
        // (action 169 : PM inesquivables que la Virustine se retire elle-même — Restauration, dommage de poussée)
        if (k && baseKrobe(k.monsterId) === VIRUSTINE && e.mp < 0 && e.reason !== 'utilisés' && e.reason !== 'action 169') {
          const why = `PM retirés (${e.mp}, ${e.reason})${turn ? ` pendant le tour de ${turn.name}` : ''}`
          recentMove.set(k.id, why)
          k.moved.push(`M${round} : ${why}`)
        }
        if (e.reason !== 'utilisés' && (e.ap || e.mp)) effect(`${name(e.target)} ${e.ap ? `${e.ap > 0 ? '+' : ''}${e.ap} PA` : ''}${e.mp ? `${e.mp > 0 ? '+' : ''}${e.mp} PM` : ''}`)
        break
      }
      case 'push': {
        cell.set(e.target, e.to)
        const k = krobes.get(e.target)
        const how = `${e.from}→${e.to}`
        if (k && baseKrobe(k.monsterId) === VIRUSTINE) {
          const why = `déplacée ${how}${turn ? ` pendant le tour de ${turn.name}` : ''}`
          recentMove.set(k.id, why)
          k.moved.push(`M${round} : ${why}`)
        }
        effect(`${name(e.target)} déplacé ${how}`)
        break
      }
      case 'teleport': {
        cell.set(e.target, e.to)
        const k = krobes.get(e.target)
        if (k && baseKrobe(k.monsterId) === VIRUSTINE) {
          const why = `transposée ${e.from}→${e.to}${turn ? ` pendant le tour de ${turn.name}` : ''}`
          recentMove.set(k.id, why)
          k.moved.push(`M${round} : ${why}`)
        }
        effect(`${name(e.target)} ${e.from}⇄${e.to}`)
        break
      }
      case 'summon': {
        const f = e.fighter
        cell.set(f.id, f.cell)
        alive.set(f.id, true)
        if (f.monsterId === MALAMIBE) {
          malamibes.set(f.id, { id: f.id, name: f.name, summoner: name(e.summoner), round, maxHp: f.maxHp, turnsPlayed: 0, damage: { renvoi: 0, direct: 0 } })
          note(`${name(e.summoner)} invoque ${f.name} (${f.maxHp} PV à l'invocation)`)
        } else effect(`invocation ${f.name} en ${f.cell}`)
        break
      }
      case 'death': {
        alive.set(e.target, false)
        const killer = e.killer !== undefined ? name(e.killer) : undefined
        deaths.push({ round, name: name(e.target), killer })
        const k = krobes.get(e.target)
        const m = malamibes.get(e.target)
        if (k) {
          k.diedRound = round
          note(`✝ ${k.name} meurt (compte à rebours de sa Restauration)`)
        } else if (m) {
          m.diedRound = round
          // Tuée par elle-même : son invocateur vient de mourir. Sinon, le coup de grâce vient souvent d'un renvoi (auteur :
          // le Krobe touché) : on l'attribue au Crâ dont c'est le tour.
          m.withSummoner = e.killer === e.target
          m.killer = m.withSummoner ? undefined : turn && isPlayer(turn.fighter) ? turn.name : killer
          note(`✝ ${m.name} ${m.withSummoner ? 'meurt avec son invocateur' : `tuée${m.killer ? ` (${m.killer})` : ''}`}`)
        } else note(`✝ ${name(e.target)}${killer ? ` (tué par ${killer})` : ''}`)
        break
      }
      case 'glyph':
        if (e.added) note(`glyphe ${e.glyph.spellId || ''} en ${e.glyph.cells.join(',')}`)
        break
      default:
        break
    }

    // Retraits de PA ou de PM esquivés : une tentative de retrait de PM relance aussi la Virustine.
    for (const x of dodgesAt.get(i) ?? []) {
      const k = krobes.get(x.target)
      if (k && x.kind === 'PM' && baseKrobe(k.monsterId) === VIRUSTINE) {
        const why = `retrait de PM esquivé (${x.amount})${turn ? ` pendant le tour de ${turn.name}` : ''}`
        recentMove.set(k.id, why)
        k.moved.push(`M${round} : ${why}`)
      }
      effect(`${name(x.target)} esquive ${x.amount} ${x.kind}`)
    }

    // Effets posés à cet événement (ligne de journal de rejeu.ts).
    for (const b of buffsAt.get(i) ?? []) {
      const k = krobes.get(b.target)
      if (!k) continue
      if (b.effectId === KILL_EFFECT && restauration(k).includes(b.spellId)) {
        const last = k.countdowns.at(-1)
        if (last && last.round === round && last.during === during()) continue // même relance (sort et sous-sort)
        // Sorts de départ : lancés au début de la manche 1, avant le premier tour.
        const kind = baseKrobe(k.monsterId)
        let cause: string
        if (!turns.length) cause = 'début du combat'
        else if (kind === TABACILLE) cause = recentHeal ? `réinitialisé : ${recentHeal}` : 'réinitialisé (soin non vu)'
        else if (kind === VIRUSTINE) cause = `réinitialisé : ${recentMove.get(k.id) ?? 'cause non vue (portée, retrait de PM esquivé ?)'}`
        else if (kind === BACTERRIB) {
          const near = playersNear(k.id).filter(x => x.d <= 5)
          cause = near.length ? `réinitialisé : ${near.map(x => `${x.name} à ${x.d} case${x.d > 1 ? 's' : ''}`).join(', ')}` : 'réinitialisé (aucun Crâ vu à 5 cases ou moins)'
        } else if (kind === VERMINOCULE) {
          const near = playersNear(k.id)[0]
          cause = near?.d === 1 ? `réinitialisé alors que ${near.name} est à son contact` : `réinitialisé : aucun Crâ à son contact${near ? ` (le plus proche : ${near.name} à ${near.d} cases)` : ''}`
        }
        else if (k.monsterId === PROTOZORREUR) cause = 'réinitialisé (sans Infection)'
        else if (turn?.fighter === k.id) cause = 'réinitialisé au début de son tour (condition non remplie)'
        else cause = 'réinitialisé'
        k.countdowns.push({ round, during: during(), cause })
        if (turns.length) note(`${k.name} : compte à rebours ${cause}`)
      } else if (b.effectId === STATE_ADD && b.param === ETAT.infection) {
        if (!k.infections.includes(round)) k.infections.push(round)
        note(`${k.name} : Infection`)
      } else if (b.effectId === STATE_ADD && ELEMENT_STATES[b.param]) {
        const list = (k.elementStates[round] ??= [])
        if (!list.includes(ELEMENT_STATES[b.param])) list.push(ELEMENT_STATES[b.param])
      } else if (b.effectId === STATE_ADD && b.param === ETAT.pesanteur) {
        note(`${k.name} : Pesanteur`)
      } else if (b.effectId === POWER_EFFECT && (baseKrobe(k.monsterId) === TABACILLE || k.monsterId === PROTOZORREUR)) {
        k.power += b.param
      } else if (b.effectId === MP_MALUS_EFFECT && b.spellId === VIRUSTINE_PUSH_MALUS) {
        k.mpMalus++
        note(`${k.name} : −1 PM (dommage de poussée)`)
      }
    }
  }

  const players = fighters.filter(f => f.kind === 'player')
  const monsters = fighters.filter(f => f.kind === 'monster')
  const result: Bilan['result'] = monsters.length && monsters.every(f => !alive.get(f.id))
    ? 'victoire'
    : players.length && players.every(f => !alive.get(f.id)) ? 'défaite' : 'inconnu'
  // PV max des Malamibes : vitalité envoyée après l'invocation (+2000 par personnage vivant).
  for (const m of malamibes.values()) {
    const c = new Map<number, number>(res.initialCarac.get(m.id) ?? [])
    for (const x of res.caracLog) if (x.fighter === m.id) for (const [k, v] of x.values) {
      c.set(k, v)
      m.maxHp = Math.max(m.maxHp, (c.get(0) ?? 0) + (c.get(11) ?? 0) - (c.get(102) ?? 0))
    }
  }
  const startCell = (id: number) => (ev0?.t === 'fightStart' ? ev0.fighters.find(f => f.id === id)?.cell : undefined) ?? -1
  return {
    ...meta,
    fightIndex,
    mapId: res.mapId,
    mapSource: res.mapSource,
    salle: salleDeCarte(res.mapId),
    rounds: res.rounds,
    result,
    // Combattants présents au début (les monstres des vagues suivantes n'ont pas de case de départ).
    placement: {
      players: players.filter(f => startCell(f.id) >= 0).map(f => `${f.name} ${startCell(f.id)}`),
      monsters: monsters.filter(f => startCell(f.id) >= 0).map(f => `${KROBES[f.monsterId ?? -1]?.nom ?? f.name} ${startCell(f.id)}`).sort(),
    },
    startHp: ev0?.t === 'fightStart' ? ev0.fighters.filter(f => f.kind === 'player').map(f => ({ name: f.name, hp: f.hp, maxHp: f.maxHp })) : [],
    order,
    turns,
    malamibes: [...malamibes.values()],
    krobes: [...krobes.values()],
    heals,
    damageByPlayer,
    damageTaken,
    deaths,
    checks: { syncOk: res.checks.sync.ok, syncBad: res.checks.sync.bad, unhandled: res.unhandled },
  }
}

/** Combats d'un flux (rang, de 0) dont la première synchronisation compte un Krobe ou une Malamibe. */
export function baleineFights(rows: Row[]): number[] {
  const out: number[] = []
  let k = -1
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.k !== 'm') continue
    if (r.n === MSG.round && r.d?.fxjj === 1) {
      k++
      // Première synchronisation du combat : ses monstres.
      for (let j = i + 1; j < rows.length; j++) {
        const s = rows[j]
        if (s.k !== 'm') continue
        if (s.n === MSG.round && s.d?.fxjj === 1) break
        if (s.n !== MSG.sync) continue
        const list: any[] = Array.isArray(s.d?.fxgj) ? s.d.fxgj : []
        if (list.some(e => isBaleineMonster(e?.gcay?.gcar?.gcai?.gbzm?.gbyz))) out.push(k)
        break
      }
    }
  }
  return out
}

/** Chef du groupe : son journal passe en premier quand plusieurs ont vu le même tour. */
const CHEF = 'Lowkey-Jealous'

/**
 * Combats contre des Krobes d'une session, journaux des personnages fusionnés tour par tour (tools/fightlog/fusion.ts,
 * comme le serveur de plans) : avec BaleineCombat.lua, chaque journal se tait pendant le tour de son personnage.
 * `sources` : tours pris dans chaque journal.
 */
export function baleineFightsOfFile(file: string): { rows: Row[]; sources: Record<string, number>; mapId?: number }[] {
  const streams = chainsOf(readJsonLines(file))
    .filter(x => x.rows.length && (x.c || x.owner !== undefined))
    .map(x => ({ name: x.c ?? String(x.owner), rows: x.rows }))
  const prefer = [CHEF, ...streams.map(s => s.name).filter(n => n !== CHEF)]
  const out: { rows: Row[]; sources: Record<string, number>; mapId?: number }[] = []
  for (const opt of fightsOf(streams)) {
    const merged = mergeStreams(streams, prefer, opt)
    if (merged.rows.length && baleineFights(merged.rows).length) out.push({ ...merged, mapId: fightStartMap(streams, opt.at) })
  }
  return out
}

/**
 * Carte notée par les journaux au début du combat (événement « fightStart ») : le script qui joue ne prend pas de photos
 * d'AnkaBot, et les lignes fusionnées n'ont plus ces événements. `at` : heure (ms) de la manche 1 du combat.
 */
function fightStartMap(streams: { rows: Row[] }[], at?: number): number | undefined {
  if (at === undefined) return undefined
  let best: { ms: number; map: number } | undefined
  for (const s of streams) for (const r of s.rows) {
    const x = r as Row & { ev?: string }
    if (x.k !== 'e' || x.ev !== 'fightStart' || typeof x.map !== 'number' || typeof x.ms !== 'number') continue
    if (x.ms > at + 5000 || x.ms < at - 120_000) continue
    if (!best || x.ms > best.ms) best = { ms: x.ms, map: x.map }
  }
  return best?.map
}

const fmtNearest = (n?: { name: string; distance: number }) => (n ? `${n.distance} (${n.name})` : '?')

/** Bilan en texte (console). */
export function formatBilan(b: Bilan): string {
  const L: string[] = []
  const title = [b.file ? basename(b.file) : undefined, b.character ? (b.label ? b.character : `flux de ${b.character}`) : undefined].filter(Boolean).join(', ')
  L.push(`═══ ${b.label ?? (b.fightIndex >= 0 ? `Combat n°${b.fightIndex + 1} du flux` : 'Dernier combat du flux')}${title ? ` — ${title}` : ''} ═══`)
  const carte = b.mapSource === 'défaut' ? `carte non relevée (pas de photo d'AnkaBot)` : `carte ${b.mapId}${b.salle ? ` (${b.salle})` : ''}`
  L.push(`${carte[0].toUpperCase()}${carte.slice(1)} · ${b.rounds} manche(s) · ${b.result} · synchronisations ${b.checks.syncOk} justes, ${b.checks.syncBad} fausses`)
  L.push(`Placement : ${b.placement.players.join(', ')} | ${b.placement.monsters.join(', ')}`)
  if (b.startHp.length) L.push(`PV au début : ${b.startHp.map(x => `${x.name} ${x.hp}/${x.maxHp} (${Math.round((100 * x.hp) / Math.max(1, x.maxHp))} %)`).join(', ')}`)
  L.push(`Ordre de jeu (manche 1) : ${b.order.join(' › ')}`)
  const fallen = b.deaths.filter(x => !b.krobes.some(k => k.name === x.name) && !b.malamibes.some(m => m.name === x.name))
  L.push(`Personnages morts : ${fallen.map(d => `${d.name} M${d.round}`).join(', ') || 'aucun'}`)

  L.push('', '── Chronologie ──')
  const malamibeTurns = new Map<number, number>()
  for (const t of b.turns) {
    if (t.dead) continue // tour d'un mort : passé par le serveur
    if (t.monsterId === MALAMIBE) {
      const n = (malamibeTurns.get(t.fighter) ?? 0) + 1
      malamibeTurns.set(t.fighter, n)
      L.push(`M${t.round} ${t.name} : tour n°${n} depuis son invocation`)
      for (const x of t.notes) L.push(`      ↳ ${x}`)
      continue
    }
    if (t.kind === 'summon' && !t.casts.length && !t.mpUsed && !t.notes.length) continue // invocation passive
    const head = `M${t.round} ${t.name} ${t.startCell}→${t.endCell} (${t.mpUsed}/${t.mp} PM)`
    const casts = t.casts.map(c => `${c.spell} → ${c.cible} [${c.distance} c.${c.axe ? ', ' + c.axe : ''}]${c.effets.length ? ' : ' + c.effets.join(', ') : ''}`)
    L.push(`${head}${casts.length ? ' · ' + casts.join(' · ') : ''}`)
    for (const n of t.notes) L.push(`      ↳ ${n}`)
  }

  L.push('', '── Malamibes ──')
  if (!b.malamibes.length) L.push('aucune')
  for (const m of b.malamibes) {
    const fin = m.diedRound === undefined
      ? 'en vie à la fin'
      : m.withSummoner ? `morte M${m.diedRound} avec son invocateur` : `tuée M${m.diedRound}${m.killer ? ` par ${m.killer}` : ''}`
    L.push(`${m.name} : invoquée M${m.round} par ${m.summoner ?? '?'}, ${m.maxHp} PV max, ${m.turnsPlayed} tour(s) joué(s), ${fin} ; dégâts reçus ${m.damage.renvoi} renvoyés + ${m.damage.direct} directs`)
  }

  L.push('', '── Krobes ──')
  for (const k of b.krobes) {
    const cd = k.countdowns.map(c => `M${c.round}${c.during ? ` (${c.during})` : ''} ${c.cause}`).join(' ; ')
    // Mort attendue : 3 manches (6 pour le boss) après la dernière relance, au même moment de la manche (combat du
    // 2026-10-14 : Tabacilles relancés au début du combat → morts au début de M4 ; Virustine relancée M3 → morte M6).
    const last = k.countdowns.at(-1)
    const expected = last ? ` (attendue M${last.round + (KROBES[k.monsterId]?.tours ?? 3)})` : ''
    L.push(`${k.name} (${k.startCell}) : ${k.diedRound !== undefined ? `mort M${k.diedRound}${expected}` : `vivant à la fin${expected}`} — compte à rebours : ${cd || 'jamais vu'}`)
    if (k.infections.length) L.push(`   Infection : M${k.infections.join(', M')}`)
    if (baseKrobe(k.monsterId) === PATAUGERME) {
      const rounds = [...new Set([...Object.keys(k.elementHits), ...Object.keys(k.elementStates)].map(Number))].sort((x, y) => x - y)
      for (const r of rounds) L.push(`   M${r} : éléments reçus ${(k.elementHits[r] ?? []).join('/') || '—'} ; états pris ${(k.elementStates[r] ?? []).join('/') || '—'}`)
    }
    if (baseKrobe(k.monsterId) === VIRUSTINE) {
      L.push(`   PM au début de ses tours : ${k.mpAtTurnStart.join(', ') || '?'} ; malus de poussée : ${k.mpMalus}`)
      for (const m of k.moved) L.push(`   ⚠ ${m}`)
    }
    if (k.power) L.push(`   Puissance gagnée : +${k.power}`)
  }
  if (b.heals.length) {
    const vols = b.heals.filter(h => h.volDeVie)
    L.push('', `── Soins reçus par l’équipe (réinitialisent les Tabacilles ; vol de vie : ${vols.length} soin(s), ${vols.reduce((s, h) => s + h.amount, 0)} PV) ──`)
    for (const h of b.heals.filter(x => !x.volDeVie)) L.push(`M${h.round}${h.during ? ` (${h.during})` : ''} : ${h.target} +${h.amount}${h.spell ? ` (${h.spell})` : ''}`)
  }

  L.push('', '── IA des monstres ──')
  const byMonster = new Map<string, TurnInfo[]>()
  for (const t of b.turns) if (t.kind === 'monster' && t.monsterId !== MALAMIBE && !t.dead) {
    const l = byMonster.get(t.name)
    if (l) l.push(t)
    else byMonster.set(t.name, [t])
  }
  for (const [n, list] of byMonster) {
    L.push(`${n} :`)
    for (const t of list) {
      const casts = t.casts.map(c => `${c.spell} → ${c.cible} (${c.distance} c.${c.axe ? ', ' + c.axe : ''})`).join(' ; ')
      const power = t.power ? `, Puissance ${t.power > 0 ? '+' : ''}${t.power}` : ''
      L.push(`   M${t.round} ${t.startCell}→${t.endCell}, ${t.mpUsed}/${t.mp} PM${power}, Crâ le plus proche ${fmtNearest(t.nearestStart)} → ${fmtNearest(t.nearestEnd)}, ${t.damageDealt} dégâts${casts ? ' · ' + casts : ' · aucun sort'}`)
    }
  }

  L.push('', '── Dégâts ──')
  for (const [p, d] of Object.entries(b.damageByPlayer)) L.push(`${p} → Malamibe : ${d.renvoi + d.direct} (${d.renvoi} renvoyés, ${d.direct} directs)`)
  for (const [p, per] of Object.entries(b.damageTaken)) L.push(`${p} a reçu : ${Object.entries(per).map(([m, v]) => `${m} ${v}`).join(', ')}`)
  for (const d of fallen) L.push(`✝ M${d.round} ${d.name}${d.killer ? ` (${d.killer})` : ''}`)
  if (Object.keys(b.checks.unhandled).length) L.push('', `Paquets non interprétés : ${JSON.stringify(b.checks.unhandled)}`)
  return L.join('\n')
}

function latestLog(dir: string): string {
  const files: string[] = []
  for (const d of readdirSync(dir)) {
    const p = join(dir, d)
    if (statSync(p).isDirectory()) for (const f of readdirSync(p)) if (f.startsWith('session-') && f.endsWith('.jsonl')) files.push(join(p, f))
  }
  if (!files.length) throw new Error(`Aucun journal dans ${dir}`)
  return files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1)!
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('ventre-de-la-baleine/bilan.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const file = arg('--fichier') ?? latestLog(join(process.cwd(), 'data', 'fightlogs'))
  let bilans: Bilan[]
  if (arg('--perso')) {
    const { rows, character } = loadStream(file, arg('--perso'))
    const found = baleineFights(rows)
    let which: number[]
    if (arg('--combat') !== undefined) which = [Number(arg('--combat'))]
    else if (process.argv.includes('--tous')) which = found
    else which = found.length ? [found.at(-1)!] : []
    bilans = which.map(k => bilanCombat(rows, k, { file, character }))
  } else {
    const fights = baleineFightsOfFile(file)
    let which = fights.map((_, k) => k)
    if (arg('--combat') !== undefined) {
      const k = Number(arg('--combat'))
      which = [k < 0 ? fights.length + k : k].filter(x => x >= 0 && x < fights.length)
    } else if (!process.argv.includes('--tous')) which = which.slice(-1)
    bilans = which.map(k => bilanCombat(fights[k].rows, -1, {
      file,
      mapId: fights[k].mapId,
      character: `journaux fusionnés (${Object.entries(fights[k].sources).map(([n, c]) => `${n} ${c}`).join(', ')} tours)`,
      label: `Combat ${k + 1} sur ${fights.length}`,
    }))
  }
  if (!bilans.length) {
    console.log(`${file} : aucun combat contre des Krobes.`)
    process.exit(0)
  }
  console.log(bilans.map(formatBilan).join('\n\n'))
  const out = arg('--json')
  if (out) {
    writeFileSync(out, JSON.stringify(bilans, null, 1))
    console.log(`\nBilan JSON : ${out}`)
  }
}
