// @cap-feature(feature:F-078, primary:true) Platform-Bucket for Cross-Cutting Decisions —
// .cap/memory/platform/<topic>.md and .cap/memory/platform/checklists/<subsystem>.md
//
// @cap-context This module owns explicit-only platform-bucket file IO. Per AC-2, platform
// promotion is NEVER automatic from per-feature files: a decision lands here only when it
// carries a `@cap-decision(platform:<topic>)` tag. The classifier helper for that promotion
// rule lives next to the file IO so the contract is locked in one place.
//
// @cap-context F-077's cap-memory-migrate.cjs already writes simplified platform files via
// renderPlannedWrite. F-078 layers a stricter schema (auto/manual split matching F-076)
// and a read API for the resolution path that F-079/F-080 depend on. The migrator continues
// to own the *write* path during migration; F-078 owns read + classifier + checklist.
//
// @cap-decision(F-078/AC-1) Platform topic files reuse F-076's auto-block markers
// (cap:auto:start/end) so the F-076 parser/serializer round-trips them byte-identical.
// Alternatives considered: a separate marker pair (cap:platform:start) — rejected because
// every downstream consumer would have to learn two formats. Single marker contract = single
// failure surface.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const schema = require('./cap-memory-schema.cjs');

// -------- Constants --------

// @cap-decision(F-078/D1) Platform tree layout is fixed under .cap/memory/platform/.
// Topic files live at the tree root; subsystem checklists live one level deeper. This
// separation is structural, not just naming — `listPlatformTopics` filters out the
// checklists subdir so a checklist is never mistaken for a topic.
const MEMORY_PLATFORM_DIR = path.join('.cap', 'memory', 'platform');
const MEMORY_PLATFORM_CHECKLISTS_DIR = path.join('.cap', 'memory', 'platform', 'checklists');

