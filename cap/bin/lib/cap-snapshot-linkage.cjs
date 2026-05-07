// @cap-feature(feature:F-079, primary:true) Snapshot-Linkage to Features and Platform —
// wires .cap/snapshots/* into the F-076 memory layer.
//
// @cap-context This module owns the contract between snapshot creation (cap:save) and the
// per-feature / platform memory files. AC-1..AC-3 cover the WRITE-time linkage (frontmatter
// + soft-warn), AC-4 covers the pipeline-time idempotent re-linking, AC-5 covers the F-077
// migration heuristic for legacy orphans, and AC-6 covers the unassigned fallback bucket.
//
// @cap-context Auto-block contract: snapshot references live in their OWN auto-managed
// marker pair (`<!-- @auto-block linked_snapshots -->` ... `<!-- /@auto-block -->`),
// distinct from F-076's `<!-- cap:auto:start -->` block. F-076's parser/serializer is
// authoritative for decisions+pitfalls; touching it would change a shipped contract for
// every consumer. Snapshots get their own block so the two markers stay decoupled and
// either can evolve without breaking the other. Spec wording "Auto-Block des Per-Feature-
// Files unter Sektion linked_snapshots" is honored: `linked_snapshots` IS its own
// auto-managed block, just a sibling of F-076's auto-block rather than nested inside it.
//
// @cap-decision(F-079/AC-4) Auto-block isolation — `linked_snapshots` uses dedicated
// marker pair `<!-- @auto-block linked_snapshots -->` ... `<!-- /@auto-block -->` separate
// from F-076's `cap:auto:start/end`. Trade-off: two marker pairs in the same file vs.
// modifying the shipped F-076 schema parser. Two pairs keep blast radius zero — F-076
// tests stay green and any future block type (e.g. F-080 claude-native bridge) can reuse
// the same `@auto-block <name>` pattern without needing a parser change.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const session = require('./cap-session.cjs');
const schema = require('./cap-memory-schema.cjs');
const platformLib = require('./cap-memory-platform.cjs');
const { _atomicWriteFile } = require('./cap-memory-migrate.cjs');

// -------- Constants --------

// @cap-decision(F-079/D1) Snapshot directory is fixed at .cap/snapshots/. Mirrors F-077's
// SNAPSHOTS_DIR (defined inline there) — single contract across modules.
const SNAPSHOTS_DIR = path.join('.cap', 'snapshots');

// @cap-decision(F-079/D2) Linked-snapshots section uses its own marker pair inside the
// per-feature OR platform file. Format `<!-- @auto-block linked_snapshots -->` ...
// `<!-- /@auto-block -->`. The `@auto-block <name>` shape is intentionally generic so
// F-080 / future features can mount more named auto-managed blocks without inventing
// new marker conventions.
const LINKED_SNAPSHOTS_BLOCK_NAME = 'linked_snapshots';
const LINKED_SNAPSHOTS_START = `<!-- @auto-block ${LINKED_SNAPSHOTS_BLOCK_NAME} -->`;
const LINKED_SNAPSHOTS_END = '<!-- /@auto-block -->';

// @cap-decision(F-079/D3) snapshot-name slug regex: lowercase kebab-case alphanumerics,
// optionally allows internal `.` segments only via `_` (i.e. NO dots). Mirrors F-076's
// TOPIC_RE shape but tightened to forbid path-traversal byte forms. Snapshots traditionally
// embed dates (`2026-05-06-foo`) which the kebab regex already accepts.
const SNAPSHOT_NAME_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

// @cap-decision(F-079/D4) Date-window for the migration heuristic (AC-5). 24h matches
// F-077's classifySnapshot SNAPSHOT_DATE_WINDOW_HOURS — same heuristic, same window. If a
// future tightening is needed, change it once here.
const SNAPSHOT_DATE_WINDOW_HOURS = 24;

// @cap-decision(F-079/D5) Unassigned snapshots topic name matches F-077's
// UNASSIGNED_SNAPSHOTS_TOPIC for cross-module consistency. Spec AC-6 names this file
// explicitly as `.cap/memory/platform/snapshots-unassigned.md`.
const UNASSIGNED_SNAPSHOTS_TOPIC = 'snapshots-unassigned';

// -------- Defensive helpers --------

// @cap-decision(F-079/iter1) Stage-2 #2: ANSI/control-byte sanitization for any user-supplied
// string that flows into stderr/throw messages. Mirrors cap-memory-platform.cjs:_safeForError
// — kept local so a refactor in one module can't silently weaken the defense in another.
function _safeForError(value) {
  if (typeof value !== 'string') return String(value);
  return value.replace(/[^\x20-\x7E]/g, '?').slice(0, 64);
}

// @cap-risk(reason:path-traversal-via-snapshot-name) Snapshot file paths are concatenated
// from a user-supplied snapshot name. Reject path separators, NUL bytes, and traversal
// sequences explicitly even though the slug regex would already catch them. Defense-in-depth
// matching F-078's _validateSlug pattern.
function _validateSnapshotName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError(`snapshot name must be a non-empty string (got ${typeof name})`);
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new TypeError(`snapshot name must not contain path separators or traversal sequences (got "${_safeForError(name)}")`);
  }
  if (!SNAPSHOT_NAME_RE.test(name)) {
    throw new TypeError(`snapshot name must be kebab-case (got "${_safeForError(name)}")`);
  }
}

