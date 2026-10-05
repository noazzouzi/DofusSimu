/**
 * Zones d'effet des sorts (zoneDescr DofusDB) : cellules couvertes et dégressivité.
 *
 * Référence : portage C# du code Haxe de combat de Dofus 3 (`SpellZone.cs`, .cache/domath/haxe/Tools/),
 * en suivant les fonctions `IsCellInXxxZone` (celles que le port utilise pour CIBLER : appelées avec
 * (case testée, case d'impact, case du lanceur)), complétées par les `FillXxx` quand le port est incohérent.
 * Voir docs/research/effects.md §4 et data/research/zone-and-mask-grammar.json#/zone.
 *
 * Paramètres (`ZoneSpec.size` = param1, `ZoneSpec.minSize` = param2) — rayon r, rayon minimal m :
 *  P point (r = 0) · C cercle m ≤ d ≤ r · O anneau d = r · I tout sauf le losange d < param1 ·
 *  D damier m ≤ d ≤ r et d ≡ r (mod 2) · X croix (axes) · Q croix sans centre (m ≥ 1) ·
 *  + croix diagonale · # croix diagonale sans centre (m ≥ 1) · * étoile 8 directions ·
 *  G carré (Chebyshev ≤ r) · W carré sans ses diagonales (ni le centre) · Z hors du cercle euclidien de rayon r ·
 *  L ligne depuis l'impact en s'éloignant du lanceur · / idem (dégressivité ÷2) ·
 *  l ligne depuis le LANCEUR (m = param1, r = param2 : cases à m..r du lanceur ; stopAtTarget = jusqu'à la case
 *  ciblée) · T / - ligne perpendiculaire à lanceur→impact · U demi-cercle (branches dir ± 3, vers le lanceur) ·
 *  V cône (profondeur ≤ r, largeur ≤ profondeur, orientation 4 directions) · F fourche (3 dents, orientation
 *  4 directions) · R rectangle (demi-largeur param1, profondeur param2) · B boomerang · A / a toute la carte ·
 *  ; liste explicite de cellules (`ZoneSpec.cells`).
 *
 * Distances : d = Manhattan |dx| + |dy| depuis l'impact ; le long d'une diagonale logique (direction paire),
 * les formes orientées comptent des PAS diagonaux (d >> 1), comme le client.
 *
 * Orientation (formes L, l, /, T, -, U, R, B : 8 directions ; V, F : 4 directions comme le port) :
 *  1. `opts.direction` si fourni ; 2. direction exacte lanceur → impact s'ils sont alignés ; 3. lanceur = impact :
 *  1 (8 dir.) / 3 (4 dir.), comme le port ; 4. sinon direction de déplacement la plus proche (`lookDirection4`).
 *  Écart assumé : sur un lancer non aligné, le port renvoie la direction −1 et produit des zones incohérentes
 *  (artefact) ; on oriente sur l'axe le plus proche.
 *  Drapeau `forcedDirection` (L1/L63/'/63' : Tarot « Le Fou », Audace de Dodge, Kimon...) : la direction est imposée
 *  par le moteur, à passer dans `opts.direction`. Les descriptions (« téléporté aléatoirement sur une case
 *  ADJACENTE ») indiquent une direction de déplacement tirée au hasard — INCERTAIN. Elle ne vient PAS de
 *  `maxDecreaseCount` : le port y lit `Direction`, mais l'ignore pour cibler (`IsCellInLineZone` l'écrase), et toutes
 *  ces zones ont `maxDecreaseCount = 4`, c.-à-d. une diagonale (case non adjacente). Sans `opts.direction`, la zone
 *  est orientée comme un lancer normal (comportement du port).
 *
 * Performances : zones compilées et mises en cache par objet `ZoneSpec` ; les formes en rayons (lignes, croix,
 * étoiles, T, U, B) génèrent leurs candidats le long des directions (O(r)), les autres parcourent un ordre
 * précalculé (distance croissante à l'origine de la zone) avec arrêt anticipé. Le prédicat d'appartenance reste
 * l'unique définition de chaque forme (`isCellInZone` ⇔ `zoneCells`, vérifié par les tests).
 */
import type { ZoneSpec } from '../data/model'
import {
  CELL_COUNT,
  CELL_X,
  CELL_Y,
  cellsByDistance,
  DIRECTION_DX,
  DIRECTION_DY,
  directionBetween,
  directionBetweenXY,
  isValidDirection,
  lookDirection4,
  pointToCell,
  type Point,
} from './geometry'
import { hasLineOfSight, type BlocksLos } from './los'

