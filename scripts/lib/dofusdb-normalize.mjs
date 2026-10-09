// =====================================================================================
// DofusSimu — normalisation des grades de monstres DofusDB, schémas 3.6 ET 3.7
//
// Le 2026-10-07, l'API DofusDB (https://api.dofusdb.fr/monsters/<id>) a changé le nom des champs des grades
// après la mise à jour 3.7 du jeu : `neutralResistance…` → `reductionNeutral…`, `paDodge`/`pmDodge` →
// `paLostDodge`/`mpLostDodge`, `bonusRange` → `rangeBonus`, `gradeXp` → `xp`, plus de nouveaux champs
// (résistances fixes `reduction*Flat`, `criticalDamageReduction`, `pushDamageReduction`, `initiativeBonus`,
// `tackleBonus`, `tackleEvade`, bonus de dommages…). L'ancienne normalisation lisait les noms 3.6 et `compact()`
// supprimait les clés absentes : une nouvelle extraction aurait perdu les résistances SANS ERREUR.
//
// Ce module produit le format de data/dofusdb/monsters.json (clés historiques 3.6, cf. src/data/raw.ts
// RawMonsterGrade) à partir des deux schémas :
// - champs existants : mêmes clés et même ordre qu'avant, toujours écrits (même à 0) ;
// - nouveaux champs : écrits seulement s'ils sont non nuls (taille du fichier), sous les noms de RENAMED_37 ;
// - `bonusCharacteristics` : mêmes renommages, valeurs nulles retirées.
// Il est idempotent : renormaliser un grade déjà normalisé le rend à l'identique.
//
// Garde-fou : `assertBossResistances` refuse une extraction où un boss a un grade sans ses 5 résistances en %, où le
// boss témoin (Vortex 3835) manque ou n'est plus `isBoss`, ou sans aucun boss (champ `isBoss` renommé : sans cela, le
// contrôle des résistances ne vérifierait plus rien). Sens de `paLostDodge` (même grandeur que `paDodge`, esquive PA
// finale ramenée à ⌈70 %⌉ par la 3.7) et procédure de ré-extraction : docs/research/dofusdb-api.md §10.
// Fixtures : tests/fixtures/dofusdb-3.7/ (et l'extrait 3.6 figé tests/fixtures/dofusdb-3.6/). Tests :
// tests/data-fetch-schema.test.ts (module), tests/data-fetch-script.test.ts (script complet, faux serveur local).
// Aucune dépendance (importé par scripts/fetch-dofusdb.mjs, types dans dofusdb-normalize.d.mts).
// =====================================================================================

/** Les 5 résistances en % d'un grade normalisé (neutre, terre, feu, eau, air). */
export const RESISTANCE_FIELDS = ['neutralResistance', 'earthResistance', 'fireResistance', 'waterResistance', 'airResistance'];

/**
 * Clé du schéma 3.7 → clé normalisée. Sert aux grades ET à `bonusCharacteristics` (mêmes noms dans l'API).
 * Les champs qui existaient en 3.6 reprennent leur nom 3.6 ; les nouveaux prennent le nom déjà employé par
 * `bonusCharacteristics` en 3.6 (`tackleBlock`, `bonus<Élément>Damage`) ou, à défaut, un nom calqué sur l'existant
 * (`<élément>ResistanceFlat`). Les autres clés 3.7 gardent leur nom d'API : `criticalDamageReduction`,
 * `pushDamageReduction` (aussi mots-clés de characteristics.json, ids 87 et 85), `initiativeBonus` (mot-clé
 * `initiative` dans characteristics.json, id 44), `percentDamageBonus`…
 */
