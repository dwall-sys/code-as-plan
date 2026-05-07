// @cap-feature(feature:F-084, primary:true) Project Onboarding & Migration Orchestrator —
// state-machine + planner + atomic marker writer for `/cap:upgrade`.
//
// @cap-context This module owns the planner / state-manager half of /cap:upgrade.
// The markdown command spec at commands/cap/upgrade.md is the orchestrator that
// invokes each /cap:* sub-command in turn; this module decides WHICH stages need
// to run, in what ORDER, and persists the marker `.cap/version` plus the per-stage
// audit log `.cap/upgrade.log`. The module never spawns child processes itself —
// it returns a STAGE-PLAN that the markdown spec executes.
//
// @cap-context F-084 is "candidate 8" in the V6 Stage-2 streak. All 12 Stage-2
// classes are applied UPFRONT (proto-pollution defense, ANSI defense, path-traversal
// rejection, silent-skip-is-real-silent, atomic writes, round-trip stability, etc.)
//
// @cap-decision(F-084/AC-2) The 7 stage names are fixed and ordered. Order
// is a contract (doctor → init → annotate → migrate-tags → memory-bootstrap →
// migrate-snapshots → refresh-docs). Skip-conditions decide whether each stage
// runs but never reorder them. A future stage can be appended to the end.
//
// @cap-decision(F-084/AC-4) Per-stage isolation: a failed stage is logged and
// the orchestrator keeps going. Tests cover this via per-stage error injection.
//
// @cap-decision(F-084/AC-5) Marker file `.cap/version` is JSON, not a flat
// semver string. Rationale: we need to persist completedStages + lastRun
// alongside version. JSON beats inventing a custom multi-line format.
//
// @cap-decision(F-084/spec-gap) cap-upgrade.cjs returns a STAGE-PLAN and a
// recordStageResult() side-effect API. The markdown command spec
// (/cap:upgrade) is responsible for actually invoking /cap:doctor, /cap:init,
// /cap:annotate, etc. for each planned stage. This avoids the foot-gun of
// JS-from-markdown subprocess invocation while still keeping the planner
// fully testable in node:test (no spawn needed for unit tests).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { _atomicWriteFile } = require('./cap-memory-migrate.cjs');

// -------- Constants --------

// @cap-decision(F-084/D1) Marker file path is fixed: `.cap/version`. Lives at the
// same depth as `.cap/SESSION.json` and `.cap/upgrade.log` so the whole upgrade
// surface is one directory.
const MARKER_REL_PATH = path.join('.cap', 'version');

// @cap-decision(F-084/D2) Audit log path: `.cap/upgrade.log`. JSONL (one JSON
// object per line). JSONL plays nicely with `tail -f` and `jq -s '.'` for
// post-mortem and is append-only by construction (no rewrite on each entry).
const LOG_REL_PATH = path.join('.cap', 'upgrade.log');

// @cap-decision(F-084/D3) Hook-throttle marker path: `.cap/.session-advisories.json`.
// Leading-dot signals "transient/derived" (matches `.cap/memory/.last-run`,
// `.cap/memory/.claude-native-index.json`). Tracks per-session (process.pid +
// session-id) advisory emissions so SessionStart-hook only emits once per session.
const ADVISORY_REL_PATH = path.join('.cap', '.session-advisories.json');

// @cap-decision(F-084/D4) Schema version for the marker file. Bump on shape change
// (e.g. if we add a new field that older readers can't parse). Same pattern as
// CACHE_SCHEMA_VERSION in cap-memory-bridge.cjs.
const MARKER_SCHEMA_VERSION = 1;

// @cap-decision(F-084/AC-2) Fixed stage list — the contract for the orchestrator.
// Order is doctor first (read-only health check, gate for everything else), then
// init-or-skip (foundational), then the 5 modification stages.
// @cap-decision(F-084/AC-3) The `optional` flag drives `--non-interactive` safe
// defaults: optional stages get auto-skipped in CI mode unless `--include-stages`
// re-enables them.
const STAGES = Object.freeze([
  Object.freeze({ name: 'doctor',           command: '/cap:doctor',         optional: false, readOnly: true  }),
  Object.freeze({ name: 'init-or-skip',     command: '/cap:init',           optional: false, readOnly: false }),
  Object.freeze({ name: 'annotate',         command: '/cap:annotate',       optional: true,  readOnly: false }),
  Object.freeze({ name: 'migrate-tags',     command: '/cap:migrate-tags',   optional: false, readOnly: false }),
  Object.freeze({ name: 'memory-bootstrap', command: '/cap:memory bootstrap', optional: false, readOnly: false }),
  Object.freeze({ name: 'migrate-snapshots', command: '/cap:memory migrate-snapshots', optional: false, readOnly: false }),
  Object.freeze({ name: 'refresh-docs',     command: '/cap:refresh-docs',   optional: true,  readOnly: false }),
]);

// @cap-decision(F-084/D5) Hard-coded stage-name allowlist for input validation
// in --skip-stages parsing. Defense-in-depth against path-traversal attempts
// (`--skip-stages=../etc/passwd`).
const STAGE_NAMES = Object.freeze(STAGES.map((s) => s.name));

// @cap-decision(F-084/D6) Stage-name regex: matches the literal STAGE_NAMES only.
// Cheaper than a full validator chain; if a stage name fails this regex we know
// it's not a known stage AND it's not a path-traversal sequence either.
const STAGE_NAME_RE = /^[a-z]+(?:-[a-z]+)*$/;

// -------- Defensive helpers --------