/** Rayon au-delà duquel le client n'applique plus de dégressivité (C63, l…,63, I...). */
export const MAX_RADIUS_DEGRESSION = 50

export interface ZoneOptions {
  /**
   * Orientation imposée (0..7), prioritaire sur la direction lanceur → impact (zones `forcedDirection` : direction
   * choisie par le moteur). Ignorée si invalide, et si paire pour les formes à 4 directions (V, F).
   */
  direction?: number
  /**
   * Blocage de la ligne de vue (obstacle ou entité) pour les zones `onlyIfInSight` : seules les cellules en
   * LdV depuis le centre de la zone sont gardées. Sans ce rappel, le drapeau est ignoré.
   */
  blocksLos?: BlocksLos
  /**
   * Optionnel, hors règle du client : coupe les lignes `stopAtTarget` (l, L, /) à la première cellule occupée
   * (incluse). Le client arrête `stopAtTarget` à la case CIBLÉE (toujours appliqué) ; ce rappel sert aux effets
   * « jusqu'à la première entité » (poussée/attirance « jusqu'à », téléportation sur la première case libre).
   */
  stopAtOccupied?: (cellId: number) => boolean
  /** Filtre final des cellules (ex. seulement les cellules marchables). */
  cellFilter?: (cellId: number) => boolean
}

/** Forme normalisée et paramètres effectifs d'une zone (après les ajustements du client). */
export interface CompiledZone {
  readonly shape: string
  /** Rayon effectif (O : param1 ; I : 63 ; l : param2 ; P : 0 ; R : ≥ 1). */
  readonly radius: number
  /** Rayon minimal effectif (O : param1 ; I : param1 ; l : param1 ; Q/# : ≥ 1 ; R : profondeur ≥ 1). */
  readonly minRadius: number
  readonly step: number
  readonly maxTicks: number
  readonly stopAtTarget: boolean
  readonly onlyIfInSight: boolean
  /** Drapeau `forcedDirection` des données : l'orientation doit être fournie par le moteur (`opts.direction`). */
  readonly forcedDirection: boolean
  /** Orientation : aucune, 8 directions (lanceur → impact exacte), 4 directions (axes). */
  readonly orientation: 0 | 8 | 4
  /** Demi-côté de la boîte englobante autour de l'origine (en pas). */
  readonly span: number
  /** Liste explicite (forme ';'). */
  readonly cells?: readonly number[]
}

const WHOLE_MAP_SPAN = 64
/** Plus grande distance entre deux cellules : |dx| + |dy| = max(|Δ(x + y)|, |Δ(x − y)|) ≤ max(27, 39). */
const MAP_DIAMETER = 39
const SHAPES_8 = 'LlT-U/RB'
const SHAPES_4 = 'VF'

/** Caractère de forme (`shape` peut être un code ASCII dans les données brutes). */
export function shapeChar(shape: number | string): string {
  return typeof shape === 'number' ? String.fromCharCode(shape) : shape
}

const compiledCache = new WeakMap<ZoneSpec, CompiledZone>()

/** Compile (et met en cache par objet) une zone : forme normalisée, rayons effectifs, orientation. */
export function compileZone(zone: ZoneSpec): CompiledZone {
  let c = compiledCache.get(zone)
  if (!c) {
    c = buildCompiledZone(zone)
    compiledCache.set(zone, c)
  }
  return c
}

function buildCompiledZone(zone: ZoneSpec): CompiledZone {
  let shape = shapeChar(zone.shape as number | string)
  if (!shape) shape = 'P'
  const p1 = Math.max(0, zone.size | 0)
  const p2 = Math.max(0, zone.minSize | 0)
  let radius = p1
  let minRadius = 0
  switch (shape) {
    case 'P':
      radius = 0
      break
    case 'C':
    case 'X':
    case '+':
    case 'D':
      minRadius = shape === 'D' ? 0 : p2
      break
    case 'Q':
    case '#':
      minRadius = Math.max(1, p2)
      break
    case 'O':
      minRadius = p1
      break
    case 'I':
      minRadius = p1
      radius = 63
      break
    case 'l':
      minRadius = p1
      radius = p2
      break
    case 'R':
      radius = Math.max(1, p1)
      minRadius = Math.max(1, p2)
      break
    case 'A':
    case 'a':
    case ';':
    case ' ':
      radius = 63
      break
    case '*':
    case 'L':
    case '/':
    case 'T':
    case '-':
    case 'U':
    case 'V':
    case 'F':
    case 'G':
    case 'W':
    case 'B':
    case 'Z':
      break
    default:
      // Forme inconnue : traitée comme un point (comportement historique du module).
      shape = 'P'
      radius = 0
  }
  const orientation: 0 | 8 | 4 = SHAPES_8.includes(shape) ? 8 : SHAPES_4.includes(shape) ? 4 : 0
  let span = Math.max(radius, minRadius)
  if (shape === 'A' || shape === 'a' || shape === 'I' || shape === 'Z' || span >= WHOLE_MAP_SPAN) span = WHOLE_MAP_SPAN
  return {
    shape,
    radius,
    minRadius,
    step: Math.max(0, zone.decreaseStepPct | 0),
    maxTicks: Math.max(0, zone.maxDecreaseCount | 0),
    stopAtTarget: !!zone.stopAtTarget,
    onlyIfInSight: !!zone.onlyIfInSight,
    forcedDirection: !!zone.forcedDirection,
    orientation,
    span,
    cells: zone.cells,
  }
}

