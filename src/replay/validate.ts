/**
 * Lecture et validation légère d'un replay JSON (fichier, URL, balise embarquée, window.loadReplay).
 * Formats acceptés : `{ events, map?, meta? }`, `{ replay: {...} }` ou directement un tableau d'événements.
 */
import { CELL_COUNT } from '../map/geometry'
import type { Element, TeamId } from '../core/types'
import type { MapCell, MapData } from '../data/model'
import type { DamageKind, FightEvent, FighterSnapshot } from '../engine/types'
import type { Replay } from './types'

export class ReplayError extends Error {
  override name = 'ReplayError'
}

type Raw = Record<string, unknown>

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const int = (v: unknown, def = 0): number => (num(v) ? Math.trunc(v) : def)
const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : v === undefined || v === null ? def : String(v))
const cells = (v: unknown): number[] | null => (Array.isArray(v) && v.every(num) ? (v as number[]).map(c => Math.trunc(c)) : null)

/** Instantané de combattant normalisé (valeurs par défaut sûres), ou null s'il est inutilisable. */
function snapshot(v: unknown): FighterSnapshot | null {
  if (!v || typeof v !== 'object') return null
  const f = v as Raw
  if (!num(f.id) || !num(f.cell)) return null
  const team: TeamId = f.team === 1 ? 1 : 0
  const maxHp = Math.max(1, int(f.maxHp, int(f.hp, 1)))
  const kind = f.kind === 'player' || f.kind === 'monster' || f.kind === 'summon' ? f.kind : team === 0 ? 'player' : 'monster'
  return {
    id: Math.trunc(f.id),
    team,
    kind,
    name: str(f.name, `#${f.id}`),
    breedId: num(f.breedId) ? f.breedId : undefined,
    monsterId: num(f.monsterId) ? f.monsterId : undefined,
    level: int(f.level),
    hp: Math.max(0, Math.min(maxHp, int(f.hp, maxHp))),
    maxHp,
    ap: Math.max(0, int(f.ap)),
    mp: Math.max(0, int(f.mp)),
    cell: Math.trunc(f.cell),
    summonerId: num(f.summonerId) ? f.summonerId : undefined,
    role: typeof f.role === 'string' ? f.role : undefined,
  }
}

function overlay(v: unknown): { uid: number; cells: number[]; color: string; spellId: number } | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Raw
  const c = cells(o.cells)
  if (!num(o.uid) || !c) return null
  return { uid: o.uid, cells: c, color: str(o.color, '#c9971a'), spellId: int(o.spellId) }
}

/**
 * Normalise un événement (champs numériques présents et finis, valeurs par défaut pour les
 * champs facultatifs). Retourne null si l'événement est inconnu ou inutilisable : il est ignoré
 * plutôt que de corrompre l'état (PV « NaN », combattant introuvable...).
 */
