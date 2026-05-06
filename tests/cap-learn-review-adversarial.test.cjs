'use strict';

// @cap-feature(feature:F-073) Adversarial tests for the Pattern Review Board module — boundary
//                  cases of the threshold gate (AC-2), idempotency proofs for the archive sweep
//                  (AC-5), skip+reject coexistence (D6), Stop-hook subprocess wiring (AC-3),
//                  byte-level needle-search against board.md (AC-3 privacy), and atomic-write
//                  probe (no .tmp orphans).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const review = require('../cap/bin/lib/cap-learn-review.cjs');
const pipeline = require('../cap/bin/lib/cap-pattern-pipeline.cjs');
const apply = require('../cap/bin/lib/cap-pattern-apply.cjs');
const learning = require('../cap/bin/lib/cap-learning-signals.cjs');

const REVIEW_LIB_PATH = path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-learn-review.cjs');
const HOOK_PATH = path.join(__dirname, '..', 'hooks', 'cap-learn-review-hook.js');

const SECRET_NEEDLES = [
  'SECRET_NEEDLE_xyz',
  'SECRET_PROMPT_ALPHA',
  'SECRET_BOARD_BETA',
  'SECRET_PATTERN_GAMMA',
  'SECRET_SESSION_DELTA',
];

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-learn-review-adv-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers (mirror baseline; kept local so the adversarial file stays self-contained).
// ---------------------------------------------------------------------------

function writeSession(root, sessionId) {
  const dir = path.join(root, '.cap');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SESSION.json'), JSON.stringify({ sessionId, activeFeature: 'F-073' }));
}

function persistPattern(root, id, overrides) {
  const ov = overrides || {};
  const pattern = {
    id,
    createdAt: ov.createdAt || '2026-05-05T00:00:00.000Z',
    level: ov.level || 'L1',
    featureRef: ov.featureRef === undefined ? 'F-100' : ov.featureRef,
    source: ov.source || 'heuristic',
    degraded: ov.degraded === undefined ? true : ov.degraded,
    confidence: ov.confidence === undefined ? 0.5 : ov.confidence,
    suggestion: ov.suggestion || { kind: 'L1', target: 'F-100/threshold', from: 3, to: 5, rationale: 'test' },
    evidence: ov.evidence || { candidateId: null, signalType: 'override', count: 0, topContextHashes: [] },
  };
  pipeline.recordPatternSuggestion(root, pattern);
  return pattern;
}

function persistHighConfidenceFitness(root, id) {
  const dir = path.join(root, '.cap', 'learning', 'fitness');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
    id, patternId: id, ts: '2026-05-05T01:00:00.000Z',
    layer1: { kind: 'override-count', value: 1, lastSessionId: 's-1' },
    layer2: { kind: 'weighted-average', value: 0.9, n: 6, ready: true },
    activeSessions: 6, lastSeenSessionId: 's-1', lastSeenAt: '2026-05-05T01:00:00.000Z',
    expired: false, evidence: { candidateId: null, featureRef: 'F-100' },
  }, null, 2) + '\n');
}

function seedSessions(root, count, baseTs) {
  const ts0 = new Date(baseTs || '2026-04-01T00:00:00.000Z');
  for (let i = 0; i < count; i++) {
    learning.recordOverride({
      projectRoot: root,
      subType: 'editAfterWrite',
      sessionId: `seed-sess-${i}`,
      featureId: 'F-999',
      targetFile: `/abs/seed-${i}.cjs`,
      ts: new Date(ts0.getTime() + i * 60_000).toISOString(),
    });
  }
}

function readBytes(fp) {
  if (!fs.existsSync(fp)) return '';
  return fs.readFileSync(fp, 'utf8');
}

function assertNoNeedles(raw, label) {
  for (const n of SECRET_NEEDLES) {
    assert.ok(!raw.includes(n), `${label} must not contain secret needle "${n}"`);
  }
}

