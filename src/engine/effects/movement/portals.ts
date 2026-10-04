/**
 * Portails Eliotrope (mechanics.md §16, docs/research/classes/eliotrope.md §3, port D3 `DamageEffectHandler`
 * `HandleAddPortal / HandleDisablePortal / HandleUsePortal / UsePortal / RedefinePortals`, `PushUtils.ApplyDrag`,
 * `PortalUtils`).
 *
 * Modèle partagé avec effects/marks.ts : un portail est une glyphe `markType: 'portal'` de `FightState.glyphs`
 * (case `center`, équipe `team`, poseur `sourceId`, désactivation `disabledUntil`, bonus `portalBonusPerCell` /
 * `portalBaseBonus`). Les effets 1181 / 1182 / 1183 de ce module ne sont enregistrés que si aucune autre famille
 * (marks) ne l'a fait : ils servent de repli et suivent le même modèle.
 *
 * Règles retenues :
 *  - pose (1181) : case marchable ; un portail déjà centré sur la case est remplacé ; au plus 4 portails par ÉQUIPE
 *    (le plus ancien disparaît, port `HandleAddPortal`) ; durée infinie ; disparaît à la mort du poseur (Engine.kill) ;
 *  - portail actif : non désactivé (1183 : jusqu'au prochain début de tour du lanceur de 1183), aucun combattant
 *    vivant dessus (hors le voyageur), et une chaîne vers au moins un autre portail de l'équipe ;
 *  - sortie : dernier maillon de la chaîne « plus proche voisin » partant du portail d'entrée, calculée sur les
 *    portails actifs de l'équipe puis privée de ceux occupés (port `RedefinePortals`) ;
 *  - emprunt par un déplacement forcé (poussée, attirance, téléportation, jet) : le combattant doit pouvoir utiliser
 *    les portails (monstre `canUsePortal`, pas d'effet d'état 17) ; au 1er tour de jeu, seuls les portails de son
 *    équipe le transportent (port `ApplyDrag`) ; 1182 n'a pas cette restriction (port `UsePortal`) ;
 *  - un portail emprunté (entrée et sortie) est inactif pour le reste du même déplacement (port `Use()`) ; la sortie
 *    reste occupée par le voyageur, donc inactive tant qu'il y reste.
 * Déclencheurs : 'PT' sur le voyageur, 'CPT' sur le poseur du portail d'entrée (INCERTAIN), 'PO' sur l'auteur.
 * Non modélisé (documenté) : projection des SORTS à travers un portail (cible = sortie + (entrée − lanceur), bonus
 * `portalBaseBonus + portalBonusPerCell × Σ distances` aux dommages/soins, masques R/r, déclencheur PST) — relève du
 * lancement de sort (cast.ts) ; la marche sur un portail relève de move.ts / effects/marks.ts (`onEnterCell`).
 */
import type { Engine } from '../../engine'
import type { Fighter, FightState, Glyph } from '../../types'
import { nearestChain } from './chain'
import { hasStateEffect, isWalkable, monsterFlag, relocate, SE_CANT_USE_PORTALS } from './common'

/** Couleur d'affichage d'un portail (replay). */
export const PORTAL_COLOR = '#3fb8c9'
/** Nombre maximal de portails par équipe (port `HandleAddPortal`). */
export const MAX_PORTALS_PER_TEAM = 4

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

function occupied(engine: Engine, fight: FightState, cell: number, except: Fighter | undefined): boolean {
  const o = engine.fighterAt(fight, cell)
  return o !== undefined && o !== except
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
    if (occupied(engine, fight, c, traveller)) continue
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
 * (ajoutée à `used`), ou undefined si le voyage est impossible. `dragRule` : restriction du 1er tour de jeu
 * (poussées/attirances, port `ApplyDrag`).
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
  engine.trigger(fight, f, { type: 'PT', source: fight.fighters[entry.sourceId] })
  const owner = fight.fighters[entry.sourceId]
  if (owner !== undefined && owner.alive && !fight.ended) engine.trigger(fight, owner, { type: 'CPT', source: f })
  if (author !== undefined && author.alive && !fight.ended) engine.trigger(fight, author, { type: 'PO', source: author })
  return exit
}

// ───────────────────────────── pose / désactivation ─────────────────────────────

function removePortal(engine: Engine, fight: FightState, p: Glyph): void {
  fight.glyphs = fight.glyphs.filter(g => g !== p)
  if (fight.options.record) {
    engine.emit(fight, { t: 'glyph', glyph: { uid: p.uid, cells: p.cells, color: p.color, spellId: p.spellId }, added: false })
  }
}

/** Pose un portail de `owner` sur `cell` (effet 1181). Retourne le portail créé, ou undefined (case non marchable). */
export function addPortal(
  engine: Engine,
  fight: FightState,
  owner: Fighter,
  cell: number,
  spellId: number,
  bonus: { perCell: number; base: number } = { perCell: 2, base: 0 },
): Glyph | undefined {
  if (!isWalkable(fight, cell)) return undefined
  const existing = portalAt(fight, cell)
  if (existing !== undefined) removePortal(engine, fight, existing)
  let count = 0
  let oldest: Glyph | undefined
  for (const g of fight.glyphs) {
    if (g.markType !== 'portal' || g.team !== owner.team) continue
    count++
    oldest ??= g
  }
  if (count >= MAX_PORTALS_PER_TEAM && oldest !== undefined) removePortal(engine, fight, oldest)
  const portal: Glyph = {
    uid: engine.uid(fight),
    sourceId: owner.id,
    spellId,
    cells: [cell],
    center: cell,
    remaining: -1,
    effects: [],
    trigger: 'enter',
    color: PORTAL_COLOR,
    markType: 'portal',
    team: owner.team,
    portalBonusPerCell: bonus.perCell,
    portalBaseBonus: bonus.base,
  }
  fight.glyphs = [...fight.glyphs, portal]
  if (fight.options.record) {
    engine.emit(fight, { t: 'glyph', glyph: { uid: portal.uid, cells: portal.cells, color: portal.color, spellId }, added: true })
  }
  return portal
}

/** Désactive un portail jusqu'au prochain début de tour de `until` (effet 1183). Le glyphe est remplacé (clones). */
export function disablePortal(fight: FightState, p: Glyph, until: Fighter): void {
  fight.glyphs = fight.glyphs.map(g => (g === p ? { ...g, disabledUntil: until.id } : g))
}

/** Début du tour de `f` : réactive les portails qu'il avait désactivés (1183). */
export function reactivatePortals(fight: FightState, f: Fighter): void {
  let touched = false
  for (const g of fight.glyphs) if (g.markType === 'portal' && g.disabledUntil === f.id) touched = true
  if (!touched) return
  fight.glyphs = fight.glyphs.map(g => (g.markType === 'portal' && g.disabledUntil === f.id ? { ...g, disabledUntil: undefined } : g))
}