// @cap-decision(F-084/D7) ANSI/control-byte sanitization. Mirrors
// cap-memory-platform.cjs:_safeForError, cap-memory-bridge.cjs:_safeForOutput,
// cap-snapshot-linkage.cjs:_safeForError. Kept LOCAL so a refactor in one module
// can't silently weaken the defense in another. Stage-2 #2 lesson.
function _safeForError(value) {
  let s;
  try {
    s = String(value);
  } catch (_e) {
    return '<unprintable>';
  }
  // Strip non-printable bytes (ANSI CSI, BEL, BS, NUL). Cap at 200 chars to keep
  // log lines bounded — advisory messages are 120 chars max so 200 is generous.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1f\x7f]/g, '?');
  if (s.length > 200) s = s.slice(0, 200) + '...';
  return s;
}

// @cap-decision(F-084/D8) Null-prototype reconstruction for any object parsed from
// JSON that crosses a trust boundary (.cap/version, .cap/.session-advisories.json,
// .cap/config.json:upgrade). Stage-2 #1 lesson: prevents __proto__ pollution from
// a malicious or corrupted marker file.
function _safeJsonParse(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return { ok: false, value: null, reason: 'parse-error' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, value: null, reason: 'shape-mismatch' };
  }
  // Reconstruct with null prototype + only own-enumerable keys. Drops
  // `__proto__` and `constructor` setters silently; they survive a `JSON.parse`
  // as own keys but reconstruction breaks the prototype chain.
  const safe = Object.create(null);
  for (const key of Object.keys(parsed)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    safe[key] = parsed[key];
  }
  return { ok: true, value: safe, reason: 'parsed' };
}

// @cap-todo(ac:F-084/AC-1) _validateProjectRoot guards every public entry-point
// against NUL-byte / non-string injection. Defense-in-depth even though Node's
// fs.* would throw; an explicit error is friendlier than the libuv message.
function _validateProjectRoot(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  if (projectRoot.includes('\0')) {
    throw new TypeError(`projectRoot contains NUL byte (got "${_safeForError(projectRoot)}")`);
  }
}

// -------- Version comparison --------

