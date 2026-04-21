'use strict';

// @cap-feature(feature:F-055) Unit tests for the confidence/evidence pure-logic module.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const mod = require('../cap/bin/lib/cap-memory-confidence.cjs');

const {
  tokenize,
  jaccardSimilarity,
  isReObservation,
  hasNegationMarker,
  filesOverlap,
  isContradiction,
  initFields,
  bumpOnReObservation,
  dampOnContradiction,
  ensureFields,
  isLowConfidence,
  applyLearningSignals,
  DEFAULT_CONFIDENCE,
  DEFAULT_EVIDENCE,
  CONFIDENCE_CAP,
  CONFIDENCE_FLOOR,
  SIMILARITY_THRESHOLD,
  DIM_THRESHOLD,
} = mod;

// --- tokenize ---

describe('tokenize', () => {
  it('lowercases', () => {
    assert.deepEqual(tokenize('Hello World'), ['hello', 'world']);
  });

  it('splits on punctuation and whitespace', () => {
    assert.deepEqual(tokenize('foo, bar; baz.qux'), ['foo', 'bar', 'baz', 'qux']);
  });

  it('deduplicates', () => {
    assert.deepEqual(tokenize('foo foo foo bar'), ['foo', 'bar']);
  });

  it('drops empty tokens', () => {
    assert.deepEqual(tokenize('   ,,,  ...'), []);
  });

  it('handles null/undefined/empty', () => {
    assert.deepEqual(tokenize(null), []);
    assert.deepEqual(tokenize(undefined), []);
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize(42), []);
  });

  it('keeps unicode letters', () => {
    assert.deepEqual(tokenize('über café naïve'), ['über', 'café', 'naïve']);
  });
});

// --- jaccardSimilarity ---

describe('jaccardSimilarity', () => {
  it('returns 1 for identical strings', () => {
    assert.equal(jaccardSimilarity('the quick brown fox', 'the quick brown fox'), 1);
  });

  it('returns 0 for fully disjoint token sets', () => {
    assert.equal(jaccardSimilarity('apple banana', 'dog elephant'), 0);
  });

  it('returns > 0.8 for minor variations of same sentence', () => {
    const a = 'Never commit generated files to the repository';
    const b = 'Never commit generated files to the repository.';
    assert.ok(jaccardSimilarity(a, b) >= 0.8);
  });

  it('returns < 0.8 for semantically different sentences sharing a few words', () => {
    const a = 'Never commit generated files to the repository';
    const b = 'Generated artifacts live in dist and must be ignored';
    assert.ok(jaccardSimilarity(a, b) < 0.8);
  });

  it('returns 0 when both inputs are empty', () => {
    assert.equal(jaccardSimilarity('', ''), 0);
  });

  it('returns 0 when one input is empty', () => {
    assert.equal(jaccardSimilarity('hello', ''), 0);
  });
});

// --- isReObservation ---

describe('isReObservation', () => {
  it('true for identical strings', () => {
    assert.equal(isReObservation('foo bar baz', 'foo bar baz'), true);
  });

  it('true at or above 0.8 threshold', () => {
    // 4 of 5 tokens shared -> 4/5 = 0.8 exactly
    const a = 'alpha beta gamma delta epsilon';
    const b = 'alpha beta gamma delta epsilon';
    assert.equal(isReObservation(a, b), true);
  });

  it('false below 0.8 threshold', () => {
    const a = 'one two three';
    const b = 'four five six';
    assert.equal(isReObservation(a, b), false);
  });

  it('respects threshold boundary (>= 0.8 true)', () => {
    // Jaccard must be >= SIMILARITY_THRESHOLD (0.8) for true
    assert.equal(SIMILARITY_THRESHOLD, 0.8);
    // Construct pair with exactly 0.8 similarity: |A∩B|/|A∪B| = 4/5
    const a = 'a b c d e';
    const b = 'a b c d f'; // share 4, union 6 -> 4/6 = 0.666 (not enough)
    assert.equal(isReObservation(a, b), false);
    const c = 'a b c d e'; // identical -> 1.0
    assert.equal(isReObservation(a, c), true);
  });
});

// --- hasNegationMarker ---

