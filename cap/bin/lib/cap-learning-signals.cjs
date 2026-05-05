// @cap-context CAP F-070 Collect Learning Signals — observability foundation for the V5 Self-Learning pivot.
//                 Three collectors emit different signal types into .cap/learning/signals/<type>.jsonl, plus a
//                 getSignals(type, range) query API that F-071 (pattern extraction) and F-072 (fitness score)
//                 will consume. Mirrors F-061's privacy boundary: no raw text, hash-only context.
// @cap-decision(F-070/D1) JSONL append-only format (same as F-061 telemetry). One record per line, O(1)
//                 append, O(n) streaming read. Reading is reserved for the cold path (getSignals), never the
//                 hot path (recordX). Steals the writeJsonlLine pattern from cap-telemetry.cjs#writeJsonlLine.
// @cap-decision(F-070/D2) Hot-path collectors (recordOverride / recordMemoryRef) are SYNCHRONOUS and never
//                 read existing data. AC-5 caps hook overhead at <50ms; the only way to keep that bound under
//                 a growing JSONL is to never read it during a hook. Regret detection is the deliberate
//                 exception (AC-3) and runs from /cap:scan, where reads are fine because the scan path is cold.
// @cap-decision(F-070/D3) Record schema is fixed: { id, ts, sessionId, featureId, signalType, subType?,
//                 contextHash, ...typeSpecific }. AC-4 forbids raw text on disk — every free-text field must
//                 be hashed via cap-telemetry.cjs#hashContext (re-used, not duplicated). New keys added in
//                 the future must be structured metadata only.
// @cap-decision(F-070/D4) Trigger split: hooks fire recordOverride / recordMemoryRef from PostToolUse,
//                 recordRegret runs from the tag-scanner (cold path) via recordRegretsFromScan. A regret hook
//                 on every Stop would scan all source files and blow AC-5's 50ms budget on any non-trivial
//                 codebase. Retrospective tagging is a scan-time concern, not a per-tool-call concern.
// @cap-constraint Zero external dependencies: node:fs, node:path, node:crypto only — and we re-use
//                 cap-telemetry.cjs#hashContext for the SHA256 path so the privacy gate has a single source.
// @cap-risk(F-070/AC-4) PRIVACY BOUNDARY — this module must never accept, log, or persist raw user-typed
//                 prompts, edit diffs, or file contents. Free-text inputs (e.g. file paths, decision text)
//                 must pass through hashContext before they reach disk. Any future contributor adding a
//                 `diff`, `prompt`, `body`, or `text` field violates AC-4.
// @cap-risk(F-070/AC-5) HOT-PATH OVERHEAD — recordOverride and recordMemoryRef MUST NOT read JSONL files,
//                 spawn processes, or do any work that scales with prior signal volume. The performance
//                 budget is <50ms per hook invocation; tests bracket this with performance.now().

'use strict';

// @cap-feature(feature:F-070, primary:true) Collect Learning Signals — three collectors + getSignals query API.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Re-use the hashContext primitive from F-061. Single source of truth for the SHA256 privacy gate.
// @cap-risk(F-070/AC-4) Direct require avoids duplicating the sha256[:16] code path. If F-061's helper
//                       changes shape (e.g. digest length), this module follows automatically — there is
//                       only one privacy primitive, and it lives in cap-telemetry.cjs.
const telemetry = require('./cap-telemetry.cjs');

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const CAP_DIR = '.cap';
const LEARNING_DIR = 'learning';
const SIGNALS_DIR = 'signals';

// File names per signal type. Kept as constants so tests and consumers (F-071) reference one place.
const OVERRIDES_FILE = 'overrides.jsonl';
const MEMORY_REFS_FILE = 'memory-refs.jsonl';
const REGRETS_FILE = 'regrets.jsonl';

// Length cap for any string field that lands on disk. Matches cap-telemetry.cjs#ID_MAX so a hostile
// caller can't use sessionId / featureId as a smuggle channel even if the privacy gate above slips.
const ID_MAX = 200;

// Allowed signal types for the public getSignals API. Order matches FEATURE-MAP.md AC-6 phrasing.
// @cap-decision(F-070/D5) Public type names are 'override' | 'memory-ref' | 'regret' (singular, hyphenated)
//                 to match the AC-6 contract. Internally the file names use plural ('overrides.jsonl' etc.)
//                 to mirror cap-telemetry.cjs's file-naming convention; the mapping is centralised in
//                 typeToFile() so consumers never see the difference.
const VALID_TYPES = new Set(['override', 'memory-ref', 'regret']);

