'use strict';

// @cap-feature(feature:F-071) Baseline tests for the Pattern Pipeline — AC-1 / AC-6 / AC-7 coverage.
//                  AC-3 (privacy) and AC-4/AC-5 (budget + degraded) live in the adversarial file.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const pipeline = require('../cap/bin/lib/cap-pattern-pipeline.cjs');
const learning = require('../cap/bin/lib/cap-learning-signals.cjs');
const telemetry = require('../cap/bin/lib/cap-telemetry.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-pattern-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: seed N override records sharing featureId + targetFile so the candidate is unambiguous.
function seedOverrides(root, count, opts) {
  const o = opts || {};
  for (let i = 0; i < count; i++) {
    learning.recordOverride({
      projectRoot: root,
      subType: 'editAfterWrite',
      sessionId: o.sessionId || 's-baseline',
      featureId: o.featureId || 'F-100',
      targetFile: o.targetFile || '/abs/path/file.cjs',
    });
  }
}

function seedRegrets(root, count, opts) {
  const o = opts || {};
  for (let i = 0; i < count; i++) {
    learning.recordRegret({
      projectRoot: root,
      sessionId: o.sessionId || 's-baseline',
      featureId: o.featureId || 'F-100',
      decisionId: o.decisionId || 'F-100/D1',
    });
  }
}

function seedMemoryRefs(root, count, opts) {
  const o = opts || {};
  for (let i = 0; i < count; i++) {
    learning.recordMemoryRef({
      projectRoot: root,
      sessionId: o.sessionId || 's-baseline',
      featureId: o.featureId || 'F-100',
      memoryFile: o.memoryFile || '.cap/memory/decisions.md',
    });
  }
}

// ---------------------------------------------------------------------------
// AC-1 — Heuristic Stage 1 (TF-IDF + RegEx-Cluster + Frequency)
// ---------------------------------------------------------------------------

describe('AC-1 — runHeuristicStage produces candidates with score', () => {
  // @cap-todo(ac:F-071/AC-1) Stage-1 heuristic: TF-IDF + RegEx + Frequency on signal records.
  it('returns at least one candidate when overrides cluster on the same featureId+targetFile', () => {
    seedOverrides(tmpDir, 4);
    const { candidates, errors } = pipeline.runHeuristicStage(tmpDir);
    assert.equal(errors.length, 0, `unexpected errors: ${errors.join('; ')}`);
    assert.ok(candidates.length >= 1, 'expected at least one candidate');
    const c = candidates[0];
    assert.equal(c.signalType, 'override');
    assert.equal(c.featureId, 'F-100');
    assert.equal(c.count, 4);
    assert.ok(typeof c.score === 'number' && c.score > 0);
    assert.ok(Array.isArray(c.byFeature) && c.byFeature.length === 1);
    assert.equal(c.byFeature[0].featureId, 'F-100');
    assert.equal(c.byFeature[0].count, 4);
    assert.ok(Array.isArray(c.topContextHashes));
    // Heuristic-only L1 suggestion is attached so AC-5 has a fallback even before Stage 2.
    assert.equal(c.suggestion.kind, 'L1');
    assert.equal(c.suggestion.target, 'F-100/threshold');
    assert.equal(c.suggestion.from, pipeline.THRESHOLD_OVERRIDE_COUNT);
    assert.equal(c.suggestion.to, 5); // count + 1
  });

  it('writes one .cap/learning/candidates/<id>.json per candidate', () => {
    seedOverrides(tmpDir, 3);
    pipeline.runHeuristicStage(tmpDir);
    const dir = path.join(tmpDir, '.cap', 'learning', 'candidates');
    assert.ok(fs.existsSync(dir));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 1);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    assert.ok(typeof raw.candidateId === 'string');
    assert.ok(typeof raw.score === 'number');
  });

  it('returns empty list when no signals exist', () => {
    const { candidates, errors } = pipeline.runHeuristicStage(tmpDir);
    assert.deepEqual(candidates, []);
    assert.deepEqual(errors, []);
  });

  it('TF-IDF surfaces session-rare tokens — a one-off override in a multi-session corpus is selected', () => {
    // Three "background" sessions full of one common token, one "outlier" session with a rare cluster.
    for (let s = 0; s < 3; s++) {
      seedOverrides(tmpDir, 4, { sessionId: `bg-${s}`, featureId: 'F-COMMON', targetFile: '/common/file' });
    }
    seedOverrides(tmpDir, 3, { sessionId: 'outlier', featureId: 'F-RARE', targetFile: '/rare/file' });

    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    // The rare cluster must be reachable via either the TF-IDF arm or the count >=3 fallback.
    const rare = candidates.find((c) => c.featureId === 'F-RARE');
    assert.ok(rare, 'TF-IDF or threshold-fallback must surface the rare 3-record cluster');
    assert.equal(rare.count, 3);
  });

  it('regret signals produce candidates at count>=1 (AC-2 threshold)', () => {
    seedRegrets(tmpDir, 1);
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    const r = candidates.find((c) => c.signalType === 'regret');
    assert.ok(r, 'a single regret should already produce a candidate');
    assert.equal(r.count, 1);
  });

  it('runs in <500ms on a 10k-signal corpus (heuristic stage performance probe)', () => {
    // Ten thousand records, spread across 100 sessions and 50 features.
    for (let i = 0; i < 10000; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: `s-${i % 100}`,
        featureId: `F-${(i % 50).toString().padStart(3, '0')}`,
        targetFile: `/path/${i % 200}.cjs`,
      });
    }
    const t0 = process.hrtime.bigint();
    const { candidates, errors } = pipeline.runHeuristicStage(tmpDir, { persist: false });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(errors.length, 0);
    assert.ok(candidates.length > 0);
    assert.ok(ms < 500, `heuristic stage took ${ms.toFixed(1)}ms on 10k signals (>500ms budget)`);
  });
});

