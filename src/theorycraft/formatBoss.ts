/**
 * Theorycraft contre un boss — rendu TEXTE français de la fiche d'un boss pour la CLI (docs/design/theorycraft.md
 * §1.9) : identité, PV/PA/PM, esquives, résistances brutes et effectives, éléments faibles, profil offensif par phase
 * (pic, soutenu, parts élémentaires), mécaniques (avec ce qui y répond et ce qu'elles punissent), avertissements,
 * hypothèses. Tableaux alignés en largeur fixe, sans émoji ; nombres au format français (espace des milliers,
 * virgule décimale), écrits ici pour un rendu identique quel que soit l'environnement.
 *
 * Fournit aussi les briques de mise en forme partagées avec formatClasses.ts (`textTable`, `fmtNum`, `fmtPct`).
 *
 * Module PUR (types seulement, aucune donnée du jeu) : utilisable côté navigateur.
 */
import type { BossProfile, MechanicKind, UtilityTag } from './types'

// ---------------------------------------------------------------------------------------------------------------------
// Briques de mise en forme
// ---------------------------------------------------------------------------------------------------------------------

/** Noms des éléments [Neutre, Terre, Feu, Eau, Air] (ordre `PerElement`). */
export const ELEMENT_LABELS: readonly string[] = ['Neutre', 'Terre', 'Feu', 'Eau', 'Air']

/** Nombre au format français : espace des milliers, virgule décimale (`digits` décimales). */
export function fmtNum(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '—'
  const neg = v < 0
  const fixed = Math.abs(v).toFixed(digits)
  const [int, dec] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const out = dec ? `${grouped},${dec}` : grouped
  return neg && Number(fixed) !== 0 ? `−${out}` : out
}

/** Pourcentage (points) : « 25 % ». */
export function fmtPct(v: number, digits = 0): string {
  return `${fmtNum(v, digits)} %`
}

/** Largeur affichée d'un texte (points de code). */
function width(s: string): number {
  return [...s].length
}

function pad(s: string, w: number, right: boolean): string {
  const fill = ' '.repeat(Math.max(0, w - width(s)))
  return right ? fill + s : s + fill
}

/**
 * Tableau texte en largeur fixe : en-têtes, lignes, alignement par colonne (`r` à droite, `l` à gauche, défaut `l`).
 * Indentation `indent` ; deux espaces entre colonnes ; ligne de tirets sous les en-têtes.
 */