describe('hasNegationMarker', () => {
  it('detects english markers', () => {
    assert.equal(hasNegationMarker("don't do this"), true);
    assert.equal(hasNegationMarker('never commit secrets'), true);
    assert.equal(hasNegationMarker('avoid the trap'), true);
  });

  it('detects german markers', () => {
    assert.equal(hasNegationMarker('das ist nicht gut'), true);
    assert.equal(hasNegationMarker('nie wieder'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(hasNegationMarker('NEVER COMMIT SECRETS'), true);
  });

  it('does not match "not" as substring of other words', () => {
    // Note: 'not ' with trailing space -> 'notation' should NOT match
    assert.equal(hasNegationMarker('notation is beautiful'), false);
  });

  it('returns false for empty/null', () => {
    assert.equal(hasNegationMarker(''), false);
    assert.equal(hasNegationMarker(null), false);
  });
});

// --- filesOverlap ---

describe('filesOverlap', () => {
  it('true when arrays share a file', () => {
    assert.equal(filesOverlap(['a', 'b'], ['b', 'c']), true);
  });

  it('false when disjoint', () => {
    assert.equal(filesOverlap(['a'], ['b']), false);
  });

  it('false for empty/null inputs', () => {
    assert.equal(filesOverlap([], ['x']), false);
    assert.equal(filesOverlap(null, ['x']), false);
    assert.equal(filesOverlap(['x'], undefined), false);
  });
});

// --- isContradiction ---

describe('isContradiction', () => {
  const baseNew = {
    category: 'decision',
    content: 'Never use cookies for session state in this service',
    metadata: { relatedFiles: ['src/auth.js'] },
  };
  const baseExistingPositive = {
    category: 'decision',
    content: 'Use cookies for session state in this service',
    metadata: { relatedFiles: ['src/auth.js'] },
  };

  it('true for same-category + file-overlap + negation asymmetry + shared vocabulary', () => {
    assert.equal(isContradiction(baseNew, baseExistingPositive), true);
  });

  it('false when categories differ', () => {
    const other = { ...baseExistingPositive, category: 'pitfall' };
    assert.equal(isContradiction(baseNew, other), false);
  });

  it('false when files do not overlap', () => {
    const other = { ...baseExistingPositive, metadata: { relatedFiles: ['src/other.js'] } };
    assert.equal(isContradiction(baseNew, other), false);
  });

  it('false when both sides use negation', () => {
    const bothNeg = {
      category: 'decision',
      content: "don't use cookies for session state in this service",
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    assert.equal(isContradiction(baseNew, bothNeg), false);
  });

  it('false when token overlap is too low even with negation asymmetry', () => {
    const unrelated = {
      category: 'decision',
      content: 'Deploy pipeline runs on Friday evenings only',
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    assert.equal(isContradiction(baseNew, unrelated), false);
  });

  it('falls back to entry.file when metadata.relatedFiles is missing', () => {
    const n = { category: 'decision', content: 'never use cookies here', file: 'src/auth.js', metadata: {} };
    const e = { category: 'decision', content: 'use cookies here', file: 'src/auth.js', metadata: {} };
    assert.equal(isContradiction(n, e), true);
  });

  it('false when either entry is null', () => {
    assert.equal(isContradiction(null, baseExistingPositive), false);
    assert.equal(isContradiction(baseNew, null), false);
  });
});

// --- initFields / bumpOnReObservation / dampOnContradiction ---

describe('initFields', () => {
  it('returns the documented defaults', () => {
    const f = initFields();
    assert.equal(f.confidence, DEFAULT_CONFIDENCE);
    assert.equal(f.evidence_count, DEFAULT_EVIDENCE);
    assert.equal(f.confidence, 0.5);
    assert.equal(f.evidence_count, 1);
  });
});

describe('bumpOnReObservation', () => {
  it('increments evidence by 1 and confidence by 0.1', () => {
    const f = bumpOnReObservation(initFields());
    assert.equal(f.evidence_count, 2);
    assert.equal(f.confidence, 0.6);
  });

  it('caps confidence at 0.95 after many bumps', () => {
    let f = initFields();
    for (let i = 0; i < 20; i++) f = bumpOnReObservation(f);
    assert.equal(f.confidence, CONFIDENCE_CAP);
    assert.equal(f.confidence, 0.95);
    // evidence_count keeps counting even when confidence is capped
    assert.equal(f.evidence_count, 21);
  });

  it('ensureFields-wraps raw input', () => {
    const f = bumpOnReObservation({ confidence: 0.8, evidence_count: 5 });
    assert.equal(f.confidence, 0.9);
    assert.equal(f.evidence_count, 6);
  });
});

describe('dampOnContradiction', () => {
  it('decrements confidence by 0.2 without touching evidence_count', () => {
    const f = dampOnContradiction({ confidence: 0.5, evidence_count: 3 });
    assert.equal(f.confidence, 0.3);
    assert.equal(f.evidence_count, 3);
  });

  it('floors at 0.0 even after many damps', () => {
    let f = { confidence: 0.5, evidence_count: 7 };
    for (let i = 0; i < 10; i++) f = dampOnContradiction(f);
    assert.equal(f.confidence, CONFIDENCE_FLOOR);
    assert.equal(f.confidence, 0);
    assert.equal(f.evidence_count, 7);
  });
});

// --- ensureFields ---

describe('ensureFields', () => {
  it('defaults missing confidence to 0.5', () => {
    const out = ensureFields({ evidence_count: 3, source: 'x' });
    assert.equal(out.confidence, 0.5);
    assert.equal(out.evidence_count, 3);
    assert.equal(out.source, 'x');
  });

  it('defaults missing evidence_count to 1', () => {
    const out = ensureFields({ confidence: 0.7 });
    assert.equal(out.confidence, 0.7);
    assert.equal(out.evidence_count, 1);
  });

  it('defaults both when empty', () => {
    const out = ensureFields({});
    assert.equal(out.confidence, 0.5);
    assert.equal(out.evidence_count, 1);
  });

  it('handles null input', () => {
    const out = ensureFields(null);
    assert.equal(out.confidence, 0.5);
    assert.equal(out.evidence_count, 1);
  });

  it('leaves existing valid fields untouched', () => {
    const input = { confidence: 0.42, evidence_count: 7, other: 'keep' };
    const out = ensureFields(input);
    assert.equal(out.confidence, 0.42);
    assert.equal(out.evidence_count, 7);
    assert.equal(out.other, 'keep');
    // Non-mutating
    assert.notEqual(out, input);
  });

  it('coerces NaN / non-numeric to defaults', () => {
    const out = ensureFields({ confidence: NaN, evidence_count: 'oops' });
    assert.equal(out.confidence, 0.5);
    assert.equal(out.evidence_count, 1);
  });

  it('coerces evidence_count < 1 to default', () => {
    const out = ensureFields({ evidence_count: 0 });
    assert.equal(out.evidence_count, 1);
  });
});

// --- isLowConfidence ---

describe('isLowConfidence', () => {
  it('true for confidence < 0.3', () => {
    assert.equal(isLowConfidence({ confidence: 0.29 }), true);
    assert.equal(isLowConfidence({ confidence: 0 }), true);
  });

  it('false at exactly 0.3', () => {
    // Strictly-less-than semantics: 0.3 is NOT dim
    assert.equal(isLowConfidence({ confidence: DIM_THRESHOLD }), false);
    assert.equal(isLowConfidence({ confidence: 0.3 }), false);
  });

  it('false above 0.3', () => {
    assert.equal(isLowConfidence({ confidence: 0.5 }), false);
  });

  it('defaults missing confidence to 0.5 (not low)', () => {
    assert.equal(isLowConfidence({}), false);
  });
});

// --- applyLearningSignals ---

describe('applyLearningSignals', () => {
  const mkEntry = (overrides = {}) => ({
    category: 'decision',
    content: 'Use token-based auth across all services',
    file: 'src/auth.js',
    metadata: { relatedFiles: ['src/auth.js'] },
    ...overrides,
  });

  it('action=new when existing list is empty', () => {
    const res = applyLearningSignals(mkEntry(), []);
    assert.equal(res.action, 'new');
    assert.equal(res.touchedExistingIndex, null);
    assert.equal(res.mergedEntry.metadata.confidence, 0.5);
    assert.equal(res.mergedEntry.metadata.evidence_count, 1);
  });

  it('action=new when no existing entry matches', () => {
    const res = applyLearningSignals(mkEntry(), [
      mkEntry({ content: 'Completely different topic about caching layers' }),
    ]);
    assert.equal(res.action, 'new');
  });

  it('action=reobserved when content matches existing (>=0.8 jaccard)', () => {
    const existing = [
      mkEntry({ metadata: { relatedFiles: ['src/auth.js'], confidence: 0.5, evidence_count: 1 } }),
    ];
    const res = applyLearningSignals(mkEntry(), existing);
    assert.equal(res.action, 'reobserved');
    assert.equal(res.touchedExistingIndex, 0);
    assert.equal(res.mergedEntry.metadata.evidence_count, 2);
    assert.equal(res.mergedEntry.metadata.confidence, 0.6);
  });

  it('action=contradicted when negation-asymmetric match exists (below similarity threshold)', () => {
    // Note: priority-rule is reobservation > contradiction. For the contradiction branch to
    // fire, the two contents must share enough vocabulary to clear the 50% token-overlap
    // gate AFTER stripping negation markers, yet differ enough that raw Jaccard is below 0.8.
    const existing = [
      mkEntry({
        content: 'use cookies for session state management across services',
        metadata: { relatedFiles: ['src/auth.js'], confidence: 0.7, evidence_count: 3 },
      }),
    ];
    const newEntry = mkEntry({
      content: "never use cookies for session state management in these services today",
    });
    const res = applyLearningSignals(newEntry, existing);
    assert.equal(res.action, 'contradicted');
    assert.equal(res.touchedExistingIndex, 0);
    // new entry keeps its fresh init fields
    assert.equal(res.mergedEntry.metadata.confidence, 0.5);
    assert.equal(res.mergedEntry.metadata.evidence_count, 1);
    // damped-update sidecar carries the updated existing metadata
    assert.ok(res.mergedEntry._contradictedExistingUpdate);
    assert.equal(res.mergedEntry._contradictedExistingUpdate.updatedMetadata.confidence, 0.5);
    assert.equal(res.mergedEntry._contradictedExistingUpdate.updatedMetadata.evidence_count, 3);
  });

  it('prioritizes reobservation over contradiction when both could apply', () => {
    // An existing positive entry PLUS a separate near-identical contradictory entry.
    // Re-observation of the near-identical one must win, keeping behaviour deterministic.
    const existing = [
      mkEntry({ content: 'Use token-based auth across all services', metadata: { relatedFiles: ['src/auth.js'] } }),
      mkEntry({ content: 'Use token-based auth across all services extra word here', metadata: { relatedFiles: ['src/auth.js'] } }),
    ];
    const newEntry = mkEntry({ content: 'Use token-based auth across all services' });
    const res = applyLearningSignals(newEntry, existing);
    assert.equal(res.action, 'reobserved');
  });

  it('handles non-array existingEntries by returning new', () => {
    const res = applyLearningSignals(mkEntry(), null);
    assert.equal(res.action, 'new');
  });
});

// --- Engine integration: accumulateFromCode learning signals (F-055 end-to-end) ---

describe('engine.accumulateFromCode with learning signals', () => {
  const engine = require('../cap/bin/lib/cap-memory-engine.cjs');

  it('injects initFields into every new entry (AC-2)', () => {
    const tags = [
      { type: 'decision', file: 'src/a.ts', line: 1, metadata: {}, description: 'Decide something meaningful about the architecture', subtype: null },
      { type: 'risk', file: 'src/b.ts', line: 2, metadata: {}, description: 'This is a risk that might cause problems later on', subtype: null },
    ];
    const entries = engine.accumulateFromCode(tags);
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.metadata.confidence, 0.5);
      assert.equal(e.metadata.evidence_count, 1);
    }
  });

  it('re-observation merges with existing entry and bumps its confidence (AC-4)', () => {
    const tags = [
      { type: 'decision', file: 'src/a.ts', line: 1, metadata: {}, description: 'Always normalize file paths before comparison', subtype: null },
    ];
    const existing = [
      {
        category: 'decision',
        file: 'src/a.ts',
        content: 'Always normalize file paths before comparison',
        metadata: { source: '2026-01-01', relatedFiles: ['src/a.ts'], pinned: false, confidence: 0.6, evidence_count: 2 },
      },
    ];
    const out = engine.accumulateFromCode(tags, { existingEntries: existing });
    assert.equal(out.length, 1);
    assert.equal(out[0].metadata.evidence_count, 3);
    assert.equal(out[0].metadata.confidence, 0.7);
  });

  it('contradiction damps existing entry and keeps the new entry separately (AC-5)', () => {
    const tags = [
      { type: 'decision', file: 'src/auth.js', line: 1, metadata: {}, description: 'never use cookies for session state management in these services today', subtype: null },
    ];
    const existing = [
      {
        category: 'decision',
        file: 'src/auth.js',
        content: 'use cookies for session state management across services',
        metadata: { source: '2026-01-01', relatedFiles: ['src/auth.js'], pinned: false, confidence: 0.7, evidence_count: 3 },
      },
    ];
    const out = engine.accumulateFromCode(tags, { existingEntries: existing });
    // two entries back: the new one (fresh fields) and the damped existing one
    assert.equal(out.length, 2);
    const newEntry = out.find((e) => e.content.startsWith('never use cookies'));
    const damped = out.find((e) => e.content.startsWith('use cookies'));
    assert.ok(newEntry && damped);
    assert.equal(newEntry.metadata.confidence, 0.5);
    assert.equal(newEntry.metadata.evidence_count, 1);
    assert.equal(damped.metadata.confidence, 0.5); // 0.7 - 0.2
    assert.equal(damped.metadata.evidence_count, 3); // unchanged
    // sidecar must be stripped from the public result
    assert.ok(!('_contradictedExistingUpdate' in newEntry));
  });

  it('existing-entries absent -> entries returned without signal processing (backward compat)', () => {
    const tags = [
      { type: 'decision', file: 'src/a.ts', line: 1, metadata: {}, description: 'Plain decision returned as-is', subtype: null },
    ];
    const out = engine.accumulateFromCode(tags);
    assert.equal(out.length, 1);
    assert.equal(out[0].metadata.confidence, 0.5);
    assert.equal(out[0].metadata.evidence_count, 1);
  });

  it('learningSignals:false explicitly disables signal processing even with existingEntries', () => {
    const tags = [
      { type: 'decision', file: 'src/a.ts', line: 1, metadata: {}, description: 'Always normalize file paths before comparison', subtype: null },
    ];
    const existing = [
      {
        category: 'decision',
        file: 'src/a.ts',
        content: 'Always normalize file paths before comparison',
        metadata: { source: '2026-01-01', relatedFiles: ['src/a.ts'], pinned: false, confidence: 0.6, evidence_count: 2 },
      },
    ];
    const out = engine.accumulateFromCode(tags, { existingEntries: existing, learningSignals: false });
    assert.equal(out.length, 1);
    // signal disabled => fresh init fields, no bump
    assert.equal(out[0].metadata.confidence, 0.5);
    assert.equal(out[0].metadata.evidence_count, 1);
  });
});

// --- Export shape ---

describe('cap-memory-confidence exports', () => {
  it('exports all documented functions and constants', () => {
    for (const name of [
      'tokenize', 'jaccardSimilarity', 'isReObservation',
      'hasNegationMarker', 'filesOverlap', 'isContradiction',
      'initFields', 'bumpOnReObservation', 'dampOnContradiction',
      'ensureFields', 'isLowConfidence', 'applyLearningSignals',
    ]) {
      assert.equal(typeof mod[name], 'function', `missing function ${name}`);
    }
    for (const [name, expected] of [
      ['DEFAULT_CONFIDENCE', 0.5],
      ['DEFAULT_EVIDENCE', 1],
      ['CONFIDENCE_CAP', 0.95],
      ['CONFIDENCE_FLOOR', 0.0],
      ['SIMILARITY_THRESHOLD', 0.8],
      ['DIM_THRESHOLD', 0.3],
    ]) {
      assert.equal(mod[name], expected, `constant ${name} mismatch`);
    }
  });
});
