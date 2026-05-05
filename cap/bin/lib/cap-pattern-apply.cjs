// @cap-context CAP F-074 Enable Pattern Unlearn and Auto-Retract — closes the V5 self-learning loop.
//                 Applies F-071 patterns to running CAP behaviour, audits each apply, watches the
//                 post-apply fitness for 5 sessions, auto-flags patches whose Layer-1 override-rate
//                 worsens, and offers a clean unlearn path. F-073 (the review board, not yet built)
//                 will consume the retract list and trigger the unlearn from one click. This module
//                 ONLY exposes the list and the apply/unlearn primitives — it does NOT implement
//                 F-073's UI nor wire F-071 to read applied-state.json (both follow-ups, captured in
//                 @cap-todo tags below).
// @cap-decision(F-074/D1) Apply state location — Centralized `.cap/learning/applied-state.json` for
//                 L1 (parameters) and L2 (rules). L3 (prompt-template patches) makes real edits to
//                 agents/cap-*.md / commands/cap/*.md files; the originalText snapshot is stored
//                 inside the apply audit record at `.cap/learning/applied/P-NNN.json` so unlearn
//                 can reverse it deterministically. Locked by user direction.
// @cap-decision(F-074/D2) Apply consumers — `applied-state.json` is read by F-071 (parameter
//                 overrides like the heuristic threshold) and the eventual L2 rule consumer when a
//                 candidate matches an applied rule (suppress promotion). F-074 only WRITES the
//                 file; the consumer-side wiring is a follow-up captured in @cap-todo. The contract
//                 is documented at the top of readAppliedState() so a future PR can implement the
//                 read side without re-deriving the schema.
// @cap-decision(F-074/D3) Git commit safety — Stage ONLY CAP-managed files (.cap/learning/applied/...,
//                 applied-state.json, plus L3-edited agents/cap-*.md / commands/cap/*.md). Never
//                 `git add .` or `-A`. Run a normal `git commit` (NOT `--no-verify`) so user
//                 pre-commit hooks fire. On hook failure: write the audit record with
//                 applyState:'pending', leave staged files staged, return an error to the caller.
//                 The user can resolve manually (fix lint, re-commit) or call applyPattern again
//                 with `--retry` to retry the commit. CLAUDE.md forbids --no-verify and we honour it.
// @cap-decision(F-074/D4) L3 reverse-patch strategy — At apply time, store
//                 `{ originalText, patchedText, targetFile }` inside the audit record. At unlearn
//                 time, read the file's current content; if it === patchedText (no intermediate
//                 edits), restore originalText. If the file has drifted (current content !=
//                 patchedText), refuse with `{ unlearned: false, reason: 'l3-drift', commitHashToRevert }`
//                 so the user can `git revert` manually. Do NOT silently overwrite drifted L3 files.
// @cap-decision(F-074/D5) 5-session post-apply check (AC-5) — runs cold-path inside
//                 `runRetractCheck(projectRoot)`. For each applied pattern: count distinct override
//                 sessionIds since the apply commit (from F-070 corpus). When the post-apply session
//                 count crosses 5, compare current Layer-1 override-rate to fitnessSnapshot.layer1.value.
//                 If worse (current > snapshot for override-rate, since more overrides = pattern hurting
//                 more), append to retract-recommendations.jsonl. The .jsonl file is the single source
//                 of truth — `listRetractRecommended` reads it and de-dups by patternId (most-recent wins).
// @cap-decision(F-074/D6) Idempotency proof for AC-7 — Read `.cap/learning/unlearned/P-NNN.json` first.
//                 If exists → return early with `{ unlearned: false, reason: 'already-unlearned', priorRecord }`.
//                 No git operation, no second write. The unlearned-record-existence is the lock; we never
//                 rely on git history to detect a prior unlearn (would be brittle across rebases).
// @cap-decision(F-074/D7) Pending-apply retry semantics — When a commit fails (pre-commit hook
//                 non-zero exit), the apply audit is written with applyState:'pending' and
//                 commitHash:null, but the L3 file edit + applied-state mutation ARE persisted (the
//                 staged changes remain). On a `--retry` call, applyPattern detects the existing
//                 'pending' audit, attempts only the commit step (re-stage + commit), and on success
//                 promotes the audit to applyState:'committed'. Without --retry, a second
//                 applyPattern call returns `{ applied: false, reason: 'already-applied' }` so a user
//                 cannot accidentally double-apply. PIN-1 below tracks this — the user should
//                 confirm the retry semantics before merge.
// @cap-constraint Zero external dependencies: node:fs + node:path + node:child_process (for git)
//                 only. We re-use cap-pattern-pipeline (listPatterns, getPattern), cap-fitness-score
//                 (recordApplySnapshot, getFitness), cap-learning-signals (getSignals). We never read
//                 overrides.jsonl / fitness JSONs / pattern JSONs directly — always through the
//                 module APIs.
// @cap-risk(F-074/AC-2) Every git invocation in this file carries this tag. A misfire (e.g. an
//                 accidental `git add .` or a commit that picks up unrelated files) would dirty the
//                 user's repo. The internal helper `gitStageAndCommit` is THE choke point — every
//                 path routes through it. Tests assert the staged file list is exactly what we asked
//                 for, never more.
// @cap-risk(F-074/AC-7) Idempotency guard at the top of unlearnPattern. A regression that fails to
//                 read .cap/learning/unlearned/<P-NNN>.json before mutating state would cause double
//                 commits. The adversarial test pins this with a count-of-commits assertion.

'use strict';

// @cap-feature(feature:F-074, primary:true) Enable Pattern Unlearn and Auto-Retract — apply audit,
//                                            git-commit-per-apply, 5-session retract check,
//                                            L1/L2/L3 reverse-patch with drift detection, idempotency.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const patternPipeline = require('./cap-pattern-pipeline.cjs');
const fitnessScore = require('./cap-fitness-score.cjs');
const learningSignals = require('./cap-learning-signals.cjs');

// -----------------------------------------------------------------------------
// Constants — top-of-file so consumers (F-073, /cap:learn) and tests reference
//             exactly one place. Mirrors cap-fitness-score.cjs / cap-pattern-pipeline.cjs.
// -----------------------------------------------------------------------------

const CAP_DIR = '.cap';
const LEARNING_DIR = 'learning';
const APPLIED_DIR = 'applied';
const UNLEARNED_DIR = 'unlearned';
const APPLIED_STATE_FILE = 'applied-state.json';
const RETRACT_RECOMMENDATIONS_FILE = 'retract-recommendations.jsonl';

