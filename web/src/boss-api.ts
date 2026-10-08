/**
 * Section « Boss » — appels à l'API du serveur de développement (web/plugins/theory.ts, `npm run dev`). Les réponses
 * sont les objets du theorycraft tels quels (src/theorycraft/types.ts) ; une erreur de l'API (`{ error }`) devient une
 * exception au message français. Ce module ne touche pas au DOM.
 */
import type { BossProfileDetail } from '@/theorycraft/bossProfile'
import type { BossEntry, ClassRanking, StuffVsBossResult } from '@/theorycraft/types'
import type { TheoryPreset } from '../plugins/theory'

export type { BossEntry, BossProfileDetail, ClassRanking, StuffVsBossResult, TheoryPreset }

const API = 'api/theory/'

/** Nombre de joueurs (grade déduit) ou grade imposé. */
export type Scale = { players: number; grade?: undefined } | { grade: number; players?: undefined }

/** Profil d'exposants de l'optimiseur. */
export type ExpProfile = 'balanced' | 'defensive' | 'offensive'

export interface StuffRequest {
  preset?: string
  roxx?: string
  elements: 'preset' | 'all'
  profile: ExpProfile
  top: number
  iterations: number
}

async function call<T>(route: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new Error('Serveur injoignable : la section Boss demande le serveur de développement (« npm run dev »).')
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new Error(`Serveur indisponible (${res.status}) : la section Boss demande le serveur de développement (« npm run dev »).`)
  }
  const err = (json as { error?: string } | null)?.error
  if (!res.ok || err) throw new Error(err ?? `Erreur ${res.status}`)
  return json as T
}

const scaleQuery = (s: Scale) => (s.grade !== undefined ? `grade=${s.grade}` : `players=${s.players}`)

export const theoryApi = {
  bosses: (all: boolean) => call<BossEntry[]>(`bosses${all ? '?all=1' : ''}`),
  presets: () => call<TheoryPreset[]>('presets'),
  boss: (id: number, s: Scale) => call<BossProfileDetail>(`boss?id=${id}&${scaleQuery(s)}`),
  classes: (id: number, s: Scale, stuff: 'preset' | 'optimized') => call<ClassRanking>('classes', { id, ...s, stuff }),
  stuff: (id: number, s: Scale, req: StuffRequest) => call<StuffVsBossResult>('stuff', { id, ...s, ...req }),
}
