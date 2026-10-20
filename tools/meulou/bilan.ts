// Bilan des combats de la Tanière du Meulou, depuis le journal AnkaBot (MeulouMain.lua) : chaque combat est reconstitué
// paquet par paquet (tools/fightlog/rejeu.ts), puis résumé :
//   - combattants (PV, grade, case de départ), ordre de jeu, salle, durée, vainqueur ;
//   - chronologie tour par tour : déplacements, sorts (cible, distance), dégâts, soins, morts, invocations ;
//   - Sacrieur : dégâts par sort (lancers, coups critiques, total, moyenne), PV au début de chacun de ses tours ;
//   - dégâts reçus par le Sacrieur et par les mules, par monstre et par sort ; qui tue les mules ; invocations.
//
//   npx tsx tools/meulou/bilan.ts [--fichier data/fightlogs/…/session-….jsonl] [--perso Larry-Kind-jumploise]
//                                 [--combat n | --tous] [--court] [--json bilan.json]
// Défaut : le dernier fichier de data/fightlogs qui contient le journal du Sacrieur, tous ses combats.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ELEMENT_NAMES_FR, type Element } from '../../src/core/types'
import { distance, inDiagonal, inLine } from '../../src/map/geometry'
import { fightRange, hpOf, loadStream, MSG, rebuild, type Rebuild } from '../fightlog/rejeu'
import { data } from '../reine-des-voleurs/planificateur/etat'
import type { Row } from '../reine-des-voleurs/planificateur/journal'
import { SACRIEUR, SALLES } from './meulou'

const ELEMENT_LETTER: Record<number, string> = { [-1]: '', 0: 'N', 1: 'T', 2: 'F', 3: 'E', 4: 'A' }
/**
 * Sorts déclenchés sans intérêt pour la lecture : la Souffrance du Sacrieur (relancée à chaque variation de PV) et
 * Pourpre Profond (déclenché à chaque coup reçu par le Sacrieur, sans effet visible dans le journal).
 */
const SORTS_MUETS = /^(Souffrance( \d+)?|Pourpre Profond)$/

export interface CastLine {
  spell: string
  spellId: number
  from: number
  cell: number
  distance: number
  axe: string
  cible: string
  crit: boolean
  effets: string[]
  /** Dégâts portés par ce lancer (et les sorts qu'il déclenche), par cible. */
  degats: { cible: string; montant: number; element: string }[]
}

export interface TurnLine {
  round: number
  fighter: number
  name: string
  hp: number
  startCell: number
  endCell: number
  mpUsed: number
  casts: CastLine[]
  notes: string[]
}

export interface MeulouBilan {
  index: number
  mapId: number
  salle: string
  rounds: number
  winner: string
  debut: string
  fin: string
  fighters: { id: number; name: string; team: number; kind: string; monsterId?: number; grade?: number; level: number; hp: number; cell: number; summoner?: string }[]
  order: string[]
  turns: TurnLine[]
  sacri: {
    hpParTour: { round: number; hp: number; max: number }[]
    sorts: Record<string, { lancers: number; critiques: number; total: number; cibles: number }>
    degatsInfliges: number
    soins: number
  }
  recus: Record<string, Record<string, number>>
  morts: { round: number; cible: string; par: string; sort?: string }[]
  invocations: { round: number; par: string; invocation: string; cell: number }[]
}

/**
 * Carte d'un combat : celle notée par le journal à son début (ligne « e » fightStart, map:currentMapId), les photos
 * d'AnkaBot étant coupées en combat (FIGHT_SNAPSHOTS = false). Combats du 2026-10-19 : la salle (155713536, 155716608,
 * 155717632) ou une autre carte de la sous-zone (155714566, 155718662 : salle + 6).
 */
export function fightMap(rows: Row[], which: number): number | undefined {
  const { from } = fightRange(rows, which)
  for (let i = from; i >= 0; i--) {
    const r = rows[i] as any
    if (r.k === 'e' && r.ev === 'fightStart' && typeof r.map === 'number') return r.map
  }
  return undefined
}

/** Combats d'un flux : indices des débuts (manche 1). */
export function fightStarts(rows: Row[]): number[] {
  let n = 0
  for (const r of rows) if (r.k === 'm' && r.n === MSG.round && r.d?.fxjj === 1) n++
  return Array.from({ length: n }, (_, i) => i)
}

