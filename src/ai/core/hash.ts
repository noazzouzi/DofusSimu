/**
 * Transpositions et empreintes (docs/design/ai.md §6.8) — WP1.
 *
 *  - `stateHash` : FNV-1a 2 × 32 bits d'un état de recherche ; deux ordres de lancers indépendants donnent le même
 *    hash (buffs sans uid ni ordre, marques sans uid ni ordre). N'utilise JAMAIS `Fighter.rev` (valeur opaque).
 *  - `fighterDigest` : empreinte d'un combattant (repli de E4).
 *  - `revKey` : clé de cache d'un combattant (`rev` si E4 l'a posé, sinon empreinte) — caches DPT/menace uniquement.
 */
import type { Fighter, FightState } from '../../engine/types'

/** FNV-1a d'un entier 32 bits (4 octets, petit-boutiste). */
export function fnvInt(h: number, x: number): number {
  x |= 0
  h = Math.imul(h ^ (x & 0xff), 0x01000193)
  h = Math.imul(h ^ ((x >>> 8) & 0xff), 0x01000193)
  h = Math.imul(h ^ ((x >>> 16) & 0xff), 0x01000193)
  return Math.imul(h ^ (x >>> 24), 0x01000193)
}

/** Empreinte commutative d'un enregistrement `Record<string, number>` (relances, lancers du tour). */
function recordDigest(seed: number, r: Readonly<Record<string, number>>): number {
  let sum = 0
  for (const k in r) {
    const v = r[k]
    if (v) sum = (sum + fnvInt(fnvInt(seed, Number(k)), v)) | 0
  }
  return sum
}

/**
 * Empreinte des buffs, INDÉPENDANTE de leur ordre et de leurs uid (somme commutative) : deux ordres de lancers
 * indépendants produisent les mêmes buffs avec des uid différents.
 */
function buffsDigest(f: Fighter, seed: number): number {
  let sum = 0
  const bs = f.buffs
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i]
    let h = fnvInt(seed, b.sourceId)
    h = fnvInt(h, b.spellId)
    h = fnvInt(h, b.effect.effectId)
    h = fnvInt(h, Math.round(b.value * 100))
    h = fnvInt(h, b.remaining)
    h = fnvInt(h, b.delay)
    sum = (sum + h) | 0
  }
  return sum
}

/**
 * Empreinte d'un combattant (repli de E4 quand `rev` n'est pas disponible) : case, vie max, caractéristiques,
 * buffs/états. Égalité ⇒ (sauf collision) mêmes caractéristiques, buffs et case.
 */
export function fighterDigest(f: Fighter): number {
  let h = fnvInt(0x811c9dc5, f.id)
  h = fnvInt(h, f.alive ? f.cell : -2)
  h = fnvInt(h, f.maxHp)
  h = fnvInt(h, buffsDigest(f, 0x9747b28c))
  for (const st of f.states) h = fnvInt(h, st)
  const stats = f.stats as unknown as Record<string, number>
  for (const k in stats) h = fnvInt(h, Math.round(stats[k] * 100))
  return h >>> 0
}

/**
 * Clé de cache d'un combattant : `rev` (E4, unique dans le processus : mêmes caractéristiques, buffs/états et case)
 * ou, à défaut, l'empreinte (négative pour ne jamais coïncider avec une révision). Ne couvre NI les PV, NI les PA/PM
 * courants, NI les relances : les caches qui en dépendent les ajoutent à leur clé.
 */
export function revKey(f: Fighter): number {
  return f.rev !== undefined ? f.rev : -1 - fighterDigest(f)
}

/**
 * Hash d'un état pour les transpositions de la recherche (§6.8) : FNV-1a 2 × 32 bits sur chaque combattant vivant
 * (case, PV par paliers de 10, bouclier, PA et PM × 100, buffs sans uid ni ordre, relances, lancers du tour) + marques
 * (sans uid ni ordre) + tour et créneau. Deux ordres de lancers indépendants donnent le même hash.
 * Les morts entrent aussi (id + buffs conservés) : au Vortex, l'heure de mort (états 221-232 lus sur le mort) distingue
 * « glyphe puis kill » de « kill puis glyphe », qu'une fusion de transpositions ne doit pas confondre.
 */
