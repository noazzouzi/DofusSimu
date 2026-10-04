/**
 * Thème : lecture des variables CSS pour le rendu Canvas et bascule auto / clair / sombre.
 */

export interface Palette {
  font: string
  fontDisplay: string
  floorA: string
  floorB: string
  grid: string
  edge: string
  edge2: string
  pillarTop: string
  pillarLeft: string
  pillarRight: string
  hole: string
  hole2: string
  placement0: string
  placement1: string
  team0: string
  team0b: string
  team1: string
  team1b: string
  gold: string
  boss: string
  hpHigh: string
  hpMid: string
  hpLow: string
  hpBack: string
  shield: string
  erosion: string
  ap: string
  mp: string
  heal: string
  damage: string
  state: string
  tokenInk: string
  labelBg: string
  labelInk: string
  accent: string
  focus: string
  /** Couleurs des éléments, index = Element (0 neutre, 1 terre, 2 feu, 3 eau, 4 air). */
  elements: string[]
  dark: boolean
}

const VARS: Record<Exclude<keyof Palette, 'elements' | 'dark' | 'font' | 'fontDisplay'>, string> = {
  floorA: '--map-floor-a',
  floorB: '--map-floor-b',
  grid: '--map-grid',
  edge: '--map-edge',
  edge2: '--map-edge-2',
  pillarTop: '--map-pillar-top',
  pillarLeft: '--map-pillar-left',
  pillarRight: '--map-pillar-right',
  hole: '--map-hole',
  hole2: '--map-hole-2',
  placement0: '--placement0',
  placement1: '--placement1',
  team0: '--team0',
  team0b: '--team0-2',
  team1: '--team1',
  team1b: '--team1-2',
  gold: '--gold',
  boss: '--boss',
  hpHigh: '--hp-high',
  hpMid: '--hp-mid',
  hpLow: '--hp-low',
  hpBack: '--hp-back',
  shield: '--shield',
  erosion: '--erosion',
  ap: '--ap',
  mp: '--mp',
  heal: '--heal',
  damage: '--damage',
  state: '--state',
  tokenInk: '--token-ink',
  labelBg: '--label-bg',
  labelInk: '--label-ink',
  accent: '--accent',
  focus: '--focus',
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const get = (v: string) => css.getPropertyValue(v).trim() || '#888'
  const out = {} as Palette
  for (const [k, v] of Object.entries(VARS)) (out as unknown as Record<string, string>)[k] = get(v)
  out.elements = ['--el-neutral', '--el-earth', '--el-fire', '--el-water', '--el-air'].map(get)
  out.font = get('--font')
  out.fontDisplay = get('--font-display')
  out.dark = css.getPropertyValue('color-scheme').includes('dark')
  return out
}

export type ThemePref = 'auto' | 'light' | 'dark'
const KEY = 'dofussimu.theme'

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* stockage indisponible */
  }
  return 'auto'
}

export function applyThemePref(pref: ThemePref): void {
  const root = document.documentElement
  if (pref === 'auto') delete root.dataset.theme
  else root.dataset.theme = pref
  try {
    if (pref === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* stockage indisponible */
  }
}

/** Mélange deux couleurs hexadécimales (#rgb / #rrggbb) ; t = part de b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a)
  const pb = parseHex(b)
  if (!pa || !pb) return a
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

export function withAlpha(color: string, alpha: number): string {
  const p = parseHex(color) ?? parseRgb(color) ?? parseHex(normalizeColor(color))
  if (p) return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${alpha})`
  return color
}

function parseRgb(c: string): [number, number, number] | null {
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const [r, g, b] = m[1].split(/[\s,/]+/).filter(Boolean).map(x => parseFloat(x))
  return [r, g, b].every(Number.isFinite) ? [r, g, b] : null
}

/**
 * Couleur CSS quelconque (nom, hsl(), #rrggbbaa... — ex. couleur de glyphe fournie par le moteur)
 * → « #rrggbb » via le canvas du navigateur (mis en cache). Repli : gris.
 */
const normalized = new Map<string, string>()
let probe: CanvasRenderingContext2D | null | undefined
export function normalizeColor(color: string): string {
  let out = normalized.get(color)
  if (out) return out
  out = '#888888'
  if (probe === undefined) probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (probe) {
    probe.fillStyle = '#888888'
    probe.fillStyle = color
    const v = String(probe.fillStyle)
    if (/^#[0-9a-f]{6}$/i.test(v)) out = v
    else {
      const rgb = parseRgb(v)
      if (rgb) out = '#' + rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join('')
    }
  }
  if (normalized.size > 256) normalized.clear()
  normalized.set(color, out)
  return out
}

function parseHex(c: string): [number, number, number] | null {
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map(x => x + x).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