// @cap-risk(reason:proto-pollution-via-frontmatter) Topic / featureId values land inside
// frontmatter strings. parseSimpleYaml already strips __proto__/constructor/prototype keys,
// but defense-in-depth: reject the strings themselves if they match those reserved tokens
// when used as a topic/feature.
function _validateTopic(topic) {
  if (typeof topic !== 'string' || topic.length === 0) {
    throw new TypeError(`topic must be a non-empty string (got ${typeof topic})`);
  }
  if (topic === '__proto__' || topic === 'constructor' || topic === 'prototype') {
    throw new TypeError(`topic name reserved (got "${_safeForError(topic)}")`);
  }
  if (topic.includes('/') || topic.includes('\\') || topic.includes('..') || topic.includes('\0')) {
    throw new TypeError(`topic must not contain path separators or traversal sequences (got "${_safeForError(topic)}")`);
  }
  if (!platformLib.PLATFORM_TOPIC_RE.test(topic)) {
    throw new TypeError(`topic must be kebab-case slug (got "${_safeForError(topic)}")`);
  }
}

// @cap-decision(F-079/iter1) Stage-2 #3 fix: F-076-style "marker line must contain ONLY
//   the marker after trim". Returns ALL byte offsets of qualifying marker lines so the
//   caller can both pair start/end AND detect duplicate-block accidents.
/**
 * @param {string} content
 * @param {string} marker
 * @returns {{offset:number, lineNo:number}[]}
 */
function _findMarkerLinePositions(content, marker) {
  /** @type {{offset:number, lineNo:number}[]} */
  const out = [];
  // Iterate manually so we can track byte offsets without regex zero-length match traps.
  let cursor = 0;
  let lineNo = 0;
  while (cursor <= content.length) {
    let nl = content.indexOf('\n', cursor);
    if (nl === -1) nl = content.length;
    const lineStart = cursor;
    let line = content.slice(lineStart, nl);
    // Tolerate CRLF — strip a trailing \r from the line content.
    if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
    lineNo++;
    const trimmed = line.replace(/^\s+|\s+$/g, '');
    if (trimmed === marker) {
      const markerCol = line.indexOf(marker);
      out.push({ offset: lineStart + (markerCol >= 0 ? markerCol : 0), lineNo });
    }
    if (nl === content.length) break;
    cursor = nl + 1;
  }
  return out;
}

// -------- Snapshot frontmatter helpers --------

/**
 * @typedef {Object} SnapshotFrontmatter
 * @property {string=} session
 * @property {string=} date
 * @property {string=} branch
 * @property {string=} source
 * @property {string=} feature   - F-NNN id (mutually exclusive with `platform`)
 * @property {string=} platform  - kebab-case topic (mutually exclusive with `feature`)
 */

/**
 * @typedef {Object} SnapshotRecord
 * @property {string} name        - basename without .md
 * @property {string} relPath     - .cap/snapshots/<name>.md (forward-slash form)
 * @property {string} absPath
 * @property {SnapshotFrontmatter} frontmatter
 * @property {string} title       - first H1 if any, else name
 * @property {string} raw         - full file content
 */

// @cap-todo(ac:F-079/AC-1) parseSnapshotFile reads a single .cap/snapshots/<name>.md and
//   returns its frontmatter (incl. feature/platform routing) + title.
/**
 * @param {string} projectRoot
 * @param {string} snapshotName
 * @returns {SnapshotRecord|null}
 */
function parseSnapshotFile(projectRoot, snapshotName) {
  _validateSnapshotName(snapshotName);
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  const absPath = path.join(projectRoot, SNAPSHOTS_DIR, `${snapshotName}.md`);
  if (!fs.existsSync(absPath)) return null;
  const raw = fs.readFileSync(absPath, 'utf8');
  return _parseSnapshotContent(snapshotName, absPath, raw);
}

/**
 * @param {string} snapshotName
 * @param {string} absPath
 * @param {string} raw
 * @returns {SnapshotRecord}
 */
