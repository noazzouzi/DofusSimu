/**
 * Composition CHOISIE PAR L'UTILISATEUR (décision du 2026-10-05) : les classes de l'équipe d'un donjon sont une ENTRÉE ;
 * le simulateur optimise tout le reste pour cette composition — build de chaque personnage (preset élément/rôle, stuff
 * avec exos et transcendances, points de caractéristiques, variantes des 22 paires de sorts) et stratégie de combat (θ)
 * — dans `src/optimizer/builds.ts` (commande `optimize`). La recherche automatique de composition (`team/halving.ts`,
 * commande `team`) reste disponible mais seulement sur demande explicite.
 *
 * Sources d'une composition (ordre de priorité de la CLI) :
 *  1. `--team` : builds exacts (presets, `preset@stuff`, `classe:qualificatif`) — chaque membre est ÉPINGLÉ ;
 *  2. `--classes eniripsa,enutrof,cra,cra` : classes seules (noms, alias ou identifiants ; doublons permis, `cra*2`) ;
 *  3. `--team-file <fichier>` ou, à défaut, le fichier d'équipe du scénario `data/teams/<scénario>.json` : équipe par
 *     défaut du scénario quand `--team` est absent ;
 *  4. sinon l'équipe d'exemple historique (`DEFAULT_TEAM` de la CLI).
 *
 * Fichier d'équipe (`TeamFile`, JSON) :
 *   { "version": 1, "scenario": "vortex", "chosenBy": "utilisateur", "decidedAt": "2026-10-05",
 *     "members": [ { "class": "eniripsa" }, { "class": "enutrof" }, { "class": "cra" }, { "class": "cra" } ],
 *     "notes": "texte libre (ou liste de lignes)" }
 * Champs d'un membre : `class` (obligatoire : nom, alias ou id) ; facultatifs : `name` (nom affiché), `preset` (build
 * par défaut : id de preset, `preset@stuff` ou `classe:qualificatif`, de la MÊME classe), `stuff` (stuff de
 * data/ai/presets.json), `role` (rôle imposé à l'IA), `variants` (22 choix 0/1), `build` (build complet — objets avec
 * forgemagie, points, parchemins, variantes — ou chemin d'un fichier écrit par `stuff --out`, relatif au fichier
 * d'équipe), `candidates` (presets que `optimize` essaie pour ce membre ; défaut : automatiques), `fixed` (vrai :
 * `optimize` ne change pas le build de ce membre — seulement variantes et θ si demandés). `preset`/`stuff`/`build`
 * donnent le build utilisé par `fight`/`batch` et le point de départ (référence) d'`optimize` ; `optimize --save-team`
 * les écrit (sans `fixed`, une nouvelle optimisation repart donc de ces builds).
 *
 * Build par défaut d'un membre non épinglé (`referenceOption`) : presets de sa classe ordonnés pour le scénario
 * (`scenarioPresets`) — d'abord les presets dérivés propres au scénario (`<base>_<scénario>[_profil]`, ex.
 * `cra_feu_vortex` : stuff construit par l'optimiseur pour ce donjon), un par preset de base dans l'ordre du fichier
 * (profil équilibré de préférence), puis les presets de base sans version pour ce scénario. Le k-ième membre SANS preset
 * d'une même classe prend le k-ième build de cette liste, privée des builds (presets de base) que d'autres membres de la
 * classe épinglent par `preset` (deux Crâs au Vortex : `cra_feu_vortex` puis `cra_air_entrave_vortex`) : rôles
 * distincts par défaut ; `optimize` essaie ensuite les autres combinaisons.
 *
 * Module pur (ni fichier ni moteur) : la lecture des fichiers est dans `teamfile.ts`.
 */
import type { RoleId } from '../../ai/types'
import { ROLE_IDS } from '../../ai/types'
import type { PrimaryStat } from '../../stats/characteristicPoints'
import type { BuildDataSource, CharacterBuild, EquippedItem } from '../../stats/build'
import type { MemberSpec } from '../types'
import { BASE_PRESETS, breedIdOf, findPreset, normalizeName, PRESETS, presetMember, resolvePreset, STUFFS, type Preset } from './presets'

export const TEAM_FILE_VERSION = 1

// ───────────────────────────── types ─────────────────────────────

