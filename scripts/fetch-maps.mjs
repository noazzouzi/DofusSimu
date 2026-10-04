#!/usr/bin/env node
// Télécharge les données de cellules (marchable / ligne de vue / placement) des cartes de donjons
// depuis DofusDB (fichiers de carte Dofus 3 exportés) et les écrit dans data/maps/<mapId>.json.
//
// Source des cellules : https://api.dofusdb.fr/maps/<mapId>.json  (champ `cellsData`, 560 cellules)
// Liste des salles     : https://api.dofusdb.fr/dungeons            (champ `mapIds`)
// Noms / coordonnées   : https://api.dofusdb.fr/map-positions       (champ `name`, posX/posY, subAreaId)
//
// Usage :
//   NODE_USE_ENV_PROXY=1 node scripts/fetch-maps.mjs                 # toutes les salles de tous les donjons
//   node scripts/fetch-maps.mjs --dungeon 87                         # seulement l'Œil de Vortex
//   node scripts/fetch-maps.mjs --map 143393281,121373185            # cartes explicites (hors donjon possible)
//   options : --force (ignore le cache), --concurrency 3, --delay 150 (ms entre requêtes par worker)
//
// Sans dépendance (Node >= 22, ESM). Derrière un proxy HTTP(S), Node 22 a besoin de NODE_USE_ENV_PROXY=1 :
// le script se relance lui-même avec cette variable si HTTPS_PROXY est défini et qu'elle manque.
// Les réponses brutes sont mises en cache (gzip) dans .cache/maps/raw/ (ignoré par git).

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  })
  process.exit(r.status ?? 1)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'data', 'maps')
const ANNOTATIONS_DIR = join(OUT_DIR, 'annotations') // annotations manuelles (ex. positions de l'horloge du Vortex)
const CACHE_DIR = join(ROOT, '.cache', 'maps')
const RAW_DIR = join(CACHE_DIR, 'raw')
const API = 'https://api.dofusdb.fr'

const WIDTH = 14
const HEIGHT = 20
const CELL_COUNT = WIDTH * HEIGHT * 2 // 560

// Calibration (mesurée à la main sur 2 cartes, cf. docs/research/maps.md) des images DofusDB
// https://api.dofusdb.fr/img/maps/1/<mapId>.jpg (1910×970 px) : coin haut-gauche du losange de la cellule
// (col = id % 14, row = floor(id / 14)) : x = originX + col*86 + (row % 2)*43, y = originY + row*21.5.
const IMAGE_GRID = { scale: 1, width: 1910, height: 970, originX: 331, originY: 0, cellWidth: 86, cellHeight: 43 }

// ---------------------------------------------------------------- CLI
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def
}
const FORCE = args.includes('--force')
const CONCURRENCY = Math.max(1, Number(opt('concurrency', 3)))
const DELAY = Math.max(0, Number(opt('delay', 150)))
const ONLY_DUNGEONS = opt('dungeon', '')
  .split(',')
  .filter(Boolean)
  .map(Number)
const EXTRA_MAPS = opt('map', '')
  .split(',')
  .filter(Boolean)
  .map(Number)

// ---------------------------------------------------------------- HTTP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url, { retries = 4 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'accept-encoding': 'gzip', 'user-agent': 'DofusSimu/0.1 (fetch-maps)' } })
      // 404 : service inconnu ; 400 « Cast to Number failed … "<id>.json" » : pas de fichier statique pour cette
      // carte (la requête retombe alors sur le service Feathers `maps`, vide) → carte absente, inutile de réessayer
      if (res.status === 404 || res.status === 400) return { notFound: true, status: res.status }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return { json: await res.json() }
    } catch (e) {
      lastErr = e
      await sleep(500 * 2 ** attempt)
    }
  }
  throw lastErr
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Liste paginée d'un service FeathersJS ($limit max 50). */
async function getAll(service, query) {
  const out = []
  for (let skip = 0; ; skip += 50) {
    const sep = query ? '&' : ''
    const { json } = await getJson(`${API}/${service}?${query}${sep}$limit=50&$skip=${skip}`)
    out.push(...json.data)
    if (out.length >= json.total || json.data.length === 0) break
    await sleep(DELAY)
  }
  return out
}

// ---------------------------------------------------------------- conversion
/**
 * Convertit `cellsData` (format fichier de carte Dofus) en cellules compactes.
 * walkable = mov && !nonWalkableDuringFight  (marchable EN COMBAT)
 * los      = la cellule laisse passer la ligne de vue (false = obstacle opaque)
 * champs optionnels écrits seulement s'ils sont vrais / non nuls.
 */
