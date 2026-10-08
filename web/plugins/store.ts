/**
 * Module commun des plugins du serveur de développement (web/plugins/stuffs.ts, web/plugins/theory.ts).
 *
 *  - `sharedStore()` : données du jeu (`NodeDataStore`) chargées UNE fois, à la première demande, pour les deux plugins
 *    (la configuration de Vite est regroupée en un seul fichier : ce module n'existe qu'en un exemplaire ; un
 *    redémarrage du serveur, par exemple quand `data/ai/presets.json` change, recharge tout).
 *  - `HttpError`, `readJson`, `sendJson` : erreurs et JSON des routes (`{ error }` et code HTTP) ; `readJson` n'accepte
 *    qu'un corps JSON envoyé par la page elle-même (`assertOwnPage`) : une page tierce ouverte dans le navigateur ne
 *    peut ni lancer un calcul long du theorycraft ni écrire un fichier d'équipe.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadDataStore, type NodeDataStore } from '../../src/data/node'

let data: NodeDataStore | undefined

/** Données du jeu partagées par les plugins (chargées à la première demande). */
export function sharedStore(): NodeDataStore {
  return (data ??= loadDataStore())
}

/** Erreur d'une route : code HTTP et message (français) renvoyé au client dans `{ error }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Requête de la page elle-même, sinon erreur : corps déclaré JSON (`Content-Type: application/json`, 415 sinon — une
 * page tierce peut envoyer sans contrôle CORS préalable un POST « simple », text/plain ou formulaire, mais pas un
 * JSON), et `Sec-Fetch-Site` « same-origin » — à défaut (navigateur ancien, outil), `Origin` absente ou du même hôte
 * que le serveur (403 sinon). Les appels de l'interface (web/src/boss-api.ts, web/src/stuffs-editor.ts) remplissent
 * ces conditions.
 */
export function assertOwnPage(req: IncomingMessage): void {
  const type = req.headers['content-type'] ?? ''
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, `Corps JSON attendu (Content-Type: application/json, reçu ${type ? `« ${type} »` : 'aucun'})`)
  // Navigateurs récents : Sec-Fetch-Site (fiable derrière un mandataire qui réécrit Host) ; sinon Origin contre Host.
  const site = req.headers['sec-fetch-site']
  if (site !== undefined) {
    if (site !== 'same-origin' && site !== 'none') throw new HttpError(403, `Requête d'une autre page refusée (Sec-Fetch-Site: ${site})`)
    return
  }
  const origin = req.headers.origin
  if (origin !== undefined) {
    let host: string | undefined
    try {
      host = new URL(origin).host
    } catch {
      host = undefined
    }
    if (!host || host !== req.headers.host) throw new HttpError(403, `Requête d'une autre origine refusée (${origin})`)
  }
}

/** Corps JSON d'une requête de la page (`assertOwnPage`), objet attendu, 2 Mo au plus. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  assertOwnPage(req)
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

/** Réponse JSON. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