/** Build complet d'un membre dans un fichier d'équipe (sortie de `stuff --out`). */
export interface TeamFileBuild {
  items: EquippedItem[]
  characteristicPoints?: Partial<Record<PrimaryStat, number>>
  scrolls?: Partial<Record<PrimaryStat, number>>
  spellVariants?: (0 | 1)[]
  level?: number
}

export interface TeamFileMember {
  class: string | number
  name?: string
  preset?: string
  stuff?: string
  role?: RoleId
  variants?: (0 | 1)[]
  /** Build complet, ou chemin d'un fichier JSON (résolu par `teamfile.ts` avant validation). */
  build?: TeamFileBuild | string
  candidates?: string[]
  /** Build imposé : `optimize` ne le change pas. */
  fixed?: boolean
}

export interface TeamFile {
  version: number
  scenario: string
  description?: string
  /** Qui a choisi la composition (« utilisateur »). */
  chosenBy?: string
  decidedAt?: string
  members: TeamFileMember[]
  notes?: string | string[]
  /** Renseigné par `optimize --save-team` : rapport d'origine des builds épinglés. */
  optimized?: { report: string; date?: string; note?: string }
  format?: string
}

export type CompositionSource = 'team' | 'classes' | 'file'

export interface CompositionMember {
  breedId: number
  className: string
  name?: string
  /** Build épinglé ou de départ (`preset`, `preset@stuff`, `classe:qualificatif`). */
  preset?: string
  stuff?: string
  role?: RoleId
  variants?: (0 | 1)[]
  build?: TeamFileBuild
  candidates?: string[]
  fixed?: boolean
}

export interface UserComposition {
  scenarioId?: string
  source: CompositionSource
  /** Fichier d'équipe (source 'file'). */
  file?: string
  members: CompositionMember[]
  notes: string[]
  chosenBy: string
  decidedAt?: string
  description?: string
}

/**
 * Origine d'une option de build (rapport) : 'fixed' (imposé : `--team` ou `fixed`), 'user' (build par défaut donné par
 * le fichier d'équipe), 'scenario' (preset dérivé du scénario), 'class' (preset de base de la classe), 'candidate'
 * (`candidates` du fichier), 'stuff-optimizer' (stuff construit par `optimizeStuff`), 'file-build' (build complet du
 * fichier).
 */
export type BuildOrigin = 'fixed' | 'user' | 'scenario' | 'class' | 'candidate' | 'stuff-optimizer' | 'file-build'

export interface BuildOption {
  /** Identifiant : `cra_feu_vortex`, `cra_feu_zone@feu`, `cra_terre_mono@opt` (stuff optimisé), `…+build`. */
  id: string
  /** Preset (dérivé éventuellement) qui fournit l'identité IA, la rotation et les variantes de départ. */
  preset: Preset
  member: MemberSpec
  origin: BuildOrigin
  /** Le build a-t-il un stuff propre au scénario (preset dérivé du scénario, build du fichier, stuff optimisé) ? */
  scenarioStuff: boolean
  note?: string
}

// ───────────────────────────── classes ─────────────────────────────

/** Nom d'affichage d'une classe (« Crâ »). */
export function classNameOf(breedId: number): string {
  const p = PRESETS.find(x => x.breedId === breedId)
  if (!p) throw new Error(`Classe inconnue : ${breedId}`)
  return p.className
}

/** Classes connues (noms d'affichage, ordre des identifiants). */
export function knownClasses(): string[] {
  const ids = [...new Set(BASE_PRESETS.map(p => p.breedId))].sort((a, b) => a - b)
  return ids.map(id => `${classNameOf(id)} (${id})`)
}

/** Classe d'un nom (accents, casse ignorés), alias ou identifiant ; erreur explicite sinon. */
export function classIdOf(name: string | number): number {
  const id = breedIdOf(String(name))
  if (id === undefined) throw new Error(`Classe inconnue : « ${name} » (classes : ${knownClasses().join(', ')})`)
  return id
}

/**
 * `--classes` : classes séparées par des virgules (ou `+`), noms, alias ou identifiants, doublons permis ; `cra*2` (ou
 * `2*cra`) répète une classe. Ex. `eniripsa,enutrof,cra,cra` ≡ `eni,enu,cra*2` ≡ `7,3,9,9`.
 */