// Allowed override subTypes. AC-1 distinguishes Edit-after-Write from explicit Reject-Approval events.
const VALID_OVERRIDE_SUBTYPES = new Set(['editAfterWrite', 'rejectApproval']);

/**
 * @typedef {Object} OverrideRecord
 * @property {string} id - Unique record id (timestamp + random).
 * @property {string} ts - ISO timestamp.
 * @property {string|null} sessionId
 * @property {string|null} featureId
 * @property {'override'} signalType
 * @property {'editAfterWrite'|'rejectApproval'} subType
 * @property {string} contextHash - 16-char sha256 hex of the structured context (path or decision id).
 * @property {string} [targetFileHash] - 16-char sha256 of the targeted file path (path-string-only, never the contents).
 */

/**
 * @typedef {Object} MemoryRefRecord
 * @property {string} id
 * @property {string} ts
 * @property {string|null} sessionId
 * @property {string|null} featureId
 * @property {'memory-ref'} signalType
 * @property {string} contextHash - 16-char sha256 of the memory-file path (path-string-only — AC-2 forbids reading the file).
 * @property {string} [memoryFileHash] - 16-char sha256 of the memory-file path (alias of contextHash for query convenience).
 */

/**
 * @typedef {Object} RegretRecord
 * @property {string} id
 * @property {string} ts
 * @property {string|null} sessionId
 * @property {string|null} featureId
 * @property {'regret'} signalType
 * @property {string} decisionId - Stable identifier for the @cap-decision tag (file:line is the default; consumers may pass the decision-id from metadata).
 * @property {string} contextHash - 16-char sha256 of decisionId. Used for dedup keys in F-071.
 */

// -----------------------------------------------------------------------------
// Internal helpers (lazy-create dir, atomic-ish append, id generation)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-070/AC-7) Lazy-create on first append: ensure .cap/learning/signals/ exists before writing
//                          the first JSONL line. Idempotent; mkdir { recursive: true } is safe to call repeatedly.
function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {
    // Swallow — AC-7 demands no exception escapes a collector. The append below will surface
    // any persistent IO problem via its own try/catch and silently no-op.
  }
}

// @cap-decision(F-070/D6) JSONL append uses O_APPEND like cap-telemetry.cjs. Atomic for short single-line
//                 writes on Linux/macOS (PIPE_BUF >= 4 KiB). The record + newline always fits in one write.
//                 Stealing the proven pattern from F-061 keeps both modules' on-disk format consistent so
//                 F-071 / F-072 can share a single JSONL reader if they want to.
/**
 * Append one JSON record as a single line to the given file. Lazy-creates the parent directory.
 * Never throws — AC-7 requires that a collector failure is silent.
 * @param {string} filePath
 * @param {object} record
 */
