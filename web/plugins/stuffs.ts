/**
 * Section « Stuffs » côté Vite.
 *
 * Module virtuel `virtual:dofussimu-stuffs` : fiches de stuff des équipes de `data/teams/*.json`, calculées au démarrage
 * à partir des données du jeu, des presets et des fichiers d'équipe — exactement les builds que la CLI fait combattre
 * (`resolveComposition`). En développement, une modification de `data/teams` recharge la page ; `data/ai/presets.json`
 * étant importé par la configuration, Vite redémarre de lui-même quand il change. Inclus aussi dans la version « fichier
 * unique » (lecture seule).
 *
 * API d'édition (serveur de développement seulement, `npm run dev`), JSON, sous `/api/stuffs/` :
 *   GET  editor?scenario=vortex  classes, presets, stuffs, rôles et catalogue des objets (src/optimizer/team/editor.ts)
 *   POST preview   { scenario, drafts }                 fiches recalculées d'un brouillon d'équipe
 *   POST allocate  { breedId, primary, rest, level? }   points de caractéristiques d'une répartition
 *   POST roxx      { url }                              stuff d'un lien RoxxSolver (src/optimizer/team/roxx.ts)
 *   POST save      { name, scenario, drafts, overwrite, from? } écrit data/teams/<name>.json et renvoie ses fiches relues
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { loadDataStore, type NodeDataStore } from '../../src/data/node'
import { allocate, editorMeta, itemCatalog, previewTeam, teamFileName, type CatalogItem } from '../../src/optimizer/team/editor'
import { roxxImport } from '../../src/optimizer/team/roxx'
import { saveTeamDraft, stuffCatalog, TEAMS_DIR } from '../../src/optimizer/team/teamfile'
import type { PrimaryStat } from '../../src/stats/characteristicPoints'
import { STUFF_SHEET_VERSION, type DraftMember, type StuffCatalog } from '../../src/stats/sheet'

const VIRTUAL_ID = 'virtual:dofussimu-stuffs'
const RESOLVED_ID = `\0${VIRTUAL_ID}`
const API = '/api/stuffs/'
const PRIMARY: readonly PrimaryStat[] = ['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility']

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 2_000_000) throw new HttpError(413, 'Requête trop grosse')
    chunks.push(c as Buffer)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('objet attendu')
    return body as Record<string, unknown>
  } catch (e) {
    throw new HttpError(400, `JSON invalide : ${(e as Error).message}`)
  }
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `« ${what} » manquant`)
  return v
}
const drafts = (v: unknown): DraftMember[] => {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, '« drafts » : liste de membres attendue')
  return v as DraftMember[]
}
const primary = (v: unknown, what: string): PrimaryStat => {
  if (!PRIMARY.includes(v as PrimaryStat)) throw new HttpError(400, `« ${what} » : caractéristique inconnue`)
  return v as PrimaryStat
}

export function stuffsPlugin(): Plugin {
  let data: NodeDataStore | undefined
  let code: string | undefined
  let items: CatalogItem[] | undefined
  let editable = false
  /** Fichiers écrits par l'API : leur changement ne recharge pas la page (le client a déjà la réponse). */
  const selfWrites = new Set<string>()
  const store = () => (data ??= loadDataStore())

  const build = (): string => {
    let catalog: StuffCatalog
    try {
      catalog = { ...stuffCatalog(store()), editable }
    } catch (e) {
      catalog = { version: STUFF_SHEET_VERSION, generatedAt: new Date().toISOString(), teams: [], error: (e as Error).message }
    }
    return `export default ${JSON.stringify(catalog)}`
  }

  const invalidate = (server: ViteDevServer): void => {
    code = undefined
    const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
    if (mod) server.moduleGraph.invalidateModule(mod)
  }

  const refresh = (server: ViteDevServer, file: string): void => {
    const abs = resolve(file)
    const rel = relative(TEAMS_DIR, abs)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return
    invalidate(server)
    if (selfWrites.delete(abs)) return
    server.ws.send({ type: 'full-reload' })
  }

  async function handle(req: IncomingMessage, res: ServerResponse, server: ViteDevServer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.pathname.replace(/^\/+/, '')
    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
    }
    try {
      if (req.method === 'GET' && route === 'editor') {
        const scenario = url.searchParams.get('scenario') || 'vortex'
        items ??= itemCatalog(store())
        return send(200, { meta: editorMeta(scenario), items })
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Méthode non prise en charge')
      const body = await readJson(req)
      if (route === 'preview') return send(200, previewTeam(store(), str(body.scenario, 'scenario'), drafts(body.drafts)))
      if (route === 'allocate') {
        const breedId = Number(body.breedId)
        if (!store().breed(breedId)) throw new HttpError(400, 'Classe inconnue')
        const rest = body.rest === null || body.rest === undefined ? null : primary(body.rest, 'rest')
        const level = body.level === undefined ? undefined : Number(body.level)
        return send(200, { points: allocate(store(), breedId, { primary: primary(body.primary, 'primary'), rest }, level) })
      }
      if (route === 'roxx') return send(200, roxxImport(str(body.url, 'url'), store()))
      if (route === 'save') {
        const name = str(body.name, 'name')
        const path = join(TEAMS_DIR, teamFileName(name))
        selfWrites.add(resolve(path))
        try {
          const from = typeof body.from === 'string' ? body.from : undefined
          const team = saveTeamDraft(store(), name, str(body.scenario, 'scenario'), drafts(body.drafts), { overwrite: body.overwrite === true, from })
          invalidate(server)
          return send(200, { team })
        } catch (e) {
          selfWrites.delete(resolve(path))
          throw e
        }
      }
      throw new HttpError(404, `Route inconnue : ${route}`)
    } catch (e) {
      send(e instanceof HttpError ? e.status : 400, { error: (e as Error).message })
    }
  }

  return {
    name: 'dofussimu-stuffs',
    configResolved(config) {
      editable = config.command === 'serve'
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined
      return (code ??= build())
    },
    configureServer(server) {
      server.watcher.add(TEAMS_DIR)
      for (const ev of ['add', 'change', 'unlink'] as const) server.watcher.on(ev, file => refresh(server, file))
      server.middlewares.use(API, (req, res) => void handle(req, res, server))
    },
  }
}
