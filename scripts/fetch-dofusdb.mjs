#!/usr/bin/env node
// =====================================================================================
// DofusSimu — extraction reproductible des données du jeu depuis l'API publique DofusDB
// (https://api.dofusdb.fr, FeathersJS, données issues des fichiers du client Dofus 3).
//
// Usage :
//   NODE_USE_ENV_PROXY=1 node scripts/fetch-dofusdb.mjs [options]
//   (ou : npm run fetch:data)
//
// Options :
//   --refresh                 ignore le cache disque et re-télécharge toutes les pages
//   --concurrency=N           nombre de requêtes HTTP simultanées (défaut 4)
//   --delay=MS                délai minimal entre deux départs de requête (défaut 60 ms)
//   --monster-spells=all|vortex
//                             périmètre de monster-spells.json : sorts des monstres de TOUS les
//                             donjons (défaut) ou seulement du donjon 87 (Œil de Vortex).
//                             En mode "all", si le fichier dépasse 40 Mo, le script retombe
//                             automatiquement sur "vortex".
//   --max-depth=N             profondeur max. de la fermeture transitive sorts/invocations (défaut 20,
//                             simple garde-fou : la fermeture s'arrête dès qu'elle est stable)
//   --game-version=X.Y        version du jeu inscrite dans manifest.json (game.version) ; sans cette option,
//                             elle est déduite du schéma des grades de monstres (3.6 ou 3.7, l'API ne la publie pas)
//
// Garde-fou : l'extraction échoue (sans écrire monsters.json) si un boss a un grade sans ses 5 résistances en %,
// ce qui arriverait en silence si DofusDB renommait encore ses champs (schéma 3.7 : scripts/lib/dofusdb-normalize.mjs).
//
// Sorties (data/dofusdb/) : breeds.json (+ rôles), class-spells.json, item-spells.json,
//   spell-states.json, effects.json, characteristics.json, item-types.json, equipment.json,
//   item-sets.json, monsters.json, monster-races.json, monster-spells.json, dungeons.json,
//   dungeon-maps.json, achievements-vortex.json, challenges.json, manifest.json.
// Cache brut (gitignoré) : .cache/dofusdb/<service>/<requête>.json (réponse API telle quelle).
//
// Aucune dépendance : Node >= 22 (fetch natif). Documentation : docs/research/dofusdb-api.md
// =====================================================================================

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Grades de monstres : lecture des schémas DofusDB 3.6 et 3.7, garde-fou des résistances des boss (§10 de la doc).
import { assertBossResistances, gameVersionInfo, normGrade, summarizeGradeSchemas } from './lib/dofusdb-normalize.mjs';

// ------------------------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------------------------
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.DOFUSDB_API ?? 'https://api.dofusdb.fr').replace(/\/$/, '');
const CACHE_DIR = path.join(ROOT, '.cache', 'dofusdb');
const OUT_DIR = path.join(ROOT, 'data', 'dofusdb');
const PAGE_SIZE = 50; // maximum accepté par l'API

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const a = argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return def;
  const eq = a.indexOf('=');
  return eq === -1 ? true : a.slice(eq + 1);
};
const REFRESH = Boolean(opt('refresh', false));
const CONCURRENCY = Math.max(1, Number(opt('concurrency', 4)));
const MIN_DELAY_MS = Math.max(0, Number(opt('delay', 60)));
const MONSTER_SPELLS_SCOPE = String(opt('monster-spells', 'all'));
// Garde-fou seulement : la fermeture s'arrête dès que la frontière est vide. 8 était trop juste (le périmètre
// "objets" se stabilisait exactement à la profondeur 8).
const MAX_DEPTH = Number(opt('max-depth', 20));
const MONSTER_SPELLS_MAX_BYTES = 40 * 1024 * 1024;
const GAME_VERSION = opt('game-version', undefined);

const VORTEX_DUNGEON_ID = 87;
const VORTEX_ACHIEVEMENTS = [1156, 1157, 1158, 1159, 6243];

// ------------------------------------------------------------------------------------
// Tables de correspondance (voir docs/research/dofusdb-api.md)
// ------------------------------------------------------------------------------------

/** Types d'objets équipables (typeId -> emplacement logique). superTypeId entre parenthèses. */
const EQUIPMENT_TYPES = {
  1: 'amulet', // (1) Amulette
  9: 'ring', // (3) Anneau — 2 emplacements
  10: 'belt', // (4) Ceinture
  11: 'boots', // (5) Bottes
  16: 'hat', // (10) Chapeau
  17: 'cloak', // (11) Cape (les sacs à dos n'existent plus comme type distinct)
  82: 'shield', // (7) Bouclier
  // Armes (superType 2)
  2: 'weapon', // Arc
  3: 'weapon', // Baguette
  4: 'weapon', // Bâton
  5: 'weapon', // Dague
  6: 'weapon', // Épée
  7: 'weapon', // Marteau
  8: 'weapon', // Pelle
  19: 'weapon', // Hache
  20: 'weapon', // Outil
  21: 'weapon', // Pioche
  22: 'weapon', // Faux
  114: 'weapon', // Arme magique
  271: 'weapon', // Lance
  // Dofus / Trophées / Prysmaradites (superType 13) — 6 emplacements
  23: 'dofus',
  151: 'trophy',
  217: 'prysmaradite',
  // Familiers / montiliers / montures (superType 12) — 1 emplacement
  18: 'pet',
  121: 'petsmount',
  311: 'mount',
  331: 'mount', // Dragodinde
  332: 'mount', // Muldo
  333: 'mount', // Volkorne
};

/**
 * Effets dont diceNum est un identifiant de SORT (lancer de sort, glyphe, piège, rune, modif. de sort…).
 * Complété dynamiquement après lecture de effects.json : tous les effets de catégorie 3 (modificateurs
 * de sort "#1 : ...") et tous les effets dont la description fr vaut exactement "#1".
 */
const SPELL_REF_DICENUM_EFFECTS = new Set([
  // "#1" = lance / déclenche le sort diceNum (grade diceSide) ; 1175 = sort porté par un objet (Dofus, légendaires)
  792, 793, 1017, 1018, 1019, 1160, 1175, 1187, 2017, 2160, 2792, 2793, 2794, 2795, 2960,
  // pièges, glyphes, runes, auras, glyphe-prison ; 2018 = dissipe les glyphes du sort diceNum
  400, 401, 402, 1091, 1165, 2018, 2022, 4040,
  // modificateurs de sorts ("#1 : ..." avec #1 = sort)
  280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 314, 798, 799,
  1035, 1036, 1045, 2905, 2906, 2908, 2909, 2910, 2911, 2914, 2932, 2933, 2934, 2935, 3290, 4052,
]);
/** Sous-ensemble "modificateurs de sort" (catégorie 3 + relances 1035/1036/1045/4052), complété dynamiquement. */
const SPELL_MODIFIER_EFFECTS = new Set([1035, 1036, 1045, 4052]);
/**
 * Effets dont diceSide est un identifiant de SORT. Vide depuis la vérification du 2026-10-04 : 406/1406 avaient été
 * classés ici d'après leur gabarit ("sort #2"), mais les données montrent que le sort est dans `value`
 * (406 : 1139/1164 valeurs = sorts existants, 0/1164 pour diceSide ; 1406 : diceSide = rang 1..6). Conservé pour extension.
 */
const SPELL_REF_DICESIDE_EFFECTS = new Set([]);
/**
 * Effets dont value est un identifiant de SORT : 1026 "Déclenche les glyphes" (value = sort du glyphe),
 * 722/2997 "Ajouter un sort temporaire" (value = sort, diceSide = grade), 406 "Enlève les effets du sort"
 * (value = sort), 1406 "Enlève les effets du rang #1 du sort #2" (value = sort, diceSide = rang/grade).
 */
const SPELL_REF_VALUE_EFFECTS = new Set([406, 722, 1026, 1406, 2997]);
/** Effets dont diceSide est un identifiant de NIVEAU de sort (spell-levels) : 1181 "Pose un portail". */
const SPELL_LEVEL_REF_DICESIDE_EFFECTS = new Set([1181]);
/** Effets d'invocation : diceNum = id de monstre, diceSide = grade. */
const SUMMON_EFFECTS = new Set([181, 405, 1008, 1011, 2796]);
/** Effets d'état : value = id d'état (spell-states). 950 ajoute, 951 enlève, 952 désactive. */
const STATE_EFFECTS = new Set([950, 951, 952]);

/** Valeurs par défaut des champs d'effet omis dans la sortie (champs "secondaires"). */
const EFFECT_DEFAULTS = {
  baseEffectId: 0,
  targetId: 0,
  modificator: 0,
  effectElement: -1,
  effectTriggerDuration: 0,
  displayZero: false,
  visibleInTooltip: true,
  visibleInBuffUi: true,
  visibleInFightLog: true,
  visibleOnTerrain: true,
  forClientOnly: false,
  trigger: false,
};