// AC-5: how many distinct override-corpus sessions must elapse between apply and the retract
// check before we trust the post-apply Layer-1 comparison. Centralised so tests can flex it via
// runRetractCheck options.window without redefining the rule.
const RETRACT_SESSION_THRESHOLD = 5;

// Pattern-id format mirror — duplicated here for the regex; canonical allocator lives in
// cap-pattern-pipeline.cjs.
const PATTERN_ID_RE = /^P-\d+$/;

// applied-state.json schema version — bump when the shape changes so a stale consumer can refuse
// to read newer state instead of mis-parsing it.
const APPLIED_STATE_VERSION = 1;

// L3-target whitelist — only files under these prefixes can be L3 patch targets. CLAUDE.md scopes
// CAP-managed L3 patches to agents/cap-*.md and commands/cap/*.md; we enforce that here so a
// hostile or buggy pattern cannot rewrite arbitrary user files.
// @cap-risk(F-074/AC-2) The L3 prefix gate is THE only thing standing between an attacker-crafted
//                       pattern and arbitrary file rewrites. Every L3 apply path routes through
//                       isAllowedL3Target(); the adversarial test verifies a pattern targeting
//                       `package.json` is rejected.
const L3_TARGET_PREFIXES = ['agents/', 'commands/cap/'];

/**
 * @typedef {Object} AppliedAuditRecord
 * @property {string} id - Mirrors patternId for back-compat with the F-071/F-072 record shape.
 * @property {string} patternId - 'P-NNN'.
 * @property {string} appliedAt - ISO timestamp.
 * @property {'committed'|'pending'} applyState - 'pending' when the git commit failed (hook non-zero).
 * @property {'L1'|'L2'|'L3'} level
 * @property {string|null} featureRef - Feature ID this pattern targets, e.g. 'F-070'.
 * @property {string|null} commitHash - Abbrev SHA of the apply commit; null when applyState='pending'.
 * @property {string[]} targetFiles - Relative paths from projectRoot (the files we staged + committed).
 * @property {object|null} fitnessSnapshot - The FitnessRecord captured at apply-time (F-072 SnapshotRecord).
 * @property {object} beforeAfterDiff - Level-specific shape: L1 {key, from, to}; L2 {rule}; L3 {file, originalText, patchedText}.
 */

/**
 * @typedef {Object} UnlearnedAuditRecord
 * @property {string} id
 * @property {string} patternId
 * @property {string} unlearnedAt - ISO timestamp.
 * @property {'manual'|'auto-retract'} reason
 * @property {string|null} commitHash - SHA of the unlearn commit; null on git failure.
 * @property {string|null} appliedCommitHash - SHA of the prior apply commit, for traceability.
 */

/**
 * @typedef {Object} AppliedState
 * @property {number} version
 * @property {Object<string, *>} l1 - Parameter overrides keyed by `{F-NNN}/{KEY}` strings.
 * @property {Array<{patternId:string, rule:object, appliedAt:string}>} l2
 * @property {Array<{patternId:string, file:string, appliedAt:string}>} l3
 */

// -----------------------------------------------------------------------------
// Internal helpers — directory + IO
// -----------------------------------------------------------------------------

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {
    // Public boundary callers swallow; the next write surfaces persistent IO problems.
  }
}

function learningRoot(projectRoot) {
  return path.join(projectRoot, CAP_DIR, LEARNING_DIR);
}

function appliedDir(projectRoot) {
  return path.join(learningRoot(projectRoot), APPLIED_DIR);
}

function unlearnedDir(projectRoot) {
  return path.join(learningRoot(projectRoot), UNLEARNED_DIR);
}

function appliedStateFilePath(projectRoot) {
  return path.join(learningRoot(projectRoot), APPLIED_STATE_FILE);
}

function retractRecommendationsPath(projectRoot) {
  return path.join(learningRoot(projectRoot), RETRACT_RECOMMENDATIONS_FILE);
}

function appliedAuditPath(projectRoot, patternId) {
  return path.join(appliedDir(projectRoot), `${patternId}.json`);
}

function unlearnedAuditPath(projectRoot, patternId) {
  return path.join(unlearnedDir(projectRoot), `${patternId}.json`);
}

/**
 * Validate a P-NNN id. Every public boundary routes through this gate so a hostile or
 * malformed id can never become a path. Mirrors cap-fitness-score.cjs#isValidPatternId.
 * @param {any} id
 * @returns {boolean}
 */
function isValidPatternId(id) {
  return typeof id === 'string' && PATTERN_ID_RE.test(id);
}

/**
 * Look up the persisted PatternRecord with the given id. Returns null when missing or
 * unreadable. Never throws.
 * @param {string} projectRoot
 * @param {string} patternId
 * @returns {object|null}
 */
function findPattern(projectRoot, patternId) {
  try {
    const all = patternPipeline.listPatterns(projectRoot);
    if (!Array.isArray(all)) return null;
    for (const p of all) {
      if (p && p.id === patternId) return p;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

/**
 * Read a JSON file or return null. Never throws.
 * @param {string} fp
 * @returns {object|null}
 */
function readJson(fp) {
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_e) {
    return null;
  }
}

/**
 * Write a JSON file with trailing newline. Returns true on success.
 * @param {string} fp
 * @param {object} data
 * @returns {boolean}
 */
// @cap-decision(F-074/D8) Atomic write-temp-then-rename for ALL JSON writes in this module.
//                 applied-state.json, applied/<P>.json, unlearned/<P>.json — interruption between
//                 truncate and flush (Ctrl-C, OOM, hardware fault) would otherwise leave a zero-byte
//                 or partial-JSON file. The next read would return null, F-071 would silently revert
//                 every prior L1/L2 override. POSIX rename(2) is atomic; NTFS rename is good-enough.
//                 Fixed pre-ship per Stage-2 review.
function writeJson(fp, data) {
  try {
    ensureDir(path.dirname(fp));
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, fp);
    return true;
  } catch (_e) {
    // Best-effort cleanup — leave no .tmp orphan on failure.
    try { fs.unlinkSync(fp + '.tmp'); } catch (_e2) { /* ignore */ }
    return false;
  }
}

/**
 * Read the SESSION.json sessionId, if any. Used to attribute apply/unlearn audit records
 * to a session. Falls back to null silently. Never throws.
 * @param {string} projectRoot
 * @returns {string|null}
 */
function currentSessionId(projectRoot) {
  try {
    const fp = path.join(projectRoot, CAP_DIR, 'SESSION.json');
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
      return parsed.sessionId;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Git helpers — single choke point so the safety contract (D3) lives in ONE place.
// -----------------------------------------------------------------------------

/**
 * Run a git command in the project root. Returns { stdout, stderr, status }.
 * Never throws — callers inspect status for failure.
 * @param {string} projectRoot
 * @param {string[]} args
 * @returns {{stdout:string, stderr:string, status:number|null}}
 */
function git(projectRoot, args) {
  // @cap-risk(F-074/AC-2) Every git command in this file routes through here. We use spawnSync
  //                       (not execSync) so an untrusted argv is passed as an array — no shell
  //                       interpolation, no opportunity for `; rm -rf` injection through a
  //                       hostile pattern field.
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    // Inherit user env so global git config (user.name/user.email) and pre-commit-hook PATH work.
    env: process.env,
  });
  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    status: typeof result.status === 'number' ? result.status : null,
  };
}

