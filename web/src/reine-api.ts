/**
 * Section « Reine » — appels à l'API du serveur de développement (web/plugins/reine.ts, `npm run dev`). Une erreur de
 * l'API (`{ error }`) devient une exception au message français. Ce module ne touche pas au DOM.
 */
import type { Replay } from '@/replay/types'
import type { Snapshot } from '../../tools/reine-des-voleurs/planificateur/etat'
import type { ActualTurn, CellDanger, JournalInfo, Notice, WebPlacement, WebPlan, WebTeam } from '../../tools/reine-des-voleurs/planificateur/web'

export type { ActualTurn, CellDanger, JournalInfo, Notice, Snapshot, WebPlacement, WebPlan, WebTeam }

/** État affichable : instantané, replay réduit à son état (carte), dangers, et ce qui a été joué (journal). */
export interface ReineView {
  snapshot: Snapshot
  replay: Replay
  danger: CellDanger[]
  actual?: ActualTurn
  /** Mode direct : provenance et heure de l'état, `stale` s'il ne s'agit pas d'un combat en cours. */
  notice?: Notice
}

export interface PlanResult {
  plans: WebPlan[]
  unsafe: WebPlan[]
  evaluated: number
  ms: number
}

const API = 'api/reine/'

async function call<T>(route: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new Error('Serveur injoignable : la section Reine demande le serveur de développement (« npm run dev »).')
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new Error(`Serveur indisponible (${res.status}) : la section Reine demande le serveur de développement (« npm run dev »).`)
  }
  const err = (json as { error?: string } | null)?.error
  if (!res.ok || err) throw new Error(err ?? `Erreur ${res.status}`)
  return json as T
}

export const reineApi = {
  journal: () => call<JournalInfo>('journal'),
  etat: (source: 'direct' | 'nouveau' | { round: number; player: number }) =>
    call<ReineView>(typeof source === 'string' ? `etat?source=${source}` : `etat?source=journal&manche=${source.round}&joueur=${source.player}`),
  vue: (snapshot: Snapshot) => call<ReineView>('vue', { snapshot }),
  round: (round: number) => call<{ replay: Replay; turns: { round: number; name: string; actions: string[]; endCell: number; realEnd?: number; alive: boolean }[]; deaths: string[] }>(`round?manche=${round}`),
  plan: (snapshot: Snapshot, top = 5) => call<PlanResult>('plan', { snapshot, top }),
  team: (snapshot: Snapshot) => call<WebTeam>('meilleur-round', { snapshot }),
  placement: (snapshot: Snapshot) => call<WebPlacement>('placement', { snapshot }),
  animation: (snapshot: Snapshot, steps: WebPlan['steps'], title: string) =>
    call<Replay>('animation', { snapshot, steps: steps.map(s => (s.kind === 'move' ? s : { kind: 'cast', spell: s.spell, cell: s.cell })), title }),
}
