/**
 * Section « Reine » (planificateur de tour contre la Reine des Voleurs, tools/reine-des-voleurs/planificateur) côté
 * Vite : API JSON du serveur de développement seulement (`npm run dev`), sous `/api/reine/` :
 *   GET  journal                                   tours des Crâs du dernier combat de data/fightlogs (`JournalInfo`)
 *   GET  etat?source=journal&manche=&joueur=       état au début d'un tour du journal, et ce qui a été joué
 *   GET  etat?source=direct                        placement en cours, sinon début du dernier tour enregistré (avec
 *                                                  `notice` : provenance et heure, `stale` si pas de combat en cours)
 *   GET  etat?source=nouveau                       début d'un nouveau combat (placement à ajuster)
 *        → { snapshot, actual?, replay, danger }
 *   GET  round?manche=                             manche du journal rejouée : actions réelles des Crâs, monstres simulés
 *                                                  (tools/reine-des-voleurs/planificateur/round.ts) → { replay, turns, deaths }
 *   POST vue       { snapshot }                    état modifié dans la page : bombe du Crâ actif replacée, replay, dangers
 *   POST plan      { snapshot, top? }              meilleurs tours (`planForWeb`)
 *   POST animation { snapshot, steps, title? }     replay d'un tour (onglet « Combats »)
 *   POST meilleur-round { snapshot }               meilleure suite de tours des 4 Crâs sur la manche, monstres simulés
 *                                                  entre deux Crâs (equipe.ts, `teamForWeb`) ; ≈ 15 à 30 s
 *   POST placement { snapshot }                    meilleur placement des Crâs sur les cases rouges pour les positions
 *                                                  des monstres (placement.ts, `placementForWeb`) ; ≈ 1 min
 * Erreurs : `{ error }` et code HTTP, comme web/plugins/theory.ts (POST : JSON de la page elle-même, `readJson`).
 *
 * Le planificateur (données du jeu 3.7, .cache/data-3.7) n'est chargé qu'à la première demande. Calculs synchrones :
 * ≈ 1 à 2 s pour les meilleurs tours.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { Snapshot } from '../../tools/reine-des-voleurs/planificateur/etat'
import type { PlanStep } from '../../tools/reine-des-voleurs/planificateur/recherche'
import { HttpError, readJson, sendJson } from './store'

const API = '/api/reine/'
type Web = typeof import('../../tools/reine-des-voleurs/planificateur/web')
let web: Promise<Web> | undefined
const planner = () => (web ??= import('../../tools/reine-des-voleurs/planificateur/web'))

/** Instantané reçu de la page : forme minimale vérifiée (le reste est lu tel quel par le planificateur). */
function snapshotParam(v: unknown): Snapshot {
  const s = v as Snapshot
  if (!s || typeof s !== 'object' || !Array.isArray(s.entities) || typeof s.active !== 'number' || typeof s.round !== 'number' || !Array.isArray(s.order))
    throw new HttpError(400, 'Instantané invalide (entities, active, round, order attendus)')
  for (const e of s.entities) {
    if (!e || typeof e.gameId !== 'number' || typeof e.cell !== 'number' || !['cra', 'monster', 'bomb'].includes(e.kind))
      throw new HttpError(400, 'Entité invalide dans l’instantané')
  }
  if (!s.entities.some(e => e.gameId === s.active && e.kind === 'cra')) throw new HttpError(400, 'Le Crâ actif est absent de l’instantané')
  return s
}

function stepsParam(v: unknown): PlanStep[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'Étapes du tour attendues (steps)')
  return v.map(s => {
    if (s?.kind === 'move' && Array.isArray(s.path) && s.path.every((c: unknown) => Number.isInteger(c))) return { kind: 'move', path: s.path }
    if (s?.kind === 'cast' && Number.isInteger(s.spell) && Number.isInteger(s.cell)) return { kind: 'cast', spell: s.spell, cell: s.cell }
    throw new HttpError(400, 'Étape de tour invalide')
  })
}

/** Aiguillage des routes (voir l'en-tête). */
export async function reineRoute(method: string, route: string, query: URLSearchParams, body: Record<string, unknown> | undefined): Promise<unknown> {
  const w = await planner()
  const view = (snap: Snapshot) => ({ snapshot: snap, replay: w.stateReplay(snap), danger: w.dangerMap(snap) })
  route = route.replace(/^\/+|\/+$/g, '')
  if (method === 'GET' && route === 'journal') return w.journalInfo()
  if (method === 'GET' && route === 'etat') {
    const source = query.get('source') ?? 'direct'
    if (source === 'nouveau') return view(w.newFightSnapshot())
    if (source === 'direct') {
      const r = w.journalSnapshot()
      return { ...view(r.snap), actual: r.actual, notice: r.notice }
    }
    if (source === 'journal') {
      const round = Number(query.get('manche'))
      const player = Number(query.get('joueur'))
      if (!Number.isInteger(round) || !Number.isFinite(player)) throw new HttpError(400, 'manche et joueur attendus')
      const r = w.journalSnapshot(round, player)
      return { ...view(r.snap), actual: r.actual }
    }
    throw new HttpError(400, `Source inconnue : ${source}`)
  }
  if (method === 'GET' && route === 'round') {
    const round = Number(query.get('manche'))
    if (!Number.isInteger(round) || round < 1) throw new HttpError(400, 'manche attendue')
    return w.journalRound(round)
  }
  if (method === 'POST' && route === 'vue') return view(w.prepare(snapshotParam(body?.snapshot)))
  if (method === 'POST' && route === 'plan') {
    const top = Math.max(1, Math.min(10, Number(body?.top ?? 5) || 5))
    return w.planForWeb(snapshotParam(body?.snapshot), top)
  }
  if (method === 'POST' && route === 'animation') {
    const title = typeof body?.title === 'string' ? body.title.slice(0, 120) : 'Tour planifié'
    return w.planReplay(snapshotParam(body?.snapshot), stepsParam(body?.steps), title)
  }
  if (method === 'POST' && route === 'meilleur-round') return w.teamForWeb(snapshotParam(body?.snapshot))
  if (method === 'POST' && route === 'placement') return w.placementForWeb(snapshotParam(body?.snapshot))
  if (['journal', 'etat', 'round', 'vue', 'plan', 'animation', 'meilleur-round', 'placement'].includes(route)) throw new HttpError(405, `Méthode ${method} non prise en charge pour « ${route} »`)
  throw new HttpError(404, `Route inconnue : ${route}`)
}

/** Plugin Vite : API `/api/reine/` du serveur de développement (aucun effet sur `vite build`). */
export function reinePlugin(): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      const method = req.method ?? 'GET'
      const body = method === 'POST' ? await readJson(req) : undefined
      sendJson(res, 200, await reineRoute(method, url.pathname, url.searchParams, body))
    } catch (e) {
      sendJson(res, e instanceof HttpError ? e.status : 500, { error: (e as Error).message })
    }
  }
  return {
    name: 'dofussimu-reine',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(API, (req, res) => void handle(req, res))
    },
  }
}