export function parseClasses(text: string): number[] {
  const out: number[] = []
  for (const raw of text.split(/[,+]/).map(s => s.trim()).filter(Boolean)) {
    // « cra*2 » ou « 2*cra » (« 9 » seul est un identifiant de classe, pas une répétition).
    const after = /^(.+?)\s*[*×]\s*(\d+)$/.exec(raw)
    const before = after ? null : /^(\d+)\s*[*×]\s*(.+)$/.exec(raw)
    const name = after ? after[1] : before ? before[2] : raw
    const times = after ? Number(after[2]) : before ? Number(before[1]) : 1
    if (!Number.isInteger(times) || times < 1 || times > 8) throw new Error(`--classes : répétition invalide (« ${raw} »)`)
    const id = classIdOf(name)
    for (let k = 0; k < times; k++) out.push(id)
  }
  if (!out.length) throw new Error('--classes : aucune classe')
  if (out.length > 8) throw new Error(`--classes : ${out.length} personnages (8 au plus)`)
  return out
}

// ───────────────────────────── compositions ─────────────────────────────

/** Composition depuis des classes seules (`--classes`). */
export function compositionFromClasses(breedIds: readonly number[], scenarioId?: string): UserComposition {
  return {
    scenarioId,
    source: 'classes',
    members: breedIds.map(breedId => ({ breedId, className: classNameOf(breedId) })),
    notes: [],
    chosenBy: 'utilisateur',
  }
}

/** Composition depuis une équipe en texte (`--team`) : chaque membre est épinglé sur le preset (et le stuff) donné. */
export function compositionFromTeamText(text: string, scenarioId?: string): UserComposition {
  const parts = text.split(',').map(s => s.trim()).filter(Boolean)
  if (!parts.length) throw new Error('Équipe vide')
  return {
    scenarioId,
    source: 'team',
    members: parts.map(part => {
      const preset = resolvePreset(part.split('@')[0].trim())
      return { breedId: preset.breedId, className: preset.className, preset: part, fixed: true }
    }),
    notes: [],
    chosenBy: 'utilisateur',
  }
}

const MEMBER_KEYS = new Set(['class', 'name', 'preset', 'stuff', 'role', 'variants', 'build', 'candidates', 'fixed'])
const FILE_KEYS = new Set(['version', 'scenario', 'description', 'chosenBy', 'decidedAt', 'members', 'notes', 'optimized', 'format', '$schema'])

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Valide un build de fichier d'équipe (forme seulement : la validité en jeu est vérifiée par `computeBuildStats`). */
function checkBuild(b: unknown, where: string): TeamFileBuild {
  if (!isObj(b) || !Array.isArray(b.items)) throw new Error(`${where} : « build » doit être un objet { items: [...] } (ou un chemin de fichier)`)
  for (const it of b.items) if (!isObj(it) || !Number.isInteger(it.itemId)) throw new Error(`${where} : objet sans « itemId » dans « build.items »`)
  return b as unknown as TeamFileBuild
}

function checkVariants(v: unknown, where: string): (0 | 1)[] {
  if (!Array.isArray(v) || !v.every(x => x === 0 || x === 1)) throw new Error(`${where} : « variants » doit être une liste de 0/1`)
  return v as (0 | 1)[]
}

/**
 * Valide un fichier d'équipe (JSON déjà lu ; les `build` donnés par chemin doivent avoir été chargés) : version, membres
 * (1 à 8), classes connues, presets et candidats de la bonne classe, stuffs connus, rôles connus, clés inconnues
 * refusées (fautes de frappe). `origin` : nom du fichier pour les messages.
 */