export function stateHash(s: FightState): bigint {
  let a = fnvInt(fnvInt(0x811c9dc5, s.round), s.turnIndex)
  let b = fnvInt(fnvInt(0x050c5d1f, s.round), s.turnIndex)
  const fs = s.fighters
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]
    if (!f.alive) {
      a = fnvInt(fnvInt(a, ~f.id), buffsDigest(f, 0x811c9dc5))
      b = fnvInt(fnvInt(b, ~f.id), buffsDigest(f, 0x050c5d1f))
      continue
    }
    const hp10 = Math.floor(f.hp / 10)
    const ap = Math.round(f.ap * 100)
    const mp = Math.round(f.mp * 100)
    a = fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(a, f.id), f.cell), hp10), f.shield), ap), mp)
    b = fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(fnvInt(b, f.id), f.cell), hp10), f.shield), ap), mp)
    a = fnvInt(a, buffsDigest(f, 0x811c9dc5))
    b = fnvInt(b, buffsDigest(f, 0x050c5d1f))
    a = fnvInt(fnvInt(a, recordDigest(0x811c9dc5, f.cooldowns)), recordDigest(0x01000193, f.castsThisTurn))
    b = fnvInt(fnvInt(b, recordDigest(0x050c5d1f, f.cooldowns)), recordDigest(0x2545f491, f.castsThisTurn))
  }
  let marksA = 0
  let marksB = 0
  for (const m of s.glyphs) {
    marksA = (marksA + fnvInt(fnvInt(fnvInt(fnvInt(0x811c9dc5, m.sourceId), m.spellId), m.center), m.remaining)) | 0
    marksB = (marksB + fnvInt(fnvInt(fnvInt(fnvInt(0x050c5d1f, m.sourceId), m.spellId), m.center), m.remaining)) | 0
  }
  for (const m of s.traps) {
    marksA = (marksA + fnvInt(fnvInt(fnvInt(fnvInt(0x811c9dc5, m.sourceId), m.spellId), m.center), -1)) | 0
    marksB = (marksB + fnvInt(fnvInt(fnvInt(fnvInt(0x050c5d1f, m.sourceId), m.spellId), m.center), -1)) | 0
  }
  a = fnvInt(a, marksA)
  b = fnvInt(b, marksB)
  return (BigInt(a >>> 0) << 32n) | BigInt(b >>> 0)
}

/** Résultat partagé de `geometryKey` (clé 64 bits = deux hash 32 bits). */
export const GEO_KEY = { h1: 0, h2: 0 }

/**
 * Clé de GÉOMÉTRIE d'un état vu par `team` (dans `GEO_KEY`) : tout ce dont dépendent l'accessibilité, les cases de
 * lancer, la ligne de vue et l'ordre des prochains tours, mais PAS les PV ni les PA/PM courants — tour/créneau,
 * longueur de la timeline, et pour chaque combattant : vivant, case crue par `team`, porté, révision (E4 :
 * caractéristiques, buffs, états, case), relances > 1 (sorts indisponibles au prochain tour) ; plus les marques.
 * Deux enfants d'un nœud qui ne diffèrent que par des PV partagent la même géométrie (caches de menace et de
 * potentiel, §6.5-§6.6). `believed(f)` = case crue par l'équipe (vue honnête).
 */
export function geometryKey(s: FightState, believed: (f: Fighter) => number): typeof GEO_KEY {
  let a = fnvInt(fnvInt(fnvInt(0x811c9dc5, s.round), s.turnIndex), s.timeline.length)
  let b = fnvInt(fnvInt(fnvInt(0x050c5d1f, s.round), s.turnIndex), s.timeline.length)
  const fs = s.fighters
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]
    if (!f.alive) {
      a = fnvInt(a, ~f.id)
      b = fnvInt(b, ~f.id)
      continue
    }
    const cell = f.carriedBy !== undefined ? -3 - f.carriedBy : believed(f)
    const rk = revKey(f)
    let cd = 0
    for (const k in f.cooldowns) {
      const v = f.cooldowns[k]
      if (v > 1) cd = (cd + fnvInt(fnvInt(0x9747b28c, Number(k)), v)) | 0
    }
    a = fnvInt(fnvInt(fnvInt(fnvInt(a, f.id), cell), rk), cd)
    b = fnvInt(fnvInt(fnvInt(fnvInt(b, f.id), cell), rk), cd)
  }
  for (const m of s.glyphs) {
    a = fnvInt(fnvInt(a, m.uid), m.center)
    b = fnvInt(fnvInt(b, m.uid), m.center)
  }
  for (const m of s.traps) {
    a = fnvInt(fnvInt(a, m.uid), m.center)
    b = fnvInt(fnvInt(b, m.uid), m.center)
  }
  GEO_KEY.h1 = a
  GEO_KEY.h2 = b
  return GEO_KEY
}

// ───────────────────────────── empreintes par usage (clés de cache) ─────────────────────────────

/** FNV-1a d'une chaîne (clés de modificateurs de sort). */
function fnvStr(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h
}

/** Effets de buff lus par le calcul des dégâts côté cible (dommages subis 1163, armure 265/105). */
const RECEIVED_EFFECTS = new Set([1163, 265, 105])