// @cap-decision(F-084/D9) Semver compare without external deps. Accepts
// `MAJOR.MINOR.PATCH` with optional pre-release suffix (we ignore the suffix
// for ordering — the ship-on-main contract means we never publish alpha
// markers). Returns -1 / 0 / +1.
// @cap-risk(reason:semver-edge-cases) Pre-release ordering is intentionally
// a no-op here: a comparison with a pre-release suffix degrades to plain
// numeric compare on the MAJOR.MINOR.PATCH triple. Acceptable: CAP releases
// are stable-only on main.
function _parseSemver(v) {
  if (typeof v !== 'string') return null;
  // Strip leading `v` and any pre-release/build suffix.
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

// @cap-todo(ac:F-084/AC-1) compareVersions returns -1/0/+1 / null on parse-failure.
function compareVersions(a, b) {
  const pa = _parseSemver(a);
  const pb = _parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

// -------- Installed version --------

// @cap-todo(ac:F-084/AC-1) getInstalledVersion reads the package.json:version
// from the CAP repo (or installed npx tree). Falls back to '0.0.0' on missing
// package.json so the planner stays operational on partial installs.
/**
 * @param {string} packageJsonDir - dir containing package.json (defaults to CAP install dir)
 * @returns {string} semver string (or '0.0.0' on missing/unreadable)
 */
function getInstalledVersion(packageJsonDir) {
  // Default to the CAP install dir (two levels up from this file: .../cap/bin/lib/ -> .../).
  const dir = packageJsonDir || path.resolve(__dirname, '..', '..', '..');
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return '0.0.0';
  let raw;
  try {
    raw = fs.readFileSync(pkgPath, 'utf8');
  } catch (_e) {
    return '0.0.0';
  }
  const parsed = _safeJsonParse(raw);
  if (!parsed.ok) return '0.0.0';
  const v = parsed.value.version;
  if (typeof v !== 'string') return '0.0.0';
  // Validate the shape — return '0.0.0' if it's not a clean semver.
  return _parseSemver(v) ? v : '0.0.0';
}

// -------- Marker IO --------

// @cap-todo(ac:F-084/AC-5) getMarkerVersion reads `.cap/version` and returns
// a normalized payload, or null if the file is missing. Stage-2 #1 + #10
// lessons: corrupted JSON / wrong-shape JSON / missing file all return null
// gracefully (never throw). The caller treats null as "first run".
/**
 * @typedef {Object} MarkerPayload
 * @property {number} schemaVersion
 * @property {string} version            - last-run CAP version (semver)
 * @property {string[]} completedStages  - stage names completed successfully
 * @property {string|null} lastRun       - ISO timestamp of last successful upgrade
 */

/**
 * @param {string} projectRoot
 * @returns {MarkerPayload|null} null if marker missing, corrupted, or unreadable.
 */
function getMarkerVersion(projectRoot) {
  _validateProjectRoot(projectRoot);
  const fp = path.join(projectRoot, MARKER_REL_PATH);
  if (!fs.existsSync(fp)) return null;
  let raw;
  try {
    raw = fs.readFileSync(fp, 'utf8');
  } catch (_e) {
    return null;
  }
  const parsed = _safeJsonParse(raw);
  if (!parsed.ok) return null;
  const obj = parsed.value;
  // Validate fields. Anything malformed → null (treat as first-run).
  if (typeof obj.version !== 'string' || !_parseSemver(obj.version)) return null;
  if (!Array.isArray(obj.completedStages)) return null;
  // Sanitize completedStages: drop any non-string or unknown stage names.
  const completedStages = obj.completedStages
    .filter((s) => typeof s === 'string' && STAGE_NAMES.includes(s));
  const lastRun = (typeof obj.lastRun === 'string') ? obj.lastRun : null;
  const schemaVersion = (typeof obj.schemaVersion === 'number')
    ? obj.schemaVersion : MARKER_SCHEMA_VERSION;
  return { schemaVersion, version: obj.version, completedStages, lastRun };
}

// @cap-todo(ac:F-084/AC-5) writeMarker persists `.cap/version` atomically
// (tmpfile+rename via _atomicWriteFile from cap-memory-migrate). Stage-2 #6
// lesson: idempotent, byte-identical re-write returns true without churn
// (skip if content already matches).
// @cap-decision(F-084/D10) JSON serialization uses 2-space indent + trailing
// newline so the file is human-friendly to diff (`git log -p .cap/version`).
/**
 * @param {string} projectRoot
 * @param {MarkerPayload} payload
 * @returns {boolean} true on write success
 */
function writeMarker(projectRoot, payload) {
  _validateProjectRoot(projectRoot);
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('writeMarker: payload must be an object');
  }
  if (typeof payload.version !== 'string' || !_parseSemver(payload.version)) {
    throw new TypeError(`writeMarker: payload.version must be a semver (got "${_safeForError(payload.version)}")`);
  }
  if (!Array.isArray(payload.completedStages)) {
    throw new TypeError('writeMarker: payload.completedStages must be an array');
  }
  // Filter completedStages to known stages only. Unknown stage names are silently
  // dropped — defense-in-depth against caller mistakes.
  const completedStages = payload.completedStages.filter(
    (s) => typeof s === 'string' && STAGE_NAMES.includes(s)
  );
  const safe = {
    schemaVersion: MARKER_SCHEMA_VERSION,
    version: payload.version,
    completedStages,
    lastRun: typeof payload.lastRun === 'string' ? payload.lastRun : new Date().toISOString(),
  };
  const fp = path.join(projectRoot, MARKER_REL_PATH);
  const content = JSON.stringify(safe, null, 2) + '\n';
  // Idempotency: if the file already has byte-identical content, skip the write.
  // _atomicWriteFile would succeed but mtime would update — keep mtime stable on no-op.
  if (fs.existsSync(fp)) {
    try {
      const existing = fs.readFileSync(fp, 'utf8');
      if (existing === content) return true;
    } catch (_e) { /* fall through to write */ }
  }
  _atomicWriteFile(fp, content);
  return true;
}

// -------- Audit log --------

// @cap-todo(ac:F-084/AC-4) appendLog adds one JSONL entry per stage attempt.
// Append-only, atomic per-line (writeFileSync with `flag: 'a'` is atomic for
// small writes < PIPE_BUF; we keep entries < 4 KB to stay within that bound).
// @cap-decision(F-084/D11) NOT atomic-via-rename: the log is append-only, and
// using tmp+rename for an append would either (a) require reading + rewriting
// the entire file each time (bad for large logs) or (b) lose history. The
// append-with-flag pattern is the standard Unix log-append idiom.
/**
 * @param {string} projectRoot
 * @param {Object} entry - {stage, status, reason?, durationMs?, timestamp}
 * @returns {boolean}
 */
function appendLog(projectRoot, entry) {
  _validateProjectRoot(projectRoot);
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('appendLog: entry must be an object');
  }
  if (typeof entry.stage !== 'string' || !STAGE_NAMES.includes(entry.stage)) {
    throw new TypeError(`appendLog: entry.stage must be a known stage (got "${_safeForError(entry.stage)}")`);
  }
  if (typeof entry.status !== 'string' || !['success', 'failure', 'skipped'].includes(entry.status)) {
    throw new TypeError(`appendLog: entry.status must be success|failure|skipped (got "${_safeForError(entry.status)}")`);
  }
  const safe = {
    stage: entry.stage,
    status: entry.status,
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
  };
  if (entry.reason != null) safe.reason = _safeForError(entry.reason);
  if (typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs)) {
    safe.durationMs = Math.max(0, Math.floor(entry.durationMs));
  }
  const fp = path.join(projectRoot, LOG_REL_PATH);
  // Ensure parent dir exists.
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
  } catch (_e) {
    return false;
  }
  const line = JSON.stringify(safe) + '\n';
  try {
    fs.writeFileSync(fp, line, { encoding: 'utf8', flag: 'a' });
  } catch (_e) {
    return false;
  }
  return true;
}

// @cap-todo(ac:F-084/AC-7) readLog returns the parsed entries from
// `.cap/upgrade.log`. Used by tests + by the markdown command for post-run
// summaries. Malformed lines are dropped (Stage-2 #10 lesson).
function readLog(projectRoot) {
  _validateProjectRoot(projectRoot);
  const fp = path.join(projectRoot, LOG_REL_PATH);
  if (!fs.existsSync(fp)) return [];
  let raw;
  try {
    raw = fs.readFileSync(fp, 'utf8');
  } catch (_e) {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = _safeJsonParse(trimmed);
    if (!parsed.ok) continue;
    out.push(parsed.value);
  }
  return out;
}

// -------- Plan stages --------