// ───────────────────────────── orientation ─────────────────────────────

/**
 * Direction (0..7) utilisée par une zone orientée lancée de `casterCell` sur `center`, ou −1 si la forme
 * n'est pas orientée. Voir l'en-tête pour l'ordre de priorité.
 */
export function zoneDirection(zone: ZoneSpec | CompiledZone, center: number, casterCell: number, opts?: ZoneOptions): number {
  const z = isCompiled(zone) ? zone : compileZone(zone)
  return orientationOf(z, center, casterCell, opts?.direction)
}

function isCompiled(z: ZoneSpec | CompiledZone): z is CompiledZone {
  return (z as CompiledZone).orientation !== undefined
}

function orientationOf(z: CompiledZone, center: number, caster: number, forced: number | undefined): number {
  if (z.orientation === 0) return -1
  if (z.orientation === 4) {
    if (forced !== undefined && isValidDirection(forced) && (forced & 1) === 1) return forced
    return lookDirection4(caster, center)
  }
  if (forced !== undefined && isValidDirection(forced)) return forced
  if (caster === center) return 1
  const exact = directionBetween(caster, center)
  return exact >= 0 ? exact : lookDirection4(caster, center)
}

/** Direction unitaire (dans le repère logique) du lanceur vers la cible ; à défaut (+1, 0). @deprecated `zoneDirection` */
export function castDirection(from: number, to: number): Point {
  const dx = CELL_X[to] - CELL_X[from]
  const dy = CELL_Y[to] - CELL_Y[from]
  if (dx === 0 && dy === 0) return { x: 1, y: 0 }
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx), y: 0 }
  return { x: 0, y: Math.sign(dy) }
}

// ───────────────────────────── cadre d'évaluation ─────────────────────────────

/** Paramètres dynamiques d'une zone posée (centre, lanceur, orientation, coupures). */
interface Frame {
  z: CompiledZone
  center: number
  caster: number
  cx: number
  cy: number
  kx: number
  ky: number
  dir: number
  /** Lignes : distance maximale effective (en pas). */
  lineMax: number
  /** Boomerang : cellules précalculées. */
  list: number[] | null
  /** Origine du parcours (lanceur pour 'l', centre sinon). */
  origin: number
  blocksLos: BlocksLos | undefined
  cellFilter: ((cellId: number) => boolean) | undefined
}

function makeFrame(z: CompiledZone, center: number, caster: number, opts: ZoneOptions | undefined): Frame {
  return initFrame(blankFrame(z), z, center, caster, opts)
}

function blankFrame(z: CompiledZone): Frame {
  return { z, center: 0, caster: 0, cx: 0, cy: 0, kx: 0, ky: 0, dir: -1, lineMax: 0, list: null, origin: 0, blocksLos: undefined, cellFilter: undefined }
}

/**
 * Cadres réutilisés par les requêtes ponctuelles (`zoneCells`, `zoneCellsInto`, `isCellInZone`) : une pile, car les
 * rappels (LdV, filtre, arrêt) peuvent réentrer dans ce module. `zoneMembership` garde son cadre : il en alloue un.
 */
const FRAME_POOL: Frame[] = []
let frameDepth = 0

function acquireFrame(z: CompiledZone, center: number, caster: number, opts: ZoneOptions | undefined): Frame {
  let f = FRAME_POOL[frameDepth]
  if (!f) FRAME_POOL[frameDepth] = f = blankFrame(z)
  frameDepth++
  try {
    return initFrame(f, z, center, caster, opts)
  } catch (e) {
    frameDepth--
    throw e
  }
}

function releaseFrame(): void {
  const f = FRAME_POOL[--frameDepth]
  // Aucune référence retenue (rappels liés à un état de combat, boomerang).
  f.list = null
  f.blocksLos = undefined
  f.cellFilter = undefined
}

