/**
 * Point d'entrée du visualiseur : choix de la source du replay, thème, fichiers, API globale.
 *
 * Sources (par priorité) : balise <script type="application/json" id="replay-data"> embarquée,
 * paramètre `?replay=<url>`, sinon le replay de démonstration intégré. Le menu liste aussi les
 * replays d'un fichier facultatif `replays/index.json` ; on peut ouvrir ou déposer un fichier JSON,
 * ou appeler `window.loadReplay(replay)`.
 */
import './styles.css'
import { createDemoReplay } from '@/replay/demo'
import type { Replay } from '@/replay/types'
import { ReplayError, parseReplay } from '@/replay/validate'
import { ViewerApp } from './app'
import { applyThemePref, loadThemePref, type ThemePref } from './theme'
import { THEME_ICONS } from './ui/icons'

declare global {
  interface Window {
    /** Charge un replay (objet, tableau d'événements ou texte JSON) dans le visualiseur. */
    loadReplay: (replay: unknown, label?: string) => void
    /** API d'automatisation (captures, tests). */
    viewer: {
      app: ViewerApp
      seek(i: number, animate?: boolean): void
      play(): void
      pause(): void
      step(): void
      setSpeed(s: number): void
      select(id: number | null): void
      index(): number
      length(): number
      /** Index du premier événement satisfaisant le prédicat (après `from`). */
      find(pred: (ev: Replay['events'][number], i: number) => boolean, from?: number): number
    }
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// ───────────────────────────── thème ─────────────────────────────

let themePref: ThemePref = loadThemePref()
applyThemePref(themePref)
const app = new ViewerApp()
const themeBtn = $('theme-toggle')
const THEME_LABEL: Record<ThemePref, string> = { auto: 'automatique', light: 'clair', dark: 'sombre' }
function renderThemeButton(): void {
  themeBtn.innerHTML = THEME_ICONS[themePref]
  themeBtn.title = `Thème : ${THEME_LABEL[themePref]} (cliquer pour changer)`
}
renderThemeButton()
themeBtn.addEventListener('click', () => {
  themePref = themePref === 'auto' ? 'light' : themePref === 'light' ? 'dark' : 'auto'
  applyThemePref(themePref)
  renderThemeButton()
  app.refreshTheme()
})
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => app.refreshTheme())

// ───────────────────────────── notifications ─────────────────────────────

let toastTimer = 0
function toast(message: string, error = false): void {
  const el = $('toast')
  el.textContent = message
  el.className = `toast show${error ? ' error' : ''}`
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (el.className = `toast${error ? ' error' : ''}`), error ? 5200 : 2600)
}

// ───────────────────────────── sources ─────────────────────────────

interface Source {
  key: string
  label: string
  get: () => Promise<Replay> | Replay
}

const select = $<HTMLSelectElement>('replay-select')
const sources: Source[] = []
let currentKey = ''

function renderSelect(): void {
  select.innerHTML = sources.map(s => `<option value="${s.key}">${s.label.replace(/</g, '&lt;')}</option>`).join('')
  select.value = currentKey
}

function addSource(src: Source, front = false): void {
  const i = sources.findIndex(s => s.key === src.key)
  if (i >= 0) sources.splice(i, 1, src)
  else if (front) sources.unshift(src)
  else sources.push(src)
  renderSelect()
}

async function openSource(key: string): Promise<void> {
  const src = sources.find(s => s.key === key)
  if (!src) return
  try {
    const replay = await src.get()
    app.load(replay)
    currentKey = key
    renderSelect()
  } catch (e) {
    toast(e instanceof ReplayError ? e.message : `Impossible de charger « ${src.label} » : ${(e as Error).message}`, true)
    select.value = currentKey
  }
}

async function fetchReplay(url: string): Promise<Replay> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseReplay(await res.text())
}

select.addEventListener('change', () => void openSource(select.value))

let demoCache: Replay | null = null
addSource({ key: 'demo', label: 'Démo — Œil de Vortex (intégrée)', get: () => (demoCache ??= createDemoReplay()) })

/** Charge un replay fourni directement (fichier, API). */
function loadDirect(replay: Replay, label: string): void {
  const key = `direct:${Date.now()}`
  addSource({ key, label, get: () => replay })
  app.load(replay)
  currentKey = key
  renderSelect()
}

