'use strict';

// @cap-feature(feature:F-073) Baseline tests for the Pattern Review Board module — AC-1
//                  (eligibility composition), AC-2 (threshold gate), AC-3 (board-pending flag
//                  round-trip), AC-4 (skip per-session + idempotent), AC-5 (stale archive +
//                  insufficient-history short-circuit), AC-6 (Approve/Reject/Skip + Unlearn
//                  when retract-recommended). Adversarial edge cases (skip+reject coexistence,
//                  byte-level needle smuggling, Stop-hook subprocess wiring) live in
//                  cap-learn-review-adversarial.test.cjs.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const review = require('../cap/bin/lib/cap-learn-review.cjs');
const pipeline = require('../cap/bin/lib/cap-pattern-pipeline.cjs');
const fitness = require('../cap/bin/lib/cap-fitness-score.cjs');
const apply = require('../cap/bin/lib/cap-pattern-apply.cjs');
const learning = require('../cap/bin/lib/cap-learning-signals.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-learn-review-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers — persist patterns / fitness / apply state via real module APIs.
// We never write the cap-learn-review module's outputs by hand; the tests
// always exercise the public API surface.
// ---------------------------------------------------------------------------

function writeSession(root, sessionId) {
  const dir = path.join(root, '.cap');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SESSION.json'), JSON.stringify({
    sessionId,
    activeFeature: 'F-073',
  }));
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

/**
 * Persist a fitness record at a layer-2 reading high enough to qualify as
 * "high-confidence" under D4: layer2.ready=true, value>=0.75, n>=5.
 */
function persistHighConfidenceFitness(root, id) {
  const dir = path.join(root, '.cap', 'learning', 'fitness');
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    id,
    patternId: id,
    ts: '2026-05-05T01:00:00.000Z',
    layer1: { kind: 'override-count', value: 1, lastSessionId: 's-1' },
    layer2: { kind: 'weighted-average', value: 0.9, n: 6, ready: true },
    activeSessions: 6,
    lastSeenSessionId: 's-1',
    lastSeenAt: '2026-05-05T01:00:00.000Z',
    expired: false,
    evidence: { candidateId: null, featureRef: 'F-100' },
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2) + '\n');
  return record;
}

/**
 * Persist a fitness record that is NOT high-confidence (ready=false).
 */
function persistLowConfidenceFitness(root, id) {
  const dir = path.join(root, '.cap', 'learning', 'fitness');
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    id,
    patternId: id,
    ts: '2026-05-05T01:00:00.000Z',
    layer1: { kind: 'override-count', value: 0, lastSessionId: 's-1' },
    layer2: { kind: 'weighted-average', value: 0.2, n: 2, ready: false },
    activeSessions: 2,
    lastSeenSessionId: 's-1',
    lastSeenAt: '2026-05-05T01:00:00.000Z',
    expired: false,
    evidence: { candidateId: null, featureRef: 'F-100' },
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2) + '\n');
  return record;
}

/**
 * Persist an "applied" audit record so the eligibility filter excludes the id.
 * We bypass git/commit by writing the audit JSON directly — F-073 only reads
 * apply state via listAppliedPatterns / listUnlearnedPatterns.
 */
function persistAppliedAudit(root, id) {
  const fp = apply.appliedAuditPath(root, id);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const audit = {
    id, patternId: id, appliedAt: '2026-05-05T02:00:00.000Z',
    applyState: 'committed', level: 'L1', featureRef: 'F-100',
    commitHash: 'deadbee', targetFiles: [], fitnessSnapshot: null,
    beforeAfterDiff: { L1: { key: 'F-100/threshold', from: 3, to: 5, hadPrior: false } },
  };
  fs.writeFileSync(fp, JSON.stringify(audit, null, 2) + '\n');
  return audit;
}

function persistUnlearnedAudit(root, id) {
  const fp = apply.unlearnedAuditPath(root, id);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const audit = {
    id, patternId: id, unlearnedAt: '2026-05-05T03:00:00.000Z',
    reason: 'manual', commitHash: 'beefcaf', appliedCommitHash: 'deadbee',
  };
  fs.writeFileSync(fp, JSON.stringify(audit, null, 2) + '\n');
  return audit;
}

