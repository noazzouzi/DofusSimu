/**
 * Commandes d'optimisation de la CLI (`npm run sim -- <commande>`) sur la bibliothèque src/optimizer :
 *
 *   optimize <scénario>  builds de la composition CHOISIE PAR L'UTILISATEUR (src/optimizer/builds.ts) → rapport
 *                        Markdown + JSON (src/optimizer/report.ts, docs/reports/<id>.{md,json} + replays notables) et
 *                        meilleur replay dans web/public/replays ; `--save-team` écrit les builds retenus dans le
 *                        fichier d'équipe ;
 *   stuff <scénario>     optimiseur de stuff (L3) pour UN membre, proxy du scénario → build JSON (réutilisable comme
 *                        `build` d'un membre du fichier d'équipe), validation facultative par combats dans l'équipe ;
 *   report <fichier>     rendu Markdown d'un résultat enregistré (rapport JSON d'`optimize`/`team`, résumé de `batch`) ;
 *   tune <scénario>      θ (L2 : criblage → CEM → validation appariée) pour l'équipe → fichier θ (`--theta`) ;
 *   rewind <scénario>    rembobinage stratégique d'une graine perdue (L*, optimiste) → replay de la ligne gagnante ;
 *   team <scénario>      recherche AUTOMATIQUE de composition (L5, team/halving.ts) — opt-in : la composition est
 *                        normalement l'entrée de l'utilisateur.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { loadTheta } from '../ai'
import type { GameDataStore } from '../data/store'
import { buildsReport, BUILD_BUDGETS, BUILD_BUDGETS_IDS, optimizeBuilds, previewBuildSearch, scenarioProxyOptions, type BuildBudget, type BuildSearchOptions, type BuildSearchResult } from '../optimizer/builds'
import { openCampaignCache, type FightCache } from '../optimizer/cache'
import { defaultPoolSize } from '../optimizer/pool/node'
import { buildReport, describeMember, generateReport, renderMarkdown, type OptimizationReport, type ReportComposition } from '../optimizer/report'
import { rewindFight } from '../optimizer/rewind'
import { resolveScenario, runOne } from '../optimizer/runner'
import { mean, summarizeBatch } from '../optimizer/stats'
import { hasPassive } from '../optimizer/stuff/pools'
import { optimizeStuff, type StuffCandidate } from '../optimizer/stuff/search'
import { defaultValidationKinds, validateStuffs } from '../optimizer/stuff/validate'
import { VORTEX_PROFILES, type VortexProfile } from '../optimizer/stuff/vortex'
import { runCompositionCampaign, type HalvingStage } from '../optimizer/team/halving'
import { breedIdOf, findPreset, normalizeName, parseTeam } from '../optimizer/team/presets'
import { loadTeamFile, saveTeamFile, teamFilePath } from '../optimizer/team/teamfile'
import {
  compositionClasses,
  compositionFromClasses,
  describeComposition,
  memberNames,
  optionFromText,
  referenceOption,
  scenarioTag,
  teamFileWithBuilds,
  TEAM_FILE_VERSION,
  type BuildOption,
  type TeamFile,
  type UserComposition,
} from '../optimizer/team/userteam'
import { shapedScore, tuneThetaByFights } from '../optimizer/tune'
import type { FightSpec, FightSummary, WorkerTask } from '../optimizer/types'
import { computeBuildStats } from '../stats/build'
import {
  baseSpecOf,
  bool,
  compositionOf,
  dataDirOf,
  intList,
  num,
  pct,
  replayDirOf,
  REPORTS_DIR,
  RUNS_DIR,
  specOf,
  str,
  teamChoiceOf,
  teamLine,
  teamsDirsOf,
  withPool,
  writeFightReplay,
  writeReplay,
  type Args,
} from './common'

const today = (): string => new Date().toISOString().slice(0, 10)
const rel = (p: string): string => relative(process.cwd(), p) || p

/** Cache de campagne (`--campaign nom`, défaut `def`), sauf `--no-cache`. */
function cacheOf(a: Args, def: string): FightCache | undefined {
  if (bool(a, 'no-cache')) return undefined
  return openCampaignCache(str(a, 'campaign') ?? def, RUNS_DIR, str(a, 'cache-version'))
}

/** Composition du rapport (classes choisies par l'utilisateur). */
function reportComposition(comp: UserComposition): ReportComposition {
  return { kind: 'user', classes: compositionClasses(comp), text: describeComposition(comp), file: comp.file && rel(comp.file), decidedAt: comp.decidedAt }
}

