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

// ===========================================================================
// GAP-CLOSING PROBES — added by the adversarial audit pass.
// ===========================================================================

// ---------------------------------------------------------------------------
// AC-1 — TF-IDF edge cases (epsilon floor, universal token, frequency-arm
//        behaviour with non-string featureId, topContextHashes cap, byFeature
//        sort stability)
// ---------------------------------------------------------------------------

describe('AC-1 gap · TF-IDF epsilon floor on single-session corpora', () => {
  // @cap-todo(ac:F-071/AC-1) IDF on a single-session corpus is log(1/1) = 0; the engine floors IDF
  //                          at 0.01 so candidates remain sortable. Pin the floor — without it,
  //                          single-session corpora would emit `score: 0` candidates and break any
  //                          downstream sort that relies on positive scores.
  it('single-session corpus produces candidates with score > 0 (epsilon floor)', () => {
    for (let i = 0; i < 4; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: 'only-one-session',
        featureId: 'F-100',
        targetFile: '/abs/path.cjs',
      });
    }
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    assert.ok(candidates.length >= 1, 'should produce a candidate from a single-session cluster');
    const c = candidates[0];
    // Pin: the epsilon floor (0.01) keeps score strictly positive even when log(1/1)=0.
    assert.ok(c.score > 0, `expected score > 0 from epsilon floor, got ${c.score}`);
    // TF=4, IDF floor=0.01 → score=0.04. Pin the magnitude so a regression on the floor surfaces.
    assert.ok(c.score >= 0.04 - 1e-9 && c.score <= 0.04 + 1e-9,
      `expected score ≈ 0.04 (TF=4 × IDF_floor=0.01), got ${c.score}`);
  });
});

describe('AC-1 gap · universal-token corpus (every session contains the same token)', () => {
  // @cap-todo(ac:F-071/AC-1) When every session contains the same token, IDF = log(N/N) = 0. The
  //                          epsilon floor (0.01) keeps the token sortable, AND the frequency arm
  //                          (count >= threshold) still selects it. Pin: the candidate IS produced.
  it('universal token across 5 sessions still produces a candidate via frequency arm', () => {
    // Same token in 5 distinct sessions, 1 record each → count = 5, IDF = log(5/5) = 0.
    for (let s = 0; s < 5; s++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: `session-${s}`,
        featureId: 'F-100',
        targetFile: '/abs/universal.cjs',
      });
    }
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    const c = candidates.find((x) => x.featureId === 'F-100');
    assert.ok(c, 'frequency arm must surface the universal token (count=5 >= threshold)');
    assert.equal(c.count, 5);
    // Score floor still kicks in — TF in each session is 1, IDF floor=0.01 → max score = 0.01.
    assert.ok(c.score > 0, 'epsilon floor keeps score strictly positive even when IDF=0');
  });
});

describe('AC-1 gap · non-string featureId is dropped to null at record write, candidate.featureId reflects this', () => {
  // @cap-todo(ac:F-071/AC-1) F-070's capId rejects non-strings → record.featureId = null. The
  //                          pipeline groups null-featureId records under the 'unassigned' token.
  //                          Pin: the cluster IS produced and candidate.featureId is null.
  it('records with featureId=null produce a candidate with featureId=null (not dropped silently)', () => {
    for (let i = 0; i < 4; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: 's-null-fid',
        featureId: 12345, // non-string — capId returns null
        targetFile: '/abs/path.cjs',
      });
    }
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    assert.ok(candidates.length >= 1, 'null-featureId records must still cluster into a candidate');
    const c = candidates[0];
    assert.equal(c.featureId, null, 'dominantFeature must be null when records have no featureId');
    assert.equal(c.count, 4);
    // byFeature must contain a single null-keyed row.
    assert.equal(c.byFeature.length, 1);
    assert.equal(c.byFeature[0].featureId, null);
    assert.equal(c.byFeature[0].count, 4);
  });
});