/** Caractéristiques sans effet sur les dégâts d'un sort (exclues de `damageDigest` : un retrait de PM ne vide pas le DPT). */
const NON_DAMAGE_STATS = new Set(['vitality', 'wisdom', 'ap', 'mp', 'range', 'summons', 'initiative', 'prospecting', 'heals',
  'apReduction', 'mpReduction', 'apParry', 'mpParry', 'tackleBlock', 'tackleEvade', 'lifePoints', 'finalHealPct'])

function statsInto(h: number, f: Fighter): number {
  const st = f.stats as unknown as Record<string, number>
  for (const k in st) {
    if (NON_DAMAGE_STATS.has(k)) continue
    h = fnvStr(h, k)
    h = fnvInt(h, Math.round(st[k] * 16))
  }
  return h
}

function modsInto(h: number, f: Fighter): number {
  const mods = f.spellMods
  if (!mods) return h
  for (const sid in mods) {
    const m = mods[sid] as Record<string, number>
    h = fnvInt(h, Number(sid))
    for (const k in m) h = fnvInt(fnvStr(h, k), Math.round(m[k] * 16))
  }
  return h
}

/** Empreinte de la liste des sorts (ids, grades, armes), mémoïsée par tableau `f.spells`. */
const SPELLS_MEMO = new WeakMap<Fighter['spells'], number>()
function spellsDigest(f: Fighter): number {
  let d = SPELLS_MEMO.get(f.spells)
  if (d === undefined) {
    d = 0x2545f491
    for (const ks of f.spells) d = fnvInt(fnvInt(fnvInt(d, ks.spellId), ks.level.grade), ks.isWeapon ? 1 : 0)
    SPELLS_MEMO.set(f.spells, d)
  }
  return d
}

function computeDamageDigest(f: Fighter): number {
  let h = fnvInt(fnvInt(fnvInt(0x811c9dc5, f.id), f.level), f.team)
  // Sorts connus : deux combattants de même id et mêmes caractéristiques (combats différents d'un même moteur, classes
  // différentes) ne doivent pas partager les caches DPT indexés par sort.
  h = fnvInt(fnvInt(fnvInt(h, spellsDigest(f)), f.breedId ?? -1), f.monsterId ?? -1)
  h = fnvStr(h, f.kind)
  h = statsInto(h, f)
  for (const s of f.states) h = fnvInt(h, s)
  if (f.disabledStates) for (const s of f.disabledStates) h = fnvInt(h, ~s)
  h = modsInto(h, f)
  for (const b of f.buffs) {
    if (!RECEIVED_EFFECTS.has(b.effect.effectId)) continue
    h = fnvInt(fnvInt(fnvInt(fnvInt(h, b.effect.effectId), Math.round(b.value * 16)), b.delay), b.triggerCount ?? 0)
    h = fnvInt(fnvInt(h, b.effect.diceNum), b.effect.value)
    h = fnvStr(h, b.triggers ?? '')
    h = fnvStr(h, b.kind ?? '')
  }
  return h >>> 0
}

const DMG_MEMO = new Map<number, number>()
const MOB_MEMO = new Map<number, number>()
const MEMO_MAX = 200000

/**
 * Empreinte « dégâts » d'un combattant (clés du DPT) : niveau, camp, nature, classe/monstre, sorts connus,
 * caractéristiques, états, modificateurs de sort et buffs lus côté cible (1163, 265, 105). Mémoïsée par révision (E4) : un buff de PM ou un déplacement change
 * la révision mais pas cette empreinte, et le DPT reste en cache. Les PV n'y entrent pas (sorts « % PV » non cachés).
 */
export function damageDigest(f: Fighter): number {
  if (f.rev === undefined) return computeDamageDigest(f)
  let d = DMG_MEMO.get(f.rev)
  if (d === undefined) {
    if (DMG_MEMO.size >= MEMO_MAX) DMG_MEMO.clear()
    DMG_MEMO.set(f.rev, (d = computeDamageDigest(f)))
  }
  return d
}

function computeMobilityDigest(f: Fighter): number {
  let h = fnvInt(fnvInt(0x9747b28c, f.id), f.team)
  const st = f.stats
  h = fnvInt(fnvInt(fnvInt(h, Math.round(st.ap * 16)), Math.round(st.mp * 16)), st.range)
  h = fnvInt(fnvInt(h, st.tackleBlock), st.tackleEvade)
  for (const s of f.states) h = fnvInt(h, s)
  if (f.disabledStates) for (const s of f.disabledStates) h = fnvInt(h, ~s)
  h = modsInto(h, f)
  return h >>> 0
}

/**
 * Empreinte « mobilité / lancers » d'un combattant (clés des géométries de menace et de potentiel) : PA/PM/PO de
 * base, tacle/fuite, états, modificateurs de sort (mémoïsés par révision), plus la partie VIVANTE des buffs qui
 * décident du prochain tour (PA/PM temporaires, états, tour annulé : durée, lanceur, délai — décrémentés en place sans
 * nouvelle révision), les relances > 1 et les marqueurs de mobilité. Ni la case ni les PV n'y entrent.
 */