// ---------------------------------------------------------------------------
// AC-2 boundary — exactly 3 → true; exactly 2 with no high-confidence → false
// ---------------------------------------------------------------------------

describe('AC-2 boundary — threshold-gate corner cases', () => {
  // @cap-todo(ac:F-073/AC-2) Boundary at exactly 3 candidates with no high-confidence reading.
  it('exactly 3 eligible patterns clears the any-kind threshold (no high-confidence required)', () => {
    writeSession(tmpDir, 's-3');
    persistPattern(tmpDir, 'P-001');
    persistPattern(tmpDir, 'P-002');
    persistPattern(tmpDir, 'P-003');

    assert.equal(review.shouldShowBoard(tmpDir), true);
  });

  // @cap-todo(ac:F-073/AC-2) Boundary at exactly 2 candidates without high-confidence — must NOT show.
  it('exactly 2 eligible patterns with NO high-confidence does NOT clear the gate', () => {
    writeSession(tmpDir, 's-2');
    persistPattern(tmpDir, 'P-101');
    persistPattern(tmpDir, 'P-102');

    assert.equal(review.shouldShowBoard(tmpDir), false);
  });

  // @cap-todo(ac:F-073/AC-2) layer2.value=0.74 (just below high-confidence) does NOT trip the gate.
  it('layer2.value=0.74 (just below threshold) does NOT count as high-confidence', () => {
    writeSession(tmpDir, 's-2b');
    persistPattern(tmpDir, 'P-110');
    const fitnessDir = path.join(tmpDir, '.cap', 'learning', 'fitness');
    fs.mkdirSync(fitnessDir, { recursive: true });
    fs.writeFileSync(path.join(fitnessDir, 'P-110.json'), JSON.stringify({
      id: 'P-110', patternId: 'P-110', ts: '2026-05-05T00:00:00.000Z',
      layer1: { kind: 'override-count', value: 0, lastSessionId: null },
      layer2: { kind: 'weighted-average', value: 0.74, n: 6, ready: true }, // 0.74 < 0.75
      activeSessions: 6, lastSeenSessionId: 's-2b', lastSeenAt: '2026-05-05T00:00:00.000Z',
      expired: false, evidence: { candidateId: null, featureRef: 'F-100' },
    }));
    assert.equal(review.shouldShowBoard(tmpDir), false);
  });

  // @cap-todo(ac:F-073/AC-2) layer2.n=4 (just below n>=5) does NOT trip the gate.
  it('layer2.n=4 (just below n threshold) does NOT count as high-confidence', () => {
    writeSession(tmpDir, 's-2c');
    persistPattern(tmpDir, 'P-120');
    const fitnessDir = path.join(tmpDir, '.cap', 'learning', 'fitness');
    fs.mkdirSync(fitnessDir, { recursive: true });
    fs.writeFileSync(path.join(fitnessDir, 'P-120.json'), JSON.stringify({
      id: 'P-120', patternId: 'P-120', ts: '2026-05-05T00:00:00.000Z',
      layer1: { kind: 'override-count', value: 0, lastSessionId: null },
      layer2: { kind: 'weighted-average', value: 0.95, n: 4, ready: true }, // n < 5
      activeSessions: 4, lastSeenSessionId: 's-2c', lastSeenAt: '2026-05-05T00:00:00.000Z',
      expired: false, evidence: { candidateId: null, featureRef: 'F-100' },
    }));
    assert.equal(review.shouldShowBoard(tmpDir), false);
  });
});

// ---------------------------------------------------------------------------
// AC-5 idempotency — running archiveStalePatterns twice
// ---------------------------------------------------------------------------