export function parseTeamFile(json: unknown, origin = 'fichier d’équipe'): TeamFile {
  if (!isObj(json)) throw new Error(`${origin} : objet JSON attendu`)
  for (const k of Object.keys(json)) if (!FILE_KEYS.has(k)) throw new Error(`${origin} : clé inconnue « ${k} »`)
  const version = json.version ?? TEAM_FILE_VERSION
  if (version !== TEAM_FILE_VERSION) throw new Error(`${origin} : version ${String(version)} non prise en charge (attendu ${TEAM_FILE_VERSION})`)
  if (typeof json.scenario !== 'string' || !json.scenario) throw new Error(`${origin} : « scenario » manquant`)
  if (!Array.isArray(json.members) || !json.members.length) throw new Error(`${origin} : « members » doit être une liste non vide`)
  if (json.members.length > 8) throw new Error(`${origin} : ${json.members.length} membres (8 au plus)`)
  const members = json.members.map((m, i): TeamFileMember => {
    const where = `${origin}, membre ${i + 1}`
    if (typeof m === 'string' || typeof m === 'number') return { class: m }
    if (!isObj(m)) throw new Error(`${where} : objet { "class": … } attendu`)
    for (const k of Object.keys(m)) if (!MEMBER_KEYS.has(k)) throw new Error(`${where} : clé inconnue « ${k} » (clés : ${[...MEMBER_KEYS].join(', ')})`)
    if (typeof m.class !== 'string' && typeof m.class !== 'number') throw new Error(`${where} : « class » manquant`)
    const breedId = classIdOf(m.class)
    const out: TeamFileMember = { class: m.class }
    if (m.name !== undefined) {
      if (typeof m.name !== 'string' || !m.name.trim()) throw new Error(`${where} : « name » doit être un texte`)
      out.name = m.name.trim()
    }
    const checkPreset = (text: unknown, what: string): string => {
      if (typeof text !== 'string' || !text.trim()) throw new Error(`${where} : « ${what} » doit être un texte`)
      const [who, stuff] = text.split('@').map(s => s.trim())
      let p: Preset
      try {
        p = resolvePreset(who)
      } catch (e) {
        throw new Error(`${where} : « ${what} » = « ${text} » : ${(e as Error).message}`)
      }
      if (p.breedId !== breedId) throw new Error(`${where} : « ${text} » est un preset ${p.className}, pas ${classNameOf(breedId)}`)
      if (stuff) checkStuff(stuff, where, p)
      return text.trim()
    }
    if (m.preset !== undefined) out.preset = checkPreset(m.preset, 'preset')
    if (m.stuff !== undefined) {
      if (typeof m.stuff !== 'string') throw new Error(`${where} : « stuff » doit être un texte`)
      checkStuff(m.stuff, where)
      out.stuff = m.stuff
    }
    if (m.role !== undefined) {
      if (!(ROLE_IDS as readonly unknown[]).includes(m.role)) throw new Error(`${where} : rôle inconnu « ${String(m.role)} » (${ROLE_IDS.join(', ')})`)
      out.role = m.role as RoleId
    }
    if (m.variants !== undefined) out.variants = checkVariants(m.variants, where)
    if (m.build !== undefined) {
      if (typeof m.build === 'string') throw new Error(`${where} : « build » = « ${m.build} » : chemin non chargé (utiliser loadTeamFile)`)
      out.build = checkBuild(m.build, where)
    }
    if (m.candidates !== undefined) {
      if (!Array.isArray(m.candidates) || !m.candidates.length) throw new Error(`${where} : « candidates » doit être une liste non vide`)
      out.candidates = m.candidates.map(c => checkPreset(c, 'candidates'))
    }
    if (m.fixed !== undefined) {
      if (typeof m.fixed !== 'boolean') throw new Error(`${where} : « fixed » doit être true ou false`)
      if (m.fixed && m.candidates) throw new Error(`${where} : « fixed » et « candidates » sont incompatibles`)
      out.fixed = m.fixed
    }
    return out
  })
  const notes = json.notes
  if (notes !== undefined && typeof notes !== 'string' && !(Array.isArray(notes) && notes.every(n => typeof n === 'string'))) {
    throw new Error(`${origin} : « notes » doit être un texte ou une liste de textes`)
  }
  return { ...(json as unknown as TeamFile), version: TEAM_FILE_VERSION, members }
}

function checkStuff(stuff: string, where: string, preset?: Preset): void {
  if (stuff === 'default' || stuff === 'unstuffed' || stuff === 'naked') return
  const tpl = STUFFS[stuff]
  if (!tpl) throw new Error(`${where} : stuff inconnu « ${stuff} »`)
  if (preset && tpl.breeds && !tpl.breeds.includes(preset.breedId)) throw new Error(`${where} : le stuff « ${stuff} » n'est pas prévu pour ${preset.className}`)
}

/** Composition d'un fichier d'équipe validé. */
export function compositionFromTeamFile(file: TeamFile, path?: string): UserComposition {
  return {
    scenarioId: file.scenario,
    source: 'file',
    file: path,
    members: file.members.map(m => {
      const breedId = classIdOf(m.class)
      return {
        breedId,
        className: classNameOf(breedId),
        name: m.name,
        preset: m.preset,
        stuff: m.stuff,
        role: m.role,
        variants: m.variants,
        build: typeof m.build === 'string' ? undefined : m.build,
        candidates: m.candidates,
        fixed: m.fixed,
      }
    }),
    notes: file.notes === undefined ? [] : Array.isArray(file.notes) ? file.notes.slice() : [file.notes],
    chosenBy: file.chosenBy ?? 'utilisateur',
    decidedAt: file.decidedAt,
    description: file.description,
  }
}

