/**
 * Journal de combat en français, produit à partir des événements d'un replay.
 *
 * Un lancer de sort suivi d'un seul effet chiffré sur sa cible est fusionné en une phrase :
 *   « Iop lance Épée Divine sur Ikargn : -1 234 PV (Air, critique) »
 * Sinon chaque conséquence (dégâts de zone, retraits, buffs, poussées...) est une ligne indentée.
 */
import { ELEMENT_NAMES_FR, type Element } from '../core/types'
import type { DamageKind, FightEvent } from '../engine/types'
import { distance, isValidCell } from '../map/geometry'
import { overlayOwner } from './owner'
import type { FighterView, LogEntry, LogSeg, LogTone, ViewState } from './types'

/** Entier formaté à la française (séparateur de milliers : espace fine insécable). */
export function formatInt(n: number): string {
  const sign = n < 0 ? '-' : ''
  const digits = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ' '
    out += digits[i]
  }
  return sign + out
}

export function elementName(e: number | undefined): string | undefined {
  if (e === undefined || e < 0 || e > 4) return undefined
  return ELEMENT_NAMES_FR[e as Element]
}

const KIND_FR: Partial<Record<DamageKind, string>> = {
  indirect: 'indirect',
  push: 'poussée',
  poison: 'poison',
  trap: 'piège',
  glyph: 'glyphe',
  reflect: 'renvoi',
  steal: 'vol de vie',
}