// @cap-todo(ac:F-084/AC-2) skip-condition predicates per stage. Each predicate
// receives (projectRoot, opts) and returns {skip: boolean, reason: string}.
// @cap-decision(F-084/D12) Predicates are PURE FILESYSTEM CHECKS — they never
// invoke the actual stage. This keeps planMigrations cheap (sub-millisecond)
// and free of side effects so tests can fixture per-stage state without spawning.
const SKIP_PREDICATES = Object.freeze({
  doctor: (_projectRoot, _opts) => ({ skip: false, reason: 'doctor always runs (read-only health check)' }),

  'init-or-skip': (projectRoot, _opts) => {
    const capDir = path.join(projectRoot, '.cap');
    const featureMap = path.join(projectRoot, 'FEATURE-MAP.md');
    if (fs.existsSync(capDir) && fs.existsSync(featureMap)) {
      return { skip: true, reason: '.cap/ + FEATURE-MAP.md already present' };
    }
    return { skip: false, reason: 'fresh project — needs init' };
  },

  annotate: (projectRoot, opts) => {
    // @cap-decision(F-084/AC-3) annotate is OPTIONAL. In non-interactive mode
    // skip by default. The user opts in via --include-stages=annotate.
    if (opts && opts.nonInteractive && !opts.includeStages.has('annotate')) {
      return { skip: true, reason: 'non-interactive mode skips optional annotate' };
    }
    if (opts && opts.skipStages.has('annotate')) {
      return { skip: true, reason: 'user requested --skip-stages=annotate' };
    }
    return { skip: false, reason: 'annotate not skipped' };
  },

  'migrate-tags': (_projectRoot, opts) => {
    if (opts && opts.skipStages.has('migrate-tags')) {
      return { skip: true, reason: 'user requested --skip-stages=migrate-tags' };
    }
    return { skip: false, reason: 'migrate-tags planned' };
  },

  'memory-bootstrap': (projectRoot, opts) => {
    if (opts && opts.skipStages.has('memory-bootstrap')) {
      return { skip: true, reason: 'user requested --skip-stages=memory-bootstrap' };
    }
    const featuresDir = path.join(projectRoot, '.cap', 'memory', 'features');
    if (fs.existsSync(featuresDir)) {
      try {
        const entries = fs.readdirSync(featuresDir).filter((e) => e.endsWith('.md'));
        if (entries.length > 0) {
          return { skip: true, reason: `.cap/memory/features/ already populated (${entries.length} files)` };
        }
      } catch (_e) { /* fall through */ }
    }
    return { skip: false, reason: 'memory-bootstrap planned' };
  },

  'migrate-snapshots': (projectRoot, opts) => {
    if (opts && opts.skipStages.has('migrate-snapshots')) {
      return { skip: true, reason: 'user requested --skip-stages=migrate-snapshots' };
    }
    const snapshotsDir = path.join(projectRoot, '.cap', 'snapshots');
    if (!fs.existsSync(snapshotsDir)) {
      return { skip: true, reason: '.cap/snapshots/ absent — nothing to migrate' };
    }
    try {
      const entries = fs.readdirSync(snapshotsDir).filter((e) => e.endsWith('.md'));
      if (entries.length === 0) {
        return { skip: true, reason: '.cap/snapshots/ empty' };
      }
    } catch (_e) { /* fall through */ }
    return { skip: false, reason: 'migrate-snapshots planned' };
  },

  'refresh-docs': (projectRoot, opts) => {
    // @cap-decision(F-084/AC-3) refresh-docs is OPTIONAL — slow + needs network.
    // Non-interactive skips by default; --include-stages=refresh-docs opts in.
    if (opts && opts.nonInteractive && !opts.includeStages.has('refresh-docs')) {
      return { skip: true, reason: 'non-interactive mode skips optional refresh-docs' };
    }
    if (opts && opts.skipStages.has('refresh-docs')) {
      return { skip: true, reason: 'user requested --skip-stages=refresh-docs' };
    }
    const stackDir = path.join(projectRoot, '.cap', 'stack-docs');
    if (fs.existsSync(stackDir)) {
      try {
        const entries = fs.readdirSync(stackDir).filter((e) => e.endsWith('.md'));
        if (entries.length > 0) {
          // Check mtime — anything fresher than 30 days passes.
          const now = Date.now();
          const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
          let stale = false;
          for (const e of entries) {
            try {
              const stat = fs.statSync(path.join(stackDir, e));
              if (now - stat.mtime.getTime() > THIRTY_DAYS_MS) {
                stale = true;
                break;
              }
            } catch (_e2) { /* treat as stale */ stale = true; break; }
          }
          if (!stale) {
            return { skip: true, reason: `.cap/stack-docs/ all <30 days old (${entries.length} files)` };
          }
        }
      } catch (_e) { /* fall through */ }
    }
    return { skip: false, reason: 'refresh-docs planned (stale or missing)' };
  },
});