function _parseSnapshotContent(snapshotName, absPath, raw) {
  /** @type {SnapshotFrontmatter} */
  const fm = Object.create(null);
  // @cap-decision(F-079/D6) Reuse a minimal YAML extractor here rather than depend on
  // cap-memory-schema's parseFeatureMemoryFile — snapshot frontmatter is plain key:value
  // (no inline arrays today) and doesn't carry F-076's auto-block markers. Keeping this
  // local avoids a bidirectional dep on F-076 just to read 5 scalars.
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const body = fmMatch[1];
    const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      if (RESERVED.has(key)) continue;
      const val = (m[2] || '').replace(/^["']|["']$/g, '').trim();
      if (key === 'session') fm.session = val;
      else if (key === 'date') fm.date = val;
      else if (key === 'branch') fm.branch = val;
      else if (key === 'source') fm.source = val;
      else if (key === 'feature') fm.feature = val;
      else if (key === 'platform') fm.platform = val;
    }
  }
  // Title: first H1.
  let title = snapshotName;
  const h1 = raw.match(/^#\s+(.+?)\s*$/m);
  if (h1) title = h1[1].trim();

  return {
    name: snapshotName,
    relPath: `${SNAPSHOTS_DIR.replace(/\\/g, '/')}/${snapshotName}.md`,
    absPath,
    frontmatter: fm,
    title,
    raw,
  };
}

// @cap-todo(ac:F-079/AC-1) listSnapshots enumerates snapshot basenames (without .md).
/**
 * @param {string} projectRoot
 * @returns {string[]} sorted list of snapshot basenames (no extension)
 */
function listSnapshots(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  const dir = path.join(projectRoot, SNAPSHOTS_DIR);
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
  /** @type {string[]} */
  const out = [];
  for (const e of entries) {
    if (!e || typeof e.name !== 'string') continue;
    if (e.isDirectory && e.isDirectory()) continue;
    if (!e.name.endsWith('.md')) continue;
    const slug = e.name.slice(0, -3);
    // Defensive: skip files whose name fails the slug regex — they could be hand-edited
    // experiments and we don't want them to crash listSnapshots, just to be ignored.
    if (!SNAPSHOT_NAME_RE.test(slug)) continue;
    out.push(slug);
  }
  out.sort();
  return out;
}

// -------- AC-1/AC-2/AC-3: Save-time options resolution --------

/**
 * @typedef {Object} SaveOptions
 * @property {boolean=} unassigned  - --unassigned flag
 * @property {string=} platform     - --platform=<topic> flag value (if present)
 * @property {string=} _explicitFeatureOverride  - test-only seam (not a CLI flag); lets unit
 *   tests drive the explicit-feature branch without writing SESSION.json. Public CLI surface
 *   per AC-2 stays at exactly two flags: --unassigned and --platform=<topic>.
 * @property {string=} activeFeature - injected active feature ID (test seam — defaults to SESSION.json)
 */

/**
 * @typedef {Object} ResolvedLinkage
 * @property {'feature'|'platform'|'unassigned'} kind
 * @property {string|null} featureId
 * @property {string|null} topic
 * @property {string|null} warning  - non-null = soft-warn message (AC-3)
 * @property {Partial<SnapshotFrontmatter>} frontmatterPatch
 */

// @cap-feature(feature:F-079) resolveLinkageOptions — AC-1+AC-2+AC-3 single dispatcher.
//
// @cap-todo(ac:F-079/AC-1) When neither --unassigned nor --platform= is given, default to
//   reading activeFeature from SESSION.json. If present, link the snapshot to that feature.
// @cap-todo(ac:F-079/AC-2) --unassigned and --platform=<topic> are mutually exclusive. Both
//   together → loud parse-error (caller surfaces via process.exitCode + stderr).
// @cap-todo(ac:F-079/AC-3) Soft-warn (no fail) emits when the explicit --unassigned flag is
//   set OR when no activeFeature is in SESSION.json. The snapshot is always created.
// @cap-decision(F-079/AC-2) Mutually-exclusive flags throw early via TypeError so the caller
//   surfaces the error before any filesystem write happens. cap:save then exits non-zero with
//   stderr — the snapshot is NOT created on parse-error. This is a HARD-fail (parse error),
//   distinct from AC-3's SOFT-warn (linkage missing).
// @cap-decision(F-079/AC-3) Soft-warn rationale: snapshot creation is best-effort linkage.
//   The user's primary intent is to capture context; failing the save because we can't link
//   would lose data. Linkage failures emit on stderr and are non-fatal.

/**
 * Resolve the linkage options for a cap:save invocation.
 *
 * @param {string} projectRoot
 * @param {SaveOptions=} options
 * @returns {ResolvedLinkage}
 */
function resolveLinkageOptions(projectRoot, options) {
  const opts = options || {};
  const unassigned = opts.unassigned === true;
  const platformRaw = (typeof opts.platform === 'string' && opts.platform.length > 0)
    ? opts.platform
    : null;
  // @cap-decision(F-079/iter1) Stage-2 #4 fix: test-only seam renamed from `feature` to
  //   `_explicitFeatureOverride` so the public API surface signals "this is NOT a CLI flag".
  //   commands/cap/save.md exposes only --unassigned and --platform= per AC-2; the seam
  //   exists purely to keep unit tests deterministic without writing SESSION.json on disk.
  const explicitFeature = (typeof opts._explicitFeatureOverride === 'string' && opts._explicitFeatureOverride.length > 0)
    ? opts._explicitFeatureOverride
    : null;

  // AC-2: mutually-exclusive flag combinations.
  if (unassigned && platformRaw) {
    // Loud parse error — caller decides exit semantics.
    throw new TypeError('cap:save: --unassigned and --platform=<topic> are mutually exclusive — pick one');
  }
  if (unassigned && explicitFeature) {
    throw new TypeError('cap:save: --unassigned and explicit feature override are mutually exclusive — pick one');
  }
  if (platformRaw && explicitFeature) {
    throw new TypeError('cap:save: --platform=<topic> and explicit feature override are mutually exclusive — pick one');
  }

  // AC-2 platform branch: validate topic shape and route.
  if (platformRaw !== null) {
    _validateTopic(platformRaw);
    return {
      kind: 'platform',
      featureId: null,
      topic: platformRaw,
      warning: null,
      frontmatterPatch: { platform: platformRaw },
    };
  }

  // AC-2 / AC-3 unassigned branch: explicit user intent → soft-warn + no link.
  if (unassigned) {
    return {
      kind: 'unassigned',
      featureId: null,
      topic: null,
      warning: 'cap:save: --unassigned set; snapshot will not be linked to any feature or platform topic',
      frontmatterPatch: {},
    };
  }

  // AC-2 explicit-feature branch (test seam — opts._explicitFeatureOverride; NOT a CLI flag).
  if (explicitFeature !== null) {
    if (!schema.FEATURE_ID_RE.test(explicitFeature)) {
      throw new TypeError(`cap:save: explicit feature override must match feature id regex (got "${_safeForError(explicitFeature)}")`);
    }
    return {
      kind: 'feature',
      featureId: explicitFeature,
      topic: null,
      warning: null,
      frontmatterPatch: { feature: explicitFeature },
    };
  }

  // AC-1 default: read activeFeature from SESSION.json.
  // @cap-decision(F-079/iter1) Test seam: opts.activeFeature wins over SESSION.json so unit
  //   tests can drive every branch without writing a SESSION.json file each time. In production
  //   this field is never set by the cap:save command — only by tests.
  let activeFeature = (typeof opts.activeFeature === 'string' && opts.activeFeature.length > 0)
    ? opts.activeFeature
    : null;
  if (activeFeature === null) {
    try {
      const sess = session.loadSession(projectRoot);
      if (sess && typeof sess.activeFeature === 'string' && sess.activeFeature.length > 0) {
        activeFeature = sess.activeFeature;
      }
    } catch (_e) {
      // loadSession is supposed to be defensive; ignore any unexpected error.
    }
  }
  if (activeFeature !== null) {
    if (!schema.FEATURE_ID_RE.test(activeFeature)) {
      // SESSION.json had a malformed activeFeature — soft-warn rather than throw because the
      // user didn't supply this directly; treat as "no link available".
      return {
        kind: 'unassigned',
        featureId: null,
        topic: null,
        warning: `cap:save: activeFeature in SESSION.json ("${_safeForError(activeFeature)}") does not match feature-id regex; saving without linkage`,
        frontmatterPatch: {},
      };
    }
    return {
      kind: 'feature',
      featureId: activeFeature,
      topic: null,
      warning: null,
      frontmatterPatch: { feature: activeFeature },
    };
  }

  // AC-3: no activeFeature → soft-warn + unassigned.
  return {
    kind: 'unassigned',
    featureId: null,
    topic: null,
    warning: 'cap:save: no activeFeature set in SESSION.json and no --feature/--platform/--unassigned flag; snapshot will be saved without linkage',
    frontmatterPatch: {},
  };
}

// @cap-feature(feature:F-079) injectLinkageFrontmatter — pure helper that takes a raw snapshot
//   markdown body (with or without existing frontmatter) and returns a new body with the
//   linkage fields merged into frontmatter. Used by cap:save (test seam: keeps the file-IO
//   path separate from string transformation).
//
// @cap-decision(F-079/D7) Always emit `feature:` OR `platform:` (or neither for unassigned)
//   in the frontmatter of the snapshot file. Never emit both — the resolver guarantees that.
//   When a snapshot is saved as `--unassigned`, no linkage line is added at all (rather than
//   emitting `feature: null`), so the F-077 migration heuristic later sees a true orphan.

/**
 * @param {string} body - existing snapshot markdown content
 * @param {Partial<SnapshotFrontmatter>} patch
 * @returns {string} new body with patch applied
 */
function injectLinkageFrontmatter(body, patch) {
  if (typeof body !== 'string') {
    throw new TypeError('body must be a string');
  }
  if (!patch || typeof patch !== 'object') {
    return body;
  }
  // Strip any existing feature: / platform: lines from frontmatter (re-write).
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    // No frontmatter at all — synthesize a minimal block.
    const lines = ['---'];
    if (patch.feature) lines.push(`feature: ${patch.feature}`);
    if (patch.platform) lines.push(`platform: ${patch.platform}`);
    if (lines.length === 1) {
      // No additions — return body verbatim.
      return body;
    }
    lines.push('---');
    return `${lines.join('\n')}\n\n${body}`;
  }
  const fmBody = fmMatch[1];
  const filtered = fmBody.split(/\r?\n/).filter((line) => {
    return !/^(feature|platform)\s*:/.test(line.trim());
  });
  if (patch.feature) filtered.push(`feature: ${patch.feature}`);
  if (patch.platform) filtered.push(`platform: ${patch.platform}`);
  // Reconstruct the closing fence with the exact same trailing newline shape the original
  // had (match either `\n---\n` or `\n---\n` at end of fm). fmMatch[0] already includes any
  // trailing newline after the closing `---`, so we just splice from there.
  const newFm = `---\n${filtered.join('\n')}\n---\n`;
  const rest = body.slice(fmMatch[0].length);
  return newFm + rest;
}