function initFrame(f: Frame, z: CompiledZone, center: number, caster: number, opts: ZoneOptions | undefined): Frame {
  const casterCell = caster >= 0 && caster < CELL_COUNT ? caster : center
  f.z = z
  f.center = center
  f.caster = casterCell
  f.cx = CELL_X[center]
  f.cy = CELL_Y[center]
  f.kx = CELL_X[casterCell]
  f.ky = CELL_Y[casterCell]
  f.dir = orientationOf(z, center, casterCell, opts?.direction)
  f.lineMax = z.radius
  f.list = null
  f.origin = z.shape === 'l' ? casterCell : center
  f.blocksLos = z.onlyIfInSight ? opts?.blocksLos : undefined
  f.cellFilter = opts?.cellFilter
  if (z.shape === 'l' && z.stopAtTarget) {
    // Client (port D3 et D2 Line) : distance de Manhattan lanceur → impact, non divisée en diagonale.
    const d = Math.abs(f.cx - f.kx) + Math.abs(f.cy - f.ky)
    if (d < f.lineMax) f.lineMax = d
  }
  if (z.stopAtTarget && opts?.stopAtOccupied && (z.shape === 'l' || z.shape === 'L' || z.shape === '/')) {
    const ox = z.shape === 'l' ? f.kx : f.cx
    const oy = z.shape === 'l' ? f.ky : f.cy
    for (let k = 1; k <= f.lineMax; k++) {
      const c = pointToCell(ox + DIRECTION_DX[f.dir] * k, oy + DIRECTION_DY[f.dir] * k)
      if (c < 0) break
      if (opts.stopAtOccupied(c)) {
        f.lineMax = k
        break
      }
    }
  }
  if (z.shape === 'B') f.list = boomerangCells(f)
  return f
}

/** Boomerang (port `FillBoomerang`) : bras perpendiculaires de r − 1 cases puis un crochet (dir ± 3) vers le lanceur. */
function boomerangCells(f: Frame): number[] {
  const out: number[] = []
  const z = f.z
  const p1 = (f.dir + 2) & 7
  const p2 = (f.dir + 6) & 7
  const h1 = (f.dir + 3) & 7
  const h2 = (f.dir + 5) & 7
  let minRadius = z.minRadius
  if (minRadius === 0) {
    minRadius = 1
    out.push(f.center)
  }
  let x1 = f.cx
  let y1 = f.cy
  let x2 = f.cx
  let y2 = f.cy
  for (let r = minRadius; r < z.radius; r++) {
    x1 += DIRECTION_DX[p1]
    y1 += DIRECTION_DY[p1]
    x2 += DIRECTION_DX[p2]
    y2 += DIRECTION_DY[p2]
    pushValid(out, x1, y1)
    pushValid(out, x2, y2)
  }
  if (z.radius !== 0) {
    pushValid(out, x1 + DIRECTION_DX[h1], y1 + DIRECTION_DY[h1])
    pushValid(out, x2 + DIRECTION_DX[h2], y2 + DIRECTION_DY[h2])
  }
  return out
}

function pushValid(out: number[], x: number, y: number): void {
  const c = pointToCell(x, y)
  if (c >= 0 && !out.includes(c)) out.push(c)
}

/** Distance « en pas » le long d'une direction : Manhattan, divisée par 2 sur une diagonale logique. */
function steps(dir: number, d: number): number {
  return (dir & 1) === 1 ? d : d >> 1
}