/**
 * Seed N distinct sessions in the override corpus so the AC-5 stale archive
 * has enough history to NOT short-circuit. Each call uses a unique session id.
 */
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

// ---------------------------------------------------------------------------
// AC-2 — shouldShowBoard threshold gate
// ---------------------------------------------------------------------------

describe('AC-2 — shouldShowBoard threshold gate (D4)', () => {
  // @cap-todo(ac:F-073/AC-2) Below threshold returns false.
  it('returns false on an empty project (no patterns persisted)', () => {
    writeSession(tmpDir, 's-1');
    assert.equal(review.shouldShowBoard(tmpDir), false);
  });

  // @cap-todo(ac:F-073/AC-2) >=3 candidates of any kind clears the gate.
  it('returns true with exactly 3 eligible patterns (any-kind threshold)', () => {
    writeSession(tmpDir, 's-1');
    persistPattern(tmpDir, 'P-001');
    persistPattern(tmpDir, 'P-002');
    persistPattern(tmpDir, 'P-003');
    assert.equal(review.shouldShowBoard(tmpDir), true);
  });

  // @cap-todo(ac:F-073/AC-2) High-confidence Layer-2 reading clears the gate even with 1 pattern.
  it('returns true with 1 high-confidence pattern (layer2.ready, value>=0.75, n>=5)', () => {
    writeSession(tmpDir, 's-1');
    persistPattern(tmpDir, 'P-007');
    persistHighConfidenceFitness(tmpDir, 'P-007');
    assert.equal(review.shouldShowBoard(tmpDir), true);
  });

  it('returns false with 1 low-confidence pattern (layer2.ready=false)', () => {
    writeSession(tmpDir, 's-1');
    persistPattern(tmpDir, 'P-008');
    persistLowConfidenceFitness(tmpDir, 'P-008');
    assert.equal(review.shouldShowBoard(tmpDir), false);
  });
});

// ---------------------------------------------------------------------------
// AC-1 — buildReviewBoard eligibility composition
// ---------------------------------------------------------------------------

