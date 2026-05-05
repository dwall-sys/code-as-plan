'use strict';

// @cap-feature(feature:F-072) Adversarial tests for the Two-Layer Fitness Score module.
//                  AC-7 determinism (same inputs → byte-identical FitnessRecord; iteration-order
//                  independence; no time-based gates in formulas), edge cases (zero-signal, n
//                  crossing 5, evidence.candidateId === null defensive fallback, performance probe
//                  on 100 patterns × 1000 signals).
//                  Mirrors F-070 / F-071 patterns: real temp dirs, no fs mocking, byte-level disk
//                  assertions where determinism matters.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const fitness = require('../cap/bin/lib/cap-fitness-score.cjs');
const learning = require('../cap/bin/lib/cap-learning-signals.cjs');
const pipeline = require('../cap/bin/lib/cap-pattern-pipeline.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fitness-adv-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function persistFeaturePattern(root, id, overrides) {
  const ov = overrides || {};
  const pattern = {
    id,
    createdAt: '2026-05-05T00:00:00.000Z',
    level: 'L1',
    featureRef: ov.featureRef === undefined ? 'F-100' : ov.featureRef,
    source: 'heuristic',
    degraded: true,
    confidence: 0.5,
    suggestion: { kind: 'L1', target: 'F-100/threshold', from: 3, to: 5, rationale: 'test' },
    evidence: ov.evidence || { candidateId: null, signalType: 'override', count: 0, topContextHashes: [] },
  };
  pipeline.recordPatternSuggestion(root, pattern);
  return pattern;
}

/**
 * Deterministic shuffle — Fisher-Yates seeded with a fixed key. AC-7 forbids
 * Math.random anywhere in the module; tests are allowed to use it but we use a
 * seeded shuffle so a flake here is reproducible.
 */
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  // xorshift32
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/**
 * Strip the persisted ts (which legitimately enters via options.now) so byte-equal
 * comparisons across runs aren't sensitive to wall-clock between calls.
 */
function stripTs(record) {
  if (!record) return record;
  return {
    id: record.id,
    patternId: record.patternId,
    layer1: record.layer1,
    layer2: record.layer2,
    activeSessions: record.activeSessions,
    lastSeenSessionId: record.lastSeenSessionId,
    lastSeenAt: record.lastSeenAt,
    expired: record.expired,
    evidence: record.evidence,
  };
}

// ---------------------------------------------------------------------------
// AC-7 — Determinism: 10 runs on the same fixture produce deepEqual records
// ---------------------------------------------------------------------------

