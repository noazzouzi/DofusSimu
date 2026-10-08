/**
 * Module commun des plugins du serveur de développement (web/plugins/stuffs.ts, web/plugins/theory.ts).
 *
 *  - `sharedStore()` : données du jeu (`NodeDataStore`) chargées UNE fois, à la première demande, pour les deux plugins
 *    (la configuration de Vite est regroupée en un seul fichier : ce module n'existe qu'en un exemplaire ; un
 *    redémarrage du serveur, par exemple quand `data/ai/presets.json` change, recharge tout).
 *  - `HttpError`, `readJson`, `sendJson` : erreurs et JSON des routes (`{ error }` et code HTTP).
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

/** Corps JSON d'une requête (objet attendu, 2 Mo au plus). */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
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
