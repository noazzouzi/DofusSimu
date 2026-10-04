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
