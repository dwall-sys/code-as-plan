// @cap-feature(feature:F-091) Source-aware initial confidence — explicit @cap-* tags start
//   higher than heuristic-extracted entries so they survive the F-090 filter immediately.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../cap/bin/lib/cap-memory-engine.cjs');
const confidence = require('../cap/bin/lib/cap-memory-confidence.cjs');

function tag(opts) {
  return {
    type: opts.type,
    subtype: opts.subtype || null,
    description: opts.description,
    file: opts.file || 'src/foo.cjs',
    line: opts.line || 1,
    metadata: opts.metadata || {},
  };
}

describe('F-091 confidence.initFields — opts variant', () => {
  it('without opts: returns DEFAULT_CONFIDENCE 0.5 (backwards compat)', () => {
    const f = confidence.initFields();
    assert.equal(f.confidence, 0.5);
    assert.equal(f.evidence_count, 1);
  });

  it('with legacy Date arg: still returns DEFAULT_CONFIDENCE 0.5', () => {
    const f = confidence.initFields(new Date('2026-05-08T00:00:00Z'));
    assert.equal(f.confidence, 0.5);
    assert.equal(f.last_seen, '2026-05-08T00:00:00.000Z');
  });

  it('with initialConfidence override: returns the override value', () => {
    const f = confidence.initFields({ initialConfidence: 0.8 });
    assert.equal(f.confidence, 0.8);
  });

  it('clamps initialConfidence above CAP', () => {
    const f = confidence.initFields({ initialConfidence: 1.5 });
    assert.equal(f.confidence, confidence.CONFIDENCE_CAP);
  });

  it('clamps initialConfidence below FLOOR', () => {
    const f = confidence.initFields({ initialConfidence: -0.5 });
    assert.equal(f.confidence, confidence.CONFIDENCE_FLOOR);
  });

  it('rejects non-number initialConfidence (falls through to DEFAULT)', () => {
    const f = confidence.initFields({ initialConfidence: 'high' });
    assert.equal(f.confidence, 0.5);
  });
});

describe('F-091 confidence.initialConfidenceForSource', () => {
  it('returns 0.8 for cap-decision', () => {
    assert.equal(confidence.initialConfidenceForSource('cap-decision'), 0.8);
  });

  it('returns 0.7 for cap-todo-risk and cap-risk', () => {
    assert.equal(confidence.initialConfidenceForSource('cap-todo-risk'), 0.7);
    assert.equal(confidence.initialConfidenceForSource('cap-risk'), 0.7);
  });

  it('returns 0.5 for session-extract and heuristic (status quo)', () => {
    assert.equal(confidence.initialConfidenceForSource('session-extract'), 0.5);
    assert.equal(confidence.initialConfidenceForSource('heuristic'), 0.5);
  });

  it('returns DEFAULT_CONFIDENCE for unknown source', () => {
    assert.equal(confidence.initialConfidenceForSource('mystery'), 0.5);
    assert.equal(confidence.initialConfidenceForSource(null), 0.5);
    assert.equal(confidence.initialConfidenceForSource(undefined), 0.5);
  });

  it('table exposes all source keys for inspection', () => {
    const keys = Object.keys(confidence.SOURCE_INITIAL_CONFIDENCE);
    assert.ok(keys.includes('cap-decision'));
    assert.ok(keys.includes('cap-todo-risk'));
    assert.ok(keys.includes('cap-risk'));
    assert.ok(keys.includes('session-extract'));
    assert.ok(keys.includes('heuristic'));
  });
});

describe('F-091 accumulateFromCode — confidence per tag-type', () => {
  it('@cap-decision tag → confidence 0.8', () => {
    const entries = engine.accumulateFromCode([
      tag({
        type: 'decision',
        description: 'Use token-based refresh for sessions to avoid reauth flicker.',
      }),
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].category, 'decision');
    assert.equal(entries[0].metadata.confidence, 0.8);
  });

  it('@cap-risk tag → confidence 0.7', () => {
    const entries = engine.accumulateFromCode([
      tag({
        type: 'risk',
        description: 'Race condition possible if two clients update state simultaneously.',
      }),
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].category, 'pitfall');
    assert.equal(entries[0].metadata.confidence, 0.7);
  });

  it('@cap-todo risk: subtype → confidence 0.7', () => {
    const entries = engine.accumulateFromCode([
      tag({
        type: 'todo',
        subtype: 'risk',
        description: 'risk: must handle expired tokens gracefully on retry.',
      }),
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].category, 'pitfall');
    assert.equal(entries[0].metadata.confidence, 0.7);
  });

  it('mixed tag types in one batch produce per-tag confidence values', () => {
    const entries = engine.accumulateFromCode([
      tag({ type: 'decision', description: 'Decision A about caching strategies and TTL.' }),
      tag({ type: 'risk', description: 'Risk B about concurrent writes to the same row.' }),
      tag({
        type: 'todo',
        subtype: 'risk',
        description: 'risk: C about retry storms from exponential backoff.',
      }),
    ]);
    assert.equal(entries.length, 3);
    const dec = entries.find(e => e.content.includes('Decision A'));
    const riskA = entries.find(e => e.content.includes('Risk B'));
    const riskB = entries.find(e => e.content.includes('C about retry storms'));
    assert.equal(dec.metadata.confidence, 0.8);
    assert.equal(riskA.metadata.confidence, 0.7);
    assert.equal(riskB.metadata.confidence, 0.7);
  });
});

describe('F-091 + F-090 integration: explicit tags survive the 0.6 filter immediately', () => {
  it('@cap-decision entry survives writeMemoryDirectory with minConfidence:0.6', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = require('../cap/bin/lib/cap-memory-dir.cjs');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f091-'));
    try {
      const entries = engine.accumulateFromCode([
        tag({
          type: 'decision',
          description: 'Use bcrypt with cost=12 for password hashing on signup.',
        }),
      ]);
      // F-090 hook-level threshold is 0.6 — F-091 ensures explicit tags hit 0.8 → kept
      dir.writeMemoryDirectory(tmp, entries, { minConfidence: 0.6 });
      const decisions = fs.readFileSync(path.join(tmp, '.cap', 'memory', 'decisions.md'), 'utf8');
      assert.match(decisions, /bcrypt with cost=12/);
      assert.match(decisions, /\*1 decisions total\*/); // not "kept (filtered out N)"
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('heuristic entry (no @cap-* origin) is dropped by the 0.6 filter', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = require('../cap/bin/lib/cap-memory-dir.cjs');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-f091-'));
    try {
      // Simulate a session-extracted entry: no confidence override, defaults to 0.5
      const entries = [
        {
          category: 'decision',
          file: 'src/foo.cjs',
          content: 'Random heuristic-extracted decision-like phrase from a chat log.',
          metadata: {
            source: '2026-05-08',
            branch: null,
            relatedFiles: ['src/foo.cjs'],
            features: [],
            pinned: false,
            ...confidence.initFields(), // 0.5 default
          },
        },
      ];
      dir.writeMemoryDirectory(tmp, entries, { minConfidence: 0.6 });
      const decisions = fs.readFileSync(path.join(tmp, '.cap', 'memory', 'decisions.md'), 'utf8');
      assert.doesNotMatch(decisions, /Random heuristic-extracted/);
      assert.match(decisions, /No high-confidence decisions recorded yet \(filtered out 1/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