function appendJsonlLine(filePath, record) {
  try {
    ensureDir(path.dirname(filePath));
    const line = JSON.stringify(record) + '\n';
    const fd = fs.openSync(filePath, 'a');
    try {
      fs.writeSync(fd, line);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_e) {
    // @cap-risk(F-070/AC-7) Swallow IO errors so a transient EACCES / ENOSPC doesn't crash a hook.
    //                       The signal is lost, but the user's command continues. F-074 (Pattern Unlearn)
    //                       will surface signal-loss diagnostics later — not our concern here.
  }
}

/**
 * Generate a short unique record id. Same shape as cap-telemetry.cjs#generateCallId so consumers
 * can use one regex if they ever cross-reference IDs.
 */
function generateSignalId() {
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(4).toString('hex');
  return `${ts}-${rnd}`;
}

/**
 * Length-cap a string id (sessionId, featureId, decisionId) and reject non-strings.
 * Mirrors cap-telemetry.cjs's capId helper.
 * @param {any} v
 * @returns {string|null}
 */
function capId(v) {
  if (typeof v !== 'string' || v.length === 0) return null;
  return v.slice(0, ID_MAX);
}

/**
 * Map a public signal type to its on-disk file name. Centralised so AC-1/AC-2/AC-3 file paths
 * are defined in exactly one place.
 * @param {string} type - 'override' | 'memory-ref' | 'regret'
 * @returns {string|null}
 */
function typeToFile(type) {
  if (type === 'override') return OVERRIDES_FILE;
  if (type === 'memory-ref') return MEMORY_REFS_FILE;
  if (type === 'regret') return REGRETS_FILE;
  return null;
}

/**
 * Resolve the absolute path for a given signal type's JSONL file.
 * @param {string} projectRoot
 * @param {string} type
 * @returns {string|null}
 */
function signalsFilePath(projectRoot, type) {
  const file = typeToFile(type);
  if (!file) return null;
  return path.join(projectRoot, CAP_DIR, LEARNING_DIR, SIGNALS_DIR, file);
}

// -----------------------------------------------------------------------------
// Public API — collectors
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-070/AC-1) Override collector: persists Edit-after-Write and Reject-Approval events to
//                          .cap/learning/signals/overrides.jsonl. subType discriminates the two sources.
// @cap-todo(ac:F-070/AC-4) Record schema enforced here: { id, ts, sessionId, featureId, signalType,
//                          subType, contextHash, targetFileHash? } — never raw paths or text.
/**
 * Record an override event. Two flavours: 'editAfterWrite' (the agent wrote a file, the user edited it
 * during the same session) and 'rejectApproval' (the user explicitly rejected an approval prompt).
 *
 * Never throws — AC-7 contract.
 *
 * @param {Object} input
 * @param {string} input.projectRoot
 * @param {'editAfterWrite'|'rejectApproval'} input.subType
 * @param {string|null} [input.sessionId]
 * @param {string|null} [input.featureId]
 * @param {string} [input.contextHash] - Optional pre-computed hash. If omitted and `targetFile` is given,
 *   the hash is derived from the target file path (path-string-only — never reads the file).
 * @param {string} [input.targetFile] - Optional structured context (e.g. the edited file path). Hashed
 *   before persistence — the raw string never reaches disk.
 * @param {string} [input.ts] - Override timestamp (mostly for tests).
 * @returns {OverrideRecord|null} The persisted record, or null when the input is invalid (no throw).
 */
function recordOverride(input) {
  try {
    const safe = input || {};
    if (!safe.projectRoot || typeof safe.projectRoot !== 'string') return null;
    if (!VALID_OVERRIDE_SUBTYPES.has(safe.subType)) return null;

    // @cap-risk(F-070/AC-4) Derive contextHash from the structured target file path, never from file
    //                       contents. If the caller passes a pre-computed hash we accept it (consumer
    //                       knows their dedup key), but we still cap its length defensively.
    const fallbackContext = safe.targetFile
      ? telemetry.hashContext(safe.targetFile)
      : telemetry.hashContext(`${safe.subType}:${safe.sessionId || ''}`);
    const contextHash = (typeof safe.contextHash === 'string' && safe.contextHash.length > 0)
      ? safe.contextHash.slice(0, 64)
      : fallbackContext;

    /** @type {OverrideRecord} */
    const record = {
      id: generateSignalId(),
      ts: safe.ts || new Date().toISOString(),
      sessionId: capId(safe.sessionId),
      featureId: capId(safe.featureId),
      signalType: 'override',
      subType: safe.subType,
      contextHash,
    };
    if (safe.targetFile) {
      // Hash-only — path string is privacy-sensitive (could include a username under /Users/<name>/...).
      record.targetFileHash = telemetry.hashContext(safe.targetFile);
    }

    appendJsonlLine(signalsFilePath(safe.projectRoot, 'override'), record);
    return record;
  } catch (_e) {
    return null;
  }
}

// @cap-todo(ac:F-070/AC-2) Memory-Reference collector: increments a per-session count whenever any file
//                          under .cap/memory/*.md is read. Writes one record per read to memory-refs.jsonl.
//                          The "count" is reconstructed by query (getSignals) — we don't aggregate at write.
/**
 * Record a memory-reference event. Called when the agent (via PostToolUse hook on Read) touches any file
 * under `.cap/memory/`. The file path is hashed; the file contents are NEVER read here.
 *
 * Never throws — AC-7 contract.
 *
 * @param {Object} input
 * @param {string} input.projectRoot
 * @param {string|null} [input.sessionId]
 * @param {string|null} [input.featureId]
 * @param {string} input.memoryFile - Path of the touched memory file (relative or absolute). Hashed before
 *   persistence — the raw path never lands on disk.
 * @param {string} [input.ts]
 * @returns {MemoryRefRecord|null}
 */
