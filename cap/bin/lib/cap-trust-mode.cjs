// @cap-feature(feature:F-075, primary:true) Trust-Mode Configuration Slot — open-closed for future B/C activation.
// @cap-context Trust-Mode is the first-class config axis for V5-true Self-Learning. MVP only enables A.
//              F-071 (Pattern Extraction), F-073 (Review Board), F-074 (Apply/Unlearn) will consume this helper
//              via getTrustMode() + requireApproval() so B/C activation is a library-internal change only.
// @cap-decision(F-075/D1) .cap/config.json is source-of-truth for trustMode; SESSION.json mirrors per-session.
//                         On divergence, config wins and SESSION.json is aligned on next read.
// @cap-decision(F-075/D2) getTrustMode returns { mode, source, degraded? } for debug transparency.
//                         Shape is frozen from MVP onward — B/C activation MUST NOT change the return shape.
// @cap-decision(F-075/D3) requireApproval(projectRoot) is the open-closed extension point for B/C.
//                         MVP: always true. Future B: scope-aware. Future C: returns false.
// @cap-decision(F-075/D4) Non-A degradation warning rate-limited to 1× per process via in-memory Set-memo.
//                         Keyed by projectRoot + raw value so distinct degradations still log once each.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins (fs, path, os, crypto).
// @cap-pattern All trust-mode reads/writes go through this module — no other code touches trustMode directly.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const CAP_DIR = '.cap';
const CONFIG_FILE = 'config.json';

// @cap-decision(F-075/D2) VALID_MODES is the single authoritative set. Adding D/E here
//                         is the ONLY code change needed when the mode axis ever extends.
const VALID_MODES = Object.freeze(['A', 'B', 'C']);
const DEFAULT_MODE = 'A';

// @cap-decision(F-075/D5) Every TrustModeResult returned to a caller is Object.freeze-d at the
//                         boundary. Consumers (F-071/F-073/F-074) must not be able to mutate the
//                         object in a way that alters later reads or a shared memo. Defense-in-depth
//                         for the open-closed contract: even buggy consumer code can't silently
//                         flip mode to 'C' mid-pipeline.
function _frozenResult(obj) {
  return Object.freeze(obj);
}

// @cap-decision(F-075/D4) Warning rate-limit memo is process-local (not persisted).
//                         Each fresh node process logs once per (projectRoot, rawValue) combo.
const _warnOnceMemo = new Set();

const WARN_CODE = 'trust-mode-not-implemented';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * @typedef {'A'|'B'|'C'} TrustMode
 *
 * @typedef {Object} TrustModeResult
 * @property {TrustMode} mode - Effective trust mode (always 'A' in MVP).
 * @property {'config'|'session'|'default'} source - Where the value came from.
 * @property {boolean} [degraded] - Present and true when a non-A value was read and degraded to A.
 * @property {*} [rawValue] - The raw value seen in config/session when degraded.
 */

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-075/AC-3) Non-A degradation — isValidMode is the gate that triggers the downgrade branch.
/**
 * Check whether `value` is one of the allowed trust-mode strings.
 * Strict equality — no lowercasing, no trimming. 'a' is NOT valid, only 'A'.
 * @param {*} value
 * @returns {boolean}
 */
function isValidMode(value) {
  return typeof value === 'string' && VALID_MODES.includes(value);
}

// -----------------------------------------------------------------------------
// Config I/O (private)
// -----------------------------------------------------------------------------

/**
 * Read .cap/config.json. Returns `{}` when missing or malformed (no throw).
 * Mirrors cap-telemetry's readConfig pattern for behavioural consistency.
 * @param {string} projectRoot
 * @returns {object}
 */
function _readConfig(projectRoot) {
  const configPath = path.join(projectRoot, CAP_DIR, CONFIG_FILE);
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    // @cap-decision(F-075/D1) Non-object roots (strings, arrays, null) normalise to {} so that
    //                         cfg.trustMode cannot throw. Matches cap-telemetry D5.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_e) {
    return {};
  }
}

// @cap-todo(ac:F-075/AC-2) Persist trustMode across sessions via atomic write to .cap/config.json.
/**
 * Atomically write `config` to .cap/config.json. Creates .cap/ if needed.
 * Uses temp+rename so a crashed write cannot leave a half-written JSON file.
 * @param {string} projectRoot
 * @param {object} config
 */
