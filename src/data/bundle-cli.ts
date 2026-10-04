/**
 * Extraction en ligne de commande d'un lot de données minimal (DataBundle JSON) pour le navigateur :
 *
 *   npx tsx src/data/bundle-cli.ts --monsters 3833,3834,3835 --maps 143393281 --breeds 8,3 --out vortex.bundle.json
 *
 * Options : --spells, --monsters, --maps, --items, --sets, --breeds, --states (listes d'ids séparés par des
 * virgules), --no-closure, --data <dossier> (défaut : data), --out <fichier> (défaut : sortie standard),
 * --pretty (JSON indenté).
 */
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createBundle, type BundleRequest, type DataBundle } from './memory'
import { loadDataStore } from './node'

export interface BundleCliOptions {
  request: BundleRequest
  dataDir: string
  out?: string
  pretty: boolean
}

const ID_LISTS = {
  spells: 'spellIds',
  monsters: 'monsterIds',
  maps: 'mapIds',
  items: 'itemIds',
  sets: 'itemSetIds',
  breeds: 'breedIds',
  states: 'stateIds',
} as const

function parseIds(name: string, value: string | undefined): number[] {
  if (!value) return []
  return value.split(',').map(s => {
    const n = Number(s.trim())
    if (!Number.isSafeInteger(n)) throw new Error(`--${name} : id invalide « ${s} »`)
    return n
  })
}

export function parseBundleArgs(argv: readonly string[]): BundleCliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      spells: { type: 'string' },
      monsters: { type: 'string' },
      maps: { type: 'string' },
      items: { type: 'string' },
      sets: { type: 'string' },
      breeds: { type: 'string' },
      states: { type: 'string' },
      'no-closure': { type: 'boolean', default: false },
      data: { type: 'string', default: 'data' },
      out: { type: 'string' },
      pretty: { type: 'boolean', default: false },
    },
    strict: true,
  })
  const request: BundleRequest = { closure: !values['no-closure'] }
  for (const [opt, key] of Object.entries(ID_LISTS)) {
    const ids = parseIds(opt, values[opt as keyof typeof ID_LISTS])
    if (ids.length) request[key] = ids
  }
  return { request, dataDir: values.data, out: values.out, pretty: values.pretty }
}

/** Construit le lot décrit par les arguments ; l'écrit dans `--out` s'il est fourni, et le renvoie. */
export function runBundleCli(argv: readonly string[]): { bundle: DataBundle; json: string; opts: BundleCliOptions } {
  const opts = parseBundleArgs(argv)
  const bundle = createBundle(loadDataStore(opts.dataDir), opts.request)
  const json = JSON.stringify(bundle, null, opts.pretty ? 2 : undefined)
  if (opts.out) writeFileSync(opts.out, json)
  return { bundle, json, opts }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { bundle, json, opts } = runBundleCli(process.argv.slice(2))
  if (opts.out)
    console.error(
      `Lot écrit dans ${opts.out} : ${bundle.spells.length} sorts, ${bundle.monsters.length} monstres, ` +
        `${bundle.states.length} états, ${bundle.items.length} objets, ${bundle.maps.length} cartes (${json.length} octets)`,
    )
  else process.stdout.write(json + '\n')
}
