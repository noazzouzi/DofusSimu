import { CELL_COUNT, MAP_WIDTH, cellToScreen } from '@/map/geometry'

// Checkpoint 0 : affichage de la grille isométrique 560 cellules (le visualiseur de combat arrive aux checkpoints suivants).
const CELL_W = 64
const CELL_H = 32

const app = document.getElementById('app')!
app.innerHTML = `
  <style>
    :root { color-scheme: light dark; --bg: #f4f1ea; --fg: #2a2620; --cell: #d9cfb8; --cell2: #cfc4aa; --line: #a89a7c; }
    @media (prefers-color-scheme: dark) { :root { --bg: #1d1b18; --fg: #ece6da; --cell: #4a4337; --cell2: #423c31; --line: #6d6250; } }
    body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif; }
    header { padding: 16px; } h1 { margin: 0 0 4px; font-size: 20px; } p { margin: 0; opacity: .8; }
    canvas { display: block; max-width: 100%; height: auto; margin: 0 16px 16px; }
  </style>
  <header><h1>DofusSimu</h1><p>Checkpoint 0 — grille de combat Dofus (560 cellules). Le moteur de combat animé arrive aux prochains checkpoints.</p></header>
  <canvas id="map"></canvas>`

const canvas = document.getElementById('map') as HTMLCanvasElement
canvas.width = MAP_WIDTH * CELL_W + CELL_W / 2
canvas.height = 40 * (CELL_H / 2) + CELL_H / 2
const ctx = canvas.getContext('2d')!
const css = getComputedStyle(document.documentElement)
for (let c = 0; c < CELL_COUNT; c++) {
  const { px, py } = cellToScreen(c, CELL_W, CELL_H)
  ctx.beginPath()
  ctx.moveTo(px + CELL_W / 2, py)
  ctx.lineTo(px + CELL_W, py + CELL_H / 2)
  ctx.lineTo(px + CELL_W / 2, py + CELL_H)
  ctx.lineTo(px, py + CELL_H / 2)
  ctx.closePath()
  ctx.fillStyle = css.getPropertyValue(c % 2 ? '--cell' : '--cell2')
  ctx.fill()
  ctx.strokeStyle = css.getPropertyValue('--line')
  ctx.stroke()
  ctx.fillStyle = css.getPropertyValue('--fg')
  ctx.font = '9px system-ui'
  ctx.textAlign = 'center'
  ctx.fillText(String(c), px + CELL_W / 2, py + CELL_H / 2 + 3)
}