// -------- AC-4: Linked-snapshot block parsing/rendering --------

/**
 * @typedef {Object} LinkedSnapshotEntry
 * @property {string} name
 * @property {string|null} date    - ISO date (or short YYYY-MM-DD) extracted from frontmatter
 * @property {string|null} branch  - branch from snapshot frontmatter (display only)
 */

// @cap-todo(ac:F-079/AC-4) parseLinkedSnapshotsBlock locates the dedicated marker pair in a
//   target file and returns the parsed entries (idempotent re-write contract).
//
// @cap-decision(F-079/iter1) Stage-2 #3 fix: parser hardened against in-prose mentions and
//   duplicate blocks — mirrors F-076's `_countMarkerLines` semantics (marker must be the
//   ENTIRE trimmed line) so a Lessons section that documents the marker text doesn't get
//   picked up as a marker. Two `<!-- @auto-block linked_snapshots -->` markers in the same
//   file → loud throw with both line-positions (F-082 lesson: silent drop is the worst
//   failure mode; loud-failure is the contract).
/**
 * @param {string} content
 * @returns {{startIdx:number, endIdx:number, entries:LinkedSnapshotEntry[]}|null}
 */
function parseLinkedSnapshotsBlock(content) {
  if (typeof content !== 'string') return null;
  // Find marker lines where the marker IS the entire trimmed line content (mirrors
  // cap-memory-schema.cjs:_countMarkerLines). This ignores in-prose mentions (e.g. inside
  // a code-fence in the manual region) that would otherwise collide with bare indexOf.
  const startLines = _findMarkerLinePositions(content, LINKED_SNAPSHOTS_START);
  const endLines = _findMarkerLinePositions(content, LINKED_SNAPSHOTS_END);
  if (startLines.length === 0 || endLines.length === 0) return null;
  if (startLines.length > 1) {
    throw new Error(
      `parseLinkedSnapshotsBlock: expected exactly one ${LINKED_SNAPSHOTS_START}, found ${startLines.length} ` +
      `(at byte offsets ${startLines.map((p) => p.offset).join(', ')})`
    );
  }
  const startIdx = startLines[0].offset;
  // Pair with the first end-marker AFTER the start-marker.
  const pairedEnd = endLines.find((p) => p.offset > startIdx + LINKED_SNAPSHOTS_START.length);
  if (!pairedEnd) return null;
  const endIdx = pairedEnd.offset;
  const body = content.slice(startIdx + LINKED_SNAPSHOTS_START.length, endIdx);
  /** @type {LinkedSnapshotEntry[]} */
  const entries = [];
  const lineRe = /^-\s+([a-z0-9][a-z0-9_-]*)\s*(?:\(([^)]+)\))?\s*$/i;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^\s+|\s+$/g, '');
    if (!line.startsWith('- ')) continue;
    const m = line.match(lineRe);
    if (!m) continue;
    const name = m[1];
    let date = null;
    let branch = null;
    if (m[2]) {
      // metadata is "<date>, branch: <branch>" or "<date>" or "branch: <branch>"
      const parts = m[2].split(',').map((s) => s.trim());
      for (const p of parts) {
        const bm = p.match(/^branch:\s*(.+)$/i);
        if (bm) branch = bm[1].trim();
        else if (/^\d{4}-\d{2}-\d{2}/.test(p)) date = p;
      }
    }
    entries.push({ name, date, branch });
  }
  return { startIdx, endIdx: endIdx + LINKED_SNAPSHOTS_END.length, entries };
}

