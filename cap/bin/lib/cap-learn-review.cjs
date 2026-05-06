// @cap-context CAP F-073 Review Patterns via Learn Command — final piece of the V5 self-learning
//                 loop. Consumes F-071 patterns, F-072 fitness/confidence, F-074 applied/unlearned/
//                 retract-recommended state, computes a per-session "pending review" set, renders a
//                 human-friendly board.md, and exposes skip/reject/archive helpers + a Stop-hook gate.
//                 PURE-COMPUTE + small persistence: writes board.md, skipped/rejected JSONs, archive
//                 files, and the board-pending.flag. Never spawns the LLM, never writes git commits.
//                 The /cap:learn review skill orchestrates apply/unlearn by delegating to F-074.
// @cap-decision(F-073/D1) Stop-Hook integration — a separate hook file, hooks/cap-learn-review-hook.js,
//                 fires AFTER cap-memory's Stop hook (memory pipeline → learn pipeline → review board).
//                 The hook only computes shouldShowBoard() and writes a tiny .cap/learning/board-pending.flag
//                 on positive gate; it NEVER spawns the skill (Claude Code hook subprocesses can't drive an
//                 interactive flow). Same fail-silent posture as cap-learning-hook.js: on any error the hook
//                 exits 0 so a session can never be blocked. Lib-resolution mirrors cap-learning-hook.js
//                 (env override → colocated → ~/.claude). Skip via CAP_SKIP_LEARN_REVIEW_HOOK=1.
// @cap-decision(F-073/D2) Review UX via Briefing-pattern — mirrors F-071's LLM Skill-Briefing. The skill
//                 renders board.md with all eligible patterns + per-pattern options + retract labels, then
//                 INSTRUCTS the outer agent to read board.md, decide approve/reject/skip/unlearn per
//                 pattern, and call cap-pattern-apply.applyPattern / unlearnPattern (or our skipPattern /
//                 rejectPattern helpers). The skill exit code follows the AC-7 contract: ANY apply that
//                 returns applied:false → non-zero exit. There is NO interactive CLI subprocess.
// @cap-decision(F-073/D3) Eligibility = persisted in .cap/learning/patterns/ AND not in applied/ AND not
//                 in unlearned/ AND not in archive/ AND not in this-session's skipped-<sid>.json AND not
//                 in this-session's rejected-<sid>.json. Skipping is per-SESSION only (not a persistent
//                 mute) — a new session re-shows the patterns. Rejection is also per-session (the user
//                 may want to reconsider next session); persistence beyond a session would require a
//                 separate "permanent rejected" store, which is out of scope for F-073.
// @cap-decision(F-073/D4) Threshold gate (AC-2) — board appears only when:
//                   (a) ≥ 1 high-confidence eligible pattern: layer2.ready=true AND layer2.value >= 0.75
//                       AND layer2.n >= 5 (the F-072 confidence threshold), OR
//                   (b) ≥ 3 eligible candidates of any kind (any level / source / fitness).
//                 Below the gate, the skill exits 0 silently with a "no review needed" log line. The
//                 hook uses the same gate so the .flag file is only written when the user would actually
//                 see something. "high-confidence" uses the fitness layer2 reading because Layer-2 is
//                 the "long-term per-session weighted average" that signals the pattern's territory has
//                 been trustably useful — a fresh n=2 candidate with layer2.ready=false is NOT high-
//                 confidence regardless of its layer2.value snapshot. The gate is computed from the
//                 ELIGIBLE set (D3), not the raw persisted set, so applied/unlearned patterns can never
//                 contribute to "≥3" double-counting once they've left review scope.
// @cap-decision(F-073/D5) Stale-archive (AC-5) — patterns un-reviewed for > 7 sessions auto-archive to
//                 .cap/learning/archive/<P-NNN>.json AND are removed from .cap/learning/patterns/. The
//                 "session count" comes from the F-070 signal corpus — count distinct sessionIds with
//                 ts >= pattern.createdAt across the union of override / memory-ref / regret signals.
//                 If the corpus has fewer than 7 distinct sessions total → NO archive (insufficient
//                 data — F-072's expiry rule uses the same insufficient-history short-circuit). We do
//                 NOT archive applied/unlearned patterns (they've already left review) and we do NOT
//                 archive patterns that were skipped/rejected this session (the skip/reject is the
//                 user's "still aware of it" signal). Archive is idempotent: re-running on an already-
//                 archived id is a no-op; missing-source-pattern → recorded as error, not a throw.
//                 F-072's unionSessionsByRecency is NOT exported, so we replicate the simple count
//                 here (count distinct sessionIds across the three corpora).
// @cap-decision(F-073/D6) Atomic write contract (mirrors F-074/D8) — every JSON / md write that's not
//                 a one-shot append-only flag goes through the writeAtomic helper: write to .tmp,
//                 fs.renameSync into place. POSIX rename(2) is atomic; an interrupted write leaves a
//                 .tmp orphan we clean up on the next attempt rather than a half-written board.md that
//                 the outer agent might process. The flag file is small and write-truncate is fine —
//                 a half-written flag is harmless because the .json content isn't parsed by the skill
//                 (presence is the signal).
// @cap-constraint Zero external dependencies: node:fs + node:path only. Always go through F-071/F-072/
//                 F-074 module APIs — never read pattern/fitness/applied JSONs directly. cap-session
//                 is read via a tiny inline helper (mirrors F-074's currentSessionId pattern); we
//                 don't take a hard dep on cap-session to keep the resolver-graph identical to F-074.
// @cap-risk(F-073/AC-7) The approve→applyPattern call site is a CRITICAL SURFACE. The skill must
//                 propagate applied:false to a non-zero exit code; a regression that swallows the
//                 result would silently apply nothing while reporting success. The skill orchestration
//                 lives in commands/cap/learn.md (Subcommand: review). This module exposes the inputs
//                 the skill needs to make that decision — it does NOT call applyPattern itself
//                 (separation of concerns: F-073 = compute + render + skip/reject/archive; F-074 =
//                 apply/unlearn). The board.md hand-off documents the contract so the outer agent
//                 reports back faithfully.
// @cap-risk(F-073/AC-2) The threshold gate is the only thing standing between a noisy first session
//                 (lots of low-confidence candidates) and a flood of useless review prompts. A
//                 regression that loosens the gate would burn the user's attention. Adversarial test
//                 pins the boundary cases (exactly 3 / exactly 2 / exactly 1 high-confidence).
// @cap-risk(F-073/AC-4) The skipped-<sid>.json file shape is per-session ONLY. A regression that
//                 wrote it as a global skip-mute would silently hide patterns indefinitely. Tests
//                 pin: same-session re-read excludes ids; new-session re-read shows them again.

