// @cap-feature(feature:F-080, primary:true) Bridge to Claude-native Memory —
// read-only consumer of ~/.claude/projects/<slug>/memory/ MEMORY.md + sibling files.
//
// @cap-context This module owns the read-only contract between Claude Code's auto-memory
// (~/.claude/projects/<slug>/memory/) and the CAP runtime surface (/cap:start, /cap:status).
// It NEVER writes into the Claude-native directory — the bridge is strictly a one-way
// pull. The local cache (.cap/memory/.claude-native-index.json) is the only thing this
// module writes, and it's a derived artifact under the project's own .cap/ tree.
//
// @cap-context AC-4 wires the surface into /cap:start + /cap:status as a runtime-only
// echo. The bridge does NOT persist its data into per-feature memory files — see
// @cap-decision(F-080/spec-gap) below for the runtime-only rationale.
//
// @cap-decision(F-080/AC-1) Read-only contract is sacred: NEVER write to
// ~/.claude/projects/<slug>/memory/. The cache lives under .cap/memory/ and is the only
// write target. Tests assert the source dir's mtime + content stay byte-identical across
// bridge invocations (cap-memory-bridge-adversarial.test.cjs).
//
// @cap-decision(F-080/AC-3) Missing or unreadable Claude-native dir → graceful skip
// (silent: no stdout, no stderr, no throw). The user may not have set up auto-memory
// yet, or may be running in an environment without ~/.claude/projects/. The bridge must
// degrade silently rather than fail the surrounding command.
//
// @cap-decision(F-080/AC-5) Surface priority order is fixed:
//   1. Entries whose title/file mentions the activeFeature ID (e.g. F-080)
//   2. Entries that match any related_features from the feature's per-feature memory file
//   3. Last 2 globally-recent entries (by file mtime desc) as fallback context
//   Hard cap: 5 bullets total. If the priority sort yields more, truncate.
//
// @cap-decision(F-080/spec-gap) AC-4 wording "surface" is interpreted as RUNTIME-ONLY
// stdout (not persistence into per-feature files). Rationale: lower blast radius — the
// bridge stays purely additive, no schema changes to per-feature files, no auto-block
// pollution. If a future feature needs persistence, a new auto-block name (e.g.
// `claude_native_recall`) under F-079's `<!-- @auto-block <name> -->` convention can be
// added without touching this module.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const schema = require('./cap-memory-schema.cjs');

// -------- Constants --------

// @cap-decision(F-080/D1) Cache file lives under the project's own .cap/memory/ tree
// (NOT inside .cap/memory/features/). Naming convention `.claude-native-index.json` —
// the leading dot signals "derived/transient" and aligns with `.cap/memory/.last-run`.
const CACHE_REL_PATH = path.join('.cap', 'memory', '.claude-native-index.json');

// @cap-decision(F-080/D2) Cache schema version starts at 1. Bumping is a hard-invalidate
// signal — if a future iteration changes the entry shape, increment this and the loader
// will refuse to honor the old cache (forces a re-parse).
const CACHE_SCHEMA_VERSION = 1;

// @cap-decision(F-080/D3) Hard cap on surface bullets. Spec AC-5 says "max 5 per run".
// Enforced as a single MAX_BULLETS constant so a future tweak is a one-line change.
const MAX_BULLETS = 5;

// @cap-decision(F-080/D4) Slug-character regex for the project-slug derivation. Claude
// Code's auto-memory directory uses the absolute path with `/` → `-`. We accept the
// resulting alphabet (alnum + `-` + `.` + `_`). Defense-in-depth: reject anything else
// in _validateSlug below.
const SLUG_CHAR_RE = /^[A-Za-z0-9._-]+$/;

// @cap-decision(F-080/D5) Reserved slug tokens that would survive the regex but still
// pose a path-traversal risk (e.g. `..` matches the regex above). Hard-reject these.
const RESERVED_SLUG_TOKENS = new Set(['..', '.', '__proto__', 'constructor', 'prototype']);

// -------- Defensive helpers --------

