'use strict';

// @cap-feature(feature:F-098) Implicit Quick-Mode — supersedes F-092. Detection in the Stop hook
//   pivots from explicit toggle (/cap:quick + /cap:finalize) to a heuristic: no formal /cap:command
//   was the last action AND ≥5 source-file writes were observed in the session AND activeFeature
//   is set. When all three hold, light catch-up runs: silent @cap-feature annotation on any
//   touched files that lack a tag. No iterate, no test — heavy ritual stays explicit.
//
// @cap-decision Source signal is `.cap/learning/state/written-files.jsonl` (F-070's per-session
//   ledger), filtered by sessionId from `.cap/SESSION.json`. We deliberately don't `git diff`:
//   git diff would include files Claude touched in commits already and miss working-tree-only
//   reads-then-writes. The ledger is exactly the set of files that Edit/Write/MultiEdit ran on
//   in the live session, which is the right denominator for "did Claude touch this in raw chat?".
//
// @cap-decision Atomic write uses temp-then-rename in the SAME directory. Cross-device renames
//   would fall back to copy+delete (loses atomicity) — colocating the temp file keeps `rename(2)`
//   on the same filesystem. The temp suffix `.cap-implicit-quick-tmp` is intentionally distinct
//   from the more-common `.tmp` to avoid clashing with editors' swap files during a save race.
//
// @cap-decision activeFeature ambiguity (AC-6) is conservatively defined: if any of the touched
//   files already carries a `@cap-feature` for a different feature, OR activeFeature doesn't
//   match the F-NNN / F-<App>-<Slug> shape, we skip annotation entirely and emit an ambiguous
//   notice. We don't try to disambiguate per-file — that's /cap:annotate's job.

const fs = require('node:fs');
const path = require('node:path');

const FORMAL_COMMANDS = new Set([
  '/cap:prototype', '/cap:iterate', '/cap:test', '/cap:review',
  '/cap:annotate', '/cap:brainstorm', '/cap:debug',
]);
const MIN_EDITS_FOR_QUICK = 5;
// Accept both single-app (F-NNN) and monorepo (F-<App>-<Slug>) feature IDs.
const FEATURE_ID_RE = /^F-[A-Za-z0-9][A-Za-z0-9_-]*$/;
// Match `@cap-feature` regardless of trailing punctuation — `@cap-feature(...)`, `@cap-feature ...`, etc.
const FEATURE_TAG_RE = /@cap-feature\b/;
const FEATURE_TAG_FOR_ID_RE = (id) => new RegExp(`@cap-feature\\([^)]*feature:${id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`);

// File extensions where a `// @cap-feature(...)` line is a valid annotation.
const CSTYLE_EXTS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.go', '.rs', '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h', '.hpp', '.css', '.scss', '.less', '.php']);
// File extensions where `# @cap-feature(...)` is the right comment shape.
const HASHSTYLE_EXTS = new Set(['.py', '.rb', '.sh', '.bash', '.zsh', '.fish', '.toml', '.yaml', '.yml']);

/**
 * @typedef {Object} DetectionResult
 * @property {boolean} isQuick - True when all heuristics pass and catch-up should run.
 * @property {string} [reason] - When isQuick=false, names the failed gate.
 * @property {string} [sessionId] - Claude-Code session id (when known).
 * @property {string} [activeFeature]
 * @property {string} [lastCommand]
 * @property {string[]} [files] - Distinct files written in this session.
 * @property {number} [editCount]
 * @property {number} [threshold]
 */

/**
 * @typedef {Object} ProcessResult
 * @property {boolean} skipped
 * @property {string} [reason]
 * @property {string[]} [annotated] - Files that received a new @cap-feature tag
 * @property {string[]} [preserved] - Files that already had a @cap-feature tag
 * @property {Array<{file:string, error:string}>} [errors]
 * @property {string} [notice]
 * @property {string} [activeFeature]
 * @property {number} [editCount]
 * @property {boolean} [ambiguous]
 */

function _readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) { return null; }
}

/**
 * Determine whether implicit-quick is disabled for this project. Two channels:
 *   1. `CAP_SKIP_IMPLICIT_QUICK=1` env var — fastest off-switch, no project state needed.
 *   2. `.cap/config.json: { implicitQuick: { enabled: false } }` — durable per-project setting.
 * @param {string} projectRoot
 * @returns {{disabled: boolean, reason?: string}}
 */
function isDisabled(projectRoot) {
  if (process.env.CAP_SKIP_IMPLICIT_QUICK === '1') return { disabled: true, reason: 'env-var' };
  const cfg = _readJson(path.join(projectRoot, '.cap', 'config.json'));
  if (cfg && cfg.implicitQuick && cfg.implicitQuick.enabled === false) {
    return { disabled: true, reason: 'config' };
  }
  return { disabled: false };
}

