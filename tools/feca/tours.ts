// Bilan des tours du Féca d'une session, pour les essais A/B des réglages d'AnkaBot contre les tours fermés (2026-10-18 :
// tours du Féca fermés en quelques ms juste après la Malamibe en mode de combat rapide, aucun en mode Safe). Par combat :
// PV de départ, issue, tours du Féca joués juste après la Malamibe, tours fermés sans action (durée, et délai de lancement
// du script lu dans ses logs ia_feca_<perso>_*.log). Rappelle les réglages de combat actuels d'AnkaBot.
//
//   npx tsx tools/feca/tours.ts [--session data/fightlogs/<jour>/session-<heure>.jsonl] [--perso Kaskyzo]
//                               [--ankabot <dossier d'AnkaBotPC>]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { rebuild } from '../fightlog/rejeu'
import { data } from '../reine-des-voleurs/planificateur/etat'
import { chainsOf, readJsonLines, type Row } from '../reine-des-voleurs/planificateur/journal'

/** Durée de tour (fxjq, dixièmes de seconde) que le jeu accorde à la Malamibe : la repère dans l'ordre de jeu. */
const DUREE_MALAMIBE = 150

interface TourFeca {
  manche: number
  debut: number
  fin?: number
  agi: boolean
  apresMalamibe: boolean
  avant?: number
  /** Ce qu'a fait le combattant qui a joué juste avant : sorts lancés (identifiants), déplacement. */
  avantSorts?: number[]
  avantDeplace?: boolean
  lancement?: number
}

/**
 * Session la plus récente du personnage : dernier fichier session-*.jsonl dont les plans (plans-<même heure>.jsonl) le
 * nomment (le serveur de la Reine, lancé en même temps, écrit aussi ses sessions dans data/fightlogs).
 */