describe('AC-7 adversarial · 10× compute on same fixture is deepEqual', () => {
  // @cap-todo(ac:F-072/AC-7) Pure compute, deterministic — same inputs → same output.
  it('computeFitness called 10 times produces byte-equal records (modulo ts)', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    for (let i = 0; i < 10; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: `s-${i % 3}`,
        featureId: 'F-100',
        targetFile: `/file-${i}.cjs`,
        ts: `2026-05-05T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
      learning.recordMemoryRef({
        projectRoot: tmpDir,
        sessionId: `s-${i % 3}`,
        featureId: 'F-100',
        memoryFile: `.cap/memory/file-${i}.md`,
        ts: `2026-05-05T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
    }

    const fixedNow = '2026-05-05T12:00:00.000Z';
    const first = fitness.computeFitness(tmpDir, 'P-001', { now: fixedNow });
    for (let i = 0; i < 10; i++) {
      const r = fitness.computeFitness(tmpDir, 'P-001', { now: fixedNow });
      assert.deepStrictEqual(r, first, `run #${i + 1} diverged from the first run — determinism violated`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-7 — Iteration-order independence: shuffled JSONLs produce identical records
// ---------------------------------------------------------------------------

describe('AC-7 adversarial · iteration-order independence', () => {
  it('shuffling the override JSONL line-order produces a byte-identical FitnessRecord', () => {
    persistFeaturePattern(tmpDir, 'P-001');

    // Seed a varied corpus.
    for (let i = 0; i < 12; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: `s-${i % 4}`,
        featureId: 'F-100',
        targetFile: `/path-${i}.cjs`,
        ts: `2026-05-05T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
      learning.recordMemoryRef({
        projectRoot: tmpDir,
        sessionId: `s-${i % 4}`,
        featureId: 'F-100',
        memoryFile: `.cap/memory/m-${i}.md`,
        ts: `2026-05-05T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
      learning.recordRegret({
        projectRoot: tmpDir,
        sessionId: `s-${i % 4}`,
        featureId: 'F-100',
        decisionId: `F-100/D${i}`,
        ts: `2026-05-05T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
    }

    const fixedNow = '2026-05-05T12:00:00.000Z';
    const baseline = fitness.computeFitness(tmpDir, 'P-001', { now: fixedNow });

    // Now physically reorder the JSONL files on disk and re-compute.
    const reorder = (file, seed) => {
      const fp = path.join(tmpDir, '.cap', 'learning', 'signals', file);
      const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
      const shuffled = seededShuffle(lines, seed);
      fs.writeFileSync(fp, shuffled.join('\n') + '\n');
    };
    reorder('overrides.jsonl', 0xDEADBEEF);
    reorder('memory-refs.jsonl', 0xC0FFEE);
    reorder('regrets.jsonl', 0xFEEDFACE);

    const reshuffled = fitness.computeFitness(tmpDir, 'P-001', { now: fixedNow });
    assert.deepStrictEqual(stripTs(reshuffled), stripTs(baseline),
      'reordering signal lines must not affect the FitnessRecord');
  });

  it('listFitnessExpired returns sorted ascending — output order is deterministic', () => {
    persistFeaturePattern(tmpDir, 'P-003');
    persistFeaturePattern(tmpDir, 'P-001', { featureRef: 'F-200' });
    persistFeaturePattern(tmpDir, 'P-002', { featureRef: 'F-300' });
    // 25 sessions of OTHER-feature signals → all three patterns expire.
    for (let i = 0; i < 25; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: `s-${String(i).padStart(2, '0')}`,
        featureId: 'F-OTHER',
        targetFile: `/o.cjs`,
        ts: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
    const expired = fitness.listFitnessExpired(tmpDir);
    assert.deepEqual(expired, ['P-001', 'P-002', 'P-003'], 'output must be ascending-sorted');
  });
});

// ---------------------------------------------------------------------------
// AC-7 — No time-based gates in formulas
// ---------------------------------------------------------------------------

describe('AC-7 adversarial · formulas are free of wall-clock dependencies', () => {
  it('options.now affects ONLY the persisted ts, never layer1/layer2/n/lastSeen*', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's-1',
      featureId: 'F-100',
      targetFile: '/x.cjs',
      ts: '2026-05-05T00:00:00.000Z',
    });

    const r1 = fitness.computeFitness(tmpDir, 'P-001', { now: '2026-01-01T00:00:00.000Z' });
    const r2 = fitness.computeFitness(tmpDir, 'P-001', { now: '2099-12-31T23:59:59.000Z' });

    assert.notEqual(r1.ts, r2.ts, 'ts is allowed to differ between calls');
    assert.deepStrictEqual(r1.layer1, r2.layer1);
    assert.deepStrictEqual(r1.layer2, r2.layer2);
    assert.equal(r1.activeSessions, r2.activeSessions);
    assert.equal(r1.lastSeenSessionId, r2.lastSeenSessionId);
    assert.equal(r1.lastSeenAt, r2.lastSeenAt);
    assert.equal(r1.expired, r2.expired);
    assert.deepStrictEqual(r1.evidence, r2.evidence);
  });
});

// ---------------------------------------------------------------------------
// Edge case — Pattern with zero matching signals
// ---------------------------------------------------------------------------

describe('edge · zero matching signals', () => {
  it('layer1=0, layer2.value=0, n=0, ready=false; never NaN, never throws', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    // Some unrelated signals exist but none match the F-100 pattern.
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's-1',
      featureId: 'F-OTHER',
      targetFile: '/x.cjs',
    });

    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer1.value, 0);
    assert.equal(r.layer2.value, 0);
    assert.ok(Number.isFinite(r.layer2.value), 'value must never NaN');
    assert.equal(r.layer2.n, 0);
    assert.equal(r.layer2.ready, false);
    assert.equal(r.activeSessions, 0);
    assert.equal(r.lastSeenSessionId, null);
    assert.equal(r.lastSeenAt, null);
  });
});

// ---------------------------------------------------------------------------
// Edge case — Pattern with evidence.candidateId === null → fallback path
// ---------------------------------------------------------------------------

describe('edge · evidence.candidateId === null → defensive featureRef fallback (D1)', () => {
  it('candidateId-null pattern matches via featureRef', () => {
    persistFeaturePattern(tmpDir, 'P-001', {
      evidence: { candidateId: null, signalType: 'override', count: 0, topContextHashes: [] },
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's-1',
      featureId: 'F-100',
      targetFile: '/x.cjs',
    });
    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer1.value, 1, 'fallback path catches the F-100 override');
  });

  it('candidateId-set pattern (LLM-promoted) matches via candidate-feature path', () => {
    // Mimic a properly-promoted pattern: candidateId is hex, evidence.featureId is set,
    // contextHash anchor present.
    persistFeaturePattern(tmpDir, 'P-001', {
      evidence: {
        candidateId: 'deadbeef00112233',
        signalType: 'override',
        count: 4,
        featureId: 'F-100',
        topContextHashes: [{ hash: 'abc123', count: 4 }],
      },
    });
    // F-100 override w/ matching contextHash — primary path wins.
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's-1',
      featureId: 'F-100',
      contextHash: 'abc123',
    });
    // F-OTHER override — should NOT match.
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's-1',
      featureId: 'F-OTHER',
      contextHash: 'abc123',
    });
    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer1.value, 1, 'only the F-100 override is on the candidate territory');
  });
});

// ---------------------------------------------------------------------------
// Edge case — n crosses 5 between two recordFitness calls (D2 transition)
// ---------------------------------------------------------------------------

describe('edge · n crossing the 5-session threshold flips ready false → true', () => {
  it('first recordFitness: ready=false; after 5th distinct session: ready=true on next call', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    // Seed 4 sessions of memory-refs.
    for (let i = 0; i < 4; i++) {
      learning.recordMemoryRef({
        projectRoot: tmpDir,
        sessionId: `s-${i}`,
        featureId: 'F-100',
        memoryFile: '.cap/memory/x.md',
      });
    }
    fitness.recordFitness(tmpDir, 'P-001');
    let r = fitness.getFitness(tmpDir, 'P-001');
    assert.equal(r.layer2.n, 4);
    assert.equal(r.layer2.ready, false);

    // Add the 5th distinct session.
    learning.recordMemoryRef({
      projectRoot: tmpDir,
      sessionId: 's-4',
      featureId: 'F-100',
      memoryFile: '.cap/memory/x.md',
    });

    fitness.recordFitness(tmpDir, 'P-001');
    r = fitness.getFitness(tmpDir, 'P-001');
    assert.equal(r.layer2.n, 5);
    assert.equal(r.layer2.ready, true, 'crossing 5 active sessions must flip ready to true');
  });
});

// ---------------------------------------------------------------------------
// Edge case — recordApplySnapshot twice in same session → two append-only lines
// ---------------------------------------------------------------------------

describe('edge · recordApplySnapshot is append-only across same-session calls (D5)', () => {
  it('two snapshot calls in same session produce two distinct JSONL lines', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's-1',
      featureId: 'F-100',
      targetFile: '/x.cjs',
    });
    fitness.recordApplySnapshot(tmpDir, 'P-001', { now: '2026-05-05T10:00:00.000Z' });
    fitness.recordApplySnapshot(tmpDir, 'P-001', { now: '2026-05-05T11:00:00.000Z' });

    const fp = path.join(tmpDir, '.cap', 'learning', 'fitness', 'P-001.snapshots.jsonl');
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2, 'append-only → two lines, not one overwrite');
    const t1 = JSON.parse(lines[0]).ts;
    const t2 = JSON.parse(lines[1]).ts;
    assert.equal(t1, '2026-05-05T10:00:00.000Z');
    assert.equal(t2, '2026-05-05T11:00:00.000Z');
  });

  it('snapshot.activeSessionsList is sorted (D6)', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    // Seed sessions in non-alphabetic order to provoke an unsorted Set.values() iteration.
    const seedOrder = ['s-zeta', 's-alpha', 's-mu', 's-beta', 's-omega'];
    for (const sid of seedOrder) {
      learning.recordMemoryRef({
        projectRoot: tmpDir,
        sessionId: sid,
        featureId: 'F-100',
        memoryFile: '.cap/memory/x.md',
      });
    }
    const snap = fitness.recordApplySnapshot(tmpDir, 'P-001');
    const sortedExpected = [...seedOrder].sort();
    assert.deepEqual(snap.activeSessionsList, sortedExpected, 'list must be lexicographically sorted');
  });
});

// ---------------------------------------------------------------------------
// Performance probe — runFitnessPass on 100 patterns × 1000 signals
// ---------------------------------------------------------------------------

describe('performance · runFitnessPass on 100 patterns × 1000 signals < 500ms', () => {
  it('completes within the 500ms budget', () => {
    // 100 patterns spread across 100 distinct featureRefs.
    for (let p = 0; p < 100; p++) {
      const fid = `F-${String(100 + p).padStart(3, '0')}`;
      const pid = `P-${String(p + 1).padStart(3, '0')}`;
      persistFeaturePattern(tmpDir, pid, { featureRef: fid });
    }
    // 1000 signals spread across the 100 features (10 sessions each).
    for (let i = 0; i < 1000; i++) {
      const fid = `F-${String(100 + (i % 100)).padStart(3, '0')}`;
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: `s-${i % 50}`,
        featureId: fid,
        targetFile: `/file-${i % 200}.cjs`,
      });
    }

    const t0 = process.hrtime.bigint();
    const result = fitness.runFitnessPass(tmpDir);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    assert.equal(result.recorded.length, 100, 'all 100 patterns processed');
    assert.deepEqual(result.errors, []);
    assert.ok(ms < 500, `runFitnessPass took ${ms.toFixed(1)}ms on 100×1000 (>500ms budget)`);
  });
});

// ---------------------------------------------------------------------------
// AC-3 cross-module — Rolling-30 vs Lifetime aggregates
// ---------------------------------------------------------------------------

describe('AC-3 adversarial · snapshots provide rolling history; record provides lifetime view', () => {
  // @cap-decision(F-072) Lifetime aggregate = the persisted .json record (every signal across all
  //                 sessions). Rolling history = the sequence of .snapshots.jsonl lines produced
  //                 over time as F-073 calls recordApplySnapshot. Together they satisfy AC-3's
  //                 "Rolling-30 AND Lifetime simultaneously" contract — rolling is by-snapshot
  //                 not by-session-window, because F-074 cares about pre-apply vs post-apply, not
  //                 about the last 30 sessions in isolation.
  it('lifetime layer2.n grows monotonically across sessions; snapshot tail captures the trajectory', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    // Two-phase trajectory: 3 sessions, snapshot, then 3 more sessions, snapshot.
    for (let i = 0; i < 3; i++) {
      learning.recordMemoryRef({
        projectRoot: tmpDir,
        sessionId: `s-${i}`,
        featureId: 'F-100',
        memoryFile: '.cap/memory/x.md',
      });
    }
    fitness.recordApplySnapshot(tmpDir, 'P-001');
    for (let i = 3; i < 6; i++) {
      learning.recordMemoryRef({
        projectRoot: tmpDir,
        sessionId: `s-${i}`,
        featureId: 'F-100',
        memoryFile: '.cap/memory/x.md',
      });
    }
    fitness.recordApplySnapshot(tmpDir, 'P-001');

    const fp = path.join(tmpDir, '.cap', 'learning', 'fitness', 'P-001.snapshots.jsonl');
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assert.equal(first.n, 3);
    assert.equal(second.n, 6, 'second snapshot reflects the full lifetime activity');
    assert.equal(first.layer2.ready, false, 'pre-threshold');
    assert.equal(second.layer2.ready, true, 'post-threshold (≥5 active sessions)');
  });
});
