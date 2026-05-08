// @cap-context F-089 sharded Feature Map — pure helpers for ID validation, filename derivation,
//   index-line parse/serialize, and surgical index-entry patching. Zero I/O except where explicitly
//   marked (existsSync / readdirSync probes for sharded-mode detection).
// @cap-decision(F-089/strategy) Helpers live in a separate module so the surface stays auditable and
//   the core cap-feature-map.cjs can lazy-require it (mirrors F-083 monorepo split pattern).
// @cap-pattern(F-089/test-first) Module is pure-functions where possible — every export has a unit test
//   in tests/cap-feature-map-shard.test.cjs.

'use strict';

// @cap-feature(feature:F-089, primary:true) Sharded Feature Map — Index + Per-Feature Files

const fs = require('node:fs');
const path = require('node:path');

const FEATURES_DIR = 'features';
const FEATURE_MAP_FILE = 'FEATURE-MAP.md';
const MAX_ID_LENGTH = 64;

// @cap-decision(F-089/AC-3) Three-branch union accepts:
//   1. F-NNN          legacy numeric, 3+ digits — F-001, F-1234
//   2. F-LONGFORM     uppercase legacy (single or compound) — F-DEPLOY, F-HUB-AUTH, F-FOO_BAR (F-081 heritage)
//   3. F-Deskriptiv   mixed-case with REQUIRED hyphen separator — F-Hub-Spotlight-Carousel, F-App2-Feature3
//   Each branch enforces a distinct shape so collisions like `F-deploy` (lowercase single segment)
//   are rejected — that case must be either numeric, all-uppercase, or have an explicit segment.
//   Rejects digit-leading suffixed forms — `F-076-suffix` matches NEITHER branch:
//     - branch 1 is digits-only
//     - branches 2/3 require letter-first
//   This preserves the F-076 schema invariant proven by cap-memory-schema tests.
// @cap-risk(reason:regex-asymmetry) The cap-feature-map header regex (`featureHeaderRE`) and
//   surgical-patch regex (`_surgicalSetAcStatus`'s next-header) historically used the narrower
//   F-081 pattern. F-089 widens both — keep them in sync with this constant or the parser/patcher
//   will silently skip mixed-case IDs.
const FEATURE_ID_PATTERN = /^F-(?:\d{3,}|[A-Z](?:[A-Z0-9_]*[A-Z0-9])?(?:[-_][A-Z0-9_]*[A-Z0-9])*|[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)$/;

/**
 * @typedef {Object} IndexEntry
 * @property {string} id      Feature ID (e.g. "F-001" or "F-Hub-Spotlight-Carousel")
 * @property {string} state   Feature lifecycle state
 * @property {string} title   Feature title
 */

/**
 * Validate a feature ID. Accepts legacy numeric, F-LONGFORM, and deskriptiv mixed-case forms.
 * Defense-in-depth: even if regex passes, FS-traversal characters must be absent.
 * @param {*} id
 * @returns {boolean}
 */
function validateFeatureId(id) {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  if (!FEATURE_ID_PATTERN.test(id)) return false;
  // Defense-in-depth: regex already rejects these but a future loosening must not regress.
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return true;
}

/**
 * Derive the per-feature filename (basename only) from a validated ID.
 * @param {string} id
 * @returns {string} e.g. "F-001.md"
 */
function featureFilename(id) {
  if (!validateFeatureId(id)) {
    throw new Error('cap: featureFilename — invalid feature ID: ' + JSON.stringify(id));
  }
  return id + '.md';
}

/**
 * Resolve the absolute path to the features/ directory for a given project root + optional appPath.
 * @param {string} projectRoot
 * @param {string|null|undefined} [appPath]
 * @returns {string}
 */
function featuresDirPath(projectRoot, appPath) {
  const baseDir = appPath ? path.join(projectRoot, appPath) : projectRoot;
  return path.join(baseDir, FEATURES_DIR);
}

/**
 * Resolve the absolute path to a per-feature file.
 * @param {string} projectRoot
 * @param {string} id
 * @param {string|null|undefined} [appPath]
 * @returns {string}
 */
function featureFilePath(projectRoot, id, appPath) {
  return path.join(featuresDirPath(projectRoot, appPath), featureFilename(id));
}

/**
 * Detect whether a project is in sharded mode (features/ dir exists with at least one F-*.md file).
 * Used by readFeatureMap for AC-7 backwards-compat fallback.
 * @param {string} projectRoot
 * @param {string|null|undefined} [appPath]
 * @returns {boolean}
 */
function isShardedMap(projectRoot, appPath) {
  const dir = featuresDirPath(projectRoot, appPath);
  if (!fs.existsSync(dir)) return false;
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch (_e) {
    return false;
  }
  if (!stat.isDirectory()) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_e) {
    return false;
  }
  return entries.some(e => /^F-.+\.md$/.test(e));
}