/** Classes de la composition (« Eniripsa, Enutrof, Crâ, Crâ »). */
export function compositionClasses(comp: UserComposition): string[] {
  return comp.members.map(m => m.className)
}

/** Libellé d'une composition (rapports, CLI). */
export function describeComposition(comp: UserComposition): string {
  const where = comp.source === 'file' ? `fichier ${comp.file ?? 'd’équipe'}` : comp.source === 'classes' ? '--classes' : '--team'
  return `${compositionClasses(comp).join(', ')} (composition choisie par l’${comp.chosenBy === 'utilisateur' ? 'utilisateur' : comp.chosenBy} — ${where})`
}

/** Le build du membre est-il imposé (non cherché par `optimize`) ? */
export function isFixed(m: CompositionMember): boolean {
  return m.fixed === true
}

/** Noms uniques des membres : nom donné, sinon classe (« Crâ », « Crâ 2 »). */
export function memberNames(comp: UserComposition): string[] {
  const seen = new Map<string, number>()
  return comp.members.map(m => {
    if (m.name) return m.name
    const n = (seen.get(m.className) ?? 0) + 1
    seen.set(m.className, n)
    return n > 1 ? `${m.className} ${n}` : m.className
  })
}

// ───────────────────────────── presets d'un scénario ─────────────────────────────