export const RENAMED_37 = {
  reductionNeutral: 'neutralResistance',
  reductionEarth: 'earthResistance',
  reductionFire: 'fireResistance',
  reductionWater: 'waterResistance',
  reductionAir: 'airResistance',
  // Même grandeur, valeur changée par la 3.7 : bonus fixe ajouté à Sagesse/10 ; la 3.7 y inscrit la baisse de 30 %
  // de l'esquive PA finale (⌈0,7 × (Sagesse/10 + paDodge 3.6)⌉, §10.2).
  paLostDodge: 'paDodge',
  mpLostDodge: 'pmDodge',
  rangeBonus: 'bonusRange',
  xp: 'gradeXp',
  reductionNeutralFlat: 'neutralResistanceFlat',
  reductionEarthFlat: 'earthResistanceFlat',
  reductionFireFlat: 'fireResistanceFlat',
  reductionWaterFlat: 'waterResistanceFlat',
  reductionAirFlat: 'airResistanceFlat',
  tackleBonus: 'tackleBlock',
  neutralDamageBonus: 'bonusNeutralDamage',
  earthDamageBonus: 'bonusEarthDamage',
  fireDamageBonus: 'bonusFireDamage',
  waterDamageBonus: 'bonusWaterDamage',
  airDamageBonus: 'bonusAirDamage',
};

/** Clé normalisée → clé 3.7 (inverse de RENAMED_37). */
const API_NAME_37 = Object.fromEntries(Object.entries(RENAMED_37).map(([api, norm]) => [norm, api]));

/**
 * Champs facultatifs (schéma 3.7 seulement), écrits dans cet ordre quand ils sont non nuls. Tous sont convertis en
 * caractéristiques par src/data/convert.ts (GRADE_STAT_FIELDS_37) sauf `maxSummon` (le moteur lit `stats.summons` dans
 * les masques de cible) ; `percentDamageBonus` → Puissance (déduit, §10.1).
 */
export const OPTIONAL_GRADE_FIELDS = [
  'neutralResistanceFlat', 'earthResistanceFlat', 'fireResistanceFlat', 'waterResistanceFlat', 'airResistanceFlat',
  'criticalDamageReduction', 'pushDamageReduction',
  'tackleBlock', 'tackleEvade', 'initiativeBonus',
  'damageBonus', 'percentDamageBonus',
  'bonusNeutralDamage', 'bonusEarthDamage', 'bonusFireDamage', 'bonusWaterDamage', 'bonusAirDamage',
  'criticalHitBonus', 'criticalDamageBonus', 'pushDamageBonus', 'healBonus', 'trapDamageBonus', 'trapDamageBonusPercent',
  'apAttack', 'mpAttack', 'maxSummon',
];

/** Clés 3.7 volontairement ignorées : `monsterId` (redondant), `honoursPoints` (points d'honneur, JcJ). */
export const IGNORED_GRADE_KEYS = ['monsterId', 'honoursPoints'];

/** Clés connues d'un grade brut 3.6 (celles que lisait l'ancienne normalisation, + `monsterId`). */
const KNOWN_KEYS_36 = [
  'grade', 'monsterId', 'level', 'lifePoints', 'actionPoints', 'movementPoints', 'vitality', 'wisdom', 'strength',
  'intelligence', 'chance', 'agility', ...RESISTANCE_FIELDS, 'paDodge', 'pmDodge', 'damageReflect', 'bonusRange',
  'gradeXp', 'startingSpellId', 'hiddenLevel', 'bonusCharacteristics',
];
const KNOWN_GRADE_KEYS = new Set([...KNOWN_KEYS_36, ...Object.keys(RENAMED_37), ...OPTIONAL_GRADE_FIELDS, ...IGNORED_GRADE_KEYS]);
/** Clés propres à `bonusCharacteristics` (retraits PA/PM : `aPRemoval` en 3.6 et 3.7, `mPRemoval` selon la doc API). */
const KNOWN_BONUS_ONLY_KEYS = new Set(['aPRemoval', 'mPRemoval']);