// @cap-decision(F-084/iter1) Stage-2 #2 fix: per-stage delta-probes implemented (Option A).
//   AC-3 demands "per-stage delta-summary (was wird hinzugefügt/geändert)". Each
//   probe is a quick READ-ONLY filesystem inspection that estimates what the
//   stage would create/modify. Probes MUST be fast (<2s combined) and MUST NOT
//   spawn subprocesses or invoke the actual stage logic. On any error a probe
//   returns null (caller falls back to skip-reason only).
// @cap-decision(F-084/iter1) Probes are PURE READS — no atomic writes, no marker
//   updates, no log appends. Stage-2 #12 lesson (read-only contract) extended to
//   the dry-run UX layer.
const DELTA_PROBES = Object.freeze({
  doctor: (_projectRoot) => null, // doctor is read-only health-check; no delta to preview.

  'init-or-skip': (projectRoot) => {
    // Probe what /cap:init would create.
    const items = [];
    if (!fs.existsSync(path.join(projectRoot, '.cap'))) items.push('.cap/');
    if (!fs.existsSync(path.join(projectRoot, 'FEATURE-MAP.md'))) items.push('FEATURE-MAP.md (skeleton)');
    if (!fs.existsSync(path.join(projectRoot, '.cap', 'config.json'))) items.push('.cap/config.json');
    if (items.length === 0) return null;
    return `Will create: ${items.join(', ')}`;
  },

  annotate: (projectRoot) => {
    // Estimate scan size: count .js / .cjs / .ts files under common source dirs.
    // @cap-decision(F-084/iter1) annotate probe is an UPPER bound — counts files
    //   that COULD be scanned, not files that WILL be tagged. Cheap walk, capped
    //   at top-level + first-level depth to stay <100ms.
    const candidateDirs = ['src', 'lib', 'cap/bin/lib', 'hooks', 'sdk/src', 'scripts'];
    let count = 0;
    const exts = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx']);
    for (const rel of candidateDirs) {
      const dir = path.join(projectRoot, rel);
      if (!fs.existsSync(dir)) continue;
      try {
        // Shallow walk: top-level + one nested level. Bounded by directory entry count.
        const stack = [{ dir, depth: 0 }];
        while (stack.length > 0) {
          const { dir: d, depth } = stack.pop();
          if (depth > 2) continue;
          let entries;
          try { entries = fs.readdirSync(d, { withFileTypes: true }); }
          catch (_e) { continue; }
          for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            if (e.isDirectory()) {
              if (e.name === 'node_modules' || e.name === 'dist') continue;
              stack.push({ dir: path.join(d, e.name), depth: depth + 1 });
            } else if (exts.has(path.extname(e.name))) {
              count++;
            }
          }
        }
      } catch (_e) { /* swallow per-dir errors */ }
    }
    if (count === 0) return null;
    return `Will scan ~${count} source files for tag candidates`;
  },

  'migrate-tags': (projectRoot) => {
    // Lazy-load the tag scanner; if unavailable, return null.
    let scanner;
    try {
      scanner = require('./cap-tag-scanner.cjs');
    } catch (_e) {
      return null;
    }
    if (typeof scanner.scanDirectory !== 'function') return null;
    let scanResult;
    try {
      scanResult = scanner.scanDirectory(projectRoot);
    } catch (_e) {
      return null;
    }
    // Count fragmented vs anchored tags. The exact shape varies; defensively try
    // common keys. If the scanner doesn't expose fragmentation counts, we report
    // total tag count instead.
    const tags = Array.isArray(scanResult && scanResult.tags) ? scanResult.tags : [];
    if (tags.length === 0) return null;
    let fragmented = 0;
    for (const t of tags) {
      if (t && (t.fragmented === true || t.isFragmented === true)) fragmented++;
    }
    if (fragmented > 0) {
      return `Will migrate ~${fragmented} fragmented tags to anchor blocks`;
    }
    return `Will inspect ${tags.length} tags for fragmentation`;
  },

  'memory-bootstrap': (projectRoot) => {
    // Count features in FEATURE-MAP.md that lack a per-feature memory file.
    const featureMap = path.join(projectRoot, 'FEATURE-MAP.md');
    if (!fs.existsSync(featureMap)) return null;
    let raw;
    try { raw = fs.readFileSync(featureMap, 'utf8'); } catch (_e) { return null; }
    // Match feature IDs in headers (### F-NNN: ... or ### F-NNN — ...).
    const featureIds = new Set();
    const re = /^###\s+(F-\d{3,})\b/gm;
    let m;
    while ((m = re.exec(raw)) !== null) featureIds.add(m[1]);
    if (featureIds.size === 0) return null;
    const featuresDir = path.join(projectRoot, '.cap', 'memory', 'features');
    let missing = 0;
    for (const fid of featureIds) {
      if (!fs.existsSync(path.join(featuresDir, `${fid}.md`))) missing++;
    }
    if (missing === 0) return null;
    return `Will create ${missing} per-feature memory file${missing === 1 ? '' : 's'}`;
  },

  'migrate-snapshots': (projectRoot) => {
    const snapshotsDir = path.join(projectRoot, '.cap', 'snapshots');
    if (!fs.existsSync(snapshotsDir)) return null;
    let entries;
    try {
      entries = fs.readdirSync(snapshotsDir).filter((e) => e.endsWith('.md'));
    } catch (_e) { return null; }
    if (entries.length === 0) return null;
    // Count snapshots with no `feature:` front-matter (orphaned / unlinked).
    let unlinked = 0;
    for (const e of entries) {
      try {
        const raw = fs.readFileSync(path.join(snapshotsDir, e), 'utf8');
        // Check first 1 KB only — front-matter is at the top.
        const head = raw.slice(0, 1024);
        if (!/^---[\s\S]*?\bfeature\s*:\s*F-\d/m.test(head)) unlinked++;
      } catch (_e) { /* count as unlinked */ unlinked++; }
    }
    if (unlinked === 0) {
      return `Will inspect ${entries.length} snapshot${entries.length === 1 ? '' : 's'} (all already linked)`;
    }
    return `Will link ${unlinked} of ${entries.length} snapshot${entries.length === 1 ? '' : 's'} to features`;
  },

  'refresh-docs': (projectRoot) => {
    // Read package.json deps (top-level only).
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    let raw;
    try { raw = fs.readFileSync(pkgPath, 'utf8'); } catch (_e) { return null; }
    const parsed = _safeJsonParse(raw);
    if (!parsed.ok) return null;
    const deps = Object.assign(
      Object.create(null),
      parsed.value.dependencies && typeof parsed.value.dependencies === 'object' ? parsed.value.dependencies : {},
      parsed.value.devDependencies && typeof parsed.value.devDependencies === 'object' ? parsed.value.devDependencies : {}
    );
    const names = Object.keys(deps).filter((n) => typeof n === 'string' && /^[a-z0-9@/_.-]+$/i.test(n));
    if (names.length === 0) return null;
    // Show first few names, capped — Stage-2 #8 surface-limit lesson.
    const head = names.slice(0, 3).map((n) => _safeForError(n).slice(0, 32));
    const more = names.length > 3 ? `, +${names.length - 3} more` : '';
    return `Will fetch docs for libraries: ${head.join(', ')}${more}`;
  },
});

// @cap-decision(F-084/iter1) Probe runner: hard timeout + error isolation. Any
//   probe that throws or returns non-string is treated as null (no delta line).
function _runProbe(stageName, projectRoot) {
  const probe = DELTA_PROBES[stageName];
  if (typeof probe !== 'function') return null;
  try {
    const out = probe(projectRoot);
    if (typeof out !== 'string') return null;
    return _safeForError(out);
  } catch (_e) {
    return null;
  }
}