export function textTable(headers: readonly string[], rows: readonly (readonly string[])[], align = '', indent = '  '): string {
  const widths = headers.map((h, i) => Math.max(width(h), ...rows.map(r => width(r[i] ?? ''))))
  const line = (cells: readonly string[]) =>
    indent +
    cells
      .map((c, i) => pad(c ?? '', widths[i], align[i] === 'r'))
      .join('  ')
      .replace(/\s+$/, '')
  return [line(headers), indent + widths.map(w => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n')
}

/** Titre de section. */
export function section(title: string): string {
  return `${title}\n${'='.repeat(width(title))}`
}

/** Liste à puces (texte replié tel quel). */
export function bullets(items: readonly string[], indent = '  '): string {
  return items.length ? items.map(x => `${indent}- ${x}`).join('\n') : `${indent}(aucun)`
}

// ---------------------------------------------------------------------------------------------------------------------
// Fiche du boss
// ---------------------------------------------------------------------------------------------------------------------

/** Libellés français des mécaniques. */
export const MECHANIC_LABELS: Readonly<Record<MechanicKind, string>> = {
  invulnerable: 'invulnérable',
  'invulnerable-melee': 'invulnérable en mêlée',
  'invulnerable-range': 'invulnérable à distance',
  'reduced-range': 'réduction à distance',
  'reduced-melee': 'réduction en mêlée',
  'damage-taken': 'dommages subis',
  'final-damage': 'dommages finaux',
  'res-change': 'résistances changeantes',
  'extreme-res': 'résistances extrêmes',
  reflect: 'renvoi',
  erosion: 'érosion',
  'hp-based-damage': 'dégâts en % de PV',
  'ap-mp-removal': 'retrait PA/PM',
  'range-removal': 'retrait de PO',
  'punished-removal': 'retrait puni',
  pacifist: 'Pacifiste',
  incurable: 'insoignable',
  'cant-be-moved': 'indéplaçable',
  'push-resource': 'poussée utile',
  summons: 'invocations',
  'boss-heal': 'soin du boss',
  'boss-shield': 'bouclier du boss',
  marks: 'glyphes / pièges',
  phases: 'phases',
  'mp-cost': 'coût par PM',
  other: 'autre',
}

/** Libellés courts des utilités (contre / punit). */
const TAG_SHORT: Readonly<Record<UtilityTag, string>> = {
  melee: 'mêlée',
  range: 'distance',
  zone: 'zone',
  burst: 'rafale',
  'indirect-damage': 'dégâts indirects',
  'mp-removal': 'retrait PM',
  'ap-removal': 'retrait PA',
  'range-removal': 'retrait PO',
  heal: 'soin',
  shield: 'boucliers',
  'damage-reduction': 'réductions',
  placement: 'placement',
  'push-damage': 'poussée',
  summons: 'invocations',
  debuff: 'débuff',
  erosion: 'érosion',
  'ally-ap-mp': '+PA/PM alliés',
  'ally-damage': 'buffs alliés',
  'damage-taken-debuff': 'dommages subis',
  dodge: 'esquive',
  'multi-element': 'multi-élément',
}

export interface FormatBossOptions {
  /** Afficher la liste des sorts du boss qui frappent (défaut faux). */
  spells?: boolean
}

/** Fiche texte d'un boss (voir l'en-tête). */
export function formatBoss(profile: BossProfile, opts: FormatBossOptions = {}): string {
  const out: string[] = []
  const who = profile.players !== undefined ? `${profile.players} joueur(s)` : 'grade imposé'
  out.push(section(`${profile.name} (${profile.monsterId}) — grade ${profile.grade}, ${who}`))
  out.push(
    `  Niveau ${profile.level} · PV ${fmtNum(profile.hp)} · PA ${profile.ap} · PM ${profile.mp} · Esquive PA ${fmtNum(profile.apParry)} · Esquive PM ${fmtNum(profile.mpParry)} · Tacle ${fmtNum(profile.tackle)}`,
  )
  if (profile.overrides) out.push(`  Fiche manuelle appliquée${profile.overrides.updatedAt ? ` (${profile.overrides.updatedAt})` : ''}.`)

  out.push('', 'Résistances')
  out.push(
    textTable(
      ['Élément', 'Brute', 'Effective'],
      ELEMENT_LABELS.map((el, i) => [el, fmtPct(profile.rawResPct[i]), fmtPct(profile.resPct[i])]),
      'lrr',
    ),
  )
  const st = profile.stats
  const extra = [
    st.rangedResPct ? `distance ${fmtPct(st.rangedResPct)}` : '',
    st.meleeResPct ? `mêlée ${fmtPct(st.meleeResPct)}` : '',
    st.spellResPct ? `sorts ${fmtPct(st.spellResPct)}` : '',
    st.finalDamagePct ? `dommages finaux ${st.finalDamagePct > 0 ? '+' : ''}${fmtPct(st.finalDamagePct)}` : '',
  ].filter(Boolean)
  if (extra.length) out.push(`  Autres résistances / bonus effectifs : ${extra.join(', ')}.`)
  out.push(`  Éléments du plus faible au plus fort : ${profile.weakestElements.map(i => `${ELEMENT_LABELS[i]} (${fmtPct(profile.resPct[i])})`).join(', ')}.`)

  out.push('', 'Profil offensif par phase')
  out.push(
    textTable(
      ['Phase', 'Poids', 'Attaquable', 'Pic/tour', 'Soutenu/tour', ...ELEMENT_LABELS],
      profile.phases.map(p => [
        p.name,
        fmtPct(p.weight * 100),
        p.vulnerable === true ? 'oui' : p.vulnerable === 'melee' ? 'mêlée seule' : p.vulnerable === 'range' ? 'distance seule' : 'non',
        fmtNum(p.peakPerTurn),
        fmtNum(p.sustainedPerTurn),
        ...p.elementShares.map(v => (v > 0 ? fmtPct(v * 100) : '—')),
      ]),
      'lrlrrrrrrr',
    ),
  )
  const shares = profile.incomingShares.map((v, i) => (v > 0 ? `${ELEMENT_LABELS[i]} ${fmtPct(v * 100)}` : '')).filter(Boolean)
  out.push(`  Répartition des dégâts reçus (phases pondérées) : ${shares.length ? shares.join(', ') : 'aucun dégât calculable'}.`)

  if (opts.spells) {
    const hitting = profile.spells.filter(s => s.damageByElement.some(v => v > 0) || s.otherDamage > 0)
    out.push('', 'Sorts qui frappent')
    out.push(
      textTable(
        ['Sort', 'PA', 'Lancers/tour', 'Relance', ...ELEMENT_LABELS, 'Autre', 'Drapeaux'],
        hitting.map(s => [
          s.name,
          String(s.apCost),
          s.castsPerTurn ? String(s.castsPerTurn) : '∞',
          String(s.cooldown),
          ...s.damageByElement.map(v => (v > 0 ? fmtNum(v) : '—')),
          s.otherDamage > 0 ? fmtNum(s.otherDamage) : '—',
          s.flags.join(', '),
        ]),
        'lrrrrrrrrrl',
      ),
    )
  }

  out.push('', 'Mécaniques')
  out.push(
    bullets(
      profile.mechanics.map(m => {
        const parts = [`[${MECHANIC_LABELS[m.kind] ?? m.kind}] ${m.summary}`]
        if (m.counters?.length) parts.push(`contre : ${m.counters.map(t => TAG_SHORT[t] ?? t).join(', ')}`)
        if (m.punishes?.length) parts.push(`punit : ${m.punishes.map(t => TAG_SHORT[t] ?? t).join(', ')}`)
        if (m.source === 'overrides') parts.push('fiche manuelle')
        return parts.join(' — ')
      }),
    ),
  )
  out.push('', 'Avertissements', bullets(profile.warnings))
  out.push('', 'Hypothèses', bullets(profile.assumptions))
  return out.join('\n')
}
