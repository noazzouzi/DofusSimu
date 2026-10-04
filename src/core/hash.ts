/**
 * Hachages 32 bits déterministes (mêmes résultats en Node et dans le navigateur : uniquement des opérations entières).
 *
 *  - `mix32(a, b)` : combinaison de deux entiers (splitmix32 de `a ^ imul(b, 0x9e3779b9)`) — graines dérivées
 *    (re-semis des dés par tour, E1 ; graines de l'IA, docs/design/ai.md §13.1) ;
 *  - `fnv1a32` : FNV-1a sur une chaîne (empreintes de configurations, clés de cache).
 */

/** Finaliseur splitmix32 : bijection 32 bits bien mélangée (résultat non signé). */
export function splitmix32(x: number): number {
  let z = (x + 0x9e3779b9) | 0
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
  return (z ^ (z >>> 16)) >>> 0
}

/** Combine deux entiers 32 bits : `splitmix32(a ^ imul(b, 0x9e3779b9))` (résultat non signé, déterministe). */
export function mix32(a: number, b: number): number {
  return splitmix32((a | 0) ^ Math.imul(b | 0, 0x9e3779b9))
}

/** FNV-1a 32 bits d'une chaîne (unités UTF-16), résultat non signé. */
export function fnv1a32(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