// @cap-decision(F-080/D6) ANSI/control-byte sanitization for any user-supplied string
// that could land in stdout (entry titles, hooks). Mirrors cap-memory-platform.cjs and
// cap-snapshot-linkage.cjs `_safeForError` — kept local so a refactor in one module
// can't silently weaken the defense in another.
function _safeForOutput(value) {
  if (typeof value !== 'string') return String(value);
  // Replace any byte outside printable ASCII (excluding DEL) with `?`. Strip to 200 chars
  // to keep surface lines bounded — entry titles longer than that get visually truncated.
  return value.replace(/[^\x20-\x7E]/g, '?').slice(0, 200);
}

// @cap-risk(reason:path-traversal-via-cwd) The project-slug is derived from the absolute
// cwd path. If cwd contains `..` or symlinks, we still produce a safe slug because we
// transform `/` → `-` (no `..`-segment can sneak through), but we double-check with
// _validateSlug below. Defense-in-depth pattern from F-078/D4 + F-079 _validateSnapshotName.
function _validateSlug(slug) {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new TypeError(`project-slug must be a non-empty string (got ${typeof slug})`);
  }
  if (slug.includes('/') || slug.includes('\\') || slug.includes('\0')) {
    throw new TypeError(`project-slug must not contain path separators or NUL (got "${_safeForOutput(slug)}")`);
  }
  if (RESERVED_SLUG_TOKENS.has(slug)) {
    throw new TypeError(`project-slug is a reserved token (got "${_safeForOutput(slug)}")`);
  }
  if (!SLUG_CHAR_RE.test(slug)) {
    throw new TypeError(`project-slug must match ${SLUG_CHAR_RE} (got "${_safeForOutput(slug)}")`);
  }
}

// -------- Slug derivation --------

// @cap-todo(ac:F-080/AC-1) getProjectSlug derives the Claude-native auto-memory slug from
//   an absolute project path. Claude Code's convention: replace `/` with `-`, keep dots
//   and other path-safe chars verbatim.
/**
 * Derive the Claude-native auto-memory project slug from an absolute project path.
 * Convention (Claude Code): the absolute project path with `/` substituted by `-`, e.g.
 * `/Users/foo/bar` → `-Users-foo-bar`.
 *
 * @param {string} projectRoot - absolute path to the project root
 * @returns {string} slug (validated)
 */
function getProjectSlug(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  // Normalize away any trailing slash and resolve `..` segments before slug-ifying so
  // cwd `/Users/foo/bar/` and `/Users/foo/bar/baz/..` both produce the same slug.
  const normalized = path.resolve(projectRoot);
  // Reject path-traversal sigils in the resolved path defensively (path.resolve already
  // eliminates `..` but the input may contain a NUL byte that survives).
  if (normalized.includes('\0')) {
    throw new TypeError(`projectRoot contains NUL byte (got "${_safeForOutput(projectRoot)}")`);
  }
  // Replace BOTH POSIX `/` and Windows `\` with `-` for cross-platform safety. The
  // Claude-native convention is observed on POSIX as `/` → `-`; on Windows the parallel
  // is `\` → `-`. Both substitutions are idempotent.
  const slug = normalized.replace(/[/\\]/g, '-');
  _validateSlug(slug);
  return slug;
}

// @cap-todo(ac:F-080/AC-1) getClaudeNativeDir builds the absolute path to the Claude-native
//   auto-memory directory: ~/.claude/projects/<slug>/memory/.
/**
 * @param {string} projectRoot
 * @returns {string} absolute path to ~/.claude/projects/<slug>/memory/
 */
function getClaudeNativeDir(projectRoot) {
  const slug = getProjectSlug(projectRoot);
  return path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
}

// @cap-todo(ac:F-080/AC-1) getClaudeNativeMemoryMdPath builds the path to the index file
//   (MEMORY.md) under the Claude-native dir.
/**
 * @param {string} projectRoot
 * @returns {string}
 */
function getClaudeNativeMemoryMdPath(projectRoot) {
  return path.join(getClaudeNativeDir(projectRoot), 'MEMORY.md');
}

// @cap-todo(ac:F-080/AC-2) getCachePath builds the path to the local cache file under
//   .cap/memory/.claude-native-index.json.
/**
 * @param {string} projectRoot
 * @returns {string}
 */
function getCachePath(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  return path.join(projectRoot, CACHE_REL_PATH);
}

// -------- MEMORY.md parser --------