// @cap-decision(F-078/D2) Slug regex matches F-076's TOPIC_RE shape (kebab-case alphanumerics)
// but is re-defined locally so a future divergence between feature topics and platform topics
// doesn't silently couple. Both currently use the SAME shape; if that changes, update one,
// not both.
const PLATFORM_TOPIC_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// @cap-decision(F-078/D3) Subsystem slug matches the same kebab-case shape. Subsystem names
// are derived from module/folder names (e.g. "memory", "tag-scanner") and that's the same
// alphabet feature topics use.
const PLATFORM_SUBSYSTEM_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// @cap-risk(F-078) Path traversal: `topic` and `subsystem` end up concatenated into a
// filesystem path. If they ever contain `..` or `/`, an attacker (or a buggy classifier)
// could write outside the platform tree. The slug regex EXCLUDES both characters, but we
// double-check explicitly in _validateSlug() because a lone regex without an anchor check
// has historically been a foot-gun (cf. F-074/D8 path-traversal lesson).
function _validateSlug(value, kind, regex) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${kind} must be a non-empty string (got ${typeof value})`);
  }
  // Defense-in-depth: reject path-traversal sigils even if the regex would already catch them.
  if (value.includes('/') || value.includes('\\') || value.includes('..') || value.includes('\0')) {
    throw new TypeError(`${kind} must not contain path separators or traversal sequences (got "${_safeForError(value)}")`);
  }
  if (!regex.test(value)) {
    throw new TypeError(`${kind} must be kebab-case slug matching ${regex} (got "${_safeForError(value)}")`);
  }
}

// @cap-decision(F-078/D4) ANSI/control-byte sanitization for error messages: console.warn /
// thrown error messages embed the rejected slug. If a malicious input contains ANSI escape
// codes or backspace bytes, a developer reading logs could be visually misled. Strip
// non-printable bytes when echoing the value, but keep the raw value out of any actual
// filesystem path (the validator throws before that point anyway).
function _safeForError(value) {
  if (typeof value !== 'string') return String(value);
  // Replace any byte outside printable ASCII (excluding DEL) with `?`.
  return value.replace(/[^\x20-\x7E]/g, '?').slice(0, 64);
}

// -------- Path helpers --------

// @cap-todo(ac:F-078/AC-1) getPlatformTopicPath builds the canonical .cap/memory/platform/<topic>.md path.
/**
 * @param {string} projectRoot
 * @param {string} topic
 * @returns {string}
 */
function getPlatformTopicPath(projectRoot, topic) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  _validateSlug(topic, 'topic', PLATFORM_TOPIC_RE);
  return path.join(projectRoot, MEMORY_PLATFORM_DIR, `${topic}.md`);
}

// @cap-todo(ac:F-078/AC-4) getChecklistPath builds the canonical .cap/memory/platform/checklists/<subsystem>.md path.
/**
 * @param {string} projectRoot
 * @param {string} subsystem
 * @returns {string}
 */
function getChecklistPath(projectRoot, subsystem) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  _validateSlug(subsystem, 'subsystem', PLATFORM_SUBSYSTEM_RE);
  return path.join(projectRoot, MEMORY_PLATFORM_CHECKLISTS_DIR, `${subsystem}.md`);
}

// -------- Read API --------

// @cap-todo(ac:F-078/AC-1) loadPlatformTopic reads a topic file and parses it via the F-076 schema parser.
//   Same auto/manual split as per-feature files (AC-1 contract).
/**
 * Load a platform-topic file. Returns null if the file does not exist (graceful skip).
 * Parses via the F-076 schema parser so the auto/manual split is consistent with
 * per-feature files.
 *
 * @param {string} projectRoot
 * @param {string} topic
 * @returns {{exists:boolean, path:string, file:import('./cap-memory-schema.cjs').FeatureMemoryFile|null, raw:string|null}}
 */
function loadPlatformTopic(projectRoot, topic) {
  const fp = getPlatformTopicPath(projectRoot, topic);
  if (!fs.existsSync(fp)) {
    return { exists: false, path: fp, file: null, raw: null };
  }
  const raw = fs.readFileSync(fp, 'utf8');
  // Reuse the F-076 parser. Platform files don't have a `feature:` field — the parser is
  // resilient to that (parseSimpleYaml ignores missing required keys; only validate*()
  // surfaces them as errors). Callers that want strict schema can opt-in via validate().
  const file = schema.parseFeatureMemoryFile(raw);
  return { exists: true, path: fp, file, raw };
}

// @cap-todo(ac:F-078/AC-4) loadChecklist reads a subsystem checklist (manual-only by convention; auto-block optional).
/**
 * @param {string} projectRoot
 * @param {string} subsystem
 * @returns {{exists:boolean, path:string, file:import('./cap-memory-schema.cjs').FeatureMemoryFile|null, raw:string|null}}
 */
function loadChecklist(projectRoot, subsystem) {
  const fp = getChecklistPath(projectRoot, subsystem);
  if (!fs.existsSync(fp)) {
    return { exists: false, path: fp, file: null, raw: null };
  }
  const raw = fs.readFileSync(fp, 'utf8');
  const file = schema.parseFeatureMemoryFile(raw);
  return { exists: true, path: fp, file, raw };
}

// @cap-todo(ac:F-078/AC-1) listPlatformTopics enumerates topic slugs (excluding the checklists subdir).
/**
 * List all platform-topic slugs present in .cap/memory/platform/. Excludes:
 *   - the `checklists/` subdirectory
 *   - any non-`.md` file
 *   - any file whose basename does not pass PLATFORM_TOPIC_RE (defensive — corrupt
 *     filenames are skipped silently rather than crashing)
 *
 * @param {string} projectRoot
 * @returns {string[]} sorted list of topic slugs
 */
function listPlatformTopics(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  const dir = path.join(projectRoot, MEMORY_PLATFORM_DIR);
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
  const topics = [];
  for (const e of entries) {
    if (!e || typeof e.name !== 'string') continue;
    // Skip subdirectories (including `checklists/`).
    if (e.isDirectory && e.isDirectory()) continue;
    if (!e.name.endsWith('.md')) continue;
    const slug = e.name.slice(0, -3); // strip .md
    if (!PLATFORM_TOPIC_RE.test(slug)) continue;
    topics.push(slug);
  }
  topics.sort();
  return topics;
}

// @cap-todo(ac:F-078/AC-4) listChecklists enumerates subsystem slugs from the checklists subdir.
/**
 * @param {string} projectRoot
 * @returns {string[]} sorted list of subsystem slugs
 */
function listChecklists(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  const dir = path.join(projectRoot, MEMORY_PLATFORM_CHECKLISTS_DIR);
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e || typeof e.name !== 'string') continue;
    if (e.isDirectory && e.isDirectory()) continue;
    if (!e.name.endsWith('.md')) continue;
    const slug = e.name.slice(0, -3);
    if (!PLATFORM_SUBSYSTEM_RE.test(slug)) continue;
    out.push(slug);
  }
  out.sort();
  return out;
}

// -------- Write API --------

// @cap-decision(F-078/D5) Atomic write goes through the existing _atomicWriteFile helper from
// cap-memory-migrate.cjs (tmp + rename pattern, F-074/D8). Importing the helper rather than
// re-implementing keeps all V6 writes funneling through ONE choke point — if a future bug
// fix lands there, F-078 inherits it for free. Trade-off: we depend on cap-memory-migrate's
// public surface. cap-memory-migrate.cjs exports _atomicWriteFile explicitly for this use.
const { _atomicWriteFile } = require('./cap-memory-migrate.cjs');

// @cap-todo(ac:F-078/AC-1) writePlatformTopic atomically writes a topic file, creating parent dirs as needed.
/**
 * Write a platform-topic file. Returns `{ updated: bool, reason: string }` per F-082's
 * silent-state-update lesson — the caller can tell whether the file was actually changed
 * vs. skipped due to byte-identical no-op.
 *
 * @param {string} projectRoot
 * @param {string} topic
 * @param {string} content - full file content (frontmatter + markers + body)
 * @returns {{updated:boolean, reason:string, path:string}}
 */
function writePlatformTopic(projectRoot, topic, content) {
  const fp = getPlatformTopicPath(projectRoot, topic);
  if (typeof content !== 'string') {
    throw new TypeError('content must be a string');
  }
  // Idempotency: skip atomic write if existing content is byte-identical. Mirrors
  // cap-memory-migrate.cjs:_writePlannedFile.
  if (fs.existsSync(fp)) {
    try {
      const existing = fs.readFileSync(fp, 'utf8');
      if (existing === content) {
        return { updated: false, reason: 'byte-identical-noop', path: fp };
      }
    } catch (_e) {
      // fallthrough to write
    }
  }
  _atomicWriteFile(fp, content);
  return { updated: true, reason: 'wrote', path: fp };
}

// @cap-todo(ac:F-078/AC-4) writeChecklist atomically writes a subsystem-checklist file.
/**
 * @param {string} projectRoot
 * @param {string} subsystem
 * @param {string} content
 * @returns {{updated:boolean, reason:string, path:string}}
 */
function writeChecklist(projectRoot, subsystem, content) {
  const fp = getChecklistPath(projectRoot, subsystem);
  if (typeof content !== 'string') {
    throw new TypeError('content must be a string');
  }
  if (fs.existsSync(fp)) {
    try {
      const existing = fs.readFileSync(fp, 'utf8');
      if (existing === content) {
        return { updated: false, reason: 'byte-identical-noop', path: fp };
      }
    } catch (_e) {
      // fallthrough
    }
  }
  _atomicWriteFile(fp, content);
  return { updated: true, reason: 'wrote', path: fp };
}

// -------- Render helpers --------

// @cap-decision(F-078/D6) renderPlatformTopic builds a canonical platform-topic file using
// F-076's auto-block markers. Used by the classifier promotion path (and tests). Mirrors
// the shape produced by cap-memory-migrate.cjs:renderPlannedWrite for platform writes, but
// is exposed as a pure function so F-078 callers don't have to depend on the migrator.
/**
 * @param {{topic:string, decisions?:Array<{text:string, location?:string}>, pitfalls?:Array<{text:string, location?:string}>, lessons?:string, updated?:string}} input
 * @returns {string}
 */
function renderPlatformTopic(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('renderPlatformTopic: input must be an object');
  }
  _validateSlug(input.topic, 'topic', PLATFORM_TOPIC_RE);
  const updated = input.updated || new Date().toISOString();
  const decisions = (input.decisions || []).map((d) => ({
    text: String(d.text || '').replace(/[\r\n]+/g, ' ').trim(),
    location: String(d.location || '').replace(/[\r\n]+/g, ' ').trim(),
  }));
  const pitfalls = (input.pitfalls || []).map((p) => ({
    text: String(p.text || '').replace(/[\r\n]+/g, ' ').trim(),
    location: String(p.location || '').replace(/[\r\n]+/g, ' ').trim(),
  }));

  const fmLines = [
    '---',
    `topic: ${input.topic}`,
    `updated: ${updated}`,
    '---',
  ];

  const titleCase = input.topic.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // @cap-decision(F-078/D7) Empty auto-block: when both decisions and pitfalls are empty, we
  // still emit the marker pair on their own lines (with one blank line between) rather than
  // omitting the auto-block entirely. Reason: the F-076 schema validator accepts empty
  // marker bodies, and downstream re-runs of the migrator will write into the marker pair
  // without needing to re-introduce it. F-076 fixture tests already cover this shape.
  const autoLines = [schema.AUTO_BLOCK_START_MARKER];
  if (decisions.length > 0) {
    autoLines.push('## Decisions (from tags)');
    for (const d of decisions) {
      const loc = d.location ? ` — \`${d.location}\`` : '';
      autoLines.push(`- ${d.text}${loc}`);
    }
  }
  if (pitfalls.length > 0) {
    if (decisions.length > 0) autoLines.push('');
    autoLines.push('## Pitfalls (from tags)');
    for (const p of pitfalls) {
      const loc = p.location ? ` — \`${p.location}\`` : '';
      autoLines.push(`- ${p.text}${loc}`);
    }
  }
  autoLines.push(schema.AUTO_BLOCK_END_MARKER);

  const lessonsText = (typeof input.lessons === 'string' && input.lessons.trim().length > 0)
    ? input.lessons
    : '<!-- Manual lessons go here. The auto-block above is regenerated by the memory pipeline. -->';

  const out = [
    fmLines.join('\n'),
    '',
    `# Platform: ${titleCase}`,
    '',
    autoLines.join('\n'),
    '',
    '## Lessons',
    '',
    lessonsText,
    '',
  ].join('\n');

  return out;
}

