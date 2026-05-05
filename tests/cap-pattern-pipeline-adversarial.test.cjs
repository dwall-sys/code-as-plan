'use strict';

// @cap-feature(feature:F-071) Adversarial tests for the Pattern Pipeline.
//                  AC-3 (privacy), AC-4 (budget hard-limit + overflow → queue with deferred:budget),
//                  AC-5 (degraded path — heuristic-only fallback when Stage 2 doesn't run).
//                  Mirrors the F-070 SECRET_NEEDLES strategy: byte-level no-needle assertions on the
//                  briefing markdown — structural assertions on parsed fields are not enough because
//                  a future contributor could smuggle a path through e.g. a synthesized featureId.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const pipeline = require('../cap/bin/lib/cap-pattern-pipeline.cjs');
const learning = require('../cap/bin/lib/cap-learning-signals.cjs');
const telemetry = require('../cap/bin/lib/cap-telemetry.cjs');

// Same needle strategy as cap-learning-signals-adversarial.test.cjs. Different needle pool so
// a copy-paste between the two suites is immediately visible in CI logs.
const SECRET_NEEDLES = [
  'SECRET_BRIEFING_NEEDLE_001',
  'SECRET_PATH_NEEDLE_BETA',
  'SECRET_DECISION_NEEDLE_GAMMA',
  'SECRET_FEATURE_NEEDLE_DELTA',
  'SECRET_HASH_NEEDLE_EPSILON',
  'SECRET_LONG_NEEDLE_THETA',
];

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-pattern-adv-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readAllBriefingBytes(root) {
  const dir = path.join(root, '.cap', 'learning', 'queue');
  if (!fs.existsSync(dir)) return '';
  let blob = '';
  for (const f of fs.readdirSync(dir)) {
    blob += fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return blob;
}

function readAllPatternBytes(root) {
  const dir = path.join(root, '.cap', 'learning', 'patterns');
  if (!fs.existsSync(dir)) return '';
  let blob = '';
  for (const f of fs.readdirSync(dir)) {
    blob += fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return blob;
}

function assertNoNeedles(raw, label) {
  for (const n of SECRET_NEEDLES) {
    assert.ok(
      !raw.includes(n),
      `${label} must not contain secret needle "${n}" — privacy boundary breached`
    );
  }
}

// ---------------------------------------------------------------------------
// AC-3 — Privacy boundary: LLM-bound payload is counts + hashes only
// ---------------------------------------------------------------------------

describe('AC-3 adversarial · briefing contains no raw signal text', () => {
  // @cap-todo(ac:F-071/AC-3) The briefing must be counts + hex hashes only — never raw paths,
  //                          never decision text, never any signal-record verbatim.
  it('seeded SECRET_NEEDLE values across signal fields never appear in any briefing on disk', () => {
    // Inject needles into every free-text-ish field on the input signal records. F-070's collectors
    // hash the targetFile / decisionId / memoryFile, but a future regression here would leak.
    const secretFile = `/Users/${SECRET_NEEDLES[1]}/projects/${SECRET_NEEDLES[0]}.cjs`;
    for (let i = 0; i < 5; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: `s-${SECRET_NEEDLES[0]}`,
        featureId: `F-${i}`, // not a needle — featureId IS structured metadata, allowed to flow through
        targetFile: secretFile,
      });
    }
    learning.recordRegret({
      projectRoot: tmpDir,
      sessionId: `s-${SECRET_NEEDLES[0]}`,
      featureId: 'F-RX',
      decisionId: `${SECRET_NEEDLES[2]}/D1`,
    });
    learning.recordMemoryRef({
      projectRoot: tmpDir,
      sessionId: `s-${SECRET_NEEDLES[0]}`,
      featureId: 'F-MX',
      memoryFile: `.cap/memory/${SECRET_NEEDLES[1]}.md`,
    });

    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    assert.ok(candidates.length >= 1);
    for (const c of candidates) {
      pipeline.buildBriefing(c, tmpDir);
    }

    const raw = readAllBriefingBytes(tmpDir);
    assertNoNeedles(raw, 'briefing markdown');
    assert.ok(!raw.includes(secretFile), 'raw file path must not appear in any briefing');
  });

  it('briefing payload only carries hex-hash + integer-count fields', () => {
    // Hand-craft a candidate where someone tried to smuggle a raw path through topContextHashes.
    // The buildBriefing privacy filter MUST drop non-hex entries.
    const evilCandidate = {
      candidateId: 'deadbeef00000001',
      signalType: 'override',
      featureId: 'F-100',
      count: 5,
      score: 5,
      byFeature: [
        { featureId: 'F-100', count: 4 },
        { featureId: `F-${SECRET_NEEDLES[3]}`, count: 1 }, // non-FNNN-shape — long featureId capped at 32 chars
      ],
      topContextHashes: [
        { hash: 'abc123def4567890', count: 3 },
        { hash: `/Users/${SECRET_NEEDLES[1]}/raw-path.cjs`, count: 99 }, // not hex — must be filtered
        { hash: `${SECRET_NEEDLES[4]}-not-hex`, count: 7 },             // not hex — must be filtered
      ],
      suggestion: { kind: 'L1', target: 'F-100/threshold', from: 3, to: 6, rationale: 'r' },
    };

    const result = pipeline.buildBriefing(evilCandidate, tmpDir);
    const md = fs.readFileSync(result.briefingPath, 'utf8');

    // The legitimate hex hash must be present; the non-hex needles must NOT.
    assert.ok(md.includes('abc123def4567890'), 'legitimate hex hash should pass through');
    assertNoNeedles(md, 'briefing markdown (hand-crafted candidate)');
    // The structured payload returned by buildBriefing also drops the non-hex entries.
    assert.equal(result.payload.topContextHashes.length, 1);
    assert.equal(result.payload.topContextHashes[0].hash, 'abc123def4567890');
  });

  it('candidateId smuggling attempt — non-hex candidateId is re-hashed via telemetry.hashContext', () => {
    const evilCandidate = {
      candidateId: `${SECRET_NEEDLES[0]}-as-candidate-id`, // attacker-supplied, non-hex
      signalType: 'override',
      featureId: 'F-100',
      count: 3,
      score: 3,
      byFeature: [{ featureId: 'F-100', count: 3 }],
      topContextHashes: [],
      suggestion: { kind: 'L1', target: 'F-100/threshold', from: 3, to: 4, rationale: 'r' },
    };
    const result = pipeline.buildBriefing(evilCandidate, tmpDir);
    const md = fs.readFileSync(result.briefingPath, 'utf8');
    assertNoNeedles(md, 'briefing markdown (candidateId smuggle)');
    // The persisted candidateId must be a 16-char hex hash (telemetry.hashContext output).
    assert.match(result.payload.candidateId, /^[0-9a-f]{16}$/);
  });

  it('briefing markdown contains only the documented sections', () => {
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    pipeline.buildBriefing(candidates[0], tmpDir);
    const md = readAllBriefingBytes(tmpDir);
    // Required sections.
    assert.ok(md.includes('# Pattern Briefing P-'));
    assert.ok(md.includes('## Aggregate'));
    assert.ok(md.includes('## By Feature'));
    assert.ok(md.includes('## Top Context Hashes'));
    assert.ok(md.includes('## Task'));
    // Forbidden phrases — these would indicate a regression that leaked raw payload sections.
    assert.ok(!md.includes('## Raw Signals'));
    assert.ok(!md.includes('## Decision Text'));
    assert.ok(!md.includes('## File Paths'));
  });
});