/** Appartenance géométrique (sans filtre) d'une cellule de coordonnées (x, y) à la zone. */
function inShape(f: Frame, cell: number, x: number, y: number): boolean {
  const z = f.z
  const dx = x - f.cx
  const dy = y - f.cy
  const adx = dx < 0 ? -dx : dx
  const ady = dy < 0 ? -dy : dy
  const d = adx + ady
  const r = z.radius
  switch (z.shape) {
    case 'P':
      return d === 0
    case 'C':
    case 'O':
    case 'I':
      return d >= z.minRadius && d <= r
    case 'D':
      return d >= z.minRadius && d <= r && ((r - d) & 1) === 0
    case 'X':
    case 'Q':
      return (dx === 0 || dy === 0) && d >= z.minRadius && d <= r
    case '+':
    case '#':
      return adx === ady && adx >= z.minRadius && adx <= r
    case '*':
      return ((dx === 0 || dy === 0) && d <= r) || (adx === ady && adx <= r)
    case 'G':
      return adx <= r && ady <= r
    case 'W':
      return adx <= r && ady <= r && adx !== ady
    case 'Z':
      return dx * dx + dy * dy >= r * r
    case 'A':
    case 'a':
      return true
    case ';':
      return !!z.cells && z.cells.includes(cell)
    case ' ':
      return false
    case 'L':
    case '/': {
      if (x === f.kx && y === f.ky) return false // la case du lanceur n'est jamais dans une ligne (port)
      if (d === 0) return z.minRadius === 0
      const dir = directionBetweenXY(f.cx, f.cy, x, y)
      if (dir !== f.dir) return false
      const k = steps(dir, d)
      return k >= z.minRadius && k <= f.lineMax
    }
    case 'l': {
      if (x === f.kx && y === f.ky) return false
      const dir = directionBetweenXY(f.kx, f.ky, x, y)
      if (dir !== f.dir) return false
      const k = steps(dir, Math.abs(x - f.kx) + Math.abs(y - f.ky))
      return k >= z.minRadius && k <= f.lineMax
    }
    case 'T':
    case '-': {
      if (d === 0) return true
      const dir = directionBetweenXY(f.cx, f.cy, x, y)
      if (dir !== ((f.dir + 2) & 7) && dir !== ((f.dir + 6) & 7)) return false
      return steps(dir, d) <= r
    }
    case 'U': {
      if (d === 0) return true
      const dir = directionBetweenXY(f.cx, f.cy, x, y)
      if (dir !== ((f.dir + 3) & 7) && dir !== ((f.dir + 5) & 7)) return false
      return steps(dir, d) <= r
    }
    case 'V':
      switch (f.dir) {
        case 1:
          return dx >= 0 && dx <= r && ady <= dx
        case 3:
          return dy <= 0 && dy >= -r && adx <= -dy
        case 5:
          return dx <= 0 && dx >= -r && ady <= -dx
        case 7:
          return dy >= 0 && dy <= r && adx <= dy
        default:
          return false
      }
    case 'F': {
      // Fourche orientée à l'opposé du lanceur (port IsCellInForkZone), profondeur 0..r (port FillForkCells).
      const sign = f.dir === 5 || f.dir === 3 ? -1 : 1
      const along = f.dir === 1 || f.dir === 5
      const a = (along ? dx : dy) * sign
      const b = along ? dy : dx
      return a >= 0 && a <= r && (b === a || b === 0 || b === -a)
    }
    case 'R': {
      // Rectangle : demi-largeur r perpendiculaire, profondeur 0..m depuis l'impact (port IsCellInRectangleZone).
      const sign = f.dir === 5 || f.dir === 3 ? -1 : 1
      const lateral = f.dir === 7 || f.dir === 3 ? adx : ady
      const depth = (f.dir === 7 || f.dir === 3 ? dy : dx) * sign
      return lateral <= r && depth >= 0 && depth <= z.minRadius
    }
    case 'B':
      return f.list!.includes(cell)
    default:
      return d === 0
  }
}

function inFrame(f: Frame, cell: number): boolean {
  if (!inShape(f, cell, CELL_X[cell], CELL_Y[cell])) return false
  if (f.blocksLos && cell !== f.center && !hasLineOfSight(f.center, cell, f.blocksLos)) return false
  return !f.cellFilter || f.cellFilter(cell)
}

// ───────────────────────────── ordre de parcours ─────────────────────────────

/** Directions des rayons des formes en étoile / croix (relatives ou absolues). */
const ORTHO_DIRS = [1, 3, 5, 7]
const DIAG_DIRS = [0, 2, 4, 6]
const ALL_DIRS = [0, 1, 2, 3, 4, 5, 6, 7]
/** Clés de tri (aucun rappel extérieur pendant son utilisation). */
const sortScratch = new Int32Array(CELL_COUNT)

/**
 * Formes « en rayons » (lignes, croix, étoiles, demi-cercles) : candidats générés le long des directions (O(r))
 * au lieu d'un balayage ; chaque candidat est ensuite validé par le prédicat (`inFrame`), qui reste la seule
 * définition de la zone. Résultat trié par (distance à l'origine, id). Renvoie false si la forme n'est pas
 * concernée.
 */