'use strict';

// @cap-feature(feature:F-073, primary:true) Review Patterns via Learn Command — board renderer +
//                                            eligibility computation + skip/reject/archive helpers
//                                            + Stop-hook gate.

const fs = require('node:fs');
const path = require('node:path');

const patternPipeline = require('./cap-pattern-pipeline.cjs');
const fitnessScore = require('./cap-fitness-score.cjs');
const patternApply = require('./cap-pattern-apply.cjs');
const learningSignals = require('./cap-learning-signals.cjs');

// -----------------------------------------------------------------------------
// Constants — kept top-of-file so consumers (the /cap:learn review skill, the
// Stop-hook, tests) reference exactly one place. Mirrors layout of
// cap-pattern-apply.cjs and cap-fitness-score.cjs.
// -----------------------------------------------------------------------------

const CAP_DIR = '.cap';
const LEARNING_DIR = 'learning';
const PATTERNS_DIR = 'patterns';
const ARCHIVE_DIR = 'archive';
const BOARD_FILE = 'board.md';
const BOARD_PENDING_FLAG = 'board-pending.flag';

// AC-2 threshold knobs (D4). Centralised so a future tuning lives in ONE place;
// the adversarial test verifies exact behaviour.
const HIGH_CONFIDENCE_LAYER2_VALUE = 0.75;
const HIGH_CONFIDENCE_LAYER2_N = 5;
const ANY_KIND_THRESHOLD = 3;

// AC-5 stale-archive knob.
const STALE_SESSION_THRESHOLD = 7;

// Pattern-id format mirror.
const PATTERN_ID_RE = /^P-\d+$/;

// SessionId sanitisation guards (AC-7 / privacy).
// Mirrors cap-fitness-score's sessionId guards — the sessionId can flow into:
//   1. the skipped/rejected JSON's `sessionId` field (round-trips back to the
//      review board in the same session), and
//   2. the board-pending.flag's `sessionId` field.
// A hostile sessionId could otherwise smuggle markdown / JSON / control bytes
// into either file. We refuse anything outside the SESSION_ID_RE alphabet and
// truncate at SESSION_ID_MAX before persisting.
const SESSION_ID_MAX = 200;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * @typedef {Object} EligibleEntry
 * @property {string} patternId - 'P-NNN'.
 * @property {object|null} fitness - The full F-072 FitnessRecord, or null when missing.
 * @property {number} confidence - 0..1 derived from fitness (D4) for board display.
 * @property {string} triggerReason - Short description of WHY this pattern qualifies (e.g. 'override-cluster F-100', 'regret').
 * @property {boolean} retractRecommended - True iff F-074 listRetractRecommended() includes this id.
 * @property {string[]} options - The action options surfaced on the board ('Approve','Reject','Skip','Unlearn'?).
 * @property {object} pattern - The full PatternRecord (for the renderer; not persisted in the JSON shape).
 */

/**
 * @typedef {Object} ReviewBoard
 * @property {EligibleEntry[]} eligible
 * @property {{met: boolean, reason: string}} threshold
 * @property {string[]} archived - Pattern ids moved to archive/ THIS run.
 * @property {string[]} skippedThisSession - Pattern ids in the session's skipped file.
 * @property {string[]} rejectedThisSession - Pattern ids in the session's rejected file.
 * @property {string|null} sessionId - Session id used for skip/reject scoping.
 * @property {string} ts - ISO timestamp of board build.
 */

// -----------------------------------------------------------------------------
// Internal helpers — directory + IO
// -----------------------------------------------------------------------------

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {
    // Boundary callers swallow; the next write surfaces persistent IO problems.
  }
}

function learningRoot(projectRoot) {
  return path.join(projectRoot, CAP_DIR, LEARNING_DIR);
}

function patternsDir(projectRoot) {
  return path.join(learningRoot(projectRoot), PATTERNS_DIR);
}

function archiveDir(projectRoot) {
  return path.join(learningRoot(projectRoot), ARCHIVE_DIR);
}

function boardFilePath(projectRoot) {
  return path.join(learningRoot(projectRoot), BOARD_FILE);
}

function boardPendingFlagPath(projectRoot) {
  return path.join(learningRoot(projectRoot), BOARD_PENDING_FLAG);
}