/**
 * @typedef {Object} ClaudeNativeEntry
 * @property {string} title       - human title from the bullet
 * @property {string} file        - sibling filename (relative to memory dir)
 * @property {string} hook        - one-line hook text after the em-dash
 * @property {string|null} type   - 'user'|'feedback'|'project'|'reference'|null (from sibling frontmatter)
 * @property {string|null} fileMtime - ISO mtime of the sibling file (null if missing)
 * @property {string|null} description - sibling's frontmatter description if present
 */

// @cap-decision(F-080/D7) MEMORY.md grammar: each line is `- [Title](file.md) — hook text`.
// Tolerate both em-dash (—), en-dash (–) and regular hyphen (-) as separator (mirrors the
// F-082 em-dash lesson). A line that doesn't match the bullet shape is silently skipped —
// MEMORY.md may have prose interspersed (header notes, comments).
const MEMORY_MD_LINE_RE = /^-\s*\[([^\]]+)\]\(([^)]+)\)\s*[—–-]\s*(.+?)\s*$/;

// @cap-todo(ac:F-080/AC-1) parseMemoryMd parses the index file into structured entries.
//   Frontmatter on sibling files is read via parseSiblingFrontmatter.
//
// @cap-decision(F-080/iter0/D8) Sibling-file reads are best-effort: a missing or
// unreadable sibling is dropped from the parse with no error (the index entry survives
// but `type` and `description` will be null). This keeps a partially-broken auto-memory
// dir surface-able rather than blocking the bridge entirely.
/**
 * @param {string} memoryDir - absolute path to ~/.claude/projects/<slug>/memory/
 * @returns {ClaudeNativeEntry[]}
 */
function parseMemoryMd(memoryDir) {
  if (typeof memoryDir !== 'string' || memoryDir.length === 0) {
    throw new TypeError('memoryDir must be a non-empty string');
  }
  const memoryMdPath = path.join(memoryDir, 'MEMORY.md');
  if (!fs.existsSync(memoryMdPath)) return [];
  let raw;
  try {
    raw = fs.readFileSync(memoryMdPath, 'utf8');
  } catch (_e) {
    // Unreadable index → treat as empty (graceful).
    return [];
  }
  /** @type {ClaudeNativeEntry[]} */
  const entries = [];
  const seenFiles = new Set();
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s+|\s+$/g, '');
    if (line.length === 0) continue;
    const m = line.match(MEMORY_MD_LINE_RE);
    if (!m) continue;
    const title = m[1].trim();
    const fileRel = m[2].trim();
    const hook = m[3].trim();
    // Defensive: reject sibling references that try to escape the memory dir. The expected
    // shape is a bare filename (no slash, no leading dot beyond `.md`).
    if (fileRel.includes('/') || fileRel.includes('\\') || fileRel.includes('\0') || fileRel.includes('..')) continue;
    if (seenFiles.has(fileRel)) continue;  // dedup by file
    seenFiles.add(fileRel);
    const sibling = parseSiblingFrontmatter(memoryDir, fileRel);
    entries.push({
      title,
      file: fileRel,
      hook,
      type: sibling.type,
      fileMtime: sibling.mtime,
      description: sibling.description,
    });
  }
  return entries;
}

/**
 * @param {string} memoryDir
 * @param {string} fileRel
 * @returns {{type:string|null, description:string|null, mtime:string|null}}
 */