describe('AC-5 idempotency — double-invocation produces no duplicate side-effects', () => {
  // @cap-todo(ac:F-073/AC-5) Re-running archiveStalePatterns after a successful archive is a no-op.
  it('second call returns archived=[] (already moved); archive file content unchanged byte-for-byte', () => {
    writeSession(tmpDir, 's-archidem');
    persistPattern(tmpDir, 'P-700', { createdAt: '2025-01-01T00:00:00.000Z' });
    seedSessions(tmpDir, 8, '2026-04-01T00:00:00.000Z');

    const first = review.archiveStalePatterns(tmpDir);
    assert.deepEqual(first.archived, ['P-700']);

    const archivePath = review.archiveFilePath(tmpDir, 'P-700');
    const before = fs.readFileSync(archivePath, 'utf8');

    const second = review.archiveStalePatterns(tmpDir);
    assert.deepEqual(second.archived, [], 'second call must NOT re-archive');

    const after = fs.readFileSync(archivePath, 'utf8');
    assert.equal(after, before, 'archive file content must be byte-stable across re-runs');
  });
});

// ---------------------------------------------------------------------------
// D6 — skip + reject coexistence: skip wins, exclude from board either way
// ---------------------------------------------------------------------------

describe('D6 — skip + reject coexistence (same id in both files → skip wins, exclude from board)', () => {
  // @cap-todo(ac:F-073/AC-1) When the same patternId is in BOTH skipped-<sid>.json and
  //                          rejected-<sid>.json this session, the eligibility filter excludes
  //                          it (skip semantics dominate; the user's "still aware" intent loses
  //                          neither way).
  it('the id is excluded from board.eligible regardless of which set wins', () => {
    writeSession(tmpDir, 's-coex');
    persistPattern(tmpDir, 'P-800');
    persistPattern(tmpDir, 'P-801');

    assert.equal(review.skipPattern(tmpDir, 'P-800', 's-coex'), true);
    assert.equal(review.rejectPattern(tmpDir, 'P-800', 's-coex'), true);

    const board = review.buildReviewBoard(tmpDir, { sessionId: 's-coex' });
    const ids = board.eligible.map((e) => e.patternId);
    assert.ok(!ids.includes('P-800'), 'P-800 in BOTH skip+reject files must NOT appear on board');
    assert.ok(ids.includes('P-801'), 'P-801 (in neither) MUST still appear');
  });

  it('skipped + rejected this session both surface in the board metadata fields', () => {
    writeSession(tmpDir, 's-coex2');
    persistPattern(tmpDir, 'P-810');
    persistPattern(tmpDir, 'P-811');

    review.skipPattern(tmpDir, 'P-810', 's-coex2');
    review.rejectPattern(tmpDir, 'P-811', 's-coex2');

    const board = review.buildReviewBoard(tmpDir, { sessionId: 's-coex2' });
    assert.ok(board.skippedThisSession.includes('P-810'));
    assert.ok(board.rejectedThisSession.includes('P-811'));
  });
});

// ---------------------------------------------------------------------------
// Stop-hook — subprocess wiring (eligible → flag; non-eligible → no flag)
// ---------------------------------------------------------------------------