// @cap-todo(ac:F-079/AC-4) renderLinkedSnapshotsBlock emits a stable, sorted, deduped block.
//   Same input → byte-identical output (idempotent contract).
//
// @cap-decision(F-079/AC-4) Sort by (date asc, name asc) so a re-run with the same set of
//   snapshots produces identical output. Dedup by snapshot name. Empty list → still emit
//   the marker pair on their own lines (with one blank between) so a future snapshot has
//   a stable insertion point and the round-trip is byte-stable on no-snapshots. (Stage-2
//   #3: empty-block-injection guard.)
/**
 * @param {LinkedSnapshotEntry[]} entries
 * @returns {string}
 */
function renderLinkedSnapshotsBlock(entries) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  // Dedup by name — last write wins on metadata.
  const byName = new Map();
  for (const e of list) {
    if (!e || typeof e.name !== 'string') continue;
    byName.set(e.name, {
      name: e.name,
      date: (e.date && /^\d{4}-\d{2}-\d{2}/.test(e.date)) ? e.date.slice(0, 10) : null,
      branch: typeof e.branch === 'string' && e.branch.length > 0 ? e.branch : null,
    });
  }
  const sorted = [...byName.values()].sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da !== db) return da < db ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  const lines = [LINKED_SNAPSHOTS_START];
  if (sorted.length === 0) {
    // Empty body — keep the marker pair compact (one blank line between markers) so the
    // parser still finds them and the round-trip is byte-stable.
    lines.push('');
  } else {
    for (const e of sorted) {
      const meta = [];
      if (e.date) meta.push(e.date);
      if (e.branch) meta.push(`branch: ${e.branch}`);
      const suffix = meta.length > 0 ? ` (${meta.join(', ')})` : '';
      lines.push(`- ${e.name}${suffix}`);
    }
  }
  lines.push(LINKED_SNAPSHOTS_END);
  return lines.join('\n');
}

// @cap-feature(feature:F-079) upsertLinkedSnapshotsBlock — pure string-level merge.
//   Returns new file content with the linked_snapshots block updated. Idempotent.
/**
 * @param {string} content - existing target file content
 * @param {LinkedSnapshotEntry[]} entries - the FULL desired set (not a delta)
 * @returns {string}
 */
