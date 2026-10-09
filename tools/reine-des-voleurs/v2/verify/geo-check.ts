import { CELL_X, CELL_Y, cellToScreen, lookDirection8, distance, pointToCell } from '../../../../src/map/geometry.ts'
// Pour quelques cases, on cherche la case la plus proche dans chaque direction ÉCRAN et on donne son vecteur logique.
const W = 2, H = 2 // cellW=2, cellH=2 -> px = col*2 + (row%2), py = row  (écran : y vers le bas)
const names = ['E','SE','S','SW','W','NW','N','NE']
for (const c of [311, 392, 398, 479, 365, 270]) {
  const s = cellToScreen(c, W, H)
  const res: string[] = []
  for (let o = 0; o < 560; o++) {
    if (o === c) continue
    const t = cellToScreen(o, W, H)
    const dpx = t.px - s.px, dpy = t.py - s.py
    // directement au-dessus (dpx=0, dpy<0) ; en haut à droite (dpx>0, dpy<0, |dpx|=|dpy|*1 en unités demi-case)
    if (dpx === 0 && dpy < 0 && dpy >= -4) res.push(`haut écran Δpy=${dpy}: ${o} (dx=${CELL_X[o]-CELL_X[c]},dy=${CELL_Y[o]-CELL_Y[c]}) d=${distance(c,o)} look8=${names[lookDirection8(c,o)]}`)
    if (dpx > 0 && dpy === -dpx && dpy >= -4) res.push(`haut-droite écran (Δpx=${dpx},Δpy=${dpy}): ${o} (dx=${CELL_X[o]-CELL_X[c]},dy=${CELL_Y[o]-CELL_Y[c]}) d=${distance(c,o)} look8=${names[lookDirection8(c,o)]}`)
    if (dpy === 0 && dpx > 0 && dpx <= 2) res.push(`droite écran Δpx=${dpx}: ${o} (dx=${CELL_X[o]-CELL_X[c]},dy=${CELL_Y[o]-CELL_Y[c]}) d=${distance(c,o)} look8=${names[lookDirection8(c,o)]}`)
    if (dpx === 1 && dpy === -2) res.push(`(Δpx=1,Δpy=-2) : ${o} (dx=${CELL_X[o]-CELL_X[c]},dy=${CELL_Y[o]-CELL_Y[c]}) d=${distance(c,o)} look8=${names[lookDirection8(c,o)]}`)
    if (dpx === 2 && dpy === -4) res.push(`(Δpx=2,Δpy=-4) : ${o} (dx=${CELL_X[o]-CELL_X[c]},dy=${CELL_Y[o]-CELL_Y[c]}) d=${distance(c,o)} look8=${names[lookDirection8(c,o)]}`)
    if (dpx === 1 && dpy === -4) res.push(`(Δpx=1,Δpy=-4) : ${o} (dx=${CELL_X[o]-CELL_X[c]},dy=${CELL_Y[o]-CELL_Y[c]}) d=${distance(c,o)} look8=${names[lookDirection8(c,o)]}`)
    if (dpx === 1 && dpy === -3) res.push(`(Δpx=1,Δpy=-3) : ${o} (dx=${CELL_X[o]-CELL_X[c]},dy=${CELL_Y[o]-CELL_Y[c]}) d=${distance(c,o)} look8=${names[lookDirection8(c,o)]}`)
    if (dpx === 1 && dpy === -5) res.push(`(Δpx=1,Δpy=-5) : ${o} (dx=${CELL_X[o]-CELL_X[c]},dy=${CELL_Y[o]-CELL_Y[c]}) d=${distance(c,o)} look8=${names[lookDirection8(c,o)]}`)
  }
  console.log(`case ${c} (x=${CELL_X[c]}, y=${CELL_Y[c]}) écran (px=${s.px}, py=${s.py}) [px en demi-largeurs, py en demi-hauteurs]`)
  for (const r of res) console.log('   ' + r)
}