/**
 * Stage SPECIFIC files and run a normal `git commit`. CLAUDE.md forbids `--no-verify`; user
 * pre-commit hooks must fire. Returns the commit hash on success or an error reason on failure.
 *
 * @cap-risk(F-074/AC-2) `files` is the closed set we stage. Callers MUST pass exact paths;
 *                       passing a directory or a glob would silently expand to a wider stage.
 *                       The internal `git add --` ensures the args after `--` are treated as
 *                       file paths even when one starts with `-`.
 *
 * @cap-decision(F-074/D3) On hook failure (status !== 0 from `git commit`), we DO NOT unstage.
 *                       The user fixes the hook issue manually (lint, format) and either
 *                       re-runs `git commit` themselves or invokes applyPattern with `--retry`.
 *                       Unstaging would silently lose the L3 file edit + the audit record write.
 *
 * @param {string} projectRoot
 * @param {string[]} files - Relative paths from projectRoot. NEVER use '.' or '-A'.
 * @param {string} message - Commit message; passed verbatim to `git commit -m`.
 * @returns {{success:boolean, commitHash?:string, error?:string, stage?:string}}
 *   stage: 'add' | 'commit' — which step failed.
 */
function gitStageAndCommit(projectRoot, files, message) {
  // Defensive — refuse to operate on a non-list or empty list. A bug that calls with [] would
  // otherwise produce an empty `git add --` (no-op) followed by `git commit` of whatever was
  // already staged, leaking state across calls.
  if (!Array.isArray(files) || files.length === 0) {
    return { success: false, error: 'no files to stage', stage: 'add' };
  }
  for (const f of files) {
    if (typeof f !== 'string' || f.length === 0) {
      return { success: false, error: 'invalid file path in stage list', stage: 'add' };
    }
    // Refuse the wildcard catch-alls explicitly. CLAUDE.md forbids them.
    if (f === '.' || f === '-A' || f === '-a' || f === '*') {
      return { success: false, error: `wildcard stage refused: ${f}`, stage: 'add' };
    }
    // @cap-decision(F-074/D9) Path-traversal defense-in-depth. Git's pathspec resolution
    //                 already refuses paths outside the repo, but the retry path consumes the
    //                 on-disk audit's targetFiles verbatim — a forged audit could pass an
    //                 absolute path or a `..`-climb string. Refuse at the F-074 boundary
    //                 instead of relying on git's behaviour.
    if (path.isAbsolute(f) || f.startsWith('../') || f.includes('/../') || f === '..') {
      return { success: false, error: `path-traversal refused: ${f}`, stage: 'add' };
    }
    const normalized = path.posix.normalize(f.replace(/\\/g, '/'));
    if (normalized.startsWith('../') || normalized === '..') {
      return { success: false, error: `path-traversal refused (post-normalize): ${f}`, stage: 'add' };
    }
  }

  // Stage the closed set. The `--` sentinel ensures every subsequent token is a path even if
  // one starts with `-`.
  const addArgs = ['add', '--', ...files];
  const addResult = git(projectRoot, addArgs);
  if (addResult.status !== 0) {
    return {
      success: false,
      error: `git add failed: ${addResult.stderr.trim() || `status ${addResult.status}`}`,
      stage: 'add',
    };
  }

  // @cap-risk(F-074/AC-2) Plain `git commit` — pre-commit hooks WILL fire. CLAUDE.md forbids
  //                       --no-verify; we honour it. On hook failure the staged files remain
  //                       staged so the user can resolve manually.
  // @cap-decision(F-074/D3) Pass the message via -m as a single argv (no shell interpolation).
  //                       Multi-line messages are flattened by callers; we don't need a HEREDOC
  //                       in this codepath.
  const commitArgs = ['commit', '-m', message];
  const commitResult = git(projectRoot, commitArgs);
  if (commitResult.status !== 0) {
    return {
      success: false,
      error: `git commit failed: ${commitResult.stderr.trim() || commitResult.stdout.trim() || `status ${commitResult.status}`}`,
      stage: 'commit',
    };
  }

  // Read the abbreviated SHA of the new HEAD. Using --short for stable abbrev length and
  // `-1` so we get exactly the commit we just created.
  const sha = git(projectRoot, ['rev-parse', '--short', 'HEAD']);
  if (sha.status !== 0) {
    // Commit succeeded but we couldn't read the hash — degrade gracefully with null hash so
    // the audit record still lands; the user can recover the SHA from `git log` manually.
    return { success: true, commitHash: null };
  }
  return { success: true, commitHash: sha.stdout.trim() };
}

// -----------------------------------------------------------------------------
// L3 target whitelist
// -----------------------------------------------------------------------------

