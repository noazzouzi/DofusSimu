/**
 * Édition d'une équipe dans la section « Stuffs » : état du brouillon (classes, presets, objets, forgemagie, points,
 * variantes de sorts), appels à l'API du serveur de développement (web/plugins/stuffs.ts) et import RoxxSolver.
 * Le rendu est fait par web/src/stuffs.ts ; ce module ne touche pas au DOM.
 */
import type { CatalogItem, EditorMeta, PreviewMember, TeamPreview } from '@/optimizer/team/editor'
import type { RoxxImport } from '@/optimizer/team/roxx'
import type { PrimaryStat } from '@/stats/characteristicPoints'
import type { DraftMember, SheetBuild, StuffSheet, TeamStuffs } from '@/stats/sheet'
import type { EquipmentSlot } from '@/data/model'

const API = 'api/stuffs/'

async function call<T>(route: string, body?: unknown): Promise<T> {
  const res = await fetch(API + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new Error(`Serveur indisponible (${res.status}) : l'édition demande « npm run dev ».`)
  }
  const err = (json as { error?: string }).error
  if (!res.ok || err) throw new Error(err ?? `Erreur ${res.status}`)
  return json as T
}

export interface EditorData {
  meta: EditorMeta
  items: CatalogItem[]
  byId: Map<number, CatalogItem>
}

export async function loadEditorData(scenario: string): Promise<EditorData> {
  const r = await call<{ meta: EditorMeta; items: CatalogItem[] }>(`editor?scenario=${encodeURIComponent(scenario)}`)
  return { ...r, byId: new Map(r.items.map(it => [it.id, it])) }
}

/** Emplacements d'un stuff, dans l'ordre d'affichage (16). */
export const SLOT_LAYOUT: readonly EquipmentSlot[] = [
  'amulet', 'hat', 'cloak', 'belt', 'boots', 'ring', 'ring', 'weapon', 'shield', 'pet', 'dofus', 'dofus', 'dofus', 'dofus', 'dofus', 'dofus',
]