window.loadReplay = (input: unknown, label = 'Replay chargé') => {
  try {
    loadDirect(parseReplay(input), label)
  } catch (e) {
    toast((e as Error).message, true)
    throw e
  }
}

// Fichiers : bouton « Ouvrir » et glisser-déposer.
const fileInput = $<HTMLInputElement>('file-input')
$('open-file').addEventListener('click', () => fileInput.click())
async function readFile(file: File): Promise<void> {
  try {
    loadDirect(parseReplay(await file.text()), `Fichier : ${file.name}`)
    toast(`Replay « ${file.name} » chargé`)
  } catch (e) {
    toast(e instanceof ReplayError ? `${file.name} : ${e.message}` : `Lecture impossible : ${(e as Error).message}`, true)
  }
}
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  if (f) void readFile(f)
  fileInput.value = ''
})
let dragDepth = 0
const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
window.addEventListener('dragenter', e => {
  if (!hasFiles(e)) return
  dragDepth++
  document.body.classList.add('dragging')
})
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) document.body.classList.remove('dragging')
})
window.addEventListener('dragover', e => {
  if (hasFiles(e)) e.preventDefault()
})
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  document.body.classList.remove('dragging')
  const f = e.dataTransfer!.files[0]
  if (f) void readFile(f)
})

// API d'automatisation.
window.viewer = {
  app,
  seek: (i, animate) => app.getPlayer()?.seek(i, animate),
  play: () => app.getPlayer()?.play(),
  pause: () => app.getPlayer()?.pause(),
  step: () => app.getPlayer()?.stepForward(),
  setSpeed: s => app.getPlayer()?.setSpeed(s),
  select: id => app.selectFighter(id),
  index: () => app.getPlayer()?.index ?? -1,
  length: () => app.getTimeline()?.length ?? 0,
  find: (pred, from = 0) => {
    const ev = app.getTimeline()?.events ?? []
    for (let i = Math.max(0, from); i < ev.length; i++) if (pred(ev[i], i)) return i
    return -1
  },
}

// ───────────────────────────── démarrage ─────────────────────────────

async function loadIndex(): Promise<void> {
  if (location.protocol === 'file:') return // fetch interdit en file:// : index ignoré
  try {
    const url = new URL('replays/index.json', location.href)
    const res = await fetch(url)
    if (!res.ok) return
    const data = (await res.json()) as unknown
    const list = Array.isArray(data) ? data : (data as { replays?: unknown[] })?.replays
    if (!Array.isArray(list)) return
    list.forEach((item, k) => {
      const it = item as { file?: string; url?: string; title?: string; name?: string }
      const file = it.file ?? it.url
      if (!file) return
      const href = new URL(file, url).href
      addSource({ key: `idx:${k}`, label: it.title ?? it.name ?? file, get: () => fetchReplay(href) })
    })
  } catch {
    /* index facultatif (absent, ou page ouverte en file://) */
  }
}

async function boot(): Promise<void> {
  const embedded = document.getElementById('replay-data')
  const query = new URLSearchParams(location.search)
  const param = query.get('replay')
  // `?stress=20000` : long combat synthétique pour mesurer les performances (chargé à la demande).
  const stress = Number(query.get('stress'))
  if (stress > 0) {
    addSource({
      key: 'stress',
      label: `Stress — ${Math.round(stress)} événements`,
      get: async () => (await import('@/replay/stress')).createStressReplay({ events: stress }),
    })
  }
  if (embedded?.textContent?.trim()) {
    try {
      const replay = parseReplay(embedded.textContent)
      addSource({ key: 'embedded', label: `Embarqué — ${replay.meta?.title ?? 'combat'}`, get: () => replay }, true)
      await openSource('embedded')
    } catch (e) {
      toast(`Replay embarqué invalide : ${(e as Error).message}`, true)
    }
  } else if (param) {
    const href = new URL(param, location.href).href
    addSource({ key: 'param', label: `URL — ${param.split('/').pop()}`, get: () => fetchReplay(href) }, true)
    await openSource('param')
  } else if (stress > 0) {
    await openSource('stress')
  }
  if (!currentKey) await openSource('demo')
  void loadIndex()
}

void boot()