export function sanitizeEvent(v: unknown): FightEvent | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Raw
  const need = (...keys: string[]) => keys.every(k => num(e[k]))
  switch (e.t) {
    case 'fightStart': {
      if (!Array.isArray(e.fighters)) return null
      const fighters = e.fighters.map(snapshot).filter((f): f is FighterSnapshot => !!f)
      return { t: 'fightStart', mapId: int(e.mapId), seed: int(e.seed), fighters, scenario: typeof e.scenario === 'string' ? e.scenario : undefined }
    }
    case 'roundStart':
      return need('round') ? { t: 'roundStart', round: int(e.round) } : null
    case 'turnStart':
      return need('fighter') ? { t: 'turnStart', fighter: int(e.fighter), ap: Math.max(0, int(e.ap)), mp: Math.max(0, int(e.mp)) } : null
    case 'turnEnd':
      return need('fighter') ? { t: 'turnEnd', fighter: int(e.fighter) } : null
    case 'move': {
      const path = cells(e.path)
      if (!need('fighter') || !path || !path.length) return null
      return { t: 'move', fighter: int(e.fighter), path, mpUsed: Math.max(0, int(e.mpUsed, path.length - 1)) }
    }
    case 'tackle':
      return need('fighter') ? { t: 'tackle', fighter: int(e.fighter), apLost: Math.max(0, int(e.apLost)), mpLost: Math.max(0, int(e.mpLost)) } : null
    case 'cast': {
      if (!need('fighter', 'cell')) return null
      const el = num(e.element) && e.element >= 0 && e.element <= 4 ? (e.element as Element) : undefined
      return {
        t: 'cast',
        fighter: int(e.fighter),
        spellId: int(e.spellId),
        spellName: str(e.spellName, 'Sort'),
        cell: int(e.cell),
        crit: e.crit === true,
        apCost: Math.max(0, int(e.apCost)),
        zone: cells(e.zone) ?? [],
        element: el,
      }
    }
    case 'damage': {
      if (!need('target', 'amount')) return null
      const el = num(e.element) && e.element >= 0 && e.element <= 4 ? (e.element as Element) : -1
      const kinds = ['direct', 'indirect', 'push', 'poison', 'trap', 'glyph', 'reflect', 'steal']
      return {
        t: 'damage',
        source: int(e.source, -1),
        target: int(e.target),
        amount: Math.max(0, int(e.amount)),
        element: el,
        kind: (kinds.includes(e.kind as string) ? e.kind : 'direct') as DamageKind,
        shieldAbsorbed: num(e.shieldAbsorbed) && e.shieldAbsorbed > 0 ? Math.trunc(e.shieldAbsorbed) : undefined,
        erosion: num(e.erosion) && e.erosion > 0 ? Math.trunc(e.erosion) : undefined,
        crit: e.crit === true ? true : undefined,
      }
    }
    case 'heal':
    case 'shield':
      return need('target', 'amount') ? { t: e.t, source: int(e.source, -1), target: int(e.target), amount: Math.max(0, int(e.amount)) } : null
    case 'apmp':
      return need('target', 'ap', 'mp') ? { t: 'apmp', target: int(e.target), ap: Math.max(0, int(e.ap)), mp: Math.max(0, int(e.mp)), reason: str(e.reason) } : null
    case 'buff':
      return need('target', 'uid')
        ? { t: 'buff', target: int(e.target), source: int(e.source, -1), spellId: int(e.spellId), label: str(e.label, 'Effet'), duration: int(e.duration, -1), uid: int(e.uid) }
        : null
    case 'unbuff':
      return need('target', 'uid') ? { t: 'unbuff', target: int(e.target), uid: int(e.uid) } : null
    case 'state':
      return need('target', 'stateId') ? { t: 'state', target: int(e.target), stateId: int(e.stateId), name: str(e.name, `État ${e.stateId}`), added: e.added !== false } : null
    case 'push':
      if (!need('target', 'from', 'to')) return null
      return {
        t: 'push',
        target: int(e.target),
        from: int(e.from),
        to: int(e.to),
        collisionWith: num(e.collisionWith) ? Math.trunc(e.collisionWith) : undefined,
        collisionDamage: num(e.collisionDamage) ? Math.trunc(e.collisionDamage) : undefined,
      }
    case 'teleport':
      return need('target', 'from', 'to') ? { t: 'teleport', target: int(e.target), from: int(e.from), to: int(e.to) } : null
    case 'summon': {
      const fighter = snapshot(e.fighter)
      return need('summoner') && fighter ? { t: 'summon', summoner: int(e.summoner), fighter } : null
    }
    case 'death':
      return need('target') ? { t: 'death', target: int(e.target), killer: num(e.killer) ? Math.trunc(e.killer) : undefined } : null
    case 'glyph': {
      const g = overlay(e.glyph)
      return g ? { t: 'glyph', glyph: g, added: e.added !== false } : null
    }
    case 'trap': {
      const g = overlay(e.trap)
      return g ? { t: 'trap', trap: g, added: e.added !== false } : null
    }
    case 'wave': {
      if (!Array.isArray(e.fighters)) return null
      const fighters = e.fighters.map(snapshot).filter((f): f is FighterSnapshot => !!f)
      return { t: 'wave', index: int(e.index, 1), total: int(e.total, int(e.index, 1)), fighters }
    }
    case 'log': {
      const level = e.level === 'ai' || e.level === 'warn' || e.level === 'info' ? e.level : undefined
      return { t: 'log', text: str(e.text), level }
    }
    case 'fightEnd':
      return { t: 'fightEnd', winner: e.winner === 0 || e.winner === 1 ? e.winner : null, rounds: int(e.rounds), reason: str(e.reason) }
  }
  return null
}