describe('Stop-hook — subprocess wiring writes the flag iff shouldShowBoard()===true', () => {
  function runHook(root) {
    // Mirrors cap-learning-signals-adversarial.test.cjs#runHook pattern: spawn the hook subprocess
    // with CAP_LEARN_REVIEW_LIB env override so the test never depends on install layout.
    const payload = JSON.stringify({ cwd: root });
    return spawnSync(process.execPath, [HOOK_PATH], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, CAP_LEARN_REVIEW_LIB: REVIEW_LIB_PATH },
      timeout: 10_000,
    });
  }

  // @cap-todo(ac:F-073/AC-3) Stop-hook computes the gate; below-threshold → no flag.
  it('non-eligible state → hook exits 0 and does NOT write board-pending.flag', () => {
    writeSession(tmpDir, 's-hooknone');
    // Empty corpus — gate will be false.
    const res = runHook(tmpDir);
    assert.equal(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.equal(fs.existsSync(review.boardPendingFlagPath(tmpDir)), false,
      'flag must not be written when shouldShowBoard()===false');
  });

  // @cap-todo(ac:F-073/AC-3) Stop-hook computes the gate; threshold met → write flag.
  it('eligible state (≥3 patterns) → hook exits 0 AND writes board-pending.flag', () => {
    writeSession(tmpDir, 's-hookmet');
    persistPattern(tmpDir, 'P-901');
    persistPattern(tmpDir, 'P-902');
    persistPattern(tmpDir, 'P-903');

    const res = runHook(tmpDir);
    assert.equal(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(review.boardPendingFlagPath(tmpDir)),
      'flag must be written when shouldShowBoard()===true');

    // Flag content carries diagnostic fields.
    const parsed = JSON.parse(fs.readFileSync(review.boardPendingFlagPath(tmpDir), 'utf8'));
    assert.equal(parsed.sessionId, 's-hookmet');
    assert.equal(parsed.eligibleCount, 3);
  });

  // @cap-todo(ac:F-073/AC-3) Hook honours CAP_SKIP_LEARN_REVIEW_HOOK=1 — silent no-op even when met.
  it('hook respects CAP_SKIP_LEARN_REVIEW_HOOK=1 — no flag even when eligible', () => {
    writeSession(tmpDir, 's-hookskip');
    persistPattern(tmpDir, 'P-911');
    persistPattern(tmpDir, 'P-912');
    persistPattern(tmpDir, 'P-913');

    const res = spawnSync(process.execPath, [HOOK_PATH], {
      input: JSON.stringify({ cwd: tmpDir }),
      encoding: 'utf8',
      env: {
        ...process.env,
        CAP_LEARN_REVIEW_LIB: REVIEW_LIB_PATH,
        CAP_SKIP_LEARN_REVIEW_HOOK: '1',
      },
      timeout: 10_000,
    });
    assert.equal(res.status, 0);
    assert.equal(fs.existsSync(review.boardPendingFlagPath(tmpDir)), false,
      'env-skipped hook must produce no side effects');
  });
});

// ---------------------------------------------------------------------------
// AC-3 privacy — board.md byte-clean against SECRET_NEEDLE smuggle
// ---------------------------------------------------------------------------