function parseSiblingFrontmatter(memoryDir, fileRel) {
  const fp = path.join(memoryDir, fileRel);
  /** @type {{type:string|null, description:string|null, mtime:string|null}} */
  const empty = { type: null, description: null, mtime: null };
  if (!fs.existsSync(fp)) return empty;
  let stat;
  let content;
  try {
    stat = fs.statSync(fp);
    content = fs.readFileSync(fp, 'utf8');
  } catch (_e) {
    return empty;
  }
  const mtime = stat.mtime.toISOString();
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return { type: null, description: null, mtime };
  const fmBody = fmMatch[1];
  let type = null;
  let description = null;
  // @cap-risk(reason:proto-pollution-via-frontmatter) Sibling frontmatter is YAML-like.
  // Skip reserved tokens explicitly (defense-in-depth — we never use the parsed values
  // as object keys, only assign to fixed fields, but the tradition is established).
  const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
  for (const line of fmBody.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (RESERVED.has(key)) continue;
    const val = (m[2] || '').replace(/^["']|["']$/g, '').trim();
    if (key === 'type') type = val || null;
    else if (key === 'description') description = val || null;
  }
  return { type, description, mtime };
}

// -------- Cache I/O --------

// @cap-todo(ac:F-080/AC-2) loadCachedIndex reads the local cache file and returns the
//   parsed structure (or null on any failure — cache is best-effort).
/**
 * @param {string} projectRoot
 * @returns {{schemaVersion:number, sourceRoot:string, memoryMdMtime:string|null, entries:ClaudeNativeEntry[]}|null}
 */
function loadCachedIndex(projectRoot) {
  const cachePath = getCachePath(projectRoot);
  if (!fs.existsSync(cachePath)) return null;
  let raw;
  try {
    raw = fs.readFileSync(cachePath, 'utf8');
  } catch (_e) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    // @cap-decision(F-080/iter0/D9) Corrupt cache JSON → treat as missing cache (caller
    // re-parses from source). The cache file is regenerated on the next refresh, so
    // there's no persistent failure mode here. Loud-throw was rejected because corrupt
    // cache shouldn't block surface output — re-parse is the cheap, safe path.
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  if (!Array.isArray(parsed.entries)) return null;
  // Sanitize entries — accept only entries with the expected shape.
  /** @type {ClaudeNativeEntry[]} */
  const safeEntries = [];
  const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
  for (const e of parsed.entries) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.title !== 'string' || typeof e.file !== 'string') continue;
    if (RESERVED.has(e.file)) continue;
    if (e.file.includes('/') || e.file.includes('\\') || e.file.includes('..')) continue;
    safeEntries.push({
      title: e.title,
      file: e.file,
      hook: typeof e.hook === 'string' ? e.hook : '',
      type: typeof e.type === 'string' ? e.type : null,
      fileMtime: typeof e.fileMtime === 'string' ? e.fileMtime : null,
      description: typeof e.description === 'string' ? e.description : null,
    });
  }
  return {
    schemaVersion: parsed.schemaVersion,
    sourceRoot: typeof parsed.sourceRoot === 'string' ? parsed.sourceRoot : '',
    memoryMdMtime: typeof parsed.memoryMdMtime === 'string' ? parsed.memoryMdMtime : null,
    entries: safeEntries,
  };
}

// @cap-todo(ac:F-080/AC-2) isCacheValid compares cached mtimes against current source
//   mtimes. Returns true ONLY if the cache exists, the index file mtime matches, and
//   no sibling file is newer than the cache.
//
// @cap-risk(reason:cache-toctou-acceptable) Between isCacheValid() and the actual
// refresh/load, a sibling file could change. Worst case: caller surfaces one-tick-stale
// data. Acceptable for a read-only display surface.
/**
 * @param {string} projectRoot
 * @returns {boolean}
 */
function isCacheValid(projectRoot) {
  const cached = loadCachedIndex(projectRoot);
  if (!cached) return false;
  const memoryMdPath = getClaudeNativeMemoryMdPath(projectRoot);
  if (!fs.existsSync(memoryMdPath)) return false;
  let stat;
  try {
    stat = fs.statSync(memoryMdPath);
  } catch (_e) {
    return false;
  }
  const currentMtime = stat.mtime.toISOString();
  if (cached.memoryMdMtime !== currentMtime) return false;
  // Check sibling files: if ANY referenced sibling has a newer mtime than recorded in the
  // cache, invalidate. This catches the case where MEMORY.md is unchanged but a sibling's
  // frontmatter (e.g. type, description) was edited.
  const memoryDir = getClaudeNativeDir(projectRoot);
  for (const entry of cached.entries) {
    const fp = path.join(memoryDir, entry.file);
    if (!fs.existsSync(fp)) {
      // Sibling went missing → invalidate so the re-parse drops it.
      return false;
    }
    let sStat;
    try {
      sStat = fs.statSync(fp);
    } catch (_e) {
      return false;
    }
    const currMtime = sStat.mtime.toISOString();
    if (entry.fileMtime !== null && currMtime !== entry.fileMtime) return false;
  }
  return true;
}