/**
 * Return true iff the relative path is allowed as an L3 patch target. CLAUDE.md scopes L3
 * to agents/ and commands/cap/ — patterns targeting anything else are rejected.
 *
 * @cap-risk(F-074/AC-2) THE prefix gate. A regression here would let a hostile pattern rewrite
 *                       arbitrary repo files. Adversarial test verifies a pattern targeting
 *                       `package.json` (or `../etc/passwd`) is rejected.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
function isAllowedL3Target(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  // Reject path-traversal explicitly. A path like `agents/../../../etc/passwd` would otherwise
  // pass the prefix check; we use path.normalize and refuse anything that climbs out.
  const normalized = path.posix.normalize(relPath.replace(/\\/g, '/'));
  if (normalized.startsWith('..') || normalized.startsWith('/')) return false;
  for (const prefix of L3_TARGET_PREFIXES) {
    // @cap-decision(F-074/D10) Require a non-empty segment after the prefix. A bare `agents/` or
    //                  `commands/cap/` (no filename) would otherwise pass; the file read would
    //                  then catch EISDIR, but it's cleaner to refuse at the gate.
    if (normalized.startsWith(prefix) && normalized.length > prefix.length) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// applied-state.json read/write
// -----------------------------------------------------------------------------

/**
 * Read the centralised applied-state file. Returns the default empty state when the file is
 * missing or malformed. Never throws.
 *
 * @cap-decision(F-074/D2) F-071 / future L2 consumer reads this file to honour applied
 *                         parameters / rules. F-074 only writes it; the consumer wiring is a
 *                         follow-up captured in @cap-todo. Schema:
 *                         {
 *                           version: 1,
 *                           l1: { '<featureId>/<KEY>': value, ... },
 *                           l2: [ { patternId, rule, appliedAt }, ... ],
 *                           l3: [ { patternId, file, appliedAt }, ... ]
 *                         }
 *
 * @cap-todo(ac:F-074/AC-1) F-071 (cap-pattern-pipeline) shall read appliedState.l1[`F-071/THRESHOLD_OVERRIDE_COUNT`]
 *                          and use it as the override-threshold override before falling back to the
 *                          THRESHOLD_OVERRIDE_COUNT constant. This wiring is OUT OF SCOPE for F-074;
 *                          a follow-up PR will add it without changing F-074's API.
 *
 * @param {string} projectRoot
 * @returns {AppliedState}
 */
function readAppliedState(projectRoot) {
  const fp = appliedStateFilePath(projectRoot);
  const parsed = readJson(fp);
  if (!parsed) {
    return { version: APPLIED_STATE_VERSION, l1: {}, l2: [], l3: [] };
  }
  // Defensive shape normalisation — a hand-edited file with a missing field shouldn't crash callers.
  return {
    version: typeof parsed.version === 'number' ? parsed.version : APPLIED_STATE_VERSION,
    l1: (parsed.l1 && typeof parsed.l1 === 'object' && !Array.isArray(parsed.l1)) ? parsed.l1 : {},
    l2: Array.isArray(parsed.l2) ? parsed.l2 : [],
    l3: Array.isArray(parsed.l3) ? parsed.l3 : [],
  };
}

/**
 * Write the centralised applied-state file. Returns true on success. Test helper +
 * called internally by applyPattern / unlearnPattern.
 * @param {string} projectRoot
 * @param {AppliedState} state
 * @returns {boolean}
 */
function writeAppliedState(projectRoot, state) {
  if (!state || typeof state !== 'object') return false;
  ensureDir(learningRoot(projectRoot));
  return writeJson(appliedStateFilePath(projectRoot), {
    version: typeof state.version === 'number' ? state.version : APPLIED_STATE_VERSION,
    l1: (state.l1 && typeof state.l1 === 'object' && !Array.isArray(state.l1)) ? state.l1 : {},
    l2: Array.isArray(state.l2) ? state.l2 : [],
    l3: Array.isArray(state.l3) ? state.l3 : [],
  });
}

// -----------------------------------------------------------------------------
// Level-specific apply/reverse helpers
// -----------------------------------------------------------------------------

/**
 * Apply an L1 (parameter) pattern. Mutates the in-memory state and persists it. Returns
 * the beforeAfterDiff that lands in the audit record.
 * @param {AppliedState} state
 * @param {object} pattern
 * @returns {{key:string, from:any, to:any}}
 */
function applyL1(state, pattern) {
  const sug = pattern && pattern.suggestion;
  // F-071's L1 suggestion shape: { kind: 'L1', target: '<featureId>/<KEY>', from: <prior>, to: <new>, rationale }.
  const key = (sug && typeof sug.target === 'string') ? sug.target : `${pattern.id}/value`;
  // @cap-decision(F-074/D1) Record whether the key was already set in applied-state. On unlearn we
  //                         restore the prior value if `hadPrior` is true, otherwise we delete the
  //                         key so the post-unlearn state shape matches pre-apply byte-for-byte.
  //                         Recording the boolean explicitly avoids the "null is a real value vs.
  //                         null means unset" ambiguity that bit me on the first iteration.
  const hadPrior = Object.prototype.hasOwnProperty.call(state.l1, key);
  const from = hadPrior ? state.l1[key] : null;
  const to = sug && Object.prototype.hasOwnProperty.call(sug, 'to') ? sug.to : null;
  state.l1[key] = to;
  return { key, hadPrior, from, to };
}

/**
 * Reverse an L1 apply. The audit's diff carries `{ key, hadPrior, from, to }`; if hadPrior we
 * restore `from`, else we delete the key. Falls back to the legacy 2026-05 shape (no hadPrior
 * field) by treating `from === null` as "unset" — keeps a future schema migration painless.
 * @param {AppliedState} state
 * @param {{key:string, hadPrior?:boolean, from:any, to:any}} diff
 */
function reverseL1(state, diff) {
  if (!diff || typeof diff.key !== 'string') return;
  // Strict path: hadPrior is the authoritative signal.
  if (diff.hadPrior === true) {
    state.l1[diff.key] = diff.from;
    return;
  }
  if (diff.hadPrior === false) {
    delete state.l1[diff.key];
    return;
  }
  // Legacy path (no hadPrior recorded): treat null/undefined `from` as "unset".
  if (diff.from === null || diff.from === undefined) {
    delete state.l1[diff.key];
    return;
  }
  state.l1[diff.key] = diff.from;
}

/**
 * Apply an L2 (rule) pattern. Append the rule object to state.l2 with the patternId and ts.
 * @param {AppliedState} state
 * @param {object} pattern
 * @param {string} appliedAt
 * @returns {{rule:object}}
 */
function applyL2(state, pattern, appliedAt) {
  const rule = (pattern && pattern.suggestion) || { kind: 'L2' };
  state.l2.push({ patternId: pattern.id, rule, appliedAt });
  return { rule };
}

/**
 * Reverse an L2 apply. Remove every entry whose patternId matches.
 * @param {AppliedState} state
 * @param {string} patternId
 */
function reverseL2(state, patternId) {
  state.l2 = state.l2.filter((entry) => entry && entry.patternId !== patternId);
}