function normalizeMap(m: unknown): MapData | undefined {
  if (!m || typeof m !== 'object') return undefined
  const map = m as Partial<MapData>
  if (!Array.isArray(map.cells) || !map.cells.length) return undefined
  const cells: MapCell[] = []
  for (let id = 0; id < CELL_COUNT; id++) {
    const c = map.cells[id] as Partial<MapCell> | undefined
    cells.push({
      id,
      walkable: c ? c.walkable !== false : false,
      los: c ? c.los !== false : true,
      placement: c?.placement === 1 || c?.placement === 2 ? c.placement : 0,
    })
  }
  return { id: Number(map.id) || 0, name: map.name, cells, approximate: map.approximate }
}

/** Valide et normalise un replay ; lève une `ReplayError` (message en français) s'il est inutilisable. */
export function parseReplay(input: unknown): Replay {
  let data: unknown = input
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch (e) {
      // Message du moteur JS (en anglais) réduit à la position de l'erreur.
      const pos = /position (\d+)/.exec((e as Error).message)?.[1]
      throw new ReplayError(`JSON invalide : le fichier n’est pas un JSON valide${pos ? ` (erreur au caractère ${Number(pos) + 1})` : ''}.`)
    }
  }
  if (Array.isArray(data)) data = { events: data }
  if (data && typeof data === 'object' && 'replay' in data && !('events' in data)) data = (data as { replay: unknown }).replay
  if (!data || typeof data !== 'object') throw new ReplayError('Le fichier ne contient pas de replay (objet JSON attendu).')
  const raw = data as { events?: unknown; map?: unknown; meta?: unknown; version?: unknown }
  if (!Array.isArray(raw.events)) throw new ReplayError('Champ « events » manquant : ce fichier n’est pas un replay DofusSimu.')
  const first = raw.events[0] as Raw | undefined
  if (!first || first.t !== 'fightStart') throw new ReplayError('Le premier événement du replay doit être « fightStart ».')
  if (!Array.isArray(first.fighters)) throw new ReplayError('L’événement « fightStart » ne contient pas de combattants.')
  const events: FightEvent[] = []
  let dropped = 0
  for (const e of raw.events) {
    const ok = sanitizeEvent(e)
    if (ok) events.push(ok)
    else dropped++
  }
  const replay: Replay = {
    version: typeof raw.version === 'number' ? raw.version : undefined,
    events,
    map: normalizeMap(raw.map),
    meta: raw.meta && typeof raw.meta === 'object' ? (raw.meta as Replay['meta']) : undefined,
  }
  if (dropped) replay.warnings = [`${dropped} événement${dropped > 1 ? 's' : ''} invalide${dropped > 1 ? 's' : ''} ignoré${dropped > 1 ? 's' : ''}`]
  return replay
}

/** Carte par défaut quand le replay n'en fournit pas : tout est marchable. */
export function defaultMap(id = 0): MapData {
  const cells: MapCell[] = []
  for (let c = 0; c < CELL_COUNT; c++) cells.push({ id: c, walkable: true, los: true, placement: 0 })
  return { id, name: 'Carte inconnue', cells, approximate: true }
}