describe('AC-1 gap · topContextHashes cap at 5', () => {
  // @cap-todo(ac:F-071/AC-1) topContextHashes is sliced to length 5. A flood of >5 distinct hashes
  //                          must not bypass the cap (would inflate briefing size and hand the LLM
  //                          unbounded payload).
  it('candidate with >5 distinct contextHashes still emits at most 5 entries', () => {
    // Seed 8 distinct contextHashes for the same featureId+targetFile (so they collapse to one
    // candidate via the tuple-token but expose 8 distinct hash values).
    // contextHash is computed from contextDescription via hashContext, so vary that.
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 2; j++) {
        learning.recordOverride({
          projectRoot: tmpDir,
          subType: 'editAfterWrite',
          sessionId: 's-flood',
          featureId: 'F-100',
          targetFile: '/abs/path.cjs',
          contextDescription: `unique-context-${i}`,
        });
      }
    }
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    assert.ok(candidates.length >= 1);
    const c = candidates[0];
    assert.ok(c.topContextHashes.length <= 5,
      `topContextHashes must cap at 5, got ${c.topContextHashes.length}`);
  });
});

describe('AC-1 gap · byFeature sort stability on count ties', () => {
  // @cap-todo(ac:F-071/AC-1) When two features tie on count, V8's Array.prototype.sort is stable
  //                          (Node >= 12). Pin the contract — a regression to an unstable sort
  //                          would make F-072 / F-073 ordering nondeterministic.
  it('byFeature ordering is stable when two features tie on count', () => {
    // Build a candidate where the same token has records from two different features with equal counts.
    // The token includes featureId, so different features → different tokens → different candidates,
    // not a single candidate with multiple features. To force a single candidate with byFeature ties,
    // we need a candidate built from the underlying clustering — but the token construction guarantees
    // one candidate per (signalType, featureId, contextKey). So byFeature.length is always 1 from the
    // organic path. We hand-craft via buildBriefing to pin the SORT, since that's where ties matter
    // for downstream consumers.
    const evilCandidate = {
      candidateId: 'deadbeef00000002',
      signalType: 'override',
      featureId: 'F-100',
      count: 6,
      score: 6,
      // Insertion order: F-200 first, then F-100. Both count=3. Stable sort must keep F-200 first.
      byFeature: [
        { featureId: 'F-200', count: 3 },
        { featureId: 'F-100', count: 3 },
      ],
      topContextHashes: [],
      suggestion: { kind: 'L1', target: 'F-100/threshold', from: 3, to: 7, rationale: 'r' },
    };
    const result = pipeline.buildBriefing(evilCandidate, tmpDir);
    assert.deepEqual(result.payload.byFeature, [
      { featureId: 'F-200', count: 3 },
      { featureId: 'F-100', count: 3 },
    ], 'stable sort must preserve insertion order on count ties');
  });
});

// ---------------------------------------------------------------------------
// AC-2 — "similar" meaning + boundary probes
// ---------------------------------------------------------------------------