function collectRays(f: Frame, out: number[]): boolean {
  const z = f.z
  let dirs: readonly number[]
  let ox = f.cx
  let oy = f.cy
  let from = 1
  let to = z.radius
  switch (z.shape) {
    case 'L':
    case '/':
      dirs = [f.dir]
      from = 0
      to = f.lineMax
      break
    case 'l':
      dirs = [f.dir]
      ox = f.kx
      oy = f.ky
      to = f.lineMax
      break
    case 'T':
    case '-':
      dirs = [(f.dir + 2) & 7, (f.dir + 6) & 7]
      break
    case 'U':
      dirs = [(f.dir + 3) & 7, (f.dir + 5) & 7]
      break
    case 'X':
    case 'Q':
      dirs = ORTHO_DIRS
      break
    case '+':
    case '#':
      dirs = DIAG_DIRS
      break
    case '*':
      dirs = ALL_DIRS
      break
    case 'B':
      for (const c of f.list!) if (inFrame(f, c)) out.push(c)
      sortByOrigin(f, out)
      return true
    default:
      return false
  }
  if (to > WHOLE_MAP_SPAN) to = WHOLE_MAP_SPAN
  // Candidats ajoutés directement à `out` : les rappels (LdV, filtre) peuvent réentrer dans ce module.
  if (z.shape !== 'l' && z.shape !== 'L' && z.shape !== '/' && inFrame(f, f.center)) out.push(f.center)
  for (const d of dirs) {
    if (d < 0) continue
    for (let k = from; k <= to; k++) {
      const c = pointToCell(ox + DIRECTION_DX[d] * k, oy + DIRECTION_DY[d] * k)
      if (c < 0) break // la carte est convexe : un rayon sorti n'y revient pas
      if (inFrame(f, c)) out.push(c)
    }
  }
  sortByOrigin(f, out)
  return true
}

/** Trie `out` par (distance de Manhattan à l'origine de la zone, id) et retire les doublons. */
function sortByOrigin(f: Frame, out: number[]): void {
  const ox = CELL_X[f.origin]
  const oy = CELL_Y[f.origin]
  const n = out.length
  for (let i = 0; i < n; i++) sortScratch[i] = (Math.abs(CELL_X[out[i]] - ox) + Math.abs(CELL_Y[out[i]] - oy)) * 1024 + out[i]
  const keys = sortScratch.subarray(0, n).sort()
  out.length = 0
  let prev = -1
  for (let i = 0; i < n; i++) {
    const c = keys[i] & 1023
    if (keys[i] !== prev) out.push(c)
    prev = keys[i]
  }
}

/** Distance de Manhattan maximale possible d'une cellule de la zone à son origine (balayage). */
function maxScanDistance(z: CompiledZone): number {
  if (z.span >= WHOLE_MAP_SPAN) return Infinity
  switch (z.shape) {
    case 'P':
      return 0
    case 'C':
    case 'O':
    case 'D':
      return z.radius
    case 'R':
      return z.radius + z.minRadius
    default:
      return 2 * z.span
  }
}

/** Zone couvrant toute la carte (A, a, et cercles qui la couvrent : C63, C40...), sans filtre ni LdV. */
function isWholeMapUnfiltered(f: Frame): boolean {
  const z = f.z
  const wholeMap = z.shape === 'A' || z.shape === 'a' || (z.shape === 'C' && z.minRadius === 0 && z.radius >= MAP_DIAMETER)
  return wholeMap && !f.blocksLos && !f.cellFilter
}

/** Toutes les cellules par (distance à `origin`, id) en tableau ordinaire (copié par `slice`, plus rapide que 560 `push`). */
const WHOLE_MAP_ORDER: (number[] | undefined)[] = new Array(CELL_COUNT)
function wholeMapOrder(origin: number): number[] {
  let a = WHOLE_MAP_ORDER[origin]
  if (!a) WHOLE_MAP_ORDER[origin] = a = Array.from(cellsByDistance(origin))
  return a
}

function collect(f: Frame, out: number[]): number[] {
  const z = f.z
  if (z.shape === ';') {
    for (const c of z.cells ?? []) if (c >= 0 && c < CELL_COUNT && !out.includes(c) && inFrame(f, c)) out.push(c)
    return out
  }
  if (z.shape === ' ') return out
  if (z.shape === 'P') {
    if (inFrame(f, f.center)) out.push(f.center)
    return out
  }
  const order = cellsByDistance(f.origin)
  // Toute la carte (A, a, et cercles qui la couvrent : C63, C40...) sans filtre : l'ordre précalculé tel quel.
  if (isWholeMapUnfiltered(f)) {
    for (let i = 0; i < CELL_COUNT; i++) out.push(order[i])
    return out
  }
  if (collectRays(f, out)) return out
  // Balayage par distance croissante à l'origine, arrêté dès que la distance dépasse le maximum de la forme.
  const maxD = maxScanDistance(z)
  const ox = CELL_X[f.origin]
  const oy = CELL_Y[f.origin]
  for (let i = 0; i < CELL_COUNT; i++) {
    const c = order[i]
    if (Math.abs(CELL_X[c] - ox) + Math.abs(CELL_Y[c] - oy) > maxD) break
    if (inFrame(f, c)) out.push(c)
  }
  return out
}