function skippedFilePath(projectRoot, sessionId) {
  return path.join(learningRoot(projectRoot), `skipped-${sessionId}.json`);
}

function rejectedFilePath(projectRoot, sessionId) {
  return path.join(learningRoot(projectRoot), `rejected-${sessionId}.json`);
}

function archiveFilePath(projectRoot, patternId) {
  return path.join(archiveDir(projectRoot), `${patternId}.json`);
}

function patternFilePath(projectRoot, patternId) {
  return path.join(patternsDir(projectRoot), `${patternId}.json`);
}

/**
 * Validate a P-NNN id. Every public boundary routes through this gate.
 * @param {any} id
 * @returns {boolean}
 */
function isValidPatternId(id) {
  return typeof id === 'string' && PATTERN_ID_RE.test(id);
}

/**
 * Sanitise a sessionId. Returns null when the id is missing/invalid; otherwise
 * returns the (truncated) id verified against SESSION_ID_RE.
 * @cap-risk(F-073/AC-3) The sessionId flows into the .flag file's JSON body and
 *                       file paths. A hostile sessionId could otherwise inject
 *                       newlines / JSON-control / path-traversal segments.
 * @param {any} v
 * @returns {string|null}
 */
function sanitiseSessionId(v) {
  if (typeof v !== 'string' || v.length === 0) return null;
  const trimmed = v.length > SESSION_ID_MAX ? v.slice(0, SESSION_ID_MAX) : v;
  if (!SESSION_ID_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Read the SESSION.json sessionId, if any. Mirrors the F-074 helper exactly.
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
      return sanitiseSessionId(parsed.sessionId);
    }
    return null;
  } catch (_e) {
    return null;
  }
}

/**
 * Read a JSON file; return null on missing / malformed. Never throws.
 * @param {string} fp
 * @returns {any|null}
 */
function readJson(fp) {
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (_e) {
    return null;
  }
}

/**
 * Atomic write helper. Mirrors F-074/D8 pattern: write to .tmp, rename into place.
 * @param {string} fp
 * @param {string|Buffer} content
 * @returns {boolean}
 */
function writeAtomic(fp, content) {
  try {
    ensureDir(path.dirname(fp));
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, fp);
    return true;
  } catch (_e) {
    try { fs.unlinkSync(fp + '.tmp'); } catch (_e2) { /* ignore */ }
    return false;
  }
}

/**
 * Atomic write of a JSON file (with trailing newline).
 * @param {string} fp
 * @param {object} data
 * @returns {boolean}
 */
function writeAtomicJson(fp, data) {
  return writeAtomic(fp, JSON.stringify(data, null, 2) + '\n');
}

// -----------------------------------------------------------------------------
// Internal helpers — skip / reject persistence
// -----------------------------------------------------------------------------

/**
 * Load the skipped-<sid>.json content for the given sessionId. Returns the
 * patternIds array (de-duplicated).
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {string[]}
 */
