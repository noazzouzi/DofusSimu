import fs from 'node:fs'
const MAP = JSON.parse(fs.readFileSync('/home/user/DofusSimu/data/maps/137101312.json', 'utf8'))
const W = 56, H = 28, MAP_WIDTH = 14
const pos = id => { const row = Math.floor(id / MAP_WIDTH), col = id % MAP_WIDTH; return { x: col * W + (row % 2) * (W / 2), y: row * (H / 2) } }
const red = new Set(MAP.redCells), blue = new Set(MAP.blueCells)
function panel(title, marks, ox) {
  let s = `<g transform="translate(${ox},0)"><text x="${W * 7.25}" y="34" text-anchor="middle" class="t">${title}</text><g transform="translate(0,60)">`
  for (const c of MAP.cells) {
    if (!c.walkable && c.los) continue
    const { x, y } = pos(c.id)
    const pts = `${x + W / 2},${y} ${x + W},${y + H / 2} ${x + W / 2},${y + H} ${x},${y + H / 2}`
    let cls = !c.los ? 'pil' : 'floor'
    s += `<polygon points="${pts}" class="${cls}"/>`
    if (red.has(c.id)) s += `<polygon points="${pts}" class="red"/>`
    if (blue.has(c.id)) s += `<polygon points="${pts}" class="blue"/>`
  }
  for (const [id, label, kind] of marks) {
    const { x, y } = pos(id)
    s += `<circle cx="${x + W / 2}" cy="${y + H / 2}" r="${kind === 'gap' ? 5 : 11}" class="${kind}"/>`
    if (label) s += `<text x="${x + W / 2}" y="${y + H / 2 + 5}" text-anchor="middle" class="l ${kind}l">${label}</text>`
  }
  return s + '</g></g>'
}
const start = [[354, 'A', 'cra'], [381, 'B', 'cra'], [380, 'C', 'cra'], [451, 'D', 'cra'], [159, 'R', 'mob'], [160, 'M', 'mob'], [161, 'T', 'mob'], [162, 'U', 'mob'], [408, '', 'gap'], [435, '', 'gap']]
const form = [[354, '1', 'cra'], [381, '2', 'cra'], [408, '3', 'cra'], [435, '4', 'cra'], [355, '●', 'bomb'], [382, '●', 'bomb'], [409, '●', 'bomb'], [436, '●', 'bomb'], [383, '✚', 'bb'], [410, '✚', 'bb'], [437, '✚', 'bb'], [464, '✚', 'bb'], [368, '', 'gap'], [395, '', 'gap'], [422, '', 'gap']]
const PW = W * 14.5 + 20
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW * 2}" height="${60 + 40 * H / 2 + 120}" viewBox="0 0 ${PW * 2} ${60 + 40 * H / 2 + 120}">
<style>
 .floor{fill:#e9e3d3;stroke:#b9b09a;stroke-width:1} .pil{fill:#3a3a44;stroke:#222} .red{fill:#d9534f;fill-opacity:.28;stroke:#c9302c;stroke-width:2}
 .blue{fill:#337ab7;fill-opacity:.28;stroke:#286090;stroke-width:2} .t{font:700 22px sans-serif;fill:#222} .l{font:700 13px sans-serif}
 .cra{fill:#2e7d32;stroke:#fff;stroke-width:2} .cral{fill:#fff} .mob{fill:#6a1b9a;stroke:#fff;stroke-width:2} .mobl{fill:#fff}
 .bomb{fill:#c62828;stroke:#fff;stroke-width:2} .bombl{fill:#fff;font-size:11px} .bb{fill:#1565c0;stroke:#fff;stroke-width:2} .bbl{fill:#fff}
 .gap{fill:#f9a825;stroke:#fff;stroke-width:1} .k{font:14px sans-serif;fill:#333}
 rect.bg{fill:#fbfaf6}
</style><rect class="bg" width="100%" height="100%"/>
${panel('Placement de départ (tour 1)', start, 0)}${panel('Formation à tenir dès le tour 2', form, PW)}
<g transform="translate(20,${60 + 40 * H / 2 + 30})" class="k">
<text y="0">A, B, C, D / 1-4 : Crâs · R Reine, M Mâchassin, T Terristocrate, U Doublure (vague 1, cases supposées) · gris foncé : piliers (bloquent la ligne de vue)</text>
<text y="24">Cases rouges/bleues : départs joueurs / monstres · ● : où apparaît la bombe (rouge) de chaque Crâ · ✚ : bombe bleue qui tourne (soin 100 %, retire Mort en Sursis)</text>
<text y="48">Point jaune (départ) : C va en 3 (2 PM) et D va en 4 (3 PM) au tour 1 · Point jaune (formation) : case d'intervalle à laisser libre</text>
</g></svg>`
fs.writeFileSync(process.argv[2], svg)