// @cap-decision(F-089/AC-1) Index line format: `- <ID> | <state> | <title>`.
//   Pipe-delimited with single-space padding. Title cannot contain `|` or newlines (validated).
//   Markdown bullet (`-`) makes the line render as a list item if the index is opened in a viewer.
const INDEX_LINE_RE = /^-\s+(F-\S+)\s*\|\s*(\w+)\s*\|\s*(.+?)\s*$/;

/**
 * Parse a single index line. Returns null on malformed input or invalid feature ID.
 * @param {string} line
 * @returns {IndexEntry|null}
 */
function parseIndexLine(line) {
  const m = INDEX_LINE_RE.exec(line);
  if (!m) return null;
  const id = m[1];
  if (!validateFeatureId(id)) return null;
  return { id, state: m[2], title: m[3].trim() };
}

/**
 * Serialize an IndexEntry to a single line.
 * @param {IndexEntry} entry
 * @returns {string}
 */
function serializeIndexEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('cap: serializeIndexEntry — entry must be an object');
  }
  if (!validateFeatureId(entry.id)) {
    throw new Error('cap: serializeIndexEntry — invalid feature ID: ' + JSON.stringify(entry.id));
  }
  if (typeof entry.state !== 'string' || entry.state.length === 0 || /\s/.test(entry.state)) {
    throw new Error('cap: serializeIndexEntry — invalid state: ' + JSON.stringify(entry.state));
  }
  if (typeof entry.title !== 'string' || entry.title.includes('|') || entry.title.includes('\n')) {
    throw new Error('cap: serializeIndexEntry — title cannot contain "|" or newlines: ' + JSON.stringify(entry.title));
  }
  return `- ${entry.id} | ${entry.state} | ${entry.title}`;
}

/**
 * Parse an index file (FEATURE-MAP.md in sharded mode) into IndexEntry[].
 * Walks the `## Features` section and collects every recognized index line.
 * Lines outside the Features section are ignored (Legend, footer, prose).
 * @param {string} content
 * @returns {IndexEntry[]}
 */