describe('AC-1 — buildReviewBoard eligibility (persisted ∧ ¬applied ∧ ¬unlearned ∧ ¬archived ∧ ¬skipped/rejected)', () => {
  // @cap-todo(ac:F-073/AC-1) Pending = persisted ∧ ¬applied ∧ ¬unlearned ∧ ¬archived ∧ ¬skipped ∧ ¬rejected.
  it('excludes patterns that are already applied', () => {
    writeSession(tmpDir, 's-1');
    persistPattern(tmpDir, 'P-001');
    persistPattern(tmpDir, 'P-002');
    persistPattern(tmpDir, 'P-003');
    persistAppliedAudit(tmpDir, 'P-002');

    const board = review.buildReviewBoard(tmpDir);
    const ids = board.eligible.map((e) => e.patternId);
    assert.deepEqual(ids.sort(), ['P-001', 'P-003']);
  });

  it('excludes patterns that have been unlearned', () => {
    writeSession(tmpDir, 's-1');
    persistPattern(tmpDir, 'P-010');
    persistPattern(tmpDir, 'P-011');
    persistUnlearnedAudit(tmpDir, 'P-010');

    const board = review.buildReviewBoard(tmpDir);
    const ids = board.eligible.map((e) => e.patternId);
    assert.deepEqual(ids.sort(), ['P-011']);
  });

  it('excludes patterns archived this run (archive directory listing)', () => {
    writeSession(tmpDir, 's-1');
    persistPattern(tmpDir, 'P-020');
    persistPattern(tmpDir, 'P-021');
    // Pre-write the archive entry directly — F-073 reads the archive directory.
    const archiveDir = path.join(tmpDir, '.cap', 'learning', 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(
      path.join(archiveDir, 'P-021.json'),
      JSON.stringify({ id: 'P-021', archivedAt: '2026-05-05T00:00:00.000Z', reason: 'stale-7-sessions' }),
    );

    const board = review.buildReviewBoard(tmpDir);
    const ids = board.eligible.map((e) => e.patternId);
    assert.deepEqual(ids, ['P-020']);
  });

  it('excludes ids previously skipped in the current session', () => {
    writeSession(tmpDir, 's-skip');
    persistPattern(tmpDir, 'P-040');
    persistPattern(tmpDir, 'P-041');
    review.skipPattern(tmpDir, 'P-040', 's-skip');
    const board = review.buildReviewBoard(tmpDir, { sessionId: 's-skip' });
    const ids = board.eligible.map((e) => e.patternId);
    assert.deepEqual(ids, ['P-041']);
  });

  it('attaches Approve/Reject/Skip options to every eligible pattern (no Unlearn when not retract-recommended)', () => {
    writeSession(tmpDir, 's-1');
    persistPattern(tmpDir, 'P-050');
    persistPattern(tmpDir, 'P-051');
    persistPattern(tmpDir, 'P-052');

    const board = review.buildReviewBoard(tmpDir);
    for (const e of board.eligible) {
      assert.deepEqual(e.options, ['Approve', 'Reject', 'Skip']);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-4 — skipPattern persistence + idempotency
// ---------------------------------------------------------------------------

describe('AC-4 — skipPattern is per-session + idempotent', () => {
  // @cap-todo(ac:F-073/AC-4) Skip persists to skipped-<sessionId>.json with schema {sessionId,ts,patternIds:[...]}.
  it('writes .cap/learning/skipped-<sid>.json with the documented schema', () => {
    writeSession(tmpDir, 's-skipschema');
    persistPattern(tmpDir, 'P-200');
    assert.equal(review.skipPattern(tmpDir, 'P-200', 's-skipschema'), true);

    const fp = review.skippedFilePath(tmpDir, 's-skipschema');
    assert.ok(fs.existsSync(fp));
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.equal(parsed.sessionId, 's-skipschema');
    assert.ok(typeof parsed.ts === 'string' && parsed.ts.length > 0);
    assert.deepEqual(parsed.patternIds, ['P-200']);
  });

  it('second call with same id leaves the file content unchanged byte-for-byte (idempotent)', () => {
    writeSession(tmpDir, 's-idem');
    persistPattern(tmpDir, 'P-201');

    review.skipPattern(tmpDir, 'P-201', 's-idem');
    const fp = review.skippedFilePath(tmpDir, 's-idem');
    const before = fs.readFileSync(fp, 'utf8');

    review.skipPattern(tmpDir, 'P-201', 's-idem');
    const after = fs.readFileSync(fp, 'utf8');
    assert.equal(after, before, 'second skipPattern must not mutate the file (idempotent)');
  });

  it('a second pattern id appends to the same session file', () => {
    writeSession(tmpDir, 's-multi');
    persistPattern(tmpDir, 'P-210');
    persistPattern(tmpDir, 'P-211');
    review.skipPattern(tmpDir, 'P-210', 's-multi');
    review.skipPattern(tmpDir, 'P-211', 's-multi');
    const ids = review.loadSkippedThisSession(tmpDir, 's-multi');
    assert.deepEqual(ids, ['P-210', 'P-211']);
  });

  it('rejectPattern uses the rejected file (not skipped), but mirrors the schema', () => {
    writeSession(tmpDir, 's-rej');
    persistPattern(tmpDir, 'P-220');
    review.rejectPattern(tmpDir, 'P-220', 's-rej');
    const fp = review.rejectedFilePath(tmpDir, 's-rej');
    assert.ok(fs.existsSync(fp));
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.equal(parsed.sessionId, 's-rej');
    assert.deepEqual(parsed.patternIds, ['P-220']);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — archiveStalePatterns
// ---------------------------------------------------------------------------

describe('AC-5 — archiveStalePatterns (>7 distinct sessions since createdAt → archive; <7 corpus → short-circuit)', () => {
  // @cap-todo(ac:F-073/AC-5) Insufficient-history short-circuit: corpus < 7 sessions → no archive.
  it('does NOT archive anything when the corpus has fewer than 7 distinct sessions (short-circuit)', () => {
    writeSession(tmpDir, 's-now');
    persistPattern(tmpDir, 'P-300', { createdAt: '2025-01-01T00:00:00.000Z' });
    seedSessions(tmpDir, 3); // only 3 distinct sessions

    const result = review.archiveStalePatterns(tmpDir);
    assert.deepEqual(result.archived, []);
    assert.deepEqual(result.errors, []);

    // Pattern is still in patterns/ — no archive happened.
    const sourcePath = path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-300.json');
    assert.ok(fs.existsSync(sourcePath));
  });

  // @cap-todo(ac:F-073/AC-5) Archive moves un-reviewed > 7 sessions patterns and removes from patterns/.
  it('archives a pattern whose distinct-session reach since createdAt exceeds the threshold', () => {
    writeSession(tmpDir, 's-now');
    // 8 distinct sessions seeded, all AFTER the pattern's createdAt → reach=8 > 7.
    persistPattern(tmpDir, 'P-310', { createdAt: '2025-01-01T00:00:00.000Z' });
    seedSessions(tmpDir, 8, '2026-04-01T00:00:00.000Z');

    const result = review.archiveStalePatterns(tmpDir);
    assert.deepEqual(result.archived, ['P-310']);

    // archive/<P>.json exists with archivedAt + reason.
    const archivePath = review.archiveFilePath(tmpDir, 'P-310');
    assert.ok(fs.existsSync(archivePath));
    const archiveRecord = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    assert.equal(archiveRecord.id, 'P-310');
    assert.equal(archiveRecord.reason, 'stale-7-sessions');
    assert.ok(typeof archiveRecord.archivedAt === 'string' && archiveRecord.archivedAt.length > 0);

    // Source patterns/<P>.json is gone.
    const sourcePath = path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-310.json');
    assert.equal(fs.existsSync(sourcePath), false, 'source pattern file must be removed after archive');
  });

  it('does NOT archive patterns that are already applied (still on the apply trail)', () => {
    writeSession(tmpDir, 's-now');
    persistPattern(tmpDir, 'P-320', { createdAt: '2025-01-01T00:00:00.000Z' });
    persistAppliedAudit(tmpDir, 'P-320');
    seedSessions(tmpDir, 8);

    const result = review.archiveStalePatterns(tmpDir);
    assert.deepEqual(result.archived, []);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — board-pending flag round-trip
// ---------------------------------------------------------------------------

describe('AC-3 — writeBoardPendingFlag + clearBoardPendingFlag round-trip', () => {
  // @cap-todo(ac:F-073/AC-3) The flag file is the Stop-hook → skill bridge.
  it('writeBoardPendingFlag creates the flag; clearBoardPendingFlag removes it', () => {
    writeSession(tmpDir, 's-flag');
    persistPattern(tmpDir, 'P-400');
    persistPattern(tmpDir, 'P-401');
    persistPattern(tmpDir, 'P-402');

    assert.equal(review.hasBoardPendingFlag(tmpDir), false);
    assert.equal(review.writeBoardPendingFlag(tmpDir, { eligibleCount: 3 }), true);
    assert.equal(review.hasBoardPendingFlag(tmpDir), true);

    // Flag content carries diagnostic fields (ts, sessionId, eligibleCount).
    const fp = review.boardPendingFlagPath(tmpDir);
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.ok(typeof parsed.ts === 'string');
    assert.equal(parsed.sessionId, 's-flag');
    assert.equal(parsed.eligibleCount, 3);

    assert.equal(review.clearBoardPendingFlag(tmpDir), true);
    assert.equal(review.hasBoardPendingFlag(tmpDir), false);

    // Idempotent: clearing again returns true (no-op).
    assert.equal(review.clearBoardPendingFlag(tmpDir), true);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — Unlearn label appears for retract-recommended patterns
// ---------------------------------------------------------------------------

describe('AC-6 — Unlearn option for retract-recommended patterns', () => {
  // @cap-todo(ac:F-073/AC-6) When listRetractRecommended() includes id, the board entry's options
  //                          include 'Unlearn' and the renderer adds the 'Rückzug empfohlen' label.
  it('attaches Unlearn to options when the id is in F-074 listRetractRecommended()', () => {
    writeSession(tmpDir, 's-rr');
    persistPattern(tmpDir, 'P-500');

    // Seed retract-recommendations.jsonl directly — F-073 reads via listRetractRecommended().
    const rrPath = path.join(tmpDir, '.cap', 'learning', 'retract-recommendations.jsonl');
    fs.mkdirSync(path.dirname(rrPath), { recursive: true });
    fs.writeFileSync(rrPath, JSON.stringify({
      ts: '2026-05-05T00:00:00.000Z',
      patternId: 'P-500',
      sessionsSinceApply: 5,
      snapshot: 1,
      current: 3,
      reason: 'override-rate-worse',
    }) + '\n');

    const board = review.buildReviewBoard(tmpDir);
    const entry = board.eligible.find((e) => e.patternId === 'P-500');
    assert.ok(entry, 'P-500 should be eligible');
    assert.equal(entry.retractRecommended, true);
    assert.deepEqual(entry.options, ['Approve', 'Reject', 'Skip', 'Unlearn']);
  });

  it('renderBoardMarkdown includes the "Rückzug empfohlen" label only when retractRecommended', () => {
    writeSession(tmpDir, 's-rrlabel');
    persistPattern(tmpDir, 'P-510'); // not in retract list
    persistPattern(tmpDir, 'P-511');
    const rrPath = path.join(tmpDir, '.cap', 'learning', 'retract-recommendations.jsonl');
    fs.mkdirSync(path.dirname(rrPath), { recursive: true });
    fs.writeFileSync(rrPath, JSON.stringify({ ts: '2026-05-05T00:00:00.000Z', patternId: 'P-511' }) + '\n');

    const board = review.buildReviewBoard(tmpDir);
    const md = review.renderBoardMarkdown(board);

    // P-511 must carry the label; P-510 must not.
    const sec510 = md.split('## P-510')[1] || '';
    const sec511 = md.split('## P-511')[1] || '';
    // sections are split on the next '## ' header; clamp to the section we want.
    const sec510Body = sec510.split(/\n## /)[0];
    const sec511Body = sec511.split(/\n## /)[0];
    assert.ok(sec511Body.includes('Rückzug empfohlen'), 'P-511 section must contain the label');
    assert.ok(!sec510Body.includes('Rückzug empfohlen'), 'P-510 section must NOT contain the label');
  });
});

// ---------------------------------------------------------------------------
// renderBoardMarkdown + writeBoardFile happy path
// ---------------------------------------------------------------------------

describe('renderBoardMarkdown + writeBoardFile happy path (atomic write contract)', () => {
  it('renderBoardMarkdown produces non-empty output that lists every eligible patternId', () => {
    writeSession(tmpDir, 's-render');
    persistPattern(tmpDir, 'P-600');
    persistPattern(tmpDir, 'P-601');

    const board = review.buildReviewBoard(tmpDir);
    const md = review.renderBoardMarkdown(board);
    assert.ok(md.length > 0);
    assert.ok(md.includes('P-600'));
    assert.ok(md.includes('P-601'));
    assert.ok(md.includes('# Pattern Review Board'));
  });

  it('writeBoardFile lands at .cap/learning/board.md and round-trips bytewise', () => {
    writeSession(tmpDir, 's-write');
    persistPattern(tmpDir, 'P-700');

    const board = review.buildReviewBoard(tmpDir);
    const md = review.renderBoardMarkdown(board);
    assert.equal(review.writeBoardFile(tmpDir, md), true);

    const fp = review.boardFilePath(tmpDir);
    assert.ok(fs.existsSync(fp));
    assert.equal(fs.readFileSync(fp, 'utf8'), md);
  });
});

// ---------------------------------------------------------------------------
// Smoke — confidenceFromFitness + triggerReasonFor
// ---------------------------------------------------------------------------

describe('Helper smoke tests — confidenceFromFitness + triggerReasonFor', () => {
  it('confidenceFromFitness prefers pattern.confidence when in range [0,1]', () => {
    const c = review.confidenceFromFitness({ confidence: 0.83 }, null);
    assert.equal(c, 0.83);
  });

  it('confidenceFromFitness falls back to layer2.value when pattern.confidence is missing', () => {
    const c = review.confidenceFromFitness({}, { layer2: { value: 0.42 } });
    assert.equal(c, 0.42);
  });

  it('triggerReasonFor surfaces signalType + featureRef + count', () => {
    const reason = review.triggerReasonFor({
      featureRef: 'F-100',
      evidence: { signalType: 'override', count: 5 },
    });
    assert.ok(reason.includes('override'));
    assert.ok(reason.includes('F-100'));
    assert.ok(reason.includes('n=5'));
  });
});

// Suppress unused-import warnings — fitness/apply/learning are loaded for side-effect tests above.
void fitness;
void apply;
void learning;