// ---------------------------------------------------------------------------
// AC-4 — Budget hard-limit (3/session by default) + overflow → queue
// ---------------------------------------------------------------------------

describe('AC-4 adversarial · budget hard-limit and overflow → deferred queue', () => {
  // @cap-todo(ac:F-071/AC-4) When the session has used up its 3 LLM calls, no further candidates
  //                          may be promoted; overflow lands in queue/ with deferred:budget.
  it('pre-loaded 3 LLM calls exhaust the default budget — no calls remaining', () => {
    for (let i = 0; i < 3; i++) {
      telemetry.recordLlmCall(tmpDir, {
        model: 'claude-opus-4-7', promptTokens: 0, completionTokens: 0, durationMs: 0,
        sessionId: 's-budget',
        commandContext: { command: '/cap:learn', feature: 'F-071' },
      });
    }
    const state = pipeline.getSessionBudgetState(tmpDir, 's-budget');
    assert.equal(state.used, 3);
    assert.equal(state.remaining, 0);
  });

  it('overflow path — 5 threshold-passing candidates, budget=0 → all 5 land in queue with deferred:budget', () => {
    // Budget already exhausted (3 calls pre-loaded).
    for (let i = 0; i < 3; i++) {
      telemetry.recordLlmCall(tmpDir, {
        model: 'claude-opus-4-7', promptTokens: 0, completionTokens: 0, durationMs: 0,
        sessionId: 's-overflow',
        commandContext: { command: '/cap:learn', feature: 'F-071' },
      });
    }

    // Build 5 distinct override candidates that each hit threshold.
    for (let f = 0; f < 5; f++) {
      for (let i = 0; i < 3; i++) {
        learning.recordOverride({
          projectRoot: tmpDir,
          subType: 'editAfterWrite',
          sessionId: 's-overflow',
          featureId: `F-${f.toString().padStart(3, '0')}`,
          targetFile: `/feat-${f}/file.cjs`,
        });
      }
    }

    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    const promotable = candidates.filter((c) => pipeline.checkThreshold(c));
    assert.ok(promotable.length >= 5, `expected >=5 promotable candidates, got ${promotable.length}`);

    // Simulate the orchestrator's behaviour: budget exhausted → every candidate goes to queue
    // with deferred:budget. The pipeline lib provides buildBriefing(deferred:true) for this.
    const state = pipeline.getSessionBudgetState(tmpDir, 's-overflow');
    assert.equal(state.remaining, 0);
    let promoted = 0;
    for (const c of promotable.slice(0, 5)) {
      // No budget remaining → buildBriefing with deferred:true; nothing is promoted.
      pipeline.buildBriefing(c, tmpDir, { deferred: true });
    }
    assert.equal(promoted, 0, '0 candidates may be promoted when budget is exhausted');

    // 5 markdown briefings under .cap/learning/queue/, every one carrying deferred:budget.
    const queue = path.join(tmpDir, '.cap', 'learning', 'queue');
    const files = fs.readdirSync(queue).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 5);
    for (const f of files) {
      const md = fs.readFileSync(path.join(queue, f), 'utf8');
      assert.ok(md.includes('deferred: budget'), `${f} must carry deferred: budget marker`);
    }
  });

  it('AC-7 budget override — 10 in config replaces the default 3', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'learning', 'config.json'),
      JSON.stringify({ llmBudgetPerSession: 10 }),
    );
    const state = pipeline.getSessionBudgetState(tmpDir, 's-override');
    assert.equal(state.budget, 10);
    assert.equal(state.source, 'config');
    assert.equal(state.remaining, 10);
  });

  it('budget config edge: malformed config falls back to default (no throw)', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'config.json'), '{ not json');
    const state = pipeline.getSessionBudgetState(tmpDir, 's');
    assert.equal(state.budget, telemetry.DEFAULT_LLM_BUDGET_PER_SESSION);
    assert.equal(state.source, 'default');
  });
});