export function bilanMeulou(res: Rebuild, index: number, sacri = SACRIEUR): MeulouBilan {
  const fighters = res.fighters
  const name = (id?: number) => (id === undefined ? '?' : fighters[id]?.name ?? String(id))
  const short = (id?: number) => {
    const f = id === undefined ? undefined : fighters[id]
    if (!f) return '?'
    if (f.kind === 'player') return f.name
    return f.name.replace(/ -?\d+$/, '') + `#${f.id}`
  }
  const events = res.replay.events
  const ev0 = events[0]
  const cell = new Map<number, number>()
  const hp = new Map<number, number>()
  const maxHp = new Map<number, number>()
  const out: MeulouBilan = {
    index, mapId: res.mapId, salle: SALLES[res.mapId] ?? SALLES[res.mapId - 6] ?? '?', rounds: res.rounds, winner: '?',
    debut: '', fin: '', fighters: [], order: [], turns: [],
    sacri: { hpParTour: [], sorts: {}, degatsInfliges: 0, soins: 0 },
    recus: {}, morts: [], invocations: [],
  }
  if (ev0?.t === 'fightStart') for (const f of ev0.fighters) {
    cell.set(f.id, f.cell)
    hp.set(f.id, f.hp)
    maxHp.set(f.id, f.maxHp)
    out.fighters.push({ id: f.id, name: f.name, team: f.team, kind: f.kind, monsterId: f.monsterId, grade: fighters[f.id]?.grade, level: f.level, hp: f.hp, cell: f.cell })
  }
  const sacriId = fighters.find(f => f.name === sacri)?.id
  const isPlayer = (id: number) => fighters[id]?.kind === 'player'
  const occupant = (c: number) => {
    for (const [id, at] of cell) if (at === c && (hp.get(id) ?? 1) > 0) return id
    return undefined
  }
  let round = 0
  let turn: TurnLine | undefined
  let lastCast: CastLine | undefined
  const effect = (t: string) => {
    if (lastCast) lastCast.effets.push(t)
    else if (turn) turn.notes.push(t)
  }
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    switch (e.t) {
      case 'roundStart':
        round = e.round
        break
      case 'turnStart': {
        lastCast = undefined
        turn = { round, fighter: e.fighter, name: short(e.fighter), hp: hp.get(e.fighter) ?? 0, startCell: cell.get(e.fighter) ?? -1, endCell: -1, mpUsed: 0, casts: [], notes: [] }
        if ((hp.get(e.fighter) ?? 1) <= 0) turn.notes.push('(mort)')
        out.turns.push(turn)
        if (round === 1) out.order.push(short(e.fighter))
        if (e.fighter === sacriId) out.sacri.hpParTour.push({ round, hp: hp.get(e.fighter) ?? 0, max: maxHp.get(e.fighter) ?? 0 })
        break
      }
      case 'turnEnd':
        if (turn && turn.fighter === e.fighter) turn.endCell = cell.get(e.fighter) ?? -1
        turn = undefined
        lastCast = undefined
        break
      case 'move': {
        const to = e.path[e.path.length - 1]
        if (turn && turn.fighter === e.fighter) {
          turn.mpUsed += e.path.length - 1
          if (lastCast) lastCast = undefined
          turn.notes.push(`marche ${e.path[0]}→${to} (${e.path.length - 1} PM)`)
        } else effect(`${short(e.fighter)} déplacé ${e.path[0]}→${to}`)
        cell.set(e.fighter, to)
        break
      }
      case 'tackle':
        effect(`${short(e.fighter)} taclé : −${e.apLost} PA, −${e.mpLost} PM`)
        break
      case 'cast': {
        const from = cell.get(e.fighter) ?? -1
        const target = occupant(e.cell)
        if (res.voluntary.has(i) && turn && turn.fighter === e.fighter) {
          lastCast = {
            spell: e.spellName, spellId: e.spellId, from, cell: e.cell, distance: from >= 0 ? distance(from, e.cell) : -1,
            axe: from < 0 || from === e.cell ? '' : inLine(from, e.cell) ? 'ligne' : inDiagonal(from, e.cell) ? 'diag' : '',
            cible: target === undefined ? 'case vide' : target === e.fighter ? 'soi' : short(target), crit: e.crit, effets: [], degats: [],
          }
          turn.casts.push(lastCast)
          if (e.fighter === sacriId) {
            const s = (out.sacri.sorts[e.spellName] ??= { lancers: 0, critiques: 0, total: 0, cibles: 0 })
            s.lancers++
            if (e.crit) s.critiques++
          }
        } else if (lastCast && e.spellName !== lastCast.spell && !SORTS_MUETS.test(e.spellName)) lastCast.effets.push(`→ ${e.spellName}${e.crit ? ' (CC)' : ''}`)
        break
      }
      case 'damage': {
        const el = ELEMENT_LETTER[e.element] ?? String(e.element)
        hp.set(e.target, (hp.get(e.target) ?? 0) - e.amount)
        const src = e.source
        // Auteur réel : le combattant dont c'est le tour quand le coup vient d'un effet (glyphe, renvoi, poison).
        if (lastCast && turn) lastCast.degats.push({ cible: short(e.target), montant: e.amount, element: el })
        effect(`${short(e.target)} −${e.amount}${el ? ' ' + el : ''}${e.crit ? ' CC' : ''}${e.shieldAbsorbed ? ` (bouclier ${e.shieldAbsorbed})` : ''}`)
        if (src === sacriId && !isPlayer(e.target)) {
          out.sacri.degatsInfliges += e.amount
          if (lastCast && turn?.fighter === sacriId) {
            const s = out.sacri.sorts[lastCast.spell]
            if (s) {
              s.total += e.amount
              s.cibles++
            }
          }
        }
        if (isPlayer(e.target) && !isPlayer(src)) {
          const who = `${short(src).replace(/#\d+$/, '')} · ${turn?.fighter === src && lastCast ? lastCast.spell : 'effet'}`
          const per = (out.recus[name(e.target) === sacri ? sacri : 'mules'] ??= {})
          per[who] = (per[who] ?? 0) + e.amount
        }
        break
      }
      case 'heal':
        hp.set(e.target, Math.min(maxHp.get(e.target) ?? Infinity, (hp.get(e.target) ?? 0) + e.amount))
        if (e.target === sacriId) out.sacri.soins += e.amount
        effect(`${short(e.target)} +${e.amount}`)
        break
      case 'shield':
        effect(`${short(e.target)} bouclier ${e.amount}`)
        break
      case 'apmp':
        if (e.reason !== 'utilisés' && (e.ap || e.mp)) effect(`${short(e.target)} ${e.ap ? `${e.ap > 0 ? '+' : ''}${e.ap} PA ` : ''}${e.mp ? `${e.mp > 0 ? '+' : ''}${e.mp} PM` : ''}`.trim())
        break
      case 'buff':
        effect(`${short(e.target)} : ${e.label}${e.duration ? ` (${e.duration} t)` : ''}`)
        break
      case 'state':
        if (e.added) effect(`${short(e.target)} : état ${e.name}`)
        break
      case 'push':
        cell.set(e.target, e.to)
        effect(`${short(e.target)} déplacé ${e.from}→${e.to}`)
        break
      case 'teleport':
        cell.set(e.target, e.to)
        effect(`${short(e.target)} ${e.from}→${e.to}`)
        break
      case 'summon': {
        const f = e.fighter
        cell.set(f.id, f.cell)
        hp.set(f.id, f.hp)
        maxHp.set(f.id, f.maxHp)
        out.fighters.push({ id: f.id, name: f.name, team: f.team, kind: f.kind, monsterId: f.monsterId, level: f.level, hp: f.hp, cell: f.cell, summoner: short(e.summoner) })
        out.invocations.push({ round, par: short(e.summoner), invocation: short(f.id), cell: f.cell })
        effect(`invoque ${short(f.id)} en ${f.cell} (${f.hp} PV)`)
        break
      }
      case 'death': {
        hp.set(e.target, 0)
        out.morts.push({ round, cible: short(e.target), par: e.killer !== undefined ? short(e.killer) : turn ? turn.name : '?', sort: lastCast?.spell })
        effect(`✝ ${short(e.target)}`)
        break
      }
      case 'fightEnd':
        out.winner = e.winner === 0 ? 'joueurs' : e.winner === 1 ? 'monstres' : String(e.winner)
        break
    }
  }
  const at = res.replay.meta as any
  out.debut = at?.startedAt ?? ''
  void hpOf
  return out
}