/** Meilleur combat d'un lot (objectif façonné maximal, puis plus petite graine). */
function bestSummary(summaries: readonly FightSummary[]): FightSummary | undefined {
  return summaries.slice().sort((x, y) => shapedScore(y) - shapedScore(x) || x.seed - y.seed)[0]
}

// ───────────────────────────── optimize ─────────────────────────────

/**
 * Fichier d'équipe à écrire (`--save-team [fichier]`) : le fichier donné, sinon celui de la composition, sinon
 * data/teams/<scénario>.json. Un fichier existant n'est réécrit que s'il contient la MÊME composition (mêmes classes dans
 * le même ordre) : `optimize vortex --classes iop*4 --save-team` ne remplace jamais en silence la composition choisie par
 * l'utilisateur. Appelée AVANT les combats (erreur immédiate) puis à l'écriture.
 */
function teamFileFor(a: Args, comp: UserComposition, scenarioId: string): { path: string; file: TeamFile } {
  const explicit = str(a, 'save-team')
  const own = comp.source === 'file' && comp.file ? resolve(comp.file) : undefined
  const path = explicit ? resolve(explicit) : own ?? teamFilePath(comp.scenarioId ?? scenarioId, teamsDirsOf(a)[0])
  if (own && path === own) return { path, file: loadTeamFile(own).file }
  if (existsSync(path)) {
    const existing = loadTeamFile(path)
    const want = comp.members.map(m => m.breedId).join(',')
    if (existing.composition.members.map(m => m.breedId).join(',') !== want) {
      throw new Error(
        `--save-team : ${rel(path)} contient une autre composition (${compositionClasses(existing.composition).join(', ')}) que celle optimisée ` +
          `(${compositionClasses(comp).join(', ')}) — il n'est pas remplacé ; donner un autre fichier : --save-team <fichier.json>`,
      )
    }
    return { path, file: existing.file }
  }
  if (own) return { path, file: loadTeamFile(own).file }
  return {
    path,
    file: {
      version: TEAM_FILE_VERSION,
      scenario: comp.scenarioId ?? scenarioId,
      chosenBy: 'utilisateur',
      decidedAt: today(),
      // `fixed` n'est pas recopié pour `--team` (builds imposés pour CETTE commande, pas pour les suivantes).
      members: comp.members.map(m => ({ class: normalizeName(m.className), ...(m.name ? { name: m.name } : {}), ...(m.role ? { role: m.role } : {}), ...(m.fixed && comp.source !== 'team' ? { fixed: true } : {}) })),
      notes: [`Composition donnée en ligne de commande (${comp.source === 'classes' ? '--classes' : '--team'}) ; builds écrits par « optimize --save-team ».`],
    },
  }
}

/**
 * Réglage de θ dans `optimize` : `--tune-theta` (ou `--theta` SANS valeur), chemins facultatifs `--theta-paths a,b`.
 * `--theta <fichier>` reste l'option commune « θ de départ » (thetaOf) et ne lance PAS de réglage : un θ réglé passé à
 * `optimize` ne déclenche donc pas ≈ 1 400 combats de réglage.
 */
function thetaSearchOf(a: Args): BuildSearchOptions['theta'] {
  const on = a.flags.has('tune-theta') ? bool(a, 'tune-theta') : a.flags.get('theta') === true
  const paths = str(a, 'theta-paths')?.split(',').map(s => s.trim()).filter(Boolean)
  if (paths?.length && !on) throw new Error('--theta-paths : seulement avec --tune-theta')
  if (!on) return false
  return paths?.length ? { paths } : true
}

