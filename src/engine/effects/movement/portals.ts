/**
 * Portails Eliotrope empruntés par un DÉPLACEMENT FORCÉ (poussée, attirance, téléportation, échange, jet) —
 * mechanics.md §16, docs/research/classes/eliotrope.md §3, port D3 `PushUtils.ApplyDrag`, `DamageEffectHandler`
 * `UsePortal / RedefinePortals`, `PortalUtils`.
 *
 * Les portails sont des marques d'effects/marks.ts (glyphes `markType: 'portal'` de `FightState.glyphs`, pose 1181,
 * emprunt 1182, désactivation 1183, emprunt à la marche via `onEnterCell`). Ce module ne gère que le passage pendant
 * un déplacement forcé, que marks.ts ignore (`onEnterCell(..., { fromDrag: true })`) :
 *  - portail actif : non désactivé (`disabledUntil`), et chaîne vers au moins un autre portail de l'équipe ;
 *  - sortie : dernier maillon de la chaîne « plus proche voisin » partant du portail d'entrée, calculée sur les
 *    portails actifs de l'équipe puis privée de ceux qu'occupe un combattant (port `RedefinePortals`) ;
 *  - le voyageur doit pouvoir emprunter les portails (monstre `canUsePortal`, pas d'effet d'état 17 : Enraciné,
 *    Indéplaçable...) ; pour une poussée / attirance, au 1er tour de jeu, seuls les portails de son équipe le
 *    transportent (port `ApplyDrag` : `TeamId == fighter.TeamId || GameTurn != 1`) ;
 *  - un portail emprunté (entrée et sortie) est inactif pour le reste du même déplacement (port `Mark.Use()`) ; la
 *    sortie reste occupée par le voyageur, donc inactive tant qu'il y reste ;
 *  - une poussée qui traverse un portail continue depuis la sortie avec la force restante (movement/drag.ts).
 * Déclencheurs : 'PT' sur le voyageur, 'CPT' sur le poseur du portail d'entrée (INCERTAIN), 'PO' sur l'auteur.
 * Écart connu : marks.ts (marche) calcule la sortie avec son propre départage des égalités et sans retirer les
 * portails occupés de la chaîne ; ce module suit le port (movement/chain.ts).
 * Non modélisé ici : la projection des SORTS à travers un portail (relève du lancement de sort).
 */
import type { Engine } from '../../engine'
import type { Fighter, FightState, Glyph } from '../../types'
import { nearestChain } from './chain'
import { hasStateEffect, monsterFlag, relocate, SE_CANT_USE_PORTALS } from './common'

/** Portail centré sur `cell` (le premier posé), ou undefined. */
export function portalAt(fight: FightState, cell: number): Glyph | undefined {
  const gs = fight.glyphs
  for (let i = 0; i < gs.length; i++) if (gs[i].markType === 'portal' && gs[i].center === cell) return gs[i]
  return undefined
}

export function hasAnyPortal(fight: FightState): boolean {
  const gs = fight.glyphs
  for (let i = 0; i < gs.length; i++) if (gs[i].markType === 'portal') return true
  return false
}

function enabled(p: Glyph): boolean {
  return p.disabledUntil === undefined || p.disabledUntil < 0
}

/**
 * Portail de sortie d'un voyage commençant sur `entry` (undefined si le réseau ne mène nulle part). `used` : portails
 * déjà empruntés pendant ce déplacement (inactifs).
 */
export function portalExit(
  engine: Engine,
  fight: FightState,
  entry: Glyph,
  traveller: Fighter,
  used?: readonly Glyph[],
): Glyph | undefined {
  if (!enabled(entry) || (used !== undefined && used.includes(entry))) return undefined
  const cells: number[] = []
  for (const g of fight.glyphs) {
    if (g === entry || g.markType !== 'portal' || g.team !== entry.team || !enabled(g)) continue
    if (used !== undefined && used.includes(g)) continue
    cells.push(g.center)
  }
  if (cells.length === 0) return undefined
  const chain = nearestChain(entry.center, cells)
  // Chaîne calculée sur tous les portails actifs, puis privée de ceux qu'occupe un combattant (port RedefinePortals).
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = chain[i]
    const o = engine.fighterAt(fight, c)
    if (o !== undefined && o !== traveller) continue
    const exit = portalAt(fight, c)
    if (exit !== undefined && exit.team === entry.team) return exit
  }
  return undefined
}

/** Le combattant peut-il emprunter un portail ? (monstre `canUsePortal`, pas d'effet d'état 17 « CantUsePortals ») */
export function canUsePortal(engine: Engine, f: Fighter): boolean {
  return monsterFlag(engine, f, 'canUsePortal') && !hasStateEffect(engine, f, SE_CANT_USE_PORTALS)
}

/**
 * Transporte `f`, qui vient d'arriver sur le portail `entry`, au portail de sortie. Retourne la sortie empruntée
 * (ajoutée avec l'entrée à `used`), ou undefined si le voyage est impossible. `dragRule` : restriction du 1er tour
 * de jeu (poussées / attirances, port `ApplyDrag`). Les marques de la case de sortie restent à l'appelant.
 */
export function travelThrough(
  engine: Engine,
  fight: FightState,
  f: Fighter,
  entry: Glyph,
  used: Glyph[],
  author: Fighter | undefined,
  dragRule: boolean,
): Glyph | undefined {
  if (!f.alive || !canUsePortal(engine, f)) return undefined
  if (dragRule && entry.team !== undefined && entry.team !== f.team && fight.round === 1) return undefined
  const exit = portalExit(engine, fight, entry, f, used)
  if (exit === undefined) return undefined
  used.push(entry, exit)
  relocate(engine, fight, f, exit.center)
  const owner = fight.fighters[entry.sourceId]
  engine.trigger(fight, f, { type: 'PT', source: owner })
  if (owner !== undefined && owner.alive && !fight.ended) engine.trigger(fight, owner, { type: 'CPT', source: f })
  if (author !== undefined && author.alive && !fight.ended) engine.trigger(fight, author, { type: 'PO', source: author })
  return exit
}