function upsertLinkedSnapshotsBlock(content, entries) {
  if (typeof content !== 'string') {
    throw new TypeError('content must be a string');
  }
  const block = renderLinkedSnapshotsBlock(entries);
  const existing = parseLinkedSnapshotsBlock(content);
  if (existing) {
    return content.slice(0, existing.startIdx) + block + content.slice(existing.endIdx);
  }
  // No block yet — append after the F-076 auto-block end-marker if present, else at EOF.
  const autoEnd = content.indexOf(schema.AUTO_BLOCK_END_MARKER);
  if (autoEnd !== -1) {
    const after = autoEnd + schema.AUTO_BLOCK_END_MARKER.length;
    // Insert with a leading blank line so it doesn't fuse onto the auto-block's end marker.
    const sep = content.charAt(after) === '\n' ? '\n' : '\n\n';
    return content.slice(0, after) + sep + block + (content.charAt(after) === '\n' ? '\n' : '') + content.slice(after);
  }
  // No auto-block either — append to EOF with a separating blank.
  const trailer = content.endsWith('\n') ? '' : '\n';
  return `${content}${trailer}\n${block}\n`;
}

// -------- AC-4: Per-feature / platform linker (file IO) --------

/**
 * @typedef {Object} LinkResult
 * @property {boolean} updated
 * @property {string} reason   - 'wrote' | 'byte-identical-noop' | 'target-missing-stub-created'
 * @property {string} path     - absolute path of the target file
 */

// @cap-todo(ac:F-079/AC-4) linkSnapshotToFeature appends the snapshot to the per-feature
//   memory file's linked_snapshots block. Idempotent: re-running with the same input is a
//   no-op.
//
// @cap-decision(F-079/iter1) Stage-2 #5: return {updated, reason, path} instead of bare void
//   so callers (pipeline, tests) can tell apart wrote / no-op / stub-created without
//   re-reading the file. Mirrors writePlatformTopic's contract.
//
// @cap-decision(F-079/AC-4) Auto-create stub per-feature file when missing. The pipeline
//   may run before any other memory has been written for a feature; we want the snapshot
//   linkage to land regardless. Stub uses F-076 frontmatter (feature/topic/updated) +
//   empty F-076 auto-block + linked_snapshots block. Schema-valid but minimal.
/**
 * @param {string} projectRoot
 * @param {string} featureId  - F-NNN
 * @param {string} topic      - kebab-case topic for the per-feature file
 * @param {LinkedSnapshotEntry[]} entries - FULL desired entry set
 * @returns {LinkResult}
 */
function linkSnapshotsToFeature(projectRoot, featureId, topic, entries) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  if (!schema.FEATURE_ID_RE.test(featureId)) {
    throw new TypeError(`featureId must match feature-id regex (got "${_safeForError(featureId)}")`);
  }
  if (!schema.TOPIC_RE.test(topic)) {
    throw new TypeError(`topic must be kebab-case (got "${_safeForError(topic)}")`);
  }
  const featurePath = schema.getFeaturePath(projectRoot, featureId, topic);
  let existing;
  let stubCreated = false;
  if (fs.existsSync(featurePath)) {
    existing = fs.readFileSync(featurePath, 'utf8');
  } else {
    // Try to find any existing per-feature file for this featureId — topic may differ.
    const featuresDir = path.join(projectRoot, schema.MEMORY_FEATURES_DIR);
    const found = _findFeatureFileForId(featuresDir, featureId);
    if (found) {
      existing = fs.readFileSync(found, 'utf8');
      // Honor the on-disk topic so we don't fork a sibling file.
      const newPath = found;
      const next = upsertLinkedSnapshotsBlock(existing, entries);
      if (next === existing) {
        return { updated: false, reason: 'byte-identical-noop', path: newPath };
      }
      _atomicWriteFile(newPath, next);
      return { updated: true, reason: 'wrote', path: newPath };
    }
    // No file at all — synthesize a stub using the requested topic.
    existing = _renderFeatureStub(featureId, topic);
    stubCreated = true;
  }
  const next = upsertLinkedSnapshotsBlock(existing, entries);
  if (!stubCreated && next === existing) {
    return { updated: false, reason: 'byte-identical-noop', path: featurePath };
  }
  _atomicWriteFile(featurePath, next);
  return {
    updated: true,
    reason: stubCreated ? 'target-missing-stub-created' : 'wrote',
    path: featurePath,
  };
}

// @cap-todo(ac:F-079/AC-4) linkSnapshotsToPlatform appends snapshots to a platform-topic
//   memory file's linked_snapshots block. Same idempotent contract as the feature linker.
/**
 * @param {string} projectRoot
 * @param {string} topic  - platform topic slug
 * @param {LinkedSnapshotEntry[]} entries
 * @returns {LinkResult}
 */
