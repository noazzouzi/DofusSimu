/**
 * Masques de cibles des effets (targetMask DofusDB), ex. "a,A", "A", "C", "a,A,*E123".
 * Lettres minuscules = alliés du lanceur, majuscules = ennemis (convention DofusDB) :
 *  a/A tous · g/G joueurs (hors invocations) · i/I invocations · s/S invocations statiques ·
 *  m/M monstres · c/C lanceur · h/H héros (joueurs) · j/J/l/L compagnons (traités comme joueurs).
 * Les conditions préfixées par '*' filtrent par état : *E<id> la cible a l'état, *e<id> ne l'a pas,
 * *F<id>/*f<id> idem pour le lanceur.
 */
import type { Fighter } from './types'

export interface ParsedMask {
  letters: string[]
  conditions: { kind: 'E' | 'e' | 'F' | 'f'; stateId: number }[]
}

const cache = new Map<string, ParsedMask>()

export function parseTargetMask(mask: string): ParsedMask {
  let p = cache.get(mask)
  if (p) return p
  p = { letters: [], conditions: [] }
  for (const raw of mask.split(',')) {
    const tok = raw.trim()
    if (!tok) continue
    if (tok.startsWith('*')) {
      const kind = tok[1] as 'E' | 'e' | 'F' | 'f'
      const id = parseInt(tok.slice(2), 10)
      if ('EeFf'.includes(kind) && Number.isFinite(id)) p.conditions.push({ kind, stateId: id })
      continue
    }
    p.letters.push(tok[0])
  }
  cache.set(mask, p)
  return p
}

function letterMatches(letter: string, caster: Fighter, target: Fighter): boolean {
  const isCaster = caster.id === target.id
  const ally = target.team === caster.team
  const lower = letter === letter.toLowerCase()
  const l = letter.toLowerCase()
  if (l === 'c') return isCaster
  if (isCaster) return false
  if (lower !== ally) return false
  switch (l) {
    case 'a':
      return true
    case 'g':
    case 'h':
    case 'j':
    case 'l':
      return target.kind === 'player'
    case 'i':
      return target.kind === 'summon' && !target.tags.static
    case 's':
      return target.kind === 'summon' && !!target.tags.static
    case 'm':
      return target.kind === 'monster'
    default:
      return false
  }
}

export function matchesTargetMask(mask: string, caster: Fighter, target: Fighter): boolean {
  if (!mask) return target.team !== caster.team || target.id !== caster.id
  const p = parseTargetMask(mask)
  for (const c of p.conditions) {
    const who = c.kind === 'E' || c.kind === 'e' ? target : caster
    const has = who.states.includes(c.stateId)
    if ((c.kind === 'E' || c.kind === 'F') && !has) return false
    if ((c.kind === 'e' || c.kind === 'f') && has) return false
  }
  if (!p.letters.length) return true
  return p.letters.some(l => letterMatches(l, caster, target))
}