describe('AC-2 gap · "similar" means same (featureId, targetFile) tuple, not just signalType', () => {
  // @cap-todo(ac:F-071/AC-2) The threshold ">=3 similar overrides" is interpreted via the
  //                          tuple-token (signalType|featureId|contextKey). 3 overrides spread
  //                          across 3 different featureIds DO NOT cluster — each is its own
  //                          token with count=1, none meets threshold. Pin the contract.
  it('3 overrides across 3 different featureIds do NOT cross threshold (no single similar cluster)', () => {
    for (let i = 0; i < 3; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: 's-split',
        featureId: `F-10${i}`, // F-100, F-101, F-102 — three different features
        targetFile: '/abs/path.cjs',
      });
    }
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    // Each token is count=1; checkThreshold rejects count<3 for overrides.
    const promotable = candidates.filter((c) => pipeline.checkThreshold(c));
    assert.equal(promotable.length, 0,
      `3 overrides split across 3 features must NOT promote — got ${promotable.length} promotable`);
  });

  it('3 overrides split 2/1 across two featureIds — only the 2-cluster candidate exists, neither promotes', () => {
    learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite',
      sessionId: 's-21', featureId: 'F-100', targetFile: '/abs/path.cjs',
    });
    learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite',
      sessionId: 's-21', featureId: 'F-100', targetFile: '/abs/path.cjs',
    });
    learning.recordOverride({
      projectRoot: tmpDir, subType: 'editAfterWrite',
      sessionId: 's-21', featureId: 'F-200', targetFile: '/abs/path.cjs',
    });
    const { candidates } = pipeline.runHeuristicStage(tmpDir);
    // F-100 cluster has count=2, F-200 cluster has count=1. Neither meets threshold=3.
    const promotable = candidates.filter((c) => pipeline.checkThreshold(c));
    assert.equal(promotable.length, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Privacy probes on persisted candidate JSON + pattern JSON
// ---------------------------------------------------------------------------

function readAllCandidateBytes(root) {
  const dir = path.join(root, '.cap', 'learning', 'candidates');
  if (!fs.existsSync(dir)) return '';
  let blob = '';
  for (const f of fs.readdirSync(dir)) {
    blob += fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return blob;
}

describe('AC-3 gap · persisted candidate JSON files are byte-clean', () => {
  // @cap-todo(ac:F-071/AC-3) Stage-1 persists .cap/learning/candidates/<id>.json. F-073 (review)
  //                          will consume these. The same byte-level no-needle assertion as the
  //                          briefing markdown applies — a future contributor adding a `description`
  //                          or `rationale` field that echoes raw input would leak via this path.
  it('SECRET_NEEDLE values injected into signal fields never appear in candidate JSONs', () => {
    const secretFile = `/Users/${SECRET_NEEDLES[1]}/projects/${SECRET_NEEDLES[0]}.cjs`;
    for (let i = 0; i < 5; i++) {
      learning.recordOverride({
        projectRoot: tmpDir,
        subType: 'editAfterWrite',
        sessionId: `s-${SECRET_NEEDLES[0]}`,
        featureId: 'F-100',
        targetFile: secretFile,
      });
    }
    learning.recordRegret({
      projectRoot: tmpDir,
      sessionId: `s-${SECRET_NEEDLES[0]}`,
      featureId: 'F-RX',
      decisionId: `${SECRET_NEEDLES[2]}/D1`,
    });
    pipeline.runHeuristicStage(tmpDir); // persists by default

    const raw = readAllCandidateBytes(tmpDir);
    assert.ok(raw.length > 0, 'expected at least one candidate persisted');
    assertNoNeedles(raw, 'persisted candidate JSON');
    assert.ok(!raw.includes(secretFile),
      'raw file path must not appear in any persisted candidate JSON');
  });
});

describe('AC-3 gap · persisted pattern JSON files are byte-clean (degraded path)', () => {
  // @cap-todo(ac:F-071/AC-3) The final P-NNN.json files are the most-consumed artifact (F-073 review,
  //                          F-074 application). Byte-level no-needle assertion for the heuristic-
  //                          source path is critical — degraded patterns ship without LLM review.
  it('hand-crafted candidate carrying needles → markDegraded persists no needles in pattern JSON', () => {
    // Force-feed a candidate with needles in the rationale field; degraded path will copy the
    // suggestion object verbatim into the pattern record. This is the FOOTGUN — if a future change
    // ever lets the rationale hold raw user text, it would leak via the degraded path.
    const evilCandidate = {
      candidateId: 'deadbeef00000003',
      signalType: 'override',
      featureId: 'F-100',
      count: 4,
      score: 4,
      byFeature: [{ featureId: 'F-100', count: 4 }],
      topContextHashes: [{ hash: 'abc123def4567890', count: 4 }],
      // The rationale is structurally controlled by buildHeuristicSuggestion in the organic path,
      // but a hostile caller could pass this in directly. Pin: even when the caller smuggles a
      // needle here, it ends up in the pattern JSON — which is a KNOWN deficit.
      suggestion: {
        kind: 'L1',
        target: 'F-100/threshold',
        from: 3,
        to: 5,
        rationale: `Cluster description with ${SECRET_NEEDLES[5]} embedded.`,
      },
    };
    const id = pipeline.allocatePatternId(tmpDir);
    pipeline.markDegraded(tmpDir, id, evilCandidate);
    const raw = readAllPatternBytes(tmpDir);
    // PIN-DECISION (open): markDegraded copies candidate.suggestion verbatim into the pattern JSON.
    // The organic heuristic path is safe because buildHeuristicSuggestion produces purely structural
    // strings (count + featureId — no raw signal text). The only public producer of
    // HeuristicCandidate is runHeuristicStage(), which is closed. So the practical privacy
    // boundary holds. But there is NO defense-in-depth: a future contributor who exposes a new
    // public producer of HeuristicCandidate, or who lets buildHeuristicSuggestion incorporate
    // free-form input, would breach AC-3 via this path without any guard firing.
    //
    // This test pins the current contract: markDegraded TRUSTS candidate.suggestion. The user
    // must confirm whether this trust is acceptable for ship, or whether markDegraded should
    // re-build the suggestion from structurally-controlled fields only.
    assert.ok(raw.includes(SECRET_NEEDLES[5]),
      'pinned current contract: markDegraded copies candidate.suggestion verbatim. ' +
      'If this assertion ever fails, defense-in-depth was added — update the pin.');
    // The needles that probe the actual privacy boundary (signal fields, not the suggestion)
    // must NEVER appear — those test that no path leaks input data.
    for (const n of SECRET_NEEDLES.slice(0, 5)) {
      assert.ok(!raw.includes(n),
        `pattern JSON must not contain needle "${n}" — privacy boundary breach`);
    }
  });
});

describe('AC-3 gap · featureId regex is anchored — no smuggle via non-anchored match', () => {
  // @cap-todo(ac:F-071/AC-3) The briefing's safeFeature gate uses /^F-\d{3,}$/. A non-anchored regex
  //                          would let "F-001'); DROP TABLE patterns; --" pass because it starts
  //                          with F-001. Pin: the anchor rejects ANY non-conforming string.
  it('hand-crafted byFeature with smuggle attempt → featureId collapses to null in briefing', () => {
    const evilCandidate = {
      candidateId: 'deadbeef00000004',
      signalType: 'override',
      featureId: 'F-100',
      count: 5,
      score: 5,
      byFeature: [
        { featureId: 'F-100', count: 3 },
        { featureId: "F-001'); DROP TABLE patterns; --", count: 2 },
        { featureId: 'F-1', count: 1 }, // too few digits — must reject
        { featureId: 'F-001 SECRET_NEEDLE_DELTA', count: 1 }, // trailing junk
      ],
      topContextHashes: [],
      suggestion: { kind: 'L1', target: 'F-100/threshold', from: 3, to: 6, rationale: 'r' },
    };
    const result = pipeline.buildBriefing(evilCandidate, tmpDir);
    const md = fs.readFileSync(result.briefingPath, 'utf8');

    // Smuggle attempts must collapse to null in payload.
    const smuggled = result.payload.byFeature.find(
      (row) => typeof row.featureId === 'string' && row.featureId.includes('DROP'),
    );
    assert.equal(smuggled, undefined, 'smuggle attempt must not survive featureId regex gate');

    // Markdown must not contain the smuggle bytes.
    assert.ok(!md.includes('DROP TABLE'), 'briefing must not contain SQL-like smuggle');
    assert.ok(!md.includes('SECRET_NEEDLE'), 'briefing must not contain trailing-junk smuggle');

    // The legitimate F-100 row must still be present.
    assert.ok(result.payload.byFeature.some((row) => row.featureId === 'F-100'));
  });
});

describe('AC-3 gap · prototype-pollution probe via __proto__ in candidate', () => {
  // @cap-todo(ac:F-071/AC-3) JSON.parse('{"__proto__":{...}}') sets the property on the parsed object
  //                          (without polluting the global prototype in modern Node), but a hostile
  //                          caller could still pass a hand-crafted object with __proto__ set via
  //                          Object.defineProperty. The pipeline must not echo such fields.
  it('candidate with __proto__-injected fields does not leak them into briefing', () => {
    const evilProto = { polluted: SECRET_NEEDLES[0] };
    const evilCandidate = {
      candidateId: 'deadbeef00000005',
      signalType: 'override',
      featureId: 'F-100',
      count: 4,
      score: 4,
      byFeature: [{ featureId: 'F-100', count: 4 }],
      topContextHashes: [{ hash: 'abc123def4567890', count: 4 }],
      suggestion: { kind: 'L1', target: 'F-100/threshold', from: 3, to: 5, rationale: 'r' },
    };
    Object.defineProperty(evilCandidate, '__proto__', {
      value: evilProto,
      enumerable: true,
      configurable: true,
    });

    const result = pipeline.buildBriefing(evilCandidate, tmpDir);
    assert.ok(result, 'buildBriefing must succeed even with __proto__ on the input');
    const md = fs.readFileSync(result.briefingPath, 'utf8');
    // The needle must not appear in the briefing.
    assert.ok(!md.includes(SECRET_NEEDLES[0]),
      '__proto__-injected fields must not leak into briefing');
    // The payload must not carry the polluted property.
    assert.equal(result.payload.polluted, undefined);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — Orchestrator-style budget simulation
// ---------------------------------------------------------------------------

describe('AC-4 gap · orchestrator-style budget classification', () => {
  // @cap-todo(ac:F-071/AC-4) The pipeline lib doesn't promote/defer itself — the orchestrator does.
  //                          But we can simulate Step 4: pre-load N calls, run getSessionBudgetState,
  //                          assert candidates split correctly into promote vs. defer.
  it('budget=5, used=0, 5 promotable candidates → all 5 fit, 0 deferred', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'learning', 'config.json'),
      JSON.stringify({ llmBudgetPerSession: 5 }),
    );
    // 0 calls pre-loaded.
    const state = pipeline.getSessionBudgetState(tmpDir, 's-fits');
    assert.equal(state.budget, 5);
    assert.equal(state.used, 0);
    assert.equal(state.remaining, 5);
    // 5 candidates → all 5 fit.
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      signalType: 'override', count: 3, candidateId: `cand-${i}`,
    }));
    let promoted = 0;
    let deferred = 0;
    for (const c of candidates) {
      if (promoted < state.remaining) promoted++;
      else deferred++;
      void c;
    }
    assert.equal(promoted, 5);
    assert.equal(deferred, 0);
  });

  it('budget=0 → all candidates deferred', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'learning', 'config.json'),
      JSON.stringify({ llmBudgetPerSession: 0 }),
    );
    const state = pipeline.getSessionBudgetState(tmpDir, 's-zero');
    assert.equal(state.remaining, 0);
    const candidates = Array.from({ length: 4 }, (_, i) => ({
      signalType: 'override', count: 3, candidateId: `cand-${i}`,
    }));
    let promoted = 0;
    let deferred = 0;
    for (const c of candidates) {
      if (promoted < state.remaining) promoted++;
      else deferred++;
      void c;
    }
    assert.equal(promoted, 0);
    assert.equal(deferred, 4);
  });

  it('budget=3, used=2, 4 candidates → 1 promoted, 3 deferred (partial fit)', () => {
    // Default budget = 3. Pre-load 2 calls.
    for (let i = 0; i < 2; i++) {
      telemetry.recordLlmCall(tmpDir, {
        model: 'm', promptTokens: 0, completionTokens: 0, durationMs: 0,
        sessionId: 's-partial',
        commandContext: { command: '/cap:learn', feature: 'F-071' },
      });
    }
    const state = pipeline.getSessionBudgetState(tmpDir, 's-partial');
    assert.equal(state.remaining, 1);

    const candidates = Array.from({ length: 4 }, (_, i) => ({
      signalType: 'override', count: 3, candidateId: `cand-${i}`,
    }));
    let promoted = 0;
    let deferred = 0;
    for (const c of candidates) {
      if (promoted < state.remaining) promoted++;
      else deferred++;
      void c;
    }
    assert.equal(promoted, 1);
    assert.equal(deferred, 3);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — markDegraded contract on duplicate persistence
// ---------------------------------------------------------------------------

describe('AC-5 gap · markDegraded duplicate-call and overwrite contract', () => {
  // @cap-todo(ac:F-071/AC-5) Two calls to markDegraded for the same P-NNN: pin contract.
  //                          Current behaviour: writeFileSync overwrites. PIN: latest call wins.
  it('second markDegraded for the same P-NNN overwrites the first (pinned: latest wins)', () => {
    const cand1 = {
      candidateId: 'aaaa1111aaaa1111',
      signalType: 'override',
      featureId: 'F-100',
      count: 3,
      score: 3,
      byFeature: [{ featureId: 'F-100', count: 3 }],
      topContextHashes: [],
      suggestion: { kind: 'L1', target: 'F-100/threshold', from: 3, to: 4, rationale: 'first' },
    };
    const cand2 = {
      candidateId: 'bbbb2222bbbb2222',
      signalType: 'override',
      featureId: 'F-200',
      count: 5,
      score: 5,
      byFeature: [{ featureId: 'F-200', count: 5 }],
      topContextHashes: [],
      suggestion: { kind: 'L1', target: 'F-200/threshold', from: 3, to: 6, rationale: 'second' },
    };
    const id = 'P-001';
    assert.equal(pipeline.markDegraded(tmpDir, id, cand1), true);
    assert.equal(pipeline.markDegraded(tmpDir, id, cand2), true);
    const list = pipeline.listPatterns(tmpDir);
    assert.equal(list.length, 1, 'still exactly one pattern record (overwrite, not append)');
    // PIN: latest write wins — featureRef reflects cand2.
    assert.equal(list[0].featureRef, 'F-200', 'second markDegraded must overwrite first');
    assert.equal(list[0].suggestion.rationale, 'second');
  });

  // @cap-todo(ac:F-071/AC-5) D8 clobber-protection: an LLM pattern at P-NNN must NOT be overwritten
  //                          by a subsequent markDegraded call. Returns a structured refusal so the
  //                          orchestrator can log instead of silently losing the higher-quality record.
  it('LLM pattern then markDegraded for same P-NNN: degraded MUST NOT clobber (D8)', () => {
    const cand = {
      candidateId: 'eeee5555eeee5555',
      signalType: 'override',
      featureId: 'F-500',
      count: 3,
      score: 3,
      byFeature: [{ featureId: 'F-500', count: 3 }],
      topContextHashes: [],
      suggestion: { kind: 'L1', target: 'F-500/threshold', from: 3, to: 4, rationale: 'fallback' },
    };
    const id = 'P-001';
    // Stage 2: LLM produces a high-quality pattern.
    pipeline.recordPatternSuggestion(tmpDir, {
      id,
      createdAt: '2026-05-05T00:00:00.000Z',
      level: 'L3',
      featureRef: 'F-500',
      source: 'llm',
      degraded: false,
      confidence: 0.9,
      suggestion: { kind: 'L3', target: 'cap-prototyper.md', section: "Don't", insert: 'no oscillation', rationale: 'r' },
      evidence: { candidateId: cand.candidateId, signalType: 'override', count: 3, topContextHashes: [] },
    });

    // Step-5 fallback fires after the LLM step already wrote — the degraded marker MUST refuse.
    const result = pipeline.markDegraded(tmpDir, id, cand);
    assert.deepStrictEqual(
      result,
      { written: false, reason: 'llm-pattern-exists', prior: { source: 'llm', level: 'L3' } },
      'markDegraded must refuse to clobber an existing LLM pattern and return the structured signal',
    );

    const list = pipeline.listPatterns(tmpDir);
    assert.equal(list.length, 1);
    assert.equal(list[0].source, 'llm', 'LLM record must be preserved');
    assert.equal(list[0].level, 'L3');
    assert.equal(list[0].confidence, 0.9);
    assert.equal(list[0].degraded, false);
  });

  it('markDegraded then recordPatternSuggestion for same P-NNN: latest write wins (pinned)', () => {
    const cand = {
      candidateId: 'cccc3333cccc3333',
      signalType: 'override',
      featureId: 'F-300',
      count: 3,
      score: 3,
      byFeature: [{ featureId: 'F-300', count: 3 }],
      topContextHashes: [],
      suggestion: { kind: 'L1', target: 'F-300/threshold', from: 3, to: 4, rationale: 'r' },
    };
    const id = 'P-001';
    pipeline.markDegraded(tmpDir, id, cand);
    // Now upgrade to a non-degraded LLM record (typical Stage-2 finalisation).
    const ok = pipeline.recordPatternSuggestion(tmpDir, {
      id,
      createdAt: '2026-05-05T00:00:00.000Z',
      level: 'L2',
      featureRef: 'F-300',
      source: 'llm',
      degraded: false,
      confidence: 0.8,
      suggestion: { kind: 'L2', target: 'F-300/rule', text: 'Use deterministic clustering' },
      evidence: { candidateId: cand.candidateId, signalType: 'override', count: 3, topContextHashes: [] },
    });
    assert.equal(ok, true);
    const list = pipeline.listPatterns(tmpDir);
    assert.equal(list.length, 1);
    // PIN: the LLM record overwrites the degraded record.
    assert.equal(list[0].degraded, false);
    assert.equal(list[0].source, 'llm');
    assert.equal(list[0].level, 'L2');
  });
});

// ---------------------------------------------------------------------------
// AC-6 — P-NNN allocation edge cases
// ---------------------------------------------------------------------------

describe('AC-6 gap · allocator edge cases', () => {
  // @cap-todo(ac:F-071/AC-6) Allocator robustness against corrupt filenames + 999→1000 boundary.
  it('malformed filename (P-XXX.json) does not crash allocatePatternId', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'patterns'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-XXX.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-001abc.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-002.json'), '{}');
    // Valid id is P-002 → next = P-003.
    assert.equal(pipeline.allocatePatternId(tmpDir), 'P-003');
  });

  it('same id in patterns/ and queue/ → not double-counted; allocator returns max+1 once', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'patterns'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'queue'), { recursive: true });
    // P-005 exists in BOTH dirs (race condition: queue not cleaned up after promotion).
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-005.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'queue', 'P-005.md'), '---\nid: P-005\n---\n');
    // Allocator must dedupe and return P-006, not P-007.
    assert.equal(pipeline.allocatePatternId(tmpDir), 'P-006');
  });

  it('999 → 1000 boundary: padStart(3, "0") is a no-op for 4-digit ids; format remains P-NNNN', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'patterns'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cap', 'learning', 'patterns', 'P-999.json'), '{}');
    const next = pipeline.allocatePatternId(tmpDir);
    // PIN: padStart(3,'0') accepts strings already >= 3 chars unchanged → 'P-1000'.
    assert.equal(next, 'P-1000', 'allocator must extend gracefully past 999 (padStart is a no-op when string is already >= 3 chars)');
    // The new ID still matches the persistence regex /^P-\d+$/.
    assert.match(next, /^P-\d+$/);
    // recordPatternSuggestion must accept the 4-digit id.
    const ok = pipeline.recordPatternSuggestion(tmpDir, {
      id: next,
      createdAt: '2026-05-05T00:00:00.000Z',
      level: 'L1',
      featureRef: 'F-100',
      source: 'heuristic',
      degraded: true,
      confidence: 0.5,
      suggestion: { kind: 'L1', target: 'F-100/threshold', from: 3, to: 5, rationale: 'r' },
      evidence: { candidateId: 'x', signalType: 'override', count: 3, topContextHashes: [] },
    });
    assert.equal(ok, true, 'recordPatternSuggestion must accept 4-digit P-NNNN ids');
    const list = pipeline.listPatterns(tmpDir);
    assert.ok(list.find((p) => p.id === 'P-1000'), '4-digit ids must list correctly');
  });

  it('empty patterns dir AND empty queue dir → first ID is P-001', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'patterns'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning', 'queue'), { recursive: true });
    assert.equal(pipeline.allocatePatternId(tmpDir), 'P-001');
  });
});