/** Élision française : « Au tour d’Ikargn », « d’Enutrof ». */
export function startsWithVowel(word: string): boolean {
  return /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(word)
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${formatInt(n)} ${Math.abs(n) > 1 ? many : one}`
}

/** Événements qui ne sont pas des actions du combattant (un tour sans rien d'autre est « passé »). */
const PASSIVE = new Set<FightEvent['t']>(['log', 'apmp', 'unbuff', 'state', 'glyph', 'trap', 'buff', 'turnStart', 'turnEnd'])

/** Événements qui ouvrent une nouvelle action (fin du contexte d'un lancer de sort). */
const BOUNDARY = new Set<FightEvent['t']>(['cast', 'move', 'turnStart', 'turnEnd', 'roundStart', 'fightEnd', 'wave', 'tackle', 'fightStart'])

function getF(s: ViewState, id: number | undefined): FighterView | undefined {
  if (id === undefined) return undefined
  const d = s.fighters[id]
  if (d && d.id === id) return d
  return s.fighters.find(f => f.id === id)
}

export class LogBuilder {
  readonly entries: LogEntry[] = []
  private readonly merged = new Set<number>()
  private readonly spellNames = new Map<number, string>()
  private castOpen = false
  /** Combattant du tour en cours et nombre d'actions jouées depuis son `turnStart`. */
  private turnFighter: number | null = null
  private turnActions = 0

  constructor(private readonly events: FightEvent[]) {}

  private name(s: ViewState, id: number | undefined): LogSeg {
    const f = getF(s, id)
    if (!f) return { text: id === undefined || id < 0 ? 'Effet' : `#${id}`, style: 'strong' }
    return { text: f.name, fighter: f.id, team: f.team }
  }

  private push(index: number, tone: LogTone, segs: LogSeg[], fighter?: number, depth?: 0 | 1): void {
    const d: 0 | 1 = depth ?? (this.castOpen ? 1 : 0)
    this.entries.push({ index, tone, depth: d, segs, text: segs.map(x => x.text).join(''), fighter })
  }

  /** Ajoute les lignes de l'événement `ev` (index `i`) ; `s` est l'état AVANT l'événement. */
  add(s: ViewState, ev: FightEvent, i: number): void {
    if (BOUNDARY.has(ev.t)) this.castOpen = false
    if (!PASSIVE.has(ev.t)) this.turnActions++
    switch (ev.t) {
      case 'fightStart': {
        const p = ev.fighters.filter(f => f.team === 0 && f.kind !== 'summon').length
        const m = ev.fighters.filter(f => f.team === 1 && f.kind !== 'summon').length
        const segs: LogSeg[] = [{ text: 'Début du combat : ', style: 'strong' }, { text: `${plural(p, 'personnage')} contre ${plural(m, 'monstre')}` }]
        if (ev.scenario) segs.push({ text: ` — ${ev.scenario}`, style: 'muted' })
        this.push(i, 'start', segs, undefined, 0)
        break
      }
      case 'roundStart':
        this.push(i, 'round', [{ text: `Tour ${ev.round}` }], undefined, 0)
        break
      case 'turnStart': {
        this.turnFighter = ev.fighter
        this.turnActions = 0
        const who = this.name(s, ev.fighter)
        this.push(i, 'turn', [{ text: startsWithVowel(who.text) ? 'Au tour d’' : 'Au tour de ' }, who, { text: ` · ${ev.ap} PA · ${ev.mp} PM`, style: 'muted' }], ev.fighter, 0)
        break
      }
      case 'turnEnd': {
        const f = getF(s, ev.fighter)
        if (this.turnFighter === ev.fighter && this.turnActions === 0 && f?.alive)
          this.push(i, 'turn', [this.name(s, ev.fighter), { text: ' passe son tour', style: 'muted' }], ev.fighter, 1)
        this.turnFighter = null
        break
      }
      case 'move': {
        const n = Math.max(0, ev.path.length - 1)
        this.push(i, 'move', [this.name(s, ev.fighter), { text: ` se déplace de ${plural(n, 'case')}` }], ev.fighter, 0)
        break
      }
      case 'tackle': {
        const segs: LogSeg[] = [this.name(s, ev.fighter), { text: ' est taclé : ' }]
        const parts: LogSeg[] = []
        if (ev.apLost) parts.push({ text: `-${ev.apLost} PA`, style: 'ap' })
        if (ev.mpLost) parts.push({ text: `-${ev.mpLost} PM`, style: 'mp' })
        parts.forEach((p, k) => segs.push(...(k ? [{ text: ', ' }, p] : [p])))
        this.push(i, 'ap', segs, ev.fighter, 1)
        break
      }
      case 'cast':
        this.cast(s, ev, i)
        break
      case 'damage': {
        if (this.merged.has(i)) break
        const segs: LogSeg[] = [this.name(s, ev.target), { text: ' : ' }, ...damageSegs(ev)]
        this.push(i, 'damage', segs, ev.target)
        break
      }
      case 'heal':
        if (this.merged.has(i)) break
        this.push(i, 'heal', [this.name(s, ev.target), { text: ' : ' }, { text: `+${formatInt(ev.amount)} PV`, style: 'heal' }], ev.target)
        break
      case 'shield':
        if (this.merged.has(i)) break
        this.push(i, 'shield', [this.name(s, ev.target), { text: ' : ' }, { text: `+${formatInt(ev.amount)} bouclier`, style: 'shield' }], ev.target)
        break
      case 'apmp': {
        if (ev.reason === 'cast' || ev.reason === 'move') break
        // Variation déjà annoncée par le buff / la fin de buff qui la précède.
        const before = this.events[i - 1]
        if (before && (before.t === 'buff' || before.t === 'unbuff') && before.target === ev.target) break
        const f = getF(s, ev.target)
        if (!f) break
        const dAp = ev.ap - f.ap
        const dMp = ev.mp - f.mp
        if (!dAp && !dMp) break
        const parts: LogSeg[] = []
        if (dAp) parts.push({ text: `${dAp > 0 ? '+' : ''}${dAp} PA`, style: 'ap' })
        if (dMp) parts.push({ text: `${dMp > 0 ? '+' : ''}${dMp} PM`, style: 'mp' })
        const segs: LogSeg[] = [this.name(s, ev.target), { text: ' : ' }]
        parts.forEach((p, k) => segs.push(...(k ? [{ text: ', ' }, p] : [p])))
        this.push(i, dAp ? 'ap' : 'mp', segs, ev.target)
        break
      }
      case 'buff': {
        const segs: LogSeg[] = [this.name(s, ev.target), { text: ' : ' }, { text: ev.label, style: 'strong' }]
        if (ev.duration < 0) segs.push({ text: ' (permanent)', style: 'muted' })
        else if (ev.duration > 0) segs.push({ text: ` (${plural(ev.duration, 'tour')})`, style: 'muted' })
        this.push(i, 'buff', segs, ev.target)
        break
      }
      case 'unbuff': {
        const f = getF(s, ev.target)
        const b = f?.buffs.find(x => x.uid === ev.uid)
        if (!b) break
        this.push(i, 'buff', [{ text: 'Fin de « ', style: 'muted' }, { text: b.label, style: 'muted' }, { text: ' » sur ', style: 'muted' }, this.name(s, ev.target)], ev.target)
        break
      }
      case 'state':
        this.push(
          i,
          'state',
          [this.name(s, ev.target), { text: ev.added ? " entre dans l'état " : " n'est plus dans l'état " }, { text: ev.name, style: 'strong' }],
          ev.target,
        )
        break
      case 'push': {
        const n = isValidCell(ev.from) && isValidCell(ev.to) ? distance(ev.from, ev.to) : 0
        const segs: LogSeg[] = [this.name(s, ev.target)]
        segs.push({ text: n > 0 ? ` est poussé de ${plural(n, 'case')}` : ' est bloqué' })
        if (ev.collisionWith !== undefined) segs.push({ text: ' et heurte ' }, this.name(s, ev.collisionWith))
        else if (ev.collisionDamage !== undefined) segs.push({ text: ' et heurte un obstacle' })
        this.push(i, 'push', segs, ev.target)
        break
      }
      case 'teleport':
        this.push(i, 'push', [this.name(s, ev.target), { text: ev.target === s.current ? ' se téléporte' : ' est téléporté' }], ev.target)
        break
      case 'summon':
        this.push(i, 'summon', [this.name(s, ev.summoner), { text: ' invoque ' }, { text: ev.fighter.name, fighter: ev.fighter.id, team: ev.fighter.team }], ev.fighter.id)
        break
      case 'death': {
        const segs: LogSeg[] = [this.name(s, ev.target), { text: ' est vaincu' }]
        if (ev.killer !== undefined && ev.killer !== ev.target && getF(s, ev.killer)) segs.push({ text: ' par ' }, this.name(s, ev.killer))
        this.push(i, 'death', segs, ev.target)
        break
      }
      case 'glyph':
      case 'trap': {
        const data = ev.t === 'glyph' ? ev.glyph : ev.trap
        const word = ev.t === 'glyph' ? 'la glyphe' : 'le piège'
        const spell = this.spellNames.get(data.spellId)
        if (ev.added) {
          const who = overlayOwner(s)
          const segs: LogSeg[] = []
          if (who !== undefined) segs.push(this.name(s, who), { text: ` pose ${word} ` })
          else segs.push({ text: `${word[0].toUpperCase()}${word.slice(1)} ` })
          segs.push({ text: spell ?? `#${data.spellId}`, style: 'spell' }, { text: ` (${plural(data.cells.length, 'case')})`, style: 'muted' })
          this.push(i, 'overlay', segs)
        } else {
          const W = word[0].toUpperCase() + word.slice(1)
          this.push(i, 'overlay', [{ text: `${W} `, style: 'muted' }, { text: spell ?? `#${data.spellId}`, style: 'muted' }, { text: ' disparaît', style: 'muted' }])
        }
        break
      }
      case 'wave': {
        const segs: LogSeg[] = [{ text: `Vague ${ev.index}/${ev.total}`, style: 'strong' }]
        if (ev.fighters.length) {
          segs.push({ text: ' : ' })
          ev.fighters.forEach((f, k) => {
            if (k) segs.push({ text: k === ev.fighters.length - 1 ? ' et ' : ', ' })
            segs.push({ text: f.name, fighter: f.id, team: f.team })
          })
          segs.push({ text: ev.fighters.length > 1 ? ' entrent en combat' : ' entre en combat' })
        }
        this.push(i, 'wave', segs, undefined, 0)
        break
      }
      case 'log':
        this.push(i, ev.level === 'ai' ? 'ai' : ev.level === 'warn' ? 'warn' : 'info', [{ text: ev.text }])
        break
      case 'fightEnd': {
        const head = ev.winner === 0 ? 'Victoire des personnages' : ev.winner === 1 ? 'Défaite : les monstres l’emportent' : 'Match nul'
        this.push(i, 'end', [{ text: head, style: 'strong' }, { text: ` en ${plural(ev.rounds, 'tour')}` }, { text: ` (${ev.reason})`, style: 'muted' }], undefined, 0)
        break
      }
    }
  }

  private cast(s: ViewState, ev: Extract<FightEvent, { t: 'cast' }>, i: number): void {
    this.spellNames.set(ev.spellId, ev.spellName)
    const caster = getF(s, ev.fighter)
    let target: FighterView | undefined
    for (const f of s.fighters) if (f.alive && f.cell === ev.cell) target = f
    const segs: LogSeg[] = [this.name(s, ev.fighter), { text: ' lance ' }, { text: ev.spellName, style: 'spell', element: ev.element }]
    if (target && target.id !== caster?.id) segs.push({ text: ' sur ' }, this.name(s, target.id))

    // Conséquences chiffrées (jusqu'à la prochaine action) : fusion si une seule, sur la cible.
    const valued: number[] = []
    for (let j = i + 1; j < this.events.length; j++) {
      const e = this.events[j]
      if (BOUNDARY.has(e.t)) break
      if (e.t === 'damage' || e.t === 'heal' || e.t === 'shield') valued.push(j)
    }
    let mergedCrit = false
    if (target && valued.length === 1) {
      const e = this.events[valued[0]]
      if ((e.t === 'damage' || e.t === 'heal' || e.t === 'shield') && e.target === target.id) {
        this.merged.add(valued[0])
        segs.push({ text: ' : ' })
        if (e.t === 'damage') {
          segs.push(...damageSegs(e))
          mergedCrit = !!e.crit
        } else if (e.t === 'heal') segs.push({ text: `+${formatInt(e.amount)} PV`, style: 'heal' })
        else segs.push({ text: `+${formatInt(e.amount)} bouclier`, style: 'shield' })
      }
    }
    if (ev.crit && !mergedCrit) segs.push({ text: ' (coup critique)', style: 'crit' })
    this.push(i, 'action', segs, ev.fighter, 0)
    this.castOpen = true
  }
}

/** « -1 234 PV (Air, critique) » ; bouclier absorbé et types de dommages indirects inclus. */
export function damageSegs(ev: Extract<FightEvent, { t: 'damage' }>): LogSeg[] {
  const el = elementName(ev.element)
  const details: string[] = []
  if (el) details.push(el)
  const kind = KIND_FR[ev.kind]
  if (kind) details.push(kind)
  if (ev.crit) details.push('critique')
  const segs: LogSeg[] = []
  if (ev.amount > 0 || !ev.shieldAbsorbed) segs.push({ text: `-${formatInt(ev.amount)} PV`, style: 'damage', element: ev.element >= 0 ? ev.element : undefined })
  if (ev.shieldAbsorbed) {
    if (ev.amount > 0) details.push(`${formatInt(ev.shieldAbsorbed)} absorbés par le bouclier`)
    else segs.push({ text: `-${formatInt(ev.shieldAbsorbed)} bouclier`, style: 'shield' })
  }
  if (details.length) segs.push({ text: ` (${details.join(', ')})`, style: ev.crit ? 'crit' : 'muted' })
  return segs
}