/**
 * Apply an L3 (prompt-template patch) pattern. Reads the target file, snapshots originalText,
 * writes patchedText, returns the diff for the audit record.
 *
 * @cap-decision(F-074/D4) We capture BOTH original and patched text in the audit; unlearn uses
 *                         the comparison `currentContent === patchedText` to detect drift. If the
 *                         file has been edited between apply and unlearn, we refuse to revert.
 *
 * @param {string} projectRoot
 * @param {object} pattern
 * @returns {{file:string, originalText:string, patchedText:string}|{error:string}}
 */
function applyL3(projectRoot, pattern) {
  const sug = pattern && pattern.suggestion;
  if (!sug || typeof sug !== 'object') {
    return { error: 'l3-suggestion-missing' };
  }
  const file = typeof sug.file === 'string' ? sug.file : (typeof sug.target === 'string' ? sug.target : null);
  if (!file) return { error: 'l3-target-missing' };
  if (!isAllowedL3Target(file)) return { error: 'l3-target-not-allowed' };

  const abs = path.join(projectRoot, file);
  let originalText;
  try {
    if (!fs.existsSync(abs)) return { error: 'l3-target-missing' };
    originalText = fs.readFileSync(abs, 'utf8');
  } catch (_e) {
    return { error: 'l3-read-failed' };
  }

  // The patched text is supplied by the pattern. F-071's LLM-stage L3 suggestion shape carries
  // either `patchedText` (full replacement) or `patch` (a future diff format we don't support
  // yet). Strict path: require patchedText for now; reject otherwise so we don't half-apply.
  const patchedText = typeof sug.patchedText === 'string' ? sug.patchedText : null;
  if (patchedText === null) return { error: 'l3-patched-text-missing' };

  try {
    fs.writeFileSync(abs, patchedText, 'utf8');
  } catch (_e) {
    return { error: 'l3-write-failed' };
  }

  return { file, originalText, patchedText };
}

/**
 * Reverse an L3 apply. Reads the current file content, asserts it === patchedText, then
 * restores originalText. If drift is detected (current !== patchedText), refuses.
 *
 * @cap-decision(F-074/D4) Drift detection is byte-exact equality. A trailing-newline change or a
 *                         CRLF↔LF flip will trigger drift; that's intentional — we'd rather refuse
 *                         and let the user resolve via `git revert <apply-hash>` than silently
 *                         clobber a downstream edit.
 *
 * @param {string} projectRoot
 * @param {{file:string, originalText:string, patchedText:string}} diff
 * @returns {{success:true, file:string} | {success:false, reason:'l3-drift'|'l3-target-missing'|'l3-read-failed'|'l3-write-failed'|'l3-target-not-allowed'}}
 */
function reverseL3(projectRoot, diff) {
  if (!diff || typeof diff.file !== 'string') {
    return { success: false, reason: 'l3-target-missing' };
  }
  if (!isAllowedL3Target(diff.file)) {
    // Defensive: a malformed audit could carry an out-of-scope file. Refuse rather than write.
    return { success: false, reason: 'l3-target-not-allowed' };
  }
  const abs = path.join(projectRoot, diff.file);
  let current;
  try {
    if (!fs.existsSync(abs)) return { success: false, reason: 'l3-target-missing' };
    current = fs.readFileSync(abs, 'utf8');
  } catch (_e) {
    return { success: false, reason: 'l3-read-failed' };
  }
  if (current !== diff.patchedText) {
    return { success: false, reason: 'l3-drift' };
  }
  try {
    fs.writeFileSync(abs, diff.originalText, 'utf8');
  } catch (_e) {
    return { success: false, reason: 'l3-write-failed' };
  }
  return { success: true, file: diff.file };
}

// -----------------------------------------------------------------------------
// Public API — applyPattern (AC-1, AC-2)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-074/AC-1) Audit record per apply at .cap/learning/applied/P-NNN.json with
//                          {patternId, appliedAt, level, targetFiles, featureRef, fitnessSnapshot,
//                          beforeAfterDiff?, applyState}.
// @cap-todo(ac:F-074/AC-2) Each apply creates `learn: apply P-NNN (F-XXX)` git commit.
/**
 * Apply a pattern: write the audit record, mutate applied-state.json (or the L3 file), capture
 * a fitness snapshot, and create a git commit. Returns success or a structured failure reason.
 *
 * @cap-decision(F-074/D7) Already-applied detection routes through the audit-record-existence
 *                         check (NOT git history). When `options.retry === true` AND the existing
 *                         audit's applyState is 'pending', we retry only the commit step.
 *
 * @param {string} projectRoot
 * @param {string} patternId
 * @param {Object} [options]
 * @param {Date|string} [options.now] - Override the persisted timestamps (mostly for tests).
 * @param {boolean} [options.retry] - Retry a prior pending commit (do NOT re-mutate state).
 * @param {'manual'|'auto'} [options.trigger] - Audit flavour (default 'manual').
 * @returns {{applied:true, commitHash:string|null, audit:AppliedAuditRecord}
 *   | {applied:false, reason:'pattern-not-found'|'l3-target-missing'|'l3-target-not-allowed'|'l3-patched-text-missing'|'l3-suggestion-missing'|'l3-read-failed'|'l3-write-failed'|'pending-hook-fail'|'already-applied'|'invalid-pattern-id'|'invalid-project-root'|'unsupported-level', error?:string, audit?:AppliedAuditRecord}}
 */