// ------------------------------------------------------------------------------------
// Utilitaires généraux
// ------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const uniq = (arr) => [...new Set(arr)];
const byId = (a, b) => a.id - b.id;
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Champ localisé DofusDB {id, fr, en, de, es, pt} -> {fr, en} (null si vide). */
function loc(o) {
  if (o == null) return null;
  if (typeof o === 'string') return { fr: o, en: o };
  const fr = o.fr ?? null;
  const en = o.en ?? null;
  if (fr == null && en == null) return null;
  return { fr, en };
}

/** Supprime les clés dont la valeur est undefined. */
function compact(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

// ------------------------------------------------------------------------------------
// Client HTTP : limitation de débit, retries avec backoff exponentiel, cache disque
// ------------------------------------------------------------------------------------
let active = 0;
let lastStart = 0;
const waiters = [];
const stats = { requests: 0, cacheHits: 0, retries: 0, bytes: 0 };
const sourceUrls = new Set();

async function acquire() {
  // Si un créneau est libre on le prend ; sinon on attend qu'un release() nous le transmette directement
  // (évite qu'un nouvel appel ne "double" un waiter réveillé et ne dépasse CONCURRENCY).
  if (active >= CONCURRENCY) await new Promise((r) => waiters.push(r));
  else active++;
  const wait = lastStart + MIN_DELAY_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + MIN_DELAY_MS);
  if (wait > 0) await sleep(wait);
}
function release() {
  const next = waiters.shift();
  if (next) next(); // créneau transmis tel quel au suivant
  else active--;
}

/** Construit une query string FeathersJS à partir d'une liste de paires [clé, valeur]. */
function buildQuery(pairs) {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

function cacheFile(service, qs) {
  const readable = decodeURIComponent(qs).replace(/[^A-Za-z0-9=_.-]+/g, '_').replace(/_+/g, '_');
  const name = readable.length <= 90 ? readable : `${readable.slice(0, 60)}_${sha1(qs).slice(0, 12)}`;
  return path.join(CACHE_DIR, service.replace(/[^A-Za-z0-9-]/g, '_'), `${name || 'index'}.json`);
}

/**
 * GET {API}/{service}?{pairs}. Renvoie le JSON (ou null si 404).
 * Les réponses brutes sont mises en cache sur disque ; --refresh force le re-téléchargement.
 */
async function getJson(service, pairs = []) {
  const qs = buildQuery(pairs);
  const url = `${API}/${service}${qs ? `?${qs}` : ''}`;
  sourceUrls.add(`${API}/${service}`);
  const file = cacheFile(service, qs);
  if (!REFRESH && existsSync(file)) {
    try {
      const txt = await readFile(file, 'utf8');
      stats.cacheHits++;
      return JSON.parse(txt);
    } catch {
      /* cache corrompu : on re-télécharge */
    }
  }
  const maxAttempts = 7;
  for (let attempt = 1; ; attempt++) {
    await acquire();
    let res;
    let txt;
    let err;
    try {
      stats.requests++;
      res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'DofusSimu-data-extractor/1.0 (+non-commercial research)' },
        signal: AbortSignal.timeout(90_000),
      });
      txt = await res.text();
    } catch (e) {
      err = e;
    } finally {
      release();
    }
    if (!err && res.status === 404) return null;
    if (!err && res.ok) {
      try {
        const json = JSON.parse(txt);
        stats.bytes += txt.length;
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, txt);
        return json;
      } catch (e) {
        err = new Error(`JSON invalide (${e.message}) pour ${url}: ${txt.slice(0, 120)}`);
      }
    }
    if (!err) {
      const retryable = res.status === 429 || res.status >= 500;
      err = new Error(`HTTP ${res.status} pour ${url}: ${String(txt).slice(0, 200)}`);
      if (!retryable) throw err;
    }
    if (attempt >= maxAttempts) throw err;
    stats.retries++;
    const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 300);
    log(`  ! tentative ${attempt}/${maxAttempts} échouée (${err.cause?.code ?? err.message}); nouvel essai dans ${backoff} ms`);
    await sleep(backoff);
  }
}

/** Récupère TOUS les enregistrements d'un service (pagination $limit/$skip, tri par id). */
async function fetchAll(service, filters = [], select = null) {
  const base = [...filters, ['$sort[id]', 1]];
  if (select) for (const f of select) base.push(['$select[]', f]);
  const first = await getJson(service, [...base, ['$limit', PAGE_SIZE], ['$skip', 0]]);
  const total = first.total;
  const pages = [];
  for (let skip = PAGE_SIZE; skip < total; skip += PAGE_SIZE) pages.push(skip);
  const rest = await Promise.all(pages.map((skip) => getJson(service, [...base, ['$limit', PAGE_SIZE], ['$skip', skip]])));
  const data = [...first.data, ...rest.flatMap((p) => p.data)];
  const seen = new Map();
  for (const d of data) seen.set(d.id, d);
  if (seen.size !== total) log(`  ! ${service}: ${seen.size} enregistrements uniques reçus pour total=${total}`);
  return [...seen.values()].sort(byId);
}

/** Récupère des enregistrements par liste d'ids (id[$in][] par paquets de 50). Renvoie une Map id->record. */
async function fetchByIds(service, ids, select = null) {
  const want = uniq(ids.filter((x) => x != null && Number.isFinite(Number(x))).map(Number)).sort((a, b) => a - b);
  const out = new Map();
  const chunks = chunk(want, PAGE_SIZE);
  const results = await Promise.all(
    chunks.map((c) => {
      const pairs = c.map((id) => ['id[$in][]', id]);
      pairs.push(['$limit', PAGE_SIZE]);
      if (select) for (const f of select) pairs.push(['$select[]', f]);
      return getJson(service, pairs);
    }),
  );
  for (const r of results) for (const d of r?.data ?? []) out.set(d.id, d);
  return out;
}

// ------------------------------------------------------------------------------------
// Écriture JSON (une entrée par ligne : compact mais lisible en diff git)
// ------------------------------------------------------------------------------------
const written = [];

function serialize(value, pretty) {
  if (pretty) return `${JSON.stringify(value, null, 2)}\n`;
  if (Array.isArray(value)) return `[\n${value.map((v) => JSON.stringify(v)).join(',\n')}\n]\n`;
  if (value && typeof value === 'object') {
    const parts = Object.entries(value).map(([k, v]) => {
      if (Array.isArray(v) && v.length > 8) return `${JSON.stringify(k)}: [\n${v.map((x) => JSON.stringify(x)).join(',\n')}\n]`;
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 8 && Object.values(v).some((x) => x && typeof x === 'object'))
        return `${JSON.stringify(k)}: {\n${Object.entries(v).map(([k2, v2]) => `${JSON.stringify(k2)}: ${JSON.stringify(v2)}`).join(',\n')}\n}`;
      return `${JSON.stringify(k)}: ${JSON.stringify(v)}`;
    });
    return `{\n${parts.join(',\n')}\n}\n`;
  }
  return `${JSON.stringify(value)}\n`;
}

async function writeOut(name, value, { pretty = false, count } = {}) {
  await mkdir(OUT_DIR, { recursive: true });
  const txt = serialize(value, pretty);
  const file = path.join(OUT_DIR, name);
  await writeFile(file, txt);
  const n = count ?? (Array.isArray(value) ? value.length : undefined);
  written.push({ file: name, bytes: Buffer.byteLength(txt), count: n });
  log(`  -> data/dofusdb/${name} (${(Buffer.byteLength(txt) / 1024).toFixed(0)} Ko${n != null ? `, ${n} entrées` : ''})`);
  return Buffer.byteLength(txt);
}

// ------------------------------------------------------------------------------------
// Normalisation
// ------------------------------------------------------------------------------------

/**
 * zoneDescr DofusDB {shape, param1, param2, damageDecreaseStepPercent, maxDamageDecreaseApplyCount,
 * isStopAtTarget, forcedDirection, includeCarried, onlyAffectIfInSightLine, cellIds}
 * -> { zone: "<forme><param1>,<param2>,<pas%>,<maxPas>", zoneFlags?: "c|s|d|v", zoneCells?: [...] }
 * Forme = String.fromCharCode(shape) : P point, C cercle, X croix, L ligne, T ligne perpendiculaire,
 * D damier, Q croix creuse, O cercle creux (anneau), # croix diagonale, + étoile, / diagonale, - ligne perpendiculaire…
 */