function convertCells(cellsData) {
  if (!Array.isArray(cellsData) || cellsData.length !== CELL_COUNT) {
    throw new Error(`cellsData invalide (${cellsData?.length} cellules)`)
  }
  const byId = [...cellsData].sort((a, b) => a.cellNumber - b.cellNumber)
  return byId.map((c, i) => {
    if (c.cellNumber !== i) throw new Error(`cellNumber ${c.cellNumber} attendu ${i}`)
    const cell = { id: i, walkable: !!c.mov && !c.nonWalkableDuringFight, los: !!c.los }
    if (c.nonWalkableDuringFight) cell.nonWalkableDuringFight = true
    if (c.red) cell.red = true
    if (c.blue) cell.blue = true
    if (c.visible === 0) cell.visible = false
    if (c.floor) cell.floor = c.floor
    return cell
  })
}

/** JSON compact mais lisible en diff : une cellule par ligne. */
function serializeMap(map) {
  const { cells, ...head } = map
  const headJson = JSON.stringify(head)
  return `${headJson.slice(0, -1)},"cells":[\n${cells.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`
}

function summarize(cells) {
  return {
    walkable: cells.filter((c) => c.walkable).length,
    losBlocking: cells.filter((c) => !c.los).length,
    walkableNoLos: cells.filter((c) => c.walkable && !c.los).length,
    red: cells.filter((c) => c.red).length,
    blue: cells.filter((c) => c.blue).length,
  }
}