/**
 * Read distinct file paths recorded in F-070's written-files ledger for `sessionId`.
 * Returns an empty array when the ledger is missing or unreadable — callers must not throw.
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {string[]}
 */
function readWrittenFilesForSession(projectRoot, sessionId) {
  const fp = path.join(projectRoot, '.cap', 'learning', 'state', 'written-files.jsonl');
  if (!fs.existsSync(fp)) return [];
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch { return []; }
  const seen = new Set();
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (!r || r.sessionId !== sessionId) continue;
      if (typeof r.targetFile !== 'string' || r.targetFile.length === 0) continue;
      if (seen.has(r.targetFile)) continue;
      seen.add(r.targetFile);
      out.push(r.targetFile);
    } catch (_e) { /* skip malformed line */ }
  }
  return out;
}

/**
 * Apply the AC-1 heuristic: identify whether the just-ended session was raw-chat catch-up-eligible.
 * Inputs can be supplied via `opts` for unit tests; otherwise pulled from disk.
 *
 * @param {Object} [opts]
 * @param {string} [opts.projectRoot]
 * @param {Object} [opts.session] - parsed SESSION.json content (skips disk read)
 * @param {string[]} [opts.files] - pre-resolved touched-file list (skips ledger read)
 * @returns {DetectionResult}
 */
function detectQuickSession(opts) {
  const options = opts || {};
  const projectRoot = options.projectRoot || process.cwd();
  const session = options.session || _readJson(path.join(projectRoot, '.cap', 'SESSION.json'));
  if (!session) return { isQuick: false, reason: 'no-session-json' };

  const sessionId = typeof session.sessionId === 'string' ? session.sessionId : null;
  const activeFeature = typeof session.activeFeature === 'string' ? session.activeFeature : null;
  const lastCommand = typeof session.lastCommand === 'string' ? session.lastCommand : null;

  if (!sessionId) return { isQuick: false, reason: 'no-session-id', activeFeature, lastCommand };
  if (!activeFeature) return { isQuick: false, reason: 'no-active-feature', sessionId, lastCommand };
  if (!FEATURE_ID_RE.test(activeFeature)) return { isQuick: false, reason: 'invalid-active-feature', activeFeature };
  if (lastCommand && FORMAL_COMMANDS.has(lastCommand)) {
    return { isQuick: false, reason: 'formal-command', lastCommand, activeFeature };
  }

  const files = options.files || readWrittenFilesForSession(projectRoot, sessionId);
  if (files.length < MIN_EDITS_FOR_QUICK) {
    return {
      isQuick: false,
      reason: 'too-few-edits',
      editCount: files.length,
      threshold: MIN_EDITS_FOR_QUICK,
      sessionId,
      activeFeature,
    };
  }

  return { isQuick: true, sessionId, activeFeature, lastCommand, files, editCount: files.length };
}

function _commentPrefixForExt(ext) {
  if (CSTYLE_EXTS.has(ext)) return '//';
  if (HASHSTYLE_EXTS.has(ext)) return '#';
  return null;
}

/**
 * Triage touched files into three categories:
 *   - needsAnnotate: source file with no @cap-feature tag
 *   - hasTag: source file already carrying any @cap-feature
 *   - skipped: non-annotatable extension, missing on disk, or tagged with a *different* feature.
 * The third sub-case populates `ambiguousFor` so the caller can downgrade to a notice (AC-6).
 *
 * @param {string[]} files
 * @param {string} activeFeature
 * @returns {{needsAnnotate: string[], hasTag: string[], skipped: Array<{file:string, reason:string}>, ambiguousFor: string[]}}
 */
function classifyFiles(files, activeFeature) {
  const result = { needsAnnotate: [], hasTag: [], skipped: [], ambiguousFor: [] };
  const featureMatcher = FEATURE_TAG_FOR_ID_RE(activeFeature);
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!_commentPrefixForExt(ext)) {
      result.skipped.push({ file: f, reason: 'non-annotatable-ext' });
      continue;
    }
    if (!fs.existsSync(f)) {
      result.skipped.push({ file: f, reason: 'missing' });
      continue;
    }
    let content;
    try { content = fs.readFileSync(f, 'utf8'); }
    catch { result.skipped.push({ file: f, reason: 'unreadable' }); continue; }
    if (FEATURE_TAG_RE.test(content)) {
      result.hasTag.push(f);
      // Detect ambiguity: file already tagged for a *different* feature than activeFeature.
      if (!featureMatcher.test(content)) {
        result.ambiguousFor.push(f);
      }
    } else {
      result.needsAnnotate.push(f);
    }
  }
  return result;
}