function normZone(z) {
  if (!z || !z.shape) return {}; // shape 0 = pas de zone
  const shape = typeof z.shape === 'number' ? String.fromCharCode(z.shape) : String(z.shape);
  const out = { zone: `${shape}${z.param1 ?? 0},${z.param2 ?? 0},${z.damageDecreaseStepPercent ?? 0},${z.maxDamageDecreaseApplyCount ?? 0}` };
  let flags = '';
  if (z.includeCarried) flags += 'c';
  if (z.isStopAtTarget) flags += 's';
  if (z.forcedDirection) flags += 'd';
  if (z.onlyAffectIfInSightLine) flags += 'v';
  if (flags) out.zoneFlags = flags;
  if (Array.isArray(z.cellIds) && z.cellIds.length) out.zoneCells = z.cellIds;
  return out;
}

/** Zone d'aperçu d'un niveau de sort -> {id, display, activation, casterMask?, activationMask?, hidden?} (zones au format normZone). */
function normPreviewZone(p) {
  if (p && p.shape !== undefined) return { display: normZone(p).zone }; // forme "zoneDescr" nue (défensif)
  const d = normZone(p?.displayZoneDescr);
  const a = normZone(p?.activationZoneDescr);
  return compact({
    id: p?.id,
    display: d.zone,
    displayFlags: d.zoneFlags,
    displayCells: d.zoneCells,
    activation: a.zone,
    activationFlags: a.zoneFlags,
    activationCells: a.zoneCells,
    casterMask: p?.casterMask || undefined,
    activationMask: p?.activationMask || undefined,
    hidden: p?.isPreviewZoneHidden || undefined,
  });
}

/** Effet d'objet / de panoplie (possibleEffects) : même forme dans equipment.json et item-sets.json. */
function normItemEffect(e) {
  return compact({ effectId: e.effectId, diceNum: e.diceNum ?? 0, diceSide: e.diceSide ?? 0, value: e.value ?? 0, baseEffectId: e.baseEffectId || undefined });
}

/** Effet de sort (EffectInstanceDice) normalisé. Champs "principaux" toujours présents. */
function normSpellEffect(e) {
  const out = {
    effectId: e.effectId,
    effectUid: e.effectUid,
    order: e.order,
    diceNum: e.diceNum ?? 0,
    diceSide: e.diceSide ?? 0,
    value: e.value ?? 0,
    duration: e.duration ?? 0,
    delay: e.delay ?? 0,
    random: e.random ?? 0,
    group: e.group ?? 0,
    targetMask: e.targetMask ?? '',
    triggers: e.triggers ?? '',
    dispellable: e.dispellable ?? 1,
    ...normZone(e.zoneDescr),
  };
  for (const [k, def] of Object.entries(EFFECT_DEFAULTS)) {
    if (e[k] !== undefined && e[k] !== def) out[k] = e[k];
  }
  if (e.rawZone) out.rawZone = e.rawZone;
  return out;
}

function normSpellLevel(l) {
  return compact({
    id: l.id,
    spellId: l.spellId,
    grade: l.grade,
    spellBreed: l.spellBreed,
    apCost: l.apCost,
    minRange: l.minRange,
    range: l.range,
    rangeCanBeBoosted: l.rangeCanBeBoosted,
    castInLine: l.castInLine,
    castInDiagonal: l.castInDiagonal,
    castTestLos: l.castTestLos,
    needFreeCell: l.needFreeCell,
    needTakenCell: l.needTakenCell,
    needFreeTrapCell: l.needFreeTrapCell,
    needVisibleEntity: l.needVisibleEntity,
    needCellWithoutPortal: l.needCellWithoutPortal,
    portalProjectionForbidden: l.portalProjectionForbidden,
    criticalHitProbability: l.criticalHitProbability,
    maxStack: l.maxStack,
    maxCastPerTurn: l.maxCastPerTurn,
    maxCastPerTarget: l.maxCastPerTarget,
    maxGlobalCastPerTurn: l.maxGlobalCastPerTurn,
    maxGlobalCastPerTarget: l.maxGlobalCastPerTarget,
    minCastInterval: l.minCastInterval,
    initialCooldown: l.initialCooldown,
    globalCooldown: l.globalCooldown,
    minPlayerLevel: l.minPlayerLevel,
    statesCriterion: l.statesCriterion ?? '',
    hideEffects: l.hideEffects,
    hidden: l.hidden,
    playAnimation: l.playAnimation,
    // previewZones[] = {id, displayZoneDescr, activationZoneDescr, casterMask, activationMask, isPreviewZoneHidden}
    // (zone d'aperçu affichée / zone d'activation, ex. auras de glyphes). Avant correction : z.zoneDescr inexistant -> [{}].
    previewZones: (l.previewZones ?? []).length ? l.previewZones.map(normPreviewZone) : undefined,
    effects: (l.effects ?? []).map(normSpellEffect),
    criticalEffect: (l.criticalEffect ?? []).map(normSpellEffect),
  });
}

function normSpell(s, levelsById) {
  const levels = (s.spellLevels ?? []).map((id) => levelsById.get(id)).filter(Boolean).map(normSpellLevel);
  const missing = (s.spellLevels ?? []).filter((id) => !levelsById.has(id));
  const preview = normZone(s.basePreviewZoneDescr);
  return compact({
    id: s.id,
    name: loc(s.name),
    description: loc(s.description),
    typeId: s.typeId,
    order: s.order,
    iconId: s.iconId,
    adminName: s.adminName || undefined,
    verboseCast: s.verboseCast,
    bypassSummoningLimit: s.bypassSummoningLimit,
    canAlwaysTriggerSpells: s.canAlwaysTriggerSpells,
    hideCastConditions: s.hideCastConditions,
    basePreviewZone: preview.zone,
    spellLevels: s.spellLevels,
    missingLevels: missing.length ? missing : undefined,
    levels,
  });
}

/** Références sortantes d'un niveau de sort (sorts, monstres invoqués, états). */
function levelRefs(l) {
  const r = effectListRefs([...(l.effects ?? []), ...(l.criticalEffect ?? [])]);
  for (const m of String(l.statesCriterion ?? '').matchAll(/\d+/g)) r.states.add(Number(m[0]));
  return r;
}

/** Références sortantes d'une liste d'effets (sorts, niveaux de sort, monstres invoqués, états). */
function effectListRefs(effects) {
  const spells = new Set();
  const spellLevels = new Set();
  const monsters = new Set();
  const states = new Set();
  for (const e of effects) {
    if (SPELL_REF_DICENUM_EFFECTS.has(e.effectId) && e.diceNum > 0) spells.add(e.diceNum);
    if (SPELL_REF_DICESIDE_EFFECTS.has(e.effectId) && e.diceSide > 0) spells.add(e.diceSide);
    if (SPELL_REF_VALUE_EFFECTS.has(e.effectId) && e.value > 0) spells.add(e.value);
    if (SPELL_LEVEL_REF_DICESIDE_EFFECTS.has(e.effectId) && e.diceSide > 0) spellLevels.add(e.diceSide);
    if (SUMMON_EFFECTS.has(e.effectId) && e.diceNum > 0) monsters.add(e.diceNum);
    if (STATE_EFFECTS.has(e.effectId) && e.value > 0) states.add(e.value);
  }
  return { spells, spellLevels, monsters, states };
}

/** Arrondit les flottants (characRatios…) à 6 décimales. */
const round6 = (x) => (typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 1e6) / 1e6 : x);

/** "1,220;1,220;0,null" -> [1,1,0] (grade du sort par grade du monstre ; 0 = sort indisponible). */
function parseSpellGrades(s) {
  if (typeof s !== 'string' || !s) return [];
  return s.split(';').map((p) => Number(p.split(',')[0]) || 0);
}

