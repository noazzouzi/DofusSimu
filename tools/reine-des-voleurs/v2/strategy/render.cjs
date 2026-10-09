// Rendu PNG d'un SVG avec Playwright. Usage : NODE_PATH=$(npm root -g) node render.cjs <entrée.svg> <sortie.png>
const fs = require('node:fs')
const { chromium } = require('playwright')
;(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8')
  const m = svg.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/)
  const w = Math.ceil(Number(m[1])), h = Math.ceil(Number(m[2]))
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fbfaf6}</style></head><body>${svg}</body></html>`)
  await page.screenshot({ path: process.argv[3], clip: { x: 0, y: 0, width: w, height: h } })
  await browser.close()
})()
