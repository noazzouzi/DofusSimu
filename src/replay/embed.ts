/**
 * Embarquer un replay dans la page autonome du visualiseur (`dist-single/index.html`) :
 * balise `<script type="application/json" id="replay-data">` lue au démarrage (web/src/main.ts).
 *
 * Le JSON est échappé pour HTML : `<` → `<` (aucun `</script>` ou `<!--` ne peut fermer la
 * balise, même si un texte du journal en contient), ainsi que les séparateurs U+2028 / U+2029.
 */
import type { Replay } from './types'

/** JSON d'un replay, sûr à placer dans une balise `<script>`. */
export function replayToEmbeddedJson(replay: Replay): string {
  const { warnings: _ignored, ...data } = replay
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Insère (ou remplace) le replay embarqué dans le HTML du visualiseur autonome.
 * La balise est placée juste avant `</body>` (le script du visualiseur est différé : elle est lue
 * une fois la page analysée).
 */
export function embedReplayInHtml(html: string, replay: Replay): string {
  const tag = `<script type="application/json" id="replay-data">${replayToEmbeddedJson(replay)}</script>`
  const existing = /<script type="application\/json" id="replay-data">[\s\S]*?<\/script>/
  if (existing.test(html)) return html.replace(existing, () => tag)
  const i = html.lastIndexOf('</body>')
  return i < 0 ? html + tag : html.slice(0, i) + tag + '\n' + html.slice(i)
}