// @cap-todo(ac:F-080/AC-2) refreshCache re-parses MEMORY.md + sibling files and writes
//   a fresh `.claude-native-index.json`. Atomic write (tmp + rename) so a crash mid-write
//   doesn't corrupt the cache.
//
// @cap-decision(F-080/D10) Atomic write goes through a local helper rather than importing
// `_atomicWriteFile` from cap-memory-migrate.cjs. Reasons:
//   1. Lower coupling — F-080 is a leaf module, depending on cap-memory-migrate would
//      pull in a much larger surface (the migrator owns the V6 transformation pipeline).
//   2. Symmetric with the parent dir creation we need anyway (cache lives in
//      `.cap/memory/` which may not exist on first use).
//   3. The pattern is small (3 lines: write tmp, rename, optionally chmod). Duplication
//      is cheaper than the dep edge.
/**
 * @param {string} projectRoot
 * @returns {{written:boolean, entries:ClaudeNativeEntry[], reason:string}}
 */
function refreshCache(projectRoot) {
  const memoryDir = getClaudeNativeDir(projectRoot);
  const memoryMdPath = path.join(memoryDir, 'MEMORY.md');
  if (!fs.existsSync(memoryMdPath)) {
    return { written: false, entries: [], reason: 'source-missing' };
  }
  let memoryMdStat;
  try {
    memoryMdStat = fs.statSync(memoryMdPath);
  } catch (_e) {
    return { written: false, entries: [], reason: 'source-stat-failed' };
  }
  const entries = parseMemoryMd(memoryDir);
  const cachePayload = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    sourceRoot: memoryDir,
    memoryMdMtime: memoryMdStat.mtime.toISOString(),
    entries,
  };
  const cachePath = getCachePath(projectRoot);
  // Ensure parent dir exists.
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  } catch (_e) {
    return { written: false, entries, reason: 'parent-dir-create-failed' };
  }
  // Atomic write: tmp + rename (matches F-074/F-078 pattern).
  const tmpPath = `${cachePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(cachePayload, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, cachePath);
  } catch (_e) {
    // Cleanup tmp file if it exists.
    try { fs.unlinkSync(tmpPath); } catch (_e2) { /* ignore */ }
    return { written: false, entries, reason: 'cache-write-failed' };
  }
  return { written: true, entries, reason: 'wrote' };
}

// -------- Bridge data assembly --------

/**
 * @typedef {Object} BridgeData
 * @property {boolean} available  - false = silent skip; true = entries usable
 * @property {ClaudeNativeEntry[]} entries
 * @property {string} reason      - 'ok' | 'no-claude-native-dir' | 'no-memory-md' | 'parse-empty' | 'unreadable'
 */

// @cap-todo(ac:F-080/AC-3) getBridgeData is the silent-skip-aware entry point. Returns
//   {available:false} for any failure path; never throws, never logs to stdout/stderr.
//
// @cap-decision(F-080/AC-3) "Silent skip" is REAL silent: zero output to stdout/stderr.
//   The `reason` field carries the diagnostic for tests / debug logging. A future debug
//   hook can opt-in to log the reason via env-var (e.g. `CAP_DEBUG=1`) but the default
//   path emits NOTHING.
/**
 * Single entry point for the bridge. Resolves cache vs source, returns assembled data.
 * Silent on any failure.
 *
 * @param {string} projectRoot
 * @returns {BridgeData}
 */
function getBridgeData(projectRoot) {
  /** @type {BridgeData} */
  const skip = (reason) => ({ available: false, entries: [], reason });
  // Wrap EVERYTHING in try/catch — silent-skip means even an unexpected throw must not
  // surface. Belt-and-braces: the called helpers are already defensive, but a typo in
  // future maintenance shouldn't break the surrounding command.
  try {
    let claudeNativeDir;
    try {
      claudeNativeDir = getClaudeNativeDir(projectRoot);
    } catch (_e) {
      return skip('slug-derivation-failed');
    }
    if (!fs.existsSync(claudeNativeDir)) {
      return skip('no-claude-native-dir');
    }
    const memoryMdPath = path.join(claudeNativeDir, 'MEMORY.md');
    if (!fs.existsSync(memoryMdPath)) {
      return skip('no-memory-md');
    }
    let entries;
    if (isCacheValid(projectRoot)) {
      const cached = loadCachedIndex(projectRoot);
      entries = cached ? cached.entries : [];
    } else {
      const refreshed = refreshCache(projectRoot);
      entries = refreshed.entries;
    }
    if (!Array.isArray(entries)) entries = [];
    return { available: true, entries, reason: entries.length === 0 ? 'parse-empty' : 'ok' };
  } catch (_e) {
    // Last-ditch swallow. Silent-skip contract overrides anything else.
    return skip('unexpected-error');
  }
}

// -------- Surface (priority + max-5 truncation) --------

/**
 * @typedef {Object} SurfaceResult
 * @property {string[]} bullets   - already formatted "- <title>" strings, max 5
 * @property {boolean} truncated  - true if input had > 5 candidates
 * @property {ClaudeNativeEntry[]} chosen - the entries that backed the bullets (debug)
 */

// @cap-todo(ac:F-080/AC-4) surfaceForFeature returns the bullet list to print under the
//   "Claude-native erinnert:" header. Pure function: takes projectRoot + activeFeature,
//   returns formatted bullets.
//
// @cap-todo(ac:F-080/AC-5) Priority: activeFeature direct match → related_features from
//   per-feature memory file → last 2 globally-recent (by fileMtime desc). Hard-cap 5.
//
// @cap-decision(F-080/AC-5/tiebreak) Within a single priority bucket, sort by fileMtime
//   desc, then title asc. Deterministic ordering pinned by tests so future changes can't
//   silently shuffle the surface output.
/**
 * @param {string} projectRoot
 * @param {string|null} activeFeatureId   - F-NNN id (or null = no active feature)
 * @param {{relatedFeatures?:string[]}=} options - test seam: lets tests inject related_features
 *   without writing a per-feature memory file. In production, related_features is read from
 *   the per-feature file via _readRelatedFeatures.
 * @returns {SurfaceResult}
 */
function surfaceForFeature(projectRoot, activeFeatureId, options) {
  const opts = options || {};
  const data = getBridgeData(projectRoot);
  if (!data.available || data.entries.length === 0) {
    return { bullets: [], truncated: false, chosen: [] };
  }
  // Resolve related-features: prefer test-injected, fall back to per-feature file lookup.
  let relatedFeatures = Array.isArray(opts.relatedFeatures)
    ? opts.relatedFeatures.filter((f) => typeof f === 'string')
    : null;
  if (relatedFeatures === null && activeFeatureId && schema.FEATURE_ID_RE.test(activeFeatureId)) {
    relatedFeatures = _readRelatedFeatures(projectRoot, activeFeatureId);
  }
  if (!Array.isArray(relatedFeatures)) relatedFeatures = [];

  // Tier 1: entries mentioning the active feature.
  /** @type {ClaudeNativeEntry[]} */
  const tier1 = [];
  /** @type {ClaudeNativeEntry[]} */
  const tier2 = [];
  /** @type {ClaudeNativeEntry[]} */
  const tier3 = [];
  const seen = new Set();
  const matchesFeature = (entry, fid) => {
    const haystack = `${entry.title}\n${entry.file}\n${entry.hook}\n${entry.description || ''}`.toLowerCase();
    return haystack.includes(fid.toLowerCase());
  };
  // Stable-sort comparator (mtime desc, title asc) used in EVERY tier.
  const tierSort = (a, b) => {
    const ma = a.fileMtime || '';
    const mb = b.fileMtime || '';
    if (ma !== mb) return ma < mb ? 1 : -1;  // desc
    if (a.title === b.title) return 0;
    return a.title < b.title ? -1 : 1;
  };
  if (activeFeatureId) {
    for (const e of data.entries) {
      if (seen.has(e.file)) continue;
      if (matchesFeature(e, activeFeatureId)) {
        tier1.push(e);
        seen.add(e.file);
      }
    }
  }
  for (const fid of relatedFeatures) {
    if (!schema.FEATURE_ID_RE.test(fid)) continue;
    for (const e of data.entries) {
      if (seen.has(e.file)) continue;
      if (matchesFeature(e, fid)) {
        tier2.push(e);
        seen.add(e.file);
      }
    }
  }
  // Tier 3: most-recent globals (by mtime desc, title asc tiebreak), excluding already-seen.
  // @cap-decision(F-080/AC-5/D11) Tier 3 cap at 2 entries (per spec "letzte 2 globale Einträge").
  //   This is enforced INSIDE tier3 (not just by the outer MAX_BULLETS) so a future bump of
  //   MAX_BULLETS doesn't accidentally widen the global-recents window.
  const TIER3_CAP = 2;
  const remaining = data.entries.filter((e) => !seen.has(e.file));
  remaining.sort(tierSort);
  for (const e of remaining) {
    if (tier3.length >= TIER3_CAP) break;
    tier3.push(e);
    seen.add(e.file);
  }

  // Sort each tier deterministically. tier1 + tier2: mtime desc / title asc. tier3 already sorted.
  tier1.sort(tierSort);
  tier2.sort(tierSort);

  // Concatenate priorities and hard-cap.
  const merged = [...tier1, ...tier2, ...tier3];
  const truncated = merged.length > MAX_BULLETS;
  const chosen = merged.slice(0, MAX_BULLETS);
  const bullets = chosen.map((e) => `- ${_safeForOutput(e.title)}`);
  return { bullets, truncated, chosen };
}

// @cap-todo(ac:F-080/AC-4) formatSurface emits the full surface block. Empty bullets →
//   empty string (caller writes nothing). This is the single source of truth for the
//   surface format so /cap:start and /cap:status produce identical output.
/**
 * @param {SurfaceResult} surface
 * @returns {string} multi-line string ready to print, or '' when no bullets
 */
function formatSurface(surface) {
  if (!surface || !Array.isArray(surface.bullets) || surface.bullets.length === 0) {
    return '';
  }
  const lines = ['Claude-native erinnert:'];
  for (const b of surface.bullets) {
    lines.push(`  ${b}`);
  }
  if (surface.truncated) {
    lines.push(`  (truncated to ${MAX_BULLETS} of ${surface.bullets.length}+ candidates)`);
  }
  return lines.join('\n');
}

// -------- Per-feature file → related_features lookup --------

/**
 * Read related_features from the per-feature memory file's frontmatter. Best-effort:
 * returns [] on any failure (no file, no frontmatter, no related_features field).
 *
 * @param {string} projectRoot
 * @param {string} featureId
 * @returns {string[]}
 */
function _readRelatedFeatures(projectRoot, featureId) {
  if (!schema.FEATURE_ID_RE.test(featureId)) return [];
  const featuresDir = path.join(projectRoot, schema.MEMORY_FEATURES_DIR);
  if (!fs.existsSync(featuresDir)) return [];
  let names;
  try {
    names = fs.readdirSync(featuresDir);
  } catch (_e) {
    return [];
  }
  const prefix = `${featureId}-`;
  let target = null;
  for (const name of names) {
    if (typeof name !== 'string') continue;
    if (!name.endsWith('.md')) continue;
    if (name.startsWith(prefix)) { target = name; break; }
  }
  if (!target) return [];
  let raw;
  try {
    raw = fs.readFileSync(path.join(featuresDir, target), 'utf8');
  } catch (_e) {
    return [];
  }
  try {
    const file = schema.parseFeatureMemoryFile(raw);
    if (file && file.frontmatter && Array.isArray(file.frontmatter.related_features)) {
      return file.frontmatter.related_features.filter((f) => typeof f === 'string' && schema.FEATURE_ID_RE.test(f));
    }
  } catch (_e) {
    // Malformed frontmatter — fall through to empty.
  }
  return [];
}

// -------- Exports --------

module.exports = {
  // Public API
  getProjectSlug,
  getClaudeNativeDir,
  getClaudeNativeMemoryMdPath,
  getCachePath,
  parseMemoryMd,
  loadCachedIndex,
  isCacheValid,
  refreshCache,
  getBridgeData,
  surfaceForFeature,
  formatSurface,
  // Constants
  CACHE_REL_PATH,
  CACHE_SCHEMA_VERSION,
  MAX_BULLETS,
  // Test seams
  _readRelatedFeatures,
  _safeForOutput,
};
