'use strict';

// @cap-feature(feature:F-055) Adversarial tests over the F-055 confidence/evidence prototype.
// @cap-history(sessions:2, edits:4, since:2026-04-20, learned:2026-04-21) Frequently modified — 2 sessions, 4 edits
// Goal: probe edge cases that the happy-path suite does not cover — numeric boundaries,
// Unicode, contradiction false-positives, migration quirks, roundtrip fidelity.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const conf = require('../cap/bin/lib/cap-memory-confidence.cjs');
const dir = require('../cap/bin/lib/cap-memory-dir.cjs');
const engine = require('../cap/bin/lib/cap-memory-engine.cjs');

const {
  tokenize,
  jaccardSimilarity,
  isReObservation,
  hasNegationMarker,
  filesOverlap,
  isContradiction,
  bumpOnReObservation,
  dampOnContradiction,
  ensureFields,
  isLowConfidence,
  applyLearningSignals,
  SIMILARITY_THRESHOLD,
  DIM_THRESHOLD,
  CONFIDENCE_CAP,
  CONFIDENCE_FLOOR,
} = conf;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mem-adv-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Numeric boundaries — bumpOnReObservation / dampOnContradiction
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] bumpOnReObservation — numeric boundaries', () => {
  it('bump at 0.9 clamps to 0.95 (CAP), not to 1.0', () => {
    const out = bumpOnReObservation({ confidence: 0.9, evidence_count: 1 });
    assert.equal(out.confidence, 0.95);
    assert.equal(out.evidence_count, 2);
  });

  it('bump at 0.91 also clamps to 0.95 (float-safe via round2)', () => {
    // 0.91 + 0.1 = 1.01 before clamp; min(0.95, 1.01) = 0.95
    const out = bumpOnReObservation({ confidence: 0.91, evidence_count: 1 });
    assert.equal(out.confidence, 0.95);
  });

  it('bump at already-capped 0.95 stays at 0.95 (idempotent at cap)', () => {
    const out = bumpOnReObservation({ confidence: 0.95, evidence_count: 10 });
    assert.equal(out.confidence, CONFIDENCE_CAP);
    assert.equal(out.evidence_count, 11);
  });

  it('bump on evidence_count = Number.MAX_SAFE_INTEGER remains a finite integer', () => {
    const out = bumpOnReObservation({ confidence: 0.5, evidence_count: Number.MAX_SAFE_INTEGER });
    assert.ok(Number.isFinite(out.evidence_count));
    // Note: MAX_SAFE_INTEGER + 1 === MAX_SAFE_INTEGER + 1 is technically still representable but loses precision.
    // Pin the observable behaviour: it's still a positive integer-ish number.
    assert.ok(out.evidence_count > Number.MAX_SAFE_INTEGER - 1);
  });

  it('bump with NaN confidence first ensureFields-coerces to 0.5, then bumps to 0.6', () => {
    const out = bumpOnReObservation({ confidence: NaN, evidence_count: 2 });
    assert.equal(out.confidence, 0.6);
    assert.equal(out.evidence_count, 3);
  });

  it('bump with undefined confidence falls back to default 0.5 → 0.6', () => {
    const out = bumpOnReObservation({ evidence_count: 2 });
    assert.equal(out.confidence, 0.6);
  });

  it('floating-point noise: bump chain 0.5→0.6→0.7→0.8 yields exact 0.7, 0.8 (round2 applied)', () => {
    let f = { confidence: 0.5, evidence_count: 1 };
    f = bumpOnReObservation(f);
    assert.equal(f.confidence, 0.6);
    f = bumpOnReObservation(f);
    assert.equal(f.confidence, 0.7);
    f = bumpOnReObservation(f);
    assert.equal(f.confidence, 0.8);
    // Critically: no 0.7000000000000001 or 0.30000000000000004 drift.
  });
});

