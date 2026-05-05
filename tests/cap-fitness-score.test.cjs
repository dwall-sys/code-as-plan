'use strict';

// @cap-feature(feature:F-072) Baseline tests for the Two-Layer Fitness Score module — AC-1, AC-2,
//                  AC-3, AC-4, AC-5, AC-6 happy paths. Determinism (AC-7) + edge cases live in the
//                  adversarial file.

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fitness-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers — seed real signals (via F-070 collectors) and persist a real pattern
// (via F-071's recordPatternSuggestion). Mirrors the F-071 baseline test style.
// ---------------------------------------------------------------------------

function seedOverride(root, opts) {
  const o = opts || {};
  return learning.recordOverride({
    projectRoot: root,
    subType: o.subType || 'editAfterWrite',
    sessionId: o.sessionId || 's-1',
    featureId: o.featureId || 'F-100',
    targetFile: o.targetFile || '/abs/path/file.cjs',
    ts: o.ts,
  });
}

function seedMemoryRef(root, opts) {
  const o = opts || {};
  return learning.recordMemoryRef({
    projectRoot: root,
    sessionId: o.sessionId || 's-1',
    featureId: o.featureId || 'F-100',
    memoryFile: o.memoryFile || '.cap/memory/decisions.md',
    ts: o.ts,
  });
}

function seedRegret(root, opts) {
  const o = opts || {};
  return learning.recordRegret({
    projectRoot: root,
    sessionId: o.sessionId || 's-1',
    featureId: o.featureId || 'F-100',
    decisionId: o.decisionId || 'F-100/D1',
    ts: o.ts,
  });
}

/**
 * Persist a pattern that anchors on featureRef='F-100' (no candidateId →
 * defensive fallback path is exercised). Useful for the bulk of baseline tests
 * because every signal seeded with featureId='F-100' will match.
 */
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

// ---------------------------------------------------------------------------
// AC-1 — Layer 1 Override-COUNT in the most-recent session (D1, D4)
// ---------------------------------------------------------------------------

describe('AC-1 — Layer 1 short-term override-count over the last session', () => {
  // @cap-todo(ac:F-072/AC-1) Override-COUNT (not rate) over the most-recent sessionId.
  it('returns count=N when N overrides matched the pattern in the latest session', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-old' });
    seedOverride(tmpDir, { sessionId: 's-old' });
    seedOverride(tmpDir, { sessionId: 's-latest', ts: '2026-06-01T00:00:00.000Z' });
    seedOverride(tmpDir, { sessionId: 's-latest', ts: '2026-06-01T00:00:01.000Z' });
    seedOverride(tmpDir, { sessionId: 's-latest', ts: '2026-06-01T00:00:02.000Z' });

    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer1.kind, 'override-count');
    assert.equal(r.layer1.value, 3, 'three overrides matched in the latest session');
    assert.equal(r.layer1.lastSessionId, 's-latest');
  });

  it('returns count=0 when there are no overrides at all', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer1.value, 0);
    assert.equal(r.layer1.lastSessionId, null);
  });

  it('only the most-recent sessionId is considered (D4 — no time-window)', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-old', ts: '2026-04-01T00:00:00.000Z' });
    seedOverride(tmpDir, { sessionId: 's-old', ts: '2026-04-01T00:00:01.000Z' });
    seedOverride(tmpDir, { sessionId: 's-new', ts: '2026-05-01T00:00:00.000Z' });

    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer1.lastSessionId, 's-new');
    assert.equal(r.layer1.value, 1, 'old-session overrides do not count toward layer1');
  });

  it('overrides on a different feature do not count (D1 fallback path)', () => {
    persistFeaturePattern(tmpDir, 'P-001'); // featureRef=F-100
    seedOverride(tmpDir, { sessionId: 's-1', featureId: 'F-100' });
    seedOverride(tmpDir, { sessionId: 's-1', featureId: 'F-200' });
    seedOverride(tmpDir, { sessionId: 's-1', featureId: 'F-300' });

    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer1.value, 1, 'only the F-100 override matches the F-100 pattern');
  });
});

// ---------------------------------------------------------------------------
// AC-2 — Layer 2 long-term per-session weighted average; activates at n>=5 (D2)
// ---------------------------------------------------------------------------