function linkSnapshotsToPlatform(projectRoot, topic, entries) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  _validateTopic(topic);
  const platformPath = platformLib.getPlatformTopicPath(projectRoot, topic);
  let existing;
  let stubCreated = false;
  if (fs.existsSync(platformPath)) {
    existing = fs.readFileSync(platformPath, 'utf8');
  } else {
    existing = platformLib.renderPlatformTopic({ topic, updated: new Date().toISOString() });
    stubCreated = true;
  }
  const next = upsertLinkedSnapshotsBlock(existing, entries);
  if (!stubCreated && next === existing) {
    return { updated: false, reason: 'byte-identical-noop', path: platformPath };
  }
  _atomicWriteFile(platformPath, next);
  return {
    updated: true,
    reason: stubCreated ? 'target-missing-stub-created' : 'wrote',
    path: platformPath,
  };
}

/**
 * Search .cap/memory/features/ for any file whose basename starts with `<featureId>-`.
 * Returns the absolute path or null. Defensive against empty/missing dir.
 * @param {string} featuresDir
 * @param {string} featureId
 * @returns {string|null}
 */
function _findFeatureFileForId(featuresDir, featureId) {
  if (!fs.existsSync(featuresDir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(featuresDir);
  } catch (_e) {
    return null;
  }
  const prefix = `${featureId}-`;
  for (const name of entries) {
    if (typeof name !== 'string') continue;
    if (!name.endsWith('.md')) continue;
    if (name.startsWith(prefix)) return path.join(featuresDir, name);
  }
  return null;
}

/**
 * Synthesize a minimal F-076-shaped per-feature memory file body. Schema-valid: feature +
 * topic + updated + empty auto-block + empty manual region.
 * @param {string} featureId
 * @param {string} topic
 * @returns {string}
 */
function _renderFeatureStub(featureId, topic) {
  const updated = new Date().toISOString();
  const titleCase = topic.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return [
    '---',
    `feature: ${featureId}`,
    `topic: ${topic}`,
    `updated: ${updated}`,
    '---',
    '',
    `# ${featureId}: ${titleCase}`,
    '',
    schema.AUTO_BLOCK_START_MARKER,
    schema.AUTO_BLOCK_END_MARKER,
    '',
    '## Lessons',
    '',
    '<!-- Manual lessons go here. The auto-block above is regenerated by the memory pipeline. -->',
    '',
  ].join('\n');
}

// -------- AC-5: Migration heuristic (date + state-transitions) --------
//
// @cap-decision(F-079/iter1) Stage-2 #2 fix: AC-5 duplicate consolidated via Option A.
//   The previous F-079 prototype shipped a pure helper `assignSnapshotByDate(date, transitions)`
//   that duplicated the date-proximity branch of F-077's `classifySnapshot` in
//   cap-memory-migrate.cjs:716-808. F-077's classifier is the SINGLE SOURCE OF TRUTH for
//   "snapshot date heuristic" — it covers strictly more cases (frontmatter feature wins,
//   date-proximity-single, date-proximity-multi, title F-NNN fallback, no-signal → unassigned)
//   AND is the only one wired into the actual migration plan (`migrateMemory()`). Shipping a
//   second copy created a maintenance hazard: a future tweak to one would silently diverge
//   from the other.
//
//   Option A chosen (delete F-079's helper) over Option B (refactor F-077 to delegate) because:
//     1. F-077's classifier has materially MORE behavior (frontmatter + multi-candidate +
//        title-F-NNN), so it can't simply call assignSnapshotByDate as a primitive.
//     2. F-077's `classifySnapshot` is already pinned by 4 tests in cap-memory-migrate.test.cjs
//        (frontmatter wins / date-proximity / title fallback / no-signal). Migrating F-079's
//        boundary-determinism case (two transitions at the same timestamp → secondary sort by
//        featureId) into the F-077 test file as a new `it()` keeps that pin alive.
//     3. F-077 already runs the migration end-to-end. AC-5 spec wording "Migration aus F-077
//        MUSS Datum + State-Transitions ... nutzen" is already honored by F-077 — AC-5 is now
//        a direct callout to the existing F-077 mechanism, not a separate F-079 deliverable.
//
//   AC-5 deliverable for F-079: NONE in this module. F-077's classifier IS the implementation.
//   The historical 12-snapshot adversarial fixture moves to tests/cap-memory-migrate.test.cjs
//   (Option-A test migration, see Stage-2 #2).

// -------- AC-4 + AC-6: processSnapshots pipeline step --------

/**
 * @typedef {Object} ProcessSnapshotsOptions
 * @property {string=} now              - ISO timestamp to use for stub `updated` fields (test seam)
 * @property {Map<string,string>=} featureTopics - F-NNN -> existing topic slug; lets the caller
 *   override the default `_slugify(featureId)` (used to align stubs with F-077 outputs)
 */

/**
 * @typedef {Object} ProcessSnapshotsResult
 * @property {string[]} processed       - snapshot names processed
 * @property {string[]} writes          - target file paths actually written
 * @property {string[]} noops           - target file paths that were byte-identical no-ops
 * @property {{name:string, reason:string}[]} skipped  - snapshots that could not be linked
 * @property {{name:string, kind:'feature'|'platform'|'unassigned', target:string}[]} routes
 */

// @cap-feature(feature:F-079) processSnapshots — pipeline step that walks .cap/snapshots/*
//   and ensures every snapshot is referenced from its target's linked_snapshots block.
//   Idempotent: byte-identical re-write on second run.
//
// @cap-todo(ac:F-079/AC-4) processSnapshots groups snapshots by target (feature|platform|unassigned)
//   and writes ONE upsert per target with the FULL set (sorted, deduped) — not per-snapshot
//   appends. This is what makes the operation idempotent: the input set determines the output
//   set deterministically.
//
// @cap-todo(ac:F-079/AC-6) Snapshots without `feature:` or `platform:` frontmatter (i.e. the
//   classic orphan case) land in `.cap/memory/platform/snapshots-unassigned.md`. No snapshot
//   is ever silently dropped.

/**
 * @param {string} projectRoot
 * @param {ProcessSnapshotsOptions=} options
 * @returns {ProcessSnapshotsResult}
 */
function processSnapshots(projectRoot, options) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  const opts = options || {};
  const featureTopics = opts.featureTopics instanceof Map ? opts.featureTopics : new Map();

  /** @type {ProcessSnapshotsResult} */
  const result = {
    processed: [],
    writes: [],
    noops: [],
    skipped: [],
    routes: [],
  };

  const names = listSnapshots(projectRoot);
  if (names.length === 0) {
    // AC: pipeline.processSnapshots on empty .cap/snapshots/ → no-op, no warn, no crash.
    return result;
  }

  /** @type {Map<string, LinkedSnapshotEntry[]>} keyed by `feature:F-NNN:<topic>` or `platform:<topic>` */
  const byTarget = new Map();
  /** @type {Map<string, {kind:'feature'|'platform', featureId?:string, topic:string}>} */
  const targetMeta = new Map();

  for (const name of names) {
    let snap;
    try {
      snap = parseSnapshotFile(projectRoot, name);
    } catch (_e) {
      // Defensive: a malformed snapshot filename shouldn't kill the pipeline. Skip and move on.
      result.skipped.push({ name, reason: 'parse-error' });
      continue;
    }
    if (!snap) {
      result.skipped.push({ name, reason: 'file-disappeared-during-walk' });
      continue;
    }
    result.processed.push(name);

    const fm = snap.frontmatter;
    const dateStr = (fm && typeof fm.date === 'string') ? fm.date : null;
    const branchStr = (fm && typeof fm.branch === 'string') ? fm.branch : null;
    const entry = { name, date: dateStr, branch: branchStr };

    if (fm && typeof fm.feature === 'string' && schema.FEATURE_ID_RE.test(fm.feature)) {
      const fid = fm.feature;
      const topic = featureTopics.get(fid) || _slugifyFromFeatureId(fid);
      const key = `feature:${fid}:${topic}`;
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push(entry);
      targetMeta.set(key, { kind: 'feature', featureId: fid, topic });
      result.routes.push({ name, kind: 'feature', target: `${fid}-${topic}.md` });
      continue;
    }
    if (fm && typeof fm.platform === 'string' && platformLib.PLATFORM_TOPIC_RE.test(fm.platform)) {
      const topic = fm.platform;
      const key = `platform:${topic}`;
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push(entry);
      targetMeta.set(key, { kind: 'platform', topic });
      result.routes.push({ name, kind: 'platform', target: `${topic}.md` });
      continue;
    }
    // AC-6: orphan → unassigned platform topic.
    const key = `platform:${UNASSIGNED_SNAPSHOTS_TOPIC}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(entry);
    targetMeta.set(key, { kind: 'platform', topic: UNASSIGNED_SNAPSHOTS_TOPIC });
    result.routes.push({ name, kind: 'unassigned', target: `${UNASSIGNED_SNAPSHOTS_TOPIC}.md` });
  }

  for (const [key, entries] of byTarget.entries()) {
    const meta = targetMeta.get(key);
    if (!meta) continue;
    if (meta.kind === 'feature' && meta.featureId && meta.topic) {
      const linkResult = linkSnapshotsToFeature(projectRoot, meta.featureId, meta.topic, entries);
      if (linkResult.updated) result.writes.push(linkResult.path);
      else result.noops.push(linkResult.path);
    } else if (meta.kind === 'platform' && meta.topic) {
      const linkResult = linkSnapshotsToPlatform(projectRoot, meta.topic, entries);
      if (linkResult.updated) result.writes.push(linkResult.path);
      else result.noops.push(linkResult.path);
    }
  }

  return result;
}

/**
 * Derive a default kebab-slug topic from a feature id alone (e.g. "F-079" → "f-079").
 * Used when the caller can't supply a richer topic from FEATURE-MAP.
 * @param {string} featureId
 */
function _slugifyFromFeatureId(featureId) {
  return featureId.toLowerCase();
}

// -------- Exports --------

module.exports = {
  // Public API
  resolveLinkageOptions,
  injectLinkageFrontmatter,
  parseSnapshotFile,
  listSnapshots,
  parseLinkedSnapshotsBlock,
  renderLinkedSnapshotsBlock,
  upsertLinkedSnapshotsBlock,
  linkSnapshotsToFeature,
  linkSnapshotsToPlatform,
  processSnapshots,
  // Constants
  SNAPSHOTS_DIR,
  LINKED_SNAPSHOTS_BLOCK_NAME,
  LINKED_SNAPSHOTS_START,
  LINKED_SNAPSHOTS_END,
  SNAPSHOT_NAME_RE,
  SNAPSHOT_DATE_WINDOW_HOURS,
  UNASSIGNED_SNAPSHOTS_TOPIC,
};