export async function cmdOptimize(a: Args, data: GameDataStore): Promise<number> {
  const scenarioId = a.positional[0] ?? 'vortex'
  const tag = scenarioTag(scenarioId) || 'scenario'
  const comp = compositionOf(a, scenarioId)
  if (!comp) throw new Error(`optimize ${scenarioId} : aucune composition — donner --classes (ex. eniripsa,enutrof,cra,cra), --team-file, ou créer data/teams/${tag}.json`)
  const budget = (str(a, 'budget') ?? 'normal') as BuildBudget
  if (!BUILD_BUDGETS_IDS.includes(budget)) throw new Error(`--budget : ${BUILD_BUDGETS_IDS.join('|')} attendu (« ${budget} »)`)
  const profile = (str(a, 'profile') ?? 'balanced') as VortexProfile
  if (!VORTEX_PROFILES.includes(profile)) throw new Error(`--profile : ${VORTEX_PROFILES.join('|')} attendu`)
  const screenKind = (str(a, 'screen-kind') ?? 'full') as WorkerTask['kind']
  const base = baseSpecOf(a, scenarioId, 'fast')
  const workers = num(a, 'workers', defaultPoolSize())
  const json = bool(a, 'json')
  const say = (l: string) => {
    if (!json) console.log(l)
  }
  const classesId = compositionClasses(comp).map(c => normalizeName(c).replace(/[^a-z0-9]+/g, '')).join('-')
  const id = str(a, 'id') ?? `${tag}-builds-${classesId}`
  const outDir = resolve(str(a, 'out-dir') ?? REPORTS_DIR)
  const cache = cacheOf(a, `optimize-${tag}`)
  const plan = BUILD_BUDGETS[budget]
  say(`optimize ${scenarioId} — ${describeComposition(comp)}`)
  say(`IA ${base.mode}, budget ${budget} (criblage ${num(a, 'screen-seeds', plan.screenSeeds)} graines, halving ${str(a, 'halving') ?? plan.halving.join('/')}, validation ${num(a, 'validate', plan.validation)}), ${workers} worker(s)${cache ? `, cache ${rel((cache as { file?: string }).file ?? '')}` : ''}`)
  const searchOpts: BuildSearchOptions = {
    budget,
    maxFights: a.flags.has('max-fights') ? num(a, 'max-fights', 0) : undefined,
    masterSeed: a.flags.has('master-seed') ? num(a, 'master-seed', 0) >>> 0 : undefined,
    keep: a.flags.has('keep') ? num(a, 'keep', 2) : undefined,
    screenSeeds: a.flags.has('screen-seeds') ? num(a, 'screen-seeds', 16) : undefined,
    halving: str(a, 'halving') ? intList(str(a, 'halving')!, 'halving') : undefined,
    validation: a.flags.has('validate') ? num(a, 'validate', 64) : undefined,
    screenKind,
    stuff: bool(a, 'no-stuff-search') ? false : { vortexProfile: profile, ...(a.flags.has('stuff-iterations') ? { iterations: num(a, 'stuff-iterations', 20000) } : {}) },
    variants: bool(a, 'no-variants') ? false : bool(a, 'variants') ? true : undefined,
    theta: thetaSearchOf(a),
    cache,
    onLog: say,
  }
  // `--save-team` : fichier cible vérifié AVANT les combats (une erreur après des heures de calcul ferait perdre l'écriture).
  if (bool(a, 'save-team')) say(`--save-team : builds retenus écrits dans ${rel(teamFileFor(a, comp, scenarioId).path)}`)
  if (bool(a, 'dry-run')) {
    // Aperçu : options de chaque membre et combats prévus, sans combat ni optimiseur de stuff.
    const p = previewBuildSearch(data, base, comp, searchOpts)
    if (json) console.log(JSON.stringify(p, null, 2))
    else {
      for (const sl of p.slots) console.log(`  ${sl.name} (${sl.className}${sl.fixed ? ', imposé' : ''}) : ${sl.options.map(o => o.id).join(', ')}`)
      const e = p.estimate
      console.log(`Combats prévus (majorant) : criblage ${e.screen}, halving ${e.halving}, variantes ${e.variants}${searchOpts.theta ? `, θ ${e.theta}` : ''}, validation ${e.validation} → ${e.total}${searchOpts.maxFights !== undefined ? ` (plafond --max-fights ${searchOpts.maxFights})` : ''} ; ≈ ${((e.total * 30) / 3600 / Math.max(1, workers)).toFixed(1)} h avec ${Math.max(1, workers)} worker(s) à 30 s par combat (ordre de grandeur du Vortex)`)
    }
    return 0
  }
  const t0 = performance.now()
  const { r, report, files } = await withPool(
    workers,
    async pool => {
      const r = await optimizeBuilds(data, base, comp, pool, searchOpts)
      say('Rapport : lot de validation, replays notables…')
      const { report, files } = await generateReport(data, r.chosen.spec, pool, {
        id,
        title: `Builds optimisés — ${scenarioId} — composition de l’utilisateur (${compositionClasses(comp).join(', ')})`,
        createdAt: today(),
        evaluation: r.chosen.evaluation,
        stuff: r.stuff,
        variants: r.variants,
        tune: r.tune,
        history: r.log,
        notes: r.notes,
        dir: outDir,
        replays: !bool(a, 'no-replays'),
        composition: reportComposition(comp),
        builds: buildsReport(r),
        cache,
      })
      return { r, report, files }
    },
    data,
    dataDirOf(a),
  )
  // Meilleur combat du lot de validation → visualiseur (web/public/replays + index.json).
  let bestReplay: string | undefined
  if (!bool(a, 'no-replays')) {
    const best = bestSummary(r.chosen.evaluation.summaries)
    if (best) {
      const title = `${scenarioId} — builds optimisés (composition de l’utilisateur) — meilleur combat de la validation`
      const known = report.replays.find(p => p.seed === best.seed)
      const target = join(replayDirOf(a), `${tag}-optimize-${id}-s${best.seed}.json`)
      if (known && existsSync(join(outDir, known.file))) {
        const replay = JSON.parse(readFileSync(join(outDir, known.file), 'utf8'))
        replay.meta = { ...(replay.meta ?? {}), title }
        bestReplay = writeReplay(target, replay, { title, scenario: scenarioId, seed: best.seed, win: best.win, rounds: best.rounds, createdAt: new Date().toISOString() })
      } else {
        bestReplay = writeFightReplay(data, r.chosen.spec, runOne(data, r.chosen.spec, best.seed, { record: true, explain: true }), target, 'optimize', replayDirOf(a), title)
      }
    }
  }
  let savedTeam: string | undefined
  if (bool(a, 'save-team')) {
    const { path, file } = teamFileFor(a, comp, scenarioId)
    savedTeam = saveTeamFile(path, teamFileWithBuilds(file, r.chosen.options, r.chosen.spec.team, { report: rel(files.markdown), date: today(), note: `optimize ${scenarioId} --budget ${budget}` }))
  }
  if (r.tune?.accepted) {
    const thetaFile = join(dirname(files.json), `${id}.theta.json`)
    writeFileSync(thetaFile, JSON.stringify(r.tune.theta, null, 2) + '\n')
    say(`θ retenu : ${rel(thetaFile)} (à passer avec --theta)`)
  }
  const s = (performance.now() - t0) / 1000
  if (json) {
    console.log(JSON.stringify({ id, files, bestReplay, savedTeam, seconds: s, builds: report.builds, results: report.results.result }, null, 2))
    return 0
  }
  printOptimizeSummary(r, s)
  console.log(`Rapport : ${rel(files.markdown)} (+ ${rel(files.json)}, ${files.replays.length} replay(s))`)
  if (bestReplay) console.log(`Meilleur replay : ${rel(bestReplay)}`)
  if (savedTeam) console.log(`Fichier d'équipe mis à jour : ${rel(savedTeam)}`)
  return 0
}