/** Supprime les clés dont la valeur est undefined. */
function compact(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** Valeur d'un champ sous son nom normalisé, à défaut sous son nom 3.7 (si les deux existent, le nom normalisé gagne). */
function readField(g, key) {
  if (g[key] !== undefined) return g[key];
  const api = API_NAME_37[key];
  return api === undefined ? undefined : g[api];
}

/**
 * Schéma d'un grade BRUT de l'API, d'après ses clés de résistance : '3.6' (`neutralResistance…`), '3.7'
 * (`reductionNeutral…`) ou 'inconnu' (ni l'un ni l'autre : nouveau renommage à traiter).
 */
export function apiGradeSchema(g) {
  if (RESISTANCE_FIELDS.some((k) => k in g)) return '3.6';
  if (RESISTANCE_FIELDS.some((k) => API_NAME_37[k] in g)) return '3.7';
  return 'inconnu';
}

/** `bonusCharacteristics` (part en % des caractéristiques de l'invocateur) : clés renommées, valeurs nulles retirées. */
export function normBonusCharacteristics(b) {
  const out = {};
  for (const [k, v] of Object.entries(b ?? {})) {
    if (!v || IGNORED_GRADE_KEYS.includes(k)) continue;
    const renamed = RENAMED_37[k];
    if (renamed === undefined) out[k] = v; // nom normalisé (ou inchangé en 3.7) : prioritaire
    else if (!(renamed in out)) out[renamed] = v; // nom 3.7 : seulement si l'ancien nom est absent
  }
  return Object.keys(out).length ? out : undefined;
}

/** Grade de monstre normalisé (format de data/dofusdb/monsters.json), depuis un grade 3.6 ou 3.7. */
export function normGrade(g) {
  const v = (k) => readField(g, k);
  const out = compact({
    grade: g.grade,
    level: g.level,
    lifePoints: g.lifePoints,
    actionPoints: g.actionPoints,
    movementPoints: g.movementPoints,
    vitality: v('vitality'),
    wisdom: v('wisdom'),
    strength: v('strength'),
    intelligence: v('intelligence'),
    chance: v('chance'),
    agility: v('agility'),
    neutralResistance: v('neutralResistance'),
    earthResistance: v('earthResistance'),
    fireResistance: v('fireResistance'),
    waterResistance: v('waterResistance'),
    airResistance: v('airResistance'),
    paDodge: v('paDodge'),
    pmDodge: v('pmDodge'),
    damageReflect: v('damageReflect'),
    bonusRange: v('bonusRange'),
    gradeXp: v('gradeXp'),
    startingSpellId: g.startingSpellId || undefined,
    hiddenLevel: g.hiddenLevel || undefined,
  });
  for (const k of OPTIONAL_GRADE_FIELDS) {
    const x = v(k);
    if (x) out[k] = x;
  }
  const bonus = normBonusCharacteristics(g.bonusCharacteristics);
  if (bonus) out.bonusCharacteristics = bonus;
  return out;
}

/** Clés d'un grade brut que la normalisation ne connaît pas (`bonusCharacteristics.<clé>` pour les parts). */
export function unknownGradeKeys(g) {
  const out = Object.keys(g).filter((k) => !KNOWN_GRADE_KEYS.has(k));
  for (const k of Object.keys(g.bonusCharacteristics ?? {})) {
    if (!KNOWN_GRADE_KEYS.has(k) && !KNOWN_BONUS_ONLY_KEYS.has(k)) out.push(`bonusCharacteristics.${k}`);
  }
  return out;
}

/**
 * Bilan des grades BRUTS d'une liste de monstres de l'API : nombre de grades par schéma et clés inconnues (avec leur
 * nombre d'occurrences). À journaliser et à inscrire dans manifest.json : un futur renommage devient visible.
 */
export function summarizeGradeSchemas(monsters) {
  const gradeSchemas = {};
  const unknownKeys = {};
  for (const m of monsters) {
    for (const g of m.grades ?? []) {
      const s = apiGradeSchema(g);
      gradeSchemas[s] = (gradeSchemas[s] ?? 0) + 1;
      for (const k of unknownGradeKeys(g)) unknownKeys[k] = (unknownKeys[k] ?? 0) + 1;
    }
  }
  return { gradeSchemas, unknownKeys };
}

/**
 * Version du jeu à inscrire dans manifest.json. L'API ne publie pas de numéro de version (aucun champ dans les
 * réponses /monsters, constaté le 2026-10-08) : à défaut de `--game-version`, elle est déduite du schéma des grades,
 * qui ne distingue que « 3.6 ou avant » et « 3.7 ou après ».
 */
export function gameVersionInfo(gradeSchemas, override) {
  if (typeof override === 'string' && override) return { version: override, source: 'option --game-version' };
  const kinds = Object.keys(gradeSchemas).filter((k) => gradeSchemas[k] > 0);
  if (kinds.length === 1 && kinds[0] === '3.7') {
    return { version: '3.7', source: 'déduite du schéma des grades (reduction*, paLostDodge…) : 3.7 ou postérieure ; préciser avec --game-version' };
  }
  if (kinds.length === 1 && kinds[0] === '3.6') {
    return { version: '3.6', source: 'déduite du schéma des grades (neutralResistance, paDodge…) : 3.6 ou antérieure ; préciser avec --game-version' };
  }
  return { version: 'inconnue', source: `schémas de grades mélangés ou inconnus : ${JSON.stringify(gradeSchemas)}` };
}

/**
 * Boss témoins : doivent figurer dans toute extraction complète, marqués `isBoss`. Le Vortex (Œil de Vortex, donjon
 * 87) est la référence du projet. Sans témoin, un renommage de `isBoss` désactiverait le contrôle des résistances
 * (plus aucun monstre à vérifier) sans la moindre erreur.
 */
export const SENTINEL_BOSS_IDS = [3835];

/**
 * Problèmes des boss d'une liste de monstres NORMALISÉS : grade `isBoss` auxquels il manque au moins une des 5
 * résistances en %, boss sans grade, aucun monstre `isBoss`, boss témoin (`requiredBossIds`) absent ou plus `isBoss`.
 */
export function bossResistanceProblems(monsters, { requiredBossIds = SENTINEL_BOSS_IDS } = {}) {
  const problems = [];
  const nameOf = (m) => m.name?.fr ?? m.name?.en ?? 'sans nom';
  if (!monsters.some((m) => m.isBoss)) problems.push(`aucun monstre isBoss parmi ${monsters.length} (champ isBoss renommé ?)`);
  for (const id of requiredBossIds) {
    const m = monsters.find((x) => x.id === id);
    if (!m) problems.push(`boss témoin ${id} absent de l'extraction`);
    else if (!m.isBoss) problems.push(`${nameOf(m)} (${id}) : boss témoin plus marqué isBoss (champ renommé ?)`);
  }
  for (const m of monsters) {
    if (!m.isBoss) continue;
    if (!m.grades?.length) problems.push(`${nameOf(m)} (${m.id}) : aucun grade`);
    for (const g of m.grades ?? []) {
      const missing = RESISTANCE_FIELDS.filter((k) => typeof g[k] !== 'number' || !Number.isFinite(g[k]));
      if (missing.length) problems.push(`${nameOf(m)} (${m.id}), grade ${g.grade} : ${missing.join(', ')} manquante(s)`);
    }
  }
  return problems;
}

/**
 * Garde-fou d'extraction : lève une erreur explicite (en français) si `bossResistanceProblems` trouve un problème.
 * Appelé par scripts/fetch-dofusdb.mjs avant toute publication dans data/dofusdb/.
 */
export function assertBossResistances(monsters, { maxShown = 10, requiredBossIds = SENTINEL_BOSS_IDS } = {}) {
  const problems = bossResistanceProblems(monsters, { requiredBossIds });
  if (!problems.length) return;
  const shown = problems.slice(0, maxShown).map((p) => `  - ${p}`);
  if (problems.length > maxShown) shown.push(`  … et ${problems.length - maxShown} autre(s)`);
  throw new Error(
    `Extraction DofusDB refusée : ${problems.length} problème(s) sur les boss (grades sans leurs 5 résistances en %, ` +
      `boss témoin absent ou plus marqué isBoss).\n${shown.join('\n')}\n` +
      "Le schéma de l'API a sans doute encore changé : compléter RENAMED_37 dans scripts/lib/dofusdb-normalize.mjs " +
      '(voir docs/research/dofusdb-api.md §10), puis relancer.',
  );
}