/** Position d'affichage → index dans `build.items` (−1 : vide) ; objets en surnombre ajoutés à la fin. */
export function slotLayout(build: SheetBuild, byId: ReadonlyMap<number, CatalogItem>): { slot: EquipmentSlot; index: number }[] {
  const out = SLOT_LAYOUT.map(slot => ({ slot, index: -1 }))
  build.items.forEach((it, i) => {
    const slot = byId.get(it.itemId)?.slot ?? 'other'
    const free = out.find(p => p.slot === slot && p.index < 0)
    if (free) free.index = i
    else out.push({ slot, index: i })
  })
  return out
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Brouillon d'équipe en cours d'édition ; `onChange` est appelé à chaque changement d'état (rendu). */
export class TeamEditor {
  drafts: DraftMember[]
  /** Aperçu de chaque membre (undefined : en cours de calcul). */
  members: (PreviewMember | undefined)[] = []
  dirty = false
  busy = false
  error?: string
  /** Remarques à afficher (import RoxxSolver…), par index de membre. */
  notices = new Map<number, string[]>()
  private seq = 0

  constructor(
    readonly team: TeamStuffs,
    readonly data: EditorData,
    private readonly onChange: () => void,
  ) {
    this.drafts = clone(team.drafts)
  }

  get scenario(): string {
    return this.team.scenario
  }

  /** Fiches à afficher (undefined : en cours de calcul) ; avant le premier aperçu, celles de l'équipe enregistrée. */
  sheets(): (StuffSheet | undefined)[] {
    return this.drafts.map((_, i) => this.members[i]?.sheet ?? (!this.members.length && !this.dirty ? this.team.members[i] : undefined))
  }

  /** Build effectif d'un membre (le sien, sinon celui de l'aperçu). */
  build(i: number): SheetBuild | undefined {
    return this.drafts[i]?.build ?? this.members[i]?.build
  }

  async refresh(): Promise<void> {
    const id = ++this.seq
    this.busy = true
    this.onChange()
    let r: TeamPreview
    try {
      r = await call<TeamPreview>('preview', { scenario: this.scenario, drafts: this.drafts })
    } catch (e) {
      r = { members: [], error: (e as Error).message }
    }
    if (id !== this.seq) return
    this.busy = false
    if (r.error) this.error = r.error
    else {
      this.error = undefined
      this.members = r.members
      r.members.forEach((m, i) => {
        const d = this.drafts[i]
        if (d && !d.preset) d.preset = m.preset
      })
    }
    this.onChange()
  }

  private change(fn: () => void): void {
    try {
      fn()
    } catch (e) {
      this.error = (e as Error).message
      this.onChange()
      return
    }
    this.dirty = true
    void this.refresh()
  }

  /** Build personnalisé du membre (créé depuis le build effectif à la première modification). */
  private own(i: number): SheetBuild {
    const d = this.drafts[i]
    if (!d.build) {
      const b = this.members[i]?.build
      if (!b) throw new Error('Aperçu pas encore calculé')
      d.build = clone(b)
      d.stuff = undefined
    }
    return d.build
  }

  // ───────────────────────────── composition ─────────────────────────────

  addMember(breedId: number): void {
    this.change(() => this.drafts.push({ breedId }))
  }

  removeMember(i: number): void {
    if (this.drafts.length <= 1) return
    this.change(() => {
      this.drafts.splice(i, 1)
      this.members.splice(i, 1)
      this.notices = new Map([...this.notices].filter(([k]) => k !== i).map(([k, v]) => [k > i ? k - 1 : k, v]))
    })
  }

  setName(i: number, name: string): void {
    this.change(() => (this.drafts[i].name = name.trim() || undefined))
  }

  /** Nouvelle classe : preset par défaut de la classe pour le scénario, son stuff. */
  setClass(i: number, breedId: number): void {
    const d = this.drafts[i]
    if (d.breedId === breedId) return
    this.change(() => {
      this.drafts[i] = { breedId, name: d.name, fixed: d.fixed }
      this.members[i] = undefined
      this.notices.delete(i)
    })
  }

  /** Nouveau preset (identité IA) ; `keepStuff` : garder le stuff actuel, sinon prendre celui du preset. */
  setPreset(i: number, preset: string, keepStuff: boolean): void {
    this.change(() => {
      const d = this.drafts[i]
      if (keepStuff) this.own(i)
      else {
        d.build = undefined
        d.stuff = undefined
      }
      d.preset = preset
    })
  }

  setRole(i: number, role: string): void {
    this.change(() => (this.drafts[i].role = role || undefined))
  }

  setFixed(i: number, fixed: boolean): void {
    this.change(() => (this.drafts[i].fixed = fixed || undefined))
  }

  /** Stuff nommé de data/ai/presets.json (`preset@stuff`). */
  loadStuff(i: number, stuff: string): void {
    this.change(() => {
      const d = this.drafts[i]
      d.build = undefined
      d.stuff = stuff || undefined
    })
  }

  /** Revenir au stuff du preset (build personnalisé abandonné). */
  resetStuff(i: number): void {
    this.change(() => {
      this.drafts[i].build = undefined
      this.drafts[i].stuff = undefined
    })
  }

  // ───────────────────────────── objets et forgemagie ─────────────────────────────

  /** Objet `itemId` à la position d'affichage `pos` (remplace l'objet de cette position). */
  setItem(i: number, pos: number, itemId: number): void {
    this.change(() => {
      const b = this.own(i)
      const layout = slotLayout(b, this.data.byId)
      const at = layout[pos]?.index ?? -1
      if (at >= 0) b.items[at] = { itemId }
      else b.items.push({ itemId })
    })
  }

  clearItem(i: number, pos: number): void {
    this.change(() => {
      const b = this.own(i)
      const at = slotLayout(b, this.data.byId)[pos]?.index ?? -1
      if (at >= 0) b.items.splice(at, 1)
    })
  }

  addForge(i: number, pos: number, choice: number): void {
    this.change(() => {
      const b = this.own(i)
      const it = b.items[slotLayout(b, this.data.byId)[pos]?.index ?? -1]
      const c = it ? this.members[i]?.forge[it.itemId]?.[choice] : undefined
      if (!it || !c) return
      it.exos = [...(it.exos ?? []), c.kind === 'transcendence' ? { stat: c.stat, value: c.value, kind: 'transcendence' } : { stat: c.stat, value: c.value }]
    })
  }

  removeForge(i: number, pos: number, line: number): void {
    this.change(() => {
      const b = this.own(i)
      const it = b.items[slotLayout(b, this.data.byId)[pos]?.index ?? -1]
      if (!it?.exos) return
      it.exos.splice(line, 1)
      if (!it.exos.length) delete it.exos
    })
  }

  // ───────────────────────────── points, parchemins, sorts ─────────────────────────────

  setPoints(i: number, stat: PrimaryStat, value: number): void {
    this.change(() => {
      const b = this.own(i)
      b.characteristicPoints = { ...b.characteristicPoints, [stat]: Math.max(0, Math.round(value) || 0) }
    })
  }

  setScrolls(i: number, stat: PrimaryStat, value: number): void {
    this.change(() => {
      const b = this.own(i)
      b.scrolls = { ...b.scrolls, [stat]: Math.min(100, Math.max(0, Math.round(value) || 0)) }
    })
  }

  fullScrolls(i: number): void {
    this.change(() => {
      this.own(i).scrolls = { vitality: 100, wisdom: 100, strength: 100, intelligence: 100, chance: 100, agility: 100 }
    })
  }

  async allocate(i: number, primary: PrimaryStat, rest: PrimaryStat | null): Promise<void> {
    const r = await call<{ points: Partial<Record<PrimaryStat, number>> }>('allocate', { breedId: this.drafts[i].breedId, primary, rest, level: this.build(i)?.level })
    this.change(() => (this.own(i).characteristicPoints = r.points))
  }

  toggleSpell(i: number, pair: number): void {
    this.change(() => {
      const b = this.own(i)
      const v = (b.spellVariants ?? []).slice()
      while (v.length <= pair) v.push(0)
      v[pair] = v[pair] ? 0 : 1
      b.spellVariants = v
    })
  }

  // ───────────────────────────── import RoxxSolver ─────────────────────────────

  /** Remplace le stuff du membre par celui d'un lien RoxxSolver (et sa classe si elle diffère). */
  async importRoxx(i: number, url: string): Promise<RoxxImport> {
    const r = await call<RoxxImport>('roxx', { url })
    this.change(() => {
      const d = this.drafts[i]
      const sameClass = d.breedId === r.breedId
      const variants = sameClass ? this.build(i)?.spellVariants : undefined
      this.drafts[i] = sameClass
        ? { ...d, stuff: undefined, build: { ...r.build, spellVariants: variants } }
        : { breedId: r.breedId, name: d.name, fixed: d.fixed, build: r.build }
      if (!sameClass) this.members[i] = undefined
      const notes = [...r.warnings]
      if (!sameClass) notes.unshift('Classe changée d’après le lien ; preset (IA) par défaut de la classe, variantes de sorts du preset.')
      this.notices.set(i, notes)
    })
    return r
  }

  // ───────────────────────────── enregistrement ─────────────────────────────

  /** Enregistre dans data/teams/<name> (`overwrite` : fichier existant ; sinon nouveau fichier créé à partir de l'équipe éditée). */
  async save(name: string, overwrite: boolean): Promise<TeamStuffs> {
    const r = await call<{ team: TeamStuffs }>('save', { name, scenario: this.scenario, drafts: this.drafts, overwrite, from: overwrite ? undefined : this.team.file })
    this.dirty = false
    return r.team
  }
}