// ------------------------------------------------------------------------------------
// Étapes
// ------------------------------------------------------------------------------------
async function stepReferenceTables() {
  log('== Tables de référence : effects, characteristics, item-types');
  const effects = await fetchAll('effects');
  // Complète la liste des effets "référence de sort par diceNum" : modificateurs de sort (catégorie 3,
  // description "#1 : ...") et effets dont la description est exactement "#1" (lancers de sort).
  for (const e of effects) {
    const fr = e.description?.fr ?? '';
    if ((e.category === 3 && fr.startsWith('#1')) || fr === '#1' || fr.startsWith('#1 :')) SPELL_REF_DICENUM_EFFECTS.add(e.id);
    if (SPELL_REF_DICENUM_EFFECTS.has(e.id) && (e.category === 3 || fr.startsWith('#1 :'))) SPELL_MODIFIER_EFFECTS.add(e.id);
  }
  const effectsOut = effects.map((e) =>
    compact({
      id: e.id,
      description: loc(e.description),
      theoreticalDescription: loc(e.theoreticalDescription) ?? undefined,
      characteristic: e.characteristic,
      category: e.category,
      characteristicOperator: e.characteristicOperator,
      elementId: e.elementId,
      useDice: e.useDice,
      forceMinMax: e.forceMinMax,
      boost: e.boost,
      active: e.active,
      oppositeId: e.oppositeId,
      bonusType: e.bonusType,
      isInPercent: e.isInPercent,
      useInFight: e.useInFight,
      showInTooltip: e.showInTooltip,
      showInSet: e.showInSet,
      hideValueInTooltip: e.hideValueInTooltip,
      parametersFixed: e.parametersFixed,
      effectPriority: e.effectPriority,
      effectPowerRate: round6(e.effectPowerRate), // = poids de rune de forgemagie
      theoreticalPattern: e.theoreticalPattern,
      effectTriggerDuration: e.effectTriggerDuration,
      actionFiltersId: e.actionFiltersId?.length ? e.actionFiltersId : undefined,
      textIconReferenceId: e.textIconReferenceId,
      iconId: e.iconId || undefined,
    }),
  );
  await writeOut('effects.json', effectsOut);

  const characteristics = await fetchAll('characteristics');
  const charOut = characteristics.map((c) =>
    compact({
      id: c.id,
      keyword: c.keyword,
      name: loc(c.name),
      categoryId: c.categoryId,
      visible: c.visible,
      order: c.order,
      upgradable: c.upgradable,
      scaleFormulaId: c.scaleFormulaId,
      asset: c.asset || undefined,
    }),
  );
  await writeOut('characteristics.json', charOut);

  const superTypes = await fetchAll('item-super-types');
  const types = await fetchAll('item-types');
  const itemTypesOut = {
    note: 'types[].slot = emplacement logique utilisé par DofusSimu (null = non équipable). superTypes[].positions = positions d\'inventaire du client (0 amulette, 1 arme, 2/4 anneaux, 3 ceinture, 5 bottes, 6 chapeau, 7 cape, 8 familier/monture, 9-14 dofus/trophées, 15 bouclier).',
    superTypes: superTypes.map((s) => ({ id: s.id, name: loc(s.name), positions: s.positions ?? [] })),
    types: types.map((t) =>
      compact({
        id: t.id,
        name: loc(t.name),
        superTypeId: t.superTypeId,
        categoryId: t.categoryId,
        slot: EQUIPMENT_TYPES[t.id] ?? null,
        rawZone: t.rawZone || undefined,
        evolutiveTypeId: t.evolutiveTypeId || undefined,
        isInEncyclopedia: t.isInEncyclopedia,
        craftXpRatio: t.craftXpRatio,
      }),
    ),
  };
  await writeOut('item-types.json', itemTypesOut, { count: types.length });
  return { effects, characteristics, types, superTypes };
}

async function stepBreeds() {
  log('== Classes (breeds), rôles, variantes de sorts');
  const breeds = await fetchAll('breeds');
  const roles = await fetchAll('breed-roles');
  const variants = await fetchAll('spell-variants', [], ['id', 'breedId', 'spellIds']);
  const variantBySpell = new Map();
  for (const v of variants) for (const s of v.spellIds ?? []) variantBySpell.set(s, v);
  const breedOut = breeds.map((b) => {
    const pairs = [];
    const variantIds = [];
    for (const sid of b.breedSpellsId ?? []) {
      const v = variantBySpell.get(sid);
      if (!v) {
        pairs.push([sid, null]);
        variantIds.push(null);
        continue;
      }
      const other = v.spellIds.find((x) => x !== sid) ?? null;
      pairs.push([sid, other]);
      variantIds.push(v.id);
    }
    return {
      id: b.id,
      shortName: loc(b.shortName),
      longName: loc(b.longName) ?? undefined,
      gameplayDescription: loc(b.gameplayDescription),
      description: loc(b.description),
      gameplayClassDescription: loc(b.gameplayClassDescription) ?? undefined,
      complexity: b.complexity,
      sortIndex: b.sortIndex,
      roles: (b.breedRoles ?? [])
        .map((r) => ({ roleId: r.roleId, value: r.value, order: r.order, description: r.order >= 0 ? loc(r.description) : undefined }))
        .sort((x, y) => x.roleId - y.roleId),
      statsPointsForStrength: b.statsPointsForStrength,
      statsPointsForIntelligence: b.statsPointsForIntelligence,
      statsPointsForChance: b.statsPointsForChance,
      statsPointsForAgility: b.statsPointsForAgility,
      statsPointsForVitality: b.statsPointsForVitality,
      statsPointsForWisdom: b.statsPointsForWisdom,
      breedSpellsId: b.breedSpellsId,
      spellPairs: pairs,
      spellVariantIds: variantIds,
    };
  });
  const rolesOut = roles.map((r) => compact({ id: r.id, name: loc(r.name), description: loc(r.description) ?? undefined, color: r.color, assetId: r.assetId }));
  return { breeds, breedOut, rolesOut, variants };
}

/**
 * Fermeture transitive : sorts -> sorts référencés (lancers, glyphes, pièges…) -> monstres invoqués
 * -> leurs sorts (+ sort de départ). Renvoie les sorts bruts, niveaux bruts, monstres atteints, états.
 */
async function spellClosure({ seedSpells = [], seedMonsters = [], seedSpellLevels = [], monstersById, label, knownSpells = new Set(), knownMonsters = new Set() }) {
  // knownSpells / knownMonsters : déjà extraits dans un autre fichier -> ni téléchargés ni explorés ici
  const spells = new Map();
  const levels = new Map();
  const reachedMonsters = new Set();
  const states = new Set();
  const missingSpells = new Set();
  const missingMonsters = new Set();
  const missingSpellLevels = new Set();
  const depthOfSpell = new Map();
  const viaMonster = new Map(); // spellId -> monsterId qui l'utilise (premier trouvé)
  const startingSpellLevels = {}; // spell-level id (grades[].startingSpellId ou réf. 1181) -> spellId
  let frontierSpells = new Set(seedSpells);
  let frontierMonsters = new Set(seedMonsters);
  let frontierLevels = new Set(seedSpellLevels);
  for (const s of seedSpells) depthOfSpell.set(s, 0);
  for (let depth = 0; depth <= MAX_DEPTH && (frontierSpells.size || frontierMonsters.size || frontierLevels.size); depth++) {
    // Monstres -> sorts (liste spells + sort de départ via spell-level)
    for (const mid of frontierMonsters) {
      if (reachedMonsters.has(mid)) continue;
      reachedMonsters.add(mid);
      if (knownMonsters.has(mid)) continue;
      const m = monstersById.get(mid);
      if (!m) {
        missingMonsters.add(mid);
        continue;
      }
      for (const s of m.spells ?? []) {
        if (!spells.has(s)) frontierSpells.add(s);
        if (!viaMonster.has(s)) viaMonster.set(s, mid);
      }
      for (const g of m.grades ?? []) if (g.startingSpellId) frontierLevels.add(g.startingSpellId);
    }
    // Niveaux de sort isolés -> sort parent
    const lvlIds = [...frontierLevels];
    frontierLevels = new Set();
    if (lvlIds.length) {
      const sl = await fetchByIds('spell-levels', lvlIds.filter((id) => !levels.has(id)));
      for (const [id, l] of sl) levels.set(id, l);
      for (const id of lvlIds) {
        const l = levels.get(id);
        if (!l) {
          missingSpellLevels.add(id);
          continue;
        }
        startingSpellLevels[id] = l.spellId;
        if (!spells.has(l.spellId)) frontierSpells.add(l.spellId);
      }
    }
    frontierMonsters = new Set();
    // Sorts
    const toFetch = [...frontierSpells].filter((s) => !spells.has(s) && !missingSpells.has(s) && !knownSpells.has(s));
    frontierSpells = new Set();
    if (!toFetch.length) continue;
    const got = await fetchByIds('spells', toFetch);
    for (const id of toFetch) {
      if (!got.has(id)) missingSpells.add(id);
      if (!depthOfSpell.has(id)) depthOfSpell.set(id, depth);
    }
    for (const [id, s] of got) spells.set(id, s);
    const levelIds = [...got.values()].flatMap((s) => s.spellLevels ?? []).filter((id) => !levels.has(id));
    const gotLevels = await fetchByIds('spell-levels', levelIds);
    for (const [id, l] of gotLevels) levels.set(id, l);
    for (const s of got.values()) {
      for (const lid of s.spellLevels ?? []) {
        const l = levels.get(lid);
        if (!l) continue;
        const r = levelRefs(l);
        for (const x of r.spells) if (!spells.has(x) && !missingSpells.has(x)) frontierSpells.add(x);
        for (const x of r.spellLevels) if (!(x in startingSpellLevels) && !missingSpellLevels.has(x)) frontierLevels.add(x);
        for (const x of r.monsters) if (!reachedMonsters.has(x)) frontierMonsters.add(x);
        for (const x of r.states) states.add(x);
      }
    }
    log(`  [${label}] profondeur ${depth}: ${spells.size} sorts, ${levels.size} niveaux, ${reachedMonsters.size} monstres`);
  }
  if (frontierSpells.size || frontierMonsters.size || frontierLevels.size)
    log(`  ! [${label}] profondeur max ${MAX_DEPTH} atteinte : ${frontierSpells.size} sorts / ${frontierMonsters.size} monstres non explorés`);
  // Les niveaux "de départ" (startingSpellId) sont aussi scannés
  for (const l of levels.values()) for (const x of levelRefs(l).states) states.add(x);
  return {
    spells, levels, reachedMonsters, states, missingSpells, missingMonsters, missingSpellLevels, depthOfSpell, viaMonster, startingSpellLevels,
  };
}