function printOptimizeSummary(r: BuildSearchResult, seconds: number): void {
  const v = r.validation
  console.log('')
  const verdict = v.same ? 'builds par défaut : aucune option n’a fait mieux' : v.chosen === 'best' ? 'configuration optimisée' : 'builds par défaut : gain non confirmé à la validation'
  console.log(`Builds retenus (${verdict}) — ${r.fights} combats nouveaux, ${seconds.toFixed(0)} s :`)
  r.chosen.options.forEach((o, i) => console.log(`  ${r.chosen.spec.team[i].name.padEnd(10)} ${o.id}${o.note ? ` — ${o.note}` : ''}`))
  const m = v.bestMetrics
  console.log(`Validation ${v.seeds} graines : ${m.wins}/${m.n} victoires (IC95 ${pct(m.wilson95[0])} – ${pct(m.wilson95[1])}), objectif ${m.objective.toFixed(3)}, corrompus ${m.corrupted.toFixed(1)}, tours ${m.rounds.toFixed(1)}, 1re mort ${m.firstDeath.toFixed(1)}`)
  if (!v.same) {
    const q = v.referenceMetrics
    console.log(`  référence : ${q.wins}/${q.n} victoires, objectif ${q.objective.toFixed(3)}, corrompus ${q.corrupted.toFixed(1)}, tours ${q.rounds.toFixed(1)}, 1re mort ${q.firstDeath.toFixed(1)} ; Δ apparié ${v.paired.diff >= 0 ? '+' : ''}${v.paired.diff.toFixed(3)} (z ${v.paired.z.toFixed(2)})`)
  }
  for (const n of r.notes) console.log(`  note : ${n}`)
}

// ───────────────────────────── stuff ─────────────────────────────