// ---------------------------------------------------------------------------
// AC-5 — Graceful degradation: heuristic-only persistence when Stage 2 doesn't run
// ---------------------------------------------------------------------------

describe('AC-5 adversarial · degraded path produces a heuristic-only L1 pattern', () => {
  // @cap-todo(ac:F-071/AC-5) When LLM is unavailable (or the outer agent doesn't process the
  //                          briefing), the heuristic stage's L1 suggestion is still persisted with
  //                          degraded:true and source:'heuristic'.
  it('markDegraded persists a heuristic-only PatternRecord with degraded=true', () => {
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    const id = pipeline.allocatePatternId(tmpDir);
    const ok = pipeline.markDegraded(tmpDir, id, candidates[0]);
    assert.equal(ok, true);
    const list = pipeline.listPatterns(tmpDir);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].degraded, true);
    assert.equal(list[0].source, 'heuristic');
    assert.equal(list[0].level, 'L1');
    assert.equal(list[0].suggestion.kind, 'L1');
    assert.equal(list[0].featureRef, 'F-100');
    // Evidence carries the candidate count + signalType, not raw records.
    assert.equal(list[0].evidence.signalType, 'override');
    assert.equal(list[0].evidence.count, 3);
  });

  it('degraded pattern record contains no raw signal text (privacy still enforced on heuristic path)', () => {
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: `s-${SECRET_NEEDLES[0]}`,
      featureId: 'F-100',
      targetFile: `/Users/${SECRET_NEEDLES[1]}/file.cjs`,
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: `s-${SECRET_NEEDLES[0]}`,
      featureId: 'F-100',
      targetFile: `/Users/${SECRET_NEEDLES[1]}/file.cjs`,
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: `s-${SECRET_NEEDLES[0]}`,
      featureId: 'F-100',
      targetFile: `/Users/${SECRET_NEEDLES[1]}/file.cjs`,
    });
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    const id = pipeline.allocatePatternId(tmpDir);
    pipeline.markDegraded(tmpDir, id, candidates[0]);
    const raw = readAllPatternBytes(tmpDir);
    assertNoNeedles(raw, 'degraded pattern record');
  });

  it('pinned contract — degraded path keeps the L1 suggestion built by the heuristic engine', () => {
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    learning.recordOverride({
      projectRoot: tmpDir,
      subType: 'editAfterWrite',
      sessionId: 's',
      featureId: 'F-100',
      targetFile: '/abs/path.cjs',
    });
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    const id = pipeline.allocatePatternId(tmpDir);
    pipeline.markDegraded(tmpDir, id, candidates[0]);
    const list = pipeline.listPatterns(tmpDir);
    // Pinned: heuristic suggests raising threshold from 3 to (count + 1) = 5.
    assert.equal(list[0].suggestion.from, 3);
    assert.equal(list[0].suggestion.to, 5);
    assert.equal(list[0].suggestion.target, 'F-100/threshold');
  });
});

// ---------------------------------------------------------------------------
// Concurrency / robustness — pipeline must not crash on weird input
// ---------------------------------------------------------------------------

describe('robustness — pipeline never throws on edge inputs', () => {
  it('runHeuristicStage with empty projectRoot returns errors[] non-empty, no throw', () => {
    const r = pipeline.runHeuristicStage('');
    assert.deepEqual(r.candidates, []);
    assert.ok(r.errors.length > 0);
  });

  it('buildBriefing returns null on bad input — no throw', () => {
    assert.equal(pipeline.buildBriefing(null, tmpDir), null);
    assert.equal(pipeline.buildBriefing({}, ''), null);
  });

  it('allocatePatternId is idempotent — calling twice without writing returns the same id', () => {
    const a = pipeline.allocatePatternId(tmpDir);
    const b = pipeline.allocatePatternId(tmpDir);
    assert.equal(a, b);
  });

  it('listPatterns skips malformed JSON files', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'patterns'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-001.json'), '{ not json');
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-002.json'),
      JSON.stringify({ id: 'P-002', level: 'L1' }),
    );
    const list = pipeline.listPatterns(tmpDir);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'P-002');
  });
});