function loadSkippedThisSession(projectRoot, sessionId) {
  const sid = sanitiseSessionId(sessionId);
  if (!sid) return [];
  const parsed = readJson(skippedFilePath(projectRoot, sid));
  if (!parsed || !Array.isArray(parsed.patternIds)) return [];
  const seen = new Set();
  const out = [];
  for (const id of parsed.patternIds) {
    if (isValidPatternId(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out.sort();
}

/**
 * Load the rejected-<sid>.json content for the given sessionId.
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {string[]}
 */
function loadRejectedThisSession(projectRoot, sessionId) {
  const sid = sanitiseSessionId(sessionId);
  if (!sid) return [];
  const parsed = readJson(rejectedFilePath(projectRoot, sid));
  if (!parsed || !Array.isArray(parsed.patternIds)) return [];
  const seen = new Set();
  const out = [];
  for (const id of parsed.patternIds) {
    if (isValidPatternId(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out.sort();
}

// -----------------------------------------------------------------------------
// Internal helpers — eligibility + presentation
// -----------------------------------------------------------------------------

/**
 * Compute the set of pattern ids eligible for review THIS session.
 * D3: persisted ∧ ¬applied ∧ ¬unlearned ∧ ¬archived ∧ ¬skipped ∧ ¬rejected.
 *
 * @param {string} projectRoot
 * @param {string|null} sessionId - When null, only persistent state filters apply.
 * @returns {{ ids: string[], skipped: string[], rejected: string[] }}
 */
function eligiblePatternIds(projectRoot, sessionId) {
  let patterns = [];
  try { patterns = patternPipeline.listPatterns(projectRoot) || []; } catch (_e) { patterns = []; }

  const applied = new Set((patternApply.listAppliedPatterns(projectRoot) || [])
    .map((a) => a && a.patternId).filter(isValidPatternId));
  const unlearned = new Set((patternApply.listUnlearnedPatterns(projectRoot) || [])
    .map((u) => u && u.patternId).filter(isValidPatternId));

  // Archived is a directory listing, not a module API.
  const archived = new Set();
  try {
    const dir = archiveDir(projectRoot);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!/^P-\d+\.json$/.test(f)) continue;
        archived.add(f.slice(0, -'.json'.length));
      }
    }
  } catch (_e) { /* ignore */ }

  const skipped = sessionId ? loadSkippedThisSession(projectRoot, sessionId) : [];
  const rejected = sessionId ? loadRejectedThisSession(projectRoot, sessionId) : [];
  const skippedSet = new Set(skipped);
  const rejectedSet = new Set(rejected);

  const ids = [];
  for (const p of patterns) {
    if (!p || !isValidPatternId(p.id)) continue;
    if (applied.has(p.id)) continue;
    if (unlearned.has(p.id)) continue;
    if (archived.has(p.id)) continue;
    if (skippedSet.has(p.id)) continue;
    if (rejectedSet.has(p.id)) continue;
    ids.push(p.id);
  }
  ids.sort();
  return { ids, skipped, rejected };
}

/**
 * Derive a short, human-readable trigger reason for the board entry. Mirrors
 * F-071's evidence shape: signalType + featureRef.
 * @param {object} pattern - PatternRecord.
 * @returns {string}
 */
function triggerReasonFor(pattern) {
  if (!pattern || typeof pattern !== 'object') return 'unknown';
  const ev = pattern.evidence || {};
  const sigType = (typeof ev.signalType === 'string' && ev.signalType.length > 0) ? ev.signalType : 'unknown-signal';
  const fid = (typeof pattern.featureRef === 'string' && /^F-\d+$/.test(pattern.featureRef))
    ? pattern.featureRef
    : null;
  const count = Number.isFinite(Number(ev.count)) ? Number(ev.count) : null;
  const parts = [];
  parts.push(sigType);
  if (fid) parts.push(fid);
  if (count != null) parts.push(`n=${count}`);
  return parts.join(' · ');
}

/**
 * Derive a confidence float from the F-072 fitness record. We use the pattern's
 * own `confidence` field when present (LLM stage attaches one between 0..1) and
 * fall back to the layer2 reading when it isn't. Returns 0 when neither is
 * available — the board renderer surfaces this as "0.00".
 *
 * @param {object} pattern - PatternRecord.
 * @param {object|null} fitness - FitnessRecord or null.
 * @returns {number}
 */
function confidenceFromFitness(pattern, fitness) {
  if (pattern && typeof pattern.confidence === 'number'
    && Number.isFinite(pattern.confidence) && pattern.confidence >= 0 && pattern.confidence <= 1) {
    return pattern.confidence;
  }
  if (fitness && fitness.layer2 && typeof fitness.layer2.value === 'number' && Number.isFinite(fitness.layer2.value)) {
    // Layer-2 value range is open (memoryRefs + 2*regrets / n); clamp to 0..1
    // for a confidence reading. A "1.0" Layer-2 average means every active
    // session produced at least one strong positive — solid confidence.
    const v = fitness.layer2.value;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }
  return 0;
}

// -----------------------------------------------------------------------------
// Public API — buildReviewBoard / shouldShowBoard
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-073/AC-1) Pending = persisted ∧ ¬applied ∧ ¬unlearned ∧ ¬archived
//                          ∧ ¬skipped-this-session ∧ ¬rejected-this-session.
// @cap-todo(ac:F-073/AC-6) Each eligible pattern surfaces options Approve / Reject / Skip,
//                          plus Unlearn (with 'Rückzug empfohlen' label) when the id is in
//                          listRetractRecommended().
/**
 * Build the in-memory review board. Pure-compute except for the archive sweep
 * (the only mutation): we do NOT write board.md here — the orchestrator calls
 * renderBoardMarkdown + writeBoardFile separately so dry-run tests stay clean.
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {string} [options.sessionId] - Override the SESSION.json sessionId.
 * @param {Date|string} [options.now] - Override timestamp (mostly for tests).
 * @returns {ReviewBoard}
 */
function buildReviewBoard(projectRoot, options) {
  const opts = options || {};
  const ts = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();
  const sid = opts.sessionId !== undefined
    ? sanitiseSessionId(opts.sessionId)
    : currentSessionId(projectRoot);

  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return {
      eligible: [],
      threshold: { met: false, reason: 'invalid-project-root' },
      archived: [],
      skippedThisSession: [],
      rejectedThisSession: [],
      sessionId: sid,
      ts,
    };
  }

  const { ids, skipped, rejected } = eligiblePatternIds(projectRoot, sid);

  // Build per-pattern entries with fitness + confidence + retract status.
  let retractList = [];
  try { retractList = patternApply.listRetractRecommended(projectRoot) || []; } catch (_e) { retractList = []; }
  const retractSet = new Set(retractList);

  // Read patterns once (listPatterns is the single source of truth).
  let allPatterns = [];
  try { allPatterns = patternPipeline.listPatterns(projectRoot) || []; } catch (_e) { allPatterns = []; }
  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const p of allPatterns) {
    if (p && isValidPatternId(p.id)) byId.set(p.id, p);
  }

  /** @type {EligibleEntry[]} */
  const eligible = [];
  for (const id of ids) {
    const pattern = byId.get(id);
    if (!pattern) continue; // race: pattern deleted between listPatterns and now
    let fitness = null;
    try { fitness = fitnessScore.getFitness(projectRoot, id); } catch (_e) { fitness = null; }
    const confidence = confidenceFromFitness(pattern, fitness);
    const retractRecommended = retractSet.has(id);
    const opts2 = ['Approve', 'Reject', 'Skip'];
    if (retractRecommended) opts2.push('Unlearn');
    eligible.push({
      patternId: id,
      fitness,
      confidence,
      triggerReason: triggerReasonFor(pattern),
      retractRecommended,
      options: opts2,
      pattern, // for the renderer; the JSON shape exposed externally still includes it
    });
  }

  const threshold = computeThreshold(eligible);

  return {
    eligible,
    threshold,
    archived: [], // populated by archiveStalePatterns separately
    skippedThisSession: skipped,
    rejectedThisSession: rejected,
    sessionId: sid,
    ts,
  };
}