// -------- Classifier (AC-2: explicit-only platform promotion) --------

// @cap-feature(feature:F-078) classifyDecisionTag — explicit-only platform promotion gate.
//
// @cap-todo(ac:F-078/AC-2) classifyDecisionTag routes a single tag to either feature-bucket,
//   platform-bucket, or rejects it. Plain `@cap-decision` (no platform: key) NEVER lands in
//   the platform bucket. A tag with BOTH feature: and platform: keys is REJECTED with a loud
//   parse-error so the author has to pick one.
//
// @cap-decision(F-078/AC-2) Explicit-only: there is no fallback heuristic that promotes a
// per-feature decision into the platform bucket. F-077 had path-heuristik for *unrouted*
// V5 entries; that's a different problem (orphan classification). Here, the author has
// explicitly tagged the location and the answer is unambiguous — no guessing.

/**
 * @typedef {Object} ClassifierResult
 * @property {'feature'|'platform'|'unassigned'|'error'} destination
 * @property {string|null} featureId - F-NNN if destination === 'feature'
 * @property {string|null} topic - platform topic slug if destination === 'platform'
 * @property {string} reason - human-readable reason
 * @property {string|null} error - error message if destination === 'error'
 */

/**
 * Classify a single @cap-decision tag for routing. Pure function — no IO.
 *
 * Routing rules (priority order):
 *   1. Both feature: AND platform: present → ERROR (loud parse-fail). The author must pick one.
 *   2. platform:<topic> present (and slug-valid) → platform-bucket.
 *   3. feature:<F-NNN> present → feature-bucket.
 *   4. Neither present → unassigned (caller's choice — typically falls back to active feature
 *      or unassigned platform topic per F-077).
 *
 * @param {{type?:string, metadata?:Object<string,string>, file?:string, line?:number, description?:string}} tag
 *   A CapTag-shaped object as emitted by cap-tag-scanner.cjs.
 * @returns {ClassifierResult}
 */