// ---------------------------------------------------------------- main
async function fetchRawMap(mapId) {
  const cacheFile = join(RAW_DIR, `${mapId}.json.gz`)
  if (!FORCE && (await exists(cacheFile))) {
    return JSON.parse(gunzipSync(await readFile(cacheFile)).toString('utf8'))
  }
  const { json, notFound } = await getJson(`${API}/maps/${mapId}.json`)
  if (notFound) return null
  // on ne garde en cache que ce qui sert (les éléments graphiques pèsent ~90 % du fichier)
  const slim = {
    cellsData: json.cellsData,
    topNeighbourId: json.topNeighbourId,
    bottomNeighbourId: json.bottomNeighbourId,
    leftNeighbourId: json.leftNeighbourId,
    rightNeighbourId: json.rightNeighbourId,
  }
  await writeFile(cacheFile, gzipSync(JSON.stringify(slim)))
  return slim
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(RAW_DIR, { recursive: true })
  const today = new Date().toISOString().slice(0, 10)

  // 1. donjons → salles
  console.log('• donjons…')
  const dungeons = await getAll(
    'dungeons',
    ['id', 'name', 'mapIds', 'entranceMapId', 'exitMapId', 'bosses', 'monsters', 'optimalPlayerLevel', 'minLevel', 'subarea']
      .map((f) => `$select[]=${f}`)
      .join('&'),
  )
  dungeons.sort((a, b) => a.id - b.id)
  await writeFile(join(CACHE_DIR, 'dungeons.json'), JSON.stringify(dungeons))
  const selected = ONLY_DUNGEONS.length ? dungeons.filter((d) => ONLY_DUNGEONS.includes(d.id)) : dungeons
  const mapToDungeons = new Map()
  const mapRoom = new Map()
  for (const d of dungeons) {
    ;(d.mapIds ?? []).forEach((m, idx) => {
      if (!mapToDungeons.has(m)) mapToDungeons.set(m, [])
      mapToDungeons.get(m).push(d.id)
      if (!mapRoom.has(m)) mapRoom.set(m, idx + 1)
    })
  }
  const mapIds = [...new Set([...selected.flatMap((d) => d.mapIds ?? []), ...EXTRA_MAPS])]
  console.log(`  ${dungeons.length} donjons, ${mapIds.length} cartes à traiter`)

  // 2. noms / coordonnées des cartes (map-positions, par lots de 50)
  console.log('• map-positions…')
  const positions = new Map()
  for (let i = 0; i < mapIds.length; i += 50) {
    const chunk = mapIds.slice(i, i + 50)
    const q = [
      ...chunk.map((id) => `id[$in][]=${id}`),
      ...['id', 'name', 'posX', 'posY', 'subAreaId', 'worldMap', 'outdoor'].map((f) => `$select[]=${f}`),
    ].join('&')
    const { json } = await getJson(`${API}/map-positions?${q}&$limit=50`)
    for (const p of json.data) positions.set(p.id, p)
    await sleep(DELAY)
  }

  // 3. cellules
  console.log('• cellules…')
  const results = new Map()
  const failures = []
  let next = 0
  let done = 0
  async function worker() {
    while (next < mapIds.length) {
      const mapId = mapIds[next++]
      const outFile = join(OUT_DIR, `${mapId}.json`)
      try {
        const cached = !FORCE && (await exists(join(RAW_DIR, `${mapId}.json.gz`)))
        const raw = await fetchRawMap(mapId)
        if (!raw) {
          failures.push({ mapId, error: `pas de fichier ${API}/maps/${mapId}.json (HTTP 400/404)` })
        } else {
          const cells = convertCells(raw.cellsData)
          const pos = positions.get(mapId)
          const dIds = mapToDungeons.get(mapId) ?? []
          const dungeonName = dungeons.find((d) => d.id === dIds[0])?.name?.fr
          let annotations
          const annFile = join(ANNOTATIONS_DIR, `${mapId}.json`)
          if (await exists(annFile)) annotations = JSON.parse(await readFile(annFile, 'utf8'))
          const map = {
            mapId,
            // certaines salles n'ont pas de nom en jeu (name.id = "0") : on retombe sur « <donjon> - salle N »
            name: pos?.name?.fr ?? (dungeonName ? `${dungeonName} - salle ${mapRoom.get(mapId)}` : null),
            nameIsFallback: !pos?.name?.fr,
            dungeonIds: dIds,
            room: mapRoom.get(mapId) ?? null,
            posX: pos?.posX ?? null,
            posY: pos?.posY ?? null,
            subAreaId: pos?.subAreaId ?? null,
            worldMap: pos?.worldMap ?? null,
            width: WIDTH,
            height: HEIGHT,
            source: `${API}/maps/${mapId}.json (cellsData, fichiers de carte Dofus 3 extraits par DofusDB)`,
            fetchedAt: today,
            approximate: false,
            image: `${API}/img/maps/1/${mapId}.jpg`,
            neighbours: {
              top: raw.topNeighbourId,
              bottom: raw.bottomNeighbourId,
              left: raw.leftNeighbourId,
              right: raw.rightNeighbourId,
            },
            stats: summarize(cells),
            redCells: cells.filter((c) => c.red).map((c) => c.id),
            blueCells: cells.filter((c) => c.blue).map((c) => c.id),
            ...(annotations ? { annotations } : {}),
            cells,
          }
          await writeFile(outFile, serializeMap(map))
          results.set(mapId, map)
        }
        if (!cached) await sleep(DELAY)
      } catch (e) {
        failures.push({ mapId, error: String(e?.message ?? e) })
      }
      done++
      if (done % 25 === 0 || done === mapIds.length) console.log(`  ${done}/${mapIds.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  // 4. index
  const index = {
    generatedAt: today,
    source: `${API}/dungeons + ${API}/map-positions + ${API}/maps/<mapId>.json`,
    format: 'data/maps/<mapId>.json : {mapId, name, dungeonIds, room, width:14, height:20, cells:[{id, walkable, los, nonWalkableDuringFight?, red?, blue?, visible?, floor?}] (560), ...}',
    imageGrid: IMAGE_GRID,
    dungeons: selected.map((d) => ({
      id: d.id,
      name: d.name?.fr,
      optimalPlayerLevel: d.optimalPlayerLevel,
      minLevel: d.minLevel,
      bosses: d.bosses ?? [],
      monsters: d.monsters ?? [],
      entranceMapId: d.entranceMapId,
      mapIds: d.mapIds ?? [],
    })),
    maps: Object.fromEntries(
      [...results.values()]
        .sort((a, b) => a.mapId - b.mapId)
        .map((m) => [m.mapId, { name: m.name, dungeonIds: m.dungeonIds, room: m.room, ...m.stats }]),
    ),
    failures,
  }
  // en mode partiel (--dungeon / --map), on fusionne avec l'index existant au lieu de l'écraser
  const indexFile = join(OUT_DIR, 'index.json')
  if ((ONLY_DUNGEONS.length || EXTRA_MAPS.length) && (await exists(indexFile))) {
    try {
      const prev = JSON.parse(await readFile(indexFile, 'utf8'))
      const ids = new Set(index.dungeons.map((d) => d.id))
      index.dungeons = [...prev.dungeons.filter((d) => !ids.has(d.id)), ...index.dungeons].sort((a, b) => a.id - b.id)
      index.maps = { ...prev.maps, ...index.maps }
      index.failures = [...(prev.failures ?? []).filter((f) => !results.has(f.mapId)), ...failures]
    } catch {
      /* index illisible : on le réécrit */
    }
  }
  await writeFile(
    indexFile,
    `{\n${Object.entries(index)
      .map(([k, v]) => {
        if (k === 'dungeons') return `"dungeons":[\n${v.map((d) => JSON.stringify(d)).join(',\n')}\n]`
        if (k === 'maps')
          return `"maps":{\n${Object.entries(v)
            .map(([id, m]) => `${JSON.stringify(id)}:${JSON.stringify(m)}`)
            .join(',\n')}\n}`
        return `${JSON.stringify(k)}:${JSON.stringify(v)}`
      })
      .join(',\n')}\n}\n`,
  )
  console.log(`✔ ${results.size} cartes écrites dans data/maps/, ${failures.length} échec(s)`)
  for (const f of failures) console.log(`  ✘ ${f.mapId}: ${f.error}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