/**
 * Compute the AC-2 threshold from an eligible-entries list. Pure-compute helper.
 * Public-ish via shouldShowBoard, which re-uses this function on a freshly-built
 * board.
 *
 * @cap-todo(ac:F-073/AC-2) Board appears only when ≥1 high-confidence (layer2.ready
 *                          AND value≥0.75 AND n≥5) OR ≥3 candidates of any kind.
 *
 * @param {EligibleEntry[]} eligible
 * @returns {{met: boolean, reason: string}}
 */
function computeThreshold(eligible) {
  if (!Array.isArray(eligible) || eligible.length === 0) {
    return { met: false, reason: 'no-eligible-patterns' };
  }
  let highConfidenceCount = 0;
  for (const e of eligible) {
    if (!e || !e.fitness || !e.fitness.layer2) continue;
    const l2 = e.fitness.layer2;
    if (l2.ready === true
      && Number(l2.value) >= HIGH_CONFIDENCE_LAYER2_VALUE
      && Number(l2.n) >= HIGH_CONFIDENCE_LAYER2_N) {
      highConfidenceCount += 1;
    }
  }
  if (highConfidenceCount >= 1) {
    return {
      met: true,
      reason: `high-confidence-pattern (${highConfidenceCount} eligible with layer2.value>=${HIGH_CONFIDENCE_LAYER2_VALUE} n>=${HIGH_CONFIDENCE_LAYER2_N})`,
    };
  }
  if (eligible.length >= ANY_KIND_THRESHOLD) {
    return {
      met: true,
      reason: `any-kind-threshold (${eligible.length} eligible patterns >= ${ANY_KIND_THRESHOLD})`,
    };
  }
  return {
    met: false,
    reason: `below-threshold (${eligible.length} eligible, ${highConfidenceCount} high-confidence)`,
  };
}

/**
 * The AC-2 gate, also used by the Stop-hook. Compute-only, no side-effects.
 * Mirrors buildReviewBoard's eligibility pipeline but skips the per-entry
 * fitness lookup unless we need it (we DO need it for the high-confidence arm).
 *
 * @cap-todo(ac:F-073/AC-2) shouldShowBoard returns the boolean gate.
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {string} [options.sessionId]
 * @returns {boolean}
 */
function shouldShowBoard(projectRoot, options) {
  const board = buildReviewBoard(projectRoot, options);
  return board.threshold.met === true;
}

// -----------------------------------------------------------------------------
// Public API — renderBoardMarkdown / writeBoardFile
// -----------------------------------------------------------------------------

/**
 * Render the board.md content from a ReviewBoard object. PURE-compute string
 * builder. Renderer escapes markdown control characters in dynamic fields so
 * a hostile pattern record can't smuggle markdown injection.
 *
 * @cap-risk(F-073/AC-3) Renderer escapes the dynamic fields (triggerReason,
 *                       featureRef, sessionId) by collapsing newlines and
 *                       backticks into literal placeholders. F-071 already
 *                       constrains pattern fields, but this is defence in
 *                       depth — a future contributor adding a free-text
 *                       field shouldn't have to remember to escape on render.
 *
 * @param {ReviewBoard} board
 * @returns {string}
 */