describe('AC-2 — Layer 2 weighted-average activates at n >= 5', () => {
  // @cap-todo(ac:F-072/AC-2) Long-term score (memoryRefs*1 + regrets*2) / activeSessions.
  it('value = (memoryRefs*1 + regrets*2) / n; ready=true when n >= 5', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    // Five active sessions: each contributes 1 memory-ref + 1 regret.
    for (let i = 0; i < 5; i++) {
      seedMemoryRef(tmpDir, { sessionId: `s-${i}` });
      seedRegret(tmpDir, { sessionId: `s-${i}` });
    }
    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer2.kind, 'weighted-average');
    assert.equal(r.layer2.n, 5);
    assert.equal(r.layer2.ready, true);
    // 5 memoryRefs (weight 1) + 5 regrets (weight 2) = 15. n = 5 → 15/5 = 3.
    assert.equal(r.layer2.value, 3);
  });

  it('ready=false when n < 5 BUT value is still computed (AC-5)', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedMemoryRef(tmpDir, { sessionId: 's-1' });
    seedMemoryRef(tmpDir, { sessionId: 's-2' });
    seedRegret(tmpDir, { sessionId: 's-2' });

    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer2.n, 2);
    assert.equal(r.layer2.ready, false);
    // 2 memoryRefs + 1 regret = 4. n=2 → 4/2 = 2. Value MUST exist (AC-5).
    assert.equal(r.layer2.value, 2);
  });

  it('value=0 and ready=false when n=0 — no divide-by-zero', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    const r = fitness.computeFitness(tmpDir, 'P-001');
    assert.equal(r.layer2.n, 0);
    assert.equal(r.layer2.ready, false);
    assert.equal(r.layer2.value, 0);
    assert.ok(Number.isFinite(r.layer2.value), 'value must be a finite number even when n=0');
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Persistence + getFitness round-trip (Lifetime view)
// ---------------------------------------------------------------------------

describe('AC-3 — recordFitness / getFitness round-trip', () => {
  // @cap-todo(ac:F-072/AC-3) getFitness reads the persisted record.
  it('recordFitness writes .cap/learning/fitness/<P-NNN>.json with the FitnessRecord shape', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-1' });
    const ok = fitness.recordFitness(tmpDir, 'P-001');
    assert.equal(ok, true);

    const fp = path.join(tmpDir, '.cap', 'learning', 'fitness', 'P-001.json');
    assert.ok(fs.existsSync(fp), 'persisted file must exist');
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.equal(parsed.id, 'P-001');
    assert.equal(parsed.patternId, 'P-001');
    assert.equal(parsed.layer1.kind, 'override-count');
    assert.equal(parsed.layer2.kind, 'weighted-average');
    assert.equal(parsed.expired, false);
    assert.ok(typeof parsed.ts === 'string');
    assert.ok(parsed.evidence != null);
  });

  it('getFitness returns null when no file persisted', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    assert.equal(fitness.getFitness(tmpDir, 'P-001'), null);
  });

  it('getFitness returns the record after recordFitness', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-1' });
    seedOverride(tmpDir, { sessionId: 's-1' });
    fitness.recordFitness(tmpDir, 'P-001');
    const r = fitness.getFitness(tmpDir, 'P-001');
    assert.ok(r);
    assert.equal(r.id, 'P-001');
    assert.equal(r.layer1.value, 2);
  });

  it('recordFitness is idempotent — overwrites prior write within a session', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-1' });
    fitness.recordFitness(tmpDir, 'P-001');
    const first = fitness.getFitness(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-1' });
    fitness.recordFitness(tmpDir, 'P-001');
    const second = fitness.getFitness(tmpDir, 'P-001');
    assert.equal(first.layer1.value, 1);
    assert.equal(second.layer1.value, 2, 'recompute reflects new signals');
  });

  it('getFitness returns null on malformed json file (never throws)', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'fitness'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'fitness', 'P-001.json'), '{not json');
    assert.equal(fitness.getFitness(tmpDir, 'P-001'), null);
  });

  it('getFitness rejects malformed pattern ids defensively', () => {
    assert.equal(fitness.getFitness(tmpDir, 'not-a-pattern'), null);
    assert.equal(fitness.getFitness(tmpDir, 'P-x'), null);
    assert.equal(fitness.getFitness(tmpDir, ''), null);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — listFitnessExpired / markExpired (20-session inactivity window)
// ---------------------------------------------------------------------------

describe('AC-4 — patterns inactive over 20 sessions are listed expired', () => {
  // @cap-todo(ac:F-072/AC-4) 20-session inactivity window — auto-mark expired:true.
  it('listFitnessExpired returns [] when corpus has fewer than window sessions', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    // Only 5 distinct sessions in the corpus — far below the 20-session window.
    for (let i = 0; i < 5; i++) {
      seedOverride(tmpDir, { sessionId: `s-${i}`, featureId: 'F-OTHER' });
    }
    assert.deepEqual(fitness.listFitnessExpired(tmpDir), []);
  });

  it('lists a pattern when the last 20 sessions contain no matching signals', () => {
    persistFeaturePattern(tmpDir, 'P-001'); // F-100
    // Seed 25 sessions of OTHER-feature signals so the window is full but P-001 sees nothing.
    for (let i = 0; i < 25; i++) {
      seedOverride(tmpDir, {
        sessionId: `s-${String(i).padStart(2, '0')}`,
        featureId: 'F-OTHER',
        ts: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
    const expired = fitness.listFitnessExpired(tmpDir);
    assert.ok(expired.includes('P-001'));
  });

  it('does NOT list a pattern that was active in any of the last 20 sessions', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    for (let i = 0; i < 25; i++) {
      seedOverride(tmpDir, {
        sessionId: `s-${String(i).padStart(2, '0')}`,
        featureId: 'F-OTHER',
        ts: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
    // One matching signal in the most-recent session keeps P-001 alive.
    seedOverride(tmpDir, {
      sessionId: 's-24',
      featureId: 'F-100',
      ts: '2026-04-25T12:00:00.000Z',
    });
    const expired = fitness.listFitnessExpired(tmpDir);
    assert.ok(!expired.includes('P-001'));
  });

  it('markExpired flips expired=true; getFitness reflects the change after re-read', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-1' });
    fitness.recordFitness(tmpDir, 'P-001');
    assert.equal(fitness.getFitness(tmpDir, 'P-001').expired, false);

    assert.equal(fitness.markExpired(tmpDir, 'P-001'), true);
    const reread = fitness.getFitness(tmpDir, 'P-001');
    assert.equal(reread.expired, true, 'expired flag persisted across read');
  });

  it('markExpired creates a record on demand when none exists yet', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    assert.equal(fitness.getFitness(tmpDir, 'P-001'), null);
    assert.equal(fitness.markExpired(tmpDir, 'P-001'), true);
    const r = fitness.getFitness(tmpDir, 'P-001');
    assert.ok(r);
    assert.equal(r.expired, true);
  });

  it('listFitnessExpired honours options.window override (testability)', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-old', featureId: 'F-OTHER', ts: '2026-04-01T00:00:00.000Z' });
    seedOverride(tmpDir, { sessionId: 's-mid', featureId: 'F-OTHER', ts: '2026-04-15T00:00:00.000Z' });
    seedOverride(tmpDir, { sessionId: 's-new', featureId: 'F-OTHER', ts: '2026-05-01T00:00:00.000Z' });
    // window=3 ⇒ full window of OTHER-feature signals → P-001 is expired.
    assert.ok(fitness.listFitnessExpired(tmpDir, { window: 3 }).includes('P-001'));
  });
});

// ---------------------------------------------------------------------------
// AC-5 — Layer 2 datamodel persists from day 1 (verified inline above) — extra pin:
// ---------------------------------------------------------------------------

describe('AC-5 — long-term datamodel exists from day 1', () => {
  // @cap-todo(ac:F-072/AC-5) Layer 2 value computed and persisted even when ready=false.
  it('persisted record always has layer2 fields, even on a fresh pattern with no signals', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    fitness.recordFitness(tmpDir, 'P-001');
    const r = fitness.getFitness(tmpDir, 'P-001');
    assert.ok(r);
    assert.ok(r.layer2);
    assert.equal(r.layer2.kind, 'weighted-average');
    assert.equal(typeof r.layer2.value, 'number');
    assert.equal(typeof r.layer2.n, 'number');
    assert.equal(typeof r.layer2.ready, 'boolean');
  });
});

// ---------------------------------------------------------------------------
// AC-6 — recordApplySnapshot append-only at apply-time (D5)
// ---------------------------------------------------------------------------

describe('AC-6 — recordApplySnapshot appends to .snapshots.jsonl', () => {
  // @cap-todo(ac:F-072/AC-6) Apply-time snapshot — F-073 wires the call when user applies a pattern.
  it('writes a SnapshotRecord line on first call', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-1' });
    seedOverride(tmpDir, { sessionId: 's-2' });

    const snap = fitness.recordApplySnapshot(tmpDir, 'P-001');
    assert.ok(snap);
    assert.equal(snap.patternId, 'P-001');
    assert.equal(snap.layer1.kind, 'override-count');
    assert.equal(snap.layer2.kind, 'weighted-average');
    assert.equal(snap.n, snap.layer2.n);
    assert.ok(Array.isArray(snap.activeSessionsList));

    const fp = path.join(tmpDir, '.cap', 'learning', 'fitness', 'P-001.snapshots.jsonl');
    assert.ok(fs.existsSync(fp));
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.patternId, 'P-001');
  });

  it('append-only: two calls produce two lines (D5)', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-1' });
    fitness.recordApplySnapshot(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-1' }); // signal added between snapshots
    fitness.recordApplySnapshot(tmpDir, 'P-001');

    const fp = path.join(tmpDir, '.cap', 'learning', 'fitness', 'P-001.snapshots.jsonl');
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2, 'two append-only snapshots');

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assert.equal(first.layer1.value, 1);
    assert.equal(second.layer1.value, 2, 'second snapshot reflects the new signal');
  });

  it('returns null on invalid pattern id (never throws)', () => {
    assert.equal(fitness.recordApplySnapshot(tmpDir, 'not-a-pattern'), null);
    assert.equal(fitness.recordApplySnapshot(tmpDir, 'P-999'), null, 'pattern not found → null');
  });

  it('does NOT touch the canonical FitnessRecord on disk (snapshots are independent)', () => {
    persistFeaturePattern(tmpDir, 'P-001');
    seedOverride(tmpDir, { sessionId: 's-1' });
    fitness.recordApplySnapshot(tmpDir, 'P-001');

    // The .json record was never created — only the .snapshots.jsonl.
    const jsonFp = path.join(tmpDir, '.cap', 'learning', 'fitness', 'P-001.json');
    assert.equal(fs.existsSync(jsonFp), false, 'snapshot must not write the canonical fitness file');
    const jsonlFp = path.join(tmpDir, '.cap', 'learning', 'fitness', 'P-001.snapshots.jsonl');
    assert.ok(fs.existsSync(jsonlFp));
  });
});