// ---------------------------------------------------------------------------
// AC-2 — checkThreshold (≥3 overrides OR ≥1 regret; memory-ref never)
// ---------------------------------------------------------------------------

describe('AC-2 — checkThreshold gates Stage 2 promotion', () => {
  // @cap-todo(ac:F-071/AC-2) Stage-2 trigger when count >= 3 overrides OR >= 1 regret.
  it('promotes when overrides hit count>=3', () => {
    assert.equal(pipeline.checkThreshold({ signalType: 'override', count: 3 }), true);
    assert.equal(pipeline.checkThreshold({ signalType: 'override', count: 5 }), true);
  });
  it('does NOT promote when overrides count<3', () => {
    assert.equal(pipeline.checkThreshold({ signalType: 'override', count: 2 }), false);
    assert.equal(pipeline.checkThreshold({ signalType: 'override', count: 0 }), false);
  });
  it('promotes when regrets count>=1', () => {
    assert.equal(pipeline.checkThreshold({ signalType: 'regret', count: 1 }), true);
  });
  it('memory-ref never promotes regardless of count', () => {
    assert.equal(pipeline.checkThreshold({ signalType: 'memory-ref', count: 100 }), false);
  });
  it('handles malformed input safely', () => {
    assert.equal(pipeline.checkThreshold(null), false);
    assert.equal(pipeline.checkThreshold(undefined), false);
    assert.equal(pipeline.checkThreshold({}), false);
    assert.equal(pipeline.checkThreshold({ signalType: 'unknown', count: 99 }), false);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — P-NNN allocation contract (sequential, never renumbered)
// ---------------------------------------------------------------------------

describe('AC-6 — allocatePatternId is sequential and never renumbers', () => {
  // @cap-todo(ac:F-071/AC-6) IDs are zero-padded P-NNN, sequential, gap-tolerant.
  it('returns P-001 on a fresh project', () => {
    assert.equal(pipeline.allocatePatternId(tmpDir), 'P-001');
  });

  it('returns max(existing) + 1 even when there are gaps — pinned contract', () => {
    // Pin: AC-6 says "sequential, never renumbered". Gaps are fine; allocator returns
    // max(existing IDs) + 1. With P-001/P-002 in patterns and P-005 in queue, next is P-006.
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'patterns'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'queue'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-001.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-002.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'queue', 'P-005.md'), '---\nid: P-005\n---\n');
    assert.equal(pipeline.allocatePatternId(tmpDir), 'P-006');
  });

  it('queue and patterns share the ID namespace (deferred IDs are not reused)', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'queue'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'queue', 'P-007.md'), '---\nid: P-007\n---\n');
    // Even with no patterns/, the queue burns ID 7 — next must be 8.
    assert.equal(pipeline.allocatePatternId(tmpDir), 'P-008');
  });

  it('returns zero-padded 3-digit IDs', () => {
    assert.equal(pipeline.allocatePatternId(tmpDir), 'P-001');
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'patterns'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-099.json'), '{}');
    assert.equal(pipeline.allocatePatternId(tmpDir), 'P-100');
  });

  it('ignores non-P-NNN entries in patterns/ and queue/', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'patterns'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'README.md'), 'noise');
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-FOO.json'), '{}');
    assert.equal(pipeline.allocatePatternId(tmpDir), 'P-001');
  });
});

// ---------------------------------------------------------------------------
// AC-6 — PatternRecord schema (recordPatternSuggestion + listPatterns)
// ---------------------------------------------------------------------------

