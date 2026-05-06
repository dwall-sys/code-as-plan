#!/usr/bin/env node
// @cap-feature(feature:F-073) Learn-Review Stop-Hook — flags pending pattern reviews after each session.
//                              Fires AFTER cap-memory's Stop hook (memory pipeline → learn pipeline →
//                              review board). cap-hook-version: {{CAP_VERSION}}
//
// Stop hook: at session end, compute shouldShowBoard(projectRoot). If the gate is met, write
// .cap/learning/board-pending.flag so /cap:status (and the next /cap:learn review run) can surface
// the pending review. We DO NOT spawn the skill from the hook — Claude Code hook subprocesses can't
// drive an interactive review flow.
//
// Skip via CAP_SKIP_LEARN_REVIEW_HOOK=1.
// Never exits non-zero: a failure here must not block the user's session end.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// @cap-todo(ac:F-073/AC-3) Skip switch — keep parity with cap-learning-hook.js / cap-memory.js so
//                          ops can disable a single learning hook without touching the others.
if (process.env.CAP_SKIP_LEARN_REVIEW_HOOK === '1') {
  process.exit(0);
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  run(input);
});

function tryRequire(modulePath) {
  try { return require(modulePath); } catch { return null; }
}

// @cap-decision(F-073/D1) Lib resolution mirrors cap-learning-hook.js exactly: env override →
//                  colocated in-tree → installed under ~/.claude. Keeps every CAP hook on the same
//                  resolution path so an ops change to one hook applies to the others for free.
function resolveReviewModule() {
  const candidates = [];
  if (process.env.CAP_LEARN_REVIEW_LIB) candidates.push(process.env.CAP_LEARN_REVIEW_LIB);
  candidates.push(path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-learn-review.cjs'));
  candidates.push(path.join(os.homedir(), '.claude', 'cap', 'bin', 'lib', 'cap-learn-review.cjs'));
  for (const p of candidates) {
    const mod = tryRequire(p);
    if (mod) return mod;
  }
  return null;
}

function run(raw) {
  // @cap-todo(ac:F-073/AC-3) Whole hook body wrapped in try/catch; failures never escape.
  try {
    const data = raw ? JSON.parse(raw) : {};
    const cwd = data.cwd || process.cwd();

    const review = resolveReviewModule();
    if (!review) process.exit(0); // library not installed — silent no-op (mirrors cap-memory.js).

    // Compute the gate. shouldShowBoard reads SESSION.json internally for the per-session skip/reject
    // sets — no need to pass anything explicit here.
    let shouldShow = false;
    try {
      shouldShow = review.shouldShowBoard(cwd) === true;
    } catch (_e) {
      shouldShow = false;
    }

    if (!shouldShow) {
      // Below threshold — NO flag. If a stale flag from a prior session is on disk we leave it
      // alone here; /cap:learn review clears it after the user processes the board, and a fresh
      // shouldShowBoard==false simply means there's nothing new to add.
      process.exit(0);
    }

    // Threshold met — write the flag. Eligible count is recomputed for diagnostic purposes;
    // the SKILL checks for FILE EXISTENCE, not content, so a half-written flag is harmless.
    let eligibleCount = 0;
    try {
      const board = review.buildReviewBoard(cwd);
      if (board && Array.isArray(board.eligible)) eligibleCount = board.eligible.length;
    } catch (_e) {
      eligibleCount = 0;
    }

    // @cap-risk(F-073/AC-3) writeBoardPendingFlag sanitises sessionId before persistence so a
    //                       hostile SESSION.json can't smuggle bytes via the flag content.
    review.writeBoardPendingFlag(cwd, { eligibleCount });
    process.exit(0);
  } catch (_err) {
    // Best-effort error log to .cap/learning/.errors.log so we can diagnose without leaking
    // through the tool surface. Mirrors cap-learning-hook.js's error-log strategy.
    try {
      const cwd = process.cwd();
      const errDir = path.join(cwd, '.cap', 'learning');
      if (!fs.existsSync(errDir)) fs.mkdirSync(errDir, { recursive: true });
      fs.appendFileSync(
        path.join(errDir, '.errors.log'),
        JSON.stringify({
          ts: new Date().toISOString(),
          hook: 'cap-learn-review-hook',
          message: _err && _err.message ? _err.message : String(_err),
        }) + '\n',
        'utf8',
      );
    } catch {
      // Even logging failed — stay silent.
    }
    process.exit(0);
  }
}