function applyPattern(projectRoot, patternId, options) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return { applied: false, reason: 'invalid-project-root' };
  }
  if (!isValidPatternId(patternId)) {
    return { applied: false, reason: 'invalid-pattern-id' };
  }
  const opts = options || {};
  const retry = opts.retry === true;
  const nowIso = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();

  // Idempotency / retry gate — read the prior audit record (if any) BEFORE mutating state.
  // @cap-risk(F-074/AC-7) Without this gate, a second applyPattern call would double-apply and
  //                       create a duplicate commit. The audit-record-existence is the lock.
  const priorAudit = readJson(appliedAuditPath(projectRoot, patternId));
  if (priorAudit && !retry) {
    return { applied: false, reason: 'already-applied', audit: priorAudit };
  }
  if (priorAudit && retry && priorAudit.applyState !== 'pending') {
    // Retry on a committed audit is a no-op — nothing to retry.
    return { applied: false, reason: 'already-applied', audit: priorAudit };
  }

  const pattern = findPattern(projectRoot, patternId);
  if (!pattern) {
    return { applied: false, reason: 'pattern-not-found' };
  }

  // Retry path — skip the state-mutation step, just re-stage and re-commit using the existing audit.
  if (retry && priorAudit && priorAudit.applyState === 'pending') {
    return retryApplyCommit(projectRoot, priorAudit);
  }

  const level = pattern.level;
  if (level !== 'L1' && level !== 'L2' && level !== 'L3') {
    return { applied: false, reason: 'unsupported-level' };
  }

  // -- State mutation --
  const state = readAppliedState(projectRoot);
  let beforeAfterDiff;
  /** @type {string[]} */
  const targetFiles = [];

  if (level === 'L1') {
    const diff = applyL1(state, pattern);
    beforeAfterDiff = { L1: diff };
  } else if (level === 'L2') {
    const diff = applyL2(state, pattern, nowIso);
    beforeAfterDiff = { L2: diff };
  } else {
    // L3
    const diff = applyL3(projectRoot, pattern);
    if (diff.error) {
      // L3 apply failed before any state mutation — return the error reason verbatim.
      return { applied: false, reason: diff.error };
    }
    beforeAfterDiff = { L3: diff };
    state.l3.push({ patternId: pattern.id, file: diff.file, appliedAt: nowIso });
    targetFiles.push(diff.file);
  }

  // Persist applied-state.json for L1 / L2 / L3 (L3 also needs the rule entry).
  writeAppliedState(projectRoot, state);

  // -- Fitness snapshot --
  // F-072 takes the snapshot append-only into <P-NNN>.snapshots.jsonl and returns the SnapshotRecord.
  // We embed that record in the audit so the AC-5 retract check can compare without re-reading.
  let fitnessSnapshot = null;
  try {
    fitnessSnapshot = fitnessScore.recordApplySnapshot(projectRoot, patternId, { now: nowIso });
  } catch (_e) {
    fitnessSnapshot = null;
  }

  // -- Audit record --
  const featureRef = (typeof pattern.featureRef === 'string' && /^F-\d+$/.test(pattern.featureRef))
    ? pattern.featureRef
    : null;

  /** @type {AppliedAuditRecord} */
  const audit = {
    id: patternId,
    patternId,
    appliedAt: nowIso,
    applyState: 'pending', // upgraded to 'committed' once git commit succeeds
    level,
    featureRef,
    commitHash: null,
    targetFiles: [
      // Always include the audit + applied-state files; L3 adds the patched file too.
      path.posix.join(CAP_DIR, LEARNING_DIR, APPLIED_DIR, `${patternId}.json`),
      path.posix.join(CAP_DIR, LEARNING_DIR, APPLIED_STATE_FILE),
      ...targetFiles,
    ],
    fitnessSnapshot,
    beforeAfterDiff,
  };

  // Persist the audit BEFORE the commit so a hook failure leaves an applyState:'pending' record on disk.
  writeJson(appliedAuditPath(projectRoot, patternId), audit);

  // -- Git commit --
  // @cap-risk(F-074/AC-2) Commit message format is contractual — F-073 will parse it for the review board.
  //                       Format: `learn: apply P-NNN (F-XXX)` or `learn: apply P-NNN` when no featureRef.
  const commitMsg = featureRef
    ? `learn: apply ${patternId} (${featureRef})`
    : `learn: apply ${patternId}`;
  const commitResult = gitStageAndCommit(projectRoot, audit.targetFiles, commitMsg);

  if (!commitResult.success) {
    // Hook failed (or git itself failed). Audit stays at applyState:'pending'; staged files
    // remain staged for the user to resolve.
    return {
      applied: false,
      reason: 'pending-hook-fail',
      error: commitResult.error,
      audit,
    };
  }

  audit.applyState = 'committed';
  audit.commitHash = commitResult.commitHash;
  writeJson(appliedAuditPath(projectRoot, patternId), audit);

  return { applied: true, commitHash: commitResult.commitHash, audit };
}

/**
 * Retry the commit for a prior pending audit. The state was already mutated on the original
 * applyPattern call; we only re-stage + commit. On success, promote the audit to
 * applyState:'committed' and return.
 *
 * @cap-decision(F-074/D7) Retry skips state mutation. The L3 file is still patched on disk;
 *                         applied-state.json is still updated. The user fixed the hook issue
 *                         (e.g. lint), and the commit can now go through.
 *
 * @param {string} projectRoot
 * @param {AppliedAuditRecord} priorAudit
 * @returns {{applied:true, commitHash:string|null, audit:AppliedAuditRecord}|{applied:false, reason:'pending-hook-fail', error:string, audit:AppliedAuditRecord}}
 */
function retryApplyCommit(projectRoot, priorAudit) {
  const featureRef = priorAudit.featureRef;
  const commitMsg = featureRef
    ? `learn: apply ${priorAudit.patternId} (${featureRef})`
    : `learn: apply ${priorAudit.patternId}`;
  const commitResult = gitStageAndCommit(projectRoot, priorAudit.targetFiles, commitMsg);
  if (!commitResult.success) {
    return { applied: false, reason: 'pending-hook-fail', error: commitResult.error, audit: priorAudit };
  }
  const updated = { ...priorAudit, applyState: 'committed', commitHash: commitResult.commitHash };
  writeJson(appliedAuditPath(projectRoot, priorAudit.patternId), updated);
  return { applied: true, commitHash: commitResult.commitHash, audit: updated };
}

// -----------------------------------------------------------------------------
// Public API — unlearnPattern (AC-3, AC-4, AC-7)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-074/AC-3) /cap:learn unlearn <P-ID> generates a reverse patch, applies it,
//                          commits as `learn: unlearn P-NNN`.
// @cap-todo(ac:F-074/AC-4) Unlearn audit at .cap/learning/unlearned/P-NNN.json with
//                          {reason:'manual'|'auto-retract', ts, commitHash}.
// @cap-todo(ac:F-074/AC-7) Idempotency — second call on already-unlearned pattern is a no-op.
/**
 * Unlearn a pattern: reverse the apply, write the unlearn audit, create the unlearn commit.
 *
 * @cap-risk(F-074/AC-7) Idempotency guard at the top — read the unlearned audit BEFORE any state
 *                       mutation. A regression that skips this would double-commit.
 *
 * @param {string} projectRoot
 * @param {string} patternId
 * @param {Object} [options]
 * @param {'manual'|'auto-retract'} [options.reason] - Default 'manual'.
 * @param {Date|string} [options.now]
 * @returns {{unlearned:true, commitHash:string|null, audit:UnlearnedAuditRecord}
 *   | {unlearned:false, reason:'already-unlearned'|'l3-drift'|'apply-not-found'|'pending-hook-fail'|'invalid-pattern-id'|'invalid-project-root'|'l3-target-missing'|'l3-read-failed'|'l3-write-failed'|'l3-target-not-allowed', priorRecord?:UnlearnedAuditRecord, error?:string, commitHashToRevert?:string|null}}
 */