// ---------------------------------------------------------------------------
// runFitnessPass — batch helper (per @cap-decision F-072/D7 — additive /cap:learn Step 6.5)
// ---------------------------------------------------------------------------

describe('runFitnessPass — batch refresh + auto-expire', () => {
  it('records fitness for every persisted pattern', () => {
    persistFeaturePattern(tmpDir, 'P-001', { featureRef: 'F-100' });
    persistFeaturePattern(tmpDir, 'P-002', { featureRef: 'F-200' });
    seedOverride(tmpDir, { sessionId: 's-1', featureId: 'F-100' });
    seedOverride(tmpDir, { sessionId: 's-1', featureId: 'F-200' });

    const result = fitness.runFitnessPass(tmpDir);
    assert.deepEqual(result.recorded.sort(), ['P-001', 'P-002']);
    assert.deepEqual(result.errors, []);
    assert.ok(fitness.getFitness(tmpDir, 'P-001'));
    assert.ok(fitness.getFitness(tmpDir, 'P-002'));
  });

  it('marks expired patterns automatically', () => {
    persistFeaturePattern(tmpDir, 'P-001'); // F-100
    persistFeaturePattern(tmpDir, 'P-002', { featureRef: 'F-200' });
    // 25 sessions of F-OTHER signals → both P-001 and P-002 are expired.
    for (let i = 0; i < 25; i++) {
      seedOverride(tmpDir, {
        sessionId: `s-${String(i).padStart(2, '0')}`,
        featureId: 'F-OTHER',
        ts: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
    const result = fitness.runFitnessPass(tmpDir);
    assert.ok(result.expired.includes('P-001'));
    assert.ok(result.expired.includes('P-002'));
    assert.equal(fitness.getFitness(tmpDir, 'P-001').expired, true);
    assert.equal(fitness.getFitness(tmpDir, 'P-002').expired, true);
  });

  it('returns errors array (not throws) on bad projectRoot', () => {
    const r = fitness.runFitnessPass('');
    assert.deepEqual(r.recorded, []);
    assert.deepEqual(r.expired, []);
    assert.ok(r.errors.length > 0);
  });

  it('returns empty results when no patterns persisted', () => {
    const r = fitness.runFitnessPass(tmpDir);
    assert.deepEqual(r.recorded, []);
    assert.deepEqual(r.expired, []);
    assert.deepEqual(r.errors, []);
  });
});

// ---------------------------------------------------------------------------
// Defensive boundary — invalid inputs never throw and never write
// ---------------------------------------------------------------------------

describe('defensive boundary', () => {
  it('computeFitness returns null for invalid inputs', () => {
    assert.equal(fitness.computeFitness('', 'P-001'), null);
    assert.equal(fitness.computeFitness(tmpDir, 'not-a-pattern'), null);
    assert.equal(fitness.computeFitness(tmpDir, 'P-999'), null, 'pattern not found → null');
  });

  it('recordFitness returns false for invalid inputs', () => {
    assert.equal(fitness.recordFitness('', 'P-001'), false);
    assert.equal(fitness.recordFitness(tmpDir, 'P-x'), false);
  });

  it('markExpired returns false for invalid inputs', () => {
    assert.equal(fitness.markExpired('', 'P-001'), false);
    assert.equal(fitness.markExpired(tmpDir, 'P-x'), false);
  });

  it('listFitnessExpired returns [] for invalid inputs', () => {
    assert.deepEqual(fitness.listFitnessExpired(''), []);
    assert.deepEqual(fitness.listFitnessExpired(null), []);
  });
});
