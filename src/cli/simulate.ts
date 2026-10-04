/**
 * CLI de simulation (docs/design/ai.md §15.9) — WP4 : `npm run sim -- <commande> …`
 *
 *   fight | batch | tune | stuff | team | optimize | rewind | report | bench
 *
 * BOUCHON S0 — TODO(WP4) : seule `fight <scénario> [--seed N] [--ai mode] [--replay fichier.json]` est branchée
 * (équipe nue par défaut : Iop, Crâ, Enutrof, Pandawa) ; les autres commandes affichent « non implémenté ».
 */
import { writeFileSync } from 'node:fs'
import { loadTheta, type AIMode } from '../ai'
import { loadDataStore } from '../data/node'
import { runOne } from '../optimizer/runner'
import type { MemberSpec } from '../optimizer/types'
import { fullScrolls, nakedBuild } from '../stats/build'

const COMMANDS = ['fight', 'batch', 'tune', 'stuff', 'team', 'optimize', 'rewind', 'report', 'bench'] as const

function usage(): string {
  return [
    'Usage : npm run sim -- <commande> [options]',
    `Commandes : ${COMMANDS.join(' | ')}`,
    '  fight <scénario> [--seed N] [--ai scripted|fast|standard|deep] [--replay out.json]',
  ].join('\n')
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

/** Équipe par défaut (S0) : personnages niveau 200 sans équipement, parchemins complets. */
function defaultTeam(): MemberSpec[] {
  const make = (name: string, breedId: number): MemberSpec => ({
    name,
    breedId,
    presetId: 'naked',
    build: { ...nakedBuild(breedId, 200, name), scrolls: fullScrolls() },
    variants: [],
  })
  return [make('Iop', 8), make('Crâ', 9), make('Enutrof', 3), make('Pandawa', 12)]
}

export function main(argv: string[]): number {
  const [cmd, ...args] = argv
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(usage())
    return 0
  }
  if (!(COMMANDS as readonly string[]).includes(cmd)) {
    console.error(`Commande inconnue : ${cmd}\n${usage()}`)
    return 2
  }
  if (cmd !== 'fight') {
    console.error(`« ${cmd} » : non implémenté (TODO WP4).`)
    return 2
  }
  const scenarioId = args[0] && !args[0].startsWith('--') ? args[0] : 'vortex'
  const seed = Number(flag(args, 'seed') ?? 1)
  const mode = (flag(args, 'ai') ?? 'fast') as AIMode
  const replay = flag(args, 'replay')
  const data = loadDataStore()
  const { summary, fight } = runOne(
    data,
    { scenarioId, team: defaultTeam(), mode, theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 },
    seed,
    { record: !!replay },
  )
  if (replay) writeFileSync(replay, JSON.stringify({ version: 1, events: fight.events, map: fight.map }))
  console.log(JSON.stringify(summary, null, 2))
  return 0
}

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] && /simulate\.[cm]?[jt]s$/.test(process.argv[1])
if (invokedDirectly) process.exitCode = main(process.argv.slice(2))