function renderBoardMarkdown(board) {
  if (!board || typeof board !== 'object') return '';
  const lines = [];
  const ts = typeof board.ts === 'string' ? board.ts : new Date().toISOString();
  lines.push(`# Pattern Review Board — ${escapeMd(ts)}`);
  lines.push('');
  if (board.sessionId) {
    lines.push(`Session: \`${escapeMd(board.sessionId)}\``);
  }
  lines.push(`Threshold: ${board.threshold.met ? 'MET' : 'BELOW'} (${escapeMd(board.threshold.reason || '')})`);
  lines.push('');

  if (!Array.isArray(board.eligible) || board.eligible.length === 0) {
    lines.push('_(no eligible patterns)_');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`Eligible patterns: ${board.eligible.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const e of board.eligible) {
    const p = e.pattern || {};
    const ev = p.evidence || {};
    const fitness = e.fitness;

    lines.push(`## ${escapeMd(e.patternId)} — ${escapeMd(e.triggerReason || 'unknown')}`);
    lines.push('');
    lines.push(`- **Level**: ${escapeMd(p.level || 'unknown')}`);
    lines.push(`- **Feature**: ${escapeMd(p.featureRef || '(unassigned)')}`);
    if (fitness && fitness.layer1 && fitness.layer2) {
      const l1v = Number(fitness.layer1.value);
      const l2v = Number(fitness.layer2.value);
      const l2n = Number(fitness.layer2.n);
      const ready = fitness.layer2.ready === true;
      lines.push(`- **Fitness**: layer1=${Number.isFinite(l1v) ? l1v : 0}, layer2=${formatFloat(l2v)} (n=${Number.isFinite(l2n) ? l2n : 0}, ready=${ready})`);
    } else {
      lines.push('- **Fitness**: _(no fitness record)_');
    }
    lines.push(`- **Confidence**: ${formatFloat(e.confidence)}`);
    const source = (p.source === 'llm' || p.source === 'heuristic') ? p.source : 'unknown';
    const degraded = p.degraded === true ? 'yes' : 'no';
    lines.push(`- **Source**: ${escapeMd(source)} | Degraded: ${degraded}`);
    if (e.retractRecommended) {
      lines.push('- **⚠️ Rückzug empfohlen** (current vs snapshot delta worsened, see retract-recommendations.jsonl)');
    }
    if (ev && typeof ev.candidateId === 'string' && /^[0-9a-f]+$/.test(ev.candidateId)) {
      lines.push(`- **Evidence candidateId**: \`${escapeMd(ev.candidateId)}\``);
    }
    lines.push('');
    lines.push(`**Options**: ${e.options.join(' / ')}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Hand-off contract for the outer agent (D2). Documents the AC-7 exit-code
  // semantics so the agent reports back faithfully.
  lines.push('## Hand-off');
  lines.push('');
  lines.push('For each pattern above, choose ONE of approve / reject / skip / unlearn:');
  lines.push('- **approve** → call `cap-pattern-apply.applyPattern(projectRoot, patternId)`. Record the commit hash.');
  lines.push('- **unlearn** → call `cap-pattern-apply.unlearnPattern(projectRoot, patternId, { reason: \'manual\' })`.');
  lines.push('- **skip** → call `cap-learn-review.skipPattern(projectRoot, patternId)`. Per-session only.');
  lines.push('- **reject** → call `cap-learn-review.rejectPattern(projectRoot, patternId)`. Per-session only.');
  lines.push('');
  lines.push('**Exit code contract (F-073/AC-7)**: the skill exits 0 ONLY when EVERY approve produced `applied:true`.');
  lines.push('Any apply returning `applied:false` → non-zero exit + a description of the failure. Do not swallow.');
  lines.push('');
  lines.push('Privacy: this board contains structured metadata only — counts, hashes, ids. No raw paths or user text.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a float to 2 decimal places. Defensive: NaN/non-finite collapses to '0.00'.
 * @param {number} v
 * @returns {string}
 */
function formatFloat(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

/**
 * Escape markdown control characters in a single-line dynamic field. We:
 *   - Collapse all whitespace runs (incl. newlines) to a single space.
 *   - Replace backticks with single quotes (prevents code-fence escapes).
 *   - Drop the markdown structural triplet '---' if it appears bare (a section
 *     break inside an inline header would scramble the renderer's output).
 * @param {any} v
 * @returns {string}
 */
function escapeMd(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  s = s.replace(/`/g, "'");
  s = s.replace(/[\r\n\t\f\v]+/g, ' ');
  s = s.replace(/\s{2,}/g, ' ');
  // Defensive: collapse a literal '---' run (markdown thematic break) so it
  // can't terminate a list item early. Three or more consecutive '-' dashes
  // in the middle of an inline field get a thin space between them.
  s = s.replace(/-{3,}/g, '—');
  return s;
}

/**
 * Atomic write of board.md.
 * @param {string} projectRoot
 * @param {string} boardMd
 * @returns {boolean}
 */
function writeBoardFile(projectRoot, boardMd) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false;
  if (typeof boardMd !== 'string') return false;
  ensureDir(learningRoot(projectRoot));
  return writeAtomic(boardFilePath(projectRoot), boardMd);
}

// -----------------------------------------------------------------------------
// Public API — skipPattern / rejectPattern (AC-4)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-073/AC-4) Skip persists to .cap/learning/skipped-<sessionId>.json.
//                          Per-session ONLY. New session shows the patterns again.
/**
 * Append a patternId to the session's skipped file. Idempotent: re-adding an
 * already-present id does NOT duplicate the entry.
 *
 * @param {string} projectRoot
 * @param {string} patternId
 * @param {string} [sessionId] - Override the SESSION.json sessionId.
 * @returns {boolean}
 */
function skipPattern(projectRoot, patternId, sessionId) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false;
  if (!isValidPatternId(patternId)) return false;
  const sid = sessionId !== undefined ? sanitiseSessionId(sessionId) : currentSessionId(projectRoot);
  if (!sid) return false;

  const fp = skippedFilePath(projectRoot, sid);
  // Read existing first so the file shape is consistent (ids de-duped, sorted).
  const prior = readJson(fp);
  /** @type {Set<string>} */
  const ids = new Set();
  if (prior && Array.isArray(prior.patternIds)) {
    for (const id of prior.patternIds) {
      if (isValidPatternId(id)) ids.add(id);
    }
  }
  // @cap-decision(F-073/D7) True idempotency — when the patternId is already recorded,
  //                         skip the write entirely so the on-disk ts does not change. Otherwise
  //                         a second skipPattern bumps `ts` by 1 ms and the file is no longer
  //                         byte-stable, polluting `git diff` and breaking the "no side-effect"
  //                         contract reviewers expect from idempotent helpers.
  if (ids.has(patternId)) return true;

  ids.add(patternId);
  const sorted = [...ids].sort();
  return writeAtomicJson(fp, {
    sessionId: sid,
    ts: new Date().toISOString(),
    patternIds: sorted,
  });
}

/**
 * Append a patternId to the session's rejected file. Idempotent.
 * @param {string} projectRoot
 * @param {string} patternId
 * @param {string} [sessionId]
 * @returns {boolean}
 */
function rejectPattern(projectRoot, patternId, sessionId) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false;
  if (!isValidPatternId(patternId)) return false;
  const sid = sessionId !== undefined ? sanitiseSessionId(sessionId) : currentSessionId(projectRoot);
  if (!sid) return false;

  const fp = rejectedFilePath(projectRoot, sid);
  const prior = readJson(fp);
  /** @type {Set<string>} */
  const ids = new Set();
  if (prior && Array.isArray(prior.patternIds)) {
    for (const id of prior.patternIds) {
      if (isValidPatternId(id)) ids.add(id);
    }
  }
  // @cap-decision(F-073/D7) Idempotency mirror of skipPattern — no write when the id is already recorded.
  if (ids.has(patternId)) return true;

  ids.add(patternId);
  const sorted = [...ids].sort();
  return writeAtomicJson(fp, {
    sessionId: sid,
    ts: new Date().toISOString(),
    patternIds: sorted,
  });
}

// -----------------------------------------------------------------------------
// Public API — archiveStalePatterns (AC-5)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-073/AC-5) Patterns un-reviewed > 7 sessions auto-move to
//                          .cap/learning/archive/<P-NNN>.json AND are removed
//                          from .cap/learning/patterns/. Insufficient-history
//                          short-circuit when the corpus has fewer than 7
//                          distinct sessions total.
/**
 * Compute the count of distinct sessionIds in the F-070 corpus across the three
 * signal types. F-072 has unionSessionsByRecency but doesn't export it; we
 * replicate the simple distinct-count here. We intentionally do NOT include
 * SESSION.json's sessionId (that's a single in-progress session, not a corpus
 * record).
 *
 * @cap-decision(F-073/D5) Replicating the union-of-distinct-sessionIds count
 *                  inline because F-072 doesn't export the helper. The cost is
 *                  ~5 lines of code; the benefit is no API surface change to
 *                  F-072 just to wire F-073.
 *
 * @param {string} projectRoot
 * @returns {{ corpusSessionCount: number, sessionsByPattern: Map<string, Set<string>> }}
 */
function corpusSessionStats(projectRoot) {
  let overrides = [];
  let memoryRefs = [];
  let regrets = [];
  try { overrides = learningSignals.getSignals(projectRoot, 'override') || []; } catch (_e) { overrides = []; }
  try { memoryRefs = learningSignals.getSignals(projectRoot, 'memory-ref') || []; } catch (_e) { memoryRefs = []; }
  try { regrets = learningSignals.getSignals(projectRoot, 'regret') || []; } catch (_e) { regrets = []; }

  /** @type {Set<string>} */
  const all = new Set();
  for (const arr of [overrides, memoryRefs, regrets]) {
    for (const r of arr) {
      if (r && typeof r.sessionId === 'string' && r.sessionId.length > 0) {
        all.add(r.sessionId);
      }
    }
  }

  // Per-record { sessionId, ts } collection — used by callers to count
  // per-pattern session reach since pattern.createdAt.
  /** @type {Map<string, Set<string>>} */
  const sessionsByPattern = new Map(); // populated lazily by archiveStalePatterns
  return { corpusSessionCount: all.size, sessionsByPattern, allRecords: { overrides, memoryRefs, regrets } };
}

/**
 * Archive any pattern whose distinct-session count since createdAt exceeds
 * STALE_SESSION_THRESHOLD. Idempotent: an already-archived pattern is skipped.
 * Insufficient-history short-circuit: when corpus has fewer than the threshold
 * sessions total, NO archive (we don't have enough data).
 *
 * Excludes:
 *   - applied / unlearned patterns (already left review).
 *   - patterns skipped or rejected this session (the user is engaged with them).
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {string} [options.sessionId] - Override SESSION.json sessionId.
 * @param {Date|string} [options.now] - Override timestamp on the archived record.
 * @param {number} [options.window] - Override STALE_SESSION_THRESHOLD (mostly for tests).
 * @returns {{ archived: string[], errors: string[] }}
 */
function archiveStalePatterns(projectRoot, options) {
  const opts = options || {};
  const archived = [];
  const errors = [];
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return { archived, errors: ['invalid-project-root'] };
  }
  const window = (typeof opts.window === 'number' && opts.window > 0) ? opts.window : STALE_SESSION_THRESHOLD;
  const sid = opts.sessionId !== undefined ? sanitiseSessionId(opts.sessionId) : currentSessionId(projectRoot);
  const nowIso = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();

  const stats = corpusSessionStats(projectRoot);
  if (stats.corpusSessionCount < window) {
    // @cap-decision(F-073/D5) Insufficient-history short-circuit. Mirrors F-072's
    //                 expiry-window guard.
    return { archived, errors };
  }

  // Read patterns + state via module APIs.
  let patterns = [];
  try { patterns = patternPipeline.listPatterns(projectRoot) || []; } catch (e) {
    errors.push(`listPatterns failed: ${e && e.message ? e.message : 'unknown'}`);
    return { archived, errors };
  }
  const applied = new Set((patternApply.listAppliedPatterns(projectRoot) || [])
    .map((a) => a && a.patternId).filter(isValidPatternId));
  const unlearned = new Set((patternApply.listUnlearnedPatterns(projectRoot) || [])
    .map((u) => u && u.patternId).filter(isValidPatternId));
  const skipped = sid ? new Set(loadSkippedThisSession(projectRoot, sid)) : new Set();
  const rejected = sid ? new Set(loadRejectedThisSession(projectRoot, sid)) : new Set();

  for (const pattern of patterns) {
    if (!pattern || !isValidPatternId(pattern.id)) continue;
    if (applied.has(pattern.id)) continue;
    if (unlearned.has(pattern.id)) continue;
    if (skipped.has(pattern.id)) continue;
    if (rejected.has(pattern.id)) continue;

    const since = typeof pattern.createdAt === 'string' ? pattern.createdAt : null;
    if (!since) continue; // can't compute session-reach without a createdAt

    // Already archived? (idempotency)
    const archivePath = archiveFilePath(projectRoot, pattern.id);
    if (fs.existsSync(archivePath)) {
      // The source pattern file might still exist if a prior archive only wrote
      // the archive copy and crashed before delete; clean that up here.
      const sourcePath = patternFilePath(projectRoot, pattern.id);
      if (fs.existsSync(sourcePath)) {
        try { fs.unlinkSync(sourcePath); } catch (_e) { /* ignore */ }
      }
      continue;
    }

    // Distinct sessions since createdAt across union of three corpora.
    const sessionsSet = new Set();
    for (const arrName of ['overrides', 'memoryRefs', 'regrets']) {
      for (const r of stats.allRecords[arrName] || []) {
        if (!r || typeof r.sessionId !== 'string' || r.sessionId.length === 0) continue;
        if (typeof r.ts !== 'string') continue;
        if (r.ts < since) continue;
        sessionsSet.add(r.sessionId);
      }
    }
    if (sessionsSet.size <= window) continue; // not stale yet — needs MORE than threshold

    // Move: write archive record (with archivedAt + reason) atomically, then
    // delete the source pattern file.
    const record = {
      ...pattern,
      archivedAt: nowIso,
      reason: 'stale-7-sessions',
    };
    if (!writeAtomicJson(archivePath, record)) {
      errors.push(`archive write failed for ${pattern.id}`);
      continue;
    }
    const sourcePath = patternFilePath(projectRoot, pattern.id);
    try {
      if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
    } catch (e) {
      errors.push(`archive source delete failed for ${pattern.id}: ${e && e.message ? e.message : 'unknown'}`);
      // Don't include in archived list — partially-applied move.
      continue;
    }
    archived.push(pattern.id);
  }

  archived.sort();
  return { archived, errors };
}

// -----------------------------------------------------------------------------
// Public API — board-pending.flag round-trip (AC-3)
// -----------------------------------------------------------------------------

// @cap-todo(ac:F-073/AC-3) Stop-hook computes shouldShowBoard() and writes the
//                          .flag file when true. /cap:status / /cap:learn review
//                          surface the flag. Skill clears the flag after the
//                          board has been processed.
/**
 * Write the board-pending flag. The flag content is a tiny JSON snippet
 * (timestamp + sessionId + eligibleCount) for diagnostic purposes; the SKILL
 * checks for FILE EXISTENCE, not content, so a half-written flag is harmless.
 *
 * @cap-risk(F-073/AC-3) sessionId is sanitised before persistence so a hostile
 *                       SESSION.json can't smuggle bytes via the flag content.
 *                       Adversarial test pins this with a SECRET_NEEDLE
 *                       sessionId.
 *
 * @param {string} projectRoot
 * @param {Object} [options]
 * @param {string} [options.sessionId]
 * @param {number} [options.eligibleCount]
 * @param {Date|string} [options.now]
 * @returns {boolean}
 */
function writeBoardPendingFlag(projectRoot, options) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false;
  const opts = options || {};
  const sid = opts.sessionId !== undefined ? sanitiseSessionId(opts.sessionId) : currentSessionId(projectRoot);
  const ts = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();
  const eligibleCount = Number.isFinite(Number(opts.eligibleCount)) ? Math.max(0, Math.floor(Number(opts.eligibleCount))) : 0;
  ensureDir(learningRoot(projectRoot));
  const payload = { ts, sessionId: sid || null, eligibleCount };
  return writeAtomicJson(boardPendingFlagPath(projectRoot), payload);
}

/**
 * Remove the board-pending flag. Idempotent: missing file is success.
 * @param {string} projectRoot
 * @returns {boolean}
 */
function clearBoardPendingFlag(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false;
  const fp = boardPendingFlagPath(projectRoot);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Return true iff the board-pending flag exists. Used by /cap:status and the
 * skill startup banner.
 * @param {string} projectRoot
 * @returns {boolean}
 */
function hasBoardPendingFlag(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false;
  try {
    return fs.existsSync(boardPendingFlagPath(projectRoot));
  } catch (_e) {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Exports — keep this list minimal. /cap:learn review + the Stop hook should
// consume only these.
// -----------------------------------------------------------------------------

module.exports = {
  // Constants — exported for tests + downstream consumers.
  CAP_DIR,
  LEARNING_DIR,
  PATTERNS_DIR,
  ARCHIVE_DIR,
  BOARD_FILE,
  BOARD_PENDING_FLAG,
  HIGH_CONFIDENCE_LAYER2_VALUE,
  HIGH_CONFIDENCE_LAYER2_N,
  ANY_KIND_THRESHOLD,
  STALE_SESSION_THRESHOLD,
  // Public API.
  buildReviewBoard,
  renderBoardMarkdown,
  writeBoardFile,
  skipPattern,
  rejectPattern,
  archiveStalePatterns,
  shouldShowBoard,
  writeBoardPendingFlag,
  clearBoardPendingFlag,
  hasBoardPendingFlag,
  // Path helpers — exported for tests.
  archiveDir,
  archiveFilePath,
  boardFilePath,
  boardPendingFlagPath,
  skippedFilePath,
  rejectedFilePath,
  // Helpers exposed for tests / introspection.
  loadSkippedThisSession,
  loadRejectedThisSession,
  eligiblePatternIds,
  triggerReasonFor,
  confidenceFromFitness,
  computeThreshold,
  currentSessionId,
  sanitiseSessionId,
};