// ───────────────────────────── API ─────────────────────────────

/**
 * Cellules couvertes par une zone centrée sur `center` (case d'impact), lancée depuis `casterCell`.
 * Ordre : distance de Manhattan croissante à l'origine de la zone (le lanceur pour 'l', l'impact sinon), puis id ;
 * sauf la forme ';' (liste explicite) qui garde l'ordre des données, doublons et cellules invalides retirés.
 * Les cellules hors carte sont ignorées ; aucun filtre de marchabilité sauf `opts.cellFilter`. Nouveau tableau.
 */
export function zoneCells(zone: ZoneSpec, center: number, casterCell: number, opts?: ZoneOptions): number[] {
  if (center < 0 || center >= CELL_COUNT) return []
  const f = acquireFrame(compileZone(zone), center, casterCell, opts)
  try {
    // Toute la carte sans filtre : copie de l'ordre précalculé (même résultat que `collect`).
    if (isWholeMapUnfiltered(f)) return wholeMapOrder(f.origin).slice()
    return collect(f, [])
  } finally {
    releaseFrame()
  }
}

/** Comme `zoneCells` mais remplit `out` (vidé au préalable) pour éviter une allocation. */
export function zoneCellsInto(zone: ZoneSpec, center: number, casterCell: number, out: number[], opts?: ZoneOptions): number[] {
  out.length = 0
  if (center < 0 || center >= CELL_COUNT) return out
  const f = acquireFrame(compileZone(zone), center, casterCell, opts)
  try {
    return collect(f, out)
  } finally {
    releaseFrame()
  }
}

/** La cellule `cell` est-elle dans la zone ? (même règle que `zoneCells`, en O(1) hors LdV) */
export function isCellInZone(zone: ZoneSpec, cell: number, center: number, casterCell: number, opts?: ZoneOptions): boolean {
  if (cell < 0 || cell >= CELL_COUNT || center < 0 || center >= CELL_COUNT) return false
  const f = acquireFrame(compileZone(zone), center, casterCell, opts)
  try {
    return inFrame(f, cell)
  } finally {
    releaseFrame()
  }
}

/**
 * Prédicat d'appartenance réutilisable pour une zone posée (une seule préparation pour tester plusieurs
 * cellules, ex. les positions des combattants) : `const inZone = zoneMembership(...); inZone(f.cell)`.
 */
export function zoneMembership(
  zone: ZoneSpec,
  center: number,
  casterCell: number,
  opts?: ZoneOptions,
): (cellId: number) => boolean {
  if (center < 0 || center >= CELL_COUNT) return () => false
  const f = makeFrame(compileZone(zone), center, casterCell, opts)
  return cell => cell >= 0 && cell < CELL_COUNT && inFrame(f, cell)
}

/**
 * La zone peut-elle toucher une entité PORTÉE (état 8, sur la case du porteur) ? Le port l'exclut de toutes les
 * zones sauf la forme « a » (et « A ») ; le drapeau `includeCarried` des données l'autorise aussi (mechanics.md §12).
 */
export function zoneTargetsCarried(zone: ZoneSpec): boolean {
  const s = compileZone(zone).shape
  return s === 'a' || s === 'A' || !!zone.includeCarried
}

/** La zone touche-t-elle aussi les combattants MORTS ? Seule la forme « A » (résurrections, effets globaux). */
export function zoneTargetsDead(zone: ZoneSpec): boolean {
  return compileZone(zone).shape === 'A'
}

// ───────────────────────────── dégressivité ─────────────────────────────

/**
 * Distance de dégressivité selon la forme (port `SpellZone.GetAoeMalus`, D2 `getShapeEfficiency`) :
 * G/R/W Chebyshev ; # + - / U Manhattan >> 1 ; V/F profondeur selon la direction lanceur → impact
 * (axe d'un lancer en ligne ; Chebyshev sur une diagonale, 0 si non aligné comme le port) ; ; A a I : 0 ;
 * autres : Manhattan.
 */
export function zoneDistance(zone: ZoneSpec, center: number, cell: number, casterCell: number = center): number {
  return shapeDistance(compileZone(zone), center, cell, casterCell)
}