function recordMemoryRef(input) {
  try {
    const safe = input || {};
    if (!safe.projectRoot || typeof safe.projectRoot !== 'string') return null;
    if (typeof safe.memoryFile !== 'string' || safe.memoryFile.length === 0) return null;

    // @cap-risk(F-070/AC-4) memoryFile is hashed, never persisted as a raw path. The privacy boundary is
    //                       symmetric with recordOverride — same hash function, same 16-char digest.
    const memoryFileHash = telemetry.hashContext(safe.memoryFile);

    /** @type {MemoryRefRecord} */
    const record = {
      id: generateSignalId(),
      ts: safe.ts || new Date().toISOString(),
      sessionId: capId(safe.sessionId),
      featureId: capId(safe.featureId),
      signalType: 'memory-ref',
      contextHash: memoryFileHash,
      memoryFileHash,
    };

    appendJsonlLine(signalsFilePath(safe.projectRoot, 'memory-ref'), record);
    return record;
  } catch (_e) {
    return null;
  }
}

// @cap-todo(ac:F-070/AC-3) Decision-Regret collector: emits one record per @cap-decision tag carrying
//                          regret:true. Triggered from /cap:scan (the cold path) — see recordRegretsFromScan
//                          below for the integration point.
/**
 * Record a single regret. Lower-level than recordRegretsFromScan — useful when a caller already has the
 * decision id in hand (e.g. the F-073 review board's manual "mark regret" action).
 *
 * Never throws — AC-7 contract.
 *
 * @param {Object} input
 * @param {string} input.projectRoot
 * @param {string|null} [input.sessionId]
 * @param {string|null} [input.featureId]
 * @param {string} input.decisionId - Stable identifier for the @cap-decision (file:line by default).
 * @param {string} [input.contextHash]
 * @param {string} [input.ts]
 * @returns {RegretRecord|null}
 */
function recordRegret(input) {
  try {
    const safe = input || {};
    if (!safe.projectRoot || typeof safe.projectRoot !== 'string') return null;
    if (typeof safe.decisionId !== 'string' || safe.decisionId.length === 0) return null;

    const decisionId = safe.decisionId.slice(0, ID_MAX);
    const contextHash = (typeof safe.contextHash === 'string' && safe.contextHash.length > 0)
      ? safe.contextHash.slice(0, 64)
      : telemetry.hashContext(decisionId);

    /** @type {RegretRecord} */
    const record = {
      id: generateSignalId(),
      ts: safe.ts || new Date().toISOString(),
      sessionId: capId(safe.sessionId),
      featureId: capId(safe.featureId),
      signalType: 'regret',
      decisionId,
      contextHash,
    };

    appendJsonlLine(signalsFilePath(safe.projectRoot, 'regret'), record);
    return record;
  } catch (_e) {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Public API — query
// -----------------------------------------------------------------------------

/**
 * Read all records from a signal-type JSONL. Tolerant to missing file and malformed lines.
 * Internal helper for getSignals.
 * @param {string} projectRoot
 * @param {string} type
 * @returns {Array<object>}
 */
function readAllSignals(projectRoot, type) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return [];
  const filePath = signalsFilePath(projectRoot, type);
  if (!filePath || !fs.existsSync(filePath)) return [];
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return [];
  }
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (_e) {
      // Skip malformed lines — query must never crash a command (mirrors F-061 behaviour).
    }
  }
  return records;
}

// @cap-todo(ac:F-070/AC-6) Query API consumed by F-071 (pattern extraction) and F-072 (fitness score).
//                          Contract intentionally minimal: type + range. No byFeature, no recentSignals —
//                          add them later only when F-071/F-072 actually need them.
/**
 * Query persisted signals by type and range.
 *
 * @param {string} projectRoot - Absolute path to project root.
 * @param {'override'|'memory-ref'|'regret'} type - Signal type.
 * @param {{from?: string|Date, to?: string|Date, sessionId?: string}} [range] - Time range OR sessionId.
 *   Pass `{from, to}` for a time slice (ISO strings or Date objects, inclusive).
 *   Pass `{sessionId}` to filter by session. Both keys may be combined.
 *   When `range` is omitted, ALL records of the given type are returned.
 * @returns {Array<object>} Matching records, or [] if the type is invalid or no file exists.
 */