export function formatBilan(b: MeulouBilan, court = false): string {
  const L: string[] = []
  const players = b.fighters.filter(f => f.kind === 'player')
  const monsters = b.fighters.filter(f => f.team === 1 && !f.summoner)
  L.push(`═══ Combat ${b.index} — carte ${b.mapId} (${b.salle}) — ${b.rounds} manches — vainqueur : ${b.winner}`)
  L.push(`Monstres (${monsters.length}) : ${monsters.map(m => `${m.name.replace(/ -?\d+$/, '')}#${m.id} g${m.grade ?? '?'} ${m.hp} PV en ${m.cell}`).join(', ')}`)
  L.push(`Joueurs (${players.length}) : ${players.map(p => `${p.name} niv ${p.level} ${p.hp} PV en ${p.cell}`).join(', ')}`)
  L.push(`Ordre de jeu : ${b.order.join(' → ')}`)
  if (!court) {
    for (const t of b.turns) {
      const casts = t.casts.map(c => {
        const deg = c.degats.reduce((s, d) => s + d.montant, 0)
        return `${c.spell}${c.crit ? ' (CC)' : ''} → ${c.cible} [${c.from}→${c.cell}, d${c.distance}${c.axe ? ' ' + c.axe : ''}]${c.effets.length ? ' : ' + c.effets.join(', ') : ''}${deg ? ` (Σ ${deg})` : ''}`
      })
      if (t.notes.includes('(mort)') || (!casts.length && !t.notes.length && t.mpUsed === 0)) continue
      L.push(`M${t.round} ${t.name} (${t.hp} PV, ${t.startCell}→${t.endCell}) ${t.notes.join(' ; ')}`)
      for (const c of casts) L.push(`     · ${c}`)
    }
  }
  L.push(`Sacrieur — PV au début de ses tours : ${b.sacri.hpParTour.map(h => `M${h.round} ${h.hp}/${h.max}`).join(', ')}`)
  L.push(`Sacrieur — dégâts infligés aux monstres : ${b.sacri.degatsInfliges}, soins reçus : ${b.sacri.soins}`)
  for (const [s, v] of Object.entries(b.sacri.sorts).sort((x, y) => y[1].total - x[1].total)) {
    L.push(`     ${s.padEnd(20)} ${v.lancers} lancer(s), ${v.critiques} CC, ${v.total} dégâts sur ${v.cibles} coup(s)${v.cibles ? `, ${Math.round(v.total / v.cibles)} par coup` : ''}`)
  }
  for (const [qui, per] of Object.entries(b.recus)) {
    const tot = Object.values(per).reduce((s, x) => s + x, 0)
    L.push(`Dégâts reçus par ${qui} : ${tot}`)
    for (const [k, v] of Object.entries(per).sort((x, y) => y[1] - x[1])) L.push(`     ${k.padEnd(40)} ${v}`)
  }
  if (b.invocations.length) L.push(`Invocations : ${b.invocations.map(x => `M${x.round} ${x.par} → ${x.invocation} en ${x.cell}`).join(', ')}`)
  L.push(`Morts : ${b.morts.map(m => `M${m.round} ${m.cible} (par ${m.par}${m.sort ? ', ' + m.sort : ''})`).join(', ')}`)
  return L.join('\n')
}

export function latestSessionWith(dir: string, perso: string): string {
  const days = existsSync(dir) ? readdirSync(dir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : []
  for (const d of days) {
    const files = readdirSync(join(dir, d)).filter(f => f.startsWith('session-') && f.endsWith('.jsonl')).map(f => join(dir, d, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    for (const f of files) {
      // (premières lignes seulement : les sessions du Féca font des centaines de Mo)
      const head = readFileSync(f, { encoding: 'utf8', flag: 'r' }).slice(0, 4000)
      if (head.includes(`"c":"${perso}"`)) return f
    }
  }
  throw new Error(`aucune session de ${perso} dans ${dir}`)
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('meulou/bilan.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const perso = arg('--perso') ?? SACRIEUR
  const file = arg('--fichier') ?? latestSessionWith(join(process.cwd(), 'data', 'fightlogs'), perso)
  const { rows } = loadStream(file, perso)
  const all = fightStarts(rows)
  const which = arg('--combat') !== undefined ? [Number(arg('--combat'))] : all
  console.log(`Fichier : ${file} — ${all.length} combat(s) dans le journal de ${perso}\n`)
  const bilans: MeulouBilan[] = []
  for (const k of which) {
    try {
      const res = rebuild(rows, { which: k, mapId: fightMap(rows, k) })
      const b = bilanMeulou(res, k, perso)
      bilans.push(b)
      console.log(formatBilan(b, process.argv.includes('--court')) + '\n')
    } catch (err) {
      console.log(`Combat ${k} : ${(err as Error).message}\n`)
    }
  }
  const json = arg('--json')
  if (json) writeFileSync(json, JSON.stringify(bilans, null, 2))
  void data
  void ELEMENT_NAMES_FR
  void (0 as unknown as Element)
}