function shapeDistance(z: CompiledZone, center: number, cell: number, caster: number): number {
  const adx = Math.abs(CELL_X[cell] - CELL_X[center])
  const ady = Math.abs(CELL_Y[cell] - CELL_Y[center])
  switch (z.shape) {
    case ';':
    case 'A':
    case 'a':
    case 'I':
      return 0
    case 'G':
    case 'R':
    case 'W':
      return Math.max(adx, ady)
    case '#':
    case '+':
    case '-':
    case '/':
    case 'U':
      return (adx + ady) >> 1
    case 'F':
    case 'V': {
      // Lanceur = impact : le port obtient la direction 1 (quirk de GetLookDirection8Exact) → axe x.
      const dir = caster === center ? 1 : directionBetween(caster, center)
      if (dir < 0) return 0
      if (dir === 1 || dir === 5) return adx
      if (dir === 3 || dir === 7) return ady
      return Math.max(adx, ady)
    }
    default:
      return adx + ady
  }
}

/**
 * Malus de zone en % (0..100) pour la cellule `cell` : min(min(max(d − rayonMin, 0), paliers) × pas, 100),
 * rayonMin ignoré pour R ; aucun malus si le rayon effectif dépasse 50 (C63, l1,63...) ou si le pas est nul.
 * Aucun malus non plus si le rayon effectif est < 1 (point P, C0... : effects.md §4.3, D2 `getSimpleEfficiency`) ;
 * le port n'a pas ce test, mais ces zones ne contiennent que l'impact (distance 0) : seule une cible ajoutée hors
 * zone (masques C / O / K) serait concernée, et elle n'a jamais de malus.
 */
export function zoneMalusPct(zone: ZoneSpec, center: number, cell: number, casterCell: number = center): number {
  const z = compileZone(zone)
  if (z.step <= 0 || z.radius < 1 || z.radius > MAX_RADIUS_DEGRESSION) return 0
  const minEff = z.shape === 'R' ? 0 : z.minRadius
  const d = Math.max(shapeDistance(z, center, cell, casterCell) - minEff, 0)
  return Math.min(Math.min(d, z.maxTicks) * z.step, 100)
}

/**
 * Efficacité d'un effet de zone sur la cellule `cell` (1 = 100 %) : (100 − malus) / 100.
 * `casterCell` n'est utile qu'aux cônes / fourches (profondeur selon la direction du lancer).
 */
export function zoneEfficiency(zone: ZoneSpec, center: number, cell: number, casterCell: number = center): number {
  return (100 - zoneMalusPct(zone, center, cell, casterCell)) / 100
}

// ───────────────────────────── chaîne de zone ─────────────────────────────

const zoneStringCache = new Map<string, ZoneSpec>()

/**
 * Lit le format de zone des données du projet (`data/dofusdb/*.json`, scripts/fetch-dofusdb.mjs `normZone`) :
 * `'<forme><param1>,<param2>,<pas%>,<paliers>'` (ex. `'C2,1,10,4'`), et les drapeaux `zoneFlags`
 * (c = includeCarried, s = isStopAtTarget, d = forcedDirection, v = onlyAffectIfInSightLine).
 * Ce n'est PAS la chaîne `rawZone` de Dofus 2 (dont l'ordre des paramètres dépend de la forme).
 * Paramètres absents : 1, 0, 10, 4 (défauts du client). Résultat mis en cache et gelé (ne pas le modifier).
 */
export function parseZoneString(str: string, flags = '', cells?: readonly number[]): ZoneSpec {
  const key = cells ? '' : `${str}|${flags}`
  const cached = key ? zoneStringCache.get(key) : undefined
  if (cached) return cached
  const shape = str.length ? str[0] : 'P'
  const params = str
    .slice(1)
    .split(',')
    .map(s => s.trim())
  const num = (i: number, def: number) => {
    const v = params[i] !== undefined && params[i] !== '' ? Number(params[i]) : NaN
    return Number.isFinite(v) ? v : def
  }
  const zone: ZoneSpec = {
    shape,
    size: num(0, 1),
    minSize: num(1, 0),
    decreaseStepPct: num(2, 10),
    maxDecreaseCount: num(3, 4),
    stopAtTarget: flags.includes('s'),
  }
  if (flags.includes('c')) zone.includeCarried = true
  if (flags.includes('v')) zone.onlyIfInSight = true
  if (flags.includes('d')) zone.forcedDirection = true
  if (cells && cells.length) zone.cells = cells.slice()
  Object.freeze(zone)
  if (key) zoneStringCache.set(key, zone)
  return zone
}

/** Toutes les formes connues de ce module (pour les tests de couverture de la grammaire). */
export const KNOWN_SHAPES: readonly string[] = ['P', 'C', 'O', 'I', 'D', 'X', 'Q', '+', '#', '*', 'G', 'W', 'Z', 'L', '/', 'l', 'T', '-', 'U', 'V', 'F', 'R', 'B', 'A', 'a', ';', ' ']