/** Membre visé par `stuff --member` : n° dans l'équipe (1…), classe (premier membre de cette classe), ou preset. */
function stuffTarget(a: Args, data: GameDataStore, scenarioId: string): { option: BuildOption; index?: number; comp?: UserComposition; buildScenario: string } {
  const who = str(a, 'member')
  if (!who) throw new Error('stuff : --member <n°|classe|preset[@stuff]> attendu')
  const comp = compositionOf(a, scenarioId)
  const buildScenario = comp?.scenarioId ?? scenarioId
  // Un nombre est un n° de membre (jamais un identifiant de classe : `--member 5` dans une équipe de 4 est une erreur,
  // pas un Xélor).
  if (/^\d+$/.test(who)) {
    if (!comp) throw new Error(`stuff --member ${who} : aucune équipe pour « ${scenarioId} » (fichier data/teams/${scenarioTag(scenarioId) || 'scenario'}.json, --team-file ou --classes) ; sinon --member <classe|preset>`)
    const k = Number(who)
    if (k < 1 || k > comp.members.length) throw new Error(`stuff --member ${who} : n° de membre entre 1 et ${comp.members.length} attendu (${memberNames(comp).map((n, i) => `${i + 1} = ${n}`).join(', ')})`)
    const index = k - 1
    return { option: referenceOption(comp, index, data, buildScenario), index, comp, buildScenario }
  }
  const breedId = breedIdOf(who)
  if (breedId !== undefined && !findPreset(who) && !/[:@]/.test(who)) {
    const index = comp?.members.findIndex(m => m.breedId === breedId) ?? -1
    if (comp && index >= 0) return { option: referenceOption(comp, index, data, buildScenario), index, comp, buildScenario }
    return { option: referenceOption(compositionFromClasses([breedId], scenarioId), 0, data, scenarioId), buildScenario: scenarioId }
  }
  const preset = findPreset(who.split('@')[0]) ?? findPreset(parseTeam(who, data)[0].presetId)
  if (!preset) throw new Error(`stuff : membre inconnu « ${who} »`)
  const option = optionFromText(who, preset.breedId, { data, name: preset.className }, 'user', buildScenario)
  return { option, buildScenario }
}

function candidateLine(data: GameDataStore, c: StuffCandidate): string {
  const r = computeBuildStats(c.build, data)
  return `logJ ${c.score.logJ.toFixed(3)} (DPT ${c.score.dpt.toFixed(0)}, EHP ${c.score.ehp.toFixed(0)}, UTIL ${c.score.util.toFixed(2)}) — ${r.stats.ap} PA ${r.stats.mp} PM ${r.stats.range} PO, ${r.maxHp} PV, points ${c.pointsId}`
}