function unlearnPattern(projectRoot, patternId, options) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return { unlearned: false, reason: 'invalid-project-root' };
  }
  if (!isValidPatternId(patternId)) {
    return { unlearned: false, reason: 'invalid-pattern-id' };
  }
  const opts = options || {};
  const reason = opts.reason === 'auto-retract' ? 'auto-retract' : 'manual';
  const nowIso = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();

  // @cap-risk(F-074/AC-7) Idempotency gate — return early if the unlearn audit already exists.
  const priorUnlearned = readJson(unlearnedAuditPath(projectRoot, patternId));
  if (priorUnlearned) {
    return { unlearned: false, reason: 'already-unlearned', priorRecord: priorUnlearned };
  }

  // The apply audit must exist to unlearn against.
  const applyAudit = readJson(appliedAuditPath(projectRoot, patternId));
  if (!applyAudit) {
    return { unlearned: false, reason: 'apply-not-found' };
  }

  // Reverse the level-specific change.
  const state = readAppliedState(projectRoot);
  const level = applyAudit.level;
  /** @type {string[]} */
  const targetFiles = [
    path.posix.join(CAP_DIR, LEARNING_DIR, UNLEARNED_DIR, `${patternId}.json`),
    path.posix.join(CAP_DIR, LEARNING_DIR, APPLIED_STATE_FILE),
  ];

  if (level === 'L1') {
    const diff = applyAudit.beforeAfterDiff && applyAudit.beforeAfterDiff.L1;
    reverseL1(state, diff);
  } else if (level === 'L2') {
    reverseL2(state, patternId);
  } else if (level === 'L3') {
    const diff = applyAudit.beforeAfterDiff && applyAudit.beforeAfterDiff.L3;
    const result = reverseL3(projectRoot, diff);
    if (!result.success) {
      // L3 drift / read-failure / etc. — refuse without committing.
      // @cap-decision(F-074/D4) On l3-drift, surface the prior apply commit hash so the user can
      //                         `git revert <apply-hash>` manually. This is THE escape hatch.
      return {
        unlearned: false,
        reason: result.reason,
        commitHashToRevert: applyAudit.commitHash || null,
      };
    }
    // Remove the matching l3 entry from applied-state.
    state.l3 = state.l3.filter((entry) => entry && entry.patternId !== patternId);
    targetFiles.push(diff.file);
  } else {
    return { unlearned: false, reason: 'apply-not-found' };
  }

  writeAppliedState(projectRoot, state);

  // Persist the unlearn audit BEFORE the commit (mirror the apply path).
  /** @type {UnlearnedAuditRecord} */
  const audit = {
    id: patternId,
    patternId,
    unlearnedAt: nowIso,
    reason,
    commitHash: null,
    appliedCommitHash: applyAudit.commitHash || null,
  };
  writeJson(unlearnedAuditPath(projectRoot, patternId), audit);

  const commitMsg = `learn: unlearn ${patternId}`;
  const commitResult = gitStageAndCommit(projectRoot, targetFiles, commitMsg);
  if (!commitResult.success) {
    // Audit stays in place with commitHash:null. The user can resolve manually.
    return { unlearned: false, reason: 'pending-hook-fail', error: commitResult.error };
  }

  audit.commitHash = commitResult.commitHash;
  writeJson(unlearnedAuditPath(projectRoot, patternId), audit);

  return { unlearned: true, commitHash: commitResult.commitHash, audit };
}

// -----------------------------------------------------------------------------
// Public API — listAppliedPatterns / listUnlearnedPatterns
// -----------------------------------------------------------------------------

/**
 * Read every persisted apply audit. Tolerant to missing dir + malformed files.
 * @param {string} projectRoot
 * @returns {AppliedAuditRecord[]}
 */
function listAppliedPatterns(projectRoot) {
  const dir = appliedDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_e) {
    return [];
  }
  const out = [];
  for (const f of entries) {
    if (!/^P-\d+\.json$/.test(f)) continue;
    const parsed = readJson(path.join(dir, f));
    if (parsed) out.push(parsed);
  }
  // Sort by patternId ascending for deterministic output.
  out.sort((a, b) => {
    const ai = (a && a.patternId) || '';
    const bi = (b && b.patternId) || '';
    if (ai < bi) return -1;
    if (ai > bi) return 1;
    return 0;
  });
  return out;
}

/**
 * Read every persisted unlearn audit. Tolerant to missing dir + malformed files.
 * @param {string} projectRoot
 * @returns {UnlearnedAuditRecord[]}
 */
function listUnlearnedPatterns(projectRoot) {
  const dir = unlearnedDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_e) {
    return [];
  }
  const out = [];
  for (const f of entries) {
    if (!/^P-\d+\.json$/.test(f)) continue;
    const parsed = readJson(path.join(dir, f));
    if (parsed) out.push(parsed);
  }
  out.sort((a, b) => {
    const ai = (a && a.patternId) || '';
    const bi = (b && b.patternId) || '';
    if (ai < bi) return -1;
    if (ai > bi) return 1;
    return 0;
  });
  return out;
}

// -----------------------------------------------------------------------------
// Public API — listRetractRecommended (AC-5, F-073 hook point)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-074/AC-5) Read the retract list (.jsonl) and return de-duped pattern ids.
// @cap-todo(ac:F-074/AC-6) F-073 review board reads this list to label patterns "Rückzug empfohlen"
//                          and offer a one-click unlearn affordance. F-074 only EXPOSES the list;
//                          F-073 wires the UI. This is intentionally a follow-up.
/**
 * Read the retract-recommendations.jsonl and return the unique pattern ids most-recently
 * recommended for retraction. De-dup by patternId — most-recent line wins. Patterns that
 * have ALREADY been unlearned are filtered out (the recommendation is moot).
 *
 * @param {string} projectRoot
 * @returns {string[]} Sorted ascending for deterministic output.
 */
