/**
 * Lanceur supposé d'une glyphe / d'un piège qui vient d'être posé (l'événement du moteur ne le
 * précise pas) : l'auteur du dernier sort lancé PENDANT le tour en cours, sinon le combattant actif.
 * Sert au réducteur (retirer les glyphes d'un mort, comme le moteur) et au journal.
 */
import type { ViewState } from './types'

export function overlayOwner(s: ViewState): number | undefined {
  if (s.lastCast && s.lastCast.index > s.turnAt) return s.lastCast.fighter
  return s.current ?? s.lastCast?.fighter ?? undefined
}