export async function cmdStuff(a: Args, data: GameDataStore): Promise<number> {
  const scenarioId = a.positional[0] ?? 'vortex'
  const tag = scenarioTag(scenarioId) || 'scenario'
  const target = stuffTarget(a, data, scenarioId)
  const { option } = target
  const profile = (str(a, 'profile') ?? 'balanced') as VortexProfile
  if (!VORTEX_PROFILES.includes(profile)) throw new Error(`--profile : ${VORTEX_PROFILES.join('|')} attendu`)
  const member = option.member
  const fixed = bool(a, 'no-keep-dofus') ? [] : member.build.items.map(it => data.item(it.itemId)).filter(it => !!it && it.slot === 'dofus' && hasPassive(it)).map(it => it!.id)
  const json = bool(a, 'json')
  if (!json) console.log(`stuff ${scenarioId} — ${member.name} : ${option.id} (rôle ${member.role ?? option.preset.role}, profil ${profile}${fixed.length ? `, ${fixed.length} Dofus à passif gardé(s)` : ''})`)
  const result = optimizeStuff(data, member, {
    iterations: num(a, 'iterations', 30000),
    seed: num(a, 'seed', 1),
    diversity: num(a, 'diversity', 5),
    proxy: scenarioProxyOptions(scenarioId, option.preset, profile),
    fixed,
  })
  let chosen = result.best
  let validation: { seeds: number; kinds: string[]; objectives: number[]; chosen: number } | undefined
  if (a.flags.has('validate')) {
    if (target.index === undefined || !target.comp) throw new Error('stuff --validate : le membre doit appartenir à l’équipe (--member <n°|classe> avec un fichier d’équipe ou --classes)')
    const choice = teamChoiceOf(a, data, scenarioId)
    const spec = specOf(a, data, scenarioId, 'fast', choice)
    const cands = result.front.filter(c => c.key !== 'start')
    const kinds = str(a, 'validate-kind') ? [str(a, 'validate-kind') as WorkerTask['kind']] : defaultValidationKinds(scenarioId)
    const cache = cacheOf(a, `stuff-${tag}`)
    const v = await withPool(num(a, 'workers', defaultPoolSize()), pool => validateStuffs(spec, target.index!, cands, pool, { seeds: num(a, 'validate', 16), kinds, cache }), data, dataDirOf(a))
    validation = { seeds: num(a, 'validate', 16), kinds, objectives: v.objectives, chosen: v.chosen }
    if (v.chosen > 0) chosen = cands[v.chosen - 1]
    else chosen = result.start
  }
  const build = { ...chosen.build, name: member.name }
  const out = resolve(str(a, 'out') ?? join(RUNS_DIR, `stuff-${tag}-${option.preset.id}${target.index !== undefined ? `-m${target.index + 1}` : ''}.json`))
  // Le champ « build » d'un fichier d'équipe est relatif à CE fichier (teamfile.ts), pas au dossier courant.
  const teamDir = target.comp?.file ? dirname(resolve(target.comp.file)) : teamsDirsOf(a)[0]
  const buildRef = relative(teamDir, out).split('\\').join('/')
  const payload = {
    kind: 'dofussimu-build',
    version: 1,
    scenario: scenarioId,
    preset: option.preset.id,
    class: option.preset.className,
    member: member.name,
    profile,
    createdAt: today(),
    proxy: { start: result.start.score, best: result.best.score, chosen: chosen.score, ms: Math.round(result.ms) },
    validation,
    build: { level: build.level, items: build.items, characteristicPoints: build.characteristicPoints, scrolls: build.scrolls, spellVariants: build.spellVariants },
    front: result.front.map(c => ({ key: c.key, pointsId: c.pointsId, score: c.score })),
    usage: `Fichier d'équipe (${rel(target.comp?.file ? resolve(target.comp.file) : join(teamDir, `${tag}.json`))}) : { "class": "${normalizeName(option.preset.className)}", "preset": "${option.preset.id}", "build": "${buildRef}" } (chemin relatif au fichier d'équipe)`,
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')
  if (json) {
    console.log(JSON.stringify({ file: out, ...payload }, null, 2))
    return 0
  }
  console.log(`Départ : ${candidateLine(data, result.start)}`)
  console.log(`Proxy  : ${candidateLine(data, result.best)} (${(result.ms / 1000).toFixed(1)} s, ${result.evaluations.exact} évaluations exactes)`)
  if (validation) console.log(`Validation par combats (${validation.seeds} graines, ${validation.kinds.join('+')}) : objectifs ${validation.objectives.map(x => x.toFixed(3)).join(' / ')} → build ${validation.chosen === 0 ? 'de départ conservé' : `n° ${validation.chosen} du front`}`)
  const desc = describeMember(data, { ...member, build })
  for (const it of desc.items) console.log(`  ${it.slot.padEnd(16)} ${it.name}${it.forgemagie.length ? ` [${it.forgemagie.join(', ')}]` : ''}${it.passiveUnsimulated ? ' (sort passif)' : ''}`)
  console.log(`  Points : ${Object.entries(desc.points).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  console.log(`Build : ${rel(out)}`)
  return 0
}

// ───────────────────────────── report ─────────────────────────────

export function cmdReport(a: Args, data: GameDataStore): number {
  const file = a.positional[0]
  if (!file) throw new Error('report : fichier attendu (docs/reports/<id>.json ou runs/<lot>.summary.json)')
  const raw = JSON.parse(readFileSync(resolve(file), 'utf8')) as Record<string, unknown>
  let md: string
  if (raw.results && raw.team && raw.plan) md = renderMarkdown(raw as unknown as OptimizationReport)
  else if (Array.isArray(raw.summaries) && typeof raw.scenarioId === 'string') {
    const summaries = raw.summaries as FightSummary[]
    const notes: string[] = []
    let spec = raw.spec as FightSpec | undefined
    if (!spec) {
      spec = { scenarioId: raw.scenarioId, team: parseTeam((raw.team as string[]).join(','), data), mode: (raw.mode as FightSpec['mode']) ?? 'fast', theta: loadTheta(), variantPolicy: 'default', monsterNoise: 0 }
      notes.push('Résumé sans spécification complète : builds reconstruits depuis les presets de base (stuffs des presets dérivés perdus) et θ par défaut.')
    }
    const perSeed = summaries.map(shapedScore)
    const c = raw.composition as { classes: string[]; source: string; file?: string } | undefined
    // Résumés antérieurs sans `kind` : déduit du nom par défaut (`batch-<scénario>-<mode>-<micro>.summary.json`).
    const kind = typeof raw.kind === 'string' ? raw.kind : (/-(prefix12|phase2|poutch)\.summary\.json$/.exec(file)?.[1] ?? 'full')
    if (kind !== 'full') notes.push(`Lot joué sur le micro-scénario \`${kind}\` (\`batch --micro ${kind}\`) : « victoire » = micro-scénario réussi, pas le donjon complet.`)
    const report = buildReport(data, {
      id: basename(file).replace(/\.summary\.json$|\.json$/, ''),
      title: `Lot ${raw.scenarioId} — ${spec.mode}${kind !== 'full' ? `, micro-scénario ${kind}` : ''}, ${summaries.length} combats`,
      spec,
      evaluation: { spec, summaries, result: summarizeBatch(summaries), objective: mean(perSeed), perSeed },
      composition: c && { kind: 'user', classes: c.classes, text: c.classes.join(', '), file: c.file },
      notes,
    })
    md = renderMarkdown(report)
  } else throw new Error(`${file} : format non reconnu (rapport JSON d'optimize/team, ou résumé de batch)`)
  const out = str(a, 'out')
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(resolve(out), md)
    console.log(`Rapport : ${rel(resolve(out))}`)
  } else console.log(md)
  return 0
}