export function mobilityDigest(f: Fighter): number {
  let d: number | undefined
  if (f.rev === undefined) d = computeMobilityDigest(f)
  else {
    d = MOB_MEMO.get(f.rev)
    if (d === undefined) {
      if (MOB_MEMO.size >= MEMO_MAX) MOB_MEMO.clear()
      MOB_MEMO.set(f.rev, (d = computeMobilityDigest(f)))
    }
  }
  let h = d
  for (const b of f.buffs) {
    const sd = b.statDelta
    const apmp = sd !== undefined && (sd.ap !== undefined || sd.mp !== undefined)
    if (!apmp && b.stateId === undefined && !b.passTurn) continue
    h = fnvInt(fnvInt(fnvInt(fnvInt(h, b.sourceId), b.remaining), b.delay), b.stateId ?? -1)
    if (apmp) h = fnvInt(fnvInt(h, Math.round((sd!.ap ?? 0) * 16)), Math.round((sd!.mp ?? 0) * 16))
    if (b.passTurn) h = fnvInt(h, 0x7a55)
  }
  for (const k in f.cooldowns) {
    const v = f.cooldowns[k]
    if (v > 1) h = fnvInt(fnvInt(h, Number(k)), v)
  }
  const t = f.tags
  h = fnvInt(h, (t.rooted ? 1 : 0) | (t.cantTackle ? 2 : 0) | (t.static === true ? 4 : 0) | (t.canPlay === false ? 8 : 0)
    | (t.cannotPlay === true ? 16 : 0) | (typeof t.skipTurns === 'number' && t.skipTurns > 0 ? 32 : 0))
  return h >>> 0
}

/** Résultat partagé de `positionKey` (clé 64 bits). */
export const POS_KEY = { h1: 0, h2: 0 }

/**
 * Clé de POSITION d'un état vu par une équipe (dans `POS_KEY`) : tour, créneau et timeline (ordre des prochains
 * tours), et pour chaque combattant vivant : case crue, porté/porteur, tacle/fuite et drapeaux de tacle (`tackleFlags`),
 * plus les marques. Tout ce qui fait varier l'accessibilité et la ligne de vue des AUTRES ; la mobilité propre du
 * combattant qui marche ou lance s'ajoute par `mobilityDigest`.
 */
export function positionKey(s: FightState, believed: (f: Fighter) => number, tackleFlags: (f: Fighter) => number): typeof POS_KEY {
  let a = fnvInt(fnvInt(0x811c9dc5, s.round), s.turnIndex)
  let b = fnvInt(fnvInt(0x050c5d1f, s.round), s.turnIndex)
  for (const id of s.timeline) {
    a = fnvInt(a, id)
    b = fnvInt(b, id)
  }
  const fs = s.fighters
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]
    if (!f.alive) {
      a = fnvInt(a, ~f.id)
      b = fnvInt(b, ~f.id)
      continue
    }
    const cell = f.carriedBy !== undefined ? -3 - f.carriedBy : believed(f)
    const tk = (f.stats.tackleBlock * 4096 + f.stats.tackleEvade) * 4 + tackleFlags(f)
    a = fnvInt(fnvInt(fnvInt(a, f.id), cell), tk)
    b = fnvInt(fnvInt(fnvInt(b, f.id), cell), tk)
  }
  for (const m of s.glyphs) {
    a = fnvInt(fnvInt(a, m.uid), m.center)
    b = fnvInt(fnvInt(b, m.uid), m.center)
  }
  for (const m of s.traps) {
    a = fnvInt(fnvInt(a, m.uid), m.visible ? m.center : -m.center - 1)
    b = fnvInt(fnvInt(b, m.uid), m.visible ? m.center : -m.center - 1)
  }
  POS_KEY.h1 = a
  POS_KEY.h2 = b
  return POS_KEY
}

/**
 * Empreinte d'un état pour les `sync` incrémentaux (menace, potentiel) : tour, créneau, et pour chaque combattant
 * vivant : case, PV, bouclier, PV max, PA/PM courants (× 100), révision. Égalité ⇒ (sauf collision) rien à recalculer.
 */
export function stateSig(s: FightState): number {
  let h = fnvInt(fnvInt(fnvInt(0x811c9dc5, s.round), s.turnIndex), s.timeline.length)
  const fs = s.fighters
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]
    if (!f.alive) {
      h = fnvInt(h, ~f.id)
      continue
    }
    h = fnvInt(fnvInt(fnvInt(fnvInt(h, f.cell), f.hp), f.shield), f.maxHp)
    h = fnvInt(fnvInt(fnvInt(h, Math.round(f.ap * 100)), Math.round(f.mp * 100)), revKey(f))
  }
  return h
}