function listRetractRecommended(projectRoot) {
  const fp = retractRecommendationsPath(projectRoot);
  if (!fs.existsSync(fp)) return [];

  let raw;
  try {
    raw = fs.readFileSync(fp, 'utf8');
  } catch (_e) {
    return [];
  }

  // Most-recent-wins de-dup: walk the file in order, overwrite per-id.
  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object') continue;
      if (typeof parsed.patternId !== 'string' || !PATTERN_ID_RE.test(parsed.patternId)) continue;
      byId.set(parsed.patternId, parsed);
    } catch (_e) {
      // Skip malformed lines — never throw.
    }
  }

  // Filter out patterns that have been unlearned already.
  const unlearned = new Set(listUnlearnedPatterns(projectRoot).map((u) => u.patternId));
  const out = [];
  for (const id of byId.keys()) {
    if (!unlearned.has(id)) out.push(id);
  }
  out.sort();
  return out;
}

// -----------------------------------------------------------------------------
// Public API — runRetractCheck (AC-5)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-074/AC-5) 5-session post-apply check: for each applied pattern, count distinct
//                          override-corpus sessions since apply. If >=5 AND current Layer-1 override-rate
//                          is worse than fitnessSnapshot.layer1.value, append to retract-recommendations.jsonl.
/**
 * Walk every applied pattern; for each, count distinct override sessions since the apply timestamp.
 * When that count >= window AND the current Layer-1 override-count is worse than the snapshot's,
 * append a retract recommendation to .cap/learning/retract-recommendations.jsonl.
 *
 * @cap-decision(F-074/D5) "Worse" = currentLayer1.value > snapshotLayer1.value (more overrides =
 *                         pattern hurting more). When equal or better, no recommendation.
 *
 * @cap-decision(F-074/D5) "Sessions since apply" is computed from the F-070 override corpus —
 *                         distinct sessionIds whose ts > applyAuditAppliedAt. We do NOT use git
 *                         commit history (would couple us to git rebase semantics; brittle).
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {number} [options.window] - Override RETRACT_SESSION_THRESHOLD (mostly for tests).
 * @param {Date|string} [options.now] - Timestamp for the appended JSONL line (default Date.now()).
 * @returns {{checked:string[], recommended:string[], errors:string[]}}
 */
function runRetractCheck(projectRoot, options) {
  const opts = options || {};
  const window = typeof opts.window === 'number' && opts.window > 0 ? opts.window : RETRACT_SESSION_THRESHOLD;
  const nowIso = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();

  /** @type {string[]} */
  const checked = [];
  /** @type {string[]} */
  const recommended = [];
  /** @type {string[]} */
  const errors = [];

  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return { checked, recommended, errors: ['projectRoot is required'] };
  }

  // Read the override corpus ONCE — performance bound (100 patterns × 1000 signals < 500ms).
  let overrides = [];
  try {
    overrides = learningSignals.getSignals(projectRoot, 'override') || [];
  } catch (e) {
    errors.push(`getSignals(override) failed: ${e && e.message ? e.message : 'unknown'}`);
  }

  const applied = listAppliedPatterns(projectRoot);
  const unlearnedSet = new Set(listUnlearnedPatterns(projectRoot).map((u) => u.patternId));

  for (const audit of applied) {
    if (!audit || !isValidPatternId(audit.patternId)) continue;
    if (unlearnedSet.has(audit.patternId)) continue; // already retracted manually
    if (audit.applyState !== 'committed') continue; // pending applies aren't yet "live"

    checked.push(audit.patternId);

    // Count distinct override sessions whose ts > applyAuditAppliedAt.
    const since = audit.appliedAt;
    /** @type {Set<string>} */
    const sessionsSince = new Set();
    for (const r of overrides) {
      if (!r || typeof r.sessionId !== 'string' || r.sessionId.length === 0) continue;
      if (typeof r.ts !== 'string') continue;
      if (r.ts <= since) continue;
      sessionsSince.add(r.sessionId);
    }
    const sessionsSinceApply = sessionsSince.size;
    if (sessionsSinceApply < window) continue; // not enough data yet

    // Compare current Layer-1 to the apply-time snapshot. We re-compute current fitness via F-072
    // (single source of truth — never duplicate the formula).
    let current;
    try {
      current = fitnessScore.computeFitness(projectRoot, audit.patternId);
    } catch (e) {
      errors.push(`computeFitness threw for ${audit.patternId}: ${e && e.message ? e.message : 'unknown'}`);
      continue;
    }
    if (!current || !current.layer1) continue;

    const snapshotL1 = audit.fitnessSnapshot && audit.fitnessSnapshot.layer1
      ? Number(audit.fitnessSnapshot.layer1.value) || 0
      : 0;
    const currentL1 = Number(current.layer1.value) || 0;

    if (currentL1 > snapshotL1) {
      // @cap-risk(F-074/AC-2) Append-only JSONL — never overwrite. F-073 reads this file via
      //                       listRetractRecommended() which de-dups (most-recent-wins).
      const line = JSON.stringify({
        ts: nowIso,
        patternId: audit.patternId,
        sessionsSinceApply,
        snapshot: snapshotL1,
        current: currentL1,
        reason: 'override-rate-worse',
      }) + '\n';
      try {
        ensureDir(learningRoot(projectRoot));
        const fd = fs.openSync(retractRecommendationsPath(projectRoot), 'a');
        try {
          fs.writeSync(fd, line);
        } finally {
          fs.closeSync(fd);
        }
        recommended.push(audit.patternId);
      } catch (e) {
        errors.push(`append retract-recommendations failed for ${audit.patternId}: ${e && e.message ? e.message : 'unknown'}`);
      }
    }
  }

  return { checked, recommended, errors };
}

// -----------------------------------------------------------------------------
// Exports — keep this list minimal. F-073 / /cap:learn should consume only these.
// -----------------------------------------------------------------------------

module.exports = {
  // Constants — exported for tests + downstream consumers.
  CAP_DIR,
  LEARNING_DIR,
  APPLIED_DIR,
  UNLEARNED_DIR,
  APPLIED_STATE_FILE,
  RETRACT_RECOMMENDATIONS_FILE,
  RETRACT_SESSION_THRESHOLD,
  APPLIED_STATE_VERSION,
  L3_TARGET_PREFIXES,
  // Public API.
  applyPattern,
  unlearnPattern,
  listAppliedPatterns,
  listUnlearnedPatterns,
  listRetractRecommended,
  runRetractCheck,
  readAppliedState,
  writeAppliedState,
  // Path helpers — exported for tests.
  appliedDir,
  unlearnedDir,
  appliedStateFilePath,
  retractRecommendationsPath,
  appliedAuditPath,
  unlearnedAuditPath,
  // Helpers exposed for tests / introspection — keep this list small.
  isAllowedL3Target,
  gitStageAndCommit,
  currentSessionId,
};