async function stepEquipment(typesById) {
  log('== Équipements (tous niveaux) et panoplies');
  const typeIds = Object.keys(EQUIPMENT_TYPES).map(Number).sort((a, b) => a - b);
  const all = [];
  for (const t of typeIds) {
    const items = await fetchAll('items', [['typeId', t]], [
      'id', 'name', 'typeId', 'level', 'itemSetId', 'criterions', 'criterionsTarget', 'possibleEffects', 'evolutiveEffectIds',
      'apCost', 'minRange', 'range', 'castInLine', 'castInDiagonal', 'castTestLos', 'criticalHitProbability', 'criticalHitBonus',
      'maxCastPerTurn', 'twoHanded', 'isLegendary', 'etheral', 'iconId', 'appearanceId', 'exchangeable', 'isSaleable',
      'visibilityCriterion', 'hideEffects', 'enhanceable', 'className', 'favoriteSubAreas', 'favoriteSubAreasBonus',
    ]);
    all.push(...items);
  }
  const equipment = all
    .map((it) => {
      const type = typesById.get(it.typeId);
      const isWeapon = it.className === 'WeaponData' || type?.superTypeId === 2;
      const out = {
        id: it.id,
        name: loc(it.name),
        typeId: it.typeId,
        superTypeId: type?.superTypeId,
        slot: EQUIPMENT_TYPES[it.typeId],
        level: it.level,
        itemSetId: it.itemSetId > 0 ? it.itemSetId : null,
        iconId: it.iconId,
        criterions: it.criterions || '',
        criterionsTarget: it.criterionsTarget || undefined,
        possibleEffects: (it.possibleEffects ?? []).map(normItemEffect),
        evolutiveEffectIds: it.evolutiveEffectIds?.length ? it.evolutiveEffectIds : undefined,
        isLegendary: it.isLegendary || undefined,
        etheral: it.etheral || undefined,
        exchangeable: it.exchangeable,
        visibilityCriterion: it.visibilityCriterion || undefined,
        hideEffects: it.hideEffects || undefined,
      };
      if (isWeapon) {
        Object.assign(out, {
          apCost: it.apCost,
          minRange: it.minRange,
          range: it.range,
          castInLine: it.castInLine,
          castInDiagonal: it.castInDiagonal,
          castTestLos: it.castTestLos,
          criticalHitProbability: it.criticalHitProbability,
          criticalHitBonus: it.criticalHitBonus,
          maxCastPerTurn: it.maxCastPerTurn,
          twoHanded: it.twoHanded,
          weaponZone: type?.rawZone || 'P',
        });
      } else if (it.twoHanded) out.twoHanded = true;
      return compact(out);
    })
    .sort(byId);
  await writeOut('equipment.json', equipment);

  // Bonus de panoplie : on lit possibleEffects (EffectInstanceDice bruts, index i = i+1 objets équipés, liste = bonus
  // TOTAL à ce palier) et non le résumé DofusDB `effects` {from,to}, qui (1) perd `value` (ex. 722 "Ajouter un sort
  // temporaire" : value = id du sort, Panoplie du Vampyre maudit -> 8166…8170, 10913), (2) signe les malus
  // (218 "-#1% Résistance Feu" -> from = -20 alors que diceNum = 20 dans les objets : double négation) et (3) omet
  // certains effets (ex. 10 "Attitude"). Même forme que equipment.json possibleEffects.
  const sets = await fetchAll('item-sets', [], ['id', 'name', 'items', 'effects', 'possibleEffects', 'bonusIsSecret', 'isCosmetic', 'level', 'typeIds']);
  const equipIds = new Set(equipment.map((e) => e.id));
  let summaryMismatches = 0;
  const setsOut = sets
    .filter((s) => !s.isCosmetic)
    .map((s) => {
      const items = (s.items ?? []).map((i) => (typeof i === 'object' ? i.id : i)).sort((a, b) => a - b);
      const bonuses = {};
      const raw = Array.isArray(s.possibleEffects) && s.possibleEffects.length ? s.possibleEffects : null;
      (raw ?? s.effects ?? []).forEach((list, idx) => {
        if (!Array.isArray(list) || !list.length) return;
        bonuses[idx + 1] = raw
          ? list.map(normItemEffect)
          : // repli (possibleEffects absent) : résumé DofusDB, valeur absolue pour retrouver la convention des objets
            list.map((e) => normItemEffect({ effectId: e.effectId, diceNum: Math.abs(e.from ?? 0), diceSide: Math.abs(e.to ?? 0) }));
        const sum = (s.effects ?? [])[idx] ?? [];
        const a = bonuses[idx + 1].map((e) => `${e.effectId}:${e.diceNum}`).join(',');
        const b = sum.map((e) => `${e.effectId}:${Math.abs(e.from ?? 0)}`).join(',');
        if (raw && a !== b) summaryMismatches++;
      });
      return compact({
        id: s.id,
        name: loc(s.name),
        level: s.level,
        bonusIsSecret: s.bonusIsSecret || undefined,
        items,
        itemsNotInEquipment: items.filter((i) => !equipIds.has(i)).length ? items.filter((i) => !equipIds.has(i)) : undefined,
        bonusesByItemCount: bonuses,
      });
    })
    .sort(byId);
  if (summaryMismatches) log(`  item-sets : ${summaryMismatches} paliers où le résumé DofusDB 'effects' diffère de possibleEffects (possibleEffects retenu)`);
  await writeOut('item-sets.json', setsOut);
  return { equipment, setsOut, setsTotal: sets.length, setSummaryMismatches: summaryMismatches };
}

const MONSTER_SELECT = [
  'id', 'name', 'race', 'grades', 'spells', 'spellGrades', 'isBoss', 'isMiniBoss', 'isQuestMonster', 'canPlay', 'canTackle',
  'canBePushed', 'canSwitchPos', 'canSwitchPosOnTarget', 'canBeCarried', 'canUsePortal', 'useSummonSlot', 'useBombSlot',
  'summonCost', 'tags', 'characRatios', 'scaleGradeRef', 'subareas', 'favoriteSubareaId', 'correspondingMiniBossId', 'gfxId',
  'useRaceValues', 'soulCaptureForbidden', 'allIdolsDisabled', 'incompatibleIdols', 'incompatibleChallenges', 'speedAdjust',
  'aggressiveZoneSize', 'aggressiveLevelDiff', 'hideInBestiary', 'isBounty', 'creatureBoneId', 'fastAnimsFun',
];