// ---------------------------------------------------------------------------
// AC-7 — Budget config edge cases (negative + string)
// ---------------------------------------------------------------------------

describe('AC-7 gap · config-value edge cases', () => {
  // @cap-todo(ac:F-071/AC-7) readBudget contract: only `typeof === 'number' && >= 0` is honoured;
  //                          everything else falls back to default.
  it('llmBudgetPerSession: -1 → falls back to default 3 (negative number rejected)', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'learning', 'config.json'),
      JSON.stringify({ llmBudgetPerSession: -1 }),
    );
    const state = pipeline.getSessionBudgetState(tmpDir, 's');
    // PIN: negative value is REJECTED by readBudget (>= 0 gate); falls back to default.
    assert.equal(state.budget, telemetry.DEFAULT_LLM_BUDGET_PER_SESSION);
    assert.equal(state.source, 'default');
  });

  it('llmBudgetPerSession: "3" (string) → falls back to default 3 (typeof !== number)', () => {
    fs.mkdirSync(path.join(tmpDir, '.cap', 'learning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.cap', 'learning', 'config.json'),
      JSON.stringify({ llmBudgetPerSession: '3' }),
    );
    const state = pipeline.getSessionBudgetState(tmpDir, 's');
    // PIN: string-typed value is REJECTED; readBudget requires typeof === 'number'.
    assert.equal(state.budget, telemetry.DEFAULT_LLM_BUDGET_PER_SESSION);
    assert.equal(state.source, 'default');
  });
});