/**
 * Insert a `@cap-feature(feature:<id>)` comment near the top of `filePath`. Atomic: writes to a
 * sibling temp file then `rename(2)`s. Throws on any IO error so the caller can record it
 * as a per-file failure rather than crashing the whole catch-up.
 *
 * @param {string} filePath
 * @param {string} featureId - F-NNN or F-<App>-<Slug>
 * @returns {{changed: boolean, reason?: string}}
 */
function annotateFile(filePath, featureId) {
  if (!FEATURE_ID_RE.test(featureId)) {
    throw new Error(`Invalid feature id: ${featureId}`);
  }
  const ext = path.extname(filePath).toLowerCase();
  const prefix = _commentPrefixForExt(ext);
  if (!prefix) return { changed: false, reason: 'non-annotatable-ext' };

  const content = fs.readFileSync(filePath, 'utf8');
  if (FEATURE_TAG_RE.test(content)) {
    return { changed: false, reason: 'already-tagged' };
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  let insertIdx = 0;
  // Preserve shebang as first line.
  if (lines[0] && lines[0].startsWith('#!')) insertIdx = 1;
  // Preserve a leading 'use strict' directive (CJS modules).
  if (lines[insertIdx] && /^['"]use strict['"]\s*;?\s*$/.test(lines[insertIdx])) insertIdx += 1;

  const tag = `${prefix} @cap-feature(feature:${featureId})`;
  const newLines = [...lines.slice(0, insertIdx), tag, ...lines.slice(insertIdx)];
  const newContent = newLines.join(newline);

  const tmpPath = filePath + '.cap-implicit-quick-tmp';
  try {
    fs.writeFileSync(tmpPath, newContent, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_e) { /* swallow */ }
    throw err;
  }
  return { changed: true };
}

/**
 * Compose the user-facing notice string. Two shapes:
 *  - happy path: "F-XXX: 5 files annotated, 30 edits captured. Run /cap:test for AC coverage."
 *  - ambiguous: "5 ambiguous files touched, run /cap:annotate to assign feature IDs."
 *
 * @param {{featureId?: string, fileCount: number, editCount: number, ambiguous?: boolean}} args
 * @returns {string}
 */
function formatNotice(args) {
  if (args.ambiguous) {
    return `[cap:implicit-quick] ${args.fileCount} ambiguous files touched, run /cap:annotate to assign feature IDs.`;
  }
  return `[cap:implicit-quick] ${args.featureId}: ${args.fileCount} files annotated, ${args.editCount} edits captured. Run /cap:test for AC coverage.`;
}

/**
 * One-call orchestrator used by the Stop hook. Returns a structured result so the hook can
 * surface a notice and the test suite can assert behavior without firing a real hook.
 *
 * Never throws — wraps every step. The contract is "best-effort, never block session end".
 *
 * @param {Object} [opts]
 * @param {string} [opts.projectRoot]
 * @param {Object} [opts.session]
 * @param {string[]} [opts.files]
 * @returns {ProcessResult}
 */
function processSession(opts) {
  const options = opts || {};
  const projectRoot = options.projectRoot || process.cwd();
  try {
    const dis = isDisabled(projectRoot);
    if (dis.disabled) return { skipped: true, reason: 'disabled-' + dis.reason };

    const det = detectQuickSession({ projectRoot, ...options });
    if (!det.isQuick) return { skipped: true, reason: det.reason };

    const breakdown = classifyFiles(det.files, det.activeFeature);

    // AC-6: if any touched file is already pinned to a *different* feature, treat as ambiguous
    // and emit a notice instead of silent annotation. Conservative: better no-op than wrong.
    if (breakdown.ambiguousFor.length > 0) {
      return {
        skipped: false,
        ambiguous: true,
        annotated: [],
        preserved: breakdown.hasTag,
        errors: [],
        notice: formatNotice({ fileCount: det.files.length, editCount: det.editCount, ambiguous: true }),
        activeFeature: det.activeFeature,
        editCount: det.editCount,
      };
    }

    const annotated = [];
    const errors = [];
    for (const f of breakdown.needsAnnotate) {
      try {
        const r = annotateFile(f, det.activeFeature);
        if (r.changed) annotated.push(f);
      } catch (err) {
        errors.push({ file: f, error: err && err.message ? err.message : String(err) });
      }
    }

    return {
      skipped: false,
      ambiguous: false,
      annotated,
      preserved: breakdown.hasTag,
      errors,
      notice: formatNotice({
        featureId: det.activeFeature,
        fileCount: annotated.length,
        editCount: det.editCount,
      }),
      activeFeature: det.activeFeature,
      editCount: det.editCount,
    };
  } catch (err) {
    return { skipped: true, reason: 'error', error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  detectQuickSession,
  classifyFiles,
  annotateFile,
  formatNotice,
  processSession,
  isDisabled,
  readWrittenFilesForSession,
  FORMAL_COMMANDS,
  MIN_EDITS_FOR_QUICK,
  FEATURE_ID_RE,
};