async function stepMonsters() {
  log('== Monstres (tous), races');
  const monsters = await fetchAll('monsters', [], MONSTER_SELECT);
  const monstersById = new Map(monsters.map((m) => [m.id, m]));
  // Schéma des grades bruts (3.6 / 3.7 / inconnu) et clés que la normalisation ignore : journalisés et inscrits dans
  // manifest.json, pour qu'un nouveau renommage de l'API se voie au lieu de vider des champs en silence.
  const gradeSummary = summarizeGradeSchemas(monsters);
  log(`  schémas des grades : ${JSON.stringify(gradeSummary.gradeSchemas)}`);
  if (Object.keys(gradeSummary.unknownKeys).length) {
    log(`  ATTENTION : clés de grade inconnues, ignorées par la normalisation : ${JSON.stringify(gradeSummary.unknownKeys)}`);
  }
  const out = monsters.map((m) =>
    compact({
      id: m.id,
      name: loc(m.name),
      race: m.race,
      gfxId: m.gfxId,
      isBoss: m.isBoss,
      isMiniBoss: m.isMiniBoss,
      isQuestMonster: m.isQuestMonster || undefined,
      canPlay: m.canPlay,
      canTackle: m.canTackle,
      canBePushed: m.canBePushed,
      canSwitchPos: m.canSwitchPos,
      canSwitchPosOnTarget: m.canSwitchPosOnTarget,
      canBeCarried: m.canBeCarried,
      canUsePortal: m.canUsePortal,
      useSummonSlot: m.useSummonSlot,
      useBombSlot: m.useBombSlot,
      summonCost: m.summonCost,
      speedAdjust: m.speedAdjust || undefined,
      tags: m.tags?.length ? m.tags : undefined,
      spells: m.spells ?? [],
      spellGrades: (m.spellGrades ?? []).map(parseSpellGrades),
      grades: (m.grades ?? []).map(normGrade),
      characRatios: m.characRatios?.length ? m.characRatios.map((p) => p.map(round6)) : undefined,
      scaleGradeRef: m.scaleGradeRef,
      useRaceValues: m.useRaceValues || undefined,
      subareas: m.subareas?.length ? m.subareas : undefined,
      favoriteSubareaId: m.favoriteSubareaId || undefined,
      correspondingMiniBossId: m.correspondingMiniBossId || undefined,
      soulCaptureForbidden: m.soulCaptureForbidden || undefined,
      allIdolsDisabled: m.allIdolsDisabled || undefined,
      incompatibleIdols: m.incompatibleIdols?.length ? m.incompatibleIdols : undefined,
      incompatibleChallenges: m.incompatibleChallenges?.length ? m.incompatibleChallenges : undefined,
      hideInBestiary: m.hideInBestiary || undefined,
    }),
  );
  // Garde-fou : refuse (avant écriture) un boss dont un grade a perdu ses résistances.
  assertBossResistances(out);
  if (!out.some((m) => m.tags)) {
    log("  ATTENTION : aucun monstre n'a de tags (constaté sur /monsters/<id> en 3.7 pour Vortex, Kimbo et Merkator) ; l'IA s'en sert (archetype.ts : 'summon').");
  }
  await writeOut('monsters.json', out);

  const races = await fetchAll('monster-races');
  const superRaces = await fetchAll('monster-super-races');
  await writeOut(
    'monster-races.json',
    {
      superRaces: superRaces.map((r) => ({ id: r.id, name: loc(r.name) })),
      races: races.map((r) => compact({ id: r.id, name: loc(r.name), superRaceId: r.superRaceId, monsters: r.monsters ?? [] })),
    },
    { count: races.length },
  );
  return { monsters, monstersById, monstersOut: out, gradeSummary };
}

async function stepClassSpells({ breedOut, rolesOut, variants, monstersById }) {
  log('== Sorts de classes (2 variantes x 22 paires x 19 classes) + sorts liés + invocations');
  const classSpellIds = new Set();
  const spellInfo = new Map(); // spellId -> {breedId, variantId, pairIndex, variant}
  const variantById = new Map(variants.map((v) => [v.id, v]));
  for (const b of breedOut) {
    b.spellPairs.forEach((pair, pairIndex) => {
      pair.forEach((sid, variant) => {
        if (sid == null) return;
        classSpellIds.add(sid);
        spellInfo.set(sid, { breedId: b.id, variantId: b.spellVariantIds[pairIndex], pairIndex, variant });
      });
    });
  }
  const closure = await spellClosure({ seedSpells: [...classSpellIds], monstersById, label: 'classes' });
  const normalize = (s) => normSpell(s, closure.levels);
  const classSpells = [...classSpellIds]
    .map((id) => closure.spells.get(id))
    .filter(Boolean)
    .map((s) => ({ ...spellInfo.get(s.id), ...normalize(s) }))
    .sort((a, b) => a.breedId - b.breedId || a.pairIndex - b.pairIndex || a.variant - b.variant);
  const linked = [...closure.spells.values()]
    .filter((s) => !classSpellIds.has(s.id))
    .map((s) => compact({ ...normalize(s), viaMonster: closure.viaMonster.get(s.id) }))
    .sort(byId);
  // Ordre de déblocage : niveau minimal du grade 1 de chaque variante
  const unlock = new Map(classSpells.map((s) => [s.id, s.levels[0]?.minPlayerLevel ?? null]));
  for (const b of breedOut) b.spellPairUnlockLevels = b.spellPairs.map((p) => p.map((sid) => (sid == null ? null : unlock.get(sid) ?? null)));
  for (const b of breedOut) b.spellPairNames = b.spellPairs.map((p) => p.map((sid) => classSpells.find((s) => s.id === sid)?.name?.fr ?? null));

  await writeOut(
    'breeds.json',
    { roles: rolesOut, breeds: breedOut, unassignedSpellVariants: variants.filter((v) => !breedOut.some((b) => b.id === v.breedId)).map((v) => ({ id: v.id, breedId: v.breedId, spellIds: v.spellIds })) },
    { pretty: false, count: breedOut.length },
  );
  const summoned = [...closure.reachedMonsters].sort((a, b) => a - b);
  const classFile = {
    note: "spells = sorts de classe (breedId, pairIndex = index de la paire dans breeds[].spellPairs, variant 0 = sort de breedSpellsId / 1 = variante). linkedSpells = sorts non-classe atteints par références d'effets (lancer de sort, glyphe, piège, rune, modificateurs) ou utilisés par les invocations (summonedMonsters, détaillés dans monsters.json). Champs d'effet absents = valeur de effectDefaults. zone = '<forme><param1>,<param2>,<damageDecreaseStepPercent>,<maxDamageDecreaseApplyCount>', zoneFlags: c=includeCarried s=isStopAtTarget d=forcedDirection v=onlyAffectIfInSightLine.",
    effectDefaults: EFFECT_DEFAULTS,
    summonedMonsters: summoned,
    missingSpellIds: [...closure.missingSpells].sort((a, b) => a - b),
    missingSpellLevelIds: [...closure.missingSpellLevels].sort((a, b) => a - b),
    startingSpellLevels: closure.startingSpellLevels,
    spells: classSpells,
    linkedSpells: linked,
  };
  await writeOut('class-spells.json', classFile, { count: classSpells.length });
  return { classSpells, linked, closure, classSpellIds };
}