function getSignals(projectRoot, type, range) {
  if (!VALID_TYPES.has(type)) return [];
  const all = readAllSignals(projectRoot, type);
  if (!range) return all;

  const fromTs = range.from ? new Date(range.from).getTime() : null;
  const toTs = range.to ? new Date(range.to).getTime() : null;
  const sessionId = typeof range.sessionId === 'string' && range.sessionId.length > 0
    ? range.sessionId
    : null;

  return all.filter((r) => {
    if (sessionId && r.sessionId !== sessionId) return false;
    if (fromTs !== null || toTs !== null) {
      const recordTs = new Date(r.ts).getTime();
      if (Number.isNaN(recordTs)) return false;
      if (fromTs !== null && recordTs < fromTs) return false;
      if (toTs !== null && recordTs > toTs) return false;
    }
    return true;
  });
}

// -----------------------------------------------------------------------------
// Tag-scanner integration — regret detection (cold path)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-070/AC-3) Walk @cap-decision tags carrying regret:true and emit a RegretRecord per tag.
//                          Called from /cap:scan after enrichFromTags. Reads existing regrets to dedup —
//                          this is fine because the scan path is cold (AC-5 governs hooks, not scan).
// @cap-decision(F-070/D7) Dedup key is decisionId. The tag scanner's CapTag carries (file, line, metadata)
//                 so we synthesise a stable id when the tag has no explicit `id:` metadata: `<file>:<line>`.
//                 If multiple regret tags share a decisionId across runs (e.g. the same line), only the first
//                 is recorded — F-074's audit trail will track lifecycle from there.
/**
 * Scan a tag list for `@cap-decision` tags carrying `regret:true` and emit a RegretRecord for each one
 * not already persisted. Idempotent across repeated /cap:scan invocations.
 *
 * Never throws — wraps individual tag failures so a single malformed tag doesn't break the batch.
 *
 * @param {string} projectRoot
 * @param {Array<{type: string, file: string, line: number, metadata: object, description: string}>} tags
 *   Tags from cap-tag-scanner.cjs#scanDirectory.
 * @param {Object} [options]
 * @param {string|null} [options.sessionId] - Optional session id to attach to emitted records.
 * @param {string|null} [options.featureId] - Optional active feature id (default falls back to tag.metadata.feature).
 * @returns {{recorded: number, skipped: number}} Counts for /cap:scan reporting.
 */
function recordRegretsFromScan(projectRoot, tags, options) {
  const opts = options || {};
  let recorded = 0;
  let skipped = 0;

  if (!Array.isArray(tags) || tags.length === 0) {
    return { recorded, skipped };
  }

  // Read existing regrets once to build the dedup set. Cold-path read — fine per D2.
  const existing = readAllSignals(projectRoot, 'regret');
  const seenDecisionIds = new Set(existing.map((r) => r.decisionId).filter(Boolean));

  for (const tag of tags) {
    try {
      if (!tag || tag.type !== 'decision') continue;
      // Match the regret marker. Tag metadata is parsed by cap-tag-scanner.cjs#parseMetadata which
      // stores `regret:true` as the string 'true' (boolean-flag convention). We accept both string
      // and boolean defensively — future scanner refactors mustn't silently break this integration.
      const md = tag.metadata || {};
      const isRegret = md.regret === 'true' || md.regret === true;
      if (!isRegret) continue;

      // Derive a stable decisionId. Prefer explicit metadata.id, else metadata.decision (e.g. "F-070/D1"),
      // else fall back to file:line as a per-tag-position anchor.
      const explicitId = md.id || md.decision;
      const decisionId = (typeof explicitId === 'string' && explicitId.length > 0)
        ? explicitId
        : `${tag.file}:${tag.line}`;

      if (seenDecisionIds.has(decisionId)) {
        skipped += 1;
        continue;
      }

      const featureId = opts.featureId != null ? opts.featureId : (md.feature || null);

      const result = recordRegret({
        projectRoot,
        sessionId: opts.sessionId || null,
        featureId,
        decisionId,
      });
      if (result) {
        recorded += 1;
        seenDecisionIds.add(decisionId);
      }
    } catch (_e) {
      // Per-tag failure must not break the batch.
    }
  }

  return { recorded, skipped };
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  // constants — exported for tests and consumers (F-071/F-072)
  CAP_DIR,
  LEARNING_DIR,
  SIGNALS_DIR,
  OVERRIDES_FILE,
  MEMORY_REFS_FILE,
  REGRETS_FILE,
  VALID_TYPES,
  VALID_OVERRIDE_SUBTYPES,
  // public API — collectors
  recordOverride,
  recordMemoryRef,
  recordRegret,
  // public API — query
  getSignals,
  // tag-scanner integration
  recordRegretsFromScan,
};