function parseIndex(content) {
  const entries = [];
  const lines = String(content).split('\n');
  let inFeaturesSection = false;
  for (const line of lines) {
    if (/^##\s+Features\s*$/i.test(line)) { inFeaturesSection = true; continue; }
    if (/^##\s/.test(line) && inFeaturesSection) { inFeaturesSection = false; continue; }
    if (!inFeaturesSection) continue;
    const entry = parseIndexLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

// @cap-decision(F-089/AC-9) Surgical patch — analog F-088 pattern. We rewrite the matched index
//   line in-place via regex substitution so the rest of the file (header, prose, Legend, footer)
//   stays byte-identical. No re-serialization of the whole index.
function _escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Surgically update one index entry. Returns hit:false if the ID is not present (caller appends).
 * Validates the new title before writing — pipe/newline rejected as a hit:false miss to force
 * the caller into the explicit append path or surface the error.
 *
 * @param {string} content
 * @param {string} id
 * @param {{ state?: string, title?: string }} fields
 * @returns {{ content: string, hit: boolean }}
 */
function _updateIndexEntry(content, id, fields) {
  if (!validateFeatureId(id)) return { content, hit: false };
  const escapedId = _escapeRegex(id);
  // Match: `- F-NNN | state | title` (allowing leading whitespace tolerance for hand-edited files).
  const re = new RegExp(
    '^(\\s*-\\s+' + escapedId + '\\s*\\|\\s*)(\\w+)(\\s*\\|\\s*)([^\\n]*?)(\\s*)$',
    'm'
  );
  const m = re.exec(content);
  if (!m) return { content, hit: false };
  const newState = fields && typeof fields.state === 'string' ? fields.state : m[2];
  const newTitle = fields && typeof fields.title === 'string' ? fields.title : m[4];
  if (/\s/.test(newState) || newState.length === 0) return { content, hit: false };
  if (newTitle.includes('|') || newTitle.includes('\n')) return { content, hit: false };
  const replaced = content.replace(re, (_full, prefix, _state, sep, _title, trailing) => {
    return prefix + newState + sep + newTitle + trailing;
  });
  return { content: replaced, hit: true };
}

/**
 * Append a new entry into the `## Features` section of the index, keeping the section anchor
 * intact. If the section doesn't exist (template malformed), returns hit:false.
 * The append point is just before the next `##`-level header (or end-of-content if none).
 *
 * @param {string} content
 * @param {IndexEntry} entry
 * @returns {{ content: string, hit: boolean }}
 */
function _appendIndexEntry(content, entry) {
  const line = serializeIndexEntry(entry); // throws on invalid input — appropriate at this boundary
  const lines = String(content).split('\n');
  // Find the start of the `## Features` section.
  let featuresStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Features\s*$/i.test(lines[i])) { featuresStart = i; break; }
  }
  if (featuresStart === -1) return { content, hit: false };
  // Find the end of the Features section: the next `## ...` header, or end-of-file.
  let featuresEnd = lines.length;
  for (let i = featuresStart + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { featuresEnd = i; break; }
  }
  // Insert position: just before featuresEnd, but trim trailing blanks within the section first
  // so we don't accumulate blank lines on repeated appends.
  let insertAt = featuresEnd;
  while (insertAt > featuresStart + 1 && lines[insertAt - 1].trim() === '') insertAt--;
  // Build new lines: keep through insertAt-1, splice in the entry line, then the rest.
  // We do NOT add a trailing blank — `after` (the slice from insertAt onward) typically
  // starts with the section's existing blank-line padding before the next `##` header,
  // so we'd otherwise accumulate blank lines on every append.
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  return { content: before.concat([line], after).join('\n'), hit: true };
}

/**
 * Serialize a complete index file from scratch (header + Features section + Legend + footer).
 * Used by the migrator to build the initial index after sharding. Surgical patches handle
 * subsequent updates so this serializer is only called on full rebuilds.
 *
 * @param {IndexEntry[]} entries
 * @param {{ now?: () => Date }} [options]
 * @returns {string}
 */
function serializeIndex(entries, options) {
  const now = options && typeof options.now === 'function' ? options.now() : new Date();
  const lines = [
    '# Feature Map',
    '',
    '> Single source of truth — sharded layout (F-089). Each feature has its own file in `features/<ID>.md`.',
    '> The index below lists every feature with id, state, and title; load the per-feature file for full details.',
    '',
    '## Features',
    '',
  ];
  if (Array.isArray(entries) && entries.length > 0) {
    for (const e of entries) lines.push(serializeIndexEntry(e));
    lines.push('');
  } else {
    lines.push('<!-- No features yet. Run /cap:brainstorm or add features. -->');
    lines.push('');
  }
  lines.push('## Legend');
  lines.push('');
  lines.push('| State | Meaning |');
  lines.push('|-------|---------|');
  lines.push('| planned | Feature identified, not yet implemented |');
  lines.push('| prototyped | Initial implementation exists |');
  lines.push('| tested | Tests written and passing |');
  lines.push('| shipped | Deployed / merged to main |');
  lines.push('');
  lines.push('---');
  lines.push(`*Last updated: ${now.toISOString()}*`);
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  // Constants
  FEATURES_DIR,
  FEATURE_MAP_FILE,
  MAX_ID_LENGTH,
  FEATURE_ID_PATTERN,
  // Validation + path helpers
  validateFeatureId,
  featureFilename,
  featuresDirPath,
  featureFilePath,
  isShardedMap,
  // Index parse/serialize
  parseIndexLine,
  serializeIndexEntry,
  parseIndex,
  serializeIndex,
  // Surgical updates
  _updateIndexEntry,
  _appendIndexEntry,
  // Internal (exposed for tests)
  _escapeRegex,
};