function _writeConfig(projectRoot, config) {
  const capDir = path.join(projectRoot, CAP_DIR);
  if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });

  const configPath = path.join(capDir, CONFIG_FILE);
  // Unique tmp suffix avoids clashes under concurrent writes from the same process.
  const tmpPath = path.join(
    capDir,
    `.${CONFIG_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  const payload = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(tmpPath, payload, 'utf8');
  fs.renameSync(tmpPath, configPath);
}

// -----------------------------------------------------------------------------
// Warning emission (private)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-075/AC-3) Warning rate-limit — one stderr line per (projectRoot, rawValue) per process.
/**
 * Emit a single-line stderr warning for non-A degradation, rate-limited to once per
 * (projectRoot, rawValue) combination per Node process.
 * @param {string} projectRoot
 * @param {*} rawValue
 */
function _warnOnce(projectRoot, rawValue) {
  // JSON.stringify is the cheapest stable key; handles objects, nulls, numbers, booleans.
  let keyPart;
  try {
    keyPart = JSON.stringify(rawValue);
  } catch (_e) {
    keyPart = String(rawValue);
  }
  const memoKey = `${projectRoot}::${keyPart}`;
  if (_warnOnceMemo.has(memoKey)) return;
  _warnOnceMemo.add(memoKey);

  const ts = new Date().toISOString();
  const displayValue = keyPart === undefined ? 'undefined' : keyPart;
  // Single line — grep-friendly. Code token is stable and documented.
  // eslint-disable-next-line no-console
  console.error(
    `[${ts}] ${WARN_CODE} trustMode=${displayValue} — MVP only supports 'A'; degrading to 'A'.`,
  );
}

/**
 * Test-only hook to clear the warn-once memo so unit tests can assert rate-limit behaviour
 * across multiple invocations without spawning child processes.
 * @private
 */
function _resetWarnOnceForTests() {
  _warnOnceMemo.clear();
}

// -----------------------------------------------------------------------------
// Session sync (private)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-075/AC-1) SESSION.json must carry trustMode field; this helper aligns it with config.
/**
 * Align SESSION.json.trustMode with the resolved mode, if SESSION.json exists.
 * Failures are silent — SESSION.json is ephemeral and its absence/corruption must
 * never break the read path. Uses cap-session via lazy require to avoid a hard
 * cycle (cap-session re-exports getTrustMode for convenience).
 * @param {string} projectRoot
 * @param {TrustMode} resolvedMode
 */
function _syncSession(projectRoot, resolvedMode) {
  try {
    // Lazy require — cap-session may later want to import cap-trust-mode; keep the
    // edge loose so require-order never matters.
    const session = require('./cap-session.cjs');
    const current = session.loadSession(projectRoot);
    if (current.trustMode !== resolvedMode) {
      session.updateSession(projectRoot, { trustMode: resolvedMode });
    }
  } catch (_e) {
    // Silent — SESSION mirror is a debug affordance, not a correctness contract.
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-075/AC-1) SESSION.json trustMode field — this helper is the read path.
// @cap-todo(ac:F-075/AC-2) .cap/config.json persistence — config is read as source-of-truth.
// @cap-todo(ac:F-075/AC-3) Non-A degradation — invalid values are coerced to 'A' with rate-limited warning.
// @cap-todo(ac:F-075/AC-5) Determinism — pure function of on-disk state; same inputs, same output.
// @cap-todo(ac:F-075/AC-6) Single helper exposed to all Learn-Pipeline consumers (F-071, F-073, F-074).
// @cap-todo(ac:F-075/AC-7) Open-closed — only the return value of this function changes for B/C activation;
//                          the shape stays frozen. Feature code MUST NOT read config/session directly.
/**
 * Resolve the effective trust mode for `projectRoot`.
 *
 * Precedence:
 *   1. .cap/config.json → `trustMode` (source-of-truth)
 *   2. SESSION.json → `trustMode` (per-session cache)
 *   3. DEFAULT_MODE ('A')
 *
 * Any non-valid mode is degraded to 'A' with `degraded:true` and a rate-limited
 * stderr warning. In the MVP this always resolves to 'A'.
 *
 * @param {string} projectRoot - Absolute path to project root.
 * @returns {TrustModeResult}
 */
function getTrustMode(projectRoot) {
  const cfg = _readConfig(projectRoot);

  // 1. Config-sourced
  if (Object.prototype.hasOwnProperty.call(cfg, 'trustMode')) {
    const raw = cfg.trustMode;
    if (isValidMode(raw)) {
      // @cap-decision(F-075/D2) MVP hard-caps to A even when B/C is a syntactically valid mode,
      //                         so accidental config edits do not silently unlock unsupported behaviour.
      //                         When B/C is implemented, drop the cap but keep the shape.
      if (raw === DEFAULT_MODE) {
        _syncSession(projectRoot, DEFAULT_MODE);
        return _frozenResult({ mode: DEFAULT_MODE, source: 'config' });
      }
      // raw is 'B' or 'C' — degrade with warning
      _warnOnce(projectRoot, raw);
      _syncSession(projectRoot, DEFAULT_MODE);
      return _frozenResult({ mode: DEFAULT_MODE, source: 'config', degraded: true, rawValue: raw });
    }
    // Invalid (wrong type/case/etc.) — degrade with warning
    _warnOnce(projectRoot, raw);
    _syncSession(projectRoot, DEFAULT_MODE);
    return _frozenResult({ mode: DEFAULT_MODE, source: 'config', degraded: true, rawValue: raw });
  }

  // 2. Session-sourced — only counts when SESSION.json actually exists on disk,
  //    otherwise loadSession() returns the default stub and we'd mis-attribute the source.
  const sessionPath = path.join(projectRoot, CAP_DIR, 'SESSION.json');
  if (fs.existsSync(sessionPath)) {
    try {
      const session = require('./cap-session.cjs');
      const sess = session.loadSession(projectRoot);
      if (Object.prototype.hasOwnProperty.call(sess, 'trustMode') && sess.trustMode != null) {
        const raw = sess.trustMode;
        if (isValidMode(raw) && raw === DEFAULT_MODE) {
          return _frozenResult({ mode: DEFAULT_MODE, source: 'session' });
        }
        // Valid-but-unsupported (B/C) or plain invalid — both degrade with warning.
        _warnOnce(projectRoot, raw);
        _syncSession(projectRoot, DEFAULT_MODE);
        return _frozenResult({ mode: DEFAULT_MODE, source: 'session', degraded: true, rawValue: raw });
      }
    } catch (_e) {
      // cap-session unavailable — fall through to default.
    }
  }

  // 3. Default
  return _frozenResult({ mode: DEFAULT_MODE, source: 'default' });
}

// @cap-todo(ac:F-075/AC-2) Persistence writer — atomic write to .cap/config.json.
/**
 * Persist `mode` into .cap/config.json (source-of-truth) and mirror into SESSION.json.
 * Rejects unknown modes with a thrown Error — this is a developer-facing setter, not a
 * silent coercion path. Use `getTrustMode` for the silent-degrade read path.
 *
 * @param {string} projectRoot
 * @param {TrustMode} mode
 * @returns {TrustModeResult}
 */
function setTrustMode(projectRoot, mode) {
  if (!isValidMode(mode)) {
    throw new Error(
      `setTrustMode: invalid mode ${JSON.stringify(mode)}. Expected one of ${VALID_MODES.join(', ')}.`,
    );
  }
  const cfg = _readConfig(projectRoot);
  cfg.trustMode = mode;
  _writeConfig(projectRoot, cfg);
  _syncSession(projectRoot, DEFAULT_MODE);
  // Read-back through getTrustMode to get the same shape every caller sees,
  // including the degraded flag for B/C in the MVP.
  return getTrustMode(projectRoot);
}

// @cap-todo(ac:F-075/AC-4) Human-in-the-Loop approval gate — MVP always requires approval.
// @cap-todo(ac:F-075/AC-7) Open-closed extension point — B/C activation changes only this return.
/**
 * Return true iff the caller must solicit a human approval before applying a
 * Learn-Pipeline write (pattern extraction, patch apply, unlearn).
 *
 * MVP contract:
 *   - Mode A  → true  (always require approval)
 *   - Mode B  → future: scope-aware; stub returns true (safe default)
 *   - Mode C  → future: false (fully autonomous)
 *
 * Callers MUST NOT inspect `trustMode` directly. They ask this helper.
 *
 * @param {string} projectRoot
 * @param {{ scope?: string }} [_opts] - Reserved for Mode B scope resolution.
 * @returns {boolean}
 */
function requireApproval(projectRoot, _opts) {
  const { mode } = getTrustMode(projectRoot);
  // MVP: every non-C mode is approval-required. Since mode is always 'A' today,
  // this always returns true. The shape of the conditional is kept to make the
  // future B/C activation a one-liner edit.
  if (mode === 'C') return false;
  return true;
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  // Public API
  getTrustMode,
  setTrustMode,
  requireApproval,
  isValidMode,
  // Constants (read-only — frozen arrays)
  VALID_MODES,
  DEFAULT_MODE,
  WARN_CODE,
  // Test hooks (underscore-prefixed; not part of the stable API)
  _resetWarnOnceForTests,
};