/** Étiquette d'un scénario dans les identifiants de presets (`vortex`). */
export function scenarioTag(scenarioId: string): string {
  return normalizeName(scenarioId).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** Preset dérivé propre au scénario (`<base>_<tag>[_…]`, ou stuff `<tag>_…`) ? */
export function isScenarioPreset(p: Preset, scenarioId: string): boolean {
  if (!p.extends) return false
  const tag = scenarioTag(scenarioId)
  if (!tag) return false
  return p.id === `${p.extends}_${tag}` || p.id.startsWith(`${p.extends}_${tag}_`) || p.stuff.startsWith(`${tag}_`)
}

export interface ScenarioPresets {
  /** Un build par preset de base : version du scénario (profil équilibré de préférence) ou preset de base. */
  primary: Preset[]
  /** Autres versions du scénario (profils offensif/défensif…). */
  extra: Preset[]
  /** Presets de base remplacés par une version du scénario (non candidats par défaut). */
  superseded: Preset[]
}

/** Presets d'une classe ordonnés pour un scénario (voir l'en-tête). */
export function scenarioPresets(breedId: number, scenarioId: string): ScenarioPresets {
  const tag = scenarioTag(scenarioId)
  const withScenario: Preset[] = []
  const without: Preset[] = []
  const extra: Preset[] = []
  const superseded: Preset[] = []
  for (const base of BASE_PRESETS.filter(p => p.breedId === breedId)) {
    const derived = PRESETS.filter(p => p.extends === base.id && isScenarioPreset(p, scenarioId))
    if (!derived.length) {
      without.push(base)
      continue
    }
    const main = derived.find(p => p.id === `${base.id}_${tag}`) ?? derived[0]
    withScenario.push(main)
    extra.push(...derived.filter(p => p !== main))
    superseded.push(base)
  }
  return { primary: [...withScenario, ...without], extra, superseded }
}

// ───────────────────────────── options de build ─────────────────────────────

export interface OptionContext {
  data: BuildDataSource
  name: string
  role?: RoleId
  level?: number
}

/**
 * Option de build depuis un texte `preset[@stuff]` ou `classe:qualificatif[@stuff]` (la classe doit être `breedId`) ;
 * rôle imposé : celui du contexte, sinon le qualificatif s'il nomme un rôle (`iop:killer`), sinon celui du preset.
 */
export function optionFromText(text: string, breedId: number, ctx: OptionContext, origin: BuildOrigin, scenarioId?: string): BuildOption {
  const [who, stuffRaw] = text.split('@').map(s => s.trim())
  const preset = resolvePreset(who)
  if (preset.breedId !== breedId) throw new Error(`« ${text} » est un preset ${preset.className}, pas ${classNameOf(breedId)}`)
  const qual = who.includes(':') ? who.split(':')[1].trim() : ''
  const qualRole = (ROLE_IDS as readonly string[]).includes(qual) ? (qual as RoleId) : undefined
  const stuff = stuffRaw || undefined
  const member = presetMember(preset, ctx.data, { stuff, level: ctx.level, name: ctx.name, role: ctx.role ?? qualRole })
  const id = stuff ? `${preset.id}@${stuff}` : preset.id
  const scenarioStuff = !!scenarioId && (stuff ? stuff.startsWith(`${scenarioTag(scenarioId)}_`) : isScenarioPreset(preset, scenarioId))
  return { id, preset, member, origin, scenarioStuff }
}

/** Applique les surcharges d'un membre (build complet, variantes) à une option. */
export function withOverrides(opt: BuildOption, m: CompositionMember): BuildOption {
  let member = opt.member
  let id = opt.id
  let origin = opt.origin
  let scenarioStuff = opt.scenarioStuff
  if (m.build) {
    const b = m.build
    const build: CharacterBuild = {
      ...member.build,
      level: b.level ?? member.build.level,
      items: b.items.map(it => ({ ...it, exos: it.exos?.map(e => ({ ...e })), rolls: it.rolls ? { ...it.rolls } : undefined })),
      characteristicPoints: b.characteristicPoints ? { ...b.characteristicPoints } : member.build.characteristicPoints,
      scrolls: b.scrolls ? { ...b.scrolls } : member.build.scrolls,
      spellVariants: b.spellVariants?.slice() ?? member.build.spellVariants,
    }
    member = { ...member, build, variants: b.spellVariants?.slice() ?? member.variants }
    id = `${opt.preset.id}+build`
    origin = 'file-build'
    scenarioStuff = true
  }
  if (m.variants) {
    member = { ...member, variants: m.variants.slice(), build: { ...member.build, spellVariants: m.variants.slice() } }
    if (!id.includes('+')) id = `${id}+variantes`
  }
  return member === opt.member ? opt : { ...opt, member, id, origin, scenarioStuff }
}

/**
 * Option de RÉFÉRENCE d'un membre : le build donné par l'utilisateur (`preset`/`stuff`/`build`), sinon le build par
 * défaut de sa classe pour le scénario (k-ième membre de la classe sans preset ⇒ k-ième build de
 * `scenarioPresets(…).primary`, voir l'en-tête).
 */
export function referenceOption(comp: UserComposition, index: number, data: BuildDataSource, scenarioId: string, level?: number): BuildOption {
  const m = comp.members[index]
  const name = memberNames(comp)[index]
  const ctx: OptionContext = { data, name, role: m.role, level }
  let opt: BuildOption
  if (m.preset !== undefined) {
    const text = m.stuff && !m.preset.includes('@') ? `${m.preset}@${m.stuff}` : m.preset
    opt = optionFromText(text, m.breedId, ctx, isFixed(m) ? 'fixed' : 'user', scenarioId)
  } else {
    const rank = comp.members.slice(0, index).filter(x => x.breedId === m.breedId && x.preset === undefined).length
    const { primary: all } = scenarioPresets(m.breedId, scenarioId)
    if (!all.length) throw new Error(`Aucun preset pour ${m.className}`)
    // Builds déjà pris par un membre de la même classe qui a un `preset` : écartés (deux Crâs dont l'un est épinglé sur
    // `cra_feu_vortex` ⇒ l'autre prend `cra_air_entrave_vortex`, pas un second Crâ Feu).
    const baseOf = (id: string): string => {
      const p = findPreset(id.split('@')[0].trim()) ?? resolvePreset(id.split('@')[0].trim())
      return p.extends ?? p.id
    }
    const taken = new Set(comp.members.filter(x => x !== m && x.breedId === m.breedId && x.preset !== undefined).map(x => baseOf(x.preset!)))
    const free = all.filter(p => !taken.has(p.extends ?? p.id))
    const primary = free.length ? free : all
    const p = primary[rank % primary.length]
    const text = m.stuff ? `${p.id}@${m.stuff}` : p.id
    opt = optionFromText(text, m.breedId, ctx, isFixed(m) ? 'fixed' : m.stuff ? 'user' : isScenarioPreset(p, scenarioId) ? 'scenario' : 'class', scenarioId)
  }
  const out = withOverrides(opt, m)
  return isFixed(m) ? { ...out, origin: 'fixed' } : out
}

/**
 * Options de build d'un membre pour `optimize` (la référence en tête, sans doublon) : membre imposé (`fixed`) ⇒ sa seule
 * référence ; `candidates` ⇒ ces presets ; sinon toutes les versions du scénario des presets de sa classe et les presets
 * de base sans version de scénario (`scenarioStuff` faux : `builds.ts` peut leur construire un stuff optimisé).
 */
export function memberOptions(comp: UserComposition, index: number, data: BuildDataSource, scenarioId: string, level?: number): BuildOption[] {
  const m = comp.members[index]
  const ref = referenceOption(comp, index, data, scenarioId, level)
  if (isFixed(m)) return [ref]
  const ctx: OptionContext = { data, name: memberNames(comp)[index], role: m.role, level }
  const out: BuildOption[] = [ref]
  // Les autres options gardent les variantes de LEUR preset : les `variants` (et le `build`) du membre appartiennent à son
  // build de référence (souvent écrites par `optimize --save-team` pour ce build-là) ; les imposer à un autre preset
  // (autre élément, autre rôle) le désavantagerait au criblage.
  const add = (text: string, origin: BuildOrigin) => {
    const o = optionFromText(text, m.breedId, ctx, origin, scenarioId)
    if (!out.some(x => x.id === o.id)) out.push(o)
  }
  if (m.candidates) for (const c of m.candidates) add(c, 'candidate')
  else {
    const sp = scenarioPresets(m.breedId, scenarioId)
    for (const p of [...sp.primary, ...sp.extra]) add(p.id, isScenarioPreset(p, scenarioId) ? 'scenario' : 'class')
  }
  return out
}

/** Équipe (membres) d'une composition : option de référence de chaque membre. */
export function resolveComposition(comp: UserComposition, data: BuildDataSource, scenarioId: string, level?: number): { team: MemberSpec[]; options: BuildOption[] } {
  const options = comp.members.map((_, i) => referenceOption(comp, i, data, scenarioId, level))
  return { team: options.map(o => o.member), options }
}

/** Preset complet (dérivé compris) d'un texte d'option (rapports). */
export function optionPreset(id: string): Preset | undefined {
  return findPreset(id.split(/[@+]/)[0])
}

// ───────────────────────────── écriture des builds retenus ─────────────────────────────

/** Variantes égales à celles du preset ? */
function sameVariants(a: readonly number[] | undefined, b: readonly number[]): boolean {
  const v = a ?? []
  return b.every((x, i) => (v[i] ?? 0) === x) && v.every((x, i) => (b[i] ?? 0) === x)
}

/**
 * Fichier d'équipe avec les builds retenus par `optimize` (`--save-team`) : la composition (classes, noms, rôles,
 * candidats, `fixed`, notes) est conservée ; chaque membre reçoit son build par défaut — `preset` (avec `@stuff`) si
 * l'option vient d'un preset, sinon `preset` (identité IA) + `build` complet (stuff optimisé) — et ses `variants` si
 * elles diffèrent du preset. `optimized` référence le rapport d'origine.
 */
export function teamFileWithBuilds(file: TeamFile, options: readonly BuildOption[], team: readonly MemberSpec[], meta: { report: string; date?: string; note?: string }): TeamFile {
  if (options.length !== file.members.length || team.length !== file.members.length) throw new Error('teamFileWithBuilds : nombre de membres différent du fichier')
  const members = file.members.map((m, i): TeamFileMember => {
    const o = options[i]
    const spec = team[i]
    const out: TeamFileMember = { ...m }
    delete out.build
    delete out.stuff
    delete out.variants
    const fromPreset = o.origin !== 'stuff-optimizer' && o.origin !== 'file-build'
    if (fromPreset) out.preset = o.id.split('+')[0]
    else {
      out.preset = o.preset.id
      out.build = {
        level: spec.build.level,
        items: spec.build.items.map(it => ({ ...it })),
        characteristicPoints: { ...spec.build.characteristicPoints },
        scrolls: { ...spec.build.scrolls },
      }
    }
    const variants = spec.variants.length ? spec.variants : (spec.build.spellVariants ?? [])
    if (!sameVariants(variants, o.preset.variants)) out.variants = variants.slice()
    return out
  })
  return { ...file, members, optimized: meta }
}