function derniereSession(root: string, perso: string): string {
  const days = readdirSync(root).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  for (const day of days.reverse()) {
    const files = readdirSync(join(root, day)).filter(f => /^session-.*\.jsonl$/.test(f))
      .map(f => join(root, day, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    for (const f of files) {
      const plans = f.replace(/session-([^\\/]+)\.jsonl$/, 'plans-$1.jsonl')
      if (existsSync(plans) && readFileSync(plans, 'utf8').includes(`"who":"${perso}"`)) return f
    }
  }
  throw new Error(`aucune session de ${perso} dans ${root}`)
}

/** Réglages de combat actuels d'AnkaBot pour ce personnage (save/SBConfig-<id>-<nom>.xml), s'il est trouvé. */
function reglagesAnkaBot(dir: string | undefined, perso: string): string | undefined {
  const dirs = dir ? [dir] : (() => {
    const base = join(homedir(), 'Documents', 'AnkaApp')
    if (!existsSync(base)) return []
    return readdirSync(base).map(d => join(base, d, 'AnkaBotPC'))
  })()
  for (const d of dirs) {
    const save = join(d, 'save')
    if (!existsSync(save)) continue
    const f = readdirSync(save).find(x => x.startsWith('SBConfig-') && x.endsWith(`-${perso}.xml`))
    if (!f) continue
    const xml = readFileSync(join(save, f), 'utf8')
    const v = (k: string) => xml.match(new RegExp(`<${k}>([^<]*)<`))?.[1] ?? '?'
    return `vitesse ${v('SpeedFightType')}, playTurnAfter ${v('playTurnAfterMin')}-${v('playTurnAfterMax')} ms, ` +
      `skipTurnAfter ${v('skipTurnAfterMin')}-${v('skipTurnAfterMax')} ms, IA ${v('Tactic')}`
  }
  return undefined
}

/** Lancements de fightManagement (horloge du script, ms) notés dans les logs du personnage modifiés pendant la session. */
function lancements(logsDir: string, perso: string, from: number, to: number): number[] {
  const out: number[] = []
  for (const f of readdirSync(logsDir).filter(x => x.startsWith(`ia_feca_${perso}_`) && x.endsWith('.log'))) {
    const m = statSync(join(logsDir, f)).mtimeMs
    if (m < from || m > to) continue
    for (const x of readFileSync(join(logsDir, f), 'utf8').matchAll(/^\[(\d+\.\d+)\] fightManagement lancé/gm)) out.push(Math.round(Number(x[1]) * 1000))
  }
  return out.sort((a, b) => a - b)
}

/** Scripts qui ont tourné pendant la session (ligne « [SCRIPT] … » au début du journal de chaque combat). */
function scriptsLances(logsDir: string, perso: string, from: number, to: number): string[] {
  const out = new Set<string>()
  for (const f of readdirSync(logsDir).filter(x => x.startsWith(`ia_feca_${perso}_`) && x.endsWith('.log'))) {
    const m = statSync(join(logsDir, f)).mtimeMs
    if (m < from || m > to) continue
    for (const x of readFileSync(join(logsDir, f), 'utf8').matchAll(/^\[SCRIPT\] (.*)$/gm)) out.add(x[1].trim())
  }
  return [...out]
}

export function bilanTours(session: string, perso: string, logsDir: string, ankabot?: string): string[] {
  const rows = readJsonLines(session)
  const chain = chainsOf(rows).find(x => x.c === perso)
  if (!chain) throw new Error(`${perso} absent de ${session}`)
  const start = (chain.rows.find(r => r.k === 'e' && r.ev === 'loggerStart') as Row & { character?: { id?: number } } | undefined)
  const myId = start?.character?.id
  if (!myId) throw new Error(`identifiant de ${perso} introuvable (événement loggerStart)`)
  const t0 = statSync(session).birthtimeMs || statSync(session).mtimeMs - 6 * 3600_000
  const launches = lancements(logsDir, perso, t0 - 60_000, statSync(session).mtimeMs + 600_000)
  const regl = reglagesAnkaBot(ankabot, perso)
  // (journal muet, essai D : ses compteurs « quiet » comptent les messages tus autour du tour du personnage)
  const tus = Math.max(0, ...chain.rows.filter(r => r.k === 'c').map(r => Number((r as Row & { quiet?: number }).quiet) || 0))
  const scripts = scriptsLances(logsDir, perso, t0 - 60_000, statSync(session).mtimeMs + 600_000)
  const out = [`${session} — ${perso}${regl ? ` (réglages actuels d'AnkaBot : ${regl})` : ''} ; journal ${tus ? `muet autour du tour (${tus} messages tus)` : 'normal'}` +
    ` ; script : ${scripts.length ? scripts.join(', ') : 'inconnu (généré avant le 2026-10-18 vers 16:45)'}`]
  const fights = chain.rows.map((r, i) => ({ r, i })).filter(x => x.r.k === 'e' && x.r.ev === 'fightStart')
  const total = { combats: 0, gagnes: 0, apres: 0, apresFermes: 0, autres: 0, autresFermes: 0 }
  const fermes: string[] = []
  fights.forEach(({ r: fs, i: from }, w) => {
    const to = fights[w + 1]?.i ?? chain.rows.length
    const msgs = chain.rows.slice(from, to).filter(r => r.k === 'm') as (Row & { n: string; ms: number; d: any })[]
    const tours: TourFeca[] = []
    let manche = 0, prevId: number | undefined, prevQ: number | undefined, cur: TourFeca | undefined, mort = false
    // (tour en cours de n'importe quel combattant : ses sorts et son déplacement, pour le tour du Féca qui suit)
    let enCours: { id: number; sorts: number[]; deplace: boolean } | undefined
    for (const m of msgs) {
      if (enCours && m.n === 'jsq' && m.d.fwuy && m.d.fwuw === enCours.id) enCours.sorts.push(m.d.fwuy.fwqu?.fwpu ?? 0)
      if (enCours && m.n === 'jnz' && m.d.fwaf === enCours.id) enCours.deplace = true
      if (m.n === 'jvi') manche = m.d.fxjj
      else if (m.n === 'jvj') {
        const avant = enCours
        enCours = { id: m.d.fxjr, sorts: [], deplace: false }
        if (m.d.fxjr === myId) {
          cur = { manche, debut: m.ms, agi: false, apresMalamibe: prevQ === DUREE_MALAMIBE && (prevId ?? 0) < 0, avant: prevId,
            avantSorts: avant?.sorts, avantDeplace: avant?.deplace }
          tours.push(cur)
        } else cur = undefined
        prevId = m.d.fxjr
        prevQ = m.d.fxjq
      } else if (m.n === 'jup') {
        if (cur && m.d.fxgo === myId) { cur.fin = m.ms; cur = undefined }
      } else if (cur && ((m.n === 'jsq' && m.d.fwuy && m.d.fwuw === myId) || (m.n === 'jnz' && m.d.fwaf === myId))) cur.agi = true
      if (m.n === 'jsq' && m.d.fwuv === 103 && m.d.fwuz?.fwrl === myId) mort = true
    }
    for (const t of tours) t.lancement = launches.find(x => x >= t.debut - 100 && x <= t.debut + 15_000)
    let pv = ''
    const noms = new Map<number, string>()
    try {
      const res: any = rebuild(chain.rows, { which: w, mapId: (fs as any).map })
      for (const x of res.fighters) if (x.gameId !== undefined) noms.set(x.gameId, x.name)
      const ini: any = res.replay.events.find((e: any) => e.fighters)
      const me: any = res.fighters.find((x: any) => x.name === perso)
      const f: any = ini?.fighters?.find((x: any) => x.id === me?.id) ?? me
      if (f?.maxHp) pv = `${perso} ${Math.round(f.hp)}/${f.maxHp} (${Math.round(100 * f.hp / f.maxHp)} %) ; `
    } catch { /* PV de départ inconnus */ }
    const apres = tours.filter(t => t.apresMalamibe)
    const ferme = (t: TourFeca) => !t.agi && t.fin !== undefined
    total.combats++
    if (!mort) total.gagnes++
    total.apres += apres.length
    total.apresFermes += apres.filter(ferme).length
    total.autres += tours.length - apres.length
    total.autresFermes += tours.filter(t => !t.apresMalamibe && ferme(t)).length
    const heure = String(fs.at ?? '').slice(11, 16)
    out.push(`combat ${w + 1} (${heure} UTC, carte ${(fs as any).map}) : ${pv}${manche} manches ; ${mort ? 'PERDU' : 'gagné'} ; ` +
      `${apres.length} tour(s) juste après la Malamibe, ${apres.filter(ferme).length} fermé(s)`)
    for (const t of tours.filter(ferme)) {
      const ouvert = t.fin! - t.debut
      const lance = t.lancement === undefined ? 'script non lancé (ou log absent)' : t.lancement > t.fin!
        ? `script lancé ${t.lancement - t.debut} ms après l'ouverture, tour déjà fermé`
        : `script lancé ${t.lancement - t.debut} ms après l'ouverture`
      const qui = t.avant === undefined ? 'inconnu' : noms.get(t.avant) ?? String(t.avant)
      const sorts = (t.avantSorts ?? []).map(id => data.spell(id)?.name ?? String(id))
      const fait = t.avantSorts === undefined ? ''
        : ` (${sorts.length ? sorts.join(', ') : 'aucun sort'} ; ${t.avantDeplace ? 'déplacé' : 'pas de déplacement'})`
      fermes.push(`  combat ${w + 1}, manche ${t.manche}, après ${qui}${fait} : ouvert ${ouvert} ms (heures de remise au script), ${lance}`)
    }
  })
  out.push(`Total : ${total.combats} combats, ${total.gagnes} gagnés ; tours du Féca juste après la Malamibe : ${total.apres}, ` +
    `fermés sans action : ${total.apresFermes} ; autres tours : ${total.autres}, fermés : ${total.autresFermes}`)
  if (fermes.length) out.push('Tours fermés sans action :', ...fermes)
  return out
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('feca/tours.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const root = join(process.cwd(), 'data', 'fightlogs')
  const perso = arg('--perso') ?? 'Kaskyzo'
  const session = arg('--session') ?? derniereSession(root, perso)
  for (const l of bilanTours(session, perso, join(process.cwd(), 'tools', 'ankabot'), arg('--ankabot'))) console.log(l)
}