// ───────────────────────────── tune ─────────────────────────────

export async function cmdTune(a: Args, data: GameDataStore): Promise<number> {
  const scenarioId = a.positional[0] ?? 'vortex'
  const tag = scenarioTag(scenarioId) || 'scenario'
  const choice = teamChoiceOf(a, data, scenarioId)
  const spec = specOf(a, data, scenarioId, 'fast', choice)
  console.log(teamLine(choice))
  const seeds = num(a, 'seeds', 16)
  const r = await withPool(
    num(a, 'workers', defaultPoolSize()),
    pool =>
      tuneThetaByFights(spec, pool, {
        paths: str(a, 'paths')?.split(',').map(s => s.trim()).filter(Boolean),
        keep: num(a, 'keep', 8),
        screen: { seeds, masterSeed: num(a, 'master-seed', 0x5c3e) >>> 0 },
        cem: { generations: num(a, 'generations', 6), population: num(a, 'population', 10), elite: num(a, 'elite', 3), seedsPerGeneration: seeds },
        validation: { seeds: num(a, 'validate', 64) },
        cache: cacheOf(a, `tune-${tag}`),
      }),
    data,
    dataDirOf(a),
  )
  const out = resolve(str(a, 'out') ?? join(RUNS_DIR, `theta-${tag}.json`))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(r.theta, null, 2) + '\n')
  console.log(`θ ${r.accepted ? 'ACCEPTÉ' : 'rejeté (θ de départ conservé)'} : validation Δ ${r.validation.paired.diff.toFixed(4)} (z ${r.validation.paired.z.toFixed(2)}, ${r.validation.seeds} graines), ${r.evaluations} combats`)
  for (const [k, [x, y]] of Object.entries(r.changes)) console.log(`  ${k} : ${x} → ${y}`)
  console.log(`Paramètres réglés : ${r.selected.join(', ')}`)
  console.log(`θ : ${rel(out)} (npm run sim -- batch ${scenarioId} --theta ${rel(out)})`)
  return 0
}

// ───────────────────────────── rewind ─────────────────────────────