/** Sorts portés par des équipements (effet 1175 des Dofus/Trophées/objets légendaires, etc.). */
async function stepItemSpells({ equipment, sets = [], monstersById, classSpellsKnown, classMonstersKnown }) {
  log('== Sorts portés par les équipements (Dofus, légendaires…) et les panoplies');
  const itemsBySpell = {};
  const setsBySpell = {};
  const modifiedSpells = {}; // sort de classe -> objets qui le modifient (effets catégorie 3, panoplies de classe)
  const seeds = new Set();
  for (const it of equipment) {
    for (const e of it.possibleEffects) {
      if (SPELL_MODIFIER_EFFECTS.has(e.effectId)) {
        if (e.diceNum > 0) (modifiedSpells[e.diceNum] ??= new Set()).add(it.id);
        continue;
      }
      for (const sid of effectListRefs([e]).spells) {
        seeds.add(sid);
        if (!(itemsBySpell[sid] ??= []).includes(it.id)) itemsBySpell[sid].push(it.id);
      }
    }
  }
  // Bonus de panoplie qui donnent un sort (722, ex. Panoplie du Vampyre maudit) ; modificateurs de sort éventuels.
  for (const s of sets) {
    for (const list of Object.values(s.bonusesByItemCount ?? {})) {
      for (const e of list) {
        if (SPELL_MODIFIER_EFFECTS.has(e.effectId)) continue;
        for (const sid of effectListRefs([e]).spells) {
          seeds.add(sid);
          if (!(setsBySpell[sid] ??= []).includes(s.id)) setsBySpell[sid].push(s.id);
        }
      }
    }
  }
  const closure = await spellClosure({ seedSpells: [...seeds], monstersById, label: 'objets', knownSpells: classSpellsKnown, knownMonsters: classMonstersKnown });
  const spellsOut = [...closure.spells.values()]
    .map((s) => compact({ ...normSpell(s, closure.levels), itemIds: itemsBySpell[s.id], itemSetIds: setsBySpell[s.id], viaMonster: closure.viaMonster.get(s.id) }))
    .sort(byId);
  await writeOut(
    'item-spells.json',
    {
      note: "Sorts référencés par les effets d'équipements (effet 1175 '#1' : diceNum = sort, diceSide = grade, ex. Dofus Pourpre -> sort 8395 ; effet 722 'Ajouter un sort temporaire' : value = sort, diceSide = grade, ex. armes/Dofus donnant un sort) et des bonus de panoplie (722, ex. Panoplie du Vampyre maudit), et leur fermeture transitive, HORS sorts/invocations déjà présents dans class-spells.json. itemIds = objets portant directement ce sort ; itemSetIds = panoplies dont un bonus donne ce sort. classSpellModifiers = sort de classe -> objets dont un effet de catégorie 3 le modifie (bonus de panoplie de classe : +PO, -PA, relance…). Champs d'effet absents = effectDefaults.",
      effectDefaults: EFFECT_DEFAULTS,
      classSpellModifiers: Object.fromEntries(Object.entries(modifiedSpells).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
      summonedMonsters: [...closure.reachedMonsters].sort((a, b) => a - b),
      missingSpellIds: [...closure.missingSpells].sort((a, b) => a - b),
      spells: spellsOut,
    },
    { count: spellsOut.length },
  );
  return { closure, spellsOut };
}

async function stepDungeons() {
  log('== Donjons, sous-zones, cartes, succès');
  const dungeons = await fetchAll('dungeons');
  const subareaIds = uniq(dungeons.map((d) => d.subarea).filter(Boolean));
  const subareas = await fetchByIds('subareas', subareaIds, ['id', 'name', 'areaId', 'mapIds', 'level', 'monsters', 'dungeonId', 'associatedZaapMapId']);
  const achievementIds = uniq(dungeons.flatMap((d) => d.achievements ?? []));
  const achievements = await fetchByIds('achievements', achievementIds, ['id', 'name', 'description', 'points', 'level', 'objectiveIds', 'categoryId']);
  const dungeonsOut = dungeons
    .map((d) => {
      const sa = subareas.get(d.subarea);
      return compact({
        id: d.id,
        name: loc(d.name),
        optimalPlayerLevel: d.optimalPlayerLevel,
        minLevel: d.minLevel,
        difficulty: d.difficulty,
        mapIds: d.mapIds ?? [],
        entranceMapId: d.entranceMapId,
        exitMapId: d.exitMapId,
        monsters: d.monsters ?? [],
        bosses: d.bosses ?? [],
        requiredObjects: d.requiredObjects?.length ? d.requiredObjects : undefined,
        availableInAutomaticGroupSearch: d.availableInAutomaticGroupSearch,
        availableInLobby: d.availableInLobby,
        availableOnKeyring: d.availableOnKeyring,
        subarea: sa
          ? { id: sa.id, name: loc(sa.name), areaId: sa.areaId, level: sa.level, mapIds: sa.mapIds ?? [], monsters: sa.monsters ?? [] }
          : d.subarea ? { id: d.subarea } : undefined,
        achievements: (d.achievements ?? []).map((id) => {
          const a = achievements.get(id);
          if (!a) return { id };
          const ch = /\[challenge,(\d+)\]/.exec(a.description?.fr ?? '');
          return compact({ id, name: loc(a.name), description: loc(a.description), points: a.points, challengeId: ch ? Number(ch[1]) : undefined });
        }),
      });
    })
    .sort(byId);
  await writeOut('dungeons.json', dungeonsOut);

  // Cartes : mapIds du donjon (salles de combat), entrée/sortie, et toutes les cartes de la sous-zone
  const role = new Map(); // mapId -> {dungeonIds:Set, roles:Set}
  const add = (mapId, dungeonId, r) => {
    if (!mapId) return;
    if (!role.has(mapId)) role.set(mapId, { dungeonIds: new Set(), roles: new Set() });
    role.get(mapId).dungeonIds.add(dungeonId);
    role.get(mapId).roles.add(r);
  };
  for (const d of dungeonsOut) {
    d.mapIds.forEach((m) => add(m, d.id, 'room'));
    add(d.entranceMapId, d.id, 'entrance');
    add(d.exitMapId, d.id, 'exit');
    (d.subarea?.mapIds ?? []).forEach((m) => add(m, d.id, 'subarea'));
  }
  const maps = await fetchByIds('map-positions', [...role.keys()], [
    'id', 'name', 'posX', 'posY', 'subAreaId', 'worldMap', 'outdoor', 'tacticalModeTemplateId', 'mapHasTemplate', 'isTransition',
    'capabilityAllowChallenge', 'capabilityAllowMonsterFight', 'capabilityAllowTombMode',
  ]);
  const mapsOut = [...role.entries()]
    .map(([id, r]) => {
      const m = maps.get(id);
      const roomIndex = dungeonsOut.filter((d) => r.dungeonIds.has(d.id)).map((d) => d.mapIds.indexOf(id)).find((i) => i >= 0);
      return compact({
        id,
        name: loc(m?.name),
        posX: m?.posX,
        posY: m?.posY,
        subAreaId: m?.subAreaId,
        worldMap: m?.worldMap,
        outdoor: m?.outdoor,
        tacticalModeTemplateId: m?.tacticalModeTemplateId || undefined,
        hasTemplate: m?.mapHasTemplate,
        isTransition: m?.isTransition || undefined,
        allowChallenge: m?.capabilityAllowChallenge,
        allowMonsterFight: m?.capabilityAllowMonsterFight,
        dungeonIds: [...r.dungeonIds].sort((a, b) => a - b),
        roles: [...r.roles].sort(),
        roomIndex: roomIndex ?? undefined,
        notInApi: m ? undefined : true,
        imageUrl: m ? `${API}/img/maps/1/${id}.jpg` : undefined,
      });
    })
    .sort(byId);
  await writeOut('dungeon-maps.json', mapsOut);
  return { dungeons, dungeonsOut, mapsOut };
}

async function stepMonsterSpells({ dungeonsOut, monstersById }) {
  const scopes = MONSTER_SPELLS_SCOPE === 'vortex' ? ['vortex'] : ['all', 'vortex'];
  for (const scope of scopes) {
    const ds = scope === 'all' ? dungeonsOut : dungeonsOut.filter((d) => d.id === VORTEX_DUNGEON_ID);
    log(`== Sorts de monstres (périmètre: ${scope}, ${ds.length} donjons)`);
    const seeds = uniq(ds.flatMap((d) => [...d.monsters, ...d.bosses])).sort((a, b) => a - b);
    const closure = await spellClosure({ seedMonsters: seeds, monstersById, label: `monstres:${scope}` });
    const spellsOut = [...closure.spells.values()].map((s) => compact({ ...normSpell(s, closure.levels), viaMonster: closure.viaMonster.get(s.id) })).sort(byId);
    const file = {
      note: `Sorts (tous niveaux) des monstres de ${scope === 'all' ? 'TOUS les donjons (dungeons.json monsters+bosses)' : 'du donjon 87 (Œil de Vortex)'} + sorts référencés (lancers, glyphes, pièges…) + invocations, en fermeture transitive (profondeur max ${MAX_DEPTH}). monsters[].spellGrades[i][g-1] donne le grade du sort monsters[].spells[i] pour le grade g du monstre. startingSpellLevels: id de spell-level (grades[].startingSpellId) -> spellId. Champs d'effet absents = effectDefaults.`,
      scope,
      dungeonIds: ds.map((d) => d.id),
      effectDefaults: EFFECT_DEFAULTS,
      seedMonsters: seeds,
      reachedMonsters: [...closure.reachedMonsters].sort((a, b) => a - b),
      missingMonsterIds: [...closure.missingMonsters].sort((a, b) => a - b),
      missingSpellIds: [...closure.missingSpells].sort((a, b) => a - b),
      missingSpellLevelIds: [...closure.missingSpellLevels].sort((a, b) => a - b),
      startingSpellLevels: closure.startingSpellLevels,
      spells: spellsOut,
    };
    const size = Buffer.byteLength(serialize(file));
    if (scope === 'all' && size > MONSTER_SPELLS_MAX_BYTES) {
      log(`  ! monster-spells (all) = ${(size / 1048576).toFixed(1)} Mo > 40 Mo : repli sur le périmètre Vortex`);
      continue;
    }
    await writeOut('monster-spells.json', file, { count: spellsOut.length });
    return { closure, file };
  }
}

async function stepStates(referenced) {
  log('== États (spell-states)');
  const states = await fetchAll('spell-states');
  const FLAG_KEYS = [
    'preventsSpellCast', 'preventsFight', 'isSilent', 'cantBeMoved', 'cantBePushed', 'cantDealDamage', 'invulnerable',
    'cantSwitchPosition', 'incurable', 'invulnerableMelee', 'invulnerableRange', 'cantTackle', 'cantBeTackled',
    'displayTurnRemaining', 'isMainState',
  ];
  const norm = (s) => {
    const o = { id: s.id, name: loc(s.name) };
    for (const k of FLAG_KEYS) if (s[k]) o[k] = true;
    if (s.effectsIds?.length) o.effectsIds = s.effectsIds;
    if (s.iconVisibilityMask) o.iconVisibilityMask = s.iconVisibilityMask;
    if (referenced.has(s.id)) o.referenced = true;
    return o;
  };
  let out = states.map(norm);
  let scope = 'all';
  if (Buffer.byteLength(serialize(out)) > 3 * 1024 * 1024) {
    out = out.filter((s) => s.referenced);
    scope = 'referenced';
  }
  const file = {
    note: "Booléens absents = false. referenced = état cité par un sort de classe/lié ou de monstre (effets 950/951/952 'value', ou statesCriterion).",
    scope,
    totalInApi: states.length,
    flagKeys: FLAG_KEYS,
    states: out,
  };
  await writeOut('spell-states.json', file, { count: out.length });
  return { total: states.length, written: out.length, scope };
}

async function stepChallengesAndVortexAchievements() {
  log('== Challenges, succès Vortex');
  const challenges = await fetchAll('challenges');
  const chOut = challenges.map((c) =>
    compact({
      id: c.id,
      name: loc(c.name),
      description: loc(c.description),
      categoryId: c.categoryId,
      iconId: c.iconId,
      completionCriterion: c.completionCriterion || undefined,
      activationCriterion: c.activationCriterion || undefined,
      targetMonsterId: c.targetMonsterId || undefined,
      incompatibleChallenges: c.incompatibleChallenges?.length ? c.incompatibleChallenges : undefined,
    }),
  );
  await writeOut('challenges.json', chOut);

  const achs = await fetchByIds('achievements', VORTEX_ACHIEVEMENTS);
  const objectiveIds = [...achs.values()].flatMap((a) => a.objectiveIds ?? []);
  const objectives = await fetchByIds('achievement-objectives', objectiveIds);
  const simplify = (x) => {
    if (Array.isArray(x)) return x.map(simplify);
    if (x && typeof x === 'object') return compact({ id: x.id, name: x.name ? loc(x.name)?.fr : undefined });
    return x;
  };
  const challengeIds = [];
  const achOut = VORTEX_ACHIEVEMENTS.map((id) => achs.get(id))
    .filter(Boolean)
    .map((a) => {
      const objs = (a.objectiveIds ?? []).map((oid) => objectives.get(oid) ?? (a.objectives ?? []).find((o) => o.id === oid)).filter(Boolean);
      const chMatch = /\[challenge,(\d+)\]/.exec(a.description?.fr ?? '');
      const challengeId = chMatch ? Number(chMatch[1]) : undefined;
      if (challengeId) challengeIds.push(challengeId);
      for (const o of objs) for (const m of String(o.criterion ?? '').matchAll(/EH>(\d+)/g)) challengeIds.push(Number(m[1]));
      return compact({
        id: a.id,
        name: loc(a.name),
        description: loc(a.description),
        points: a.points,
        level: a.level,
        categoryId: a.categoryId,
        challengeId,
        objectives: objs.map((o) =>
          compact({ id: o.id, order: o.order, criterion: o.criterion, name: loc(o.name), readableCriterion: o.readableCriterion ? simplify(o.readableCriterion) : undefined }),
        ),
        rewardIds: a.rewardIds,
      });
    });
  const chById = new Map(chOut.map((c) => [c.id, c]));
  await writeOut(
    'achievements-vortex.json',
    {
      dungeonId: VORTEX_DUNGEON_ID,
      note: "Succès du donjon 87 (Œil de Vortex). Critères : EM>monstre,0,d = avoir tué le monstre en donjon ; EH>challenge,0 = avoir réussi le challenge ; PL>189 = niveau > 189.",
      achievements: achOut,
      challenges: uniq(challengeIds).map((id) => chById.get(id) ?? { id }),
    },
    { pretty: true, count: achOut.length },
  );
}

// ------------------------------------------------------------------------------------
// Programme principal
// ------------------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();
  log(`DofusDB -> ${path.relative(ROOT, OUT_DIR)} (API ${API}, concurrence ${CONCURRENCY}, cache ${REFRESH ? 'ignoré' : 'utilisé'})`);
  const ref = await stepReferenceTables();
  const typesById = new Map(ref.types.map((t) => [t.id, t]));
  const breeds = await stepBreeds();
  const monsters = await stepMonsters();
  const cls = await stepClassSpells({ ...breeds, monstersById: monsters.monstersById });
  const eq = await stepEquipment(typesById);
  const its = await stepItemSpells({
    equipment: eq.equipment,
    sets: eq.setsOut,
    monstersById: monsters.monstersById,
    classSpellsKnown: new Set(cls.closure.spells.keys()),
    classMonstersKnown: cls.closure.reachedMonsters,
  });
  const dun = await stepDungeons();
  const ms = await stepMonsterSpells({ dungeonsOut: dun.dungeonsOut, monstersById: monsters.monstersById });
  const referencedStates = new Set([...cls.closure.states, ...ms.closure.states, ...its.closure.states]);
  const st = await stepStates(referencedStates);
  await stepChallengesAndVortexAchievements();

  // Contrôles de cohérence
  const checks = {};
  const iop = breeds.breedOut.find((b) => b.id === 8);
  checks.iopSpellCount = cls.classSpells.filter((s) => s.breedId === 8).length;
  checks.iopPairs = iop?.spellPairs.length;
  checks.classSpellCount = cls.classSpells.length;
  checks.breedCount = breeds.breedOut.length;
  checks.equipmentCount = eq.equipment.length;
  checks.vortexBossGrades = monsters.monstersOut.find((m) => m.id === 3835)?.grades.map((g) => [g.grade, g.level, g.lifePoints, g.actionPoints, g.movementPoints]);
  // Résistances % (N/T/F/E/A) et esquives PA/PM du Vortex au grade 5 : 3.6 = [6,33,12,21,28,0,20], 3.7 = esquive PA −24.
  const vortexG5 = monsters.monstersOut.find((m) => m.id === 3835)?.grades.find((g) => g.grade === 5);
  checks.vortexBossResPctAndDodge = vortexG5 && [vortexG5.neutralResistance, vortexG5.earthResistance, vortexG5.fireResistance, vortexG5.waterResistance, vortexG5.airResistance, vortexG5.paDodge, vortexG5.pmDodge];
  checks.vortexSpellsPresent = [5068, 5070, 5062, 5066, 5064].every((id) => ms.file.spells.some((s) => s.id === id));
  log('== Contrôles', JSON.stringify(checks));

  const manifest = {
    generatedBy: 'scripts/fetch-dofusdb.mjs',
    fetchedAt: new Date().toISOString(),
    api: API,
    game: {
      ...gameVersionInfo(monsters.gradeSummary.gradeSchemas, GAME_VERSION),
      gradeSchemas: monsters.gradeSummary.gradeSchemas,
      unknownGradeKeys: monsters.gradeSummary.unknownKeys,
    },
    sourceServices: [...sourceUrls].sort(),
    options: { monsterSpellsScope: ms.file.scope, maxDepth: MAX_DEPTH, pageSize: PAGE_SIZE },
    files: Object.fromEntries(written.map((w) => [w.file, { bytes: w.bytes, count: w.count }])),
    totalBytes: written.reduce((a, w) => a + w.bytes, 0),
    counts: {
      breeds: breeds.breedOut.length,
      classSpells: cls.classSpells.length,
      classLinkedSpells: cls.linked.length,
      classSummonedMonsters: cls.closure.reachedMonsters.size,
      equipment: eq.equipment.length,
      itemSets: eq.setsOut.length,
      itemSetsTotalInApi: eq.setsTotal,
      itemSetSummaryMismatches: eq.setSummaryMismatches,
      monsters: monsters.monstersOut.length,
      dungeons: dun.dungeonsOut.length,
      dungeonMaps: dun.mapsOut.length,
      monsterSpells: ms.file.spells.length,
      itemSpells: its.spellsOut.length,
      spellStatesWritten: st.written,
      spellStatesInApi: st.total,
    },
    effectDefaults: EFFECT_DEFAULTS,
    spellRefEffects: {
      diceNumIsSpell: [...SPELL_REF_DICENUM_EFFECTS].sort((a, b) => a - b),
      spellModifiers: [...SPELL_MODIFIER_EFFECTS].sort((a, b) => a - b),
      diceSideIsSpell: [...SPELL_REF_DICESIDE_EFFECTS].sort((a, b) => a - b),
      valueIsSpell: [...SPELL_REF_VALUE_EFFECTS].sort((a, b) => a - b),
      diceSideIsSpellLevel: [...SPELL_LEVEL_REF_DICESIDE_EFFECTS],
      summonDiceNumIsMonster: [...SUMMON_EFFECTS],
      stateValueIsState: [...STATE_EFFECTS],
      notes:
        "diceNumIsSpell : diceNum = sort, diceSide = grade (modificateurs : value = valeur). valueIsSpell : value = sort ; pour 722/2997 et 1406, diceSide = grade/rang. 406/1406 étaient classés à tort en diceSideIsSpell avant la vérification du 2026-10-04 (diceSide de 1406 = rang 1..6, de 406 = 0). diceSideIsSpellLevel : diceSide = id de spell-levels. summonDiceNumIsMonster : diceNum = monstre, diceSide = grade. stateValueIsState : value = état.",
    },
    equipmentTypes: EQUIPMENT_TYPES,
    checks,
    http: { ...stats, seconds: Math.round((Date.now() - t0) / 1000) },
  };
  await writeOut('manifest.json', manifest, { pretty: true });
  log(`Terminé en ${manifest.http.seconds} s — ${stats.requests} requêtes HTTP, ${stats.cacheHits} lectures cache, ${stats.retries} retries.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