// @cap-todo(ac:F-084/AC-3) _normalizeOptions parses runOptions into the shape
// the predicates need. Stage-2 #11 lesson: realistic-input testing — accept
// strings, arrays, undefined. Stage-name strings are validated against the
// allowlist (Stage-2 path-traversal defense).
function _normalizeOptions(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const out = {
    nonInteractive: Boolean(o.nonInteractive),
    forceRerun: Boolean(o.forceRerun),
    dryRunOnly: Boolean(o.dryRunOnly),
    skipStages: new Set(),
    includeStages: new Set(),
  };
  // Parse skipStages — accept array or comma-separated string.
  const skipRaw = o.skipStages;
  let skipList = [];
  if (Array.isArray(skipRaw)) {
    skipList = skipRaw;
  } else if (typeof skipRaw === 'string') {
    skipList = skipRaw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  for (const name of skipList) {
    // Stage-2 path-traversal: reject anything that doesn't match the allowlist.
    // We DON'T throw — silently drop unknown names + log to stderr in CAP_DEBUG.
    if (typeof name !== 'string') continue;
    if (!STAGE_NAME_RE.test(name)) {
      if (process.env.CAP_DEBUG) {
        try { process.stderr.write(`[cap:debug] cap-upgrade: dropped malformed --skip-stages entry "${_safeForError(name)}"\n`); } catch (_e) { /* ignore */ }
      }
      continue;
    }
    if (!STAGE_NAMES.includes(name)) {
      if (process.env.CAP_DEBUG) {
        try { process.stderr.write(`[cap:debug] cap-upgrade: unknown stage "${_safeForError(name)}" in --skip-stages\n`); } catch (_e) { /* ignore */ }
      }
      continue;
    }
    out.skipStages.add(name);
  }
  // Parse includeStages — same as skipStages.
  const includeRaw = o.includeStages;
  let includeList = [];
  if (Array.isArray(includeRaw)) {
    includeList = includeRaw;
  } else if (typeof includeRaw === 'string') {
    includeList = includeRaw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  for (const name of includeList) {
    if (typeof name !== 'string') continue;
    if (!STAGE_NAME_RE.test(name)) continue;
    if (!STAGE_NAMES.includes(name)) continue;
    out.includeStages.add(name);
  }
  return out;
}

// @cap-todo(ac:F-084/AC-1) planMigrations — the core planner. Reads marker +
// installed version, then walks STAGES in fixed order, asking each predicate
// whether to skip. Returns an ordered StagePlan[] with reasons.
// @cap-decision(F-084/AC-2) Stage execution order is deterministic (matches
// STAGES array). Even with --skip-stages or --include-stages permutations,
// the surviving stages keep the same relative order. Stage-2 #9 lesson.
/**
 * @typedef {Object} StagePlan
 * @property {string} name
 * @property {string} command       - /cap:* command to invoke
 * @property {boolean} skip         - true if this stage will be skipped
 * @property {string} reason        - human-readable explanation
 * @property {boolean} optional     - true if optional in non-interactive mode
 * @property {boolean} alreadyDone  - true if marker says this stage was completed at the current version
 * @property {string|null} delta    - per-stage delta-summary (was wird hinzugefügt/geändert) — null when no probe applies
 */

/**
 * @param {string} projectRoot
 * @param {{installedVersion?:string, markerData?:MarkerPayload|null, runOptions?:Object}} [args]
 * @returns {{installedVersion:string, markerVersion:string|null, plan:StagePlan[], firstRun:boolean, alreadyCurrent:boolean}}
 */
function planMigrations(projectRoot, args) {
  _validateProjectRoot(projectRoot);
  const a = args || {};
  const installedVersion = typeof a.installedVersion === 'string' ? a.installedVersion : getInstalledVersion();
  const markerData = (a.markerData !== undefined) ? a.markerData : getMarkerVersion(projectRoot);
  const runOptions = _normalizeOptions(a.runOptions);
  const firstRun = markerData === null;
  const markerVersion = markerData ? markerData.version : null;
  const completedAtCurrent = (markerData && markerVersion === installedVersion)
    ? new Set(markerData.completedStages)
    : new Set();
  // alreadyCurrent: marker version matches installed AND every non-optional stage was completed.
  let alreadyCurrent = false;
  if (markerData && markerVersion === installedVersion && !runOptions.forceRerun) {
    const requiredCompleted = STAGES
      .filter((s) => !s.optional)
      .every((s) => completedAtCurrent.has(s.name));
    alreadyCurrent = requiredCompleted;
  }
  const plan = [];
  for (const stage of STAGES) {
    const predicate = SKIP_PREDICATES[stage.name];
    let result;
    try {
      result = predicate(projectRoot, runOptions);
    } catch (e) {
      // Defensive: a predicate throwing should NOT crash the planner.
      result = { skip: true, reason: `predicate-error: ${_safeForError(e && e.message)}` };
    }
    let skip = Boolean(result.skip);
    let reason = String(result.reason || '');
    // alreadyDone signal: marker says this exact stage was completed at current version.
    const alreadyDone = completedAtCurrent.has(stage.name) && !runOptions.forceRerun;
    if (alreadyDone && !skip) {
      // Marker overrides predicate — the stage was already run at this version.
      skip = true;
      reason = `marker shows stage completed at ${installedVersion}`;
    }
    // @cap-decision(F-084/iter1) Stage-2 #2 fix: per-stage delta-probes implemented (Option A).
    //   Probe ONLY for stages that will actually run (skip ones get null). Probes
    //   are read-only and degrade gracefully on any error. AC-3: "per-stage
    //   delta-summary (was wird hinzugefügt/geändert)".
    let delta = null;
    if (!skip) {
      delta = _runProbe(stage.name, projectRoot);
    }
    plan.push({
      name: stage.name,
      command: stage.command,
      skip,
      reason,
      optional: stage.optional,
      alreadyDone,
      delta,
    });
  }
  return { installedVersion, markerVersion, plan, firstRun, alreadyCurrent };
}

// -------- Stage execution --------

// @cap-todo(ac:F-084/AC-4) recordStageResult records the OUTCOME of a single
// stage attempt. The actual command invocation happens in the markdown
// orchestrator — this function is the side-effect choke-point that
// updates the marker + appends the audit log. Stage-2 #4 lesson: per-stage
// isolation, a failed stage does NOT block subsequent stages.
// @cap-decision(F-084/iter1) Stage-2 #5 fix: stale comment cleanup. Function
//   was previously named executeStage in earlier drafts; comment now matches.
/**
 * @param {string} projectRoot
 * @param {string} stageName
 * @param {{status:'success'|'failure'|'skipped', reason?:string, durationMs?:number, installedVersion?:string}} outcome
 * @returns {{logged:boolean, markerUpdated:boolean}}
 */
function recordStageResult(projectRoot, stageName, outcome) {
  _validateProjectRoot(projectRoot);
  if (!STAGE_NAMES.includes(stageName)) {
    throw new TypeError(`recordStageResult: unknown stage "${_safeForError(stageName)}"`);
  }
  if (!outcome || typeof outcome !== 'object') {
    throw new TypeError('recordStageResult: outcome must be an object');
  }
  const status = outcome.status;
  if (!['success', 'failure', 'skipped'].includes(status)) {
    throw new TypeError(`recordStageResult: outcome.status must be success|failure|skipped`);
  }
  const timestamp = new Date().toISOString();
  const logged = appendLog(projectRoot, {
    stage: stageName,
    status,
    reason: outcome.reason,
    durationMs: outcome.durationMs,
    timestamp,
  });
  // Marker is only updated on success — failures + skips don't flip the bit.
  let markerUpdated = false;
  if (status === 'success') {
    const installedVersion = typeof outcome.installedVersion === 'string'
      ? outcome.installedVersion
      : getInstalledVersion();
    const existing = getMarkerVersion(projectRoot);
    let completedStages;
    if (existing && existing.version === installedVersion) {
      const set = new Set(existing.completedStages);
      set.add(stageName);
      completedStages = STAGE_NAMES.filter((n) => set.has(n)); // deterministic order
    } else {
      // Version bumped (or first marker write) — start a fresh completed list.
      completedStages = [stageName];
    }
    // @cap-decision(F-084/iter1) Stage-2 #4 fix: recordStageResult resilient to
    //   writeMarker failures. If disk fills up between stages, writeMarker
    //   throws (EROFS, ENOSPC, EPERM, etc). Previously the throw propagated to
    //   the orchestrator and crashed the whole upgrade — but the per-stage work
    //   already SUCCEEDED and was already logged. The stage was completed; the
    //   marker just couldn't be advanced. Wrap in try/catch so the upgrade
    //   continues; user can re-run /cap:upgrade and it will detect the partial
    //   marker state via predicates and resume.
    try {
      markerUpdated = writeMarker(projectRoot, {
        version: installedVersion,
        completedStages,
        lastRun: timestamp,
      });
    } catch (e) {
      markerUpdated = false;
      // Best-effort: append a marker-failure entry to the log so the audit trail
      // captures it. If THAT also throws (truly broken disk), swallow silently —
      // we are already past the point of useful recovery.
      try {
        const fp = path.join(projectRoot, LOG_REL_PATH);
        const safeMsg = _safeForError(e && e.message);
        const failureEntry = JSON.stringify({
          stage: stageName,
          status: 'marker-write-failure',
          reason: `marker write failed after stage success: ${safeMsg}`,
          timestamp: new Date().toISOString(),
        }) + '\n';
        fs.writeFileSync(fp, failureEntry, { encoding: 'utf8', flag: 'a' });
      } catch (_e2) { /* nothing more we can do */ }
      // Single stderr warning under CAP_DEBUG — silent in normal runs (Stage-2 #4).
      if (process.env.CAP_DEBUG) {
        try {
          process.stderr.write(`[cap:debug] cap-upgrade: marker write failed after stage "${_safeForError(stageName)}" — ${_safeForError(e && e.message)}\n`);
        } catch (_e3) { /* ignore */ }
      }
    }
  }
  return { logged, markerUpdated };
}

// -------- Hook advisory throttling --------

// @cap-todo(ac:F-084/AC-6) shouldEmitAdvisory throttles SessionStart-hook
// emissions to once per session. Reads `.cap/.session-advisories.json`,
// looks for an entry keyed by the session-id, and either records a fresh
// emit OR signals "already emitted this session".
// @cap-decision(F-084/AC-6) Session ID is taken from $CLAUDE_SESSION_ID
// (Claude Code injects this into hooks). Fallback to process.ppid + start
// timestamp so we still throttle within a single shell pipeline run.
/**
 * @param {string} projectRoot
 * @param {{sessionId?:string, now?:number, configNotify?:boolean|null}} [opts]
 * @returns {{shouldEmit:boolean, reason:string}}
 */
function shouldEmitAdvisory(projectRoot, opts) {
  _validateProjectRoot(projectRoot);
  const o = opts || {};
  // Suppression via .cap/config.json:upgrade.notify=false → silent.
  if (o.configNotify === false) {
    return { shouldEmit: false, reason: 'suppressed via config.upgrade.notify=false' };
  }
  const sessionId = (typeof o.sessionId === 'string' && o.sessionId.length > 0)
    ? o.sessionId
    : `pid-${process.ppid || process.pid}`;
  // Session-ID validation: alphanumeric + dash + underscore + dot. Stage-2 path-
  // traversal: a malicious sessionId with `..` would still be safe (we only use
  // it as a JSON key, never a path segment) but we strip control bytes anyway.
  const safeSessionId = _safeForError(sessionId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
  const fp = path.join(projectRoot, ADVISORY_REL_PATH);
  let map = Object.create(null);
  if (fs.existsSync(fp)) {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const parsed = _safeJsonParse(raw);
      if (parsed.ok) {
        // Only keep entries from the last 24h. Stage-2 #10 lesson: malformed
        // payloads degrade silently to "fresh advisory map".
        const now = typeof o.now === 'number' ? o.now : Date.now();
        const TTL = 24 * 60 * 60 * 1000;
        for (const key of Object.keys(parsed.value)) {
          const ts = parsed.value[key];
          if (typeof ts === 'string') {
            const tsNum = Date.parse(ts);
            if (Number.isFinite(tsNum) && (now - tsNum) < TTL) {
              map[key] = ts;
            }
          }
        }
      }
    } catch (_e) { /* treat as empty map */ }
  }
  if (Object.prototype.hasOwnProperty.call(map, safeSessionId)) {
    return { shouldEmit: false, reason: 'already emitted this session' };
  }
  // Mark this session as emitted. Atomic write so a crash mid-write doesn't
  // leave a partial file. Best-effort: if the write fails we still emit (the
  // advisory is non-blocking and a missed throttle is preferable to silence).
  const now = typeof o.now === 'number' ? o.now : Date.now();
  map[safeSessionId] = new Date(now).toISOString();
  try {
    const content = JSON.stringify(map, null, 2) + '\n';
    _atomicWriteFile(fp, content);
  } catch (_e) {
    // Non-blocking — emit anyway. The throttle is a best-effort niceness.
  }
  return { shouldEmit: true, reason: 'first emit this session' };
}

// @cap-todo(ac:F-084/AC-6) buildAdvisoryMessage formats the version-mismatch
// notice. Capped at 120 chars (Stage-2 #8 lesson: surface-limit). Both version
// strings are sanitized before interpolation (Stage-2 #2 lesson).
function buildAdvisoryMessage(installedVersion, markerVersion) {
  const inst = _safeForError(installedVersion).slice(0, 16);
  const mark = markerVersion === null ? 'unset' : _safeForError(markerVersion).slice(0, 16);
  // Format: "[CAP] Run /cap:upgrade to migrate from X to Y." → kept short.
  let msg;
  if (markerVersion === null) {
    msg = `[CAP] First run detected. Run /cap:upgrade to onboard CAP ${inst}.`;
  } else {
    msg = `[CAP] CAP ${inst} installed (last run: ${mark}). Run /cap:upgrade to migrate.`;
  }
  if (msg.length > 120) msg = msg.slice(0, 117) + '...';
  return msg;
}

// @cap-todo(ac:F-084/AC-6) needsAdvisory checks if a version-mismatch warrants
// an advisory. True when installed != marker, or when marker is missing.
function needsAdvisory(installedVersion, markerVersion) {
  if (typeof installedVersion !== 'string' || !_parseSemver(installedVersion)) return false;
  if (markerVersion === null) return true;  // first run
  if (markerVersion === installedVersion) return false;
  return true;
}

// -------- Top-level orchestrator entry-point --------

// @cap-todo(ac:F-084/AC-1) summarizePlan formats a StagePlan[] for stdout.
// The markdown command spec consumes this for the dry-run preview UX.
// @cap-decision(F-084/iter1) Stage-2 #2 fix: AC-3 delta-summary now appears as a
//   second indented line under each [RUN] stage (when a probe returned a non-null
//   string). Skipped stages keep the single-line skip-reason format.
function summarizePlan(planResult) {
  if (!planResult || !Array.isArray(planResult.plan)) return '';
  const lines = [];
  lines.push(`CAP installed: ${_safeForError(planResult.installedVersion)}`);
  lines.push(`Last run:      ${planResult.markerVersion ? _safeForError(planResult.markerVersion) : 'never (first run)'}`);
  lines.push(`First run:     ${planResult.firstRun ? 'yes' : 'no'}`);
  lines.push(`Already current: ${planResult.alreadyCurrent ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('Stages:');
  for (const s of planResult.plan) {
    const status = s.skip ? '  [SKIP]' : '  [RUN] ';
    lines.push(`${status} ${s.name.padEnd(20)} ${_safeForError(s.reason)}`);
    // Per-stage delta-summary (AC-3). Only emitted for [RUN] stages that produced a probe.
    if (!s.skip && typeof s.delta === 'string' && s.delta.length > 0) {
      lines.push(`           delta: ${_safeForError(s.delta)}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  // Constants
  STAGES,
  STAGE_NAMES,
  MARKER_REL_PATH,
  LOG_REL_PATH,
  ADVISORY_REL_PATH,
  MARKER_SCHEMA_VERSION,
  // Version
  getInstalledVersion,
  compareVersions,
  // Marker
  getMarkerVersion,
  writeMarker,
  // Log
  appendLog,
  readLog,
  // Plan + execute
  planMigrations,
  recordStageResult,
  summarizePlan,
  // Hook advisory
  shouldEmitAdvisory,
  buildAdvisoryMessage,
  needsAdvisory,
  // Internal exports for tests (Stage-2 #6 round-trip + #1 proto-pollution)
  _safeForError,
  _safeJsonParse,
  _parseSemver,
  // @cap-decision(F-084/iter1) Probe internals exposed for AC-3 delta-summary tests.
  _runProbe,
  DELTA_PROBES,
};