describe('[adversarial] dampOnContradiction — numeric boundaries', () => {
  it('damp at 0.1 clamps to FLOOR (0.0), not to negative', () => {
    const out = dampOnContradiction({ confidence: 0.1, evidence_count: 5 });
    assert.equal(out.confidence, CONFIDENCE_FLOOR);
    assert.equal(out.confidence, 0);
    assert.equal(out.evidence_count, 5);
  });

  it('damp at 0 stays at 0 (idempotent at floor)', () => {
    const out = dampOnContradiction({ confidence: 0, evidence_count: 3 });
    assert.equal(out.confidence, 0);
    assert.equal(out.evidence_count, 3);
  });

  it('evidence_count is never changed by damp, even through 10 repeats', () => {
    let f = { confidence: 0.5, evidence_count: 7 };
    for (let i = 0; i < 10; i++) f = dampOnContradiction(f);
    assert.equal(f.confidence, 0);
    assert.equal(f.evidence_count, 7);
  });

  it('damp at 0.3 (exactly) lands on 0.1 (no float drift)', () => {
    const out = dampOnContradiction({ confidence: 0.3, evidence_count: 1 });
    // 0.3 - 0.2 = 0.09999... in raw float, but round2 brings it to 0.1
    assert.equal(out.confidence, 0.1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isLowConfidence — boundary + float precision
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] isLowConfidence boundaries', () => {
  it('confidence = 0.2999... (classic float-drift) is normalised by round2 in ensureFields → NOT dim', () => {
    // After the review follow-up, ensureFields applies round2 so float-drift
    // around the threshold collapses to 0.30 and no longer flips the dim state.
    const floaty = 0.1 + 0.1 + 0.1 - 0.000000000001; // raw value strictly < 0.3
    assert.ok(floaty < DIM_THRESHOLD);
    assert.equal(isLowConfidence({ confidence: floaty }), false);
  });

  it('confidence = 0.30000000000000004 (0.1+0.1+0.1 raw) rounds to 0.30 → NOT dim', () => {
    const jsFlaky = 0.1 + 0.1 + 0.1;
    assert.ok(jsFlaky > DIM_THRESHOLD);
    assert.equal(isLowConfidence({ confidence: jsFlaky }), false);
  });

  it('confidence just below 0.3 (0.2999) rounds to 0.30 → NOT dim', () => {
    // Hand-edited 0.2999 renders as 0.30 after round2 — matches display.
    assert.equal(isLowConfidence({ confidence: 0.2999 }), false);
  });

  it('confidence = 0.29 is preserved by round2 → still dim', () => {
    // Values clearly below threshold survive round2 unchanged.
    assert.equal(isLowConfidence({ confidence: 0.29 }), true);
  });

  it('confidence just above 0.3 (0.3001) is NOT dim', () => {
    assert.equal(isLowConfidence({ confidence: 0.3001 }), false);
  });

  it('null confidence falls back to default 0.5 (not dim)', () => {
    assert.equal(isLowConfidence({ confidence: null }), false);
  });

  it('confidence > 1.0 is clamped by ensureFields to 1.0', () => {
    // Post-review: ensureFields clamps out-of-range numeric values to [0, 1].
    // 1.5 is a legacy/hand-edit artefact; clamping keeps renders sane.
    const out = ensureFields({ confidence: 1.5 });
    assert.equal(out.confidence, 1);
    assert.equal(isLowConfidence({ confidence: 1.5 }), false);
  });

  it('confidence < 0 is clamped by ensureFields to 0.0 (and renders dim)', () => {
    // Same clamp: negative values collapse to the floor and flag as low confidence.
    const out = ensureFields({ confidence: -0.5 });
    assert.equal(out.confidence, 0);
    assert.equal(isLowConfidence({ confidence: -0.5 }), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tokenize — Unicode, punctuation, whitespace, large inputs
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] tokenize edge cases', () => {
  it('collapses punctuation-heavy input equal to whitespace-only variant', () => {
    assert.deepEqual(tokenize('hello, world!'), tokenize('hello world'));
  });

  it('deduplicates case-insensitively (HELLO vs hello)', () => {
    assert.deepEqual(tokenize('Hello hello HELLO HeLLo'), ['hello']);
  });

  it('matches Ümlaut lowercase to umlaut-style lowercase as separate tokens (no diacritic normalization)', () => {
    // Pin behaviour: tokenize lowercases but does NOT strip diacritics.
    // 'über' and 'uber' are distinct tokens.
    const ta = tokenize('Über test');
    const tb = tokenize('uber TEST');
    assert.deepEqual(ta, ['über', 'test']);
    assert.deepEqual(tb, ['uber', 'test']);
    assert.notDeepEqual(ta, tb);
  });

  it('handles 10k character string in reasonable time (< 100 ms)', () => {
    const big = ('abcd efgh ijkl mnop qrst ').repeat(400); // ~10_000 chars
    const t0 = Date.now();
    const tokens = tokenize(big);
    const dt = Date.now() - t0;
    assert.ok(tokens.length > 0 && tokens.length <= 5); // deduped to 5 unique words
    assert.ok(dt < 100, `tokenize took ${dt} ms on 10k input`);
  });

  it('numeric-only content is tokenized (digits are \\p{N})', () => {
    assert.deepEqual(tokenize('404 500 200'), ['404', '500', '200']);
  });

  it('mixed scripts (Latin + German + CJK) are all preserved as separate tokens', () => {
    const tokens = tokenize('hello über 日本');
    assert.ok(tokens.includes('hello'));
    assert.ok(tokens.includes('über'));
    assert.ok(tokens.includes('日本'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// jaccardSimilarity — threshold edge, dedup, invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] jaccardSimilarity edge cases', () => {
  it('dedup: "a a a" vs "a" is 1.0 (set semantics)', () => {
    assert.equal(jaccardSimilarity('a a a a', 'a'), 1);
  });

  it('punctuation-only differences keep similarity at 1.0', () => {
    const a = 'Never commit generated files to the repository';
    const b = 'Never: commit, generated; files — to — the — repository.';
    assert.equal(jaccardSimilarity(a, b), 1);
  });

  it('exactly-0.8 boundary passes isReObservation (>= semantics)', () => {
    // 4 shared, union 5 → 4/5 = 0.8 exactly
    const a = 'alpha beta gamma delta epsilon';
    const b = 'alpha beta gamma delta';
    const j = jaccardSimilarity(a, b);
    assert.equal(j, 4 / 5);
    assert.equal(j, 0.8);
    // Threshold is inclusive
    assert.equal(isReObservation(a, b), true);
  });

  it('strictly-below-threshold (Jaccard ≈ 0.7999) fails isReObservation', () => {
    // Construct pair with 4 shared, union 6 → 4/6 ≈ 0.666...
    const a = 'alpha beta gamma delta';
    const b = 'alpha beta gamma epsilon zeta eta';
    assert.ok(jaccardSimilarity(a, b) < SIMILARITY_THRESHOLD);
    assert.equal(isReObservation(a, b), false);
  });

  it('symmetry: jaccardSimilarity(a,b) === jaccardSimilarity(b,a)', () => {
    const a = 'one two three four five';
    const b = 'three four five six seven';
    assert.equal(jaccardSimilarity(a, b), jaccardSimilarity(b, a));
  });

  it('subset relation: "foo" vs "foo bar" is 1/2 = 0.5 (below threshold)', () => {
    assert.equal(jaccardSimilarity('foo', 'foo bar'), 0.5);
    assert.equal(isReObservation('foo', 'foo bar'), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isContradiction — false-positive hunting
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] isContradiction false-positive hunting', () => {
  it('same content in both sides → NOT a contradiction (no negation asymmetry)', () => {
    const e = {
      category: 'decision',
      content: 'Use JWTs for cross-service authentication',
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    assert.equal(isContradiction(e, e), false);
  });

  it('stylistic "don\'t just X, do Y" pitfall vs positive "do Y" does not contradict due to vocabulary mismatch', () => {
    const n = {
      category: 'pitfall',
      content: "don't just copy the token, rotate it on every rotation cycle exactly",
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    const e = {
      category: 'pitfall',
      content: 'Rotate tokens on every cycle for strong security guarantees',
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    // 50%-token-overlap gate after stripping negation markers should fail here
    const contradicts = isContradiction(n, e);
    // We pin the observed behaviour — document whatever the code decides.
    assert.equal(typeof contradicts, 'boolean');
    // Expected: false, because the intents align ("both say rotate tokens").
    assert.equal(contradicts, false);
  });

  it('category mismatch (decision vs pitfall) with negation asymmetry → NOT contradiction', () => {
    const n = {
      category: 'decision',
      content: 'never use cookies for session state across these services',
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    const e = {
      category: 'pitfall',
      content: 'use cookies for session state across these services',
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    assert.equal(isContradiction(n, e), false);
  });

  it('file-scope mismatch → NOT contradiction even with perfect negation asymmetry', () => {
    const n = {
      category: 'decision',
      content: 'never use cookies for session state across these services',
      metadata: { relatedFiles: ['src/svc-a.js'] },
    };
    const e = {
      category: 'decision',
      content: 'use cookies for session state across these services',
      metadata: { relatedFiles: ['src/svc-b.js'] },
    };
    assert.equal(isContradiction(n, e), false);
  });

  it('German negation "nicht" asymmetry + shared vocabulary triggers contradiction', () => {
    const n = {
      category: 'decision',
      content: 'Cookies sind nicht für Session-State geeignet in diesem Service',
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    const e = {
      category: 'decision',
      content: 'Cookies sind für Session-State geeignet in diesem Service',
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    // Pin the actual behaviour — the module declares German markers including 'nicht'.
    assert.equal(isContradiction(n, e), true);
  });

  it('token-overlap gate: high-negation-asymmetry but only 1 shared token → NOT contradiction', () => {
    const n = {
      category: 'decision',
      content: 'avoid monolithic deploys for the payment pipeline completely',
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    const e = {
      category: 'decision',
      content: 'use observability dashboards for the pipeline and upstream caches',
      metadata: { relatedFiles: ['src/auth.js'] },
    };
    // Only 'pipeline' and 'for' + 'the' overlap — token-overlap ratio after negation-strip
    // should be below 50 %.
    assert.equal(isContradiction(n, e), false);
  });

  it('empty content on either side → NOT contradiction (token set empty)', () => {
    const n = { category: 'decision', content: '', metadata: { relatedFiles: ['src/a.js'] } };
    const e = { category: 'decision', content: 'never do X', metadata: { relatedFiles: ['src/a.js'] } };
    assert.equal(isContradiction(n, e), false);
  });

  it('undefined entry → false (no throw)', () => {
    assert.equal(isContradiction(undefined, undefined), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureFields — boundary cases between "missing" and "0"
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] ensureFields — zero vs missing', () => {
  it('confidence = 0 (explicit) is PRESERVED, not replaced by default 0.5', () => {
    // Critical: 0 is a valid confidence (an entry was fully contradicted).
    // If ensureFields overwrote it to 0.5, contradicted entries would silently "heal".
    const out = ensureFields({ confidence: 0 });
    assert.equal(out.confidence, 0);
  });

  it('confidence = 0 after damp-chain survives roundtrip through ensureFields', () => {
    let f = { confidence: 0.5, evidence_count: 1 };
    for (let i = 0; i < 5; i++) f = dampOnContradiction(f);
    const out = ensureFields(f);
    assert.equal(out.confidence, 0);
  });

  it('evidence_count = 0 is REPLACED with default 1 (< 1 is not legal)', () => {
    // AC says evidence_count >= 1, so 0 is corrupt input → force default.
    const out = ensureFields({ evidence_count: 0 });
    assert.equal(out.evidence_count, 1);
  });

  it('evidence_count = 0.5 (non-integer) is REPLACED with 1 — pinned behaviour', () => {
    // The code uses `< 1`; a fractional 0.5 also fails. Pin this.
    const out = ensureFields({ evidence_count: 0.5 });
    assert.equal(out.evidence_count, 1);
  });

  it('evidence_count = Infinity is REPLACED with default 1 (Number.isFinite check)', () => {
    const out = ensureFields({ evidence_count: Infinity });
    assert.equal(out.evidence_count, 1);
  });

  it('evidence_count = 3.7 (non-integer >=1) is PRESERVED — pinned behaviour', () => {
    // Code only checks `< 1`; fractional >= 1 passes through.
    // Surprising? yes. Pin it so a future fix to `!Number.isInteger` is explicit.
    const out = ensureFields({ evidence_count: 3.7 });
    assert.equal(out.evidence_count, 3.7);
  });

  it('evidence_count = "3" (string-number) is REPLACED with default (typeof !== "number")', () => {
    const out = ensureFields({ evidence_count: '3' });
    assert.equal(out.evidence_count, 1);
  });

  it('confidence = null is REPLACED with default (typeof null !== "number")', () => {
    const out = ensureFields({ confidence: null });
    assert.equal(out.confidence, 0.5);
  });

  it('shallow clone (not deep) — nested object in metadata is shared by reference', () => {
    const nested = { inner: true };
    const src = { confidence: 0.5, evidence_count: 1, extra: nested };
    const out = ensureFields(src);
    assert.equal(out.extra, nested); // same reference → shallow clone
    assert.notEqual(out, src);
  });

  it('does not mutate the input object', () => {
    const src = {};
    ensureFields(src);
    assert.equal(src.confidence, undefined);
    assert.equal(src.evidence_count, undefined);
  });

  it('ensureFields(undefined) returns defaults without throwing', () => {
    const out = ensureFields(undefined);
    assert.equal(out.confidence, 0.5);
    assert.equal(out.evidence_count, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyLearningSignals — multi-entry resolution semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] applyLearningSignals — multi-entry resolution', () => {
  const mkNew = (o = {}) => ({
    category: 'decision',
    content: 'Use token-based auth across all services',
    file: 'src/auth.js',
    metadata: { relatedFiles: ['src/auth.js'] },
    ...o,
  });

  it('multiple reobservation candidates: FIRST match wins deterministically', () => {
    const existing = [
      { category: 'decision', content: 'Use token-based auth across all services', metadata: { confidence: 0.5, evidence_count: 1, relatedFiles: ['src/auth.js'] } },
      { category: 'decision', content: 'Use token-based auth across all services', metadata: { confidence: 0.8, evidence_count: 7, relatedFiles: ['src/auth.js'] } },
    ];
    const res = applyLearningSignals(mkNew(), existing);
    assert.equal(res.action, 'reobserved');
    assert.equal(res.touchedExistingIndex, 0); // first match
    // The second (high-evidence) entry was NOT touched.
    assert.equal(res.mergedEntry.metadata.confidence, 0.6);
    assert.equal(res.mergedEntry.metadata.evidence_count, 2);
  });

  it('reobservation wins over a same-index contradiction when both could apply', () => {
    // An existing entry with shared vocabulary + negation asymmetry (contradiction candidate)
    // AND a near-duplicate entry (reobservation candidate) — reobservation must win.
    const existing = [
      // Contradiction-shaped (negation asymmetry, same files, shared words)
      {
        category: 'decision',
        content: "don't use token-based auth for legacy services in the cluster today",
        metadata: { relatedFiles: ['src/auth.js'], confidence: 0.6, evidence_count: 2 },
      },
      // Reobservation-shaped (near-identical)
      {
        category: 'decision',
        content: 'Use token-based auth across all services',
        metadata: { relatedFiles: ['src/auth.js'], confidence: 0.5, evidence_count: 1 },
      },
    ];
    const res = applyLearningSignals(mkNew(), existing);
    // Priority: reobservation scanned first → index 1 matches
    assert.equal(res.action, 'reobserved');
    assert.equal(res.touchedExistingIndex, 1);
  });

  it('cross-category existing entries are skipped for reobservation (only same-category)', () => {
    const existing = [
      // Same content but pitfall category — must NOT be treated as reobservation.
      {
        category: 'pitfall',
        content: 'Use token-based auth across all services',
        metadata: { relatedFiles: ['src/auth.js'], confidence: 0.5, evidence_count: 1 },
      },
    ];
    const res = applyLearningSignals(mkNew(), existing);
    assert.equal(res.action, 'new');
  });

  it('new entry with no relatedFiles and no file field still resolves to "new" without throwing', () => {
    const res = applyLearningSignals(
      { category: 'decision', content: 'Some unique novel decision about refactoring the module', metadata: {} },
      []
    );
    assert.equal(res.action, 'new');
    assert.equal(res.mergedEntry.metadata.confidence, 0.5);
  });

  it('existingEntries with a null slot does not throw', () => {
    const res = applyLearningSignals(mkNew(), [null, null]);
    assert.equal(res.action, 'new');
  });

  it('existingEntries = undefined behaves like []', () => {
    const res = applyLearningSignals(mkNew(), undefined);
    assert.equal(res.action, 'new');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateCategoryMarkdown — rendering robustness
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] generateCategoryMarkdown rendering robustness', () => {
  const mkE = (o = {}) => ({
    category: 'decision',
    file: '/src/a.js',
    content: 'Always use the builder pattern for complex constructors',
    metadata: {
      source: '2026-04-01T10:00:00Z',
      relatedFiles: ['/src/a.js'],
      features: [],
      pinned: false,
      confidence: 0.5,
      evidence_count: 1,
      ...(o.metadata || {}),
    },
    ...o,
  });

  it('confidence = 0.3 (exactly) renders NOT dimmed (strict < threshold)', () => {
    const md = dir.generateCategoryMarkdown('decision', [mkE({ metadata: { confidence: 0.3, evidence_count: 1 } })]);
    assert.ok(!md.includes('*(low confidence)*'));
    assert.ok(md.includes('- **Confidence:** 0.30'));
  });

  it('confidence = 0.2999 rounds to 0.30 and renders NOT dimmed (round2 in ensureFields)', () => {
    const md = dir.generateCategoryMarkdown('decision', [mkE({ metadata: { confidence: 0.2999, evidence_count: 1 } })]);
    assert.ok(!md.includes('*(low confidence)*'));
    assert.ok(md.includes('- **Confidence:** 0.30'));
  });

  it('confidence = 0.29 renders dimmed (below threshold, round2 preserves)', () => {
    const md = dir.generateCategoryMarkdown('decision', [mkE({ metadata: { confidence: 0.29, evidence_count: 1 } })]);
    assert.ok(md.includes('*(low confidence)*'));
  });

  it('confidence = NaN falls back to default 0.5 and renders 0.50 not NaN', () => {
    const md = dir.generateCategoryMarkdown('decision', [mkE({ metadata: { confidence: NaN, evidence_count: 1 } })]);
    assert.ok(md.includes('- **Confidence:** 0.50'));
    assert.ok(!md.includes('NaN'));
  });

  it('confidence = 1.0 renders 1.00 (no clamping on write)', () => {
    const md = dir.generateCategoryMarkdown('decision', [mkE({ metadata: { confidence: 1.0, evidence_count: 2 } })]);
    assert.ok(md.includes('- **Confidence:** 1.00'));
  });

  it('missing entire metadata.confidence/evidence_count (legacy write-path) auto-defaults', () => {
    const md = dir.generateCategoryMarkdown('decision', [mkE({ metadata: { relatedFiles: [], features: [], pinned: false } })]);
    assert.ok(md.includes('- **Confidence:** 0.50'));
    assert.ok(md.includes('- **Evidence:** 1'));
  });

  it('markdown content with pipes/backticks survives render (no escaping, documented risk)', () => {
    // @cap-risk Entry content is rendered raw into markdown — a malicious or accidental
    // backtick/pipe/`### ` sequence in content COULD disrupt downstream readers.
    const md = dir.generateCategoryMarkdown('decision', [mkE({
      content: 'Avoid using `eval` or | pipes in user-facing strings',
      metadata: { confidence: 0.5, evidence_count: 1 },
    })]);
    assert.ok(md.includes('`eval`'));
    assert.ok(md.includes('| pipes'));
  });

  it('empty entries array produces the "no X recorded yet" placeholder', () => {
    const md = dir.generateCategoryMarkdown('decision', []);
    assert.ok(md.includes('_No decisions recorded yet._'));
    assert.ok(!md.includes('**Confidence:**'));
  });

  it('low-confidence entry with low-confidence content also dimms bullets (all prefixed with "> ")', () => {
    const md = dir.generateCategoryMarkdown('decision', [mkE({ metadata: { confidence: 0.1, evidence_count: 1 } })]);
    // Every non-empty content line (heading + bullets) must be blockquoted.
    const lines = md.split('\n').filter((l) =>
      l.startsWith('### ') || l.startsWith('- **'));
    // None of those plain lines should exist — every entry line must be "> "-prefixed.
    assert.equal(lines.length, 0, `expected zero un-prefixed lines; got: ${JSON.stringify(lines)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readMemoryFile — corrupt / unusual inputs
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] readMemoryFile — corrupt / unusual inputs', () => {
  it('empty file yields empty entries array', () => {
    const fp = path.join(tmpDir, 'decisions.md');
    fs.writeFileSync(fp, '', 'utf8');
    const { entries } = dir.readMemoryFile(fp);
    assert.deepEqual(entries, []);
  });

  it('header-only file (no entries) yields empty entries array', () => {
    const fp = path.join(tmpDir, 'decisions.md');
    fs.writeFileSync(fp, '# Project Memory: Decisions\n\n> header\n\n', 'utf8');
    const { entries } = dir.readMemoryFile(fp);
    assert.deepEqual(entries, []);
  });

  it('heading with NO bullets at all yields entry with defaults (AC-3 lazy migration)', () => {
    const fp = path.join(tmpDir, 'decisions.md');
    fs.writeFileSync(fp, [
      '# Project Memory: Decisions',
      '',
      '### <a id="aabbccdd"></a>Orphan heading with nothing under it',
      '',
      '---',
      '*1 decisions total*',
    ].join('\n'), 'utf8');
    const { entries } = dir.readMemoryFile(fp);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content, 'Orphan heading with nothing under it');
    assert.equal(entries[0].metadata.confidence, 0.5);
    assert.equal(entries[0].metadata.evidence_count, 1);
  });

  it('corrupt Confidence bullet ("not-a-number") leaves confidence as NaN then ensureFields coerces to default', () => {
    const fp = path.join(tmpDir, 'decisions.md');
    fs.writeFileSync(fp, [
      '# Project Memory: Decisions',
      '',
      '### <a id="cafecafe"></a>Entry with corrupt confidence bullet here',
      '',
      '- **Date:** 2026-01-01',
      '- **Files:** `src/x.js`',
      '- **Confidence:** not-a-number',
      '- **Evidence:** 2',
      '',
    ].join('\n'), 'utf8');
    const { entries } = dir.readMemoryFile(fp);
    assert.equal(entries.length, 1);
    // Regex only matches [0-9.] — so "not-a-number" is NOT captured → field missing → ensureFields defaults
    assert.equal(entries[0].metadata.confidence, 0.5);
    // But the valid Evidence bullet IS captured
    assert.equal(entries[0].metadata.evidence_count, 2);
  });

  it('two consecutive headings (first has no body) both produce entries', () => {
    const fp = path.join(tmpDir, 'decisions.md');
    fs.writeFileSync(fp, [
      '# Project Memory: Decisions',
      '',
      '### <a id="aaaaaaaa"></a>First entry heading with no bullets following it',
      '### <a id="bbbbbbbb"></a>Second entry heading with bullets below',
      '- **Date:** 2026-01-02',
      '- **Files:** `src/y.js`',
      '- **Confidence:** 0.42',
      '- **Evidence:** 2',
      '',
    ].join('\n'), 'utf8');
    const { entries } = dir.readMemoryFile(fp);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].content, 'First entry heading with no bullets following it');
    assert.equal(entries[0].metadata.confidence, 0.5); // default
    assert.equal(entries[1].content, 'Second entry heading with bullets below');
    assert.equal(entries[1].metadata.confidence, 0.42);
    assert.equal(entries[1].metadata.evidence_count, 2);
  });

  it('dim marker ONLY present (no quote-prefix "> ") is still stripped from content', () => {
    // Defensive: a slightly-malformed file where someone put the dim marker but forgot the blockquote.
    const fp = path.join(tmpDir, 'decisions.md');
    fs.writeFileSync(fp, [
      '# Project Memory: Decisions',
      '',
      '### <a id="deaddead"></a>*(low confidence)* Entry with marker but no blockquote prefix',
      '- **Date:** 2026-01-03',
      '- **Files:** `src/z.js`',
      '- **Confidence:** 0.10',
      '- **Evidence:** 1',
      '',
    ].join('\n'), 'utf8');
    const { entries } = dir.readMemoryFile(fp);
    assert.equal(entries.length, 1);
    // The marker has to be stripped from content either way.
    assert.equal(entries[0].content, 'Entry with marker but no blockquote prefix');
    assert.equal(entries[0].metadata.confidence, 0.1);
  });

  it('hotspots.md-format file returns 0 entries (table format is not parsed by readMemoryFile)', () => {
    const fp = path.join(tmpDir, 'hotspots.md');
    fs.writeFileSync(fp, [
      '# Project Memory: Hotspots',
      '',
      '| Rank | File | Sessions | Edits | Since |',
      '|------|------|----------|-------|-------|',
      '| <a id="hhhhhhhh"></a>1 | `src/a.js` | 3 | 8 | 2026-03-15 |',
      '',
    ].join('\n'), 'utf8');
    const { entries } = dir.readMemoryFile(fp);
    // Table rows aren't "### " headings → no entries extracted. Documented separation.
    assert.deepEqual(entries, []);
  });

  it('entries with features list of one survive roundtrip', () => {
    const entry = {
      category: 'decision',
      file: '/src/a.js',
      content: 'Prefer composition over inheritance for the domain layer',
      metadata: {
        source: '2026-04-05T10:00:00Z',
        relatedFiles: ['/src/a.js'],
        features: ['F-123'],
        pinned: false,
        confidence: 0.42,
        evidence_count: 5,
      },
    };
    dir.writeMemoryDirectory(tmpDir, [entry]);
    const fp = path.join(tmpDir, dir.MEMORY_DIR, 'decisions.md');
    const { entries } = dir.readMemoryFile(fp);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].metadata.features, ['F-123']);
    assert.equal(entries[0].metadata.confidence, 0.42);
    assert.equal(entries[0].metadata.evidence_count, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Roundtrip fidelity — write then read, multiple entries, mixed states
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] write→read roundtrip fidelity', () => {
  it('three entries with different confidence (0.1, 0.5, 0.9) and evidence (1, 5, 42) roundtrip exactly', () => {
    const entries = [
      {
        category: 'decision',
        file: '/a.js',
        content: 'Low-confidence tentative rule about cache defaults',
        metadata: { source: '2026-04-01T10:00:00Z', relatedFiles: ['/a.js'], features: [], pinned: false, confidence: 0.1, evidence_count: 1 },
      },
      {
        category: 'decision',
        file: '/b.js',
        content: 'Medium-confidence everyday architectural rule about service layering',
        metadata: { source: '2026-04-02T10:00:00Z', relatedFiles: ['/b.js'], features: [], pinned: false, confidence: 0.5, evidence_count: 5 },
      },
      {
        category: 'decision',
        file: '/c.js',
        content: 'Strong rule about always using parameterised queries for SQL statements',
        metadata: { source: '2026-04-03T10:00:00Z', relatedFiles: ['/c.js'], features: [], pinned: false, confidence: 0.9, evidence_count: 42 },
      },
    ];
    dir.writeMemoryDirectory(tmpDir, entries);
    const { entries: got } = dir.readMemoryFile(path.join(tmpDir, dir.MEMORY_DIR, 'decisions.md'));
    assert.equal(got.length, 3);
    assert.equal(got[0].metadata.confidence, 0.1);
    assert.equal(got[0].metadata.evidence_count, 1);
    assert.equal(got[1].metadata.confidence, 0.5);
    assert.equal(got[1].metadata.evidence_count, 5);
    assert.equal(got[2].metadata.confidence, 0.9);
    assert.equal(got[2].metadata.evidence_count, 42);
  });

  it('content with trailing whitespace and special-chars (pipes, backticks, parens) roundtrips', () => {
    const entry = {
      category: 'decision',
      file: '/src/a.js',
      content: 'Use `Array.from()` (not `| filter |`) for cross-browser compat here',
      metadata: { source: '2026-04-01T10:00:00Z', relatedFiles: ['/src/a.js'], features: [], pinned: false, confidence: 0.5, evidence_count: 1 },
    };
    dir.writeMemoryDirectory(tmpDir, [entry]);
    const { entries } = dir.readMemoryFile(path.join(tmpDir, dir.MEMORY_DIR, 'decisions.md'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content, 'Use `Array.from()` (not `| filter |`) for cross-browser compat here');
  });

  it('multi-line content in one entry stays one entry after roundtrip (anchor-forgery guard)', () => {
    const entry = {
      category: 'decision',
      file: '/src/a.js',
      content: 'Line one\n### <a id="deadbeef"></a>Smuggled heading',
      metadata: { source: '2026-04-01T10:00:00Z', relatedFiles: ['/src/a.js'], features: [], pinned: false, confidence: 0.5, evidence_count: 1 },
    };
    dir.writeMemoryDirectory(tmpDir, [entry]);
    const { entries } = dir.readMemoryFile(path.join(tmpDir, dir.MEMORY_DIR, 'decisions.md'));
    assert.equal(entries.length, 1, 'write path must collapse newlines so one entry stays one entry');
    assert.ok(!entries.some(e => e.anchor === 'deadbeef'), 'no forged anchor from smuggled heading');
    assert.ok(entries[0].content.includes('Smuggled heading'), 'original payload is preserved as text, not as a heading');
    assert.ok(!entries[0].content.includes('\n'), 'no newline survives in persisted content');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine integration — contracts for accumulateFromCode options
// ─────────────────────────────────────────────────────────────────────────────

describe('[adversarial] engine.accumulateFromCode — options contract', () => {
  it('existingEntries = [] (empty array, signalsEnabled = true) still injects defaults on new entries', () => {
    const tags = [
      { type: 'decision', file: 'src/a.ts', line: 1, metadata: {}, description: 'Some architectural decision worth recording', subtype: null },
    ];
    const out = engine.accumulateFromCode(tags, { existingEntries: [] });
    assert.equal(out.length, 1);
    // Even with signals enabled, no existing → "new" path → initFields still applied.
    // F-091: @cap-decision starts at 0.8 (was 0.5 pre-F-091).
    assert.equal(out[0].metadata.confidence, 0.8);
    assert.equal(out[0].metadata.evidence_count, 1);
  });

  it('explicit learningSignals:true without existingEntries is treated as disabled (no array)', () => {
    const tags = [
      { type: 'decision', file: 'src/a.ts', line: 1, metadata: {}, description: 'Explicit signals-on without array of existing entries here', subtype: null },
    ];
    const out = engine.accumulateFromCode(tags, { learningSignals: true });
    // signalsEnabled requires Array.isArray(existingEntries) — true alone is insufficient.
    // Result must still have defaults. F-091: @cap-decision starts at 0.8.
    assert.equal(out.length, 1);
    assert.equal(out[0].metadata.confidence, 0.8);
    assert.equal(out[0].metadata.evidence_count, 1);
  });

  it('cross-category signals: new decision does NOT reobserve an existing pitfall with same content', () => {
    const tags = [
      { type: 'decision', file: 'src/a.ts', line: 1, metadata: {}, description: 'Always validate all user inputs before persisting them', subtype: null },
    ];
    const existing = [
      {
        category: 'pitfall',
        file: 'src/a.ts',
        content: 'Always validate all user inputs before persisting them',
        metadata: { source: '2026-01-01', relatedFiles: ['src/a.ts'], pinned: false, confidence: 0.8, evidence_count: 5 },
      },
    ];
    const out = engine.accumulateFromCode(tags, { existingEntries: existing });
    assert.equal(out.length, 1);
    // Different category → no reobservation → fresh fields. F-091: @cap-decision starts at 0.8.
    assert.equal(out[0].metadata.confidence, 0.8);
    assert.equal(out[0].metadata.evidence_count, 1);
    assert.equal(out[0].category, 'decision');
  });

  it('two new tags with similar content: each is compared ONLY against existingEntries, not each other', () => {
    // Because accumulateFromCode builds `entries` first, then runs signals against `existing`,
    // two similar new entries do NOT merge each other — both survive.
    const tags = [
      { type: 'decision', file: 'src/a.ts', line: 1, metadata: {}, description: 'Always normalize file paths before comparison', subtype: null },
      { type: 'decision', file: 'src/b.ts', line: 5, metadata: {}, description: 'Always normalize file paths before any comparison', subtype: null },
    ];
    // Note: de-duplication inside accumulateFromCode is by first-80-char substring lowercase.
    // "Always normalize file paths before comparison" vs "Always normalize file paths before any comparison"
    // → keys differ (the second has "any"), so dedup keeps both.
    const out = engine.accumulateFromCode(tags, { existingEntries: [] });
    assert.equal(out.length, 2);
    // F-091: @cap-decision starts at 0.8.
    for (const e of out) {
      assert.equal(e.metadata.confidence, 0.8);
      assert.equal(e.metadata.evidence_count, 1);
    }
  });

  it('contradiction path emits BOTH the new entry (fresh fields) AND the damped existing', () => {
    // Reinforce AC-5 by probing the output-array shape more aggressively.
    const tags = [
      { type: 'decision', file: 'src/auth.js', line: 1, metadata: {}, description: 'never use cookies for session state management in these services today', subtype: null },
    ];
    const existing = [
      {
        category: 'decision',
        file: 'src/auth.js',
        content: 'use cookies for session state management across services',
        metadata: { source: '2026-01-01', relatedFiles: ['src/auth.js'], pinned: false, confidence: 0.4, evidence_count: 2 },
      },
    ];
    const out = engine.accumulateFromCode(tags, { existingEntries: existing });
    assert.equal(out.length, 2);
    const newE = out.find((e) => e.content.startsWith('never'));
    const damped = out.find((e) => e.content.startsWith('use '));
    assert.ok(newE && damped);
    assert.equal(damped.metadata.confidence, 0.2); // 0.4 − 0.2
    assert.equal(damped.metadata.evidence_count, 2); // unchanged
    // Sidecar must be stripped
    assert.equal('_contradictedExistingUpdate' in newE, false);
    assert.equal('_contradictedExistingUpdate' in damped, false);
  });

  it('contradiction with EXISTING at floor (0) keeps damped at 0, emits both entries', () => {
    const tags = [
      { type: 'decision', file: 'src/auth.js', line: 1, metadata: {}, description: 'never use cookies for session state management in these services today', subtype: null },
    ];
    const existing = [
      {
        category: 'decision',
        file: 'src/auth.js',
        content: 'use cookies for session state management across services',
        metadata: { source: '2026-01-01', relatedFiles: ['src/auth.js'], pinned: false, confidence: 0, evidence_count: 10 },
      },
    ];
    const out = engine.accumulateFromCode(tags, { existingEntries: existing });
    const damped = out.find((e) => e.content.startsWith('use '));
    assert.ok(damped);
    assert.equal(damped.metadata.confidence, 0);
    assert.equal(damped.metadata.evidence_count, 10);
  });
});