describe('AC-6 — PatternRecord persistence and listPatterns', () => {
  it('persists a complete PatternRecord and lists it back', () => {
    const id = pipeline.allocatePatternId(tmpDir);
    const ok = pipeline.recordPatternSuggestion(tmpDir, {
      id,
      createdAt: '2026-05-05T00:00:00.000Z',
      level: 'L1',
      featureRef: 'F-100',
      source: 'heuristic',
      degraded: false,
      confidence: 0.7,
      suggestion: { kind: 'L1', target: 'F-100/threshold', from: 3, to: 5, rationale: 'test' },
      evidence: { candidateId: 'abc', signalType: 'override', count: 4, topContextHashes: [] },
    });
    assert.equal(ok, true);
    const list = pipeline.listPatterns(tmpDir);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].level, 'L1');
    assert.equal(list[0].featureRef, 'F-100');
    assert.equal(list[0].source, 'heuristic');
    assert.equal(list[0].degraded, false);
  });

  it('rejects malformed pattern ids', () => {
    assert.equal(pipeline.recordPatternSuggestion(tmpDir, { id: 'not-a-pattern', level: 'L1' }), false);
    assert.equal(pipeline.recordPatternSuggestion(tmpDir, { id: 'P-x', level: 'L1' }), false);
    assert.equal(pipeline.recordPatternSuggestion(tmpDir, null), false);
  });

  it('listPatterns returns empty array when patterns dir missing', () => {
    assert.deepEqual(pipeline.listPatterns(tmpDir), []);
  });

  it('listPatterns sorts ascending by id', () => {
    const dir = path.join(tmpDir, '.cap', 'learning', 'patterns');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'P-005.json'), JSON.stringify({ id: 'P-005' }));
    fs.writeFileSync(path.join(dir, 'P-001.json'), JSON.stringify({ id: 'P-001' }));
    fs.writeFileSync(path.join(dir, 'P-010.json'), JSON.stringify({ id: 'P-010' }));
    const list = pipeline.listPatterns(tmpDir);
    assert.deepEqual(list.map((p) => p.id), ['P-001', 'P-005', 'P-010']);
  });
});

// ---------------------------------------------------------------------------
// AC-7 — Budget-override delegates to cap-telemetry.cjs#readBudget
// ---------------------------------------------------------------------------

describe('AC-7 — getSessionBudgetState honours .cap/learning/config.json#llmBudgetPerSession', () => {
  // @cap-todo(ac:F-071/AC-7) Re-uses readBudget from cap-telemetry.cjs — single source of truth.
  it('returns DEFAULT_LLM_BUDGET_PER_SESSION when no config is present', () => {
    const state = pipeline.getSessionBudgetState(tmpDir, 'fresh-session');
    assert.equal(state.budget, telemetry.DEFAULT_LLM_BUDGET_PER_SESSION);
    assert.equal(state.source, 'default');
    assert.equal(state.used, 0);
    assert.equal(state.remaining, telemetry.DEFAULT_LLM_BUDGET_PER_SESSION);
  });

  it('reflects the configured llmBudgetPerSession from .cap/learning/config.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'learning', 'config.json'),
      JSON.stringify({ llmBudgetPerSession: 10 }),
    );
    const state = pipeline.getSessionBudgetState(tmpDir, 's');
    assert.equal(state.budget, 10);
    assert.equal(state.source, 'config');
  });

  it('counts existing recordLlmCall entries against the session budget', () => {
    // Pre-load 2 calls for the test session.
    for (let i = 0; i < 2; i++) {
      telemetry.recordLlmCall(tmpDir, {
        model: 'claude-opus-4-7',
        promptTokens: 0, completionTokens: 0, durationMs: 0,
        sessionId: 's-budget',
        commandContext: { command: '/cap:learn', feature: 'F-071' },
      });
    }
    const state = pipeline.getSessionBudgetState(tmpDir, 's-budget');
    assert.equal(state.used, 2);
    assert.equal(state.remaining, telemetry.DEFAULT_LLM_BUDGET_PER_SESSION - 2);
  });

  it('returns budget=0 → remaining=0 when budget is configured to 0', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'learning', 'config.json'),
      JSON.stringify({ llmBudgetPerSession: 0 }),
    );
    const state = pipeline.getSessionBudgetState(tmpDir, 's');
    assert.equal(state.budget, 0);
    assert.equal(state.remaining, 0);
  });
});

// ---------------------------------------------------------------------------
// buildBriefing — basic shape (deeper privacy probes live in adversarial file)
// ---------------------------------------------------------------------------

describe('buildBriefing — writes a deferred-aware markdown briefing', () => {
  it('writes .cap/learning/queue/P-NNN.md with the structured payload', () => {
    seedOverrides(tmpDir, 3);
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    const c = candidates[0];
    const result = pipeline.buildBriefing(c, tmpDir);
    assert.ok(result, 'buildBriefing should return a result');
    assert.match(result.id, /^P-\d{3}$/);
    assert.ok(fs.existsSync(result.briefingPath));
    const md = fs.readFileSync(result.briefingPath, 'utf8');
    assert.ok(md.includes(`id: ${result.id}`));
    assert.ok(md.includes(`signalType: ${c.signalType}`));
    assert.ok(md.includes(`count: ${c.count}`));
    // Frontmatter MUST NOT contain a deferred marker by default.
    assert.ok(!md.includes('deferred: budget'));
  });

  it('marks the briefing as deferred when options.deferred=true (AC-4 overflow path)', () => {
    seedOverrides(tmpDir, 3);
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    const result = pipeline.buildBriefing(candidates[0], tmpDir, { deferred: true });
    const md = fs.readFileSync(result.briefingPath, 'utf8');
    assert.ok(md.includes('deferred: budget'));
  });
});