function classifyDecisionTag(tag) {
  // @cap-risk(F-078) Defensive: a malformed tag object (missing metadata) should not crash
  // the classifier — return an `error` result instead so the caller can log + continue.
  if (!tag || typeof tag !== 'object') {
    return { destination: 'error', featureId: null, topic: null, reason: 'invalid-tag-shape', error: 'tag must be an object' };
  }
  // F-078 only governs @cap-decision tags. Other types pass through as 'unassigned' so the
  // classifier is safe to call from a generic loop without pre-filtering.
  if (tag.type !== 'decision') {
    return { destination: 'unassigned', featureId: null, topic: null, reason: 'not-a-decision-tag', error: null };
  }
  const meta = tag.metadata || Object.create(null);
  // Normalize values defensively. parseMetadata in tag-scanner already strips whitespace,
  // but defense-in-depth is cheap.
  const platformRaw = (typeof meta.platform === 'string' && meta.platform !== 'true') ? meta.platform.trim() : null;
  const featureRaw = (typeof meta.feature === 'string' && meta.feature !== 'true') ? meta.feature.trim() : null;

  // 1. Both present → loud error (AC-2 spec gap fix).
  if (platformRaw && featureRaw) {
    const loc = (tag.file ? `${tag.file}:${tag.line || '?'}` : 'unknown');
    return {
      destination: 'error',
      featureId: featureRaw,
      topic: platformRaw,
      reason: 'both-feature-and-platform',
      error: `@cap-decision at ${loc} has BOTH feature:${featureRaw} AND platform:${platformRaw} — pick one`,
    };
  }

  // 2. Platform tag present.
  if (platformRaw) {
    if (!PLATFORM_TOPIC_RE.test(platformRaw)) {
      const loc = (tag.file ? `${tag.file}:${tag.line || '?'}` : 'unknown');
      return {
        destination: 'error',
        featureId: null,
        topic: platformRaw,
        reason: 'invalid-platform-slug',
        error: `@cap-decision at ${loc} has invalid platform topic "${_safeForError(platformRaw)}" (must be kebab-case)`,
      };
    }
    return {
      destination: 'platform',
      featureId: null,
      topic: platformRaw,
      reason: 'explicit-platform-tag',
      error: null,
    };
  }

  // 3. Feature tag present.
  if (featureRaw) {
    if (!schema.FEATURE_ID_RE.test(featureRaw)) {
      const loc = (tag.file ? `${tag.file}:${tag.line || '?'}` : 'unknown');
      return {
        destination: 'error',
        featureId: featureRaw,
        topic: null,
        reason: 'invalid-feature-id',
        error: `@cap-decision at ${loc} has invalid feature id "${_safeForError(featureRaw)}"`,
      };
    }
    return {
      destination: 'feature',
      featureId: featureRaw,
      topic: null,
      reason: 'explicit-feature-tag',
      error: null,
    };
  }

  // 4. Neither — caller decides (typically: fall back to activeFeature or unassigned).
  return { destination: 'unassigned', featureId: null, topic: null, reason: 'no-routing-tag', error: null };
}

// -------- Exports --------

module.exports = {
  // public API
  loadPlatformTopic,
  writePlatformTopic,
  listPlatformTopics,
  loadChecklist,
  writeChecklist,
  listChecklists,
  renderPlatformTopic,
  classifyDecisionTag,
  getPlatformTopicPath,
  getChecklistPath,
  // constants
  MEMORY_PLATFORM_DIR,
  MEMORY_PLATFORM_CHECKLISTS_DIR,
  PLATFORM_TOPIC_RE,
  PLATFORM_SUBSYSTEM_RE,
};
