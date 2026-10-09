// Schéma de la formation F-A (Reine des Voleurs, carte 137101312 « Traversée »), vue écran.
// Adapté de tools/reine-des-voleurs/schema-formation.mjs. Usage : node schema-formation.mjs <sortie.svg>
// Trois panneaux : placement de départ et tour 1 ; formation si la bombe apparaît 1 case au-dessus (N2) ;
// formation si elle apparaît 2 cases au-dessus (N4).
import fs from 'node:fs'
const MAP = JSON.parse(fs.readFileSync('data/maps/137101312.json', 'utf8'))
const W = 72, H = 36, MAP_WIDTH = 14, LM = 110
const ROW0 = 4 // premières rangées vides non dessinées
const pos = id => { const row = Math.floor(id / MAP_WIDTH), col = id % MAP_WIDTH; return { x: LM + col * W + (row % 2) * (W / 2), y: (row - ROW0) * (H / 2) } }
const center = id => { const { x, y } = pos(id); return { cx: x + W / 2, cy: y + H / 2 } }
const red = new Set(MAP.redCells), blue = new Set(MAP.blueCells)
const PW = LM + W * 14.5 + 20
const TOP = 110
const MAP_H = (40 - ROW0) * (H / 2) + H

function arrow(a, b, cls, shorten = 13) {
  const A = center(a), B = center(b)
  const dx = B.cx - A.cx, dy = B.cy - A.cy, L = Math.hypot(dx, dy)
  const x1 = A.cx + (dx / L) * shorten, y1 = A.cy + (dy / L) * shorten
  const x2 = B.cx - (dx / L) * shorten, y2 = B.cy - (dy / L) * shorten
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" marker-end="url(#ah-${cls})"/>`
}
function panel(title, subtitle, marks, arrows, ox, cellLabels = []) {
  let s = `<g transform="translate(${ox},0)"><text x="${LM + W * 7.25}" y="40" text-anchor="middle" class="t">${title}</text>`
  s += `<text x="${LM + W * 7.25}" y="74" text-anchor="middle" class="st">${subtitle}</text><g transform="translate(0,${TOP})">`
  for (const c of MAP.cells) {
    if (!c.walkable && c.los) continue
    const { x, y } = pos(c.id)
    if (y < -H) continue
    const pts = `${x + W / 2},${y} ${x + W},${y + H / 2} ${x + W / 2},${y + H} ${x},${y + H / 2}`
    s += `<polygon points="${pts}" class="${!c.los ? 'pil' : 'floor'}"/>`
    if (red.has(c.id)) s += `<polygon points="${pts}" class="red"/>`
    if (blue.has(c.id)) s += `<polygon points="${pts}" class="blue"/>`
  }
  for (const [id, txt] of cellLabels) { const { cx, cy } = center(id); s += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" class="num">${txt}</text>` }
  for (const a of arrows) s += arrow(...a)
  for (const [id, label, kind, note] of marks) {
    const { cx, cy } = center(id)
    const r = kind === 'alt' ? 12 : kind === 'cra0' || kind === 'cra' || kind === 'fast' || kind === 'ghost' ? 15 : kind === 'probe' ? 14 : 12
    if (kind === 'fast') s += `<circle cx="${cx}" cy="${cy}" r="${r + 4}" class="ring"/>`
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" class="${kind}"/>`
    if (label) s += `<text x="${cx}" y="${cy + 5.5}" text-anchor="middle" class="l ${kind}l">${label}</text>`
    if (note !== null) {
      const n = note ?? {}
      s += `<text x="${cx + (n.dx ?? 19)}" y="${cy + (n.dy ?? 5)}" text-anchor="${n.anchor ?? 'start'}" class="${n.cls ?? 'id'}">${n.t ?? id}</text>`
    }
  }
  return s + '</g></g>'
}

// ── Panneau 1 : départ (tour 1)
const start = [
  [365, 'A', 'fast', null],
  [437, 'B', 'fast', null],
  [378, 'C', 'cra0', null],
  [451, 'D', 'cra0', null],
  [311, 'A', 'ghost', { t: '311 · 4 PM', dx: 19, dy: -6 }],
  [398, 'B', 'ghost', { t: '398 · 5 PM' }],
  [392, 'C', 'ghost', { t: '392 · 1 PM', dx: -19, dy: 12, anchor: 'end' }],
  [479, 'D', 'ghost', { t: '479 · 2 PM' }],
  [337, 'N2', 'probe', { t: '337', dx: -19, anchor: 'end' }],
  [309, 'N4', 'probe', { t: '309', dx: -19, anchor: 'end' }],
]
const startArrows = [[365, 311, 'mv'], [437, 398, 'mv'], [378, 392, 'mv'], [451, 479, 'mv']]

// ── Panneau 2 : formation, lecture N2 (bombe 1 case au-dessus du Crâ)
const n2 = [
  [311, 'A', 'cra'], [398, 'B', 'cra'], [392, 'C', 'cra'], [479, 'D', 'cra'],
  [283, '●', 'bomb'], [370, '●', 'bomb'], [364, '●', 'bomb'], [451, '●', 'bomb'],
  [284, '✚', 'bb'], [371, '✚', 'bb'], [365, '✚', 'bb'], [452, '✚', 'bb'],
]
// ── Panneau 3 : formation, lecture N4 (bombe 2 cases au-dessus) + alternance si explosion au tour suivant
const n4 = [
  [311, 'A', 'cra'], [398, 'B', 'cra'], [392, 'C', 'cra'], [479, 'D', 'cra'],
  [325, 'a', 'alt'], [412, 'b', 'alt'], [406, 'c', 'alt'], [493, 'd', 'alt'],
  [255, '●', 'bomb'], [342, '●', 'bomb'], [336, '●', 'bomb'], [423, '●', 'bomb'],
  [269, '●', 'bomb2'], [356, '●', 'bomb2'], [350, '●', 'bomb2'], [437, '●', 'bomb2'],
]
const n4Arrows = [[311, 325, 'alt2', 11], [398, 412, 'alt2', 11], [392, 406, 'alt2', 11], [479, 493, 'alt2', 11]]

const legendY = TOP + MAP_H + 40
const totalW = PW * 3
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${legendY + 200}" viewBox="0 0 ${totalW} ${legendY + 200}">
<defs>
 <marker id="ah-mv" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#2e7d32"/></marker>
 <marker id="ah-alt2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#b26a00"/></marker>
</defs>
<style>
 .floor{fill:#ece6d6;stroke:#bdb39c;stroke-width:1} .pil{fill:#3a3a44;stroke:#222}
 .red{fill:#d9534f;fill-opacity:.22;stroke:#c9302c;stroke-width:2} .blue{fill:#337ab7;fill-opacity:.22;stroke:#286090;stroke-width:2}
 .t{font:700 30px sans-serif;fill:#222} .st{font:20px sans-serif;fill:#444} .l{font:700 16px sans-serif} .num{font:10px sans-serif;fill:#8a826e} .id{font:600 13px sans-serif;fill:#555;paint-order:stroke;stroke:#fbfaf6;stroke-width:4px} .ring{fill:none;stroke:#e0a800;stroke-width:4}
 .note{font:700 15px sans-serif;fill:#222;paint-order:stroke;stroke:#fbfaf6;stroke-width:4px}
 .cra0{fill:#2e7d32;stroke:#fff;stroke-width:2} .cra0l{fill:#fff}
 .cra{fill:#2e7d32;stroke:#fff;stroke-width:2} .cral{fill:#fff}
 .ghost{fill:#fff;fill-opacity:.6;stroke:#2e7d32;stroke-width:2.5;stroke-dasharray:4 3}
 .probe{fill:#fff;stroke:#555;stroke-width:2;stroke-dasharray:3 2} .probel{fill:#333;font-size:12px}
 .fast{fill:#2e7d32;stroke:#fff;stroke-width:2} .fastl{fill:#fff} .ghostl{fill:#2e7d32}
 .bomb{fill:#c62828;stroke:#fff;stroke-width:2} .bombl{fill:#fff;font-size:12px}
 .bomb2{fill:#ef8a80;stroke:#c62828;stroke-width:2} .bomb2l{fill:#fff;font-size:11px}
 .bb{fill:#1565c0;stroke:#fff;stroke-width:2} .bbl{fill:#fff}
 .alt{fill:#f9a825;stroke:#fff;stroke-width:2} .altl{fill:#3b2a00;font-size:12px}
 line.mv{stroke:#2e7d32;stroke-width:3} line.alt2{stroke:#b26a00;stroke-width:2.5}
 .k{font:19px sans-serif;fill:#333} .kb{font:700 19px sans-serif;fill:#222}
 rect.bg{fill:#fbfaf6}
</style><rect class="bg" width="100%" height="100%"/>
${panel('1. Placement de départ et tour 1', 'Départs : A 365, B 437, C 378, D 451 — les 2 plus rapides en A et B', start, startArrows, 0)}
${panel('2. Formation si la bombe apparaît 1 case au-dessus', 'Lecture « N2 » : ne plus bouger (soins seulement si explosion au tour suivant et repli à droite)', n2, [], PW)}
${panel('3. Formation si la bombe apparaît 2 cases au-dessus', 'Lecture « N4 » : alternance seulement si explosion au tour SUIVANT', n4, n4Arrows, PW * 2)}
<g transform="translate(24,${legendY})">
<text class="kb" y="0">Lecture : vue écran du jeu, le haut de l'image est le haut de l'écran. Losanges rouges : cases de départ des joueurs ; bleus : cases de départ des monstres ; gris foncé : piliers (bloquent la vue).</text>
<text class="k" y="32">Panneau 1 : A, B, C, D = Crâs sur leurs cases de départ (anneau doré : les 2 plus rapides de la frise) ; cercle pointillé = case à rejoindre au tour 1, APRÈS l'apparition de sa bombe. N2 / N4 = où peut apparaître la 1re bombe de A : 337 (1 case au-dessus) ou 309 (2 cases au-dessus).</text>
<text class="k" y="64">Panneau 2 : ● rouge = case où apparaît la bombe de chaque Crâ (rouge, peut virer au bleu) — un ennemi posé dessus est mortel ; ✚ bleu = repli « à droite » : la bombe y explose en BLEU et soigne (explosion au tour suivant). Repli « en haut à droite » : 269, 356, 350, 437, sans soin.</text>
<text class="k" y="96">Panneau 3 : ● rouge foncé = bombe posée depuis la case tenue ; ● rose = bombe posée depuis la case d'alternance. a, b, c, d (jaune) = case d'alternance (1 PM en bas à droite) : tours pairs sur la case jaune, tours impairs sur la case verte.</text>
<text class="k" y="128">L'alternance ne sert QUE si la bombe est apparue 2 cases au-dessus ET n'a pas explosé à la fin du tour de son poseur. En lecture N2 elle est mortelle. Cases jaunes et ● : à garder libres d'ennemis.</text>
</g></svg>`
fs.writeFileSync(process.argv[2], svg)