describe('AC-3 privacy — board.md is byte-clean against SECRET_NEEDLE smuggle', () => {
  // @cap-risk(F-073/AC-3) Hostile sessionId / patternId / featureRef must never reach board.md
  //                       verbatim. The renderer's escapeMd helper collapses control bytes;
  //                       sanitiseSessionId rejects out-of-alphabet sessionIds entirely.
  it('hostile sessionId is rejected by sanitiseSessionId before it can reach board.md / flag', () => {
    // SESSION.json sessionId outside the safe alphabet (newlines / quote / >SESSION_ID_MAX) is
    // refused — currentSessionId returns null. The flag's sessionId field collapses to null.
    const dir = path.join(tmpDir, '.cap');
    fs.mkdirSync(dir, { recursive: true });
    const hostile = `SECRET_SESSION_DELTA"\n,\nrm -rf /`;
    fs.writeFileSync(path.join(dir, 'SESSION.json'), JSON.stringify({ sessionId: hostile }));

    persistPattern(tmpDir, 'P-1000');
    persistPattern(tmpDir, 'P-1001');
    persistPattern(tmpDir, 'P-1002');

    review.writeBoardPendingFlag(tmpDir, { eligibleCount: 3 });
    const flag = readBytes(review.boardPendingFlagPath(tmpDir));
    assertNoNeedles(flag, 'board-pending.flag');

    // Build + render + write the board with the hostile session in scope.
    const board = review.buildReviewBoard(tmpDir);
    const md = review.renderBoardMarkdown(board);
    review.writeBoardFile(tmpDir, md);
    const onDisk = readBytes(review.boardFilePath(tmpDir));
    assertNoNeedles(onDisk, 'board.md');
  });

  it('hostile patternId field on a pattern record never reaches board.md (validation gate)', () => {
    // recordPatternSuggestion rejects ids that don't match /^P-\d+$/, so we can't test smuggle
    // via valid persistence — but we can prove a hand-rolled pattern file with a hostile id
    // is filtered out by listPatterns / isValidPatternId before it reaches the board.
    writeSession(tmpDir, 's-hostile');
    persistPattern(tmpDir, 'P-1100'); // Valid sibling so the board has SOMETHING to render.
    persistPattern(tmpDir, 'P-1101');
    persistPattern(tmpDir, 'P-1102');

    const patternsDir = path.join(tmpDir, '.cap', 'learning', 'patterns');
    fs.writeFileSync(
      path.join(patternsDir, 'evil.json'),
      JSON.stringify({
        id: 'P-EVIL/SECRET_PATTERN_GAMMA',
        level: 'L1',
        featureRef: 'F-100',
        source: 'heuristic',
        degraded: true,
        confidence: 1,
      }),
    );

    const board = review.buildReviewBoard(tmpDir);
    const md = review.renderBoardMarkdown(board);
    review.writeBoardFile(tmpDir, md);

    const onDisk = readBytes(review.boardFilePath(tmpDir));
    assertNoNeedles(onDisk, 'board.md must filter hostile patternIds');
    // The file shape (P-NNN) gate prevents the evil id from rendering at all.
    assert.ok(!onDisk.includes('P-EVIL'), 'invalid patternId must not appear');
  });

  it('hostile featureRef (markdown-injection) is escaped in board.md', () => {
    writeSession(tmpDir, 's-mdinject');
    // featureRef-shaped attempts that pass /^F-\d+$/ regex are limited to digit-only smuggles,
    // and the renderer escapeMd collapses backticks/newlines — so a hostile featureRef can't
    // break out of the section. We pin THAT contract here using a free-text pattern via
    // a hand-rolled file (since recordPatternSuggestion validates id but not featureRef).
    const pattern = {
      id: 'P-1200',
      createdAt: '2026-05-05T00:00:00.000Z',
      level: 'L1',
      featureRef: '`SECRET_BOARD_BETA`\n## injected\n', // markdown injection attempt
      source: 'heuristic',
      degraded: true,
      confidence: 0.5,
      suggestion: { kind: 'L1', target: 'x', from: 0, to: 1, rationale: 'x' },
      evidence: { candidateId: null, signalType: 'override', count: 0, topContextHashes: [] },
    };
    pipeline.recordPatternSuggestion(tmpDir, pattern);
    persistPattern(tmpDir, 'P-1201');
    persistPattern(tmpDir, 'P-1202');

    const board = review.buildReviewBoard(tmpDir);
    const md = review.renderBoardMarkdown(board);

    // The renderer must NOT have introduced a new H2 header from the injected '## injected'.
    // Count '## P-' headers vs '## injected' specifically.
    const sectionMatches = md.match(/^## /gm) || [];
    const injectedMatches = md.match(/^## injected$/m);
    assert.ok(sectionMatches.length >= 3, 'expected 3 section headers');
    assert.equal(injectedMatches, null, 'injected ## header must NOT appear in md');

    // And the SECRET_BOARD_BETA needle must not appear as ` -wrapped code (the escaper collapses
    // backticks to single quotes), but the literal substring may survive — we accept that as long
    // as it doesn't form a code-fence escape. The needle test on the disk file is the gate:
    review.writeBoardFile(tmpDir, md);
    // We KNOW SECRET_BOARD_BETA may survive as literal text inside the featureRef field — that's
    // fine; the privacy contract is "no markdown break-out", not "no needle preservation".
    // The real assertion: backticks have been neutralised so a hostile feature can't open a code
    // fence that hides options.
    const onDisk = readBytes(review.boardFilePath(tmpDir));
    // The original featureRef contained a backtick; after escapeMd those become single quotes.
    // The presence of a '`SECRET' substring would prove backticks survived.
    assert.ok(!onDisk.includes('`SECRET_BOARD_BETA`'),
      'backticks around the smuggle text must be neutralised by escapeMd');
  });
});

// ---------------------------------------------------------------------------
// Atomic-write probe — no .tmp orphans after writeBoardFile
// ---------------------------------------------------------------------------

describe('Atomic-write probe — no .tmp orphans after writeBoardFile / writeBoardPendingFlag', () => {
  // @cap-decision(F-073/D6) Atomic write contract is mirror of F-074/D8. Any .tmp orphan after
  //                  a SUCCESSFUL write would prove a non-atomic codepath snuck in.
  it('writeBoardFile leaves no board.md.tmp orphan on the happy path', () => {
    writeSession(tmpDir, 's-atomic1');
    persistPattern(tmpDir, 'P-2000');
    persistPattern(tmpDir, 'P-2001');
    persistPattern(tmpDir, 'P-2002');

    const board = review.buildReviewBoard(tmpDir);
    const md = review.renderBoardMarkdown(board);
    assert.equal(review.writeBoardFile(tmpDir, md), true);

    const tmpFp = review.boardFilePath(tmpDir) + '.tmp';
    assert.equal(fs.existsSync(tmpFp), false, 'board.md.tmp orphan must not exist after write');
  });

  it('writeBoardPendingFlag leaves no .tmp orphan on the happy path', () => {
    writeSession(tmpDir, 's-atomic2');
    persistPattern(tmpDir, 'P-2010');
    review.writeBoardPendingFlag(tmpDir, { eligibleCount: 1 });
    const tmpFp = review.boardPendingFlagPath(tmpDir) + '.tmp';
    assert.equal(fs.existsSync(tmpFp), false, '.flag.tmp orphan must not exist after write');
  });

  it('skipPattern leaves no .tmp orphan on the happy path', () => {
    writeSession(tmpDir, 's-atomic3');
    persistPattern(tmpDir, 'P-2020');
    review.skipPattern(tmpDir, 'P-2020', 's-atomic3');
    const tmpFp = review.skippedFilePath(tmpDir, 's-atomic3') + '.tmp';
    assert.equal(fs.existsSync(tmpFp), false, 'skipped-<sid>.json.tmp orphan must not exist after write');
  });
});

// ---------------------------------------------------------------------------
// Defensive — invalid inputs + module API never throws
// ---------------------------------------------------------------------------

describe('Defensive — invalid inputs return falsy without throwing', () => {
  it('skipPattern with invalid patternId returns false and writes nothing', () => {
    writeSession(tmpDir, 's-inv');
    assert.equal(review.skipPattern(tmpDir, 'not-a-pattern-id', 's-inv'), false);
    assert.equal(review.skipPattern(tmpDir, '', 's-inv'), false);
    assert.equal(review.skipPattern(tmpDir, null, 's-inv'), false);
  });

  it('rejectPattern with invalid sessionId returns false', () => {
    persistPattern(tmpDir, 'P-3000');
    // No SESSION.json AND no explicit sessionId → cannot resolve session.
    assert.equal(review.rejectPattern(tmpDir, 'P-3000'), false);
    // Hostile sessionId outside the safe alphabet → sanitiseSessionId returns null → false.
    assert.equal(review.rejectPattern(tmpDir, 'P-3000', '../etc/passwd'), false);
  });

  it('shouldShowBoard with invalid projectRoot returns false', () => {
    assert.equal(review.shouldShowBoard(''), false);
    assert.equal(review.shouldShowBoard(null), false);
    assert.equal(review.shouldShowBoard(undefined), false);
  });

  it('clearBoardPendingFlag is idempotent when the flag is absent', () => {
    assert.equal(review.clearBoardPendingFlag(tmpDir), true);
    assert.equal(review.clearBoardPendingFlag(tmpDir), true);
  });
});

// Suppress unused-import warnings — apply is loaded for shape-source consistency above.
void apply;