export function cmdRewind(a: Args, data: GameDataStore): number {
  const scenarioId = a.positional[0] ?? 'vortex'
  const choice = teamChoiceOf(a, data, scenarioId)
  const spec = specOf(a, data, scenarioId, 'fast', choice)
  const seed = num(a, 'seed', 1) >>> 0
  const replay = str(a, 'replay') ?? 'auto'
  console.log(teamLine(choice))
  const modes = (str(a, 'modes') ?? 'scripted,fast').split(',').map(s => s.trim()) as FightSpec['mode'][]
  const r = rewindFight(data, spec, seed, { maxResumes: num(a, 'max-resumes', 12), robustSeeds: num(a, 'robust-seeds', 0), modes, record: replay !== 'none' })
  console.log(`${scenarioId} graine ${seed} : ${r.original.win ? 'VICTOIRE' : 'défaite'} en ${r.original.rounds} tours, échec au tour ${r.failRound} ; reprise déterministe ${r.deterministic ? 'oui' : 'NON'}`)
  for (const t of r.attempts) console.log(`  tour ${t.from} — ${t.label} : ${t.summary.win ? 'VICTOIRE' : 'défaite'} en ${t.summary.rounds} tours, score ${t.summary.score.toFixed(3)}`)
  if (r.robust) console.log(`Alternative la plus robuste au tour ${r.robust.from} (${r.robust.seeds} dés) : ${r.robust.best}`)
  if (r.winningLine) {
    console.log(`Ligne gagnante (OPTIMISTE, jamais comptée dans un taux de victoire) : reprise au tour ${r.winningLine.from}, ${r.winningLine.label}`)
    if (r.winningLine.replay && replay !== 'none') {
      const tag = scenarioTag(scenarioId) || 'scenario'
      const target = replay === 'auto' ? join(replayDirOf(a), `${tag}-rewind-s${seed}.json`) : resolve(replay)
      const title = `${scenarioId} — rembobinage (optimiste), graine ${seed}`
      r.winningLine.replay.meta = { ...(r.winningLine.replay.meta ?? {}), title }
      const path = writeReplay(target, r.winningLine.replay, { title, scenario: scenarioId, seed, win: true, rounds: r.winningLine.summary.rounds, createdAt: new Date().toISOString() })
      console.log(`Replay : ${rel(path)}`)
    }
  } else if (!r.original.win) console.log('Aucune ligne gagnante trouvée.')
  return 0
}

// ───────────────────────────── team (opt-in) ─────────────────────────────

export async function cmdTeam(a: Args, data: GameDataStore): Promise<number> {
  const scenarioId = a.positional[0] ?? 'vortex'
  const tag = scenarioTag(scenarioId) || 'scenario'
  console.log('RECHERCHE AUTOMATIQUE DE COMPOSITION (opt-in). La composition est normalement choisie par l’utilisateur')
  console.log(`(data/teams/${tag}.json, --classes) et seuls les builds sont optimisés (« optimize ») ; cette commande explore d'autres classes.`)
  const base = baseSpecOf(a, scenarioId, 'fast')
  const micro = resolveScenario(scenarioId).micro
  const t1Kinds: WorkerTask['kind'][] = micro.prefix12 && micro.phase2 ? ['prefix12', 'phase2'] : ['full']
  const stages: HalvingStage[] = [
    { name: `T1 ${t1Kinds.join('+')}`, kinds: t1Kinds, seeds: num(a, 't1-seeds', 16), keep: num(a, 't1-keep', 40), diversity: true },
    { name: 'T2 complet', kinds: ['full'], seeds: num(a, 't2-seeds', 64), keep: num(a, 't2-keep', 4) },
  ]
  const id = str(a, 'id') ?? `${tag}-composition-auto`
  const cache = cacheOf(a, `team-${tag}`)
  const { report, files } = await withPool(
    num(a, 'workers', defaultPoolSize()),
    async pool => {
      const res = await runCompositionCampaign(data, base, pool, {
        t0: { top: num(a, 'top', 400) },
        calibrate: bool(a, 'no-calibrate') ? false : {},
        halving: { stages, masterSeed: a.flags.has('master-seed') ? num(a, 'master-seed', 0) >>> 0 : undefined },
        coopt: bool(a, 'coopt') ? {} : false,
        finalists: num(a, 'finalists', 4),
        validation: { seeds: num(a, 'validate', 24) },
        cache,
        onLog: l => console.log(l),
      })
      return generateReport(data, res.best.spec, pool, {
        id,
        title: `Composition cherchée automatiquement (opt-in) — ${scenarioId}`,
        createdAt: today(),
        evaluation: res.best.validation,
        campaign: res,
        dir: resolve(str(a, 'out-dir') ?? REPORTS_DIR),
        replays: !bool(a, 'no-replays'),
        cache,
        notes: ['Composition cherchée AUTOMATIQUEMENT (commande `team`, opt-in) : par défaut la composition est choisie par l’utilisateur et seuls les builds sont optimisés (`optimize`).'],
      })
    },
    data,
    dataDirOf(a),
  )
  console.log(`Meilleure équipe : ${report.team.map(m => `${m.name} (${m.presetId})`).join(', ')} — ${pct(report.results.result.winRate)} sur ${report.results.n}`)
  console.log(`Rapport : ${rel(files.markdown)}`)
  return 0
}

/** Noms des membres (exports pour les tests). */
export { memberNames }
